const Location = require('../models/Location');
const Employee = require('../models/Employee');
const WeeklyPayoutCache = require('../models/WeeklyPayoutCache');
const DailyTipInput = require('../models/DailyTipInput');
const productionService = require('./productionService');
const connecteamsService = require('./connecteamsService');
const tipsCalculationService = require('./tipsCalculationService');
const { getWeekStart } = require('../utils/dateUtils');

const DASHBOARD_SUMMARY_TTL_MS = 60 * 1000;
let dashboardSummaryCache = null;
let dashboardSummaryCachedAt = 0;
let dashboardSummaryInFlight = null;

function toDateString(d) {
  const x = new Date(d);
  return x.toISOString().slice(0, 10);
}

async function getDashboardSummary() {
  if (dashboardSummaryCache && Date.now() - dashboardSummaryCachedAt < DASHBOARD_SUMMARY_TTL_MS) {
    return dashboardSummaryCache;
  }
  if (dashboardSummaryInFlight) return dashboardSummaryInFlight;

  dashboardSummaryInFlight = (async () => {
  const locations = await Location.find({ isActive: true }).lean();
  let employeesCount = 0;
  try {
    employeesCount = await connecteamsService.getActiveUsersCount();
  } catch (_) {
    employeesCount = await Employee.countDocuments({ isActive: true });
  }
  const now = new Date();
  const thisWeekStart = getWeekStart(now);
  const prevMon = new Date(thisWeekStart.getFullYear(), thisWeekStart.getMonth(), thisWeekStart.getDate() - 7);
  const previousWeekStart =
    prevMon.getFullYear() +
    '-' +
    String(prevMon.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(prevMon.getDate()).padStart(2, '0');

  const [y, mo, day] = previousWeekStart.split('-').map(Number);
  const startOfPrevWeek = new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0));
  const prevWeekEnd = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));
  const weekEndStr =
    prevWeekEnd.getUTCFullYear() +
    '-' +
    String(prevWeekEnd.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(prevWeekEnd.getUTCDate()).padStart(2, '0');

  const locationIds = locations.map((loc) => loc._id);
  const cachedRows = await WeeklyPayoutCache.find({
    locationId: { $in: locationIds },
    weekStart: previousWeekStart,
  })
    .select('locationId payload')
    .lean();
  const cachedByLocationId = new Map(
    cachedRows.map((row) => [String(row.locationId), row])
  );

  const payoutByLocation = await Promise.all(
    locations.map(async (loc) => {
      const cached = cachedByLocationId.get(String(loc._id));
      let totalPayable = 0;
      if (cached?.payload?.payouts) {
        totalPayable = cached.payload.payouts.reduce(
          (sum, p) => sum + (Number(p.finalWeeklyTipsPayable) || 0),
          0
        );
      } else {
        // Dashboard fallback: if weekly payout cache is missing for a location,
        // compute on the fly so contribution reflects locations that had tips.
        try {
          const computed = await tipsCalculationService.getWeeklyPayout(
            loc._id,
            previousWeekStart,
            { startDate: previousWeekStart, endDate: weekEndStr },
          );
          const payouts = Array.isArray(computed?.payouts) ? computed.payouts : [];
          totalPayable = payouts.reduce(
            (sum, p) => sum + (Number(p.finalWeeklyTipsPayable) || 0),
            0,
          );
          // Persist computed payload to avoid recomputing on subsequent dashboard requests.
          await WeeklyPayoutCache.findOneAndUpdate(
            { locationId: loc._id, weekStart: previousWeekStart },
            {
              locationId: loc._id,
              weekStart: previousWeekStart,
              payload: computed,
            },
            { upsert: true, new: false, setDefaultsOnInsert: true },
          );
        } catch (_) {
          totalPayable = 0;
        }
      }
      return {
        locationId: loc._id,
        locationName: loc.name || '—',
        totalPayable: Math.round(totalPayable * 100) / 100,
      };
    })
  );

  let productionTotal = 0;
  try {
    const prod = await productionService.getWeeklyProductionPayout(previousWeekStart);
    if (prod?.payouts) {
      productionTotal = prod.payouts.reduce(
        (sum, p) => sum + (Number(p.finalWeeklyProductionPayout) || 0),
        0
      );
      productionTotal = Math.round(productionTotal * 100) / 100;
    }
  } catch (_) {
    // ignore
  }

  const dailyTipRows = await DailyTipInput.find({
    date: { $gte: startOfPrevWeek, $lte: prevWeekEnd },
  })
    .select('locationId date amGrossTips pmGrossTips')
    .lean();

  const locationNameById = new Map(
    locations.map((l) => [String(l._id), l.name || '—'])
  );
  const byDate = new Map();
  for (const row of dailyTipRows) {
    const dateKey = toDateString(row.date);
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, { date: dateKey, totalGross: 0, byLocation: {} });
    }
    const rec = byDate.get(dateKey);
    const gross = (Number(row.amGrossTips) || 0) + (Number(row.pmGrossTips) || 0);
    const locationId = row.locationId ? String(row.locationId) : '';
    const locationName = locationNameById.get(locationId) || '—';
    rec.totalGross += gross;
    rec.byLocation[locationName] = (Number(rec.byLocation[locationName]) || 0) + gross;
  }

  const dailyTipsLast7 = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      totalGross: Math.round((d.totalGross || 0) * 100) / 100,
      byLocation: Object.fromEntries(
        Object.entries(d.byLocation || {}).map(([k, v]) => [k, Math.round((Number(v) || 0) * 100) / 100])
      ),
    }));

  const totalPayoutThisWeek = payoutByLocation.reduce((s, l) => s + l.totalPayable, 0);

  const summary = {
    locationsCount: locations.length,
    employeesCount,
    currentWeekStart: previousWeekStart,
    previousWeekStart,
    weekEnd: weekEndStr,
    totalPayoutThisWeek: Math.round(totalPayoutThisWeek * 100) / 100,
    payoutByLocation,
    productionTotal,
    dailyTipsLast7,
  };
  dashboardSummaryCache = summary;
  dashboardSummaryCachedAt = Date.now();
  return summary;
  })();

  try {
    return await dashboardSummaryInFlight;
  } finally {
    dashboardSummaryInFlight = null;
  }
}

module.exports = { getDashboardSummary };
