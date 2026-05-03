/**
 * ================================================================
 * UQU ACADEMIC ASSISTANT — AI Floating Assistant Button
 * Adds a floating AI chat popup on all pages (except chat.html)
 * Uses UQUAIChat from ai.js for actual AI responses
 * ================================================================
 */

(function () {
  'use strict';

  // Don't inject on the chat page (full chat already present)
  if (document.body.getAttribute('data-page') === 'chat') return;

  // ── Build DOM ──

  const fab = document.createElement('button');
  fab.className = 'ai-fab';
  fab.setAttribute('aria-label', 'المساعد الذكي');
  fab.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.07A7 7 0 0 1 14 23h-4a7 7 0 0 1-6.93-4H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73A2 2 0 0 1 12 2zm-2 9a5 5 0 0 0-5 5v1a5 5 0 0 0 5 5h4a5 5 0 0 0 5-5v-1a5 5 0 0 0-5-5h-4zm1 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm-6 4h2a1 1 0 1 1 0 2h-2a1 1 0 1 1 0-2z"/>
    </svg>
    <span class="ai-fab-label">اسألني أي شي 🤖</span>
  `;

  const popup = document.createElement('div');
  popup.className = 'ai-popup';
  popup.id = 'aiPopup';

  const pageName = document.body.getAttribute('data-page') || 'الرئيسية';
  const pageHints = {
    dashboard: 'كيف أتعامل مع لوحة المعلومات؟',
    plan: 'ساعدني أخطط جدولي الدراسي',
    gpa: 'كيف أحسب معدلي التراكمي؟',
    locations: 'كيف أبحث عن قاعة؟',
    profile: 'كيف أحدث بياناتي الأكاديمية؟',
    index: 'وش يقدر يسوي لي المساعد الأكاديمي؟'
  };

  const hint = pageHints[pageName] || 'كيف أقدر أساعدك؟';

  popup.innerHTML = `
    <div class="ai-popup-header">
      <span>🤖 المساعد الذكي</span>
      <button id="aiPopupClose" aria-label="إغلاق">✕</button>
    </div>
    <div class="ai-popup-body" id="aiPopupBody">
      <div class="ai-popup-msg assistant">مرحباً! أنا مساعدك الأكاديمي الذكي 🎓<br>اسألني عن أي شي يخص دراستك.</div>
    </div>
    <div class="ai-popup-input">
      <input type="text" id="aiPopupInput" placeholder="${hint}" autocomplete="off" />
      <button id="aiPopupSend">إرسال</button>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(popup);

  // ── State ──
  let isOpen = false;
  const messages = [];

  // ── Toggle popup ──
  fab.addEventListener('click', () => {
    isOpen = !isOpen;
    popup.classList.toggle('open', isOpen);
    if (isOpen) {
      setTimeout(() => document.getElementById('aiPopupInput')?.focus(), 200);
    }
  });

  document.getElementById('aiPopupClose')?.addEventListener('click', () => {
    isOpen = false;
    popup.classList.remove('open');
  });

  // Close with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      isOpen = false;
      popup.classList.remove('open');
    }
  });

  // ── Send message ──
  function sendMsg() {
    const input = document.getElementById('aiPopupInput');
    const body = document.getElementById('aiPopupBody');
    if (!input || !body) return;

    const text = input.value.trim();
    if (!text) return;

    // Add user message
    const userDiv = document.createElement('div');
    userDiv.className = 'ai-popup-msg user';
    userDiv.textContent = text;
    body.appendChild(userDiv);

    messages.push({ role: 'user', content: text });
    input.value = '';
    body.scrollTop = body.scrollHeight;

    // Show typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'ai-popup-msg assistant';
    typingDiv.style.opacity = '.6';
    typingDiv.textContent = '⏳ جاري التفكير...';
    body.appendChild(typingDiv);
    body.scrollTop = body.scrollHeight;

    // Use UQUAIChat if available, otherwise fallback
    if (window.UQUAIChat && typeof window.UQUAIChat.send === 'function') {
      window.UQUAIChat.send(messages)
        .then(reply => {
          typingDiv.remove();
          const replyDiv = document.createElement('div');
          replyDiv.className = 'ai-popup-msg assistant';
          replyDiv.innerHTML = window.renderMarkdown ? window.renderMarkdown(reply) : reply;
          body.appendChild(replyDiv);
          messages.push({ role: 'assistant', content: reply });
          body.scrollTop = body.scrollHeight;
        })
        .catch(() => {
          typingDiv.textContent = '⚠️ حدث خطأ. حاول مرة أخرى.';
          typingDiv.style.opacity = '1';
        });
    } else {
      // Offline fallback
      typingDiv.remove();
      const fallbackDiv = document.createElement('div');
      fallbackDiv.className = 'ai-popup-msg assistant';
      fallbackDiv.textContent = 'عذراً، خدمة الذكاء الاصطناعي غير متاحة حالياً. جرب صفحة الدردشة للتجربة الكاملة.';
      body.appendChild(fallbackDiv);
      body.scrollTop = body.scrollHeight;
    }
  }

  document.getElementById('aiPopupSend')?.addEventListener('click', sendMsg);
  document.getElementById('aiPopupInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMsg();
  });

})();
