/**
 * ================================================================
 * UQU AUTH SYSTEM v2.0 — Smart Academic Authentication (Firebase-First)
 * ================================================================
 * نظام مصادقة متكامل يدعم:
 * - تسجيل حساب جديد بالبريد الإلكتروني عبر Firebase Auth
 * - تسجيل الدخول بالبريد + كلمة المرور عبر Firebase Auth
 * - جلسات ذكية
 * - دعم Firebase إلزامي (مربوط بقاعدة بيانات Firestore مباشرة)
 * ================================================================
 */

(function (window) {
  'use strict';

  /* ── Storage Keys ─────────────────────────── */
  const K = {
    SESSION:      'uqu_session_v2',
    ACTIVE_USER:  'uqu_active_user',
    THEME:        'uqu_theme',
  };

  /* ── Session Helpers ─────────────────────── */
  function createSession(user, persistent = false) {
    const session = {
      uid:        user.uid,
      name:       user.displayName || user.name || user.email.split('@')[0],
      email:      user.email,
      avatar:     user.avatar || makeAvatar(user.displayName || user.name || user.email),
      major:      user.major || '',
      university: user.university || 'جامعة أم القرى',
      persistent,
      loginAt:    new Date().toISOString(),
    };
    localStorage.setItem(K.ACTIVE_USER, JSON.stringify(session));
    if (!persistent) {
      sessionStorage.setItem(K.SESSION, '1');
    } else {
      sessionStorage.setItem(K.SESSION, '1'); // keep for this session too
    }
    return session;
  }

  /* ── Avatar from Name ─────────────────────── */
  function makeAvatar(name) {
    return (name || '?').trim().split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || '؟';
  }

  /* ── Main Auth Object ─────────────────────── */
  const UQUAuth = {

    /* ── Register ─────────────────────────── */
    async register({ name, email, password, major = '', university = 'جامعة أم القرى' }) {
      if (!name?.trim())     throw new Error('الاسم مطلوب');
      if (!email?.trim())    throw new Error('البريد الإلكتروني مطلوب');
      if (!password)         throw new Error('كلمة المرور مطلوبة');
      if (password.length < 6) throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');

      if (typeof firebase === 'undefined') throw new Error('Firebase غير متصل');

      // 1. إنشاء الحساب عبر Firebase Auth
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = cred.user;

      // تحديث الاسم في Firebase Auth
      await user.updateProfile({ displayName: name.trim() });

      // 2. إنشاء مستند المستخدم في Firestore (Strict Schema)
      const db = firebase.firestore();
      await db.collection("users").doc(user.uid).set({
        profile: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          major: major.trim(),
          university: university.trim() || 'جامعة أم القرى'
        },
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      console.log("✅ Saved to Firebase"); // التأكيد المطلوب

      // إنشاء جلسة محلية للعرض الفوري
      const session = createSession({
        uid: user.uid,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        major: major.trim(),
        university: university.trim() || 'جامعة أم القرى'
      }, false);

      this._dispatchChange('register', session);
      return session;
    },

    /* ── Login ────────────────────────────── */
    async login({ email, password, remember = false }) {
      if (!email?.trim())  throw new Error('البريد الإلكتروني مطلوب');
      if (!password)       throw new Error('كلمة المرور مطلوبة');
      if (typeof firebase === 'undefined') throw new Error('Firebase غير متصل');

      // تسجيل الدخول عبر Firebase
      const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
      const user = cred.user;

      // Session persistence in Firebase
      await firebase.auth().setPersistence(
        remember 
          ? firebase.auth.Auth.Persistence.LOCAL 
          : firebase.auth.Auth.Persistence.SESSION
      );

      // We rely on firebase-db.js (onAuthStateChanged) to hydrate data into localStorage.
      // But we set a minimum active session for immediate UI response.
      const session = createSession({
        uid: user.uid,
        name: user.displayName || user.email,
        email: user.email
      }, remember);

      this._dispatchChange('login', session);
      return session;
    },

    /* ── Logout (Session End) ─────────────── */
    async logout(redirect = true) {
      const user = this.getSession();

      // 1. Sign out from Firebase Auth (revokes ID token)
      try {
        if (typeof firebase !== 'undefined' && firebase.auth) {
          await firebase.auth().signOut();
        }
      } catch (e) {
        console.warn('[Auth] Firebase signOut error:', e);
      }

      // 2. Explicitly remove the active session keys first
      try {
        localStorage.removeItem(K.ACTIVE_USER);
        localStorage.removeItem(K.SESSION);
        sessionStorage.removeItem(K.SESSION);
        sessionStorage.removeItem(K.ACTIVE_USER);
      } catch (_) {}

      // 3. Purge all localStorage entries except theme preference
      const preserve = [K.THEME, 'uqu_theme'];
      try {
        Object.keys(localStorage)
          .filter(k => !preserve.includes(k))
          .forEach(k => localStorage.removeItem(k));
      } catch (e) {
        console.warn('[Auth] localStorage purge error:', e);
      }

      // 4. Clear sessionStorage completely (ends the session)
      try { sessionStorage.clear(); } catch (_) {}

      // 5. Best-effort cookie clear (any auth cookies)
      try {
        document.cookie.split(';').forEach(c => {
          const eq = c.indexOf('=');
          const name = (eq > -1 ? c.substr(0, eq) : c).trim();
          if (name) {
            document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
          }
        });
      } catch (_) {}

      // 6. Notify listeners
      this._dispatchChange('logout', user);

      // 7. Hard redirect to login (prevents stale state on back-button)
      if (redirect) {
        try {
          // Replace history entry so back button doesn't return to authed page
          window.location.replace('login.html');
        } catch (_) {
          window.location.href = 'login.html';
        }
      }
    },

    /* ── Get Current Session ──────────────── */
    getSession() {
      try {
        const raw = localStorage.getItem(K.ACTIVE_USER);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s.persistent && !sessionStorage.getItem(K.SESSION)) {
          localStorage.removeItem(K.ACTIVE_USER);
          return null;
        }
        return s;
      } catch { return null; }
    },

    /* ── Get Full User Record ─────────────── */
    getFullUser() {
      // Since users DB is no longer local, return local session profile or what FirebaseDB has fetched
      const s = this.getSession();
      if (!s) return null;
      try {
        const p = JSON.parse(localStorage.getItem('uqu_profile_v2'));
        if (p && p.basic) {
            return { ...s, ...p.basic };
        }
      } catch (e) {}
      return s;
    },

    /* ── Is Logged In ─────────────────────── */
    isLoggedIn() {
      return this.getSession() !== null;
    },

    /* ── Guard: redirect if not logged in ─── */
    requireAuth(redirectTo = 'login.html') {
      if (!this.isLoggedIn()) {
        window.location.href = redirectTo;
        return false;
      }
      return true;
    },

    /* ── Guard: redirect if already logged in */
    redirectIfLoggedIn(to = 'dashboard.html') {
      if (this.isLoggedIn()) {
        window.location.href = to;
        return true;
      }
      return false;
    },

    /* ── Update User Profile ──────────────── */
    async updateProfile(updates) {
      const session = this.getSession();
      if (!session) throw new Error('غير مسجل الدخول');
      if (typeof firebase === 'undefined') throw new Error('Firebase غير متصل');

      const user = firebase.auth().currentUser;
      if (!user) throw new Error('المستخدم غير موجود');

      // Update Firebase Auth if name changes
      if (updates.name) {
        await user.updateProfile({ displayName: updates.name.trim() });
      }

      // Update Firestore
      const db = firebase.firestore();
      const profileUpdates = {};
      if (updates.name) profileUpdates.name = updates.name.trim();
      if (updates.major) profileUpdates.major = updates.major.trim();
      if (updates.university) profileUpdates.university = updates.university.trim();

      if (Object.keys(profileUpdates).length > 0) {
        await db.collection("users").doc(user.uid).set({
          profile: profileUpdates,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log("✅ Saved to Firebase");
      }

      // Refresh local session for instant UI mapping
      const newSessionInfo = {
         ...session,
         name: updates.name || session.name,
         major: updates.major || session.major,
         university: updates.university || session.university
      };
      
      const newSession = createSession(newSessionInfo, session.persistent);
      this._dispatchChange('profile_updated', newSession);
      return newSession;
    },

    /* ── Change Password ──────────────────── */
    async changePassword(oldPassword, newPassword) {
      if (typeof firebase === 'undefined') throw new Error('Firebase غير متصل');
      const user = firebase.auth().currentUser;
      if (!user) throw new Error('غير مسجل الدخول');
      
      const cred = firebase.auth.EmailAuthProvider.credential(user.email, oldPassword);
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(newPassword);
    },

    /* ── Delete Account ───────────────────── */
    async deleteAccount() {
      if (typeof firebase === 'undefined') throw new Error('Firebase غير متصل');
      const user = firebase.auth().currentUser;
      if (user) {
        const uid = user.uid;
        await user.delete();
        // Option: Delete Firestore user document via Edge function or directly here if rules permit
        try {
          await firebase.firestore().collection("users").doc(uid).delete();
        } catch(e) {}
      }
      this.logout();
    },

    /* ── Get All Achievements ─────────────── */
    getAchievements() {
      const all = [
        { id: 'first_login',   icon: '🎉', name: 'أول تسجيل دخول',    desc: 'مرحباً بك في المساعد الأكاديمي!' },
        { id: 'week_streak',   icon: '🔥', name: 'أسبوع متواصل',      desc: 'سجّلت الدخول 7 أيام متتالية' },
        { id: 'month_streak',  icon: '🌟', name: 'شهر متواصل',        desc: 'سجّلت الدخول 30 يوماً متتالية' },
        { id: 'gpa_4plus',     icon: '🏆', name: 'معدل ممتاز',        desc: 'معدلك فوق 4.0' },
        { id: 'gpa_4_5',       icon: '👑', name: 'الأول على القسم',   desc: 'معدلك فوق 4.5' },
        { id: 'plan_created',  icon: '📅', name: 'مخطط محترف',        desc: 'أنشأت أول خطة دراسية' },
        { id: 'courses_added', icon: '📚', name: 'طالب منظّم',        desc: 'أضفت 3 مواد أو أكثر' },
        { id: 'chat_10',       icon: '💬', name: 'محاور نشط',         desc: 'أجريت 10 محادثات مع المساعد' },
        { id: 'night_owl',     icon: '🦉', name: 'بومة الليل',        desc: 'ذاكرت بعد منتصف الليل' },
        { id: 'early_bird',    icon: '🌅', name: 'الصاعد الباكر',     desc: 'ذاكرت قبل الساعة 6 صباحاً' },
      ];
      // Fetch earned from profile cache if needed (for simplicity returning false until populated natively)
      return all.map(a => ({ ...a, earned: false }));
    },

    /* ── Event Dispatcher ─────────────────── */
    _dispatchChange(type, data) {
      window.dispatchEvent(new CustomEvent('uqu:auth', { detail: { type, data } }));
    },

    /* ── Inject User Avatar in Header ──────── */
    injectHeaderUser() {
      const session = this.getSession();
      const actions = document.querySelector('.header-actions');
      if (!actions) return;

      actions.querySelector('.user-avatar-btn')?.remove();
      actions.querySelector('.notif-trigger')?.remove();

      if (!session) {
        let loginBtn = actions.querySelector('.btn-login-header');
        if (!loginBtn) {
          loginBtn = document.createElement('a');
          loginBtn.href = 'login.html';
          loginBtn.className = 'btn-ghost btn-login-header';
          loginBtn.style.cssText = 'font-size:.85rem;padding:7px 18px;border-radius:99px;border:1px solid var(--border-2);';
          loginBtn.textContent = 'تسجيل الدخول';
          actions.prepend(loginBtn);
        }
        return;
      }

      actions.querySelector('.btn-login-header')?.remove();

      const notifBtn = document.createElement('button');
      notifBtn.className = 'btn-ghost notif-trigger';
      notifBtn.setAttribute('aria-label', 'الإشعارات');
      notifBtn.setAttribute('data-tip', 'الإشعارات');
      notifBtn.style.cssText = 'position:relative;width:40px;height:40px;border-radius:50%;';
      notifBtn.innerHTML = `<span style="font-size:1.1rem;">🔔</span>
        <span class="notif-badge" id="notif-badge" style="display:none;position:absolute;top:4px;right:4px;width:16px;height:16px;background:var(--accent);border-radius:50%;font-size:.6rem;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;">0</span>`;
      notifBtn.onclick = () => window.UQUNotifications?.togglePanel();

      const avatarBtn = document.createElement('button');
      avatarBtn.className = 'user-avatar-btn btn-ghost';
      avatarBtn.setAttribute('aria-label', 'قائمة المستخدم');
      avatarBtn.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 12px 4px 4px;border-radius:99px;border:1px solid var(--border-2);transition:border-color .2s;';
      const _av = session.avatar || makeAvatar(session.name);
      avatarBtn.innerHTML = `
        <div class="user-avatar-mini" style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:.85rem;flex-shrink:0;">${_av}</div>
        <span style="font-size:.85rem;font-weight:700;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(session.name || '').split(' ')[0]}</span>
        <span style="color:var(--muted);font-size:.7rem;">▼</span>`;

      const dropdown = document.createElement('div');
      dropdown.className = 'user-dropdown';
      dropdown.style.cssText = `
        position:absolute;top:calc(100% + 12px);left:0;right:auto;
        background:var(--surface-2);
        border:1px solid var(--border-2);
        border-radius:var(--r-lg);
        padding:8px;
        min-width:200px;
        box-shadow:var(--shadow-lg);
        z-index:500;
        display:none;
        animation:fadeInDown .2s ease;`;
      dropdown.innerHTML = `
        <div style="padding:10px 12px 12px;border-bottom:1px solid var(--border);margin-bottom:6px;">
          <div style="font-weight:800;font-size:.95rem;">${session.name}</div>
          <div style="color:var(--muted);font-size:.78rem;margin-top:2px;">${session.email}</div>
        </div>
        <a href="profile.html" class="dropdown-item" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--r-md);color:var(--fg);text-decoration:none;transition:background .15s;font-size:.88rem;font-weight:600;">
          <span>👤</span> الملف الشخصي
        </a>
        <a href="dashboard.html" class="dropdown-item" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--r-md);color:var(--fg);text-decoration:none;transition:background .15s;font-size:.88rem;font-weight:600;">
          <span>📊</span> لوحة المعلومات
        </a>
        <div style="height:1px;background:var(--border);margin:6px 0;"></div>
        <button onclick="UQUAuth.logout();" class="dropdown-item" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--r-md);color:var(--danger);background:none;border:none;width:100%;text-align:right;font-family:inherit;font-size:.88rem;font-weight:600;cursor:pointer;transition:background .15s;">
          <span>🚪</span> تسجيل الخروج
        </button>`;

      dropdown.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--surface)');
        item.addEventListener('mouseleave', () => item.style.background = '');
      });

      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative;';
      wrapper.appendChild(avatarBtn);
      wrapper.appendChild(dropdown);

      avatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display !== 'none';
        dropdown.style.display = isOpen ? 'none' : 'block';
      });

      document.addEventListener('click', () => { dropdown.style.display = 'none'; });

      actions.prepend(notifBtn);
      actions.prepend(wrapper);
    },
  };

  window.UQUAuth = UQUAuth;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => UQUAuth.injectHeaderUser());
  } else {
    UQUAuth.injectHeaderUser();
  }

})(window);
