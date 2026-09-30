// A presença e a conversa depois da auditoria de 2026-09-29 (rodada 4, R4-1):
// o que fica no DOM depois de fechar e de sair, a renovação silenciosa da
// sessão, o foco no redesenho, as contas da lista e do relógio, e o que a
// conversa e o diagnóstico DIZEM.
//
// Mesmo instrumento do `presenca-auditoria.test.mjs`: o js/presenca.js roda
// INTEIRO no navegador de mentira do `_presenca-cliente.mjs`, e cada teste passa
// pelo caminho de verdade (a resposta que chega, o quadro do tempo real, o toque).
// Os rótulos P1…P12 são os do relatório DESTA rodada — não os da de 2026-09-26,
// que moram no outro arquivo. O que só se mede num navegador de verdade (o foco,
// a renovação pela extensão com a tela inteira) está no `tools/smoke-presenca.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const EU = '12444348';
const CAF = '183164343';
const APP = { app: 'wazeplaces' };
const tick = () => new Promise((r) => setImmediate(r));
const uuid = (n) => `a0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const inbox = (bytes, n = 1) => ({ inboxMessage: { messageId: uuid(900 + n), messageType: 'X', message: b64(bytes) } });
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
const pessoa = (id, nome, lat, lon, rank = 2) => ({ id, nome, rank, lat, lon });
const conversa = (id, nome, atividade, naoLidas = 0, ultima = null) => ({ id, nome, naoLidas, atividade, ultima });
const daCaf = (n, ts, extra = {}) => ({ id: uuid(n), ts, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU },
  classe: 'texto', texto: 'oi?', contexto: APP, ...extra });

// Conta as ESCRITAS no `innerHTML` de um elemento do navegador de mentira.
function contarEscritas(el) {
  let valor = el.innerHTML, n = 0;
  Object.defineProperty(el, 'innerHTML', { configurable: true, get: () => valor, set: (v) => { n += 1; valor = v; } });
  return () => n;
}

// ── P3: o que não mudou não é redesenhado ───────────────────────────────────

test('P3 a lista que chega IGUAL não é redesenhada — o `innerHTML` mataria o foco da linha', () => {
  const c = novoCliente();
  c.P.presencaAplicarLista({ online: [pessoa(CAF, 'cafanha', -23.5, -46.6)], conversas: [] }, 1, 30);
  c.$('presencaModal').classList.remove('hidden');
  const escritas = contarEscritas(c.$('presencaLista'));
  c.P.presencaRenderLista();
  // A lista pedida ao abrir a folha volta com o mesmo conteúdo.
  c.P.presencaAplicarLista({ online: [pessoa(CAF, 'cafanha', -23.5, -46.6)], conversas: [] }, 2, 30);
  c.P.presencaRenderLista();
  assert.equal(escritas(), 1, 'a lista igual foi redesenhada (e o foco da linha caía no <body>)');
  // CONTROLE: mudou (chegou mensagem da pessoa) → redesenha, uma vez.
  c.P.Presenca.vivas.set(CAF, { n: 1, ultimaTs: 5, servs: [5] });
  c.P.presencaRenderLista();
  assert.equal(escritas(), 2, 'a lista que MUDOU não foi redesenhada');
  assert.match(c.$('presencaLista').innerHTML, /presenca-badge/);
});

test('P3 na conversa aberta, as mensagens que chegam redesenham o corpo — e NÃO a região viva do topo, que não mudou', async () => {
  const c = novoCliente();
  c.P.Presenca.online = [pessoa(CAF, 'cafanha', -23.5, -46.6, 3)];
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true, maisAntigas: false });
  const estado = contarEscritas(c.$('conversaEstado'));
  const corpo = contarEscritas(c.$('conversaMsgs'));
  c.P.presencaRenderConversa();
  for (let i = 1; i <= 3; i++) {
    c.P.presencaQuadro(fluxoDe(c), inbox(await bytesDeMensagem({ id: uuid(i), de: CAF, para: EU, texto: 'msg ' + i, ctx: APP, ts: 1790200000000 + i }), i));
  }
  assert.equal(corpo(), 4, 'CONTROLE: cada mensagem que chega tem que aparecer');
  assert.equal(estado(), 1, 'a região viva do topo (role=status) foi reescrita com a MESMA frase a cada mensagem');
  // CONTROLE: a frase muda (a pessoa saiu do app) → reescreve.
  c.P.Presenca.online = [];
  c.P.presencaRenderConversa();
  assert.equal(estado(), 2, 'a frase que MUDOU não foi reescrita');
  assert.match(c.$('conversaEstado').innerHTML, /presenca\.conversa\.fora/);
});

test('P3 o cartão do pedido diz QUAL mensagem é (`data-id`): é por ele que o foco volta ao mesmo cartão', async () => {
  const card = JSON.stringify({ venueID: '1.2.3', name: 'Padaria', categories: ['BAKERY'], updateTypeKey: 'IMAGE', region: 'row' });
  const c = novoCliente({ api: { chat: () => ({ success: true, mensagens: [daCaf(7, 1790200000000, { contexto: { ...APP, card } })], maisAntigas: false, lida: true }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.match(c.$('conversaMsgs').innerHTML, new RegExp(`class="conversa-pedido dela" data-msg="0" data-id="${uuid(7)}"`),
    'o cartão não diz qual mensagem é — o `data-msg` é a POSIÇÃO, que anda quando a página antiga entra');
});

// ── a foto de cartão que não carregou ───────────────────────────────────────

const FOTO_RUIM = 'https://venue-image.waze.com/thumbs/thumb700_sumiu';
const FOTO_BOA = 'https://venue-image.waze.com/thumbs/thumb700_boa';
const comFoto = (url) => JSON.stringify({ venueID: '1.2.3', name: 'Padaria', categories: ['BAKERY'], updateTypeKey: 'IMAGE', imageUrl: url, region: 'row' });

test('foto de cartão que NÃO carregou não volta pro redesenho (era pedida de novo a cada mensagem) — abrir a conversa de novo tenta', async () => {
  // MEDIDO sem rota nenhuma do Playwright: 1 → 6 pedidos ao CDN em 5 redesenhos
  // (o CDN responde 403 com `max-age=0` pra foto que sumiu); a foto boa, 1.
  const hist = [daCaf(1, 1790200000000, { contexto: { ...APP, card: comFoto(FOTO_RUIM) } }),
    daCaf(2, 1790200000001, { contexto: { ...APP, card: comFoto(FOTO_BOA) } })];
  const c = novoCliente({ api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: hist, maisAntigas: false, lida: true } : { success: true }) } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.ok(c.$('conversaMsgs').innerHTML.includes(`src="${FOTO_RUIM}"`), 'CONTROLE: a foto tem que ir pra tela na primeira vez');
  // O navegador desiste da foto (o `error` só se pega na captura).
  let saiu = 0;
  c.$('conversaMsgs').disparar('error', { target: { tagName: 'IMG', getAttribute: (k) => (k === 'src' ? FOTO_RUIM : null), closest: () => ({ remove: () => { saiu += 1; } }) } });
  assert.equal(saiu, 1, 'a foto quebrada ficou na conversa (ícone de imagem quebrada)');
  // Chega uma mensagem: a conversa é redesenhada.
  c.P.presencaQuadro(fluxoDe(c), inbox(await bytesDeMensagem({ id: uuid(3), de: CAF, para: EU, texto: 'e aí?', ctx: APP, ts: 1790200000002 }), 3));
  const html = c.$('conversaMsgs').innerHTML;
  assert.match(html, /e aí\?/, 'CONTROLE: o redesenho tem que ter acontecido');
  assert.ok(!html.includes(FOTO_RUIM), 'a foto que já não carregou voltou pro redesenho — o navegador a pede de novo a cada mensagem');
  assert.ok(html.includes(`src="${FOTO_BOA}"`), 'a foto que carregou saiu junto');
  // Fechar e abrir de novo é a hora de tentar de novo.
  c.P.presencaEsquecerAberta();
  c.$('conversaModal').classList.add('hidden');
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.ok(c.$('conversaMsgs').innerHTML.includes(`src="${FOTO_RUIM}"`), 'reabrir a conversa não tentou de novo a foto');
});
