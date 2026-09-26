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
