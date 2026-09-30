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
// A sala de presença (Durable Object `SalaDO`, o WebSocket do `/sala` e o
// TURN) saiu na fase 4: desde a fase 3 a lista e a conversa são as do WME. A
// classe é apagada pela migração `v2` do wrangler.jsonc.
//
// Toda a lógica vive em server/core.mjs (compartilhada com a VM Node).

import { dispatch, makeSessions, base64ToBytes, SESSION_TTL, MAX_BODY_BYTES, RESPOSTA_CORPO_GRANDE } from '../server/core.mjs';

// O corpo, lido com TETO — o mesmo da VM (`readBody`), e com a mesma resposta.
// Era `request.json()`, que lê o que vier: o corpo de 5,5 MB (e o de 20) dava
// 200 aqui e 413 na VM, o mesmo pedido com duas respostas (gotcha #14;
// auditoria de 2026-09-29). O `content-length` declarado decide sem ler nada;
// sem ele (corpo em pedaços), conta o que chega e para no teto. `null` = passou.
// O `TextDecoder` tira o BOM do começo, como o `request.json()` tirava.
async function lerCorpo(request) {
  const declarado = Number(request.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const leitor = request.body.getReader();
  const pedacos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try { await leitor.cancel(); } catch { /* já basta parar de ler */ }
      return null;
    }
    pedacos.push(value);
  }
  const bytes = new Uint8Array(total);
  let i = 0;
  for (const p of pedacos) { bytes.set(p, i); i += p.byteLength; }
  return new TextDecoder().decode(bytes);
}

// `no-store` em TODA resposta de /api. Hoje nada é cacheado ali — é POST, e
// POST não entra em cache por padrão —, mas "por padrão" é a palavra que
// preocupa: o painel do Cloudflare tem um interruptor de cache padrão pras
// respostas de fetch handler, e o modo de falha aqui não é lentidão, é a
// resposta de um editor sendo servida pra outro. Depender de um default
// implícito pra impedir isso é caro demais pra economizar um header.
// E `nosniff`: o `_headers` só vale pros estáticos que o Cloudflare serve; a
// resposta que o Worker monta sai sem ele, e JSON sem `nosniff` pode ser lido
// como outro tipo por navegador antigo (auditoria de 2026-09-25).
const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'POST') {
        return json({ success: false, error: 'Método não permitido' }, 405);
      }
      if (!env.ENCRYPTION_KEY || !env.SESSIONS) {
        return json({ success: false, error: 'Backend não configurado (falta KV SESSIONS ou Secret ENCRYPTION_KEY)' }, 500);
      }

      try {
        const route = url.pathname.slice(5); // remove "/api/"
        const texto = await lerCorpo(request);
        if (texto === null) return json(RESPOSTA_CORPO_GRANDE, 413);
        // O mesmo parse da VM (`server/node.mjs`): corpo que não é JSON vira {}.
        let data = {};
        try {
          data = JSON.parse(texto) || {};
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

        // `aoFundo`: o que o handler deixa correndo DEPOIS da resposta (a escrita
        // da presença de carona que passou do teto de espera). Sem `waitUntil`
        // o runtime da Cloudflare corta a promessa assim que a resposta sai.
        const aoFundo = ctx && typeof ctx.waitUntil === 'function' ? (p) => ctx.waitUntil(p) : undefined;
        const { status, body } = await dispatch(route, data, { sessions, aoFundo });
        return json(body, status);
      } catch (err) {
        console.error('Erro no handler /api:', err);
        return json({ success: false, error: 'Erro interno' }, 500);
      }
    }

    // Tudo que não é /api/ → arquivos estáticos (HTML, css, js…)
    //
    // SEM remapeamento de raiz, e isso é deliberado: aqui havia um `if` que
    // reescrevia `/` pro `/index.min.html`, e ele NUNCA rodou em produção. Com
    // `assets.directory: "."` o `index.html` existe como asset, `/` casa com
    // ele, e o pipeline de assets responde ANTES de invocar o Worker
    // (`run_worker_first` ausente = falso). MEDIDO: `/` devolvia o fonte
    // comentado de 182.791 bytes e `/index.html` dava 307 pra `/` — o 307 é do
    // Cloudflare, não nosso, o que PROVA que o Worker não era chamado.
    // Hoje o `index.html` já É o minificado (fonte em `index.src.html`), então
    // não há rota pra desviar: o conserto usa o mecanismo em vez de lutar com
    // ele, e não depende de nenhum recurso de plataforma que não dê pra testar.
    return env.ASSETS.fetch(request);
  },
};
