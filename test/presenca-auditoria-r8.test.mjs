// A presença e a conversa depois da auditoria da rodada 8 (R8-5, e o R8-6-02,
// que é o mesmo achado visto pelo lado dos filtros): o tempo real parado depois
// do modo avião quando o `online` não vem, a lista pedida com `keepalive` na
// volta do fundo, "Minha área" com dois países na presença, a dívida do "lida"
// que só existia na memória (e a que estava NO AR quando a lista chegava), o
// mesmo "lida" saindo duas vezes e o "invisível" repetido pela outra aba. Os
// rótulos R8-5-n são os do relatório dessa rodada. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
//
// Dois instrumentos, como nas rodadas anteriores: o js/presenca.js INTEIRO no
// navegador de mentira do `_presenca-cliente.mjs`, e as funções do app.js
// FATIADAS e rodadas num escopo de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { novoCliente } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const GOOGLE = 'https://instantmessaging-pa.googleapis.com/';

// ── R8-5-01: o tempo real parado pela falta de rede ──────────────────────────

// O fluxo aberto com um token que vale, e o Google inalcançável: ele cai, a
// pessoa está no modo avião (`onLine` falso) e o recuo vence SEM rede — o
// `presencaFluxoGarantir` desiste sem reagendar. Depois a rede volta, SEM o
// evento `online` (o iPhone). `token`: 'vale' (vale mais de uma hora),
// 'ultimaHora' (abre o fluxo, mas já é hora de renovar) ou null (sem token).
async function fluxoParado({ token = 'vale' } = {}) {
  const c = novoCliente({ agora: T, api: {
    fetch: async () => { throw new TypeError('Failed to fetch'); },   // o Google inalcançável
    presencaApp: () => ({ success: true, online: [], conversas: [], agora: c.relogio.agora }),
  } });
  c.P.presencaMontar();
  const expiraEm = token === 'ultimaHora' ? T + 40 * 60_000 : T + 20 * 3600e3;
  Object.assign(c.P.Presenca, { atualizadaEm: T, tentadaEm: T, pais: 30, tokenPedidoEm: T,
    chat: token ? { token: 'tk', base: GOOGLE, chave: 'k', expiraEm } : null });
  if (token) {
    c.P.presencaFluxoGarantir();                            // o fluxo abre…
    await tick(); await tick();                             // …e cai: a rede foi embora
    assert.equal(c.chamadas.fetch.length, 1, 'CONTROLE: o fluxo tinha que ter aberto uma vez');
  }
  c.escopo.navigator.onLine = false;                        // o modo avião
  c.relogio.agora += 3000;
  await c.rodarTimers();                                    // o recuo vence SEM rede
  assert.equal(c.timers.length, 0, 'CONTROLE: o recuo sem rede não pode deixar timer de pé (é o defeito)');
  c.escopo.navigator.onLine = true;                         // a rede volta, sem o `online`
  c.relogio.agora += 6 * 60_000;                            // (o teto de 5 min do token já passou)
  return c;
}
const provasDeRede = async (c, n = 5) => { for (let i = 0; i < n; i++) { c.P.presencaAoProvarRede(); await tick(); } await tick(); };

test('R8-5-01 o recuo que venceu sem rede deixa o tempo real PARADO — e a prova de rede o religa UMA vez, sem o `online` e sem pedido à API', async () => {
  const c = await fluxoParado();
  assert.equal(c.P.Presenca.fluxoParado, true, 'o fluxo parado pela falta de rede não ficou marcado');
  const antes = c.chamadas.fetch.length;
  await provasDeRede(c);                                    // cada ✕ é uma resposta que prova a rede
  assert.equal(c.chamadas.fetch.length - antes, 1,
    'DEFEITO: a rede voltou sem o `online`, as respostas da API chegaram e o tempo real não religou (ou religou a cada uma)');
  assert.equal(c.chamadas.presencaApp.length, 0, 'religar o tempo real pediu alguma coisa à API');
  assert.equal(c.P.Presenca.fluxoParado, false);
  // O fluxo religado que cai de novo segue o recuo dele (um timer), não as provas.
  assert.equal(c.timers.length, 1, 'o fluxo religado que caiu ficou sem o recuo');
});

test('R8-5-01 o token na ÚLTIMA hora religa igual, e sem pedir o token novo (a renovação segue com quem já a fazia)', async () => {
  const c = await fluxoParado({ token: 'ultimaHora' });
  const antes = c.chamadas.fetch.length;
  await provasDeRede(c);
  assert.equal(c.chamadas.fetch.length - antes, 1, 'DEFEITO: com o token na última hora, o tempo real ficou parado');
  assert.equal(c.chamadas.presencaApp.length, 0, 'religar pela prova de rede pediu o token à API');
});

test('R8-5-01 CONTROLES: o `online` religa; sem o fluxo parado a prova não reconecta (o recuo cuida); sem token, a prova pede um', async () => {
  // (a) O evento `online`, quando vem, religa como sempre.
  const a = await fluxoParado();
  const antesA = a.chamadas.fetch.length;
  for (const fn of a.win._ouv.online || []) fn();
  await tick(); await tick();
  assert.equal(a.chamadas.fetch.length - antesA, 1, 'o `online` deixou de religar o tempo real');
  // (b) Com rede, o fluxo que cai deixa o RECUO de pé: a prova de rede não
  // reconecta por cima dele (senão cada ação seria uma reconexão ao Google).
  const b = novoCliente({ agora: T, api: { fetch: async () => { throw new TypeError('Failed to fetch'); } } });
  b.P.presencaMontar();
  Object.assign(b.P.Presenca, { atualizadaEm: T, tentadaEm: T, pais: 30, tokenPedidoEm: T,
    chat: { token: 'tk', base: GOOGLE, chave: 'k', expiraEm: T + 20 * 3600e3 } });
  b.P.presencaFluxoGarantir();
  await tick(); await tick();
  assert.equal(b.timers.length, 1, 'CONTROLE: o recuo tinha que estar de pé');
  const antesB = b.chamadas.fetch.length;
  await provasDeRede(b);
  assert.equal(b.chamadas.fetch.length - antesB, 0, 'a prova de rede reconectou o tempo real com o recuo cuidando dele');
  assert.equal(b.P.Presenca.fluxoParado, false);
  // (c) Sem token, a prova de rede pede um (o caminho que já existia).
  const c = await fluxoParado({ token: null });
  await provasDeRede(c, 1);
  assert.equal(c.chamadas.presencaApp.filter((x) => x.token === true).length, 1, 'sem token, a prova de rede deixou de pedi-lo');
});

// ── O app.js, fatiado ────────────────────────────────────────────────────────

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) {
      const corpo = APP_SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
function montar(nomes, deps) {
  const chaves = Object.keys(deps);
  return new Function(...chaves, nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]));
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// O api.js DE VERDADE numa vm (o padrão do `presenca-auditoria-r7`): é o `_post`
// dele que transforma o modo "saindo" em `keepalive` e tira o sinal do teto de
// 45 s. O `fetch` anota o `init` de cada pedido.
function apiDeVerdade() {
  const pedidos = [];
  const fetch = async (url, init) => {
    pedidos.push({ rota: String(url).split('/').pop(), corpo: JSON.parse(init.body), keepalive: init.keepalive === true, sinal: !!init.signal });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const fonte = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8') + '\n'
    + readFileSync(new URL('../js/api.js', import.meta.url), 'utf8') + '\nthis.API = API;';
  const ctx = { navigator: { language: 'pt-BR', onLine: true }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (k === 'waze_session_token' ? 'tok' : null), setItem() {}, removeItem() {} },
    fetch, performance, AbortController, Response, ReadableStream, console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  return { API: ctx.API, pedidos };
}

// ── R8-5-02: a volta do fundo pede a lista com o modo "saindo" já desligado ──

// A página com os três ouvintes que importam, registrados na ORDEM dada: o fim
// do modo "saindo", a presença (o `Presenca.montar()` do `setupAppListeners`) e
// a descarga da janela do Desfazer (que liga o modo ao ir pro fundo).
function paginaComOuvintes(ordem) {
  const real = apiDeVerdade();
  const c = novoCliente({ agora: T });
  c.API.presencaApp = (x) => real.API.presencaApp(x);
  c.API.setSaindo = (v) => real.API.setSaindo(v);
  Object.defineProperty(c.API, 'saindo', { get: () => real.API.saindo, configurable: true });
  Object.assign(c.P.Presenca, { atualizadaEm: T, tentadaEm: T, pais: 30, tokenPedidoEm: T,
    chat: { token: 'tk', base: GOOGLE, chave: 'k', expiraEm: T + 20 * 3600e3 } });
  const registrar = {
    setupFimDoModoSaindo: () => montar(['setupFimDoModoSaindo'], { document: c.doc, window: c.win, API: real.API }).setupFimDoModoSaindo(),
    setupAppListeners: () => c.P.presencaMontar(),
    // A ação da janela do Desfazer sai com keepalive: a descarga LIGA o modo.
    setupDescargaAoSair: () => montar(['setupDescargaAoSair'], { document: c.doc, window: c.win, API: real.API,
      descarregarAcaoPendente: () => real.API.setSaindo(true), soltarReivindicacoes: () => {} }).setupDescargaAoSair(),
  };
  for (const n of ordem) registrar[n]();
  const listas = () => real.pedidos.filter((p) => p.rota === 'presenca-app');
  return { c, real, listas };
}
const visibilidade = (c, v) => { c.doc.visibilityState = v; for (const fn of c.doc._ouv.visibilitychange || []) fn(); };

// A ordem DE VERDADE dos três, lida do `initApp` (sem comentário: gotcha #67).
function ordemDoInitApp() {
  const init = fatiar('initApp');
  const posicao = (n) => init.search(new RegExp('^\\s*' + n + '\\(\\);', 'm'));
  const nomes = ['setupFimDoModoSaindo', 'setupAppListeners', 'setupDescargaAoSair'];
  assert.ok(posicao('setupAppListeners') > 0 && posicao('setupDescargaAoSair') > 0, 'PRÉ-CONDIÇÃO: o initApp não registra mais a presença ou a descarga');
  return nomes.filter((n) => posicao(n) >= 0).sort((a, b) => posicao(a) - posicao(b));
}

test('R8-5-02 voltar do fundo depois da descarga do Desfazer: a lista da presença sai SEM keepalive e COM o teto de 45 s (a ordem do initApp)', async () => {
  const caso = async (ordem) => {
    const p = paginaComOuvintes(ordem);
    visibilidade(p.c, 'hidden');                            // ✕ e o app vai pro fundo: a descarga
    assert.equal(p.real.API.saindo, true, 'CONTROLE: a descarga tinha que ligar o modo "saindo"');
    p.c.relogio.agora += 61_000;                            // passa o teto de um pedido por minuto
    visibilidade(p.c, 'visible');                           // e volta
    await tick(); await tick();
    return { listas: p.listas(), saindo: p.real.API.saindo };
  };
  const r = await caso(ordemDoInitApp());
  assert.equal(r.listas.length, 1, 'CONTROLE: a volta do fundo tinha que pedir a lista');
  assert.equal(r.listas[0].keepalive, false, 'DEFEITO: a lista da volta saiu com keepalive (o modo "saindo" ainda ligado)');
  assert.equal(r.listas[0].sinal, true, 'DEFEITO: a lista da volta saiu sem o teto de 45 s — pendurada, ela segura o `Presenca.pedindo`');
  assert.equal(r.saindo, false);
  // CONTROLE do instrumento: com o fim do modo registrado DEPOIS da presença (a
  // ordem de antes), o defeito aparece — o teste enxerga a ordem.
  const v = await caso(['setupAppListeners', 'setupDescargaAoSair', 'setupFimDoModoSaindo']);
  assert.equal(v.listas[0].keepalive, true, 'CONTROLE: na ordem de antes, a lista sairia com keepalive');
});

test('R8-5-02 a volta pelo bfcache (o `pageshow`): a lista sai sem keepalive também', async () => {
  const caso = async (ordem) => {
    const p = paginaComOuvintes(ordem);
    for (const fn of p.c.win._ouv.pagehide || []) fn({ persisted: true });   // a página vai pro bfcache
    p.real.API.setSaindo(true);                             // (o `pagehide` da descarga liga o modo)
    p.c.relogio.agora += 61_000;
    for (const fn of p.c.win._ouv.pageshow || []) fn({ persisted: true });   // e volta dele
    await tick(); await tick();
    return p.listas();
  };
  const r = await caso(ordemDoInitApp());
  assert.equal(r.length, 1, 'CONTROLE: a volta do bfcache tinha que pedir a lista');
  assert.equal(r[0].keepalive, false, 'DEFEITO: a lista da volta do bfcache saiu com keepalive');
  assert.equal(r[0].sinal, true);
  const v = await caso(['setupAppListeners', 'setupDescargaAoSair', 'setupFimDoModoSaindo']);
  assert.equal(v[0].keepalive, true, 'CONTROLE: na ordem de antes, a lista sairia com keepalive');
});

// ── R8-5-03 (= R8-6-02): "Minha área" com UM país na presença ────────────────

const EU = '12444348';
const CAF = '183164343';
// Quem está no app, por país: na França o "francois" (perto da área), no
// Brasil o "paulista". O servidor de mentira devolve a lista do país PEDIDO.
const NO_APP = { 73: [{ id: '700000001', nome: 'francois', rank: 4, lat: 48.86, lon: 2.34 }],
  30: [{ id: '300000001', nome: 'paulista', rank: 2, lat: -23.55, lon: -46.63 }] };
const CONVERSA = { id: CAF, nome: 'cafanha', naoLidas: 1, atividade: T - 1000,
  ultima: { deMim: false, ts: T - 1000, recibo: false, texto: 'oi', card: null } };

// O `paisDaFila` DE VERDADE (o app.js fatiado): a área na França (a pessoa
// edita SÓ a França neste servidor) e o filtro no Brasil.
function paisDaFilaDe({ myArea = true, editaveis = [73], filtro = 30 } = {}) {
  const AppState = { profile: { id: Number(EU) }, filters: { myArea } };
  const app = montar(['anotarEditaveis', 'editaveisLidos', 'paisDaMinhaArea', 'paisDaFila'], {
    AppState, editaveisPorServidor: { conta: null, lidos: {} }, API: { getCountry: () => filtro, getRegion: () => 'row' } });
  app.anotarEditaveis(AppState.profile, 'row', editaveis);
  return app.paisDaFila;
}
function comMinhaArea(opcoes) {
  const paisDaFila = paisDaFilaDe(opcoes);
  let pedidos = 0;
  const c = novoCliente({ agora: T, pais: (opcoes && opcoes.filtro) || 30, paisDaFila, api: {
    // Com TETO: um laço de pedidos (o país que nunca bate com o da lista) reprova
    // pela contagem, em vez de pendurar o teste (gotcha #19).
    presencaApp: (x) => (++pedidos > 10 ? new Promise(() => {})
      : { success: true, online: NO_APP[x.pais] || [], conversas: [], agora: c.relogio.agora }) } });
  c.AppState.currentPlace = { mapa: { centro: [48.8566, 2.3522] } };   // o card na tela: em Paris
  return { c, paisDaFila };
}
const subtitulo = (c) => { c.$('presencaModal').classList.remove('hidden'); c.P.presencaRenderLista(); return c.$('presencaSub').textContent; };

test('R8-5-03 com "Minha área" (a área na França, o filtro no Brasil): a lista é PEDIDA, mostrada e nomeada com o país da área — o da marca', async () => {
  const { c, paisDaFila } = comMinhaArea();
  assert.equal(paisDaFila(), 73, 'PRÉ-CONDIÇÃO: o país da fila (o da marca) tem que ser o da área');
  assert.match(subtitulo(c), /France/, 'DEFEITO: antes da primeira lista, o subtítulo nomeia o país do filtro');
  await c.P.presencaAtualizar();
  assert.deepEqual(c.chamadas.presencaApp.map((x) => x.pais), [73],
    'DEFEITO: a lista foi pedida com o país do FILTRO — a pessoa aparece na França e vê o Brasil');
  assert.deepEqual(c.P.Presenca.online.map((p) => p.nome), ['francois']);
  assert.match(subtitulo(c), /France/, 'DEFEITO: o subtítulo da folha nomeia o país do filtro');
  // A lista fresca do MESMO país não se pede de novo a cada "Aplicar".
  await c.P.presencaSincronizar();
  assert.equal(c.chamadas.presencaApp.length, 1, 'a lista fresca do país da área foi pedida de novo (a conferência comparava com o filtro)');
  // CONTROLE: sem "Minha área", vale o país do filtro.
  const s = comMinhaArea({ myArea: false });
  await s.c.P.presencaAtualizar();
  assert.deepEqual(s.c.chamadas.presencaApp.map((x) => x.pais), [30]);
  assert.match(subtitulo(s.c), /Brazil/);
});

test('R8-5-03 a lista que volta de CARONA (a do país da área, que a carona levou) entra — com "Minha área" ela era jogada fora em toda ação', async () => {
  const { c, paisDaFila } = comMinhaArea();
  c.relogio.agora += 1000;
  c.P.presencaAoCarona({ online: NO_APP[73], conversas: [CONVERSA] }, c.relogio.agora - 100, paisDaFila());
  assert.deepEqual(c.P.Presenca.online.map((p) => p.nome), ['francois'], 'DEFEITO: a lista da carona (a do país da marca) foi jogada fora');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'DEFEITO: a conversa da carona foi jogada fora junto');
  assert.equal(String(c.P.Presenca.pais), '73');
});

test('R8-5-03 a carona de OUTRO país (a pessoa trocou de país com a ação no ar): a lista fica de fora, mas as CONVERSAS entram', async () => {
  const c = novoCliente({ agora: T, pais: 30 });
  Object.assign(c.P.Presenca, { pais: 30, atualizadaEm: T - 5000, online: NO_APP[30].slice() });
  c.P.presencaAoCarona({ online: NO_APP[73], conversas: [CONVERSA] }, T, 73);
  assert.deepEqual(c.P.Presenca.online.map((p) => p.nome), ['paulista'], 'a lista de outro país entrou como a do país de agora');
  assert.equal(String(c.P.Presenca.pais), '30', 'o país da lista na tela mudou com a carona de outro país');
  assert.equal(c.P.Presenca.atualizadaEm, T - 5000, 'a lista na tela contou como atualizada pela carona de outro país');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'DEFEITO: as conversas da carona (que não têm país) foram jogadas fora junto com a lista');
  // CONTROLE: a carona do MESMO país entra inteira.
  c.P.presencaAoCarona({ online: NO_APP[30].concat([{ id: '300000002', nome: 'carioca', rank: 1 }]), conversas: [] }, T + 10, 30);
  assert.deepEqual(c.P.Presenca.online.map((p) => p.nome), ['paulista', 'carioca']);
});
