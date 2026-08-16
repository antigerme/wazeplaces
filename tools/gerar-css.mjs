// ═══════════════════════════════════════════════════════════════════════════
//  Gera css/app.css — o ÚNICO CSS que o index.html carrega
// ═══════════════════════════════════════════════════════════════════════════
//
//   node tools/gerar-css.mjs      (é o que `npm run css` roda)
//
// Duas coisas em uma:
//
// 1. UM ARQUIVO em vez de dois. Antes o HTML carregava `tailwind.css` e
//    `styles.css`, ambos bloqueando o render.
//
// 2. O `styles.css` passa a ser MINIFICADO, e é aqui que está o ganho grande —
//    maior do que eu supunha antes de medir. Ele é um arquivo fortemente
//    comentado (de propósito: as decisões moram junto das regras), e comentário
//    comprime bem mas não some. Medido:
//
//        styles.css hoje    65,8 KB cru → 23,4 KB gzip
//        minificado         19,0 KB cru →  5,3 KB gzip
//
//    ~18 KB a menos num recurso que BLOQUEIA o primeiro paint. Os comentários
//    continuam todos no `css/styles.css`, que é o arquivo que se edita — some
//    só da saída, exatamente como já acontecia com o Tailwind.
//
// ── A ORDEM É O CONTRATO ──────────────────────────────────────────────────
// Tailwind PRIMEIRO, styles DEPOIS. Utility do Tailwind é sempre (0,1,0), então
// seletor de uma classe nosso EMPATA — e empate é decidido pela ordem. Invertido,
// o nosso CSS perde em silêncio (gotcha #22/#27, que mordeu 6 vezes antes de
// alguém perceber). `test/layout.test.mjs` reprova se a ordem virar.
//
// Os DOIS fontes continuam existindo e editáveis:
//   css/tailwind.src.css  → as diretivas @tailwind
//   css/styles.css        → o CSS custom, com os comentários
// A saída `css/app.css` é GERADA e commitada (zero build pra quem só roda a
// app), e o CI reprova se estiver desatualizada.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'wp-css-'));
const SAIDA = join(RAIZ, 'css', 'app.css');

// Mesma versão cravada que o script antigo usava — Tailwind muda de saída entre
// minor releases, e o CI compara byte a byte.
const TAILWIND = 'tailwindcss@3.4.17';

function minificar(entrada, saida) {
  const r = spawnSync('npx', ['--yes', TAILWIND, '-c', join(RAIZ, 'tailwind.config.js'),
    '-i', join(RAIZ, entrada), '-o', saida, '--minify'], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    console.error(`✗ falhou ao processar ${entrada}\n${r.stderr}`);
    process.exit(1);
  }
  return readFileSync(saida, 'utf8').trim();
}

const tw = minificar('css/tailwind.src.css', join(TMP, 'tw.css'));
const st = minificar('css/styles.css', join(TMP, 'st.css'));
rmSync(TMP, { recursive: true, force: true });

// O cabeçalho existe pra quem abrir o arquivo no editor achando que edita aqui.
const cabecalho = '/* GERADO por tools/gerar-css.mjs (npm run css) — NÃO EDITE.\n'
  + '   Fontes: css/tailwind.src.css (primeiro) + css/styles.css (depois, vence o empate). */\n';
writeFileSync(SAIDA, cabecalho + tw + '\n' + st + '\n');

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log(`✓ css/app.css: ${kb(tw)} (tailwind) + ${kb(st)} (styles) = ${kb(cabecalho + tw + '\n' + st + '\n')}`);
