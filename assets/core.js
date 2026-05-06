/**
 * ================================================================
 * UQU CORE v1.0 — Single Source of Truth
 * ================================================================
 *
 * كل مساعد مشترك في التطبيق يُعرَّف هنا مرة واحدة فقط:
 * · DOM helpers
 * · Storage (facade واحد فوق localStorage)
 * · Date & Time utilities (pad2، parseTime، formatTime، dayIndex)
 * · Profile accessor (يلغي نمط triple-fallback)
 * · Debounce / Throttle
 * · Event delegation
 * · Memoization
 * · DOM builder (يحلّ مشكلة innerHTML/createElement المنثورة)
 * · Performance helpers
 *
 * الاستخدام:
 *   const { $, $$, S, D, T, getProfile, html, debounce } = window.UQUCore;
 * ================================================================
 */

(function (window) {
  'use strict';

  // ────────────────────────────────────────────
  // 1. DOM SELECTORS
  // ────────────────────────────────────────────

  /** Single element. Returns null if not found (never throws). */
  function $(selector, ctx) {
    try { return (ctx || document).querySelector(selector); }
    catch { return null; }
  }

  /** All matching elements as a real Array. */
  function $$(selector, ctx) {
    try { return Array.from((ctx || document).querySelectorAll(selector)); }
    catch { return []; }
  }

  /** Get element by ID (fastest path). */
  function id(elementId) {
    return document.getElementById(elementId);
  }

  // ────────────────────────────────────────────
  // 2. STORAGE FACADE
  //    يلغي كل `localStorage.getItem` مباشر من app.js
  // ────────────────────────────────────────────

  const S = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v !== null ? JSON.parse(v) : fallback;
      } catch { return fallback; }
    },

    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },

    remove(key) { localStorage.removeItem(key); },

    update(key, patcher, fallback) {
      const current = this.get(key, fallback);
      const next    = patcher(current);
      this.set(key, next);
      return next;
    }
  };

  // Storage key registry (единственный источник истины)
  const KEYS = {
    PROFILE: 'uqu_profile_v2',
    PLAN:    'uqu_plan_v5',
    GPA:     'uqu_gpa_v1',
    TASKS:   'uqu_tasks_v1',
    THEME:   'uqu_theme'
  };

  // ────────────────────────────────────────────
  // 3. PROFILE ACCESSOR
  //    الحل الدائم لنمط triple-fallback المتكرر في 5 أماكن
  // ────────────────────────────────────────────

  function getProfile() {
    // المصدر الأول: UQUActions (إذا محمّل)
    if (window.UQUActions?.getProfile) {
      const p = window.UQUActions.getProfile();
      if (p) return p;
    }
    // المصدر الثاني: UQUModel reactive store
    if (window.UQUModel?.getProfile) {
      const p = window.UQUModel.getProfile();
      if (p) return p;
    }
    // المصدر الثالث: localStorage مباشر
    return S.get(KEYS.PROFILE, null);
  }

  function getPlan() {
    if (window.UQUModel?.getPlan) return window.UQUModel.getPlan();
    return S.get(KEYS.PLAN, { plan: [], tasks: [], slots: [] });
  }

  function getGPA() {
    if (window.UQUModel?.getGPA) return window.UQUModel.getGPA();
    return S.get(KEYS.GPA, { courses: [] });
  }

  // ────────────────────────────────────────────
  // 4. DATE & TIME UTILITIES
  //    تُعرَّف مرة واحدة هنا — تُحذف من app.js و engine.js تدريجياً
  // ────────────────────────────────────────────

  const D = {
    /**
     * يضيف صفراً إذا كان الرقم أحادي الرقم.
     * كانت معرّفة في ChatController AND initPlanPage AND خارجهما — الآن هنا فقط.
     */
    pad(n) { return String(n).padStart(2, '0'); },

    /** Date → 'YYYY-MM-DD' */
    toISO(d) {
      if (!d) return null;
      const dt = d instanceof Date ? d : new Date(d);
      if (isNaN(dt)) return null;
      return `${dt.getFullYear()}-${this.pad(dt.getMonth() + 1)}-${this.pad(dt.getDate())}`;
    },

    /** 'YYYY-MM-DD' → Date at midnight local */
    fromISO(isoStr) {
      return isoStr ? new Date(isoStr + 'T00:00:00') : null;
    },

    /** Today at midnight */
    today() {
      const d = new Date(); d.setHours(0, 0, 0, 0); return d;
    },

    /** Days between isoDate and today (positive = future) */
    daysUntil(isoDate) {
      if (!isoDate) return null;
      return Math.round((this.fromISO(isoDate) - this.today()) / 86400000);
    },

    /** Add N days to a Date */
    addDays(d, n) {
      const r = new Date(d); r.setDate(r.getDate() + n); return r;
    },

    /** 'HH:MM' → minutes since midnight */
    parseTime(t) {
      if (!t) return 0;
      const [h, m] = t.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    },

    /** Minutes since midnight → 'HH:MM' */
    formatTime(mins) {
      mins = Math.max(0, mins);
      return `${this.pad(Math.floor(mins / 60) % 24)}:${this.pad(mins % 60)}`;
    },

    /** Duration in minutes between two 'HH:MM' strings */
    duration(from, to) {
      const d = this.parseTime(to) - this.parseTime(from);
      return d > 0 ? d : 0;
    },

    /** Upcoming Sunday date */
    nextSunday() {
      const d  = new Date();
      const diff = (7 - d.getDay()) % 7;
      d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
      d.setHours(0, 0, 0, 0);
      return d;
    },

    /**
     * Arabic day name → day-of-week index (0=Sunday).
     * كانت معرّفة في ChatController (1246) و initPlanPage (2097) و engine.js (67) — الآن هنا فقط.
     */
    DAY_INDEX: Object.freeze({
      'الأحد': 0, 'الاحد': 0,
      'الإثنين': 1, 'الاثنين': 1,
      'الثلاثاء': 2,
      'الأربعاء': 3, 'الاربعاء': 3,
      'الخميس': 4,
      'الجمعة': 5,
      'السبت': 6
    }),

    DAY_NAMES: Object.freeze([
      'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'
    ]),

    /** Date → Arabic day name */
    dayName(d) {
      return this.DAY_NAMES[(d instanceof Date ? d : new Date(d)).getDay()];
    },

    /** Get the next occurrence of an Arabic day name */
    nextWeekday(dayName) {
      const target = this.DAY_INDEX[dayName];
      if (target === undefined) return this.today();
      const today   = this.today();
      let diff = target - today.getDay();
      if (diff <= 0) diff += 7;
      return this.addDays(today, diff);
    },

    /** {start, end} ISO strings for a week (offset 0 = current week) */
    weekRange(offset) {
      const start = this.today();
      start.setDate(start.getDate() - start.getDay() + (offset || 0) * 7);
      return { start: this.toISO(start), end: this.toISO(this.addDays(start, 6)) };
    },

    /** Format date for display (Arabic locale) */
    display(isoOrDate, opts) {
      const d = isoOrDate instanceof Date ? isoOrDate : this.fromISO(isoOrDate);
      if (!d || isNaN(d)) return '';
      return d.toLocaleDateString('ar-SA', opts || { weekday: 'long', month: 'short', day: 'numeric' });
    }
  };

  // ────────────────────────────────────────────
  // 5. PERFORMANCE HELPERS
  // ────────────────────────────────────────────

  const T = {
    /**
     * Debounce: delay execution until after `wait` ms of silence.
     * يلغي debounce المعرّف في Utils داخل app.js.
     */
    debounce(fn, wait) {
      let timer;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
      };
    },

    /**
     * Throttle: run at most once per `limit` ms.
     */
    throttle(fn, limit) {
      let last = 0;
      return function (...args) {
        const now = Date.now();
        if (now - last >= limit) { last = now; fn.apply(this, args); }
      };
    },

    /**
     * Memoize: cache return value by first argument (JSON key).
     * مفيد لحساب المعدل وعمليات إعادة الترتيب.
     */
    memoize(fn, ttl) {
      const cache = new Map();
      return function (arg) {
        const k = JSON.stringify(arg);
        const hit = cache.get(k);
        if (hit && (!ttl || Date.now() - hit.ts < ttl)) return hit.v;
        const v = fn.call(this, arg);
        cache.set(k, { v, ts: Date.now() });
        return v;
      };
    },

    /**
     * RAF batch: collect microtasks and flush in one paint.
     */
    raf(fn) { return requestAnimationFrame(fn); }
  };

  // ────────────────────────────────────────────
  // 6. DOM BUILDER
  //    بديل مُصمَّم لـ document.createElement + inline styles المنثورة
  //    في أكثر من 67 موضع في app.js
  // ────────────────────────────────────────────

  /**
   * Build a DOM element from a descriptor.
   *
   * @example
   * html('div', { class:'card', style:{ padding:'16px' } }, [
   *   html('h3', {}, 'Hello'),
   *   html('p', { class:'muted' }, 'World')
   * ])
   */
  function html(tag, attrs, children) {
    const el = document.createElement(tag);

    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class')    { el.className = v; }
        else if (k === 'style' && typeof v === 'object') {
          Object.assign(el.style, v);
        } else if (k.startsWith('on') && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== null && v !== undefined && v !== false) {
          el.setAttribute(k, v);
        }
      });
    }

    if (children !== undefined) {
      const items = Array.isArray(children) ? children : [children];
      items.forEach(child => {
        if (child == null) return;
        el.appendChild(
          typeof child === 'string' ? document.createTextNode(child) : child
        );
      });
    }

    return el;
  }

  /**
   * Minimal template literal → DocumentFragment.
   * مفيد للأجزاء التي تحتاج HTML كامل.
   */
  function frag(htmlString) {
    const t = document.createElement('template');
    t.innerHTML = htmlString.trim();
    return t.content.cloneNode(true);
  }

  // ────────────────────────────────────────────
  // 7. EVENT DELEGATION
  //    يُقلل عدد listeners المفردة
  // ────────────────────────────────────────────

  /**
   * Attach a delegated listener on `parent` for `selector`.
   * Returns an unsubscribe function.
   *
   * @example
   * const off = delegate(document, 'click', '.suggestion-pill', handler);
   */
  function delegate(parent, event, selector, handler) {
    function listener(e) {
      const target = e.target.closest(selector);
      if (target && parent.contains(target)) handler.call(target, e, target);
    }
    parent.addEventListener(event, listener);
    return () => parent.removeEventListener(event, listener);
  }

  // ────────────────────────────────────────────
  // 8. INTERSECTION OBSERVER HELPER
  //    animate-block reveal (يوحّد initScrollObserver)
  // ────────────────────────────────────────────

  let _revealObserver = null;

  function observeReveal(selector, rootMargin) {
    const reduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // With reduced motion (or no IntersectionObserver), reveal everything
    // immediately. Don't gate content on animations the user opted out of.
    if (reduced || typeof IntersectionObserver === 'undefined') {
      $$(selector || '.animate-block').forEach(el => {
        el.classList.add('animate-in');
        el.style.opacity = '';
        el.style.transform = '';
      });
      return;
    }

    if (!_revealObserver) {
      _revealObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('animate-in');
            _revealObserver.unobserve(e.target);
          }
        });
      }, { threshold: 0.08, rootMargin: rootMargin || '0px 0px -40px 0px' });
    }

    const vh = window.innerHeight || document.documentElement.clientHeight;
    $$(selector || '.animate-block').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'opacity 0.55s cubic-bezier(0.4,0,0.2,1), transform 0.55s cubic-bezier(0.4,0,0.2,1)';

      // Synchronous fallback: if the element is already in the initial
      // viewport, reveal it on the next frame regardless of whether the
      // IntersectionObserver fires (some browsers/contexts delay or skip
      // the first batch). The observer still handles off-screen elements.
      const r = el.getBoundingClientRect();
      const inViewport = r.bottom > 0 && r.top < vh && r.width > 0 && r.height > 0;
      if (inViewport) {
        requestAnimationFrame(() => el.classList.add('animate-in'));
      } else {
        _revealObserver.observe(el);
      }
    });
  }

  // ────────────────────────────────────────────
  // 9. TOAST (centralised — one implementation)
  // ────────────────────────────────────────────

  let _toastContainer = null;

  function toast(message, type, duration) {
    if (!_toastContainer) {
      _toastContainer = html('div', {
        id: 'app-toast',
        style: {
          position: 'fixed', bottom: '20px', left: '50%',
          transform: 'translateX(-50%)', zIndex: '9999',
          pointerEvents: 'none', display: 'flex',
          flexDirection: 'column', gap: '10px',
          alignItems: 'center'
        }
      });
      document.body.appendChild(_toastContainer);
    }

    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#6366f1' };
    const bg = colors[type] || colors.info;

    const el = html('div', {
      style: {
        background: bg, color: '#fff',
        padding: '12px 24px', borderRadius: '50px',
        fontFamily: 'Cairo, sans-serif', fontWeight: '700',
        fontSize: '.9rem', boxShadow: '0 10px 30px rgba(0,0,0,.25)',
        opacity: '0', transform: 'translateY(20px)',
        transition: 'all .3s cubic-bezier(.175,.885,.32,1.275)',
        pointerEvents: 'auto', whiteSpace: 'nowrap'
      }
    }, message);

    _toastContainer.appendChild(el);
    T.raf(() => { T.raf(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; }); });

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      setTimeout(() => el.remove(), 350);
    }, duration || 3000);
  }

  // ────────────────────────────────────────────
  // 10. THEME MANAGER (single implementation)
  // ────────────────────────────────────────────

  const Theme = {
    set(mode) {
      document.body.setAttribute('data-theme', mode);
      S.set(KEYS.THEME, mode);
    },
    get() { return document.body.getAttribute('data-theme') || S.get(KEYS.THEME, 'auto'); },
    toggle() {
      const next = this.get() === 'dark' ? 'light' : 'dark';
      this.set(next);
      toast(next === 'dark' ? '🌙 الوضع الليلي' : '☀️ الوضع النهاري', 'info', 1800);
      return next;
    },
    init() {
      this.set(S.get(KEYS.THEME, 'auto'));
      const btn = id('themeToggle');
      if (btn) btn.addEventListener('click', () => this.toggle());
    }
  };

  // ────────────────────────────────────────────
  // 11. HEADER SCROLL EFFECT (single implementation)
  // ────────────────────────────────────────────

  function initHeaderScroll() {
    const header = $('header.app-header');
    if (!header) return;
    window.addEventListener('scroll', T.throttle(() => {
      header.classList.toggle('scrolled', window.scrollY > 10);
    }, 80), { passive: true });
  }

  // ────────────────────────────────────────────
  // 12. MOBILE NAV
  // ────────────────────────────────────────────

  function initMobileNav() {
    const toggle = $('.nav-toggle');
    const menu   = id('main-menu');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      menu.classList.toggle('active', !open);
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (!toggle.contains(e.target) && !menu.contains(e.target)) {
        toggle.setAttribute('aria-expanded', 'false');
        menu.classList.remove('active');
      }
    });
  }

  // ────────────────────────────────────────────
  // 13. YEAR STAMP
  // ────────────────────────────────────────────

  function stampYear() {
    $$(  '#year, .year-stamp').forEach(el => {
      el.textContent = new Date().getFullYear();
    });
  }

  // ────────────────────────────────────────────
  // 14. ARABIC TEXT NORMALIZER
  // ────────────────────────────────────────────

  function normalizeAr(text) {
    if (!text) return '';
    return text
      .replace(/[\u0617-\u061A\u064B-\u0652]/g, '')
      .replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/ابي|ابغا|ابغى/g, 'ابغى').replace(/بكره/g, 'بكرا')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // ────────────────────────────────────────────
  // 15. GRADE SCALE (single source, was split across actions.js + engine.js)
  // ────────────────────────────────────────────

  const GRADE_SCALE = Object.freeze({
    'A+': 4.00, 'A': 4.00, 'A-': 3.67,
    'B+': 3.33, 'B': 3.00, 'B-': 2.67,
    'C+': 2.33, 'C': 2.00, 'C-': 1.67,
    'D+': 1.33, 'D': 1.00, 'D-': 0.67,
    'F':  0.00
  });

  function scoreToGrade(s) {
    s = parseFloat(s);
    if (isNaN(s)) return 'F';
    if (s >= 95) return 'A+'; if (s >= 90) return 'A';  if (s >= 85) return 'A-';
    if (s >= 80) return 'B+'; if (s >= 75) return 'B';  if (s >= 70) return 'B-';
    if (s >= 65) return 'C+'; if (s >= 60) return 'C';  if (s >= 55) return 'C-';
    if (s >= 50) return 'D';  return 'F';
  }

  function scoreToPoints(s) { return GRADE_SCALE[scoreToGrade(s)] ?? 0; }

  // ────────────────────────────────────────────
  // 16. GPA CALCULATOR (memoized, single impl.)
  //    كانت موزعة بين engine.js و actions.js
  // ────────────────────────────────────────────

  const calcGPA = T.memoize(function ({ prev, earned, termCourses, planHours }) {
    let pts = 0, hrs = 0;
    for (const c of (termCourses || [])) {
      const p = c.gradePoints ?? scoreToPoints(c.score ?? 0);
      const h = parseFloat(c.creditHours) || 0;
      if (!h) continue;
      pts += p * h; hrs += h;
    }
    const termGpa     = hrs ? pts / hrs : 0;
    const totalEarned = (earned || 0) + hrs;
    const allPts      = (prev || 0) * (earned || 0) + pts;
    const newGpa      = totalEarned ? allPts / totalEarned : 0;
    return {
      newGpa:       +Math.min(5, newGpa).toFixed(4),
      termGpa:      +Math.min(5, termGpa).toFixed(4),
      termHours:    hrs,
      totalEarned,
      remaining:    Math.max(0, (planHours || 130) - totalEarned)
    };
  }, 2000); // 2-second TTL so rapid keystrokes don't thrash

  // ────────────────────────────────────────────
  // 17. BACKEND API CLIENT (single source of truth)
  //     Replaces the _getBackendBase / _getIdToken pattern duplicated
  //     in ai.js, engine.js, plan-generator.js, ai-service.js,
  //     pomodoro.js, notifications.js, firebase-db.js, app.js.
  // ────────────────────────────────────────────

  /**
   * Wait for Firebase auth state to settle. Without this, calls fired
   * during page-load race conditions get a null token and the backend
   * rejects them with 401.
   */
  async function _waitForAuth(timeoutMs) {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;
    const auth = firebase.auth();
    if (auth.currentUser) return auth.currentUser;
    return new Promise(resolve => {
      const t = setTimeout(() => { try { unsub(); } catch(_) {} resolve(auth.currentUser || null); }, timeoutMs || 1500);
      const unsub = auth.onAuthStateChanged(user => {
        clearTimeout(t);
        try { unsub(); } catch(_) {}
        resolve(user);
      });
    });
  }

  const api = {
    baseUrl() { return window.AGENT_BASE_URL || 'http://localhost:8000'; },

    /** Get a Firebase ID token from any available source. Null if not signed in. */
    async getToken() {
      try {
        if (typeof firebase !== 'undefined' && firebase.auth) {
          const auth = firebase.auth();
          // First call waits for auth to settle (avoids 401 race on page load).
          let u = auth.currentUser;
          if (u === null || u === undefined) u = await _waitForAuth(1500);
          if (u && typeof u.getIdToken === 'function') return await u.getIdToken();
        }
      } catch (_) { /* fall through */ }
      if (window.FirebaseAuth?.getIdToken) {
        try { return await window.FirebaseAuth.getIdToken(); } catch (_) {}
      }
      if (window.FirebaseDB?.getIdToken) {
        try { return await window.FirebaseDB.getIdToken(); } catch (_) {}
      }
      return null;
    },

    /**
     * Generic fetch wrapper. Accepts the same options as fetch() plus:
     *   - body: object → auto-JSON-stringified
     *   - skipAuth: true → don't attach the Bearer header
     */
    async fetch(path, options) {
      options = options || {};
      const url = path.startsWith('http') ? path : (this.baseUrl() + path);
      const token = options.skipAuth ? null : await this.getToken();
      const init = {
        method: options.method || 'GET',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          options.headers || {},
          token ? { 'Authorization': 'Bearer ' + token } : {}
        )
      };
      if (options.body !== undefined) {
        init.body = typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body);
      }
      if (options.signal) init.signal = options.signal;
      return fetch(url, init);
    },

    /** POST JSON, return parsed response. Throws on !ok with backend `detail`. */
    async post(path, body, opts) {
      const res = await this.fetch(path, Object.assign({}, opts, { method: 'POST', body }));
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const e = new Error(err?.detail || ('HTTP ' + res.status));
        e.status = res.status;
        throw e;
      }
      return res.json();
    },

    /** GET JSON, return parsed response. Throws on !ok with backend `detail`. */
    async get(path, opts) {
      const res = await this.fetch(path, Object.assign({}, opts, { method: 'GET' }));
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const e = new Error(err?.detail || ('HTTP ' + res.status));
        e.status = res.status;
        throw e;
      }
      return res.json();
    },

    /** POST JSON, return success boolean (no throw). Used for fire-and-forget syncs. */
    async tryPost(path, body, opts) {
      try {
        const res = await this.fetch(path, Object.assign({}, opts, { method: 'POST', body }));
        return res.ok;
      } catch (_) {
        return false;
      }
    }
  };

  // ────────────────────────────────────────────
  // 18. EXPOSE
  // ────────────────────────────────────────────

  const UQUCore = Object.freeze({
    // Selectors
    $, $$, id,

    // Storage
    S, KEYS,

    // Profile accessors
    getProfile, getPlan, getGPA,

    // Date utilities
    D,

    // Performance
    T,

    // DOM builder
    html, frag,

    // Events
    delegate,

    // Scroll reveals
    observeReveal,

    // Notifications
    toast,

    // Theme
    Theme,

    // Layout helpers
    initHeaderScroll,
    initMobileNav,
    stampYear,

    // Arabic
    normalizeAr,

    // Grades
    GRADE_SCALE, scoreToGrade, scoreToPoints, calcGPA,

    // Backend HTTP client
    api
  });

  window.UQUCore = UQUCore;

  // ── Backward-compat aliases ──
  // app.js uses Utils.$ / Utils.$$ / Utils.Storage / Utils.debounce
  // Shim them to core so no changes needed in app.js body yet
  window.Utils = window.Utils || {
    $:       $,
    $$:      $$,
    Storage: S,
    debounce:T.debounce,
    random:  (min, max) => Math.floor(Math.random() * (max - min + 1) + min),
    createElement(tag, cls, text) {
      return html(tag, cls ? { class: cls } : {}, text || undefined);
    }
  };


})(window);
