// O PISO DO PROJETO É NODE 22 — e este arquivo existe pra que ele continue
// sendo UM número, e não quatro que vão divergindo.
//
// Por que subiu: uma seção do smoke de fluxo usou o `WebSocket` global (que só
// existe do 22 pra cima) e o CI, que rodava no piso 20, reprovou. A primeira
// resposta foi escrever um cliente RFC 6455 à mão — ~90 linhas — só pra atender
// um piso que ninguém mais roda. O owner recusou, com razão: o conserto certo
// era subir a régua, não reimplementar o que a plataforma já dá.
//
// O QUE O PISO 22 COMPROU (medido, não suposto):
//   · `WebSocket` CLIENTE nativo → apagou as ~90 linhas
//   · `Promise.withResolvers`, `Array.findLast`
//
// O QUE ELE NÃO COMPROU:
//   · servidor WebSocket. O Node não tem — conferido em `node:http`, `node:net`
//     e no escopo global. Por isso `server/ws.mjs` continua sendo nosso, e
//     apagá-lo "porque agora o Node tem WebSocket" quebraria a sala.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (p) => readFileSync(join(ROOT, p), 'utf8');
const PISO = 22;

test('o piso é o MESMO número no package.json, no CI e no servidor', () => {
  // Três lugares, um número. Divergir aqui é o CI aprovar o que a produção
  // recusa — ou o contrário, que é pior: o CI reprovando código que funciona.
  const pkg = JSON.parse(ler('package.json'));
  assert.equal(pkg.engines && pkg.engines.node, `>=${PISO}`,
    'o `engines.node` do package.json saiu de sincronia com o piso');

  const ci = ler('.github/workflows/ci.yml');
  const m = ci.match(/node-version:\s*(\d+)/);
  assert.ok(m, 'o CI não declara mais uma node-version');
  assert.equal(Number(m[1]), PISO,
    `o CI roda no Node ${m && m[1]} e o piso é ${PISO} — o CI tem que rodar NO PISO, que é o que pega uso de API mais nova`);

  const node = ler('server/node.mjs');
  const g = node.match(/const MIN_NODE = (\d+);/);
  assert.ok(g, 'o adaptador não recusa mais versão abaixo do piso');
  assert.equal(Number(g[1]), PISO, 'o MIN_NODE do adaptador divergiu do piso');
});

test('a documentação promete o mesmo piso', () => {
  // Quem instala segue o README, não o package.json.
  const readme = ler('README.md');
  assert.match(readme, new RegExp(`Node ${PISO}`),
    'o README não promete mais o piso certo');
  assert.equal(/Node 18\+|Node 20\+/.test(readme), false,
    'sobrou promessa de piso antigo no README');

  const claude = ler('CLAUDE.md');
  assert.match(claude, new RegExp(`Node ${PISO}`), 'o CLAUDE.md não registra o piso');
  assert.equal(/Node 18\+/.test(claude), false, 'sobrou "Node 18+" no CLAUDE.md');
});

test('o piso do Node NÃO vale pro que roda no Cloudflare', () => {
  // ESTA É A INVARIANTE QUE PROTEGE A PRODUÇÃO.
  //
  // `core.mjs` e `presenca.mjs` são importados pelo `worker/`, que roda no
  // Workers — não é Node. Subir o piso do Node é exatamente o tipo de mudança
  // que convida alguém a "modernizar" o core com `node:crypto` ou `Buffer`, e
  // o estrago não aparece em teste local nenhum: aparece no deploy.
  for (const arquivo of ['server/core.mjs', 'server/presenca.mjs']) {
    const s = ler(arquivo);
    const imports = [...s.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((x) => x[1]);
    const nodeApi = imports.filter((x) => x.startsWith('node:'));
    assert.deepEqual(nodeApi, [],
      `${arquivo} importa API de Node (${nodeApi.join(', ')}) — ele roda no Cloudflare Workers, onde isso não existe`);
    assert.equal(/\bBuffer\.(from|alloc)\s*\(/.test(s), false,
      `${arquivo} usa Buffer, que não existe no Workers`);
    assert.equal(/\bprocess\.(env|versions|exit)\b/.test(s), false,
      `${arquivo} usa process, que não existe no Workers`);
  }
});

test('o servidor WebSocket continua sendo nosso — o Node não tem um', () => {
  // Medido: o `WebSocket` global do Node é CLIENTE. Não há servidor em
  // `node:http`, `node:net` nem no escopo global. Apagar `server/ws.mjs`
  // "porque agora o Node tem WebSocket" derrubaria a sala inteira na VM.
  assert.equal(typeof WebSocket, 'function', 'o WebSocket cliente sumiu — o piso 22 não está valendo');
  assert.equal(typeof globalThis.WebSocketServer, 'undefined',
    'o Node passou a ter servidor WebSocket: revisite server/ws.mjs, que talvez possa ir embora');

  const ws = ler('server/ws.mjs');
  assert.match(ws, /class|export/, 'server/ws.mjs sumiu — a sala não sobe na VM sem ele');
});

test('nada de reinventar o que a plataforma já dá', () => {
  // O pedido do owner, virado teste: se voltar a aparecer, é porque alguém
  // reimplementou algo que o piso já entrega.
  const arquivos = ['tools/smoke-fluxo.mjs', 'tools/smoke-presenca.mjs', 'tools/smoke-browser.mjs'];
  for (const a of arquivos) {
    const s = ler(a);
    assert.equal(/Sec-WebSocket-Accept|258EAFA5-E914-47DA-95CA-C5AB0DC85B11/.test(s), false,
      `${a} voltou a implementar o aperto de mão do WebSocket à mão — use o \`WebSocket\` global`);
    assert.equal(/new Promise\(\((?:k|r|res|resolve)\) => setTimeout\(/.test(s), false,
      `${a} voltou a escrever sleep à mão — use \`setTimeout\` de \`node:timers/promises\``);
  }
});
