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
 * Get date range as Unix seconds (start of startDate 00:00 UTC, end of endDate 23:59:59 UTC).
 * Using UTC so the scheduler API gets a consistent range for the requested calendar day(s)
 * regardless of server timezone (fixes single-day requests missing schedule → scheduledTime undefined).
 */
function getDateRangeBoundsUnixSeconds(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T23:59:59.999Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
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
    startTime: Math.floor(start.getTime() / 1000),
    endTime: Math.floor(end.getTime() / 1000),
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
  const locationKeys = LOCATIONS.map((l) => l.key);
  /** First user flow: log only for the first user that has shifts (for debugging). */
  const firstUserFlow = { userId: null, userName: null, userFromApi: null, timeActivitiesResponse: null, jobIds: null, jobResponses: [] };
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

  // User IDs that belong to our locations (for time-activities filter)
  const locationFilteredUserIds = Object.keys(userMap).filter((ukey) =>
    userBelongsToLocations(userMap[ukey], locationKeys)
  );

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

  // 4. Time-activities (per time clock): startDate, endDate, userIds -> get shifts with jobId
  const allShiftsWithUser = [];
  for (const tcId of timeClockIds) {
    try {
      const userIdsParam =
        locationFilteredUserIds.length > 0
          ? locationFilteredUserIds.map((id) => `userIds=${encodeURIComponent(id)}`).join('&')
          : '';
      const actPath = `/time-clock/v1/time-clocks/${tcId}/time-activities?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}${userIdsParam ? '&' + userIdsParam : ''}`;
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
        if (shifts.length > 0 && firstUserFlow.userId === null) {
          firstUserFlow.userId = ukey;
          firstUserFlow.userName = userInfo ? userInfo.name : 'User ' + ukey;
          firstUserFlow.userFromApi = userMap[ukey];
          firstUserFlow.timeActivitiesResponse = actRaw;
          firstUserFlow.jobIds = [...new Set(shifts.map((s) => s.jobId).filter(Boolean))];
        }
        for (const shift of shifts) {
          allShiftsWithUser.push({ shift, ukey, userInfo });
        }
      }
    } catch (_) {
      // skip this time clock
    }
  }

  // 5. Get unique jobIds from shifts, then fetch each job -> job.title = location
  const uniqueJobIds = [...new Set(allShiftsWithUser.map(({ shift }) => shift.jobId).filter(Boolean))];
  /** Active LOCATIONS only — used for tips/tardiness attribution. */
  const jobIdToLocationKey = {};
  /** Normalized site from job title for every fetched job (includes inactive sites like Drive Thru). */
  const jobIdToResolvedKey = {};
  const firstUserJobIdSet = firstUserFlow.jobIds ? new Set(firstUserFlow.jobIds) : null;
  for (const jobId of uniqueJobIds) {
    try {
      const jobRes = await connecteamsFetch(`/jobs/v1/jobs/${encodeURIComponent(jobId)}`);
      if (firstUserJobIdSet && firstUserJobIdSet.has(jobId)) {
        firstUserFlow.jobResponses.push({ jobId, response: jobRes });
      }
      const jobData = jobRes.data != null ? jobRes.data : jobRes;
      const job = jobData.job || jobData;
      const title = (job && (job.title || job.name)) ? String(job.title || job.name).trim() : '';
      const locKey = title ? normalizeLocationKey(title) : null;
      jobIdToResolvedKey[jobId] = locKey;
      if (locKey && locationKeys.includes(locKey)) {
        jobIdToLocationKey[jobId] = locKey;
      }
    } catch (_) {
      // job not found or API error
    }
  }

  // 6. Build entries from time-activities shifts; location from job.title
  const entries = [];
  for (const { shift, ukey, userInfo } of allShiftsWithUser) {
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
      toDateString(dateFromTimestampInTimezone(Math.floor(clockInTs / 1000), tz)) || startDate;
    if (!datesInRange.includes(shiftDate)) {
      const uName = userInfo ? userInfo.name : ukey;
      continue;
    }

    const jobId = shift.jobId;
    let locationKey = jobId && jobIdToLocationKey[jobId] ? jobIdToLocationKey[jobId] : null;
    // If the punch has a jobId but the job maps to a site outside active LOCATIONS (e.g. Drive Thru),
    // do not fall back to the employee's other assigned sites — that wrongly attributes hours to Casa del Mar, etc.
    if (!locationKey && jobId != null && Object.prototype.hasOwnProperty.call(jobIdToResolvedKey, jobId)) {
      const resolved = jobIdToResolvedKey[jobId];
      if (resolved != null && resolved !== '' && !locationKeys.includes(resolved)) {
        continue;
      }
    }
    if (!locationKey) {
      const sched = (scheduleMap[ukey] || {})[shiftDate];
      const locationKeysForPunch = getLocationKeysForPunch(userInfo, sched && sched.locationKey, locationKeys);
      if (locationKeysForPunch.length > 0) locationKey = locationKeysForPunch[0];
      else continue;
    }

    const clockOutTs = getClockOutMsFromRecord(shift);
    const clockOutMsUse = clockOutTs != null ? clockOutTs : clockInTs + 8 * 60 * 60 * 1000;
    const sched = (scheduleMap[ukey] || {})[shiftDate];
    const scheduledTimeStr =
      sched && sched.scheduledStartMs != null ? formatTimeInTimezone(sched.scheduledStartMs, tz) : undefined;

    const clockInStr = formatTimeInTimezone(clockInTs, tz);
    entries.push({
      connecteamsUserId: ukey,
      employeeName: userInfo ? userInfo.name : 'User ' + ukey,
      locationKey,
      date: shiftDate,
      clockIn: clockInStr,
      clockOut: formatTimeInTimezone(clockOutMsUse, tz),
      scheduledTime: scheduledTimeStr,
      scheduledStartMs: sched && sched.scheduledStartMs != null ? sched.scheduledStartMs : undefined,
      clockInMs: clockInTs,
      clockOutMs: clockOutMsUse,
      // propagate job identifiers so callers can resolve titles or apply multipliers
      jobId: shift.jobId || null,
      subJobId: shift.subJobId || null,
    });
  }

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

/** Format Date as YYYY-MM-DD in local time (so single-day range matches requested date). */
function toLocalDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDatesInRange(startStr, endStr) {
  const start = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    return [typeof startStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startStr) ? startStr : (toDateString(startStr) || startStr)];
  }
  const dates = [];
  const d = new Date(start);
  while (d <= end) {
    dates.push(toLocalDateString(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

const DAY_KEY_BY_JS_DAY = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };


async function getTardinessFromConnecteamsByDateRange(startDate, endDate, locationKeyFilter = null) {
  const start = (startDate || '').toString().trim().slice(0, 10);
  const end = (endDate || '').toString().trim().slice(0, 10);
  if (!start || !end) throw new Error('startDate and endDate are required (YYYY-MM-DD)');
  const rawEntries = await getTimeEntriesFromConnecteams(start, end);
  return buildTardinessPayload(rawEntries, locationKeyFilter);
}

async function getWeeklyTardinessFromConnecteams(weekStart, locationKeyFilter = null) {
  const startDate = toDateString(weekStart) || weekStart;
  const weekStartDate = new Date(startDate + 'T12:00:00');
  const weekEndDate = getWeekEnd(weekStartDate);
  const endDate = toDateString(weekEndDate);

  const rawEntries = await getTimeEntriesFromConnecteams(startDate, endDate);
  return buildTardinessPayload(rawEntries, locationKeyFilter);
}

function buildTardinessPayload(rawEntries, locationKeyFilter) {
  let filtered = rawEntries;
  if (locationKeyFilter != null && String(locationKeyFilter).trim() !== '') {
    const locLower = String(locationKeyFilter).toLowerCase().trim();
    filtered = rawEntries.filter(
      (e) => (e.locationKey || '').toLowerCase().trim() === locLower
    );
  }

  // Same collapse as Time Entries: one row per (employee, date) = earliest clock-in (first punch) of the day
  const firstPunchByKey = new Map();
  for (const e of filtered) {
    const key = `${e.connecteamsUserId}|${e.date}`;
    const clockInMins = e.clockInMs != null ? Math.floor(e.clockInMs / 60000) : timeToMinutes(e.clockIn);
    const existing = firstPunchByKey.get(key);
    if (existing == null || (clockInMins !== undefined && !Number.isNaN(clockInMins) && clockInMins < (existing._clockInMins ?? Infinity))) {
      firstPunchByKey.set(key, {
        ...e,
        _clockInMins: typeof clockInMins === 'number' && !Number.isNaN(clockInMins) ? clockInMins : (timeToMinutes(e.clockIn) ?? Infinity),
      });
    }
  }

  // Working minutes: same as TimeEntries — group by (employee, location, date), first clock-in / last clock-out per day, then interval = last - first, sum over week. Use timestamps (clockInMs/clockOutMs) when present so duration is correct.
  const dayPunchesByKey = new Map();
  for (const e of filtered) {
    const key = `${String(e.connecteamsUserId || '').trim()}|${(e.locationKey || '').toString().toLowerCase().trim()}|${(e.date || '').slice(0, 10)}`;
    const clockInMs = e.clockInMs != null ? e.clockInMs : null;
    const clockOutMs = e.clockOutMs != null ? e.clockOutMs : null;
    const clockInMins = clockInMs != null ? Math.floor(clockInMs / 60000) : timeToMinutes(e.clockIn);
    const clockOutMins = clockOutMs != null ? Math.floor(clockOutMs / 60000) : timeToMinutes(e.clockOut);
    if (!key || key.endsWith('||')) continue;
    if (!dayPunchesByKey.has(key)) {
      dayPunchesByKey.set(key, {
        clockInMs: clockInMs ?? null,
        clockOutMs: clockOutMs ?? null,
        clockInMins: Number.isNaN(clockInMins) ? Infinity : clockInMins,
        clockOutMins: Number.isNaN(clockOutMins) || clockOutMins <= 0 ? -1 : clockOutMins,
        employeeName: (e.employeeName || '').trim(),
      });
    } else {
      const row = dayPunchesByKey.get(key);
      if (clockInMs != null && (row.clockInMs == null || clockInMs < row.clockInMs)) {
        row.clockInMs = clockInMs;
        row.clockInMins = Math.floor(clockInMs / 60000);
      } else if (row.clockInMs == null && !Number.isNaN(clockInMins) && clockInMins < row.clockInMins) row.clockInMins = clockInMins;
      if (clockOutMs != null && (row.clockOutMs == null || clockOutMs > row.clockOutMs)) {
        row.clockOutMs = clockOutMs;
        row.clockOutMins = Math.floor(clockOutMs / 60000);
      } else if (row.clockOutMs == null && !Number.isNaN(clockOutMins) && clockOutMins > row.clockOutMins) row.clockOutMins = clockOutMins;
    }
  }
  const workingMinutesByEmpLoc = new Map();
  const workingMinutesByEmployee = new Map();
  /** Per-day working minutes: { connecteamsUserId, locationKey, date (YYYY-MM-DD), workingMinutes } for persistence. */
  const dailyWorkingMinutes = [];
  for (const [key, row] of dayPunchesByKey) {
    let durationMins = 0;
    if (row.clockInMs != null && row.clockOutMs != null && row.clockOutMs > row.clockInMs) {
      durationMins = Math.max(0, Math.floor((row.clockOutMs - row.clockInMs) / 60000));
    } else if (row.clockOutMins >= 0 && row.clockInMins < Infinity) {
      durationMins = Math.max(0, row.clockOutMins - row.clockInMins);
    }
    const parts = key.split('|');
    const connecteamsUserId = parts[0] || '';
    const locationKey = parts[1] || '';
    const dateStr = parts[2] || '';
    const empName = row.employeeName || connecteamsUserId;
    if (connecteamsUserId && locationKey) {
      const empLocKey = `${connecteamsUserId}|${locationKey}`;
      workingMinutesByEmpLoc.set(empLocKey, (workingMinutesByEmpLoc.get(empLocKey) || 0) + durationMins);
      if (dateStr) dailyWorkingMinutes.push({ connecteamsUserId, locationKey, date: dateStr, workingMinutes: durationMins });
    }
    if (empName) {
      workingMinutesByEmployee.set(empName, (workingMinutesByEmployee.get(empName) || 0) + durationMins);
    }
  }
  const employeeTotalWorkingMinutes = [];
  const seenEmpLoc = new Set();
  for (const [empLocKey, totalWorkingMinutes] of workingMinutesByEmpLoc) {
    if (seenEmpLoc.has(empLocKey)) continue;
    seenEmpLoc.add(empLocKey);
    const idx = empLocKey.indexOf('|');
    const connecteamsUserId = idx >= 0 ? empLocKey.slice(0, idx) : empLocKey;
    const locationKey = idx >= 0 ? empLocKey.slice(idx + 1) : '';
    const employeeName = filtered.find((e) => String(e.connecteamsUserId) === connecteamsUserId)?.employeeName || connecteamsUserId;
    employeeTotalWorkingMinutes.push({
      connecteamsUserId,
      employeeName,
      locationKey,
      totalWorkingMinutes,
    });
  }
  const totalWorkingMinutesByEmployee = Object.fromEntries(workingMinutesByEmployee);



  const locationNameByKey = Object.fromEntries(LOCATIONS.map((l) => [l.key, l.name]));
  const entries = [];
  const dailyTotals = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };

  for (const e of firstPunchByKey.values()) {
    let minutesLate = 0;
    if (e.scheduledStartMs != null && e.clockInMs != null) {
      minutesLate = Math.max(0, Math.floor((e.clockInMs - e.scheduledStartMs) / 60000));
    } else if (e.scheduledTime && e.clockIn) {
      const scheduledMins = timeToMinutes(e.scheduledTime);
      const clockInMins = timeToMinutes(e.clockIn);
      minutesLate = Math.max(0, (clockInMins || 0) - (scheduledMins || 0));
    }
    const scheduledStr = (e.scheduledTime ?? '').toString().trim();
    const clockInStr = (e.clockIn ?? '').toString().trim();
    if (scheduledStr && clockInStr && scheduledStr === clockInStr) minutesLate = 0;

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

    const d = new Date(e.date + 'T12:00:00');
    const dayKey = DAY_KEY_BY_JS_DAY[d.getDay()];
    if (dayKey) dailyTotals[dayKey] = (dailyTotals[dayKey] || 0) + minutesLate;
  }

  const weekTotal = Object.values(dailyTotals).reduce((sum, n) => sum + n, 0);

  return {
    entries,
    dailyTotals,
    weekTotal,
    employeeTotalWorkingMinutes,
    totalWorkingMinutesByEmployee,
    dailyWorkingMinutes,
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

/**
 * Fetch job information from Connecteam API by jobId or subJobId
 * @param {string} jobId - The job ID
 * @returns {Promise<{jobId: string, title: string, code: string, description: string}|null>}
 */
// simple in‑memory cache for job titles so repeated lookups (e.g. many
// employees with the same subJobId) don't hammer the Connecteam API.
const jobInfoCache = new Map();

async function getJobInfo(jobId) {
  if (!jobId) return null;
  if (jobInfoCache.has(jobId)) return jobInfoCache.get(jobId);

  try {
    const jobRes = await connecteamsFetch(`/jobs/v1/jobs/${encodeURIComponent(jobId)}`);
    if (jobRes && jobRes.data && jobRes.data.job) {
      const job = jobRes.data.job;
      const result = {
        jobId: job.jobId || jobId,
        title: job.title || null,
        code: job.code || null,
        description: job.description || null,
      };
      jobInfoCache.set(jobId, result);
      return result;
    }
    return null;
  } catch (err) {
    console.warn(`[getJobInfo] Failed to fetch job ${jobId}:`, err.message);
    return null;
  }
}

module.exports = {
  connecteamsFetch,
  getTimeEntriesFromConnecteams,
  getWeeklyTardinessFromConnecteams,
  getTardinessFromConnecteamsByDateRange,
  getActiveUsersCount,
  getJobInfo,
  LOCATIONS: LOCATIONS,
};
