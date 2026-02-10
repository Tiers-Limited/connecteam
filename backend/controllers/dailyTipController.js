const dailyTipInputService = require('../services/dailyTipInputService');
const tipsCalculationService = require('../services/tipsCalculationService');

async function getByLocationAndDate(req, res, next) {
  try {
    const { locationId, date } = req.params;
    const tipInput = await dailyTipInputService.getByLocationAndDate(locationId, date);
    res.json({ success: true, data: tipInput || null });
  } catch (err) {
    next(err);
  }
}

async function getCalculation(req, res, next) {
  try {
    const { locationId, date } = req.params;
    const result = await tipsCalculationService.getDailyTipCalculation(locationId, date);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function upsert(req, res, next) {
  try {
    const { locationId, date } = req.params;
    const { amGrossTips, pmGrossTips } = req.body;
    const tipInput = await dailyTipInputService.upsert(locationId, date, { amGrossTips, pmGrossTips });
    res.json({ success: true, data: tipInput });
  } catch (err) {
    next(err);
  }
}

module.exports = { getByLocationAndDate, getCalculation, upsert };
