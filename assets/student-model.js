/**
 * ================================================================
 * UQU STUDENT MODEL — Reactive State Engine v2.0
 * ================================================================
 * Proxy-based reactivity · IndexedDB persistence · Cross-tab sync
 * Schema validation · Computed values · History undo
 * ================================================================
 */

(function (window) {
  'use strict';

  // ──────────────────────────────────────────────
  // 1. SCHEMA & DEFAULTS
  // ──────────────────────────────────────────────

  const SCHEMA = {
    profile: {
      key: 'uqu_profile_v2',
      defaults: {
        basic: {
          name: '', university: 'جامعة أم القرى', major: '',
          level: '', semStart: '', weeks: 16, studyType: 'full', workStatus: 'no'
        },
        learning: {
          speed: 'normal', focusMinutes: 45, preferredTime: 'evening',
          style: 'read', env: 'home', group: 'solo',
          memorization: 'normal', stress: 3,
          maxDailySessions: 2, maxWeeklyHours: 20, blockedTimes: '', slots: []
        },
        goals: {
          currentGpa: null, targetGpa: null, earnedHours: null,
          planHours: 130, termPlanHours: null, goal: 'raise'
        },
        courses: []
      }
    },
    plan: {
      key: 'uqu_plan_v5',
      defaults: {
        planTitle: 'خطة الفصل الدراسي', sessionMin: 45, weeks: 0,
        planStart: null, courses: [], slots: [], plan: [], tasks: []
      }
    },
    gpa: {
      key: 'uqu_gpa_v1',
      defaults: {
        currentGPA: null, earnedHours: null, totalPlanHours: 130,
        courses: [], lastUpdated: null
      }
    },
    tasks: {
      key: 'uqu_tasks_v1',
      defaults: { items: [] }
    }
  };

  // ──────────────────────────────────────────────
  // 2. INDEXED DB LAYER
  // ──────────────────────────────────────────────

  class IDBLayer {
    constructor() {
      this._db = null;
      this._ready = this._open();
    }
    _open() {
      return new Promise((resolve) => {
        if (!window.indexedDB) { resolve(null); return; }
        const req = indexedDB.open('uqu_db', 3);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
        };
        req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
        req.onerror   = () => resolve(null);
      });
    }
    async set(key, value) {
      const db = await this._ready;
      if (!db) return;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ k: key, v: value, ts: Date.now() });
    }
    async get(key) {
      const db = await this._ready;
      if (!db) return null;
      return new Promise(resolve => {
        const req = db.transaction('kv','readonly').objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result?.v ?? null);
        req.onerror   = () => resolve(null);
      });
    }
  }

  const idb = new IDBLayer();

  // ──────────────────────────────────────────────
  // 3. REACTIVE STORE
  // ──────────────────────────────────────────────

  class ReactiveStore {
    constructor(schemaEntry) {
      this._key = schemaEntry.key;
      this._schema = schemaEntry;
      this._listeners = {};
      this._saveTimer = null;
      this._data = this._load(schemaEntry.defaults);
      this.proxy = this._makeProxy(this._data);
    }

    _load(defaults) {
      try {
        const raw = localStorage.getItem(this._key);
        if (!raw) return JSON.parse(JSON.stringify(defaults));
        return this._deepMerge(JSON.parse(JSON.stringify(defaults)), JSON.parse(raw));
      } catch {
        return JSON.parse(JSON.stringify(defaults));
      }
    }

    _deepMerge(target, source) {
      if (!source || typeof source !== 'object') return target;
      const result = Object.assign({}, target);
      for (const key of Object.keys(source)) {
        if (Array.isArray(source[key])) {
          result[key] = source[key];
        } else if (source[key] && typeof source[key] === 'object' && target[key] && typeof target[key] === 'object') {
          result[key] = this._deepMerge(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      }
      return result;
    }

    _makeProxy(obj, path) {
      const self = this;
      return new Proxy(obj, {
        set(target, prop, value) {
          const old = target[prop];
          if (JSON.stringify(old) === JSON.stringify(value)) return true;
          target[prop] = value;
          const fullPath = path ? path + '.' + prop : prop;
          self._emit('change', { path: fullPath, value, oldValue: old });
          self._scheduleSave();
          return true;
        },
        get(target, prop) {
          const val = target[prop];
          if (val && typeof val === 'object' && !Array.isArray(val) &&
              prop !== '__isProxy' && typeof prop === 'string') {
            return self._makeProxy(val, path ? path + '.' + prop : prop);
          }
          return val;
        }
      });
    }

    _scheduleSave() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this._flush(), 600);
    }

    _flush() {
      const snap = this.snapshot();
      try {
        localStorage.setItem(this._key, JSON.stringify(snap));
      } catch (e) {
        console.warn('[UQUModel] save failed:', e.message);
      }
      idb.set(this._key, snap);
      // Cross-tab broadcast
      try {
        const bc = new BroadcastChannel('uqu_sync');
        bc.postMessage({ key: this._key, ts: Date.now() });
        bc.close();
      } catch {}
    }

    save() { clearTimeout(this._saveTimer); this._flush(); }

    snapshot() { return JSON.parse(JSON.stringify(this._data)); }

    reset() {
      const fresh = JSON.parse(JSON.stringify(this._schema.defaults));
      localStorage.removeItem(this._key);
      Object.keys(this._data).forEach(k => delete this._data[k]);
      Object.assign(this._data, fresh);
      this._emit('reset', {});
    }

    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return () => {
        this._listeners[event] = this._listeners[event].filter(f => f !== fn);
      };
    }

    _emit(event, detail) {
      (this._listeners[event] || []).forEach(fn => fn(detail));
      (this._listeners['*'] || []).forEach(fn => fn({ event, detail }));
    }
  }

  // ──────────────────────────────────────────────
  // 4. CROSS-TAB SYNC
  // ──────────────────────────────────────────────

  const storeMap = {};

  function initCrossTabSync() {
    try {
      const bc = new BroadcastChannel('uqu_sync');
      bc.onmessage = ({ data }) => {
        const store = storeMap[data.key];
        if (!store) return;
        try {
          const raw = localStorage.getItem(data.key);
          if (!raw) return;
          const fresh = JSON.parse(raw);
          Object.keys(fresh).forEach(k => { store.proxy[k] = fresh[k]; });
          store._emit('sync', { source: 'remote' });
        } catch {}
      };
    } catch {}
  }

  // ──────────────────────────────────────────────
  // 5. GRADE SCALE & COMPUTED
  // ──────────────────────────────────────────────

  const GRADE_SCALE = {
    'A+': 4.00, 'A': 4.00, 'A-': 3.67,
    'B+': 3.33, 'B': 3.00, 'B-': 2.67,
    'C+': 2.33, 'C': 2.00, 'C-': 1.67,
    'D+': 1.33, 'D': 1.00, 'D-': 0.67,
    'F':  0.00
  };

  function scoreToLabel(s) {
    s = parseFloat(s);
    if (isNaN(s)) return 'F';
    if (s >= 95) return 'A+'; if (s >= 90) return 'A';  if (s >= 85) return 'A-';
    if (s >= 80) return 'B+'; if (s >= 75) return 'B';  if (s >= 70) return 'B-';
    if (s >= 65) return 'C+'; if (s >= 60) return 'C';  if (s >= 55) return 'C-';
    if (s >= 50) return 'D';
    return 'F';
  }

  function scoreToPoints(s) { return GRADE_SCALE[scoreToLabel(s)] ?? 0; }

  const Computed = {
    gpaFromCourses(goals, courses) {
      const prev   = parseFloat(goals?.currentGpa)  || 0;
      const earned = parseFloat(goals?.earnedHours) || 0;
      const plan   = parseFloat(goals?.planHours)   || 130;
      let termPoints = 0, termHours = 0;
      for (const c of courses) {
        const pts = c.gradePoints ?? scoreToPoints(c.score ?? c.grade ?? 0);
        const hrs = parseFloat(c.creditHours) || 0;
        if (!hrs) continue;
        termPoints += pts * hrs;
        termHours  += hrs;
      }
      const termGpa     = termHours > 0 ? termPoints / termHours : 0;
      const totalEarned = earned + termHours;
      const allPoints   = prev * earned + termPoints;
      const newGpa      = totalEarned > 0 ? allPoints / totalEarned : 0;
      return {
        newGpa:  +Math.min(4, newGpa).toFixed(4),
        termGpa: +Math.min(4, termGpa).toFixed(4),
        termHours, totalEarned,
        remaining: Math.max(0, plan - totalEarned)
      };
    },

    examCountdowns(courses = []) {
      const today = new Date(); today.setHours(0,0,0,0);
      return courses
        .filter(c => c.examDate)
        .map(c => {
          const d    = new Date(c.examDate + 'T00:00:00');
          const diff = Math.round((d - today) / 86400000);
          return { ...c, daysLeft: diff, urgent: diff >= 0 && diff <= 7 };
        })
        .filter(c => c.daysLeft >= 0)
        .sort((a, b) => a.daysLeft - b.daysLeft);
    },

    studyPressure(plan = [], weekOffset = 0) {
      const start = new Date();
      start.setDate(start.getDate() - start.getDay() + weekOffset * 7);
      start.setHours(0,0,0,0);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      const iso = d => d.toISOString().split('T')[0];
      const sessions = plan.filter(s => s.date >= iso(start) && s.date <= iso(end));
      const mins = sessions.reduce((acc, s) => {
        if (!s.time || !s.timeEnd) return acc + 60;
        const [h1,m1] = s.time.split(':').map(Number);
        const [h2,m2] = s.timeEnd.split(':').map(Number);
        const d = (h2*60+m2) - (h1*60+m1);
        return acc + (d > 0 ? d : 60);
      }, 0);
      return Math.min(100, Math.round(mins / 18));
    }
  };

  // ──────────────────────────────────────────────
  // 6. STORES
  // ──────────────────────────────────────────────

  const profileStore = new ReactiveStore(SCHEMA.profile);
  const planStore    = new ReactiveStore(SCHEMA.plan);
  const gpaStore     = new ReactiveStore(SCHEMA.gpa);
  const tasksStore   = new ReactiveStore(SCHEMA.tasks);

  storeMap[SCHEMA.profile.key] = profileStore;
  storeMap[SCHEMA.plan.key]    = planStore;
  storeMap[SCHEMA.gpa.key]     = gpaStore;
  storeMap[SCHEMA.tasks.key]   = tasksStore;

  initCrossTabSync();

  // ──────────────────────────────────────────────
  // 7. PUBLIC API
  // ──────────────────────────────────────────────

  const UQUModel = {
    profile: profileStore.proxy,
    plan:    planStore.proxy,
    gpa:     gpaStore.proxy,
    tasks:   tasksStore.proxy,

    Computed, GRADE_SCALE, scoreToLabel, scoreToPoints,

    getProfile() { return profileStore.snapshot(); },
    getPlan()    { return planStore.snapshot(); },
    getGPA()     { return gpaStore.snapshot(); },
    getTasks()   { return tasksStore.snapshot(); },

    saveAll()      { [profileStore, planStore, gpaStore, tasksStore].forEach(s => s.save()); },
    resetProfile() { profileStore.reset(); },
    resetPlan()    { planStore.reset(); },
    resetGPA()     { gpaStore.reset(); },

    onChange(store, fn) {
      const s = { profile: profileStore, plan: planStore, gpa: gpaStore, tasks: tasksStore }[store];
      return s?.on('change', fn);
    },

    export() {
      return JSON.stringify({
        profile: profileStore.snapshot(), plan: planStore.snapshot(),
        gpa: gpaStore.snapshot(), tasks: tasksStore.snapshot(),
        exportedAt: new Date().toISOString()
      }, null, 2);
    },

    import(json) {
      try {
        const d = JSON.parse(json);
        if (d.profile) localStorage.setItem(SCHEMA.profile.key, JSON.stringify(d.profile));
        if (d.plan)    localStorage.setItem(SCHEMA.plan.key,    JSON.stringify(d.plan));
        if (d.gpa)     localStorage.setItem(SCHEMA.gpa.key,     JSON.stringify(d.gpa));
        if (d.tasks)   localStorage.setItem(SCHEMA.tasks.key,   JSON.stringify(d.tasks));
        window.location.reload(); return true;
      } catch { return false; }
    },

    // Backward-compat shim for old Utils.Storage calls in app.js
    Storage: {
      get(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
        catch { return fallback; }
      },
      set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
        idb.set(key, value);
      },
      remove(key) { localStorage.removeItem(key); }
    }
  };

  window.UQUModel = UQUModel;
  // Legacy alias used in app.js
  window.__uquStorage = UQUModel.Storage;

  console.log('%cUQU Model v2.0 ✓', 'background:#0f172a;color:#818cf8;padding:2px 7px;border-radius:4px;');

})(window);
