// A presença e a conversa depois da auditoria da rodada 13 (R13-5): a pílula
// que dizia "2 mensagens novas" (uma já vista) com o "lida" que JÁ VOLTOU — o
// caso irmão do R12-5-01, que só refazia a conta com ele no ar —, e o "Tentar
// de novo" do histórico na espera do perfil, que punha "Carregando…" na tela e
// deixava a falha no leitor de tela (irmão do R12-5-03 e do R11-5-03). E os
// dois irmãos dele achados no conserto (lote 17), no mesmo caminho da espera do
// perfil: a reabertura que trazia de volta o erro velho da página antiga, e o
// "Ver mensagens anteriores" que trocava a primeira página que esperava. Os
// rótulos R13-5-n são os do relatório dessa rodada. Cada teste foi visto
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
const pilula = (c) => ({ selo: c.$('presencaCount').textContent, rotulo: c.$('presencaPill').getAttribute('aria-label') });
const conta = (c) => c.P.presencaNaoLidasDe(CAF);

// ── R13-5-01: com o "lida" que JÁ VOLTOU, a pílula com a vista contada ──────

// A conversa ABERTA: a 1 chega com ela na tela (vista), e ela fecha — o "lida"
// da 1 sai (`T + 3000`) e fica no ar. A carona de uma ação SAI depois dele
// (`T + 3500`) e é lida no Waze ANTES de ele ser processado, já com a resposta
// da CAF (a `n`) guardada: conta a 1 (vista) e a resposta — 2. Os três passos
// seguintes vêm na `ordem` pedida, meio segundo um do outro: L, a lista (a
// carona) chega; V, o "lida" VOLTA (o caso comum: ele é rápido, e a carona
// espera a ação); R, a resposta chega pelo tempo real — ao vivo, ou no LOTE da
// reconexão (`lote`). Cada passo anota a conta que ficou depois dele.
async function lidaQueVolta({ ordem, n = 3600, naoLidas = 2, lote = false }) {
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
  const passos = {
    L: async () => { c.P.presencaAoCarona(lista(n, naoLidas), T + 3500, 30); await tick(); },
    V: async () => { soltar({ success: true }); await tick(); await tick(); },
    R: async () => { r.lidaNoArNaResposta = !!c.P.presencaLidaNoAr(CAF); await chega(c, n, { lote }); await tick(); },
  };
  let agora = 4000;
  for (const p of ordem) {
    c.relogio.agora = T + agora;
    agora += 500;
    await passos[p]();
    r[p] = conta(c);
  }
  r.pilula = pilula(c);
  r.voltou = c.P.Presenca.lidaVoltouEm.has(CAF);
  // Nada mais acontece (sem ação, sem lista nova): fica assim.
  c.relogio.agora = T + 60_000; await tick();
  r.aos60s = conta(c);
  return { c, r };
}

test('R13-5-01 o "lida" que JÁ VOLTOU: a resposta que a lista contou junto com a vista conta UMA assim que chega — sem esperar a lista seguinte', async () => {
  // VLR: o "lida" volta antes de a lista chegar (o caso do relatório); LVR: a
  // lista chega com ele no ar e ele volta antes da resposta. Nas duas, a
  // resposta encontra o "lida" já de volta.
  for (const ordem of ['VLR', 'LVR']) {
    const { r } = await lidaQueVolta({ ordem });
    assert.equal(r.noAr, true, `${ordem} CONTROLE: o "lida" do fechamento tinha que estar no ar quando a lista saiu`);
    assert.equal(r.L, 2, `${ordem} CONTROLE: antes da resposta, a lista conta a vista e a resposta — o histórico ainda não a explica`);
    assert.equal(r.voltou, true, `${ordem} CONTROLE: o "lida" tinha que ter voltado`);
    assert.equal(r.lidaNoArNaResposta, false, `${ordem} CONTROLE: com o "lida" ainda no ar seria o R12-5-01, não o irmão dele`);
    assert.equal(r.R, 1, `${ordem} DEFEITO: com a resposta no histórico, a pílula seguiu dizendo "2 mensagens novas" (uma já vista) — a conta da lista não foi refeita`);
    assert.equal(r.pilula.selo, '1', `${ordem}: a pílula mostrou ${r.pilula.selo}`);
    assert.equal(r.pilula.rotulo, 'presenca.pill.msg{"n":1}', `${ordem}: o nome da pílula disse o plural`);
    assert.equal(r.aos60s, 1, `${ordem}: a conta mudou sozinha depois`);
  }
  // CONTROLE: a resposta pelo tempo real ANTES da lista (a recontagem na
  // chegada dela, R10-5-04) dá 1 o tempo todo — e a com o "lida" ainda no ar
  // quando a resposta chega (o R12-5-01) também, depois da resposta.
  const { r: antes } = await lidaQueVolta({ ordem: 'RVL' });
  assert.deepEqual([antes.R, antes.V, antes.L, antes.aos60s], [1, 1, 1, 1], 'CONTROLE: com a resposta antes da lista, a conta tinha que ser 1 o tempo todo');
  const { r: noAr } = await lidaQueVolta({ ordem: 'LRV' });
  assert.equal(noAr.lidaNoArNaResposta, true, 'CONTROLE: aqui o "lida" ainda estava no ar quando a resposta chegou');
  assert.deepEqual([noAr.L, noAr.R, noAr.V, noAr.aos60s], [2, 1, 1, 1], 'CONTROLE: com o "lida" no ar, a resposta já refazia a conta (R12-5-01)');
});

test('R13-5-01 pelo LOTE: a resposta guardada antes de a lista sair, entregue na reconexão depois de o "lida" voltar, também refaz a conta', async () => {
  // A 3200 foi guardada ANTES de a lista sair (`T + 3500`): a régua de sempre a
  // deixa fora das vivas (a lista já a contou) — mas a conta da lista, com a
  // vista dentro, ficava 2 até a lista seguinte.
  for (const ordem of ['VLR', 'LVR']) {
    const { r } = await lidaQueVolta({ ordem, n: 3200, lote: true });
    assert.equal(r.L, 2, `${ordem} CONTROLE: antes do lote, a lista conta a vista e a resposta`);
    assert.equal(r.lidaNoArNaResposta, false, `${ordem} CONTROLE: o "lida" já tinha voltado`);
    assert.equal(r.R, 1, `${ordem} DEFEITO: a resposta chegou no lote e a pílula seguiu dizendo "2 mensagens novas" (uma já vista)`);
    assert.equal(r.aos60s, 1);
  }
  const { r: k } = await lidaQueVolta({ ordem: 'RVL', n: 3200, lote: true });
  assert.deepEqual([k.R, k.V, k.L], [1, 1, 1], 'CONTROLE: com o lote antes da lista, a conta tinha que ser 1');
});

test('R13-5-01 a conta refeita com o "lida" de volta não come a mensagem que só a LISTA conhece', async () => {
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
  c.relogio.agora = T + 3800; soltar({ success: true }); await tick(); await tick();
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3700, 3), T + 3500, 30); await tick();
  assert.equal(conta(c), 3, 'CONTROLE: a lista conta a vista e as duas respostas');
  c.relogio.agora = T + 4500; await chega(c, 3600); await tick();
  assert.ok(conta(c) >= 2, `a conta refeita perdeu a resposta que só a lista conhece: ${conta(c)}`);
  c.relogio.agora = T + 4600; await chega(c, 3700); await tick();
  assert.equal(conta(c), 2, 'DEFEITO: com as duas respostas no histórico, a conta tinha que ser as duas que ninguém viu (a vista ficou contada)');
  c.relogio.agora = T + 60_000; await tick();
  assert.equal(conta(c), 2, 'a conta das respostas que ninguém viu mudou sozinha');
});

test('R13-5-01 CONTROLE: a lista que saiu DEPOIS de o "lida" voltar não é recontada — e a resposta que ela conta segue contando', async () => {
  // O Waze já tinha processado o "lida" quando leu esta lista: ela conta só a
  // resposta. A régua não a confunde com a que saiu com ele no ar.
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
  c.relogio.agora = T + 3200; soltar({ success: true }); await tick(); await tick();
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3600, 1), T + 3500, 30); await tick();
  assert.equal(conta(c), 1, 'CONTROLE: a lista que saiu depois do "lida" conta só a resposta');
  c.relogio.agora = T + 4500; await chega(c, 3600); await tick();
  assert.equal(conta(c), 1, 'a resposta que a lista contou e o tempo real entregou depois deixou de contar, ou contou duas vezes');
  // E a mensagem que chega DEPOIS da lista (a lista não a conhece) soma.
  c.relogio.agora = T + 5000; await chega(c, 4800); await tick();
  assert.equal(conta(c), 2, 'a mensagem nova, que nenhuma lista contou, não somou');
});

// ── R13-5-02: o "Tentar de novo" do histórico na espera do perfil ──────────

const anuncio = (c) => c.$('conversaAnuncio').textContent;
// A frase que a TELA mostra antes de um "Tentar de novo" (`classe` diz qual:
// `conversa-vazio` é a do histórico e a da página antiga, `conversa-falhou` é a
// do envio), e se a tela diz "Carregando…".
const fraseNaTela = (c, classe) => {
  const m = new RegExp(`<p class="${classe}">([^<]*) <button`).exec(c.$('conversaMsgs').innerHTML);
  return m ? m[1] : null;
};
const telaDiz = (c, chave) => c.$('conversaMsgs').innerHTML.includes(chave);
// O toque no "Tentar de novo" do histórico (o `.conversa-recarregar`; com
// `data-antigas`, o da página antiga) pelo ouvinte DELEGADO da conversa — o
// mesmo caminho do dedo.
const tocarTentarDeNovo = (c, { antigas = false } = {}) => c.$('conversaMsgs').disparar('click', {
  target: { closest: (sel) => (sel === '.conversa-recarregar' ? { dataset: antigas ? { antigas: '1' } : {} } : null) } });

// A conversa com a CAF aberta e o histórico que NÃO veio (o Waze fora). Com
// `antigas`, a primeira página vem (com mais antigas), e é a página ANTIGA que
// não vem. `abrir` responde as idas seguintes do histórico.
async function historicoQueNaoVeio({ antigas = false, abrir = () => WAZE_FORA, enviar = () => ({ success: true }) } = {}) {
  let primeira = true;
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'enviar') return enviar(x);
    if (x.acao !== 'abrir') return { success: true };
    if (primeira) {
      primeira = false;
      return antigas ? { success: true, mensagens: [doHistorico(1)], maisAntigas: true, lida: true } : WAZE_FORA;
    }
    return abrir(x);
  } } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  if (antigas) {
    c.P.presencaCarregarAntigas(CAF);                         // o "Ver mensagens anteriores"
    await tick(); await tick();
  }
  const abertos = () => c.chamadas.chat.filter((x) => x.acao === 'abrir').length;
  return { c, abertos };
}

test('R13-5-02 o "Tentar de novo" do histórico na espera do perfil: a tela diz "Carregando a conversa…", e a região viva deixa de dizer que não carregou', async () => {
  const { c, abertos } = await historicoQueNaoVeio();
  assert.equal(fraseNaTela(c, 'conversa-vazio'), 'presenca.conversa.erro', 'CONTROLE: a tela mostra que o histórico não veio, com o "Tentar de novo"');
  assert.equal(anuncio(c), 'presenca.conversa.erro', 'CONTROLE: a região viva diz a mesma falha (R11-5-03)');
  c.AppState.profile = null;                                  // a renovação silenciosa: a sessão voltou, o perfil não
  tocarTentarDeNovo(c);
  await tick(); await tick();
  assert.equal(c.chamadas.refazerPerfil, 1, 'CONTROLE: o toque na espera tinha que pedir o perfil');
  assert.equal(abertos(), 1, 'CONTROLE: sem o perfil, o histórico não sai');
  assert.equal(fraseNaTela(c, 'conversa-vazio'), null, 'CONTROLE: a tela tinha que tirar a linha de falha');
  assert.ok(telaDiz(c, 'presenca.conversa.carregando'), 'CONTROLE: a tela tinha que dizer "Carregando a conversa…"');
  assert.equal(anuncio(c), '', 'DEFEITO: a tela diz "Carregando a conversa…" e a região viva segue dizendo "Não deu pra carregar a conversa."');
  // O perfil volta: o histórico sai, e a falha de novo é dita de novo — da
  // região calada pra frase, uma mudança que o leitor de tela lê.
  c.AppState.profile = { id: Number(EU), userName: 'antigerme' };
  await c.P.presencaSincronizar();
  await tick(); await tick();
  assert.equal(abertos(), 2, 'CONTROLE: com o perfil de volta, o histórico que esperava tinha que sair');
  assert.equal(fraseNaTela(c, 'conversa-vazio'), 'presenca.conversa.erro', 'CONTROLE: a tela mostra a falha outra vez');
  assert.equal(anuncio(c), 'presenca.conversa.erro', 'a falha outra vez não foi dita');
});

test('R13-5-02 o mesmo na página ANTIGA: "Carregando mensagens anteriores…" na tela, e a região deixa de dizer que elas não vieram', async () => {
  const { c, abertos } = await historicoQueNaoVeio({ antigas: true });
  assert.equal(fraseNaTela(c, 'conversa-vazio'), 'presenca.conversa.anterioresErro', 'CONTROLE: a tela mostra que as anteriores não vieram');
  assert.equal(anuncio(c), 'presenca.conversa.anterioresErro', 'CONTROLE: a região viva diz a mesma falha (R11-5-03)');
  c.AppState.profile = null;
  tocarTentarDeNovo(c, { antigas: true });
  await tick(); await tick();
  assert.equal(c.chamadas.refazerPerfil, 1, 'CONTROLE: o toque na espera tinha que pedir o perfil');
  assert.equal(abertos(), 2, 'CONTROLE: sem o perfil, a página antiga não sai de novo');
  assert.ok(telaDiz(c, 'presenca.conversa.anterioresCarregando'), 'CONTROLE: a tela tinha que dizer "Carregando mensagens anteriores…"');
  assert.equal(fraseNaTela(c, 'conversa-vazio'), null, 'CONTROLE: a tela tinha que tirar a linha de falha');
  assert.equal(anuncio(c), '', 'DEFEITO: a tela diz "Carregando mensagens anteriores…" e a região viva segue dizendo que elas não vieram');
});

test('R13-5-02 só a falha do histórico sai da região: a de um envio que segue na tela, e a mensagem que chegou, ficam ditas', async () => {
  // O envio sem o perfil (R6-5-5) entra como "Não enviada." e é dito (R11-5-03,
  // com a região que já dizia a falha do histórico limpa antes e a frase a
  // caminho, R12-5-02). O "Tentar de novo" do histórico não pode calar a falha
  // do envio, que segue na tela.
  const a = await historicoQueNaoVeio();
  a.c.AppState.profile = null;
  a.c.P.presencaEnviar('é a fachada?', null);
  for (const x of a.c.timers.filter((t) => t.ms === a.c.P.PRESENCA_ANUNCIO_DE_NOVO_MS)) { a.c.timers.splice(a.c.timers.indexOf(x), 1); await x.fn(); }
  assert.equal(anuncio(a.c), 'presenca.recibo.naoEnviadaErro', 'CONTROLE: a região diz a falha do envio');
  tocarTentarDeNovo(a.c);
  await tick(); await tick();
  assert.equal(fraseNaTela(a.c, 'conversa-falhou'), 'presenca.recibo.naoEnviadaErro', 'CONTROLE: a falha do envio segue na tela');
  assert.equal(anuncio(a.c), 'presenca.recibo.naoEnviadaErro', 'o "Tentar de novo" do histórico calou a falha do envio, que a tela ainda mostra');
  // A mensagem que CHEGOU com a conversa na tela, anunciada depois da falha do
  // histórico, também fica.
  const b = await historicoQueNaoVeio();
  b.c.relogio.agora = T + 2000;
  await chega(b.c, 2000);
  await tick();
  const dita = anuncio(b.c);
  assert.match(dita, /^presenca\.conversa\.anuncio/, 'CONTROLE: a mensagem que chegou na conversa aberta foi anunciada');
  b.c.AppState.profile = null;
  tocarTentarDeNovo(b.c);
  await tick(); await tick();
  assert.equal(b.c.chamadas.refazerPerfil, 1, 'CONTROLE: o toque na espera tinha que pedir o perfil');
  assert.equal(anuncio(b.c), dita, 'o "Tentar de novo" do histórico calou o anúncio da mensagem que chegou');
});

test('R13-5-02 CONTROLE: com o perfil, o "Tentar de novo" sai com a região limpa (R11-5-03) e "Carregando a conversa…" na tela — a régua que a espera do perfil passou a seguir', async () => {
  // Com o perfil, a tentativa começa limpando a região inteira e o histórico
  // fica no ar: a tela diz "Carregando a conversa…" e a região, nada. É o que
  // o caminho da espera do perfil não fazia.
  const { c, abertos } = await historicoQueNaoVeio({ abrir: () => new Promise(() => {}) });
  assert.equal(anuncio(c), 'presenca.conversa.erro', 'CONTROLE: a região viva diz que o histórico não veio');
  tocarTentarDeNovo(c);
  await tick(); await tick();
  assert.equal(abertos(), 2, 'com o perfil, o histórico não saiu');
  assert.equal(c.chamadas.refazerPerfil, 0, 'com o perfil na mão, o toque pediu o perfil');
  assert.ok(telaDiz(c, 'presenca.conversa.carregando'), 'a tela não diz "Carregando a conversa…"');
  assert.equal(anuncio(c), '', 'com o perfil, a tentativa saiu com a falha anterior na região viva');
});

// ── Os irmãos do R13-5-02, achados no conserto (lote 17) ────────────────────
// O que o caminho da ESPERA do perfil deixava de fazer e o caminho com o
// perfil faz, comparados campo a campo no `presencaCarregarConversa`: a
// primeira página recomeça as duas (`h.antigas`), e a primeira página no ar
// segura o toque em "Ver mensagens anteriores" (`h.carregando`).

const botaoVerAnteriores = (c) => c.$('conversaMsgs').innerHTML.includes('class="conversa-anteriores">presenca.conversa.anteriores<');
// O toque em "Ver mensagens anteriores" (o `.conversa-anteriores`), pelo ouvinte
// DELEGADO da conversa.
const tocarVerAnteriores = (c) => c.$('conversaMsgs').disparar('click', {
  target: { closest: (sel) => (sel === '.conversa-anteriores' ? {} : null) } });

// A página antiga que NÃO veio, a conversa fechada e reaberta — com o perfil
// (a primeira página fica no ar) ou na espera dele.
async function reabertaDepoisDaAntigaQueFalhou({ semPerfil }) {
  const { c, abertos } = await historicoQueNaoVeio({ antigas: true, abrir: (x) => (x.antesDe ? WAZE_FORA : new Promise(() => {})) });
  const antes = fraseNaTela(c, 'conversa-vazio');
  fechar(c);
  if (semPerfil) c.AppState.profile = null;
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  return { antes, tela: c.$('conversaMsgs').innerHTML, frase: fraseNaTela(c, 'conversa-vazio'), botao: botaoVerAnteriores(c),
    carregandoAntigas: telaDiz(c, 'presenca.conversa.anterioresCarregando'), pediuPerfil: c.chamadas.refazerPerfil, abertos: abertos(), c };
}

test('R13-5-02 (irmão) reaberta na espera do perfil, a conversa não traz de volta o erro velho da página antiga — a MESMA tela da reabertura com o perfil (P12)', async () => {
  const com = await reabertaDepoisDaAntigaQueFalhou({ semPerfil: false });
  assert.equal(com.antes, 'presenca.conversa.anterioresErro', 'CONTROLE: a página antiga não veio');
  assert.equal(com.abertos, 3, 'CONTROLE: com o perfil, a reabertura pede a primeira página');
  assert.equal(com.frase, null, 'CONTROLE: com o perfil, a reabertura não traz o erro velho (P12)');
  assert.equal(com.botao, true, 'CONTROLE: com o perfil, a reabertura oferece "Ver mensagens anteriores"');
  const sem = await reabertaDepoisDaAntigaQueFalhou({ semPerfil: true });
  assert.equal(sem.antes, 'presenca.conversa.anterioresErro', 'CONTROLE: a página antiga não veio');
  assert.equal(sem.abertos, 2, 'CONTROLE: na espera do perfil, nada sai');
  assert.equal(sem.pediuPerfil, 1, 'CONTROLE: a reabertura na espera pede o perfil');
  assert.equal(sem.frase, null, 'DEFEITO: reaberta na espera do perfil, a conversa trouxe de volta "Não deu pra carregar as mensagens anteriores."');
  assert.equal(sem.botao, true, 'a reabertura na espera não ofereceu "Ver mensagens anteriores"');
  assert.equal(sem.tela, com.tela, 'na espera do perfil, a conversa reaberta não mostra a mesma tela da reabertura com o perfil');
});

test('R13-5-02 (irmão) o "Carregando mensagens anteriores…" de um toque na espera não volta numa reabertura: quem espera é a primeira página', async () => {
  const { c, abertos } = await historicoQueNaoVeio({ antigas: true, abrir: (x) => (x.antesDe ? WAZE_FORA : new Promise(() => {})) });
  c.AppState.profile = null;
  tocarTentarDeNovo(c, { antigas: true });                    // a página antiga, na espera
  await tick(); await tick();
  assert.ok(telaDiz(c, 'presenca.conversa.anterioresCarregando'), 'CONTROLE: o toque na espera diz "Carregando mensagens anteriores…"');
  fechar(c);
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  assert.equal(abertos(), 2, 'CONTROLE: na espera do perfil, nada sai');
  assert.equal(telaDiz(c, 'presenca.conversa.anterioresCarregando'), false,
    'DEFEITO: reaberta na espera, a conversa diz "Carregando mensagens anteriores…" — e o que espera o perfil é a primeira página');
  assert.equal(botaoVerAnteriores(c), true, 'a reabertura na espera não ofereceu "Ver mensagens anteriores"');
});

// A conversa com a CAF já carregada (a 1, e há mais antigas), fechada; a 2000
// chega com ela FECHADA (não vista); o perfil some (a renovação silenciosa) e a
// pessoa REABRE a conversa — e vê a 2000. `tocar`: ela toca "Ver mensagens
// anteriores" ainda na espera. `comPerfil`: o CONTROLE, sem a espera — a
// primeira página da reabertura fica no ar até `soltar`.
async function reabertaNaEspera({ tocar, comPerfil = false }) {
  let soltar = null;
  let primeira = true;
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => {
    if (x.acao !== 'abrir') return { success: true };
    if (primeira) { primeira = false; return { success: true, mensagens: [doHistorico(1)], maisAntigas: true, lida: true }; }
    if (x.antesDe) return { success: true, mensagens: [doHistorico(-5000)], maisAntigas: false, lida: false };
    const r = { success: true, mensagens: [doHistorico(1), doHistorico(2000)], maisAntigas: true, lida: true };
    return comPerfil ? new Promise((ok) => { soltar = () => ok(r); }) : r;
  } } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  fechar(c);
  await tick();
  c.relogio.agora = T + 2000; await chega(c, 2000);            // com a conversa FECHADA
  const r = { contaAntes: conta(c) };
  const perfil = c.AppState.profile;
  if (!comPerfil) c.AppState.profile = null;
  const depoisDaReabertura = c.chamadas.chat.length;
  c.relogio.agora = T + 3000;
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  r.viuA2000 = c.$('conversaMsgs').innerHTML.includes('msg 2000');
  r.botao = botaoVerAnteriores(c);
  if (tocar) { tocarVerAnteriores(c); await tick(); await tick(); }
  r.pediuPerfil = c.chamadas.refazerPerfil;
  if (comPerfil) { r.abrirNoAr = c.chamadas.chat.slice(depoisDaReabertura).filter((x) => x.acao === 'abrir').map((x) => (x.antesDe ? 'antiga' : 'primeira')); soltar(); }
  c.AppState.profile = perfil;
  c.relogio.agora = T + 4000;
  await c.P.presencaSincronizar();
  await tick(); await tick();
  r.abrir = c.chamadas.chat.slice(depoisDaReabertura).filter((x) => x.acao === 'abrir').map((x) => (x.antesDe ? 'antiga' : 'primeira'));
  r.lidaAte = (c.P.Presenca.lidaEnviadaAte.get(CAF) || 0) - T;
  return { c, r };
}

test('R13-5-02 (irmão) na espera do perfil, "Ver mensagens anteriores" não troca a PRIMEIRA página que espera — e a conversa reaberta é marcada como lida quando o perfil volta', async () => {
  const { c, r } = await reabertaNaEspera({ tocar: true });
  assert.equal(r.contaAntes, 1, 'CONTROLE: a 2000 chegou com a conversa fechada e conta como nova');
  assert.equal(r.viuA2000, true, 'CONTROLE: reaberta, a conversa mostra a 2000');
  assert.equal(r.botao, true, 'CONTROLE: reaberta, a conversa oferece "Ver mensagens anteriores"');
  assert.equal(r.pediuPerfil, 2, 'o toque na espera não pediu o perfil (é gesto, R6-5-5)');
  assert.deepEqual(r.abrir, ['primeira'], 'DEFEITO: o toque na espera trocou a primeira página pela antiga — a conversa reaberta não foi pedida (nem marcada como lida) quando o perfil voltou');
  assert.equal(r.lidaAte, 2000, 'a 2000, vista ao reabrir, não foi marcada como lida no Waze');
  // Com a primeira página na tela, "Ver mensagens anteriores" funciona como
  // sempre: o toque não se perdeu pra sempre, como com o perfil.
  tocarVerAnteriores(c);
  await tick(); await tick();
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'abrir' && x.antesDe).length, 1, 'com o perfil de volta, "Ver mensagens anteriores" não pediu a página antiga');
  // CONTROLES: sem o toque, a primeira página espera e sai; COM o perfil, a
  // primeira página no ar segura o toque (`h.carregando`) — a régua que a
  // espera passou a seguir.
  const { r: semToque } = await reabertaNaEspera({ tocar: false });
  assert.deepEqual([semToque.abrir, semToque.lidaAte], [['primeira'], 2000], 'CONTROLE: sem o toque, a primeira página tinha que sair e marcar a 2000 como lida');
  const { r: com } = await reabertaNaEspera({ tocar: true, comPerfil: true });
  assert.deepEqual(com.abrirNoAr, ['primeira'], 'CONTROLE: com o perfil, o toque com a primeira página no ar não pede a antiga');
  assert.equal(com.lidaAte, 2000, 'CONTROLE: com o perfil, a reabertura marca a 2000 como lida');
});
