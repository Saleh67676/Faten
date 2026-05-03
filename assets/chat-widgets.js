/**
 * ================================================================
 * UQU CHAT — Widget Engine v1.0
 * ================================================================
 * Renders rich interactive cards inside AI responses:
 *   • Google Maps widget    (when asking about locations)
 *   • Exam countdown cards  (after add_upcoming_exam action)
 *   • Study plan preview    (after create_study_plan action)
 *   • GPA snapshot card     (when discussing GPA)
 *   • Action result badges
 * ================================================================
 */

(function (window) {
  'use strict';

  /* ════════════════════════════════════════════════════════════════
     LOCATION DATABASE — UQU buildings + study spots
     ════════════════════════════════════════════════════════════════ */
  const UQU_LOCATIONS = [
    { name: 'المكتبة المركزية',      ar: ['مكتبة','كتاب','مراجع'],               lat: 21.4213, lng: 39.8264, emoji: '📚' },
    { name: 'قاعات الدراسة',         ar: ['قاعة','محاضرة','درس','فصل'],          lat: 21.4220, lng: 39.8270, emoji: '🏛️' },
    { name: 'مطعم الجامعة',          ar: ['مطعم','أكل','غداء','كافتيريا'],        lat: 21.4208, lng: 39.8255, emoji: '🍽️' },
    { name: 'المستشفى الجامعي',      ar: ['مستشفى','طبيب','صحة','عيادة'],         lat: 21.4195, lng: 39.8248, emoji: '🏥' },
    { name: 'ملاعب الجامعة',         ar: ['ملعب','رياضة','كرة'],                  lat: 21.4230, lng: 39.8280, emoji: '⚽' },
    { name: 'مركز التسجيل والقبول',  ar: ['تسجيل','قبول','تخرج','شهادة'],         lat: 21.4200, lng: 39.8260, emoji: '🎓' },
    { name: 'مسجد الجامعة',          ar: ['مسجد','صلاة','جامع'],                  lat: 21.4218, lng: 39.8268, emoji: '🕌' },
    { name: 'بوابة الجامعة الرئيسية',ar: ['بوابة','مدخل','دخول','خروج'],          lat: 21.4190, lng: 39.8240, emoji: '🚪' }
  ];

  /* ════════════════════════════════════════════════════════════════
     1. LOCATION WIDGET
     ════════════════════════════════════════════════════════════════ */

  function detectLocation(text) {
    const norm = text.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase();
    return UQU_LOCATIONS.find(loc =>
      loc.ar.some(kw => norm.includes(kw.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')))
    ) || null;
  }

  function renderMapWidget(location) {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
    const embedUrl = `https://maps.google.com/maps?q=${location.lat},${location.lng}&z=17&output=embed`;

    return `
<div class="chat-widget map-widget" style="margin-top:12px;border-radius:16px;overflow:hidden;
  border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow-sm);">

  <!-- Map header -->
  <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;
    background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(168,85,247,.08));
    border-bottom:1px solid var(--border);">
    <span style="font-size:1.5rem;">${location.emoji}</span>
    <div>
      <div style="font-weight:700;font-size:.92rem;color:var(--fg);">${location.name}</div>
      <div style="font-size:.75rem;color:var(--muted);">جامعة أم القرى · مكة المكرمة</div>
    </div>
    <a href="${mapsUrl}" target="_blank" rel="noopener"
      style="margin-right:auto;display:inline-flex;align-items:center;gap:6px;
        background:var(--accent);color:#fff;border:none;border-radius:20px;
        padding:6px 14px;font-size:.78rem;font-weight:700;text-decoration:none;
        cursor:pointer;transition:opacity .2s;"
      onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      فتح الخريطة
    </a>
  </div>

  <!-- Embedded map -->
  <div style="position:relative;height:200px;background:var(--bg-2);">
    <iframe
      src="${embedUrl}"
      width="100%" height="200" style="border:0;display:block;"
      loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"
      title="خريطة ${location.name}">
    </iframe>
    <div style="position:absolute;bottom:0;left:0;right:0;height:30px;
      background:linear-gradient(transparent,var(--surface));pointer-events:none;"></div>
  </div>

</div>`;
  }

  /* ════════════════════════════════════════════════════════════════
     2. EXAM COUNTDOWN CARD
     ════════════════════════════════════════════════════════════════ */

  function renderExamCard(exam) {
    const examDate = new Date(exam.date);
    const now      = new Date();
    const diffMs   = examDate - now;
    const diffDays = Math.ceil(diffMs / 86400000);

    const urgencyColor = diffDays <= 1 ? 'var(--danger)'
      : diffDays <= 3 ? 'var(--warning)'
      : diffDays <= 7 ? 'var(--accent)'
      : 'var(--success)';

    const typeLabel = {
      exam: 'اختبار', quiz: 'كويز', midterm: 'نصفي', final: 'نهائي', assignment: 'واجب'
    }[exam.exam_type || 'exam'] || 'اختبار';

    const countdownText = diffDays <= 0  ? '⚠️ اليوم!'
      : diffDays === 1 ? '⏰ غداً'
      : `${diffDays} يوم`;

    return `
<div class="chat-widget exam-card" style="margin-top:10px;border-radius:14px;
  border:1px solid ${urgencyColor}33;background:var(--surface);
  box-shadow:0 4px 20px ${urgencyColor}15;overflow:hidden;">

  <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;
    background:linear-gradient(135deg,${urgencyColor}12,transparent);">
    <div style="width:48px;height:48px;border-radius:12px;
      background:${urgencyColor}20;display:flex;align-items:center;
      justify-content:center;font-size:1.4rem;flex-shrink:0;">📅</div>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:800;font-size:.95rem;color:var(--fg);">${exam.subject}</div>
      <div style="font-size:.78rem;color:var(--muted);margin-top:2px;">${typeLabel} · ${exam.date}${exam.time ? ' · ' + exam.time : ''}</div>
    </div>
    <div style="text-align:center;flex-shrink:0;">
      <div style="font-size:1.1rem;font-weight:900;color:${urgencyColor};">${countdownText}</div>
      <div style="font-size:.7rem;color:var(--muted);">متبقي</div>
    </div>
  </div>

  ${exam.notes ? `<div style="padding:8px 16px 12px;font-size:.78rem;color:var(--muted);border-top:1px solid var(--border);">📝 ${exam.notes}</div>` : ''}

  <div style="padding:0 16px 14px;display:flex;gap:8px;">
    <a href="plan.html" style="flex:1;display:block;text-align:center;padding:8px;border-radius:10px;
      background:${urgencyColor}20;color:${urgencyColor};font-size:.8rem;font-weight:700;
      text-decoration:none;transition:background .2s;"
      onmouseover="this.style.background='${urgencyColor}35'" onmouseout="this.style.background='${urgencyColor}20'">
      📋 خطة المراجعة
    </a>
    <a href="pomodoro.html" style="flex:1;display:block;text-align:center;padding:8px;border-radius:10px;
      background:var(--surface-2);color:var(--fg);font-size:.8rem;font-weight:700;
      text-decoration:none;transition:background .2s;"
      onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--surface-2)'">
      ⏱️ ابدأ المذاكرة
    </a>
  </div>
</div>`;
  }

  /* ════════════════════════════════════════════════════════════════
     3. STUDY PLAN PREVIEW CARD
     ════════════════════════════════════════════════════════════════ */

  function renderPlanCard(plan) {
    if (!plan) return '';
    const tasks   = plan.tasks || [];
    const done    = tasks.filter(t => t.done).length;
    const pct     = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const pending = tasks.filter(t => !t.done).slice(0, 3);

    return `
<div class="chat-widget plan-card" style="margin-top:10px;border-radius:14px;
  border:1px solid var(--border);background:var(--surface);overflow:hidden;">

  <div style="padding:14px 16px;border-bottom:1px solid var(--border);
    background:linear-gradient(135deg,rgba(99,102,241,.08),transparent);
    display:flex;align-items:center;gap:10px;">
    <span style="font-size:1.4rem;">📋</span>
    <div style="flex:1;">
      <div style="font-weight:800;font-size:.9rem;color:var(--fg);">${plan.title || 'الخطة الدراسية'}</div>
      <div style="font-size:.75rem;color:var(--muted);margin-top:2px;">${done}/${tasks.length} مهام منجزة</div>
    </div>
    <div style="font-size:1rem;font-weight:900;color:var(--accent);">${pct}%</div>
  </div>

  <!-- Progress bar -->
  <div style="height:4px;background:var(--border);">
    <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--accent-2,#a855f7));
      transition:width .5s ease;border-radius:0 2px 2px 0;"></div>
  </div>

  <!-- Pending tasks -->
  <div style="padding:10px 16px;">
    ${pending.map(t => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="width:18px;height:18px;border:2px solid var(--border);border-radius:5px;flex-shrink:0;
        display:flex;align-items:center;justify-content:center;"></span>
      <span style="font-size:.82rem;color:var(--fg);flex:1;">${t.title}</span>
      <span style="font-size:.72rem;color:var(--muted);">${t.subject}</span>
    </div>`).join('')}
    ${pending.length === 0 ? '<div style="text-align:center;padding:8px;color:var(--success);font-size:.85rem;">✅ أنجزت كل المهام!</div>' : ''}
  </div>

  <div style="padding:8px 16px 12px;">
    <a href="plan.html" style="display:block;text-align:center;padding:9px;border-radius:10px;
      background:var(--accent);color:#fff;font-size:.82rem;font-weight:700;
      text-decoration:none;transition:opacity .2s;"
      onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
      فتح الخطة الكاملة ←
    </a>
  </div>
</div>`;
  }

  /* ════════════════════════════════════════════════════════════════
     4. GPA CARD
     ════════════════════════════════════════════════════════════════ */

  function renderGpaCard(profile) {
    const gpa    = parseFloat(profile?.goals?.currentGpa || profile?.currentGpa || 0);
    const target = parseFloat(profile?.goals?.targetGpa  || profile?.targetGpa  || 5);
    const pct    = Math.min(100, (gpa / 5) * 100);
    const color  = gpa >= 4 ? 'var(--success)' : gpa >= 3 ? 'var(--accent)' : gpa >= 2 ? 'var(--warning)' : 'var(--danger)';
    const label  = gpa >= 4.5 ? 'ممتاز' : gpa >= 3.75 ? 'جيد جداً' : gpa >= 3 ? 'جيد' : gpa >= 2 ? 'مقبول' : 'ضعيف';

    return `
<div class="chat-widget gpa-card" style="margin-top:10px;border-radius:14px;
  border:1px solid ${color}33;background:var(--surface);padding:16px;
  display:flex;align-items:center;gap:16px;">

  <!-- Ring -->
  <svg width="70" height="70" viewBox="0 0 70 70" style="flex-shrink:0;">
    <circle cx="35" cy="35" r="28" fill="none" stroke="var(--border)" stroke-width="6"/>
    <circle cx="35" cy="35" r="28" fill="none" stroke="${color}" stroke-width="6"
      stroke-dasharray="${2*Math.PI*28}" stroke-dashoffset="${2*Math.PI*28*(1-pct/100)}"
      stroke-linecap="round" transform="rotate(-90 35 35)" style="transition:stroke-dashoffset .8s ease;"/>
    <text x="35" y="40" text-anchor="middle" font-size="14" font-weight="900" fill="${color}"
      font-family="Cairo,sans-serif">${gpa.toFixed(2)}</text>
  </svg>

  <div style="flex:1;">
    <div style="font-size:.8rem;color:var(--muted);margin-bottom:4px;">المعدل التراكمي</div>
    <div style="font-size:1.2rem;font-weight:900;color:${color};">${gpa.toFixed(2)} <span style="font-size:.85rem;font-weight:500;color:var(--muted);">/ 5.00</span></div>
    <div style="display:inline-block;margin-top:4px;background:${color}20;color:${color};
      border-radius:20px;padding:2px 10px;font-size:.75rem;font-weight:700;">${label}</div>
    ${target > gpa ? `<div style="font-size:.75rem;color:var(--muted);margin-top:4px;">🎯 الهدف: ${target.toFixed(2)}</div>` : ''}
  </div>

  <a href="gpa.html" style="display:block;padding:8px 14px;border-radius:10px;
    background:${color}18;color:${color};font-size:.78rem;font-weight:700;
    text-decoration:none;flex-shrink:0;transition:background .2s;"
    onmouseover="this.style.background='${color}30'" onmouseout="this.style.background='${color}18'">
    تفاصيل ←
  </a>
</div>`;
  }

  /* ════════════════════════════════════════════════════════════════
     5. TRANSCRIPT ANALYSIS WIDGET — Full academic deep dive
     ════════════════════════════════════════════════════════════════ */

  function renderTranscriptAnalysis(data) {
    if (!data || !data.success) return '';

    const gpa        = parseFloat(data.currentGpa || 0);
    const target     = parseFloat(data.targetGpa  || 5);
    const pct        = Math.min(100, (gpa / 5) * 100);
    const progressPct= Math.min(100, (gpa / target) * 100);
    const gap        = parseFloat(data.gap || Math.max(0, target - gpa));
    const gpaColor   = gpa >= 4 ? 'var(--success)' : gpa >= 3 ? '#6366f1' : gpa >= 2 ? 'var(--warning)' : 'var(--danger)';
    const gpaLabel   = gpa >= 4.75 ? 'ممتاز بامتياز' : gpa >= 4 ? 'ممتاز' : gpa >= 3.75 ? 'جيد جداً' : gpa >= 3 ? 'جيد' : gpa >= 2 ? 'مقبول' : 'يحتاج تطوير';
    const weak       = data.weakSubjects    || [];
    const strong     = data.strongSubjects  || [];

    function diffLabel(d) {
      return d === 'hard' ? 'صعبة' : d === 'easy' ? 'سهلة' : 'متوسطة';
    }

    return `
<div class="chat-widget" style="margin-top:14px;border-radius:20px;overflow:hidden;
  border:1px solid var(--border);background:var(--surface);
  box-shadow:0 8px 40px rgba(99,102,241,.15);">

  <!-- ── Header ── -->
  <div style="padding:16px 20px;background:linear-gradient(135deg,rgba(99,102,241,.18),rgba(168,85,247,.12));
    border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;">
    <div style="width:48px;height:48px;border-radius:14px;
      background:linear-gradient(135deg,#6366f1,#a855f7);
      display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;
      box-shadow:0 4px 12px rgba(99,102,241,.4);">📊</div>
    <div style="flex:1;">
      <div style="font-weight:800;font-size:1rem;color:var(--fg);">تحليل السجل الأكاديمي</div>
      <div style="font-size:.75rem;color:var(--muted);margin-top:2px;">
        ${data.gradedCourses || 0} مادة مقيّمة · ${data.totalCourses || 0} مادة إجمالاً
        ${data.semesters ? ` · ${data.semesters} فصل دراسي` : ''}
      </div>
    </div>
    <div style="text-align:center;background:${gpaColor}18;border:1px solid ${gpaColor}33;
      border-radius:12px;padding:6px 14px;flex-shrink:0;">
      <div style="font-size:.68rem;color:var(--muted);">المعدل</div>
      <div style="font-size:1.1rem;font-weight:900;color:${gpaColor};">${gpa.toFixed(2)}</div>
    </div>
  </div>

  <!-- ── GPA Overview ── -->
  <div style="padding:18px 20px;display:flex;align-items:center;gap:20px;
    border-bottom:1px solid var(--border);">
    <!-- Ring -->
    <svg width="88" height="88" viewBox="0 0 88 88" style="flex-shrink:0;">
      <circle cx="44" cy="44" r="36" fill="none" stroke="var(--border)" stroke-width="7"/>
      <circle cx="44" cy="44" r="36" fill="none" stroke="${gpaColor}" stroke-width="7"
        stroke-dasharray="${(2*Math.PI*36).toFixed(1)}"
        stroke-dashoffset="${(2*Math.PI*36*(1-pct/100)).toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 44 44)"
        style="transition:stroke-dashoffset .9s ease;"/>
      <text x="44" y="50" text-anchor="middle" font-size="17" font-weight="900"
        fill="${gpaColor}" font-family="Cairo,sans-serif">${gpa.toFixed(2)}</text>
    </svg>
    <div style="flex:1;">
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:2px;">المعدل التراكمي</div>
      <div style="font-size:1.5rem;font-weight:900;color:${gpaColor};">
        ${gpa.toFixed(2)}<span style="font-size:.85rem;color:var(--muted);font-weight:400;"> / 5.00</span>
      </div>
      <div style="margin-top:8px;">
        <div style="display:flex;justify-content:space-between;font-size:.71rem;color:var(--muted);margin-bottom:4px;">
          <span>نحو الهدف ${target.toFixed(2)}</span>
          <span>${gap > 0 ? `متبقي ${gap} نقطة` : '✅ تحقق الهدف!'}</span>
        </div>
        <div style="height:7px;background:var(--border);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${progressPct.toFixed(0)}%;
            background:linear-gradient(90deg,${gpaColor},#a855f7);
            border-radius:4px;transition:width .9s ease;"></div>
        </div>
      </div>
      <div style="display:inline-block;margin-top:8px;background:${gpaColor}20;color:${gpaColor};
        border-radius:20px;padding:3px 12px;font-size:.74rem;font-weight:700;">${gpaLabel}</div>
    </div>
  </div>

  ${weak.length ? `
  <!-- ── Weak Subjects ── -->
  <div style="padding:14px 20px;border-bottom:1px solid var(--border);">
    <div style="font-size:.8rem;font-weight:700;color:var(--danger);margin-bottom:10px;
      display:flex;align-items:center;gap:6px;">
      <span style="width:22px;height:22px;background:rgba(239,68,68,.15);border-radius:6px;
        display:inline-flex;align-items:center;justify-content:center;font-size:.85rem;">⚠️</span>
      تحتاج اهتمام (${weak.length} مادة)
    </div>
    ${weak.map(s => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
      border-radius:12px;background:rgba(239,68,68,.07);
      border:1px solid rgba(239,68,68,.18);margin-bottom:7px;">
      <div style="width:42px;height:42px;border-radius:10px;
        background:rgba(239,68,68,.18);display:flex;align-items:center;
        justify-content:center;font-size:.88rem;font-weight:900;
        color:var(--danger);flex-shrink:0;">${s.grade.toFixed(1)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:.85rem;font-weight:700;color:var(--fg);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:1px;">
          ${s.code ? s.code + ' · ' : ''}${diffLabel(s.difficulty)}
        </div>
      </div>
      <div style="font-size:1.15rem;">${s.grade < 2 ? '🚨' : s.grade < 2.5 ? '⚠️' : '📌'}</div>
    </div>`).join('')}
  </div>` : ''}

  ${strong.length ? `
  <!-- ── Strong Subjects ── -->
  <div style="padding:14px 20px;border-bottom:1px solid var(--border);">
    <div style="font-size:.8rem;font-weight:700;color:var(--success);margin-bottom:8px;
      display:flex;align-items:center;gap:6px;">
      <span style="font-size:.9rem;">✅</span> نقاط القوة (${strong.length})
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${strong.map(s => `
      <div style="display:inline-flex;align-items:center;gap:6px;
        background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.22);
        border-radius:20px;padding:4px 12px;font-size:.75rem;color:var(--success);">
        ⭐ ${s.name}
        <span style="font-weight:800;background:rgba(34,197,94,.2);
          border-radius:10px;padding:1px 7px;">${s.grade.toFixed(1)}</span>
      </div>`).join('')}
    </div>
  </div>` : ''}

  ${(data.studyStyle && data.studyStyle !== 'لم يحدد') || data.focusDuration ? `
  <!-- ── Study Profile ── -->
  <div style="padding:12px 20px;border-bottom:1px solid var(--border);
    display:flex;align-items:center;gap:12px;background:rgba(99,102,241,.04);">
    <span style="font-size:1.3rem;">🎯</span>
    <div>
      <div style="font-size:.73rem;color:var(--muted);">ملف المذاكرة</div>
      <div style="font-size:.83rem;font-weight:700;color:var(--fg);">
        ${data.studyStyle !== 'لم يحدد' ? data.studyStyle + ' · ' : ''}تركيز ${data.focusDuration} دق
        ${data.studyTime && data.studyTime !== 'لم يحدد' ? ' · ' + data.studyTime : ''}
      </div>
    </div>
    ${data.recommendation ? `
    <div style="margin-right:auto;font-size:.72rem;color:var(--accent);
      background:rgba(99,102,241,.1);border-radius:8px;padding:4px 10px;max-width:180px;line-height:1.4;">
      💡 ${data.recommendation}
    </div>` : ''}
  </div>` : ''}

  <!-- ── Trend ── -->
  <div style="padding:12px 20px;border-bottom:1px solid var(--border);
    font-size:.8rem;color:var(--muted);display:flex;align-items:center;gap:8px;">
    <span style="font-size:1rem;">📊</span>
    <span style="color:var(--fg);font-weight:600;">${data.trend || ''}</span>
  </div>

  <!-- ── Actions ── -->
  <div style="padding:14px 20px;display:flex;gap:8px;">
    <a href="plan.html" style="flex:1;display:block;text-align:center;padding:10px;
      border-radius:12px;background:linear-gradient(135deg,#6366f1,#a855f7);
      color:#fff;font-size:.82rem;font-weight:700;text-decoration:none;
      box-shadow:0 4px 12px rgba(99,102,241,.3);transition:opacity .2s;"
      onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
      📋 خطة تحسين المعدل
    </a>
    <a href="gpa.html" style="flex:1;display:block;text-align:center;padding:10px;
      border-radius:12px;background:var(--surface-2);color:var(--fg);
      font-size:.82rem;font-weight:700;text-decoration:none;
      border:1px solid var(--border);transition:background .2s;"
      onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--surface-2)'">
      📈 تفاصيل المعدل
    </a>
  </div>
</div>`;
  }

  /* ════════════════════════════════════════════════════════════════
     6. GPA HISTORY WIDGET — Trend chart with mini bars
     ════════════════════════════════════════════════════════════════ */

  function renderGpaHistoryWidget(data) {
    if (!data || !data.success) return '';
    const history = data.history || [];
    const current = parseFloat(data.current || 0);
    const best    = parseFloat(data.best    || current);
    const trend   = data.trend || 'لا يوجد';
    const trendUp = trend.includes('↑') || trend.includes('صاعد');

    const gpaColor = current >= 4 ? 'var(--success)' : current >= 3 ? '#6366f1' : current >= 2 ? 'var(--warning)' : 'var(--danger)';
    const trendColor = trendUp ? 'var(--success)' : 'var(--danger)';

    let chartHtml = '';
    if (history.length >= 2) {
      const max    = Math.max(...history.map(s => s.gpa), 0.1);
      const W      = 240;
      const H      = 60;
      const barW   = Math.min(32, Math.floor((W - 10) / history.length) - 4);
      const spacing= Math.floor((W - 10) / history.length);

      const bars = history.map((s, i) => {
        const barH = Math.max(4, Math.round((s.gpa / 5) * H));
        const x    = 5 + i * spacing;
        const y    = H - barH;
        const col  = s.gpa >= 4 ? '#22c55e' : s.gpa >= 3 ? '#6366f1' : s.gpa >= 2 ? '#f59e0b' : '#ef4444';
        return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4"
          fill="${col}" opacity="${i === history.length - 1 ? '1' : '0.65'}"/>
          <text x="${x + barW/2}" y="${H + 10}" text-anchor="middle"
            font-size="8" fill="var(--muted)" font-family="Cairo,sans-serif">${s.gpa.toFixed(1)}</text>`;
      }).join('');

      const labels = history.map((s, i) => {
        const x = 5 + i * spacing + barW / 2;
        return `<text x="${x}" y="${H + 22}" text-anchor="middle" font-size="8"
          fill="var(--muted)" font-family="Cairo,sans-serif">${(s.name || '').slice(0, 4)}</text>`;
      }).join('');

      chartHtml = `
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);overflow-x:auto;">
        <svg width="${W}" height="${H + 28}" style="min-width:${W}px;display:block;margin:auto;">
          ${bars}${labels}
        </svg>
      </div>`;
    }

    return `
<div class="chat-widget" style="margin-top:12px;border-radius:18px;overflow:hidden;
  border:1px solid var(--border);background:var(--surface);
  box-shadow:0 6px 28px rgba(99,102,241,.1);">

  <div style="padding:14px 20px;border-bottom:1px solid var(--border);
    background:linear-gradient(135deg,rgba(99,102,241,.1),rgba(168,85,247,.07));
    display:flex;align-items:center;gap:12px;">
    <span style="font-size:1.4rem;">📈</span>
    <div style="flex:1;">
      <div style="font-weight:700;font-size:.9rem;color:var(--fg);">مسار المعدل التراكمي</div>
      <div style="font-size:.73rem;color:var(--muted);">${history.length} فصل مسجّل</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:1.2rem;font-weight:900;color:${gpaColor};">${current.toFixed(2)}</div>
      <div style="font-size:.65rem;color:${trendColor};font-weight:700;">${trend}</div>
    </div>
  </div>

  ${chartHtml || `<div style="padding:20px;text-align:center;color:var(--muted);font-size:.82rem;">أضف فصولاً دراسية في صفحة المعدل لرؤية المسار البياني</div>`}

  <div style="padding:12px 20px;display:flex;gap:0;border-top:1px solid var(--border);">
    <div style="flex:1;text-align:center;padding:8px;">
      <div style="font-size:.68rem;color:var(--muted);margin-bottom:3px;">الحالي</div>
      <div style="font-size:.95rem;font-weight:800;color:${gpaColor};">${current.toFixed(2)}</div>
    </div>
    <div style="width:1px;background:var(--border);"></div>
    <div style="flex:1;text-align:center;padding:8px;">
      <div style="font-size:.68rem;color:var(--muted);margin-bottom:3px;">الأعلى</div>
      <div style="font-size:.95rem;font-weight:800;color:var(--success);">${best.toFixed(2)}</div>
    </div>
    <div style="width:1px;background:var(--border);"></div>
    <div style="flex:1;text-align:center;padding:8px;">
      <div style="font-size:.68rem;color:var(--muted);margin-bottom:3px;">الاتجاه</div>
      <div style="font-size:.95rem;font-weight:800;color:${trendColor};">${trendUp ? '↑' : history.length >= 2 ? '↓' : '—'}</div>
    </div>
  </div>
</div>`;
  }

  /* ════════════════════════════════════════════════════════════════
     7. COURSE ADDED CARD
     ════════════════════════════════════════════════════════════════ */

  function renderCourseAddedCard(course) {
    const diffColors = { hard: 'var(--danger)', medium: '#f59e0b', easy: 'var(--success)' };
    const diffLabels = { hard: 'صعبة', medium: 'متوسطة', easy: 'سهلة' };
    const color = diffColors[course.difficulty || 'medium'] || '#6366f1';
    return `
<div class="chat-widget" style="margin-top:10px;border-radius:14px;
  border:1px solid rgba(99,102,241,.25);background:var(--surface);
  padding:14px 16px;display:flex;align-items:center;gap:12px;
  box-shadow:0 4px 16px rgba(99,102,241,.1);">
  <div style="width:44px;height:44px;border-radius:12px;
    background:linear-gradient(135deg,#6366f1,#a855f7);
    display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">📚</div>
  <div style="flex:1;">
    <div style="font-weight:800;font-size:.9rem;color:var(--fg);">${course.name}</div>
    <div style="font-size:.75rem;color:var(--muted);margin-top:2px;">
      ${course.code ? course.code + ' · ' : ''}
      <span style="color:${color};">${diffLabels[course.difficulty] || 'متوسطة'}</span>
      ${course.examDate ? ` · الاختبار: ${course.examDate}` : ''}
    </div>
  </div>
  <div style="background:rgba(34,197,94,.12);color:var(--success);
    border-radius:20px;padding:4px 10px;font-size:.73rem;font-weight:700;">✅ أضيفت</div>
</div>`;
  }

  /* ════════════════════════════════════════════════════════════════
     8. PROFILE UPDATED CARD
     ════════════════════════════════════════════════════════════════ */

  function renderProfileUpdateCard(field, value) {
    const fieldLabels = {
      currentGpa: 'المعدل الحالي', targetGpa: 'الهدف',
      studyStyle: 'أسلوب المذاكرة', focusDuration: 'مدة التركيز',
      studyTime: 'وقت المذاكرة', name: 'الاسم', major: 'التخصص'
    };
    return `
<div class="chat-widget" style="margin-top:10px;border-radius:14px;
  border:1px solid rgba(99,102,241,.2);background:var(--surface);
  padding:12px 16px;display:flex;align-items:center;gap:10px;">
  <span style="font-size:1.3rem;">👤</span>
  <div>
    <div style="font-size:.8rem;color:var(--muted);">تم تحديث ${fieldLabels[field] || field}</div>
    <div style="font-size:.88rem;font-weight:700;color:var(--fg);">${value}</div>
  </div>
  <div style="margin-right:auto;background:rgba(34,197,94,.1);color:var(--success);
    border-radius:20px;padding:3px 10px;font-size:.73rem;font-weight:700;">محفوظ ✓</div>
</div>`;
  }

  /* ════════════════════════════════════════════════════════════════
     9. AGENT THINKING INDICATOR (while AI is processing tools)
     ════════════════════════════════════════════════════════════════ */

  function renderThinkingBadge(toolName) {
    const labels = {
      add_upcoming_exam:  '📅 يسجّل الاختبار...',
      create_study_plan:  '📋 يبني خطة المذاكرة...',
      send_notification:  '🔔 يرسل إشعار...',
      analyze_transcript: '🔍 يحلّل السجل الأكاديمي...',
      get_student_data:   '📊 يقرأ بياناتك...',
      get_upcoming_exams: '📅 يجلب الاختبارات...',
      add_course:         '📚 يضيف المادة...',
      complete_task:      '✅ يحدّث المهام...',
      update_profile:     '👤 يحدّث الملف...'
    };
    return labels[toolName] || '⚡ يعالج طلبك...';
  }

  /* ════════════════════════════════════════════════════════════════
     6. MAIN RENDER — Called after each AI response
     ════════════════════════════════════════════════════════════════ */

  /**
   * Analyze AI response text + actions and return HTML for any widgets
   * @param {string} responseText
   * @param {Array}  actions  — from backend
   * @returns {string} HTML string
   */
  /**
   * @param {string} responseText  — AI reply text
   * @param {Array}  actions       — tool actions executed by AI
   * @param {string} userMessage   — original user message (used for location detection)
   */
  function renderWidgets(responseText, actions = [], userMessage = '') {
    let html = '';

    /* ── Transcript Analysis widget ── */
    const transcriptAction = actions.find(a => a.tool === 'analyze_transcript' && a.result?.success);
    if (transcriptAction) {
      html += renderTranscriptAnalysis(transcriptAction.result);
    }

    /* ── GPA History widget ── */
    const gpaHistoryAction = actions.find(a => a.tool === 'get_gpa_history' && a.result?.success);
    if (gpaHistoryAction) {
      html += renderGpaHistoryWidget(gpaHistoryAction.result);
    }

    /* ── Course Added card ── */
    const courseAction = actions.find(a => a.tool === 'add_course' && a.result?.success);
    if (courseAction) {
      html += renderCourseAddedCard({
        name:       courseAction.args?.name,
        code:       courseAction.args?.code,
        difficulty: courseAction.args?.difficulty || 'medium',
        examDate:   courseAction.args?.examDate
      });
    }

    /* ── Profile Updated card ── */
    const profileAction = actions.find(a => a.tool === 'update_profile' && a.result?.success);
    if (profileAction) {
      html += renderProfileUpdateCard(profileAction.args?.field, profileAction.args?.value);
    }

    /* ── Map widget — ONLY when user explicitly asks about a location ── */
    const locationKeywords = ['وين','فين','أين','مكان','موقع','كيف أوصل','طريق','خريطة','map','مبنى','بناية','قاعة','مكتبة','مطعم','مسجد','بوابة','مستشفى','ملعب','تسجيل'];
    const userAskedLocation = locationKeywords.some(k => userMessage.includes(k));
    if (userAskedLocation) {
      const location = detectLocation(userMessage) || detectLocation(responseText);
      if (location) html += renderMapWidget(location);
    }

    /* ── Exam card (from action) ── */
    const examAction = actions.find(a => a.tool === 'add_upcoming_exam' && a.result?.success);
    if (examAction) {
      html += renderExamCard({
        subject:   examAction.args?.subject || '',
        date:      examAction.args?.date    || '',
        time:      examAction.args?.time,
        exam_type: examAction.args?.exam_type || 'exam',
        notes:     examAction.args?.notes
      });
    }

    /* ── Plan card (from action) ── */
    const planAction = actions.find(a => a.tool === 'create_study_plan' && a.result?.success);
    if (planAction) {
      html += renderPlanCard({
        title: planAction.args?.title,
        tasks: planAction.args?.tasks || []
      });
    }

    /* ── GPA card — only when user asks about GPA and no transcript analysis shown ── */
    if (!transcriptAction) {
      const gpaUserKeywords = ['معدلي','معدل','gpa','cgpa','نسبتي','كم معدل'];
      const userAskedGpa = gpaUserKeywords.some(k => userMessage.toLowerCase().includes(k));
      if (userAskedGpa) {
        const profile = window.DataBridge ? window.DataBridge.getProfile() : null;
        const gpa     = profile?.goals?.currentGpa || profile?.currentGpa;
        if (gpa) html += renderGpaCard(profile);
      }
    }

    return html;
  }

  /* ════════════════════════════════════════════════════════════════
     PUBLIC API
     ════════════════════════════════════════════════════════════════ */
  window.ChatWidgets = {
    renderWidgets,
    renderMapWidget,
    renderExamCard,
    renderPlanCard,
    renderGpaCard,
    renderTranscriptAnalysis,
    renderGpaHistoryWidget,
    renderCourseAddedCard,
    renderProfileUpdateCard,
    renderThinkingBadge,
    detectLocation
  };

}(window));
