const tipsCalculationService = require('../services/tipsCalculationService');
const weeklyPayoutService = require('../services/weeklyPayoutService');

async function getPayout(req, res, next) {
  try {
    const { locationId, weekStart } = req.params;
    const result = await tipsCalculationService.getWeeklyPayout(locationId, weekStart);
    res.json({ success: true, data: result });
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
