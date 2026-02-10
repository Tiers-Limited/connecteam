const Location = require('../models/Location');
const { LOCATIONS } = require('../utils/constants');

/**
 * Ensure the 4 fixed locations (Oranjestad, Casa del Mar, The Cove, Drive Thru) exist.
 * Used for Connecteams sync; do not add locations manually for staff tips.
 */
async function seedLocations() {
  for (const { name } of LOCATIONS) {
    await Location.findOneAndUpdate(
      { name },
      { name, isActive: true },
      { upsert: true, new: true }
    );
  }
}

module.exports = { seedLocations };
