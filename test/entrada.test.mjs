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

// Um elemento de mentira com o que as funções daqui usam.
function elemento(id, { oculto = true, ...resto } = {}) {
  const classes = new Set(oculto ? ['hidden'] : []);
  const attrs = {};
  return {
    id, style: {}, textContent: '', title: '', dataset: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute(k, v) { attrs[k] = String(v); if (k === 'src') this.src = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; if (k === 'src') this.src = ''; if (k === 'title') this.title = ''; },
    hasAttribute(k) { return k in attrs; },
    ...resto,
  };
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
