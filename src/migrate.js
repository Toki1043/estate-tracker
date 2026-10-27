'use strict';

// Keeps saved searches and offers consistent with the location rules:
//  - every town of a search is pinned to one commune and county (TERYT); a bare name is matched only
//    when it is unambiguous, otherwise the panel asks the user to pick it from the list;
//  - saved offers are re-checked against "radius + 5 km" (offers are only marked, never alerted).
// Runs once at start-up and after a search is saved.

const store = require('./store');
const criteria = require('./criteria');
const teryt = require('./teryt');
const geoguard = require('./geoguard');
const offersStore = require('./offers');
const portals = require('./portals');
const { resolveSearch, parseEntry, contextTokens, cachedSuggest } = require('./locations');
const { norm, haversine } = require('./util');

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function suggestions(name) {
  for (const src of [portals.byId.gratka, portals.byId.morizon]) {
    try {
      return await cachedSuggest(src, name);
    } catch {}
  }
  return null;
}

/** The portal's list entry for a saved town: same name and level, same commune/county as its old pin. */
async function itemFor(raw, pin) {
  const e = parseEntry(raw);
  const level = e.wantCommune ? 'commune' : 'town';
  const cands = await suggestions(e.name);
  if (!cands) return { error: 'lista miejscowości chwilowo niedostępna' };
  const exact = cands.filter((c) => norm(c.name) === norm(e.name) && c.level === level && c.lat != null);
  if (pin && pin.lat != null) {
    const tokens = contextTokens(pin.context);
    const near = exact
      .filter((c) => haversine(pin, c) < 15 && (!tokens.length || contextTokens(c.context).some((t) => tokens.includes(t))))
      .sort((a, b) => haversine(pin, a) - haversine(pin, b));
    if (near.length) return { item: near[0] };
    // e.g. a town added from OpenStreetMap: describe it by its coordinates
    return { item: { name: pin.name || e.name, level, context: '', lat: pin.lat, lon: pin.lon } };
  }
  const hinted = e.hint ? exact.filter((c) => norm(c.context).includes(norm(e.hint))) : exact;
  if (hinted.length === 1) return { item: hinted[0] };
  return { error: hinted.length ? `${hinted.length} miejscowości o tej nazwie` : 'portal nie zna tej nazwy' };
}

/** TERYT pins for the towns of a search (unambiguous ones only). Does not save anything. */
async function pinTowns(s) {
  let changed = false;
  const pins = [];
  for (const q of s.locations) {
    const pin = s.locationPins.find((p) => p.query === q);
    if (pin?.teryt?.codes) {
      pins.push(pin);
      continue;
    }
    const { item, error } = await itemFor(q, pin);
    if (!item) {
      if (pin) pins.push(pin);
      log(`[${s.name}] „${q}”: ${error} — do wybrania z listy w panelu`);
      continue;
    }
    const t = teryt.clean(await teryt.describe(item));
    if (!t.codes && pin?.teryt) {
      pins.push(pin); // OSM unavailable: keep what we had, try again next time
      continue;
    }
    pins.push({ query: q, name: item.name, label: t.label, context: item.context || pin?.context || '', lat: item.lat, lon: item.lon, teryt: t });
    changed = true;
    log(`[${s.name}] „${q}” → ${t.label}${t.codes ? ` (TERC ${t.terc || t.powiatTerc}${t.simc ? `, SIMC ${t.simc}` : ''})` : ' (bez kodów TERYT — OpenStreetMap niedostępny)'}`);
  }
  return { pins, changed };
}

/** Adds TERYT data to the towns of one saved search. Returns the updated search. */
async function upgradeSearch(id) {
  const raw = store.load('searches', []).find((x) => x.id === id);
  if (!raw) return null;
  const s = criteria.normalize(raw);
  const { pins, changed } = await pinTowns(s);
  if (!changed && s.locations.length === (raw.locations || []).length) return s;
  s.locationPins = pins;
  store.update('searches', [], (list) => list.map((x) => (x.id === s.id ? { ...x, locations: s.locations, locationPins: pins } : x)));
  return s;
}

/** Distance check of the saved offers of one search. */
async function recheckSearch(s) {
  const resolved = await resolveSearch(s);
  const g = geoguard.build(s, resolved.anchors);
  if (!g) return { rejected: 0, restored: 0 };
  const recs = Object.values(store.load('offers', {})[s.id] || {});
  // Saved offers do not say whether their position came from the portal or from us: without exact
  // coordinates, go by the town named in the offer.
  const probes = recs.map((r) => ({ key: r.key, lat: r.lat, lon: r.lon, exactCoords: r.exactCoords, textOnly: !r.exactCoords, location: r.location }));
  await geoguard.locate(probes, g);
  const verdicts = new Map();
  for (const p of probes) {
    let v = geoguard.verdict(p, g);
    if (!p.geoRef && p.textOnly && p.lat != null) v = geoguard.verdict({ ...p, textOnly: false }, g);
    verdicts.set(p.key, { reject: v.reject || null, ref: p.geoRef || null });
  }
  return offersStore.applyGeo(s.id, verdicts);
}

/** Search saved in the panel: TERYT for new towns, URLs, saved offers re-checked. */
async function refreshSearch(id, { force = false } = {}) {
  const s = await upgradeSearch(id);
  if (!s) return;
  await resolveSearch(s, { force });
  const r = await recheckSearch(s);
  if (r.rejected || r.restored) log(`[${s.name}] kontrola położenia zapisanych ofert: ${r.rejected} odrzuconych jako spoza obszaru, ${r.restored} przywróconych (bez alertów)`);
}

async function run() {
  for (const raw of store.load('searches', [])) {
    try {
      await refreshSearch(raw.id);
    } catch (e) {
      log(`[${raw.name}] aktualizacja lokalizacji: ${e.message}`);
    }
  }
}

let readyPromise = Promise.resolve();
function start() {
  readyPromise = run().catch((e) => log('[migracja]', e.message));
  return readyPromise;
}
const ready = () => readyPromise;

module.exports = { start, ready, refreshSearch, recheckSearch, upgradeSearch, pinTowns };
