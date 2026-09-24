// api/places.js — bay places (housing, sports, tours, offices, startups) for the map.
// same store, same expiry rule and same cache as /api/events; places simply do not
// expire unless they carry an explicit expiresAt. see api/_baydata.js.
const bay = require("./_baydata.js");

module.exports = bay.storeHandler("places");
