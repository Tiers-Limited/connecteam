const mongoose = require('mongoose');
const DailyTipInput = require('../models/DailyTipInput');
const TimeEntry = require('../models/TimeEntry');
const ManualWorking = require('../models/ManualWorking');
const WeeklyTardiness = require('../models/WeeklyTardiness');
const WeeklyTardinessCache = require('../models/WeeklyTardinessCache');
const ManualDeduction = require('../models/ManualDeduction');
const Employee = require('../models/Employee');
const Location = require('../models/Location');
const DailyTipAudit = require('../models/DailyTipAudit');
const connecteamsService = require('./connecteamsService');
const { PRODUCTION_DEDUCTION_PERCENT, SHIFT_BOUNDARIES, TARDINESS_TIERS, ROUND_DECIMALS, LOCATIONS } = require('../utils/constants');
const { getWeekStart, getWeekEnd, timeToMinutes, toDateString, isDateInWeek } = require('../utils/dateUtils');

/**
 * Split worked time into AM (06:00-15:00) and PM (15:00-23:00) hours.
 * No rounding during calculation; round only at output stage.
 * @param {string} clockIn - "HH:mm"
 * @param {string} clockOut - "HH:mm"
 * @returns {{ amHours: number, pmHours: number }}
 */
function splitWorkedHours(clockIn, clockOut) {
  const AM_START = timeToMinutes(SHIFT_BOUNDARIES.AM_START);
  const AM_END = timeToMinutes(SHIFT_BOUNDARIES.AM_END);
  const PM_END = timeToMinutes(SHIFT_BOUNDARIES.PM_END);

  let inMin = timeToMinutes(clockIn);
  let outMin = timeToMinutes(clockOut);
  if (outMin <= inMin) {
    if (outMin === inMin) return { amHours: 0, pmHours: 0 };
    outMin += 24 * 60;
  }

  let amMinutes = 0;
  let pmMinutes = 0;

  for (let m = inMin; m < outMin; m++) {
    const minuteOfDay = m % (24 * 60);
    if (minuteOfDay >= AM_START && minuteOfDay < AM_END) amMinutes++;
    else if (minuteOfDay >= AM_END && minuteOfDay < PM_END) pmMinutes++;
  }

  return {
    amHours: amMinutes / 60,
    pmHours: pmMinutes / 60,
  };
}

/**
 * Round to 2 decimals (output stage only)
 */
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

/** Round to 4 decimals (for redistribution so small amounts are not lost) */
function roundMoney4(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Get tardiness deduction percent for weekly minutes
 */
function getTardinessDeductionPercent(minutes) {
  if (minutes <= 5) return 0;
  if (minutes <= 10) return 0.15;
  return 0.2;
}

/**
 * Normalize date to UTC midnight for query (YYYY-MM-DD)
 */
function toUTCDate(date) {
  const d = typeof date === 'string' ? date.slice(0, 10) : toDateString(date);
  return new Date(d + 'T00:00:00.000Z');
}

/**
 * Phase 1: Daily tip calculation — exact flow per Tips Calculation document.
 * 1) Raw time entries → 2) Deduplicate (same employee, date, clockIn, clockOut → one)
 * 3) Group Location → Date → Employee → entries[] → 4) Split each into AM/PM, sum per employee
 * 5) Location TOTAL_AM_HOURS / TOTAL_PM_HOURS → 6) Manager input (AM/PM gross) → 7) Production 4%
 * 8) Tip rates (guardrail 0 if no hours) → 9) Employee allocation → 10) Audit snapshot
 */
/**
 * @param {string} locationId
 * @param {string|Date} date
 * @param {{ preFetchedEntries?: Array<{ date?: string, locationKey?: string, connecteamsUserId?: string, employeeName?: string, clockIn?: string, clockOut?: string }> }} [options] - If provided, use these entries instead of calling Connecteam (used by getWeeklyPayout to pass one week's data).
 */
async function getDailyTipCalculation(locationId, date, options = {}) {
  const dateStr = typeof date === 'string' ? date.slice(0, 10) : toDateString(date);
  const dateStart = new Date(dateStr + 'T00:00:00.000Z');
  const dateEnd = new Date(dateStr + 'T23:59:59.999Z');

  const tipInput = await DailyTipInput.findOne({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  });
  if (!tipInput) {
    return { error: 'No tip input for this location and date', locationId, date: dateStr };
  }

  // Time entries from Connecteam API (or pre-fetched for the week) — one source of truth for hours
  let locationKeyFilter = null;
  const locationDoc = await Location.findById(locationId).lean();
  if (locationDoc?.name) {
    const found = LOCATIONS.find((l) => (l.name || '').toLowerCase() === (locationDoc.name || '').toLowerCase());
    if (found) locationKeyFilter = found.key;
  }

  let rawConnecteamEntries = [];
  if (options.preFetchedEntries && Array.isArray(options.preFetchedEntries)) {
    rawConnecteamEntries = options.preFetchedEntries.filter((e) => (e.date || '').toString().slice(0, 10) === dateStr);
  } else {
    try {
      rawConnecteamEntries = await connecteamsService.getTimeEntriesFromConnecteams(dateStr, dateStr);
    } catch (err) {
      return { error: 'Failed to load time entries from Connecteam: ' + (err.message || 'Unknown error'), locationId, date: dateStr };
    }
  }

  const connecteamEntries = locationKeyFilter
    ? rawConnecteamEntries.filter((e) => (e.locationKey || '').toLowerCase() === locationKeyFilter.toLowerCase() && (e.date || '').toString().slice(0, 10) === dateStr)
    : rawConnecteamEntries.filter((e) => (e.date || '').toString().slice(0, 10) === dateStr);

  // Per employee: first clock-in and last clock-out of the day (spans across AM/PM: e.g. 06:00–15:10 → 9h AM + 10min PM)
  const employeeFirstLast = new Map();
  for (const entry of connecteamEntries) {
    const uid = String(entry.connecteamsUserId || entry.employeeName || '');
    const inMin = timeToMinutes(entry.clockIn);
    const outMin = timeToMinutes(entry.clockOut);
    if (!uid) continue;
    if (!employeeFirstLast.has(uid)) {
      employeeFirstLast.set(uid, {
        connecteamsUserId: uid,
        employeeName: entry.employeeName || 'User ' + uid,
        firstIn: entry.clockIn,
        lastOut: entry.clockOut,
        inMin,
        outMin,
      });
    } else {
      const row = employeeFirstLast.get(uid);
      if (inMin < row.inMin) {
        row.firstIn = entry.clockIn;
        row.inMin = inMin;
      }
      if (outMin > row.outMin) {
        row.lastOut = entry.clockOut;
        row.outMin = outMin;
      }
    }
  }

  // Resolve Connecteam user to our Employee (for allocation output); use stable key for map
  const employeeHours = new Map();
  for (const [connecteamsUserId, row] of employeeFirstLast) {
    const { amHours, pmHours } = splitWorkedHours(row.firstIn, row.lastOut);
    const employee = await Employee.findOne({ connecteamsUserId, locationId }).lean();
    const employeeId = employee?._id || null;
    const employeeName = employee?.name || row.employeeName;
    const mapKey = employeeId ? employeeId.toString() : `connecteam_${connecteamsUserId}`;
    employeeHours.set(mapKey, {
      employeeId,
      employeeName,
      amHours,
      pmHours,
      clockIn: row.firstIn,
      clockOut: row.lastOut,
    });
  }

  const manualEntries = await ManualWorking.find({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  })
    .populate('employeeId', 'name')
    .lean();

  // Manual working entries (add hours and fixed tips)
  let manualAMTipsTotal = 0;
  let manualPMTipsTotal = 0;
  for (const manual of manualEntries) {
    const empId = manual.employeeId._id.toString();
    if (!employeeHours.has(empId)) {
      employeeHours.set(empId, {
        employeeId: manual.employeeId._id,
        employeeName: manual.employeeId.name || '—',
        amHours: 0,
        pmHours: 0,
        clockIn: null,
        clockOut: null,
        manualAmTips: 0,
        manualPmTips: 0,
      });
    }
    const row = employeeHours.get(empId);
    row.amHours += manual.amHours;
    row.pmHours += manual.pmHours;
    row.manualAmTips = (row.manualAmTips || 0) + manual.amTips;
    row.manualPmTips = (row.manualPmTips || 0) + manual.pmTips;
    manualAMTipsTotal += manual.amTips;
    manualPMTipsTotal += manual.pmTips;
  }

  // Step 5: Location-level total hours
  let totalAMHours = 0;
  let totalPMHours = 0;
  for (const row of employeeHours.values()) {
    totalAMHours += row.amHours;
    totalPMHours += row.pmHours;
  }

  // Step 7: Production pool deduction (4%)
  const productionDeductionAM = tipInput.amGrossTips * PRODUCTION_DEDUCTION_PERCENT;
  const productionDeductionPM = tipInput.pmGrossTips * PRODUCTION_DEDUCTION_PERCENT;
  const distributableAM = tipInput.amGrossTips - productionDeductionAM;
  const distributablePM = tipInput.pmGrossTips - productionDeductionPM;
  const adjustedDistributableAM = Math.max(0, distributableAM - manualAMTipsTotal);
  const adjustedDistributablePM = Math.max(0, distributablePM - manualPMTipsTotal);

  // Step 8: Tip rate (guardrail: 0 if no hours; no rounding here)
  const amTipRate = totalAMHours > 0 ? adjustedDistributableAM / totalAMHours : 0;
  const pmTipRate = totalPMHours > 0 ? adjustedDistributablePM / totalPMHours : 0;

  // Step 9: Employee tip allocation; round only at output (2 decimals)
  const employeeAllocations = [];
  for (const row of employeeHours.values()) {
    const amTips = row.amHours * amTipRate;
    const pmTips = row.pmHours * pmTipRate;
    const totalCalculated = amTips + pmTips;
    const totalTips = totalCalculated + (row.manualAmTips || 0) + (row.manualPmTips || 0);
    employeeAllocations.push({
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      clockIn: row.clockIn || null,
      clockOut: row.clockOut || null,
      amWorkedHours: roundMoney(row.amHours),
      pmWorkedHours: roundMoney(row.pmHours),
      amTips: roundMoney(amTips),
      pmTips: roundMoney(pmTips),
      manualAmTips: roundMoney(row.manualAmTips || 0),
      manualPmTips: roundMoney(row.manualPmTips || 0),
      totalTips: roundMoney(totalTips),
    });
  }

  // Step 10: Audit snapshot (raw, derived, financial)
  const auditPayload = {
    locationId,
    date: dateStart,
    raw: {
      source: 'Connecteam API',
      firstLastPerEmployee: Array.from(employeeFirstLast.values()).map((r) => ({
        connecteamsUserId: r.connecteamsUserId,
        employeeName: r.employeeName,
        firstClockIn: r.firstIn,
        lastClockOut: r.lastOut,
      })),
    },
    derived: {
      employeeHours: Array.from(employeeHours.values()).map((r) => ({
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        amHours: roundMoney(r.amHours),
        pmHours: roundMoney(r.pmHours),
      })),
      totalAMHours: roundMoney(totalAMHours),
      totalPMHours: roundMoney(totalPMHours),
    },
    financial: {
      amGrossTips: tipInput.amGrossTips,
      pmGrossTips: tipInput.pmGrossTips,
      productionDeductionAM: roundMoney(productionDeductionAM),
      productionDeductionPM: roundMoney(productionDeductionPM),
      distributableAM: roundMoney(distributableAM),
      distributablePM: roundMoney(distributablePM),
      amTipRate: roundMoney(amTipRate),
      pmTipRate: roundMoney(pmTipRate),
      employeePayouts: employeeAllocations.map((a) => ({
        employeeId: a.employeeId,
        employeeName: a.employeeName,
        amTips: a.amTips,
        pmTips: a.pmTips,
        totalTips: a.totalTips,
      })),
    },
  };
  await DailyTipAudit.findOneAndUpdate(
    { locationId, date: dateStart },
    { $set: auditPayload },
    { upsert: true, new: true }
  ).catch(() => {});

  return {
    locationId,
    date: dateStr,
    inputs: {
      amGrossTips: tipInput.amGrossTips,
      pmGrossTips: tipInput.pmGrossTips,
      productionDeductionAM: roundMoney(productionDeductionAM),
      productionDeductionPM: roundMoney(productionDeductionPM),
      distributableAM: roundMoney(distributableAM),
      distributablePM: roundMoney(distributablePM),
      manualAmTipsTotal: roundMoney(manualAMTipsTotal),
      manualPmTipsTotal: roundMoney(manualPMTipsTotal),
      adjustedDistributableAM: roundMoney(adjustedDistributableAM),
      adjustedDistributablePM: roundMoney(adjustedDistributablePM),
    },
    totals: {
      totalAMHours: roundMoney(totalAMHours),
      totalPMHours: roundMoney(totalPMHours),
      amTipRate: roundMoney(amTipRate),
      pmTipRate: roundMoney(pmTipRate),
    },
    employeeAllocations,
    audit: auditPayload,
  };
}

/**
 * Get daily tips total for an employee at a location for a given date (for Phase 2 aggregation)
 */
async function getEmployeeDailyTipsForDate(employeeId, locationId, date) {
  const calc = await getDailyTipCalculation(locationId, date);
  if (calc.error) return 0;
  const found = calc.employeeAllocations.find((a) => a.employeeId && a.employeeId.toString() === employeeId.toString());
  return found ? found.totalTips : 0;
}

/**
 * Phase 2: Get weekly payout for a location and week (Monday–Sunday)
 * Uses calendar dates (YYYY-MM-DD) and UTC so the week is consistent regardless of server TZ.
 */
async function getWeeklyPayout(locationId, weekStartDate) {
  const weekStartStr = typeof weekStartDate === 'string' ? weekStartDate.slice(0, 10) : toDateString(weekStartDate);
  const [y, mo, day] = weekStartStr.split('-').map(Number);
  const weekStart = new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0));

  const employees = await Employee.find({ locationId, isActive: true });
  const manualDeductions = await ManualDeduction.find({ locationId, weekStart });

  const tardinessMap = new Map();
  const cacheLocationId =
    typeof locationId === 'string' && mongoose.Types.ObjectId.isValid(locationId)
      ? new mongoose.Types.ObjectId(locationId)
      : locationId;
  const cached = await WeeklyTardinessCache.findOne({
    weekStart: weekStartStr,
    locationId: cacheLocationId,
  }).lean();
  if (cached && cached.payload && Array.isArray(cached.payload.entries)) {
    const entries = cached.payload.entries;
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
    const totalByEmployeeName = new Map();
    for (const [key, { minutesLate }] of firstPunchByKey) {
      const name = key.split('|')[0];
      totalByEmployeeName.set(name, (totalByEmployeeName.get(name) || 0) + minutesLate);
    }
    const nameToId = new Map(employees.map((emp) => [emp.name.trim(), emp._id.toString()]));
    for (const emp of employees) {
      const total = totalByEmployeeName.get(emp.name.trim()) ?? totalByEmployeeName.get(emp.name) ?? 0;
      tardinessMap.set(emp._id.toString(), total);
    }
  } else {
    const tardinessRecords = await WeeklyTardiness.find({ locationId, weekStart });
    tardinessRecords.forEach((t) => tardinessMap.set(t.employeeId.toString(), t.totalTardinessMinutes));
  }

  const manualMap = new Map();
  manualDeductions.forEach((m) => manualMap.set(m.employeeId.toString(), { amount: m.amount, reason: m.reason }));

  const dailyTipsByEmployee = new Map();
  const employeeWeeklyHours = new Map();

  // Fetch Connecteam time entries once for the full week (Mon–Sun), then reuse per day
  const weekEndStr = new Date(Date.UTC(y, mo - 1, day + 6, 0, 0, 0, 0)).toISOString().slice(0, 10);
  let weekConnecteamEntries = [];
  try {
    weekConnecteamEntries = await connecteamsService.getTimeEntriesFromConnecteams(weekStartStr, weekEndStr);
  } catch (err) {
    // If Connecteam fails, daily calcs will still run but with empty entries (tips 0)
  }

  const dailyCalcByDate = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0));
    const dateStr = d.toISOString().slice(0, 10);
    const entriesForDay = weekConnecteamEntries.filter((e) => (e.date || '').toString().slice(0, 10) === dateStr);
    const calc = await getDailyTipCalculation(locationId, dateStr, { preFetchedEntries: entriesForDay });
    dailyCalcByDate.set(dateStr, calc);
  }

  for (const emp of employees) {
    let weeklyGrossTips = 0;
    let weeklyWorkedHours = 0;
    const dailyTipsByDay = [0, 0, 0, 0, 0, 0, 0];

    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0));
      const dateStr = d.toISOString().slice(0, 10);
      const calc = dailyCalcByDate.get(dateStr);
      let tips = 0;
      if (calc && !calc.error && calc.employeeAllocations) {
        const found = calc.employeeAllocations.find((a) => a.employeeId && a.employeeId.toString() === emp._id.toString());
        tips = found ? found.totalTips : 0;
      }
      weeklyGrossTips += tips;
      dailyTipsByDay[i] = roundMoney(tips);

      const dateStart = new Date(dateStr + 'T00:00:00.000Z');
      const dateEnd = new Date(dateStr + 'T23:59:59.999Z');

      const entries = await TimeEntry.find({
        employeeId: emp._id,
        locationId,
        date: { $gte: dateStart, $lte: dateEnd },
      });
      for (const e of entries) {
        const { amHours, pmHours } = splitWorkedHours(e.clockIn, e.clockOut);
        weeklyWorkedHours += amHours + pmHours;
      }

      const manualEntries = await ManualWorking.find({
        employeeId: emp._id,
        locationId,
        date: { $gte: dateStart, $lte: dateEnd },
      });
      for (const m of manualEntries) {
        weeklyWorkedHours += m.amHours + m.pmHours;
      }
    }

    // Weekly Gross Tips = sum of daily tips for Mon–Sun (explicit sum of the 7 days)
    const sumOfDailyRounded = dailyTipsByDay.reduce((s, v) => s + (Number(v) || 0), 0);
    const weeklyGrossTipsFinal = roundMoney(sumOfDailyRounded);
    dailyTipsByEmployee.set(emp._id.toString(), {
      weeklyGrossTips: weeklyGrossTipsFinal,
      weeklyWorkedHours,
      dailyTipsByDay,
    });
    employeeWeeklyHours.set(emp._id.toString(), weeklyWorkedHours);
  }

  const rows = [];
  let totalRedistributionPool = 0;

  for (const emp of employees) {
    const id = emp._id.toString();
    const { weeklyGrossTips, weeklyWorkedHours, dailyTipsByDay } = dailyTipsByEmployee.get(id) || {
      weeklyGrossTips: 0,
      weeklyWorkedHours: 0,
      dailyTipsByDay: [0, 0, 0, 0, 0, 0, 0],
    };
    const tardinessMinutes = tardinessMap.get(id) ?? 0;
    const deductionPercent = getTardinessDeductionPercent(tardinessMinutes);
    const tardinessDeductionAmount = roundMoney(weeklyGrossTips * deductionPercent);
    const weeklyAfterTardiness = roundMoney(weeklyGrossTips - tardinessDeductionAmount);
    totalRedistributionPool += tardinessDeductionAmount;

    const manual = manualMap.get(id) || { amount: 0, reason: '' };
    const weeklyAfterManual = Math.max(0, weeklyAfterTardiness - manual.amount);
    const netWeeklyTips = roundMoney(weeklyAfterManual);

    rows.push({
      employeeId: emp._id,
      employeeName: emp.name,
      dailyTips: weeklyGrossTips,
      dailyTipsByDay: dailyTipsByDay || [0, 0, 0, 0, 0, 0, 0],
      weeklyTardinessMinutes: tardinessMinutes,
      tardinessPercent: deductionPercent * 100,
      tardinessDeduction: tardinessDeductionAmount,
      weeklyAfterTardiness,
      manualDeduction: manual.amount,
      manualDeductionReason: manual.reason,
      netWeeklyTips,
      weeklyWorkedHours,
      eligibleForRedistribution: tardinessMinutes <= 5 && weeklyWorkedHours > 0,
    });
  }

  // Tardiness Redistribution: pool = Σ tardiness deductions; eligible = tardiness ≤5 min AND worked hours > 0; share by worked hours. If no one has hours, distribute equally to all with tardiness ≤5 min.
  const eligibleEmployees = rows.filter((r) => r.eligibleForRedistribution);
  let eligibleTotalHours = eligibleEmployees.reduce((sum, r) => sum + r.weeklyWorkedHours, 0);

  // Fallback: if no one has worked hours but pool > 0, treat everyone with tardiness ≤5 min as eligible (equal share)
  let equalShareEligible = [];
  if (eligibleTotalHours === 0 && totalRedistributionPool > 0) {
    equalShareEligible = rows.filter((r) => (r.weeklyTardinessMinutes ?? 0) <= 5);
  }

  for (const row of rows) {
    let redistributed = 0;
    if (totalRedistributionPool > 0) {
      if (eligibleTotalHours > 0 && row.eligibleForRedistribution) {
        redistributed = (row.weeklyWorkedHours / eligibleTotalHours) * totalRedistributionPool;
      } else if (equalShareEligible.length > 0 && (row.weeklyTardinessMinutes ?? 0) <= 5) {
        redistributed = totalRedistributionPool / equalShareEligible.length;
      }
    }
    row.tardinessRedistribution = redistributed;
    row.finalWeeklyTipsPayable = row.netWeeklyTips + redistributed;
  }

  // Guardrail: absorb floating-point difference into first eligible so pool is fully distributed
  const sumRedistributed = rows.reduce((s, r) => s + r.tardinessRedistribution, 0);
  const roundingDiff = totalRedistributionPool - sumRedistributed;
  if (Math.abs(roundingDiff) > 1e-9 && (eligibleEmployees.length > 0 || equalShareEligible.length > 0)) {
    const firstRow = eligibleEmployees[0] || equalShareEligible[0];
    const firstId = firstRow.employeeId.toString();
    const row = rows.find((r) => r.employeeId.toString() === firstId);
    if (row) {
      row.tardinessRedistribution += roundingDiff;
      row.finalWeeklyTipsPayable = row.netWeeklyTips + row.tardinessRedistribution;
    }
  }

  const weekEnd = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));
  const location = await Location.findById(locationId).select('name');
  return {
    locationId,
    locationName: location?.name || '',
    weekStart: weekStartStr,
    weekEnd: weekEnd.toISOString().slice(0, 10),
    redistributionPool: totalRedistributionPool,
    eligibleTotalHours,
    payouts: rows.map((r) => ({
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      dailyTipsMonToSun: r.dailyTips,
      dailyTipsByDay: r.dailyTipsByDay,
      weeklyGrossTips: r.dailyTips,
      weeklyTardinessMinutes: r.weeklyTardinessMinutes,
      tardinessPercent: r.tardinessPercent,
      tardinessDeduction: r.tardinessDeduction,
      weeklyAfterTardiness: r.weeklyAfterTardiness,
      manualDeduction: r.manualDeduction,
      manualDeductionReason: r.manualDeductionReason,
      netWeeklyTips: r.netWeeklyTips,
      tardinessRedistribution: r.tardinessRedistribution,
      finalWeeklyTipsPayable: r.finalWeeklyTipsPayable,
    })),
  };
}

module.exports = {
  splitWorkedHours,
  roundMoney,
  getTardinessDeductionPercent,
  getDailyTipCalculation,
  getEmployeeDailyTipsForDate,
  getWeeklyPayout,
};
