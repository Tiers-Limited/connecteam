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
 * Get dashboard summary: locations, employee count, current week payout by location,
 * production total, daily gross tips for last 7 days.
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
  const weekStart = getWeekStart(now);
  const currentWeekStart = toDateString(weekStart);

  const payoutByLocation = [];
  for (const loc of locations) {
    const cached = await WeeklyPayoutCache.findOne({
      locationId: loc._id,
      weekStart: currentWeekStart,
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
    const prod = await productionService.getWeeklyProductionPayout(currentWeekStart);
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

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const dailyTips = await DailyTipInput.aggregate([
    {
      $match: {
        date: { $gte: sevenDaysAgo, $lte: endOfToday },
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

  return {
    locationsCount: locations.length,
    employeesCount,
    currentWeekStart,
    totalPayoutThisWeek: Math.round(totalPayoutThisWeek * 100) / 100,
    payoutByLocation,
    productionTotal,
    dailyTipsLast7,
  };
}

module.exports = { getDashboardSummary };
