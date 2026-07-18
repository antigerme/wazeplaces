// Adaptador Cloudflare Pages Functions — catch-all pra /api/*.
//
// Injeta no core:
//   - store  = Workers KV (binding SESSIONS)   → sessões com TTL nativo
//   - keyBytes = Secret ENCRYPTION_KEY (base64) → chave AES-256-GCM
//
// Setup (uma vez):
//   wrangler kv namespace create SESSIONS        # pega o id → wrangler.jsonc
//   wrangler pages secret put ENCRYPTION_KEY     # cole: openssl rand -base64 32
//
// Toda a lógica vive em server/core.mjs (compartilhada com a VM Node).

import { dispatch, makeSessions, base64ToBytes, SESSION_TTL } from '../../server/core.mjs';

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'POST') {
    return json({ success: false, error: 'Método não permitido' }, 405);
  }
  if (!env.ENCRYPTION_KEY || !env.SESSIONS) {
    return json({ success: false, error: 'Backend não configurado (falta KV SESSIONS ou Secret ENCRYPTION_KEY)' }, 500);
  }

  const route = Array.isArray(params.route) ? params.route.join('/') : params.route || '';

  let data = {};
  try {
    data = await request.json();
  } catch {
    data = {};
  }

  const keyBytes = base64ToBytes(env.ENCRYPTION_KEY);
  const store = {
    get: (h) => env.SESSIONS.get('sess_' + h),
    put: (h, blob, ttl) => env.SESSIONS.put('sess_' + h, blob, { expirationTtl: ttl || SESSION_TTL }),
    delete: (h) => env.SESSIONS.delete('sess_' + h),
  };
  const sessions = makeSessions({ store, keyBytes });

  const { status, body } = await dispatch(route, data, { sessions });
  return json(body, status);
}
