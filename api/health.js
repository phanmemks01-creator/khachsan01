import { accessConfigured, config, send, supabaseFetch } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  const current = config();
  let databaseReachable = null;
  let databaseStatus = current.configured ? 'not_checked' : 'not_configured';
  if (current.configured && ['1', 'true'].includes(String(req.query?.deep || '').toLowerCase())) {
    try {
      await supabaseFetch('/rest/v1/hotel_app_state?select=id&limit=1', { method: 'GET' });
      databaseReachable = true;
      databaseStatus = 'reachable';
    } catch (error) {
      console.error('health deep check failed', { status: error.status || 500, code: error.code || 'SUPABASE_ERROR' });
      databaseReachable = false;
      databaseStatus = /Could not find the table|relation .* does not exist|schema cache/i.test(String(error.message || '')) ? 'schema_missing' : 'unreachable';
    }
  }
  return send(res, 200, {
    ok: true,
    app: 'Hotel Manager Pro',
    version: '4.2.2',
    environment: process.env.APP_ENV || 'production',
    supabaseConfigured: current.configured,
    accessKeyConfigured: accessConfigured(),
    databaseReachable,
    databaseStatus,
    timestamp: new Date().toISOString()
  });
}
