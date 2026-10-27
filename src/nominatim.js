'use strict';

// OpenStreetMap Nominatim: administrative units and TERYT codes (teryt:terc, teryt:simc tags).
// Usage policy: at most 1 request per second and an identifying User-Agent.

const http = require('./http');
const { sleep } = require('./util');

const BASE = 'https://nominatim.openstreetmap.org';
const UA = 'estate-tracker (+https://github.com/Toki1043/estate-tracker)';

let queue = Promise.resolve();
let lastAt = 0;

function call(path) {
  const run = async () => {
    const wait = lastAt + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    return http.getJson(`${BASE}${path}`, { headers: { 'user-agent': UA }, timeoutMs: 15000, retries: 1 });
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

const common = 'format=jsonv2&addressdetails=1&extratags=1&accept-language=pl';

/** zoom 8 = county (or a city with county rights), 10 = town/village. */
const reverse = (lat, lon, zoom) => call(`/reverse?${common}&lat=${lat}&lon=${lon}&zoom=${zoom}`);

const search = (q, limit = 5) => call(`/search?${common}&countrycodes=pl&limit=${limit}&q=${encodeURIComponent(q)}`);

module.exports = { reverse, search };
