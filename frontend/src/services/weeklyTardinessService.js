import api from './api';

/**
 * Load weekly tardiness. Uses DB cache when available; set refresh=true to force fetch from Connecteam and update cache.
 * @param {string} weekStart - Monday date YYYY-MM-DD
 * @param {string|null} locationId - optional location ID to filter
 * @param {boolean} [refresh=false] - if true, fetch from Connecteam API and save to DB; otherwise return cached data if present
 */
export async function getWeeklyTardiness(weekStart, locationId = null, refresh = false) {
  const params = { weekStart };
  if (locationId) params.locationId = locationId;
  if (refresh) params.refresh = 'true';
  const { data } = await api.get('/connecteams/weekly-tardiness', { params });
  return data.data;
}
