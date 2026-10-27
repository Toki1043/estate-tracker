'use strict';

const crypto = require('crypto');
const store = require('./store');
const settings = require('./settings');
const portals = require('./portals');
const telegram = require('./telegram');
const { resolveSearch } = require('./locations');
const { enrich, rejectReason } = require('./filter');
const { fingerprint, isDuplicate } = require('./dedupe');
const features = require('./features');
const { normalize } = require('./criteria');
const offersStore = require('./offers');
const events = require('./events');
const { sleep, randInt, escapeHtml, norm } = require('./util');
const geo = require('./geo');
const geoguard = require('./geoguard');

const MAX_SEEN_PER_SEARCH = 4000;
const MAX_ALERT_LOG = 300;
const MAX_DETAILS_PER_SEARCH = 20; // offer pages fetched per search and run (new offers only)

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

function targetKey(portalId, url) {
  return `${portalId}|${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}`;
}

let lastRequestAt = 0;
async function politeDelay(preview) {
  const [a, b] = preview ? [1.5, 3] : settings.get().requestDelaySec;
  const wait = lastRequestAt + randInt(a * 1000, b * 1000) - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/** Fetches every portal/target of one search. Nothing is saved here. */
async function collect(search, { preview = false, forceResolve = false } = {}) {
  const resolved = await resolveSearch(search, { force: forceResolve });
  // Town reference points, needed by the drawn-area check (kept off the saved object).
  Object.defineProperty(search, '_anchors', { value: resolved.anchors || [], configurable: true, writable: true, enumerable: false });
  Object.defineProperty(search, '_guard', { value: geoguard.build(search, resolved.anchors), configurable: true, writable: true, enumerable: false });
  const out = { resolved, portals: {} };
  for (const portal of portals.list) {
    if (!search.portals?.[portal.id]) continue;
    const pr = resolved.portals[portal.id] || { targets: [], error: 'brak danych o lokalizacjach' };
    const res = { error: pr.error, targets: [] };
    for (const t of pr.targets || []) {
      await politeDelay(preview);
      // Drawn-area URLs change on every encoding (Gratka/Morizon), so they carry a stable key.
      const tr = { label: t.label, url: t.url, key: t.stableKey || targetKey(portal.id, t.url), offers: [], error: null, method: null, total: null };
      try {
        const r = await portal.fetchOffers(t);
        tr.method = r.method;
        tr.note = r.note || null;
        tr.total = r.total ?? t.reportedTotal ?? null;
        tr.offers = r.offers.map((o) => {
          const x = { ...o, portal: portal.id, portalName: portal.name, viaArea: t.area !== undefined, scope: t.scope || null };
          // Offer page read in an earlier run: reuse it instead of fetching again.
          const d = preview ? null : offersStore.getDetail(search.id, `${portal.id}:${o.id}`);
          if (d) {
            x.attrs = { ...defined(x.attrs), ...defined(d.attrs) };
            x.kv = [...(x.kv || []), ...(d.kv || [])];
            if (d.description) x.description = d.description;
            if (d.lat != null) Object.assign(x, { lat: d.lat, lon: d.lon, exactCoords: d.exactCoords });
            x.detailAt = d.at;
          }
          return x;
        });
        // Offers without coordinates: the town they name, for the distance check and the map.
        await geoguard.locate(tr.offers, search._guard);
        for (const x of tr.offers) {
          evaluate(x, search);
          approxCoords(x, resolved.anchors);
        }
      } catch (e) {
        tr.error = e.message;
        tr.status = e.status || null;
      }
      res.targets.push(tr);
    }
    out.portals[portal.id] = res;
  }
  return out;
}

/** Numeric/keyword criteria + features (media, MPZP, type...). Sets reject, unverified, features. */
function evaluate(o, search) {
  enrich(o);
  o.features = features.compute(o, search.propertyType);
  const chk = features.check(o.features, search, o.portal);
  const area = chk.reject ? {} : areaCheck(o, search, search._anchors || []);
  // Radius + 5 km from the chosen towns / areas, whatever the portal returned.
  const where = geoguard.verdict(o, search._guard);
  o.geoReject = where.reject || null;
  o.reject = where.reject || rejectReason(o, search) || chk.reject || area.reject || null;
  o.unverified = o.reject ? [] : [...chk.unverified, ...(area.note ? [area.note] : []), ...(where.note ? [where.note] : [])];
  o.featureSummary = features.summary(o.features);
  return o;
}

/**
 * Drawn areas: an offer with an exact position must lie inside an area. Without one it passes when
 * the portal searched inside the area itself or its town is one of the area towns (marked approximate).
 * Towns typed in by hand are not limited by the areas.
 */
function areaCheck(o, s, anchors) {
  if (!s.areas?.length) return {};
  if (o.scope === 'manual') return {}; // found for a town typed in by hand
  const text = ` ${norm(o.location)} ${norm(o.title)} `;
  const manual = anchors.filter((a) => !a.fromArea && a.lat != null);
  const nearManual = (lat, lon) => manual.some((a) => geo.distKm([a.lat, a.lon], [lat, lon]) <= (s.radiusKm || 0) + 2);
  const manualByName = manual.some((a) => text.includes(` ${norm(a.name)} `));
  if (o.lat != null && o.exactCoords) {
    if (geo.inAnyArea([o.lat, o.lon], s.areas)) return {};
    if (nearManual(o.lat, o.lon)) return {};
    return { reject: 'poza narysowanym obszarem' };
  }
  if (o.viaArea) return { note: 'dokładne położenie (portal szukał w obszarze)' };
  if (manualByName) return {};
  // Approximate position from the portal (e.g. OLX circle): has to be in or right next to an area.
  if (o.lat != null && !o.approxCoords) {
    return geo.inAnyArea([o.lat, o.lon], s.areas, 2) ? { note: 'dokładne położenie (portal podał przybliżone)' } : { reject: 'poza narysowanym obszarem' };
  }
  const towns = (s.areaTowns || []).filter((t) => t.enabled && text.includes(` ${norm(t.name)} `));
  const inside = towns.find((t) => t.status === 'inside');
  if (inside) return { note: `dokładne położenie (miejscowość ${inside.name} w obszarze)` };
  // A town that only touches the area: passes for now, the pin from the offer page decides (new offers).
  if (towns.length) return { note: `położenie — ${towns[0].name} tylko przy granicy obszaru` };
  return { reject: 'poza narysowanym obszarem' };
}

/** Without coordinates from the portal, place the offer at its town (marked as approximate). */
function approxCoords(o, anchors) {
  if (o.lat != null) return;
  if (o.geoRef) {
    Object.assign(o, { lat: o.geoRef.lat, lon: o.geoRef.lon, exactCoords: false, approxCoords: true });
    return;
  }
  if (!anchors?.length) return;
  const loc = ` ${norm(o.location)} ${norm(o.title)} `;
  const a = anchors.find((x) => x.lat != null && loc.includes(` ${norm(x.name)} `)) || anchors.find((x) => x.lat != null);
  if (!a) return;
  o.lat = a.lat;
  o.lon = a.lon;
  o.exactCoords = false;
  o.approxCoords = true;
}

const defined = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null));

/** Offer page for a new offer: more data for the filters, coordinates and the alert. */
async function addDetails(o, search) {
  const portal = portals.byId[o.portal];
  if (!portal.fetchDetail) return false;
  await politeDelay(false);
  try {
    const d = await portal.fetchDetail(o);
    o.attrs = { ...defined(o.attrs), ...defined(d.attrs) };
    o.kv = [...(o.kv || []), ...(d.kv || [])];
    if (d.description && d.description.length > String(o.description || '').length) o.description = d.description;
    if (d.lat != null) {
      o.lat = d.lat;
      o.lon = d.lon;
      o.exactCoords = d.exactCoords !== false;
      o.approxCoords = false;
    }
    o.detailAt = Date.now();
  } catch (e) {
    o.detailError = e.message;
    log(`[${search.name}] szczegóły ${o.portalName} ${o.url}: ${e.message}`);
  }
  evaluate(o, search);
  return true;
}

function pruneSeen(state) {
  const keys = Object.keys(state.offers);
  if (keys.length <= MAX_SEEN_PER_SEARCH) return;
  keys.sort((a, b) => state.offers[a].t - state.offers[b].t);
  for (const k of keys.slice(0, keys.length - MAX_SEEN_PER_SEARCH)) delete state.offers[k];
}

function recordPortalStatus(portalId, searchId, res) {
  store.update('status', { portals: {} }, (st) => {
    st.portals = st.portals || {};
    const p = (st.portals[portalId] = st.portals[portalId] || { perSearch: {} });
    p.perSearch = p.perSearch || {};
    const ok = res.targets.filter((t) => !t.error);
    const failed = res.targets.filter((t) => t.error);
    const count = ok.reduce((s, t) => s + t.offers.length, 0);
    const now = Date.now();
    p.perSearch[searchId] = {
      at: now,
      count,
      matching: ok.reduce((s, t) => s + t.offers.filter((o) => !o.reject).length, 0),
      methods: [...new Set(ok.map((t) => t.method))],
      error: failed.length ? failed.map((t) => `${t.label}: ${t.error}`).join(' | ') : res.error || null,
    };
    if (ok.length) {
      p.lastSuccess = now;
      p.lastCount = count;
      p.lastMethod = [...new Set(ok.map((t) => t.method))].join(', ');
    }
    if (failed.length) {
      p.lastError = now;
      p.lastErrorMsg = failed[0].error;
    }
  });
}

/** One check of one search: compare with what we've seen and alert about new matches. */
async function checkSearch(search, runStats) {
  const data = await collect(search);
  const seenAll = store.load('seen', {});
  const state = seenAll[search.id] || { baselines: {}, offers: {} };
  const now = Date.now();
  const candidates = [];

  for (const [pid, res] of Object.entries(data.portals)) {
    recordPortalStatus(pid, search.id, res);
    const rs = (runStats[pid] = runStats[pid] || { ok: 0, failed: 0, offers: 0, reportedTotal: 0, errors: [] });
    for (const t of res.targets) {
      if (t.error) {
        rs.failed++;
        rs.errors.push(t.error);
        continue;
      }
      rs.ok++;
      rs.offers += t.offers.length;
      const far = t.offers.filter((o) => o.geoReject).length;
      if (far >= 5 && far / t.offers.length >= 0.5) {
        log(`[${search.name}] ${pid} „${t.label}”: ${far}/${t.offers.length} ofert spoza obszaru — portal prawdopodobnie zignorował lokalizację; odrzucone, bez alertów.`);
      }
      rs.reportedTotal += t.total || 0;
      let baseline = !state.baselines[t.key];
      // Guard: when most of a known list suddenly looks "new", the portal probably changed its ids
      // or the parser switched to a fallback. Re-baseline instead of flooding Telegram.
      const unseen = t.offers.filter((o) => !state.offers[`${pid}:${o.id}`]).length;
      if (!baseline && t.offers.length >= 8 && unseen / t.offers.length > 0.6) {
        log(`[${search.name}] ${pid} „${t.label}”: ${unseen}/${t.offers.length} ofert wygląda na nowe — zmiana identyfikatorów? Zapisuję bez alertów.`);
        baseline = true;
      }
      for (const o of t.offers) {
        const k = `${pid}:${o.id}`;
        if (state.offers[k]) continue;
        state.offers[k] = { t: now, fp: fingerprint(o) };
        if (!baseline && !o.reject) candidates.push(o);
      }
      if (baseline) {
        state.baselines[t.key] = now;
        log(`[${search.name}] ${pid} „${t.label}”: pierwszy przebieg — zapisano ${t.offers.length} ofert bez alertów`);
      }
    }
  }

  // New matching offers: read their offer pages (with delays) and check the detailed criteria again.
  let budget = MAX_DETAILS_PER_SEARCH;
  for (const o of candidates) {
    if (budget <= 0) break;
    if (await addDetails(o, search)) budget--;
    if (o.reject) log(`[${search.name}] po szczegółach odrzucono ${o.portalName} ${o.url}: ${o.reject}`);
  }
  const accepted = candidates.filter((o) => !o.reject);
  candidates.length = 0;
  candidates.push(...accepted);

  // Cross-portal duplicates: against offers seen earlier and within this batch.
  // "Known" = anything already stored except this run's candidates (includes fresh baselines of other portals).
  const candidateKeys = new Set(candidates.map((o) => `${o.portal}:${o.id}`));
  const known = Object.entries(state.offers).filter(([k]) => !candidateKeys.has(k));
  const toAlert = [];
  for (const o of candidates) {
    const fp = fingerprint(o);
    const dup = known.find(([k, v]) => !k.startsWith(`${o.portal}:`) && isDuplicate(fp, v.fp));
    if (dup) {
      log(`[${search.name}] pominięto duplikat ${o.portalName} ${o.url} (jak ${dup[0]})`);
      continue;
    }
    const twin = toAlert.find((x) => x.portal !== o.portal && isDuplicate(fingerprint(x), fp));
    if (twin) {
      twin.alsoOn = [...(twin.alsoOn || []), o.portalName];
      continue;
    }
    toAlert.push(o);
  }

  pruneSeen(state);
  store.update('seen', {}, (all) => {
    all[search.id] = state;
  });

  // One offer can be listed by several targets (e.g. two towns with a radius): keep the copy with offer-page data.
  const listed = new Map();
  for (const res of Object.values(data.portals)) {
    for (const t of res.targets) {
      if (t.error) continue;
      for (const o of t.offers) {
        const k = `${o.portal}:${o.id}`;
        if (!listed.has(k) || (o.detailAt && !listed.get(k).detailAt)) listed.set(k, o);
      }
    }
  }
  offersStore.record(search.id, [...listed.values()], { alerted: toAlert });

  if (toAlert.length) await sendAlerts(search, toAlert);
  return { newOffers: toAlert.length };
}

async function sendAlerts(search, offers) {
  const s = settings.get();
  const limit = Math.max(1, Number(s.maxAlertsPerRun) || 15);
  const entries = [];
  // Desktop app: system notifications (listener in electron/main.js). The server has none.
  const notifyLocal = events.listenerCount('offers') > 0;
  for (const [i, o] of offers.entries()) {
    const entry = {
      at: Date.now(),
      key: `${o.portal}:${o.id}`,
      searchId: search.id,
      searchName: search.name,
      portal: o.portalName,
      alsoOn: o.alsoOn || [],
      title: o.title,
      price: o.price,
      area: o.area,
      plotArea: o.plotArea,
      pricePerM2: o.pricePerM2,
      location: o.location,
      url: o.url,
      image: o.image,
      features: o.featureSummary || [],
      unverified: o.unverified || [],
      sent: false,
      error: null,
    };
    if (i >= limit) {
      entry.error = 'pominięto wysyłkę (limit alertów na przebieg)';
    } else {
      if (telegram.configured()) {
        try {
          await telegram.sendOffer(o, search);
          entry.sent = true;
        } catch (e) {
          entry.error = e.message;
        }
      }
      if (notifyLocal) entry.notified = true;
      if (!entry.sent && !entry.notified && !entry.error) entry.error = 'Telegram nie jest skonfigurowany';
    }
    log(`[${search.name}] NOWA: ${o.portalName} ${o.title} ${o.price} zł ${o.url} ${entry.sent ? '(Telegram)' : ''}${entry.notified ? '(powiadomienie)' : ''}${entry.error ? `(${entry.error})` : ''}`);
    entries.push(entry);
  }
  if (offers.length > limit && telegram.configured()) {
    try {
      await telegram.sendText(`ℹ️ <b>${escapeHtml(search.name)}</b>: jeszcze ${offers.length - limit} nowych ofert — lista w panelu (log alertów).`);
    } catch {}
  }
  store.update('alerts', [], (list) => {
    list.unshift(...[...entries].reverse());
    list.length = Math.min(list.length, MAX_ALERT_LOG);
  });
  if (notifyLocal) events.emit('offers', { search: { id: search.id, name: search.name }, offers: entries.filter((e) => e.notified), more: Math.max(0, offers.length - limit) });
}

/** After a full run: warn on Telegram when a portal keeps returning 0 offers or errors. */
async function evaluateHealth(runStats) {
  const s = settings.get();
  const warnings = [];
  store.update('status', { portals: {} }, (st) => {
    for (const [pid, rs] of Object.entries(runStats)) {
      const p = (st.portals[pid] = st.portals[pid] || { perSearch: {} });
      const name = portals.byId[pid]?.name || pid;
      if (rs.ok > 0 && rs.offers === 0) p.zeroStreak = (p.zeroStreak || 0) + 1;
      else if (rs.ok > 0) {
        if (p.zeroWarned) warnings.push(`✅ ${name}: parser znów zwraca oferty (${rs.offers}).`);
        p.zeroStreak = 0;
        p.zeroWarned = false;
      }
      if (rs.ok === 0 && rs.failed > 0) p.errorStreak = (p.errorStreak || 0) + 1;
      else if (rs.ok > 0) {
        if (p.errorWarned) warnings.push(`✅ ${name}: portal znów odpowiada.`);
        p.errorStreak = 0;
        p.errorWarned = false;
      }
      if (p.zeroStreak >= s.zeroOffersWarnAfter && !p.zeroWarned) {
        p.zeroWarned = true;
        const hint = rs.reportedTotal > 0 ? ` Portal deklaruje ${rs.reportedTotal} wyników, więc parser prawdopodobnie przestał działać.` : ' Możliwa zmiana struktury strony (albo po prostu brak ofert).';
        warnings.push(`⚠️ <b>${name}</b>: 0 ofert w ${p.zeroStreak} kolejnych przebiegach.${hint}`);
      }
      if (p.errorStreak >= s.errorWarnAfter && !p.errorWarned) {
        p.errorWarned = true;
        warnings.push(`⚠️ <b>${name}</b>: błędy w ${p.errorStreak} kolejnych przebiegach. Ostatni: ${escapeHtml(rs.errors[0] || '')}`);
      }
    }
  });
  for (const w of warnings) {
    log('[zdrowie]', w.replace(/<[^>]+>/g, ''));
    events.emit('warning', w.replace(/<[^>]+>/g, ''));
    if (telegram.configured()) {
      try {
        await telegram.sendText(w, { kind: 'warn' });
      } catch (e) {
        log('[telegram] nie wysłano ostrzeżenia:', e.message);
      }
    }
  }
}

let running = null;
let rerunRequested = false;

/** Checks all enabled searches one after another. */
async function runAll(reason = 'harmonogram') {
  if (running) {
    // A manual request during a run gets its own run afterwards; the timer just skips.
    if (reason !== 'harmonogram') rerunRequested = true;
    return running;
  }
  running = (async () => {
    await require('./migrate').ready();
    const searches = store.load('searches', []).map(normalize).filter((s) => s.enabled);
    const started = Date.now();
    log(`=== Przebieg (${reason}): ${searches.length} aktywnych wyszukiwań`);
    store.update('status', { portals: {} }, (st) => {
      st.running = { since: started, reason };
    });
    const runStats = {};
    let newTotal = 0;
    for (const s of searches) {
      try {
        const r = await checkSearch(s, runStats);
        newTotal += r.newOffers;
      } catch (e) {
        log(`[${s.name}] błąd: ${e.stack || e.message}`);
      }
    }
    await evaluateHealth(runStats);
    store.update('status', { portals: {} }, (st) => {
      st.running = null;
      st.lastRun = { start: started, end: Date.now(), reason, searches: searches.length, newOffers: newTotal };
    });
    log(`=== Koniec przebiegu: ${newTotal} nowych ofert, ${Math.round((Date.now() - started) / 1000)} s`);
  })();
  try {
    await running;
  } finally {
    running = null;
  }
  if (rerunRequested) {
    rerunRequested = false;
    return runAll('ponowione żądanie');
  }
}

function isRunning() {
  return !!running;
}

module.exports = { runAll, collect, checkSearch, isRunning, evaluate };
