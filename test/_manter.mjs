// Ferramentas dos testes do «Manter conectado»: relógio simulado, um Waze de
// mentira que rotaciona o `_web_session` a cada resposta, um store em memória que
// conta as operações (e tem `list`) e o cenário que junta tudo.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { makeSessions } from '../server/core.mjs';

export const NETSCAPE = (d, n, v) => `${d}\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
export const cookiesCom = (sessao) => [NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'), NETSCAPE('.waze.com', '_web_session', sessao)].join('\n');
export const T0 = 1_790_000_000;
export const HORA = 3600;
export const PERFIL = { id: 12444348, userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false, areas: [], managedAreas: [] };

// Relógio simulado + Waze de mentira. `modo` decide a resposta: 'ok' (200 com
// cookie novo), 'ok-sem-cookie', '403', '500', 'rede'.
export function ambiente() {
  let agora = T0;
  const dateNow = Date.now;
  Date.now = () => agora * 1000;
  const fetchOriginal = globalThis.fetch;
  let n = 0;
  const amb = {
    modo: () => 'ok',
    chamadas: [],
    get agora() { return agora; },
    set agora(v) { agora = v; },
    avancar(s) { agora += s; },
    restaurar() { Date.now = dateNow; globalThis.fetch = fetchOriginal; },
  };
  globalThis.fetch = async (url, init = {}) => {
    const m = /_web_session=([^;]+)/.exec((init.headers && init.headers.Cookie) || '');
    const id = ++n;
    const modo = amb.modo(m && m[1], id);
    amb.chamadas.push({ url: String(url), sessao: m && m[1], modo });
    if (modo === 'rede') throw new Error('rede caiu');
    if (modo === '403') return new Response(JSON.stringify({ errorList: [{ code: 101, details: 'not allowed by guest user' }] }), { status: 403 });
    if (modo === '500') return new Response('<html>500</html>', { status: 500 });
    const headers = { 'content-type': 'application/json' };
    if (modo === 'ok') headers['set-cookie'] = `_web_session=ROT${id}; path=/; Max-Age=2000000`;
    return new Response(JSON.stringify(PERFIL), { status: 200, headers });
  };
  return amb;
}

export function storeComContagem() {
  const mem = new Map();
  const ops = { get: 0, put: 0, delete: 0, list: 0 };
  return {
    mem, ops,
    get: async (k) => { ops.get++; return mem.has(k) ? mem.get(k) : null; },
    put: async (k, v) => { ops.put++; mem.set(k, v); },
    delete: async (k) => { ops.delete++; mem.delete(k); },
    list: async (p) => { ops.list++; return [...mem.keys()].filter((k) => k.startsWith(p)); },
  };
}

export async function cenario(opcoes = {}) {
  const amb = ambiente();
  const store = storeComContagem();
  if (opcoes.semList) delete store.list;
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const sessions = makeSessions({ store, keyBytes });
  const novo = async (sessao = 'LOGIN') => sessions.createSession(cookiesCom(sessao));
  const ctx = () => ({ sessions: makeSessions({ store, keyBytes }) });
  const cookieGuardado = async (token) => (/_web_session\t(\S+)/.exec(await makeSessions({ store, keyBytes }).loadSession(token) || '') || [])[1];
  const hashDe = async (token) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { amb, store, keyBytes, sessions, novo, ctx, cookieGuardado, hashDe };
}

