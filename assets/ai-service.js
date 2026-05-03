/**
 * ════════════════════════════════════════════════════════════════
 * UQU SMART SCHEDULE ENGINE - AI SERVICE — Thin Client Wrapper
 * ════════════════════════════════════════════════════════════════
 * Public API preserved 1:1 — same window.AIService.parseScheduleWithAI(rawPdfText).
 * The Gemini call (and its hardcoded API key) was moved to the FastAPI
 * backend at POST /api/schedule/analyze-with-ai. This file forwards the
 * raw PDF text and returns the same array shape callers expect.
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

  async function parseScheduleWithAI(rawPdfText) {
    const token = await _getIdToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const response = await fetch(_getBackendBase() + '/api/schedule/analyze-with-ai', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ raw_pdf_text: rawPdfText })
    });

    if (!response.ok) {
      let errMsg = `HTTP ${response.status} failed`;
      try {
        const errBody = await response.json();
        if (errBody && errBody.detail) errMsg = errBody.detail;
      } catch (_) { /* ignored */ }
      throw new Error(errMsg);
    }

    const data = await response.json();
    const schedule = (data && Array.isArray(data.schedule)) ? data.schedule : [];
    console.log('[AI Schedule Parser] JSON Res:', schedule);
    return schedule; // Same array shape as the original parseScheduleWithAI
  }

  window.AIService = { parseScheduleWithAI };
})(window);
