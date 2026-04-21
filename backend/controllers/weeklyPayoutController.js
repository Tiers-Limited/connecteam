const tipsCalculationService = require('../services/tipsCalculationService');
const weeklyPayoutService = require('../services/weeklyPayoutService');
const WeeklyPayoutCache = require('../models/WeeklyPayoutCache');

function weekStartToYYYYMMDD(weekStart) {
  if (!weekStart) return '';
  const s = String(weekStart).trim();
  return s.slice(0, 10);
}

function payloadDateToYMD(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v.trim().slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function addDaysYMD(ymd, daysToAdd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return '';
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(daysToAdd || 0), 0, 0, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function cachedPayloadMatchesRange(payload, sd, ed) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.dateRange && payload.dateRange.startDate && payload.dateRange.endDate) {
    return payload.dateRange.startDate === sd && payload.dateRange.endDate === ed;
  }
  const ws = payloadDateToYMD(payload.weekStart);
  const we = payloadDateToYMD(payload.weekEnd);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ws) && /^\d{4}-\d{2}-\d{2}$/.test(we)) {
    return ws === sd && we === ed;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(ws) && ws === sd) {
    const expectedWeekEnd = addDaysYMD(sd, 6);
    if (expectedWeekEnd && expectedWeekEnd === ed) return true;
  }
  return false;
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

    if (!refresh) {
      const cached = await WeeklyPayoutCache.findOne({
        locationId,
        weekStart: weekStartStr,
      }).lean();
      const cachedPayload = cached?.payload;
      const requestedStart = useDateRange ? startDate : weekStartStr;
      const requestedEnd = useDateRange
        ? endDate
        : addDaysYMD(weekStartStr, 6);
      const cacheMatches = requestedStart && requestedEnd
        ? cachedPayloadMatchesRange(cachedPayload, requestedStart, requestedEnd)
        : Boolean(cachedPayload);

      if (cachedPayload && cacheMatches) {
        console.log('[weeklyPayoutController.getPayout] Tip/payout data from DB (cache):', {
          locationId,
          weekStartStr,
          requestedStart,
          requestedEnd,
          payoutsCount: cachedPayload?.payouts?.length ?? 0,
          fromCache: true,
        });
        return res.json({ success: true, data: cachedPayload, fromCache: true });
      }
    }

    const options = useDateRange ? { startDate, endDate } : {};
    const result = await tipsCalculationService.getWeeklyPayout(locationId, weekStart, options);
    console.log('[weeklyPayoutController.getPayout] Tip/payout data from DB (computed):', {
      locationId,
      weekStartStr,
      useDateRange,
      dateRange: useDateRange ? { startDate, endDate } : null,
      payoutsCount: result?.payouts?.length ?? 0,
      fromCache: false,
    });
    await WeeklyPayoutCache.findOneAndUpdate(
      { locationId, weekStart: weekStartStr },
      { $set: { payload: result } },
      { upsert: true, new: true }
    );
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

async function postReport(req, res, next) {
  try {
    const {
      startDate,
      endDate,
      geographicScope,
      singleLocationId,
      employeeScope,
      employeeName,
      employeeId,
    } = req.body;
    const data = await weeklyPayoutService.buildWeeklyPayoutReport({
      startDate,
      endDate,
      geographicScope,
      singleLocationId,
      employeeScope,
      employeeName,
      employeeId,
    });
    res.json({ success: true, data });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err.status === 404) {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
}

async function getReportEmployees(req, res, next) {
  try {
    const { startDate, endDate, geographicScope, singleLocationId } = req.query;
    const data = await weeklyPayoutService.listWeeklyPayoutReportEmployees({
      startDate,
      endDate,
      geographicScope,
      singleLocationId,
    });
    res.json({ success: true, data });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
}

module.exports = {
  getPayout,
  getTardiness,
  upsertTardiness,
  getManualDeductions,
  upsertManualDeduction,
  postReport,
  getReportEmployees,
};
