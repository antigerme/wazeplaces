// Sessão de VERDADE para os testes que chamam o `dispatch`.
//
// Até a v2026.09.25-03 as rotas aceitavam `cookies` crus no corpo, e os testes
// usavam o atalho. O atalho era o furo do portão (ver `resolveCookies` no core):
// quem mandasse o próprio cookies.txt direto numa rota agia sem passar pelo
// L2+AM. Agora toda rota exige `sessionToken`, e o teste entra como o app entra:
// uma sessão criada no store, com a mesma criptografia do servidor.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { makeSessions } from '../server/core.mjs';

// Store em memória com a mesma interface dos adaptadores (get/put/delete).
export function storeEmMemoria() {
  const mem = new Map();
  return {
    mem,
    get: async (k) => (mem.has(k) ? mem.get(k) : null),
    put: async (k, v) => { mem.set(k, v); },
    delete: async (k) => { mem.delete(k); },
  };
}

// Devolve o token e o `ctx` do dispatch. `dados` é o pedaço do corpo que
// substitui o antigo `cookies: COOKIES` — espalhe-o no corpo da rota.
export async function sessaoDeTeste(cookies) {
  const store = storeEmMemoria();
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const sessionToken = await sessions.createSession(cookies);
  return { sessionToken, dados: { sessionToken }, ctx: { sessions }, sessions, store };
}
