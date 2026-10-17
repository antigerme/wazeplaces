// Adaptador Cloudflare Workers (Worker + static assets) — mesmo modelo do botequei.
//
// Um único Worker: roteia POST /api/* pro core e delega o resto (estáticos) pro
// binding ASSETS. Deploy com `npx wrangler deploy` (ou via git-connected build).
//
// Bindings necessários (em wrangler.jsonc / dashboard):
//   - ASSETS   → assets estáticos (configurado em wrangler.jsonc: assets.binding)
//   - SESSIONS → namespace KV pras sessões
//   - ENCRYPTION_KEY → Secret (base64, no mínimo 32 bytes): openssl rand -base64 32
//
// A sala de presença (Durable Object `SalaDO`, o WebSocket do `/sala` e o
// TURN) saiu na fase 4: desde a fase 3 a lista e a conversa são as do WME. A
// classe é apagada pela migração `v2` do wrangler.jsonc.
//
// Toda a lógica vive em server/core.mjs (compartilhada com a VM Node).

import { dispatch, makeSessions, chaveDoSecret, varrerMantidosDoStore, SESSION_TTL, MAX_BODY_BYTES, RESPOSTA_CORPO_GRANDE } from '../server/core.mjs';

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

// O store das sessões sobre o KV. As chaves ganham o prefixo `sess_` aqui, como
// sempre (a VM faz o mesmo em arquivo), e `list` devolve os nomes SEM ele — o
// que o core usa em `get`/`delete`. `list` é a única operação nova, e só a
// varredura do «Manter conectado» a usa: o KV pagina de 1.000 em 1.000 chaves, e
// cada página é uma operação (teto de 5, ou seja 5.000 entradas, muito além do
// que o plano grátis aguenta renovar).
const PREFIXO_DO_STORE = 'sess_';
const PAGINAS_DA_LISTA = 5;
function storeDoKv(env) {
  return {
    get: (h) => env.SESSIONS.get(PREFIXO_DO_STORE + h),
    put: (h, blob, ttl) => env.SESSIONS.put(PREFIXO_DO_STORE + h, blob, { expirationTtl: ttl || SESSION_TTL }),
    delete: (h) => env.SESSIONS.delete(PREFIXO_DO_STORE + h),
    async list(prefixo) {
      const nomes = [];
      let cursor;
      for (let pagina = 0; pagina < PAGINAS_DA_LISTA; pagina++) {
        const r = await env.SESSIONS.list({ prefix: PREFIXO_DO_STORE + prefixo, ...(cursor ? { cursor } : {}) });
        for (const k of r.keys || []) nomes.push(String(k.name).slice(PREFIXO_DO_STORE.length));
        if (r.list_complete !== false || !r.cursor) break;
        cursor = r.cursor;
      }
      return nomes;
    },
  };
}

export default {
  // O Cron Trigger do wrangler.jsonc (a cada 30 min): renova o cookie do Waze das
  // sessões que ligaram «Manter conectado». O que fazer, em que ritmo e a conta
  // das operações de KV estão em `server/manter-conectado.mjs`. Nunca lança — o
  // cron que falha não pode virar alarme —, e o resumo (só contagens, nenhum dado
  // de pessoa) vai pro log do Worker, o único lugar onde `console` é permitido.
  async scheduled(event, env, ctx) {
    const tarefa = (async () => {
      // Sair calado esconderia a pane: uma chave ruim é indistinguível de «o Cron não disparou» (R28-6-05).
      // Só texto fixo — nada da chave, do KV ou de pessoa vai pro log.
      if (!env || !env.ENCRYPTION_KEY || !env.SESSIONS) { console.error('manter-conectado: sem ENCRYPTION_KEY ou sem o KV SESSIONS'); return null; }
      const { keyBytes, problema } = chaveDoSecret(env.ENCRYPTION_KEY);
      if (problema) { console.error('manter-conectado: ENCRYPTION_KEY inválida'); return null; }
      try {
        const resumo = await varrerMantidosDoStore({ store: storeDoKv(env), keyBytes });
        console.log('manter-conectado', JSON.stringify(resumo));
        return resumo;
      } catch (err) {
        console.error('manter-conectado falhou:', err && err.message);
        return null;
      }
    })();
    // Sem o `waitUntil` o runtime corta a promessa quando o handler retorna.
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(tarefa);
    return tarefa;
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'POST') {
        return json({ success: false, error: 'Método não permitido' }, 405);
      }
      if (!env.ENCRYPTION_KEY || !env.SESSIONS) {
        return json({ success: false, error: 'Backend não configurado (falta KV SESSIONS ou Secret ENCRYPTION_KEY)' }, 500);
      }
      // A chave que não serve (base64 quebrado, ou menos de 32 bytes) é o mesmo
      // "não configurado", com o motivo — a mesma régua da VM, que recusa no
      // boot (`chaveDoSecret`, no core). Curta, ela funcionava calada: 3 bytes
      // cifravam sessões (auditoria de 2026-09-29). Quebrada, o `atob` lançava
      // e a resposta era o "Erro interno" genérico.
      const { keyBytes, problema: problemaDaChave } = chaveDoSecret(env.ENCRYPTION_KEY);
      if (problemaDaChave) {
        return json({ success: false, error: `Backend não configurado (${problemaDaChave})` }, 500);
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

        // O try/catch em volta segue valendo pro resto: sem ele, uma exceção
        // aqui devolveria a página HTML 1101 do Cloudflare em vez de JSON.
        const store = storeDoKv(env);
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
