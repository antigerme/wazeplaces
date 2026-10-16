// Trocar o tema pelo BOTÃO tem que deixar a tela igual à que a RECARGA deixa
// (auditoria de 2026-09-29, A8, medido no navegador): com o sistema escuro,
// tocar pro claro deixava a barra do sistema e o fundo sob o app ESCUROS até
// recarregar. O script do tema (inline no <head>) marca o claro com
// `tema-claro` e, quando a pessoa escolheu o contrário do sistema, deixa UMA
// meta `theme-color` na cor dela; o `applyTheme` não tirava/punha o
// `tema-claro` e só mexia na PRIMEIRA meta — que, seguindo o sistema, é a do
// esquema claro, não a que vale num sistema escuro.
//
// Roda os DOIS de verdade — o script do index.src.html e o applyTheme/
// toggleTheme do app.js — num DOM de mentira, e compara o estado. O teste de
// navegador (tools/smoke-browser.mjs) mede o fundo e a barra na tela.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP_SEM = ler('js/app.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const HTML = ler('index.src.html');

function fatiar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', APP_SEM.indexOf(')', m.index)); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) return APP_SEM.slice(m.index, j + 1); }
  }
  throw new Error('não fechou: ' + nome);
}

// O script do tema, como o navegador o roda antes do primeiro paint.
const SCRIPT_DO_TEMA = (() => {
  const blocos = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const s = blocos.find((b) => b.includes("localStorage.getItem('waze_places_theme')"));
  assert.ok(s, 'CONTROLE: o script inline do tema sumiu do index.src.html');
  return s;
})();

const ESCURO = '(prefers-color-scheme: dark)';
const CLARO = '(prefers-color-scheme: light)';

// Um documento com as duas metas do index.src.html, o armazenamento e o
// sistema no esquema pedido.
function pagina({ sistemaEscuro, escolha = null }) {
  const classes = new Set();
  const metas = [];
  const head = {
    appendChild(m) { metas.push(m); m.parentNode = head; },
    removeChild(m) { const i = metas.indexOf(m); if (i >= 0) metas.splice(i, 1); },
  };
  const meta = (content, media) => {
    const attrs = { name: 'theme-color', content };
    if (media) attrs.media = media;
    return {
      parentNode: head,
      get media() { return attrs.media || ''; },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = String(v); },
    };
  };
  // As DUAS metas, na ordem do HTML (conferida abaixo contra o arquivo).
  metas.push(meta('#f8fafc', CLARO), meta('#0f172a', ESCURO));
  const guardado = new Map(escolha ? [['waze_places_theme', escolha]] : []);
  const matchMedia = (q) => ({ matches: q === ESCURO ? sistemaEscuro : q === CLARO ? !sistemaEscuro : false });
  const qualquer = () => ({ classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {} });
  const document = {
    documentElement: {
      classList: {
        add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
        toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); return on; },
      },
    },
    body: { classList: { toggle() {} } },
    head,
    createElement: () => meta(''),
    querySelectorAll: (sel) => (sel === 'meta[name="theme-color"]' ? [...metas] : []),
    getElementById: qualquer,
  };
  const localStorage = {
    getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => guardado.set(k, String(v)),
  };
  const window = { matchMedia };
  // A carga: o script inline, e depois o `initApp`, que aplica o tema de novo.
  new Function('window', 'document', 'localStorage', SCRIPT_DO_TEMA)(window, document, localStorage);
  const app = new Function('window', 'document', 'localStorage', 'THEME_KEY',
    [fatiar('getPreferredTheme'), fatiar('applyTheme'), fatiar('toggleTheme'),
     'return { getPreferredTheme, applyTheme, toggleTheme };'].join('\n'))(window, document, localStorage, 'waze_places_theme');
  app.applyTheme(app.getPreferredTheme());
  // O que a tela mostra: a classe da raiz e a barra — a meta que VALE é a
  // primeira cuja media casa, não a primeira do documento.
  const estado = () => {
    const vale = metas.find((m) => !m.media || matchMedia(m.media).matches);
    return {
      dark: classes.has('dark'), temaClaro: classes.has('tema-claro'),
      barra: vale ? vale.getAttribute('content') : null,
    };
  };
  return { ...app, estado, escolha: () => guardado.get('waze_places_theme') || null };
}

test('CONTROLE: as duas metas de mentira são as do index.src.html, na mesma ordem', () => {
  const metas = [...HTML.matchAll(/<meta name="theme-color" content="([^"]+)" media="([^"]+)">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(metas, [['#f8fafc', CLARO], ['#0f172a', ESCURO]]);
});

test('A8: trocar o tema pelo botão deixa a tela IGUAL à da recarga — nos dois sistemas, ida e volta', () => {
  for (const sistemaEscuro of [true, false]) {
    const p = pagina({ sistemaEscuro });
    for (const passo of ['1º toque', '2º toque']) {
      p.toggleTheme();
      const depoisDoToque = p.estado();
      const recarga = pagina({ sistemaEscuro, escolha: p.escolha() }).estado();
      const onde = `sistema ${sistemaEscuro ? 'escuro' : 'claro'}, ${passo} (${p.escolha()})`;
      assert.deepEqual(depoisDoToque, recarga,
        `${onde}: o botão pinta diferente da recarga — barra e fundo só acertam ao recarregar`);
      // E a recarga é o certo: UMA das duas classes, e a barra na cor do tema.
      const escuro = p.escolha() === 'dark';
      assert.deepEqual(recarga, { dark: escuro, temaClaro: !escuro, barra: escuro ? '#0f172a' : '#f8fafc' },
        `${onde}: a recarga não deixou o tema coerente`);
    }
  }
});

test('A8: seguindo o sistema (sem escolha), o que o app aplica na abertura já é coerente', () => {
  for (const sistemaEscuro of [true, false]) {
    const s = pagina({ sistemaEscuro }).estado();
    assert.deepEqual(s, { dark: sistemaEscuro, temaClaro: !sistemaEscuro, barra: sistemaEscuro ? '#0f172a' : '#f8fafc' });
  }
});
