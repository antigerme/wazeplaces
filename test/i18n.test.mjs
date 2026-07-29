// Auditoria de i18n — a rede que garante "nunca esquecer os outros idiomas".
// Roda no CI (node --test). Falha se:
//   - faltar pt/en/es;
//   - qualquer chave não existir nas TRÊS línguas (paridade);
//   - algum valor estiver vazio;
//   - os placeholders {x} divergirem entre as línguas de uma mesma chave;
//   - alguma chave usada no index.html (data-i18n*) não existir no dicionário.
//
// Mesma ideia da auditoria do botequei (tests/audit.mjs cobra a paridade pt/en/es).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Carrega o js/i18n.js (script clássico) num contexto Node e captura o dicionário.
function loadDict() {
  const ctx = { navigator: { language: 'pt' }, document: { documentElement: {} } };
  vm.createContext(ctx);
  vm.runInContext(read('js/i18n.js'), ctx);
  return ctx.I18N_DICT;
}

const DICT = loadDict();
const LANGS = ['pt', 'en', 'es'];
const placeholders = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');

test('i18n: dicionário tem pt, en e es', () => {
  for (const l of LANGS) assert.ok(DICT[l] && typeof DICT[l] === 'object', `falta o idioma ${l}`);
});

test('i18n: paridade — toda chave existe nas TRÊS línguas', () => {
  const all = new Set(LANGS.flatMap((l) => Object.keys(DICT[l])));
  const missing = [];
  for (const l of LANGS) for (const k of all) if (!(k in DICT[l])) missing.push(`${l} → ${k}`);
  assert.equal(missing.length, 0, 'Chaves sem tradução (adicione nas 3 línguas):\n' + missing.join('\n'));
});

test('i18n: nenhum valor vazio', () => {
  const empty = [];
  for (const l of LANGS) for (const [k, v] of Object.entries(DICT[l])) if (!String(v).trim()) empty.push(`${l} → ${k}`);
  assert.equal(empty.length, 0, 'Valores vazios:\n' + empty.join('\n'));
});

test('i18n: placeholders {x} consistentes entre as línguas', () => {
  const bad = [];
  for (const k of Object.keys(DICT.pt)) {
    const ref = placeholders(DICT.pt[k]);
    for (const l of ['en', 'es']) {
      if (!(k in DICT[l])) continue;
      if (placeholders(DICT[l][k]) !== ref) bad.push(`${k}: pt[${ref}] vs ${l}[${placeholders(DICT[l][k])}]`);
    }
  }
  assert.equal(bad.length, 0, 'Placeholders divergentes:\n' + bad.join('\n'));
});

test('i18n: toda chave usada no index.html (data-i18n*) existe no dicionário', () => {
  const html = read('index.html');
  const used = new Set();
  const re = /\bdata-i18n(?:-html|-ph|-aria|-title)?="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) used.add(m[1]);
  const orphans = [...used].filter((k) => !(k in DICT.pt));
  assert.equal(orphans.length, 0, 'data-i18n no HTML sem chave no dicionário:\n' + orphans.join('\n'));
});

// Regressão: `data-i18n` escreve textContent, então markup no valor do
// dicionário chega ESCAPADO na tela — o editor lê "Toque em <strong>Compartilhar
// </strong>" literalmente. Aconteceu com os passos de instalação no iPhone, que
// é justamente quem não tem outro caminho. Nada quebra: a chave existe, a
// paridade passa, o texto só fica com as tags à mostra. Quem tem markup usa
// `data-i18n-html` (innerHTML, valores do próprio dicionário — nunca da rede).
test('i18n: chave ligada por textContent (data-i18n) não pode ter markup no valor', () => {
  const html = read('index.html');
  const textuais = new Set();
  const re = /\bdata-i18n="([^"]+)"/g;   // sem sufixo: textContent
  let m;
  while ((m = re.exec(html)) !== null) textuais.add(m[1]);
  const comTag = [];
  for (const k of textuais) {
    for (const lang of LANGS) {
      const v = DICT[lang] && DICT[lang][k];
      if (typeof v === 'string' && /<[a-z][^>]*>/i.test(v)) comTag.push(`${lang} · ${k} → ${v.slice(0, 60)}`);
    }
  }
  assert.equal(comTag.length, 0,
    'valor com HTML numa chave que vira textContent (use data-i18n-html):\n' + comTag.join('\n'));
});

test('i18n: toda chave t(\'...\') do app.js/api.js existe no dicionário', () => {
  const src = read('js/app.js') + '\n' + read('js/api.js');
  const keys = new Set();
  let m;
  // t('chave' ...) e t(cond ? 'a' : 'b' ...)
  const re1 = /t\(\s*\??\s*['"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)['"]/g;
  while ((m = re1.exec(src)) !== null) keys.add(m[1]);
  const re2 = /[?:]\s*['"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)['"]/g;
  while ((m = re2.exec(src)) !== null) keys.add(m[1]);
  const orphans = [...keys].filter((k) => !(k in DICT.pt));
  assert.equal(orphans.length, 0, "t('chave') sem correspondência no dicionário:\n" + orphans.join('\n'));
});

// Regressão: o card é clonado de um <template>, e conteúdo de template NÃO é
// alcançado por document.querySelectorAll — então o applyI18n() global nunca
// via as chaves de dentro dele. Efeito: em en/es o card voltava pro português
// A CADA SWIPE. A única correção possível é traduzir o clone; se alguém tirar
// essa chamada, o bug volta silencioso (nada quebra, só fica em pt).
test("i18n: renderCurrentCard aplica o dicionário no clone do <template>", () => {
  const src = read('js/app.js');
  assert.ok(
    /applyI18n\(\s*card\s*\)/.test(src),
    'js/app.js precisa chamar applyI18n(card) no clone do cardTemplate — sem isso ' +
    'o card fica sempre em português pra quem usa inglês/espanhol'
  );
});

// Regressão: o fallback atende TODO idioma fora de pt/en/es — francês, alemão,
// japonês, russo, chinês. Quem fala pt/en/es vem da detecção e nunca chega
// aqui, então trocar o fallback pra 'en' não muda nada pra eles e dá a quem
// sobra a língua franca da comunidade WME. Voltar pra 'pt' é uma escolha de
// produto, não um detalhe — por isso está travado.
test('i18n: idioma desconhecido cai em inglês, não em português', () => {
  const ctx = { navigator: { language: 'fr-FR' }, document: { documentElement: {} } };
  vm.createContext(ctx);
  vm.runInContext(read('js/i18n.js'), ctx);
  // `const` no topo de um script não vira propriedade do global (só `function`
  // vira), então LANG_FALLBACK não dá pra ler daqui — o que vale é o
  // comportamento do resolveLang, testado abaixo.
  assert.match(read('js/i18n.js'), /LANG_FALLBACK\s*=\s*'en'/, "LANG_FALLBACK deixou de ser 'en'");
  for (const loc of ['fr-FR', 'de-DE', 'ja-JP', 'ru-RU', 'zh-CN', 'nl-NL', '']) {
    ctx.navigator.language = loc;
    assert.equal(ctx.resolveLang(), 'en', `locale ${loc || '(vazio)'} devia cair em inglês`);
  }
  // E quem É atendido continua vindo da detecção, sem passar pelo fallback.
  for (const [loc, esperado] of [['pt-BR', 'pt'], ['pt-PT', 'pt'], ['en-GB', 'en'], ['es-AR', 'es']]) {
    ctx.navigator.language = loc;
    assert.equal(ctx.resolveLang(), esperado, `locale ${loc} devia dar ${esperado}`);
  }
});

// O seletor de idioma vivia só em Filtros → Preferências, e o botão de Filtros
// fica escondido sem sessão: quem caísse num idioma que não lê teria que entrar
// primeiro, lendo instruções que não entende. O modal de Ajuda é o único
// alcançável deslogado — por isso o segundo seletor.
test('i18n: dá pra trocar o idioma antes de entrar', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  const ids = ['langSelect', 'langSelectHelp'];
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `sumiu o seletor #${id}`);
  }
  // O da Ajuda precisa estar DENTRO do #helpModal, senão não é alcançável deslogado.
  const ajuda = html.slice(html.indexOf('id="helpModal"'));
  assert.ok(
    ajuda.indexOf('id="langSelectHelp"') !== -1 &&
    ajuda.indexOf('id="langSelectHelp"') < ajuda.indexOf('id="helpModal"', 1) + 1e9,
    'o seletor de idioma saiu do modal de Ajuda'
  );
  for (const id of ids) {
    assert.ok(app.includes(`'${id}'`), `${id} não está em SELETORES_IDIOMA — os dois sairiam de sincronia`);
  }
  assert.match(app, /function aplicarIdioma/, 'sumiu o aplicarIdioma() que mantém os seletores em sincronia');
});
