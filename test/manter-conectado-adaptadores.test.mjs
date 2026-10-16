// «Manter conectado» nos DOIS adaptadores: o `scheduled` do Worker (importado de
// verdade, com um KV de mentira que pagina o `list`) e o temporizador da VM (o
// `server/node.mjs` de verdade, numa porta livre, com um Waze de mentira
// pré-carregado). O núcleo está em `manter-conectado-servidor.test.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSessions } from '../server/core.mjs';
import { KA_TTL } from '../server/manter-conectado.mjs';
import { ambiente, cookiesCom, HORA } from './_manter.mjs';
import { subirVM } from './_vm.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SECRET = Buffer.alloc(32, 7).toString('base64');
const sha = (t) => createHash('sha256').update(t).digest('hex');

// ─── Worker ─────────────────────────────────────────────────────────────────

// KV que se parece com o da Cloudflare: `list` por prefixo, paginado (a página
// é pequena de propósito, pra provar o cursor), e os nomes COM o `sess_`.
function kvDeMentira(tamanhoDaPagina = 2) {
  const mem = new Map();
  const listagens = [];
  return {
    mem, listagens,
    get: async (k) => (mem.has(k) ? mem.get(k) : null),
    put: async (k, v) => { mem.set(k, v); },
    delete: async (k) => { mem.delete(k); },
    list: async ({ prefix = '', cursor } = {}) => {
      listagens.push({ prefix, cursor });
      const todos = [...mem.keys()].filter((k) => k.startsWith(prefix)).sort();
      const ini = cursor ? Number(cursor) : 0;
      const fatia = todos.slice(ini, ini + tamanhoDaPagina);
      const fim = ini + tamanhoDaPagina >= todos.length;
      return { keys: fatia.map((name) => ({ name })), list_complete: fim, ...(fim ? {} : { cursor: String(ini + tamanhoDaPagina) }) };
    },
  };
}

test('Worker: o `scheduled` pagina o list do KV, renova as sessões devidas pelo store do Worker e usa o waitUntil', async () => {
  const amb = ambiente();
  const setTimeoutReal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => setTimeoutReal(fn, ms >= 1000 ? 1 : ms, ...a);   // a pausa de 1,5–4 s vira 1 ms
  try {
    const { default: worker } = await import('../worker/index.mjs');
    const kv = kvDeMentira(2);
    const keyBytes = Buffer.alloc(32, 7);
    // As sessões são criadas pelo MESMO caminho do Worker: chaves `sess_…`.
    const storeKv = { get: async (h) => kv.mem.get('sess_' + h) ?? null, put: async (h, v) => { kv.mem.set('sess_' + h, v); }, delete: async (h) => { kv.mem.delete('sess_' + h); } };
    const sessions = makeSessions({ store: storeKv, keyBytes });
    const tokens = [];
    for (let i = 0; i < 5; i++) { const t = await sessions.createSession(cookiesCom(`W${i}`)); await sessions.manterLigar(t, 'row'); tokens.push(t); }
    const comum = await sessions.createSession(cookiesCom('COMUM'));
    amb.avancar(6 * HORA);

    const env = { ENCRYPTION_KEY: SECRET, SESSIONS: kv, ASSETS: { fetch: () => new Response('x') } };
    const esperas = [];
    const resumo = await worker.scheduled({ cron: '*/30 * * * *' }, env, { waitUntil: (p) => esperas.push(p) });

    assert.equal(esperas.length, 1, 'o scheduled não entregou a tarefa ao ctx.waitUntil (o runtime a cortaria)');
    assert.equal(resumo.renovadas, 5);
    assert.equal(amb.chamadas.length, 5);
    assert.ok(kv.listagens.length >= 3, `o list não paginou (${kv.listagens.length} chamadas pra 5 entradas em páginas de 2)`);
    assert.ok(kv.listagens.every((l) => l.prefix === 'sess_ka_'), 'o prefixo do list tem que levar o sess_ do store');
    assert.ok(kv.listagens.some((l) => l.cursor), 'o cursor da página seguinte não foi usado');
    for (const t of tokens) {
      assert.match((/_web_session\t(\S+)/.exec(await makeSessions({ store: storeKv, keyBytes }).loadSession(t)) || [])[1], /^ROT/, 'o cookie guardado não mudou');
    }
    assert.equal((/_web_session\t(\S+)/.exec(await makeSessions({ store: storeKv, keyBytes }).loadSession(comum)) || [])[1], 'COMUM', 'a sessão SEM «Manter conectado» foi tocada');
  } finally { globalThis.setTimeout = setTimeoutReal; amb.restaurar(); }
});

test('Worker: o `scheduled` não lança sem binding, com chave ruim ou com o KV falhando — e não vai ao Waze', async () => {
  const amb = ambiente();
  try {
    const { default: worker } = await import('../worker/index.mjs');
    const ctx = { waitUntil: () => {} };
    assert.equal(await worker.scheduled({}, {}, ctx), null);
    assert.equal(await worker.scheduled({}, { ENCRYPTION_KEY: 'YWJj', SESSIONS: kvDeMentira() }, ctx), null);
    const quebrado = { ...kvDeMentira(), list: async () => { throw new Error('KV fora'); } };
    const r = await worker.scheduled({}, { ENCRYPTION_KEY: SECRET, SESSIONS: quebrado }, ctx);
    assert.ok(r === null || r.vistas === 0);
    assert.equal(amb.chamadas.length, 0);
  } finally { amb.restaurar(); }
});

// ─── VM ─────────────────────────────────────────────────────────────────────

const esperarAte = async (cond, rotulo, tetoMs = 15000) => {
  const fim = performance.now() + tetoMs;
  while (performance.now() < fim) {
    if (await cond()) return;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  assert.fail(`a espera estourou (${tetoMs} ms): ${rotulo}`);
};

async function pedir(vm, rota, corpo) {
  const r = await fetch(vm.url('/api/' + rota), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json() };
}

test('VM: o temporizador do «Manter conectado» renova a sessão devida do disco (list de arquivo, pausa, Waze de mentira)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp-manter-'));
  const log = join(dir, 'waze.log');
  writeFileSync(log, '');
  const sessDir = join(dir, 'sessoes');
  const vm = await subirVM({
    SESSION_DIR: sessDir, SESSION_KEY_FILE: join(dir, 'k'), WAZE_STUB_LOG: log, WAZE_STUB_SALTO: join(dir, 'salto'),
    NODE_OPTIONS: `--import=${join(AQUI, 'manter-conectado-vm.mjs')}`,
    MANTER_PRIMEIRA_MS: '400', MANTER_INTERVALO_MS: '600', MANTER_PAUSA_MS: '0',
  });
  try {
    const login = await pedir(vm, 'testar-cookies', { cookies: cookiesCom('DO-ARQUIVO'), region: 'row' });
    assert.equal(login.status, 200, JSON.stringify(login.corpo));
    const token = login.corpo.sessionToken;
    const perfil = await pedir(vm, 'perfil', { sessionToken: token, region: 'row', manter: true });
    assert.equal(perfil.corpo.manterConectado, true);
    const arquivo = join(sessDir, 'sess_' + sha(token));
    assert.ok(existsSync(join(sessDir, 'sess_ka_' + sha(token))), 'a entrada não foi pro disco');

    // Em dia: a varredura passa e NÃO vai ao Waze (só as 2 idas do login e do perfil).
    await new Promise((ok) => setTimeout(ok, 1500));
    const idasEmDia = readFileSync(log, 'utf8').trim().split('\n').length;
    assert.equal(idasEmDia, 2, `a varredura foi ao Waze por uma sessão em dia (${idasEmDia} idas)`);

    // O editor "sumiu por 6 h": o relógio da VM salta (ver o pré-carregado).
    const antes = Math.floor(Date.now() / 1000);
    writeFileSync(join(dir, 'salto'), '');
    await esperarAte(() => readFileSync(log, 'utf8').trim().split('\n').length > idasEmDia, 'a varredura da VM não renovou a sessão devida');

    // O carimbo voltou a ser recente (o cookie novo foi gravado) e o valor é o do Waze de mentira.
    await esperarAte(() => parseInt(readFileSync(arquivo, 'utf8'), 10) > antes + 5 * HORA, 'o cookie renovado não foi gravado no arquivo');
    const store = { get: async (h) => readFileSync(join(sessDir, 'sess_' + h), 'utf8') };
    const guardado = await makeSessions({ store, keyBytes: Buffer.alloc(32, 7) }).loadSession(token);
    assert.match(/_web_session\t(\S+)/.exec(guardado)[1], /^VM\d+$/, 'o cookie guardado não mudou');
  } finally {
    vm.parar();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('VM: duas varreduras nunca correm juntas — uma lenta (pausa longa) não é alcançada pelo temporizador seguinte', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp-manter-re-'));
  const log = join(dir, 'waze.log');
  writeFileSync(log, '');
  const vm = await subirVM({
    SESSION_DIR: join(dir, 'sessoes'), SESSION_KEY_FILE: join(dir, 'k'), WAZE_STUB_LOG: log, WAZE_STUB_SALTO: join(dir, 'salto'),
    NODE_OPTIONS: `--import=${join(AQUI, 'manter-conectado-vm.mjs')}`,
    MANTER_PRIMEIRA_MS: '60000', MANTER_INTERVALO_MS: '300', MANTER_PAUSA_MS: '1500',   // a 1ª e o 1º tique de um intervalo igual cairiam juntos
  });
  try {
    for (const nome of ['A', 'B']) {
      const login = await pedir(vm, 'testar-cookies', { cookies: cookiesCom('S-' + nome), region: 'row' });
      await pedir(vm, 'perfil', { sessionToken: login.corpo.sessionToken, region: 'row', manter: true });
    }
    const idasAntes = readFileSync(log, 'utf8').trim().split('\n').length;
    writeFileSync(join(dir, 'salto'), '');                      // as duas passam a estar devidas
    await esperarAte(() => readFileSync(log, 'utf8').trim().split('\n').length > idasAntes, 'a varredura não começou');
    await new Promise((ok) => setTimeout(ok, 3500));            // dá tempo da pausa de 1,5 s e de ~10 disparos do temporizador
    const idas = readFileSync(log, 'utf8').trim().split('\n').length - idasAntes;
    assert.equal(idas, 2, `${idas} idas ao Waze pra 2 sessões devidas: varreduras sobrepostas renovaram a mesma duas vezes`);
  } finally {
    vm.parar();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('VM: a faxina apaga a entrada ka_ vencida pelo CARIMBO (o mtime é renovado a cada leitura e não serve) e mantém a viva', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp-manter-gc-'));
  const sessDir = join(dir, 'sessoes');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(sessDir, { recursive: true });
  const agora = Math.floor(Date.now() / 1000);
  const velha = join(sessDir, 'sess_ka_' + 'a'.repeat(64));
  const viva = join(sessDir, 'sess_ka_' + 'b'.repeat(64));
  writeFileSync(velha, `${agora - KA_TTL - 3600}|blob`);   // mtime = agora: só o carimbo diz que venceu
  writeFileSync(viva, `${agora - 3600}|blob`);
  const vm = await subirVM({ SESSION_DIR: sessDir, SESSION_KEY_FILE: join(dir, 'k'), MANTER_DESLIGADO: '1' });
  try {
    await esperarAte(() => !existsSync(velha), 'a faxina não apagou a entrada de keepalive vencida');
    assert.ok(existsSync(viva), 'a faxina apagou a entrada viva');
    assert.deepEqual(readdirSync(sessDir).sort(), ['sess_ka_' + 'b'.repeat(64)]);
  } finally {
    vm.parar();
    rmSync(dir, { recursive: true, force: true });
  }
});
