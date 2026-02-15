import api from './api';

export async function getDashboardSummary() {
  const { data } = await api.get('/dashboard/summary');
  return data.data;
}
