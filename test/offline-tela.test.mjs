// A TELA QUANDO A BUSCA FALHA — e o que ela tem o direito de afirmar.
//
// Veio do relato do owner com print: ele abriu o app, fechou, desligou os
// dados e abriu de novo. A tela dizia **RESTAM 0** — e o número real era 426,
// como o `busca.ok` do diagnóstico mostrou assim que a rede voltou. Zero não
// é "não sei": zero é "tudo limpo", que é o oposto da verdade. Este repo já
// trata cobrir número como mentira (o `.nao-cobrir` do placar existe por
// isso); imprimir um número falso é pior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const MIN = readFileSync(new URL('../js/min/app.js', import.meta.url), 'utf8');

const semComentarios = (s) => s.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const APP_SEM = semComentarios(APP);

function fatiar(nome) {
  const marca = APP_SEM.indexOf('function ' + nome + '(');
  assert.ok(marca >= 0, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', marca);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  i = APP_SEM.indexOf('{', i);
  let prof = 0, fim = APP_SEM.length;
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(marca, fim);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — instrumento quebrado`);
  return corpo;
}

test('"RESTAM" não pode dizer ZERO quando o app não sabe', () => {
  const c = fatiar('updatePendingCount');
  assert.match(c, /if \(AppState\.loadError\) \{\s*el\.textContent = '—';/,
    'o placar voltou a imprimir o serverTotal com a busca falhada — e aí ele diz 0 pra 426 pedidos');
  // ORDEM: o ramo tem que vir ANTES do `setCount`, senão nunca é alcançado.
  // O `setCount` do placar REAL (o do treino vem antes, num ramo próprio que
  // retorna — e o placar do treino não tem `loadError`).
  const iErro = c.indexOf('AppState.loadError');
  const iSet = c.indexOf('setCount(el, AppState.serverTotal');
  assert.ok(iErro > 0 && iSet > 0 && iErro < iSet,
    'o ramo de falha ficou DEPOIS do setCount: código morto, e a tela segue mentindo');
  // E o traço é o MESMO símbolo do deslogado, não um terceiro vocabulário.
  assert.match(c, /if \(!AppState\.authenticated\) \{\s*el\.textContent = '—';/,
    'o deslogado deixou de usar o traço — os dois estados precisam do mesmo símbolo');
});

test('sem conexão a tela AFIRMA, e só quando o app sabe', () => {
  const c = fatiar('showNoPlaces');
  assert.match(c, /navigator\.onLine === false/,
    'a tela parou de distinguir "sem conexão" de "falhou" — volta a aconselhar sem saber');
  assert.match(c, /states\.error\.titleOffline/, 'sumiu o título de sem-conexão');
  assert.match(c, /states\.error\.bodyOffline/, 'sumiu o corpo de sem-conexão');
  // UMA MÃO só: `onLine === true` não prova rede (portal cativo mente), então
  // ele não pode decidir nada — só o `false` troca o texto.
  assert.ok(!/navigator\.onLine === true|navigator\.onLine\s*\?/.test(c),
    'a tela passou a confiar no `onLine === true`, que não prova nada');
});

test('o BOTÃO fica — decisão do owner, e tem motivo', () => {
  // Eu propus tirá-lo (botão que não pode dar certo offline) e o owner
  // escolheu mantê-lo olhando os mockups. O motivo é o mesmo que o
  // `callWithRetry` já usa: o evento `online` às vezes não dispara, e aí o
  // toque é a ÚNICA saída manual. Guard existe pra que "limpar a tela" numa
  // próxima passada não o remova sem essa conversa acontecer de novo.
  const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  const i = HTML.indexOf('id="loadErrorState"');
  assert.notEqual(i, -1, 'sumiu o #loadErrorState');
  const bloco = HTML.slice(i, HTML.indexOf('</div>\n\n', i));
  assert.match(bloco, /id="retryLoadBtn"/, 'o botão de tentar novamente saiu da tela de erro');
  const c = fatiar('showNoPlaces');
  assert.ok(!/retryLoadBtn[\s\S]{0,80}display\s*=\s*'none'/.test(c),
    'o código passou a esconder o botão — o owner decidiu que ele fica');
});

test('UM anúncio: o toast cala quando o painel fala', () => {
  const c = fatiar('fetchNextPage');
  assert.match(c, /const temCard = !!AppState\.currentPlace \|\| AppState\.queue\.length > 0;/,
    'sumiu a distinção entre "tem card na tela" e "a tela é o painel de erro"');
  assert.match(c, /if \(temCard\) showToast\(t\('toast\.loadPlacesError'\), 'error'\)/,
    'o toast voltou a sair junto com o painel — dois anúncios do mesmo fato');
  // E ele NÃO pode sumir de vez: com card na tela o painel não aparece, e aí
  // o toast é o único sinal de que a busca falhou.
  assert.match(c, /showToast\(t\('toast\.loadPlacesError'\)/,
    'o toast sumiu por completo — com card na tela ninguém mais avisa');
});

test('a rede voltando refaz a BUSCA, não só a fila de saída', () => {
  // O ouvinte que REFAZ a busca — não "o primeiro do arquivo", que hoje é o do
  // diagnóstico anotando a transição da rede (gotcha #67).
  const ouvintes = [...APP_SEM.matchAll(/addEventListener\('online'/g)]
    .map((m) => APP_SEM.slice(m.index, m.index + 700));
  assert.ok(ouvintes.length > 0, 'sumiu o ouvinte de `online`');
  const ouvinte = ouvintes.find((o) => /startFetching\(\)/.test(o)) || '';
  assert.match(ouvinte, /startFetching\(\)/,
    'a busca não é refeita quando a rede volta: o editor fica olhando "Falha ao carregar" com 4g');
  // PORTÃO: sem `loadError` isto vira uma requisição a cada oscilação de
  // rede, e o free tier é restrição de projeto, não detalhe.
  assert.match(ouvinte, /AppState\.loadError/,
    'o refetch perdeu o portão do loadError — vira requisição a cada oscilação');
  assert.match(ouvinte, /!AppState\.fetching/,
    'o refetch pode empilhar em cima de uma busca já em curso');
  // EM ORDEM, nunca em paralelo. A primeira versão disparava os dois juntos e
  // o CI reprovou: o `resetQueue()` roda SÍNCRONO no meio do esvaziamento (que
  // está num `await`) e mexe no estado embaixo dele. O sintoma era a fila de
  // saída não drenar — PERDER trabalho já feito, que é o oposto do que ela
  // existe pra fazer. Aqui a corrida passava; no runner, não.
  assert.match(ouvinte, /await esvaziarFilaDeSaida\(\)/,
    'o esvaziamento voltou a correr EM PARALELO com o refetch');
  const iEsv = ouvinte.indexOf('esvaziarFilaDeSaida()');
  const iRef = ouvinte.indexOf('startFetching()');
  assert.ok(iEsv > 0 && iRef > iEsv,
    'o refetch ficou ANTES do esvaziamento: o trabalho do editor vem primeiro');
});

test('as 2 chaves novas existem nos 4 idiomas', () => {
  for (const k of ['states.error.titleOffline', 'states.error.bodyOffline']) {
    const n = (I18N.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length;
    assert.equal(n, 4, `${k} aparece ${n}× — precisa dos 4 idiomas`);
  }
});

test('o bundle GERADO tem tudo — senão nada disso está no ar', () => {
  // Os testes acima fatiam o FONTE; o app carrega o `js/min/` (gotcha #22, que
  // já mordeu DUAS vezes nesta mesma sessão).
  assert.match(MIN, /titleOffline/, 'o js/min/ não tem o texto de sem-conexão — falta `npm run js`');
  assert.match(MIN, /startFetching/, 'o js/min/ está defasado');
});

// ── O APP REABERTO SEM REDE: o card nasce, e o esqueleto tem que SAIR ──
// Relato de 2026-09-22: o owner ligou o offline, deixou encher, fechou o app e
// reabriu no modo avião — a tela ficou parada no esqueleto de "carregando". O
// diagnóstico dele mostrou o resto: a fila guardada ENTROU (236 pedidos, o
// `offline.abriu` no diário), o card da frente estava MONTADO e o mapa dele até
// carregou do cache. Só que por BAIXO do `#loadingCard`, que nasce visível no
// HTML com z-50 e que só o `startFetching` escondia — e a abertura sem rede, de
// propósito, não chama o `startFetching`.
test('montou card, o esqueleto sai — FONTE ÚNICA no `renderCurrentCard`', () => {
  const r = fatiar('renderCurrentCard');
  const iCard = r.indexOf("document.getElementById('cardStack').appendChild(card);");
  const iEsq = r.search(/^\s+showLoading\(false\);/m);
  assert.ok(iCard > 0, 'o renderCurrentCard deixou de pendurar o card na pilha');
  assert.ok(iEsq > iCard,
    'o renderCurrentCard não esconde o esqueleto DEPOIS de montar o card — o app reaberto sem rede fica parado no "carregando"');
  assert.match(r, /getElementById\('loadErrorState'\)\?\.classList\.add\('hidden'\)/,
    'card na tela e o painel de falha também visível: o card tem que tirá-lo');
});

test('o esqueleto nasce VISÍVEL no HTML — é por isso que alguém tem que escondê-lo', () => {
  // Se um dia o markup nascer com `hidden`, a regra de cima continua certa,
  // mas o motivo muda: este teste existe pra que a premissa seja CONFERIDA.
  const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  const tag = HTML.match(/<div id="loadingCard" class="([^"]*)"/);
  assert.ok(tag, 'o #loadingCard sumiu do index.src.html');
  // Por LISTA de classes: `\bhidden\b` casa com o `hidden` de `overflow-hidden`
  // (o hífen é fronteira de palavra) — foi o erro que eu cometi lendo o
  // diagnóstico deste mesmo relato.
  assert.ok(!tag[1].split(/\s+/).includes('hidden'),
    'o esqueleto passou a nascer escondido — reveja quem o mostra na abertura');
  assert.ok(tag[1].split(/\s+/).includes('z-50'), 'o esqueleto deixou de ficar POR CIMA do card (z-50)');
});

// ── card de foto SEM FOTO: ✕ e ✓ não decidem por caminho nenhum ───────────
// O botão já travava (`aplicarTravaDeAcao`), mas o GESTO e a SETA passavam
// direto — dava pra rejeitar uma foto que ninguém viu (auditoria 2026-09-25).
test('sem foto: a decisão trava no gesto, na seta e no handler — o ↑ segue', () => {
  const corpo = fatiar('direcaoTravada');
  const trava = (temAviso) => new Function('cardDaFrente', corpo + '\nreturn direcaoTravada;')(
    () => ({ querySelector: (sel) => (sel === '.card-sem-foto' && temAviso ? {} : null) }));
  assert.equal(trava(true)('left'), true);
  assert.equal(trava(true)('right'), true);
  assert.equal(trava(true)('up'), false, 'pular é o que o aviso manda fazer');
  assert.equal(trava(false)('left'), false, 'CONTROLE: com a foto na tela, decide');
  for (const [h, d] of [['handleReject', 'left'], ['handleMarkAsRead', 'right']]) {
    assert.match(fatiar(h), new RegExp(`if \\(direcaoTravada\\('${d}'\\)\\) return;`), `${h} decide sem a foto`);
  }
  const swipe = readFileSync(new URL('../js/swipe.js', import.meta.url), 'utf8');
  assert.match(swipe, /\} else if \(commitX && !\(window\.direcaoTravada && window\.direcaoTravada\(deltaX > 0 \? 'right' : 'left'\)\)\) \{/,
    'o gesto decide o que o botão recusa');
  assert.match(swipe, /if \(window\.direcaoTravada && window\.direcaoTravada\(direction\)\) return;/, 'a seta decide o que o botão recusa');
});

test('área que ROLA no card não vira arraste: a rede de segurança (.card-content-rola) está na exceção', () => {
  // Com fonte grande o conteúdo do card rola; fora da exceção, o arraste
  // engolia a rolagem e arrastar pra cima PULAVA o card (auditoria 2026-09-25).
  const swipe = readFileSync(new URL('../js/swipe.js', import.meta.url), 'utf8');
  const linha = swipe.split('\n').find((l) => /if \(e\.target\.closest\('button, a, input/.test(l));
  assert.ok(linha, 'a lista de exceção do arraste sumiu');
  for (const cls of ['.card-changes-list', '.card-flag-comment-text', '.card-content-rola']) {
    assert.ok(linha.includes(cls), `${cls} rola e não está na exceção do arraste`);
  }
});

// O aviso "A foto precisa de sinal" promete: "Ela chega sozinha quando a rede
// voltar". Nada a buscava de novo, e o card ficava travado até a pessoa pular
// (auditoria de 2026-09-25). A recuperação PROVA a foto antes de redesenhar:
// redesenhar com a rede ainda firmando daria "Sem Imagem" com ✕ e ✓ vivos.
// `servidorDaFoto`: o que o servidor da FOTO faz com o pedido sem CORS da sonda
// (R7-4-06) — 'responde' (qualquer resposta HTTP, o 404 da foto tirada do ar
// inclusive), 'falha' (a rede não passa) ou 'pendura'.
// `tetoProva`: o teto da prova da <img> (R8-4-08), curto aqui pra o teste não esperar.
// `gesto`: há um GESTO no card (o dedo nele, a volta pro lugar, a saída) — o que
// o swipe.js responde pelo `gestoNoCard` (R10-4-01). `transform` é só o que fica
// escrito no card: a volta pro lugar deixa `translate(0, 0) rotate(0deg)`.
function montarRecuperacao({ online = true, semFoto = true, transform = '', gesto = false, servidorDaFoto = 'falha', tetoProva = 60 } = {}) {
  const place = { venueID: 'v1', updateRequestID: 'ur1', purType: 'NEW_PHOTO', imageUrls: ['https://venue-image.waze.com/a', 'https://venue-image.waze.com/ur1'] };
  const redesenhos = [];
  const provas = [];
  const sondas = [];
  const diario = [];
  // Quem guarda o foco no redesenho (R8-4-03): a opção com que foi chamado.
  const focos = [];
  const card = { style: { transform }, querySelector: (sel) => (sel === '.card-sem-foto' && semFoto ? {} : null) };
  const estado = { gesto };
  class Image { set src(u) { this._src = u; provas.push(this); } get src() { return this._src; } }
  const fetch = (u, opcoes) => {
    sondas.push({ u, opcoes });
    if (servidorDaFoto === 'responde') return Promise.resolve({ type: 'opaque', status: 0 });
    if (servidorDaFoto === 'pendura') {
      return new Promise((_, falhar) => opcoes.signal.addEventListener('abort', () => falhar(new Error('AbortError'))));
    }
    return Promise.reject(new TypeError('Failed to fetch'));
  };
  const deps = {
    navigator: { onLine: online }, AppState: { currentPlace: place },
    cardDaFrente: () => card, fotosDoCard: new Function('return ' + fatiar('fotosDoCard'))(),
    urlDaFoto: (u) => u + '?w=7', Image, dfato: (k) => diario.push(k), showCurrentPlace: () => redesenhos.push(1),
    mantendoFocoNoCard: (redesenhar, opcoes) => { focos.push(opcoes); redesenhar(); },
    cardSobGesto: (c) => estado.gesto && c === card,
    fetch, FOTO_SONDA_TETO_MS: 30, FOTO_PROVA_TETO_MS: tetoProva,
    // Os tetos não seguram o processo do teste depois do fim (a prova que o
    // teste deixa no ar estoura sozinha, sem ninguém olhando).
    setTimeout: (fn, ms) => { const h = setTimeout(fn, ms); if (h && h.unref) h.unref(); return h; },
  };
  const chaves = Object.keys(deps);
  const { recuperar, adiado } = new Function(...chaves, 'let provandoFotoDe = null, redesenhoDoCardAdiado = null;\n'
    + fatiar('recuperarCardSemFoto')
    + '\nasync ' + fatiar('fotoServidorResponde')
    + '\n' + fatiar('redesenharCardAdiado')
    + '\nreturn { recuperar: recuperarCardSemFoto, adiado: redesenharCardAdiado };')(...chaves.map((k) => deps[k]));
  // O fim do gesto, como o swipe.js o avisa (o `aoFimDoGesto` chama o redesenho adiado).
  const fimDoGesto = () => { estado.gesto = false; adiado(); };
  return { recuperar, redesenhos, provas, sondas, diario, focos, deps, card, estado, fimDoGesto, adiado };
}
// A sonda é assíncrona: deixa as promessas (e o teto, quando pendura) assentarem.
const assentar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('card "sem foto": a rede voltando e a foto carregando REDESENHAM o card', () => {
  const m = montarRecuperacao();
  m.recuperar();
  assert.equal(m.provas.length, 1, 'ninguém buscou a foto de novo');
  assert.equal(m.provas[0].src, 'https://venue-image.waze.com/ur1?w=7', 'provou a foto errada (tem que ser a EM DECISÃO, pela urlDaFoto)');
  m.recuperar();
  assert.equal(m.provas.length, 1, 'uma prova em voo: a segunda chamada não prova de novo');
  m.provas[0].onload();
  assert.equal(m.redesenhos.length, 1, 'a foto chegou e o card seguiu travado');
});

test('card "sem foto": a foto que ainda FALHA, com a rede SEM passar, não redesenha (senão "Sem Imagem" com ✕ e ✓ vivos)', async () => {
  const m = montarRecuperacao();   // o servidor da foto também não responde: a rede não passa
  m.recuperar();
  m.provas[0].onerror();
  await assentar();
  assert.equal(m.sondas.length, 1, 'PRÉ-CONDIÇÃO: a falha da foto não perguntou ao servidor dela');
  assert.equal(m.redesenhos.length, 0);
  m.recuperar();
  assert.equal(m.provas.length, 2, 'depois da falha, a próxima prova de rede não tentou de novo');
});

// ── R7-4-06: a foto que o Waze TIROU DO AR, com o sinal de volta ────────────
// Aberto sem sinal pela fila guardada, o card de foto trava ✕/✓ e diz "A foto
// precisa de sinal" (certo). Com o sinal de volta, a prova da foto dá 404 e
// nada redesenhava: o card seguia travado, dizendo que precisava de sinal, até a
// pessoa pular — o mesmo pedido aberto com sinal mostra "Sem Imagem" com ✕/✓
// vivos (MEDIDO no navegador, x6 da auditoria).
test('R7-4-06: a foto tirada do ar com a rede de volta — o servidor da foto RESPONDE e o card sai do "precisa de sinal"', async () => {
  const m = montarRecuperacao({ servidorDaFoto: 'responde' });
  m.recuperar();
  m.provas[0].onerror();                     // o 404 da foto: a <img> não distingue de falta de rede
  await assentar();
  assert.equal(m.sondas.length, 1, 'a falha da foto não perguntou ao servidor dela se a rede passa');
  assert.equal(m.sondas[0].u, 'https://venue-image.waze.com/ur1?w=7', 'a sonda perguntou por outra foto que não a EM DECISÃO');
  assert.equal(m.sondas[0].opcoes.mode, 'no-cors', 'o CDN da foto não manda CORS: a sonda tem que ir sem');
  assert.equal(m.sondas[0].opcoes.cache, 'no-store', 'a sonda tem que perguntar à REDE, e não guardar nada');
  assert.equal(m.redesenhos.length, 1, 'o servidor da foto respondeu e o card seguiu travado dizendo que precisa de sinal');
  assert.deepEqual(m.diario, ['foto.falhouComRede']);
  // E a prova se solta: a próxima tenta de novo (o card redesenhado pode travar de novo, se a rede cair).
  m.recuperar();
  assert.equal(m.provas.length, 2);
});

test('R7-4-06: com a rede PROVADA por uma resposta nossa, a foto que falha redesenha sem sondar ninguém', async () => {
  // A rede já provada no começo nem prova a foto (R9-4-06, o teste abaixo): redesenha, sem sonda.
  const m = montarRecuperacao();
  m.recuperar({ redeProvada: true });
  await assentar();
  assert.equal(m.redesenhos.length, 1, 'a resposta nossa provou a rede, e o card seguiu travado');
  assert.equal(m.sondas.length, 0, 'com a rede já provada, a sonda gastou um pedido à toa');
  // A rede provada que chega DURANTE uma prova vale pra ela.
  const d = montarRecuperacao();
  d.recuperar();
  d.recuperar({ redeProvada: true });
  assert.equal(d.provas.length, 1, 'a rede provada abriu uma segunda prova em vez de valer pra que estava no ar');
  d.provas[0].onerror();
  await assentar();
  assert.equal(d.redesenhos.length, 1, 'a rede provada durante a prova se perdeu');
  assert.equal(d.sondas.length, 0, 'com a rede provada durante a prova, a sonda gastou um pedido à toa');
  // CONTROLE: a foto que CHEGA (a prova do `online`) segue redesenhando pelo caminho de sempre.
  const ok = montarRecuperacao();
  ok.recuperar();
  ok.provas[0].onload();
  assert.deepEqual([ok.redesenhos.length, ok.diario], [1, ['foto.voltou']]);
});

// ── R9-4-06: a rede provada ANTES de a prova da foto começar ─────────────────
// É o caminho do lie-fi: o `onLine` segue verdadeiro, e a PRIMEIRA resposta nossa
// (o `aoProvarRede`) é quem chama a recuperação, já com a rede provada. Ela
// começava uma prova da <img> mesmo assim, e com o 1º pedido à foto pendurado o
// card ficava com "A foto precisa de sinal" e ✕/✓ travados até o teto — MEDIDO no
// navegador (n4 da auditoria da rodada 9): 10,1 s; a mesma rede provada chegando
// com a prova já no ar soltava em 11 ms (R8-4-08).
test('R9-4-06: a rede já PROVADA quando a prova nem começou redesenha NA HORA — sem esperar a <img> pendurada', async () => {
  const m = montarRecuperacao({ tetoProva: 60 });
  m.recuperar({ redeProvada: true });         // a resposta nossa chega; a foto pendura (ninguém responde)
  assert.equal(m.redesenhos.length, 1,
    'a rede já provada esperou a prova da <img> — o card segue travado até o teto (10 s no app)');
  assert.deepEqual(m.diario, ['foto.redeProvada']);
  assert.equal(m.provas.length, 0, 'com a rede já provada, a prova da <img> saiu à toa (o card redesenhado pede a foto ele mesmo)');
  await assentar(120);                        // passa do teto de mentira: nada mais acontece
  assert.deepEqual([m.redesenhos.length, m.sondas.length], [1, 0], 'o redesenho repetiu, ou a sonda gastou um pedido à toa');
  // O redesenho passa pelo foco do card (R8-4-03): o ↑ do teclado no card novo.
  assert.deepEqual(m.focos, [{ mesmoBotao: true }]);
  // CONTROLE: no meio de um arraste, não mexe — o redesenho espera o gesto acabar (R10-4-01).
  const a = montarRecuperacao({ transform: 'translate(40px, 0px) rotate(3deg)', gesto: true });
  a.recuperar({ redeProvada: true });
  assert.deepEqual([a.redesenhos.length, a.provas.length], [0, 0], 'arrancou o card de debaixo do dedo');
  // CONTROLE: sem a rede provada (o `online`, que chega antes do sinal), a foto segue PROVADA antes.
  const o = montarRecuperacao();
  o.recuperar();
  assert.deepEqual([o.redesenhos.length, o.provas.length], [0, 1], 'o `online` sozinho soltou o card — sem prova de que a rede anda');
});

test('R7-4-06: o servidor da foto PENDURADO — o teto solta a prova, e o card segue travado', async () => {
  const m = montarRecuperacao({ servidorDaFoto: 'pendura' });
  m.recuperar();
  m.provas[0].onerror();
  await assentar(80);                        // passa do teto de mentira (30 ms)
  assert.equal(m.redesenhos.length, 0, 'rede pendurada contou como rede que anda');
  m.recuperar();
  assert.equal(m.provas.length, 2, 'a sonda pendurada prendeu a recuperação pra sempre');
});

// ── R8-4-08: a prova da foto PENDURADA com a rede já provada ────────────────
// O `online` abre a prova da <img>; o 1º pedido à foto fica pendurado (a conexão
// que não responde logo depois de o sinal voltar). Uma resposta NOSSA chega e
// prova a rede — e era só ANOTADA na prova: o card seguia com "A foto precisa de
// sinal" e ✕/✓ travados até a prova terminar, e ela não tinha teto (MEDIDO, r8 da
// auditoria: travado 12 s depois da volta; soltando o pedido preso, 86 ms).
test('R8-4-08: a rede PROVADA com a prova da <img> no ar redesenha NA HORA — sem esperar o desfecho dela', async () => {
  const d = montarRecuperacao();
  d.recuperar();                          // o `online`: a prova sai, e a <img> fica no ar
  d.recuperar({ redeProvada: true });     // a resposta nossa chega
  assert.equal(d.provas.length, 1, 'a rede provada abriu uma segunda prova em vez de valer pra que estava no ar');
  assert.equal(d.redesenhos.length, 1, 'a rede provada esperou a prova pendurada — o card segue travado com a rede de volta');
  assert.deepEqual(d.diario, ['foto.redeProvada']);
  assert.equal(d.sondas.length, 0, 'com a rede já provada, a sonda gastou um pedido à toa');
  // O desfecho TARDIO da prova não mexe no card de novo (nem pergunta ao servidor).
  d.provas[0].onerror();
  await assentar(80);
  assert.deepEqual([d.redesenhos.length, d.sondas.length], [1, 0], 'o desfecho tardio da prova redesenhou de novo');
  // A rede provada no meio da SONDA (a <img> falhou e o servidor da foto pendura) também não espera.
  const s = montarRecuperacao({ servidorDaFoto: 'pendura' });
  s.recuperar();
  s.provas[0].onerror();
  s.recuperar({ redeProvada: true });
  assert.equal(s.redesenhos.length, 1, 'a rede provada esperou a sonda pendurada');
  await assentar(80);
  assert.equal(s.redesenhos.length, 1, 'a sonda que voltou depois redesenhou de novo');
});

test('R8-4-08: a prova da <img> tem TETO — estourado, conta como falha (e o card não fica preso a ela)', async () => {
  // A <img> nunca responde; o servidor da foto RESPONDE à sonda: a rede anda.
  const m = montarRecuperacao({ servidorDaFoto: 'responde', tetoProva: 30 });
  m.recuperar();
  await assentar(90);
  assert.equal(m.sondas.length, 1, 'a prova pendurada não contou como falha no teto — ninguém perguntou ao servidor da foto');
  assert.equal(m.redesenhos.length, 1, 'com o servidor da foto respondendo, o card seguiu preso à prova pendurada');
  assert.deepEqual(m.diario, ['foto.provaSemResposta', 'foto.falhouComRede']);
  // CONTROLE: a rede não passa (a sonda falha) — nada redesenha, mas a prova SOLTA: a próxima tenta de novo.
  const c = montarRecuperacao({ servidorDaFoto: 'falha', tetoProva: 30 });
  c.recuperar();
  await assentar(90);
  assert.equal(c.redesenhos.length, 0, 'a prova pendurada, com a rede sem passar, contou como rede que anda');
  // A falha que a <img> der DEPOIS do teto já foi contada: não pergunta ao servidor de novo.
  c.provas[0].onerror();
  await assentar();
  assert.equal(c.sondas.length, 1, 'a falha tardia da prova, depois do teto, perguntou ao servidor da foto outra vez');
  c.recuperar();
  assert.equal(c.provas.length, 2, 'a prova pendurada prendeu a recuperação pra sempre');
  // A rede provada DURANTE a prova pendurada: redesenha na hora, e o teto que vem
  // depois não sonda nem redesenha de novo.
  const p = montarRecuperacao({ tetoProva: 30 });
  p.recuperar();
  p.recuperar({ redeProvada: true });
  await assentar(90);
  assert.deepEqual([p.redesenhos.length, p.sondas.length], [1, 0]);
  // CONTROLE: a prova que RESPONDE antes do teto não ganha falha no teto.
  const r = montarRecuperacao({ tetoProva: 30 });
  r.recuperar();
  r.provas[0].onload();
  await assentar(90);
  assert.deepEqual([r.redesenhos.length, r.sondas.length, r.diario], [1, 0, ['foto.voltou']]);
});

// ── R8-4-03: o teclado no ↑ do card "sem foto" quando o sinal volta ─────────
// O ↑ é o único botão vivo do card sem a foto, e o teclado está nele. O sinal
// volta, o card é REDESENHADO, e o foco caía no <body> (MEDIDO, r4 da auditoria,
// com a foto que volta e com a que o Waze tirou do ar). O redesenho passa pelo
// `mantendoFocoNoCard`, com o foco indo ao MESMO botão do card novo (ver
// `test/lightbox-foco-card.test.mjs`).
test('R8-4-03: o redesenho do card "sem foto" passa pelo foco do card — o mesmo botão no card novo', async () => {
  for (const [nome, fazer] of [['a foto que volta', (m) => { m.recuperar(); m.provas[0].onload(); }],
    ['a foto tirada do ar, com a rede provada na prova', (m) => { m.recuperar(); m.recuperar({ redeProvada: true }); m.provas[0].onerror(); }],
    ['a rede já provada (R9-4-06)', (m) => m.recuperar({ redeProvada: true })]]) {
    const m = montarRecuperacao();
    fazer(m);
    await assentar();
    assert.equal(m.redesenhos.length, 1, `${nome}: PRÉ-CONDIÇÃO, o card não foi redesenhado`);
    assert.deepEqual(m.focos, [{ mesmoBotao: true }],
      `${nome}: o redesenho do card "sem foto" não passou pelo foco do card (o ↑ do teclado cai no <body>)`);
  }
});

test('R7-4-06: o host da foto está no `connect-src` das TRÊS cópias da CSP (sem isso a sonda nunca responde)', () => {
  // A sonda é um `fetch` (destino '' → `connect-src`, não `img-src`): barrada
  // pela CSP, ela falha ANTES da rede, e o card voltaria a ficar travado calado.
  const CORE = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
  const base = /^const WAZE_IMAGE_BASE = '([^']+)';/m.exec(CORE);
  assert.ok(base, 'a base das fotos sumiu do core');
  const host = new URL(base[1]).origin;
  const copias = {
    _headers: readFileSync(new URL('../_headers', import.meta.url), 'utf8'),
    'index.src.html': readFileSync(new URL('../index.src.html', import.meta.url), 'utf8'),
    'server/node.mjs': readFileSync(new URL('../server/node.mjs', import.meta.url), 'utf8'),
  };
  for (const [onde, txt] of Object.entries(copias)) {
    // Pela FORMA da diretiva de verdade (só ela começa com 'self'), não pela menção num comentário (gotcha #67.1).
    const m = /connect-src 'self'([^;"]*);/.exec(txt);
    assert.ok(m, `não achei o connect-src em ${onde}`);
    assert.ok(m[1].split(/\s+/).includes(host), `${host} saiu do connect-src em ${onde}`);
  }
});

test('card "sem foto": sem rede, sem o aviso, com o card trocado ou no meio do arraste, não mexe', () => {
  const sem = montarRecuperacao({ online: false });
  sem.recuperar();
  assert.equal(sem.provas.length, 0);
  const normal = montarRecuperacao({ semFoto: false });
  normal.recuperar();
  assert.equal(normal.provas.length, 0, 'provou foto de card que não estava sem foto');
  const trocou = montarRecuperacao();
  trocou.recuperar();
  trocou.deps.AppState.currentPlace = { venueID: 'outro' };
  trocou.provas[0].onload();
  assert.equal(trocou.redesenhos.length, 0, 'redesenhou o card de OUTRO pedido');
  const arrastando = montarRecuperacao({ transform: 'translate(40px, 0px) rotate(3deg)', gesto: true });
  arrastando.recuperar();
  arrastando.provas[0].onload();
  assert.equal(arrastando.redesenhos.length, 0, 'arrancou o card de debaixo do dedo');
});

// ── R10-4-01: o card de foto que a pessoa TENTOU ARRASTAR ───────────────────
// Com ✕ e ✓ apagados, tentar arrastar o card é a reação natural; a direção está
// travada e ele volta pro lugar — e a volta deixa `translate(0, 0) rotate(0deg)`
// ESCRITO no card. As duas saídas da recuperação tomavam qualquer `transform`
// como "arraste em curso" e desistiam, prometendo que "a próxima prova de rede
// tenta de novo": no modo avião a prova da foto CARREGAVA e o card seguia
// travado; no lie-fi nenhuma prova saía (MEDIDO, n23 e n4b da auditoria da
// rodada 10: 15 s travado, nos dois motores; sem o arraste, 105 e 7 ms). Quem diz
// se há gesto é o swipe.js, por sinal positivo (`gestoNoCard`), e o redesenho
// que o encontra ESPERA o fim dele.
test('R10-4-01: o card que VOLTOU pro lugar (o transform de repouso escrito) sai do "precisa de sinal" com a rede de volta', () => {
  const REPOUSO = 'translate(0px, 0px) rotate(0deg)';
  // O lie-fi: a rede já provada (a resposta nossa).
  const liefi = montarRecuperacao({ transform: REPOUSO });
  liefi.recuperar({ redeProvada: true });
  assert.deepEqual([liefi.redesenhos.length, liefi.diario], [1, ['foto.redeProvada']],
    'o card que a pessoa tentou arrastar (e voltou pro lugar) seguiu travado com a rede provada');
  // O modo avião: o `online` e a prova da foto que carrega.
  const aviao = montarRecuperacao({ transform: REPOUSO });
  aviao.recuperar();
  aviao.provas[0].onload();
  assert.deepEqual([aviao.redesenhos.length, aviao.diario], [1, ['foto.voltou']],
    'o card que a pessoa tentou arrastar (e voltou pro lugar) seguiu travado com a foto chegando');
});

test('R10-4-01: com o gesto NO card, o redesenho espera o fim dele — e acontece uma vez, quando ele acaba', () => {
  // A rede provada chega com o dedo no card (o n4b `arraste` da auditoria).
  const m = montarRecuperacao({ transform: 'translate(80px, 0px) rotate(8deg)', gesto: true });
  m.recuperar({ redeProvada: true });
  assert.equal(m.redesenhos.length, 0, 'arrancou o card de debaixo do dedo');
  m.fimDoGesto();
  assert.deepEqual([m.redesenhos.length, m.diario, m.focos], [1, ['foto.redeProvada'], [{ mesmoBotao: true }]],
    'o gesto acabou e o card seguiu travado — a rede provada no meio dele se perdeu');
  m.fimDoGesto();
  assert.equal(m.redesenhos.length, 1, 'o fim de outro gesto redesenhou o card de novo');
  // A prova da foto que CARREGA no meio do gesto (o `online` do modo avião).
  const p = montarRecuperacao({ gesto: true });
  p.recuperar();
  p.provas[0].onload();
  assert.equal(p.redesenhos.length, 0, 'arrancou o card de debaixo do dedo');
  p.fimDoGesto();
  assert.deepEqual([p.redesenhos.length, p.diario], [1, ['foto.voltou']], 'a foto que chegou no meio do gesto se perdeu');
  // Um gesto NOVO começou antes de o anterior avisar o fim: segue esperando.
  const n = montarRecuperacao({ gesto: true });
  n.recuperar({ redeProvada: true });
  n.adiado();                                     // o aviso chega com o gesto ainda no card
  assert.equal(n.redesenhos.length, 0, 'redesenhou com um gesto novo no card');
  n.fimDoGesto();
  assert.equal(n.redesenhos.length, 1, 'o fim do gesto novo não atendeu o redesenho que esperava');
  // CONTROLES: o card trocou, ou a rede caiu, enquanto o gesto durava — nada se redesenha.
  const trocou = montarRecuperacao({ gesto: true });
  trocou.recuperar({ redeProvada: true });
  trocou.deps.AppState.currentPlace = { venueID: 'outro' };
  trocou.fimDoGesto();
  assert.equal(trocou.redesenhos.length, 0, 'redesenhou o card de OUTRO pedido');
  const caiu = montarRecuperacao({ gesto: true });
  caiu.recuperar({ redeProvada: true });
  caiu.deps.navigator.onLine = false;
  caiu.fimDoGesto();
  assert.equal(caiu.redesenhos.length, 0, 'redesenhou sem rede — a foto falharia de novo, com ✕ e ✓ travados outra vez');
});

// ── R10-4-03: a prova de rede que chega DURANTE o esvaziamento da fila de saída ──
// O `API.aoProvarRede` sai cedo com a fila de saída esvaziando (não retentar na
// hora, não varrer o offline no meio). A recuperação do card "sem foto" morava
// DEPOIS dessa saída: no lie-fi com uma decisão esperando envio, a resposta do
// perfil chegava no meio do esvaziamento, era engolida, e o fim do esvaziamento
// não chama nada — o card seguia com "A foto precisa de sinal" e ✕/✓ travados
// (MEDIDO no navegador, n14 da auditoria: 15,9 s e contando; o controle sem a
// fila de saída, 8 ms). Aqui o CORPO de verdade do gancho roda, com o resto do
// app de mentira, nas duas situações.
function rodarProvaDeRede({ esvaziando, notaAntes = false }) {
  const ini = APP_SEM.indexOf('API.aoProvarRede = () => {');
  assert.ok(ini >= 0, 'o gancho da prova de rede sumiu do app.js');
  const corpo = APP_SEM.slice(ini, APP_SEM.indexOf('\n};', ini) + 3);
  const chamou = [];
  let estado = null;
  const deps = {
    esvaziarFilaDeSaida: () => chamou.push('esvaziar'),
    offlineTalvezVarrer: () => chamou.push('varrer'),
    refazerPerfilSeFaltar: () => chamou.push('perfil'),
    presencaWmeRefazerDesligar: () => chamou.push('desligarWme'),
    // O redesenho do card lê a marca do lie-fi: ela já tem que estar apagada.
    recuperarCardSemFoto: (o) => chamou.push(['card', o, estado()]),
    window: { Presenca: { aoProvarRede: () => chamou.push('presenca') } },
  };
  const chaves = Object.keys(deps);
  const api = new Function(...chaves, `let buscaSemResposta = true; let esvaziandoSaida = ${esvaziando};
    let provaNoEsvaziamento = ${notaAntes};
    const API = {};
    ${corpo}
    return { API, estado: () => ({ buscaSemResposta }), nota: () => provaNoEsvaziamento };`)(...chaves.map((k) => deps[k]));
  estado = api.estado;
  api.API.aoProvarRede('perfil');
  chamou.nota = api.nota();
  return chamou;
}

// Desde a rodada 11 (R11-4-01) os três ganchos de TETO PRÓPRIO — o perfil que
// faltou, o "invisível" do WME pendente e o token do tempo real — também rodam no
// meio do esvaziamento: nenhum disputa a fila de saída, e nada mais os chamava
// depois dele. O que segue fora é o que disputa: retentar a fila (o esvaziamento
// de novo) e a varredura do offline, que fica ANOTADA pro fim dele.
test('R10-4-03 + R11-4-01: a prova de rede no MEIO do esvaziamento solta o card "sem foto" e roda os ganchos de teto próprio — nada que dispute a banda', () => {
  const durante = rodarProvaDeRede({ esvaziando: true });
  assert.deepEqual(durante.filter((x) => Array.isArray(x)), [['card', { redeProvada: true }, { buscaSemResposta: false }]],
    'a prova que chegou com a fila de saída esvaziando não soltou o card de foto (ou soltou com a marca do lie-fi ainda acesa)');
  assert.deepEqual(durante.filter((x) => typeof x === 'string'), ['perfil', 'desligarWme', 'presenca'],
    'no meio do esvaziamento, a prova engoliu um gancho de teto próprio (o perfil que faltou, o "invisível" do WME, o token '
    + 'do tempo real) — ou acordou o que tem que esperar o fim dele (o esvaziamento de novo, a varredura do offline)');
  assert.equal(durante.nota, true, 'a prova engolida não ficou anotada: o fim do esvaziamento não vai varrer o offline');
  // CONTROLE: sem esvaziamento no ar, a prova faz tudo o que sempre fez — e o card também.
  const fora = rodarProvaDeRede({ esvaziando: false });
  assert.deepEqual(fora.filter((x) => typeof x === 'string'), ['perfil', 'desligarWme', 'presenca', 'esvaziar', 'varrer']);
  assert.deepEqual(fora.filter((x) => Array.isArray(x)), [['card', { redeProvada: true }, { buscaSemResposta: false }]]);
  assert.equal(fora.nota, false, 'a prova que varre na hora deixou a nota de pé (uma segunda varredura no fim)');
  // A nota que ficou de uma prova engolida antes (o fim daquele esvaziamento não
  // a alcançou): esta prova varre na hora, e a leva junto — sem ela, a fila vazia
  // a atenderia no `esvaziarFilaDeSaida` E esta varreria de novo, e a segunda
  // chamada com a varredura no ar pede outra inteira no fim dela.
  const comNota = rodarProvaDeRede({ esvaziando: false, notaAntes: true });
  assert.deepEqual([comNota.filter((x) => x === 'varrer').length, comNota.nota], [1, false],
    'a prova fora do esvaziamento deixou a nota antiga de pé: a fila vazia a atende e a varredura sai duas vezes');
});

// ── R11-4-01: o esvaziamento de VERDADE, com as respostas provando a rede ──
// A composição: o `esvaziarFilaDeSaida`, o corpo do `API.aoProvarRede` e o
// `atenderProvaDoEsvaziamento` de verdade, e uma rede de mentira que faz o que o
// `_post` faz — a resposta que CHEGA chama a prova de rede antes de voltar a
// quem pediu. O caso MEDIDO no navegador (n26 da auditoria da rodada 11): a
// abertura sem rede não trouxe o perfil, duas decisões esperavam envio, a rede
// voltou pelo `online`, o esvaziamento as mandou — e o perfil seguia `null` 3 s
// depois do fim, porque as duas respostas eram as únicas provas de rede e foram
// engolidas. Cada chamada anota se o esvaziamento estava no ar naquela hora.
// O `fatiar` deste arquivo começa na palavra `function`: o `async` de quem tem
// fica de fora, e o `await` de dentro não compila.
function fatiarComAsync(nome) {
  const i = APP_SEM.indexOf('function ' + nome + '(');
  return (APP_SEM.slice(i - 6, i) === 'async ' ? 'async ' : '') + fatiar(nome);
}
function esvaziamentoComProvas({ itens = ['v1', 'v2'], durante = null } = {}) {
  const marca = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')()('tok');
  const guardado = new Map([
    ['waze_places_saida', JSON.stringify(itens.map((v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v, conta: '1', s: marca, regiao: 'row' })))],
    ['waze_places_conta', JSON.stringify({ id: '1', s: marca })],
  ]);
  const chamou = [];
  let h = null;
  const anota = (nome) => () => chamou.push([nome, h.estado().esvaziando]);
  const deps = {
    AppState: { authenticated: true, profile: null, stats: { read: 0, rejected: itens.length, skipped: 0 } },
    safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
    navigator: { onLine: true }, epocaDaSessao: 0,
    CONTA_KEY: 'waze_places_conta', SAIDA_KEY: 'waze_places_saida', SAIDA_RITMO_MS: 0,
    SAIDA_RECUO_401_MS: [0, 15000, 60000, 300000], SAIDA_TENTATIVAS_POR_ITEM: 3,
    ABA_DESTA_PAGINA: 'aba-teste', SAIDA_REIVINDICACAO_MS: 60000,
    travaDaSaida: async () => ({ reserva: false, soltar() {} }),
    registrarPousoDeSaida: () => {}, handleUnauthorized: () => {}, updateInFlightIndicator: () => {},
    updateStats: () => {}, saveStats: () => {}, dfato: () => {}, showToast: () => {}, t: (k) => k,
    // O ritmo entre itens é uma volta do laço de eventos, como o `setTimeout` de verdade.
    setTimeout: (f) => setImmediate(f), setImmediate,
    recuperarCardSemFoto: anota('card'),
    refazerPerfilSeFaltar: anota('perfil'),
    presencaWmeRefazerDesligar: anota('desligarWme'),
    offlineTalvezVarrer: anota('varrer'),
    window: { Presenca: { aoProvarRede: anota('presenca') } },
    durante: durante || (() => {}),
  };
  const ini = APP_SEM.indexOf('API.aoProvarRede = () => {');
  assert.ok(ini >= 0, 'o gancho da prova de rede sumiu do app.js');
  const prova = APP_SEM.slice(ini, APP_SEM.indexOf('\n};', ini) + 3);
  const nomes = ['marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido', 'marcarNaSaida',
    'moverProFimDaSaida', 'sessaoVivaDepoisDe', 'recuarSaida', 'saidaEmRecuo', 'reivindicadoPorOutraAba',
    'esvaziarFilaDeSaida', 'atenderProvaDoEsvaziamento'];
  const chaves = Object.keys(deps);
  h = new Function(...chaves, `
    let esvaziandoSaida = false, saidaPedidaDeNovo = false, saidaEsperandoConta = false, verificandoSessao = false,
      ultimaEscritaOkEm = 0, buscaSemResposta = false, provaNoEsvaziamento = false;
    let sessaoVivaEm = { s: null, em: 0 }, saidaRecuo = { s: null, n: 0, ate: 0 };
    const pedidosEmAndamento = new Set();
    const enviados = [];
    // O _post: a resposta leva uma volta de rede, e a que CHEGA prova a rede
    // ANTES de voltar a quem a pediu.
    const responder = async (v) => {
      enviados.push(v);
      await new Promise((ok) => setImmediate(ok));
      durante(v, esvaziarFilaDeSaida);
      API.aoProvarRede();
      return { success: true };
    };
    const API = { getSession: () => 'tok', get sessionToken() { return 'tok'; }, rejectPlace: (v) => responder(v), markAsRead: (v) => responder(v) };
    ${prova}
    ${nomes.map(fatiarComAsync).join('\n')}
    return { esvaziarFilaDeSaida, API, enviados, fila: carregarFilaDeSaida,
             estado: () => ({ esvaziando: esvaziandoSaida, nota: provaNoEsvaziamento }) };`)(...chaves.map((k) => deps[k]));
  return { h, chamou };
}
const nomesDe = (chamou, noAr) => chamou.filter(([, e]) => e === noAr).map(([n]) => n);

test('R11-4-01: as respostas do esvaziamento pedem o perfil que faltou (e os outros ganchos de teto próprio) — e a varredura do offline sai no FIM, uma vez', async () => {
  const m = esvaziamentoComProvas();
  await m.h.esvaziarFilaDeSaida();
  assert.deepEqual([m.h.enviados, m.h.fila().length], [['v1', 'v2'], 0], 'PRÉ-CONDIÇÃO: o esvaziamento não mandou as duas decisões');
  const noAr = nomesDe(m.chamou, true);
  for (const gancho of ['perfil', 'desligarWme', 'presenca']) {
    assert.equal(noAr.filter((n) => n === gancho).length, 2,
      `DEFEITO: as duas respostas do esvaziamento não chamaram "${gancho}" — com a rede voltando pelo \`online\` e decisões `
      + `esperando envio, elas são as únicas provas de rede, e nada mais o chama depois (${JSON.stringify(m.chamou)})`);
  }
  assert.ok(!noAr.includes('varrer'), 'a varredura do offline saiu no MEIO do esvaziamento — disputa a banda da rede que acabou de voltar');
  assert.deepEqual(m.chamou.filter(([n]) => n === 'varrer'), [['varrer', false]],
    'o FIM do esvaziamento não varreu o offline pela prova engolida (ou varreu mais de uma vez)');
  assert.equal(m.h.estado().nota, false, 'a nota da prova engolida ficou de pé depois de atendida');
});

test('R11-4-01: o gatilho pedido no MEIO acha a fila vazia — a prova engolida é atendida ali, sem passada nenhuma', async () => {
  // O `online` (ou o perfil chegando) pede outro esvaziamento com este no ar
  // (`saidaPedidaDeNovo`); o primeiro manda tudo, e o pedido acha a fila VAZIA.
  // A nota não pode ficar esperando um esvaziamento que não vem.
  let pediu = false;
  const m = esvaziamentoComProvas({ durante: (v, esvaziar) => { if (!pediu) { pediu = true; esvaziar(); } } });
  await m.h.esvaziarFilaDeSaida();
  await new Promise((ok) => setImmediate(ok));
  assert.ok(pediu, 'PRÉ-CONDIÇÃO: o gatilho do meio não aconteceu');
  assert.deepEqual(m.chamou.filter(([n]) => n === 'varrer'), [['varrer', false]],
    'a passada pedida no meio achou a fila vazia e a prova engolida ficou sem a varredura');
  assert.equal(m.h.estado().nota, false);
});

test('R11-4-01 CONTROLE: sem nada esperando envio, a resposta varre NA HORA e roda os ganchos — uma vez cada', () => {
  // O caminho de sempre (nenhum esvaziamento no ar): sem este, "varre só no fim"
  // passaria com a varredura morta em todo caminho.
  const m = esvaziamentoComProvas({ itens: [] });
  m.h.API.aoProvarRede();
  assert.deepEqual(m.chamou.map(([n]) => n), ['card', 'perfil', 'desligarWme', 'presenca', 'varrer']);
  assert.equal(m.h.estado().nota, false);
});

// ── R12-4-03 (auditoria da rodada 12): a varredura DUPLA no `online` ─────────
// O incompleto do R11-4-01. Com a rede voltando pelo `online`, decisões
// esperando envio e a janela do offline vencida, o FIM do esvaziamento varre pela
// prova engolida (`atenderProvaDoEsvaziamento`) — e o ouvinte do `online`, logo
// depois, pedia OUTRA com ela no ar (`offlinePedidaDeNovo`): uma passada inteira
// a mais, com a fila regravada, a janela e a poda refeitas e `offline.gravou`/
// `offline.pronto` duas vezes no diário (MEDIDO no navegador, n1 da auditoria:
// duas varreduras começavam; na base anterior ao R11-4-01, uma). Aqui roda tudo
// de VERDADE, no mesmo escopo: o ouvinte do `online`, o esvaziamento com as
// respostas provando a rede, a prova engolida, e a varredura com o estado dela
// (só o que ela grava e baixa é de mentira). A varredura que COMEÇA grava a fila.
function ouvinteDoOnline() {
  const i = APP_SEM.indexOf("window.addEventListener('online', async () => {");
  assert.ok(i >= 0, 'o ouvinte do `online` que esvazia a fila de saída sumiu');
  const a = APP_SEM.indexOf('async () => {', i);
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', a); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) return APP_SEM.slice(a, j + 1);
  }
  throw new Error('o ouvinte do `online` não fechou');
}
const CICLO_DO_OFFLINE = /^const OFFLINE_CICLO_MS = ([^;]+);/m.exec(APP_SEM)[1].split('*')
  .reduce((a, b) => a * Number(b.trim()), 1);
function onlineComVarredura({ itens = ['v1', 'v2'] } = {}) {
  const marca = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')()('tok');
  const guardado = new Map([
    ['waze_places_saida', JSON.stringify(itens.map((v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v, conta: '1', s: marca, regiao: 'row' })))],
    ['waze_places_conta', JSON.stringify({ id: '1', s: marca })],
  ]);
  const diario = [];
  const comecaram = [];   // cada varredura que COMEÇOU (a fila gravada no começo dela)
  const umaVolta = () => new Promise((ok) => setImmediate(ok));
  const deps = {
    AppState: { authenticated: true, profile: { id: 1 }, loadError: false, fetching: false,
                queue: [{ venueID: 'q1', updateRequestID: 'uq1' }], stats: { read: 0, rejected: itens.length, skipped: 0 } },
    safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
    navigator: { onLine: true }, epocaDaSessao: 0,
    CONTA_KEY: 'waze_places_conta', SAIDA_KEY: 'waze_places_saida', SAIDA_RITMO_MS: 0,
    SAIDA_RECUO_401_MS: [0, 15000, 60000, 300000], SAIDA_TENTATIVAS_POR_ITEM: 3,
    ABA_DESTA_PAGINA: 'aba-teste', SAIDA_REIVINDICACAO_MS: 60000,
    travaDaSaida: async () => ({ reserva: false, soltar() {} }),
    registrarPousoDeSaida: () => {}, handleUnauthorized: () => {}, updateInFlightIndicator: () => {},
    updateStats: () => {}, saveStats: () => {}, dfato: (k) => diario.push(k), showToast: () => {}, t: (k) => k,
    setTimeout: (f) => setImmediate(f), setImmediate,
    recuperarCardSemFoto: () => {}, refazerPerfilSeFaltar: () => {}, presencaWmeRefazerDesligar: () => {},
    window: { Presenca: { aoProvarRede: () => {} } },
    retomarBusca: () => { throw new Error('a busca não falhou: o `online` não tinha o que retomar'); },
    // A varredura: o estado e as decisões de verdade; só a gravação e o download de mentira.
    Treino: { ativo: false }, offlineLigado: () => true,
    OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: CICLO_DO_OFFLINE, OFFLINE_CONCORRENCIA: 1,
    OFFLINE_ANUNCIAR_A_CADA: 50, OFFLINE_TENTATIVAS_POR_ITEM: 3,
    offlineGravarFila: async () => { comecaram.push('gravou'); await umaVolta(); return true; },
    offlineItensDaFila: async () => [{ u: 'tile-1', tile: true }],
    offlineBaixar: async () => { await umaVolta(); return true; },
    offlineSondarRede: async () => true, offlineAnunciarTiles: () => {}, atualizarLinhaDoOffline: () => {},
    offlineGravarJanela: () => {}, offlinePodarTiles: async () => 0,
  };
  const ini = APP_SEM.indexOf('API.aoProvarRede = () => {');
  assert.ok(ini >= 0, 'o gancho da prova de rede sumiu do app.js');
  const prova = APP_SEM.slice(ini, APP_SEM.indexOf('\n};', ini) + 3);
  const nomes = ['marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido', 'marcarNaSaida',
    'moverProFimDaSaida', 'sessaoVivaDepoisDe', 'recuarSaida', 'saidaEmRecuo', 'reivindicadoPorOutraAba',
    'esvaziarFilaDeSaida', 'atenderProvaDoEsvaziamento',
    'filaReal', 'offlinePrecisaVarrer', 'offlineTalvezVarrer', 'offlineVarrer'];
  const chaves = Object.keys(deps);
  const h = new Function(...chaves, `
    let esvaziandoSaida = false, saidaPedidaDeNovo = false, saidaEsperandoConta = false, verificandoSessao = false,
      ultimaEscritaOkEm = 0, buscaSemResposta = false, provaNoEsvaziamento = false;
    let sessaoVivaEm = { s: null, em: 0 }, saidaRecuo = { s: null, n: 0, ate: 0 };
    const pedidosEmAndamento = new Set();
    // A janela VENCIDA (20+ min sem rede): a varredura é devida, e a última foi pronta.
    let offlineVarrendo = false, offlinePedidaDeNovo = false, offlineUltimoGesto = Date.now(),
      offlineJanelaServida = Math.floor(Date.now() / OFFLINE_CICLO_MS) - 1, offlineUltimoResultado = 'pronto',
      offlineEpoca = 0, offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set() },
      offlineFilaPreparada = null, offlineFilaGravadaEm = null, offlineFilaVarrida = null;
    const enviados = [];
    const responder = async (v) => {
      enviados.push(v);
      await new Promise((ok) => setImmediate(ok));
      API.aoProvarRede();
      return { success: true };
    };
    const API = { getSession: () => 'tok', get sessionToken() { return 'tok'; }, rejectPlace: (v) => responder(v), markAsRead: (v) => responder(v) };
    ${prova}
    ${nomes.map(fatiarComAsync).join('\n')}
    const aoVoltarARede = ${ouvinteDoOnline()};
    return { aoVoltarARede, enviados, fila: carregarFilaDeSaida,
             estado: () => ({ varrendo: offlineVarrendo, pedida: offlinePedidaDeNovo, resultado: offlineUltimoResultado,
                              nota: provaNoEsvaziamento }) };`)(...chaves.map((k) => deps[k]));
  // Espera o FIM (nenhuma varredura no ar, nada pedido de novo), com teto (gotcha #19).
  const assentar = async () => {
    for (let i = 0; i < 400; i++) {
      await umaVolta();
      const e = h.estado();
      if (!e.varrendo && !e.pedida) return true;
    }
    return false;
  };
  return { h, diario, comecaram, assentar };
}

test('R12-4-03: a rede volta pelo `online` com decisões esperando e a janela vencida — a varredura do offline sai UMA vez', async () => {
  const m = onlineComVarredura();
  await m.h.aoVoltarARede();
  assert.ok(await m.assentar(), 'a varredura não terminou (ou ficou pedindo outra pra sempre)');
  assert.deepEqual([m.h.enviados, m.h.fila().length], [['v1', 'v2'], 0], 'PRÉ-CONDIÇÃO: o esvaziamento não mandou as duas decisões');
  assert.equal(m.h.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a varredura não terminou pronta');
  assert.equal(m.comecaram.length, 1,
    `DEFEITO: ${m.comecaram.length} varreduras começaram depois do \`online\` — o fim do esvaziamento varreu pela prova engolida `
    + 'e o ouvinte pediu outra com ela no ar (a fila regravada, a janela e a poda refeitas)');
  assert.deepEqual(m.diario.filter((k) => /^offline\./.test(k)), ['offline.pronto'],
    'o diário anotou a preparação mais de uma vez pela mesma volta da rede');
  assert.equal(m.h.estado().nota, false, 'a prova engolida ficou de pé depois de atendida');
});

test('R12-4-03 CONTROLE: sem nada esperando envio, o próprio `online` varre — uma vez', async () => {
  // Sem decisão esperando, nenhuma resposta prova a rede no esvaziamento e o fim
  // dele não varre: quem varre é o ouvinte. Sem este controle, "uma varredura só"
  // passaria com o ouvinte mudo.
  const m = onlineComVarredura({ itens: [] });
  await m.h.aoVoltarARede();
  assert.ok(await m.assentar());
  assert.equal(m.comecaram.length, 1, 'com a fila de saída vazia, o `online` não varreu o offline vencido');
  assert.equal(m.h.estado().resultado, 'pronto');
});

test('a recuperação do card "sem foto" é chamada nos DOIS sinais de rede: `online` e a resposta que chega', () => {
  // O `online` não prova a rede (chega antes de ela passar tráfego): ali quem
  // prova é a foto, ou o servidor dela. A resposta NOSSA prova (R7-4-06).
  const online = APP_SEM.slice(APP_SEM.indexOf("window.addEventListener('online', async"));
  assert.match(online.slice(0, online.indexOf('\n});')), /^\s+recuperarCardSemFoto\(\);/m);
  const prova = APP_SEM.slice(APP_SEM.indexOf('API.aoProvarRede = () => {'));
  assert.match(prova.slice(0, prova.indexOf('\n};')), /^\s+recuperarCardSemFoto\(\{ redeProvada: true \}\);/m,
    'a resposta nossa chegou e não conta como rede provada pro card "sem foto"');
});
