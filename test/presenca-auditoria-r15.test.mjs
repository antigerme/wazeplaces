// A presença e a conversa depois da auditoria da rodada 15 (R15-5-01, R15-5-02 e
// R15-8-02). Os rótulos são os do relatório dessa rodada. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
//
// O instrumento é o js/presenca.js INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs`, como nas rodadas anteriores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const EU = '12444348';
const CAF = '183164343';
const OUTRA = '555000111';

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo real.
const chega = async (c, n) => c.P.presencaQuadro(fluxoDe(c), { inboxMessage: { messageId: uuid(900000 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
const doHistorico = (n) => ({ id: uuid(n), ts: T + n, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto',
  texto: 'msg ' + n, recibo: null, contexto: { app: 'wazeplaces' } });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pedidos = (c, desde = 0) => c.chamadas.chat.slice(desde).map((x) => x.acao + (x.com ? ':' + x.com : ''));
const lidaAte = (c) => (c.P.Presenca.lidaEnviadaAte.get(CAF) || 0) - T;
const FALHA = { success: false, errorCategory: 'transient', error: 'x', httpCode: 500 };

// ── R15-5-01: a primeira página da REABERTURA que falha ─────────────────────
// A conversa reaberta mostra o que chegou com ela fechada (o tempo real o juntou
// ao histórico), e quem o marca no Waze é o `abrir`. Com o histórico já na tela,
// a falha dele não aparece (nem "Tentar de novo"): nada mais marcava a mensagem.
async function reaberturaQueFalha(reabertura, { fecharAntes = true } = {}) {
  let n = 0;
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => {
    if (x.acao !== 'abrir') return { success: true };
    n += 1;
    if (n === 1) return { success: true, mensagens: [doHistorico(1)], maisAntigas: false, lida: true };
    return reabertura;
  } } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  fechar(c);
  await tick();
  c.relogio.agora = T + 2000; await chega(c, 2000);          // chega com a conversa FECHADA
  c.relogio.agora = T + 3000;
  const antes = c.chamadas.chat.length;
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick(); await tick();
  const r = {
    viuA2000: c.$('conversaMsgs').innerHTML.includes('msg 2000'),
    semErro: !c.$('conversaMsgs').innerHTML.includes('presenca.conversa.erro'),
    comAbertaAbrir: pedidos(c, antes),
    flag: !!c.P.Presenca.historico.get(CAF).primeiraFalhou,
  };
  const antesFechar = c.chamadas.chat.length;
  c.relogio.agora = T + 9000;
  if (fecharAntes) fechar(c);
  await tick(); await tick();
  r.noFechamento = pedidos(c, antesFechar);
  r.devendo = c.P.Presenca.lidaDevendo.has(CAF);
  r.lidaAte = lidaAte(c);
  return { c, r };
}

test('R15-5-01 a primeira página da reabertura que FALHA (com resposta): o fechamento marca como lida a mensagem que a reabertura mostrou — um "lida"', async () => {
  const { r } = await reaberturaQueFalha(FALHA);
  assert.equal(r.viuA2000, true, 'CONTROLE: a reabertura mostra a 2000 (o tempo real a juntou)');
  assert.equal(r.semErro, true, 'CONTROLE: com o histórico já na tela, a falha não aparece (é o que esconde o defeito)');
  assert.deepEqual(r.comAbertaAbrir, ['abrir:' + CAF], 'CONTROLE: aberta, só o `abrir` saiu (e falhou), nenhuma rajada');
  assert.equal(r.flag, true, 'a primeira página que falhou não ficou marcada');
  assert.deepEqual(r.noFechamento, ['lida:' + CAF], 'DEFEITO: fechada depois da falha, nada marcou a 2000, vista na reabertura');
  assert.equal(r.lidaAte, 2000, 'a 2000 não foi marcada como lida no Waze');
  assert.equal(r.devendo, false, 'a dívida paga ficou de pé');
});

test('R15-5-01 a falha SEM resposta (rede) também deixa de largar a mensagem vista', async () => {
  const { r } = await reaberturaQueFalha({ success: false, errorCategory: 'transient', error: 'x', _motivo: 'TypeError' });
  assert.deepEqual(r.noFechamento, ['lida:' + CAF], 'DEFEITO: a falha sem resposta largou a mensagem vista');
  assert.equal(r.lidaAte, 2000);
});

test('R15-5-01 CONTROLE: o `abrir` bom não deixa dívida nem "lida" a mais; e a primeira página boa depois da falha limpa a marca', async () => {
  const bom = { success: true, mensagens: [doHistorico(1), doHistorico(2000)], maisAntigas: false, lida: true };
  const { r } = await reaberturaQueFalha(bom);
  assert.equal(r.flag, false, 'CONTROLE: o `abrir` bom não marca falha');
  assert.deepEqual(r.noFechamento, [], 'CONTROLE: o `abrir` já marcou a 2000, o fechamento não manda "lida" a mais');
  assert.equal(r.lidaAte, 2000);
  // falha e depois acerto: a marca sai com a primeira página boa
  let n = 0;
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => {
    if (x.acao !== 'abrir') return { success: true };
    n += 1;
    if (n === 1) return { success: true, mensagens: [doHistorico(1)], maisAntigas: false, lida: true };
    if (n === 2) return FALHA;
    return { success: true, mensagens: [doHistorico(1), doHistorico(2000)], maisAntigas: false, lida: true };
  } } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  fechar(c); await tick();
  c.relogio.agora = T + 2000; await chega(c, 2000);
  c.P.presencaAbrirConversa(CAF); await tick(); await tick(); await tick();
  assert.equal(c.P.Presenca.historico.get(CAF).primeiraFalhou, true, 'a falha deixou a marca');
  fechar(c); await tick(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick(); await tick();
  assert.equal(c.P.Presenca.historico.get(CAF).primeiraFalhou, false, 'a primeira página boa não limpou a marca');
});

// ── R15-5-02: a dívida da conversa que NUNCA carregou nesta página ──────────
// A conversa abre pela 1ª vez com a primeira página no ar; a mensagem chega ao
// vivo e é VISTA; fecha (vira dívida); a primeira página falha; o primeiro gesto
// que paga dívidas tirava a dívida da memória e o `presencaMarcarLida` voltava
// sem mandar nada.
async function nuncaCarregou(primeira, { depoisDeFechar = null } = {}) {
  let soltar = null;
  const c = novoCliente({ agora: T + 10, api: {
    chat: (x) => {
      if (x.acao === 'abrir' && x.com === CAF) return new Promise((ok) => { soltar = ok; });
      if (x.acao === 'abrir') return { success: true, mensagens: [], maisAntigas: false, lida: true };
      return { success: true };
    },
  } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick();
  c.relogio.agora = T + 1000;
  await chega(c, 1000);                    // com a conversa NA TELA: vista
  await tick();
  c.relogio.agora = T + 3000;
  fechar(c);
  await tick();
  const r = { devendoAoFechar: c.P.Presenca.lidaDevendo.has(CAF) };
  if (depoisDeFechar) { c.relogio.agora = T + 3500; await depoisDeFechar(c); }
  c.relogio.agora = T + 4000;
  soltar(primeira);
  await tick(); await tick(); await tick();
  r.depoisDaPrimeira = pedidos(c, 1);
  // O gesto que paga dívidas: abrir e fechar a conversa com OUTRA pessoa.
  c.relogio.agora = T + 5000;
  const antes = c.chamadas.chat.length;
  c.P.presencaAbrirConversa(OUTRA);
  await tick(); await tick();
  fechar(c);
  await tick(); await tick();
  r.noGesto = pedidos(c, antes).filter((p) => p.startsWith('lida'));
  r.devendoDepois = c.P.Presenca.lidaDevendo.has(CAF);
  r.guardada = (c.guardado().devendo || {})[CAF] || null;
  r.lidaAte = lidaAte(c);
  return { c, r };
}

test('R15-5-02 a primeira página que FALHA com a conversa fechada devendo: o primeiro gesto que paga dívidas manda o "lida" (e não larga a dívida)', async () => {
  const { r } = await nuncaCarregou(FALHA);
  assert.equal(r.devendoAoFechar, true, 'CONTROLE: fechada com a primeira página no ar, a mensagem vista vira dívida');
  assert.deepEqual(r.depoisDaPrimeira, [], 'CONTROLE: a página que falha não paga nada');
  assert.deepEqual(r.noGesto, ['lida:' + CAF], 'DEFEITO: o gesto largou a dívida sem mandar o "lida"');
  assert.equal(r.lidaAte, 1000, 'a 1000, vista ao vivo, não foi marcada como lida no Waze');
  assert.equal(r.devendoDepois, false);
  assert.equal(r.guardada, null, 'paga, a dívida sai do aparelho');
});

test('R15-5-02 o "lida" que falha no gesto segue devendo (volta a dever), e a mensagem que chega FORA da vista antes do gesto tira a dívida — ninguém a viu (R7-5-01)', async () => {
  // a mensagem 3000 chega com a conversa fechada: a dívida sai e nada marca o que ninguém viu
  const { r } = await nuncaCarregou(FALHA, { depoisDeFechar: (c) => chega(c, 3000) });
  assert.equal(r.devendoAoFechar, true);
  assert.deepEqual(r.noGesto, [], 'a mensagem que ninguém viu foi marcada como lida junto');
  assert.equal(r.devendoDepois, false, 'a dívida de mensagem não vista ficou de pé');
});

test('R15-5-02 CONTROLE: a primeira página boa paga a dívida na chegada e o gesto não manda outro "lida"', async () => {
  const { r } = await nuncaCarregou({ success: true, mensagens: [], maisAntigas: false, lida: false });
  assert.ok(r.depoisDaPrimeira.includes('lida:' + CAF), 'CONTROLE: a dívida é paga quando a primeira página volta');
  assert.deepEqual(r.noGesto, [], 'CONTROLE: paga, o gesto não manda de novo');
});

// ── R15-8-02: a tirinha do pedido encolhe a lista ───────────────────────────
// "Mandar o pedido aberto" mostra a tirinha acima do campo e a lista encolhe
// (57 px no Fold): a rolagem não acompanhava, e a última mensagem ficava cortada.
function conversaComLista({ rolado }) {
  const c = novoCliente({ agora: T + 10, api: { chat: () => ({ success: true, mensagens: [doHistorico(1)], maisAntigas: false, lida: true }) } });
  c.win.cardParaConversa = () => ({ name: 'Padaria', address: 'Rua A', updateTypeKey: 'NEW_PLACE', categories: ['BAKERY'] });
  c.P.presencaMontar();
  const corpo = c.$('conversaMsgs');
  const tira = c.$('conversaAnexo');
  // A lista encolhe quando a tirinha aparece: 295 → 238 de caixa visível.
  corpo.scrollHeight = 1000;
  Object.defineProperty(corpo, 'clientHeight', { get: () => (tira.classList.contains('hidden') ? 295 : 238) });
  corpo.scrollTop = rolado === 'fim' ? 1000 - 295 : 120;
  return { c, corpo };
}

test('R15-8-02 prender o pedido com a lista no fim a mantém no fim — a última mensagem não fica cortada pela tirinha', async () => {
  const { c, corpo } = conversaComLista({ rolado: 'fim' });
  c.P.Presenca.aberta = CAF;
  c.$('conversaAnexo').classList.add('hidden');
  c.P.presencaAnexarCard();
  assert.equal(c.P.Presenca.anexo.name, 'Padaria', 'CONTROLE: o pedido foi preso');
  assert.equal(c.$('conversaAnexo').classList.contains('hidden'), false, 'CONTROLE: a tirinha apareceu (e a lista encolheu)');
  assert.equal(corpo.scrollTop, 1000, 'DEFEITO: a lista encolheu e a rolagem ficou onde estava — a última mensagem ficou escondida');
});

test('R15-8-02 CONTROLE: quem lia o começo da conversa não é arrancado pro fim ao prender o pedido', async () => {
  const { c, corpo } = conversaComLista({ rolado: 'meio' });
  c.P.Presenca.aberta = CAF;
  c.$('conversaAnexo').classList.add('hidden');
  c.P.presencaAnexarCard();
  assert.equal(corpo.scrollTop, 120, 'quem lia o começo foi levado ao fim');
});
