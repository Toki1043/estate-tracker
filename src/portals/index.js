'use strict';

const list = [
  require('./otodom'),
  require('./olx'),
  require('./gratka'),
  require('./morizon'),
  require('./nonline'),
];

const byId = Object.fromEntries(list.map((p) => [p.id, p]));

module.exports = { list, byId };
