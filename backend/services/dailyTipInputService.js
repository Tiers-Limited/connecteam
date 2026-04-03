const DailyTipInput = require('../models/DailyTipInput');
const { getAppTimezone, dateStringToUtcRange, dateRangeToUtcBounds } = require('../utils/dateUtils');

function ymdFromInput(date) {
  return typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

async function getByLocationAndDate(locationId, date) {
  const dateStr = ymdFromInput(date);
  const { startMs, endMs } = dateStringToUtcRange(dateStr, getAppTimezone());
  return DailyTipInput.findOne({
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  }).lean();
}

async function getByLocationDateRange(locationId, startDate, endDate) {
  const { startMs, endMs } = dateRangeToUtcBounds(
    ymdFromInput(startDate),
    ymdFromInput(endDate),
    getAppTimezone(),
  );
  return DailyTipInput.find({
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  })
    .sort({ date: 1 })
    .lean();
}

async function upsert(locationId, date, data) {
  const dateStr = ymdFromInput(date);
  const tz = getAppTimezone();
  const { startMs, endMs } = dateStringToUtcRange(dateStr, tz);
  const dayStart = new Date(startMs);

  const existing = await DailyTipInput.findOne({
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  });

  const set = {
    amGrossTips: data.amGrossTips,
    pmGrossTips: data.pmGrossTips != null ? data.pmGrossTips : 0,
    date: dayStart,
    calculationCompletedAt: null,
  };
  if (data.createdBy != null) set.createdBy = data.createdBy;
  if (data.createdByEmail != null) set.createdByEmail = data.createdByEmail;
  if (data.createdByUsername != null) set.createdByUsername = data.createdByUsername;
  if (data.createdByRole != null) set.createdByRole = data.createdByRole;

  if (existing) {
    return DailyTipInput.findByIdAndUpdate(existing._id, { $set: set }, { new: true });
  }
  return DailyTipInput.create({ locationId, ...set });
}

async function getPendingCalculationPaginated(page = 1, limit = 25) {
  const skip = Math.max(0, (Number(page) - 1) * Math.max(1, Math.min(100, Number(limit))));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const filter = {
    $or: [{ calculationCompletedAt: null }, { calculationCompletedAt: { $exists: false } }],
  };
  const [items, total] = await Promise.all([
    DailyTipInput.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('locationId', 'name')
      .lean(),
    DailyTipInput.countDocuments(filter),
  ]);
  return { items, total, page: Number(page), limit: limitNum };
}

async function getHistoryPaginated(page = 1, limit = 100) {
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
  getPendingCalculationPaginated,
  getHistoryPaginated,
};
