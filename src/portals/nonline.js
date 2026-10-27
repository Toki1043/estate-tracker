'use strict';

const cheerio = require('cheerio');
const http = require('../http');
const { parseNum, slug } = require('../util');
const { PLOT_TYPES } = require('../criteria');

const BASE = 'https://www.nieruchomosci-online.pl';
const CATEGORY = { plot: 'dzialka', house: 'dom', flat: 'mieszkanie' };

async function suggest(name) {
  const text = await http.getText(
    `${BASE}/?module=locationTip&type=cityQuarterTip&cn=${encodeURIComponent(name.toLowerCase())}`,
    { accept: 'application/json', headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${BASE}/` } }
  );
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    throw new Error('Nieruchomosci-online: nieoczekiwana odpowiedź podpowiedzi');
  }
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    // Only whole towns: entries with a street (idS) or a quarter (idQ) are skipped.
    if (Number(t.idS) > 0 || Number(t.idQ) > 0) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({
      id: String(t.id),
      name: t.cn,
      context: String(t.rn || '').replace(/^gm\.\s*/, 'gm. '),
      level: 'town',
      label: `${t.cn} (${t.rn})`,
      extra: { countyId: t.idD, regionId: t.idR },
    });
  }
  return out;
}

// Field layout of the site's search URL, copied from its own search.createURL() (search.map):
// [name, type (1 = range, 2 = flag, 3 = value), condition {categoryId: [adTypeIds]} | null = always].
// Category: 1 mieszkanie, 2 dom, 3 działka. Ad type: 1 sprzedaż, 2 wynajem.
const ALWAYS = [[-1]];
const FIELDS = [
  ['version', 3, null], ['categoryAliasSingle', 3, null], ['adTypeAlias', 3, null], ['regionAlias', 3, null],
  ['cityName', 3, null], ['quarterName', 3, null], ['streetName', 3, null], ['distance', 3, null],
  ['price', 1, null], ['area', 1, null], ['isPhoto', 2, null], ['isPrivateAd', 2, null],
  ['parking', 2, { 4: [0, 1, 2], 5: [0, 1, 2] }], ['idAd', 3, ALWAYS], ['idAccount', 3, ALWAYS],
  ['plotArea', 1, { 2: [0, 1, 2] }], ['pricePM', 1, { 4: [2] }], ['isPrimaryMarketAd', 2, { 1: [1, 2], 2: [1, 2], 4: [1, 2] }],
  ['roomNumber', 1, { 1: [0, 1, 2], 2: [0, 1, 2] }], ['isForHouseDestiny', 2, { 3: [1] }], ['isAsphaltDrive', 2, { 3: [0, 1, 2] }],
  ['isFenced', 2, { 3: [0, 1, 2] }], ['isOfficeBuilding', 2, { 5: [0, 1, 2] }], ['addedAfter', 3, ALWAYS],
  ['constructionYear', 3, { 1: [0, 1, 2], 2: [0, 1, 2], 4: [0, 1, 2], 5: [0, 1, 2] }], ['isUnfurnished', 2, { 1: [2] }],
  ['isForInvestmentDestiny', 2, { 3: [1] }], ['isEntranceFromStreet', 2, { 4: [0, 1, 2] }], ['isWarehouse', 2, { 5: [0, 1, 2] }],
  ['isSeparateKitchen', 2, { 1: [0, 1, 2] }], ['isGroundFloor', 2, { 2: [0, 1, 2] }], ['isOnGroundFloor', 2, { 4: [0, 1, 2] }],
  ['isMultiLevel', 2, { 1: [1] }], ['isBalcony', 2, { 1: [0, 1, 2], 6: [-1] }], ['isElevator', 2, { 1: [0, 1, 2] }],
  ['floor', 1, { 1: [0, 1, 2] }], ['isBasement', 2, { 1: [1], 2: [1] }], ['isApartment', 2, { 1: [0, 1, 2] }],
  ['isTenementHouse', 2, { 1: [0, 1, 2] }], ['isGarage', 2, { 1: [1, 2] }], ['idInvestment', 3, ALWAYS],
  ['withBuildingProjects', 2, { 2: [-1] }], ['noAgentProvision', 2, ALWAYS], ['idContactPerson', 3, ALWAYS],
  ['idRoomCapacity', 3, { 6: [-1] }], ['isPlaceInRoom', 2, { 6: [-1] }], ['idPreferedProfession', 3, { 6: [-1] }],
  ['isFurnished', 2, { 1: [2], 6: [-1] }], ['isOwnerNotInHouse', 2, { 6: [-1] }], ['isMInternet', 2, { 6: [-1] }],
  ['isMTv', 2, { 6: [-1] }], ['availableFrom', 3, { 6: [-1] }], ['isInvestmentsOnly', 2, { 1: [1, 2], 2: [1, 2], 4: [1, 2] }],
  ['idIsBuildingType', 3, { 1: [1, 2] }], ['idIsPlotType', 3, { 3: [1] }], ['isPossibleChange', 2, { 1: [1], 2: [1] }],
  ['isTerrace', 2, { 1: [1] }], ['isGarden', 2, { 1: [1, 2] }], ['isWithoutRent', 2, { 1: [1] }], ['isForRenovation', 2, { 1: [1] }],
  ['isSubway', 2, { 1: [1, 2] }], ['isStudio', 2, { 1: [2] }], ['isDetached', 2, { 2: [1] }], ['isLake', 2, { 2: [1], 3: [1] }],
  ['isWaterside', 2, { 3: [1] }], ['isArmed', 2, { 3: [1, 2] }], ['isWithTenant', 2, { 4: [1], 5: [1] }],
  ['isForGastronomic', 2, { 4: [1, 2] }], ['isForWarehouse', 2, { 4: [2] }], ['isSecondaryMarketAd', 2, { 1: [1, 2], 2: [1, 2], 4: [1, 2] }],
];
const CAT_ID = { mieszkanie: 1, dom: 2, dzialka: 3 };

function available(cond, cat, adType) {
  if (!cond) return true;
  if (Array.isArray(cond)) return true; // [[-1]] = every category
  const allowed = cond[cat];
  return !!allowed && (allowed.includes(adType) || allowed.includes(-1));
}

/** Port of the site's createURL(): values = { name: value, nameFrom/nameTo for ranges, flags as true }. */
function encodeSearch(values) {
  const cat = CAT_ID[values.categoryAliasSingle];
  const adType = values.adTypeAlias === 'wynajem' ? 2 : 1;
  let g = '';
  for (const [name, type, cond] of FIELDS) {
    if (!available(cond, cat, adType)) continue;
    if (type === 1) {
      const from = values[`${name}From`];
      const to = values[`${name}To`];
      if (from !== undefined && from !== null && from !== '') g += String(from);
      if (to !== undefined && to !== null && to !== '') g += `-${to}`;
    } else if (values[name] !== undefined && values[name] !== null && values[name] !== '' && values[name] !== false) {
      g += type === 2 ? '1' : String(values[name]);
    }
    g += ',';
  }
  return g.replace(/,+$/, '');
}

function buildTargets(search, locs) {
  const category = CATEGORY[search.propertyType];
  return locs.map((loc) => {
    const v = {
      version: 3,
      categoryAliasSingle: category,
      adTypeAlias: search.transaction === 'rent' ? 'wynajem' : 'sprzedaz',
      cityName: `${encodeURIComponent(loc.name)}:${loc.id}`,
      distance: search.radiusKm > 0 ? Math.round(search.radiusKm) : '',
      priceFrom: search.priceMin, priceTo: search.priceMax,
      areaFrom: search.areaMin, areaTo: search.areaMax,
      isPrivateAd: search.privateOnly,
    };
    if (search.propertyType === 'house') {
      v.plotAreaFrom = search.plotAreaMin;
      v.plotAreaTo = search.plotAreaMax;
      if (search.houseTypes?.length === 1 && search.houseTypes[0] === 'detached' && search.transaction !== 'rent') v.isDetached = true;
    }
    if (search.propertyType !== 'plot') {
      v.roomNumberFrom = search.roomsMin;
      v.roomNumberTo = search.roomsMax;
    }
    if (search.propertyType === 'plot') {
      const types = PLOT_TYPES.filter((t) => search.plotTypes?.includes(t.code));
      if (types.length === 1 && types[0].nonline && search.transaction !== 'rent') v.idIsPlotType = types[0].nonline;
      if (search.fenced) v.isFenced = true;
      if (search.access === 'asphalt') v.isAsphaltDrive = true;
      if (search.media?.length && !search.mediaAllowRoad) v.isArmed = true;
    }
    if (search.propertyType === 'flat') {
      v.floorFrom = search.floorMin;
      v.floorTo = search.floorMax;
      if (search.market === 'primary') v.isPrimaryMarketAd = true;
      if (search.market === 'secondary') v.isSecondaryMarketAd = true;
      v.isElevator = search.elevator;
      v.isBalcony = search.balcony;
      v.isGarden = search.garden;
      v.isGarage = search.parking;
    }
    const url = `${BASE}/szukaj.html?${encodeSearch(v)}`;
    return { label: loc.name, url, fetchUrl: url, citySlug: slug(loc.name), radius: search.radiusKm > 0 };
  });
}

function bigPhoto(src) {
  if (!src) return null;
  return src.replace(/\/(k[a-z0-9]+)c\//, '/$1l/');
}

function fromTiles(html) {
  const $ = cheerio.load(html);
  let tileProps = {};
  let matched = null;
  const tp = html.match(/"tile_props":(\{[\s\S]*?\}\}),"record_props"/);
  if (tp) {
    try {
      tileProps = JSON.parse(tp[1]);
    } catch {}
  }
  let recordProps = {};
  const rp = html.match(/"record_props":(\{[\s\S]*?\}\})\}/);
  if (rp) {
    try {
      recordProps = JSON.parse(rp[1]);
    } catch {}
  }
  const lp = html.match(/"list_props":\{[^{}]*?"tiles":(\d+)/);
  if (lp) matched = Number(lp[1]);

  const offers = [];
  $('div.tile[data-id]').each((idx, el) => {
    const t = $(el);
    const dataId = t.attr('data-id');
    // "gn"/"gp" = matches the search; "gc" = suggestions from nearby towns appended below.
    const group = tileProps[dataId]?.tgc;
    if (group === 'gc') return;
    if (!group && matched !== null && idx >= matched) return;
    const a = t.find('h2 a').first();
    const url = a.attr('href');
    if (!url) return;
    const prim = t.find('[id^="primary-display_"]').first();
    const kv = t
      .find('.attributes__box--item p')
      .map((_, x) => $(x).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter((x) => x.includes(':'));
    const plotType = (kv.find((x) => /^Rodzaj działki/i.test(x)) || '').split(':').slice(1).join(':').trim();
    const pbh = recordProps[dataId]?.pbh;
    offers.push({
      id: dataId.replace(/^a/, ''),
      url: url.startsWith('http') ? url : `https:${url}`,
      title: a.text().trim(),
      price: parseNum(prim.find('span').first().text()),
      area: parseNum(t.find('.area').first().text()),
      plotArea: null,
      pricePerM2: parseNum(t.find('[id^="secondary-display_"]').first().text()),
      location: t.find('[id^="tertiary-province_"]').first().text().replace(/\(/g, ' (').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim(),
      image: bigPhoto(t.find('img').first().attr('src')),
      createdAt: null,
      description: [plotType && `Rodzaj działki: ${plotType}`, t.find('p.desc').first().text().trim()].filter(Boolean).join(' · '),
      kind: plotType || null,
      kv,
      attrs: { private: pbh ? pbh === 'priv' : undefined },
    });
  });
  if (!offers.length && !$('div.tile[data-id]').length && !/nie znaleźliśmy ogłoszeń/i.test(html)) {
    throw new Error('nie znaleziono kafelków ofert');
  }
  return { offers, total: matched };
}

// Fallback: JSON-LD. It has no "nearby" marker, so we keep offers whose subdomain is the searched town.
function fromJsonLd(html, target) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const b of blocks) {
    let j;
    try {
      j = JSON.parse(b[1]);
    } catch {
      continue;
    }
    const agg = (j?.mainEntity?.offers || []).find((o) => Array.isArray(o.offers));
    if (!agg) continue;
    const offers = [];
    for (const o of agg.offers) {
      const host = String(o.url || '').match(/^https?:\/\/([^.]+)\./)?.[1];
      if (target && !target.radius && host && host !== 'www' && host !== target.citySlug) continue;
      const price = parseNum(o.price);
      const ppm = parseNum(o.priceSpecification?.price);
      const desc = String(o.itemOffered?.description || '');
      offers.push({
        id: String(o.url || '').match(/\/(\d+)\.html/)?.[1] || o.url,
        url: o.url,
        title: desc.split(/[.!]/)[0].slice(0, 90) || 'Oferta',
        price,
        area: price && ppm ? Math.round(price / ppm) : null,
        plotArea: null,
        pricePerM2: ppm,
        location: host || '',
        image: o.image || null,
        createdAt: null,
        description: desc,
      });
    }
    return { offers, total: null };
  }
  throw new Error('brak ofert w JSON-LD');
}

/** Offer page: "Label: value" lines, JSON-LD (coordinates, land type) and the description. */
async function fetchDetail(o) {
  const html = await http.getText(o.url);
  const $ = cheerio.load(html);
  let lat = null;
  let lon = null;
  let description = '';
  const kv = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let j;
    try {
      j = JSON.parse($(el).html());
    } catch {
      return;
    }
    const walk = (x) => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (!x || typeof x !== 'object') return;
      if (x['@type'] === 'GeoCoordinates' && lat === null) {
        lat = parseNum(x.latitude);
        lon = parseNum(x.longitude);
      }
      if (x['@type'] === 'PropertyValue' && /type/i.test(x.name || '')) kv.push(`Rodzaj działki: ${x.value}`);
      if (typeof x.description === 'string' && x.description.length > description.length) description = x.description;
      Object.values(x).forEach(walk);
    };
    walk(j);
  });
  const fullDesc = $('#boxCustomDesc').text().replace(/\s+/g, ' ').trim();
  if (fullDesc.length > description.length) description = fullDesc;
  $('script, style, noscript, svg').remove();
  $('br').replaceWith('\n');
  $('p, li, div, tr, dt, dd, h2, h3, span').each((_, el) => {
    $(el).prepend('\n');
  });
  const lines = $('body').text().split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż][^:]{1,40}):\s*(.*)$/);
    if (!m) continue;
    // "Media:" and the value can be split into two lines.
    const value = m[2] || (lines[i + 1] && !lines[i + 1].includes(':') ? lines[i + 1] : '');
    if (value && value !== '-') kv.push(`${m[1]}: ${value}`);
  }
  return { attrs: {}, kv: [...new Set(kv)].slice(0, 120), description, lat, lon, exactCoords: lat !== null };
}

async function fetchOffers(target) {
  const html = await http.getText(target.fetchUrl);
  try {
    return { ...fromTiles(html), method: 'HTML (kafelki)' };
  } catch (e) {
    return { ...fromJsonLd(html, target), method: 'JSON-LD (fallback)', note: e.message };
  }
}

module.exports = {
  id: 'nonline',
  name: 'Nieruchomosci-online',
  multiLocation: false,
  coords: false,
  suggest,
  buildTargets,
  fetchOffers,
  fetchDetail,
  _parsers: { fromTiles, fromJsonLd, encodeSearch },

};
