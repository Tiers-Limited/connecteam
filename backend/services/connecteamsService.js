const https = require('https');
const { connecteamsApiKey, connecteamsBase } = require('../config/env');
const { LOCATIONS } = require('../utils/constants');
const { toDateString, getWeekEnd, timeToMinutes } = require('../utils/dateUtils');

const DEFAULT_TIMEZONE = 'America/Aruba';

/** Cache and in-flight dedupe for getTimeEntriesFromConnecteams to avoid repeated API hits for same range. */
const CONNECTEAM_ENTRIES_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const connecteamEntriesCache = new Map();
const connecteamEntriesInFlight = new Map();

let connecteamCallCount = 0;

/**
 * Fetch JSON from Connecteams API (GET).
 * @param {string} path - e.g. /users/v1/users?limit=100&offset=0
 * @returns {Promise<object>}
 */
function connecteamsFetch(path) {
  const url = new URL(path.startsWith('http') ? path : path, connecteamsBase);
  connecteamCallCount += 1;
  const shortPath = url.pathname + url.search;
  console.log(`  ${String(connecteamCallCount).padStart(2)}. GET ${shortPath}`);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-KEY': connecteamsApiKey,
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = (body || '').trim().slice(0, 150) || `HTTP ${res.statusCode}`;
          return reject(new Error(`Connecteams API error (${res.statusCode}): ${msg}`));
        }
        // Strip BOM and normalize empty/null responses — never throw on parse
        let trimmed = (body || '').trim().replace(/^\uFEFF/, '');
        if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
          return resolve({});
        }
        try {
          const parsed = JSON.parse(trimmed);
          resolve(parsed != null && typeof parsed === 'object' ? parsed : {});
        } catch (e) {
          // Never propagate parse errors; return empty object so callers get []
          resolve({});
        }
      });
    });
    req.on('error', (err) => reject(new Error('Connecteams request failed: ' + (err.message || String(err)))));
    req.end();
  });
}

function getCustomFieldValues(user, fieldName) {
  const trim = (s) => (s || '').trim();
  const fields = user.customFields || [];
  const cf = fields.find((f) => trim(f.name) === trim(fieldName));
  if (!cf || cf.value == null) return [];
  const v = cf.value;
  const one = (x) =>
    x != null && typeof x === 'object' && ('value' in x || 'label' in x)
      ? (x.value ?? x.label)
      : x;
  if (Array.isArray(v)) return v.map((x) => one(x)).filter(Boolean);
  return [one(v)];
}

function userBelongsToLocations(userInfo, locationKeys) {
  if (!userInfo) return false;
  if (!locationKeys.length) return true;
  const locs = (userInfo.locationValues || []).map((s) => (s || '').toLowerCase().trim());
  const jobs = (userInfo.locationJobValues || []).map((s) => (s || '').toLowerCase().trim());
  const keys = locationKeys.map((k) => k.toLowerCase().trim());
  for (const k of keys) {
    if (locs.some((l) => l === k || l.includes(k))) return true;
    if (jobs.some((j) => j.includes(k) || j.includes(k.replace(/\s/g, '-')))) return true;
  }
  return false;
}

function normalizeLocationKey(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.toLowerCase().trim();
  for (const { key } of LOCATIONS) {
    if (s === key || s.includes(key) || key.includes(s)) return key;
  }
  if (s.includes('oranjestad')) return 'oranjestad';
  if (s.includes('casa') && s.includes('mar')) return 'casa del mar';
  if (s.includes('cove')) return 'the cove';
  if (s.includes('drive') && s.includes('thru')) return 'drive thru';
  return null;
}

/**
 * Get all location keys for a punch: from shift (single) or from user's Location / Location - Job (can be multiple).
 * So an employee assigned to "Casa Del Mar", "Oranjestad", "The Cove" gets one entry per location when there's no shift.
 */
function getLocationKeysForPunch(userInfo, schedLocationKey, locationKeys) {
  if (schedLocationKey && locationKeys.includes(schedLocationKey)) {
    return [schedLocationKey];
  }
  const collected = new Set();
  const locJob = (userInfo && (userInfo.locationJobValues || userInfo.locationValues)) || [];
  const locOnly = (userInfo && userInfo.locationValues) || [];
  for (const v of [...locJob, ...locOnly]) {
    const k = normalizeLocationKey(String(v));
    if (k && locationKeys.includes(k)) collected.add(k);
  }
  if (collected.size > 0) return Array.from(collected);
  return [locationKeys[0]];
}

function dateFromTimestamp(tsSeconds) {
  if (tsSeconds == null) return '';
  const d = new Date(tsSeconds * 1000);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function formatTimeInTimezone(tsMs, timezone) {
  if (tsMs == null || isNaN(tsMs)) return '—';
  const tz = (timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  try {
    const s = new Date(tsMs).toLocaleTimeString('en-CA', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return s && s.length >= 5 ? s.slice(0, 5) : '—';
  } catch (_) {
    const d = new Date(tsMs);
    return (
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    );
  }
}

function getClockInMsFromRecord(rec) {
  const start = rec.start || rec.clockIn || rec.clockInTime || rec.startTime;
  if (!start) return null;
  const ts = start.timestamp ?? start.time ?? (typeof start === 'number' ? start : null);
  if (ts == null) return null;
  return ts < 1e12 ? ts * 1000 : ts;
}

function getClockOutMsFromRecord(rec) {
  const end = rec.end || rec.clockOut || rec.clockOutTime || rec.endTime;
  if (!end) return null;
  const ts = end.timestamp ?? end.time ?? (typeof end === 'number' ? end : null);
  if (ts == null) return null;
  return ts < 1e12 ? ts * 1000 : ts;
}

function dateFromTimestampInTimezone(tsSeconds, timezone) {
  if (tsSeconds == null) return '';
  const tz = (timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  try {
    const d = new Date(tsSeconds * 1000);
    const s = d.toLocaleDateString('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    if (!s) return '';
    const parts = s.split(/[/-]/);
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return y + '-' + m + '-' + day;
  } catch (_) {
    return dateFromTimestamp(tsSeconds);
  }
}

/**
 * Get date range as Unix seconds (start of startDate 00:00, end of endDate 23:59) in local interpretation.
 */
function getDateRangeBoundsUnixSeconds(startStr, endStr) {
  const startMs = new Date(startStr + 'T00:00:00').getTime();
  const endMs = new Date(endStr + 'T23:59:59').getTime();
  if (isNaN(startMs) || isNaN(endMs)) {
    const s = new Date(startStr + 'T12:00:00Z');
    const e = new Date(endStr + 'T12:00:00Z');
    s.setUTCHours(0, 0, 0, 0);
    e.setUTCHours(23, 59, 59, 999);
    return {
      startTime: Math.floor(s.getTime() / 1000),
      endTime: Math.floor(e.getTime() / 1000),
    };
  }
  return {
    startTime: Math.floor(startMs / 1000),
    endTime: Math.floor(endMs / 1000),
  };
}

/**
 * Fetch time entries from Connecteams API for the given date range (uncached).
 * Returns array of { connecteamsUserId, employeeName, locationKey, date, clockIn, clockOut }.
 */
async function getTimeEntriesFromConnecteamsUncached(startDate, endDate) {
  if (!connecteamsApiKey) {
    throw new Error('CONNECTEAMS_API_KEY is not set');
  }

  connecteamCallCount = 0;
  console.log('\n' + '═'.repeat(60));
  console.log('Connecteam API — getTimeEntriesFromConnecteams');
  console.log('  Date range: ' + startDate + ' → ' + endDate);
  console.log('  Base URL:   ' + connecteamsBase);
  console.log('═'.repeat(60));
  console.log('Calls:');

  const locationKeys = LOCATIONS.map((l) => l.key);
  const datesInRange = getDatesInRange(startDate, endDate);
  const dayBounds = getDateRangeBoundsUnixSeconds(startDate, endDate);

  // 1. Users
  const userMap = {};
  let offset = 0;
  const limit = 100;
  let hasMore = true;
  while (hasMore) {
    const path = `/users/v1/users?limit=${limit}&offset=${offset}&order=asc&userStatus=active`;
    const usersData = await connecteamsFetch(path);
    const uRaw = usersData.data != null ? usersData.data : usersData;
    const userList = Array.isArray(uRaw) ? uRaw : (uRaw.users || uRaw.items || []);
    for (const u of userList) {
      const id = u.userId ?? u.id;
      if (id == null) continue;
      const key = String(id);
      const name =
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
        u.name ||
        u.fullName ||
        'User ' + id;
      const locationJobValues = getCustomFieldValues(u, 'Location - Job').length
        ? getCustomFieldValues(u, 'Location - Job')
        : getCustomFieldValues(u, 'Location/Job');
      const locationValues = getCustomFieldValues(u, 'Location');
      const locationJob = locationJobValues.length
        ? locationJobValues
        : locationValues;
      userMap[key] = {
        name,
        locationValues,
        locationJobValues: locationJobValues.length ? locationJobValues : locationValues,
      };
    }
    hasMore = userList.length >= limit;
    offset += limit;
  }

  // 2. Time clocks
  const timeClocksRes = await connecteamsFetch('/time-clock/v1/time-clocks');
  const tcRaw = timeClocksRes.data != null ? timeClocksRes.data : timeClocksRes;
  const timeClocksList = Array.isArray(tcRaw) ? tcRaw : (tcRaw.timeClocks || tcRaw.items || []);
  const timeClockIds = timeClocksList
    .slice(0, 25)
    .map((c) => (c.id != null ? c.id : c.timeClockId))
    .filter(Boolean);

  // 3. Schedulers + Shifts -> scheduleMap[userId][date] = { locationKey, timezone }
  const scheduleMap = {};
  let totalShiftsLoaded = 0;
  try {
    const schedRes = await connecteamsFetch('/scheduler/v1/schedulers');
    const sRaw = schedRes.data != null ? schedRes.data : schedRes;
    const schedList = Array.isArray(sRaw)
      ? sRaw
      : (sRaw.schedulers || schedRes.schedulers || sRaw.items || []);
    const activeSchedulers = (schedList || []).filter((s) => s.isArchived === false);
    const schedIds = activeSchedulers.length
      ? activeSchedulers.map((s) => s.id ?? s.schedulerId).filter(Boolean)
      : (schedList || []).map((s) => s.id ?? s.schedulerId).filter(Boolean);
    // Try both: Connecteam doc says "Unix format (in seconds)" but some APIs use milliseconds
    const timeParamSets = [
      { start: dayBounds.startTime * 1000, end: dayBounds.endTime * 1000, label: 'ms' },
      { start: dayBounds.startTime, end: dayBounds.endTime, label: 'sec' },
    ];
    for (const timeParams of timeParamSets) {
      if (totalShiftsLoaded > 0) break;
      for (const schedId of schedIds.slice(0, 10)) {
        try {
          let shOffset = 0;
          const shLimit = 100;
          let shHasMore = true;
          while (shHasMore) {
            const shiftsPath = `/scheduler/v1/schedulers/${schedId}/shifts?startTime=${timeParams.start}&endTime=${timeParams.end}&limit=${shLimit}&offset=${shOffset}`;
            const shData = await connecteamsFetch(shiftsPath);
            const shRaw = shData.data != null ? shData.data : shData;
            const shiftList = Array.isArray(shRaw) ? shRaw : (shRaw.shifts || shRaw.items || []);
            totalShiftsLoaded += shiftList.length;
          for (const sh of shiftList) {
            const st = sh.start ?? sh.startTime ?? sh.scheduledStart ?? sh.startTimestamp;
            let stMs =
              st != null
                ? typeof st === 'number'
                  ? st < 1e12
                    ? st * 1000
                    : st
                  : new Date(st).getTime()
                : null;
            if (stMs != null && typeof st === 'object' && st !== null && st.timestamp != null)
              stMs = st.timestamp * 1000;
            if (stMs == null || isNaN(stMs)) continue;
            const tz = sh.timezone || DEFAULT_TIMEZONE;
            const shiftDate =
              dateFromTimestampInTimezone(Math.floor(stMs / 1000), tz) ||
              dateFromTimestamp(Math.floor(stMs / 1000));
            const locationStr =
              (sh.locationData && (sh.locationData.gps || {}).address)
                ? sh.locationData.gps.address
                : (sh.locationData && sh.locationData.address)
                  ? sh.locationData.address
                  : (sh.locationData && sh.locationData.name)
                    ? sh.locationData.name
                    : typeof sh.location === 'string'
                      ? sh.location
                      : (sh.locationName || sh.address || (sh.location && sh.location.name) || (sh.location && sh.location.address) || '—');
            const locKey = normalizeLocationKey(locationStr);
            const userIds = sh.assignedUserIds || sh.userIds || (sh.assignedUserId != null ? [sh.assignedUserId] : []);
            for (const uid of userIds) {
              if (uid == null) continue;
              const ukey = String(uid);
              if (!scheduleMap[ukey]) scheduleMap[ukey] = {};
              const sd = (typeof shiftDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) ? shiftDate : (toDateString(shiftDate) || shiftDate);
              const existing = scheduleMap[ukey][sd];
              if (!existing || stMs < (existing.scheduledStartMs || 0)) {
                scheduleMap[ukey][sd] = {
                  scheduledStartMs: stMs,
                  locationKey: locKey,
                  timezone: tz,
                };
              }
            }
          }
          shHasMore = shiftList.length >= shLimit;
          shOffset += shiftList.length;
          }
        } catch (_) {
          // skip scheduler
        }
      }
    }
  } catch (err) {
  }
  const scheduleMapSize = Object.keys(scheduleMap).reduce(
    (sum, ukey) => sum + Object.keys(scheduleMap[ukey] || {}).length,
    0
  );
  const scheduleMapSample = Object.entries(scheduleMap)
    .slice(0, 3)
    .map(([ukey, dates]) => ({ userId: ukey, dates: Object.keys(dates).slice(0, 5) }));

  // 4. Timesheet + Time-activities -> build list of (userId, date, clockIn, clockOut, locationKey)
  const entries = [];
  const assignedUserIdsByClock = {};
  let timesheetFlatRecordsTotal = 0;
  let timesheetSchedMatchCount = 0;
  let timesheetSchedMissCount = 0;
  timeClocksList.forEach((tc) => {
    const tid = tc.id ?? tc.timeClockId;
    if (tid == null) return;
    const uids =
      tc.assignedUserIds || tc.userIds || (tc.assignedUserId != null ? [tc.assignedUserId] : []);
    assignedUserIdsByClock[tid] = uids;
  });

  for (const tcId of timeClockIds) {
    try {
      const tsPath = `/time-clock/v1/time-clocks/${tcId}/timesheet?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
      const tsData = await connecteamsFetch(tsPath);
      const tsRaw = tsData.data != null ? tsData.data : tsData;
      const flatRecords = [];
      const usersList = tsRaw.users || [];
      for (const userEntry of usersList) {
        const uid = userEntry.userId ?? userEntry.user_id;
        if (uid == null) continue;
        const dailyRecords = userEntry.dailyRecords || userEntry.days || [];
        for (const day of dailyRecords) {
          const recordDateNorm = toDateString(day.date) || startDate;
          if (!datesInRange.includes(recordDateNorm)) continue;
          const records = day.records || day.punches || day.activities || [];
          for (const rec of records) {
            flatRecords.push({ ...rec, _date: recordDateNorm, _userId: uid });
          }
        }
      }
      if (flatRecords.length === 0) {
        const dailyRecords =
          tsRaw.dailyRecords ||
          tsRaw.days ||
          (Array.isArray(tsRaw) ? tsRaw : (tsRaw.records || []));
        for (const day of dailyRecords) {
          const recordDateNorm =
            toDateString(day.date) ||
            (day.records &&
              day.records[0] &&
              day.records[0].start &&
              dateFromTimestamp(day.records[0].start.timestamp)) ||
            startDate;
          if (!datesInRange.includes(recordDateNorm)) continue;
          const records = day.records || day.punches || day.activities || [];
          for (const rec of records) {
            flatRecords.push({ ...rec, _date: recordDateNorm });
          }
        }
      }
      timesheetFlatRecordsTotal += flatRecords.length;
      for (const rec of flatRecords) {
        const clockInMs = getClockInMsFromRecord(rec);
        const clockOutMs = getClockOutMsFromRecord(rec);
        if (clockInMs == null) continue;
        const recordDate = rec._date || startDate;
        const uid =
          rec._userId ??
          rec.userId ??
          rec.user_id ??
          (assignedUserIdsByClock[tcId] && assignedUserIdsByClock[tcId].length === 1
            ? assignedUserIdsByClock[tcId][0]
            : null);
        if (uid == null) continue;
        const ukey = String(uid);
        const userInfo = userMap[ukey];
        if (!userBelongsToLocations(userInfo, locationKeys)) continue;
        const sched = (scheduleMap[ukey] || {})[recordDate];
        if (sched) timesheetSchedMatchCount++;
        else timesheetSchedMissCount++;
        const tz = (sched && sched.timezone) ? sched.timezone : DEFAULT_TIMEZONE;
        const locationKeysForPunch = getLocationKeysForPunch(userInfo, sched && sched.locationKey, locationKeys);
        const clockOutMsUse = clockOutMs != null ? clockOutMs : clockInMs + 8 * 60 * 60 * 1000;
        const clockInStr = formatTimeInTimezone(clockInMs, tz);
        const clockOutStr = formatTimeInTimezone(clockOutMsUse, tz);
        if (clockInStr === '—') continue;
        const scheduledTimeStr = (sched && sched.scheduledStartMs != null) ? formatTimeInTimezone(sched.scheduledStartMs, tz) : '—';
        for (const locationKey of locationKeysForPunch) {
          entries.push({
            connecteamsUserId: ukey,
            employeeName: userInfo ? userInfo.name : 'User ' + ukey,
            locationKey,
            date: recordDate,
            clockIn: clockInStr,
            clockOut: clockOutStr,
            scheduledTime: scheduledTimeStr !== '—' ? scheduledTimeStr : undefined,
            scheduledStartMs: sched && sched.scheduledStartMs != null ? sched.scheduledStartMs : undefined,
            clockInMs,
          });
        }
      }
    } catch (err) {
    }
  }

  // 5. Time-activities (fallback for punch pairs)
  const entriesBeforeTimeActivities = entries.length;
  for (const tcId of timeClockIds) {
    try {
      const actPath = `/time-clock/v1/time-clocks/${tcId}/time-activities?startDate=${startDate}&endDate=${endDate}`;
      const actData = await connecteamsFetch(actPath);
      const actRaw = actData.data != null ? actData.data : actData;
      const byUsers =
        actRaw.timeActivitiesByUsers ||
        actRaw.timeActivities ||
        actRaw.users ||
        actRaw.items ||
        (Array.isArray(actRaw) ? actRaw : []);
      for (const userObj of byUsers) {
        const userId = userObj.userId ?? userObj.user_id ?? userObj.id;
        if (userId == null) continue;
        const ukey = String(userId);
        const userInfo = userMap[ukey];
        if (!userBelongsToLocations(userInfo, locationKeys)) continue;
        const shifts =
          userObj.shifts || userObj.activities || userObj.records || userObj.timeActivities || [];
        for (const shift of shifts) {
          const clockInTs =
            getClockInMsFromRecord(shift) ??
            (shift.clockInTimestamp != null
              ? shift.clockInTimestamp < 1e12
                ? shift.clockInTimestamp * 1000
                : shift.clockInTimestamp
              : null);
          if (clockInTs == null) continue;
          const start = shift.start || {};
          const tz = (start.timezone || shift.timezone) || DEFAULT_TIMEZONE;
          const shiftDate =
            toDateString(dateFromTimestampInTimezone(Math.floor(clockInTs / 1000), tz)) ||
            startDate;
          if (!datesInRange.includes(shiftDate)) continue;
          const clockOutTs = getClockOutMsFromRecord(shift);
          const clockOutMsUse =
            clockOutTs != null ? clockOutTs : clockInTs + 8 * 60 * 60 * 1000;
          const sched = (scheduleMap[ukey] || {})[shiftDate];
          const locationKeysForPunch = getLocationKeysForPunch(userInfo, sched && sched.locationKey, locationKeys);
          const scheduledTimeStr = (sched && sched.scheduledStartMs != null) ? formatTimeInTimezone(sched.scheduledStartMs, tz) : undefined;
          for (const locationKey of locationKeysForPunch) {
            entries.push({
              connecteamsUserId: ukey,
              employeeName: userInfo ? userInfo.name : 'User ' + ukey,
              locationKey,
              date: shiftDate,
              clockIn: formatTimeInTimezone(clockInTs, tz),
              clockOut: formatTimeInTimezone(clockOutMsUse, tz),
              scheduledTime: scheduledTimeStr,
              scheduledStartMs: sched && sched.scheduledStartMs != null ? sched.scheduledStartMs : undefined,
              clockInMs: clockInTs,
            });
          }
        }
      }
    } catch (_) {
      // skip
    }
  }
  const withScheduled = entries.filter((e) => e.scheduledTime || e.scheduledStartMs != null);
  const byLocationKey = {};
  for (const e of entries) {
    const k = e.locationKey || 'unknown';
    byLocationKey[k] = (byLocationKey[k] || 0) + 1;
  }

  console.log('\n' + '─'.repeat(60));
  console.log('Connecteam getTimeEntriesFromConnecteams — RESULT');
  console.log('─'.repeat(60));
  console.log('  Total entries:', entries.length);
  console.log('  By location:  ', JSON.stringify(byLocationKey));
  console.log('  From time-activities (fallback):', entries.length - entriesBeforeTimeActivities);
  console.log('  With scheduled time:            ', withScheduled.length);
  console.log('  Sample dates:', entries.slice(0, 5).map((e) => e.date).join(', '));
  console.log('─'.repeat(60) + '\n');

  return entries;
}

/**
 * Fetch time entries from Connecteams API for the given date range.
 * Results are cached for 2 minutes and in-flight requests for the same range are deduplicated.
 */
async function getTimeEntriesFromConnecteams(startDate, endDate) {
  const start = (startDate || '').toString().trim();
  const end = (endDate || '').toString().trim();
  const key = `${start}_${end}`;

  const cached = connecteamEntriesCache.get(key);
  if (cached && Date.now() - cached.ts < CONNECTEAM_ENTRIES_CACHE_TTL_MS) {
    return cached.data;
  }

  let promise = connecteamEntriesInFlight.get(key);
  if (promise) {
    return promise;
  }

  promise = getTimeEntriesFromConnecteamsUncached(start, end)
    .then((data) => {
      connecteamEntriesCache.set(key, { data, ts: Date.now() });
      return data;
    })
    .finally(() => {
      connecteamEntriesInFlight.delete(key);
    });

  connecteamEntriesInFlight.set(key, promise);
  return promise;
}

function getDatesInRange(startStr, endStr) {
  const start = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    return [toDateString(startStr) || startStr];
  }
  const dates = [];
  const d = new Date(start);
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** getDay(): 0=Sun, 1=Mon, ... 6=Sat */
const DAY_KEY_BY_JS_DAY = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };

/**
 * Get weekly tardiness from Connecteams: detail rows (employee, location/job, scheduled, clock-in, minutes late)
 * and daily totals Mon–Sun plus week total.
 * @param {string} weekStart - Monday date YYYY-MM-DD
 * @param {string|null} locationKeyFilter - optional location key to filter (e.g. 'oranjestad')
 * @returns {Promise<{ entries: Array<{ employeeName, locationName, locationKey, date, scheduledTime, clockIn, minutesLate }>, dailyTotals: Record<string, number>, weekTotal: number }>}
 */
async function getWeeklyTardinessFromConnecteams(weekStart, locationKeyFilter = null) {
  const startDate = toDateString(weekStart) || weekStart;
  const weekStartDate = new Date(startDate + 'T12:00:00');
  const weekEndDate = getWeekEnd(weekStartDate);
  const endDate = toDateString(weekEndDate);

  const rawEntries = await getTimeEntriesFromConnecteams(startDate, endDate);

  const withScheduled = rawEntries.filter((e) => e.scheduledTime || e.scheduledStartMs != null);
  const withBoth = rawEntries.filter(
    (e) => (e.scheduledStartMs != null && e.clockInMs != null) || (e.scheduledTime && e.clockIn)
  );

  const locationNameByKey = Object.fromEntries(LOCATIONS.map((l) => [l.key, l.name]));

  const entries = [];
  const dailyTotals = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
  /** First punch per (employee, date) only — for correct daily totals (match UI: one tardiness per employee per day) */
  const firstPunchMinutesByKey = new Map();

  let skippedLocation = 0;
  let skippedNoLate = 0;
  for (const e of rawEntries) {
    if (locationKeyFilter != null && e.locationKey !== locationKeyFilter) {
      skippedLocation++;
      continue;
    }
    let minutesLate = 0;
    if (e.scheduledStartMs != null && e.clockInMs != null) {
      // Use floor so 0–59 seconds late = 0 min (07:00 → 07:00 shows 0, not 1)
      minutesLate = Math.max(0, Math.floor((e.clockInMs - e.scheduledStartMs) / 60000));
    } else if (e.scheduledTime && e.clockIn) {
      const scheduledMins = timeToMinutes(e.scheduledTime);
      const clockInMins = timeToMinutes(e.clockIn);
      minutesLate = Math.max(0, clockInMins - scheduledMins);
    }
    // Same time (e.g. 07:00 → 07:00) = 0 min for entries and for daily/week totals
    const scheduledStr = (e.scheduledTime ?? '').toString().trim();
    const clockInStr = (e.clockIn ?? '').toString().trim();
    if (scheduledStr && clockInStr && scheduledStr === clockInStr) minutesLate = 0;
    if (minutesLate === 0) skippedNoLate++;

    const clockInMins = (e.clockIn && timeToMinutes(e.clockIn)) ?? Infinity;
    const key = `${e.employeeName}|${e.date}`;
    const existing = firstPunchMinutesByKey.get(key);
    if (existing == null || clockInMins < existing.clockInMins) {
      firstPunchMinutesByKey.set(key, { minutesLate, clockInMins, date: e.date });
    }

    // Include all entries with scheduled + clock-in (including on-time/early) so the UI can show first punch and 0 min late
    const locationName = locationNameByKey[e.locationKey] || e.locationKey || '—';
    entries.push({
      connecteamsUserId: e.connecteamsUserId,
      employeeName: e.employeeName,
      locationName,
      locationKey: e.locationKey,
      date: e.date,
      scheduledTime: e.scheduledTime,
      clockIn: e.clockIn,
      minutesLate,
    });
  }

  for (const { minutesLate, date } of firstPunchMinutesByKey.values()) {
    const d = new Date(date + 'T12:00:00');
    const dayKey = DAY_KEY_BY_JS_DAY[d.getDay()];
    if (dayKey) dailyTotals[dayKey] = (dailyTotals[dayKey] || 0) + minutesLate;
  }

  const weekTotal = Object.values(dailyTotals).reduce((sum, n) => sum + n, 0);

  return {
    entries,
    dailyTotals,
    weekTotal,
  };
}

/**
 * Get count of active users from Connecteam API (paginates until no more).
 * @returns {Promise<number>}
 */
async function getActiveUsersCount() {
  if (!connecteamsApiKey) return 0;
  let count = 0;
  let offset = 0;
  const limit = 100;
  let hasMore = true;
  while (hasMore) {
    const path = `/users/v1/users?limit=${limit}&offset=${offset}&order=asc&userStatus=active`;
    const usersData = await connecteamsFetch(path);
    const uRaw = usersData.data != null ? usersData.data : usersData;
    const userList = Array.isArray(uRaw) ? uRaw : (uRaw.users || uRaw.items || []);
    count += userList.length;
    hasMore = userList.length >= limit;
    offset += limit;
  }
  return count;
}

module.exports = {
  connecteamsFetch,
  getTimeEntriesFromConnecteams,
  getWeeklyTardinessFromConnecteams,
  getActiveUsersCount,
  LOCATIONS: LOCATIONS,
};
