// O cliente da presença e da conversa (fase 3), rodando INTEIRO num navegador
// de mentira (`_presenca-cliente.mjs`): o que ele faz com o que chega do
// servidor e do tempo real, e o que ele manda.
//
// Os bytes de mensagem são os REAIS da fixture (gravados no WME com as contas
// do owner) ou montados pelo MESMO construtor do servidor — o cliente tem que
// ler exatamente o que o servidor lê.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as g from '../server/wme-grpc.mjs';
import { novoCliente, bytesDeMensagem, bytesDeRecibo, b64 } from './_presenca-cliente.mjs';

const F = JSON.parse(readFileSync(new URL('./wme-grpc.fixture.json', import.meta.url), 'utf8'));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const EU = '12444348';
const CAF = '183164343';
const APP = { app: 'wazeplaces' };
const uuid = (n) => `a0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;

// Um quadro do fluxo, como o Google manda.
const inbox = (bytes, n = 1) => ({ inboxMessage: { messageId: uuid(900 + n), messageType: 'USERDATA_MESSAGE_TYPE_X', message: b64(bytes) } });
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });

// ── o protobuf ───────────────────────────────────────────────────────────────

test('decodificador: lê os bytes REAIS do WME exatamente como o servidor lê', () => {
  const c = novoCliente();
  for (const k of ['enviarTexto', 'enviarTexto2', 'reciboLida', 'reciboEntregue']) {
    const bytes = g.lerCampos(deB64(F[k].req)).find((x) => x.n === 2).v;
    assert.deepEqual(c.P.presencaLerMensagem(bytes), g.lerMensagem(bytes), k);
  }
});

test('decodificador: contexto, acento e emoji chegam inteiros', async () => {
  const c = novoCliente();
  const bytes = await bytesDeMensagem({ id: uuid(1), de: CAF, para: EU, texto: 'Esse é duplicado? 📍 ç', ctx: { ...APP, card: '{"venueID":"1"}', legenda: 'é?' } });
  assert.deepEqual(c.P.presencaLerMensagem(bytes), g.lerMensagem(bytes));
  // O base64 do fluxo pode vir na variante de URL: o leitor aceita as duas.
  const url = b64(bytes).replace(/\+/g, '-').replace(/\//g, '_');
  assert.deepEqual(c.P.presencaLerMensagem(c.P.presencaDeBase64(url)), g.lerMensagem(bytes));
});

// ── o fluxo chega aos pedaços ───────────────────────────────────────────────

test('leitor do fluxo: cada objeto sai inteiro, com o texto cortado em QUALQUER ponto', () => {
  const c = novoCliente();
  const objetos = [{ startOfBatch: {} }, { inboxMessage: { messageId: 'x', message: 'a}b{"c\\"' } }, { endOfBatch: {} }];
  const texto = '[' + objetos.map((o) => JSON.stringify(o)).join(',\n') + ']';
  for (let corte = 1; corte < texto.length; corte++) {
    const ler = c.P.presencaLeitorDeArray();
    const saida = [...ler(texto.slice(0, corte)), ...ler(texto.slice(corte))];
    assert.deepEqual(saida, objetos, `cortado em ${corte}`);
  }
  // Letra a letra, como a rede às vezes entrega.
  const ler = c.P.presencaLeitorDeArray();
  assert.deepEqual([...texto].flatMap((ch) => ler(ch)), objetos);
});

// ── só o que é do app, e nada contado duas vezes ────────────────────────────

test('fluxo: mensagem de quem SÓ usa o WME não aparece — mas é confirmada', async () => {
  const c = novoCliente();
  const bytes = await bytesDeMensagem({ id: uuid(1), de: '600', para: EU, texto: 'oi, vi você no mapa' });
  c.P.presencaQuadro(fluxoDe(c), inbox(bytes));
  assert.equal(c.P.presencaNaoLidasTotal(), 0, 'mensagem do WME virou não lida no app');
  assert.equal(c.P.Presenca.conversas.length, 0);
  assert.deepEqual(c.guardado().confirmar, [uuid(901)], 'o que chegou tem que ser confirmado, senão volta a cada reconexão');
  assert.ok(!(c.guardado().conhecidos || []).includes('600'));
});

test('fluxo: mensagem do app AO VIVO vira não lida, acende o balão e a pessoa passa a ser conhecida', async () => {
  const c = novoCliente();
  c.P.Presenca.atualizadaEm = 1;
  const bytes = await bytesDeMensagem({ id: uuid(2), de: CAF, para: EU, texto: 'Viu o posto novo?', ctx: APP, ts: 1790200000000 });
  c.P.presencaQuadro(fluxoDe(c), inbox(bytes));
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1);
  assert.equal(c.$('presencaPill').classList.contains('hidden'), false, 'mensagem nova de quem saiu: a pílula tem que ficar');
  assert.equal(c.$('presencaIconMsg').classList.contains('hidden'), false, 'o ícone tem que virar balão');
  assert.equal(c.$('presencaCount').textContent, '1');
  assert.deepEqual(c.guardado().conhecidos, [CAF]);
  // Conversa nova de quem não está na lista: o nome vem da próxima lista.
  assert.ok(c.timers.some((t) => t.ms === 3000), 'não pediu o nome de quem escreveu');
});

test('fluxo: uma conversa CONHECIDA segue sendo do app mesmo respondida pelo WME, sem a marca', async () => {
  const c = novoCliente();
  c.P.chatConhecer(CAF);
  c.P.Presenca.atualizadaEm = 1;
  const bytes = await bytesDeMensagem({ id: uuid(3), de: CAF, para: EU, texto: 'respondi daqui do WME', ts: 1790200000000 });
  c.P.presencaQuadro(fluxoDe(c), inbox(bytes));
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1);
});

test('fluxo: o LOTE da reconexão não conta de novo o que a lista já contou; o mesmo id nunca conta duas vezes', async () => {
  const c = novoCliente();
  c.P.Presenca.atualizadaEm = 1790200000000;
  const f = fluxoDe(c);
  f.emLote = true;
  const velha = await bytesDeMensagem({ id: uuid(4), de: CAF, para: EU, texto: 'antiga', ctx: APP, ts: 1790199999000 });
  const nova = await bytesDeMensagem({ id: uuid(5), de: CAF, para: EU, texto: 'nova', ctx: APP, ts: 1790200001000 });
  c.P.presencaQuadro(f, inbox(velha, 1));
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'a do lote anterior à lista foi contada — a lista já a contou');
  c.P.presencaQuadro(f, inbox(nova, 2));
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'a do lote que chegou DEPOIS da lista não foi contada');
  f.emLote = false;
  c.P.presencaQuadro(f, inbox(nova, 3));   // reentregue ao vivo
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'a mesma mensagem contou duas vezes');
});

test('fluxo: o recibo de LEIDA marca como lidas as minhas mensagens até ele', async () => {
  const c = novoCliente();
  const recibo = await bytesDeRecibo({ id: uuid(6), de: CAF, para: EU, tipo: 'lida', ids: [uuid(7)], ts: 1790200005000 });
  c.P.presencaQuadro(fluxoDe(c), inbox(recibo));
  assert.equal(c.P.chatLidaAte(CAF), 1790200005000);
  // O "entregue" não vira nada na tela (decisão: só Enviada e Lida).
  const entregue = await bytesDeRecibo({ id: uuid(8), de: CAF, para: EU, tipo: 'entregue', ids: [uuid(7)], ts: 1790200009000 });
  c.P.presencaQuadro(fluxoDe(c), inbox(entregue, 2));
  assert.equal(c.P.chatLidaAte(CAF), 1790200005000, '"entregue" foi tratado como "lida"');
  // Recibo MEU (de outro aparelho meu) não diz nada sobre a outra pessoa.
  const meu = await bytesDeRecibo({ id: uuid(9), de: EU, para: CAF, tipo: 'lida', ids: [uuid(7)], ts: 1790200009000 });
  c.P.presencaQuadro(fluxoDe(c), inbox(meu, 3));
  assert.equal(c.P.chatLidaAte(EU), 0);
});

test('fluxo: com a conversa ABERTA e na tela, mensagem nova vira "lida" (um pedido, juntando várias)', async () => {
  const c = novoCliente();
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true, maisAntigas: false });
  for (let i = 0; i < 3; i++) {
    const bytes = await bytesDeMensagem({ id: uuid(10 + i), de: CAF, para: EU, texto: 'm' + i, ctx: APP, ts: 1790200000000 + i });
    c.P.presencaQuadro(fluxoDe(c), inbox(bytes, 10 + i));
  }
  assert.equal(c.P.presencaNaoLidasTotal(), 0, 'conversa aberta e na tela não gera não lida');
  assert.equal(c.P.Presenca.historico.get(CAF).msgs.length, 3);
  await c.rodarTimers();
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'lida').length, 1, 'três mensagens juntas têm que virar UM "lida"');
  // Com a tela apagada não é leitura.
  const d = novoCliente({ visivel: 'hidden' });
  d.P.Presenca.aberta = CAF;
  d.$('conversaModal').classList.remove('hidden');
  d.P.Presenca.historico.set(CAF, { msgs: [], carregada: true });
  d.P.Presenca.atualizadaEm = 1;
  d.P.presencaQuadro(fluxoDe(d), inbox(await bytesDeMensagem({ id: uuid(20), de: CAF, para: EU, ctx: APP, ts: 1790200000000 })));
  assert.equal(d.P.presencaNaoLidasDe(CAF), 1, 'com a tela apagada a mensagem tem que ficar não lida');
  assert.ok(!d.timers.some((t) => t.ms === 1200), 'agendou "lida" com a tela apagada');
});

// ── a lista ─────────────────────────────────────────────────────────────────

const pessoa = (id, nome, lat, lon, rank = 2) => ({ id, nome, rank, lat, lon });
const conversa = (id, nome, atividade, naoLidas = 0, ultima = null) => ({ id, nome, naoLidas, atividade, ultima });

test('lista: parte que não veio (null) mantém a anterior; a que veio substitui', () => {
  const c = novoCliente();
  c.P.presencaAplicarLista({ online: [pessoa(CAF, 'cafanha', -23.5, -46.6)], conversas: [conversa('700', 'x', 5)] }, 1, 30);
  c.P.presencaAplicarLista({ online: null, conversas: [] }, 2, 30);
  assert.deepEqual(c.P.Presenca.online.map((p) => p.nome), ['cafanha'], 'falha passageira apagou quem estava no app');
  assert.deepEqual(c.P.Presenca.conversas, []);
});

test('lista: a não lida que chegou ao vivo DEPOIS do pedido sobrevive à lista; a de antes, a lista já contou', () => {
  const c = novoCliente();
  c.P.Presenca.vivas.set('1', { n: 2, ultimaTs: 100 });
  c.P.Presenca.vivas.set('2', { n: 1, ultimaTs: 300 });
  c.P.presencaAplicarLista({ online: [], conversas: [conversa('1', 'a', 90, 2)] }, 200, 30);
  assert.equal(c.P.presencaNaoLidasDe('1'), 2, 'contou duas vezes o que a lista já tinha');
  assert.equal(c.P.presencaNaoLidasDe('2'), 1, 'a mensagem que chegou depois do pedido sumiu');
});

test('lista: toda conversa que o servidor diz ser do app vira conhecida, da mais recente pra mais antiga', () => {
  const c = novoCliente();
  c.P.presencaAplicarLista({ online: [], conversas: [conversa('1', 'a', 10), conversa('2', 'b', 30), conversa('3', 'c', 20)] }, 1, 30);
  assert.deepEqual(c.guardado().conhecidos, ['2', '3', '1']);
});

test('lista A: "Triando agora" do mais perto pro mais longe, com a distância; conversas de quem não está no app', () => {
  const c = novoCliente();
  c.AppState.currentPlace = { mapa: { centro: [-23.55, -46.63] } };   // [lat, lon]
  c.P.presencaAplicarLista({
    online: [pessoa('1', 'longe', -22.90, -43.20), pessoa('2', 'perto', -23.556, -46.635), pessoa('3', 'medio', -23.40, -46.50)],
    conversas: [conversa('2', 'perto', 50, 1), conversa('9', 'fora', 40, 0, { texto: 'valeu', ts: 40 })],
  }, 1, 30);
  c.$('presencaModal').classList.remove('hidden');
  c.P.presencaRenderLista();
  const html = c.$('presencaLista').innerHTML;
  const ordem = [...html.matchAll(/presenca-nome">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(ordem, ['perto', 'medio', 'longe', 'fora'], 'a ordem não é a da distância, ou quem está no app apareceu duas vezes');
  assert.match(html, /presenca\.distPerto/, 'menos de 1 km tem frase própria');
  // (as aspas saem como entidade: o texto passa pelo escapeHtml)
  assert.match(html, /presenca\.dist\{&quot;km&quot;:&quot;21&quot;\}/, 'a distância sai em km inteiros, crus');
  assert.match(html, /presenca-secao">presenca\.sheet\.agora</);
  assert.match(html, /presenca-secao">presenca\.sheet\.conversas</);
  // Contraprova da ORDEM das coordenadas: lida ao contrário, "perto" deixaria
  // de ser o primeiro (e -46,63 é latitude válida: nada reclamaria).
  const inv = novoCliente();
  inv.AppState.currentPlace = { mapa: { centro: [-46.63, -23.55] } };
  inv.P.presencaAplicarLista({ online: [pessoa('1', 'longe', -22.90, -43.20), pessoa('2', 'perto', -23.556, -46.635)], conversas: [] }, 1, 30);
  inv.P.presencaRenderLista();
  assert.notEqual([...inv.$('presencaLista').innerHTML.matchAll(/presenca-nome">([^<]+)</g)][0][1], 'perto',
    'a contraprova não reprovou: o teste não enxergaria a ordem trocada');
  // Sem card na tela e sem posição anterior, não há "daqui": a linha não inventa.
  const semRef = novoCliente();
  semRef.P.presencaAplicarLista({ online: [pessoa('1', 'x', -22.9, -43.2)], conversas: [] }, 1, 30);
  semRef.P.presencaRenderLista();
  assert.doesNotMatch(semRef.$('presencaLista').innerHTML, /presenca\.dist/);
});

test('lista A: das conversas, as 5 mais recentes — e TODA com não lida, onde estiver', () => {
  const c = novoCliente();
  const cs = Array.from({ length: 9 }, (_, i) => conversa(String(100 + i), 'p' + i, 100 - i, 0, { texto: 't' + i, ts: 100 - i }));
  cs[8].naoLidas = 3;   // a mais antiga tem mensagem nova
  c.P.presencaAplicarLista({ online: [], conversas: cs }, 1, 30);
  c.P.presencaRenderLista();
  const nomes = [...c.$('presencaLista').innerHTML.matchAll(/presenca-nome">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(nomes, ['p0', 'p1', 'p2', 'p3', 'p4', 'p8'], 'a conversa com não lida ficou escondida: número que não se zera');
  assert.match(c.$('presencaLista').innerHTML, /presenca-l2 forte/, 'a não lida tem que ficar forte');
  assert.match(c.$('presencaLista').innerHTML, /presenca-vazio">presenca\.sheet\.vazio</, 'ninguém no app sem a linha de ninguém');
});

test('lista A: o subtítulo diz o país do filtro — pelo MESMO nome que o filtro mostra', () => {
  const c = novoCliente();
  c.P.presencaAplicarLista({ online: [], conversas: [] }, 1, 30);
  c.P.presencaRenderLista();
  assert.equal(c.$('presencaSub').textContent, 'presenca.sheet.sub{"pais":"Brazil"}');
  const semPaises = novoCliente();
  semPaises.AppState.countries = [];
  semPaises.P.presencaRenderLista();
  assert.equal(semPaises.$('presencaSub').textContent, 'presenca.sheet.subSemPais');
});

test('lista A: a prévia de um pedido mandado mostra o alfinete com a pergunta, ou o nome e o tipo', () => {
  const c = novoCliente();
  assert.equal(c.P.presencaPrevia({ card: { name: 'Loja', updateTypeKey: 'IMAGE' }, texto: 'é fachada?' }), '📍 é fachada?');
  assert.equal(c.P.presencaPrevia({ card: { name: 'Loja', updateTypeKey: 'IMAGE' }, texto: '' }), '📍 Loja · Nova foto');
  assert.equal(c.P.presencaPrevia({ card: null, texto: 'oi' }), 'oi');
});

// ── a pílula ────────────────────────────────────────────────────────────────

test('pílula: some sem ninguém e sem mensagem; fica com mensagem mesmo sem ninguém; some desligada', () => {
  const c = novoCliente();
  c.P.presencaRenderPilula();
  assert.equal(c.$('presencaPill').classList.contains('hidden'), true, '"0" não é notícia');
  c.P.Presenca.online = [pessoa('1', 'a', 0, 0), pessoa('2', 'b', 0, 0)];
  c.P.presencaRenderPilula();
  assert.equal(c.$('presencaPill').classList.contains('hidden'), false);
  assert.equal(c.$('presencaCount').textContent, '2');
  assert.equal(c.$('presencaIconGente').classList.contains('hidden'), false);
  assert.equal(c.$('presencaPill').getAttribute('aria-label'), 'presenca.pill.ariaPlural{"n":2}');
  c.P.Presenca.online = [];
  c.P.Presenca.conversas = [conversa('9', 'fora', 1, 1)];
  c.P.presencaRenderPilula();
  assert.equal(c.$('presencaPill').classList.contains('hidden'), false, 'mensagem de quem saiu ficou sem caminho de volta');
  assert.equal(c.$('presencaIconMsg').classList.contains('hidden'), false);
  assert.equal(c.$('presencaPill').getAttribute('aria-label'), 'presenca.pill.msg{"n":1}');
  c.AppState.preferences.presenca = false;
  c.P.presencaRenderPilula();
  assert.equal(c.$('presencaPill').classList.contains('hidden'), true);
});

// ── o que fica no aparelho ──────────────────────────────────────────────────

test('aparelho: conhecidos com teto de 50, o mais recente na frente, e sem escrita quando nada muda', () => {
  const c = novoCliente();
  for (let i = 0; i < 60; i++) c.P.chatConhecer(String(1000 + i));
  const l = c.guardado().conhecidos;
  assert.equal(l.length, 50);
  assert.equal(l[0], '1059');
  assert.ok(!l.includes('1009'), 'o teto descartou o mais recente em vez do mais antigo');
  c.P.chatConhecer(['nao-e-id', '1059']);
  const antes = c.armazenado.get('waze_places_chat');
  c.P.chatConhecer('1059');
  assert.equal(c.armazenado.get('waze_places_chat'), antes);
});

test('aparelho: a confirmação solta SÓ o que foi mandado — o que chegou no meio fica', () => {
  const c = novoCliente();
  for (let i = 0; i < 120; i++) c.P.chatGuardarAConfirmar(uuid(i));
  assert.equal(c.guardado().confirmar.length, 100, 'sem teto');
  assert.equal(c.guardado().confirmar[0], uuid(20), 'o teto descartou os novos em vez dos velhos');
  const carona = c.P.chatCarona();
  assert.equal(carona.confirmar.length, 100);
  assert.equal(carona.instalacao, c.guardado().inst);
  c.P.chatGuardarAConfirmar(uuid(500));      // chegou enquanto o pedido estava em voo
  c.P.chatAoResponder({ success: true, confirmados: 100 }, carona);
  assert.deepEqual(c.guardado().confirmar, [uuid(500)]);
  // Sem `confirmados` (o Waze não confirmou), nada sai.
  const c2 = novoCliente();
  c2.P.chatGuardarAConfirmar(uuid(1));
  c2.P.chatAoResponder({ success: true }, c2.P.chatCarona());
  assert.deepEqual(c2.guardado().confirmar, [uuid(1)]);
});

test('aparelho: a instalação é ESTÁVEL; desligar mantém o que o aparelho sabe, sair apaga tudo', () => {
  const c = novoCliente();
  const inst = c.P.chatInstalacao();
  assert.equal(c.P.chatInstalacao(), inst, 'a instalação mudou: cada abertura seria um aparelho novo pro Waze');
  c.P.chatConhecer(CAF);
  c.P.presencaDesligar();
  assert.equal(c.guardado().inst, inst, 'desligar a presença não é sair');
  c.P.presencaEsquecer();
  assert.equal(c.armazenado.has('waze_places_chat'), false, 'o "Sair" deixou o chat no aparelho');
});

test('aparelho: o TOKEN do tempo real nunca vai pro armazenamento', async () => {
  const c = novoCliente({ api: { presencaApp: () => ({ success: true, online: [], conversas: [], chat: { token: 'SEGREDO', base: 'https://x/', chave: 'K', expiraEm: Date.now() + 86e6 } }) } });
  c.doc.visibilityState = 'hidden';   // não abre o fluxo neste teste
  await c.P.presencaAtualizar();
  assert.equal(c.P.Presenca.chat.token, 'SEGREDO');
  for (const v of c.armazenado.values()) assert.ok(!String(v).includes('SEGREDO'), 'o token foi parar no armazenamento');
  assert.equal(c.chamadas.presencaApp[0].token, true, 'sem token válido, a abertura tem que pedir um');
});

// ── mandar ──────────────────────────────────────────────────────────────────

const CARD = {
  venueID: '205522459.2055159053.3242788', updateRequestID: 'ur-1',
  name: 'Padaria Estrela do Norte', address: 'R. Aurora, 412', categories: ['BAKERY'],
  updateTypeKey: 'IMAGE', imageUrl: 'https://venue-image.waze.com/thumbs/thumb700_A.png',
  lat: -23.556789, lon: -46.631234, region: 'row',
};

test('mandar: texto puro vai sem contexto; na tela vira ENVIANDO e depois ENVIADA, com o id que foi', async () => {
  const c = novoCliente({ api: { chat: () => ({ success: true, id: 'x', ts: 1790200000999 }) } });
  c.P.Presenca.aberta = CAF;
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true });
  c.P.presencaEnviar('Oi, tudo bem?', null);
  const m = c.P.Presenca.historico.get(CAF).msgs[0];
  assert.equal(m.estado, 'enviando');
  await new Promise((r) => setImmediate(r));
  const envio = c.chamadas.chat.find((x) => x.acao === 'enviar');
  assert.equal(envio.texto, 'Oi, tudo bem?');
  assert.equal(envio.para, CAF);
  assert.ok(!('contexto' in envio), 'texto puro não carrega contexto');
  assert.match(envio.id, /^[0-9a-f-]{36}$/);
  assert.equal(m.id, envio.id);
  assert.equal(m.estado, 'enviada');
  assert.equal(m.ts, 1790200000999, 'a hora é a do servidor');
  assert.ok(c.guardado().conhecidos.includes(CAF), 'conversa que sai do app não virou conhecida');
});

test('mandar: com pedido, o WME recebe a pergunta, o 📍 com nome e tipo e o link LONGO do ↗', async () => {
  const c = novoCliente();
  const txt = c.P.presencaTextoParaWme('Esse aqui tá certo?', CARD);
  const [pergunta, linha, link] = txt.split('\n');
  assert.equal(pergunta, 'Esse aqui tá certo?');
  assert.equal(linha, '📍 Padaria Estrela do Norte · Nova foto');
  // O link CURTO (só env e venues) foi medido e NÃO serve: o WME abre noutro
  // lugar e não seleciona nada. Vai o mesmo do ↗ do card.
  assert.match(link, /^https:\/\/www\.waze\.com\/editor\?env=row&lat=-23\.55679&lon=-46\.63123&zoomLevel=22&venues=205522459\.2055159053\.3242788&venueUpdateRequest=205522459\.2055159053\.3242788&tab=feature_editor$/);
  // Só o pedido, sem pergunta: começa no alfinete.
  assert.ok(c.P.presencaTextoParaWme('', CARD).startsWith('📍 Padaria'));
  // E a pergunta volta do texto: é o que o app mostra no lugar da linha e do link.
  assert.equal(c.P.presencaLegendaDoTexto(txt), 'Esse aqui tá certo?');
  assert.equal(c.P.presencaLegendaDoTexto(c.P.presencaTextoParaWme('', CARD)), '');
  assert.equal(c.P.presencaLegendaDoTexto(c.P.presencaTextoParaWme('o 📍 tá errado?', CARD)), 'o 📍 tá errado?');
  assert.equal(c.P.presencaLegendaDoTexto('sem pedido'), null);
});

test('mandar: com pedido, o contexto leva o cartão e a pergunta CURTA (a marca do app quem põe é o servidor)', async () => {
  const c = novoCliente({ api: { chat: () => ({ success: true }) } });
  c.P.Presenca.aberta = CAF;
  c.P.presencaEnviar('x'.repeat(2000), CARD);
  await new Promise((r) => setImmediate(r));
  const envio = c.chamadas.chat.find((x) => x.acao === 'enviar');
  assert.deepEqual(Object.keys(envio.contexto).sort(), ['card', 'legenda']);
  assert.equal(envio.contexto.legenda.length, 280, 'a pergunta inteira no contexto estouraria o teto de 6 KB do servidor');
  assert.deepEqual(JSON.parse(envio.contexto.card), CARD);
  assert.ok(new TextEncoder().encode(JSON.stringify(envio.contexto)).length < 6144 - 40, 'o contexto não cabe no teto do servidor');
});

test('mandar: falha de rede vira "Não enviada, sem conexão" + "Tentar de novo", que repete com o MESMO id', async () => {
  let resposta = { success: false, errorCategory: 'transient' };
  const c = novoCliente({ api: { chat: () => resposta } });
  c.P.Presenca.aberta = CAF;
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true });
  c.P.presencaEnviar('oi', null);
  await new Promise((r) => setImmediate(r));
  const m = c.P.Presenca.historico.get(CAF).msgs[0];
  assert.equal(m.estado, 'falhou');
  const html = c.$('conversaMsgs').innerHTML;
  assert.match(html, /conversa-falhou">presenca\.recibo\.naoEnviada <button type="button" class="conversa-reenviar">presenca\.conversa\.tentar/);
  resposta = { success: true };
  c.P.presencaTentarDeNovo();
  await new Promise((r) => setImmediate(r));
  const envios = c.chamadas.chat.filter((x) => x.acao === 'enviar');
  assert.equal(envios.length, 2);
  assert.equal(envios[1].id, envios[0].id, 'a repetição mudou o id: o Waze não teria como reconhecer a mensagem repetida');
  assert.equal(m.estado, 'enviada');
  // Sessão morta segue pelo caminho do app.
  const d = novoCliente({ api: { chat: () => ({ success: false, errorCategory: 'unauthorized' }) } });
  d.P.Presenca.aberta = CAF;
  d.P.presencaEnviar('oi', null);
  await new Promise((r) => setImmediate(r));
  assert.equal(d.chamadas.unauthorized, 1);
  // Na LINHA da falha: o `aria-label` do glifo diz "Não enviada." nos dois
  // casos, e casar o arquivo inteiro não distinguiria (a sabotagem passou).
  assert.match(d.$('conversaMsgs').innerHTML, /conversa-falhou">presenca\.recibo\.naoEnviadaErro </, 'erro que não é de rede não pode dizer "sem conexão"');
});

// ── abrir a conversa ────────────────────────────────────────────────────────

test('abrir: histórico da mais nova pra mais antiga vira ordem do relógio; o pedido chega como cartão', async () => {
  const hist = [
    { id: uuid(3), ts: 3000, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'Tá sim', contexto: null },
    { id: uuid(2), ts: 2000, de: { tipo: 1, id: EU }, para: { tipo: 1, id: CAF }, classe: 'texto',
      texto: 'Esse aqui?\n📍 Padaria · Nova foto\nhttps://www.waze.com/editor?x',
      contexto: { ...APP, legenda: 'Esse aqui?', card: JSON.stringify({ ...CARD, imageUrl: 'https://mal.exemplo.invalido/x.png', extra: 1 }) } },
    { id: uuid(1), ts: 1000, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'Oi!', contexto: null },
  ];
  const c = novoCliente({ api: { chat: () => ({ success: true, mensagens: hist, maisAntigas: true, recibos: [] }) } });
  c.P.presencaAbrirConversa(CAF);
  await new Promise((r) => setImmediate(r));
  const h = c.P.Presenca.historico.get(CAF);
  assert.deepEqual(h.msgs.map((m) => m.ts), [1000, 2000, 3000]);
  const pedido = h.msgs[1];
  assert.equal(pedido.legenda, 'Esse aqui?', 'o app mostrou o texto do WME (com o link) em vez da pergunta');
  assert.equal(pedido.card.imageUrl, null, 'foto de fora do waze.com passou do contexto pro src');
  assert.ok(!('extra' in pedido.card), 'o cartão foi espalhado em vez de copiado campo a campo');
  assert.equal(c.chamadas.chat[0].acao, 'abrir');
  assert.equal(c.chamadas.chat[0].com, CAF);
  assert.match(c.$('conversaMsgs').innerHTML, /conversa-anteriores/, 'havia mensagens mais antigas e o botão sumiu');
  assert.match(c.$('conversaMsgs').innerHTML, /^<p class="conversa-aviso">presenca\.conversa\.aviso<\/p>/, 'o aviso de que a conversa fica no WME tem que vir primeiro');
  // A minha, respondida depois, conta como lida mesmo sem recibo guardado.
  assert.match(c.$('conversaMsgs').innerHTML, /conversa-lida">presenca\.recibo\.lida/);
});

test('abrir: os ids a confirmar vão de CARONA na abertura, e saem quando o Waze confirma', async () => {
  const c = novoCliente({ api: { chat: () => ({ success: true, mensagens: [], confirmados: 2 }) } });
  c.P.chatGuardarAConfirmar(uuid(1));
  c.P.chatGuardarAConfirmar(uuid(2));
  c.P.presencaAbrirConversa(CAF);
  await new Promise((r) => setImmediate(r));
  const abrir = c.chamadas.chat[0];
  assert.deepEqual(abrir.confirmar, [uuid(1), uuid(2)]);
  assert.equal(abrir.instalacao, c.guardado().inst);
  assert.deepEqual(c.guardado().confirmar, []);
});

test('abrir: o estado de quem está no app vs quem saiu — e o campo nunca trava', () => {
  const c = novoCliente();
  c.AppState.currentPlace = { mapa: { centro: [-23.55, -46.63] } };
  c.P.Presenca.online = [pessoa(CAF, 'cafanha', -23.40, -46.50, 4)];
  c.P.Presenca.aberta = CAF;
  c.P.presencaRenderConversa();
  assert.match(c.$('conversaEstado').innerHTML, /presenca-ponto"[^>]*><\/span>presenca\.conversa\.naApp · L5 · presenca\.dist/);
  c.P.Presenca.online = [];
  c.P.presencaRenderConversa();
  assert.match(c.$('conversaEstado').innerHTML, /presenca-ponto fora"[^>]*><\/span>presenca\.conversa\.fora/);
  assert.equal(c.$('conversaInput').disabled, false, 'quem saiu recebe quando voltar: o campo não pode travar');
  assert.equal(c.$('conversaEnviar').disabled, false);
});

// ── recibos ─────────────────────────────────────────────────────────────────

test('recibo: Lida pelo recibo guardado OU pela resposta; a linha "Lida" só sob a última lida', () => {
  const c = novoCliente();
  const minha = (ts) => ({ id: 'm' + ts, ts, meu: true, estado: 'enviada', texto: 't' });
  assert.equal(c.P.presencaEstadoDaMinha(minha(10), 10, 0), 'lida');
  assert.equal(c.P.presencaEstadoDaMinha(minha(10), 9, 0), 'enviada');
  assert.equal(c.P.presencaEstadoDaMinha(minha(10), 0, 11), 'lida', 'quem respondeu depois leu');
  assert.equal(c.P.presencaEstadoDaMinha({ ...minha(10), estado: 'enviando' }, 99, 99), 'enviando');
  c.P.chatMarcarLidaAte(CAF, 20);
  const html = c.P.presencaHtmlDasMsgs(CAF, { msgs: [minha(10), minha(20), minha(30)] });
  assert.equal((html.match(/conversa-lida/g) || []).length, 1);
  assert.equal((html.match(/presenca-recibo lida/g) || []).length, 2);
  assert.equal((html.match(/presenca-recibo enviada/g) || []).length, 1);
  assert.ok(html.indexOf('conversa-lida') < html.indexOf('presenca-recibo enviada'), 'a linha "Lida" tem que ficar sob a última lida');
  assert.doesNotMatch(html, /entregue/, 'o "Entregue" saiu (decisão do owner)');
  // Com uma falha DEPOIS, a "Lida" continua sob a última lida (como no mockup
  // aprovado): cada linha diz respeito à SUA mensagem.
  const comFalha = c.P.presencaHtmlDasMsgs(CAF, { msgs: [minha(10), minha(20), { ...minha(40), estado: 'falhou', motivo: 'conexao' }] });
  assert.equal((comFalha.match(/conversa-lida/g) || []).length, 1, 'a falha embaixo apagou a "Lida" de cima');
  assert.equal((comFalha.match(/conversa-falhou/g) || []).length, 1);
  assert.ok(comFalha.indexOf('conversa-lida') < comFalha.indexOf('conversa-falhou'));
});

test('recibo: separador de dia antes da primeira mensagem de cada dia', () => {
  const c = novoCliente();
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  c.relogio.agora = hoje.getTime();
  const html = c.P.presencaHtmlDasMsgs(CAF, { msgs: [
    { id: '1', ts: ontem.getTime(), meu: false, texto: 'a' },
    { id: '2', ts: ontem.getTime() + 1000, meu: false, texto: 'b' },
    { id: '3', ts: hoje.getTime(), meu: false, texto: 'c' },
  ] });
  assert.deepEqual([...html.matchAll(/conversa-dia"><span>([^<]+)</g)].map((m) => m[1]), ['presenca.dia.ontem', 'presenca.dia.hoje']);
});

test('recibo: as cores dos glifos são SÓLIDAS e existem pra cada estado', () => {
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const cls of ['enviando', 'enviada', 'lida', 'falhou']) {
    assert.match(css, new RegExp(`\\.presenca-recibo\\.${cls}\\b`), `sem cor pra .${cls}`);
  }
  assert.ok(!/\.presenca-recibo[^{]*\{[^}]*opacity/.test(css), 'opacidade derruba o contraste sem aparecer no valor computado (gotcha #40)');
});

const CONTAGEM = { online: { noWme: 48, comMarca: 3, noPais: 1 }, conversas: { noWaze: 9, marcadas: 2, daApp: 3 } };

// ── o que o diagnóstico vê ──────────────────────────────────────────────────

test('fechar a conversa e a lista tira o texto do DOM: a captura mostra o que estava NA TELA', () => {
  const c = novoCliente();
  c.$('conversaMsgs').innerHTML = '<div>segredo</div>';
  c.$('presencaLista').innerHTML = '<li>prévia</li>';
  c.P.Presenca.aberta = CAF;
  c.P.presencaEsquecerAberta();
  c.P.presencaEsquecerLista();
  assert.equal(c.$('conversaMsgs').innerHTML, '');
  assert.equal(c.$('presencaLista').innerHTML, '');
  assert.equal(c.P.Presenca.aberta, null);
});

test('diagnóstico: o resumo da presença traz as contagens e o PORQUÊ do servidor — e nunca a credencial do tempo real', async () => {
  // Privacidade não é critério no modo dev (decisão do owner): a conversa vai
  // pelo registro de chamadas e pelo DOM. Este resumo é o que se lê PRIMEIRO,
  // e o que não pode faltar nele é a contagem que explica uma lista vazia. O
  // token e a chave do tempo real seguem fora: credencial que não ajuda a
  // depurar nada.
  const c = novoCliente();
  c.P.presencaAplicarLista({ online: [pessoa(CAF, 'cafanha', 0, 0)], conversas: [conversa('9', 'outro', 1, 2)], contagem: CONTAGEM }, 1, 30, 'pedido');
  c.P.Presenca.chat = { token: 'TOKEN_UNICO', base: 'https://x/', chave: 'CHAVE_UNICA', expiraEm: Date.now() + 1e8 };
  const diag = c.P.presencaDiag();
  assert.equal(diag.online, 1);
  assert.equal(diag.naoLidas, 2);
  assert.deepEqual(diag.contagem, CONTAGEM, 'o resumo perdeu o porquê da lista');
  // Sem a contagem na resposta (servidor de antes), a anterior não vira lixo.
  c.P.presencaAplicarLista({ online: [], conversas: [] }, 2, 30, 'carona');
  assert.deepEqual(c.P.presencaDiag().contagem, CONTAGEM);
  const texto = JSON.stringify(c.P.presencaDiag());
  for (const s of ['TOKEN_UNICO', 'CHAVE_UNICA']) assert.ok(!texto.includes(s), `o diagnóstico levou ${s}`);
  assert.equal(diag.token.valido, true, 'do token vai o ESTADO, que é o que se depura');
});

test('tipo do pedido que esta versão não conhece sai HUMANIZADO, nunca a chave crua', () => {
  // O cartão vem de OUTRO aparelho, que pode ser de uma versão com um tipo novo.
  // Mesma regra do card (`rotuloDeEnum`): feio, nunca "card.updateType.X".
  const c = novoCliente();
  // O `t` do harness devolve a própria chave pra tudo — é o caso "não conhece".
  assert.equal(c.P.presencaTipo('NOVO_TIPO'), 'Novo tipo');
  assert.ok(!c.P.presencaResumoDoCard({ updateTypeKey: 'NOVO_TIPO', categories: [] }).includes('card.updateType'));
  assert.ok(!c.P.presencaPrevia({ card: { name: 'x', updateTypeKey: 'NOVO_TIPO' }, texto: '' }).includes('card.updateType'));
  assert.ok(!c.P.presencaTextoParaWme('', { venueID: '1', name: 'x', updateTypeKey: 'NOVO_TIPO' }).includes('card.updateType'));
});

test('fluxo: conversa ESCONDIDA por outra camada não é leitura, mesmo com o `aberta` de pé', async () => {
  // O `openModal` do pedido recebido esconde a conversa SEM passar pela limpeza
  // dela, e o `aberta` fica. Mensagem que chega aí é não lida — "lida" com a
  // conversa fora da vista seria um recibo que mente. Achado pelo smoke.
  const c = novoCliente();
  c.P.Presenca.aberta = CAF;
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true });
  c.P.Presenca.atualizadaEm = 1;
  c.$('conversaModal').classList.add('hidden');   // o pedido abriu por cima
  c.P.presencaQuadro(fluxoDe(c), inbox(await bytesDeMensagem({ id: uuid(30), de: CAF, para: EU, ctx: APP, ts: 1790200000000 })));
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'mensagem com a conversa escondida virou lida');
  assert.ok(!c.timers.some((t) => t.ms === 1200), 'agendou "lida" com a conversa fora da tela');
  // Controle: com a conversa VISÍVEL, a mesma mensagem é lida.
  const d = novoCliente();
  d.P.Presenca.aberta = CAF;
  d.P.Presenca.historico.set(CAF, { msgs: [], carregada: true });
  d.$('conversaModal').classList.remove('hidden');
  d.P.presencaQuadro(fluxoDe(d), inbox(await bytesDeMensagem({ id: uuid(31), de: CAF, para: EU, ctx: APP, ts: 1790200000000 })));
  assert.ok(d.timers.some((t) => t.ms === 1200), 'o controle não agendou o "lida" — o teste não distinguiria');
});

// ── a linha do tempo do diagnóstico ─────────────────────────────────────────
//
// A presença e o chat anotam no `dfato` — o anel que roda pra TODO editor, com
// ou sem o modo dev. Duas regras, as duas conferidas aqui: só TRANSIÇÃO (nada
// por quadro, por carona repetida ou por religada normal) e nenhum dado de
// terceiro (nome, id, texto) — o modo dev libera o relatório, não o anel.

const anotados = (c, k) => c.chamadas.dfato.filter(([x]) => x === k).map(([, o]) => o);

test('diário: a LISTA entra quando muda ou falha — a carona repetida não vira linha', async () => {
  let resposta = { success: true, online: [pessoa(CAF, 'cafanha', -23.4, -46.5)], conversas: [], contagem: CONTAGEM };
  const c = novoCliente({ api: { presencaApp: () => resposta } });
  c.P.Presenca.chat = { token: 'T', base: 'https://x/', chave: 'K', expiraEm: Date.now() + 86e6 };   // não pede token
  c.doc.visibilityState = 'hidden';   // não abre o fluxo neste teste
  await c.P.presencaAtualizar();
  assert.deepEqual(anotados(c, 'presenca.lista'), [{ via: 'pedido', online: 1, conversas: 0, naoLidas: 0, wme: CONTAGEM.online, chat: CONTAGEM.conversas }]);
  // A mesma lista de carona, três ações seguidas: nenhuma linha nova.
  for (let i = 0; i < 3; i++) c.P.presencaAoCarona({ online: resposta.online, conversas: [], contagem: CONTAGEM }, Date.now());
  assert.equal(anotados(c, 'presenca.lista').length, 1, 'a carona repetida virou linha no diário');
  // Só o total do WME andou (gente entrando e saindo do WME, ninguém no app):
  // não é notícia — anda a cada minuto.
  for (const noWme of [41, 39, 52]) {
    c.P.presencaAoCarona({ online: resposta.online, conversas: [], contagem: { ...CONTAGEM, online: { ...CONTAGEM.online, noWme } } }, Date.now());
  }
  assert.equal(anotados(c, 'presenca.lista').length, 1, 'o total do WME mudando virou linha no diário');
  // Mudou (alguém saiu do app): uma linha, dizendo por onde chegou.
  c.P.presencaAoCarona({ online: [], conversas: [], contagem: { ...CONTAGEM, online: { noWme: 47, comMarca: 2, noPais: 0 } } }, Date.now());
  assert.deepEqual(anotados(c, 'presenca.lista').at(-1), { via: 'carona', online: 0, conversas: 0, naoLidas: 0,
    wme: { noWme: 47, comMarca: 2, noPais: 0 }, chat: CONTAGEM.conversas });
  // Falhou duas vezes do mesmo jeito: uma linha só.
  resposta = { success: false, errorCategory: 'transient' };
  await c.P.presencaAtualizar();
  await c.P.presencaAtualizar();
  assert.deepEqual(anotados(c, 'presenca.lista').slice(2), [{ via: 'pedido', falhou: 'transient' }]);
  // E a lista que volta depois da falha é linha de novo, mesmo igual à de antes.
  resposta = { success: true, online: [], conversas: [], contagem: { ...CONTAGEM, online: { noWme: 47, comMarca: 2, noPais: 0 } } };
  await c.P.presencaAtualizar();
  assert.equal(anotados(c, 'presenca.lista').length, 4, 'a lista que voltou depois da falha não entrou');
});

test('diário: o TOKEN do tempo real — veio ou não, e quando vence; nunca o token', async () => {
  // `c.relogio`: o relógio do cliente é manual, e a conta das horas é feita nele.
  const c = novoCliente({ api: { presencaApp: () => ({ success: true, online: [], conversas: [],
    chat: { token: 'TOKEN_UNICO', base: 'https://x/', chave: 'CHAVE_UNICA', expiraEm: c.relogio.agora + 24 * 36e5 } }) } });
  c.doc.visibilityState = 'hidden';
  await c.P.presencaAtualizar();
  assert.deepEqual(anotados(c, 'presenca.token'), [{ veio: true, expiraEmH: 24 }]);
  // Com o token válido, o próximo pedido não pede outro — e não anota nada.
  await c.P.presencaAtualizar();
  assert.equal(anotados(c, 'presenca.token').length, 1, 'anotou token num pedido que não pediu token');
  // O servidor não deu token (o Waze recusou o provedor): a linha diz isso.
  const d = novoCliente({ api: { presencaApp: () => ({ success: true, online: [], conversas: [] }) } });
  d.doc.visibilityState = 'hidden';
  await d.P.presencaAtualizar();
  assert.deepEqual(anotados(d, 'presenca.token'), [{ veio: false, expiraEmH: null }]);
  for (const s of ['TOKEN_UNICO', 'CHAVE_UNICA']) assert.ok(!JSON.stringify(c.chamadas.dfato).includes(s), `o diário levou ${s}`);
});

test('diário: o tempo real — conectou uma vez; a religada normal não entra; a VOLTA depois de queda entra', () => {
  const c = novoCliente();
  const f = fluxoDe(c);
  c.P.presencaQuadro(f, { startOfBatch: {} });
  c.P.presencaQuadro(f, { endOfBatch: {} });
  assert.deepEqual(anotados(c, 'presenca.fluxo'), [{ ev: 'conectou' }]);
  // O Google fecha a cada ~6 min e o app religa: não é notícia.
  c.P.presencaQuadro(fluxoDe(c), { endOfBatch: {} });
  assert.equal(anotados(c, 'presenca.fluxo').length, 1, 'a religada normal virou linha');
  // Duas quedas e a volta.
  c.P.Presenca.fluxoDiag.ultimoErro = 'TypeError';
  c.P.presencaAnotarQueda(fluxoDe(c));
  c.P.presencaAnotarQueda(fluxoDe(c));
  c.P.presencaQuadro(fluxoDe(c), { endOfBatch: {} });
  assert.deepEqual(anotados(c, 'presenca.fluxo').at(-1), { ev: 'voltou', depoisDe: 2 });
  assert.equal(c.P.Presenca.fluxoDiag.quedasSeguidas, 0, 'a volta não zerou a série');
});

test('diário: numa série de quedas entram as 3 primeiras, cada troca de erro e uma a cada 10 — não 60 linhas iguais', () => {
  const c = novoCliente();
  const d = c.P.Presenca.fluxoDiag;
  d.ultimoErro = 'TypeError';
  for (let i = 0; i < 12; i++) c.P.presencaAnotarQueda(fluxoDe(c));
  assert.deepEqual(anotados(c, 'presenca.fluxo').map((o) => o.quedas), [1, 2, 3, 10]);
  d.ultimoErro = 'silencio';
  c.P.presencaAnotarQueda(fluxoDe(c));
  assert.deepEqual(anotados(c, 'presenca.fluxo').at(-1), { ev: 'caiu', erro: 'silencio', quedas: 13, durouS: Math.round(c.relogio.agora / 1000) });
  assert.equal(anotados(c, 'presenca.fluxo').length, 5, 'a troca de erro não entrou');
});

test('diário: a queda chega pelo caminho de verdade — fetch que falha, token recusado; o fim NORMAL não entra', async () => {
  const chat = { token: 'T', base: 'https://x/', chave: 'K', expiraEm: Date.now() + 86e6 };
  // Rede fora: o fetch rejeita.
  const c = novoCliente({ api: { fetch: () => Promise.reject(new TypeError('Failed to fetch')) } });
  c.P.Presenca.chat = chat;
  await c.P.presencaFluxoAbrir();
  assert.deepEqual(anotados(c, 'presenca.fluxo').map(({ ev, erro, quedas }) => ({ ev, erro, quedas })), [{ ev: 'caiu', erro: 'TypeError', quedas: 1 }]);
  // O Google recusou o token.
  const d = novoCliente({ api: { fetch: () => new Response('', { status: 401 }) } });
  d.P.Presenca.chat = { ...chat };
  await d.P.presencaFluxoAbrir();
  assert.equal(anotados(d, 'presenca.fluxo')[0].erro, 'token 401');
  // Controle: o fim normal (o Google fechou o array) não é queda.
  const e = novoCliente({ api: { fetch: () => new Response('[{"endOfBatch":{}}]') } });
  e.P.Presenca.chat = { ...chat };
  await e.P.presencaFluxoAbrir();
  assert.deepEqual(anotados(e, 'presenca.fluxo'), [{ ev: 'conectou' }], 'o fim normal virou queda (ou o fluxo nem leu o quadro)');
});

test('diário: mensagem que chega — AO VIVO no máximo uma linha por minuto, com quantas vieram juntas; do LOTE um número; a minha, a repetida e a do WME não', async () => {
  const c = novoCliente();
  c.P.Presenca.atualizadaEm = 1;
  const f = fluxoDe(c);
  const chegar = async (n) => c.P.presencaQuadro(f, inbox(await bytesDeMensagem({ id: uuid(100 + n), de: CAF, para: EU, texto: 'texto_privado_unico', ctx: APP, ts: 1790200000000 + n }), 100 + n));
  // Uma conversa animada: 45 mensagens no mesmo minuto viram UMA linha.
  for (let i = 0; i < 45; i++) await chegar(i);
  assert.deepEqual(anotados(c, 'chat.chegou'), [{ aoVivo: true, olhando: false, juntas: 1 }], 'a conversa animada encheu o diário');
  // A próxima, um minuto depois, entra — e diz quantas vieram desde a linha anterior.
  c.relogio.agora += 60_000;
  await chegar(45);
  assert.deepEqual(anotados(c, 'chat.chegou').at(-1), { aoVivo: true, olhando: false, juntas: 45 },
    'depois de um minuto a mensagem tem que entrar, com as que ficaram de fora contadas');
  // A repetida (o fluxo reentrega), a minha (o eco) e a de quem só usa o WME.
  c.P.presencaQuadro(f, inbox(await bytesDeMensagem({ id: uuid(100), de: CAF, para: EU, ctx: APP, ts: 1790200000000 }), 200));
  const d = novoCliente();
  const g2 = fluxoDe(d);
  d.P.presencaQuadro(g2, inbox(await bytesDeMensagem({ id: uuid(1), de: EU, para: CAF, texto: 'minha', ctx: APP }), 1));
  d.P.presencaQuadro(g2, inbox(await bytesDeMensagem({ id: uuid(2), de: '600', para: EU, texto: 'do WME' }), 2));
  assert.deepEqual(anotados(d, 'chat.chegou'), [], 'a minha ou a do WME virou "chegou"');
  assert.equal(d.P.Presenca.fluxoDiag.ignoradas, 1, 'a do WME não foi contada como deixada de lado');
  // O lote da reconexão: um número no fim dele, não uma linha por mensagem.
  const e = novoCliente();
  const h = fluxoDe(e);
  e.P.presencaQuadro(h, { startOfBatch: {} });
  for (let i = 0; i < 3; i++) e.P.presencaQuadro(h, inbox(await bytesDeMensagem({ id: uuid(300 + i), de: CAF, para: EU, ctx: APP, ts: 1790200000000 + i }), 300 + i));
  e.P.presencaQuadro(h, { endOfBatch: {} });
  assert.deepEqual(e.chamadas.dfato.map(([k, o]) => [k, o]), [['presenca.fluxo', { ev: 'conectou' }], ['chat.chegou', { lote: 3 }]]);
  // Nada de terceiro no anel sempre ligado: nem texto, nem id, nem nome.
  for (const s of ['texto_privado_unico', CAF, 'cafanha']) assert.ok(!JSON.stringify(c.chamadas.dfato).includes(s), `o diário levou ${s}`);
});

test('diário: abrir a conversa e mandar — o desfecho, o tamanho e a categoria; nunca o texto', async () => {
  let abrir = { success: true, mensagens: [
    { id: uuid(1), ts: 1000, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'oi', contexto: null },
    { id: uuid(2), ts: 2000, de: { tipo: 1, id: EU }, para: { tipo: 1, id: CAF }, classe: 'texto', texto: 'olá', contexto: null },
  ], maisAntigas: true };
  let enviar = { success: true, ts: 1790200000999 };
  const c = novoCliente({ api: { chat: (x) => (x.acao === 'abrir' ? abrir : enviar) } });
  c.P.presencaAbrirConversa(CAF);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(anotados(c, 'chat.abrir'), [{ ok: true, mensagens: 2, maisAntigas: true, pagina: 'primeira' }]);
  abrir = { success: false, errorCategory: 'transient' };
  await c.P.presencaCarregarConversa(CAF, { antes: uuid(1) });
  assert.deepEqual(anotados(c, 'chat.abrir').at(-1), { ok: false, categoria: 'transient', pagina: 'antiga' });
  c.P.presencaEnviar('mensagem_privada_unica', null);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(anotados(c, 'chat.envio'), [{ ok: true, bytes: 'mensagem_privada_unica'.length, comPedido: false, juntas: 1 }]);
  // Outro envio no mesmo minuto: conta, mas não vira linha.
  c.P.presencaEnviar('segunda', null);
  await new Promise((r) => setImmediate(r));
  assert.equal(anotados(c, 'chat.envio').length, 1, 'o envio que deu certo virou uma linha por mensagem');
  // A falha entra SEMPRE, mesmo no mesmo minuto.
  enviar = { success: false, errorCategory: 'transient' };
  c.P.presencaEnviar('outra', CARD);
  await new Promise((r) => setImmediate(r));
  const falha = anotados(c, 'chat.envio').at(-1);
  assert.equal(falha.ok, false, 'a falha de envio ficou de fora do diário');
  assert.equal(falha.categoria, 'transient');
  assert.equal(falha.comPedido, true);
  // Um minuto depois, o envio que deu certo entra, contando o que ficou de fora.
  enviar = { success: true, ts: 1790200000999 };
  c.relogio.agora += 60_000;
  c.P.presencaEnviar('terceira', null);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(anotados(c, 'chat.envio').at(-1), { ok: true, bytes: 'terceira'.length, comPedido: false, juntas: 2 });
  for (const s of ['mensagem_privada_unica', 'Padaria Estrela', CAF]) assert.ok(!JSON.stringify(c.chamadas.dfato).includes(s), `o diário levou ${s}`);
});

test('"Sair": resposta em voo que chega DEPOIS não recria o `waze_places_chat` (medido em produção)', () => {
  // 2026-09-25: conversar, sair, e a chave estava de volta no aparelho — com a
  // instalação, as conversas conhecidas e os ids a confirmar de quem saiu.
  const c = novoCliente();
  c.P.chatConhecer(['183164343']);
  assert.ok(c.armazenado.has('waze_places_chat'), 'CONTROLE: com sessão, a conversa conhecida é guardada');
  c.P.presencaEsquecer();
  assert.ok(!c.armazenado.has('waze_places_chat'));
  c.AppState.authenticated = false;             // o "Sair" já passou
  c.P.chatConhecer(['12444348']);               // a resposta que estava em voo
  c.P.chatGuardarAConfirmar('dc76ba10-b76e-11f1-ad63-37a65b87598a');
  c.P.chatMarcarLidaAte('12444348', Date.now());
  assert.ok(!c.armazenado.has('waze_places_chat'), 'a chave do chat voltou depois do "Sair"');
});

// ── auditoria de 2026-09-25 ────────────────────────────────────────────────
test('abrir: mensagem que chega com o `abrir` NO AR entra na conversa (e o "lida" só sai com ela na tela)', async () => {
  const c = novoCliente();
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  // A conversa começou a carregar e a resposta ainda não veio.
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: false, carregando: true, maisAntigas: false });
  const bytes = await bytesDeMensagem({ id: uuid(60), de: CAF, para: EU, texto: 'chegou no meio', ctx: APP, ts: 1790200000000 });
  c.P.presencaQuadro(fluxoDe(c), inbox(bytes, 60));
  assert.equal(c.P.Presenca.historico.get(CAF).msgs.length, 1, 'a mensagem que chegou no meio do carregamento sumiu da conversa');
  // Com a conversa ainda carregando, o "lida" não sai.
  await c.rodarTimers();
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'lida').length, 0, '"lida" de uma mensagem que ainda não estava na tela');
});

test('lida: só avança com a RESPOSTA — falhou, tenta de novo na próxima vez', async () => {
  let responde = { success: false, errorCategory: 'transient' };
  const c = novoCliente({ api: { chat: () => responde } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [{ id: uuid(70), ts: 1790200000000, meu: false, texto: 'oi' }], carregada: true });
  await c.P.presencaMarcarLida(CAF);
  assert.ok(!(c.P.Presenca.lidaEnviadaAte.get(CAF) > 0), 'o "lida" que FALHOU ficou dado como enviado');
  responde = { success: true };
  await c.P.presencaMarcarLida(CAF);
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'lida').length, 2, 'não tentou de novo depois da falha');
  assert.equal(c.P.Presenca.lidaEnviadaAte.get(CAF), 1790200000000);
});

test('fluxo: fim SEM lote e logo não é "normal" — não religa a cada 1 s pra sempre', async () => {
  const chat = { token: 'T', base: 'https://x/', chave: 'K', expiraEm: Date.now() + 86e6 };
  const c = novoCliente({ api: { fetch: () => new Response('[]') } });   // corpo vazio, fecha na hora
  c.P.Presenca.chat = chat;
  await c.P.presencaFluxoAbrir();
  const religa = c.timers.filter((x) => x.fn === c.P.presencaFluxoGarantir || /Garantir/.test(String(x.fn)));
  assert.ok(c.timers.every((x) => x.ms !== 1000), 'religou em 1 s depois de uma conexão que não viveu');
  assert.ok(anotados(c, 'presenca.fluxo').some((a) => a.ev === 'caiu' && a.erro === 'fim sem lote'), 'a queda sem lote não foi anotada');
  // CONTROLE: com um fim de lote, o fim é normal (religa em 1 s).
  const d = novoCliente({ api: { fetch: () => new Response('[{"endOfBatch":{}}]') } });
  d.P.Presenca.chat = { ...chat };
  await d.P.presencaFluxoAbrir();
  assert.ok(d.timers.some((x) => x.ms === 1000), 'o fim normal deixou de religar rápido');
  assert.ok(religa);
});
