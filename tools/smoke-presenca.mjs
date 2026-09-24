// Smoke da presença (fase 3) — DOIS navegadores de verdade conversando pelo
// chat do WME, com o Waze e o Google simulados AQUI.
//
// Desde a fase 3 a lista e a conversa são as do WME: o servidor lê a lista e o
// chat do Waze, e o tempo real vai do navegador DIRETO ao Google. Nada disso
// roda sem as contas do owner — então este smoke faz o papel dos dois lados de
// fora, com o que a app CONFIA deles:
//   · a API (`/api/presenca-app`, `/api/chat`, as ações) é respondida por um
//     chat de mentira em memória, que filtra com as MESMAS funções do servidor
//     (`filtrarOnlineDaApp`, `filtrarConversasDaApp`) e monta as mensagens com
//     o MESMO construtor de protobuf (`server/wme-grpc.mjs`);
//   · o tempo real é o host de verdade do Google (roteado pelo Playwright), o
//     que prova de quebra que a CSP da app deixa ele passar — o host novo do
//     `connect-src` é o tipo de coisa que some calada (o mapa já sumiu assim);
//   · a conexão do tempo real fica PRESA até haver o que entregar, como a do
//     Google, e religa sozinha quando termina.
//
// O que o smoke NÃO prova é que o Waze de verdade responde assim: isso é a
// validação ao vivo com as duas contas, que não mora no repositório.
//
// Mora em `tools/` pelo mesmo motivo do `smoke-browser.mjs`: o `node --test`
// varre `test/` inteiro, e a suíte do projeto promete rodar com ZERO
// dependência.
//
//   npm run test:presenca

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as dormir } from 'node:timers/promises';
import * as g from '../server/wme-grpc.mjs';
import { filtrarOnlineDaApp, filtrarConversasDaApp } from '../server/core.mjs';
import { marcarPosicao } from '../server/marca-app.mjs';
import { carregarPlaywright, abrirNavegador, motorPedido, resumoDosPulos, ruidoDoMotor } from './navegador.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.SMOKE_PORT || 8134);
const CHAVE = Buffer.alloc(32, 5).toString('base64');
const BRASIL = 30;
const GOOGLE = 'https://instantmessaging-pa.googleapis.com/';
const CHAVE_API = 'chave-do-smoke';

const falhas = [];
const anota = (m) => { falhas.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

// ── o chat do WME, de mentira ───────────────────────────────────────────────
const PESSOAS = {
  '12444348': { nome: 'antigerme', rank: 5, pos: { lat: -23.5613, lon: -46.6565 } },
  '183164343': { nome: 'cafanha', rank: 3, pos: { lat: -23.5329, lon: -46.6395 } },
  '555': { nome: 'so_no_wme', rank: 2, pos: { lat: -23.54, lon: -46.64 } },
};
// A distância que a tela TEM que mostrar, calculada aqui pela mesma fórmula
// (Haversine) — cravar "3 km" no teste mediria o meu chute das posições.
const kmEntre = (a, b) => {
  const R = 6371, rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const KM = Math.round(kmEntre(PESSOAS['12444348'].pos, PESSOAS['183164343'].pos));
const naApp = new Set();          // quem está com a app aberta (e aparece na lista)
const mensagens = [];             // { id, ts, de, para, texto, ctx, lida }
const filas = new Map();          // id -> { itens: [{ inbox, bytes }], acordar }
const falharEnvioDe = new Set();
const token = (id) => `token-do-smoke-${id}`;

function fila(id) {
  if (!filas.has(id)) filas.set(id, { itens: [], acordar: null });
  return filas.get(id);
}
function entregar(id, bytes) {
  const f = fila(id);
  f.itens.push({ inbox: randomUUID(), bytes });
  if (f.acordar) { const a = f.acordar; f.acordar = null; a(); }
}
const bytesMsg = (m) => g.lerCampos(g.corpoEnviarTexto({ cabecalho: null, ts: m.ts, id: m.id, para: m.para, de: m.de, texto: m.texto, ctx: m.ctx })).find((c) => c.n === 2).v;
const bytesRecibo = ({ de, para, ids }) => g.lerCampos(g.corpoRecibo({ cabecalho: null, ts: Date.now(), id: randomUUID(), para, de, tipo: 2, ids })).find((c) => c.n === 2).v;

function listaPara(eu) {
  const editores = [...naApp].filter((id) => id !== eu).map((id) => ({
    id: Number(id), nome: PESSOAS[id].nome, rank: PESSOAS[id].rank, visivel: true, ...marcarPosicao(PESSOAS[id].pos, BRASIL),
  }));
  return filtrarOnlineDaApp(editores, { pais: BRASIL, eu });
}
function conversasPara(eu, conhecidos) {
  const porPessoa = new Map();
  for (const m of mensagens) {
    if (m.de !== eu && m.para !== eu) continue;
    const com = m.de === eu ? m.para : m.de;
    const c = porPessoa.get(com) || { com: { tipo: 1, id: com }, nome: PESSOAS[com].nome, naoLidas: 0, bloqueada: false, atividade: 0, ultima: null };
    if (m.ts >= c.atividade) {
      c.atividade = m.ts;
      c.ultima = { id: m.id, ts: m.ts, de: { tipo: 1, id: m.de }, para: { tipo: 1, id: m.para }, classe: 'texto', texto: m.texto, recibo: null, contexto: m.ctx };
    }
    if (m.para === eu && !m.lida) c.naoLidas += 1;
    porPessoa.set(com, c);
  }
  return filtrarConversasDaApp([...porPessoa.values()], { eu, conhecidos: new Set(conhecidos || []) });
}
function marcarLida(eu, com) {
  const lidas = mensagens.filter((m) => m.de === com && m.para === eu && !m.lida);
  for (const m of lidas) m.lida = true;
  // Como o Waze: marcar como lida gera o recibo pra quem mandou.
  if (lidas.length) entregar(com, bytesRecibo({ de: eu, para: com, ids: lidas.map((m) => m.id) }));
  return lidas.length;
}

// O que cada página mandou, pra conferir.
const registro = new Map();   // id -> { api: [], fluxo: [], confirmados: [] }
const reg = (id) => { if (!registro.has(id)) registro.set(id, { api: [], fluxo: [], confirmados: [] }); return registro.get(id); };

function responderApi(eu, rota, c) {
  const r = reg(eu);
  r.api.push({ rota, c });
  if (Array.isArray(c.confirmar) && c.confirmar.length) r.confirmados.push(...c.confirmar);
  const confirmados = Array.isArray(c.confirmar) && c.confirmar.length && c.instalacao ? { confirmados: c.confirmar.length } : {};
  if (Array.isArray(c.confirmar)) { const f = fila(eu); f.itens = f.itens.filter((x) => !c.confirmar.includes(x.inbox)); }
  if (rota === 'presenca-app') {
    return {
      success: true, online: listaPara(eu), conversas: conversasPara(eu, c.conhecidos),
      ...(c.token ? { chat: { token: token(eu), base: GOOGLE, chave: CHAVE_API, expiraEm: Date.now() + 86_000_000 } } : {}),
      ...confirmados,
    };
  }
  if (rota === 'chat') {
    if (c.acao === 'abrir') {
      const hist = mensagens.filter((m) => (m.de === eu && m.para === c.com) || (m.de === c.com && m.para === eu))
        .sort((a, b) => b.ts - a.ts)   // como o Waze: da mais nova pra mais antiga
        .map((m) => ({ id: m.id, ts: m.ts, de: { tipo: 1, id: m.de }, para: { tipo: 1, id: m.para }, classe: 'texto', texto: m.texto, recibo: null, contexto: m.ctx }));
      if (!c.antesDe) marcarLida(eu, c.com);
      return { success: true, mensagens: hist, maisAntigas: false, recibos: [], ...confirmados };
    }
    if (c.acao === 'lida') { marcarLida(eu, c.com); return { success: true, recibos: [], ...confirmados }; }
    if (c.acao === 'enviar') {
      if (falharEnvioDe.has(eu)) return { success: false, errorCategory: 'transient', errorKey: 'srv.err.connection' };
      // A marca da app quem põe é o SERVIDOR (como no core).
      const m = { id: c.id, ts: Date.now(), de: eu, para: c.para, texto: c.texto, ctx: { ...(c.contexto || {}), app: 'wazeplaces' } };
      if (!mensagens.some((x) => x.id === m.id)) mensagens.push(m);
      entregar(c.para, bytesMsg(m));
      entregar(eu, bytesMsg(m));   // o eco, como o Waze faz
      return { success: true, id: m.id, ts: m.ts, ...confirmados };
    }
  }
  // A abertura de VERDADE (o `initApp` com a sessão salva): perfil, países e a
  // fila. Injetar isso tudo por fora escondeu um defeito: a presença pedia a
  // lista ANTES de o perfil chegar e desistia calada (gotcha #52 — o helper
  // que arruma a tela faz o que a app esquece).
  if (rota === 'perfil') {
    const p = PESSOAS[eu];
    return { success: true, visivelNoWme: true, referencias: { casa: null, trabalho: null },
      profile: { id: Number(eu), userName: p.nome, rank: p.rank, isStaff: false, isAreaManager: true, isEditor: true,
        editableCountryIDs: [BRASIL], areas: [], managedAreas: [] } };
  }
  if (rota === 'lista-paises') return { success: true, countries: [{ id: BRASIL, name: 'Brazil', abbr: 'BR' }] };
  if (rota === 'lista-estados') return { success: true, states: [] };
  if (rota === 'buscar-places') return { success: true, places: [pedido(PESSOAS[eu].pos.lat, PESSOAS[eu].pos.lon)], hasMore: false, page: 1, total: 1 };
  if (rota === 'validar-place' || rota === 'marcar-lido') {
    return { success: true, presenca: { ok: true, marca: true }, presencaApp: { online: listaPara(eu), conversas: conversasPara(eu, (c.presenca && c.presenca.conhecidos) || []) } };
  }
  return { success: false };
}

// ── o servidor da app (os estáticos e a CSP de verdade) ─────────────────────
const dir = await mkdtemp(join(tmpdir(), 'wp-presenca-'));
const srv = spawn(process.execPath, [join(ROOT, 'server', 'node.mjs')], {
  env: { ...process.env, PORT: String(PORTA), HOST: '127.0.0.1', SESSION_DIR: dir, ENCRYPTION_KEY: CHAVE },
  stdio: 'ignore',
});
for (let i = 0; i < 100; i++) {
  try { await fetch(`http://127.0.0.1:${PORTA}/`); break; } catch { await dormir(100); }
}

const pw = await carregarPlaywright();
const MOTOR = motorPedido();
const browser = await abrirNavegador(pw);

// O pedido aberto de cada um: um pedido REAL da fixture do Brasil (todos os
// campos que o servidor manda), com o que importa trocado. DUAS fotos, e a do
// pedido é a SEGUNDA — a que o card mostra, casada pelo `updateRequestID` na
// URL, como no Waze. O `imageUrl` traz a PRIMEIRA (o servidor preenche assim),
// e é o que a conversa mandava antes do conserto.
const REAL = JSON.parse(readFileSync(join(ROOT, 'tools', 'fixtures-paises.json'), 'utf8'))
  .find((p) => p.mapa && p.mapa.centro && p.mapa.centro[1] < -40 && p.mapa.centro[0] < 0);
const pedido = (lat, lon) => ({
  ...REAL,
  venueID: '205522459.2055159053.3242788', updateRequestID: 'ur-smoke',
  name: 'Padaria Estrela do Norte', address: 'R. Aurora, 412 — São Paulo',
  categories: ['BAKERY'], updateTypeKey: 'IMAGE', purType: 'NEW_PHOTO', reqType: 'IMAGE',
  imageUrls: ['https://venue-image.waze.com/thumbs/thumb700_ja-no-local',
              'https://venue-image.waze.com/thumbs/thumb700_ur-smoke'],
  imageUrl: 'https://venue-image.waze.com/thumbs/thumb700_ja-no-local',
  lat, lon, mapa: { ...REAL.mapa, centro: [lat, lon], entradas: [] }, changes: [], flagComment: null,
});

async function editor(id, { lang = 'pt' } = {}) {
  const p = PESSOAS[id];
  // `serviceWorkers: 'block'`: o SW da app se auto-atualiza e RECARREGA a página
  // no `controllerchange`, apagando o estado injetado no meio do teste.
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
  });
  // A foto do pedido é do Waze: servida AQUI, pra o smoke nunca bater no CDN
  // de verdade (no CI o navegador tem rede).
  await ctx.route('**/venue-image.waze.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/gif',
    body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') }));
  // Tile do mapa: servido aqui também (e o que vale aqui é a presença, não o mapa).
  await ctx.route(/^https:\/\/[a-z0-9-]*\.waze\.com\/.*tiles/, (r) => r.fulfill({ status: 200, contentType: 'image/gif',
    body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') }));
  // O tempo real: preso até haver o que entregar, como o do Google.
  await ctx.route(GOOGLE + '**', async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': 'content-type,x-goog-api-key', 'access-control-allow-methods': 'POST' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors }).catch(() => {});
    let corpo = null;
    try { corpo = JSON.parse(req.postData() || 'null'); } catch { /* registrado como null */ }
    reg(id).fluxo.push({ url: req.url(), chave: req.headers()['x-goog-api-key'], corpo, cookie: req.headers().cookie || null });
    if (!corpo || !corpo.header || corpo.header.auth_token_payload !== token(id)) {
      return route.fulfill({ status: 401, headers: cors, body: '' }).catch(() => {});
    }
    const f = fila(id);
    if (!f.itens.length) await Promise.race([new Promise((ok) => { f.acordar = ok; }), dormir(25_000)]);
    // Entrega TUDO o que não foi confirmado, e sem as marcas de lote: ao vivo.
    const quadros = f.itens.map((x) => ({ inboxMessage: { messageId: x.inbox, messageType: 'MESSAGE', message: Buffer.from(x.bytes).toString('base64') } }));
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: '[' + quadros.map((q) => JSON.stringify(q)).join(',\n') + ']' }).catch(() => {});
  });
  await ctx.route('**/api/**', async (route) => {
    const req = route.request();
    const rota = new URL(req.url()).pathname.split('/').pop();
    let c = {};
    try { c = JSON.parse(req.postData() || '{}'); } catch { /* vazio */ }
    const corpo = responderApi(id, rota, c);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) }).catch(() => {});
  });
  const page = await ctx.newPage();
  const pedidos = [];
  page.on('request', (r) => pedidos.push(r.url()));
  page.on('websocket', (w) => pedidos.push('ws:' + w.url()));
  page.on('pageerror', (e) => anota(`[${p.nome}] erro de página: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || ruidoDoMotor(m.text())) return;
    // A CSP barrando o tempo real é EXATAMENTE o defeito que este smoke vigia.
    if (/Content Security Policy|Refused to connect/i.test(m.text())) anota(`[${p.nome}] a CSP barrou: ${m.text().slice(0, 200)}`);
  });
  // A sessão SALVA, como quem já tinha entrado: o `initApp` de verdade faz o
  // resto (perfil, países, fila e presença), pela API de mentira acima.
  await page.addInitScript(({ l, tk }) => {
    try {
      localStorage.setItem('waze_places_lang', l);
      localStorage.setItem('waze_session_token', tk);
      localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: true }));
    } catch (e) {}
  }, { l: lang, tk: 'token-da-sessao-' + p.nome });
  naApp.add(id);
  await page.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'domcontentloaded' });
  // Espera o card de verdade na tela: sinal POSITIVO de que a abertura andou.
  // Mesmo motivo do `esperar` abaixo: nada de `waitForFunction` neste arquivo.
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(() => !!(window.AppState && AppState.profile && AppState.currentPlace && document.querySelector('#cardStack .place-card'))).catch(() => false)) break;
    await dormir(100);
  }
  return { id, nome: p.nome, page, ctx, pedidos };
}

// A espera é um laço de `page.evaluate` daqui, e NÃO `page.waitForFunction`
// (proibido nos smokes: ver `tools/esperar-saida.mjs`).
const esperar = async (e, fn, oq, ms = 15000, arg) => {
  const ate = Date.now() + ms;
  for (;;) {
    let valor = false;
    try { valor = await e.page.evaluate(fn, arg); } catch (err) { valor = false; }
    if (valor) return true;
    if (Date.now() >= ate) {
      // Espera que estoura sem dizer o que ESTAVA no lugar é a pior falha de CI.
      const estado = await e.page.evaluate(() => ({
        online: Presenca.online.map((p) => p.nome), conversas: Presenca.conversas.map((c) => `${c.nome}:${c.naoLidas}`),
        vivas: [...Presenca.vivas].map(([k, v]) => `${k}:${v.n}`), fluxo: !!Presenca.fluxo, diag: Presenca.fluxoDiag,
      })).catch((err) => `(não deu pra ler: ${String(err.message).split('\n')[0]})`);
      anota(`${oq} — estado: ${JSON.stringify(estado)}`);
      return false;
    }
    await dormir(100);
  }
};
const apiDe = (e, rota, acao) => reg(e.id).api.filter((x) => x.rota === rota && (!acao || x.c.acao === acao));

// O DEDO alcança? `elementFromPoint` no centro do alvo (gotcha #26).
const alcancavel = (e, sel) => e.page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { existe: false };
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { existe: true, visivel: false };
  const quem = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { existe: true, visivel: true, noCentro: !!quem && (quem === el || el.contains(quem)), dentroDaTela: r.bottom <= innerHeight && r.top >= 0, altura: Math.round(r.height) };
}, sel);

try {
  // A bia abre PRIMEIRO. A lista não anda sozinha (nada de polling: é o free
  // tier), então quem abre depois vê quem já estava, e quem já estava só vê
  // quem chegou na próxima ação, lista aberta ou volta do segundo plano. A
  // primeira versão deste smoke abria na ordem contrária e "reprovou" a app por
  // fazer exatamente o combinado.
  const bia = await editor('183164343');
  const ana = await editor('12444348');

  // ── 1. ABRIR: UM pedido, o tempo real direto no Google, e nada da sala velha
  console.log('\n1. abrir a app');
  if (await esperar(ana, () => Presenca.online.some((p) => p.nome === 'cafanha'), 'a lista da app não chegou pra ana')) ok('a lista da app chega (quem usa a app no país)');
  const biaAntes = await bia.page.evaluate(() => Presenca.online.length);
  if (biaAntes === 0) ok('controle: quem abriu antes não vê quem chegou depois — a lista não é polling');
  else anota(`a lista da bia andou sozinha: ${biaAntes}`);
  const abertura = apiDe(ana, 'presenca-app');
  if (abertura.length === 1 && abertura[0].c.token === true && /^[0-9a-f-]{36}$/.test(abertura[0].c.instalacao || '') && abertura[0].c.pais === BRASIL) {
    ok('abrir custa UM pedido: lista + token do tempo real, com a instalação do aparelho');
  } else anota(`a abertura não foi UM presenca-app com token e instalação: ${JSON.stringify(abertura.map((x) => x.c))}`);
  if (await esperar(ana, () => !!Presenca.fluxo, 'o tempo real não abriu')) {
    const f = reg(ana.id).fluxo[0];
    if (f && f.chave === CHAVE_API && f.corpo.header.auth_token_payload === token(ana.id) && f.corpo.header.app === 'Waze') {
      ok('o tempo real sai DIRETO pro Google — a CSP deixou passar, com a chave e o token');
    } else anota(`o pedido do tempo real saiu errado: ${JSON.stringify(f)}`);
    if (f && f.cookie) anota('o pedido ao Google levou cookie');
  }
  const velhos = ana.pedidos.filter((u) => /\/api\/presenca(\?|$)|\/sala\b/.test(u));
  if (velhos.length) anota(`a app ainda fala com a sala própria: ${velhos.join(', ')}`);
  else ok('nada de /api/presenca nem de /sala: a sala própria saiu do cliente');
  const pilula = await ana.page.evaluate(() => ({
    visivel: !document.getElementById('presencaPill').classList.contains('hidden'),
    selo: document.getElementById('presencaCount').textContent,
    gente: !document.getElementById('presencaIconGente').classList.contains('hidden'),
  }));
  if (pilula.visivel && pilula.selo === '1' && pilula.gente) ok('a pílula mostra 1 na app, com o ícone de gente');
  else anota(`pílula errada: ${JSON.stringify(pilula)}`);

  // ── 2. A LISTA: tocar custa um pedido, e mostra a distância ────────────────
  console.log('\n2. a lista');
  await ana.page.tap('#presencaPill');
  if (await esperar(ana, () => document.querySelector('#presencaLista .presenca-linha') !== null, 'a lista não abriu')) {
    const linha = await ana.page.evaluate(() => ({
      texto: document.querySelector('#presencaLista .presenca-linha').textContent.replace(/\s+/g, ' ').trim(),
      sub: document.getElementById('presencaSub').textContent,
    }));
    if (/cafanha/.test(linha.texto) && /L4/.test(linha.texto) && linha.texto.includes(`a ${KM} km daqui`)) ok(`a linha diz quem, o nível e a distância: "${linha.texto}"`);
    else anota(`linha da lista errada: ${linha.texto}`);
    if (/^Brazil · /.test(linha.sub)) ok(`o subtítulo diz o país do filtro: "${linha.sub}"`);
    else anota(`subtítulo errado: ${linha.sub}`);
  }
  await esperar(ana, () => true, '', 300);
  if (apiDe(ana, 'presenca-app').length === 2) ok('abrir a lista custa UM pedido');
  else anota(`abrir a lista custou ${apiDe(ana, 'presenca-app').length - 1} pedidos`);

  // ── 3. A CONVERSA ───────────────────────────────────────────────────────────
  console.log('\n3. abrir a conversa');
  await ana.page.tap('#presencaLista .presenca-linha[data-pessoa="183164343"]');
  if (await esperar(ana, () => !document.getElementById('conversaModal').classList.contains('hidden') && !!document.querySelector('#conversaMsgs .conversa-aviso'), 'a conversa não abriu com o aviso')) {
    const tela = await ana.page.evaluate(() => ({
      titulo: document.getElementById('conversaTitle').textContent,
      estado: document.getElementById('conversaEstado').textContent.trim(),
      aviso: document.querySelector('#conversaMsgs .conversa-aviso').textContent,
    }));
    if (tela.titulo === 'cafanha' && tela.estado === `No app agora · L4 · a ${KM} km daqui` && /chat do WME/.test(tela.aviso)) ok(`o topo diz onde ela está e que a conversa fica no WME`);
    else anota(`topo da conversa errado: ${JSON.stringify(tela)}`);
  }
  if (apiDe(ana, 'chat', 'abrir').length === 1) ok('abrir a conversa custa UM pedido (histórico e "lida" juntos)');
  else anota(`abrir a conversa custou ${apiDe(ana, 'chat', 'abrir').length} pedidos`);
  const campo = await alcancavel(ana, '#conversaInput');
  if (campo.noCentro && campo.dentroDaTela) ok('o campo de texto está na tela e recebe o dedo');
  else anota(`o campo da conversa não é alcançável: ${JSON.stringify(campo)}`);

  // ── 4. MANDAR: texto puro, e a outra pessoa recebe AO VIVO ─────────────────
  console.log('\n4. mandar e receber');
  await ana.page.fill('#conversaInput', 'oi, viu o posto da Faria Lima?');
  await ana.page.tap('#conversaEnviar');
  if (await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-bolha.minha .presenca-recibo.enviada'), 'a mensagem não virou "enviada"')) ok('a mensagem sai e vira ✓ Enviada');
  const envio1 = apiDe(ana, 'chat', 'enviar')[0];
  if (envio1 && envio1.c.texto === 'oi, viu o posto da Faria Lima?' && !('contexto' in envio1.c) && envio1.c.para === '183164343') ok('texto puro vai sem contexto (a marca da app quem põe é o servidor)');
  else anota(`o envio saiu errado: ${JSON.stringify(envio1 && envio1.c)}`);
  // A não lida pode estar contada AO VIVO (`vivas`) ou já pela lista, se o
  // pedido do nome de quem escreveu (conversa nova) voltou antes: o que importa
  // é o total e o balão — a primeira versão cobrava as `vivas` e era frágil.
  if (await esperar(bia, () => presencaNaoLidasDe('12444348') === 1 && !document.getElementById('presencaIconMsg').classList.contains('hidden'), 'a bia não recebeu a mensagem ao vivo')) {
    ok('a bia recebe AO VIVO: a pílula vira balão');
  }
  await bia.page.tap('#presencaPill');
  if (await esperar(bia, () => /antigerme[\s\S]*presenca-badge/.test(document.getElementById('presencaLista').innerHTML), 'a lista da bia não mostra a não lida da ana')) ok('na lista, a ana aparece "triando agora" com a não lida');

  // ── 5. LER: a outra abre, e "Lida" aparece de volta ─────────────────────────
  console.log('\n5. "Lida"');
  await bia.page.tap('#presencaLista .presenca-linha[data-pessoa="12444348"]');
  if (await esperar(bia, () => [...document.querySelectorAll('#conversaMsgs .conversa-bolha.dela')].some((b) => b.textContent.includes('Faria Lima')), 'a bia não vê a mensagem na conversa')) ok('a bia abre e vê a mensagem (o histórico vem do chat do Waze)');
  if (await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-lida'), 'o "Lida" não chegou pra ana')) {
    const lida = await ana.page.evaluate(() => document.querySelector('#conversaMsgs .conversa-lida').textContent.trim());
    ok(`a ana vê "${lida}" quando a bia lê — o recibo vem pelo tempo real`);
  }
  if (await esperar(bia, () => document.getElementById('presencaPill').classList.contains('hidden') || document.getElementById('presencaIconMsg').classList.contains('hidden'), 'a não lida da bia não zerou')) ok('abrir a conversa zera a não lida');

  // ── 6. O PEDIDO ABERTO pela conversa ────────────────────────────────────────
  console.log('\n6. mandar o pedido aberto');
  const anexou = await ana.page.evaluate(() => {
    const botaoVisivel = !document.getElementById('conversaCardBtn').classList.contains('hidden');
    document.getElementById('conversaCardBtn').click();
    return {
      botaoVisivel,
      tirinha: !document.getElementById('conversaAnexo').classList.contains('hidden'),
      nome: document.getElementById('conversaAnexoNome').textContent,
      botaoSaiu: getComputedStyle(document.getElementById('conversaCardBtn')).display === 'none',
    };
  });
  if (anexou.botaoVisivel && anexou.tirinha && anexou.botaoSaiu && anexou.nome.includes('Padaria')) ok('a tirinha mostra o pedido antes de mandar, e o botão some de verdade');
  else anota(`tirinha errada: ${JSON.stringify(anexou)}`);
  await ana.page.fill('#conversaInput', 'isso é fachada ou é a sala?');
  await ana.page.tap('#conversaEnviar');
  await esperar(ana, () => document.querySelectorAll('#conversaMsgs .conversa-pedido').length === 1, 'o cartão não ficou na conversa da ana');
  const envio2 = apiDe(ana, 'chat', 'enviar')[1];
  const recebido = envio2 && envio2.c.contexto ? (() => { const c = JSON.parse(envio2.c.contexto.card); return { foto: c.imageUrl, nome: c.name, tipo: c.updateTypeKey }; })() : null;
  const [pergunta, linha, link] = envio2 ? envio2.c.texto.split('\n') : [];
  if (pergunta === 'isso é fachada ou é a sala?' && linha === '📍 Padaria Estrela do Norte · Nova foto'
      && /^https:\/\/www\.waze\.com\/editor\?env=row&lat=.*&zoomLevel=22&venues=205522459\.2055159053\.3242788&venueUpdateRequest=.*&tab=feature_editor$/.test(link || '')) {
    ok('quem lê pelo WME recebe a pergunta, o 📍 e o link LONGO do ↗');
  } else anota(`o texto pro WME saiu errado: ${JSON.stringify(envio2 && envio2.c.texto)}`);
  if (recebido && recebido.foto === 'https://venue-image.waze.com/thumbs/thumb700_ur-smoke') {
    ok('a foto que vai no cartão é a DO PEDIDO (a 2ª do local), não a primeira');
  } else anota(`a foto que foi não é a do pedido: ${JSON.stringify(recebido && recebido.foto)}`);
  if (await esperar(bia, () => !!document.querySelector('#conversaMsgs .conversa-pedido.dela .cp-legenda'), 'o cartão não chegou pra bia')) {
    const cartao = await bia.page.evaluate(() => {
      const b = document.querySelector('#conversaMsgs .conversa-pedido.dela');
      return { nome: b.querySelector('.cp-nome').textContent, legenda: b.querySelector('.cp-legenda').textContent, link: b.textContent.includes('waze.com/editor') };
    });
    if (cartao.nome === 'Padaria Estrela do Norte' && cartao.legenda.includes('fachada') && !cartao.link) ok('na app da bia chega UM cartão com a pergunta — sem a linha nem o link do WME');
    else anota(`o cartão da bia está errado: ${JSON.stringify(cartao)}`);
    await bia.page.tap('#conversaMsgs .conversa-pedido.dela');
    if (await esperar(bia, () => !document.getElementById('pedidoModal').classList.contains('hidden') && document.getElementById('pedidoNome').textContent.includes('Padaria'), 'o pedido recebido não abriu')) ok('tocar no cartão abre o pedido, só leitura');
    // O pedido esconde a conversa (o `openModal` não empilha) sem passar pela
    // limpeza dela. Mensagem que chega AGORA não foi lida: a conversa está
    // fora da vista. Este smoke achou o "Lida" mentindo aqui.
    const lidasAntes = apiDe(bia, 'chat', 'lida').length;
    await ana.page.fill('#conversaInput', 'e aí, viu o pedido?');
    await ana.page.tap('#conversaEnviar');
    if (await esperar(bia, () => presencaNaoLidasDe('12444348') === 1, 'com o pedido por cima, a mensagem nova não virou não lida')) {
      await esperar(bia, () => true, '', 2000);   // a janela do "lida" junta 1,2 s
      if (apiDe(bia, 'chat', 'lida').length === lidasAntes) ok('com o pedido por cima da conversa, a mensagem nova fica NÃO LIDA — nada de "Lida" sem ninguém olhando');
      else anota('a bia marcou como lida com a conversa escondida pelo pedido');
    }
    await bia.page.evaluate(() => closeModal('pedidoModal'));
  }

  // ── 7. A FALHA que sobra: a do envio, com "Tentar de novo" no MESMO id ──────
  console.log('\n7. falha de envio');
  falharEnvioDe.add(ana.id);
  await ana.page.fill('#conversaInput', 'e o Instituto do Rim?');
  await ana.page.tap('#conversaEnviar');
  if (await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-reenviar'), 'a falha não mostrou "Tentar de novo"')) {
    const frase = await ana.page.evaluate(() => document.querySelector('#conversaMsgs .conversa-falhou').textContent.trim());
    if (/^Não enviada, sem conexão\. Tentar de novo$/.test(frase)) ok(`a falha diz o motivo e o que fazer: "${frase}"`);
    else anota(`frase da falha errada: ${frase}`);
    const botao = await alcancavel(ana, '#conversaMsgs .conversa-reenviar');
    if (botao.noCentro && botao.altura >= 44) ok(`"Tentar de novo" recebe o dedo (${botao.altura}px de alvo)`);
    else anota(`"Tentar de novo" não é alcançável: ${JSON.stringify(botao)}`);
    falharEnvioDe.delete(ana.id);
    await ana.page.tap('#conversaMsgs .conversa-reenviar');
    if (await esperar(ana, () => !document.querySelector('#conversaMsgs .conversa-falhou'), 'o "Tentar de novo" não mandou')) {
      const [a, b] = apiDe(ana, 'chat', 'enviar').slice(-2);
      if (a && b && a.c.id === b.c.id) ok('a repetição vai com o MESMO id');
      else anota(`a repetição mudou o id: ${a && a.c.id} → ${b && b.c.id}`);
    }
  }

  // ── 8. QUEM SÓ USA O WME: a app não mostra — mas confirma ───────────────────
  console.log('\n8. mensagem de quem só usa o WME');
  const antes = reg(ana.id).confirmados.length;
  const soWme = { id: randomUUID(), ts: Date.now(), de: '555', para: ana.id, texto: 'oi, vi você no mapa', ctx: null };
  mensagens.push(soWme);
  entregar(ana.id, bytesMsg(soWme));
  await esperar(ana, () => Presenca.fluxoDiag.quadros > 0, '', 3000);
  await dormir(1500);
  const depois = await ana.page.evaluate(() => ({ conversas: Presenca.conversas.map((c) => c.id), naoLidas: presencaNaoLidasTotal() }));
  if (!depois.conversas.includes('555') && depois.naoLidas === 0) ok('a mensagem de quem só usa o WME não aparece (decisão do owner)');
  else anota(`a mensagem do WME apareceu na app: ${JSON.stringify(depois)}`);
  // O próximo pedido que a app faria leva a confirmação de carona.
  await ana.page.evaluate(() => closeModal('conversaModal'));
  await ana.page.tap('#presencaPill').catch(() => {});
  await esperar(ana, () => true, '', 1500);
  if (reg(ana.id).confirmados.length > antes) ok('o que chegou é confirmado DE CARONA no pedido seguinte — sem pedido próprio');
  else anota('a confirmação não foi de carona');

  // ── 9. A CARONA: a ação traz a lista, sem pedido novo ───────────────────────
  console.log('\n9. carona na ação');
  naApp.delete(bia.id);   // a bia fechou a app
  await ana.page.evaluate(() => { closeModal('presencaModal'); });
  const pedidosAntes = apiDe(ana, 'presenca-app').length;
  await ana.page.evaluate(() => handleReject());
  if (await esperar(ana, () => Presenca.online.length === 0, 'a lista não veio de carona na ação', 12000)) {
    const acao = reg(ana.id).api.find((x) => x.rota === 'validar-place');
    if (acao && acao.c.presenca && Array.isArray(acao.c.presenca.conhecidos) && acao.c.presenca.conhecidos.includes('183164343')) ok('a ação leva as conversas conhecidas de carona');
    else anota(`a ação não levou as conhecidas: ${JSON.stringify(acao && acao.c.presenca)}`);
    if (apiDe(ana, 'presenca-app').length === pedidosAntes) ok('quem saiu some da lista pela resposta da AÇÃO — zero pedido a mais');
    else anota('a lista precisou de um pedido próprio');
  }
  const lista9 = await ana.page.evaluate(() => { openModal('presencaModal'); presencaRenderLista(); return document.getElementById('presencaLista').innerHTML; });
  if (/presenca\.sheet\.vazio|Ninguém mais no app agora/.test(lista9) && /cafanha/.test(lista9)) ok('a bia saiu da "Triando agora" e a conversa continua em "Conversas"');
  else anota('a lista depois da saída não tem a conversa em "Conversas"');
  await ana.page.evaluate(() => closeModal('presencaModal'));
  // A regra nova da pílula: com mensagem NÃO LIDA ela fica, mesmo sem ninguém
  // na app — a mensagem pode vir de quem já saiu, e sem a pílula a conversa não
  // teria caminho de volta.
  const semNinguem = await ana.page.evaluate(() => ({ online: Presenca.online.length, pilula: !document.getElementById('presencaPill').classList.contains('hidden') }));
  if (semNinguem.online === 0 && !semNinguem.pilula) ok('controle: sem ninguém e sem mensagem, a pílula some');
  else anota(`controle da pílula vazia errado: ${JSON.stringify(semNinguem)}`);
  // A folha do pedido escondeu a conversa da bia (seção 6): reabre.
  await bia.page.evaluate(() => { if (document.getElementById('conversaModal').classList.contains('hidden')) presencaAbrirConversa('12444348'); });
  await bia.page.fill('#conversaInput', 'saí da app, mas te respondo daqui');
  await bia.page.tap('#conversaEnviar');
  if (await esperar(ana, () => Presenca.online.length === 0 && !document.getElementById('presencaPill').classList.contains('hidden')
    && !document.getElementById('presencaIconMsg').classList.contains('hidden'), 'mensagem de quem saiu não acendeu a pílula')) {
    ok('mensagem de quem SAIU acende a pílula com o balão, mesmo sem ninguém na app');
  }

  // ── 10. SAIR apaga o chat do aparelho e fecha o tempo real ──────────────────
  console.log('\n10. sair');
  const tinha = await ana.page.evaluate(() => !!localStorage.getItem('waze_places_chat'));
  await ana.page.evaluate(() => handleLogout());
  const fim = await ana.page.evaluate(() => ({ chave: localStorage.getItem('waze_places_chat'), fluxo: !!Presenca.fluxo, online: Presenca.online.length }));
  if (tinha && fim.chave === null && !fim.fluxo) ok('o "Sair" apaga o chat do aparelho e fecha o tempo real');
  else anota(`o "Sair" deixou coisa pra trás: ${JSON.stringify({ tinha, ...fim })}`);
} finally {
  await browser.close();
  srv.kill('SIGKILL');
}

if (resumoDosPulos(MOTOR)) console.log(resumoDosPulos(MOTOR));
console.log(falhas.length ? `\n✗ ${falhas.length} falha(s)` : '\n✓ presença ok');
process.exit(falhas.length ? 1 : 0);
