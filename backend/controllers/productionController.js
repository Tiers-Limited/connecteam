const productionService = require('../services/productionService');
const { clearProductionStaffNamesCache } = require('../services/tipsCalculationService');

async function getStaff(req, res, next) {
  try {
    const staff = await productionService.getProductionStaff();
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
}

async function updateStaff(req, res, next) {
  try {
    const { id } = req.params;
    const { allocationPercent, subjectToTardiness } = req.body;
    const ProductionStaff = require('../models/ProductionStaff');
    const update = {};
    if (typeof allocationPercent === 'number' && allocationPercent >= 0 && allocationPercent <= 100) {
      update.allocationPercent = allocationPercent;
    }
    if (typeof subjectToTardiness === 'boolean') update.subjectToTardiness = subjectToTardiness;
    const doc = await ProductionStaff.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ success: false, error: 'Production staff not found' });
    clearProductionStaffNamesCache();
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
}

async function getWeeklyPayout(req, res, next) {
  try {
    const { weekStart } = req.params;
    const weekStartStr = typeof weekStart === 'string' ? weekStart.slice(0, 10) : String(weekStart).slice(0, 10);
    const startDate = (req.query.startDate || '').toString().trim().slice(0, 10);
    const endDate = (req.query.endDate || '').toString().trim().slice(0, 10);
    const useDateRange = startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
      new Date(endDate + 'T12:00:00') >= new Date(startDate + 'T12:00:00');
    const options = useDateRange ? { startDate, endDate } : {};
    const result = await productionService.getWeeklyProductionPayout(weekStartStr, options);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function getDailyPool(req, res, next) {
  try {
    const { date } = req.params;
    const dateStr = typeof date === 'string' ? date.slice(0, 10) : String(date).slice(0, 10);
    const pool = await productionService.getDailyProductionPool(dateStr);
    res.json({ success: true, data: { date: dateStr, dailyProductionPool: pool } });
  } catch (err) {
    next(err);
  }
}

async function getLocationWisePool(req, res, next) {
  try {
    const { weekStart } = req.params;
    const weekStartStr = typeof weekStart === 'string' ? weekStart.slice(0, 10) : String(weekStart).slice(0, 10);
    const startDate = (req.query.startDate || '').toString().trim().slice(0, 10);
    const endDate = (req.query.endDate || '').toString().trim().slice(0, 10);
    const useDateRange = startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
      new Date(endDate + 'T12:00:00') >= new Date(startDate + 'T12:00:00');
    const options = useDateRange ? { startDate, endDate } : {};
    const list = await productionService.getLocationWiseProductionPool(weekStartStr, options);
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
}

async function getManualDeductions(req, res, next) {
  try {
    const { weekStart } = req.params;
    const list = await productionService.getProductionManualDeductions(weekStart);
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
}

async function upsertManualDeduction(req, res, next) {
  try {
    const { productionStaffId, weekStart, amount, reason } = req.body;
    if (!productionStaffId || !weekStart) {
      return res.status(400).json({
        success: false,
        error: 'productionStaffId and weekStart are required',
      });
    }
    const record = await productionService.upsertProductionManualDeduction(
      productionStaffId,
      weekStart,
      amount,
      reason || ''
    );
    res.json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStaff,
  updateStaff,
  getWeeklyPayout,
  getDailyPool,
  getLocationWisePool,
  getManualDeductions,
  upsertManualDeduction,
};
