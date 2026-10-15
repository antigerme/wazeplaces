// O fonte do repositório não leva caractere INVISÍVEL cru: isolamento bidi, espaço de largura zero, hífen suave,
// BOM no meio do arquivo, separador de linha, "Braille em branco", marcas de etiqueta. Quem precisa de um deles
// escreve o escape (barra, `u` e quatro algarismos) e o código fica legível, revisável e imune ao que um editor,
// um diff ou uma ferramenta faz com o que não aparece.
//
// Três motivos, os três já vistos aqui:
//   1. É o ataque "Trojan Source" (CVE-2021-42574): controles bidi (U+202A–U+202E, U+2066–U+2069) numa linha de
//      código invertem a ordem em que ela É LIDA sem mudar o que ela FAZ. O app lida com nome em hebraico e árabe
//      o tempo todo (o isolamento do nome no Resumo e na conversa), então esses controles aparecem no código por
//      motivo legítimo — e é aí que um escondido passaria.
//   2. No lote 25, a camada que entrega o texto das ferramentas de escrita trocou um escape DIGITADO pelo caractere
//      de verdade, em silêncio, em 12 linhas (um U+FEFF no fim de uma faixa de regex em `js/app.js` e os
//      isolamentos de nove asserções de teste). Funcionava, mas ninguém via o que estava ali, e um U+2028 digitado
//      num `node -e` terminou a linha do literal no meio.
//   3. Um diff que "não muda nada" visível é revisado como "não muda nada".
//
// `js/min/` fica de fora: o esbuild escreve com `--charset=utf8` e imprime os caracteres de formato do fonte (já
// limpo) crus nas strings. O que vale é o fonte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const RASTREADOS = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8' }).split('\0').filter(Boolean);

const TEXTO = /\.(js|mjs|cjs|css|html|json|md|txt|yml|yaml|svg|webmanifest|toml|jsonc|sh|py)$|^(LICENSE|\.gitignore|\.assetsignore|_headers)$/;
const GERADO = /^js\/min\//;

// `\p{Cf}` é a categoria dos caracteres de FORMATO (bidi, largura zero, hífen suave, BOM, tags, joiner…); os
// extras são os separadores e os "brancos" que nenhuma categoria cobre. Montado por código: o arquivo que
// proíbe o caractere não pode carregar o caractere.
const EXTRAS = [0x2028, 0x2029, 0x2800, 0x3164, 0xffa0, 0x115f, 0x1160, 0x034f];
const INVISIVEL = new RegExp('[\\p{Cf}' + EXTRAS.map((c) => String.fromCodePoint(c)).join('') + ']', 'u');

function codigo(c) {
  return 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
}

// [{ linha, codigos }] — as linhas de um texto que levam ao menos um caractere invisível.
function invisiveisEm(texto) {
  const achados = [];
  texto.split('\n').forEach((l, i) => {
    const cs = [...l].filter((c) => INVISIVEL.test(c));
    if (cs.length) achados.push({ linha: i + 1, codigos: [...new Set(cs.map(codigo))] });
  });
  return achados;
}

test('nenhum arquivo do fonte leva caractere invisível cru (escreva o escape)', () => {
  const sujos = [];
  for (const f of RASTREADOS) {
    if (!TEXTO.test(f) || GERADO.test(f)) continue;
    let texto;
    try { texto = readFileSync(join(RAIZ, f), 'utf8'); } catch { continue; }
    for (const a of invisiveisEm(texto)) sujos.push(`${f}:${a.linha} ${a.codigos.join(',')}`);
  }
  assert.deepEqual(sujos, [], 'caractere invisível cru no fonte — troque pelo escape (barra, u e quatro algarismos)');
});

test('CONTROLE: o varredor enxerga cada família de caractere invisível e deixa o texto comum em paz', () => {
  const invisiveis = {
    'isolamento bidi (FSI)': 0x2068,
    'isolamento bidi (PDI)': 0x2069,
    'embutimento bidi (RLO)': 0x202e,
    'marca direcional (RLM)': 0x200f,
    'largura zero (ZWSP)': 0x200b,
    'joiner de largura zero': 0x200d,
    'hífen suave': 0x00ad,
    'BOM no meio': 0xfeff,
    'separador de linha': 0x2028,
    'Braille em branco': 0x2800,
    'caractere de etiqueta': 0xe0041,
  };
  for (const [nome, cp] of Object.entries(invisiveis)) {
    const linha = 'const x = "a' + String.fromCodePoint(cp) + 'b";';
    // O separador de linha parte a linha em duas no `split('\n')`? Não: só o '\n' parte. A linha continua uma.
    const achados = invisiveisEm(linha);
    assert.equal(achados.length, 1, `${nome} (${codigo(String.fromCodePoint(cp))}) passou sem ser visto`);
    assert.deepEqual(achados[0].codigos, [codigo(String.fromCodePoint(cp))]);
  }
  // O que NÃO é invisível: acento, hebraico, árabe, emoji (e o seletor de variação do emoji, que é Mn), pontuação.
  const comum = [
    'Não há de quê — ação, coração, ñ, ü',
    'דני כהן · مرحبا · 日本語',
    String.fromCodePoint(0x1f4cd) + ' ' + String.fromCodePoint(0x2764, 0xfe0f) + ' ok',
    '"aspas" \'simples\' – – … ·',
  ];
  for (const t of comum) assert.deepEqual(invisiveisEm(t), [], `texto comum acusado: ${t}`);
  // A linha certa é a acusada, e a contagem vale por LINHA (não por caractere).
  const dois = invisiveisEm(['limpa', 'suja ' + String.fromCodePoint(0x2068) + String.fromCodePoint(0x2069), 'limpa'].join('\n'));
  assert.deepEqual(dois, [{ linha: 2, codigos: ['U+2068', 'U+2069'] }]);
});

test('CONTROLE: o guard varre o repositório de verdade (se a lista viesse vazia ele passaria vazio)', () => {
  const varridos = RASTREADOS.filter((f) => TEXTO.test(f) && !GERADO.test(f));
  assert.ok(varridos.length > 150, `só ${varridos.length} arquivos varridos`);
  for (const f of ['js/app.js', 'server/core.mjs', 'css/styles.css', 'index.src.html', 'CLAUDE.md', 'tools/smoke-browser.mjs']) {
    assert.ok(varridos.includes(f), `${f} ficou fora da varredura`);
  }
  assert.ok(!varridos.some((f) => GERADO.test(f)), 'js/min/ entrou na varredura');
  assert.ok(RASTREADOS.some((f) => GERADO.test(f)), 'o js/min/ sumiu do git: a exceção virou morta');
});
