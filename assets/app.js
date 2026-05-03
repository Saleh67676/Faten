/**
 * ====================================================================
 * UQU ACADEMIC ASSISTANT — CORE ENGINE (ENTERPRISE EDITION)
 * ====================================================================
 * @version 5.0.0 (Merged Pages: Chat, GPA, Dashboard, Plan, Locations, Profile)
 */

(function () {
  'use strict';

  // =================================================================
  // 1. SYSTEM UTILITIES & HELPER CLASSES
  // =================================================================

  const Utils = {
    $: (sel, ctx = document) => ctx.querySelector(sel),
    $$: (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel)),

    createElement: (tag, className, text = '') => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text) el.textContent = text;
      return el;
    },

    Storage: {
      get: (key, fallback) => {
        try {
          const item = localStorage.getItem(key);
          return item ? JSON.parse(item) : fallback;
        } catch (e) {
          return fallback;
        }
      },
      set: (key, value) => {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {}
      },
      remove: (key) => localStorage.removeItem(key)
    },

    debounce: (func, wait) => {
      let timeout;
      return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    },

    random: (min, max) => Math.floor(Math.random() * (max - min + 1) + min)
  };

  // =================================================================
  // 2. UI MANAGER (THEME, TOASTS, ANIMATIONS)
  // =================================================================

  class UIManager {
    constructor() {
      window.__ui = this;
      this.init();
    }

    init() {
      // ── Delegate to UQUCore (single implementations) ──
      const C = window.UQUCore;
      if (C) {
        C.Theme.init();
        C.initHeaderScroll();
        C.initMobileNav();
        C.stampYear();
        C.observeReveal('.animate-block');
      } else {
        // Graceful fallback when core hasn't loaded yet
        this._legacyInit();
      }
    }

    /** Called only if UQUCore is not available (should never happen in production) */
    _legacyInit() {
      const saved = Utils.Storage.get('uqu_theme', 'auto');
      document.body.setAttribute('data-theme', saved);
      const btn = Utils.$('#themeToggle');
      if (btn) btn.addEventListener('click', () => this.toggleTheme());
      const yearSpan = Utils.$('#year');
      if (yearSpan) yearSpan.textContent = new Date().getFullYear();
    }

    showToast(message, type = 'info') {
      // Delegate to UQUCore.toast (single impl)
      if (window.UQUCore?.toast) {
        window.UQUCore.toast(message, type);
        return;
      }
    }

    setTheme(mode) { window.UQUCore?.Theme.set(mode) ?? document.body.setAttribute('data-theme', mode); }
    toggleTheme()  { window.UQUCore?.Theme.toggle(); }
  }
// =================================================================
// 3. DASHBOARD CONTROLLER (مرتبط بالبروفايل والخطة والمهام)
// =================================================================

class DashboardController {
  constructor() {
    const page = document.body?.dataset?.page;
    if (page !== 'dashboard') return;

    // ── Single accessor — no more triple-fallback ──
    const C = window.UQUCore;
    this.profile   = C ? C.getProfile()  : Utils.Storage.get('uqu_profile_v2', null);
    this.planState = C ? C.getPlan()     : (Utils.Storage.get('uqu_plan_v5', null) || { plan: [], tasks: [], weeks: 0 });

    this.refs = {
      currentGpa:   Utils.$('#dashCurrentGpa'),
      gpaDelta:     Utils.$('#dashGpaDelta'),
      expectedGpa:  Utils.$('#dashExpectedGpa'),
      expectedHint: Utils.$('#dashExpectedHint'),
      hoursValue:   Utils.$('#dashHoursValue'),
      hoursText:    Utils.$('#dashHoursText'),
      alertsCount:  Utils.$('#dashAlertsCount'),
      alertsText:   Utils.$('#dashAlertsText'),
      courseGoals:  Utils.$('#dashCourseGoals'),
      upcomingList: Utils.$('#dashUpcomingList'),
      yearSpan:     Utils.$('#year'),
      // New smart dashboard refs
      insights:     Utils.$('#dashInsights'),
      greeting:     Utils.$('#dash-greeting'),
      streakNum:    Utils.$('#streak-num'),
      streakNum2:   Utils.$('#streak-num-2'),
      gpaGapChip:   Utils.$('#gpa-gap-chip'),
      examCountdowns:Utils.$('#exam-countdowns'),
      examLabel:    Utils.$('#exam-countdowns-label'),
    };

    this.initOverview();
    this.initUpcoming();
    this.initGoals();
    this.initChart();
    this.initGreeting();
    this.initInsights();
    this.initExamCountdown();
    this.initStreakDisplay();

    if (this.refs.yearSpan) {
      this.refs.yearSpan.textContent = new Date().getFullYear();
    }

    // ── DataBridge: Sync GPA from gpa_data → profile on dashboard load ──
    if (window.DataBridge) {
      window.DataBridge.syncProfileFromGpa();
      window.DataBridge.on('profile:updated', () => {
        this.profile = window.DataBridge.getProfile()?._raw || this.profile;
        this.initOverview();
        this.initInsights();
        this.initExamCountdown();
      });
      window.DataBridge.on('task:added', () => {
        this.planState = Utils.Storage.get('uqu_plan_v5', null) || this.planState;
        this.initUpcoming();
      });
    }

    // ── Listen for AI updates from chat page (cross-tab BroadcastChannel) ──
    try {
      this._bc = new BroadcastChannel('uqu_sync');
      this._bc.onmessage = () => this._refreshAll();
    } catch(e) {}

    // ── Cross-tab storage event (fallback when BroadcastChannel unavailable) ──
    // Fires in OTHER tabs when localStorage changes — covers AI tasks created
    // in chat.html showing up on dashboard.html instantly.
    window.addEventListener('storage', (e) => {
      if (!e.key) return;
      const watched = [
        'uqu_plan_v5', 'uqu_plan_v5_ping',
        'uqu_profile_v2',
        'uqu_exams', 'uqu_exams_ping',
        'uqu_notifications'
      ];
      if (watched.indexOf(e.key) !== -1) {
        this._refreshAll();
      }
    });

    // ── Refresh on visibility (returning to dashboard tab) ──
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this._refreshAll();
    });

    // ── Listen for Firestore real-time events (Zero-Refresh UX) ──
    window.addEventListener('uqu:profileUpdated', () => {
      this.profile = Utils.Storage.get('uqu_profile_v2', null);
      this._refreshAll();
    });
    window.addEventListener('uqu:examsUpdated', () => this._refreshExams());
    window.addEventListener('uqu:planUpdated', () => {
      this.planState = Utils.Storage.get('uqu_plan_v5', null) || this.planState;
      this.initUpcoming();
    });
    window.addEventListener('uqu:notificationsUpdated', (e) => {
      // Update notification badge if it exists
      const badge = Utils.$('#notif-badge') || Utils.$('.notif-badge');
      if (badge && e.detail?.unreadCount !== undefined) {
        badge.textContent = e.detail.unreadCount;
        badge.style.display = e.detail.unreadCount > 0 ? '' : 'none';
      }
    });

    // ── Full refresh when Firestore sync completes (login/page load) ──
    window.addEventListener('uqu:firebaseReady', () => {
      // Small delay to let localStorage cache settle
      setTimeout(() => {
        this.profile = Utils.Storage.get('uqu_profile_v2', null);
        this.planState = Utils.Storage.get('uqu_plan_v5', null) || { plan: [], tasks: [], weeks: 0 };
        this._refreshAll();
      }, 300);
    });
  }

  _refreshAll() {
    this.profile   = Utils.Storage.get('uqu_profile_v2', null);
    this.planState = Utils.Storage.get('uqu_plan_v5', null) || { plan: [], tasks: [], weeks: 0 };
    this.initOverview();
    this.initUpcoming();
    this.initGoals();
    this.initChart();          // ← re-render GPA progress chart on each refresh
    this.initGreeting();
    this.initInsights();
    this.initExamCountdown();
    this.initStreakDisplay();
  }

  _refreshExams() {
    this.initExamCountdown();
    this.initUpcoming();
    this.initInsights();
  }

  // ----------------- كروت المعدل + الساعات + التنبيهات -----------------

  initOverview() {
    const goals = this.profile?.goals || {};
    const currentGpa = goals.currentGpa ?? null;
    const targetGpa  = goals.targetGpa  ?? null;

    // المعدل الحالي — لون يعكس مستوى المعدل دلالياً
    if (this.refs.currentGpa) {
      this.refs.currentGpa.textContent =
        currentGpa != null && !Number.isNaN(currentGpa)
          ? Number(currentGpa).toFixed(2)
          : '—';
      // تلوين ديناميكي: أخضر > 4، أزرق 3-4، برتقالي 2-3، أحمر < 2
      if (currentGpa != null && !Number.isNaN(currentGpa)) {
        const gpaVal = Number(currentGpa);
        const gpaColor = gpaVal >= 4
          ? 'var(--success)'
          : gpaVal >= 3
            ? 'var(--accent)'
            : gpaVal >= 2
              ? 'var(--warning)'
              : 'var(--danger)';
        this.refs.currentGpa.style.color = gpaColor;
      }
    }

    // المعدل المتوقع
    if (this.refs.expectedGpa) {
      const exp =
        targetGpa != null && !Number.isNaN(targetGpa)
          ? targetGpa
          : currentGpa;
      this.refs.expectedGpa.textContent =
        exp != null && !Number.isNaN(exp) ? Number(exp).toFixed(2) : '—';
    }

    // الفرق بين الحالي والهدف
    if (this.refs.gpaDelta) {
      if (currentGpa != null && targetGpa != null) {
        const diff = targetGpa - currentGpa;
        if (Math.abs(diff) < 0.01) {
          this.refs.gpaDelta.style.color = 'var(--muted)';
          this.refs.gpaDelta.textContent = 'هدفك يساوي تقريبًا معدلك الحالي.';
        } else if (diff > 0) {
          this.refs.gpaDelta.style.color = 'var(--success)';
          this.refs.gpaDelta.textContent =
            `تحتاج لرفع معدلك بحوالي +${diff.toFixed(2)} نقطة خلال هذا الفصل.`;
        } else {
          this.refs.gpaDelta.style.color = 'var(--accent-2)';
          this.refs.gpaDelta.textContent =
            `أنت أعلى من الهدف بحوالي ${Math.abs(diff).toFixed(2)} نقطة.`;
        }
      } else {
        this.refs.gpaDelta.style.color = 'var(--muted)';
        this.refs.gpaDelta.textContent =
          'أدخل معدلك الحالي والهدف من صفحة البروفايل / صفحة المعدل.';
      }
    }

    if (this.refs.expectedHint) {
      if (targetGpa != null) {
        this.refs.expectedHint.textContent =
          'تم احتساب المعدل المتوقع من هدفك في البروفايل.';
      } else {
        this.refs.expectedHint.textContent =
          'حدد المعدل المستهدف في البروفايل ليظهر هنا.';
      }
    }

    // ساعات الخطة الدراسية الفعلية للطالب (مستخرجة من البروفايل + الخطة الدراسية)
    // الأولوية: الساعات المعتمدة من المواد المسجّلة (الخطة الفعلية) ثم وقت الجلسات المجدولة
    const planInfo = this.computePlanHours();
    const { totalHours, weeks, source } = planInfo;
    if (this.refs.hoursValue) {
      this.refs.hoursValue.textContent = totalHours.toFixed(1);
    }
    if (this.refs.hoursText) {
      const courses = this.profile?.courses || [];
      if (!courses.length && (!this.planState || !this.planState.plan || !this.planState.plan.length)) {
        this.refs.hoursText.textContent =
          'لا توجد خطة دراسية بعد. أضف موادك من البروفايل أو أنشئ خطة من صفحة الخطة.';
      } else if (source === 'curriculum') {
        this.refs.hoursText.textContent =
          `${totalHours.toFixed(1)} ساعة معتمدة من خطتك الدراسية (${courses.length} مادة).`;
      } else {
        this.refs.hoursText.textContent =
          `إجمالي الساعات المجدولة خلال ${weeks || 1} أسبوع/أسابيع.`;
      }
    }

    // تنبيهات: اختبارات خلال 7 أيام قادمة (من البروفايل)
    const examsInfo = this.computeUpcomingExams();
    if (this.refs.alertsCount) {
      this.refs.alertsCount.textContent = examsInfo.count.toString();
    }
    if (this.refs.alertsText) {
      if (!examsInfo.count) {
        this.refs.alertsText.textContent = 'لا توجد اختبارات خلال 7 أيام قادمة.';
      } else if (examsInfo.nearestDiffDays === 0) {
        this.refs.alertsText.textContent =
          'لديك اختبار اليوم! راجع خطة المذاكرة.';
      } else {
        this.refs.alertsText.textContent =
          `هناك ${examsInfo.count} اختبار/اختبارات خلال 7 أيام. أقربها بعد ${examsInfo.nearestDiffDays} يوم.`;
      }
    }
  }

  computePlanHours() {
    // PRIORITY 1: Actual student curriculum (registered courses with credit hours)
    // This reflects the student's real academic plan, not the auto-generated schedule
    const courses = (this.profile && this.profile.courses) || [];
    if (courses.length) {
      const credits = courses.reduce((sum, c) => {
        const h = Number(c.creditHours || c.credits || c.hours || 0);
        return sum + (isFinite(h) ? h : 0);
      }, 0);
      if (credits > 0) {
        return {
          totalHours: credits,
          weeks: (this.planState && this.planState.weeks) || 0,
          source: 'curriculum'
        };
      }
    }

    // PRIORITY 2: Fallback to scheduled session minutes (auto-generated plan)
    const state = this.planState;
    if (!state || !state.plan || !state.plan.length) {
      return { totalHours: 0, weeks: (state && state.weeks) || 0, source: 'empty' };
    }

    let totalMins = 0;
    state.plan.forEach((t) => {
      const from = t.time;
      const to   = t.timeEnd || t.time;
      if (!from || !to) return;
      const [h1, m1] = from.split(':').map(Number);
      const [h2, m2] = to.split(':').map(Number);
      const startM = h1 * 60 + m1;
      const endM   = h2 * 60 + m2;
      if (endM > startM) totalMins += (endM - startM);
    });

    return {
      totalHours: totalMins / 60,
      weeks: this.planState.weeks || 0,
      source: 'schedule'
    };
  }

  computeUpcomingExams() {
    const courses = this.profile?.courses || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let count = 0;
    let nearestDiffDays = null;

    courses.forEach((c) => {
      if (!c.examDate) return;
      const d = new Date(c.examDate + 'T00:00:00');
      const diffDays = Math.round(
        (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays >= 0 && diffDays <= 7) {
        count++;
      }
      if (diffDays >= 0) {
        if (nearestDiffDays === null || diffDays < nearestDiffDays) {
          nearestDiffDays = diffDays;
        }
      }
    });

    return { count, nearestDiffDays };
  }

  // ----------------- أهداف المواد من البروفايل -----------------

  initGoals() {
    const container = this.refs.courseGoals;
    if (!container) return;

    const courses = this.profile?.courses || [];
    container.innerHTML = '';

    if (!courses.length) {
      container.innerHTML =
        '<p class="muted" style="font-size:0.85rem;">أضف موادك وأهداف التقدم من صفحة البروفايل ليتم عرضها هنا.</p>';
      return;
    }

    // نرتب المواد بالأقل تقدماً (الأهم أولاً)
    const sorted = [...courses].sort((a, b) => {
      const aProg = a.currentProgress || 0;
      const bProg = b.currentProgress || 0;
      return aProg - bProg;
    });

    sorted.slice(0, 4).forEach((c) => {
      const current = Math.max(
        0,
        Math.min(100, parseFloat(c.currentProgress) || 0)
      );
      const target = Math.max(
        current,
        Math.min(100, parseFloat(c.targetProgress) || 100)
      );
      const pct = target > 0 ? (current / target) * 100 : current;

      const wrapper = document.createElement('div');

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.marginBottom = '8px';
      header.style.fontWeight = '600';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = c.name || 'مقرر بدون اسم';

      const valSpan = document.createElement('span');
      valSpan.style.color = 'var(--accent)';
      valSpan.textContent = `${Math.round(current)}%`;

      header.appendChild(nameSpan);
      header.appendChild(valSpan);

      const barOuter = document.createElement('div');
      barOuter.style.height = '8px';
      barOuter.style.background = 'var(--border)';
      barOuter.style.borderRadius = '99px';
      barOuter.style.overflow = 'hidden';

      const barInner = document.createElement('div');
      barInner.style.height = '100%';
      barInner.style.width = `${Math.max(5, Math.min(100, pct))}%`;
      barInner.style.background = 'var(--accent)';
      barInner.style.borderRadius = '99px';

      barOuter.appendChild(barInner);
      wrapper.appendChild(header);
      wrapper.appendChild(barOuter);

      container.appendChild(wrapper);
    });
  }

  // ----------------- مهام قادمة من خطة المذاكرة -----------------
  // تعتمد على state.plan الذي يولّده initPlanPage الجديد
// داخل DashboardController class ...

initUpcoming() {
  const list = this.refs.upcomingList;
  if (!list) return;

  list.innerHTML = '';

  const state = this.planState;
  if (!state || !state.plan || !state.plan.length) {
    list.innerHTML = `
      <li style="display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:20px 12px;gap:8px;text-align:center;list-style:none;">
        <div style="font-size:1.8rem;opacity:.35;">📋</div>
        <div style="font-size:.85rem;font-weight:700;color:var(--muted);">لا توجد مهام مجدولة</div>
        <a href="plan.html" style="color:var(--accent);font-weight:700;font-size:.8rem;">أنشئ خطتك الآن →</a>
      </li>`;
    return;
  }

  const now = new Date();
  // لا نصفر الثواني هنا لكي نكون دقيقين، لكن للمقارنة العامة لا بأس

  // فلترة وترتيب المهام
  const futureTasks = state.plan
    .map((t) => {
      let effectiveDateStr = t.date;
      let effectiveTimeStr = t.time;

      // لو المهمة يدوية وعندها موعد تسليم/اختبار نستخدم الـ deadline
      if (t.kind === 'manual' && t.deadlineDate) {
        effectiveDateStr = t.deadlineDate;
        effectiveTimeStr = t.deadlineTime || t.time;
      }

      if (!effectiveDateStr || !effectiveTimeStr) return null;

      const dt = new Date(effectiveDateStr + 'T' + effectiveTimeStr + ':00');
      return {
        ...t,
        _dt: dt,
        _isDeadline: !!t.deadlineDate
      };
    })
    .filter((t) => {
      if (!t) return false;
      if (t._dt < now) return false;
      const diffMs = t._dt.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      // 👇 فقط ما هو خلال 7 أيام قادمة
      return diffDays <= 7;
    })
    .sort((a, b) => a._dt - b._dt)
    .slice(0, 4);


  if (!futureTasks.length) {
    list.innerHTML = `
      <li style="display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:20px 12px;gap:8px;text-align:center;list-style:none;">
        <div style="font-size:1.8rem;opacity:.35;">✅</div>
        <div style="font-size:.85rem;font-weight:700;color:var(--muted);">لا توجد مهام خلال الأسبوع القادم</div>
        <a href="plan.html" style="color:var(--accent);font-weight:700;font-size:.8rem;">إضافة مهام →</a>
      </li>`;
    return;
  }

  futureTasks.forEach((t) => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.padding = '10px';
    li.style.background = 'var(--bg)';
    li.style.borderRadius = '12px';
    li.style.marginBottom = '8px';
    li.style.border = '1px solid var(--border)';

    // الجانب الأيمن (اللون والعنوان)
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.gap = '10px';
    left.style.alignItems = 'center';

    const dot = document.createElement('span');
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.background = t.courseColor || 'var(--accent)';
    // تغيير شكل النقطة إذا كانت واجب أو اختبار
    if (t.type === 'exam' || t.type === 'project') {
       dot.style.borderRadius = '2px'; // مربع للمشاريع
    }

    const infoDiv = document.createElement('div');
    infoDiv.style.display = 'flex';
    infoDiv.style.flexDirection = 'column';

    const title = document.createElement('span');
    title.style.fontSize = '0.9rem';
    title.style.fontWeight = '600';
    title.textContent = t.title || t.courseName || 'مهمة';

    const subTitle = document.createElement('span');
    subTitle.style.fontSize = '0.75rem';
    subTitle.style.color = 'var(--muted)';
    // عرض نوع المهمة
    const typeAr = t.type === 'exam' ? 'اختبار' : t.type === 'assignment' ? 'واجب' : t.type === 'project' ? 'مشروع' : 'مذاكرة';
    subTitle.textContent = t._isDeadline ? `تسليم/موعد: ${typeAr}` : typeAr;

    infoDiv.appendChild(title);
    infoDiv.appendChild(subTitle);

    left.appendChild(dot);
    left.appendChild(infoDiv);

    // الجانب الأيسر (الوقت المتبقي أو التاريخ)
    const right = document.createElement('div');
    right.style.textAlign = 'left';
    
    const dateOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    const dateText = t._dt.toLocaleDateString('ar-SA', dateOptions);
    const timeText = t._dt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute:'2-digit' });

    // حساب الفرق بالأيام
    const diffTime = Math.abs(t._dt - now);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    
    let badgeColor = 'var(--muted)';
    let badgeText = dateText;

    if (diffDays <= 1) {
        badgeText = diffDays === 0 ? 'اليوم' : 'غداً';
        badgeColor = 'var(--warning)';
    } else if (diffDays <= 3) {
        badgeColor = 'var(--accent)';
    }

    right.innerHTML = `
        <div style="font-size:0.8rem; font-weight:bold; color:${badgeColor}">${badgeText}</div>
        <div style="font-size:0.7rem; color:var(--muted)">${timeText}</div>
    `;

    li.appendChild(left);
    li.appendChild(right);

    list.appendChild(li);
  });
}

  // ─── Personalised greeting ───
  initGreeting() {
    const el = this.refs.greeting;
    if (!el) return;
    const name = this.profile?.basic?.name || this.profile?.name || null;
    const hour = new Date().getHours();
    const tod  = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء النور';
    el.textContent = name ? `${tod}، ${name}! إليك ملخص أدائك الأكاديمي.` : `${tod}! إليك ملخص أدائك الأكاديمي.`;
  }

  // ─── Smart Insights panel ───
  initInsights() {
    const el = this.refs.insights;
    if (!el) return;

    const goals   = this.profile?.goals   || {};
    const courses = this.profile?.courses || [];
    const plan    = this.planState;

    const insights = [];

    // 1) GPA gap insight
    const curr  = parseFloat(goals.currentGpa);
    const tgt   = parseFloat(goals.targetGpa);
    if (!isNaN(curr) && !isNaN(tgt)) {
      const diff = tgt - curr;
      if (diff > 0.5) {
        insights.push({ icon:'📈', bg:'rgba(99,102,241,.1)', type:'info',
          title:'مسافة عن الهدف', body:`تحتاج +${diff.toFixed(2)} نقطة للوصول للهدف.`,
          href:'gpa.html' });
        if (this.refs.gpaGapChip) {
          this.refs.gpaGapChip.className = 'insight-chip warning';
          this.refs.gpaGapChip.textContent = `${diff.toFixed(2)} نقطة للهدف`;
          this.refs.gpaGapChip.style.display = 'inline-flex';
        }
      } else if (diff <= 0) {
        insights.push({ icon:'🏆', bg:'rgba(16,185,129,.1)', type:'success',
          title:'تجاوزت هدفك!', body:'معدلك الحالي يساوي أو يتجاوز الهدف. أحسنت!',
          href:'gpa.html' });
      } else {
        insights.push({ icon:'🎯', bg:'rgba(99,102,241,.1)', type:'info',
          title:'قريب من الهدف', body:`تحتاج +${diff.toFixed(2)} فقط للوصول للمستهدف.`,
          href:'gpa.html' });
      }
    } else {
      insights.push({ icon:'📊', bg:'rgba(99,102,241,.1)', type:'info',
        title:'أدخل بياناتك', body:'أضف معدلك الحالي والهدف للحصول على تحليل دقيق.',
        href:'profile.html' });
    }

    // 1b) Diagnostics-based insights (requires uqu_semesters data)
    try {
      if (window.UQUDiagnostics) {
        const sems = JSON.parse(localStorage.getItem('uqu_semesters') || '[]');
        if (sems.length > 0) {
          const diag = window.UQUDiagnostics.generateDiagnostics(sems, courses, goals);
          // Trend insight
          if (diag.trendDir === 'rising') {
            insights.push({ icon:'🚀', bg:'rgba(16,185,129,.1)', type:'success',
              title:'مسارك في تحسّن مستمر',
              body:`معدلك يرتفع عبر الفصول. استمر! أفضل فصل: ${diag.bestSem?.name || '—'} (${diag.bestSem?.gpa?.toFixed(2) || '—'}).`,
              href:'gpa.html' });
          } else if (diag.trendDir === 'falling') {
            insights.push({ icon:'⚠️', bg:'rgba(245,158,11,.1)', type:'warning',
              title:'انتبه: معدلك في تراجع',
              body:`حدث انخفاض في المعدل خلال الفصول الأخيرة. راجع مواد الضعف.`,
              href:'gpa.html' });
          }
          // Weaknesses insight
          if (diag.weaknesses?.length > 0) {
            const wkNames = diag.weaknesses.slice(0,2).map(c => c.name).join(' · ');
            insights.push({ icon:'🔴', bg:'rgba(239,68,68,.1)', type:'danger',
              title:`${diag.weaknesses.length} مادة تحتاج تحسيناً`,
              body: wkNames,
              href:'gpa.html' });
          }
          // Strengths insight
          if (diag.strengths?.length > 0) {
            insights.push({ icon:'⭐', bg:'rgba(16,185,129,.1)', type:'success',
              title:`${diag.strengths.length} مادة بتقدير ممتاز`,
              body: diag.strengths.slice(0,2).map(c => c.name).join(' · '),
              href:'gpa.html' });
          }
        }
      }
    } catch(e) { /* diagnostics unavailable, skip */ }

    // 2) Plan insight
    const sessions = plan?.plan?.length ?? 0;
    if (!sessions) {
      insights.push({ icon:'📅', bg:'rgba(245,158,11,.1)', type:'warning',
        title:'لا توجد خطة دراسية', body:'أنشئ خطة مذاكرة ذكية لتنظيم وقتك.',
        href:'plan.html' });
    } else {
      const weeklyAvg = sessions / Math.max(plan?.weeks || 1, 1);
      insights.push({ icon:'📅', bg:'rgba(6,182,212,.1)', type:'info',
        title:'معدل الجلسات الأسبوعية', body:`${weeklyAvg.toFixed(1)} جلسة / أسبوع عبر ${sessions} جلسة إجمالاً.`,
        href:'plan.html' });
    }

    // 3) Exam insight
    const urgentExams = courses.filter(c => {
      if (!c.examDate) return false;
      const days = Math.round((new Date(c.examDate+'T00:00:00') - new Date()) / 86400000);
      return days >= 0 && days <= 3;
    });
    if (urgentExams.length) {
      insights.push({ icon:'🚨', bg:'rgba(239,68,68,.1)', type:'danger',
        title:`${urgentExams.length} اختبار خلال 3 أيام!`,
        body: urgentExams.slice(0,2).map(c=>c.name).join(' · '),
        href:'plan.html' });
    } else if (courses.length) {
      const nextExam = courses
        .filter(c => c.examDate)
        .map(c => ({ name:c.name, days: Math.round((new Date(c.examDate+'T00:00:00') - new Date()) / 86400000) }))
        .filter(c => c.days >= 0)
        .sort((a,b) => a.days - b.days)[0];
      if (nextExam) {
        insights.push({ icon:'⏰', bg:'rgba(245,158,11,.1)', type:'warning',
          title:'أقرب اختبار', body:`${nextExam.name} — بعد ${nextExam.days} يوم.`,
          href:'plan.html' });
      }
    } else {
      insights.push({ icon:'✅', bg:'rgba(16,185,129,.1)', type:'success',
        title:'لا اختبارات قريبة', body:'أضف مواداتك من البروفايل لتتبع مواعيد الاختبارات.',
        href:'profile.html' });
    }

    const typeColor = { info:'var(--accent)', warning:'var(--warning)', danger:'var(--danger)', success:'var(--success)' };
    el.innerHTML = insights.map(ins => `
      <a href="${ins.href}" style="text-decoration:none;" class="dash-insight-item">
        <div class="dash-insight-icon" style="background:${ins.bg};">${ins.icon}</div>
        <div>
          <div style="font-weight:700;font-size:.82rem;color:${typeColor[ins.type]||'var(--fg)'};margin-bottom:3px;">${ins.title}</div>
          <div style="font-size:.77rem;color:var(--muted);line-height:1.5;">${ins.body}</div>
        </div>
      </a>
    `).join('');
  }

  // ─── Exam countdown cards ───
  initExamCountdown() {
    const el    = this.refs.examCountdowns;
    const label = this.refs.examLabel;
    if (!el) return;

    const courses = this.profile?.courses || [];
    const upcoming = courses
      .filter(c => c.examDate)
      .map(c => {
        const days = Math.round((new Date(c.examDate+'T00:00:00') - new Date()) / 86400000);
        return { ...c, days };
      })
      .filter(c => c.days >= 0)
      .sort((a,b) => a.days - b.days)
      .slice(0, 4);

    if (label) label.textContent = `${upcoming.length} قادم`;

    if (!upcoming.length) {
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
          padding:20px 12px;gap:8px;text-align:center;">
          <div style="font-size:1.8rem;opacity:.35;">⏰</div>
          <div style="font-size:.85rem;font-weight:700;color:var(--muted);">لا توجد اختبارات قادمة</div>
          <a href="profile.html" style="color:var(--accent);font-weight:700;font-size:.8rem;">أضف مواد من البروفايل →</a>
        </div>`;
      return;
    }

    el.innerHTML = upcoming.map(c => {
      const urgent = c.days <= 2;
      const warn   = c.days <= 7;
      const color  = urgent ? 'var(--danger)' : warn ? 'var(--warning)' : 'var(--accent)';
      const bg     = urgent ? 'rgba(239,68,68,.08)' : warn ? 'rgba(245,158,11,.08)' : 'var(--surface-2)';
      const label  = c.days === 0 ? 'اليوم!' : c.days === 1 ? 'غداً!' : `${c.days} يوم`;
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;
          border-radius:12px;background:${bg};border:1px solid ${urgent?'rgba(239,68,68,.2)':warn?'rgba(245,158,11,.15)':'var(--border)'};">
          <div style="text-align:center;min-width:44px;">
            <div style="font-size:1.4rem;font-weight:900;color:${color};line-height:1;">${c.days}</div>
            <div style="font-size:.65rem;color:var(--muted);font-weight:700;">يوم</div>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:.84rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name}</div>
            <div style="font-size:.75rem;color:${color};font-weight:800;">${label}</div>
          </div>
          ${urgent ? '<span class="insight-chip danger" style="padding:3px 8px;font-size:.7rem;">عاجل</span>' : ''}
        </div>
      `;
    }).join('');
  }

  // ─── Streak display ───
  initStreakDisplay() {
    const streak = window.UQUX?.StudyStreak?.get?.() ?? { streak: 0, total: 0, days: [] };
    const s1 = Utils.$('#streak-num');
    const s2 = Utils.$('#streak-num-2');
    if (s1) s1.textContent = streak.streak || '0';
    if (s2) s2.textContent = streak.streak || '0';
  }

  // ─── Chart ───
  initChart() {
    const placeholder = Utils.$('.chart-placeholder');
    if (!placeholder) return;

    const goals = this.profile?.goals || {};
    const hasGpa = goals.currentGpa != null && !Number.isNaN(Number(goals.currentGpa));

    // Empty state when no GPA data yet
    if (!hasGpa) {
      placeholder.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'height:100%;min-height:180px;text-align:center;color:var(--muted);gap:10px;padding:20px;">' +
          '<div style="font-size:2.4rem;opacity:.45;">📈</div>' +
          '<div style="font-size:.9rem;font-weight:600;color:var(--fg-2);">لا يوجد معدل تراكمي بعد</div>' +
          '<div style="font-size:.78rem;">' +
            'أضف معدلك من <a href="profile.html" style="color:var(--accent);font-weight:700;">البروفايل</a> ' +
            'لرؤية مسارك نحو الهدف.' +
          '</div>' +
        '</div>';
      return;
    }

    // Use UQUCharts if available (modern engine)
    if (window.UQUCharts?.renderGpaChart) {
      placeholder.id = placeholder.id || 'gpa-chart-container';
      placeholder.innerHTML = ''; // clear empty state
      window.UQUCharts.renderGpaChart(placeholder.id, this.profile);
      return;
    }

    // Fallback: basic canvas
    placeholder.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;';
    placeholder.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const resize = () => {
      const dpr  = window.devicePixelRatio || 1;
      const rect = placeholder.getBoundingClientRect();
      canvas.width  = rect.width  * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width  = rect.width  + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.renderChart(ctx, rect.width, rect.height);
    };
    resize();
    window.addEventListener('resize', Utils.debounce(resize, 200));
  }

  renderChart(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);

    const goals   = this.profile?.goals || {};
    const current = goals.currentGpa || 3.5;
    const target  = goals.targetGpa  || current;

    // نولّد نقاط بسيطة تمثل تطور المعدل نحو الهدف
    const dataPoints = [];
    const baseStart = Math.max(1.5, current - 0.6);
    dataPoints.push(baseStart);
    dataPoints.push(baseStart + 0.15);
    dataPoints.push(baseStart + 0.25);
    dataPoints.push(current - 0.05);
    dataPoints.push(current);
    dataPoints.push(current + (target - current) * 0.4);
    dataPoints.push(current + (target - current) * 0.7);
    dataPoints.push(target);

    const maxVal = 5;
    const padTop = 20;
    const usableH = h - padTop - 10;
    const stepX = w / (dataPoints.length - 1);

    // تعبئة متدرجة
    const gradient = ctx.createLinearGradient(0, padTop, 0, h);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

    ctx.beginPath();
    ctx.moveTo(0, h);
    dataPoints.forEach((pt, i) => {
      const x = i * stepX;
      const y = padTop + (1 - pt / maxVal) * usableH;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // الخط
    ctx.beginPath();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    dataPoints.forEach((pt, i) => {
      const x = i * stepX;
      const y = padTop + (1 - pt / maxVal) * usableH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // النقاط
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#6366f1';
    dataPoints.forEach((pt, i) => {
      const x = i * stepX;
      const y = padTop + (1 - pt / maxVal) * usableH;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }
}

// =================================================================
// 4. CHAT CONTROLLER (SMART LOCAL BRAIN v4.0 + UQUActions)
// =================================================================

class ChatController {
  constructor() {
    const page = document.body?.dataset?.page;
    if (page !== 'chat') return;

    this.input   = Utils.$('#chatInput');
    this.sendBtn = Utils.$('#sendMsg');
    this.box     = Utils.$('#chatBox');
    this.typing  = Utils.$('#typing');
    this.chips   = Utils.$('#quickChips');

    // ── Single accessor ──
    const C = window.UQUCore;
    this.profile   = C ? C.getProfile() : Utils.Storage.get('uqu_profile_v2', null);
    this.planState = C ? C.getPlan()    : Utils.Storage.get('uqu_plan_v5', null);

    this.studentName  = this.profile?.basic?.name  || null;
    this.studentMajor = this.profile?.basic?.major || null;

    // حالة المحادثة (للتدفق التفاعلي مثل احسب معدلي)
    this.flowState = {
      current: null,      // 'gpa_collect' مثلاً
      gpaDraft: []        // { courseName, score }
    };

    // 🧠 دماغ يعتمد على Regex
    this.brainRegex = this.initBrain();

    this.defaultResponses = [
      'سؤال جميل 🤔 حاول توضّحه أكثر أو تربطه بموادك / جدولك.',
      'ممكن توضح سؤالك أكثر: هل تقصد الخطة، المعدل، أو القاعات؟',
      'أنا أشتغل على بيانات بروفايلك وخطتك. جرّب تسأل: “إيش عندي اليوم؟” أو “هل عندي اختبار قريب؟”.',
      'لو كان سؤالك عن الجامعة أو الدراسة، حاول تذكر اسم المادة أو نوع الاختبار.'
    ];

    this.bindEvents();
  }

  // =========================================================
  // 0) إعداد الدماغ المعتمد على Regex
  // =========================================================
  initBrain() {
    return [
      {
        pattern: /(سلام|هلا|مرحبا|اهلا|أهلا|هاي)/i,
        reply: () => {
          const greet = this.getGreetingByTime();
          const base = this.studentName
            ? `${greet} ${this.studentName}! 🌹`
            : `${greet} يا هلا! 🌹`;
          const options = [
            `${base} كيف أقدر أساعدك اليوم؟`,
            `${base} جاهز نرتب دراستك وجدولك.`,
            'وعليكم السلام! نورت المساعد الأكاديمي 👋'
          ];
          return this.pick(options);
        }
      },
      {
        pattern: /(شكرا|تسلم|يعطيك العافيه|يعطيك العافية|ما قصرت|ثانك)/i,
        reply: () => this.pick([
          'على الرحب والسعة! هذا واجبي 🫡',
          'الله يعافيك! إذا عندك أي سؤال ثاني أنا حاضر.',
          'بالخدمة دائماً، وموفّق في دراستك 🤍'
        ])
      },
      {
        pattern: /(من انت|مين انت|عرف بنفسك|اسمك)/i,
        reply: () => this.pick([
          'أنا <strong>المساعد الأكاديمي الذكي</strong>، أستخدم بيانات البروفايل والخطة عشان أساعدك تنظم دراستك.',
          'أنا مساعد مبني على الذكاء الاصطناعي، ومربوط بنظامك الأكاديمي المحلي. قريباً أرتبط مباشرةً بـ API من OpenAI لأجاوب على أسئلتك العلمية بالتفصيل.'
        ])
      },
      {
        pattern: /(معدل|gpa|احسب معدلي|كم معدلي|حساب المعدل)/i,
        reply: () => this.startGpaFlow()
      },
      {
        pattern: /(قاعة|مبنى|مكان|وين القاعه|وين القاعة|موقع القاعة)/i,
        reply: () => this.pick([
          'للعثور على أي قاعة، افتح صفحة <strong><a href="locations.html">مواقع القاعات</a></strong> واكتب رقم القاعة مثل 21-0.534.',
          'صفحة <strong><a href="locations.html">القاعات</a></strong> فيها خريطة بسيطة تساعدك توصل لقاعة محاضرتك.',
          'لو عطيتني رقم القاعة هنا، أقدر أوضح لك وصفاً عامّاً، لكن التحديد الدقيق بيكون من صفحة القاعات.'
        ])
      },
      {
        pattern: /(خطة|خطة دراسيه|خطة دراسية|مذاكرة|تنظيم وقت|جدول مذاكرة)/i,
        reply: () => this.pick([
          'أفضل طريقة هي تستخدم صفحة <strong><a href="plan.html">الخطة الدراسية</a></strong> المبنية على بروفايلك الذكي.',
          'الخطة تعتمد على أوقات فراغك وموادك. تأكد أولاً أن البروفايل مكتمل، ثم اضغط توليد الخطة من صفحة الخطة.',
          'أقدر ألخّص لك الخطة هنا في الشات (مثل: “إيش عندي اليوم؟”)، لكن التعديل الأساسي يكون من صفحة الخطة.'
        ])
      }
    ];
  }

  // =========================================================
  // 1) ربط الأحداث
  // =========================================================
  bindEvents() {
    if (this.sendBtn) {
      this.sendBtn.addEventListener('click', () => this.handleSend());
    }

    if (this.input) {
      this.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSend();
        }
      });

      this.input.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
        if (this.value === '') this.style.height = 'auto';
      });
    }

    if (this.chips) {
      if (window.UQUCore?.delegate) {
        window.UQUCore.delegate(this.chips, 'click', '.suggestion-pill', (e, el) => {
          const txt = el.textContent.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').trim();
          this.handleSend(txt);
        });
      } else {
        this.chips.addEventListener('click', (e) => {
          if (e.target.classList.contains('suggestion-pill')) {
            const txt = e.target.textContent.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').trim();
            this.handleSend(txt);
          }
        });
      }
    }
  }

  // =========================================================
  // 2) إضافة رسائل للواجهة
  // =========================================================
  addMessage(text, role) {
    if (!this.box) return;
    const row = Utils.createElement(
      'div',
      `msg-row ${role === 'user' ? 'me' : 'bot'}`
    );
    const avatar =
      role === 'user'
        ? '<div class="avatar user-avatar">👤</div>'
        : '<div class="avatar bot-avatar">🤖</div>';

    row.innerHTML = `
      ${avatar}
      <div class="bubble">${text}</div>
    `;

    this.box.appendChild(row);
    this.box.scrollTo({ top: this.box.scrollHeight, behavior: 'smooth' });
  }

  // =========================================================
  // 3) إرسال الرسالة
  // =========================================================
  handleSend(textOverride = null) {
    if (!this.input) return;
    if (this._isProcessing) return;
    const val = textOverride || this.input.value.trim();
    if (!val) return;

    this.addMessage(val, 'user');
    this.input.value = '';
    this.input.style.height = 'auto';

    // Disable send while processing
    this._isProcessing = true;
    if (this.sendBtn) this.sendBtn.disabled = true;

    // Show typing
    if (this.typing) {
      this.typing.style.display = 'flex';
      if (this.box) this.box.appendChild(this.typing);
      if (this.box) this.box.scrollTop = this.box.scrollHeight;
    }

    // ── Try Claude API first ──────────────────────────────
    if (window.UQUAIChat) {
      // Create empty bubble for streaming
      const row = this._createBotRow();
      const bubble = row.querySelector('.bubble');

      window.UQUAIChat.send(
        val,
        bubble,  // typewriter target
        (fullReply, actions) => {
          if (this.typing) this.typing.style.display = 'none';
          // Render interactive widgets (maps, exam cards, plan cards, GPA)
          if (window.ChatWidgets) {
            const widgetHtml = window.ChatWidgets.renderWidgets(fullReply || '', actions || [], val);
            if (widgetHtml) {
              const widgetDiv = document.createElement('div');
              widgetDiv.className = 'chat-widgets-container';
              widgetDiv.style.cssText = 'display:block;width:100%;margin-top:10px;';
              widgetDiv.innerHTML = widgetHtml;
              bubble.appendChild(widgetDiv);
            }
          }
          if (this.box) this.box.scrollTop = this.box.scrollHeight;
          this._doneProcessing();
        },
        (apiErr) => {
          // API failed AND offline → fall back to local brain
          if (!navigator.onLine) {
            bubble.innerHTML = '';
            const localReply = this.analyzeAndReply(val);
            if (window.typewriter) {
              window.typewriter(bubble, localReply, () => { this._doneProcessing(); });
            } else {
              bubble.innerHTML = localReply;
              this._doneProcessing();
            }
          } else {
            // Online API error — ai.js already rendered the error message in bubble
            this._doneProcessing();
          }
        }
      );
      return;
    }

    // ── Fallback: local brain only ────────────────────────
    const DELAY = 600 + Math.random() * 400;
    setTimeout(() => {
      if (this.typing) this.typing.style.display = 'none';
      const reply = this.analyzeAndReply(val);
      this.addMessage(reply, 'bot');
      this._doneProcessing();
    }, DELAY);
  }

  _doneProcessing() {
    this._isProcessing = false;
    if (this.sendBtn) this.sendBtn.disabled = false;
    if (this.input) this.input.focus();
  }

  _createBotRow() {
    const row = document.createElement('div');
    row.className = 'msg-row bot';
    row.innerHTML = `<div class="avatar bot-avatar" aria-hidden="true">🤖</div><div class="bubble"></div>`;
    row.style.animation = 'msgIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards';
    if (this.typing) {
      this.typing.style.display = 'none';
    }
    if (this.box) {
      if (this.typing && this.typing.parentNode === this.box) {
        this.box.insertBefore(row, this.typing);
      } else {
        this.box.appendChild(row);
      }
      this.box.scrollTop = this.box.scrollHeight;
    }
    return row;
  }

  // =========================================================
  // 4) تحليل السؤال والرد (Intents + Flows + Brain + Default)
  // =========================================================
  analyzeAndReply(input) {
    const raw = (input || '').trim();
    const normalized = this.normalizeText(raw);

    // تحديث البيانات من التخزين كل مرة (لو تغيّر شيء من صفحات ثانية)
    const C = window.UQUCore;
    this.profile   = C ? C.getProfile() : Utils.Storage.get('uqu_profile_v2', null);
    this.planState = C ? C.getPlan()    : Utils.Storage.get('uqu_plan_v5', null);

    // 1) لو في Flow نشط (مثل جمع درجات المعدل)
    const flowReply = this.handleActiveFlow(normalized, raw);
    if (flowReply) return flowReply;

    // 2) Intents خاصة بالخطة والجدول
    if (this.isTodayPlanIntent(normalized)) {
      return this.replyTodaySessions();
    }

    if (this.isTomorrowPlanIntent(normalized)) {
      return this.replyTomorrowSessions();
    }

    if (this.isWeekOverviewIntent(normalized)) {
      return this.replyWeekOverview();
    }

    if (this.isNextSessionIntent(normalized)) {
      return this.replyNextSession();
    }

    if (this.isUpcomingExamsIntent(normalized)) {
      return this.replyUpcomingExams();
    }

    if (this.isProfileSummaryIntent(normalized)) {
      return this.replyProfileSummary();
    }

    // 3) Intents تفعل أفعال حقيقية عبر UQUActions
    const actionReply = this.handleActionIntents(normalized, raw);
    if (actionReply) return actionReply;

    // 4) دماغ Regex عام
    for (const rule of this.brainRegex) {
      if (rule.pattern?.test(normalized)) {
        return typeof rule.reply === 'function'
          ? rule.reply()
          : rule.reply;
      }
    }

    // 5) لا يوجد تطابق → رد افتراضي
    return this.pick(this.defaultResponses);
  }

  // =========================================================
  // 5) Intents بسيطة
  // =========================================================
  isTodayPlanIntent(text) {
    return /ايش عندي اليوم|وش عندي اليوم|جدولي اليوم|اليوم عندي ايش|اليوم ش عندي/.test(text);
  }

  isTomorrowPlanIntent(text) {
    return /بكرا ايش عندي|بكره ايش عندي|غدا ايش عندي|غداً ايش عندي|جدولي بكره|جدولي بكرا/.test(text);
  }

  isWeekOverviewIntent(text) {
    return /هذا الاسبوع|هذا الأسبوع|الاسبوع هذا|الأسبوع هذا|جدول الاسبوع|خطة الاسبوع/.test(text);
  }

  isNextSessionIntent(text) {
    return /ايش بعد شوي|وش بعد شوي|الجلسة الجاية|المحاضرة الجاية|وش التالي|ايش التالي/.test(text);
  }

  isUpcomingExamsIntent(text) {
    return /(اختبار|امتحان).*(قريب|الاسبوع|الأسبوع|جاي|جاية)/.test(text);
  }

  isProfileSummaryIntent(text) {
    return /(بروفايل|ملفي|بياناتي|ملخص البروفايل)/.test(text);
  }

  // =========================================================
  // 6) Intents تنفّذ أفعال (UQUActions)
  // =========================================================
  handleActionIntents(normalized, raw) {
    // ❗ إذا ما فيه UQUActions (ملف ما تحمّل)
    if (!window.UQUActions) return null;

    // 6.1 سوي لي خطة دراسية
    if (/سوي لي خطة|سويلي خطة|ابغى خطة دراسية|ابغا خطة دراسية|ابي خطة دراسية|سوي خطة دراسية/.test(normalized)) {
      const planState = window.UQUActions.generatePlanFromProfile();
      const count = (planState.plan || []).length;

      if (!count) {
        return 'حاولت أنشئ خطة من البروفايل، لكن ما لقيت مواد أو بيانات كافية. تأكد إنك عبّيت البروفايل ثم جرّب مرة ثانية من صفحة <strong><a href="profile.html">البروفايل</a></strong>.';
      }

      const first = planState.plan[0];
      const firstDay  = first?.day || 'اليوم الأول';
      const firstDate = first?.date || '';
      const greet = this.getGreetingByTime();

      return `${greet}! ✅ أنشأت لك خطة دراسية ذكية من بروفايلك.<br>
عدد جلسات المذاكرة في الخطة: <strong>${count}</strong> جلسة.<br>
أول جلسة عندك في: <strong>${firstDay}</strong> (${firstDate}) — ${first.time || ''}.<br><br>
تقدر تشوف الجدول كامل وتعدّل عليه من صفحة <strong><a href="plan.html">الخطة الدراسية</a></strong>.`;
    }

    // 6.2 تسجيل درجة: "جبت 85 في قواعد البيانات" أو "جبت في قواعد البيانات 85"
    const pattern1 = /جبت\s+(\d{1,3})\s+في\s+(.+)/;      // جبت 85 في قواعد البيانات
    const pattern2 = /جبت\s+في\s+(.+?)\s+(\d{1,3})/;     // جبت في قواعد البيانات 85

    let m = pattern1.exec(raw);
    if (!m) m = pattern2.exec(raw);

    if (m) {
      const score = pattern1.test(raw) ? m[1] : m[2];
      const courseName = pattern1.test(raw) ? m[2].trim() : m[1].trim();

      const result = window.UQUActions.recordGrade({
        courseName,
        score: Number(score)
      });

      if (!result.ok) {
        return `حاولت أسجّل درجة <strong>${score}</strong> للمادة <strong>${courseName}</strong> لكن ما وجدتها في بروفايلك 😕<br>تأكد إن اسم المادة في البروفايل مطابق تماماً، ثم جرّب مرة ثانية.`;
      }

      const gpaTxt = result.gpa
        ? result.gpa.toFixed(2)
        : 'غير محسوب';

      return `تم ✅ تسجيل درجة <strong>${score}</strong> للمادة <strong>${result.course.name}</strong> في بروفايلك.<br>المعدل التقريبي الحالي (من 5): <strong>${gpaTxt}</strong>.<br>تقدر تشوف المواد والدرجات من صفحة <strong><a href="dashboard.html">الداشبورد</a></strong> أو صفحة <strong><a href="profile.html">البروفايل</a></strong>.`;
    }

    // 6.3 نية "أبغى أذاكر يوم الخميس الساعة 5" → إضافة جلسة في الخطة
    if (/بذاكر|ابذاكر|ذاكر/.test(normalized)) {
      const dayMatch = /(الاحد|الأحد|الاثنين|الإثنين|الثلاثاء|الاربعاء|الأربعاء|الخميس|الجمعة|السبت)/.exec(normalized);
      const timeMatch = /(\d{1,2})(?::(\d{1,2}))?\s*(ص|م|am|pm)?/.exec(normalized);

      if (dayMatch && timeMatch) {
        const dayWord = dayMatch[1];
        let hour = parseInt(timeMatch[1], 10);
        const min  = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const suffix = (timeMatch[3] || '').toLowerCase();

        // تحويل 12h → 24h بسيط
        if (suffix === 'م' || suffix === 'pm') {
          if (hour < 12) hour += 12;
        } else if (suffix === 'ص' || suffix === 'am') {
          if (hour === 12) hour = 0;
        }

        const timeStr = this.pad2(hour) + ':' + this.pad2(min);

        // تاريخ أول يوم قادم من هذا اليوم
        const targetDate = this.getNextWeekdayDate(dayWord);
        const isoDate = this.toISODate(targetDate);

        const session = window.UQUActions.addStudySession({
          date: isoDate,
          time: timeStr,
          courseId: null,
          courseName: 'جلسة مذاكرة عامة',
          place: 'غير محدد'
        });

        return `جميل 👌 أضفت لك جلسة مذاكرة يوم <strong>${session.day}</strong> ${session.date} الساعة <strong>${session.time}</strong> في الخطة الدراسية.<br>تقدر تعدّل المادة والمكان من صفحة <strong><a href="plan.html">الخطة</a></strong>.`;
      }
    }

    return null;
  }

  // =========================================================
  // 7) Flows تفاعلية (مثل احسب معدلي)
  // =========================================================
startGpaFlow() {
  this.flowState.current   = 'gpa_collect';
  this.flowState.gpaBuffer = '';

  return `تمام ✅ نقدر نحسب معدل <strong>متوقّع</strong> من درجاتك المتوقعة في المواد.<br><br>
أنا أستخدم <strong>عدد الساعات لكل مادة من البروفايل</strong>، لذلك تأكد إن موادك وساعاتها مسجّلة هناك.<br><br>
اكتب المواد سطر سطر بهذا الشكل:<br>
<code>برمجة 1: 95</code><br>
<code>قواعد البيانات: 85</code><br><br>
تقدر تكتبهم في أكثر من رسالة أو في رسالة واحدة مفصولة بـ <code>|</code> أو بالفواصل.<br>
وعندما تخلص اكتب كلمة <strong>احسب</strong> أو <strong>خلصت</strong>.`;
}


  handleActiveFlow(normalized, raw) {
    if (this.flowState.current === 'gpa_collect') {

      this.flowState.gpaBuffer =
        (this.flowState.gpaBuffer || '') + '\n' + raw.trim();

      const wantCalc = /احسب|خلصت|احسب المعدل|احسبه/.test(normalized);
      const items = this.parseGpaLines(this.flowState.gpaBuffer);

      // لو طلب الحساب الآن
      if (wantCalc) {
        if (!window.UQUActions) {
          this.flowState.current = null;
          this.flowState.gpaBuffer = '';
          return 'حالياً ما أقدر أحسب المعدل لأن طبقة الأفعال (UQUActions) غير متوفرة في الصفحة.';
        }

        if (!items.length) {
          this.flowState.current = null;
          this.flowState.gpaBuffer = '';
          return 'ما استقبلت أي مواد أو درجات 😅 اكتب مثلاً: <code>برمجة 1: 95</code> ثم كرر لباقي المواد.';
        }

        const result = window.UQUActions.predictGpaWithHypotheticalScores(items);

        this.flowState.current   = null;
        this.flowState.gpaBuffer = '';

        if (!result.hours || result.hours <= 0) {
          return `ما قدرت أحسب المعدل لأن ما عندي مواد كافية في <strong>البروفايل</strong> مع عدد الساعات والدرجات 👀<br>
تأكد إنك ضفت موادك (اسم المادة + عدد الساعات) من صفحة <strong><a href="profile.html">البروفايل</a></strong>، وبعدين ارجع وجرّب "احسب معدلي" مرة ثانية.`;
        }

        const gpa = result.gpa || 0;
        const gpaTxt = gpa.toFixed(2);

        let msg = `حسب الدرجات اللي كتبتها، وبالاعتماد على <strong>عدد الساعات المسجّلة لموادك في البروفايل</strong>، فالمعدل <strong>المتوقَّع</strong> (من 5) هو: <strong>${gpaTxt}</strong>.<br><br>`;
        msg += 'تقدر تثبّت الدرجات فعلياً في البروفايل من صفحة <strong><a href="dashboard.html">الداشبورد</a></strong> أو صفحة <strong><a href="profile.html">البروفايل</a></strong>.';

        return msg;
      } // 👈 هذا القوس كان ناقص

      // لسه ما قال احسب → نأكد إننا فهمنا على الأقل مادة واحدة
      if (!items.length) {
        return 'ما استقبلت أي مادة بصيغة صحيحة 😅 حاول تكتب بالشكل: <code>برمجة 1: 95</code> أو افصل بين المواد بـ "|" .';
      }

      // عندنا مواد لكن ما طلب الحساب بعد
      const last = items[items.length - 1];
      return `تمام ✅ أضفت:<br><strong>${last.courseName}</strong> = <strong>${last.score}</strong>.<br>أضف باقي المواد أو اكتب <strong>احسب</strong> لما تخلص.`;
    }

    return null;
  }


  // =========================================================
  // 8) أدوات مساعدة (Normalize + وقت + تواريخ)
  // =========================================================
    // ---------- تحليل درجات المواد من نص (سطر واحد أو عدة أسطر) ----------
  parseGpaLines(rawText) {
    if (!rawText) return [];

    // نحول الفواصل و | إلى أسطر
    let text = rawText
      .replace(/[\u200f\u200e]/g, '')      // remove RTL marks
      .replace(/[،;,|]/g, '\n');           // كل فاصل يصبح سطر جديد

    const lines = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^(احسب|خلصت|احسب المعدل|احسبه)$/i.test(l));

    const items = [];
    const re = /^(.+?)\s*[:：]\s*(\d{1,3})(?:\s*%?)?$/; // "اسم المادة: 95"

    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;

      const name  = m[1].trim();
      const score = Number(m[2]);

      if (!name || isNaN(score)) continue;

      items.push({ courseName: name, score });
    }

    return items;
  }

  normalizeText(text) {
    if (!text) return '';

    let t = text;

    // إزالة التشكيل والإيموجي وبعض الرموز
    t = t.replace(/[\u0617-\u061A\u064B-\u0652]/g, ''); // تشكيل
    t = t.replace(/[\u{1F600}-\u{1F6FF}]/gu, '');        // إيموجي
    t = t.replace(/[^\w\u0600-\u06FF\s:،]/g, ' ');      // رموز غريبة
    t = t.replace(/\s+/g, ' ').trim();

    // توحيد الألف والهمزات
    t = t.replace(/[إأآا]/g, 'ا');
    t = t.replace(/ة/g, 'ه');
    t = t.replace(/ى/g, 'ي');

    // توحيد بعض العبارات العامية
    t = t.replace(/ابغا|ابغى|ابغئ/g, 'ابغى');
    t = t.replace(/ابي/g, 'ابغى');
    t = t.replace(/بكره/g, 'بكرا');

    return t.toLowerCase();
  }

  getGreetingByTime() {
    const now = new Date();
    const hour = now.getHours(); // يعتمد على توقيت المتصفح

    if (hour < 11) return 'صباح الخير';
    if (hour < 17) return 'مساء الخير';
    return 'مساء النور';
  }

  // ── Delegate to UQUCore.D (single source of truth) ──
  pad2(n)        { return window.UQUCore ? window.UQUCore.D.pad(n)        : String(n).padStart(2, '0'); }
  toISODate(d)   { return window.UQUCore ? window.UQUCore.D.toISO(d)      : (d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')); }

  getNextWeekdayDate(dayWord) {
    if (window.UQUCore) return window.UQUCore.D.nextWeekday(dayWord);
    // Minimal inline fallback
    const map = { 'الاحد':0,'الأحد':0,'الاثنين':1,'الإثنين':1,'الثلاثاء':2,'الاربعاء':3,'الأربعاء':3,'الخميس':4,'الجمعة':5,'السبت':6 };
    const target = map[dayWord] ?? null;
    const today = new Date();
    if (target == null) return today;
    let diff = target - today.getDay();
    if (diff <= 0) diff += 7;
    const d = new Date(today); d.setDate(d.getDate() + diff); d.setHours(0,0,0,0); return d;
  }

  pick(arr) {
    if (!arr || !arr.length) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // =========================================================
  // 9) الدوال الخاصة بالردود المعتمدة على الخطة/البروفايل
  //    (نفس اللي كتبتها قبل + دالة nextSession الجديدة)
  // =========================================================
  replyTodaySessions() {
    if (!this.planState || !this.planState.plan || !this.planState.plan.length) {
      return 'حالياً ما عندك خطة مجدولة في النظام. افتح صفحة <strong><a href="plan.html">الخطة الدراسية</a></strong> وسوِّ جدول أولاً.';
    }

    const today = new Date();
    const iso = this.toISODate(today);

    const todaysTasks = this.planState.plan
      .filter((t) => t.date === iso)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    if (!todaysTasks.length) {
      return 'حسب الخطة الحالية، ما عندك أي جلسة مذاكرة اليوم 👌';
    }

    let msg = 'هذه جلساتك لليوم حسب الخطة:<br><br>';
    todaysTasks.forEach((t) => {
      msg += `• ${t.time} – ${t.timeEnd || ''} — <strong>${t.courseName}</strong> @ ${t.place || 'غير محدد'}<br>`;
    });

    msg += '<br>تقدر تعدّل هذه الجلسات من صفحة <strong><a href="plan.html">الخطة</a></strong>.';
    return msg;
  }

  replyTomorrowSessions() {
    if (!this.planState || !this.planState.plan || !this.planState.plan.length) {
      return 'لا توجد خطة مجدولة حالياً. أنشئ خطة من صفحة الخطة الدراسية أولاً.';
    }

    const d = new Date();
    d.setDate(d.getDate() + 1);
    const iso = this.toISODate(d);

    const tasks = this.planState.plan
      .filter((t) => t.date === iso)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    const dayText = d.toLocaleDateString('ar-SA', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });

    if (!tasks.length) {
      return `حسب الخطة الحالية، ما عندك جلسات مذاكرة غداً (${dayText}).`;
    }

    let msg = `هذه جلساتك غداً (${dayText}):<br><br>`;
    tasks.forEach((t) => {
      msg += `• ${t.time} – ${t.timeEnd || ''} — <strong>${t.courseName}</strong> @ ${t.place || 'غير محدد'}<br>`;
    });
    msg += '<br>لو حابّ تغيّر الأوقات، عدّلها من صفحة <strong><a href="plan.html">الخطة</a></strong>.';
    return msg;
  }

  replyWeekOverview() {
    if (!this.planState || !this.planState.plan || !this.planState.plan.length) {
      return 'لا توجد خطة مجدولة للأسبوع. ابدأ بإنشاء خطة من صفحة الخطة الدراسية.';
    }

    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() + 0); // تقريب الأحد كبداية
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const isoStart = this.toISODate(start);
    const isoEnd   = this.toISODate(end);

    const tasks = this.planState.plan.filter((t) => {
      if (!t.date) return false;
      return t.date >= isoStart && t.date <= isoEnd;
    });

    if (!tasks.length) {
      return 'ما في أي جلسات في هذا الأسبوع داخل الخطة الحالية.';
    }

    const perDay = {};
    tasks.forEach((t) => {
      perDay[t.day] = (perDay[t.day] || 0) + 1;
    });

    let msg = 'نظرة سريعة على هذا الأسبوع:<br><br>';
    Object.keys(perDay).forEach((day) => {
      msg += `• ${day}: ${perDay[day]} جلسة<br>`;
    });
    msg += '<br>لرؤية الجدول كاملاً، افتح صفحة <strong><a href="plan.html">الخطة</a></strong>.';
    return msg;
  }

  replyUpcomingExams() {
    const courses = this.profile?.courses || [];
    if (!courses.length) {
      return 'لا أرى أي مواد في البروفايل حالياً. أضف موادك في صفحة <strong><a href="profile.html">البروفايل</a></strong> أولاً.';
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = [];

    courses.forEach((c) => {
      if (!c.examDate) return;
      const d = new Date(c.examDate + 'T00:00:00');
      const diffDays = Math.round(
        (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays >= 0 && diffDays <= 30) {
        upcoming.push({ course: c, diff: diffDays, dateObj: d });
      }
    });

    if (!upcoming.length) {
      return 'حالياً لا يوجد أي اختبار نهائي مرتبط بموادك خلال 30 يوم (حسب البيانات الموجودة في البروفايل).';
    }

    upcoming.sort((a, b) => a.diff - b.diff);

    let msg = 'هذه أهم الاختبارات القادمة حسب البروفايل:<br><br>';
    upcoming.slice(0, 5).forEach((x) => {
      const dateText = x.dateObj.toLocaleDateString('ar-SA', {
        month: 'short',
        day: 'numeric',
        weekday: 'short'
      });
      if (x.diff === 0) {
        msg += `• <strong>${x.course.name}</strong> — اليوم (${dateText}) ⚠️<br>`;
      } else {
        msg += `• <strong>${x.course.name}</strong> — بعد ${x.diff} يوم (${dateText})<br>`;
      }
    });

    msg += '<br>تأكد من تواريخ الاختبارات في صفحة <strong><a href="profile.html">البروفايل</a></strong> وأضف أي مادة ناقصة.';
    return msg;
  }

  replyProfileSummary() {
    if (!this.profile) {
      return 'ما عندي بروفايل محفوظ لك حتى الآن. اذهب إلى صفحة <strong><a href="profile.html">البروفايل</a></strong> واملأ بياناتك الأساسية أولاً.';
    }

    const basic    = this.profile.basic    || {};
    const learning = this.profile.learning || {};
    const goals    = this.profile.goals    || {};
    const courses  = this.profile.courses  || [];

    let msg = 'ملخّص بروفايلك الحالي:<br><br>';

    if (basic.name)     msg += `• الاسم: <strong>${basic.name}</strong><br>`;
    if (basic.major)    msg += `• التخصص: <strong>${basic.major}</strong><br>`;
    if (basic.level)    msg += `• المستوى الدراسي: <strong>${basic.level}</strong><br>`;
    if (basic.semStart) msg += `• بداية الفصل: <strong>${basic.semStart}</strong><br>`;
    if (basic.weeks)    msg += `• مدة الفصل (أسابيع): <strong>${basic.weeks}</strong><br>`;

    if (learning.focusMinutes || learning.speed) {
      msg += '<br><strong>أسلوب التعلّم:</strong><br>';
      if (learning.focusMinutes) {
        msg += `• مدة الجلسة الواحدة: ${learning.focusMinutes} دقيقة<br>`;
      }
      if (learning.speed) {
        const speedLabel =
          learning.speed === 'fast'
            ? 'سريع'
            : learning.speed === 'slow'
            ? 'بطيء'
            : 'متوسط';
        msg += `• سرعة التعلم: ${speedLabel}<br>`;
      }
    }

    if (goals.currentGpa || goals.targetGpa) {
      msg += '<br><strong>الأهداف الدراسية:</strong><br>';
      if (goals.currentGpa) msg += `• المعدل الحالي: ${goals.currentGpa}<br>`;
      if (goals.targetGpa)  msg += `• المعدل المستهدف: ${goals.targetGpa}<br>`;
    }

    msg += `<br>عدد المواد في البروفايل: <strong>${courses.length}</strong> مادة.<br>`;
    msg += 'للتعديل، ادخل على صفحة <strong><a href="profile.html">البروفايل</a></strong>.';

    return msg;
  }

  // --------- NEW: المحاضرة / الجلسة القادمة فقط ----------
  replyNextSession() {
    const plan = this.planState?.plan || [];
    if (!plan.length) {
      return 'ما عندي أي جلسات في الخطة حالياً. أنشئ خطة من صفحة <strong><a href="plan.html">الخطة الدراسية</a></strong> أولاً.';
    }

    const now = new Date();
    let next = null;
    let nextDateObj = null;

    plan.forEach((t) => {
      if (!t.date || !t.time) return;

      const dt = new Date(`${t.date}T${t.time}:00`);
      if (dt.getTime() <= now.getTime()) return;

      if (!next || dt.getTime() < nextDateObj.getTime()) {
        next = t;
        nextDateObj = dt;
      }
    });

    if (!next) {
      return 'ما في أي جلسة قادمة في الخطة (كل الجلسات المسجّلة انتهت). جرّب تحديث الخطة أو إضافة جلسات جديدة.';
    }

    const diffMs = nextDateObj.getTime() - now.getTime();
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const remMinutes = diffMinutes % 60;

    let diffText = '';
    if (diffHours <= 0 && remMinutes <= 0) {
      diffText = 'تبدأ الآن تقريباً';
    } else if (diffHours === 0) {
      diffText = `بعد حوالي <strong>${remMinutes} دقيقة</strong>`;
    } else {
      diffText = `بعد حوالي <strong>${diffHours} ساعة و ${remMinutes} دقيقة</strong>`;
    }

    const dateText = nextDateObj.toLocaleDateString('ar-SA', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });

    return `الجلسة / المحاضرة القادمة عندك هي:<br><br>
• المادة: <strong>${next.courseName}</strong><br>
• اليوم: <strong>${dateText}</strong><br>
• الوقت: <strong>${next.time}</strong> ${next.timeEnd ? '– ' + next.timeEnd : ''}<br>
• المكان: ${next.place || 'غير محدد'}<br><br>
${diffText}.`;
  }
}

  // =================================================================
  // 4-b. USER LEARNING PROFILE CONTROLLER (V1 – اختياري)
  // =================================================================

  class ProfileController {
    constructor() {
      this.form = Utils.$('#profileForm');
      if (!this.form) return;

      this.inputs = {
        name: Utils.$('#profileName'),
        major: Utils.$('#profileMajor'),
        speedRadios: Utils.$$('input[name="learningSpeed"]'),
        focusMinutes: Utils.$('#focusMinutes'),
        easySlides: Utils.$('#easySlides')
      };

      this.preview = {
        easy: Utils.$('#previewEasy'),
        medium: Utils.$('#previewMedium'),
        hard: Utils.$('#previewHard')
      };

      // Migrate: read from v2 (canonical) first, fall back to legacy v1
      this.state = (window.UQUCore ? window.UQUCore.getProfile() : null)
        || Utils.Storage.get('uqu_profile_v2', null)
        || Utils.Storage.get('uqu_profile_v1', {
        name: '',
        major: '',
        learningSpeed: 'normal',
        focusMinutes: 30,
        baseEasySlidesPerSession: 20
      });

      this.fillForm();
      this.bindEvents();
      this.updatePreview();
    }

    fillForm() {
      const p = this.state || {};
      if (this.inputs.name) this.inputs.name.value = p.name || '';
      if (this.inputs.major) this.inputs.major.value = p.major || '';
      if (this.inputs.focusMinutes) this.inputs.focusMinutes.value = p.focusMinutes || 30;
      if (this.inputs.easySlides) this.inputs.easySlides.value = p.baseEasySlidesPerSession || 20;

      if (this.inputs.speedRadios && this.inputs.speedRadios.length) {
        let selected = p.learningSpeed || 'normal';
        let anyChecked = false;
        this.inputs.speedRadios.forEach((r) => {
          if (r.value === selected) {
            r.checked = true;
            anyChecked = true;
          }
        });
        if (!anyChecked) this.inputs.speedRadios[0].checked = true;
      }
    }

    bindEvents() {
      if (this.form) {
        this.form.addEventListener('submit', (e) => {
          e.preventDefault();
          this.saveProfile();
        });
      }

      const debouncedPreview = Utils.debounce(() => this.updatePreview(), 120);

      if (this.inputs.focusMinutes) {
        this.inputs.focusMinutes.addEventListener('input', debouncedPreview);
      }
      if (this.inputs.easySlides) {
        this.inputs.easySlides.addEventListener('input', debouncedPreview);
      }
      if (this.inputs.speedRadios && this.inputs.speedRadios.length) {
        this.inputs.speedRadios.forEach((r) => r.addEventListener('change', debouncedPreview));
      }
    }

    collectProfileFromForm() {
      const speedInputs = this.inputs.speedRadios || [];
      let speed = 'normal';
      const chosen = speedInputs.find((r) => r.checked);
      if (chosen) speed = chosen.value;

      const focusMinutes = Math.max(
        15,
        parseInt(this.inputs.focusMinutes?.value) || this.state.focusMinutes || 30
      );
      const baseEasy = Math.max(
        1,
        parseInt(this.inputs.easySlides?.value) || this.state.baseEasySlidesPerSession || 20
      );

      return {
        ...this.state,
        name: this.inputs.name?.value.trim() || '',
        major: this.inputs.major?.value.trim() || '',
        learningSpeed: speed,
        focusMinutes,
        baseEasySlidesPerSession: baseEasy
      };
    }

    computeDerived(profile) {
      const minutes = profile.focusMinutes || 30;
      const easySlides = profile.baseEasySlidesPerSession || 20;

      const baseRate = minutes > 0 ? easySlides / minutes : 0.5;

      let speedFactor = 1;
      if (profile.learningSpeed === 'fast') speedFactor = 1.2;
      else if (profile.learningSpeed === 'slow') speedFactor = 0.8;

      const easyPerMin = baseRate * speedFactor;
      const mediumPerMin = easyPerMin * 0.7;
      const hardPerMin = easyPerMin * 0.5;

      let defaultProgress;
      if (profile.learningSpeed === 'fast') defaultProgress = 8;
      else if (profile.learningSpeed === 'slow') defaultProgress = 3;
      else defaultProgress = 5;

      profile.derived = {
        easySlidesPerMinute: easyPerMin,
        mediumSlidesPerMinute: mediumPerMin,
        hardSlidesPerMinute: hardPerMin,
        defaultProgressPerSession: defaultProgress
      };

      return profile;
    }

    updatePreview() {
      const draft = this.computeDerived(this.collectProfileFromForm());
      const minutes = draft.focusMinutes || 30;
      const d = draft.derived || {};

      if (this.preview.easy) {
        this.preview.easy.textContent = Math.round((d.easySlidesPerMinute || 0) * minutes);
      }
      if (this.preview.medium) {
        this.preview.medium.textContent = Math.round((d.mediumSlidesPerMinute || 0) * minutes);
      }
      if (this.preview.hard) {
        this.preview.hard.textContent = Math.round((d.hardSlidesPerMinute || 0) * minutes);
      }
    }

    saveProfile() {
      const profile = this.computeDerived(this.collectProfileFromForm());
      this.state = profile;
      // Save to canonical v2 key
      const _store = window.UQUCore?.S ?? Utils.Storage;
      _store.set('uqu_profile_v2', profile);
      _store.set('uqu_profile_v1', profile); // keep v1 for backward compat

      if (window.__ui && typeof window.__ui.showToast === 'function') {
        window.__ui.showToast('تم حفظ بروفايل التعلم بنجاح ✨', 'success');
      } else {
        alert('تم حفظ بروفايل التعلم بنجاح ✨');
      }
    }
  }

// =================================================================
// 5. GPA CALCULATOR CONTROLLER (SMART – Linked with Profile)
// =================================================================

class GPAController {
  constructor() {
    // بيانات الحاسبة المحفوظة (مسودة المستخدم)
    const saved = Utils.Storage.get('gpa_data', null);

    // ── Single accessor ──
    const C = window.UQUCore;
    const profile = C ? C.getProfile() : (
      window.UQUActions?.getProfile?.() || Utils.Storage.get('uqu_profile_v2', null)
    );

    // 3) نبني الحالة
    if (profile) {
      this.state = this.buildStateFromProfile(profile, saved);
    } else if (saved) {
      // ما فيه بروفايل لكن فيه تخزين قديم
      this.state = {
        currentGPA: Number(saved.currentGPA || 0),
        earnedHours: Number(saved.earnedHours || 0),
        planHours: Number(saved.planHours || 130),
        courses: Array.isArray(saved.courses) ? saved.courses : []
      };
    } else {
      // لا بروفايل ولا تخزين قديم
      this.state = {
        currentGPA: 0,
        earnedHours: 0,
        planHours: 130,
        courses: []
      };
    }

    // 4) ربط عناصر الـ DOM
    this.dom = {
      container: Utils.$('#coursesWrap'),
      addBtn: Utils.$('#addCourse'),
      resetBtn: Utils.$('#resetBtn'),
      inputs: {
        gpa: Utils.$('#curGpa'),
        earned: Utils.$('#earnedHours'),
        plan: Utils.$('#totalPlanHours')
      },
      outputs: {
        newGpa: Utils.$('#newGpa'),
        termGpa: Utils.$('#termGpa'),
        remaining: Utils.$('#remainingHours'),
        termHours: Utils.$('#termHours'),
        totalEarned: Utils.$('#totalEarned')
      }
    };

    // لو ما فيه حاسبة في الصفحة لا نفعل شيء
    if (this.dom.container) {
      this.init();
    }
  }

  // --------------------------------------------------
  // تحويل بيانات البروفايل إلى state مناسبة للحاسبة
  // --------------------------------------------------
  buildStateFromProfile(profile, savedDraft = null) {
    const basic   = profile.basic   || {};
    const goals   = profile.goals   || {};
    const courses = profile.courses || [];

    // المعدّل الحالي
    const profileGpa =
      goals.currentGpa ??
      basic.currentGpa ??
      savedDraft?.currentGPA ??
      0;

    // الساعات المنجزة
    const profileEarned =
      goals.earnedHours ??
      basic.earnedHours ??
      savedDraft?.earnedHours ??
      0;

    // ساعات الخطة الكاملة
    const profilePlanHours =
      goals.planHours ??
      basic.planHours ??
      savedDraft?.planHours ??
      130;

    const currentGPA  = Number(profileGpa) || 0;
    const earnedHours = Number(profileEarned) || 0;
    const planHours   = Number(profilePlanHours) || 130;

    // نحول مواد البروفايل إلى مواد الحاسبة
    const mappedCourses = courses.map((c) => {
      const name  = c.name || 'مادة بدون اسم';
      const hours = Number(c.creditHours) || 3;

      // لو خزّنت درجة من 100 في البروفايل
      const score = c.currentScore ?? c.finalScore ?? null;

      let gradeValue = null;

      // أولاً نحاول نرجع الدرجة اللي كان مختارها الطالب في gpa_data القديمة (لو موجودة لنفس المادة)
      if (savedDraft && Array.isArray(savedDraft.courses)) {
        const savedMatch = savedDraft.courses.find((s) => {
          if (c.id && s.id) return s.id === c.id;
          return s.name === c.name;
        });
        if (savedMatch && typeof savedMatch.grade === 'number') {
          gradeValue = savedMatch.grade;
        }
      }

      // ما لقينا درجة محفوظة → نحول من 100 إلى 5
      if (gradeValue == null) {
        if (score != null) {
          if (window.UQUGpaCalculator && typeof window.UQUGpaCalculator.scoreToPoints === 'function') {
            gradeValue = window.UQUGpaCalculator.scoreToPoints(score);
          } else {
            // سلم بديل بسيط
            const s = Number(score) || 0;
            if (s >= 95) gradeValue = 5.0;
            else if (s >= 90) gradeValue = 4.75;
            else if (s >= 85) gradeValue = 4.5;
            else if (s >= 80) gradeValue = 4.0;
            else if (s >= 75) gradeValue = 3.5;
            else if (s >= 70) gradeValue = 3.0;
            else if (s >= 65) gradeValue = 2.5;
            else if (s >= 60) gradeValue = 2.0;
            else gradeValue = 1.0; // أو 0 لو تحب F = 0
          }
        } else {
          // لا درجة من 100 ولا حفظ → نخليها F كبداية (الطالب يغيّرها)
          gradeValue = 1.0;
        }
      }

      return {
        id: c.id,
        name,
        hours,
        grade: gradeValue
      };
    });

    return {
      currentGPA,
      earnedHours,
      planHours,
      courses: mappedCourses
    };
  }

  // --------------------------------------------------
  // التهيئة الأولى للـ UI
  // --------------------------------------------------
  init() {
    // تعبئة الحقول من state (القيم القادمة من البروفايل)
    if (this.dom.inputs.gpa) {
      this.dom.inputs.gpa.value =
        this.state.currentGPA ? this.state.currentGPA.toFixed(2) : '';
    }
    if (this.dom.inputs.earned) {
      this.dom.inputs.earned.value = this.state.earnedHours || '';
    }
    if (this.dom.inputs.plan) {
      this.dom.inputs.plan.value = this.state.planHours || 130;
    }

    // بناء صفوف المواد
    if (this.state.courses.length > 0) {
      this.state.courses.forEach((c) => this.renderRow(c));
    } else {
      // لو ما فيه مواد في البروفايل نبدأ بصف واحد فاضي
      this.renderRow();
    }

    // أول حساب
    this.calculate();

    // ربط الأحداث
    this.bindEvents();
  }

  bindEvents() {
    // إضافة مادة جديدة
    this.dom.addBtn?.addEventListener('click', () => {
      this.renderRow();
      this.calculate();
    });

    // إعادة التعيين إلى بيانات البروفايل
    this.dom.resetBtn?.addEventListener('click', () => {
      if (!confirm('هل أنت متأكد؟ سيتم إعادة تحميل البيانات من البروفايل وحذف التعديلات في صفحة المعدل.')) {
        return;
      }

      const profile = window.UQUCore ? window.UQUCore.getProfile()
        : (window.UQUActions?.getProfile?.() || Utils.Storage.get('uqu_profile_v2', null));

      this.state = this.buildStateFromProfile(profile, null);
      Utils.Storage.set('gpa_data', this.state);

      // إعادة بناء الصفوف
      this.dom.container.innerHTML = '';
      if (this.state.courses.length > 0) {
        this.state.courses.forEach((c) => this.renderRow(c));
      } else {
        this.renderRow();
      }

      // إعادة تعبئة الحقول
      if (this.dom.inputs.gpa) {
        this.dom.inputs.gpa.value =
          this.state.currentGPA ? this.state.currentGPA.toFixed(2) : '';
      }
      if (this.dom.inputs.earned) {
        this.dom.inputs.earned.value = this.state.earnedHours || '';
      }
      if (this.dom.inputs.plan) {
        this.dom.inputs.plan.value = this.state.planHours || 130;
      }

      this.calculate();
    });

    // أي تغيير في الحقول الأساسية (debounced for performance)
    const _debounced = window.UQUCore ? window.UQUCore.T.debounce(() => this.updateState(), 120)
                                       : Utils.debounce(() => this.updateState(), 120);
    Object.values(this.dom.inputs).forEach((input) => {
      input?.addEventListener('input', _debounced);
    });
  }

  // --------------------------------------------------
  // رسم صف مادة واحدة
  // --------------------------------------------------
  renderRow(data = { name: '', hours: 3, grade: 0 }) {
    const row = Utils.createElement('div', 'animate-block');

    row.style.cssText =
      'display:grid; grid-template-columns: 2fr 1fr 1fr auto; gap:10px; align-items:center; padding:10px; background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow-sm); margin-bottom:8px;';

    const grades = [
      { L: 'A+', V: 5 },
      { L: 'A', V: 4.75 },
      { L: 'B+', V: 4.5 },
      { L: 'B', V: 4.0 },
      { L: 'C+', V: 3.5 },
      { L: 'C', V: 3.0 },
      { L: 'D+', V: 2.5 },
      { L: 'D', V: 2.0 },
      { L: 'F', V: 1.0 }
    ];

    row.innerHTML = `
      <input type="text" class="c-name" placeholder="اسم المادة" value="${data.name || ''}"
        style="width:100%; padding:8px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--fg);">
      
      <input type="number" class="c-hours" min="1" max="12" value="${data.hours || 3}"
        style="width:100%; padding:8px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--fg); text-align:center;" title="الساعات">
      
      <select class="c-grade"
        style="width:100%; padding:8px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--fg); cursor:pointer;">
        ${grades
          .map(
            (g) =>
              `<option value="${g.V}" ${
                Number(data.grade) === g.V ? 'selected' : ''
              }>${g.L}</option>`
          )
          .join('')}
      </select>
      
      <button class="c-del"
        style="background:transparent; border:none; color:var(--danger); font-size:1.2rem; cursor:pointer; padding:0 8px;">&times;</button>
    `;

    const _rowDebounced = window.UQUCore ? window.UQUCore.T.debounce(() => this.updateState(), 120)
                                          : Utils.debounce(() => this.updateState(), 120);
    const inputs = row.querySelectorAll('input, select');
    inputs.forEach((inp) =>
      inp.addEventListener('input', _rowDebounced)
    );

    row.querySelector('.c-del').addEventListener('click', () => {
      row.remove();
      this.updateState();
    });

    this.dom.container.appendChild(row);

    // أنيميشن بسيطة للظهور
    requestAnimationFrame(() => {
      row.style.opacity = '0';
      row.style.transform = 'translateY(10px)';
      row.style.transition = '0.3s';
      requestAnimationFrame(() => {
        row.style.opacity = '1';
        row.style.transform = 'translateY(0)';
      });
    });
  }

  // --------------------------------------------------
  // تحديث state من الـ DOM
  // --------------------------------------------------
  updateState() {
    this.state.currentGPA =
      parseFloat(this.dom.inputs.gpa?.value) || 0;
    this.state.earnedHours =
      parseFloat(this.dom.inputs.earned?.value) || 0;
    this.state.planHours =
      parseFloat(this.dom.inputs.plan?.value) || 130;

    const rows = Array.from(this.dom.container.children);
    this.state.courses = rows.map((r) => ({
      name: r.querySelector('.c-name').value,
      hours: parseFloat(r.querySelector('.c-hours').value) || 0,
      grade: parseFloat(r.querySelector('.c-grade').value) || 0
    }));

    // حفظ تجارب الطالب (الدرجات اللي يتوقعها)
    Utils.Storage.set('gpa_data', this.state);

    // ── DataBridge: sync GPA changes back to profile ──
    if (window.DataBridge) {
      try { window.DataBridge.syncProfileFromGpa(); } catch(e) {}
    }

    this.calculate();
  }

  // --------------------------------------------------
  // الحساب الفعلي للمعدل
  // --------------------------------------------------
  calculate() {
    // ── Use memoized calcGPA from UQUCore if available ──
    let result;
    if (window.UQUCore?.calcGPA) {
      result = window.UQUCore.calcGPA({
        prev:        this.state.currentGPA  || 0,
        earned:      this.state.earnedHours || 0,
        planHours:   this.state.planHours   || 130,
        termCourses: this.state.courses.map(c => ({
          creditHours: c.hours || 0,
          gradePoints: c.grade || 0  // GPAController already stores points directly
        }))
      });
    } else {
      // Inline fallback (identical logic, no external dep)
      const oldPts  = (this.state.currentGPA || 0) * (this.state.earnedHours || 0);
      let tPts = 0, tHrs = 0;
      this.state.courses.forEach(c => { tPts += (c.grade||0)*(c.hours||0); tHrs += (c.hours||0); });
      const total = (this.state.earnedHours||0) + tHrs;
      result = {
        newGpa:   total > 0 ? (oldPts + tPts) / total : (this.state.currentGPA || 0),
        termGpa:  tHrs > 0 ? tPts / tHrs : 0,
        termHours: tHrs,
        totalEarned: total,
        remaining: (this.state.planHours || 130) - total
      };
    }

    if (this.dom.outputs.newGpa)     this.dom.outputs.newGpa.textContent     = result.newGpa.toFixed(2);
    if (this.dom.outputs.termGpa)    this.dom.outputs.termGpa.textContent    = result.termGpa.toFixed(2);
    if (this.dom.outputs.termHours)  this.dom.outputs.termHours.textContent  = result.termHours;
    if (this.dom.outputs.totalEarned)this.dom.outputs.totalEarned.textContent= result.totalEarned;
    if (this.dom.outputs.remaining) {
      const r = result.remaining;
      this.dom.outputs.remaining.textContent = r > 0 ? r : '0';
      this.dom.outputs.remaining.style.color = r <= 0 ? 'var(--success)' : 'var(--danger)';
    }

    // ── DataBridge: push calculated GPA to gpa_data for profile sync ──
    if (window.DataBridge && result.newGpa) {
      try {
        const gpa = Utils.Storage.get('gpa_data', {});
        gpa.calculatedGPA = result.newGpa;
        gpa.termGPA = result.termGpa;
        Utils.Storage.set('gpa_data', gpa);
        window.DataBridge.syncProfileFromGpa();
      } catch(e) {}
    }
  }
}


// =================================================================
// 6. PLAN PAGE — ADVANCED PLANNER (from plan.html)
// =================================================================

function initPlanPage() {
  // نشتغل فقط لو عناصر البلان موجودة
  if (!document.getElementById('planGrid')) return;

  (function () {
    // --- Utilities (delegated to UQUCore — no duplication) ---
    const $ = (id) => document.getElementById(id);

    // Storage: use UQUCore.S if available, else minimal inline fallback
    const _S = window.UQUCore?.S ?? {
      get(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
      set(k, v)   { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
      remove(k)   { localStorage.removeItem(k); }
    };
    const storage = { get: _S.get.bind(_S), set: _S.set.bind(_S), del: _S.remove.bind(_S) };

    // Date utils: delegate to UQUCore.D
    const _D = window.UQUCore?.D;
    const dayIndex              = _D ? _D.DAY_INDEX        : { 'الأحد':0,'الإثنين':1,'الثلاثاء':2,'الأربعاء':3,'الخميس':4,'الجمعة':5,'السبت':6 };
    const pad2                  = _D ? (n => _D.pad(n))    : (n => String(n).padStart(2, '0'));
    const parseTimeToMinutes    = _D ? (t => _D.parseTime(t)) : (t => { const [h,m] = t.split(':').map(Number); return h*60+(m||0); });
    const minutesToTime         = _D ? (m => _D.formatTime(m)) : (mins => { mins=Math.max(0,mins); return pad2(Math.floor(mins/60)%24)+':'+pad2(mins%60); });
    const formatISODate         = _D ? (d => _D.toISO(d))  : (d => d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()));
    const getNextSundayDate     = _D ? (() => _D.nextSunday()) : (() => { const d=new Date(); const diff=(7-d.getDay())%7; d.setDate(d.getDate()+(diff===0?7:diff)); d.setHours(0,0,0,0); return d; });

    function calculateProgressPerSession(difficulty, speed) {
      let base = 5;
      if (difficulty === 'easy') base = 8;
      if (difficulty === 'hard') base = 3;

      if (speed === 'fast') base *= 1.2;
      if (speed === 'slow') base *= 0.8;

      return Math.round(base * 10) / 10;
    }

    function uuid() {
      return 'c-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    }

    const profile = window.UQUCore ? window.UQUCore.getProfile() : storage.get('uqu_profile_v2', null);

    const defaultSlots = [
      { day: 'الأحد', from: '18:00', to: '20:00', place: 'البيت' },
      { day: 'الإثنين', from: '16:00', to: '18:00', place: 'المكتبة' },
      { day: 'الأربعاء', from: '19:00', to: '21:00', place: '' }
    ];

    // ✅ البروفايل هو المصدر الأساسي للـ courses + slots
    function buildInitialStateFromProfile(profile) {
      if (!profile) {
        return {
          planTitle: 'خطة دراسة الفصل',
          sessionMin: 60,
          weeks: 6,
          planStart: null,
          courses: [],
          slots: defaultSlots,
          plan: [],
          tasks: [],            // مهام يدوية
          filterCourseId: 'all',
          currentWeekView: 1
        };
      }

      const basic = profile.basic || {};
      const learning = profile.learning || {};
      const coursesFromProfile = profile.courses || [];

      const title =
        basic.name && basic.major
          ? `خطة ${basic.name} - ${basic.major}`
          : 'خطة دراسة الفصل';

      const semStart = basic.semStart || new Date().toISOString().split('T')[0];
      const weeks = basic.weeks || 16;

      const sessionMin = learning.focusMinutes || 60;
      const speed = learning.speed || 'normal';

      const PLAN_COLORS = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#a855f7'];
      const courses = coursesFromProfile.map((c, ci) => ({
        id: c.id,
        name: c.name,
        color: c.color || PLAN_COLORS[ci % PLAN_COLORS.length],
        examDate: c.examDate,
        difficulty: c.difficulty,
        currentProgress: c.currentProgress || 0,
        progressPerSession: calculateProgressPerSession(c.difficulty, speed),
        weeklyHours: 0
      }));

      const slotsFromProfile =
        learning.slots && Array.isArray(learning.slots) && learning.slots.length
          ? learning.slots
          : defaultSlots;

      return {
        planTitle: title,
        sessionMin,
        weeks,
        planStart: semStart,
        courses,
        slots: slotsFromProfile,
        plan: [],
        tasks: [],
        filterCourseId: 'all',
        currentWeekView: 1
      };
    }

    let state = storage.get('uqu_plan_v5', null);
    const hasProfile = !!profile;

    if (!state) {
      state = buildInitialStateFromProfile(profile);
    } else if (hasProfile) {
      const baseFromProfile = buildInitialStateFromProfile(profile);
      state.planTitle = baseFromProfile.planTitle;
      state.sessionMin = baseFromProfile.sessionMin;
      state.planStart = baseFromProfile.planStart;
      state.courses = baseFromProfile.courses;
      state.slots = baseFromProfile.slots;
      if (!state.tasks) state.tasks = [];
    }

    if (!state.tasks) state.tasks = [];

    storage.set('uqu_plan_v5', state);

    if (!profile) {
      const grid = $('planGrid');
      if (grid && (!state.plan || !state.plan.length)) {
        grid.innerHTML = `
          <div class="plan-empty">
            <div class="plan-empty-icon">⚠️</div>
            <h3>لم يتم إعداد البروفايل</h3>
            <p>أكمل بروفايلك الأكاديمي لإنشاء خطة دراسية ذكية مخصصة لك</p>
            <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;justify-content:center;">
              <a href="profile.html" class="btn-primary">← إعداد البروفايل</a>
              <button onclick="window._openDrawer&&window._openDrawer()" class="btn-ghost">⚙️ إعداد يدوي</button>
            </div>
          </div>
        `;
      }
    }

    function getPlanStartDateObj() {
      if (state.planStart) {
        const d = new Date(state.planStart + 'T00:00:00');
        d.setHours(0, 0, 0, 0);
        return d;
      }
      const d = getNextSundayDate();
      return d;
    }
const els = {
  planTitle: $('planTitle'),
  daySel: $('daySel'),
  fromTime: $('fromTime'),
  place: $('placeInput'),
  addBtn: $('addSlotBtn'),
  chips: $('chipsBox'),
  planGrid: $('planGrid'),
  hours: $('statHours'),
  sessions: $('statSessions'),
  start: $('statStart'),
  courseName: $('courseName'),
  courseColor: $('courseColor'),
  courseCurrent: $('courseCurrent'),
  coursePerSession: $('coursePerSession'),
  courseWeekly: $('courseWeekly'),
  courseExam: $('courseExam'),
  addCourseBtn: $('addCourseBtn'),
  coursesList: $('coursesList'),
  courseFilter: $('courseFilter'),
  weekPrev: $('weekPrev'),
  weekNext: $('weekNext'),
  weekLabel: $('weekLabel'),

  // عناصر المهام اليدوية
  taskTitle: $('taskTitle'),
  taskDay: $('taskDay'),
  taskTime: $('taskTime'),
  taskDuration: $('taskDuration'),
  taskType: $('taskType'),
  taskCourse: $('taskCourse'),
  addTaskBtn: $('addTaskBtn'),
  tasksMiniList: $('tasksMiniList'),

  taskDeadlineDate: $('taskDeadlineDate'),   // التاريخ
  taskDeadlineTime: $('taskDeadlineTime'),   // الوقت الجديد
  deadlineWeekday: $('deadlineWeekday')      // عرض يوم الأسبوع تلقائياً
};

// تغيير اليوم تلقائياً عندما يغيّر المستخدم تاريخ الـ Deadline
if (els.taskDeadlineDate && els.taskDay) {
  els.taskDeadlineDate.addEventListener('change', () => {
    const val = els.taskDeadlineDate.value;
    if (!val) return;

    const d = new Date(val + 'T00:00:00');
    d.setHours(0, 0, 0, 0);

    const dow = d.getDay(); // 0 الأحد .. 6 السبت
    const dayNameFromDate = Object.keys(dayIndex).find(
      (k) => dayIndex[k] === dow
    );
    if (dayNameFromDate) {
      els.taskDay.value = dayNameFromDate;
    }
  });
}

    // دالة مساعدة لأسماء الأيام
    const weekdayNames = [
      'الأحد',
      'الإثنين',
      'الثلاثاء',
      'الأربعاء',
      'الخميس',
      'الجمعة',
      'السبت'
    ];

    // عندما يختار المستخدم تاريخ للـ Deadline:
    // نكتب اليوم تلقائياً في الـ span، ولو اليوم في القائمة فاضي نضبطه
    if (els.taskDeadlineDate && els.deadlineWeekday) {
      els.taskDeadlineDate.addEventListener('change', () => {
        if (!els.taskDeadlineDate.value) {
          els.deadlineWeekday.textContent = '—';
          return;
        }

        const d = new Date(els.taskDeadlineDate.value + 'T00:00:00');
        const dayName = weekdayNames[d.getDay()] || '—';
        els.deadlineWeekday.textContent = dayName;

        // لو المستخدم ما اختار اليوم في القائمة، نخليه نفس اليوم المحسوب
        if (els.taskDay && !els.taskDay.value) {
          els.taskDay.value = dayName;
        }
      });
    }

// العكس: لو اختار اليوم من القائمة وما حدد تاريخ،
// نحدد له أقرب يوم قادم من "تاريخ اليوم الحقيقي"
if (els.taskDay && els.taskDeadlineDate) {
  els.taskDay.addEventListener('change', () => {
    const selectedDay = els.taskDay.value;
    if (!selectedDay) return;

    // نحسب أقرب يوم قادم من اليوم الحالي
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayDow = today.getDay();                // 0..6 (0 = الأحد)
    const targetDow = dayIndex[selectedDay];        // 0..6 بحسب قاموسنا

    let diff = (targetDow - todayDow + 7) % 7;      // عدد الأيام حتى اليوم المطلوب
    const d = new Date(today);
    d.setDate(today.getDate() + diff);

    const iso = formatISODate(d);
    els.taskDeadlineDate.value = iso;               // نحدّث حقل التاريخ

    // تحديث الـ span الذي يعرض اسم اليوم لو موجود
    if (els.deadlineWeekday) {
      const dayName = weekdayNames[d.getDay()] || '—';
      els.deadlineWeekday.textContent = dayName;
    }
  });
}



    if (els.planTitle) {
      els.planTitle.value = state.planTitle || 'خطة دراسة الفصل';
    }

    const hasProfileData = !!profile;

    if (hasProfileData) {
      if (els.addCourseBtn) els.addCourseBtn.disabled = true;
      ['courseName', 'courseColor', 'courseCurrent', 'coursePerSession', 'courseWeekly', 'courseExam']
        .forEach((key) => {
          if (els[key]) {
            els[key].disabled = true;
            els[key].style.opacity = '0.7';
            els[key].style.cursor = 'not-allowed';
          }
        });

      if (els.coursesList) {
        const group = els.coursesList.closest('.input-group');
        if (group) {
          const hint = document.createElement('p');
          hint.style.cssText = 'font-size:0.78rem; color:var(--muted); margin-top:6px;';
          hint.textContent = 'المواد تأتي تلقائيًا من صفحة البروفايل. لتعديلها، استخدم صفحة البروفايل.';
          group.appendChild(hint);
        }
      }

      if (els.chips) {
        const groupSlots = els.chips.closest('.input-group');
        if (groupSlots) {
          const hint2 = document.createElement('p');
          hint2.style.cssText = 'font-size:0.78rem; color:var(--muted); margin-top:6px;';
          hint2.textContent = 'أوقات المذاكرة تأتي تلقائيًا من صفحة البروفايل. لتعديلها، استخدم صفحة البروفايل.';
          groupSlots.appendChild(hint2);
        }
      }
    }

    function save() {
      if (els.planTitle) {
        state.planTitle = els.planTitle.value.trim() || state.planTitle;
      }
      storage.set('uqu_plan_v5', state);
      updateStats();
    }

    function renderCourses() {
      if (!els.coursesList) return;
      els.coursesList.innerHTML = '';
      if (!state.courses.length) {
        els.coursesList.innerHTML =
          '<span style="font-size:0.8rem; color:var(--muted);">لا توجد مواد بعد. انتقل إلى صفحة <strong>البروفايل</strong> لإضافة موادك ثم عد إلى هذه الصفحة لتوليد الخطة.</span>';
      } else {
        state.courses.forEach((c) => {
          const row = document.createElement('div');
          row.className = 'course-row';
          const examText = c.examDate ? `اختبار: ${c.examDate}` : 'اختبار غير محدد';
          row.innerHTML = `
            <div class="course-main">
              <span class="task-course-dot" style="background:${c.color};"></span>
              <div>
                <div class="course-name">${c.name}</div>
                <div class="course-sub">
                  منجز: ${c.currentProgress || 0}% • ${c.progressPerSession || 0}% لكل جلسة
                </div>
                <div class="course-sub">
                  ${examText}
                </div>
              </div>
            </div>
            <button class="course-delete" title="حذف المادة">✕</button>
          `;

          const delBtn = row.querySelector('.course-delete');

          if (hasProfileData) {
            delBtn.disabled = true;
            delBtn.style.opacity = '0.4';
            delBtn.style.cursor = 'not-allowed';
            delBtn.title = 'تعديل المواد يتم من صفحة البروفايل';
          } else {
            delBtn.onclick = () => {
              if (!confirm('حذف هذه المادة من الخطة؟ سيتم حذف جلساتها عند إعادة التوليد.')) return;
              state.courses = state.courses.filter((x) => x.id !== c.id);
              save();
              renderCourses();
              renderCourseFilter();
            };
          }

          els.coursesList.appendChild(row);
        });
      }
      renderCourseFilter();
      syncTaskCourseOptions();
    }

    function renderCourseFilter() {
      if (!els.courseFilter) return;
      const current = state.filterCourseId || 'all';
      els.courseFilter.innerHTML = '<option value="all">كل المواد</option>';
      state.courses.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        els.courseFilter.appendChild(opt);
      });
      els.courseFilter.value =
        current === 'all'
          ? 'all'
          : state.courses.find((c) => c.id === current)?.id || 'all';
      state.filterCourseId = els.courseFilter.value;
      storage.set('uqu_plan_v5', state);
    }

    // مزامنة المواد مع حقل اختيار المادة في المهام
    function syncTaskCourseOptions() {
      if (!els.taskCourse) return;
      els.taskCourse.innerHTML =
        '<option value="">غير مرتبط بمادة معيّنة</option>';
      state.courses.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        els.taskCourse.appendChild(opt);
      });
    }

    function renderChips() {
      if (!els.chips) return;
      els.chips.innerHTML = '';
      if (!state.slots.length) {
        els.chips.innerHTML =
          '<span style="font-size:0.8rem; color:var(--muted);">لا توجد فترات مضافة بعد.</span>';
        return;
      }
      state.slots.forEach((s, i) => {
        const chip = document.createElement('div');
        chip.className = 'slot-chip';
        chip.innerHTML = `<b>${s.day}</b> ${s.from} - ${s.to || ''} <span style="font-size:10px">❌</span>`;
        if (!hasProfileData) {
          chip.onclick = () => {
            if (!confirm('حذف هذه الفترة؟')) return;
            state.slots.splice(i, 1);
            save();
            renderChips();
          };
        } else {
          chip.style.cursor = 'not-allowed';
        }
        els.chips.appendChild(chip);
      });
    }

    function calcTotalPlanMinutes() {
      if (!state.plan || !state.plan.length) return 0;
      return state.plan.reduce((acc, t) => {
        const start = parseTimeToMinutes(t.time);
        const end = parseTimeToMinutes(t.timeEnd);
        return acc + Math.max(0, end - start);
      }, 0);
    }

    function updateStats() {
      if (els.start) {
        if (state.planStart) {
          const d = new Date(state.planStart + 'T00:00:00');
          els.start.innerText = d.toLocaleDateString('ar-SA', {
            month: 'short',
            day: 'numeric'
          });
        } else {
          const startSunday = getNextSundayDate();
          els.start.innerText = startSunday.toLocaleDateString('ar-SA', {
            month: 'short',
            day: 'numeric'
          });
        }
      }

      const totalMins = calcTotalPlanMinutes();
      const totalHours = totalMins / 60;
      const totalSessions = state.plan ? state.plan.length : 0;

      if (els.hours) els.hours.innerText = totalHours.toFixed(1);
      if (els.sessions) els.sessions.innerText = totalSessions.toString();
    }

    function buildWeeklySessions() {
      const sessions = [];
      state.slots.forEach((slot) => {
        const fromMins = parseTimeToMinutes(slot.from);
        const toMins = slot.to ? parseTimeToMinutes(slot.to) : fromMins + (state.sessionMin || 60);
        let duration = toMins - fromMins;
        if (duration <= 0) duration = state.sessionMin || 60;

        const step = state.sessionMin || 60;
        const count = Math.max(1, Math.floor(duration / step) || 1);
        for (let s = 0; s < count; s++) {
          const startM = fromMins + s * step;
          const endM = startM + step;
          sessions.push({
            day: slot.day,
            startMins: startM,
            endMins: endM,
            place: slot.place || 'غير محدد'
          });
        }
      });
      sessions.sort((a, b) => {
        const di = (dayIndex[a.day] ?? 0) - (dayIndex[b.day] ?? 0);
        if (di !== 0) return di;
        return a.startMins - b.startMins;
      });
      return sessions;
    }

    function computeCurrentWeekFromToday() {
      if (!state.planStart) return 1;
      const base = new Date(state.planStart + 'T00:00:00');
      base.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((today - base) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) return 1;
      let idx = Math.floor(diffDays / 7) + 1;
      if (idx > state.weeks) idx = state.weeks;
      if (idx < 1) idx = 1;
      return idx;
    }

    function renderWeekNav() {
      if (!els.weekLabel) return;
      const w = state.currentWeekView || 1;
      const weeksTotal = state.weeks || 1;
      if (state.planStart) {
        const start = new Date(state.planStart + 'T00:00:00');
        start.setDate(start.getDate() + (w - 1) * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const sTxt = start.toLocaleDateString('ar-SA', {
          month: 'short',
          day: 'numeric'
        });
        const eTxt = end.toLocaleDateString('ar-SA', {
          month: 'short',
          day: 'numeric'
        });
        els.weekLabel.textContent = `الأسبوع ${w} • ${sTxt} - ${eTxt}`;
      } else {
        els.weekLabel.textContent = `الأسبوع ${w}`;
      }
      if (els.weekPrev) els.weekPrev.disabled = w <= 1;
      if (els.weekNext) els.weekNext.disabled = w >= weeksTotal;
    }

    function computeNowSessions() {
      if (!state.plan || !state.plan.length)
        return { currentId: null, nextId: null, nextDiffText: '' };
      const now = new Date();
      const nowTs = now.getTime();
      let current = null;
      let next = null;
      let nextStartTs = null;

      state.plan.forEach((t) => {
        if (!t.date || !t.time) return;
        const start = new Date(t.date + 'T' + t.time + ':00');
        const end = new Date(t.date + 'T' + (t.timeEnd || t.time) + ':00');
        const sTs = start.getTime();
        const eTs = end.getTime();

        if (nowTs >= sTs && nowTs <= eTs) {
          if (
            !current ||
            sTs <
              new Date(current.date + 'T' + current.time + ':00').getTime()
          ) {
            current = t;
          }
        } else if (sTs > nowTs) {
          if (nextStartTs === null || sTs < nextStartTs) {
            next = t;
            nextStartTs = sTs;
          }
        }
      });

      let diffText = '';
      if (next && nextStartTs) {
        const diffMs = nextStartTs - nowTs;
        const dayMs = 1000 * 60 * 60 * 24;
        const diffDays = Math.floor(diffMs / dayMs);
        if (diffDays > 0) {
          diffText = `بعد ${diffDays} يوم`;
        } else {
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          if (diffHours > 0) {
            diffText = `بعد ${diffHours} ساعة`;
          } else {
            const diffMinutes = Math.max(
              1,
              Math.floor(diffMs / (1000 * 60))
            );
            diffText = `بعد ${diffMinutes} دقيقة`;
          }
        }
      }

      return {
        currentId: current ? current.id : null,
        nextId: next ? next.id : null,
        nextDiffText: diffText
      };
    }

    function getDateForWeekAndDay(weekIndexZero, dayName) {
      const base = getPlanStartDateObj();
      const offsetDays = weekIndexZero * 7 + (dayIndex[dayName] ?? 0);
      const d = new Date(base);
      d.setDate(base.getDate() + offsetDays);
      return formatISODate(d);
    }

    function fallbackGeneratePlan() {
      if (!state.slots.length) return alert('أضف أوقات متاحة أولاً!');
      if (!state.courses.length)
        return alert('أضف مادة واحدة على الأقل أو استخدم صفحة البروفايل!');
      if (!state.sessionMin || state.sessionMin < 20)
        return alert('مدة الجلسة قصيرة جداً.');

      const weeklySessionsTemplate = buildWeeklySessions();
      if (!weeklySessionsTemplate.length) {
        return alert('الفترات المتاحة قصيرة جداً بالنسبة لمدة الجلسة.');
      }

      const startDate = getPlanStartDateObj();
      state.planStart = formatISODate(startDate);

      const courses = state.courses;
      const demand = {};
      const deadlineWeek = {};
      const warnings = [];
      const maxWeeks = state.weeks || 1;
      const weeklyCap = weeklySessionsTemplate.length;
      const dayMs = 1000 * 60 * 60 * 24;

      courses.forEach((c) => {
        const current = Math.min(
          100,
          Math.max(0, parseFloat(c.currentProgress) || 0)
        );
        const perSession = Math.max(
          0,
          parseFloat(c.progressPerSession) || 0
        );
        let remaining = Math.max(0, 100 - current);
        let requiredSessions;

        if (perSession > 0) {
          requiredSessions = Math.ceil(remaining / perSession);
        } else {
          const wh = Math.max(1, parseInt(c.weeklyHours) || 1);
          requiredSessions = wh * maxWeeks;
        }

        demand[c.id] = requiredSessions;

        if (c.examDate) {
          const base = getPlanStartDateObj();
          const exam = new Date(c.examDate + 'T00:00:00');
          let diff = Math.floor((exam - base) / dayMs);
          let wIdx = diff < 0 ? 1 : Math.floor(diff / 7) + 1;
          if (wIdx > maxWeeks) wIdx = maxWeeks;
          if (wIdx < 1) wIdx = 1;
          deadlineWeek[c.id] = wIdx;
        } else {
          deadlineWeek[c.id] = maxWeeks;
        }

        const weeksWindow = deadlineWeek[c.id];
        const capacity = weeklyCap * weeksWindow;
        if (requiredSessions > capacity) {
          warnings.push(
            `المادة "${c.name}" تحتاج تقريبًا ${requiredSessions} جلسة حتى تصل 100٪، لكن السعة المتاحة حتى الاختبار هي ${capacity} جلسة فقط.`
          );
        }
      });

      const studyTasks = [];

      for (let w = 1; w <= maxWeeks; w++) {
        const weeklyQuota = {};
        const weeklyAssigned = {};
        Object.keys(demand).forEach((cid) => {
          const left = demand[cid];
          if (left <= 0 || w > deadlineWeek[cid]) {
            weeklyQuota[cid] = 0;
            weeklyAssigned[cid] = 0;
            return;
          }
          const weeksRemaining = deadlineWeek[cid] - w + 1;
          weeklyQuota[cid] = Math.min(left, Math.ceil(left / weeksRemaining));
          weeklyAssigned[cid] = 0;
        });

        weeklySessionsTemplate.forEach((sess) => {
          let chosenId = null;
          let bestScore = -Infinity;

          Object.keys(demand).forEach((cid) => {
            const left = demand[cid];
            if (left <= 0 || w > deadlineWeek[cid]) return;
            const quotaLeft = weeklyQuota[cid] - weeklyAssigned[cid];
            if (quotaLeft > 0) {
              const score = quotaLeft * 1000 + left;
              if (score > bestScore) {
                bestScore = score;
                chosenId = cid;
              }
            }
          });

          if (!chosenId) {
            Object.keys(demand).forEach((cid) => {
              const left = demand[cid];
              if (left <= 0 || w > deadlineWeek[cid]) return;
              if (left > bestScore) {
                bestScore = left;
                chosenId = cid;
              }
            });
          }

          if (!chosenId) return;

          const course = courses.find((c) => c.id === chosenId);
          if (!course) return;

          demand[chosenId]--;
          if (weeklyQuota[chosenId] > 0) weeklyAssigned[chosenId]++;

          const dateISO = getDateForWeekAndDay(w - 1, sess.day);

          // Smart study tips based on profile memorization style
          const memStyle = (profile?.learning?.memorization) || 'normal';
          const studyTipMap = {
            'repetition': 'كرر المحتوى عدة مرات حتى يثبت',
            'visual':     'استخدم الخرائط الذهنية والرسوم التوضيحية',
            'audio':      'سجل ملاحصاتك صوتياً واستمع إليها',
            'normal':     'اقرأ وفهم ثم لخص بأسلوبك'
          };
          const studyTip = studyTipMap[memStyle] || studyTipMap['normal'];

          studyTasks.push({
            id: uuid(),
            kind: 'study',
            week: w,
            day: sess.day,
            date: dateISO,
            time: minutesToTime(sess.startMins),
            timeEnd: minutesToTime(sess.endMins),
            courseId: course.id,
            courseName: course.name,
            courseColor: course.color,
            title: `${course.name}: جلسة تقدّم دراسي`,
            place: sess.place,
            note: `💡 ${studyTip} — تقدم متوقع: ${
              course.progressPerSession || '?'
            }%`,
            studyMethod: memStyle
          });
        });
      }

      const manualTasks = state.tasks || [];
      state.plan = studyTasks.concat(manualTasks);

      const weeksWithTasks = Array.from(new Set(state.plan.map((t) => t.week))).sort(
        (a, b) => a - b
      );
      state.currentWeekView = weeksWithTasks[0] || 1;

      storage.set('uqu_plan_v5', state);
      renderWeekNav();
      renderPlan();
      renderWeekOverview();
      if (warnings.length) {
        alert(
          'تنبيه في توزيع الخطة:\n' + warnings.join('\n')
        );
      }
    }

    async function generatePlan() {
      if (!state.slots.length) return alert('أضف أوقات متاحة أولاً!');
      if (!state.courses.length) return alert('أضف مادة واحدة على الأقل أو استخدم صفحة البروفايل!');

      const genBtn = document.getElementById('genBtn');
      const originalBtnHtml = genBtn ? genBtn.innerHTML : 'توليد';
      
      try {
        if (genBtn) {
          genBtn.innerHTML = '⏳ الأيجنت يفكر الآن...';
          genBtn.disabled = true;
          genBtn.style.opacity = '0.8';
        }

        if (!window.GeneratorEngine) {
           console.warn('GeneratorEngine not found, using fallback.');
           return fallbackGeneratePlan();
        }

        const aiOutput = await window.GeneratorEngine.generateAIPlan(state);
        
        // Parse reasoning to show in UI
        if (aiOutput.reasoning) {
           state.aiReasoning = aiOutput.reasoning;
        }

        const manualTasks = state.tasks || [];
        const studyTasks = [];

        // Build study tasks from AI output
        (aiOutput.tasks || []).forEach((t, i) => {
           // match course
           const matchCourse = state.courses.find(c => c.name.includes(t.courseName) || t.courseName.includes(c.name));
           
           studyTasks.push({
             id: uuid(),
             kind: 'study',
             week: 1, // Focus on week 1 for now
             day: t.day,
             date: getDateForWeekAndDay(0, t.day) || new Date().toISOString(), // 0 for week 1
             time: t.time,
             timeEnd: t.timeEnd || t.time,
             courseId: matchCourse ? matchCourse.id : null,
             courseName: matchCourse ? matchCourse.name : t.courseName,
             courseColor: matchCourse ? matchCourse.color : '#6366f1',
             title: t.title,
             place: t.place || '—',
             note: t.note || ''
           });
        });

        state.plan = studyTasks.concat(manualTasks);
        state.currentWeekView = 1;
        state.weeks = 1; // Since AI currently schedules one smart week

        storage.set('uqu_plan_v5', state);
        renderWeekNav();
        renderPlan();
        renderWeekOverview();

      } catch(err) {
        console.error('AI Plan Error:', err);
        alert('عذراً، لم نستطع الاتصال بالعقل الذكي، سنولد خطة مبدئية حتى يعود المحرك.');
        fallbackGeneratePlan();
      } finally {
        if (genBtn) {
          genBtn.innerHTML = originalBtnHtml;
          genBtn.disabled = false;
          genBtn.style.opacity = '1';
        }
      }
    }


    function renderPlan() {
      if (!els.planGrid) return;
      els.planGrid.innerHTML = '';
      
      const aiRecs = document.getElementById('aiRecs');
      if (aiRecs) {
        if (state.plan && state.plan.length > 0 && state.aiReasoning) {
          aiRecs.style.display = 'block';
          aiRecs.innerHTML = '<strong>💡 تحليل المحرك الذكي:</strong><br><br>' + state.aiReasoning.replace(/\n/g, '<br>');
        } else {
          aiRecs.style.display = 'none';
        }
      }
      if (!state.plan.length) {
        els.planGrid.innerHTML = `
          <div class="plan-empty">
            <div class="plan-empty-icon">📅</div>
            <h3>ابدأ خطتك الدراسية</h3>
            <p>أنشئ خطة ذكية مخصصة لك بناءً على بيانات بروفايلك</p>
            <div class="plan-empty-steps">
              <div class="plan-empty-step"><span>1</span> أكمل بروفايلك</div>
              <div class="plan-empty-step"><span>2</span> حدد أوقات المذاكرة</div>
              <div class="plan-empty-step"><span>3</span> اضغط "توليد الجدول"</div>
            </div>
            <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;justify-content:center;">
              <a href="profile.html" class="btn-primary">← إعداد البروفايل</a>
              <button onclick="window._openDrawer&&window._openDrawer()" class="btn-ghost">⚙️ فتح الإعدادات</button>
            </div>
          </div>`;
        updateStats();
        return;
      }

      const days = [
        'الأحد',
        'الإثنين',
        'الثلاثاء',
        'الأربعاء',
        'الخميس',
        'الجمعة',
        'السبت'
      ];
      const maxWeeks = state.weeks || 1;
      let weekToShow = state.currentWeekView || 1;
      const filterId = state.filterCourseId || 'all';

      const nowInfo = computeNowSessions();

      const weeksWithTasks = Array.from(new Set(state.plan.map((t) => t.week)));
      if (!weeksWithTasks.includes(weekToShow)) {
        weekToShow = weeksWithTasks.sort((a, b) => a - b)[0] || 1;
        state.currentWeekView = weekToShow;
        storage.set('uqu_plan_v5', state);
      }

      // ── Detect today's day name for highlighting ──
      const todayObj = new Date(); todayObj.setHours(0,0,0,0);
      const todayISO = formatISODate(todayObj);
      const todayDayName = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][todayObj.getDay()];

      // ── Session edit helper ──
      function openEditForm(task) {
        // Build a small modal overlay for editing
        let overlay = document.getElementById('editOverlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'editOverlay';
        overlay.className = 'edit-overlay';

        const courseOpts = state.courses.map(c =>
          `<option value="${c.id}" ${c.id === task.courseId ? 'selected' : ''}>${c.name}</option>`
        ).join('');

        overlay.innerHTML = `
          <div class="edit-modal">
            <div class="edit-modal-head">
              <h4>✏️ تعديل الجلسة</h4>
              <button class="edit-modal-close" data-action="close">✕</button>
            </div>
            <div class="edit-modal-body">
              <label class="lbl">العنوان</label>
              <input type="text" id="editTitle" value="${task.title || ''}" />
              <label class="lbl">المادة</label>
              <select id="editCourse">
                <option value="">بدون مادة</option>
                ${courseOpts}
              </select>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div>
                  <label class="lbl">البداية</label>
                  <input type="time" id="editTimeStart" value="${task.time || '18:00'}" />
                </div>
                <div>
                  <label class="lbl">النهاية</label>
                  <input type="time" id="editTimeEnd" value="${task.timeEnd || '19:00'}" />
                </div>
              </div>
              <label class="lbl">المكان</label>
              <input type="text" id="editPlace" value="${task.place || ''}" />
            </div>
            <div class="edit-modal-foot">
              <button class="btn-primary" data-action="save">💾 حفظ</button>
              <button class="btn-ghost" data-action="close">إلغاء</button>
            </div>
          </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('open'));

        overlay.querySelector('[data-action="close"]').onclick = () => {
          overlay.classList.remove('open');
          setTimeout(() => overlay.remove(), 300);
        };
        overlay.querySelector('.edit-modal-close').onclick = () => {
          overlay.classList.remove('open');
          setTimeout(() => overlay.remove(), 300);
        };
        overlay.onclick = (e) => {
          if (e.target === overlay) {
            overlay.classList.remove('open');
            setTimeout(() => overlay.remove(), 300);
          }
        };

        overlay.querySelector('[data-action="save"]').onclick = () => {
          const newTitle = document.getElementById('editTitle').value.trim();
          const newCourseId = document.getElementById('editCourse').value;
          const newTimeS = document.getElementById('editTimeStart').value;
          const newTimeE = document.getElementById('editTimeEnd').value;
          const newPlace = document.getElementById('editPlace').value.trim();

          // Apply changes
          const idx = state.plan.findIndex(t => t.id === task.id);
          if (idx !== -1) {
            const t = state.plan[idx];
            t.title = newTitle || t.title;
            t.time = newTimeS || t.time;
            t.timeEnd = newTimeE || t.timeEnd;
            t.place = newPlace || t.place;
            if (newCourseId) {
              const c = state.courses.find(x => x.id === newCourseId);
              if (c) { t.courseId = c.id; t.courseName = c.name; t.courseColor = c.color; }
            }
            // Update manual tasks too
            if (t.kind === 'manual' && state.tasks) {
              const ti = state.tasks.findIndex(x => x.id === t.id);
              if (ti !== -1) state.tasks[ti] = { ...t };
            }
          }
          storage.set('uqu_plan_v5', state);
          overlay.classList.remove('open');
          setTimeout(() => overlay.remove(), 300);
          renderPlan();
          renderWeekOverview();
          renderTasksMiniList();
          updateStats();
        };
      }

      // ── Delete session helper ──
      function deleteSession(taskId) {
        state.plan = state.plan.filter(t => t.id !== taskId);
        // Also remove from manual tasks
        if (state.tasks) state.tasks = state.tasks.filter(t => t.id !== taskId);
        storage.set('uqu_plan_v5', state);
        renderPlan();
        renderWeekOverview();
        renderTasksMiniList();
        updateStats();
      }

      // ── Toggle complete helper ──
      function toggleComplete(taskId) {
        const idx = state.plan.findIndex(t => t.id === taskId);
        if (idx !== -1) {
          state.plan[idx].completed = !state.plan[idx].completed;
          storage.set('uqu_plan_v5', state);
          renderPlan();
        }
      }

      // ── Quick-add session to a day column ──
      function quickAddToDay(weekNum, dayName) {
        const dateISO = getDateForWeekAndDay(weekNum - 1, dayName);
        // Pick the first course or default
        const firstCourse = state.courses[0];
        const newTask = {
          id: uuid(),
          kind: 'study',
          week: weekNum,
          day: dayName,
          date: dateISO,
          time: '18:00',
          timeEnd: minutesToTime(parseTimeToMinutes('18:00') + (state.sessionMin || 40)),
          courseId: firstCourse?.id || null,
          courseName: firstCourse?.name || 'جلسة جديدة',
          courseColor: firstCourse?.color || '#6366f1',
          title: (firstCourse?.name || 'جلسة') + ': جلسة دراسية',
          place: 'غير محدد',
          note: ''
        };
        state.plan.push(newTask);
        storage.set('uqu_plan_v5', state);
        renderPlan();
        renderWeekOverview();
        updateStats();
        // Open edit form immediately
        setTimeout(() => openEditForm(newTask), 100);
      }

      for (let w = 1; w <= maxWeeks; w++) {
        if (w !== weekToShow) continue;

        days.forEach((dayName) => {
          const dayTasks = state.plan
            .filter(
              (t) =>
                t.week === w &&
                t.day === dayName &&
                (filterId === 'all' || t.courseId === filterId)
            )
            .sort((a, b) => a.time.localeCompare(b.time));

          const col = document.createElement('div');
          col.className = 'day-column';
          col.dataset.day = dayName;
          col.dataset.week = String(w);

          const isEmpty = dayTasks.length === 0;
          if (isEmpty) col.classList.add('day-empty');

          // Highlight today's column
          const dayDate = getDateForWeekAndDay(w - 1, dayName);
          if (dayDate === todayISO) {
            col.classList.add('day-today');
          }

          if (isEmpty) {
            // ── Slim empty day layout ──
            col.innerHTML = `
              <div class="day-header">
                <div class="day-header-top">
                  <span>${dayName}${dayDate === todayISO ? ' <span class="today-badge">اليوم</span>' : ''}</span>
                  <span class="week-pill">الأسبوع ${w}</span>
                </div>
              </div>
              <div class="day-empty-msg">لا توجد جلسات</div>
            `;
          } else {
            // ── Full day layout with sessions ──
            const coursesSet = new Set(dayTasks.map((t) => t.courseName || t.type));
            const coursesText = Array.from(coursesSet).filter(Boolean).join('، ');

            const completedCount = dayTasks.filter(t => t.completed).length;
            const progressHtml = `<div class="day-progress"><div class="day-progress-bar" style="width:${Math.round(completedCount/dayTasks.length*100)}%"></div></div>`;

            col.innerHTML = `
              <div class="day-header">
                <div class="day-header-top">
                  <span>${dayName}${dayDate === todayISO ? ' <span class="today-badge">اليوم</span>' : ''}</span>
                  <span class="week-pill">الأسبوع ${w}</span>
                </div>
                <div class="day-meta">
                  <span>جلسات: ${dayTasks.length}${completedCount > 0 ? ' ('+completedCount+' ✓)' : ''}</span>
                  <span>${coursesText}</span>
                </div>
                ${progressHtml}
              </div>
            `;
          }

          // Quick-add button
          const addBtn = document.createElement('button');
          addBtn.className = 'day-quick-add';
          addBtn.innerHTML = '+ إضافة جلسة';
          addBtn.onclick = (e) => { e.stopPropagation(); quickAddToDay(w, dayName); };
          col.querySelector('.day-header').appendChild(addBtn);

          col.ondragover = (e) => {
            e.preventDefault();
            col.classList.add('drag-over');
          };
          col.ondragleave = () => col.classList.remove('drag-over');
          col.ondrop = (e) => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const dataStr = e.dataTransfer.getData('text/plain');
            if (!dataStr) return;
            const taskData = JSON.parse(dataStr);

            state.plan = state.plan.filter((t) => t.id !== taskData.id);

            const targetWeek = parseInt(col.dataset.week, 10) || 1;
            const targetDay = col.dataset.day;

            taskData.week = targetWeek;
            taskData.day = targetDay;
            taskData.date = getDateForWeekAndDay(targetWeek - 1, targetDay);

            state.plan.push(taskData);

            if (taskData.kind === 'manual' && state.tasks) {
              const idx = state.tasks.findIndex((t) => t.id === taskData.id);
              if (idx !== -1) state.tasks[idx] = taskData;
            }

            storage.set('uqu_plan_v5', state);
            renderPlan();
            renderWeekOverview();
            renderTasksMiniList();
          };

          dayTasks.forEach((task) => {
            const card = document.createElement('div');
            card.className = 'task-card';
            if (task.completed) card.classList.add('task-done');
            if (task.id === nowInfo.currentId) {
              card.classList.add('is-now');
            }
            card.draggable = true;
            const typeLabel = task.kind === 'manual'
              ? (task.type || 'مهمة')
              : (task.courseName || '');

            const noteText = task.note
              ? `<div class="task-tip">💡 ${task.note}</div>`
              : '';

            card.innerHTML = `
              <div class="task-actions">
                <button class="ta-btn ta-check${task.completed ? ' ta-checked' : ''}" data-action="complete" title="${task.completed ? 'إلغاء الإكمال' : 'تم الإنجاز'}">✓</button>
                <button class="ta-btn ta-edit" data-action="edit" title="تعديل">✏️</button>
                <button class="ta-btn ta-del" data-action="delete" title="حذف">🗑️</button>
              </div>
              <div class="task-course-line">
                <span class="task-course-dot" style="background:${task.courseColor || '#6366f1'};"></span>
                <span>${typeLabel}</span>
              </div>
              <div class="task-time">${task.time} — ${task.timeEnd}</div>
              <div class="task-title">${task.title}</div>
              <div class="task-note">📍 ${task.place || 'غير محدد'} • ${task.date}</div>
              <button class="task-focus-btn" data-action="focus">ابدأ الجلسة ⏱️</button>
              ${noteText}
            `;

            // Action button handlers
            card.querySelector('[data-action="complete"]').onclick = (e) => {
              e.stopPropagation(); toggleComplete(task.id);
            };
            card.querySelector('[data-action="edit"]').onclick = (e) => {
              e.stopPropagation(); openEditForm(task);
            };
            card.querySelector('[data-action="delete"]').onclick = (e) => {
              e.stopPropagation();
              if (confirm('حذف هذه الجلسة؟')) deleteSession(task.id);
            };
            card.querySelector('[data-action="focus"]').onclick = (e) => {
              e.stopPropagation();
              if (window.UQUPomodoro) {
                window.UQUPomodoro.startSession(task.courseName || task.title, task.courseId || task.id);
              }
            };

            if (task.id === nowInfo.currentId) {
              const badge = document.createElement('div');
              badge.className = 'task-now-badge';
              badge.textContent = '🔥 هذه الجلسة وقتها الآن';
              card.appendChild(badge);
            } else if (
              task.id === nowInfo.nextId &&
              nowInfo.nextDiffText
            ) {
              const badge = document.createElement('div');
              badge.className = 'task-next-badge';
              badge.textContent = `⏭ الجلسة القادمة (${nowInfo.nextDiffText})`;
              card.appendChild(badge);
            }

            card.ondragstart = (e) => {
              card.classList.add('ghost');
              e.dataTransfer.setData('text/plain', JSON.stringify(task));
            };
            card.ondragend = () => card.classList.remove('ghost');

            col.appendChild(card);
          });

          els.planGrid.appendChild(col);
        });
      }

      updateStats();
    }

    // قائمة مصغّرة للمهام اليدوية في الشريط الجانبي
    function renderTasksMiniList() {
      if (!els.tasksMiniList) return;
      const list = state.tasks || [];
      if (!list.length) {
        els.tasksMiniList.innerHTML =
          '<span style="font-size:0.8rem; color:var(--muted);">لا توجد مهام أو اختبارات مضافة بعد.</span>';
        return;
      }
      els.tasksMiniList.innerHTML = '';
      list
        .sort((a, b) => a.week - b.week || dayIndex[a.day] - dayIndex[b.day] || a.time.localeCompare(b.time))
        .forEach((t, idx) => {
          const div = document.createElement('div');
          div.className = 'tasks-mini-item';
          const typeLabel =
            t.type === 'exam'
              ? 'اختبار'
              : t.type === 'quiz'
              ? 'كويز'
              : t.type === 'assignment'
              ? 'واجب'
              : t.type === 'project'
              ? 'مشروع'
              : 'أخرى';

          div.innerHTML = `
            <div class="tasks-mini-main">
              <div class="tasks-mini-title">${t.title || '(بدون عنوان)'}</div>
              <div class="tasks-mini-meta">
                الأسبوع ${t.week} • ${t.day} • ${t.time} - ${t.timeEnd}
                ${t.courseName ? ' • ' + t.courseName : ''}
              </div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
              <span class="tasks-mini-type">${typeLabel}</span>
              <button class="tasks-mini-remove" data-idx="${idx}">✕</button>
            </div>
          `;
          els.tasksMiniList.appendChild(div);
        });

      els.tasksMiniList
        .querySelectorAll('.tasks-mini-remove')
        .forEach((btn) => {
          btn.onclick = () => {
            const index = parseInt(btn.dataset.idx, 10);
            const removed = state.tasks.splice(index, 1)[0];
            if (removed) {
              state.plan = (state.plan || []).filter((p) => p.id !== removed.id);
              storage.set('uqu_plan_v5', state);
              renderTasksMiniList();
              renderPlan();
              renderWeekOverview();
              updateStats();
            }
          };
        });
    }

    if (els.planTitle) els.planTitle.oninput = save;

    if (els.courseFilter) {
      els.courseFilter.onchange = () => {
        state.filterCourseId = els.courseFilter.value;
        storage.set('uqu_plan_v5', state);
        renderPlan();
      };
    }

    if (els.addBtn && !hasProfileData) {
      els.addBtn.onclick = () => {
        const from = els.fromTime?.value;
        if (!from) return;

        const sessionMins = state.sessionMin || 60;
        const fromMins = parseTimeToMinutes(from);
        const toMins = fromMins + sessionMins;
        const to = minutesToTime(toMins);

        state.slots.push({
          day: els.daySel?.value,
          from: from,
          to: to,
          place: els.place?.value.trim()
        });
        if (els.place) els.place.value = '';
        storage.set('uqu_plan_v5', state);
        renderChips();
        updateStats();
      };
    }

    // زر إضافة مهمة/اختبار يدوي
if (els.addTaskBtn) {
  els.addTaskBtn.onclick = () => {
    if (!state.planStart) {
      const base = getPlanStartDateObj();
      state.planStart = formatISODate(base);
    }

    const title = (els.taskTitle?.value || '').trim();
    let dayName = els.taskDay?.value || 'الأحد';
    const time = els.taskTime?.value || '19:00';
    const durationMin =
      parseInt(els.taskDuration?.value, 10) || 60;
    const type = els.taskType?.value || 'other';
    const courseId = els.taskCourse?.value || '';

    let deadlineDate = els.taskDeadlineDate?.value || '';
    const deadlineTime = els.taskDeadlineTime?.value || time;

    if (!title) return alert('أدخل عنوان المهمة أولاً.');

    // 🔒 منع اختيار موعد في الماضي (عند إدخال تاريخ يدوي)
    if (deadlineDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const d = new Date(deadlineDate + 'T00:00:00');
      d.setHours(0, 0, 0, 0);

      if (d < today) {
        alert('لا يمكن اختيار موعد في الماضي. اختر تاريخاً من اليوم فما بعد.');
        return;
      }
    }

    const startM = parseTimeToMinutes(time);
    const endM = startM + Math.max(15, durationMin);
    const timeEnd = minutesToTime(endM);

    let currentWeek = state.currentWeekView || 1;
    let dateISO;

    if (deadlineDate) {
      // ✅ عند وجود تاريخ، نستخدمه ونضبط اليوم عليه
      const base = getPlanStartDateObj();
      const d = new Date(deadlineDate + 'T00:00:00');
      d.setHours(0, 0, 0, 0);

      const diffDays = Math.floor((d - base) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0) {
        currentWeek = Math.floor(diffDays / 7) + 1;
      } else {
        currentWeek = 1;
      }

      const dow = d.getDay(); // 0 الأحد، 1 الاثنين، ...
      const dayNameFromDate = Object.keys(dayIndex).find(
        (k) => dayIndex[k] === dow
      );
      if (dayNameFromDate) {
        dayName = dayNameFromDate;
        if (els.taskDay) els.taskDay.value = dayNameFromDate; // تحديث القائمة في الواجهة
      }

      dateISO = formatISODate(d);
    } else {
      // ✅ بدون إدخال تاريخ → نحسب أقرب يوم قادم من "اليوم الحقيقي"
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayDow = today.getDay();         // 0..6
      const targetDow = dayIndex[dayName];     // 0..6

      // أقرب يوم قادم (لو اخترت نفس اليوم، يعطي اليوم نفسه)
      let diff = (targetDow - todayDow + 7) % 7;
      const d = new Date(today);
      d.setDate(today.getDate() + diff);

      dateISO = formatISODate(d);
      deadlineDate = dateISO;                    // نعتبره Deadline أيضاً
      if (els.taskDeadlineDate) {
        els.taskDeadlineDate.value = dateISO;    // يعرض التاريخ في حقل التاريخ
      }

      const base = getPlanStartDateObj();
      const diffDays2 = Math.floor((d - base) / (1000 * 60 * 60 * 24));
      currentWeek = diffDays2 >= 0 ? Math.floor(diffDays2 / 7) + 1 : 1;
    }

    let courseName = '';
    let courseColor = '#0f172a';
    if (courseId) {
      const c = state.courses.find((x) => x.id === courseId);
      if (c) {
        courseName = c.name;
        courseColor = c.color || '#6366f1';
      }
    }

    const id = uuid();

    const taskObj = {
      id,
      kind: 'manual',
      week: currentWeek,
      day: dayName,
      date: dateISO,
      time,
      timeEnd,
      type,
      courseId: courseId || null,
      courseName: courseName || '',
      courseColor,
      title,
      place: '—',
      note: 'مهمة/اختبار تمت إضافتها يدويًا',
      deadlineDate: deadlineDate || null,
      deadlineTime: deadlineTime || null
    };

    state.tasks.push(taskObj);
    state.plan = (state.plan || []).concat([taskObj]);

    storage.set('uqu_plan_v5', state);
    renderTasksMiniList();
    renderPlan();
    renderWeekOverview();
    updateStats();

    if (els.taskTitle) els.taskTitle.value = '';
  };
}

    const genBtnEl = $('genBtn');
    if (genBtnEl) genBtnEl.onclick = generatePlan;

    // Week navigation buttons
    if (els.weekPrev) {
      els.weekPrev.onclick = () => {
        if ((state.currentWeekView || 1) > 1) {
          state.currentWeekView--;
          storage.set('uqu_plan_v5', state);
          renderWeekNav();
          renderPlan();
        }
      };
    }
    if (els.weekNext) {
      els.weekNext.onclick = () => {
        if ((state.currentWeekView || 1) < (state.weeks || 1)) {
          state.currentWeekView++;
          storage.set('uqu_plan_v5', state);
          renderWeekNav();
          renderPlan();
        }
      };
    }

    const resetBtn = $('resetBtn');
    if (resetBtn) {
      resetBtn.onclick = () => {
        if (
          confirm(
            'هل أنت متأكد؟ سيتم حذف الخطة والمواد والفترات والمهام المحفوظة.'
          )
        ) {
          storage.del('uqu_plan_v5');
          location.reload();
        }
      };
    }

    const copyBtn = $('copyBtn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (!state.plan.length) return;
        let txt = `خطة دراسة: ${state.planTitle}\n`;
        txt += `عدد المواد: ${state.courses.length}\n`;
        txt += `الأسابيع: ${state.weeks}\nمدة الجلسة: ${state.sessionMin} دقيقة\n\n`;

        const sorted = [...state.plan].sort(
          (a, b) =>
            a.week - b.week ||
            dayIndex[a.day] - dayIndex[b.day] ||
            a.time.localeCompare(b.time)
        );

        sorted.forEach((t) => {
          txt += `الأسبوع ${t.week} - ${t.day} (${t.date}) ${t.time} - ${
            t.timeEnd
          }: [${t.courseName || t.type || ''}] ${t.title} @ ${t.place}\n`;
        });
        navigator.clipboard
          .writeText(txt)
          .then(() => alert('تم نسخ الخطة نصيًا!'));
      };
    }

    const icsBtn = $('icsBtn');
    if (icsBtn) {
      icsBtn.onclick = () => {
        if (!state.plan.length) return alert('لا توجد خطة!');
        let icsMsg =
          'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//UQU Academic Planner//AR\r\n';
        const now = new Date();
        const dtStamp =
          now.getFullYear().toString() +
          pad2(now.getMonth() + 1) +
          pad2(now.getDate()) +
          'T' +
          pad2(now.getHours()) +
          pad2(now.getMinutes()) +
          pad2(now.getSeconds());

        state.plan.forEach((t, idx) => {
          const dateStr = (t.date || '').replace(/-/g, '');
          const startTime = (t.time || '18:00').replace(':', '') + '00';
          const endTime =
            (t.timeEnd || t.time || '19:00').replace(':', '') + '00';
          const uid = `uqu-plan-${dateStr}-${idx}@uqu-planner`;

          icsMsg += 'BEGIN:VEVENT\r\n';
          icsMsg += 'UID:' + uid + '\r\n';
          icsMsg += 'DTSTAMP:' + dtStamp + '\r\n';
          icsMsg += 'SUMMARY:' + (t.title || t.courseName || '') + '\r\n';
          icsMsg += 'DESCRIPTION:' + (t.note || '') + '\r\n';
          icsMsg += 'LOCATION:' + (t.place || '') + '\r\n';
          icsMsg += 'DTSTART:' + dateStr + 'T' + startTime + '\r\n';
          icsMsg += 'DTEND:' + dateStr + 'T' + endTime + '\r\n';
          icsMsg += 'END:VEVENT\r\n';
        });
        icsMsg += 'END:VCALENDAR';

        const blob = new Blob([icsMsg], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'study-plan.ics';
        a.click();
        URL.revokeObjectURL(url);
      };
    }

    // 👇 تعديل: لا نغيّر الأسبوع الحالي إذا كان محفوظاً من قبل
    if (!state.currentWeekView) {
      if (state.plan && state.plan.length && state.planStart) {
        const fromToday = computeCurrentWeekFromToday();
        const weeksWithTasks = Array.from(
          new Set(state.plan.map((t) => t.week))
        );

        if (weeksWithTasks.includes(fromToday)) {
          state.currentWeekView = fromToday;
        } else if (weeksWithTasks.length) {
          state.currentWeekView = weeksWithTasks.sort((a, b) => a - b)[0];
        } else {
          state.currentWeekView = 1;
        }
      } else {
        state.currentWeekView = 1;
      }

      storage.set('uqu_plan_v5', state);
    }


    // ──────────────────────────────────────────────
    // WEEK OVERVIEW — Shows current week + next week summaries
    // ──────────────────────────────────────────────
    function renderWeekOverview() {
      var container = document.getElementById('weekOverview');
      if (!container) return;
      if (!state.plan || !state.plan.length) { container.innerHTML = ''; return; }

      var curW = computeCurrentWeekFromToday();
      var nxtW = curW < (state.weeks || 1) ? curW + 1 : null;

      function buildCard(weekNum, isCurrent) {
        if (!weekNum) return '';
        var sessions = state.plan.filter(function(s){ return s.week === weekNum; });
        var icon = isCurrent ? '📌' : '⏭';
        var label = isCurrent ? 'هذا الأسبوع' : 'الأسبوع القادم';

        var dateRange = '';
        if (state.planStart) {
          var ws = new Date(state.planStart + 'T00:00:00');
          ws.setDate(ws.getDate() + (weekNum - 1) * 7);
          var we = new Date(ws); we.setDate(ws.getDate() + 6);
          dateRange = ws.toLocaleDateString('ar-SA',{month:'short',day:'numeric'}) +
            ' - ' + we.toLocaleDateString('ar-SA',{month:'short',day:'numeric'});
        }

        if (!sessions.length) {
          return '<div class="wo-card' + (isCurrent ? ' wo-card--current' : '') + '">' +
            '<div class="wo-head"><span class="wo-title">' + icon + ' ' + label + '</span>' +
            (dateRange ? '<span class="wo-badge">' + dateRange + '</span>' : '') +
            '</div><p class="wo-empty">لا توجد جلسات</p></div>';
        }

        var courseMap = {};
        var totalMins = 0;
        sessions.forEach(function(s){
          var nm = s.courseName || s.type || 'أخرى';
          if (!courseMap[nm]) courseMap[nm] = { count:0, color: s.courseColor || '#6366f1' };
          courseMap[nm].count++;
          var sm = parseTimeToMinutes(s.time);
          var em = parseTimeToMinutes(s.timeEnd);
          totalMins += Math.max(0, em - sm);
        });
        var hours = (totalMins / 60).toFixed(1);

        var coursesHtml = '';
        Object.keys(courseMap).forEach(function(nm){
          var info = courseMap[nm];
          coursesHtml += '<div class="wo-course"><span class="wo-dot" style="background:' +
            info.color + '"></span>' + nm + '<span class="wo-count">' + info.count + ' جلسة</span></div>';
        });

        return '<div class="wo-card' + (isCurrent ? ' wo-card--current' : '') + '">' +
          '<div class="wo-head"><span class="wo-title">' + icon + ' ' + label + '</span>' +
          (dateRange ? '<span class="wo-badge">' + dateRange + '</span>' : '') +
          '</div>' +
          '<div class="wo-meta">' + sessions.length + ' جلسة • ' + hours + ' ساعة</div>' +
          '<div class="wo-courses">' + coursesHtml + '</div></div>';
      }

      container.innerHTML = buildCard(curW, true) + (nxtW ? buildCard(nxtW, false) : '');

      // Clicking overview navigates to that week
      container.querySelectorAll('.wo-card').forEach(function(card, idx){
        card.style.cursor = 'pointer';
        card.onclick = function(){
          state.currentWeekView = idx === 0 ? curW : (nxtW || curW);
          storage.set('uqu_plan_v5', state);
          renderWeekNav();
          renderPlan();
        };
      });
    }

    if (els.planTitle) els.planTitle.value = state.planTitle || 'خطة دراسة الفصل';

    // Auto-jump to current week on first load
    if (state.plan && state.plan.length && state.planStart) {
      var autoWeek = computeCurrentWeekFromToday();
      var weeksActive = state.plan.map(function(t){ return t.week; });
      if (weeksActive.indexOf(autoWeek) !== -1) {
        state.currentWeekView = autoWeek;
      }
    }

    renderCourses();
    renderChips();
    renderWeekNav();
    renderPlan();
    renderWeekOverview();
    renderTasksMiniList();
    updateStats();
  })();
}


  // =================================================================
  // 7. LOCATIONS PAGE — ADVANCED LOCATION SYSTEM (from locations.html)
  // =================================================================

  function initLocationsPage() {
    const container = document.getElementById('floorplanContainer');
    if (!container || !window.FloorPlanEngine) return;

    // ── Create the floor plan engine ──
    const engine = new window.FloorPlanEngine(container);

    // ── Zoom indicator ──
    const zoomInd = document.getElementById('zoomIndicator');
    function updateZoom() {
      if (zoomInd) zoomInd.textContent = Math.round(engine.scale * 100) + '%';
    }
    // Patch _apply to keep zoom indicator in sync
    const origApply = engine._apply.bind(engine);
    engine._apply = function () { origApply(); updateZoom(); };
    updateZoom();

    // ── Global control functions (referenced by onclick in HTML) ──
    window.fpZoomIn      = () => engine.zoomIn();
    window.fpZoomOut     = () => engine.zoomOut();
    window.fpResetView   = () => engine.resetView();
    window.fpRotateLeft  = () => engine.rotateLeft();
    window.fpRotateRight = () => engine.rotateRight();
    window.fpCenterSelected = () => {
      if (engine.selectedData) engine._centerOnItem(engine.selectedData);
    };

    // ── Filter by room type ──
    window.fpFilterType = function (type) {
      const rooms = engine.filterByType(type);
      const box = document.getElementById('searchResults');
      if (!box || !rooms.length) return;
      box.style.display = 'flex';
      box.innerHTML = rooms.map(r => {
        const st = window.ROOM_STYLE[r.type] || { icon: '📍', label: r.type };
        return `<div class="fp-search-item" data-room-id="${r.id}">
          <span class="fp-si-icon">${st.icon}</span>
          <div><div class="fp-si-label">${r.label}</div><div class="fp-si-type">${st.label}</div></div>
        </div>`;
      }).join('');
      box.querySelectorAll('.fp-search-item').forEach(el => {
        el.addEventListener('click', () => {
          engine.selectRoom(el.dataset.roomId);
          box.style.display = 'none';
        });
      });
    };

    // ── Search ──
    const roomInput = document.getElementById('roomInput');
    const searchBtn = document.getElementById('searchBtn');
    const searchResults = document.getElementById('searchResults');

    // ── Recent searches (localStorage) ──
    const RECENT_KEY = 'uqu_recent_searches';
    const MAX_RECENT = 6;

    function _getRecent() {
      try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch(e) { return []; }
    }
    function _saveRecent(room) {
      const list = _getRecent().filter(r => r.id !== room.id);
      list.unshift({ id: room.id, label: room.label, type: room.type });
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    }

    // Build an HTML item for a search/recent result
    function _buildItem(r, opts) {
      const st = window.ROOM_STYLE[r.type] || { icon: '📍', label: r.type };
      const icon = opts && opts.recent ? '🕐' : st.icon;
      return `<div class="fp-search-item" data-room-id="${r.id}">
        <span class="fp-si-icon">${icon}</span>
        <div><div class="fp-si-label">${r.label}</div><div class="fp-si-type">${st.label}</div></div>
      </div>`;
    }

    // Attach click listeners to items inside the dropdown
    function _bindDropdownClicks() {
      if (!searchResults) return;
      searchResults.querySelectorAll('.fp-search-item').forEach(el => {
        el.addEventListener('click', () => {
          const roomId = el.dataset.roomId;
          engine.selectRoom(roomId);
          _shouldRestoreSheet = false; // new room selected — sheet opens via room-selected event
          _closeDropdown();
          roomInput.value = '';
          // Save to recent searches
          const mapData = window.MAP_DATA || [];
          const room = mapData.find(r => r.id === roomId);
          if (room) _saveRecent(room);
        });
      });
    }

    // ── Dropdown state helpers ──
    // _shouldRestoreSheet: track whether bottom sheet should reappear after dropdown closes
    var _shouldRestoreSheet = false;

    function _openDropdown() {
      if (!searchResults) return;
      searchResults.style.display = 'flex';
      // Force reflow before adding class for transition
      void searchResults.offsetHeight;
      searchResults.classList.add('open');
      // Hide bottom sheet with animation
      if (bottomSheet && bottomSheet.classList.contains('open')) {
        _shouldRestoreSheet = true;
      }
      _closeBottomSheet();
    }

    function _closeDropdown() {
      if (!searchResults) return;
      searchResults.classList.remove('open');
      // After transition, hide display
      setTimeout(() => {
        if (!searchResults.classList.contains('open')) {
          searchResults.style.display = 'none';
        }
      }, 220);
      // Restore bottom sheet if a room was previously selected
      if (_shouldRestoreSheet) {
        _shouldRestoreSheet = false;
        _openBottomSheet();
      }
    }

    // Show recent searches dropdown
    function _showRecent() {
      if (!searchResults) return;
      const recent = _getRecent();
      if (!recent.length) { _closeDropdown(); return; }
      searchResults.innerHTML =
        '<div class="fp-search-section-label">عمليات بحث سابقة</div>' +
        recent.map(r => _buildItem(r, { recent: true })).join('');
      _bindDropdownClicks();
      _openDropdown();
    }

    // Live search / autocomplete
    function _liveSearch() {
      if (!roomInput || !searchResults) return;
      const q = roomInput.value.trim();
      if (!q) { _showRecent(); return; }
      const matches = engine.searchRoom(q);
      if (!matches.length) {
        searchResults.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:.85rem;">لا توجد نتائج</div>';
        _openDropdown();
        return;
      }
      searchResults.innerHTML = matches.slice(0, 10).map(r => _buildItem(r)).join('');
      _bindDropdownClicks();
      _openDropdown();
    }

    // Full search (Enter / button click) — auto-select if single result
    function doSearch() {
      if (!roomInput) return;
      const q = roomInput.value.trim();
      if (!q) { _closeDropdown(); return; }
      const matches = engine.searchRoom(q);
      if (!searchResults) return;
      if (matches.length === 1) {
        engine.selectRoom(matches[0].id);
        _shouldRestoreSheet = false; // new room selected, sheet will open from room-selected event
        _closeDropdown();
        roomInput.value = '';
        _saveRecent(matches[0]);
        return;
      }
      _liveSearch();
    }

    if (searchBtn) searchBtn.addEventListener('click', doSearch);
    if (roomInput) {
      roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
      // Live autocomplete as user types
      roomInput.addEventListener('input', _liveSearch);
      // Show recent/suggestions on focus — always hide info panel
      roomInput.addEventListener('focus', () => {
        const q = roomInput.value.trim();
        if (q) { _liveSearch(); } else { _showRecent(); }
      });
    }
    // Close dropdown when clicking outside
    document.addEventListener('click', e => {
      if (searchResults && !e.target.closest('.map-search-float')) {
        _closeDropdown();
      }
    });

    // ── Bottom sheet + Room-selected event ──
    const bottomSheet = document.getElementById('bottomSheet');
    const resultCard  = document.getElementById('resultCard');
    const resTitle    = document.getElementById('resTitle');
    const resSubtitle = document.getElementById('resSubtitle');
    const resType     = document.getElementById('resType');
    const resIcon     = document.getElementById('resIcon');

    function _openBottomSheet() {
      if (bottomSheet) bottomSheet.classList.add('open');
    }
    function _closeBottomSheet() {
      if (bottomSheet) bottomSheet.classList.remove('open');
    }

    // Legend toggle
    const legendToggle = document.getElementById('legendToggle');
    const legendPopup  = document.getElementById('legendPopup');
    if (legendToggle && legendPopup) {
      legendToggle.addEventListener('click', () => {
        legendPopup.style.display = legendPopup.style.display === 'none' ? 'block' : 'none';
      });
    }

    container.addEventListener('room-selected', e => {
      const room = e.detail;
      if (!room) return;
      const st = window.ROOM_STYLE[room.type] || { icon: '📍', label: room.type };
      if (resTitle)    resTitle.textContent    = room.label;
      if (resSubtitle) resSubtitle.textContent = st.label + ' — الدور الأرضي';
      if (resType)     resType.textContent     = st.label;
      if (resIcon)     resIcon.textContent     = st.icon;
      if (resultCard)  resultCard.style.display = '';
      _openBottomSheet();
    });

    // ══════════════════════════════════════════════════════
    // ── INDOOR NAVIGATION SYSTEM ──
    // ══════════════════════════════════════════════════════
    let navState = 'IDLE'; // IDLE | SELECTING_ORIGIN | ROUTING
    let navDestination = null;
    let navOrigin = null;
    let navEngineInstance = null;
    let navRendererInstance = null;

    // Init nav engine
    if (window.NavEngine && window.NavRenderer) {
      navEngineInstance = new window.NavEngine();
      navEngineInstance.buildGraph();
    }

    // UI elements
    const navToBtn      = document.getElementById('navToBtn');
    const navBanner     = document.getElementById('navBanner');
    const navBannerText = document.getElementById('navBannerText');
    const navCancelBtn  = document.getElementById('navCancelBtn');
    const navPanel      = document.getElementById('navPanel');
    const navFrom       = document.getElementById('navFrom');
    const navTo         = document.getElementById('navTo');
    const navDistance    = document.getElementById('navDistance');
    const navTime       = document.getElementById('navTime');
    const navStepCount  = document.getElementById('navStepCount');
    const navSteps      = document.getElementById('navSteps');
    const navClearBtn   = document.getElementById('navClearBtn');
    const navAccessible = document.getElementById('navAccessible');

    // Show "Navigate" button when a room is selected
    container.addEventListener('room-selected', () => {
      if (navToBtn && navState === 'IDLE') navToBtn.style.display = '';
    });

    // ── Pin marker for free-point origin ──
    let _pinMarker = null;
    function _showPinMarker(x, y) {
      _removePinMarker();
      const ns = 'http://www.w3.org/2000/svg';
      _pinMarker = document.createElementNS(ns, 'g');
      _pinMarker.setAttribute('class', 'nav-pin-marker');
      // Pin body
      const pin = document.createElementNS(ns, 'circle');
      pin.setAttribute('cx', x);
      pin.setAttribute('cy', y);
      pin.setAttribute('r', '0.8');
      pin.setAttribute('fill', '#22c55e');
      pin.setAttribute('stroke', '#fff');
      pin.setAttribute('stroke-width', '0.2');
      // Pulse ring
      const pulse = document.createElementNS(ns, 'circle');
      pulse.setAttribute('cx', x);
      pulse.setAttribute('cy', y);
      pulse.setAttribute('r', '1.5');
      pulse.setAttribute('fill', 'rgba(34,197,94,0.2)');
      pulse.setAttribute('class', 'nav-pulse');
      _pinMarker.appendChild(pulse);
      _pinMarker.appendChild(pin);
      engine.svg.appendChild(_pinMarker);
    }
    function _removePinMarker() {
      if (_pinMarker && _pinMarker.parentNode) {
        _pinMarker.parentNode.removeChild(_pinMarker);
      }
      _pinMarker = null;
    }

    // Start navigation: set destination, ask for origin
    window.fpStartNav = function () {
      if (!navEngineInstance || !engine.selectedData) return;

      const dest = engine.selectedData;
      // Check if room has doors
      if (!dest.doors || dest.doors.length === 0) {
        if (navBanner) {
          navBanner.style.display = 'block';
          if (navBannerText) navBannerText.textContent = 'هذه الغرفة لا تحتوي على باب محدد — لا يمكن التنقل إليها';
          setTimeout(() => { navBanner.style.display = 'none'; }, 3000);
        }
        return;
      }

      navDestination = dest;
      navState = 'SELECTING_ORIGIN';
      engine._suppressAutoCenter = true; // Don't auto-zoom when selecting origin

      if (navBanner) {
        navBanner.style.display = 'block';
        if (navBannerText) navBannerText.textContent = 'انقر على أي مكان في الخريطة لتحديد نقطة البداية';
      }
      if (navToBtn) navToBtn.style.display = 'none';

      // Override room-selected to capture origin (room click)
      engine._navSelectHandler = function (e) {
        if (navState !== 'SELECTING_ORIGIN') return;
        const origin = e.detail;
        if (!origin || !origin.doors || origin.doors.length === 0) return;
        if (origin.id === navDestination.id) return;

        navOrigin = origin;
        navOrigin._fromNode = null; // route by room ID
        _executeRoute();
      };
      container.addEventListener('room-selected', engine._navSelectHandler);

      // Free-point click handler (click on empty space)
      engine._freeClickHandler = function (e) {
        if (navState !== 'SELECTING_ORIGIN') return;
        // Skip if user was dragging the map (not a genuine click)
        if (engine._isDragging) return;
        // Only trigger if NOT clicking on a room polygon
        if (e.target.closest('.room-group')) return;

        const mapCoords = engine.clientToMapCoords(e.clientX, e.clientY);
        if (!mapCoords || mapCoords.x < 0 || mapCoords.x > 100 || mapCoords.y < 0 || mapCoords.y > 100) return;

        // Find nearest walkable node
        const snap = navEngineInstance.snapToNearestEdge(mapCoords.x, mapCoords.y);
        if (!snap || snap.distance > 15) {
          // Too far from any corridor — try nearest node
          const nearest = navEngineInstance.findNearestNode(mapCoords.x, mapCoords.y);
          if (!nearest || nearest.distance > 20) return;
          // Show pin at clicked position
          _showPinMarker(mapCoords.x, mapCoords.y);
          navOrigin = { id: '__freepoint__', label: 'نقطة مخصصة', _fromNode: nearest.nodeId };
          _executeRoute();
          return;
        }

        _showPinMarker(mapCoords.x, mapCoords.y);
        navOrigin = { id: '__freepoint__', label: 'نقطة مخصصة', _fromNode: snap.nodeId };
        _executeRoute();
      };
      container.addEventListener('click', engine._freeClickHandler);
    };

    function _executeRoute() {
      navState = 'ROUTING';
      if (navBanner) navBanner.style.display = 'none';

      // Remove override listeners
      if (engine._navSelectHandler) {
        container.removeEventListener('room-selected', engine._navSelectHandler);
        engine._navSelectHandler = null;
      }
      if (engine._freeClickHandler) {
        container.removeEventListener('click', engine._freeClickHandler);
        engine._freeClickHandler = null;
      }

      const accessible = navAccessible ? navAccessible.checked : false;

      // Route from node (free-point / entrance) or from room
      let result;
      if (navOrigin._fromNode) {
        result = navEngineInstance.findPathFromNode(navOrigin._fromNode, navDestination.id, { accessible });
      } else {
        result = navEngineInstance.findPath(navOrigin.id, navDestination.id, { accessible });
      }

      if (!result) {
        if (navPanel) {
          navPanel.style.display = 'block';
          if (navFrom) navFrom.textContent = navOrigin.label;
          if (navTo) navTo.textContent = navDestination.label;
          if (navSteps) navSteps.innerHTML = '<li style="color:var(--danger);">لا يوجد مسار متاح بين هاتين النقطتين</li>';
          if (navDistance) navDistance.textContent = '—';
          if (navTime) navTime.textContent = '—';
          if (navStepCount) navStepCount.textContent = '—';
        }
        return;
      }

      // Draw route on map
      if (!navRendererInstance) {
        navRendererInstance = new window.NavRenderer(engine.svg);
      }
      navRendererInstance.clearRoute();
      navRendererInstance.drawRoute(result, navEngineInstance);

      // Highlight start/end rooms
      navRendererInstance.highlightRoom(engine, navOrigin.id, '#22c55e');
      navRendererInstance.highlightRoom(engine, navDestination.id, '#ef4444');

      // Fit route in view
      _fitRouteInView(result.points);

      // Update nav panel inside bottom sheet
      if (navPanel) navPanel.style.display = 'block';
      if (resultCard) resultCard.style.display = 'none';
      _openBottomSheet();
      if (navFrom) navFrom.textContent = navOrigin.label;
      if (navTo) navTo.textContent = navDestination.label;
      if (navDistance) navDistance.textContent = '~' + result.distanceMeters + 'م';
      if (navTime) navTime.textContent = result.estimatedTime;
      if (navStepCount) navStepCount.textContent = result.steps.length + ' خطوات';
      if (navSteps) {
        navSteps.innerHTML = result.steps.map(s =>
          `<li><span class="nav-step-icon">${s.icon}</span> ${s.text}</li>`
        ).join('');
      }
    }

    function _fitRouteInView(points) {
      if (points.length < 2) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const cr = container.getBoundingClientRect();
      const scaleX = (cr.width * 0.6) / ((spanX / 100) * engine._displayW);
      const scaleY = (cr.height * 0.6) / ((spanY / 100) * engine._displayH);
      // Gentle fit: cap at 3x, keep current scale if already suitable
      const fitScale = Math.min(Math.max(Math.min(scaleX, scaleY), 1), 3);
      const targetScale = Math.min(fitScale, Math.max(engine.scale, 1.5));

      const pxX = (cx / 100) * engine._displayW;
      const pxY = (cy / 100) * engine._displayH;
      engine.scale = targetScale;
      engine.panX = (cr.width / 2) - (pxX * engine.scale);
      engine.panY = (cr.height / 2) - (pxY * engine.scale);
      engine._apply(true);
    }

    function _clearNavigation() {
      navState = 'IDLE';
      navDestination = null;
      navOrigin = null;
      engine._suppressAutoCenter = false;

      if (engine._navSelectHandler) {
        container.removeEventListener('room-selected', engine._navSelectHandler);
        engine._navSelectHandler = null;
      }
      if (engine._freeClickHandler) {
        container.removeEventListener('click', engine._freeClickHandler);
        engine._freeClickHandler = null;
      }

      _removePinMarker();

      if (navRendererInstance) {
        navRendererInstance.clearRoute();
        // Clear room highlights
        (window.MAP_DATA || []).forEach(r => {
          if (r.type !== 'corridor') navRendererInstance.clearHighlight(engine, r.id);
        });
      }

      if (navBanner) navBanner.style.display = 'none';
      if (navPanel) navPanel.style.display = 'none';
      if (navToBtn) navToBtn.style.display = 'none';
      if (resultCard) resultCard.style.display = '';
      _closeBottomSheet();
    }

    if (navCancelBtn) navCancelBtn.addEventListener('click', _clearNavigation);
    if (navClearBtn) navClearBtn.addEventListener('click', _clearNavigation);

    // Re-route when accessibility toggle changes
    if (navAccessible) {
      navAccessible.addEventListener('change', () => {
        if (navState === 'ROUTING' && navOrigin && navDestination) {
          _executeRoute();
        }
      });
    }

    // ══════════════════════════════════════════════════════
    // ── LIVE NAVIGATION (GPS + Compass + Blue Dot) ──
    // ══════════════════════════════════════════════════════
    let liveNav = null;
    const navUseLocationBtn = document.getElementById('navUseLocationBtn');
    const compassToggle     = document.getElementById('compassToggle');
    const liveLocBtn        = document.getElementById('liveLocBtn');
    const gpsStatus         = document.getElementById('gpsStatus');
    const gpsStatusLabel    = document.getElementById('gpsStatusLabel');
    const gpsDotEl          = gpsStatus ? gpsStatus.querySelector('.gps-dot-indicator') : null;

    // Initialize LiveNavigator if available
    if (window.LiveNavigator && window.UQU_GEO) {
      liveNav = new window.LiveNavigator(engine, navEngineInstance);

      // Show live tracking controls
      if (compassToggle) compassToggle.style.display = '';
      if (liveLocBtn) liveLocBtn.style.display = '';
    }

    // ── Global live navigation controls ──
    window.fpToggleCompass = function () {
      if (!liveNav) return;
      const isHeadingUp = liveNav.toggleRotationLock();
      if (compassToggle) compassToggle.classList.toggle('active', isHeadingUp);
    };

    window.fpStartLiveTracking = async function () {
      if (!liveNav) return;
      if (liveNav.getState() !== 'IDLE') {
        liveNav.stopTracking();
        if (liveLocBtn) liveLocBtn.classList.remove('active');
        if (gpsStatus) gpsStatus.style.display = 'none';
        return;
      }

      if (liveLocBtn) liveLocBtn.classList.add('active');
      if (gpsStatus) {
        gpsStatus.style.display = 'flex';
        if (gpsDotEl) gpsDotEl.className = 'gps-dot-indicator searching';
        if (gpsStatusLabel) gpsStatusLabel.textContent = 'جارٍ تحديد الموقع...';
      }

      await liveNav.startTracking();
    };

    // ── Show "Use My Location" button when in SELECTING_ORIGIN ──
    const origFpStartNav = window.fpStartNav;
    window.fpStartNav = function () {
      origFpStartNav();
      // Show location button in nav banner if live nav is available
      if (liveNav && navUseLocationBtn) {
        navUseLocationBtn.style.display = '';
      }
    };

    // Handle "Use My Location" button click
    if (navUseLocationBtn) {
      navUseLocationBtn.addEventListener('click', async () => {
        if (!liveNav || !navDestination) return;

        // Start tracking if not already
        if (liveNav.getState() === 'IDLE') {
          if (gpsStatus) {
            gpsStatus.style.display = 'flex';
            if (gpsDotEl) gpsDotEl.className = 'gps-dot-indicator searching';
            if (gpsStatusLabel) gpsStatusLabel.textContent = 'جارٍ تحديد الموقع...';
          }
          await liveNav.startTracking();
        }

        // Wait a moment for GPS fix, then route from nearest entrance
        setTimeout(() => {
          const entrance = liveNav.getSuggestedEntrance();
          if (!entrance || !navEngineInstance) {
            if (gpsStatusLabel) gpsStatusLabel.textContent = 'تعذر تحديد الموقع';
            if (gpsDotEl) gpsDotEl.className = 'gps-dot-indicator error';
            return;
          }

          // Route from entrance waypoint to destination
          const accessible = navAccessible ? navAccessible.checked : false;
          const result = navEngineInstance.findPathFromNode(
            entrance.connectedWaypoint,
            navDestination.id,
            { accessible }
          );

          if (!result) {
            if (gpsStatusLabel) gpsStatusLabel.textContent = 'لا يوجد مسار متاح';
            return;
          }

          // Set origin info for display
          navOrigin = { id: '__entrance__', label: entrance.label, doors: [{ id: 'e', x: entrance.mapPoint.x, y: entrance.mapPoint.y }] };
          navState = 'ROUTING';
          if (navBanner) navBanner.style.display = 'none';

          // Remove override listener
          if (engine._navSelectHandler) {
            container.removeEventListener('room-selected', engine._navSelectHandler);
            engine._navSelectHandler = null;
          }

          // Draw route
          if (!navRendererInstance) {
            navRendererInstance = new window.NavRenderer(engine.svg);
          }
          navRendererInstance.clearRoute();
          navRendererInstance.drawRoute(result, navEngineInstance);
          navRendererInstance.highlightRoom(engine, navDestination.id, '#ef4444');

          // Fit route in view
          _fitRouteInView(result.points);

          // Update nav panel inside bottom sheet
          if (navPanel) navPanel.style.display = 'block';
          if (resultCard) resultCard.style.display = 'none';
          _openBottomSheet();
          if (navFrom) navFrom.textContent = '📍 ' + entrance.label;
          if (navTo) navTo.textContent = navDestination.label;
          if (navDistance) navDistance.textContent = '~' + result.distanceMeters + 'م';
          if (navTime) navTime.textContent = result.estimatedTime;
          if (navStepCount) navStepCount.textContent = result.steps.length + ' خطوات';
          if (navSteps) {
            navSteps.innerHTML = result.steps.map(s =>
              `<li><span class="nav-step-icon">${s.icon}</span> ${s.text}</li>`
            ).join('');
          }

          // Start live navigation with snap-to-route
          liveNav.startNavigation(result);

          // Force indoor mode (skip outdoor handover for now)
          liveNav.forceIndoorMode();

          if (gpsStatusLabel) gpsStatusLabel.textContent = 'تتبع مباشر — ' + entrance.label;
          if (gpsDotEl) gpsDotEl.className = 'gps-dot-indicator';
        }, 1500);
      });
    }

    // ── LiveNavigator event listeners ──
    if (liveNav) {
      container.addEventListener('live-nav:state-change', (e) => {
        const { to } = e.detail;
        if (to === 'INDOOR_TRACKING' && gpsStatusLabel) {
          gpsStatusLabel.textContent = 'تتبع داخلي نشط';
          if (gpsDotEl) gpsDotEl.className = 'gps-dot-indicator';
        }
      });

      container.addEventListener('live-nav:entrance-suggested', (e) => {
        const { entrance } = e.detail;
        if (entrance && gpsStatusLabel) {
          gpsStatusLabel.textContent = 'أقرب مدخل: ' + entrance.label;
        }
      });

      container.addEventListener('live-nav:distance-update', (e) => {
        const { entrance, distance } = e.detail;
        if (gpsStatusLabel && entrance) {
          gpsStatusLabel.textContent = entrance.label + ' — ' + distance + 'م';
        }
      });

      container.addEventListener('live-nav:error', (e) => {
        if (gpsStatusLabel) gpsStatusLabel.textContent = e.detail.message;
        if (gpsDotEl) gpsDotEl.className = 'gps-dot-indicator error';
      });

      container.addEventListener('live-nav:reroute-needed', () => {
        // Auto-reroute from current position
        if (navState === 'ROUTING' && navDestination && liveNav._suggestedEntrance) {
          const accessible = navAccessible ? navAccessible.checked : false;
          const entrance = liveNav.getSuggestedEntrance();
          if (!entrance) return;
          const result = navEngineInstance.findPathFromNode(
            entrance.connectedWaypoint,
            navDestination.id,
            { accessible }
          );
          if (result) {
            navRendererInstance.clearRoute();
            navRendererInstance.drawRoute(result, navEngineInstance);
            liveNav.startNavigation(result);
          }
        }
      });

      container.addEventListener('live-nav:arrived', () => {
        if (gpsStatusLabel) gpsStatusLabel.textContent = 'وصلت إلى وجهتك! 🎉';
        liveNav.stopNavigation();
      });

      container.addEventListener('live-nav:compass-denied', () => {
        if (gpsStatusLabel) gpsStatusLabel.textContent = 'تم رفض إذن البوصلة';
      });
    }

    // Extend _clearNavigation to also stop live nav
    const origClearNav = _clearNavigation;
    function _clearNavigationExtended() {
      origClearNav();
      if (liveNav && liveNav.getState() !== 'IDLE') {
        liveNav.stopNavigation();
      }
      if (navUseLocationBtn) navUseLocationBtn.style.display = 'none';
      if (gpsStatus) gpsStatus.style.display = 'none';
    }
    if (navCancelBtn) {
      navCancelBtn.removeEventListener('click', _clearNavigation);
      navCancelBtn.addEventListener('click', _clearNavigationExtended);
    }
    if (navClearBtn) {
      navClearBtn.removeEventListener('click', _clearNavigation);
      navClearBtn.addEventListener('click', _clearNavigationExtended);
    }

    // ── Theme change → redraw ──
    const obs = new MutationObserver(() => engine.redraw());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

// =================================================================
// 8. PROFILE PAGE — WIZARD (from profile.html) + أسئلة إضافية
// =================================================================

function initProfileWizard() {
  if (!document.getElementById('step1')) return;

  let profileData = {
    basic: {},
    learning: {},
    goals: {},
    courses: []
  };

  const _storedProfile = window.UQUCore ? window.UQUCore.getProfile() : null;
  if (_storedProfile) {
    profileData = { ...profileData, ..._storedProfile };
  }

  // -----------------------------
  // التنقل بين الخطوات
  // -----------------------------
  window.nextStep = function (stepNum) {
    if (stepNum === 2) {
      const name = document.getElementById('pName').value.trim();
      if (!name) return alert('الرجاء كتابة الاسم أولاً');
    }

    document
      .querySelectorAll('.wizard-step')
      .forEach((el) => el.classList.remove('active'));
    const cur = document.getElementById('step' + stepNum);
    if (cur) cur.classList.add('active');

    for (let i = 1; i <= 4; i++) {
      const dot = document.getElementById('dot' + i);
      if (!dot) continue;
      if (i < stepNum) {
        dot.className = 'step-dot done';
        dot.innerHTML = '✓';
      } else if (i === stepNum) {
        dot.className = 'step-dot active';
        dot.innerHTML = i;
      } else {
        dot.className = 'step-dot';
        dot.innerHTML = i;
      }
    }

    // ── Step 4: populate review summary ──────────────────────────
    if (stepNum === 4) {
      // GPA
      const gpaEl = document.getElementById('pGpaNow');
      const gpaVal = gpaEl && gpaEl.value ? parseFloat(gpaEl.value) : null;
      const summaryGpa = document.getElementById('summaryGpa');
      if (summaryGpa) summaryGpa.textContent = gpaVal != null ? gpaVal.toFixed(2) : '—';

      // Courses count
      const summaryCourses = document.getElementById('summaryCourses');
      if (summaryCourses) summaryCourses.textContent = (profileData.courses || []).length;

      // Weeks
      const weeksEl = document.getElementById('pWeeks');
      const weeksVal = weeksEl && weeksEl.value ? weeksEl.value : '—';
      const summaryWeeks = document.getElementById('summaryWeeks');
      if (summaryWeeks) summaryWeeks.textContent = weeksVal;
    }
  };

  window.prevStep = function (stepNum) {
    window.nextStep(stepNum);
  };

  // -----------------------------
  // اختيار من الكروت (select-card)
  // -----------------------------
  window.selectOption = function (category, value, el) {
    el.parentNode
      .querySelectorAll('.select-card')
      .forEach((c) => c.classList.remove('selected'));
    el.classList.add('selected');

    const hiddenId =
      'p' + category.charAt(0).toUpperCase() + category.slice(1);
    const hidden = document.getElementById(hiddenId);
    if (hidden) hidden.value = value;
  };

  // -----------------------------
  // المواد
  // -----------------------------
  window.addCourseToList = function () {
    const name = document.getElementById('newCourseName').value.trim();
    const code = document.getElementById('newCourseCode').value.trim();
    const credits =
      parseInt(document.getElementById('newCourseCredits').value) || null;
    const type = document.getElementById('newCourseType').value;
    const date = document.getElementById('newCourseDate').value;
    const diff = document.getElementById('newCourseDiff').value;
    const current =
      parseInt(document.getElementById('newCourseCurrent').value) || 0;
    const target =
      parseInt(document.getElementById('newCourseTarget').value) || 100;

    if (!name) return alert('أدخل اسم المادة');

    profileData.courses.push({
      id: Date.now().toString(),
      name,
      code,
      creditHours: credits,
      difficulty: diff,
      type,
      examDate: date,
      currentProgress: current,
      targetProgress: target
    });

    renderCourses();

    document.getElementById('newCourseName').value = '';
    document.getElementById('newCourseCode').value = '';
    document.getElementById('newCourseCredits').value = '';
    document.getElementById('newCourseDate').value = '';
    document.getElementById('newCourseCurrent').value = '0';
    document.getElementById('newCourseTarget').value = '100';
  };

  window.removeCourse = function (idx) {
    profileData.courses.splice(idx, 1);
    renderCourses();
  };

  function renderCourses() {
    const container = document.getElementById('coursesListDisplay');
    if (!container) return;
    if (profileData.courses.length === 0) {
      container.innerHTML =
        '<p class="muted" style="text-align:center;">لم تضف مواد بعد.</p>';
      return;
    }
    container.innerHTML = '';
    profileData.courses.forEach((c, idx) => {
      const div = document.createElement('div');
      div.className = 'course-item';
      const diffLabel =
        c.difficulty === 'hard'
          ? 'صعبة'
          : c.difficulty === 'medium'
          ? 'متوسطة'
          : 'سهلة';
      const typeLabel =
        c.type === 'lab' ? 'عملي' : c.type === 'project' ? 'مشروع' : 'نظري';

      div.innerHTML = `
        <div>
          <strong>${c.name}</strong>
          <span style="font-size:0.8rem; color:var(--muted); margin-right:8px;">
            ${c.code || ''}
          </span>
          <div style="font-size:0.78rem; color:var(--muted); margin-top:4px;">
            درجة الصعوبة: ${diffLabel} • النوع: ${typeLabel} • 
            ${c.creditHours ? c.creditHours + ' ساعات معتمدة • ' : ''}
            التقدم: ${c.currentProgress || 0}% → ${c.targetProgress || 100}%
          </div>
          <div style="font-size:0.78rem; color:var(--muted);">
            الاختبار النهائي: ${c.examDate || 'لم يحدد'}
          </div>
        </div>
        <button onclick="removeCourse(${idx})"
          style="color:var(--danger); background:none; border:none; cursor:pointer;">✕</button>
      `;
      container.appendChild(div);
    });
  }

  // -----------------------------
  // حفظ البروفايل وإنشاء البلان
  // -----------------------------
  window.saveProfileAndFinish = function () {
    const todayIso = new Date().toISOString().split('T')[0];

    // ====== 0) قراءة حقول المعدّل والساعات (بما فيها ساعات خطة الترم) ======
    const gpaNowInput = document.getElementById('pGpaNow');
    const gpaTargetInput = document.getElementById('pGpaTarget');
    const earnedInput = document.getElementById('pEarnedHours');
    const planInput = document.getElementById('pPlanHours');
    const termPlanInput = document.getElementById('pTermPlanHours');

    const currentGpa =
      gpaNowInput && gpaNowInput.value
        ? parseFloat(gpaNowInput.value)
        : null;

    const targetGpa =
      gpaTargetInput && gpaTargetInput.value
        ? parseFloat(gpaTargetInput.value)
        : null;

    const earnedHours =
      earnedInput && earnedInput.value
        ? parseInt(earnedInput.value)
        : 0;

    const planHours =
      planInput && planInput.value
        ? parseInt(planInput.value)
        : 130; // افتراضي

    const termPlanHours =
      termPlanInput && termPlanInput.value
        ? parseInt(termPlanInput.value)
        : null; // نخليه null إذا ما عبّاه

    // 1) basic
    const weeksVal = parseInt(document.getElementById('pWeeks')?.value) || 16;

    profileData.basic = {
      name: (document.getElementById('pName')?.value || '').trim(),
      university: (function() {
        var uniSel = document.getElementById('pUniversity');
        var uniVal = uniSel?.value || '';
        if (uniVal === 'أخرى') {
          var custom = document.getElementById('pUniversityCustom');
          return (custom?.value || '').trim() || 'أخرى';
        }
        return uniVal.trim();
      })(),
      major: (function() {
        var majSel = document.getElementById('pMajor');
        var majVal = majSel?.value || '';
        if (majVal === 'أخرى') {
          var custom = document.getElementById('pMajorCustom');
          return (custom?.value || '').trim() || 'أخرى';
        }
        return majVal.trim();
      })(),
      level: document.getElementById('pLevel')?.value || '',
      studyType: document.getElementById('pStudyType')?.value || 'full',
      workStatus: document.getElementById('pWorkStatus')?.value || 'no',
      semStart:
        document.getElementById('semStartDate')?.value || todayIso,
      weeks: weeksVal,
      currentGpa: currentGpa // احتياطي لو احتجناه في الداشبورد مثلاً
    };

    // 2) learning
    profileData.learning = {
      speed: document.getElementById('pSpeed')?.value || 'normal',
      focusMinutes:
        parseInt(document.getElementById('pFocus')?.value) || 45,
      preferredTime: document.getElementById('pTime')?.value || 'evening',
      preferredEnv: document.getElementById('pEnv')?.value || 'home',
      style: document.getElementById('pStyle')?.value || 'read',
      memorization: document.getElementById('pMemorization')?.value || 'normal',
      group: document.getElementById('pGroup')?.value || 'solo',
      maxDailySessions:
        parseInt(
          document.getElementById('pMaxDailySessions')?.value
        ) || null,
      maxWeeklyHours:
        parseInt(
          document.getElementById('pMaxWeeklyHours')?.value
        ) || null,
      stressLevel:
        parseInt(document.getElementById('pStress')?.value) || 3,
      blockedTimes: (document.getElementById('pBlockedTimes')?.value || '').trim()
    };

    // 3) goals — بيانات المعدّل والساعات
    const priorityEl = document.getElementById('pGoal');

    profileData.goals = {
      currentGpa: currentGpa,        // المعدل التراكمي الحالي
      targetGpa: targetGpa,          // المعدل المستهدف
      earnedHours: earnedHours,      // الساعات المنجزة حتى الآن (كل الفصول)
      planHours: planHours,          // إجمالي ساعات الخطة
      termPlanHours: termPlanHours,  // ساعات خطة هذا الفصل الحالي
      priority: priorityEl ? priorityEl.value : 'raise',
      focusCourseIds: []
    };

    profileData.courses = profileData.courses || [];

    // حفظ في localStorage
    const _s = window.UQUCore?.S ?? { set(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch{} } };
    _s.set('uqu_profile_v2', profileData);

    // إنشاء بلان مبدئي مبني على هذا البروفايل
    initSmartPlan(profileData);

    // Show success feedback then redirect
    const showMsg = (msg) => {
      if (window.__ui?.showToast) {
        window.__ui.showToast(msg, 'success');
      } else if (window.UQUNotifications?.add) {
        window.UQUNotifications.add({ type:'success', title:'تم الحفظ ✅', body: msg });
      } else {
        alert(msg);
      }
    };
    showMsg('تم حفظ البروفايل وتحديث إعدادات الخطة ✅');

    // Update profile.html display if we're on that page
    if (typeof initProfilePage === 'function') {
      setTimeout(() => initProfilePage(), 200);
    }

    setTimeout(() => { window.location.href = 'plan.html'; }, 1200);
  };

  // -----------------------------
  // تهيئة البلان الذكي من البروفايل
  // -----------------------------
  function initSmartPlan(profile) {
    const basic = profile.basic || {};
    const learning = profile.learning || {};
    const weeks = basic.weeks || 16;

    const smartPlan = {
      planTitle:
        basic.name && basic.major
          ? `خطة ${basic.name} - ${basic.major}`
          : 'خطة دراسة الفصل',
      sessionMin: learning.focusMinutes || 60,
      weeks: weeks,
      planStart: basic.semStart,
      courses: (profile.courses || []).map((c) => ({
        id: c.id,
        name: c.name,
        color: '#6366f1',
        examDate: c.examDate,
        difficulty: c.difficulty,
        currentProgress: c.currentProgress || 0,
        progressPerSession: calculateProgressPerSession(
          c.difficulty,
          learning.speed || 'normal'
        )
      })),
      slots: [],
      plan: []
    };

    const _sp = window.UQUCore?.S ?? { set(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch{} } };
    _sp.set('uqu_plan_v5', smartPlan);
  }

  function calculateProgressPerSession(difficulty, speed) {
    let base = 5;
    if (difficulty === 'easy') base = 8;
    if (difficulty === 'hard') base = 3;

    if (speed === 'fast') base *= 1.2;
    if (speed === 'slow') base *= 0.8;

    return Math.round(base * 10) / 10;
  }

  // -----------------------------
  // إعادة عرض المواد إن وجدت في التخزين
  // -----------------------------
  if (profileData.courses && profileData.courses.length) {
    renderCourses();
  }

  // تعبئة بعض الحقول من التخزين لو موجودة
  try {
    if (profileData.basic) {
      const b = profileData.basic;
      if (b.name && document.getElementById('pName'))
        document.getElementById('pName').value = b.name;
      if (b.university && document.getElementById('pUniversity'))
        document.getElementById('pUniversity').value = b.university;
      if (b.major && document.getElementById('pMajor'))
        document.getElementById('pMajor').value = b.major;
      if (b.level && document.getElementById('pLevel'))
        document.getElementById('pLevel').value = b.level;
      if (b.studyType && document.getElementById('pStudyType'))
        document.getElementById('pStudyType').value = b.studyType;
      if (b.workStatus && document.getElementById('pWorkStatus'))
        document.getElementById('pWorkStatus').value = b.workStatus;
      if (b.semStart && document.getElementById('semStartDate'))
        document.getElementById('semStartDate').value = b.semStart;
      if (b.weeks && document.getElementById('pWeeks'))
        document.getElementById('pWeeks').value = b.weeks;
    }

    if (profileData.goals) {
      const g = profileData.goals;
      if (g.currentGpa != null && document.getElementById('pGpaNow'))
        document.getElementById('pGpaNow').value = g.currentGpa;
      if (g.targetGpa != null && document.getElementById('pGpaTarget'))
        document.getElementById('pGpaTarget').value = g.targetGpa;
      if (g.earnedHours != null && document.getElementById('pEarnedHours'))
        document.getElementById('pEarnedHours').value = g.earnedHours;
      if (g.planHours != null && document.getElementById('pPlanHours'))
        document.getElementById('pPlanHours').value = g.planHours;
      if (
        g.termPlanHours != null &&
        document.getElementById('pTermPlanHours')
      )
        document.getElementById('pTermPlanHours').value = g.termPlanHours;
      if (g.priority && document.getElementById('pGoal'))
        document.getElementById('pGoal').value = g.priority;
    }

    if (profileData.learning) {
      const l = profileData.learning;
      if (l.focusMinutes && document.getElementById('pFocus')) {
        document.getElementById('pFocus').value = l.focusMinutes;
        const fv = document.getElementById('focusVal');
        if (fv) fv.textContent = l.focusMinutes + ' دقيقة';
      }
      if (
        l.maxDailySessions &&
        document.getElementById('pMaxDailySessions')
      )
        document.getElementById('pMaxDailySessions').value =
          l.maxDailySessions;
      if (
        l.maxWeeklyHours &&
        document.getElementById('pMaxWeeklyHours')
      )
        document.getElementById('pMaxWeeklyHours').value =
          l.maxWeeklyHours;
      if (l.stressLevel && document.getElementById('pStress')) {
        document.getElementById('pStress').value = l.stressLevel;
        const sv = document.getElementById('stressVal');
        if (sv) sv.textContent = l.stressLevel + ' / 5';
      }
      if (l.blockedTimes && document.getElementById('pBlockedTimes'))
        document.getElementById('pBlockedTimes').value = l.blockedTimes;
    }
  } catch (e) {
  }
}

  // =================================================================
  // 9. MAIN BOOTSTRAPPER (APP STARTUP)
  // =================================================================

  class App {
    static start() {

      // ── Connect local brain to ai.js fallback bridge ──
      // When Claude API is unavailable, ai.js calls this
      window.__localBrainFallback = (text) => {
        const ctrl = window.__chatController;
        if (ctrl && typeof ctrl.analyzeAndReply === 'function') {
          return ctrl.analyzeAndReply(text);
        }
        return 'المساعد الذكي غير متاح حالياً، حاول لاحقاً.';
      };

      // ── UI manager (theme, nav, scroll, toasts) ──
      new UIManager();

      // ── Reactive store listeners ──
      if (window.UQUModel) {
        // Re-render dashboard on profile change
        window.UQUModel.onChange('profile', () => {
          if (document.body.dataset.page === 'dashboard') {
            requestAnimationFrame(() => {
              try { new DashboardController(); } catch {}
            });
          }
        });
      }

      // ── Upgrade smart chips in chat if UQUAIChat loaded ──
      const upgradeChips = () => {
        if (!window.generateSmartChips) return;
        const chips = document.querySelectorAll('#quickChips .suggestion-pill, .suggestion-pill');
        if (!chips.length) return;
        const smartChips = window.generateSmartChips();
        chips.forEach((chip, i) => {
          const c = smartChips[i];
          if (c) chip.innerHTML = `${c.icon} ${c.text}`;
        });
      };

      // ── Page router ──
      const page = document.body?.dataset?.page;
      switch (page) {
        case 'dashboard':
          new DashboardController();
          break;
        case 'chat': {
          const chatCtrl = new ChatController();
          window.__chatController = chatCtrl;
          upgradeChips();
          break;
        }
        case 'gpa':
          new GPAController();
          break;
        case 'plan':
          initPlanPage();
          break;
        case 'locations':
          initLocationsPage();
          break;
        case 'profile':
          try { new ProfileController(); } catch {}
          initProfileWizard();
          break;
      }

      // ── Render exam countdowns in any page sidebar ──
      if (window.UQUEffects?.renderExamBadges) {
        window.UQUEffects.renderExamBadges('exam-countdowns');
      }

      // ── PWA install prompt (deferred) ──
      window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        window.__pwaInstallPrompt = e;
        const installBtn = document.getElementById('installBtn');
        if (installBtn) {
          installBtn.style.display = 'flex';
          installBtn.addEventListener('click', () => {
            e.prompt();
            e.userChoice.then(r => {
              if (r.outcome === 'accepted') installBtn.remove();
            });
          });
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', App.start);
})();
