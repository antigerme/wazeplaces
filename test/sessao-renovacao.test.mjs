// A renovação do prazo da sessão × a regravação do cookie rotacionado pelo Waze
// (auditoria do servidor de 2026-09-29, achados S1 e S2).
//
// O defeito: a renovação diária morava no `loadSession` e regravava o blob
// VELHO com carimbo novo ANTES de a requisição chamar o Waze; a trava de 1 h do
// `refreshCookies` lê esse carimbo, então o cookie rotacionado que chegava em
// seguida era jogado fora — na requisição da renovação e na hora seguinte. Quem
// usa o app menos de 1 h por abertura e volta 24 h depois NUNCA salvava a
// rotação (o cookie do login é o que azeda, gotcha #43). E cada uma das 3
// chamadas da abertura renovava por conta própria: 3 escritas no KV.
//
// Hoje o `loadSession` só lê; a gravação do cookie rotacionado renova o prazo
// de carona, e o `renovarPrazo` (que o `dispatch` chama no FIM da requisição)
// só regrava o blob relido quando não veio cookie novo.
//
// Os dois adaptadores: no Worker cada requisição tem o SEU `makeSessions`; na
// VM há UM só, pro processo (`server/node.mjs`). Os dois modelos rodam aqui, e
// o Worker de verdade é IMPORTADO no fim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { makeSessions, dispatch, base64ToBytes, SESSION_COOKIE_REFRESH, SESSION_REFRESH_AFTER } from '../server/core.mjs';

const NETSCAPE = (d, n, v) => `${d}\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'), NETSCAPE('.waze.com', '_web_session', 'LOGIN')].join('\n');
const MIN = 60;
const HORA = 3600;
const T0 = 1_790_000_000;
const PERFIL = { id: 12444348, userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false, areas: [], managedAreas: [] };
const tipoDaUrl = (u) => (u.includes('/Session') ? 'perfil' : u.includes('/Countries') ? 'paises' : u.includes('/Issues/Search/List') ? 'busca' : 'outro');

// Relógio simulado e um Waze de mentira que rotaciona `_web_session` em cada
// resposta (como o de verdade) e ANOTA o valor que recebeu — é o que o servidor
// tinha guardado. `segurar(tipo)` decide QUANDO cada resposta sai.
function ambiente() {
  let agora = T0;
  const relogio = Date.now;
  Date.now = () => agora * 1000;
  const fetchOriginal = globalThis.fetch;
  const recebidos = [];
  const idPorTipo = new Map();
  let n = 0;
  const amb = {
    segurar: null,
    rotaciona: () => true,
    recebidos,
    idPorTipo,
    get agora() { return agora; },
    set agora(v) { agora = v; },
    restaurar() { Date.now = relogio; globalThis.fetch = fetchOriginal; },
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const tipo = tipoDaUrl(u);
    const m = /_web_session=([^;]+)/.exec((init.headers && init.headers.Cookie) || '');
    const id = ++n;
    recebidos.push({ tipo, valor: m && m[1], em: agora });
    idPorTipo.set(tipo, id);
    if (amb.segurar) await amb.segurar(tipo);
    const corpo = tipo === 'perfil' ? PERFIL : tipo === 'paises' ? { countries: [] } : tipo === 'busca' ? { venues: { objects: [] } } : {};
    const headers = { 'content-type': 'application/json' };
    if (amb.rotaciona(tipo)) headers['set-cookie'] = `_web_session=ROT${id}; path=/; Max-Age=2000000`;
    return new Response(JSON.stringify(corpo), { status: 200, headers });
  };
  return amb;
}

function kvContado() {
  const mem = new Map();
  const cont = { get: 0, put: 0 };
  return {
    mem, cont,
    get: async (k) => { cont.get++; return mem.has(k) ? mem.get(k) : null; },
    put: async (k, v) => { cont.put++; mem.set(k, v); },
    delete: async (k) => { mem.delete(k); },
  };
}

// A sessão como a versão anterior e esta gravam: `carimbo|blob`. Envelhecer é
// trocar o carimbo, sem mexer no blob.
function envelhecer(store, idadeS, agora) {
  for (const [k, v] of store.mem) store.mem.set(k, (agora - idadeS) + v.slice(v.indexOf('|')));
}
const carimboGuardado = (store) => { const [v] = store.mem.values(); return parseInt(v.slice(0, v.indexOf('|')), 10); };

async function cenario({ modelo, idadeS }) {
  const amb = ambiente();
  const store = kvContado();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const unica = makeSessions({ store, keyBytes });
  const token = await unica.createSession(COOKIES);
  envelhecer(store, idadeS, amb.agora);
  store.cont.get = 0; store.cont.put = 0;
  return {
    amb, store, token, keyBytes,
    // Worker: um `makeSessions` por requisição. VM: o do processo.
    ctx: () => ({ sessions: modelo === 'VM' ? unica : makeSessions({ store, keyBytes }) }),
    // O que ficou guardado, aberto por uma instância nova (sem memória nenhuma).
    guardado: async () => {
      const antes = { ...store.cont };
      const c = await makeSessions({ store, keyBytes }).loadSession(token);
      Object.assign(store.cont, antes);
      return (/_web_session\t(\S+)/.exec(c || '') || [])[1];
    },
  };
}

async function ate(cond, rotulo) {
  for (let i = 0; i < 2000; i++) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`CONTROLE: não chegou a "${rotulo}" — o teste não mediu o que diz`);
}

test('a requisição que RENOVA o prazo grava o cookie rotacionado, e a seguinte já manda o valor novo (Worker e VM)', async () => {
  // CONTROLE: 23 h (passou da trava de 1 h, não venceu o dia) sempre salvou a
  // rotação — se ele reprovar, o instrumento não enxerga rotação nenhuma.
  for (const idadeS of [23 * HORA, 25 * HORA]) {
    for (const modelo of ['Worker', 'VM']) {
      const s = await cenario({ modelo, idadeS });
      const rotulo = `${modelo}, carimbo de ${idadeS / HORA} h`;
      try {
        const r1 = await dispatch('buscar-places', { sessionToken: s.token, region: 'row' }, s.ctx());
        assert.equal(r1.status, 200, `${rotulo}: ${JSON.stringify(r1.body).slice(0, 100)}`);
        assert.equal(s.amb.recebidos.at(-1).valor, 'LOGIN', `CONTROLE (${rotulo}): o Waze não recebeu o cookie do login`);
        const rotacao = 'ROT' + s.amb.idPorTipo.get('busca');
        assert.equal(s.store.cont.put, 1, `${rotulo}: a requisição gravou ${s.store.cont.put} vez(es) — era UMA, com a rotação`);
        // A MESMA gravação renovou o prazo: o carimbo guardado é o de agora.
        assert.equal(carimboGuardado(s.store), s.amb.agora, `${rotulo}: a gravação não renovou o prazo`);
        s.amb.agora += 5 * MIN;
        await dispatch('buscar-places', { sessionToken: s.token, region: 'row' }, s.ctx());
        assert.equal(s.amb.recebidos.at(-1).valor, rotacao,
          `${rotulo}: a requisição seguinte mandou ${s.amb.recebidos.at(-1).valor} — a rotação foi jogada fora`);
        assert.equal(s.store.cont.put, 1, `${rotulo}: a requisição seguinte gravou de novo (a trava de 1 h não segurou)`);
      } finally { s.amb.restaurar(); }
    }
  }
});

test('20 min de uso por dia, voltando 24h05 depois: a rotação é salva em TODA abertura (Worker e VM)', async () => {
  // O cenário do achado, medido antes do conserto com o core de verdade: o
  // `_web_session` do login ia ao Waze nos 6 dias seguidos.
  for (const modelo of ['Worker', 'VM']) {
    const s = await cenario({ modelo, idadeS: 0 });
    try {
      const primeiros = [];
      for (let dia = 0; dia < 5; dia++) {
        const inicio = s.amb.agora;
        const gravacoesAntes = s.store.cont.put;
        for (let t = 0; t <= 20; t += 4) {
          s.amb.agora = inicio + t * MIN;
          await dispatch('buscar-places', { sessionToken: s.token, region: 'row' }, s.ctx());
          if (t === 0) primeiros.push(s.amb.recebidos.at(-1).valor);
        }
        assert.ok(s.store.cont.put - gravacoesAntes <= 1, `${modelo}, dia ${dia}: ${s.store.cont.put - gravacoesAntes} gravações numa abertura de 20 min`);
        s.amb.agora = inicio + 24 * HORA + 5 * MIN;
      }
      // Dia 0: sessão recém-criada (trava de 1 h). Do dia 1 em diante, cada
      // abertura grava a rotação, e a abertura seguinte a manda.
      assert.equal(primeiros[0], 'LOGIN');
      assert.equal(new Set(primeiros.slice(1)).size, primeiros.length - 1,
        `${modelo}: a primeira chamada de cada dia mandou ${primeiros.join(', ')} — a rotação não foi salva`);
      assert.ok(primeiros.slice(2).every((v) => v !== 'LOGIN'), `${modelo}: o cookie do login seguiu indo ao Waze`);
    } finally { s.amb.restaurar(); }
  }
});

test('a abertura (3 chamadas juntas) com o prazo vencido grava UMA vez, e grava a ROTAÇÃO (Worker e VM)', async () => {
  // As 3 chamadas da abertura do app (perfil, países e a busca) com latências
  // diferentes, como as de verdade. Antes: 3 escritas no KV, duas no mesmo
  // segundo (o KV aceita 1 por segundo por chave).
  const abrir = async (s, { juntas }) => {
    const portas = new Map();
    s.amb.segurar = (tipo) => new Promise((ok) => portas.set(tipo, ok));
    const corpo = { sessionToken: s.token, region: 'row' };
    const pedidos = {
      paises: dispatch('lista-paises', corpo, s.ctx()),
      perfil: dispatch('perfil', corpo, s.ctx()),
      busca: dispatch('buscar-places', corpo, s.ctx()),
    };
    await ate(() => portas.size === 3, 'as 3 chamadas no Waze');
    if (juntas) {
      for (const ok of portas.values()) ok();
      await Promise.all(Object.values(pedidos));
    } else {
      // A mais rápida primeiro (medido: países ~300 ms, perfil ~900, busca ~1500).
      for (const tipo of ['paises', 'perfil', 'busca']) { portas.get(tipo)(); await pedidos[tipo]; }
    }
    for (const [tipo, p] of Object.entries(pedidos)) assert.equal((await p).status, 200, tipo);
  };
  const casos = [
    // O Worker só é mantido no teto quando as respostas chegam em tempos
    // diferentes (a RELEITURA é que vê a gravação da outra): o KV não tem
    // "compare e grave". Na VM, a reserva em memória segura até as simultâneas.
    { modelo: 'Worker', juntas: false },
    { modelo: 'VM', juntas: false },
    { modelo: 'VM', juntas: true },
  ];
  for (const { modelo, juntas } of casos) {
    const rotulo = `${modelo}${juntas ? ', respostas simultâneas' : ''}`;
    // CONTROLE: carimbo de 10 min, nada a gravar.
    const c = await cenario({ modelo, idadeS: 10 * MIN });
    try {
      await abrir(c, { juntas });
      assert.equal(c.store.cont.put, 0, `CONTROLE (${rotulo}): a abertura com a sessão fresca gravou ${c.store.cont.put} vez(es)`);
    } finally { c.amb.restaurar(); }

    const s = await cenario({ modelo, idadeS: 25 * HORA });
    try {
      await abrir(s, { juntas });
      assert.equal(s.store.cont.put, 1, `${rotulo}: a abertura gravou ${s.store.cont.put} vezes — era UMA`);
      assert.ok(/^ROT\d+$/.test(await s.guardado()), `${rotulo}: o que ficou guardado não é uma rotação (${await s.guardado()})`);
      if (!juntas) {
        assert.equal(await s.guardado(), 'ROT' + s.amb.idPorTipo.get('paises'),
          `${rotulo}: ficou guardada outra rotação que não a da primeira resposta`);
      }
      assert.equal(carimboGuardado(s.store), s.amb.agora, `${rotulo}: o prazo não foi renovado`);
    } finally { s.amb.restaurar(); }
  }
});

test('VM: a requisição que abre a sessão ENQUANTO outra grava não grava de novo (o carimbo lembrado só cresce)', async () => {
  // A reserva em memória só segura o teto se a leitura de outra requisição não
  // a desfizer: com o arquivo ainda no carimbo VELHO (a gravação de A no meio),
  // o `loadSession` de D lê o velho — e trocar a reserva por ele deixaria D
  // gravar também.
  const s = await cenario({ modelo: 'VM', idadeS: 25 * HORA });
  try {
    // A gravação fica PRESA até o teste soltar — todas, pra uma segunda (a de
    // D, se o teto falhar) não prender a de A pra sempre.
    const presas = [];
    const putOriginal = s.store.put;
    s.store.put = (k, v) => new Promise((ok) => presas.push(() => ok(putOriginal(k, v))));
    const corpo = { sessionToken: s.token, region: 'row' };
    const a = dispatch('buscar-places', corpo, s.ctx());
    await ate(() => presas.length === 1, 'a gravação de A no meio');
    s.amb.agora += 2;
    let dTerminou = false;
    const d = dispatch('lista-paises', corpo, s.ctx()).finally(() => { dTerminou = true; });
    await ate(() => dTerminou || presas.length >= 2, 'D decidir se grava');
    // D abriu a sessão com a gravação de A ainda no ar: leu o cookie do login.
    assert.equal(s.amb.recebidos[1].valor, 'LOGIN', 'CONTROLE: D não leu o valor antigo — o cenário não é o da corrida');
    s.store.put = putOriginal;
    for (const soltar of presas) soltar();
    await a; await d;
    assert.equal(s.store.cont.put, 1, `A e D gravaram ${s.store.cont.put} vezes — a leitura de D desfez a reserva de A`);
  } finally { s.amb.restaurar(); }
});

test('a ação de swipe continua custando UMA leitura e nenhuma escrita (sessão fresca, Waze rotacionando)', async () => {
  for (const modelo of ['Worker', 'VM']) {
    const s = await cenario({ modelo, idadeS: 10 * MIN });
    try {
      for (let i = 0; i < 5; i++) {
        s.amb.agora += 20;
        const antes = { ...s.store.cont };
        const r = await dispatch('validar-place', { sessionToken: s.token, region: 'row', venueID: 'v1', updateRequestID: 'u1' }, s.ctx());
        assert.equal(r.body.success, true, JSON.stringify(r.body).slice(0, 100));
        assert.equal(s.store.cont.get - antes.get, 1, `${modelo}: a ação ${i + 1} custou ${s.store.cont.get - antes.get} leituras`);
        assert.equal(s.store.cont.put - antes.put, 0, `${modelo}: a ação ${i + 1} gravou`);
      }
      // CONTROLE: passada a trava de 1 h, a ação LÊ de novo e GRAVA a rotação —
      // senão o "zero escrita" acima passaria com um código que nunca grava.
      s.amb.agora += SESSION_COOKIE_REFRESH;
      await dispatch('validar-place', { sessionToken: s.token, region: 'row', venueID: 'v1', updateRequestID: 'u1' }, s.ctx());
      assert.equal(s.store.cont.put, 1, `CONTROLE (${modelo}): depois de 1 h a rotação não foi gravada`);
    } finally { s.amb.restaurar(); }
  }
});

test('sem cookie novo, o prazo é renovado com o blob RELIDO — e a rotação que outra requisição acabou de gravar não é desfeita', async () => {
  // Sem rotação nenhuma: a requisição renova sozinha, com o que estava guardado.
  const s0 = await cenario({ modelo: 'Worker', idadeS: 25 * HORA });
  try {
    s0.amb.rotaciona = () => false;
    const r = await dispatch('lista-paises', { sessionToken: s0.token, region: 'row' }, s0.ctx());
    assert.equal(r.status, 200);
    assert.equal(s0.store.cont.put, 1, `sem rotação, a renovação gravou ${s0.store.cont.put} vezes`);
    assert.equal(carimboGuardado(s0.store), s0.amb.agora, 'sem rotação, o prazo não foi renovado');
    assert.equal(await s0.guardado(), 'LOGIN');
    // E a requisição seguinte no mesmo dia não grava de novo.
    s0.amb.agora += 5 * MIN;
    await dispatch('lista-paises', { sessionToken: s0.token, region: 'row' }, s0.ctx());
    assert.equal(s0.store.cont.put, 1, 'a renovação se repetiu no mesmo dia');
  } finally { s0.amb.restaurar(); }

  // A corrida: A (países, sem cookie novo) abriu a sessão com o prazo vencido;
  // B (perfil, com rotação) terminou antes e gravou. Quando A termina, a
  // renovação dela tem que RELER e achar a gravação de B — regravar o blob que
  // A leu no começo devolveria o cookie do login por cima da rotação.
  const s = await cenario({ modelo: 'Worker', idadeS: 25 * HORA });
  try {
    s.amb.rotaciona = (tipo) => tipo === 'perfil';
    const portas = new Map();
    s.amb.segurar = (tipo) => new Promise((ok) => portas.set(tipo, ok));
    const corpo = { sessionToken: s.token, region: 'row' };
    const a = dispatch('lista-paises', corpo, s.ctx());
    const b = dispatch('perfil', corpo, s.ctx());
    await ate(() => portas.size === 2, 'as 2 chamadas no Waze');
    portas.get('perfil')(); await b;
    const rotacaoDeB = 'ROT' + s.amb.idPorTipo.get('perfil');
    assert.equal(await s.guardado(), rotacaoDeB, 'CONTROLE: B não gravou a rotação');
    portas.get('paises')(); await a;
    assert.equal(await s.guardado(), rotacaoDeB, 'a renovação de A desfez a rotação que B tinha gravado');
    assert.equal(s.store.cont.put, 1, `A e B gravaram ${s.store.cont.put} vezes — B já tinha renovado o prazo`);
  } finally { s.amb.restaurar(); }
});

test('o formato gravado segue `carimbo|blob` (o da versão anterior), e o valor sem carimbo segue descartado', async () => {
  const s = await cenario({ modelo: 'Worker', idadeS: 25 * HORA });
  try {
    await dispatch('buscar-places', { sessionToken: s.token, region: 'row' }, s.ctx());
    const [chave, valor] = [...s.store.mem][0];
    assert.match(valor, /^\d+\|[A-Za-z0-9+/=]+::[A-Za-z0-9+/=]+$/, 'o valor gravado mudou de formato — a versão anterior não o leria');
    // Sem carimbo (o formato de antes da janela deslizante): some, com 401.
    s.store.mem.set(chave, valor.slice(valor.indexOf('|') + 1));
    const r = await dispatch('buscar-places', { sessionToken: s.token, region: 'row' }, s.ctx());
    assert.equal(r.status, 401);
    assert.equal(s.store.mem.has(chave), false, 'o valor sem carimbo não foi apagado');
  } finally { s.amb.restaurar(); }
});

test('o renovarPrazo não age sobre sessão que esta instância não abriu, nem ressuscita sessão apagada', async () => {
  const s = await cenario({ modelo: 'VM', idadeS: 25 * HORA });
  try {
    const sessions = s.ctx().sessions;
    // Nunca aberta aqui: nem a leitura.
    assert.equal(await sessions.renovarPrazo(s.token), false);
    assert.equal(s.store.cont.get + s.store.cont.put, 0, 'renovou (ou leu) uma sessão que ninguém abriu');
    // Aberta e depois apagada ("Sair" no meio): não volta.
    assert.ok(await sessions.loadSession(s.token));
    await sessions.destroySession(s.token);
    assert.equal(await sessions.renovarPrazo(s.token), false);
    assert.equal(s.store.mem.size, 0, 'a renovação recriou a sessão apagada');
    // CONTROLE: aberta e vencida, renova.
    const t = await cenario({ modelo: 'VM', idadeS: 25 * HORA });
    try {
      const ss = t.ctx().sessions;
      assert.ok(await ss.loadSession(t.token));
      assert.equal(await ss.renovarPrazo(t.token), true, 'CONTROLE: a sessão aberta e vencida não foi renovada');
      assert.equal(await ss.renovarPrazo(t.token), false, 'renovou duas vezes');
    } finally { t.amb.restaurar(); }
  } finally { s.amb.restaurar(); }
  assert.ok(SESSION_REFRESH_AFTER > SESSION_COOKIE_REFRESH, 'a renovação do prazo ficou mais frequente que a da rotação');
});

// ── o adaptador de VERDADE ────────────────────────────────────────────────
// O Worker cria um `makeSessions` por requisição e chama o `dispatch`: é esse
// encanamento que decide se a renovação acontece uma vez só. Importado de
// verdade, com o KV de mentira contando as escritas nas chaves de sessão.
test('Worker: a abertura com o prazo vencido grava a sessão UMA vez no KV', async () => {
  const { default: worker } = await import('../worker/index.mjs');
  for (const idadeS of [10 * MIN, 25 * HORA]) {
    const amb = ambiente();
    try {
      const kv = new Map();
      let escritasDeSessao = 0;
      const env = {
        ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        SESSIONS: {
          get: async (k) => kv.get(k) ?? null,
          put: async (k, v) => { if (k.startsWith('sess_') && !k.startsWith('sess_pair_') && !k.startsWith('sess_reler_')) escritasDeSessao++; kv.set(k, v); },
          delete: async (k) => { kv.delete(k); },
        },
        ASSETS: { fetch: () => new Response('asset') },
      };
      const sessions = makeSessions({
        store: { get: async (h) => kv.get('sess_' + h) ?? null, put: async (h, v) => { kv.set('sess_' + h, v); }, delete: async (h) => { kv.delete('sess_' + h); } },
        keyBytes: base64ToBytes(env.ENCRYPTION_KEY),
      });
      const token = await sessions.createSession(COOKIES);
      for (const [k, v] of kv) kv.set(k, (amb.agora - idadeS) + v.slice(v.indexOf('|')));
      const portas = new Map();
      amb.segurar = (tipo) => new Promise((ok) => portas.set(tipo, ok));
      const pedir = (rota) => worker.fetch(new Request('https://app.exemplo/api/' + rota, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: token, region: 'row' }),
      }), env, { waitUntil() {} });
      const pedidos = { paises: pedir('lista-paises'), perfil: pedir('perfil'), busca: pedir('buscar-places') };
      await ate(() => portas.size === 3, 'as 3 chamadas no Waze');
      for (const tipo of ['paises', 'perfil', 'busca']) { portas.get(tipo)(); assert.equal((await pedidos[tipo]).status, 200, tipo); }
      assert.equal(escritasDeSessao, idadeS > SESSION_REFRESH_AFTER ? 1 : 0,
        `carimbo de ${idadeS / HORA} h: a abertura gravou a sessão ${escritasDeSessao} vez(es) no KV`);
    } finally { amb.restaurar(); }
  }
});
