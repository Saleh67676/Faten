/**
 * UQU Academic Assistant — Data Bridge v1.0
 * ══════════════════════════════════════════
 * Central data hub that ensures all modules share a single source of truth.
 *
 * RESPONSIBILITIES:
 * 1. Sync GPA data ↔ Profile data (one source of truth: profile)
 * 2. Parse chat commands → modify profile/plan/tasks
 * 3. Persist transcript data → profile automatically
 * 4. Broadcast changes across all pages
 * 5. Provide unified read API for any page
 */

(function () {
  'use strict';

  /* ── Storage Keys ── */
  const KEYS = {
    PROFILE: 'uqu_profile_v2',
    PLAN:    'uqu_plan_v5',
    GPA:     'gpa_data',
    GPA_V1:  'uqu_gpa_v1',
    CHAT:    'uqu_chat_history_v1',
    CONVOS:  'uqu_conversations_v1',
    ACHIEVE: 'uqu_achievements_v1',
    POMODORO:'uqu_pomodoro_v1',
    THEME:   'uqu_theme',
    NOTIFS:  'uqu_notifications'
  };

  /* ── Utility: safe read/write ── */
  function sGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }
  function sSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { }
  }

  /* ── Utility: generate unique ID ── */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ── Utility: Arabic normalization ── */
  function normalizeAr(text) {
    if (!text) return '';
    return text.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  }

  /* ══════════════════════════════════════════
     1. UNIFIED PROFILE ACCESS
     Single source of truth for student data
     ══════════════════════════════════════════ */

  function getProfile() {
    const raw = sGet(KEYS.PROFILE);
    if (!raw) return null;
    // Handle both nested and flat formats
    if (raw.basic || raw.goals || raw.learning) {
      const b = raw.basic || {};
      const g = raw.goals || {};
      const l = raw.learning || {};
      return {
        _raw: raw,
        name: b.name || '',
        university: b.university || 'جامعة أم القرى',
        major: b.major || '',
        level: b.level || '',
        currentGpa: parseFloat(g.currentGpa) || 0,
        targetGpa: parseFloat(g.targetGpa) || 0,
        earnedHours: parseInt(g.earnedHours) || 0,
        planHours: parseInt(g.planHours) || 0,
        goal: g.goal || 'raise',
        courses: raw.courses || [],
        learning: l,
        completedCourses: raw.completedCourses || []
      };
    }
    // flat format
    return {
      _raw: raw,
      name: raw.name || '',
      university: raw.university || 'جامعة أم القرى',
      major: raw.major || '',
      level: raw.level || '',
      currentGpa: parseFloat(raw.currentGpa || raw.gpa) || 0,
      targetGpa: parseFloat(raw.targetGpa) || 0,
      earnedHours: parseInt(raw.earnedHours) || 0,
      planHours: parseInt(raw.planHours) || 0,
      goal: raw.goal || 'raise',
      courses: raw.courses || [],
      learning: raw.learning || {},
      completedCourses: raw.completedCourses || []
    };
  }

  function saveProfile(updates) {
    const raw = sGet(KEYS.PROFILE) || {};
    // Merge into nested format
    if (!raw.basic) raw.basic = {};
    if (!raw.goals) raw.goals = {};
    if (!raw.learning) raw.learning = {};

    if (updates.name !== undefined) raw.basic.name = updates.name;
    if (updates.university !== undefined) raw.basic.university = updates.university;
    if (updates.major !== undefined) raw.basic.major = updates.major;
    if (updates.level !== undefined) raw.basic.level = updates.level;
    if (updates.currentGpa !== undefined) raw.goals.currentGpa = updates.currentGpa;
    if (updates.targetGpa !== undefined) raw.goals.targetGpa = updates.targetGpa;
    if (updates.earnedHours !== undefined) raw.goals.earnedHours = updates.earnedHours;
    if (updates.planHours !== undefined) raw.goals.planHours = updates.planHours;
    if (updates.goal !== undefined) raw.goals.goal = updates.goal;
    if (updates.courses !== undefined) raw.courses = updates.courses;
    if (updates.learning !== undefined) Object.assign(raw.learning, updates.learning);
    if (updates.completedCourses !== undefined) raw.completedCourses = updates.completedCourses;

    sSet(KEYS.PROFILE, raw);

    // Sync GPA data store from profile
    syncGpaFromProfile(raw);

    // Broadcast change
    broadcast('profile:updated', raw);

    // 🔥 Firestore-First: push to Firestore immediately
    if (window.FirebaseDB && window.FirebaseDB.isReady()) {
      window.FirebaseDB.pushProfileToFirestore();
    }
    window.dispatchEvent(new CustomEvent('uqu:profileSaved'));

    return raw;
  }

  /* ══════════════════════════════════════════
     2. GPA ↔ PROFILE SYNC
     Profile is the source of truth.
     gpa_data is a derived view.
     ══════════════════════════════════════════ */

  function syncGpaFromProfile(profileRaw) {
    const goals = profileRaw.goals || {};
    const courses = profileRaw.courses || [];
    const gpaData = sGet(KEYS.GPA) || {};

    gpaData.currentGPA = parseFloat(goals.currentGpa) || gpaData.currentGPA || 0;
    gpaData.earnedHours = parseInt(goals.earnedHours) || gpaData.earnedHours || 0;
    gpaData.totalPlanHours = parseInt(goals.planHours) || gpaData.totalPlanHours || 0;

    // Sync courses: profile courses → gpa courses (avoid duplicates)
    const gpaCourses = gpaData.courses || [];
    courses.forEach(function (pc) {
      const existing = gpaCourses.find(function (gc) {
        return gc.name === pc.name || gc.id === pc.id;
      });
      if (!existing) {
        gpaCourses.push({
          id: pc.id || uid(),
          name: pc.name,
          creditHours: parseInt(pc.creditHours) || 3,
          expectedGrade: pc.grade || '',
          points: pc.gradePoints || 0
        });
      } else {
        // Update credit hours if changed
        existing.creditHours = parseInt(pc.creditHours) || existing.creditHours;
        if (pc.gradePoints) existing.points = pc.gradePoints;
        if (pc.grade) existing.expectedGrade = pc.grade;
      }
    });
    gpaData.courses = gpaCourses;
    gpaData.lastUpdated = Date.now();

    sSet(KEYS.GPA, gpaData);
  }

  function syncProfileFromGpa() {
    const gpaData = sGet(KEYS.GPA);
    if (!gpaData) return;

    const raw = sGet(KEYS.PROFILE);
    if (!raw || !raw.goals) return;

    // If GPA was calculated on the GPA page, push it back to profile
    if (gpaData.calculatedGPA) {
      raw.goals.currentGpa = gpaData.calculatedGPA;
    }
    if (gpaData.earnedHours) {
      raw.goals.earnedHours = gpaData.earnedHours;
    }

    // Sync grades from GPA page back to profile courses
    if (gpaData.courses && raw.courses) {
      gpaData.courses.forEach(function (gc) {
        if (gc.expectedGrade || gc.points) {
          var pc = raw.courses.find(function (c) {
            return c.name === gc.name || c.id === gc.id;
          });
          if (pc) {
            if (gc.expectedGrade) pc.grade = gc.expectedGrade;
            if (gc.points) pc.gradePoints = gc.points;
          }
        }
      });
    }

    sSet(KEYS.PROFILE, raw);
  }

  /* ══════════════════════════════════════════
     3. COURSE MANAGEMENT (Unified)
     ══════════════════════════════════════════ */

  function addCourse(courseData) {
    const raw = sGet(KEYS.PROFILE) || {};
    if (!raw.courses) raw.courses = [];

    // Prevent duplicates
    const normName = normalizeAr(courseData.name);
    const exists = raw.courses.find(function (c) {
      return normalizeAr(c.name) === normName;
    });
    if (exists) {
      // Update existing
      Object.assign(exists, courseData);
      exists.updatedAt = new Date().toISOString();
    } else {
      // Add new
      raw.courses.push({
        id: courseData.id || uid(),
        name: courseData.name,
        creditHours: parseInt(courseData.creditHours) || 3,
        difficulty: courseData.difficulty || 'normal',
        examDate: courseData.examDate || '',
        currentProgress: courseData.currentProgress || 0,
        color: courseData.color || '#6366f1',
        grade: courseData.grade || '',
        gradePoints: courseData.gradePoints || 0,
        addedAt: new Date().toISOString(),
        source: courseData.source || 'manual' // 'manual', 'chat', 'transcript'
      });
    }

    sSet(KEYS.PROFILE, raw);
    syncGpaFromProfile(raw);
    broadcast('course:added', courseData);

    // 🔥 Firestore-First: push to Firestore immediately
    if (window.FirebaseDB && window.FirebaseDB.isReady()) {
      window.FirebaseDB.pushProfileToFirestore();
    }
    return true;
  }

  function removeCourse(nameOrId) {
    const raw = sGet(KEYS.PROFILE) || {};
    if (!raw.courses) return false;
    const norm = normalizeAr(nameOrId);
    const before = raw.courses.length;
    raw.courses = raw.courses.filter(function (c) {
      return c.id !== nameOrId && normalizeAr(c.name) !== norm;
    });
    if (raw.courses.length === before) return false;
    sSet(KEYS.PROFILE, raw);
    syncGpaFromProfile(raw);
    broadcast('course:removed', nameOrId);
    return true;
  }

  /* ══════════════════════════════════════════
     4. TASK & EXAM MANAGEMENT (Unified)
     ══════════════════════════════════════════ */

  function addTask(taskData) {
    const raw = sGet(KEYS.PLAN) || {};
    if (!raw.tasks) raw.tasks = [];

    const task = {
      id: taskData.id || uid(),
      title: taskData.title,
      type: taskData.type || 'exam', // exam, quiz, assignment, project, other
      day: taskData.day || '',
      time: taskData.time || '10:00',
      duration: parseInt(taskData.duration) || 60,
      courseName: taskData.courseName || '',
      courseId: taskData.courseId || '',
      deadline: taskData.deadline || '',
      deadlineTime: taskData.deadlineTime || '',
      week: parseInt(taskData.week) || 1,
      kind: 'manual',
      completed: false,
      addedAt: new Date().toISOString(),
      source: taskData.source || 'manual' // 'manual', 'chat'
    };

    raw.tasks.push(task);
    sSet(KEYS.PLAN, raw);
    broadcast('task:added', task);
    return task;
  }

  function addExamDate(courseName, examDate) {
    // Update course exam date in profile
    const raw = sGet(KEYS.PROFILE) || {};
    if (!raw.courses) return false;
    const norm = normalizeAr(courseName);
    const course = raw.courses.find(function (c) {
      return normalizeAr(c.name) === norm;
    });
    if (course) {
      course.examDate = examDate;
      sSet(KEYS.PROFILE, raw);
      broadcast('exam:updated', { courseName: courseName, examDate: examDate });
      return true;
    }
    return false;
  }

  /* ══════════════════════════════════════════
     5. CHAT COMMAND PARSER
     Detects actionable commands in chat text
     and executes them automatically.
     ══════════════════════════════════════════ */

  // Arabic day names mapping
  var dayMap = {
    'الاحد': 'الأحد', 'الأحد': 'الأحد',
    'الاثنين': 'الإثنين', 'الإثنين': 'الإثنين', 'الاتنين': 'الإثنين',
    'الثلاثاء': 'الثلاثاء', 'الثلاثا': 'الثلاثاء',
    'الاربعاء': 'الأربعاء', 'الأربعاء': 'الأربعاء',
    'الخميس': 'الخميس',
    'الجمعة': 'الجمعة', 'الجمعه': 'الجمعة',
    'السبت': 'السبت'
  };

  var typeMap = {
    'اختبار': 'exam', 'امتحان': 'exam', 'فاينال': 'exam', 'نهائي': 'exam',
    'كويز': 'quiz', 'اختبار قصير': 'quiz',
    'واجب': 'assignment', 'تكليف': 'assignment', 'هومورك': 'assignment',
    'مشروع': 'project', 'بروجكت': 'project',
    'تسليم': 'assignment', 'بحث': 'project'
  };

  /**
   * Parse user message for actionable commands.
   * Returns array of detected actions (may be empty).
   */
  function parseChatCommands(text) {
    if (!text) return [];
    var actions = [];
    var t = text.trim();
    var tNorm = normalizeAr(t);

    // ── Pattern 1: Add course ──
    // "أضف مادة هياكل البيانات" / "ضيف ماده كذا"
    var addCourseRx = /(?:أضف|ضيف|اضف|سجل)\s*(?:مادة?|ماده|كورس|مقرر)\s+(.+?)(?:\s*(?:ساعات|ساعه|بصعوبه|صعب|سهل|$))/i;
    var m = t.match(addCourseRx);
    if (m) {
      var name = m[1].replace(/[.،,]+$/, '').trim();
      if (name.length > 1 && name.length < 80) {
        var diff = 'normal';
        if (/صعب|صعبه|hard/i.test(t)) diff = 'hard';
        else if (/سهل|سهله|easy/i.test(t)) diff = 'easy';
        var hours = 3;
        var hm = t.match(/(\d+)\s*ساع/);
        if (hm) hours = parseInt(hm[1]) || 3;
        actions.push({ type: 'addCourse', data: { name: name, difficulty: diff, creditHours: hours, source: 'chat' } });
      }
    }

    // ── Pattern 2: Add exam / task ──
    // "اختباري الاسبوع القادم" / "عندي كويز يوم الخميس" / "اختبار هياكل البيانات يوم 25"
    var examRx = /(?:عندي|اختبار[ي]?|كويز|واجب|مشروع|تسليم|بحث)\s+(.+?)(?:\s+(?:يوم|في|بتاريخ|الاسبوع|القادم|الجاي|بكره|غدا|باكر))/i;
    var em = t.match(examRx);
    if (em) {
      var title = em[1].replace(/[.،,]+$/, '').trim();
      var taskType = 'exam';
      for (var kw in typeMap) {
        if (t.indexOf(kw) !== -1) { taskType = typeMap[kw]; break; }
      }

      // Try to detect date
      var deadline = '';
      if (/بكره|غدا|باكر/i.test(t)) {
        var tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        deadline = tomorrow.toISOString().split('T')[0];
      } else if (/الاسبوع\s*(?:القادم|الجاي)/i.test(t)) {
        var nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        deadline = nextWeek.toISOString().split('T')[0];
      } else {
        // Try to find a date pattern like "25/3" or "2026-03-25"
        var dateRx = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/;
        var dm = t.match(dateRx);
        if (dm) {
          var day = parseInt(dm[1]);
          var month = parseInt(dm[2]);
          var year = dm[3] ? parseInt(dm[3]) : new Date().getFullYear();
          if (year < 100) year += 2000;
          deadline = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        }
      }

      // Detect day name
      var detectedDay = '';
      for (var dk in dayMap) {
        if (tNorm.indexOf(normalizeAr(dk)) !== -1) {
          detectedDay = dayMap[dk];
          break;
        }
      }

      if (title.length > 1) {
        actions.push({
          type: 'addTask',
          data: {
            title: title,
            type: taskType,
            deadline: deadline,
            day: detectedDay,
            source: 'chat'
          }
        });
      }
    }

    // ── Pattern 3: Record GPA ──
    // "معدلي صار 3.8" / "حصلت على 4.2"
    var gpaRx = /(?:معدل[ي]?\s*(?:صار|اصبح|الحين|الان|الجديد|التراكمي)?)\s*(\d+\.?\d*)/i;
    var gm = t.match(gpaRx);
    if (gm) {
      var gpa = parseFloat(gm[1]);
      if (gpa > 0 && gpa <= 5) {
        actions.push({ type: 'updateGpa', data: { currentGpa: gpa } });
      }
    }

    // ── Pattern 4: Set exam date for a course ──
    // "اختبار هياكل البيانات يوم 25/4"
    var examDateRx = /اختبار\s+(.+?)\s+(?:يوم|بتاريخ|في)\s+(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i;
    var edm = t.match(examDateRx);
    if (edm) {
      var cname = edm[1].trim();
      var dtStr = edm[2];
      var dparts = dtStr.split(/[\/\-]/);
      if (dparts.length >= 2) {
        var dd = parseInt(dparts[0]);
        var mm = parseInt(dparts[1]);
        var yy = dparts[2] ? parseInt(dparts[2]) : new Date().getFullYear();
        if (yy < 100) yy += 2000;
        var isoDate = yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
        actions.push({ type: 'setExamDate', data: { courseName: cname, examDate: isoDate } });
      }
    }

    // ── Pattern 5: Delete/remove course ──
    // "احذف مادة كذا" / "شيل مادة كذا"
    var delCourseRx = /(?:احذف|شيل|ازل|حذف)\s*(?:مادة?|ماده|كورس|مقرر)\s+(.+?)$/i;
    var dcm = t.match(delCourseRx);
    if (dcm) {
      var cNameDel = dcm[1].replace(/[.،,]+$/, '').trim();
      if (cNameDel.length > 1) {
        actions.push({ type: 'removeCourse', data: { name: cNameDel } });
      }
    }

    return actions;
  }

  /**
   * Execute parsed actions and return a summary for the chat to display.
   */
  function executeChatActions(actions) {
    var results = [];
    actions.forEach(function (action) {
      switch (action.type) {
        case 'addCourse':
          addCourse(action.data);
          results.push('✅ تمت إضافة مادة "' + action.data.name + '" للبروفايل');
          break;
        case 'removeCourse':
          var removed = removeCourse(action.data.name);
          results.push(removed
            ? '✅ تم حذف مادة "' + action.data.name + '"'
            : '⚠️ لم أجد مادة بهذا الاسم');
          break;
        case 'addTask':
          addTask(action.data);
          results.push('✅ تمت إضافة ' + (action.data.type === 'exam' ? 'اختبار' : 'مهمة') + ' "' + action.data.title + '"' + (action.data.deadline ? ' بتاريخ ' + action.data.deadline : ''));
          break;
        case 'updateGpa':
          saveProfile({ currentGpa: action.data.currentGpa });
          results.push('✅ تم تحديث المعدل إلى ' + action.data.currentGpa);
          break;
        case 'setExamDate':
          var ok = addExamDate(action.data.courseName, action.data.examDate);
          results.push(ok
            ? '✅ تم تحديث موعد اختبار "' + action.data.courseName + '" إلى ' + action.data.examDate
            : '⚠️ لم أجد مادة بهذا الاسم لتحديث موعد اختبارها');
          break;
      }
    });
    return results;
  }

  /* ══════════════════════════════════════════
     6. TRANSCRIPT DATA PERSISTENCE
     Called after transcript PDF is parsed.
     ══════════════════════════════════════════ */

  function applyTranscriptData(parsed) {
    if (!parsed) return;
    var raw = sGet(KEYS.PROFILE) || {};
    if (!raw.basic) raw.basic = {};
    if (!raw.goals) raw.goals = {};

    // Apply basic info
    if (parsed.name) raw.basic.name = parsed.name;
    if (parsed.university) raw.basic.university = parsed.university;
    if (parsed.major) raw.basic.major = parsed.major;
    if (parsed.faculty) raw.basic.faculty = parsed.faculty;

    // Apply academic data
    if (parsed.gpa) raw.goals.currentGpa = parseFloat(parsed.gpa);
    if (parsed.earnedHours) raw.goals.earnedHours = parseInt(parsed.earnedHours);
    if (parsed.planHours) raw.goals.planHours = parseInt(parsed.planHours);

    // Apply current semester courses
    if (parsed.registeredCourses && parsed.registeredCourses.length > 0) {
      if (!raw.courses) raw.courses = [];
      parsed.registeredCourses.forEach(function (rc) {
        var norm = normalizeAr(rc.name || rc.courseName);
        var exists = raw.courses.find(function (c) { return normalizeAr(c.name) === norm; });
        if (!exists) {
          raw.courses.push({
            id: uid(),
            name: rc.name || rc.courseName,
            creditHours: parseInt(rc.creditHours || rc.hours) || 3,
            difficulty: 'normal',
            examDate: '',
            currentProgress: 0,
            color: '#6366f1',
            source: 'transcript',
            addedAt: new Date().toISOString()
          });
        }
      });
    }

    // Store completed courses for history
    if (parsed.completedCourses && parsed.completedCourses.length > 0) {
      raw.completedCourses = parsed.completedCourses.map(function (cc) {
        return {
          name: cc.name || cc.courseName,
          grade: cc.grade || '',
          creditHours: parseInt(cc.creditHours || cc.hours) || 3,
          semester: cc.semester || '',
          source: 'transcript'
        };
      });
    }

    // Save all semesters data for history
    if (parsed.semesters) {
      raw.transcriptSemesters = parsed.semesters;
    }

    sSet(KEYS.PROFILE, raw);
    syncGpaFromProfile(raw);
    broadcast('transcript:applied', parsed);

    // 🔥 Firestore-First: push profile + transcript to Firestore
    if (window.FirebaseDB && window.FirebaseDB.isReady()) {
      window.FirebaseDB.pushProfileToFirestore();
      if (parsed.registeredCourses || parsed.completedCourses) {
        window.FirebaseDB.pushTranscriptToFirestore(
          raw.completedCourses || [],
          raw.goals?.currentGpa,
          raw.goals?.earnedHours,
          parsed.semesters || []
        );
      }
    }
    return raw;
  }

  /* ══════════════════════════════════════════
     7. UNIFIED CONTEXT BUILDER
     Rich context for AI chat system prompt.
     ══════════════════════════════════════════ */

  function buildStudentContext() {
    var profile = getProfile();
    var plan = sGet(KEYS.PLAN) || {};
    var gpa = sGet(KEYS.GPA) || {};
    var achievements = sGet(KEYS.ACHIEVE) || [];

    var ctx = {
      hasProfile: !!profile,
      student: null,
      courses: [],
      exams: [],
      tasks: [],
      todaySessions: [],
      upcomingSessions: [],
      gpaInfo: null,
      planStats: null,
      achievements: [],
      completedCourses: []
    };

    if (!profile) return ctx;

    // Student info
    ctx.student = {
      name: profile.name,
      university: profile.university,
      major: profile.major,
      level: profile.level,
      currentGpa: profile.currentGpa,
      targetGpa: profile.targetGpa,
      earnedHours: profile.earnedHours,
      planHours: profile.planHours,
      goal: profile.goal,
      studyPrefs: profile.learning
    };

    // Courses with exam countdowns
    var now = new Date();
    var todayISO = now.toISOString().split('T')[0];
    ctx.courses = (profile.courses || []).map(function (c) {
      var daysUntilExam = null;
      if (c.examDate) {
        var examDate = new Date(c.examDate + 'T00:00:00');
        daysUntilExam = Math.ceil((examDate - now) / 86400000);
      }
      return {
        name: c.name,
        creditHours: c.creditHours,
        difficulty: c.difficulty,
        examDate: c.examDate,
        daysUntilExam: daysUntilExam,
        grade: c.grade,
        progress: c.currentProgress
      };
    });

    // Upcoming exams (sorted by date)
    ctx.exams = ctx.courses
      .filter(function (c) { return c.daysUntilExam !== null && c.daysUntilExam >= 0; })
      .sort(function (a, b) { return a.daysUntilExam - b.daysUntilExam; });

    // Today's sessions
    var dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    var todayName = dayNames[now.getDay()];
    var planSessions = plan.plan || [];
    ctx.todaySessions = planSessions.filter(function (s) {
      return s.date === todayISO || (s.day === todayName && !s.completed);
    }).sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });

    // Upcoming sessions (next 7 days)
    var weekFromNow = new Date(now);
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    var weekISO = weekFromNow.toISOString().split('T')[0];
    ctx.upcomingSessions = planSessions.filter(function (s) {
      return s.date && s.date > todayISO && s.date <= weekISO && !s.completed;
    }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); }).slice(0, 10);

    // Tasks
    ctx.tasks = (plan.tasks || []).filter(function (t) { return !t.completed; });

    // GPA info
    ctx.gpaInfo = {
      current: profile.currentGpa,
      target: profile.targetGpa,
      gap: profile.targetGpa - profile.currentGpa,
      earnedHours: profile.earnedHours,
      remainingHours: profile.planHours - profile.earnedHours,
      totalPlanHours: profile.planHours
    };

    // Plan stats
    var totalSessions = planSessions.length;
    var completedSessions = planSessions.filter(function (s) { return s.completed; }).length;
    ctx.planStats = {
      totalSessions: totalSessions,
      completedSessions: completedSessions,
      completionRate: totalSessions > 0 ? Math.round(completedSessions / totalSessions * 100) : 0,
      totalWeeks: plan.weeks || 0
    };

    // Completed courses (from transcript)
    ctx.completedCourses = profile.completedCourses || [];

    // Achievements
    if (Array.isArray(achievements)) {
      ctx.achievements = achievements.filter(function (a) { return a.earned; });
    }

    return ctx;
  }

  /**
   * Generate a rich system prompt section for the AI.
   */
  function buildAIContextBlock() {
    var ctx = buildStudentContext();
    if (!ctx.hasProfile) return 'الطالب لم يعد ملفه الشخصي بعد.';

    var lines = [];
    var s = ctx.student;

    lines.push('═══ بيانات الطالب ═══');
    lines.push('الاسم: ' + (s.name || 'غير محدد'));
    lines.push('الجامعة: ' + s.university + ' | التخصص: ' + (s.major || '—') + ' | المستوى: ' + (s.level || '—'));
    lines.push('المعدل الحالي: ' + s.currentGpa + ' / 5.00 | المستهدف: ' + s.targetGpa);
    lines.push('الساعات المنجزة: ' + s.earnedHours + ' / ' + s.planHours + ' (' + (s.planHours - s.earnedHours) + ' متبقية)');
    lines.push('الهدف: ' + ({ raise: 'رفع المعدل', keep: 'المحافظة', pass: 'اجتياز' }[s.goal] || s.goal));

    if (ctx.courses.length > 0) {
      lines.push('');
      lines.push('═══ مواد الفصل الحالي (' + ctx.courses.length + ') ═══');
      ctx.courses.forEach(function (c) {
        var info = '• ' + c.name + ' (' + c.creditHours + ' ساعات, ' + c.difficulty + ')';
        if (c.daysUntilExam !== null) {
          if (c.daysUntilExam <= 0) info += ' — ⚠️ الاختبار اليوم أو فات!';
          else if (c.daysUntilExam <= 7) info += ' — ⚠️ الاختبار بعد ' + c.daysUntilExam + ' أيام!';
          else info += ' — الاختبار بعد ' + c.daysUntilExam + ' يوم';
        }
        if (c.grade) info += ' | الدرجة: ' + c.grade;
        lines.push(info);
      });
    }

    if (ctx.exams.length > 0) {
      lines.push('');
      lines.push('═══ الاختبارات القادمة ═══');
      ctx.exams.slice(0, 6).forEach(function (e) {
        lines.push('• ' + e.name + ': بعد ' + e.daysUntilExam + ' يوم (' + e.examDate + ')');
      });
    }

    if (ctx.todaySessions.length > 0) {
      lines.push('');
      lines.push('═══ جلسات اليوم ═══');
      ctx.todaySessions.forEach(function (s) {
        lines.push('• ' + (s.courseName || s.title || '—') + ' | ' + s.time + ' - ' + (s.timeEnd || '') + (s.completed ? ' ✅' : ''));
      });
    }

    if (ctx.tasks.length > 0) {
      lines.push('');
      lines.push('═══ المهام القادمة (' + ctx.tasks.length + ') ═══');
      ctx.tasks.slice(0, 5).forEach(function (t) {
        lines.push('• ' + t.title + ' (' + (t.type || 'مهمة') + ')' + (t.deadline ? ' — ' + t.deadline : ''));
      });
    }

    if (ctx.planStats && ctx.planStats.totalSessions > 0) {
      lines.push('');
      lines.push('═══ إحصائيات الخطة ═══');
      lines.push('إجمالي الجلسات: ' + ctx.planStats.totalSessions + ' | مكتملة: ' + ctx.planStats.completedSessions + ' (' + ctx.planStats.completionRate + '%)');
    }

    if (ctx.gpaInfo && ctx.gpaInfo.gap > 0) {
      lines.push('');
      lines.push('═══ فجوة المعدل ═══');
      lines.push('يحتاج رفع ' + ctx.gpaInfo.gap.toFixed(2) + ' نقطة للوصول للهدف | ' + ctx.gpaInfo.remainingHours + ' ساعة متبقية');
    }

    return lines.join('\n');
  }

  /* ══════════════════════════════════════════
     8. EVENT BROADCASTING
     Cross-module communication
     ══════════════════════════════════════════ */

  var listeners = {};

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return function () {
      listeners[event] = listeners[event].filter(function (f) { return f !== fn; });
    };
  }

  function broadcast(event, data) {
    (listeners[event] || []).forEach(function (fn) {
      try { fn(data); } catch (e) { }
    });
    // Also broadcast via BroadcastChannel for cross-tab
    try {
      var bc = new BroadcastChannel('uqu_data_bridge');
      bc.postMessage({ event: event, data: data, ts: Date.now() });
      bc.close();
    } catch (e) { /* BroadcastChannel not supported */ }
  }

  /* ══════════════════════════════════════════
     9. DATA INTEGRITY CHECK
     Validates & repairs data inconsistencies
     ══════════════════════════════════════════ */

  function validateAndRepair() {
    var issues = [];
    var raw = sGet(KEYS.PROFILE);
    if (!raw) return issues;

    // Ensure structure
    if (!raw.basic) { raw.basic = {}; issues.push('أضيفت بنية البيانات الأساسية'); }
    if (!raw.goals) { raw.goals = {}; issues.push('أضيفت بنية الأهداف'); }
    if (!raw.learning) { raw.learning = {}; issues.push('أضيفت بنية تفضيلات التعلم'); }
    if (!raw.courses) { raw.courses = []; issues.push('أضيفت قائمة المواد'); }

    // Remove duplicate courses
    var seen = {};
    var uniqueCourses = [];
    raw.courses.forEach(function (c) {
      var key = normalizeAr(c.name);
      if (!seen[key]) {
        seen[key] = true;
        // Ensure course has ID
        if (!c.id) c.id = uid();
        uniqueCourses.push(c);
      } else {
        issues.push('حذفت مادة مكررة: ' + c.name);
      }
    });
    raw.courses = uniqueCourses;

    // Validate GPA range
    if (raw.goals.currentGpa && (raw.goals.currentGpa < 0 || raw.goals.currentGpa > 5)) {
      raw.goals.currentGpa = Math.max(0, Math.min(5, raw.goals.currentGpa));
      issues.push('تم تصحيح المعدل ليكون ضمن النطاق 0-5');
    }

    // Sync GPA stores
    syncGpaFromProfile(raw);

    if (issues.length > 0) {
      sSet(KEYS.PROFILE, raw);
    }

    return issues;
  }

  /* ══════════════════════════════════════════
     10. INITIALIZATION
     Run on every page load
     ══════════════════════════════════════════ */

  function init() {
    // Validate data on load
    validateAndRepair();
    // Sync GPA from profile
    var raw = sGet(KEYS.PROFILE);
    if (raw) syncGpaFromProfile(raw);

    // Listen for cross-tab changes
    try {
      var bc = new BroadcastChannel('uqu_data_bridge');
      bc.onmessage = function (e) {
        if (e.data && e.data.event) {
          (listeners[e.data.event] || []).forEach(function (fn) {
            try { fn(e.data.data); } catch (err) { /* ignore */ }
          });
        }
      };
    } catch (e) { /* BroadcastChannel not supported */ }
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ══════════════════════════════════════════
     EXPORTS
     ══════════════════════════════════════════ */

  window.DataBridge = Object.freeze({
    // Profile
    getProfile: getProfile,
    saveProfile: saveProfile,

    // Courses
    addCourse: addCourse,
    removeCourse: removeCourse,

    // Tasks & Exams
    addTask: addTask,
    addExamDate: addExamDate,

    // GPA Sync
    syncGpaFromProfile: syncGpaFromProfile,
    syncProfileFromGpa: syncProfileFromGpa,

    // Chat integration
    parseChatCommands: parseChatCommands,
    executeChatActions: executeChatActions,

    // Transcript
    applyTranscriptData: applyTranscriptData,

    // AI Context
    buildStudentContext: buildStudentContext,
    buildAIContextBlock: buildAIContextBlock,

    // Events
    on: on,
    broadcast: broadcast,

    // Utilities
    validateAndRepair: validateAndRepair,

    // Storage keys reference
    KEYS: KEYS
  });

})();
