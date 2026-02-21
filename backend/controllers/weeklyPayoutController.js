const tipsCalculationService = require('../services/tipsCalculationService');
const weeklyPayoutService = require('../services/weeklyPayoutService');
const WeeklyPayoutCache = require('../models/WeeklyPayoutCache');

function weekStartToYYYYMMDD(weekStart) {
  if (!weekStart) return '';
  const s = String(weekStart).trim();
  return s.slice(0, 10);
}

async function getPayout(req, res, next) {
  try {
    const { locationId, weekStart } = req.params;
    const refresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const startDate = (req.query.startDate || '').toString().trim().slice(0, 10);
    const endDate = (req.query.endDate || '').toString().trim().slice(0, 10);
    const useDateRange = startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
      new Date(endDate + 'T12:00:00') >= new Date(startDate + 'T12:00:00');
    const weekStartStr = useDateRange ? startDate : weekStartToYYYYMMDD(weekStart);

    if (!refresh && !useDateRange) {
      const cached = await WeeklyPayoutCache.findOne({
        locationId,
        weekStart: weekStartStr,
      }).lean();
      if (cached && cached.payload) {
        return res.json({ success: true, data: cached.payload, fromCache: true });
      }
    }

    const options = useDateRange ? { startDate, endDate } : {};
    const result = await tipsCalculationService.getWeeklyPayout(locationId, weekStart, options);
    if (!useDateRange) {
      await WeeklyPayoutCache.findOneAndUpdate(
        { locationId, weekStart: weekStartStr },
        { $set: { payload: result } },
        { upsert: true, new: true }
      );
    }
    res.json({ success: true, data: result, fromCache: false });
  } catch (err) {
    next(err);
  }
}

async function getTardiness(req, res, next) {
  try {
    const { locationId, weekStart } = req.params;
    const data = await weeklyPayoutService.getTardiness(locationId, weekStart);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function upsertTardiness(req, res, next) {
  try {
    const { employeeId, locationId, weekStart } = req.body;
    const totalTardinessMinutes = Number(req.body.totalTardinessMinutes);
    const record = await weeklyPayoutService.upsertTardiness(employeeId, locationId, weekStart, totalTardinessMinutes);
    res.json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
}

async function getManualDeductions(req, res, next) {
  try {
    const { locationId, weekStart } = req.params;
    const data = await weeklyPayoutService.getManualDeductions(locationId, weekStart);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function upsertManualDeduction(req, res, next) {
  try {
    const { employeeId, locationId, weekStart, amount, reason } = req.body;
    const record = await weeklyPayoutService.upsertManualDeduction(employeeId, locationId, weekStart, amount, reason || '');
    const weekStartStr = weekStartToYYYYMMDD(weekStart);
    await WeeklyPayoutCache.deleteOne({ locationId, weekStart: weekStartStr });
    res.json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPayout,
  getTardiness,
  upsertTardiness,
  getManualDeductions,
  upsertManualDeduction,
};
