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
    const { amGrossTips, pmGrossTips = 0 } = req.body;
    const user = req.user || {};
    const tipInput = await dailyTipInputService.upsert(locationId, date, {
      amGrossTips,
      pmGrossTips,
      createdBy: user._id,
      createdByEmail: user.email || '',
      createdByUsername: user.username || '',
      createdByRole: user.role || '',
    });
    res.json({ success: true, data: tipInput });
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 25));
    const result = await dailyTipInputService.getHistoryPaginated(page, limit);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getByLocationAndDate, getCalculation, upsert, getHistory };
