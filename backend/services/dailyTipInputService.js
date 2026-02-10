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
  return DailyTipInput.findOneAndUpdate(
    { locationId, date: d },
    { $set: { amGrossTips: data.amGrossTips, pmGrossTips: data.pmGrossTips } },
    { new: true, upsert: true }
  );
}

module.exports = {
  getByLocationAndDate,
  getByLocationDateRange,
  upsert,
};
