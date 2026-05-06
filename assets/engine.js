/**
 * ================================================================
 * UQU ENGINE v2.0 — Smart Academic Intelligence (Thin Client)
 * ================================================================
 * All compute-heavy algorithms (exam pressure, plan warnings,
 * session suggestions, and smart plan generation) are now async
 * wrappers around the FastAPI backend (POST /api/engine/*).
 *
 * The client strictly handles Date/ICS utilities, GPA math,
 * and text normalization.
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
  // BACKEND HELPER — uses centralized UQUCore.api client
  // ──────────────────────────────────────────────

  function _engineCall(path, body) {
    return window.UQUCore.api.post(path, body || {});
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
  // 6. SMART PLAN GENERATOR (Thin Wrapper)
  // ──────────────────────────────────────────────

  async function generateSmartPlan(profile, slots, options = {}) {
    try {
      const data = await _engineCall('/api/engine/smart-plan', {
        profile: profile,
        slots: slots,
        options: options,
        today: _todayIso()
      });
      return data;
    } catch (err) {
      console.error('Smart Plan Engine Error:', err);
      return { 
        plan: [], 
        warnings: [{ type: 'error', msg: 'فشل توليد الخطة من الخادم.' }],
        stats: { total: 0, hours: 0, weeks: 0 }
      };
    }
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
