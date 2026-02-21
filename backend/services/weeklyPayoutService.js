const WeeklyTardiness = require('../models/WeeklyTardiness');
const ManualDeduction = require('../models/ManualDeduction');
const Employee = require('../models/Employee');
const locationService = require('./locationService');
const employeeService = require('./employeeService');
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

module.exports = {
  getTardiness,
  upsertTardiness,
  getManualDeductions,
  upsertManualDeduction,
  persistTardinessFromPayload,
};
