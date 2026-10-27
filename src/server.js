'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const store = require('./store');
const settings = require('./settings');
const checker = require('./checker');
const telegram = require('./telegram');
const scheduler = require('./scheduler');
const portals = require('./portals');
const offersStore = require('./offers');
const nearby = require('./nearby');
const geo = require('./geo');
const criteria = require('./criteria');
const { resolveSearch, forget, cachedSuggest } = require('./locations');
const { uid, slug } = require('./util');
const teryt = require('./teryt');
const migrate = require('./migrate');

const resolving = new Set();

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function basicAuth(req, res, next) {
  const { user, password } = settings.get().panel;
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString().split(':');
    if (safeEqual(u, user) && safeEqual(rest.join(':'), password)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="estate-tracker", charset="UTF-8"').status(401).send('Wymagane logowanie');
}

/**
 * Desktop app: no password (it's the user's own computer), but the panel listens on 127.0.0.1 and
 * any local web page could try to call it. So every request must carry the random token that the
 * app puts in a SameSite=Strict cookie, and the Host header must be the loopback address
 * (blocks DNS-rebinding tricks).
 */
function tokenAuth(token) {
  return (req, res, next) => {
    const host = String(req.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return res.status(403).send('Niedozwolony adres');
    const cookie = String(req.headers.cookie || '')
      .split(';')
      .map((x) => x.trim().split('='))
      .find(([k]) => k === 'et_token');
    if (cookie && safeEqual(decodeURIComponent(cookie[1] || ''), token)) return next();
    res.status(403).send('Panel jest dostępny tylko w oknie aplikacji Estate Tracker.');
  };
}

// Basic auth credentials are sent automatically by the browser, so writes must come from our own pages.
function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const src = req.headers.origin || req.headers.referer;
  if (!src) return next();
  try {
    if (new URL(src).host === req.headers.host) return next();
  } catch {}
  res.status(403).json({ error: 'Odrzucono żądanie z innej domeny' });
}

const SEARCH_FIELDS = Object.keys(criteria.DEFAULT_SEARCH);

/** Accepts only known fields from the browser and normalizes them. */
function searchFromBody(body, prev = {}) {
  const picked = {};
  for (const k of SEARCH_FIELDS) if (body[k] !== undefined) picked[k] = body[k];
  const s = criteria.normalize({ ...prev, ...picked });
  s.name = String(s.name || '').trim().slice(0, 120) || 'Bez nazwy';
  s.locationPins = s.locationPins.slice(0, 50).map((p) => ({
    query: String(p.query).slice(0, 120),
    name: String(p.name || p.query).slice(0, 120),
    label: String(p.label || '').slice(0, 200),
    context: String(p.context || '').slice(0, 200),
    lat: Number(p.lat),
    lon: Number(p.lon),
    ...(p.teryt ? { teryt: teryt.clean(p.teryt) } : {}),
  }));
  return s;
}

// TERYT for towns without it, portal URLs, then the distance re-check of saved offers.
function startResolve(search, force = false) {
  if (resolving.has(search.id)) return;
  resolving.add(search.id);
  migrate
    .refreshSearch(search.id, { force })
    .catch((e) => console.error(`[resolve] ${search.name}:`, e.message))
    .finally(() => resolving.delete(search.id));
}

const allSearches = () => store.load('searches', []).map(criteria.normalize);
const findSearch = (id) => allSearches().find((s) => s.id === id);

/** Per-portal dot for a search card: ok / warn / error / off. */
function portalDots(s, status, resolved) {
  const out = {};
  for (const p of portals.list) {
    if (!s.portals[p.id]) {
      out[p.id] = { state: 'off' };
      continue;
    }
    const ps = status.portals?.[p.id]?.perSearch?.[s.id];
    const r = resolved?.portals?.[p.id];
    const unresolved = (r?.locations || []).filter((l) => !l.ok).map((l) => l.query);
    let state = 'unknown';
    let note = 'jeszcze nie sprawdzano';
    if (ps) {
      if (ps.error && !ps.count) {
        state = 'error';
        note = ps.error;
      } else if (ps.error || unresolved.length) {
        state = 'warn';
        note = ps.error || `nie rozpoznano: ${unresolved.join(', ')}`;
      } else if (!ps.count) {
        state = 'warn';
        note = '0 ofert';
      } else {
        state = 'ok';
        note = `${ps.count} ofert, pasuje ${ps.matching}`;
      }
    } else if (r?.error) {
      state = 'error';
      note = r.error;
    }
    out[p.id] = { state, note, count: ps?.count ?? null, matching: ps?.matching ?? null, at: ps?.at ?? null };
  }
  return out;
}

function previewPayload(s, r) {
  return {
    coverage: criteria.coverage(s),
    anchors: r.resolved.anchors || [],
    portals: portals.list
      .filter((p) => s.portals[p.id])
      .map((p) => {
        const res = r.portals[p.id] || { targets: [] };
        return {
          id: p.id,
          name: p.name,
          error: res.error || null,
          locations: r.resolved.portals[p.id]?.locations || [],
          targets: res.targets.map((t) => ({
            label: t.label,
            url: t.url,
            error: t.error,
            method: t.method,
            total: t.total,
            count: t.offers.length,
            matching: t.offers.filter((o) => !o.reject).length,
            offers: t.offers.map((o) => ({
              title: o.title,
              url: o.url,
              image: o.image,
              price: o.price,
              area: o.area,
              plotArea: o.plotArea,
              pricePerM2: o.pricePerM2,
              location: o.location,
              createdAt: o.createdAt,
              reject: o.reject,
              unverified: o.unverified,
              features: o.featureSummary,
              lat: o.lat,
              lon: o.lon,
              approx: !!o.approxCoords,
            })),
          })),
        };
      }),
  };
}

// ---------- static files with cache-busting ----------
// index.html links app.js/app.css as "?v=<content hash>" and the map libraries as "?v=<library version>".
// A changed file gets a new URL, so the browser can never pair a cached app.js with a newer page
// (or the other way round). Versioned URLs are cached for a year; the page itself and anything
// requested without ?v= is revalidated on every load.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const vendor = (pkg) => {
  const root = path.join(__dirname, '..', 'node_modules', pkg);
  return { dir: path.join(root, 'dist'), v: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version };
};
const VENDOR = { leaflet: vendor('leaflet'), geoman: vendor('@geoman-io/leaflet-geoman-free') };
const hashCache = new Map();
function fileHash(file) {
  const { mtimeMs, size } = fs.statSync(file);
  const hit = hashCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.v;
  const v = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  hashCache.set(file, { mtimeMs, size, v });
  return v;
}
function renderIndex() {
  return fs
    .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replace(/(href|src)="\/(app\.(?:js|css))"/g, (m, attr, file) => `${attr}="/${file}?v=${fileHash(path.join(PUBLIC_DIR, file))}"`)
    .replace(/(href|src)="\/vendor\/(leaflet|geoman)\/([^"?]+)"/g, (m, attr, lib, file) => `${attr}="/vendor/${lib}/${file}?v=${VENDOR[lib].v}"`);
}
function sendIndex(req, res) {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(renderIndex());
}
const staticFiles = (dir) =>
  express.static(dir, {
    index: false,
    cacheControl: false,
    setHeaders: (res) => res.set('Cache-Control', res.req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache'),
  });

function createApp({ desktop = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(desktop ? tokenAuth(desktop.token) : basicAuth);
  app.use(express.json({ limit: '300kb' }));
  app.use(sameOrigin);
  app.get(['/', '/index.html'], sendIndex);
  app.use('/vendor/leaflet', staticFiles(VENDOR.leaflet.dir));
  app.use('/vendor/geoman', staticFiles(VENDOR.geoman.dir));
  app.use(staticFiles(PUBLIC_DIR));

  const api = express.Router();
  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((e) => {
      console.error('[api]', req.method, req.path, e);
      res.status(500).json({ error: e.message });
    });

  api.get('/meta', (req, res) => {
    res.json({
      desktop: !!desktop,
      version: require('../package.json').version,
      portals: portals.list.map((p) => ({ id: p.id, name: p.name })),
      plotTypes: criteria.PLOT_TYPES.map(({ code, label }) => ({ code, label })),
      media: criteria.MEDIA.map(({ code, label }) => ({ code, label })),
      houseTypes: criteria.HOUSE_TYPES.map(({ code, label }) => ({ code, label })),
      houseStates: criteria.HOUSE_STATES,
      defaults: criteria.DEFAULT_SEARCH,
    });
  });

  api.get('/state', (req, res) => {
    const status = store.load('status', { portals: {} });
    const resolved = store.load('resolved', {});
    const counts = offersStore.countsBySearch();
    const searches = allSearches().map((s) => {
      const r = resolved[s.id];
      const dots = portalDots(s, status, r);
      const lastCheck = Math.max(0, ...Object.values(dots).map((d) => d.at || 0)) || null;
      return {
        ...s,
        offers: counts[s.id] || { matching: 0, fav: 0 },
        lastCheck,
        dots,
        coverage: criteria.coverage(s),
        resolving: resolving.has(s.id),
        resolved: r
          ? {
              at: r.at,
              anchors: (r.anchors || []).map(({ tokens, ...a }) => a),
              unresolved: r.unresolved || [],
              portals: Object.fromEntries(Object.entries(r.portals).map(([pid, x]) => [pid, { error: x.error, locations: x.locations, targets: (x.targets || []).map((t) => ({ label: t.label, url: t.url })) }])),
            }
          : null,
      };
    });
    res.json({
      searches,
      status: { portals: Object.fromEntries(Object.entries(status.portals || {}).map(([k, v]) => [k, { ...v, perSearch: undefined }])) },
      running: checker.isRunning() ? status.running : null,
      lastRun: status.lastRun || null,
      nextRun: status.nextRun || null,
      telegramOk: telegram.configured(),
    });
  });

  api.post('/searches', (req, res) => {
    const s = searchFromBody(req.body || {}, { id: uid(), createdAt: Date.now() });
    if (!s.locations.length && !s.areas.length) return res.status(400).json({ error: 'Podaj miejscowość albo narysuj obszar.' });
    store.update('searches', [], (list) => {
      list.push(s);
    });
    startResolve(s, true);
    res.json(s);
  });

  api.put('/searches/:id', (req, res) => {
    const prev = findSearch(req.params.id);
    if (!prev) return res.status(404).json({ error: 'Nie ma takiego wyszukiwania' });
    const s = searchFromBody(req.body || {}, { ...prev, updatedAt: Date.now() });
    s.id = prev.id;
    if (!s.locations.length && !s.areas.length) return res.status(400).json({ error: 'Podaj miejscowość albo narysuj obszar.' });
    store.update('searches', [], (list) => list.map((x) => (x.id === s.id ? s : x)));
    startResolve(s);
    res.json(s);
  });

  api.post('/searches/:id/toggle', (req, res) => {
    let out = null;
    store.update('searches', [], (list) =>
      list.map((x) => {
        if (x.id !== req.params.id) return x;
        out = { ...x, enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : !x.enabled };
        return out;
      })
    );
    if (!out) return res.status(404).json({ error: 'Nie ma takiego wyszukiwania' });
    res.json({ enabled: out.enabled });
  });

  api.delete('/searches/:id', (req, res) => {
    store.update('searches', [], (list) => list.filter((x) => x.id !== req.params.id));
    store.update('seen', {}, (all) => {
      delete all[req.params.id];
    });
    offersStore.removeSearch(req.params.id);
    forget(req.params.id);
    res.json({ ok: true });
  });

  api.post('/searches/:id/resolve', (req, res) => {
    const s = findSearch(req.params.id);
    if (!s) return res.status(404).json({ error: 'Nie ma takiego wyszukiwania' });
    startResolve(s, true);
    res.json({ ok: true });
  });

  api.post(
    '/searches/:id/preview',
    wrap(async (req, res) => {
      const s = findSearch(req.params.id);
      if (!s) return res.status(404).json({ error: 'Nie ma takiego wyszukiwania' });
      res.json(previewPayload(s, await checker.collect(s, { preview: true })));
    })
  );

  // Live preview of unsaved criteria from the form.
  api.post(
    '/preview',
    wrap(async (req, res) => {
      const s = searchFromBody(req.body || {}, { id: `draft-${uid()}` });
      if (!s.locations.length && !s.areas.length) return res.status(400).json({ error: 'Dodaj miejscowość albo narysuj obszar.' });
      try {
        res.json(previewPayload(s, await checker.collect(s, { preview: true })));
      } finally {
        forget(s.id);
      }
    })
  );

  api.post('/coverage', (req, res) => {
    res.json(criteria.coverage(searchFromBody(req.body || {})));
  });

  api.get(
    '/locations/suggest',
    wrap(async (req, res) => {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return res.json([]);
      let list = [];
      for (const src of [portals.byId.gratka, portals.byId.morizon]) {
        try {
          list = await cachedSuggest(src, q);
          break;
        } catch {}
      }
      res.json(
        list
          .filter((x) => ['town', 'commune', 'district'].includes(x.level))
          .slice(0, 10)
          .map((x) => ({ name: x.name, label: x.label, context: x.context, level: x.level, lat: x.lat, lon: x.lon, display: teryt.longLabel(x) }))
      );
    })
  );

  // A town picked from the list: its commune, county and TERYT codes (OpenStreetMap).
  api.post(
    '/locations/describe',
    wrap(async (req, res) => {
      const b = req.body || {};
      const item = { name: String(b.name || '').trim().slice(0, 120), level: ['town', 'commune', 'district'].includes(b.level) ? b.level : 'town', context: String(b.context || '').slice(0, 200), lat: Number(b.lat), lon: Number(b.lon) };
      if (!item.name || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return res.status(400).json({ error: 'Brak nazwy lub współrzędnych' });
      const t = await teryt.describe(item);
      res.json({ ...teryt.clean(t), lat: t.lat, lon: t.lon, error: t.error || null });
    })
  );

  api.get(
    '/locations/nearby',
    wrap(async (req, res) => {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      const radius = Math.min(30, Math.max(1, Number(req.query.radius) || 5));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'Brak współrzędnych' });
      res.json(await nearby.places(lat, lon, radius));
    })
  );

  // Towns inside / touching the areas drawn in the form.
  api.post(
    '/locations/in-area',
    wrap(async (req, res) => {
      const areas = geo.cleanAreas(req.body?.areas);
      if (!areas.length) return res.json([]);
      res.json(await nearby.inArea(areas));
    })
  );

  api.get('/offers', (req, res) => {
    const names = Object.fromEntries(allSearches().map((s) => [s.id, s.name]));
    res.json(offersStore.list().filter((o) => names[o.searchId]).map((o) => ({ ...o, searchName: names[o.searchId] })));
  });

  api.post('/offers/status', (req, res) => {
    const { searchId, key, status } = req.body || {};
    if (!offersStore.setStatus(String(searchId), String(key), status)) return res.status(404).json({ error: 'Nie ma takiej oferty' });
    res.json({ ok: true });
  });

  api.get('/alerts', (req, res) => res.json(store.load('alerts', [])));

  api.get('/settings', (req, res) => {
    const s = settings.get();
    res.json({ ...s, telegram: { ...s.telegram, botToken: s.telegram.botToken ? '__set__' : '' }, panel: { user: s.panel.user } });
  });

  api.put('/settings', (req, res) => {
    const b = req.body || {};
    const cur = settings.get();
    const n = (v, d) => {
      const x = Number(v);
      return Number.isFinite(x) && x >= 0 ? x : d;
    };
    const patch = {
      telegram: {
        enabled: typeof b.telegram?.enabled === 'boolean' ? b.telegram.enabled : cur.telegram.enabled,
        chatId: String(b.telegram?.chatId ?? cur.telegram.chatId).trim(),
        threadId: String(b.telegram?.threadId ?? cur.telegram.threadId).trim(),
        warnThreadId: String(b.telegram?.warnThreadId ?? cur.telegram.warnThreadId).trim(),
      },
      intervalMinutes: Math.max(1, n(b.intervalMinutes, cur.intervalMinutes)),
      jitterPercent: Math.min(90, n(b.jitterPercent, cur.jitterPercent)),
      requestDelaySec: [Math.max(1, n(b.requestDelaySec?.[0], cur.requestDelaySec[0])), Math.max(1, n(b.requestDelaySec?.[1], cur.requestDelaySec[1]))].sort((a, z) => a - z),
      zeroOffersWarnAfter: Math.max(1, n(b.zeroOffersWarnAfter, cur.zeroOffersWarnAfter)),
      errorWarnAfter: Math.max(1, n(b.errorWarnAfter, cur.errorWarnAfter)),
      maxAlertsPerRun: Math.max(1, n(b.maxAlertsPerRun, cur.maxAlertsPerRun)),
      panel: { user: String(b.panel?.user || '').trim() || cur.panel.user },
    };
    const token = String(b.telegram?.botToken || '').trim();
    if (token && token !== '__set__') patch.telegram.botToken = token;
    if (String(b.panel?.password || '').trim()) patch.panel.password = String(b.panel.password).trim();
    settings.set(patch);
    scheduler.schedule();
    res.json({ ok: true });
  });

  api.post(
    '/settings/test',
    wrap(async (req, res) => {
      await telegram.sendText('✅ <b>estate-tracker</b>: wiadomość testowa (wątek alertów).');
      const t = settings.get().telegram;
      if (t.warnThreadId && t.warnThreadId !== t.threadId) await telegram.sendText('🛠 <b>estate-tracker</b>: test wątku ostrzeżeń.', { kind: 'warn' });
      res.json({ ok: true });
    })
  );

  api.post('/run', (req, res) => {
    const was = checker.isRunning();
    checker
      .runAll('ręcznie z panelu')
      .then(() => scheduler.schedule())
      .catch((e) => console.error('[run]', e));
    res.json({ queued: was });
  });

  // Export / import of searches (to share ready criteria). Only the criteria travel — no offers, ids or state.
  api.get('/searches/export', (req, res) => {
    const ids = String(req.query.ids || '').split(',').filter(Boolean);
    const list = allSearches().filter((s) => !ids.length || ids.includes(s.id));
    const searches = list.map((s) => {
      const out = {};
      for (const k of SEARCH_FIELDS) out[k] = s[k];
      return out;
    });
    const name = list.length === 1 ? list[0].name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-') || 'wyszukiwanie' : 'wyszukiwania';
    // ASCII fallback for old clients + the real (Polish) name in filename*
    res.set('Content-Disposition', `attachment; filename="estate-tracker-${slug(name) || 'wyszukiwania'}.json"; filename*=UTF-8''estate-tracker-${encodeURIComponent(name)}.json`);
    res.json({ format: 'estate-tracker-searches', version: 1, exportedAt: new Date().toISOString(), searches });
  });

  api.post('/searches/import', (req, res) => {
    const b = req.body || {};
    const incoming = Array.isArray(b) ? b : b.searches;
    if (!Array.isArray(incoming) || !incoming.length) return res.status(400).json({ error: 'To nie jest plik z wyszukiwaniami Estate Tracker.' });
    const existing = new Set(allSearches().map((s) => s.name));
    const added = [];
    for (const raw of incoming.slice(0, 100)) {
      if (!raw || typeof raw !== 'object') continue;
      const s = searchFromBody(raw, { id: uid(), createdAt: Date.now() });
      if (!s.locations.length && !s.areas.length) continue;
      let name = s.name;
      for (let n = 2; existing.has(name); n++) name = `${s.name} (${n})`;
      s.name = name;
      existing.add(name);
      added.push(s);
    }
    if (!added.length) return res.status(400).json({ error: 'Plik nie zawiera poprawnych wyszukiwań.' });
    store.update('searches', [], (list) => {
      list.push(...added);
    });
    for (const s of added) startResolve(s, true);
    res.json({ added: added.map((s) => s.name) });
  });

  // Desktop app only: background mode, autostart, version (handled by electron/main.js).
  if (desktop?.bridge) {
    api.get('/desktop', (req, res) => res.json(desktop.bridge.getState()));
    api.post('/desktop/test-notification', (req, res) => {
      desktop.bridge.testNotification();
      setTimeout(() => res.json(desktop.bridge.getState()), 1500);
    });
    api.put('/desktop', (req, res) => {
      Promise.resolve(desktop.bridge.setState(req.body || {}))
        .then(() => res.json(desktop.bridge.getState()))
        .catch((e) => res.status(500).json({ error: e.message }));
    });
  }

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Nie ma takiego zasobu' }));
  // Single-page app: every other path serves the shell.
  app.get('*', sendIndex);
  return app;
}

module.exports = { createApp };
