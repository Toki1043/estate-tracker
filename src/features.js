'use strict';

// Offer features: built from structured portal data, "Label: value" pairs from offer pages
// and, as a last resort, from the description. Then checked against the search criteria.

const { norm } = require('./util');
const { PLOT_TYPES, MEDIA, HOUSE_TYPES, HOUSE_STATES, activeFilters, capability } = require('./criteria');

const MEDIA_RE = {
  electricity: /\b(prad\w*|energi\w* elektryczn\w*|przylacz\w* energetyczn\w*|skrzynk\w* energetyczn\w*|elektrycznosc\w*)\b/g,
  water: /\b(woda|wody|wode|wodociag\w*|wodna|przylacz\w* wodn\w*)\b/g,
  sewage: /\b(kanalizac\w*)\b/g,
  gas: /\b(gaz|gazu|gazem|gazowa|gazowy|gazociag\w*)\b/g,
};
const ALL_MEDIA = MEDIA.map((m) => m.code);
// "pradnik" (Prądnik Biały, a Kraków district) must not count as electricity.
const MEDIA_FALSE = /\bpradnik\w*/g;

const ROAD = /(w drodze|w ulicy|przy dzialce|przy granicy|na granicy|w poblizu|w sasiedztwie|obok dzialki|w odleglosci|\d+\s*m od|mozliwosc (pod|przy)lacz\w*|do doprowadzenia|na dzialce sasiedniej|sasiedni\w*|w zasiegu)/;
const EXPLICIT_YES = /(na dzialce|na terenie dzialki|przylaczon\w*|podlaczon\w*|\bjest\b|\btak\b|doprowadzon\w*)/;
const NEG_BEFORE = /\b(brak|bez|nie ma|nie posiada|brakuje)\b(\s+\w+){0,2}\s*$/;

function mediaFromText(t) {
  const out = {};
  const rank = { yes_explicit: 4, road: 3, no: 2, yes: 1 };
  const clean = t.replace(MEDIA_FALSE, ' ');
  const hits = [];
  for (const [code, re] of Object.entries(MEDIA_RE)) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean))) hits.push({ code, i: m.index, end: m.index + m[0].length });
  }
  hits.sort((a, b) => a.i - b.i);
  hits.forEach((h, k) => {
    // Context windows stop at the neighbouring media word: "brak gazu, woda" must not negate water.
    const prevEnd = k > 0 ? hits[k - 1].end : 0;
    const before = clean.slice(Math.max(prevEnd, h.i - 28), h.i);
    const nextStart = hits[k + 1] ? hits[k + 1].i : h.end + 50;
    const after = clean.slice(h.end, Math.min(h.end + 50, nextStart));
    let st = 'yes';
    if (NEG_BEFORE.test(before) || /^\s*(brak|nie)\b/.test(after)) st = 'no';
    else if (ROAD.test(after) || /(w drodze|w ulicy)\s*$/.test(before)) st = 'road';
    else if (EXPLICIT_YES.test(after.slice(0, 25))) st = 'yes_explicit';
    if (!out[h.code] || rank[st] > rank[out[h.code]]) out[h.code] = st;
  });
  for (const k of Object.keys(out)) if (out[k] === 'yes_explicit') out[k] = 'yes';
  // Global statements fill the media that were not mentioned one by one.
  let global = null;
  if (/\b(nieuzbrojon\w*|brak mediow|bez mediow|brak uzbrojenia)\b/.test(clean)) global = 'no';
  else if (/\bmedia (sa )?(w drodze|w ulicy|przy dzialce|w poblizu|na granicy)\b/.test(clean)) global = 'road';
  else if (/\b(pelne media|wszystkie media|pelne uzbrojenie|uzbrojon\w*|dzialka uzbrojona|media na dzialce)\b/.test(clean)) global = 'yes';
  if (global) for (const c of ALL_MEDIA) if (!out[c]) out[c] = global;
  if (!out.sewage && /\bszamb\w*/.test(clean)) out.sewage = 'no';
  return out;
}

function plotTypeCode(text) {
  const t = norm(text);
  if (!t) return null;
  if (/rolno\s*budowl/.test(t)) return 'agri_building';
  if (/budowl|pod zabudowe|mieszkaniow|^plot$|dzialki budowlane/.test(t)) return 'building';
  if (/siedli/.test(t)) return 'habitat';
  if (/rekreac|letnisk/.test(t)) return 'recreational';
  if (/inwestyc|uslug|przemysl|komercyj|handlow/.test(t)) return 'investment';
  if (/\bles|lesn/.test(t)) return 'forest';
  if (/\broln/.test(t)) return 'agricultural';
  return null;
}

function houseTypeCode(text) {
  const t = norm(text);
  if (/blizniak|blizniacz|polowa blizniaka|semi detached/.test(t)) return 'semi';
  if (/szeregow|segment|ribbon|attached houses/.test(t)) return 'terraced';
  if (/wolnostoj|detached/.test(t)) return 'detached';
  return null;
}

function stateCode(text) {
  const t = norm(text);
  if (/stan\w* surow|surowy (otwarty|zamkniety)/.test(t)) return 'raw';
  if (/do remontu|do odswiezenia|to renovation/.test(t)) return 'renovate';
  if (/do wykonczenia|deweloperski|to completion/.test(t)) return 'to_finish';
  if (/do zamieszkania|pod klucz|wykonczon|ready to use|gotow\w* do wprowadzenia/.test(t)) return 'ready';
  return null;
}

const yesNo = (v) => {
  const t = norm(v);
  if (!t) return undefined;
  if (/^(tak|jest|yes|y|1|true)\b/.test(t)) return true;
  if (/^(nie|brak|no|n|0|false)\b/.test(t)) return false;
  return undefined;
};

/** Structured "Label: value" pairs (from an offer page) -> features. */
function fromKv(kv) {
  const f = {};
  for (const line of kv || []) {
    const m = String(line).match(/^\s*([^:]{2,40}):\s*(.+)$/);
    if (!m) continue;
    const label = norm(m[1]);
    const value = m[2].trim();
    const v = norm(value);
    if (/^media|^uzbrojenie|^media i instalacje/.test(label)) {
      f.media = { ...(f.media || {}), ...mediaFromText(v) };
    } else if (/^(prad|energia elektryczna|woda|wodociag|gaz|kanalizacja)$/.test(label)) {
      // one medium per line: "Prąd: jest", "Kanalizacja: brak"
      f.media = { ...(f.media || {}), ...mediaFromText(`${/^brak|^nie\b/.test(v) ? 'brak ' : ''}${label} ${v}`) };
    } else if (/^(rodzaj|typ) dzialki|^przeznaczenie/.test(label)) {
      f.plotType = f.plotType || plotTypeCode(value);
    } else if (/^dojazd/.test(label)) {
      if (/asfalt/.test(v)) f.access = 'asphalt';
      else if (/utwardzon|kostk|beton|tluczen/.test(v) && !/nieutwardzon/.test(v)) f.access = 'paved';
      else if (/gruntow|nieutwardzon|polna|szutr/.test(v)) f.access = 'dirt';
    } else if (/^ogrodzeni/.test(label)) {
      f.fenced = /brak|^nie\b|^n$/.test(v) ? false : yesNo(v) ?? (v ? true : undefined);
    } else if (/^szerokosc/.test(label)) {
      const n = parseFloat(v.replace(',', '.'));
      if (n) f.width = n;
    } else if (/^(stan|stan wykonczenia|stan budynku)/.test(label)) {
      f.houseState = f.houseState || stateCode(value);
    } else if (/^(rodzaj|typ) (zabudowy|domu|budynku)/.test(label)) {
      f.houseType = f.houseType || houseTypeCode(value);
    } else if (/^rok budowy/.test(label)) {
      const y = parseInt(v, 10);
      if (y > 1800 && y < 2100) f.buildYear = y;
    } else if (/^liczba pokoi|^pokoje/.test(label)) {
      const n = parseInt(v, 10);
      if (n) f.rooms = n;
    } else if (/^pietro/.test(label)) {
      f.floor = /parter/.test(v) ? 0 : parseInt(v, 10);
      if (!Number.isFinite(f.floor)) delete f.floor;
    } else if (/^rynek/.test(label)) {
      f.market = /pierwot/.test(v) ? 'primary' : /wtorn/.test(v) ? 'secondary' : f.market;
    } else if (/^winda/.test(label)) {
      f.elevator = yesNo(v);
    } else if (/^garaz/.test(label)) {
      f.garage = yesNo(v) ?? true;
    } else if (/^(warunki zabudowy|plan zagospodarowania|mpzp)/.test(label)) {
      f.zoning = { ...(f.zoning || {}) };
      if (/mpzp|plan/.test(v)) f.zoning.mpzp = true;
      if (/\bwz\b|warunk/.test(v)) f.zoning.wz = true;
      if (/^brak|^nie/.test(v)) Object.assign(f.zoning, { mpzp: f.zoning.mpzp ?? false });
    } else if (/^(typ ogloszeniodawcy|ogloszeniodawca)/.test(label)) {
      f.private = /prywat|osoba/.test(v) ? true : /biuro|agencj|deweloper|firma/.test(v) ? false : undefined;
    }
  }
  return f;
}

/** Free text (title + description) -> features. Only fills what the text clearly says. */
function fromText(text) {
  const t = norm(text);
  const f = {};
  const media = mediaFromText(t);
  if (Object.keys(media).length) f.media = media;

  const zoning = {};
  if (/\b(mpzp|miejscow\w* plan\w*|plan\w* miejscow\w*|planie zagospodarowania|plan zagospodarowania)\b/.test(t)) zoning.mpzp = true;
  if (/\b(brak|bez) (mpzp|planu)/.test(t)) zoning.mpzp = false;
  // "Warunki zabudowy: MPZP" is a form field saying the plot is covered by the local plan, not a WZ decision.
  if (/\b(wz|warunki zabudowy|warunkami zabudowy|warunkow zabudowy|decyzj\w* o warunkach)\b(?!\s+(mpzp|plan|miejscow|brak))/.test(t)) zoning.wz = true;
  if (/\b(brak|bez) (wz|warunkow zabudowy)/.test(t)) zoning.wz = false;
  if (Object.keys(zoning).length) f.zoning = zoning;

  if (/\basfalt\w*/.test(t)) f.access = 'asphalt';
  else if (/\b(droga|dojazd\w*) (jest )?(utwardzon\w*|z kostki|betonow\w*)|\butwardzon\w* drog/.test(t)) f.access = 'paved';
  else if (/\b(droga|dojazd\w*) (gruntow\w*|nieutwardzon\w*|polna)/.test(t)) f.access = 'dirt';

  if (/\b(nieogrodzon\w*|brak ogrodzenia|ogrodzenie (dzialki )?brak|bez ogrodzenia)\b/.test(t)) f.fenced = false;
  else if (/\b(ogrodzon\w*|w pelni ogrodz\w*)\b/.test(t)) f.fenced = true;

  const w = t.match(/\bszerokos\w*(?: dzialki| frontu)?\s*(?:ok\s*)?(\d+(?:[.,]\d+)?)\s*m\b/) || t.match(/\bfront\w* (?:dzialki )?(?:ok\s*)?(\d+(?:[.,]\d+)?)\s*m\b/);
  if (w) f.width = parseFloat(w[1].replace(',', '.'));

  const pt = plotTypeCode(t.match(/dzialk\w* (rolno budowlan\w*|budowlan\w*|siedliskow\w*|rekreacyjn\w*|inwestycyjn\w*|lesn\w*|roln\w*)/)?.[1] || '');
  if (pt) f.plotType = pt;

  const ht = houseTypeCode(t.match(/\b(blizniak\w*|blizniacz\w*|szeregow\w*|segment\w*|wolnostojac\w*)\b/)?.[0] || '');
  if (ht) f.houseType = ht;
  const st = stateCode(t);
  if (st) f.houseState = st;

  const y = t.match(/\b(?:rok budowy|wybudowan\w*(?: w)?(?: roku)?|zbudowan\w* w|z roku)\s*(\d{4})\b/);
  if (y && +y[1] > 1800 && +y[1] < 2100) f.buildYear = +y[1];
  const r = t.match(/\b(\d{1,2})\s*(?:pokoj\w*|pokoi\w*|pok)\b/);
  if (r && +r[1] > 0 && +r[1] < 20) f.rooms = +r[1];

  if (/\b(bez garazu|brak garazu)\b/.test(t)) f.garage = false;
  else if (/\bgaraz\w*/.test(t)) f.garage = true;
  if (/\b(bez windy|brak windy)\b/.test(t)) f.elevator = false;
  else if (/\b(winda|windy|winde|z winda)\b/.test(t)) f.elevator = true;
  if (/\b(balkon\w*|loggi\w*)\b/.test(t)) f.balcony = true;
  if (/\b(ogrod|ogrodek|ogrodkiem|ogrodem|ogrodu)\b/.test(t)) f.garden = true;
  if (/\b(miejsce parkingowe|miejscem parkingowym|miejsca parkingowego|hala garazow\w*|garaz\w*|miejsce postojowe)\b/.test(t)) f.parking = true;
  if (/\b(rynek pierwotny|od dewelopera|deweloper)\b/.test(t)) f.market = 'primary';
  if (/\b(bez posrednik\w*|bezposrednio od wlasciciela|oferta prywatna|sprzedam bezposrednio)\b/.test(t)) f.private = true;
  return f;
}

/** Merges feature sets; earlier sets win (structured data first, text last). */
function merge(...sets) {
  const out = {};
  for (const s of sets) {
    if (!s) continue;
    for (const [k, v] of Object.entries(s)) {
      if (v === undefined || v === null) continue;
      if (k === 'media' || k === 'zoning') {
        out[k] = { ...v, ...(out[k] || {}) };
      } else if (out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

// Labels that fromKv() reads as structured data; their lines are not scanned again as free text
// ("Warunki zabudowy: MPZP" must not count as WZ).
const KV_HANDLED = /^(media|uzbrojenie|prad|energia elektryczna|woda|wodociag|gaz|kanalizacja|rodzaj dzialki|typ dzialki|przeznaczenie|dojazd|ogrodzeni|szerokosc|stan|rodzaj zabudowy|typ zabudowy|typ domu|rok budowy|liczba pokoi|pietro|rynek|winda|garaz|warunki zabudowy|plan zagospodarowania|mpzp)/;

// Which features make sense for each property type (a plot's zoning text mentions "garaże", "parkingi"...).
const FIELDS_FOR = {
  plot: ['media', 'zoning', 'access', 'fenced', 'width', 'plotType', 'private'],
  house: ['media', 'zoning', 'access', 'houseType', 'houseState', 'buildYear', 'rooms', 'garage', 'parking', 'garden', 'private', 'market'],
  flat: ['rooms', 'floor', 'market', 'elevator', 'balcony', 'garden', 'parking', 'buildYear', 'houseState', 'private'],
};

/** Features of an offer from everything we know about it. */
function compute(o, propertyType) {
  const textLines = (o.kv || []).filter((line) => !KV_HANDLED.test(norm(String(line).split(':')[0])));
  const textF = fromText([o.title, o.description, ...textLines].join(' \n '));
  const structured = merge(o.attrs, fromKv(o.kv));
  if (!structured.plotType && o.kind) structured.plotType = plotTypeCode(o.kind);
  let f = merge(structured, textF);
  const allowed = FIELDS_FOR[propertyType];
  if (allowed) f = Object.fromEntries(Object.entries(f).filter(([k]) => allowed.includes(k)));
  // Remember which values are only guessed from the description (not enumerable: not shown, not saved).
  Object.defineProperty(f, 'textOnly', { value: new Set(Object.keys(f).filter((k) => structured[k] === undefined)), enumerable: false });
  return f;
}

const label = (list, code) => list.find((x) => x.code === code)?.label || code;

/**
 * Detail filters check. Returns { reject: string|null, unverified: [labels] }.
 * Unknown values pass (marked "unverified") unless the portal already applied the filter.
 */
function check(f, s, portalId) {
  const unverified = [];
  const active = activeFilters(s);
  const trust = (filter) => capability(filter, portalId, s) === 'url';
  const unknown = (filter, what) => {
    if (!trust(filter)) unverified.push(what);
  };
  // A value guessed only from the description must not overrule a filter the portal already applied
  // ("garaż wolnostojący" in a semi-detached house ad).
  const guessed = (filter, key) => trust(filter) && f.textOnly?.has(key);

  if (active.privateOnly) {
    if (f.private === false && !guessed('privateOnly', 'private')) return { reject: 'ogłoszenie biura/firmy', unverified };
    if (f.private === undefined) unknown('privateOnly', 'oferta prywatna');
  }
  if (active.plotTypes) {
    if (f.plotType && !s.plotTypes.includes(f.plotType) && !guessed('plotTypes', 'plotType')) return { reject: `działka ${label(PLOT_TYPES, f.plotType)}`, unverified };
    if (!f.plotType) unknown('plotTypes', 'rodzaj działki');
  }
  if (active.media) {
    for (const m of s.media) {
      const st = f.media?.[m];
      const name = label(MEDIA, m);
      if (st === 'no') return { reject: `brak: ${name}`, unverified };
      if (st === 'road' && !s.mediaAllowRoad) return { reject: `${name} tylko w drodze`, unverified };
      if (!st) unknown('media', name);
    }
  }
  if (active.access) {
    if (f.access === 'dirt' || (s.access === 'asphalt' && f.access === 'paved')) return { reject: `dojazd: ${f.access === 'dirt' ? 'gruntowy' : 'utwardzony (nie asfalt)'}`, unverified };
    if (!f.access) unknown('access', 'dojazd');
  }
  if (active.zoning) {
    const z = f.zoning || {};
    const want = s.zoning === 'any' ? ['mpzp', 'wz'] : [s.zoning];
    if (want.some((k) => z[k] === true)) {
      // ok
    } else if (want.every((k) => z[k] === false)) return { reject: `brak ${want.join('/').toUpperCase()}`, unverified };
    else unknown('zoning', want.join(' lub ').toUpperCase());
  }
  if (active.fenced) {
    if (f.fenced === false && !guessed('fenced', 'fenced')) return { reject: 'nieogrodzona', unverified };
    if (f.fenced === undefined) unknown('fenced', 'ogrodzenie');
  }
  if (active.minWidth) {
    if (f.width && f.width < s.minWidth) return { reject: `szerokość ${f.width} m`, unverified };
    if (!f.width) unknown('minWidth', 'szerokość');
  }
  if (active.houseTypes) {
    if (f.houseType && !s.houseTypes.includes(f.houseType) && !guessed('houseTypes', 'houseType')) return { reject: label(HOUSE_TYPES, f.houseType), unverified };
    if (!f.houseType) unknown('houseTypes', 'typ zabudowy');
  }
  if (active.houseStates) {
    if (f.houseState && !s.houseStates.includes(f.houseState)) return { reject: `stan: ${label(HOUSE_STATES, f.houseState)}`, unverified };
    if (!f.houseState) unknown('houseStates', 'stan');
  }
  if (active.rooms) {
    if (f.rooms && ((s.roomsMin && f.rooms < s.roomsMin) || (s.roomsMax && f.rooms > s.roomsMax)) && !guessed('rooms', 'rooms')) return { reject: `${f.rooms} pok.`, unverified };
    if (!f.rooms) unknown('rooms', 'liczba pokoi');
  }
  if (active.buildYearMin) {
    if (f.buildYear && f.buildYear < s.buildYearMin && !guessed('buildYearMin', 'buildYear')) return { reject: `rok budowy ${f.buildYear}`, unverified };
    if (!f.buildYear) unknown('buildYearMin', 'rok budowy');
  }
  if (active.floor) {
    if (Number.isFinite(f.floor) && ((s.floorMin !== null && f.floor < s.floorMin) || (s.floorMax !== null && f.floor > s.floorMax))) return { reject: `piętro ${f.floor}`, unverified };
    if (!Number.isFinite(f.floor)) unknown('floor', 'piętro');
  }
  if (active.market) {
    if (f.market && f.market !== s.market && !guessed('market', 'market')) return { reject: `rynek ${f.market === 'primary' ? 'pierwotny' : 'wtórny'}`, unverified };
    if (!f.market) unknown('market', 'rynek');
  }
  const bools = { garage: 'garaż', elevator: 'winda', balcony: 'balkon', garden: 'ogród', parking: 'miejsce parkingowe' };
  for (const [k, name] of Object.entries(bools)) {
    if (!active[k]) continue;
    if (f[k] === false && !guessed(k, k)) return { reject: `bez: ${name}`, unverified };
    if (f[k] === undefined) unknown(k, name);
  }
  return { reject: null, unverified };
}

/** Short human summary for alerts and cards, e.g. ["prąd", "woda (w drodze)", "MPZP", "bliźniak"]. */
function summary(f) {
  const out = [];
  if (f.plotType) out.push(`działka ${label(PLOT_TYPES, f.plotType)}`);
  if (f.media) {
    const parts = MEDIA.filter((m) => f.media[m.code]).map((m) => {
      const st = f.media[m.code];
      return st === 'yes' ? m.label : st === 'road' ? `${m.label} (w drodze)` : `bez: ${m.label}`;
    });
    if (parts.length) out.push(`media: ${parts.join(', ')}`);
  }
  if (f.zoning?.mpzp) out.push('MPZP');
  if (f.zoning?.wz) out.push('WZ');
  if (f.access) out.push(`dojazd ${{ asphalt: 'asfaltowy', paved: 'utwardzony', dirt: 'gruntowy' }[f.access]}`);
  if (f.fenced === true) out.push('ogrodzona');
  if (f.width) out.push(`szer. ${f.width} m`);
  if (f.houseType) out.push(label(HOUSE_TYPES, f.houseType));
  if (f.houseState) out.push(label(HOUSE_STATES, f.houseState));
  if (f.rooms) out.push(`${f.rooms} pok.`);
  if (f.buildYear) out.push(`rok ${f.buildYear}`);
  if (Number.isFinite(f.floor)) out.push(f.floor === 0 ? 'parter' : `${f.floor}. piętro`);
  if (f.market) out.push(f.market === 'primary' ? 'rynek pierwotny' : 'rynek wtórny');
  for (const [k, name] of [['garage', 'garaż'], ['elevator', 'winda'], ['balcony', 'balkon'], ['garden', 'ogród'], ['parking', 'parking']]) if (f[k] === true) out.push(name);
  if (f.private === true) out.push('prywatne');
  return out;
}

module.exports = { compute, check, summary, fromText, fromKv, mediaFromText, plotTypeCode, houseTypeCode, stateCode, merge };
