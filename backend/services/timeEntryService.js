const TimeEntry = require('../models/TimeEntry');
const {
  getAppTimezone,
  getStartOfDayUtcMs,
  dateStringToUtcRange,
  dateRangeToUtcBounds,
  formatDateStringInTimezone,
} = require('../utils/dateUtils');

function addDateStr(entries) {
  const tz = getAppTimezone();
  return (entries || []).map((e) => ({
    ...e,
    dateStr: e.date
      ? formatDateStringInTimezone(new Date(e.date).getTime(), tz)
      : '',
  }));
}

async function getByLocationAndDate(locationId, date) {
  const dateStr = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : formatDateStringInTimezone(new Date(date).getTime(), getAppTimezone());
  const { startMs, endMs } = dateStringToUtcRange(dateStr, getAppTimezone());
  const entries = await TimeEntry.find({
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  })
    .populate('employeeId', 'name')
    .sort({ 'employeeId.name': 1 })
    .lean();
  return addDateStr(entries);
}

async function getByLocationDateRange(locationId, startDate, endDate) {
  const { startMs, endMs } = dateRangeToUtcBounds(startDate, endDate, getAppTimezone());
  const entries = await TimeEntry.find({
    locationId,
    date: { $gte: new Date(startMs), $lte: new Date(endMs) },
  })
    .populate('employeeId', 'name')
    .sort({ date: 1, 'employeeId.name': 1 })
    .lean();
  return addDateStr(entries);
}

async function create(data) {
  const dateStr =
    typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
      ? data.date
      : formatDateStringInTimezone(new Date(data.date).getTime(), getAppTimezone());
  const startMs = getStartOfDayUtcMs(dateStr, getAppTimezone());
  const dayStart = Number.isNaN(startMs) ? new Date(data.date) : new Date(startMs);
  const entry = new TimeEntry({ ...data, date: dayStart });
  return entry.save();
}

async function updateById(id, data) {
  const update = { ...data };
  if (data.date) {
    const dateStr =
      typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
        ? data.date
        : formatDateStringInTimezone(new Date(data.date).getTime(), getAppTimezone());
    const startMs = getStartOfDayUtcMs(dateStr, getAppTimezone());
    update.date = Number.isNaN(startMs) ? new Date(data.date) : new Date(startMs);
  }
  return TimeEntry.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
}

async function removeById(id) {
  return TimeEntry.findByIdAndDelete(id);
}

module.exports = {
  getByLocationAndDate,
  getByLocationDateRange,
  create,
  updateById,
  removeById,
};
