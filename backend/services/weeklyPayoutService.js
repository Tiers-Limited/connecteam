const WeeklyTardiness = require('../models/WeeklyTardiness');
const ManualDeduction = require('../models/ManualDeduction');

/** Normalize week start to UTC midnight (YYYY-MM-DD) so it matches getWeeklyPayout. */
function toWeekStartUTC(weekStart) {
  const str = typeof weekStart === 'string' ? weekStart.slice(0, 10) : weekStart.toISOString().slice(0, 10);
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

async function getTardiness(locationId, weekStart) {
  const ws = toWeekStartUTC(weekStart);
  return WeeklyTardiness.find({ locationId, weekStart: ws }).populate('employeeId', 'name').lean();
}

async function upsertTardiness(employeeId, locationId, weekStart, totalTardinessMinutes) {
  const ws = toWeekStartUTC(weekStart);
  return WeeklyTardiness.findOneAndUpdate(
    { employeeId, locationId, weekStart: ws },
    { $set: { totalTardinessMinutes } },
    { new: true, upsert: true }
  );
}

async function getManualDeductions(locationId, weekStart) {
  const ws = toWeekStartUTC(weekStart);
  return ManualDeduction.find({ locationId, weekStart: ws }).populate('employeeId', 'name').lean();
}

async function upsertManualDeduction(employeeId, locationId, weekStart, amount, reason) {
  const ws = toWeekStartUTC(weekStart);
  if (amount === 0) {
    await ManualDeduction.deleteOne({ employeeId, locationId, weekStart: ws });
    return { removed: true };
  }
  return ManualDeduction.findOneAndUpdate(
    { employeeId, locationId, weekStart: ws },
    { $set: { amount, reason } },
    { new: true, upsert: true }
  );
}

module.exports = {
  getTardiness,
  upsertTardiness,
  getManualDeductions,
  upsertManualDeduction,
};
