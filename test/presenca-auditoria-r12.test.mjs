// A presença e a conversa depois da auditoria da rodada 12 (R12-5): a pílula
// que dizia "2 mensagens novas" (uma já vista) com o "lida" no ar, o segundo
// "Enviar" sem o perfil que reescrevia a mesma frase na região viva sem limpar
// antes, a falha que o eco tirava da tela e não do leitor de tela, e a lista
// mais velha que punha de volta as conversas de antes depois da carona de outro
// país. Os rótulos R12-5-n são os do relatório dessa rodada. Cada teste foi
// visto REPROVANDO com o conserto desfeito.
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
// O ECO de uma mensagem MINHA (mesmo id), que o Waze guardou e o tempo real
// devolve a quem mandou.
const eco = async (c, m, ts) => c.P.presencaQuadro(fluxoDe(c), { inboxMessage: { messageId: uuid(800000 + ts), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: m.id, de: EU, para: CAF, texto: m.texto, ctx: { app: 'wazeplaces' }, ts: T + ts })) } });
// A lista do Waze: a conversa com a CAF, cuja ÚLTIMA mensagem é a `n` (hora
// `T + n`), com `naoLidas` não lidas.
const lista = (n, naoLidas) => ({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas, atividade: T + n,
  ultima: { deMim: false, ts: T + n, recibo: false, texto: 'msg ' + n, card: null } }] });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pilula = (c) => ({ selo: c.$('presencaCount').textContent, rotulo: c.$('presencaPill').getAttribute('aria-label') });
const conta = (c) => c.P.presencaNaoLidasDe(CAF);

// ── R12-5-01: com o "lida" no ar, a pílula com a vista contada ──────────────

// A conversa ABERTA: a 1 chega com ela na tela (vista), e ela fecha — o "lida"
// da 1 sai e fica NO AR (o Waze lento). A carona de uma ação SAI depois dele
// (`T + 3500`) e é lida no Waze ANTES de ele ser processado, já com a resposta
// da CAF (a `n`) guardada: conta a 1 (vista) e a resposta — 2. A resposta chega
// pelo tempo real DEPOIS da lista (`listaPrimeiro`, o defeito) ou antes (o
// controle, a régua de sempre). `lote`: ela vem no lote da reconexão.
async function lidaNoArComResposta({ ordem, n = 3600, lote = false }) {
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
  const r = { noAr: typeof soltar === 'function' };
  const aplicar = () => c.P.presencaAoCarona(lista(n, 2), T + 3500, 30);
  if (ordem === 'listaPrimeiro') {
    c.relogio.agora = T + 4000; aplicar(); await tick();
    r.depoisDaLista = conta(c);
    c.relogio.agora = T + 4500; await chega(c, n, { lote }); await tick();
    r.depoisDaResposta = conta(c);
  } else {
    c.relogio.agora = T + 3700; await chega(c, n, { lote }); await tick();
    r.depoisDaResposta = conta(c);
    c.relogio.agora = T + 4000; aplicar(); await tick();
    r.depoisDaLista = conta(c);
  }
  r.pilula = pilula(c);
  // E fica assim enquanto o "lida" voa (o Waze lento: até 45 s).
  c.relogio.agora = T + 30_000; await tick();
  r.aos30s = conta(c);
  if (r.noAr) { soltar({ success: true }); await tick(); await tick(); }
  r.depoisDoLida = conta(c);
  return r;
}

test('R12-5-01 com o "lida" no ar, a resposta que a lista contou junto com a vista conta UMA assim que chega — sem esperar o "lida" voltar', async () => {
  const r = await lidaNoArComResposta({ ordem: 'listaPrimeiro' });
  assert.equal(r.noAr, true, 'CONTROLE: o "lida" do fechamento tinha que estar no ar');
  assert.equal(r.depoisDaLista, 2, 'CONTROLE: antes da resposta, a lista conta a vista e a resposta — o histórico ainda não a explica');
  assert.equal(r.depoisDaResposta, 1, 'DEFEITO: com a resposta no histórico, a pílula seguiu dizendo "2 mensagens novas" (uma já vista) — a conta da lista não foi refeita');
  assert.equal(r.pilula.selo, '1', `a pílula mostrou ${r.pilula.selo}`);
  assert.equal(r.pilula.rotulo, 'presenca.pill.msg{"n":1}', 'o nome da pílula disse o plural');
  assert.equal(r.aos30s, 1, 'com o "lida" ainda no ar (30 s), a conta voltou a 2');
  assert.equal(r.depoisDoLida, 1, 'o "lida" que voltou mexeu na conta da resposta que ninguém viu');
  // CONTROLE: a resposta pelo tempo real ANTES da lista — a régua que já
  // existia (a recontagem na chegada da lista) dá 1 o tempo todo.
  const k = await lidaNoArComResposta({ ordem: 'respostaPrimeiro' });
  assert.deepEqual([k.depoisDaResposta, k.depoisDaLista, k.aos30s, k.depoisDoLida], [1, 1, 1, 1], 'CONTROLE: com a resposta antes da lista, a conta tinha que ser 1 o tempo todo');
});

test('R12-5-01 pelo LOTE: a resposta guardada antes de a lista sair, entregue na reconexão DEPOIS dela, também refaz a conta', async () => {
  // A 3200 foi guardada ANTES de a lista sair (T + 3500): a régua de sempre a
  // deixa fora das vivas (a lista já a contou) — mas a conta da lista, com a
  // vista dentro, ficava 2 até o "lida" voltar.
  const r = await lidaNoArComResposta({ ordem: 'listaPrimeiro', n: 3200, lote: true });
  assert.equal(r.noAr, true, 'CONTROLE: o "lida" do fechamento tinha que estar no ar');
  assert.equal(r.depoisDaLista, 2, 'CONTROLE: antes do lote, a lista conta a vista e a resposta');
  assert.equal(r.depoisDaResposta, 1, 'DEFEITO: a resposta chegou no lote e a pílula seguiu dizendo "2 mensagens novas" (uma já vista)');
  assert.equal(r.aos30s, 1);
  assert.equal(r.depoisDoLida, 1);
  const k = await lidaNoArComResposta({ ordem: 'respostaPrimeiro', n: 3200, lote: true });
  assert.deepEqual([k.depoisDaResposta, k.depoisDaLista, k.depoisDoLida], [1, 1, 1], 'CONTROLE: com o lote antes da lista, a conta tinha que ser 1');
});

test('R12-5-01 a conta refeita na chegada da resposta não come a mensagem que só a LISTA conhece', async () => {
  // A lista conta a 1 (vista), a 3600 e a 3700. A 3600 chega; a 3700 ainda
  // não: o histórico não explica a lista (a última dela, a 3700, não está
  // aqui), e a conta não pode cair abaixo das duas que ninguém viu.
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
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3700, 3), T + 3500, 30); await tick();
  c.relogio.agora = T + 4500; await chega(c, 3600); await tick();
  assert.ok(conta(c) >= 2, `a conta refeita perdeu a resposta que só a lista conhece: ${conta(c)}`);
  c.relogio.agora = T + 4600; await chega(c, 3700); await tick();
  assert.equal(conta(c), 2, 'com as duas respostas no histórico, a conta tinha que ser as duas que ninguém viu');
  soltar({ success: true });
  await tick(); await tick();
  assert.equal(conta(c), 2, 'o "lida" que voltou mexeu nas respostas que ninguém viu');
});

// ── R12-5-02: o segundo "Enviar" sem o perfil, na região viva ───────────────

// A frase que a TELA mostra (o texto antes do "Tentar de novo") e o que a região
// viva da conversa diz.
const fraseNaTela = (c) => {
  const m = /<p class="conversa-falhou">([^<]*) <button/.exec(c.$('conversaMsgs').innerHTML);
  return m ? m[1] : null;
};
const anuncio = (c) => c.$('conversaAnuncio').textContent;
// Os relógios da frase a caminho da região (os de `PRESENCA_ANUNCIO_DE_NOVO_MS`),
// e rodá-los — só eles: o resto (a rajada do "lida") não é desta medição.
const aCaminho = (c) => c.timers.filter((x) => x.ms === c.P.PRESENCA_ANUNCIO_DE_NOVO_MS);
async function rodarAFrase(c) {
  for (const x of aCaminho(c)) { c.timers.splice(c.timers.indexOf(x), 1); await x.fn(); }
}

// A conversa com a CAF aberta (o histórico chegou), e o perfil que some (a
// renovação silenciosa da sessão): o "Enviar" não manda, e a mensagem entra
// como "Não enviada." (R6-5-5). `escritas` guarda CADA escrita na região viva
// — o que um leitor de tela veria mudar.
async function semPerfil({ enviar = () => ({ success: true }) } = {}) {
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
    ? { success: true, mensagens: [], maisAntigas: false, lida: true } : x.acao === 'enviar' ? enviar(x) : { success: true }) } });
  const el = c.$('conversaAnuncio');
  const escritas = [];
  let v = el.textContent;
  Object.defineProperty(el, 'textContent', { get: () => v, set: (x) => { escritas.push(String(x)); v = String(x); }, configurable: true });
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  const perfil = c.AppState.profile;
  c.AppState.profile = null;
  return { c, escritas, voltarOPerfil: () => { c.AppState.profile = perfil; } };
}

test('R12-5-02 sem o perfil, o segundo "Enviar" LIMPA a região viva e diz a falha de novo numa tarefa à parte — não reescreve a mesma frase', async () => {
  const { c, escritas } = await semPerfil();
  c.P.presencaEnviar('a', null);
  assert.equal(anuncio(c), 'presenca.recibo.naoEnviadaErro', 'CONTROLE: o primeiro "Enviar" diz a falha na hora (R11-5-03)');
  const antes = escritas.length;
  c.P.presencaEnviar('b', null);
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'enviar').length, 0, 'CONTROLE: sem o perfil, nada sai');
  assert.equal(c.P.Presenca.historico.get(CAF).msgs.filter((m) => m.estado === 'falhou').length, 2, 'CONTROLE: as duas entram como "Não enviada."');
  assert.deepEqual(escritas.slice(antes), [''], 'DEFEITO: o segundo "Enviar" reescreveu a MESMA frase na região viva sem limpar antes (ou limpou e escreveu no mesmo tique)');
  assert.ok(c.P.PRESENCA_ANUNCIO_DE_NOVO_MS > 0 && aCaminho(c).length === 1, 'a frase não ficou a caminho numa tarefa à parte');
  await rodarAFrase(c);
  assert.deepEqual(escritas.slice(antes), ['', 'presenca.recibo.naoEnviadaErro'], 'a falha do segundo "Enviar" não foi dita de novo depois da região limpa');
  assert.equal(anuncio(c), fraseNaTela(c), 'a região não diz a mesma frase da tela');
});

test('R12-5-02 a frase a caminho: o terceiro "Enviar" só a adia (a região já está limpa), e a tentativa com o perfil de volta não a deixa falar por cima', async () => {
  // O terceiro "Enviar" no meio do atraso: a região foi limpa pelo segundo, e
  // escrever já seria limpar e escrever sem o atraso no meio.
  const a = await semPerfil();
  a.c.P.presencaEnviar('a', null);
  a.c.P.presencaEnviar('b', null);
  const depoisDoSegundo = a.escritas.length;
  a.c.P.presencaEnviar('c', null);
  assert.deepEqual(a.escritas.slice(depoisDoSegundo), [''], 'o terceiro "Enviar" escreveu a frase sem o atraso depois da região limpa');
  assert.equal(aCaminho(a.c).length, 1, 'ficou mais de uma frase a caminho');
  await rodarAFrase(a.c);
  assert.equal(anuncio(a.c), 'presenca.recibo.naoEnviadaErro', 'a frase a caminho não chegou');
  // O perfil volta no meio do atraso e a pessoa manda OUTRA mensagem, que dá
  // certo: a tentativa começa calada, e o envio que deu certo não deixa a falha
  // pra trás (R11-5-03) — a frase que estava a caminho não fala depois dele.
  const b = await semPerfil({ enviar: () => ({ success: true, ts: T + 50 }) });
  b.c.P.presencaEnviar('a', null);
  b.c.P.presencaEnviar('b', null);
  assert.equal(aCaminho(b.c).length, 1, 'CONTROLE: a frase do segundo "Enviar" tinha que estar a caminho');
  b.voltarOPerfil();
  b.c.P.presencaEnviar('com o perfil', null);
  await tick(); await tick();
  assert.equal(b.c.chamadas.chat.filter((x) => x.acao === 'enviar').length, 1, 'CONTROLE: com o perfil de volta, a mensagem nova sai');
  await rodarAFrase(b.c);
  assert.equal(anuncio(b.c), '', 'a falha do "Enviar" sem o perfil falou por cima do envio que deu certo');
});

// ── R12-5-03: a falha que o eco tira da tela sai do leitor de tela ──────────

// A conversa com a CAF aberta; `enviar` responde cada envio, na ordem.
async function aberta({ enviar = [], abrir = () => ({ success: true, mensagens: [], maisAntigas: false, lida: true }) } = {}) {
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir' ? abrir(x) : x.acao === 'enviar' ? enviar.shift() : { success: true }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  return c;
}
const minhas = (c) => c.P.Presenca.historico.get(CAF).msgs.filter((m) => m.meu);

test('R12-5-03 o envio sem resposta que o Waze GUARDOU: o eco tira "Não enviada" da tela E da região viva', async () => {
  for (const [resposta, chave] of [[SEM_REDE, 'presenca.recibo.naoEnviada'], [WAZE_FORA, 'presenca.recibo.naoEnviadaErro']]) {
    const c = await aberta({ enviar: [resposta] });
    c.P.presencaEnviar('é a fachada?', null);
    await tick(); await tick();
    assert.equal(fraseNaTela(c), chave, `CONTROLE: a tela tinha que mostrar "${chave}"`);
    assert.equal(anuncio(c), chave, 'CONTROLE: a região diz a falha (R11-5-03)');
    c.relogio.agora = T + 5000;
    await eco(c, minhas(c)[0], 4000);
    await tick();
    assert.deepEqual(minhas(c).map((m) => m.estado), ['enviada'], 'CONTROLE: o eco tinha que fazer a mensagem "Enviada"');
    assert.equal(fraseNaTela(c), null, 'CONTROLE: a tela tinha que tirar a linha de falha');
    assert.equal(anuncio(c), '', `DEFEITO: a tela diz "Enviada" e a região viva segue dizendo "${chave}"`);
  }
});

test('R12-5-03 o HISTÓRICO que traz a mensagem guardada também tira a falha da região viva', async () => {
  // O envio falha (sem resposta) com o histórico ainda carregando; o histórico
  // chega com a mensagem que o Waze guardou.
  let soltarAbrir = null;
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir' ? new Promise((ok) => { soltarAbrir = ok; })
    : x.acao === 'enviar' ? SEM_REDE : { success: true }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.equal(typeof soltarAbrir, 'function', 'CONTROLE: o histórico tinha que estar carregando');
  c.P.presencaEnviar('é a fachada?', null);
  await tick(); await tick();
  assert.equal(anuncio(c), 'presenca.recibo.naoEnviada', 'CONTROLE: a falha foi dita');
  const m = minhas(c)[0];
  soltarAbrir({ success: true, maisAntigas: false, lida: true, mensagens: [
    { id: m.id, ts: T + 4000, de: { tipo: 1, id: EU }, para: { tipo: 1, id: CAF }, classe: 'texto', texto: m.texto, recibo: null, contexto: { app: 'wazeplaces' } }] });
  await tick(); await tick();
  assert.equal(m.estado, 'enviada', 'CONTROLE: o histórico tinha que fazer a mensagem "Enviada"');
  assert.equal(fraseNaTela(c), null, 'CONTROLE: a tela tinha que tirar a linha de falha');
  assert.equal(anuncio(c), '', 'DEFEITO: o histórico trouxe a mensagem guardada e a região viva seguiu dizendo "Não enviada, sem sinal."');
});

test('R12-5-03 a região diz a falha que a TELA mostra, ou nada: a que segue na tela fica, e o que não é falha do envio também', async () => {
  // Duas falhas com a MESMA frase; o eco tira a última, e a tela segue dizendo
  // a mesma frase pela outra: a região também.
  const a = await aberta({ enviar: [SEM_REDE, SEM_REDE] });
  a.P.presencaEnviar('primeira', null); await tick(); await tick();
  a.P.presencaEnviar('segunda', null); await tick(); await tick();
  a.relogio.agora = T + 5000;
  await eco(a, minhas(a)[1], 4000);
  await tick();
  assert.equal(fraseNaTela(a), 'presenca.recibo.naoEnviada', 'CONTROLE: a primeira segue falhada na tela');
  assert.equal(anuncio(a), 'presenca.recibo.naoEnviada', 'a região calou a falha que a tela ainda mostra');
  // Frases DIFERENTES: a última dizia "sem sinal" e o eco a tirou — a tela
  // passa a dizer a da outra, e a região não pode seguir dizendo a que sumiu.
  const b = await aberta({ enviar: [WAZE_FORA, SEM_REDE] });
  b.P.presencaEnviar('primeira', null); await tick(); await tick();
  b.P.presencaEnviar('segunda', null); await tick(); await tick();
  assert.equal(anuncio(b), 'presenca.recibo.naoEnviada', 'CONTROLE: a região diz a falha da última');
  b.relogio.agora = T + 5000;
  await eco(b, minhas(b)[1], 4000);
  await tick();
  assert.equal(fraseNaTela(b), 'presenca.recibo.naoEnviadaErro', 'CONTROLE: a tela passa a dizer a falha da primeira');
  assert.equal(anuncio(b), '', 'a região seguiu dizendo "sem sinal", que a tela já não mostra');
  // A mensagem que CHEGOU, anunciada depois da falha, segue dita quando o eco
  // tira a falha: só a frase de falha do envio é calada.
  const c = await aberta({ enviar: [SEM_REDE] });
  c.P.presencaEnviar('primeira', null); await tick(); await tick();
  c.relogio.agora = T + 3000;
  await chega(c, 2500);
  await tick();
  const dita = anuncio(c);
  assert.match(dita, /^presenca\.conversa\.anuncio/, 'CONTROLE: a mensagem que chegou na conversa aberta foi anunciada');
  c.relogio.agora = T + 5000;
  await eco(c, minhas(c)[0], 4000);
  await tick();
  assert.equal(fraseNaTela(c), null, 'CONTROLE: a tela tirou a linha de falha');
  assert.equal(anuncio(c), dita, 'o eco calou o anúncio da mensagem que chegou');
});
