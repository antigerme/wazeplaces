// A ENCRYPTION_KEY de tamanho errado (auditoria do servidor de 2026-09-29, S8).
//
// O Secret é a entrada do HKDF que cifra as sessões (`derivarChave`), e o HKDF
// aceita qualquer tamanho: chave de 3 bytes ("YWJj") e de 16 funcionavam
// caladas nos dois adaptadores. E a de base64 quebrado derrubava a VM pelo
// `uncaughtException`, que só registra: o processo saía com código 0 — um
// supervisor leria a queda como sucesso. Hoje a régua é uma só (`chaveDoSecret`,
// no core): no mínimo 32 bytes — e NÃO exatamente 32, porque a chave de
// produção pode ser maior e não pode derrubar o app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chaveDoSecret, CHAVE_MIN_BYTES, makeSessions } from '../server/core.mjs';
import { subirVM } from './_vm.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const b64 = (n) => Buffer.alloc(n, 7).toString('base64');
const RUINS = [['3 bytes', 'YWJj'], ['16 bytes', b64(16)], ['31 bytes', b64(31)], ['base64 quebrado', '@@@ não é base64']];
const BOAS = [['32 bytes', b64(32)], ['48 bytes', b64(48)], ['64 bytes', b64(64)]];

test('core: a chave precisa de pelo menos 32 bytes — menos é recusada, e MAIS é aceita', () => {
  assert.equal(CHAVE_MIN_BYTES, 32);
  for (const [nome, chave] of RUINS) {
    const r = chaveDoSecret(chave);
    assert.equal(r.keyBytes, null, `${nome}: a chave passou`);
    assert.ok(r.problema, `${nome}: sem o motivo`);
    assert.ok(!r.problema.includes(chave), `${nome}: o motivo carrega a própria chave`);
  }
  for (const [nome, chave] of BOAS) {
    const r = chaveDoSecret(chave);
    assert.equal(r.problema, null, `${nome}: recusada (${r.problema})`);
    assert.equal(r.keyBytes.length, Number(nome.split(' ')[0]), nome);
  }
  // Espaço e quebra de linha em volta (o arquivo da VM termina em \n) não contam.
  assert.equal(chaveDoSecret(' ' + b64(32) + '\n').problema, null);
  // E o `makeSessions` tem a mesma régua, pra um adaptador novo que esqueça a dele.
  const store = { get: async () => null, put: async () => {}, delete: async () => {} };
  assert.throws(() => makeSessions({ store, keyBytes: new Uint8Array(16) }), /16 bytes, o mínimo é 32/);
  assert.throws(() => makeSessions({ store, keyBytes: null }), /o mínimo é 32/);
  assert.doesNotThrow(() => makeSessions({ store, keyBytes: new Uint8Array(48) }), 'a chave maior que 32 foi recusada');
});

test('Worker: ENCRYPTION_KEY curta ou quebrada é o 500 de "Backend não configurado", com o motivo — e a de 48 bytes funciona', async () => {
  const { default: worker } = await import('../worker/index.mjs');
  const pedir = async (chave) => {
    const kv = new Map();
    const env = {
      ENCRYPTION_KEY: chave,
      SESSIONS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
      ASSETS: { fetch: () => new Response('asset') },
    };
    const res = await worker.fetch(new Request('https://app.exemplo/api/sessao', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'destroy', sessionToken: 'x' }),
    }), env, {});
    return { status: res.status, corpo: await res.json() };
  };
  for (const [nome, chave] of RUINS) {
    const r = await pedir(chave);
    assert.equal(r.status, 500, `${nome}: HTTP ${r.status}`);
    assert.match(r.corpo.error, /^Backend não configurado \(ENCRYPTION_KEY /, `${nome}: ${r.corpo.error}`);
  }
  assert.match((await pedir('YWJj')).corpo.error, /3 bytes; o mínimo é 32/, 'o motivo não diz o tamanho');
  // CONTROLE: a chave boa (e a maior que 32) atende.
  for (const [nome, chave] of BOAS) {
    const r = await pedir(chave);
    assert.equal(r.status, 200, `CONTROLE (${nome}): ${JSON.stringify(r.corpo)}`);
  }
});

// Sobe a VM de verdade e espera ela SAIR (a chave ruim) ou dizer a porta (a boa).
function bootDaVM(env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(RAIZ, 'server', 'node.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (b) => {
      out += b;
      if (/rodando em http:\/\/[^\s]+:\d+/.test(out)) { p.kill(); resolve({ subiu: true, out, err }); }
    });
    p.stderr.on('data', (b) => { err += b; });
    const prazo = setTimeout(() => { p.kill(); resolve({ subiu: null, out, err }); }, 15000);
    p.once('exit', (codigo) => { clearTimeout(prazo); resolve({ subiu: false, codigo, out, err }); });
  });
}

test('VM: ENCRYPTION_KEY curta ou quebrada derruba o boot com código 1 e o motivo — da variável e do arquivo', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp-chave-'));
  try {
    const base = { ...process.env, PORT: '0', HOST: '127.0.0.1', SESSION_DIR: join(dir, 's'), SESSION_KEY_FILE: join(dir, 'chave') };
    delete base.ENCRYPTION_KEY;
    for (const [nome, chave] of RUINS) {
      const r = await bootDaVM({ ...base, ENCRYPTION_KEY: chave });
      assert.equal(r.subiu, false, `${nome}: a VM ${r.subiu === null ? 'ficou pendurada' : 'subiu'} com a chave ruim`);
      assert.equal(r.codigo, 1, `${nome}: saiu com código ${r.codigo} — um supervisor leria como sucesso`);
      assert.match(r.err, /Waze Places não subiu: ENCRYPTION_KEY .* — lida da variável ENCRYPTION_KEY\./, `${nome}: ${r.err}`);
      assert.ok(!r.err.includes(chave), `${nome}: a mensagem imprime a chave`);
    }
    // A chave do ARQUIVO (sem a variável) passa pela mesma régua.
    writeFileSync(join(dir, 'chave'), b64(16) + '\n');
    const arq = await bootDaVM(base);
    assert.equal(arq.codigo, 1, `arquivo com 16 bytes: ${JSON.stringify(arq)}`);
    assert.ok(arq.err.includes('lida do arquivo ' + join(dir, 'chave')), `a mensagem não diz de qual arquivo: ${arq.err}`);
    // CONTROLE: a chave de 48 bytes sobe e atende (a régua é MÍNIMO, não "exatamente 32").
    const vm = await subirVM({ ENCRYPTION_KEY: b64(48), SESSION_DIR: join(dir, 's') });
    try {
      assert.equal((await fetch(vm.url('/'))).status, 200);
      const api = await fetch(vm.url('/api/sessao'), { method: 'POST', body: JSON.stringify({ action: 'destroy', sessionToken: 'x' }) });
      assert.equal(api.status, 200, 'CONTROLE: a API da VM com a chave de 48 bytes não atendeu');
    } finally { vm.parar(); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
