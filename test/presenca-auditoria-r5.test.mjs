// A presença e a conversa depois da auditoria de 2026-09-30 (rodada 5, R5-5):
// o "Lida" na corrida do `abrir` (V2, V2b e V3) e a resposta que chega e não é
// JSON. Os rótulos R5-5-n são os do relatório dessa rodada.
//
// Mesmo instrumento dos outros: o js/presenca.js roda INTEIRO no navegador de
// mentira do `_presenca-cliente.mjs`, e o api.js de verdade roda numa `vm`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { novoCliente, bytesDeMensagem, bytesDeRecibo, b64 } from './_presenca-cliente.mjs';

const EU = '12444348';
const CAF = '183164343';
const APP = { app: 'wazeplaces' };
const T = 1790300000000;
const tick = () => new Promise((r) => setImmediate(r));
const uuid = (n) => `a0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const inbox = (bytes, n = 1) => ({ inboxMessage: { messageId: uuid(900 + n), messageType: 'X', message: b64(bytes) } });
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
const conversa = (id, nome, atividade, naoLidas = 0) => ({ id, nome, naoLidas, atividade, ultima: null });
// Uma mensagem como o servidor a devolve no `abrir`.
const doWaze = (n, ts, de, texto = 'oi') => ({ id: uuid(n), ts, de: { tipo: 1, id: de }, para: { tipo: 1, id: de === EU ? CAF : EU },
  classe: 'texto', texto, contexto: APP });
const lidas = (c) => c.chamadas.chat.filter((x) => x.acao === 'lida');
const abrirs = (c) => c.chamadas.chat.filter((x) => x.acao === 'abrir');
// Uma promessa que o teste solta quando quer (a resposta "no ar").
function noAr() { let ok; const p = new Promise((r) => { ok = r; }); return { p, ok }; }

// ── R5-5-1: o "Lida" na corrida do `abrir` ──────────────────────────────────

test('R5-5-1 V3: o "lida" do `abrir` não cobre a mensagem guardada com ele NO AR — a rajada a marca (um pedido, só na corrida)', async () => {
  // O servidor lê o histórico e marca como lida EM PARALELO: a mensagem M,
  // guardada depois de o pedido SAIR (T), vem no histórico sem ter sido marcada.
  const caso = async (tsM) => {
    const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
      ? { success: true, mensagens: [doWaze(1, T - 60000, CAF, 'antiga'), doWaze(2, tsM, CAF, 'M')], maisAntigas: false, lida: true }
      : { success: true }) } });
    c.P.presencaAbrirConversa(CAF);
    await tick();
    assert.equal(c.P.Presenca.historico.get(CAF).carregada, true, 'CONTROLE: o histórico tem que ter chegado');
    await c.rodarTimers();
    await tick();
    return lidas(c).length;
  };
  assert.equal(await caso(T + 300), 1, 'a mensagem guardada com o `abrir` no ar ficou sem "lida": não lida no Waze, e quem mandou nunca vê "Lida"');
  // CONTROLE: M guardada ANTES de o pedido sair — o `abrir` a cobre, e nada a mais sai.
  assert.equal(await caso(T - 300), 0, 'sem corrida, saiu um "lida" a mais');
});

test('R5-5-1 V3: o corte é a SAÍDA do pedido no relógio do Waze (pelo `desvio`)', async () => {
  // Aparelho 2 min ATRASADO: o relógio do Waze está 120 s na frente. M foi
  // guardada 300 ms depois de o pedido sair — no relógio do Waze.
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
    ? { success: true, mensagens: [doWaze(2, T + 120000 + 300, CAF, 'M')], maisAntigas: false, lida: true }
    : { success: true }) } });
  c.P.Presenca.desvio = 120000;
  c.P.presencaAbrirConversa(CAF);
  await tick();
  await c.rodarTimers();
  await tick();
  assert.equal(lidas(c).length, 1, 'com o aparelho atrasado, o corte no relógio DAQUI deixou a mensagem da corrida coberta');
});

test('R5-5-1 V2: o recibo que CITA a minha mensagem pelo id a marca como lida, mesmo com hora anterior à dela', async () => {
  const caso = async (citada) => {
    const c = novoCliente({ agora: T });
    const M = { id: uuid(20), ts: T + 300, meu: true, texto: 'M', estado: 'enviada' };
    c.P.Presenca.historico.set(CAF, { msgs: [M], carregada: true, maisAntigas: false });
    // O "lida" que a outra pessoa fez ao abrir a conversa sai com a hora do PEDIDO (T).
    const recibo = await bytesDeRecibo({ id: uuid(21), de: CAF, para: EU, tipo: 'lida', ids: [citada], ts: T });
    c.P.presencaQuadro(fluxoDe(c), inbox(recibo));
    return c.P.presencaEstadoDaMinha(M, c.P.chatLidaAte(CAF), 0);
  };
  assert.equal(await caso(uuid(20)), 'lida', 'a mensagem citada pelo recibo seguiu "Enviada" (o app só olhava a hora)');
  // CONTROLE: o recibo que NÃO cita a mensagem não a marca (a hora dele é anterior).
  assert.equal(await caso(uuid(99)), 'enviada', 'um recibo que não a cita a marcou como lida');
});

test('R5-5-1 V2b: citada ainda SAINDO, ela vira "Lida" quando a hora do Waze chega — pela resposta do `enviar`', async () => {
  const resposta = noAr();
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'enviar' ? resposta.p : { success: true }) } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true, maisAntigas: false });
  c.P.presencaEnviar('M', null);
  const M = c.P.Presenca.historico.get(CAF).msgs[0];
  assert.equal(M.estado, 'enviando', 'CONTROLE: a mensagem tem que estar saindo');
  const recibo = await bytesDeRecibo({ id: uuid(22), de: CAF, para: EU, tipo: 'lida', ids: [M.id], ts: T });
  c.P.presencaQuadro(fluxoDe(c), inbox(recibo));
  resposta.ok({ success: true, id: M.id, ts: T + 300 });
  await tick();
  assert.equal(M.ts, T + 300, 'CONTROLE: a hora do Waze tem que ter chegado na resposta');
  assert.equal(c.P.presencaEstadoDaMinha(M, c.P.chatLidaAte(CAF), 0), 'lida', 'a citada que estava saindo não virou "Lida" com a hora do Waze');
});

test('R5-5-1 V2b: citada ainda SAINDO, ela vira "Lida" quando a hora do Waze chega — pelo eco do tempo real', async () => {
  const resposta = noAr();   // a resposta do `enviar` NÃO chega neste teste: só o eco
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'enviar' ? resposta.p : { success: true }) } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true, maisAntigas: false });
  c.P.presencaEnviar('M', null);
  const M = c.P.Presenca.historico.get(CAF).msgs[0];
  const recibo = await bytesDeRecibo({ id: uuid(23), de: CAF, para: EU, tipo: 'lida', ids: [M.id], ts: T });
  c.P.presencaQuadro(fluxoDe(c), inbox(recibo, 1));
  const eco = await bytesDeMensagem({ id: M.id, de: EU, para: CAF, texto: 'M', ctx: APP, ts: T + 300 });
  c.P.presencaQuadro(fluxoDe(c), inbox(eco, 2));
  assert.equal(M.estado, 'enviada', 'CONTROLE: o eco tem que ter virado a mensagem pra "enviada"');
  assert.equal(c.P.presencaEstadoDaMinha(M, c.P.chatLidaAte(CAF), 0), 'lida', 'a citada que estava saindo não virou "Lida" com o eco');
  resposta.ok({ success: true, id: M.id, ts: T + 300 });
  await tick();
});

// ── R5-5-3: a resposta que CHEGA e não é JSON ───────────────────────────────

// O api.js DE VERDADE numa vm, com o `fetch` que o teste escolhe.
function apiDeVerdade(fetch) {
  const fonte = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8') + '\n'
    + readFileSync(new URL('../js/api.js', import.meta.url), 'utf8') + '\nthis.API = API;';
  const ctx = { navigator: { language: 'pt-BR', onLine: true }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (k === 'waze_session_token' ? 'tok' : null), setItem() {}, removeItem() {} },
    fetch, performance, AbortController, Response, ReadableStream, console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  let provas = 0;
  ctx.API.aoProvarRede = () => { provas += 1; };
  return { API: ctx.API, provas: () => provas };
}
const HTML_502 = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>error code: 502</body></html>';
const HTML_429 = '<!DOCTYPE html><html><body>Error 1027: This website has been temporarily rate limited</body></html>';

test('R5-5-3 o `_post` de verdade: a resposta que CHEGA e não é JSON não leva `_motivo` — só a que não chegou', async () => {
  for (const [status, corpo] of [[502, HTML_502], [429, HTML_429]]) {
    const a = apiDeVerdade(async () => new Response(corpo, { status, headers: { 'content-type': 'text/html' } }));
    const r = await a.API.chat({ acao: 'enviar' });
    assert.equal(r.errorCategory, 'transient', `HTTP ${status} HTML deixou de ser transiente`);
    assert.equal('_motivo' in r, false, `HTTP ${status} HTML (a resposta CHEGOU) veio marcado como "sem resposta"`);
    // A fila de saída lê `httpCode` como o status do WAZE pra aquele pedido
    // (um 5xx a manda pro fim e conta tentativa): o da borda não pode entrar.
    assert.equal('httpCode' in r, false, 'o status da BORDA entrou como `httpCode` — a fila de saída o leria como o Waze recusando o pedido');
    assert.equal(a.provas(), 0, 'a resposta não-JSON passou a contar como prova de rede (o comportamento de antes era não contar)');
    const reg = a.API.chamadas.slice(-1)[0];
    assert.equal(reg && reg.http, status, 'o registro de chamadas perdeu o status real');
  }
  // CONTROLES: a que não chegou segue marcada — o `fetch` que falha e o corpo cortado no meio.
  const semRede = apiDeVerdade(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(typeof (await semRede.API.chat({ acao: 'enviar' }))._motivo, 'string', 'a falha sem resposta perdeu o `_motivo`');
  const cortado = apiDeVerdade(async () => new Response(new ReadableStream({ start(c) { c.error(new TypeError('network error')); } }), { status: 200 }));
  assert.equal(typeof (await cortado.API.chat({ acao: 'enviar' }))._motivo, 'string', 'o corpo cortado no meio deixou de ser "sem resposta"');
});

test('R5-5-3 de ponta a ponta: com o HTML da borda, a conversa diz "Não enviada." e a lista obedece ao teto de um por minuto', async () => {
  const borda = apiDeVerdade(async () => new Response(HTML_502, { status: 502, headers: { 'content-type': 'text/html' } }));
  const resposta = await borda.API.presencaApp({ pais: 30 });
  // A frase: o que o `_post` devolve vai pra conversa.
  const c = novoCliente({ api: { chat: () => resposta } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true, maisAntigas: false });
  c.P.presencaEnviar('teste', null);
  await tick();
  const m = c.P.Presenca.historico.get(CAF).msgs[0];
  assert.equal(m.estado, 'falhou');
  assert.equal(m.motivo, 'erro', 'com a rede boa e a borda respondendo 502, a conversa disse "sem conexão"');
  // O teto: 4 voltas do segundo plano em 40 s, com a lista respondendo o HTML.
  const d = novoCliente({ api: { presencaApp: () => resposta } });
  d.P.Presenca.chat = { token: 't', base: 'https://x/', chave: 'k', expiraEm: d.relogio.agora + 86_000_000 };
  for (let i = 0; i < 4; i++) { d.P.presencaAoVoltar(); await tick(); await tick(); d.relogio.agora += 10_000; }
  assert.equal(d.chamadas.presencaApp.length, 1, 'com o HTML da borda, cada volta do segundo plano pediu a lista de novo');
});

test('R5-5-3 os leitores de `_motivo` são só os da presença (conferidos acima) — leitor novo passa por aqui', () => {
  // A marca mudou de sentido pra resposta não-JSON: quem a lê precisa ter sido
  // conferido. Hoje são três na presença (pelo `presencaSemResposta`) e o
  // desligar da presença no WME; o `api.js` só a escreve.
  const leitores = [];
  for (const arq of ['api.js', 'app.js', 'presenca.js', 'i18n.js', 'swipe.js', 'mapa.js', 'qr.js', 'sw-register.js', 'version.js']) {
    let fonte;
    try { fonte = readFileSync(new URL('../js/' + arq, import.meta.url), 'utf8'); } catch (e) { continue; }
    fonte.split('\n').forEach((l, i) => {
      if (/^\s*\/\//.test(l) || !/_motivo/.test(l)) return;
      leitores.push(`${arq}:${/_motivo:/.test(l) ? 'escreve' : 'lê'}`);
    });
  }
  assert.deepEqual(leitores.sort(), ['api.js:escreve', 'app.js:lê', 'presenca.js:lê'].sort(),
    `apareceu um leitor (ou escritor) novo de \`_motivo\`: ${leitores.join(', ')} — confira se ele quer "a resposta NEM chegou"`);
});
