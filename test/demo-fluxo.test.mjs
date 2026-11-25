// O leitor do fluxo ao vivo (js/demo-fluxo.js), num relógio virtual e com um `fetch` de mentira.
// Cada regra foi vista REPROVANDO com a sabotagem (gotcha #28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fonte = readFileSync(new URL('../js/demo-fluxo.js', import.meta.url), 'utf8');

function mundo() {
  let agora = 1_000_000;
  const fila = [];
  let n = 0;
  const ctx = {
    window: {},
    AbortController, TextDecoder, TextEncoder, JSON, Math: Object.create(Math, { random: { value: () => 0 } }),
    Date: { now: () => agora },
    setTimeout: (fn, ms) => { const h = { id: ++n, ate: agora + ms, fn, repete: null }; fila.push(h); return h; },
    clearTimeout: (h) => { const i = fila.indexOf(h); if (i >= 0) fila.splice(i, 1); },
    setInterval: (fn, ms) => { const h = { id: ++n, ate: agora + ms, fn, repete: ms }; fila.push(h); return h; },
    clearInterval: (h) => { const i = fila.indexOf(h); if (i >= 0) fila.splice(i, 1); },
    chamadas: [],
    roteiro: [],   // o que cada conexão faz: { eventos, fim: 'normal'|'erro'|'mudo', recusa }
  };
  ctx.fetch = async (url, init) => {
    ctx.chamadas.push({ url, corpo: JSON.parse(init.body), agora });
    const passo = ctx.roteiro.shift() || { fim: 'erro' };
    if (passo.recusa) return new Response(JSON.stringify(passo.recusa), { status: passo.recusa.status || 409, headers: { 'Content-Type': 'application/json' } });
    if (passo.fim === 'erro') throw new Error('rede caiu');
    let ctrl;
    const corpo = new ReadableStream({
      start(c) {
        ctrl = c;
        for (const e of passo.eventos || []) c.enqueue(new TextEncoder().encode(e));
        if (passo.fim === 'normal') c.close();
      },
    });
    init.signal.addEventListener('abort', () => { try { ctrl.error(new Error('abortado')); } catch (e) { /* já */ } });
    return new Response(corpo, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  vm.runInNewContext(fonte, ctx);
  const andar = async (ms) => {
    const alvo = agora + ms;
    for (;;) {
      // Deixa as promessas pendentes agendarem os timers ANTES de olhar a fila.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      const prox = fila.filter((h) => h.ate <= alvo).sort((a, b) => a.ate - b.ate)[0];
      if (!prox) break;
      agora = prox.ate;
      if (prox.repete) prox.ate += prox.repete; else fila.splice(fila.indexOf(prox), 1);
      prox.fn();
      await new Promise((r) => setImmediate(r));
    }
    agora = alvo;
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  };
  // Passa o tempo SEM rodar os timers (a aba escondida tem os dela estrangulados pelo navegador).
  const saltar = (ms) => { agora += ms; };
  return { ctx, F: ctx.window.DemoFluxo, andar, saltar, agora: () => agora };
}
const ev = (seq) => `event: estado\nid: ${seq}\ndata: ${JSON.stringify({ seq })}\n\n`;

test('entrega só os eventos «estado» (batimento e outros nomes passam batido)', async () => {
  const m = mundo();
  m.ctx.roteiro.push({ eventos: [': ping\n\n', ev(1), 'event: outro\ndata: {"x":1}\n\n', ev(2)], fim: 'mudo' });
  const vistos = [];
  const f = m.F.criar({ corpo: () => ({ demo: 'd' }), aoEstado: (v) => vistos.push(v.seq) });
  f.conectar();
  await m.andar(10);
  assert.deepEqual(vistos, [1, 2]);
  assert.equal(m.ctx.chamadas[0].url, '/api/demo-ao-vivo');
  assert.deepEqual(m.ctx.chamadas[0].corpo, { demo: 'd' }, 'a chave vai no CORPO');
  f.parar();
});

test('cai e religa com recuo (1 s, 2 s…); o aviso de queda só na 2ª tentativa seguida; «voltou» uma vez', async () => {
  const m = mundo();
  const avisos = [];
  m.ctx.roteiro.push({ fim: 'erro' }, { fim: 'erro' }, { fim: 'erro' }, { eventos: [ev(7)], fim: 'mudo' });
  const f = m.F.criar({ corpo: () => ({}), aoEstado: () => {}, aoRede: (e) => avisos.push(e) });
  f.conectar();
  await m.andar(50);
  assert.equal(m.ctx.chamadas.length, 1);
  assert.deepEqual(avisos, [], 'a 1ª queda não avisa');
  await m.andar(1000);          // recuo da 1ª tentativa
  assert.equal(m.ctx.chamadas.length, 2);
  assert.deepEqual(avisos, ['caiu'], 'a 2ª queda seguida avisa');
  await m.andar(2000);
  assert.equal(m.ctx.chamadas.length, 3, 'o 2º recuo é de 2 s');
  await m.andar(4000);
  assert.equal(m.ctx.chamadas.length, 4);
  assert.equal(avisos.filter((a) => a === 'voltou').length, 1, 'avisa que voltou UMA vez');
  assert.equal(f.tentativa, 0, 'a conexão que serve zera a contagem');
  f.parar();
});

test('o recuo cresce e para em 8 s', () => {
  const m = mundo();
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => m.F.recuoDaTentativa(n, 0)), [1000, 2000, 4000, 8000, 8000, 8000]);
});

test('recusa «parar» não religa sozinha, e o conectar() de quem chama reabre', async () => {
  const m = mundo();
  m.ctx.roteiro.push({ recusa: { motivo: 'fora-da-sala', status: 404 } });
  let recusas = 0;
  const f = m.F.criar({ corpo: () => ({}), aoEstado: () => {}, aoRecusa: (c) => { recusas++; return c.motivo === 'fora-da-sala' ? 'parar' : 'religar'; } });
  f.conectar();
  await m.andar(60_000);
  assert.equal(recusas, 1);
  assert.equal(m.ctx.chamadas.length, 1, 'parado: nenhuma tentativa nova, por mais que passe o tempo');
  // Recusado de vez: nem a volta à aba nem a volta da rede reabrem (seria pedir de novo o que acabou de ser negado).
  f.acordar(); f.voltouARede();
  await m.andar(10);
  assert.equal(m.ctx.chamadas.length, 1, 'acordar e voltouARede respeitam a recusa');
  m.ctx.roteiro.push({ eventos: [ev(1)], fim: 'mudo' });
  f.conectar();
  await m.andar(10);
  assert.equal(m.ctx.chamadas.length, 2, 'uma ordem explícita reabre');
  f.parar();
});

test('recusa «religar» (sala cheia) tenta de novo no recuo', async () => {
  const m = mundo();
  m.ctx.roteiro.push({ recusa: { motivo: 'cheia', status: 429 } }, { eventos: [ev(1)], fim: 'mudo' });
  const f = m.F.criar({ corpo: () => ({}), aoEstado: () => {}, aoRecusa: () => 'religar' });
  f.conectar();
  await m.andar(1600);
  assert.equal(m.ctx.chamadas.length, 2);
  f.parar();
});

test('conexão MUDA por mais de 45 s é derrubada e refeita (o servidor bate a cada 20 s)', async () => {
  const m = mundo();
  m.ctx.roteiro.push({ eventos: [ev(1)], fim: 'mudo' }, { eventos: [ev(2)], fim: 'mudo' });
  const vistos = [];
  const f = m.F.criar({ corpo: () => ({}), aoEstado: (v) => vistos.push(v.seq) });
  f.conectar();
  await m.andar(30_000);
  assert.equal(m.ctx.chamadas.length, 1, 'antes do teto, nada muda');
  await m.andar(30_000);
  assert.ok(m.ctx.chamadas.length >= 2, 'passou de 45 s sem um byte: refaz');
  assert.ok(vistos.includes(2));
  f.parar();
});

test('acordar(): conexão viva não é tocada; morta, reabre já (sem esperar o recuo)', async () => {
  const m = mundo();
  m.ctx.roteiro.push({ eventos: [ev(1)], fim: 'mudo' });
  const f = m.F.criar({ corpo: () => ({}), aoEstado: () => {} });
  f.conectar();
  await m.andar(10);
  f.acordar();
  await m.andar(10);
  assert.equal(m.ctx.chamadas.length, 1, 'viva: não reabre');
  f.parar();
  m.ctx.roteiro.push({ eventos: [ev(2)], fim: 'mudo' });
  f.acordar();
  await m.andar(10);
  assert.equal(m.ctx.chamadas.length, 2, 'morta: reabre na hora');
  // «Viva» no papel mas calada há mais de 45 s (o celular dormiu e os timers da aba foram estrangulados).
  m.saltar(60_000);
  m.ctx.roteiro.push({ eventos: [ev(3)], fim: 'mudo' });
  f.acordar();
  // ANTES de os timers rodarem (o vigia de 5 s também a derrubaria): o acordar sozinho reabre.
  assert.equal(m.ctx.chamadas.length, 3, 'calada demais: reabre ao voltar, na hora');
  await m.andar(10);
  f.parar();
});

test('encerrou(): demo acabada não religa', async () => {
  const m = mundo();
  m.ctx.roteiro.push({ eventos: [ev(1)], fim: 'normal' });
  let acabou = false;
  const f = m.F.criar({ corpo: () => ({}), aoEstado: () => { acabou = true; }, encerrou: () => acabou });
  f.conectar();
  await m.andar(20_000);
  assert.equal(m.ctx.chamadas.length, 1);
});
