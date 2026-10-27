'use strict';

const cheerio = require('cheerio');
const http = require('../http');
const { parseNum, snapUp } = require('../util');
const { PLOT_TYPES, HOUSE_TYPES } = require('../criteria');
const features = require('../features');

const ROOMS = ['one', 'two', 'three', 'four']; // "four" = 4 and more

const BASE = 'https://www.olx.pl';

// category ids: nieruchomosci/{dzialki|domy|mieszkania}/{sprzedaz|wynajem}
const CATEGORY = {
  plot: { sale: { id: 24, path: 'nieruchomosci/dzialki/sprzedaz' }, rent: { id: 25, path: 'nieruchomosci/dzialki/wynajem' } },
  house: { sale: { id: 18, path: 'nieruchomosci/domy/sprzedaz' }, rent: { id: 20, path: 'nieruchomosci/domy/wynajem' } },
  flat: { sale: { id: 14, path: 'nieruchomosci/mieszkania/sprzedaz' }, rent: { id: 15, path: 'nieruchomosci/mieszkania/wynajem' } },
};
const RADII = [0, 2, 5, 10, 15, 30, 50, 75, 100];

async function suggest(name) {
  const data = await http.getJson(`${BASE}/api/v1/geo-encoder/location-autocomplete/?query=${encodeURIComponent(name)}`);
  if (!Array.isArray(data?.data)) throw new Error('OLX: nieoczekiwana odpowiedź autocomplete');
  return data.data
    .filter((d) => d.city)
    .map((d) => ({
      id: String(d.city.id),
      name: d.district?.name || d.city.name,
      context: [d.city.name, d.municipality?.name && `gm. ${d.municipality.name}`, d.county?.name, d.region?.name].filter(Boolean).join(', '),
      level: d.district ? 'district' : 'town',
      lat: d.city.lat,
      lon: d.city.lon,
      label: [d.city.name, d.municipality?.name && `gm. ${d.municipality.name}`, d.county?.name && `pow. ${d.county.name}`, d.region?.name].filter(Boolean).join(', '),
      extra: { regionId: d.region?.id, cityId: d.city.id, districtId: d.district?.id || null, normalized: d.city.normalized_name },
    }));
}

function buildTargets(search, locs) {
  const cat = CATEGORY[search.propertyType]?.[search.transaction === 'rent' ? 'rent' : 'sale'];
  return locs.map((loc) => {
    const api = new URLSearchParams({
      offset: '0',
      limit: '50',
      category_id: String(cat.id),
      region_id: String(loc.extra.regionId),
      city_id: String(loc.extra.cityId),
      sort_by: 'created_at:desc',
    });
    const web = new URLSearchParams();
    web.set('search[order]', 'created_at:desc');
    if (loc.extra.districtId) {
      api.set('district_id', String(loc.extra.districtId));
      web.set('search[district_id]', String(loc.extra.districtId));
    }
    const f = (key, val) => {
      if (!val) return;
      api.set(key, String(val));
      web.set(`search[${key}]`, String(val));
    };
    f('filter_float_price:from', search.priceMin);
    f('filter_float_price:to', search.priceMax);
    f('filter_float_m:from', search.areaMin);
    f('filter_float_m:to', search.areaMax);
    if (search.propertyType === 'house') {
      f('filter_float_area:from', search.plotAreaMin);
      f('filter_float_area:to', search.plotAreaMax);
    }
    // OLX has the price/m² filter only for plots and for flats/houses on sale.
    if (search.propertyType === 'plot' || search.transaction !== 'rent') {
      f('filter_float_price_per_m:to', search.pricePerM2Max);
    }
    const many = (key, values) => {
      values.forEach((v, i) => {
        api.set(`${key}[${i}]`, v);
        web.set(`search[${key}][${i}]`, v);
      });
    };
    if (search.propertyType === 'plot' && search.plotTypes?.length && search.plotTypes.length < PLOT_TYPES.length) {
      many('filter_enum_type', PLOT_TYPES.filter((t) => search.plotTypes.includes(t.code)).map((t) => t.olx));
    }
    if (search.privateOnly) {
      api.set('owner_type', 'private');
      web.set('search[private_business]', 'private');
    }
    if (search.propertyType === 'house' && search.houseTypes?.length && search.houseTypes.length < HOUSE_TYPES.length) {
      many('filter_enum_builttype', HOUSE_TYPES.filter((t) => search.houseTypes.includes(t.code)).map((t) => t.olx));
    }
    if (search.propertyType === 'flat') {
      if (search.roomsMin || search.roomsMax) {
        const lo = Math.max(1, Math.min(4, search.roomsMin || 1));
        const hi = Math.min(4, search.roomsMax || 4);
        many('filter_enum_rooms', ROOMS.slice(lo - 1, hi));
      }
      if (search.floorMin !== null || search.floorMax !== null) {
        const lo = Math.max(-1, search.floorMin ?? -1);
        const hi = Math.min(11, search.floorMax ?? 11);
        const floors = [];
        for (let i = lo; i <= hi; i++) floors.push(`floor_${i}`);
        many('filter_enum_floor_select', floors);
      }
      if (search.market && search.transaction === 'sale') many('filter_enum_market', [search.market]);
    }
    if (search.radiusKm > 0) {
      const d = snapUp(search.radiusKm, RADII);
      api.set('distance', String(d));
      web.set('search[dist]', String(d));
    }
    const webUrl = `${BASE}/${cat.path}/${loc.extra.normalized}/?${web.toString()}`;
    return { label: loc.name, url: webUrl, fetchUrl: `${BASE}/api/v1/offers/?${api.toString()}`, webUrl };
  });
}

// OLX shows an approximate circle unless the seller chose an exact pin.
function coords(map) {
  if (!map || map.lat == null) return {};
  return { lat: map.lat, lon: map.lon, exactCoords: !!map.show_detailed };
}

function param(o, key) {
  return (o.params || []).find((p) => p.key === key)?.value;
}

function photoUrl(link) {
  if (!link) return null;
  return String(link).replace('{width}', '1000').replace('{height}', '750');
}

function attrsFrom(get, isBusiness, kindKey) {
  const a = {};
  if (typeof isBusiness === 'boolean') a.private = !isBusiness;
  if (kindKey) a.plotType = features.plotTypeCode(kindKey);
  const bt = get('builttype');
  if (bt) a.houseType = features.houseTypeCode(bt);
  const rooms = get('rooms');
  if (rooms && ROOMS.includes(rooms)) a.rooms = ROOMS.indexOf(rooms) + 1;
  const fl = get('floor_select');
  if (fl && /^floor_-?\d+$/.test(fl)) a.floor = parseInt(fl.slice(6), 10);
  const market = get('market');
  if (market === 'primary' || market === 'secondary') a.market = market;
  return a;
}

function fromApi(json) {
  if (!Array.isArray(json?.data)) throw new Error('brak pola data w odpowiedzi API');
  const offers = json.data.map((o) => {
    const price = param(o, 'price');
    const type = param(o, 'type');
    return {
      id: String(o.id),
      url: String(o.url || '').split('?')[0].split('#')[0],
      title: o.title,
      price: parseNum(price?.value ?? price?.converted_value),
      area: parseNum(param(o, 'm')?.key ?? param(o, 'm')?.label),
      plotArea: parseNum(param(o, 'area')?.key ?? param(o, 'area')?.label),
      pricePerM2: parseNum(param(o, 'price_per_m')?.key ?? param(o, 'price_per_m')?.label),
      location: [o.location?.city?.name, o.location?.district?.name].filter(Boolean).join(', '),
      image: photoUrl(o.photos?.[0]?.link),
      createdAt: o.created_time || null,
      description: [type?.label, String(o.description || '').replace(/<[^>]+>/g, ' ').slice(0, 3000)].filter(Boolean).join(' · '),
      kind: type?.key || null,
      attrs: attrsFrom((k) => param(o, k)?.key, o.business, type?.key),
      ...coords(o.map),
    };
  });
  return { offers, total: json.metadata?.total_elements ?? null };
}

// Fallback 1: the web listing page keeps its state in window.__PRERENDERED_STATE__.
function fromPrerendered(html) {
  const m = html.match(/window\.__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\.)*")/);
  if (!m) throw new Error('brak __PRERENDERED_STATE__');
  const st = JSON.parse(JSON.parse(m[1]));
  const L = st?.listing?.listing;
  if (!L || !Array.isArray(L.ads)) throw new Error('brak listing.ads w __PRERENDERED_STATE__');
  const offers = L.ads.map((o) => {
    const p = (k) => (o.params || []).find((x) => x.key === k);
    return {
      id: String(o.id),
      url: String(o.url || '').split('?')[0].split('#')[0],
      title: o.title,
      price: parseNum(o.price?.regularPrice?.value ?? o.price?.displayValue),
      area: parseNum(p('m')?.normalizedValue ?? p('m')?.value),
      plotArea: parseNum(p('area')?.normalizedValue ?? p('area')?.value),
      pricePerM2: parseNum(p('price_per_m')?.normalizedValue ?? p('price_per_m')?.value),
      location: [o.location?.cityName, o.location?.districtName].filter(Boolean).join(', '),
      image: photoUrl(Array.isArray(o.photos) ? (typeof o.photos[0] === 'string' ? o.photos[0] : o.photos[0]?.link) : null),
      createdAt: o.createdTime || null,
      description: [p('type')?.value, String(o.description || '').replace(/<[^>]+>/g, ' ').slice(0, 3000)].filter(Boolean).join(' · '),
      kind: p('type')?.normalizedValue || null,
      attrs: attrsFrom((k) => p(k)?.normalizedValue, typeof o.isBusiness === 'boolean' ? o.isBusiness : undefined, p('type')?.normalizedValue),
      ...coords(o.map),
    };
  });
  return { offers, total: L.totalElements ?? null };
}

// Fallback 2: plain HTML cards.
function fromHtml(html) {
  const $ = cheerio.load(html);
  const offers = [];
  $('[data-cy="l-card"]').each((_, el) => {
    const a = $(el).find('a[href*="/oferta/"]').first();
    let href = a.attr('href');
    if (!href) return;
    if (!href.startsWith('http')) href = BASE + href;
    const text = $(el).text().replace(/\s+/g, ' ');
    const areaM = text.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*m²/);
    offers.push({
      id: $(el).attr('id') || href,
      url: href.split('?')[0].split('#')[0],
      title: $(el).find('h4, h6, [data-cy="ad-card-title"]').first().text().trim() || a.text().trim(),
      price: parseNum($(el).find('[data-testid="ad-price"]').first().text()),
      area: areaM ? parseNum(areaM[1]) : null,
      plotArea: null,
      pricePerM2: null,
      location: $(el).find('[data-testid="location-date"]').first().text().split(' - ')[0].trim(),
      image: $(el).find('img').first().attr('src') || null,
      createdAt: null,
      description: '',
    });
  });
  if (!offers.length) throw new Error('strona OLX bez listy ofert i bez danych (prawdopodobnie blokada antybotowa)');
  return { offers, total: null };
}

async function fetchOffers(target) {
  const errors = [];
  try {
    const json = await http.getJson(target.fetchUrl);
    return { ...fromApi(json), method: 'API /api/v1/offers' };
  } catch (e) {
    errors.push(`API: ${e.message}`);
  }
  let html;
  try {
    html = await http.getText(target.webUrl);
  } catch (e) {
    errors.push(`strona: ${e.message}`);
    const err = new Error(errors.join(' | '));
    err.status = e.status;
    throw err;
  }
  try {
    return { ...fromPrerendered(html), method: '__PRERENDERED_STATE__ (fallback)', note: errors.join(' | ') };
  } catch (e) {
    errors.push(e.message);
  }
  return { ...fromHtml(html), method: 'HTML (fallback)', note: errors.join(' | ') };
}

module.exports = {
  id: 'olx',
  name: 'OLX',
  multiLocation: false,
  coords: true,
  suggest,
  buildTargets,
  fetchOffers,
  _parsers: { fromApi, fromPrerendered, fromHtml },
};
