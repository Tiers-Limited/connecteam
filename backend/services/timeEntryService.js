const TimeEntry = require('../models/TimeEntry');

async function getByLocationAndDate(locationId, date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return TimeEntry.find({ locationId, date: d })
    .populate('employeeId', 'name')
    .sort({ 'employeeId.name': 1 })
    .lean();
}

async function getByLocationDateRange(locationId, startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00.000Z');
  const end = new Date(endDate + 'T23:59:59.999Z');
  return TimeEntry.find({
    locationId,
    date: { $gte: start, $lte: end },
  })
    .populate('employeeId', 'name')
    .sort({ date: 1, 'employeeId.name': 1 })
    .lean();
}

async function create(data) {
  const d = data.date instanceof Date ? data.date : new Date(data.date);
  const dateStr = d.toISOString().slice(0, 10);
  const utcMidnight = new Date(dateStr + 'T00:00:00.000Z');
  const entry = new TimeEntry({ ...data, date: utcMidnight });
  return entry.save();
}

async function updateById(id, data) {
  const update = { ...data };
  if (data.date) {
    const d = new Date(data.date);
    d.setHours(0, 0, 0, 0);
    update.date = d;
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
