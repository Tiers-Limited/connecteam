import { postToAPI, getFromAPI, putToAPI, deleteFromAPI } from './api';

/**
 * @param {string} email
 * @param {string} username
 * @param {{ password?: string }} [opts] - If `password` is a non-empty string, it is used (min 6 chars); otherwise the server auto-generates one. Either way credentials are emailed.
 */
export async function createSupervisor(email, username, opts = {}) {
  const body = { email, username };
  const p = opts.password != null ? String(opts.password).trim() : '';
  if (p) body.password = p;
  const data = await postToAPI('/supervisors', body);
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

/** Admin only: set a new password for a supervisor (min 6 characters). */
export async function setSupervisorPassword(id, newPassword) {
  return postToAPI(`/supervisors/${id}/password`, { newPassword });
}
