// A EXTENSÃO de verdade (`extensao-chrome/`), rodada em Node: o `inject.js` lendo
// o usuário do WME, o painel (`content.js`) que ele alimenta, o `background.js`
// que troca os cookies pelo token no servidor DE VERDADE (`dispatch`), e a
// `ponte.js` conversando com o app (o `entrarPelaExtensao` e o `API` de verdade).
// Auditoria da rodada 6 (R66-1, R66-2 e R6-1-10); cada teste foi visto
// REPROVANDO com o conserto desfeito.
//
// O DOM e o `chrome` são de mentira, com o mínimo que cada script usa — e o que
// eles devolvem é o que o navegador devolveria no que importa aqui.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { dispatch, makeSessions, isUserAllowed, WAZE_ESPERA_MS } from '../server/core.mjs';
import { storeEmMemoria } from './_sessao.mjs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const CONTENT = ler('extensao-chrome/content.js');
const INJECT = ler('extensao-chrome/inject.js');
const BACKGROUND = ler('extensao-chrome/background.js');
const PONTE = ler('extensao-chrome/ponte.js');
const MANIFESTO = JSON.parse(ler('extensao-chrome/manifest.json'));
const tique = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// O mínimo nível que o SERVIDOR exige, como ele o diz na recusa (a régua é dele).
const NIVEL_MINIMO = isUserAllowed({ rank: 0, isAreaManager: true, isStaff: false }).reasonVars.minLevel;

// ── O inject.js: o que ele manda a partir do usuário do WME ─────────────────
// Duas formas de usuário, porque o próprio inject.js trata as duas: objeto
// simples e modelo Backbone (`getAttribute`).
function usuarioDoWme({ rank, isAreaManager, isStaff, userName = 'editor' }, forma = 'objeto') {
  const campos = { userName, rank, isAreaManager, isStaff };
  if (forma === 'objeto') return campos;
  return { attributes: campos, getAttribute(k) { return this.attributes[k]; } };
}
function rodarInject(user, { locale = 'pt-BR' } = {}) {
  const postados = [];
  const ctx = {
    W: { loginManager: { user } }, I18n: { locale }, navigator: { language: 'en-US' },
    window: { postMessage: (m) => postados.push(m) },
    console: { log() {} }, setTimeout: () => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(INJECT, ctx);
  assert.equal(postados.length, 1, 'CONTROLE: o inject.js não mandou os dados do usuário');
  return postados[0];
}

// ── O painel (content.js) num DOM de mentira com o #sidebar do WME ──────────
function rodarPainel({ sendMessage = () => {} } = {}) {
  const todos = [];
  const alertas = [];
  const elemento = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(), id: '', className: '', children: [], style: {},
      innerText: '', innerHTML: '', disabled: false, title: '', src: '', ouvintes: {},
      appendChild(c) { this.children.push(c); return c; },
      addEventListener(tipo, fn) { (this.ouvintes[tipo] = this.ouvintes[tipo] || []).push(fn); },
      remove() {},
      // Como o navegador: botão `disabled` não recebe o clique.
      click() { if (this.disabled) return; for (const fn of this.ouvintes.click || []) fn({ type: 'click', target: this }); },
    };
    todos.push(el);
    return el;
  };
  const abas = elemento('ul');
  const conteudo = elemento('div');
  let ouvinte = null;
  // O RELÓGIO do painel é de mentira: nada dispara sozinho, e o teste dispara o
  // que quiser (o teto do ACESSAR, R7-1-06). O `clearTimeout` existe, como no
  // navegador — o painel desarma o teto quando a resposta chega.
  const agendados = new Map();
  let proximoTimer = 1;
  const chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => 'chrome-extension://ext/' + p,
      getManifest: () => MANIFESTO,
      sendMessage: (msg, cb) => sendMessage(msg, cb, chrome),
    },
  };
  const ctx = {
    document: {
      head: elemento('head'), body: elemento('body'), documentElement: elemento('html'),
      createElement: elemento,
      getElementById: (id) => todos.find((e) => e.id === id) || null,
      querySelector: (q) => (q === '#sidebar ul.nav-tabs' ? abas : q === '#sidebar .tab-content' ? conteudo : null),
    },
    chrome, alert: (m) => alertas.push(m), console,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (fn, ms) => { const id = proximoTimer++; agendados.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { agendados.delete(id); },
  };
  ctx.window = ctx;
  ctx.addEventListener = (tipo, fn) => { if (tipo === 'message') ouvinte = fn; };
  vm.createContext(ctx);
  vm.runInContext(CONTENT, ctx);
  assert.ok(ouvinte, 'CONTROLE: o content.js não ouve a mensagem do inject.js');
  // Lá dentro, `window` é o objeto GLOBAL do contexto (o vm troca o sandbox por
  // ele), e é com ele que o content.js confere quem mandou a mensagem.
  const global = vm.runInContext('globalThis', ctx);
  return {
    alertas, chrome,
    receber(msg) { ouvinte({ source: global, data: msg }); },
    botao: () => todos.find((e) => e.tagName === 'BUTTON'),
    // Tudo o que o painel escreve na tela (texto, HTML e o `title` do botão).
    textos: () => todos.map((e) => [e.innerText, e.innerHTML, e.title].filter(Boolean).join(' ')).join('\n'),
    // Os prazos armados (em ms), e disparar os de um prazo — como se ele vencesse.
    agendados: () => [...agendados.values()].map((a) => a.ms),
    disparar(ms) { for (const [id, a] of [...agendados]) if (a.ms === ms) { agendados.delete(id); a.fn(); } },
  };
}

// O dicionário do painel, lido do PRÓPRIO content.js (o objeto `translations`),
// pra o teste comparar com a frase que o painel escolheu.
function dicionarioDoPainel() {
  const i = CONTENT.indexOf('const translations = {');
  assert.ok(i > 0, 'CONTROLE: sumiu o dicionário do painel');
  let prof = 0;
  for (let j = CONTENT.indexOf('{', i); j < CONTENT.length; j++) {
    if (CONTENT[j] === '{') prof++;
    else if (CONTENT[j] === '}' && --prof === 0) {
      return vm.runInNewContext('(' + CONTENT.slice(CONTENT.indexOf('{', i), j + 1) + ')');
    }
  }
  throw new Error('o dicionário do painel não fecha');
}
const DICIONARIO = dicionarioDoPainel();
const LINGUAS_DO_PAINEL = Object.keys(DICIONARIO);

// ═══ R66-1 · o painel e o servidor têm o MESMO portão ═══════════════════════
// O botão ACESSAR exigia L3+AM (`parseInt(level) >= 3 && isAM`) e dizia "Nível
// 3+" — e no `title`, "maior que 3", que nem a regra antiga era —, enquanto o
// servidor admite L2+AM desde 2026-09-09 e staff sem AM (o `inject.js` nem
// mandava o `isStaff`). A mesma pessoa entrava pela ponte e era barrada no
// botão. O caso inteiro passa pelo `inject.js` de verdade, com o usuário do WME
// nas duas formas que ele trata.
test('R66-1: o botão ACESSAR do painel decide igual ao portão do servidor — L1 a L7, com e sem AM, staff', () => {
  const divergem = [];
  const vistos = new Set();
  for (const rank of [0, 1, 2, 3, 4, 5, 6]) {
    for (const isAreaManager of [true, false]) {
      for (const isStaff of [false, true]) {
        for (const forma of ['objeto', 'backbone']) {
          const servidor = isUserAllowed({ rank, isAreaManager, isStaff }).allowed;
          const painel = rodarPainel();
          painel.receber(rodarInject(usuarioDoWme({ rank, isAreaManager, isStaff }, forma)));
          const b = painel.botao();
          assert.ok(b, 'CONTROLE: o painel não desenhou o botão');
          const ativo = !b.disabled;
          vistos.add(ativo);
          if (ativo !== servidor) {
            divergem.push(`L${rank + 1}${isAreaManager ? '+AM' : ''}${isStaff ? ' staff' : ''} (${forma}): servidor ${servidor ? 'admite' : 'recusa'}, painel ${ativo ? 'ativo' : 'travado'}`);
          }
        }
      }
    }
  }
  // CONTROLE: a varredura viu os dois desfechos (senão "nenhuma divergência" não diz nada).
  assert.deepEqual([...vistos].sort(), [false, true], 'CONTROLE: o painel deu o mesmo desfecho em todos os casos');
  assert.deepEqual(divergem, [], 'o painel da extensão e o servidor discordam sobre quem entra');
});

test('R66-1: o painel diz o nível que o servidor exige, nas 4 línguas — e fala do Staff', () => {
  for (const lingua of [...LINGUAS_DO_PAINEL, 'de']) {
    // Recusado (L1+AM): o aviso e o `title` do botão travado.
    const recusado = rodarPainel();
    recusado.receber(rodarInject(usuarioDoWme({ rank: 0, isAreaManager: true, isStaff: false }), { locale: lingua }));
    assert.equal(recusado.botao().disabled, true, `CONTROLE (${lingua}): o L1+AM deveria ver o botão travado`);
    const tela = recusado.textos();
    const botao = recusado.botao().title;
    // Nenhum `{nivel}` cru na tela (o aviso, o title e a caixa passam TODOS pela constante).
    assert.doesNotMatch(tela, /\{nivel\}/, `${lingua}: o painel mostrou o marcador cru`);
    for (const [onde, txt] of [['o aviso e a caixa de informação', tela], ['o title do botão', botao]]) {
      assert.ok(txt.includes(`${NIVEL_MINIMO}+`), `${lingua}: ${onde} não diz "${NIVEL_MINIMO}+", o nível que o servidor exige: ${JSON.stringify(txt.slice(0, 300))}`);
      assert.match(txt, /Staff/, `${lingua}: ${onde} não diz que Staff também entra`);
      assert.doesNotMatch(txt, /\b3\+|maior que 3|> ?3\b|mayor a 3|supérieur à 3/, `${lingua}: ${onde} segue com a régua antiga (3)`);
    }
    // Admitido (L2+AM): a caixa de informação diz a mesma régua.
    const admitido = rodarPainel();
    admitido.receber(rodarInject(usuarioDoWme({ rank: NIVEL_MINIMO - 1, isAreaManager: true, isStaff: false }), { locale: lingua }));
    assert.equal(admitido.botao().disabled, false, `${lingua}: o L${NIVEL_MINIMO}+AM, que o servidor admite, vê o botão travado`);
    assert.ok(admitido.textos().includes(`${NIVEL_MINIMO}+`), `${lingua}: a caixa de informação não diz a régua do servidor`);
    assert.doesNotMatch(admitido.textos(), /\{nivel\}/, `${lingua}: o painel mostrou o marcador cru`);
  }
});

// O dicionário do painel: as MESMAS chaves nas 4 línguas, nenhuma vazia, e o
// mesmo marcador `{nivel}` onde houver (a régua do app pra o dicionário dele).
test('o dicionário do painel tem as mesmas chaves nas 4 línguas, e o mesmo `{nivel}` em cada uma', () => {
  const [ref, ...outras] = LINGUAS_DO_PAINEL;
  assert.ok(outras.length >= 3, `CONTROLE: só ${LINGUAS_DO_PAINEL.length} línguas no painel`);
  const chaves = Object.keys(DICIONARIO[ref]).sort();
  for (const l of outras) assert.deepEqual(Object.keys(DICIONARIO[l]).sort(), chaves, `${l}: chaves diferentes das do ${ref}`);
  for (const l of LINGUAS_DO_PAINEL) {
    for (const k of chaves) {
      const v = DICIONARIO[l][k];
      assert.ok(typeof v === 'string' && v.trim(), `${l}.${k} vazia`);
      assert.equal(/\{nivel\}/.test(v), /\{nivel\}/.test(DICIONARIO[ref][k]), `${l}.${k}: o {nivel} não bate com o do ${ref}`);
    }
  }
});

// ═══ R66-2 · o alerta de falha do painel sai INTEIRO na língua do WME ═══════
// O alerta juntava o prefixo traduzido com a frase CRUA do servidor (sempre em
// português) ou do próprio background — e no cookie vencido mandava "exportar os
// cookies", que não é o caminho de quem entra pela extensão. Cada cenário passa
// pelo background de verdade, que fala com o SERVIDOR de verdade (`dispatch`),
// com o Waze de mentira por baixo.
const COOKIE = (n, v) => ({ name: n, value: v, domain: '.waze.com', hostOnly: false, path: '/', secure: true });
const COOKIES_OK = [COOKIE('_web_session', 'S'), COOKIE('_csrf_token', 'C')];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

function rodarBackground({ cookies = COOKIES_OK, waze = () => json({}), rede = null } = {}) {
  const sessions = makeSessions({ store: storeEmMemoria(), keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const guardado = {};
  const abas = [];
  let ouvinte = null;
  const ctx = {
    chrome: {
      cookies: { getAll: (q, cb) => cb(cookies) },
      runtime: { onMessage: { addListener: (f) => { ouvinte = f; } }, onInstalled: { addListener() {} } },
      storage: { local: { set: (o, cb) => { Object.assign(guardado, o); if (cb) cb(); } } },
      tabs: { create: (o) => abas.push(o.url), query() {}, reload() {} },
    },
    // O servidor DE VERDADE, com o Waze de mentira (o `fetch` do core) só
    // durante a chamada.
    fetch: async (url, init) => {
      if (rede) throw rede;
      const salvo = globalThis.fetch;
      globalThis.fetch = async (u, i) => waze(String(u), i);
      try {
        const r = await dispatch('testar-cookies', JSON.parse(init.body), { sessions });
        return { json: async () => r.body };
      } finally { globalThis.fetch = salvo; }
    },
    setTimeout: (fn) => { fn(); return 0; },   // as esperas entre tentativas, sem esperar
    console, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(BACKGROUND, ctx);
  assert.ok(ouvinte, 'CONTROLE: o background não ouve mensagens');
  return {
    guardado, abas,
    pedir: (msg) => new Promise((res) => ouvinte(msg, { tab: { url: 'https://www.waze.com/editor' } }, res)),
  };
}

const PERFIL_L6 = { id: 4242, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
const CENARIOS = [
  // Os três "sem login no WME": a frase do servidor manda EXPORTAR cookies.
  { nome: 'cookie sem o CSRF', cookies: [COOKIE('_web_session', 'S')], tipo: 'semLogin' },
  { nome: 'cookie vencido (Waze 403)', waze: () => json({ errorList: [{ code: 101 }] }, 403), tipo: 'semLogin' },
  { nome: 'nenhum cookie do Waze', cookies: [], tipo: 'semLogin' },
  // O portão recusou (L1+AM).
  { nome: 'o portão recusou', waze: () => json({ ...PERFIL_L6, rank: 0 }), tipo: 'negado' },
  // O Waze fora do ar, e o Waze respondendo o que não é o perfil.
  { nome: 'Waze fora (503)', waze: () => json({}, 503), tipo: 'waze' },
  { nome: 'Waze com HTML no lugar do perfil', waze: () => new Response('<!doctype html><p>Unusual traffic</p>', { status: 200 }), tipo: 'waze' },
  // A ida ao Waze Places nem saiu.
  { nome: 'sem rede até o app', rede: new TypeError('Failed to fetch'), tipo: 'conexao' },
];
// O que o painel mostra, por tipo — a frase do PRÓPRIO dicionário do painel.
const FRASE_DO_TIPO = { semLogin: 'erroSemLogin', negado: 'erroNegado', waze: 'erroWaze', conexao: 'erroConexao' };

async function alertaDoPainel(cenario, lingua) {
  const bg = rodarBackground(cenario);
  let resposta = null;
  const painel = rodarPainel({ sendMessage: (msg, cb) => { bg.pedir(msg).then((r) => { resposta = r; cb(r); }); } });
  painel.receber(rodarInject(usuarioDoWme(PERFIL_L6), { locale: lingua }));
  painel.botao().click();
  for (let i = 0; i < 200 && !painel.alertas.length; i++) await tique();
  return { alertas: painel.alertas, resposta };
}

test('R66-2: o alerta de falha do painel sai inteiro na língua dele — nada cru do servidor, e nunca "exporte os cookies"', async () => {
  const cruas = new Set();
  for (const cenario of CENARIOS) {
    for (const lingua of LINGUAS_DO_PAINEL) {
      const t = DICIONARIO[lingua];
      const { alertas, resposta } = await alertaDoPainel(cenario, lingua);
      assert.equal(alertas.length, 1, `${cenario.nome} (${lingua}): o painel não avisou a falha`);
      const alerta = alertas[0];
      assert.ok(resposta && resposta.success === false, `CONTROLE (${cenario.nome}): a falha não aconteceu: ${JSON.stringify(resposta)}`);
      if (resposta.error) cruas.add(resposta.error);
      assert.ok(alerta.startsWith(t.errorLogin), `${cenario.nome} (${lingua}): o alerta perdeu o prefixo do painel: ${JSON.stringify(alerta)}`);
      const frase = t[FRASE_DO_TIPO[cenario.tipo]];
      assert.ok(typeof frase === 'string' && frase.length > 10, `${lingua}: o dicionário do painel não tem a frase "${FRASE_DO_TIPO[cenario.tipo]}"`);
      const esperado = frase.replace('{nivel}', String(NIVEL_MINIMO));
      assert.equal(alerta, t.errorLogin + esperado, `${cenario.nome} (${lingua}): o painel não escolheu a frase do caso`);
      assert.doesNotMatch(alerta, /xport/i, `${cenario.nome} (${lingua}): o alerta manda exportar cookies a quem usa a extensão`);
      if (lingua !== 'pt-BR' && resposta.error) {
        assert.ok(!alerta.includes(resposta.error), `${cenario.nome} (${lingua}): a frase crua (em português) foi pro alerta: ${JSON.stringify(alerta)}`);
      }
    }
  }
  // CONTROLE: as frases cruas que chegavam ao alerta eram MESMO portuguesas e
  // mandavam exportar — senão as asserções de cima não teriam dente.
  assert.ok([...cruas].some((c) => /xport/.test(c)), `CONTROLE: nenhuma frase crua mandava exportar: ${JSON.stringify([...cruas])}`);
  assert.ok([...cruas].some((c) => /Erro de conexão|Nenhum cookie/.test(c)), `CONTROLE: as frases do próprio background sumiram: ${JSON.stringify([...cruas])}`);
});

test('R66-2: a extensão que não responde (lastError do Chrome) também vira frase do painel, não a mensagem crua em inglês', () => {
  const CRU = 'Could not establish connection. Receiving end does not exist.';
  for (const lingua of LINGUAS_DO_PAINEL) {
    const painel = rodarPainel({ sendMessage: (msg, cb, chrome) => { chrome.runtime.lastError = { message: CRU }; cb(undefined); chrome.runtime.lastError = null; } });
    painel.receber(rodarInject(usuarioDoWme(PERFIL_L6), { locale: lingua }));
    painel.botao().click();
    assert.equal(painel.alertas.length, 1, `${lingua}: o painel não avisou`);
    assert.equal(painel.alertas[0], DICIONARIO[lingua].errorLogin + DICIONARIO[lingua].erroExtensao,
      `${lingua}: a mensagem crua do Chrome foi pro alerta`);
  }
});

test('R66-2: o background repassa a CHAVE do servidor junto da frase, no "sem login" também', async () => {
  const bg = rodarBackground({ waze: () => json({ errorList: [{ code: 101 }] }, 403) });
  const r = await bg.pedir({ action: 'abrirPlaces' });
  assert.equal(r.semLogin, true, 'CONTROLE: o cookie vencido deixou de ser "sem login" pra extensão');
  assert.equal(r.errorKey, 'srv.err.cookiesExpiredRelogin', 'o background jogou fora a chave que o servidor mandou');
});

// ═══ R7-1-06 · o ACESSAR trava enquanto loga, e volta em QUALQUER desfecho ══
// Cada toque no ACESSAR é um `abrirPlaces`: uma ida ao /Session do Waze no nome
// da pessoa, uma sessão nova no servidor e uma aba nova do app. O botão só
// trocava o texto pra "LOGANDO...", e o toque duplo (comum em botão de página)
// abria DUAS abas, com duas sessões da mesma conta — MEDIDO com a extensão de
// verdade, 2 cliques: 2 sessões criadas e 2 abas (1 e 1 com um clique). E,
// com o servidor pendurado, ele ficava em "LOGANDO..." pra sempre, sem aviso.
const ESPERA_DO_BOTAO_MS = Number((/^const ESPERA_DO_BOTAO_MS = (\d+);/m.exec(CONTENT) || [])[1]);

// O painel de um L6+AM com o `abrirPlaces` SEGURADO: a resposta sai quando o teste mandar.
function painelSegurado(lingua, { lanca = false } = {}) {
  const pedidos = [];
  const painel = rodarPainel({
    sendMessage: (msg, cb, chrome) => {
      if (lanca) throw new Error('Extension context invalidated.');
      pedidos.push({
        msg,
        responder: (resposta) => cb(resposta),
        // Como o Chrome: o `lastError` vale só DENTRO do callback.
        falharComLastError: (texto) => { chrome.runtime.lastError = { message: texto }; cb(undefined); chrome.runtime.lastError = null; },
      });
    },
  });
  painel.receber(rodarInject(usuarioDoWme(PERFIL_L6), { locale: lingua }));
  assert.equal(painel.botao().disabled, false, `CONTROLE (${lingua}): o L6+AM vê o ACESSAR liberado`);
  return { painel, pedidos, b: painel.botao(), t: DICIONARIO[lingua] };
}

test('R7-1-06: o ACESSAR trava enquanto loga — o toque duplo manda UM `abrirPlaces`, e ele volta quando a resposta chega', () => {
  for (const lingua of LINGUAS_DO_PAINEL) {
    const { painel, pedidos, b, t } = painelSegurado(lingua);
    b.click();
    b.click();   // o toque duplo
    assert.equal(pedidos.length, 1, `${lingua}: o toque duplo mandou ${pedidos.length} \`abrirPlaces\` — cada um é uma sessão e uma aba novas`);
    assert.equal(pedidos[0].msg.action, 'abrirPlaces');
    assert.equal(b.disabled, true, `${lingua}: o ACESSAR não trava enquanto loga`);
    assert.equal(b.innerText, t.loggingBtn);
    assert.deepEqual(painel.agendados(), [ESPERA_DO_BOTAO_MS], `${lingua}: o toque não armou o teto do botão`);
    pedidos[0].responder({ success: true });
    assert.equal(b.disabled, false, `${lingua}: o login terminou e o botão seguiu travado`);
    assert.equal(b.innerText, t.accessWazePlacesBtn);
    assert.deepEqual(painel.alertas, [], `${lingua}: o login que deu certo avisou alguma coisa`);
    assert.deepEqual(painel.agendados(), [], `${lingua}: a resposta chegou e o teto seguiu armado`);
    // CONTROLE: a trava é do login em curso, não um botão morto — destravado, ele manda de novo.
    b.click();
    assert.equal(pedidos.length, 2, `${lingua}: depois da resposta o ACESSAR não mandou de novo`);
  }
});

test('R7-1-06: o ACESSAR destrava em QUALQUER desfecho — a falha, a extensão que não responde ou lança, e o teto', () => {
  for (const lingua of LINGUAS_DO_PAINEL) {
    const desfechos = {
      'login do WME não achado': ({ pedidos }) => pedidos[0].responder({ success: false, semLogin: true, errorKey: 'srv.err.cookiesExpiredRelogin' }),
      'extensão sem resposta (lastError)': ({ pedidos }) => pedidos[0].falharComLastError('The message port closed before a response was received.'),
      'nada responde (o teto vence)': ({ painel }) => painel.disparar(ESPERA_DO_BOTAO_MS),
    };
    const fraseEsperada = (t, nome) => t.errorLogin + (nome.startsWith('login') ? t.erroSemLogin : t.erroExtensao);
    for (const [nome, desfecho] of Object.entries(desfechos)) {
      const p = painelSegurado(lingua);
      p.b.click();
      assert.equal(p.b.disabled, true, `CONTROLE (${lingua}, ${nome}): o botão não travou no toque`);
      desfecho(p);
      assert.equal(p.b.disabled, false, `${lingua}, ${nome}: o ACESSAR seguiu travado`);
      assert.equal(p.b.innerText, p.t.accessWazePlacesBtn, `${lingua}, ${nome}: o botão seguiu em "${p.b.innerText}"`);
      assert.deepEqual(p.painel.alertas, [fraseEsperada(p.t, nome)], `${lingua}, ${nome}: o aviso não diz o que fazer`);
      assert.deepEqual(p.painel.agendados(), [], `${lingua}, ${nome}: o teto seguiu armado`);
    }
    // A extensão que LANÇA no `sendMessage` (atualizada com a página do WME aberta).
    const lanca = painelSegurado(lingua, { lanca: true });
    lanca.b.click();
    assert.equal(lanca.b.disabled, false, `${lingua}: o \`sendMessage\` lançou e o ACESSAR ficou travado`);
    assert.deepEqual(lanca.painel.alertas, [lanca.t.errorLogin + lanca.t.erroExtensao], `${lingua}: o \`sendMessage\` que lança não avisou`);
    assert.deepEqual(lanca.painel.agendados(), [], `${lingua}: o \`sendMessage\` lançou e o teto ficou armado`);
  }
});

test('R7-1-06: a resposta que chega DEPOIS do teto não avisa de novo nem destrava o toque seguinte', () => {
  for (const lingua of LINGUAS_DO_PAINEL) {
    const { painel, pedidos, b, t } = painelSegurado(lingua);
    b.click();
    painel.disparar(ESPERA_DO_BOTAO_MS);
    assert.deepEqual(painel.alertas, [t.errorLogin + t.erroExtensao], `CONTROLE (${lingua}): o teto não avisou`);
    b.click();                          // tenta de novo: outro login no ar
    assert.equal(pedidos.length, 2, `CONTROLE (${lingua}): o toque depois do teto não mandou`);
    assert.equal(b.disabled, true);
    pedidos[0].responder({ success: false, semLogin: true });   // a resposta ATRASADA do primeiro
    assert.equal(b.disabled, true, `${lingua}: a resposta atrasada do 1º toque destravou o 2º login no ar`);
    assert.equal(painel.alertas.length, 1, `${lingua}: a resposta atrasada do 1º toque avisou de novo: ${JSON.stringify(painel.alertas)}`);
    pedidos[1].responder({ success: true });
    assert.equal(b.disabled, false, `${lingua}: o 2º login terminou e o botão seguiu travado`);
    assert.equal(painel.alertas.length, 1);
  }
});

// ═══ R7-6-07 · o painel diz o que o código faz, e o português tem acento ════
// O `info1`, em vermelho em todo painel, dizia que com o cookie vencido "o
// botão ficará travado com o texto 'logando...'" e mandava recarregar. Desde a
// 0.3.1 o cookie vencido volta como "sem login": o botão volta na hora e o
// aviso diz o que fazer (MEDIDO com a extensão de verdade). O painel prometia
// um sintoma que não acontece — e, com o teto da 0.3.2, nem o servidor
// pendurado deixa mais o botão parado. E o `info2` em português não tinha
// acento ("Apos", "icone", "Area").
const O_AVISO = { 'pt-BR': /\baviso\b/i, en: /\bmessage\b/i, es: /\baviso\b/i, fr: /\bmessage\b/i };

test('R7-6-07: o painel diz o que acontece quando o login falha — o aviso, e nunca o botão parado em "LOGANDO..."', async () => {
  for (const lingua of LINGUAS_DO_PAINEL) {
    const t = DICIONARIO[lingua];
    assert.ok(O_AVISO[lingua], `${lingua}: língua do painel sem a palavra do aviso neste teste — inclua-a`);
    // O que o CÓDIGO faz com o login do WME vencido (o background e o servidor de verdade).
    const bg = rodarBackground({ waze: () => json({ errorList: [{ code: 101 }] }, 403) });
    let respondeu = false;
    const painel = rodarPainel({ sendMessage: (msg, cb) => { bg.pedir(msg).then((r) => { respondeu = true; cb(r); }); } });
    painel.receber(rodarInject(usuarioDoWme(PERFIL_L6), { locale: lingua }));
    const oQueOPainelDiz = painel.textos();   // antes do toque: o botão ainda diz o seu nome
    painel.botao().click();
    for (let i = 0; i < 200 && !respondeu; i++) await tique();
    assert.ok(respondeu, `CONTROLE (${lingua}): o background não respondeu`);
    assert.equal(painel.botao().innerText, t.accessWazePlacesBtn, `CONTROLE (${lingua}): com o login vencido o botão não voltou`);
    assert.deepEqual(painel.alertas, [t.errorLogin + t.erroSemLogin], `CONTROLE (${lingua}): o aviso do login vencido mudou`);
    // O painel não promete o contrário.
    assert.ok(!oQueOPainelDiz.toLowerCase().includes(t.loggingBtn.toLowerCase()),
      `${lingua}: o painel diz que o botão fica parado em "${t.loggingBtn}", e ele volta com um aviso: ${JSON.stringify(t.info1)}`);
    // O que ele diz: se o login falhar, um aviso explica o que fazer.
    assert.match(t.info1, O_AVISO[lingua], `${lingua}: o info1 não fala do aviso: ${JSON.stringify(t.info1)}`);
  }
});

test('R7-6-07: o painel em português tem os acentos — "Após", "ícone", "Área"', () => {
  const pt = DICIONARIO['pt-BR'];
  const SEM_ACENTO = /\b(?:Apos|icone|Area(?! Manager))\b/;
  // CONTROLE: o padrão enxerga a frase de antes, e o "Area Manager" (o nome do papel no Waze) não conta.
  assert.match('Apos acessar o Waze Places clique no filtro ( icone de funil ) para configurar o seu Estado e Area', SEM_ACENTO);
  assert.doesNotMatch('Requer Nível 2+ e ser Area Manager (AM), ou ser Staff.', SEM_ACENTO);
  for (const [k, v] of Object.entries(pt)) assert.doesNotMatch(v, SEM_ACENTO, `pt-BR.${k} sem acento: "${v}"`);
  assert.match(pt.info2, /^Após acessar o Waze Places, clique no filtro \(ícone de funil\) /, `pt-BR.info2: "${pt.info2}"`);
});

test('R7-1-06: o teto do ACESSAR é maior que o do servidor pra ir ao Waze — o login lento ainda chega antes de o botão desistir', () => {
  assert.ok(Number.isInteger(ESPERA_DO_BOTAO_MS) && ESPERA_DO_BOTAO_MS > 0, 'CONTROLE: sumiu o `ESPERA_DO_BOTAO_MS` do content.js');
  assert.ok(ESPERA_DO_BOTAO_MS > WAZE_ESPERA_MS,
    `o botão desiste em ${ESPERA_DO_BOTAO_MS} ms, antes do servidor (${WAZE_ESPERA_MS} ms pro Waze): o login que o Waze atrasa avisaria "a extensão não respondeu" e abriria a aba depois`);
});

// ═══ R6-1-10 · o login pelo BOTÃO do WME diz a conta e passa pelo diário ═════
// O background guardava só o `token_pendente`, e a ponte o escrevia direto no
// localStorage no `document_start`: o app o lia como sessão GUARDADA — a conta
// que o `testar-cookies` devolve se perdia, e o diário de sessões marcava
// `jaAtiva` (início desconhecido, fora da mediana) no lugar de
// `token+:extensao`, justo nas sessões que ele existe pra medir. Agora a ponte
// entrega o token (com a conta) pela resposta ao `precisa-de-sessao` que o app
// sem sessão sempre faz na abertura — o mesmo caminho do login pela ponte.
//
// O caminho inteiro: o background de verdade (com o servidor de verdade) guarda
// o pendente; a ponte de verdade o lê na aba nova; o app de verdade (o `API` do
// api.js, o `entrarPelaExtensao` e o diário de sessões do app.js) abre.
const APP = ler('js/app.js');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) return APP_SEM.slice(m.index, j + 1);
  }
  throw new Error('não fechou: ' + nome);
}
const constante = (nome) => {
  const m = new RegExp('^const ' + nome + ' = [^;]*;', 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
};

const ORIGEM = 'https://places.wazebrasil.com';
// A aba do app: UM localStorage (o da origem, que a ponte e o app dividem) e a
// janela por onde o `postMessage` passa — entregue depois, como no navegador.
function abaDoApp(guardadoAntes = {}) {
  const guardado = new Map(Object.entries(guardadoAntes));
  const escritas = [];
  const armazenamento = (quem) => ({
    getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => { escritas.push(`${quem}:set:${k}`); guardado.set(k, String(v)); },
    removeItem: (k) => { escritas.push(`${quem}:remove:${k}`); guardado.delete(k); },
  });
  const ouvintes = [];
  const win = {
    location: { origin: ORIGEM },
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvintes.push(fn); },
    removeEventListener: (tipo, fn) => { const i = ouvintes.indexOf(fn); if (i >= 0) ouvintes.splice(i, 1); },
    postMessage: (data, alvo) => {
      if (alvo !== ORIGEM && alvo !== '*') return;
      setTimeout(() => {
        // Pro CONTROLE do teste da ordem: a pergunta chegou antes da leitura?
        if (data && data.action === 'precisa-de-sessao' && aba.perguntouAntesDaLeitura === null) aba.perguntouAntesDaLeitura = !aba.leituraFeita;
        for (const fn of [...ouvintes]) fn({ source: win, origin: ORIGEM, data });
      }, 0);
    },
  };
  const aba = { guardado, escritas, armazenamento, win, leituraFeita: false, perguntouAntesDaLeitura: null };
  return aba;
}

const NUNCA = Symbol('o chrome.storage não responde');
// A ponte (o content script do app) no `document_start` da aba, com o que o
// background deixou no `chrome.storage`.
function rodarPonte(aba, { pendente, autenticar = () => ({ success: false, semLogin: true }), atrasoDaLeitura = 0 }) {
  const pedidos = [];
  const removidos = [];
  const ctx = {
    window: aba.win, localStorage: aba.armazenamento('ponte'),
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => { pedidos.push(msg.action); setTimeout(() => cb(autenticar(msg)), 0); },
      },
      storage: {
        local: {
          // Assíncrono, como no Chrome: a resposta chega depois do `document_start`.
          // `NUNCA`: o storage de uma ponte órfã, que não responde.
          get: (chaves, cb) => {
            if (pendente === NUNCA) return;
            setTimeout(() => { aba.leituraFeita = true; cb(pendente === undefined ? {} : { token_pendente: pendente }); }, atrasoDaLeitura);
          },
          remove: (k) => { removidos.push(k); },
        },
      },
    },
    setTimeout, Date, console,
  };
  vm.createContext(ctx);
  vm.runInContext(PONTE, ctx);
  return { pedidos, removidos };
}

// O app nessa aba: o `API` do api.js de verdade e, do app.js, o diário de
// sessões, o `marcarSessaoJaAtiva` e o `entrarPelaExtensao`, com o mínimo em volta.
function rodarApp(aba) {
  const contas = [];
  const ctxApi = { localStorage: aba.armazenamento('app'), window: aba.win, t: (k) => k, console };
  vm.createContext(ctxApi);
  vm.runInContext(ler('js/api.js') + '\n;globalThis.__API = API;', ctxApi);
  const API = ctxApi.__API;
  const safeLS = {
    get: (k) => aba.guardado.has(k) ? aba.guardado.get(k) : null,
    set: (k, v) => aba.armazenamento('app').setItem(k, v),
    remove: (k) => aba.armazenamento('app').removeItem(k),
  };
  const deps = {
    window: aba.win, API, safeLS, AppState: {},
    epocaDaSessao: 0, extPerguntando: false, extNegadoNestaPagina: false, extNegado: null, filaAtravessouSessao: false,
    mostrarEntrandoPelaExtensao() {}, negadoDaExtensao: (n) => n, aoEntrarNestaPagina() {}, fecharModaisDaEntrada() {},
    showMainScreen() {}, resetQueue() {}, loadProfileAndAuxData() {}, startFetching() {}, esvaziarFilaDeSaida() {},
    conhecerContaDoLogin: (c) => contas.push(c),
    setTimeout, clearTimeout,
  };
  const chaves = Object.keys(deps);
  const corpo = [constante('EXT_PRESENTE_MS'), constante('EXT_ESPERA_MS'), constante('SESSOES_KEY'), constante('SESSOES_TETO'),
    ...['lerDiarioDeSessoes', 'registrarEventoDeSessao', 'marcarSessaoJaAtiva', 'entrarPelaExtensao'].map(fatiar),
    'return { lerDiarioDeSessoes, registrarEventoDeSessao, marcarSessaoJaAtiva, entrarPelaExtensao };'].join('\n');
  const app = new Function(...chaves, corpo)(...chaves.map((k) => deps[k]));
  // O gancho do diário mora no `API.setSession` (ver o api.js): é por ele que o
  // `token+` e o caminho de entrada são registrados.
  aba.win.__sessaoEvento = app.registrarEventoDeSessao;
  // A ABERTURA, como o `initApp` decide (o guard abaixo confere que é assim):
  // sessão guardada → abre com ela (e marca `jaAtiva`); sem → pergunta à extensão.
  const abrir = async () => {
    if (API.getSession()) { app.marcarSessaoJaAtiva(); return 'sessão guardada'; }
    return (await app.entrarPelaExtensao()) ? 'extensão' : 'tela de entrada';
  };
  const diario = () => app.lerDiarioDeSessoes().map((e) => e.e + (e.via ? ':' + e.via : ''));
  return { API, app, abrir, diario, contas };
}

test('R6-1-10: a abertura do app é a que o teste encena — sessão guardada abre com ela (jaAtiva); sem, pergunta à extensão', () => {
  const init = fatiar('initApp');
  assert.match(init, /if \(API\.getSession\(\)\) \{\s*abrirComSessaoSalva\(\);\s*\} else \{[\s\S]*?entrarPelaExtensao\(\)\.then\(/,
    'a abertura mudou: reveja o `abrir` deste teste (ele encena o `initApp`)');
  assert.match(fatiar('abrirComSessaoSalva'), /^function abrirComSessaoSalva\(\) \{\s*marcarSessaoJaAtiva\(\);/,
    'a abertura com sessão guardada deixou de marcar `jaAtiva`: reveja este teste');
});

async function botaoDoWme({ guardadoAntes = {}, idadeDoPendente = 0 } = {}) {
  // 1. O botão no WME: o background de verdade autentica e guarda o pendente.
  const bg = rodarBackground({ waze: () => json(PERFIL_L6) });
  const r = await bg.pedir({ action: 'abrirPlaces' });
  assert.equal(r.success, true, `CONTROLE: o login do botão não deu certo: ${JSON.stringify(r)}`);
  assert.deepEqual(bg.abas, ['https://places.wazebrasil.com/'], 'CONTROLE: o botão não abriu a aba do app');
  const pendente = bg.guardado.token_pendente;
  if (pendente && typeof pendente === 'object' && idadeDoPendente) pendente.em -= idadeDoPendente;
  // 2. A aba nova: a ponte no `document_start`, e o app no DOMContentLoaded.
  const aba = abaDoApp(guardadoAntes);
  const ponte = rodarPonte(aba, { pendente, autenticar: () => ({ success: true, sessionToken: 'tok-da-ponte', conta: '4242' }) });
  await tique(5);   // a leitura do `chrome.storage` chegou; os scripts do app carregam depois
  const app = rodarApp(aba);
  const abriu = await app.abrir();
  return { aba, ponte, app, abriu, pendente };
}

test('R6-1-10: o login pelo BOTÃO do WME chega ao app com a conta, e o diário marca `token+:extensao`', async () => {
  const { aba, ponte, app, abriu, pendente } = await botaoDoWme();
  assert.ok(pendente, 'CONTROLE: o background não deixou nada pra aba nova');
  assert.equal(abriu, 'extensão', `o app abriu pela ${abriu}, e não pela resposta da extensão (o token do botão foi escrito no localStorage)`);
  assert.deepEqual(app.diario(), ['token+:extensao'], 'o diário de sessões não registrou o login pela extensão');
  assert.deepEqual(app.contas, ['4242'], 'a conta que o `testar-cookies` devolveu se perdeu no caminho');
  assert.equal(aba.guardado.get('waze_session_token'), pendente.token, 'o app não ficou com o token do botão');
  assert.deepEqual(ponte.pedidos, [], 'a ponte pediu OUTRO login ao background, com o do botão em mãos');
  assert.ok(!aba.escritas.includes('ponte:set:waze_session_token'), 'a ponte ainda escreve o token no localStorage do app');
  assert.deepEqual(ponte.removidos, ['token_pendente'], 'o pendente ficou no chrome.storage (seria entregue de novo)');
});

test('R6-1-10: o botão VENCE a sessão guardada (como quando a ponte escrevia o token por cima)', async () => {
  const { aba, app, abriu, pendente } = await botaoDoWme({ guardadoAntes: { waze_session_token: 'tok-de-ontem' } });
  assert.equal(abriu, 'extensão', `com uma sessão guardada, o app abriu pela ${abriu} e ignorou o botão`);
  assert.equal(aba.guardado.get('waze_session_token'), pendente.token, 'a sessão de antes venceu o botão do WME');
  assert.deepEqual(app.contas, ['4242']);
});

test('R6-1-10: pendente VELHO não é entregue (outro login, sem tocar na sessão guardada); e o pendente vale UMA vez', async () => {
  // Velho: a aba não abriu na hora (sem rede, fechada antes de carregar). Entregá-lo
  // depois seria entrar com o login de outra hora — talvez de outra conta do WME.
  const velho = await botaoDoWme({ guardadoAntes: { waze_session_token: 'tok-de-ontem' }, idadeDoPendente: 10 * 60 * 1000 });
  assert.equal(velho.abriu, 'sessão guardada', 'o pendente velho derrubou a sessão guardada');
  assert.equal(velho.aba.guardado.get('waze_session_token'), 'tok-de-ontem');
  // E sem sessão guardada, o velho não serve: a ponte pede um login novo.
  const semSessao = await botaoDoWme({ idadeDoPendente: 10 * 60 * 1000 });
  assert.equal(semSessao.abriu, 'extensão');
  assert.deepEqual(semSessao.ponte.pedidos, ['autenticar'], 'o pendente velho foi entregue');
  assert.equal(semSessao.aba.guardado.get('waze_session_token'), 'tok-da-ponte');
  // Uma vez: a segunda pergunta da mesma página (a sessão caiu) vai ao background.
  const { app, ponte } = await botaoDoWme();
  app.API.setSession(null);
  assert.equal(await app.app.entrarPelaExtensao({ silencioso: true }), true);
  assert.deepEqual(ponte.pedidos, ['autenticar'], 'o mesmo pendente foi entregue duas vezes');
});

test('R6-1-10: o app que pergunta ANTES de a ponte ler o chrome.storage também recebe o pendente', async () => {
  const bg = rodarBackground({ waze: () => json(PERFIL_L6) });
  await bg.pedir({ action: 'abrirPlaces' });
  const aba = abaDoApp();
  // O chrome.storage demora (30 ms) e o app pergunta já: a pergunta chega antes.
  const ponte = rodarPonte(aba, { pendente: bg.guardado.token_pendente, atrasoDaLeitura: 30 });
  const app = rodarApp(aba);
  assert.equal(await app.abrir(), 'extensão');
  assert.equal(aba.perguntouAntesDaLeitura, true, 'CONTROLE: a pergunta não chegou antes da leitura — o teste não mede a ordem');
  assert.deepEqual(ponte.pedidos, [], 'com o pendente a caminho, a ponte foi pedir outro login');
  assert.deepEqual(app.contas, ['4242']);
});

test('R6-1-10: o chrome.storage que não responde (a ponte órfã) não segura a pergunta do app', async () => {
  const aba = abaDoApp();
  const ponte = rodarPonte(aba, { pendente: NUNCA, autenticar: () => ({ success: true, sessionToken: 'tok-da-ponte', conta: '4242' }) });
  const app = rodarApp(aba);
  const t0 = Date.now();
  assert.equal(await app.abrir(), 'extensão', 'a pergunta ficou esperando o storage até o prazo do app');
  const levou = Date.now() - t0;
  assert.ok(levou < 3000, `a resposta levou ${levou} ms — a espera pelo storage não tem teto`);
  assert.deepEqual(ponte.pedidos, ['autenticar']);
});
