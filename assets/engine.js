/**
 * ================================================================
 * UQU ENGINE v2.0 — Smart Academic Intelligence (Hybrid Wrapper)
 * ================================================================
 * Public compute helpers (scoreExamPressure, getPlanWarnings,
 * suggestExtraSessionsForCourse) are now async thin wrappers around
 * the FastAPI backend (POST /api/engine/*). The algorithms are
 * authoritative on the backend.
 *
 * Internal sync copies of the compute helpers are retained ONLY
 * because the client-side generateSmartPlan still uses them. They
 * are not exposed publicly.
 *
 * DateUtils, generateICS/downloadICS, generateSmartPlan,
 * predictRequiredGrade, normalizeArabic remain client-side.
 * ================================================================
 */

(function (window) {
  'use strict';

  // ──────────────────────────────────────────────
  // 1. DATE UTILITIES (unchanged — pure client-side)
  // ──────────────────────────────────────────────

  function getD() { return window.UQUCore?.D ?? _localD; }

  const _localD = {
    toISO(d) { if (!d) return null; const dt=d instanceof Date?d:new Date(d); return dt.toISOString().split('T')[0]; },
    today()  { const d=new Date(); d.setHours(0,0,0,0); return d; },
    daysUntil(iso) { if (!iso) return null; return Math.round((new Date(iso+'T00:00:00')-this.today())/86400000); },
    addDays(d,n)   { const r=new Date(d); r.setDate(r.getDate()+n); return r; },
    parseTime(t)   { if (!t) return 0; const [h,m]=t.split(':').map(Number); return h*60+(m||0); },
    formatTime(m)  { m=Math.max(0,m); return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); },
    nextWeekday(name) { const M={'الأحد':0,'الاحد':0,'الإثنين':1,'الاثنين':1,'الثلاثاء':2,'الأربعاء':3,'الاربعاء':3,'الخميس':4,'الجمعة':5,'السبت':6}; const t=M[name]; if(t===undefined) return this.today(); let d=t-this.today().getDay(); if(d<=0)d+=7; return this.addDays(this.today(),d); },
    DAY_INDEX: {'الأحد':0,'الإثنين':1,'الثلاثاء':2,'الأربعاء':3,'الخميس':4,'الجمعة':5,'السبت':6},
    DAY_NAMES: ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],
    dayName(d) { return this.DAY_NAMES[(d instanceof Date?d:new Date(d)).getDay()]; },
    weekRange(off) { const s=this.today(); s.setDate(s.getDate()-s.getDay()+(off||0)*7); return {start:this.toISO(s),end:this.toISO(this.addDays(s,6))}; },
    pad(n) { return String(n).padStart(2,'0'); }
  };

  const DateUtils = new Proxy({}, { get(_, k) { return getD()[k]; } });

  // ──────────────────────────────────────────────
  // BACKEND HELPERS
  // ──────────────────────────────────────────────

  function _getBackendBase() {
    return (
      window.UQU_BACKEND_URL ||
      window.BACKEND_URL ||
      (window.location && window.location.origin && window.location.origin.startsWith('http')
        ? window.location.origin
        : 'http://localhost:8000')
    );
  }

  async function _getIdToken() {
    try {
      if (window.firebase && window.firebase.auth) {
        const user = window.firebase.auth().currentUser;
        if (user && typeof user.getIdToken === 'function') {
          return await user.getIdToken();
        }
      }
    } catch (_) { /* ignored */ }
    if (window.FirebaseAuth && typeof window.FirebaseAuth.getIdToken === 'function') {
      try { return await window.FirebaseAuth.getIdToken(); } catch (_) { /* ignored */ }
    }
    return null;
  }

  async function _engineCall(path, body) {
    const token = await _getIdToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const response = await fetch(_getBackendBase() + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body || {})
    });
    if (!response.ok) {
      let errMsg = `HTTP ${response.status} failed`;
      try {
        const errBody = await response.json();
        if (errBody && errBody.detail) errMsg = errBody.detail;
      } catch (_) { /* ignored */ }
      throw new Error(errMsg);
    }
    return response.json();
  }

  function _todayIso() {
    return DateUtils.toISO(DateUtils.today());
  }

  // ──────────────────────────────────────────────
  // 2. EXAM PRESSURE — public async wrapper
  // ──────────────────────────────────────────────

  async function scoreExamPressure(courses = []) {
    if (!courses.length) return [];
    const data = await _engineCall('/api/engine/exam-pressure', {
      courses: courses,
      today: _todayIso()
    });
    return (data && Array.isArray(data.courses)) ? data.courses : [];
  }

  // Internal sync copy used by generateSmartPlan only — not exported.
  function _scoreExamPressureSync(courses) {
    if (!courses || !courses.length) return [];
    return courses
      .map(c => {
        if (!c.examDate) return { ...c, pressure: 0 };
        const days = DateUtils.daysUntil(c.examDate);
        if (days === null || days < 0) return { ...c, pressure: 0 };
        const difficultyFactor = c.difficulty === 'hard' ? 1.4
                               : c.difficulty === 'easy' ? 0.7 : 1.0;
        const progressFactor   = 1 - (parseFloat(c.currentProgress) || 0) / 100;
        const daysFactor       = Math.exp(-days / 10);
        const pressure = Math.round(
          Math.min(100, daysFactor * 100 * difficultyFactor * (0.4 + 0.6 * progressFactor))
        );
        return { ...c, pressure, daysUntil: days };
      })
      .sort((a, b) => b.pressure - a.pressure);
  }

  // ──────────────────────────────────────────────
  // 3. UPCOMING EXAMS (stays sync, pure filter)
  // ──────────────────────────────────────────────

  function getUpcomingExamsFromProfile(profile, withinDays = 14) {
    const courses = profile?.courses || [];
    return courses
      .filter(c => c.examDate)
      .map(c => {
        const days = DateUtils.daysUntil(c.examDate);
        return { ...c, daysLeft: days };
      })
      .filter(c => c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= withinDays)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

  // ──────────────────────────────────────────────
  // 4. PLAN WARNINGS — public async wrapper
  // ──────────────────────────────────────────────

  async function getPlanWarnings(plan) {
    const profile = window.UQUModel?.getProfile?.() || null;
    const data = await _engineCall('/api/engine/plan-warnings', {
      plan: plan || {},
      profile: profile,
      today: _todayIso()
    });
    return (data && Array.isArray(data.warnings)) ? data.warnings : [];
  }

  // Internal sync copy used by generateSmartPlan only — not exported.
  function _getPlanWarningsSync(plan) {
    const warnings = [];
    const sessions = plan?.plan || [];
    if (!sessions.length) {
      warnings.push({ type: 'empty', msg: 'الخطة فارغة — لا توجد جلسات مجدولة.' });
      return warnings;
    }
    const byDate = {};
    sessions.forEach(s => {
      if (!s.date) return;
      byDate[s.date] = (byDate[s.date] || 0) + 1;
    });
    Object.entries(byDate).forEach(([date, count]) => {
      if (count > 6) {
        warnings.push({ type: 'overload', msg: `يوم ${date} فيه ${count} جلسات — قد يكون مرهقاً.` });
      }
    });
    const profile = window.UQUModel?.getProfile?.();
    const examCourses = (profile?.courses || []).filter(c => c.examDate);
    examCourses.forEach(c => {
      const days = DateUtils.daysUntil(c.examDate);
      if (days !== null && days <= 3 && days >= 0) {
        const hasSession = sessions.some(s => s.courseId === c.id || s.courseName === c.name);
        if (!hasSession) {
          warnings.push({
            type: 'exam_soon',
            msg: `اختبار ${c.name} بعد ${days} يوم — لا يوجد جلسة مذاكرة له في الخطة!`,
            urgent: true
          });
        }
      }
    });
    const sortedDates = Object.keys(byDate).sort();
    for (let i = 1; i < sortedDates.length; i++) {
      const a = new Date(sortedDates[i-1]);
      const b = new Date(sortedDates[i]);
      const gap = Math.round((b - a) / 86400000);
      if (gap > 3) {
        warnings.push({ type: 'gap', msg: `فجوة ${gap} أيام بين ${sortedDates[i-1]} و ${sortedDates[i]} — ربما تحتاج جلسة وسط.` });
      }
    }
    return warnings;
  }

  // ──────────────────────────────────────────────
  // 5. SUGGEST EXTRA SESSIONS — public async wrapper
  // ──────────────────────────────────────────────

  async function suggestExtraSessionsForCourse(course, plan, slots, count = 2) {
    if (!course || !slots || !slots.length) return [];
    const data = await _engineCall('/api/engine/suggest-sessions', {
      course: course,
      plan: plan || {},
      slots: slots,
      count: count,
      today: _todayIso()
    });
    return (data && Array.isArray(data.suggestions)) ? data.suggestions : [];
  }

  // ──────────────────────────────────────────────
  // 6. SMART PLAN GENERATOR (stays client-side; uses private sync helpers)
  // ──────────────────────────────────────────────

  function generateSmartPlan(profile, slots, options = {}) {
    const courses  = profile?.courses || [];
    const learning = profile?.learning || {};

    if (!courses.length || !slots.length) return { plan: [], warnings: ['لا توجد مواد أو أوقات كافية.'] };

    const sessionMin   = options.sessionMin || learning.focusMinutes || 45;
    const semStart     = profile?.basic?.semStart || DateUtils.toISO(DateUtils.today());
    const semWeeks     = parseInt(profile?.basic?.weeks) || 16;
    const maxDaily     = parseInt(learning.maxDailySessions) || 3;

    const pressured   = _scoreExamPressureSync(courses);
    const sessions    = [];
    const dayLoad     = {};

    const COLORS = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899'];
    pressured.forEach((c, i) => { if (!c.color) c.color = COLORS[i % COLORS.length]; });

    const allDays = [];
    for (let w = 0; w < semWeeks; w++) {
      for (let d = 0; d < 7; d++) {
        const date = DateUtils.addDays(new Date(semStart + 'T00:00:00'), w * 7 + d);
        const iso  = DateUtils.toISO(date);
        const dow  = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][date.getDay()];
        const matchSlots = slots.filter(sl => sl.day === dow);
        if (matchSlots.length) allDays.push({ iso, dow, w, slots: matchSlots });
      }
    }

    let courseIdx = 0;
    for (const day of allDays) {
      for (const slot of day.slots) {
        const course = pressured[courseIdx % pressured.length];
        courseIdx++;

        const dayCount = dayLoad[day.iso] || 0;
        if (dayCount >= maxDaily) continue;

        if (course.daysUntil !== undefined && course.daysUntil < 0) continue;

        const endTime  = DateUtils.parseTime(slot.from);
        const duration = Math.max(30, Math.min(sessionMin, 120));
        const endMin   = endTime + duration;

        sessions.push({
          id:         `s_${day.iso}_${slot.day}_${course.id || courseIdx}`,
          date:       day.iso,
          day:        day.dow,
          time:       slot.from,
          timeEnd:    DateUtils.formatTime(endMin),
          week:       day.w + 1,
          courseName: course.name,
          courseId:   course.id || null,
          courseColor:course.color,
          place:      slot.place || 'غير محدد',
          pressure:   course.pressure || 0,
          kind:       'auto'
        });

        dayLoad[day.iso] = dayCount + 1;
      }
    }

    return {
      plan:      sessions,
      warnings:  _getPlanWarningsSync({ plan: sessions }),
      stats: {
        total:    sessions.length,
        hours:    Math.round(sessions.length * sessionMin / 60 * 10) / 10,
        weeks:    semWeeks
      }
    };
  }

  // ──────────────────────────────────────────────
  // 7. ICS EXPORT (unchanged — browser-only)
  // ──────────────────────────────────────────────

  function generateICS(sessions = [], title = 'UQU Study Plan') {
    const now = new Date().toISOString().replace(/[-:.]/g,'').slice(0,15) + 'Z';
    let ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//UQU Academic Assistant//AR',
      `X-WR-CALNAME:${title}`,
      'X-WR-TIMEZONE:Asia/Riyadh',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];
    sessions.forEach((s, i) => {
      if (!s.date || !s.time) return;
      const [h1,m1] = s.time.split(':').map(Number);
      const [h2,m2] = (s.timeEnd || s.time).split(':').map(Number);
      const dtStart = s.date.replace(/-/g,'') + 'T' + String(h1).padStart(2,'0') + String(m1).padStart(2,'0') + '00';
      const dtEnd   = s.date.replace(/-/g,'') + 'T' + String(h2).padStart(2,'0') + String(m2).padStart(2,'0') + '00';
      ics.push('BEGIN:VEVENT');
      ics.push(`UID:uqu_${i}_${now}@uqu-assistant`);
      ics.push(`DTSTAMP:${now}`);
      ics.push(`DTSTART;TZID=Asia/Riyadh:${dtStart}`);
      ics.push(`DTEND;TZID=Asia/Riyadh:${dtEnd}`);
      ics.push(`SUMMARY:${s.courseName || 'مذاكرة'}`);
      ics.push(`LOCATION:${s.place || ''}`);
      ics.push(`DESCRIPTION:${s.kind === 'exam' ? '⚠️ اختبار' : '📚 جلسة مذاكرة'} — ${s.courseName || ''}`);
      ics.push('STATUS:CONFIRMED');
      ics.push('END:VEVENT');
    });
    ics.push('END:VCALENDAR');
    return ics.join('\r\n');
  }

  function downloadICS(sessions, filename = 'uqu-study-plan.ics') {
    const content = generateICS(sessions);
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // ──────────────────────────────────────────────
  // 8. GRADE PREDICTOR (unchanged — pure GPA math)
  // ──────────────────────────────────────────────

  function predictRequiredGrade(profile, termHours) {
    const goals  = profile?.goals || {};
    const prev   = parseFloat(goals.currentGpa)  || 0;
    const earned = parseFloat(goals.earnedHours) || 0;
    const target = parseFloat(goals.targetGpa)   || prev;
    const tHours = parseFloat(termHours)          || 15;
    const needed = ((target * (earned + tHours)) - (prev * earned)) / tHours;
    return { needed: Math.min(5, Math.max(0, needed)), feasible: needed <= 5 };
  }

  // ──────────────────────────────────────────────
  // 9. TEXT NORMALIZER (unchanged — pure utility)
  // ──────────────────────────────────────────────

  function normalizeArabic(text) {
    if (window.UQUCore?.normalizeAr) return window.UQUCore.normalizeAr(text);
    if (!text) return '';
    return text
      .replace(/[ؗ-ًؚ-ْ]/g, '')
      .replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // ──────────────────────────────────────────────
  // EXPOSE
  // ──────────────────────────────────────────────

  const UQUEngine = {
    DateUtils,
    scoreExamPressure,
    getUpcomingExamsFromProfile,
    getPlanWarnings,
    suggestExtraSessionsForCourse,
    generateSmartPlan,
    generateICS,
    downloadICS,
    predictRequiredGrade,
    normalizeArabic
  };

  window.UQUEngine = UQUEngine;

  // Legacy compat
  window.getUpcomingExamsFromProfile   = getUpcomingExamsFromProfile;
  window.getPlanWarnings               = getPlanWarnings;
  window.suggestExtraSessionsForCourse = suggestExtraSessionsForCourse;

})(window);
