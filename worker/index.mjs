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
import { calcularStatusPublico } from '../server/status.mjs';

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

// A chave RAW do blob público (/status.html), FORA do namespace `sess_` das
// sessões — reaproveitar `storeDoKv` aqui faria o próprio blob aparecer na
// PRÓXIMA contagem (um `sess_status_publico` de 64+ bytes não casa com nenhum
// dos dois formatos que `contarChaves` reconhece, então não inflaria a
// contagem — mas é limpo demais pra depender disso: fica fora do namespace
// mesmo, por decisão, não por sorte de regex).
const STATUS_CHAVE_KV = 'status_publico';

// A contagem roda DEPOIS do «Manter conectado» terminar — nunca em paralelo —
// porque soma UM `list` (+ o `get`/`put` do próprio blob) ao orçamento de
// subrequisições da MESMA execução (o comentário de orçamento em
// manter-conectado.mjs já mede até 53–55 no pior caso, sob o teto de 50;
// isto não pode competir pelas operações que a renovação de verdade precisa).
// Nunca lança — falha aqui não pode derrubar nem atrasar a renovação.
async function atualizarStatusPublico(env) {
  try {
    const brutoAnterior = await env.SESSIONS.get(STATUS_CHAVE_KV);
    let anterior = null;
    try { anterior = brutoAnterior ? JSON.parse(brutoAnterior) : null; } catch { anterior = null; }
    const { blob, mudou } = await calcularStatusPublico({ listar: (p) => storeDoKv(env).list(p), anterior });
    // Grava quando a contagem mudou OU faz tempo demais que não grava (o
    // heartbeat de STATUS_ATUALIZACAO_MAX_MIN, ver server/status.mjs): a
    // escrita de KV é cota escassa (1.000/dia), dividida com o app e com o
    // «Manter conectado», mas pular SEMPRE que nada muda congela o
    // "atualizado há" por horas numa página que promete "dados ao vivo".
    if (mudou) await env.SESSIONS.put(STATUS_CHAVE_KV, JSON.stringify(blob));
    return { sessoesAtivas: blob.sessoesAtivas, manterConectado: blob.manterConectado, gravou: mudou };
  } catch (err) {
    console.error('status-publico falhou:', err && err.message);
    return null;
  }
}

function statusStoreDoKv(env) {
  return {
    get: () => env.SESSIONS.get(STATUS_CHAVE_KV),
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
      let resumo = null;
      try {
        resumo = await varrerMantidosDoStore({ store: storeDoKv(env), keyBytes });
        console.log('manter-conectado', JSON.stringify(resumo));
      } catch (err) {
        console.error('manter-conectado falhou:', err && err.message);
      }
      // SEQUENCIAL, depois da renovação — nunca em paralelo (ver o comentário
      // de `atualizarStatusPublico`). Roda mesmo se a renovação falhou: a
      // contagem de chaves não depende dela ter dado certo. NUNCA muda o que
      // esta função devolve — a contagem é um efeito colateral best-effort,
      // fora do contrato de retorno da renovação (que os testes conferem).
      await atualizarStatusPublico(env);
      return resumo;
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
        const { status, body } = await dispatch(route, data, { sessions, aoFundo, statusStore: statusStoreDoKv(env) });
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
