import api from './api';

export async function getWeeklyPayout(locationId, weekStart) {
  const { data } = await api.get(`/weekly-payout/${locationId}/${weekStart}`);
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
