import api from './api';

/**
 * Load weekly tardiness from Connecteam: detail rows and daily totals Mon–Sun + week total.
 * @param {string} weekStart - Monday date YYYY-MM-DD
 * @param {string|null} locationId - optional location ID to filter
 */
export async function getWeeklyTardiness(weekStart, locationId = null) {
  const params = { weekStart };
  if (locationId) params.locationId = locationId;
  const { data } = await api.get('/connecteams/weekly-tardiness', { params });
  return data.data;
}
