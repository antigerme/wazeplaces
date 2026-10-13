// A presença e a conversa depois da auditoria da rodada 16 (R16-5-01 a R16-5-04).
// Os rótulos são os do relatório dessa rodada. Cada teste foi visto REPROVANDO
// com o conserto desfeito (as sabotagens estão no relatório do lote).
//
// O instrumento é o js/presenca.js INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs`, como nas rodadas anteriores; o servidor é o `dispatch`
// do core com um Waze de mentira (ver `test/presenca-app.test.mjs`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';
import { dispatch } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const EU = '12444348';
const CAF = '183164343';

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo real.
const chega = async (c, n) => c.P.presencaQuadro(fluxoDe(c), { inboxMessage: { messageId: uuid(900000 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pedidos = (c, desde = 0) => c.chamadas.chat.slice(desde).map((x) => x.acao + (x.com ? ':' + x.com : ''));
const lidaAte = (c) => (c.P.Presenca.lidaEnviadaAte.get(CAF) || 0) - T;
const FALHA = { success: false, errorCategory: 'transient', error: 'x', httpCode: 500 };
const SEM_RESPOSTA = { success: false, errorCategory: 'transient', error: 'x', _motivo: 'TypeError' };
const NAO_AUTORIZADO = { success: false, errorCategory: 'unauthorized', error: 'x', httpCode: 401 };

// ── R16-5-01: a mensagem que a pílula contava e a tela NUNCA mostrou ─────────
// A primeira página (o `abrir`) falha. A contagem da pílula é zerada na abertura,
// antes de saber se ele deu certo, e o "lida" que o lote 19 passou a mandar no
// fechamento marca a conversa INTEIRA no Waze: a mensagem 2, que chegou antes da
// abertura e a tela de erro não mostrou, virava "Lida" pra quem a mandou e sumia
// da pílula — o que a regra do R7-5-01 proíbe.
async function aberturaQueFalha(falha, { antesDeAbrir = true } = {}) {
  // O que o Waze conta como não lido: a lista que o app pedir depois diz isto.
  const servidor = { naoLidas: 0, ts: 0 };
  const c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => ({ success: true, agora: c.relogio.agora, online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas: servidor.naoLidas, atividade: T + servidor.ts,
      ultima: { deMim: false, ts: T + servidor.ts, recibo: false, texto: 'x', card: null } }] }),
    chat: (x) => (x.acao === 'abrir' ? falha : { success: true }) } });
  c.P.presencaMontar();
  if (antesDeAbrir) { c.relogio.agora = T + 2000; await chega(c, 2); }     // chega com a conversa FECHADA
  const naoLidasAntes = c.P.presencaNaoLidasDe(CAF);
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  const html = () => c.$('conversaMsgs').innerHTML;
  const noErro = html().includes('presenca.conversa.erro');
  const viuA2 = html().includes('msg 2');
  c.relogio.agora = T + 3000; await chega(c, 3); await tick();             // chega com a conversa NA TELA
  const viuA3 = html().includes('msg 3');
  const a0 = c.chamadas.chat.length;
  c.relogio.agora = T + 4000; fechar(c); await tick(); await tick();
  return { c, servidor, naoLidasAntes, noErro, viuA2, viuA3, noFechamento: pedidos(c, a0) };
}

for (const [nome, falha] of [['com resposta (500)', FALHA], ['sem resposta (rede)', SEM_RESPOSTA], ['401', NAO_AUTORIZADO]]) {
  test(`R16-5-01 a primeira página falha ${nome}: o fechamento NÃO marca como lida a mensagem que a tela nunca mostrou`, async () => {
    const r = await aberturaQueFalha(falha);
    assert.equal(r.naoLidasAntes, 1, 'CONTROLE: a pílula contava a mensagem 2 antes de abrir');
    assert.equal(r.noErro, true, 'CONTROLE: a tela diz que a conversa não carregou');
    assert.equal(r.viuA2, false, 'CONTROLE: a mensagem 2 NÃO está na tela');
    assert.equal(r.viuA3, true, 'CONTROLE: a mensagem 3, que chegou com a conversa na tela, está');
    assert.deepEqual(r.noFechamento, [], 'DEFEITO: o "lida" do fechamento marcou no Waze a conversa inteira, com a mensagem 2 nunca vista');
    assert.equal(lidaAte(r.c) < 0, true, 'a mensagem 2 (ou a 3) foi dada como confirmada como lida');
    assert.equal(r.c.P.Presenca.lidaDevendo.has(CAF), false, 'a dívida do "lida" ficou de pé');
    // No aparelho também: a próxima página a adotaria (sem saber que a primeira
    // página falhou) e pagaria a conversa inteira.
    assert.equal(Object.prototype.hasOwnProperty.call(r.c.guardado().devendo || {}, CAF), false, 'a dívida ficou GUARDADA no aparelho, pra próxima página pagar');
  });
}

test('R16-5-01 a lista seguinte devolve as mensagens não vistas à pílula (o lado seguro)', async () => {
  const r = await aberturaQueFalha(FALHA);
  const c = r.c;
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'CONTROLE: a pílula está zerada depois do fechamento');
  // Nenhum "lida" saiu, então o Waze segue contando as duas.
  r.servidor.naoLidas = 2; r.servidor.ts = 3;
  c.relogio.agora = T + 200000;
  await c.P.presencaAtualizar(); await tick();
  assert.equal(c.P.presencaNaoLidasDe(CAF), 2, 'a pílula não voltou a acusar as mensagens não vistas');
});

test('R16-5-01 CONTROLE: sem nada que a pílula contasse, a mensagem vista ao vivo continua sendo marcada (o R15-5-02 segue)', async () => {
  const r = await aberturaQueFalha(FALHA, { antesDeAbrir: false });
  assert.equal(r.naoLidasAntes, 0, 'CONTROLE: nada antes de abrir');
  assert.equal(r.viuA3, true, 'CONTROLE: a mensagem 3 está na tela');
  assert.deepEqual(r.noFechamento, ['lida:' + CAF], 'a mensagem VISTA ao vivo deixou de ser marcada: o conserto matou o R15-5-02');
  assert.equal(lidaAte(r.c), 3, 'o "lida" não cobriu a mensagem 3');
});

test('R16-5-01 a segunda abertura que também falha lembra da não vista da primeira (vale o MAIOR)', async () => {
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => (x.acao === 'abrir' ? FALHA : { success: true }) } });
  c.P.presencaMontar();
  c.relogio.agora = T + 2000; await chega(c, 2);
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  fechar(c); await tick();
  // A contagem foi zerada na primeira abertura: a segunda já não vê a mensagem 2.
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'CONTROLE: a abertura zerou a contagem da pílula');
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  c.relogio.agora = T + 3000; await chega(c, 3); await tick();
  const a0 = c.chamadas.chat.length;
  c.relogio.agora = T + 4000; fechar(c); await tick(); await tick();
  assert.deepEqual(pedidos(c, a0), [], 'DEFEITO: a segunda abertura esqueceu a mensagem 2 e o "lida" a marcou');
});

test('R16-5-01 a primeira página boa depois da falha limpa a marca — e a mensagem vista volta a ser marcada', async () => {
  let n = 0;
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => {
    if (x.acao !== 'abrir') return { success: true };
    n += 1;
    return n === 1 ? FALHA : { success: true, mensagens: [{ id: uuid(2), ts: T + 2, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'msg 2', recibo: null, contexto: { app: 'wazeplaces' } }], maisAntigas: false, lida: true };
  } } });
  c.P.presencaMontar();
  c.relogio.agora = T + 2000; await chega(c, 2);
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  assert.ok(c.P.Presenca.historico.get(CAF).naoVistoAoAbrir > 0, 'CONTROLE: a abertura que falhou guardou a não vista');
  c.P.presencaCarregarConversa(CAF); await tick(); await tick();           // o "Tentar de novo"
  const h = c.P.Presenca.historico.get(CAF);
  assert.equal(h.primeiraFalhou, false, 'CONTROLE: a primeira página boa limpou a falha');
  assert.equal(h.naoVistoAoAbrir, 0, 'a primeira página boa não limpou a não vista: o fechamento deixaria de marcar a mensagem vista');
  assert.equal(c.$('conversaMsgs').innerHTML.includes('msg 2'), true, 'CONTROLE: a mensagem 2 agora está na tela');
  c.relogio.agora = T + 3000; await chega(c, 3); await tick();
  const a0 = c.chamadas.chat.length;
  c.relogio.agora = T + 4000; fechar(c); await tick(); await tick();
  assert.deepEqual(pedidos(c, a0), ['lida:' + CAF], 'com tudo na tela, a mensagem vista ao vivo tem que ser marcada no fechamento');
});

// A dívida que nasce com a primeira página AINDA NO AR (R14-5-01) e vê a página
// falhar depois: no fechamento a marca da falha ainda não existia.
async function fechadaComAPaginaNoAr({ antesDeAbrir }) {
  const solta = [];
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => (x.acao === 'abrir' ? new Promise((ok) => solta.push(ok)) : { success: true }) } });
  c.P.presencaMontar();
  if (antesDeAbrir) { c.relogio.agora = T + 2000; await chega(c, 2); }
  c.P.presencaAbrirConversa(CAF); await tick();
  c.relogio.agora = T + 3000; await chega(c, 3); await tick();             // chega com o `abrir` no ar
  const a0 = c.chamadas.chat.length;
  c.relogio.agora = T + 4000; fechar(c); await tick(); await tick();
  const aoFechar = pedidos(c, a0);
  const devia = c.P.Presenca.lidaDevendo.has(CAF);
  const guardadaAoFechar = Object.prototype.hasOwnProperty.call(c.guardado().devendo || {}, CAF);
  solta.forEach((ok) => ok(FALHA));                                         // o `abrir` falha
  await tick(); await tick();
  const a1 = c.chamadas.chat.length;
  c.P.presencaPagarDevidas();                                               // o próximo gesto
  await tick(); await tick();
  return { c, aoFechar, devia, guardadaAoFechar, depois: pedidos(c, a1) };
}

test('R16-5-01 a dívida que nasce com a primeira página NO AR e vê a página falhar não paga a mensagem que a tela nunca mostrou', async () => {
  const r = await fechadaComAPaginaNoAr({ antesDeAbrir: true });
  assert.deepEqual(r.aoFechar, [], 'CONTROLE: com a página no ar, o fechamento não paga nada (a dívida espera)');
  assert.equal(r.devia, true, 'CONTROLE: a conversa ficou devendo o "lida" da mensagem 3, vista com a página no ar');
  assert.equal(r.guardadaAoFechar, true, 'CONTROLE: a dívida foi guardada no aparelho ao fechar (é o que a verificação de baixo mede sumir)');
  assert.deepEqual(r.depois, [], 'DEFEITO: a dívida foi paga depois da falha e marcou no Waze a mensagem 2, nunca vista');
  assert.equal(r.c.P.Presenca.lidaDevendo.has(CAF), false, 'a dívida segue de pé para pagar no próximo gesto');
  assert.equal(Object.prototype.hasOwnProperty.call(r.c.guardado().devendo || {}, CAF), false, 'a dívida segue GUARDADA no aparelho: a próxima página a adotaria e pagaria');
});

test('R16-5-01 CONTROLE: a mesma conversa com a página no ar que falha, sem nada que a pílula contasse, paga a mensagem vista', async () => {
  const r = await fechadaComAPaginaNoAr({ antesDeAbrir: false });
  assert.equal(r.devia, true, 'CONTROLE: a conversa ficou devendo');
  assert.deepEqual(r.depois, ['lida:' + CAF], 'o conserto matou o R14-5-01: a mensagem vista ficou sem "lida"');
});

// ── R16-5-04: a dívida guardada paga com o MAIOR entre o guardado e o visto ──
async function dividaGuardadaFechada({ reabrir }) {
  const c = novoCliente({ agora: T + 3000, api: {
    presencaApp: () => ({ success: true, agora: T + 3000, online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas: reabrir === 'sem-guardada' ? 0 : 1, atividade: T + 1000, ultima: reabrir === 'sem-guardada' ? null : { deMim: false, ts: T + 1000, recibo: false, texto: 'x', card: null } }] }),
    chat: (x) => (x.acao === 'abrir' ? FALHA : { success: true }) } });
  // A página anterior fechou devendo (a mensagem 1000 vista); esta a adota na primeira lista.
  c.armazenado.set('waze_places_chat', JSON.stringify({ devendo: reabrir === 'sem-guardada' ? {} : { [CAF]: { ate: T + 1000, n: 1 } } }));
  c.P.presencaMontar();
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  c.relogio.agora = T + 3500; await chega(c, 2000); await tick();           // vista ao vivo, mais nova que a guardada
  const a0 = c.chamadas.chat.length;
  c.relogio.agora = T + 4000; fechar(c); await tick(); await tick();
  const noFechamento = pedidos(c, a0);
  const confirmada = lidaAte(c);
  // Reabre (o `abrir` volta a falhar), nada novo chega, fecha.
  c.relogio.agora = T + 6000;
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  const a1 = c.chamadas.chat.length;
  c.relogio.agora = T + 7000; fechar(c); await tick(); await tick();
  return { noFechamento, confirmada, depois: pedidos(c, a1) };
}

test('R16-5-04 a dívida guardada paga até a mensagem vista ao vivo — e reabrir e fechar sem nada novo não manda OUTRO "lida"', async () => {
  const r = await dividaGuardadaFechada({ reabrir: 'guardada' });
  assert.deepEqual(r.noFechamento, ['lida:' + CAF], 'CONTROLE: o fechamento paga a dívida (um "lida")');
  assert.equal(r.confirmada, 2000, 'DEFEITO: o "lida" confirmado ficou na mensagem guardada (1000), atrás do que o Waze marcou (2000)');
  assert.deepEqual(r.depois, [], 'DEFEITO: reabrir e fechar sem nada novo mandou OUTRO "lida"');
});

test('R16-5-04 CONTROLE: o mesmo roteiro sem a dívida guardada já confirmava a 2000 e não mandava o segundo "lida"', async () => {
  const r = await dividaGuardadaFechada({ reabrir: 'sem-guardada' });
  assert.deepEqual(r.noFechamento, ['lida:' + CAF]);
  assert.equal(r.confirmada, 2000);
  assert.deepEqual(r.depois, []);
});

// ── R16-5-02: o servidor só marca como lida DEPOIS de o histórico voltar bem ─
const COOKIES = [
  '.waze.com\tTRUE\t/\tTRUE\t0\t_csrf_token\tcsrf-de-teste',
  '.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tsessao-de-teste',
].join('\n');

function quadro(flag, corpo) {
  const q = new Uint8Array(5 + corpo.length);
  q[0] = flag;
  new DataView(q.buffer).setUint32(1, corpo.length);
  q.set(corpo, 5);
  return q;
}
function respostaGrpc({ dados = null, status = 0, mensagem = '' } = {}) {
  const trailer = new TextEncoder().encode(`grpc-status:${status}\r\ngrpc-message:${encodeURIComponent(mensagem)}\r\n`);
  const corpo = (dados ? b64(quadro(0, dados)) : '') + b64(quadro(0x80, trailer));
  return new Response(corpo, { status: 200, headers: { 'content-type': 'application/grpc-web-text+proto' } });
}
// O Waze de mentira responde por MÉTODO e anota a ordem em que os pedidos SAÍRAM.
async function comWaze(responder, fn) {
  const original = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (url) => {
    const metodo = String(url).split('/').pop();
    pedidos.push(metodo);
    return responder(metodo);
  };
  try { return { resultado: await fn(), pedidos }; } finally { globalThis.fetch = original; }
}

test('R16-5-02 o histórico que FALHA não deixa o "lida" sair: a conversa não fica marcada no Waze enquanto a tela diz que não carregou', async () => {
  const S = await sessaoDeTeste(COOKIES);
  for (const [nome, resp] of [
    ['indisponível (14)', () => respostaGrpc({ status: 14, mensagem: 'unavailable' })],
    ['sessão morta (16)', () => respostaGrpc({ status: 16, mensagem: '' })],
  ]) {
    const r = await comWaze((m) => (m === 'ListMessages' ? resp() : respostaGrpc({})),
      () => dispatch('chat', { ...S.dados, region: 'row', acao: 'abrir', com: CAF }, S.ctx));
    assert.notEqual(r.resultado.status, 200, `${nome}: CONTROLE: o histórico falhou e a resposta é erro`);
    assert.deepEqual(r.pedidos, ['ListMessages'], `${nome}: DEFEITO: o MarkConversationRead saiu mesmo com o histórico falhando`);
  }
});

test('R16-5-02 o histórico que vem com lixo (protobuf quebrado) também não deixa o "lida" sair', async () => {
  const S = await sessaoDeTeste(COOKIES);
  const r = await comWaze((m) => (m === 'ListMessages' ? respostaGrpc({ dados: new Uint8Array([0x0a, 0xff, 0x01]) }) : respostaGrpc({})),
    () => dispatch('chat', { ...S.dados, region: 'row', acao: 'abrir', com: CAF }, S.ctx));
  assert.notEqual(r.resultado.status, 200, 'CONTROLE: o histórico ilegível é erro');
  assert.deepEqual(r.pedidos, ['ListMessages'], 'o "lida" saiu depois de um histórico que não deu pra ler');
});

test('R16-5-02 CONTROLE: com o histórico bom os dois pedidos saem, o "lida" DEPOIS, e a resposta diz `lida: true`', async () => {
  const S = await sessaoDeTeste(COOKIES);
  const r = await comWaze((m) => respostaGrpc({ dados: new Uint8Array() }),
    () => dispatch('chat', { ...S.dados, region: 'row', acao: 'abrir', com: CAF }, S.ctx));
  assert.equal(r.resultado.status, 200, JSON.stringify(r.resultado.body));
  assert.deepEqual(r.pedidos, ['ListMessages', 'MarkConversationRead'], 'a ordem é o histórico, depois o "lida"');
  assert.equal(r.resultado.body.lida, true);
  // E o "lida" que falha (histórico bom) segue sem derrubar o histórico.
  const semLida = await comWaze((m) => (m === 'ListMessages' ? respostaGrpc({}) : respostaGrpc({ status: 14, mensagem: 'unavailable' })),
    () => dispatch('chat', { ...S.dados, region: 'row', acao: 'abrir', com: CAF }, S.ctx));
  assert.equal(semLida.resultado.status, 200);
  assert.equal(semLida.resultado.body.lida, false);
  // A página antiga continua sem "lida" nenhum.
  const antiga = await comWaze(() => respostaGrpc({}),
    () => dispatch('chat', { ...S.dados, region: 'row', acao: 'abrir', com: CAF, antesDe: 1790182220160 }, S.ctx));
  assert.deepEqual(antiga.pedidos, ['ListMessages']);
});

test('R16-5-02 em série os dois não cabem no teto cheio: o "lida" tem teto PRÓPRIO e a soma cabe nos 45 s do cliente', async () => {
  const core = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
  const { WAZE_ESPERA_MS, ABRIR_LIDA_ESPERA_MS } = await import('../server/core.mjs');
  const api = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
  const m = /async _post\([\s\S]*?controller\.abort\(\), (\d+)\)/.exec(api);
  assert.ok(m, 'não achei o teto do cliente no api.js — o instrumento quebrou, não a regra');
  const cliente = Number(m[1]);
  assert.match(core, /async function callWazeGrpc\([^)]*tetoMs = WAZE_ESPERA_MS/, 'o callWazeGrpc não aceita um teto por chamada');
  assert.match(core, /controller\.abort\(\), tetoMs\)/, 'o timer do callWazeGrpc não usa o teto da chamada');
  const abrir = core.slice(core.indexOf('async function abrirConversa('), core.indexOf('// O teto do corpo de uma requisição'));
  assert.match(abrir, /MarkConversationRead[^]*tetoMs: ABRIR_LIDA_ESPERA_MS/, 'o "lida" do `abrir` não leva o teto próprio');
  assert.ok(WAZE_ESPERA_MS + ABRIR_LIDA_ESPERA_MS + 3000 <= cliente,
    `histórico (${WAZE_ESPERA_MS} ms) + "lida" (${ABRIR_LIDA_ESPERA_MS} ms) em série, sem folga nos ${cliente} ms do cliente`);
});

test('R16-5-02 o "lida" preso responde no teto DELE, e o histórico chega: `lida: false`, sem esperar o teto cheio', async () => {
  // Os prazos do core andam 20× mais rápido aqui (só os de 1 s pra cima): 10 s
  // viram 500 ms e 30 s viram 1,5 s, e a pergunta é QUAL dos dois segurou a rota.
  const { WAZE_ESPERA_MS, ABRIR_LIDA_ESPERA_MS } = await import('../server/core.mjs');
  const ESCALA = 20;
  const setTimeoutReal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => setTimeoutReal(fn, ms >= 1000 ? ms / ESCALA : ms, ...a);
  const original = globalThis.fetch;
  try {
    const S = await sessaoDeTeste(COOKIES);
    const pedidos = [];
    globalThis.fetch = (url, init) => {
      const metodo = String(url).split('/').pop();
      pedidos.push(metodo);
      if (metodo === 'ListMessages') return Promise.resolve(respostaGrpc({}));
      return new Promise((ok, erro) => { init.signal.addEventListener('abort', () => erro(new DOMException('aborted', 'AbortError'))); });
    };
    const t0 = Date.now();
    const r = await dispatch('chat', { ...S.dados, region: 'row', acao: 'abrir', com: CAF }, S.ctx);
    const levou = Date.now() - t0;
    assert.deepEqual(pedidos, ['ListMessages', 'MarkConversationRead'], 'CONTROLE: os dois saíram, em série');
    assert.equal(r.status, 200, `o histórico bom foi perdido por causa do "lida" preso: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.lida, false, 'o "lida" não voltou e a resposta não diz');
    const dela = ABRIR_LIDA_ESPERA_MS / ESCALA, cheio = WAZE_ESPERA_MS / ESCALA;
    assert.ok(levou < (dela + cheio) / 2, `o "lida" preso segurou a rota ${levou} ms — era o teto dele (${dela} ms escalados), não o cheio (${cheio})`);
  } finally {
    globalThis.setTimeout = setTimeoutReal;
    globalThis.fetch = original;
  }
});

// ── R16-5-03: a lista encolhe por outro motivo que o redesenho ───────────────
// O teclado virtual sobe ao tocar no campo (`--kb-inset`), e o foco do campo no
// `presencaAnexarCard` faz o mesmo: a caixa da lista encolhe e a rolagem não
// acompanhava — a última bolha ficava 238 px abaixo da área visível (390x440,
// nos dois motores). Medido no navegador pelo smoke da presença (seção 6b).
function conversaAberta({ rolado }) {
  const c = novoCliente({ agora: T + 10, api: { chat: () => ({ success: true, mensagens: [], maisAntigas: false, lida: true }) } });
  c.P.presencaMontar();
  const corpo = c.$('conversaMsgs');
  corpo.scrollHeight = 1000;
  corpo.clientHeight = 384;
  corpo.scrollTop = rolado === 'fim' ? 1000 - 384 : 120;
  c.redimensionar(corpo);                         // a primeira notificação do navegador (ao abrir)
  c.P.Presenca.aberta = CAF;
  return { c, corpo };
}

test('R16-5-03 a lista encolhe (o teclado sobe) com a conversa no fim: continua no fim — a última mensagem não fica cortada', () => {
  const { c, corpo } = conversaAberta({ rolado: 'fim' });
  assert.ok(c.observadores.some((o) => o.alvos.includes(corpo)), 'CONTROLE: ninguém observa a caixa da lista');
  corpo.clientHeight = 146;                       // o teclado ocupou o resto
  c.redimensionar(corpo);
  assert.equal(corpo.scrollTop, 1000, 'DEFEITO: a lista encolheu e a rolagem ficou onde estava — a última bolha ficou abaixo da área visível');
});

test('R16-5-03 CONTROLE: quem lia o começo da conversa não é arrancado pro fim quando o teclado sobe', () => {
  const { c, corpo } = conversaAberta({ rolado: 'meio' });
  corpo.clientHeight = 146;
  c.redimensionar(corpo);
  assert.equal(corpo.scrollTop, 120, 'quem lia o começo foi levado ao fim');
});

test('R16-5-03 a folga é medida com a altura de ANTES de encolher (a 79 px do fim ainda conta como no fim; a 81, não)', () => {
  for (const [folga, noFim] of [[79, true], [81, false]]) {
    const { c, corpo } = conversaAberta({ rolado: 'meio' });
    corpo.scrollTop = 1000 - 384 - folga;
    const ficou = corpo.scrollTop;
    corpo.clientHeight = 146;
    c.redimensionar(corpo);
    assert.equal(corpo.scrollTop, noFim ? 1000 : ficou, `a ${folga} px do fim`);
  }
});

test('R16-5-03 a lista que CRESCE (o teclado desce) não rola nada', () => {
  const { c, corpo } = conversaAberta({ rolado: 'fim' });
  corpo.clientHeight = 500;
  c.redimensionar(corpo);
  assert.equal(corpo.scrollTop, 1000 - 384, 'a lista que cresceu foi rolada');
});

test('R16-5-03 a conversa escondida (altura 0, o modal fechou) não rola nada', () => {
  const { c, corpo } = conversaAberta({ rolado: 'fim' });
  corpo.clientHeight = 0;
  c.redimensionar(corpo);
  assert.equal(corpo.scrollTop, 1000 - 384, 'a conversa escondida foi rolada');
});

test('R16-5-03 sem conversa aberta o observador não mexe na rolagem', () => {
  const { c, corpo } = conversaAberta({ rolado: 'fim' });
  c.P.Presenca.aberta = null;
  corpo.clientHeight = 146;
  c.redimensionar(corpo);
  assert.equal(corpo.scrollTop, 1000 - 384, 'sem conversa aberta o observador mexeu na rolagem');
});
