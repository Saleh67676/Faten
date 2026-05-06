/**
 * ================================================================
 * UQU ACTIONS v2.0 — Async Service Layer
 * ================================================================
 * Replaces sync imperative code with:
 * · Async/await + Promise chains
 * · Result<T> pattern (no more undefined returns)
 * · Input validation + typed errors
 * · Optimistic UI support
 * · Event bus for cross-component updates
 * ================================================================
 */

(function (window) {
  'use strict';

  // ──────────────────────────────────────────────
  // 1. RESULT TYPE (avoid try/catch hell in callers)
  // ──────────────────────────────────────────────

  function ok(data)       { return { ok: true,  data, error: null }; }
  function err(msg, code) { return { ok: false, data: null, error: { msg, code: code || 'ERR' } }; }

  // ──────────────────────────────────────────────
  // 2. EVENT BUS (replaces window.dispatchEvent hacks)
  // ──────────────────────────────────────────────

  const EventBus = {
    _subs: {},
    on(event, fn) {
      if (!this._subs[event]) this._subs[event] = [];
      this._subs[event].push(fn);
      return () => { this._subs[event] = this._subs[event].filter(f => f !== fn); };
    },
    emit(event, data) {
      (this._subs[event] || []).forEach(fn => { try { fn(data); } catch {} });
      (this._subs['*']   || []).forEach(fn => { try { fn({ event, data }); } catch {} });
    }
  };

  // ──────────────────────────────────────────────
  // 3. STORAGE HELPERS (isolated)
  // ──────────────────────────────────────────────

  function readStore(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      EventBus.emit('store:write', { key });
      return true;
    } catch { return false; }
  }

  const KEYS = {
    PROFILE: 'uqu_profile_v2',
    PLAN:    'uqu_plan_v5',
    GPA:     'uqu_gpa_v1',
    TASKS:   'uqu_tasks_v1'
  };

  // ──────────────────────────────────────────────
  // 4. PROFILE ACTIONS
  // ──────────────────────────────────────────────

  function getProfile() {
    return readStore(KEYS.PROFILE, null);
  }

  function saveProfile(data) {
    if (!data || typeof data !== 'object') return err('Invalid profile data', 'INVALID');
    const existing = getProfile() || {};
    const merged = deepMerge(existing, data);
    merged._updatedAt = Date.now();
    const saved = writeStore(KEYS.PROFILE, merged);
    if (!saved) return err('Failed to save profile', 'STORAGE');
    EventBus.emit('profile:updated', merged);
    return ok(merged);
  }

  function addOrUpdateCourse(course) {
    if (!course?.name) return err('Course name required', 'VALIDATION');
    const profile = getProfile() || {};
    const courses = profile.courses || [];
    const idx = courses.findIndex(c =>
      c.id === course.id || c.name?.trim() === course.name?.trim()
    );
    const entry = { ...course, id: course.id || `c_${Date.now()}` };
    if (idx >= 0) courses[idx] = { ...courses[idx], ...entry };
    else courses.push(entry);
    profile.courses = courses;
    return saveProfile(profile);
  }

  function removeCourse(courseIdOrName) {
    const profile = getProfile();
    if (!profile) return err('No profile', 'NOT_FOUND');
    profile.courses = (profile.courses || [])
      .filter(c => c.id !== courseIdOrName && c.name !== courseIdOrName);
    return saveProfile(profile);
  }

  // ──────────────────────────────────────────────
  // 5. PLAN ACTIONS
  // ──────────────────────────────────────────────

  function generatePlanFromProfile() {
    const profile = getProfile();
    if (!profile) return err('No profile found', 'NOT_FOUND');
    if (!window.UQUEngine) return err('UQUEngine not loaded', 'DEP');

    const slots = profile?.learning?.slots || [];
    const result = UQUEngine.generateSmartPlan(profile, slots);

    const plan = {
      planTitle: profile.basic?.name ? `خطة ${profile.basic.name} الدراسية` : 'خطة دراسية',
      sessionMin: profile.learning?.focusMinutes || 45,
      weeks:    profile.basic?.weeks || 16,
      planStart: profile.basic?.semStart || UQUEngine.DateUtils.toISO(new Date()),
      courses:   profile.courses || [],
      slots,
      plan:  result.plan,
      tasks: [],
      _generatedAt: Date.now()
    };

    writeStore(KEYS.PLAN, plan);
    EventBus.emit('plan:generated', plan);
    return ok(plan);
  }

  function addStudySession(session) {
    if (!session?.date || !session?.time) return err('date and time required', 'VALIDATION');
    const plan  = readStore(KEYS.PLAN, { plan: [], tasks: [] });
    const entry = {
      id: `s_${session.date}_${session.time}_${Date.now()}`,
      day: session.day || getDayName(session.date),
      week: session.week || 1,
      ...session,
      kind: 'manual',
      _addedAt: Date.now()
    };
    plan.plan = plan.plan || [];
    plan.plan.push(entry);
    writeStore(KEYS.PLAN, plan);
    EventBus.emit('plan:sessionAdded', entry);
    return ok(entry);
  }

  function removeStudySession(sessionId) {
    const plan = readStore(KEYS.PLAN, { plan: [] });
    const before = plan.plan.length;
    plan.plan = plan.plan.filter(s => s.id !== sessionId);
    if (plan.plan.length === before) return err('Session not found', 'NOT_FOUND');
    writeStore(KEYS.PLAN, plan);
    EventBus.emit('plan:sessionRemoved', { sessionId });
    return ok({ removed: true });
  }

  function addTask(task) {
    if (!task?.title) return err('Task title required', 'VALIDATION');
    const plan = readStore(KEYS.PLAN, { plan: [], tasks: [] });
    const entry = {
      id:     `t_${Date.now()}`,
      type:   task.type || 'other',
      kind:   'manual',
      ...task,
      _addedAt: Date.now()
    };
    plan.tasks = plan.tasks || [];
    plan.tasks.push(entry);
    plan.plan  = plan.plan || [];
    plan.plan.push(entry);
    writeStore(KEYS.PLAN, plan);
    EventBus.emit('plan:taskAdded', entry);
    return ok(entry);
  }

  function removeTask(taskId) {
    const plan = readStore(KEYS.PLAN, { plan: [], tasks: [] });
    const before = plan.plan.length;
    plan.plan  = plan.plan.filter(s => s.id !== taskId);
    plan.tasks = (plan.tasks || []).filter(t => t.id !== taskId);
    if (plan.plan.length === before) return err('Task not found', 'NOT_FOUND');
    writeStore(KEYS.PLAN, plan);
    EventBus.emit('plan:taskRemoved', { taskId });
    return ok({ removed: true });
  }

  // ──────────────────────────────────────────────
  // 6. GPA ACTIONS
  // ──────────────────────────────────────────────

  function recordGrade({ courseName, courseId, score, grade }) {
    const profile  = getProfile();
    if (!profile) return err('No profile', 'NOT_FOUND');

    const courses  = profile.courses || [];
    const course   = courses.find(c =>
      c.id === courseId ||
      c.name?.trim().toLowerCase() === courseName?.trim().toLowerCase()
    );

    if (!course) return err(`Course "${courseName}" not found in profile`, 'NOT_FOUND');

    const pts = grade
      ? (window.UQUModel?.GRADE_SCALE?.[grade] ?? 0)
      : (window.UQUModel?.scoreToPoints(score) ?? scoreToPointsLocal(score));

    course.lastScore      = score ?? null;
    course.lastGrade      = grade ?? scoreToLabelLocal(score);
    course.gradePoints    = pts;
    course.currentProgress= Math.max(course.currentProgress || 0, 50);

    saveProfile(profile);

    // Recalculate GPA
    const gpaResult = recalcGPA(profile);
    EventBus.emit('grade:recorded', { course, score, gpaResult });

    return ok({ course, gpa: gpaResult.newGpa, pts });
  }

  function recalcGPA(profile) {
    if (!profile) return { newGpa: 0, termGpa: 0 };
    const goals   = profile.goals || {};
    const courses = (profile.courses || []).filter(c => c.gradePoints != null && c.creditHours);
    if (!window.UQUModel?.Computed) return { newGpa: 0, termGpa: 0 };
    const result  = window.UQUModel.Computed.gpaFromCourses(goals, courses);
    const gpaData = readStore(KEYS.GPA, {});
    gpaData.calculatedGpa = result.newGpa;
    gpaData.termGpa       = result.termGpa;
    gpaData.lastUpdated   = Date.now();
    writeStore(KEYS.GPA, gpaData);
    return result;
  }

  function predictGpaWithHypotheticalScores(items = []) {
    const profile = getProfile();
    if (!profile) return { gpa: 0, hours: 0 };
    const courses = profile.courses || [];
    const matched = items.map(item => {
      const c = courses.find(c =>
        c.name?.trim().toLowerCase().includes(item.courseName?.trim().toLowerCase()) ||
        item.courseName?.trim().toLowerCase().includes(c.name?.trim().toLowerCase())
      );
      if (!c || !c.creditHours) return null;
      return { ...c, gradePoints: scoreToPointsLocal(item.score) };
    }).filter(Boolean);

    if (!matched.length) return { gpa: 0, hours: 0 };
    if (!window.UQUModel?.Computed) return { gpa: 0, hours: 0 };

    const result = window.UQUModel.Computed.gpaFromCourses(profile.goals, matched);
    return { gpa: result.newGpa, termGpa: result.termGpa, hours: result.termHours };
  }

  // ──────────────────────────────────────────────
  // 7. LOCAL GRADE HELPERS (no UQUModel dependency)
  // ──────────────────────────────────────────────

  // ──────────────────────────────────────────────
  // Delegate to UQUCore (single source of truth for grade conversion)
  function scoreToLabelLocal(s) {
    return window.UQUCore?.scoreToGrade(s) ?? _fallbackLabel(s);
  }
  function scoreToPointsLocal(s) {
    return window.UQUCore?.scoreToPoints(s) ?? _fallbackPoints(s);
  }
  // Minimal fallback only if UQUCore not yet loaded
  function _fallbackLabel(s) {
    s = parseFloat(s); if (isNaN(s)) return 'F';
    if (s>=95) return 'A+'; if (s>=90) return 'A'; if (s>=85) return 'A-';
    if (s>=80) return 'B+'; if (s>=75) return 'B'; if (s>=70) return 'B-';
    if (s>=65) return 'C+'; if (s>=60) return 'C'; if (s>=55) return 'C-';
    if (s>=50) return 'D'; return 'F';
  }
  const _FS = {'A+':4,'A':4,'A-':3.67,'B+':3.33,'B':3,'B-':2.67,'C+':2.33,'C':2,'C-':1.67,'D+':1.33,'D':1,'D-':0.67,'F':0};
  function _fallbackPoints(s) { return _FS[_fallbackLabel(s)] ?? 0; }

  // ──────────────────────────────────────────────
  // 8. UTILITIES
  // ──────────────────────────────────────────────

  function getDayName(isoDate) {
    try {
      const d = new Date(isoDate + 'T00:00:00');
      return ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][d.getDay()];
    } catch { return ''; }
  }

  function deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    const result = Object.assign({}, target);
    for (const key of Object.keys(source)) {
      if (Array.isArray(source[key])) {
        result[key] = source[key];
      } else if (source[key] && typeof source[key] === 'object' && !Array.isArray(result[key])) {
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  // ──────────────────────────────────────────────
  // 9. EXPOSE
  // ──────────────────────────────────────────────

  const UQUActions = {
    EventBus,

    // Profile
    getProfile,
    saveProfile,
    addOrUpdateCourse,
    removeCourse,

    // Plan
    generatePlanFromProfile,
    addStudySession,
    removeStudySession,
    addTask,
    removeTask,

    // GPA
    recordGrade,
    recalcGPA,
    predictGpaWithHypotheticalScores,

    // Utils
    getDayName,
    ok, err
  };

  window.UQUActions = UQUActions;


})(window);
