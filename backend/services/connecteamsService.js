const https = require('https');
const { connecteamsApiKey, connecteamsBase } = require('../config/env');
const { LOCATIONS } = require('../utils/constants');
const { toDateString } = require('../utils/dateUtils');

const DEFAULT_TIMEZONE = 'America/Aruba';

/**
 * Fetch JSON from Connecteams API (GET).
 * @param {string} path - e.g. /users/v1/users?limit=100&offset=0
 * @returns {Promise<object>}
 */
function connecteamsFetch(path) {
  const url = new URL(path.startsWith('http') ? path : path, connecteamsBase);
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
 * Fetch time entries from Connecteams API for the given date range.
 * Returns array of { connecteamsUserId, employeeName, locationKey, date, clockIn, clockOut }.
 * Multiple entries per (user, location, date) when there are multiple punch pairs.
 * Only includes the 4 fixed locations: Oranjestad, Casa del Mar, The Cove, Drive Thru.
 */
async function getTimeEntriesFromConnecteams(startDate, endDate) {
  if (!connecteamsApiKey) {
    throw new Error('CONNECTEAMS_API_KEY is not set');
  }

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
  try {
    const schedRes = await connecteamsFetch('/scheduler/v1/schedulers');
    const sRaw = schedRes.data != null ? schedRes.data : schedRes;
    const schedList = Array.isArray(sRaw) ? sRaw : (schedRes.schedulers || sRaw.items || []);
    const activeSchedulers = (schedList || []).filter((s) => s.isArchived === false);
    const schedIds = activeSchedulers.length
      ? activeSchedulers.map((s) => s.id ?? s.schedulerId).filter(Boolean)
      : (schedList || []).map((s) => s.id ?? s.schedulerId).filter(Boolean);
    for (const schedId of schedIds.slice(0, 10)) {
      try {
        let shOffset = 0;
        const shLimit = 100;
        let shHasMore = true;
        while (shHasMore) {
          const shiftsPath = `/scheduler/v1/schedulers/${schedId}/shifts?startTime=${dayBounds.startTime}&endTime=${dayBounds.endTime}&limit=${shLimit}&offset=${shOffset}`;
          const shData = await connecteamsFetch(shiftsPath);
          const shRaw = shData.data != null ? shData.data : shData;
          const shiftList = Array.isArray(shRaw) ? shRaw : (shRaw.shifts || shRaw.items || []);
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
            const shiftDate = dateFromTimestamp(Math.floor(stMs / 1000));
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
            const tz = sh.timezone || DEFAULT_TIMEZONE;
            const userIds = sh.assignedUserIds || sh.userIds || (sh.assignedUserId != null ? [sh.assignedUserId] : []);
            for (const uid of userIds) {
              if (uid == null) continue;
              const ukey = String(uid);
              if (!scheduleMap[ukey]) scheduleMap[ukey] = {};
              const sd = toDateString(shiftDate) || shiftDate;
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
  } catch (_) {
    // no schedulers
  }

  // 4. Timesheet + Time-activities -> build list of (userId, date, clockIn, clockOut, locationKey)
  const entries = [];
  const assignedUserIdsByClock = {};
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
        const tz = (sched && sched.timezone) ? sched.timezone : DEFAULT_TIMEZONE;
        let locationKey = (sched && sched.locationKey) || null;
        if (!locationKey && userInfo) {
          const locJob = userInfo.locationJobValues || userInfo.locationValues || [];
          for (const v of locJob) {
            const k = normalizeLocationKey(v);
            if (k) {
              locationKey = k;
              break;
            }
          }
        }
        if (!locationKey) locationKey = locationKeys[0];
        const clockOutMsUse = clockOutMs != null ? clockOutMs : clockInMs + 8 * 60 * 60 * 1000;
        const clockInStr = formatTimeInTimezone(clockInMs, tz);
        const clockOutStr = formatTimeInTimezone(clockOutMsUse, tz);
        if (clockInStr === '—') continue;
        const scheduledTimeStr = (sched && sched.scheduledStartMs != null) ? formatTimeInTimezone(sched.scheduledStartMs, tz) : '—';
        entries.push({
          connecteamsUserId: ukey,
          employeeName: userInfo ? userInfo.name : 'User ' + ukey,
          locationKey,
          date: recordDate,
          clockIn: clockInStr,
          clockOut: clockOutStr,
          scheduledTime: scheduledTimeStr !== '—' ? scheduledTimeStr : undefined,
        });
      }
    } catch (_) {
      // skip time clock
    }
  }

  // 5. Time-activities (fallback for punch pairs)
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
          let locationKey = (sched && sched.locationKey) || null;
          if (!locationKey && userInfo) {
            const locJob = userInfo.locationJobValues || userInfo.locationValues || [];
            for (const v of locJob) {
              const k = normalizeLocationKey(v);
              if (k) {
                locationKey = k;
                break;
              }
            }
          }
          if (!locationKey) locationKey = locationKeys[0];
          const scheduledTimeStr = (sched && sched.scheduledStartMs != null) ? formatTimeInTimezone(sched.scheduledStartMs, tz) : undefined;
          entries.push({
            connecteamsUserId: ukey,
            employeeName: userInfo ? userInfo.name : 'User ' + ukey,
            locationKey,
            date: shiftDate,
            clockIn: formatTimeInTimezone(clockInTs, tz),
            clockOut: formatTimeInTimezone(clockOutMsUse, tz),
            scheduledTime: scheduledTimeStr,
          });
        }
      }
    } catch (_) {
      // skip
    }
  }

  return entries;
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

module.exports = {
  connecteamsFetch,
  getTimeEntriesFromConnecteams,
  LOCATIONS: LOCATIONS,
};
