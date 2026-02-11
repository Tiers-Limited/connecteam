const connecteamsService = require('../services/connecteamsService');
const locationService = require('../services/locationService');
const employeeService = require('../services/employeeService');
const timeEntryService = require('../services/timeEntryService');
const TimeEntry = require('../models/TimeEntry');
const Employee = require('../models/Employee');
const { LOCATIONS } = require('../utils/constants');

/**
 * GET /connecteams/weekly-tardiness?weekStart=YYYY-MM-DD&locationId=optional
 * Returns tardiness detail (employee, location/job, scheduled, clock-in, minutes late) and daily totals Mon–Sun + week total.
 */
async function getWeeklyTardiness(req, res, next) {
  try {
    const { weekStart, locationId } = req.query;
    if (!weekStart || typeof weekStart !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'weekStart query param is required (YYYY-MM-DD, Monday)',
      });
    }
    const start = new Date(weekStart + 'T12:00:00');
    if (isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid weekStart date',
      });
    }
    let locationKeyFilter = null;
    if (locationId) {
      const loc = await locationService.getById(locationId);
      if (loc?.name) {
        const found = LOCATIONS.find(
          (l) => (l.name || '').toLowerCase() === (loc.name || '').toLowerCase()
        );
        if (found) locationKeyFilter = found.key;
      }
    }
    const data = await connecteamsService.getWeeklyTardinessFromConnecteams(
      weekStart.trim(),
      locationKeyFilter
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * Sync time entries from Connecteams API into TimeEntry collection.
 * Uses the 4 fixed locations: Oranjestad, Casa del Mar, The Cove, Drive Thru.
 * Replaces existing Connecteams-synced entries in the date range (employees with connecteamsUserId).
 */
async function syncFromConnecteams(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate query params are required (YYYY-MM-DD)',
      });
    }
    const start = new Date(startDate + 'T12:00:00');
    const end = new Date(endDate + 'T12:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date range',
      });
    }

    const rawEntries = await connecteamsService.getTimeEntriesFromConnecteams(startDate, endDate);

    // Step 2.1 Deduplication: same employee + same date + same clock-in + same clock-out → keep only one
    const seenKey = new Set();
    const entries = [];
    for (const e of rawEntries) {
      const key = `${e.connecteamsUserId}|${e.locationKey}|${e.date}|${e.clockIn}|${e.clockOut}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      entries.push(e);
    }

    const locationIdByKey = {};
    for (const { key, name } of LOCATIONS) {
      const loc = await locationService.getByName(name);
      if (loc) locationIdByKey[key] = loc._id;
    }

    const syncedEmployeeIds = await Employee.distinct('_id', { connecteamsUserId: { $exists: true, $ne: '' } });
    const dateStart = new Date(startDate + 'T00:00:00.000Z');
    const dateEnd = new Date(endDate + 'T23:59:59.999Z');
    await TimeEntry.deleteMany({
      employeeId: { $in: syncedEmployeeIds },
      date: { $gte: dateStart, $lte: dateEnd },
    });

    let created = 0;
    for (const e of entries) {
      const locationId = locationIdByKey[e.locationKey];
      if (!locationId) continue;
      const employee = await employeeService.findOrCreateByConnecteams(
        e.connecteamsUserId,
        locationId,
        e.employeeName
      );
      const dateObj = new Date(e.date + 'T00:00:00.000Z');
      await timeEntryService.create({
        employeeId: employee._id,
        locationId,
        date: dateObj,
        clockIn: e.clockIn,
        clockOut: e.clockOut,
        ...(e.scheduledTime && { scheduledTime: e.scheduledTime }),
      });
      created++;
    }

    res.json({
      success: true,
      data: {
        synced: created,
        startDate,
        endDate,
      },
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (msg.includes('Unexpected token') || msg.includes('not valid JSON') || msg.includes('JSON')) {
      return res.status(502).json({
        success: false,
        error: 'Connecteams API returned an invalid response. Check CONNECTEAMS_API_KEY in .env and try again.',
      });
    }
    next(err);
  }
}

module.exports = { syncFromConnecteams, getWeeklyTardiness };
