import api from './api';

/**
 * Sync time entries from Connecteams API for the given date range.
 * Uses the 4 fixed locations: Oranjestad, Casa del Mar, The Cove, Drive Thru.
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<{ synced: number, startDate: string, endDate: string }>}
 */
export async function syncFromConnecteams(startDate, endDate) {
  const { data } = await api.post('/connecteams/sync', {}, {
    params: { startDate, endDate },
  });
  return data.data;
}
