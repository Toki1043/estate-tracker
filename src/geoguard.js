'use strict';

// Last line of defence against a portal ignoring the location filter (it happened: Gratka and
// Morizon once returned the newest plots from all over Poland for a whole night). Every offer
// must lie within the search radius + 5 km of a chosen town (measured from the town's edge)
// or of a drawn area. Offers without coordinates are placed at the town named in the offer,
// found with the portal's own place search and the commune/county it states.

const geo = require('./geo');
const portals = require('./portals');
const { norm, haversine } = require('./util');

const MARGIN_KM = 5;
const TEXT_SLACK_KM = 1.5; // a town named in the offer: its centre, the plot may be at its edge
const APPROX_SLACK_KM = 2; // approximate coordinates from the portal (e.g. an OLX circle)

/** anchors: resolved.anchors (chosen towns with lat/lon, extentKm, label). */
function build(search, anchors) {
  const refs = (anchors || [])
    .filter((a) => a.lat != null && a.lon != null)
    .map((a) => ({ lat: a.lat, lon: a.lon, extentKm: Number.isFinite(a.extentKm) ? a.extentKm : 1.5, label: a.label || a.name, tokens: a.tokens || [norm(a.name)] }));
  const areas = search.areas || [];
  if (!refs.length && !areas.length) return null;
  return { refs, areas, limitKm: (Number(search.radiusKm) || 0) + MARGIN_KM };
}

/** Distance (km) from a point to the nearest chosen town (beyond its extent) or drawn area. */
function nearest(g, lat, lon) {
  let best = { km: Infinity, to: null };
  for (const r of g.refs) {
    const d = Math.max(0, geo.distKm([r.lat, r.lon], [lat, lon]) - r.extentKm);
    if (d < best.km) best = { km: d, to: r.label };
  }
  g.areas.forEach((a, i) => {
    const d = geo.distanceToArea([lat, lon], a);
    if (d < best.km) best = { km: d, to: g.areas.length > 1 ? `obszaru ${i + 1}` : 'narysowanego obszaru' };
  });
  return best;
}

const NOT_PLACE = new Set(['street', 'commune', 'county', 'region', 'kraj']);
const STREET = /^(ul\.|al\.|pl\.|os\.|ul |al |osiedle )/i;
/** "Podłęże, Niepołomice" / "Ruczaj, Dębniki, Kraków" / "Wieliczka, ul. Spacerowa" -> parts without streets */
function placeParts(location) {
  return String(location || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !STREET.test(x) && !/\d/.test(x));
}

const memo = new Map();

/**
 * The town an offer names: the portal place search (cached for 30 days), the candidate whose
 * commune/county/voivodeship matches the rest of the offer's location; for a bare name the one
 * nearest to the chosen towns. null when nothing matches.
 */
async function locateText(location, g) {
  const parts = placeParts(location);
  if (!parts.length) return null;
  const key = parts.map(norm).join('|');
  if (memo.has(key)) return memo.get(key);
  const { cachedSuggest } = require('./locations');
  const c0 = !g.refs.length && g.areas.length ? geo.centroid(geo.ring(g.areas[0])) : null;
  const center = g.refs[0] || (c0 ? { lat: c0[0], lon: c0[1] } : null);
  let out = null;
  let fallback = null;
  for (const [i, part] of parts.entries()) {
    let cands = null;
    for (const src of [portals.byId.gratka, portals.byId.morizon]) {
      try {
        cands = await cachedSuggest(src, part);
        break;
      } catch {}
    }
    if (!cands) return null; // portal place search unavailable: decide later, do not memoize
    // the parts after this one are the larger units it lies in (district, commune, city, voivodeship)
    const hints = parts.slice(i + 1).map(norm);
    // towns, villages and city districts (cached lists may still say "obszar w dzielnicy")
    const pool = cands.filter((c) => !NOT_PLACE.has(c.level) && norm(c.name) === norm(part) && c.lat != null);
    if (!pool.length) continue;
    const scored = pool.map((c) => {
      const ctx = norm(c.context);
      const matches = hints.filter((h) => ` ${ctx} `.includes(` ${h} `)).length;
      return { c, matches, dist: center ? haversine(center, c) : 0 };
    });
    scored.sort((a, b) => b.matches - a.matches || a.dist - b.dist);
    const best = scored[0];
    const hit = { lat: best.c.lat, lon: best.c.lon, name: best.c.name, label: `${best.c.name} (${best.c.context})` };
    // The rest of the location ("Prądnik Biały, Kraków") fits none of the towns with this name:
    // try the next part instead of taking a namesake; the nearest namesake is the last resort.
    if (hints.length && !best.matches) {
      fallback = fallback || hit;
      continue;
    }
    out = hit;
    break;
  }
  out = out || fallback;
  memo.set(key, out);
  return out;
}

const needsText = (o) => o.lat == null || o.lon == null || o.approxCoords || o.textOnly;

/** Places offers without coordinates at the town they name (sets o.geoRef). */
async function locate(offers, g) {
  if (!g) return;
  for (const o of offers) {
    if (!needsText(o)) continue;
    try {
      o.geoRef = await locateText(o.location, g);
    } catch {
      o.geoRef = null;
    }
  }
}

/** { reject } for an offer too far away; { note } when its position cannot be confirmed. */
function verdict(o, g) {
  if (!g) return {};
  let pt = null;
  let slack = 0;
  if (o.lat != null && o.lon != null && o.exactCoords && !o.textOnly) pt = [o.lat, o.lon];
  else if (o.lat != null && o.lon != null && !o.approxCoords && !o.textOnly) {
    pt = [o.lat, o.lon];
    slack = APPROX_SLACK_KM;
  } else if (o.geoRef) {
    pt = [o.geoRef.lat, o.geoRef.lon];
    slack = TEXT_SLACK_KM;
  }
  if (!pt) return { note: 'położenie niepotwierdzone' };
  const n = nearest(g, pt[0], pt[1]);
  if (n.km - slack > g.limitKm) {
    const where = o.geoRef && pt[0] === o.geoRef.lat ? ` (${o.geoRef.name})` : '';
    return { reject: `poza obszarem${where}: ${Math.round(n.km)} km od ${n.to}, limit ${g.limitKm} km` };
  }
  return {};
}

module.exports = { build, locate, verdict, nearest, placeParts, MARGIN_KM };
