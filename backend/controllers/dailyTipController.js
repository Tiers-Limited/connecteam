const dailyTipInputService = require('../services/dailyTipInputService');
const dailyTipAdjustmentService = require('../services/dailyTipAdjustmentService');
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
    const refreshRaw = req.query?.refresh;
    const forceRefresh =
      refreshRaw === '1' ||
      refreshRaw === 'true' ||
      String(refreshRaw || '').toLowerCase() === 'yes';

    let result;
    if (forceRefresh) {
      result = await tipsCalculationService.getDailyTipCalculation(locationId, date);
    } else {
      let snapshot = null;
      try {
        snapshot = await tipsCalculationService.getDailyTipCalculationSnapshot(
          locationId,
          date,
        );
      } catch (snapErr) {
        console.warn(
          '[getCalculation] Snapshot rebuild failed; falling back to full calculation:',
          snapErr?.message || snapErr,
        );
      }
      if (snapshot && snapshot.error) {
        result = snapshot;
      } else if (snapshot) {
        result = snapshot;
      } else {
        result = await tipsCalculationService.getDailyTipCalculation(locationId, date);
      }
    }
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/** Persists gross tips only. Production pool (4% of gross) is derived from DailyTipInput when reporting; per-employee split is not run until GET …/calculation. */
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

async function getAdjustments(req, res, next) {
  try {
    const { locationId, date } = req.params;
    const list = await dailyTipAdjustmentService.getByLocationAndDate(locationId, date);
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
}

async function upsertAdjustment(req, res, next) {
  try {
    const { locationId, date } = req.params;
    const { employeeId, type, amount = 0, reason = '' } = req.body;
    const user = req.user || {};
    const record = await dailyTipAdjustmentService.upsert(
      locationId,
      date,
      employeeId,
      type,
      amount,
      reason,
      {
        createdBy: user._id,
        createdByEmail: user.email || '',
        createdByUsername: user.username || '',
        createdByRole: user.role || '',
      }
    );
    res.json({ success: true, data: record });
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

function ymdFromRowDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

async function getPendingCalculation(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 25));
    const result = await dailyTipInputService.getPendingCalculationPaginated(page, limit);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/** Runs getDailyTipCalculation for up to `max` pending rows (no audit completion flag). Sequential — can be slow. */
async function calculateAllPending(req, res, next) {
  try {
    const maxRaw = req.body?.max ?? req.query?.max;
    const max = Math.min(50, Math.max(1, parseInt(maxRaw, 10) || 25));
    const { items } = await dailyTipInputService.getPendingCalculationPaginated(1, max);
    const results = [];
    for (const row of items) {
      const locationId = row.locationId?._id || row.locationId;
      const dateStr = ymdFromRowDate(row.date);
      if (!locationId || !dateStr) {
        results.push({ ok: false, error: 'Invalid row', rowId: row._id });
        continue;
      }
      const result = await tipsCalculationService.getDailyTipCalculation(locationId, dateStr);
      if (result.error) {
        results.push({
          locationId: String(locationId),
          date: dateStr,
          ok: false,
          error: result.error,
        });
      } else {
        results.push({ locationId: String(locationId), date: dateStr, ok: true });
      }
    }
    res.json({
      success: true,
      data: {
        attempted: items.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getByLocationAndDate,
  getCalculation,
  upsert,
  getAdjustments,
  upsertAdjustment,
  getHistory,
  getPendingCalculation,
  calculateAllPending,
};
