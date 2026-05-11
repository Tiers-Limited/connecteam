import api from './api';

export async function getEmployees(locationId = null, activeOnly = true) {
  const params = activeOnly === false ? { activeOnly: 'false' } : {};
  if (locationId) params.locationId = locationId;
  const { data } = await api.get('/employees', { params });
  return data.data;
}

export async function getEmployee(id) {
  const { data } = await api.get(`/employees/${id}`);
  return data.data;
}

export async function createEmployee(body) {
  const { data } = await api.post('/employees', body);
  return data.data;
}

export async function updateEmployee(id, body) {
  const { data } = await api.put(`/employees/${id}`, body);
  return data.data;
}

export async function deleteEmployee(id) {
  const { data } = await api.delete(`/employees/${id}`);
  return data.data;
}

/** Persist tip multiplier override on the employee (daily tips). Pass null to use job-title default. */
export async function patchEmployeeTipMultiplier(id, tipMultiplierOverride) {
  const { data } = await api.patch(`/employees/${id}/tip-multiplier`, {
    tipMultiplierOverride,
  });
  return data.data;
}
