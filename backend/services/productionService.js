const DailyTipInput = require('../models/DailyTipInput');
const ProductionStaff = require('../models/ProductionStaff');
const ProductionManualDeduction = require('../models/ProductionManualDeduction');
/** DB collection where Weekly Tardiness page saves data (weekStart + locationId → payload.entries) */
const WeeklyTardinessCache = require('../models/WeeklyTardinessCache');
const { PRODUCTION_DEDUCTION_PERCENT } = require('../utils/constants');
const { timeToMinutes, toDateString } = require('../utils/dateUtils');

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function getTardinessDeductionPercent(minutes) {
  if (minutes <= 5) return 0;
  if (minutes <= 10) return 0.15;
  return 0.2;
}

/**
 * Daily production pool = Σ (4% of AM + PM gross tips) across all locations for the given date.
 * @param {string} dateStr - YYYY-MM-DD
 */
async function getDailyProductionPool(dateStr) {
  const d = typeof dateStr === 'string' ? dateStr.slice(0, 10) : toDateString(dateStr);
  const dateStart = new Date(d + 'T00:00:00.000Z');
  const dateEnd = new Date(d + 'T23:59:59.999Z');
  const inputs = await DailyTipInput.find({
    date: { $gte: dateStart, $lte: dateEnd },
  }).lean();
  let pool = 0;
  for (const row of inputs) {
    pool += (Number(row.amGrossTips) || 0) * PRODUCTION_DEDUCTION_PERCENT;
    pool += (Number(row.pmGrossTips) || 0) * PRODUCTION_DEDUCTION_PERCENT;
  }
  return roundMoney(pool);
}

/**
 * Get all active production staff (for admin and payout).
 */
async function getProductionStaff() {
  return ProductionStaff.find({ isActive: true }).sort({ name: 1 }).lean();
}

/**
 * Build tardiness map (staff name -> weekly minutes) from DB.
 * Reads from WeeklyTardinessCache collection (where Weekly Tardiness page persists data).
 * Loads all documents for this week (every location + "all locations") so production
 * gets correct totals whether user loaded by location or all. First punch per (name, date).
 */
async function getProductionTardinessMap(weekStartStr, staffNames) {
  const tardinessDocs = await WeeklyTardinessCache.find({ weekStart: weekStartStr }).lean();
  const map = new Map(staffNames.map((n) => [n, 0]));
  const entries = [];
  for (const doc of tardinessDocs) {
    if (doc.payload?.entries && Array.isArray(doc.payload.entries)) {
      entries.push(...doc.payload.entries);
    }
  }
  if (entries.length === 0) return map;
  const firstPunchByKey = new Map();
  for (const e of entries) {
    const name = (e.employeeName || '').toString().trim();
    const date = (e.date || '').toString().slice(0, 10);
    if (!name || !date || !e.clockIn) continue;
    const key = `${name}|${date}`;
    const clockInMins = timeToMinutes(e.clockIn);
    const minutesLate = Math.max(0, Number(e.minutesLate) || 0);
    const existing = firstPunchByKey.get(key);
    if (existing == null || clockInMins < existing.clockInMins) {
      firstPunchByKey.set(key, { clockInMins, minutesLate });
    }
  }
  for (const [key, { minutesLate }] of firstPunchByKey) {
    const name = key.split('|')[0];
    if (map.has(name)) map.set(name, (map.get(name) || 0) + minutesLate);
  }
  return map;
}

/**
 * Weekly production payout: daily pool × allocation → weekly gross → tardiness → manual → redistribution (by %) → final.
 */
async function getWeeklyProductionPayout(weekStartStr) {
  const staff = await ProductionStaff.find({ isActive: true }).sort({ name: 1 });
  if (staff.length === 0) {
    return {
      weekStart: weekStartStr,
      weekEnd: '',
      redistributionPool: 0,
      payouts: [],
    };
  }
  const [y, mo, day] = weekStartStr.split('-').map(Number);
  const weekEnd = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const dailyPoolByDate = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0));
    const dateStr = d.toISOString().slice(0, 10);
    dailyPoolByDate.set(dateStr, await getDailyProductionPool(dateStr));
  }

  const staffNames = staff.map((s) => s.name.trim());
  const tardinessMap = await getProductionTardinessMap(weekStartStr, staffNames);
  const manualDeductions = await ProductionManualDeduction.find({ weekStart: weekStartStr })
    .populate('productionStaffId')
    .lean();
  const manualMap = new Map();
  manualDeductions.forEach((m) => {
    const id = m.productionStaffId?._id?.toString();
    if (id) manualMap.set(id, { amount: m.amount, reason: m.reason || '' });
  });

  const rows = [];
  for (const s of staff) {
    const id = s._id.toString();
    let weeklyGross = 0;
    const dailyByDay = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 7; i++) {
      const dateStr = new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0)).toISOString().slice(0, 10);
      const pool = dailyPoolByDate.get(dateStr) || 0;
      const alloc = (s.allocationPercent || 0) / 100;
      const dayTips = roundMoney(pool * alloc);
      weeklyGross += dayTips;
      dailyByDay[i] = dayTips;
    }
    weeklyGross = roundMoney(weeklyGross);
    const tardinessMinutes = s.subjectToTardiness ? (tardinessMap.get(s.name.trim()) ?? 0) : 0;
    const deductionPercent = s.subjectToTardiness ? getTardinessDeductionPercent(tardinessMinutes) : 0;
    const tardinessDeductionAmount = roundMoney(weeklyGross * deductionPercent);
    const weeklyAfterTardiness = roundMoney(weeklyGross - tardinessDeductionAmount);
    const manual = manualMap.get(id) || { amount: 0, reason: '' };
    const netWeekly = roundMoney(Math.max(0, weeklyAfterTardiness - manual.amount));
    rows.push({
      productionStaffId: s._id,
      name: s.name,
      allocationPercent: s.allocationPercent,
      subjectToTardiness: s.subjectToTardiness,
      weeklyGrossProductionTips: weeklyGross,
      dailyByDay,
      weeklyTardinessMinutes: tardinessMinutes,
      tardinessPercent: deductionPercent * 100,
      tardinessDeduction: tardinessDeductionAmount,
      weeklyAfterTardiness,
      manualDeduction: manual.amount,
      manualDeductionReason: manual.reason,
      netWeeklyProductionTips: netWeekly,
      eligibleForRedistribution: (tardinessMinutes <= 5 || !s.subjectToTardiness) && weeklyGross > 0,
    });
  }

  const totalRedistributionPool = rows.reduce((sum, r) => sum + r.tardinessDeduction, 0);
  const eligible = rows.filter((r) => r.eligibleForRedistribution);
  const eligibleTotalPercent = eligible.reduce((sum, r) => sum + (r.allocationPercent || 0), 0);

  for (const row of rows) {
    let redistributed = 0;
    if (totalRedistributionPool > 0 && eligibleTotalPercent > 0 && row.eligibleForRedistribution) {
      redistributed = (row.allocationPercent / eligibleTotalPercent) * totalRedistributionPool;
    }
    row.tardinessRedistribution = roundMoney(redistributed);
    row.finalWeeklyProductionPayout = roundMoney(row.netWeeklyProductionTips + row.tardinessRedistribution);
  }

  const sumRedistributed = rows.reduce((s, r) => s + r.tardinessRedistribution, 0);
  const roundingDiff = totalRedistributionPool - sumRedistributed;
  if (Math.abs(roundingDiff) > 1e-9 && eligible.length > 0) {
    const first = eligible[0];
    const r = rows.find((x) => x.productionStaffId.toString() === first.productionStaffId.toString());
    if (r) {
      r.tardinessRedistribution += roundingDiff;
      r.finalWeeklyProductionPayout = roundMoney(r.netWeeklyProductionTips + r.tardinessRedistribution);
    }
  }

  return {
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
    redistributionPool: roundMoney(totalRedistributionPool),
    payouts: rows.map((r) => ({
      productionStaffId: r.productionStaffId,
      name: r.name,
      allocationPercent: r.allocationPercent,
      subjectToTardiness: r.subjectToTardiness,
      weeklyGrossProductionTips: r.weeklyGrossProductionTips,
      dailyByDay: r.dailyByDay,
      weeklyTardinessMinutes: r.weeklyTardinessMinutes,
      tardinessPercent: r.tardinessPercent,
      tardinessDeduction: r.tardinessDeduction,
      weeklyAfterTardiness: r.weeklyAfterTardiness,
      manualDeduction: r.manualDeduction,
      manualDeductionReason: r.manualDeductionReason,
      netWeeklyProductionTips: r.netWeeklyProductionTips,
      tardinessRedistribution: r.tardinessRedistribution,
      finalWeeklyProductionPayout: r.finalWeeklyProductionPayout,
    })),
  };
}

async function upsertProductionManualDeduction(productionStaffId, weekStart, amount, reason) {
  const weekStartStr = typeof weekStart === 'string' ? weekStart.slice(0, 10) : toDateString(weekStart);
  return ProductionManualDeduction.findOneAndUpdate(
    { productionStaffId, weekStart: weekStartStr },
    { amount: Number(amount) || 0, reason: (reason || '').trim() },
    { upsert: true, new: true }
  ).populate('productionStaffId');
}

async function getProductionManualDeductions(weekStart) {
  const weekStartStr = typeof weekStart === 'string' ? weekStart.slice(0, 10) : toDateString(weekStart);
  return ProductionManualDeduction.find({ weekStart: weekStartStr })
    .populate('productionStaffId')
    .lean();
}

module.exports = {
  getDailyProductionPool,
  getProductionStaff,
  getWeeklyProductionPayout,
  upsertProductionManualDeduction,
  getProductionManualDeductions,
};
