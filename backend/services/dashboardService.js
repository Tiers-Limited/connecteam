const Location = require('../models/Location');
const Employee = require('../models/Employee');
const WeeklyPayoutCache = require('../models/WeeklyPayoutCache');
const DailyTipInput = require('../models/DailyTipInput');
const productionService = require('./productionService');
const connecteamsService = require('./connecteamsService');
const { getWeekStart } = require('../utils/dateUtils');

function toDateString(d) {
  const x = new Date(d);
  return x.toISOString().slice(0, 10);
}

/**
 * Get dashboard summary: locations, employee count, **previous week** payout by location,
 * production total, and daily gross tips for the **previous week** (Mon–Sun).
 * Uses the completed week before the current one (e.g. if today is Wed 18 Feb, shows 9–15 Feb).
 */
async function getDashboardSummary() {
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

  const payoutByLocation = [];
  for (const loc of locations) {
    const cached = await WeeklyPayoutCache.findOne({
      locationId: loc._id,
      weekStart: previousWeekStart,
    }).lean();
    let totalPayable = 0;
    if (cached?.payload?.payouts) {
      totalPayable = cached.payload.payouts.reduce(
        (sum, p) => sum + (Number(p.finalWeeklyTipsPayable) || 0),
        0
      );
    }
    payoutByLocation.push({
      locationId: loc._id,
      locationName: loc.name || '—',
      totalPayable: Math.round(totalPayable * 100) / 100,
    });
  }

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

  const [y, mo, day] = previousWeekStart.split('-').map(Number);
  const startOfPrevWeek = new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0));
  const prevWeekEnd = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));

  const dailyTips = await DailyTipInput.aggregate([
    {
      $match: {
        date: { $gte: startOfPrevWeek, $lte: prevWeekEnd },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        totalGross: { $sum: { $add: ['$amGrossTips', '$pmGrossTips'] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const dailyTipsLast7 = dailyTips.map((d) => ({
    date: d._id,
    totalGross: Math.round((d.totalGross || 0) * 100) / 100,
  }));

  const totalPayoutThisWeek = payoutByLocation.reduce((s, l) => s + l.totalPayable, 0);

  const weekEndStr =
    prevWeekEnd.getUTCFullYear() +
    '-' +
    String(prevWeekEnd.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(prevWeekEnd.getUTCDate()).padStart(2, '0');

  return {
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
}

module.exports = { getDashboardSummary };
