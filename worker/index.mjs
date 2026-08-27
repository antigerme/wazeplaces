// Adaptador Cloudflare Workers (Worker + static assets) — mesmo modelo do botequei.
//
// Um único Worker: roteia POST /api/* pro core e delega o resto (estáticos) pro
// binding ASSETS. Deploy com `npx wrangler deploy` (ou via git-connected build).
//
// Bindings necessários (em wrangler.jsonc / dashboard):
//   - ASSETS   → assets estáticos (configurado em wrangler.jsonc: assets.binding)
//   - SESSIONS → namespace KV pras sessões
//   - ENCRYPTION_KEY → Secret (base64, 32 bytes): openssl rand -base64 32
//   - SALA     → Durable Object da presença (worker/sala-do.mjs)
//   - TURN_KEY_ID / TURN_API_TOKEN → opcionais: Cloudflare Realtime TURN
//   - TURN_URLS / TURN_SECRET      → opcionais: coturn próprio (alternativa)
//     Sem nenhum dos dois pares, a conversa fica só com STUN
//
// Toda a lógica vive em server/core.mjs (compartilhada com a VM Node).

import { dispatch, makeSessions, makeCrachas, base64ToBytes, SESSION_TTL } from '../server/core.mjs';
import { limpar } from '../server/presenca.mjs';

export { SalaDO } from './sala-do.mjs';

// `no-store` em TODA resposta de /api. Hoje nada é cacheado ali — é POST, e
// POST não entra em cache por padrão —, mas "por padrão" é a palavra que
// preocupa: o painel do Cloudflare tem um interruptor de cache padrão pras
// respostas de fetch handler, e o modo de falha aqui não é lentidão, é a
// resposta de um editor sendo servida pra outro. Depender de um default
// implícito pra impedir isso é caro demais pra economizar um header.
const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Sala de presença: WebSocket direto pro Durable Object daquela FILA. O
    // nome da sala escolhe o objeto; quem decide se o socket entra é o crachá
    // assinado, conferido lá dentro.
    if (url.pathname === '/sala') {
      if (!env.SALA) return json({ success: false, error: 'Presença não configurada' }, 500);
      const sala = limpar(url.searchParams.get('s'));
      if (!sala) return json({ success: false, error: 'Sala ausente' }, 400);
      return env.SALA.get(env.SALA.idFromName(sala)).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'POST') {
        return json({ success: false, error: 'Método não permitido' }, 405);
      }
      if (!env.ENCRYPTION_KEY || !env.SESSIONS) {
        return json({ success: false, error: 'Backend não configurado (falta KV SESSIONS ou Secret ENCRYPTION_KEY)' }, 500);
      }

      try {
        const route = url.pathname.slice(5); // remove "/api/"
        let data = {};
        try {
          data = await request.json();
        } catch {
          data = {};
        }

        // base64ToBytes lança se o Secret ENCRYPTION_KEY estiver malformado.
        // Sem este try/catch, o Worker devolveria a página HTML 1101 em vez de JSON.
        const keyBytes = base64ToBytes(env.ENCRYPTION_KEY);
        const store = {
          get: (h) => env.SESSIONS.get('sess_' + h),
          put: (h, blob, ttl) => env.SESSIONS.put('sess_' + h, blob, { expirationTtl: ttl || SESSION_TTL }),
          delete: (h) => env.SESSIONS.delete('sess_' + h),
        };
        const sessions = makeSessions({ store, keyBytes });
        const crachas = makeCrachas({ keyBytes });
        const turn = {
          // Cloudflare Realtime TURN (o painel dá os dois valores juntos)
          keyId: env.TURN_KEY_ID || '',
          apiToken: env.TURN_API_TOKEN || '',
          // coturn próprio, caso a instalação prefira
          urls: env.TURN_URLS || '',
          segredo: env.TURN_SECRET || '',
        };

        const { status, body } = await dispatch(route, data, { sessions, crachas, turn });
        return json(body, status);
      } catch (err) {
        console.error('Erro no handler /api:', err);
        return json({ success: false, error: 'Erro interno' }, 500);
      }
    }

    // Tudo que não é /api/ → arquivos estáticos (HTML, css, js, icons…)
    //
    // A raiz serve o HTML MINIFICADO (`npm run html`), não o fonte comentado:
    // 36 KB gzip contra 20, e -388ms de FCP num 3G. Mesmo remapeamento do
    // `server/node.mjs` — os dois adaptadores TÊM que concordar, senão "levar
    // pra uma VM" vira mudança de comportamento (gotcha #14).
    //
    // `/index.html` entra junto: sem isso seriam duas URLs com conteúdos
    // diferentes, e o service worker precacheia as duas.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const alvo = new URL(request.url);
      alvo.pathname = '/index.min.html';
      return env.ASSETS.fetch(new Request(alvo, request));
    }
    return env.ASSETS.fetch(request);
  },
};
