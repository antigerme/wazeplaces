// As SENTINELAS do diagnóstico: o arquivo não me dá material pra investigar,
// ele diz o que está errado — no aparelho do editor, onde eu não chego.
//
// Cada uma nasce de um defeito que já chegou na tela de alguém, e a regra de
// entrada é dura: só invariante que a app GARANTE. Falso positivo aqui treina a
// ignorar a seção inteira, que é como ela deixa de servir. Por isso cada teste
// tem os DOIS lados — dispara com o defeito, cala sem ele.
//
// Uma sentinela já foi escrita e REMOVIDA por não passar nessa régua: a de
// "modal achatado" por altura. Ela não disparou no caso real (302px de 812, 37%)
// e o modal LEGÍTIMO é mais baixo ainda (236px, 29%) — nenhum limiar separa os
// dois. O comentário no `app.js` guarda o motivo; este arquivo trava que ela não
// volte por palpite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'js/app.js'), 'utf8');

// Fatia e AVALIA a função pura — nunca parseia a expressão (gotcha #49).
function montar() {
  const i = APP.indexOf('function diagSentinelas(');
  assert.ok(i > 0, 'diagSentinelas sumiu do app.js');
  const fim = APP.indexOf('\n}', i);
  return new Function(APP.slice(i, fim + 2) + '\nreturn diagSentinelas;')();
}
const chaves = (r) => r.map((a) => a.chave).sort();

// O estado SÃO: nada focado que abra teclado, sem inset, tema coerente.
const sao = () => ({
  janela: { innerW: 375, innerH: 812 },
  varsCss: { '--kb-inset': '0px', '--header-h': '69px' },
  foco: { tag: 'BUTTON', id: 'closeFilters', emModal: true, abreTeclado: false },
  tema: { htmlClasse: 'dark', guardado: 'dark' },
  geometria: [{ sel: '.card-btn-reject', x: 20, y: 700, w: 56, h: 56, noCentro: 'ele mesmo',
                camadaAberta: false, naCamada: false }],
});

test('sentinelas: o estado SÃO não gera alerta nenhum (o controle)', () => {
  assert.deepEqual(montar()(sao()), []);
});

test('sentinelas: inset de teclado sem campo focado — o bug do PWA do iOS', () => {
  // Os números REAIS do aparelho do editor L2+AM (v2026.09.09-02).
  const c = sao();
  c.varsCss['--kb-inset'] = '388px';
  const r = montar()(c);
  assert.deepEqual(chaves(r), ['kbInsetSemFoco']);
  assert.equal(r[0].kbInset, 388);
});

test('sentinelas: com o teclado ABERTO de verdade ela cala — senão é ruído', () => {
  const c = sao();
  c.varsCss['--kb-inset'] = '336px';
  c.foco = { tag: 'INPUT', id: 'pairCodeInput', emModal: true, abreTeclado: true };
  assert.deepEqual(montar()(c), []);
});

test('sentinelas: foco DESCONHECIDO cai no lado que alerta, não no que cala', () => {
  // `abreTeclado: null` é o que sai num build ANTIGO, sem `campoDeTextoFocado` —
  // e build antigo é exatamente onde o defeito vive. A primeira versão pedia
  // `=== false` e ficava muda justamente ali.
  const c = sao();
  c.varsCss['--kb-inset'] = '388px';
  c.foco = { tag: 'BUTTON', abreTeclado: null };
  assert.deepEqual(chaves(montar()(c)), ['kbInsetSemFoco']);

  const semFoco = sao();
  semFoco.varsCss['--kb-inset'] = '388px';
  semFoco.foco = null;
  assert.deepEqual(chaves(montar()(semFoco)), ['kbInsetSemFoco']);
});

test('sentinelas: `tema-claro` + `dark` só alerta onde tem consequência', () => {
  const escuro = () => {
    const c = sao();
    c.media = { '(prefers-color-scheme: dark)': true };
    return c;
  };
  // Sistema ESCURO: a regra `html:not(.tema-claro)` que pinta o fundo vive
  // dentro do `@media (prefers-color-scheme: dark)`, então aqui a contradição
  // pesa — e alerta.
  const c = escuro();
  c.tema.htmlClasse = 'tema-claro sem-extensao dark';  // a classe REAL do diag dele
  assert.deepEqual(chaves(montar()(c)), ['temaContraditorio']);

  // Sistema CLARO: a media query nem se aplica. Alertar aqui seria disparar em
  // todo diagnóstico de quem trocou de tema — o ruído que mata a seção.
  const claro = sao();
  claro.tema.htmlClasse = 'tema-claro sem-extensao dark';
  assert.deepEqual(montar()(claro), []);

  // E `dark` tem que ser palavra inteira, nunca substring.
  const outro = escuro();
  outro.tema.htmlClasse = 'tema-claro modo-darkroom';
  assert.deepEqual(montar()(outro), []);
});

test('sentinelas: modal aberto sobre os botões do card NÃO é alerta', () => {
  // O PRIMEIRO diagnóstico real que chegou com sentinelas trazia 3 alertas, e os
  // 3 eram FALSOS: o editor gerou o arquivo com os Filtros abertos, e modal
  // cobrir o card é a função do modal. Os números aqui são os dele.
  const c = sao();
  c.geometria = [
    { sel: '.card-btn-reject', x: 20, y: 700, w: 56, h: 56, noCentro: '#filtersModal', camadaAberta: true, naCamada: false },
    { sel: '.card-btn-skip', x: 90, y: 700, w: 48, h: 48, noCentro: '#filtersModal', camadaAberta: true, naCamada: false },
    { sel: '.card-btn-read', x: 160, y: 700, w: 56, h: 56, noCentro: '#filtersModal', camadaAberta: true, naCamada: false },
  ];
  assert.deepEqual(montar()(c), []);

  // CONTROLE do conserto: com a MESMA camada aberta, um controle DE DENTRO dela
  // coberto continua sendo defeito — senão o conserto vira cegueira e o gotcha
  // #26 (que já reincidiu três vezes, todas dentro de camada) para de ser visto.
  const dentro = sao();
  dentro.geometria = [{ sel: '.card-btn-read', x: 0, y: 0, w: 56, h: 56,
                        noCentro: '#lightboxCount', camadaAberta: true, naCamada: true }];
  assert.deepEqual(chaves(montar()(dentro)), ['toqueInterceptado']);

  // E o #devFab não precisa de exceção: `z-[68]` fica ACIMA do modal, então com
  // camada aberta ele nem é interceptado (medido no diagnóstico: "ele mesmo").
  const fab = sao();
  fab.geometria = [{ sel: '#devFab:not(.hidden)', x: 300, y: 130, w: 44, h: 44,
                     noCentro: 'ele mesmo', camadaAberta: true, naCamada: false }];
  assert.deepEqual(montar()(fab), []);
});

test('sentinelas: algo por cima de um controle (gotcha #26, 3 reincidências)', () => {
  const c = sao();
  c.geometria = [{ sel: '.card-btn-read', x: 0, y: 0, w: 56, h: 56, noCentro: '#lightboxCount' }];
  const r = montar()(c);
  assert.deepEqual(chaves(r), ['toqueInterceptado']);
  assert.equal(r[0].recebe, '#lightboxCount');
  // Controle: elemento que NÃO é controle pode ter coisa por cima (modal sobre
  // o placar é normal) — alertar ali seria ruído a cada abertura.
  const normal = sao();
  normal.geometria = [{ sel: '#placar', x: 0, y: 0, w: 343, h: 67, noCentro: '#filtersModalTitle' }];
  assert.deepEqual(montar()(normal), []);
});

test('sentinelas: alvo de toque abaixo de 44px', () => {
  const c = sao();
  c.geometria = [{ sel: '.card-btn-skip', x: 0, y: 0, w: 40, h: 56, noCentro: 'ele mesmo' }];
  assert.deepEqual(chaves(montar()(c)), ['alvoPequeno']);
  // 44 exatos é a régua, não uma falha
  const limite = sao();
  limite.geometria = [{ sel: '.card-btn-skip', x: 0, y: 0, w: 44, h: 44, noCentro: 'ele mesmo' }];
  assert.deepEqual(montar()(limite), []);
});

test('sentinelas: NÃO volta a sentinela de modal achatado por altura', () => {
  // Ela não distingue os dois casos: o achatado tinha 302px de 812 e o
  // `pairEnterModal` legítimo tem 236px. Se alguém a recriar, isto reprova.
  const achatado = sao();
  achatado.geometria = [{ sel: '.modal-root:not(.hidden) > div', x: 16, y: 61, w: 343, h: 302, noCentro: 'ele mesmo' }];
  const legitimo = sao();
  legitimo.geometria = [{ sel: '.modal-root:not(.hidden) > div', x: 16, y: 288, w: 343, h: 236, noCentro: 'ele mesmo' }];
  const s = montar();
  assert.deepEqual(s(achatado), [], 'sentinela de altura de modal voltou');
  assert.deepEqual(s(legitimo), [], 'sentinela de altura de modal voltou');
  assert.match(APP, /NÃO existe sentinela de "modal achatado" por ALTURA/,
    'o motivo da ausência saiu do app.js — sem ele alguém a recria por palpite');
});

test('sentinelas: erro na coleta vira alerta, nunca silêncio', () => {
  const r = montar()(null);
  assert.equal(r.length, 1);
  assert.equal(r[0].chave, '_erro');
});

test('diagnóstico: a camada computada é coletada e vai pro relatório', () => {
  // Existir não basta: função definida e nunca chamada é decoração, e a
  // sabotagem que apagou `fora.geometria = diagGeometria()` passou limpa numa
  // versão anterior deste teste. Aqui se cobra a DEFINIÇÃO e a CHAMADA.
  for (const [nome, chamada] of [['diagComputado', 'diagComputado()'],
                                 ['medirSafeArea', 'medirSafeArea()'],
                                 ['diagGeometria', 'diagGeometria()'],
                                 ['diagQuemEstaNoCentro', 'diagQuemEstaNoCentro(e, r)']]) {
    assert.ok(APP.includes('function ' + nome + '('), `${nome} sumiu`);
    const usos = APP.split(chamada).length - 1;
    assert.ok(usos >= 1, `${nome} está definida mas ninguém a chama`);
  }
  assert.match(APP, /fora\.safeArea = medirSafeArea\(\)/, 'a safe-area saiu do computado');
  assert.match(APP, /fora\.geometria = diagGeometria\(\)/, 'a geometria saiu do computado');
  // Os dois campos que o conserto do falso positivo usa têm que SAIR DO DOM, não
  // de constante: com `naCamada: false` cravado a sentinela volta a acusar tudo,
  // e com `camadaAberta: false` cravado ela nunca cala — e as duas sabotagens
  // passaram limpas numa versão anterior deste teste, porque o caso de uso as
  // recebe como fixture.
  assert.match(APP, /naCamada: camadas\.some\(\(c\) => c\.contains\(e\)\)/,
    'o coletor parou de medir se o elemento está DENTRO da camada aberta');
  assert.match(APP, /camadaAberta: camadas\.length > 0/,
    'o coletor parou de reportar que há camada aberta');
  assert.match(APP, /function diagCamadasAbertas\(\)[\s\S]{0,400}classList\.contains\('hidden'\)/,
    'diagCamadasAbertas parou de olhar o estado real das camadas');
  // Uma medição só, usada nos dois lugares: duas medições seriam dois instantes
  // e o alerta poderia sumir do relatório em que acabou de aparecer.
  assert.match(APP, /const computado = diagComputado\(\);\s*\n\s*const alertas = diagSentinelas\(computado\);/,
    'o computado e as sentinelas se soltaram — ou são duas medições agora');
  assert.match(APP, /\n\s*alertas,\n/, 'os alertas saíram do resumo do topo');
  assert.match(APP, /\n\s*computado,\n/, 'a camada computada saiu do relatório');
  // Sem `abreTeclado` no coletor, a sentinela do teclado passa a alertar TODA
  // vez que alguém digitar (undefined !== true) — o falso positivo que faz a
  // seção inteira ser ignorada. É a metade do par que o `!== true` exige.
  assert.match(APP, /abreTeclado: \(typeof campoDeTextoFocado === 'function'\)/,
    'o coletor parou de dizer se o foco abre teclado — a sentinela vira ruído');
  // O visualViewport é o valor que custou a investigação inteira.
  assert.match(APP, /coberto: Math\.round\(window\.innerHeight - vv\.height - vv\.offsetTop\)/,
    'o `coberto` já subtraído saiu — deixar a conta pro leitor é deixar o erro passar');
});

// ── As duas do relato de 2026-09-22 ─────────────────────────────────────────
//
// O arquivo daquele relato tinha o defeito na tela e `alertas: []`. As duas
// nasceram de garantias que o conserto criou, e por isso podem ser sentinela:
// o aviso "precisa de sinal" só existe DEPOIS de a foto falhar, e tile guardado
// é servido do cache com o service worker no comando.

test('sentinelas: aviso de "precisa de sinal" sobre foto CARREGADA — o defeito do relato', () => {
  // O caso REAL: em 4 das 6 capturas do owner o aviso estava na tela e a foto
  // não estava quebrada.
  const c = sao();
  c.fotoDaFrente = { aviso: true, carregada: true, src: 'https://venue-image.waze.com/thumbs/thumb700_x?w=1' };
  const r = montar()(c);
  assert.deepEqual(chaves(r), ['fotoEscondidaComAviso']);
  assert.match(r[0].foto, /thumb700_x/, 'o alerta tem que dizer QUAL foto');
});

test('sentinelas: aviso com a foto que FALHOU de verdade é o comportamento certo — cala', () => {
  // Este é o caso LEGÍTIMO do aviso (a foto não veio): alertar aqui seria
  // acusar o conserto como defeito, e a seção morreria de falso positivo.
  const c = sao();
  c.fotoDaFrente = { aviso: true, carregada: false, src: 'x' };
  assert.deepEqual(montar()(c), []);
  const semAviso = sao();
  semAviso.fotoDaFrente = { aviso: false, carregada: true, src: 'x' };
  assert.deepEqual(montar()(semAviso), [], 'foto carregada sem aviso é o card normal');
  const semCard = sao();
  semCard.fotoDaFrente = null;
  assert.deepEqual(montar()(semCard), [], 'sem card na frente não há o que acusar');
});

test('sentinelas: pedaço de mapa GUARDADO que falhou — o outro defeito do relato', () => {
  const c = sao();
  c.tilesGuardadosQueFalharam = [
    { t: 1, url: 'https://www.waze.com/row-tiles/live/base/17/1/1/tile.png' },
    { t: 2, url: 'https://www.waze.com/row-tiles/live/base/17/1/2/tile.png' },
  ];
  const r = montar()(c);
  assert.deepEqual(chaves(r), ['tileGuardadoFalhou']);
  assert.equal(r[0].n, 2);
  assert.equal(r[0].exemplos.length, 2, 'o alerta tem que trazer QUAIS tiles');
  const vazio = sao();
  vazio.tilesGuardadosQueFalharam = [];
  assert.deepEqual(montar()(vazio), [], 'anel vazio é o normal');
});

test('diagnóstico: as duas sentinelas novas leem o que o COLETOR mede de verdade', () => {
  // A sentinela é função pura sobre o `computado`; se o coletor parar de medir,
  // ela cala pra sempre — e calar é o estado que passa em todo teste de cima.
  const i = APP.indexOf('function diagComputado(');
  const corpo = APP.slice(i, APP.indexOf('\n}', i));
  assert.match(corpo, /aviso: !!frente\.querySelector\('\.card-sem-foto'\)/,
    'o coletor parou de ver o aviso do card da frente');
  assert.match(corpo, /carregada: !!\(foto && foto\.complete && foto\.naturalWidth > 0\)/,
    'o coletor parou de medir se a foto CARREGOU (complete E naturalWidth)');
  assert.match(corpo, /const frente = cardDaFrente\(\);/,
    'a medição tem que ser do card da FRENTE — o de fundo é clone, sem ouvinte');
  assert.match(corpo, /fora\.tilesGuardadosQueFalharam = diagTilesGuardadosQueFalharam\.slice\(-5\)/,
    'o coletor parou de levar o anel de tiles guardados que falharam');
});

// ── O esqueleto POR CIMA do card (relato de 2026-09-22, a app reaberta sem rede) ──
// O arquivo daquele relato dizia "painel: carregando" e `alertas: []` — e havia
// um card montado, com o mapa carregado do cache, embaixo do esqueleto (z-50).
// A leitura só achou o card cavando o `dom` cru. Com o conserto, card montado
// e esqueleto visível ao mesmo tempo passou a ser impossível pela app.

test('sentinelas: esqueleto de "carregando" POR CIMA de um card montado — o defeito do relato', () => {
  const c = sao();
  c.telaDoCard = { esqueleto: true, card: true };
  assert.deepEqual(chaves(montar()(c)), ['esqueletoSobreCard']);
});

test('sentinelas: esqueleto SEM card é carregar de verdade, e card sem esqueleto é o normal — cala', () => {
  // Alertar no carregamento legítimo (a fila ainda chegando, sem card) seria
  // acusar toda abertura da app, e a seção morreria de falso positivo.
  for (const [esqueleto, card, porque] of [
    [true, false, 'a fila ainda está chegando: é o esqueleto fazendo o trabalho dele'],
    [false, true, 'o card na tela, sem nada por cima: o normal'],
    [false, false, 'painel vazio ou tela de fila vazia'],
  ]) {
    const c = sao();
    c.telaDoCard = { esqueleto, card };
    assert.deepEqual(montar()(c), [], porque);
  }
  const semDado = sao();   // relatório de versão antiga: o campo não existe
  assert.deepEqual(montar()(semDado), [], 'sem o dado, a sentinela não inventa alerta');
});

test('diagnóstico: a sentinela do esqueleto lê o que o COLETOR mede (esqueleto E card)', () => {
  const i = APP.indexOf('function diagComputado(');
  const corpo = APP.slice(i, APP.indexOf('\n}', i)).split('\n')
    .filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(corpo, /fora\.telaDoCard = \{/, 'o coletor parou de levar a tela do card');
  // Classe E caixa: só a classe diria "visível" pra um esqueleto fora da tela,
  // e só a caixa não distingue o `hidden` que a app usa pra esconder.
  assert.match(corpo, /esqueleto: !!\(esq && !esq\.classList\.contains\('hidden'\) && rEsq\.width > 0 && rEsq\.height > 0\)/,
    'o esqueleto tem que ser medido pela classe `hidden` E pela caixa');
  assert.match(corpo, /card: !!frente,/, 'o card medido tem que ser o da FRENTE (`cardDaFrente()`)');
});

test('sentinelas: pedido que já está esperando envio DE VOLTA na fila — o relato de reabrir sem rede', () => {
  // v2026.09.22-06: reaberta no modo avião, a app devolvia como card o que o
  // owner já tinha tratado, e dava pra decidir de novo.
  const c = sao();
  c.decididos = { naSaida: 3, naFila: 2 };
  const r = montar()(c);
  assert.deepEqual(chaves(r), ['pedidoDecididoNaFila']);
  assert.equal(r[0].n, 2, 'o alerta leva QUANTOS voltaram — é o número que se compara com a fila de saída');
});

test('sentinelas: fila de saída cheia com a fila de pedidos limpa é o normal — cala', () => {
  // Pedido esperando envio é o comportamento certo sem rede; o defeito é ele
  // voltar a ser card. Alertar só por haver fila de saída acusaria todo
  // relatório gerado na estrada.
  for (const [decididos, porque] of [
    [{ naSaida: 5, naFila: 0 }, 'decisões esperando rede, nenhuma de volta: o normal do offline'],
    [{ naSaida: 0, naFila: 0 }, 'sem fila de saída'],
  ]) {
    const c = sao();
    c.decididos = decididos;
    assert.deepEqual(montar()(c), [], porque);
  }
  assert.deepEqual(montar()(sao()), [], 'relatório de versão antiga (sem o campo): não inventa alerta');
});

test('diagnóstico: a sentinela do pedido decidido lê o que o COLETOR mede (fila de saída × fila de pedidos)', () => {
  const i = APP.indexOf('function diagComputado(');
  const corpo = APP.slice(i, APP.indexOf('\n}', i)).split('\n')
    .filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // A MESMA chave dos dois lados, pela fonte única — é ela que o filtro usa.
  assert.match(corpo, /const naSaida = new Set\(carregarFilaDeSaida\(\)\.map\(chaveDoPedido\)\.filter\(Boolean\)\);/,
    'o coletor tem que ler a fila de saída pela `chaveDoPedido`, a mesma do filtro');
  assert.match(corpo, /naFila: \(AppState\.queue \|\| \[\]\)\.filter\(\(p\) => naSaida\.has\(chaveDoPedido\(p\)\)\)\.length,/,
    'o coletor tem que cruzar com a fila de PEDIDOS');
  // Só números: a chave é id de pedido de terceiro.
  assert.ok(!/decididos = \{[^}]*chaves/.test(corpo), 'o coletor passou a levar as CHAVES — só a contagem vai');
  // O NOME que o coletor grava é o que a sentinela lê. Sem esta amarra, renomear
  // um dos lados deixava os dois testes verdes e a sentinela muda pra sempre —
  // foi a sabotagem que sobreviveu na primeira rodada.
  assert.match(corpo, /fora\.decididos = \{/, 'o coletor parou de gravar `decididos`');
  const s = APP.slice(APP.indexOf('function diagSentinelas('), APP.indexOf('\n}', APP.indexOf('function diagSentinelas(')));
  assert.match(s, /const dc = comp\.decididos;/, 'a sentinela parou de ler `comp.decididos`');
});
