'use strict';

// Unique administrative assignment of a chosen town: voivodeship → county → commune → town (TERYT).
// Names come from the portal suggestion the user picked (Gratka/Morizon list them by TERYT);
// codes (TERC of the commune and county, SIMC of the town) and the town's extent come from
// OpenStreetMap (Nominatim). Without OSM the names alone still identify the town; codes are
// filled in on a later attempt.

const store = require('./store');
const nominatim = require('./nominatim');
const { norm, haversine } = require('./util');

const strip = (s, word) => String(s || '').replace(new RegExp(`^${word}\\s+`, 'i'), '').trim() || null;

/**
 * Portal suggestion context -> names.
 *   town:     "wieś, Niepołomice, wielicki, małopolskie" (kind, commune, county, voivodeship)
 *             "miasto, lubuskie" (city with county rights)
 *   commune:  "gmina, krakowski, małopolskie"
 *   district: "dzielnica, Zielona Góra, lubuskie" / "obszar w dzielnicy, Prądnik Biały, Kraków, małopolskie"
 */
function parseContext(context, level) {
  const parts = String(context || '').split(',').map((x) => x.trim()).filter(Boolean);
  const kind = parts.shift() || '';
  const woj = parts.length ? parts.pop() : null;
  if (level === 'commune') return { kind: 'gmina', gmina: null, powiat: parts[0] || null, woj };
  if (level === 'district') return { kind, city: parts.join(', ') || null, gmina: null, powiat: null, woj }; // "Prądnik Biały, Kraków"
  if (parts.length >= 2) return { kind, gmina: parts[0], powiat: parts[1], woj };
  if (parts.length === 1) return { kind, gmina: null, powiat: parts[0], woj };
  return { kind, gmina: null, powiat: null, woj, cityCounty: kind === 'miasto' };
}

/** "Podłęże (gm. Niepołomice, pow. wielicki)" */
function shortLabel(t) {
  if (t.level === 'commune') return `gmina ${t.name}${t.powiat ? ` (pow. ${t.powiat})` : ''}`;
  if (t.cityCounty) return `${t.name} (miasto na prawach powiatu)`;
  if (t.city) return `${t.name} (${t.city})`;
  const bits = [t.gmina && `gm. ${t.gmina}`, t.powiat && `pow. ${t.powiat}`].filter(Boolean);
  return bits.length ? `${t.name} (${bits.join(', ')})` : t.name;
}

/** "Podłęże — wieś, gm. Niepołomice, pow. wielicki, woj. małopolskie" (autocomplete list) */
function longLabel(item) {
  const c = parseContext(item.context, item.level);
  const bits = [
    item.level === 'commune' ? 'gmina' : c.kind,
    c.city,
    c.cityCounty && 'miasto na prawach powiatu',
    c.gmina && `gm. ${c.gmina}`,
    c.powiat && `pow. ${c.powiat}`,
    c.woj && `woj. ${c.woj}`,
  ].filter(Boolean);
  return `${item.level === 'commune' ? `gmina ${item.name}` : item.name} — ${bits.join(', ')}`;
}

// Half of the bounding-box diagonal: how far the town reaches from its centre (km).
function extentOf(bb) {
  if (!Array.isArray(bb) || bb.length < 4) return null;
  const [s, n, w, e] = bb.map(Number);
  const d = haversine({ lat: s, lon: w }, { lat: n, lon: e });
  return d === null ? null : Math.min(15, Math.max(0.5, d / 2));
}
const DEFAULT_EXTENT = { miasto: 2.5, gmina: 6 };

const cacheKey = (x) => `${x.level || 'town'}|${norm(x.name)}|${Number(x.lat).toFixed(3)}|${Number(x.lon).toFixed(3)}`;

/**
 * Full description of a picked town: names, TERYT codes, extent.
 * item: { name, level: 'town'|'commune'|'district', context, lat, lon } — never throws.
 */
async function describe(item, { force = false } = {}) {
  const key = cacheKey(item);
  const hit = store.load('teryt', {})[key];
  if (hit && hit.codes && !force) return hit;
  const level = item.level || 'town';
  const c = parseContext(item.context, level);
  const t = {
    name: item.name,
    level,
    kind: c.kind || (level === 'commune' ? 'gmina' : ''),
    gmina: c.gmina,
    powiat: c.powiat,
    woj: c.woj,
    city: c.city || null,
    cityCounty: !!c.cityCounty,
    lat: Number(item.lat),
    lon: Number(item.lon),
    simc: null,
    terc: null, // commune
    powiatTerc: null,
    wojTerc: null,
    extentKm: DEFAULT_EXTENT[level === 'commune' ? 'gmina' : c.kind] || 1.5,
    codes: false,
  };
  try {
    if (level === 'commune') {
      const found = await nominatim.search(`gmina ${t.name}${t.powiat ? `, powiat ${t.powiat}` : ''}${t.woj ? `, ${t.woj}` : ''}`);
      const g = found.find((x) => String(x.extratags?.['teryt:terc'] || '').length === 7 && norm(strip(x.name, 'gmina')) === norm(t.name)) || null;
      if (g) {
        t.terc = g.extratags['teryt:terc'];
        t.extentKm = extentOf(g.boundingbox) ?? t.extentKm;
        t.powiat = t.powiat || strip(g.address?.county, 'powiat');
        t.woj = t.woj || strip(g.address?.state, 'województwo');
        // the portal's point for a commune is its centroid; Nominatim's is the commune seat
        if (!Number.isFinite(t.lat)) Object.assign(t, { lat: Number(g.lat), lon: Number(g.lon) });
      }
    } else {
      const r10 = await nominatim.reverse(t.lat, t.lon, 10);
      const a = r10.address || {};
      if (norm(r10.name) === norm(t.name)) {
        t.simc = r10.extratags?.['teryt:simc'] || null;
        t.extentKm = extentOf(r10.boundingbox) ?? t.extentKm;
      }
      t.gmina = t.gmina || strip(a.municipality, 'gmina');
      t.powiat = t.powiat || strip(a.county, 'powiat');
      t.woj = t.woj || strip(a.state, 'województwo');
      const r8 = await nominatim.reverse(t.lat, t.lon, 8);
      const pt = String(r8.extratags?.['teryt:terc'] || '');
      if (pt.length === 4) {
        t.powiatTerc = pt;
        if (r8.addresstype === 'city' || r8.type === 'city') {
          // city with county rights (Kraków, Rzeszów…): commune = county = the city
          t.cityCounty = !t.city && norm(r8.name) === norm(t.name);
          t.powiat = t.powiat || r8.name;
          if (t.cityCounty) t.extentKm = extentOf(r8.boundingbox) ?? t.extentKm;
        }
      }
      if (t.gmina && !t.cityCounty) {
        const found = await nominatim.search(`gmina ${t.gmina}${t.powiat ? `, powiat ${t.powiat}` : ''}`);
        const g = found.find((x) => {
          const code = String(x.extratags?.['teryt:terc'] || '');
          return code.length === 7 && (!t.powiatTerc || code.startsWith(t.powiatTerc)) && norm(strip(x.name, 'gmina')) === norm(t.gmina);
        });
        if (g) t.terc = g.extratags['teryt:terc'];
      }
      if (!t.simc && !t.city && !t.cityCounty) {
        const found = await nominatim.search(`${t.name}${t.gmina ? `, gmina ${t.gmina}` : ''}${t.powiat ? `, powiat ${t.powiat}` : ''}`);
        const p = found
          .filter((x) => norm(x.name) === norm(t.name) && x.extratags?.['teryt:simc'])
          .sort((x, y) => haversine(t, { lat: +x.lat, lon: +x.lon }) - haversine(t, { lat: +y.lat, lon: +y.lon }))[0];
        if (p && haversine(t, { lat: +p.lat, lon: +p.lon }) < 5) {
          t.simc = p.extratags['teryt:simc'];
          t.extentKm = extentOf(p.boundingbox) ?? t.extentKm;
        }
      }
    }
    t.wojTerc = (t.terc || t.powiatTerc || '').slice(0, 2) || null;
    if (!t.powiatTerc && t.terc) t.powiatTerc = t.terc.slice(0, 4);
    t.codes = !!(t.terc || t.powiatTerc || t.simc);
  } catch (e) {
    t.error = `OpenStreetMap: ${e.message}`;
  }
  t.label = shortLabel(t);
  if (t.codes) {
    store.update('teryt', {}, (all) => {
      all[key] = t;
    });
  }
  return t;
}

/** Only the fields a saved search keeps (and accepts from the panel). */
function clean(t) {
  if (!t || typeof t !== 'object') return null;
  const s = (v, n = 80) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, n));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    name: s(t.name),
    level: ['town', 'commune', 'district'].includes(t.level) ? t.level : 'town',
    kind: s(t.kind, 40),
    gmina: s(t.gmina),
    powiat: s(t.powiat),
    woj: s(t.woj, 40),
    city: s(t.city),
    cityCounty: !!t.cityCounty,
    simc: s(t.simc, 10),
    terc: s(t.terc, 10),
    powiatTerc: s(t.powiatTerc, 10),
    wojTerc: s(t.wojTerc, 4),
    extentKm: num(t.extentKm),
    codes: !!t.codes,
    label: s(t.label, 160) || shortLabel(t),
  };
}

module.exports = { describe, parseContext, shortLabel, longLabel, clean };
