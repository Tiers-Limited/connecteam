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
const ProductionStaff = require('../models/ProductionStaff');
const connecteamsService = require('./connecteamsService');
const employeeService = require('./employeeService');
const { PRODUCTION_DEDUCTION_PERCENT, SHIFT_BOUNDARIES, TARDINESS_TIERS, ROUND_DECIMALS, LOCATIONS } = require('../utils/constants');
const { getWeekStart, getWeekEnd, timeToMinutes, toDateString, isDateInWeek, getDatesInRange } = require('../utils/dateUtils');

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

/** Set of active production staff names (excluded from Daily Tips and Weekly Payout). */
let productionStaffNamesCache = null;
async function getProductionStaffNames() {
  if (productionStaffNamesCache) return productionStaffNamesCache;
  const staff = await ProductionStaff.find({ isActive: true }).select('name').lean();
  productionStaffNamesCache = new Set(staff.map((s) => (s.name || '').toString().trim()).filter(Boolean));
  return productionStaffNamesCache;
}
function clearProductionStaffNamesCache() {
  productionStaffNamesCache = null;
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
  let usedConnecteamApi = false;
  if (options.preFetchedEntries && Array.isArray(options.preFetchedEntries)) {
    rawConnecteamEntries = options.preFetchedEntries.filter((e) => (e.date || '').toString().slice(0, 10) === dateStr);
  } else {
    try {
      rawConnecteamEntries = await connecteamsService.getTimeEntriesFromConnecteams(dateStr, dateStr);
      usedConnecteamApi = true;
    } catch (err) {
      const timeEntriesFromDb = await TimeEntry.find({
        locationId,
        date: { $gte: dateStart, $lte: dateEnd },
      })
        .populate('employeeId', 'name connecteamsUserId')
        .lean();
      rawConnecteamEntries = timeEntriesFromDb.map((e) => ({
        date: e.date ? new Date(e.date).toISOString().slice(0, 10) : dateStr,
        clockIn: e.clockIn,
        clockOut: e.clockOut,
        connecteamsUserId: (e.employeeId && (e.employeeId.connecteamsUserId != null)) ? String(e.employeeId.connecteamsUserId) : (e.employeeId && e.employeeId._id ? e.employeeId._id.toString() : ''),
        employeeName: (e.employeeId && e.employeeId.name) || '',
      }));
      if (rawConnecteamEntries.length === 0) {
        return { error: 'Failed to load time entries from Connecteam: ' + (err.message || 'Unknown error') + '. Sync time entries for this location/date from Time Entries (Load from Connecteam), then try again.', locationId, date: dateStr };
      }
    }
  }

  // When using preFetchedEntries (from DB by locationId), entries are already for this location – do not filter by locationKey (DB entries have no locationKey)
  const connecteamEntries =
    options.preFetchedEntries && Array.isArray(options.preFetchedEntries)
      ? rawConnecteamEntries
      : locationKeyFilter
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

  if (usedConnecteamApi && !options.preFetchedEntries && rawConnecteamEntries.length > 0) {
    for (const row of employeeHours.values()) {
      if (row.employeeId && row.clockIn && row.clockOut) {
        await TimeEntry.findOneAndUpdate(
          { employeeId: row.employeeId, locationId, date: dateStart },
          { $set: { clockIn: row.clockIn, clockOut: row.clockOut } },
          { upsert: true }
        );
      }
    }
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

  // Exclude production staff: they are paid from Production Pool only, not from Daily Tips
  const productionNames = await getProductionStaffNames();
  const keysToRemove = [];
  for (const [key, row] of employeeHours.entries()) {
    if (productionNames.has((row.employeeName || '').toString().trim())) keysToRemove.push(key);
  }
  keysToRemove.forEach((k) => employeeHours.delete(k));

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
 * Phase 2: Get weekly payout for a location and week (Monday–Sunday) or date range.
 * options: { startDate, endDate } — when both set, fetches tardiness from ConnectTeam for that range and uses range for days.
 */
async function getWeeklyPayout(locationId, weekStartDate, options = {}) {
  const useDateRange =
    options.startDate && typeof options.startDate === 'string' && options.endDate && typeof options.endDate === 'string' &&
    options.startDate.trim() && options.endDate.trim();

  let weekStartStr;
  let dateStrs;
  let weekStart;
  let weekEndDate;
  let y; let mo; let day;

  if (useDateRange) {
    const startDate = options.startDate.trim().slice(0, 10);
    const endDate = options.endDate.trim().slice(0, 10);
    dateStrs = getDatesInRange(startDate, endDate);
    weekStartStr = startDate;
    const [sy, smo, sday] = startDate.split('-').map(Number);
    const [ey, emo, eday] = endDate.split('-').map(Number);
    weekStart = new Date(Date.UTC(sy, smo - 1, sday, 0, 0, 0, 0));
    weekEndDate = new Date(Date.UTC(ey, emo - 1, eday, 23, 59, 59, 999));
    y = sy; mo = smo; day = sday;
  } else {
    const inputStr = typeof weekStartDate === 'string' ? weekStartDate.slice(0, 10) : toDateString(weekStartDate);
    const d = new Date(inputStr + 'T12:00:00.000Z');
    const utcDay = d.getUTCDay();
    const daysToMonday = utcDay === 0 ? 6 : utcDay - 1;
    d.setUTCDate(d.getUTCDate() - daysToMonday);
    weekStartStr = d.toISOString().slice(0, 10);
    [y, mo, day] = weekStartStr.split('-').map(Number);
    weekStart = new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0));
    weekEndDate = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));
    dateStrs = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0));
      dateStrs.push(dt.toISOString().slice(0, 10));
    }
  }

  const locationIdObj =
    typeof locationId === 'string' && mongoose.Types.ObjectId.isValid(locationId)
      ? new mongoose.Types.ObjectId(locationId)
      : locationId;

  const locationDoc = await Location.findById(locationIdObj).select('name').lean();
  const locationKey = locationDoc?.name
    ? (LOCATIONS.find((l) => (l.name || '').toLowerCase() === (locationDoc.name || '').toLowerCase())?.key)
    : null;

  const productionNames = await getProductionStaffNames();

  // When using a date range, match records stored with that range (weekStart + weekEnd). Legacy week-only records have weekEnd null.
  const weekEndForQuery = useDateRange ? weekEndDate : null;
  const tardinessQuery = { locationId: locationIdObj, weekStart, weekEnd: weekEndForQuery };

  const tardinessRecords = await WeeklyTardiness.find(tardinessQuery)
    .populate('employeeId')
    .lean();

  const tardinessMap = new Map();
  const workingMinutesMap = new Map();
  const dailyBreakdownByEmployeeId = new Map();
  let employees = [];

  if (tardinessRecords.length > 0) {
    for (const t of tardinessRecords) {
      const eid = t.employeeId?._id?.toString?.() ?? t.employeeId?.toString?.() ?? t.employeeId;
      if (!eid) continue;
      const emp = t.employeeId;
      if (!emp || (emp && !emp.name)) continue;
      tardinessMap.set(eid, t.totalTardinessMinutes ?? 0);
      workingMinutesMap.set(eid, Number(t.totalWorkingMinutes) || 0);
      if (Array.isArray(t.dailyBreakdown) && t.dailyBreakdown.length > 0) {
        dailyBreakdownByEmployeeId.set(eid, t.dailyBreakdown);
      }
      employees.push(emp && emp._id ? { _id: emp._id, name: emp.name, connecteamsUserId: emp.connecteamsUserId } : null);
    }
    employees = employees.filter(Boolean);
    employees = employees.filter((emp) => !productionNames.has((emp.name || '').toString().trim()));
  }

  if (employees.length === 0) {
    employees = await Employee.find({ locationId: locationIdObj, isActive: true });
    employees = employees.filter((emp) => !productionNames.has((emp.name || '').toString().trim()));

    if (employees.length === 0 && locationKey) {
      if (useDateRange) {
        const connecteamPayload = await connecteamsService.getTardinessFromConnecteamsByDateRange(
          options.startDate.trim().slice(0, 10),
          options.endDate.trim().slice(0, 10),
          locationKey
        );
        const entries = connecteamPayload?.entries || [];
        const seen = new Set();
        for (const e of entries) {
          const uid = String(e.connecteamsUserId || e.employeeName || '').trim();
          if (!uid || seen.has(uid)) continue;
          seen.add(uid);
          try {
            await employeeService.findOrCreateByConnecteams(uid, locationIdObj, e.employeeName || uid);
          } catch (err) {
            console.warn('[getWeeklyPayout] Bootstrap employee:', uid, err.message);
          }
        }
        employees = await Employee.find({ locationId: locationIdObj, isActive: true });
        employees = employees.filter((emp) => !productionNames.has((emp.name || '').toString().trim()));
      } else {
        let cached = await WeeklyTardinessCache.findOne({ weekStart: weekStartStr, locationId: locationIdObj }).lean();
        if (!cached?.payload?.entries?.length) {
          cached = await WeeklyTardinessCache.findOne({ weekStart: weekStartStr, locationId: null }).lean();
        }
        const cacheEntriesCount = cached?.payload?.entries?.length ?? 0;
        if (cacheEntriesCount > 0) {
          const seen = new Set();
          for (const e of cached.payload.entries) {
            const locKey = (e.locationKey || '').toString().toLowerCase().trim();
            if (locKey !== locationKey) continue;
            const uid = String(e.connecteamsUserId || e.employeeName || '').trim();
            if (!uid || seen.has(uid)) continue;
            seen.add(uid);
            try {
              await employeeService.findOrCreateByConnecteams(uid, locationIdObj, e.employeeName || uid);
            } catch (err) {
              console.warn('[getWeeklyPayout] Bootstrap employee:', uid, err.message);
            }
          }
          employees = await Employee.find({ locationId: locationIdObj, isActive: true });
          employees = employees.filter((emp) => !productionNames.has((emp.name || '').toString().trim()));
        }
      }
    }

    if (useDateRange && locationKey && employees.length > 0) {
      const connecteamPayload = await connecteamsService.getTardinessFromConnecteamsByDateRange(
        options.startDate.trim().slice(0, 10),
        options.endDate.trim().slice(0, 10),
        locationKey
      );
      const entries = connecteamPayload?.entries || [];
      const firstPunchByKey = new Map();
      for (const e of entries) {
        const key = `${String(e.connecteamsUserId || '').trim()}|${(e.date || '').slice(0, 10)}`;
        const clockInMins = e.clockIn ? timeToMinutes(e.clockIn) : Infinity;
        const existing = firstPunchByKey.get(key);
        if (!existing || clockInMins < (existing._clockInMins ?? Infinity)) {
          firstPunchByKey.set(key, { ...e, _clockInMins: clockInMins });
        }
      }
      const tardinessByConnecteamsId = new Map();
      for (const v of firstPunchByKey.values()) {
        const uid = String(v.connecteamsUserId || '').trim();
        const mins = Math.max(0, Number(v.minutesLate) || 0);
        tardinessByConnecteamsId.set(uid, (tardinessByConnecteamsId.get(uid) || 0) + mins);
      }
      const workingByConnecteamsId = new Map();
      for (const item of connecteamPayload?.employeeTotalWorkingMinutes || []) {
        const uid = String(item.connecteamsUserId || '').trim();
        if (uid && (item.locationKey || '').toLowerCase().trim() === locationKey.toLowerCase()) {
          workingByConnecteamsId.set(uid, (workingByConnecteamsId.get(uid) || 0) + (Number(item.totalWorkingMinutes) || 0));
        }
      }
      for (const emp of employees) {
        const uid = String(emp.connecteamsUserId || '').trim();
        if (uid) {
          tardinessMap.set(emp._id.toString(), tardinessByConnecteamsId.get(uid) ?? 0);
          workingMinutesMap.set(emp._id.toString(), workingByConnecteamsId.get(uid) ?? 0);
        }
      }
      const connecteamsIdsInPayload = new Set(
        entries.map((e) => String(e.connecteamsUserId || '').trim()).filter(Boolean)
      );
      employees = employees.filter((emp) =>
        connecteamsIdsInPayload.has(String(emp.connecteamsUserId || '').trim())
      );
    } else if (!useDateRange && tardinessMap.size === 0) {
      for (const t of await WeeklyTardiness.find({ locationId: locationIdObj, weekStart }).lean()) {
        const eid = t.employeeId?.toString?.() ?? t.employeeId;
        if (eid) {
          tardinessMap.set(eid, t.totalTardinessMinutes);
          workingMinutesMap.set(eid, Number(t.totalWorkingMinutes) || 0);
        }
      }
    }
  }

  const manualDeductionsList = await ManualDeduction.find({ locationId: locationIdObj, weekStart });
  const manualMap = new Map();
  manualDeductionsList.forEach((m) => manualMap.set(m.employeeId.toString(), { amount: m.amount, reason: m.reason }));

  const dailyTipsByEmployee = new Map();
  const employeeWeeklyHours = new Map();
  const numDays = dateStrs.length;

  // Load DailyTipAudit for each day (tips and hours from audit – no TimeEntry or getDailyTipCalculation)
  const auditByDate = new Map();
  const daysWithTipInput = [];
  for (const dateStr of dateStrs) {
    const dateStart = new Date(dateStr + 'T00:00:00.000Z');
    const audit = await DailyTipAudit.findOne({
      locationId: locationIdObj,
      date: dateStart,
    }).lean();
    if ((audit?.financial?.employeePayouts?.length) || (audit?.derived?.employeeHours?.length)) {
      auditByDate.set(dateStr, audit);
      daysWithTipInput.push(dateStr);
    }
  }

  for (const emp of employees) {
    let weeklyGrossTips = 0;
    let weeklyWorkedHours = 0;
    const dailyTipsByDay = Array(numDays).fill(0);

    for (let i = 0; i < numDays; i++) {
      const dateStr = dateStrs[i];
      const dateStart = new Date(dateStr + 'T00:00:00.000Z');
      const dateEnd = new Date(dateStr + 'T23:59:59.999Z');
      let tips = 0;
      let dayHours = 0;

      const audit = auditByDate.get(dateStr);
      const payouts = audit?.financial?.employeePayouts;
      if (Array.isArray(payouts)) {
        const payout = payouts.find((p) => p.employeeId && String(p.employeeId) === String(emp._id));
        if (payout) tips = Number(payout.totalTips) || 0;
      }
      const hoursList = audit?.derived?.employeeHours;
      if (Array.isArray(hoursList)) {
        const hoursRow = hoursList.find((h) => h.employeeId && String(h.employeeId) === String(emp._id));
        if (hoursRow) dayHours = (Number(hoursRow.amHours) || 0) + (Number(hoursRow.pmHours) || 0);
      }

      weeklyGrossTips += tips;
      dailyTipsByDay[i] = roundMoney(tips);
      weeklyWorkedHours += dayHours;

      const manualEntries = await ManualWorking.find({
        employeeId: emp._id,
        locationId: locationIdObj,
        date: { $gte: dateStart, $lte: dateEnd },
      });
      for (const m of manualEntries) {
        weeklyWorkedHours += (m.amHours || 0) + (m.pmHours || 0);
      }
    }

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
      dailyTipsByDay: Array(numDays).fill(0),
    };
    const tardinessMinutes = tardinessMap.get(id) ?? 0;
    const totalWorkingMinutes = workingMinutesMap.get(id) ?? 0;
    const workingHoursForRedistribution = totalWorkingMinutes / 60;
    const deductionPercent = getTardinessDeductionPercent(tardinessMinutes);
    const tardinessDeductionAmount = roundMoney(weeklyGrossTips * deductionPercent);
    const weeklyAfterTardiness = roundMoney(weeklyGrossTips - tardinessDeductionAmount);
    totalRedistributionPool += tardinessDeductionAmount;

    const manual = manualMap.get(id) || { amount: 0, reason: '' };
    const weeklyAfterManual = Math.max(0, weeklyAfterTardiness - manual.amount);
    const netWeeklyTips = roundMoney(weeklyAfterManual);

    const dailyBreakdown = dailyBreakdownByEmployeeId.get(id) || [];
    rows.push({
      employeeId: emp._id,
      employeeName: emp.name,
      dailyTips: weeklyGrossTips,
      dailyTipsByDay: dailyTipsByDay || Array(numDays).fill(0),
      weeklyTardinessMinutes: tardinessMinutes,
      tardinessPercent: deductionPercent * 100,
      tardinessDeduction: tardinessDeductionAmount,
      weeklyAfterTardiness,
      manualDeduction: manual.amount,
      manualDeductionReason: manual.reason,
      netWeeklyTips,
      weeklyWorkedHours,
      totalWorkingMinutes,
      workingHoursForRedistribution,
      eligibleForRedistribution: tardinessMinutes <= 5 && workingHoursForRedistribution > 0,
      dailyBreakdown,
    });
  }

  // Tardiness Redistribution: pool = Σ tardiness deductions; eligible = tardiness ≤5 min AND total working hours (from Weekly Tardiness) > 0; share by total working hours. If no one has hours, distribute equally to all with tardiness ≤5 min.
  const eligibleEmployees = rows.filter((r) => r.eligibleForRedistribution);
  let eligibleTotalHours = eligibleEmployees.reduce((sum, r) => sum + r.workingHoursForRedistribution, 0);

  // Fallback: if no one has worked hours but pool > 0, treat everyone with tardiness ≤5 min as eligible (equal share)
  let equalShareEligible = [];
  if (eligibleTotalHours === 0 && totalRedistributionPool > 0) {
    equalShareEligible = rows.filter((r) => (r.weeklyTardinessMinutes ?? 0) <= 5);
  }


  for (const row of rows) {
    let redistributed = 0;
    if (totalRedistributionPool > 0) {
      if (eligibleTotalHours > 0 && row.eligibleForRedistribution) {
        redistributed = (row.workingHoursForRedistribution / eligibleTotalHours) * totalRedistributionPool;
      } else if (equalShareEligible.length > 0 && (row.weeklyTardinessMinutes ?? 0) <= 5) {
        redistributed = totalRedistributionPool / equalShareEligible.length;
      }
    }
    row.tardinessRedistribution = roundMoney(redistributed);
    row.finalWeeklyTipsPayable = roundMoney(row.netWeeklyTips + row.tardinessRedistribution);
  }

  // Guardrail: absorb floating-point rounding difference into first eligible so pool is fully distributed
  const sumRedistributed = rows.reduce((s, r) => s + r.tardinessRedistribution, 0);
  const roundingDiff = roundMoney(totalRedistributionPool - sumRedistributed);
  if (Math.abs(roundingDiff) > 1e-9 && (eligibleEmployees.length > 0 || equalShareEligible.length > 0)) {
    const firstRow = eligibleEmployees[0] || equalShareEligible[0];
    const firstId = firstRow.employeeId.toString();
    const row = rows.find((r) => r.employeeId.toString() === firstId);
    if (row) {
      row.tardinessRedistribution = roundMoney(row.tardinessRedistribution + roundingDiff);
      row.finalWeeklyTipsPayable = roundMoney(row.netWeeklyTips + row.tardinessRedistribution);
    }
  }

  const weekEndStr = weekEndDate ? weekEndDate.toISOString().slice(0, 10) : new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999)).toISOString().slice(0, 10);
  const location = await Location.findById(locationIdObj).select('name');
  const emptyReason =
    rows.length === 0 && employees.length === 0
      ? 'no_employees_for_location'
      : rows.length === 0
        ? 'no_payout_rows'
        : null;

  return {
    locationId: locationIdObj.toString ? locationIdObj.toString() : String(locationId),
    locationName: location?.name || '',
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
    redistributionPool: totalRedistributionPool,
    eligibleTotalHours,
    daysWithTipInput,
    ...(useDateRange && { dateRange: { startDate: options.startDate.trim().slice(0, 10), endDate: options.endDate.trim().slice(0, 10) } }),
    ...(emptyReason && { emptyReason }),
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
      totalWorkingMinutes: r.totalWorkingMinutes,
      dailyBreakdown: r.dailyBreakdown || [],
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
  clearProductionStaffNamesCache,
};
