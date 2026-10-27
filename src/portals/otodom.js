'use strict';

const cheerio = require('cheerio');
const http = require('../http');
const { parseNum, snapUp } = require('../util');
const { PLOT_TYPES, HOUSE_TYPES } = require('../criteria');
const features = require('../features');
const geo = require('../geo');

const BASE = 'https://www.otodom.pl';

const AUTOCOMPLETE_QUERY = `query autocomplete($query: String!, $ranking: RankingSystemInput, $levels: [String!]) {
  autocomplete(query: $query, ranking: $ranking, levels: $levels) {
    __typename
    ... on FoundLocations { locationsObjects { id detailedLevel name fullName parentIds } }
  }
}`;

const ESTATE = { plot: 'dzialka', house: 'dom', flat: 'mieszkanie' };
const TRANSACTION = { sale: 'sprzedaz', rent: 'wynajem' };
const RADII = [0, 5, 10, 15, 25, 50, 75];
const ROOMS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX_OR_MORE'];
const FLOORS = ['CELLAR', 'GROUND', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH', 'ABOVE_TENTH']; // index = floor + 1

const list = (arr) => `[${arr.join(',')}]`;

function levelOf(detailedLevel) {
  const l = String(detailedLevel || '');
  if (l === 'village' || l === 'city') return 'town';
  if (l === 'district' || l === 'subdistrict' || l === 'residential') return 'district';
  if (l.includes('commune')) return 'commune';
  if (l === 'county') return 'county';
  if (l === 'voivodeship') return 'region';
  if (l === 'street') return 'street';
  return l || 'other';
}

async function suggest(name) {
  const data = await http.postJson(`${BASE}/api/query`, {
    operationName: 'autocomplete',
    query: AUTOCOMPLETE_QUERY,
    variables: { query: name, ranking: { type: 'BLENDED_INFIX_LOOKUP_SUGGEST' }, levels: null },
  });
  const list = data?.data?.autocomplete?.locationsObjects;
  if (!Array.isArray(list)) throw new Error('Otodom: nieoczekiwana odpowiedź autocomplete');
  return list.map((l) => ({
    id: l.id,
    name: l.name,
    context: l.fullName,
    level: levelOf(l.detailedLevel),
    label: l.fullName,
  }));
}

function buildTargets(search, locs) {
  const estate = ESTATE[search.propertyType];
  const trans = TRANSACTION[search.transaction] || 'sprzedaz';
  const ids = locs.map((l) => l.id);
  const p = new URLSearchParams();
  let path;
  if (ids.length === 1) {
    path = `/pl/wyniki/${trans}/${estate}/${ids[0]}`;
  } else {
    path = `/pl/wyniki/${trans}/${estate}/wiele-lokalizacji`;
    p.set('locations', `[${ids.join(',')}]`);
  }
  addFilters(p, search);
  if (search.radiusKm > 0) p.set('distanceRadius', snapUp(search.radiusKm, RADII));
  p.set('limit', '72');
  p.set('by', 'LATEST');
  p.set('direction', 'DESC');
  const url = `${BASE}${path}?${p.toString()}`;
  return [{ label: locs.map((l) => l.name).join(', '), url, fetchUrl: url }];
}

/** One URL per drawn area: Otodom searches inside a polygon given as an encoded polyline ("geometry"). */
function buildAreaTargets(search, areas) {
  const estate = ESTATE[search.propertyType];
  const trans = TRANSACTION[search.transaction] || 'sprzedaz';
  return areas.map((area, i) => {
    const p = new URLSearchParams();
    p.set('geometry', geo.encodePolyline(geo.closedRing(area)));
    addFilters(p, search);
    p.set('limit', '72');
    p.set('by', 'LATEST');
    p.set('direction', 'DESC');
    const url = `${BASE}/pl/wyniki/${trans}/${estate}/cala-polska?${p.toString()}`;
    return { label: `Obszar ${i + 1}`, url, fetchUrl: url, area: i };
  });
}

function addFilters(p, search) {
  if (search.priceMin) p.set('priceMin', search.priceMin);
  if (search.priceMax) p.set('priceMax', search.priceMax);
  if (search.areaMin) p.set('areaMin', search.areaMin);
  if (search.areaMax) p.set('areaMax', search.areaMax);
  if (search.pricePerM2Max) p.set('pricePerMeterMax', search.pricePerM2Max);
  if (search.propertyType === 'house') {
    if (search.plotAreaMin) p.set('terrainAreaMin', search.plotAreaMin);
    if (search.plotAreaMax) p.set('terrainAreaMax', search.plotAreaMax);
  }
  if (search.propertyType === 'plot' && search.plotTypes?.length) {
    const t = PLOT_TYPES.filter((x) => search.plotTypes.includes(x.code));
    // Types without an Otodom equivalent ("inwestycyjna") -> no URL filter, checked by the program.
    if (t.length < PLOT_TYPES.length && t.every((x) => x.otodom)) p.set('plotType', list(t.map((x) => x.otodom)));
  }
  if (search.privateOnly) p.set('isPrivateOwner', 'true');
  if (search.propertyType !== 'plot' && (search.roomsMin || search.roomsMax)) {
    const lo = Math.max(1, search.roomsMin || 1);
    const hi = Math.min(6, search.roomsMax || 6);
    p.set('roomsNumber', list(ROOMS.slice(lo - 1, hi)));
  }
  if (search.propertyType === 'house') {
    const t = HOUSE_TYPES.filter((x) => search.houseTypes?.includes(x.code));
    if (t.length && t.length < HOUSE_TYPES.length) p.set('buildingType', list(t.map((x) => x.otodom)));
    if (search.buildYearMin) p.set('buildYearMin', search.buildYearMin);
  }
  if (search.propertyType === 'flat') {
    if (search.floorMin !== null || search.floorMax !== null) {
      const lo = Math.max(-1, search.floorMin ?? -1);
      const hi = Math.min(11, search.floorMax ?? 11);
      p.set('floors', list(FLOORS.slice(lo + 1, hi + 2)));
    }
    if (search.market && search.transaction === 'sale') p.set('market', search.market.toUpperCase());
    const extras = [];
    if (search.elevator) extras.push('LIFT');
    if (search.balcony) extras.push('BALCONY');
    if (search.garden) extras.push('GARDEN');
    if (search.parking) extras.push('GARAGE');
    if (extras.length) p.set('extras', list(extras));
  }
}

function fromNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('brak __NEXT_DATA__');
  const pp = JSON.parse(m[1])?.props?.pageProps;
  const sa = pp?.data?.searchAds;
  if (!sa || !Array.isArray(sa.items)) throw new Error('brak data.searchAds w __NEXT_DATA__');
  const seen = new Set();
  const offers = [];
  for (const it of sa.items) {
    // Otodom repeats some highlighted ads with a fake id and a 1999 date.
    if (!it.slug || seen.has(it.slug)) continue;
    seen.add(it.slug);
    const locs = it.location?.reverseGeocoding?.locations || [];
    const locNames = locs.filter((l) => l.locationLevel !== 'voivodeship' && l.locationLevel !== 'county').map((l) => l.name);
    const street = it.location?.address?.street?.name;
    offers.push({
      // Same id as the HTML fallback produces (the "ID..." suffix of the slug).
      id: it.slug.match(/ID([A-Za-z0-9]+)$/)?.[1] || String(it.id),
      url: `${BASE}/pl/oferta/${it.slug}`,
      title: it.title,
      price: it.hidePrice ? null : parseNum(it.totalPrice?.value),
      area: parseNum(it.areaInSquareMeters),
      plotArea: parseNum(it.terrainAreaInSquareMeters),
      pricePerM2: parseNum(it.pricePerSquareMeter?.value),
      // Most specific first: "Podłęże, Niepołomice" (village, commune).
      location: [...new Set(locNames)].reverse().join(', ') + (street ? `, ${street}` : ''),
      image: it.images?.[0]?.large || it.images?.[0]?.medium || null,
      createdAt: it.createdAtFirst || it.dateCreated || null,
      description: it.shortDescription || '',
      attrs: {
        private: typeof it.isPrivateOwner === 'boolean' ? it.isPrivateOwner : undefined,
        rooms: it.roomsNumber ? ROOMS.indexOf(it.roomsNumber) + 1 || undefined : undefined,
        floor: it.floorNumber ? floorFromEnum(it.floorNumber) : undefined,
      },
    });
  }
  return { offers, total: sa.pagination?.totalItems ?? null };
}

function floorFromEnum(v) {
  const i = FLOORS.indexOf(String(v).toUpperCase());
  return i >= 0 ? i - 1 : undefined;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

/** Offer page: structured "target" data, characteristics, coordinates and the full description. */
async function fetchDetail(o) {
  const html = await http.getText(o.url);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Otodom: brak __NEXT_DATA__ na stronie oferty');
  const ad = JSON.parse(m[1])?.props?.pageProps?.ad;
  if (!ad) throw new Error('Otodom: brak danych oferty');
  const t = ad.target || {};
  const attrs = {};
  if (Array.isArray(t.Media_types) && t.Media_types.length) {
    attrs.media = {};
    for (const x of t.Media_types) {
      const k = { electricity: 'electricity', water: 'water', gas: 'gas', sewage: 'sewage' }[x];
      if (k) attrs.media[k] = 'yes';
    }
  }
  if (t.Fence) attrs.fenced = first(t.Fence) === 'y';
  if (t.Type) attrs.plotType = features.plotTypeCode(first(t.Type));
  if (t.Building_type) attrs.houseType = features.houseTypeCode(String(first(t.Building_type)).replace(/_/g, ' '));
  if (t.Construction_status) attrs.houseState = features.stateCode(String(first(t.Construction_status)).replace(/_/g, ' '));
  if (t.Build_year) attrs.buildYear = parseInt(t.Build_year, 10) || undefined;
  if (t.Rooms_num) attrs.rooms = parseInt(first(t.Rooms_num), 10) || undefined;
  if (t.Floor_no) attrs.floor = /ground/.test(first(t.Floor_no)) ? 0 : parseInt(String(first(t.Floor_no)).replace(/\D/g, ''), 10);
  if (t.MarketType) attrs.market = /primary/i.test(t.MarketType) ? 'primary' : 'secondary';
  if (t.user_type) attrs.private = t.user_type === 'private';
  if (Array.isArray(t.Extras_types)) {
    for (const x of t.Extras_types) {
      if (x === 'garage') attrs.garage = attrs.parking = true;
      if (x === 'lift') attrs.elevator = true;
      if (x === 'balcony') attrs.balcony = true;
      if (x === 'garden') attrs.garden = true;
    }
  }
  if (Array.isArray(t.Access_types) && t.Access_types.length) {
    const a = t.Access_types.join(' ');
    attrs.access = /asphalt/.test(a) ? 'asphalt' : /hard/.test(a) ? 'paved' : /soft|field/.test(a) ? 'dirt' : undefined;
  }
  const kv = (ad.characteristics || []).filter((c) => c.label && c.localizedValue).map((c) => `${c.label}: ${c.localizedValue}`);
  const c = ad.location?.coordinates;
  return {
    attrs,
    kv,
    description: String(ad.description || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
    lat: c?.latitude ?? null,
    lon: c?.longitude ?? null,
    exactCoords: (ad.location?.mapDetails?.radius ?? 0) === 0,
  };
}

// Fallback: listing cards rendered as <article> elements.
function fromHtml(html) {
  const $ = cheerio.load(html);
  const offers = [];
  const seen = new Set();
  $('article').each((_, el) => {
    const a = $(el).find('a[href*="/pl/oferta/"]').first();
    const href = a.attr('href');
    if (!href) return;
    const url = href.startsWith('http') ? href : BASE + href;
    if (seen.has(url)) return;
    seen.add(url);
    const txt = (sel) => $(el).find(sel).first().clone().children('style').remove().end().text().replace(/\s+/g, ' ').trim();
    const title = txt('[data-cy="listing-item-title"]') || txt('a[data-cy="listing-item-link"]');
    const priceText = txt('[data-cy="listing-item-price"]'); // "740 000 zł600,16 zł/m²"
    const priceM = priceText.match(/^([\d\s]+)\s*zł/);
    const ppmM = priceText.match(/zł\s*([\d\s]+(?:,\d+)?)\s*zł\/m²/);
    const areaM = txt('dl').match(/(\d[\d\s]*(?:[.,]\d+)?)\s*m²/);
    // Highlighted ads are repeated under a second id: skip identical cards.
    const sig = `${title}|${priceText}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    offers.push({
      id: url.match(/ID([A-Za-z0-9]+)$/)?.[1] || url,
      url,
      title,
      price: priceM ? parseNum(priceM[1]) : null,
      area: areaM ? parseNum(areaM[1]) : null,
      plotArea: null,
      pricePerM2: ppmM ? parseNum(ppmM[1]) : null,
      location: txt('[data-cy="advert-card-address"], [data-testid="advert-card-address"]'),
      image: $(el).find('img').first().attr('src') || null,
      createdAt: null,
      description: '',
    });
  });
  if (!offers.length && !/Nie znaleźliśmy|Brak wyników|0 ogłoszeń/i.test(html)) throw new Error('fallback HTML: nie znaleziono kart ofert');
  return { offers, total: null };
}

async function fetchOffers(target) {
  const html = await http.getText(target.fetchUrl);
  try {
    return { ...fromNextData(html), method: '__NEXT_DATA__' };
  } catch (e) {
    const r = fromHtml(html);
    return { ...r, method: 'HTML (fallback)', note: e.message };
  }
}

module.exports = {
  id: 'otodom',
  name: 'Otodom',
  multiLocation: true,
  coords: false,
  suggest,
  buildTargets,
  buildAreaTargets,
  fetchOffers,
  fetchDetail,
  _parsers: { fromNextData, fromHtml },
};
