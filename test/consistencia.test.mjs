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
  const fn = semComentario(APP.match(/function valorDeLista\([^)]*\)[\s\S]*?\n\}/)[0]);
  assert.doesNotMatch(fn, /rotuloDeEnum\s*\(/,
    'item de lista voltou a passar por rotuloDeEnum — humaniza a categoria de novo');
  assert.match(fn, /return String\(v\);/, 'item de lista deixou de sair cru');

  // UMA exceção, e ela é por CAMPO — nunca genérica. Traduzir tudo foi
  // exatamente o que corrompeu apelido (nome próprio) e ID do Google. Serviço
  // é comodidade genérica e tem dicionário oficial do Waze; categoria NÃO
  // entra, porque o Waze a regionaliza por país.
  assert.match(fn, /if \(campo === 'services'\)/,
    'a tradução de serviço deixou de ser escopada por campo');
  assert.doesNotMatch(fn, /campo === 'categories'/,
    'categoria voltou a ser traduzida — o Waze regionaliza por país (gotcha #39)');
  assert.doesNotMatch(fn, /campo === 'aliases'|campo === 'externalProviderIDs'/,
    'apelido ou ID do Google entraram na tradução — não são enum');

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

test('origem do pedido: os 4 valores do Waze traduzidos, e o 5º descartado', () => {
  const DICT = read('js/i18n.js');
  const CORE = read('server/core.mjs');

  // Os valores saíram do bundle do WME (v2.361, HAR do owner), não de palpite:
  //   J = { SOURCE_UNSPECIFIED: Symbol("UNMAPPED_UPDATE_REQUEST_SOURCE"),
  //         MOBILE_CLIENT: REPORT_MENU, WEB: LIVE_MAP,
  //         MOBILE_WEB: HELP_AND_FEEDBACK, REPORTING_AGENT: REPORTING_AGENT }
  // A app conhecia só os DOIS que aparecem na fila do owner hoje (medido: 369
  // URs, MOBILE_CLIENT e WEB apenas). Os outros dois existem — e o featureFlag
  // URSourceReportingAgent está LIGADO no ambiente dele —, então cairiam no
  // humanizarEnum e sairiam como "Mobile web" / "Reporting agent" em inglês no
  // meio de uma interface em português. É a regra de i18n do projeto sendo
  // furada por um enum que ninguém tinha visto ainda.
  for (const enumv of ['MOBILE_CLIENT', 'WEB', 'MOBILE_WEB', 'REPORTING_AGENT']) {
    const selo = (DICT.match(new RegExp(`'card\\.source\\.${enumv}':`, 'g')) || []).length;
    assert.equal(selo, N_LINGUAS,
      `card.source.${enumv} está em ${selo} línguas de ${N_LINGUAS} — sai em inglês nas que faltam`);
    const dica = (DICT.match(new RegExp(`'card\\.source\\.${enumv}\\.title':`, 'g')) || []).length;
    assert.equal(dica, N_LINGUAS,
      `card.source.${enumv}.title está em ${dica} línguas de ${N_LINGUAS}`);
  }

  // SOURCE_UNSPECIFIED não vira selo: o próprio WME não o exibe, e "Source
  // unspecified" não informa nada. Quem descarta é o core, pra o frontend não
  // precisar saber do caso.
  assert.match(CORE, /sourceCru !== 'SOURCE_UNSPECIFIED'/,
    'o core voltou a emitir SOURCE_UNSPECIFIED — vira selo dizendo nada, em inglês');
});

test('tipos de pedido: HTML, código e dicionário contam a MESMA lista', () => {
  const HTMLs = read('index.html');
  const APP = read('js/app.js');
  const DICT = read('js/i18n.js');

  // A ordem importa e é a mesma nos dois lugares de propósito: duas listas com
  // a mesma ideia em ordens diferentes é como o editor descobre que a app se
  // contradiz. Aqui não é estética — o `TYPES_ALL` é o padrão marcado, e o HTML
  // é o que ele vê; divergir faz "todos marcados" parecer uma seleção parcial.
  const noHtml = [...HTMLs.matchAll(/class="filter-type[^"]*"\s+value="([A-Z_]+)"/g)].map((m) => m[1]);
  const noCodigo = APP.match(/const TYPES_ALL = \[([\s\S]*?)\];/)[1]
    .match(/'([A-Z_]+)'/g).map((s) => s.replace(/'/g, ''));

  assert.equal(noHtml.length, 7, `o filtro tem ${noHtml.length} caixas — o WME tem 7 tipos`);
  assert.deepEqual(noHtml, noCodigo,
    'a lista de tipos do HTML e a do TYPES_ALL divergiram (valor ou ORDEM)');

  // Toda caixa tem rótulo em TODAS as línguas. Sem isto, o tipo aparece com a
  // chave crua no lugar do nome — e só na língua que ninguém testou.
  for (const t of noHtml) {
    const n = (DICT.match(new RegExp(`'filters\\.types\\.${t}':`, 'g')) || []).length;
    assert.equal(n, N_LINGUAS,
      `filters.types.${t} está em ${n} línguas de ${N_LINGUAS}`);
  }

  // O vocabulário ANTIGO (3 tipos grossos) não pode voltar por descuido: um
  // `value="REQUEST"` sobrando casaria com zero pedidos e viraria caixa morta.
  for (const velho of ['VENUE', 'IMAGE', 'REQUEST']) {
    assert.ok(!noHtml.includes(velho),
      `o tipo antigo ${velho} voltou ao filtro — ele não classifica mais nada`);
  }

  // ── quais nascem MARCADOS ──────────────────────────────────────────────
  // A instalação nova é decidida em DOIS lugares: o `checked` do HTML (o que a
  // pessoa VÊ ao abrir Filtros) e o TYPES_PADRAO (o que a app USA na primeira
  // busca). Divergir é silencioso e cruel nos dois sentidos: caixa marcada com
  // tipo que não vem faz parecer que a fila acabou; caixa desmarcada com tipo
  // que vem faz o filtro parecer quebrado. Nenhum dos dois dá erro na tela.
  const marcadosHtml = [...HTMLs.matchAll(/class="filter-type[^"]*"\s+value="([A-Z_]+)"\s+checked/g)]
    .map((m) => m[1]);
  // AVALIA as duas constantes em vez de parsear a expressão. A primeira versão
  // deste guard casava `TYPES_ALL.filter((t) => …)` com regex e, quando troquei
  // a forma pra `TYPES_ALL.slice()` de propósito pra testar, ele reprovou com
  // "Cannot read properties of null" — pegava a regressão, mas dizia nada.
  // Guard acoplado à FORMA do código é o erro que já mordeu este projeto em
  // `valorDeLista`, `derrubarSessao` e `avaliar`. Avaliando, qualquer forma
  // válida passa e o que se compara é o VALOR, que é o que importa.
  const decl = (nome) => {
    const m = APP.match(new RegExp(`const ${nome} = ([\\s\\S]*?);\\n`));
    assert.ok(m, `${nome} sumiu de js/app.js`);
    return m[1];
  };
  const padraoCodigo = new Function(
    `const TYPES_ALL = ${decl('TYPES_ALL')}; return ${decl('TYPES_PADRAO')};`)();
  assert.deepEqual(marcadosHtml, padraoCodigo,
    'o que nasce marcado no HTML e o TYPES_PADRAO divergiram');

  // `DETAILS_UPDATE` e `FLAGGED_PLACE` nascem DESMARCADOS, e o motivo é de
  // PRODUTO: a app é estilo Tinder, e o gesto rápido funciona quando há o que
  // olhar. Medido na fila real: os 5 tipos do padrão somam 178 cards com 66% de
  // foto, contra 117 cards e 44% nos dois de fora.
  //
  // Eles JÁ estiveram desmarcados por outro motivo — o card não cabia na tela —
  // e isso foi corrigido (1872 renders, zero estouro). Registro a troca porque
  // ela muda o que o próximo deve fazer: mexer no layout não os traz de volta,
  // porque não é o layout que os mantém fora.
  //
  // O que este teste trava não é a decisão, que é do owner e muda quando ele
  // quiser: é a PARIDADE acima, entre o que a tela mostra marcado e o que a app
  // de fato vai buscar.
  //
  // Nenhum tipo pode sumir do filtro. Esconder é diferente de desmarcar: o
  // editor não procura o que não vê, e conclui que a fila acabou.
  for (const t of noCodigo) {
    assert.ok(noHtml.includes(t), `${t} sumiu do filtro — desmarcar é uma coisa, esconder é outra`);
  }
  assert.ok(marcadosHtml.length > 0, 'nenhum tipo nasce marcado — a app abriria vazia');
});
