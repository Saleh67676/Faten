/* ================================================================
   UQU ACADEMIC DIAGNOSTICS ENGINE v1.0
   تحليل ذكي لنقاط القوة والضعف والتوقعات الأكاديمية
   ================================================================ */

(function () {
  'use strict';

  // ── Grade scale (mirrors student-model.js) ──────────────────────
  const GRADE_POINTS = {
    'A+': 4.00, 'A': 4.00, 'A-': 3.67,
    'B+': 3.33, 'B': 3.00, 'B-': 2.67,
    'C+': 2.33, 'C': 2.00, 'C-': 1.67,
    'D+': 1.33, 'D': 1.00, 'D-': 0.67, 'F': 0.00
  };

  const GRADE_FROM_SCORE = s => {
    if (s >= 95) return 'A+'; if (s >= 90) return 'A';  if (s >= 85) return 'A-';
    if (s >= 80) return 'B+'; if (s >= 75) return 'B';  if (s >= 70) return 'B-';
    if (s >= 65) return 'C+'; if (s >= 60) return 'C';  if (s >= 55) return 'C-';
    if (s >= 50) return 'D+'; if (s >= 45) return 'D';
    return 'F';
  };

  // Map approximate midpoint scores for each grade letter
  const GRADE_TO_SCORE = {
    'A+': 97, 'A': 92, 'A-': 87, 'B+': 82, 'B': 77, 'B-': 72,
    'C+': 67, 'C': 62, 'C-': 57, 'D+': 52, 'D': 47, 'D-': 44, 'F': 0
  };

  /**
   * resolveGrade(course)
   * Thin wrapper to maintain compatibility if called elsewhere.
   */
  function resolveGrade(course) {
    let grade = course.grade || '?';
    let points = course.gradePoints || 0;
    let score = course.score || 0;
    return { grade, points, score };
  }

  // ── 1. CORE DIAGNOSTIC GENERATOR (REMOTE) ────────────────────────
  /**
   * generateDiagnostics(semesters, currentCourses, goals)
   * Fetches full diagnostic report from FastAPI backend.
   */
  async function generateDiagnostics(semesters = [], currentCourses = [], goals = {}) {
    try {
      return await window.UQUCore.api.post('/api/diagnostics/analyze', { semesters, currentCourses, goals });
    } catch (err) {
      console.error('Diagnostics Error:', err);
      return {
        hasSemesterData: false,
        insights: [{ type: 'danger', icon: '❌', text: 'عذراً، فشل الاتصال بمحرك التحليل.' }],
        allCourses: [], strengths: [], weaknesses: [], failed: [], dist: {}
      };
    }
  }

  // ── 2. GOAL CALCULATOR (REMOTE) ───────────────────────────
  /**
   * calcRequiredSGPA(currentGpa, earnedHours, totalPoints, targetGpa, termHours)
   */
  async function calcRequiredSGPA(currentGpa, earnedHours, totalPoints, targetGpa, termHours) {
    try {
      return await window.UQUCore.api.post('/api/diagnostics/calculate-goal', { currentGpa, earnedHours, totalPoints, targetGpa, termHours });
    } catch (err) {
      console.error('Goal Calc Error:', err);
      return [];
    }
  }

  // ── 3. GRADE DISTRIBUTION CHART HTML ──────────────────────────
  function renderDistributionBars(dist, totalCourses) {
    if (!totalCourses) return '';
    const cats = [
      { key: 'excellent', label: 'ممتاز (A-/A/A+)', color: 'var(--success)' },
      { key: 'good',      label: 'جيد (B-/B/B+)',   color: 'var(--accent)' },
      { key: 'acceptable',label: 'مقبول (C-/C/C+)', color: 'var(--warning)' },
      { key: 'poor',      label: 'ضعيف (D-/D/D+)',  color: 'hsl(25,80%,55%)' },
      { key: 'failed',    label: 'راسب (F)',         color: 'var(--danger)' }
    ];
    return cats.map(cat => {
      const n   = dist[cat.key] || 0;
      const pct = Math.round((n / totalCourses) * 100);
      if (!n) return '';
      return `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:4px;">
            <span style="font-weight:600;color:var(--fg-2);">${cat.label}</span>
            <span style="font-weight:800;color:${cat.color};">${n} (${pct}%)</span>
          </div>
          <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${cat.color};border-radius:4px;
              transition:width .6s cubic-bezier(.34,1.56,.64,1);"></div>
          </div>
        </div>`;
    }).join('');
  }

  // ── 4. STRENGTHS / WEAKNESSES HTML ────────────────────────────
  function renderCourseList(courses, mode) {
    if (!courses.length) {
      return `<div style="color:var(--muted);font-size:.8rem;padding:8px 0;">
        ${mode === 'strengths' ? 'لا توجد مواد بتقدير ممتاز بعد.' : 'لا توجد مواد ضعيفة — ممتاز!'}
      </div>`;
    }
    return courses.map(c => {
      const gradeColor = c._points >= 4.50 ? 'var(--success)' :
                         c._points >= 3.75 ? 'var(--accent)'  :
                         c._points >= 2.50 ? 'var(--warning)' : 'var(--danger)';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;
          border-radius:var(--r-sm);background:var(--surface-2);margin-bottom:6px;
          border:1px solid var(--border);border-right:3px solid ${gradeColor};">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:.84rem;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name || c.code || '—'}</div>
            ${c.code ? `<div style="font-size:.72rem;color:var(--muted);">${c.code}${c._semName ? ' · ' + c._semName : ''}</div>` : ''}
          </div>
          <div style="text-align:center;flex-shrink:0;">
            <div style="font-weight:900;font-size:1rem;color:${gradeColor};">${c._grade}</div>
            ${c._score ? `<div style="font-size:.65rem;color:var(--muted);">${c._score}%</div>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  // ── 5. GOAL CALCULATOR TABLE HTML ─────────────────────────────
  function renderGoalTable(results, targetGpa) {
    if (!results) return '';
    return `
      <div style="overflow-x:auto;margin-top:4px;">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
          <thead>
            <tr style="background:var(--surface-2);">
              <th style="padding:8px 12px;text-align:right;font-weight:700;color:var(--muted);
                border-bottom:1px solid var(--border);">الساعات</th>
              <th style="padding:8px 12px;text-align:center;font-weight:700;color:var(--muted);
                border-bottom:1px solid var(--border);">المعدل المطلوب</th>
              <th style="padding:8px 12px;text-align:center;font-weight:700;color:var(--muted);
                border-bottom:1px solid var(--border);">التقييم</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r => {
              const col = !r.feasible    ? 'var(--danger)'  :
                          r.needed > 4.5 ? 'var(--warning)' :
                          r.needed > 3.5 ? 'var(--accent)'  : 'var(--success)';
              return `
                <tr style="border-bottom:1px solid var(--border);
                  transition:background var(--t-fast);"
                  onmouseover="this.style.background='var(--surface-2)'"
                  onmouseout="this.style.background=''">
                  <td style="padding:10px 12px;font-weight:700;">${r.termHours} ساعة</td>
                  <td style="padding:10px 12px;text-align:center;
                    font-weight:900;font-size:1rem;color:${col};">${r.feasible ? r.needed : '✗'}</td>
                  <td style="padding:10px 12px;text-align:center;">
                    <span style="background:${col}18;color:${col};padding:3px 10px;
                      border-radius:99px;font-size:.72rem;font-weight:700;">${r.label}</span>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div style="font-size:.72rem;color:var(--muted);margin-top:8px;text-align:center;">
          الهدف التراكمي: <strong style="color:var(--accent);">${targetGpa}</strong> من 4.00
        </div>
      </div>`;
  }

  // ── EXPOSE ────────────────────────────────────────────────────
  window.UQUDiagnostics = {
    generateDiagnostics,
    calcRequiredSGPA,
    renderDistributionBars,
    renderCourseList,
    renderGoalTable,
    resolveGrade
  };

})();
