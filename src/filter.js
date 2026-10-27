'use strict';

const { norm } = require('./util');

/** Fills in price per m² when the portal didn't give it. */
function enrich(o) {
  if (!o.pricePerM2 && o.price && o.area) o.pricePerM2 = Math.round((o.price / o.area) * 100) / 100;
  return o;
}

// Keywords: comma or newline separated; "a|b" inside one keyword means "a or b".
function parseKeywords(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Checks an offer against the criteria that could not be (or might not have been) applied
 * in the portal URL. Returns null when the offer matches, otherwise the reason.
 */
function rejectReason(o, s) {
  const has = (v) => v !== null && v !== undefined && v !== '' && Number(v) > 0;
  if (has(s.priceMin) || has(s.priceMax)) {
    if (o.price === null || o.price === undefined) return 'brak ceny';
    if (has(s.priceMin) && o.price < Number(s.priceMin)) return `cena ${o.price} < min`;
    if (has(s.priceMax) && o.price > Number(s.priceMax)) return `cena ${o.price} > max`;
  }
  if (o.area) {
    if (has(s.areaMin) && o.area < Number(s.areaMin)) return `powierzchnia ${o.area} m² < min`;
    if (has(s.areaMax) && o.area > Number(s.areaMax)) return `powierzchnia ${o.area} m² > max`;
  }
  if (s.propertyType === 'house' && o.plotArea) {
    if (has(s.plotAreaMin) && o.plotArea < Number(s.plotAreaMin)) return `działka ${o.plotArea} m² < min`;
    if (has(s.plotAreaMax) && o.plotArea > Number(s.plotAreaMax)) return `działka ${o.plotArea} m² > max`;
  }
  if (has(s.pricePerM2Max) && o.pricePerM2 && o.pricePerM2 > Number(s.pricePerM2Max)) return `${Math.round(o.pricePerM2)} zł/m² > max`;

  const text = norm(`${o.title} ${o.description} ${o.location}`);
  for (const kw of parseKeywords(s.keywordsExcluded)) {
    const alts = kw.split('|').map(norm).filter(Boolean);
    const hit = alts.find((a) => new RegExp(`\\b${escapeRe(a)}`).test(text));
    if (hit) return `zawiera wykluczone „${hit}”`;
  }
  for (const kw of parseKeywords(s.keywordsRequired)) {
    const alts = kw.split('|').map(norm).filter(Boolean);
    if (!alts.some((a) => new RegExp(`\\b${escapeRe(a)}`).test(text))) return `brak wymaganego „${kw}”`;
  }
  return null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { enrich, rejectReason, parseKeywords };
