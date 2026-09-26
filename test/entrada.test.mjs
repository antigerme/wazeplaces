// A ENTRADA, pela auditoria de 2026-09-26: a tela de entrada (colar, arquivo,
// extensão, código/QR), a Ajuda, o "Como funciona" e o que acontece na saída e
// na queda da sessão. Cada teste foi visto REPROVANDO com o conserto desfeito
// (sabotagem), e os que rodam código rodam o código DE VERDADE, fatiado do
// app.js, com o mínimo de dublê em volta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { dispatch, makeSessions } from '../server/core.mjs';
import { storeEmMemoria } from './_sessao.mjs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
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
// Âncora na DECLARAÇÃO, e pula a assinatura casando parênteses: um `{}` de
// parâmetro padrão não pode virar "o corpo" (a armadilha do `fatiar` da fila
// de saída, que mediu 37 caracteres e reprovou código certo).
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = [^;]*;', 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}
// `deps` viram PARÂMETROS da função montada: dá pra reatribuí-los lá dentro,
// que é o que as variáveis `let` de módulo do app.js precisam.
function montar(nomes, deps, devolve, extra = '') {
  const chaves = Object.keys(deps);
  const corpo = extra + '\n' + nomes.map(fatiar).join('\n') + `\nreturn { ${devolve.join(', ')} };`;
  return new Function(...chaves, corpo)(...chaves.map((k) => deps[k]));
}

// Um elemento de mentira com o que as funções daqui usam. `src` e `title` são
// atributos DE VERDADE (propriedade e atributo andam juntos, como no DOM), e
// `cloneNode`/`replaceWith` trocam o elemento no registro do `document`.
function elemento(id, { oculto = true, registro = null, ...resto } = {}) {
  const classes = new Set(oculto ? ['hidden'] : []);
  const attrs = {};
  const el = {
    id, style: {}, textContent: '', dataset: {}, onerror: null, onload: null,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    hasAttribute(k) { return k in attrs; },
    // Clone RASO, como o `cloneNode(false)`: atributos e classes sim, ouvintes
    // (propriedades `on*`) não.
    cloneNode() {
      const novo = elemento(id, { oculto: classes.has('hidden'), registro });
      for (const [k, v] of Object.entries(attrs)) novo.setAttribute(k, v);
      for (const c of classes) novo.classList.add(c);
      Object.assign(novo.style, el.style);
      return novo;
    },
    replaceWith(novo) { if (registro) registro[id] = novo; el.substituido = true; },
    ...resto,
  };
  for (const a of ['src', 'title']) {
    Object.defineProperty(el, a, { get: () => (a in attrs ? attrs[a] : ''), set: (v) => { attrs[a] = String(v); }, enumerable: true });
  }
  return el;
}
function domDeMentira(specs) {
  const registro = {};
  for (const [id, op] of Object.entries(specs)) registro[id] = elemento(id, { ...op, registro });
  return { registro, document: { getElementById: (id) => registro[id] || null } };
}

// ── A1: a extensão entra com um modal da ENTRADA aberto ────────────────────
function extensaoDeMentira() {
  let ouvinte = null;
  const win = {
    location: { origin: 'https://app.test' },
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvinte = fn; },
    removeEventListener() {},
    postMessage() {},
  };
  const responder = (data) => ouvinte({ source: win, origin: 'https://app.test', data: { source: 'wazeplaces-ext', ...data } });
  return { win, responder };
}

test('extensão entrando com o "Colar" aberto: o modal sai pelo closeModal, com a limpeza — o chaveiro não fica no campo', async () => {
  const { registro, document } = domDeMentira({ pasteModal: { oculto: false }, pairEnterModal: {}, accessDeniedModal: {} });
  const fechados = [];
  const { app, responder } = montarExtensao({
    document, closeModal: (id) => { fechados.push(id); registro[id].classList.add('hidden'); },
  });
  const p = app.entrarPelaExtensao({ silencioso: true });
  responder({ action: 'sessao', token: 'TOKEN' });
  assert.equal(await p, true, 'o login pela extensão não terminou');
  assert.deepEqual(fechados, ['pasteModal'],
    'o "Colar" ficou aberto (ou saiu sem o closeModal): o cookies.txt colado sobrevive ao "Sair" no campo escondido');
});

// ── A3 + A21: o cabeçalho e a lista de recursos são de QUEM ESTAVA aqui ────
const FOTO_A = 'https://sms-profile-image.waze.com/111';
const FOTO_B = 'https://sms-profile-image.waze.com/222';

test('a tela de entrada APAGA o cabeçalho do perfil (foto, nome, nível e título), não só esconde', () => {
  const { registro, document } = domDeMentira({ userAvatar: { oculto: false }, userName: { oculto: false },
    userRank: { oculto: false }, userProfileBadge: { oculto: false } });
  const velho = registro.userAvatar;
  velho.setAttribute('src', FOTO_A);
  velho.onerror = () => {};
  registro.userName.textContent = 'editor_A';
  registro.userRank.textContent = 'L6 · AM';
  registro.userProfileBadge.setAttribute('title', 'editor_A — 10 pontos');
  const { limparCabecalhoDoPerfil } = montar(['limparCabecalhoDoPerfil', 'avatarSemFoto'], { document },
    ['limparCabecalhoDoPerfil']);
  limparCabecalhoDoPerfil();
  const avatar = registro.userAvatar;
  assert.equal(avatar.getAttribute('src'), null, 'a foto de quem saiu ficou no <img>');
  assert.equal(avatar.style.display, 'none');
  assert.equal(avatar.onerror, null, 'o onerror da foto anterior marcaria a da PRÓXIMA conta como falha');
  assert.equal(registro.userName.textContent, '', 'o nome de quem saiu ficou no cabeçalho escondido');
  assert.equal(registro.userRank.textContent, '', 'o nível de quem saiu ficou no cabeçalho escondido');
  assert.equal(registro.userProfileBadge.getAttribute('title'), null, 'o título (pontos e edições) de quem saiu ficou');
  assert.ok(registro.userProfileBadge.classList.contains('hidden'));
  // Quem chama: a tela de entrada — por onde passam o "Sair" e a queda.
  assert.match(fatiar('showAuthScreen'), /^\s+limparCabecalhoDoPerfil\(\);/m, 'a tela de entrada não apaga o cabeçalho');
  assert.match(fatiar('handleLogout'), /^\s+showAuthScreen\(\);/m, 'o "Sair" deixou de passar pela tela de entrada');
});

test('a foto que SAI dá lugar a um <img> NOVO — o que perde o `src` vira o ícone de imagem quebrada', () => {
  // MEDIDO no Chrome: `removeAttribute('src')` num <img> que já mostrou uma
  // foto deixa o ícone de quebrado no círculo; o que nunca teve `src` é o
  // círculo cinza reservado. Por isso a troca é de ELEMENTO.
  const { registro, document } = domDeMentira({ userAvatar: { oculto: false } });
  const velho = registro.userAvatar;
  velho.setAttribute('src', FOTO_A);
  const { avatarSemFoto } = montar(['avatarSemFoto'], { document }, ['avatarSemFoto']);
  const novo = avatarSemFoto(velho);
  assert.notEqual(novo, velho, 'o <img> que perdeu a foto ficou na tela — é o que desenha o ícone de quebrado');
  assert.equal(registro.userAvatar, novo, 'o elemento novo não entrou no lugar do velho');
  assert.equal(novo.getAttribute('src'), null);
  // CONTROLE: o que nunca teve foto não é trocado à toa (a troca de idioma
  // redesenha o cabeçalho a cada vez).
  assert.equal(avatarSemFoto(novo), novo);
});

test('perfil de OUTRA conta chegando: a foto anterior sai do <img> na hora — a nova só aparece quando carregar', () => {
  const rodar = (url, perfil) => {
    const { registro, document } = domDeMentira({ userAvatar: { oculto: false }, userName: {}, userRank: {},
      userProfileBadge: {}, brandTitle: {} });
    registro.userAvatar.setAttribute('src', url);
    const deps = { AppState: { profile: perfil }, document, avatarFalhou: null, avatarPendente: null,
      liberarAvatar() {}, t: (k) => k };
    const { renderProfileHeader, pendente } = montar(['renderProfileHeader', 'avatarSemFoto'], deps,
      ['renderProfileHeader', 'pendente'], 'function pendente() { return avatarPendente; }');
    renderProfileHeader();
    return { src: registro.userAvatar.getAttribute('src'), mostra: registro.userAvatar.style.display, pendente: pendente() };
  };
  const troca = rodar(FOTO_A, { userName: 'editor_B', profileImageUrl: FOTO_B });
  assert.equal(troca.src, null, 'a foto da conta ANTERIOR ficou no <img> enquanto a nova não chega');
  assert.equal(troca.mostra, '', 'a caixa reservada da foto nova não aparece');
  assert.equal(troca.pendente, FOTO_B, 'a foto nova não foi pedida');
  // CONTROLE: a MESMA foto (a troca de idioma redesenha o cabeçalho) não é mexida.
  assert.equal(rodar(FOTO_A, { userName: 'editor_A', profileImageUrl: FOTO_A }).src, FOTO_A);
  // Perfil sem foto: escondido E sem o `src` antigo no DOM.
  const semFoto = rodar(FOTO_A, { userName: 'editor_C', profileImageUrl: '' });
  assert.equal(semFoto.src, null, 'perfil sem foto deixou o src da conta anterior no DOM (e no diagnóstico)');
  assert.equal(semFoto.mostra, 'none');
});

test('a foto agendada da conta que SAIU não pousa no <img> da que entrou (época da sessão)', () => {
  const el = elemento('userAvatar', { oculto: false });
  let agendada = null;
  const codigo = 'let avatarPendente = "' + FOTO_A + '"; let telaPronta = true; let avatarFalhou = null;\n'
    + 'let epocaDaSessao = 0;\n' + fatiar('liberarAvatar')
    + '\nreturn { liberarAvatar, sair: () => { epocaDaSessao++; } };';
  const montarFoto = () => new Function('document', 'AppState', 'requestIdleCallback', 'dfato', codigo)(
    { getElementById: () => el }, { authenticated: true }, (fn) => { agendada = fn; }, () => {});
  // CONTROLE: sem ninguém sair, a foto pousa — senão a asserção de baixo passaria à toa.
  let foto = montarFoto();
  foto.liberarAvatar();
  assert.equal(typeof agendada, 'function', 'CONTROLE: a foto nem foi agendada');
  agendada();
  assert.equal(el.src, FOTO_A, 'CONTROLE: a foto não pousou nem sem ninguém sair — o teste perdeu o sentido');
  el.removeAttribute('src');
  agendada = null;
  foto = montarFoto();
  foto.liberarAvatar();
  foto.sair();           // "Sair" e outra conta entrando (authenticated segue verdadeiro)
  agendada();
  assert.equal(el.src, '', 'a foto da conta que saiu pousou no cabeçalho da que entrou');
});

test('o "Sair" limpa a lista de recursos que o diagnóstico leva (foto de perfil e fotos de terceiros)', () => {
  assert.match(fatiar('handleLogout'), /try \{ performance\.clearResourceTimings\(\); \} catch \(e\) \{\}/,
    'a URL da foto de perfil (com o id de quem saiu) e as fotos dos pedidos seguem na lista de recursos');
});

// ── A4: o autor em foco é da fila de QUEM ESTAVA aqui ──────────────────────
test('outra conta entrando: o autor que a anterior focou sai — a fila dela não vem reordenada por ele', () => {
  const { registro, document } = domDeMentira({ focoAutorBar: { oculto: false }, focoAutorTexto: {}, focoAutorContagem: {} });
  registro.focoAutorTexto.textContent = '🔎 Primeiro os de autor_1001';
  registro.focoAutorBar.setAttribute('aria-label', '3 pedidos de autor_1001');
  const AppState = { autorEmFoco: 1001, stats: {}, queue: [] };
  const nada = () => {};
  const deps = {
    AppState, document, window: {}, dfato: nada, carregarFilaDeSaida: () => [], salvarFilaDeSaida: nada,
    updateInFlightIndicator: nada, esquecerAutores: nada, safeLS: { remove: nada }, HISTORY_KEY: 'h', CONQUISTAS_KEY: 'c',
    atualizarSeloDeConquista: nada, saveStats: nada, updateStats: nada, offlineEsquecer: nada, dlogApagar: nada,
    showToast: nada, t: (k) => k,
  };
  const { esquecerOutraConta, manterFocoNaFrente } = montar(['esquecerOutraConta', 'esquecerFocoAutor', 'manterFocoNaFrente'],
    deps, ['esquecerOutraConta', 'manterFocoNaFrente']);
  // CONTROLE: com o foco da anterior, a fila de quem entrou vem com o autor dela na frente.
  AppState.queue = [{ creatorId: 2002 }, { creatorId: 1001 }];
  manterFocoNaFrente();
  assert.equal(AppState.queue[0].creatorId, 1001, 'CONTROLE: o foco nem reordenava — o teste perdeu o sentido');
  esquecerOutraConta('222');
  assert.equal(AppState.autorEmFoco, null, 'o autor em foco da conta anterior sobreviveu à troca de conta');
  assert.ok(registro.focoAutorBar.classList.contains('hidden'), 'a barra "Primeiro os de…" da conta anterior ficou na tela');
  assert.equal(registro.focoAutorTexto.textContent, '', 'o nome do autor ficou na barra escondida (o diagnóstico leva o DOM)');
  assert.equal(registro.focoAutorBar.getAttribute('aria-label'), null);
  AppState.queue = [{ creatorId: 2002 }, { creatorId: 1001 }];
  manterFocoNaFrente();
  assert.equal(AppState.queue[0].creatorId, 2002, 'a fila de quem entrou ainda é reordenada pelo foco da anterior');
  // E o "Sair" esquece junto com o resto do que é de terceiro.
  assert.match(fatiar('handleLogout'), /^\s+esquecerFocoAutor\(\);/m, 'o autor em foco sobrevive ao "Sair"');
});

// ── A5 + A24: a extensão e o PORTÃO ────────────────────────────────────────
// A resposta de VERDADE do servidor a um L1 não-AM: o core roda, só o Waze é
// de mentira. Assim o teste acompanha o formato que o app recebe de fato.
async function respostaDoPortao() {
  const sessions = makeSessions({ store: storeEmMemoria(), keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const salvo = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ userName: 'novato', rank: 0, isAreaManager: false, isStaff: false }), { status: 200 });
  try {
    const cookies = '# Netscape HTTP Cookie File\n.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tS\n.waze.com\tTRUE\t/\tTRUE\t0\t_csrf_token\tC';
    const r = await dispatch('testar-cookies', { cookies, region: 'row' }, { sessions });
    assert.equal(r.status, 403, 'CONTROLE: o servidor nem recusou — o teste perdeu o sentido');
    return r.body;
  } finally { globalThis.fetch = salvo; }
}

async function rodarBackground(corpoDoServidor) {
  let ouvinte = null, chamadas = 0;
  const ctx = {
    chrome: {
      cookies: { getAll: (q, cb) => cb([{ name: '_web_session', value: 'S', domain: '.waze.com', hostOnly: false, path: '/', secure: true },
                                        { name: '_csrf_token', value: 'C', domain: '.waze.com', hostOnly: false, path: '/', secure: true }]) },
      runtime: { onMessage: { addListener: (f) => { ouvinte = f; } }, onInstalled: { addListener() {} } },
      storage: { local: { set() {} } }, tabs: { create() {}, query() {}, reload() {} },
    },
    fetch: async () => { chamadas++; return { json: async () => corpoDoServidor }; },
    setTimeout: (fn) => { fn(); return 0; },   // as esperas entre tentativas, sem esperar
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(ler('extensao-chrome/background.js'), ctx);
  const r = await new Promise((res) => ouvinte({ action: 'autenticar' }, { tab: { url: 'https://places.wazebrasil.com/' } }, res));
  return { r, chamadas };
}

test('extensão: o portão RECUSOU — uma tentativa só, e o perfil e o motivo vão junto', async () => {
  const corpo = await respostaDoPortao();
  const { r, chamadas } = await rodarBackground(corpo);
  assert.equal(chamadas, 1, `a extensão insistiu ${chamadas}× num "não" definitivo (cada vez, uma ida ao /Session do Waze no nome da pessoa)`);
  assert.equal(r.success, false);
  assert.equal(r.negado, true, 'a recusa do portão saiu como erro genérico — a pessoa nunca vê o motivo');
  assert.equal(r.errorKey, 'srv.err.accessDenied');
  assert.deepEqual({ ...r.errorVars }, { minLevel: 2 });
  assert.equal(r.profile.userName, 'novato');
  // CONTROLE: falha passageira continua sendo retentada — o terminal é só o portão.
  const passageira = await rodarBackground({ success: false, error: 'Servidor Waze indisponível', errorCategory: 'transient' });
  assert.equal(passageira.chamadas, 4, 'a falha passageira deixou de ser retentada');
});

test('ponte: a recusa vai pro app como `sem-sessao` com motivo `negado` — o app de antes segue caindo no login na hora', () => {
  const postados = [];
  let ouvinte = null;
  const win = {
    location: { origin: 'https://places.wazebrasil.com' },
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvinte = fn; },
    postMessage: (m) => postados.push(m),
  };
  const respostaDoBackground = { success: false, negado: true, errorKey: 'srv.err.accessDenied', errorVars: { minLevel: 2 },
    error: 'Acesso restrito', profile: { userName: 'novato', rank: 0, isAreaManager: false, isStaff: false } };
  const ctx = {
    window: win, localStorage: { setItem() {} },
    chrome: { runtime: { sendMessage: (msg, cb) => cb(respostaDoBackground), lastError: null },
              storage: { local: { get: (k, cb) => cb({}), remove() {} } } },
  };
  vm.createContext(ctx);
  vm.runInContext(ler('extensao-chrome/ponte.js'), ctx);
  ouvinte({ source: win, origin: win.location.origin, data: { source: 'wazeplaces', action: 'precisa-de-sessao' } });
  const final = postados[postados.length - 1];
  assert.equal(postados[0].action, 'aguarde');
  assert.equal(final.action, 'sem-sessao', 'mudou a ação: o app de ANTES ficaria esperando o prazo inteiro');
  assert.equal(final.motivo, 'negado', 'a ponte não repassa que foi o portão');
  assert.equal(final.negado && final.negado.profile && final.negado.profile.userName, 'novato', 'o perfil não chega ao app');
  assert.equal(final.negado.errorKey, 'srv.err.accessDenied');
});

function montarExtensao(inicio = {}) {
  const { win, responder } = extensaoDeMentira();
  const negados = [];
  const deps = {
    window: win, document: { getElementById: () => null },
    API: { setSession() {} }, AppState: {}, EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000,
    extPerguntando: false, extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false,
    closeModal() {}, showMainScreen() {}, resetQueue() {}, loadProfileAndAuxData() {}, startFetching() {},
    esvaziarFilaDeSaida() {}, mostrarEntrandoPelaExtensao() {}, setTimeout: () => 1, clearTimeout() {},
    showAccessDenied: (r) => negados.push(r),
  };
  // Os dublês pedidos por quem chama ganham dos padrões (o `document` e o
  // `closeModal` do teste dos modais, por exemplo).
  for (const [k, v] of Object.entries(inicio)) deps[k] = v;
  const app = montar(['entrarPelaExtensao', 'negadoDaExtensao', 'tirarNegadoDaExtensao', 'mostrarNegadoDaExtensao',
    'aoEntrarNestaPagina', 'fecharModaisDaEntrada'], deps,
  ['entrarPelaExtensao', 'mostrarNegadoDaExtensao', 'estado'],
  constante('MODAIS_DA_ENTRADA') + '\nfunction estado() { return { extNegadoNestaPagina, extNegado, saiuNestaPagina }; }');
  return { app, responder, negados };
}

test('app: a recusa que a extensão repassa vira o MESMO "Acesso restrito" do login por arquivo — uma vez', async () => {
  const { app, responder, negados } = montarExtensao();
  const p = app.entrarPelaExtensao({ silencioso: true });
  responder({ action: 'aguarde' });
  responder({ action: 'sem-sessao', motivo: 'negado', negado: { errorKey: 'srv.err.accessDenied', errorVars: { minLevel: 2 },
    profile: { userName: 'novato', rank: 0, isAreaManager: false, isStaff: false } } });
  assert.equal(await p, false);
  assert.equal(app.estado().extNegadoNestaPagina, true, 'a volta à aba vai perguntar de novo à extensão');
  app.mostrarNegadoDaExtensao();
  app.mostrarNegadoDaExtensao();
  assert.equal(negados.length, 1, `o diálogo saiu ${negados.length}× (esperado: 1)`);
  assert.equal(negados[0].errorCategory, 'access_denied');
  assert.equal(negados[0].profile.userName, 'novato');
  assert.equal(negados[0].profile.rank, 0);
  // O que chega por postMessage é copiado campo a campo, com tipo — lixo não vira
  // tela. Pelo CAMINHO de verdade (a mensagem), não chamando a cópia direto:
  // senão um atalho que pulasse a cópia passaria limpo (a sabotagem mostrou).
  const l = montarExtensao();
  const pl = l.app.entrarPelaExtensao({ silencioso: true });
  l.responder({ action: 'sem-sessao', motivo: 'negado', negado: { errorKey: '<img onerror>', error: 7,
    errorVars: { minLevel: { a: 1 }, ok: 3 }, profile: { userName: 42, rank: '5' } } });
  await pl;
  l.app.mostrarNegadoDaExtensao();
  const lixo = l.negados[0];
  assert.ok(lixo, 'a recusa com dados estranhos nem virou diálogo');
  assert.equal(lixo.errorKey, undefined, 'chave de tradução que não é do servidor chegou ao diálogo');
  assert.equal(lixo.error, undefined);
  assert.deepEqual({ ...lixo.errorVars }, { ok: 3 });
  assert.equal(lixo.profile, null, 'perfil sem nome de verdade chegou ao diálogo');
  // CONTROLE: "sem login no WME" não é recusa — nada de diálogo, e a aba pode perguntar de novo.
  const c = montarExtensao();
  const q = c.app.entrarPelaExtensao({ silencioso: true });
  c.responder({ action: 'sem-sessao', motivo: 'sem-login-wme' });
  assert.equal(await q, false);
  c.app.mostrarNegadoDaExtensao();
  assert.equal(c.negados.length, 0);
  assert.equal(c.app.estado().extNegadoNestaPagina, false);
});

test('app: quem mostra a recusa — a abertura, a volta à aba (uma vez por página) e a queda da sessão', () => {
  assert.match(APP_SEM, /showAuthScreen\(\);\s*mostrarNegadoDaExtensao\(\);/,
    'a abertura sem sessão não mostra a recusa que a extensão repassou');
  assert.match(APP_SEM, /if \(saiuNestaPagina\) return;\s*if \(extNegadoNestaPagina\) return;/,
    'a volta à aba pergunta de novo à extensão depois de ela já ter dito que o portão recusou');
  assert.match(APP_SEM, /entrarPelaExtensao\(\{ silencioso: true \}\)\.then\(\(entrou\) => \{ if \(!entrou\) mostrarNegadoDaExtensao\(\); \}\);/,
    'a volta à aba não mostra a recusa');
  const queda = fatiar('derrubarSessao');
  assert.match(queda, /const negado = tirarNegadoDaExtensao\(\);/, 'a queda ignora a recusa que a extensão repassou');
  assert.match(queda, /if \(!negado\) showToast\(/, 'a queda avisa "sessão venceu" quando o motivo é o portão');
});

test('login que DEU CERTO zera as marcas da página: depois de "Sair" e entrar de novo, a volta à aba volta a relogar', async () => {
  const { app, responder } = montarExtensao({ saiuNestaPagina: true, extNegadoNestaPagina: true });
  const p = app.entrarPelaExtensao({ silencioso: true });
  responder({ action: 'sessao', token: 'T' });
  assert.equal(await p, true);
  assert.equal(app.estado().saiuNestaPagina, false, 'o "Sair" de antes segue valendo depois de entrar de novo');
  assert.equal(app.estado().extNegadoNestaPagina, false);
  // E os outros dois caminhos de entrada, pelo arquivo/colar e pelo código.
  assert.match(fatiar('authenticateWithCookies'), /guardarPrazoDaSessao\(result\);\s*aoEntrarNestaPagina\(\);/,
    'entrar pelos cookies não zera as marcas da página');
  assert.match(fatiar('resgatarPareamento'), /closeModal\('pairEnterModal'\);\s*aoEntrarNestaPagina\(\);/,
    'entrar pelo código não zera as marcas da página');
});

// ── A6: link de pareamento VENCIDO num aparelho JÁ logado ───────────────────
function montarCodigoDaURL({ token, resgate }) {
  const log = [];
  const deps = {
    API: { getSession: () => token },
    showAuthScreen: () => log.push('entrada'),
    resgatarPareamento: async (codigo, opcoes) => { log.push('resgate:' + codigo + ':' + !!(opcoes && opcoes.silencioso)); return resgate; },
    abrirComSessaoSalva: () => log.push('sessaoSalva'),
  };
  const { abrirPeloCodigoDaURL } = montar(['abrirPeloCodigoDaURL'], deps, ['abrirPeloCodigoDaURL']);
  return { abrirPeloCodigoDaURL, log };
}

test('link de pareamento vencido num aparelho LOGADO: o aviso sai e a sessão salva segue — nada de "Bem-vindo!"', async () => {
  const logado = montarCodigoDaURL({ token: 'SALVO', resgate: false });
  await logado.abrirPeloCodigoDaURL('VENCIDO');
  assert.deepEqual(logado.log, ['resgate:VENCIDO:true', 'sessaoSalva'],
    'o aparelho logado caiu na tela de entrada com a sessão válida guardada');
  // O código que VALE vence a sessão velha (é o pedido de agora): nada de abrir a antiga por cima.
  const trocou = montarCodigoDaURL({ token: 'SALVO', resgate: true });
  await trocou.abrirPeloCodigoDaURL('NOVO');
  assert.deepEqual(trocou.log, ['resgate:NOVO:true']);
  // CONTROLE: sem sessão salva, a tela de entrada aparece como sempre.
  const deslogado = montarCodigoDaURL({ token: null, resgate: false });
  await deslogado.abrirPeloCodigoDaURL('VENCIDO');
  assert.deepEqual(deslogado.log, ['entrada', 'resgate:VENCIDO:true']);
});

// ── A19: o atalho do ícone aberto SEM sessão ────────────────────────────────
test('atalho do ícone aberto sem sessão: a query sai da URL na hora — um F5 depois do login não o executa', () => {
  const trocas = [];
  const win = { location: { search: '?action=refresh', pathname: '/' },
    history: { replaceState: (s, t, url) => trocas.push(url) } };
  const { tirarAcaoDaURL } = montar(['tirarAcaoDaURL'], { window: win, URLSearchParams }, ['tirarAcaoDaURL']);
  assert.equal(tirarAcaoDaURL(), 'refresh');
  assert.deepEqual(trocas, ['/'], 'a query do atalho ficou na URL');
  // CONTROLE: sem atalho, a URL não é mexida.
  const quieta = { location: { search: '', pathname: '/' }, history: { replaceState: () => trocas.push('x') } };
  assert.equal(montar(['tirarAcaoDaURL'], { window: quieta, URLSearchParams }, ['tirarAcaoDaURL']).tirarAcaoDaURL(), null);
  assert.deepEqual(trocas, ['/']);
  // Quem chama: o ramo SEM sessão do `initApp` (antes de perguntar à extensão)
  // e o `handleLaunchAction`, que lê pela mesma função.
  assert.match(fatiar('initApp'), /\} else \{\s*tirarAcaoDaURL\(\);/,
    'sem sessão, a query do atalho fica na URL e roda num F5 depois do login');
  assert.match(fatiar('handleLaunchAction'), /const action = tirarAcaoDaURL\(\);/);
});

// ── A8: a QUEDA da sessão fecha o que está por cima ─────────────────────────
// O objeto literal inteiro (CamadaVoltar), casando chaves a partir da declaração.
function objeto(nome) {
  const i = APP_SEM.indexOf('const ' + nome + ' = {');
  assert.ok(i >= 0, `${nome} sumiu do app.js`);
  return APP_SEM.slice(i, fechar(APP_SEM, i)) + ';';
}
const MODAIS = new Function(constante('MODAL_IDS') + '\nreturn MODAL_IDS;')();

function montarCamadas({ abertos = [], lightbox = false, mapa = false, profundidade = 0 } = {}) {
  const ops = [];
  const limpezas = [];
  const specs = {};
  for (const id of MODAIS) specs[id] = { oculto: !abertos.includes(id), querySelector: () => null };
  const { registro, document } = domDeMentira(specs);
  document.body = { style: {}, contains: () => true };
  const Lightbox = { aberto: lightbox, fechou: null, isOpen() { return this.aberto; }, close(o) { this.aberto = false; this.fechou = o || {}; } };
  const MapaLightbox = { aberto: mapa, fechou: null, isOpen() { return this.aberto; }, close(v) { this.aberto = false; this.fechou = !!v; } };
  const history = { pushState: () => ops.push('push'), go: (n) => ops.push('go(' + n + ')'), back: () => ops.push('back') };
  const deps = {
    document, history, Lightbox, MapaLightbox, dfato() {}, lastFocusedBeforeModal: null,
    LIMPEZA_AO_FECHAR: new Proxy({}, { get: (t, id) => () => limpezas.push(id) }),
  };
  const app = montar(['fecharCamadasAbertas', 'closeModal', 'topOpenModal'], deps,
    ['fecharCamadasAbertas', 'closeModal', 'CamadaVoltar'], constante('MODAL_IDS') + '\n' + objeto('CamadaVoltar'));
  app.CamadaVoltar.profundidade = profundidade;
  // O diálogo que a própria queda abre: como o `openModal` faz sem modal aberto,
  // empilha a entrada DELE e aparece.
  const abrirNegado = () => { app.CamadaVoltar.empilhar(); registro.accessDeniedModal.classList.remove('hidden'); };
  return { ...app, ops, limpezas, registro, Lightbox, MapaLightbox, abrirNegado };
}

test('queda da sessão: Filtros e foto ampliada fecham COM a limpeza, e o diálogo da queda empilha ANTES de o voltar ser devolvido', () => {
  // Filtros abertos (1 entrada) e a foto ampliada por cima (mais 1).
  const c = montarCamadas({ abertos: ['filtersModal'], lightbox: true, profundidade: 2 });
  c.fecharCamadasAbertas(c.abrirNegado);
  assert.ok(c.registro.filtersModal.classList.contains('hidden'), 'os Filtros ficaram abertos por cima da tela de entrada');
  assert.ok(c.limpezas.includes('filtersModal'), 'os Filtros fecharam sem a limpeza deles');
  assert.equal(c.Lightbox.isOpen(), false, 'a foto ampliada (com aprovar/excluir) ficou por cima da tela de entrada');
  assert.equal(c.Lightbox.fechou && c.Lightbox.fechou.viaHistorico, true, 'a foto fechou mexendo no histórico sozinha');
  assert.ok(!c.registro.accessDeniedModal.classList.contains('hidden'), 'o diálogo que a queda abre não ficou');
  // O coração do gotcha #65: o `go` calcula o destino NA HORA da chamada, então
  // a entrada do diálogo tem que existir ANTES dele — senão ele a come.
  assert.deepEqual(c.ops, ['push', 'go(-2)'],
    'a ordem do histórico está errada: fechar o diálogo depois tiraria a pessoa do app');
  assert.equal(c.CamadaVoltar.profundidade, 1, 'a profundidade não é a do diálogo que ficou');
  assert.equal(c.CamadaVoltar.consumindo, true, 'o popstate do `go` seria lido como o voltar da pessoa');
});

test('queda da sessão sem diálogo: tudo fecha e o voltar é devolvido de uma vez; nada aberto, nada mexe', () => {
  const c = montarCamadas({ abertos: ['helpModal'], profundidade: 1 });
  c.fecharCamadasAbertas(null);
  assert.ok(c.registro.helpModal.classList.contains('hidden'));
  assert.deepEqual(c.ops, ['go(-1)'], 'sobrou entrada morta no histórico (ou saiu um back por camada)');
  assert.equal(c.CamadaVoltar.profundidade, 0);
  // O mapa ampliado também.
  const m = montarCamadas({ mapa: true, profundidade: 1 });
  m.fecharCamadasAbertas(null);
  assert.equal(m.MapaLightbox.isOpen(), false, 'o mapa ampliado ficou por cima da tela de entrada');
  assert.equal(m.MapaLightbox.fechou, true, 'o mapa fechou mexendo no histórico sozinho');
  assert.deepEqual(m.ops, ['go(-1)']);
  // CONTROLE: nada aberto, nada no histórico.
  const n = montarCamadas();
  n.fecharCamadasAbertas(null);
  assert.deepEqual(n.ops, []);
  assert.equal(n.CamadaVoltar.consumindo, false);
});

test('queda da sessão com a CONVERSA aberta: o desligar da presença, que fecha pelo closeModal, não mexe mais no voltar', () => {
  // O `showAuthScreen` chama o `Presenca.desligar`, que fecha a conversa e a
  // lista pelo `closeModal` — e, com elas abertas, isso era um `back()` no
  // mesmo tique do diálogo da queda (gotcha #65). Aqui elas já estão fechadas.
  const c = montarCamadas({ abertos: ['conversaModal'], lightbox: true, profundidade: 2 });
  c.fecharCamadasAbertas(() => { c.abrirNegado(); c.closeModal('conversaModal'); });
  assert.ok(c.limpezas.includes('conversaModal'), 'a conversa fechou sem a limpeza dela');
  assert.deepEqual(c.ops, ['push', 'go(-2)'], 'o fechamento da conversa no desligar voltou a mexer no histórico');
});

test('queda da sessão: os TRÊS caminhos passam pelo fechamento — e o diálogo vem ANTES da tela de entrada', () => {
  const queda = fatiar('derrubarSessao');
  assert.match(queda, /if \(typeof depois === 'function'\) \{ fecharCamadasAbertas\(depois\); return; \}/,
    'o portão fechado voltou a abrir o diálogo por cima das camadas');
  assert.match(queda, /setTimeout\(\(\) => fecharCamadasAbertas\(\(\) => \{\s*if \(negado\) showAccessDenied\(negado\);\s*showAuthScreen\(\);\s*\}\), UNAUTHORIZED_REDIRECT_MS\);/,
    'a queda comum voltou a mostrar a entrada com as camadas abertas por cima');
  // O diálogo ANTES da tela de entrada (a ordem que o `Presenca.desligar` exige).
  assert.match(fatiar('loadProfileAndAuxData'), /depois: \(\) => \{ showAccessDenied\(profileRes\); showAuthScreen\(\); \}/);
  assert.match(fatiar('handleUnauthorized'), /depois: \(\) => \{ showAccessDenied\(r\); showAuthScreen\(\); \}/);
});

// ── A9 + A12: a tela de entrada ANTES do JS, e o divisor sem a extensão ──────
const HTML = ler('index.src.html');
const CSS_SEM = ler('css/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
function dicionario() {
  const ctx = { navigator: { language: 'pt-BR' }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, console };
  vm.createContext(ctx);
  vm.runInContext(ler('js/i18n.js') + '\nthis.D = I18N_DICT;', ctx);
  return ctx.D;
}

test('a tela de entrada ANTES do JS (rede lenta) diz o mesmo que o dicionário pt — o requisito é L2+AM, não "nível 3+"', () => {
  const pt = dicionario().pt;
  const nivel = Number((/const NIVEL_MINIMO_EXIBIDO = (\d+);/.exec(APP) || [])[1]);
  assert.ok(nivel >= 1, 'CONTROLE: não achei o NIVEL_MINIMO_EXIBIDO');
  const tela = HTML.slice(HTML.indexOf('<div id="authScreen"'), HTML.indexOf('<div id="pasteModal"'));
  const texto = (h) => h.replace(/<[^>]+>/g, '').replace(/&#8220;|&#8221;/g, '"').replace(/\s+/g, ' ').trim();
  const achados = [...tela.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-i18n(?:-html)?="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)];
  assert.ok(achados.length >= 10, `CONTROLE: só achei ${achados.length} textos na tela de entrada — o recorte quebrou`);
  const divergentes = [];
  for (const [, , chave, reserva] of achados) {
    const valor = pt[chave];
    assert.ok(valor, `a chave ${chave} da tela de entrada sumiu do dicionário`);
    const esperado = texto(valor.replace(/\{nivelMinimo\}/g, String(nivel)));
    if (texto(reserva) !== esperado) divergentes.push(`${chave}: "${texto(reserva)}" ≠ "${esperado}"`);
  }
  assert.deepEqual(divergentes, [], 'o texto de reserva da tela de entrada diz outra coisa até o JS chegar');
});

test('a extensão só aparece com a CONFIRMAÇÃO do JS; o divisor some com ela fora do dedo', () => {
  const marcas = (pode) => {
    const classes = new Set();
    const { marcarSuporteAExtensao } = montar(['marcarSuporteAExtensao'],
      { document: { documentElement: { classList: { add: (c) => classes.add(c) } } }, podeInstalarExtensao: () => pode },
      ['marcarSuporteAExtensao']);
    marcarSuporteAExtensao();
    return [...classes];
  };
  assert.deepEqual(marcas(true), ['com-extensao'], 'onde a extensão instala, o JS não confirma');
  assert.deepEqual(marcas(false), ['sem-extensao']);
  // Sem a confirmação (antes do JS, ou onde ela não instala), card e divisor escondidos.
  assert.match(CSS_SEM, /(^|\n)\.auth-opt-ext\s*\{\s*display:\s*none;?\s*\}/, 'o card da extensão nasce visível');
  assert.match(CSS_SEM, /(^|\n)\.auth-opt-div\s*\{\s*display:\s*none;?\s*\}/,
    'fora do dedo e sem a extensão, a lista começa pelo "ou login manual", sem nada antes');
  assert.match(CSS_SEM, /\.com-extensao \.auth-opt-div\s*\{\s*display:\s*block;?\s*\}/, 'com a extensão, o divisor sumiu');
  // No dedo o divisor fica: lá ele separa o "Entrar com um código" (1º) do resto.
  const dedo = [...CSS_SEM.matchAll(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.match(dedo, /\.auth-opt-div\s*\{\s*display:\s*block;?\s*\}/, 'no celular o divisor sumiu junto com a extensão');
});

// ── A10: o "Como funciona" sem sessão ───────────────────────────────────────
test('sem sessão, a Ajuda não oferece "Ver de novo Como funciona" — o "Quero treinar antes" dele não fazia nada', () => {
  assert.match(HTML, /<button id="reverComoFunciona" data-so-com-sessao /,
    'o "Ver de novo Como funciona" aparece na tela de entrada');
  // Os controles de sessão somem desde a ABERTURA sem sessão, não só quando a
  // tela de entrada aparece (a Ajuda abre durante a pergunta à extensão).
  const init = fatiar('initApp');
  const semSessao = init.slice(init.indexOf('} else {'));
  const iEsconde = semSessao.indexOf('mostrarControlesDeSessao(false);');
  assert.ok(iEsconde > 0 && iEsconde < semSessao.indexOf('entrarPelaExtensao()'),
    'enquanto a extensão é perguntada, a Ajuda mostra os controles de quem entrou');
  // CONTROLE: o mecanismo esconde o que tem a marca (e o treino segue exigindo sessão).
  const marcados = [elemento('a', { oculto: false }), elemento('b', { oculto: false })];
  const { mostrarControlesDeSessao } = montar(['mostrarControlesDeSessao'],
    { document: { querySelectorAll: (sel) => (sel === '[data-so-com-sessao]' ? marcados : []) } }, ['mostrarControlesDeSessao']);
  mostrarControlesDeSessao(false);
  assert.ok(marcados.every((el) => el.classList.contains('hidden')));
});

// ── A13: o que fica no SERVIDOR ─────────────────────────────────────────────
test('a Ajuda diz a verdade sobre o SERVIDOR: além dos cookies, a lista de fotos do local por até 1 minuto', () => {
  // A frase dizia "só uma coisa… nada além disso", e tocar na lixeira guarda,
  // SEM cifra, a lista de fotos do local (ids, quem enviou cada uma, data,
  // aprovada) pra a exclusão sair rápido — `relerLocal` no core. O prazo é o
  // que o core manda pro armazenamento (o KV recusa menos de 60 s).
  const CORE = ler('server/core.mjs');
  const ttl = Number((/const RELEITURA_TTL = (\d+);/.exec(CORE) || [])[1]);
  const piso = Number((/const RELEITURA_TTL_STORE = Math\.max\((\d+), RELEITURA_TTL\);/.exec(CORE) || [])[1]);
  assert.ok(ttl > 0 && piso > 0, 'CONTROLE: não achei o prazo da releitura no core — o teste perdeu a âncora');
  const minutos = Math.ceil(Math.max(piso, ttl) / 60);
  assert.ok(/sessions\.store\.put\(chave, [^\n]*JSON\.stringify\(enxuto\), RELEITURA_TTL_STORE\)/.test(CORE),
    'CONTROLE: a releitura mudou de forma no core — confira se a frase da Ajuda segue verdadeira');
  const D = dicionario();
  for (const lang of Object.keys(D)) {
    const frase = D[lang]['help.privacy.server'];
    assert.doesNotMatch(frase, /nada além disso|nothing else|nada más|rien d’autre/i,
      `${lang}: a Ajuda ainda diz que no servidor não fica mais nada`);
    assert.match(frase, new RegExp(`\\b${minutos} minut`, 'i'), `${lang}: a Ajuda não diz o prazo da lista de fotos (${minutos} min)`);
  }
});

// ── A16: um termo por conceito ──────────────────────────────────────────────
test('um termo por conceito: "nível" no diálogo de acesso restrito, e UM nome pra instalar o app (nas 4 línguas)', () => {
  const D = dicionario();
  // O mesmo diálogo dizia "nível" no subtítulo e "rank"/"rango" na ajuda. Cada
  // língua usa a palavra do subtítulo também na ajuda.
  const NIVEL = { pt: 'nível', en: 'level', es: 'nivel', fr: 'niveau' };
  for (const lang of Object.keys(D)) {
    const palavra = NIVEL[lang];
    assert.ok(palavra, `CONTROLE: língua nova (${lang}) sem a palavra de "nível" neste teste`);
    assert.ok(D[lang]['modal.accessDenied.subtitle'].toLowerCase().includes(palavra), `CONTROLE: ${lang} mudou o subtítulo`);
    const ajuda = D[lang]['modal.accessDenied.help'];
    assert.ok(ajuda.toLowerCase().includes(palavra), `${lang}: a ajuda do "Acesso restrito" não usa "${palavra}", como o subtítulo`);
    assert.doesNotMatch(ajuda, /\brank\b|\brango\b/i, `${lang}: a ajuda do "Acesso restrito" voltou a dizer "rank"/"rango"`);
  }
  // Instalar: a Ajuda dizia "Instalar o aplicativo" e o convite "Instalar na
  // tela inicial" pra MESMA ação. Agora é UMA chave, nos dois botões.
  const usos = [...HTML.matchAll(/data-i18n="(install\.action|help\.install\.label)"/g)].map((m) => m[1]);
  assert.deepEqual(usos, ['install.action', 'install.action'], 'os dois botões de instalar voltaram a ter nomes diferentes');
  for (const lang of Object.keys(D)) {
    assert.equal(D[lang]['help.install.label'], undefined, `${lang}: o segundo nome de "instalar" voltou ao dicionário`);
  }
});

// ── A23: o nome acessível CONTÉM o texto visível (WCAG 2.5.3) ────────────────
test('botão com texto visível tem esse texto no nome acessível, nas 4 línguas ("By AG")', () => {
  // Quem usa controle por voz fala o que VÊ ("clicar By AG"); com o aria-label
  // sem o texto visível, o comando não acha o botão. Símbolo (‹ › + −) não é
  // rótulo de texto, então só entra texto com letra.
  const D = dicionario();
  const semTags = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let conferidos = 0;
  for (const m of HTML.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const aria = /data-i18n-aria="([^"]+)"/.exec(m[2]);
    const visivel = semTags(m[3]);
    if (!aria || !/\p{L}/u.test(visivel)) continue;
    const chaveTexto = (/data-i18n="([^"]+)"/.exec(m[2]) || /data-i18n="([^"]+)"/.exec(m[3]) || [])[1];
    for (const lang of Object.keys(D)) {
      const texto = chaveTexto ? semTags(D[lang][chaveTexto] || '') : visivel;
      assert.ok(D[lang][aria[1]].toLowerCase().includes(texto.toLowerCase()),
        `${lang}: "${aria[1]}" não contém o texto visível "${texto}"`);
    }
    conferidos++;
  }
  assert.ok(conferidos >= 1, 'CONTROLE: nenhum botão com texto e aria-label achado — o recorte quebrou');
});

// ── A15: botão de diálogo com a MESMA cor do diálogo no escuro ──────────────
test('no tema escuro nenhum botão de diálogo tem o fundo do próprio diálogo — o "Entendi" do "Acesso restrito" some', () => {
  // Cada diálogo até o SEU fechamento (casando <div>/</div>): um recorte até o
  // próximo diálogo levava junto o que vem depois dele no HTML, e acusava o
  // "Verificar novamente" da tela do card como se fosse de um modal.
  const blocos = [...HTML.matchAll(/<div id="[A-Za-z]+" role="dialog"/g)].map((m) => {
    let prof = 0;
    for (const t of HTML.slice(m.index).matchAll(/<div\b|<\/div>/g)) {
      prof += t[0] === '</div>' ? -1 : 1;
      if (prof === 0) return HTML.slice(m.index, m.index + t.index + t[0].length);
    }
    return HTML.slice(m.index);
  });
  assert.ok(blocos.length >= 10, `CONTROLE: só achei ${blocos.length} diálogos — o recorte quebrou`);
  const problemas = [];
  let botoes = 0;
  for (const bloco of blocos) {
    const id = /<div id="([A-Za-z]+)"/.exec(bloco)[1];
    const caixa = /<div class="([^"]*\brounded-2xl\b[^"]*)"/.exec(bloco);
    if (!caixa) continue;
    const fundo = (caixa[1].split(/\s+/).find((c) => /^dark:bg-[a-z]+-\d+$/.test(c)) || '').replace('dark:', '');
    if (!fundo) continue;
    for (const b of bloco.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*\bclass="([^"]*)"/g)) {
      const cl = b[2].split(/\s+/);
      const claro = cl.find((c) => /^bg-[a-z]+-\d+$/.test(c));
      if (!claro) continue;
      botoes++;
      const escuro = (cl.find((c) => /^dark:bg-[a-z]+-\d+(\/\d+)?$/.test(c)) || '').replace('dark:', '') || claro;
      if (escuro === fundo) problemas.push(`${id} › #${b[1]} (${escuro})`);
    }
  }
  assert.ok(botoes >= 10, `CONTROLE: só achei ${botoes} botões com fundo nos diálogos`);
  assert.deepEqual(problemas, [], 'botão sem forma no tema escuro: o fundo dele é o do diálogo');
  // E o "Entendi" é o botão afirmativo dos outros diálogos de um botão só.
  const classes = (id) => (new RegExp(`<button id="${id}"[^>]*class="([^"]*)"`).exec(HTML) || [])[1];
  assert.equal(classes('closeAccessDenied'), classes('treinoFimOk'),
    'o "Entendi" do "Acesso restrito" não usa as classes do botão afirmativo dos outros diálogos');
});
