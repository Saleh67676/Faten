/**
 * ================================================================
 * UQU NOTIFICATIONS v1.0 — Smart Academic Notification System
 * ================================================================
 * نظام إشعارات ذكي يتكامل مع البروفايل الأكاديمي
 * - مركز الإشعارات في الهيدر
 * - تنبيهات الاختبارات القادمة
 * - وضع الطوارئ الدراسية
 * - إشعارات التحفيز اليومية
 * ================================================================
 */

(function (window) {
  'use strict';

  const K = {
    NOTIFS:   'uqu_notifications',
    SEEN:     'uqu_notifs_seen',
    PANEL_ID: 'uqu-notif-panel',
  };

  /* ── Core Notification Object ─────────────────────── */
  const UQUNotifications = {

    /* Internal list */
    _list: [],
    _panelOpen: false,

    /* ── Init ──────────────────────────────────────── */
    init() {
      this._load();
      this._generateSmartNotifs();
      this._updateBadge();
      this._injectPanel();
      this._checkEmergencyMode();

      // Refresh every 10 minutes
      setInterval(() => {
        this._generateSmartNotifs();
        this._updateBadge();
      }, 10 * 60 * 1000);
    },

    /* ── Load from localStorage ─────────────────────── */
    _load() {
      try {
        this._list = JSON.parse(localStorage.getItem(K.NOTIFS) || '[]');
      } catch {
        this._list = [];
      }
    },

    /* ── Save ─────────────────────────────────────── */
    _save() {
      localStorage.setItem(K.NOTIFS, JSON.stringify(this._list));
    },

    /* ── Generate Smart Notifications ───────────────── */
    _generateSmartNotifs() {
      const academic = this._getAcademic();
      const courses  = this._getCourses();
      const session  = window.UQUAuth?.getSession();
      const today    = new Date();

      if (!session) return;

      const newNotifs = [];

      // 1. Welcome notification (first time)
      if (!this._has('welcome')) {
        newNotifs.push({
          id:      'welcome',
          type:    'success',
          icon:    '🎉',
          title:   `مرحباً بك ${session.name?.split(' ')[0] || ''}!`,
          body:    'تم إنشاء حسابك بنجاح. ابدأ بإعداد بروفايلك الأكاديمي.',
          time:    new Date().toISOString(),
          read:    false,
          link:    'profile.html',
          linkText:'إعداد البروفايل',
        });
      }

      // 2. Exam alerts
      courses.forEach(course => {
        if (!course.examDate || !course.name) return;
        const examDate = new Date(course.examDate + 'T00:00:00');
        const diffDays = Math.ceil((examDate - today) / 86400000);

        if (diffDays < 0 || diffDays > 14) return;

        const nid = `exam_${course.name}_${course.examDate}`;
        if (this._has(nid)) return;

        let type = 'info', icon = '📅', urgency = '';
        if (diffDays <= 1) { type = 'danger'; icon = '🚨'; urgency = 'غداً!'; }
        else if (diffDays <= 3) { type = 'warning'; icon = '⚠️'; urgency = `بعد ${diffDays} أيام`; }
        else if (diffDays <= 7) { type = 'info'; icon = '📅'; urgency = `بعد ${diffDays} أيام`; }
        else { type = 'info'; icon = '🗓️'; urgency = `بعد ${diffDays} يوماً`; }

        newNotifs.push({
          id:      nid,
          type,
          icon,
          title:   `اختبار: ${course.name}`,
          body:    `موعد الاختبار ${urgency} — ${course.examDate}`,
          time:    new Date().toISOString(),
          read:    false,
          link:    'plan.html',
          linkText:'عرض خطة المذاكرة',
          examDate: course.examDate,
          courseName: course.name,
        });
      });

      // 3. Profile incomplete alert
      if (!academic && !this._has('profile_incomplete')) {
        newNotifs.push({
          id:      'profile_incomplete',
          type:    'warning',
          icon:    '📋',
          title:   'بروفايلك الأكاديمي غير مكتمل',
          body:    'أكمل بروفايلك لتفعيل الخطط والتوصيات الذكية.',
          time:    new Date().toISOString(),
          read:    false,
          link:    'profile.html',
          linkText:'إكمال البروفايل',
        });
      }

      // 4. GPA motivation
      const gpa = parseFloat(academic?.gpaNow);
      const target = parseFloat(academic?.gpaTarget);
      if (gpa && target && !this._has('gpa_motivation')) {
        const diff = target - gpa;
        if (diff > 0 && diff <= 0.5) {
          newNotifs.push({
            id:      'gpa_motivation',
            type:    'success',
            icon:    '🎯',
            title:   'أنت قريب جداً من هدفك!',
            body:    `معدلك الحالي ${gpa.toFixed(2)} والهدف ${target.toFixed(2)} — فرق ${diff.toFixed(2)} فقط!`,
            time:    new Date().toISOString(),
            read:    false,
          });
        }
      }

      // 5. Daily motivational (once per day)
      const todayKey = `daily_${today.toDateString()}`;
      if (!this._has(todayKey)) {
        const messages = [
          { title: 'صباح التميز 🌅', body: 'كل يوم هو فرصة جديدة للتفوق. ابدأ يومك بخطوة نحو هدفك.' },
          { title: 'أنت تستطيع! 💪', body: 'الاجتهاد اليوم هو نجاح الغد. لا تستسلم أبداً.' },
          { title: 'ذاكر بذكاء 🧠', body: 'استخدم خطة المذاكرة الذكية لتحسين كفاءتك الدراسية.' },
          { title: 'تذكر هدفك 🎯', body: 'ضع هدفك نصب عينيك وامضِ قُدُماً. أنت أقرب مما تتصور.' },
          { title: 'استراحة ضرورية 😴', body: 'النوم الكافي يحسن الذاكرة والتركيز. حافظ على صحتك.' },
        ];
        const msg = messages[today.getDay() % messages.length];
        newNotifs.push({
          id:   todayKey,
          type: 'info',
          icon: '✨',
          title: msg.title,
          body:  msg.body,
          time:  new Date().toISOString(),
          read:  false,
          daily: true,
        });
      }

      // Add new notifs
      newNotifs.forEach(n => {
        if (!this._has(n.id)) {
          this._list.unshift(n);
        }
      });

      // Keep max 50 notifications
      this._list = this._list.slice(0, 50);
      this._save();
    },

    /* ── Check if notification exists ───────────────── */
    _has(id) {
      return this._list.some(n => n.id === id);
    },

    /* ── Unread count ────────────────────────────────── */
    _unreadCount() {
      return this._list.filter(n => !n.read).length;
    },

    /* ── Update badge ────────────────────────────────── */
    _updateBadge() {
      const count = this._unreadCount();
      const badge = document.getElementById('notif-badge');
      if (!badge) return;
      badge.style.display = count > 0 ? 'flex' : 'none';
      badge.textContent   = count > 9 ? '9+' : String(count);
    },

    /* ── Inject Notification Panel ───────────────────── */
    _injectPanel() {
      if (document.getElementById(K.PANEL_ID)) return;

      const panel = document.createElement('div');
      panel.id = K.PANEL_ID;
      panel.style.cssText = `
        position:fixed;
        top:68px;
        left:20px;
        width:360px;
        max-height:520px;
        background:var(--surface);
        border:1px solid var(--border-2);
        border-radius:var(--r-xl);
        box-shadow:var(--shadow-lg);
        z-index:600;
        display:none;
        flex-direction:column;
        overflow:hidden;
        animation:notifPanelIn .25s cubic-bezier(0.34,1.56,0.64,1);`;

      // Inject animation keyframe
      if (!document.getElementById('notif-styles')) {
        const style = document.createElement('style');
        style.id = 'notif-styles';
        style.textContent = `
          @keyframes notifPanelIn {
            from { opacity:0; transform:translateY(-12px) scale(.96); }
            to   { opacity:1; transform:translateY(0) scale(1); }
          }
          .notif-item { display:flex; gap:12px; padding:14px 16px; border-bottom:1px solid var(--border); transition:background .15s; cursor:pointer; text-decoration:none; color:var(--fg); }
          .notif-item:hover { background:var(--surface-2); }
          .notif-item.unread { background:var(--accent-dim); }
          .notif-icon { width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0; }
          .notif-icon.danger  { background:rgba(239,68,68,.12); }
          .notif-icon.warning { background:rgba(245,158,11,.12); }
          .notif-icon.success { background:rgba(16,185,129,.12); }
          .notif-icon.info    { background:var(--accent-dim); }
          .notif-title { font-size:.88rem; font-weight:700; margin-bottom:3px; }
          .notif-body  { font-size:.78rem; color:var(--muted); line-height:1.4; }
          .notif-time  { font-size:.7rem; color:var(--muted); margin-top:4px; }
          .notif-unread-dot { width:7px; height:7px; border-radius:50%; background:var(--accent); flex-shrink:0; margin-top:4px; }
          .emergency-banner { display:none; position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:linear-gradient(135deg,hsl(0,70%,50%),hsl(30,80%,45%)); color:#fff; border-radius:var(--r-lg); padding:14px 24px; box-shadow:var(--shadow-lg); z-index:500; animation:emergencyIn .4s cubic-bezier(0.34,1.56,0.64,1); cursor:pointer; max-width:90vw; }
          @keyframes emergencyIn { from{transform:translateX(-50%) translateY(100px);opacity:0} to{transform:translateX(-50%) translateY(0);opacity:1} }
          .emergency-banner.visible { display:flex; align-items:center; gap:14px; }`;
        document.head.appendChild(style);
      }

      panel.innerHTML = `
        <div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
          <div style="font-weight:800;font-size:.95rem;">🔔 الإشعارات</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button onclick="UQUNotifications.markAllRead()" style="background:none;border:none;color:var(--accent);font-size:.75rem;font-weight:700;cursor:pointer;font-family:inherit;padding:4px 8px;border-radius:6px;transition:background .15s;" onmouseover="this.style.background='var(--accent-dim)'" onmouseout="this.style.background='none'">قراءة الكل</button>
            <button onclick="UQUNotifications.closePanel()" style="background:none;border:none;color:var(--muted);font-size:1.1rem;cursor:pointer;padding:2px 6px;">✕</button>
          </div>
        </div>
        <div id="notif-list" style="overflow-y:auto;flex:1;"></div>
        <div style="padding:12px 16px;border-top:1px solid var(--border);text-align:center;">
          <button onclick="UQUNotifications.clearAll()" style="background:none;border:none;color:var(--muted);font-size:.75rem;cursor:pointer;font-family:inherit;transition:color .15s;" onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--muted)'">🗑️ مسح جميع الإشعارات</button>
        </div>`;

      document.body.appendChild(panel);
      document.addEventListener('click', (e) => {
        if (this._panelOpen && !panel.contains(e.target) && !e.target.closest('.notif-trigger')) {
          this.closePanel();
        }
      });
    },

    /* ── Render Panel ────────────────────────────────── */
    _renderPanel() {
      const list = document.getElementById('notif-list');
      if (!list) return;

      if (this._list.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:2.5rem;margin-bottom:10px;">🔕</div><div style="font-size:.88rem;">لا توجد إشعارات بعد.</div></div>`;
        return;
      }

      list.innerHTML = this._list.map(n => `
        <a class="notif-item ${!n.read ? 'unread' : ''}" onclick="UQUNotifications.markRead('${n.id}')" ${n.link ? `href="${n.link}"` : 'href="#"'}>
          <div class="notif-icon ${n.type}">${n.icon}</div>
          <div style="flex:1;min-width:0;">
            <div class="notif-title">${n.title}</div>
            <div class="notif-body">${n.body}</div>
            ${n.linkText ? `<div style="font-size:.72rem;color:var(--accent);font-weight:700;margin-top:4px;">${n.linkText} →</div>` : ''}
            <div class="notif-time">${this._timeAgo(n.time)}</div>
          </div>
          ${!n.read ? '<div class="notif-unread-dot"></div>' : ''}
        </a>`).join('');
    },

    /* ── Toggle Panel ────────────────────────────────── */
    togglePanel() {
      const panel = document.getElementById(K.PANEL_ID);
      if (!panel) return;
      this._panelOpen = !this._panelOpen;
      panel.style.display = this._panelOpen ? 'flex' : 'none';
      if (this._panelOpen) {
        this._renderPanel();
      }
    },

    /* ── Close Panel ─────────────────────────────────── */
    closePanel() {
      const panel = document.getElementById(K.PANEL_ID);
      if (panel) panel.style.display = 'none';
      this._panelOpen = false;
    },

    /* ── Mark notification as read ──────────────────── */
    markRead(id) {
      const notif = this._list.find(n => n.id === id);
      if (notif) notif.read = true;
      this._save();
      this._updateBadge();
    },

    /* ── Mark all as read ───────────────────────────── */
    markAllRead() {
      this._list.forEach(n => n.read = true);
      this._save();
      this._updateBadge();
      this._renderPanel();
    },

    /* ── Clear all ───────────────────────────────────── */
    clearAll() {
      this._list = [];
      this._save();
      this._updateBadge();
      this._renderPanel();
    },

    /* ── Add notification ────────────────────────────── */
    add(notif) {
      if (this._has(notif.id)) return;
      this._list.unshift({
        ...notif,
        time: new Date().toISOString(),
        read: false,
      });
      this._save();
      this._updateBadge();
      this._showToastNotif(notif);
    },

    /* ── Show toast-style notification ──────────────── */
    _showToastNotif(notif) {
      const toast = document.createElement('div');
      toast.style.cssText = `
        position:fixed;top:80px;left:20px;
        background:var(--surface-2);
        border:1px solid var(--border-2);
        border-right:3px solid var(--accent);
        border-radius:var(--r-md);
        padding:12px 16px;
        display:flex;align-items:flex-start;gap:10px;
        box-shadow:var(--shadow-lg);
        z-index:700;
        max-width:300px;
        animation:notifPanelIn .3s ease;
        cursor:pointer;`;

      toast.innerHTML = `
        <span style="font-size:1.2rem;flex-shrink:0;">${notif.icon}</span>
        <div>
          <div style="font-weight:700;font-size:.85rem;">${notif.title}</div>
          <div style="color:var(--muted);font-size:.76rem;margin-top:2px;">${notif.body}</div>
        </div>
        <button style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.9rem;flex-shrink:0;align-self:flex-start;" onclick="this.parentElement.remove()">✕</button>`;

      document.body.appendChild(toast);
      toast.addEventListener('click', () => { toast.remove(); if (notif.link) window.location.href = notif.link; });
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity .4s'; setTimeout(() => toast.remove(), 400); }, 5000);
    },

    /* ── Emergency Mode ──────────────────────────────── */
    _checkEmergencyMode() {
      const courses = this._getCourses();
      const today   = new Date();
      let nearestExam = null;
      let nearestDiff = Infinity;

      courses.forEach(c => {
        if (!c.examDate) return;
        const examDate = new Date(c.examDate + 'T00:00:00');
        const diff = Math.ceil((examDate - today) / 86400000);
        if (diff >= 0 && diff < nearestDiff) {
          nearestDiff = diff;
          nearestExam = { ...c, daysLeft: diff };
        }
      });

      if (!nearestExam || nearestDiff > 3) return;

      // Show emergency banner
      let banner = document.getElementById('emergency-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'emergency-banner';
        banner.className = 'emergency-banner visible';
        banner.innerHTML = `
          <div style="font-size:1.5rem;">🚨</div>
          <div>
            <div style="font-weight:900;font-size:.95rem;">وضع الطوارئ الدراسية!</div>
            <div style="font-size:.8rem;opacity:.9;">اختبار "${nearestExam.name}" ${nearestDiff === 0 ? 'اليوم!' : nearestDiff === 1 ? 'غداً!' : `بعد ${nearestDiff} أيام`}</div>
          </div>
          <a href="plan.html" style="background:rgba(255,255,255,.25);border:1px solid rgba(255,255,255,.4);border-radius:8px;padding:8px 16px;color:#fff;font-weight:800;font-size:.82rem;text-decoration:none;white-space:nowrap;transition:background .2s;" onmouseover="this.style.background='rgba(255,255,255,.35)'" onmouseout="this.style.background='rgba(255,255,255,.25)'">خطة طوارئ →</a>
          <button onclick="document.getElementById('emergency-banner').style.display='none'" style="background:none;border:none;color:rgba(255,255,255,.7);font-size:1.1rem;cursor:pointer;flex-shrink:0;">✕</button>`;
        document.body.appendChild(banner);
      }
    },

    /* ── Helpers ─────────────────────────────────────── */
    _getAcademic() {
      try { return JSON.parse(localStorage.getItem('uqu_profile_v2') || 'null'); }
      catch { return null; }
    },

    _getCourses() {
      // Read from actual profile courses (not draft key which only exists during form editing)
      try {
        const profile = JSON.parse(localStorage.getItem('uqu_profile_v2') || 'null');
        return profile?.courses || [];
      }
      catch { return []; }
    },

    _timeAgo(iso) {
      if (!iso) return '';
      const diff = Date.now() - new Date(iso).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1)  return 'للتو';
      if (m < 60) return `منذ ${m} دقيقة`;
      const h = Math.floor(m / 60);
      if (h < 24) return `منذ ${h} ساعة`;
      return `منذ ${Math.floor(h / 24)} يوم`;
    },
  };

  window.UQUNotifications = UQUNotifications;

  /* ── Auto-init on DOM ready ──────────────────────── */
  function tryInit() {
    if (window.UQUAuth?.isLoggedIn()) {
      UQUNotifications.init();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }

  // Re-init on auth change
  window.addEventListener('uqu:auth', (e) => {
    if (e.detail?.type === 'login' || e.detail?.type === 'register') {
      setTimeout(() => UQUNotifications.init(), 500);
    }
  });

})(window);
