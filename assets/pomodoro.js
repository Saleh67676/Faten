/**
 * ════════════════════════════════════════════════════════════════
 * UQU ACADEMIC ASSISTANT — ULTIMATE POMODORO ENGINE (v3.0 Cloud)
 * ════════════════════════════════════════════════════════════════
 * دمج كامل: محرك التركيز المنبثق + لوحة الإحصائيات + التوثيق السحابي
 */

(function (window) {
  'use strict';

  // ──────────────────────────────────────────────
  // 1. CLOUD SYNCHRONIZATION (Firebase)
  // ──────────────────────────────────────────────
  const CloudDB = {
    sessionsCache: [],

    // جلب الجلسات المكتملة من السحابة لعرضها في الإحصائيات
    async fetchSessions() {
      if (!window.FirebaseDB || !window.auth?.currentUser) return [];
      try {
        const uid = window.auth.currentUser.uid;
        // افتراض وجود دالة جلب في FirebaseDB، أو جلبها مباشرة
        const snapshot = await window.db.collection('users').doc(uid).collection('completed_sessions').get();
        const sessions = [];
        snapshot.forEach(doc => {
          sessions.push({ id: doc.id, ...doc.data() });
        });
        this.sessionsCache = sessions.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
        return this.sessionsCache;
      } catch (error) {
        console.error("❌ خطأ في جلب بيانات البومودورو السحابية:", error);
        return [];
      }
    },

    // حفظ الجلسة في السحابة
    async saveSession(courseCode, courseName, durationMins) {
      if (!window.FirebaseDB || !window.FirebaseDB.logCompletedSession) {
        console.warn("⚠️ تم الحفظ محلياً مؤقتاً لعدم توفر الاتصال بالسحابة");
        return;
      }
      try {
        await window.FirebaseDB.logCompletedSession({
          courseCode: courseCode || 'عام',
          courseName: courseName || 'مذاكرة عامة',
          duration: durationMins,
          type: 'focus',
          date: new Date().toISOString().split('T')[0],
          completedAt: new Date().toISOString()
        });
        console.log(`✅ Session Logged to Firebase: ${courseName} (${durationMins}m)`);
      } catch (error) {
        console.error("❌ فشل التوثيق السحابي للجلسة:", error);
      }
    }
  };

  // ──────────────────────────────────────────────
  // 2. FOCUS TIMER ENGINE (The Core Logic & Modal)
  // ──────────────────────────────────────────────
  const TimerEngine = {
    state: 'idle', // idle | running | paused
    intervalId: null,
    totalSeconds: 0,
    remainingSeconds: 0,
    currentCourse: { name: '', code: '' },

    // عناصر واجهة النافذة المنبثقة (Modal)
    els: {},

    mode: 'focus', // focus | short | long
    settings: { focus: 25, short: 5, long: 15, sound: true, autoBreak: true, notify: true },

    init() {
      // Modal-style elements (when triggered from another page)
      this.els = {
        modal: document.getElementById('focusModal'),
        display: document.getElementById('focusTimerDisplay'),
        label: document.getElementById('focusCourseName'),
        circle: document.getElementById('focusProgressCircle'),
        startBtn: document.getElementById('focusStartBtn'),
        closeBtn: document.getElementById('focusCloseBtn'),

        // Standalone page elements (pomodoro.html)
        pageDisplay:  document.getElementById('timerDisplay'),
        pageLabel:    document.getElementById('timerLabel'),
        pageCircle:   document.getElementById('timerProgress'),
        pageStart:    document.getElementById('pomoStart'),
        pagePause:    document.getElementById('pomoPause'),
        pageReset:    document.getElementById('pomoReset'),
        pageSkip:     document.getElementById('pomoSkip'),
        pageCourse:   document.getElementById('pomoCourse'),
        modeButtons:  document.querySelectorAll('.pomo-mode-btn'),
        setFocus:     document.getElementById('setFocus'),
        setShort:     document.getElementById('setShort'),
        setLong:      document.getElementById('setLong'),
        setSound:     document.getElementById('setSound'),
        setAutoBreak: document.getElementById('setAutoBreak'),
        setNotify:    document.getElementById('setNotify')
      };
      this.loadSettings();
      this.populateCourseSelector();
      this.applyModeToTimer();
      this.bindEvents();
      this.updateUI();

      // Request notification permission once on the standalone page
      if (this.els.pageDisplay && this.settings.notify
          && 'Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch(_) {}
      }
    },

    loadSettings() {
      try {
        const raw = localStorage.getItem('uqu_pomo_settings');
        if (raw) Object.assign(this.settings, JSON.parse(raw));
      } catch(_) {}
      // Reflect into form inputs
      if (this.els.setFocus) this.els.setFocus.value = this.settings.focus;
      if (this.els.setShort) this.els.setShort.value = this.settings.short;
      if (this.els.setLong)  this.els.setLong.value  = this.settings.long;
      if (this.els.setSound)     this.els.setSound.checked     = !!this.settings.sound;
      if (this.els.setAutoBreak) this.els.setAutoBreak.checked = !!this.settings.autoBreak;
      if (this.els.setNotify)    this.els.setNotify.checked    = !!this.settings.notify;
    },

    saveSettings() {
      try { localStorage.setItem('uqu_pomo_settings', JSON.stringify(this.settings)); } catch(_) {}
    },

    populateCourseSelector() {
      const sel = this.els.pageCourse;
      if (!sel) return;
      try {
        const profile = JSON.parse(localStorage.getItem('uqu_profile_v2') || '{}');
        const courses = (profile && profile.courses) || [];
        // Keep first option ("general")
        const first = sel.firstElementChild ? sel.firstElementChild.outerHTML : '';
        sel.innerHTML = first;
        courses.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.code || c.id || c.name;
          opt.textContent = c.name + (c.code ? ' (' + c.code + ')' : '');
          sel.appendChild(opt);
        });
      } catch(_) {}
    },

    applyModeToTimer() {
      const mins = this.settings[this.mode] || 25;
      this.totalSeconds = mins * 60;
      this.remainingSeconds = mins * 60;
      // Update label
      const labelText = this.mode === 'focus'
        ? 'جلسة تركيز'
        : this.mode === 'short' ? 'استراحة قصيرة' : 'استراحة طويلة';
      if (this.els.pageLabel) this.els.pageLabel.textContent = labelText;
      if (this.els.label && !this.currentCourse.name) this.els.label.textContent = labelText;
    },

    setMode(mode) {
      if (mode === this.mode) return;
      this.mode = mode;
      this.stop();
      this.applyModeToTimer();
      // Visually mark active mode button
      if (this.els.modeButtons) {
        this.els.modeButtons.forEach(b => {
          b.classList.toggle('active', b.dataset.mode === mode);
        });
      }
      this.updateUI();
    },

    bindEvents() {
      // Modal controls
      if (this.els.startBtn) this.els.startBtn.addEventListener('click', () => this.toggle());
      if (this.els.closeBtn) this.els.closeBtn.addEventListener('click', () => this.stopAndClose());

      // Standalone page controls
      if (this.els.pageStart) this.els.pageStart.addEventListener('click', () => {
        // Use the selected course (or generic) when starting
        const sel = this.els.pageCourse;
        const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
        if (opt && sel.value) {
          this.currentCourse = { code: sel.value, name: opt.textContent.replace(/\s*\(.*\)$/, '') };
        } else {
          this.currentCourse = { code: 'عام', name: 'مذاكرة عامة' };
        }
        this.start();
      });
      if (this.els.pagePause) this.els.pagePause.addEventListener('click', () => this.pause());
      if (this.els.pageReset) this.els.pageReset.addEventListener('click', () => {
        this.stop();
        this.applyModeToTimer();
        this.updateUI();
      });
      if (this.els.pageSkip) this.els.pageSkip.addEventListener('click', () => this.complete(true));

      if (this.els.modeButtons) {
        this.els.modeButtons.forEach(b => {
          b.addEventListener('click', () => this.setMode(b.dataset.mode));
        });
      }

      // Settings inputs (live update)
      const onSet = () => {
        if (this.els.setFocus) this.settings.focus = Math.max(1, parseInt(this.els.setFocus.value) || 25);
        if (this.els.setShort) this.settings.short = Math.max(1, parseInt(this.els.setShort.value) || 5);
        if (this.els.setLong)  this.settings.long  = Math.max(1, parseInt(this.els.setLong.value)  || 15);
        if (this.els.setSound)     this.settings.sound     = !!this.els.setSound.checked;
        if (this.els.setAutoBreak) this.settings.autoBreak = !!this.els.setAutoBreak.checked;
        if (this.els.setNotify)    this.settings.notify    = !!this.els.setNotify.checked;
        this.saveSettings();
        // If timer is idle, refresh the displayed duration
        if (this.state === 'idle') {
          this.applyModeToTimer();
          this.updateUI();
        }
      };
      ['setFocus','setShort','setLong','setSound','setAutoBreak','setNotify'].forEach(k => {
        if (this.els[k]) this.els[k].addEventListener('change', onSet);
      });
    },

    stop() {
      clearInterval(this.intervalId);
      this.state = 'idle';
      this.updateUI();
    },

    // استدعاء عالمي لبدء المذاكرة (من صفحة الخطة)
    startSession(courseName, courseCode) {
      this.currentCourse = { name: courseName, code: courseCode };

      // Use settings.focus first; fallback to profile's focus_length
      let focusMins = this.settings.focus || 25;
      try {
        const profile = JSON.parse(localStorage.getItem('uqu_profile_v2') || '{}');
        if (profile?.preferences?.focusDuration) {
          focusMins = parseInt(profile.preferences.focusDuration) || focusMins;
        } else if (profile?.study_preferences?.focus_length) {
          focusMins = parseInt(profile.study_preferences.focus_length) || focusMins;
        }
      } catch (e) { }

      this.totalSeconds = focusMins * 60;
      this.remainingSeconds = this.totalSeconds;

      if (this.els.label) this.els.label.textContent = `جلسة تركيز: ${courseName}`;
      if (this.els.pageLabel) this.els.pageLabel.textContent = `تركيز: ${courseName}`;

      this.openModal();
      this.start();
    },

    start() {
      if (this.state === 'running') return;
      // If timer is at 0 (just reset/completed), reload from current mode
      if (this.remainingSeconds <= 0) this.applyModeToTimer();
      this.state = 'running';
      // Use a self-correcting timer to avoid drift on background tabs
      const startTs = Date.now();
      const startRem = this.remainingSeconds;
      this.intervalId = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTs) / 1000);
        this.remainingSeconds = Math.max(0, startRem - elapsed);
        if (this.remainingSeconds <= 0) {
          this.complete();
        } else {
          this.updateUI();
        }
      }, 250); // 250ms interval is smoother and self-corrects
      this.updateUI();
    },

    pause() {
      clearInterval(this.intervalId);
      this.state = 'paused';
      this.updateUI();
    },

    toggle() {
      if (this.state === 'running') this.pause();
      else this.start();
    },

    tick() {
      if (this.remainingSeconds > 0) {
        this.remainingSeconds--;
        this.updateUI();
      } else {
        this.complete();
      }
    },

    async complete(skipped) {
      clearInterval(this.intervalId);
      this.state = 'idle';
      this.remainingSeconds = 0;
      this.updateUI();

      // التنبيه الصوتي (only on real completion, respect setting)
      if (!skipped && this.settings.sound !== false) this.playSound();

      const wasFocus = this.mode === 'focus';
      const durationMins = Math.max(1, Math.round((this.totalSeconds - this.remainingSeconds) / 60));

      // Persist completed FOCUS sessions to local + cloud
      if (wasFocus && !skipped) {
        // Cloud
        try {
          await CloudDB.saveSession(
            this.currentCourse.code || 'عام',
            this.currentCourse.name || 'مذاكرة عامة',
            durationMins
          );
        } catch(_) {}
        // Local fallback (always log so stats work offline)
        try {
          const today = new Date().toISOString().split('T')[0];
          const local = JSON.parse(localStorage.getItem('uqu_pomo_local') || '[]');
          local.push({
            date: today,
            duration: durationMins,
            type: 'focus',
            courseCode: this.currentCourse.code || 'عام',
            courseName: this.currentCourse.name || 'مذاكرة عامة',
            completedAt: new Date().toISOString()
          });
          localStorage.setItem('uqu_pomo_local', JSON.stringify(local));
        } catch(_) {}
      }

      // Browser notification
      if (this.settings.notify !== false && 'Notification' in window
          && Notification.permission === 'granted') {
        try {
          new Notification('بومودورو', {
            body: wasFocus
              ? `أحسنت! انتهت جلسة ${this.currentCourse.name || 'التركيز'} (${durationMins} دقيقة)`
              : 'انتهت الاستراحة. حان وقت العودة للتركيز!',
            icon: 'icon-192.png',
            tag: 'uqu-pomo'
          });
        } catch(_) {}
      }

      // Toast / alert
      const msg = wasFocus
        ? `عاش البطل! تمت جلسة ${this.currentCourse.name || 'التركيز'} بنجاح 🎉`
        : 'انتهت الاستراحة. ابدأ جلسة جديدة 💪';
      if (window.UQUCore && window.UQUCore.toast) {
        window.UQUCore.toast(msg, 'success');
      }

      // Refresh stats
      Dashboard.render();

      // Auto-switch mode (focus → short break, short → focus)
      if (this.settings.autoBreak && !skipped) {
        const nextMode = wasFocus ? 'short' : 'focus';
        setTimeout(() => this.setMode(nextMode), 1500);
      } else {
        // Reset to current mode duration so user can start again
        this.applyModeToTimer();
        this.updateUI();
      }

      // For modal mode, close after a delay
      if (this.els.modal && this.els.modal.classList.contains('active')) {
        setTimeout(() => this.stopAndClose(), 3000);
      }
    },

    updateUI() {
      const m = Math.floor(this.remainingSeconds / 60);
      const s = this.remainingSeconds % 60;
      const txt = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

      // Modal display
      if (this.els.display) this.els.display.textContent = txt;
      if (this.els.circle) {
        const r = 140;
        const circum = 2 * Math.PI * r;
        const progress = this.totalSeconds ? this.remainingSeconds / this.totalSeconds : 0;
        this.els.circle.style.strokeDashoffset = circum * (1 - progress);
      }
      if (this.els.startBtn) {
        this.els.startBtn.textContent = this.state === 'running' ? 'إيقاف مؤقت' : 'استئناف';
        this.els.startBtn.classList.toggle('running', this.state === 'running');
      }

      // Standalone page display
      if (this.els.pageDisplay) this.els.pageDisplay.textContent = txt;
      if (this.els.pageCircle) {
        const r = 115; // matches r="115" in pomodoro.html SVG
        const circum = 2 * Math.PI * r;
        const progress = this.totalSeconds ? this.remainingSeconds / this.totalSeconds : 0;
        this.els.pageCircle.setAttribute('stroke-dasharray', String(circum));
        this.els.pageCircle.style.strokeDashoffset = String(circum * (1 - progress));
      }
      // Toggle start/pause/skip visibility on the standalone page
      if (this.els.pageStart && this.els.pagePause) {
        if (this.state === 'running') {
          this.els.pageStart.style.display = 'none';
          this.els.pagePause.style.display = '';
          if (this.els.pageSkip) this.els.pageSkip.style.display = '';
        } else {
          this.els.pageStart.style.display = '';
          this.els.pagePause.style.display = 'none';
          if (this.els.pageSkip) this.els.pageSkip.style.display = 'none';
        }
      }
      // Update document title with countdown for visual feedback
      if (this.els.pageDisplay && this.state === 'running') {
        document.title = `${txt} — بومودورو`;
      } else if (this.els.pageDisplay) {
        document.title = 'بومودورو — المساعد الأكاديمي';
      }
    },

    openModal() {
      if (this.els.modal) {
        this.els.modal.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    },

    stopAndClose() {
      clearInterval(this.intervalId);
      this.state = 'idle';
      if (this.els.modal) {
        this.els.modal.classList.remove('active');
        document.body.style.overflow = '';
      }
    },

    playSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523.25, 659.25, 783.99]; // نغمة احتفالية (C5, E5, G5)
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.2);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.2 + 0.5);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.2);
          osc.stop(ctx.currentTime + i * 0.2 + 0.5);
        });
      } catch (e) { console.log("الصوت غير مدعوم في المتصفح"); }
    }
  };

  // ──────────────────────────────────────────────
  // 3. DASHBOARD & STATS (Only runs on Pomodoro Page)
  // ──────────────────────────────────────────────
  const Dashboard = {
    async render() {
      // التحقق مما إذا كنا في صفحة الإحصائيات/البومودورو
      if (!document.getElementById('statSessions')) return;

      // جلب البيانات السحابية + المحلية والدمج بينها
      const cloud = await CloudDB.fetchSessions();
      let local = [];
      try { local = JSON.parse(localStorage.getItem('uqu_pomo_local') || '[]'); } catch(_) {}

      // Merge with de-duplication by completedAt timestamp
      const seen = new Set();
      const sessions = [];
      [...cloud, ...local].forEach(s => {
        const key = s.completedAt || (s.date + '|' + s.duration + '|' + (s.courseCode||''));
        if (!seen.has(key)) { seen.add(key); sessions.push(s); }
      });
      // Sort newest first
      sessions.sort((a, b) => new Date(b.completedAt || b.date) - new Date(a.completedAt || a.date));

      const today = new Date().toISOString().split('T')[0];
      const todaySessions = sessions.filter(s => s.date === today && s.type === 'focus');

      // تحديث الإحصائيات السريعة
      const setEl = (id, val) => { if (document.getElementById(id)) document.getElementById(id).textContent = val; };

      setEl('statSessions', todaySessions.length);
      setEl('statMinutes', todaySessions.reduce((a, s) => a + s.duration, 0));
      setEl('statStreak', this.calcStreak(sessions));
      setEl('statBest', this.calcBestDay(sessions));

      this.renderWeeklyChart(sessions);
      this.renderHistory(sessions);
      this.renderCourseBreakdown(sessions);
    },

    calcStreak(sessions) {
      if (!sessions.length) return 0;
      const dates = [...new Set(sessions.filter(s => s.type === 'focus').map(s => s.date))].sort().reverse();
      if (!dates.length) return 0;

      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 0; i < dates.length; i++) {
        const expected = new Date(today);
        expected.setDate(expected.getDate() - i);
        const expectedStr = expected.toISOString().split('T')[0];
        if (dates.includes(expectedStr)) streak++;
        else break;
      }
      return streak;
    },

    calcBestDay(sessions) {
      const focusSessions = sessions.filter(s => s.type === 'focus');
      if (!focusSessions.length) return 0;

      const byDay = {};
      focusSessions.forEach(s => {
        byDay[s.date] = (byDay[s.date] || 0) + 1;
      });
      return Math.max(...Object.values(byDay));
    },

    renderWeeklyChart(sessions) {
      const container = document.getElementById('weeklyChart');
      if (!container) return;

      const focusSessions = sessions.filter(s => s.type === 'focus');
      const today = new Date();
      const days = [];

      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const count = focusSessions.filter(s => s.date === dateStr).length;
        const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        days.push({ label: dayNames[d.getDay()], count, date: dateStr });
      }

      const max = Math.max(...days.map(d => d.count), 1);

      container.innerHTML = days.map(d => {
        const h = Math.max(4, (d.count / max) * 100);
        const isToday = d.date === today.toISOString().split('T')[0];
        return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">
          <span class="muted" style="font-size:.65rem;">${d.count}</span>
          <div style="width:100%; height:${h}%; min-height:4px; background:${isToday ? 'var(--accent)' : 'var(--accent-dim)'}; border-radius:6px 6px 0 0; transition:height .5s ease;"></div>
          <span class="muted" style="font-size:.6rem; white-space:nowrap;">${d.label.slice(0, 3)}</span>
        </div>`;
      }).join('');
    },

    renderHistory(sessions) {
      const container = document.getElementById('sessionHistory');
      if (!container) return;

      const recent = sessions.filter(s => s.type === 'focus').slice(0, 10); // أحدث 10 جلسات

      if (!recent.length) {
        container.innerHTML = '<p class="muted" style="text-align:center; font-size:.85rem; padding:20px 0;">لا توجد جلسات بعد. ابدأ أول جلسة من الخطة!</p>';
        return;
      }

      container.innerHTML = recent.map(s => {
        const time = new Date(s.completedAt);
        const timeStr = time.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
        return `<div style="display:flex; align-items:center; gap:12px; padding:10px 12px; background:var(--surface-2); border-radius:8px; margin-bottom:8px;">
          <div style="width:36px; height:36px; background:var(--accent-dim); border-radius:10px; display:grid; place-items:center; font-size:.9rem; flex-shrink:0;">&#128214;</div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; font-size:.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.courseName || 'مذاكرة عامة'}</div>
            <div class="muted" style="font-size:.72rem;">${s.duration} دقيقة &middot; ${timeStr}</div>
          </div>
        </div>`;
      }).join('');
    },

    renderCourseBreakdown(sessions) {
      const container = document.getElementById('courseBreakdown');
      if (!container) return;

      const focusSessions = sessions.filter(s => s.type === 'focus');
      if (!focusSessions.length) {
        container.innerHTML = '<p class="muted" style="text-align:center; font-size:.85rem;">ابدأ جلسات لرؤية التوزيع</p>';
        return;
      }

      const byCourse = {};
      focusSessions.forEach(s => {
        const name = s.courseName || 'مذاكرة عامة';
        byCourse[name] = (byCourse[name] || 0) + s.duration;
      });

      const total = Object.values(byCourse).reduce((a, b) => a + b, 0);
      const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6'];
      let i = 0;

      container.innerHTML = Object.entries(byCourse)
        .sort((a, b) => b[1] - a[1])
        .map(([name, mins]) => {
          const pct = Math.round((mins / total) * 100);
          const color = colors[i++ % colors.length];
          return `<div style="margin-bottom: 12px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span style="font-size:.82rem; font-weight:600;">${name}</span>
              <span class="muted" style="font-size:.75rem;">${mins} دقيقة (${pct}%)</span>
            </div>
            <div style="height:6px; background:var(--surface-2); border-radius:99px; overflow:hidden;">
              <div style="height:100%; width:${pct}%; background:${color}; border-radius:99px; transition:width .5s ease;"></div>
            </div>
          </div>`;
        }).join('');
    }
  };

  // ──────────────────────────────────────────────
  // 4. INITIALIZATION
  // ──────────────────────────────────────────────
  function initApp() {
    TimerEngine.init();

    // تأخير الرندرة قليلاً للتأكد من تحميل Firebase و auth
    setTimeout(() => {
      Dashboard.render();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

  // تسجيل النظام كواجهة برمجية عامة (API) لتستخدمها أزرار الخطة
  window.UQUPomodoro = {
    startSession: (courseName, courseCode) => TimerEngine.startSession(courseName, courseCode),
    refreshStats: () => Dashboard.render()
  };

  console.log('%c🚀 UQU Pomodoro v3.0 (Cloud Sync + Engine) Loaded!', 'background:#14b8a6;color:#fff;padding:4px 8px;border-radius:4px;');

})(window);