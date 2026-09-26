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
