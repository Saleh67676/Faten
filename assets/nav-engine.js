// =================================================================
// UQU Indoor Navigation Engine v2.2 — A* with MinHeap + Edge Index
// Optimized: O(n log n) pathfinding, pre-built edge index for snapping
// =================================================================
(function () {
  'use strict';

  const METERS_PER_UNIT = 1.2;
  const WALK_SPEED_MPS  = 1.2;
  const MAX_ITER        = 20000; // safety valve against runaway A*

  // ── Binary min-heap priority queue for A* open set ──
  // Replaces the O(n log n) sort-per-iteration with O(log n) push/pop
  class MinHeap {
    constructor() { this._d = []; }
    get size() { return this._d.length; }
    push(item) {
      this._d.push(item);
      let i = this._d.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this._d[p].f <= this._d[i].f) break;
        const t = this._d[p]; this._d[p] = this._d[i]; this._d[i] = t;
        i = p;
      }
    }
    pop() {
      const top = this._d[0];
      const last = this._d.pop();
      if (this._d.length) {
        this._d[0] = last;
        let i = 0;
        for (;;) {
          const l = 2*i+1, r = 2*i+2, n = this._d.length;
          let m = i;
          if (l < n && this._d[l].f < this._d[m].f) m = l;
          if (r < n && this._d[r].f < this._d[m].f) m = r;
          if (m === i) break;
          const t = this._d[m]; this._d[m] = this._d[i]; this._d[i] = t;
          i = m;
        }
      }
      return top;
    }
  }

  // =================================================================
  class NavEngine {
    constructor() {
      this.nodes    = {};
      this.adj      = {};
      this._edgeList = []; // pre-built flat list of corridor edges for O(e) snapping
      this._built   = false;
    }

    buildGraph() {
      const mapData  = window.MAP_DATA  || [];
      const navGraph = window.NAV_GRAPH || { nodes: {}, edges: [] };

      this.nodes    = {};
      this.adj      = {};
      this._edgeList = [];

      // 1. Door nodes from MAP_DATA
      for (const room of mapData) {
        if (!room.doors) continue;
        for (const door of room.doors) {
          const id = `${room.id}__${door.id}`;
          this.nodes[id] = {
            x: door.x, y: door.y,
            roomId: room.id,
            type: room.type === 'stairs' ? 'stairs' : 'door',
          };
        }
      }

      // 2. Waypoints from NAV_GRAPH
      for (const id of Object.keys(navGraph.nodes)) {
        this.nodes[id] = { ...navGraph.nodes[id] };
      }

      // 3. Adjacency from edges
      for (const id of Object.keys(this.nodes)) this.adj[id] = [];
      for (const edge of navGraph.edges) {
        const a = this.nodes[edge.from];
        const b = this.nodes[edge.to];
        if (!a || !b) continue;
        const w   = edge.weight != null ? edge.weight : Math.hypot(a.x - b.x, a.y - b.y);
        const acc = edge.accessible !== false;
        this.adj[edge.from].push({ to: edge.to,   weight: w, accessible: acc });
        if (!edge.oneWay) {
          this.adj[edge.to].push({ to: edge.from, weight: w, accessible: acc });
        }
      }

      // 4. Build flat edge list BEFORE snapping (only original corridor edges)
      this._buildEdgeIndex();

      // 5. Snap door nodes to nearest corridor edge
      this._autoSnapDoors();

      this._built = true;
      console.log(`✓ NavEngine graph: ${Object.keys(this.nodes).length} nodes, ${this._edgeList.length} corridor edges`);
    }

    // Build a de-duplicated flat array of corridor edges for O(e) snapping.
    // Called once at build time, so no repeated Set construction during search.
    _buildEdgeIndex() {
      const seen = new Set();
      for (const u of Object.keys(this.adj)) {
        const nu = this.nodes[u];
        if (!nu || nu.type === 'door' || nu.type === 'stairs') continue;
        for (const edge of this.adj[u]) {
          const v  = edge.to;
          const nv = this.nodes[v];
          if (!nv || nv.type === 'door' || nv.type === 'stairs') continue;
          const key = u < v ? `${u}|${v}` : `${v}|${u}`;
          if (seen.has(key)) continue;
          seen.add(key);
          this._edgeList.push({ u, v, ax: nu.x, ay: nu.y, bx: nv.x, by: nv.y });
        }
      }
    }

    _autoSnapDoors() {
      const manuallyConnected = new Set();
      for (const e of (window.NAV_GRAPH?.edges || [])) {
        if (e.from.includes('__')) manuallyConnected.add(e.from);
        if (e.to.includes('__'))   manuallyConnected.add(e.to);
      }

      // Snapshot door IDs before mutating this.nodes
      const doorIds = Object.keys(this.nodes).filter(id => {
        const n = this.nodes[id];
        return (n.type === 'door' || n.type === 'stairs') && !manuallyConnected.has(id);
      });

      for (const nodeId of doorIds) {
        const node = this.nodes[nodeId];
        const snap = this._snapToEdgeFast(node.x, node.y);

        if (snap && snap.dist < 15) {
          const snapId = `${nodeId}_snap`;
          this.nodes[snapId] = { x: snap.x, y: snap.y, type: 'snap' };
          this.adj[snapId]   = [];

          const w = Math.hypot(node.x - snap.x, node.y - snap.y);
          this.adj[nodeId].push({ to: snapId, weight: w, accessible: true });
          this.adj[snapId].push({ to: nodeId, weight: w, accessible: true });
          this._splitEdge(snap.u, snap.v, snapId);
        } else {
          // Fallback: connect directly to nearest non-door waypoint
          let best = null, bestD = Infinity;
          for (const id of Object.keys(this.nodes)) {
            const n = this.nodes[id];
            if (n.type === 'door' || n.type === 'stairs' || n.type === 'snap') continue;
            const d = Math.hypot(n.x - node.x, n.y - node.y);
            if (d < bestD) { bestD = d; best = id; }
          }
          if (best && bestD < 30) {
            this.adj[nodeId].push({ to: best, weight: bestD, accessible: true });
            this.adj[best].push({ to: nodeId, weight: bestD, accessible: true });
          }
        }
      }
    }

    // O(e) snap using pre-built edge index — no Set allocation per call
    _snapToEdgeFast(x, y) {
      let best = null, bestDist = Infinity;
      for (const edge of this._edgeList) {
        const proj = this._projectOnEdge(x, y, edge.ax, edge.ay, edge.bx, edge.by);
        if (proj.dist < bestDist) {
          bestDist = proj.dist;
          best = { x: proj.x, y: proj.y, dist: proj.dist, u: edge.u, v: edge.v };
        }
      }
      return best;
    }

    _projectOnEdge(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const l2 = dx*dx + dy*dy;
      if (l2 === 0) return { x: ax, y: ay, dist: Math.hypot(px-ax, py-ay) };
      let t = ((px-ax)*dx + (py-ay)*dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + t*dx, cy = ay + t*dy;
      return { x: cx, y: cy, dist: Math.hypot(px-cx, py-cy) };
    }

    // Keep _project alias for internal callers that use the old signature
    _project(px, py, a, b) {
      return this._projectOnEdge(px, py, a.x, a.y, b.x, b.y);
    }

    _splitEdge(u, v, sId) {
      this.adj[u] = this.adj[u].filter(e => e.to !== v);
      this.adj[v] = this.adj[v].filter(e => e.to !== u);
      const w1 = Math.hypot(this.nodes[u].x - this.nodes[sId].x, this.nodes[u].y - this.nodes[sId].y);
      const w2 = Math.hypot(this.nodes[v].x - this.nodes[sId].x, this.nodes[v].y - this.nodes[sId].y);
      this.adj[u].push({ to: sId, weight: w1, accessible: true });
      this.adj[sId].push({ to: u,   weight: w1, accessible: true });
      this.adj[sId].push({ to: v,   weight: w2, accessible: true });
      this.adj[v].push({ to: sId, weight: w2, accessible: true });
    }

    // =================================================================
    // A* Pathfinding — O(n log n) with binary min-heap + closed set
    // =================================================================
    findPath(fromRoomId, toRoomId, options = {}) {
      if (!this._built) this.buildGraph();

      // Resolve start node
      let startNode = null;
      if (options.fromNodeId) {
        startNode = options.fromNodeId;
      } else {
        const room = (window.MAP_DATA || []).find(r => r.id === fromRoomId);
        if (room && room.doors && room.doors.length > 0) {
          startNode = `${room.id}__${room.doors[0].id}`;
        }
      }

      // Resolve end node
      const targetRoom = (window.MAP_DATA || []).find(r => r.id === toRoomId);
      if (!targetRoom || !targetRoom.doors || !targetRoom.doors.length) return null;
      const endNode = `${targetRoom.id}__${targetRoom.doors[0].id}`;

      if (!startNode || !this.nodes[startNode] || !this.nodes[endNode]) return null;

      const goal  = this.nodes[endNode];
      const h     = (id) => { const n = this.nodes[id]; return Math.hypot(n.x - goal.x, n.y - goal.y); };

      const heap     = new MinHeap();
      const cameFrom = Object.create(null);
      const gScore   = Object.create(null);
      const closed   = new Set();

      gScore[startNode] = 0;
      heap.push({ id: startNode, f: h(startNode) });

      let iter = 0;
      while (heap.size > 0) {
        if (++iter > MAX_ITER) { console.warn('NavEngine: A* hit iteration limit'); break; }

        const { id: cur } = heap.pop();
        if (cur === endNode) return this._buildResult(this._reconstructIds(cameFrom, endNode));
        if (closed.has(cur)) continue;
        closed.add(cur);

        const neighbors = this.adj[cur];
        if (!neighbors) continue;
        const gCur = gScore[cur];

        for (let i = 0; i < neighbors.length; i++) {
          const edge = neighbors[i];
          if (options.accessible && !edge.accessible) continue;
          const nb = edge.to;
          if (closed.has(nb)) continue;
          const g = gCur + edge.weight;
          if (g < (gScore[nb] ?? Infinity)) {
            cameFrom[nb] = cur;
            gScore[nb]   = g;
            heap.push({ id: nb, f: g + h(nb) });
          }
        }
      }
      return null;
    }

    /** Route from a specific nav-graph node ID (entrance waypoint or free-point snap). */
    findPathFromNode(fromNodeId, toRoomId, options = {}) {
      return this.findPath(null, toRoomId, { ...options, fromNodeId });
    }

    _reconstructIds(cameFrom, current) {
      const path = [current];
      while (current in cameFrom) { current = cameFrom[current]; path.unshift(current); }
      return path;
    }

    _buildResult(nodeIds) {
      const pulledIds = this._stringPull(nodeIds);
      const points = pulledIds.map(id => ({ x: this.nodes[id].x, y: this.nodes[id].y, id }));

      let dist = 0;
      for (let i = 1; i < points.length; i++) {
        dist += Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y);
      }
      const distMeters = Math.round(dist * METERS_PER_UNIT);

      return {
        nodeIds: pulledIds,
        points,
        distanceMeters: distMeters,
        estimatedTime:  this._formatTime(distMeters / WALK_SPEED_MPS),
        steps:          this._generateSteps(pulledIds),
        smoothPoints:   this._smoothPath(points),
      };
    }

    _stringPull(ids) {
      if (ids.length <= 2) return ids;
      const result = [ids[0]];
      let anchor = 0;
      while (anchor < ids.length - 1) {
        let farthest = anchor + 1;
        for (let i = anchor + 2; i < ids.length; i++) {
          if (this._canSkip(ids[anchor], ids[i])) farthest = i;
          else break;
        }
        result.push(ids[farthest]);
        anchor = farthest;
      }
      return result;
    }

    _canSkip(idA, idB) {
      // All nodes currently share corridorId:"CL_MAIN" so the corridorId check
      // would collapse the entire path into a single straight line (wall-cutting).
      // Disable string-pull until per-segment corridorIds are assigned.
      return false;
    }

    _generateSteps(ids) {
      const steps = [];
      const start = this.nodes[ids[0]];
      if (start.roomId) {
        const room = (window.MAP_DATA || []).find(r => r.id === start.roomId);
        steps.push({ text: `اخرج من ${room?.label || start.roomId}`, icon: '🚪' });
      }
      if (ids.length > 2) steps.push({ text: 'أكمل السير في الممر', icon: '🚶' });
      const end = this.nodes[ids[ids.length - 1]];
      if (end.roomId) {
        const room = (window.MAP_DATA || []).find(r => r.id === end.roomId);
        steps.push({ text: `ادخل ${room?.label || end.roomId}`, icon: '📍' });
      }
      return steps;
    }

    _formatTime(s) {
      if (s < 60) return 'أقل من دقيقة';
      return `${Math.round(s / 60)} دقيقة`;
    }

    _smoothPath(points) {
      if (points.length <= 2) return points;
      const result = [points[0]];
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i+1];
        for (let t = 0.2; t <= 1.0; t += 0.2) {
          result.push({ x: p1.x + (p2.x - p1.x)*t, y: p1.y + (p2.y - p1.y)*t });
        }
      }
      return result;
    }

    findNearestNode(x, y) {
      if (!this._built) this.buildGraph();
      let best = null, bestD = Infinity;
      for (const id of Object.keys(this.nodes)) {
        const n = this.nodes[id];
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < bestD) { bestD = d; best = { nodeId: id, distance: d, x: n.x, y: n.y }; }
      }
      return best;
    }

    snapToNearestEdge(x, y) {
      if (!this._built) this.buildGraph();
      const snap = this._snapToEdgeFast(x, y);
      if (snap) return { nodeId: snap.u, distance: snap.dist, x: snap.x, y: snap.y };
      return this.findNearestNode(x, y);
    }

    toSvgPath(pts) {
      if (pts.length < 2) return '';
      return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
    }
  }

  // =================================================================
  class NavRenderer {
    constructor(svg) {
      this.svg = svg;
      this._highlighted = new Set(); // tracks which roomIds are currently highlighted
      this._ensureOverlay();
    }

    _ensureOverlay() {
      this.overlay = this.svg.querySelector('#nav-overlay') || (() => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.id = 'nav-overlay';
        this.svg.appendChild(g);
        return g;
      })();
    }

    drawRoute(res, engine) {
      this.clearRoute();
      if (!res || !res.points || res.points.length < 2) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', engine.toSvgPath(res.smoothPoints || res.points));
      path.setAttribute('stroke', '#6366f1');
      path.setAttribute('stroke-width', '0.6');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-dasharray', '1 0.5');
      this.overlay.appendChild(path);

      [res.points[0], res.points[res.points.length - 1]].forEach((p, i) => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', p.x);
        c.setAttribute('cy', p.y);
        c.setAttribute('r', '0.8');
        c.setAttribute('fill', i === 0 ? '#22c55e' : '#ef4444');
        this.overlay.appendChild(c);
      });
    }

    clearRoute() { this.overlay.innerHTML = ''; }

    /** Highlight a room polygon with a given colour. Tracks highlighted rooms. */
    highlightRoom(engine, roomId, color) {
      const entry = engine._roomGroups.get(roomId);
      if (!entry) return;
      const poly = entry.group.querySelector('polygon');
      if (!poly) return;
      poly.style.fill        = color + '55';
      poly.style.stroke      = color;
      poly.style.strokeWidth = '0.3';
      this._highlighted.add(roomId);
    }

    /** Clear one room's highlight without touching others. */
    clearHighlight(engine, roomId) {
      if (!this._highlighted.has(roomId)) return;
      const entry = engine._roomGroups.get(roomId);
      if (!entry) { this._highlighted.delete(roomId); return; }
      if (engine.selectedRoom === entry.group) return; // don't clear the selected room
      const poly = entry.group.querySelector('polygon');
      if (poly) {
        poly.style.fill        = 'transparent';
        poly.style.stroke      = 'transparent';
        poly.style.strokeWidth = '0.15';
      }
      this._highlighted.delete(roomId);
    }

    /** Clear ONLY the rooms that were highlighted — O(highlighted) not O(all rooms). */
    clearAllHighlights(engine) {
      for (const roomId of [...this._highlighted]) {
        this.clearHighlight(engine, roomId);
      }
    }
  }

  window.NavEngine  = NavEngine;
  window.NavRenderer = NavRenderer;
})();
