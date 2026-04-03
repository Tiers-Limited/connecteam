import api from './api';

/**
 * @param {string} locationId
 * @param {string} date - YYYY-MM-DD
 */
export async function getManualWorkingByDate(locationId, date) {
  const { data } = await api.get('/manual-working/by-date', {
    params: { locationId, date: date.trim().slice(0, 10) },
  });
  const list = data?.data;
  return Array.isArray(list) ? list : [];
}

/**
 * @param {object} body - employeeId OR employeeName, locationId, date, amHours, pmHours, optional amTips, pmTips, reason, notes
 */
export async function upsertManualWorking(body) {
  const { data } = await api.post('/manual-working', body);
  return data?.data ?? data;
}

/**
 * @param {string} manualWorkingId
 */
export async function deleteManualWorking(manualWorkingId) {
  const { data } = await api.delete(`/manual-working/${manualWorkingId}`);
  return data?.data ?? data;
}
