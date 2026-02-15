import api from './api';

/**
 * @param {string} locationId
 * @param {string} weekStart - YYYY-MM-DD (Monday)
 * @param {boolean} [refresh=false] - if true, force recompute and save to DB (e.g. after updating Weekly Tardiness)
 */
export async function getWeeklyPayout(locationId, weekStart, refresh = false) {
  const params = refresh ? { refresh: 'true' } : {};
  const { data } = await api.get(`/weekly-payout/${locationId}/${weekStart}`, { params });
  return data.data;
}

export async function getTardiness(locationId, weekStart) {
  const { data } = await api.get(`/weekly-payout/${locationId}/${weekStart}/tardiness`);
  return data.data;
}

export async function upsertTardiness(body) {
  const { data } = await api.post('/weekly-payout/tardiness', body);
  return data.data;
}

export async function getManualDeductions(locationId, weekStart) {
  const { data } = await api.get(`/weekly-payout/${locationId}/${weekStart}/manual-deductions`);
  return data.data;
}

export async function upsertManualDeduction(body) {
  const { data } = await api.post('/weekly-payout/manual-deduction', body);
  return data.data;
}
