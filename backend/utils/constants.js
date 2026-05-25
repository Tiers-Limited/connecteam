/**
 * Tip calculation — default shifts (e.g. The Cove when not single-shift, or other locations).
 * AM: 06:00 – 15:00, PM: 15:00 – 23:00
 * Casa del Mar & Oranjestad: AM 06:00 – 14:00, PM 14:00 – 23:00
 */
const PRODUCTION_DEDUCTION_PERCENT = 0.054;

const SHIFT_BOUNDARIES = {
  AM_START: '06:00',
  AM_END: '15:00',
  PM_START: '15:00',
  PM_END: '23:00',
};

/** AM/PM split for Oranjestad and Casa del Mar (clock-based hours from Connecteam). */
const SHIFT_BOUNDARIES_CASA_ORANJESTAD = {
  AM_START: '06:00',
  AM_END: '14:00',
  PM_START: '14:00',
  PM_END: '23:00',
};

const LOCATION_SINGLE_SHIFT = {
  name: 'The Cove',
  key: 'the cove',
  shiftStart: '06:00',
  shiftEnd: '16:00',
};

/**
 * Canonical locations for Connecteam sync and tip/tardiness scoping.
 * Seeded into MongoDB on server startup (see seedLocations). Add new sites here.
 */
const LOCATIONS = [
  { key: 'oranjestad', name: 'Oranjestad' },
  { key: 'casa del mar', name: 'Casa del Mar' },
  { key: 'the cove', name: 'The Cove' },
  { key: 'royal plaza', name: 'Royal Plaza' },
  { key: 'pastry', name: 'Pastry' },
  // { key: 'drive thru', name: 'Drive Thru' },
];

const LOCATION_KEYS_EARLY_PM_START = new Set(['oranjestad', 'casa del mar']);

/**
 * @param {string} [locationName] - Location document name
 * @returns {{ AM_START: string, AM_END: string, PM_START: string, PM_END: string }}
 */
function shiftBoundariesForLocationName(locationName) {
  const n = (locationName || '').trim().toLowerCase();
  const found = LOCATIONS.find((l) => (l.name || '').toLowerCase() === n);
  if (found && LOCATION_KEYS_EARLY_PM_START.has(found.key)) {
    return SHIFT_BOUNDARIES_CASA_ORANJESTAD;
  }
  return SHIFT_BOUNDARIES;
}

/**
 * Tardiness deduction tiers (Phase 2)
 * 0–5 min → 0%, >5–10 min → 15%, >10 min → 20%
 */
const TARDINESS_TIERS = [
  { maxMinutes: 5, deductionPercent: 0 },
  { maxMinutes: 10, deductionPercent: 0.15 },
  { maxMinutes: Infinity, deductionPercent: 0.2 },
];

const ROUND_DECIMALS = 3;

/**
 * Job title to tip multiplier mapping
 * Maps job titles to their tip multiplier (0.0 to 1.0)
 * Default multiplier is 1.0 (100%) - set specific jobs that receive less
 * Example: Dishwasher gets 0.75 (75% of the calculated tips)
 */
const JOB_TIP_MULTIPLIERS = {
  default: 1.0, // Default multiplier if job not found
  'Dishwasher': 0.75,
  // Add more job titles as needed
};

module.exports = {
  PRODUCTION_DEDUCTION_PERCENT,
  SHIFT_BOUNDARIES,
  SHIFT_BOUNDARIES_CASA_ORANJESTAD,
  LOCATION_KEYS_EARLY_PM_START,
  shiftBoundariesForLocationName,
  LOCATION_SINGLE_SHIFT,
  TARDINESS_TIERS,
  ROUND_DECIMALS,
  LOCATIONS,
  JOB_TIP_MULTIPLIERS,
};
