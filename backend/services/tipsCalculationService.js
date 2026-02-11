const DailyTipInput = require('../models/DailyTipInput');
const TimeEntry = require('../models/TimeEntry');
const ManualWorking = require('../models/ManualWorking');
const WeeklyTardiness = require('../models/WeeklyTardiness');
const ManualDeduction = require('../models/ManualDeduction');
const Employee = require('../models/Employee');
const Location = require('../models/Location');
const DailyTipAudit = require('../models/DailyTipAudit');
const { PRODUCTION_DEDUCTION_PERCENT, SHIFT_BOUNDARIES, TARDINESS_TIERS, ROUND_DECIMALS } = require('../utils/constants');
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
async function getDailyTipCalculation(locationId, date) {
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

  const timeEntries = await TimeEntry.find({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  })
    .populate('employeeId', 'name')
    .lean();
  const manualEntries = await ManualWorking.find({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  })
    .populate('employeeId', 'name')
    .lean();

  // Step 2.1 Deduplication: same employee + same date + same clock-in + same clock-out → keep one
  const dedupeKey = new Set();
  const deduplicatedEntries = [];
  for (const entry of timeEntries) {
    const empId = (entry.employeeId && entry.employeeId._id) ? entry.employeeId._id.toString() : '';
    const key = `${empId}|${entry.clockIn}|${entry.clockOut}`;
    if (dedupeKey.has(key)) continue;
    dedupeKey.add(key);
    deduplicatedEntries.push(entry);
  }

  // Step 2.2 & 4: Group by employee → sum AM/PM hours from all (deduplicated) entries
  const employeeHours = new Map();
  for (const entry of deduplicatedEntries) {
    const { amHours, pmHours } = splitWorkedHours(entry.clockIn, entry.clockOut);
    const empId = entry.employeeId._id.toString();
    const empName = entry.employeeId.name || '—';
    if (!employeeHours.has(empId)) {
      employeeHours.set(empId, {
        employeeId: entry.employeeId._id,
        employeeName: empName,
        amHours: 0,
        pmHours: 0,
      });
    }
    const row = employeeHours.get(empId);
    row.amHours += amHours;
    row.pmHours += pmHours;
  }

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
      deduplicatedEntries: deduplicatedEntries.map((e) => ({
        employeeId: e.employeeId._id,
        employeeName: (e.employeeId && e.employeeId.name) || '—',
        clockIn: e.clockIn,
        clockOut: e.clockOut,
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
  const found = calc.employeeAllocations.find((a) => a.employeeId.toString() === employeeId.toString());
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
  const tardinessRecords = await WeeklyTardiness.find({ locationId, weekStart });
  const manualDeductions = await ManualDeduction.find({ locationId, weekStart });

  const tardinessMap = new Map();
  tardinessRecords.forEach((t) => tardinessMap.set(t.employeeId.toString(), t.totalTardinessMinutes));
  const manualMap = new Map();
  manualDeductions.forEach((m) => manualMap.set(m.employeeId.toString(), { amount: m.amount, reason: m.reason }));

  const dailyTipsByEmployee = new Map();
  const employeeWeeklyHours = new Map();

  for (const emp of employees) {
    let weeklyGrossTips = 0;
    let weeklyWorkedHours = 0;
    const dailyTipsByDay = [0, 0, 0, 0, 0, 0, 0];

    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0));
      const dateStr = d.toISOString().slice(0, 10);
      const tips = await getEmployeeDailyTipsForDate(emp._id, locationId, dateStr);
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

  const eligibleEmployees = rows.filter((r) => r.eligibleForRedistribution);
  const eligibleTotalHours = eligibleEmployees.reduce((sum, r) => sum + r.weeklyWorkedHours, 0);

  for (const row of rows) {
    let redistributed = 0;
    if (row.eligibleForRedistribution && eligibleTotalHours > 0 && totalRedistributionPool > 0) {
      redistributed = roundMoney((row.weeklyWorkedHours / eligibleTotalHours) * totalRedistributionPool);
    }
    row.tardinessRedistribution = redistributed;
    row.finalWeeklyTipsPayable = roundMoney(row.netWeeklyTips + redistributed);
  }

  const weekEnd = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));
  const location = await Location.findById(locationId).select('name');
  return {
    locationId,
    locationName: location?.name || '',
    weekStart: weekStartStr,
    weekEnd: weekEnd.toISOString().slice(0, 10),
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
