/**
 * ================================================================
 * UQU ACADEMIC ASSISTANT — AI ENGINE v1.0
 * Claude API integration with context-aware prompting,
 * streaming typewriter, and offline fallback
 * ================================================================
 */

(function (window) {
  'use strict';

  // ──────────────────────────────────────────────
  // 1. CONFIG
  // ──────────────────────────────────────────────

  const AI_CONFIG = {
    streamDelay: 18,        // ms per character for typewriter
    streamChunkSize: 3,     // characters per frame
  };

  // ── Google Gemini API (direct browser call, CORS supported) ──
  const GEMINI_KEY   = 'AIzaSyBEzmNHO68H6G6ZJRqJX0uepwUPayEu-Jo';
  const GEMINI_MODEL = 'gemini-3-flash-preview';
  const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

  // ── Client-side tools ──
  const CLIENT_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'get_student_data',
        description: 'اجلب بيانات الطالب الكاملة: الملف الشخصي، المواد، المعدل، الخطة الدراسية، تفضيلات المذاكرة',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'analyze_transcript',
        description: 'حلّل السجل الأكاديمي الكامل للطالب وأعطِ تقريراً مفصلاً: المعدل، المواد الضعيفة، نقاط القوة، توصيات مخصصة حسب أسلوب المذاكرة',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_upcoming_exams',
        description: 'اجلب الاختبارات القادمة مع عدد الأيام المتبقية',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_upcoming_exam',
        description: 'سجّل اختباراً أو كويزاً أو واجباً قادماً في قائمة الطالب',
        parameters: {
          type: 'object',
          properties: {
            subject:   { type: 'string', description: 'اسم المادة' },
            date:      { type: 'string', description: 'التاريخ بصيغة YYYY-MM-DD' },
            time:      { type: 'string', description: 'الوقت مثل 10:00' },
            exam_type: { type: 'string', enum: ['exam','quiz','midterm','final','assignment'] },
            notes:     { type: 'string' }
          },
          required: ['subject', 'date']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_course',
        description: 'أضف مادة دراسية جديدة لقائمة الطالب',
        parameters: {
          type: 'object',
          properties: {
            name:       { type: 'string', description: 'اسم المادة' },
            code:       { type: 'string', description: 'رمز المادة مثل CS101' },
            difficulty: { type: 'string', enum: ['easy','medium','hard'] },
            examDate:   { type: 'string', description: 'تاريخ الاختبار YYYY-MM-DD' },
            grade:      { type: 'number', description: 'الدرجة الحالية من 5' }
          },
          required: ['name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_study_plan',
        description: 'أنشئ خطة مذاكرة مفصلة للطالب مع مراعاة أسلوبه ومدة تركيزه',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title:    { type: 'string' },
                  subject:  { type: 'string' },
                  duration: { type: 'number', description: 'المدة بالدقائق' },
                  priority: { type: 'string', enum: ['high','medium','low'] },
                  done:     { type: 'boolean' }
                }
              }
            }
          },
          required: ['title', 'tasks']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'complete_task',
        description: 'علّم مهمة من خطة المذاكرة كمنجزة',
        parameters: {
          type: 'object',
          properties: {
            task_title: { type: 'string', description: 'عنوان المهمة أو جزء منه' }
          },
          required: ['task_title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_profile',
        description: 'حدّث بيانات الملف الشخصي للطالب مثل المعدل أو أسلوب المذاكرة أو الهدف',
        parameters: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'الحقل: currentGpa | targetGpa | studyStyle | focusDuration | studyTime | name | major'
            },
            value: { type: 'string', description: 'القيمة الجديدة' }
          },
          required: ['field', 'value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_gpa_history',
        description: 'احصل على تاريخ المعدل عبر الفصول الدراسية وتحليل الاتجاه (صاعد/نازل)',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'send_notification',
        description: 'أرسل إشعاراً أو تذكيراً أو تنبيهاً للطالب',
        parameters: {
          type: 'object',
          properties: {
            title:   { type: 'string' },
            message: { type: 'string' },
            type:    { type: 'string', enum: ['info','warning','success','reminder'] }
          },
          required: ['title', 'message']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'navigate_to_page',
        description: 'انتقل إلى صفحة أخرى في الموقع — استخدمها عندما يطلب المستخدم فتح صفحة معينة مثل اللوحة أو المعدل أو الخطة أو البروفايل',
        parameters: {
          type: 'object',
          properties: {
            page: {
              type: 'string',
              enum: ['dashboard','gpa','plan','pomodoro','locations','profile','chat'],
              description: 'اسم الصفحة المطلوبة'
            }
          },
          required: ['page']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'change_theme',
        description: 'غيّر مظهر الموقع بين الوضع الليلي والنهاري',
        parameters: {
          type: 'object',
          properties: {
            theme: { type: 'string', enum: ['dark','light','auto'] }
          },
          required: ['theme']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_semester_gpa',
        description: 'أضف أو سجّل معدل فصل دراسي جديد في سجل المعدلات',
        parameters: {
          type: 'object',
          properties: {
            name:  { type: 'string', description: 'اسم الفصل مثل: الفصل الأول 1446' },
            gpa:   { type: 'number', description: 'المعدل من 5' },
            hours: { type: 'number', description: 'ساعات الفصل' }
          },
          required: ['name', 'gpa']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_course_grade',
        description: 'حدّث درجة أو علامة مادة موجودة في قائمة مواد الطالب',
        parameters: {
          type: 'object',
          properties: {
            course_name: { type: 'string', description: 'اسم المادة أو جزء منه' },
            grade:       { type: 'number', description: 'الدرجة الجديدة من 5' }
          },
          required: ['course_name', 'grade']
        }
      }
    },
    // ═══ Super-Agent Tools v2.0 ═══
    {
      type: 'function',
      function: {
        name: 'modify_study_session',
        description: 'عدّل جلسة أو مهمة في الخطة الدراسية الحالية — تغيير الموعد أو المدة أو المادة بناءً على ضغط الاختبارات',
        parameters: {
          type: 'object',
          properties: {
            task_name:    { type: 'string', description: 'اسم المهمة أو جزء منه' },
            new_date:     { type: 'string', description: 'التاريخ الجديد YYYY-MM-DD' },
            new_time:     { type: 'string', description: 'الوقت الجديد مثل 18:00' },
            new_duration: { type: 'number', description: 'المدة الجديدة بالدقائق' },
            new_subject:  { type: 'string', description: 'تغيير المادة' },
            reason:       { type: 'string', description: 'سبب التعديل' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'predict_gpa_pathway',
        description: 'احسب الدرجات المطلوبة في كل مادة للوصول للمعدل المستهدف',
        parameters: {
          type: 'object',
          properties: {
            target_gpa: { type: 'number', description: 'المعدل المستهدف من 5' },
            scenario:   { type: 'string', enum: ['minimum','balanced','ambitious'], description: 'نوع السيناريو' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_learning_preferences',
        description: 'حدّث تفضيلات أسلوب التعلم (وقت المذاكرة، سرعة، توتر)',
        parameters: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: ['best_time','study_hours','method','focus_length','study_speed','stress_level'], description: 'الحقل' },
            value: { type: 'string', description: 'القيمة الجديدة' },
            reason: { type: 'string', description: 'سبب التغيير' }
          },
          required: ['field', 'value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'generate_semester_master_plan',
        description: 'أنشئ خطة فصلية شاملة ومخصصة بالكامل للطالب. هذه ليست خطة عادية — هي خطة ذكية تقرأ: أسلوب التعلم (وقت الذروة، سرعة المذاكرة، مدة التركيز، مستوى التوتر)، نتائج السجل الأكاديمي (المواد الضعيفة تأخذ وقت أكثر)، وتواريخ الاختبارات. استخدمها عندما يطلب الطالب "سوّ لي جدول فصلي" أو "خطط لي الفصل كامل" أو "نظّم مذاكرتي".',
        parameters: {
          type: 'object',
          properties: {
            weeks: { type: 'number', description: 'عدد أسابيع الخطة (افتراضي: 16 أسبوع = فصل كامل)' },
            daily_hours: { type: 'number', description: 'ساعات الدراسة اليومية (يؤخذ من الملف الشخصي إذا لم يُحدد)' },
            include_weekends: { type: 'boolean', description: 'تضمين عطلة نهاية الأسبوع (الجمعة/السبت)' },
            focus_mode: { type: 'string', enum: ['balanced', 'exam_focused', 'weakness_recovery', 'gpa_boost'], description: 'نمط التركيز' }
          }
        }
      }
    }
  ];

  // ── Execute tool client-side (localStorage) ──
  function executeClientTool(name, args) {
    try {
      switch (name) {

        case 'get_student_data': {
          const profile  = getStorage('uqu_profile_v2', {});
          const plan     = getStorage('uqu_plan_v5', {});
          const exams    = getStorage('uqu_exams', []);
          const semesters= getStorage('uqu_semesters', []);
          const prefs    = profile.preferences || {};
          return { success: true, profile, plan, exams, semesters,
            studyStyle: prefs.studyStyle, focusDuration: prefs.focusDuration,
            studyTime: prefs.studyTime };
        }

        case 'analyze_transcript': {
          const profile   = getStorage('uqu_profile_v2', {});
          const semesters = getStorage('uqu_semesters', []);
          const courses   = profile.courses || [];
          const prefs     = profile.preferences || {};
          const goals     = profile.goals || {};

          const graded  = courses.filter(c => c.grade != null && c.grade !== '');
          const weak    = graded.filter(c => parseFloat(c.grade) < 3.0).map(c => ({
            name: c.name, grade: parseFloat(c.grade), code: c.code || '',
            difficulty: c.difficulty || 'medium'
          })).sort((a, b) => a.grade - b.grade);
          const strong  = graded.filter(c => parseFloat(c.grade) >= 4.0).map(c => ({
            name: c.name, grade: parseFloat(c.grade)
          })).sort((a, b) => b.grade - a.grade);
          const mid     = graded.filter(c => parseFloat(c.grade) >= 3.0 && parseFloat(c.grade) < 4.0);
          const calcAvg = graded.length
            ? (graded.reduce((s, c) => s + parseFloat(c.grade), 0) / graded.length).toFixed(2)
            : null;
          const currentGpa = parseFloat(goals.currentGpa || calcAvg || 0);
          const targetGpa  = parseFloat(goals.targetGpa || 5);
          const gap        = Math.max(0, targetGpa - currentGpa).toFixed(2);

          // Personalized recommendations based on study style
          const styleRecs = {
            'visual':   'ارسم خرائط ذهنية ومخططات لكل مادة ضعيفة',
            'reading':  'اقرأ الكتاب المقرر وضع ملخصات مكتوبة لكل وحدة',
            'practice': 'حلّ أكثر من 20 سؤالاً تدريبياً يومياً في المواد الضعيفة',
            'group':    'شكّل مجموعة دراسية لمناقشة المواد الصعبة',
            'audio':    'سجّل شرحك الصوتي للمادة واستمع له',
          };
          const rec = styleRecs[prefs.studyStyle] || 'خصّص جلسات مذاكرة منتظمة باستخدام تقنية بومودورو';

          return {
            success:       true,
            currentGpa,    targetGpa,     gap,
            calcAvg,       totalCourses:  courses.length,
            gradedCourses: graded.length, weakSubjects: weak,
            strongSubjects: strong,       midSubjects:  mid.map(c => c.name),
            studyStyle:    prefs.studyStyle    || 'لم يحدد',
            focusDuration: prefs.focusDuration || 25,
            studyTime:     prefs.studyTime     || 'لم يحدد',
            semesters:     semesters.length,
            recommendation: rec,
            trend: currentGpa >= targetGpa ? '✅ على المسار الصحيح' : `تحتاج رفع ${gap} نقطة للوصول للهدف`
          };
        }

        case 'get_upcoming_exams': {
          const today = new Date().toISOString().split('T')[0];
          const exams = getStorage('uqu_exams', [])
            .filter(e => !e.done && e.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, 10);
          return { success: true, exams };
        }

        case 'add_upcoming_exam': {
          const exams = getStorage('uqu_exams', []);
          const exam  = { ...args, id: Date.now(), done: false, createdAt: new Date().toISOString() };
          exams.push(exam);
          localStorage.setItem('uqu_exams', JSON.stringify(exams));
          window.dispatchEvent(new CustomEvent('uqu:examsUpdated', { detail: exam }));
          broadcastSync('add_upcoming_exam');
          return { success: true, id: exam.id, message: `تم تسجيل اختبار ${args.subject} بتاريخ ${args.date}` };
        }

        case 'add_course': {
          const profile = getStorage('uqu_profile_v2', {});
          if (!profile.courses) profile.courses = [];
          const course = {
            id: Date.now(), name: args.name, code: args.code || '',
            difficulty: args.difficulty || 'medium', examDate: args.examDate || null,
            grade: args.grade != null ? args.grade : null,
            createdAt: new Date().toISOString()
          };
          profile.courses.push(course);
          localStorage.setItem('uqu_profile_v2', JSON.stringify(profile));
          window.dispatchEvent(new CustomEvent('uqu:profileUpdated', { detail: profile }));
          if (window.FirebaseDB && typeof window.FirebaseDB.pushProfileToFirestore === 'function') {
            window.FirebaseDB.pushProfileToFirestore();
          }
          broadcastSync('add_course');
          return { success: true, id: course.id, message: `تمت إضافة مادة: ${args.name}` };
        }

        case 'create_study_plan': {
          const plan = {
            ...args, id: Date.now(), active: true, createdAt: new Date().toISOString()
          };

          // Merge AI-generated tasks with existing plan instead of overwriting
          const existing = getStorage('uqu_plan_v5', {});
          const existingTasks = existing.tasks || existing.plan || [];
          const newTasks = (args.tasks || []).map(t => ({
            ...t,
            id: t.id || (Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
            source: 'ai',
            createdAt: t.createdAt || new Date().toISOString()
          }));

          // Avoid duplicate titles on same date
          const merged = existingTasks.slice();
          newTasks.forEach(nt => {
            const dup = merged.some(et =>
              (et.title === nt.title) && (et.date === nt.date)
            );
            if (!dup) merged.push(nt);
          });

          const updatedPlan = {
            plan: merged,
            tasks: merged,
            title: args.title || existing.title || 'الخطة الدراسية',
            weeks: existing.weeks || 1,
            updatedAt: new Date().toISOString()
          };
          localStorage.setItem('uqu_plan_v5', JSON.stringify(updatedPlan));

          // Trigger UI refresh in this tab
          window.dispatchEvent(new CustomEvent('uqu:planUpdated', { detail: plan }));
          // Trigger cross-tab refresh via storage event (write a heartbeat key)
          try { localStorage.setItem('uqu_plan_v5_ping', String(Date.now())); } catch(_) {}

          if (window.FirebaseDB && typeof window.FirebaseDB.pushPlanToFirestore === 'function') {
            window.FirebaseDB.pushPlanToFirestore(plan);
          }
          broadcastSync('create_study_plan');
          return { success: true, id: plan.id, addedTasks: newTasks.length, message: `تم إنشاء الخطة: ${args.title}` };
        }

        case 'complete_task': {
          const stored = getStorage('uqu_plan_v5', {});
          const tasks  = stored.tasks || stored.plan || [];
          const task   = tasks.find(t =>
            t.title?.includes(args.task_title) || args.task_title?.includes(t.title || '')
          );
          if (task) {
            task.done = true; task.completedAt = new Date().toISOString();
            localStorage.setItem('uqu_plan_v5', JSON.stringify({ ...stored, tasks }));
            window.dispatchEvent(new CustomEvent('uqu:planUpdated', { detail: task }));
            return { success: true, message: `✅ أنجزت: ${task.title}` };
          }
          return { success: false, error: 'لم أجد المهمة، حاول بعنوان مختلف' };
        }

        case 'update_profile': {
          const profile = getStorage('uqu_profile_v2', {});
          if (!profile.goals)       profile.goals = {};
          if (!profile.preferences) profile.preferences = {};
          if (!profile.basic)       profile.basic = {};
          const { field, value } = args;
          if (field === 'currentGpa' || field === 'targetGpa') {
            profile.goals[field] = parseFloat(value);
          } else if (['studyStyle','focusDuration','studyTime','availableHours'].includes(field)) {
            profile.preferences[field] = value;
          } else if (field === 'name' || field === 'major') {
            profile.basic[field] = value;
          }
          localStorage.setItem('uqu_profile_v2', JSON.stringify(profile));
          window.dispatchEvent(new CustomEvent('uqu:profileUpdated', { detail: profile }));
          if (window.FirebaseDB && typeof window.FirebaseDB.pushProfileToFirestore === 'function') {
            window.FirebaseDB.pushProfileToFirestore();
          }
          broadcastSync('update_profile');
          return { success: true, message: `تم تحديث ${field} إلى: ${value}` };
        }

        case 'get_gpa_history': {
          const semesters = getStorage('uqu_semesters', []);
          const profile   = getStorage('uqu_profile_v2', {});
          const current   = parseFloat(profile.goals?.currentGpa || 0);
          const history   = semesters
            .map(s => ({ name: s.name || s.label || 'فصل', gpa: parseFloat(s.gpa || 0) }))
            .filter(s => s.gpa > 0);
          const gpas      = history.map(s => s.gpa);
          const best      = gpas.length ? Math.max(...gpas) : current;
          const worst     = gpas.length ? Math.min(...gpas) : current;
          const trend     = history.length >= 2
            ? (history[history.length - 1].gpa > history[0].gpa ? 'صاعد ↑' : 'نازل ↓')
            : 'لا يوجد تاريخ كافٍ';
          return { success: true, current, history, trend, best, worst };
        }

        case 'send_notification': {
          const notifs = getStorage('uqu_notifications', []);
          const notif  = { ...args, id: Date.now(), read: false, createdAt: new Date().toISOString() };
          notifs.unshift(notif);
          localStorage.setItem('uqu_notifications', JSON.stringify(notifs.slice(0, 50)));
          window.dispatchEvent(new CustomEvent('uqu:notificationsUpdated', { detail: notif }));
          return { success: true, message: args.message };
        }

        case 'navigate_to_page': {
          const pages = {
            dashboard: 'dashboard.html', gpa: 'gpa.html',
            plan: 'plan.html', pomodoro: 'pomodoro.html',
            locations: 'locations.html', profile: 'profile.html', chat: 'chat.html'
          };
          const url = pages[args.page];
          if (!url) return { success: false, error: 'صفحة غير معروفة' };
          setTimeout(() => { window.location.href = url; }, 1200);
          return { success: true, message: `جارٍ فتح صفحة ${args.page}...`, navigating: true, url };
        }

        case 'change_theme': {
          const theme = args.theme || 'auto';
          document.body.setAttribute('data-theme', theme);
          localStorage.setItem('uqu_theme', theme);
          window.dispatchEvent(new CustomEvent('uqu:themeChanged', { detail: { theme } }));
          const label = theme === 'dark' ? 'الوضع الليلي 🌙' : theme === 'light' ? 'الوضع النهاري ☀️' : 'التلقائي 🌗';
          return { success: true, message: `تم التغيير إلى ${label}` };
        }

        case 'add_semester_gpa': {
          const semesters = getStorage('uqu_semesters', []);
          const semester  = {
            id: Date.now(), name: args.name, gpa: parseFloat(args.gpa),
            hours: args.hours || 0, createdAt: new Date().toISOString()
          };
          semesters.push(semester);
          localStorage.setItem('uqu_semesters', JSON.stringify(semesters));
          // Also update currentGpa in profile to the latest semester
          const profile = getStorage('uqu_profile_v2', {});
          if (!profile.goals) profile.goals = {};
          profile.goals.currentGpa = parseFloat(args.gpa);
          localStorage.setItem('uqu_profile_v2', JSON.stringify(profile));
          window.dispatchEvent(new CustomEvent('uqu:profileUpdated', { detail: profile }));
          if (window.FirebaseDB && typeof window.FirebaseDB.syncSemestersToFirestore === 'function') {
            window.FirebaseDB.syncSemestersToFirestore([semester]);
            window.FirebaseDB.pushProfileToFirestore(); // update currentGpa
          }
          broadcastSync('add_semester_gpa');
          return { success: true, message: `تم تسجيل ${args.name} بمعدل ${args.gpa}` };
        }

        case 'update_course_grade': {
          const profile = getStorage('uqu_profile_v2', {});
          const courses = profile.courses || [];
          const norm    = (s) => s?.replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').toLowerCase() || '';
          const course  = courses.find(c =>
            norm(c.name).includes(norm(args.course_name)) ||
            norm(args.course_name).includes(norm(c.name))
          );
          if (!course) return { success: false, error: `لم أجد مادة باسم: ${args.course_name}` };
          course.grade = parseFloat(args.grade);
          course.updatedAt = new Date().toISOString();
          localStorage.setItem('uqu_profile_v2', JSON.stringify(profile));
          window.dispatchEvent(new CustomEvent('uqu:profileUpdated', { detail: profile }));
          if (window.FirebaseDB && typeof window.FirebaseDB.pushProfileToFirestore === 'function') {
            window.FirebaseDB.pushProfileToFirestore();
          }
          broadcastSync('update_course_grade');
          return { success: true, message: `تم تحديث درجة ${course.name} إلى ${args.grade}/5` };
        }

        default:
          return { success: false, error: `أداة غير معروفة: ${name}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ── Broadcast data change to all open tabs (dashboard refresh) ──
  function broadcastSync(tool) {
    try {
      const bc = new BroadcastChannel('uqu_sync');
      bc.postMessage({ type: 'dataChanged', tool });
      bc.close();
    } catch(e) {}
  }

  // ──────────────────────────────────────────────
  // 2. CONTEXT BUILDER
  //    Injects student profile + plan into system prompt
  // ──────────────────────────────────────────────

  function buildSystemPrompt() {
    let isInjected = false;
    const uid = window.FirebaseAuth?.getUid?.() || window.UQUAuth?.getSession?.()?.uid || 'anon';
    let profile = getStorage('uqu_profile_' + uid, null) || getStorage('uqu_profile_v2', null);

    const today = new Date().toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    let ctx = `أنت "فاتن" — المساعد الأكاديمي الذكي لجامعة أم القرى (UQU).
تاريخ اليوم: ${today}.
شخصيتك: ذكي، داعم، مباشر، تتحدث بالعربية مع لمسة خليجية لطيفة.
استخدم الإيموجي باعتدال. أجب مباشرة بدون مقدمات طويلة.
لا تطلب معلومات لديك بالفعل في السياق.
`;

    // ── Student profile ──
    if (window.DataBridge) {
      ctx += '\n' + window.DataBridge.buildAIContextBlock();
      isInjected = true;
    } else if (profile) {
      const b = profile.basic || {};
      const g = profile.goals || {};
      const courses = profile.courses || [];
      if (b.name || g.currentGpa != null) isInjected = true;
      
      ctx += `\n── بيانات الطالب ──\n`;
      if (b.name)  ctx += `الاسم: ${b.name}\n`;
      if (b.major) ctx += `التخصص: ${b.major}\n`;
      if (g.currentGpa != null) ctx += `المعدل الحالي: ${g.currentGpa} / 5.00\n`;
      if (g.targetGpa  != null) ctx += `الهدف: ${g.targetGpa}\n`;
      if (courses.length) {
        ctx += `المواد (${courses.length}): ${courses.map(c => c.name).join('، ')}\n`;
      }
    }

    // ── Study preferences (critical for personalization) ──
    const prefs = profile?.preferences || {};
    if (prefs.studyStyle || prefs.focusDuration || prefs.studyTime) {
      ctx += `\n── تفضيلات المذاكرة ──\n`;
      if (prefs.studyStyle)    ctx += `أسلوب المذاكرة: ${prefs.studyStyle}\n`;
      if (prefs.focusDuration) ctx += `مدة التركيز: ${prefs.focusDuration} دقيقة\n`;
      if (prefs.studyTime)     ctx += `وقت المذاكرة المفضل: ${prefs.studyTime}\n`;
      if (prefs.availableHours)ctx += `الساعات المتاحة يومياً: ${prefs.availableHours}\n`;
    }

    // ── Weak subjects alert (proactive intelligence) ──
    const courses = profile?.courses || [];
    const weak    = courses.filter(c => c.grade != null && parseFloat(c.grade) < 3.0);
    if (weak.length) {
      ctx += `\n⚠️ تنبيه — مواد تحتاج اهتمام عاجل (أقل من 3.0):\n`;
      weak.forEach(c => {
        ctx += `- ${c.name}${c.grade ? ` (${c.grade})` : ''}${c.difficulty === 'hard' ? ' [صعبة]' : ''}\n`;
      });
      ctx += `عند الحديث عن هذه المواد، قدّم توصيات مخصصة بناءً على أسلوب مذاكرة الطالب.\n`;
    }

    // ── Upcoming exams alert ──
    const today2 = new Date().toISOString().split('T')[0];
    const exams  = getStorage('uqu_exams', []).filter(e => !e.done && e.date >= today2);
    if (exams.length) {
      const soon = exams.filter(e => {
        const diff = Math.ceil((new Date(e.date) - new Date()) / 86400000);
        return diff <= 7;
      });
      if (soon.length) {
        ctx += `\n🚨 اختبارات خلال 7 أيام: ${soon.map(e => `${e.subject}(${e.date})`).join('، ')}\n`;
        ctx += `نبّه الطالب بهذه الاختبارات عند الحاجة.\n`;
      }
    }

    ctx += `
── تعليمات الوكيل الذكي ──
🔧 مركز التحكم الكامل: أنت تتحكم في كل شيء بالموقع — تنفّذ الأوامر فعلياً ولا تقترح فقط.
📊 التحليل الأكاديمي: عند طلب تحليل السجل، استخدم analyze_transcript فوراً.
📈 مسار المعدل: عند السؤال عن تطور المعدل، استخدم get_gpa_history.
📋 خطة المذاكرة: اجعلها عملية بجلسات بومودورو حسب مدة تركيز الطالب.
🎯 التخصيص: راعِ أسلوب المذاكرة عند تقديم الاقتراحات.
💡 الاستباقية: نبّه عند وجود مادة ضعيفة أو اختبار قريب.
⚡ التأكيد: بعد أي أمر، أكّد ما تم بوضوح.
🔗 التنقل: إذا طلب المستخدم فتح صفحة ("روح اللوحة"، "افتح المعدل"، "خذني للخطة") استخدم navigate_to_page.
🎨 المظهر: إذا طلب تغيير الثيم أو الوضع الليلي/النهاري استخدم change_theme.
🏆 إضافة فصل: عند ذكر معدل فصل دراسي، استخدم add_semester_gpa ويسجّل تلقائياً في سجل المعدلات.
✏️ تحديث الدرجات: إذا أخبرك بدرجة مادة، استخدم update_course_grade لتحديثها في ملفه.
📝 تحديث الاسم/التخصص: عند قول "غير اسمي" أو "عدّل تخصصي"، استخدم update_profile فوراً.
- لا تقترح على المستخدم أن يذهب يغيّر بنفسه — أنت تنفّذ.
- لا تخترع معلومات عن جامعة أم القرى، قل أنك لا تعرف بصدق.`;

    return { prompt: ctx, isInjected };
  }

// ──────────────────────────────────────────────
// 3. API CALL — FastAPI Backend (primary) with Gemini fallback
// ──────────────────────────────────────────────

// Backend base URL (set in firebase-config.js)
function getBackendURL() {
  return window.AGENT_BASE_URL || 'http://localhost:8000';
}

// Convert CLIENT_TOOLS to Gemini functionDeclarations format (for fallback)
const GEMINI_TOOLS = [{
  functionDeclarations: CLIENT_TOOLS.map(t => ({
    name:        t.function.name,
    description: t.function.description,
    parameters:  t.function.parameters
  }))
}];

  async function callClaude(messages) {
    const actionsLog = [];
    
    // ── Context Injection ──
    const { prompt: systemPrompt, isInjected } = buildSystemPrompt();
    if (isInjected) {
      // Simulate action to trigger UI yellow badge
      actionsLog.push({ tool: 'get_student_data', args: {}, result: { success: true, message: 'تم قراءة بياناتك' } });
    }
    
    // Create a copy of messages and inject the unassailable system context at index 0 as a user message
    // (This guarantees both FastAPI and Gemini get it in standard unified format)
    const injectedMessages = [...messages];
    injectedMessages.unshift({ role: 'user', content: '[SYSTEM CONTEXT - DO NOT ACKNOWLEDGE]:\n' + systemPrompt });

    // ── Try FastAPI Backend first ──
  try {
    const backendURL = getBackendURL();
    if (backendURL && !backendURL.includes('REPLACE')) {

      // Wait for Firebase Auth to initialize before getting the token
      const auth = window.firebase ? window.firebase.auth() : null;
      if (auth && auth.currentUser === undefined) {
        // Wait up to 1.5 seconds for auth state to resolve
        await new Promise(resolve => {
          const timeout = setTimeout(resolve, 1500);
          const unsubscribe = auth.onAuthStateChanged(() => {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          });
        });
      }

      // Get Firebase token if available
      const token = window.FirebaseDB?.getIdToken
        ? await window.FirebaseDB.getIdToken()
        : null;

      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${backendURL}/chat`, {
        method:  'POST',
        headers,
        body: JSON.stringify({
          messages: injectedMessages.map(m => {
            let contentStr = '';
            if (typeof m.content === 'object') {
              // Flatten if it's an object or PointerEvent
              contentStr = m.content?.content || (m.content instanceof Event ? '' : JSON.stringify(m.content));
            } else {
              contentStr = String(m.content || '');
            }
            return { role: m.role, content: contentStr };
          }),
          conversationId: null
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Apply actions from the backend locally (update localStorage)
          const serverActions = data.actions || [];
          for (const action of serverActions) {
            try { executeClientTool(action.tool, action.args || {}); } catch (_) {}

            // 🔥 Dispatch domain events for real-time UI updates
            if (action.result?.success) {
              switch (action.tool) {
                case 'add_upcoming_exam':
                  window.dispatchEvent(new CustomEvent('uqu:examsUpdated', { detail: action.result }));
                  break;
                case 'create_study_plan':
                case 'modify_study_session':
                case 'generate_semester_master_plan':
                case 'complete_task':
                  window.dispatchEvent(new CustomEvent('uqu:planUpdated', { detail: action.result }));
                  break;
                case 'update_profile':
                case 'update_learning_preferences':
                case 'add_course':
                  window.dispatchEvent(new CustomEvent('uqu:profileUpdated'));
                  break;
                case 'send_notification':
                  window.dispatchEvent(new CustomEvent('uqu:notificationsUpdated', { detail: action.result }));
                  break;
                case 'predict_gpa_pathway':
                  // No UI dispatch needed — the response text handles this
                  break;
              }
            }
          }
          return { text: data.message || '', actions: serverActions };
        }
      }
      // If response not ok, fall through to Gemini fallback
    }
  } catch (backendErr) {
    console.warn('[AI] Backend unreachable, using Gemini fallback:', backendErr.message);
  }

  // ── Fallback: Direct Gemini (client-side tools) ──
  const MAX_ITER = 6;

  const contents = injectedMessages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || '' }]
  }));

  for (let i = 0; i < MAX_ITER; i++) {
    const response = await fetch(GEMINI_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools:      GEMINI_TOOLS,
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: {
          temperature:     1.0,
          topP:            1.0,
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `خطأ ${response.status}`);
    }

    const data      = await response.json();
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('لا يوجد رد من الموديل');

    const parts         = candidate.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);
    const textContent   = parts.filter(p => p.text).map(p => p.text).join('');

    // No function calls → final answer
    if (!functionCalls.length) {
      return { text: textContent, actions: actionsLog };
    }

    // Push model turn into conversation
    contents.push({ role: 'model', parts });

    // Execute tools and collect results
    const toolResultParts = functionCalls.map(part => {
      const { name, args } = part.functionCall;
      let result = {};
      try   { result = executeClientTool(name, args || {}); }
      catch (e) { result = { success: false, error: e.message }; }

      actionsLog.push({ tool: name, args, result });

      return { functionResponse: { name, response: result } };
    });

    // Push tool results as user turn
    contents.push({ role: 'user', parts: toolResultParts });
  }

  throw new Error('تجاوز الحد الأقصى لمعالجة الطلب');
}

/**
 * Render action cards beneath an AI message
 */
function renderActionCards(actions) {
  if (!actions || !actions.length) return '';

  const successful = actions.filter(a => a.result?.success);
  if (!successful.length) return '';

  const icons = {
    add_upcoming_exam:   '📅',
    create_study_plan:   '📋',
    send_notification:   '🔔',
    add_course:          '📚',
    complete_task:       '✅',
    update_profile:      '👤',
    analyze_transcript:  '📊',
    get_gpa_history:     '📈',
    get_student_data:    '🗂️',
    get_upcoming_exams:  '📅',
    navigate_to_page:    '🔗',
    change_theme:        '🎨',
    add_semester_gpa:    '🏆',
    update_course_grade: '✏️'
  };

  const labels = {
    add_upcoming_exam:   'تم تسجيل الاختبار',
    create_study_plan:   'تم إنشاء الخطة الدراسية',
    send_notification:   'تم إرسال الإشعار',
    add_course:          'تمت إضافة المادة',
    complete_task:       'تم إنجاز المهمة',
    update_profile:      'تم تحديث الملف الشخصي',
    analyze_transcript:  'تم تحليل السجل الأكاديمي',
    get_gpa_history:     'تم جلب مسار المعدل',
    get_student_data:    'تم قراءة بياناتك',
    get_upcoming_exams:  'تم جلب الاختبارات',
    navigate_to_page:    'جارٍ فتح الصفحة...',
    change_theme:        'تم تغيير المظهر',
    add_semester_gpa:    'تم تسجيل الفصل',
    update_course_grade: 'تم تحديث الدرجة'
  };

  const cards = successful.map(a => {
    const icon  = icons[a.tool]  || '⚡';
    const label = a.result?.message || labels[a.tool] || a.tool;
    return `<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(99,102,241,.12);
      border:1px solid rgba(99,102,241,.25);border-radius:20px;padding:4px 12px;
      font-size:.8rem;color:var(--accent);margin:2px 3px;cursor:default;">
      <span>${icon}</span><span>${label}</span>
    </div>`;
  }).join('');

  return `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:2px;">${cards}</div>`;
}

  // ──────────────────────────────────────────────
  // 4. TYPEWRITER RENDERER
  //    Streams text into a DOM element char by char
  // ──────────────────────────────────────────────

  function typewriter(element, text, onDone) {
    element.innerHTML = '';
    let i = 0;
    const total = text.length;

    function frame() {
      if (i >= total) {
        if (onDone) onDone();
        return;
      }
      // Chunk rendering for speed
      const chunk = Math.min(AI_CONFIG.streamChunkSize, total - i);
      element.innerHTML += escapeChunk(text.slice(i, i + chunk));
      i += chunk;
      // Auto-scroll
      const box = element.closest('[role="log"]') || element.parentElement;
      if (box) box.scrollTop = box.scrollHeight;
      setTimeout(frame, AI_CONFIG.streamDelay);
    }
    frame();
  }

  function escapeChunk(str) {
    return str
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/`(.+?)`/g,'<code style="background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:.9em;">$1</code>');
  }

  // Render a markdown-style table (| col | col |) as a real <table>
  function renderMdTable(tableMd) {
    const lines = tableMd.split('\n').filter(l => l.trim().startsWith('|'));
    if (lines.length < 2) return null;
    const splitRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
    const header = splitRow(lines[0]);
    // line[1] is the separator (---|---) — skip it
    const rows = lines.slice(2).map(splitRow);
    let html = '<div style="overflow-x:auto;margin:.6em 0;">' +
      '<table style="border-collapse:collapse;width:100%;font-size:.9em;border:1px solid var(--border);border-radius:8px;overflow:hidden;">' +
      '<thead><tr style="background:var(--surface-2);">';
    header.forEach(h => {
      html += '<th style="padding:8px 12px;text-align:right;font-weight:700;border-bottom:1px solid var(--border);">' + h + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach((r, i) => {
      const bg = i % 2 ? 'background:var(--surface-2);' : '';
      html += '<tr style="' + bg + '">';
      r.forEach(c => {
        html += '<td style="padding:6px 12px;border-bottom:1px solid var(--border);">' + c + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  // Full markdown-lite renderer for final text (with table support)
  function renderMarkdown(text) {
    // Escape HTML first
    let safe = String(text || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Extract and render tables BEFORE other replacements (placeholder swap)
    const tablePlaceholders = [];
    const tableRegex = /(?:^|\n)((?:\|[^\n]*\|\n)+(?:\|[ \-:|]+\|\n)(?:\|[^\n]*\|\n?)+)/g;
    safe = safe.replace(tableRegex, function(match, tbl) {
      const rendered = renderMdTable(tbl);
      if (!rendered) return match;
      const placeholder = '\u0000TBL' + tablePlaceholders.length + '\u0000';
      tablePlaceholders.push(rendered);
      return '\n' + placeholder + '\n';
    });

    // Code fences (```...```) → <pre><code>
    safe = safe.replace(/```([\s\S]*?)```/g, function(_, code) {
      return '<pre style="background:var(--surface-2);padding:10px 12px;border-radius:8px;overflow-x:auto;font-family:monospace;font-size:.85em;direction:ltr;text-align:left;"><code>' +
        code.replace(/\n$/, '') + '</code></pre>';
    });

    safe = safe
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/`(.+?)`/g,'<code style="background:var(--surface-2);padding:1px 6px;border-radius:5px;font-family:monospace;font-size:.88em;">$1</code>')
      .replace(/^#{3} (.+)$/gm,'<h4 style="margin:.5em 0 .25em;font-weight:700;">$1</h4>')
      .replace(/^#{2} (.+)$/gm,'<h3 style="margin:.5em 0 .25em;font-weight:800;font-size:1.05em;">$1</h3>')
      .replace(/^#{1} (.+)$/gm,'<h2 style="margin:.5em 0 .25em;font-weight:900;font-size:1.15em;">$1</h2>')
      .replace(/^(\d+)\. (.+)$/gm,'<div style="margin:.25em 0;display:flex;gap:8px;"><span style="color:var(--accent);font-weight:700;flex-shrink:0;">$1.</span><span>$2</span></div>')
      .replace(/^[-•] (.+)$/gm,'<div style="margin:.25em 0;display:flex;gap:6px;"><span style="color:var(--accent);flex-shrink:0;">•</span><span>$1</span></div>')
      .replace(/\n\n/g,'</p><p style="margin:.5em 0;">')
      .replace(/\n/g,'<br>');

    // Restore tables
    tablePlaceholders.forEach((tbl, i) => {
      safe = safe.replace('\u0000TBL' + i + '\u0000', tbl);
    });

    return safe;
  }

  // ──────────────────────────────────────────────
  // 5. CONVERSATION MANAGER (with persistence)
  // ──────────────────────────────────────────────

  const getUid = () => window.FirebaseAuth?.getUid() || window.UQUAuth?.getSession()?.uid || 'anon';
  const CHAT_STORAGE_KEY = () => `uqu_chat_history_v1_${getUid()}`;
  const CONVERSATIONS_KEY = () => `uqu_conversations_v1_${getUid()}`;

  const ConversationManager = {
    history: [],
    maxHistory: 20,
    currentConversationId: null,

    add(role, content) {
      this.history.push({ role, content, timestamp: new Date().toISOString() });
      if (this.history.length > this.maxHistory * 2) {
        this.history = this.history.slice(-this.maxHistory);
      }
      this._persist();
    },

    getMessages() {
      return this.history.map(m => ({ role: m.role, content: m.content }));
    },

    clear() {
      this.history = [];
      this.currentConversationId = null;
    },

    // Save current chat to localStorage
    _persist() {
      try {
        localStorage.setItem(CHAT_STORAGE_KEY(), JSON.stringify(this.history));
        this._saveConversation();
      } catch {}
    },

    // Load last session
    loadLast() {
      try {
        const saved = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY()));
        if (saved?.length) this.history = saved;
      } catch {}
    },

    // Conversation management
    _saveConversation() {
      if (!this.history.length) return;
      const convos = this._getAllConversations();
      const firstUserMsg = this.history.find(m => m.role === 'user');
      
      let contentText = firstUserMsg ? firstUserMsg.content : '';
      if (typeof contentText === 'object') {
        contentText = contentText?.content || '';
      }
      contentText = String(contentText || '').trim();
      const title = contentText ? contentText.slice(0, 50) : 'محادثة جديدة';

      if (!this.currentConversationId) {
        this.currentConversationId = Date.now();
      }

      if (window.FirebaseDB && typeof window.FirebaseDB.pushChatToFirestore === 'function') {
        window.FirebaseDB.pushChatToFirestore(this.currentConversationId, this.history, title);
      }

      const existing = convos.findIndex(c => c.id === this.currentConversationId);
      const convo = {
        id: this.currentConversationId,
        title,
        messages: this.history,
        updatedAt: new Date().toISOString(),
        messageCount: this.history.length
      };

      if (existing >= 0) {
        convos[existing] = convo;
      } else {
        convos.unshift(convo);
      }

      // Keep last 20 conversations
      const trimmed = convos.slice(0, 20);
      try {
        localStorage.setItem(CONVERSATIONS_KEY(), JSON.stringify(trimmed));
      } catch {}
    },

    _getAllConversations() {
      try {
        return JSON.parse(localStorage.getItem(CONVERSATIONS_KEY())) || [];
      } catch { return []; }
    },

    loadConversation(id) {
      const convos = this._getAllConversations();
      const convo = convos.find(c => c.id === id);
      if (convo) {
        this.history = convo.messages;
        this.currentConversationId = convo.id;
        localStorage.setItem(CHAT_STORAGE_KEY(), JSON.stringify(this.history));
        return convo;
      }
      return null;
    },

    deleteConversation(id) {
      let convos = this._getAllConversations();
      convos = convos.filter(c => c.id !== id);
      localStorage.setItem(CONVERSATIONS_KEY(), JSON.stringify(convos));
      if (this.currentConversationId === id) {
        this.clear();
        localStorage.removeItem(CHAT_STORAGE_KEY());
      }
    },

    newConversation() {
      this.history = [];
      this.currentConversationId = null;
      localStorage.removeItem(CHAT_STORAGE_KEY());
    },

    getConversationsList() {
      return this._getAllConversations().map(c => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        messageCount: c.messageCount
      }));
    }
  };

  // ──────────────────────────────────────────────
  // 6. SMART CHAT CONTROLLER (replaces regex brain)
  // ──────────────────────────────────────────────

  const UQUAIChat = {
    isProcessing: false,

    async send(userText, onChunk, onDone, onError) {
      if (this.isProcessing) return;
      this.isProcessing = true;

      // ── DataBridge: Parse & execute commands from user text ──
      let actionResults = [];
      if (window.DataBridge) {
        try {
          const actions = window.DataBridge.parseChatCommands(userText);
          if (actions.length > 0) {
            actionResults = window.DataBridge.executeChatActions(actions);
          }
        } catch (e) { }
      }

      ConversationManager.add('user', userText);

      try {
        const result = await callClaude(ConversationManager.getMessages());

        // Handle both old string format and new {text, actions} format
        const replyText  = (typeof result === 'string') ? result : (result.text || '');
        const actions    = (typeof result === 'object' && result.actions) ? result.actions : [];

        // Append local DataBridge action results (legacy)
        let fullReply = replyText;
        if (actionResults.length > 0) {
          fullReply += '\n\n───\n' + actionResults.join('\n');
        }

        ConversationManager.add('assistant', fullReply);

        // Typewriter effect
        if (onChunk) {
          await new Promise(resolve => typewriter(onChunk, fullReply, resolve));
          // Append action chips inside bubble (not as flex sibling)
          if (actions.length > 0) {
            const cardsHtml = renderActionCards(actions);
            if (cardsHtml) onChunk.insertAdjacentHTML('beforeend', cardsHtml);
          }
        }

        if (onDone) onDone(fullReply, actions);

      } catch (err) {
        // Only show offline message when truly offline; otherwise show retry hint
        const fallback = !navigator.onLine
          ? '⚠️ يبدو أنك غير متصل بالإنترنت. المساعد الذكي يحتاج اتصالاً للإجابة الآن، لكن يمكنك استخدام باقي أدوات الموقع بدون إنترنت.'
          : getOfflineFallback(err);

        // Append any local action results
        let fullFallback = fallback;
        if (actionResults.length > 0) {
          fullFallback += '\n\n───\n' + actionResults.join('\n');
        }

        if (onChunk) {
          await new Promise(resolve => typewriter(onChunk, fullFallback, resolve));
        }

        if (onDone) onDone(fullFallback, []);
        // Only trigger onError (local-brain fallback) when offline
        if (onError && !navigator.onLine) onError(err);
      } finally {
        this.isProcessing = false;
      }
    },

    clearHistory() {
      ConversationManager.clear();
    }
  };

  // ──────────────────────────────────────────────
  // 7. OFFLINE / FALLBACK RESPONSES
  // ──────────────────────────────────────────────

  function getOfflineFallback(err) {
    const isNetwork = err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed');
    if (isNetwork) {
      return '⚠️ يبدو أنك غير متصل بالإنترنت. المساعد الذكي يحتاج اتصالاً للإجابة الآن، لكن يمكنك استخدام باقي أدوات الموقع بدون إنترنت.';
    }
    return '⚠️ حدث خطأ مؤقت في الاتصال بالمساعد الذكي. حاول مرة ثانية أو اسأل سؤالاً مختلفاً.';
  }

  // ──────────────────────────────────────────────
  // 8. SMART SUGGESTIONS GENERATOR
  //    Generates contextual chips based on profile
  // ──────────────────────────────────────────────

  function generateSmartChips() {
    const profile = getStorage('uqu_profile_v2', null);
    const plan    = getStorage('uqu_plan_v5', null);
    const chips   = [];

    // Always include basics
    chips.push({ icon: '📅', text: 'إيش عندي اليوم؟' });

    // Context-aware chips
    if (profile?.courses?.length) {
      const hasExam = profile.courses.find(c => c.examDate);
      if (hasExam) chips.push({ icon: '⚠️', text: `متى اختبار ${hasExam.name}؟` });

      const hardCourse = profile.courses.find(c => c.difficulty === 'hard');
      if (hardCourse) chips.push({ icon: '🎯', text: `كيف أذاكر ${hardCourse.name}؟` });
    }

    if (profile?.goals?.currentGpa) {
      const gpa = parseFloat(profile.goals.currentGpa);
      const target = parseFloat(profile.goals.targetGpa || 0);
      if (target > gpa) {
        chips.push({ icon: '📈', text: 'كيف أرفع معدلي؟' });
      }
    }

    if (plan?.plan?.length) {
      chips.push({ icon: '⏭', text: 'ما الجلسة القادمة؟' });
    }

    chips.push({ icon: '🧮', text: 'احسب معدلي المتوقع' });
    chips.push({ icon: '📊', text: 'ملخص بروفايلي' });

    return chips.slice(0, 6);
  }

  // ──────────────────────────────────────────────
  // 9. EXAM COUNTDOWN WIDGET
  //    Smart exam alert with days remaining
  // ──────────────────────────────────────────────

  function getExamCountdowns() {
    const profile = getStorage('uqu_profile_v2', null);
    if (!profile?.courses) return [];

    const today = new Date(); today.setHours(0,0,0,0);

    return profile.courses
      .filter(c => c.examDate)
      .map(c => {
        const d = new Date(c.examDate + 'T00:00:00');
        const diff = Math.round((d - today) / 86400000);
        return { name: c.name, date: c.examDate, diff, urgent: diff <= 7 && diff >= 0 };
      })
      .filter(c => c.diff >= 0)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 4);
  }

  // ──────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────

  function getStorage(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }

  // ──────────────────────────────────────────────
  // 10. EXPOSE
  // ──────────────────────────────────────────────

  window.UQUAIChat          = UQUAIChat;
  window.ConversationManager = ConversationManager;
  window.generateSmartChips = generateSmartChips;
  window.getExamCountdowns  = getExamCountdowns;
  window.renderMarkdown     = renderMarkdown;
  window.typewriter         = typewriter;


})(window);
