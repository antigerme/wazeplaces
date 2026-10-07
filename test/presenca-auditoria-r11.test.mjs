// A presença e a conversa depois da auditoria da rodada 11 (R11-5): a resposta
// que a LISTA já contou e o tempo real entrega depois dela contada duas vezes,
// o envio (e o histórico) que FALHA sem chegar ao leitor de tela, e a pílula que
// some com o foco do teclado nela. Os rótulos R11-5-n são os do relatório dessa
// rodada. Cada teste foi visto REPROVANDO com o conserto desfeito.
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
const SEM_REDE = { success: false, errorCategory: 'transient', _motivo: 'TypeError' };
// O Waze fora com a rede boa: a resposta CHEGA (sem `_motivo`).
const WAZE_FORA = { success: false, errorCategory: 'transient', httpCode: 200 };

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c, emLote = false) => ({ ctl: new AbortController(), emLote, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo
// real — ao vivo, ou no LOTE que abre toda conexão (a reconexão reentrega).
const chega = async (c, n, { lote = false } = {}) => c.P.presencaQuadro(fluxoDe(c, lote), { inboxMessage: { messageId: uuid(900000 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
// A lista do Waze: a conversa com a CAF, cuja ÚLTIMA mensagem é a `n` (hora
// `T + n`), com `naoLidas` não lidas.
const lista = (n, naoLidas) => ({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas, atividade: T + n,
  ultima: { deMim: false, ts: T + n, recibo: false, texto: 'msg ' + n, card: null } }] });
const doHistorico = (n) => ({ id: uuid(n), ts: T + n, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto',
  texto: 'msg ' + n, recibo: null, contexto: { app: 'wazeplaces' } });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pilula = (c) => ({ escondida: c.$('presencaPill').classList.contains('hidden'),
  balao: !c.$('presencaIconMsg').classList.contains('hidden'), selo: c.$('presencaCount').textContent,
  rotulo: c.$('presencaPill').getAttribute('aria-label') });
const conta = (c) => c.P.presencaNaoLidasDe(CAF);

// ── R11-5-01: a resposta contada pela lista E pelo tempo real ──────────────

// A conversa com a CAF já existia (a 3, lida). A carona de uma ação SAI em
// `T + 4000`, e a CAF manda a resposta (a 4200) depois de o pedido sair e
// antes de o Waze ler a lista: a lista a CONTA. O tempo real a entrega DEPOIS
// de a lista ser aplicada (`listaPrimeiro`, o defeito) ou antes (o caso que a
// régua da lista já cobria). `guardadaAntes`: a resposta guardada antes de o
// pedido sair (a 3900), no lote — a régua de sempre.
async function respostaContada({ ordem, lote = false, guardadaAntes = false }) {
  const c = novoCliente({ agora: T + 1000 });
  c.P.presencaAoCarona(lista(3, 0), T + 900, 30);
  const n = guardadaAntes ? 3900 : 4200;
  const aplicar = () => c.P.presencaAoCarona(lista(n, 1), T + 4000, 30);
  if (ordem === 'listaPrimeiro') {
    c.relogio.agora = T + 4500; aplicar(); await tick();
    c.relogio.agora = T + 4700; await chega(c, n, { lote }); await tick();
  } else {
    c.relogio.agora = T + 4330; await chega(c, n, { lote }); await tick();
    c.relogio.agora = T + 4500; aplicar(); await tick();
  }
  const r = { conta: conta(c), pilula: pilula(c) };
  c.relogio.agora = T + 40_000;
  c.P.presencaAoCarona(lista(n, 1), T + 39_000, 30);         // a lista seguinte (outra carona)
  await tick();
  return { ...r, seguinte: conta(c) };
}

test('R11-5-01 a resposta que a LISTA já contou e o tempo real entrega DEPOIS dela conta UMA vez — ao vivo e no lote', async () => {
  for (const lote of [false, true]) {
    const r = await respostaContada({ ordem: 'listaPrimeiro', lote });
    const como = lote ? 'no lote' : 'ao vivo';
    assert.equal(r.conta, 1, `DEFEITO (${como}): a resposta contada pela lista contou de novo pelo tempo real — "2 mensagens novas" com uma só`);
    assert.equal(r.pilula.selo, '1', `${como}: a pílula mostrou ${r.pilula.selo}`);
    assert.equal(r.pilula.rotulo, 'presenca.pill.msg{"n":1}', `${como}: o nome da pílula disse o plural`);
    assert.equal(r.seguinte, 1, `${como}: a lista seguinte não ficou em 1`);
    // CONTROLE: o tempo real ANTES da lista (a régua que já existia) — 1.
    const k = await respostaContada({ ordem: 'fluxoPrimeiro', lote });
    assert.equal(k.conta, 1, `CONTROLE (${como}): o tempo real antes da lista tinha que contar 1`);
    assert.equal(k.seguinte, 1);
  }
  // CONTROLE: a resposta guardada ANTES de o pedido da lista sair, reentregue
  // no lote depois dela — a régua de sempre (`atualizadaEm`) já a deixava fora.
  const g = await respostaContada({ ordem: 'listaPrimeiro', lote: true, guardadaAntes: true });
  assert.equal(g.conta, 1, 'CONTROLE: a resposta guardada antes de a lista sair tinha que contar 1');
});

test('R11-5-01 a régua da lista só leva o que ELA contou: a mensagem depois dela, e a que ela não conta mais, seguem contando', async () => {
  // A lista conta a 4200. A 5000 (hora DEPOIS da régua da lista) chega ANTES
  // da 4200: é nova — 2. A régua é a GUARDADA: a `atividade` da conversa a
  // prévia já reescreveu com a hora da própria 5000.
  const c = novoCliente({ agora: T + 1000 });
  c.P.presencaAoCarona(lista(3, 0), T + 900, 30);
  c.relogio.agora = T + 4500; c.P.presencaAoCarona(lista(4200, 1), T + 4000, 30); await tick();
  c.relogio.agora = T + 4700; await chega(c, 5000); await tick();
  assert.equal(conta(c), 2, 'DEFEITO: a mensagem com hora DEPOIS da régua da lista foi tomada como contada por ela');
  // A 4200, que a lista contou, chega depois: segue 2.
  c.relogio.agora = T + 5200; await chega(c, 4200); await tick();
  assert.equal(conta(c), 2, 'a resposta contada pela lista contou de novo (ou sumiu) depois de uma mensagem nova');
  // A lista contou a 4200, mas a conversa estava NA TELA: a conta dela vale
  // zero ("olhando é lida"). Fechada antes de a 4200 chegar, a 4200 é nova —
  // e ninguém a viu: conta 1.
  const d = novoCliente({ agora: T + 1000, api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [], maisAntigas: false, lida: true } : { success: true }) } });
  d.P.presencaAoCarona(lista(3, 0), T + 900, 30);
  d.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  d.relogio.agora = T + 4500; d.P.presencaAoCarona(lista(4200, 1), T + 4000, 30); await tick();
  assert.equal(conta(d), 0, 'CONTROLE: com a conversa na tela, a lista tinha que valer zero');
  fechar(d);
  d.relogio.agora = T + 4700; await chega(d, 4200); await tick();
  assert.equal(conta(d), 1, 'a resposta que ninguém viu, chegada com a conversa fechada, deixou de contar (a régua levou de uma conta já zerada)');
});

// A conversa ABERTA: a 1 chega com ela na tela (vista), e ela fecha — o "lida"
// da 1 sai e fica no AR (o Waze lento). A carona de uma ação saiu ANTES dele
// (`T + 2000`) e é lida no Waze DEPOIS de ele ser processado e de a CAF
// responder (a 3500): a lista conta só a resposta. O tempo real a entrega com a
// conversa fechada, e o "lida" volta.
test('R11-5-01 a resposta que a lista contou, entregue depois dela, NÃO SOME quando o "lida" que saiu depois da lista volta', async () => {
  let soltar = null;
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') return { success: true, mensagens: [], maisAntigas: false, lida: true };
    if (x.acao === 'lida') return new Promise((ok) => { soltar = ok; });
    return { success: true };
  } } });
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  c.relogio.agora = T + 1000; await chega(c, 1);            // vista
  c.relogio.agora = T + 3000; fechar(c); await tick();       // o "lida" da 1 sai (e fica no ar)
  assert.equal(typeof soltar, 'function', 'CONTROLE: o "lida" do fechamento tinha que estar no ar');
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3500, 1), T + 2000, 30); await tick();
  assert.equal(conta(c), 1, 'CONTROLE: a lista conta a resposta');
  c.relogio.agora = T + 4500; await chega(c, 3500); await tick();
  assert.equal(conta(c), 1, 'DEFEITO: a resposta contada pela lista contou de novo pelo tempo real');
  soltar({ success: true });
  await tick(); await tick();
  // O "lida" (que saiu DEPOIS da lista) zera a conta dela — e a resposta, que
  // chegou depois dele, segue contando: ela não pode ter ido junto.
  assert.equal(conta(c), 1, 'DEFEITO: a resposta que ninguém viu SUMIU com o "lida" que voltou (ela tinha ficado fora da conta)');
  assert.equal(pilula(c).balao, true, 'a pílula perdeu o balão da resposta');
  // A lista seguinte (o Waze ainda conta a resposta) segue em 1.
  c.relogio.agora = T + 6000; c.P.presencaAoCarona(lista(3500, 1), T + 5000, 30); await tick();
  assert.equal(conta(c), 1);
});

test('R11-5-01 a lista que o Waze leu ANTES da resposta, chegando depois dela, não a esquece', async () => {
  const c = novoCliente({ agora: T + 1000 });
  c.P.presencaAoCarona(lista(3, 0), T + 900, 30);
  // A carona que saiu em T + 4000, lida depois da resposta (a conta).
  c.relogio.agora = T + 4500; c.P.presencaAoCarona(lista(4200, 1), T + 4000, 30); await tick();
  c.relogio.agora = T + 4700; await chega(c, 4200); await tick();
  assert.equal(conta(c), 1, 'CONTROLE: a resposta contada pela lista conta 1');
  // Outra lista, que saiu DEPOIS (T + 4100) mas foi lida no Waze ANTES de a
  // resposta existir: ela não a conta. Chega agora, e vale (é a mais nova).
  c.relogio.agora = T + 5000; c.P.presencaAoCarona(lista(3, 0), T + 4100, 30); await tick();
  assert.equal(conta(c), 1, 'DEFEITO: a lista lida antes da resposta a apagou — a resposta que ninguém viu sumiu da pílula');
});

// A conversa ABERTA: a 1 chega com ela na tela, e ela fecha — o "lida" da 1
// sai e fica no AR. A carona sai DEPOIS dele (`T + 3500`) e é lida no Waze
// ANTES de ele ser processado: conta a 1 (vista) e a resposta (a 3600). O tempo
// real entrega a resposta, e o "lida" volta: a conta é refeita pelo histórico
// (R10-5-04) — que agora TEM a resposta, que já conta como viva.
test('R11-5-01 depois do "lida" que deu certo, a recontagem pelo histórico não conta de novo a resposta que já conta ao vivo', async () => {
  let soltar = null;
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') return { success: true, mensagens: [], maisAntigas: false, lida: true };
    if (x.acao === 'lida') return new Promise((ok) => { soltar = ok; });
    return { success: true };
  } } });
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  c.relogio.agora = T + 1000; await chega(c, 1);
  c.relogio.agora = T + 3000; fechar(c); await tick();
  assert.equal(typeof soltar, 'function', 'CONTROLE: o "lida" do fechamento tinha que estar no ar');
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3600, 2), T + 3500, 30); await tick();
  c.relogio.agora = T + 4500; await chega(c, 3600); await tick();
  assert.ok(conta(c) <= 2, `a resposta contou de novo pelo tempo real: ${conta(c)}`);
  soltar({ success: true });
  await tick(); await tick();
  assert.equal(conta(c), 1, 'DEFEITO: depois do "lida", a resposta contou pela lista refeita E pela viva — "2 mensagens novas" com uma só');
});

// ── R11-5-03: o que DEU ERRADO na conversa, pro leitor de tela ──────────────

// A frase que a TELA mostra (o texto antes do "Tentar de novo") e o que a região
// viva da conversa diz.
const fraseNaTela = (c, classe) => {
  const m = new RegExp(`<p class="${classe}">([^<]*) <button`).exec(c.$('conversaMsgs').innerHTML);
  return m ? m[1] : null;
};
const anuncio = (c) => c.$('conversaAnuncio').textContent;

// A conversa com a CAF aberta (o histórico chegou). `enviar` responde o envio;
// `naHora` guarda o que a região viva dizia quando cada envio SAIU.
async function conversaAberta({ enviar = () => ({ success: true }), abrir = () => ({ success: true, mensagens: [], maisAntigas: false, lida: true }) } = {}) {
  const naHora = [];
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') { naHora.push(['abrir', anuncio(c)]); return abrir(x); }
    if (x.acao === 'enviar') { naHora.push(['enviar', anuncio(c)]); return enviar(x); }
    return { success: true };
  } } });
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  return { c, naHora };
}

test('R11-5-03 o envio que FALHA diz ao leitor de tela a MESMA frase da tela — com e sem sinal', async () => {
  for (const [resposta, chave] of [[SEM_REDE, 'presenca.recibo.naoEnviada'], [WAZE_FORA, 'presenca.recibo.naoEnviadaErro']]) {
    const { c } = await conversaAberta({ enviar: () => resposta });
    assert.equal(anuncio(c), '', 'CONTROLE: a região viva começa calada');
    c.P.presencaEnviar('é a fachada?', null);
    await tick(); await tick();
    assert.equal(fraseNaTela(c, 'conversa-falhou'), chave, `CONTROLE: a tela tinha que mostrar "${chave}"`);
    assert.equal(anuncio(c), chave, `DEFEITO: a tela diz "${chave}" e o leitor de tela não ouve nada — o mesmo silêncio do envio que deu certo`);
  }
});

test('R11-5-03 o "Tentar de novo" começa calado: a mesma falha outra vez é dita outra vez — e o envio que dá certo não deixa a falha pra trás', async () => {
  const respostas = [SEM_REDE, SEM_REDE, { success: true, ts: T + 50 }];
  const { c, naHora } = await conversaAberta({ enviar: () => respostas.shift() });
  c.P.presencaEnviar('é a fachada?', null);
  await tick(); await tick();
  assert.equal(anuncio(c), 'presenca.recibo.naoEnviada');
  c.P.presencaTentarDeNovo();
  await tick(); await tick();
  const [, quandoSaiu] = naHora.filter(([acao]) => acao === 'enviar')[1];
  assert.equal(quandoSaiu, '', 'DEFEITO: a nova tentativa saiu com a falha anterior ainda na região viva — a mesma frase reescrita pode não ser lida de novo');
  assert.equal(anuncio(c), 'presenca.recibo.naoEnviada', 'a segunda falha não foi dita');
  c.P.presencaTentarDeNovo();
  await tick(); await tick();
  assert.equal(fraseNaTela(c, 'conversa-falhou'), null, 'CONTROLE: a terceira tentativa tinha que dar certo');
  assert.equal(anuncio(c), '', 'o envio que deu certo deixou "Não enviada" na região viva');
});

test('R11-5-03 a falha que volta com a conversa FECHADA (ou outra aberta) não fala na região da conversa', async () => {
  let soltar = null;
  const { c } = await conversaAberta({ enviar: () => new Promise((ok) => { soltar = ok; }) });
  c.P.presencaEnviar('é a fachada?', null);
  await tick();
  fechar(c);
  soltar(SEM_REDE);
  await tick(); await tick();
  assert.equal(anuncio(c), '', 'a falha de uma conversa fechada foi escrita na região viva');
  // Reaberta com OUTRA pessoa: a falha da conversa com a CAF não é dela.
  let soltar2 = null;
  const d = (await conversaAberta({ enviar: () => new Promise((ok) => { soltar2 = ok; }) })).c;
  d.P.presencaEnviar('é a fachada?', null);
  await tick();
  d.P.presencaAbrirConversa('999');
  await tick(); await tick();
  soltar2(SEM_REDE);
  await tick(); await tick();
  assert.equal(anuncio(d), '', 'a falha da conversa com a CAF foi dita na conversa com outra pessoa');
  // A conversa ESCONDIDA por outra camada (sem a limpeza dela): a região é
  // dela, e escondida não fala.
  let soltar3 = null;
  const e = (await conversaAberta({ enviar: () => new Promise((ok) => { soltar3 = ok; }) })).c;
  e.P.presencaEnviar('é a fachada?', null);
  await tick();
  e.$('conversaModal').classList.add('hidden');
  soltar3(SEM_REDE);
  await tick(); await tick();
  assert.equal(e.P.Presenca.aberta, CAF, 'CONTROLE: a conversa segue a aberta, só escondida');
  assert.equal(anuncio(e), '', 'a falha foi escrita na região de uma conversa escondida');
});

test('R11-5-03 sem o perfil, o "Enviar" que entra como "Não enviada." diz isso ao leitor de tela', async () => {
  const { c, naHora } = await conversaAberta();
  c.AppState.profile = null;
  c.P.presencaEnviar('é a fachada?', null);
  await tick();
  assert.equal(naHora.filter(([acao]) => acao === 'enviar').length, 0, 'CONTROLE: sem o perfil, nada sai');
  assert.equal(fraseNaTela(c, 'conversa-falhou'), 'presenca.recibo.naoEnviadaErro', 'CONTROLE: a tela mostra "Não enviada."');
  assert.equal(anuncio(c), 'presenca.recibo.naoEnviadaErro', 'DEFEITO: sem o perfil, a mensagem entrou como "Não enviada." em silêncio');
});

test('R11-5-03 o histórico que não carrega diz ao leitor de tela a MESMA frase da tela — e o "Tentar de novo" que falha outra vez, outra vez', async () => {
  const { c, naHora } = await conversaAberta({ abrir: () => WAZE_FORA });
  assert.equal(fraseNaTela(c, 'conversa-vazio'), 'presenca.conversa.erro', 'CONTROLE: a tela mostra que o histórico não veio');
  assert.equal(anuncio(c), 'presenca.conversa.erro', 'DEFEITO: o histórico não veio e o leitor de tela não ouviu nada');
  c.P.presencaCarregarConversa(CAF);                         // o "Tentar de novo"
  await tick(); await tick();
  assert.equal(naHora.filter(([acao]) => acao === 'abrir')[1][1], '', 'DEFEITO: o "Tentar de novo" saiu com a falha anterior ainda na região viva');
  assert.equal(anuncio(c), 'presenca.conversa.erro', 'a segunda falha do histórico não foi dita');
});

test('R11-5-03 a página ANTERIOR que não carrega é dita; a primeira página que falha com o histórico já na tela, não (a tela também não diz)', async () => {
  const respostas = [{ success: true, mensagens: [doHistorico(1)], maisAntigas: true, lida: true }, WAZE_FORA];
  const { c } = await conversaAberta({ abrir: () => respostas.shift() });
  assert.equal(anuncio(c), '', 'CONTROLE: o histórico chegou, nada a dizer');
  c.P.presencaCarregarAntigas(CAF);
  await tick(); await tick();
  assert.equal(fraseNaTela(c, 'conversa-vazio'), 'presenca.conversa.anterioresErro', 'CONTROLE: a tela mostra que as anteriores não vieram');
  assert.equal(anuncio(c), 'presenca.conversa.anterioresErro', 'DEFEITO: as mensagens anteriores não vieram e o leitor de tela não ouviu nada');
  // Reaberta, a primeira página falha — mas o histórico já está na tela, e a
  // tela não mostra erro nenhum: o leitor de tela também não ouve.
  respostas.push(WAZE_FORA);
  fechar(c);
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  assert.equal(fraseNaTela(c, 'conversa-vazio'), null, 'CONTROLE: com o histórico na tela, a falha da primeira página não aparece');
  assert.equal(anuncio(c), '', 'o leitor de tela ouviu uma falha que a tela não mostra');
});
