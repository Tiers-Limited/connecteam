
const PRODUCTION_DEDUCTION_PERCENT = 0.054;

const SHIFT_BOUNDARIES = {
  AM_START: '06:00',
  AM_END: '15:00',
  PM_START: '15:00',
  PM_END: '23:00',
};

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


const LOCATIONS = [
  { key: 'oranjestad', name: 'Oranjestad' },
  { key: 'casa del mar', name: 'Casa del Mar' },
  { key: 'the cove', name: 'The Cove' },
  { key: 'royal plaza', name: 'Royal Plaza' },
  { key: 'pastry', name: 'Pastry' },
  // { key: 'drive thru', name: 'Drive Thru' },
];

const LOCATION_KEYS_EARLY_PM_START = new Set(['oranjestad', 'casa del mar']);


function shiftBoundariesForLocationName(locationName) {
  const n = (locationName || '').trim().toLowerCase();
  const found = LOCATIONS.find((l) => (l.name || '').toLowerCase() === n);
  if (found && LOCATION_KEYS_EARLY_PM_START.has(found.key)) {
    return SHIFT_BOUNDARIES_CASA_ORANJESTAD;
  }
  return SHIFT_BOUNDARIES;
}

const TARDINESS_TIERS = [
  { maxMinutes: 5, deductionPercent: 0 },
  { maxMinutes: 10, deductionPercent: 0.15 },
  { maxMinutes: Infinity, deductionPercent: 0.2 },
];

const ROUND_DECIMALS = 3;

const JOB_TIP_MULTIPLIERS = {
  default: 1.0, 
  'Dishwasher': 0.75,

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
