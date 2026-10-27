'use strict';

const crypto = require('crypto');
const store = require('./store');
const portals = require('./portals');
const { norm, haversine, sleep, randInt } = require('./util');
const { effectiveLocations } = require('./criteria');

const SUGGEST_TTL_MS = 30 * 24 * 3600 * 1000;

/** "Podłęże (wielicki)" -> { name: 'Podłęże', hint: 'wielicki' }; "gmina Niepołomice" -> commune wanted */
function parseEntry(raw) {
  let s = String(raw || '').trim();
  let hint = '';
  const m = s.match(/^(.*?)\s*\((.+)\)\s*$/);
  if (m) {
    s = m[1].trim();
    hint = m[2].trim();
  }
  let wantCommune = false;
  const g = s.match(/^(?:gmina|gm\.)\s+(.+)$/i);
  if (g) {
    wantCommune = true;
    s = g[1].trim();
  }
  return { raw: String(raw).trim(), name: s, hint, wantCommune };
}

// Failed lookups (e.g. OLX answering 403) are not retried for an hour, so a long list of towns
// does not turn into dozens of blocked requests on every run.
const failed = new Map();
const FAIL_TTL_MS = 60 * 60 * 1000;

async function cachedSuggest(portal, name, { force = false } = {}) {
  const key = `${portal.id}|${norm(name)}`;
  const cache = store.load('geocache', {});
  const hit = cache[key];
  if (!force && hit && Date.now() - hit.at < SUGGEST_TTL_MS) return hit.list;
  const f = failed.get(key);
  if (!force && f && Date.now() - f.at < FAIL_TTL_MS) throw new Error(`${f.message} (ponowię później)`);
  let list;
  try {
    list = await portal.suggest(name);
  } catch (e) {
    failed.set(key, { at: Date.now(), message: e.message });
    throw e;
  }
  failed.delete(key);
  store.update('geocache', {}, (c) => {
    c[key] = { at: Date.now(), list };
  });
  await sleep(randInt(700, 1600));
  return list;
}

// Context like "wieś, Niepołomice, wielicki, małopolskie" -> ['niepolomice', 'wielicki', 'malopolskie']
function contextTokens(context) {
  return String(context || '')
    .split(',')
    .map((p) => norm(p).replace(/^(gm|gmina|pow|powiat|wies|miasto|wojewodztwo)\s+/, '').replace(/\s+pow$/, '').replace(/\s+gm$/, ''))
    .filter((p) => p && !['wies', 'miasto', 'gmina', 'polska', 'ulica'].includes(p));
}

const LEVEL_SCORE = { town: 30, district: 20, commune: 10 };

/**
 * Picks the candidate that best matches the entry.
 * ctx: { hints: [...], anchor: {lat, lon, tokens}, centroid: {lat, lon} }
 */
function choose(cands, entry, ctx = {}) {
  const usable = (cands || []).filter((c) => c.level !== 'street');
  const want = norm(entry.name);
  let pool = usable.filter((c) => norm(c.name) === want);
  let approx = false;
  if (!pool.length) {
    pool = usable.filter((c) => norm(c.name).startsWith(want) || want.startsWith(norm(c.name)));
    approx = pool.length > 0;
  }
  if (!pool.length) return null;
  const hints = (ctx.hints || []).map(norm).filter(Boolean);
  let best = null;
  pool.forEach((c, idx) => {
    const cctx = norm(`${c.context} ${c.label}`);
    let score = -idx * 0.5;
    for (const h of hints) score += cctx.includes(h) ? 100 : -100;
    if (entry.wantCommune) score += c.level === 'commune' ? 60 : 0;
    score += LEVEL_SCORE[c.level] || 0;
    if (ctx.anchor) {
      const toks = new Set(contextTokens(c.context));
      for (const t of ctx.anchor.tokens || []) if (toks.has(t)) score += 15;
      const d = haversine(ctx.anchor, c);
      if (d !== null) score += d < 15 ? 50 - d : -Math.min(d, 300) / 3;
    }
    if (ctx.centroid) {
      const d = haversine(ctx.centroid, c);
      if (d !== null) score -= Math.min(d, 400) / 2;
    }
    if (!best || score > best.score) best = { cand: c, score };
  });
  const c = best.cand;
  const ambiguous = pool.length > 1;
  return { ...c, approx: approx || (entry.wantCommune && c.level !== 'commune'), ambiguous };
}

// Everything that can change the portal URLs (client-side-only fields are harmless here:
// a changed URL is baselined again anyway, an unchanged one keeps its history).
const NOT_IN_HASH = new Set(['id', 'name', 'enabled', 'telegramThreadId', 'keywordsRequired', 'keywordsExcluded', 'createdAt', 'updatedAt', 'zoning', 'houseStates', 'minWidth', 'garage']);
function criteriaHash(search) {
  const obj = Object.fromEntries(Object.keys(search).filter((k) => !NOT_IN_HASH.has(k)).sort().map((k) => [k, search[k]]));
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 12);
}

/** Resolves locations and builds search URLs for every enabled portal. */
async function resolveSearch(search, { force = false } = {}) {
  const hash = criteriaHash(search);
  const cached = store.load('resolved', {})[search.id];
  if (!force && cached && cached.hash === hash && Date.now() - cached.at < SUGGEST_TTL_MS && !cached.hasErrors) return cached;

  const { locations, pins } = effectiveLocations(search);
  const all = locations.map(parseEntry).filter((e) => e.name);
  // Only towns picked from the list (with their commune and county) or found in a drawn area are
  // searched. A bare name is never guessed: the panel asks to pick it from the list.
  const unresolved = [];
  const entries = [];
  const known = [];
  for (const e of all) {
    const pin = pins.find((p) => norm(p.query) === norm(e.raw) && p.lat != null);
    if (!pin) {
      unresolved.push({ query: e.raw, reason: 'nie wybrano z listy — nazwa może pasować do kilku miejscowości' });
      continue;
    }
    const t = pin.teryt;
    if (t?.level === 'commune') e.wantCommune = true;
    entries.push(e);
    known.push({
      lat: pin.lat,
      lon: pin.lon,
      label: t?.label || pin.label,
      extentKm: t?.extentKm ?? (pin.fromArea ? 1 : 1.5),
      teryt: !!t,
      tokens: [norm(pin.name || e.name), ...(t ? [t.gmina, t.powiat, t.city].filter(Boolean).map(norm) : contextTokens(pin.context))],
      fromArea: !!pin.fromArea,
    });
  }
  const anchors = known;
  const hasAreas = (search.areas || []).length > 0;
  const result = {
    hash,
    at: Date.now(),
    portals: {},
    hasErrors: false,
    unresolved,
    anchors: entries.map((e, i) => ({
      query: e.raw,
      name: e.name,
      lat: anchors[i].lat,
      lon: anchors[i].lon,
      label: anchors[i].label || e.raw,
      extentKm: anchors[i].extentKm,
      tokens: anchors[i].tokens,
      fromArea: anchors[i].fromArea,
    })),
  };

  for (const portal of portals.list) {
    if (!search.portals?.[portal.id]) continue;
    const pr = { locations: [], targets: [], error: null };
    const resolved = [];
    // Portals that search inside a drawn polygon get the polygon instead of the towns found in it.
    const byArea = hasAreas && typeof portal.buildAreaTargets === 'function';
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (byArea && known[i]?.fromArea) continue;
      try {
        const cands = await cachedSuggest(portal, e.name, { force });
        const hints = [search.regionHint, e.hint].filter(Boolean);
        const pick = choose(cands, e, { hints, anchor: anchors[i] });
        if (!pick) {
          pr.locations.push({ query: e.raw, ok: false, error: 'portal nie zna tej miejscowości' });
          continue;
        }
        // Sanity check: a pick far from the chosen town is almost surely a different town with the same name.
        const dist = haversine(anchors[i], pick);
        const maxKm = anchors[i].teryt ? Math.max(15, anchors[i].extentKm + 10) : 40;
        if (dist !== null && dist > maxKm) {
          pr.locations.push({ query: e.raw, ok: false, error: `najbliższe dopasowanie „${pick.label}” jest ${Math.round(dist)} km od właściwej miejscowości` });
          continue;
        }
        resolved.push({ ...pick, fromArea: !!known[i]?.fromArea });
        pr.locations.push({
          query: e.raw,
          ok: true,
          id: pick.id,
          label: pick.label,
          approx: !!pick.approx,
          ambiguous: !!pick.ambiguous,
        });
      } catch (err) {
        result.hasErrors = true;
        pr.locations.push({ query: e.raw, ok: false, error: `błąd zapytania: ${err.message}` });
      }
    }
    try {
      if (resolved.length) {
        pr.targets = await portal.buildTargets(search, resolved);
        // Where each URL comes from: typed-in towns are not limited by the drawn areas.
        pr.targets.forEach((t, k) => {
          if (pr.targets.length === resolved.length) t.scope = resolved[k].fromArea ? 'areaTown' : 'manual';
          else t.scope = resolved.every((r) => !r.fromArea) ? 'manual' : 'mixed';
        });
      }
      if (byArea) pr.targets.push(...(await portal.buildAreaTargets(search, search.areas)).map((t) => ({ ...t, scope: 'area' })));
    } catch (err) {
      result.hasErrors = true;
      pr.error = `Nie udało się zbudować URL: ${err.message}`;
    }
    if (!pr.targets.length && !pr.error) pr.error = 'Żadna miejscowość nie została rozpoznana na tym portalu';
    result.portals[portal.id] = pr;
  }

  store.update('resolved', {}, (all) => {
    all[search.id] = result;
  });
  return result;
}

function forget(searchId) {
  store.update('resolved', {}, (all) => {
    delete all[searchId];
  });
}

module.exports = { resolveSearch, parseEntry, choose, criteriaHash, forget, contextTokens, cachedSuggest };
