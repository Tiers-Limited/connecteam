import api from './api';

export async function getTimeEntriesByDate(locationId, date) {
  const { data } = await api.get(`/time-entries/${locationId}/${date}`);
  return data.data;
}

export async function getTimeEntriesRange(locationId, startDate, endDate) {
  const { data } = await api.get(`/time-entries/${locationId}/range`, {
    params: { startDate, endDate },
  });
  return data.data;
}

export async function createTimeEntry(body) {
  const { data } = await api.post('/time-entries', body);
  return data.data;
}

export async function updateTimeEntry(id, body) {
  const { data } = await api.put(`/time-entries/${id}`, body);
  return data.data;
}

export async function deleteTimeEntry(id) {
  const { data } = await api.delete(`/time-entries/${id}`);
  return data.data;
}
