/**
 * ════════════════════════════════════════════════════════════════
 * UQU AI SMART PLAN GENERATOR — Thin Client Wrapper
 * ════════════════════════════════════════════════════════════════
 * Public API preserved 1:1 — same window.GeneratorEngine.generateAIPlan(state).
 * The Gemini call (and its hardcoded API key) was moved to the FastAPI
 * backend at POST /api/plan/generate. This file now just gathers the
 * same localStorage data the original prompt builder needed and forwards
 * it to the backend, returning the identical { reasoning, tasks } shape.
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

      const payload = {
        courses: state?.courses || [],
        slots,
        profile: {
          preferences: learningProfile.learning || learningProfile.preferences || {},
          goals:       learningProfile.goals || {}
        },
        completedCourses
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
