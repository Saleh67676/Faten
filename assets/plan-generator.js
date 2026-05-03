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

  const GeneratorEngine = {
    async generateAIPlan(state) {
      const uid =
        (window.FirebaseAuth && window.FirebaseAuth.getUid && window.FirebaseAuth.getUid()) ||
        (window.UQUAuth && window.UQUAuth.getSession && window.UQUAuth.getSession() && window.UQUAuth.getSession().uid) ||
        'guest';

      const learningProfile = JSON.parse(localStorage.getItem('uqu_profile_v2') || '{}') || {};
      const completedCourses = JSON.parse(localStorage.getItem('uqu_completed_courses_' + uid) || '[]') || [];

      const payload = {
        courses: state && Array.isArray(state.courses) ? state.courses : [],
        slots: state && Array.isArray(state.slots) ? state.slots : [],
        profile: {
          preferences: learningProfile.preferences || {},
          goals: learningProfile.goals || {}
        },
        completedCourses: completedCourses
      };

      const token = await _getIdToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      try {
        const response = await fetch(_getBackendBase() + '/api/plan/generate', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          let errMsg = 'فشل الاتصال بالمحرك الذكي.';
          try {
            const errBody = await response.json();
            if (errBody && errBody.detail) errMsg = errBody.detail;
          } catch (_) { /* ignored */ }
          throw new Error(errMsg);
        }

        const parsedPlan = await response.json();
        return parsedPlan; // { reasoning, tasks } — same shape as the original
      } catch (err) {
        console.error('[GenAI Planner]', err);
        throw err;
      }
    }
  };

  window.GeneratorEngine = GeneratorEngine;
})(window);
