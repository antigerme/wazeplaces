// "Pular guarda o pedido" — a preferência que liga o ↑ à estrela do editor.
//
// Três promessas, e cada teste aqui existe pra reprovar se uma delas quebrar:
//   1. a preferência nasce DESLIGADA e só liga quem disse que quer;
//   2. DESLIGADA, o Pular continua sendo o que sempre foi: rede ZERO;
//   3. LIGADA, o que a app FAZ e o que ela DIZ são a mesma coisa (o selo).
//
// O app.js é script de browser, não módulo, então o teste FATIA a fonte e a
// executa num escopo de mentira — mesmo padrão de test/preferencias.test.mjs.
// Fatiar em vez de reimplementar é o que garante que o teste exercite o código
// que roda no aparelho, e não uma cópia que envelhece (gotcha #52).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { dispatch, makeSessions } from '../server/core.mjs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Âncora em DECLARAÇÃO, nunca em distância (gotcha #67).
function fatiarFuncao(nome) {
  const ini = APP.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu do app.js`);
  // Fecha na PRÓXIMA declaração de topo, que é estrutura e não distância.
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:function |const |\/\/ ──)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return APP.slice(ini, ini + 1 + fim);
}

// ── 1. O PADRÃO ────────────────────────────────────────────────────────────
test('a preferência nasce DESLIGADA, e só liga quem disse que quer', () => {
  const padrao = APP.match(/preferences: \{[^}]*\}/);
  assert.ok(padrao, 'o objeto de preferências padrão sumiu');
  assert.match(padrao[0], /pularGuarda:\s*false/,
    'a preferência deixou de nascer desligada — o Pular passaria a escrever sem ninguém pedir');

  // Opt-IN estrito na carga: qualquer coisa que não seja `true` fica desligado.
  // `!== false` (o padrão do undo, que é opt-OUT) ligaria pra quem nunca decidiu.
  const carga = APP.match(/AppState\.preferences\.pularGuarda = parsed\.pularGuarda[^;]*;/);
  assert.ok(carga, 'a carga da preferência sumiu do loadPreferences');
  assert.match(carga[0], /=== true/,
    'a carga virou opt-out: quem nunca abriu as Preferências passaria a guardar sem ter pedido');
});

// ── 2. A PROMESSA DO PULAR ─────────────────────────────────────────────────
function rodarSkip({ pularGuarda }) {
  const chamadas = [];
  const agendadas = [];
  const escopo = {
    AppState: {
      currentPlace: { venueID: 'v1', updateRequestID: 'ur1', name: 'Bar do Zé' },
      queue: [], stats: { skipped: 0 }, preferences: { pularGuarda },
    },
    acoesTravadas: () => false,
    Treino: { ativo: false },
    updateStats: () => {}, saveStats: () => {}, advanceQueue: () => {},
    scheduleAction: (tipo, place, executor) => { agendadas.push({ tipo, place, executor }); },
    API: { guardarPedido: async (v, u, val) => { chamadas.push({ v, u, val }); return { success: true }; } },
    callWithRetry: (fn) => fn(),
    showToast: () => {}, t: (k) => k, msgDoServidor: (r, txt) => txt,
  };
  const nomes = Object.keys(escopo);
  const fn = new Function(...nomes, fatiarFuncao('handleSkip') + '\nreturn handleSkip;')(...nomes.map((n) => escopo[n]));
  fn();
  return { chamadas, agendadas, stats: escopo.AppState.stats };
}

test('DESLIGADA, o Pular não fala com a rede — e o executor existe só pela janela do Desfazer', async () => {
  const r = rodarSkip({ pularGuarda: false });
  assert.equal(r.stats.skipped, 1, 'o Pular deixou de contar');
  assert.equal(r.agendadas.length, 1, 'o Pular deixou de passar pelo scheduleAction (perde o Desfazer)');
  await r.agendadas[0].executor();
  assert.equal(r.chamadas.length, 0,
    'o Pular passou a escrever no Waze com a preferência DESLIGADA — a saída barata da app deixou de ser barata');
});

test('LIGADA, o Pular guarda o pedido — e guarda o pedido CERTO', async () => {
  const r = rodarSkip({ pularGuarda: true });
  await r.agendadas[0].executor();
  assert.equal(r.chamadas.length, 1, 'a preferência está ligada e nada foi guardado');
  assert.deepEqual(r.chamadas[0], { v: 'v1', u: 'ur1', val: true },
    'guardou com os ids errados, ou sem o valor explícito');
});

test('a decisão é do MOMENTO DO GESTO, não do despacho', async () => {
  // A janela do Desfazer dura segundos e o modal de Preferências continua
  // alcançável. Se o executor lesse a preferência na hora de rodar, mexer no
  // interruptor reescreveria o que já tinha sido decidido.
  const chamadas = [];
  const agendadas = [];
  const prefs = { pularGuarda: true };
  const escopo = {
    AppState: { currentPlace: { venueID: 'v1', updateRequestID: 'ur1' }, queue: [], stats: { skipped: 0 }, preferences: prefs },
    acoesTravadas: () => false, Treino: { ativo: false },
    updateStats: () => {}, saveStats: () => {}, advanceQueue: () => {},
    scheduleAction: (tipo, place, executor) => { agendadas.push(executor); },
    API: { guardarPedido: async () => { chamadas.push(1); return { success: true }; } },
    callWithRetry: (fn) => fn(), showToast: () => {}, t: (k) => k, msgDoServidor: (r, txt) => txt,
  };
  const nomes = Object.keys(escopo);
  new Function(...nomes, fatiarFuncao('handleSkip') + '\nreturn handleSkip;')(...nomes.map((n) => escopo[n]))();
  prefs.pularGuarda = false;          // a pessoa desliga DEPOIS de pular
  await agendadas[0]();
  assert.equal(chamadas.length, 1,
    'desligar a preferência durante a janela apagou um guardar que a pessoa já tinha pedido');
});

test('falhar ao guardar NÃO é silencioso', async () => {
  const avisos = [];
  const escopo = {
    AppState: { currentPlace: { venueID: 'v1', updateRequestID: 'ur1' }, queue: [], stats: { skipped: 0 }, preferences: { pularGuarda: true } },
    acoesTravadas: () => false, Treino: { ativo: false },
    updateStats: () => {}, saveStats: () => {}, advanceQueue: () => {},
    scheduleAction: (t_, p, ex) => { escopo._ex = ex; },
    API: { guardarPedido: async () => ({ success: false, error: 'caiu' }) },
    callWithRetry: (fn) => fn(),
    showToast: (msg, tipo) => avisos.push({ msg, tipo }),
    t: (k) => k, msgDoServidor: (r, txt) => txt,
  };
  const nomes = Object.keys(escopo).filter((k) => k !== '_ex');
  new Function(...nomes, fatiarFuncao('handleSkip') + '\nreturn handleSkip;')(...nomes.map((n) => escopo[n]))();
  await escopo._ex();
  assert.equal(avisos.length, 1, 'a app prometeu guardar, falhou, e não disse nada');
  assert.equal(avisos[0].tipo, 'error');
});

// ── 3. O QUE A APP FAZ É O QUE ELA DIZ ─────────────────────────────────────
test('o selo do ↑ muda com a preferência — e volta quando ela desliga', () => {
  const feito = [];
  const el = {
    _k: 'card.stamp.skip',
    setAttribute: (k, v) => { if (k === 'data-i18n') el._k = v; feito.push(v); },
  };
  const alvo = { querySelector: (sel) => (sel.includes('swipe-stamp-up') ? el : null) };
  const mk = (pularGuarda) => {
    const escopo = {
      AppState: { preferences: { pularGuarda } },
      document: { querySelector: () => alvo },
      applyI18n: () => {},
    };
    const nomes = Object.keys(escopo);
    return new Function(...nomes, fatiarFuncao('atualizarSeloDePular') + '\nreturn atualizarSeloDePular;')(...nomes.map((n) => escopo[n]));
  };
  mk(true)();
  assert.equal(el._k, 'card.stamp.skipGuarda', 'com a preferência ligada o selo continua dizendo só "Pular"');
  mk(false)();
  assert.equal(el._k, 'card.stamp.skip', 'desligar a preferência não devolveu o selo ao normal');
});

test('as duas chaves do selo existem nas 4 línguas, e são DIFERENTES entre si', () => {
  const linguas = [...I18N.matchAll(/^  ([a-z]{2}): \{$/gm)].map((m) => m[1]);
  assert.ok(linguas.length >= 4, `só ${linguas.length} línguas achadas — a varredura quebrou`);
  const skip = [...I18N.matchAll(/'card\.stamp\.skip':\s*'([^']*)'/g)].map((m) => m[1]);
  const guarda = [...I18N.matchAll(/'card\.stamp\.skipGuarda':\s*'([^']*)'/g)].map((m) => m[1]);
  assert.equal(guarda.length, linguas.length, 'falta o selo novo em alguma língua');
  assert.equal(skip.length, linguas.length, 'a varredura do selo antigo quebrou');
  for (let i = 0; i < skip.length; i++) {
    assert.notEqual(skip[i], guarda[i],
      `em ${linguas[i]} os dois selos dizem a mesma coisa — a app faria algo diferente sem avisar`);
    assert.match(guarda[i], /⭐/, `o selo de guardar em ${linguas[i]} não traz a ⭐ que o card usa`);
  }
});

test('a linha da preferência existe no HTML e NÃO nasce marcada', () => {
  const linha = HTML.match(/<input id="prefPularGuarda"[^>]*>/);
  assert.ok(linha, 'a linha da preferência sumiu do index.html');
  assert.doesNotMatch(linha[0], /\schecked/,
    'a preferência nasce marcada no HTML — ligaria pra quem nunca decidiu');
  assert.match(HTML, /data-i18n="prefs\.pularGuarda\.label"/, 'o rótulo não passa pelo dicionário');
  assert.match(HTML, /data-i18n="prefs\.pularGuarda\.desc"/, 'a descrição não passa pelo dicionário');
});

// ── 4. O BACKEND ───────────────────────────────────────────────────────────
const NETSCAPE = (d, n, v) => `${d}\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'), NETSCAPE('.waze.com', '_web_session', 'sess-xyz')].join('\n');
function memStore() {
  const m = new Map();
  return { get: (h) => m.get('sess_' + h) ?? null, put: (h, b) => { m.set('sess_' + h, b); }, delete: (h) => { m.delete('sess_' + h); } };
}
async function ctxComSessao() {
  const sessions = makeSessions({ store: memStore(), keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  return { ctx: { sessions }, token: await sessions.createSession(COOKIES) };
}
async function comFetch(responder, fn) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opts) => { chamadas.push({ url: String(url), opts }); return responder(); };
  try { return { resultado: await fn(), chamadas }; } finally { globalThis.fetch = original; }
}

test('guardar-pedido: manda o payload do WME, e no endpoint /Issues/Star', async () => {
  const { ctx, token } = await ctxComSessao();
  const { resultado, chamadas } = await comFetch(
    () => new Response('', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    () => dispatch('guardar-pedido', { sessionToken: token, region: 'row', venueID: 'v9', updateRequestID: 'ur9', value: true }, ctx));
  assert.equal(resultado.status, 200);
  assert.equal(resultado.body.success, true);
  assert.equal(chamadas.length, 1, 'não chamou o Waze');
  assert.match(chamadas[0].url, /\/Issues\/Star$/, 'foi pro endpoint errado');
  const corpo = JSON.parse(chamadas[0].opts.body);
  // O formato saiu do bundle do WME e foi MEDIDO contra o Waze real.
  assert.deepEqual(corpo, { value: true, venueUpdateRequestIds: [{ id: 'ur9', venueId: 'v9' }] });
});

test('guardar-pedido: `value` é boolean ESTRITO — sem coerção, sem padrão', async () => {
  const { ctx, token } = await ctxComSessao();
  // Truthy que NÃO é boolean não pode virar um "guardar", e a ausência do campo
  // não pode virar um "soltar". Mesma régua do `approve` (gotcha #59).
  for (const value of ['true', 'false', 1, 0, null, undefined]) {
    const { resultado, chamadas } = await comFetch(
      () => new Response('', { status: 200 }),
      () => dispatch('guardar-pedido', { sessionToken: token, region: 'row', venueID: 'v9', updateRequestID: 'ur9', value }, ctx));
    assert.equal(resultado.status, 400, `value=${JSON.stringify(value)} passou como válido`);
    assert.equal(chamadas.length, 0, `value=${JSON.stringify(value)} chegou a tocar a rede`);
  }
});

test('guardar-pedido NÃO tem portão de rank — não é ação destrutiva', () => {
  const CORE = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
  const ini = CORE.indexOf('async function handleGuardarPedido');
  assert.ok(ini > 0, 'o handler sumiu');
  const corpo = CORE.slice(ini, CORE.indexOf('\nasync function', ini + 10));
  assert.doesNotMatch(corpo, /isUserAllowed|rank\s*>=|podeAgirComoL6/,
    'apareceu portão de rank no guardar-pedido — a estrela é estado do EDITOR sobre o pedido,'
    + ' não do mapa, e gatear aqui inventaria uma regra que o Waze não tem');
});
