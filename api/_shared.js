import { createHash } from 'node:crypto';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0'
};

export function send(res, status, payload) {
  Object.entries(JSON_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  return res.status(status).json(payload);
}

export function config() {
  const rawUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const url = rawUrl.replace(/\/(?:rest|auth|storage)\/v1\/?$/i, '').replace(/\/$/, '');
  const secretKey = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  const legacyServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const key = secretKey || legacyServiceRoleKey;
  return {
    url,
    key,
    isSecretKey: /^sb_secret_/.test(key),
    configured: /^https:\/\//.test(url) && key.length > 20
  };
}

export function accessKeyHash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}
function actualAccessKey(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}
function sameValue(actual, expected) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
export function authorized(req, storedHash = '') {
  const actual = actualAccessKey(req);
  return sameValue(actual, String(process.env.APP_ACCESS_KEY || '')) || sameValue(accessKeyHash(actual), String(storedHash || ''));
}
export function accessConfigured() {
  return String(process.env.APP_ACCESS_KEY || '').length >= 12;
}

export function validateStatePayload(state) {
  const arrays = ['rates', 'rooms', 'services', 'guests', 'bookings', 'stays', 'moves', 'charges', 'invoices', 'invoiceLines', 'receipts', 'housekeeping', 'maintenance', 'stockIns', 'stockOuts', 'audit'];
  if (!state || typeof state !== 'object' || Array.isArray(state) || !state.meta || !state.settings) return false;
  return arrays.every((key) => Array.isArray(state[key]));
}

export async function supabaseFetch(path, options = {}) {
  const current = config();
  if (!current.configured) {
    const error = new Error('SUPABASE_NOT_CONFIGURED');
    error.code = 'SUPABASE_NOT_CONFIGURED';
    throw error;
  }
  const authenticationHeaders = current.isSecretKey
    ? { apikey: current.key }
    : { apikey: current.key, Authorization: `Bearer ${current.key}` };
  const response = await fetch(current.url + path, {
    ...options,
    headers: {
      ...authenticationHeaders,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!response.ok) {
    const error = new Error(body?.message || body?.hint || `Supabase HTTP ${response.status}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}
