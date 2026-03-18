const Location = require('../models/Location');
const { LOCATIONS } = require('../utils/constants');

/**
 * Ensure the 4 fixed locations (Oranjestad, Casa del Mar, The Cove, Drive Thru) exist.
 * Used for Connecteams sync; do not add locations manually for staff tips.
 */
async function seedLocations() {
  const configuredNames = LOCATIONS.map((l) => l.name);

  // Ensure configured locations are active
  for (const { name } of LOCATIONS) {
    await Location.findOneAndUpdate(
      { name },
      { name, isActive: true },
      { upsert: true, new: true }
    );
  }

  // Deactivate any locations that are no longer in the configured list
  await Location.updateMany(
    { name: { $nin: configuredNames } },
    { isActive: false }
  );
}

module.exports = { seedLocations };
