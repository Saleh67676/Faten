/**
 * ================================================================
 * UQU UX ENGINE v1.0
 * ================================================================
 *
 * MODULES:
 *  1. Skeleton — content placeholders during load
 *  2. Ripple — material-style press feedback
 *  3. CountUp — animated number reveal
 *  4. LazyLoad — IntersectionObserver-based image/section loader
 *  5. VirtualList — efficient rendering of 100+ plan sessions
 *  6. NotificationCenter — bell + panel + smart alerts
 *  7. CommandPalette — upgraded Ctrl+K with fuzzy search + actions
 *  8. StudyStreak — daily study tracking + streak display
 *  9. HeatMap — GitHub-style study activity calendar
 * 10. PWA — install banner + update prompt
 * 11. TransitionRouter — page-enter animations
 *
 * Everything is optional and self-contained. Pages opt in via
 * data-ux attributes or explicit calls. No required deps.
 * ================================================================
 */

(function (window, document) {
  'use strict';

  const D   = () => window.UQUCore?.D;
  const S   = () => window.UQUCore?.S ?? window.Utils?.Storage;
  const bus = () => window.UQUActions?.EventBus;

  // ──────────────────────────────────────────────
  // 1. SKELETON LOADER
  // ──────────────────────────────────────────────

  const Skeleton = {
    /**
     * Replace element content with animated skeleton.
     * @param {Element} el
     * @param {string} shape  'line' | 'block' | 'circle' | 'card'
     */
    show(el, shape, lines) {
      if (!el) return;
      el.dataset.skeletonOriginal = el.innerHTML;
      el.dataset.skeletonActive   = '1';

      const templates = {
        line:   '<div class="sk-line"></div>',
        block:  `<div class="sk-block">${'<div class="sk-line"></div>'.repeat(lines || 3)}</div>`,
        circle: '<div class="sk-circle"></div>',
        card:   `<div class="sk-card">
                   <div class="sk-circle" style="width:40px;height:40px;flex-shrink:0;"></div>
                   <div style="flex:1;">
                     <div class="sk-line" style="width:60%;margin-bottom:8px;"></div>
                     <div class="sk-line" style="width:85%;"></div>
                   </div>
                 </div>`,
        stat:   `<div class="sk-line sk-stat-num"></div>
                 <div class="sk-line" style="width:70%;margin-top:8px;"></div>`,
        row:    '<div class="sk-row"><div class="sk-line"></div><div class="sk-line"></div><div class="sk-line"></div></div>'
      };

      el.innerHTML = templates[shape || 'block'] || templates.block;
    },

    /** Restore original content and trigger fade-in. */
    hide(el, newContent) {
      if (!el || !el.dataset.skeletonActive) return;
      delete el.dataset.skeletonActive;

      const content = newContent ?? el.dataset.skeletonOriginal ?? '';
      delete el.dataset.skeletonOriginal;

      el.style.opacity = '0';
      el.innerHTML = content;
      requestAnimationFrame(() => {
        el.style.transition = 'opacity .35s ease';
        el.style.opacity    = '1';
      });
    },

    /** Apply skeleton to all [data-skeleton] elements. */
    initPage() {
      document.querySelectorAll('[data-skeleton]').forEach(el => {
        this.show(el, el.dataset.skeleton);
      });
    },

    /** Hydrate skeleton elements once data is ready. */
    hydrate(selector, renderFn) {
      document.querySelectorAll(selector).forEach(el => {
        const html = renderFn(el);
        this.hide(el, html);
      });
    }
  };

  // ──────────────────────────────────────────────
  // 2. RIPPLE EFFECT
  // ──────────────────────────────────────────────

  function initRipple() {
    function createRipple(e) {
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.5;
      const x    = (e.clientX || rect.left + rect.width / 2)  - rect.left - size / 2;
      const y    = (e.clientY || rect.top  + rect.height / 2) - rect.top  - size / 2;

      const ripple = document.createElement('span');
      ripple.className = 'ux-ripple';
      ripple.style.cssText = `
        width:${size}px;height:${size}px;
        left:${x}px;top:${y}px;
      `;

      // Clean up position style on parent
      const pos = getComputedStyle(el).position;
      if (pos === 'static') el.style.position = 'relative';
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }

    // Attach to all interactive elements
    const ripplable = '.btn-primary, .btn-ghost, .btn-danger, .card[data-ripple], .nav a, .suggestion-pill';
    document.querySelectorAll(ripplable).forEach(el => {
      el.style.overflow = 'hidden';
      el.addEventListener('click', createRipple);
    });

    // MutationObserver for dynamically added elements
    new MutationObserver(mutations => {
      mutations.forEach(m => m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        node.querySelectorAll?.(ripplable).forEach(el => {
          if (el.dataset.rippleInit) return;
          el.dataset.rippleInit = '1';
          el.style.overflow = 'hidden';
          el.addEventListener('click', createRipple);
        });
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ──────────────────────────────────────────────
  // 3. COUNT-UP ANIMATION
  // ──────────────────────────────────────────────

  function initCountUp() {
    function animate(el) {
      const target   = parseFloat(el.dataset.countup || el.textContent.replace(/[^0-9.\-]/g,''));
      if (!Number.isFinite(target)) return; // skip when value not yet bound
      const decimals = el.dataset.decimals ? parseInt(el.dataset.decimals) : (target % 1 !== 0 ? 2 : 0);
      const suffix   = el.dataset.suffix   || '';
      const prefix   = el.dataset.prefix   || '';
      const dur      = parseInt(el.dataset.dur) || 1000;
      const start    = performance.now();
      el.dataset.cuDone = '1';

      function tick(now) {
        const t   = Math.min((now - start) / dur, 1);
        const ease = 1 - Math.pow(1 - t, 4); // easeOutQuart
        el.textContent = prefix + (target * ease).toFixed(decimals) + suffix;
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    const io = new IntersectionObserver(entries => {
      entries.forEach(({ isIntersecting, target: el }) => {
        if (!isIntersecting) return;
        if (el.dataset.cuDone) { io.unobserve(el); return; }
        const text = el.textContent.trim();
        if (!text || /^[—\-]+$/.test(text)) return; // wait until bound
        io.unobserve(el);
        animate(el);
      });
    }, { threshold: 0.4 });

    function observeAll() {
      document.querySelectorAll('.stat, [data-countup]').forEach(el => {
        if (el.dataset.cuDone) return;
        io.observe(el);
      });
    }

    // Defer IO observation so data binders (DashboardController, etc.) get
    // a chance to set the real value before count-up snapshots the placeholder.
    setTimeout(observeAll, 250);
    // Re-trigger when DashboardController (or anything else) updates the text
    const mo = new MutationObserver(muts => {
      muts.forEach(m => {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!el || el.dataset.cuDone) return;
        if (!el.matches('.stat, [data-countup]')) return;
        const text = el.textContent.trim();
        if (!text || /^[—\-]+$/.test(text)) return;
        animate(el);
      });
    });
    document.querySelectorAll('.stat, [data-countup]').forEach(el => {
      mo.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  // ──────────────────────────────────────────────
  // 4. LAZY LOAD
  // ──────────────────────────────────────────────

  function initLazyLoad() {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(({ isIntersecting, target }) => {
        if (!isIntersecting) return;
        const src = target.dataset.src;
        if (src) { target.src = src; delete target.dataset.src; }
        const fn  = target.dataset.lazyFn;
        if (fn && window[fn]) { window[fn](target); delete target.dataset.lazyFn; }
        obs.unobserve(target);
      });
    }, { rootMargin: '200px' });

    document.querySelectorAll('[data-src], [data-lazy-fn]').forEach(el => io.observe(el));
  }

  // ──────────────────────────────────────────────
  // 5. VIRTUAL LIST (for plan sessions)
  // ──────────────────────────────────────────────

  const VirtualList = {
    create({ container, items, itemHeight, renderItem, overscan }) {
      if (!container || !items.length) return null;

      overscan    = overscan   || 5;
      itemHeight  = itemHeight || 80;
      const total = items.length;
      const inner = document.createElement('div');
      inner.style.cssText = `position:relative;height:${total * itemHeight}px;`;
      container.innerHTML = '';
      container.style.cssText = 'overflow-y:auto;position:relative;';
      container.appendChild(inner);

      let rendered = new Map();
      let lastStart = -1, lastEnd = -1;

      function render() {
        const scrollTop = container.scrollTop;
        const height    = container.clientHeight;
        let start = Math.floor(scrollTop / itemHeight) - overscan;
        let end   = Math.ceil((scrollTop + height) / itemHeight) + overscan;
        start = Math.max(0, start);
        end   = Math.min(total - 1, end);

        if (start === lastStart && end === lastEnd) return;
        lastStart = start; lastEnd = end;

        // Remove out-of-view
        rendered.forEach((node, i) => {
          if (i < start || i > end) { node.remove(); rendered.delete(i); }
        });

        // Add new items
        for (let i = start; i <= end; i++) {
          if (rendered.has(i)) continue;
          const node = document.createElement('div');
          node.style.cssText = `position:absolute;top:${i * itemHeight}px;left:0;right:0;height:${itemHeight}px;padding:4px 0;`;
          node.innerHTML = renderItem(items[i], i);
          inner.appendChild(node);
          rendered.set(i, node);
        }
      }

      container.addEventListener('scroll', () => requestAnimationFrame(render), { passive: true });
      render();

      return {
        refresh(newItems) {
          items = newItems;
          inner.style.height = `${items.length * itemHeight}px`;
          rendered.forEach(n => n.remove()); rendered.clear();
          lastStart = -1; lastEnd = -1;
          render();
        }
      };
    }
  };

  // ──────────────────────────────────────────────
  // 6. NOTIFICATION CENTER
  // ──────────────────────────────────────────────

  const NotificationCenter = {
    _items: [],
    _bell:  null,
    _panel: null,
    _badge: null,

    init() {
      this._loadStored();
      this._buildUI();
      this._generateSmartAlerts();

      // Re-generate on profile change
      bus()?.on('profile:updated', () => this._generateSmartAlerts());
      bus()?.on('plan:generated',  () => this._generateSmartAlerts());
    },

    _loadStored() {
      const _S = S();
      this._items = _S?.get('uqu_notifications', []) ?? [];
    },

    _save() {
      S()?.set('uqu_notifications', this._items.slice(0, 50));
    },

    push(item) {
      const note = {
        id:    `n_${Date.now()}`,
        ts:    Date.now(),
        read:  false,
        type:  item.type  || 'info',    // 'info' | 'warning' | 'success' | 'danger'
        icon:  item.icon  || '🔔',
        title: item.title || '',
        body:  item.body  || '',
        href:  item.href  || null
      };
      this._items.unshift(note);
      this._save();
      this._updateBadge();
      this._toastNotif(note);
      return note;
    },

    markAllRead() {
      this._items.forEach(n => n.read = true);
      this._save();
      this._updateBadge();
      this._renderPanel();
    },

    _unreadCount() { return this._items.filter(n => !n.read).length; },

    _updateBadge() {
      if (!this._badge) return;
      const c = this._unreadCount();
      this._badge.textContent = c > 9 ? '9+' : c;
      this._badge.style.display = c ? 'flex' : 'none';
    },

    _toastNotif(note) {
      const fn = window.UQUCore?.toast ?? window.__ui?.showToast;
      if (fn) fn(note.icon + ' ' + note.title, note.type, 4000);
    },

    _generateSmartAlerts() {
      const profile = window.UQUCore?.getProfile?.() ?? S()?.get('uqu_profile_v2', null);
      if (!profile) return;

      const added = new Set(this._items.map(n => n._key).filter(Boolean));

      // Exam alerts
      const exams = window.UQUEngine?.getUpcomingExamsFromProfile?.(profile, 7) ?? [];
      exams.forEach(c => {
        const key = `exam_${c.name}_${c.examDate}`;
        if (added.has(key)) return;
        const days = c.daysLeft;
        if (days < 0) return;
        this.push({
          type:  days <= 2 ? 'danger' : 'warning',
          icon:  days <= 2 ? '🚨' : '⏰',
          title: `اختبار ${c.name} ${days === 0 ? 'اليوم!' : days === 1 ? 'غداً!' : `بعد ${days} أيام`}`,
          body:  `تأكد أن لديك جلسات مذاكرة كافية في الخطة.`,
          href:  'plan.html',
          _key:  key
        });
        this._items[0]._key = key;
        this._save();
      });

      // GPA alert: far from target
      const goals = profile.goals || {};
      if (goals.currentGpa && goals.targetGpa) {
        const diff = parseFloat(goals.targetGpa) - parseFloat(goals.currentGpa);
        if (diff > 0.5) {
          const key = 'gpa_gap_alert';
          if (!added.has(key)) {
            this.push({
              type: 'info', icon: '📈',
              title: `معدلك الحالي بعيد عن الهدف بـ ${diff.toFixed(2)} نقطة`,
              body:  'يمكنك استخدام حاسبة المعدل لمعرفة الدرجات المطلوبة.',
              href:  'gpa.html',
              _key:  key
            });
            this._items[0]._key = key;
            this._save();
          }
        }
      }

      this._updateBadge();
    },

    _buildUI() {
      // Bell button → inject into .header-actions
      // Skip if auth.js or another module has already injected a notification trigger
      const actions = document.querySelector('.header-actions');
      if (!actions) return;
      if (actions.querySelector('.notif-trigger, .notif-bell')) return;

      const bell = document.createElement('div');
      bell.style.cssText = 'position:relative;display:inline-flex;';
      bell.innerHTML = `
        <button class="btn-ghost notif-bell" aria-label="الإشعارات" title="الإشعارات"
          style="font-size:1.1rem;position:relative;">
          🔔
        </button>
        <span class="notif-badge" style="
          position:absolute;top:2px;right:2px;
          min-width:16px;height:16px;padding:0 4px;
          background:var(--danger);color:#fff;
          border-radius:50px;font-size:.62rem;font-weight:800;
          display:none;align-items:center;justify-content:center;
          pointer-events:none;line-height:1;
        ">0</span>
      `;
      actions.prepend(bell);
      this._bell  = bell.querySelector('.notif-bell');
      this._badge = bell.querySelector('.notif-badge');

      // Panel
      const panel = document.createElement('div');
      panel.className = 'notif-panel';
      panel.style.cssText = `
        position:fixed;top:68px;right:max(12px, calc((100vw - 1200px)/2 + 12px));
        width:min(380px,calc(100vw - 24px));
        background:var(--surface);border:1px solid var(--border-2);
        border-radius:20px;box-shadow:0 32px 80px rgba(0,0,0,.35);
        z-index:9995;display:none;overflow:hidden;
        animation:notifPanelIn .25s cubic-bezier(0.34,1.56,0.64,1) forwards;
      `;
      panel.innerHTML = `
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);
          display:flex;align-items:center;justify-content:space-between;">
          <div style="font-weight:800;font-size:1rem;">الإشعارات</div>
          <button class="notif-read-all btn-ghost" style="font-size:.78rem;padding:4px 10px;">
            تحديد الكل كمقروء
          </button>
        </div>
        <div class="notif-list" style="max-height:400px;overflow-y:auto;padding:8px;"></div>
      `;
      document.body.appendChild(panel);
      this._panel = panel;

      this._bell.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });
      panel.querySelector('.notif-read-all').addEventListener('click', () => this.markAllRead());
      document.addEventListener('click', e => {
        if (!panel.contains(e.target) && e.target !== this._bell) this._close();
      });

      this._updateBadge();
    },

    _toggle() {
      if (this._panel.style.display === 'none' || !this._panel.style.display) {
        this._open();
      } else {
        this._close();
      }
    },

    _open() {
      this._renderPanel();
      this._panel.style.display = 'block';
      // Mark visible ones as read after 1.5s
      setTimeout(() => {
        const visible = this._items.filter(n => !n.read).slice(0, 5);
        visible.forEach(n => n.read = true);
        this._save();
        this._updateBadge();
      }, 1500);
    },

    _close() {
      this._panel.style.display = 'none';
    },

    _renderPanel() {
      const list = this._panel.querySelector('.notif-list');
      if (!list) return;

      if (!this._items.length) {
        list.innerHTML = `<div style="padding:32px 20px;text-align:center;color:var(--muted);font-size:.88rem;">
          🎉 لا توجد إشعارات جديدة
        </div>`;
        return;
      }

      const colors = { danger: '#ef4444', warning: '#f59e0b', success: '#10b981', info: '#6366f1' };
      list.innerHTML = this._items.slice(0, 20).map(n => `
        <a href="${n.href || '#'}"
          style="display:flex;gap:12px;padding:12px;border-radius:12px;text-decoration:none;
            color:var(--fg);transition:background .15s;margin-bottom:2px;
            background:${n.read ? 'transparent' : 'rgba(99,102,241,.06)'};
            border:1px solid ${n.read ? 'transparent' : 'rgba(99,102,241,.12)'};"
          onmouseover="this.style.background='var(--surface-2)'"
          onmouseout="this.style.background='${n.read ? 'transparent' : 'rgba(99,102,241,.06)'}'">
          <span style="font-size:1.4rem;flex-shrink:0;line-height:1.2;">${n.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:${n.read ? '600' : '700'};font-size:.85rem;margin-bottom:3px;
              color:${n.read ? 'var(--fg)' : colors[n.type] || 'var(--accent)'};">
              ${n.title}
            </div>
            <div style="color:var(--muted);font-size:.75rem;line-height:1.4;">${n.body}</div>
            <div style="color:var(--muted);font-size:.7rem;margin-top:4px;">
              ${_timeAgo(n.ts)}
            </div>
          </div>
          ${!n.read ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:5px;"></span>' : ''}
        </a>
      `).join('');
    }
  };

  function _timeAgo(ts) {
    const mins  = Math.floor((Date.now() - ts) / 60000);
    if (mins < 2)   return 'الآن';
    if (mins < 60)  return `منذ ${mins} دقيقة`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)   return `منذ ${hrs} ساعة`;
    const days = Math.floor(hrs / 24);
    return `منذ ${days} يوم`;
  }

  // ──────────────────────────────────────────────
  // 7. COMMAND PALETTE v2 (upgraded from effects.js)
  // ──────────────────────────────────────────────

  const CommandPalette = {
    _modal: null,
    _input: null,
    _results: null,
    _selected: 0,
    _items: [],

    _pages: [
      { icon: '📊', name: 'لوحة المعلومات',   href: 'dashboard.html', tags: 'لوحة dashboard معدل تقرير' },
      { icon: '💬', name: 'المساعد الذكي',     href: 'chat.html',      tags: 'دردشة chat مساعد سؤال' },
      { icon: '🧮', name: 'حاسبة المعدل',      href: 'gpa.html',       tags: 'معدل gpa حاسبة درجات' },
      { icon: '📅', name: 'الخطة الدراسية',    href: 'plan.html',      tags: 'خطة plan جدول مذاكرة' },
      { icon: '📍', name: 'مواقع القاعات',     href: 'locations.html', tags: 'قاعة موقع مبنى رقم' },
      { icon: '👤', name: 'البروفايل الأكاديمي', href: 'profile.html', tags: 'بروفايل بيانات مواد أهداف' },
    ],

    init() {
      this._build();
      document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); this.open(); }
        if (e.key === 'Escape' && this._modal?.style.display !== 'none') this.close();
        if (this._modal?.style.display !== 'none') {
          if (e.key === 'ArrowDown') { e.preventDefault(); this._move(1); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); this._move(-1); }
          if (e.key === 'Enter')     { e.preventDefault(); this._confirm(); }
        }
      });
    },

    _build() {
      // Remove existing modal from effects.js if present
      document.getElementById('global-search-modal')?.remove();

      const modal = document.createElement('div');
      modal.id = 'ux-palette';
      modal.style.cssText = `
        position:fixed;inset:0;z-index:10000;
        background:rgba(5,5,20,.75);backdrop-filter:blur(10px);
        display:none;align-items:flex-start;justify-content:center;
        padding-top:clamp(60px,10vh,100px);
      `;
      modal.innerHTML = `
        <div class="palette-box" style="
          width:min(600px,92vw);
          background:var(--surface);border:1px solid var(--border-2);
          border-radius:20px;overflow:hidden;
          box-shadow:0 40px 100px rgba(0,0,0,.5);
          animation:paletteIn .2s cubic-bezier(0.34,1.56,0.64,1);
        ">
          <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);">
            <span style="font-size:1rem;color:var(--muted);">🔍</span>
            <input id="ux-palette-input" type="text" autocomplete="off" spellcheck="false"
              placeholder="ابحث أو انتقل… (مثل: خطة، معدل، دردشة)"
              style="flex:1;border:none;background:transparent;font-size:.95rem;font-weight:600;
                outline:none;color:var(--fg);font-family:inherit;" />
            <kbd style="background:var(--surface-2);padding:3px 8px;border-radius:6px;
              font-size:.7rem;color:var(--muted);border:1px solid var(--border);white-space:nowrap;">Esc</kbd>
          </div>

          <div id="ux-palette-results" style="padding:8px;max-height:380px;overflow-y:auto;"></div>

          <div style="padding:10px 18px;border-top:1px solid var(--border);
            display:flex;gap:16px;font-size:.72rem;color:var(--muted);flex-wrap:wrap;">
            <span>↑↓ تنقل</span>
            <span>⏎ انتقال</span>
            <span>Esc إغلاق</span>
            <span style="margin-right:auto;">⌘K فتح</span>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      this._modal   = modal;
      this._input   = modal.querySelector('#ux-palette-input');
      this._results = modal.querySelector('#ux-palette-results');

      this._input.addEventListener('input',  () => this._render(this._input.value));
      modal.addEventListener('click', e => { if (e.target === modal) this.close(); });
    },

    open() {
      this._modal.style.display = 'flex';
      this._input.value = '';
      this._render('');
      setTimeout(() => this._input.focus(), 30);
    },

    close() {
      this._modal.style.display = 'none';
    },

    _render(q) {
      const profile = window.UQUCore?.getProfile?.();
      const courses = profile?.courses ?? [];

      // Build items list
      const items = [];

      // Page navigation
      const pages = q.trim()
        ? this._pages.filter(p =>
            p.name.includes(q) || p.tags.includes(q) ||
            p.href.includes(q.toLowerCase()))
        : this._pages;
      pages.forEach(p => items.push({ type: 'nav', ...p }));

      // Course quick-jump (if profile loaded)
      if (courses.length && q.trim()) {
        courses
          .filter(c => c.name?.includes(q))
          .slice(0, 3)
          .forEach(c => items.push({
            type: 'course',
            icon: '📚',
            name: c.name,
            href: `gpa.html`,
            tags: c.name,
            meta: `${c.creditHours || '?'} ساعة · ${c.difficulty || 'متوسط'}`
          }));
      }

      // Action items
      const actions = [
        { icon: '🔄', name: 'إنشاء خطة دراسية جديدة', action: 'generatePlan',     tags: 'خطة جديدة توليد' },
        { icon: '💾', name: 'تصدير بياناتي',           action: 'exportData',        tags: 'تصدير حفظ export' },
        { icon: '🌙', name: 'تغيير الوضع الليلي/النهاري',action: 'toggleTheme',    tags: 'ليلي نهاري theme وضع' },
        { icon: '🔔', name: 'فتح الإشعارات',           action: 'openNotifications', tags: 'اشعارات notification' },
        { icon: '📤', name: 'تثبيت التطبيق',           action: 'installPWA',        tags: 'تثبيت pwa تطبيق' },
      ];

      if (q.trim()) {
        actions.filter(a => a.name.includes(q) || a.tags.includes(q))
          .forEach(a => items.push({ type: 'action', ...a }));
      }

      this._items = items;
      this._selected = 0;

      if (!items.length) {
        this._results.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:.88rem;">
          لا نتائج لـ "${q}". جرّب كلمة أخرى.
        </div>`;
        return;
      }

      this._results.innerHTML = items.map((item, i) => `
        <div class="palette-item" data-idx="${i}" data-href="${item.href || ''}" data-action="${item.action || ''}"
          style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;
            cursor:pointer;transition:background .12s;margin-bottom:2px;
            background:${i === 0 ? 'var(--surface-2)' : 'transparent'};"
          onmouseover="this.style.background='var(--surface-2)'"
          onmouseout="this.style.background='${i===0?'var(--surface-2)':'transparent'}'"
          onclick="window.__palette?.select(${i})">
          <span style="font-size:1.2rem;width:28px;text-align:center;flex-shrink:0;">${item.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:.88rem;">${item.name}</div>
            ${item.meta ? `<div style="color:var(--muted);font-size:.75rem;">${item.meta}</div>` : ''}
          </div>
          <span style="font-size:.7rem;color:var(--muted);background:var(--bg);
            padding:2px 8px;border-radius:6px;border:1px solid var(--border);">
            ${item.type === 'action' ? 'أمر' : item.type === 'course' ? 'مادة' : 'صفحة'}
          </span>
        </div>
      `).join('');
    },

    _move(dir) {
      this._selected = Math.max(0, Math.min(this._items.length - 1, this._selected + dir));
      this._results.querySelectorAll('.palette-item').forEach((el, i) => {
        el.style.background = i === this._selected ? 'var(--surface-2)' : 'transparent';
        if (i === this._selected) el.scrollIntoView({ block: 'nearest' });
      });
    },

    _confirm() {
      this.select(this._selected);
    },

    select(idx) {
      const item = this._items[idx];
      if (!item) return;
      this.close();

      if (item.href) { window.location.href = item.href; return; }
      if (item.action) {
        switch (item.action) {
          case 'generatePlan':
            window.UQUActions?.generatePlanFromProfile?.();
            window.UQUCore?.toast('تم توليد الخطة ✅', 'success');
            break;
          case 'exportData':
            const data = window.UQUModel?.export?.() ?? '{}';
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
            a.download = 'uqu-data.json'; a.click();
            break;
          case 'toggleTheme':
            window.UQUCore?.Theme.toggle();
            break;
          case 'openNotifications':
            window.UQUNotifications?._toggle();
            break;
          case 'installPWA':
            window.__pwaInstallPrompt?.prompt();
            break;
        }
      }
    }
  };

  window.__palette = CommandPalette;

  // ──────────────────────────────────────────────
  // 8. STUDY STREAK TRACKER
  // ──────────────────────────────────────────────

  const StudyStreak = {
    KEY: 'uqu_streak',

    tick() {
      const _S  = S();
      if (!_S) return;
      const _D = D();
      const safeISO = (d) => {
        if (_D && _D.toISO) return _D.toISO(d);
        if (!d) return null;
        const dt = d instanceof Date ? d : new Date(d);
        if (isNaN(dt)) return null;
        return dt.toISOString().split('T')[0];
      };
      const today = safeISO(new Date());
      if (!today) return;
      const data  = _S.get(this.KEY, { lastDay: null, streak: 0, total: 0, days: [] });

      if (data.lastDay === today) return data;

      const yesterday = safeISO(new Date(Date.now() - 86400000));

      data.streak  = data.lastDay === yesterday ? data.streak + 1 : 1;
      data.total   = (data.total || 0) + 1;
      data.lastDay = today;
      data.days    = [...(data.days || []).slice(-90), today];

      _S.set(this.KEY, data);
      return data;
    },

    get() {
      return S()?.get(this.KEY, { streak: 0, total: 0, days: [] }) ?? { streak: 0, total: 0, days: [] };
    },

    renderBadge(el) {
      if (!el) return;
      const data = this.get();
      el.innerHTML = `
        <span style="font-size:1.1rem;">🔥</span>
        <span style="font-weight:800;">${data.streak}</span>
        <span style="font-size:.78rem;color:var(--muted);">يوم متتالي</span>
      `;
      el.style.cssText = 'display:flex;align-items:center;gap:6px;';
      if (data.streak >= 7) {
        el.title = '🏆 أسبوع كامل! مذهل!';
        el.style.color = 'var(--warning)';
      }
    }
  };

  // ──────────────────────────────────────────────
  // 9. STUDY HEATMAP (GitHub-style calendar)
  // ──────────────────────────────────────────────

  const HeatMap = {
    render(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const plan = window.UQUCore?.getPlan?.() ?? S()?.get('uqu_plan_v5', null);
      const streak = S()?.get('uqu_streak', { days: [] });

      // Count sessions per day in last 84 days (12 weeks)
      const counts = {};
      (plan?.plan ?? []).forEach(s => { if (s.date) counts[s.date] = (counts[s.date]||0)+1; });
      (streak?.days ?? []).forEach(d => { counts[d] = Math.max(counts[d]||0, 1); });

      const today = new Date(); today.setHours(0,0,0,0);
      const start = new Date(today); start.setDate(start.getDate() - 83);

      const cells = [];
      for (let i = 0; i < 84; i++) {
        const d   = new Date(start); d.setDate(start.getDate() + i);
        const iso = d.toISOString().split('T')[0];
        cells.push({ iso, count: counts[iso] || 0 });
      }

      const totalSessions = cells.reduce((sum, c) => sum + c.count, 0);
      const maxCount = Math.max(1, ...cells.map(c => c.count));
      const intensity = c => {
        if (!c) return 0;
        return Math.ceil((c / maxCount) * 4);
      };

      // Empty state: no study sessions recorded yet
      if (totalSessions === 0) {
        container.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
            padding:28px 16px;gap:10px;text-align:center;">
            <div style="font-size:2rem;opacity:.35;">📅</div>
            <div style="font-size:.85rem;font-weight:700;color:var(--muted);">لا توجد جلسات مذاكرة مسجلة بعد</div>
            <div style="font-size:.78rem;color:var(--muted);opacity:.8;">ابدأ المذاكرة اليوم وستظهر بياناتك هنا تلقائياً!</div>
          </div>
        `;
        return;
      }

      const weeks = [];
      for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i+7));

      container.innerHTML = `
        <div class="heatmap-wrap" style="overflow-x:auto;">
          <div style="display:flex;gap:3px;padding:4px 0;">
            ${weeks.map(week => `
              <div style="display:flex;flex-direction:column;gap:3px;">
                ${week.map(cell => `
                  <div class="heat-cell heat-${intensity(cell.count)}"
                    title="${cell.iso}: ${cell.count} جلسة"
                    style="width:11px;height:11px;border-radius:2px;flex-shrink:0;
                      cursor:default;transition:transform .1s;"
                    onmouseover="this.style.transform='scale(1.6)'"
                    onmouseout="this.style.transform=''">
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:.72rem;color:var(--muted);">
            <span>أقل</span>
            ${[0,1,2,3,4].map(l => `<div class="heat-cell heat-${l}" style="width:11px;height:11px;border-radius:2px;"></div>`).join('')}
            <span>أكثر</span>
            <span style="margin-right:auto;">آخر 12 أسبوع</span>
          </div>
        </div>
      `;
    }
  };

  // ──────────────────────────────────────────────
  // 10. PWA INSTALL BANNER
  // ──────────────────────────────────────────────

  function initPWABanner() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      window.__pwaInstallPrompt = e;

      // Only show once every 3 days
      const shown = S()?.get('pwa_banner_shown', 0) ?? 0;
      if (Date.now() - shown < 3 * 86400000) return;

      const banner = document.createElement('div');
      banner.id = 'pwa-banner';
      banner.style.cssText = `
        position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);
        z-index:9990;
        display:flex;align-items:center;gap:14px;
        background:var(--surface);border:1px solid var(--border-2);
        padding:14px 20px;border-radius:18px;
        box-shadow:0 20px 60px rgba(0,0,0,.35);
        font-size:.88rem;font-weight:600;
        animation:bannerIn .5s .5s cubic-bezier(0.34,1.56,0.64,1) forwards;
        max-width:min(440px,calc(100vw - 32px));
        white-space:nowrap;
      `;
      banner.innerHTML = `
        <span style="font-size:1.4rem;">📱</span>
        <span style="white-space:normal;line-height:1.4;">
          <strong>ثبّت التطبيق</strong> على جهازك للوصول بدون إنترنت
        </span>
        <button id="pwa-install-btn"
          style="padding:8px 16px;border-radius:10px;border:none;
          background:var(--accent);color:#fff;font-family:inherit;
          font-weight:800;cursor:pointer;font-size:.85rem;flex-shrink:0;">
          تثبيت
        </button>
        <button id="pwa-dismiss-btn"
          style="padding:8px;border-radius:10px;border:none;
          background:transparent;color:var(--muted);cursor:pointer;font-size:1rem;">
          ✕
        </button>
      `;
      document.body.appendChild(banner);

      banner.querySelector('#pwa-install-btn').addEventListener('click', () => {
        e.prompt();
        e.userChoice.then(() => banner.remove());
      });
      banner.querySelector('#pwa-dismiss-btn').addEventListener('click', () => {
        banner.remove();
        S()?.set('pwa_banner_shown', Date.now());
      });
    });

    // Show "app updated" if SW updated
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(reg => {
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              window.UQUCore?.toast('🔄 تحديث جديد متاح — أعد تحميل الصفحة', 'info', 8000);
            }
          });
        });
      });
    }
  }

  // ──────────────────────────────────────────────
  // 11. PAGE ENTER ANIMATION
  // ──────────────────────────────────────────────

  function initPageEnter() {
    const main = document.querySelector('.app-main');
    if (!main) return;
    const reduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      // Skip the fade entirely — leave defaults so content is visible.
      main.style.opacity = '1';
      main.style.transform = 'none';
      return;
    }
    main.style.opacity = '0';
    main.style.transform = 'translateY(12px)';
    main.style.transition = 'opacity .45s ease, transform .45s ease';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        main.style.opacity   = '1';
        main.style.transform = 'translateY(0)';
      });
    });
  }

  // ──────────────────────────────────────────────
  // 12. SMART DASHBOARD SKELETONS
  //    Auto-detect skeleton containers and hydrate them
  // ──────────────────────────────────────────────

  function initDashboardSkeletons() {
    if (document.body.dataset.page !== 'dashboard') return;

    // Reserve space so layout doesn't jump while data loads,
    // but DO NOT replace innerHTML — the skeleton template was racing
    // DashboardController's text writes and clobbering the bound value.
    const statEls = document.querySelectorAll('.stat');
    statEls.forEach(el => {
      el.style.minWidth = '80px';
      el.style.minHeight = '40px';
    });
  }

  // ──────────────────────────────────────────────
  // 13. BUTTON PRESS FEEDBACK
  // ──────────────────────────────────────────────

  function initButtonPress() {
    document.addEventListener('mousedown', e => {
      const btn = e.target.closest('button, .btn-primary, .btn-ghost');
      if (!btn) return;
      btn.style.transform = 'scale(0.96)';
      btn.style.transition = 'transform .1s';
    });
    document.addEventListener('mouseup', e => {
      const btn = e.target.closest('button, .btn-primary, .btn-ghost');
      if (!btn) return;
      btn.style.transform = '';
    });
  }

  // ──────────────────────────────────────────────
  // 14. PROGRESSIVE IMAGE LOAD
  //    Blur-up technique for any img[data-src]
  // ──────────────────────────────────────────────

  function initProgressiveImages() {
    document.querySelectorAll('img[data-src]').forEach(img => {
      img.style.filter    = 'blur(20px)';
      img.style.transition = 'filter .4s ease';
      const real = new Image();
      real.onload = () => {
        img.src    = real.src;
        img.style.filter = 'none';
      };
      real.src = img.dataset.src;
    });
  }

  // ──────────────────────────────────────────────
  // EXPOSE & INIT
  // ──────────────────────────────────────────────

  const UQUX = {
    Skeleton,
    VirtualList,
    NotificationCenter,
    CommandPalette,
    StudyStreak,
    HeatMap,

    init(opts) {
      const o = opts || {};

      initPageEnter();
      // Reveal .animate-block elements (dashboard cards, sections, etc.).
      // Without this, every .animate-block stays at opacity:0 forever.
      if (!o.noReveal && window.UQUCore?.observeReveal) {
        try { window.UQUCore.observeReveal(); } catch (_) { }
      }
      if (!o.noRipple)    initRipple();
      if (!o.noCountUp)   initCountUp();
      if (!o.noLazy)      initLazyLoad();
      if (!o.noPress)     initButtonPress();
      if (!o.noImages)    initProgressiveImages();
      if (!o.noPWA)       initPWABanner();

      // Notification center — initialize ux.js version but don't
      // overwrite window.UQUNotifications if notifications.js already set it
      NotificationCenter.init();
      if (!window.UQUNotifications) window.UQUNotifications = NotificationCenter;

      // Command palette (replaces effects.js version)
      CommandPalette.init();

      // Streak tick
      StudyStreak.tick();

      // Render streak badge if element exists
      StudyStreak.renderBadge(document.getElementById('streak-badge'));

      // Heatmap (dashboard only)
      HeatMap.render('study-heatmap');

      // Dashboard skeleton states
      initDashboardSkeletons();

      // Keyboard shortcut hint
      const hint = document.getElementById('shortcut-hint');
      if (hint) {
        setTimeout(() => hint.style.opacity = '1', 2000);
        setTimeout(() => hint.style.opacity = '0', 7000);
      }
    }
  };

  window.UQUX = UQUX;

  document.addEventListener('DOMContentLoaded', () => UQUX.init());


})(window, document);
