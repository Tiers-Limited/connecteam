// In development, Vite proxies /api to the backend. In production (e.g. Netlify), set VITE_API_URL to your backend URL.
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const LOADING_DELAY_MS = 500;
