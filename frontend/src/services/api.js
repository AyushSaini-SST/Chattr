import axios from 'axios';
import { prepareFormDataRequest } from './formDataRequest.js';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(prepareFormDataRequest);

export function mediaUrl(path) {
  if (!path) return '';
  try { return new URL(path, api.defaults.baseURL || window.location.origin).toString(); }
  catch { return path; }
}

export function mediaCrossOrigin(path) {
  return typeof path === 'string' && path.startsWith('/api/media/') ? 'use-credentials' : undefined;
}

export function getApiError(error) {
  return error.response?.data?.error?.message || 'We couldn’t reach Chattr. Check your connection and try again.';
}
