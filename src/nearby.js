'use strict';

// Neighbouring towns around a point, from OpenStreetMap data:
// Photon (komoot) reverse geocoding first, Overpass API as a fallback. Results are cached.

const http = require('./http');
const { haversine } = require('./util');

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const cache = new Map();

function shape(list, lat, lon, radiusKm) {
  const seen = new Set();
  return list
    .map((x) => ({ ...x, distance: Math.round(haversine({ lat, lon }, x) * 10) / 10 }))
    .filter((x) => x.distance <= radiusKm + 0.5 && !seen.has(x.name) && seen.add(x.name))
    .sort((a, b) => a.distance - b.distance);
}

async function fromPhoton(lat, lon, radiusKm) {
  const tags = ['place:village', 'place:town', 'place:city', 'place:suburb'].map((t) => `&osm_tag=${encodeURIComponent(t)}`).join('');
  const data = await http.getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&radius=${radiusKm}&limit=50&lang=default${tags}`, { timeoutMs: 15000, retries: 0 });
  return (data.features || [])
    .filter((f) => f.properties?.name && f.geometry?.coordinates)
    .map((f) => ({ name: f.properties.name, type: f.properties.osm_value, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
}

async function fromOverpass(lat, lon, radiusKm) {
  const q = `[out:json][timeout:20];node["place"~"^(city|town|village)$"](around:${Math.round(radiusKm * 1000)},${lat},${lon});out body;`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const data = await http.getJson(`${url}?data=${encodeURIComponent(q)}`, { timeoutMs: 20000, retries: 0 });
      return (data.elements || []).filter((e) => e.tags?.name).map((e) => ({ name: e.tags.name, type: e.tags.place, lat: e.lat, lon: e.lon }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function places(lat, lon, radiusKm) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${radiusKm}`;
  if (cache.has(key)) return cache.get(key);
  const errors = [];
  for (const src of [fromPhoton, fromOverpass]) {
    try {
      const out = shape(await src(lat, lon, radiusKm), lat, lon, radiusKm);
      cache.set(key, out);
      return out;
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(`Nie udało się pobrać sąsiednich miejscowości z OpenStreetMap (${errors.join('; ')})`);
}

/** Name of the town a point lies in (Photon reverse geocoding: "city" holds villages too). */
async function localityAt(lat, lon) {
  const data = await http.getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1&lang=default`, { timeoutMs: 15000, retries: 0 });
  const p = data.features?.[0]?.properties;
  if (!p) return null;
  return p.city || (p.osm_key === 'place' && /city|town|village/.test(p.osm_value || '') ? p.name : null);
}

const EDGE_KM = 1.5; // a town this close to the area counts as "touching" it

/**
 * Towns inside the drawn areas or touching them. Town centres come from place nodes around the
 * area; points sampled inside the area add the towns they lie in (a city whose centre is outside).
 */
async function inArea(areas) {
  const geo = require('./geo');
  const found = new Map();
  const add = (x) => {
    const key = `${x.name}|${x.lat.toFixed(2)}|${x.lon.toFixed(2)}`;
    if (!found.has(key)) found.set(key, x);
  };
  const errors = [];
  let budget = 40; // requests per call
  for (const area of areas) {
    const ring = geo.ring(area);
    if (ring.length < 3) continue;
    const c = geo.centroid(ring);
    const reach = Math.max(...ring.map((p) => geo.distKm(c, p)));
    // 1. place nodes: one query for small areas, a grid of queries for big ones
    const queries = [];
    if (reach <= 7) queries.push([c, reach + EDGE_KM + 0.5]);
    else {
      const bb = geo.bbox(ring);
      const stepLat = 8 / 110.57;
      const stepLon = 8 / (111.32 * Math.cos((c[0] * Math.PI) / 180));
      for (let la = bb.south + stepLat / 2; la < bb.north + stepLat / 2; la += stepLat) {
        for (let lo = bb.west + stepLon / 2; lo < bb.east + stepLon / 2; lo += stepLon) {
          if (geo.distanceToArea([la, lo], area) <= 6) queries.push([[la, lo], 6.5]);
        }
      }
    }
    for (const [pt, radius] of queries) {
      if (budget-- <= 0) break;
      try {
        // districts are skipped: the city itself is found by the overlap check below
        for (const x of await fromPhoton(pt[0], pt[1], Math.min(radius, 30))) if (x.type !== 'suburb') add({ ...x, source: 'place' });
      } catch (e) {
        errors.push(e.message);
      }
    }
    // 2. towns the area overlaps (centroid + a few vertices)
    const step = Math.max(1, Math.ceil(ring.length / 8));
    const samples = [c, ...ring.filter((_, i) => i % step === 0)];
    for (const [k, pt] of samples.entries()) {
      if (budget-- <= 0) break;
      try {
        const name = await localityAt(pt[0], pt[1]);
        // the town under the centre of the area is "inside", towns under its corners only touch it
        if (!name) continue;
        const known = [...found.values()].find((x) => x.name === name && geo.distKm([x.lat, x.lon], pt) < 15);
        if (known) known.centre = known.centre || k === 0;
        else add({ name, lat: pt[0], lon: pt[1], type: 'locality', source: 'overlap', centre: k === 0 });
      } catch (e) {
        errors.push(e.message);
      }
    }
  }
  if (!found.size && errors.length) throw new Error(`Nie udało się ustalić miejscowości w obszarze (OpenStreetMap): ${errors[0]}`);
  const out = [];
  for (const x of found.values()) {
    const d = Math.min(...areas.map((a) => geo.distanceToArea([x.lat, x.lon], a)));
    // A town found only under a corner of the area merely touches it (its own centre may be far away).
    if (x.source === 'overlap' || x.centre) out.push({ name: x.name, lat: x.lat, lon: x.lon, status: x.centre ? 'inside' : 'edge' });
    else if (d === 0) out.push({ name: x.name, lat: x.lat, lon: x.lon, status: 'inside' });
    else if (d <= EDGE_KM) out.push({ name: x.name, lat: x.lat, lon: x.lon, status: 'edge' });
  }
  // one entry per name (the closest to the area wins)
  const byName = new Map();
  for (const x of out) {
    const prev = byName.get(x.name);
    if (!prev || (prev.status === 'edge' && x.status === 'inside')) byName.set(x.name, x);
  }
  return [...byName.values()].sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, 'pl') : a.status === 'inside' ? -1 : 1));
}

module.exports = { places, inArea };
