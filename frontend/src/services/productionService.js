import api from './api';

export async function getProductionStaff() {
  const { data } = await api.get('/production/staff');
  return data.data;
}

export async function updateProductionStaff(id, body) {
  const { data } = await api.patch(`/production/staff/${id}`, body);
  return data.data;
}

export async function getWeeklyProductionPayout(weekStart) {
  const { data } = await api.get(`/production/weekly-payout/${weekStart}`);
  return data.data;
}

export async function getDailyProductionPool(date) {
  const { data } = await api.get(`/production/daily-pool/${date}`);
  return data.data;
}

export async function getLocationWiseProductionPool(weekStart) {
  const { data } = await api.get(`/production/location-wise-pool/${weekStart}`);
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
