// ═══════════════════════════════════════════════════════════════════════════
//  Gera js/min/*.js — o JavaScript que o index.html realmente carrega
// ═══════════════════════════════════════════════════════════════════════════
//
//   node tools/gerar-js.mjs      (é o que `npm run js` roda)
//
// MESMO padrão do `tools/gerar-css.mjs`, e pelo mesmo motivo. Este projeto
// documenta decisões em comentário junto do código — é uma virtude, e ela tem
// um preço que foi MEDIDO:
//
//     js/app.js       108 KB gzip  →  48 KB sem comentário   (-56%)
//     js/presenca.js   12 KB       →   5 KB                  (-60%)
//     js/mapa.js        5 KB       →   2 KB                  (-65%)
//     TOTAL            184 KB      → 103 KB                  (-44%)
//
// Num celular em 3G o `app.js` sozinho levava 3,2s pra chegar. Os comentários
// continuam TODOS no fonte, que é o que se edita e o que os testes fatiam —
// somem só da saída, exatamente como já acontece com o CSS.
//
// Por que POR ARQUIVO e não um bundle único: a ordem de carga do index.html é
// contrato (version → i18n → api → mapa → swipe → app → presenca), o service
// worker lista os arquivos um a um, e o `qr.js` é carregado SOB DEMANDA pelo
// `carregarQr()`. Um bundle mudaria as três coisas de uma vez, sem ganho de
// tamanho — o custo aqui é byte, não número de requisições (HTTP/2 multiplexa).
//
// A saída é COMMITADA: quem só roda a app não precisa de `npm install`, que é
// valor explícito do projeto. O CI cobra que ela esteja em dia.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEM = join(RAIZ, 'js');
const DESTINO = join(ORIGEM, 'min');
const ESBUILD = 'esbuild@0.28.2';   // fixo: minificador que muda sozinho muda a saída

mkdirSync(DESTINO, { recursive: true });

const fontes = readdirSync(ORIGEM).filter((f) => f.endsWith('.js')).sort();
let cru = 0, min = 0;

for (const arquivo of fontes) {
  const entrada = join(ORIGEM, arquivo);
  const saida = join(DESTINO, arquivo);
  const r = spawnSync('npx', ['--yes', ESBUILD, entrada, '--minify', '--target=es2020',
    '--charset=utf8', '--outfile=' + saida, '--allow-overwrite'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    console.error(`✗ falhou em ${arquivo}:\n${r.stderr?.toString() || '(sem stderr)'}`);
    process.exit(1);
  }
  // O minificador não pode ter produzido lixo: o `node --check` é barato e
  // pega o caso em que a saída existe mas não parseia.
  const c = spawnSync(process.execPath, ['--check', saida], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (c.status !== 0) {
    console.error(`✗ a saída de ${arquivo} não parseia:\n${c.stderr?.toString()}`);
    process.exit(1);
  }
  cru += readFileSync(entrada).length;
  min += readFileSync(saida).length;
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`✓ js/min/: ${fontes.length} arquivos · ${kb(cru)} → ${kb(min)}`
  + ` (-${Math.round(100 * (cru - min) / cru)}%)`);
