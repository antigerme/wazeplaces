// A ENTRADA, pela auditoria de 2026-09-26: a tela de entrada (colar, arquivo,
// extensão, código/QR), a Ajuda, o "Como funciona" e o que acontece na saída e
// na queda da sessão. Cada teste foi visto REPROVANDO com o conserto desfeito
// (sabotagem), e os que rodam código rodam o código DE VERDADE, fatiado do
// app.js, com o mínimo de dublê em volta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  const modais = {
    pasteModal: elemento('pasteModal', { oculto: false }),
    pairEnterModal: elemento('pairEnterModal'),
    accessDeniedModal: elemento('accessDeniedModal'),
  };
  const fechados = [];
  const { win, responder } = extensaoDeMentira();
  const deps = {
    window: win, document: { getElementById: (id) => modais[id] || null },
    API: { setSession() {} }, AppState: {}, EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, extPerguntando: false,
    closeModal: (id) => { fechados.push(id); modais[id].classList.add('hidden'); },
    showMainScreen() {}, resetQueue() {}, loadProfileAndAuxData() {}, startFetching() {}, esvaziarFilaDeSaida() {},
    mostrarEntrandoPelaExtensao() {}, setTimeout: () => 1, clearTimeout() {},
  };
  const { entrarPelaExtensao } = montar(['entrarPelaExtensao', 'fecharModaisDaEntrada'], deps,
    ['entrarPelaExtensao'], constante('MODAIS_DA_ENTRADA'));
  const p = entrarPelaExtensao({ silencioso: true });
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
