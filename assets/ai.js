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

  // ── Backend Config ──
  // API Keys and System Prompts are secured in the FastAPI Backend.
  // Tool schemas live exclusively in backend/agent/tools_schema.py — this
  // client never needs tool definitions, it only applies results.
  // All HTTP/auth helpers live in UQUCore.api (assets/core.js).
  const _api = () => window.UQUCore.api;

  // ── Apply backend tool results to local UI/localStorage ("Hands" only) ──
  // The backend ("Brain") executes tools and returns results via /api/chat.
  // This function ONLY applies those precomputed results to client-side state.
  async function executeClientTool(name, args, backendData) {
    try {
      if (!backendData) return { success: false, error: 'No backend result provided' };

      // ── Apply the local "Hands" (UI updates, localStorage) ──
      switch (name) {
        // Brain-only tools (Read data & complex math, no local state changes)
        case 'get_student_data':
        case 'analyze_transcript':
        case 'get_upcoming_exams':
        case 'get_gpa_history':
        case 'predict_gpa_pathway':
        case 'generate_semester_master_plan':
        case 'modify_study_session':
        case 'update_learning_preferences':
          return backendData;

        // Hands-on tools (Write to local UI/storage)
        case 'add_upcoming_exam': {
          const exams = getStorage('uqu_exams', []);
          const exam = { ...args, id: backendData.id || Date.now(), done: false, createdAt: new Date().toISOString() };
          exams.push(exam);
          localStorage.setItem('uqu_exams', JSON.stringify(exams));
          window.dispatchEvent(new CustomEvent('uqu:examsUpdated', { detail: exam }));
          broadcastSync('add_upcoming_exam');
          return backendData || { success: true, message: `تم تسجيل اختبار ${args.subject} بتاريخ ${args.date}` };
        }

        case 'add_course': {
          const profile = getStorage('uqu_profile_v2', {});
          if (!profile.courses) profile.courses = [];
          const course = {
            id: backendData.id || Date.now(), name: args.name, code: args.code || '',
            difficulty: args.difficulty || 'medium', examDate: args.examDate || null,
            grade: args.grade != null ? args.grade : null,
            createdAt: new Date().toISOString()
          };
          profile.courses.push(course);
          localStorage.setItem('uqu_profile_v2', JSON.stringify(profile));
          window.dispatchEvent(new CustomEvent('uqu:profileUpdated', { detail: profile }));
          broadcastSync('add_course');
          return backendData || { success: true, message: `تمت إضافة مادة: ${args.name}` };
        }

        case 'create_study_plan': {
          const plan = {
            ...args, id: backendData.id || Date.now(), active: true, createdAt: new Date().toISOString()
          };

          const existing = getStorage('uqu_plan_v5', {});
          const existingTasks = existing.tasks || existing.plan || [];
          const newTasks = (args.tasks || []).map(t => ({
            ...t,
            id: t.id || (Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
            source: 'ai',
            createdAt: t.createdAt || new Date().toISOString()
          }));

          const merged = existingTasks.slice();
          newTasks.forEach(nt => {
            const dup = merged.some(et => (et.title === nt.title) && (et.date === nt.date));
            if (!dup) merged.push(nt);
          });

          const updatedPlan = {
            plan: merged, tasks: merged,
            title: args.title || existing.title || 'الخطة الدراسية',
            weeks: existing.weeks || 1,
            updatedAt: new Date().toISOString()
          };
          localStorage.setItem('uqu_plan_v5', JSON.stringify(updatedPlan));
          window.dispatchEvent(new CustomEvent('uqu:planUpdated', { detail: plan }));
          try { localStorage.setItem('uqu_plan_v5_ping', String(Date.now())); } catch (_) { }
          broadcastSync('create_study_plan');
          return backendData || { success: true, message: `تم إنشاء الخطة: ${args.title}` };
        }

        case 'complete_task': {
          const stored = getStorage('uqu_plan_v5', {});
          const tasks = stored.tasks || stored.plan || [];
          // Schema sends task_name; legacy frontend may send task_title — support both
          const searchName = args.task_name || args.task_title || '';
          const task = tasks.find(t => t.title?.includes(searchName) || searchName?.includes(t.title || ''));
          if (task) {
            task.done = true; task.completedAt = new Date().toISOString();
            localStorage.setItem('uqu_plan_v5', JSON.stringify({ ...stored, tasks }));
            window.dispatchEvent(new CustomEvent('uqu:planUpdated', { detail: task }));
            return backendData || { success: true, message: `✅ أنجزت: ${task.title}` };
          }
          return backendData || { success: false, error: 'لم أجد المهمة، حاول بعنوان مختلف' };
        }

        case 'update_profile': {
          const profile = getStorage('uqu_profile_v2', {});
          if (!profile.goals) profile.goals = {};
          if (!profile.preferences) profile.preferences = {};
          if (!profile.basic) profile.basic = {};
          const { field, value } = args;
          if (field === 'currentGpa' || field === 'targetGpa') {
            profile.goals[field] = parseFloat(value);
          } else if (['studyStyle', 'focusDuration', 'studyTime', 'availableHours'].includes(field)) {
            profile.preferences[field] = value;
          } else if (field === 'name' || field === 'major') {
            profile.basic[field] = value;
          }
          localStorage.setItem('uqu_profile_v2', JSON.stringify(profile));
          window.dispatchEvent(new CustomEvent('uqu:profileUpdated', { detail: profile }));
          broadcastSync('update_profile');
          return backendData || { success: true, message: `تم تحديث ${field} إلى: ${value}` };
        }

        case 'send_notification': {
          const notifs = getStorage('uqu_notifications', []);
          const notif = { ...args, id: backendData.id || Date.now(), read: false, createdAt: new Date().toISOString() };
          notifs.unshift(notif);
          localStorage.setItem('uqu_notifications', JSON.stringify(notifs.slice(0, 50)));
          window.dispatchEvent(new CustomEvent('uqu:notificationsUpdated', { detail: notif }));
          return backendData || { success: true, message: args.message };
        }

        case 'navigate_to_page': {
          const pages = {
            dashboard: 'dashboard.html', gpa: 'gpa.html',
            plan: 'plan.html', pomodoro: 'pomodoro.html',
            locations: 'locations.html', profile: 'profile.html', chat: 'chat.html'
          };
          const url = pages[args.page];
          if (!url) return backendData || { success: false, error: 'صفحة غير معروفة' };
          setTimeout(() => { window.location.href = url; }, 1200);
          return backendData || { success: true, message: `جارٍ فتح صفحة ${args.page}...`, navigating: true, url };
        }

        case 'change_theme': {
          const theme = args.theme || 'auto';
          document.body.setAttribute('data-theme', theme);
          localStorage.setItem('uqu_theme', theme);
          window.dispatchEvent(new CustomEvent('uqu:themeChanged', { detail: { theme } }));
          const label = theme === 'dark' ? 'الوضع الليلي 🌙' : theme === 'light' ? 'الوضع النهاري ☀️' : 'التلقائي 🌗';
          return backendData || { success: true, message: `تم التغيير إلى ${label}` };
        }

        case 'add_semester_gpa': {
          const semesters = getStorage('uqu_semesters', []);
          const semester = {
            id: backendData.id || Date.now(), name: args.name, gpa: parseFloat(args.gpa),
            hours: args.hours || 0, createdAt: new Date().toISOString()
          };
          semesters.push(semester);
          localStorage.setItem('uqu_semesters', JSON.stringify(semesters));
          
          const profile = getStorage('uqu_profile_v2', {});
          if (!profile.goals) profile.goals = {};
          profile.goals.currentGpa = parseFloat(args.gpa);
          localStorage.setItem('uqu_profile_v2', JSON.stringify(profile));
          
          window.dispatchEvent(new CustomEvent('uqu:profileUpdated', { detail: profile }));
          broadcastSync('add_semester_gpa');
          return backendData || { success: true, message: `تم تسجيل ${args.name} بمعدل ${args.gpa}` };
        }

        case 'update_course_grade': {
          const profile = getStorage('uqu_profile_v2', {});
          const courses = profile.courses || [];
          const norm = (s) => s?.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase() || '';
          const course = courses.find(c =>
            norm(c.name).includes(norm(args.course_name)) ||
            norm(args.course_name).includes(norm(c.name))
          );
          if (!course) return backendData || { success: false, error: `لم أجد مادة باسم: ${args.course_name}` };
          course.grade = parseFloat(args.grade);
          course.updatedAt = new Date().toISOString();
          localStorage.setItem('uqu_profile_v2', JSON.stringify(profile));
          window.dispatchEvent(new CustomEvent('uqu:profileUpdated', { detail: profile }));
          broadcastSync('update_course_grade');
          return backendData || { success: true, message: `تم تحديث درجة ${course.name} إلى ${args.grade}/5` };
        }

        default:
          return backendData || { success: false, error: `أداة غير معروفة: ${name}` };
      }
    } catch (e) {
      console.warn('[executeClientTool]', e);
      return { success: false, error: e.message };
    }
  }

  // ── Broadcast data change to all open tabs (dashboard refresh) ──
  function broadcastSync(tool) {
    try {
      const bc = new BroadcastChannel('uqu_sync');
      bc.postMessage({ type: 'dataChanged', tool });
      bc.close();
    } catch (e) { }
  }

  // ──────────────────────────────────────────────
  // 2. CONTEXT BUILDER
  //    Injects student profile + plan into system prompt
  // ──────────────────────────────────────────────

  // ──────────────────────────────────────────────
  // 3. API CALL — FastAPI Backend
  // ──────────────────────────────────────────────

  async function callClaude(messages) {
    const api = _api();
    const token = await api.getToken();

    if (!token) {
      window.dispatchEvent(new CustomEvent('uqu:toast', {
        detail: { message: 'يرجى تسجيل الدخول لاستخدام المساعد الذكي', type: 'warning' }
      }));
      throw new Error('يرجى تسجيل الدخول أولاً لاستخدام المساعد الذكي.');
    }

    const cleanedMessages = messages.map(m => {
      let contentStr = '';
      if (typeof m.content === 'object') {
        contentStr = m.content?.content || (m.content instanceof Event ? '' : JSON.stringify(m.content));
      } else {
        contentStr = String(m.content || '');
      }
      return { role: m.role, content: contentStr };
    });

    console.log('[AI] → POST /api/chat | msgs:', cleanedMessages.length);

    try {
      const data = await api.post('/api/chat', { messages: cleanedMessages, conversationId: null });
      if (!data.success) throw new Error(data.message || 'فشل الاتصال بالمحرك الذكي');

      const serverActions = data.actions || [];
      for (const action of serverActions) {
        try { await executeClientTool(action.tool, action.args || {}, action.result); }
        catch (e) { console.warn(e); }
      }
      return { text: data.message || '', actions: serverActions };
    } catch (err) {
      console.error('[AI] Backend error:', err.status || '', err.message);
      if (err.status === 401) throw new Error('انتهت جلستك — يرجى إعادة تسجيل الدخول.');
      if (err.status === 503) throw new Error('خدمة الذكاء غير متاحة الآن (تحقق من إعدادات الخادم).');
      if (!err.status) throw new Error('تعذّر الوصول إلى الخادم — تأكد أن الـ backend يعمل.');
      throw err;
    }
  }

  /**
   * Render action cards beneath an AI message
   */
  function renderActionCards(actions) {
    if (!actions || !actions.length) return '';

    const successful = actions.filter(a => a.result?.success);
    if (!successful.length) return '';

    const icons = {
      add_upcoming_exam: '📅',
      create_study_plan: '📋',
      send_notification: '🔔',
      add_course: '📚',
      complete_task: '✅',
      update_profile: '👤',
      analyze_transcript: '📊',
      get_gpa_history: '📈',
      get_student_data: '🗂️',
      get_upcoming_exams: '📅',
      navigate_to_page: '🔗',
      change_theme: '🎨',
      add_semester_gpa: '🏆',
      update_course_grade: '✏️'
    };

    const labels = {
      add_upcoming_exam: 'تم تسجيل الاختبار',
      create_study_plan: 'تم إنشاء الخطة الدراسية',
      send_notification: 'تم إرسال الإشعار',
      add_course: 'تمت إضافة المادة',
      complete_task: 'تم إنجاز المهمة',
      update_profile: 'تم تحديث الملف الشخصي',
      analyze_transcript: 'تم تحليل السجل الأكاديمي',
      get_gpa_history: 'تم جلب مسار المعدل',
      get_student_data: 'تم قراءة بياناتك',
      get_upcoming_exams: 'تم جلب الاختبارات',
      navigate_to_page: 'جارٍ فتح الصفحة...',
      change_theme: 'تم تغيير المظهر',
      add_semester_gpa: 'تم تسجيل الفصل',
      update_course_grade: 'تم تحديث الدرجة'
    };

    const cards = successful.map(a => {
      const icon = icons[a.tool] || '⚡';
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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:.9em;">$1</code>');
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
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Extract and render tables BEFORE other replacements (placeholder swap)
    const tablePlaceholders = [];
    const tableRegex = /(?:^|\n)((?:\|[^\n]*\|\n)+(?:\|[ \-:|]+\|\n)(?:\|[^\n]*\|\n?)+)/g;
    safe = safe.replace(tableRegex, function (match, tbl) {
      const rendered = renderMdTable(tbl);
      if (!rendered) return match;
      const placeholder = '\u0000TBL' + tablePlaceholders.length + '\u0000';
      tablePlaceholders.push(rendered);
      return '\n' + placeholder + '\n';
    });

    // Code fences (```...```) → <pre><code>
    safe = safe.replace(/```([\s\S]*?)```/g, function (_, code) {
      return '<pre style="background:var(--surface-2);padding:10px 12px;border-radius:8px;overflow-x:auto;font-family:monospace;font-size:.85em;direction:ltr;text-align:left;"><code>' +
        code.replace(/\n$/, '') + '</code></pre>';
    });

    safe = safe
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:var(--surface-2);padding:1px 6px;border-radius:5px;font-family:monospace;font-size:.88em;">$1</code>')
      .replace(/^#{3} (.+)$/gm, '<h4 style="margin:.5em 0 .25em;font-weight:700;">$1</h4>')
      .replace(/^#{2} (.+)$/gm, '<h3 style="margin:.5em 0 .25em;font-weight:800;font-size:1.05em;">$1</h3>')
      .replace(/^#{1} (.+)$/gm, '<h2 style="margin:.5em 0 .25em;font-weight:900;font-size:1.15em;">$1</h2>')
      .replace(/^(\d+)\. (.+)$/gm, '<div style="margin:.25em 0;display:flex;gap:8px;"><span style="color:var(--accent);font-weight:700;flex-shrink:0;">$1.</span><span>$2</span></div>')
      .replace(/^[-•] (.+)$/gm, '<div style="margin:.25em 0;display:flex;gap:6px;"><span style="color:var(--accent);flex-shrink:0;">•</span><span>$1</span></div>')
      .replace(/\n\n/g, '</p><p style="margin:.5em 0;">')
      .replace(/\n/g, '<br>');

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
      } catch { }
    },

    // Load last session
    loadLast() {
      try {
        const saved = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY()));
        if (saved?.length) this.history = saved;
      } catch { }
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
      } catch { }
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

      ConversationManager.add('user', userText);

      try {
        const result = await callClaude(ConversationManager.getMessages());

        // Handle both old string format and new {text, actions} format
        const replyText = (typeof result === 'string') ? result : (result.text || '');
        const actions = (typeof result === 'object' && result.actions) ? result.actions : [];

        ConversationManager.add('assistant', replyText);

        // Typewriter effect
        if (onChunk) {
          await new Promise(resolve => typewriter(onChunk, replyText, resolve));
          // Append action chips inside bubble (not as flex sibling)
          if (actions.length > 0) {
            const cardsHtml = renderActionCards(actions);
            if (cardsHtml) onChunk.insertAdjacentHTML('beforeend', cardsHtml);
          }
        }

        if (onDone) onDone(replyText, actions);

      } catch (err) {
        // Only show offline message when truly offline; otherwise show retry hint
        const fallback = !navigator.onLine
          ? '⚠️ يبدو أنك غير متصل بالإنترنت. المساعد الذكي يحتاج اتصالاً للإجابة الآن، لكن يمكنك استخدام باقي أدوات الموقع بدون إنترنت.'
          : getOfflineFallback(err);

        if (onChunk) {
          await new Promise(resolve => typewriter(onChunk, fallback, resolve));
        }

        if (onDone) onDone(fallback, []);
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
    const plan = getStorage('uqu_plan_v5', null);
    const chips = [];

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

    const today = new Date(); today.setHours(0, 0, 0, 0);

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
  // ──────────────────────────────────────────────

  window.UQUAIChat = UQUAIChat;
  window.ConversationManager = ConversationManager;
  window.generateSmartChips = generateSmartChips;
  window.getExamCountdowns = getExamCountdowns;
  window.renderMarkdown = renderMarkdown;
  window.typewriter = typewriter;


})(window);
