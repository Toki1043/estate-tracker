'use strict';

// Geometry of the areas drawn in the panel. Points are [lat, lon]; distances in km.

const R = 6371;
const toRad = (d) => (d * Math.PI) / 180;

function distKm(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Circle -> polygon with n vertices (portals take polygons only). */
function circleRing(center, radiusM, n = 48) {
  const [lat, lon] = center;
  const dLat = radiusM / 1000 / 111.32;
  const dLon = dLat / Math.cos(toRad(lat));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([lat + dLat * Math.sin(a), lon + dLon * Math.cos(a)]);
  }
  return out;
}

/** Open ring (first point not repeated) for any area type. */
function ring(area) {
  if (area.type === 'circle') return circleRing(area.center, area.radius);
  return (area.points || []).filter((p) => Array.isArray(p) && p.length === 2);
}

function closedRing(area) {
  const r = ring(area);
  return r.length ? [...r, r[0]] : r;
}

function bbox(points) {
  let [s, w, n, e] = [90, 180, -90, -180];
  for (const [lat, lon] of points) {
    s = Math.min(s, lat);
    n = Math.max(n, lat);
    w = Math.min(w, lon);
    e = Math.max(e, lon);
  }
  return { south: s, west: w, north: n, east: e };
}

function centroid(points) {
  const n = points.length || 1;
  return [points.reduce((a, p) => a + p[0], 0) / n, points.reduce((a, p) => a + p[1], 0) / n];
}

function pointInRing(pt, poly) {
  const [y, x] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Distance from a point to a segment, in km (local equirectangular projection — fine at town scale).
function segDistKm(p, a, b) {
  const kx = 111.32 * Math.cos(toRad(p[0]));
  const ky = 110.57;
  const [px, py] = [p[1] * kx, p[0] * ky];
  const [ax, ay] = [a[1] * kx, a[0] * ky];
  const [bx, by] = [b[1] * kx, b[0] * ky];
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 0 inside the area, otherwise the distance (km) to its edge. */
function distanceToArea(pt, area) {
  if (area.type === 'circle') return Math.max(0, distKm(pt, area.center) - area.radius / 1000);
  const r = ring(area);
  if (r.length < 3) return Infinity;
  if (pointInRing(pt, r)) return 0;
  let d = Infinity;
  for (let i = 0; i < r.length; i++) d = Math.min(d, segDistKm(pt, r[i], r[(i + 1) % r.length]));
  return d;
}

function inAnyArea(pt, areas, bufferKm = 0) {
  return (areas || []).some((a) => distanceToArea(pt, a) <= bufferKm);
}

/** Google encoded polyline (precision 5) of [lat, lon] points — Otodom's "geometry" URL parameter. */
function encodePolyline(points, precision = 5) {
  const f = 10 ** precision;
  const round = (v) => Math.floor(Math.abs(v) + 0.5) * (v >= 0 ? 1 : -1);
  const enc = (v) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (x >= 32) {
      s += String.fromCharCode((32 | (x & 31)) + 63);
      x >>= 5;
    }
    return s + String.fromCharCode(x + 63);
  };
  let out = '';
  let pLat = 0;
  let pLon = 0;
  for (const [lat, lon] of points) {
    const a = round(lat * f);
    const b = round(lon * f);
    out += enc(a - pLat) + enc(b - pLon);
    pLat = a;
    pLon = b;
  }
  return out;
}

/** Validates/normalizes areas coming from the browser. */
function cleanAreas(list) {
  const out = [];
  for (const a of Array.isArray(list) ? list.slice(0, 10) : []) {
    const num = (v) => Number(v);
    const okPt = (p) => Array.isArray(p) && p.length === 2 && Math.abs(num(p[0])) <= 90 && Math.abs(num(p[1])) <= 180;
    if (a?.type === 'circle' && okPt(a.center) && num(a.radius) > 10) {
      out.push({ type: 'circle', center: [num(a.center[0]), num(a.center[1])], radius: Math.min(60000, Math.round(num(a.radius))) });
    } else if ((a?.type === 'polygon' || a?.type === 'rectangle') && Array.isArray(a.points)) {
      const pts = a.points.filter(okPt).slice(0, 250).map((p) => [Math.round(num(p[0]) * 1e6) / 1e6, Math.round(num(p[1]) * 1e6) / 1e6]);
      if (pts.length >= 3) out.push({ type: a.type, points: pts });
    }
  }
  return out;
}

module.exports = { distKm, circleRing, ring, closedRing, bbox, centroid, pointInRing, distanceToArea, inAnyArea, encodePolyline, cleanAreas };
