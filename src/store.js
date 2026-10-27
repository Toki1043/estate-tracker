'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = new Map();

function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function load(name, fallback) {
  if (cache.has(name)) return cache.get(name);
  let value = fallback;
  try {
    value = JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[store] Nie można odczytać ${name}.json:`, e.message);
  }
  cache.set(name, value);
  return value;
}

// Atomic write: temp file + rename, so a crash never leaves half-written JSON.
function save(name, value) {
  cache.set(name, value);
  const target = file(name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

function update(name, fallback, fn) {
  const value = load(name, fallback);
  const next = fn(value) ?? value;
  save(name, next);
  return next;
}

module.exports = { load, save, update, DATA_DIR };
