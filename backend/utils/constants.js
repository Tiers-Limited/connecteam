/**
 * Tip calculation constants per Front Staff - Tips Calculation Logic PDF
 * AM: 06:00 – 15:00, PM: 15:00 – 23:00
 */
const PRODUCTION_DEDUCTION_PERCENT = 0.04;

const SHIFT_BOUNDARIES = {
  AM_START: '06:00',
  AM_END: '15:00',   // PM starts at 15:00
  PM_START: '15:00',
  PM_END: '23:00',
};

/**
 * Fixed locations for Connecteams sync (from demo: Oranjestad, Casa del Mar, The Cove, Drive Thru).
 * Do not add locations manually for staff tips; use these four.
 */
const LOCATIONS = [
  { key: 'oranjestad', name: 'Oranjestad' },
  { key: 'casa del mar', name: 'Casa del Mar' },
  { key: 'the cove', name: 'The Cove' },
  { key: 'drive thru', name: 'Drive Thru' },
];

/**
 * Tardiness deduction tiers (Phase 2)
 * 0–5 min → 0%, >5–10 min → 15%, >10 min → 20%
 */
const TARDINESS_TIERS = [
  { maxMinutes: 5, deductionPercent: 0 },
  { maxMinutes: 10, deductionPercent: 0.15 },
  { maxMinutes: Infinity, deductionPercent: 0.2 },
];

const ROUND_DECIMALS = 2;

module.exports = {
  PRODUCTION_DEDUCTION_PERCENT,
  SHIFT_BOUNDARIES,
  TARDINESS_TIERS,
  ROUND_DECIMALS,
  LOCATIONS,
};
