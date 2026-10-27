'use strict';

// In-process events for the desktop app (system notifications). The server has no listeners.
//   'offers'  ({ search, offers })  new offers matching a search
//   'warning' (text)                portal health warnings
const { EventEmitter } = require('events');

module.exports = new EventEmitter();
