// =================================================================
// MapStudio Pro — Centerline Drawing Engine (Self-contained)
// No dependency on floorplan.js — standalone pan/zoom/coordinate system
// =================================================================
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const SNAP_GRID = 0.5;
  const POINT_R = 0.4;
  const POINT_R_BIG = 0.55;
  const HIT_TOL = 1.2;

  // Line colors palette
  const PALETTE = [
    '#3b82f6','#10b981','#f59e0b','#ef4444',
    '#8b5cf6','#ec4899','#06b6d4','#f97316',
    '#14b8a6','#6366f1','#84cc16','#e11d48'
  ];

  class MapToolEngine {
    constructor() {
      // ── DOM ──
      this.vp    = document.getElementById('vp');
      this.mw    = document.getElementById('mw');
      this.img   = document.getElementById('mi');
      this.svg   = document.getElementById('sv');

      // ── Transform state ──
      this.scale = 1;
      this.panX = 0;
      this.panY = 0;
      this.imgW = 0;
      this.imgH = 0;
      this._isPanning = false;
      this._panStart = null;

      // ── Data ──
      this.centerlines = [];
      this._nextId = 1;
      this._junctions = []; // manual cross-corridor edges [{from:{li,pi}, to:{li,pi}}]

      // ── State ──
      this.mode = 'select';
      this._drawing = null;    // {id, label, points[], color}
      this._editDrag = null;   // {lineIdx, pointIdx, sx, sy}
      this._linkFrom = null;   // {lineIdx, pointIdx}
      this._selIdx = -1;

      // ── Options ──
      this.snapGrid = true;
      this.showDoors = true;
      this.showSnaps = true;
      this.showRooms = true;
      this.showLabels = false;

      // ── Undo/Redo ──
      this._undo = [];
      this._redo = [];

      // ── SVG Layers ──
      this._initLayers();

      // ── Load image ──
      this.img.onload = () => {
        this.imgW = this.img.naturalWidth;
        this.imgH = this.img.naturalHeight;
        this.mw.style.width  = this.imgW + 'px';
        this.mw.style.height = this.imgH + 'px';
        this.img.style.width  = this.imgW + 'px';
        this.img.style.height = this.imgH + 'px';
        this.img.style.display = 'block';
        this.svg.setAttribute('viewBox', `0 0 ${this.imgW} ${this.imgH}`);
        this.svg.setAttribute('width', this.imgW);
        this.svg.setAttribute('height', this.imgH);
        this.svg.style.width  = this.imgW + 'px';
        this.svg.style.height = this.imgH + 'px';
        this.svg.style.display = 'block';
        this._fit();
        this._drawRooms();
        this._drawDoors();
        this._autoImport();
        this._updateStatus();
        this._toast('✅ تم تحميل الخريطة + ' + this.centerlines.length + ' مسار');
      };
      if (this.img.complete && this.img.naturalWidth) {
        this.img.onload();
      }

      // ── Events ──
      this._bindPanZoom();
      this._bindToolbar();
      this._bindMapEvents();
      this._bindKeyboard();
    }

    // ═══════════════════════════════════════════
    // SVG LAYERS
    // ═══════════════════════════════════════════

    _initLayers() {
      this.gRooms   = this._g('g-rooms');
      this.gSnap    = this._g('g-snap');
      this.gLines   = this._g('g-lines');
      this.gPoints  = this._g('g-points');
      this.gDoors   = this._g('g-doors');
      this.gLabels  = this._g('g-labels');
      this.gPreview = this._g('g-preview');
    }

    _g(id) {
      const g = document.createElementNS(NS, 'g');
      g.id = id;
      this.svg.appendChild(g);
      return g;
    }

    // ═══════════════════════════════════════════
    // PAN / ZOOM
    // ═══════════════════════════════════════════

    _applyTransform() {
      this.mw.style.transform = `translate(${this.panX}px,${this.panY}px) scale(${this.scale})`;
      document.getElementById('zLbl').textContent = Math.round(this.scale * 100) + '%';
    }

    _fit() {
      const vw = this.vp.clientWidth, vh = this.vp.clientHeight;
      this.scale = Math.min(vw / this.imgW, vh / this.imgH) * 0.92;
      this.panX = Math.round((vw - this.imgW * this.scale) / 2);
      this.panY = Math.round((vh - this.imgH * this.scale) / 2);
      this._applyTransform();
    }

    _bindPanZoom() {
      // Wheel zoom
      this.vp.addEventListener('wheel', e => {
        e.preventDefault();
        const r = this.vp.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const f = e.deltaY < 0 ? 1.12 : 0.89;
        const ns = Math.min(Math.max(this.scale * f, 0.05), 15);
        this.panX = mx - (mx - this.panX) * (ns / this.scale);
        this.panY = my - (my - this.panY) * (ns / this.scale);
        this.scale = ns;
        this._applyTransform();
      }, { passive: false });

      // Pan with middle-click or left-click on empty
      this.vp.addEventListener('mousedown', e => {
        if (e.button === 1) { e.preventDefault(); this._startPan(e); return; }
        if (e.button === 0 && this.mode === 'select' &&
            (e.target === this.vp || e.target === this.mw || e.target === this.svg)) {
          this._startPan(e);
        }
      });

      window.addEventListener('mousemove', e => {
        if (this._isPanning) {
          this.panX = this._panStart.px + (e.clientX - this._panStart.cx);
          this.panY = this._panStart.py + (e.clientY - this._panStart.cy);
          this._applyTransform();
        }
      });

      window.addEventListener('mouseup', () => {
        if (this._isPanning) {
          this._isPanning = false;
          this.vp.classList.remove('panning');
        }
      });

      // Zoom buttons
      document.getElementById('zIn').addEventListener('click', () => this._zoomCenter(1.25));
      document.getElementById('zOut').addEventListener('click', () => this._zoomCenter(0.8));
      document.getElementById('zFit').addEventListener('click', () => this._fit());
    }

    _startPan(e) {
      this._isPanning = true;
      this._panStart = { cx: e.clientX, cy: e.clientY, px: this.panX, py: this.panY };
      this.vp.classList.add('panning');
    }

    _zoomCenter(f) {
      const vw = this.vp.clientWidth, vh = this.vp.clientHeight;
      const mx = vw / 2, my = vh / 2;
      const ns = Math.min(Math.max(this.scale * f, 0.05), 15);
      this.panX = mx - (mx - this.panX) * (ns / this.scale);
      this.panY = my - (my - this.panY) * (ns / this.scale);
      this.scale = ns;
      this._applyTransform();
    }

    // ═══════════════════════════════════════════
    // COORDINATE CONVERSION
    // ═══════════════════════════════════════════

    // Screen → SVG image pixel coords
    _s2i(clientX, clientY) {
      const r = this.vp.getBoundingClientRect();
      return {
        x: (clientX - r.left - this.panX) / this.scale,
        y: (clientY - r.top  - this.panY) / this.scale
      };
    }

    // SVG image pixel coords → percentage (0-100)
    _i2p(ix, iy) {
      return { x: (ix / this.imgW) * 100, y: (iy / this.imgH) * 100 };
    }

    // Percentage → SVG image pixel coords
    _p2i(px, py) {
      return { x: (px / 100) * this.imgW, y: (py / 100) * this.imgH };
    }

    // Screen → percentage (snapped)
    _s2p(clientX, clientY) {
      const ip = this._s2i(clientX, clientY);
      const pct = this._i2p(ip.x, ip.y);
      return {
        x: this._snap(pct.x),
        y: this._snap(pct.y)
      };
    }

    _snap(v) {
      if (!this.snapGrid) return Math.round(v * 10) / 10;
      return Math.round(v / SNAP_GRID) * SNAP_GRID;
    }

    // Hit tolerance in percentage units (adjusts with zoom)
    _hitTol() {
      return Math.max(HIT_TOL, 3 / this.scale);
    }

    // ═══════════════════════════════════════════
    // TOOLBAR
    // ═══════════════════════════════════════════

    _bindToolbar() {
      const $ = id => document.getElementById(id);

      $('bDraw').onclick = () => this.setMode('draw');
      $('bEdit').onclick = () => this.setMode('edit');
      $('bDel').onclick  = () => this.setMode('delete');
      $('bLink').onclick = () => this.setMode('link');
      $('bUndo').onclick = () => this.undo();
      $('bRedo').onclick = () => this.redo();
      $('bExport').onclick = () => this._showExport();
      $('bImport').onclick = () => this._showImport();
      $('bClear').onclick  = () => this._clearAll();
      $('bHelp').onclick   = () => $('help').classList.toggle('on');

      $('cSnap').onchange  = e => { this.snapGrid = e.target.checked; };
      $('cDoors').onchange = e => { this.showDoors = e.target.checked; this.gDoors.style.display = e.target.checked ? '' : 'none'; };
      $('cSnaps').onchange = e => { this.showSnaps = e.target.checked; this._drawSnapLines(); };
      $('cRooms').onchange = e => { this.showRooms = e.target.checked; this.gRooms.style.display = e.target.checked ? '' : 'none'; };
      $('cLabels').onchange = e => { this.showLabels = e.target.checked; this.gLabels.style.display = e.target.checked ? '' : 'none'; };

      // Layer toggles in sidebar
      $('lRooms').onchange = e => { $('cRooms').checked = e.target.checked; $('cRooms').onchange(e); };
      $('lDoors').onchange = e => { $('cDoors').checked = e.target.checked; $('cDoors').onchange(e); };
      $('lSnap').onchange  = e => { $('cSnaps').checked = e.target.checked; $('cSnaps').onchange(e); };
      $('lLines').onchange = e => { this.gLines.style.display = e.target.checked ? '' : 'none'; this.gPoints.style.display = e.target.checked ? '' : 'none'; };

      $('mClose').onclick = () => $('modal-bg').classList.remove('on');
      $('modal-bg').onclick = e => { if (e.target === $('modal-bg')) $('modal-bg').classList.remove('on'); };
    }

    // ═══════════════════════════════════════════
    // MAP EVENTS
    // ═══════════════════════════════════════════

    _bindMapEvents() {
      // Mouse move: coordinate display + preview + drag
      this.vp.addEventListener('mousemove', e => {
        if (this._isPanning) return;
        if (!this.imgW) return;

        const pct = this._s2p(e.clientX, e.clientY);
        document.getElementById('coord').textContent =
          `X: ${pct.x.toFixed(1)}  Y: ${pct.y.toFixed(1)}`;

        // Drawing preview
        if (this.mode === 'draw' && this._drawing && this._drawing.points.length > 0) {
          this._drawPreview(pct.x, pct.y);
        }

        // Edit drag
        if (this._editDrag) {
          this._doDrag(pct.x, pct.y);
        }
      });

      // Click
      this.svg.addEventListener('mousedown', e => {
        if (e.button !== 0 || !this.imgW) return;
        if (this._isPanning) return;

        const pct = this._s2p(e.clientX, e.clientY);

        if (this.mode === 'draw') {
          e.stopPropagation();
          this._addPoint(pct.x, pct.y);
          return;
        }

        if (this.mode === 'edit') {
          const hit = this._findPointAt(pct.x, pct.y);
          if (hit) {
            e.stopPropagation();
            e.preventDefault();
            this._editDrag = {
              lineIdx: hit.li, pointIdx: hit.pi,
              sx: this.centerlines[hit.li].points[hit.pi].x,
              sy: this.centerlines[hit.li].points[hit.pi].y
            };
            this._isPanning = false;
            return;
          }
        }

        if (this.mode === 'delete') {
          e.stopPropagation();
          this._deleteAt(pct.x, pct.y);
          return;
        }

        if (this.mode === 'link') {
          e.stopPropagation();
          this._linkAt(pct.x, pct.y);
          return;
        }

        // Select
        if (this.mode === 'select') {
          this._selectAt(pct.x, pct.y);
        }
      });

      // Double-click to finish drawing
      this.svg.addEventListener('dblclick', e => {
        if (this.mode === 'draw' && this._drawing) {
          e.preventDefault();
          e.stopPropagation();
          this._finishDrawing();
        }
      });

      // Mouseup for edit drag
      window.addEventListener('mouseup', () => {
        if (this._editDrag) {
          const d = this._editDrag;
          const pt = this.centerlines[d.lineIdx].points[d.pointIdx];
          if (pt.x !== d.sx || pt.y !== d.sy) this._pushUndo();
          this._editDrag = null;
          this._redraw();
        }
      });
    }

    // ═══════════════════════════════════════════
    // KEYBOARD
    // ═══════════════════════════════════════════

    _bindKeyboard() {
      document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'PRE') return;
        const k = e.key.toLowerCase();

        if (k === 'd') { this.setMode('draw'); e.preventDefault(); }
        else if (k === 'e') { this.setMode('edit'); e.preventDefault(); }
        else if (k === 'x') { this.setMode('delete'); e.preventDefault(); }
        else if (k === 'l') { this.setMode('link'); e.preventDefault(); }
        else if (k === 'escape') {
          if (this._drawing) this._finishDrawing();
          else if (this._linkFrom) { this._linkFrom = null; this._toast('تم إلغاء الربط'); }
          else this.setMode('select');
          e.preventDefault();
        }
        else if (k === 'enter' && this._drawing) { this._finishDrawing(); e.preventDefault(); }
        else if (k === 'z' && (e.ctrlKey || e.metaKey)) { this.undo(); e.preventDefault(); }
        else if (k === 'y' && (e.ctrlKey || e.metaKey)) { this.redo(); e.preventDefault(); }
        else if (k === 's' && (e.ctrlKey || e.metaKey)) { this._showExport(); e.preventDefault(); }
        else if (k === '?') { document.getElementById('help').classList.toggle('on'); }
      });
    }

    // ═══════════════════════════════════════════
    // MODE
    // ═══════════════════════════════════════════

    setMode(mode) {
      if (this._drawing && mode !== 'draw') this._finishDrawing();
      this._linkFrom = null;
      this.mode = mode;

      this.vp.classList.remove('drawing', 'editing', 'deleting', 'linking');
      ['bDraw', 'bEdit', 'bDel', 'bLink'].forEach(id => document.getElementById(id).classList.remove('on'));

      const map = { draw: 'drawing', edit: 'editing', delete: 'deleting', link: 'linking' };
      const btnMap = { draw: 'bDraw', edit: 'bEdit', delete: 'bDel', link: 'bLink' };
      if (map[mode]) this.vp.classList.add(map[mode]);
      if (btnMap[mode]) document.getElementById(btnMap[mode]).classList.add('on');

      const names = { select: 'تحديد', draw: '🛤 رسم مسار', edit: '✏️ تعديل', delete: '🗑 حذف', link: '🔗 ربط' };
      document.getElementById('sMode').textContent = 'وضع: ' + (names[mode] || mode);
    }

    // ═══════════════════════════════════════════
    // DRAWING
    // ═══════════════════════════════════════════

    _addPoint(x, y) {
      if (!this._drawing) {
        const id = 'CL_' + this._nextId;
        this._drawing = { id, label: id, points: [{ x, y }], color: PALETTE[(this._nextId - 1) % PALETTE.length] };
      } else {
        const last = this._drawing.points[this._drawing.points.length - 1];
        if (Math.hypot(x - last.x, y - last.y) < this._hitTol()) {
          this._finishDrawing();
          return;
        }
        this._drawing.points.push({ x, y });
      }
      this._drawDrawing();
    }

    _drawPreview(x, y) {
      // Clear old preview
      const pv = this.gPreview;
      // Keep drawing lines + dots, just update rubber-band
      let rb = pv.querySelector('#rb-line');
      if (!rb) {
        rb = document.createElementNS(NS, 'line');
        rb.id = 'rb-line';
        rb.setAttribute('stroke-dasharray', '0.4 0.2');
        rb.setAttribute('stroke-width', '0.18');
        rb.setAttribute('opacity', '0.5');
        pv.appendChild(rb);
      }
      if (!this._drawing || this._drawing.points.length === 0) return;

      const last = this._drawing.points[this._drawing.points.length - 1];
      const lp = this._p2i(last.x, last.y);
      const cp = this._p2i(x, y);
      rb.setAttribute('x1', lp.x); rb.setAttribute('y1', lp.y);
      rb.setAttribute('x2', cp.x); rb.setAttribute('y2', cp.y);
      rb.setAttribute('stroke', this._drawing.color);

      // Preview dot
      let pd = pv.querySelector('#rb-dot');
      if (!pd) {
        pd = document.createElementNS(NS, 'circle');
        pd.id = 'rb-dot';
        pd.setAttribute('r', (POINT_R / 100) * this.imgW * 0.7);
        pd.setAttribute('opacity', '0.4');
        pv.appendChild(pd);
      }
      pd.setAttribute('cx', cp.x); pd.setAttribute('cy', cp.y);
      pd.setAttribute('fill', this._drawing.color);
    }

    _drawDrawing() {
      this.gPreview.innerHTML = '';
      if (!this._drawing) return;

      const pts = this._drawing.points;
      const color = this._drawing.color;
      const pr = (POINT_R / 100) * this.imgW;

      for (let i = 1; i < pts.length; i++) {
        const a = this._p2i(pts[i - 1].x, pts[i - 1].y);
        const b = this._p2i(pts[i].x, pts[i].y);
        const ln = document.createElementNS(NS, 'line');
        ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y);
        ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y);
        ln.setAttribute('stroke', color);
        ln.setAttribute('stroke-width', '0.22%');
        ln.setAttribute('opacity', '0.85');
        this.gPreview.appendChild(ln);
      }

      pts.forEach((p, i) => {
        const ip = this._p2i(p.x, p.y);
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', ip.x); c.setAttribute('cy', ip.y);
        c.setAttribute('r', pr);
        c.setAttribute('fill', i === 0 ? '#22c55e' : color);
        c.setAttribute('stroke', '#fff');
        c.setAttribute('stroke-width', pr * 0.18);
        this.gPreview.appendChild(c);
      });
    }

    _finishDrawing() {
      this.gPreview.innerHTML = '';
      if (!this._drawing) return;
      if (this._drawing.points.length < 2) {
        this._drawing = null;
        this._toast('⚠️ يلزم نقطتين على الأقل');
        return;
      }
      this._pushUndo();
      this._nextId++;
      this.centerlines.push(this._drawing);
      this._selIdx = this.centerlines.length - 1;
      this._drawing = null;
      this._redraw();
      this._toast('✅ تم إنشاء المسار');
    }

    // ═══════════════════════════════════════════
    // EDIT (drag)
    // ═══════════════════════════════════════════

    _doDrag(x, y) {
      if (!this._editDrag) return;
      this.centerlines[this._editDrag.lineIdx].points[this._editDrag.pointIdx] = { x, y };
      this._redraw();
    }

    // ═══════════════════════════════════════════
    // DELETE
    // ═══════════════════════════════════════════

    _deleteAt(x, y) {
      const hit = this._findPointAt(x, y);
      if (hit) {
        this._pushUndo();
        const line = this.centerlines[hit.li];
        line.points.splice(hit.pi, 1);
        if (line.points.length < 2) {
          this.centerlines.splice(hit.li, 1);
          this._toast('تم حذف المسار');
        } else {
          this._toast('تم حذف النقطة');
        }
        this._clampSel();
        this._redraw();
        return;
      }
      const li = this._findLineAt(x, y);
      if (li !== -1) {
        this._pushUndo();
        this.centerlines.splice(li, 1);
        this._clampSel();
        this._redraw();
        this._toast('تم حذف المسار');
      }
    }

    // ═══════════════════════════════════════════
    // LINK
    // ═══════════════════════════════════════════

    _linkAt(x, y) {
      const hit = this._findPointAt(x, y);
      if (!hit) { this._toast('انقر على نقطة'); return; }

      if (!this._linkFrom) {
        this._linkFrom = hit;
        this._toast('✓ النقطة الأولى — انقر نقطة من مسار آخر');
        return;
      }

      // Second point
      if (hit.li === this._linkFrom.li) {
        this._toast('⚠️ اختر نقطة من مسار مختلف');
        return;
      }

      this._pushUndo();
      this._junctions.push({
        from: { li: this._linkFrom.li, pi: this._linkFrom.pi },
        to: { li: hit.li, pi: hit.pi }
      });
      this._linkFrom = null;
      this._redraw();
      this._toast('🔗 تم الربط');
    }

    // ═══════════════════════════════════════════
    // SELECT
    // ═══════════════════════════════════════════

    _selectAt(x, y) {
      const hit = this._findPointAt(x, y);
      if (hit) { this._selIdx = hit.li; this._redraw(); return; }
      const li = this._findLineAt(x, y);
      if (li !== -1) { this._selIdx = li; this._redraw(); return; }
      this._selIdx = -1;
      this._redraw();
    }

    // ═══════════════════════════════════════════
    // HIT TESTING
    // ═══════════════════════════════════════════

    _findPointAt(x, y) {
      const tol = this._hitTol();
      for (let li = 0; li < this.centerlines.length; li++) {
        const pts = this.centerlines[li].points;
        for (let pi = 0; pi < pts.length; pi++) {
          if (Math.hypot(pts[pi].x - x, pts[pi].y - y) < tol) return { li, pi };
        }
      }
      return null;
    }

    _findLineAt(x, y) {
      const tol = this._hitTol();
      for (let li = 0; li < this.centerlines.length; li++) {
        const pts = this.centerlines[li].points;
        for (let i = 1; i < pts.length; i++) {
          if (this._ptSegDist(x, y, pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y) < tol) return li;
        }
      }
      return -1;
    }

    _ptSegDist(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      if (!l2) return Math.hypot(px - ax, py - ay);
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    _clampSel() {
      if (this._selIdx >= this.centerlines.length) this._selIdx = this.centerlines.length - 1;
    }

    // ═══════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════

    _redraw() {
      this._drawCenterlines();
      this._drawSnapLines();
      this._updatePanel();
      this._updateStatus();
    }

    _drawRooms() {
      this.gRooms.innerHTML = '';
      const data = window.MAP_DATA || [];
      data.forEach(room => {
        if (room.type === 'corridor') return; // Skip corridor polygons
        const pts = room.points.split(' ').map(p => {
          const [px, py] = p.split(',').map(Number);
          const ip = this._p2i(px, py);
          return `${ip.x},${ip.y}`;
        }).join(' ');

        const poly = document.createElementNS(NS, 'polygon');
        poly.setAttribute('points', pts);
        poly.setAttribute('fill', (room.color || '#888') + '22');
        poly.setAttribute('stroke', room.color || '#888');
        poly.setAttribute('stroke-width', '2');
        poly.classList.add('room-poly');
        this.gRooms.appendChild(poly);
      });
    }

    _drawDoors() {
      this.gDoors.innerHTML = '';
      const data = window.MAP_DATA || [];
      let doorCount = 0;
      data.forEach(room => {
        if (!room.doors || room.type === 'corridor') return;
        room.doors.forEach(door => {
          const ip = this._p2i(door.x, door.y);
          const r = Math.max(4, this.imgW * 0.003);
          const c = document.createElementNS(NS, 'circle');
          c.setAttribute('cx', ip.x); c.setAttribute('cy', ip.y);
          c.setAttribute('r', r);
          c.setAttribute('fill', '#ef4444');
          c.setAttribute('stroke', '#fff');
          c.setAttribute('stroke-width', r * 0.3);
          c.setAttribute('opacity', '0.7');
          c.classList.add('door-dot');
          const title = document.createElementNS(NS, 'title');
          title.textContent = `${room.id} — ${door.id} (${door.x}, ${door.y})`;
          c.appendChild(title);
          this.gDoors.appendChild(c);
          doorCount++;
        });
      });
      document.getElementById('sDoors').textContent = doorCount + ' باب';
    }

    _drawCenterlines() {
      this.gLines.innerHTML = '';
      this.gPoints.innerHTML = '';
      this.gLabels.innerHTML = '';

      const pr = Math.max(3, this.imgW * (POINT_R / 100));
      const prBig = Math.max(4, this.imgW * (POINT_R_BIG / 100));

      this.centerlines.forEach((cl, li) => {
        const sel = li === this._selIdx;
        const color = cl.color || '#3b82f6';
        const pts = cl.points;

        // Lines
        for (let i = 1; i < pts.length; i++) {
          const a = this._p2i(pts[i-1].x, pts[i-1].y);
          const b = this._p2i(pts[i].x, pts[i].y);
          const ln = document.createElementNS(NS, 'line');
          ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y);
          ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y);
          ln.setAttribute('stroke', color);
          ln.setAttribute('stroke-width', sel ? this.imgW * 0.003 : this.imgW * 0.002);
          ln.setAttribute('stroke-linecap', 'round');
          ln.setAttribute('opacity', sel ? '1' : '0.6');
          ln.classList.add('cl-line');
          this.gLines.appendChild(ln);
        }

        // Points
        pts.forEach((p, pi) => {
          const ip = this._p2i(p.x, p.y);
          const c = document.createElementNS(NS, 'circle');
          c.setAttribute('cx', ip.x); c.setAttribute('cy', ip.y);
          c.setAttribute('r', sel ? prBig : pr);
          c.setAttribute('fill', color);
          c.setAttribute('stroke', sel ? '#fff' : 'rgba(255,255,255,.5)');
          c.setAttribute('stroke-width', pr * 0.2);
          c.style.cursor = this.mode === 'edit' ? 'grab' : 'pointer';
          c.classList.add('cl-point');
          const title = document.createElementNS(NS, 'title');
          title.textContent = `${cl.id}[${pi}] (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
          c.appendChild(title);
          this.gPoints.appendChild(c);
        });

        // Label
        if (pts.length >= 2) {
          const mid = pts[Math.floor(pts.length / 2)];
          const ip = this._p2i(mid.x, mid.y);
          const t = document.createElementNS(NS, 'text');
          t.setAttribute('x', ip.x); t.setAttribute('y', ip.y - this.imgW * 0.008);
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('font-family', 'Cairo,sans-serif');
          t.setAttribute('font-size', this.imgW * 0.007);
          t.setAttribute('font-weight', '700');
          t.setAttribute('fill', color);
          t.setAttribute('opacity', '0.8');
          t.setAttribute('pointer-events', 'none');
          t.classList.add('room-lbl');
          t.textContent = cl.id;
          this.gLabels.appendChild(t);
        }
      });

      // Draw junctions
      this._junctions.forEach(j => {
        const clA = this.centerlines[j.from.li];
        const clB = this.centerlines[j.to.li];
        if (!clA || !clB) return;
        const pA = clA.points[j.from.pi];
        const pB = clB.points[j.to.pi];
        if (!pA || !pB) return;
        const a = this._p2i(pA.x, pA.y);
        const b = this._p2i(pB.x, pB.y);
        const ln = document.createElementNS(NS, 'line');
        ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y);
        ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y);
        ln.setAttribute('stroke', '#facc15');
        ln.setAttribute('stroke-width', this.imgW * 0.0015);
        ln.setAttribute('stroke-dasharray', `${this.imgW * 0.004} ${this.imgW * 0.002}`);
        ln.setAttribute('opacity', '0.7');
        ln.classList.add('cl-line');
        this.gLines.appendChild(ln);
      });
    }

    _drawSnapLines() {
      this.gSnap.innerHTML = '';
      if (!this.showSnaps || this.centerlines.length === 0) return;

      const data = window.MAP_DATA || [];
      const sw = Math.max(1.5, this.imgW * 0.001);
      const dr = Math.max(2, this.imgW * 0.002);

      data.forEach(room => {
        if (!room.doors || room.type === 'corridor') return;
        room.doors.forEach(door => {
          const snap = this._nearestEdgePt(door.x, door.y);
          if (!snap || snap.dist > 15) return;

          const dip = this._p2i(door.x, door.y);
          const sip = this._p2i(snap.x, snap.y);

          const ln = document.createElementNS(NS, 'line');
          ln.setAttribute('x1', dip.x); ln.setAttribute('y1', dip.y);
          ln.setAttribute('x2', sip.x); ln.setAttribute('y2', sip.y);
          ln.setAttribute('stroke', '#f59e0b');
          ln.setAttribute('stroke-width', sw);
          ln.setAttribute('stroke-dasharray', `${sw * 2} ${sw}`);
          ln.setAttribute('opacity', '0.5');
          ln.classList.add('snap-line');
          this.gSnap.appendChild(ln);

          const dot = document.createElementNS(NS, 'circle');
          dot.setAttribute('cx', sip.x); dot.setAttribute('cy', sip.y);
          dot.setAttribute('r', dr);
          dot.setAttribute('fill', '#f59e0b');
          dot.setAttribute('opacity', '0.5');
          dot.classList.add('snap-line');
          this.gSnap.appendChild(dot);
        });
      });
    }

    _nearestEdgePt(px, py) {
      let best = Infinity, pt = null;
      for (const cl of this.centerlines) {
        for (let i = 1; i < cl.points.length; i++) {
          const a = cl.points[i-1], b = cl.points[i];
          const dx = b.x - a.x, dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          if (!l2) continue;
          let t = ((px - a.x) * dx + (py - a.y) * dy) / l2;
          t = Math.max(0, Math.min(1, t));
          const cx = a.x + t * dx, cy = a.y + t * dy;
          const d = Math.hypot(px - cx, py - cy);
          if (d < best) { best = d; pt = { x: cx, y: cy, dist: d }; }
        }
      }
      return pt;
    }

    // ═══════════════════════════════════════════
    // SIDE PANEL
    // ═══════════════════════════════════════════

    _updatePanel() {
      const el = document.getElementById('cl-list');
      el.innerHTML = '';

      if (this.centerlines.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:24px 12px;color:var(--muted);font-size:.78rem"><div style="font-size:1.8rem;margin-bottom:6px">🛤</div>اضغط "رسم مسار" لإنشاء<br>خطوط التوجيه المركزية</div>';
        return;
      }

      this.centerlines.forEach((cl, i) => {
        const item = document.createElement('div');
        item.className = 'cli' + (i === this._selIdx ? ' sel' : '');
        item.innerHTML = `
          <div class="cli-dot" style="background:${cl.color}"></div>
          <div class="cli-info">
            <div class="cli-id">${cl.id}</div>
            <div class="cli-meta">${cl.points.length} نقطة</div>
          </div>
          <button class="cli-del" data-i="${i}">✕</button>
        `;

        item.addEventListener('click', e => {
          if (e.target.closest('.cli-del')) {
            this._pushUndo();
            this.centerlines.splice(i, 1);
            this._clampSel();
            this._redraw();
            return;
          }
          this._selIdx = i;
          this._redraw();
          // Center on midpoint
          const mid = cl.points[Math.floor(cl.points.length / 2)];
          if (mid) {
            const ip = this._p2i(mid.x, mid.y);
            const vw = this.vp.clientWidth, vh = this.vp.clientHeight;
            this.panX = vw / 2 - ip.x * this.scale;
            this.panY = vh / 2 - ip.y * this.scale;
            this._applyTransform();
          }
        });

        el.appendChild(item);
      });
    }

    // ═══════════════════════════════════════════
    // STATUS
    // ═══════════════════════════════════════════

    _updateStatus() {
      const total = this.centerlines.reduce((s, c) => s + c.points.length, 0);
      document.getElementById('sLines').textContent = this.centerlines.length + ' مسار';
      document.getElementById('sNodes').textContent = total + ' نقطة';
    }

    // ═══════════════════════════════════════════
    // UNDO / REDO
    // ═══════════════════════════════════════════

    _pushUndo() {
      this._undo.push(JSON.stringify({ cl: this.centerlines, j: this._junctions }));
      this._redo = [];
      if (this._undo.length > 50) this._undo.shift();
    }

    undo() {
      if (!this._undo.length) { this._toast('لا يوجد شيء للتراجع'); return; }
      this._redo.push(JSON.stringify({ cl: this.centerlines, j: this._junctions }));
      const st = JSON.parse(this._undo.pop());
      this.centerlines = st.cl;
      this._junctions = st.j || [];
      this._redraw();
      this._toast('↩ تراجع');
    }

    redo() {
      if (!this._redo.length) { this._toast('لا يوجد شيء للإعادة'); return; }
      this._undo.push(JSON.stringify({ cl: this.centerlines, j: this._junctions }));
      const st = JSON.parse(this._redo.pop());
      this.centerlines = st.cl;
      this._junctions = st.j || [];
      this._redraw();
      this._toast('↪ إعادة');
    }

    // ═══════════════════════════════════════════
    // IMPORT / EXPORT
    // ═══════════════════════════════════════════

    _toNavGraph() {
      const nodes = {}, edges = [];

      this.centerlines.forEach(cl => {
        cl.points.forEach((pt, i) => {
          const nid = `${cl.id}_${String(i).padStart(2, '0')}`;
          nodes[nid] = {
            x: Math.round(pt.x * 10) / 10,
            y: Math.round(pt.y * 10) / 10,
            type: 'waypoint',
            corridorId: cl.id
          };
          if (i > 0) {
            const pid = `${cl.id}_${String(i - 1).padStart(2, '0')}`;
            edges.push({ from: pid, to: nid });
          }
        });
      });

      // Auto-detect junctions (nearby endpoints from different lines)
      const ne = Object.entries(nodes);
      for (let i = 0; i < ne.length; i++) {
        for (let j = i + 1; j < ne.length; j++) {
          const [idA, nA] = ne[i], [idB, nB] = ne[j];
          if (nA.corridorId === nB.corridorId) continue;
          if (Math.hypot(nA.x - nB.x, nA.y - nB.y) < 1.0) {
            edges.push({ from: idA, to: idB });
          }
        }
      }

      // Manual junctions
      this._junctions.forEach(j => {
        const clA = this.centerlines[j.from.li];
        const clB = this.centerlines[j.to.li];
        if (!clA || !clB) return;
        const idA = `${clA.id}_${String(j.from.pi).padStart(2, '0')}`;
        const idB = `${clB.id}_${String(j.to.pi).padStart(2, '0')}`;
        // Avoid duplicates
        if (!edges.some(e => (e.from === idA && e.to === idB) || (e.from === idB && e.to === idA))) {
          edges.push({ from: idA, to: idB });
        }
      });

      // Door connections (auto-snap)
      const mapData = window.MAP_DATA || [];
      mapData.forEach(room => {
        if (!room.doors || room.type === 'corridor') return;
        room.doors.forEach(door => {
          const doorNodeId = `${room.id}__${door.id}`;
          const snap = this._nearestEdgePt(door.x, door.y);
          if (!snap || snap.dist > 15) return;

          // Find which edge segment it snapped to
          for (const cl of this.centerlines) {
            for (let i = 1; i < cl.points.length; i++) {
              const a = cl.points[i-1], b = cl.points[i];
              const dx = b.x - a.x, dy = b.y - a.y;
              const l2 = dx * dx + dy * dy;
              if (!l2) continue;
              let t = ((door.x - a.x) * dx + (door.y - a.y) * dy) / l2;
              t = Math.max(0, Math.min(1, t));
              const cx = a.x + t * dx, cy = a.y + t * dy;
              if (Math.hypot(cx - snap.x, cy - snap.y) < 0.01) {
                // Found the edge — connect to nearest endpoint
                const dA = Math.hypot(snap.x - a.x, snap.y - a.y);
                const dB = Math.hypot(snap.x - b.x, snap.y - b.y);
                const nearIdx = dA <= dB ? i - 1 : i;
                const nearId = `${cl.id}_${String(nearIdx).padStart(2, '0')}`;
                edges.push({ from: doorNodeId, to: nearId });
                return; // done with this door
              }
            }
          }
        });
      });

      return { nodes, edges };
    }

    _showExport() {
      const ng = this._toNavGraph();
      const json = JSON.stringify(ng, null, 2);
      document.getElementById('mTitle').textContent = '📤 تصدير NAV_GRAPH';
      document.getElementById('mCode').textContent = json;
      document.getElementById('modal-bg').classList.add('on');
      document.getElementById('mOk').textContent = '📋 نسخ';
      document.getElementById('mOk').onclick = () => {
        navigator.clipboard.writeText(json).then(() => {
          this._toast('✅ تم النسخ');
          document.getElementById('modal-bg').classList.remove('on');
        }).catch(() => {
          // Fallback
          const range = document.createRange();
          range.selectNodeContents(document.getElementById('mCode'));
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('copy');
          this._toast('✅ تم النسخ');
          document.getElementById('modal-bg').classList.remove('on');
        });
      };
    }

    _showImport() {
      document.getElementById('mTitle').textContent = '📥 استيراد NAV_GRAPH JSON';
      document.getElementById('mCode').textContent = '';
      document.getElementById('mCode').contentEditable = 'true';
      document.getElementById('mCode').style.color = '#e2e4ea';
      document.getElementById('modal-bg').classList.add('on');
      document.getElementById('mOk').textContent = '📥 استيراد';
      document.getElementById('mOk').onclick = () => {
        const text = document.getElementById('mCode').textContent.trim();
        document.getElementById('mCode').contentEditable = 'false';
        document.getElementById('mCode').style.color = '';
        if (!text) { this._toast('⚠️ فارغ'); return; }
        try {
          const data = JSON.parse(text);
          this._importNavGraph(data);
          document.getElementById('modal-bg').classList.remove('on');
          this._toast('✅ تم الاستيراد');
        } catch (err) { this._toast('❌ JSON غير صالح: ' + err.message); }
      };
    }

    _importNavGraph(ng) {
      this._pushUndo();
      const nodes = ng.nodes || {};
      const edges = ng.edges || [];

      // Group by corridorId
      const corridors = {};
      for (const [id, n] of Object.entries(nodes)) {
        if (n.type !== 'waypoint') continue;
        const cid = n.corridorId || 'UNK';
        if (!corridors[cid]) corridors[cid] = [];
        corridors[cid].push({ id, ...n });
      }

      // Build same-corridor adjacency
      const adj = {};
      edges.forEach(e => {
        const nA = nodes[e.from], nB = nodes[e.to];
        if (!nA || !nB || nA.corridorId !== nB.corridorId) return;
        if (!adj[e.from]) adj[e.from] = [];
        if (!adj[e.to]) adj[e.to] = [];
        adj[e.from].push(e.to);
        adj[e.to].push(e.from);
      });

      this.centerlines = [];
      let ci = 0;

      for (const [cid, pts] of Object.entries(corridors)) {
        if (pts.length < 2) continue;

        // Find chain endpoint
        let start = pts[0].id;
        for (const p of pts) {
          const nbrs = (adj[p.id] || []).filter(n => nodes[n]?.corridorId === cid);
          if (nbrs.length <= 1) { start = p.id; break; }
        }

        // DFS chain
        const ordered = [];
        const visited = new Set();
        const stack = [start];
        while (stack.length) {
          const cur = stack.pop();
          if (visited.has(cur)) continue;
          visited.add(cur);
          const nd = nodes[cur];
          if (nd && nd.corridorId === cid) ordered.push({ x: nd.x, y: nd.y });
          const nbrs = (adj[cur] || []).filter(n => !visited.has(n) && nodes[n]?.corridorId === cid);
          nbrs.sort((a, b) => {
            const na = nodes[a], nb = nodes[b], nc = nodes[cur];
            return Math.hypot(na.x - nc.x, na.y - nc.y) - Math.hypot(nb.x - nc.x, nb.y - nc.y);
          });
          stack.push(...nbrs);
        }

        if (ordered.length >= 2) {
          this.centerlines.push({
            id: cid,
            label: cid,
            points: ordered,
            color: PALETTE[ci++ % PALETTE.length]
          });
        }
      }

      this._nextId = this.centerlines.length + 1;
      this._redraw();
    }

    _autoImport() {
      const ng = window.NAV_GRAPH;
      if (!ng || !ng.nodes) return;
      const wps = Object.values(ng.nodes).filter(n => n.type === 'waypoint');
      if (!wps.length) return;
      this._importNavGraph(ng);
    }

    // ═══════════════════════════════════════════
    // CLEAR ALL
    // ═══════════════════════════════════════════

    _clearAll() {
      if (!this.centerlines.length) return;
      if (!confirm('حذف جميع المسارات؟')) return;
      this._pushUndo();
      this.centerlines = [];
      this._junctions = [];
      this._selIdx = -1;
      this._redraw();
      this._toast('🧹 تم المسح');
    }

    // ═══════════════════════════════════════════
    // TOAST
    // ═══════════════════════════════════════════

    _toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('on');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => t.classList.remove('on'), 2500);
    }
  }

  // ═══════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    // Wait for MAP_DATA to be available
    const init = () => {
      if (window.MAP_DATA) {
        window.mapTool = new MapToolEngine();
      } else {
        setTimeout(init, 50);
      }
    };
    init();
  });

})();
