// O diagnóstico passou a sair EMPACOTADO (v2026.09.10-04). Este arquivo trava as
// duas pontas: o que a app escreve e o que as ferramentas leem.
//
// MEDIDO no diagnóstico real do owner antes de escrever uma linha: 2,61 MB →
// 532 KB (4,9×), em 529 ms com CPU 6× mais lenta. A compressão é do próprio
// navegador (`CompressionStream`), então não entrou dependência nenhuma.
//
// A ARMADILHA que este teste evita: eu escrevi o empacotador E o leitor. Um erro
// combinado nos dois passa num teste de ida e volta sem piscar. Por isso aqui
// tem DOIS oráculos independentes — o `zlib.crc32` do Node (outra
// implementação de CRC) e o `unzip` do sistema (outro programa inteiro).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 as crc32DoNode } from 'node:zlib';
import { lerDiagnostico } from '../tools/diag-ler.mjs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

// Fatia o empacotador do FONTE e executa. Reimplementar aqui mediria uma cópia
// que envelhece — mesmo padrão do anel de chamadas em test/diagnostico.test.mjs.
function montarZipar() {
  const i = APP.indexOf('const CRC_TAB = (() => {');
  const j = APP.indexOf('\nasync function baixarDiagnostico()');
  assert.ok(i !== -1 && j > i, 'as âncoras do empacotador sumiram — o corte precisa ser revisto');
  const trecho = APP.slice(i, j);
  return new Function(trecho + '\nreturn { zipar, crc32 };')();
}

const { zipar, crc32 } = montarZipar();

test('o CRC da app bate com uma implementação INDEPENDENTE', () => {
  // Oráculo: `zlib.crc32` do Node. Se os dois concordarem em entrada vazia, em
  // ASCII, em acento e em binário, a tabela está certa — e CRC errado é o erro
  // que faz o pacote abrir em UM programa e falhar em outro.
  const casos = ['', 'a', 'hello world', 'ação, ãçõ — çÇ',
                 String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i))];
  for (const s of casos) {
    const u8 = new TextEncoder().encode(s);
    assert.equal(crc32(u8), crc32DoNode(Buffer.from(u8)) >>> 0,
      `CRC divergiu em ${JSON.stringify(s.slice(0, 20))}`);
  }
});

test('ida e volta: o que a app empacota, a ferramenta abre', async () => {
  const original = { _leia_isto: 'aviso', appState: { queue: [{ venueID: 'x' }] }, n: 42 };
  const zip = await zipar([['diagnostico.json', JSON.stringify(original)], ['LEIA-ME.txt', 'aviso curto']]);
  const dir = mkdtempSync(join(tmpdir(), 'diagzip-'));
  const arq = join(dir, 'd.zip');
  writeFileSync(arq, Buffer.from(zip));
  const { dados, origem } = lerDiagnostico(arq);
  assert.equal(origem, 'zip', 'o leitor não reconheceu o pacote pelos bytes mágicos');
  assert.deepEqual(dados, original, 'o conteúdo não sobreviveu à ida e volta');
});

test('o `unzip` do sistema aceita — oráculo de FORA', () => {
  // Escritor e leitor são meus; este não é. É o que separa "consistente comigo
  // mesmo" de "é um ZIP". O arquivo vai pro celular do editor, e lá quem abre
  // não é o meu código.
  const grande = JSON.stringify({ x: 'repete '.repeat(5000), y: [1, 2, 3] });
  const dir = mkdtempSync(join(tmpdir(), 'diagzip-'));
  const arq = join(dir, 'd.zip');
  return zipar([['diagnostico.json', grande], ['LEIA-ME.txt', 'aviso']]).then((zip) => {
    writeFileSync(arq, Buffer.from(zip));
    const saida = execFileSync('unzip', ['-t', arq], { encoding: 'utf8' });
    assert.match(saida, /No errors detected/, 'o unzip recusou o pacote');
    // As DUAS entradas precisam estar lá: o LEIA-ME é o que mantém visível o
    // aviso de credencial viva, que comprimido sumiria de vista.
    const lista = execFileSync('unzip', ['-l', arq], { encoding: 'utf8' });
    assert.match(lista, /diagnostico\.json/, 'sumiu o diagnóstico de dentro do pacote');
    assert.match(lista, /LEIA-ME\.txt/, 'sumiu o LEIA-ME: o aviso de credencial viva fica invisível');
    // E comprimir precisa COMPRIMIR: 35 KB de texto repetido que saem com 35 KB
    // significam que o `deflate-raw` não rodou e ninguém percebeu.
    assert.ok(zip.length < grande.length / 3,
      `o pacote não comprimiu (${zip.length} de ${grande.length} bytes)`);
  });
});

test('o BOTÃO empacota as duas entradas — e com os nomes certos', () => {
    // Esta asserção nasceu porque a anterior era DECORAÇÃO: o teste de ida e
    // volta monta a própria lista de entradas, então ele prova o `zipar` e não
    // quem o chama. Sabotado, renomear a entrada dentro do `baixarDiagnostico`
    // passava limpo — provar que uma função existe não é provar que ela é
    // chamada com o que interessa.
    const i = APP.indexOf('async function baixarDiagnostico(');
    assert.ok(i !== -1, 'baixarDiagnostico sumiu');
    const corpo = APP.slice(i, APP.indexOf('\n}\n', i)).replace(/\/\/[^\n]*/g, '');
    assert.match(corpo, /zipar\(\[/, 'o botão parou de empacotar');
    assert.match(corpo, /\['diagnostico\.json', json\]/,
      'o diagnóstico saiu do pacote, ou trocou de nome — as ferramentas o procuram por ele');
    assert.match(corpo, /\['LEIA-ME\.txt', t\('diag\.leiame'/,
      'sumiu o LEIA-ME: comprimido, o aviso de CREDENCIAL VIVA fica invisível até extrair');
    assert.match(corpo, /\.zip'/, 'o arquivo baixado deixou de ser .zip');
    // E o caminho de queda continua existindo, senão o aparelho sem
    // CompressionStream não baixa NADA — que é pior que baixar grande.
    assert.match(corpo, /typeof CompressionStream === 'function'/,
      'sumiu o teste de suporte: aparelho antigo fica sem diagnóstico nenhum');
    assert.match(corpo, /\.json'/, 'sumiu a queda pro .json cru');
});

test('sem CompressionStream o pacote AINDA é válido', async () => {
  // iOS < 16.4 não tem. O instrumento de socorro não pode ter pré-requisito:
  // ele falta justamente no aparelho estranho, que é onde se precisa dele.
  const salvo = globalThis.CompressionStream;
  delete globalThis.CompressionStream;
  try {
    const zip = await zipar([['diagnostico.json', '{"a":1}'], ['LEIA-ME.txt', 'x']]);
    const dir = mkdtempSync(join(tmpdir(), 'diagzip-'));
    const arq = join(dir, 'd.zip');
    writeFileSync(arq, Buffer.from(zip));
    assert.match(execFileSync('unzip', ['-t', arq], { encoding: 'utf8' }), /No errors detected/,
      'sem compressão o pacote deixou de ser um ZIP válido');
    assert.deepEqual(lerDiagnostico(arq).dados, { a: 1 });
  } finally { globalThis.CompressionStream = salvo; }
});

test('o `.json` cru de ANTES continua abrindo', () => {
  // Os relatos antigos são justamente os que se usa pra comparar "antes e
  // depois". Uma ferramenta que só lê o formato de hoje perde essa comparação.
  const dir = mkdtempSync(join(tmpdir(), 'diagzip-'));
  const arq = join(dir, 'velho.json');
  writeFileSync(arq, JSON.stringify({ _formato: 2, appState: {} }));
  const { dados, origem } = lerDiagnostico(arq);
  assert.equal(origem, 'json');
  assert.equal(dados._formato, 2);
});

test('as três ferramentas leem pela FONTE ÚNICA', () => {
  // Sem isto, uma delas fica lendo `JSON.parse(readFileSync(...))` e passa a
  // recusar o formato novo — calada, e só no dia do socorro.
  for (const f of ['diag-tela.mjs', 'diag-replay.mjs', 'diag-api.mjs']) {
    const src = readFileSync(new URL('../tools/' + f, import.meta.url), 'utf8');
    const semCom = src.replace(/\/\/[^\n]*/g, '');
    assert.match(semCom, /lerDiagnostico\(/, `${f} parou de usar a fonte única de leitura`);
    assert.ok(!/JSON\.parse\(readFileSync\(/.test(semCom),
      `${f} voltou a ler o arquivo cru — recusa o .zip sem avisar`);
  }
});
