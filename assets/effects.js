/**
 * ================================================================
 * UQU ACADEMIC ASSISTANT — VISUAL EFFECTS ENGINE v1.0
 * Particle field · Holographic cards · Cursor glow
 * Scroll-driven reveals · Page transitions · Noise overlay
 * ================================================================
 */

(function (window) {
  'use strict';

  // ──────────────────────────────────────────────
  // 1. PARTICLE FIELD
  //    Floating connected dots — canvas-based
  // ──────────────────────────────────────────────

  class ParticleField {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx    = canvas.getContext('2d');
      this.opts   = {
        count:         options.count        || 60,
        speed:         options.speed        || 0.35,
        connectDist:   options.connectDist  || 130,
        particleR:     options.particleR    || 1.8,
        color:         options.color        || [99, 102, 241],  // RGB
        opacity:       options.opacity      || 0.55,
        lineOpacity:   options.lineOpacity  || 0.18,
        mouseRadius:   options.mouseRadius  || 120,
        mouseForce:    options.mouseForce   || 0.6,
      };
      this.particles = [];
      this.mouse     = { x: -999, y: -999 };
      this.raf       = null;
      this._resize   = this.resize.bind(this);
      this._mousemove= this.onMouseMove.bind(this);
      this.init();
    }

    resize() {
      const dpr  = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width  = rect.width  * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvas.style.width  = rect.width  + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = rect.width;
      this.h = rect.height;
    }

    onMouseMove(e) {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    }

    init() {
      this.resize();
      window.addEventListener('resize', this._resize);
      window.addEventListener('mousemove', this._mousemove);

      for (let i = 0; i < this.opts.count; i++) {
        this.particles.push({
          x:  Math.random() * this.w,
          y:  Math.random() * this.h,
          vx: (Math.random() - 0.5) * this.opts.speed,
          vy: (Math.random() - 0.5) * this.opts.speed,
          r:  this.opts.particleR * (0.6 + Math.random() * 0.8),
          life: Math.random(),
        });
      }

      this.animate();
    }

    animate() {
      this.raf = requestAnimationFrame(() => this.animate());
      this.draw();
    }

    draw() {
      const { ctx, w, h, opts } = this;
      ctx.clearRect(0, 0, w, h);

      const [r, g, b] = opts.color;

      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];

        // Mouse repulsion / attraction
        const dx = this.mouse.x - p.x;
        const dy = this.mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < opts.mouseRadius) {
          const force = (1 - dist / opts.mouseRadius) * opts.mouseForce;
          p.vx -= (dx / dist) * force * 0.05;
          p.vy -= (dy / dist) * force * 0.05;
        }

        // Dampen velocity
        p.vx *= 0.995;
        p.vy *= 0.995;

        p.x += p.vx;
        p.y += p.vy;

        // Wrap edges
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${opts.opacity})`;
        ctx.fill();

        // Connect nearby particles
        for (let j = i + 1; j < this.particles.length; j++) {
          const q  = this.particles[j];
          const ex = p.x - q.x;
          const ey = p.y - q.y;
          const ed = Math.sqrt(ex * ex + ey * ey);

          if (ed < opts.connectDist) {
            const alpha = (1 - ed / opts.connectDist) * opts.lineOpacity;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      window.removeEventListener('resize', this._resize);
      window.removeEventListener('mousemove', this._mousemove);
    }
  }

  // ──────────────────────────────────────────────
  // 2. HOLOGRAPHIC CARD EFFECT
  //    Tilt + rainbow sheen on hover
  // ──────────────────────────────────────────────

  function initHoloCards() {
    const cards = document.querySelectorAll('.holo-card, .glass-card, .card[data-holo]');

    cards.forEach(card => {
      card.addEventListener('mousemove', e => {
        const rect   = card.getBoundingClientRect();
        const x      = e.clientX - rect.left;
        const y      = e.clientY - rect.top;
        const cx     = rect.width  / 2;
        const cy     = rect.height / 2;
        const rotX   = ((y - cy) / cy) * -8;
        const rotY   = ((x - cx) / cx) *  8;
        const shine  = `radial-gradient(circle at ${(x / rect.width * 100).toFixed(1)}% ${(y / rect.height * 100).toFixed(1)}%, rgba(255,255,255,0.12) 0%, transparent 60%)`;

        card.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.02)`;
        card.style.transition = 'transform 0.05s';
        card.dataset.shine = shine;

        // Shine overlay via pseudo — use inline style trick
        card.style.setProperty('--holo-shine', shine);
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
        card.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
        card.style.setProperty('--holo-shine', 'none');
      });
    });
  }

  // ──────────────────────────────────────────────
  // 3. CURSOR GLOW
  //    Spotlight that follows cursor
  // ──────────────────────────────────────────────

  // Stored listener references for cleanup
  let _cursorGlowMouseMove = null;
  let _cursorGlowMouseLeave = null;
  let _scrollHandler = null;

  function initCursorGlow() {
    // Only on non-touch devices
    if (window.matchMedia('(hover: none)').matches) return;

    const glow = document.createElement('div');
    glow.id = 'cursor-glow';
    glow.style.cssText = `
      position: fixed;
      width: 400px;
      height: 400px;
      pointer-events: none;
      z-index: 0;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%);
      transform: translate(-50%, -50%);
      transition: opacity 0.3s;
      opacity: 0;
      top: 0; left: 0;
    `;
    document.body.appendChild(glow);

    let visible = false;
    let rafId = null;
    let tx = 0, ty = 0, cx = 0, cy = 0;
    let animating = false;

    function lerp(a, b, t) { return a + (b - a) * t; }

    function loop() {
      cx = lerp(cx, tx, 0.12);
      cy = lerp(cy, ty, 0.12);
      glow.style.left = cx + 'px';
      glow.style.top  = cy + 'px';

      // Stop the loop when close enough to target (saves CPU when mouse is idle)
      if (Math.abs(cx - tx) > 0.5 || Math.abs(cy - ty) > 0.5) {
        rafId = requestAnimationFrame(loop);
      } else {
        animating = false;
      }
    }

    _cursorGlowMouseMove = e => {
      tx = e.clientX; ty = e.clientY;
      if (!visible) {
        visible = true;
        glow.style.opacity = '1';
        cx = tx; cy = ty; // snap on first show
      }
      // Start animation loop only if not already running
      if (!animating) {
        animating = true;
        rafId = requestAnimationFrame(loop);
      }
    };

    _cursorGlowMouseLeave = () => {
      visible = false;
      glow.style.opacity = '0';
      animating = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    };

    document.addEventListener('mousemove', _cursorGlowMouseMove);
    document.addEventListener('mouseleave', _cursorGlowMouseLeave);
  }

  // ──────────────────────────────────────────────
  // 4. SCROLL PROGRESS BAR
  // ──────────────────────────────────────────────

  function initScrollProgress() {
    const bar = document.createElement('div');
    bar.id = 'scroll-progress';

    // Always use position:fixed so bar is anchored to viewport bottom-of-header.
    // This avoids stacking-context / overflow issues that cause it to "float"
    // when the header changes state on scroll.
    const headerH = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-height') || '64', 10
    );
    bar.style.cssText = `
      position: fixed;
      top: ${headerH - 2}px;
      left: 0; right: 0;
      height: 3px;
      width: 0%;
      background: linear-gradient(90deg, var(--accent), var(--accent-2, #a855f7));
      z-index: 1001;
      transition: width 0.12s linear;
      border-radius: 0 3px 3px 0;
      box-shadow: 0 0 10px var(--accent-glow, rgba(99,102,241,0.6));
      pointer-events: none;
    `;

    document.body.appendChild(bar);

    _scrollHandler = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      const pct   = total > 0 ? (window.scrollY / total) * 100 : 0;
      bar.style.width = pct + '%';
    };

    window.addEventListener('scroll', _scrollHandler, { passive: true });
  }

  // ──────────────────────────────────────────────
  // 5. VIEW TRANSITIONS (page navigation)
  // ──────────────────────────────────────────────

  function initViewTransitions() {
    if (!document.startViewTransition) return;

    // Intercept same-origin links
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a) return;

      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('//')) return;
      if (a.target === '_blank') return;

      e.preventDefault();
      document.startViewTransition(() => {
        window.location.href = href;
      });
    });
  }

  // ──────────────────────────────────────────────
  // 6. STAT NUMBER COUNTER
  //    Animated count-up when element enters view
  // ──────────────────────────────────────────────

  function initCounters() {
    const counters = document.querySelectorAll('[data-count]');

    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el     = entry.target;
        const target = parseFloat(el.dataset.count);
        const prefix = el.dataset.prefix || '';
        const suffix = el.dataset.suffix || '';
        const decimals = el.dataset.decimals ? parseInt(el.dataset.decimals) : 0;
        const dur    = 1200;
        const start  = performance.now();

        function tick(now) {
          const t    = Math.min((now - start) / dur, 1);
          const ease = 1 - Math.pow(1 - t, 3);
          const val  = (target * ease).toFixed(decimals);
          el.textContent = prefix + val + suffix;
          if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        io.unobserve(el);
      });
    }, { threshold: 0.5 });

    counters.forEach(el => io.observe(el));
  }

  // ──────────────────────────────────────────────
  // 7. EXAM COUNTDOWN BADGES
  //    Renders live countdowns in header or sidebar
  // ──────────────────────────────────────────────

  function renderExamBadges(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !window.getExamCountdowns) return;

    const exams = window.getExamCountdowns();
    if (!exams.length) return;

    container.innerHTML = '';
    exams.forEach(exam => {
      const badge = document.createElement('div');
      badge.style.cssText = `
        display:flex; align-items:center; gap:8px;
        padding:8px 14px;
        background:${exam.urgent ? 'rgba(239,68,68,.1)' : 'var(--surface-2)'};
        border:1px solid ${exam.urgent ? 'rgba(239,68,68,.3)' : 'var(--border)'};
        border-radius:12px;
        font-size:.78rem; font-weight:600;
        color:${exam.urgent ? 'var(--danger)' : 'var(--fg-2)'};
        animation: fadeInDown .3s ease forwards;
      `;
      badge.innerHTML = `
        <span style="font-size:.9rem;">${exam.urgent ? '🔴' : '📅'}</span>
        <div>
          <div style="font-weight:700;font-size:.8rem;">${exam.name}</div>
          <div style="opacity:.75;font-size:.72rem;">
            ${exam.diff === 0 ? 'اليوم!' : exam.diff === 1 ? 'غداً!' : `بعد ${exam.diff} يوم`}
          </div>
        </div>
      `;
      container.appendChild(badge);
    });
  }

  // ──────────────────────────────────────────────
  // 8. NOISE TEXTURE OVERLAY
  //    Subtle grain for depth
  // ──────────────────────────────────────────────

  function initNoiseOverlay() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);

    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i]     = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 12; // very subtle
    }
    ctx.putImageData(img, 0, 0);

    const url = canvas.toDataURL();
    const style = document.createElement('style');
    style.textContent = `
      body::after {
        content: '';
        position: fixed;
        inset: 0;
        background-image: url('${url}');
        background-size: ${size}px;
        pointer-events: none;
        z-index: -1;
        opacity: .4;
        mix-blend-mode: overlay;
      }
    `;
    document.head.appendChild(style);
  }

  // ──────────────────────────────────────────────
  // 9. TYPING INDICATOR UPGRADE
  //    Thinking dots with "analyzing context" text
  // ──────────────────────────────────────────────

  const THINKING_LABELS = [
    'يحلل السياق...',
    'يراجع خطتك...',
    'يفكر...',
    'يستشير البيانات...',
    'يكتب الإجابة...',
  ];

  function startThinkingLabel(labelEl) {
    if (!labelEl) return;
    let i = 0;
    labelEl.textContent = THINKING_LABELS[0];
    const interval = setInterval(() => {
      i = (i + 1) % THINKING_LABELS.length;
      labelEl.textContent = THINKING_LABELS[i];
    }, 1200);
    return interval;
  }

  // ──────────────────────────────────────────────
  // 10. KEYBOARD SHORTCUTS
  // ──────────────────────────────────────────────

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      // Ctrl/Cmd + K is handled by ux.js CommandPalette — only handle on chat page
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        const chatInput = document.getElementById('chatInput');
        if (chatInput) { e.preventDefault(); chatInput.focus(); return; }
        // Otherwise let CommandPalette handle it
      }

      // Ctrl/Cmd + D → dashboard
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        if (document.body.dataset.page !== 'dashboard') {
          e.preventDefault();
          window.location.href = 'dashboard.html';
        }
      }

      // Escape → clear focus / close modals
      if (e.key === 'Escape') {
        document.activeElement?.blur();
      }
    });

    // Show shortcut hint
    const hint = document.createElement('div');
    hint.id = 'shortcut-hint';
    hint.style.cssText = `
      position:fixed; bottom:20px; right:20px;
      background:var(--surface); border:1px solid var(--border);
      padding:6px 12px; border-radius:10px;
      font-size:.72rem; color:var(--muted);
      z-index:9000; opacity:0;
      transition:opacity .3s;
      pointer-events:none;
    `;
    hint.innerHTML = '⌨️ <kbd style="background:var(--surface-2);padding:1px 5px;border-radius:4px;border:1px solid var(--border);">Ctrl+K</kbd> للمساعد الذكي';
    document.body.appendChild(hint);

    setTimeout(() => { hint.style.opacity = '1'; }, 2000);
    setTimeout(() => { hint.style.opacity = '0'; }, 6000);
  }

  // ──────────────────────────────────────────────
  // 11. SMART SEARCH (global, triggered by Ctrl+K)
  // ──────────────────────────────────────────────

  function initGlobalSearch() {
    // Only create the modal, not open it
    const modal = document.createElement('div');
    modal.id = 'global-search-modal';
    modal.style.cssText = `
      position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,.6);
      backdrop-filter:blur(8px);
      display:none; align-items:flex-start; justify-content:center;
      padding-top:80px;
    `;
    modal.innerHTML = `
      <div style="width:min(600px,90vw);background:var(--surface);border:1px solid var(--border-2);border-radius:20px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.4);">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">
          <span style="font-size:1.2rem;color:var(--muted);">🔍</span>
          <input id="global-search-input" type="text"
            placeholder="ابحث أو اسأل المساعد..."
            style="flex:1;border:none;background:transparent;font-size:1rem;font-weight:600;outline:none;color:var(--fg);" />
          <kbd style="background:var(--surface-2);padding:3px 8px;border-radius:6px;font-size:.72rem;color:var(--muted);border:1px solid var(--border);">Esc</kbd>
        </div>
        <div id="global-search-results" style="padding:8px;max-height:340px;overflow-y:auto;">
          <div style="padding:12px 16px;color:var(--muted);font-size:.85rem;text-align:center;">ابدأ الكتابة للبحث أو الانتقال...</div>
        </div>
        <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:16px;font-size:.72rem;color:var(--muted);">
          <span>↑↓ للتنقل</span>
          <span>⏎ للانتقال</span>
          <span>Esc للإغلاق</span>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const pages = [
      { icon: '📊', name: 'لوحة المعلومات', href: 'dashboard.html', kw: 'لوحة dashboard معدل' },
      { icon: '💬', name: 'الدردشة مع المساعد', href: 'chat.html', kw: 'دردشة chat مساعد' },
      { icon: '🧮', name: 'حاسبة المعدل', href: 'gpa.html', kw: 'معدل gpa حاسبة' },
      { icon: '📅', name: 'الخطة الدراسية', href: 'plan.html', kw: 'خطة plan جدول' },
      { icon: '📍', name: 'مواقع القاعات', href: 'locations.html', kw: 'قاعة موقع مبنى' },
      { icon: '👤', name: 'البروفايل الأكاديمي', href: 'profile.html', kw: 'بروفايل بيانات' },
    ];

    function renderResults(q) {
      const res = document.getElementById('global-search-results');
      if (!res) return;
      const filtered = q.trim()
        ? pages.filter(p => p.name.includes(q) || p.kw.includes(q))
        : pages;

      if (!filtered.length) {
        res.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);font-size:.85rem;">لا توجد نتائج. جرب كلمة أخرى.</div>`;
        return;
      }

      res.innerHTML = filtered.map((p, i) => `
        <a href="${p.href}" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;text-decoration:none;color:var(--fg);transition:background .15s;margin-bottom:2px;"
           onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='transparent'">
          <span style="font-size:1.2rem;width:28px;text-align:center;">${p.icon}</span>
          <span style="font-weight:600;font-size:.9rem;">${p.name}</span>
        </a>
      `).join('');
    }

    function open() {
      modal.style.display = 'flex';
      renderResults('');
      setTimeout(() => document.getElementById('global-search-input')?.focus(), 50);
    }

    function close() {
      modal.style.display = 'none';
    }

    document.getElementById('global-search-input')?.addEventListener('input', e => {
      renderResults(e.target.value);
    });

    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); open(); }
      if (e.key === 'Escape' && modal.style.display !== 'none') close();
    });
  }

  // ──────────────────────────────────────────────
  // 12. INIT ALL EFFECTS
  // ──────────────────────────────────────────────

  function initEffects(options = {}) {
    // Particle canvas (hero sections only)
    const heroCanvas = document.getElementById('particle-canvas');
    if (heroCanvas) {
      window.__particleField = new ParticleField(heroCanvas, {
        count: window.innerWidth < 768 ? 30 : 60,
        color: [99, 102, 241],
        opacity: 0.45,
        lineOpacity: 0.15,
      });
    }

    // Visual effects
    if (!options.noNoise)  initNoiseOverlay();
    if (!options.noGlow)   initCursorGlow();
    if (!options.noHolo)   initHoloCards();
    if (!options.noBar)    initScrollProgress();
    if (!options.noSearch) initGlobalSearch();
    if (!options.noKeys)   initKeyboardShortcuts();
    if (!options.noCount)  initCounters();

    // View Transitions (progressive enhancement)
    initViewTransitions();

    // Exam badges
    const examContainer = document.getElementById('exam-countdowns');
    if (examContainer) renderExamBadges('exam-countdowns');
  }

  // ──────────────────────────────────────────────
  // EXPOSE
  // ──────────────────────────────────────────────

  function destroyEffects() {
    if (_cursorGlowMouseMove)  { document.removeEventListener('mousemove', _cursorGlowMouseMove);  _cursorGlowMouseMove = null; }
    if (_cursorGlowMouseLeave) { document.removeEventListener('mouseleave', _cursorGlowMouseLeave); _cursorGlowMouseLeave = null; }
    if (_scrollHandler)        { window.removeEventListener('scroll', _scrollHandler);               _scrollHandler = null; }
    if (window.__particleField) { window.__particleField.destroy(); window.__particleField = null; }
  }

  window.UQUEffects = { init: initEffects, destroy: destroyEffects, ParticleField, renderExamBadges, startThinkingLabel };

  document.addEventListener('DOMContentLoaded', () => {
    initEffects();
  });


})(window);
