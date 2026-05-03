// =================================================================
// UQU Floor Plan Engine v2.1 — SVG-over-Image with Pan/Zoom/Rotate
// Fixed: SVG perfectly synchronized with image aspect ratio
// =================================================================
(function () {
  'use strict';

  const MAP_IMAGE_URL = 'assets/base-map.jpg';

  // ── Room type metadata ──
  const ROOM_STYLE = {
    lab:           { icon: '🔬', label: 'معمل' },
    classroom:     { icon: '🏫', label: 'قاعة دراسية' },
    office:        { icon: '🚪', label: 'مكتب' },
    admin:         { icon: '🏛️', label: 'إدارة' },
    wc:            { icon: '🚻', label: 'دورات مياه' },
    stairs:        { icon: '🪜', label: 'درج' },
    library:       { icon: '📚', label: 'مكتبة' },
    amphitheater:  { icon: '🎤', label: 'مدرج' },
    mosque:        { icon: '🕌', label: 'مصلى' },
    corridor:      { icon: '🚶', label: 'ممر' },
    other:         { icon: '📍', label: 'أخرى' },
  };
  window.ROOM_STYLE = ROOM_STYLE;

  class FloorPlanEngine {
    constructor(container) {
      this.container = container;
      this.scale = 1;
      this.minScale = 0.3;
      this.maxScale = 8;
      this.panX = 0;
      this.panY = 0;
      this.rotation = 0;
      this.isPanning = false;
      this.lastPointer = { x: 0, y: 0 };
      this.selectedRoom = null;
      this.selectedData = null;
      this._tooltipHandler = null;
      this._roomGroups = new Map();
      this._rendered = false;
      this._init();
    }

    _init() {
      this.container.innerHTML = '';

      // Wrapper div — gets transform (pan/zoom/rotate)
      // Its size = displayed image size, acts as the coordinate frame
      this.wrapper = document.createElement('div');
      Object.assign(this.wrapper.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        transformOrigin: '0 0',
        willChange: 'transform',
      });

      // Image — fills the wrapper completely
      this.image = new Image();
      this.image.src = MAP_IMAGE_URL;
      Object.assign(this.image.style, {
        display: 'block',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        userSelect: 'none',
      });

      // SVG overlay — viewBox uses percentage space (0 0 100 100)
      // so polygon points (which are already percentages) map 1:1
      const ns = 'http://www.w3.org/2000/svg';
      this.svg = document.createElementNS(ns, 'svg');
      this.svg.setAttribute('viewBox', '0 0 100 100');
      // xMidYMid meet = maintain aspect ratio, no stretching
      this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      Object.assign(this.svg.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        overflow: 'visible',
      });

      this.wrapper.appendChild(this.image);
      this.wrapper.appendChild(this.svg);
      this.container.appendChild(this.wrapper);

      // Once image loads, compute sizes
      this.image.onload = () => {
        this.imgW = this.image.naturalWidth;
        this.imgH = this.image.naturalHeight;
        this._tryRender();
      };

      // Also try on DOMContentLoaded in case MAP_DATA loads after image
      document.addEventListener('DOMContentLoaded', () => {
        if (this.imgW && !this._rendered) this._tryRender();
      });

      this.image.onerror = () => {
        this.container.innerHTML = `<div style="display:grid;place-items:center;height:100%;color:#ef4444;font-family:Cairo,sans-serif;font-size:1.1rem;text-align:center;padding:2rem;">
          ❌ لم يتم العثور على صورة الخريطة<br><code style="font-size:.8rem;color:#94a3b8;">${MAP_IMAGE_URL}</code>
        </div>`;
      };

      this._bindEvents();
    }

    _tryRender() {
      const data = window.MAP_DATA || [];
      if (data.length > 0 && this.imgW) {
        this._render();
        this._fit();
        this._rendered = true;
      } else {
        setTimeout(() => this._tryRender(), 50);
      }
    }

    // ── Render rooms as SVG polygons ──
    // Points are already in percentage space (0-100), and SVG viewBox is 0 0 100 100
    // so we use the points DIRECTLY — no conversion needed!
    _render() {
      const ns = 'http://www.w3.org/2000/svg';

      // Apply dark mode filter to image
      if (document.documentElement.getAttribute('data-theme') === 'dark') {
        this.image.style.filter = 'brightness(0.75) contrast(1.1)';
      } else {
        this.image.style.filter = 'none';
      }

      this.svg.innerHTML = '';
      this._roomGroups.clear();

      const data = window.MAP_DATA || [];

      data.forEach(item => {
        const isCorridor = item.type === 'corridor';
        const group = document.createElementNS(ns, 'g');
        group.setAttribute('data-room-id', item.id);

        // Points are already percentages — use directly in viewBox 0-100 space
        const polygon = document.createElementNS(ns, 'polygon');
        polygon.setAttribute('points', item.points);
        polygon.setAttribute('data-id', item.id);
        polygon.setAttribute('data-color', item.color);

        if (isCorridor) {
          polygon.style.fill = 'transparent';
          polygon.style.stroke = 'transparent';
          polygon.style.pointerEvents = 'none';
        } else {
          polygon.style.fill = 'transparent';
          polygon.style.stroke = 'transparent';
          polygon.style.strokeWidth = '0.15';
          polygon.style.cursor = 'pointer';
          polygon.style.transition = 'fill 0.2s, stroke 0.2s';
        }

        group.appendChild(polygon);

        // Doors (hidden by default) — coordinates are also percentages
        if (item.doors && item.doors.length > 0) {
          item.doors.forEach(door => {
            const c = document.createElementNS(ns, 'circle');
            c.setAttribute('cx', door.x);
            c.setAttribute('cy', door.y);
            c.setAttribute('r', '0.35');
            c.setAttribute('fill', '#f59e0b');
            c.setAttribute('stroke', '#fff');
            c.setAttribute('stroke-width', '0.1');
            c.style.opacity = '0';
            c.style.transition = 'opacity 0.3s';
            c.classList.add('door-marker');
            group.appendChild(c);
          });
        }

        // Label (hidden by default)
        if (!isCorridor) {
          const pts = item.points.split(' ').map(p => p.split(',').map(Number));
          const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
          const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
          const text = document.createElementNS(ns, 'text');
          text.setAttribute('x', cx);
          text.setAttribute('y', cy);
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'central');
          text.setAttribute('font-family', 'Cairo, sans-serif');
          text.setAttribute('font-weight', '700');
          text.setAttribute('font-size', '0.9');
          text.setAttribute('fill', item.color);
          text.setAttribute('pointer-events', 'none');
          text.style.opacity = '0';
          text.style.transition = 'opacity 0.3s';
          text.textContent = item.label;
          text.classList.add('room-label');
          group.appendChild(text);
        }

        // Events
        if (!isCorridor) {
          group.addEventListener('mouseenter', () => this._onHover(item, group));
          group.addEventListener('mouseleave', () => this._onLeave(item, group));
          group.addEventListener('click', e => { e.stopPropagation(); this._onClick(item, group); });
          group.addEventListener('touchend', e => {
            e.preventDefault();
            e.stopPropagation();
            this._onClick(item, group);
          }, { passive: false });
        }

        this.svg.appendChild(group);
        this._roomGroups.set(item.id, { group, data: item });
      });

      // Click on empty space to deselect (only if not dragging)
      this.svg.addEventListener('click', () => { if (!this._isDragging) this._deselect(); });
    }

    // ── Hover / Leave / Click ──
    _onHover(item, group) {
      if (this.selectedData && this.selectedData.id === item.id) return;
      const poly = group.querySelector('polygon');
      if (poly) {
        poly.style.fill = `${item.color}33`;
        poly.style.stroke = item.color;
      }
      let tt = document.getElementById('floorplan-tooltip');
      if (!tt) {
        tt = document.createElement('div');
        tt.id = 'floorplan-tooltip';
        tt.className = 'floorplan-tooltip';
        document.body.appendChild(tt);
      }
      const st = ROOM_STYLE[item.type] || { icon: '📍', label: item.type };
      tt.innerHTML = `<div style="font-weight:700;">${st.icon} ${item.label}</div>`;
      tt.classList.add('visible');
      const handler = e => {
        tt.style.left = (e.clientX + 15) + 'px';
        tt.style.top = (e.clientY + 15) + 'px';
      };
      document.addEventListener('mousemove', handler);
      this._tooltipHandler = handler;
    }

    _onLeave(item, group) {
      if (this.selectedData && this.selectedData.id === item.id) return;
      const poly = group.querySelector('polygon');
      if (poly) {
        poly.style.fill = 'transparent';
        poly.style.stroke = 'transparent';
      }
      const tt = document.getElementById('floorplan-tooltip');
      if (tt) tt.classList.remove('visible');
      if (this._tooltipHandler) {
        document.removeEventListener('mousemove', this._tooltipHandler);
        this._tooltipHandler = null;
      }
    }

    _onClick(item, group) {
      // If user was dragging the map, ignore — not a real click
      if (this._isDragging) return;

      this._deselect();
      this.selectedRoom = group;
      this.selectedData = item;

      const poly = group.querySelector('polygon');
      if (poly) {
        poly.style.fill = `${item.color}55`;
        poly.style.stroke = item.color;
        poly.style.strokeWidth = '0.3';
      }

      group.querySelectorAll('.door-marker').forEach(d => d.style.opacity = '1');
      group.querySelectorAll('.room-label').forEach(l => l.style.opacity = '1');

      this.container.dispatchEvent(new CustomEvent('room-selected', { detail: item }));
      this._centerOnItem(item);
    }

    _deselect() {
      if (this.selectedRoom) {
        const poly = this.selectedRoom.querySelector('polygon');
        if (poly) {
          poly.style.fill = 'transparent';
          poly.style.stroke = 'transparent';
          poly.style.strokeWidth = '0.15';
        }
        this.selectedRoom.querySelectorAll('.door-marker').forEach(d => d.style.opacity = '0');
        this.selectedRoom.querySelectorAll('.room-label').forEach(l => {
          if (this.scale < 3) l.style.opacity = '0';
        });
      }
      this.selectedRoom = null;
      this.selectedData = null;
      const tt = document.getElementById('floorplan-tooltip');
      if (tt) tt.classList.remove('visible');
    }

    _centerOnItem(item) {
      // Skip auto-center during origin selection to avoid jarring zoom
      if (this._suppressAutoCenter) return;

      const pts = item.points.split(' ').map(p => p.split(',').map(Number));
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length; // % (0-100)
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;

      const cr = this.container.getBoundingClientRect();

      // Gentle zoom: only nudge scale up slightly if very zoomed out, never force zoom
      const targetScale = Math.max(1.5, Math.min(this.scale, 4));

      // Position in wrapper-local pixels (at scale=1)
      const pxX = (cx / 100) * this._displayW;
      const pxY = (cy / 100) * this._displayH;

      this.scale = targetScale;
      this.panX = (cr.width / 2) - (pxX * this.scale);
      this.panY = (cr.height / 2) - (pxY * this.scale);
      this._apply(true);
    }

    // ── Transform ──
    _apply(smooth) {
      if (smooth) {
        this.wrapper.style.transition = 'transform 0.4s ease';
        setTimeout(() => { this.wrapper.style.transition = ''; }, 450);
      }

      if (this.rotation % 360 === 0) {
        // Fast path — no rotation needed
        this.wrapper.style.transform =
          `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
      } else {
        // Rotate around viewport center (not around 0,0)
        const cr = this.container.getBoundingClientRect();
        const vcx = cr.width / 2;
        const vcy = cr.height / 2;
        const rad = this.rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Shift panX/panY so rotation pivots around viewport center
        const dx = this.panX - vcx;
        const dy = this.panY - vcy;
        const rdx = cos * dx - sin * dy;
        const rdy = sin * dx + cos * dy;

        this.wrapper.style.transform =
          `translate(${vcx + rdx}px, ${vcy + rdy}px) scale(${this.scale}) rotate(${this.rotation}deg)`;
      }
      this._updateLabels();
    }

    _updateLabels() {
      const show = this.scale >= 2.5;
      this.svg.querySelectorAll('.room-label').forEach(l => {
        const parent = l.closest('g');
        const isSelected = this.selectedRoom === parent;
        l.style.opacity = (show || isSelected) ? '1' : '0';
      });
    }

    _fit() {
      const cr = this.container.getBoundingClientRect();
      if (!this.imgW || !this.imgH) return;

      const imgAspect = this.imgW / this.imgH;
      const containerAspect = cr.width / cr.height;

      let displayW, displayH;
      if (containerAspect > imgAspect) {
        displayH = cr.height;
        displayW = displayH * imgAspect;
      } else {
        displayW = cr.width;
        displayH = displayW / imgAspect;
      }

      // Store for _centerOnItem
      this._displayW = displayW;
      this._displayH = displayH;

      // Set wrapper size = exact displayed image dimensions
      this.wrapper.style.width = displayW + 'px';
      this.wrapper.style.height = displayH + 'px';

      this.scale = 1;
      this.panX = (cr.width - displayW) / 2;
      this.panY = (cr.height - displayH) / 2;
      this.rotation = 0;
      this._apply(false);
    }

    // ── Event binding ──
    _bindEvents() {
      const DRAG_THRESHOLD = 5; // pixels – distinguishes click from drag

      const onDown = e => {
        if (e.button && e.button !== 0) return;
        const pt = e.touches ? e.touches[0] : e;
        this.isPanning = true;
        this._isDragging = false;
        this._dragStartPos = { x: pt.clientX, y: pt.clientY };
        this.lastPointer = { x: pt.clientX, y: pt.clientY };
        this.container.style.cursor = 'grabbing';
      };
      const onMove = e => {
        if (!this.isPanning) return;
        const pt = e.touches ? e.touches[0] : e;
        const dxScreen = pt.clientX - this.lastPointer.x;
        const dyScreen = pt.clientY - this.lastPointer.y;

        // Check if we've moved beyond drag threshold
        if (!this._isDragging && this._dragStartPos) {
          const totalDx = pt.clientX - this._dragStartPos.x;
          const totalDy = pt.clientY - this._dragStartPos.y;
          if (Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD) {
            this._isDragging = true;
          }
        }

        // Compensate for rotation: rotate screen delta by -rotation
        if (this.rotation % 360 !== 0) {
          const rad = -this.rotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          this.panX += dxScreen * cos - dyScreen * sin;
          this.panY += dxScreen * sin + dyScreen * cos;
        } else {
          this.panX += dxScreen;
          this.panY += dyScreen;
        }

        this.lastPointer = { x: pt.clientX, y: pt.clientY };
        this._apply(false);
      };
      const onUp = () => {
        this.isPanning = false;
        this.container.style.cursor = 'grab';
        // _isDragging stays true until next onDown so the click handler can check it
        // Reset it after a microtask so the click event (which fires after mouseup) can read it
        setTimeout(() => { this._isDragging = false; }, 0);
      };

      this.container.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      // Touch
      this.container.addEventListener('touchstart', e => {
        if (e.touches.length === 1) onDown(e);
        if (e.touches.length === 2) {
          this._pinchStart = this._getPinchData(e);
        }
      }, { passive: true });
      this.container.addEventListener('touchmove', e => {
        if (e.touches.length === 1 && this.isPanning) {
          e.preventDefault();
          onMove(e);
        }
        if (e.touches.length === 2 && this._pinchStart) {
          e.preventDefault();
          const pinch = this._getPinchData(e);
          const ratio = pinch.dist / this._pinchStart.dist;
          const newScale = Math.max(this.minScale, Math.min(this.maxScale, this._pinchStart.scale * ratio));

          const cr = this.container.getBoundingClientRect();
          const mx = pinch.cx - cr.left;
          const my = pinch.cy - cr.top;
          this.rotation = this._pinchStart.rotation + (pinch.angle - this._pinchStart.angle);
          this._zoomToPoint(mx, my, newScale, false);
        }
      }, { passive: false });
      this.container.addEventListener('touchend', e => {
        if (e.touches.length < 2) this._pinchStart = null;
        if (e.touches.length === 0) onUp();
      });

      // Wheel zoom (rotation-compensated)
      this.container.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
        const cr = this.container.getBoundingClientRect();
        this._zoomToPoint(e.clientX - cr.left, e.clientY - cr.top, newScale, false);
      }, { passive: false });

      // Double-click zoom (rotation-compensated)
      this.container.addEventListener('dblclick', e => {
        const cr = this.container.getBoundingClientRect();
        const newScale = Math.min(this.maxScale, this.scale * 2);
        this._zoomToPoint(e.clientX - cr.left, e.clientY - cr.top, newScale, true);
      });

      // Keyboard shortcuts
      window.addEventListener('keydown', e => {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        if (e.key === '0') this.resetView();
        if (e.key === 'r' || e.key === 'R') this.rotateRight();
      });

      window.addEventListener('resize', () => this._fit());
      this.container.style.cursor = 'grab';
    }

    _getPinchData(e) {
      const t = e.touches;
      const dx = t[1].clientX - t[0].clientX;
      const dy = t[1].clientY - t[0].clientY;
      return {
        dist: Math.hypot(dx, dy),
        cx: (t[0].clientX + t[1].clientX) / 2,
        cy: (t[0].clientY + t[1].clientY) / 2,
        angle: Math.atan2(dy, dx) * (180 / Math.PI),
        scale: this.scale,
        rotation: this.rotation,
      };
    }

    // ── Rotation-compensated zoom toward a screen point ──
    // Keeps the point under the cursor fixed regardless of map rotation.
    _zoomToPoint(screenX, screenY, newScale, animate) {
      const cr = this.container.getBoundingClientRect();
      const centerX = cr.width / 2;
      const centerY = cr.height / 2;

      // Vector from viewport center to the focal point (screen space)
      const dx = screenX - centerX;
      const dy = screenY - centerY;

      // Rotate into map space (inverse of current rotation)
      const rad = -this.rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dxMap = dx * cos - dy * sin;
      const dyMap = dx * sin + dy * cos;

      // Apply scale ratio offset in map space
      const ratio = newScale / this.scale;
      this.panX -= dxMap * (ratio - 1);
      this.panY -= dyMap * (ratio - 1);
      this.scale = newScale;
      this._apply(animate);
    }

    // ── Public API ──
    zoomIn() {
      const cr = this.container.getBoundingClientRect();
      const newScale = Math.min(this.maxScale, this.scale * 1.3);
      // Zoom toward center — no rotation compensation needed
      this._zoomToPoint(cr.width / 2, cr.height / 2, newScale, true);
    }

    zoomOut() {
      const cr = this.container.getBoundingClientRect();
      const newScale = Math.max(this.minScale, this.scale / 1.3);
      this._zoomToPoint(cr.width / 2, cr.height / 2, newScale, true);
    }

    resetView() { this._deselect(); this._fit(); }
    rotateLeft() { this.rotation -= 90; this._apply(true); }
    rotateRight() { this.rotation += 90; this._apply(true); }

    /** Set rotation to an arbitrary angle without smooth transition (for compass). */
    setRotation(degrees) {
      this.rotation = degrees;
      this._apply(false);
    }

    /** Get the SVG overlay element (for adding custom elements like blue dot). */
    getOverlaySvg() {
      return this.svg;
    }

    /** Get displayed image dimensions. */
    getDisplaySize() {
      return { width: this._displayW, height: this._displayH };
    }

    /**
     * Convert client (screen) coordinates to map percentage coordinates (0-100).
     * Reverses the full transform chain: translate, scale, rotate.
     */
    clientToMapCoords(clientX, clientY) {
      const cr = this.container.getBoundingClientRect();
      const vcx = cr.width / 2;
      const vcy = cr.height / 2;

      let x, y;
      if (this.rotation % 360 === 0) {
        x = clientX - cr.left - this.panX;
        y = clientY - cr.top - this.panY;
      } else {
        // Reverse the viewport-center rotation
        const rad = -this.rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Get position relative to viewport center
        const px = clientX - cr.left - vcx;
        const py = clientY - cr.top - vcy;

        // Undo rotation
        const rx = cos * px - sin * py;
        const ry = sin * px + cos * py;

        // Convert back to wrapper-local coords
        x = rx + vcx - this.panX;
        y = ry + vcy - this.panY;
      }

      // Undo scale, then convert pixel → percentage
      x /= this.scale;
      y /= this.scale;

      return {
        x: (x / this._displayW) * 100,
        y: (y / this._displayH) * 100,
      };
    }

    redraw() {
      if (this.imgW) { this._render(); this._apply(false); }
    }

    searchRoom(query) {
      const q = query.toLowerCase().trim();
      const data = window.MAP_DATA || [];
      return data.filter(item => {
        if (item.type === 'corridor') return false;
        const label = item.label.toLowerCase();
        const id = item.id.toLowerCase();
        const typeName = (ROOM_STYLE[item.type] || {}).label || '';
        return label.includes(q) || id.includes(q) || typeName.includes(q);
      });
    }

    selectRoom(id) {
      const entry = this._roomGroups.get(id);
      if (entry) this._onClick(entry.data, entry.group);
    }

    filterByType(type) {
      const data = window.MAP_DATA || [];
      return data.filter(item => item.type === type && item.type !== 'corridor');
    }
  }

  window.FloorPlanEngine = FloorPlanEngine;

  function setRooms() {
    window.FLOOR_PLAN_ROOMS = (window.MAP_DATA || []).filter(r => r.type !== 'corridor');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setRooms);
  } else {
    setRooms();
  }
})();
