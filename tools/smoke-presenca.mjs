// Smoke da presença (fase 3) — DOIS navegadores de verdade conversando pelo
// chat do WME, com o Waze e o Google simulados AQUI.
//
// Desde a fase 3 a lista e a conversa são as do WME: o servidor lê a lista e o
// chat do Waze, e o tempo real vai do navegador DIRETO ao Google. Nada disso
// roda sem as contas do owner — então este smoke faz o papel dos dois lados de
// fora, com o que o app CONFIA deles:
//   · a API (`/api/presenca-app`, `/api/chat`, as ações) é respondida por um
//     chat de mentira em memória, que filtra com as MESMAS funções do servidor
//     (`filtrarOnlineDaApp`, `filtrarConversasDaApp`) e monta as mensagens com
//     o MESMO construtor de protobuf (`server/wme-grpc.mjs`);
//   · o tempo real é o host de verdade do Google (roteado pelo Playwright), o
//     que prova de quebra que a CSP do app deixa ele passar — o host novo do
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
import { subirServidorLocal } from './servidor-local.mjs';

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
const naApp = new Set();          // quem está com o app aberto (e aparece na lista)
const mensagens = [];             // { id, ts, de, para, texto, ctx, lida }
const filas = new Map();          // id -> { itens: [{ inbox, bytes }], acordar }
// O envio que falha: 'waze' é o Waze fora (gRPC 14) com a rede boa — o
// servidor RESPONDE, com 500; 'borda' é a borda respondendo HTML (a nossa
// origem fora, a cota do plano grátis) — CHEGA, mas não é JSON; 'rede' é a
// resposta que nem chega; 'guarda' é a resposta que se perde na VOLTA, com a
// mensagem já guardada no Waze — o eco dela a quem mandou fica em
// `ecoSegurado` até o teste o entregar (a seção 13).
const falharEnvio = new Map();
const ecoSegurado = new Map();    // id de quem mandou -> a mensagem guardada
// Quem tem uma página de mensagens ANTERIORES a pedir, que demora (a seção do
// foco: o "Ver mensagens anteriores" carregando com o foco nele).
const anterioresDe = new Set();
// O perfil que DEMORA (a renovação da sessão em que ele volta depois do token)
// e a hora em que cada perfil respondeu (a seção do "lida" que espera o perfil).
const atrasoPerfil = new Map();   // id -> ms
const perfilRespondido = new Map();   // id -> Date.now() da última resposta
// O perfil SEGURADO até o teste soltar (a seção 9e): a espera do perfil por
// SINAL, não por prazo — o que se mede tem que cair DENTRO dela, e com 2,5 s
// de atraso o "Enviar" na espera chegou a cair depois de o perfil voltar.
const perfilSegurado = new Map();   // id -> Promise
// Quem está "sem rede" pro tempo real (a seção 12): o Google dela cai, como no
// modo avião — mas sem o `setOffline`, que dispara o `online` ao voltar.
const semRede = new Set();
const ABORTAR = Symbol('abortar');
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
  r.api.push({ rota, c, em: Date.now() });
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
      if (c.antesDe && anterioresDe.has(eu)) {
        anterioresDe.delete(eu);
        return dormir(900).then(() => ({ success: true, mensagens: [], maisAntigas: false, recibos: [], ...confirmados }));
      }
      const hist = mensagens.filter((m) => (m.de === eu && m.para === c.com) || (m.de === c.com && m.para === eu))
        .sort((a, b) => b.ts - a.ts)   // como o Waze: da mais nova pra mais antiga
        .map((m) => ({ id: m.id, ts: m.ts, de: { tipo: 1, id: m.de }, para: { tipo: 1, id: m.para }, classe: 'texto', texto: m.texto, recibo: null, contexto: m.ctx }));
      if (!c.antesDe) marcarLida(eu, c.com);
      // Como o servidor: `lida` diz se a conversa ficou lida (só na primeira
      // página). Sem ele, o app manda o "lida" à parte — o custo de "abrir a
      // conversa: UM pedido" que este smoke mede deixaria de ser o do app.
      return { success: true, mensagens: hist, maisAntigas: !c.antesDe && anterioresDe.has(eu), recibos: [], ...(c.antesDe ? {} : { lida: true }), ...confirmados };
    }
    if (c.acao === 'lida') { marcarLida(eu, c.com); return { success: true, recibos: [], ...confirmados }; }
    if (c.acao === 'enviar') {
      const falha = falharEnvio.get(eu);
      if (falha === 'rede') return ABORTAR;
      // Como o core com o gRPC 14 do Waze: 500, transiente — e SEM `_motivo`,
      // que só o `_post` do app põe, quando a resposta nem chega.
      if (falha === 'waze') return { __status: 500, success: false, error: 'Erro de conexão com o Waze', errorKey: 'srv.err.connection', errorCategory: 'transient', httpCode: 200, grpcStatus: 14 };
      if (falha === 'borda') return { __status: 502, __html: '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>error code: 502</body></html>' };
      // A marca do app quem põe é o SERVIDOR (como no core).
      const m = { id: c.id, ts: Date.now(), de: eu, para: c.para, texto: c.texto, ctx: { ...(c.contexto || {}), app: 'wazeplaces' } };
      if (!mensagens.some((x) => x.id === m.id)) mensagens.push(m);
      entregar(c.para, bytesMsg(m));
      // Guardada, e a resposta se perde na volta: o eco espera o teste.
      if (falha === 'guarda') { ecoSegurado.set(eu, m); return ABORTAR; }
      entregar(eu, bytesMsg(m));   // o eco, como o Waze faz
      return { success: true, id: m.id, ts: m.ts, ...confirmados };
    }
  }
  // A abertura de VERDADE (o `initApp` com a sessão salva): perfil, países e a
  // fila. Injetar isso tudo por fora escondeu um defeito: a presença pedia a
  // lista ANTES de o perfil chegar e desistia calada (gotcha #52 — o helper
  // que arruma a tela faz o que o app esquece).
  if (rota === 'perfil') {
    const p = PESSOAS[eu];
    const corpo = { success: true, visivelNoWme: true, referencias: { casa: null, trabalho: null },
      profile: { id: Number(eu), userName: p.nome, rank: p.rank, isStaff: false, isAreaManager: true, isEditor: true,
        editableCountryIDs: [BRASIL], areas: [], managedAreas: [] } };
    const responder = () => { perfilRespondido.set(eu, Date.now()); return corpo; };
    if (perfilSegurado.has(eu)) return perfilSegurado.get(eu).then(responder);
    return atrasoPerfil.get(eu) ? dormir(atrasoPerfil.get(eu)).then(responder) : responder();
  }
  if (rota === 'lista-paises') return { success: true, countries: [{ id: BRASIL, name: 'Brazil', abbr: 'BR' }] };
  if (rota === 'lista-estados') return { success: true, states: [] };
  if (rota === 'buscar-places') {
    // A bia tem DOIS pedidos: a seção 11 decide os dois (✕), e ninguém mais usa
    // a fila dela. A da ana segue com um só (a seção 9 a esvazia, e é de
    // propósito: a 7a explica).
    const lista = [pedido(PESSOAS[eu].pos.lat, PESSOAS[eu].pos.lon)];
    if (eu === '183164343') lista.push(pedido(PESSOAS[eu].pos.lat + 0.001, PESSOAS[eu].pos.lon, 'ur-smoke-2'));
    return { success: true, places: lista, hasMore: false, page: 1, total: lista.length };
  }
  if (rota === 'validar-place' || rota === 'marcar-lido') {
    return { success: true, presenca: { ok: true, marca: true }, presencaApp: { online: listaPara(eu), conversas: conversasPara(eu, (c.presenca && c.presenca.conhecidos) || []) } };
  }
  return { success: false };
}

// ── o servidor do app (os estáticos e a CSP de verdade) ─────────────────────
const dir = await mkdtemp(join(tmpdir(), 'wp-presenca-'));
// Sobe por `tools/servidor-local.mjs`: porta LIVRE antes, e pronto é o próprio
// processo dizer que a ocupou (senão o smoke mediria o servidor de outro).
const { servidor: srv } = await subirServidorLocal({ porta: PORTA, variavel: 'SMOKE_PORT', stderr: 'ignore',
  env: { SESSION_DIR: dir, ENCRYPTION_KEY: CHAVE } });

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
const pedido = (lat, lon, ur = 'ur-smoke') => ({
  ...REAL,
  venueID: '205522459.2055159053.' + (ur === 'ur-smoke' ? '3242788' : '3242789'), updateRequestID: ur,
  name: 'Padaria Estrela do Norte', address: 'R. Aurora, 412 — São Paulo',
  categories: ['BAKERY'], updateTypeKey: 'IMAGE', purType: 'NEW_PHOTO', reqType: 'IMAGE',
  imageUrls: ['https://venue-image.waze.com/thumbs/thumb700_ja-no-local',
              'https://venue-image.waze.com/thumbs/thumb700_' + ur],
  imageUrl: 'https://venue-image.waze.com/thumbs/thumb700_ja-no-local',
  lat, lon, mapa: { ...REAL.mapa, centro: [lat, lon], entradas: [] }, changes: [], flagComment: null,
});

async function editor(id, { lang = 'pt' } = {}) {
  const p = PESSOAS[id];
  // `serviceWorkers: 'block'`: o SW do app se auto-atualiza e RECARREGA a página
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
    if (semRede.has(id)) return route.abort('internetdisconnected').catch(() => {});
    let corpo = null;
    try { corpo = JSON.parse(req.postData() || 'null'); } catch { /* registrado como null */ }
    reg(id).fluxo.push({ url: req.url(), chave: req.headers()['x-goog-api-key'], corpo, cookie: req.headers().cookie || null });
    if (!corpo || !corpo.header || corpo.header.auth_token_payload !== token(id)) {
      return route.fulfill({ status: 401, headers: cors, body: '' }).catch(() => {});
    }
    const f = fila(id);
    if (!f.itens.length) await Promise.race([new Promise((ok) => { f.acordar = ok; }), dormir(25_000)]);
    // Entrega TUDO o que não foi confirmado, AO VIVO — mas depois do lote que
    // abre TODA conexão. MEDIDO em 2026-09-25 no app de produção: o Google manda
    // `startOfBatch` e `endOfBatch` no 1º milissegundo, VAZIO quando não há nada
    // na fila, e só então as mensagens ao vivo. Sem o lote o fake era uma
    // conexão que "nunca abriu" — e o app (certo) a trata como queda, com recuo.
    const quadros = [{ startOfBatch: {} }, { endOfBatch: {} },
      ...f.itens.map((x) => ({ inboxMessage: { messageId: x.inbox, messageType: 'MESSAGE', message: Buffer.from(x.bytes).toString('base64') } }))];
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: '[' + quadros.map((q) => JSON.stringify(q)).join(',\n') + ']' }).catch(() => {});
  });
  await ctx.route('**/api/**', async (route) => {
    const req = route.request();
    const rota = new URL(req.url()).pathname.split('/').pop();
    let c = {};
    try { c = JSON.parse(req.postData() || '{}'); } catch { /* vazio */ }
    const corpo = await responderApi(id, rota, c);
    if (corpo === ABORTAR) return route.abort('internetdisconnected').catch(() => {});
    const { __status, __html, ...resto } = corpo;
    if (__html) return route.fulfill({ status: __status || 200, contentType: 'text/html', body: __html }).catch(() => {});
    await route.fulfill({ status: __status || 200, contentType: 'application/json', body: JSON.stringify(resto) }).catch(() => {});
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
        vivas: [...Presenca.vivas].map(([k, v]) => `${k}:${v.n}`), fluxo: !!Presenca.fluxo, parado: Presenca.fluxoParado,
        visivel: document.visibilityState, podeConectar: presencaPodeConectar(), diag: Presenca.fluxoDiag,
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
  // primeira versão deste smoke abria na ordem contrária e "reprovou" o app por
  // fazer exatamente o combinado.
  const bia = await editor('183164343');
  const ana = await editor('12444348');

  // ── 1. ABRIR: UM pedido, o tempo real direto no Google, e nada da sala velha
  console.log('\n1. abrir o app');
  if (await esperar(ana, () => Presenca.online.some((p) => p.nome === 'cafanha'), 'a lista do app não chegou pra ana')) ok('a lista do app chega (quem usa o app no país)');
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
  if (velhos.length) anota(`o app ainda fala com a sala própria: ${velhos.join(', ')}`);
  else ok('nada de /api/presenca nem de /sala: a sala própria saiu do cliente');
  const pilula = await ana.page.evaluate(() => ({
    visivel: !document.getElementById('presencaPill').classList.contains('hidden'),
    selo: document.getElementById('presencaCount').textContent,
    gente: !document.getElementById('presencaIconGente').classList.contains('hidden'),
  }));
  if (pilula.visivel && pilula.selo === '1' && pilula.gente) ok('a pílula mostra 1 no app, com o ícone de gente');
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
  // O FOCO de quem abriu a conversa pelo toque: no DEDO, nunca o campo — no
  // celular ele abre o teclado por cima da conversa, bem quando a pessoa a abriu
  // pra LER (auditoria da rodada 14, R14-8-15). A régua é a do app (`pointer:
  // coarse`, a da tela de entrada); com mouse, o campo. Lido logo depois do
  // toque, antes de qualquer outro gesto.
  const focoAoAbrir = await ana.page.evaluate(() => ({ dedo: matchMedia('(pointer: coarse)').matches,
    ativo: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null }));
  if (focoAoAbrir.dedo ? focoAoAbrir.ativo !== 'conversaInput' : focoAoAbrir.ativo === 'conversaInput') {
    ok(`abrir a conversa ${focoAoAbrir.dedo ? 'no dedo deixa o foco fora do campo (o teclado não sobe)' : 'com mouse põe o foco no campo'}: ${focoAoAbrir.ativo}`);
  } else anota(`abrir a conversa pôs o foco em ${focoAoAbrir.ativo} (ponteiro de dedo: ${focoAoAbrir.dedo})`);
  if (apiDe(ana, 'chat', 'abrir').length === 1) ok('abrir a conversa custa UM pedido (histórico e "lida" juntos)');
  else anota(`abrir a conversa custou ${apiDe(ana, 'chat', 'abrir').length} pedidos`);
  const campo = await alcancavel(ana, '#conversaInput');
  if (campo.noCentro && campo.dentroDaTela) ok('o campo de texto está na tela e recebe o dedo');
  else anota(`o campo da conversa não é alcançável: ${JSON.stringify(campo)}`);
  // CONTROLE: a mesma abertura com o ponteiro do OUTRO tipo põe o foco no lugar
  // do outro tipo — a medição enxerga a diferença, e a decisão é mesmo da régua.
  // Depois da conta de pedidos acima: reabrir pede o histórico de novo.
  const focoNoOutro = await ana.page.evaluate((dedo) => {
    const real = window.matchMedia;
    window.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' ? !dedo : real.call(window, q).matches });
    try { presencaAbrirConversa('183164343'); } finally { window.matchMedia = real; }
    return document.activeElement ? document.activeElement.id || document.activeElement.tagName : null;
  }, focoAoAbrir.dedo);
  if (focoAoAbrir.dedo ? focoNoOutro === 'conversaInput' : focoNoOutro !== 'conversaInput') ok(`controle: com o ponteiro do outro tipo, o foco vai pra ${focoNoOutro}`);
  else anota(`controle: com o ponteiro do outro tipo, o foco foi pra ${focoNoOutro} — a medição não distinguiria nada`);

  // ── 4. MANDAR: texto puro, e a outra pessoa recebe AO VIVO ─────────────────
  console.log('\n4. mandar e receber');
  await ana.page.fill('#conversaInput', 'oi, viu o posto da Faria Lima?');
  await ana.page.tap('#conversaEnviar');
  if (await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-bolha.minha .presenca-recibo.enviada'), 'a mensagem não virou "enviada"')) ok('a mensagem sai e vira ✓ Enviada');
  const envio1 = apiDe(ana, 'chat', 'enviar')[0];
  if (envio1 && envio1.c.texto === 'oi, viu o posto da Faria Lima?' && !('contexto' in envio1.c) && envio1.c.para === '183164343') ok('texto puro vai sem contexto (a marca do app quem põe é o servidor)');
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
  // Mandado, o pedido sai da tirinha escondida também (o relatório do modo dev
  // leva o DOM inteiro; auditoria de 2026-09-29, P1). O controle é a tirinha
  // cheia, logo acima.
  const tirinha = await ana.page.evaluate(() => ({ nome: document.getElementById('conversaAnexoNome').textContent, foto: document.getElementById('conversaAnexoFoto').getAttribute('src') }));
  if (!tirinha.nome && !tirinha.foto) ok('mandado o pedido, a tirinha solta não guarda o nome nem a foto dele');
  else anota(`a tirinha solta guardou o pedido: ${JSON.stringify(tirinha)}`);
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
    if (cartao.nome === 'Padaria Estrela do Norte' && cartao.legenda.includes('fachada') && !cartao.link) ok('no app da bia chega UM cartão com a pergunta — sem a linha nem o link do WME');
    else anota(`o cartão da bia está errado: ${JSON.stringify(cartao)}`);
    await bia.page.tap('#conversaMsgs .conversa-pedido.dela');
    if (await esperar(bia, () => !document.getElementById('pedidoModal').classList.contains('hidden') && document.getElementById('pedidoNome').textContent.includes('Padaria'), 'o pedido recebido não abriu')) ok('tocar no cartão abre o pedido, só leitura');
    // O pedido esconde a conversa (o `openModal` não empilha). Mensagem que
    // chega AGORA não foi lida: a conversa está fora da vista. Este smoke achou
    // o "Lida" mentindo aqui. A conta começa depois de assentar o "lida" da
    // mensagem que ela VIU (o cartão): esconder a conversa o adianta.
    await dormir(500);
    const lidasAntes = apiDe(bia, 'chat', 'lida').length;
    await ana.page.fill('#conversaInput', 'e aí, viu o pedido?');
    await ana.page.tap('#conversaEnviar');
    if (await esperar(bia, () => presencaNaoLidasDe('12444348') === 1, 'com o pedido por cima, a mensagem nova não virou não lida')) {
      await esperar(bia, () => true, '', 2000);   // a janela do "lida" junta 1,2 s
      if (apiDe(bia, 'chat', 'lida').length === lidasAntes) ok('com o pedido por cima da conversa, a mensagem nova fica NÃO LIDA — nada de "Lida" sem ninguém olhando');
      else anota('a bia marcou como lida com a conversa escondida pelo pedido');
    }
    await bia.page.evaluate(() => closeModal('pedidoModal'));
    // Fechada, a folha não guarda o pedido de terceiro (P1). O controle é ela
    // aberta com a Padaria, logo acima.
    const folha = await bia.page.evaluate(() => ({
      nome: document.getElementById('pedidoNome').textContent, de: document.getElementById('pedidoDe').textContent,
      end: document.getElementById('pedidoEnd').textContent, foto: document.getElementById('pedidoFotoImg').getAttribute('src'),
      link: document.getElementById('pedidoWme').getAttribute('href'),
    }));
    if (!folha.nome && !folha.de && !folha.end && !folha.foto && !folha.link) ok('fechada, a folha do pedido não guarda nome, de quem, endereço, foto nem link');
    else anota(`a folha do pedido fechada guardou o pedido de terceiro: ${JSON.stringify(folha)}`);
  }

  // ── 7. A FALHA que sobra: a do envio, com "Tentar de novo" no MESMO id ──────
  // Duas falhas, duas frases (auditoria de 2026-09-29, P10): o Waze fora com a
  // rede boa — a resposta CHEGA, e "sem sinal" mandaria procurar sinal — e a
  // rede fora, em que a resposta nem chega.
  console.log('\n7. falha de envio');
  const frase = () => ana.page.evaluate(() => (document.querySelector('#conversaMsgs .conversa-falhou') || {}).textContent?.trim() || '');
  // O leitor de tela ouve a falha (auditoria da rodada 11, R11-5-03): a região
  // viva da conversa (`#conversaAnuncio`) diz a MESMA frase da tela — o texto
  // antes do "Tentar de novo". O campo é limpo no "Enviar", e sem o anúncio o
  // envio que falha soava igual ao que deu certo. Tudo o que a região diz nesta
  // seção fica registrado (`__anuncios`), na ordem.
  const fraseDaFalha = () => ana.page.evaluate(() => {
    const p = document.querySelector('#conversaMsgs .conversa-falhou');
    return p && p.firstChild ? p.firstChild.textContent.trim() : '';
  });
  const anuncioDaConversa = () => ana.page.evaluate(() => document.getElementById('conversaAnuncio').textContent);
  await ana.page.evaluate(() => {
    window.__anuncios = [];
    const el = document.getElementById('conversaAnuncio');
    new MutationObserver(() => window.__anuncios.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  // CONTROLE: antes da falha a região não diz "Não enviada" — senão a medição
  // de depois não distinguiria nada.
  const antesDaFalha = await anuncioDaConversa();
  if (!/Não enviada/.test(antesDaFalha)) ok('controle: antes da falha, a região viva da conversa não diz "Não enviada"');
  else anota(`controle: a região viva já dizia "${antesDaFalha}" antes da falha — a medição não distinguiria nada`);
  const enviosAntes = apiDe(ana, 'chat', 'enviar').length;
  falharEnvio.set(ana.id, 'waze');
  await ana.page.fill('#conversaInput', 'e o Instituto do Rim?');
  await ana.page.tap('#conversaEnviar');
  if (await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-reenviar'), 'a falha não mostrou "Tentar de novo"')) {
    const doWaze = await frase();
    if (/^Não enviada\. Tentar de novo$/.test(doWaze)) ok(`o Waze fora, com a rede boa: "${doWaze}" — sem mandar procurar sinal`);
    else anota(`frase da falha do Waze errada: ${doWaze}`);
    const dito = await anuncioDaConversa();
    const naTela = await fraseDaFalha();
    if (dito && dito === naTela) ok(`o leitor de tela ouve a falha: "${dito}" — a mesma frase da tela`);
    else anota(`a falha não chegou ao leitor de tela: ${JSON.stringify({ dito, naTela })}`);
    const botao = await alcancavel(ana, '#conversaMsgs .conversa-reenviar');
    if (botao.noCentro && botao.altura >= 44) ok(`"Tentar de novo" recebe o dedo (${botao.altura}px de alvo)`);
    else anota(`"Tentar de novo" não é alcançável: ${JSON.stringify(botao)}`);
    // A BORDA responde HTML (a nossa origem fora, a cota do plano grátis): a
    // resposta CHEGA — a rede está boa — e a frase é a do Waze fora, não a de
    // "sem sinal" (auditoria de 2026-09-30, R5-5-3). Quem lê o HTML é o
    // `_post` de verdade.
    falharEnvio.set(ana.id, 'borda');
    await ana.page.tap('#conversaMsgs .conversa-reenviar');
    for (let i = 0; i < 50 && apiDe(ana, 'chat', 'enviar').length < enviosAntes + 2; i++) await dormir(100);
    if (await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-reenviar'), 'a falha da borda não mostrou "Tentar de novo"')) {
      const daBorda = await frase();
      if (/^Não enviada\. Tentar de novo$/.test(daBorda)) ok(`a borda respondendo HTML (502), com a rede boa: "${daBorda}" — sem mandar procurar sinal`);
      else anota(`frase da falha da borda errada: ${daBorda}`);
    }
    // A rede cai: a nova tentativa nem chega ao servidor.
    falharEnvio.set(ana.id, 'rede');
    await ana.page.tap('#conversaMsgs .conversa-reenviar');
    if (await esperar(ana, () => /sem sinal/.test((document.querySelector('#conversaMsgs .conversa-falhou') || {}).textContent || ''), 'sem rede, a falha não disse "sem sinal"')) {
      const daRede = await frase();
      if (/^Não enviada, sem sinal\. Tentar de novo$/.test(daRede)) ok(`sem rede: "${daRede}"`);
      else anota(`frase da falha de rede errada: ${daRede}`);
      const dito = await anuncioDaConversa();
      const naTela = await fraseDaFalha();
      if (dito && dito === naTela) ok(`sem rede, o leitor de tela ouve "${dito}" — a mesma frase da tela`);
      else anota(`sem rede, a falha não chegou ao leitor de tela: ${JSON.stringify({ dito, naTela })}`);
    }
    falharEnvio.delete(ana.id);
    await ana.page.tap('#conversaMsgs .conversa-reenviar');
    if (await esperar(ana, () => !document.querySelector('#conversaMsgs .conversa-falhou'), 'o "Tentar de novo" não mandou')) {
      // A linha de falha some quando a tentativa COMEÇA ("enviando"), antes de o
      // pedido chegar à rota de mentira: espere o REGISTRO da 3ª tentativa e leia
      // só as desta mensagem. Com `slice(-3)` na hora, a corrida trazia o envio
      // de uma mensagem ANTERIOR e acusava "o id mudou" com o app certo.
      for (let i = 0; i < 50 && apiDe(ana, 'chat', 'enviar').length < enviosAntes + 4; i++) await dormir(100);
      const ids = apiDe(ana, 'chat', 'enviar').slice(enviosAntes).map((x) => x.c.id);
      if (ids.length === 4 && ids.every((i) => i === ids[0])) ok('as quatro tentativas vão com o MESMO id');
      else anota(`as tentativas mudaram o id (ou não foram quatro): ${ids.join(' → ')}`);
      // Cada falha dita, cada tentativa começando calada (a mesma frase outra
      // vez é uma MUDANÇA, e é lida de novo), e o envio que deu certo sem a
      // falha pra trás. Lido depois de a resposta da 4ª tentativa assentar.
      await esperar(ana, () => ((Presenca.historico.get('183164343') || { msgs: [] }).msgs
        .find((m) => m.meu && /Instituto do Rim/.test(m.texto)) || {}).estado === 'enviada', 'a 4ª tentativa não assentou como enviada');
      const ditos = await ana.page.evaluate(() => window.__anuncios.slice());
      const esperado = ['Não enviada.', '', 'Não enviada.', '', 'Não enviada, sem sinal.', ''];
      if (JSON.stringify(ditos) === JSON.stringify(esperado)) ok('o leitor de tela ouve cada falha, a mesma frase outra vez também (a tentativa começa calada) — e o envio que dá certo não deixa a falha pra trás');
      else anota(`o que a região viva da conversa disse nas tentativas: ${JSON.stringify(ditos)} (esperado ${JSON.stringify(esperado)})`);
    }
  }

  // ── 7a. O ✕ DA TIRINHA pelo teclado ─────────────────────────────────────
  // A tirinha do pedido preso some com o foco dentro, e ele ia pro <body>
  // (auditoria de 2026-09-30, R5-5-7). Vai pro botão de prender, que volta a
  // aparecer. Aqui, e não mais adiante: depois da ação da seção 9 a fila da
  // ana acaba, e sem pedido na tela não há o que prender.
  console.log('\n7a. o ✕ da tirinha pelo teclado');
  const focado = () => ana.page.evaluate(() => (document.activeElement ? document.activeElement.id || document.activeElement.tagName : null));
  const prender = async () => {
    await ana.page.evaluate(() => document.getElementById('conversaCardBtn').click());
    return esperar(ana, () => !document.getElementById('conversaAnexo').classList.contains('hidden'), 'a tirinha do pedido preso não apareceu');
  };
  // CONTROLE: soltar cru, sem cuidar do foco, põe o foco no <body> — a medição
  // enxerga a perda. Lido depois de um tempo: o navegador só tira o foco do
  // elemento escondido no próximo desenho (lido na hora, ele ainda é o ✕).
  if (await prender()) {
    await ana.page.focus('#conversaAnexoTirar');
    await ana.page.evaluate(() => presencaSoltarAnexo());
    await dormir(150);
    const cru = await focado();
    if (cru === 'BODY') ok('controle: soltar a tirinha cru põe o foco no <body> — a medição enxerga a perda');
    else anota(`controle: soltar a tirinha cru não tirou o foco (${cru}) — a medição não distinguiria nada`);
  }
  if (await prender()) {
    await ana.page.focus('#conversaAnexoTirar');
    await ana.page.keyboard.press('Enter');
    await dormir(150);
    const f = await focado();
    const solta = await ana.page.evaluate(() => document.getElementById('conversaAnexo').classList.contains('hidden'));
    if (solta && f === 'conversaCardBtn') ok('o ✕ da tirinha pelo teclado: o foco vai pro botão de prender — não pro <body>');
    else anota(`o ✕ da tirinha pelo teclado levou o foco pra ${f} (tirinha solta: ${solta})`);
  }

  // ── 7b. A RENOVAÇÃO SILENCIOSA da sessão não fecha a conversa ────────────
  // A sessão cai e a extensão a devolve em segundos, com a MESMA conta. O
  // perfil some na queda e volta depois da sessão — e, sem ele, a presença
  // desligava: fechava a conversa e perdia o pedido preso (auditoria de
  // 2026-09-29, P2). A extensão é de mentira; o resto é o caminho de verdade
  // (derrubarSessao → entrarPelaExtensao → showMainScreen → o perfil).
  console.log('\n7b. a sessão cai e a extensão a renova (a mesma conta)');
  await ana.page.evaluate(() => {
    window.addEventListener('message', (ev) => {
      if (ev.data && ev.data.source === 'wazeplaces' && ev.data.action === 'precisa-de-sessao') {
        window.postMessage({ source: 'wazeplaces-ext', action: 'aguarde' }, location.origin);
        setTimeout(() => window.postMessage({ source: 'wazeplaces-ext', action: 'sessao', token: 'token-renovado-antigerme' }, location.origin), 600);
      }
    });
  });
  const pronta = await ana.page.evaluate(() => {
    document.getElementById('conversaCardBtn').click();
    document.getElementById('conversaInput').value = 'meio escrito';
    return { conversa: !document.getElementById('conversaModal').classList.contains('hidden'), aberta: Presenca.aberta, anexo: !!Presenca.anexo };
  });
  if (!(pronta.conversa && pronta.aberta === '183164343' && pronta.anexo)) anota(`controle: a conversa não estava pronta pra queda: ${JSON.stringify(pronta)}`);
  const fluxosAntes = reg(ana.id).fluxo.length;
  // A queda de verdade chega longe do último pedido da lista: com a lista de
  // mais de um minuto, o perfil que volta PEDE a lista — e a lista só abre o
  // tempo real quando traz token novo. É o caminho que a espera tem que cobrir
  // (o token ainda vale), e aqui ele é forçado em vez de esperado.
  await ana.page.evaluate(() => { Presenca.atualizadaEm -= 5 * 60000; Presenca.tentadaEm = 0; });
  await ana.page.evaluate(() => derrubarSessao('srv.err.sessionExpired'));
  if (await esperar(ana, () => AppState.authenticated && !!AppState.profile && API.getSession() === 'token-renovado-antigerme', 'a extensão não renovou a sessão')) {
    await dormir(800);
    const depois = await ana.page.evaluate(() => ({
      conversa: !document.getElementById('conversaModal').classList.contains('hidden'), aberta: Presenca.aberta,
      tirinha: document.getElementById('conversaAnexoNome').textContent, campo: document.getElementById('conversaInput').value,
      telaEntrada: !document.getElementById('authScreen').classList.contains('hidden'),
    }));
    if (depois.conversa && depois.aberta === '183164343' && depois.tirinha.includes('Padaria') && depois.campo === 'meio escrito' && !depois.telaEntrada) {
      ok('renovada em silêncio, a conversa segue aberta, com o pedido preso e o texto no campo');
    } else anota(`a renovação silenciosa mexeu na conversa: ${JSON.stringify(depois)}`);
    // O tempo real fechou na espera do perfil e REABRE com ele: a mensagem da bia chega na conversa aberta.
    await bia.page.evaluate(() => { if (document.getElementById('conversaModal').classList.contains('hidden')) presencaAbrirConversa('12444348'); });
    await bia.page.fill('#conversaInput', 'chegou depois da renovação?');
    await bia.page.tap('#conversaEnviar');
    if (await esperar(ana, () => [...document.querySelectorAll('#conversaMsgs .conversa-bolha.dela')].some((b) => b.textContent.includes('chegou depois da renovação?')),
      'a mensagem de depois da renovação não chegou na conversa aberta')) {
      ok(`o tempo real reabriu com o perfil (${reg(ana.id).fluxo.length - fluxosAntes} conexão nova ao Google) e a mensagem chega na conversa aberta`);
    }
    // A conversa fecha logo abaixo, antes de o "lida" dela sair (ele junta a
    // rajada por 1,2 s): quem o manda é o FECHAMENTO ("olhando é lida", seção
    // 9c). Sem isso a mensagem ficaria não lida no Waze, e o controle da pílula
    // vazia da seção 9 reprovaria — foi assim que o defeito apareceu.
  }
  // CONTROLE: os Filtros abertos na mesma queda ficam — sempre ficaram. Se
  // fechassem, a medição de cima não distinguiria nada.
  // `openFiltersModal` SOZINHO: ele esconde a conversa (com a limpeza dela).
  // Fechar uma e abrir o outro no mesmo quadro é o gotcha #65 — o voltar
  // pendente come a entrada nova, e o próximo fechamento sai do app (foi o que
  // a primeira versão desta seção fez).
  await ana.page.evaluate(() => { document.getElementById('conversaInput').value = ''; openFiltersModal(); });
  await ana.page.evaluate(() => derrubarSessao('srv.err.sessionExpired'));
  if (await esperar(ana, () => AppState.authenticated && !!AppState.profile, 'a segunda renovação não voltou')) {
    await dormir(800);
    if (await ana.page.evaluate(() => !document.getElementById('filtersModal').classList.contains('hidden'))) ok('controle: os Filtros abertos na mesma queda seguem abertos');
    else anota('controle: os Filtros fecharam na renovação');
  }
  await ana.page.evaluate(() => closeModal('filtersModal'));

  // ── 8. QUEM SÓ USA O WME: o app não mostra — mas confirma ───────────────────
  console.log('\n8. mensagem de quem só usa o WME');
  const antes = reg(ana.id).confirmados.length;
  const soWme = { id: randomUUID(), ts: Date.now(), de: '555', para: ana.id, texto: 'oi, vi você no mapa', ctx: null };
  mensagens.push(soWme);
  entregar(ana.id, bytesMsg(soWme));
  await esperar(ana, () => Presenca.fluxoDiag.quadros > 0, '', 3000);
  await dormir(1500);
  const depois = await ana.page.evaluate(() => ({ conversas: Presenca.conversas.map((c) => c.id), naoLidas: presencaNaoLidasTotal() }));
  if (!depois.conversas.includes('555') && depois.naoLidas === 0) ok('a mensagem de quem só usa o WME não aparece (decisão do owner)');
  else anota(`a mensagem do WME apareceu no app: ${JSON.stringify(depois)}`);
  // O próximo pedido que o app faria leva a confirmação de carona.
  await ana.page.evaluate(() => closeModal('conversaModal'));
  await ana.page.tap('#presencaPill').catch(() => {});
  await esperar(ana, () => true, '', 1500);
  if (reg(ana.id).confirmados.length > antes) ok('o que chegou é confirmado DE CARONA no pedido seguinte — sem pedido próprio');
  else anota('a confirmação não foi de carona');

  // ── 9. A CARONA: a ação traz a lista, sem pedido novo ───────────────────────
  console.log('\n9. carona na ação');
  naApp.delete(bia.id);   // a bia fechou o app
  await ana.page.evaluate(() => { closeModal('presencaModal'); });
  // A carona desta ação diz "ninguém no app" e não há mensagem: a pílula SOME —
  // com o foco do teclado nela (fechar a lista o devolve à pílula), ele caía no
  // <body> (auditoria da rodada 11, R11-5-04). CONTROLE do instrumento:
  // escondê-la cru, com o foco nela, põe o foco no <body> — a medição enxerga a
  // perda. Lido depois de um tempo: o navegador só tira o foco do elemento
  // escondido no próximo desenho.
  const focoNoCabecalho = () => ana.page.evaluate(() => (document.activeElement ? document.activeElement.id || document.activeElement.tagName : null));
  await ana.page.focus('#presencaPill');
  await ana.page.evaluate(() => document.getElementById('presencaPill').classList.add('hidden'));
  await dormir(150);
  const cruDaPilula = await focoNoCabecalho();
  if (cruDaPilula === 'BODY') ok('controle: esconder a pílula cru, com o foco nela, põe o foco no <body> — a medição enxerga a perda');
  else anota(`controle: esconder a pílula cru não tirou o foco (${cruDaPilula}) — a medição não distinguiria nada`);
  await ana.page.evaluate(() => presencaRenderPilula());   // a pílula de verdade de volta: a bia segue na lista da ana até a carona
  await ana.page.focus('#presencaPill');
  const pedidosAntes = apiDe(ana, 'presenca-app').length;
  await ana.page.evaluate(() => handleReject());
  if (await esperar(ana, () => Presenca.online.length === 0, 'a lista não veio de carona na ação', 12000)) {
    await dormir(150);
    const pilulaSumiu = await ana.page.evaluate(() => document.getElementById('presencaPill').classList.contains('hidden'));
    const focoDepois = await focoNoCabecalho();
    if (pilulaSumiu && focoDepois === 'themeBtn') ok('a pílula sumiu com o foco nela: o foco foi pro vizinho do cabeçalho (o do tema) — não pro <body>');
    else anota(`a pílula sumiu com o foco nela e o foco foi pra ${focoDepois} (pílula escondida: ${pilulaSumiu})`);
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
  // no app — a mensagem pode vir de quem já saiu, e sem a pílula a conversa não
  // teria caminho de volta.
  const semNinguem = await ana.page.evaluate(() => ({ online: Presenca.online.length, pilula: !document.getElementById('presencaPill').classList.contains('hidden') }));
  if (semNinguem.online === 0 && !semNinguem.pilula) ok('controle: sem ninguém e sem mensagem, a pílula some');
  else anota(`controle da pílula vazia errado: ${JSON.stringify(semNinguem)}`);
  // A folha do pedido escondeu a conversa da bia (seção 6): reabre.
  await bia.page.evaluate(() => { if (document.getElementById('conversaModal').classList.contains('hidden')) presencaAbrirConversa('12444348'); });
  await bia.page.fill('#conversaInput', 'saí do app, mas te respondo daqui');
  await bia.page.tap('#conversaEnviar');
  if (await esperar(ana, () => Presenca.online.length === 0 && !document.getElementById('presencaPill').classList.contains('hidden')
    && !document.getElementById('presencaIconMsg').classList.contains('hidden'), 'mensagem de quem saiu não acendeu a pílula')) {
    ok('mensagem de quem SAIU acende a pílula com o balão, mesmo sem ninguém no app');
  }

  // ── 9b. O FOCO no redesenho — teclado e leitor de tela ──────────────────────
  // A lista e a conversa são redesenhadas por `innerHTML` a cada mensagem e a
  // cada resposta, e o foco caía no <body> (auditoria de 2026-09-29, P3,
  // medido no Chromium e no WebKit). O foco vai por `focus()` e não por Tab: o
  // que se mede é o REDESENHO, e o Tab do WebKit não passa por botão sem ajuste
  // do sistema.
  console.log('\n9b. o foco fica onde estava quando a lista e a conversa se redesenham');
  const ativo = () => ana.page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a ? a.tagName : null, id: (a && a.id) || '', classe: a ? String(a.className) : '',
      pessoa: a && a.getAttribute ? a.getAttribute('data-pessoa') : null, msg: a && a.getAttribute ? a.getAttribute('data-id') : null,
      desabilitado: a && a.getAttribute ? a.getAttribute('aria-disabled') : null };
  });
  const biaManda = async (texto) => {
    await bia.page.evaluate(() => { if (document.getElementById('conversaModal').classList.contains('hidden')) presencaAbrirConversa('12444348'); });
    await bia.page.fill('#conversaInput', texto);
    await bia.page.tap('#conversaEnviar');
  };
  const LINHA = '#presencaLista .presenca-linha[data-pessoa="183164343"]';
  await ana.page.evaluate(() => { for (const id of ['conversaModal', 'pedidoModal']) closeModal(id); });
  await ana.page.tap('#presencaPill');
  if (await esperar(ana, (sel) => !!document.querySelector(sel), 'a linha da bia não está na lista da ana', 15000, LINHA)) {
    // CONTROLE do instrumento: um `innerHTML` cru, como o de antes, TIRA o foco — e a medição vê.
    await ana.page.focus(LINHA);
    const cru = await ana.page.evaluate(() => { const l = document.getElementById('presencaLista'); l.innerHTML = l.innerHTML; return document.activeElement.tagName; });
    if (cru === 'BODY') ok('controle: um redesenho cru põe o foco no <body> — a medição enxerga a perda');
    else anota(`controle: o redesenho cru não tirou o foco (${cru}) — a medição não distinguiria nada`);
    await ana.page.evaluate(() => presencaRenderLista());   // o desenho de verdade de volta
    await ana.page.focus(LINHA);
    await dormir(1500);
    const parado = await ativo();
    if (parado.pessoa !== '183164343') anota(`controle: sem nada chegar, o foco saiu da linha: ${JSON.stringify(parado)}`);
    const antes9b = await ana.page.evaluate(() => presencaNaoLidasDe('183164343'));
    await biaManda('uma pergunta com a lista aberta');
    if (await esperar(ana, (n) => presencaNaoLidasDe('183164343') === n + 1, 'a mensagem não chegou na lista da ana', 15000, antes9b)) {
      await dormir(300);
      const f = await ativo();
      if (f.pessoa === '183164343' && /presenca-linha/.test(f.classe)) ok('chegou mensagem com a lista aberta: o foco segue na MESMA linha');
      else anota(`chegou mensagem e o foco saiu da linha: ${JSON.stringify(f)}`);
    }
  }
  // A conversa: o foco num cartão de pedido, e duas mensagens chegando.
  await ana.page.tap(LINHA);
  if (await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-pedido'), 'a conversa não abriu com o cartão do pedido')) {
    await ana.page.focus('#conversaMsgs .conversa-pedido');
    const cartao = (await ativo()).msg;
    // O topo (`#conversaEstado`) é região viva: mudança nele é anunciada.
    await ana.page.evaluate(() => {
      window.__mutacoesDoTopo = 0;
      new MutationObserver((l) => { window.__mutacoesDoTopo += l.length; })
        .observe(document.getElementById('conversaEstado'), { childList: true, subtree: true, characterData: true });
    });
    for (const texto of ['primeira com o cartão focado', 'segunda com o cartão focado']) {
      await biaManda(texto);
      await esperar(ana, (t) => [...document.querySelectorAll('#conversaMsgs .conversa-bolha')].some((b) => b.textContent.includes(t)), `"${texto}" não chegou`, 15000, texto);
    }
    await dormir(300);
    const f = await ativo();
    if (cartao && f.msg === cartao) ok('chegaram mensagens com o foco num cartão: o foco segue no MESMO cartão');
    else anota(`chegaram mensagens e o foco saiu do cartão: ${JSON.stringify({ antes: cartao, depois: f })}`);
    const topo = await ana.page.evaluate(() => window.__mutacoesDoTopo);
    if (topo === 0) ok('a frase do topo (região viva) não é reescrita a cada mensagem — ela não mudou');
    else anota(`a região viva do topo foi reescrita ${topo} vez(es) com a mesma frase`);
    // CONTROLE (o do relatório): o foco no campo de texto sobrevive, como sempre.
    await ana.page.focus('#conversaInput');
    await biaManda('com o foco no campo');
    await esperar(ana, () => [...document.querySelectorAll('#conversaMsgs .conversa-bolha')].some((b) => b.textContent.includes('com o foco no campo')), 'a mensagem não chegou');
    if ((await ativo()).id === 'conversaInput') ok('controle: o foco no campo segue no campo');
    else anota('controle: o foco saiu do campo de texto');
  }
  // "Ver mensagens anteriores" pelo teclado: carregando, o foco FICA no botão;
  // chegada a última página, o botão some e o foco vai pro ✕ — nunca o <body>.
  anterioresDe.add(ana.id);
  // Reabrir a MESMA conversa recarrega o histórico (sem fechar e abrir no mesmo
  // quadro, que é o gotcha #65 no instrumento).
  await ana.page.evaluate(() => presencaAbrirConversa('183164343'));
  if (await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-anteriores'), 'o "Ver mensagens anteriores" não apareceu')) {
    await ana.page.focus('#conversaMsgs .conversa-anteriores');
    await ana.page.keyboard.press('Enter');
    await dormir(150);
    const carregando = await ativo();
    if (/conversa-anteriores/.test(carregando.classe) && carregando.desabilitado === 'true') ok('carregando, o foco segue no "Ver mensagens anteriores" (indisponível, não `disabled`)');
    else anota(`carregando, o foco saiu do botão: ${JSON.stringify(carregando)}`);
    if (await esperar(ana, () => !document.querySelector('#conversaMsgs .conversa-anteriores'), 'a página anterior não chegou')) {
      const f = await ativo();
      if (f.id === 'conversaClose') ok('chegada a última página, o botão some e o foco vai pro ✕ da conversa — não pro <body>');
      else anota(`chegada a última página, o foco foi pra ${JSON.stringify(f)}`);
    }
  }
  anterioresDe.delete(ana.id);

  // ── 9c. "OLHANDO É LIDA", pelos quatro caminhos de fechar a conversa ────────
  // A mensagem que chega com a conversa na tela é lida — o "lida" só espera
  // 1,2 s pra juntar a rajada. Fechar antes dele sair deixava a mensagem NÃO
  // LIDA no Waze (auditoria de 2026-09-29). O fechamento ADIANTA o mesmo pedido.
  // A conversa fecha NO MESMO instante em que a mensagem aparece (um observador
  // dentro da página), pelo caminho de verdade de cada um — o clique no ✕, a
  // tecla Esc, o clique no fundo e o voltar do aparelho —: fechando pelo lado
  // de cá, um runner lento deixaria o prazo vencer antes, e o "lida" do prazo
  // passaria pelo do fechamento.
  console.log('\n9c. fechar a conversa logo depois de uma mensagem chegar a deixa LIDA');
  const CAMINHOS = [['✕', 'x'], ['Esc', 'esc'], ['fundo (fora da folha)', 'fundo'], ['voltar do aparelho', 'voltar']];
  for (const [nome, caminho] of CAMINHOS) {
    await ana.page.evaluate(() => { if (document.getElementById('conversaModal').classList.contains('hidden')) presencaAbrirConversa('183164343'); });
    if (!await esperar(ana, () => !document.getElementById('conversaModal').classList.contains('hidden')
      && !!(Presenca.historico.get('183164343') || {}).carregada, `a conversa não abriu antes do caminho "${nome}"`)) continue;
    await dormir(1500);   // o que estivesse pendente já saiu
    const antes = apiDe(ana, 'chat', 'lida').length;
    const texto = `vista e fechada pelo ${nome}`;
    const fechou = ana.page.evaluate(({ texto, caminho }) => new Promise((ok) => {
      const corpo = document.getElementById('conversaMsgs');
      const obs = new MutationObserver(() => {
        if (![...corpo.querySelectorAll('.conversa-bolha.dela')].some((b) => b.textContent.includes(texto))) return;
        obs.disconnect();
        const pendente = Presenca.lidaPendente;
        const m = document.getElementById('conversaModal');
        if (caminho === 'x') document.getElementById('conversaClose').click();
        else if (caminho === 'esc') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else if (caminho === 'fundo') m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        else history.back();
        // O voltar fecha no `popstate`, que chega depois; os outros três fecham
        // na hora e CONSOMEM a entrada do voltar com um `history.back()`, que
        // também chega depois. Espera os dois (com teto) antes de devolver: a
        // próxima volta reabre a conversa, e reabrir com o voltar ainda no ar é
        // o gotcha #65 — no WebKit, a volta seguinte saiu do app em 2 de 2
        // rodadas (ninguém reabre uma conversa milissegundos depois de fechá-la).
        const t0 = performance.now();
        const assentou = () => m.classList.contains('hidden') && !CamadaVoltar.consumindo;
        const conferir = () => (assentou() || performance.now() - t0 > 1000
          ? ok({ pendente, fechou: m.classList.contains('hidden') }) : setTimeout(conferir, 20));
        conferir();
      });
      obs.observe(corpo, { childList: true, subtree: true });
    }), { texto, caminho });
    await biaManda(texto);
    const r = await Promise.race([fechou, dormir(15000).then(() => null)]);
    if (!r) { anota(`${nome}: a mensagem não chegou na conversa aberta`); continue; }
    if (r.pendente !== '183164343' || !r.fechou) { anota(`${nome}: controle — a conversa não fechou com o "lida" ainda esperando a rajada: ${JSON.stringify(r)}`); continue; }
    for (let i = 0; i < 30 && apiDe(ana, 'chat', 'lida').length === antes; i++) await dormir(100);
    const lida = mensagens.find((x) => x.texto === texto);
    if (apiDe(ana, 'chat', 'lida').length === antes + 1 && lida && lida.lida) ok(`fechar pelo ${nome} com o "lida" ainda esperando: a mensagem fica LIDA no Waze (um pedido)`);
    else anota(`fechar pelo ${nome} logo depois da mensagem a deixou NÃO LIDA no Waze (lidas: ${apiDe(ana, 'chat', 'lida').length - antes})`);
  }
  // CONTROLE: fechar SEM mensagem nova não pede nada.
  await ana.page.evaluate(() => { if (document.getElementById('conversaModal').classList.contains('hidden')) presencaAbrirConversa('183164343'); });
  await esperar(ana, () => !!(Presenca.historico.get('183164343') || {}).carregada, 'a conversa não reabriu pro controle');
  await dormir(1500);
  const antesDoControle = apiDe(ana, 'chat', 'lida').length;
  await ana.page.evaluate(() => closeModal('conversaModal'));
  await dormir(800);
  if (apiDe(ana, 'chat', 'lida').length === antesDoControle) ok('controle: fechar sem mensagem nova não manda "lida" nenhum');
  else anota('fechar sem nada pendente mandou "lida" à toa');

  // ── 9d. A SESSÃO CAI logo depois de a mensagem chegar ───────────────────────
  // A extensão devolve a sessão (0,6 s) e o perfil volta DEPOIS (1,5 s aqui): no
  // meio, não se sabe de quem é a sessão, e o "lida" não sai no nome de
  // ninguém. Ele ESPERA o perfil e sai com ele — com a conversa aberta (a rajada
  // de 1,2 s vence dentro da espera) e fechada pelo ✕ na espera. O caminho de
  // verdade: `derrubarSessao` → extensão → `showMainScreen` → o perfil →
  // `completarPerfilChegado` → a presença.
  console.log('\n9d. a sessão cai logo depois de uma mensagem chegar: o "lida" espera o perfil');
  atrasoPerfil.set(ana.id, 1500);
  for (const [nome, fechar] of [['com a conversa aberta', false], ['fechando a conversa na espera', true]]) {
    await ana.page.evaluate(() => { if (document.getElementById('conversaModal').classList.contains('hidden')) presencaAbrirConversa('183164343'); });
    if (!await esperar(ana, () => !document.getElementById('conversaModal').classList.contains('hidden')
      && !!(Presenca.historico.get('183164343') || {}).carregada, `a conversa não abriu (${nome})`)) continue;
    await dormir(1500);   // o que estivesse pendente já saiu
    const antes = apiDe(ana, 'chat', 'lida').length;
    const texto = `vista na queda, ${nome}`;
    const caiu = ana.page.evaluate(({ texto, fechar }) => new Promise((ok) => {
      const corpo = document.getElementById('conversaMsgs');
      const obs = new MutationObserver(() => {
        if (![...corpo.querySelectorAll('.conversa-bolha.dela')].some((b) => b.textContent.includes(texto))) return;
        obs.disconnect();
        const pendente = Presenca.lidaPendente;
        derrubarSessao('srv.err.sessionExpired');
        if (fechar) document.getElementById('conversaClose').click();
        ok({ pendente, fechada: document.getElementById('conversaModal').classList.contains('hidden') });
      });
      obs.observe(corpo, { childList: true, subtree: true });
    }), { texto, fechar });
    await biaManda(texto);
    const r = await Promise.race([caiu, dormir(15000).then(() => null)]);
    if (!r) { anota(`${nome}: a mensagem não chegou na conversa aberta`); continue; }
    if (r.pendente !== '183164343' || r.fechada !== fechar) { anota(`${nome}: controle — a sessão não caiu com o "lida" ainda esperando a rajada: ${JSON.stringify(r)}`); continue; }
    if (!await esperar(ana, () => AppState.authenticated && !!AppState.profile, `${nome}: a renovação não trouxe o perfil`)) continue;
    const perfilEm = perfilRespondido.get(ana.id);
    for (let i = 0; i < 30 && apiDe(ana, 'chat', 'lida').length === antes; i++) await dormir(100);
    const novas = apiDe(ana, 'chat', 'lida').slice(antes);
    const lida = mensagens.find((x) => x.texto === texto);
    if (novas.length === 1 && novas[0].em >= perfilEm && lida && lida.lida) ok(`${nome}: o "lida" esperou o perfil e saiu com ele — a mensagem vista fica LIDA (um pedido)`);
    else if (novas.some((x) => x.em < perfilEm)) anota(`${nome}: o "lida" saiu ANTES de se saber de quem é a sessão (${novas.map((x) => x.em - perfilEm).join(', ')} ms do perfil)`);
    else anota(`${nome}: a sessão caiu e voltou, e a mensagem vista ficou NÃO LIDA no Waze (lidas: ${novas.length})`);
  }
  atrasoPerfil.delete(ana.id);

  // ── 9e. ABRIR A CONVERSA NA ESPERA DO PERFIL ──────────────────────────────
  // Na renovação silenciosa (a extensão devolve a sessão; o perfil demora), o
  // `abrir` saía sem saber de quem era a sessão, e as MINHAS mensagens vinham
  // como "dela" (auditoria de 2026-09-30, R5-5-2). Ele espera o perfil e sai
  // com ele. O caminho de verdade: `derrubarSessao` → extensão →
  // `showMainScreen` → o perfil (SEGURADO aqui até as medições da espera
  // terminarem) → `completarPerfilChegado` → a presença.
  console.log('\n9e. abrir a conversa na espera do perfil: o histórico espera, e as minhas seguem minhas');
  let soltarPerfil = () => {};
  perfilSegurado.set(ana.id, new Promise((ok) => { soltarPerfil = ok; }));
  const soltarOPerfil = () => { perfilSegurado.delete(ana.id); soltarPerfil(); };
  await ana.page.evaluate(() => { if (!document.getElementById('conversaModal').classList.contains('hidden')) closeModal('conversaModal'); });
  await dormir(400);
  await ana.page.evaluate(() => { Presenca.historico.delete('183164343'); derrubarSessao('srv.err.sessionExpired'); });
  if (await esperar(ana, () => AppState.authenticated && !AppState.profile, 'a renovação não chegou à janela da espera do perfil')) {
    const abrirsAntes = apiDe(ana, 'chat', 'abrir').length;
    await ana.page.evaluate(() => presencaAbrirConversa('183164343'));
    await dormir(400);
    const naEspera = await ana.page.evaluate(() => ({ perfil: !!AppState.profile,
      carregando: document.getElementById('conversaMsgs').textContent.includes(t('presenca.conversa.carregando')) }));
    // CONTROLE: o toque tem que ter caído DENTRO da janela (sem o perfil).
    if (naEspera.perfil) anota('controle: o perfil já tinha voltado no toque — a medição não pegou a espera');
    else if (apiDe(ana, 'chat', 'abrir').length === abrirsAntes && naEspera.carregando) ok('na espera do perfil, abrir a conversa não manda o `abrir` — ela fica "Carregando"');
    else anota(`na espera do perfil, o \`abrir\` saiu sem saber de quem é a sessão: ${JSON.stringify({ abrirs: apiDe(ana, 'chat', 'abrir').length - abrirsAntes, ...naEspera })}`);
    // O "Enviar" na espera não fica calado (auditoria de 2026-10-01, R6-5-5):
    // a mensagem entra na conversa como "Não enviada.", com o "Tentar de novo",
    // e nada sai — sairia pela sessão nova, que pode ser de outra conta. Antes
    // o toque não fazia nada nem dizia nada, com o texto parado no campo.
    const enviosNaEspera = apiDe(ana, 'chat', 'enviar').length;
    await ana.page.fill('#conversaInput', 'pergunta feita na espera');
    await ana.page.tap('#conversaEnviar');
    const naEsperaEnvio = await ana.page.evaluate(() => ({ perfil: !!AppState.profile, campo: document.getElementById('conversaInput').value,
      falhou: ((document.querySelector('#conversaMsgs .conversa-falhou') || {}).textContent || '').trim(),
      bolha: [...document.querySelectorAll('#conversaMsgs .conversa-bolha.minha')].some((b) => b.textContent.includes('pergunta feita na espera')) }));
    // CONTROLE: o toque tem que ter caído DENTRO da janela (sem o perfil).
    if (naEsperaEnvio.perfil) anota('controle: o perfil já tinha voltado no "Enviar" — a medição não pegou a espera');
    else if (naEsperaEnvio.bolha && /^Não enviada\. Tentar de novo$/.test(naEsperaEnvio.falhou) && !naEsperaEnvio.campo
      && apiDe(ana, 'chat', 'enviar').length === enviosNaEspera) {
      ok('na espera do perfil, o "Enviar" não fica calado: a mensagem entra como "Não enviada.", com o "Tentar de novo" — e nada sai');
    } else anota(`na espera do perfil, o "Enviar" ficou calado (ou saiu): ${JSON.stringify({ ...naEsperaEnvio, envios: apiDe(ana, 'chat', 'enviar').length - enviosNaEspera })}`);
    // O SEGUNDO "Enviar" na espera diz a falha OUTRA VEZ, com a região viva
    // LIMPA antes, numa tarefa à parte (auditoria da rodada 12, R12-5-02): ela
    // era reescrita com a MESMA frase no mesmo tique — e região viva reescrita
    // igual pode não ser lida de novo. O observador anota cada mudança, com a
    // hora: o mesmo tique vira UM registro só, com o texto do fim dele.
    const regiaoAntes = await ana.page.evaluate(() => {
      window.__regiao9e = [];
      const el = document.getElementById('conversaAnuncio');
      new MutationObserver(() => window.__regiao9e.push([el.textContent, performance.now()])).observe(el, { childList: true, characterData: true, subtree: true });
      return el.textContent;
    });
    await ana.page.fill('#conversaInput', 'segunda pergunta na espera');
    await ana.page.tap('#conversaEnviar');
    // O fim: a frase de volta na região — e nada mudando depois dela.
    for (let i = 0; i < 30 && !await ana.page.evaluate(() => window.__regiao9e.some(([t]) => !!t)); i++) await dormir(100);
    await dormir(300);
    const segundo = await ana.page.evaluate(() => {
      const p = document.querySelector('#conversaMsgs .conversa-falhou');
      const r = window.__regiao9e;
      return { perfil: !!AppState.profile, mudancas: r.map(([t]) => t), intervalo: r.length === 2 ? Math.round(r[1][1] - r[0][1]) : null,
        falhadas: document.querySelectorAll('#conversaMsgs .presenca-recibo.falhou').length,
        tela: p && p.firstChild ? p.firstChild.textContent.trim() : '', regiao: document.getElementById('conversaAnuncio').textContent };
    });
    // CONTROLE: a região JÁ dizia a frase (é a mesma falha outra vez) e o perfil
    // seguia fora — senão a medição não seria a do defeito.
    if (segundo.perfil || regiaoAntes !== 'Não enviada.') anota(`controle: o segundo "Enviar" não caiu na espera com a frase na região: ${JSON.stringify({ perfil: segundo.perfil, regiaoAntes })}`);
    else if (JSON.stringify(segundo.mudancas) === JSON.stringify(['', 'Não enviada.']) && segundo.intervalo >= 50
      && segundo.falhadas === 2 && segundo.regiao === segundo.tela) {
      ok(`na espera do perfil, o segundo "Enviar" limpa a região viva e diz a falha de novo ${segundo.intervalo} ms depois — a mesma frase da tela`);
    } else anota(`o segundo "Enviar" na espera não disse a falha de novo depois de limpar a região: ${JSON.stringify(segundo)}`);
    soltarOPerfil();
    if (await esperar(ana, () => !!AppState.profile, 'o perfil não voltou')) {
      const perfilEm = perfilRespondido.get(ana.id);
      if (await esperar(ana, () => (Presenca.historico.get('183164343') || {}).carregada === true, 'o histórico não chegou depois do perfil')) {
        await dormir(200);
        const abriu = apiDe(ana, 'chat', 'abrir').slice(abrirsAntes);
        const lados = await ana.page.evaluate(() => {
          const lado = (t) => {
            const b = [...document.querySelectorAll('#conversaMsgs .conversa-bolha')].find((x) => x.textContent.includes(t));
            return b ? (b.classList.contains('minha') ? 'minha' : 'dela') : null;
          };
          return { minha: lado('e o Instituto do Rim?'), dela: lado('chegou depois da renovação?') };
        });
        if (abriu.length === 1 && abriu[0].em >= perfilEm && lados.minha === 'minha' && lados.dela === 'dela') ok('com o perfil, o histórico sai (um pedido) e as minhas mensagens ficam do meu lado');
        else anota(`o histórico da espera saiu errado: ${JSON.stringify({ abrirs: abriu.length, antesDoPerfil: abriu.filter((x) => x.em < perfilEm).length, lados })}`);
        // Com o perfil de volta, o "Tentar de novo" manda as mensagens da espera
        // — cada uma com o MESMO id que ganhou ao entrar na conversa.
        const naEspera = await ana.page.evaluate(() => (Presenca.historico.get('183164343') || { msgs: [] }).msgs
          .filter((m) => m.meu && m.estado === 'falhou' && /na espera$/.test(m.texto)).map((m) => [m.id, m.texto]));
        if (naEspera.length) await ana.page.tap('#conversaMsgs .conversa-reenviar');
        for (let i = 0; i < 50 && apiDe(ana, 'chat', 'enviar').length < enviosNaEspera + naEspera.length; i++) await dormir(100);
        const saiuDaEspera = apiDe(ana, 'chat', 'enviar').slice(enviosNaEspera).map((x) => [x.c.id, x.c.texto]);
        if (naEspera.length === 2 && JSON.stringify([...saiuDaEspera].sort()) === JSON.stringify([...naEspera].sort())) {
          ok('com o perfil de volta, o "Tentar de novo" manda as mensagens da espera (os mesmos ids)');
        } else anota(`as mensagens da espera não saíram pelo "Tentar de novo": ${JSON.stringify({ naEspera, saiu: saiuDaEspera })}`);
      }
    }
  }
  soltarOPerfil();

  // ── 10. SAIR apaga o chat do aparelho e fecha o tempo real ──────────────────
  console.log('\n10. sair');
  // Com a conversa aberta e o pedido que ela mandou aberto na folha: o "Sair"
  // leva o chat do aparelho, fecha o tempo real — e nada de terceiro fica no
  // DOM, que o relatório do modo dev leva inteiro (auditoria de 2026-09-29, P1).
  await ana.page.evaluate(() => { if (document.getElementById('conversaModal').classList.contains('hidden')) presencaAbrirConversa('183164343'); });
  await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-pedido'), 'a conversa não reabriu antes do "Sair"');
  await ana.page.tap('#conversaMsgs .conversa-pedido');
  const folhaAberta = await esperar(ana, () => !document.getElementById('pedidoModal').classList.contains('hidden') && document.getElementById('pedidoNome').textContent.includes('Padaria'),
    'controle: a folha do pedido não abriu antes do "Sair"');
  const tinha = await ana.page.evaluate(() => !!localStorage.getItem('waze_places_chat'));
  await ana.page.evaluate(() => handleLogout());
  const fim = await ana.page.evaluate(() => ({ chave: localStorage.getItem('waze_places_chat'), fluxo: !!Presenca.fluxo, online: Presenca.online.length }));
  if (tinha && fim.chave === null && !fim.fluxo) ok('o "Sair" apaga o chat do aparelho e fecha o tempo real');
  else anota(`o "Sair" deixou coisa pra trás: ${JSON.stringify({ tinha, ...fim })}`);
  const sobras = await ana.page.evaluate(() => {
    const txt = (id) => document.getElementById(id).textContent.trim();
    const attr = (id, a) => document.getElementById(id).getAttribute(a);
    const html = document.documentElement.outerHTML;
    return Object.fromEntries(Object.entries({
      titulo: txt('conversaTitle'), estado: txt('conversaEstado'), tirinha: txt('conversaAnexoNome'), tirinhaFoto: attr('conversaAnexoFoto', 'src'),
      pedido: txt('pedidoNome'), de: txt('pedidoDe'), endereco: txt('pedidoEnd'), pedidoFoto: attr('pedidoFotoImg', 'src'), link: attr('pedidoWme', 'href'),
      nomeNoDom: html.includes('cafanha') ? 'cafanha' : '',
    }).filter(([, v]) => v));
  });
  if (folhaAberta && !Object.keys(sobras).length) ok('depois do "Sair", nada da conversa nem do pedido fica no DOM (quem, onde, a folha, a tirinha)');
  else anota(`o "Sair" deixou no DOM: ${JSON.stringify(sobras)}`);

  // ── 11. A JANELA DO DESFAZER não fica por cima da folha da presença ────────
  // A folha (a lista, a conversa) mora no RODAPÉ, embaixo do banner do
  // Desfazer: aberta na janela, o banner ficava por cima da linha da pessoa e
  // do "Enviar", e o toque no "Enviar" caía no "Desfazer" — a decisão do card
  // era desfeita atrás da folha e a mensagem não saía (auditoria de
  // 2026-10-01, R6-5-4, medido no 393 e no Fold). Abrir a folha DESPACHA a
  // janela; e a decisão que chega com a folha JÁ aberta (o ✕ e a pílula antes
  // de a animação do card terminar, 350 ms) sai sem janela. Na bia: a fila dela
  // tem dois pedidos e nenhuma outra seção a usa — e aqui no fim, porque a
  // mensagem que ela manda iria pra conversa da ana.
  console.log('\n11. a janela do Desfazer não fica por cima da folha da presença');
  const LINHA_ANA = '#presencaLista .presenca-linha[data-pessoa="12444348"]';
  const X_DA_FRENTE = '#cardStack .place-card:not(.card-fundo) .card-btn-reject';
  // Sem nada aberto, e com a entrada do voltar já consumida (fechar e abrir no
  // mesmo quadro é o gotcha #65).
  const semCamadas = async () => {
    await bia.page.evaluate(() => { for (const id of ['conversaModal', 'pedidoModal', 'presencaModal']) closeModal(id); });
    await esperar(bia, () => !CamadaVoltar.consumindo, 'o voltar da bia não assentou');
  };
  await semCamadas();
  // A lista da bia com a ana (a seção 9 tirou a bia do app, não a ana).
  await bia.page.evaluate(() => { Presenca.tentadaEm = 0; Presenca.atualizadaEm = 0; return presencaAtualizar(); });
  await esperar(bia, () => !document.getElementById('presencaPill').classList.contains('hidden'), 'a pílula da bia não apareceu');
  // CONTROLE do instrumento: o banner por cima da conversa ABERTA tira o dedo do
  // "Enviar" — a medição enxerga a cobertura.
  await bia.page.evaluate(() => presencaAbrirConversa('12444348'));
  if (await esperar(bia, () => !document.getElementById('conversaModal').classList.contains('hidden'), 'a conversa da bia não abriu (controle)')) {
    await bia.page.evaluate(() => showUndoBanner('controle do instrumento'));
    const coberto = await alcancavel(bia, '#conversaEnviar');
    await bia.page.evaluate(() => removeUndoBanner());
    if (coberto.visivel && !coberto.noCentro) ok('controle: com o banner do Desfazer na tela, o "Enviar" da conversa não recebe o dedo — a medição enxerga a cobertura');
    else anota(`controle: o banner por cima da conversa não tirou o dedo do "Enviar" (${JSON.stringify(coberto)}) — a medição não distinguiria nada`);
  }
  await semCamadas();
  // O estado NA HORA (a janela, o banner e quem recebe o dedo no centro da linha
  // da pessoa), medido logo depois do toque. Medir depois de esperar o pedido
  // sair mediria a janela VENCENDO sozinha (3 s), que também tira o banner e
  // manda a decisão: a primeira versão desta seção passou com o conserto
  // desfeito, exatamente assim (gotcha #28).
  const naHora = () => bia.page.evaluate((s) => {
    const linha = document.querySelector(s);
    const r = linha && linha.getBoundingClientRect();
    const q = r && r.width && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { pendente: !!AppState.pendingAction, banner: !!document.querySelector('#undoContainer .undo-banner'),
      linhaRecebe: !!q && (q === linha || linha.contains(q)), rejeitados: AppState.stats.rejected };
  }, LINHA_ANA);
  // O dedo cai no CENTRO do alvo, seja quem for que estiver por cima — como um
  // dedo de verdade. O `tap` do Playwright espera o alvo ficar livre, e com a
  // janela do Desfazer por cima ele só tocaria depois de ela vencer.
  const tocarNoCentro = async (sel) => {
    const q = await bia.page.evaluate((s) => {
      const el = document.querySelector(s);
      const r = el && el.getBoundingClientRect();
      return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, sel);
    if (q) await bia.page.touchscreen.tap(q.x, q.y);
    return !!q;
  };
  // O pedido de decisão saiu DEPRESSA (o despacho), e não quando a janela venceu.
  const saiuDepressa = async (antes, desde) => {
    for (let i = 0; i < 30 && apiDe(bia, 'validar-place').length === antes; i++) await dormir(100);
    const ida = apiDe(bia, 'validar-place')[antes];
    return { saiu: apiDe(bia, 'validar-place').length - antes, emMs: ida ? ida.em - desde : null };
  };
  // a) A janela ABERTA, e depois a pílula. O ✕ tem que receber o dedo antes do
  // toque: um aviso do rodapé por cima dele mediria o aviso (gotcha #26).
  await esperar(bia, (s) => {
    const el = document.querySelector(s);
    const r = el && el.getBoundingClientRect();
    const q = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!q && (q === el || el.contains(q));
  }, 'o ✕ do card da bia não recebe o dedo', 6000, X_DA_FRENTE);
  const validarAntes = apiDe(bia, 'validar-place').length;
  await bia.page.tap(X_DA_FRENTE);
  if (await esperar(bia, () => !!AppState.pendingAction && !!document.querySelector('#undoContainer .undo-banner'),
    'controle: o ✕ da bia não abriu a janela do Desfazer', 2500)) {
    const tToque = Date.now();
    await bia.page.tap('#presencaPill');
    if (await esperar(bia, (s) => !!document.querySelector(s), 'a lista da bia não abriu', 1500, LINHA_ANA)) {
      const lista = await naHora();
      // E segue DENTRO da janela, com o dedo de verdade (onde ele cair, sem a
      // espera do Playwright por um alvo livre): o toque na linha da pessoa e o
      // "Enviar" — com o defeito, os dois caíam no banner, e o do "Enviar" no
      // "Desfazer".
      if (await tocarNoCentro(LINHA_ANA)
        && await esperar(bia, () => !document.getElementById('conversaModal').classList.contains('hidden'),
          'o toque na linha da pessoa não abriu a conversa (caiu em outro lugar)', 1500)) {
        const enviar = await alcancavel(bia, '#conversaEnviar');
        const enviosAntes = apiDe(bia, 'chat', 'enviar').length;
        await bia.page.evaluate(() => { document.getElementById('conversaInput').value = 'mandada logo depois de um ✕'; });
        await tocarNoCentro('#conversaEnviar');
        for (let i = 0; i < 30 && apiDe(bia, 'chat', 'enviar').length === enviosAntes; i++) await dormir(100);
        const fim11 = await bia.page.evaluate(() => ({ rejeitados: AppState.stats.rejected, campo: document.getElementById('conversaInput').value }));
        if (enviar.noCentro && apiDe(bia, 'chat', 'enviar').length === enviosAntes + 1 && fim11.rejeitados === lista.rejeitados && !fim11.campo) {
          ok('na conversa, o toque no "Enviar" MANDA a mensagem — e a decisão do card segue decidida');
        } else anota(`o toque no "Enviar" não mandou (ou desfez a decisão): ${JSON.stringify({ enviar, envios: apiDe(bia, 'chat', 'enviar').length - enviosAntes, ...fim11, antes: lista.rejeitados })}`);
      }
      const ida = await saiuDepressa(validarAntes, tToque);
      if (!lista.pendente && !lista.banner && lista.linhaRecebe && ida.saiu === 1 && ida.emMs < 1500) {
        ok(`abrir a lista na janela do Desfazer a DESPACHA: a decisão sai na hora (${ida.emMs} ms), o banner sai, e a linha da pessoa recebe o dedo`);
      } else anota(`a lista abriu com a janela do Desfazer por cima: ${JSON.stringify({ ...lista, ...ida })}`);
    }
  }
  // b) A corrida: o ✕ e, antes de a animação do card terminar, a pílula. A
  // decisão chega com a lista JÁ aberta — e é medida no instante em que ela
  // chega (o placar sobe no mesmo passo em que a janela abriria).
  await semCamadas();
  if (!await bia.page.evaluate(() => !!cardDaFrente())) anota('controle: a bia não tinha o segundo pedido na tela pra corrida');
  else {
    const validarB = apiDe(bia, 'validar-place').length;
    const noToque = await bia.page.evaluate(() => new Promise((ok) => {
      cardDaFrente().querySelector('.card-btn-reject').click();
      setTimeout(() => {
        const pendente = !!AppState.pendingAction;
        const rejeitados = AppState.stats.rejected;
        document.getElementById('presencaPill').click();
        ok({ pendente, rejeitados, lista: !document.getElementById('presencaModal').classList.contains('hidden') });
      }, 60);
    }));
    // CONTROLE: no toque da pílula a decisão ainda não tinha chegado, e a lista abriu.
    if (noToque.pendente || !noToque.lista) anota(`controle: a corrida não aconteceu (${JSON.stringify(noToque)})`);
    else if (await esperar(bia, (n) => AppState.stats.rejected > n, 'a decisão da corrida não chegou', 3000, noToque.rejeitados)) {
      const tDecisao = Date.now();
      const corrida = await naHora();
      const ida = await saiuDepressa(validarB, tDecisao);
      if (!corrida.pendente && !corrida.banner && corrida.linhaRecebe && ida.saiu === 1 && ida.emMs < 1500) {
        ok('a decisão que chega com a lista JÁ aberta sai sem janela — nada por cima da linha da pessoa');
      } else anota(`a decisão chegou com a lista aberta e abriu a janela por baixo dela: ${JSON.stringify({ ...corrida, ...ida })}`);
    }
  }

  // ── 12. O TEMPO REAL PARADO religa sem o `online` e sem pedido à API ──────
  // Quem fica OLHANDO a conversa esperando a resposta não faz pedido nenhum à
  // nossa API (não há polling, de propósito), e o `online` pode não vir (o
  // iPhone): o tempo real parado pela falta de rede ficava parado, e a resposta
  // não aparecia (auditoria da rodada 9, R9-5-03; MEDIDO no Chromium e no
  // WebKit: 20 s olhando, 0 conexões ao Google). DECISÃO: religar SEM pedido à
  // API — no recuo do próprio fluxo (que segue de pé, tentando o Google mesmo
  // sem rede), no foco do app e num gesto na conversa. A rede some e volta DE
  // MENTIRA (o `onLine` e o Google), sem o `setOffline`: ele dispararia o `online`.
  console.log('\n12. o tempo real parado religa sem o `online` e sem pedido à API');
  // A rede cai com a conversa aberta, e volta (sem o `online`) com a resposta da
  // ana esperando no Google. `degrau: 'ultimo'`: o recuo já no degrau de 1 min.
  const pararEVoltar = async (texto, { degrau = null } = {}) => {
    // O que a bia recebeu e ainda não confirmou (a confirmação vai DE CARONA no
    // próximo pedido à API) é entregue de novo a cada conexão. O Google de
    // verdade segura a conexão aberta depois de entregar; o daqui a ENCERRA (o
    // `route.fulfill` não faz fluxo), e com um item pendente o tempo real abria e
    // fechava a cada segundo — a espera abaixo nunca o pegava aberto (MEDIDO na
    // junção do lote 13, no WebKit: 59 aberturas e 60 entregas em ~1 min, com a
    // pré-condição reprovando). Uma carona confirma a fila antes, como o próximo
    // gesto dela faria; e a espera abaixo pega o tempo real PRESO, como o do Google.
    // A carona sai quando o app JÁ guardou o que está pendente: o eco da mensagem
    // que a bia mandou na seção 11 chega pelo tempo real DEPOIS da última carona
    // (MEDIDO com uma sonda: o app o guardava pra confirmar, certo, e nenhum
    // pedido seguinte o levava).
    const ate = Date.now() + 10_000;
    while (fila(bia.id).itens.length && Date.now() < ate) {
      const pendentes = fila(bia.id).itens.map((x) => x.inbox);
      const guardou = await bia.page.evaluate((pp) => { const l = chatAConfirmar(); return pp.every((x) => l.includes(x)); }, pendentes);
      if (guardou) await bia.page.evaluate(() => { Presenca.tentadaEm = 0; Presenca.atualizadaEm = 0; return presencaAtualizar(); });
      await dormir(200);
    }
    if (fila(bia.id).itens.length) { anota(`a carona da bia não confirmou a fila do tempo real (${fila(bia.id).itens.length} pendentes)`); return null; }
    // E a RESPOSTA da carona tem que ter chegado: o servidor de mentira tira o
    // item da fila ao receber o pedido, e a resposta que chegasse com a rede já
    // caída seria prova de rede pro app — que religa o tempo real (certo), e o
    // controle de baixo leria "religou sem o toque".
    //
    // E nenhum "lida" pendente ou no ar: o da mensagem da parte (a) sai pela
    // rajada (1,2 s), e no WebKit caía DENTRO da janela do controle da (b) — a
    // resposta dele é prova de rede, e o app religa o tempo real parado (certo,
    // é o desenho). MEDIDO com uma sonda: `chat/lida` 166 ms depois da volta da
    // rede e o fluxo de pé 10 ms depois. O controle mede "sem gesto, sem
    // `online` e sem resposta nossa, nada religa": a premissa tem que valer.
    for (const fim = Date.now() + 10_000; Date.now() < fim;) {
      if (await bia.page.evaluate(() => !Presenca.pedindo && !Presenca.lidaPendente && Presenca.lidaNoAr.size === 0)) break;
      await dormir(100);
    }
    if (!await esperar(bia, () => !!Presenca.fluxo && !Presenca.fluxoParado, 'o tempo real da bia não estava aberto antes de a rede cair')) return null;
    semRede.add(bia.id);
    const onLine = await bia.page.evaluate((d) => {
      window.__semRede = true;
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !window.__semRede });
      if (d === 'ultimo') Presenca.fluxoTentativa = PRESENCA_FLUXO_ESPERAS_MS.length - 1;
      if (Presenca.fluxo) Presenca.fluxo.ctl.abort();    // a conexão cai com a rede
      return navigator.onLine;
    }, degrau);
    if (onLine !== false) { anota('controle: o `onLine` de mentira não pegou — a seção mediria outra coisa'); return null; }
    if (!await esperar(bia, () => Presenca.fluxoParado === true && !Presenca.fluxo, 'o tempo real da bia não PAROU sem rede')) return null;
    semRede.delete(bia.id);
    await bia.page.evaluate(() => { window.__semRede = false; });
    const m = { id: randomUUID(), ts: Date.now(), de: '12444348', para: '183164343', texto, ctx: { app: 'wazeplaces' } };
    mensagens.push(m);
    entregar(bia.id, bytesMsg(m));
    return { apiAntes: reg(bia.id).api.length, googleAntes: reg(bia.id).fluxo.length, desde: Date.now() };
  };
  const naTela = (texto) => bia.page.evaluate((t) => document.getElementById('conversaMsgs').textContent.includes(t), texto);
  // O "lida" da mensagem que chega na tela é o de sempre (a rajada); o que não
  // pode haver é pedido pra RELIGAR (o token, a lista).
  const pedidosDoReligar = (r) => reg(bia.id).api.slice(r.apiAntes).filter((x) => !(x.rota === 'chat' && x.c.acao === 'lida'))
    .map((x) => x.rota + (x.c.acao ? '/' + x.c.acao : ''));
  await semCamadas();
  await bia.page.evaluate(() => presencaAbrirConversa('12444348'));
  if (await esperar(bia, () => !document.getElementById('conversaModal').classList.contains('hidden')
      && (Presenca.historico.get('12444348') || {}).carregada, 'a conversa da bia não abriu')) {
    // a) Ninguém toca em nada: o recuo do próprio fluxo (no 1º degrau, 2 s) religa.
    const a = await pararEVoltar('resposta com a bia só olhando');
    if (a) {
      const chegou = await esperar(bia, () => document.getElementById('conversaMsgs').textContent.includes('resposta com a bia só olhando'),
        'com a pessoa só olhando, o recuo não religou o tempo real parado — a resposta não apareceu', 10_000);
      const pedidos = pedidosDoReligar(a);
      if (chegou && !pedidos.length) ok(`com a pessoa só olhando, o recuo religa o tempo real parado: a resposta aparece em ${((Date.now() - a.desde) / 1000).toFixed(1)} s, sem pedido nenhum à API`);
      else if (chegou) anota(`religar pelo recuo pediu à API: ${JSON.stringify(pedidos)}`);
    }
    // b) O recuo já no degrau de 1 min (como depois de um minuto sem rede): um
    // toque na conversa religa na hora.
    const b = await pararEVoltar('resposta depois de um minuto sem rede', { degrau: 'ultimo' });
    if (b) {
      // CONTROLE: sem o toque (e sem o `online`), nada religa em 3 s.
      await dormir(3000);
      const parada = { parado: await bia.page.evaluate(() => Presenca.fluxoParado), naTela: await naTela('resposta depois de um minuto sem rede'), google: reg(bia.id).fluxo.length - b.googleAntes };
      if (parada.parado && !parada.naTela && parada.google === 0) ok('controle: com o recuo no degrau de 1 min, sem toque nem `online`, a conversa segue parada');
      else anota(`controle: a conversa parada religou sem o toque: ${JSON.stringify(parada)}`);
      // O dedo no campo da conversa (a pessoa vai responder).
      const campo = await bia.page.evaluate(() => {
        const r = document.getElementById('conversaInput').getBoundingClientRect();
        return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      });
      if (campo) await bia.page.touchscreen.tap(campo.x, campo.y);
      const chegou = campo && await esperar(bia, () => document.getElementById('conversaMsgs').textContent.includes('resposta depois de um minuto sem rede'),
        'o toque na conversa não religou o tempo real parado — a resposta não apareceu', 8000);
      const pedidos = pedidosDoReligar(b);
      if (chegou && !pedidos.length) ok('um toque na conversa religa o tempo real parado na hora: a resposta aparece, sem pedido nenhum à API');
      else if (chegou) anota(`religar pelo toque pediu à API: ${JSON.stringify(pedidos)}`);
    }
    await bia.page.evaluate(() => { delete navigator.onLine; }).catch(() => {});
  }

  // ── 13. O ENVIO SEM RESPOSTA QUE O WAZE GUARDOU ──────────────────────────
  // A resposta do envio se perde na VOLTA (o sinal cai), mas o Waze guardou a
  // mensagem: o ECO dela chega depois pelo tempo real, e a tela troca o "Não
  // enviada, sem sinal." pelo "Enviada". A região viva da conversa seguia
  // dizendo a falha a quem percorria a conversa com leitor de tela (auditoria da
  // rodada 12, R12-5-03). Aqui no fim, na bia: a mensagem vai pra ana, que já
  // saiu (seção 10), e nenhuma seção depois desta a lê.
  console.log('\n13. o envio sem resposta que o Waze guardou: o eco tira a falha da tela e do leitor de tela');
  await bia.page.evaluate(() => { if (document.getElementById('conversaModal').classList.contains('hidden')) presencaAbrirConversa('12444348'); });
  if (await esperar(bia, () => !document.getElementById('conversaModal').classList.contains('hidden')
      && (Presenca.historico.get('12444348') || {}).carregada && !!Presenca.fluxo && !Presenca.fluxoParado,
    'a conversa da bia, com o tempo real de pé, não estava aberta')) {
    const texto13 = 'chegou aí, mesmo sem resposta?';
    falharEnvio.set(bia.id, 'guarda');
    await bia.page.fill('#conversaInput', texto13);
    await bia.page.tap('#conversaEnviar');
    const falhou = await esperar(bia, () => /sem sinal/.test(((document.querySelector('#conversaMsgs .conversa-falhou') || {}).textContent) || ''),
      'o envio sem resposta não mostrou a falha');
    falharEnvio.delete(bia.id);
    const lerFalha = () => bia.page.evaluate((t) => {
      const p = document.querySelector('#conversaMsgs .conversa-falhou');
      const b = [...document.querySelectorAll('#conversaMsgs .conversa-bolha.minha')].find((x) => x.textContent.includes(t));
      const r = b && b.querySelector('.presenca-recibo');
      return { tela: p && p.firstChild ? p.firstChild.textContent.trim() : '', recibo: r ? r.getAttribute('aria-label') : null,
        regiao: document.getElementById('conversaAnuncio').textContent };
    }, texto13);
    const g = ecoSegurado.get(bia.id);
    if (falhou && g) {
      // CONTROLE: antes do eco, a região diz a falha — a mesma frase da tela.
      const antes = await lerFalha();
      if (antes.regiao === 'Não enviada, sem sinal.' && antes.regiao === antes.tela) ok(`controle: sem a resposta, a tela e a região viva dizem "${antes.regiao}"`);
      else anota(`controle: a falha não estava na tela e na região antes do eco: ${JSON.stringify(antes)}`);
      ecoSegurado.delete(bia.id);
      entregar(bia.id, bytesMsg(g));   // o eco do que o Waze guardou
      if (await esperar(bia, () => !document.querySelector('#conversaMsgs .conversa-falhou'), 'o eco não tirou a falha da tela')) {
        await dormir(200);
        const depois = await lerFalha();
        if (depois.recibo === 'Enviada' && depois.regiao === '') ok('o eco do que o Waze guardou: a tela diz "Enviada", e a região viva não diz mais "Não enviada"');
        else anota(`o eco tirou a falha da tela, e não do leitor de tela: ${JSON.stringify(depois)}`);
      }
    } else if (falhou) anota('controle: o Waze de mentira não guardou a mensagem da bia');
  }
} finally {
  await browser.close();
  srv.kill('SIGKILL');
}

if (resumoDosPulos(MOTOR)) console.log(resumoDosPulos(MOTOR));
console.log(falhas.length ? `\n✗ ${falhas.length} falha(s)` : '\n✓ presença ok');
process.exit(falhas.length ? 1 : 0);
