// "Perto de mim" — ordenar a fila por DISTÂNCIA (casa, trabalho, GPS).
//
// O que este arquivo trava, e por que cada coisa está aqui:
//
//  1. A ORDEM DAS COORDENADAS. É o defeito mais provável deste recurso e o
//     único que não dá sintoma: `place.mapa.centro` sai do `pontoDeGeometria`
//     do core, que INVERTE o GeoJSON e devolve [lat, lon]; o `homeLocation`
//     do Waze é [lon, lat] cru. Trocar os dois não quebra nada na tela — dá uma
//     ordenação plausível e ERRADA. Medido ao vivo na primeira tentativa:
//     374 pedidos "a ~4.000 km", quartis 3999,7 / 4000,7 / 4001,2.
//  2. PRIVACIDADE. Casa e trabalho NÃO entram no `profile`, porque o `profile`
//     vive no AppState e o AppState inteiro vai no diagnóstico que o editor
//     manda por WhatsApp.
//  3. O GPS não volta de sessão anterior, e a permissão só é pedida no gesto.
//  4. Opção que não dá pra cumprir não aparece; ordem inválida cai no padrão.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { pontoDeGeometria } from '../server/core.mjs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const CORE = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');

// Âncora em DECLARAÇÃO, nunca em distância (gotcha #67).
function fatiar(nome) {
  const ini = APP.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu do app.js`);
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:async function |function |const |let |\/\/ ──|\/\/ ═)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return APP.slice(ini, ini + 1 + fim);
}

// ── 1. A ORDEM DAS COORDENADAS ─────────────────────────────────────────────
test('o core converte casa/trabalho de [lon,lat] pra [lat,lon]', () => {
  // GeoJSON do Waze: coordinates: [lon, lat]. São Paulo fica em lat -23, lon -46.
  const p = pontoDeGeometria({ type: 'Point', coordinates: [-46.63, -23.55] });
  assert.deepEqual(p, [-23.55, -46.63],
    'a conversão inverteu errado: o app inteiro mede distância em [lat, lon]');
  // E o handler usa ESTA função, não uma conta própria — se alguém copiar o
  // `coordinates` cru pro `referencias`, a ordem diverge do resto do app.
  const h = CORE.slice(CORE.indexOf('const referencias = {'), CORE.indexOf('const referencias = {') + 260);
  assert.match(h, /casa:\s*rd\.homeLocation\s*\?\s*pontoDeGeometria\(rd\.homeLocation\)/);
  assert.match(h, /trabalho:\s*rd\.workLocation\s*\?\s*pontoDeGeometria\(rd\.workLocation\)/);
});

test('pontoDoPlace lê o centro como [lat,lon] e cai no lat/lon NOMEADO', () => {
  const fn = new Function(fatiar('pontoDoPlace') + '\nreturn pontoDoPlace;')();
  // O centro do core já vem [lat, lon]: sai como está.
  assert.deepEqual(fn({ mapa: { centro: [-23.55, -46.63] } }), [-23.55, -46.63]);
  // Sem `mapa`, o fallback usa os campos NOMEADOS — onde não há ordem pra errar.
  assert.deepEqual(fn({ lat: -23.55, lon: -46.63 }), [-23.55, -46.63]);
  // Sem coordenada nenhuma: null (vai pro fim da fila, ver abaixo).
  assert.equal(fn({}), null);
  assert.equal(fn({ mapa: { centro: null } }), null);
  assert.equal(fn({ mapa: { centro: ['x', 'y'] } }), null, 'centro não-numérico viraria NaN na distância');
});

// ── 2. A ORDENAÇÃO ─────────────────────────────────────────────────────────
function montarSort(ordem, ref) {
  const est = { queue: [], filters: { sortOrder: ordem } };
  const corpo = fatiar('sortQueue') + '\n' + fatiar('pontoDoPlace') + '\n' + fatiar('distanciaKm');
  const fn = new Function('AppState', 'referenciaDaOrdem', corpo + '\nreturn sortQueue;')(est, () => ref);
  return (fila) => { est.queue = fila.slice(); fn(); return est.queue.map((p) => p.id); };
}

test('ordena do mais perto pro mais longe, e sem coordenada vai pro FIM', () => {
  const casa = [-23.55, -46.63];                       // São Paulo
  const fila = [
    { id: 'rio', mapa: { centro: [-22.91, -43.17] }, dateAdded: 5000 },      // ~360 km
    { id: 'SEM-COORD', mapa: null, dateAdded: 9999 },
    { id: 'vizinho', mapa: { centro: [-23.56, -46.64] }, dateAdded: 1 },     // ~1,4 km
    { id: 'recife', mapa: { centro: [-8.05, -34.88] }, dateAdded: 4000 },    // ~2.130 km
  ];
  assert.deepEqual(montarSort('casa', casa)(fila), ['vizinho', 'rio', 'recife', 'SEM-COORD']);

  // CONTRAPROVA da ordem: com [lat,lon] trocado, "vizinho" deixa de ser o 1º.
  // É a asserção que reprova se alguém inverter a leitura em qualquer ponta.
  const trocada = montarSort('casa', [-46.63, -23.55])(fila);
  assert.notEqual(trocada[0], 'vizinho',
    'com a referência invertida o resultado foi IGUAL — o teste não distingue as duas versões');
});

test('sem referência, cai no sort por DATA — o comportamento de sempre', () => {
  const fila = [{ id: 'a', dateAdded: 1000 }, { id: 'b', dateAdded: 3000 }];
  assert.deepEqual(montarSort('casa', null)(fila), ['b', 'a'], 'deveria ordenar por data (mais recentes)');
});

// ── 3. PRIVACIDADE ─────────────────────────────────────────────────────────
test('casa e trabalho ficam FORA do profile e FORA do AppState', () => {
  // No servidor: `referencias` é irmão de `profile`, não filho.
  // A partir do INÍCIO, não do arquivo: `sessaoExpiraEm` aparece 3 vezes no core
  // e a primeira fica antes daqui — âncora frouxa devolvia fatia vazia.
  const ini = CORE.indexOf('const referencias = {');
  const corpo = CORE.slice(ini, CORE.indexOf('sessaoExpiraEm: prazoDaSessaoWaze', ini));
  assert.ok(corpo.length > 100 && corpo.includes('profile: {'), 'a fatia do handlePerfil saiu vazia — âncora errada');
  const iRef = corpo.indexOf('referencias,'), iProf = corpo.indexOf('profile: {');
  assert.ok(iRef >= 0 && iProf >= 0 && iRef < iProf,
    'referencias precisa ser campo próprio do corpo, ao lado de profile — dentro dele iria pro diagnóstico');
  // No cliente: a variável é de MÓDULO, nunca uma chave do AppState.
  assert.match(APP, /^let referenciasDoPerfil = null;/m, 'referenciasDoPerfil deixou de ser variável de módulo');
  assert.match(APP, /^let posicaoGps = null;/m, 'posicaoGps deixou de ser variável de módulo');
  const estado = APP.slice(APP.indexOf('const AppState = {'), APP.indexOf('const AppState = {') + 3000);
  for (const proibido of ['referenciasDoPerfil', 'posicaoGps', 'homeLocation', 'workLocation']) {
    assert.ok(!estado.includes(proibido),
      `"${proibido}" entrou no AppState — e o AppState inteiro vai no diagnóstico`);
  }
});

test('sair apaga casa, trabalho e a posição', () => {
  const logout = APP.slice(APP.indexOf('avatarPendente = null;   //'));
  const trecho = logout.slice(0, 600);
  assert.match(trecho, /referenciasDoPerfil = null/, 'o logout não apaga casa/trabalho');
  assert.match(trecho, /posicaoGps = null/, 'o logout não apaga a posição');
});

// ── 4. GPS: só no gesto, e nunca de ontem ──────────────────────────────────
test('a posição NÃO volta de uma sessão anterior', () => {
  const carga = APP.match(/AppState\.filters\.sortOrder = \[([^\]]*)\]\.includes\(parsed\.sortOrder\)/);
  assert.ok(carga, 'a carga do sortOrder mudou de forma');
  assert.ok(!carga[1].includes('gps'),
    'o GPS voltaria de ontem: a fila sairia ordenada por onde a pessoa estava, não onde está');
  for (const dever of ['oldest', 'casa', 'trabalho']) {
    assert.ok(carga[1].includes(dever), `${dever} deveria sobreviver à recarga`);
  }
});

test('a permissão só é pedida no GESTO, e nunca na abertura', () => {
  assert.equal(APP.split('navigator.geolocation.getCurrentPosition').length - 1, 1,
    'há mais de um lugar pedindo posição — o pedido tem que ter uma porta só');
  const pedir = fatiar('pedirPosicao');
  assert.match(pedir, /enableHighAccuracy:\s*false/,
    'GPS fino acende o rádio e demora; pra ordenar uma fila, aproximada basta');
  assert.match(pedir, /timeout:\s*GPS_TIMEOUT_MS/, 'sem timeout a dica fica em "pedindo" pra sempre');
  // Quem CHAMA é só o handler de troca do select. A contagem tira a declaração,
  // que casa com o mesmo padrão — contar cru dava 2 e acusava código certo.
  const decl = (APP.match(/function pedirPosicao\(\)/g) || []).length;
  const total = (APP.match(/pedirPosicao\(\)/g) || []).length;
  assert.equal(decl, 1, 'pedirPosicao deixou de ter uma declaração só');
  assert.equal(total - decl, 1, 'pedirPosicao passou a ser chamada de mais de um lugar');
  assert.match(fatiar('aoTrocarOrdenacao'), /await pedirPosicao\(\)/);
});

test('permissão negada volta pro padrão em vez de mentir sobre a ordem', () => {
  const f = fatiar('aoTrocarOrdenacao');
  const ramo = f.slice(f.indexOf('if (!pos)'));
  assert.match(ramo, /posicaoGps = null/);
  assert.match(ramo, /sel\.value = ORDEM_PADRAO/,
    'ficaria "Perto de mim" selecionado sem posição — filtro que não faz o que diz');
  assert.match(ramo, /atualizarDicaDeOrdem\('negado'\)/, 'a pessoa não saberia por que nada mudou');
});

// ── 5. A OFERTA: nada que não dê pra cumprir ───────────────────────────────
test('opção de distância só aparece quando há de onde medir', () => {
  const f = fatiar('popularOrdenacoes');
  assert.match(f, /casa:\s*!!\(referenciasDoPerfil && referenciasDoPerfil\.casa\)/);
  assert.match(f, /trabalho:\s*!!\(referenciasDoPerfil && referenciasDoPerfil\.trabalho\)/);
  assert.match(f, /gps:\s*!!\(typeof navigator[^)]*navigator\.geolocation\)/);
  assert.match(f, /if \(!disponivel\[ordem\]\) \{ if \(existente\) existente\.remove\(\); continue; \}/,
    'a opção indisponível precisa SAIR do select, não só deixar de ser criada');
});

test('abrir o modal POPULA as ordens — função solta não serve de nada', () => {
  // O smoke pegou isto: `popularOrdenacoes` existia e o select continuava com
  // duas opções, porque nada a chamava na abertura. Guard colado na abertura.
  const f = fatiar('openFiltersModal');
  assert.match(f, /popularOrdenacoes\(\);\s*\n\s*const sortSel = \$\('filterSort'\);/,
    'openFiltersModal não popula as ordens antes de escolher o valor do select');
  assert.match(f, /sortSel\.value = ordemValida\(AppState\.filters\.sortOrder\)/,
    'o select recebe a ordem sem peneirar: mostraria "Perto de casa" sem ter casa');
  // E a troca no select tem que estar LIGADA, senão o GPS nunca é pedido.
  assert.match(APP, /\$\('filterSort'\)\?\.addEventListener\('change', aoTrocarOrdenacao\)/,
    'o listener do Ordenar por sumiu — escolher GPS não pediria posição nenhuma');
});

test('ordem inválida cai no padrão em vez de deixar a fila calada', () => {
  const fn = new Function('referenciaDaOrdem', 'ORDENS_POR_DISTANCIA', 'ORDEM_PADRAO',
    fatiar('ordemValida') + '\nreturn ordemValida;')(
    (o) => (o === 'casa' ? [1, 2] : null), ['casa', 'trabalho', 'gps'], 'newest');
  assert.equal(fn('oldest'), 'oldest');
  assert.equal(fn('casa'), 'casa');
  assert.equal(fn('trabalho'), 'newest', 'sem trabalho no perfil, deveria cair no padrão');
  assert.equal(fn('gps'), 'newest', 'sem posição, deveria cair no padrão');
  assert.equal(fn('lixo'), 'newest');
  assert.equal(fn(undefined), 'newest');
});

// ── 6. O CABEÇALHO PRECISA PERMITIR ────────────────────────────────────────
test('Permissions-Policy libera geolocation nas DUAS cópias', () => {
  // Com `geolocation=()` o navegador nem pergunta: a API falha calada, e a
  // opção viraria um beco sem saída. As duas cópias porque o `_headers` é do
  // Cloudflare e o `node.mjs` é quem manda cabeçalho numa VM (gotcha #14).
  for (const [arquivo, txt] of [['_headers', readFileSync(new URL('../_headers', import.meta.url), 'utf8')],
                                ['server/node.mjs', CORE.length ? readFileSync(new URL('../server/node.mjs', import.meta.url), 'utf8') : '']]) {
    const m = txt.match(/Permissions-Policy['":\s]+([^'"\n]+)/);
    assert.ok(m, `${arquivo}: sem Permissions-Policy`);
    assert.match(m[1], /geolocation=\(self\)/, `${arquivo}: geolocation bloqueado — a opção não teria como funcionar`);
    // E o resto do cabeçalho não pode ter sido afrouxado junto.
    assert.match(m[1], /camera=\(\)/, `${arquivo}: câmera deixou de ser bloqueada`);
    assert.match(m[1], /microphone=\(\)/, `${arquivo}: microfone deixou de ser bloqueado`);
  }
});

test('a dica do filtro existe no HTML e nasce escondida', () => {
  const linha = HTML.split('\n').find((l) => l.includes('id="filterSortHint"'));
  assert.ok(linha, 'sumiu o #filterSortHint');
  assert.match(linha, /\bhidden\b/, 'a dica apareceria vazia antes de haver estado');
});
