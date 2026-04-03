const DailyTipAdjustment = require('../models/DailyTipAdjustment');
const { getAppTimezone, dateStringToUtcRange } = require('../utils/dateUtils');

function ymdFromInput(date) {
  return typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

async function getByLocationAndDate(locationId, date) {
  const dateStr = ymdFromInput(date);
  const { startMs, endMs } = dateStringToUtcRange(dateStr, getAppTimezone());
  return DailyTipAdjustment.find({
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  })
    .populate('employeeId', 'name')
    .sort({ createdAt: -1 })
    .lean();
}

async function upsert(locationId, date, employeeId, type, amount, reason = '', meta = {}) {
  const dateStr = ymdFromInput(date);
  const tz = getAppTimezone();
  const { startMs, endMs } = dateStringToUtcRange(dateStr, tz);
  const dayStart = new Date(startMs);

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    await DailyTipAdjustment.deleteMany({
      locationId,
      employeeId,
      type,
      date: { $gte: new Date(startMs), $lte: new Date(endMs) },
    });
    return null;
  }

  const set = {
    locationId,
    date: dayStart,
    employeeId,
    type,
    amount: amt,
    reason: String(reason || ''),
  };

  if (meta.createdBy != null) set.createdBy = meta.createdBy;
  if (meta.createdByEmail != null) set.createdByEmail = meta.createdByEmail;
  if (meta.createdByUsername != null) set.createdByUsername = meta.createdByUsername;
  if (meta.createdByRole != null) set.createdByRole = meta.createdByRole;

  const existing = await DailyTipAdjustment.findOne({
    locationId,
    employeeId,
    type,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  });

  if (existing) {
    return DailyTipAdjustment.findByIdAndUpdate(existing._id, { $set: set }, { new: true });
  }
  return DailyTipAdjustment.create(set);
}

module.exports = {
  getByLocationAndDate,
  upsert,
};
