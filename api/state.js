import { accessConfigured, accessKeyHash, authorized, config, send, supabaseFetch, validateStatePayload } from './_shared.js';

const ROW_ID = 'hotel-manager-pro';
const MAX_BODY_BYTES = 3_500_000;

async function currentRow() {
  const rows = await supabaseFetch(`/rest/v1/hotel_app_state?id=eq.${ROW_ID}&select=state,version,updated_at`, { method: 'GET' });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
function stateForClient(rawState) {
  const state = structuredClone(rawState || {});
  if (state.meta) delete state.meta.accessKeyHash;
  return state;
}
function stateForStorage(rawState, existingState, newAccessKey) {
  const state = structuredClone(rawState);
  const oldHash = String(existingState?.meta?.accessKeyHash || '');
  delete state.meta.accessKeyHash;
  const nextHash = String(newAccessKey || '').trim() ? accessKeyHash(newAccessKey) : oldHash;
  if (nextHash) state.meta.accessKeyHash = nextHash;
  return state;
}
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!config().configured) return send(res, 503, { ok: false, error: 'SUPABASE_NOT_CONFIGURED', message: 'Chưa cấu hình Supabase trên Vercel.' });
  if (!accessConfigured()) return send(res, 503, { ok: false, error: 'ACCESS_KEY_NOT_CONFIGURED', message: 'APP_ACCESS_KEY phải có ít nhất 12 ký tự trên Vercel.' });
  try {
    const row = await currentRow();
    if (!authorized(req, row?.state?.meta?.accessKeyHash || '')) return send(res, 401, { ok: false, error: 'UNAUTHORIZED', message: 'Mã truy cập không đúng.' });
    if (req.method === 'GET') {
      if (!row) return send(res, 200, { ok: true, state: null, version: 0, updatedAt: null });
      return send(res, 200, { ok: true, state: stateForClient(row.state), version: Number(row.version || 0), updatedAt: row.updated_at });
    }
    const rawSize = Buffer.byteLength(JSON.stringify(req.body || {}));
    if (rawSize > MAX_BODY_BYTES) return send(res, 413, { ok: false, error: 'STATE_TOO_LARGE' });
    const state = req.body?.state;
    const expectedVersion = Number(req.body?.expectedVersion || 0);
    const newAccessKey = String(req.body?.newAccessKey || '').trim();
    if (!validateStatePayload(state)) return send(res, 400, { ok: false, error: 'INVALID_STATE' });
    if (newAccessKey && newAccessKey.length < 12) return send(res, 400, { ok: false, error: 'INVALID_ACCESS_KEY', message: 'Mã truy cập phải có ít nhất 12 ký tự.' });
    const result = await supabaseFetch('/rest/v1/rpc/save_hotel_state', { method: 'POST', body: JSON.stringify({ p_id: ROW_ID, p_expected_version: expectedVersion, p_state: stateForStorage(state, row?.state, newAccessKey) }) });
    const saved = Array.isArray(result) ? result[0] : result;
    if (!saved?.saved) return send(res, 409, { ok: false, error: 'VERSION_CONFLICT', version: Number(saved?.current_version || 0) });
    return send(res, 200, { ok: true, version: Number(saved.current_version), updatedAt: saved.updated_at });
  } catch (error) {
    console.error('state api error', error);
    const schemaMissing = /Could not find the table|relation .* does not exist|schema cache/i.test(String(error.message || ''));
    if (schemaMissing) {
      return send(res, 503, {
        ok: false,
        error: 'DATABASE_SCHEMA_MISSING',
        message: 'Supabase chưa có bảng public.hotel_app_state. Hãy chạy supabase/migrations/001_hotel_manager.sql trong SQL Editor rồi tải lại ứng dụng.'
      });
    }
    return send(res, Number(error.status || 500), { ok: false, error: error.code || 'SERVER_ERROR', message: error.message || 'Không thể xử lý dữ liệu.' });
  }
}
