const DailyTipInput = require('../models/DailyTipInput');
const Location = require('../models/Location');
const ProductionStaff = require('../models/ProductionStaff');
const ProductionManualDeduction = require('../models/ProductionManualDeduction');
/** DB collection where Weekly Tardiness page saves data (weekStart + locationId → payload.entries) */
const WeeklyTardinessCache = require('../models/WeeklyTardinessCache');
const { PRODUCTION_DEDUCTION_PERCENT } = require('../utils/constants');
const connecteamsService = require('./connecteamsService');
const { timeToMinutes, toDateString, getDatesInRange } = require('../utils/dateUtils');

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function allocateCentsProportionally(items, poolAmount, weightSelector, keySelector) {
  const candidates = (items || []).filter((item) => item && keySelector(item));
  const result = new Map();
  if (candidates.length === 0) return result;

  const poolCents = Math.max(0, Math.round((Number(poolAmount) || 0) * 100));
  if (poolCents === 0) return result;

  const weighted = candidates.map((item) => {
    const key = String(keySelector(item));
    const weight = Math.max(0, Number(weightSelector(item)) || 0);
    return { item, key, weight };
  });
  const totalWeight = weighted.reduce((sum, x) => sum + x.weight, 0);

  // If all weights are zero, split equally in cents.
  if (totalWeight <= 0) {
    const base = Math.floor(poolCents / weighted.length);
    let remainder = poolCents - base * weighted.length;
    const ordered = weighted.slice().sort((a, b) => a.key.localeCompare(b.key));
    for (const entry of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      result.set(entry.key, (base + extra) / 100);
    }
    return result;
  }

  const prepared = weighted.map((entry) => {
    const exactCents = (entry.weight / totalWeight) * poolCents;
    const floorCents = Math.floor(exactCents);
    return {
      ...entry,
      floorCents,
      fraction: exactCents - floorCents,
    };
  });

  const floorSum = prepared.reduce((sum, entry) => sum + entry.floorCents, 0);
  let remainder = poolCents - floorSum;
  const ranking = prepared
    .slice()
    .sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      return a.key.localeCompare(b.key);
    });
  for (let i = 0; i < ranking.length && remainder > 0; i += 1) {
    ranking[i].floorCents += 1;
    remainder -= 1;
  }

  for (const entry of prepared) {
    result.set(entry.key, entry.floorCents / 100);
  }
  return result;
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
 * Location-wise tip pool for a week or date range: 4% of (AM + PM gross tips) per location, per day and weekly total.
 * @param {string} weekStartStr - YYYY-MM-DD (Monday or range start)
 * @param {{ startDate?: string, endDate?: string }} [options] - when both set, use this range instead of fixed 7 days
 * @returns {Promise<Array<{ locationId, locationName, weeklyPool, dailyByDay }>>}
 */
async function getLocationWiseProductionPool(weekStartStr, options = {}) {
  const useDateRange = options.startDate && options.endDate && typeof options.startDate === 'string' && typeof options.endDate === 'string';
  let dateStarts;
  let weekStartDate;
  let weekEndDate;
  if (useDateRange) {
    dateStarts = getDatesInRange(options.startDate.trim().slice(0, 10), options.endDate.trim().slice(0, 10));
    weekStartDate = new Date(dateStarts[0] + 'T00:00:00.000Z');
    weekEndDate = new Date(dateStarts[dateStarts.length - 1] + 'T23:59:59.999Z');
  } else {
    const d = typeof weekStartStr === 'string' ? weekStartStr.slice(0, 10) : toDateString(weekStartStr);
    const [y, mo, day] = d.split('-').map(Number);
    dateStarts = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0));
      dateStarts.push(date.toISOString().slice(0, 10));
    }
    weekStartDate = new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0));
    weekEndDate = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));
  }
  const inputs = await DailyTipInput.find({
    date: { $gte: weekStartDate, $lte: weekEndDate },
  }).lean();
  const byLocation = new Map();
  const emptyDaily = Array(dateStarts.length).fill(0);
  for (const row of inputs) {
    const locId = (row.locationId && row.locationId._id ? row.locationId._id : row.locationId)?.toString();
    if (!locId) continue;
    const dateStr = (row.date && row.date.toISOString) ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10);
    const dayPool = roundMoney(
      ((Number(row.amGrossTips) || 0) + (Number(row.pmGrossTips) || 0)) * PRODUCTION_DEDUCTION_PERCENT
    );
    if (!byLocation.has(locId)) {
      byLocation.set(locId, { dailyByDay: [...emptyDaily] });
    }
    const rec = byLocation.get(locId);
    const dayIndex = dateStarts.indexOf(dateStr);
    if (dayIndex >= 0) rec.dailyByDay[dayIndex] += dayPool;
  }
  for (const rec of byLocation.values()) {
    rec.weeklyPool = roundMoney(rec.dailyByDay.reduce((s, v) => s + v, 0));
  }
  const locationIds = [...byLocation.keys()];
  const locations = await Location.find({ _id: { $in: locationIds } }).select('name').lean();
  const nameById = Object.fromEntries(locations.map((l) => [l._id.toString(), l.name || '—']));
  return locationIds.map((locationId) => {
    const rec = byLocation.get(locationId);
    return {
      locationId,
      locationName: nameById[locationId] || '—',
      weeklyPool: rec.weeklyPool,
      dailyByDay: rec.dailyByDay,
    };
  }).sort((a, b) => (a.locationName || '').localeCompare(b.locationName || ''));
}

/**
 * Get all active production staff (for admin and payout).
 */
async function getProductionStaff() {
  return ProductionStaff.find({ isActive: true }).sort({ name: 1 }).lean();
}

/**
 * Build tardiness map (staff name -> weekly minutes).
 * When options.connecteamPayload is provided, uses that (from Connecteam API for date range); otherwise reads from WeeklyTardinessCache.
 * First punch per (name, date).
 */
async function getProductionTardinessMap(weekStartStr, staffNames, options = {}) {
  const map = new Map(staffNames.map((n) => [n, 0]));
  let entries = [];
  if (options.connecteamPayload && Array.isArray(options.connecteamPayload.entries)) {
    entries = options.connecteamPayload.entries;
  } else {
    const tardinessDocs = await WeeklyTardinessCache.find({ weekStart: weekStartStr }).lean();
    for (const doc of tardinessDocs) {
      if (doc.payload?.entries && Array.isArray(doc.payload.entries)) {
        entries.push(...doc.payload.entries);
      }
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
 * options: { startDate, endDate } — when both set, fetches tardiness from Connecteam for that range and uses range for days.
 */
async function getWeeklyProductionPayout(weekStartStr, options = {}) {
  const staff = await ProductionStaff.find({ isActive: true }).sort({ name: 1 });
  if (staff.length === 0) {
    return {
      weekStart: weekStartStr,
      weekEnd: '',
      redistributionPool: 0,
      payouts: [],
      ...(options.startDate && options.endDate && { dateRange: { startDate: options.startDate.trim().slice(0, 10), endDate: options.endDate.trim().slice(0, 10) } }),
    };
  }
  const useDateRange = options.startDate && options.endDate && typeof options.startDate === 'string' && typeof options.endDate === 'string';
  let dateStrs;
  let weekEndStr;
  let weekStartForManual = weekStartStr;
  if (useDateRange) {
    const start = options.startDate.trim().slice(0, 10);
    const end = options.endDate.trim().slice(0, 10);
    dateStrs = getDatesInRange(start, end);
    weekEndStr = end;
    weekStartForManual = start;
  } else {
    const [y, mo, day] = weekStartStr.split('-').map(Number);
    const weekEnd = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));
    weekEndStr = weekEnd.toISOString().slice(0, 10);
    dateStrs = [];
    for (let i = 0; i < 7; i++) {
      dateStrs.push(new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0)).toISOString().slice(0, 10));
    }
  }
  const numDays = dateStrs.length;

  // Use the same source as "Location-wise tip pool" so both tables always match.
  const locationWise = await getLocationWiseProductionPool(weekStartStr, options);
  const dailyPoolByDate = new Map(
    dateStrs.map((d, idx) => [
      d,
      roundMoney(
        locationWise.reduce(
          (sum, row) => sum + (Number((row.dailyByDay || [])[idx]) || 0),
          0,
        ),
      ),
    ]),
  );

  const staffNames = staff.map((s) => s.name.trim());
  let tardinessMap;
  if (useDateRange) {
    const connecteamPayload = await connecteamsService.getTardinessFromConnecteamsByDateRange(
      options.startDate.trim().slice(0, 10),
      options.endDate.trim().slice(0, 10),
      null
    );
    tardinessMap = await getProductionTardinessMap(weekStartStr, staffNames, { connecteamPayload });
  } else {
    tardinessMap = await getProductionTardinessMap(weekStartStr, staffNames);
  }
  const manualDeductions = await ProductionManualDeduction.find({ weekStart: weekStartForManual })
    .populate('productionStaffId')
    .lean();
  const manualMap = new Map();
  manualDeductions.forEach((m) => {
    const id = m.productionStaffId?._id?.toString();
    if (id) manualMap.set(id, { amount: m.amount, reason: m.reason || '' });
  });

  const dailyGrossByStaffId = new Map();
  for (const s of staff) {
    dailyGrossByStaffId.set(s._id.toString(), Array(numDays).fill(0));
  }

  for (let i = 0; i < numDays; i += 1) {
    const dateStr = dateStrs[i];
    const pool = dailyPoolByDate.get(dateStr) || 0;
    const byStaffId = allocateCentsProportionally(
      staff,
      pool,
      (member) => Number(member.allocationPercent) || 0,
      (member) => member?._id?.toString?.() || '',
    );
    for (const s of staff) {
      const id = s._id.toString();
      const arr = dailyGrossByStaffId.get(id);
      arr[i] = byStaffId.get(id) || 0;
    }
  }

  const totalWeeklyPool = roundMoney(
    dateStrs.reduce((sum, d) => sum + (dailyPoolByDate.get(d) || 0), 0),
  );
  const weeklyGrossByStaffId = allocateCentsProportionally(
    staff,
    totalWeeklyPool,
    (member) => Number(member.allocationPercent) || 0,
    (member) => member?._id?.toString?.() || '',
  );

  const rows = [];
  for (const s of staff) {
    const id = s._id.toString();
    const dailyByDay = dailyGrossByStaffId.get(id) || Array(numDays).fill(0);
    const weeklyGross = roundMoney(weeklyGrossByStaffId.get(id) || 0);
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
  const redistributionByStaffId = allocateCentsProportionally(
    eligible,
    totalRedistributionPool,
    (r) => r.allocationPercent || 0,
    (r) => r.productionStaffId?.toString?.() || '',
  );

  for (const row of rows) {
    const id = row.productionStaffId?.toString?.() || '';
    row.tardinessRedistribution = redistributionByStaffId.get(id) || 0;
    row.finalWeeklyProductionPayout = roundMoney(row.netWeeklyProductionTips + row.tardinessRedistribution);
  }

  return {
    weekStart: weekStartForManual,
    weekEnd: weekEndStr,
    ...(useDateRange && { dateRange: { startDate: options.startDate.trim().slice(0, 10), endDate: options.endDate.trim().slice(0, 10) } }),
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
  getLocationWiseProductionPool,
  getProductionStaff,
  getWeeklyProductionPayout,
  upsertProductionManualDeduction,
  getProductionManualDeductions,
};
