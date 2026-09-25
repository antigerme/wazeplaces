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
function montarRecuperacao({ online = true, semFoto = true, transform = '' } = {}) {
  const place = { venueID: 'v1', updateRequestID: 'ur1', purType: 'NEW_PHOTO', imageUrls: ['https://venue-image.waze.com/a', 'https://venue-image.waze.com/ur1'] };
  const redesenhos = [];
  const provas = [];
  const card = { style: { transform }, querySelector: (sel) => (sel === '.card-sem-foto' && semFoto ? {} : null) };
  class Image { set src(u) { this._src = u; provas.push(this); } get src() { return this._src; } }
  const deps = {
    navigator: { onLine: online }, AppState: { currentPlace: place },
    cardDaFrente: () => card, fotosDoCard: new Function('return ' + fatiar('fotosDoCard'))(),
    urlDaFoto: (u) => u + '?w=7', Image, dfato: () => {}, showCurrentPlace: () => redesenhos.push(1),
  };
  const chaves = Object.keys(deps);
  const recuperar = new Function(...chaves, 'let provandoFotoDe = null;\n' + fatiar('recuperarCardSemFoto')
    + '\nreturn recuperarCardSemFoto;')(...chaves.map((k) => deps[k]));
  return { recuperar, redesenhos, provas, deps, card };
}

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

test('card "sem foto": a foto que ainda FALHA não redesenha (senão "Sem Imagem" com ✕ e ✓ vivos)', () => {
  const m = montarRecuperacao();
  m.recuperar();
  m.provas[0].onerror();
  assert.equal(m.redesenhos.length, 0);
  m.recuperar();
  assert.equal(m.provas.length, 2, 'depois da falha, a próxima prova de rede não tentou de novo');
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
  const arrastando = montarRecuperacao({ transform: 'translate(40px, 0px) rotate(3deg)' });
  arrastando.recuperar();
  arrastando.provas[0].onload();
  assert.equal(arrastando.redesenhos.length, 0, 'arrancou o card de debaixo do dedo');
});

test('a recuperação do card "sem foto" é chamada nos DOIS sinais de rede: `online` e a resposta que chega', () => {
  const online = APP_SEM.slice(APP_SEM.indexOf("window.addEventListener('online', async"));
  assert.match(online.slice(0, online.indexOf('\n});')), /^\s+recuperarCardSemFoto\(\);/m);
  const prova = APP_SEM.slice(APP_SEM.indexOf('API.aoProvarRede = () => {'));
  assert.match(prova.slice(0, prova.indexOf('\n};')), /^\s+recuperarCardSemFoto\(\);/m);
});
