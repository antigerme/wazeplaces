// A presença e a conversa depois da auditoria da rodada 8 (R8-5, e o R8-6-02,
// que é o mesmo achado visto pelo lado dos filtros): o tempo real parado depois
// do modo avião quando o `online` não vem, a lista pedida com `keepalive` na
// volta do fundo, "Minha área" com dois países na presença, a dívida do "lida"
// que só existia na memória (e a que estava NO AR quando a lista chegava), o
// mesmo "lida" saindo duas vezes e o "invisível" repetido pela outra aba. Os
// rótulos R8-5-n são os do relatório dessa rodada. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
//
// Dois instrumentos, como nas rodadas anteriores: o js/presenca.js INTEIRO no
// navegador de mentira do `_presenca-cliente.mjs`, e as funções do app.js
// FATIADAS e rodadas num escopo de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { novoCliente } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const GOOGLE = 'https://instantmessaging-pa.googleapis.com/';

// ── R8-5-01: o tempo real parado pela falta de rede ──────────────────────────

// O fluxo aberto com um token que vale, e o Google inalcançável: ele cai, a
// pessoa está no modo avião (`onLine` falso) e o recuo vence SEM rede — o
// `presencaFluxoGarantir` desiste sem reagendar. Depois a rede volta, SEM o
// evento `online` (o iPhone). `token`: 'vale' (vale mais de uma hora),
// 'ultimaHora' (abre o fluxo, mas já é hora de renovar) ou null (sem token).
async function fluxoParado({ token = 'vale' } = {}) {
  const c = novoCliente({ agora: T, api: {
    fetch: async () => { throw new TypeError('Failed to fetch'); },   // o Google inalcançável
    presencaApp: () => ({ success: true, online: [], conversas: [], agora: c.relogio.agora }),
  } });
  c.P.presencaMontar();
  const expiraEm = token === 'ultimaHora' ? T + 40 * 60_000 : T + 20 * 3600e3;
  Object.assign(c.P.Presenca, { atualizadaEm: T, tentadaEm: T, pais: 30, tokenPedidoEm: T,
    chat: token ? { token: 'tk', base: GOOGLE, chave: 'k', expiraEm } : null });
  if (token) {
    c.P.presencaFluxoGarantir();                            // o fluxo abre…
    await tick(); await tick();                             // …e cai: a rede foi embora
    assert.equal(c.chamadas.fetch.length, 1, 'CONTROLE: o fluxo tinha que ter aberto uma vez');
  }
  c.escopo.navigator.onLine = false;                        // o modo avião
  c.relogio.agora += 3000;
  await c.rodarTimers();                                    // o recuo vence SEM rede
  assert.equal(c.timers.length, 0, 'CONTROLE: o recuo sem rede não pode deixar timer de pé (é o defeito)');
  c.escopo.navigator.onLine = true;                         // a rede volta, sem o `online`
  c.relogio.agora += 6 * 60_000;                            // (o teto de 5 min do token já passou)
  return c;
}
const provasDeRede = async (c, n = 5) => { for (let i = 0; i < n; i++) { c.P.presencaAoProvarRede(); await tick(); } await tick(); };

test('R8-5-01 o recuo que venceu sem rede deixa o tempo real PARADO — e a prova de rede o religa UMA vez, sem o `online` e sem pedido à API', async () => {
  const c = await fluxoParado();
  assert.equal(c.P.Presenca.fluxoParado, true, 'o fluxo parado pela falta de rede não ficou marcado');
  const antes = c.chamadas.fetch.length;
  await provasDeRede(c);                                    // cada ✕ é uma resposta que prova a rede
  assert.equal(c.chamadas.fetch.length - antes, 1,
    'DEFEITO: a rede voltou sem o `online`, as respostas da API chegaram e o tempo real não religou (ou religou a cada uma)');
  assert.equal(c.chamadas.presencaApp.length, 0, 'religar o tempo real pediu alguma coisa à API');
  assert.equal(c.P.Presenca.fluxoParado, false);
  // O fluxo religado que cai de novo segue o recuo dele (um timer), não as provas.
  assert.equal(c.timers.length, 1, 'o fluxo religado que caiu ficou sem o recuo');
});

test('R8-5-01 o token na ÚLTIMA hora religa igual, e sem pedir o token novo (a renovação segue com quem já a fazia)', async () => {
  const c = await fluxoParado({ token: 'ultimaHora' });
  const antes = c.chamadas.fetch.length;
  await provasDeRede(c);
  assert.equal(c.chamadas.fetch.length - antes, 1, 'DEFEITO: com o token na última hora, o tempo real ficou parado');
  assert.equal(c.chamadas.presencaApp.length, 0, 'religar pela prova de rede pediu o token à API');
});

test('R8-5-01 CONTROLES: o `online` religa; sem o fluxo parado a prova não reconecta (o recuo cuida); sem token, a prova pede um', async () => {
  // (a) O evento `online`, quando vem, religa como sempre.
  const a = await fluxoParado();
  const antesA = a.chamadas.fetch.length;
  for (const fn of a.win._ouv.online || []) fn();
  await tick(); await tick();
  assert.equal(a.chamadas.fetch.length - antesA, 1, 'o `online` deixou de religar o tempo real');
  // (b) Com rede, o fluxo que cai deixa o RECUO de pé: a prova de rede não
  // reconecta por cima dele (senão cada ação seria uma reconexão ao Google).
  const b = novoCliente({ agora: T, api: { fetch: async () => { throw new TypeError('Failed to fetch'); } } });
  b.P.presencaMontar();
  Object.assign(b.P.Presenca, { atualizadaEm: T, tentadaEm: T, pais: 30, tokenPedidoEm: T,
    chat: { token: 'tk', base: GOOGLE, chave: 'k', expiraEm: T + 20 * 3600e3 } });
  b.P.presencaFluxoGarantir();
  await tick(); await tick();
  assert.equal(b.timers.length, 1, 'CONTROLE: o recuo tinha que estar de pé');
  const antesB = b.chamadas.fetch.length;
  await provasDeRede(b);
  assert.equal(b.chamadas.fetch.length - antesB, 0, 'a prova de rede reconectou o tempo real com o recuo cuidando dele');
  assert.equal(b.P.Presenca.fluxoParado, false);
  // (c) Sem token, a prova de rede pede um (o caminho que já existia).
  const c = await fluxoParado({ token: null });
  await provasDeRede(c, 1);
  assert.equal(c.chamadas.presencaApp.filter((x) => x.token === true).length, 1, 'sem token, a prova de rede deixou de pedi-lo');
});
