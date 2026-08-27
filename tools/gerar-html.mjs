// ═══════════════════════════════════════════════════════════════════════════
//  Gera index.min.html — o HTML que o navegador realmente recebe
// ═══════════════════════════════════════════════════════════════════════════
//
//   node tools/gerar-html.mjs      (é o que `npm run html` roda)
//
// Terceiro irmão do `gerar-css.mjs` e do `gerar-js.mjs`, pelo mesmo motivo: o
// projeto documenta decisões em comentário junto do código, e no index.html
// isso custava 42% do arquivo COMPRIMIDO. MEDIDO num 3G com CPU 4x lenta:
//
//                     fonte      minificado
//     tamanho         36 KB gz   20 KB gz   (-45%)
//     HTML pronto     1598 ms    1199 ms
//     FCP             2036 ms    1648 ms    (-388 ms)
//     load            4543 ms    3540 ms    (-1 s)
//
// O FCP é o ganho que importa: o CSS bloqueia o primeiro paint e só começa a
// baixar quando o parser o encontra — com menos HTML na frente, ele chega antes.
// (O CLS não muda: aquele deslocamento é o applyI18n trocando os textos, e não
// tem relação com o tamanho do HTML. Medido: 0,0053 e 0,0766 nos dois casos.)
//
// ── POR QUE UM ARQUIVO NOVO, E NÃO SOBRESCREVER O index.html ──────────────
// Porque 5 arquivos de teste LEEM o index.html, e vários casam linha a linha
// (`HTML.split('\n').find(...)`). Minificar por cima quebraria 22 asserções só
// no layout.test.mjs, e pior: elas passariam a medir o artefato em vez do
// fonte. O fonte continua sendo o que se edita, o que os testes leem e o que o
// Tailwind varre; os adaptadores é que servem o gerado na raiz.
//
// ── O HASH DA CSP É INTOCÁVEL ────────────────────────────────────────────
// O `<script>` inline do tema é autorizado por hash, em TRÊS cópias da CSP
// (index.html, _headers, server/node.mjs — ver gotcha #14). Um único byte a
// mais no script muda o hash e o navegador BLOQUEIA o script em silêncio: a app
// abre no esquema de cor errado e nada quebra a ponto de alguém notar.
// Por isso o `--ignore-custom-fragments` preserva o bloco inteiro byte a byte,
// e por isso este gerador CONFERE o hash no fim, antes de escrever.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTE = join(RAIZ, 'index.html');
const SAIDA = join(RAIZ, 'index.min.html');
const MINIFICADOR = 'html-minifier-terser@7.2.0';   // fixo: versão que muda, saída que muda

const hashDoInline = (html) => {
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  return m ? createHash('sha256').update(m[1], 'utf8').digest('base64') : null;
};

const r = spawnSync('npx', ['--yes', MINIFICADOR,
  '--remove-comments',
  '--collapse-whitespace',
  // `conservative` mantém UM espaço onde havia espaço: sem ele, `<b>a</b> <i>b</i>`
  // vira `<b>a</b><i>b</i>` e as palavras colam na tela.
  '--conservative-collapse',
  // O bloco inline inteiro sai intocado — ver a nota do hash acima.
  '--ignore-custom-fragments', '<script>[\\s\\S]*?</script>',
  '-o', SAIDA, FONTE], { stdio: ['ignore', 'ignore', 'pipe'] });
if (r.status !== 0) {
  console.error(`✗ minificação falhou:\n${r.stderr?.toString() || '(sem stderr)'}`);
  process.exit(1);
}

const fonte = readFileSync(FONTE, 'utf8');
const saida = readFileSync(SAIDA, 'utf8');

const hFonte = hashDoInline(fonte), hSaida = hashDoInline(saida);
if (!hFonte || hFonte !== hSaida) {
  console.error(`✗ o hash do script inline mudou (${hFonte} → ${hSaida}).`
    + '\n  A CSP bloquearia o script do tema EM SILÊNCIO. Saída descartada.');
  writeFileSync(SAIDA, fonte);   // deixa a saída válida em vez de quebrada
  process.exit(1);
}

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log(`✓ index.min.html: ${kb(fonte)} → ${kb(saida)}`
  + ` (-${Math.round(100 * (fonte.length - saida.length) / fonte.length)}%) · hash do inline preservado`);
