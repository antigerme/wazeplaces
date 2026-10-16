// A presença e a conversa depois da auditoria da rodada 23 (R23-5): o "Hoje" e o
// "Ontem" que dependiam do relógio do aparelho comparado com a hora do Waze, e a
// mensagem igual à anterior que o leitor de tela podia não ler de novo. Os
// rótulos R23-5-n são os do relatório dessa rodada. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { novoCliente } from './_presenca-cliente.mjs';

const tick = () => new Promise((r) => setImmediate(r));
// Meio-dia LOCAL de um dia qualquer: o "hoje" e o "ontem" são do fuso de quem lê.
const T = new Date(2026, 9, 15, 12, 0, 0).getTime();
const DIA = 86_400_000;

// ── R23-5-03: a hora do Waze comparada com o relógio do aparelho ────────────

// O aparelho certo, adiantado ou atrasado um dia: o app mede o `desvio` (servidor
// − aparelho) a cada lista, e a conversa de HOJE tem que dizer "Hoje" nos três.
const APARELHOS = [['certo', 0], ['adiantado um dia', DIA], ['atrasado um dia', -DIA]];

function conversaComDuasMensagens(aparelhoDifere) {
  const c = novoCliente({ agora: T + aparelhoDifere });
  c.P.presencaMontar();
  const P = c.P.Presenca;
  P.desvio = T - (T + aparelhoDifere);
  P.online = [{ id: '200', nome: 'Ana', rank: 3, lat: -23.5, lon: -46.6 }];
  const ontem = T - DIA, hoje = T - 60e3;
  P.conversas = [{ id: '200', nome: 'Ana', naoLidas: 0, atividade: hoje,
    ultima: { deMim: false, ts: hoje, recibo: false, texto: 'oi', card: null } }];
  const msg = (id, ts) => ({ id, ts, meu: false, texto: id, card: null, legenda: null, estado: null });
  P.historico.set('200', { msgs: [msg('a1', ontem), msg('a2', hoje)], maisAntigas: false, carregada: true, erro: false, carregando: false });
  P.aberta = '200';
  c.escopo.openModal('conversaModal');
  c.P.presencaRenderConversa();
  return c;
}

for (const [rotulo, diferenca] of APARELHOS) {
  test(`R23-5-03 aparelho ${rotulo}: o separador da conversa diz Ontem e Hoje pelo dia do WAZE`, () => {
    const c = conversaComDuasMensagens(diferenca);
    const dias = [...c.$('conversaMsgs').innerHTML.matchAll(/conversa-dia"><span>([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(dias, ['presenca.dia.ontem', 'presenca.dia.hoje'],
      `DEFEITO: com o aparelho ${rotulo} o separador comparou a hora do Waze com o relógio do aparelho: ${JSON.stringify(dias)}`);
  });

  test(`R23-5-03 aparelho ${rotulo}: a hora curta da lista diz "ontem" só pro que foi ontem no Waze`, () => {
    const c = novoCliente({ agora: T + diferenca });
    c.P.Presenca.desvio = -diferenca;
    const hoje = c.P.presencaHoraCurta(T - 60e3);
    const ontem = c.P.presencaHoraCurta(T - DIA);
    assert.notEqual(hoje, 'presenca.hora.ontem', `DEFEITO: a mensagem de agora saiu "ontem" com o aparelho ${rotulo}`);
    assert.equal(ontem, 'presenca.hora.ontem', `DEFEITO: a de ontem não saiu "ontem" com o aparelho ${rotulo}: ${ontem}`);
  });
}

// ── R23-5-04: duas mensagens iguais seguidas ────────────────────────────────

const fala = (texto) => ({ id: 'x' + texto + Math.random(), texto, meu: false, ts: T });

test('R23-5-04 a mensagem IGUAL à que a região viva já diz é limpa e dita de novo, depois do atraso curto', async () => {
  const c = novoCliente({ agora: T });
  c.P.Presenca.aberta = '200';
  c.escopo.openModal('conversaModal');
  const el = c.$('conversaAnuncio');
  c.P.presencaAnunciar(fala('ok'));
  const primeira = el.textContent;
  assert.match(primeira, /"texto":"ok"/, 'CONTROLE: a primeira mensagem tinha que ser dita');
  c.P.presencaAnunciar(fala('ok'));
  assert.equal(el.textContent, '', 'DEFEITO: a segunda "ok" reescreveu o mesmo texto sem limpar — o leitor de tela pode não ler de novo');
  assert.equal(c.timers.length, 1, 'a segunda mensagem tinha que ficar a caminho');
  assert.equal(c.timers[0].ms, c.P.PRESENCA_ANUNCIO_DE_NOVO_MS);
  await c.rodarTimers();
  assert.equal(el.textContent, primeira, 'a segunda "ok" não voltou depois do atraso');
});

test('R23-5-04 mensagem DIFERENTE escreve na hora, sem timer — e a terceira igual repete a técnica', async () => {
  const c = novoCliente({ agora: T });
  c.P.Presenca.aberta = '200';
  c.escopo.openModal('conversaModal');
  const el = c.$('conversaAnuncio');
  c.P.presencaAnunciar(fala('ok'));
  c.P.presencaAnunciar(fala('tudo bem?'));
  assert.match(el.textContent, /tudo bem\?/, 'a mensagem diferente tinha que ser escrita na hora');
  assert.equal(c.timers.length, 0, 'CONTROLE: texto diferente não precisa de espera');
  c.P.presencaAnunciar(fala('tudo bem?'));
  assert.equal(el.textContent, '');
  await c.rodarTimers();
  assert.match(el.textContent, /tudo bem\?/);
});

test('R23-5-04 só diz se a região ainda está limpa: o que outro caminho escreveu no meio (a falha de um envio) vale', async () => {
  const c = novoCliente({ agora: T });
  c.P.Presenca.aberta = '200';
  c.escopo.openModal('conversaModal');
  const el = c.$('conversaAnuncio');
  c.P.presencaAnunciar(fala('ok'));
  c.P.presencaAnunciar(fala('ok'));
  el.textContent = 'presenca.recibo.naoEnviada';
  await c.rodarTimers();
  assert.equal(el.textContent, 'presenca.recibo.naoEnviada', 'DEFEITO: o "ok" atrasado falou por cima do que outro caminho acabou de dizer');
});

test('R23-5-04 mensagem mais nova tira a anterior do caminho', async () => {
  const c = novoCliente({ agora: T });
  c.P.Presenca.aberta = '200';
  c.escopo.openModal('conversaModal');
  const el = c.$('conversaAnuncio');
  c.P.presencaAnunciar(fala('ok'));
  c.P.presencaAnunciar(fala('ok'));
  c.P.presencaAnunciar(fala('outra'));
  await c.rodarTimers();
  assert.match(el.textContent, /outra/, 'DEFEITO: o "ok" atrasado falou por cima da mensagem mais nova');
});

test('R23-5-04 fechar cancela a que está a caminho — também quando a MESMA conversa reabre antes do atraso', async () => {
  const c = novoCliente({ agora: T });
  c.P.Presenca.aberta = '200';
  c.escopo.openModal('conversaModal');
  const el = c.$('conversaAnuncio');
  c.P.presencaAnunciar(fala('ok'));
  c.P.presencaAnunciar(fala('ok'));
  c.P.presencaEsquecerAberta();
  c.$('conversaModal').classList.add('hidden');
  c.P.Presenca.aberta = '200';           // a mesma conversa reabre antes dos 100 ms
  c.escopo.openModal('conversaModal');
  await c.rodarTimers();
  assert.equal(el.textContent, '', 'DEFEITO: a mensagem da conversa que fechou falou na que reabriu');
});
