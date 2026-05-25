const https = require('https');
const { connecteamsApiKey, connecteamsBase } = require('../config/env');
const { LOCATIONS } = require('../utils/constants');
const {
  toDateString,
  getWeekEnd,
  timeToMinutes,
  getDatesInRange: getDatesInRangeAppTimezone,
  dateRangeToUtcBounds,
  getAppTimezone,
} = require('../utils/dateUtils');

const DEFAULT_TIMEZONE = 'America/Aruba';

const CONNECTEAM_ENTRIES_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const connecteamEntriesCache = new Map();
const connecteamEntriesInFlight = new Map();
const CONNECTEAM_JOB_FETCH_CONCURRENCY = 8;

let connecteamCallCount = 0;

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
        let trimmed = (body || '').trim().replace(/^\uFEFF/, '');
        if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
          return resolve({});
        }
        try {
          const parsed = JSON.parse(trimmed);
          resolve(parsed != null && typeof parsed === 'object' ? parsed : {});
        } catch (e) {
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
  if (s.includes('pastry')) return 'pastry';
  if (s.includes('royal') && s.includes('plaza')) return 'royal plaza';
  return null;
}

/** Whether a normalized location key is included in the current fetch scope. */
function locationKeyInScope(locationKey, locationKeys) {
  if (!Array.isArray(locationKeys) || locationKeys.length === 0) return true;
  if (!locationKey) return false;
  const lk = String(locationKey).toLowerCase().trim();
  return locationKeys.some((k) => String(k).toLowerCase().trim() === lk);
}

function extractJobFromApiResponse(jobRes) {
  const jobData = jobRes && jobRes.data != null ? jobRes.data : jobRes;
  return (jobData && (jobData.job || jobData)) || null;
}

/** Resolve app location key from a Connecteam job record (title, parent, instances). */
function resolveLocationKeyFromJob(job) {
  if (!job || typeof job !== 'object') return null;
  const title = String(job.title || job.name || '').trim();
  let locKey = title ? normalizeLocationKey(title) : null;
  if (!locKey && job.useParentData) {
    const parentTitle = String(
      job.parentTitle ||
        job.parentJobTitle ||
        (job.parent && (job.parent.title || job.parent.name)) ||
        '',
    ).trim();
    if (parentTitle) locKey = normalizeLocationKey(parentTitle);
  }
  if (!locKey && job.gps && job.gps.address) {
    locKey = normalizeLocationKey(String(job.gps.address));
  }
  return locKey;
}

/** Register job + instance/sub-job ids to the same resolved location key. */
function registerJobIdMappings(primaryJobId, job, locKey, jobIdToLocationKey, jobIdToResolvedKey, locationKeys) {
  const ids = new Set();
  if (primaryJobId != null && String(primaryJobId).trim() !== '') ids.add(String(primaryJobId));
  if (job && job.jobId != null && String(job.jobId).trim() !== '') ids.add(String(job.jobId));
  if (job && Array.isArray(job.instanceIds)) {
    for (const iid of job.instanceIds) {
      if (iid != null && String(iid).trim() !== '') ids.add(String(iid));
    }
  }
  if (job && Array.isArray(job.subJobs)) {
    for (const sub of job.subJobs) {
      const sid = sub && (sub.jobId ?? sub.id);
      if (sid != null && String(sid).trim() !== '') ids.add(String(sid));
    }
  }
  for (const id of ids) {
    jobIdToResolvedKey[id] = locKey;
    if (locKey && locationKeyInScope(locKey, locationKeys)) {
      jobIdToLocationKey[id] = locKey;
    }
  }
}

async function fetchJobRecord(jobId) {
  const jobRes = await connecteamsFetch(`/jobs/v1/jobs/${encodeURIComponent(jobId)}`);
  return extractJobFromApiResponse(jobRes);
}

/**
 * Map a Connecteam job id to a location key, following parent jobs and instance ids.
 * Generic for all locations configured in LOCATIONS.
 */
async function mapConnecteamJobToLocation(
  jobId,
  jobIdToLocationKey,
  jobIdToResolvedKey,
  locationKeys,
  fetchedJobs,
) {
  const id = String(jobId);
  if (fetchedJobs.has(id)) return;
  fetchedJobs.add(id);

  let job;
  try {
    job = await fetchJobRecord(id);
  } catch (_) {
    jobIdToResolvedKey[id] = null;
    return;
  }
  if (!job) {
    jobIdToResolvedKey[id] = null;
    return;
  }

  let locKey = resolveLocationKeyFromJob(job);
  const parentId = job.parentJobId ?? job.parentId ?? (job.parent && job.parent.jobId);
  if (!locKey && parentId != null && String(parentId).trim() !== '') {
    const parentKey = String(parentId);
    if (!fetchedJobs.has(parentKey)) {
      try {
        const parentJob = await fetchJobRecord(parentKey);
        fetchedJobs.add(parentKey);
        if (parentJob) {
          const parentLoc = resolveLocationKeyFromJob(parentJob);
          if (parentLoc) {
            locKey = parentLoc;
            registerJobIdMappings(parentKey, parentJob, locKey, jobIdToLocationKey, jobIdToResolvedKey, locationKeys);
          }
        }
      } catch (_) {
        /* parent optional */
      }
    } else if (jobIdToResolvedKey[parentKey]) {
      locKey = jobIdToResolvedKey[parentKey];
    }
  }

  registerJobIdMappings(id, job, locKey, jobIdToLocationKey, jobIdToResolvedKey, locationKeys);
}

function shiftLocationStringFromPunch(shift) {
  return (
    (shift.locationData && (shift.locationData.gps || {}).address)
      ? shift.locationData.gps.address
      : (shift.locationData && shift.locationData.address)
        ? shift.locationData.address
        : (shift.locationData && shift.locationData.name)
          ? shift.locationData.name
          : (shift.locationName || shift.address || (shift.location && shift.location.name) || (shift.location && shift.location.address) || '')
  );
}

function resolvePunchLocationKey({
  shift,
  userInfo,
  schedEntry,
  jobIdToLocationKey,
  jobIdToResolvedKey,
  locationKeys,
  includeAllLocations,
}) {
  const jobId = shift.jobId != null ? String(shift.jobId) : null;
  let locationKey =
    (jobId && jobIdToLocationKey[jobId]) ||
    (jobId && jobIdToResolvedKey[jobId]) ||
    null;

  const shiftLocationStr = shiftLocationStringFromPunch(shift);
  if (!locationKey && shiftLocationStr) {
    locationKey = normalizeLocationKey(shiftLocationStr);
  }

  if (!locationKey && schedEntry && schedEntry.locationKey) {
    const sk = schedEntry.locationKey;
    if (locationKeyInScope(sk, locationKeys)) locationKey = sk;
  }

  if (!locationKey && userInfo) {
    const fromProfile = getLocationKeysForPunch(userInfo, null, locationKeys);
    if (fromProfile.length > 0) locationKey = fromProfile[0];
  }

  if (!locationKey && includeAllLocations) {
    locationKey = normalizeLocationKey(shiftLocationStr) || 'unknown';
  }

  return locationKey;
}

function getLocationKeysForPunch(userInfo, schedLocationKey, locationKeys) {
  const scoped = Array.isArray(locationKeys) && locationKeys.length > 0;
  if (schedLocationKey && (!scoped || locationKeys.includes(schedLocationKey))) {
    return [schedLocationKey];
  }
  const collected = new Set();
  const locJob = (userInfo && (userInfo.locationJobValues || userInfo.locationValues)) || [];
  const locOnly = (userInfo && userInfo.locationValues) || [];
  for (const v of [...locJob, ...locOnly]) {
    const k = normalizeLocationKey(String(v));
    if (!k) continue;
    if (!scoped || locationKeys.includes(k)) collected.add(k);
  }
  if (collected.size > 0) return Array.from(collected);
  return [];
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
      second: '2-digit',
      hour12: false,
    });
    return s && s.length >= 8 ? s.slice(0, 8) : '—';
  } catch (_) {
    const d = new Date(tsMs);
    return (
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0') +
      ':' +
      String(d.getSeconds()).padStart(2, '0')
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

/** Inclusive calendar range bounds in Unix seconds, using app timezone (same as Daily Tips / production pool). */
function getDateRangeBoundsUnixSeconds(startStr, endStr) {
  const { startMs, endMs } = dateRangeToUtcBounds(startStr, endStr, getAppTimezone());
  return {
    startTime: Math.floor(startMs / 1000),
    endTime: Math.floor(endMs / 1000),
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const safeLimit = Math.max(1, Number(limit) || 1);
  const results = new Array(list.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(safeLimit, list.length) }).map(async () => {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= list.length) break;
      results[current] = await worker(list[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

async function getTimeEntriesFromConnecteamsUncached(startDate, endDate, locationKeysOverride = null) {
  if (!connecteamsApiKey) {
    throw new Error('CONNECTEAMS_API_KEY is not set');
  }

  connecteamCallCount = 0;
  const includeAllLocations = Array.isArray(locationKeysOverride) && locationKeysOverride.length === 0;
  const locationKeys = includeAllLocations
    ? []
    : (Array.isArray(locationKeysOverride) && locationKeysOverride.length > 0
      ? locationKeysOverride
      : LOCATIONS.map((l) => l.key));
  const firstUserFlow = { userId: null, userName: null, userFromApi: null, timeActivitiesResponse: null, jobIds: null, jobResponses: [] };
  const datesInRange = getDatesInRangeAppTimezone(startDate, endDate);
  const dayBounds = getDateRangeBoundsUnixSeconds(startDate, endDate);

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

  const timeClocksRes = await connecteamsFetch('/time-clock/v1/time-clocks');
  const tcRaw = timeClocksRes.data != null ? timeClocksRes.data : timeClocksRes;
  const timeClocksList = Array.isArray(tcRaw) ? tcRaw : (tcRaw.timeClocks || tcRaw.items || []);
  const timeClockIds = timeClocksList
    .map((c) => (c.id != null ? c.id : c.timeClockId))
    .filter(Boolean);

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

  const allManualBreaks = [];
  const manualBreakDedupe = new Set();

  const allShiftsWithUser = [];
  const tcFetchConcurrency = Math.min(8, Math.max(1, timeClockIds.length));
  await mapWithConcurrency(timeClockIds, tcFetchConcurrency, async (tcId) => {
    try {
      const actPath = `/time-clock/v1/time-clocks/${tcId}/time-activities?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
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
        const userInfo = userMap[ukey] || { name: 'User ' + ukey, locationValues: [], locationJobValues: [] };
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

        const manualBreaksRaw = userObj.manualBreaks || userObj.manual_breaks || [];
        for (const br of manualBreaksRaw) {
          const bStartMs = getClockInMsFromRecord(br);
          const bEndMs = getClockOutMsFromRecord(br);
          if (bStartMs == null || bEndMs == null || bEndMs <= bStartMs) continue;
          const bStart = br.start || {};
          const tzBr = (bStart.timezone || br.timezone) || DEFAULT_TIMEZONE;
          const breakDate =
            toDateString(dateFromTimestampInTimezone(Math.floor(bStartMs / 1000), tzBr)) || startDate;
          if (!datesInRange.includes(breakDate)) continue;
          const dedupeKey =
            br.id != null && String(br.id).trim() !== ''
              ? `${ukey}|${String(br.id)}`
              : `${ukey}|${bStartMs}|${bEndMs}`;
          if (manualBreakDedupe.has(dedupeKey)) continue;
          manualBreakDedupe.add(dedupeKey);
          allManualBreaks.push({
            connecteamsUserId: ukey,
            date: breakDate,
            startMs: bStartMs,
            endMs: bEndMs,
          });
        }
      }
    } catch (_) {
    }
  });

  const uniqueJobIds = [...new Set(allShiftsWithUser.map(({ shift }) => shift.jobId).filter(Boolean))];
  const jobIdToLocationKey = {};
  const jobIdToResolvedKey = {};
  const fetchedJobs = new Set();
  const firstUserJobIdSet = firstUserFlow.jobIds ? new Set(firstUserFlow.jobIds) : null;
  await mapWithConcurrency(uniqueJobIds, CONNECTEAM_JOB_FETCH_CONCURRENCY, async (jobId) => {
    if (firstUserJobIdSet && firstUserJobIdSet.has(jobId)) {
      try {
        const jobRes = await connecteamsFetch(`/jobs/v1/jobs/${encodeURIComponent(jobId)}`);
        firstUserFlow.jobResponses.push({ jobId, response: jobRes });
      } catch (_) {
        /* debug flow only */
      }
    }
    await mapConnecteamJobToLocation(
      jobId,
      jobIdToLocationKey,
      jobIdToResolvedKey,
      locationKeys,
      fetchedJobs,
    );
  });

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

    const sched = (scheduleMap[ukey] || {})[shiftDate];
    const locationKey = resolvePunchLocationKey({
      shift,
      userInfo,
      schedEntry: sched,
      jobIdToLocationKey,
      jobIdToResolvedKey,
      locationKeys,
      includeAllLocations,
    });
    if (!locationKeyInScope(locationKey, locationKeys)) continue;

    const clockOutTs = getClockOutMsFromRecord(shift);
    const clockOutMsUse = clockOutTs != null ? clockOutTs : clockInTs + 8 * 60 * 60 * 1000;
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
      timezone: tz,
      jobId: shift.jobId || null,
      subJobId: shift.subJobId || null,
    });
  }

  entries.manualBreaks = allManualBreaks;
  return entries;
}

async function getTimeEntriesFromConnecteams(startDate, endDate, locationKeysOverride = null, options = {}) {
  const skipCache = options && options.skipCache === true;
  const start = (startDate || '').toString().trim();
  const end = (endDate || '').toString().trim();
  const locationPart =
    Array.isArray(locationKeysOverride) && locationKeysOverride.length > 0
      ? locationKeysOverride.slice().sort().join('|')
      : 'all';
  const key = `${start}_${end}_${locationPart}`;

  if (skipCache) {
    connecteamEntriesCache.delete(key);
  }

  if (!skipCache) {
    const cached = connecteamEntriesCache.get(key);
    if (cached && Date.now() - cached.ts < CONNECTEAM_ENTRIES_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  let promise = connecteamEntriesInFlight.get(key);
  if (promise) {
    return promise;
  }

  promise = getTimeEntriesFromConnecteamsUncached(start, end, locationKeysOverride)
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

function mergeIntervalsMs(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];
  const sorted = intervals
    .filter((iv) => iv && Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of sorted) {
    if (!merged.length || iv.start > merged[merged.length - 1].end) {
      merged.push({ start: iv.start, end: iv.end });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end);
    }
  }
  return merged;
}

const DAY_KEY_BY_JS_DAY = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };


async function getTardinessFromConnecteamsByDateRange(startDate, endDate, locationKeyFilter = null, options = {}) {
  const start = (startDate || '').toString().trim().slice(0, 10);
  const end = (endDate || '').toString().trim().slice(0, 10);
  if (!start || !end) throw new Error('startDate and endDate are required (YYYY-MM-DD)');
  const includeAllLocations = options && options.includeAllLocations === true;
  const locationKeys = includeAllLocations
    ? []
    : (locationKeyFilter ? [String(locationKeyFilter).toLowerCase().trim()] : null);
  const skipTimeEntryCache = options && options.skipTimeEntryCache === true;
  const rawEntries = await getTimeEntriesFromConnecteams(start, end, locationKeys, {
    skipCache: skipTimeEntryCache,
  });
  return buildTardinessPayload(rawEntries, locationKeyFilter);
}

async function getWeeklyTardinessFromConnecteams(weekStart, locationKeyFilter = null, options = {}) {
  const startDate = toDateString(weekStart) || weekStart;
  const weekStartDate = new Date(startDate + 'T12:00:00');
  const weekEndDate = getWeekEnd(weekStartDate);
  const endDate = toDateString(weekEndDate);

  const includeAllLocations = options && options.includeAllLocations === true;
  const locationKeys = includeAllLocations
    ? []
    : (locationKeyFilter ? [String(locationKeyFilter).toLowerCase().trim()] : null);
  const skipTimeEntryCache = options && options.skipTimeEntryCache === true;
  const rawEntries = await getTimeEntriesFromConnecteams(startDate, endDate, locationKeys, {
    skipCache: skipTimeEntryCache,
  });
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

  const manualBreaks = Array.isArray(rawEntries?.manualBreaks) ? rawEntries.manualBreaks : [];
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
  const breakMinutesByEmpLoc = new Map();
  const workingMinutesByEmployee = new Map();
  const breakMinutesByEmployee = new Map();
  const dailyWorkingMinutes = [];
  const dailyBreakMinutes = [];
  for (const [key, row] of dayPunchesByKey) {
    let grossDurationMins = 0;
    if (row.clockInMs != null && row.clockOutMs != null && row.clockOutMs > row.clockInMs) {
      grossDurationMins = Math.max(0, Math.floor((row.clockOutMs - row.clockInMs) / 60000));
    } else if (row.clockOutMins >= 0 && row.clockInMins < Infinity) {
      grossDurationMins = Math.max(0, row.clockOutMins - row.clockInMins);
    }
    const parts = key.split('|');
    const connecteamsUserId = parts[0] || '';
    const locationKey = parts[1] || '';
    const dateStr = parts[2] || '';
    const empName = row.employeeName || connecteamsUserId;
    let breakDurationMins = 0;
    if (connecteamsUserId && dateStr && row.clockInMs != null && row.clockOutMs != null && row.clockOutMs > row.clockInMs && manualBreaks.length > 0) {
      const overlaps = [];
      for (const br of manualBreaks) {
        if (String(br.connecteamsUserId || '') !== connecteamsUserId) continue;
        if ((br.date || '').toString().slice(0, 10) !== dateStr) continue;
        const bStart = Number(br.startMs);
        const bEnd = Number(br.endMs);
        if (!Number.isFinite(bStart) || !Number.isFinite(bEnd) || bEnd <= bStart) continue;
        const ovStart = Math.max(row.clockInMs, bStart);
        const ovEnd = Math.min(row.clockOutMs, bEnd);
        if (ovEnd > ovStart) overlaps.push({ start: ovStart, end: ovEnd });
      }
      const mergedOverlaps = mergeIntervalsMs(overlaps);
      breakDurationMins = mergedOverlaps.reduce(
        (sum, iv) => sum + Math.max(0, Math.floor((iv.end - iv.start) / 60000)),
        0
      );
    }
    const durationMins = Math.max(0, grossDurationMins - breakDurationMins);
    if (connecteamsUserId && locationKey) {
      const empLocKey = `${connecteamsUserId}|${locationKey}`;
      workingMinutesByEmpLoc.set(empLocKey, (workingMinutesByEmpLoc.get(empLocKey) || 0) + durationMins);
      breakMinutesByEmpLoc.set(empLocKey, (breakMinutesByEmpLoc.get(empLocKey) || 0) + breakDurationMins);
      if (dateStr) dailyWorkingMinutes.push({ connecteamsUserId, locationKey, date: dateStr, workingMinutes: durationMins });
      if (dateStr) dailyBreakMinutes.push({ connecteamsUserId, locationKey, date: dateStr, breakMinutes: breakDurationMins });
    }
    if (empName) {
      workingMinutesByEmployee.set(empName, (workingMinutesByEmployee.get(empName) || 0) + durationMins);
      breakMinutesByEmployee.set(empName, (breakMinutesByEmployee.get(empName) || 0) + breakDurationMins);
    }
  }
  const employeeTotalWorkingMinutes = [];
  const employeeTotalBreakMinutes = [];
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
    employeeTotalBreakMinutes.push({
      connecteamsUserId,
      employeeName,
      locationKey,
      totalBreakMinutes: breakMinutesByEmpLoc.get(empLocKey) || 0,
    });
  }
  const totalWorkingMinutesByEmployee = Object.fromEntries(workingMinutesByEmployee);
  const totalBreakMinutesByEmployee = Object.fromEntries(breakMinutesByEmployee);



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
    employeeTotalBreakMinutes,
    totalWorkingMinutesByEmployee,
    totalBreakMinutesByEmployee,
    dailyWorkingMinutes,
    dailyBreakMinutes,
  };
}
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


const jobInfoCache = new Map();

async function getJobInfo(jobId) {
  if (!jobId) return null;
  const cacheKey = String(jobId);
  if (jobInfoCache.has(cacheKey)) return jobInfoCache.get(cacheKey);

  try {
    let job = await fetchJobRecord(cacheKey);
    let title = job && (job.title || job.name) ? String(job.title || job.name).trim() : null;
    const parentId = job && (job.parentJobId ?? job.parentId ?? (job.parent && job.parent.jobId));
    if (!title && parentId != null) {
      try {
        const parentJob = await fetchJobRecord(String(parentId));
        if (parentJob) title = String(parentJob.title || parentJob.name || '').trim() || null;
      } catch (_) {
        /* optional parent */
      }
    }
    if (!job) return null;
    const result = {
      jobId: job.jobId || cacheKey,
      title: title || null,
      code: job.code || null,
      description: job.description || null,
      locationKey: resolveLocationKeyFromJob(job) || (title ? normalizeLocationKey(title) : null),
    };
    jobInfoCache.set(cacheKey, result);
    return result;
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
