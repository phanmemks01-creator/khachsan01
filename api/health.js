import { config, send } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  const current = config();
  return send(res, 200, {
    ok: true,
    app: 'Hotel Manager Pro',
    version: '4.0.0',
    environment: process.env.APP_ENV || 'production',
    supabaseConfigured: current.configured,
    accessKeyConfigured: Boolean(process.env.APP_ACCESS_KEY),
    timestamp: new Date().toISOString()
  });
}
