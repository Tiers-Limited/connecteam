import api from './api';

export async function getDailyTipInput(locationId, date) {
  const { data } = await api.get(`/daily-tips/${locationId}/${date}`);
  return data.data;
}

export async function getDailyTipCalculation(locationId, date) {
  const { data } = await api.get(`/daily-tips/${locationId}/${date}/calculation`);
  return data.data;
}

export async function upsertDailyTipInput(locationId, date, body) {
  const { data } = await api.put(`/daily-tips/${locationId}/${date}`, body);
  return data.data;
}

export async function getDailyTipAdjustments(locationId, date) {
  const { data } = await api.get(`/daily-tips/${locationId}/${date}/adjustments`);
  return data.data;
}

export async function upsertDailyTipAdjustment(locationId, date, body) {
  const { data } = await api.post(`/daily-tips/${locationId}/${date}/adjustment`, body);
  return data.data;
}

export async function getDailyTipsHistory(page = 1, limit = 25) {
  const { data } = await api.get('/daily-tips/history', { params: { page, limit } });
  return data.data;
}
