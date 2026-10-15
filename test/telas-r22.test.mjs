// A TELA na rodada 22 da auditoria (lote 26, área "telas"; relatório r22-7): o texto grande que ainda recortava.
//
//  R22-7-05 · o cabeçalho «Lidos / Rejeitados» do Histórico saía pela ESQUERDA da caixa que o recorta («Lidos» virava «idos»), «Entraînement
//             terminé» e «Se déconnecter ?» passavam do cartão e os interruptores dos Filtros e das Preferências saíam 4–14 px dele, porque o
//             texto ao lado não encolhia. A POSIÇÃO do cabeçalho é do dono; aqui só o recorte: ele quebra (`flex-wrap`, mantendo o `justify-end`)
//             e a palavra inteira que não cabe parte (`break-words`); com o texto normal nada muda, porque nada quebra.
//  R22-7-07 · em francês o «:» do botão do Resumo não começa linha (o NBSP está em `test/historico-r21.test.mjs`).
//
// O que só o navegador mede (a tinta fora da caixa, o primeiro caractere de cada linha) está no bloco 11 e 12 do `tools/smoke-browser.mjs`, com o CONTROLE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const classes = (tag) => (/class="([^"]*)"/.exec(tag) || [, ''])[1].split(/\s+/).filter(Boolean);

test('R22-7-05 · o cabeçalho «Lidos / Rejeitados» do Histórico quebra em vez de sair pela esquerda — e segue à direita', () => {
  const m = /<div class="([^"]*\bjustify-end\b[^"]*)">\s*<span class="([^"]*)" data-i18n="stats\.read">[^<]*<\/span>\s*<span class="([^"]*)" data-i18n="stats\.rejected">/.exec(HTML);
  assert.ok(m, 'o cabeçalho do Histórico mudou de forma (as duas colunas stats.read / stats.rejected dentro do .justify-end)');
  const cab = m[1].split(/\s+/);
  // `flex-wrap` sem tirar o `justify-end`: a posição (à direita, em cima dos números) é a de sempre — só ganha uma segunda linha quando não cabe.
  assert.ok(cab.includes('flex-wrap'), 'o cabeçalho perdeu o flex-wrap: sem ele as duas colunas saem pela esquerda do cartão (justify-end) com o texto grande');
  assert.ok(cab.includes('justify-end') && cab.includes('flex'), 'o cabeçalho deixou de ser flex justify-end: a posição é do dono, não do recorte');
  // O vão entre as duas linhas é pequeno (a de lado segue gap-3): `gap-3` valeria também na vertical.
  assert.ok(cab.includes('gap-x-3') && !cab.includes('gap-3'), 'o vão do cabeçalho: lado a lado 12 px (gap-x-3), e nunca 12 px entre as duas linhas');
  for (const [i, c] of [[2, 'Lidos'], [3, 'Rejeitados']]) {
    const cl = m[i].split(/\s+/);
    assert.ok(cl.includes('min-w-0') && cl.includes('break-words'), `a coluna «${c}» não parte a palavra que não cabe (min-w-0 break-words)`);
  }
});

test('R22-7-05 · o título do fim do treino e o do «Sair» partem a palavra que não cabe no cartão', () => {
  for (const id of ['treinoFimTitle', 'logoutModalTitle']) {
    const tag = new RegExp(`<h3 id="${id}"[^>]*>`).exec(HTML);
    assert.ok(tag, `${id}: sumiu o título`);
    assert.ok(classes(tag[0]).includes('break-words'), `${id}: o título perdeu o break-words (passava do cartão em 320 px a 1,8×, em francês)`);
  }
});

// R24-7-04 (lote 28): os outros três títulos de diálogo (eram 2 de 6) — «Cole o conteúdo dos cookies», «Conectar outro aparelho» e «Entrar com um código» passavam
// da borda do cartão com o texto grande (+20/+14/+9 px no Fold a 2×). `break-words` não muda nada a 1× (a palavra cabe). O `#resumoTitle` fica `truncate` de propósito:
// trocar por quebra mudaria, a 1×, três títulos do Galaxy Fold (pt «novembro», es «septiembre» e «noviembre» hoje terminam em reticências).
test('R24-7-04 · os títulos «Cole os cookies», «Conectar outro aparelho» e «Entrar com um código» partem a palavra que não cabe no cartão', () => {
  const ids = ['pasteModalTitle', 'pairShowTitle', 'pairEnterTitle'];
  for (const id of ids) {
    const tag = new RegExp(`<h3 id="${id}"[^>]*>`).exec(HTML);
    assert.ok(tag, `${id}: sumiu o título`);
    assert.ok(classes(tag[0]).includes('break-words'), `${id}: o título perdeu o break-words (passava do cartão a 280 px com o texto a 2×)`);
  }
});

test('R22-7-05 · o texto ao lado de CADA interruptor encolhe (min-w-0) e parte a palavra longa (break-words)', () => {
  const linhas = [...HTML.matchAll(/<label class="flex items-center justify-between gap-3 text-sm cursor-pointer min-h-\[44px\]">\s*<span( class="[^"]*")?[^>]*>/g)];
  // São sete: Filtros (2), Preferências (Desfazer, Pular, Presença, Offline) e o Modo Desenvolvedor.
  assert.equal(linhas.length, 7, `esperava 7 linhas de interruptor, achei ${linhas.length}: linha nova de interruptor entra aqui com o mesmo texto que encolhe`);
  for (const l of linhas) {
    const cl = classes(l[0].slice(l[0].indexOf('<span')));
    assert.ok(cl.includes('min-w-0') && cl.includes('break-words'), `um interruptor tem o texto que não encolhe (${l[0].replace(/\s+/g, ' ').slice(-80)}): o interruptor sai do cartão com o texto grande`);
  }
  // O interruptor em si segue sem encolher (ele é 44 px e o texto é que cede).
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(/input\.ui-switch\s*\{[^}]*\}/.exec(css)[0], /flex-shrink:\s*0/, 'o interruptor passou a encolher');
});

test('R22-7-05 CONTROLE: o instrumento enxerga o defeito (a linha do HTML de antes, sem as classes, é pega)', () => {
  const antes = '<label class="flex items-center justify-between gap-3 text-sm cursor-pointer min-h-[44px]">\n<span>\n';
  const l = /<label class="flex items-center justify-between gap-3 text-sm cursor-pointer min-h-\[44px\]">\s*<span( class="[^"]*")?[^>]*>/.exec(antes);
  assert.ok(l && !classes(l[0].slice(l[0].indexOf('<span'))).includes('min-w-0'), 'CONTROLE: o texto de antes devia ser pego');
});
