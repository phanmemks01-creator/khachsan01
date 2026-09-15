import { authorized, config, send, supabaseFetch } from './_shared.js';

const ROW_ID = 'hotel-manager-pro';
const MAX_BODY_BYTES = 3_500_000;

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!authorized(req)) return send(res, 401, { ok: false, error: 'UNAUTHORIZED', message: 'Mã truy cập không đúng.' });
  if (!config().configured) {
    return send(res, 503, { ok: false, error: 'SUPABASE_NOT_CONFIGURED', message: 'Chưa cấu hình Supabase trên Vercel.' });
  }

  try {
    if (req.method === 'GET') {
      const rows = await supabaseFetch(`/rest/v1/hotel_app_state?id=eq.${ROW_ID}&select=state,version,updated_at`, { method: 'GET' });
      if (!Array.isArray(rows) || !rows.length) return send(res, 200, { ok: true, state: null, version: 0, updatedAt: null });
      return send(res, 200, { ok: true, state: rows[0].state, version: Number(rows[0].version || 0), updatedAt: rows[0].updated_at });
    }

    const rawSize = Buffer.byteLength(JSON.stringify(req.body || {}));
    if (rawSize > MAX_BODY_BYTES) return send(res, 413, { ok: false, error: 'STATE_TOO_LARGE' });
    const state = req.body?.state;
    const expectedVersion = Number(req.body?.expectedVersion || 0);
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return send(res, 400, { ok: false, error: 'INVALID_STATE' });
    }
    const result = await supabaseFetch('/rest/v1/rpc/save_hotel_state', {
      method: 'POST',
      body: JSON.stringify({ p_id: ROW_ID, p_expected_version: expectedVersion, p_state: state })
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row?.saved) return send(res, 409, { ok: false, error: 'VERSION_CONFLICT', version: Number(row?.current_version || 0) });
    return send(res, 200, { ok: true, version: Number(row.current_version), updatedAt: row.updated_at });
  } catch (error) {
    console.error('state api error', error);
    return send(res, Number(error.status || 500), {
      ok: false,
      error: error.code || 'SERVER_ERROR',
      message: error.message || 'Không thể xử lý dữ liệu.'
    });
  }
}
