// "Sem sessão" nasce no aparelho (o token sumiu: outra aba saiu, o WebKit apagou
// o armazenamento) e ia só com o TEXTO traduzido. O app o reconhecia procurando
// "sess" no texto — e o espanhol ("Sesión expirada") não tem "sess": quem usava
// o app em espanhol via "Falha ao carregar" em vez da tela de entrar (auditoria
// de 2026-09-25). Roda o api.js de verdade, em cada idioma.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const API_JS = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function apiEm(lang) {
  const ctx = {
    navigator: { language: lang, onLine: true },
    document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (k === 'waze_places_lang' ? lang : null), setItem() {}, removeItem() {} },
    fetch: async () => { throw new Error('não era pra ir à rede'); },
    console, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + API_JS + '\nthis.API = API;', ctx);
  return ctx.API;
}

test('sem token, TODA chamada volta carimbada como unauthorized — em todos os idiomas', async () => {
  for (const lang of ['pt', 'en', 'es', 'fr']) {
    const API = apiEm(lang);
    for (const [nome, chamar] of [['fetchPlaces', () => API.fetchPlaces(1, {})], ['getProfile', () => API.getProfile()],
      ['markAsRead', () => API.markAsRead('v', 'u')], ['rejectPlace', () => API.rejectPlace('v', 'u')]]) {
      const r = await chamar();
      assert.equal(r.success, false);
      assert.equal(r.errorCategory, 'unauthorized', `${lang}/${nome}: sem sessão não veio como unauthorized`);
    }
  }
});

test('o app decide a sessão pela CATEGORIA, nunca procurando "sess" no texto', () => {
  assert.doesNotMatch(APP, /toLowerCase\(\)\.includes\('sess'\)/, 'voltou a detecção de sessão pelo texto');
});
