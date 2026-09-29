// Toda ferramenta que sobe o app passa por UMA porta (`tools/servidor-local.mjs`),
// e essa porta não deixa o teste medir o servidor de OUTRO processo.
//
// A história: a guarda da porta ocupada estava copiada em três scripts e faltava
// em quatro. Na auditoria de 2026-09-26, com dois agentes rodando o smoke de
// layout ao mesmo tempo, o `spawn` de um morreu com EADDRINUSE, a sonda de saúde
// passou com o servidor do OUTRO, e o smoke mediu o código alheio até alguém
// matar o processo. Cópia é como a correção chega num lugar e não no outro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer as criarHttp } from 'node:http';
import { createServer as criarTcp } from 'node:net';
import { spawn } from 'node:child_process';

const ler = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// Sem comentário na conta (gotcha #67): os arquivos CITAM o jeito errado.
const semComentario = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
// Um `spawn(` cujos argumentos, até o fim da instrução, falam do node.mjs.
const SOBE_O_APP = /spawn\s*\([^;]*node\.mjs/s;

// Os que sobem o app hoje: serve de ALCANCE — se um deles parar de passar pela
// fonte única, ou o guard parar de enxergá-lo, reprova.
const SOBEM_O_APP = ['smoke-browser.mjs', 'smoke-presenca.mjs', 'smoke-fluxo.mjs', 'smoke-offline.mjs',
  'smoke-diag-tela.mjs', 'diag-replay.mjs', 'gerar-splash.mjs'];

test('toda ferramenta que sobe o app passa pela fonte única', () => {
  // CONTROLE: o guard enxerga um `spawn` do node.mjs (o da própria fonte única).
  assert.match(semComentario(ler('tools/servidor-local.mjs')), SOBE_O_APP);
  const arquivos = readdirSync(new URL('../tools/', import.meta.url))
    .filter((f) => f.endsWith('.mjs') && f !== 'servidor-local.mjs');
  for (const f of arquivos) {
    assert.doesNotMatch(semComentario(ler(`tools/${f}`)), SOBE_O_APP,
      `${f} sobe o server/node.mjs por conta própria — use o subirServidorLocal (tools/servidor-local.mjs)`);
  }
  for (const f of SOBEM_O_APP) {
    assert.match(semComentario(ler(`tools/${f}`)), /await subirServidorLocal\(\{/, `${f} deixou de subir o app pela fonte única`);
  }
});

// ── o comportamento, num processo à parte (a fonte única dá process.exit) ─────
const portaLivre = () => new Promise((ok) => {
  const s = criarTcp().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
});
function rodar(porta) {
  const codigo = `
    const { subirServidorLocal } = await import(${JSON.stringify(new URL('../tools/servidor-local.mjs', import.meta.url).href)});
    const { base } = await subirServidorLocal({ porta: ${porta}, variavel: 'TESTE_PORTA', tetoMs: 8000,
      env: { ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') } });
    const r = await fetch(base + '/');
    console.log('STATUS ' + r.status);
    process.exit(0);`;
  return new Promise((ok) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', codigo], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { err += b; });
    p.on('exit', (code) => ok({ code, out, err }));
  });
}

test('servidor local: com a porta livre, sobe o app e ele atende', async () => {
  const r = await rodar(await portaLivre());
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /STATUS 200/);
});

test('servidor local: porta ocupada por OUTRO servidor HTTP — recusa, com o caminho, em vez de medir o alheio', async () => {
  const alheio = criarHttp((req, res) => res.end('outro app')).listen(0, '127.0.0.1');
  await new Promise((ok) => alheio.once('listening', ok));
  try {
    const r = await rodar(alheio.address().port);
    assert.equal(r.code, 1, 'mediu o servidor ALHEIO: ' + r.out);
    assert.doesNotMatch(r.out, /STATUS/, 'chegou a medir: ' + r.out);
    assert.match(r.err, /já está ocupada/);
    assert.match(r.err, /TESTE_PORTA=/, 'o erro não diz como trocar de porta');
  } finally { alheio.close(); }
});

test('servidor local: a porta tomada por quem não fala HTTP — o processo morre e a fonte única DIZ, sem esperar o teto', async () => {
  // A sonda HTTP não enxerga esse ocupante (a conexão cai), então só o sinal
  // POSITIVO pega: o nosso processo morre com EADDRINUSE e nunca diz "rodando".
  const mudo = criarTcp((sock) => sock.destroy()).listen(0, '127.0.0.1');
  await new Promise((ok) => mudo.once('listening', ok));
  try {
    const t0 = Date.now();
    const r = await rodar(mudo.address().port);
    assert.equal(r.code, 1, 'subiu com a porta tomada: ' + r.out);
    assert.match(r.err, /morreu ao subir/);
    assert.ok(Date.now() - t0 < 7000, 'esperou o teto em vez de ver o processo morrer');
  } finally { mudo.close(); }
});
