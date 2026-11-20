// A PASSAGEM do computador (v2026.11.15-04): num computador de tela larga o app mostra o QR do
// pareamento no lugar do placar e do card. Os testes RODAM o código de verdade, fatiado do
// app.js, com a tela e a rede de mentira; cada guard tem o CONTROLE (o caso vizinho que NÃO
// dispara) e foi visto REPROVANDO com a regra desfeita.
//
// O que cada um protege:
// - quando ela vale (largura, ponteiro, toque, sessão, escolha, treino);
// - o card escondido NÃO recebe decisão (a trava lê um VALOR, `AppState.passagemNaTela`);
// - o QR é credencial: só sai com um login NOVO ou no clique, e a resposta que chega tarde
//   (sessão que acabou, pedido superado) é CANCELADA no servidor em vez de desenhada;
// - o «Continuar» grava a escolha e devolve o card; o `loadPreferences` a RELÊ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}') { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
const declaracao = (re, nome) => {
  const m = re.exec(APP_SEM);
  assert.ok(m, `a declaração de ${nome} sumiu do app.js`);
  return m[0];
};
const LARGURA = declaracao(/^const PASSAGEM_LARGURA_MIN_PX = \d+;$/m, 'PASSAGEM_LARGURA_MIN_PX');

// Um elemento de mentira com classes, texto e um canvas que anota o que foi apagado.
function el(id, { oculto = false } = {}) {
  const classes = new Set(oculto ? ['hidden'] : []);
  const e = {
    id, textContent: '', disabled: false, width: 244, height: 244, dataset: {},
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c), toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); return on; } },
    focado: 0, focus() { this.focado++; },
  };
  return e;
}

// O mundo em volta: janela (largura, mouse, toque), sessão, rede de pareamento e as preferências.
function mundo({ largura = 1440, fino = true, toque = false, movel = false, authenticated = true, dispensada = false, treino = false,
  resposta = null, ativoEm = null, fila = 0 } = {}) {
  const els = {};
  for (const id of ['passagemScreen', 'passagemCorpo', 'passagemQr', 'passagemQrArea', 'passagemExpiry', 'passagemMostrar', 'passagemGerar',
    'passagemSemCamera', 'passagemPassos', 'passagemGarantia', 'passagemContinuar', 'passagemAnuncio']) els[id] = el(id, { oculto: id !== 'passagemCorpo' && id !== 'passagemQrArea' });
  els.passagemScreen = el('passagemScreen', { oculto: true });
  const log = [], pedidos = [], cancelados = [], salvou = [];
  let ticker = null;
  const janela = { largura, fino, toque };
  const html = { classes: new Set() };
  const document = {
    getElementById: (id) => els[id] || null, body: { tag: 'BODY' },
    documentElement: { classList: { toggle: (c, f) => { f ? html.classes.add(c) : html.classes.delete(c); }, remove: (c) => html.classes.delete(c), contains: (c) => html.classes.has(c) } },
  };
  document.activeElement = document.body;
  const matchMedia = (q) => {
    // `(min-width: Npx) and (hover: hover) and (pointer: fine)` e `(any-pointer: coarse)`
    if (/any-pointer: coarse/.test(q)) return { matches: janela.toque };
    const min = Number((/min-width: (\d+)px/.exec(q) || [])[1] || 0);
    return { matches: janela.largura >= min && janela.fino };
  };
  const AppState = { authenticated, passagemNaTela: false, preferences: { passagemDispensada: dispensada }, queue: new Array(fila).fill({}) };
  const deps = {
    AppState, document, matchMedia, navigator: { userAgentData: movel ? { mobile: true } : undefined },
    Treino: { ativo: treino },
    startFetching: () => log.push('busca'), maybePrefetch: () => log.push('prefetch'),
    t: (k) => k, location: { origin: 'https://places.exemplo' },
    API: {
      criarPareamento: async (a) => { pedidos.push(a); return typeof resposta === 'function' ? resposta() : (resposta || { success: true, code: 'K7QXMWR2NTBZ4PHD9CVA', expiresIn: 300 }); },
      cancelarPareamento: (c) => { cancelados.push(c); return Promise.resolve(); },
    },
    contaAgora: () => '4242', avisarFalhaDoPareamento: (r, tardio) => log.push('falha:' + (tardio ? 'tardio' : 'normal')),
    pareamentosEmitidos: { add: (c) => log.push('emitido:' + c) },
    pararTickerPareamento: () => { ticker = null; log.push('paroutick'); },
    iniciarTickerPareamento: (e, s, aoVencer) => { ticker = { e, s, aoVencer }; log.push('tick:' + s); },
    desenharQrPareamento: async (url, id) => { log.push('qr:' + id + ':' + url); },
    aplicarTravaDeAcao: () => log.push('trava'), pedirComoFuncionaAdiado: () => log.push('comoFunciona'),
    savePreferences: () => salvou.push(JSON.stringify(AppState.preferences)),
  };
  const nomes = ['computadorDeTelaLarga', 'passagemAtiva', 'limparPassagem', 'desenharPassagem', 'gerarQrDaPassagem', 'aoVencerQrDaPassagem',
    'aplicarPassagem', 'dispensarPassagem', 'retomarBuscaAdiada'];
  const chaves = Object.keys(deps);
  const fonte = [
    'let epocaDaSessao = 1;',
    'let passagemEstado = "clique", aberturaDaPassagem = 0, loginNestaPagina = false, buscaAdiadaPelaPassagem = false;',
    LARGURA,
    ...nomes.map(fatiar),
    `return { ${nomes.join(', ')}, estado: () => passagemEstado, abertura: () => aberturaDaPassagem, novoLogin: (v) => { loginNestaPagina = v; },
      loginNovo: () => loginNestaPagina, trocarEpoca: () => { epocaDaSessao++; },
      adiar: () => { buscaAdiadaPelaPassagem = true; }, adiada: () => buscaAdiadaPelaPassagem, treinoAtivo: (v) => { Treino.ativo = v; } };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  void ativoEm;
  return { app, els, AppState, log, pedidos, cancelados, salvou, janela, html, document, ticker: () => ticker };
}
const visivel = (m, id) => !m.els[id].classList.contains('hidden');
const livre = () => new Promise((r) => setTimeout(r, 0));

// ═══ quando ela vale ═══════════════════════════════════════════════════════════
test('vale só em computador: largura >= 900, mouse e NENHUM toque, com sessão, sem escolha e fora do treino', () => {
  assert.equal(mundo().app.passagemAtiva(), true, 'PRÉ-CONDIÇÃO: o computador comum não ativou');
  // Os CONTROLES, um por regra (cada um desliga só a sua):
  assert.equal(mundo({ largura: 899 }).app.passagemAtiva(), false, 'janela de 899 px não é de computador de tela larga');
  assert.equal(mundo({ largura: 900 }).app.passagemAtiva(), true, '900 px é o piso');
  assert.equal(mundo({ fino: false }).app.passagemAtiva(), false, 'sem mouse (ponteiro grosso) não é computador');
  assert.equal(mundo({ toque: true }).app.passagemAtiva(), false, 'notebook com tela de toque fica de fora, de propósito');
  assert.equal(mundo({ movel: true }).app.passagemAtiva(), false, 'o navegador que diz ser de celular nunca vê');
  assert.equal(mundo({ authenticated: false }).app.passagemAtiva(), false, 'sem sessão não há o que passar');
  assert.equal(mundo({ dispensada: true }).app.passagemAtiva(), false, 'quem escolheu continuar não vê de novo');
  assert.equal(mundo({ treino: true }).app.passagemAtiva(), false, 'o treino mostra o card: a passagem sai da frente');
  // Estrito: só `=== true` dispensa.
  for (const v of ['true', 1, 'sim', null, undefined]) {
    const m = mundo(); m.AppState.preferences.passagemDispensada = v;
    assert.equal(m.app.passagemAtiva(), true, `passagemDispensada=${JSON.stringify(v)} dispensou`);
  }
});

// ═══ ligar e desligar ══════════════════════════════════════════════════════════
test('reabertura: a tela liga SEM pedir QR (zero gravação à toa), o card trava e a classe esconde o resto', () => {
  const m = mundo();
  m.app.aplicarPassagem();
  assert.equal(m.AppState.passagemNaTela, true, 'a trava das ações lê este valor');
  assert.ok(m.html.classes.has('passagem-ativa'), 'a classe que esconde o placar e o card não foi ligada');
  assert.ok(visivel(m, 'passagemScreen'));
  assert.equal(m.app.estado(), 'clique');
  assert.deepEqual(m.pedidos, [], 'DEFEITO: a reabertura pediu um código de pareamento sem ninguém tocar');
  assert.ok(visivel(m, 'passagemMostrar') && !visivel(m, 'passagemQr') && !visivel(m, 'passagemPassos'));
  assert.ok(m.log.includes('trava'), 'o card que some tem de passar pela trava dos botões');
});

test('login NOVO: o QR já nasce pronto, UMA vez, e a bandeira é gasta', async () => {
  const m = mundo();
  m.app.novoLogin(true);
  m.app.aplicarPassagem();
  await livre(); await livre();
  assert.equal(m.pedidos.length, 1, 'DEFEITO: o login novo não pediu o QR (ou pediu mais de um)');
  assert.deepEqual(m.pedidos[0], { conta: '4242' }, 'o pedido leva a conta (o outro aparelho sabe de quem é a sessão)');
  assert.equal(m.app.estado(), 'qr');
  assert.ok(m.log.includes('emitido:K7QXMWR2NTBZ4PHD9CVA'), 'o código emitido tem de ir pro `pareamentosEmitidos` (o "Sair" o cancela)');
  assert.ok(m.log.some((x) => x === 'qr:passagemQr:https://places.exemplo/#pair=K7QXMWR2NTBZ4PHD9CVA'), 'o QR vai pro canvas DA PASSAGEM, no link de pareamento');
  assert.ok(m.log.includes('tick:300'), 'a contagem regressiva não começou');
  assert.equal(m.app.loginNovo(), false, 'a bandeira do login novo não foi gasta: o redimensionar pediria outro QR');
  // CONTROLE: reaplicar (o redimensionar, o idioma) NÃO pede de novo.
  m.app.aplicarPassagem();
  await livre();
  assert.equal(m.pedidos.length, 1, 'reaplicar a passagem pediu outro QR');
});

test('o QR vencido sai do canvas, vira "Gerar outro" e NADA se renova sozinho', async () => {
  const m = mundo();
  m.app.novoLogin(true); m.app.aplicarPassagem(); await livre(); await livre();
  const limpou = [];
  m.els.passagemQr.getContext = () => ({ clearRect: (...a) => limpou.push(a) });
  m.ticker().aoVencer();
  assert.equal(m.app.estado(), 'vencido');
  assert.equal(limpou.length, 1, 'DEFEITO: o QR vencido (credencial morta) seguiu desenhado');
  assert.ok(visivel(m, 'passagemGerar') && !visivel(m, 'passagemSemCamera'));
  assert.equal(m.els.passagemExpiry.textContent, 'passagem.vencido');
  assert.equal(m.pedidos.length, 1, 'DEFEITO: o vencimento renovou o QR sozinho (polling no free tier)');
  await m.app.gerarQrDaPassagem();
  assert.equal(m.pedidos.length, 2, '"Gerar outro código" não pediu um QR novo');
  assert.equal(m.app.estado(), 'qr');
});

test('a resposta que chega TARDE (sessão que acabou, pedido superado) é CANCELADA e nunca desenhada', async () => {
  // Sessão que acabou no meio do pedido:
  const a = mundo();
  const pendente = a.app.gerarQrDaPassagem();
  a.app.trocarEpoca();
  await pendente;
  assert.deepEqual(a.cancelados, ['K7QXMWR2NTBZ4PHD9CVA'], 'DEFEITO: o código de uma sessão que acabou não foi cancelado no servidor');
  assert.ok(!a.log.some((x) => x.startsWith('qr:')) && !a.log.some((x) => x.startsWith('emitido:')), 'a resposta tardia foi desenhada ou lembrada');
  assert.notEqual(a.app.estado(), 'qr');
  // Pedido superado por uma limpeza (o "Sair", a janela que estreita):
  const b = mundo();
  const p2 = b.app.gerarQrDaPassagem();
  b.app.limparPassagem();
  await p2;
  assert.deepEqual(b.cancelados, ['K7QXMWR2NTBZ4PHD9CVA'], 'DEFEITO: o QR superado por uma limpeza não foi cancelado');
  assert.ok(!b.log.some((x) => x.startsWith('qr:')));
  // CONTROLE: sem nada no meio, a mesma resposta é desenhada e NÃO é cancelada.
  const c = mundo();
  await c.app.gerarQrDaPassagem();
  assert.deepEqual(c.cancelados, [], 'CONTROLE: a resposta em dia foi cancelada');
  assert.ok(c.log.some((x) => x.startsWith('qr:')));
});

test('o pedido que FALHA volta ao "clique" e avisa; nunca deixa a tela em "carregando"', async () => {
  const m = mundo({ resposta: { success: false, errorCategory: 'transient' } });
  await m.app.gerarQrDaPassagem();
  assert.equal(m.app.estado(), 'clique');
  assert.ok(m.log.includes('falha:normal'), 'a falha do pedido não foi dita');
  assert.ok(visivel(m, 'passagemMostrar'), 'sem o botão a pessoa não tem como tentar de novo');
  // Sem sessão nem pede:
  const s = mundo({ authenticated: false });
  await s.app.gerarQrDaPassagem();
  assert.deepEqual(s.pedidos, [], 'sem sessão não pede QR');
});

test('"Continuar neste computador" grava a escolha, devolve o card e tira o QR da tela', async () => {
  const m = mundo();
  m.app.novoLogin(true); m.app.aplicarPassagem(); await livre(); await livre();
  m.log.length = 0;
  m.app.dispensarPassagem();
  assert.equal(m.AppState.preferences.passagemDispensada, true);
  assert.equal(m.salvou.length, 1, 'a escolha não foi gravada no aparelho');
  assert.equal(m.AppState.passagemNaTela, false);
  assert.ok(!m.html.classes.has('passagem-ativa'), 'a classe que esconde o card ficou ligada');
  assert.ok(!visivel(m, 'passagemScreen'));
  assert.equal(m.app.estado(), 'clique', 'o estado não voltou ao começo (o QR ficaria à mão)');
  assert.ok(m.log.includes('trava'), 'o card que volta tem de passar pela trava dos botões (destravar)');
  assert.ok(m.log.includes('comoFunciona'), 'o "Como funciona" que esperava o card à vista não foi pedido');
  assert.ok(m.log.includes('paroutick'), 'a contagem do QR seguiu correndo');
});

test('escondida, a passagem também fala o idioma de agora (o corpo é texto do JS, não data-i18n)', () => {
  // Janela estreita: a passagem não aparece, mas o texto do DOM tem de sair do dicionário, não da reserva em português.
  const m = mundo({ largura: 600 });
  m.els.passagemCorpo.textContent = 'RESERVA EM PORTUGUÊS';
  m.app.aplicarPassagem();
  assert.equal(m.AppState.passagemNaTela, false, 'PRÉ-CONDIÇÃO: a passagem apareceu numa janela estreita');
  assert.equal(m.els.passagemCorpo.textContent, 'passagem.corpoClique',
    'DEFEITO: a passagem escondida guardou a reserva do HTML (a página aberta em outro idioma divergia da trocada)');
});

test('a janela que estreita desliga a passagem (o card volta) e alargar a religa', () => {
  const m = mundo();
  m.app.aplicarPassagem();
  assert.equal(m.AppState.passagemNaTela, true);
  m.janela.largura = 800;
  m.app.aplicarPassagem();
  assert.equal(m.AppState.passagemNaTela, false, 'DEFEITO: a janela estreita seguiu com o card escondido');
  assert.ok(m.log.includes('comoFunciona'));
  m.janela.largura = 1300;
  m.app.aplicarPassagem();
  assert.equal(m.AppState.passagemNaTela, true);
});

test('sem foco em lugar nenhum, o foco vai ao controle principal (o card, que o recebia, está escondido)', () => {
  const m = mundo();
  m.app.aplicarPassagem();
  assert.equal(m.els.passagemMostrar.focado, 1, 'o foco não foi ao botão Mostrar');
  // CONTROLE: quem já tem o foco num controle vivo não o perde.
  const n = mundo();
  n.document.activeElement = el('outro');
  n.app.aplicarPassagem();
  assert.equal(n.els.passagemMostrar.focado, 0, 'o foco de quem já estava num controle foi roubado');
});

// ═══ a trava e as guardas estruturais ═════════════════════════════════════════
test('a trava das ações, as setas e o "Como funciona" leem o VALOR, e só `=== true`', () => {
  const trava = fatiar('acoesTravadas');
  assert.match(trava, /AppState\.passagemNaTela === true/, 'DEFEITO: o card escondido pode decidir (acoesTravadas não lê a passagem)');
  assert.doesNotMatch(trava, /passagemAtiva\(/, 'a trava voltou a CHAMAR função: o harness de buraco negro dos testes travaria tudo');
  assert.match(fatiar('handleKeyDown'), /if \(AppState\.passagemNaTela === true\) return;/, 'a seta decide (ou responde com o aviso da trava) com a passagem na tela');
  assert.match(fatiar('mostrarComoFuncionaSePrimeiraVez'), /AppState\.passagemNaTela === true\) return;/, 'o "Como funciona" abre sobre a passagem');
  // Uma ESCRITORA só: ninguém mais atribui o valor, fora a tela de entrada, que o zera.
  const escritas = APP_SEM.split('\n').filter((l) => /AppState\.passagemNaTela\s*=[^=]/.test(l)).map((l) => l.trim());
  assert.deepEqual(escritas, ['passagemNaTela: false,'.replace('passagemNaTela: false,', 'AppState.passagemNaTela = ativa;'), 'AppState.passagemNaTela = false;'],
    `a passagem passou a ser escrita em outro lugar: ${JSON.stringify(escritas)}`);
});

test('o "login novo" só liga na extensão (sem a renovação) e no cookies.txt — nunca na adoção da sessão guardada', () => {
  const quem = [];
  for (const [i, l] of APP_SEM.split('\n').entries()) if (/loginNestaPagina = true;|if \(!manterFila\) loginNestaPagina = true;/.test(l)) quem.push(i);
  assert.equal(quem.length, 2, 'o QR automático tem de sair só nos DOIS logins novos (extensão e cookies.txt)');
  assert.match(APP_SEM, /if \(!manterFila\) loginNestaPagina = true;/, 'a renovação da queda (manterFila) passou a pedir o QR automático');
  assert.doesNotMatch(fatiar('aoEntrarNestaPagina'), /loginNestaPagina/, 'aoEntrarNestaPagina também roda na ADOÇÃO da sessão guardada (toda reabertura): o QR sairia sempre');
  assert.doesNotMatch(fatiar('adotarSessaoDoAparelho'), /loginNestaPagina/);
});

test('o `loadPreferences` RELÊ a escolha (sem a linha ela era gravada e nunca lida), e o de fábrica a traz desligada', () => {
  assert.match(APP_SEM, /AppState\.preferences\.passagemDispensada = parsed\.passagemDispensada === true;/,
    'DEFEITO: a escolha do "Continuar" não é relida: a passagem volta a cada abertura');
  assert.match(fatiar('preferenciasDeFabrica'), /passagemDispensada: false/);
});

test('a tela de entrada tira a passagem (o QR é credencial) e o "Sair" cancela o código emitido', () => {
  const entrada = fatiar('showAuthScreen');
  for (const parte of [/classList\.remove\('passagem-ativa'\)/, /AppState\.passagemNaTela = false;/, /limparPassagem\(\);/, /loginNestaPagina = false;/]) {
    assert.match(entrada, parte, `showAuthScreen não faz ${parte}`);
  }
  assert.match(fatiar('gerarQrDaPassagem'), /pareamentosEmitidos\.add\(r\.code\);/, 'o QR da passagem não é lembrado pro "Sair" cancelar');
});

// ═══ o portão da fila: nada de busca por trás da passagem ═══════════════════════
// Quase todo uso no computador é só pra parear o celular. A busca por trás de uma tela que cobre o
// card custava uma chamada ao Waze, ao Worker e ao KV que ninguém via (v2026.11.16-01). O portão
// ANOTA a busca pedida; quem a manda é a transição passagem → card.
test('o «Continuar» manda UMA vez a busca que o portão segurou', () => {
  const m = mundo();
  m.app.aplicarPassagem();
  m.app.adiar();   // o portão do startFetching anotou uma busca pedida
  m.log.length = 0;
  m.app.dispensarPassagem();
  assert.deepEqual(m.log.filter((x) => x === 'busca' || x === 'prefetch'), ['busca'],
    'DEFEITO: o «Continuar» não mandou a busca que a passagem segurou (o card nunca chegaria)');
  assert.equal(m.app.adiada(), false, 'a anotação não foi gasta: a próxima transição buscaria de novo');
  // Gasta: alargar e estreitar de novo NÃO refaz a busca.
  m.janela.largura = 1300; m.app.aplicarPassagem();
  m.janela.largura = 700; m.app.aplicarPassagem();
  assert.equal(m.log.filter((x) => x === 'busca').length, 1, 'a janela que alarga e estreita refez a busca');
});

test('CONTROLE: sem busca anotada, a passagem que sai (ou a janela que estreita) NÃO busca nada', () => {
  const m = mundo();
  m.app.aplicarPassagem();
  m.log.length = 0;
  m.janela.largura = 800; m.app.aplicarPassagem();
  m.janela.largura = 1300; m.app.aplicarPassagem();
  m.janela.largura = 800; m.app.aplicarPassagem();
  assert.ok(!m.log.includes('busca') && !m.log.includes('prefetch'),
    'DEFEITO: estreitar a janela refez a fila (cada vez é uma chamada ao Waze à toa)');
});

test('com fila na mão a retomada é o prefetch de sempre (não refaz a fila), e o treino segura a anotação', () => {
  const comFila = mundo({ fila: 5 });
  comFila.app.aplicarPassagem(); comFila.app.adiar(); comFila.log.length = 0;
  comFila.app.dispensarPassagem();
  assert.deepEqual(comFila.log.filter((x) => x === 'busca' || x === 'prefetch'), ['prefetch'],
    'com fila, startFetching apagaria o card da tela: só o prefetch');
  // Com o treino aberto o `sair()` dele busca: a anotação FICA (e a passagem nem aparece).
  const t = mundo();
  t.app.aplicarPassagem(); t.app.adiar();
  t.app.treinoAtivo(true);
  t.app.aplicarPassagem();   // passagemAtiva() é falso com o treino aberto: a passagem sai
  assert.ok(!t.log.includes('busca'), 'o treino aberto recebeu uma busca por baixo');
  assert.equal(t.app.adiada(), true, 'a anotação se perdeu com o treino aberto: a fila real nunca viria');
});

test('maybePrefetch e buscarORestoDaFila NÃO buscam com a passagem na tela e anotam; sem ela, buscam (controle)', async () => {
  for (const nome of ['maybePrefetch', 'buscarORestoDaFila']) {
    const montar = (passagem) => {
      const chamadas = [];
      const AppState = { passagemNaTela: passagem, queue: [], hasMore: true, fetching: false, currentPlace: null };
      const deps = { AppState, Treino: { ativo: false }, PREFETCH_THRESHOLD: 3, fetchNextPage: () => { chamadas.push('fetchNextPage'); return Promise.resolve(); },
        showCurrentPlace: () => {} };
      const chaves = Object.keys(deps);
      const fonte = `let buscaAdiadaPelaPassagem = false;\n${fatiar(nome)}\nreturn { ${nome}, adiada: () => buscaAdiadaPelaPassagem };`;
      const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
      return { app, chamadas };
    };
    const sob = montar(true);
    sob.app[nome]();
    await livre();
    assert.deepEqual(sob.chamadas, [], `DEFEITO: ${nome} buscou uma página por trás da passagem`);
    assert.equal(sob.app.adiada(), true, `${nome} não anotou a busca pedida (o «Continuar» não a mandaria)`);
    const livreDela = montar(false);
    livreDela.app[nome]();
    await livre();
    assert.deepEqual(livreDela.chamadas, ['fetchNextPage'], `CONTROLE: ${nome} sem a passagem deixou de buscar`);
    assert.equal(livreDela.app.adiada(), false);
  }
});

test('o portão está no COMEÇO do startFetching (antes de qualquer efeito) e todo chamador do fetchNextPage passa por um', () => {
  const sf = fatiar('startFetching');
  const portao = sf.search(/if \(AppState\.passagemNaTela === true\) \{ buscaAdiadaPelaPassagem = true; return; \}/);
  assert.ok(portao > 0, 'DEFEITO: o startFetching não tem o portão da passagem (lê o VALOR, nunca chama função)');
  for (const efeito of ['showLoading(true)', 'removeCurrentCardEl()', 'fetchNextPage()', 'AppState.loadError = false', 'await ']) {
    const i = sf.indexOf(efeito);
    assert.ok(i > portao, `o portão vem DEPOIS de ${efeito}: a busca começaria por baixo da passagem`);
  }
  assert.match(sf, /buscaAdiadaPelaPassagem = false;\n\s+AppState\.loadError = false;/,
    'passou o portão e a anotação não foi gasta: o «Continuar» buscaria de novo');
  // O CENSO: quem chama o `fetchNextPage` direto tem de ter o portão, ou entrar na lista abaixo (que o decide à mão).
  const CHAMAM = [];
  const fonte = APP_SEM;
  const re = /^(async )?function (\w+)\(/gm;
  let m, funcoes = [];
  while ((m = re.exec(fonte))) funcoes.push({ nome: m[2], ini: m.index });
  funcoes.forEach((f, i) => { f.fim = i + 1 < funcoes.length ? funcoes[i + 1].ini : fonte.length; });
  for (const f of funcoes) {
    const corpo = fonte.slice(f.ini, f.fim);
    if (f.nome !== 'fetchNextPage' && /\bfetchNextPage\(\)/.test(corpo)) CHAMAM.push(f.nome);
  }
  const SEM_PORTAO_POR_MOTIVO = {
    // Só roda com card na tela (`!AppState.currentPlace` volta false): sob a passagem não há card.
    reordenarEsperandoAsPaginas: 'exige o card da tela',
  };
  for (const nome of CHAMAM) {
    const tem = /AppState\.passagemNaTela === true\) \{ buscaAdiadaPelaPassagem = true; return; \}/.test(fatiar(nome));
    assert.ok(tem || SEM_PORTAO_POR_MOTIVO[nome], `${nome} chama o fetchNextPage sem o portão da passagem (e não está na lista com o motivo)`);
  }
  for (const nome of ['startFetching', 'maybePrefetch', 'buscarORestoDaFila']) assert.ok(CHAMAM.includes(nome), `o censo não enxergou ${nome}: o instrumento quebrou`);
});

test('o «Sair» solta a busca segurada, e a retomada é chamada SÓ na saída da passagem', () => {
  assert.match(fatiar('showAuthScreen'), /buscaAdiadaPelaPassagem = false;/, 'a busca segurada da sessão que acabou ficou pro próximo login');
  const ap = fatiar('aplicarPassagem');
  assert.match(ap, /if \(estavaAtiva\) \{ pedirComoFuncionaAdiado\(\); retomarBuscaAdiada\(\); \}/, 'a saída da passagem não retoma a busca');
  assert.equal((APP_SEM.match(/(?<!function )\bretomarBuscaAdiada\(\)/g) || []).length, 1, 'a retomada passou a ser chamada em outro lugar: só a transição passagem → card a manda');
});
