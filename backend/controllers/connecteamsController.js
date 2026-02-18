const mongoose = require('mongoose');
const connecteamsService = require('../services/connecteamsService');
const locationService = require('../services/locationService');
const employeeService = require('../services/employeeService');
const timeEntryService = require('../services/timeEntryService');
const weeklyPayoutService = require('../services/weeklyPayoutService');
const TimeEntry = require('../models/TimeEntry');
const Employee = require('../models/Employee');
const WeeklyTardinessCache = require('../models/WeeklyTardinessCache');
const { LOCATIONS } = require('../utils/constants');

/**
 * GET /connecteams/weekly-tardiness?weekStart=YYYY-MM-DD&locationId=optional&refresh=optional
 * Returns tardiness detail (employee, location/job, scheduled, clock-in, minutes late) and daily totals Mon–Sun + week total.
 * Loads from DB cache when available; use refresh=true to force fetch from Connecteam API and update cache.
 */
async function getWeeklyTardiness(req, res, next) {
  try {
    const { weekStart, locationId, refresh } = req.query;
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
    const weekStartNorm = weekStart.trim();
    const cacheLocationId =
      locationId && String(locationId).trim() && mongoose.Types.ObjectId.isValid(locationId)
        ? new mongoose.Types.ObjectId(locationId)
        : null;

    if (refresh !== 'true' && refresh !== '1') {
      const cached = await WeeklyTardinessCache.findOne({
        weekStart: weekStartNorm,
        locationId: cacheLocationId,
      }).lean();
      if (cached && cached.payload) {
        return res.json({ success: true, data: cached.payload, fromCache: true });
      }
      return res.json({
        success: true,
        data: { entries: [], dailyTotals: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 }, weekTotal: 0 },
        fromCache: false,
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
      weekStartNorm,
      locationKeyFilter
    );

    await WeeklyTardinessCache.findOneAndUpdate(
      { weekStart: weekStartNorm, locationId: cacheLocationId },
      { $set: { payload: data } },
      { upsert: true, new: true }
    );
    await weeklyPayoutService.persistTardinessFromPayload(data, weekStartNorm);

    res.json({ success: true, data, fromCache: false });
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

/**
 * GET /connecteams/clock-in-times?userId=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&locationId=...|locationName=...
 * Returns clock-in (and clock-out) times for a Connecteam user in a date range, optionally filtered by location.
 */
async function getClockInTimes(req, res, next) {
  try {
    const { userId, startDate, endDate, locationId, locationName } = req.query;
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'userId query param is required (Connecteam user id)',
      });
    }
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

    let locationKeyFilter = null;
    const nameToUse = locationName?.trim() || (locationId && (await locationService.getById(locationId))?.name);
    if (nameToUse) {
      const found = LOCATIONS.find(
        (l) => (l.name || '').toLowerCase() === (nameToUse || '').toLowerCase()
      );
      if (found) locationKeyFilter = found.key;
    }

    const rawEntries = await connecteamsService.getTimeEntriesFromConnecteams(
      startDate.trim(),
      endDate.trim()
    );

    const uid = String(userId).trim();
    let entries = rawEntries.filter((e) => String(e.connecteamsUserId) === uid);
    if (locationKeyFilter != null) {
      entries = entries.filter(
        (e) => (e.locationKey || '').toLowerCase() === locationKeyFilter.toLowerCase()
      );
    }

    const response = entries.map((e) => ({
      date: e.date,
      clockIn: e.clockIn,
      clockOut: e.clockOut,
      ...(e.scheduledTime && { scheduledTime: e.scheduledTime }),
      locationKey: e.locationKey,
      employeeName: e.employeeName,
    }));

    res.json({
      success: true,
      data: {
        userId: uid,
        locationName: locationKeyFilter
          ? (LOCATIONS.find((l) => (l.key || '').toLowerCase() === locationKeyFilter.toLowerCase()) || {}).name
          : null,
        startDate: startDate.trim(),
        endDate: endDate.trim(),
        entries: response,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /connecteams/time-entries?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&locationId=...
 * Returns time entries from Connecteam API for the given location and date range.
 * Shape matches GET /time-entries/:locationId/range so the frontend can display them (first clock-in / last clock-out per employee per day).
 */
async function getConnecteamTimeEntries(req, res, next) {
  try {
    const { startDate, endDate, locationId } = req.query;
    if (!startDate || !endDate || !locationId) {
      return res.status(400).json({
        success: false,
        error: 'startDate, endDate, and locationId query params are required',
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
    const loc = await locationService.getById(locationId);
    if (!loc?.name) {
      return res.status(400).json({
        success: false,
        error: 'Location not found',
      });
    }
    const found = LOCATIONS.find(
      (l) => (l.name || '').toLowerCase() === (loc.name || '').toLowerCase()
    );
    const locationKeyFilter = found ? found.key : null;
    if (!locationKeyFilter) {
      return res.status(400).json({
        success: false,
        error: 'Location is not one of the Connecteam locations (Oranjestad, Casa del Mar, The Cove, Drive Thru)',
      });
    }

    const rawEntries = await connecteamsService.getTimeEntriesFromConnecteams(
      startDate.trim(),
      endDate.trim()
    );
    const filtered = rawEntries.filter(
      (e) => (e.locationKey || '').toLowerCase() === locationKeyFilter.toLowerCase()
    );

    // Collapse to first clock-in / last clock-out per (user, date) — same as DB and frontend grouping
    const timeToMinutes = (str) => {
      if (!str || typeof str !== 'string') return NaN;
      const [h, m] = str.trim().split(':').map(Number);
      if (Number.isNaN(h)) return NaN;
      return (h || 0) * 60 + (Number.isNaN(m) ? 0 : m);
    };
    const map = new Map();
    for (const e of filtered) {
      const key = `${e.connecteamsUserId}|${e.date}`;
      const clockInMins = timeToMinutes(e.clockIn);
      const clockOutMins = timeToMinutes(e.clockOut);
      if (!map.has(key)) {
        map.set(key, {
          employeeId: { _id: e.connecteamsUserId, name: e.employeeName },
          date: new Date(e.date + 'T00:00:00.000Z'),
          clockIn: e.clockIn,
          clockOut: e.clockOut,
          _clockInMins: Number.isNaN(clockInMins) ? Infinity : clockInMins,
          _clockOutMins: Number.isNaN(clockOutMins) ? -1 : clockOutMins,
        });
      } else {
        const row = map.get(key);
        if (!Number.isNaN(clockInMins) && clockInMins < row._clockInMins) {
          row.clockIn = e.clockIn;
          row._clockInMins = clockInMins;
        }
        if (!Number.isNaN(clockOutMins) && clockOutMins > row._clockOutMins) {
          row.clockOut = e.clockOut;
          row._clockOutMins = clockOutMins;
        }
      }
    }
    const entries = Array.from(map.values()).map(({ _clockInMins, _clockOutMins, ...r }) => r);

    res.json({
      success: true,
      data: entries,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { syncFromConnecteams, getWeeklyTardiness, getClockInTimes, getConnecteamTimeEntries };
