// A presença e a conversa depois da auditoria de 2026-09-26: a lista "Triando
// agora", a pílula do cabeçalho, o chat do WME e o tempo real.
//
// Mesmo instrumento do `presenca-cliente.test.mjs`: o js/presenca.js roda
// INTEIRO no navegador de mentira do `_presenca-cliente.mjs`, e cada teste
// passa pelo caminho que o app percorre de verdade (o toque, a resposta que
// chega, o timer que dispara). Cada um nasceu de um cenário que REPRODUZIA o
// defeito, e cada um carrega o CONTROLE que prova que ele distingue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { novoCliente } from './_presenca-cliente.mjs';

const EU = '12444348';
const CAF = '183164343';
const tick = () => new Promise((r) => setImmediate(r));
const conversa = (id, nome, atividade, naoLidas = 0, ultima = null) => ({ id, nome, naoLidas, atividade, ultima });
const daCaf = (n, ts) => ({ id: `a0000000-0000-1000-8000-${String(n).padStart(12, '0')}`, ts, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU },
  classe: 'texto', texto: 'oi?', contexto: { app: 'wazeplaces' } });

// ── P1: a conversa aberta e lida não volta a contar ─────────────────────────

test('P1 lista: a conversa que a pessoa está OLHANDO fica lida — a lista lida no Waze antes do "lida" não devolve o "1"', async () => {
  // O caminho de verdade: tocar na pílula pede a lista, e logo em seguida a
  // pessoa toca na conversa. A lista foi lida no Waze ANTES de o `abrir` marcar
  // a conversa como lida, e chega com 1.
  let soltar;
  const c = novoCliente({ api: {
    presencaApp: () => new Promise((ok) => { soltar = () => ok({ success: true, online: [], conversas: [conversa(CAF, 'cafanha', 1790200000000, 1)] }); }),
    chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [daCaf(1, 1790200000000)], maisAntigas: false, lida: true } : { success: true }),
  } });
  c.P.presencaMontar();
  c.P.Presenca.conversas = [conversa(CAF, 'cafanha', 1790200000000, 1, { texto: 'oi?', ts: 1790200000000 })];
  c.$('presencaPill').disparar('click');
  c.P.presencaAbrirConversa(CAF);
  await tick();
  soltar();
  await tick(); await tick();
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'a lista velha devolveu a não lida da conversa aberta e lida');
  assert.equal(c.$('presencaPill').classList.contains('hidden'), true, 'a pílula anunciou "1 mensagem nova" com a mensagem na tela');
  // CONTROLE: a MESMA lista com a conversa fora da vista conta — senão o teste
  // passaria com um conserto que apaga toda não lida.
  c.$('conversaModal').classList.add('hidden');
  c.P.presencaAplicarLista({ online: [], conversas: [conversa(CAF, 'cafanha', 1790200000000, 1)] }, Date.now(), 30, 'pedido');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'CONTROLE: com a conversa escondida a não lida tem que contar');
  // E com o app no segundo plano (conversa aberta, ninguém olhando), idem.
  c.$('conversaModal').classList.remove('hidden');
  c.doc.visibilityState = 'hidden';
  c.P.presencaAplicarLista({ online: [], conversas: [conversa(CAF, 'cafanha', 1790200000000, 1)] }, Date.now(), 30, 'pedido');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'CONTROLE: com a tela apagada não é leitura');
});

test('P1 lida: o "lida" que DÁ CERTO zera a contagem e a pílula — o que chegou com a tela apagada não fica pra sempre', async () => {
  // Conversa aberta, app no segundo plano, chega mensagem (vira não lida: com a
  // tela apagada não é leitura). A pessoa volta: o "lida" sai e dá certo.
  let responde = { success: true };
  const c = novoCliente({ api: { chat: () => responde } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [{ id: 'm1', ts: 1790200000000, meu: false, texto: 'oi?' }], carregada: true, maisAntigas: false });
  c.P.Presenca.conversas = [conversa(CAF, 'cafanha', 1790200000000, 1)];
  c.P.Presenca.vivas.set(CAF, { n: 1, ultimaTs: c.relogio.agora - 1000 });
  c.P.presencaRenderPilula();
  assert.equal(c.$('presencaCount').textContent, '2', 'CONTROLE: a pílula começa contando');
  // CONTROLE: o "lida" que FALHA não zera nada (o Waze segue contando).
  responde = { success: false, errorCategory: 'transient' };
  await c.P.presencaMarcarLida(CAF);
  assert.equal(c.P.presencaNaoLidasDe(CAF), 2, 'o "lida" que falhou zerou a contagem');
  responde = { success: true };
  await c.P.presencaMarcarLida(CAF);
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'o "lida" deu certo e a contagem ficou');
  assert.equal(c.$('presencaPill').classList.contains('hidden'), true, 'a pílula seguiu dizendo "mensagem nova"');
});

test('P1 lida: a mensagem que chega DEPOIS de o "lida" sair, com a conversa fechada no meio, continua não lida', async () => {
  let soltar;
  const c = novoCliente({ api: { chat: () => new Promise((ok) => { soltar = ok; }) } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [{ id: 'm1', ts: 1790200000000, meu: false, texto: 'oi?' }], carregada: true });
  c.P.Presenca.conversas = [conversa(CAF, 'cafanha', 1790200000000, 0)];
  const p = c.P.presencaMarcarLida(CAF);
  c.relogio.agora += 500;
  // Fechou a conversa, e chegou mensagem nova com o "lida" no ar.
  c.$('conversaModal').classList.add('hidden');
  c.P.Presenca.vivas.set(CAF, { n: 1, ultimaTs: c.relogio.agora });
  soltar({ success: true });
  await p;
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'o "lida" apagou a mensagem que chegou depois dele');
});

test('P1 volta pra tela: nada novo a marcar, mas a lista velha que chegou com o app no fundo não fica na pílula', async () => {
  // A lista lida no Waze antes do `abrir` chegou com o app no segundo plano
  // (ninguém olhando, então ela conta). Na volta, o "lida" não tem o que marcar
  // — o `abrir` já marcou até a última dela —, e a contagem velha ficava.
  const T = 1790200000000;
  const c = novoCliente({ api: { chat: () => ({ success: true }) } });
  c.P.Presenca.chat = { token: 't', base: 'https://x/', chave: 'k', expiraEm: c.relogio.agora + 864e5 };
  c.P.Presenca.fluxo = { ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: c.relogio.agora, vivoEm: c.relogio.agora };
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [{ id: 'm1', ts: T, meu: false, texto: 'oi?' }], carregada: true });
  c.P.Presenca.lidaEnviadaAte.set(CAF, T);          // o `abrir` marcou como lida
  c.doc.visibilityState = 'hidden';
  c.P.presencaAplicarLista({ online: [], conversas: [conversa(CAF, 'cafanha', T, 1)] }, c.relogio.agora, 30, 'pedido');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'CONTROLE: com o app no fundo a lista conta');
  c.doc.visibilityState = 'visible';
  c.P.presencaAoVoltar();
  await c.rodarTimers();
  assert.equal(c.chamadas.presencaApp.length, 0, 'CONTROLE: uma lista nova teria zerado sozinha, e o teste não mediria nada');
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'lida').length, 0, 'mandou "lida" sem nada novo a marcar');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'a contagem velha ficou com a conversa aberta, na tela e lida');
  assert.equal(c.$('presencaPill').classList.contains('hidden'), true);
});

// ── P2: o tempo real não fica parado por um token que faltou ────────────────

const GOOGLE = 'https://instantmessaging-pa.googleapis.com/';
const aberto = () => new Promise(() => {});   // o fluxo do Google: aberto, sem fim

test('P2 token na última hora: o fluxo abre com o token que AINDA VALE, e a renovação vai à parte — mesmo voltando sem token', async () => {
  // O Waze recusou o provedor na renovação (`chat: null`). Antes, o fluxo nem
  // tentava abrir na última hora do token: ficava parado com ele valendo.
  const c = novoCliente({ api: { presencaApp: async () => ({ success: true, online: [], conversas: [], chat: null }), fetch: aberto } });
  c.P.Presenca.chat = { token: 'velho', base: GOOGLE, chave: 'k', expiraEm: c.relogio.agora + 30 * 60e3 };
  c.P.Presenca.tokenPedidoEm = c.relogio.agora - 23 * 3600e3;
  c.P.presencaFluxoReagendar(true);        // o fim normal da conexão (o Google fecha a cada ~6 min)
  await c.rodarTimers();
  await tick(); await tick();
  assert.equal(c.chamadas.presencaApp.length, 1, 'a renovação não foi pedida na última hora do token');
  assert.equal(c.chamadas.presencaApp[0].token, true);
  assert.equal(c.chamadas.fetch.length, 1, 'o tempo real ficou parado com um token que ainda valia');
  assert.equal(JSON.parse(c.chamadas.fetch[0][1].body).header.auth_token_payload, 'velho');
  assert.ok(c.P.Presenca.fluxo, 'o fluxo não ficou aberto');
  // CONTROLE: token vencido DE FATO não abre — o Google o recusaria.
  const d = novoCliente({ api: { presencaApp: async () => ({ success: true, online: [], conversas: [], chat: null }), fetch: aberto } });
  d.P.Presenca.chat = { token: 'vencido', base: GOOGLE, chave: 'k', expiraEm: d.relogio.agora - 1 };
  d.P.presencaFluxoReagendar(true);
  await d.rodarTimers();
  await tick();
  assert.equal(d.chamadas.fetch.length, 0, 'CONTROLE: abriu o fluxo com um token vencido');
});

test('P2 provedor vazio na abertura: a prova de rede pede o token de novo depois do teto de 5 min — e o tempo real abre', async () => {
  let n = 0;
  const c = novoCliente({ api: {
    presencaApp: async (campos) => {
      n += 1;
      return { success: true, online: [], conversas: [],
        ...(campos.token ? { chat: n === 1 ? null : { token: 't2', base: GOOGLE, chave: 'k', expiraEm: c.relogio.agora + 864e5 } } : {}) };
    },
    fetch: aberto,
  } });
  await c.P.presencaSincronizar();          // a abertura (o `showMainScreen` e o perfil chegando)
  await tick();
  assert.equal(c.chamadas.presencaApp[0].token, true);
  assert.equal(c.chamadas.fetch.length, 0, 'CONTROLE: sem token o fluxo não abre');
  // Uma ação 1 min depois: a resposta dela prova rede, mas o teto segura.
  c.relogio.agora += 60e3;
  c.P.presencaAoProvarRede();
  await tick();
  assert.equal(c.chamadas.presencaApp.length, 1, 'pediu o token de novo antes do teto de 5 min');
  // Passado o teto, a próxima resposta pede o token — e o fluxo abre com ele.
  c.relogio.agora += 5 * 60e3;
  c.P.presencaAoProvarRede();
  await tick(); await tick();
  assert.equal(c.chamadas.presencaApp.length, 2, 'a prova de rede não pediu o token que faltava');
  assert.equal(c.chamadas.presencaApp[1].token, true);
  assert.equal(c.chamadas.fetch.length, 1, 'o token veio e o tempo real não abriu');
  // Com o fluxo aberto e o token bom, a prova de rede não faz NADA.
  c.relogio.agora += 10 * 60e3;
  c.P.presencaAoProvarRede();
  await tick();
  assert.deepEqual([c.chamadas.presencaApp.length, c.chamadas.fetch.length], [2, 1], 'com tudo de pé, a prova de rede gastou pedido');
});

test('P2 token recusado pelo Google (401): outro é pedido na prova de rede depois do teto — antes não', async () => {
  const c = novoCliente({ api: { fetch: () => new Response('', { status: 401 }),
    presencaApp: async () => ({ success: true, online: [], conversas: [], chat: null }) } });
  c.P.Presenca.chat = { token: 't', base: GOOGLE, chave: 'k', expiraEm: c.relogio.agora + 864e5 };
  c.P.Presenca.tokenPedidoEm = c.relogio.agora - 60e3;   // chegou há 1 min
  await c.P.presencaFluxoAbrir();
  await c.rodarTimers();                                  // o recuo
  await tick();
  assert.equal(c.P.Presenca.chat, null, 'CONTROLE: o 401 descarta o token');
  assert.equal(c.chamadas.presencaApp.length, 0, 'CONTROLE: dentro do teto nada é pedido');
  assert.equal(c.timers.length, 0, 'CONTROLE: e nenhum timer fica de pé (é o buraco que a prova de rede fecha)');
  c.relogio.agora += 5 * 60e3;
  c.P.presencaAoProvarRede();
  await tick();
  assert.equal(c.chamadas.presencaApp.length, 1, 'o tempo real ficou parado até reabrir o app');
});

test('P2 o teto: falha SEM resposta (rede) libera o pedido na próxima prova de rede; o Waze falhando (COM resposta) não', async () => {
  // Com o Waze fora, cada ação volta com resposta — e ela prova rede. Se o
  // `transient` do Waze zerasse o teto, cada swipe pediria o token de novo.
  const c = novoCliente({ api: { presencaApp: async () => ({ success: false, errorCategory: 'transient' }) } });
  await c.P.presencaAtualizar({ token: true });
  for (let i = 0; i < 5; i++) { c.relogio.agora += 5e3; c.P.presencaAoProvarRede(); await tick(); }
  assert.equal(c.chamadas.presencaApp.length, 1, 'com o Waze fora, cada ação pediu o token de novo');
  // Sem resposta (rede): a próxima resposta que chegar pede de novo, na hora.
  const d = novoCliente({ api: { presencaApp: async () => ({ success: false, errorCategory: 'transient', _motivo: 'TypeError' }) } });
  await d.P.presencaAtualizar({ token: true });
  d.relogio.agora += 5e3;
  d.P.presencaAoProvarRede();
  await tick();
  assert.equal(d.chamadas.presencaApp.length, 2, 'a rede voltou e o token não foi pedido de novo');
});

test('P2 o api.js de verdade: só a falha SEM resposta leva `_motivo` — e só a resposta que chega prova rede', async () => {
  // O `presencaSemResposta` se apoia nisto; roda o transporte, não lê o texto.
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const fonte = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8') + '\n'
    + readFileSync(new URL('../js/api.js', import.meta.url), 'utf8') + '\nthis.API = API;';
  const rodar = (fetch) => {
    const ctx = { navigator: { language: 'pt-BR', onLine: true }, document: { documentElement: {}, querySelectorAll: () => [] },
      localStorage: { getItem: (k) => (k === 'waze_session_token' ? 'tok' : null), setItem() {}, removeItem() {} },
      fetch, performance, AbortController, Response, console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout };
    vm.createContext(ctx);
    vm.runInContext(fonte, ctx);
    let provas = 0;
    ctx.API.aoProvarRede = () => { provas += 1; };
    return { API: ctx.API, provas: () => provas };
  };
  const semRede = rodar(async () => { throw new TypeError('Failed to fetch'); });
  const r1 = await semRede.API.presencaApp({ pais: 30 });
  assert.equal(r1.errorCategory, 'transient');
  assert.equal(typeof r1._motivo, 'string', 'a falha sem resposta perdeu a marca `_motivo`');
  assert.equal(semRede.provas(), 0);
  const wazeFora = rodar(async () => new Response(JSON.stringify({ success: false, errorCategory: 'transient' }), { status: 503 }));
  const r2 = await wazeFora.API.presencaApp({ pais: 30 });
  assert.equal(r2.errorCategory, 'transient');
  assert.equal('_motivo' in r2, false, 'a resposta que CHEGOU veio marcada como sem resposta');
  assert.equal(wazeFora.provas(), 1, 'CONTROLE: a resposta que chega prova rede');
});

test('P2 o app liga a prova de rede à presença', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const ini = APP.indexOf('API.aoProvarRede = () => {');
  assert.ok(ini > 0, 'sumiu o gancho da prova de rede');
  const corpo = APP.slice(ini, APP.indexOf('\n};', ini)).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(corpo, /window\.Presenca\?\.aoProvarRede\?\.\(\);/, 'a prova de rede não chega à presença: o token que falhou não é pedido de novo');
});

// ── P13: o diário do token usa o relógio daqui ──────────────────────────────

test('P13 diário: o prazo do token vai no relógio do APARELHO — o mesmo que o resumo mostra', async () => {
  // Aparelho um dia e uma hora ADIANTADO; o servidor manda a hora dele e um
  // token de 24 h. Cru contra o relógio daqui, o diário dizia "vence em -1 h".
  const SERVIDOR = 1790200000000;
  const c = novoCliente({ agora: SERVIDOR + 864e5 + 36e5, api: { presencaApp: async () => ({ success: true, online: [], conversas: [], agora: SERVIDOR,
    chat: { token: 't', chave: 'k', base: GOOGLE, expiraEm: SERVIDOR + 864e5 } }) } });
  c.doc.visibilityState = 'hidden';   // não abre o fluxo neste teste
  await c.P.presencaAtualizar({ token: true });
  const linha = c.chamadas.dfato.find(([k]) => k === 'presenca.token')[1];
  assert.deepEqual(linha, { veio: true, expiraEmH: 24 }, 'o diário leu o prazo no relógio do servidor');
  assert.equal(linha.expiraEmH, c.P.presencaDiag().token.expiraEmH, 'o diário e o resumo discordam do mesmo token');
});

// ── P3: a conversa escondida por outra camada ───────────────────────────────
//
// O `openModal` de outra camada (a folha do pedido recebido, o "Sair" da Ajuda)
// ESCONDE a conversa sem passar pela limpeza dela. O `openModal` de mentira
// aqui faz exatamente isso, como o do app.js.

const OUTRO = '777000';
const PEDIDO_X = { venueID: 'vx', updateRequestID: 'urx', name: 'Pedido X', address: '', categories: [], updateTypeKey: 'IMAGE', imageUrl: null, lat: -23.5, lon: -46.6, region: 'row' };
const PRESENCA_MODAIS = ['presencaModal', 'conversaModal', 'pedidoModal'];
function comOpenModalDeVerdade(c) {
  c.escopo.openModal = (id) => {
    for (const m of PRESENCA_MODAIS) if (m !== id) c.$(m).classList.add('hidden');
    c.$(id).classList.remove('hidden');
  };
}

test('P3 o pedido preso na conversa com uma pessoa não aparece — nem sai — na conversa com OUTRA', async () => {
  const c = novoCliente({ api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [], maisAntigas: false, lida: true } : { success: true }) } });
  c.win.cardParaConversa = () => ({ ...PEDIDO_X, name: 'Pedido Y' });   // o card na tela agora é outro
  c.P.presencaMontar();
  comOpenModalDeVerdade(c);
  c.P.presencaAbrirConversa(CAF);
  await tick();
  c.P.Presenca.anexo = PEDIDO_X;                     // o pedido X preso na conversa com a CAF
  c.escopo.openModal('pedidoModal');                  // abre um pedido que a CAF mandou...
  c.$('pedidoModal').classList.add('hidden');         // ...e fecha a folha
  // CONTROLE: reabrir a MESMA conversa mantém o pedido que a pessoa prendeu.
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.equal(c.P.Presenca.anexo && c.P.Presenca.anexo.name, 'Pedido X', 'CONTROLE: reabrir a mesma conversa soltou o pedido');
  c.escopo.openModal('pedidoModal');
  c.$('pedidoModal').classList.add('hidden');
  c.P.presencaAbrirConversa(OUTRO);
  await tick();
  assert.equal(c.P.Presenca.anexo, null, 'o pedido preso na conversa com a CAF foi parar na conversa com outra pessoa');
  assert.equal(c.$('conversaAnexo').classList.contains('hidden'), true, 'a tirinha mostra o pedido de outra conversa');
  c.$('conversaInput').value = 'oi';
  c.$('conversaForm').disparar('submit');
  await tick();
  const envio = c.chamadas.chat.find((x) => x.acao === 'enviar');
  assert.equal(envio.para, OUTRO);
  assert.equal(envio.contexto, undefined, 'o pedido de outra conversa saiu junto no envio');
});

test('P3 a conversa ESCONDIDA não é redesenhada — o que chega entra no histórico e aparece quando ela volta', async () => {
  const { bytesDeMensagem, bytesDeRecibo, b64 } = await import('./_presenca-cliente.mjs');
  const inbox = (bytes, n) => ({ inboxMessage: { messageId: `a0000000-0000-1000-8000-${String(900 + n).padStart(12, '0')}`, messageType: 'X', message: b64(bytes) } });
  const fluxo = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
  const c = novoCliente({ api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [], maisAntigas: false, lida: true } : { success: true }) } });
  c.P.presencaMontar();
  comOpenModalDeVerdade(c);
  c.P.Presenca.atualizadaEm = 1;
  c.P.presencaAbrirConversa(CAF);
  await tick();
  c.escopo.openModal('pedidoModal');                  // a folha do pedido esconde a conversa
  c.$('conversaMsgs').innerHTML = '';                 // (o DOM de antes não é o que se mede aqui)
  c.P.presencaQuadro(fluxo(c), inbox(await bytesDeMensagem({ id: 'a0000000-0000-1000-8000-000000000071', de: CAF, para: EU, texto: 'TEXTO_NOVO', ctx: { app: 'wazeplaces' }, ts: 1790200000000 }), 1));
  c.P.presencaQuadro(fluxo(c), inbox(await bytesDeRecibo({ id: 'a0000000-0000-1000-8000-000000000072', de: CAF, para: EU, tipo: 'lida', ids: ['a0000000-0000-1000-8000-000000000071'], ts: 1790200001000 }), 2));
  assert.equal(c.$('conversaMsgs').innerHTML, '', 'a conversa escondida foi redesenhada (a captura levaria o que não está na tela)');
  assert.equal(c.P.Presenca.historico.get(CAF).msgs.length, 1, 'CONTROLE: a mensagem tem que entrar no histórico');
  // Volta pra conversa: ela aparece.
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.match(c.$('conversaMsgs').innerHTML, /TEXTO_NOVO/, 'a mensagem não apareceu quando a conversa voltou');
});

test('P3 desligar e "Sair" soltam a conversa e o pedido preso — a conta seguinte não herda a tirinha', async () => {
  const c = novoCliente({ api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [], maisAntigas: false, lida: true } : { success: true }) } });
  c.win.cardParaConversa = () => PEDIDO_X;
  c.P.presencaMontar();
  comOpenModalDeVerdade(c);
  c.P.presencaAbrirConversa(CAF);
  await tick();
  c.P.presencaAnexarCard();
  assert.equal(c.P.Presenca.anexo.name, 'Pedido X', 'CONTROLE: o pedido não prendeu');
  c.escopo.openModal('pedidoModal');                  // esconde a conversa sem a limpeza dela
  c.$('pedidoModal').classList.add('hidden');
  c.$('conversaMsgs').innerHTML = '<div>TEXTO_DE_TERCEIRO</div>';
  c.P.presencaEsquecer();                              // "Sair"
  assert.equal(c.P.Presenca.aberta, null, 'a conversa atravessou o "Sair"');
  assert.equal(c.P.Presenca.anexo, null, 'o pedido preso atravessou o "Sair"');
  assert.equal(c.$('conversaMsgs').innerHTML, '', 'a conversa de quem saiu ficou no DOM');
  c.AppState.profile = { id: 555000, userName: 'outra' };
  c.win.cardParaConversa = () => null;
  c.P.presencaAbrirConversa(OUTRO);
  await tick();
  assert.equal(c.$('conversaAnexo').classList.contains('hidden'), true, 'a conta seguinte herdou a tirinha da anterior');
});

// ── P6: a sessão acaba com a conversa aberta ────────────────────────────────

test('P6 a sessão acaba com a conversa aberta: conversa, lista e folha do pedido FECHAM, e o texto de terceiro sai do DOM', async () => {
  const c = novoCliente({ api: { chat: (x) => (x.acao === 'abrir'
    ? { success: true, mensagens: [{ ...daCaf(1, 1790200000000), texto: 'TEXTO_DE_TERCEIRO' }], maisAntigas: false, lida: true } : { success: true }) } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.match(c.$('conversaMsgs').innerHTML, /TEXTO_DE_TERCEIRO/, 'CONTROLE: a conversa tem que estar na tela');
  // `showAuthScreen`: authenticated = false, profile = null, Presenca.desligar().
  c.AppState.authenticated = false;
  c.AppState.profile = null;
  c.P.presencaDesligar();
  assert.equal(c.$('conversaModal').classList.contains('hidden'), true, 'a conversa ficou por cima da tela de entrada');
  assert.deepEqual(c.chamadas.closeModal, ['conversaModal'], 'fechou por fora do `closeModal` (o voltar e a limpeza)');
  assert.doesNotMatch(c.$('conversaMsgs').innerHTML, /TEXTO_DE_TERCEIRO/);
  assert.equal(c.P.Presenca.aberta, null);
  // A lista e a folha do pedido também.
  for (const id of ['presencaModal', 'pedidoModal']) {
    const d = novoCliente();
    d.$(id).classList.remove('hidden');
    d.P.presencaDesligar();
    assert.equal(d.$(id).classList.contains('hidden'), true, `${id} ficou por cima da tela de entrada`);
    assert.deepEqual(d.chamadas.closeModal, [id]);
  }
  // CONTROLE: o que não está na tela não é "fechado" — cada fechamento gasta
  // uma entrada do voltar, e a escondida não tem nenhuma.
  const e = novoCliente();
  e.P.presencaDesligar();
  assert.deepEqual(e.chamadas.closeModal, [], 'fechou modal que não estava aberto');
});

test('P6 sem o id do perfil o envio não sai — e o que se digitou FICA no campo', async () => {
  const c = novoCliente({ api: { chat: () => ({ success: true }) } });
  c.P.presencaMontar();
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true });
  c.AppState.profile = null;                           // a sessão acabou de cair
  c.$('conversaInput').value = 'minha resposta';
  c.$('conversaForm').disparar('submit');
  await tick();
  assert.equal(c.$('conversaInput').value, 'minha resposta', 'o que se digitou sumiu calado');
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'enviar').length, 0);
  // CONTROLE: com o perfil, sai e o campo limpa.
  c.AppState.profile = { id: 12444348, userName: 'antigerme' };
  c.$('conversaForm').disparar('submit');
  await tick();
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'enviar').length, 1);
  assert.equal(c.$('conversaInput').value, '');
});

test('P6 o rascunho: a queda da sessão o mantém (é a mesma pessoa voltando); o "Sair" o leva junto', () => {
  const c = novoCliente();
  c.$('conversaInput').value = 'rascunho';
  c.P.presencaDesligar();
  assert.equal(c.$('conversaInput').value, 'rascunho', 'a queda da sessão apagou o que se digitou');
  c.P.presencaEsquecer();
  assert.equal(c.$('conversaInput').value, '', 'o "Sair" deixou o rascunho pra conta seguinte');
});

test('P6 o diálogo do portão fechado abre ANTES da tela de entrada — fechar a conversa e abri-lo no mesmo quadro é o gotcha #65', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const depois = [...APP.matchAll(/depois: \(\) => \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(depois.length >= 2, 'sumiram os desfechos do portão fechado (o guard ficaria cego)');
  for (const corpo of depois) {
    if (!/showAuthScreen\(\)/.test(corpo) || !/showAccessDenied\(/.test(corpo)) continue;
    assert.ok(corpo.indexOf('showAccessDenied(') < corpo.indexOf('showAuthScreen()'),
      `a tela de entrada fecha a conversa e o diálogo abre em seguida: ${corpo.trim()}`);
  }
});

// ── P4: o histórico que não veio não some da tela ──────────────────────────

test('P4 o `abrir` falhou: o erro e o "Tentar de novo" FICAM quando uma mensagem chega ou sai — e o botão traz o histórico (e o "lida" do `abrir`)', async () => {
  const { bytesDeMensagem, b64 } = await import('./_presenca-cliente.mjs');
  let abrir = { success: false, errorCategory: 'transient' };
  const c = novoCliente({ api: { chat: (x) => (x.acao === 'abrir' ? abrir : { success: true, ts: 1790200000999 }) } });
  c.P.presencaMontar();
  c.P.Presenca.atualizadaEm = 1;
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.match(c.$('conversaMsgs').innerHTML, /conversa-recarregar/, 'CONTROLE: a falha tem que mostrar o "Tentar de novo"');
  // Chega uma mensagem dela, ao vivo, com a conversa aberta.
  const bytes = await bytesDeMensagem({ id: 'a0000000-0000-1000-8000-000000000081', de: CAF, para: EU, texto: 'oi?', ctx: { app: 'wazeplaces' }, ts: 1790200000000 });
  c.P.presencaQuadro({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 },
    { inboxMessage: { messageId: 'a0000000-0000-1000-8000-000000000981', messageType: 'X', message: b64(bytes) } });
  let html = c.$('conversaMsgs').innerHTML;
  assert.match(html, /presenca\.conversa\.erro/, 'a mensagem que chegou apagou o aviso de que o histórico não veio');
  assert.match(html, /conversa-recarregar/, 'a mensagem que chegou apagou o "Tentar de novo"');
  assert.match(html, /oi\?/, 'CONTROLE: a mensagem que chegou tem que aparecer');
  assert.ok(html.indexOf('conversa-recarregar') < html.indexOf('oi?'), 'o erro do histórico vem ANTES das mensagens (é o que falta em cima)');
  // E a pessoa manda uma: o erro continua.
  c.$('conversaInput').value = 'tá aí?';
  c.$('conversaForm').disparar('submit');
  await tick();
  assert.match(c.$('conversaMsgs').innerHTML, /conversa-recarregar/, 'mandar mensagem apagou o "Tentar de novo"');
  // O "Tentar de novo": agora o histórico vem, o erro sai, e a conversa é lida.
  abrir = { success: true, mensagens: [daCaf(81, 1790200000000)], maisAntigas: false, lida: true };
  c.$('conversaMsgs').disparar('click', { target: { closest: (s) => (s === '.conversa-recarregar' ? {} : null) } });
  await tick();
  html = c.$('conversaMsgs').innerHTML;
  assert.doesNotMatch(html, /conversa-recarregar/, 'o histórico veio e o erro ficou');
  assert.equal(c.P.Presenca.historico.get(CAF).carregada, true);
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'abrir').length, 2);
});

test('P4 sem mensagem nenhuma, o erro do histórico aparece UMA vez (sem o "Carregando" junto)', async () => {
  const c = novoCliente({ api: { chat: () => ({ success: false, errorCategory: 'transient' }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  const html = c.$('conversaMsgs').innerHTML;
  assert.equal((html.match(/presenca\.conversa\.erro/g) || []).length, 1);
  assert.doesNotMatch(html, /presenca\.conversa\.carregando|presenca\.conversa\.vazio/);
});

// ── P5: o "lida" do `abrir` que falhou no Waze ──────────────────────────────

test('P5 o "lida" do `abrir` falhou no Waze: o app não o dá como feito, e o "lida" que faltou sai com a conversa na tela', async () => {
  const hist = [daCaf(91, 1790200000000)];
  const c = novoCliente({ api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: hist, maisAntigas: false, recibos: [], lida: false } : { success: true }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.ok(!(c.P.Presenca.lidaEnviadaAte.get(CAF) > 0), 'o "lida" que falhou ficou dado como enviado');
  await c.rodarTimers();
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'lida').length, 1, 'o "lida" que faltou não saiu com a conversa aberta');
  // CONTROLE: com o "lida" confirmado, nenhum pedido a mais.
  const d = novoCliente({ api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: hist, maisAntigas: false, recibos: [], lida: true } : { success: true }) } });
  d.P.presencaAbrirConversa(CAF);
  await tick();
  await d.rodarTimers();
  assert.equal(d.P.Presenca.lidaEnviadaAte.get(CAF), 1790200000000);
  assert.equal(d.chamadas.chat.filter((x) => x.acao === 'lida').length, 0, 'CONTROLE: com o "lida" confirmado saiu um pedido à toa');
});

// ── P10: a lista da carona é do país que a carona levou ─────────────────────

test('P10 a lista que volta de CARONA de outro país não entra como a do país de agora', async () => {
  let pais = 30;
  const c = novoCliente({ api: { presencaApp: async (campos) => ({ success: true, online: campos.pais === 73 ? [{ id: '888', nome: 'da-franca' }] : [], conversas: [] }) } });
  c.API.getCountry = () => pais;
  c.P.Presenca.chat = { token: 't', base: 'https://x/', chave: 'k', expiraEm: c.relogio.agora + 864e5 };
  c.doc.visibilityState = 'hidden';                   // não abre o fluxo neste teste
  const saiu = c.relogio.agora;                       // a carona sai com o Brasil (30)...
  pais = 73;                                          // ...e a pessoa aplica o filtro França
  await c.P.presencaSincronizar();
  await tick();
  assert.deepEqual(c.P.Presenca.online.map((p) => p.nome), ['da-franca'], 'CONTROLE: a lista da França tem que entrar');
  // A resposta da carona (a lista do BRASIL) chega depois.
  c.P.presencaAoCarona({ online: [{ id: '777', nome: 'do-brasil', lat: -23.5, lon: -46.6 }], conversas: [] }, saiu, 30);
  assert.deepEqual(c.P.Presenca.online.map((p) => p.nome), ['da-franca'], 'a lista do Brasil entrou como a da França');
  // CONTROLE: a carona do MESMO país entra.
  c.P.presencaAoCarona({ online: [{ id: '889', nome: 'outra-da-franca' }], conversas: [] }, c.relogio.agora, 73);
  assert.deepEqual(c.P.Presenca.online.map((p) => p.nome), ['outra-da-franca'], 'CONTROLE: a carona do país de agora não entrou');
});

// ── P7, P8, P9: o que o leitor de tela ouve ─────────────────────────────────

const CARD_P = {
  venueID: '205522459.2055159053.3242788', updateRequestID: 'ur-1', name: 'Padaria Estrela do Norte', address: 'R. Aurora, 412',
  categories: ['BAKERY'], updateTypeKey: 'IMAGE', imageUrl: 'https://venue-image.waze.com/thumbs/thumb700_A.png', lat: -23.556789, lon: -46.631234, region: 'row',
};
const desescapa = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const rotulos = (html) => [...html.matchAll(/class="presenca-linha" data-pessoa="(\d+)" aria-label="([^"]*)"/g)].map((m) => [m[1], desescapa(m[2])]);

test('P7 a mensagem com PEDIDO é anunciada pela pergunta e pelo pedido — nunca pelo link longo do WME', async () => {
  const { bytesDeMensagem, b64 } = await import('./_presenca-cliente.mjs');
  const inbox = (bytes, n) => ({ inboxMessage: { messageId: `a0000000-0000-1000-8000-${String(950 + n).padStart(12, '0')}`, messageType: 'X', message: b64(bytes) } });
  const fluxo = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
  const c = novoCliente();
  c.P.Presenca.atualizadaEm = 1;
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.$('conversaTitle').textContent = 'cafanha';
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true });
  const texto = c.P.presencaTextoParaWme('Esse aqui tá certo?', CARD_P);
  assert.match(texto, /https:\/\/www\.waze\.com\/editor/, 'CONTROLE: o texto que vai pro WME leva o link');
  const bytes = await bytesDeMensagem({ id: 'a0000000-0000-1000-8000-000000000095', de: CAF, para: EU, texto,
    ctx: { app: 'wazeplaces', legenda: 'Esse aqui tá certo?', card: JSON.stringify(CARD_P) }, ts: 1790200000000 });
  c.P.presencaQuadro(fluxo(c), inbox(bytes, 1));
  const anuncio = c.$('conversaAnuncio').textContent;
  assert.doesNotMatch(anuncio, /https?:|waze\.com/, 'o leitor de tela soletra o link do WME');
  assert.match(anuncio, /Esse aqui tá certo\?/, 'a pergunta não foi anunciada');
  assert.match(anuncio, /Padaria Estrela do Norte · Nova foto/, 'o pedido não foi anunciado');
  // CONTROLE: mensagem de texto é anunciada inteira, como sempre.
  c.P.presencaQuadro(fluxo(c), inbox(await bytesDeMensagem({ id: 'a0000000-0000-1000-8000-000000000096', de: CAF, para: EU,
    texto: 'viu a https://exemplo.invalido?', ctx: { app: 'wazeplaces' }, ts: 1790200001000 }), 2));
  assert.match(c.$('conversaAnuncio').textContent, /viu a https:\/\/exemplo\.invalido\?/);
});

test('P8 cada linha da lista tem o nome acessível com as partes SEPARADAS — e o número diz que são mensagens', () => {
  const c = novoCliente();
  c.AppState.currentPlace = { mapa: { centro: [-23.55, -46.63] } };
  c.P.presencaAplicarLista({ online: [{ id: CAF, nome: 'cafanha', rank: 3, lat: -23.53, lon: -46.64 }, { id: '555', nome: 'semnada', rank: 1, lat: -23.54, lon: -46.64 }],
    conversas: [conversa(CAF, 'cafanha', 5, 3), conversa('999', 'fulano', 4, 2, { texto: 'oi', ts: 1790200000000 })] }, 1, 30);
  c.$('presencaModal').classList.remove('hidden');
  c.P.presencaRenderLista();
  const r = Object.fromEntries(rotulos(c.$('presencaLista').innerHTML));
  assert.ok(r[CAF] && r['999'] && r['555'], `faltou o nome acessível de alguma linha: ${JSON.stringify(r)}`);
  assert.ok(r[CAF].startsWith('cafanha, L4, presenca.dist'), `nome, nível e distância colados: ${r[CAF]}`);
  assert.ok(r[CAF].endsWith(', presenca.pill.msgPlural{"n":3}'), `o "3" não diz que são mensagens novas: ${r[CAF]}`);
  assert.ok(r['999'].startsWith('fulano, oi, '), `nome e prévia colados: ${r['999']}`);
  assert.ok(r['999'].endsWith(', presenca.pill.msgPlural{"n":2}'), r['999']);
  // CONTROLE: sem não lida, nada de "0 mensagens".
  assert.doesNotMatch(r['555'], /presenca\.pill/, `linha sem mensagem nova anunciou mensagem: ${r['555']}`);
  // E o número É o mesmo termo da pílula (mesmo conceito, mesmas palavras).
  c.P.presencaRenderPilula();
  assert.match(c.$('presencaPill').getAttribute('aria-label'), /^presenca\.pill\.msgPlural/);
});

test('P9 o cartão do pedido: a pergunta e o recibo DESCREVEM o botão (`aria-describedby`), sem mudar a tela', () => {
  const c = novoCliente();
  const card = c.P.presencaCardSeguro(CARD_P);
  const html = c.P.presencaHtmlDasMsgs(CAF, { msgs: [
    { id: 'm1', ts: 1790200000000, meu: true, card, legenda: 'PERGUNTA: isso é fachada?', texto: 'x', estado: 'enviada' },
    { id: 'm2', ts: 1790200001000, meu: true, card, legenda: '', texto: 'x', estado: 'enviada' },
    { id: 'm3', ts: 1790200002000, meu: false, card, legenda: '', texto: 'x' },
  ] });
  const botoes = [...html.matchAll(/<button type="button" class="conversa-pedido[^>]*>/g)].map((m) => m[0]);
  assert.equal(botoes.length, 3);
  const descDe = (b) => (b.match(/aria-describedby="([^"]+)"/) || [])[1];
  // Com pergunta: a linha da pergunta (que leva o recibo) é a descrição.
  const d0 = descDe(botoes[0]);
  assert.ok(d0, 'o botão com pergunta não tem descrição: o leitor de tela nunca ouve a pergunta');
  const alvo0 = html.match(new RegExp(`<span id="${d0}" class="cp-legenda">([^]*?)</span></span>`));
  // (as duas minhas vêm antes de uma dela: o recibo é "Lida" — quem respondeu depois leu)
  assert.ok(alvo0 && /PERGUNTA: isso é fachada\?/.test(alvo0[1]) && /presenca-recibo lida/.test(alvo0[1]), 'a descrição não é a pergunta com o recibo');
  // Sem pergunta: o recibo é a descrição.
  const d1 = descDe(botoes[1]);
  assert.ok(d1 && new RegExp(`<span id="${d1}" class="presenca-recibo lida" role="img"`).test(html), 'o recibo do cartão sem pergunta não descreve o botão');
  // O que ELA mandou sem pergunta não tem recibo: nada a descrever, e nenhuma referência pendurada.
  assert.equal(descDe(botoes[2]), undefined);
  for (const b of botoes) {
    const d = descDe(b);
    if (d) assert.equal((html.match(new RegExp(`id="${d}"`, 'g')) || []).length, 1, `a descrição ${d} não existe (ou existe duas vezes)`);
  }
  // A tela não muda: o nome continua o do botão, e a pergunta continua DENTRO dele.
  assert.match(botoes[0], /aria-label="presenca\.pedido\.abrir/);
  assert.match(html, /cp-legenda">PERGUNTA: isso é fachada\?/);
});

// ── P12: "Ver mensagens anteriores" diz o que está acontecendo ──────────────

const toque = (c, seletor, alvo = {}) => c.$('conversaMsgs').disparar('click', { target: { closest: (s) => (s === seletor ? alvo : null) } });

test('P12 "Ver mensagens anteriores": carregando, o MESMO botão desabilitado e com o rótulo trocado; falhou, a linha de erro da conversa — e o "Tentar de novo" refaz a página ANTIGA', async () => {
  let soltar;
  const c = novoCliente({ api: { chat: (x) => (x.acao !== 'abrir' ? { success: true }
    : x.antesDe ? new Promise((ok) => { soltar = ok; })
    : { success: true, mensagens: [daCaf(1, 1790200000000)], maisAntigas: true, lida: true }) } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.match(c.$('conversaMsgs').innerHTML, /<button type="button" class="conversa-anteriores">presenca\.conversa\.anteriores<\/button>/, 'CONTROLE: o botão tem que estar lá');
  toque(c, '.conversa-anteriores');
  await tick();
  const durante = c.$('conversaMsgs').innerHTML;
  assert.match(durante, /<button type="button" class="conversa-anteriores" disabled>presenca\.conversa\.anterioresCarregando<\/button>/,
    'carregando, a tela ficou igual à de antes do toque');
  toque(c, '.conversa-anteriores');                        // outro toque no meio: nada sai
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'abrir' && x.antesDe).length, 1, 'o toque no meio mandou outro pedido');
  soltar({ success: false, errorCategory: 'transient' });
  await tick(); await tick();
  const depois = c.$('conversaMsgs').innerHTML;
  assert.match(depois, /<p class="conversa-vazio">presenca\.conversa\.anterioresErro <button type="button" class="conversa-recarregar" data-antigas="1">presenca\.conversa\.tentar<\/button><\/p>/,
    'a falha das mensagens anteriores não disse nada');
  assert.match(depois, /oi\?/, 'o histórico que já estava na tela sumiu com a falha da página antiga');
  // O "Tentar de novo" daqui é da página ANTIGA (antes da primeira na tela), não a conversa inteira.
  toque(c, '.conversa-recarregar', { dataset: { antigas: '1' } });
  await tick();
  const pedidos = c.chamadas.chat.filter((x) => x.acao === 'abrir');
  assert.equal(pedidos.at(-1).antesDe, 1790200000000, 'o "Tentar de novo" refez a conversa em vez da página antiga');
  soltar({ success: true, mensagens: [daCaf(2, 1790100000000)], maisAntigas: false });
  await tick(); await tick();
  const fim = c.$('conversaMsgs').innerHTML;
  assert.doesNotMatch(fim, /conversa-anteriores|anterioresErro|anterioresCarregando/, 'o erro (ou o botão) ficou depois de a página antiga chegar');
  assert.equal(c.P.Presenca.historico.get(CAF).msgs.length, 2);
});

test('P12 reabrir a conversa não traz de volta o erro velho da página antiga', async () => {
  let antigas = { success: false, errorCategory: 'transient' };
  const c = novoCliente({ api: { chat: (x) => (x.acao !== 'abrir' ? { success: true }
    : x.antesDe ? antigas : { success: true, mensagens: [daCaf(1, 1790200000000)], maisAntigas: true, lida: true }) } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick();
  toque(c, '.conversa-anteriores');
  await tick(); await tick();
  assert.match(c.$('conversaMsgs').innerHTML, /anterioresErro/, 'CONTROLE: a falha tem que aparecer');
  c.P.presencaEsquecerAberta();                            // fechou (a limpeza do modal)
  c.$('conversaModal').classList.add('hidden');
  c.P.presencaAbrirConversa(CAF);                          // e abriu de novo
  await tick();
  const html = c.$('conversaMsgs').innerHTML;
  assert.doesNotMatch(html, /anterioresErro/, 'o erro da vez anterior voltou com a conversa');
  assert.match(html, /<button type="button" class="conversa-anteriores">presenca\.conversa\.anteriores<\/button>/);
});
