'use strict';

const { sleep } = require('./util');

const UA =
  process.env.HTTP_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} dla ${shortUrl(url)}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    return x.host + x.pathname;
  } catch {
    return String(u).slice(0, 80);
  }
}

/**
 * Plain HTTP request with a timeout and one polite retry for network errors / 5xx.
 * 4xx answers (including 403 from anti-bot protections) are not retried.
 */
async function request(url, opts = {}) {
  const { method = 'GET', headers = {}, body, timeoutMs = 25000, retries = 1, accept } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'user-agent': UA,
          'accept-language': 'pl-PL,pl;q=0.9,en;q=0.6',
          accept: accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          ...headers,
        },
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new HttpError(res.status, url, text.slice(0, 500));
        if (res.status >= 500 && attempt < retries) {
          lastErr = err;
          await sleep(4000 + attempt * 4000);
          continue;
        }
        throw err;
      }
      return { status: res.status, url: res.url, text, headers: res.headers };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      lastErr = e.name === 'AbortError' ? new Error(`Przekroczono czas odpowiedzi (${shortUrl(url)})`) : e;
      if (attempt < retries) {
        await sleep(4000 + attempt * 4000);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function getText(url, opts) {
  return (await request(url, opts)).text;
}

async function getJson(url, opts = {}) {
  const r = await request(url, { accept: 'application/json', ...opts });
  try {
    return JSON.parse(r.text);
  } catch {
    throw new Error(`Niepoprawny JSON z ${shortUrl(url)}`);
  }
}

async function postJson(url, payload, opts = {}) {
  const r = await request(url, {
    method: 'POST',
    accept: 'application/json',
    body: JSON.stringify(payload),
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  try {
    return JSON.parse(r.text);
  } catch {
    throw new Error(`Niepoprawny JSON z ${shortUrl(url)}`);
  }
}

module.exports = { request, getText, getJson, postJson, HttpError, UA };
