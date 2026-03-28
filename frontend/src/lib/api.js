/**
 * Lightweight API helpers used by pages that do raw fetch (Blog, etc.)
 * For the full SDK wrapper see ../api.js
 */

export const apiBase = import.meta.env.VITE_API_URL || '';

export function authHeaders() {
  const token = localStorage.getItem('orquestra_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}
