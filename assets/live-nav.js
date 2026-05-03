// =================================================================
// UQU Live Navigator — GPS tracking, compass, blue dot, snap-to-route
// Google Maps-like indoor navigation experience
// =================================================================
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ── States ──
  const STATE = Object.freeze({
    IDLE:             'IDLE',
    OUTDOOR:          'OUTDOOR',
    HANDOVER:         'HANDOVER',
    INDOOR_TRACKING:  'INDOOR_TRACKING',
  });

  class LiveNavigator {
    /**
     * @param {FloorPlanEngine} engine  — the floorplan rendering engine
     * @param {NavEngine}       navEngine — the pathfinding engine
     */
    constructor(engine, navEngine) {
      this._engine    = engine;
      this._navEngine = navEngine;
      this._geo       = window.UQU_GEO;

      // ── State ──
      this._state           = STATE.IDLE;
      this._watchId         = null;
      this._compassHeading  = 0;
      this._headingUp       = true;  // true = heading-up mode, false = north-up
      this._currentRoute    = null;
      this._routeSegments   = null;
      this._suggestedEntrance = null;

      // ── Position ──
      this._rawGps      = null;  // { lat, lng }
      this._rawMapPos   = null;  // { x, y } in map%
      this._smoothedPos = null;  // { x, y } after low-pass filter
      this._snappedPos  = null;  // { x, y } after snap-to-route
      this._accuracy    = 0;     // GPS accuracy in meters

      // ── SVG elements ──
      this._svgGroup    = null;
      this._blueDot     = null;
      this._bluePulse   = null;
      this._viewCone    = null;
      this._accuracyRing = null;

      // ── Compass listener refs ──
      this._compassHandler     = null;
      this._compassPermGranted = false;

      // ── Animation ──
      this._rafId = null;
    }

    // =================================================================
    // Public API
    // =================================================================

    /** Start GPS tracking + compass. Returns a Promise (for permission flow). */
    async startTracking() {
      if (this._state !== STATE.IDLE) return;

      // Check geolocation support
      if (!navigator.geolocation) {
        this._emit('live-nav:error', { message: 'الموقع الجغرافي غير مدعوم في هذا المتصفح' });
        return;
      }

      // Create SVG elements
      this._createBlueDot();

      // Start geolocation watch
      this._watchId = navigator.geolocation.watchPosition(
        pos => this._onPosition(pos),
        err => this._onGeoError(err),
        {
          enableHighAccuracy: true,
          maximumAge: 2000,
          timeout: 10000,
        }
      );

      // Start compass
      await this._startCompass();

      this._setState(STATE.OUTDOOR);
      this._emit('live-nav:tracking-started');
    }

    /** Stop all tracking and remove SVG elements. */
    stopTracking() {
      if (this._watchId != null) {
        navigator.geolocation.clearWatch(this._watchId);
        this._watchId = null;
      }

      this._stopCompass();
      this._removeBlueDot();

      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }

      this._currentRoute   = null;
      this._routeSegments  = null;
      this._rawGps         = null;
      this._smoothedPos    = null;
      this._snappedPos     = null;

      this._setState(STATE.IDLE);
      this._emit('live-nav:tracking-stopped');
    }

    /**
     * Enter guided navigation mode with snap-to-route.
     * @param {object} routeResult — from NavEngine.findPath() or findPathFromNode()
     */
    startNavigation(routeResult) {
      this._currentRoute  = routeResult;
      this._routeSegments = this._buildSegments(routeResult.points);
      this._emit('live-nav:navigation-started');
    }

    /** Exit guided navigation (keep tracking). */
    stopNavigation() {
      this._currentRoute  = null;
      this._routeSegments = null;
      this._snappedPos    = null;
      this._emit('live-nav:navigation-stopped');
    }

    /** Toggle heading-up / north-up mode. */
    toggleRotationLock() {
      this._headingUp = !this._headingUp;
      if (!this._headingUp) {
        // Reset map rotation to north-up
        this._engine.setRotation(0);
      }
      this._emit('live-nav:rotation-mode', { headingUp: this._headingUp });
      return this._headingUp;
    }

    /** @returns {string} Current state */
    getState() { return this._state; }

    /** @returns {boolean} Whether heading-up mode is active */
    isHeadingUp() { return this._headingUp; }

    /** @returns {object|null} The suggested entrance */
    getSuggestedEntrance() { return this._suggestedEntrance; }

    // =================================================================
    // Geolocation handling
    // =================================================================

    _onPosition(pos) {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      this._accuracy = pos.coords.accuracy || 10;
      this._rawGps = { lat, lng };

      // Convert to map coordinates
      this._rawMapPos = this._geo.gpsToMap(lat, lng);

      // Apply low-pass smoothing
      if (this._smoothedPos) {
        this._smoothedPos = {
          x: 0.3 * this._rawMapPos.x + 0.7 * this._smoothedPos.x,
          y: 0.3 * this._rawMapPos.y + 0.7 * this._smoothedPos.y,
        };
      } else {
        this._smoothedPos = { ...this._rawMapPos };
      }

      // ── State-dependent logic ──
      switch (this._state) {
        case STATE.OUTDOOR:
          this._handleOutdoor(lat, lng);
          break;

        case STATE.HANDOVER:
          // Wait for handover animation to complete
          break;

        case STATE.INDOOR_TRACKING:
          this._handleIndoor();
          break;
      }
    }

    _onGeoError(err) {
      const messages = {
        1: 'تم رفض إذن الموقع. يرجى تفعيله من الإعدادات',
        2: 'تعذر تحديد الموقع. تأكد من تفعيل GPS',
        3: 'انتهت مهلة تحديد الموقع',
      };
      this._emit('live-nav:error', {
        code: err.code,
        message: messages[err.code] || 'خطأ في تحديد الموقع',
      });
    }

    // =================================================================
    // Outdoor phase — geofence detection + entrance suggestion
    // =================================================================

    _handleOutdoor(lat, lng) {
      // Suggest entrance based on parking zone or nearest distance
      this._suggestedEntrance = this._geo.suggestEntrance(lat, lng);

      this._emit('live-nav:entrance-suggested', {
        entrance: this._suggestedEntrance,
      });

      // Check proximity to suggested entrance for handover
      if (this._suggestedEntrance) {
        const dist = this._geo.haversineMeters(
          { lat, lng },
          this._suggestedEntrance.gps
        );

        this._emit('live-nav:distance-update', {
          entrance: this._suggestedEntrance,
          distance: Math.round(dist),
        });

        if (dist <= this._geo.HANDOVER_RADIUS) {
          this._beginHandover();
        }
      }
    }

    // =================================================================
    // Handover phase — transition from outdoor to indoor
    // =================================================================

    _beginHandover() {
      this._setState(STATE.HANDOVER);
      this._emit('live-nav:handover-start', {
        entrance: this._suggestedEntrance,
      });

      // Place blue dot at entrance point on map
      const ep = this._suggestedEntrance.mapPoint;
      this._smoothedPos = { x: ep.x, y: ep.y };

      // Zoom map to entrance area
      this._engine.resetView();

      // After a short delay, switch to indoor tracking
      setTimeout(() => {
        this._setState(STATE.INDOOR_TRACKING);
        this._updateBlueDot(ep.x, ep.y, this._compassHeading);
        this._showBlueDot();
        this._emit('live-nav:handover-complete');
      }, 600);
    }

    /** Force handover (skip outdoor phase) — for use when already inside */
    forceIndoorMode() {
      if (this._state === STATE.IDLE) return;
      this._setState(STATE.INDOOR_TRACKING);
      this._showBlueDot();
      this._emit('live-nav:handover-complete');
    }

    // =================================================================
    // Indoor tracking — snap-to-route + blue dot update
    // =================================================================

    _handleIndoor() {
      let displayPos = this._smoothedPos;

      // Snap to route if navigating
      if (this._currentRoute && this._routeSegments) {
        const snap = this._snapToRoute(this._smoothedPos.x, this._smoothedPos.y);
        this._snappedPos = snap.point;
        displayPos = snap.point;

        // Check if too far from route (needs reroute)
        if (snap.distance > this._geo.REROUTE_THRESHOLD) {
          this._emit('live-nav:reroute-needed', {
            position: this._smoothedPos,
            snappedPosition: snap.point,
            deviation: snap.distance,
          });
        }

        // Check if near destination
        if (this._currentRoute.points.length > 0) {
          const dest = this._currentRoute.points[this._currentRoute.points.length - 1];
          const distToDest = Math.hypot(displayPos.x - dest.x, displayPos.y - dest.y);
          if (distToDest < 2) { // ~2.4m
            this._emit('live-nav:arrived');
          }
        }
      }

      this._updateBlueDot(displayPos.x, displayPos.y, this._compassHeading);

      // Auto-rotate map in heading-up mode
      if (this._headingUp) {
        this._autoRotateMap(this._compassHeading);
      }
    }

    // =================================================================
    // Snap-to-route algorithm
    // =================================================================

    /**
     * Project a point onto the nearest route segment.
     * @param {number} px — x coordinate in map%
     * @param {number} py — y coordinate in map%
     * @returns {{ point: {x,y}, distance: number, segmentIndex: number }}
     */
    _snapToRoute(px, py) {
      let bestDist = Infinity;
      let bestPoint = { x: px, y: py };
      let bestIdx = 0;

      for (let i = 0; i < this._routeSegments.length; i++) {
        const [s, e] = this._routeSegments[i];
        const result = this._projectOnSegment(px, py, s.x, s.y, e.x, e.y);
        if (result.distance < bestDist) {
          bestDist = result.distance;
          bestPoint = result.point;
          bestIdx = i;
        }
      }

      return { point: bestPoint, distance: bestDist, segmentIndex: bestIdx };
    }

    /**
     * Project point P onto segment AB.
     * @returns {{ point: {x,y}, distance: number }}
     */
    _projectOnSegment(px, py, ax, ay, bx, by) {
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;

      if (lenSq === 0) {
        // Degenerate segment (point)
        const d = Math.hypot(px - ax, py - ay);
        return { point: { x: ax, y: ay }, distance: d };
      }

      // Parameter t of projection onto line, clamped to [0, 1]
      let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));

      const closestX = ax + t * dx;
      const closestY = ay + t * dy;
      const distance = Math.hypot(px - closestX, py - closestY);

      return { point: { x: closestX, y: closestY }, distance };
    }

    /**
     * Build array of [startPoint, endPoint] segments from route points.
     */
    _buildSegments(points) {
      const segs = [];
      for (let i = 0; i < points.length - 1; i++) {
        segs.push([points[i], points[i + 1]]);
      }
      return segs;
    }

    // =================================================================
    // Compass / device orientation
    // =================================================================

    async _startCompass() {
      // iOS 13+ requires permission
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const perm = await DeviceOrientationEvent.requestPermission();
          if (perm !== 'granted') {
            this._emit('live-nav:compass-denied');
            return;
          }
          this._compassPermGranted = true;
        } catch (e) {
          this._emit('live-nav:compass-error', { message: e.message });
          return;
        }
      }

      this._compassHandler = (e) => this._onCompass(e);

      // Try absolute orientation first (more accurate)
      if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', this._compassHandler, true);
      } else {
        window.addEventListener('deviceorientation', this._compassHandler, true);
      }
    }

    _stopCompass() {
      if (this._compassHandler) {
        window.removeEventListener('deviceorientationabsolute', this._compassHandler, true);
        window.removeEventListener('deviceorientation', this._compassHandler, true);
        this._compassHandler = null;
      }
    }

    _onCompass(event) {
      let heading;

      // iOS uses webkitCompassHeading (0 = north, increases CW)
      if (event.webkitCompassHeading != null) {
        heading = event.webkitCompassHeading;
      } else if (event.alpha != null) {
        // Android: alpha is 0-360 CCW from north for absolute events
        // For non-absolute events, alpha is arbitrary
        if (event.absolute) {
          heading = (360 - event.alpha) % 360;
        } else {
          heading = (360 - event.alpha) % 360;
        }
      } else {
        return;
      }

      // Low-pass filter on heading to reduce jitter
      const diff = heading - this._compassHeading;
      // Handle wrap-around (e.g., 359 → 1)
      const normalizedDiff = ((diff + 540) % 360) - 180;
      this._compassHeading += normalizedDiff * 0.15; // Smooth factor
      this._compassHeading = ((this._compassHeading % 360) + 360) % 360;
    }

    // =================================================================
    // Map rotation (heading-up mode)
    // =================================================================

    _autoRotateMap(heading) {
      const adjustedHeading = heading - this._geo.MAP_NORTH_OFFSET;
      this._engine.setRotation(-adjustedHeading);
    }

    // =================================================================
    // Blue dot SVG rendering
    // =================================================================

    _createBlueDot() {
      const svg = this._engine.getOverlaySvg();
      if (!svg) return;

      // Group to hold all blue-dot elements
      this._svgGroup = document.createElementNS(SVG_NS, 'g');
      this._svgGroup.setAttribute('class', 'live-nav-group');
      this._svgGroup.style.display = 'none'; // Hidden until positioned

      // Accuracy ring
      this._accuracyRing = document.createElementNS(SVG_NS, 'circle');
      this._accuracyRing.setAttribute('r', '3');
      this._accuracyRing.setAttribute('fill', 'rgba(59, 130, 246, 0.08)');
      this._accuracyRing.setAttribute('stroke', 'rgba(59, 130, 246, 0.15)');
      this._accuracyRing.setAttribute('stroke-width', '0.1');

      // Pulse ring
      this._bluePulse = document.createElementNS(SVG_NS, 'circle');
      this._bluePulse.setAttribute('r', '1.5');
      this._bluePulse.setAttribute('class', 'blue-dot-pulse');

      // View cone (60-degree triangle)
      this._viewCone = document.createElementNS(SVG_NS, 'polygon');
      this._viewCone.setAttribute('class', 'view-cone');

      // Main dot
      this._blueDot = document.createElementNS(SVG_NS, 'circle');
      this._blueDot.setAttribute('r', '0.6');
      this._blueDot.setAttribute('class', 'blue-dot');

      // Assemble (order matters for layering)
      this._svgGroup.appendChild(this._accuracyRing);
      this._svgGroup.appendChild(this._bluePulse);
      this._svgGroup.appendChild(this._viewCone);
      this._svgGroup.appendChild(this._blueDot);

      svg.appendChild(this._svgGroup);
    }

    _showBlueDot() {
      if (this._svgGroup) {
        this._svgGroup.style.display = '';
      }
    }

    _hideBlueDot() {
      if (this._svgGroup) {
        this._svgGroup.style.display = 'none';
      }
    }

    _removeBlueDot() {
      if (this._svgGroup && this._svgGroup.parentNode) {
        this._svgGroup.parentNode.removeChild(this._svgGroup);
      }
      this._svgGroup    = null;
      this._blueDot     = null;
      this._bluePulse   = null;
      this._viewCone    = null;
      this._accuracyRing = null;
    }

    /**
     * Update blue dot position and heading on SVG.
     * @param {number} x — map% x
     * @param {number} y — map% y
     * @param {number} heading — compass heading in degrees (0 = north CW)
     */
    _updateBlueDot(x, y, heading) {
      if (!this._svgGroup) return;

      // Move all elements to position
      this._blueDot.setAttribute('cx', x);
      this._blueDot.setAttribute('cy', y);
      this._bluePulse.setAttribute('cx', x);
      this._bluePulse.setAttribute('cy', y);
      this._accuracyRing.setAttribute('cx', x);
      this._accuracyRing.setAttribute('cy', y);

      // Update accuracy ring radius based on GPS accuracy
      // Convert meters to map% (1% ≈ 1.2m)
      const accRadius = Math.min(this._accuracy / 1.2, 10);
      this._accuracyRing.setAttribute('r', accRadius);

      // Update view cone direction
      // Cone points "forward" in the heading direction
      // Heading: 0=north (up on screen before rotation), CW
      const adjustedHeading = heading - this._geo.MAP_NORTH_OFFSET;
      const rad = (adjustedHeading - 90) * Math.PI / 180; // SVG: 0 = right
      const coneLen = 3;  // Length in map%
      const coneHalf = 30 * Math.PI / 180; // Half-angle of cone (30°)

      const tipX  = x + coneLen * Math.cos(rad);
      const tipY  = y + coneLen * Math.sin(rad);
      const leftX = x + coneLen * 0.95 * Math.cos(rad - coneHalf);
      const leftY = y + coneLen * 0.95 * Math.sin(rad - coneHalf);
      const rightX = x + coneLen * 0.95 * Math.cos(rad + coneHalf);
      const rightY = y + coneLen * 0.95 * Math.sin(rad + coneHalf);

      this._viewCone.setAttribute('points',
        `${x},${y} ${leftX},${leftY} ${tipX},${tipY} ${rightX},${rightY}`
      );
    }

    // =================================================================
    // Event system
    // =================================================================

    _setState(newState) {
      const old = this._state;
      this._state = newState;
      this._emit('live-nav:state-change', { from: old, to: newState });
    }

    _emit(type, detail = {}) {
      if (this._engine && this._engine.container) {
        this._engine.container.dispatchEvent(
          new CustomEvent(type, { detail, bubbles: true })
        );
      }
    }
  }

  // ── Export ──
  window.LiveNavigator = LiveNavigator;
  window.LIVE_NAV_STATE = STATE;

})();
