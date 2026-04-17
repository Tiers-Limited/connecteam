const mongoose = require('mongoose');
const WeeklyTardiness = require('../models/WeeklyTardiness');
const ManualDeduction = require('../models/ManualDeduction');
const Employee = require('../models/Employee');
const Location = require('../models/Location');
const locationService = require('./locationService');
const employeeService = require('./employeeService');
const WeeklyPayoutCache = require('../models/WeeklyPayoutCache');
const tipsCalculationService = require('./tipsCalculationService');
const { LOCATIONS } = require('../utils/constants');

/** Normalize week start to UTC midnight (YYYY-MM-DD) so it matches getWeeklyPayout. */
function toWeekStartUTC(weekStart) {
  const str = typeof weekStart === 'string' ? weekStart.slice(0, 10) : weekStart.toISOString().slice(0, 10);
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/** Normalize week/range end to UTC end-of-day so range is explicit in DB. */
function toWeekEndUTC(weekEndStr) {
  if (!weekEndStr || typeof weekEndStr !== 'string') return null;
  const str = weekEndStr.trim().slice(0, 10);
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

/** Parse date string to UTC midnight Date for dailyBreakdown.date */
function toDateUTC(dateStr) {
  const str = (dateStr || '').toString().trim().slice(0, 10);
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/**
 * Persist weekly tardiness and working hours from Connecteam payload into WeeklyTardiness collection.
 * When weekEndStr is provided (date range), stores weekEnd and dailyBreakdown so you can see e.g. 478 min on 12 Jan, 488 on 13 Jan.
 * @param {{ entries: Array<...>, employeeTotalWorkingMinutes?: Array<...>, dailyWorkingMinutes?: Array<{ connecteamsUserId, locationKey, date, workingMinutes }> }} payload
 * @param {string} weekStartStr - YYYY-MM-DD (range start or Monday)
 * @param {string} [weekEndStr] - YYYY-MM-DD range end (inclusive). When set, record is for [weekStart, weekEnd] with dailyBreakdown.
 */
async function persistTardinessFromPayload(payload, weekStartStr, weekEndStr = null) {
  if (!payload) return;
  const ws = toWeekStartUTC(weekStartStr);
  const we = weekEndStr ? toWeekEndUTC(weekEndStr) : null;
  const locationIdByKey = {};
  for (const { key, name } of LOCATIONS) {
    const loc = await locationService.getByName(name);
    if (loc) locationIdByKey[key] = loc._id;
  }
  const timeToMins = (t) => {
    if (!t || typeof t !== 'string') return Infinity;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const totalByEmployeeLocation = new Map();
  const tardinessByEmpLocDate = new Map();
  if (Array.isArray(payload.entries) && payload.entries.length > 0) {
    const firstPunchByKey = new Map();
    for (const e of payload.entries) {
      const locKey = (e.locationKey || '').toString().toLowerCase().trim();
      if (!locKey || !locationIdByKey[locKey]) continue;
      const empKey = String(e.connecteamsUserId || e.employeeName || '').trim();
      if (!empKey) continue;
      const dateStr = (e.date || '').toString().slice(0, 10);
      const key = `${empKey}|${locKey}|${dateStr}`;
      const clockInMins = timeToMins(e.clockIn);
      const minutesLate = Math.max(0, Number(e.minutesLate) || 0);
      const existing = firstPunchByKey.get(key);
      if (existing == null || clockInMins < existing.clockInMins) {
        firstPunchByKey.set(key, { clockInMins, minutesLate, connecteamsUserId: e.connecteamsUserId, employeeName: e.employeeName, locationKey: locKey });
      }
    }
    for (const [fullKey, v] of firstPunchByKey) {
      const empLocKey = `${v.connecteamsUserId || v.employeeName}|${v.locationKey}`;
      tardinessByEmpLocDate.set(fullKey, v.minutesLate);
      const existing = totalByEmployeeLocation.get(empLocKey);
      if (!existing) {
        totalByEmployeeLocation.set(empLocKey, { totalMinutes: v.minutesLate, employeeName: v.employeeName || '' });
      } else {
        existing.totalMinutes += v.minutesLate;
      }
    }
  }

  const workingMinutesByEmpLoc = new Map();
  const empTotalWorking = payload.employeeTotalWorkingMinutes || [];
  for (const item of empTotalWorking) {
    const empKey = String(item.connecteamsUserId || item.employeeName || '').trim();
    const locKey = (item.locationKey || '').toString().toLowerCase().trim();
    if (empKey && locKey) {
      const key = `${empKey}|${locKey}`;
      workingMinutesByEmpLoc.set(key, (workingMinutesByEmpLoc.get(key) || 0) + (Number(item.totalWorkingMinutes) || 0));
    }
  }

  const dailyWorkingMinutesList = Array.isArray(payload.dailyWorkingMinutes) ? payload.dailyWorkingMinutes : [];

  const allEmpLocKeys = new Set([...totalByEmployeeLocation.keys(), ...workingMinutesByEmpLoc.keys()]);
  for (const empLocKey of allEmpLocKeys) {
    const lastPipe = empLocKey.lastIndexOf('|');
    const empIdOrName = lastPipe >= 0 ? empLocKey.slice(0, lastPipe) : empLocKey;
    const locKeyRaw = lastPipe >= 0 ? empLocKey.slice(lastPipe + 1) : '';
    const locKey = (locKeyRaw || '').toString().toLowerCase().trim();
    const locationId = locationIdByKey[locKey];
    if (!locationId) continue;

    const { totalMinutes = 0, employeeName: empName = '' } = totalByEmployeeLocation.get(empLocKey) || {};
    const totalWorkingMinutes = workingMinutesByEmpLoc.get(empLocKey) || workingMinutesByEmpLoc.get(`${empIdOrName}|${locKey}`) || 0;

    const dailyBreakdown = [];
    const datesSeen = new Set();
    for (const [key, tardinessMins] of tardinessByEmpLocDate) {
      if (!key.startsWith(empIdOrName + '|') || !key.includes('|' + locKey + '|')) continue;
      const dateStr = key.split('|')[2];
      if (dateStr) datesSeen.add(dateStr);
    }
    for (const row of dailyWorkingMinutesList) {
      const e = String(row.connecteamsUserId || '').trim();
      const l = (row.locationKey || '').toString().toLowerCase().trim();
      if (e === empIdOrName && l === locKey && row.date) datesSeen.add((row.date || '').toString().slice(0, 10));
    }
    const sortedDates = Array.from(datesSeen).sort();
    for (const dateStr of sortedDates) {
      const key = `${empIdOrName}|${locKey}|${dateStr}`;
      const tardinessMinutes = tardinessByEmpLocDate.get(key) ?? 0;
      const workingRow = dailyWorkingMinutesList.find(
        (r) => String(r.connecteamsUserId || '').trim() === empIdOrName &&
          (r.locationKey || '').toLowerCase().trim() === locKey &&
          (r.date || '').toString().slice(0, 10) === dateStr
      );
      const workingMinutes = workingRow ? (Number(workingRow.workingMinutes) || 0) : 0;
      dailyBreakdown.push({
        date: toDateUTC(dateStr),
        workingMinutes,
        tardinessMinutes,
      });
    }

    let employee = await Employee.findOne({
      connecteamsUserId: String(empIdOrName),
      locationId,
      isActive: true,
    }).lean();
    if (!employee) {
      employee = await Employee.findOne({
        locationId,
        name: { $regex: new RegExp('^' + (empIdOrName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
        isActive: true,
      }).lean();
    }
    if (!employee) {
      const item = empTotalWorking.find((i) => String(i.connecteamsUserId || i.employeeName).trim() === empIdOrName && (i.locationKey || '').toLowerCase().trim() === locKey);
      try {
        const created = await employeeService.findOrCreateByConnecteams(String(empIdOrName), locationId, (item && item.employeeName) || empName || empIdOrName);
        employee = created && typeof created.toObject === 'function' ? created.toObject() : created;
      } catch (err) {
        console.warn('[persistTardinessFromPayload] Could not create employee:', empIdOrName, err.message);
        continue;
      }
    }
    if (!employee) continue;

    const filter = { employeeId: employee._id, locationId, weekStart: ws, weekEnd: we == null ? null : we };
    const update = {
      $set: {
        totalTardinessMinutes: totalMinutes,
        totalWorkingMinutes,
        weekEnd: we,
        dailyBreakdown,
      },
    };
    await WeeklyTardiness.findOneAndUpdate(filter, update, { upsert: true, new: true });
  }
}

async function getTardiness(locationId, weekStart) {
  const ws = toWeekStartUTC(weekStart);
  return WeeklyTardiness.find({ locationId, weekStart: ws }).populate('employeeId', 'name').lean();
}

async function upsertTardiness(employeeId, locationId, weekStart, totalTardinessMinutes) {
  const ws = toWeekStartUTC(weekStart);
  return WeeklyTardiness.findOneAndUpdate(
    { employeeId, locationId, weekStart: ws },
    { $set: { totalTardinessMinutes } },
    { new: true, upsert: true }
  );
}

async function getManualDeductions(locationId, weekStart) {
  const ws = toWeekStartUTC(weekStart);
  return ManualDeduction.find({ locationId, weekStart: ws }).populate('employeeId', 'name').lean();
}

async function upsertManualDeduction(employeeId, locationId, weekStart, amount, reason) {
  const ws = toWeekStartUTC(weekStart);
  if (amount === 0) {
    await ManualDeduction.deleteOne({ employeeId, locationId, weekStart: ws });
    return { removed: true };
  }
  return ManualDeduction.findOneAndUpdate(
    { employeeId, locationId, weekStart: ws },
    { $set: { amount, reason } },
    { new: true, upsert: true }
  );
}

function payloadDateToYMD(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v.trim().slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function addDaysYMD(ymd, daysToAdd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return "";
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(daysToAdd || 0), 0, 0, 0, 0));
  return dt.toISOString().slice(0, 10);
}

/** Cached payload must match the requested From/To (range or classic week). */
function cachedPayloadMatchesRange(payload, sd, ed) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.dateRange && payload.dateRange.startDate && payload.dateRange.endDate) {
    return payload.dateRange.startDate === sd && payload.dateRange.endDate === ed;
  }
  const ws = payloadDateToYMD(payload.weekStart);
  const we = payloadDateToYMD(payload.weekEnd);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ws) && /^\d{4}-\d{2}-\d{2}$/.test(we)) {
    return ws === sd && we === ed;
  }
  // Legacy cache compatibility:
  // older payloads may only have weekStart (no explicit weekEnd/dateRange).
  // Accept those when the requested range is the same 7-day week window.
  if (/^\d{4}-\d{2}-\d{2}$/.test(ws) && ws === sd) {
    const expectedWeekEnd = addDaysYMD(sd, 6);
    if (expectedWeekEnd && expectedWeekEnd === ed) return true;
  }
  return false;
}

async function getOrBuildWeeklyPayoutPayload(locationId, sd, ed) {
  const cached = await WeeklyPayoutCache.findOne({
    locationId,
    weekStart: sd,
  }).lean();
  const payload = cached?.payload;
  if (cached && payload && cachedPayloadMatchesRange(payload, sd, ed)) {
    return payload;
  }

  const rebuilt = await tipsCalculationService.getWeeklyPayout(locationId, sd, {
    startDate: sd,
    endDate: ed,
  });

  await WeeklyPayoutCache.findOneAndUpdate(
    { locationId, weekStart: sd },
    { $set: { payload: rebuilt } },
    { upsert: true, new: true },
  );
  return rebuilt;
}

/**
 * Employees present in saved payout cache for the same scope/dates as the report (for dropdowns).
 * Returns an empty list when no cache exists (no error).
 */
async function listWeeklyPayoutReportEmployees(opts) {
  const { startDate, endDate, geographicScope, singleLocationId } = opts;

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

  let locationIds = [];
  if (geographicScope === 'all_locations') {
    const locs = await Location.find({ isActive: true }).select('_id').sort({ name: 1 }).lean();
    locationIds = locs.map((l) => l._id.toString());
    if (locationIds.length === 0) return { employees: [] };
  } else if (geographicScope === 'one_location') {
    if (!singleLocationId || !mongoose.Types.ObjectId.isValid(String(singleLocationId))) {
      const err = new Error('Location is required for one-location scope');
      err.status = 400;
      throw err;
    }
    const locDoc = await Location.findById(singleLocationId).select('isActive').lean();
    if (!locDoc || locDoc.isActive === false) return { employees: [] };
    locationIds = [String(singleLocationId)];
  } else {
    const err = new Error('Invalid geographicScope');
    err.status = 400;
    throw err;
  }

  const payloadsForExport = [];
  for (const lid of locationIds) {
    const payload = await getOrBuildWeeklyPayoutPayload(lid, sd, ed).catch(
      () => null,
    );
    if (payload && cachedPayloadMatchesRange(payload, sd, ed)) {
      payloadsForExport.push(payload);
    }
  }

  if (payloadsForExport.length === 0) return { employees: [] };

  const seen = new Set();
  const employees = [];
  for (const payload of payloadsForExport) {
    const locName = payload.locationName || '';
    const lid = payload.locationId != null ? String(payload.locationId) : '';
    for (const p of payload.payouts || []) {
      const eid = p.employeeId != null ? String(p.employeeId) : '';
      if (!eid) continue;
      const key = `${lid}|${eid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      employees.push({
        employeeId: eid,
        employeeName: p.employeeName || '—',
        locationId: lid,
        locationName: locName,
      });
    }
  }

  employees.sort((a, b) => {
    const byName = (a.employeeName || '').localeCompare(b.employeeName || '', undefined, {
      sensitivity: 'base',
    });
    if (byName !== 0) return byName;
    return (a.locationName || '').localeCompare(b.locationName || '', undefined, {
      sensitivity: 'base',
    });
  });

  return { employees };
}

/**
 * Build report rows from WeeklyPayoutCache only (no live recompute). User must load payout on Weekly Payout first.
 * @param {object} opts
 * @param {string} opts.startDate - YYYY-MM-DD (cache key; must match Load payout From date)
 * @param {string} opts.endDate - YYYY-MM-DD
 * @param {'one_location'|'all_locations'} opts.geographicScope
 * @param {string} [opts.singleLocationId] - when scope is one_location
 * @param {'all'|'one_employee'} opts.employeeScope
 * @param {string} [opts.employeeName] - substring match when employeeScope is one_employee (if employeeId not set)
 * @param {string} [opts.employeeId] - exact match when employeeScope is one_employee
 */
async function buildWeeklyPayoutReport(opts) {
  const {
    startDate,
    endDate,
    geographicScope,
    singleLocationId,
    employeeScope,
    employeeName,
    employeeId: employeeIdOpt,
  } = opts;

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

  let locationIds = [];
  if (geographicScope === 'all_locations') {
    const locs = await Location.find({ isActive: true }).select('_id').sort({ name: 1 }).lean();
    locationIds = locs.map((l) => l._id.toString());
    if (locationIds.length === 0) {
      const err = new Error('No active locations to include in the report.');
      err.status = 404;
      throw err;
    }
  } else if (geographicScope === 'one_location') {
    if (!singleLocationId || !mongoose.Types.ObjectId.isValid(String(singleLocationId))) {
      const err = new Error('Location is required for one-location report');
      err.status = 400;
      throw err;
    }
    const locDoc = await Location.findById(singleLocationId).select('isActive').lean();
    if (!locDoc) {
      const err = new Error('Location not found');
      err.status = 400;
      throw err;
    }
    if (locDoc.isActive === false) {
      return {
        dateRange: { startDate: sd, endDate: ed },
        payouts: [],
        geographicScope,
        employeeScope,
        exportSkippedReason: 'location_inactive',
      };
    }
    locationIds = [String(singleLocationId)];
  } else {
    const err = new Error('Invalid geographicScope');
    err.status = 400;
    throw err;
  }

  const employeeIdParam = employeeIdOpt != null ? String(employeeIdOpt).trim() : '';
  const employeeIdFilter =
    employeeScope === 'one_employee' &&
    employeeIdParam &&
    mongoose.Types.ObjectId.isValid(employeeIdParam)
      ? employeeIdParam
      : null;

  const nameFilter =
    employeeScope === 'one_employee' && !employeeIdFilter && employeeName && String(employeeName).trim()
      ? String(employeeName).trim().toLowerCase()
      : null;

  if (employeeScope === 'one_employee' && !nameFilter && !employeeIdFilter) {
    const err = new Error('Employee name or employee id is required for single-employee report');
    err.status = 400;
    throw err;
  }

  const payloadsForExport = [];
  for (const lid of locationIds) {
    const payload = await getOrBuildWeeklyPayoutPayload(lid, sd, ed).catch(
      () => null,
    );
    if (payload && cachedPayloadMatchesRange(payload, sd, ed)) {
      payloadsForExport.push(payload);
    }
  }

  if (payloadsForExport.length === 0) {
    const err = new Error(
      geographicScope === 'all_locations'
        ? 'No saved payout in the database for this date range for any active location. Load payout on the Weekly Payout page for the sites you need, then try again.'
        : 'No saved payout in the database for this date range. Open Weekly Payout, pick the same From and To dates, and click Load payout (or Recalculate), then try again.',
    );
    err.status = 404;
    throw err;
  }

  const flat = [];
  for (const payload of payloadsForExport) {
    const locName = payload.locationName || '';
    for (const p of payload.payouts || []) {
      if (employeeIdFilter && String(p.employeeId) !== employeeIdFilter) {
        continue;
      }
      if (nameFilter && !(String(p.employeeName || '').toLowerCase().includes(nameFilter))) {
        continue;
      }
      flat.push({
        ...p,
        locationName: locName,
        locationId: String(payload.locationId ?? lid),
      });
    }
  }

  flat.sort((a, b) => {
    const byLoc = (a.locationName || '').localeCompare(b.locationName || '', undefined, {
      sensitivity: 'base',
    });
    if (byLoc !== 0) return byLoc;
    return (a.employeeName || '').localeCompare(b.employeeName || '', undefined, {
      sensitivity: 'base',
    });
  });

  const dayDateKeys =
    payloadsForExport.length > 0 && Array.isArray(payloadsForExport[0].dayDateKeys)
      ? payloadsForExport[0].dayDateKeys
      : null;

  return {
    dateRange: { startDate: sd, endDate: ed },
    ...(dayDateKeys && dayDateKeys.length > 0 ? { dayDateKeys } : {}),
    payouts: flat,
    geographicScope,
    employeeScope,
  };
}

module.exports = {
  getTardiness,
  upsertTardiness,
  getManualDeductions,
  upsertManualDeduction,
  persistTardinessFromPayload,
  buildWeeklyPayoutReport,
  listWeeklyPayoutReportEmployees,
};
