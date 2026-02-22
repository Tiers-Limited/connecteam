import { postToAPI, getFromAPI } from './api';
import { setStoredAuth, clearStoredAuth } from './authStorage';

export { getStoredToken, getStoredUser, setStoredAuth, clearStoredAuth } from './authStorage';

export async function login(email, password) {
  const data = await postToAPI('/auth/login', { email, password });
  return { user: data.user, token: data.token };
}

export async function fetchMe() {
  return getFromAPI('/auth/me');
}

export async function logout() {
  try {
    await postToAPI('/auth/logout');
  } catch {
    // ignore
  }
  clearStoredAuth();
}

export async function requestResetPin(email) {
  const data = await postToAPI('/auth/forgot-password', { email });
  return data;
}

export async function resetPasswordWithPin(email, pin, newPassword) {
  const data = await postToAPI('/auth/reset-password', { email, pin, newPassword });
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  return postToAPI('/auth/change-password', { currentPassword, newPassword });
}
