/**
 * Date utilities for week boundaries (Monday–Sunday), time parsing, and timezone-aware calendar-day ranges.
 * Rule: a date string YYYY-MM-DD means that calendar day in the app/location timezone (e.g. America/Aruba), not UTC.
 */

const DEFAULT_APP_TIMEZONE = 'America/Aruba';

/**
 * Get the app timezone for interpreting date strings (env TIMEZONE or America/Aruba).
 * @returns {string} IANA timezone, e.g. 'America/Aruba'
 */
function getAppTimezone() {
  const tz = typeof process !== 'undefined' && process.env && process.env.TIMEZONE;
  return (tz && String(tz).trim()) || DEFAULT_APP_TIMEZONE;
}

/**
 * Get the UTC milliseconds for the start of a calendar day in a given timezone.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timezone - IANA timezone, e.g. 'America/Aruba'
 * @returns {number} UTC ms for 00:00:00.000 on that day in that timezone
 */
function getStartOfDayUtcMs(dateStr, timezone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  if (!match) return NaN;
  const y = parseInt(match[1], 10);
  const mo = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const tz = (timezone || getAppTimezone()).trim() || getAppTimezone();
  try {
    // Find the UTC moment when it is 00:00:00 in the given timezone on this date.
    // Iterate UTC hours on this calendar day; the first hour where TZ date equals dateStr is start of day in TZ.
    for (let hour = 0; hour < 24; hour++) {
      const utcMs = Date.UTC(y, mo, day, hour, 0, 0, 0);
      const formatted = new Date(utcMs).toLocaleDateString('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const normalized = formatted.replace(/\//g, '-');
      const want = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (normalized === want) return utcMs;
    }
    // Fallback: assume same-day midnight (e.g. UTC)
    return Date.UTC(y, mo, day, 0, 0, 0, 0);
  } catch (_) {
    return Date.UTC(y, mo, day, 0, 0, 0, 0);
  }
}

/**
 * Get UTC range (start and end ms) for a single calendar day in a timezone.
 * End is 23:59:59.999 that day in that timezone.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} [timezone] - IANA timezone (default: app timezone)
 * @returns {{ startMs: number, endMs: number }}
 */
function dateStringToUtcRange(dateStr, timezone) {
  const startMs = getStartOfDayUtcMs(dateStr, timezone);
  if (Number.isNaN(startMs)) {
    const d = new Date(dateStr + 'T12:00:00');
    return {
      startMs: d.getTime() - 12 * 3600 * 1000,
      endMs: d.getTime() + 12 * 3600 * 1000 - 1,
    };
  }
  return {
    startMs,
    endMs: startMs + 24 * 60 * 60 * 1000 - 1,
  };
}

/**
 * Get UTC bounds for a date range interpreted as calendar days in the given timezone.
 * startStr/endStr are inclusive; returned range is [first day 00:00:00.000 in TZ, last day 23:59:59.999 in TZ] in UTC ms.
 * @param {string} startStr - YYYY-MM-DD
 * @param {string} endStr - YYYY-MM-DD
 * @param {string} [timezone] - IANA timezone (default: app timezone)
 * @returns {{ startMs: number, endMs: number }}
 */
function dateRangeToUtcBounds(startStr, endStr, timezone) {
  const tz = timezone || getAppTimezone();
  const start = getStartOfDayUtcMs(startStr, tz);
  const endDay = dateStringToUtcRange(endStr, tz);
  if (Number.isNaN(start)) {
    const s = new Date(startStr + 'T12:00:00');
    const e = new Date(endStr + 'T12:00:00');
    return {
      startMs: s.getTime() - 12 * 3600 * 1000,
      endMs: e.getTime() + 12 * 3600 * 1000 - 1,
    };
  }
  return {
    startMs: start,
    endMs: endDay.endMs,
  };
}

/**
 * Get Monday 00:00:00 of the week containing the given date
 * @param {Date|string} date
 * @returns {Date}
 */
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

/**
 * Get Sunday 23:59:59 of the week
 * @param {Date} weekStart
 * @returns {Date}
 */
function getWeekEnd(weekStart) {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Parse "HH:mm" string to minutes since midnight
 * @param {string} timeStr
 * @returns {number}
 */
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.trim().split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Minutes since midnight to "HH:mm"
 * @param {number} minutes
 * @returns {string}
 */
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Format date as YYYY-MM-DD
 * @param {Date|string} date
 * @returns {string}
 */
function toDateString(date) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

/**
 * Check if date is within week [weekStart, weekEnd]
 * @param {Date|string} date
 * @param {Date} weekStart
 * @param {Date} weekEnd
 * @returns {boolean}
 */
function isDateInWeek(date, weekStart, weekEnd) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(weekEnd);
  end.setHours(23, 59, 59, 999);
  return d >= start && d <= end;
}

/**
 * Format a UTC timestamp as YYYY-MM-DD in a given timezone (for display/grouping).
 * @param {number} utcMs - UTC milliseconds
 * @param {string} [timezone] - IANA timezone (default: app timezone)
 * @returns {string} YYYY-MM-DD
 */
function formatDateStringInTimezone(utcMs, timezone) {
  if (utcMs == null || Number.isNaN(utcMs)) return '';
  const tz = (timezone || getAppTimezone()).trim() || getAppTimezone();
  try {
    const d = new Date(utcMs);
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
    return `${y}-${m}-${day}`;
  } catch (_) {
    const d = new Date(utcMs);
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Get array of YYYY-MM-DD dates in range [startStr, endStr] (inclusive).
 * @param {string} startStr - YYYY-MM-DD
 * @param {string} endStr - YYYY-MM-DD
 * @returns {string[]}
 */
/**
 * Calendar day YYYY-MM-DD as a single Date for MongoDB: start of that day in the app timezone
 * (TIMEZONE env, default America/Aruba). Not UTC midnight — same meaning as date pickers on site.
 * @param {string|Date} date - YYYY-MM-DD string or Date
 * @param {string} [timezone] - IANA zone (default: getAppTimezone())
 * @returns {Date}
 */
function dateStringToAppDayStart(date, timezone) {
  const str =
    typeof date === 'string'
      ? date.slice(0, 10)
      : date.toISOString().slice(0, 10);
  const tz = (timezone || getAppTimezone()).trim() || getAppTimezone();
  return new Date(getStartOfDayUtcMs(str, tz));
}

/** @deprecated Use dateStringToAppDayStart — kept for any external requires */
function dateStringToUtcMidnight(date) {
  return dateStringToAppDayStart(date);
}

function getDatesInRange(startStr, endStr) {
  const start = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    return typeof startStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startStr)
      ? [startStr]
      : [toDateString(startStr) || startStr];
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
  getAppTimezone,
  getStartOfDayUtcMs,
  dateStringToUtcRange,
  dateRangeToUtcBounds,
  formatDateStringInTimezone,
  getWeekStart,
  getWeekEnd,
  timeToMinutes,
  minutesToTime,
  toDateString,
  isDateInWeek,
  getDatesInRange,
  dateStringToAppDayStart,
  dateStringToUtcMidnight,
};
