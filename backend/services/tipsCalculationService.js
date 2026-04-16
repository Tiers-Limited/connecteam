const mongoose = require('mongoose');
const DailyTipInput = require('../models/DailyTipInput');
const TimeEntry = require('../models/TimeEntry');
const ManualWorking = require('../models/ManualWorking');
const WeeklyTardiness = require('../models/WeeklyTardiness');
const WeeklyTardinessCache = require('../models/WeeklyTardinessCache');
const ManualDeduction = require('../models/ManualDeduction');
const DailyTipAdjustment = require('../models/DailyTipAdjustment');
const Employee = require('../models/Employee');
const Location = require('../models/Location');
const DailyTipAudit = require('../models/DailyTipAudit');
const ProductionStaff = require('../models/ProductionStaff');
const connecteamsService = require('./connecteamsService');
const employeeService = require('./employeeService');
const { PRODUCTION_DEDUCTION_PERCENT, SHIFT_BOUNDARIES, shiftBoundariesForLocationName, LOCATION_SINGLE_SHIFT, TARDINESS_TIERS, ROUND_DECIMALS, LOCATIONS, JOB_TIP_MULTIPLIERS } = require('../utils/constants');
const {
  getWeekStart,
  getWeekEnd,
  timeToMinutes,
  toDateString,
  isDateInWeek,
  getDatesInRange,
  getAppTimezone,
  dateStringToUtcRange,
  dateRangeToUtcBounds,
  formatDateStringInTimezone,
} = require('../utils/dateUtils');


function splitWorkedHours(clockIn, clockOut, opts = {}) {
  const inMin = timeToMinutes(clockIn);
  const outMinRaw = timeToMinutes(clockOut);
  if (inMin == null || outMinRaw == null || Number.isNaN(inMin) || Number.isNaN(outMinRaw)) {
    return { amHours: 0, pmHours: 0 };
  }

  let startMin = inMin;
  let endMin = outMinRaw;
  if (endMin <= startMin) {
    if (endMin === startMin) return { amHours: 0, pmHours: 0 };
    endMin += 24 * 60;
  }

  if (opts.singleShift) {
    // For a single-shift location (The Cove), use the full clocked duration, no AM/PM split.
    const totalMinutes = endMin - startMin;
    return {
      amHours: totalMinutes / 60,
      pmHours: 0,
    };
  }

  const bounds = opts.shiftBoundaries || SHIFT_BOUNDARIES;
  const AM_START = timeToMinutes(bounds.AM_START);
  const AM_END = timeToMinutes(bounds.AM_END);
  const PM_END = timeToMinutes(bounds.PM_END);

  let amMinutes = 0;
  let pmMinutes = 0;

  for (let m = startMin; m < endMin; m++) {
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
 * Round to configured decimals (output stage only)
 */
function roundMoney(value) {
  const scale = 10 ** ROUND_DECIMALS;
  return Math.round(value * scale) / scale;
}

/** Round to 4 decimals (for redistribution so small amounts are not lost) */
function roundMoney4(value) {
  return Math.round(value * 10000) / 10000;
}

function employeeWorkedHoursForRedistribution(row) {
  const am = Number(row?.amWorkedHours ?? row?.amHours) || 0;
  const pm = Number(row?.pmWorkedHours ?? row?.pmHours) || 0;
  return Math.max(0, am + pm);
}

function weightedHoursForTipRate(employeeHoursMap) {
  let totalWeightedAMHours = 0;
  let totalWeightedPMHours = 0;
  const multiplierByKey = new Map();

  for (const [key, row] of employeeHoursMap.entries()) {
    const jobMultiplier = getJobTipMultiplier(row.jobTitle);
    multiplierByKey.set(key, jobMultiplier);
    totalWeightedAMHours += (Number(row.amHours) || 0) * jobMultiplier;
    totalWeightedPMHours += (Number(row.pmHours) || 0) * jobMultiplier;
  }

  return {
    totalWeightedAMHours,
    totalWeightedPMHours,
    multiplierByKey,
  };
}

function allocateRoundedByLargestRemainder(rawRows, targetTotal) {
  const scale = 10 ** ROUND_DECIMALS;
  const targetUnits = Math.max(0, Math.round((Number(targetTotal) || 0) * scale));
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return [];
  }

  const seeded = rawRows.map((value, index) => {
    const safeValue = Math.max(0, Number(value) || 0);
    const exactUnits = safeValue * scale;
    const floorUnits = Math.floor(exactUnits);
    return {
      index,
      floorUnits,
      fraction: exactUnits - floorUnits,
    };
  });

  const floorTotal = seeded.reduce((sum, row) => sum + row.floorUnits, 0);
  let remainder = targetUnits - floorTotal;

  const ordered = seeded
    .slice()
    .sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      return a.index - b.index;
    });

  for (let i = 0; i < ordered.length && remainder > 0; i += 1) {
    ordered[i].floorUnits += 1;
    remainder -= 1;
  }

  // Safety for over-allocation edge cases caused by floating noise.
  if (remainder < 0) {
    const reverse = ordered.slice().reverse();
    for (let i = 0; i < reverse.length && remainder < 0; i += 1) {
      if (reverse[i].floorUnits > 0) {
        reverse[i].floorUnits -= 1;
        remainder += 1;
      }
    }
  }

  const out = new Array(rawRows.length).fill(0);
  for (const row of ordered) {
    out[row.index] = row.floorUnits / scale;
  }
  return out;
}

function computeHourWeightedRedistributionShares(employeeAllocations, redistributionExcluded, redistributionPool) {
  const recipients = (employeeAllocations || []).filter(
    (r) => r.employeeId && !redistributionExcluded.has(r.employeeId.toString()),
  );

  if (recipients.length === 0 || redistributionPool <= 0) {
    return {
      recipients,
      sharesByEmployeeId: new Map(),
    };
  }

  const poolAmount = Math.max(0, Number(redistributionPool) || 0);
  if (poolAmount === 0) {
    return {
      recipients,
      sharesByEmployeeId: new Map(),
    };
  }

  const recipientRows = recipients.map((row) => ({
    row,
    key: row.employeeId.toString(),
    hours: employeeWorkedHoursForRedistribution(row),
  }));

  const totalRecipientHours = recipients.reduce(
    (sum, row) => sum + employeeWorkedHoursForRedistribution(row),
    0,
  );

  // Fallback to equal split only when recipient hours are all zero.
  if (totalRecipientHours <= 0) {
    const equalShare = poolAmount / recipientRows.length;
    const sharesByEmployeeId = new Map();
    for (const item of recipientRows) {
      sharesByEmployeeId.set(item.key, equalShare);
    }
    return { recipients, sharesByEmployeeId };
  }

  const sharesByEmployeeId = new Map();
  for (const item of recipientRows) {
    const share = (item.hours / totalRecipientHours) * poolAmount;
    sharesByEmployeeId.set(item.key, share);
  }

  return { recipients, sharesByEmployeeId };
}

/**
 * 4% production pool is taken from total gross (AM + PM). Each shift’s share of the pool
 * is proportional to that shift’s gross, so:
 *   AM distributable = AM gross − pool × (AM gross / total gross)
 *   PM distributable = PM gross − pool × (PM gross / total gross)
 * (Same numeric result as subtracting 4% of each shift’s gross when the pool is 4% of total.)
 */
function computeProductionPoolAndDistributables(tipInput, isTheCove) {
  const amGross = Number(tipInput.amGrossTips) || 0;
  const pmGross = Number(tipInput.pmGrossTips) || 0;
  const totalGross = amGross + pmGross;
  const productionDeductionTotal = totalGross * PRODUCTION_DEDUCTION_PERCENT;
  if (isTheCove) {
    return {
      productionDeductionTotal,
      productionDeductionAM: productionDeductionTotal,
      productionDeductionPM: 0,
      distributableAM: totalGross - productionDeductionTotal,
      distributablePM: 0,
    };
  }
  const productionDeductionAM =
    totalGross <= 0 ? 0 : (amGross / totalGross) * productionDeductionTotal;
  const productionDeductionPM =
    totalGross <= 0 ? 0 : (pmGross / totalGross) * productionDeductionTotal;
  return {
    productionDeductionTotal,
    productionDeductionAM,
    productionDeductionPM,
    distributableAM: amGross - productionDeductionAM,
    distributablePM: pmGross - productionDeductionPM,
  };
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
 * Get job-based tip multiplier for a job title
 * @param {string} jobTitle - The job title from Connecteam
 * @returns {number} Multiplier between 0.0 and 1.0
 */
function getJobTipMultiplier(jobTitle) {
  console.log("job title", jobTitle);
  if (!jobTitle) return JOB_TIP_MULTIPLIERS.default || 1.0;
  const title = String(jobTitle).trim();
  // Exact match first
  if (title in JOB_TIP_MULTIPLIERS) {
    return JOB_TIP_MULTIPLIERS[title];
  }
  // Case-insensitive match
  const titleLower = title.toLowerCase();
  for (const [key, multiplier] of Object.entries(JOB_TIP_MULTIPLIERS)) {
    if (key !== 'default' && key.toLowerCase() === titleLower) {
      return multiplier;
    }
  }
  // Default multiplier
  return JOB_TIP_MULTIPLIERS.default || 1.0;
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
  const tz = getAppTimezone();
  const { startMs, endMs } = dateStringToUtcRange(dateStr, tz);
  const dateStart = new Date(startMs);
  const dateEnd = new Date(endMs);
  const timeEntryStartMs = startMs;
  const timeEntryEndMs = endMs;
  const timeEntryDayStart = dateStart;

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
  const isTheCove = (locationDoc?.name || '').trim().toLowerCase() === LOCATION_SINGLE_SHIFT.key;
  const shiftBoundaries = isTheCove ? null : shiftBoundariesForLocationName(locationDoc?.name);
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
        date: { $gte: new Date(timeEntryStartMs), $lte: new Date(timeEntryEndMs) },
      })
        .populate('employeeId', 'name connecteamsUserId')
        .lean();
      rawConnecteamEntries = timeEntriesFromDb.map((e) => ({
        date: e.date ? new Date(e.date).toISOString().slice(0, 10) : dateStr,
        clockIn: e.clockIn,
        clockOut: e.clockOut,
        connecteamsUserId: (e.employeeId && (e.employeeId.connecteamsUserId != null)) ? String(e.employeeId.connecteamsUserId) : (e.employeeId && e.employeeId._id ? e.employeeId._id.toString() : ''),
        employeeName: (e.employeeId && e.employeeId.name) || '',
        jobTitle: e.jobTitle || null,
        subJobId: e.subJobId || null,
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
        jobTitle: entry.jobTitle || null,
        subJobId: entry.subJobId || null,
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
      // Use the job title from whichever entry we have it from
      if (!row.jobTitle && entry.jobTitle) {
        row.jobTitle = entry.jobTitle;
        row.subJobId = entry.subJobId || null;
      }
    }
  }

  // Resolve Connecteam user to our Employee (for allocation output); use stable key for map
  const employeeHours = new Map();
  for (const [connecteamsUserId, row] of employeeFirstLast) {
    const { amHours, pmHours } = splitWorkedHours(row.firstIn, row.lastOut, {
      singleShift: isTheCove,
      shiftBoundaries: shiftBoundaries || undefined,
      shiftStart: LOCATION_SINGLE_SHIFT.shiftStart,
      shiftEnd: LOCATION_SINGLE_SHIFT.shiftEnd,
    });
    let employee = await Employee.findOne({ connecteamsUserId, locationId }).lean();
    if (!employee && row.employeeName && String(row.employeeName).trim()) {
      employee = await Employee.findOne({ locationId, name: String(row.employeeName).trim() }).lean();
    }
    const employeeId = employee?._id || null;
    const employeeName = employee?.name || row.employeeName;
    const mapKey = employeeId ? employeeId.toString() : `connecteam_${connecteamsUserId}`;
    
    // If a subJobId exists we always want to resolve the actual job title from
    // Connecteam.  The raw entry.jobTitle is derived from the parent/jobId
    // (typically the location) and will not reflect a sub‑job such as
    // "Dishwasher".  Overwrite whatever was captured earlier.
    let jobTitle = row.jobTitle;
    if (row.subJobId) {
      try {
        const jobInfo = await connecteamsService.getJobInfo(row.subJobId);
        if (jobInfo && jobInfo.title) {
          jobTitle = jobInfo.title;
        }
      } catch (err) {
        console.warn(`[getDailyTipCalculation] Failed to fetch job info for ${row.subJobId}:`, err.message);
      }
    }
    
    if (jobTitle) {
      console.log(`[DailyTip] Employee: ${employeeName} | Job: ${jobTitle}`);
    }
    
    employeeHours.set(mapKey, {
      employeeId,
      employeeName,
      amHours,
      pmHours,
      clockIn: row.firstIn,
      clockOut: row.lastOut,
      jobTitle,
      subJobId: row.subJobId,
    });
  }

  if (usedConnecteamApi && !options.preFetchedEntries && rawConnecteamEntries.length > 0) {
    for (const row of employeeHours.values()) {
      if (row.employeeId && row.clockIn && row.clockOut) {
        await TimeEntry.findOneAndUpdate(
          { employeeId: row.employeeId, locationId, date: timeEntryDayStart },
          { $set: { clockIn: row.clockIn, clockOut: row.clockOut, jobTitle: row.jobTitle, subJobId: row.subJobId } },
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
    if (isTheCove) {
      row.amHours += (manual.amHours || 0) + (manual.pmHours || 0);
      row.manualAmTips = (row.manualAmTips || 0) + (manual.amTips || 0) + (manual.pmTips || 0);
      manualAMTipsTotal += (manual.amTips || 0) + (manual.pmTips || 0);
    } else {
      row.amHours += manual.amHours;
      row.pmHours += manual.pmHours;
      row.manualAmTips = (row.manualAmTips || 0) + manual.amTips;
      row.manualPmTips = (row.manualPmTips || 0) + manual.pmTips;
      manualAMTipsTotal += manual.amTips;
      manualPMTipsTotal += manual.pmTips;
    }
    const mcIn = (manual.clockIn || '').trim();
    const mcOut = (manual.clockOut || '').trim();
    if (mcIn && mcOut && !row.clockIn && !row.clockOut) {
      row.clockIn = mcIn;
      row.clockOut = mcOut;
    }
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

  // Step 7: Production pool (4% of total gross); AM/PM distributable = shift gross minus that shift’s share of the pool
  const {
    productionDeductionTotal,
    productionDeductionAM,
    productionDeductionPM,
    distributableAM,
    distributablePM,
  } = computeProductionPoolAndDistributables(tipInput, isTheCove);

  const combinedManualTips = manualAMTipsTotal + manualPMTipsTotal;
  const adjustedDistributableAM = isTheCove ? Math.max(0, distributableAM - combinedManualTips) : Math.max(0, distributableAM - manualAMTipsTotal);
  const adjustedDistributablePM = isTheCove ? 0 : Math.max(0, distributablePM - manualPMTipsTotal);

  // Step 8: Tip rate (guardrail: 0 if no weighted hours; no rounding here)
  // Use multiplier-weighted hours so the allocated AM/PM totals match distributables.
  const {
    totalWeightedAMHours,
    totalWeightedPMHours,
    multiplierByKey,
  } = weightedHoursForTipRate(employeeHours);
  const amTipRate =
    totalWeightedAMHours > 0 ? adjustedDistributableAM / totalWeightedAMHours : 0;
  const pmTipRate = isTheCove
    ? 0
    : totalWeightedPMHours > 0
      ? adjustedDistributablePM / totalWeightedPMHours
      : 0;

  // Step 9: Employee tip allocation; round only at output (2 decimals)
  // Apply job-based multiplier to tips
  const allocationDrafts = [];
  for (const [mapKey, row] of employeeHours.entries()) {
    const jobMultiplier = multiplierByKey.get(mapKey) ?? getJobTipMultiplier(row.jobTitle);
    const amTipsRaw = row.amHours * amTipRate * jobMultiplier;
    const pmTipsRaw = row.pmHours * pmTipRate * jobMultiplier;
    allocationDrafts.push({
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      jobTitle: row.jobTitle || null,
      jobTipMultiplier: jobMultiplier,
      clockIn: row.clockIn || null,
      clockOut: row.clockOut || null,
      amWorkedHours: row.amHours,
      pmWorkedHours: row.pmHours,
      amTipsRaw,
      pmTipsRaw,
      manualAmTipsRaw: row.manualAmTips || 0,
      manualPmTipsRaw: row.manualPmTips || 0,
    });
  }

  const employeeAllocations = allocationDrafts.map((draft, idx) => {
    const amTips = draft.amTipsRaw ?? 0;
    const pmTips = draft.pmTipsRaw ?? 0;
    const manualAmTips = draft.manualAmTipsRaw ?? 0;
    const manualPmTips = draft.manualPmTipsRaw ?? 0;
    const totalTips = amTips + pmTips + manualAmTips + manualPmTips;
    return {
      employeeId: draft.employeeId,
      employeeName: draft.employeeName,
      jobTitle: draft.jobTitle,
      jobTipMultiplier: draft.jobTipMultiplier,
      clockIn: draft.clockIn,
      clockOut: draft.clockOut,
      amWorkedHours: draft.amWorkedHours,
      pmWorkedHours: draft.pmWorkedHours,
      amTips,
      pmTips,
      manualAmTips,
      manualPmTips,
      totalTips,
    };
  });

  // Step 9b: Daily adjustments
  const adjustments = await DailyTipAdjustment.find({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  }).lean();
  const cashAdvanceByEmp = new Map();
  const redistributeByEmp = new Map();
  for (const a of adjustments) {
    const empKey = a.employeeId?.toString?.() || String(a.employeeId || '');
    const amt = Number(a.amount) || 0;
    if (!empKey || amt <= 0) continue;
    if (a.type === 'cash_advance') cashAdvanceByEmp.set(empKey, (cashAdvanceByEmp.get(empKey) || 0) + amt);
    if (a.type === 'redistribute_equal') redistributeByEmp.set(empKey, (redistributeByEmp.get(empKey) || 0) + amt);
  }

  let redistributionPool = 0;
  const redistributionExcluded = new Set();
  for (const [empKey, amt] of redistributeByEmp.entries()) {
    redistributionPool += amt;
    redistributionExcluded.add(empKey);
  }

  const { sharesByEmployeeId } =
    computeHourWeightedRedistributionShares(employeeAllocations, redistributionExcluded, redistributionPool);

  for (const r of employeeAllocations) {
    const empKey = r.employeeId?.toString?.() || '';
    const cashAdvance = cashAdvanceByEmp.get(empKey) || 0;
    const redistributeDeduction = redistributeByEmp.get(empKey) || 0;
    const redistributionShare = sharesByEmployeeId.get(empKey) || 0;

    const finalTipsRaw = (Number(r.totalTips) || 0) - cashAdvance - redistributeDeduction + redistributionShare;
    const finalTips = Math.max(0, finalTipsRaw);

    r.cashAdvanceDeduction = cashAdvance;
    r.redistributeDeduction = redistributeDeduction;
    r.redistributionShare = redistributionShare;
    r.finalTips = finalTips;
  }

  // Step 10: Audit snapshot (raw, derived, financial)
  const auditPayload = {
    locationId,
    date: dateStart,
    raw: {
      source: 'Connecteam API',
      // One row per employee with resolved hours (includes first/last punch for audit UI / snapshot).
      firstLastPerEmployee: Array.from(employeeHours.values())
        .filter((r) => r.clockIn && r.clockOut)
        .map((r) => ({
          ...(r.employeeId ? { employeeId: r.employeeId } : {}),
          employeeName: r.employeeName,
          firstClockIn: r.clockIn,
          lastClockOut: r.clockOut,
          jobTitle: r.jobTitle || undefined,
        })),
    },
    derived: {
      employeeHours: Array.from(employeeHours.values()).map((r) => ({
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        jobTitle: r.jobTitle,
        jobTipMultiplier: getJobTipMultiplier(r.jobTitle),
        amHours: r.amHours,
        pmHours: r.pmHours,
        firstClockIn: r.clockIn ?? null,
        lastClockOut: r.clockOut ?? null,
      })),
      totalAMHours,
      totalPMHours,
    },
    financial: {
      amGrossTips: tipInput.amGrossTips,
      pmGrossTips: tipInput.pmGrossTips,
      productionDeductionAM,
      productionDeductionPM,
      distributableAM,
      distributablePM,
      amTipRate,
      pmTipRate,
      employeePayouts: employeeAllocations.map((a) => ({
        employeeId: a.employeeId,
        employeeName: a.employeeName,
        amTips: a.amTips,
        pmTips: a.pmTips,
        totalTips: a.totalTips,
        finalTips: a.finalTips,
      })),
    },
  };
  try {
    await DailyTipAudit.findOneAndUpdate(
      { locationId, date: { $gte: dateStart, $lte: dateEnd } },
      { $set: auditPayload },
      { upsert: true, new: true }
    );
    await DailyTipInput.findByIdAndUpdate(tipInput._id, {
      $set: { calculationCompletedAt: new Date() },
    });
  } catch (err) {
    console.warn('[getDailyTipCalculation] Audit or completion flag failed:', err.message);
  }

  return {
    locationId,
    date: dateStr,
    inputs: {
      amGrossTips: tipInput.amGrossTips,
      pmGrossTips: tipInput.pmGrossTips,
      productionDeductionAM,
      productionDeductionPM,
      distributableAM,
      distributablePM,
      manualAmTipsTotal: manualAMTipsTotal,
      manualPmTipsTotal: manualPMTipsTotal,
      adjustedDistributableAM,
      adjustedDistributablePM,
      distributable: isTheCove ? adjustedDistributableAM : null,
      tipRate: isTheCove ? amTipRate : null,
      redistributionPool,
    },
    totals: {
      totalAMHours,
      totalPMHours,
      amTipRate,
      pmTipRate,
    },
    employeeAllocations,
    adjustments: adjustments.map((a) => ({
      employeeId: a.employeeId,
      type: a.type,
      amount: Number(a.amount) || 0,
      reason: a.reason || '',
    })),
    audit: auditPayload,
    fromSnapshot: false,
  };
}

function normalizeTipEmployeeName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** First clock-in / last clock-out per employeeId for a location+day (matches tip calc aggregation). */
function mapFirstLastClockByEmployeeFromTimeEntries(entries) {
  const byEmp = new Map();
  for (const entry of entries) {
    const id = entry.employeeId != null ? String(entry.employeeId) : '';
    if (!id || !entry.clockIn || !entry.clockOut) continue;
    const inMin = timeToMinutes(entry.clockIn);
    const outMin = timeToMinutes(entry.clockOut);
    if (inMin == null || outMin == null || Number.isNaN(inMin) || Number.isNaN(outMin)) continue;
    if (!byEmp.has(id)) {
      byEmp.set(id, { firstIn: entry.clockIn, lastOut: entry.clockOut, inMin, outMin });
    } else {
      const row = byEmp.get(id);
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
  const out = new Map();
  for (const [id, row] of byEmp) {
    out.set(id, { clockIn: row.firstIn, clockOut: row.lastOut });
  }
  return out;
}

/**
 * Rebuild GET /calculation response from DailyTipAudit (no Connecteam). Returns null if no audit — caller runs full calc.
 * @returns {Promise<object|null>} Full calc-shaped object, or { error } if no tip input, or null if no audit.
 */
async function getDailyTipCalculationSnapshot(locationId, date) {
  const dateStr = typeof date === 'string' ? date.slice(0, 10) : toDateString(date);
  const tz = getAppTimezone();
  const { startMs, endMs } = dateStringToUtcRange(dateStr, tz);
  const dateStart = new Date(startMs);
  const dateEnd = new Date(endMs);

  const tipInput = await DailyTipInput.findOne({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  }).lean();
  if (!tipInput) {
    return { error: 'No tip input for this location and date', locationId, date: dateStr };
  }

  const audit = await DailyTipAudit.findOne({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  }).lean();
  if (!audit || !audit.financial) {
    return null;
  }

  const locationDoc = await Location.findById(locationId).select('name').lean();
  const isTheCove = (locationDoc?.name || '').trim().toLowerCase() === LOCATION_SINGLE_SHIFT.key;

  const adjustments = await DailyTipAdjustment.find({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  }).lean();

  const manualEntries = await ManualWorking.find({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  }).lean();

  let manualAMTipsTotal = 0;
  let manualPMTipsTotal = 0;
  for (const manual of manualEntries) {
    if (isTheCove) {
      manualAMTipsTotal += (Number(manual.amTips) || 0) + (Number(manual.pmTips) || 0);
    } else {
      manualAMTipsTotal += Number(manual.amTips) || 0;
      manualPMTipsTotal += Number(manual.pmTips) || 0;
    }
  }

  const manualClockByEmpId = new Map();
  for (const m of manualEntries) {
    const eid = m.employeeId != null ? String(m.employeeId) : '';
    const cin = (m.clockIn || '').trim();
    const cout = (m.clockOut || '').trim();
    if (eid && cin && cout) manualClockByEmpId.set(eid, { clockIn: cin, clockOut: cout });
  }

  const fin = audit.financial;
  const derived = audit.derived || {};
  const raw = audit.raw || {};

  const {
    productionDeductionAM,
    productionDeductionPM,
    distributableAM,
    distributablePM,
  } = computeProductionPoolAndDistributables(tipInput, isTheCove);

  const combinedManualTips = manualAMTipsTotal + manualPMTipsTotal;
  const adjustedDistributableAM = isTheCove
    ? Math.max(0, distributableAM - combinedManualTips)
    : Math.max(0, distributableAM - manualAMTipsTotal);
  const adjustedDistributablePM = isTheCove ? 0 : Math.max(0, distributablePM - manualPMTipsTotal);

  const totalAMHours = Number(derived.totalAMHours) || 0;
  const totalPMHours = Number(derived.totalPMHours) || 0;
  const weightedHoursRows = Array.isArray(derived.employeeHours) ? derived.employeeHours : [];
  const totalWeightedAMHours = weightedHoursRows.reduce((sum, h) => {
    const amHours = Number(h?.amHours) || 0;
    const multiplier =
      h?.jobTipMultiplier != null
        ? Number(h.jobTipMultiplier) || 0
        : getJobTipMultiplier(h?.jobTitle);
    return sum + amHours * multiplier;
  }, 0);
  const totalWeightedPMHours = weightedHoursRows.reduce((sum, h) => {
    const pmHours = Number(h?.pmHours) || 0;
    const multiplier =
      h?.jobTipMultiplier != null
        ? Number(h.jobTipMultiplier) || 0
        : getJobTipMultiplier(h?.jobTitle);
    return sum + pmHours * multiplier;
  }, 0);
  const amTipRate =
    totalWeightedAMHours > 0 ? adjustedDistributableAM / totalWeightedAMHours : 0;
  const pmTipRate = isTheCove
    ? 0
    : totalWeightedPMHours > 0
      ? adjustedDistributablePM / totalWeightedPMHours
      : 0;

  const hoursByEmpId = new Map();
  for (const h of derived.employeeHours || []) {
    const k = h.employeeId != null ? String(h.employeeId) : '';
    if (k) hoursByEmpId.set(k, h);
  }

  const timeEntryDocs = await TimeEntry.find({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  })
    .select('employeeId clockIn clockOut')
    .lean();
  const clockByEmployeeIdFromDb = mapFirstLastClockByEmployeeFromTimeEntries(timeEntryDocs);

  const firstLastList = raw.firstLastPerEmployee || raw.deduplicatedEntries || [];
  const clockByName = new Map();
  const clockByEmpIdFromRaw = new Map();
  for (const r of firstLastList) {
    const cid = r.employeeId != null ? String(r.employeeId) : '';
    const cin = r.firstClockIn ?? r.clockIn ?? null;
    const cout = r.lastClockOut ?? r.clockOut ?? null;
    if (cid && cin && cout) clockByEmpIdFromRaw.set(cid, { clockIn: cin, clockOut: cout });
    const n = normalizeTipEmployeeName(r.employeeName);
    if (!n || clockByName.has(n)) continue;
    clockByName.set(n, { clockIn: cin, clockOut: cout });
  }

  const cashAdvanceByEmp = new Map();
  const redistributeByEmp = new Map();
  for (const a of adjustments) {
    const empKey = a.employeeId?.toString?.() || String(a.employeeId || '');
    const amt = Number(a.amount) || 0;
    if (!empKey || amt <= 0) continue;
    if (a.type === 'cash_advance') cashAdvanceByEmp.set(empKey, (cashAdvanceByEmp.get(empKey) || 0) + amt);
    if (a.type === 'redistribute_equal') redistributeByEmp.set(empKey, (redistributeByEmp.get(empKey) || 0) + amt);
  }
  let redistributionPool = 0;
  const redistributionExcluded = new Set();
  for (const [empKey, amt] of redistributeByEmp.entries()) {
    redistributionPool += amt;
    redistributionExcluded.add(empKey);
  }

  const payouts = Array.isArray(fin.employeePayouts) ? fin.employeePayouts : [];
  const employeeAllocations = payouts.map((p) => {
    const empKey = p.employeeId != null ? String(p.employeeId) : '';
    const h = empKey ? hoursByEmpId.get(empKey) : null;
    const nameKey = normalizeTipEmployeeName(p.employeeName);
    const fromDerived =
      h && (h.firstClockIn || h.lastClockOut)
        ? { clockIn: h.firstClockIn ?? null, clockOut: h.lastClockOut ?? null }
        : {};
    const fromRawEmp = empKey ? clockByEmpIdFromRaw.get(empKey) : null;
    const fromDb = empKey ? clockByEmployeeIdFromDb.get(empKey) : null;
    const fl = clockByName.get(nameKey) || {};
    let clockIn =
      fromDerived.clockIn ?? fromRawEmp?.clockIn ?? fromDb?.clockIn ?? fl.clockIn ?? null;
    let clockOut =
      fromDerived.clockOut ?? fromRawEmp?.clockOut ?? fromDb?.clockOut ?? fl.clockOut ?? null;
    const manualClock = manualClockByEmpId.get(empKey);
    if (manualClock && (!clockIn || !clockOut)) {
      clockIn = manualClock.clockIn;
      clockOut = manualClock.clockOut;
    }
    return {
      employeeId: p.employeeId,
      employeeName: p.employeeName,
      jobTitle: h?.jobTitle ?? null,
      jobTipMultiplier: h?.jobTipMultiplier != null ? h.jobTipMultiplier : getJobTipMultiplier(h?.jobTitle),
      clockIn,
      clockOut,
      amWorkedHours: Number(h?.amHours ?? 0),
      pmWorkedHours: Number(h?.pmHours ?? 0),
      amTips: Number(p.amTips ?? 0),
      pmTips: Number(p.pmTips ?? 0),
      manualAmTips: 0,
      manualPmTips: 0,
      totalTips: Number(p.totalTips ?? 0),
      cashAdvanceDeduction: 0,
      redistributeDeduction: 0,
      redistributionShare: 0,
      finalTips: 0,
    };
  });

  const { sharesByEmployeeId } =
    computeHourWeightedRedistributionShares(employeeAllocations, redistributionExcluded, redistributionPool);

  for (const r of employeeAllocations) {
    const empKey = r.employeeId?.toString?.() || '';
    const cashAdvance = cashAdvanceByEmp.get(empKey) || 0;
    const redistributeDeduction = redistributeByEmp.get(empKey) || 0;
    const redistributionShare = sharesByEmployeeId.get(empKey) || 0;
    const finalTipsRaw =
      (Number(r.totalTips) || 0) - cashAdvance - redistributeDeduction + redistributionShare;
    r.cashAdvanceDeduction = cashAdvance;
    r.redistributeDeduction = redistributeDeduction;
    r.redistributionShare = redistributionShare;
    r.finalTips = Math.max(0, finalTipsRaw);
  }

  const inputs = {
    amGrossTips: tipInput.amGrossTips,
    pmGrossTips: tipInput.pmGrossTips,
    productionDeductionAM,
    productionDeductionPM,
    distributableAM,
    distributablePM,
    manualAmTipsTotal,
    manualPmTipsTotal,
    adjustedDistributableAM,
    adjustedDistributablePM,
    distributable: isTheCove ? adjustedDistributableAM : null,
    tipRate: isTheCove ? amTipRate : null,
    redistributionPool,
  };

  const totals = {
    totalAMHours,
    totalPMHours,
    amTipRate,
    pmTipRate,
  };

  return {
    locationId,
    date: dateStr,
    inputs,
    totals,
    employeeAllocations,
    adjustments: adjustments.map((a) => ({
      employeeId: a.employeeId,
      type: a.type,
      amount: Number(a.amount) || 0,
      reason: a.reason || '',
    })),
    audit,
    fromSnapshot: true,
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
 * options: { startDate, endDate } — when both set, fetches tardiness from Connecteam for that range and uses range for days.
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
    const { startMs: dayStartMs, endMs: dayEndMs } = dateStringToUtcRange(dateStr, getAppTimezone());
    const audit = await DailyTipAudit.findOne({
      locationId: locationIdObj,
      date: { $gte: new Date(dayStartMs), $lte: new Date(dayEndMs) },
    }).lean();
    if ((audit?.financial?.employeePayouts?.length) || (audit?.derived?.employeeHours?.length)) {
      auditByDate.set(dateStr, audit);
      daysWithTipInput.push(dateStr);
    }
  }
  console.log('[getWeeklyPayout] Tip data from DB (DailyTipAudit):', {
    locationId: locationIdObj?.toString(),
    dateStrs,
    daysWithTipInput,
    auditDates: Array.from(auditByDate.keys()),
    auditSummary: Array.from(auditByDate.entries()).map(([d, a]) => ({
      date: d,
      employeePayoutsCount: a?.financial?.employeePayouts?.length ?? 0,
      employeeHoursCount: a?.derived?.employeeHours?.length ?? 0,
    })),
  });

  // Include employees who only appear in daily tip audits (e.g. manual hours, not in Connecteam tardiness).
  const auditEmployeeIdSet = new Set();
  for (const audit of auditByDate.values()) {
    for (const p of audit?.financial?.employeePayouts || []) {
      if (p.employeeId) auditEmployeeIdSet.add(String(p.employeeId));
    }
    for (const h of audit?.derived?.employeeHours || []) {
      if (h.employeeId) auditEmployeeIdSet.add(String(h.employeeId));
    }
  }
  const existingIdSet = new Set(employees.map((e) => String(e._id)));
  const missingAuditIds = [...auditEmployeeIdSet].filter(
    (id) => !existingIdSet.has(id) && mongoose.Types.ObjectId.isValid(id),
  );
  if (missingAuditIds.length > 0) {
    const oidList = missingAuditIds.map((id) => new mongoose.Types.ObjectId(id));
    const extra = await Employee.find({
      _id: { $in: oidList },
      locationId: locationIdObj,
    }).lean();
    for (const ex of extra) {
      const nameTrim = (ex.name || '').toString().trim();
      if (productionNames.has(nameTrim)) continue;
      employees.push(ex);
    }
  }

  // Cache which days have adjustments (so legacy audits can be recomputed once).
  const adjustmentsByDateStr = new Set();
  if (dateStrs.length > 0) {
    const { startMs: adjRangeStart, endMs: adjRangeEnd } = dateRangeToUtcBounds(
      dateStrs[0],
      dateStrs[dateStrs.length - 1],
      getAppTimezone(),
    );
    const adj = await DailyTipAdjustment.find({
      locationId: locationIdObj,
      date: { $gte: new Date(adjRangeStart), $lte: new Date(adjRangeEnd) },
    })
      .select('date')
      .lean();
    for (const a of adj) {
      if (a?.date) {
        adjustmentsByDateStr.add(formatDateStringInTimezone(new Date(a.date).getTime(), getAppTimezone()));
      }
    }
  }

  // Cache recalculated daily tip computations by date when legacy audits lack `finalTips`.
  const calcByDate = new Map(); // dateStr -> calc result

  for (const emp of employees) {
    let weeklyGrossTips = 0;
    let weeklyWorkedHours = 0;
    const dailyTipsByDay = Array(numDays).fill(0);

    for (let i = 0; i < numDays; i++) {
      const dateStr = dateStrs[i];
      let tips = 0;
      let dayHours = 0;

      const audit = auditByDate.get(dateStr);
      const payouts = audit?.financial?.employeePayouts;
      if (Array.isArray(payouts)) {
        let payout = payouts.find((p) => p.employeeId && String(p.employeeId) === String(emp._id));
        if (!payout && emp.name) {
          const empNameNorm = String(emp.name).trim().toLowerCase();
          payout = payouts.find((p) => !p.employeeId && String(p.employeeName || '').trim().toLowerCase() === empNameNorm);
        }
        if (payout) {
          // Prefer finalTips (Daily Tips "Total" column), fallback to totalTips for legacy audits.
          tips = Number(payout.finalTips ?? payout.totalTips) || 0;
          // If legacy audit has no finalTips but adjustments might exist, recompute for accuracy.
          if (payout.finalTips == null && payout.totalTips != null) {
            if (adjustmentsByDateStr.has(dateStr)) {
              let calc = calcByDate.get(dateStr);
              if (!calc) {
                calc = await getDailyTipCalculation(locationIdObj, dateStr).catch(() => null);
                if (calc && !calc.error) calcByDate.set(dateStr, calc);
              }
              if (calc && !calc.error) {
                const alloc = (calc.employeeAllocations || []).find(
                  (a) => a.employeeId && String(a.employeeId) === String(emp._id)
                );
                if (alloc) tips = Number(alloc.finalTips ?? alloc.totalTips) || tips;
              }
            }
          }
        }
      }
      const hoursList = audit?.derived?.employeeHours;
      if (Array.isArray(hoursList)) {
        let hoursRow = hoursList.find((h) => h.employeeId && String(h.employeeId) === String(emp._id));
        if (!hoursRow && emp.name) {
          const empNameNorm = String(emp.name).trim().toLowerCase();
          hoursRow = hoursList.find((h) => !h.employeeId && String(h.employeeName || '').trim().toLowerCase() === empNameNorm);
        }
        if (hoursRow) dayHours = (Number(hoursRow.amHours) || 0) + (Number(hoursRow.pmHours) || 0);
      }

      weeklyGrossTips += tips;
      dailyTipsByDay[i] = roundMoney(tips);
      // dayHours already includes manual hours merged in DailyTipAudit (from getDailyTipCalculation).
      weeklyWorkedHours += dayHours;
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
  getDailyTipCalculationSnapshot,
  getEmployeeDailyTipsForDate,
  getWeeklyPayout,
  clearProductionStaffNamesCache,
};
