// Adaptador Cloudflare Workers (Worker + static assets) — mesmo modelo do botequei.
//
// Um único Worker: roteia POST /api/* pro core e delega o resto (estáticos) pro
// binding ASSETS. Deploy com `npx wrangler deploy` (ou via git-connected build).
//
// Bindings necessários (em wrangler.jsonc / dashboard):
//   - ASSETS   → assets estáticos (configurado em wrangler.jsonc: assets.binding)
//   - SESSIONS → namespace KV pras sessões
//   - ENCRYPTION_KEY → Secret (base64, 32 bytes): openssl rand -base64 32
//
// Toda a lógica vive em server/core.mjs (compartilhada com a VM Node).

import { dispatch, makeSessions, base64ToBytes, SESSION_TTL } from '../server/core.mjs';

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'POST') {
        return json({ success: false, error: 'Método não permitido' }, 405);
      }
      if (!env.ENCRYPTION_KEY || !env.SESSIONS) {
        return json({ success: false, error: 'Backend não configurado (falta KV SESSIONS ou Secret ENCRYPTION_KEY)' }, 500);
      }

      const route = url.pathname.slice(5); // remove "/api/"
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

    // Tudo que não é /api/ → arquivos estáticos (index.html, css, js, icons…)
    return env.ASSETS.fetch(request);
  },
};
