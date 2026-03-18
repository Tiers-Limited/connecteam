const DailyTipAdjustment = require('../models/DailyTipAdjustment');

/** Normalize date to UTC midnight (YYYY-MM-DD) so save and calculation always match. */
function toUTCMidnight(date) {
  const str =
    typeof date === 'string'
      ? date.slice(0, 10)
      : date.toISOString().slice(0, 10);
  return new Date(str + 'T00:00:00.000Z');
}

async function getByLocationAndDate(locationId, date) {
  const d = toUTCMidnight(date);
  return DailyTipAdjustment.find({ locationId, date: d })
    .populate('employeeId', 'name')
    .sort({ createdAt: -1 })
    .lean();
}

async function upsert(locationId, date, employeeId, type, amount, reason = '', meta = {}) {
  const d = toUTCMidnight(date);

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    await DailyTipAdjustment.deleteOne({ locationId, date: d, employeeId, type });
    return null;
  }

  const set = {
    locationId,
    date: d,
    employeeId,
    type,
    amount: amt,
    reason: String(reason || ''),
  };

  if (meta.createdBy != null) set.createdBy = meta.createdBy;
  if (meta.createdByEmail != null) set.createdByEmail = meta.createdByEmail;
  if (meta.createdByUsername != null) set.createdByUsername = meta.createdByUsername;
  if (meta.createdByRole != null) set.createdByRole = meta.createdByRole;

  return DailyTipAdjustment.findOneAndUpdate(
    { locationId, date: d, employeeId, type },
    { $set: set },
    { new: true, upsert: true }
  );
}

module.exports = {
  getByLocationAndDate,
  upsert,
};

