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
