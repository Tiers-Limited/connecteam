import api from './api';

/**
 * Load tardiness for a date range or a full week.
 * @param {string} [weekStart] - Monday date YYYY-MM-DD (used when no date range)
 * @param {string|null} locationId - optional location ID to filter
 * @param {boolean} [refresh=false] - if true, fetch from Connecteam and save to DB (week mode only)
 * @param {string} [startDate] - YYYY-MM-DD start of range (with endDate = custom range)
 * @param {string} [endDate] - YYYY-MM-DD end of range (with startDate = custom range)
 */
export async function getWeeklyTardiness(weekStart, locationId = null, refresh = false, startDate = null, endDate = null) {
  const params = {};
  if (startDate && endDate) {
    params.startDate = startDate.trim().slice(0, 10);
    params.endDate = endDate.trim().slice(0, 10);
  } else {
    params.weekStart = weekStart;
    if (refresh) params.refresh = 'true';
  }
  if (locationId) params.locationId = locationId;
  const { data } = await api.get('/connecteams/weekly-tardiness', { params });
  return data.data;
}
