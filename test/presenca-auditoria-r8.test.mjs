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
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const GOOGLE = 'https://instantmessaging-pa.googleapis.com/';

// ── R8-5-01: o tempo real parado pela falta de rede ──────────────────────────

// O fluxo aberto com um token que vale, e o Google inalcançável: ele cai, a
// pessoa está no modo avião (`onLine` falso) e o recuo vence SEM rede — o fluxo
// fica PARADO. Depois a rede volta, SEM o evento `online` (o iPhone). `token`:
// 'vale' (vale mais de uma hora), 'ultimaHora' (abre o fluxo, mas já é hora de
// renovar) ou null (sem token).
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
  // Até o lote 12, sem rede ele não deixava timer nenhum; desde o lote 13
  // (R9-5-03) o recuo do próprio fluxo segue de pé, e religa a conversa que a
  // pessoa só olha. Aqui se mede a prova de rede, que chega ANTES dele.
  if (token) {
    assert.equal(c.P.Presenca.fluxoParado, true, 'CONTROLE: sem rede, o tempo real tinha que PARAR');
    assert.equal(c.timers.length, 1, 'CONTROLE: sem rede, o que fica de pé tem que ser só o recuo do fluxo parado');
  } else assert.equal(c.timers.length, 0, 'CONTROLE: sem token não há fluxo, nem recuo');
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
  // A abertura com a sessão salva: ela vai pra memória — as rotas mandam a da
  // memória, nunca a do aparelho (R13-1-04).
  ctx.API.getSession();
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

// ── R8-5-04, 05 e 06: a dívida do "lida" ─────────────────────────────────────

const OUTRA = '555000111';
const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo real.
const chega = async (c, n) => c.P.presencaQuadro(fluxoDe(c), { inboxMessage: { messageId: uuid(900 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
const lidas = (c, com = CAF) => c.chamadas.chat.filter((x) => x.acao === 'lida' && x.com === com);
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pilula = (c) => ({ escondida: c.$('presencaPill').classList.contains('hidden'),
  balao: !c.$('presencaIconMsg').classList.contains('hidden'), selo: c.$('presencaCount').textContent });
const SEM_REDE = { success: false, errorCategory: 'transient', _motivo: 'TypeError' };

// O Waze de mentira, que sobrevive à PÁGINA (o mesmo servidor pra cada
// abertura do app): as mensagens da CAF (a `n` tem a hora `T + n`) e quais
// seguem NÃO LIDAS. O "lida" (e o `abrir`) marca a conversa INTEIRA. `fora`
// derruba o "lida"; `segurar` prende os "lida" no ar até o teste soltar.
function wazeDeMentira() {
  const w = { fora: false, segurar: false, presos: [], dela: [] };
  const marcar = (com) => { if (com === CAF) for (const m of w.dela) m.lida = true; };
  const conversaDaCaf = () => {
    const u = w.dela.reduce((a, m) => (!a || m.ts > a.ts ? m : a), null);
    return { id: CAF, nome: 'cafanha', naoLidas: w.dela.filter((m) => !m.lida).length, atividade: u ? u.ts : 0,
      ultima: u ? { deMim: false, ts: u.ts, recibo: false, texto: 'x', card: null } : null };
  };
  w.guardar = (n) => w.dela.push({ n, ts: T + n, lida: false });
  w.naoLida = (n) => w.dela.some((m) => m.n === n && !m.lida);
  w.lista = () => ({ online: [], conversas: [conversaDaCaf()] });
  // Uma página (uma abertura do app). `de`: o aparelho da página anterior.
  w.pagina = ({ de = null, agora = T } = {}) => {
    const c = novoCliente({ agora, api: {
      chat: (x) => {
        if (x.acao === 'abrir') { marcar(x.com); return { success: true, mensagens: [], maisAntigas: false, lida: true }; }
        if (x.acao !== 'lida') return { success: true };
        const responder = () => { if (w.fora) return SEM_REDE; marcar(x.com); return { success: true }; };
        if (w.segurar) return new Promise((ok) => w.presos.push((r) => { if (r && r.success) marcar(x.com); ok(r || responder()); }));
        return responder();
      },
      presencaApp: () => ({ success: true, ...w.lista(), agora: c.relogio.agora }),
    } });
    if (de) for (const [k, v] of de.armazenado) c.armazenado.set(k, v);
    c.P.presencaMontar();
    return c;
  };
  return w;
}

// A conversa com a CAF aberta e a mensagem 1 dela VISTA, com o "lida" falhando
// (sem sinal): a dívida fica.
async function vistaSemSinal(w, c) {
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();       // a rajada do `abrir` (nada a marcar)
  w.fora = true;
  w.guardar(1);
  await chega(c, 1);                                        // a 1, NA TELA
  await c.rodarTimers(); await tick();                      // a rajada: falha
  assert.deepEqual([...c.P.Presenca.lidaDevendo], [CAF], 'CONTROLE: a dívida tem que ter nascido');
}
const irProFundoESair = (c) => {
  c.doc.visibilityState = 'hidden';
  for (const fn of c.doc._ouv.visibilitychange || []) fn();
  for (const fn of c.win._ouv.pagehide || []) fn({ persisted: false });
};

test('R8-5-04 vista sem sinal e o app fechado sem sinal: a dívida fica GUARDADA, e reaberto o app a vista não volta como nova — e o "lida" sai', async () => {
  const w = wazeDeMentira();
  const c = w.pagina();
  await vistaSemSinal(w, c);
  irProFundoESair(c);                                       // fecha o app, ainda sem sinal
  await tick(); await tick();
  assert.deepEqual(c.guardado().devendo, { [CAF]: { ate: T + 1, n: 1 } },
    'DEFEITO: a dívida do "lida" não ficou no aparelho — morre com a página');
  // Reabre, com rede: outra página, o MESMO aparelho.
  w.fora = false;
  const c2 = w.pagina({ de: c, agora: T + 600_000 });
  await c2.P.presencaSincronizar();                         // a abertura
  await tick(); await tick();
  assert.equal(c2.P.presencaNaoLidasDe(CAF), 0, 'DEFEITO: reaberto o app, a mensagem VISTA voltou como "1 mensagem nova"');
  assert.deepEqual(pilula(c2), { escondida: true, balao: false, selo: '' }, 'a pílula virou balão com a mensagem vista');
  assert.equal(lidas(c2).length, 1, 'DEFEITO: a reabertura não pagou a dívida guardada');
  assert.equal(w.naoLida(1), false, 'a mensagem vista seguiu não lida no Waze');
  assert.equal(c2.guardado().devendo, undefined, 'a dívida paga ficou no aparelho');
  // E a página seguinte não paga de novo.
  const c3 = w.pagina({ de: c2, agora: T + 900_000 });
  await c3.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(c3).length, 0, 'a dívida paga saiu de novo na abertura seguinte');
});

test('R8-5-04 CONTROLES: a rede volta antes de fechar (nada guardado); com mensagem NOVA dela, a dívida guardada sai sem pagar e a conta fica', async () => {
  // (a) O "lida" do `pagehide` chega: nada fica devendo no aparelho.
  const w = wazeDeMentira();
  const c = w.pagina();
  await vistaSemSinal(w, c);
  w.fora = false;
  irProFundoESair(c);
  await tick(); await tick();
  assert.equal(w.naoLida(1), false, 'CONTROLE: o "lida" do fechamento tinha que chegar');
  assert.equal(c.guardado().devendo, undefined, 'a dívida paga ficou no aparelho');
  // (b) Fechado devendo; a CAF manda a 2, que a pessoa não viu: a dívida
  // guardada não paga (marcaria a 2) e a conta (as duas) fica.
  const v = wazeDeMentira();
  const d = v.pagina();
  await vistaSemSinal(v, d);
  irProFundoESair(d);
  await tick(); await tick();
  v.fora = false;
  v.guardar(2);
  const d2 = v.pagina({ de: d, agora: T + 600_000 });
  await d2.P.presencaSincronizar();
  await tick(); await tick();
  assert.equal(d2.P.presencaNaoLidasDe(CAF), 2, 'a mensagem 2 (não vista) sumiu da conta');
  assert.equal(lidas(d2).length, 0, 'a dívida guardada foi paga com a mensagem 2, que ninguém viu');
  assert.equal(v.naoLida(2), true);
  assert.equal(d2.guardado().devendo, undefined, 'a dívida que deixou de valer ficou no aparelho');
  // (c) Fechado devendo, e a vista LIDA no Waze depois (o "lida" do fechamento
  // chegou e a resposta se perdeu com a página, ou a pessoa leu pelo WME): a
  // reabertura não tem o que pagar — e não pede nada.
  const x = wazeDeMentira();
  const e = x.pagina();
  await vistaSemSinal(x, e);
  irProFundoESair(e);
  await tick(); await tick();
  x.fora = false;
  x.dela.forEach((m) => { m.lida = true; });
  const e2 = x.pagina({ de: e, agora: T + 600_000 });
  await e2.P.presencaSincronizar();
  await tick(); await tick();
  assert.equal(lidas(e2).length, 0, 'a reabertura pagou uma dívida que o Waze já não conta');
  assert.equal(e2.guardado().devendo, undefined, 'a dívida sem nada a pagar ficou no aparelho');
});

test('R8-5-04 o app fecha com o pagamento da dívida NO AR (a página morre antes da resposta): a dívida segue guardada', async () => {
  // A dívida só sai do aparelho quando o pagamento CHEGA: tirada quando ele
  // sai, a página que morre com ele no ar a levava junto.
  const w = wazeDeMentira();
  const c = w.pagina();
  await vistaSemSinal(w, c);
  w.segurar = true;                                         // o pagamento do fechamento fica no ar…
  irProFundoESair(c);                                       // …e a página morre
  await tick(); await tick();
  assert.equal(w.presos.length, 1, 'CONTROLE: o pagamento tinha que estar no ar');
  assert.deepEqual(c.guardado().devendo, { [CAF]: { ate: T + 1, n: 1 } },
    'DEFEITO: a dívida saiu do aparelho com o pagamento ainda no ar — a página morreu e a perdeu');
});

test('R8-5-04 a dívida GUARDADA sai no "Sair" (com a chave do chat), e a queda da sessão a mantém pra mesma conta', async () => {
  const w = wazeDeMentira();
  const c = w.pagina();
  await vistaSemSinal(w, c);
  assert.ok(c.guardado().devendo, 'CONTROLE: a dívida tem que estar no aparelho');
  // A queda (o `presencaDesligar`): a memória sai, o aparelho fica — e a mesma
  // conta, de volta, adota e paga na primeira lista.
  c.P.presencaDesligar();
  assert.equal(c.P.Presenca.lidaDevendo.size, 0);
  assert.ok(c.guardado().devendo, 'a queda apagou a dívida guardada da mesma conta');
  w.fora = false;
  c.relogio.agora += 61_000;
  await c.P.presencaSincronizar();
  await tick(); await tick();
  assert.equal(w.naoLida(1), false, 'a dívida guardada não foi paga depois da queda');
  // O "Sair": sai tudo do chat, a dívida junto.
  const s = wazeDeMentira();
  const d = s.pagina();
  await vistaSemSinal(s, d);
  d.P.presencaEsquecer();
  assert.equal(d.armazenado.has('waze_places_chat'), false, 'o "Sair" deixou a dívida no aparelho');
});

test('R8-5-05 a lista que chega com o pagamento da dívida NO AR não devolve a vista como nova — e o "1" não fica quando ele falha', async () => {
  const caso = async ({ noAr = true, resposta = SEM_REDE } = {}) => {
    const w = wazeDeMentira();
    const c = w.pagina();
    await vistaSemSinal(w, c);
    fechar(c);                                              // o fechamento paga… e falha de novo
    await tick();
    w.fora = false;
    if (noAr) {
      w.segurar = true;
      c.P.presencaAbrirConversa(OUTRA); await tick();       // fechar OUTRA conversa paga a dívida: o pedido fica no ar
      fechar(c); await tick();
      assert.equal(w.presos.length, 1, 'CONTROLE: o pagamento tinha que estar no ar');
    }
    c.relogio.agora += 40_000;
    c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);   // a carona de um ✕
    await tick();
    const comNoAr = c.P.presencaNaoLidasDe(CAF);
    if (noAr) { w.presos.shift()(resposta); await tick(); await tick(); }
    return { comNoAr, depois: c.P.presencaNaoLidasDe(CAF), pilula: pilula(c), devendo: [...c.P.Presenca.lidaDevendo] };
  };
  const r = await caso();
  assert.equal(r.comNoAr, 0, 'DEFEITO: com o pagamento no ar, a lista devolveu a mensagem VISTA como "1 mensagem nova"');
  assert.equal(r.depois, 0, 'DEFEITO: o pagamento falhou e o "1" ficou');
  assert.deepEqual(r.pilula, { escondida: true, balao: false, selo: '' });
  assert.deepEqual(r.devendo, [CAF], 'o pagamento que falhou não voltou a dever');
  // CONTROLES: o pagamento dá certo → 0; sem pagamento no ar → 0 (a dívida, R7-5-02).
  const a = await caso({ resposta: { success: true } });
  assert.equal(a.depois, 0);
  assert.deepEqual(a.devendo, []);
  const b = await caso({ noAr: false });
  assert.equal(b.comNoAr, 0);
});

test('R8-5-05 o "lida" da RAJADA no ar vale igual: a conversa fechada com ele voando não volta como nova com a carona', async () => {
  const w = wazeDeMentira();
  const c = w.pagina();
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();
  w.segurar = true;
  w.guardar(1);
  await chega(c, 1);                                        // a 1, na tela
  await c.rodarTimers(); await tick();                      // o "lida" da rajada sai e fica no ar
  assert.equal(w.presos.length, 1, 'CONTROLE: o "lida" da rajada tinha que estar no ar');
  fechar(c);
  await tick();
  c.relogio.agora += 40_000;
  c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);
  await tick();
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'DEFEITO: com o "lida" no ar, a carona devolveu a vista como "1 mensagem nova"');
  // CONTROLE: com mensagem NOVA dela (que a pessoa não viu), a carona conta.
  w.guardar(2);
  c.relogio.agora += 40_000;
  c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);
  await tick();
  assert.equal(c.P.presencaNaoLidasDe(CAF), 2, 'a mensagem 2 (não vista) sumiu da conta com o "lida" no ar');
});

test('R8-5-06 o "lida" pago ao ir pro fundo ainda NO AR e a volta rápida: o mesmo "lida" não sai duas vezes', async () => {
  const caso = async ({ primeiroVoltaAntes = false, primeiroFalha = false } = {}) => {
    const w = wazeDeMentira();
    const c = w.pagina();
    c.P.Presenca.conversas = [w.lista().conversas[0]];
    c.P.presencaAbrirConversa(CAF);
    await tick(); await c.rodarTimers(); await tick();
    w.segurar = true;
    w.guardar(1);
    await chega(c, 1);                                      // a 1 chega NA TELA: a rajada corre
    c.doc.visibilityState = 'hidden';                       // a pessoa troca de app: paga com keepalive
    for (const fn of c.doc._ouv.visibilitychange || []) fn();
    assert.equal(lidas(c).length, 1, 'CONTROLE: o "lida" tinha que sair ao ir pro fundo');
    if (primeiroVoltaAntes) { w.presos.shift()({ success: true }); await tick(); await tick(); }
    c.relogio.agora += 500;
    c.doc.visibilityState = 'visible';                      // e volta meio segundo depois
    for (const fn of c.doc._ouv.visibilitychange || []) fn();
    await c.rodarTimers(); await tick(); await tick();      // a rajada da volta vence
    const total = lidas(c).length;
    if (w.presos.length) { w.presos.shift()(primeiroFalha ? SEM_REDE : { success: true }); await tick(); await tick(); }
    const devendo = [...c.P.Presenca.lidaDevendo];
    w.segurar = false;
    fechar(c);                                              // o fechamento paga o que ficou devendo
    await tick(); await tick();
    return { total, devendo, naoLida: w.naoLida(1), pagoNoFechamento: lidas(c).length };
  };
  const r = await caso();
  assert.equal(r.total, 1, 'DEFEITO: com o primeiro "lida" no ar, a rajada da volta mandou o mesmo "lida" de novo');
  assert.equal(r.naoLida, false);
  // Se o do fundo FALHA, a conversa volta a dever, e o fechamento a paga — o
  // registro do "lida" no ar sai com a resposta, e não segura o pagamento.
  const f = await caso({ primeiroFalha: true });
  assert.equal(f.total, 1);
  assert.deepEqual(f.devendo, [CAF], 'o "lida" no ar que falhou não voltou a dever');
  assert.equal(f.pagoNoFechamento, 2, 'o fechamento não pagou a dívida do "lida" que falhou (o registro do no ar ficou)');
  // CONTROLE: a resposta do primeiro chega antes da volta — a rajada não tem o que marcar.
  const k = await caso({ primeiroVoltaAntes: true });
  assert.equal(k.total, 1);
});

test('R8-5-06 o "lida" no ar segura os seguintes só até o teto do `_post`: pendurado, ele não trava o "lida" da conversa', async () => {
  const w = wazeDeMentira();
  const c = w.pagina();
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();
  w.segurar = true;
  w.guardar(1);
  await chega(c, 1);
  await c.rodarTimers(); await tick();                      // o "lida" da rajada, pendurado
  assert.equal(lidas(c).length, 1);
  c.P.presencaAgendarLida(CAF);                             // a volta pra tela, dentro do teto
  await c.rodarTimers(); await tick();
  assert.equal(lidas(c).length, 1, 'dentro do teto, o mesmo "lida" saiu de novo');
  c.relogio.agora += 46_000;                                // passou o teto: o pendurado não segura mais
  c.P.presencaAgendarLida(CAF);
  await c.rodarTimers(); await tick();
  assert.equal(lidas(c).length, 2, 'o "lida" pendurado travou o da conversa pra sempre');
});

// ── R8-5-07: o "invisível" repetido pela outra aba ───────────────────────────

// Um aparelho com ABAS (o padrão do `presenca-auditoria-r7`): o armazenamento é
// um só, e a memória (presencaWme, AppState) é de cada uma. `resposta` responde
// o `presenca-waze` — uma promessa que não volta é o envio NO AR.
function aparelho() {
  const guardado = new Map();
  const localStorage = {
    getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => guardado.set(k, String(v)),
    removeItem: (k) => guardado.delete(k),
  };
  const pedidos = [];
  const relogio = { agora: T };
  return {
    guardado, pedidos, relogio,
    gravado: () => (JSON.parse(guardado.get('waze_places_preferences') || '{}').presencaWmeDesligar || null),
    pagina({ nome = 'aba', resposta = () => ({ success: true }) } = {}) {
      // A página LOGADA, com a sessão na memória (R11-1-02).
      const AppState = { authenticated: true, preferences: { undoEnabled: true, semUndoSeguidas: 0, presenca: true, pularGuarda: false }, profile: { id: Number(EU) } };
      const presencaWme = { ligarNaProxima: false, desligarPendente: false, desligarEm: 0, desligarSessao: null, desligarVez: 0, desligarNoAr: 0 };
      const h = montar(['marcaDaSessao', 'savePreferences', 'lerPreferenciasGuardadas', 'preferenciasDeFabrica',
        'relerPreferenciasDeOutraAba', 'presencaWmeDesligar', 'presencaWmeGravarPendente', 'presencaWmeEsquecerGravado',
        'presencaWmeAnotarDesligar', 'presencaWmeRefazerDesligar', 'presencaWmeReligar', 'presencaWmeZerar',
        'presencaWmeSoltarAoSair'], {
        AppState, presencaWme, localStorage, PREFERENCES_KEY: constante('PREFERENCES_KEY'), preferenciasCarregadas: true,
        CONTA_KEY: constante('CONTA_KEY'), PRESENCA_WME_DESLIGAR_REPETIR_MS: constante('PRESENCA_WME_DESLIGAR_REPETIR_MS'),
        safeLS: { get: (k) => localStorage.getItem(k) }, dfato: () => {}, Date: { now: () => relogio.agora },
        API: { getSession: () => 'tok', temSessaoNaMemoria: () => true, sessionToken: 'tok',
          presencaWaze: async (c) => { pedidos.push({ aba: nome, em: relogio.agora, ...c }); return resposta(c); } },
        desenharChavesDePreferencia: () => {}, atualizarSeloDePular: () => {}, atualizarLinhaDoOffline: () => {},
        offlineEsquecer: () => {}, window: { Presenca: { desligar: () => {}, renderPilula: () => {} } },
      });
      h.lerPreferenciasGuardadas();
      // O gesto, na ordem do ouvinte do interruptor (`prefPresenca`).
      const desligar = () => { AppState.preferences.presenca = false; AppState.preferences.presencaOffEm = relogio.agora; h.presencaWmeDesligar(); h.savePreferences(); };
      return { ...h, AppState, presencaWme, desligar, fechar: () => h.presencaWmeSoltarAoSair() };
    },
  };
}
const esperaTick = () => new Promise((r) => setTimeout(r, 0));
const WAZE_FORA = { success: false, errorCategory: 'transient', errorKey: 'srv.err.connection' };

test('R8-5-07 duas abas vivas e o envio da aba do gesto NO AR: a outra não manda o mesmo "invisível" (nem antes, nem depois da resposta)', async () => {
  const a = aparelho();
  const soltar = [];
  const A = a.pagina({ nome: 'A', resposta: () => new Promise((ok) => soltar.push(ok)) });
  const B = a.pagina({ nome: 'B' });
  A.desligar();                                             // o envio de A fica no ar (sinal fraco)
  await esperaTick();
  B.relerPreferenciasDeOutraAba();                          // o aviso `storage` chega à B
  for (let i = 0; i < 3; i++) {                             // as respostas da API na B (os ✕ dela)
    a.relogio.agora += 5_000;
    B.presencaWmeRefazerDesligar();
    await esperaTick();
  }
  assert.deepEqual(a.pedidos.map((x) => x.aba), ['A'], 'DEFEITO: a outra aba mandou o mesmo "invisível" com o de A no ar');
  soltar[0]({ success: true });                             // e o envio de A chega, bem
  await esperaTick();
  a.relogio.agora += 61_000;
  B.presencaWmeRefazerDesligar();
  await esperaTick();
  assert.deepEqual(a.pedidos.map((x) => x.aba), ['A'], 'o "invisível" que A entregou saiu de novo pela B');
  assert.equal(a.gravado(), null);
});

test('R8-5-07 CONTROLES: a aba do gesto FECHA com o envio no ar → a outra manda na hora; morta sem `pagehide` → só depois do teto', async () => {
  // (a) Fechou (o `pagehide`): o envio morreu com ela, e o carimbo sai.
  const a = aparelho();
  const A = a.pagina({ nome: 'A', resposta: () => new Promise(() => {}) });
  const B = a.pagina({ nome: 'B' });
  A.desligar();
  await esperaTick();
  A.fechar();
  B.relerPreferenciasDeOutraAba();
  a.relogio.agora += 5_000;
  B.presencaWmeRefazerDesligar();
  await esperaTick();
  assert.deepEqual(a.pedidos.map((x) => x.aba), ['A', 'B'], 'a aba que fechou com o envio no ar segurou o "invisível" na outra');
  assert.equal(a.gravado(), null);
  // (b) Morta SEM `pagehide` (o sistema encerrou o app): a outra espera o teto do último envio, e manda.
  const m = aparelho();
  const M = m.pagina({ nome: 'A', resposta: () => new Promise(() => {}) });
  const N = m.pagina({ nome: 'B' });
  M.desligar();
  await esperaTick();
  N.relerPreferenciasDeOutraAba();
  m.relogio.agora += 10_000;
  N.presencaWmeRefazerDesligar();
  await esperaTick();
  assert.deepEqual(m.pedidos.map((x) => x.aba), ['A'], 'CONTROLE: dentro do teto, a outra aba não manda');
  m.relogio.agora += 51_000;
  N.presencaWmeRefazerDesligar();
  await esperaTick();
  assert.deepEqual(m.pedidos.map((x) => x.aba), ['A', 'B'], 'passado o teto, o "invisível" de quem morreu no ar nunca saiu');
});

test('R8-5-07 o Waze fora com DUAS abas: o teto de um por minuto é do aparelho — os mesmos envios de uma aba só', async () => {
  const contar = async (abas) => {
    const a = aparelho();
    const A = a.pagina({ nome: 'A', resposta: () => WAZE_FORA });
    const B = abas === 2 ? a.pagina({ nome: 'B', resposta: () => WAZE_FORA }) : null;
    A.desligar();
    await esperaTick();
    if (B) B.relerPreferenciasDeOutraAba();
    // 5 min, uma resposta da API a cada 10 s em cada aba (a ordem entre elas alterna).
    for (let s = 0; s < 300; s += 10) {
      a.relogio.agora += 10_000;
      const vez = B && (s / 10) % 2 ? [B, A] : [A, B];
      for (const x of vez) if (x) { x.presencaWmeRefazerDesligar(); await esperaTick(); }
    }
    return a.pedidos;
  };
  const uma = await contar(1);
  const duas = await contar(2);
  assert.equal(uma.length, 6, 'CONTROLE: com uma aba, um envio por minuto');
  assert.equal(duas.length, uma.length, `DEFEITO: com duas abas, ${duas.length} envios em 5 min contra ${uma.length} com uma`);
  for (let i = 1; i < duas.length; i++) assert.ok(duas[i].em - duas[i - 1].em >= 60_000, 'dois envios a menos de um minuto um do outro');
});

test('R8-5-07 o "invisível" que a outra aba ENTREGOU tira o pendente desta — e o carimbo sobrevive à gravação de preferências da outra', async () => {
  // (a) As duas abas com o pendente (o Waze fora); a B entrega: a A não manda de novo.
  const a = aparelho();
  let fora = true;
  const resp = () => (fora ? WAZE_FORA : { success: true });
  const A = a.pagina({ nome: 'A', resposta: resp });
  const B = a.pagina({ nome: 'B', resposta: resp });
  A.desligar();
  await esperaTick();
  B.relerPreferenciasDeOutraAba();
  a.relogio.agora += 61_000;
  B.presencaWmeRefazerDesligar();                           // a B adota e manda (falha: o Waze fora)
  await esperaTick();
  assert.equal(A.presencaWme.desligarPendente && B.presencaWme.desligarPendente, true, 'CONTROLE: as duas abas tinham que ficar com o pendente');
  fora = false;
  a.relogio.agora += 61_000;
  B.presencaWmeRefazerDesligar();                           // a B entrega
  await esperaTick();
  assert.equal(a.gravado(), null, 'CONTROLE: a entrega tinha que apagar o gravado');
  a.relogio.agora += 61_000;
  A.presencaWmeRefazerDesligar();
  await esperaTick();
  assert.deepEqual(a.pedidos.map((x) => x.aba), ['A', 'B', 'B'], 'DEFEITO: a aba A mandou de novo o "invisível" que a B já tinha entregado');
  // (b) A B grava as preferências dela (outra chave) com o envio de A no ar: o
  // carimbo de A não pode sumir do aparelho — sem ele, a B manda de novo.
  const c = aparelho();
  const C = c.pagina({ nome: 'A', resposta: () => new Promise(() => {}) });
  const D = c.pagina({ nome: 'B' });
  C.desligar();
  await esperaTick();
  D.relerPreferenciasDeOutraAba();
  assert.ok(Number.isFinite(D.AppState.preferences.presencaWmeDesligar.tentadoEm), 'a releitura da outra aba perdeu o carimbo do envio');
  D.AppState.preferences.undoEnabled = false;               // um toque nas Preferências da B
  D.savePreferences();
  c.relogio.agora += 5_000;
  D.presencaWmeRefazerDesligar();
  await esperaTick();
  assert.deepEqual(c.pedidos.map((x) => x.aba), ['A'], 'a gravação de preferências da outra aba apagou o carimbo — e ela mandou de novo');
});

test('R8-5-07 quem tira o carimbo ao sair é o `pagehide` da página (a página só escondida o mantém)', () => {
  const chamou = [];
  const doc = { _ouv: {}, addEventListener(t, fn) { (this._ouv[t] ||= []).push(fn); } };
  const win = { _ouv: {}, addEventListener(t, fn) { (this._ouv[t] ||= []).push(fn); } };
  montar(['setupDescargaAoSair'], { document: doc, window: win, API: {},
    descarregarAcaoPendente: () => chamou.push('descarga'), soltarReivindicacoes: () => chamou.push('marcas'),
    presencaWmeSoltarAoSair: () => chamou.push('invisivel') }).setupDescargaAoSair();
  doc.visibilityState = 'hidden';
  for (const fn of doc._ouv.visibilitychange || []) fn();
  assert.deepEqual(chamou, ['descarga'], 'a página só ESCONDIDA tirou o carimbo do "invisível" no ar (ela segue viva)');
  for (const fn of win._ouv.pagehide || []) fn({ persisted: false });
  assert.deepEqual(chamou, ['descarga', 'descarga', 'marcas', 'invisivel'], 'o `pagehide` não tira o carimbo do "invisível" no ar');
});

test('R8-5-07 a prova de rede de quem só deixou o interruptor desligado (nada pendente, nada gravado) não lê o aparelho', async () => {
  // A repetição lê o gravado do aparelho — mas ela roda a CADA resposta da API
  // (uma por swipe), e no estado comum (o "invisível" já entregue) não há o que
  // ler: a cópia desta aba (que a releitura das preferências mantém) basta.
  const a = aparelho();
  const A = a.pagina({ nome: 'A' });
  A.desligar();
  await esperaTick();
  assert.equal(a.gravado(), null, 'CONTROLE: o "invisível" tinha que ter sido entregue');
  let leituras = 0;
  const getItem = a.guardado.get.bind(a.guardado);
  a.guardado.get = (k) => { leituras += 1; return getItem(k); };
  for (let i = 0; i < 5; i++) { a.relogio.agora += 61_000; A.presencaWmeRefazerDesligar(); }
  await esperaTick();
  assert.equal(leituras, 0, 'cada resposta da API leu as preferências do aparelho sem nada pendente');
  assert.equal(a.pedidos.length, 1);
});
