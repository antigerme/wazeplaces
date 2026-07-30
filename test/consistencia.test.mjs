// Auditoria de consistência — a terceira regra de ouro do CLAUDE.md.
//
// Inconsistência não quebra teste nem aparece no console: aparece como o editor
// hesitando, digitando errado e achando que ele é que errou. O caso que originou
// este arquivo: o pareamento MOSTRAVA `6C4-97S` e o campo PEDIA `ABC123`. Só não
// travava por duas coincidências — o `maxlength` estava em 7 (dimensionado pro
// hífen, sem ninguém dizer isso) e o servidor limpava não-alfanuméricos. Bastava
// alguém "corrigir" o maxlength pra 6 e o fluxo morria no 7º caractere.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// Quantas línguas o dicionário tem, DERIVADO do arquivo — nunca o literal 3. As
// contagens cravadas reprovaram todas de uma vez quando o francês entrou, e a
// mensagem ainda dizia "nas três línguas" com quatro no dicionário. Derivando,
// a 5ª língua não faz ninguém voltar aqui.
const LANGS_DO_DICT = [...read('js/i18n.js').matchAll(/^  ([a-z]{2}): \{$/gm)].map((m) => m[1]);
const N_LINGUAS = LANGS_DO_DICT.length;


const HTML = read('index.html');
const APP = read('js/app.js');
const I18N = read('js/i18n.js');

test('código de pareamento: quem mostra e quem lê usam a MESMA formatação', () => {
  assert.match(APP, /function formatarCodigoPareamento/, 'sumiu a fonte única de formato do código');

  // Exibição: o modal que mostra o código não pode formatar por conta própria.
  const abrir = APP.match(/async function abrirPareamento\(\)[\s\S]*?\n\}/);
  assert.ok(abrir, 'sumiu o abrirPareamento()');
  assert.match(abrir[0], /formatarCodigoPareamento\(/, 'a tela que MOSTRA o código voltou a formatar sozinha');
  assert.doesNotMatch(
    abrir[0],
    /\.slice\(0,\s*3\)\s*\+\s*'-'/,
    'formatação do código duplicada no abrirPareamento — use formatarCodigoPareamento()'
  );

  // Entrada: o campo aplica a mesma função enquanto se digita.
  assert.match(
    APP,
    /pairCodeInput'\)\?\.addEventListener\('input'[\s\S]{0,600}formatarCodigoPareamento\(/,
    'o campo do código parou de assumir o formato que a tela mostra'
  );
});

test('código de pareamento: o placeholder mostra o mesmo formato que a tela', () => {
  // Se a tela mostra XXX-XXX, o campo tem que sugerir XXX-XXX. Sugerir sem o
  // separador faz quem copia da tela hesitar — ou digitar errado.
  const chaves = [...I18N.matchAll(/'pair\.enter\.placeholder':\s*'([^']*)'/g)].map((m) => m[1]);
  assert.equal(chaves.length, N_LINGUAS, `placeholder do código precisa existir nas ${N_LINGUAS} línguas`);
  for (const v of chaves) {
    assert.match(v, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/, `placeholder "${v}" não segue o formato XXX-XXX mostrado na tela`);
  }
  // maxlength = 6 caracteres + o separador. Apertar pra 6 trava quem colou da tela.
  const campo = HTML.split('\n').find((l) => l.includes('id="pairCodeInput"'));
  assert.ok(campo, 'sumiu o #pairCodeInput');
  const max = (campo.match(/maxlength="(\d+)"/) || [])[1];
  assert.equal(max, '7', 'maxlength precisa caber os 6 caracteres MAIS o separador que a tela mostra');
});

test('um conceito, um nome: sem sinônimos concorrentes na mesma língua', () => {
  // Deriva de terminologia é a inconsistência mais fácil de introduzir: basta
  // escrever uma tela nova sem reler as antigas.
  const blocos = {};
  for (const lang of LANGS_DO_DICT) {
    const m = I18N.match(new RegExp(`\\n  ${lang}: \\{([\\s\\S]*?)\\n  \\},?\\n`));
    if (m) blocos[lang] = m[1].toLowerCase();
  }
  // Pares já padronizados. "editor" × "usuário" NÃO entra: são pessoas
  // diferentes (quem tria no WME × quem enviou o pedido).
  const PROIBIDOS = {
    pt: [['aparelho', 'dispositivo'], ['celular', 'telefone']],
    es: [['dispositivo', 'aparato']],
    // "appareil" é o termo da app; "dispositif" em francês soa a dispositivo
    // médico/jurídico e é o sinônimo que uma tradução nova traria sem pensar.
    fr: [['appareil', 'dispositif'], ['téléphone', 'portable']],
  };
  for (const [lang, pares] of Object.entries(PROIBIDOS)) {
    const txt = blocos[lang] || '';
    for (const [padrao, sinonimo] of pares) {
      if (!txt.includes(padrao)) continue;
      assert.ok(
        !txt.includes(sinonimo),
        `${lang}: "${padrao}" e "${sinonimo}" convivem no dicionário — o mesmo conceito com dois nomes`
      );
    }
  }
});

test('botão de confirmar ecoa o verbo do enunciado', () => {
  // "Marcar como lido os N pedidos?" com botão "Marcar lidos" faz o editor
  // parar pra conferir se é a mesma ação. É.
  for (const [lang, corpo, botao] of [
    ['pt', 'marcar como lido', 'marcar como lidos'],
    ['en', 'as read', 'mark as read'],
    ['es', 'marcar como leída', 'marcar como leídos'],
    ['fr', 'marquer comme lue', 'marquer comme lues'],
  ]) {
    const m = I18N.match(new RegExp(`\\n  ${lang}: \\{([\\s\\S]*?)\\n  \\},?\\n`));
    const txt = (m ? m[1] : '').toLowerCase();
    const conf = txt.match(/'modal\.batchread\.confirm':\s*'([^']*)'/);
    assert.ok(conf, `${lang}: sumiu o modal.batchRead.confirm`);
    assert.equal(conf[1], botao, `${lang}: o botão de confirmar não ecoa mais o enunciado ("${corpo}")`);
  }
});

test('o mesmo conceito não pode ter dois nomes no MESMO card', () => {
  const APP = read('js/app.js');
  const DICT = read('js/i18n.js');

  // O owner reverteu a tradução de categoria porque o Waze REGIONALIZA
  // categoria por país. O revert pegou o topo do card e ESQUECEU o diff: o
  // mesmo `NATURAL_FEATURES` aparecia cru em cima e "Natural features" na
  // lista de mudanças, na mesma tela. Ele viu num print antes de qualquer
  // teste — segunda vez que isso acontece com categoria.
  assert.match(APP, /place\.categories\.join\(', '\)/,
    'a categoria do topo do card deixou de sair crua');

  // Tira os comentários antes de olhar: a primeira versão deste guard reprovou
  // a correção porque o comentário que EXPLICA a remoção cita o nome da função
  // removida. Guard tem que ler código, não prosa.
  const semComentario = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const fn = semComentario(APP.match(/function valorDeLista\(v\)[\s\S]*?\n\}/)[0]);
  assert.doesNotMatch(fn, /rotuloDeEnum\s*\(/,
    'item de lista voltou a passar por rotuloDeEnum — humaniza a categoria de novo');
  assert.match(fn, /return String\(v\);/, 'item de lista deixou de sair cru');

  // `card.enum.` era um mecanismo de tradução com dicionário VAZIO: nunca teve
  // uma chave, então tudo caía no humanizarEnum (lowercase). Isso não só
  // humanizava a categoria como CORROMPIA valor que não é enum — `aliases` é
  // nome próprio ("Escola Estadual…" → "Escola estadual…") e
  // `externalProviderIDs` é ID opaco do Google (`ChIJfYn3…` → `Chijfyn3…`,
  // deixa de ser o ID). Se alguém repovoar esse prefixo, é sinal de que a
  // decisão mudou e este teste tem que ser revisitado junto.
  assert.equal((DICT.match(/'card\.enum\./g) || []).length, 0,
    'voltaram chaves card.enum.* — a tradução de categoria foi revertida de propósito');

  // O humanizarEnum continua válido onde há dicionário DE VERDADE: lá ele é
  // fallback de enum não mapeado, não a regra.
  for (const [prefixo, minimo] of [['card.updateType.', 4], ['card.flagType.', 4], ['card.field.', 4]]) {
    const n = (DICT.match(new RegExp("'" + prefixo.replace(/\./g, '\\.'), 'g')) || []).length;
    assert.ok(n >= minimo, `${prefixo} ficou sem tradução (${n} chaves) — aí humanizar vira a regra`);
  }
});
