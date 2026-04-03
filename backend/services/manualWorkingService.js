const ManualWorking = require('../models/ManualWorking');
const {
  getAppTimezone,
  dateStringToUtcRange,
  dateRangeToUtcBounds,
} = require('../utils/dateUtils');

function ymd(date) {
  return typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

/**
 * Create or update a manual working entry
 */
async function upsertManualWorking(employeeId, locationId, date, amHours, pmHours, amTips, pmTips, reason, notes = '') {
  const dateStr = ymd(date);
  const tz = getAppTimezone();
  const { startMs, endMs } = dateStringToUtcRange(dateStr, tz);
  const dayStart = new Date(startMs);

  const existing = await ManualWorking.findOne({
    employeeId,
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  });

  const set = {
    amHours,
    pmHours,
    amTips,
    pmTips,
    reason,
    notes,
    date: dayStart,
  };

  if (existing) {
    return ManualWorking.findByIdAndUpdate(existing._id, { $set: set }, { new: true })
      .populate('employeeId', 'name')
      .populate('locationId', 'name');
  }
  return ManualWorking.create({ employeeId, locationId, ...set }).then((doc) =>
    ManualWorking.findById(doc._id).populate('employeeId', 'name').populate('locationId', 'name'),
  );
}

async function getManualWorking(employeeId, locationId, date) {
  const { startMs, endMs } = dateStringToUtcRange(ymd(date), getAppTimezone());
  return ManualWorking.findOne({
    employeeId,
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  })
    .populate('employeeId', 'name')
    .populate('locationId', 'name');
}

async function getManualWorkingByLocationDate(locationId, date) {
  const { startMs, endMs } = dateStringToUtcRange(ymd(date), getAppTimezone());
  return ManualWorking.find({
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  })
    .populate('employeeId', 'name')
    .sort({ employeeId: 1 });
}

async function getManualWorkingByLocationDateRange(locationId, startDate, endDate) {
  const { startMs, endMs } = dateRangeToUtcBounds(ymd(startDate), ymd(endDate), getAppTimezone());
  return ManualWorking.find({
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  })
    .populate('employeeId', 'name')
    .sort({ date: 1, employeeId: 1 });
}

async function getEmployeeManualWorkingByDateRange(employeeId, startDate, endDate) {
  const { startMs, endMs } = dateRangeToUtcBounds(ymd(startDate), ymd(endDate), getAppTimezone());
  return ManualWorking.find({
    employeeId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  })
    .populate('locationId', 'name')
    .sort({ date: 1 });
}

async function deleteManualWorking(employeeId, locationId, date) {
  const { startMs, endMs } = dateStringToUtcRange(ymd(date), getAppTimezone());
  return ManualWorking.findOneAndDelete({
    employeeId,
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  });
}

async function getTotalManualTips(employeeId, locationId, startDate, endDate) {
  const { startMs, endMs } = dateRangeToUtcBounds(ymd(startDate), ymd(endDate), getAppTimezone());
  const entries = await ManualWorking.find({
    employeeId,
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  });
  const total = entries.reduce((sum, entry) => sum + entry.amTips + entry.pmTips, 0);
  return Math.round(total * 100) / 100;
}

async function getTotalManualHours(employeeId, locationId, startDate, endDate) {
  const { startMs, endMs } = dateRangeToUtcBounds(ymd(startDate), ymd(endDate), getAppTimezone());
  const entries = await ManualWorking.find({
    employeeId,
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  });
  const total = entries.reduce((sum, entry) => sum + entry.amHours + entry.pmHours, 0);
  return Math.round(total * 100) / 100;
}

module.exports = {
  upsertManualWorking,
  getManualWorking,
  getManualWorkingByLocationDate,
  getManualWorkingByLocationDateRange,
  getEmployeeManualWorkingByDateRange,
  deleteManualWorking,
  getTotalManualTips,
  getTotalManualHours,
};
