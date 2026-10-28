/* estate-tracker panel — single page app, no build step. */
(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = new Intl.NumberFormat('pl-PL');
  const num = (n, d = 0) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('pl-PL', { maximumFractionDigits: d }));
  const money = (n) => (n ? `${nf.format(Math.round(n))} zł` : '—');
  const short = (n) => {
    if (n === null || n === undefined) return '∞';
    if (n >= 1e6) return `${num(n / 1e6, 2)} mln`;
    if (n >= 1e3) return `${num(n / 1e3, 0)} tys.`;
    return num(n);
  };
  const ago = (ts) => {
    if (!ts) return '—';
    const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 0) return `za ${dur(-s)}`;
    if (s < 45) return 'przed chwilą';
    return `${dur(s)} temu`;
  };
  const dur = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`et-${k}`);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`et-${k}`, JSON.stringify(v));
      } catch {}
    },
  };

  async function api(method, url, body) {
    // location.origin never contains "user:pass@", so this also works when the panel was opened that way.
    const res = await fetch(`${location.origin}/api${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast'), isError ? 6000 : 3200);
  }

  const ICON = {
    plot: '<svg viewBox="0 0 24 24" class="ic"><path d="M3 18 9 6l4 7 3-4 5 9H3zm3.2-2h11.3l-1.8-3.2-3 4-3.6-6.3L6.2 16z"/></svg>',
    house: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 3 2 11h3v9h6v-6h2v6h6v-9h3L12 3zm5 15h-2v-6H9v6H7v-8.2l5-4 5 4V18z"/></svg>',
    flat: '<svg viewBox="0 0 24 24" class="ic"><path d="M5 2h10v6h4v14H5V2zm2 2v16h3v-3h4v3h3V10h-4V4H7zm2 2h2v2H9V6zm0 4h2v2H9v-2zm0 4h2v2H9v-2zm4 0h2v2h-2v-2z"/></svg>',
    star: '<svg viewBox="0 0 24 24" class="ic"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z"/></svg>',
    hide: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7l1.4 1.4-1.4 1.4L4.6 3.7 6 2.3l2.2 2.2C9.4 4.2 10.7 5 12 5zm-7.4 2.8 2 2A5 5 0 0 0 12 17c.9 0 1.7-.2 2.4-.6l1.6 1.6c-1.2.6-2.6 1-4 1-5 0-9-4.5-10-7 .5-1.3 1.4-2.8 2.6-4.2z"/></svg>',
    ext: '<svg viewBox="0 0 24 24" class="ic"><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
  };
  const TYPE_LABEL = { plot: 'Działka', house: 'Dom', flat: 'Mieszkanie' };
  const TRANS_LABEL = { sale: 'sprzedaż', rent: 'wynajem' };
  const PORTAL_SHORT = { otodom: 'OT', olx: 'OLX', gratka: 'GR', morizon: 'MZ', nonline: 'NO' };
  const CAP_LABEL = { url: 'w URL portalu', data: 'z danych listy', detail: 'ze strony ogłoszenia', text: 'tylko z opisu', none: 'nie sprawdzane' };
  const CAP_SHORT = { url: 'URL', data: 'D', detail: 'S', text: 'O', none: '✕' };
  const notifBlockedText = () =>
    /Mac/.test(navigator.platform)
      ? 'System blokuje powiadomienia. Włącz je: menu  → Ustawienia systemowe → Powiadomienia → Estate Tracker → „Zezwalaj na powiadomienia”.'
      : 'System blokuje powiadomienia. Włącz je: Start → Ustawienia → System → Powiadomienia → Estate Tracker.';
  // Polish plural: plural(5, 'miejscowość', 'miejscowości', 'miejscowości')
  const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
  const pbadge = (id) => `<span class="pbadge ${id}" title="${esc(portalName(id))}">${PORTAL_SHORT[id] || id}</span>`;
  const portalName = (id) => META?.portals.find((p) => p.id === id)?.name || id;

  let META = null;
  let STATE = null;
  let cleanup = [];

  // ---------- header ----------
  function updateHeader() {
    const el = $('#runStatus');
    if (!STATE) return;
    if (STATE.running) el.innerHTML = `<span class="pulse"></span>sprawdzanie trwa…`;
    else el.textContent = `ostatnio: ${STATE.lastRun ? ago(STATE.lastRun.end) : '—'} · następne: ${STATE.nextRun ? ago(STATE.nextRun) : '—'}`;
  }
  async function refreshState() {
    try {
      STATE = await api('GET', '/state');
      updateHeader();
    } catch {}
    return STATE;
  }
  $('#runNow').addEventListener('click', async () => {
    try {
      const r = await api('POST', '/run');
      toast(r.queued ? 'Sprawdzanie już trwa — kolejne ruszy zaraz po nim.' : 'Uruchomiono sprawdzanie wszystkich aktywnych wyszukiwań.');
      setTimeout(refreshState, 800);
    } catch (e) {
      toast(e.message, true);
    }
  });
  $('#themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
    try {
      localStorage.setItem('et-theme', next);
    } catch {}
  });
  setInterval(async () => {
    await refreshState();
    if (currentRoute === 'searches' && !document.querySelector('details.links[open]') && !document.querySelector('.s-card:hover')) renderSearchCards();
  }, 15000);
  setInterval(updateHeader, 30000);

  // ---------- router ----------
  let currentRoute = '';
  // Every navigation gets a number. A page still waiting for the API when the user moves on
  // must stop there; otherwise it writes its result (or its error) over the new page.
  let routeSeq = 0;
  class LeftPage extends Error {}
  function pageGuard() {
    const seq = routeSeq;
    const alive = () => {
      if (seq !== routeSeq) throw new LeftPage();
    };
    alive.current = () => seq === routeSeq; // for event handlers: check without throwing
    return alive;
  }
  async function route() {
    const seq = ++routeSeq;
    cleanup.forEach((fn) => fn());
    cleanup = [];
    const hash = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = hash.split('?');
    const parts = pathPart.split('/').filter(Boolean);
    const query = new URLSearchParams(queryPart || '');
    const app = $('#app');
    app.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
    const tab = parts[0] === 'search' || parts[0] === 'preview' || !parts[0] ? 'searches' : parts[0] === 'offer' ? 'offers' : parts[0];
    $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    currentRoute = tab;
    window.scrollTo(0, 0);
    try {
      if (!META) META = await api('GET', '/meta');
      if (seq !== routeSeq) return;
      if (!parts[0]) await pageSearches(app);
      else if (parts[0] === 'search' && parts[1] === 'new') await pageForm(app, null);
      else if (parts[0] === 'search' && parts[1]) await pageForm(app, parts[1]);
      else if (parts[0] === 'preview' && parts[1]) await pagePreview(app, parts[1]);
      else if (parts[0] === 'offers') await pageOffers(app, query);
      else if (parts[0] === 'map') await pageMap(app, query);
      else if (parts[0] === 'alerts') await pageAlerts(app);
      else if (parts[0] === 'settings') await pageSettings(app);
      else if (parts[0] === 'offer' && parts[1] && parts[2]) await pageOffer(app, decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
      else app.innerHTML = '<div class="empty">Nie ma takiej strony.</div>';
    } catch (e) {
      if (e instanceof LeftPage || seq !== routeSeq) return; // the user is already on another page
      app.innerHTML = `<div class="card bad">Błąd: ${esc(e.message)}</div>`;
    }
  }
  window.addEventListener('hashchange', route);

  // ---------- searches ----------
  async function pageSearches(app) {
    const alive = pageGuard();
    await refreshState();
    let blocked = false;
    if (META.desktop) {
      try {
        blocked = (await api('GET', '/desktop')).notificationsBlocked;
      } catch {}
    }
    alive();
    const notice = META.desktop
      ? blocked
        ? `<div class="notice">🔕 ${notifBlockedText()} <a href="#/settings">Test powiadomień</a></div>`
        : ''
      : STATE.telegramOk
        ? ''
        : '<div class="notice">Telegram nie jest skonfigurowany — alerty trafią tylko do panelu. <a href="#/settings">Ustawienia</a></div>';
    app.innerHTML = `
      ${notice}
      <div class="page-head"><h1>Wyszukiwania</h1><span class="spacer"></span>
        <button class="btn" id="importBtn" title="Wczytaj wyszukiwania z pliku .json">Importuj</button>
        ${STATE.searches.length ? `<a class="btn" href="/api/searches/export" download title="Zapisz wszystkie wyszukiwania do pliku .json">Eksportuj wszystkie</a>` : ''}
        <a class="btn btn-primary" href="#/search/new">+ Nowe wyszukiwanie</a>
        <input type="file" id="importFile" accept=".json,application/json" class="hidden"></div>
      <div id="searchCards"></div>
      <h2 style="margin-top:28px">Status portali</h2>
      <div class="card" id="portalStatus"></div>`;
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        let data;
        try {
          data = JSON.parse(await file.text());
        } catch {
          throw new Error('To nie jest poprawny plik .json.');
        }
        const r = await api('POST', '/searches/import', data);
        toast(`Zaimportowano: ${r.added.join(', ')}. Pierwsze sprawdzenie tylko zapisze obecne oferty.`);
        await refreshState();
        renderSearchCards();
      } catch (err) {
        toast(err.message, true);
      }
    });
    renderSearchCards();
  }

  function rangeText(a, b, unit, fmt = short) {
    if (!a && !b) return null;
    return `${a ? fmt(a) : '0'} – ${b ? fmt(b) : '∞'}${unit}`;
  }

  function filterChips(s) {
    const c = [];
    if (s.areas?.length) {
      const n = (s.areaTowns || []).filter((t) => t.enabled).length;
      c.push(`✏️ ${s.areas.length === 1 ? 'obszar na mapie' : `${s.areas.length} ${plural(s.areas.length, 'obszar', 'obszary', 'obszarów')}`} · ${n} ${plural(n, 'miejscowość', 'miejscowości', 'miejscowości')}`);
    }
    const pr = rangeText(s.priceMin, s.priceMax, ' zł');
    if (pr) c.push(`💰 ${pr}`);
    const ar = rangeText(s.areaMin, s.areaMax, ' m²', num);
    if (ar) c.push(`📐 ${ar}`);
    if (s.propertyType === 'house') {
      const pa = rangeText(s.plotAreaMin, s.plotAreaMax, ' m²', num);
      if (pa) c.push(`🌳 działka ${pa}`);
    }
    if (s.pricePerM2Max) c.push(`≤ ${num(s.pricePerM2Max)} zł/m²`);
    if (s.radiusKm) c.push(`+${s.radiusKm} km`);
    if (s.propertyType === 'plot') {
      if (s.plotTypes.length && s.plotTypes.length < META.plotTypes.length) c.push(s.plotTypes.map((x) => META.plotTypes.find((t) => t.code === x)?.label).join(', '));
      if (s.media.length) c.push(`media: ${s.media.map((m) => META.media.find((x) => x.code === m)?.label).join(', ')}${s.mediaAllowRoad ? ' (też w drodze)' : ''}`);
      if (s.zoning) c.push({ mpzp: 'MPZP', wz: 'WZ', any: 'MPZP lub WZ' }[s.zoning]);
      if (s.access) c.push(s.access === 'asphalt' ? 'dojazd asfaltowy' : 'dojazd utwardzony');
      if (s.fenced) c.push('ogrodzona');
      if (s.minWidth) c.push(`szer. ≥ ${s.minWidth} m`);
    }
    if (s.propertyType === 'house') {
      if (s.houseTypes.length && s.houseTypes.length < META.houseTypes.length) c.push(s.houseTypes.map((x) => META.houseTypes.find((t) => t.code === x)?.label).join(', '));
      if (s.houseStates.length) c.push(s.houseStates.map((x) => META.houseStates.find((t) => t.code === x)?.label).join(', '));
      if (s.buildYearMin) c.push(`od ${s.buildYearMin} r.`);
      if (s.garage) c.push('garaż');
    }
    if (s.propertyType !== 'plot' && (s.roomsMin || s.roomsMax)) c.push(`pokoje ${s.roomsMin || 1}–${s.roomsMax || '∞'}`);
    if (s.propertyType === 'flat') {
      if (s.floorMin !== null || s.floorMax !== null) c.push(`piętro ${s.floorMin ?? 0}–${s.floorMax ?? '∞'}`);
      if (s.market) c.push(s.market === 'primary' ? 'rynek pierwotny' : 'rynek wtórny');
      for (const [k, l] of [['elevator', 'winda'], ['balcony', 'balkon'], ['garden', 'ogród'], ['parking', 'parking']]) if (s[k]) c.push(l);
    }
    if (s.privateOnly) c.push('tylko prywatne');
    for (const k of s.keywordsRequired) c.push(`+ ${k}`);
    for (const k of s.keywordsExcluded) c.push(`− ${k}`);
    return c.map((x) => `<span class="chip">${esc(x)}</span>`).join('');
  }

  function coverageNotes(s) {
    const weak = {};
    for (const c of s.coverage || []) {
      for (const [pid, cap] of Object.entries(c.portals)) {
        if (cap === 'text' || cap === 'none') (weak[cap] = weak[cap] || []).push(`${portalName(pid)} (${c.label})`);
      }
    }
    const out = [];
    if (weak.none) out.push(`<span><b>nie sprawdzane na:</b> ${esc(weak.none.join(', '))}</span>`);
    if (weak.text) out.push(`<span><b>tylko z opisu na:</b> ${esc(weak.text.join(', '))}</span>`);
    return out.length ? `<div class="cov">${out.join('')}</div>` : '';
  }

  function renderSearchCards() {
    const box = $('#searchCards');
    if (!box || !STATE) return;
    const list = STATE.searches;
    if (!list.length) {
      box.innerHTML = `<div class="card empty"><div class="big">🏡</div><p>Nie masz jeszcze wyszukiwań.</p><a class="btn btn-primary" href="#/search/new">Utwórz pierwsze</a></div>`;
    } else {
      box.className = 'cards';
      box.innerHTML = list.map(searchCard).join('');
    }
    $$('.s-toggle', box).forEach((el) =>
      el.addEventListener('change', async () => {
        try {
          await api('POST', `/searches/${el.dataset.id}/toggle`, { enabled: el.checked });
          el.closest('.s-card').classList.toggle('disabled', !el.checked);
          toast(el.checked ? 'Włączono wyszukiwanie' : 'Wyłączono wyszukiwanie');
          refreshState();
        } catch (e) {
          toast(e.message, true);
        }
      })
    );
    $$('.s-delete', box).forEach((el) =>
      el.addEventListener('click', async () => {
        if (!confirm(`Usunąć wyszukiwanie „${el.dataset.name}”? Zapisane oferty też zostaną usunięte.`)) return;
        try {
          await api('DELETE', `/searches/${el.dataset.id}`);
          toast('Usunięto');
          await refreshState();
          renderSearchCards();
        } catch (e) {
          toast(e.message, true);
        }
      })
    );
    $$('.s-resolve', box).forEach((el) =>
      el.addEventListener('click', async () => {
        await api('POST', `/searches/${el.dataset.id}/resolve`);
        toast('Odświeżam lokalizacje…');
        setTimeout(async () => {
          await refreshState();
          renderSearchCards();
        }, 8000);
      })
    );
    const ps = $('#portalStatus');
    if (ps) ps.innerHTML = portalStatusTable();
  }

  function searchCard(s) {
    const locLabel = (q) => s.locationPins.find((p) => p.query === q)?.teryt?.label || q;
    const locs = (s.locations.slice(0, 4).map(locLabel).join(', ') + (s.locations.length > 4 ? ` +${s.locations.length - 4}` : '')) || (s.areas?.length ? 'obszar narysowany na mapie' : '');
    const unpicked = s.resolved?.unresolved?.length ? `<div class="notice small" style="margin:8px 0 0">⚠ Nie sprawdzane, bo nazwa może oznaczać kilka miejscowości: <b>${esc(s.resolved.unresolved.map((u) => u.query).join(', '))}</b>. <a href="#/search/${esc(s.id)}">Wybierz właściwe z listy</a>.</div>` : '';
    const dots = META.portals
      .map((p) => {
        const d = s.dots[p.id];
        if (d.state === 'off') return '';
        return `<span class="dot-item" title="${esc(`${p.name}: ${d.note || ''}`)}"><span class="dot ${d.state}"></span>${esc(p.name)}${d.count !== null && d.count !== undefined ? ` <span class="muted">${d.matching}</span>` : ''}</span>`;
      })
      .join('');
    const r = s.resolved;
    let links = '';
    if (s.resolving) links = '<p class="small muted"><span class="spinner"></span> rozpoznawanie lokalizacji…</p>';
    else if (!r) links = '<p class="small muted">Lokalizacje jeszcze nierozpoznane.</p>';
    else {
      links = '<ul class="link-list">';
      for (const p of META.portals) {
        if (!s.portals[p.id]) continue;
        const pr = r.portals[p.id];
        if (!pr) continue;
        const bad = (pr.locations || []).filter((l) => !l.ok);
        links += `<li>${pbadge(p.id)}${pr.targets.map((t) => `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.label)}</a>`).join(' · ') || '<span class="bad">brak URL</span>'}${bad.map((l) => `<span class="chip bad" title="${esc(l.error)}">✕ ${esc(l.query)}</span>`).join('')}${pr.error && !pr.targets.length ? `<span class="small bad">${esc(pr.error)}</span>` : ''}</li>`;
      }
      links += `</ul><p class="small muted" style="margin:8px 0 0">Rozpoznano ${ago(r.at)} · <button class="btn btn-ghost btn-sm s-resolve" data-id="${esc(s.id)}">odśwież lokalizacje</button></p>`;
    }
    const unresolvedCount = r ? Object.values(r.portals).reduce((n, p) => n + (p.locations || []).filter((l) => !l.ok).length, 0) : 0;
    return `
      <div class="card s-card ${s.enabled ? '' : 'disabled'}">
        <div class="s-head">
          <div class="type-badge">${ICON[s.propertyType]}</div>
          <div style="flex:1;min-width:0">
            <p class="s-title">${esc(s.name)}</p>
            <div class="s-sub">${TYPE_LABEL[s.propertyType]} · ${TRANS_LABEL[s.transaction]} · ${esc(locs)}</div>
          </div>
          <label class="switch" title="Włącz / wyłącz"><input type="checkbox" class="s-toggle" data-id="${esc(s.id)}" ${s.enabled ? 'checked' : ''}><span class="track"></span></label>
        </div>
        ${unpicked}
        <div class="chips">${filterChips(s)}</div>
        <div class="s-stats">
          <div class="stat"><b>${s.offers.matching}</b><span>pasujących ofert</span></div>
          <div class="stat"><b>${s.offers.fav}</b><span>ulubionych</span></div>
          <div class="stat"><b style="font-size:14px">${s.lastCheck ? ago(s.lastCheck) : '—'}</b><span>ostatnie sprawdzenie</span></div>
        </div>
        <div class="dots">${dots}</div>
        ${coverageNotes(s)}
        <details class="links"><summary>Linki do portali${unresolvedCount ? ` <span class="chip bad">${unresolvedCount} nierozpoznane</span>` : ''}</summary>${links}</details>
        <div class="s-actions">
          <a class="btn btn-sm" href="#/offers?search=${esc(s.id)}">Oferty</a>
          <a class="btn btn-sm" href="#/preview/${esc(s.id)}">Podgląd</a>
          <a class="btn btn-sm" href="#/search/${esc(s.id)}">Edytuj</a>
          <a class="btn btn-sm btn-ghost" href="/api/searches/export?ids=${esc(s.id)}" download title="Zapisz to wyszukiwanie do pliku .json (np. dla wspólnika)">Eksportuj</a>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-ghost btn-danger s-delete" data-id="${esc(s.id)}" data-name="${esc(s.name)}">Usuń</button>
        </div>
      </div>`;
  }

  function portalStatusTable() {
    const rows = META.portals
      .map((p) => {
        const st = STATE.status.portals[p.id] || {};
        const okLater = st.lastSuccess && (!st.lastError || st.lastSuccess >= st.lastError);
        const state = st.errorStreak && !okLater ? 'error' : st.zeroStreak ? 'warn' : st.lastSuccess ? 'ok' : 'unknown';
        const label = { error: `błąd ×${st.errorStreak}`, warn: `0 ofert ×${st.zeroStreak}`, ok: 'działa', unknown: '—' }[state];
        return `<tr><td>${pbadge(p.id)} <b>${esc(p.name)}</b></td><td><span class="dot-item"><span class="dot ${state}"></span>${label}</span></td>
          <td>${st.lastSuccess ? ago(st.lastSuccess) : '—'}</td><td>${st.lastCount ?? '—'}</td><td class="small muted">${esc(st.lastMethod || '—')}</td>
          <td class="small">${st.lastError ? `<span class="muted">${ago(st.lastError)}</span><br><span class="bad">${esc(String(st.lastErrorMsg || '').slice(0, 140))}</span>` : '—'}</td></tr>`;
      })
      .join('');
    return `<div style="overflow-x:auto"><table class="kv-table"><tr><th>Portal</th><th>Stan</th><th>Ostatni sukces</th><th>Ofert</th><th>Parser</th><th>Ostatni błąd</th></tr>${rows}</table></div>`;
  }

  // ---------- dual range ----------
  function dualRange({ min, max, step, valueMin, valueMax, unit = '', onChange }) {
    const el = document.createElement('div');
    el.className = 'range';
    el.innerHTML = `
      <div class="range-track"><div class="range-fill"></div>
        <input type="range" class="r-lo" min="${min}" max="${max}" step="${step}" aria-label="od">
        <input type="range" class="r-hi" min="${min}" max="${max}" step="${step}" aria-label="do">
      </div>
      <div class="range-inputs">
        <input type="number" class="n-lo" min="0" step="any" placeholder="od">
        <span class="muted">–</span>
        <input type="number" class="n-hi" min="0" step="any" placeholder="bez limitu">
      </div>`;
    const lo = $('.r-lo', el);
    const hi = $('.r-hi', el);
    const nlo = $('.n-lo', el);
    const nhi = $('.n-hi', el);
    const fill = $('.range-fill', el);
    let vMin = valueMin ?? null;
    let vMax = valueMax ?? null;
    const paint = () => {
      const a = vMin === null ? min : Math.min(vMin, max);
      const b = vMax === null ? max : Math.min(vMax, max);
      lo.value = a;
      hi.value = b;
      fill.style.left = `${((a - min) / (max - min)) * 100}%`;
      fill.style.right = `${100 - ((b - min) / (max - min)) * 100}%`;
    };
    const emit = () => onChange(vMin, vMax);
    nlo.value = vMin ?? '';
    nhi.value = vMax ?? '';
    nlo.placeholder = `od${unit ? ` (${unit})` : ''}`;
    lo.addEventListener('input', () => {
      let v = Number(lo.value);
      if (Number(hi.value) < v) v = Number(hi.value);
      vMin = v <= min ? null : v;
      nlo.value = vMin ?? '';
      paint();
      emit();
    });
    hi.addEventListener('input', () => {
      let v = Number(hi.value);
      if (v < Number(lo.value)) v = Number(lo.value);
      vMax = v >= max ? null : v;
      nhi.value = vMax ?? '';
      paint();
      emit();
    });
    nlo.addEventListener('input', () => {
      vMin = nlo.value === '' ? null : Number(nlo.value);
      paint();
      emit();
    });
    nhi.addEventListener('input', () => {
      vMax = nhi.value === '' ? null : Number(nhi.value);
      paint();
      emit();
    });
    paint();
    return el;
  }

  // ---------- leaflet helpers ----------
  // Base maps: CARTO (light Voyager / Dark Matter, following the theme) when a CARTO key is set in Settings,
  // otherwise the Geoportal topographic map (the orthophoto can be very slow and is patchy at small scales).
  // Orthophoto and OpenStreetMap are always available.
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  const CARTO_URL = {
    light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  };
  const darkMq = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (document.documentElement.dataset.theme || (darkMq.matches ? 'dark' : 'light')) === 'dark';
  const cartoLayers = new Set();
  const cartoUrl = () => `${CARTO_URL[isDark() ? 'dark' : 'light']}?key=${encodeURIComponent(META.cartoKey || '')}`;
  const syncCarto = () => cartoLayers.forEach((l) => l.setUrl(cartoUrl()));
  darkMq.addEventListener('change', syncCarto);
  $('#themeToggle').addEventListener('click', syncCarto);

  function makeMap(el, opts = {}) {
    const map = L.map(el, { scrollWheelZoom: opts.scroll !== false, zoomControl: true }).setView(opts.center || [52.0, 19.4], opts.zoom || 6); // whole Poland until something is selected
    const carto = L.tileLayer(cartoUrl(), {
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`,
    });
    const orto = L.tileLayer.wms('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution', {
      layers: 'Raster',
      format: 'image/jpeg',
      version: '1.3.0',
      crs: L.CRS.EPSG4326,
      maxZoom: 20,
      attribution: 'Ortofotomapa &copy; <a href="https://www.geoportal.gov.pl" target="_blank" rel="noopener">GUGiK / Geoportal</a>',
    });
    const topo = L.tileLayer.wms('https://mapy.geoportal.gov.pl/wss/service/img/guest/TOPO/MapServer/WMSServer', {
      layers: 'Raster',
      format: 'image/png',
      version: '1.3.0',
      crs: L.CRS.EPSG4326,
      maxZoom: 20,
      attribution: 'Mapa topograficzna &copy; <a href="https://www.geoportal.gov.pl" target="_blank" rel="noopener">GUGiK / Geoportal</a>',
    });
    // OSM tiles have no dark variant, so they keep the CSS invert in dark mode
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'tiles-invert', attribution: OSM_ATTR });
    // CARTO tiles need a key (without one every tile says "API KEY REQUIRED")
    const bases = META.cartoKey ? { carto, topo, orto, osm } : { topo, orto, osm };
    const def = META.cartoKey ? 'carto' : 'topo';
    (bases[store.get('basemap', def)] || bases[def]).addTo(map);
    const names = { carto: 'Mapa (CARTO)', topo: 'Mapa topograficzna (Geoportal)', orto: 'Ortofotomapa (Geoportal)', osm: 'Mapa OpenStreetMap' };
    L.control.layers(Object.fromEntries(Object.entries(bases).map(([k, l]) => [names[k], l])), null, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', (e) => store.set('basemap', Object.keys(bases).find((k) => bases[k] === e.layer) || def));
    if (META.cartoKey) cartoLayers.add(carto);
    cleanup.push(() => {
      cartoLayers.delete(carto);
      map.remove();
    });
    return map;
  }
  // Runs fn once the page is laid out (maps need their final size); cancelled if the user leaves first.
  function afterLayout(fn) {
    const t = setTimeout(fn, 50);
    cleanup.push(() => clearTimeout(t));
  }
  const pinIcon = (cls = '') => L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] });

  // ---------- search form ----------
  async function pageForm(app, id) {
    const alive = pageGuard();
    await refreshState();
    alive();
    const existing = id ? STATE.searches.find((s) => s.id === id) : null;
    if (id && !existing) throw new Error('Nie ma takiego wyszukiwania');
    const f = JSON.parse(JSON.stringify(existing || { ...META.defaults, name: '' }));
    delete f.offers;
    delete f.dots;
    delete f.coverage;
    delete f.resolved;
    let dirtyName = !!existing;

    app.innerHTML = `
      <div class="page-head"><h1>${existing ? `Edycja: ${esc(existing.name)}` : 'Nowe wyszukiwanie'}</h1></div>
      <div class="form-layout">
        <div>
          <section class="card section"><div class="section-head"><span class="step">1</span><h2>Co szukasz?</h2></div>
            <div class="tiles" id="typeTiles">
              ${['plot', 'house', 'flat'].map((t) => `<button type="button" class="tile" data-type="${t}">${ICON[t]}<span>${TYPE_LABEL[t]}</span><small>${{ plot: 'budowlana, rolna…', house: 'w tym bliźniak', flat: 'blok, kamienica…' }[t]}</small></button>`).join('')}
            </div>
            <div class="row" style="margin-top:14px"><div class="seg" id="transSeg"><button type="button" data-v="sale">Sprzedaż</button><button type="button" data-v="rent">Wynajem</button></div>
              <span class="spacer"></span>
              <label class="switch"><input type="checkbox" id="fEnabled"><span class="track"></span><span>aktywne</span></label></div>
            <label class="field" style="margin-top:14px"><span>Nazwa wyszukiwania</span><input type="text" id="fName" placeholder="np. Działki Wieliczka / Niepołomice"></label>
          </section>

          <section class="card section"><div class="section-head"><span class="step">2</span><h2>Lokalizacja</h2></div>
            <div class="ac-wrap"><input type="search" id="locInput" placeholder="Wpisz miejscowość, np. Wieliczka…" autocomplete="off"><div class="ac-list hidden" id="locList"></div></div>
            <div class="chips" id="locChips" style="margin-top:10px"></div>
            <div class="grid-2" style="margin-top:14px;align-items:end">
              <div class="single-range"><span class="field-label">Promień: <b id="radiusVal"></b></span><input type="range" id="radius" min="0" max="30" step="1"></div>
              <div><button type="button" class="btn btn-sm" id="nearbyBtn">+ Dodaj sąsiednie miejscowości</button></div>
            </div>
            <div id="nearbyBox" class="nearby-box hidden"></div>
            <p class="small muted" style="margin:14px 0 0">✏️ <b>Obszar na mapie</b> (zamiast listy miejscowości albo dodatkowo): narzędzia po lewej stronie mapy — wielokąt, prostokąt, okrąg; edycja wierzchołków, przesuwanie i usuwanie. Można narysować kilka obszarów. Na telefonie: dotykaj kolejnych wierzchołków, zakończ dotknięciem pierwszego.</p>
            <div id="formMap" class="mini-map draw-map"></div>
            <div id="areaTowns" class="area-towns hidden"></div>
            <label class="field" style="margin-top:12px"><span>Region / powiat (opcjonalnie — pomaga, gdy wpiszesz nazwę bez podpowiedzi)</span><input type="text" id="fRegion" placeholder="np. małopolskie"></label>
          </section>

          <section class="card section"><div class="section-head"><span class="step">3</span><h2>Cena</h2></div>
            <div id="priceRange"></div>
            <label class="field" style="margin-top:12px;max-width:260px"><span>Cena za m² maks. (zł)</span><input type="number" id="fPpm" min="0" placeholder="bez limitu"></label>
          </section>

          <section class="card section"><div class="section-head"><span class="step">4</span><h2>Powierzchnia</h2></div>
            <span class="field-label" id="areaLabel">Powierzchnia (m²)</span><div id="areaRange"></div>
            <div id="plotAreaWrap" class="hidden" style="margin-top:14px"><span class="field-label">Powierzchnia działki (m²)</span><div id="plotAreaRange"></div></div>
          </section>

          <section class="card section"><div class="section-head"><span class="step">5</span><h2>Szczegóły</h2></div><div id="details"></div></section>

          <section class="card section"><div class="section-head"><span class="step">6</span><h2>Dodatkowe</h2></div>
            <label class="switch" style="margin-bottom:14px"><input type="checkbox" id="fPrivate"><span class="track"></span><span>Tylko oferty prywatne (bez biur i deweloperów)</span></label>
            <div class="grid-2">
              <div><span class="field-label">Słowa wymagane (każde musi wystąpić; „a|b” = jedno z nich)</span><input type="text" id="kwReqInput" placeholder="wpisz i naciśnij Enter"><div class="chips" id="kwReq" style="margin-top:8px"></div></div>
              <div><span class="field-label">Słowa wykluczone</span><input type="text" id="kwExInput" placeholder="np. rolna — Enter"><div class="chips" id="kwEx" style="margin-top:8px"></div></div>
            </div>
            <span class="field-label" style="margin-top:16px">Portale</span>
            <div class="row" id="portalChecks"></div>
            <label class="field" style="margin-top:14px;max-width:340px"><span>Osobny wątek Telegram dla tego wyszukiwania (opcjonalnie)</span><input type="text" id="fThread" placeholder="message_thread_id"></label>
          </section>
          <div class="row"><button class="btn btn-primary" id="saveBtn">Zapisz wyszukiwanie</button><a class="btn" href="#/">Anuluj</a></div>
        </div>

        <aside class="form-side">
          <div class="card"><div class="section-head"><span class="step">7</span><h2>Podgląd na żywo</h2></div>
            <p class="small muted" style="margin-top:-6px">Pobiera teraz wyniki z portali dla ustawionych kryteriów (bez zapisywania i bez alertów). Trwa do minuty.</p>
            <button class="btn btn-primary btn-sm" id="previewBtn">Sprawdź, ile ofert pasuje</button>
            <div id="previewOut" style="margin-top:12px"></div>
          </div>
          <div class="card"><h3>Jak sprawdzane są filtry</h3><div id="coverageOut" class="small muted">Ustaw filtry szczegółowe, a tu zobaczysz, na których portalach da się je sprawdzić.</div></div>
        </aside>
      </div>`;

    // --- section 1
    const setType = (t) => {
      if (f.propertyType !== t) {
        f.propertyType = t;
        f.plotTypes = t === 'plot' ? ['building'] : [];
        f.priceMin = f.priceMax = f.areaMin = f.areaMax = null;
      }
      $$('#typeTiles .tile').forEach((b) => b.classList.toggle('active', b.dataset.type === f.propertyType));
      renderRanges();
      renderDetails();
      autoName();
      changed();
    };
    $$('#typeTiles .tile').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
    const setTrans = (v) => {
      if (f.transaction !== v) {
        f.transaction = v;
        f.priceMin = f.priceMax = null;
      }
      $$('#transSeg button').forEach((b) => b.classList.toggle('active', b.dataset.v === f.transaction));
      renderRanges();
      renderDetails();
      autoName();
      changed();
    };
    $$('#transSeg button').forEach((b) => b.addEventListener('click', () => setTrans(b.dataset.v)));
    $('#fEnabled').checked = f.enabled !== false;
    $('#fEnabled').addEventListener('change', (e) => (f.enabled = e.target.checked));
    $('#fName').value = f.name || '';
    $('#fName').addEventListener('input', (e) => {
      f.name = e.target.value;
      dirtyName = true;
    });
    function autoName() {
      if (dirtyName) return;
      const t = { plot: 'Działki', house: 'Domy', flat: 'Mieszkania' }[f.propertyType];
      const where = f.locations.length ? f.locations.slice(0, 3).join(', ') : f.areas?.length ? `obszar (${(f.areaTowns || []).filter((x) => x.enabled && x.status === 'inside').slice(0, 2).map((x) => x.name).join(', ') || 'na mapie'})` : '';
      f.name = `${t}${f.transaction === 'rent' ? ' (wynajem)' : ''}${where ? ` ${where}` : ''}`;
      $('#fName').value = f.name;
    }

    // --- section 2: locations
    const map = makeMap($('#formMap'), { scroll: false });
    window.__etMap = map; // handle for automated UI tests
    const layer = L.layerGroup().addTo(map);
    const townLayer = L.layerGroup().addTo(map);
    const areaGroup = L.featureGroup().addTo(map);
    const accent = () => getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#4f46e5';
    function drawMap(fit = true) {
      layer.clearLayers();
      const pts = [];
      for (const q of f.locations) {
        const pin = f.locationPins.find((p) => p.query === q);
        if (!pin || !Number.isFinite(pin.lat)) continue;
        pts.push([pin.lat, pin.lon]);
        L.marker([pin.lat, pin.lon], { icon: pinIcon(), pmIgnore: true }).bindTooltip(q).addTo(layer);
        if (f.radiusKm > 0) L.circle([pin.lat, pin.lon], { radius: f.radiusKm * 1000, color: accent(), weight: 1.5, fillOpacity: 0.07, pmIgnore: true, interactive: false }).addTo(layer);
      }
      if (!fit) return;
      let b = pts.length ? L.latLngBounds(pts) : null;
      if (areaGroup.getLayers().length) b = b ? b.extend(areaGroup.getBounds()) : areaGroup.getBounds();
      if (b && b.isValid()) map.fitBounds(b.pad(f.radiusKm > 0 ? 0.6 : 0.3), { maxZoom: 13 });
    }

    // --- drawn areas (Leaflet-Geoman)
    const areaStyle = () => ({ color: accent(), weight: 2, fillOpacity: 0.12 });
    function layerToArea(l) {
      if (l instanceof L.Circle) {
        const c = l.getLatLng();
        return { type: 'circle', center: [+c.lat.toFixed(6), +c.lng.toFixed(6)], radius: Math.round(l.getRadius()) };
      }
      const ll = l.getLatLngs();
      const ring = Array.isArray(ll[0]) ? ll[0] : ll;
      return { type: l instanceof L.Rectangle ? 'rectangle' : 'polygon', points: ring.map((p) => [+p.lat.toFixed(6), +p.lng.toFixed(6)]) };
    }
    function areaToLayer(a) {
      if (a.type === 'circle') return L.circle(a.center, { radius: a.radius, ...areaStyle() });
      if (a.type === 'rectangle') return L.rectangle(L.latLngBounds(a.points), areaStyle());
      return L.polygon(a.points, areaStyle());
    }
    const watchLayer = (l) => l.on('pm:edit pm:dragend pm:cut', () => syncAreas());
    for (const a of f.areas || []) {
      const l = areaToLayer(a);
      areaGroup.addLayer(l);
      watchLayer(l);
    }
    if (map.pm) {
      try {
        map.pm.setLang('pl');
      } catch {}
      map.pm.setGlobalOptions({ pathOptions: areaStyle(), templineStyle: { color: accent() }, hintlineStyle: { color: accent(), dashArray: [5, 5] }, snappable: false });
      map.pm.addControls({
        position: 'topleft',
        drawMarker: false,
        drawCircleMarker: false,
        drawPolyline: false,
        drawText: false,
        cutPolygon: false,
        rotateMode: false,
        drawPolygon: true,
        drawRectangle: true,
        drawCircle: true,
        editMode: true,
        dragMode: true,
        removalMode: true,
      });
      // Touch screens have no mouse movement between taps: Geoman would see a zero radius / zero-size
      // rectangle. Moving its "cursor" to every tap before the click fixes circles and rectangles.
      map.on('preclick', (e) => {
        if (map.pm.globalDrawModeEnabled()) map.fire('mousemove', { latlng: e.latlng, layerPoint: e.layerPoint, containerPoint: e.containerPoint, originalEvent: e.originalEvent });
      });
      map.on('pm:create', (e) => {
        e.layer.setStyle?.(areaStyle());
        areaGroup.addLayer(e.layer);
        watchLayer(e.layer);
        syncAreas();
      });
      map.on('pm:remove', (e) => {
        areaGroup.removeLayer(e.layer);
        syncAreas();
      });
    }

    let areaReq = 0;
    const syncAreas = debounce(async () => {
      f.areas = areaGroup.getLayers().map(layerToArea);
      const box = $('#areaTowns');
      if (!f.areas.length) {
        f.areaTowns = [];
        renderAreaTowns();
        autoName();
        changed();
        return;
      }
      const req = ++areaReq;
      box.classList.remove('hidden');
      box.innerHTML = '<span class="spinner"></span> Ustalam miejscowości w obszarze (OpenStreetMap)…';
      try {
        const found = await api('POST', '/locations/in-area', { areas: f.areas });
        if (req !== areaReq || !alive.current()) return;
        const prev = new Map((f.areaTowns || []).map((t) => [t.name, t.enabled]));
        // towns inside are on by default, towns only touching the edge are off until clicked
        f.areaTowns = found.map((t) => ({ ...t, enabled: prev.has(t.name) ? prev.get(t.name) : t.status === 'inside' }));
      } catch (e) {
        if (req !== areaReq || !alive.current()) return;
        toast(e.message, true);
      }
      renderAreaTowns();
      autoName();
      changed();
    }, 600);

    function renderAreaTowns() {
      const box = $('#areaTowns');
      townLayer.clearLayers();
      if (!f.areas.length) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
      }
      box.classList.remove('hidden');
      const on = f.areaTowns.filter((t) => t.enabled).length;
      box.innerHTML = `<div class="row"><b>${f.areas.length === 1 ? 'Obszar' : `${f.areas.length} ${plural(f.areas.length, 'obszar', 'obszary', 'obszarów')}`}: włączone ${on} z ${f.areaTowns.length} ${plural(f.areaTowns.length, 'miejscowości', 'miejscowości', 'miejscowości')}</b><span class="spacer"></span>
          <button type="button" class="btn btn-sm btn-ghost" id="atAll">włącz wszystkie</button><button type="button" class="btn btn-sm btn-ghost" id="atInside">tylko w środku</button></div>
        <p class="small muted" style="margin:4px 0 8px">Otodom, Gratka i Morizon szukają bezpośrednio w narysowanym obszarze. OLX i Nieruchomosci-online — we włączonych miejscowościach. Kliknij chip, aby włączyć/wyłączyć; ↔ = miejscowość przy granicy obszaru.</p>
        <div class="chips">${f.areaTowns.map((t, i) => `<button type="button" class="chip town-chip ${t.enabled ? 'accent' : 'off'}" data-i="${i}" title="${t.status === 'edge' ? 'dotyka obszaru / przy granicy' : 'w obszarze'}">${t.enabled ? '✓' : '○'} ${esc(t.name)}${t.status === 'edge' ? ' ↔' : ''}</button>`).join('') || '<span class="small muted">Nie znaleziono miejscowości w obszarze.</span>'}</div>`;
      $$('.town-chip', box).forEach((b) =>
        b.addEventListener('click', () => {
          const t = f.areaTowns[Number(b.dataset.i)];
          t.enabled = !t.enabled;
          renderAreaTowns();
          changed();
        })
      );
      $('#atAll')?.addEventListener('click', () => {
        f.areaTowns.forEach((t) => (t.enabled = true));
        renderAreaTowns();
        changed();
      });
      $('#atInside')?.addEventListener('click', () => {
        f.areaTowns.forEach((t) => (t.enabled = t.status === 'inside'));
        renderAreaTowns();
        changed();
      });
      for (const t of f.areaTowns) {
        // not clickable: they sit on top of the areas and would catch taps meant for editing/removing them
        L.circleMarker([t.lat, t.lon], { radius: 5, weight: 2, color: t.enabled ? (t.status === 'inside' ? '#16a34a' : '#d97706') : '#9ca3af', fillOpacity: t.enabled ? 0.8 : 0.2, pmIgnore: true, interactive: false }).addTo(townLayer);
      }
    }
    function renderChips() {
      const pinIc = ICON.pin.replace('class="ic"', 'class="ic" style="width:13px;height:13px"');
      $('#locChips').innerHTML =
        f.locations
          .map((q) => {
            const pin = f.locationPins.find((p) => p.query === q);
            if (!pin) return `<span class="chip warn" title="Ta nazwa może oznaczać kilka miejscowości — nie będzie sprawdzana, dopóki nie wybierzesz właściwej">⚠ ${esc(q)} <a href="#" class="loc-choose" data-q="${esc(q)}">wybierz z listy</a><button type="button" data-q="${esc(q)}" aria-label="usuń">×</button></span>`;
            const label = pin.teryt?.label || pin.label || q;
            const codes = pin.teryt?.codes ? `TERYT: gmina ${pin.teryt.terc || '—'}${pin.teryt.simc ? `, miejscowość ${pin.teryt.simc}` : ''}` : 'gmina i powiat zostaną ustalone po zapisaniu';
            return `<span class="chip accent" title="${esc(codes)}">${pinIc}${esc(label)}${pin.teryt ? '' : ' <span class="spinner" style="width:10px;height:10px"></span>'}<button type="button" data-q="${esc(q)}" aria-label="usuń">×</button></span>`;
          })
          .join('') || '<span class="small muted">Dodaj miejscowość albo narysuj obszar na mapie.</span>';
      $$('#locChips .loc-choose').forEach((a) =>
        a.addEventListener('click', (e) => {
          e.preventDefault();
          input.value = a.dataset.q;
          input.focus();
          suggest(a.dataset.q);
        })
      );
      $$('#locChips button').forEach((b) =>
        b.addEventListener('click', () => {
          f.locations = f.locations.filter((x) => x !== b.dataset.q);
          f.locationPins = f.locationPins.filter((p) => p.query !== b.dataset.q);
          renderChips();
          drawMap();
          autoName();
          changed();
        })
      );
    }
    /** item: an entry of the list (or a town from OpenStreetMap); teryt: its commune/county, if known. */
    function addLocation(item, teryt = null) {
      let query = item.level === 'commune' ? `gmina ${item.name}` : item.name;
      const old = f.locations.find((q) => q.toLowerCase() === query.toLowerCase());
      if (old) {
        const same = f.locationPins.find((p) => p.query === old);
        if (!same) {
          // a name typed earlier without picking: replace it with the picked town
          f.locations = f.locations.filter((q) => q !== old);
        } else {
          if (Math.abs(same.lat - item.lat) < 0.01 && Math.abs(same.lon - item.lon) < 0.01) return;
          query = `${query} (${teryt?.powiat || (item.context || '').split(',').map((x) => x.trim()).slice(-2)[0] || 'inna'})`;
          if (f.locations.includes(query)) return;
        }
      }
      f.locations.push(query);
      f.locationPins.push({ query, name: item.name, label: teryt?.label || item.label || item.name, context: item.context || '', lat: item.lat, lon: item.lon, ...(teryt ? { teryt } : {}) });
      renderChips();
      drawMap();
      autoName();
      changed();
    }
    // the commune, county and TERYT codes of a picked town (OpenStreetMap, a few seconds)
    async function pickTown(item) {
      const box = $('#locChips');
      const wait = document.createElement('span');
      wait.className = 'chip';
      wait.innerHTML = `<span class="spinner" style="width:10px;height:10px"></span> ${esc(item.name)} — ustalam gminę i powiat…`;
      box.appendChild(wait);
      let t = null;
      try {
        t = await api('POST', '/locations/describe', { name: item.name, level: item.level, context: item.context, lat: item.lat, lon: item.lon });
      } catch (e) {
        toast(`Nie udało się ustalić gminy i powiatu (${e.message}) — zostaną ustalone po zapisaniu.`, true);
      }
      if (!alive.current()) return;
      wait.remove();
      addLocation(item, t && t.name ? t : null);
    }
    const input = $('#locInput');
    const list = $('#locList');
    let acItems = [];
    let acIndex = -1;
    let acNote = '';
    const fold = (s) => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const showAc = () => {
      list.classList.toggle('hidden', !acItems.length);
      list.innerHTML =
        (acNote ? `<div class="ac-note">${esc(acNote)}</div>` : '') +
        acItems.map((x, i) => `<div class="ac-item ${i === acIndex ? 'active' : ''}" data-i="${i}"><b>${esc(x.level === 'commune' ? `gmina ${x.name}` : x.name)}</b><small>${esc((x.display || x.context || '').replace(/^[^—]*—\s*/, ''))}</small></div>`).join('');
      $$('.ac-item', list).forEach((el) =>
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(Number(el.dataset.i));
        })
      );
    };
    const pick = (i) => {
      const x = acItems[i];
      if (!x) return;
      input.value = '';
      acItems = [];
      acNote = '';
      showAc();
      pickTown(x);
    };
    async function loadSuggestions(q) {
      try {
        return await api('GET', `/locations/suggest?q=${encodeURIComponent(q)}`);
      } catch {
        return [];
      }
    }
    async function suggest(forName) {
      const q = (forName || input.value).trim();
      if (q.length < 2) {
        acItems = [];
        return showAc();
      }
      acItems = await loadSuggestions(q);
      if (!alive.current()) return;
      const same = acItems.filter((x) => fold(x.name) === fold(q));
      acNote = forName && same.length > 1 ? `Jest ${same.length} miejscowości „${q}” — wybierz właściwą:` : '';
      if (forName && same.length) acItems = [...same, ...acItems.filter((x) => !same.includes(x))];
      acIndex = acItems.length ? 0 : -1;
      showAc();
    }
    const suggestSoon = debounce(() => suggest(), 250);
    input.addEventListener('input', suggestSoon);
    input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        acIndex = Math.max(0, Math.min(acItems.length - 1, acIndex + (e.key === 'ArrowDown' ? 1 : -1)));
        showAc();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return;
        (async () => {
          const items = await loadSuggestions(q);
          const same = items.filter((x) => fold(x.name) === fold(q) && x.level !== 'district');
          const towns = same.filter((x) => x.level === 'town');
          if (towns.length === 1 && same.length === 1) {
            acItems = towns;
            return pick(0);
          }
          if (!items.length) return toast(`Nie znam miejscowości „${q}” — sprawdź pisownię i wybierz z podpowiedzi.`, true);
          // several towns with this name (or only similar ones): the user picks, nothing is guessed
          suggest(q);
        })();
      } else if (e.key === 'Escape') {
        acItems = [];
        showAc();
      }
    });
    const radius = $('#radius');
    radius.value = f.radiusKm || 0;
    const showRadius = () => ($('#radiusVal').textContent = f.radiusKm ? `${f.radiusKm} km` : 'tylko wybrane miejscowości');
    showRadius();
    radius.addEventListener('input', () => {
      f.radiusKm = Number(radius.value);
      showRadius();
      drawMap();
      changed();
    });
    $('#nearbyBtn').addEventListener('click', async () => {
      const box = $('#nearbyBox');
      const pins = f.locationPins.filter((p) => f.locations.includes(p.query) && Number.isFinite(p.lat));
      if (!pins.length) return toast('Najpierw wybierz miejscowość z podpowiedzi.', true);
      const r = f.radiusKm || 5;
      box.classList.remove('hidden');
      box.innerHTML = `<span class="spinner"></span> Szukam miejscowości w promieniu ${r} km (OpenStreetMap)…`;
      try {
        const found = new Map();
        for (const p of pins.slice(0, 5)) {
          for (const x of await api('GET', `/locations/nearby?lat=${p.lat}&lon=${p.lon}&radius=${r}`)) {
            const k = x.name;
            if (f.locations.some((q) => q === k || q.startsWith(`${k} (`))) continue;
            if (!found.has(k) || found.get(k).distance > x.distance) found.set(k, x);
          }
        }
        const items = [...found.values()].sort((a, b) => a.distance - b.distance);
        if (!items.length) {
          box.innerHTML = '<span class="muted">Brak innych miejscowości w tym promieniu.</span>';
          return;
        }
        box.innerHTML = `<div class="row"><b>${items.length} miejscowości w promieniu ${r} km</b><span class="spacer"></span><button type="button" class="btn btn-sm" id="nbAll">Zaznacz wszystkie</button><button type="button" class="btn btn-sm btn-primary" id="nbAdd">Dodaj zaznaczone</button></div>
          <div class="nearby-list">${items.map((x, i) => `<label class="check-chip"><input type="checkbox" data-i="${i}" ${x.distance <= r / 2 ? 'checked' : ''}>${esc(x.name)} <span class="muted small">${num(x.distance, 1)} km</span></label>`).join('')}</div>`;
        $('#nbAll').addEventListener('click', () => $$('.nearby-list input', box).forEach((c) => (c.checked = true)));
        $('#nbAdd').addEventListener('click', () => {
          const chosen = $$('.nearby-list input:checked', box).map((c) => items[Number(c.dataset.i)]);
          for (const x of chosen) addLocation({ name: x.name, level: 'town', label: `${x.name} (OSM, ${num(x.distance, 1)} km)`, context: '', lat: x.lat, lon: x.lon });
          box.classList.add('hidden');
          toast(`Dodano ${chosen.length} miejscowości`);
        });
      } catch (e) {
        box.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
      }
    });
    $('#fRegion').value = f.regionHint || '';
    $('#fRegion').addEventListener('input', (e) => (f.regionHint = e.target.value));

    // --- sections 3 & 4: ranges
    function rangeCfg() {
      const rent = f.transaction === 'rent';
      const price = rent ? { max: f.propertyType === 'house' ? 20000 : 10000, step: 100 } : { max: { plot: 3000000, house: 5000000, flat: 3000000 }[f.propertyType], step: { plot: 10000, house: 50000, flat: 10000 }[f.propertyType] };
      const area = { plot: { max: 5000, step: 50 }, house: { max: 500, step: 5 }, flat: { max: 200, step: 1 } }[f.propertyType];
      return { price, area };
    }
    function renderRanges() {
      const c = rangeCfg();
      const pr = $('#priceRange');
      pr.innerHTML = '';
      pr.appendChild(dualRange({ min: 0, max: c.price.max, step: c.price.step, valueMin: f.priceMin, valueMax: f.priceMax, unit: 'zł', onChange: (a, b) => ((f.priceMin = a), (f.priceMax = b), changed()) }));
      const ar = $('#areaRange');
      ar.innerHTML = '';
      $('#areaLabel').textContent = f.propertyType === 'plot' ? 'Powierzchnia działki (m²)' : f.propertyType === 'house' ? 'Powierzchnia domu (m²)' : 'Powierzchnia mieszkania (m²)';
      ar.appendChild(dualRange({ min: 0, max: c.area.max, step: c.area.step, valueMin: f.areaMin, valueMax: f.areaMax, unit: 'm²', onChange: (a, b) => ((f.areaMin = a), (f.areaMax = b), changed()) }));
      $('#plotAreaWrap').classList.toggle('hidden', f.propertyType !== 'house');
      if (f.propertyType === 'house') {
        const pa = $('#plotAreaRange');
        pa.innerHTML = '';
        pa.appendChild(dualRange({ min: 0, max: 3000, step: 50, valueMin: f.plotAreaMin, valueMax: f.plotAreaMax, unit: 'm²', onChange: (a, b) => ((f.plotAreaMin = a), (f.plotAreaMax = b), changed()) }));
      }
    }
    $('#fPpm').value = f.pricePerM2Max ?? '';
    $('#fPpm').addEventListener('input', (e) => ((f.pricePerM2Max = e.target.value === '' ? null : Number(e.target.value)), changed()));

    // --- section 5: type-specific details
    const checkGroup = (key, items) => `<div class="row">${items.map((x) => `<label class="check-chip"><input type="checkbox" data-group="${key}" value="${x.code}" ${f[key].includes(x.code) ? 'checked' : ''}>${esc(x.label)}</label>`).join('')}</div>`;
    const toggle = (key, label) => `<label class="check-chip"><input type="checkbox" data-bool="${key}" ${f[key] ? 'checked' : ''}>${esc(label)}</label>`;
    const numberField = (key, label, ph = '') => `<label class="field"><span>${esc(label)}</span><input type="number" data-num="${key}" value="${f[key] ?? ''}" placeholder="${esc(ph)}"></label>`;
    const select = (key, label, opts) => `<label class="field"><span>${esc(label)}</span><select data-sel="${key}">${opts.map(([v, l]) => `<option value="${v}" ${f[key] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    function renderDetails() {
      const d = $('#details');
      if (f.propertyType === 'plot') {
        d.innerHTML = `
          <span class="field-label">Rodzaj działki</span>${checkGroup('plotTypes', META.plotTypes)}
          <span class="field-label" style="margin-top:16px">Wymagane media</span>${checkGroup('media', META.media)}
          <label class="switch" style="margin-top:10px"><input type="checkbox" data-bool="mediaAllowRoad" ${f.mediaAllowRoad ? 'checked' : ''}><span class="track"></span><span>Akceptuj „media w drodze” / przy działce</span></label>
          <div class="grid-3" style="margin-top:16px">
            ${select('access', 'Dojazd', [['', 'dowolny'], ['asphalt', 'asfaltowy'], ['paved', 'asfalt lub utwardzony']])}
            ${select('zoning', 'Plan / warunki zabudowy', [['', 'bez znaczenia'], ['any', 'MPZP lub WZ'], ['mpzp', 'tylko MPZP'], ['wz', 'tylko WZ']])}
            ${numberField('minWidth', 'Min. szerokość działki (m)', 'np. 20')}
          </div>
          <div class="row" style="margin-top:12px">${toggle('fenced', 'ogrodzona')}</div>`;
      } else if (f.propertyType === 'house') {
        d.innerHTML = `
          <span class="field-label">Typ zabudowy</span>${checkGroup('houseTypes', META.houseTypes)}
          <span class="field-label" style="margin-top:16px">Stan</span>${checkGroup('houseStates', META.houseStates)}
          <div class="grid-3" style="margin-top:16px">
            ${numberField('roomsMin', 'Pokoje od', 'np. 4')}
            ${numberField('roomsMax', 'Pokoje do', '')}
            ${numberField('buildYearMin', 'Rok budowy od', 'np. 2005')}
          </div>
          <div class="row" style="margin-top:12px">${toggle('garage', 'garaż')}</div>`;
      } else {
        d.innerHTML = `
          <div class="grid-4">
            ${numberField('roomsMin', 'Pokoje od', '')}
            ${numberField('roomsMax', 'Pokoje do', '')}
            ${numberField('floorMin', 'Piętro od (0 = parter)', '')}
            ${numberField('floorMax', 'Piętro do', '')}
          </div>
          <div class="grid-3" style="margin-top:12px">${select('market', 'Rynek', [['', 'dowolny'], ['primary', 'pierwotny'], ['secondary', 'wtórny']])}</div>
          <div class="row" style="margin-top:12px">${toggle('elevator', 'winda')}${toggle('balcony', 'balkon')}${toggle('garden', 'ogród')}${toggle('parking', 'miejsce parkingowe / garaż')}</div>`;
      }
      $$('[data-group]', d).forEach((el) =>
        el.addEventListener('change', () => {
          const key = el.dataset.group;
          f[key] = $$(`[data-group="${key}"]:checked`, d).map((x) => x.value);
          changed();
        })
      );
      $$('[data-bool]', d).forEach((el) => el.addEventListener('change', () => ((f[el.dataset.bool] = el.checked), changed())));
      $$('[data-num]', d).forEach((el) => el.addEventListener('input', () => ((f[el.dataset.num] = el.value === '' ? null : Number(el.value)), changed())));
      $$('[data-sel]', d).forEach((el) => el.addEventListener('change', () => ((f[el.dataset.sel] = el.value), changed())));
    }

    // --- section 6
    $('#fPrivate').checked = !!f.privateOnly;
    $('#fPrivate').addEventListener('change', (e) => ((f.privateOnly = e.target.checked), changed()));
    function kwChips(key, boxSel) {
      const box = $(boxSel);
      box.innerHTML = f[key].map((k, i) => `<span class="chip ${key === 'keywordsExcluded' ? 'bad' : 'ok'}">${esc(k)}<button type="button" data-i="${i}">×</button></span>`).join('');
      $$('button', box).forEach((b) =>
        b.addEventListener('click', () => {
          f[key].splice(Number(b.dataset.i), 1);
          kwChips(key, boxSel);
        })
      );
    }
    const kwInput = (inputSel, key, boxSel) => {
      $(inputSel).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ',') return;
        e.preventDefault();
        const v = e.target.value.trim().replace(/,$/, '');
        if (v && !f[key].includes(v)) f[key].push(v);
        e.target.value = '';
        kwChips(key, boxSel);
      });
    };
    kwInput('#kwReqInput', 'keywordsRequired', '#kwReq');
    kwInput('#kwExInput', 'keywordsExcluded', '#kwEx');
    kwChips('keywordsRequired', '#kwReq');
    kwChips('keywordsExcluded', '#kwEx');
    $('#portalChecks').innerHTML = META.portals.map((p) => `<label class="check-chip"><input type="checkbox" value="${p.id}" ${f.portals[p.id] ? 'checked' : ''}>${pbadge(p.id)} ${esc(p.name)}</label>`).join('');
    $$('#portalChecks input').forEach((el) => el.addEventListener('change', () => ((f.portals[el.value] = el.checked), changed())));
    $('#fThread').value = f.telegramThreadId || '';
    $('#fThread').addEventListener('input', (e) => (f.telegramThreadId = e.target.value.trim()));

    // --- coverage + preview
    const coverage = debounce(async () => {
      try {
        const cov = await api('POST', '/coverage', f);
        const box = $('#coverageOut');
        if (!cov.length) {
          box.innerHTML = 'Brak filtrów szczegółowych — cena, powierzchnia i lokalizacja trafiają do URL-a każdego portalu.';
          return;
        }
        const pids = META.portals.filter((p) => f.portals[p.id]).map((p) => p.id);
        box.innerHTML = `<table class="cov-table"><tr><th></th>${pids.map((p) => `<th>${pbadge(p)}</th>`).join('')}</tr>
          ${cov.map((c) => `<tr><td>${esc(c.label)}</td>${pids.map((p) => `<td><span class="cap ${c.portals[p]}" title="${esc(CAP_LABEL[c.portals[p]])}">${CAP_SHORT[c.portals[p]]}</span></td>`).join('')}</tr>`).join('')}</table>
          <div class="legend">${Object.entries(CAP_LABEL).map(([k, l]) => `<span><span class="cap ${k}">${CAP_SHORT[k]}</span> ${l}</span>`).join('')}</div>
          <p class="small" style="margin:8px 0 0">„Ze strony ogłoszenia” — szczegóły pobierane są tylko dla nowych ofert. Gdy cechy nie da się ustalić, oferta przechodzi z dopiskiem „nie potwierdzono”.</p>`;
      } catch {}
    }, 300);
    function changed() {
      coverage();
    }
    $('#previewBtn').addEventListener('click', async () => {
      const btn = $('#previewBtn');
      const out = $('#previewOut');
      if (!f.locations.length && !f.areas.length) return toast('Dodaj miejscowość albo narysuj obszar.', true);
      btn.disabled = true;
      out.innerHTML = '<p class="small muted"><span class="spinner"></span> Pobieram wyniki z portali…</p>';
      try {
        const r = await api('POST', '/preview', f);
        out.innerHTML = previewSummary(r, true);
      } catch (e) {
        out.innerHTML = `<p class="bad">${esc(e.message)}</p>`;
      }
      btn.disabled = false;
    });

    $('#saveBtn').addEventListener('click', async () => {
      if (!f.locations.length && !f.areas.length) return toast('Dodaj miejscowość albo narysuj obszar.', true);
      const unpicked = f.locations.filter((q) => !f.locationPins.some((p) => p.query === q));
      if (unpicked.length) return toast(`Wybierz z listy, o którą miejscowość chodzi: ${unpicked.join(', ')}`, true);
      if (!Object.values(f.portals).some(Boolean)) return toast('Wybierz co najmniej jeden portal.', true);
      try {
        if (existing) await api('PUT', `/searches/${existing.id}`, f);
        else await api('POST', '/searches', f);
        toast(existing ? 'Zapisano zmiany' : 'Dodano wyszukiwanie — pierwszy przebieg zapisze obecne oferty bez alertów');
        location.hash = '#/';
      } catch (e) {
        toast(e.message, true);
      }
    });

    setType(f.propertyType);
    setTrans(f.transaction);
    renderChips();
    renderAreaTowns();
    afterLayout(() => {
      map.invalidateSize();
      drawMap();
    });
  }

  function previewSummary(r, compact) {
    const total = r.portals.reduce((n, p) => n + p.targets.reduce((m, t) => m + (t.matching || 0), 0), 0);
    let html = `<p style="margin:0 0 10px"><span class="pv-count">${total}</span> <span class="muted">pasujących ofert łącznie (z powtórzeniami między portalami)</span></p>`;
    for (const p of r.portals) {
      const matching = p.targets.reduce((m, t) => m + (t.matching || 0), 0);
      const count = p.targets.reduce((m, t) => m + (t.count || 0), 0);
      const sure = p.targets.flatMap((t) => t.offers || []).filter((o) => !o.reject && !o.unverified?.length).length;
      const errs = p.targets.filter((t) => t.error);
      const bad = p.locations.filter((l) => !l.ok);
      const examples = p.targets.flatMap((t) => t.offers || []).filter((o) => !o.reject).slice(0, compact ? 3 : 12);
      html += `<div class="pv-portal"><div class="row">${pbadge(p.id)}<b>${esc(p.name)}</b><span class="spacer"></span><b>${matching}</b><span class="muted small">/ ${count}</span></div>
        ${matching !== sure ? `<div class="small muted">potwierdzone: ${sure}, do sprawdzenia przy nowych ofertach: ${matching - sure}</div>` : ''}
        ${bad.map((l) => `<div class="small bad">✕ ${esc(l.query)}: ${esc(l.error)}</div>`).join('')}
        ${errs.map((t) => `<div class="small bad">${esc(t.label)}: ${esc(t.error)}</div>`).join('')}
        ${p.error && !p.targets.length ? `<div class="small bad">${esc(p.error)}</div>` : ''}
        ${p.targets.map((t) => `<div class="small"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.label)} ↗</a> ${t.method ? `<span class="muted">· ${esc(t.method)}</span>` : ''}</div>`).join('')}
        <div class="pv-examples">${examples
          .map(
            (o) => `<a class="pv-ex" href="${esc(o.url)}" target="_blank" rel="noopener">${o.image ? `<img src="${esc(o.image)}" alt="">` : ''}<span><b>${money(o.price)}</b> · ${num(o.area)} m²<br><span class="muted">${esc(String(o.title).slice(0, 60))}</span>${o.unverified?.length ? `<br><span class="warn">❔ ${esc(o.unverified.join(', '))}</span>` : ''}</span></a>`
          )
          .join('')}</div></div>`;
    }
    return html;
  }

  // ---------- full preview of a saved search ----------
  async function pagePreview(app, id) {
    const alive = pageGuard();
    await refreshState();
    alive();
    const s = STATE.searches.find((x) => x.id === id);
    if (!s) throw new Error('Nie ma takiego wyszukiwania');
    app.innerHTML = `<div class="page-head"><h1>Podgląd: ${esc(s.name)}</h1><span class="spacer"></span><a class="btn" href="#/search/${esc(id)}">Edytuj</a></div>
      <div class="card" style="margin-bottom:16px"><div class="chips">${filterChips(s)}</div><p class="small muted" style="margin:10px 0 0">Aktualne wyniki z portali. Nic nie jest zapisywane, alerty nie są wysyłane. ✓ pasuje, ✕ odrzucona (z powodem).</p></div>
      <div id="pvOut"><div class="card"><span class="spinner"></span> Pobieram wyniki z portali (z odstępami między zapytaniami)…</div></div>`;
    const r = await api('POST', `/searches/${id}/preview`);
    alive(); // the preview takes up to a minute; the user may have left meanwhile
    $('#pvOut').innerHTML = r.portals
      .map((p) => {
        const bad = p.locations.filter((l) => !l.ok);
        return `<div class="card" style="margin-bottom:16px"><div class="row" style="margin-bottom:8px">${pbadge(p.id)}<h2 style="margin:0">${esc(p.name)}</h2></div>
        ${bad.map((l) => `<span class="chip bad">✕ ${esc(l.query)}: ${esc(l.error)}</span> `).join('')}
        ${p.error && !p.targets.length ? `<p class="bad">${esc(p.error)}</p>` : ''}
        ${p.targets
          .map(
            (t) => `<h3 style="margin-top:12px"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.label)} ↗</a> <span class="small muted">${t.error ? '' : `${esc(t.method)} · ${t.count} ofert, pasuje ${t.matching}${t.total !== null && t.total !== undefined ? ` · portal: ${t.total}` : ''}`}</span></h3>
          ${t.error ? `<p class="bad">${esc(t.error)}</p>` : !t.offers.length ? '<p class="muted">Brak ofert.</p>' : `<div style="overflow-x:auto"><table class="kv-table"><tr><th></th><th>Oferta</th><th>Cena</th><th>m²</th><th>zł/m²</th><th>Cechy</th></tr>${t.offers
              .map(
                (o) => `<tr><td>${o.reject ? `<span class="bad" title="${esc(o.reject)}">✕</span>` : '<span class="ok">✓</span>'}</td>
              <td><div class="pv-ex">${o.image ? `<img loading="lazy" src="${esc(o.image)}" alt="">` : ''}<span><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a><br><span class="small muted">${esc(o.location)}</span>${o.reject ? `<br><span class="small bad">${esc(o.reject)}</span>` : ''}</span></div></td>
              <td style="white-space:nowrap">${money(o.price)}</td><td>${num(o.area, 2)}${o.plotArea ? `<br><span class="small muted">dz. ${num(o.plotArea)}</span>` : ''}</td><td>${num(o.pricePerM2)}</td>
              <td class="small">${esc((o.features || []).join(' · '))}${o.unverified?.length ? `<br><span class="warn">❔ ${esc(o.unverified.join(', '))}</span>` : ''}</td></tr>`
              )
              .join('')}</table></div>`}`
          )
          .join('')}</div>`;
      })
      .join('');
  }

  // ---------- offers gallery ----------
  let OFFERS = null;
  async function loadOffers() {
    OFFERS = await api('GET', '/offers');
    return OFFERS;
  }
  const offerFilters = () => ({ search: '', portals: [], status: 'active', sort: 'new', q: '', matching: true, dups: false, ...store.get('offer-filters', {}) });

  function filterOffers(list, fl) {
    let out = list.filter((o) => {
      if (fl.search && o.searchId !== fl.search) return false;
      if (fl.portals.length && !fl.portals.includes(o.portal)) return false;
      if (fl.matching && !o.match) return false;
      if (!fl.dups && o.dupOf) return false;
      if (fl.status === 'active' && o.userStatus === 'hidden') return false;
      if (fl.status === 'fav' && o.userStatus !== 'fav') return false;
      if (fl.status === 'hidden' && o.userStatus !== 'hidden') return false;
      if (fl.q) {
        const t = `${o.title} ${o.location} ${o.description} ${(o.features || []).join(' ')}`.toLowerCase();
        if (!t.includes(fl.q.toLowerCase())) return false;
      }
      return true;
    });
    const by = {
      new: (a, b) => b.firstSeen - a.firstSeen,
      priceAsc: (a, b) => (a.price || 9e15) - (b.price || 9e15),
      priceDesc: (a, b) => (b.price || 0) - (a.price || 0),
      ppmAsc: (a, b) => (a.pricePerM2 || 9e15) - (b.pricePerM2 || 9e15),
      areaDesc: (a, b) => (b.area || 0) - (a.area || 0),
    }[fl.sort];
    out = out.sort(by || ((a, b) => b.firstSeen - a.firstSeen));
    return out;
  }

  async function setOfferStatus(o, status) {
    const next = o.userStatus === status ? null : status;
    await api('POST', '/offers/status', { searchId: o.searchId, key: o.key, status: next });
    o.userStatus = next;
    return next;
  }

  async function pageOffers(app, query) {
    const alive = pageGuard();
    await refreshState();
    await loadOffers();
    alive();
    const fl = offerFilters();
    if (query.get('search')) fl.search = query.get('search');
    app.innerHTML = `
      <div class="page-head"><h1>Oferty</h1><span class="muted" id="offerCount"></span></div>
      <div class="toolbar">
        <select id="flSearch"><option value="">Wszystkie wyszukiwania</option>${STATE.searches.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
        <select id="flStatus"><option value="active">Aktywne</option><option value="fav">★ Ulubione</option><option value="hidden">Odrzucone</option><option value="all">Wszystkie</option></select>
        <select id="flSort"><option value="new">Najnowsze</option><option value="priceAsc">Cena rosnąco</option><option value="priceDesc">Cena malejąco</option><option value="ppmAsc">zł/m² rosnąco</option><option value="areaDesc">Największe</option></select>
        <input type="search" id="flQ" placeholder="Szukaj w tytule, opisie, cechach…">
        <div class="row" id="flPortals">${META.portals.map((p) => `<label class="check-chip"><input type="checkbox" value="${p.id}" ${fl.portals.includes(p.id) ? 'checked' : ''}>${pbadge(p.id)}</label>`).join('')}</div>
        <label class="check-chip"><input type="checkbox" id="flMatching" ${fl.matching ? 'checked' : ''}>tylko pasujące</label>
        <label class="check-chip"><input type="checkbox" id="flDups" ${fl.dups ? 'checked' : ''}>pokaż duplikaty</label>
      </div>
      <div id="gallery" class="gallery"></div>`;
    $('#flSearch').value = fl.search;
    $('#flStatus').value = fl.status;
    $('#flSort').value = fl.sort;
    $('#flQ').value = fl.q;
    const apply = () => {
      fl.search = $('#flSearch').value;
      fl.status = $('#flStatus').value;
      fl.sort = $('#flSort').value;
      fl.q = $('#flQ').value.trim();
      fl.portals = $$('#flPortals input:checked').map((x) => x.value);
      fl.matching = $('#flMatching').checked;
      fl.dups = $('#flDups').checked;
      store.set('offer-filters', { ...fl, search: '' });
      renderGallery(fl);
    };
    $$('.toolbar select, .toolbar input[type=checkbox]').forEach((el) => el.addEventListener('change', apply));
    $('#flQ').addEventListener('input', debounce(apply, 200));
    renderGallery(fl);
  }

  function offerCard(o) {
    // "New" = published in the last 48 h (or, without a date, found in the last 24 h after the first run).
    const isNew = o.createdAt ? Date.now() - new Date(o.createdAt).getTime() < 48 * 3600 * 1000 : o.alerted && Date.now() - o.firstSeen < 24 * 3600 * 1000;
    const added = o.createdAt ? `dodana ${ago(o.createdAt)}` : `wykryta ${ago(o.firstSeen)}`;
    return `<article class="o-card ${o.userStatus === 'hidden' ? 'hiddenStatus' : ''}" data-key="${esc(o.searchId)}|${esc(o.key)}">
      <div class="o-img">${o.image ? `<a href="${esc(o.url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(o.image)}" alt=""></a>` : ''}
        <div class="o-tags">${isNew ? '<span class="o-new">NOWA</span>' : ''}${o.alerted ? '<span class="o-new" style="background:#16a34a">alert</span>' : ''}</div>
        <div class="o-actions"><button class="icon-btn o-fav ${o.userStatus === 'fav' ? 'on' : ''}" title="Ulubione">${ICON.star}</button><button class="icon-btn o-hide ${o.userStatus === 'hidden' ? 'off-on' : ''}" title="${o.userStatus === 'hidden' ? 'Przywróć' : 'Odrzuć'}">${ICON.hide}</button></div>
        <span class="o-price">${money(o.price)}</span></div>
      <div class="o-body">
        <a class="o-title" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a>
        <div class="o-meta"><span><b>${num(o.area, 2)}</b> m²</span>${o.plotArea ? `<span>dz. <b>${num(o.plotArea)}</b> m²</span>` : ''}<span><b>${num(o.pricePerM2)}</b> zł/m²</span></div>
        <div class="o-meta">${ICON.pin.replace('class="ic"', 'class="ic" style="width:14px;height:14px"')}<span>${esc(o.location || '—')}</span></div>
        ${o.features?.length ? `<div class="o-feat">${o.features.slice(0, 6).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
        ${o.unverified?.length ? `<div class="small warn">❔ nie potwierdzono: ${esc(o.unverified.join(', '))}</div>` : ''}
        ${!o.match && o.reject ? `<div class="small bad">✕ ${esc(o.reject)}</div>` : ''}
        <div class="o-foot">${pbadge(o.portal)}${(o.alsoOn || []).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" title="także na ${esc(x.portal)}">${pbadge(META.portals.find((p) => p.name === x.portal)?.id || '')}</a>`).join('')}<span>${added}</span><span class="spacer"></span><span title="${esc(o.searchName)}">${esc(String(o.searchName).slice(0, 22))}</span></div>
      </div></article>`;
  }

  function renderGallery(fl) {
    const list = filterOffers(OFFERS, fl);
    $('#offerCount').textContent = `${list.length} z ${OFFERS.length}`;
    const g = $('#gallery');
    if (!list.length) {
      g.innerHTML = `<div class="card empty" style="grid-column:1/-1"><div class="big">🔎</div><p>${OFFERS.length ? 'Brak ofert dla wybranych filtrów.' : 'Jeszcze nic nie znaleziono. Oferty pojawią się po pierwszym sprawdzeniu wyszukiwań.'}</p></div>`;
      return;
    }
    const LIMIT = 300;
    g.innerHTML = list.slice(0, LIMIT).map(offerCard).join('') + (list.length > LIMIT ? `<div class="card empty" style="grid-column:1/-1">Pokazano ${LIMIT} z ${list.length} — zawęź filtry.</div>` : '');
    const find = (el) => {
      const [sid, key] = el.closest('.o-card').dataset.key.split('|');
      return OFFERS.find((o) => o.searchId === sid && o.key === key);
    };
    $$('.o-fav', g).forEach((b) =>
      b.addEventListener('click', async () => {
        const o = find(b);
        try {
          const st = await setOfferStatus(o, 'fav');
          b.classList.toggle('on', st === 'fav');
          toast(st === 'fav' ? 'Dodano do ulubionych' : 'Usunięto z ulubionych');
        } catch (e) {
          toast(e.message, true);
        }
      })
    );
    $$('.o-hide', g).forEach((b) =>
      b.addEventListener('click', async () => {
        const o = find(b);
        try {
          const st = await setOfferStatus(o, 'hidden');
          toast(st === 'hidden' ? 'Odrzucono — nie będzie widoczna w aktywnych' : 'Przywrócono');
          renderGallery(fl);
        } catch (e) {
          toast(e.message, true);
        }
      })
    );
  }

  // ---------- map ----------
  async function pageMap(app, query) {
    const alive = pageGuard();
    await refreshState();
    await loadOffers();
    alive();
    const sel = { search: query.get('search') || '', status: 'active', matching: true, ...store.get('map-filters', {}) };
    app.innerHTML = `
      <div class="page-head"><h1>Mapa ofert</h1><span class="muted" id="mapCount"></span></div>
      <div class="toolbar">
        <select id="mSearch"><option value="">Wszystkie wyszukiwania</option>${STATE.searches.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
        <select id="mStatus"><option value="active">Aktywne</option><option value="fav">★ Ulubione</option><option value="all">Wszystkie</option></select>
        <label class="check-chip"><input type="checkbox" id="mMatching" ${sel.matching ? 'checked' : ''}>tylko pasujące</label>
      </div>
      <div id="bigMap" class="map-page"></div>
      <div class="map-legend"><span><span class="pin" style="display:inline-block;width:14px;height:14px;border-width:2px;vertical-align:middle"></span> dokładne położenie</span><span><span class="pin approx" style="display:inline-block;width:14px;height:14px;border-width:2px;vertical-align:middle"></span> przybliżone (miejscowość / okolica)</span><span><span class="pin fav" style="display:inline-block;width:14px;height:14px;border-width:2px;vertical-align:middle"></span> ulubione</span></div>`;
    $('#mSearch').value = sel.search;
    $('#mStatus').value = sel.status;
    const map = makeMap($('#bigMap'), { zoom: 11 });
    const layer = L.layerGroup().addTo(map);
    const draw = (fit) => {
      layer.clearLayers();
      // outlines of the drawn areas of the selected search(es)
      for (const s of STATE.searches.filter((x) => !sel.search || x.id === sel.search)) {
        for (const a of s.areas || []) {
          const st = { color: '#6366f1', weight: 2, dashArray: '6 4', fillOpacity: 0.04, interactive: false };
          (a.type === 'circle' ? L.circle(a.center, { radius: a.radius, ...st }) : L.polygon(a.points, st)).addTo(layer);
        }
      }
      const list = filterOffers(OFFERS, { search: sel.search, portals: [], status: sel.status, sort: 'new', q: '', matching: sel.matching, dups: false }).filter((o) => o.lat !== null && o.lon !== null);
      // Offers placed at the same town centre are fanned out so each pin stays clickable.
      const groups = new Map();
      for (const o of list) {
        const k = `${o.lat.toFixed(4)},${o.lon.toFixed(4)}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(o);
      }
      const pts = [];
      for (const g of groups.values()) {
        g.forEach((o, i) => {
          let { lat, lon } = o;
          if (g.length > 1) {
            const ang = i * 2.39996;
            const r = 0.0012 * Math.sqrt(i + 1);
            lat += r * Math.cos(ang);
            lon += (r * Math.sin(ang)) / Math.cos((lat * Math.PI) / 180);
          }
          pts.push([lat, lon]);
          const cls = o.userStatus === 'fav' ? 'fav' : o.exactCoords ? '' : 'approx';
          L.marker([lat, lon], { icon: pinIcon(cls) })
            .bindPopup(
              `<div class="map-pop">${o.image ? `<img src="${esc(o.image)}" alt="">` : ''}<b>${money(o.price)}</b> · ${num(o.area)} m² · ${num(o.pricePerM2)} zł/m²<br><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a><br><span class="small muted">${esc(o.location)} · ${esc(o.portalName)}${o.exactCoords ? '' : ' · położenie przybliżone'}</span>${o.features?.length ? `<br><span class="small">${esc(o.features.slice(0, 4).join(' · '))}</span>` : ''}</div>`
            )
            .addTo(layer);
        });
      }
      $('#mapCount').textContent = `${pts.length} ofert z położeniem`;
      if (fit && pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 14 });
    };
    const apply = () => {
      sel.search = $('#mSearch').value;
      sel.status = $('#mStatus').value;
      sel.matching = $('#mMatching').checked;
      store.set('map-filters', { ...sel, search: '' });
      draw(true);
    };
    $$('.toolbar select, .toolbar input').forEach((el) => el.addEventListener('change', apply));
    afterLayout(() => {
      map.invalidateSize();
      draw(true);
    });
  }

  // ---------- single offer (opened from a system notification) ----------
  async function pageOffer(app, searchId, key) {
    const alive = pageGuard();
    await refreshState();
    await loadOffers();
    alive();
    const o = OFFERS.find((x) => x.searchId === searchId && x.key === key);
    if (!o) {
      app.innerHTML = '<div class="card empty"><div class="big">🔎</div><p>Tej oferty nie ma już w zapisanych (mogła zostać usunięta razem z wyszukiwaniem).</p><a class="btn" href="#/offers">Wszystkie oferty</a></div>';
      return;
    }
    app.innerHTML = `
      <div class="page-head"><a class="btn btn-ghost" href="#/offers">← Oferty</a><span class="spacer"></span>
        <button class="btn o-fav ${o.userStatus === 'fav' ? 'on' : ''}" id="ofFav">${ICON.star} Ulubione</button>
        <button class="btn" id="ofHide">${o.userStatus === 'hidden' ? 'Przywróć' : 'Odrzuć'}</button>
        <a class="btn btn-primary" href="${esc(o.url)}" target="_blank" rel="noopener">Otwórz na ${esc(o.portalName)} ${ICON.ext}</a></div>
      <div class="offer-detail">
        <div class="card" style="padding:0;overflow:hidden">${o.image ? `<img class="od-img" src="${esc(o.image)}" alt="">` : '<div class="od-img"></div>'}
          <div style="padding:16px 18px">
            <h1 style="margin:0 0 6px">${esc(o.title)}</h1>
            <div class="o-meta" style="font-size:15px"><b style="font-size:22px">${money(o.price)}</b><span><b>${num(o.area, 2)}</b> m²</span>${o.plotArea ? `<span>działka <b>${num(o.plotArea)}</b> m²</span>` : ''}<span><b>${num(o.pricePerM2)}</b> zł/m²</span></div>
            <div class="o-meta" style="margin-top:6px">${ICON.pin.replace('class="ic"', 'class="ic" style="width:15px;height:15px"')}<span>${esc(o.location || '—')}</span></div>
            ${o.features?.length ? `<div class="o-feat" style="margin-top:10px">${o.features.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
            ${o.unverified?.length ? `<p class="small warn">❔ nie potwierdzono: ${esc(o.unverified.join(', '))}</p>` : ''}
            ${!o.match && o.reject ? `<p class="small bad">✕ nie spełnia kryteriów: ${esc(o.reject)}</p>` : ''}
            ${o.description ? `<p class="muted" style="margin-top:12px">${esc(o.description)}${o.description.length >= 499 ? '…' : ''}</p>` : ''}
            <p class="small muted">${pbadge(o.portal)} ${(o.alsoOn || []).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">także na ${esc(x.portal)}</a>`).join(' · ')}
              · ${o.createdAt ? `dodana ${ago(o.createdAt)}` : `wykryta ${ago(o.firstSeen)}`} · wyszukiwanie: ${esc(o.searchName)}</p>
          </div></div>
        <div class="card" style="padding:0;overflow:hidden">${o.lat !== null && o.lat !== undefined ? '<div id="offerMap" class="od-map"></div>' : '<div class="empty">Brak położenia na mapie.</div>'}
          ${o.lat !== null && o.lat !== undefined && !o.exactCoords ? '<p class="small muted" style="padding:0 14px">Położenie przybliżone (środek miejscowości / okolica).</p>' : ''}</div>
      </div>`;
    $('#ofFav').addEventListener('click', async () => {
      const st = await setOfferStatus(o, 'fav');
      $('#ofFav').classList.toggle('on', st === 'fav');
      toast(st === 'fav' ? 'Dodano do ulubionych' : 'Usunięto z ulubionych');
    });
    $('#ofHide').addEventListener('click', async () => {
      const st = await setOfferStatus(o, 'hidden');
      $('#ofHide').textContent = st === 'hidden' ? 'Przywróć' : 'Odrzuć';
      toast(st === 'hidden' ? 'Odrzucono' : 'Przywrócono');
    });
    if (o.lat !== null && o.lat !== undefined) {
      const map = makeMap($('#offerMap'), { zoom: 14 });
      map.setView([o.lat, o.lon], o.exactCoords ? 15 : 13);
      L.marker([o.lat, o.lon], { icon: pinIcon(o.exactCoords ? '' : 'approx') }).addTo(map);
      const s = STATE.searches.find((x) => x.id === o.searchId);
      for (const a of s?.areas || []) {
        const st = { color: '#6366f1', weight: 2, dashArray: '6 4', fillOpacity: 0.04, interactive: false };
        (a.type === 'circle' ? L.circle(a.center, { radius: a.radius, ...st }) : L.polygon(a.points, st)).addTo(map);
      }
      afterLayout(() => map.invalidateSize());
    }
  }

  // ---------- alerts ----------
  async function pageAlerts(app) {
    const alive = pageGuard();
    const alerts = await api('GET', '/alerts');
    alive();
    app.innerHTML = `<div class="page-head"><h1>Ostatnie alerty</h1><span class="muted">${alerts.length}</span></div>
      ${alerts.length ? `<div class="list">${alerts
        .map(
          (a) => `<div class="a-row">${a.image ? `<img loading="lazy" src="${esc(a.image)}" alt="">` : '<div style="width:96px"></div>'}
          <div style="flex:1;min-width:0"><a href="${esc(a.url)}" target="_blank" rel="noopener"><b>${esc(a.title)}</b></a>
            <div class="o-meta"><b>${money(a.price)}</b><span>${num(a.area, 2)} m²</span><span>${num(a.pricePerM2)} zł/m²</span><span>${esc(a.location || '')}</span></div>
            ${a.features?.length ? `<div class="o-feat" style="margin-top:4px">${a.features.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
            <div class="small muted" style="margin-top:4px">${new Date(a.at).toLocaleString('pl-PL')} · ${esc(a.portal)}${a.alsoOn?.length ? ` (także: ${esc(a.alsoOn.join(', '))})` : ''} · ${esc(a.searchName)} · ${[a.sent ? '<span class="ok">wysłano na Telegram</span>' : '', a.notified ? '<span class="ok">powiadomienie systemowe</span>' : '', a.error ? `<span class="bad">${esc(a.error)}</span>` : '', !a.sent && !a.notified && !a.error ? '<span class="bad">nie wysłano</span>' : ''].filter(Boolean).join(' · ')}${a.key ? ` · <a href="#/offer/${encodeURIComponent(a.searchId)}/${encodeURIComponent(a.key)}">szczegóły</a>` : ''}</div></div></div>`
        )
        .join('')}</div>` : '<div class="card empty"><div class="big">🔔</div><p>Jeszcze nie było alertów. Pierwszy przebieg nowego wyszukiwania tylko zapisuje obecne oferty.</p></div>'}`;
  }

  // ---------- settings ----------
  async function pageSettings(app) {
    const alive = pageGuard();
    const s = await api('GET', '/settings');
    alive();
    app.innerHTML = `<div class="page-head"><h1>Ustawienia</h1></div>
      ${META.desktop ? `<div class="card section"><h2>Aplikacja</h2>
        <p class="small muted">Oferty są sprawdzane, gdy aplikacja działa. O nowych ofertach informują powiadomienia systemowe — kliknięcie otwiera ofertę w aplikacji.</p>
        <label class="switch" style="margin:6px 0 10px"><input type="checkbox" id="dBg"><span class="track"></span><span>Działaj w tle — po zamknięciu okna aplikacja zostaje w ${/Mac/.test(navigator.platform) ? 'pasku menu' : 'zasobniku systemowym (obok zegara)'} i dalej sprawdza oferty</span></label>
        <label class="switch" style="margin-bottom:10px"><input type="checkbox" id="dAuto"><span class="track"></span><span>Uruchamiaj automatycznie po zalogowaniu (w tle)</span></label>
        <div class="row"><button class="btn btn-sm" id="dTest">Wyślij testowe powiadomienie</button><span class="small" id="dTestOut"></span></div>
        <p class="small muted" id="dInfo"></p></div>` : ''}
      <div class="card section"><h2>Telegram</h2>
        <label class="switch" style="margin-bottom:10px"><input type="checkbox" id="sTgOn" ${s.telegram.enabled !== false ? 'checked' : ''}><span class="track"></span><span>Wysyłaj alerty na Telegram</span></label>
        ${META.desktop ? '<div class="notice small" id="tgWarn">⚠️ Uwaga: alerty pójdą do grupy Telegram wskazanej poniżej, z tego komputera. Jeśli kilka osób ustawi ten sam bot i tę samą grupę, każda oferta przyjdzie kilka razy (raz z każdego komputera). Token bota daje pełną kontrolę nad botem — nie wysyłaj go nikomu. Zwykle wystarczą powiadomienia systemowe.</div>' : ''}
        <div id="tgFields">
        <p class="small muted">Token od @BotFather, Chat ID grupy (np. -100…), Thread ID = numer wątku (tematu). Ostrzeżenia techniczne mogą iść do osobnego wątku.</p>
        <div class="grid-2"><label class="field"><span>Token bota</span><input type="password" id="sToken" autocomplete="off" placeholder="${s.telegram.botToken ? '•••••• zapisany — zostaw puste, by nie zmieniać' : '123456:ABC…'}"></label>
        <label class="field"><span>Chat ID</span><input type="text" id="sChat" value="${esc(s.telegram.chatId)}"></label>
        <label class="field"><span>Thread ID (alerty)</span><input type="text" id="sThread" value="${esc(s.telegram.threadId)}"></label>
        <label class="field"><span>Thread ID (ostrzeżenia)</span><input type="text" id="sWarn" value="${esc(s.telegram.warnThreadId)}"></label></div>
        <div class="row" style="margin-top:12px"><button class="btn" id="sTest">Wyślij wiadomość testową</button></div></div></div>
      <div class="card section"><h2>Harmonogram</h2>
        <div class="grid-4"><label class="field"><span>Co ile minut</span><input type="number" min="1" id="sInt" value="${s.intervalMinutes}"></label>
        <label class="field"><span>Rozrzut ±%</span><input type="number" min="0" max="90" id="sJit" value="${s.jitterPercent}"></label>
        <label class="field"><span>Odstęp zapytań min (s)</span><input type="number" min="1" id="sD1" value="${s.requestDelaySec[0]}"></label>
        <label class="field"><span>…max (s)</span><input type="number" min="1" id="sD2" value="${s.requestDelaySec[1]}"></label>
        <label class="field"><span>Ostrzeż po N× 0 ofert</span><input type="number" min="1" id="sZero" value="${s.zeroOffersWarnAfter}"></label>
        <label class="field"><span>Ostrzeż po N× błędzie</span><input type="number" min="1" id="sErr" value="${s.errorWarnAfter}"></label>
        <label class="field"><span>Maks. alertów na przebieg</span><input type="number" min="1" id="sMax" value="${s.maxAlertsPerRun}"></label></div></div>
      <div class="card section"><h2>Mapa</h2>
        <p class="small muted">Darmowy klucz CARTO: <a href="https://carto.com/basemaps/apikey" target="_blank" rel="noopener">carto.com/basemaps/apikey</a> (bez konta, przychodzi e-mailem). Z kluczem domyślnym podkładem jest mapa CARTO (jasna lub ciemna zgodnie z motywem); bez klucza — mapa topograficzna z Geoportalu. Ortofotomapa i OpenStreetMap są zawsze do wyboru (prawy górny róg mapy).</p>
        <div class="grid-2"><label class="field"><span>Klucz CARTO</span><input type="text" id="sCarto" value="${esc(s.map?.cartoKey || '')}" autocomplete="off" spellcheck="false" placeholder="brak — podkładem jest mapa topograficzna"></label></div></div>
      <div class="card section ${META.desktop ? 'hidden' : ''}"><h2>Panel</h2>
        <div class="grid-2"><label class="field"><span>Użytkownik</span><input type="text" id="sUser" value="${esc(s.panel.user)}"></label>
        <label class="field"><span>Nowe hasło (puste = bez zmian)</span><input type="password" id="sPass" autocomplete="new-password"></label></div></div>
      <button class="btn btn-primary" id="sSave">Zapisz ustawienia</button>`;
    const tgOn = $('#sTgOn');
    const showTg = () => {
      $('#tgFields').classList.toggle('hidden', !tgOn.checked);
      $('#tgWarn')?.classList.toggle('hidden', !tgOn.checked);
    };
    tgOn.addEventListener('change', () => {
      if (tgOn.checked && META.desktop && !confirm('Włączyć wysyłanie alertów na Telegram z tego komputera? Przeczytaj ostrzeżenie pod przełącznikiem.')) tgOn.checked = false;
      showTg();
    });
    showTg();
    if (META.desktop) {
      const d = await api('GET', '/desktop');
      alive();
      $('#dBg').checked = !!d.runInBackground;
      $('#dAuto').checked = !!d.autostart;
      $('#dInfo').textContent = `Wersja ${d.version} · dane: ${d.dataDir}`;
      const saveDesktop = async () => {
        try {
          const r = await api('PUT', '/desktop', { runInBackground: $('#dBg').checked, autostart: $('#dAuto').checked });
          $('#dBg').checked = !!r.runInBackground;
          $('#dAuto').checked = !!r.autostart;
          toast('Zapisano ustawienia aplikacji');
        } catch (e) {
          toast(e.message, true);
        }
      };
      $('#dTest').addEventListener('click', async () => {
        const r = await api('POST', '/desktop/test-notification');
        $('#dTestOut').innerHTML = r.notificationsBlocked ? `<span class="bad">${notifBlockedText()}</span>` : '<span class="ok">Wysłano — powinno pojawić się w rogu ekranu.</span>';
      });
      $('#dBg').addEventListener('change', saveDesktop);
      $('#dAuto').addEventListener('change', saveDesktop);
    }
    $('#sSave').addEventListener('click', async () => {
      try {
        await api('PUT', '/settings', {
          telegram: { enabled: tgOn.checked, botToken: $('#sToken').value, chatId: $('#sChat').value, threadId: $('#sThread').value, warnThreadId: $('#sWarn').value },
          intervalMinutes: $('#sInt').value,
          jitterPercent: $('#sJit').value,
          requestDelaySec: [$('#sD1').value, $('#sD2').value],
          zeroOffersWarnAfter: $('#sZero').value,
          errorWarnAfter: $('#sErr').value,
          maxAlertsPerRun: $('#sMax').value,
          panel: { user: $('#sUser').value, password: $('#sPass').value },
          map: { cartoKey: $('#sCarto').value },
        });
        META.cartoKey = $('#sCarto').value.trim();
        toast('Zapisano ustawienia');
        if ($('#sPass').value) toast('Zapisano. Nowe hasło obowiązuje przy następnym logowaniu.');
      } catch (e) {
        toast(e.message, true);
      }
    });
    $('#sTest').addEventListener('click', async () => {
      try {
        await api('POST', '/settings/test');
        toast('Wysłano wiadomość testową');
      } catch (e) {
        toast(`Nie udało się wysłać: ${e.message}`, true);
      }
    });
  }

  route();
})();
