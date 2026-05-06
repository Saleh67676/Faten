/**
 * ════════════════════════════════════════════════════════════════
 * UQU AI SMART PLAN GENERATOR — Frontend Client
 * ════════════════════════════════════════════════════════════════
 * Sends plan state to the FastAPI backend smart algorithm
 * (POST /api/plan/generate) which returns { reasoning, tasks }.
 * No external AI quota — the backend uses a pure rule-based engine.
 * ════════════════════════════════════════════════════════════════
 */

(function (window) {
  'use strict';

  const GeneratorEngine = {
    async generateAIPlan(state) {
      const uid =
        window.FirebaseAuth?.getUid?.() ||
        window.UQUAuth?.getSession?.()?.uid ||
        'guest';

      const learningProfile = window.UQUCore.S.get('uqu_profile_v2', {}) || {};
      const completedCourses = window.UQUCore.S.get('uqu_completed_courses_' + uid, []) || [];

      const slots = (state?.slots || []).map(s => ({
        day:     s.day     || '',
        time:    s.time    || s.from    || '00:00',
        timeEnd: s.timeEnd || s.to      || '00:00',
        place:   s.place   || ''
      }));

      // Include schedule_slots per course so the backend can avoid lecture conflicts
      const courses = (state?.courses || []).map(c => ({
        id:              c.id              || null,
        name:            c.name            || '',
        difficulty:      c.difficulty      || 'medium',
        examDate:        c.examDate        || null,
        currentProgress: c.currentProgress || 0,
        progressPerSession: c.progressPerSession || 0,
        color:           c.color           || '#6366f1',
        schedule_slots:  Array.isArray(c.schedule_slots) ? c.schedule_slots : []
      }));

      const payload = {
        courses,
        slots,
        profile: {
          preferences: learningProfile.learning || learningProfile.preferences || {},
          goals:       learningProfile.goals || {}
        },
        completedCourses,
        sessionMin: state?.sessionMin || 60,
        weeks:      state?.weeks      || 1,
        planStart:  state?.planStart  || ''
      };

      try {
        return await window.UQUCore.api.post('/api/plan/generate', payload);
      } catch (err) {
        console.error('[GenAI Planner]', err);
        throw err;
      }
    }
  };

  window.GeneratorEngine = GeneratorEngine;
})(window);
