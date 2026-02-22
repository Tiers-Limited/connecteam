import axios from 'axios';
import { API_BASE } from '../utils/constants';
import { getStoredToken, clearStoredAuth } from './authStorage';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearStoredAuth();
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    } else if (err.response) {
      console.error('API error', err.response?.status, err.response?.data);
    } else if (err.request) {
      console.error('Network error', err.message);
    } else {
      console.error('Error', err.message);
    }
    return Promise.reject(err);
  }
);

export const getFromAPI = (url) => api.get(url).then((res) => res.data);

export const postToAPI = (url, data) => api.post(url, data).then((res) => res.data);

export const putToAPI = (url, data) => api.put(url, data).then((res) => res.data);

export const deleteFromAPI = (url) => api.delete(url).then((res) => res.data);

export default api;
