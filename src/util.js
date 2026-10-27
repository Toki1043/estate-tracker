'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

// "Nowa Wieś Wielka" -> "nowa wies wielka"
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(s) {
  return norm(s).replace(/\s+/g, '-');
}

// "1 233,50 m²" / "740000.00" / 740000 -> number
function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/ |&nbsp;/g, ' ');
  const m = s.match(/-?\d[\d\s]*(?:[.,]\d+)?/);
  if (!m) return null;
  s = m[0].replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function fmtInt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('pl-PL').replace(/ /g, ' ');
}

function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pl-PL', { maximumFractionDigits: digits }).replace(/ /g, ' ');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Distance in km between two lat/lon points.
function haversine(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Picks the smallest allowed value that is >= wanted (or the largest one).
function snapUp(wanted, allowed) {
  for (const v of allowed) if (v >= wanted) return v;
  return allowed[allowed.length - 1];
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

module.exports = { sleep, randInt, norm, slug, parseNum, fmtInt, fmtNum, escapeHtml, haversine, snapUp, uid };
