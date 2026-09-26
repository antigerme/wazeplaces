// A presença e a conversa depois da auditoria de 2026-09-26: a lista "Triando
// agora", a pílula do cabeçalho, o chat do WME e o tempo real.
//
// Mesmo instrumento do `presenca-cliente.test.mjs`: o js/presenca.js roda
// INTEIRO no navegador de mentira do `_presenca-cliente.mjs`, e cada teste
// passa pelo caminho que o app percorre de verdade (o toque, a resposta que
// chega, o timer que dispara). Cada um nasceu de um cenário que REPRODUZIA o
// defeito, e cada um carrega o CONTROLE que prova que ele distingue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { novoCliente } from './_presenca-cliente.mjs';

const EU = '12444348';
const CAF = '183164343';
const tick = () => new Promise((r) => setImmediate(r));
const conversa = (id, nome, atividade, naoLidas = 0, ultima = null) => ({ id, nome, naoLidas, atividade, ultima });
const daCaf = (n, ts) => ({ id: `a0000000-0000-1000-8000-${String(n).padStart(12, '0')}`, ts, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU },
  classe: 'texto', texto: 'oi?', contexto: { app: 'wazeplaces' } });

// ── P1: a conversa aberta e lida não volta a contar ─────────────────────────

test('P1 lista: a conversa que a pessoa está OLHANDO fica lida — a lista lida no Waze antes do "lida" não devolve o "1"', async () => {
  // O caminho de verdade: tocar na pílula pede a lista, e logo em seguida a
  // pessoa toca na conversa. A lista foi lida no Waze ANTES de o `abrir` marcar
  // a conversa como lida, e chega com 1.
  let soltar;
  const c = novoCliente({ api: {
    presencaApp: () => new Promise((ok) => { soltar = () => ok({ success: true, online: [], conversas: [conversa(CAF, 'cafanha', 1790200000000, 1)] }); }),
    chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [daCaf(1, 1790200000000)], maisAntigas: false, lida: true } : { success: true }),
  } });
  c.P.presencaMontar();
  c.P.Presenca.conversas = [conversa(CAF, 'cafanha', 1790200000000, 1, { texto: 'oi?', ts: 1790200000000 })];
  c.$('presencaPill').disparar('click');
  c.P.presencaAbrirConversa(CAF);
  await tick();
  soltar();
  await tick(); await tick();
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'a lista velha devolveu a não lida da conversa aberta e lida');
  assert.equal(c.$('presencaPill').classList.contains('hidden'), true, 'a pílula anunciou "1 mensagem nova" com a mensagem na tela');
  // CONTROLE: a MESMA lista com a conversa fora da vista conta — senão o teste
  // passaria com um conserto que apaga toda não lida.
  c.$('conversaModal').classList.add('hidden');
  c.P.presencaAplicarLista({ online: [], conversas: [conversa(CAF, 'cafanha', 1790200000000, 1)] }, Date.now(), 30, 'pedido');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'CONTROLE: com a conversa escondida a não lida tem que contar');
  // E com o app no segundo plano (conversa aberta, ninguém olhando), idem.
  c.$('conversaModal').classList.remove('hidden');
  c.doc.visibilityState = 'hidden';
  c.P.presencaAplicarLista({ online: [], conversas: [conversa(CAF, 'cafanha', 1790200000000, 1)] }, Date.now(), 30, 'pedido');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'CONTROLE: com a tela apagada não é leitura');
});

test('P1 lida: o "lida" que DÁ CERTO zera a contagem e a pílula — o que chegou com a tela apagada não fica pra sempre', async () => {
  // Conversa aberta, app no segundo plano, chega mensagem (vira não lida: com a
  // tela apagada não é leitura). A pessoa volta: o "lida" sai e dá certo.
  let responde = { success: true };
  const c = novoCliente({ api: { chat: () => responde } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [{ id: 'm1', ts: 1790200000000, meu: false, texto: 'oi?' }], carregada: true, maisAntigas: false });
  c.P.Presenca.conversas = [conversa(CAF, 'cafanha', 1790200000000, 1)];
  c.P.Presenca.vivas.set(CAF, { n: 1, ultimaTs: c.relogio.agora - 1000 });
  c.P.presencaRenderPilula();
  assert.equal(c.$('presencaCount').textContent, '2', 'CONTROLE: a pílula começa contando');
  // CONTROLE: o "lida" que FALHA não zera nada (o Waze segue contando).
  responde = { success: false, errorCategory: 'transient' };
  await c.P.presencaMarcarLida(CAF);
  assert.equal(c.P.presencaNaoLidasDe(CAF), 2, 'o "lida" que falhou zerou a contagem');
  responde = { success: true };
  await c.P.presencaMarcarLida(CAF);
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'o "lida" deu certo e a contagem ficou');
  assert.equal(c.$('presencaPill').classList.contains('hidden'), true, 'a pílula seguiu dizendo "mensagem nova"');
});

test('P1 lida: a mensagem que chega DEPOIS de o "lida" sair, com a conversa fechada no meio, continua não lida', async () => {
  let soltar;
  const c = novoCliente({ api: { chat: () => new Promise((ok) => { soltar = ok; }) } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [{ id: 'm1', ts: 1790200000000, meu: false, texto: 'oi?' }], carregada: true });
  c.P.Presenca.conversas = [conversa(CAF, 'cafanha', 1790200000000, 0)];
  const p = c.P.presencaMarcarLida(CAF);
  c.relogio.agora += 500;
  // Fechou a conversa, e chegou mensagem nova com o "lida" no ar.
  c.$('conversaModal').classList.add('hidden');
  c.P.Presenca.vivas.set(CAF, { n: 1, ultimaTs: c.relogio.agora });
  soltar({ success: true });
  await p;
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'o "lida" apagou a mensagem que chegou depois dele');
});

test('P1 volta pra tela: nada novo a marcar, mas a lista velha que chegou com o app no fundo não fica na pílula', async () => {
  // A lista lida no Waze antes do `abrir` chegou com o app no segundo plano
  // (ninguém olhando, então ela conta). Na volta, o "lida" não tem o que marcar
  // — o `abrir` já marcou até a última dela —, e a contagem velha ficava.
  const T = 1790200000000;
  const c = novoCliente({ api: { chat: () => ({ success: true }) } });
  c.P.Presenca.chat = { token: 't', base: 'https://x/', chave: 'k', expiraEm: c.relogio.agora + 864e5 };
  c.P.Presenca.fluxo = { ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: c.relogio.agora, vivoEm: c.relogio.agora };
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [{ id: 'm1', ts: T, meu: false, texto: 'oi?' }], carregada: true });
  c.P.Presenca.lidaEnviadaAte.set(CAF, T);          // o `abrir` marcou como lida
  c.doc.visibilityState = 'hidden';
  c.P.presencaAplicarLista({ online: [], conversas: [conversa(CAF, 'cafanha', T, 1)] }, c.relogio.agora, 30, 'pedido');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'CONTROLE: com o app no fundo a lista conta');
  c.doc.visibilityState = 'visible';
  c.P.presencaAoVoltar();
  await c.rodarTimers();
  assert.equal(c.chamadas.presencaApp.length, 0, 'CONTROLE: uma lista nova teria zerado sozinha, e o teste não mediria nada');
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'lida').length, 0, 'mandou "lida" sem nada novo a marcar');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'a contagem velha ficou com a conversa aberta, na tela e lida');
  assert.equal(c.$('presencaPill').classList.contains('hidden'), true);
});
