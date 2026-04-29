import api from './api';

export async function getDailyTipInput(locationId, date) {
  const { data } = await api.get(`/daily-tips/${locationId}/${date}`);
  return data.data;
}

export async function getDailyTipCalculation(locationId, date, options = {}) {
  const params = {};
  if (options.refresh) params.refresh = '1';
  const { data } = await api.get(`/daily-tips/${locationId}/${date}/calculation`, {
    params: Object.keys(params).length ? params : undefined,
  });
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

export async function getPendingDailyTips(page = 1, limit = 25) {
  const { data } = await api.get('/daily-tips/pending-calculation', { params: { page, limit } });
  return data.data;
}

export async function calculateAllPendingDailyTips(max = 25) {
  const { data } = await api.post('/daily-tips/calculate-all-pending', { max });
  return data.data;
}

export async function getWeeklyFinalPayableSummary(startDate, endDate) {
  const { data } = await api.get('/daily-tips/weekly-final-payable-summary', {
    params: { startDate, endDate },
  });
  return data.data;
}
