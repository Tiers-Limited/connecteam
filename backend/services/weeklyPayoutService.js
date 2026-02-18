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

/**
 * Persist weekly tardiness from Connecteam payload into WeeklyTardiness collection
 * so Weekly Payout can read it. Groups by (employee, location), first punch per day, sums minutes.
 * @param {{ entries: Array<{ connecteamsUserId?: string, employeeName?: string, locationKey?: string, date?: string, clockIn?: string, minutesLate?: number }> }} payload
 * @param {string} weekStartStr - YYYY-MM-DD (Monday)
 */
async function persistTardinessFromPayload(payload, weekStartStr) {
  if (!payload || !Array.isArray(payload.entries) || payload.entries.length === 0) return;
  const ws = toWeekStartUTC(weekStartStr);
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
  const totalByEmployeeLocation = new Map();
  for (const [, v] of firstPunchByKey) {
    const key = `${v.connecteamsUserId || v.employeeName}|${v.locationKey}`;
    const existing = totalByEmployeeLocation.get(key);
    if (!existing) {
      totalByEmployeeLocation.set(key, { totalMinutes: v.minutesLate, employeeName: v.employeeName || '' });
    } else {
      existing.totalMinutes += v.minutesLate;
    }
  }
  for (const [empLocKey, { totalMinutes, employeeName: empName }] of totalByEmployeeLocation) {
    const lastPipe = empLocKey.lastIndexOf('|');
    const empIdOrName = lastPipe >= 0 ? empLocKey.slice(0, lastPipe) : empLocKey;
    const locKey = lastPipe >= 0 ? empLocKey.slice(lastPipe + 1) : '';
    const locationId = locationIdByKey[locKey];
    if (!locationId) continue;
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
      try {
        const created = await employeeService.findOrCreateByConnecteams(String(empIdOrName), locationId, empName || empIdOrName);
        employee = created && typeof created.toObject === 'function' ? created.toObject() : created;
      } catch (err) {
        console.warn('[persistTardinessFromPayload] Could not create employee:', empIdOrName, err.message);
        continue;
      }
    }
    if (!employee) continue;
    await WeeklyTardiness.findOneAndUpdate(
      { employeeId: employee._id, locationId, weekStart: ws },
      { $set: { totalTardinessMinutes: totalMinutes } },
      { upsert: true, new: true }
    );
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
