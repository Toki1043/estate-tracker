'use strict';

// Offers found by each search, for the gallery and the map (data/offers.json).
// This is separate from seen.json, which drives alerts and is not touched here.

const store = require('./store');
const { fingerprint, isDuplicate } = require('./dedupe');

const MAX_PER_SEARCH = 1500;
const FILE = 'offers';

const keyOf = (o) => `${o.portal}:${o.id}`;

function load() {
  return store.load(FILE, {});
}

/** Saved offer-page data, so an offer's details are fetched only once. */
function getDetail(searchId, key) {
  const r = load()[searchId]?.[key];
  return r?.detail || null;
}

function record(searchId, offers, { alerted = [] } = {}) {
  const now = Date.now();
  const alertedKeys = new Map(alerted.map((o) => [keyOf(o), o]));
  store.update(FILE, {}, (all) => {
    const map = (all[searchId] = all[searchId] || {});
    for (const o of offers) {
      const key = keyOf(o);
      const prev = map[key] || {};
      const rec = {
        key,
        portal: o.portal,
        portalName: o.portalName,
        id: o.id,
        url: o.url,
        title: o.title,
        price: o.price ?? null,
        area: o.area ?? null,
        plotArea: o.plotArea ?? null,
        pricePerM2: o.pricePerM2 ?? null,
        location: o.location || '',
        image: o.image || null,
        createdAt: o.createdAt || prev.createdAt || null,
        description: String(o.description || '').slice(0, 500),
        lat: o.lat ?? null,
        lon: o.lon ?? null,
        exactCoords: !!o.exactCoords,
        features: o.featureSummary || [],
        unverified: o.unverified || [],
        reject: o.reject || null,
        geoReject: o.geoReject || null,
        match: !o.reject,
        firstSeen: prev.firstSeen || now,
        lastSeen: now,
        userStatus: prev.userStatus || null,
        alerted: prev.alerted || false,
        detail: o.detailAt
          ? { at: o.detailAt, attrs: o.attrs || {}, kv: (o.kv || []).slice(0, 120), description: String(o.description || '').slice(0, 4000), lat: o.lat ?? null, lon: o.lon ?? null, exactCoords: !!o.exactCoords }
          : prev.detail || null,
      };
      if (alertedKeys.has(key)) rec.alerted = true;
      map[key] = rec;
    }
    // Same property on several portals: the first one seen is the main card, others point to it.
    const recs = Object.values(map).sort((a, b) => a.firstSeen - b.firstSeen);
    for (const r of recs) {
      r.dupOf = null;
      r.alsoOn = [];
    }
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      const fp = fingerprint(r);
      for (let j = 0; j < i; j++) {
        const q = recs[j];
        if (q.portal === r.portal || q.dupOf) continue;
        if (isDuplicate(fp, fingerprint(q))) {
          r.dupOf = q.key;
          q.alsoOn.push({ portal: r.portalName, url: r.url });
          // The main card borrows the exact position from a copy on another portal.
          if (!q.exactCoords && r.exactCoords && r.lat != null) Object.assign(q, { lat: r.lat, lon: r.lon, exactCoords: true });
          break;
        }
      }
    }
    // Keep the newest ones (favourites always stay).
    if (recs.length > MAX_PER_SEARCH) {
      const removable = recs.filter((r) => r.userStatus !== 'fav').sort((a, b) => a.lastSeen - b.lastSeen);
      for (const r of removable.slice(0, recs.length - MAX_PER_SEARCH)) delete map[r.key];
    }
  });
}

/**
 * Distance check applied to saved offers (most are never listed again, so a run would not fix them).
 * verdicts: Map key -> { reject, ref }. Only marks offers as (not) matching — never alerts.
 */
function applyGeo(searchId, verdicts) {
  const out = { rejected: 0, restored: 0 };
  store.update(FILE, {}, (all) => {
    const map = all[searchId];
    if (!map) return;
    for (const [key, v] of verdicts) {
      const r = map[key];
      if (!r) continue;
      // offers without coordinates go on the map at the town they name
      if (v.ref && !r.exactCoords) Object.assign(r, { lat: v.ref.lat, lon: v.ref.lon });
      if (v.reject) {
        if (!r.reject || r.reject === r.geoReject) {
          if (r.match) out.rejected++;
          r.reject = v.reject;
          r.match = false;
        }
        r.geoReject = v.reject;
      } else if (r.geoReject) {
        if (r.reject === r.geoReject) {
          r.reject = null;
          r.match = true;
          out.restored++;
        }
        r.geoReject = null;
      }
    }
  });
  return out;
}

function setStatus(searchId, key, status) {
  let ok = false;
  store.update(FILE, {}, (all) => {
    const r = all[searchId]?.[key];
    if (r) {
      r.userStatus = status === 'fav' || status === 'hidden' ? status : null;
      ok = true;
    }
  });
  return ok;
}

function removeSearch(searchId) {
  store.update(FILE, {}, (all) => {
    delete all[searchId];
  });
}

/** All offers for the gallery/map (without the bulky offer-page data). */
function list() {
  const out = [];
  for (const [searchId, map] of Object.entries(load())) {
    for (const r of Object.values(map)) {
      const { detail, ...rest } = r;
      out.push({ ...rest, searchId, hasDetail: !!detail });
    }
  }
  return out;
}

function countsBySearch() {
  const out = {};
  for (const [searchId, map] of Object.entries(load())) {
    const recs = Object.values(map);
    out[searchId] = {
      matching: recs.filter((r) => r.match && !r.dupOf && r.userStatus !== 'hidden').length,
      fav: recs.filter((r) => r.userStatus === 'fav').length,
      newestFirstSeen: recs.reduce((m, r) => Math.max(m, r.firstSeen), 0),
    };
  }
  return out;
}

module.exports = { record, getDetail, applyGeo, setStatus, removeSearch, list, countsBySearch, keyOf };
