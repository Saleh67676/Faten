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

  async function parseScheduleWithAI(rawPdfText) {
    const data = await window.UQUCore.api.post('/api/schedule/analyze-with-ai', {
      raw_pdf_text: rawPdfText
    });
    const schedule = Array.isArray(data?.schedule) ? data.schedule : [];
    console.log('[AI Schedule Parser] JSON Res:', schedule);
    return schedule;
  }

  window.AIService = { parseScheduleWithAI };
})(window);
