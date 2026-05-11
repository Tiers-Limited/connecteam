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

  const DAY_MINUTES = 24 * 60;
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  let amMinutes = 0;
  let pmMinutes = 0;
  const dayStart = Math.floor(startMin / DAY_MINUTES) * DAY_MINUTES;
  const dayEnd = Math.ceil(endMin / DAY_MINUTES) * DAY_MINUTES;
  for (let d = dayStart; d < dayEnd; d += DAY_MINUTES) {
    const segStart = Math.max(startMin, d);
    const segEnd = Math.min(endMin, d + DAY_MINUTES);
    if (segEnd <= segStart) continue;
    const localStart = segStart - d;
    const localEnd = segEnd - d;
    amMinutes += overlap(localStart, localEnd, AM_START, AM_END);
    pmMinutes += overlap(localStart, localEnd, AM_END, PM_END);
  }

  return {
    amHours: amMinutes / 60,
    pmHours: pmMinutes / 60,
  };
}

function mergeIntervalsMs(intervals) {
  if (!intervals || intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const cur of sorted) {
    if (!merged.length || cur.start > merged[merged.length - 1].end) {
      merged.push({ start: cur.start, end: cur.end });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, cur.end);
    }
  }
  return merged;
}

function totalMsFromMergedIntervals(intervals) {
  if (!intervals || intervals.length === 0) return 0;
  return intervals.reduce((sum, iv) => sum + Math.max(0, iv.end - iv.start), 0);
}


function collectBreakIntervalsForEmployee(manualBreaks, connecteamsUserId, dateStr, workStartMs, workEndMs) {
  if (
    workStartMs == null ||
    workEndMs == null ||
    Number.isNaN(workStartMs) ||
    Number.isNaN(workEndMs) ||
    workEndMs <= workStartMs ||
    !manualBreaks ||
    manualBreaks.length === 0
  ) {
    return [];
  }
  const uid = String(connecteamsUserId);
  const d = (dateStr || '').slice(0, 10);
  const raw = [];
  for (const b of manualBreaks) {
    if (String(b.connecteamsUserId) !== uid) continue;
    if ((b.date || '').toString().slice(0, 10) !== d) continue;
    const s = Number(b.startMs);
    const e = Number(b.endMs);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    const ov0 = Math.max(s, workStartMs);
    const ov1 = Math.min(e, workEndMs);
    if (ov1 > ov0) raw.push({ start: ov0, end: ov1 });
  }
  return mergeIntervalsMs(raw);
}

const timeFormatterByTz = new Map();
function localHourMinuteForTz(tsMs, timeZone) {
  const tz = (timeZone || 'UTC').trim() || 'UTC';
  try {
    let fmt = timeFormatterByTz.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      timeFormatterByTz.set(tz, fmt);
    }
    const parts = fmt.formatToParts(new Date(tsMs));
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return { hour: 0, minute: 0 };
    return { hour, minute };
  } catch (_) {
    const d = new Date(tsMs);
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }
}

function formatTimeInTimezoneHHmm(tsMs, timeZone) {
  if (tsMs == null || Number.isNaN(tsMs)) return null;
  const tz = (timeZone || 'UTC').trim() || 'UTC';
  try {
    const s = new Date(tsMs).toLocaleTimeString('en-CA', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return s && s.length >= 8 ? s.slice(0, 8) : null;
  } catch (_) {
    const d = new Date(tsMs);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  }
}

function splitWorkedHoursDeducingManualBreaks(
  clockIn,
  clockOut,
  workStartMs,
  workEndMs,
  excludeIntervalsMs,
  timeZone,
  opts = {}
) {
  const tz = (timeZone || getAppTimezone()).trim() || getAppTimezone();
  if (
    workStartMs == null ||
    workEndMs == null ||
    Number.isNaN(workStartMs) ||
    Number.isNaN(workEndMs) ||
    workEndMs <= workStartMs
  ) {
    return splitWorkedHours(clockIn, clockOut, opts);
  }

  if (opts.singleShift) {
    const grossMs = workEndMs - workStartMs;
    let exclMs = 0;
    for (const iv of excludeIntervalsMs || []) {
      const lo = Math.max(iv.start, workStartMs);
      const hi = Math.min(iv.end, workEndMs);
      if (hi > lo) exclMs += hi - lo;
    }
    const netMs = Math.max(0, grossMs - exclMs);
    return { amHours: netMs / 3600000, pmHours: 0 };
  }

  const bounds = opts.shiftBoundaries || SHIFT_BOUNDARIES;
  const AM_START = timeToMinutes(bounds.AM_START);
  const AM_END = timeToMinutes(bounds.AM_END);
  const PM_END = timeToMinutes(bounds.PM_END);
  if (
    AM_START == null ||
    AM_END == null ||
    PM_END == null ||
    Number.isNaN(AM_START) ||
    Number.isNaN(AM_END) ||
    Number.isNaN(PM_END)
  ) {
    return splitWorkedHours(clockIn, clockOut, opts);
  }

  let amMinutes = 0;
  let pmMinutes = 0;
  const mergedExclusions = mergeIntervalsMs(excludeIntervalsMs || []);
  let ivIdx = 0;
  for (let t = workStartMs; t < workEndMs; t += 60 * 1000) {
    while (ivIdx < mergedExclusions.length && t >= mergedExclusions[ivIdx].end) {
      ivIdx += 1;
    }
    if (ivIdx < mergedExclusions.length) {
      const iv = mergedExclusions[ivIdx];
      if (t >= iv.start && t < iv.end) {
        t = Math.max(t, iv.end - 60 * 1000);
        continue;
      }
    }
    const { hour, minute } = localHourMinuteForTz(t, tz);
    const minuteOfDay = hour * 60 + minute;
    if (minuteOfDay >= AM_START && minuteOfDay < AM_END) amMinutes++;
    else if (minuteOfDay >= AM_END && minuteOfDay < PM_END) pmMinutes++;
  }
  return {
    amHours: amMinutes / 60,
    pmHours: pmMinutes / 60,
  };
}


function roundMoney(value) {
  const scale = 10 ** ROUND_DECIMALS;
  return Math.round(value * scale) / scale;
}

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
    const jobMultiplier = effectiveJobTipMultiplier(row);
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

function getTardinessDeductionPercent(minutes) {
  if (minutes <= 5) return 0;
  if (minutes <= 10) return 0.15;
  return 0.2;
}

function getJobTipMultiplier(jobTitle) {
  if (!jobTitle) return JOB_TIP_MULTIPLIERS.default || 1.0;
  const title = String(jobTitle).trim();
  if (title in JOB_TIP_MULTIPLIERS) {
    return JOB_TIP_MULTIPLIERS[title];
  }
  const titleLower = title.toLowerCase();
  for (const [key, multiplier] of Object.entries(JOB_TIP_MULTIPLIERS)) {
    if (key !== 'default' && key.toLowerCase() === titleLower) {
      return multiplier;
    }
  }
  return JOB_TIP_MULTIPLIERS.default || 1.0;
}

/** Employee.tipMultiplierOverride wins when set (positive); else job title from constants. */
function effectiveJobTipMultiplier(row) {
  const o = row?.tipMultiplierOverride;
  const n = o != null ? Number(o) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return getJobTipMultiplier(row?.jobTitle);
}

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
  })
    .select('locationId date amGrossTips pmGrossTips')
    .lean();
  if (!tipInput) {
    return { error: 'No tip input for this location and date', locationId, date: dateStr };
  }

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

  const connecteamManualBreaksForDay = Array.isArray(rawConnecteamEntries.manualBreaks)
    ? rawConnecteamEntries.manualBreaks.filter((b) => (b.date || '').toString().slice(0, 10) === dateStr)
    : [];

  const connecteamEntries =
    options.preFetchedEntries && Array.isArray(options.preFetchedEntries)
      ? rawConnecteamEntries
      : locationKeyFilter
        ? rawConnecteamEntries.filter((e) => (e.locationKey || '').toLowerCase() === locationKeyFilter.toLowerCase() && (e.date || '').toString().slice(0, 10) === dateStr)
        : rawConnecteamEntries.filter((e) => (e.date || '').toString().slice(0, 10) === dateStr);

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
        firstInMs: entry.clockInMs != null ? entry.clockInMs : null,
        lastOutMs: entry.clockOutMs != null ? entry.clockOutMs : null,
        timezone: entry.timezone || null,
      });
    } else {
      const row = employeeFirstLast.get(uid);
      if (inMin < row.inMin) {
        row.firstIn = entry.clockIn;
        row.inMin = inMin;
        if (entry.clockInMs != null) row.firstInMs = entry.clockInMs;
        if (entry.timezone) row.timezone = entry.timezone;
      }
      if (outMin > row.outMin) {
        row.lastOut = entry.clockOut;
        row.outMin = outMin;
        if (entry.clockOutMs != null) row.lastOutMs = entry.clockOutMs;
      }
      if (!row.jobTitle && entry.jobTitle) {
        row.jobTitle = entry.jobTitle;
        row.subJobId = entry.subJobId || null;
      }
    }
  }

  for (const entry of connecteamEntries) {
    const uid = String(entry.connecteamsUserId || entry.employeeName || '');
    if (!uid || !employeeFirstLast.has(uid)) continue;
    const row = employeeFirstLast.get(uid);
    if (entry.clockInMs != null) {
      if (row.firstInMs == null || entry.clockInMs < row.firstInMs) {
        row.firstInMs = entry.clockInMs;
        if (entry.timezone) row.timezone = entry.timezone;
      }
    }
    if (entry.clockOutMs != null) {
      if (row.lastOutMs == null || entry.clockOutMs > row.lastOutMs) {
        row.lastOutMs = entry.clockOutMs;
      }
    }
  }

  const employeeHours = new Map();
  const connecteamsIds = new Set();
  const employeeNames = new Set();
  const subJobIds = new Set();
  for (const [connecteamsUserId, row] of employeeFirstLast) {
    if (connecteamsUserId) connecteamsIds.add(String(connecteamsUserId));
    if (row.employeeName && String(row.employeeName).trim()) {
      employeeNames.add(String(row.employeeName).trim());
    }
    if (row.subJobId && !row.jobTitle) subJobIds.add(String(row.subJobId));
  }

  const employeeFilterOr = [];
  if (connecteamsIds.size > 0) {
    employeeFilterOr.push({ connecteamsUserId: { $in: [...connecteamsIds] } });
  }
  if (employeeNames.size > 0) {
    employeeFilterOr.push({ name: { $in: [...employeeNames] } });
  }
  const employeeDocs = employeeFilterOr.length
    ? await Employee.find({
        locationId,
        isActive: true,
        $or: employeeFilterOr,
      })
        .select('_id name connecteamsUserId tipMultiplierOverride')
        .lean()
    : [];
  const employeeByConnecteamId = new Map();
  const employeeByName = new Map();
  for (const e of employeeDocs) {
    const uid = String(e.connecteamsUserId || '').trim();
    if (uid && !employeeByConnecteamId.has(uid)) {
      employeeByConnecteamId.set(uid, e);
    }
    const nameKey = String(e.name || '').trim().toLowerCase();
    if (nameKey && !employeeByName.has(nameKey)) {
      employeeByName.set(nameKey, e);
    }
  }

  const jobTitleBySubJobId = new Map();
  if (subJobIds.size > 0) {
    await Promise.all(
      [...subJobIds].map(async (subJobId) => {
        try {
          const jobInfo = await connecteamsService.getJobInfo(subJobId);
          if (jobInfo?.title) {
            jobTitleBySubJobId.set(subJobId, jobInfo.title);
          }
        } catch (err) {
          console.warn(
            `[getDailyTipCalculation] Failed to fetch job info for ${subJobId}:`,
            err.message
          );
        }
      })
    );
  }

  for (const [connecteamsUserId, row] of employeeFirstLast) {
    const breakIntervals =
      connecteamManualBreaksForDay.length > 0 && row.firstInMs != null && row.lastOutMs != null
        ? collectBreakIntervalsForEmployee(
            connecteamManualBreaksForDay,
            connecteamsUserId,
            dateStr,
            row.firstInMs,
            row.lastOutMs
          )
        : [];
    const useBreakDeduction = breakIntervals.length > 0;
    const connecteamBreakHours = totalMsFromMergedIntervals(breakIntervals) / 3600000;
    const breakClockIn = useBreakDeduction
      ? formatTimeInTimezoneHHmm(breakIntervals[0].start, row.timezone || getAppTimezone())
      : null;
    const breakClockOut = useBreakDeduction
      ? formatTimeInTimezoneHHmm(breakIntervals[breakIntervals.length - 1].end, row.timezone || getAppTimezone())
      : null;
    const splitOpts = {
      singleShift: isTheCove,
      shiftBoundaries: shiftBoundaries || undefined,
      shiftStart: LOCATION_SINGLE_SHIFT.shiftStart,
      shiftEnd: LOCATION_SINGLE_SHIFT.shiftEnd,
    };
    const { amHours, pmHours } = useBreakDeduction
      ? splitWorkedHoursDeducingManualBreaks(
          row.firstIn,
          row.lastOut,
          row.firstInMs,
          row.lastOutMs,
          breakIntervals,
          row.timezone || getAppTimezone(),
          splitOpts
        )
      : splitWorkedHours(row.firstIn, row.lastOut, splitOpts);
    let employee = employeeByConnecteamId.get(String(connecteamsUserId).trim()) || null;
    if (!employee && row.employeeName && String(row.employeeName).trim()) {
      employee =
        employeeByName.get(String(row.employeeName).trim().toLowerCase()) || null;
    }
    const employeeId = employee?._id || null;
    const employeeName = employee?.name || row.employeeName;
    const mapKey = employeeId ? employeeId.toString() : `connecteam_${connecteamsUserId}`;
    let jobTitle = row.jobTitle;
    if (row.subJobId && jobTitleBySubJobId.has(String(row.subJobId))) {
      jobTitle = jobTitleBySubJobId.get(String(row.subJobId));
    }

    const tipOverride =
      employee?.tipMultiplierOverride != null &&
      Number(employee.tipMultiplierOverride) > 0
        ? Number(employee.tipMultiplierOverride)
        : undefined;
    employeeHours.set(mapKey, {
      employeeId,
      employeeName,
      amHours,
      pmHours,
      connecteamBreakHours,
      breakClockIn,
      breakClockOut,
      clockIn: row.firstIn,
      clockOut: row.lastOut,
      jobTitle,
      subJobId: row.subJobId,
      ...(tipOverride != null ? { tipMultiplierOverride: tipOverride } : {}),
    });
  }

  if (usedConnecteamApi && !options.preFetchedEntries && rawConnecteamEntries.length > 0) {
    const bulkOps = [];
    for (const row of employeeHours.values()) {
      if (!row.employeeId || !row.clockIn || !row.clockOut) continue;
      bulkOps.push({
        updateOne: {
          filter: { employeeId: row.employeeId, locationId, date: timeEntryDayStart },
          update: {
            $set: {
              clockIn: row.clockIn,
              clockOut: row.clockOut,
              jobTitle: row.jobTitle,
              subJobId: row.subJobId,
            },
          },
          upsert: true,
        },
      });
    }
    if (bulkOps.length > 0) {
      await TimeEntry.bulkWrite(bulkOps, { ordered: false });
    }
  }

  const manualEntries = await ManualWorking.find({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  })
    .populate('employeeId', 'name tipMultiplierOverride')
    .lean();

  let manualAMTipsTotal = 0;
  let manualPMTipsTotal = 0;
  for (const manual of manualEntries) {
    const empDoc = manual.employeeId;
    const empId = empDoc._id.toString();
    const fromEmpOverride =
      empDoc?.tipMultiplierOverride != null &&
      Number(empDoc.tipMultiplierOverride) > 0
        ? Number(empDoc.tipMultiplierOverride)
        : undefined;
    if (!employeeHours.has(empId)) {
      employeeHours.set(empId, {
        employeeId: empDoc._id,
        employeeName: empDoc.name || '—',
        amHours: 0,
        pmHours: 0,
        connecteamBreakHours: 0,
        breakClockIn: null,
        breakClockOut: null,
        clockIn: null,
        clockOut: null,
        manualAmTips: 0,
        manualPmTips: 0,
        ...(fromEmpOverride != null ? { tipMultiplierOverride: fromEmpOverride } : {}),
      });
    }
    const row = employeeHours.get(empId);
    if (fromEmpOverride != null) row.tipMultiplierOverride = fromEmpOverride;
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

  const productionNames = await getProductionStaffNames();
  const keysToRemove = [];
  for (const [key, row] of employeeHours.entries()) {
    if (productionNames.has((row.employeeName || '').toString().trim())) keysToRemove.push(key);
  }
  keysToRemove.forEach((k) => employeeHours.delete(k));

  const adjustments = await DailyTipAdjustment.find({
    locationId,
    date: { $gte: dateStart, $lte: dateEnd },
  }).lean();

  // Build set of employees flagged "exclude from calculation". Their hours are
  // dropped before tip-rate math, so they don't influence the pool, and their
  // cash_advance / redistribute_equal adjustments (if any) are ignored.
  const excludedEmployeeIds = new Set();
  const excludeReasonByEmp = new Map();
  for (const a of adjustments) {
    if (a.type !== 'exclude') continue;
    const amt = Number(a.amount) || 0;
    if (amt <= 0) continue;
    const empKey = a.employeeId?.toString?.() || String(a.employeeId || '');
    if (!empKey) continue;
    excludedEmployeeIds.add(empKey);
    excludeReasonByEmp.set(empKey, String(a.reason || ''));
  }

  const excludedEmployees = [];
  if (excludedEmployeeIds.size > 0) {
    for (const [mapKey, row] of Array.from(employeeHours.entries())) {
      const empKey = row.employeeId ? row.employeeId.toString() : '';
      if (!empKey || !excludedEmployeeIds.has(empKey)) continue;
      // Excluded employees' manual tips also leave the pool so distributable
      // math reflects only the staff that remain in the calculation.
      const exclManualAm = Number(row.manualAmTips) || 0;
      const exclManualPm = Number(row.manualPmTips) || 0;
      manualAMTipsTotal = Math.max(0, manualAMTipsTotal - exclManualAm);
      manualPMTipsTotal = Math.max(0, manualPMTipsTotal - exclManualPm);
      excludedEmployees.push({
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        jobTitle: row.jobTitle || null,
        amWorkedHours: row.amHours,
        pmWorkedHours: row.pmHours,
        connecteamBreakHours: row.connecteamBreakHours || 0,
        clockIn: row.clockIn || null,
        clockOut: row.clockOut || null,
        breakClockIn: row.breakClockIn || null,
        breakClockOut: row.breakClockOut || null,
        reason: excludeReasonByEmp.get(empKey) || '',
      });
      employeeHours.delete(mapKey);
    }
  }

  let totalAMHours = 0;
  let totalPMHours = 0;
  for (const row of employeeHours.values()) {
    totalAMHours += row.amHours;
    totalPMHours += row.pmHours;
  }

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

  const allocationDrafts = [];
  for (const [mapKey, row] of employeeHours.entries()) {
    const jobMultiplier =
      multiplierByKey.get(mapKey) ?? effectiveJobTipMultiplier(row);
    const amTipsRaw = row.amHours * amTipRate * jobMultiplier;
    const pmTipsRaw = row.pmHours * pmTipRate * jobMultiplier;
    const tipOverrideOut =
      row.tipMultiplierOverride != null && Number(row.tipMultiplierOverride) > 0
        ? Number(row.tipMultiplierOverride)
        : null;
    allocationDrafts.push({
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      jobTitle: row.jobTitle || null,
      jobTipMultiplier: jobMultiplier,
      tipMultiplierOverride: tipOverrideOut,
      clockIn: row.clockIn || null,
      clockOut: row.clockOut || null,
      amWorkedHours: row.amHours,
      pmWorkedHours: row.pmHours,
      connecteamBreakHours: row.connecteamBreakHours ?? 0,
      breakClockIn: row.breakClockIn || null,
      breakClockOut: row.breakClockOut || null,
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
      tipMultiplierOverride: draft.tipMultiplierOverride ?? null,
      clockIn: draft.clockIn,
      clockOut: draft.clockOut,
      amWorkedHours: draft.amWorkedHours,
      pmWorkedHours: draft.pmWorkedHours,
      connecteamBreakHours: draft.connecteamBreakHours ?? 0,
      breakClockIn: draft.breakClockIn ?? null,
      breakClockOut: draft.breakClockOut ?? null,
      amTips,
      pmTips,
      manualAmTips,
      manualPmTips,
      totalTips,
    };
  });

  const cashAdvanceByEmp = new Map();
  const redistributeByEmp = new Map();
  for (const a of adjustments) {
    const empKey = a.employeeId?.toString?.() || String(a.employeeId || '');
    const amt = Number(a.amount) || 0;
    if (!empKey || amt <= 0) continue;
    if (excludedEmployeeIds.has(empKey)) continue;
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

  const mappedAdjustments = adjustments.map((a) => ({
    employeeId: a.employeeId,
    type: a.type,
    amount: Number(a.amount) || 0,
    reason: a.reason || '',
  }));

  const resultPayload = {
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
    excludedEmployees,
    adjustments: mappedAdjustments,
    audit: null,
    fromSnapshot: false,
  };

  const auditPayload = {
    locationId,
    date: dateStart,
    raw: {
      source: 'Connecteam API',
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
        jobTipMultiplier: effectiveJobTipMultiplier(r),
        amHours: r.amHours,
        pmHours: r.pmHours,
        connecteamBreakHours: r.connecteamBreakHours ?? 0,
        breakClockIn: r.breakClockIn ?? null,
        breakClockOut: r.breakClockOut ?? null,
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
    snapshot: {
      locationId: resultPayload.locationId,
      date: resultPayload.date,
      inputs: resultPayload.inputs,
      totals: resultPayload.totals,
      employeeAllocations: resultPayload.employeeAllocations,
      excludedEmployees: resultPayload.excludedEmployees,
      adjustments: resultPayload.adjustments,
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

  resultPayload.audit = auditPayload;
  return resultPayload;
}

function normalizeTipEmployeeName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

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
async function tipMultiplierOverrideByEmployeeId(locationId) {
  const locOid =
    typeof locationId === 'string' && mongoose.Types.ObjectId.isValid(locationId)
      ? new mongoose.Types.ObjectId(locationId)
      : locationId;
  const rows = await Employee.find({
    locationId: locOid,
    isActive: true,
    tipMultiplierOverride: { $gt: 0 },
  })
    .select('_id tipMultiplierOverride')
    .lean();
  const m = new Map();
  for (const r of rows) {
    const v = Number(r.tipMultiplierOverride);
    if (Number.isFinite(v) && v > 0) m.set(String(r._id), v);
  }
  return m;
}

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

  const tipOverrideByEmpId = await tipMultiplierOverrideByEmployeeId(locationId);

  if (audit.snapshot && Array.isArray(audit.snapshot.employeeAllocations)) {
    return {
      ...audit.snapshot,
      employeeAllocations: audit.snapshot.employeeAllocations.map((a) => {
        const ek = a.employeeId != null ? String(a.employeeId) : '';
        const ov = ek ? tipOverrideByEmpId.get(ek) : null;
        return {
          ...a,
          tipMultiplierOverride:
            ov != null ? ov : a.tipMultiplierOverride != null ? a.tipMultiplierOverride : null,
        };
      }),
      excludedEmployees: Array.isArray(audit.snapshot.excludedEmployees)
        ? audit.snapshot.excludedEmployees
        : [],
      audit,
      fromSnapshot: true,
    };
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

  const excludedEmployeeIds = new Set();
  const excludeReasonByEmp = new Map();
  for (const a of adjustments) {
    if (a.type !== 'exclude') continue;
    const amt = Number(a.amount) || 0;
    if (amt <= 0) continue;
    const empKey = a.employeeId?.toString?.() || String(a.employeeId || '');
    if (!empKey) continue;
    excludedEmployeeIds.add(empKey);
    excludeReasonByEmp.set(empKey, String(a.reason || ''));
  }

  const cashAdvanceByEmp = new Map();
  const redistributeByEmp = new Map();
  for (const a of adjustments) {
    const empKey = a.employeeId?.toString?.() || String(a.employeeId || '');
    const amt = Number(a.amount) || 0;
    if (!empKey || amt <= 0) continue;
    if (excludedEmployeeIds.has(empKey)) continue;
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
  const employeeAllocations = payouts
    .filter((p) => {
      const empKey = p.employeeId != null ? String(p.employeeId) : '';
      return !empKey || !excludedEmployeeIds.has(empKey);
    })
    .map((p) => {
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
    const ov = empKey ? tipOverrideByEmpId.get(empKey) : null;
    const tipMultiplierOverride = ov != null ? ov : null;
    return {
      employeeId: p.employeeId,
      employeeName: p.employeeName,
      jobTitle: h?.jobTitle ?? null,
      jobTipMultiplier: h?.jobTipMultiplier != null ? h.jobTipMultiplier : getJobTipMultiplier(h?.jobTitle),
      tipMultiplierOverride,
      clockIn,
      clockOut,
      amWorkedHours: Number(h?.amHours ?? 0),
      pmWorkedHours: Number(h?.pmHours ?? 0),
      connecteamBreakHours: Number(h?.connecteamBreakHours ?? 0),
      breakClockIn: h?.breakClockIn ?? null,
      breakClockOut: h?.breakClockOut ?? null,
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

  let excludedEmployees = Array.isArray(audit?.snapshot?.excludedEmployees)
    ? audit.snapshot.excludedEmployees
    : [];
  if (excludedEmployees.length === 0 && excludedEmployeeIds.size > 0) {
    // Legacy audits without a saved exclude list: rebuild from audit data so the
    // UI still shows who was excluded.
    const fromAudit = [];
    for (const empKey of excludedEmployeeIds) {
      const h = hoursByEmpId.get(empKey);
      const payout = (fin.employeePayouts || []).find(
        (p) => p.employeeId != null && String(p.employeeId) === empKey,
      );
      const manualClock = manualClockByEmpId.get(empKey);
      const rawClock = clockByEmpIdFromRaw.get(empKey);
      const dbClock = clockByEmployeeIdFromDb.get(empKey);
      fromAudit.push({
        employeeId: h?.employeeId ?? payout?.employeeId ?? empKey,
        employeeName: h?.employeeName ?? payout?.employeeName ?? '',
        jobTitle: h?.jobTitle || null,
        amWorkedHours: Number(h?.amHours ?? 0),
        pmWorkedHours: Number(h?.pmHours ?? 0),
        connecteamBreakHours: Number(h?.connecteamBreakHours ?? 0),
        clockIn: h?.firstClockIn ?? rawClock?.clockIn ?? dbClock?.clockIn ?? manualClock?.clockIn ?? null,
        clockOut: h?.lastClockOut ?? rawClock?.clockOut ?? dbClock?.clockOut ?? manualClock?.clockOut ?? null,
        breakClockIn: h?.breakClockIn ?? null,
        breakClockOut: h?.breakClockOut ?? null,
        reason: excludeReasonByEmp.get(empKey) || '',
      });
    }
    excludedEmployees = fromAudit;
  }

  return {
    locationId,
    date: dateStr,
    inputs,
    totals,
    employeeAllocations,
    excludedEmployees,
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


async function getEmployeeDailyTipsForDate(employeeId, locationId, date) {
  const calc = await getDailyTipCalculation(locationId, date);
  if (calc.error) return 0;
  const found = calc.employeeAllocations.find((a) => a.employeeId && a.employeeId.toString() === employeeId.toString());
  return found ? found.totalTips : 0;
}


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
  const tardinessRecordEmployeeIdSet = new Set();
  const workingMinutesMap = new Map();
  const breakMinutesMap = new Map();
  const dailyBreakdownByEmployeeId = new Map();
  let employees = [];

  if (tardinessRecords.length > 0) {
    for (const t of tardinessRecords) {
      const eid = t.employeeId?._id?.toString?.() ?? t.employeeId?.toString?.() ?? t.employeeId;
      if (!eid) continue;
      const emp = t.employeeId;
      if (!emp || (emp && !emp.name)) continue;
      tardinessRecordEmployeeIdSet.add(eid);
      tardinessMap.set(eid, t.totalTardinessMinutes ?? 0);
      workingMinutesMap.set(eid, Number(t.totalWorkingMinutes) || 0);
      breakMinutesMap.set(eid, Number(t.totalBreakMinutes) || 0);
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
      const breakByConnecteamsId = new Map();
      for (const item of connecteamPayload?.employeeTotalWorkingMinutes || []) {
        const uid = String(item.connecteamsUserId || '').trim();
        if (uid && (item.locationKey || '').toLowerCase().trim() === locationKey.toLowerCase()) {
          workingByConnecteamsId.set(uid, (workingByConnecteamsId.get(uid) || 0) + (Number(item.totalWorkingMinutes) || 0));
        }
      }
      for (const item of connecteamPayload?.employeeTotalBreakMinutes || []) {
        const uid = String(item.connecteamsUserId || '').trim();
        if (uid && (item.locationKey || '').toLowerCase().trim() === locationKey.toLowerCase()) {
          breakByConnecteamsId.set(uid, (breakByConnecteamsId.get(uid) || 0) + (Number(item.totalBreakMinutes) || 0));
        }
      }
      for (const emp of employees) {
        const uid = String(emp.connecteamsUserId || '').trim();
        if (uid) {
          tardinessMap.set(emp._id.toString(), tardinessByConnecteamsId.get(uid) ?? 0);
          workingMinutesMap.set(emp._id.toString(), workingByConnecteamsId.get(uid) ?? 0);
          breakMinutesMap.set(emp._id.toString(), breakByConnecteamsId.get(uid) ?? 0);
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
          breakMinutesMap.set(eid, Number(t.totalBreakMinutes) || 0);
        }
      }
    }
  }

  const manualDeductionsList = await ManualDeduction.find({ locationId: locationIdObj, weekStart });
  const manualMap = new Map();
  manualDeductionsList.forEach((m) =>
    manualMap.set(m.employeeId.toString(), {
      amount: Number(m.amount) || 0,
      additionalTips: Number(m.additionalTips) || 0,
      reason: m.reason,
    })
  );

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

  // Date-range payout should only include employees that are present in:
  // - Daily Tips audits for the selected range, or
  // - persisted Weekly Tardiness records for the same range.
  // This prevents unrelated active/location employees from appearing as all-zero rows.
  if (useDateRange) {
    employees = employees.filter((emp) => {
      const id = String(emp?._id || "");
      return auditEmployeeIdSet.has(id) || tardinessRecordEmployeeIdSet.has(id);
    });
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

  let rows = [];
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
    const totalBreakMinutes = breakMinutesMap.get(id) ?? 0;
    const workingHoursForRedistribution = totalWorkingMinutes / 60;
    const deductionPercent = getTardinessDeductionPercent(tardinessMinutes);
    const tardinessDeductionAmount = roundMoney(weeklyGrossTips * deductionPercent);
    const weeklyAfterTardiness = roundMoney(weeklyGrossTips - tardinessDeductionAmount);
    totalRedistributionPool += tardinessDeductionAmount;

    const manual = manualMap.get(id) || { amount: 0, additionalTips: 0, reason: '' };
    const weeklyAfterManual = Math.max(
      0,
      weeklyAfterTardiness - (Number(manual.amount) || 0) + (Number(manual.additionalTips) || 0)
    );
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
      additionalTips: manual.additionalTips,
      manualDeductionReason: manual.reason,
      netWeeklyTips,
      weeklyWorkedHours,
      totalWorkingMinutes,
      totalBreakMinutes,
      workingHoursForRedistribution,
      eligibleForRedistribution: tardinessMinutes <= 5 && workingHoursForRedistribution > 0,
      dailyBreakdown,
    });
  }

  // For date-range payout, hide "hours-only" rows that have no payout impact.
  // This avoids showing employees that are not present in the actionable
  // weekly payout result (all zero tips/tardiness/deductions/payable).
  if (useDateRange) {
    rows = rows.filter((r) => {
      const hasGrossTips = Number(r.weeklyGrossTips || 0) > 0;
      const hasTardiness = Number(r.weeklyTardinessMinutes || 0) > 0;
      const hasTardinessDeduction = Number(r.tardinessDeduction || 0) > 0;
      const hasManualDeduction = Number(r.manualDeduction || 0) > 0;
      const hasAdditionalTips = Number(r.additionalTips || 0) > 0;
      const hasNetTips = Number(r.netWeeklyTips || 0) > 0;
      const hasPayable = Number(r.finalWeeklyTipsPayable || 0) > 0;
      return (
        hasGrossTips ||
        hasTardiness ||
        hasTardinessDeduction ||
        hasManualDeduction ||
        hasAdditionalTips ||
        hasNetTips ||
        hasPayable
      );
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
    /** Canonical YYYY-MM-DD order for dailyTipsByDay (app timezone); use for CSV/PDF headers so indices match saved payout. */
    dayDateKeys: dateStrs,
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
      additionalTips: r.additionalTips,
      manualDeductionReason: r.manualDeductionReason,
      netWeeklyTips: r.netWeeklyTips,
      tardinessRedistribution: r.tardinessRedistribution,
      finalWeeklyTipsPayable: r.finalWeeklyTipsPayable,
      totalWorkingMinutes: r.totalWorkingMinutes,
      totalBreakMinutes: r.totalBreakMinutes,
      dailyBreakdown: r.dailyBreakdown || [],
    })),
  };
}

async function getAllLocationsWeeklyFinalPayableSummary(startDate, endDate) {
  const sd = String(startDate || '').trim().slice(0, 10);
  const ed = String(endDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sd) || !/^\d{4}-\d{2}-\d{2}$/.test(ed)) {
    const err = new Error('startDate and endDate must be YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  if (new Date(`${ed}T12:00:00`) < new Date(`${sd}T12:00:00`)) {
    const err = new Error('Invalid date range (end before start)');
    err.status = 400;
    throw err;
  }

  const activeLocations = await Location.find({ isActive: true })
    .select('_id name')
    .sort({ name: 1 })
    .lean();

  const byEmployeeMap = new Map();
  for (const loc of activeLocations) {
    const locId = String(loc._id);
    const weekly = await getWeeklyPayout(locId, sd, {
      startDate: sd,
      endDate: ed,
    }).catch(() => null);
    const payouts = Array.isArray(weekly?.payouts) ? weekly.payouts : [];
    for (const p of payouts) {
      const employeeName = String(p?.employeeName || '').trim();
      if (!employeeName) continue;
      const key = employeeName.toLowerCase();
      if (!byEmployeeMap.has(key)) {
        byEmployeeMap.set(key, {
          employeeName,
          totalWorkingMinutes: 0,
          totalFinalWeeklyTipsPayable: 0,
          byLocation: {},
        });
      }
      const row = byEmployeeMap.get(key);
      if (!row.byLocation[locId]) {
        row.byLocation[locId] = { finalWeeklyTipsPayable: 0, workingMinutes: 0 };
      }
      const locCell = row.byLocation[locId];
      const addMins = Number(p?.totalWorkingMinutes) || 0;
      const addPay = Number(p?.finalWeeklyTipsPayable) || 0;
      locCell.workingMinutes += addMins;
      locCell.finalWeeklyTipsPayable += addPay;
      row.totalWorkingMinutes += addMins;
      row.totalFinalWeeklyTipsPayable += addPay;
    }
  }

  const locations = activeLocations.map((l) => ({
    locationId: String(l._id),
    locationName: l.name || '',
  }));

  const byEmployee = Array.from(byEmployeeMap.values())
    .map((row) => {
      const byLocation = {};
      for (const loc of activeLocations) {
        const lid = String(loc._id);
        const raw = row.byLocation[lid] || { finalWeeklyTipsPayable: 0, workingMinutes: 0 };
        byLocation[lid] = {
          finalWeeklyTipsPayable: roundMoney(Number(raw.finalWeeklyTipsPayable) || 0),
          workingMinutes: Math.max(0, Number(raw.workingMinutes) || 0),
        };
      }
      return {
        employeeName: row.employeeName,
        totalWorkingMinutes: Math.max(0, Number(row.totalWorkingMinutes) || 0),
        totalFinalWeeklyTipsPayable: roundMoney(
          Number(row.totalFinalWeeklyTipsPayable) || 0,
        ),
        byLocation,
      };
    })
    .sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName, undefined, { sensitivity: 'base' }),
    );

  const grandTotalFinalWeeklyTipsPayable = roundMoney(
    byEmployee.reduce(
      (sum, row) => sum + (Number(row.totalFinalWeeklyTipsPayable) || 0),
      0,
    ),
  );
  const grandTotalWorkingMinutes = byEmployee.reduce(
    (sum, row) => sum + (Number(row.totalWorkingMinutes) || 0),
    0,
  );

  const grandTotalsByLocation = {};
  for (const loc of activeLocations) {
    const lid = String(loc._id);
    grandTotalsByLocation[lid] = { finalWeeklyTipsPayable: 0, workingMinutes: 0 };
  }
  for (const empRow of byEmployee) {
    for (const loc of activeLocations) {
      const lid = String(loc._id);
      const c = empRow.byLocation[lid];
      grandTotalsByLocation[lid].finalWeeklyTipsPayable += Number(c.finalWeeklyTipsPayable) || 0;
      grandTotalsByLocation[lid].workingMinutes += Number(c.workingMinutes) || 0;
    }
  }
  for (const lid of Object.keys(grandTotalsByLocation)) {
    grandTotalsByLocation[lid].finalWeeklyTipsPayable = roundMoney(
      grandTotalsByLocation[lid].finalWeeklyTipsPayable,
    );
    grandTotalsByLocation[lid].workingMinutes = Math.max(
      0,
      Math.round(grandTotalsByLocation[lid].workingMinutes) || 0,
    );
  }

  return {
    dateRange: { startDate: sd, endDate: ed },
    locations,
    byEmployee,
    grandEmployeesCount: byEmployee.length,
    grandTotalWorkingMinutes,
    grandTotalFinalWeeklyTipsPayable,
    grandTotalsByLocation,
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
  getAllLocationsWeeklyFinalPayableSummary,
  clearProductionStaffNamesCache,
};
