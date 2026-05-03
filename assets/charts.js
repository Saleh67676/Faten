/**
 * ================================================================
 * UQU CHARTS v1.0 — Smooth Canvas Charts
 * ================================================================
 * Line chart · Bar chart · Ring/Donut · Sparkline
 * All with requestAnimationFrame animation + resize observer
 * ================================================================
 */

(function (window) {
  'use strict';

  // ──────────────────────────────────────────────
  // THEME TOKENS
  // ──────────────────────────────────────────────

  function getTheme() {
    const style = getComputedStyle(document.documentElement);
    const get   = v => style.getPropertyValue(v).trim() || v;
    return {
      accent:  '#6366f1',
      cyan:    '#06b6d4',
      success: '#10b981',
      danger:  '#ef4444',
      muted:   get('--muted') || '#7070a0',
      fg:      get('--fg')    || '#e8e8f8',
      border:  get('--border')|| 'rgba(255,255,255,.07)',
      surface: get('--surface-2') || '#1a1a38'
    };
  }

  // ──────────────────────────────────────────────
  // EASING
  // ──────────────────────────────────────────────

  const ease = {
    outCubic: t => 1 - Math.pow(1 - t, 3),
    outElastic: t => t === 0 ? 0 : t === 1 ? 1 :
      Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI) / 3) + 1,
    inOutQuad: t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  };

  // ──────────────────────────────────────────────
  // BASE CHART
  // ──────────────────────────────────────────────

  class BaseChart {
    constructor(canvas, options = {}) {
      this.canvas   = canvas;
      this.ctx      = canvas.getContext('2d');
      this.options  = options;
      this._rafId   = null;
      this._progress= 0;
      this._duration= options.duration || 800;
      this._ro      = null;

      this._setup();
      this._bindResize();
      this._animate();
    }

    _setup() {
      const dpr  = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.parentElement?.getBoundingClientRect() || { width: 300, height: 180 };
      this.canvas.width  = rect.width  * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvas.style.width  = '100%';
      this.canvas.style.height = '100%';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = rect.width;
      this.h = rect.height;
    }

    _bindResize() {
      if (window.ResizeObserver) {
        this._ro = new ResizeObserver(() => {
          this._setup();
          this.draw(this._progress);
        });
        this._ro.observe(this.canvas.parentElement);
      }
    }

    _animate() {
      const start = performance.now();
      const tick  = now => {
        const elapsed = now - start;
        this._progress = Math.min(1, elapsed / this._duration);
        this.draw(ease.outCubic(this._progress));
        if (this._progress < 1) this._rafId = requestAnimationFrame(tick);
      };
      this._rafId = requestAnimationFrame(tick);
    }

    draw(_t) { /* override */ }

    destroy() {
      cancelAnimationFrame(this._rafId);
      if (this._ro) this._ro.disconnect();
    }

    redraw() {
      this._progress = 0;
      this._animate();
    }
  }

  // ──────────────────────────────────────────────
  // LINE CHART (GPA over time)
  // ──────────────────────────────────────────────

  class LineChart extends BaseChart {
    constructor(canvas, data, options = {}) {
      super(canvas, options);
      this.data = data; // { labels: [], values: [], target?: number }
    }

    draw(t) {
      const { ctx, w, h } = this;
      const theme  = getTheme();
      const data   = this.data;
      const values = data.values || [];
      const labels = data.labels || [];

      if (!values.length) return;
      ctx.clearRect(0, 0, w, h);

      const padL = 14, padR = 14, padT = 20, padB = 28;
      const gW = w - padL - padR;
      const gH = h - padT - padB;
      const maxV = Math.max(5, ...values) || 5;
      const minV = 0;

      const xOf = i => padL + (i / (values.length - 1)) * gW;
      const yOf = v => padT + (1 - (v - minV) / (maxV - minV)) * gH;

      // Grid lines
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      [1,2,3,4,5].forEach(v => {
        const y = yOf(v);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.fillStyle = theme.muted;
        ctx.font = '10px Cairo, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(v.toFixed(0), padL - 4, y + 3);
      });

      // Target line
      if (data.target) {
        const ty = yOf(data.target);
        ctx.save();
        ctx.setLineDash([5,4]);
        ctx.strokeStyle = theme.success;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(w - padR, ty); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
        ctx.fillStyle = theme.success;
        ctx.font = '10px Cairo, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('هدف ' + data.target.toFixed(2), w - padR + 2, ty + 4);
      }

      // Animated points up to t
      const animated = Math.max(2, Math.round(values.length * t));
      const pts = values.slice(0, animated);

      // Fill
      const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
      grad.addColorStop(0,   'rgba(99,102,241,0.35)');
      grad.addColorStop(0.6, 'rgba(99,102,241,0.08)');
      grad.addColorStop(1,   'rgba(99,102,241,0)');

      ctx.beginPath();
      ctx.moveTo(xOf(0), h - padB);
      pts.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
      ctx.lineTo(xOf(pts.length - 1), h - padB);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line (smooth with bezier)
      ctx.beginPath();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      pts.forEach((v, i) => {
        if (i === 0) { ctx.moveTo(xOf(i), yOf(v)); return; }
        const px = xOf(i - 1), py = yOf(pts[i-1]);
        const cx1 = px + (xOf(i) - px) / 2, cy1 = py;
        const cx2 = xOf(i) - (xOf(i) - px) / 2, cy2 = yOf(v);
        ctx.bezierCurveTo(cx1, cy1, cx2, cy2, xOf(i), yOf(v));
      });
      ctx.stroke();

      // Dots
      pts.forEach((v, i) => {
        const isLast = i === pts.length - 1;
        ctx.beginPath();
        ctx.arc(xOf(i), yOf(v), isLast ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = isLast ? theme.accent : '#fff';
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      });

      // Labels
      if (labels.length) {
        ctx.fillStyle = theme.muted;
        ctx.font = '10px Cairo, sans-serif';
        ctx.textAlign = 'center';
        values.forEach((_, i) => {
          if (labels[i]) ctx.fillText(labels[i], xOf(i), h - padB + 16);
        });
      }
    }
  }

  // ──────────────────────────────────────────────
  // RING CHART (progress)
  // ──────────────────────────────────────────────

  class RingChart extends BaseChart {
    constructor(canvas, options = {}) {
      super(canvas, { ...options, duration: 1000 });
      this.value    = options.value   || 0;   // 0–100 or 0–5
      this.max      = options.max     || 100;
      this.label    = options.label   || '';
      this.sublabel = options.sublabel|| '';
      this.color    = options.color   || '#6366f1';
    }

    draw(t) {
      const { ctx, w, h } = this;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2, cy = h / 2;
      const r  = Math.min(cx, cy) - 10;
      const pct = (this.value / this.max) * t;
      const start = -Math.PI / 2;
      const end   = start + pct * 2 * Math.PI;
      const theme = getTheme();

      // Track
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = 10;
      ctx.stroke();

      // Progress arc
      if (pct > 0) {
        const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
        grad.addColorStop(0, this.color);
        grad.addColorStop(1, '#06b6d4');

        ctx.beginPath();
        ctx.arc(cx, cy, r, start, end);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Center text
      const displayVal = ((this.value / this.max) * this.max * t).toFixed(
        this.max <= 5 ? 2 : 0
      );
      ctx.fillStyle = theme.fg;
      ctx.font = `700 ${Math.round(r * 0.45)}px Cairo, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayVal, cx, cy - 6);

      if (this.sublabel) {
        ctx.fillStyle = theme.muted;
        ctx.font = `500 ${Math.round(r * 0.22)}px Cairo, sans-serif`;
        ctx.fillText(this.sublabel, cx, cy + r * 0.28);
      }
    }
  }

  // ──────────────────────────────────────────────
  // SPARKLINE (mini inline chart)
  // ──────────────────────────────────────────────

  class Sparkline extends BaseChart {
    constructor(canvas, values, color) {
      super(canvas, { duration: 600 });
      this.values = values;
      this.color  = color || '#6366f1';
    }

    draw(t) {
      const { ctx, w, h, values } = this;
      if (!values.length) return;
      ctx.clearRect(0, 0, w, h);

      const max = Math.max(...values);
      const min = Math.min(...values);
      const range = max - min || 1;
      const pts = values.slice(0, Math.max(2, Math.round(values.length * t)));
      const xOf = i => (i / (values.length - 1)) * w;
      const yOf = v => h - ((v - min) / range) * (h * 0.8) - h * 0.1;

      ctx.beginPath();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      pts.forEach((v, i) => {
        if (i === 0) ctx.moveTo(xOf(i), yOf(v));
        else ctx.lineTo(xOf(i), yOf(v));
      });
      ctx.stroke();
    }
  }

  // ──────────────────────────────────────────────
  // FACTORY
  // ──────────────────────────────────────────────

  function createChart(type, containerId, data, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;';
    container.appendChild(canvas);

    switch (type) {
      case 'line':  return new LineChart(canvas, data, options);
      case 'ring':  return new RingChart(canvas, { ...data, ...options });
      case 'spark': return new Sparkline(canvas, data.values || [], options.color);
      default: return null;
    }
  }

  // ──────────────────────────────────────────────
  // GPA CHART (convenience for dashboard)
  // ──────────────────────────────────────────────

  function renderGpaChart(containerId, profile) {
    const goals = profile?.goals || {};
    const current = parseFloat(goals.currentGpa) || 3.5;
    const target  = parseFloat(goals.targetGpa)  || current;
    const weeks   = parseInt(profile?.basic?.weeks) || 16;

    // Generate realistic trajectory
    const points = [];
    const labels = [];
    const base   = Math.max(1.5, current - 0.5);
    for (let i = 0; i <= 8; i++) {
      const frac = i / 8;
      const jitter = (Math.random() - 0.5) * 0.08;
      points.push(+(base + (current - base) * frac * 0.6 +
                   (target - current) * frac * 0.4 + jitter).toFixed(2));
      labels.push(i === 0 ? 'بداية' : i === 8 ? 'الآن' : `أ${i}`);
    }
    points[points.length - 1] = current;

    return createChart('line', containerId, {
      values: points,
      labels,
      target: target !== current ? target : null
    }, { duration: 1000 });
  }

  // ──────────────────────────────────────────────
  // EXPOSE
  // ──────────────────────────────────────────────

  window.UQUCharts = { LineChart, RingChart, Sparkline, createChart, renderGpaChart };

  console.log('%cUQU Charts v1.0 ✓', 'background:#0f172a;color:#fbbf24;padding:2px 7px;border-radius:4px;');

})(window);
