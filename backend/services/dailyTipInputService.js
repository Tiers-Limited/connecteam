const DailyTipInput = require('../models/DailyTipInput');

/** Normalize date to UTC midnight (YYYY-MM-DD) so save and calculation always match. */
function toUTCMidnight(date) {
  const str = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  return new Date(str + 'T00:00:00.000Z');
}

async function getByLocationAndDate(locationId, date) {
  const d = toUTCMidnight(date);
  return DailyTipInput.findOne({ locationId, date: d }).lean();
}

async function getByLocationDateRange(locationId, startDate, endDate) {
  const start = toUTCMidnight(startDate);
  const end = new Date(toUTCMidnight(endDate).getTime() + 24 * 60 * 60 * 1000 - 1);
  return DailyTipInput.find({
    locationId,
    date: { $gte: start, $lte: end },
  })
    .sort({ date: 1 })
    .lean();
}

async function upsert(locationId, date, data) {
  const d = toUTCMidnight(date);
  const set = {
    amGrossTips: data.amGrossTips,
    pmGrossTips: data.pmGrossTips != null ? data.pmGrossTips : 0,
  };
  if (data.createdBy != null) set.createdBy = data.createdBy;
  if (data.createdByEmail != null) set.createdByEmail = data.createdByEmail;
  if (data.createdByUsername != null) set.createdByUsername = data.createdByUsername;
  if (data.createdByRole != null) set.createdByRole = data.createdByRole;
  return DailyTipInput.findOneAndUpdate(
    { locationId, date: d },
    { $set: set },
    { new: true, upsert: true }
  );
}

async function getHistoryPaginated(page = 1, limit = 25) {
  const skip = Math.max(0, (Number(page) - 1) * Math.max(1, Math.min(100, Number(limit))));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const [items, total] = await Promise.all([
    DailyTipInput.find({})
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('locationId', 'name')
      .lean(),
    DailyTipInput.countDocuments(),
  ]);
  return { items, total, page: Number(page), limit: limitNum };
}

module.exports = {
  getByLocationAndDate,
  getByLocationDateRange,
  upsert,
  getHistoryPaginated,
};
