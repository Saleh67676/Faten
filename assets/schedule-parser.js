/**
 * ════════════════════════════════════════════════════════════════
 * UQU SCHEDULE PARSER v2.0 — Smart Timetable Analyzer (Agentic)
 * ════════════════════════════════════════════════════════════════
 * Extracts raw text from schedule PDF and relies on AI Service
 * to rebuild the grid and extract exact slots.
 */
(function(window) {
  'use strict';

  async function parseSchedulePDF(file) {
    if (!window.pdfjsLib) throw new Error('مكتبة pdf.js غير محملة');
    if (!window.AIService || !window.AIService.parseScheduleWithAI) {
        throw new Error('خدمة الذكاء الاصطناعي (AIService) غير متوفرة');
    }

    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    
    let allTextItems = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Extract with rough geometric order if possible, or just raw text stream
      allTextItems = allTextItems.concat(content.items.map(it => it.str).filter(s => s.trim().length > 0));
    }
    
    const rawPdfText = allTextItems.join('\n');
    console.log('[ScheduleParser] Extracted Raw Text length:', rawPdfText.length);

    // Offload parsing logic completely to the AI Engine
    const parsedData = await window.AIService.parseScheduleWithAI(rawPdfText);
    return parsedData;
  }

  window.UQUSchedule = { parseSchedulePDF };
})(window);
