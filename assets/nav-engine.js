// =================================================================
// UQU Indoor Navigation Engine — A* Pathfinding + Route Rendering
// =================================================================
(function () {
  'use strict';

  // ── Walking speed calibration ──
  // Building is ~120m wide. Map is 0–100%. So 1% ≈ 1.2m
  const METERS_PER_UNIT = 1.2;
  const WALK_SPEED_MPS  = 1.2; // average walking speed

  // ── Min-Heap for A* open set ──
  class MinHeap {
    constructor() { this.data = []; }
    push(item) {
      this.data.push(item);
      this._bubbleUp(this.data.length - 1);
    }
    pop() {
      const top = this.data[0];
      const last = this.data.pop();
      if (this.data.length > 0) {
        this.data[0] = last;
        this._sinkDown(0);
      }
      return top;
    }
    get size() { return this.data.length; }
    _bubbleUp(i) {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.data[p].f <= this.data[i].f) break;
        [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
        i = p;
      }
    }
    _sinkDown(i) {
      const n = this.data.length;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
        if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
        if (smallest === i) break;
        [this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
        i = smallest;
      }
    }
  }

  // ── NavEngine class ──
  class NavEngine {
    constructor() {
      this.nodes = {};     // nodeId → { x, y, roomId?, type }
      this.adj   = {};     // nodeId → [{ to, weight, accessible }]
      this._built = false;
    }

    // Build graph from MAP_DATA doors + NAV_GRAPH waypoints/edges
    buildGraph() {
      const mapData  = window.MAP_DATA || [];
      const navGraph = window.NAV_GRAPH || { nodes: {}, edges: [] };

      // 1. Create door nodes from MAP_DATA
      mapData.forEach(room => {
        if (!room.doors) return;
        room.doors.forEach(door => {
          const nodeId = room.id + '__' + door.id;
          this.nodes[nodeId] = {
            x: door.x,
            y: door.y,
            roomId: room.id,
            type: room.type === 'stairs' ? 'stairs' : 'door'
          };
        });
      });

      // 2. Merge manually-defined waypoint nodes
      Object.keys(navGraph.nodes).forEach(id => {
        this.nodes[id] = { ...navGraph.nodes[id] };
      });

      // 3. Build adjacency list from edges
      Object.keys(this.nodes).forEach(id => { this.adj[id] = []; });

      navGraph.edges.forEach(edge => {
        const a = this.nodes[edge.from];
        const b = this.nodes[edge.to];
        if (!a || !b) return;

        // Auto-calculate weight if null
        const weight = edge.weight != null
          ? edge.weight
          : Math.hypot(a.x - b.x, a.y - b.y);

        const accessible = edge.accessible !== false;

        this.adj[edge.from].push({ to: edge.to, weight, accessible });

        // Bidirectional unless oneWay
        if (!edge.oneWay) {
          this.adj[edge.to].push({ to: edge.from, weight, accessible });
        }
      });

      // 4. Auto-snap doors that have no manual edge to nearest centerline
      this._autoSnapDoors();

      this._built = true;
    }

    // ── Project point P onto segment AB, return closest point + distance ──
    _projectPointOnSegment(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return { x: ax, y: ay, dist: Math.hypot(px - ax, py - ay), t: 0 };
      let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy;
      return { x: cx, y: cy, dist: Math.hypot(px - cx, py - cy), t };
    }

    // ── Find nearest centerline edge for a door position ──
    _snapDoorToEdge(doorX, doorY) {
      let bestDist = Infinity, bestPoint = null, bestNodeA = null, bestNodeB = null;
      const visited = new Set();

      for (const nodeId of Object.keys(this.adj)) {
        const nodeA = this.nodes[nodeId];
        if (!nodeA) continue;
        // Only snap to waypoint/snap edges (centerline), not door→door
        if (nodeA.type === 'door' || nodeA.type === 'stairs') continue;

        for (const neighbor of this.adj[nodeId]) {
          const nodeB = this.nodes[neighbor.to];
          if (!nodeB) continue;
          if (nodeB.type === 'door' || nodeB.type === 'stairs') continue;

          // Avoid checking same edge twice
          const edgeKey = nodeId < neighbor.to ? nodeId + '|' + neighbor.to : neighbor.to + '|' + nodeId;
          if (visited.has(edgeKey)) continue;
          visited.add(edgeKey);

          const proj = this._projectPointOnSegment(doorX, doorY, nodeA.x, nodeA.y, nodeB.x, nodeB.y);
          if (proj.dist < bestDist) {
            bestDist = proj.dist;
            bestPoint = { x: proj.x, y: proj.y };
            bestNodeA = nodeId;
            bestNodeB = neighbor.to;
          }
        }
      }

      return { point: bestPoint, dist: bestDist, edgeNodeA: bestNodeA, edgeNodeB: bestNodeB };
    }

    // ── Split edge A→B by inserting node S in between ──
    _splitEdge(nodeA, nodeB, snapId) {
      const sNode = this.nodes[snapId];
      const aNode = this.nodes[nodeA];
      const bNode = this.nodes[nodeB];
      if (!sNode || !aNode || !bNode) return;

      const wAS = Math.hypot(sNode.x - aNode.x, sNode.y - aNode.y);
      const wSB = Math.hypot(bNode.x - sNode.x, bNode.y - sNode.y);

      // Remove A→B edge from adjacency
      if (this.adj[nodeA]) {
        this.adj[nodeA] = this.adj[nodeA].filter(e => e.to !== nodeB);
      }
      if (this.adj[nodeB]) {
        this.adj[nodeB] = this.adj[nodeB].filter(e => e.to !== nodeA);
      }

      // Add A→S and S→B
      this.adj[nodeA].push({ to: snapId, weight: wAS, accessible: true });
      this.adj[snapId].push({ to: nodeA, weight: wAS, accessible: true });
      this.adj[snapId].push({ to: nodeB, weight: wSB, accessible: true });
      this.adj[nodeB].push({ to: snapId, weight: wSB, accessible: true });
    }

    // ── Auto-snap all unconnected doors to nearest centerline edge ──
    _autoSnapDoors() {
      // Collect doors that already have manual edge connections
      const manuallyConnected = new Set();
      const navGraph = window.NAV_GRAPH || { nodes: {}, edges: [] };
      navGraph.edges.forEach(e => {
        if (e.from.includes('__')) manuallyConnected.add(e.from);
        if (e.to.includes('__'))   manuallyConnected.add(e.to);
      });

      for (const [doorNodeId, doorNode] of Object.entries(this.nodes)) {
        if (doorNode.type !== 'door' && doorNode.type !== 'stairs') continue;
        if (manuallyConnected.has(doorNodeId)) continue; // has manual edge

        const snap = this._snapDoorToEdge(doorNode.x, doorNode.y);
        if (!snap.point || snap.dist > 15) continue; // too far, skip

        // Create a snap node on the centerline
        const snapId = doorNodeId + '_snap';
        this.nodes[snapId] = {
          x: snap.point.x,
          y: snap.point.y,
          type: 'snap',
          corridorId: this.nodes[snap.edgeNodeA]?.corridorId || null
        };

        // Connect door ↔ snap point
        const doorToSnap = Math.hypot(doorNode.x - snap.point.x, doorNode.y - snap.point.y);
        this.adj[snapId] = [];
        this.adj[doorNodeId].push({ to: snapId, weight: doorToSnap, accessible: true });
        this.adj[snapId].push({ to: doorNodeId, weight: doorToSnap, accessible: true });

        // Split the centerline edge A→B at the snap point
        this._splitEdge(snap.edgeNodeA, snap.edgeNodeB, snapId);
      }
    }

    // Get the best door node for a room (first door)
    getNodeForRoom(roomId) {
      const mapData = window.MAP_DATA || [];
      const room = mapData.find(r => r.id === roomId);
      if (!room || !room.doors || room.doors.length === 0) return null;
      return roomId + '__' + room.doors[0].id;
    }

    // A* pathfinding
    findPath(fromRoomId, toRoomId, options = {}) {
      if (!this._built) this.buildGraph();

      const startNode = this.getNodeForRoom(fromRoomId);
      const endNode   = this.getNodeForRoom(toRoomId);
      if (!startNode || !endNode) return null;
      if (startNode === endNode) return this._buildResult([startNode]);

      const accessibleOnly = !!options.accessible;
      const goal = this.nodes[endNode];

      // Heuristic: Euclidean distance
      const h = (id) => {
        const n = this.nodes[id];
        return Math.hypot(n.x - goal.x, n.y - goal.y);
      };

      const open = new MinHeap();
      const gScore = {};
      const cameFrom = {};
      const closed = new Set();

      gScore[startNode] = 0;
      open.push({ id: startNode, f: h(startNode) });

      while (open.size > 0) {
        const current = open.pop();
        if (current.id === endNode) {
          return this._reconstructPath(cameFrom, endNode);
        }

        if (closed.has(current.id)) continue;
        closed.add(current.id);

        const neighbors = this.adj[current.id] || [];
        for (const edge of neighbors) {
          if (closed.has(edge.to)) continue;
          if (accessibleOnly && !edge.accessible) continue;

          const tentG = gScore[current.id] + edge.weight;
          if (tentG < (gScore[edge.to] ?? Infinity)) {
            gScore[edge.to] = tentG;
            cameFrom[edge.to] = current.id;
            open.push({ id: edge.to, f: tentG + h(edge.to) });
          }
        }
      }

      return null; // No path found
    }

    /**
     * Find path from a raw waypoint node ID (e.g., an entrance) to a room.
     * Unlike findPath(), this accepts a node ID directly instead of a room ID.
     */
    findPathFromNode(startNodeId, toRoomId, options = {}) {
      if (!this._built) this.buildGraph();

      const endNode = this.getNodeForRoom(toRoomId);
      if (!startNodeId || !endNode) return null;
      if (!this.nodes[startNodeId]) return null;
      if (startNodeId === endNode) return this._buildResult([startNodeId]);

      const accessibleOnly = !!options.accessible;
      const goal = this.nodes[endNode];
      const h = (id) => {
        const n = this.nodes[id];
        return Math.hypot(n.x - goal.x, n.y - goal.y);
      };

      const open = new MinHeap();
      const gScore = {};
      const cameFrom = {};
      const closed = new Set();

      gScore[startNodeId] = 0;
      open.push({ id: startNodeId, f: h(startNodeId) });

      while (open.size > 0) {
        const current = open.pop();
        if (current.id === endNode) {
          return this._reconstructPath(cameFrom, endNode);
        }
        if (closed.has(current.id)) continue;
        closed.add(current.id);

        const neighbors = this.adj[current.id] || [];
        for (const edge of neighbors) {
          if (closed.has(edge.to)) continue;
          if (accessibleOnly && !edge.accessible) continue;

          const tentG = gScore[current.id] + edge.weight;
          if (tentG < (gScore[edge.to] ?? Infinity)) {
            gScore[edge.to] = tentG;
            cameFrom[edge.to] = current.id;
            open.push({ id: edge.to, f: tentG + h(edge.to) });
          }
        }
      }

      return null;
    }

    /**
     * Get route as array of line segments [[start, end], ...] for snap-to-route.
     */
    getRouteSegments(routeResult) {
      if (!routeResult || !routeResult.points) return [];
      return routeResult.points
        .map((p, i, arr) => i < arr.length - 1 ? [p, arr[i + 1]] : null)
        .filter(Boolean);
    }

    /**
     * Find the nearest graph node to a given map% point.
     * Useful for free-point routing (click anywhere on map).
     * @returns {{ nodeId: string, distance: number }|null}
     */
    findNearestNode(x, y) {
      if (!this._built) this.buildGraph();
      let bestId = null;
      let bestDist = Infinity;
      for (const [id, node] of Object.entries(this.nodes)) {
        const d = Math.hypot(node.x - x, node.y - y);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }
      return bestId ? { nodeId: bestId, distance: bestDist } : null;
    }

    /**
     * Snap a point to the nearest edge in the graph.
     * Returns the closest endpoint node of that edge.
     * @returns {{ nodeId: string, point: {x,y}, distance: number }|null}
     */
    snapToNearestEdge(x, y) {
      if (!this._built) this.buildGraph();
      let bestDist = Infinity;
      let bestNodeId = null;
      let bestPoint = null;

      for (const [fromId, edges] of Object.entries(this.adj)) {
        const fromNode = this.nodes[fromId];
        for (const edge of edges) {
          const toNode = this.nodes[edge.to];
          if (!fromNode || !toNode) continue;

          // Project point onto segment
          const dx = toNode.x - fromNode.x;
          const dy = toNode.y - fromNode.y;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) continue;

          let t = ((x - fromNode.x) * dx + (y - fromNode.y) * dy) / lenSq;
          t = Math.max(0, Math.min(1, t));

          const closestX = fromNode.x + t * dx;
          const closestY = fromNode.y + t * dy;
          const dist = Math.hypot(x - closestX, y - closestY);

          if (dist < bestDist) {
            bestDist = dist;
            bestPoint = { x: closestX, y: closestY };
            // Return the closer endpoint as the routing node
            const dFrom = Math.hypot(closestX - fromNode.x, closestY - fromNode.y);
            const dTo = Math.hypot(closestX - toNode.x, closestY - toNode.y);
            bestNodeId = dFrom <= dTo ? fromId : edge.to;
          }
        }
      }

      return bestNodeId ? { nodeId: bestNodeId, point: bestPoint, distance: bestDist } : null;
    }

    _reconstructPath(cameFrom, endNode) {
      const path = [endNode];
      let current = endNode;
      while (cameFrom[current]) {
        current = cameFrom[current];
        path.unshift(current);
      }
      return this._buildResult(path);
    }

    // ── String Pulling: remove unnecessary intermediate waypoints ──
    _stringPull(nodeIds) {
      if (nodeIds.length <= 2) return nodeIds;

      const result = [nodeIds[0]];
      let anchor = 0;

      while (anchor < nodeIds.length - 1) {
        let farthestDirect = anchor + 1;

        // Try to skip as far ahead as possible
        for (let probe = anchor + 2; probe < nodeIds.length; probe++) {
          if (this._canSkipBetween(nodeIds, anchor, probe)) {
            farthestDirect = probe;
          } else {
            break; // stop probing once we can't skip further
          }
        }

        result.push(nodeIds[farthestDirect]);
        anchor = farthestDirect;
      }

      return result;
    }

    // Check if all nodes between 'from' and 'to' in the path can be skipped.
    // This is valid when all intermediate nodes are collinear waypoints in the
    // same corridor (straight-line segment — no turns).
    _canSkipBetween(nodeIds, fromIdx, toIdx) {
      const nA = this.nodes[nodeIds[fromIdx]];
      const nB = this.nodes[nodeIds[toIdx]];
      if (!nA || !nB) return false;

      // Check every intermediate node sits on the straight line A→B
      // (cross-product ≈ 0 means collinear)
      const dx = nB.x - nA.x;
      const dy = nB.y - nA.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) return true;

      for (let i = fromIdx + 1; i < toIdx; i++) {
        const nC = this.nodes[nodeIds[i]];
        // Cross product of AB × AC  (should be ~0 for collinear)
        const cross = Math.abs((nC.x - nA.x) * dy - (nC.y - nA.y) * dx) / len;
        if (cross > 1.0) return false; // more than 1 map-unit off the line ⇒ not collinear
      }

      // Also verify a direct edge exists (or could exist) between the two
      // If they share the same corridor type, it's a straight hallway segment
      const corridorA = nA.corridorId;
      const corridorB = nB.corridorId;
      if (corridorA && corridorB && corridorA === corridorB) return true;

      // For non-corridor nodes (doors, etc.), only skip if truly collinear
      // and all intermediates are waypoints in the same corridor
      for (let i = fromIdx + 1; i < toIdx; i++) {
        const nC = this.nodes[nodeIds[i]];
        if (!nC.corridorId) return false;
      }
      return true;
    }

    _buildResult(nodeIds) {
      // Apply string pulling to eliminate redundant intermediate waypoints
      const pulledIds = this._stringPull(nodeIds);

      const points = pulledIds.map(id => ({
        x: this.nodes[id].x,
        y: this.nodes[id].y,
        id
      }));

      const smoothPoints = this._smoothPath(points);

      // Calculate total distance
      let distance = 0;
      for (let i = 1; i < points.length; i++) {
        distance += Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y
        );
      }

      const distanceMeters = distance * METERS_PER_UNIT;
      const timeSeconds = distanceMeters / WALK_SPEED_MPS;

      return {
        nodeIds: pulledIds,
        points,
        smoothPoints,
        distance,
        distanceMeters: Math.round(distanceMeters),
        estimatedTime: this._formatTime(timeSeconds),
        steps: this._generateSteps(pulledIds)
      };
    }

    // Catmull-Rom → Cubic Bezier smoothing
    _smoothPath(points) {
      if (points.length <= 2) return points.map(p => ({ x: p.x, y: p.y }));

      const result = [{ x: points[0].x, y: points[0].y }];
      const tension = 0.3;

      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(i - 1, 0)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(i + 2, points.length - 1)];

        // Generate intermediate points along the Catmull-Rom spline
        for (let t = 0.1; t <= 1.0; t += 0.1) {
          const t2 = t * t;
          const t3 = t2 * t;

          const x = 0.5 * (
            (2 * p1.x) +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
          );
          const y = 0.5 * (
            (2 * p1.y) +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
          );

          result.push({ x, y });
        }
      }

      return result;
    }

    // Generate SVG path d-string from smooth points using quadratic Bezier curves
    toSvgPath(smoothPoints) {
      if (smoothPoints.length < 2) return '';

      let d = `M ${smoothPoints[0].x} ${smoothPoints[0].y}`;

      if (smoothPoints.length === 2) {
        d += ` L ${smoothPoints[1].x} ${smoothPoints[1].y}`;
        return d;
      }

      // Use quadratic Bezier curves through each point:
      // For each segment, use the actual point as the control point
      // and the midpoint to the next point as the on-curve point.
      for (let i = 1; i < smoothPoints.length - 1; i++) {
        const midX = (smoothPoints[i].x + smoothPoints[i + 1].x) / 2;
        const midY = (smoothPoints[i].y + smoothPoints[i + 1].y) / 2;
        d += ` Q ${smoothPoints[i].x} ${smoothPoints[i].y} ${midX} ${midY}`;
      }

      // Final segment: curve to the last point
      const last = smoothPoints[smoothPoints.length - 1];
      const secondLast = smoothPoints[smoothPoints.length - 2];
      d += ` Q ${secondLast.x} ${secondLast.y} ${last.x} ${last.y}`;

      return d;
    }

    // Generate turn-by-turn steps in Arabic
    _generateSteps(nodeIds) {
      if (nodeIds.length < 2) return [];

      const steps = [];
      const mapData = window.MAP_DATA || [];
      const ROOM_STYLE = window.ROOM_STYLE || {};

      // Step 1: Leave the starting room
      const startNode = this.nodes[nodeIds[0]];
      if (startNode.roomId) {
        const room = mapData.find(r => r.id === startNode.roomId);
        const label = room ? room.label : startNode.roomId;
        steps.push({ text: `اخرج من ${label}`, icon: '🚪' });
      }

      // Middle steps: track direction changes in corridor
      let lastAngle = null;
      for (let i = 1; i < nodeIds.length - 1; i++) {
        const prev = this.nodes[nodeIds[i - 1]];
        const curr = this.nodes[nodeIds[i]];
        const next = this.nodes[nodeIds[i + 1]];

        const angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
        const angle2 = Math.atan2(next.y - curr.y, next.x - curr.x);
        let turn = ((angle2 - angle1) * 180 / Math.PI + 540) % 360 - 180;

        // Significant turn (>35 degrees)
        if (Math.abs(turn) > 35) {
          // In RTL map context: positive turn = left in screen coords
          if (turn > 0) {
            steps.push({ text: 'انعطف يساراً في الممر', icon: '↩️' });
          } else {
            steps.push({ text: 'انعطف يميناً في الممر', icon: '↪️' });
          }
        } else if (lastAngle === null || Math.abs(turn) <= 35) {
          // Check if transitioning between corridor segments
          const currNode = this.nodes[nodeIds[i]];
          if (currNode.type === 'waypoint' && i === Math.floor(nodeIds.length / 2)) {
            steps.push({ text: 'أكمل السير في الممر', icon: '🚶' });
          }
        }

        lastAngle = angle2;
      }

      // If no middle steps, add a generic one
      if (steps.length === 1) {
        steps.push({ text: 'امشِ في الممر', icon: '🚶' });
      }

      // Last step: Enter the destination
      const endNode = this.nodes[nodeIds[nodeIds.length - 1]];
      if (endNode.roomId) {
        const room = mapData.find(r => r.id === endNode.roomId);
        const label = room ? room.label : endNode.roomId;
        const st = ROOM_STYLE[room?.type] || { icon: '📍' };
        steps.push({ text: `ادخل ${label}`, icon: st.icon });
      }

      return steps;
    }

    _formatTime(seconds) {
      if (seconds < 60) return 'أقل من دقيقة';
      const mins = Math.round(seconds / 60);
      if (mins === 1) return 'دقيقة واحدة';
      if (mins === 2) return 'دقيقتان';
      if (mins <= 10) return `${mins} دقائق`;
      return `${mins} دقيقة`;
    }
  }

  // ── NavRenderer — draws route on SVG ──
  class NavRenderer {
    constructor(svgElement) {
      this.svg = svgElement;
      this.overlayGroup = null;
      this._ensureOverlay();
    }

    _ensureOverlay() {
      this.overlayGroup = this.svg.querySelector('#nav-overlay');
      if (!this.overlayGroup) {
        const ns = 'http://www.w3.org/2000/svg';
        this.overlayGroup = document.createElementNS(ns, 'g');
        this.overlayGroup.id = 'nav-overlay';
        this.svg.appendChild(this.overlayGroup);
      }
    }

    drawRoute(routeResult, navEngine) {
      this._ensureOverlay();
      this.clearRoute();

      const ns = 'http://www.w3.org/2000/svg';
      const { smoothPoints, points } = routeResult;

      if (smoothPoints.length < 2) return;

      // Defs for markers and animations
      let defs = this.svg.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS(ns, 'defs');
        this.svg.insertBefore(defs, this.svg.firstChild);
      }

      // Arrow marker
      if (!defs.querySelector('#nav-arrow')) {
        const marker = document.createElementNS(ns, 'marker');
        marker.setAttribute('id', 'nav-arrow');
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '5');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '0.6');
        marker.setAttribute('markerHeight', '0.6');
        marker.setAttribute('orient', 'auto-start-reverse');
        const arrowPath = document.createElementNS(ns, 'path');
        arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
        arrowPath.setAttribute('fill', '#6366f1');
        marker.appendChild(arrowPath);
        defs.appendChild(marker);
      }

      // Route shadow (wider, semi-transparent)
      const pathD = navEngine.toSvgPath(smoothPoints);

      const shadow = document.createElementNS(ns, 'path');
      shadow.setAttribute('d', pathD);
      shadow.setAttribute('fill', 'none');
      shadow.setAttribute('stroke', 'rgba(99,102,241,0.25)');
      shadow.setAttribute('stroke-width', '1.2');
      shadow.setAttribute('stroke-linecap', 'round');
      shadow.setAttribute('stroke-linejoin', 'round');
      this.overlayGroup.appendChild(shadow);

      // Main route path
      const routePath = document.createElementNS(ns, 'path');
      routePath.setAttribute('d', pathD);
      routePath.setAttribute('fill', 'none');
      routePath.setAttribute('stroke', '#6366f1');
      routePath.setAttribute('stroke-width', '0.5');
      routePath.setAttribute('stroke-linecap', 'round');
      routePath.setAttribute('stroke-linejoin', 'round');
      routePath.setAttribute('stroke-dasharray', '1.5 0.8');
      routePath.classList.add('nav-route-path');
      this.overlayGroup.appendChild(routePath);

      // Direction arrows along path at intervals
      const step = Math.max(1, Math.floor(smoothPoints.length / 6));
      for (let i = step; i < smoothPoints.length - step; i += step) {
        const p = smoothPoints[i];
        const pNext = smoothPoints[Math.min(i + 1, smoothPoints.length - 1)];
        const angle = Math.atan2(pNext.y - p.y, pNext.x - p.x) * 180 / Math.PI;

        const arrow = document.createElementNS(ns, 'polygon');
        arrow.setAttribute('points', '-0.3,-0.2 0.3,0 -0.3,0.2');
        arrow.setAttribute('fill', '#6366f1');
        arrow.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${angle})`);
        arrow.style.opacity = '0.7';
        this.overlayGroup.appendChild(arrow);
      }

      // Start marker (green pulse)
      const start = points[0];
      const startCircleOuter = document.createElementNS(ns, 'circle');
      startCircleOuter.setAttribute('cx', start.x);
      startCircleOuter.setAttribute('cy', start.y);
      startCircleOuter.setAttribute('r', '1.0');
      startCircleOuter.setAttribute('fill', 'rgba(34,197,94,0.3)');
      startCircleOuter.classList.add('nav-pulse');
      this.overlayGroup.appendChild(startCircleOuter);

      const startCircle = document.createElementNS(ns, 'circle');
      startCircle.setAttribute('cx', start.x);
      startCircle.setAttribute('cy', start.y);
      startCircle.setAttribute('r', '0.5');
      startCircle.setAttribute('fill', '#22c55e');
      startCircle.setAttribute('stroke', '#fff');
      startCircle.setAttribute('stroke-width', '0.12');
      this.overlayGroup.appendChild(startCircle);

      // End marker (red pin)
      const end = points[points.length - 1];
      const endCircleOuter = document.createElementNS(ns, 'circle');
      endCircleOuter.setAttribute('cx', end.x);
      endCircleOuter.setAttribute('cy', end.y);
      endCircleOuter.setAttribute('r', '1.0');
      endCircleOuter.setAttribute('fill', 'rgba(239,68,68,0.3)');
      endCircleOuter.classList.add('nav-pulse');
      this.overlayGroup.appendChild(endCircleOuter);

      const endCircle = document.createElementNS(ns, 'circle');
      endCircle.setAttribute('cx', end.x);
      endCircle.setAttribute('cy', end.y);
      endCircle.setAttribute('r', '0.5');
      endCircle.setAttribute('fill', '#ef4444');
      endCircle.setAttribute('stroke', '#fff');
      endCircle.setAttribute('stroke-width', '0.12');
      this.overlayGroup.appendChild(endCircle);
    }

    clearRoute() {
      if (this.overlayGroup) {
        this.overlayGroup.innerHTML = '';
      }
    }

    // Highlight a room polygon (start=green, end=red)
    highlightRoom(engine, roomId, color) {
      const entry = engine._roomGroups.get(roomId);
      if (!entry) return;
      const poly = entry.group.querySelector('polygon');
      if (poly) {
        poly.style.fill = color + '33';
        poly.style.stroke = color;
        poly.style.strokeWidth = '0.25';
      }
    }

    clearHighlight(engine, roomId) {
      const entry = engine._roomGroups.get(roomId);
      if (!entry) return;
      const poly = entry.group.querySelector('polygon');
      if (poly) {
        poly.style.fill = 'transparent';
        poly.style.stroke = 'transparent';
        poly.style.strokeWidth = '0.15';
      }
    }
  }

  window.NavEngine   = NavEngine;
  window.NavRenderer = NavRenderer;
})();
