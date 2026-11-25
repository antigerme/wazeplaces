// A demo na VM DE VERDADE (server/node.mjs) por HTTP: o fluxo SSE, a chave no
// corpo, a sala carregada do arquivo e o desligamento que grava o pendente.
// A sala nasce semeada em arquivo (criar de ponta a ponta precisa do Waze, e isso
// é do teste de rotas): a VM a carrega sob demanda, que é justamente o caminho
// de uma VM que reiniciou.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { subirVM } from './_vm.mjs';
import { novaSala } from '../server/demo-sala.mjs';
import { MAX_CLIENTES } from '../server/demo-sala-viva.mjs';

// A VM, ao receber o sinal, ainda grava o pendente: espera um instante antes de apagar a pasta.
const limpar = async (raiz) => { await new Promise((r) => setTimeout(r, 500)); rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
const sha = (t) => createHash('sha256').update(t).digest('hex');
const SEGREDO = 'ABCDEFGHJKLMNPQRSTUV';
const HOSTKEY = 'WXYZ2345679ABCDEFGHJ';
const ID = sha('demo:' + SEGREDO).slice(0, 40);
const pid = (n) => 'parte-de-teste-' + String(n).padStart(4, '0');

function semear(dir, extra = {}) {
  const agora = Date.now();
  const est = novaSala({
    id: ID, hostHash: sha('demo-host:' + HOSTKEY), modo: 'livre', tempoMs: 0, referencia: false, total: 3, max: 10,
    criadoEm: agora, votosAte: agora + 3 * 3600_000, expiraEm: agora + 48 * 3600_000, ...extra,
  }, agora);
  const deck = { convidado: [1, 2, 3].map((n) => ({ n, name: 'Local ' + n })), apresentador: [1, 2, 3].map((n) => ({ n, venueID: 'v' + n, updateRequestID: 'u' + n })), regiao: 'row' };
  writeFileSync(join(dir, `demo_sala_${ID}.json`), JSON.stringify({ est, deck }));
}

async function comVM(fn) {
  const raiz = mkdtempSync(join(tmpdir(), 'demo-vm-'));
  const dir = join(raiz, 'demos');
  await import('node:fs').then((f) => f.mkdirSync(dir, { recursive: true }));
  semear(dir);
  const vm = await subirVM({ DEMO_DIR: dir, STATE_DIRECTORY: raiz, MANTER_DESLIGADO: '1' });
  try { return await fn({ vm, dir, raiz }); } finally { vm.parar(); await limpar(raiz); }
}
const post = async (vm, rota, corpo) => {
  const r = await fetch(vm.url('/api/' + rota), { method: 'POST', body: JSON.stringify(corpo) });
  return { status: r.status, body: await r.json(), headers: r.headers };
};

// Abre o fluxo e junta os eventos conforme chegam.
function fluxo(vm, corpo) {
  const eventos = [];
  const ctl = new AbortController();
  let pronto;
  const abriu = new Promise((r) => { pronto = r; });
  const laco = (async () => {
    const res = await fetch(vm.url('/api/demo-ao-vivo'), { method: 'POST', body: JSON.stringify(corpo), signal: ctl.signal });
    pronto(res);
    if (!(res.headers.get('content-type') || '').startsWith('text/event-stream')) return;
    const leitor = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const bloco = buf.slice(0, i); buf = buf.slice(i + 2);
          if (bloco.startsWith(':')) continue;
          eventos.push(JSON.parse(/^data: (.*)$/m.exec(bloco)[1]));
        }
      }
    } catch { /* abortado */ }
  })();
  const esperar = async (pred, ms = 5000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { const e = eventos.find(pred); if (e) return e; await new Promise((r) => setTimeout(r, 25)); }
    throw new Error('o evento esperado não chegou: ' + JSON.stringify(eventos.at(-1)));
  };
  return { eventos, esperar, abriu, parar: () => ctl.abort(), laco };
}

test('VM: a sala semeada em arquivo abre pelo link; o hash da chave nunca sai', async () => {
  await comVM(async ({ vm }) => {
    const r = await post(vm, 'demo-abrir', { segredo: SEGREDO });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.demo, ID);
    assert.equal(r.body.convidado.length, 3);
    const bruto = JSON.stringify(r.body);
    assert.ok(!bruto.includes('hostHash') && !bruto.includes('updateRequestID'));
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await post(vm, 'demo-abrir', { segredo: 'A'.repeat(20) })).status, 404);
  });
});

test('VM: o fluxo SSE leva a chave no CORPO e entrega o estado de agora', async () => {
  await comVM(async ({ vm }) => {
    await post(vm, 'demo-entrar', { demo: ID, parte: pid(1), apelido: 'Ana' });
    const g = fluxo(vm, { demo: ID, parte: pid(1) });
    const res = await g.abriu;
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(!res.headers.get('content-length'), 'um fluxo não tem tamanho');
    const e = await g.esperar((x) => x.nome === 'Ana');
    assert.equal(e.papel, 'convidado');
    assert.equal(e.fase, 'saguao');
    g.parar();
  });
});

test('VM: o fluxo recusa em JSON quem não entrou e quem erra a chave; GET não abre fluxo', async () => {
  await comVM(async ({ vm }) => {
    const fora = await post(vm, 'demo-ao-vivo', { demo: ID, parte: pid(9) });
    assert.deepEqual([fora.status, fora.body.motivo], [404, 'fora-da-sala']);
    const falsa = await post(vm, 'demo-ao-vivo', { demo: ID, hostKey: 'A'.repeat(20) });
    assert.deepEqual([falsa.status, falsa.body.motivo], [403, 'sem-permissao']);
    assert.equal((await post(vm, 'demo-ao-vivo', {})).status, 400);
    const get = await fetch(vm.url('/api/demo-ao-vivo'));
    assert.equal(get.status, 405);
  });
});

test('VM: o apresentador começa, a sala conta 3 s e TODOS recebem a triagem aberta, sem ninguém pedir', async () => {
  await comVM(async ({ vm }) => {
    await post(vm, 'demo-entrar', { demo: ID, parte: pid(1), apelido: 'Ana' });
    await post(vm, 'demo-entrar', { demo: ID, parte: pid(2), apelido: 'Bia' });
    const host = fluxo(vm, { demo: ID, hostKey: HOSTKEY });
    const conv = fluxo(vm, { demo: ID, parte: pid(1) });
    await host.esperar((e) => e.papel === 'host' && e.naSala === 2);
    await conv.esperar((e) => e.fase === 'saguao');
    const c = await post(vm, 'demo-host', { demo: ID, hostKey: HOSTKEY, tipo: 'comecar' });
    assert.equal(c.status, 200);
    await conv.esperar((e) => e.fase === 'contagem', 2000);
    const aberta = await conv.esperar((e) => e.fase === 'andamento', 6000); // o alarme da VM acordou a sala
    assert.equal(aberta.modo, 'livre');
    const v = await post(vm, 'demo-votar', { demo: ID, parte: pid(1), idx: 2, voto: 'R' });
    assert.equal(v.status, 200);
    const visto = await host.esperar((e) => e.pedidos && e.pedidos[1].n === 1, 3000);
    assert.deepEqual(visto.pedidos[1], { n: 1 }, 'no livre o palco recebe só a CONTAGEM ao vivo: a divisão colorida orientaria quem ainda vota');
    const dele = await conv.esperar((e) => typeof e.votos === 'string' && e.votos[1] === 'R', 3000);
    assert.ok(!('pedidos' in dele) && !('pessoas' in dele), 'o convidado não recebe a lista nem as barras');
    host.parar(); conv.parar();
  });
});

test('VM: SIGTERM grava o que estava pendente e a próxima VM continua de onde parou', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'demo-vm-'));
  const dir = join(raiz, 'demos');
  await import('node:fs').then((f) => f.mkdirSync(dir, { recursive: true }));
  semear(dir);
  const arq = join(dir, `demo_sala_${ID}.json`);
  try {
    const a = await subirVM({ DEMO_DIR: dir, STATE_DIRECTORY: raiz, MANTER_DESLIGADO: '1' });
    await post(a, 'demo-entrar', { demo: ID, parte: pid(1), apelido: 'Ana' });
    await post(a, 'demo-host', { demo: ID, hostKey: HOSTKEY, tipo: 'comecar' });
    await new Promise((r) => setTimeout(r, 3300)); // a triagem abre
    const v = await post(a, 'demo-votar', { demo: ID, parte: pid(1), idx: 1, voto: 'L' });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    // O voto é gravado com ATRASO: agora ainda não está no arquivo.
    assert.ok(!JSON.parse(readFileSync(arq, 'utf8')).est.partes[pid(1)].votos.includes('L'), 'ainda não gravou (atraso de propósito)');
    a.parar(); // SIGTERM
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(JSON.parse(readFileSync(arq, 'utf8')).est.partes[pid(1)].votos[0], 'L', 'o desligamento gravou o pendente');
    const b = await subirVM({ DEMO_DIR: dir, STATE_DIRECTORY: raiz, MANTER_DESLIGADO: '1' });
    try {
      const r = await post(b, 'demo-host', { demo: ID, hostKey: HOSTKEY, tipo: 'visao' });
      assert.equal(r.status, 200);
      assert.equal(r.body.visao.fase, 'andamento', 'a VM nova carregou a sala do arquivo');
      assert.deepEqual(r.body.visao.pedidos[0], { n: 1 }, 'livre: sem divisão ao vivo');
    } finally { b.parar(); }
  } finally { await limpar(raiz); }
});

test('VM: a sala vencida some do disco no boot, e o apagamento não leva as outras', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'demo-vm-'));
  const dir = join(raiz, 'demos');
  await import('node:fs').then((f) => f.mkdirSync(dir, { recursive: true }));
  semear(dir, { expiraEm: Date.now() - 1000, votosAte: Date.now() - 2000 });
  const arq = join(dir, `demo_sala_${ID}.json`);
  try {
    const vm = await subirVM({ DEMO_DIR: dir, STATE_DIRECTORY: raiz, MANTER_DESLIGADO: '1' });
    try {
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(existsSync(arq), false, 'a varredura do boot apagou a sala vencida');
      assert.equal((await post(vm, 'demo-abrir', { segredo: SEGREDO })).status, 404);
    } finally { vm.parar(); }
  } finally { await limpar(raiz); }
});

// Celular que trava a tela, entra em túnel ou troca de rede ABANDONA o fluxo sem avisar a sala. Se a
// VM não percebe, o cliente morto fica na lista e o teto (MAX_CLIENTES) é gasto por fantasmas: numa
// hora de sala, ninguém mais entra — nem o apresentador.
test('VM: fluxo abandonado SAI da lista — abrir e abortar mais que o teto não trava a sala', async () => {
  await comVM(async ({ vm }) => {
    await post(vm, 'demo-entrar', { demo: ID, parte: pid(1), apelido: 'Ana' });
    const total = MAX_CLIENTES + 50;
    for (let i = 0; i < total; i++) {
      const ctl = new AbortController();
      const res = await fetch(vm.url('/api/demo-ao-vivo'), { method: 'POST', body: JSON.stringify({ demo: ID, parte: pid(1) }), signal: ctl.signal });
      assert.equal(res.status, 200, `a conexão ${i + 1} foi recusada: os abandonados não saíram da lista`);
      ctl.abort();
    }
    await new Promise((r) => setTimeout(r, 300));
    const ultimo = await fetch(vm.url('/api/demo-ao-vivo'), { method: 'POST', body: JSON.stringify({ demo: ID, hostKey: HOSTKEY }) });
    assert.equal(ultimo.status, 200, 'o apresentador não consegue mais abrir o fluxo');
    await ultimo.body.cancel();
  });
});
