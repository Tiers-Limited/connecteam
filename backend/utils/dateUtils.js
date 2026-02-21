/**
 * Date utilities for week boundaries (Monday–Sunday) and time parsing
 */

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
 * Get array of YYYY-MM-DD dates in range [startStr, endStr] (inclusive).
 * @param {string} startStr - YYYY-MM-DD
 * @param {string} endStr - YYYY-MM-DD
 * @returns {string[]}
 */
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
  getWeekStart,
  getWeekEnd,
  timeToMinutes,
  minutesToTime,
  toDateString,
  isDateInWeek,
  getDatesInRange,
};
