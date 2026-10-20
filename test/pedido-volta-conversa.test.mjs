// Decisão de tela 3 (2026-10-20): o ✕ da folha do pedido que se abriu DA conversa devolve a conversa.
//
// O `presenca.js` roda INTEIRO no navegador de mentira (`_presenca-cliente.mjs`). A folha esconde a conversa
// (um diálogo por vez) e a limpeza dela solta o `aberta` e o anexo; quem devolve é `presencaVoltarDaFolha`,
// que o `closeModal` do app.js chama nos caminhos do APP (✕, Esc, fundo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { novoCliente } from './_presenca-cliente.mjs';

const CAF = '183164343';
const APP_CTX = { app: 'wazeplaces' };
const tick = () => new Promise((r) => setImmediate(r));
const CARD = JSON.stringify({ venueID: '1.2.3', name: 'Padaria', categories: ['BAKERY'], updateTypeKey: 'IMAGE', region: 'row' });
const msgDoCard = { id: 'a0000000-0000-1000-8000-000000000008', ts: 1790200000000, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: '12444348' },
  classe: 'texto', texto: 'olha esse', contexto: { ...APP_CTX, card: CARD } };
const abrirChamadas = (c) => c.chamadas.chat.filter((x) => x.acao === 'abrir');

async function conversaAberta() {
  const c = novoCliente({ api: { chat: () => ({ success: true, mensagens: [msgDoCard], maisAntigas: false, lida: true }) } });
  c.P.presencaMontar();
  c.P.presencaAplicarLista({ online: [{ id: CAF, nome: 'cafanha', rank: 3, lat: -23.5, lon: -46.6 }], conversas: [] }, 1000, 30);
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.equal(abrirChamadas(c).length, 1, 'CONTROLE: abrir a conversa pede o histórico uma vez');
  return c;
}

// O que o app.js faz ao abrir a folha: a conversa é escondida (limpeza) e a folha aparece.
function abrirAFolha(c) {
  c.$('conversaMsgs').disparar('click', { target: { closest: (s) => (s === '.conversa-pedido' ? { dataset: { msg: '0' } } : null) } });
  c.$('conversaModal').classList.add('hidden');
  c.P.presencaEsquecerAberta();
  c.$('pedidoModal').classList.remove('hidden');
}

test('o toque no pedido anota a conversa de onde veio, com o anexo e a época', async () => {
  const c = await conversaAberta();
  c.P.Presenca.anexo = { venueID: 'x' };
  c.$('conversaMsgs').disparar('click', { target: { closest: (s) => (s === '.conversa-pedido' ? { dataset: { msg: '0' } } : null) } });
  assert.deepEqual(c.P.Presenca.volta, { id: CAF, anexo: { venueID: 'x' }, epoca: c.P.Presenca.epoca });
});

test('o ✕ da folha devolve a conversa SEM pedir o histórico de novo quando nada chegou', async () => {
  const c = await conversaAberta();
  abrirAFolha(c);
  assert.equal(c.P.Presenca.aberta, null, 'CONTROLE: a folha tirou a conversa de cena (limpeza)');
  assert.equal(c.P.presencaVoltarDaFolha(), true);
  assert.equal(c.P.Presenca.aberta, CAF);
  assert.equal(c.chamadas.openModal.filter((id) => id === 'conversaModal').length, 2, 'a conversa foi reaberta pelo openModal (troca de camada)');
  assert.equal(abrirChamadas(c).length, 1, 'DEFEITO: voltar da folha pediu o histórico outra vez (uma ida ao servidor sem nada novo)');
  assert.equal(c.P.Presenca.volta, null, 'a volta vale uma vez só');
});

test('chegou mensagem enquanto a folha estava aberta: aí o histórico é pedido (e o «lida» sai por ele)', async () => {
  const c = await conversaAberta();
  abrirAFolha(c);
  c.P.Presenca.vivas.set(CAF, { n: 1, ultimaTs: 5, servs: [5] });
  assert.equal(c.P.presencaVoltarDaFolha(), true);
  await tick();
  assert.equal(abrirChamadas(c).length, 2, 'a conversa que voltou com mensagem nova não pediu o histórico');
});

test('o anexo (o pedido preso na tirinha) volta com a conversa', async () => {
  const c = await conversaAberta();
  c.P.Presenca.anexo = { venueID: 'preso', name: 'Preso' };
  abrirAFolha(c);
  assert.equal(c.P.Presenca.anexo, null, 'CONTROLE: a limpeza descarta o anexo');
  c.P.presencaVoltarDaFolha();
  assert.deepEqual(c.P.Presenca.anexo, { venueID: 'preso', name: 'Preso' });
});

test('sem volta anotada, com a sessão caída, em outra época ou com outra conversa aberta: não devolve nada', async () => {
  // sem volta
  let c = await conversaAberta();
  c.$('pedidoModal').classList.remove('hidden');
  assert.equal(c.P.presencaVoltarDaFolha(), false);
  // sessão caída
  c = await conversaAberta(); abrirAFolha(c); c.AppState.authenticated = false;
  assert.equal(c.P.presencaVoltarDaFolha(), false);
  assert.equal(c.P.Presenca.aberta, null);
  // outra época (o `desligar` do «Sair», da troca de conta, da queda)
  c = await conversaAberta(); abrirAFolha(c); c.P.presencaDesligar();
  assert.equal(c.P.Presenca.volta, null, 'o desligar solta a volta');
  assert.equal(c.P.presencaVoltarDaFolha(), false);
  // época trocada sem passar pelo desligar
  c = await conversaAberta(); abrirAFolha(c); c.P.Presenca.epoca += 1;
  assert.equal(c.P.presencaVoltarDaFolha(), false);
  // outra conversa já aberta
  c = await conversaAberta(); abrirAFolha(c); c.P.Presenca.aberta = '999';
  assert.equal(c.P.presencaVoltarDaFolha(), false);
  // a folha já fechada
  c = await conversaAberta(); abrirAFolha(c); c.$('pedidoModal').classList.add('hidden');
  assert.equal(c.P.presencaVoltarDaFolha(), false);
});

test('o closeModal só devolve nos caminhos do APP, e a limpeza da folha solta a volta', () => {
  const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const semComentario = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const i = APP.indexOf('function closeModal(');
  const corpo = semComentario(APP.slice(i, APP.indexOf('\n}\n', i)));
  assert.match(corpo, /if \(id === 'pedidoModal' && !viaHistorico && window\.Presenca\?\.voltarDaFolha\?\.\(\)\) return;/);
  // a interceptação vem DEPOIS de saber que a folha está aberta e ANTES de esconder qualquer coisa
  assert.ok(corpo.indexOf("id === 'pedidoModal'") > corpo.indexOf("m.classList.contains('hidden')"));
  assert.ok(corpo.indexOf("id === 'pedidoModal'") < corpo.indexOf("m.classList.add('hidden')"));
  const lim = APP.slice(APP.indexOf('    pedidoModal() {'), APP.indexOf('    pairEnterModal() {'));
  assert.match(lim, /Presenca\.volta = null/);
});
