// api/events.js — live bay events for the map. reads the flat store, drops anything
// past its expiry, and serves the same shape as /api/places. cached 15 min at the
// edge like /api/github; freshness truth stays on the record (fetchedAt) and the
// expiry rule (see api/_baydata.js).
const bay = require("./_baydata.js");

module.exports = bay.storeHandler("events");
