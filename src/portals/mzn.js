'use strict';

// Gratka.pl and Morizon.pl run on the same GraphQL backend (Grupa Morizon-Gratka).
const http = require('../http');
const { parseNum } = require('../util');
const crypto = require('crypto');
const { PLOT_TYPES, HOUSE_TYPES, MEDIA } = require('../criteria');
const geo = require('../geo');

const SUGGEST_QUERY = `query getLocationSuggestions($after: String, $first: Int, $propertyTransaction: PropertyTransaction, $propertyType: PropertyType, $searchQuery: String, $includeBuildings: Boolean) {
  getLocationSuggestions(after: $after, first: $first, propertyTransaction: $propertyTransaction, propertyType: $propertyType, searchQuery: $searchQuery, includeBuildings: $includeBuildings) {
    edges { node { id name description suggestion map { center { latitude longitude } } } }
  }
}`;

const ENCODE_QUERY = `query encodeListingParameters($parameters: ListingParametersInput!) {
  encodeListingParameters(parameters: $parameters) {
    url
    totalCount
    listingParameters { locations { id name nameFull type } }
  }
}`;

const SEARCH_QUERY = `query getPropertyListingData($url: String!) {
  searchResult: searchProperties(url: $url) {
    properties {
      totalCount
      nodes {
        addedAt(format: "yyyy-MM-dd")
        area
        id
        title
        url
        description(maxLength: 400)
        location { location street map { center { latitude longitude } } }
        contact { company { type } person { type } }
        photos { id name }
        price { amount currency }
        priceM2 { amount }
      }
    }
  }
}`;

const TYPE = { plot: 'PLOT', house: 'HOUSE', flat: 'FLAT' };

const DETAIL_QUERY = `query getPropertyDetails($url: String!) {
  p: getProperty(url: $url) {
    description
    detailedInformation(dateFormat: "dd.MM.y") { label value }
    utilities { label }
    facilities { label }
    equipments { label }
    marketType
    numberOfRoomsCount
    floor
    location { map { center { latitude longitude } } }
    contact { company { type } person { type } }
  }
}`;

function privateFrom(contact) {
  if (!contact) return undefined;
  if (contact.company?.type) return false;
  if (contact.person?.type) return /OWNER|PRIVATE|INDIVIDUAL/i.test(contact.person.type) || !/AGENT|DEVELOPER/i.test(contact.person.type);
  return undefined;
}

// "Woda (jest)" -> "Woda: jest"; "Garaż" -> "Garaż: tak"
function labelToKv(l) {
  const m = String(l || '').match(/^(.*?)\s*\((.*)\)\s*$/);
  return m ? `${m[1]}: ${m[2]}` : `${l}: tak`;
}

function levelOf(description) {
  const first = String(description || '').split(',')[0].trim().toLowerCase();
  if (first === 'wieś' || first === 'miasto' || first === 'osada' || first === 'kolonia') return 'town';
  if (first === 'gmina') return 'commune';
  if (first === 'powiat') return 'county';
  if (first === 'województwo') return 'region';
  if (first === 'ulica') return 'street';
  if (first.includes('dzielnica') || first.includes('osiedle') || first.includes('część')) return 'district';
  return first || 'other';
}

// Same id for the GraphQL and the JSON-LD parser: the number at the end of the offer URL.
function idFromUrl(u) {
  return String(u || '').match(/(\d+)\/?$/)?.[1] || null;
}

// The list API returns generic titles like "działka lub grunt na sprzedaż": add size and place.
function betterTitle(n) {
  const t = String(n.title || '').trim();
  const loc = Array.isArray(n.location?.location) ? n.location.location : [];
  const place = loc[loc.length - 1];
  const area = parseNum(n.area);
  const nice = t.charAt(0).toUpperCase() + t.slice(1);
  return [nice, area ? `${area.toLocaleString('pl-PL').replace(/ /g, ' ')} m²` : null, place].filter(Boolean).join(', ');
}

function create({ id, name, base, api, client, type }) {
  const headers = { 'x-mzn-client': client, 'x-mzn-type': type, origin: base, referer: `${base}/` };

  async function gql(query, variables) {
    const res = await http.postJson(api, { query, variables }, { headers });
    if (res.errors?.length) throw new Error(`${name} GraphQL: ${res.errors[0].message}`);
    return res.data;
  }

  async function suggest(q) {
    const data = await gql(SUGGEST_QUERY, { first: 15, searchQuery: q, includeBuildings: false });
    const edges = data?.getLocationSuggestions?.edges;
    if (!Array.isArray(edges)) throw new Error(`${name}: nieoczekiwana odpowiedź podpowiedzi`);
    return edges.map(({ node }) => ({
      id: String(node.id),
      name: node.name,
      context: node.description,
      level: levelOf(node.description),
      lat: node.map?.center?.latitude ?? null,
      lon: node.map?.center?.longitude ?? null,
      label: `${node.name} (${node.description})`,
    }));
  }

  async function encode(sp) {
    const data = await gql(ENCODE_QUERY, {
      parameters: { mode: 'PROPERTY', searchOrder: { sortKey: 'ADDED_AT', sortOrder: 'DESC' }, searchParameters: sp },
    });
    const enc = data?.encodeListingParameters;
    if (!enc?.url) throw new Error(`${name}: nie udało się zbudować URL`);
    return enc;
  }

  async function buildTargets(search, locs) {
    const sp = filterParams(search);
    sp.location = { identifiers: locs.map((l) => ({ id: l.id })) };
    if (search.radiusKm > 0) sp.location.radius = Math.round(search.radiusKm);
    const enc = await encode(sp);
    return [{ label: locs.map((l) => l.name).join(', '), url: base + enc.url, path: enc.url, reportedTotal: enc.totalCount }];
  }

  /**
   * One URL per drawn area. The portal stores the polygon and puts a new id (location[custom_area]) in
   * every URL it encodes, so the baseline key is derived from the polygon, not from the URL.
   */
  async function buildAreaTargets(search, areas) {
    const out = [];
    for (const [i, area] of areas.entries()) {
      const sp = filterParams(search);
      sp.location = { mapArea: geo.closedRing(area).map(([lat, lon]) => ({ latitude: lat, longitude: lon })) };
      const enc = await encode(sp);
      const stableKey = `${id}|area|${crypto.createHash('sha1').update(JSON.stringify(sp)).digest('hex').slice(0, 12)}`;
      out.push({ label: `Obszar ${i + 1}`, url: base + enc.url, path: enc.url, reportedTotal: enc.totalCount, area: i, stableKey, encodeParams: sp });
    }
    return out;
  }

  function filterParams(search) {
    const sp = {
      type: [TYPE[search.propertyType]],
      transaction: search.transaction === 'rent' ? 'RENT' : 'SALE',
    };
    if (search.priceMin) sp.priceFrom = String(search.priceMin);
    if (search.priceMax) sp.priceTo = String(search.priceMax);
    if (search.areaMin) sp.areaFrom = String(search.areaMin);
    if (search.areaMax) sp.areaTo = String(search.areaMax);
    if (search.pricePerM2Max) sp.priceM2To = String(search.pricePerM2Max);
    if (search.propertyType === 'house') {
      if (search.plotAreaMin) sp.plotAreaFrom = String(search.plotAreaMin);
      if (search.plotAreaMax) sp.plotAreaTo = String(search.plotAreaMax);
    }
    if (search.propertyType === 'plot' && search.plotTypes?.length && search.plotTypes.length < PLOT_TYPES.length) {
      sp.dictionaries = [PLOT_TYPES.filter((t) => search.plotTypes.includes(t.code)).map((t) => t.mzn)];
    }
    if (search.propertyType === 'house' && search.houseTypes?.length && search.houseTypes.length < HOUSE_TYPES.length) {
      sp.dictionaries = [HOUSE_TYPES.filter((t) => search.houseTypes.includes(t.code)).map((t) => t.mzn)];
    }
    if (search.privateOnly) sp.ownerType = ['PRIVATE'];
    const attributes = {};
    // The portal's media filter means "on the plot"; with "media w drodze" accepted we check offers ourselves.
    if (search.propertyType === 'plot' && search.media?.length && !search.mediaAllowRoad) {
      for (const m of MEDIA.filter((x) => search.media.includes(x.code))) attributes[m.mzn] = true;
    }
    if (search.propertyType !== 'plot') {
      if (search.roomsMin) sp.numberOfRoomsFrom = search.roomsMin;
      if (search.roomsMax) sp.numberOfRoomsTo = search.roomsMax;
    }
    if (search.propertyType === 'house' && search.buildYearMin) sp.buildYearFrom = String(search.buildYearMin);
    if (search.propertyType === 'flat') {
      if (search.floorMin !== null) sp.floorFrom = search.floorMin;
      if (search.floorMax !== null) sp.floorTo = search.floorMax;
      if (search.market) sp.marketType = [search.market.toUpperCase()];
      if (search.elevator) attributes.elevator = true;
      if (search.balcony) attributes.balcony = true;
      if (search.garden) attributes.garden = true;
      if (search.parking) attributes.parkingPlaces = true;
    }
    if (Object.keys(attributes).length) sp.attributes = attributes;
    return sp;
  }

  function photo(p) {
    if (!p?.id) return null;
    return `https://img1.staticmorizon.com.pl/thumb/${p.id}/3x2_l:fill_and_crop/${p.name || 'foto'}.jpg`;
  }

  function fromGraphql(data) {
    const props = data?.searchResult?.properties;
    if (!props || !Array.isArray(props.nodes)) throw new Error('brak searchResult.properties');
    const offers = props.nodes.map((n) => ({
      id: idFromUrl(n.url) || String(n.id),
      url: n.url?.startsWith('http') ? n.url : base + n.url,
      title: betterTitle(n),
      price: parseNum(n.price?.amount),
      area: parseNum(n.area),
      plotArea: null,
      pricePerM2: parseNum(n.priceM2?.amount),
      location: [n.location?.street, ...(Array.isArray(n.location?.location) ? [...n.location.location].reverse() : [])].filter(Boolean).join(', '),
      image: photo(n.photos?.[0]),
      createdAt: n.addedAt || null,
      description: n.description || '',
      lat: n.location?.map?.center?.latitude ?? null,
      lon: n.location?.map?.center?.longitude ?? null,
      exactCoords: true,
      attrs: { private: privateFrom(n.contact) },
    }));
    return { offers, total: props.totalCount ?? null };
  }

  // Fallback: schema.org JSON-LD embedded in the listing page.
  function fromJsonLd(html) {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    for (const b of blocks) {
      let j;
      try {
        j = JSON.parse(b[1]);
      } catch {
        continue;
      }
      const list = j?.offers?.offers;
      if (!Array.isArray(list)) continue;
      const offers = list.map((o) => {
        const nameStr = String(o.name || '');
        const areaM = nameStr.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*m²/);
        return {
          id: idFromUrl(o.url) || o.url,
          url: o.url,
          title: nameStr,
          price: parseNum(o.price),
          area: areaM ? parseNum(areaM[1]) : null,
          plotArea: null,
          pricePerM2: null,
          location: o.itemOffered?.address?.addressLocality || '',
          image: o.image || null,
          createdAt: null,
          description: o.itemOffered?.description || '',
        };
      });
      return { offers, total: null };
    }
    throw new Error('brak ofert w JSON-LD');
  }

  async function fetchDetail(o) {
    const path = o.url.startsWith(base) ? o.url.slice(base.length) : new URL(o.url).pathname;
    const data = await gql(DETAIL_QUERY, { url: path });
    const p = data?.p;
    if (!p) throw new Error(`${name}: brak danych oferty`);
    const kv = (p.detailedInformation || []).map((d) => `${d.label}: ${d.value}`);
    if (p.utilities?.length) kv.push(`Media: ${p.utilities.map((u) => u.label).join(', ')}`);
    for (const x of [...(p.facilities || []), ...(p.equipments || [])]) kv.push(labelToKv(x.label));
    const attrs = { private: privateFrom(p.contact) };
    if (p.marketType) attrs.market = /PRIMARY/i.test(p.marketType) ? 'primary' : 'secondary';
    if (p.numberOfRoomsCount) attrs.rooms = p.numberOfRoomsCount;
    if (p.floor !== null && p.floor !== undefined && Number.isFinite(Number(p.floor))) attrs.floor = Number(p.floor);
    return {
      attrs,
      kv,
      description: String(p.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      lat: p.location?.map?.center?.latitude ?? null,
      lon: p.location?.map?.center?.longitude ?? null,
      exactCoords: true,
    };
  }

  async function fetchOffers(target) {
    try {
      let data = await gql(SEARCH_QUERY, { url: target.path });
      // A stored drawn area may expire on the portal: encode the polygon again and retry once.
      if (target.encodeParams && !data?.searchResult?.properties && !target.reEncoded) {
        const enc = await encode(target.encodeParams);
        Object.assign(target, { path: enc.url, url: base + enc.url, reEncoded: true });
        data = await gql(SEARCH_QUERY, { url: target.path });
      }
      return { ...fromGraphql(data), method: 'GraphQL searchProperties' };
    } catch (e) {
      const html = await http.getText(target.url);
      return { ...fromJsonLd(html), method: 'JSON-LD (fallback)', note: e.message };
    }
  }

  return {
    id,
    name,
    multiLocation: true,
    coords: true,
    suggest,
    buildTargets,
    buildAreaTargets,
    fetchOffers,
    fetchDetail,
    _parsers: { fromGraphql, fromJsonLd },
  };
}

module.exports = { create };
