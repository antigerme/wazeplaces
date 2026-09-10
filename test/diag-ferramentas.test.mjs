// As duas ferramentas que leem um diagnóstico do modo dev.
//
// `diag-replay.mjs` reconstrói a TELA do editor localmente (sem rede) e
// `diag-api.mjs` PERGUNTA à API de produção com o token que o próprio arquivo
// carrega — ideia do owner, e ela tira a maior parte dos pedidos de `cookies.txt`
// do caminho: o token é a chave da NOSSA API, que tem os cookies do Waze
// cifrados no servidor.
//
// O que este arquivo trava é a SEGURANÇA da segunda. Ela age na conta de quem
// gerou o diagnóstico, então "só leitura" não pode depender de eu lembrar —
// tem que ser recusa por construção, como o `waze-probe.mjs` faz com `/Features`
// e `/Issues/Read`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = readFileSync(join(ROOT, 'tools/diag-api.mjs'), 'utf8');
const REPLAY = readFileSync(join(ROOT, 'tools/diag-replay.mjs'), 'utf8');
const APP = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
const CORE = readFileSync(join(ROOT, 'server/core.mjs'), 'utf8');

// Toda rota que ESCREVE (ou desloga) tem que estar na recusa. A lista sai do
// ROUTES do core, então rota nova aparece aqui em vez de passar despercebida.
const LEITURA = new Set(['perfil', 'buscar-places', 'lista-paises', 'lista-estados', 'presenca', 'testar-cookies']);

test('diag-api: TODA rota não-leitura está na lista de recusa', () => {
  const bloco = API.match(/const ESCRITA = new Set\(\[([^\]]+)\]\)/);
  assert.ok(bloco, 'a lista de recusa sumiu');
  const recusadas = new Set([...bloco[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

  const rotas = [...CORE.matchAll(/^\s*'([a-z-]+)':\s*handle/gm)].map((m) => m[1]);
  assert.ok(rotas.length >= 8, `só ${rotas.length} rotas achadas no core — o padrão do ROUTES mudou`);
  for (const r of rotas) {
    if (LEITURA.has(r)) continue;
    assert.ok(recusadas.has(r),
      `a rota "${r}" escreve/desloga e NÃO está recusada em diag-api.mjs — ela agiria na conta de terceiro`);
  }
});

test('diag-api: a recusa acontece ANTES de qualquer rede', () => {
  const iRecusa = API.indexOf('if (ESCRITA.has(ROTA))');
  const iFetch = API.indexOf('await fetch(');
  assert.ok(iRecusa > 0 && iFetch > iRecusa,
    'a checagem de escrita deixou de vir antes do fetch — a recusa viraria enfeite');
});

test('diag-api: o token nunca é impresso nem vai por linha de comando', () => {
  // Ele viaja no CORPO do POST, que é onde a criptografia da app pressupõe que
  // ele viva (gotcha #60: token em URL/query/log derruba a garantia).
  assert.ok(!/console\.log\([^)]*\btoken\b/.test(API), 'algum console.log imprime o token');
  assert.match(API, /sessionToken: '<TOKEN>'/, 'o resumo do corpo parou de mascarar o token');
  assert.match(API, /body: JSON\.stringify\(corpo\)/, 'o token saiu do corpo do POST');
  assert.ok(!/[?&]sessionToken=/.test(API), 'o token foi parar numa query string');
});

test('diag-api: usa o jitter da FONTE ÚNICA, não um sleep próprio', () => {
  assert.match(API, /import \{ pausaComJitter \} from '\.\/waze-jitter\.mjs'/,
    'parou de importar o jitter da fonte única');
  assert.match(API, /await pausaComJitter\(\)/, 'o jitter não é chamado');
  assert.ok(!/setTimeout\(\s*\w+\s*,\s*\d{3,}/.test(API), 'apareceu um sleep próprio no lugar do jitter');
});

test('diag-api: recusa de verdade, rodando o script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'diag-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, JSON.stringify({
    app: { url: 'https://exemplo.invalido/' },
    localStorage: { waze_session_token: 'nao-usado-porque-recusa-antes' },
  }));
  for (const rota of ['marcar-lido', 'validar-place', 'excluir-foto', 'renomear-local', 'sessao']) {
    let saiu = 0;
    try {
      execFileSync(process.execPath, [join(ROOT, 'tools/diag-api.mjs'), arq, rota],
        { stdio: 'pipe', timeout: 20000 });
    } catch (e) { saiu = e.status; }
    assert.equal(saiu, 3, `"${rota}" não foi recusada com saída 3`);
  }
});

// Comentário NÃO é código: a primeira versão deste teste reprovou o arquivo
// certo porque casou com a linha que DIZ "não chama /api/*". É o gotcha #14 —
// o grep que casa com o comentário que cita a coisa. Aqui os comentários saem
// antes de olhar, e a função tem contraprova logo abaixo.
const semComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

test('diag-replay: não fala com a rede — o estado vem do arquivo', () => {
  // Se ele chamasse `/api/*`, deixaria de reproduzir o arquivo e passaria a
  // medir a fila de HOJE — que é outra coisa, e sem aviso.
  const codigo = semComentarios(REPLAY);
  assert.ok(!/['"`]\/api\//.test(codigo) && !/api\/(perfil|buscar-places|marcar-lido)/.test(codigo),
    'o replay começou a chamar /api/ — ele deixaria de reproduzir o arquivo');
  assert.match(REPLAY, /serviceWorkers: 'block'/, 'o replay parou de bloquear o service worker');

  // CONTRAPROVA do instrumento: um fonte que REALMENTE chama tem que reprovar,
  // e um que só cita em comentário tem que passar. Sem isto o teste volta a ser
  // decoração — foi assim que ele nasceu.
  const chama = `await fetch('/api/perfil')`;
  const soCita = `// nunca chamamos /api/perfil aqui`;
  assert.ok(/['"`]\/api\//.test(semComentarios(chama)), 'o instrumento não enxerga uma chamada de verdade');
  assert.ok(!/['"`]\/api\//.test(semComentarios(soCita)), 'o instrumento ainda casa com comentário');
});

test('diag-replay: silencia a primeira execução antes da carga', () => {
  // O modal "Como funciona" cobre o card INTEIRO no Fold, e aí toda medição
  // mede o modal. Custou uma rodada de mockups descobrir.
  const iInit = REPLAY.indexOf('addInitScript');
  const iGoto = REPLAY.indexOf('page.goto(');
  assert.ok(iInit > 0 && iGoto > iInit, 'as preferências deixaram de entrar ANTES da carga');
  assert.match(REPLAY, /comoFuncionaVisto: true/, 'o replay parou de silenciar a primeira execução');
});

test('diagnóstico: currentPlace vai como ÍNDICE, não duplicado', () => {
  // `currentPlace` É `queue[0]`, então serializar os dois marcava um deles como
  // "[circular]" — e o perdido era sempre o card que a pessoa estava VENDO.
  assert.match(APP, /fora\.currentPlaceIdx = idx/, 'o índice sumiu do diagnóstico');
  assert.match(APP, /delete copia\.currentPlace/, 'o currentPlace voltou a ser duplicado no diagnóstico');
  // E o replay tem que continuar entendendo o formato ANTIGO, que já está no
  // aparelho dos editores.
  assert.match(REPLAY, /'\[circular\]'/, 'o replay parou de remendar os arquivos do formato antigo');
});
