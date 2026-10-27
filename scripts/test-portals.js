'use strict';

// Live test against the real portals: node scripts/test-portals.js [portal ...]
// Uses a throw-away data dir so it never touches the real data/.
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'estate-test-'));

const checker = require('../src/checker');
const portalsMod = require('../src/portals');
const { normalize, coverage } = require('../src/criteria');
const { fmtInt } = require('../src/util');

// Cases: node scripts/test-portals.js [--case=dzialki|domy|wynajem] [portal ...]
const CASES = {
  dzialki: { name: 'TEST działki Wieliczka/Niepołomice', propertyType: 'plot', transaction: 'sale', locations: ['Wieliczka', 'Niepołomice'], priceMax: 800000, keywordsExcluded: 'rolna' },
  media: { name: 'TEST działki budowlane z mediami', propertyType: 'plot', transaction: 'sale', locations: ['Wieliczka', 'Niepołomice'], priceMax: 800000, plotTypes: ['building'], media: ['electricity', 'water', 'sewage'], mediaAllowRoad: true, zoning: 'any' },
  domy: { name: 'TEST domy Wieliczka +5 km', propertyType: 'house', transaction: 'sale', locations: ['Wieliczka'], radiusKm: 5, priceMin: 800000, priceMax: 2000000, plotAreaMin: 400, areaMin: 100 },
  domy2: { name: 'TEST bliźniaki/szeregowce 4+ pok.', propertyType: 'house', transaction: 'sale', locations: ['Niepołomice', 'Wieliczka'], radiusKm: 5, priceMax: 1800000, houseTypes: ['semi', 'terraced'], roomsMin: 4, buildYearMin: 2005, houseStates: ['ready', 'to_finish'] },
  mieszkania: { name: 'TEST mieszkania Kraków 2-3 pok., piętro 1-4, winda, balkon', propertyType: 'flat', transaction: 'sale', locations: ['Kraków'], regionHint: 'małopolskie', priceMax: 900000, roomsMin: 2, roomsMax: 3, floorMin: 1, floorMax: 4, market: 'secondary', elevator: true, balcony: true },
  obszar: { name: 'TEST obszar Niepołomice (prostokąt)', propertyType: 'plot', transaction: 'sale', locations: [], priceMax: 800000, plotTypes: ['building'], media: ['electricity', 'water'], areas: [{ type: 'rectangle', points: [[50.06, 20.17], [50.06, 20.26], [50.02, 20.26], [50.02, 20.17]] }] },
  obszar2: { name: 'TEST dwa okręgi + Kłaj wpisany', propertyType: 'plot', transaction: 'sale', locations: ['Kłaj (wielicki)'], priceMax: 900000, areas: [{ type: 'circle', center: [49.987, 20.065], radius: 1500 }, { type: 'circle', center: [50.035, 20.22], radius: 1200 }] },
  wynajem: { name: 'TEST mieszkania wynajem Kraków', propertyType: 'flat', transaction: 'rent', locations: ['Kraków'], priceMax: 3500, areaMin: 40, regionHint: 'małopolskie' },
};
const args = process.argv.slice(2);
const caseName = (args.find((a) => a.startsWith('--case=')) || '--case=dzialki').slice(7);
const only = args.filter((a) => !a.startsWith('--'));
const details = Number((args.find((a) => a.startsWith('--details=')) || '--details=0').slice(10));
const search = normalize({
  id: `test-${caseName}`,
  enabled: true,
  regionHint: '',
  radiusKm: 0,
  ...CASES[caseName],
  portals: Object.fromEntries(['otodom', 'olx', 'gratka', 'morizon', 'nonline'].map((p) => [p, !only.length || only.includes(p)])),
});
// Like the panel: towns inside the drawn areas (inside = on, edge = off).
async function prepareAreas() {
  if (!search.areas.length) return;
  const found = await require('../src/nearby').inArea(search.areas);
  search.areaTowns = found.map((t) => ({ ...t, enabled: t.status === 'inside' }));
  console.log(`miejscowości w obszarze: ${found.filter((t) => t.status === 'inside').map((t) => t.name).join(', ')}`);
  console.log(`przy granicy (wyłączone): ${found.filter((t) => t.status === 'edge').map((t) => t.name).join(', ')}`);
}
for (const c of coverage(search)) console.log(`filtr ${c.label}: ${Object.entries(c.portals).map(([p, v]) => `${p}=${v}`).join(' ')}`);

(async () => {
  await prepareAreas();
  // like picking each town from the list in the panel (commune + county, TERYT)
  search.locationPins = (await require('../src/migrate').pinTowns(search)).pins;
  for (const p of search.locationPins) console.log(`miejscowość: ${p.teryt?.label || p.query}`);
  const r = await checker.collect(search, { preview: true });
  // Optionally read offer pages of the first N matching offers per portal (like for new offers).
  if (details) {
    for (const [pid, res] of Object.entries(r.portals)) {
      const portal = portalsMod.byId[pid];
      if (!portal.fetchDetail) continue;
      for (const o of res.targets.flatMap((t) => t.offers).filter((o) => !o.reject).slice(0, details)) {
        await new Promise((ok) => setTimeout(ok, 2500));
        try {
          const d = await portal.fetchDetail(o);
          o.attrs = { ...(o.attrs || {}), ...Object.fromEntries(Object.entries(d.attrs || {}).filter(([, v]) => v !== undefined)) };
          o.kv = [...(o.kv || []), ...(d.kv || [])];
          if (d.description) o.description = d.description;
          if (d.lat != null) Object.assign(o, { lat: d.lat, lon: d.lon, approxCoords: false });
          o.detailAt = Date.now();
          checker.evaluate(o, search);
        } catch (e) {
          o.detailError = e.message;
        }
      }
    }
  }
  let failures = 0;
  for (const [pid, res] of Object.entries(r.portals)) {
    console.log(`\n=== ${pid.toUpperCase()} ${res.error ? `(${res.error})` : ''}`);
    for (const l of r.resolved.portals[pid]?.locations || []) {
      console.log(`  lokalizacja: ${l.query} -> ${l.ok ? l.label : `NIE ROZWIĄZANO: ${l.error}`}`);
    }
    if (!res.targets.length) failures++;
    for (const t of res.targets) {
      console.log(`  URL: ${t.url}`);
      if (t.error) {
        failures++;
        console.log(`  BŁĄD: ${t.error}`);
        continue;
      }
      console.log(`  metoda: ${t.method}${t.note ? ` (${t.note})` : ''}; ofert: ${t.offers.length}; portal deklaruje: ${t.total ?? '?'}`);
      if (!t.offers.length) failures++;
      for (const o of t.offers.slice(0, 12)) {
        const bad = [];
        if (!o.title) bad.push('brak tytułu');
        if (!o.url?.startsWith('http')) bad.push('zły URL');
        if (!o.price) bad.push('brak ceny');
        if (!o.area) bad.push('brak m²');
        if (!o.image) bad.push('brak zdjęcia');
        console.log(
          `   ${o.reject ? '✗' : '✓'} ${String(o.title).slice(0, 50).padEnd(50)} ${fmtInt(o.price).padStart(9)} zł ${String(o.area ?? '?').padStart(6)} m² ${String(o.location).slice(0, 22).padEnd(22)} ${o.lat != null ? (o.approxCoords ? '≈' : '◉') : ' '}${o.detailAt ? ' [szczegóły]' : ''}${o.reject ? `  [${o.reject}]` : ''}${bad.length ? `  !! ${bad.join(', ')}` : ''}`
        );
        if (o.featureSummary?.length || o.unverified?.length) console.log(`        ✨ ${o.featureSummary.join(' · ')}${o.unverified?.length ? `   ❔ ${o.unverified.join(', ')}` : ''}`);
      }
    }
  }
  console.log(`\n${failures ? `PROBLEMY: ${failures}` : 'OK: wszystkie portale zwróciły oferty'}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
