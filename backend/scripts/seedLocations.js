const Location = require('../models/Location');
const { LOCATIONS } = require('../utils/constants');

/**
 * Ensure all LOCATIONS from constants exist and stay active; deactivate removed names.
 * Runs on every server start so locations persist across restarts.
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
