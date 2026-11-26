// O Durable Object da demo (worker/demo-do.mjs) e a ligação dele no Worker.
// O `state` do DO é de mentira, mas o que importa é de verdade: o DO é carregado
// do retrato depois de "evictado", o alarme anda o tempo, e o fluxo SSE passa
// pelo Worker de ponta a ponta. A regra do jogo já é testada em demo-sala*.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { DemoSalaDO } from '../worker/index.mjs';
import { DemoSalaDO as DoDireto } from '../worker/demo-do.mjs';

const sha = (t) => createHash('sha256').update(t).digest('hex');
const SEGREDO = 'ABCDEFGHJKLMNPQRSTUV';
const HOSTKEY = 'WXYZ2345679ABCDEFGHJ';
const ID = sha('demo:' + SEGREDO).slice(0, 40);
const HOSTHASH = sha('demo-host:' + HOSTKEY);
const pid = (n) => 'parte-de-teste-' + String(n).padStart(4, '0');
const cfg = (extra = {}) => { const t = Date.now(); return { id: ID, hostHash: HOSTHASH, modo: 'livre', tempoMs: 0, referencia: false, total: 3, max: 10, criadoEm: t, votosAte: t + 3 * 3600_000, expiraEm: t + 48 * 3600_000, ...extra }; };
const DECK = { convidado: [1, 2, 3].map((n) => ({ n, name: 'L' + n })), apresentador: [1, 2, 3].map((n) => ({ n, venueID: 'v' + n, updateRequestID: 'u' + n })), regiao: 'row' };

// O `state` que o runtime entrega ao DO: um storage que sobrevive a "evictar" a instância.
function estado(mem = new Map()) {
  const s = { alarme: null, mem };
  s.storage = {
    get: async (k) => (mem.has(k) ? structuredClone(mem.get(k)) : undefined),
    put: async (k, v) => { mem.set(k, structuredClone(v)); },
    setAlarm: async (ts) => { s.alarme = ts; },
    deleteAlarm: async () => { s.alarme = null; },
    deleteAll: async () => { mem.clear(); s.alarme = null; },
  };
  s.blockConcurrencyWhile = (fn) => fn();
  return s;
}
const req = (caminho, corpo) => new Request('https://demo/' + caminho, { method: 'POST', body: JSON.stringify(corpo) });
const chama = async (d, caminho, corpo) => { const r = await d.fetch(req(caminho, corpo)); return { status: r.status, body: await r.json() }; };

// O namespace de DO que o Worker vê: nome → instância (e o estado dela, pra evictar).
function namespace() {
  const inst = new Map();
  const ns = {
    inst,
    idFromName: (n) => n,
    get: (n) => {
      if (!inst.has(n)) { const st = estado(); inst.set(n, { st, do: new DemoSalaDO(st, {}) }); }
      return { fetch: (url, init) => inst.get(n).do.fetch(new Request(url, init)) };
    },
    evictar: (n) => { const { st } = inst.get(n); inst.set(n, { st, do: new DemoSalaDO(st, {}) }); },
  };
  return ns;
}
const leitor = (res) => {
  const eventos = []; let buf = '';
  const l = res.body.getReader(); const dec = new TextDecoder();
  const laco = (async () => { for (;;) { const { value, done } = await l.read(); if (done) return; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); if (!b.startsWith(':')) eventos.push(JSON.parse(/^data: (.*)$/m.exec(b)[1])); } } })();
  return { eventos, parar: () => l.cancel(), laco };
};
const cedo = () => new Promise((r) => setImmediate(r));

// ── o DO ────────────────────────────────────────────────────────────────────

test('DO: criar uma vez; "info" devolve o baralho sem o id real; a chave do corpo errada é 403', async () => {
  const d = new DemoSalaDO(estado(), {});
  assert.deepEqual((await chama(d, 'criar', { cfg: cfg(), deck: DECK })).body, { ok: true });
  assert.deepEqual((await chama(d, 'criar', { cfg: cfg(), deck: DECK })).body, { ok: false, motivo: 'existe' });
  const info = await chama(d, 'acao', { tipo: 'info' });
  assert.equal(info.status, 200);
  assert.equal(info.body.convidado.length, 3);
  assert.ok(!JSON.stringify(info.body).includes('updateRequestID'));
  assert.equal((await chama(d, 'acao', { tipo: 'resultado', hostHash: 'f'.repeat(64) })).status, 403);
  assert.equal((await chama(d, 'acao', { tipo: 'resultado', hostHash: HOSTHASH })).status, 200);
  assert.equal((await d.fetch(req('inexistente', {}))).status, 404);
});

test('DO: a sala sobrevive a ser evictada — o retrato é lido de novo antes de qualquer ação', async () => {
  const st = estado();
  const a = new DemoSalaDO(st, {});
  await chama(a, 'criar', { cfg: cfg(), deck: DECK });
  await chama(a, 'acao', { tipo: 'entrar', parte: pid(1), nome: 'Ana' });
  await chama(a, 'acao', { ator: 'host', hostHash: HOSTHASH, tipo: 'comecar' });
  await new Promise((r) => setTimeout(r, 5)); // a gravação é assíncrona
  assert.ok(st.mem.get('sala'), 'o retrato está no storage');
  const b = new DemoSalaDO(st, {}); // o runtime recriou a instância
  const r = await chama(b, 'acao', { tipo: 'resultado', hostHash: HOSTHASH });
  assert.equal(r.status, 200);
  assert.equal(r.body.resultado.pessoas[0].nome, 'Ana');
  assert.equal(r.body.visao.fase, 'contagem', 'a fase também veio do retrato');
});

test('DO: o alarme é pedido pro próximo prazo, e quando dispara a sala acorda e se apaga ao vencer', async () => {
  const st = estado();
  const t = Date.now();
  const d = new DemoSalaDO(st, {});
  await chama(d, 'criar', { cfg: cfg({ votosAte: t + 30, expiraEm: t + 40 }), deck: DECK });
  assert.ok(st.alarme > 0 && st.alarme <= t + 40, 'a sala pediu um alarme');
  await new Promise((r) => setTimeout(r, 60));
  await d.alarm();
  assert.equal(st.mem.size, 0, 'venceu: o storage foi esvaziado');
  assert.equal(st.alarme, null);
  assert.equal((await chama(d, 'acao', { tipo: 'info' })).status, 404);
});

test('DO: o fluxo SSE sai do DO como Response; recusa sai como JSON', async () => {
  const d = new DemoSalaDO(estado(), {});
  await chama(d, 'criar', { cfg: cfg(), deck: DECK });
  await chama(d, 'acao', { tipo: 'entrar', parte: pid(1), nome: 'Ana' });
  const fora = await chama(d, 'fluxo', { parte: pid(9) });
  assert.deepEqual([fora.status, fora.body.motivo], [404, 'fora-da-sala']);
  const r = await d.fetch(req('fluxo', { parte: pid(1) }));
  assert.equal(r.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const o = leitor(r);
  await new Promise((x) => setTimeout(x, 20));
  assert.equal(o.eventos[0].nome, 'Ana');
  o.parar();
});

test('DO: o código curto vale pra UMA demo, vence e o alarme o apaga', async () => {
  const st = estado();
  const d = new DemoSalaDO(st, {});
  const ate = Date.now() + 40;
  assert.deepEqual((await chama(d, 'codigo-resolver', {})).body, { id: null });
  assert.deepEqual((await chama(d, 'codigo-definir', { id: 'a'.repeat(40), ate })).body, { ok: true });
  assert.deepEqual((await chama(d, 'codigo-definir', { id: 'b'.repeat(40), ate })).body, { ok: false }, 'código vivo de outra demo não é tomado');
  assert.deepEqual((await chama(d, 'codigo-definir', { id: 'a'.repeat(40), ate })).body, { ok: true }, 'a mesma demo renova');
  assert.equal((await chama(d, 'codigo-resolver', {})).body.id, 'a'.repeat(40));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal((await chama(d, 'codigo-resolver', {})).body.id, null, 'venceu');
  await d.alarm();
  assert.equal(st.mem.size, 0);
  assert.deepEqual((await chama(d, 'codigo-definir', { id: 'b'.repeat(40), ate: Date.now() + 1000 })).body, { ok: true }, 'vencido, é de quem pedir');
});

// ── o Worker ────────────────────────────────────────────────────────────────

function kvDeMentira() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }) };
}
const ENV = (ns) => ({ SESSIONS: kvDeMentira(), ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), ...(ns ? { DEMO_SALA: ns } : {}) });
const ctxDeMentira = { waitUntil() {} };
const api = (env, rota, corpo) => worker.fetch(new Request('https://x.test/api/' + rota, { method: 'POST', body: JSON.stringify(corpo) }), env, ctxDeMentira);

test('Worker: exporta a classe do DO que o wrangler declara, e o binding e a migração existem', () => {
  assert.equal(DemoSalaDO, DoDireto, 'o export do Worker é a classe do DO');
  const jsonc = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const w = JSON.parse(jsonc.replace(/,(\s*[}\]])/g, '$1'));
  assert.deepEqual(w.durable_objects.bindings, [{ name: 'DEMO_SALA', class_name: 'DemoSalaDO' }]);
  const tags = w.migrations.map((m) => m.tag);
  assert.deepEqual(tags, ['v1', 'v2', 'v3'], 'as migrações são um histórico: nenhuma sai');
  assert.deepEqual(w.migrations.at(-1), { tag: 'v3', new_sqlite_classes: ['DemoSalaDO'] }, 'só SQLite: o plano grátis não aceita outro');
  assert.ok(readFileSync(new URL('../worker/index.mjs', import.meta.url), 'utf8').includes('env.DEMO_SALA'), 'o código lê o binding declarado');
});

test('Worker: criar no DO e abrir pelo link, pelo Worker — e o fluxo SSE passa inteiro', async () => {
  const ns = namespace();
  const env = ENV(ns);
  await ns.get(ID).fetch('https://demo/criar', { method: 'POST', body: JSON.stringify({ cfg: cfg(), deck: DECK }) });
  const a = await api(env, 'demo-abrir', { segredo: SEGREDO });
  assert.equal(a.status, 200);
  const corpo = await a.json();
  assert.equal(corpo.demo, ID);
  assert.equal(corpo.convidado.length, 3);
  assert.equal((await (await api(env, 'demo-entrar', { demo: ID, parte: pid(1), apelido: 'Ana' })).json()).nome, 'Ana');

  const res = await api(env, 'demo-ao-vivo', { demo: ID, hostKey: HOSTKEY });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const o = leitor(res);
  await new Promise((x) => setTimeout(x, 20));
  assert.equal(o.eventos[0].papel, 'host');
  assert.equal(o.eventos[0].naSala, 1);
  await api(env, 'demo-host', { demo: ID, hostKey: HOSTKEY, tipo: 'comecar' });
  await new Promise((x) => setTimeout(x, 20));
  assert.equal(o.eventos.at(-1).fase, 'contagem', 'a mudança de fase chegou ao apresentador pelo fluxo');
  o.parar();
  assert.equal((await api(env, 'demo-ao-vivo', { demo: ID, hostKey: 'A'.repeat(20) })).status, 403);
  assert.equal((await api(env, 'demo-ao-vivo', {})).status, 400);
  assert.equal((await api(env, 'demo-abrir', { segredo: 'A'.repeat(20) })).status, 404);
});

test('Worker: o DO evictado volta do retrato pelo mesmo caminho', async () => {
  const ns = namespace();
  const env = ENV(ns);
  await ns.get(ID).fetch('https://demo/criar', { method: 'POST', body: JSON.stringify({ cfg: cfg(), deck: DECK }) });
  await api(env, 'demo-entrar', { demo: ID, parte: pid(1), apelido: 'Ana' });
  await new Promise((r) => setTimeout(r, 5));
  ns.evictar(ID);
  const r = await api(env, 'demo-host', { demo: ID, hostKey: HOSTKEY, tipo: 'resultado' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).resultado.pessoas[0].nome, 'Ana');
});

test('Worker: o código curto resolve pelo DO do código, e o mesmo código não vale pra outra demo', async () => {
  const ns = namespace();
  const env = ENV(ns);
  await ns.get(ID).fetch('https://demo/criar', { method: 'POST', body: JSON.stringify({ cfg: cfg(), deck: DECK }) });
  const c = await (await api(env, 'demo-host', { demo: ID, hostKey: HOSTKEY, tipo: 'codigo' })).json();
  assert.match(c.codigo, /^[2-9A-HJ-NP-Z]{6}$/);
  const a = await api(env, 'demo-abrir', { codigo: c.codigo });
  assert.equal(a.status, 200);
  assert.equal((await a.json()).demo, ID);
  assert.equal((await api(env, 'demo-abrir', { codigo: 'ZZZZZZ' })).status, 404);
});

test('Worker sem o binding DEMO_SALA: a demo responde 503 (nunca 500), o resto do app segue', async () => {
  const env = ENV(null);
  for (const [rota, corpo] of [['demo-abrir', { segredo: SEGREDO }], ['demo-entrar', { demo: ID, parte: pid(1), apelido: 'A' }], ['demo-ao-vivo', { demo: ID, parte: pid(1) }]]) {
    const r = await api(env, rota, corpo);
    assert.equal(r.status, 503, rota);
    assert.equal((await r.json()).errorKey, 'srv.err.demoUnavailable');
  }
  assert.equal((await api(env, 'status', {})).status, 200, 'o /status não depende da demo');
});
