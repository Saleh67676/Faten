/* ================================================================
   UQU ACADEMIC DIAGNOSTICS ENGINE v1.0
   تحليل ذكي لنقاط القوة والضعف والتوقعات الأكاديمية
   ================================================================ */

(function () {
  'use strict';

  // ── Grade scale (mirrors student-model.js) ──────────────────────
  const GRADE_POINTS = {
    'A+': 5.00, 'A': 4.75, 'A-': 4.50,
    'B+': 4.25, 'B': 4.00, 'B-': 3.75,
    'C+': 3.50, 'C': 3.00, 'C-': 2.50,
    'D+': 2.25, 'D': 2.00, 'D-': 1.75, 'F': 0.00
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

  function resolveGrade(course) {
    // Returns { grade: 'A+', points: 5.00, score: 97 }
    let grade = course.grade || null;
    let score = course.score != null ? parseFloat(course.score) : null;
    let points = course.gradePoints != null ? parseFloat(course.gradePoints) : null;

    if (!grade && score != null && !isNaN(score)) grade = GRADE_FROM_SCORE(score);
    if (!grade && points != null && !isNaN(points)) {
      grade = Object.entries(GRADE_POINTS).find(([, v]) => Math.abs(v - points) < 0.01)?.[0] ?? null;
    }
    if (grade && points == null) points = GRADE_POINTS[grade] ?? null;
    if (grade && score == null) score = GRADE_TO_SCORE[grade] ?? null;

    return { grade: grade || '?', points: points ?? 0, score: score ?? 0 };
  }

  // ── 1. CORE DIAGNOSTIC GENERATOR ────────────────────────────────
  /**
   * generateDiagnostics(semesters, currentCourses, goals)
   *
   * @param {Array}  semesters       - Array of { name, gpa, sgpa, earnedCredits, courses[] }
   * @param {Array}  currentCourses  - Current semester course objects
   * @param {Object} goals           - { currentGpa, targetGpa, earnedHours, planHours, totalPoints }
   * @returns {Object} Full diagnostic report
   */
  function generateDiagnostics(semesters = [], currentCourses = [], goals = {}) {
    // ── Flatten all completed semester courses ──────────────────
    const allCourses = [];
    semesters.forEach(sem => {
      (sem.courses || []).forEach(c => {
        const { grade, points, score } = resolveGrade(c);
        if (points == null) return;
        allCourses.push({
          ...c,
          _grade:   grade,
          _points:  points,
          _score:   score,
          _semName: sem.name || '',
          _credits: parseFloat(c.credits || c.creditHours || c.hours) || 0
        });
      });
    });

    const hasSemesterData = allCourses.length > 0;

    // ── Strengths: grade A- and above (points >= 4.50) ──────────
    const strengths = allCourses
      .filter(c => c._points >= 4.50)
      .sort((a, b) => b._points - a._points || b._credits - a._credits)
      .slice(0, 6);

    // ── Weaknesses: D+ and below (points <= 2.25), passed (not F) ──
    const weaknesses = allCourses
      .filter(c => c._points > 0 && c._points <= 2.25)
      .sort((a, b) => a._points - b._points)
      .slice(0, 5);

    // ── Failed courses ──────────────────────────────────────────
    const failed = allCourses.filter(c => c._points === 0 && c._grade === 'F');

    // ── Grade distribution ──────────────────────────────────────
    const dist = { excellent: 0, good: 0, acceptable: 0, poor: 0, failed: 0 };
    for (const c of allCourses) {
      if (c._points >= 4.50)     dist.excellent++;
      else if (c._points >= 3.75) dist.good++;
      else if (c._points >= 2.50) dist.acceptable++;
      else if (c._points > 0)     dist.poor++;
      else                        dist.failed++;
    }

    // ── Semester trend ──────────────────────────────────────────
    const semTrend = semesters
      .filter(s => s.gpa != null && !isNaN(s.gpa))
      .map(s => ({
        name: s.name || '—',
        gpa:  parseFloat(s.gpa),
        sgpa: s.sgpa != null ? parseFloat(s.sgpa) : parseFloat(s.gpa)
      }));

    const bestSem  = semTrend.length ? semTrend.reduce((a, b) => a.sgpa >= b.sgpa ? a : b) : null;
    const worstSem = semTrend.length ? semTrend.reduce((a, b) => a.sgpa <= b.sgpa ? a : b) : null;

    // ── GPA trend direction ─────────────────────────────────────
    let trendDir = 'stable';
    if (semTrend.length >= 2) {
      const last2 = semTrend.slice(-2);
      const diff  = last2[1].gpa - last2[0].gpa;
      trendDir = diff > 0.1 ? 'rising' : diff < -0.1 ? 'falling' : 'stable';
    }

    // ── Goal calculator ─────────────────────────────────────────
    const currentGpa = parseFloat(goals.currentGpa) || 0;
    const earnedHours = parseFloat(goals.earnedHours) || 0;
    const targetGpa   = parseFloat(goals.targetGpa)   || null;
    const totalPoints = parseFloat(goals.totalPoints)  || (currentGpa * earnedHours);

    let goalCalcResults = null;
    if (targetGpa) {
      goalCalcResults = [9, 12, 15, 18, 21].map(termHours => {
        // Formula: neededTermGpa = (target*(earned+S) - currentPoints) / S
        const currentPoints = totalPoints || (currentGpa * earnedHours);
        const needed = ((targetGpa * (earnedHours + termHours)) - currentPoints) / termHours;
        const feasible = needed <= 5.0 && needed >= 0;
        return {
          termHours,
          needed:   +Math.min(5, Math.max(0, needed)).toFixed(2),
          feasible,
          label:    needed > 5   ? 'غير ممكن' :
                    needed > 4.5 ? 'صعب جداً' :
                    needed > 3.5 ? 'محتاج تركيز' :
                    needed > 2.5 ? 'ممكن'   : 'سهل'
        };
      });
    }

    // ── Personalized insight sentences ─────────────────────────
    const insights = [];

    if (hasSemesterData) {
      if (strengths.length) {
        insights.push({
          type: 'success',
          icon: '⭐',
          text: `أداؤك استثنائي في ${strengths.length} مادة — أبرزها: ${strengths.slice(0,2).map(c => c.name).join(' و ')}.`
        });
      }
      if (weaknesses.length) {
        insights.push({
          type: 'warning',
          icon: '⚠️',
          text: `تحتاج لمراجعة أساسيات: ${weaknesses.slice(0,2).map(c => c.name).join(' و ')}.`
        });
      }
      if (trendDir === 'rising') {
        insights.push({ type: 'success', icon: '📈', text: 'معدلك في تحسّن مستمر — استمر على هذا المنوال!' });
      } else if (trendDir === 'falling') {
        insights.push({ type: 'danger', icon: '📉', text: 'معدلك في انخفاض — راجع استراتيجيتك الدراسية.' });
      }
      if (dist.excellent > 0) {
        const pct = Math.round((dist.excellent / allCourses.length) * 100);
        insights.push({ type: 'info', icon: '🏅', text: `${pct}% من موادك بتقدير ممتاز (A- أو أعلى).` });
      }
      if (failed.length > 0) {
        insights.push({ type: 'danger', icon: '🚨', text: `لديك ${failed.length} مادة راسب — تأكد من الإعادة أو التحسين.` });
      }
    }

    return {
      hasSemesterData,
      allCourses,
      strengths,
      weaknesses,
      failed,
      dist,
      semTrend,
      bestSem,
      worstSem,
      trendDir,
      goalCalcResults,
      insights,
      meta: { currentGpa, earnedHours, targetGpa, totalPoints }
    };
  }

  // ── 2. GOAL CALCULATOR (single call) ───────────────────────────
  /**
   * calcRequiredSGPA(currentGpa, earnedHours, totalPoints, targetGpa, termHours)
   * Returns the SGPA needed next semester to reach the target CGPA.
   */
  function calcRequiredSGPA(currentGpa, earnedHours, totalPoints, targetGpa, termHours) {
    const pts    = totalPoints || (currentGpa * earnedHours);
    const S      = parseFloat(termHours) || 15;
    const target = parseFloat(targetGpa);
    const needed = ((target * (earnedHours + S)) - pts) / S;
    return {
      needed:   +Math.min(5, Math.max(0, needed)).toFixed(2),
      feasible: needed <= 5.0 && needed >= 0,
      impossible: needed > 5.0,
      easy:     needed <= 2.5
    };
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
          الهدف التراكمي: <strong style="color:var(--accent);">${targetGpa}</strong> من 5.00
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
