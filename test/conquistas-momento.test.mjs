// Conquistas: QUANDO elas são avaliadas, e com que momento.
//
// A régua da seção ("celebra o que a pessoa FEZ") quebra de um jeito que não
// dá erro nenhum: a conquista destrava pelo gesto errado, na hora errada ou
// com o dado de outro momento — e fica gravada. Tudo daqui saiu da auditoria
// de 2026-09-25 do Histórico, e cada teste foi visto REPROVANDO com o conserto
// desfeito.
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
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
// `preludio` declara o estado de MÓDULO que as funções leem (os `let` do app).
function montar(nomes, deps, devolve, preludio = '') {
  const chaves = Object.keys(deps);
  return new Function(...chaves, preludio + '\n' + nomes.map(fatiar).join('\n') + `\nreturn { ${devolve.join(', ')} };`)(...chaves.map((k) => deps[k]));
}

// ── H2: trocar de idioma não é trabalhar em dois idiomas ────────────────────
function depsDoIdioma(extra = {}) {
  const idiomas = [];
  const deps = {
    setLang: () => {}, registrarIdiomaUsado: (l) => idiomas.push(l),
    safeLS: { set: () => {} }, LANG_KEY: 'waze_places_lang', applyI18n: () => {},
    SELETORES_IDIOMA: [], document: { getElementById: () => null }, popularOrdenacoes: () => {},
    AppState: { profile: null, currentPlace: null, authenticated: false },
    renderProfileHeader: () => {}, showCurrentPlace: () => {}, updateStats: () => {}, updatePendingCount: () => {},
    renderUndoGateUI: () => {}, atualizarLinhaDoOffline: () => {}, atualizarSeloDeConquista: () => {},
    historicoNaTela: () => false, renderHistory: () => {},
    window: {}, showToast: () => {}, t: (k) => k, ...extra,
  };
  return { deps, idiomas };
}

test('H2: trocar de idioma NÃO conta pra "Poliglota" — logado (Preferências) nem deslogado (Ajuda)', () => {
  for (const authenticated of [true, false]) {
    const { deps, idiomas } = depsDoIdioma({ AppState: { profile: null, currentPlace: null, authenticated } });
    const { aplicarIdioma } = montar(['aplicarIdioma'], deps, ['aplicarIdioma']);
    aplicarIdioma('en');
    aplicarIdioma('pt');
    assert.deepEqual(idiomas, [],
      `trocar de idioma (${authenticated ? 'logado' : 'deslogado'}) registrou idioma usado — abrir o seletor e voltar destrava a Poliglota, e deslogado recria as conquistas depois do "Sair"`);
  }
});

test('H2: CONTROLE — o idioma continua entrando pelo GESTO confirmado', () => {
  // Sem isto, "nenhum idioma registrado" passaria também com a Poliglota
  // inalcançável.
  for (const nome of ['registrarAcaoConfirmada', 'registrarLoteConfirmado']) {
    assert.match(fatiar(nome), /registrarIdiomaUsado\(/, `${nome} deixou de registrar o idioma do trabalho`);
  }
});
