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

// ── Um RELÓGIO de mentira, pra quem precisa que o tempo ANDE ────────────────
// `setTimeout` agenda na hora virtual, `Date.now()` lê a hora virtual, e
// `andar` roda os timers na ordem, pulando o relógio de um pro outro. Entre um
// timer e outro ele deixa terminar o que NÃO é timer: as microtarefas e o
// trabalho de verdade em voo (`acompanhar`: o servidor de verdade cifrando a
// sessão). Sem isso o relógio pularia pro próximo timer — o prazo do login,
// 40 s adiante — com a resposta do servidor ainda a caminho (R8-6-01).
function relogioVirtual(inicio = Date.now()) {
  let agora = inicio;
  let proximo = 1;
  const fila = new Map();
  const emVoo = new Set();
  const folga = () => new Promise((r) => setImmediate(r));
  return {
    agora: () => agora,
    Date: { now: () => agora },
    setTimeout: (fn, ms) => { const id = proximo++; fila.set(id, { fn, quando: agora + Math.max(0, Number(ms) || 0) }); return id; },
    clearTimeout: (id) => { fila.delete(id); },
    acompanhar(p) { emVoo.add(p); const sai = () => emVoo.delete(p); p.then(sai, sai); return p; },
    // Anda até `pronto()` dar verdade, ou até a hora `ate` — o que vier antes.
    async andar({ ate = Infinity, pronto = () => false } = {}) {
      for (;;) {
        await folga();
        while (emVoo.size) { await Promise.allSettled([...emVoo]); await folga(); }
        if (pronto()) return true;
        let prox = null;
        for (const [id, t] of fila) if (!prox || t.quando < prox[1].quando) prox = [id, t];
        if (!prox || prox[1].quando > ate) {
          if (Number.isFinite(ate) && ate > agora) agora = ate;
          return pronto();
        }
        fila.delete(prox[0]);
        agora = prox[1].quando;
        prox[1].fn();
      }
    },
  };
}

// ── O painel (content.js) num DOM de mentira com o #sidebar do WME ──────────
// Com `relogio`, os timers e o `Date.now()` do painel são os dele (o mesmo do
// background, no teste do prazo do login); sem, nada dispara sozinho (abaixo).
function rodarPainel({ sendMessage = () => {}, relogio = null } = {}) {
  const todos = [];
  const alertas = [];
  const alertasEm = [];
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
    chrome, alert: (m) => { alertas.push(m); alertasEm.push(relogio ? relogio.agora() : null); }, console,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: relogio ? relogio.setTimeout : (fn, ms) => { const id = proximoTimer++; agendados.set(id, { fn, ms }); return id; },
    clearTimeout: relogio ? relogio.clearTimeout : (id) => { agendados.delete(id); },
    ...(relogio ? { Date: relogio.Date } : {}),
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
    alertas, alertasEm, chrome,
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

// O relógio é o de mentira (acima): as esperas entre tentativas andam com ele,
// sem esperar de verdade, e o prazo do login do botão (R8-6-01) só vence se o
// tempo virtual chegar lá. `servidor` troca o servidor de verdade por um de
// mentira (o teste do prazo, que precisa de idas LENTAS).
function rodarBackground({ cookies = COOKIES_OK, waze = () => json({}), rede = null, servidor = null, relogio = relogioVirtual() } = {}) {
  const sessions = makeSessions({ store: storeEmMemoria(), keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const guardado = {};
  const abas = [];
  const abasEm = [];
  let ouvinte = null;
  const ctx = {
    chrome: {
      cookies: { getAll: (q, cb) => cb(cookies) },
      runtime: { onMessage: { addListener: (f) => { ouvinte = f; } }, onInstalled: { addListener() {} } },
      storage: { local: { set: (o, cb) => { Object.assign(guardado, o); if (cb) cb(); } } },
      tabs: { create: (o) => { abas.push(o.url); abasEm.push(relogio.agora()); }, query() {}, reload() {} },
    },
    // O servidor DE VERDADE, com o Waze de mentira (o `fetch` do core) só
    // durante a chamada.
    fetch: servidor || ((url, init) => relogio.acompanhar((async () => {
      if (rede) throw rede;
      const salvo = globalThis.fetch;
      globalThis.fetch = async (u, i) => waze(String(u), i);
      try {
        const r = await dispatch('testar-cookies', JSON.parse(init.body), { sessions });
        return { json: async () => r.body };
      } finally { globalThis.fetch = salvo; }
    })())),
    AbortController,
    setTimeout: relogio.setTimeout, clearTimeout: relogio.clearTimeout,
    console, Date: relogio.Date,
  };
  vm.createContext(ctx);
  vm.runInContext(BACKGROUND, ctx);
  assert.ok(ouvinte, 'CONTROLE: o background não ouve mensagens');
  const ABA_DO_WME = { tab: { url: 'https://www.waze.com/editor' } };
  const ABA_DO_APP = { tab: { url: 'https://places.wazebrasil.com/' } };
  return {
    guardado, abas, abasEm, relogio,
    // Uma constante do background.js, lida do script que rodou.
    constante: (nome) => {
      try { return vm.runInContext(nome, ctx); } catch { assert.fail(`sumiu a constante ${nome} do background.js`); }
    },
    // A mensagem entra, e quem chamou anda com o relógio.
    ouvir: (msg, responder) => ouvinte(msg, ABA_DO_WME, responder),
    // A mensagem da PONTE, que vem da aba do app.
    ouvirDaPonte: (msg, responder) => ouvinte(msg, ABA_DO_APP, responder),
    // A mensagem entra, e o relógio anda até a resposta.
    pedir: async (msg) => {
      let resposta, chegou = false;
      ouvinte(msg, ABA_DO_WME, (r) => { resposta = r; chegou = true; });
      assert.ok(await relogio.andar({ pronto: () => chegou }), `o background não respondeu a ${JSON.stringify(msg)}`);
      return resposta;
    },
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

// ═══ R8-6-01 = R8-1-02 · o login do ACESSAR tem prazo TOTAL, abaixo do teto ═══
// O teto de 45 s do botão era comparado com UMA ida ao servidor (que espera o
// Waze até 30 s), e o background repete o login em toda falha passageira: até 4
// idas, com 4,6 s de espera entre elas. O Waze que estourava os 30 s na 1ª ida e
// respondia na 2ª fazia o botão voltar aos 45 s com "A extensão não respondeu.
// Recarregue esta página e tente de novo." — e a aba do app abria DEPOIS, aos
// 50,6 s; quem obedecia ao aviso abria a segunda sessão e a segunda aba (MEDIDO
// num relógio virtual com o content.js e o background.js de verdade). Agora o
// `abrirPlaces` tem prazo TOTAL (`PRAZO_DO_BOTAO_MS`), contado do toque: nenhuma
// ida começa depois dele, a que está no ar é cancelada, e a resposta que chega
// depois não abre aba.
//
// O servidor aqui é de mentira, porque as idas precisam ser LENTAS. Cada ida
// segue o plano da vez (`ms` até a resposta; `ok` dá a sessão) e, como o `fetch`
// do Chrome, para quando o sinal cancela — menos com `ignoraCancelamento`. As
// respostas são as do servidor DE VERDADE: a sessão, e a falha que ele dá quando
// o `callWaze` aborta a ida ao Waze nos 30 s (`WAZE_ESPERA_MS`).
const COOKIES_TXT = ['.waze.com\tTRUE\t/\tTRUE\t9999999999\t_csrf_token\tc', '.waze.com\tTRUE\t/\tTRUE\t9999999999\t_web_session\ts'].join('\n');
async function respostaDoServidor(waze) {
  const sessions = makeSessions({ store: storeEmMemoria(), keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const salvo = globalThis.fetch;
  globalThis.fetch = waze;
  try { return (await dispatch('testar-cookies', { cookies: COOKIES_TXT, region: 'row' }, { sessions })).body; }
  finally { globalThis.fetch = salvo; }
}
const WAZE_ESTOUROU = await respostaDoServidor(async () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; });
const SESSAO_OK = await respostaDoServidor(async () => json(PERFIL_L6));

function servidorLento(relogio, idas, { ignoraCancelamento = false } = {}) {
  const registro = [];   // cada ida: quando saiu, quando terminou, e como ('sessão', 'falha' ou 'cancelada')
  const servidor = (url, init = {}) => new Promise((ok, falha) => {
    const plano = idas[Math.min(registro.length, idas.length - 1)];
    const ida = { saiu: relogio.agora(), fim: null, como: null };
    registro.push(ida);
    const corpo = plano.ok ? { ...SESSAO_OK, sessionToken: `tok-${registro.length}` } : WAZE_ESTOUROU;
    const id = relogio.setTimeout(() => {
      if (ida.como) return;
      ida.fim = relogio.agora();
      ida.como = plano.ok ? 'sessão' : 'falha';
      ok({ json: async () => structuredClone(corpo) });
    }, plano.ms);
    if (ignoraCancelamento || !init.signal) return;
    const cancelar = () => {
      if (ida.como) return;   // já respondeu: cancelar não desfaz a resposta
      ida.fim = relogio.agora();
      ida.como = 'cancelada';
      relogio.clearTimeout(id);
      falha(new DOMException('The operation was aborted.', 'AbortError'));
    };
    if (init.signal.aborted) cancelar(); else init.signal.addEventListener('abort', cancelar, { once: true });
  });
  return { servidor, registro };
}

// O toque no ACESSAR de um L6+AM: o painel e o background de verdade num relógio
// só, com o servidor lento. `entregaMs`: a mensagem do toque demora pra chegar ao
// background (o service worker acordando). `tocarDeNovo`: quantos ms depois do
// aviso a pessoa toca de novo, como ele pede. `responde: false`: a extensão muda.
// Depois disso o tempo passa (10 minutos), pra ver o que abre DEPOIS.
async function acessarComServidorLento({ idas, lingua = 'pt-BR', entregaMs = 0, tocarDeNovo = null, ignoraCancelamento = false, responde = true }) {
  const relogio = relogioVirtual();
  const t0 = relogio.agora();
  const { servidor, registro } = servidorLento(relogio, idas, { ignoraCancelamento });
  const bg = rodarBackground({ servidor, relogio });
  const mensagens = [];
  const painel = rodarPainel({
    relogio,
    sendMessage: (msg, cb) => {
      mensagens.push(msg);
      if (responde) relogio.setTimeout(() => bg.ouvir(msg, cb), entregaMs);
    },
  });
  painel.receber(rodarInject(usuarioDoWme(PERFIL_L6), { locale: lingua }));
  const b = painel.botao();
  assert.equal(b.disabled, false, `CONTROLE (${lingua}): o L6+AM vê o ACESSAR liberado`);
  b.click();
  let segundoToque = null;
  if (tocarDeNovo !== null) {
    assert.ok(await relogio.andar({ pronto: () => painel.alertas.length > 0 }), 'CONTROLE: o aviso não saiu, e o 2º toque não tem quando');
    await relogio.andar({ ate: relogio.agora() + tocarDeNovo });
    segundoToque = relogio.agora() - t0;
    assert.equal(b.disabled, false, 'CONTROLE: o botão não voltou pro 2º toque');
    b.click();
  }
  await relogio.andar({ ate: t0 + 10 * 60 * 1000 });
  const rel = (t) => t - t0;
  return {
    t: DICIONARIO[lingua], b, mensagens, segundoToque, PRAZO: bg.constante('PRAZO_DO_BOTAO_MS'),
    idas: registro.map((i) => ({ saiu: rel(i.saiu), fim: i.fim === null ? null : rel(i.fim), como: i.como })),
    alertas: painel.alertas, alertasEm: painel.alertasEm.map(rel),
    abasEm: bg.abasEm.map(rel), pendente: bg.guardado.token_pendente || null,
  };
}
const segundos = (lista) => lista.map((ms) => `${ms / 1000} s`).join(', ') || 'nenhum';

test('R8-6-01: o Waze que estoura os 30 s na 1ª ida e responderia na 2ª não abre mais a aba depois do aviso — o botão volta antes do teto, dizendo o que aconteceu', async () => {
  for (const lingua of LINGUAS_DO_PAINEL) {
    const r = await acessarComServidorLento({ idas: [{ ms: WAZE_ESPERA_MS, ok: false }, { ms: 20000, ok: true }], lingua });
    // CONTROLE: o caso é o do achado — a 2ª ida saiu, e a sessão dela chegaria depois do teto do botão.
    assert.equal(r.idas.length, 2, `CONTROLE (${lingua}): ${JSON.stringify(r.idas)}`);
    assert.ok(r.idas[1].saiu + 20000 > ESPERA_DO_BOTAO_MS, `CONTROLE (${lingua}): a 2ª ida responderia antes do teto: ${JSON.stringify(r.idas)}`);
    assert.deepEqual(r.abasEm, [], `${lingua}: a aba do app abriu aos ${segundos(r.abasEm)}, e o aviso saiu aos ${segundos(r.alertasEm)}`);
    assert.equal(r.pendente, null, `${lingua}: o login que desistiu deixou o token guardado pra aba do app`);
    assert.equal(r.idas[1].como, 'cancelada', `${lingua}: a ida no ar seguiu depois do prazo do login: ${JSON.stringify(r.idas[1])}`);
    assert.ok(r.idas[1].fim <= r.PRAZO, `${lingua}: a ida foi cancelada aos ${r.idas[1].fim} ms, depois do prazo (${r.PRAZO} ms)`);
    assert.equal(r.alertas.length, 1, `${lingua}: ${JSON.stringify(r.alertas)}`);
    assert.ok(r.alertasEm[0] < ESPERA_DO_BOTAO_MS, `${lingua}: o botão só voltou no teto (${r.alertasEm[0]} ms), com o login ainda no ar`);
    assert.equal(r.alertas[0], r.t.errorLogin + r.t.erroWaze, `${lingua}: o aviso não diz que foi o Waze que não respondeu: ${JSON.stringify(r.alertas[0])}`);
    assert.equal(r.b.disabled, false, `${lingua}: o botão seguiu travado`);
    assert.equal(r.b.innerText, r.t.accessWazePlacesBtn);
  }
});

test('R8-6-01: tocar de novo depois do aviso, como ele pede, abre UMA aba — a do 2º toque, nunca a do login que desistiu', async () => {
  const r = await acessarComServidorLento({ idas: [{ ms: WAZE_ESPERA_MS, ok: false }, { ms: 20000, ok: true }, { ms: 5000, ok: true }], tocarDeNovo: 1000 });
  assert.equal(r.idas.length, 3, `CONTROLE: ${JSON.stringify(r.idas)}`);
  assert.ok(r.idas[2].saiu >= r.segundoToque, `CONTROLE: a 3ª ida não é a do 2º toque: ${JSON.stringify(r.idas)}`);
  assert.equal(r.abasEm.length, 1, `abriram ${r.abasEm.length} abas (aos ${segundos(r.abasEm)}): duas sessões e duas abas da mesma conta`);
  assert.ok(r.abasEm[0] >= r.segundoToque, `a aba que abriu (aos ${segundos(r.abasEm)}) é a do login que desistiu`);
  assert.equal(r.pendente && r.pendente.token, 'tok-3', 'o token guardado pra aba não é o do 2º toque');
});

test('R8-6-01: com o servidor pendurado, o botão volta no prazo do login dizendo que não falou com o Waze Places — "a extensão não respondeu" fica pra extensão muda', async () => {
  for (const lingua of LINGUAS_DO_PAINEL) {
    const r = await acessarComServidorLento({ idas: [{ ms: Infinity, ok: false }], lingua });
    assert.equal(r.idas.length, 1, `CONTROLE (${lingua}): ${JSON.stringify(r.idas)}`);
    assert.equal(r.idas[0].como, 'cancelada', `${lingua}: a ida pendurada não foi cancelada: ${JSON.stringify(r.idas[0])}`);
    assert.ok(r.idas[0].fim <= r.PRAZO, `${lingua}: cancelada aos ${r.idas[0].fim} ms, depois do prazo`);
    assert.deepEqual(r.abasEm, []);
    assert.equal(r.alertas.length, 1, `${lingua}: ${JSON.stringify(r.alertas)}`);
    assert.ok(r.alertasEm[0] <= r.PRAZO, `${lingua}: o botão voltou aos ${r.alertasEm[0]} ms, depois do prazo do login`);
    assert.equal(r.alertas[0], r.t.errorLogin + r.t.erroConexao, `${lingua}: ${JSON.stringify(r.alertas[0])}`);
    // CONTROLE: a extensão que não responde nada segue caindo no teto do botão, com o aviso dela.
    const muda = await acessarComServidorLento({ idas: [{ ms: 1, ok: true }], lingua, responde: false });
    assert.deepEqual(muda.alertasEm, [ESPERA_DO_BOTAO_MS], `CONTROLE (${lingua}): o teto do botão não venceu na hora dele`);
    assert.deepEqual(muda.alertas, [muda.t.errorLogin + muda.t.erroExtensao], `CONTROLE (${lingua}): o aviso do teto mudou`);
  }
});

test('R8-6-01: o prazo conta do TOQUE — o service worker que demora a acordar não empurra o login pra depois do aviso, e a mensagem que chega depois do prazo nem vai ao servidor', async () => {
  const PRAZO = rodarBackground().constante('PRAZO_DO_BOTAO_MS');
  const ESPERA_1 = rodarBackground().constante('ESPERAS_MS')[0];
  // A mensagem chega 1 s depois da folga entre o prazo e o teto; a 2ª ida daria
  // certo ENTRE o teto do botão e o prazo contado da CHEGADA — contado dela, a aba
  // abriria depois do aviso.
  const entregaMs = ESPERA_DO_BOTAO_MS - PRAZO + 1000;
  const sessaoEm = Math.round((ESPERA_DO_BOTAO_MS + entregaMs + PRAZO) / 2);
  const idas = [{ ms: WAZE_ESPERA_MS, ok: false }, { ms: sessaoEm - (entregaMs + WAZE_ESPERA_MS + ESPERA_1), ok: true }];
  const r = await acessarComServidorLento({ entregaMs, idas });
  assert.equal(typeof r.mensagens[0].desde, 'number', 'o painel não manda a hora do toque');
  assert.ok(r.idas[0].saiu >= entregaMs, `CONTROLE: a mensagem não chegou atrasada: ${JSON.stringify(r.idas)}`);
  assert.equal(r.idas.length, 2, `CONTROLE: ${JSON.stringify(r.idas)}`);
  assert.ok(sessaoEm > ESPERA_DO_BOTAO_MS && sessaoEm < entregaMs + PRAZO, 'CONTROLE: a sessão não cai entre o teto e o prazo contado da chegada');
  assert.deepEqual(r.abasEm, [], `a aba abriu aos ${segundos(r.abasEm)}, e o aviso saiu aos ${segundos(r.alertasEm)}`);
  assert.equal(r.alertas.length, 1);
  assert.ok(r.alertasEm[0] <= PRAZO, `o botão voltou aos ${r.alertasEm[0]} ms: o prazo contou da chegada, e não do toque`);
  // A mensagem que chega DEPOIS do prazo (o service worker que levou mais que ele pra acordar).
  const tarde = await acessarComServidorLento({ entregaMs: PRAZO + 1000, idas: [{ ms: 1000, ok: true }] });
  assert.deepEqual(tarde.idas, [], 'a mensagem que chegou depois do prazo foi ao servidor (uma ida ao Waze no nome da pessoa, e a aba depois do aviso)');
  assert.deepEqual(tarde.abasEm, []);
});

test('R8-6-01: a sessão que chega depois do prazo não abre aba nem fica guardada pra aba nenhuma — mesmo com uma ida que não se deixa cancelar', async () => {
  const tardia = await acessarComServidorLento({ ignoraCancelamento: true, idas: [{ ms: WAZE_ESPERA_MS, ok: false }, { ms: 20000, ok: true }] });
  assert.equal(tardia.idas[1].como, 'sessão', `CONTROLE: a ida não terminou com a sessão: ${JSON.stringify(tardia.idas)}`);
  assert.ok(tardia.idas[1].fim > tardia.PRAZO, 'CONTROLE: a sessão chegou dentro do prazo');
  assert.deepEqual(tardia.abasEm, [], `a sessão que chegou aos ${tardia.idas[1].fim} ms abriu a aba`);
  assert.equal(tardia.pendente, null, 'a sessão que chegou depois do prazo ficou guardada pra aba do app');
  // CONTROLE: a mesma ida, dentro do prazo, abre a aba.
  const aTempo = await acessarComServidorLento({ ignoraCancelamento: true, idas: [{ ms: WAZE_ESPERA_MS, ok: false }, { ms: 4000, ok: true }] });
  assert.equal(aTempo.abasEm.length, 1, `CONTROLE: ${JSON.stringify(aTempo.idas)}`);
  assert.ok(aTempo.abasEm[0] < aTempo.PRAZO);
  assert.deepEqual(aTempo.alertas, []);
});

test('R8-6-01: o teto do ACESSAR se compara com o PIOR caso do login inteiro — todas as idas, e não uma só', async () => {
  assert.ok(Number.isInteger(ESPERA_DO_BOTAO_MS) && ESPERA_DO_BOTAO_MS > 0, 'CONTROLE: sumiu o `ESPERA_DO_BOTAO_MS` do content.js');
  const bg0 = rodarBackground();
  const MAX = bg0.constante('MAX_TENTATIVAS');
  const ESPERAS = bg0.constante('ESPERAS_MS');
  const PRAZO = bg0.constante('PRAZO_DO_BOTAO_MS');
  // Sem prazo, o pior caso é a SOMA: toda ida esperando o Waze até os 30 s do
  // servidor, e as esperas entre elas. Comparar o teto com uma ida só escondia isso.
  const semPrazo = MAX * WAZE_ESPERA_MS + ESPERAS.slice(0, MAX - 1).reduce((a, b) => a + b, 0);
  assert.ok(WAZE_ESPERA_MS < ESPERA_DO_BOTAO_MS && semPrazo > ESPERA_DO_BOTAO_MS,
    `CONTROLE: uma ida (${WAZE_ESPERA_MS} ms) cabe no teto (${ESPERA_DO_BOTAO_MS} ms), e o login inteiro sem prazo (${semPrazo} ms) não`);
  // CONTROLE MEDIDO: o login sem prazo (o `autenticar` chamado sem `ate`, que era
  // o da ponte até a 0.3.3) leva exatamente essa soma com toda ida estourando — o
  // instrumento mede a cadeia inteira de tentativas.
  {
    const relogio = relogioVirtual();
    const { servidor, registro } = servidorLento(relogio, [{ ms: WAZE_ESPERA_MS, ok: false }]);
    const bg = rodarBackground({ servidor, relogio });
    const t0 = relogio.agora();
    let r = null;
    bg.constante('autenticar')('https://www.waze.com/editor').then((x) => { r = x; });
    assert.ok(await relogio.andar({ pronto: () => r !== null }), 'CONTROLE: o login sem prazo não terminou');
    assert.equal(r.errorCategory, 'transient', `CONTROLE: ${JSON.stringify(r)}`);
    assert.equal(registro.length, MAX, 'CONTROLE: o login sem prazo não fez todas as idas');
    assert.equal(relogio.agora() - t0, semPrazo, 'CONTROLE: o login inteiro, sem prazo, não levou a soma das idas e das esperas');
  }
  // O prazo do botão: uma ida lenta que dá certo ainda cabe, e o background responde antes do teto.
  assert.ok(PRAZO > WAZE_ESPERA_MS, `o prazo do login (${PRAZO} ms) não cabe uma ida que o Waze atrasa até o fim (${WAZE_ESPERA_MS} ms)`);
  assert.ok(PRAZO < ESPERA_DO_BOTAO_MS, `o prazo do login (${PRAZO} ms) não fica abaixo do teto do botão (${ESPERA_DO_BOTAO_MS} ms)`);
  // MEDIDO: a demora de cada ida varrida de 0 a além do teto (e o servidor
  // pendurado), com a sessão chegando na k-ésima ida, ou em nenhuma. O pior caso é
  // a resposta MAIS TARDIA do background, de todas.
  const demoras = [];
  for (let ms = 0; ms <= ESPERA_DO_BOTAO_MS + 2000; ms += 500) demoras.push(ms);
  demoras.push(WAZE_ESPERA_MS - 1, WAZE_ESPERA_MS + 1, Infinity);
  let pior = 0;
  for (const ms of demoras) {
    for (let k = 0; k <= MAX; k++) {
      const relogio = relogioVirtual();
      const { servidor, registro } = servidorLento(relogio, Array.from({ length: MAX }, (_, i) => ({ ms, ok: i === k - 1 })));
      const bg = rodarBackground({ servidor, relogio });
      const t0 = relogio.agora();
      let quando = null;
      let resposta = null;
      bg.ouvir({ action: 'abrirPlaces', desde: t0 }, (r) => { quando = relogio.agora() - t0; resposta = r; });
      await relogio.andar({ ate: t0 + 10 * 60 * 1000 });
      const caso = `ida de ${ms} ms, ${k ? `a sessão na ${k}ª` : 'nenhuma sessão'}`;
      assert.ok(quando !== null, `${caso}: o background não respondeu`);
      pior = Math.max(pior, quando);
      assert.ok(quando <= PRAZO, `${caso}: o background respondeu aos ${quando} ms, depois do prazo (${PRAZO} ms)`);
      for (const i of registro) assert.ok(i.saiu - t0 < PRAZO, `${caso}: uma ida começou aos ${i.saiu - t0} ms, no prazo ou depois dele`);
      assert.equal(bg.abasEm.length, resposta && resposta.success ? 1 : 0, `${caso}: ${bg.abasEm.length} abas, e a resposta foi ${JSON.stringify(resposta)}`);
      for (const a of bg.abasEm) assert.ok(a - t0 <= PRAZO, `${caso}: a aba abriu aos ${a - t0} ms, depois do prazo`);
    }
  }
  assert.ok(pior < ESPERA_DO_BOTAO_MS, `o pior caso medido do login (${pior} ms) passa do teto do botão (${ESPERA_DO_BOTAO_MS} ms)`);
  assert.equal(pior, PRAZO, 'CONTROLE: nenhuma ida da varredura esbarrou no prazo');
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
// Com `relogio`, a entrega anda no relógio de mentira (o de `relogioVirtual`).
// Cada resposta da ponte fica anotada em `entregas`, com a hora e se o APP ainda
// a ouvia (algum ouvinte que não é o da própria ponte); e cada pergunta do app,
// inteira, em `perguntas`.
function abaDoApp(guardadoAntes = {}, { relogio = null } = {}) {
  const agendar = relogio ? relogio.setTimeout : setTimeout;
  const agora = relogio ? relogio.agora : Date.now;
  const guardado = new Map(Object.entries(guardadoAntes));
  const escritas = [];
  const armazenamento = (quem) => ({
    getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => { escritas.push(`${quem}:set:${k}`); guardado.set(k, String(v)); },
    removeItem: (k) => { escritas.push(`${quem}:remove:${k}`); guardado.delete(k); },
  });
  const ouvintes = [];
  const daPonte = new Set();
  const win = {
    location: { origin: ORIGEM },
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvintes.push(fn); },
    removeEventListener: (tipo, fn) => { const i = ouvintes.indexOf(fn); if (i >= 0) ouvintes.splice(i, 1); },
    postMessage: (data, alvo) => {
      if (alvo !== ORIGEM && alvo !== '*') return;
      agendar(() => {
        // Pro CONTROLE do teste da ordem: a pergunta chegou antes da leitura?
        if (data && data.action === 'precisa-de-sessao' && aba.perguntouAntesDaLeitura === null) aba.perguntouAntesDaLeitura = !aba.leituraFeita;
        if (data && data.source === 'wazeplaces') aba.perguntas.push({ ...data });
        if (data && data.source === 'wazeplaces-ext') {
          aba.entregas.push({ quando: agora(), action: data.action, token: data.token || null, appOuvia: ouvintes.some((f) => !daPonte.has(f)) });
        }
        for (const fn of [...ouvintes]) fn({ source: win, origin: ORIGEM, data });
      }, 0);
    },
  };
  const aba = { guardado, escritas, armazenamento, win, leituraFeita: false, perguntouAntesDaLeitura: null,
    ouvintes, daPonte, entregas: [], perguntas: [] };
  return aba;
}

const NUNCA = Symbol('o chrome.storage não responde');
// A ponte (o content script do app) no `document_start` da aba, com o que o
// background deixou no `chrome.storage`. Com `background` (o de `rodarBackground`),
// o `sendMessage` vai ao background DE VERDADE, serializado como no Chrome:
// `entregaMs` é a demora da ida (o service worker acordando), `voltaMs` a da volta.
function rodarPonte(aba, { pendente, autenticar = () => ({ success: false, semLogin: true }), atrasoDaLeitura = 0,
  relogio = null, background = null, entregaMs = 0, voltaMs = 0 }) {
  const agendar = relogio ? relogio.setTimeout : setTimeout;
  const pedidos = [];
  const removidos = [];
  const comoNoChrome = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const ctx = {
    window: aba.win, localStorage: aba.armazenamento('ponte'),
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          pedidos.push(msg.action);
          if (background) {
            agendar(() => background.ouvirDaPonte(comoNoChrome(msg), (r) => agendar(() => cb(comoNoChrome(r)), voltaMs)), entregaMs);
            return;
          }
          agendar(() => cb(autenticar(msg)), 0);
        },
      },
      storage: {
        local: {
          // Assíncrono, como no Chrome: a resposta chega depois do `document_start`.
          // `NUNCA`: o storage de uma ponte órfã, que não responde.
          get: (chaves, cb) => {
            if (pendente === NUNCA) return;
            agendar(() => { aba.leituraFeita = true; cb(pendente === undefined ? {} : { token_pendente: pendente }); }, atrasoDaLeitura);
          },
          remove: (k) => { removidos.push(k); },
        },
      },
    },
    setTimeout: agendar, Date: relogio ? relogio.Date : Date, console,
  };
  vm.createContext(ctx);
  vm.runInContext(PONTE, ctx);
  // Quem ouve a janela até aqui é a ponte: o app começa a ouvir quando pergunta.
  for (const f of aba.ouvintes) aba.daPonte.add(f);
  return { pedidos, removidos };
}

// O app nessa aba: o `API` do api.js de verdade e, do app.js, o diário de
// sessões, o `marcarSessaoJaAtiva` e o `entrarPelaExtensao`, com o mínimo em volta.
// Com `relogio`, os timers do app são os do relógio de mentira. `esperaMs` troca a
// espera do app (um app que espera menos); `comoOAppDeAntes` tira a `espera` da
// pergunta, como ela saía até a v2026.10.06-01.
function rodarApp(aba, { relogio = null, esperaMs = null, comoOAppDeAntes = false } = {}) {
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
    setTimeout: relogio ? relogio.setTimeout : setTimeout, clearTimeout: relogio ? relogio.clearTimeout : clearTimeout,
  };
  const chaves = Object.keys(deps);
  let pergunta = fatiar('entrarPelaExtensao');
  if (comoOAppDeAntes) {
    const hoje = pergunta;
    pergunta = pergunta.replace(/(action: 'precisa-de-sessao'),\s*espera:\s*EXT_ESPERA_MS\s*\}/, '$1 }');
    assert.notEqual(pergunta, hoje, 'CONTROLE: a pergunta do app não leva mais a `espera` — reveja como este teste encena o app de antes');
  }
  const corpo = [constante('EXT_PRESENTE_MS'), esperaMs ? `const EXT_ESPERA_MS = ${Number(esperaMs)};` : constante('EXT_ESPERA_MS'),
    constante('SESSOES_KEY'), constante('SESSOES_TETO'),
    ...['lerDiarioDeSessoes', 'registrarEventoDeSessao', 'marcarSessaoJaAtiva'].map(fatiar), pergunta,
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

// ═══ R9-1-02 = R9-6-02 · a PONTE tem o prazo de quem pergunta, e um login por vez ═══
// O app pede sessão à ponte (na abertura, na volta à aba e na queda) e espera a
// resposta por `EXT_ESPERA_MS` (8 s) depois do `aguarde`; aí desiste e para de
// ouvir. O login da ponte não tinha prazo nenhum: até 4 idas, 124,6 s com o Waze
// lento, indo ao /Session no nome da pessoa depois de o app ter desistido — e a
// ida que dava certo entregava o token a uma página que já não ouvia: a sessão
// ficava sem dono no servidor, e a pessoa na tela de entrada. E cada volta à aba
// começava outra cadeia ao lado da que corria (MEDIDO com a extensão e o app de
// verdade num Chromium: 12 idas, até 3 ao mesmo tempo, 10 depois de o app
// desistir). Agora o app manda a espera dele na pergunta (`espera`), o login da
// ponte acaba antes dela (`FOLGA_DA_PONTE_MS`), e é um por vez.
//
// Aqui, o app (`entrarPelaExtensao` e o `API`), a ponte e o background de
// verdade, num relógio só, com o servidor de mentira das idas lentas (o do
// R8-6-01: ele cancela a ida quando o sinal cancela, como o `fetch`). O token da
// ida N é `tok-N`.
const numeroDoApp = (nome) => Number(/=\s*(\d+)\s*;/.exec(constante(nome))[1]);
const ESPERA_DO_APP = numeroDoApp('EXT_ESPERA_MS');

// `abas`: uma aba do app por item, cada uma com a ponte dela, todas com o MESMO
// background. `em`: quando o app pergunta; `deNovo`: quando ele pergunta outra vez
// (a volta à aba, depois da resposta da primeira). `entregaMs`/`voltaMs`: a demora
// da mensagem da ponte até o background e de volta; `atrasoDaLeitura`: a do
// `chrome.storage` da ponte; `esperaMs`: um app que espera outra coisa;
// `comoOAppDeAntes`: a pergunta sem a `espera`.
async function perguntarComServidorLento({ idas, abas = [{}], ignoraCancelamento = false }) {
  const relogio = relogioVirtual();
  const t0 = relogio.agora();
  const rel = (t) => t - t0;
  const { servidor, registro } = servidorLento(relogio, idas, { ignoraCancelamento });
  const bg = rodarBackground({ servidor, relogio });
  const estado = abas.map((cfg) => {
    const aba = abaDoApp({}, { relogio });
    rodarPonte(aba, { relogio, background: bg, entregaMs: cfg.entregaMs || 0, voltaMs: cfg.voltaMs || 0, atrasoDaLeitura: cfg.atrasoDaLeitura || 0 });
    const app = rodarApp(aba, { relogio, esperaMs: cfg.esperaMs, comoOAppDeAntes: cfg.comoOAppDeAntes });
    const e = { aba, app, esperaDoApp: cfg.esperaMs || ESPERA_DO_APP, perguntas: [] };
    for (const em of [cfg.em || 0, ...(cfg.deNovo || [])]) {
      relogio.setTimeout(() => {
        const p = { em: rel(relogio.agora()), entrou: null, respondeuEm: null };
        e.perguntas.push(p);
        app.app.entrarPelaExtensao({ silencioso: true }).then((ok) => { p.entrou = ok; p.respondeuEm = rel(relogio.agora()); });
      }, em);
    }
    return e;
  });
  await relogio.andar({ ate: t0 + 10 * 60 * 1000 });
  const idasRel = registro.map((i) => ({ saiu: rel(i.saiu), fim: i.fim === null ? null : rel(i.fim), como: i.como }));
  // Quantas idas no ar ao mesmo tempo, no máximo (a que termina num instante não
  // se soma à que começa nele).
  let noAr = 0, maxNoAr = 0;
  const marcos = idasRel.flatMap((i) => [[i.saiu, 1], [i.fim === null ? Infinity : i.fim, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, d] of marcos) { noAr += d; maxNoAr = Math.max(maxNoAr, noAr); }
  return {
    idas: idasRel, maxNoAr,
    abas: estado.map((e) => ({
      esperaDoApp: e.esperaDoApp,
      perguntas: e.perguntas,
      token: e.app.API.getSession(),
      entregas: e.aba.entregas.map((x) => ({ ...x, quando: rel(x.quando) })),
      mensagensDoApp: e.aba.perguntas,
    })),
  };
}

// O que vale em TODA pergunta à ponte:
//  1. o app recebe a resposta da ponte ANTES de desistir — nunca pelo prazo dele;
//  2. nenhuma sessão chega a uma página que já não ouve;
//  3. toda ida ao servidor acontece enquanto algum app espera a resposta dela;
//  4. toda sessão que o servidor criou ficou com um app (sem dono, nenhuma).
function conferirAPonte(r, caso) {
  for (const [n, a] of r.abas.entries()) {
    const aba = r.abas.length > 1 ? ` (aba ${n + 1})` : '';
    assert.ok(a.perguntas.length > 0, `CONTROLE (${caso}${aba}): o app nem perguntou`);
    for (const p of a.perguntas) {
      assert.ok(p.respondeuEm !== null, `${caso}${aba}: a pergunta de ${p.em} ms ficou sem resposta`);
      assert.ok(p.respondeuEm - p.em < a.esperaDoApp,
        `${caso}${aba}: a ponte não respondeu antes de o app desistir — ele perguntou aos ${p.em} ms e desistiu sozinho aos ${p.respondeuEm} ms`
        + ` (idas: ${JSON.stringify(r.idas)})`);
    }
    const tardias = a.entregas.filter((e) => e.action === 'sessao' && !e.appOuvia);
    assert.deepEqual(tardias, [], `${caso}${aba}: a ponte entregou a sessão a uma página que já não ouvia — sem dono no servidor`
      + ` (perguntas: ${JSON.stringify(a.perguntas)}, idas: ${JSON.stringify(r.idas)})`);
  }
  const todas = r.abas.flatMap((a) => a.perguntas);
  for (const i of r.idas) {
    const coberta = i.fim !== null && todas.some((p) => p.em <= i.saiu && i.fim <= p.respondeuEm);
    assert.ok(coberta, `${caso}: uma ida ao servidor (${JSON.stringify(i)}) correu depois de o app ter a resposta — ida ao Waze no nome da pessoa sem ninguém esperando`
      + ` (perguntas: ${JSON.stringify(todas)})`);
  }
  const comApp = new Set(r.abas.map((a) => a.token).filter(Boolean));
  r.idas.forEach((i, n) => {
    if (i.como === 'sessão') assert.ok(comApp.has(`tok-${n + 1}`), `${caso}: a sessão da ${n + 1}ª ida ficou sem dono no servidor (idas: ${JSON.stringify(r.idas)})`);
  });
}

test('R9-1-02: o app manda a espera dele na pergunta, e a ponte acaba antes dela — nenhuma ida depois de o app desistir, a que está no ar é cancelada, e nenhuma sessão fica sem dono', async () => {
  const bg0 = rodarBackground();
  const MAX = bg0.constante('MAX_TENTATIVAS');
  const ESPERAS = bg0.constante('ESPERAS_MS');
  // A demora de cada ida varrida de 0 a além da espera do app (e o servidor
  // pendurado), com a sessão chegando na k-ésima ida, ou em nenhuma.
  const demoras = [];
  for (let ms = 0; ms <= ESPERA_DO_APP + 2000; ms += 250) demoras.push(ms);
  demoras.push(WAZE_ESPERA_MS, Infinity);
  let semPrazoChegariaTarde = 0, entrou = 0, desistiu = 0;
  for (const ms of demoras) {
    for (let k = 0; k <= MAX; k++) {
      const r = await perguntarComServidorLento({ idas: Array.from({ length: MAX }, (_, i) => ({ ms, ok: i === k - 1 })) });
      const caso = `ida de ${ms} ms, ${k ? `a sessão na ${k}ª` : 'nenhuma sessão'}`;
      // A pergunta leva a espera do app (é ela que a ponte usa).
      assert.deepEqual(r.abas[0].mensagensDoApp.map((m) => m.espera), [ESPERA_DO_APP], `${caso}: a pergunta do app não diz a espera dele`);
      conferirAPonte(r, caso);
      const p = r.abas[0].perguntas[0];
      if (p.entrou) entrou++; else desistiu++;
      // Sem prazo na ponte, a sessão deste caso chegaria depois de o app desistir?
      if (k && k * ms + ESPERAS.slice(0, k - 1).reduce((a, b) => a + b, 0) >= ESPERA_DO_APP) semPrazoChegariaTarde++;
    }
  }
  // CONTROLE: a varredura tem os três desfechos — o app que entra, o que desiste,
  // e o caso do achado (a sessão que, sem o prazo, chegaria depois de o app desistir).
  assert.ok(entrou > 20 && desistiu > 20 && semPrazoChegariaTarde > 20,
    `CONTROLE: a varredura não cobre os casos (entrou ${entrou}, desistiu ${desistiu}, sessão que chegaria tarde ${semPrazoChegariaTarde})`);
});

test('R9-1-02: a ida que daria certo depois de o app desistir é cancelada; e a sessão que o servidor cria mesmo assim não chega à página que não ouve', async () => {
  // O caso do achado (x11 "tardio", em escala): a 1ª ida falha em 6 s, e a 2ª
  // daria a sessão 6 s depois — já com o app na tela de entrada.
  const idas = [{ ms: 6000, ok: false }, { ms: 6000, ok: true }];
  const r = await perguntarComServidorLento({ idas });
  conferirAPonte(r, 'tardio');
  assert.equal(r.idas.length, 2, `CONTROLE: ${JSON.stringify(r.idas)}`);
  assert.equal(r.idas[1].como, 'cancelada', `a 2ª ida seguiu depois do prazo de quem perguntou: ${JSON.stringify(r.idas[1])}`);
  const p = r.abas[0].perguntas[0];
  assert.equal(p.entrou, false);
  assert.ok(r.idas[1].fim <= p.respondeuEm, `a 2ª ida foi cancelada aos ${r.idas[1].fim} ms, depois de o app ter a resposta (${p.respondeuEm} ms)`);
  assert.deepEqual(r.abas[0].entregas.map((e) => e.action), ['aguarde', 'sem-sessao'], 'a ponte não disse "sem sessão" ao app');
  // A ida que não se deixa cancelar (a resposta já a caminho): a sessão que o
  // servidor criou chega ao background depois do prazo, e ele a joga fora — a
  // ponte não a entrega a quem não ouve mais. (Ela fica sem dono no servidor, e
  // vence sozinha: isso só o servidor evitaria.)
  const teimosa = await perguntarComServidorLento({ idas, ignoraCancelamento: true });
  assert.equal(teimosa.idas[1].como, 'sessão', `CONTROLE: a ida não terminou com a sessão: ${JSON.stringify(teimosa.idas)}`);
  assert.ok(teimosa.idas[1].fim > teimosa.abas[0].perguntas[0].respondeuEm, 'CONTROLE: a sessão chegou antes da resposta ao app');
  assert.deepEqual(teimosa.abas[0].entregas.filter((e) => e.action === 'sessao'), [], 'a sessão que chegou depois do prazo foi entregue à página');
  assert.equal(teimosa.abas[0].token, null);
  // CONTROLE: a mesma ida, dentro do prazo, entra.
  const aTempo = await perguntarComServidorLento({ idas: [{ ms: 3000, ok: false }, { ms: 2000, ok: true }] });
  conferirAPonte(aTempo, 'a tempo');
  assert.equal(aTempo.abas[0].perguntas[0].entrou, true, `CONTROLE: ${JSON.stringify(aTempo.idas)}`);
  assert.equal(aTempo.abas[0].token, 'tok-2');
});

test('R9-1-02: o prazo conta da PERGUNTA — o service worker que demora a acordar e o chrome.storage lento não empurram a resposta pra depois de o app desistir', async () => {
  const pendurado = [{ ms: Infinity, ok: false }];
  for (const cfg of [{ entregaMs: 3000 }, { atrasoDaLeitura: 1000 }, { entregaMs: 2000, atrasoDaLeitura: 900 }]) {
    const r = await perguntarComServidorLento({ idas: pendurado, abas: [cfg] });
    const caso = `servidor pendurado, ${JSON.stringify(cfg)}`;
    conferirAPonte(r, caso);
    assert.equal(r.idas.length, 1, `CONTROLE (${caso}): ${JSON.stringify(r.idas)}`);
    assert.equal(r.idas[0].como, 'cancelada', `${caso}: a ida pendurada não foi cancelada`);
  }
  // A mensagem que chega ao background DEPOIS do prazo nem vai ao servidor.
  const tarde = await perguntarComServidorLento({ idas: [{ ms: 100, ok: true }], abas: [{ entregaMs: ESPERA_DO_APP - 500 }] });
  conferirAPonte(tarde, 'a mensagem chegou depois do prazo');
  assert.deepEqual(tarde.idas, [], 'a mensagem que chegou depois do prazo foi ao servidor (uma ida ao Waze no nome de quem já desistiu)');
  // A volta (background → ponte → app) cabe na folga: a sessão que chega ao
  // background no fim do prazo ainda chega ao app enquanto ele ouve. MEDIDA com a
  // extensão carregada num Chromium, do servidor responder até o app receber o
  // `sessao`: de 6 a 75 ms, em 8 rodadas. A folga tem de cobrir meio segundo.
  const VOLTA_LENTA_MS = 500;
  const FOLGA = rodarBackground().constante('FOLGA_DA_PONTE_MS');
  assert.ok(FOLGA < ESPERA_DO_APP, `a folga da ponte (${FOLGA} ms) não cabe na espera do app (${ESPERA_DO_APP} ms)`);
  const noLimite = [{ ms: ESPERA_DO_APP - FOLGA - 1, ok: true }];
  for (const voltaMs of [VOLTA_LENTA_MS, FOLGA - 1]) {
    const naFolga = await perguntarComServidorLento({ idas: noLimite, abas: [{ voltaMs }] });
    conferirAPonte(naFolga, `a volta de ${voltaMs} ms`);
    assert.equal(naFolga.abas[0].token, 'tok-1', `a volta de ${voltaMs} ms: a sessão do fim do prazo não ficou com o app`);
  }
  // CONTROLE: a volta mais lenta que a folga leva a mesma sessão a uma página que
  // já não ouve — o instrumento enxerga a entrega tardia, e é a folga que a evita.
  const foraDaFolga = await perguntarComServidorLento({ idas: noLimite, abas: [{ voltaMs: FOLGA + 2 }] });
  assert.equal(foraDaFolga.abas[0].entregas.filter((e) => e.action === 'sessao' && !e.appOuvia).length, 1,
    `CONTROLE: com a volta mais lenta que a folga, a entrega tardia não apareceu: ${JSON.stringify(foraDaFolga.abas[0].entregas)}`);
});

test('R9-1-02: o login da ponte é UM por vez — a volta à aba e a outra aba do app não abrem outra cadeia de idas ao Waze', async () => {
  // Duas abas do app perguntando com 2 s de diferença: uma cadeia só, e as duas
  // ficam com a MESMA sessão (é o mesmo navegador e a mesma conta do WME).
  const duas = await perguntarComServidorLento({ idas: [{ ms: 3000, ok: false }, { ms: 2000, ok: true }], abas: [{ em: 0 }, { em: 2000 }] });
  conferirAPonte(duas, 'duas abas');
  assert.equal(duas.maxNoAr, 1, `as duas abas abriram cadeias em paralelo: ${JSON.stringify(duas.idas)}`);
  assert.equal(duas.idas.length, 2, `idas demais: ${JSON.stringify(duas.idas)}`);
  assert.deepEqual(duas.abas.map((a) => a.token), ['tok-2', 'tok-2'], 'as duas abas não ficaram com a sessão do login no ar');
  // A mesma página perguntando de novo (a volta à aba) depois da resposta da
  // primeira: a cadeia de antes já acabou, e a nova é a única no ar.
  const voltas = await perguntarComServidorLento({
    idas: [{ ms: 6000, ok: false }, { ms: 6000, ok: false }, { ms: 500, ok: true }],
    abas: [{ em: 0, deNovo: [ESPERA_DO_APP + 1000] }],
  });
  conferirAPonte(voltas, 'a volta à aba');
  assert.equal(voltas.maxNoAr, 1, `a volta à aba abriu outra cadeia ao lado da que corria: ${JSON.stringify(voltas.idas)}`);
  const [primeira, segunda] = voltas.abas[0].perguntas;
  assert.equal(primeira.entrou, false, 'CONTROLE: a primeira pergunta não desistiu');
  assert.equal(segunda.entrou, true, `a volta à aba não fez um login novo: ${JSON.stringify(voltas.idas)}`);
  assert.equal(voltas.abas[0].token, 'tok-3');
  // A aba que espera MENOS que o login no ar recebe a resposta no prazo dela, e
  // o login segue pra quem ainda espera.
  const apressada = await perguntarComServidorLento({ idas: [{ ms: 5000, ok: true }], abas: [{ em: 0 }, { em: 1000, esperaMs: 3000 }] });
  conferirAPonte(apressada, 'a aba que espera menos');
  assert.equal(apressada.idas.length, 1, `CONTROLE: ${JSON.stringify(apressada.idas)}`);
  assert.deepEqual(apressada.abas.map((a) => a.perguntas[0].entrou), [true, false]);
  assert.deepEqual(apressada.abas.map((a) => a.token), ['tok-1', null]);
});

// O app de antes é o que está no ar até a v2026.10.06-01: a pergunta sem a
// `espera`, e 8 s de espera (o `EXT_ESPERA_MS` dele — um fato da história, e não
// o valor de hoje, que pode mudar).
const ESPERA_DO_APP_DE_ANTES = 8000;
test('R9-1-02: o app de antes (sem a `espera` na pergunta) também recebe a resposta da ponte antes de desistir', async () => {
  let viu = 0;
  const E = ESPERA_DO_APP_DE_ANTES;
  for (const ms of [0, 3000, 6000, E - 1500, E - 500, E + 1000, WAZE_ESPERA_MS, Infinity]) {
    for (let k = 0; k <= 2; k++) {
      const r = await perguntarComServidorLento({ idas: [0, 1, 2, 3].map((i) => ({ ms, ok: i === k - 1 })),
        abas: [{ comoOAppDeAntes: true, esperaMs: E }] });
      assert.deepEqual(r.abas[0].mensagensDoApp.map((m) => 'espera' in m), [false], 'CONTROLE: a pergunta encenada ainda leva a `espera`');
      conferirAPonte(r, `app de antes, ida de ${ms} ms, ${k ? `a sessão na ${k}ª` : 'nenhuma sessão'}`);
      viu++;
    }
  }
  assert.equal(viu, 24);
});

test('R9-1-02: nenhum login da ponte espera mais que o do botão — a espera que passa dele vale o prazo do botão', async () => {
  const bg0 = rodarBackground();
  const PRAZO = bg0.constante('PRAZO_DO_BOTAO_MS');
  const r = await perguntarComServidorLento({ idas: [{ ms: WAZE_ESPERA_MS, ok: false }], abas: [{ esperaMs: 10 * 60 * 1000 }] });
  conferirAPonte(r, 'a espera de 10 minutos');
  const ultima = r.idas.at(-1);
  assert.ok(ultima.fim <= PRAZO, `o login da ponte foi até ${ultima.fim} ms, além do prazo do botão (${PRAZO} ms): ${JSON.stringify(r.idas)}`);
  assert.ok(r.idas.length < bg0.constante('MAX_TENTATIVAS'), `CONTROLE: o prazo nem cortou as idas: ${JSON.stringify(r.idas)}`);
});
