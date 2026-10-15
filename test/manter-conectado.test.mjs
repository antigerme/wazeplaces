// «Manter conectado» no SERVIDOR: a varredura que renova o cookie do Waze de quem
// pediu, as rotas que ligam e desligam, e o compromisso de privacidade.
//
// Tudo com store em memória e `fetch` de mentira — nenhum Waze real, nenhum
// cookie real. O Waze de mentira rotaciona o `_web_session` em CADA resposta,
// como o de verdade, e anota o valor que recebeu: é assim que se prova que o
// cookie guardado MUDOU e que o próximo uso já manda o novo.
//
// Cada teste foi visto REPROVANDO sem o seu conserto (sabotagem na entrega).
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import {
  makeSessions, dispatch, varrerMantidosDoStore, SESSION_COOKIE_REFRESH, SESSION_TTL, base64ToBytes,
} from '../server/core.mjs';
import {
  varrerMantidos, KA_PREFIXO, KA_TTL, KA_REGRAVA_APOS, MANTER_DEVIDO_APOS, MANTER_LOTE, MANTER_EXAMINAR,
} from '../server/manter-conectado.mjs';

const NETSCAPE = (d, n, v) => `${d}\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const cookiesCom = (sessao) => [NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'), NETSCAPE('.waze.com', '_web_session', sessao)].join('\n');
const T0 = 1_790_000_000;
const HORA = 3600;
const PERFIL = { id: 12444348, userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false, areas: [], managedAreas: [] };

// Relógio simulado + Waze de mentira. `modo` decide a resposta: 'ok' (200 com
// cookie novo), 'ok-sem-cookie', '403', '500', 'rede'.
function ambiente() {
  let agora = T0;
  const dateNow = Date.now;
  Date.now = () => agora * 1000;
  const fetchOriginal = globalThis.fetch;
  let n = 0;
  const amb = {
    modo: () => 'ok',
    chamadas: [],
    get agora() { return agora; },
    set agora(v) { agora = v; },
    avancar(s) { agora += s; },
    restaurar() { Date.now = dateNow; globalThis.fetch = fetchOriginal; },
  };
  globalThis.fetch = async (url, init = {}) => {
    const m = /_web_session=([^;]+)/.exec((init.headers && init.headers.Cookie) || '');
    const id = ++n;
    const modo = amb.modo(m && m[1], id);
    amb.chamadas.push({ url: String(url), sessao: m && m[1], modo });
    if (modo === 'rede') throw new Error('rede caiu');
    if (modo === '403') return new Response(JSON.stringify({ errorList: [{ code: 101, details: 'not allowed by guest user' }] }), { status: 403 });
    if (modo === '500') return new Response('<html>500</html>', { status: 500 });
    const headers = { 'content-type': 'application/json' };
    if (modo === 'ok') headers['set-cookie'] = `_web_session=ROT${id}; path=/; Max-Age=2000000`;
    return new Response(JSON.stringify(PERFIL), { status: 200, headers });
  };
  return amb;
}

function storeComContagem() {
  const mem = new Map();
  const ops = { get: 0, put: 0, delete: 0, list: 0 };
  return {
    mem, ops,
    get: async (k) => { ops.get++; return mem.has(k) ? mem.get(k) : null; },
    put: async (k, v) => { ops.put++; mem.set(k, v); },
    delete: async (k) => { ops.delete++; mem.delete(k); },
    list: async (p) => { ops.list++; return [...mem.keys()].filter((k) => k.startsWith(p)); },
  };
}

async function cenario(opcoes = {}) {
  const amb = ambiente();
  const store = storeComContagem();
  if (opcoes.semList) delete store.list;
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const sessions = makeSessions({ store, keyBytes });
  const novo = async (sessao = 'LOGIN') => sessions.createSession(cookiesCom(sessao));
  const ctx = () => ({ sessions: makeSessions({ store, keyBytes }) });
  const cookieGuardado = async (token) => (/_web_session\t(\S+)/.exec(await makeSessions({ store, keyBytes }).loadSession(token) || '') || [])[1];
  const hashDe = async (token) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { amb, store, keyBytes, sessions, novo, ctx, cookieGuardado, hashDe };
}

const semPausa = async () => {};
const ordemFixa = (l) => l;

// ─── Ligar e desligar ────────────────────────────────────────────────────────

test('perfil: manter === true liga, === false desliga, ausente e não-booleano NÃO mexem — e a resposta diz o estado real', async () => {
  const c = await cenario();
  try {
    const token = await c.novo();
    const perfil = (extra = {}) => dispatch('perfil', { sessionToken: token, region: 'row', ...extra }, c.ctx());

    let r = await perfil();
    assert.equal(r.body.manterConectado, false, 'sem pedir nada, está desligado');
    assert.equal([...c.store.mem.keys()].filter((k) => k.startsWith('ka_')).length, 0);

    // O texto "true" e o número 1 não ligam (booleano estrito).
    for (const lixo of ['true', 1, 'false', null, {}]) {
      r = await perfil({ manter: lixo });
      assert.equal(r.body.manterConectado, false, `manter=${JSON.stringify(lixo)} ligou`);
    }
    assert.equal([...c.store.mem.keys()].filter((k) => k.startsWith('ka_')).length, 0, 'um valor não-booleano criou a entrada');

    r = await perfil({ manter: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.manterConectado, true);
    const chaveKa = KA_PREFIXO + await c.hashDe(token);
    assert.ok(c.store.mem.has(chaveKa), 'a entrada ka_<hash> não foi criada');

    // Ausente e não-booleano preservam o estado LIGADO (não desligam).
    for (const preservar of [{}, { manter: 'false' }, { manter: 0 }]) {
      r = await perfil(preservar);
      assert.equal(r.body.manterConectado, true, `${JSON.stringify(preservar)} desligou`);
    }

    r = await perfil({ manter: false });
    assert.equal(r.body.manterConectado, false);
    assert.ok(!c.store.mem.has(chaveKa), 'o desligar não apagou a entrada');
  } finally { c.amb.restaurar(); }
});

test('perfil: religar a cada abertura NÃO regrava a entrada à toa — só se falta, passou de 1 dia ou a região mudou', async () => {
  const c = await cenario();
  try {
    const token = await c.novo();
    const perfil = (region) => dispatch('perfil', { sessionToken: token, region, manter: true }, c.ctx());
    const putsKa = () => [...c.store.mem.keys()].length && c.store.ops.put;

    await perfil('row');
    const depoisDoPrimeiro = c.store.ops.put;
    assert.ok(depoisDoPrimeiro >= 1);

    // Mesma região, 3 aberturas no mesmo dia: nenhuma escrita da entrada.
    // (A sessão pode regravar o cookie rotacionado; contamos só as da entrada.)
    const escritasKa = [];
    const putOriginal = c.store.put;
    c.store.put = async (k, v, ttl) => { if (k.startsWith('ka_')) escritasKa.push([k, ttl]); return putOriginal(k, v, ttl); };
    for (let i = 0; i < 3; i++) await perfil('row');
    assert.equal(escritasKa.length, 0, 'religar no mesmo dia regravou a entrada (escrita de KV é escassa)');

    // Passou de 1 dia: regrava, com o TTL de 14 dias.
    c.amb.avancar(KA_REGRAVA_APOS + 60);
    await perfil('row');
    assert.equal(escritasKa.length, 1, 'passou de 1 dia e não regravou');
    assert.equal(escritasKa[0][1], KA_TTL, 'o TTL da entrada tem que ser o de 14 dias');

    // Outra região: regrava (senão a varredura segue chamando o servidor antigo).
    await perfil('na');
    assert.equal(escritasKa.length, 2, 'a região mudou e a entrada ficou com a velha');
  } finally { c.amb.restaurar(); }
});

test('perfil: sessão recusada pelo portão não liga nada (e o que existia sai com a sessão)', async () => {
  const c = await cenario();
  try {
    const token = await c.novo();
    await dispatch('perfil', { sessionToken: token, region: 'row', manter: true }, c.ctx());
    const chaveKa = KA_PREFIXO + await c.hashDe(token);
    assert.ok(c.store.mem.has(chaveKa));
    // O Waze agora diz que a conta é L1 sem área: o portão recusa e apaga a sessão.
    const respostaOriginal = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ...PERFIL, rank: 0, isAreaManager: false }), { status: 200 });
    const r = await dispatch('perfil', { sessionToken: token, region: 'row', manter: true }, c.ctx());
    globalThis.fetch = respostaOriginal;
    assert.equal(r.status, 403);
    assert.ok(!c.store.mem.has(chaveKa), 'a entrada sobrou depois de a sessão ser recusada');
    assert.equal(c.store.mem.size, 0);
  } finally { c.amb.restaurar(); }
});

test('sessao manter: liga e desliga na hora, booleano estrito, 401 sem sessão, e token inventado não escreve', async () => {
  const c = await cenario();
  try {
    const token = await c.novo();
    const manter = (corpo) => dispatch('sessao', { action: 'manter', region: 'row', ...corpo }, c.ctx());
    const chaveKa = KA_PREFIXO + await c.hashDe(token);

    let r = await manter({ sessionToken: token, on: true });
    assert.deepEqual([r.status, r.body.success, r.body.manterConectado], [200, true, true]);
    assert.ok(c.store.mem.has(chaveKa));

    r = await manter({ sessionToken: token, on: false });
    assert.deepEqual([r.status, r.body.success, r.body.manterConectado], [200, true, false]);
    assert.ok(!c.store.mem.has(chaveKa));

    // `on` ausente ou que não é booleano: 400 com chave, e NADA muda.
    await manter({ sessionToken: token, on: true });
    for (const lixo of [undefined, 'false', 'true', 0, 1, null]) {
      r = await manter({ sessionToken: token, on: lixo });
      assert.equal(r.status, 400, `on=${JSON.stringify(lixo)}`);
      assert.equal(r.body.errorKey, 'srv.err.badRequest');
      assert.ok(c.store.mem.has(chaveKa), `on=${JSON.stringify(lixo)} mexeu na entrada`);
    }

    // Sem sessão válida: 401 como as outras rotas, SEM gastar escrita.
    c.store.ops.put = 0;
    for (const sessionToken of [undefined, 'token-inventado']) {
      r = await manter({ sessionToken, on: true });
      assert.equal(r.status, 401);
      assert.equal(r.body.errorCategory, 'unauthorized');
    }
    assert.equal(c.store.ops.put, 0, 'token inventado gastou escrita de KV');

    // Região que veio e não existe: 400 (a mesma régua das outras rotas).
    r = await manter({ sessionToken: token, on: true, region: 'marte' });
    assert.equal(r.status, 400);
  } finally { c.amb.restaurar(); }
});

test('sessao destroy (o «Sair») apaga a sessão E a entrada de keepalive — inclusive com a sessão já vencida', async () => {
  const c = await cenario();
  try {
    const a = await c.novo();
    const chaveA = KA_PREFIXO + await c.hashDe(a);
    await dispatch('sessao', { action: 'manter', sessionToken: a, on: true, region: 'row' }, c.ctx());
    assert.ok(c.store.mem.has(chaveA));
    const r = await dispatch('sessao', { action: 'destroy', sessionToken: a }, c.ctx());
    assert.equal(r.status, 200);
    assert.equal(c.store.mem.size, 0, 'sobrou algo no store depois do «Sair»');

    // A sessão venceu antes do «Sair»: a entrada tem que sair mesmo assim.
    const b = await c.novo();
    const chaveB = KA_PREFIXO + await c.hashDe(b);
    await dispatch('sessao', { action: 'manter', sessionToken: b, on: true, region: 'row' }, c.ctx());
    c.store.mem.delete(await c.hashDe(b));
    await dispatch('sessao', { action: 'destroy', sessionToken: b }, c.ctx());
    assert.ok(!c.store.mem.has(chaveB), 'a entrada ficou órfã depois do «Sair» com a sessão vencida');

    // Lê antes de apagar: token inventado não gasta apagamento.
    c.store.ops.delete = 0;
    await dispatch('sessao', { action: 'destroy', sessionToken: 'inventado' }, c.ctx());
    assert.equal(c.store.ops.delete, 0, 'destroy de token inventado gastou a cota de apagamento');
  } finally { c.amb.restaurar(); }
});

// ─── A varredura ─────────────────────────────────────────────────────────────

test('varredura: renova a sessão devida, o cookie guardado MUDA e o próximo uso já manda o novo', async () => {
  const c = await cenario();
  try {
    const token = await c.novo('LOGIN');
    await c.sessions.manterLigar(token, 'row');
    assert.equal(await c.cookieGuardado(token), 'LOGIN');

    c.amb.avancar(6 * HORA); // o editor sumiu por 6 h
    const resumo = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, embaralhar: ordemFixa });
    assert.deepEqual([resumo.vistas, resumo.renovadas, resumo.mortas, resumo.adiadas], [1, 1, 0, 0]);
    assert.equal(c.amb.chamadas.length, 1);
    assert.equal(c.amb.chamadas[0].sessao, 'LOGIN', 'a varredura mandou outro cookie ao Waze');
    assert.match(c.amb.chamadas[0].url, /\/row-Descartes\/app\/Session/, 'a leitura barata é o Session da região guardada');

    const guardado = await c.cookieGuardado(token);
    assert.match(guardado, /^ROT\d+$/, `o cookie guardado não mudou (${guardado})`);

    // O próximo uso (o editor volta) manda o cookie NOVO.
    await dispatch('perfil', { sessionToken: token, region: 'row' }, c.ctx());
    assert.equal(c.amb.chamadas.at(-1).sessao, guardado, 'o uso seguinte mandou o cookie velho');

    // A entrada de keepalive não foi tocada (carimbo é o do «religar»).
    assert.equal(await c.sessions.manterEstado(token), true);
  } finally { c.amb.restaurar(); }
});

test('varredura: as duas formas de adaptador — o Worker (uma instância nova) e a VM (a instância do processo) — renovam', async () => {
  for (const modelo of ['Worker', 'VM']) {
    const c = await cenario();
    try {
      const token = await c.novo('LOGIN');
      // A VM já leu essa sessão antes (a memória dos carimbos é dela).
      await c.sessions.loadSession(token);
      await c.sessions.manterLigar(token, 'row');
      c.amb.avancar(6 * HORA);
      const r = await varrerMantidosDoStore({
        store: c.store, keyBytes: c.keyBytes, sessions: modelo === 'VM' ? c.sessions : null, pausa: semPausa, embaralhar: ordemFixa,
      });
      assert.equal(r.renovadas, 1, modelo);
      assert.match(await c.cookieGuardado(token), /^ROT/, `${modelo}: o cookie não mudou`);
    } finally { c.amb.restaurar(); }
  }
});

test('varredura: só a sessão DEVIDA (carimbo com mais de devidoApos) vai ao Waze — quem usou o app há pouco não é tocado', async () => {
  const c = await cenario();
  try {
    const recente = await c.novo('RECENTE');
    await c.sessions.manterLigar(recente, 'row');
    c.amb.avancar(4 * HORA + 59 * 60);      // 4h59: ainda em dia
    let r = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, embaralhar: ordemFixa });
    assert.deepEqual([r.vistas, r.emDia, r.renovadas], [1, 1, 0]);
    assert.equal(c.amb.chamadas.length, 0, 'foi ao Waze por uma sessão que não estava devida');
    assert.equal(await c.cookieGuardado(recente), 'RECENTE');

    c.amb.avancar(2 * 60);                  // passou de 5h
    r = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, embaralhar: ordemFixa });
    assert.equal(r.renovadas, 1, 'passou de 5 h e não renovou');
    assert.equal(MANTER_DEVIDO_APOS, 5 * HORA, 'o prazo de "devida" mudou — a conta de capacidade do módulo também');
  } finally { c.amb.restaurar(); }
});

test('varredura: respeita o lote — e chama a pausa entre as sessões (jitter), nunca antes da primeira', async () => {
  const c = await cenario();
  try {
    const tokens = [];
    for (let i = 0; i < 8; i++) { const t = await c.novo(`S${i}`); await c.sessions.manterLigar(t, 'row'); tokens.push(t); }
    c.amb.avancar(6 * HORA);
    let pausas = 0;
    const r = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, lote: 3, pausa: async () => { pausas++; }, embaralhar: ordemFixa });
    assert.equal(r.renovadas, 3, 'passou do lote');
    assert.equal(c.amb.chamadas.length, 3);
    assert.equal(pausas, 2, 'a pausa tem que cair ENTRE as sessões (n-1), não antes da primeira nem depois da última');

    // O resto fica pra próxima execução, e a seguinte pega as que faltam.
    const r2 = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, lote: 3, pausa: semPausa, embaralhar: ordemFixa });
    assert.equal(r2.renovadas, 3, 'a segunda execução não achou as devidas que sobraram');
    assert.equal(MANTER_LOTE, 6, 'o lote padrão é o da conta de capacidade do módulo');
  } finally { c.amb.restaurar(); }
});

test('varredura: a pausa PADRÃO existe e fica na faixa de 1,5–4 s (jitter aleatório, regra do dono)', async () => {
  const { pausaPadrao } = await import('../server/manter-conectado.mjs');
  const original = globalThis.setTimeout;
  const esperas = [];
  globalThis.setTimeout = (fn, ms, ...a) => { esperas.push(ms); return original(fn, 0, ...a); };
  try {
    for (let i = 0; i < 30; i++) await pausaPadrao();
  } finally { globalThis.setTimeout = original; }
  assert.ok(esperas.every((ms) => ms >= 1500 && ms <= 4000), `fora da faixa: ${esperas.filter((ms) => ms < 1500 || ms > 4000)}`);
  assert.ok(new Set(esperas).size > 5, 'a pausa não é aleatória (valores demais repetidos)');
});

test('varredura: 403 do Waze apaga a entrada (a sessão vence sozinha); 500 e erro de rede NÃO apagam e ficam pra próxima', async () => {
  const c = await cenario();
  try {
    const morta = await c.novo('MORTA'), instavel = await c.novo('INSTAVEL'), sem_rede = await c.novo('SEMREDE');
    for (const t of [morta, instavel, sem_rede]) await c.sessions.manterLigar(t, 'row');
    c.amb.modo = (sessao) => ({ MORTA: '403', INSTAVEL: '500', SEMREDE: 'rede' }[sessao] || 'ok');
    c.amb.avancar(6 * HORA);
    const r = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, embaralhar: ordemFixa });
    assert.deepEqual([r.vistas, r.renovadas, r.mortas, r.adiadas], [3, 0, 1, 2]);
    assert.equal(await c.sessions.manterEstado(morta), false, '403 não apagou a entrada');
    assert.equal(await c.sessions.manterEstado(instavel), true, '500 apagou a entrada');
    assert.equal(await c.sessions.manterEstado(sem_rede), true, 'erro de rede apagou a entrada');
    // A sessão morta NÃO é apagada pela varredura: ela vence sozinha.
    assert.ok(c.store.mem.has(await c.hashDe(morta)), 'a varredura apagou a sessão (devia só soltar a entrada)');

    // A rede volta: as duas que sobraram são renovadas.
    c.amb.modo = () => 'ok';
    const r2 = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, embaralhar: ordemFixa });
    assert.equal(r2.renovadas, 2);
  } finally { c.amb.restaurar(); }
});

test('varredura: sessão ausente (vencida ou apagada) apaga a entrada; entrada vencida pelo CARIMBO (14 dias) sai sem ir ao Waze', async () => {
  const c = await cenario();
  try {
    const some = await c.novo('SOME'), velha = await c.novo('VELHA');
    await c.sessions.manterLigar(some, 'row');
    await c.sessions.manterLigar(velha, 'row');
    c.store.mem.delete(await c.hashDe(some));       // a sessão sumiu
    c.amb.avancar(KA_TTL + 60);                      // ninguém reabriu o app em 14 dias
    // A sessão da `velha` segue lá (a varredura a mantém), mas a ENTRADA venceu.
    // (O TTL do store não vale na VM — o arquivo renova o mtime a cada leitura —,
    // então quem manda é o carimbo do valor.)
    const r = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, embaralhar: ordemFixa });
    assert.equal(r.mortas, 1, 'sessão ausente');
    assert.equal(r.expiradas, 1, 'entrada de 14 dias');
    assert.equal(r.renovadas, 0);
    assert.equal(c.amb.chamadas.length, 0, 'foi ao Waze por entrada vencida/sem sessão');
    assert.ok(![...c.store.mem.keys()].some((k) => k.startsWith('ka_')), 'sobrou entrada');
  } finally { c.amb.restaurar(); }
});

test('varredura: só toca nas chaves ka_ — sessão comum, pareamento, releitura e lixo ficam como estão', async () => {
  const c = await cenario();
  try {
    const mantida = await c.novo('MANTIDA'), comum = await c.novo('COMUM');
    await c.sessions.manterLigar(mantida, 'row');
    c.store.mem.set('pair_abc', `${c.amb.agora + 300}|blob`);
    c.store.mem.set('reler_xyz', `${c.amb.agora}|{}`);
    c.store.mem.set('kaboom', 'lixo que só começa parecido');
    const antes = new Map(c.store.mem);
    c.amb.avancar(6 * HORA);
    const r = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, embaralhar: ordemFixa });
    assert.equal(r.renovadas, 1);
    for (const k of ['pair_abc', 'reler_xyz', 'kaboom', await c.hashDe(comum)]) {
      assert.equal(c.store.mem.get(k), antes.get(k), `a varredura mexeu em ${k}`);
    }
    assert.equal(await c.cookieGuardado(comum), 'COMUM', 'a sessão SEM «Manter conectado» foi renovada');
    assert.equal(c.amb.chamadas.length, 1);
  } finally { c.amb.restaurar(); }
});

test('varredura: sem `list` no store não faz nada (e não lança); com `listar` injetado usa o dele', async () => {
  const c = await cenario({ semList: true });
  try {
    const t = await c.novo(); await c.sessions.manterLigar(t, 'row');
    c.amb.avancar(6 * HORA);
    const r = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa });
    assert.deepEqual(r, { vistas: 0, renovadas: 0, mortas: 0, adiadas: 0, emDia: 0, semRotacao: 0, expiradas: 0 });
    assert.equal(c.amb.chamadas.length, 0);
    const r2 = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, listar: async () => [...c.store.mem.keys()].filter((k) => k.startsWith('ka_')) });
    assert.equal(r2.renovadas, 1, 'o `listar` injetado não foi usado');
    // E uma falha do `list` não derruba nada.
    const r3 = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, listar: async () => { throw new Error('KV fora'); } });
    assert.equal(r3.vistas, 0);
  } finally { c.amb.restaurar(); }
});

test('varredura: o orçamento de operações de KV cabe nas 50 do plano grátis — mesmo com muita gente mantida', async () => {
  const c = await cenario();
  try {
    for (let i = 0; i < 40; i++) { const t = await c.novo(`S${i}`); await c.sessions.manterLigar(t, 'row'); }
    c.amb.avancar(6 * HORA);          // as 40 estão devidas
    c.store.ops.get = c.store.ops.put = c.store.ops.delete = c.store.ops.list = 0;
    const antesFetch = c.amb.chamadas.length;
    await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa });
    const subrequisicoes = c.store.ops.get + c.store.ops.put + c.store.ops.delete + c.store.ops.list + (c.amb.chamadas.length - antesFetch);
    assert.ok(subrequisicoes <= 45, `${subrequisicoes} operações numa execução: passa das 50 do plano grátis com folga curta`);
    assert.ok(c.store.ops.put <= MANTER_LOTE, `${c.store.ops.put} escritas numa execução (teto: o lote)`);
    assert.equal(c.store.ops.list, 1);

    // E com 40 EM DIA o custo é só de leitura, limitado pelo `examinar`.
    c.store.ops.get = 0;
    c.amb.avancar(0);
    const r = await varrerMantidos({
      store: c.store, sessions: makeSessions({ store: c.store, keyBytes: c.keyBytes }), pausa: semPausa,
      chamarWaze: async () => { throw new Error('não devia ir ao Waze'); }, devidoApos: 10 ** 9,
    });
    assert.equal(r.vistas, MANTER_EXAMINAR, 'leu entradas demais numa execução');
    assert.equal(c.store.ops.get, MANTER_EXAMINAR);
  } finally { c.amb.restaurar(); }
});

test('varredura: o teto de tempo para a execução (e conta o resto como adiado); a ordem é embaralhada', async () => {
  const c = await cenario();
  try {
    for (let i = 0; i < 6; i++) { const t = await c.novo(`S${i}`); await c.sessions.manterLigar(t, 'row'); }
    c.amb.avancar(6 * HORA);
    let relogioMs = 0;
    const r = await varrerMantidosDoStore({
      store: c.store, keyBytes: c.keyBytes, embaralhar: ordemFixa,
      pausa: async () => { relogioMs += 5000; }, relogio: () => relogioMs,
    });
    assert.ok(r.renovadas >= 3 && r.renovadas < 6, `renovou ${r.renovadas}: o teto de 20 s não cortou (ou cortou cedo demais)`);
    assert.ok(r.adiadas >= 1, 'o que ficou de fora tem que ser contado como adiado');

    // Embaralhar: o padrão não devolve sempre a mesma ordem (senão as últimas passam fome).
    const { varrerMantidos: v } = await import('../server/manter-conectado.mjs');
    const vistos = new Set();
    for (let i = 0; i < 20; i++) {
      let primeira = null;
      await v({
        store: { list: async () => ['ka_a', 'ka_b', 'ka_c', 'ka_d', 'ka_e'], delete: async () => {} },
        sessions: { manterExaminar: async (k) => { primeira ??= k; return { estado: 'emDia' }; } },
        chamarWaze: async () => ({ resultado: 'ok' }), examinar: 1,
      });
      vistos.add(primeira);
    }
    assert.ok(vistos.size > 1, 'a ordem da varredura é sempre a mesma: quem está no fim da lista nunca é examinado');
  } finally { c.amb.restaurar(); }
});

test('varredura: 200 sem cookie novo é contado à parte (a sessão segue devida) e o resumo não carrega dado de pessoa', async () => {
  const c = await cenario();
  try {
    const t = await c.novo('LOGIN'); await c.sessions.manterLigar(t, 'row');
    c.amb.modo = () => 'ok-sem-cookie';
    c.amb.avancar(6 * HORA);
    const r = await varrerMantidosDoStore({ store: c.store, keyBytes: c.keyBytes, pausa: semPausa, embaralhar: ordemFixa });
    assert.equal(r.renovadas, 1);
    assert.equal(r.semRotacao, 1);
    assert.ok(Object.values(r).every((v) => typeof v === 'number'), 'o resumo só pode ter contagens');
  } finally { c.amb.restaurar(); }
});

// ─── Privacidade ─────────────────────────────────────────────────────────────

// O invasor tem TUDO do lado do servidor: o ENCRYPTION_KEY e um dump do KV. Tenta
// as derivações que conhece (a crua e a do «Manter conectado»), nenhuma com token.
async function invasor(secret, dump) {
  const hkdf = async (salt) => {
    const ikm = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(salt), info: new TextEncoder().encode('wazeplaces/v1') }, ikm, 256));
  };
  const abrir = async (blob, chaveBytes) => {
    try {
      const [iv, ct] = blob.split('::');
      const k = await crypto.subtle.importKey('raw', chaveBytes, { name: 'AES-GCM' }, false, ['decrypt']);
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, k, base64ToBytes(ct)));
    } catch { return null; }
  };
  const chaves = [secret, await hkdf('manter-conectado:v1')];
  const achados = [];
  for (const [nome, valor] of dump) {
    const blob = valor.slice(valor.indexOf('|') + 1);
    for (const k of chaves) { const t = await abrir(blob, k); if (t) achados.push({ nome, texto: t }); }
  }
  return achados;
}

test('privacidade: sessão SEM «Manter conectado» — Secret + dump do KV, sem o token, não abre nada (a garantia segue valendo)', async () => {
  const c = await cenario();
  try {
    const token = await c.novo('SEGREDO-NORMAL');
    const achados = await invasor(c.keyBytes, [...c.store.mem]);
    assert.deepEqual(achados, [], 'o invasor abriu uma sessão que NÃO pediu «Manter conectado»');
    assert.ok(![...c.store.mem.keys()].some((k) => k.startsWith('ka_')));
    assert.ok(await c.sessions.loadSession(token), 'CONTROLE: com o token a sessão abre');
  } finally { c.amb.restaurar(); }
});

test('privacidade: sessão COM «Manter conectado» é recuperável pelo servidor — a EXCEÇÃO escolhida, e só a dela', async () => {
  const c = await cenario();
  try {
    const comKa = await c.novo('COM-KA'), semKa = await c.novo('SEM-KA');
    await c.sessions.manterLigar(comKa, 'na');
    const dump = [...c.store.mem];
    const achados = await invasor(c.keyBytes, dump);

    // O que o invasor abre é a ENTRADA, e dela sai o token — e SÓ o da que ligou.
    assert.equal(achados.length, 1);
    assert.ok(achados[0].nome.startsWith('ka_'));
    const { token, region } = JSON.parse(achados[0].texto);
    assert.equal(token, comKa);
    assert.equal(region, 'na');
    // Com esse token a sessão abre (é o que a varredura faz).
    assert.match(await makeSessions({ store: c.store, keyBytes: c.keyBytes }).loadSession(token), /COM-KA/);
    // A sessão que NÃO pediu continua fechada pro invasor: o token dela não está em lugar nenhum.
    assert.ok(!achados.some((a) => a.texto.includes(semKa)));

    // E sem o ENCRYPTION_KEY a entrada não abre (a chave é derivada DELE).
    const outroSecret = crypto.getRandomValues(new Uint8Array(32));
    assert.deepEqual(await invasor(outroSecret, dump), [], 'a entrada abre com um Secret que não é o do servidor');
    // O valor guardado não diz o token em claro, nem a chave diz de quem é.
    for (const [k, v] of dump) assert.ok(!k.includes(comKa) && !v.includes(comKa), `o token aparece em claro (${k.slice(0, 6)}…)`);

    // Desligar fecha de novo: o que sobra no dump volta a ser inabrível.
    await c.sessions.manterDesligar(comKa);
    assert.deepEqual(await invasor(c.keyBytes, [...c.store.mem]), [], 'depois de desligar a sessão continuou recuperável');
  } finally { c.amb.restaurar(); }
});

// ─── O acréscimo do mesmo PR: login e pareamento ────────────────────────────

test('login: o cookie novo da resposta do Session é guardado (zero chamada nova) — a sessão não nasce com a cópia do arquivo', async () => {
  const c = await cenario();
  try {
    const r = await dispatch('testar-cookies', { cookies: cookiesCom('DO-ARQUIVO'), region: 'row' }, c.ctx());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(c.amb.chamadas.length, 1, 'o login fez chamada a mais ao Waze');
    const guardado = await c.cookieGuardado(r.body.sessionToken);
    assert.match(guardado, /^ROT\d+$/, `a sessão nasceu com o cookie do arquivo (${guardado})`);
    // E o primeiro uso manda o cookie da resposta, não o do arquivo.
    await dispatch('perfil', { sessionToken: r.body.sessionToken, region: 'row' }, c.ctx());
    assert.equal(c.amb.chamadas.at(-1).sessao, guardado);

    // Se a resposta não trouxe cookie novo, vale o do arquivo (nada quebra).
    c.amb.modo = () => 'ok-sem-cookie';
    const r2 = await dispatch('testar-cookies', { cookies: cookiesCom('DO-ARQUIVO-2'), region: 'row' }, c.ctx());
    assert.equal(r2.status, 200);
    assert.equal(await c.cookieGuardado(r2.body.sessionToken), 'DO-ARQUIVO-2');
  } finally { c.amb.restaurar(); }
});

test('pareamento: a sessão do resgate nasce com o carimbo de 1 h atrás e a PRIMEIRA resposta do Waze já grava o cookie novo', async () => {
  const c = await cenario();
  try {
    const origem = await c.novo('ORIGEM');
    const criado = await dispatch('parear', { action: 'create', sessionToken: origem }, c.ctx());
    const resgate = await dispatch('parear', { action: 'claim', code: criado.body.code }, c.ctx());
    assert.equal(resgate.status, 200);
    const novo = resgate.body.sessionToken;
    const raw = c.store.mem.get(await c.hashDe(novo));
    assert.equal(parseInt(raw.slice(0, raw.indexOf('|')), 10), c.amb.agora - SESSION_COOKIE_REFRESH,
      'o carimbo tem que ser EXATAMENTE agora - SESSION_COOKIE_REFRESH (sem margem a mais nem a menos)');
    assert.equal(await c.cookieGuardado(novo), 'ORIGEM');

    // Sem esperar 1 h: a primeira chamada ao Waze já regrava o valor.
    await dispatch('perfil', { sessionToken: novo, region: 'row' }, c.ctx());
    assert.match(await c.cookieGuardado(novo), /^ROT/, 'a primeira resposta não gravou o cookie novo (esperaria 1 h)');

    // A sessão comum (login) NÃO ganha o desconto: a trava de 1 h segue valendo.
    const comum = await c.novo('COMUM');
    await dispatch('perfil', { sessionToken: comum, region: 'row' }, c.ctx());
    assert.equal(await c.cookieGuardado(comum), 'COMUM', 'a sessão que não veio do pareamento gravou antes de 1 h');
  } finally { c.amb.restaurar(); }
});

test('constantes: a conta de capacidade do módulo (14 dias, 1 dia, 5 h, lote 6) é a que o código usa', () => {
  assert.equal(KA_TTL, 14 * 86400);
  assert.equal(KA_REGRAVA_APOS, 86400);
  assert.equal(SESSION_TTL, 21 * 86400, 'o TTL da sessão mudou: reveja o quanto uma sessão mantida vive depois de abandonada');
});
