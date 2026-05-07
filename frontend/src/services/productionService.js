import api from './api';

export async function getProductionStaff() {
  const { data } = await api.get('/production/staff');
  return data.data;
}

export async function updateProductionStaff(id, body) {
  const { data } = await api.patch(`/production/staff/${id}`, body);
  return data.data;
}

/**
 * @param {string} weekStart - YYYY-MM-DD (Monday or range start)
 * @param {string} [startDate] - with endDate = fetch tardiness from Connecteam for this range
 * @param {string} [endDate]
 * @returns {Promise<object>} Includes `payouts`, `locationWisePool` (same as location-wise table), `redistributionPool`, etc.
 */
export async function getWeeklyProductionPayout(weekStart, startDate = null, endDate = null) {
  const params = {};
  if (startDate && endDate) {
    params.startDate = startDate.trim().slice(0, 10);
    params.endDate = endDate.trim().slice(0, 10);
  }
  const { data } = await api.get(`/production/weekly-payout/${weekStart}`, { params });
  return data.data;
}

export async function getDailyProductionPool(date) {
  const { data } = await api.get(`/production/daily-pool/${date}`);
  return data.data;
}

/**
 * @param {string} weekStart - YYYY-MM-DD
 * @param {string} [startDate] - with endDate = use this date range for pool days
 * @param {string} [endDate]
 */
export async function getLocationWiseProductionPool(weekStart, startDate = null, endDate = null) {
  const params = {};
  if (startDate && endDate) {
    params.startDate = startDate.trim().slice(0, 10);
    params.endDate = endDate.trim().slice(0, 10);
  }
  const { data } = await api.get(`/production/location-wise-pool/${weekStart}`, { params });
  return data.data;
}

export async function getProductionManualDeductions(weekStart) {
  const { data } = await api.get(`/production/manual-deductions/${weekStart}`);
  return data.data;
}

export async function upsertProductionManualDeduction(body) {
  const { data } = await api.post('/production/manual-deduction', body);
  return data.data;
}
