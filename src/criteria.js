'use strict';

const geo = require('./geo');
const { norm } = require('./util');

// Search criteria: defaults, migration of old searches, labels and how each portal handles each filter.

const PLOT_TYPES = [
  // code, label, otodom plotType, olx filter_enum_type, gratka/morizon dictionary, nieruchomosci-online idIsPlotType
  { code: 'building', label: 'budowlana', otodom: 'BUILDING', olx: 'dzialki-budowlane', mzn: 'PLOT_TYPE_PLOT', nonline: 1 },
  { code: 'agri_building', label: 'rolno-budowlana', otodom: 'AGRICULTURAL_BUILDING', olx: 'dzialki-rolno-budowlane', mzn: 'PLOT_TYPE_AGRICULTURAL_AND_CONSTRUCTION', nonline: null },
  { code: 'agricultural', label: 'rolna', otodom: 'AGRICULTURAL', olx: 'dzialki-rolne', mzn: 'PLOT_TYPE_FARM_LAND', nonline: 2 },
  { code: 'habitat', label: 'siedliskowa', otodom: 'HABITAT', olx: 'dzialka-siedliskowa', mzn: 'PLOT_TYPE_HABITATION_PLOT', nonline: null },
  { code: 'recreational', label: 'rekreacyjna', otodom: 'RECREATIONAL', olx: 'dzialki-rekreacyjne', mzn: 'PLOT_TYPE_RECREATION_PLOT', nonline: 3 },
  { code: 'investment', label: 'inwestycyjna', otodom: null, olx: 'dzialki-inwestycyjne', mzn: 'PLOT_TYPE_INVESTMENT', nonline: 4 },
  { code: 'forest', label: 'leśna', otodom: 'WOODLAND', olx: 'dzialki-lesne', mzn: 'PLOT_TYPE_FOREST_LAND', nonline: null },
];

const MEDIA = [
  { code: 'electricity', label: 'prąd', mzn: 'electricity' },
  { code: 'water', label: 'woda', mzn: 'water' },
  { code: 'sewage', label: 'kanalizacja', mzn: 'nonCesspitSewerage' },
  { code: 'gas', label: 'gaz', mzn: 'gas' },
];

const HOUSE_TYPES = [
  { code: 'detached', label: 'wolnostojący', otodom: 'DETACHED', olx: 'wolnostojacy', mzn: 'HOUSE_TYPE_DETACHED_HOUSE' },
  { code: 'semi', label: 'bliźniak', otodom: 'SEMI_DETACHED', olx: 'blizniak', mzn: 'HOUSE_TYPE_SEMI_DETACHED_HOUSE' },
  { code: 'terraced', label: 'szeregowiec', otodom: 'RIBBON', olx: 'szeregowiec', mzn: 'HOUSE_TYPE_ATTACHED_HOUSES' },
];

const HOUSE_STATES = [
  { code: 'ready', label: 'do zamieszkania' },
  { code: 'to_finish', label: 'do wykończenia / deweloperski' },
  { code: 'raw', label: 'stan surowy' },
  { code: 'renovate', label: 'do remontu' },
];

const PORTAL_IDS = ['otodom', 'olx', 'gratka', 'morizon', 'nonline'];

const DEFAULT_SEARCH = {
  name: '',
  enabled: true,
  propertyType: 'plot',
  transaction: 'sale',
  locations: [],
  locationPins: [], // [{ query, name, label, lat, lon }] from the autocomplete
  areas: [], // drawn on the map: { type: 'polygon'|'rectangle', points: [[lat, lon]...] } | { type: 'circle', center, radius (m) }
  areaTowns: [], // towns found in the areas: { name, lat, lon, status: 'inside'|'edge', enabled }
  regionHint: '',
  radiusKm: 0,
  priceMin: null,
  priceMax: null,
  pricePerM2Max: null,
  areaMin: null,
  areaMax: null,
  plotAreaMin: null,
  plotAreaMax: null,
  // plot
  plotTypes: ['building'],
  media: [],
  mediaAllowRoad: true, // "media w drodze" counts as available
  access: '', // '' | 'asphalt' | 'paved' (asphalt or paved)
  zoning: '', // '' | 'mpzp' | 'wz' | 'any' (MPZP or WZ)
  fenced: false,
  minWidth: null,
  // house
  houseTypes: [],
  houseStates: [],
  roomsMin: null,
  roomsMax: null,
  buildYearMin: null,
  garage: false,
  // flat
  floorMin: null,
  floorMax: null,
  market: '', // '' | 'primary' | 'secondary'
  elevator: false,
  balcony: false,
  garden: false,
  parking: false,
  // common
  privateOnly: false,
  keywordsRequired: [],
  keywordsExcluded: [],
  portals: Object.fromEntries(PORTAL_IDS.map((p) => [p, true])),
  telegramThreadId: '',
};

function toKeywordList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Fills defaults and migrates searches created by the first version. */
function normalize(raw) {
  const s = { ...DEFAULT_SEARCH, ...raw };
  // v1 had no plotTypes and always meant "działka budowlana".
  if (s.propertyType === 'plot' && raw && raw.plotTypes === undefined) s.plotTypes = ['building'];
  s.keywordsRequired = toKeywordList(s.keywordsRequired);
  s.keywordsExcluded = toKeywordList(s.keywordsExcluded);
  s.locations = (Array.isArray(s.locations) ? s.locations : String(s.locations || '').split(/[,\n;]/)).map((x) => String(x).trim()).filter(Boolean);
  s.locationPins = Array.isArray(s.locationPins) ? s.locationPins.filter((p) => p && p.query) : [];
  // The same town typed twice ("wieliczka" + "Wieliczka"): keep one, preferably the one picked from the list.
  const pinned = new Set(s.locationPins.map((p) => p.query));
  const byName = new Map();
  for (const q of s.locations) {
    const k = norm(q);
    if (!byName.has(k) || (!pinned.has(byName.get(k)) && pinned.has(q))) byName.set(k, q);
  }
  s.locations = [...byName.values()];
  s.locationPins = s.locationPins.filter((p) => s.locations.includes(p.query));
  s.areas = geo.cleanAreas(s.areas);
  s.areaTowns = (Array.isArray(s.areaTowns) ? s.areaTowns : [])
    .filter((t) => t && t.name && Number.isFinite(Number(t.lat)) && Number.isFinite(Number(t.lon)))
    .slice(0, 300)
    .map((t) => ({ name: String(t.name).slice(0, 80), lat: Number(t.lat), lon: Number(t.lon), status: t.status === 'edge' ? 'edge' : 'inside', enabled: t.enabled !== false }));
  if (!s.areas.length) s.areaTowns = [];
  for (const k of ['priceMin', 'priceMax', 'pricePerM2Max', 'areaMin', 'areaMax', 'plotAreaMin', 'plotAreaMax', 'minWidth', 'roomsMin', 'roomsMax', 'buildYearMin', 'floorMin', 'floorMax']) {
    // floors may be 0 (ground floor)
    s[k] = num(s[k]);
  }
  s.radiusKm = Math.min(30, num(s.radiusKm) || 0);
  for (const k of ['plotTypes', 'media', 'houseTypes', 'houseStates']) s[k] = Array.isArray(s[k]) ? s[k] : [];
  s.portals = { ...Object.fromEntries(PORTAL_IDS.map((p) => [p, false])), ...(s.portals || {}) };
  s.enabled = s.enabled !== false;
  return s;
}

/*
 * How each portal handles a filter:
 *   url    - portal filters it (in the search URL); program also re-checks when the data has it
 *   data   - not in the URL, but the result list contains it
 *   detail - read from the offer page (fetched only for new offers)
 *   text   - only guessed from title/description
 *   none   - cannot be checked
 */
const CAPS = {
  area: { label: 'narysowany obszar', otodom: 'url', olx: 'data', gratka: 'url', morizon: 'url', nonline: 'data' },
  privateOnly: { label: 'tylko prywatne', otodom: 'url', olx: 'url', gratka: 'url', morizon: 'url', nonline: 'url' },
  plotTypes: { label: 'rodzaj działki', otodom: 'url', olx: 'url', gratka: 'url', morizon: 'url', nonline: 'data' },
  media: { label: 'media', otodom: 'detail', olx: 'text', gratka: 'detail', morizon: 'detail', nonline: 'detail' },
  access: { label: 'dojazd', otodom: 'text', olx: 'text', gratka: 'text', morizon: 'text', nonline: 'data' },
  zoning: { label: 'MPZP / WZ', otodom: 'text', olx: 'text', gratka: 'text', morizon: 'text', nonline: 'text' },
  fenced: { label: 'ogrodzona', otodom: 'detail', olx: 'text', gratka: 'detail', morizon: 'detail', nonline: 'url' },
  minWidth: { label: 'szerokość działki', otodom: 'text', olx: 'text', gratka: 'detail', morizon: 'detail', nonline: 'detail' },
  houseTypes: { label: 'typ zabudowy', otodom: 'url', olx: 'url', gratka: 'url', morizon: 'url', nonline: 'text' },
  houseStates: { label: 'stan', otodom: 'detail', olx: 'text', gratka: 'detail', morizon: 'detail', nonline: 'text' },
  rooms: { label: 'liczba pokoi', otodom: 'url', olx: 'url', gratka: 'url', morizon: 'url', nonline: 'url' },
  buildYearMin: { label: 'rok budowy', otodom: 'url', olx: 'text', gratka: 'url', morizon: 'url', nonline: 'text' },
  garage: { label: 'garaż', otodom: 'detail', olx: 'text', gratka: 'detail', morizon: 'detail', nonline: 'text' },
  floor: { label: 'piętro', otodom: 'url', olx: 'url', gratka: 'url', morizon: 'url', nonline: 'url' },
  market: { label: 'rynek', otodom: 'url', olx: 'url', gratka: 'url', morizon: 'url', nonline: 'url' },
  elevator: { label: 'winda', otodom: 'url', olx: 'text', gratka: 'url', morizon: 'url', nonline: 'url' },
  balcony: { label: 'balkon', otodom: 'url', olx: 'text', gratka: 'url', morizon: 'url', nonline: 'url' },
  garden: { label: 'ogród', otodom: 'url', olx: 'text', gratka: 'url', morizon: 'url', nonline: 'url' },
  parking: { label: 'miejsce parkingowe', otodom: 'url', olx: 'text', gratka: 'url', morizon: 'url', nonline: 'url' },
};

/** Which filters of this search are active (filter key -> true). */
function activeFilters(s) {
  const a = {};
  if (s.areas?.length) a.area = true;
  if (s.privateOnly) a.privateOnly = true;
  if (s.propertyType === 'plot') {
    if (s.plotTypes.length && s.plotTypes.length < PLOT_TYPES.length) a.plotTypes = true;
    if (s.media.length) a.media = true;
    if (s.access) a.access = true;
    if (s.zoning) a.zoning = true;
    if (s.fenced) a.fenced = true;
    if (s.minWidth) a.minWidth = true;
  }
  if (s.propertyType === 'house') {
    if (s.houseTypes.length && s.houseTypes.length < HOUSE_TYPES.length) a.houseTypes = true;
    if (s.houseStates.length && s.houseStates.length < HOUSE_STATES.length) a.houseStates = true;
    if (s.buildYearMin) a.buildYearMin = true;
    if (s.garage) a.garage = true;
  }
  if (s.propertyType !== 'plot' && (s.roomsMin || s.roomsMax)) a.rooms = true;
  if (s.propertyType === 'flat') {
    if (s.floorMin !== null || s.floorMax !== null) a.floor = true;
    if (s.market) a.market = true;
    for (const k of ['elevator', 'balcony', 'garden', 'parking']) if (s[k]) a[k] = true;
  }
  return a;
}

/**
 * Coverage of active filters on the enabled portals, with exceptions that depend on the values
 * (e.g. OLX filters the lift only for rentals).
 */
function capability(filter, portal, s) {
  let c = CAPS[filter]?.[portal] || 'none';
  if (filter === 'plotTypes') {
    const types = PLOT_TYPES.filter((t) => s.plotTypes.includes(t.code));
    if (portal === 'otodom' && types.some((t) => !t.otodom)) c = 'data';
    if (portal === 'nonline' && types.length === 1 && types[0].nonline) c = 'url';
  }
  if (filter === 'houseTypes' && portal === 'nonline' && s.houseTypes.length === 1 && s.houseTypes[0] === 'detached') c = 'url';
  if (filter === 'rooms' && portal === 'olx' && s.propertyType === 'house') c = 'text';
  // OLX has one bucket for "4 and more" rooms, so 5+ is narrowed down by the program.
  if (filter === 'rooms' && portal === 'olx' && s.propertyType === 'flat' && (s.roomsMin || 0) > 4) c = 'data';
  if (filter === 'floor' && portal === 'olx' && (s.floorMax ?? 0) > 10) c = 'data';
  if (filter === 'elevator' && portal === 'otodom' && s.transaction === 'rent') c = 'url';
  if (filter === 'market' && portal === 'olx' && s.transaction === 'rent') c = 'text';
  // "media w drodze" accepted -> the portal's own media filter would be too strict, so it's checked from the offer page.
  if (filter === 'media' && (portal === 'gratka' || portal === 'morizon') && !s.mediaAllowRoad) c = 'url';
  return c;
}

function coverage(s) {
  const out = [];
  for (const f of Object.keys(activeFilters(s))) {
    const per = {};
    for (const p of PORTAL_IDS) if (s.portals[p]) per[p] = capability(f, p, s);
    out.push({ filter: f, label: CAPS[f].label, portals: per });
  }
  return out;
}

const TYPE_LABEL = { plot: 'Działka', house: 'Dom', flat: 'Mieszkanie' };

/** Typed-in towns plus the enabled towns found in the drawn areas (no duplicates). */
function effectiveLocations(s) {
  const out = [...s.locations];
  const pins = [...s.locationPins];
  const have = new Set(out.map((x) => x.toLowerCase()));
  for (const t of s.areaTowns || []) {
    if (!t.enabled || have.has(t.name.toLowerCase())) continue;
    have.add(t.name.toLowerCase());
    out.push(t.name);
    pins.push({ query: t.name, name: t.name, label: `${t.name} (z obszaru)`, context: '', lat: t.lat, lon: t.lon, fromArea: true });
  }
  return { locations: out, pins };
}

module.exports = {
  PLOT_TYPES,
  MEDIA,
  HOUSE_TYPES,
  HOUSE_STATES,
  PORTAL_IDS,
  DEFAULT_SEARCH,
  CAPS,
  TYPE_LABEL,
  normalize,
  activeFilters,
  capability,
  coverage,
  toKeywordList,
  effectiveLocations,
};
