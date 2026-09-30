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

// ── P1: o que a conversa e a folha do pedido deixavam no DOM ────────────────

// No navegador, `img.src` É o atributo: `removeAttribute('src')` o esvazia. O
// elemento de mentira guarda os dois separados — sem ligar um ao outro, a
// asserção "a foto saiu" passaria com a foto lá (é o gotcha #28 no instrumento).
function comSrcDeVerdade(el) {
  Object.defineProperty(el, 'src', { configurable: true, get() { return this.getAttribute('src') || ''; }, set(v) { this.setAttribute('src', v); } });
  return el;
}

const CARD_PRESO = { venueID: '9.9.9', updateRequestID: 'u9', name: 'Oficina Segredo do Terceiro', address: 'Rua Privada, 77',
  categories: ['CAR_SERVICES'], updateTypeKey: 'IMAGE', imageUrl: 'https://venue-image.waze.com/thumbs/thumb700_do_terceiro', lat: -23.5, lon: -46.6, region: 'row' };

test('P1 fechar a conversa leva o TOPO (quem e onde) e a TIRINHA do pedido preso — não só as mensagens', () => {
  const c = novoCliente();
  comSrcDeVerdade(c.$('conversaAnexoFoto'));
  c.win.cardParaConversa = () => CARD_PRESO;
  c.AppState.currentPlace = { mapa: { centro: [-23.55, -46.63] } };
  c.P.Presenca.online = [pessoa(CAF, 'cafanha', -23.5, -46.6, 3)];
  c.P.presencaAbrirConversa(CAF);
  c.P.presencaAnexarCard();
  const antes = { titulo: c.$('conversaTitle').textContent, estado: c.$('conversaEstado').innerHTML,
    anexo: c.$('conversaAnexoNome').textContent, foto: c.$('conversaAnexoFoto').src };
  assert.equal(antes.titulo, 'cafanha', 'CONTROLE: o topo tem que estar preenchido');
  assert.match(antes.estado, /presenca\.conversa\.naApp · L4/, 'CONTROLE: o estado tem que estar preenchido');
  assert.equal(antes.anexo, 'Oficina Segredo do Terceiro', 'CONTROLE: a tirinha tem que estar preenchida');
  assert.equal(antes.foto, CARD_PRESO.imageUrl);
  c.P.presencaEsquecerAberta();                                 // a limpeza do modal (✕, Esc, scrim, voltar)
  assert.equal(c.$('conversaTitle').textContent, '', 'o nome de quem conversou ficou no DOM');
  assert.equal(c.$('conversaEstado').innerHTML, '', 'o estado (nível e distância da pessoa) ficou no DOM');
  assert.equal(c.$('conversaEstado').classList.contains('hidden'), true);
  assert.equal(c.$('conversaAnexoNome').textContent, '', 'o nome do pedido preso ficou na tirinha escondida');
  assert.equal(c.$('conversaAnexoMeta').textContent, '');
  assert.equal(c.$('conversaAnexoFoto').src, '', 'a foto do pedido preso ficou na tirinha escondida');
  // E reabrir desenha tudo de novo (a memória do último desenho não pula o topo).
  c.P.presencaAbrirConversa(CAF);
  assert.equal(c.$('conversaTitle').textContent, 'cafanha');
  assert.match(c.$('conversaEstado').innerHTML, /presenca\.conversa\.naApp/, 'reabrir a conversa deixou o topo vazio');
});

test('P1 mandar o pedido solta a tirinha E a esvazia; o "Sair" passa pela mesma limpeza', async () => {
  const c = novoCliente({ api: { chat: () => ({ success: true }) } });
  comSrcDeVerdade(c.$('conversaAnexoFoto'));
  c.win.cardParaConversa = () => CARD_PRESO;
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  c.P.presencaAnexarCard();
  c.$('conversaInput').value = 'é fachada?';
  c.$('conversaForm').disparar('submit');
  await tick();
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'enviar').length, 1, 'CONTROLE: o pedido tem que ter saído');
  assert.equal(c.$('conversaAnexoNome').textContent, '', 'a tirinha solta guardou o nome do pedido');
  assert.equal(c.$('conversaAnexoFoto').src, '', 'a tirinha solta guardou a foto do pedido');
  // O "Sair" (presencaEsquecer → desligar → esquecerAberta), com a conversa aberta.
  c.P.presencaAnexarCard();
  c.P.presencaEsquecer();
  for (const id of ['conversaTitle', 'conversaAnexoNome', 'conversaAnexoMeta']) assert.equal(c.$(id).textContent, '', `${id} ficou no DOM depois do "Sair"`);
  assert.equal(c.$('conversaEstado').innerHTML, '');
  assert.equal(c.$('conversaAnexoFoto').src, '');
});

// A folha do pedido recebido é do app.js: a abertura (`abrirPedidoRecebido`) e a
// limpeza (`LIMPEZA_AO_FECHAR.pedidoModal`) rodam DE VERDADE, fatiadas, num
// documento de mentira que anota TUDO o que a abertura escreve — o que ela
// escreve, a limpeza tem que apagar (e um campo novo na folha entra sozinho).
test('P1 a folha do pedido recebido: tudo o que a abertura escreve, o fechamento apaga', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const els = new Map();
  const escritos = new Set();
  const el = (id) => {
    if (els.has(id)) return els.get(id);
    const attrs = {};
    const cls = new Set(['hidden']);
    let texto = '';
    const e = {
      id, onerror: null,
      get textContent() { return texto; }, set textContent(v) { texto = String(v); if (texto) escritos.add(id); },
      get src() { return attrs.src || ''; }, set src(v) { attrs.src = String(v); escritos.add(id); },
      get href() { return attrs.href || ''; }, set href(v) { attrs.href = String(v); escritos.add(id); },
      setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, removeAttribute(k) { delete attrs[k]; },
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, f) => (f ? cls.add(c) : cls.delete(c)) },
    };
    els.set(id, e);
    return e;
  };
  const document = { getElementById: el };
  const fatiar = (nome) => {
    const ini = APP.indexOf('function ' + nome + '(');
    assert.ok(ini >= 0, `sumiu ${nome}`);
    const fim = APP.slice(ini + 1).search(/\n(?:function |async function |const |let )/);
    return APP.slice(ini, ini + 1 + fim);
  };
  const abrir = new Function('document', 'identidadeDoPlace', 't', 'rotuloDeEnum', 'linkWmeDoPedido', 'API', 'openModal',
    fatiar('abrirPedidoRecebido') + '\nreturn abrirPedidoRecebido;')(
    document, (d) => ({ titulo: d.name, tituloEhEndereco: false }), (k, v) => (v ? `${k}${JSON.stringify(v)}` : k), (p, k) => k,
    () => 'https://www.waze.com/editor?env=row&venues=9.9.9', { getRegion: () => 'row' }, () => {});
  const ini = APP.indexOf('const LIMPEZA_AO_FECHAR = {');
  const LIMPEZA = new Function('document', 'window', 'URL', APP.slice(ini, APP.indexOf('\n};', ini) + 3) + '\nreturn LIMPEZA_AO_FECHAR;')(document, {}, URL);
  abrir(CARD_PRESO, 'cafanha');
  assert.ok(['pedidoNome', 'pedidoDe', 'pedidoEnd', 'pedidoFotoImg', 'pedidoWme'].every((id) => escritos.has(id)),
    `CONTROLE: a abertura tem que escrever o nome, de quem, o endereço, a foto e o link (escreveu ${[...escritos]})`);
  assert.equal(typeof LIMPEZA.pedidoModal, 'function', 'a folha do pedido recebido não tem limpeza ao fechar');
  LIMPEZA.pedidoModal();
  for (const id of escritos) {
    const e = els.get(id);
    assert.equal(e.textContent, '', `${id}: o texto de terceiro ficou na folha fechada`);
    assert.equal(e.getAttribute('src'), null, `${id}: a foto de terceiro ficou na folha fechada`);
    assert.equal(e.getAttribute('href'), null, `${id}: o link do pedido ficou na folha fechada`);
  }
  assert.equal(els.get('pedidoFoto').classList.contains('hidden'), true, 'a caixa da foto ficou aberta, vazia');
});

// ── P2: a renovação silenciosa da sessão não fecha a conversa ───────────────

test('P2 a renovação silenciosa (só falta o PERFIL): a conversa, o pedido preso e o texto FICAM — e o tempo real fecha até ele voltar', async () => {
  const c = novoCliente();
  c.win.cardParaConversa = () => CARD_PRESO;
  c.P.Presenca.online = [pessoa(CAF, 'cafanha', -23.5, -46.6, 3)];
  c.P.presencaAbrirConversa(CAF);
  c.P.presencaAnexarCard();
  c.$('conversaInput').value = 'meio escrito';
  // O tempo real aberto, com um token que ainda vale e a lista de agora.
  const agora = c.relogio.agora;
  c.P.Presenca.chat = { token: 't', base: 'https://instantmessaging-pa.googleapis.com/', chave: 'k', expiraEm: agora + 10 * 36e5 };
  c.P.Presenca.pais = 30;
  c.P.Presenca.atualizadaEm = agora;
  const velho = fluxoDe(c);
  c.P.Presenca.fluxo = velho;
  // A queda apaga o perfil; a extensão devolve a sessão, e o `showMainScreen`
  // chama a presença ANTES de o perfil voltar.
  c.AppState.profile = null;
  await c.P.presencaSincronizar();
  assert.deepEqual(c.chamadas.closeModal, [], 'a renovação silenciosa FECHOU a conversa (e a lista, e a folha do pedido)');
  assert.equal(c.$('conversaModal').classList.contains('hidden'), false);
  assert.equal(c.P.Presenca.aberta, CAF);
  assert.equal(c.P.Presenca.anexo, CARD_PRESO, 'o pedido preso se perdeu na renovação');
  assert.equal(c.$('conversaInput').value, 'meio escrito');
  assert.equal(velho.ctl.signal.aborted, true, 'o tempo real seguiu aberto sem saber de quem é a sessão');
  assert.equal(c.P.Presenca.fluxo, null);
  // Um quadro que ainda chegasse nesse meio não entra NEM é confirmado — senão
  // não voltaria mais: o fluxo o reentrega reaberto, com o perfil.
  c.P.presencaQuadro(velho, inbox(await bytesDeMensagem({ id: uuid(40), de: CAF, para: EU, texto: 'no meio', ctx: APP, ts: agora }), 40));
  assert.deepEqual(c.P.chatAConfirmar(), [], 'a mensagem que chegou sem perfil foi CONFIRMADA — e não voltaria mais');
  // O perfil volta (a mesma conta): o tempo real reabre sozinho.
  c.AppState.profile = { id: Number(EU), userName: 'antigerme' };
  const antes = c.chamadas.fetch.length;
  await c.P.presencaSincronizar();
  assert.equal(c.chamadas.fetch.length, antes + 1, 'o tempo real não reabriu quando o perfil voltou');
  assert.equal(c.chamadas.presencaApp.length, 0, 'a lista de agora foi pedida de novo à toa');
  // CONTROLE: a queda que vai pra TELA DE ENTRADA (sem sessão) fecha tudo.
  const d = novoCliente();
  d.P.presencaAbrirConversa(CAF);
  d.AppState.authenticated = false;
  d.AppState.profile = null;
  await d.P.presencaSincronizar();
  assert.deepEqual(d.chamadas.closeModal, ['conversaModal'], 'a queda de verdade não fechou a conversa');
  assert.equal(d.P.Presenca.aberta, null);
});

test('P2 sem o perfil, o "Tentar de novo" não sai — sairia pela sessão NOVA, que pode ser de outra conta', async () => {
  let resposta = { success: false, errorCategory: 'transient', _motivo: 'TypeError' };
  const c = novoCliente({ api: { chat: () => resposta } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true });
  c.P.presencaEnviar('oi', null);
  await tick();
  assert.equal(c.P.Presenca.historico.get(CAF).msgs[0].estado, 'falhou', 'CONTROLE: a mensagem tem que ter falhado');
  resposta = { success: true };
  c.AppState.profile = null;                            // a sessão renovando
  c.P.presencaTentarDeNovo();
  await tick();
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'enviar').length, 1, 'o "Tentar de novo" saiu sem saber de quem é a sessão');
  assert.equal(c.P.Presenca.historico.get(CAF).msgs[0].estado, 'falhou');
  // CONTROLE: com o perfil de volta, sai — com o MESMO id.
  c.AppState.profile = { id: Number(EU), userName: 'antigerme' };
  c.P.presencaTentarDeNovo();
  await tick();
  const envios = c.chamadas.chat.filter((x) => x.acao === 'enviar');
  assert.equal(envios.length, 2);
  assert.equal(envios[1].id, envios[0].id);
});
