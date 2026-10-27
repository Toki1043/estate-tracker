'use strict';

const { norm } = require('./util');

// Generic portal titles ("działka na sprzedaż") say nothing about the property.
const GENERIC = new Set(['dzialka', 'dzialki', 'grunt', 'lub', 'na', 'sprzedaz', 'wynajem', 'do', 'dom', 'mieszkanie', 'sprzedam', 'oferta', 'w', 'z', 'i', 'm2', 'ar', 'ary']);

function words(s) {
  return new Set(
    norm(s)
      .split(' ')
      .filter((w) => w.length > 1 && !GENERIC.has(w) && !/^\d+$/.test(w))
  );
}

function similarity(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return null; // nothing to compare
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Compact record kept for every offer we've seen (used for cross-portal duplicate checks). */
function fingerprint(o) {
  return {
    price: o.price ? Math.round(o.price) : null,
    area: o.area ? Math.round(o.area) : null,
    title: o.title || '',
    place: o.location || '',
  };
}

/**
 * Same offer on two portals = same price, same area (±1%) and a matching title,
 * or — when portals use generic titles — the same town.
 */
function isDuplicate(a, b) {
  if (!a.price || !b.price || a.price !== b.price) return false;
  if (!a.area || !b.area) return false;
  if (Math.abs(a.area - b.area) > Math.max(1, 0.01 * Math.max(a.area, b.area))) return false;
  const t = similarity(a.title, b.title);
  if (t !== null && t >= 0.5) return true;
  const placeA = words(a.place);
  const placeB = words(b.place);
  for (const w of placeA) if (placeB.has(w)) return true;
  return t === null && (!placeA.size || !placeB.size);
}

module.exports = { fingerprint, isDuplicate, similarity };
