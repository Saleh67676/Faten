// =================================================================
// UQU Geo Data — بيانات GPS والمداخل ومناطق المواقف
// Coordinate mapping, geofences, entrances, and utility functions
// =================================================================
(function () {
  'use strict';

  // ── Building calibration points ──
  // GPS ↔ Map% reference points (survey on-site to fill real values)
  // Map coordinates are in percentage space (0–100) matching SVG viewBox
  const CALIBRATION = [
    { gps: { lat: 21.38950, lng: 39.85830 }, map: { x: 5.0,  y: 5.0  } },   // NW corner
    { gps: { lat: 21.38950, lng: 39.85950 }, map: { x: 95.0, y: 5.0  } },   // NE corner
    { gps: { lat: 21.38850, lng: 39.85950 }, map: { x: 95.0, y: 95.0 } },   // SE corner
    { gps: { lat: 21.38850, lng: 39.85830 }, map: { x: 5.0,  y: 95.0 } },   // SW corner
  ];

  // ── Map north offset ──
  // Degrees clockwise from map-up to true north.
  // If the top of base-map.jpg faces N30E, set this to 30.
  const MAP_NORTH_OFFSET = 0;

  // ── Parking zone geofences ──
  // Each zone is a GPS polygon + the nearest entrance ID
  const PARKING_ZONES = [
    {
      id: 'parking_right',
      label: 'مواقف اليمين',
      polygon: [
        { lat: 21.38960, lng: 39.85960 },
        { lat: 21.38960, lng: 39.86050 },
        { lat: 21.38840, lng: 39.86050 },
        { lat: 21.38840, lng: 39.85960 },
      ],
      nearestEntrance: 'entrance_main',
    },
    {
      id: 'parking_left',
      label: 'مواقف اليسار',
      polygon: [
        { lat: 21.38960, lng: 39.85730 },
        { lat: 21.38960, lng: 39.85820 },
        { lat: 21.38840, lng: 39.85820 },
        { lat: 21.38840, lng: 39.85730 },
      ],
      nearestEntrance: 'entrance_left',
    },
    {
      id: 'parking_north',
      label: 'مواقف الشمال',
      polygon: [
        { lat: 21.38960, lng: 39.85840 },
        { lat: 21.38960, lng: 39.85950 },
        { lat: 21.39010, lng: 39.85950 },
        { lat: 21.39010, lng: 39.85840 },
      ],
      nearestEntrance: 'entrance_north',
    },
    {
      id: 'parking_south',
      label: 'مواقف الجنوب',
      polygon: [
        { lat: 21.38790, lng: 39.85840 },
        { lat: 21.38790, lng: 39.85950 },
        { lat: 21.38840, lng: 39.85950 },
        { lat: 21.38840, lng: 39.85840 },
      ],
      nearestEntrance: 'entrance_south',
    },
    {
      id: 'parking_emergency',
      label: 'مواقف الطوارئ',
      polygon: [
        { lat: 21.38900, lng: 39.86050 },
        { lat: 21.38900, lng: 39.86120 },
        { lat: 21.38850, lng: 39.86120 },
        { lat: 21.38850, lng: 39.86050 },
      ],
      nearestEntrance: 'entrance_emergency',
    },
  ];

  // ── Building entrances (7 total) ──
  // Each entrance: GPS position, map% position, connected NAV_GRAPH waypoint
  const ENTRANCES = [
    {
      id: 'entrance_main',
      label: 'المدخل الرئيسي',
      gps: { lat: 21.38920, lng: 39.85950 },
      mapPoint: { x: 90.5, y: 20.2 },
      connectedWaypoint: 'wp90b_01',
      heading: 270,
    },
    {
      id: 'entrance_north',
      label: 'المدخل الشمالي',
      gps: { lat: 21.38950, lng: 39.85890 },
      mapPoint: { x: 50.0, y: 5.0 },
      connectedWaypoint: 'wp79_07',
      heading: 180,
    },
    {
      id: 'entrance_left',
      label: 'المدخل الأيسر',
      gps: { lat: 21.38900, lng: 39.85830 },
      mapPoint: { x: 2.4, y: 59.6 },
      connectedWaypoint: 'wp82_24',
      heading: 90,
    },
    {
      id: 'entrance_south',
      label: 'المدخل الجنوبي',
      gps: { lat: 21.38850, lng: 39.85890 },
      mapPoint: { x: 50.0, y: 95.0 },
      connectedWaypoint: 'wp80_08',
      heading: 0,
    },
    {
      id: 'entrance_emergency',
      label: 'مدخل الطوارئ',
      gps: { lat: 21.38880, lng: 39.85960 },
      mapPoint: { x: 94.9, y: 58.9 },
      connectedWaypoint: 'wp90b_18',
      heading: 270,
    },
    {
      id: 'entrance_se',
      label: 'المدخل الجنوبي الشرقي',
      gps: { lat: 21.38855, lng: 39.85945 },
      mapPoint: { x: 91.0, y: 91.8 },
      connectedWaypoint: 'wp90b_38',
      heading: 270,
    },
    {
      id: 'entrance_side_right',
      label: 'المدخل الجانبي الأيمن',
      gps: { lat: 21.38935, lng: 39.85955 },
      mapPoint: { x: 91.0, y: 33.0 },
      connectedWaypoint: 'wp90b_07',
      heading: 270,
    },
  ];

  // ── Proximity thresholds (meters) ──
  const HANDOVER_RADIUS  = 10;   // Switch to indoor view
  const GEOFENCE_RADIUS  = 300;  // Max distance to consider "near campus"
  const REROUTE_THRESHOLD = 8;   // Map units (~10m) before triggering reroute

  // =================================================================
  // Utility functions
  // =================================================================

  /**
   * Haversine distance between two GPS points in meters
   */
  function haversineMeters(a, b) {
    const R = 6371000; // Earth radius in meters
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  /**
   * Point-in-polygon test using ray casting algorithm
   * @param {{ lat: number, lng: number }} point
   * @param {Array<{ lat: number, lng: number }>} polygon
   * @returns {boolean}
   */
  function isInsidePolygon(point, polygon) {
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;
      const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
        (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Compute affine transform matrix from calibration points (least-squares)
   * Maps GPS (lat, lng) → Map% (x, y)
   * Returns { a, b, c, d, e, f } where:
   *   mapX = a*lng + b*lat + c
   *   mapY = d*lng + e*lat + f
   */
  function computeAffineMatrix(cal) {
    // Use first 3 points for exact solution (or least-squares for 4+)
    // For 3 points: solve 2 systems of 3 equations each
    const n = Math.min(cal.length, 4);

    // Build matrices for least-squares: A * params = B
    // For X: [lng, lat, 1] * [a, b, c]^T = mapX
    // For Y: [lng, lat, 1] * [d, e, f]^T = mapY
    let sumLng2 = 0, sumLat2 = 0, sumLngLat = 0;
    let sumLng = 0, sumLat = 0;
    let sumLngX = 0, sumLatX = 0, sumX = 0;
    let sumLngY = 0, sumLatY = 0, sumY = 0;

    for (let i = 0; i < n; i++) {
      const lng = cal[i].gps.lng;
      const lat = cal[i].gps.lat;
      const mx  = cal[i].map.x;
      const my  = cal[i].map.y;

      sumLng2   += lng * lng;
      sumLat2   += lat * lat;
      sumLngLat += lng * lat;
      sumLng    += lng;
      sumLat    += lat;
      sumLngX   += lng * mx;
      sumLatX   += lat * mx;
      sumX      += mx;
      sumLngY   += lng * my;
      sumLatY   += lat * my;
      sumY      += my;
    }

    // Solve 3x3 system using Cramer's rule
    // | sumLng2    sumLngLat  sumLng | | a |   | sumLngX |
    // | sumLngLat  sumLat2    sumLat | | b | = | sumLatX |
    // | sumLng     sumLat     n      | | c |   | sumX    |

    function solve3x3(m, rhs) {
      const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
                - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      if (Math.abs(det) < 1e-12) return [0, 0, 0];

      const results = [];
      for (let col = 0; col < 3; col++) {
        const mc = m.map(row => [...row]);
        for (let row = 0; row < 3; row++) mc[row][col] = rhs[row];
        const d = mc[0][0] * (mc[1][1] * mc[2][2] - mc[1][2] * mc[2][1])
                - mc[0][1] * (mc[1][0] * mc[2][2] - mc[1][2] * mc[2][0])
                + mc[0][2] * (mc[1][0] * mc[2][1] - mc[1][1] * mc[2][0]);
        results.push(d / det);
      }
      return results;
    }

    const M = [
      [sumLng2,   sumLngLat, sumLng],
      [sumLngLat, sumLat2,   sumLat],
      [sumLng,    sumLat,    n     ],
    ];

    const [a, b, c] = solve3x3(M, [sumLngX, sumLatX, sumX]);
    const [d, e, f] = solve3x3(M, [sumLngY, sumLatY, sumY]);

    return { a, b, c, d, e, f };
  }

  // ── Pre-compute the affine matrix ──
  const _affine = computeAffineMatrix(CALIBRATION);

  /**
   * Convert GPS coordinates to map percentage coordinates
   * @param {number} lat
   * @param {number} lng
   * @returns {{ x: number, y: number }}
   */
  function gpsToMap(lat, lng) {
    return {
      x: _affine.a * lng + _affine.b * lat + _affine.c,
      y: _affine.d * lng + _affine.e * lat + _affine.f,
    };
  }

  /**
   * Find which parking zone a GPS point is inside
   * @returns {object|null} The parking zone, or null
   */
  function detectParkingZone(lat, lng) {
    for (const zone of PARKING_ZONES) {
      if (isInsidePolygon({ lat, lng }, zone.polygon)) return zone;
    }
    return null;
  }

  /**
   * Find nearest entrance to a GPS point
   * @returns {{ entrance: object, distance: number }}
   */
  function findNearestEntrance(lat, lng) {
    let best = null;
    let bestDist = Infinity;
    for (const ent of ENTRANCES) {
      const dist = haversineMeters({ lat, lng }, ent.gps);
      if (dist < bestDist) {
        bestDist = dist;
        best = ent;
      }
    }
    return { entrance: best, distance: bestDist };
  }

  /**
   * Suggest entrance based on parking zone or nearest distance
   * @returns {object} entrance object
   */
  function suggestEntrance(lat, lng) {
    // First check if inside a known parking zone
    const zone = detectParkingZone(lat, lng);
    if (zone) {
      const ent = ENTRANCES.find(e => e.id === zone.nearestEntrance);
      if (ent) return ent;
    }
    // Fallback: nearest entrance by distance
    return findNearestEntrance(lat, lng).entrance;
  }

  // ── Export ──
  window.UQU_GEO = Object.freeze({
    CALIBRATION,
    MAP_NORTH_OFFSET,
    PARKING_ZONES,
    ENTRANCES,
    HANDOVER_RADIUS,
    GEOFENCE_RADIUS,
    REROUTE_THRESHOLD,

    // Functions
    haversineMeters,
    isInsidePolygon,
    gpsToMap,
    detectParkingZone,
    findNearestEntrance,
    suggestEntrance,
  });

})();
