const DailyTipInput = require('../models/DailyTipInput');
const TimeEntry = require('../models/TimeEntry');
const ManualWorking = require('../models/ManualWorking');
const WeeklyTardiness = require('../models/WeeklyTardiness');
const ManualDeduction = require('../models/ManualDeduction');
const Employee = require('../models/Employee');
const Location = require('../models/Location');
const { PRODUCTION_DEDUCTION_PERCENT, SHIFT_BOUNDARIES, TARDINESS_TIERS, ROUND_DECIMALS } = require('../utils/constants');
const { getWeekStart, getWeekEnd, timeToMinutes, toDateString, isDateInWeek } = require('../utils/dateUtils');

/**
 * Split worked time into AM (06:00-15:00) and PM (15:00-23:00) hours
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
  if (outMin <= inMin) outMin += 24 * 60;

  let amMinutes = 0;
  let pmMinutes = 0;

  for (let m = inMin; m < outMin; m++) {
    const minuteOfDay = m % (24 * 60);
    if (minuteOfDay >= AM_START && minuteOfDay < AM_END) amMinutes++;
    else if (minuteOfDay >= AM_END && minuteOfDay < PM_END) pmMinutes++;
  }

  return {
    amHours: Math.round(amMinutes * 100) / 100 / 60,
    pmHours: Math.round(pmMinutes * 100) / 100 / 60,
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
 * Phase 1: Calculate daily tip allocation for a location and date
 * Includes both TimeEntry (clock in/out) and ManualWorking entries
 */
async function getDailyTipCalculation(locationId, date) {
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);

  const tipInput = await DailyTipInput.findOne({ locationId, date: dateObj });
  if (!tipInput) {
    return { error: 'No tip input for this location and date', locationId, date: toDateString(dateObj) };
  }

  const timeEntries = await TimeEntry.find({ locationId, date: dateObj }).populate('employeeId', 'name');
  const manualEntries = await ManualWorking.find({ locationId, date: dateObj }).populate('employeeId', 'name');

  const productionDeductionAM = tipInput.amGrossTips * PRODUCTION_DEDUCTION_PERCENT;
  const productionDeductionPM = tipInput.pmGrossTips * PRODUCTION_DEDUCTION_PERCENT;
  const distributableAM = tipInput.amGrossTips - productionDeductionAM;
  const distributablePM = tipInput.pmGrossTips - productionDeductionPM;

  let totalAMHours = 0;
  let totalPMHours = 0;
  const employeeHours = new Map();

  // Process regular time entries
  for (const entry of timeEntries) {
    const { amHours, pmHours } = splitWorkedHours(entry.clockIn, entry.clockOut);
    totalAMHours += amHours;
    totalPMHours += pmHours;
    
    const empId = entry.employeeId._id.toString();
    if (!employeeHours.has(empId)) {
      employeeHours.set(empId, {
        employeeId: entry.employeeId._id,
        employeeName: entry.employeeId.name,
        amHours: 0,
        pmHours: 0,
      });
    }
    const emp = employeeHours.get(empId);
    emp.amHours += amHours;
    emp.pmHours += pmHours;
  }

  // Process manual working entries and add their tips directly
  let manualAMTipsTotal = 0;
  let manualPMTipsTotal = 0;
  for (const manual of manualEntries) {
    totalAMHours += manual.amHours;
    totalPMHours += manual.pmHours;
    manualAMTipsTotal += manual.amTips;
    manualPMTipsTotal += manual.pmTips;

    const empId = manual.employeeId._id.toString();
    if (!employeeHours.has(empId)) {
      employeeHours.set(empId, {
        employeeId: manual.employeeId._id,
        employeeName: manual.employeeId.name,
        amHours: 0,
        pmHours: 0,
        manualAmTips: 0,
        manualPmTips: 0,
      });
    }
    const emp = employeeHours.get(empId);
    emp.amHours += manual.amHours;
    emp.pmHours += manual.pmHours;
    emp.manualAmTips = (emp.manualAmTips || 0) + manual.amTips;
    emp.manualPmTips = (emp.manualPmTips || 0) + manual.pmTips;
  }

  // Adjust distributable amounts by subtracting manual tips
  const adjustedDistributableAM = Math.max(0, distributableAM - manualAMTipsTotal);
  const adjustedDistributablePM = Math.max(0, distributablePM - manualPMTipsTotal);

  const amTipRate = totalAMHours > 0 ? adjustedDistributableAM / totalAMHours : 0;
  const pmTipRate = totalPMHours > 0 ? adjustedDistributablePM / totalPMHours : 0;

  const employeeAllocations = Array.from(employeeHours.values()).map(({ employeeId, employeeName, amHours, pmHours, manualAmTips = 0, manualPmTips = 0 }) => {
    const amTips = amHours * amTipRate;
    const pmTips = pmHours * pmTipRate;
    const totalCalculatedTips = amTips + pmTips;
    const totalTips = totalCalculatedTips + manualAmTips + manualPmTips;
    
    return {
      employeeId,
      employeeName,
      amWorkedHours: roundMoney(amHours),
      pmWorkedHours: roundMoney(pmHours),
      amTips: roundMoney(amTips),
      pmTips: roundMoney(pmTips),
      manualAmTips: roundMoney(manualAmTips),
      manualPmTips: roundMoney(manualPmTips),
      totalTips: roundMoney(totalTips),
    };
  });

  return {
    locationId,
    date: toDateString(dateObj),
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
 * Includes calculations based on manual working entries
 */
async function getWeeklyPayout(locationId, weekStartDate) {
  const weekStart = new Date(weekStartDate);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = getWeekEnd(weekStart);

  const employees = await Employee.find({ locationId, isActive: true });
  const tardinessRecords = await WeeklyTardiness.find({ locationId, weekStart });
  const manualDeductions = await ManualDeduction.find({ locationId, weekStart });

  const tardinessMap = new Map();
  tardinessRecords.forEach((t) => tardinessMap.set(t.employeeId.toString(), t.totalTardinessMinutes));
  const manualMap = new Map();
  manualDeductions.forEach((m) => manualMap.set(m.employeeId.toString(), { amount: m.amount, reason: m.reason }));

  const dailyTipsByEmployee = new Map();
  let totalRedistributionPool = 0;
  const employeeWeeklyHours = new Map();

  for (const emp of employees) {
    let weeklyGrossTips = 0;
    let weeklyWorkedHours = 0;

    for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      const dateStr = toDateString(d);
      const tips = await getEmployeeDailyTipsForDate(emp._id, locationId, dateStr);
      weeklyGrossTips += tips;

      // Include hours from regular time entries
      const entries = await TimeEntry.find({ employeeId: emp._id, locationId, date: d });
      for (const e of entries) {
        const { amHours, pmHours } = splitWorkedHours(e.clockIn, e.clockOut);
        weeklyWorkedHours += amHours + pmHours;
      }

      // Include hours from manual working entries
      const manualEntries = await ManualWorking.find({ employeeId: emp._id, locationId, date: d });
      for (const m of manualEntries) {
        weeklyWorkedHours += m.amHours + m.pmHours;
      }
    }

    dailyTipsByEmployee.set(emp._id.toString(), { weeklyGrossTips, weeklyWorkedHours });
    employeeWeeklyHours.set(emp._id.toString(), weeklyWorkedHours);
  }

  const rows = [];
  const redistributionPoolByLocation = new Map();
  redistributionPoolByLocation.set(locationId.toString(), 0);

  for (const emp of employees) {
    const id = emp._id.toString();
    const { weeklyGrossTips, weeklyWorkedHours } = dailyTipsByEmployee.get(id) || { weeklyGrossTips: 0, weeklyWorkedHours: 0 };
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
      weeklyTardinessMinutes: tardinessMinutes,
      tardinessPercent: deductionPercent * 100,
      tardinessDeduction: tardinessDeductionAmount,
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

  const location = await Location.findById(locationId).select('name');
  return {
    locationId,
    locationName: location?.name || '',
    weekStart: toDateString(weekStart),
    weekEnd: toDateString(weekEnd),
    payouts: rows.map((r) => ({
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      dailyTipsMonToSun: r.dailyTips,
      weeklyTardinessMinutes: r.weeklyTardinessMinutes,
      tardinessPercent: r.tardinessPercent,
      tardinessDeduction: r.tardinessDeduction,
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
