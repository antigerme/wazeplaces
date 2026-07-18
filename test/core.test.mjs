// Suite mínima do core (zero dependências — usa node:test + node:assert nativos).
// Rodar: `node --test`  (ou `npm test`).
//
// Cobre a lógica pura testável sem tocar o Waze: cripto/sessões (round-trip),
// categorização de erro (casos reais do HAR), gate de acesso, parsing de cookies
// e o filtro de domínio (crítico de segurança/privacidade).

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// core.mjs usa `crypto` global (Web Crypto) — garante disponível no runner.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  makeSessions,
  categorizeWazeError,
  isUserAllowed,
  extractCSRFToken,
  validateCookiesFormat,
  filterWazeCookies,
  cookieHeaderFrom,
  isWazeCookieDomain,
  SESSION_TTL,
  WAZE_REGIONS,
} from '../server/core.mjs';

const NETSCAPE = (domain, name, value) =>
  `${domain}\tTRUE\t/\tTRUE\t9999999999\t${name}\t${value}`;

function memStore() {
  const m = new Map();
  return {
    _m: m,
    get: (h) => m.get('sess_' + h) ?? null,
    put: (h, blob) => { m.set('sess_' + h, blob); },
    delete: (h) => { m.delete('sess_' + h); },
  };
}

test('cripto: round-trip createSession → loadSession, sem vazar plaintext', async () => {
  const store = memStore();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const sessions = makeSessions({ store, keyBytes });
  const cookies = [NETSCAPE('.waze.com', '_csrf_token', 'abc123'),
                   NETSCAPE('.waze.com', '_web_session', 'segredo-xyz')].join('\n');

  const token = await sessions.createSession(cookies);
  assert.ok(typeof token === 'string' && token.length > 0);
  assert.equal(await sessions.loadSession(token), cookies);

  // Chave do store é hash do token, não o token cru; blob não contém o plaintext.
  const keys = [...store._m.keys()];
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes(token), 'chave do store não deve conter o token');
  const blob = store._m.get(keys[0]);
  assert.ok(!blob.includes('segredo-xyz'), 'blob criptografado não pode conter o cookie');
});

test('cripto: token inválido/nulo → loadSession null; destroySession remove', async () => {
  const store = memStore();
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  assert.equal(await sessions.loadSession('nao-existe'), null);
  assert.equal(await sessions.loadSession(null), null);
  const t = await sessions.createSession(NETSCAPE('.waze.com', '_csrf_token', 'abc'));
  await sessions.destroySession(t);
  assert.equal(await sessions.loadSession(t), null);
});

test('categorizeWazeError: casos reais do HAR e fallbacks', () => {
  const c = (h, b, e) => categorizeWazeError(h, b, e).category;
  // Features (rejeitar) 404 + code 702 → race, não erro
  assert.equal(c(404, JSON.stringify({ errorList: [{ code: 702, details: 'was not found on venue' }] })), 'already_processed');
  // Issues/Read 500 + code 300 → race (NÃO transient)
  assert.equal(c(500, JSON.stringify({ errorList: [{ code: 300, details: 'Failed to handle request' }] })), 'already_processed');
  assert.equal(c(500, '{}'), 'transient');
  assert.equal(c(401, ''), 'unauthorized');
  assert.equal(c(403, ''), 'unauthorized');
  assert.equal(c(404, ''), 'not_found');
  assert.equal(c(409, ''), 'already_processed');
  assert.equal(c(0, '', 'network fail'), 'transient');
  assert.equal(c(418, 'teapot'), 'unknown');
});

test('isUserAllowed: matriz do gate (Staff OU rank>=2 & AM)', () => {
  assert.equal(isUserAllowed({ isStaff: true, rank: 0 }).allowed, true);
  assert.equal(isUserAllowed({ rank: 2, isAreaManager: true }).allowed, true);   // display L3 AM
  assert.equal(isUserAllowed({ rank: 5, isAreaManager: true }).allowed, true);
  assert.equal(isUserAllowed({ rank: 1, isAreaManager: true }).allowed, false);  // L2 AM
  assert.equal(isUserAllowed({ rank: 4, isAreaManager: false }).allowed, false); // L5 não-AM
  assert.equal(isUserAllowed(null).allowed, false);
});

test('extractCSRFToken: formato header e Netscape', () => {
  assert.equal(extractCSRFToken('_csrf_token=abc123; _web_session=xyz'), 'abc123');
  assert.equal(extractCSRFToken(NETSCAPE('.waze.com', '_csrf_token', 'def456')), 'def456');
  assert.equal(extractCSRFToken('sem token aqui'), null);
});

test('validateCookiesFormat', () => {
  assert.equal(validateCookiesFormat('_csrf_token=abc'), true);
  assert.equal(validateCookiesFormat(NETSCAPE('.waze.com', '_csrf_token', 'abc')), true);
  assert.equal(validateCookiesFormat('nada'), false);
});

test('filterWazeCookies: descarta outros domínios (Netscape), preserva Waze', () => {
  const raw = [
    NETSCAPE('.waze.com', '_csrf_token', 'abc'),
    NETSCAPE('.redhat.com', 'sso', 'SEGREDO-RH'),
    NETSCAPE('www.waze.com', '_web_session', 'xyz'),
    NETSCAPE('.github.com', 'gh', 'SEGREDO-GH'),
  ].join('\n');
  const filtered = filterWazeCookies(raw);
  assert.ok(filtered.includes('_csrf_token'));
  assert.ok(filtered.includes('_web_session'));
  assert.ok(!filtered.includes('redhat'));
  assert.ok(!filtered.includes('SEGREDO-RH'));
  assert.ok(!filtered.includes('SEGREDO-GH'));
});

test('filterWazeCookies: formato header (sem tabs) passa direto', () => {
  const header = '_csrf_token=abc; _web_session=xyz';
  assert.equal(filterWazeCookies(header), header);
});

test('cookieHeaderFrom: só cookies waze.com viram header (defesa em profundidade)', () => {
  const raw = [
    NETSCAPE('.waze.com', '_csrf_token', 'abc'),
    NETSCAPE('.redhat.com', 'sso', 'SEGREDO'),
    NETSCAPE('www.waze.com', '_web_session', 'xyz'),
  ].join('\n');
  const header = cookieHeaderFrom(raw);
  assert.ok(header.includes('_csrf_token=abc'));
  assert.ok(header.includes('_web_session=xyz'));
  assert.ok(!header.includes('sso=SEGREDO'));
});

test('isWazeCookieDomain: aceita waze.com/subdomínios, rejeita look-alikes', () => {
  assert.equal(isWazeCookieDomain('.waze.com'), true);
  assert.equal(isWazeCookieDomain('www.waze.com'), true);
  assert.equal(isWazeCookieDomain('waze.com'), true);
  assert.equal(isWazeCookieDomain('.redhat.com'), false);
  assert.equal(isWazeCookieDomain('notwaze.com'), false);
  assert.equal(isWazeCookieDomain('evil-waze.com.br'), false);
  assert.equal(isWazeCookieDomain('waze.com.evil.com'), false);
});

test('constantes de sanidade', () => {
  assert.equal(SESSION_TTL, 1814400);
  assert.ok(WAZE_REGIONS.row.includes('waze.com'));
});
