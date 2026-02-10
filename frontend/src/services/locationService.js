import api from './api';

export async function getLocations(activeOnly = true) {
  const { data } = await api.get('/locations', {
    params: activeOnly === false ? { activeOnly: 'false' } : {},
  });
  return data.data;
}

export async function getLocation(id) {
  const { data } = await api.get(`/locations/${id}`);
  return data.data;
}

export async function createLocation(body) {
  const { data } = await api.post('/locations', body);
  return data.data;
}

export async function updateLocation(id, body) {
  const { data } = await api.put(`/locations/${id}`, body);
  return data.data;
}

export async function deleteLocation(id) {
  const { data } = await api.delete(`/locations/${id}`);
  return data.data;
}
