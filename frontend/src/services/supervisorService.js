import { postToAPI, getFromAPI, putToAPI, deleteFromAPI } from './api';

export async function createSupervisor(email, username) {
  const data = await postToAPI('/supervisors', { email, username });
  return data;
}

export async function getSupervisors() {
  return getFromAPI('/supervisors');
}

export async function updateSupervisor(id, email, username) {
  return putToAPI(`/supervisors/${id}`, { email, username });
}

export async function deleteSupervisor(id) {
  return deleteFromAPI(`/supervisors/${id}`);
}
