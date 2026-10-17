// Rodada 28 (auditoria da build final), presença e conversa: cada teste nasceu de um roteiro do auditor, roda o
// `presenca.js` INTEIRO num navegador de mentira e reprova sem o conserto (sabotado no PR).
import test from 'node:test';
import assert from 'node:assert/strict';
import { novoCliente } from './_presenca-cliente.mjs';

const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };
const T0 = new Date(2026, 9, 15, 12, 0, 0).getTime();
const EU = '12444348';

// R28-5-01: a lista que saiu ANTES do `abrir` e chega com ele ainda no ar não quita o "lida" devido.
async function cenarioListaVelha(ordem, pedirLista = 'atualizar') {
  const srv = { msgs: [], lidaAte: 0 };
  const calls = [];
  const pend = { lista: null, abrir: null };
  let c;
  const api = {
    presencaApp: () => {
      const n = srv.msgs.filter((m) => m.ts > srv.lidaAte).length;
      const ult = srv.msgs[srv.msgs.length - 1];
      const val = { success: true, online: [], agora: c.relogio.agora, conversas: ult ? [{ id: '200', nome: 'Ana', naoLidas: n, atividade: ult.ts, ultima: { deMim: false, ts: ult.ts, recibo: false, texto: ult.texto, card: null } }] : [] };
      return new Promise((res) => { pend.lista = () => res(val); });
    },
    chat: (q) => {
      if (q.acao === 'abrir') {
        const mens = srv.msgs.map((m) => ({ id: m.id, ts: m.ts, classe: 'texto', de: { id: '200' }, para: { id: EU }, texto: m.texto, contexto: {} }));
        srv.lidaAte = c.relogio.agora; calls.push('abrir');
        const val = { success: true, mensagens: mens, maisAntigas: false, lida: true, agora: c.relogio.agora };
        return new Promise((res) => { pend.abrir = () => res(val); });
      }
      if (q.acao === 'lida') {
        calls.push('lida');
        srv.lidaAte = c.relogio.agora;
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true });
    },
  };
  c = novoCliente({ api, agora: T0, perfilId: Number(EU) });
  c.P.presencaMontar();
  const P = c.P.Presenca; P.desvio = 0;
  c.P.chatConhecer('200');
  const chega = (id) => {
    c.relogio.agora += 300;
    const m = { id, ts: c.relogio.agora, texto: 'oi ' + id }; srv.msgs.push(m);
    c.P.presencaMensagemDoFluxo({ classe: 'texto', id, ts: m.ts, de: { id: '200' }, para: { id: EU }, texto: m.texto, contexto: { app: 'wazeplaces' } }, false);
  };
  c.P.presencaAtualizar(); await settle(); pend.lista(); await settle();
  chega('m1'); chega('m2'); chega('m3');
  c.relogio.agora += 100; P.atualizadaEm = 0; P.tentadaEm = 0;
  // A lista velha sai por um caminho ou pelo outro: o `presencaSincronizar` (volta do fundo, «Aplicar», perfil) paga as
  // dívidas logo depois dela (R29-1-01).
  if (pedirLista === 'sincronizar') c.P.presencaSincronizar(); else c.P.presencaAtualizar();
  await settle(); const soltarLista = pend.lista;
  c.relogio.agora += 100;
  c.P.presencaAbrirConversa('200'); await settle(); const soltarAbrir = pend.abrir;
  chega('m4'); await settle();
  c.escopo.closeModal('conversaModal'); c.P.presencaEsquecerAberta(); await settle();
  c.relogio.agora += 400;
  if (ordem === 'lista-primeiro') { soltarLista(); await settle(); soltarAbrir(); await settle(); }
  else { soltarAbrir(); await settle(); soltarLista(); await settle(); }
  c.relogio.agora += 100000; P.atualizadaEm = 0; P.tentadaEm = 0;
  c.P.presencaSincronizar(); await settle(); if (pend.lista) { pend.lista(); await settle(); }
  return { calls, naoLidasNoServidor: srv.msgs.filter((m) => m.ts > srv.lidaAte).map((m) => m.id), pilula: c.P.presencaNaoLidasTotal() };
}

test('R28-5-01: a lista velha que chega com o `abrir` ainda no ar NÃO quita o "lida" — a mensagem vista fica lida no Waze', async () => {
  const r = await cenarioListaVelha('lista-primeiro');
  assert.deepEqual(r.naoLidasNoServidor, [], `ficou não lida no Waze: ${JSON.stringify(r)}`);
  assert.equal(r.pilula, 0, `a pílula ficou em ${r.pilula}`);
  assert.ok(r.calls.includes('lida'), `nenhum "lida" cobriu a mensagem vista: ${JSON.stringify(r.calls)}`);
});

test('R29-1-01: o mesmo, com a lista velha pedida pelo `presencaSincronizar` (que paga as dívidas logo depois dela)', async () => {
  const r = await cenarioListaVelha('lista-primeiro', 'sincronizar');
  assert.deepEqual(r.naoLidasNoServidor, [], `ficou não lida no Waze: ${JSON.stringify(r)}`);
  assert.equal(r.pilula, 0, `a pílula ficou em ${r.pilula}`);
  assert.ok(r.calls.includes('lida'), `nenhum "lida" cobriu a mensagem vista: ${JSON.stringify(r.calls)}`);
});

test('R28-5-01 (controle): com o `abrir` voltando ANTES da lista, o resultado é o mesmo', async () => {
  const r = await cenarioListaVelha('abrir-primeiro');
  assert.deepEqual(r.naoLidasNoServidor, [], JSON.stringify(r));
  assert.equal(r.pilula, 0);
});

// R28-5-02: reabrir não traz de volta o "Ver mensagens anteriores" de uma conversa já carregada inteira.
async function reabertura(total) {
  const todas = Array.from({ length: total }, (_, i) => ({ id: 'm' + i, ts: T0 - (total - i) * 60000, classe: 'texto', de: { id: '200' }, para: { id: EU }, texto: 't' + i, contexto: {} }));
  const chamadas = [];
  const api = { chat: async (q) => {
    chamadas.push({ acao: q.acao, antesDe: q.antesDe });
    if (q.acao === 'abrir') {
      if (q.antesDe) { const mm = todas.filter((m) => m.ts < q.antesDe); return { success: true, mensagens: mm.slice(-20), maisAntigas: mm.length > 20 }; }
      return { success: true, mensagens: todas.slice(-20), maisAntigas: total > 20, lida: true };
    }
    return { success: true };
  } };
  const c = novoCliente({ api, agora: T0, perfilId: Number(EU) });
  c.P.presencaMontar();
  const P = c.P.Presenca;
  c.P.presencaAbrirConversa('200'); await settle(8);
  while (P.historico.get('200').maisAntigas) { c.P.presencaCarregarAntigas('200'); await settle(8); }
  c.escopo.closeModal('conversaModal'); c.P.presencaEsquecerAberta(); await settle(8);
  c.P.presencaAbrirConversa('200'); await settle(8);
  const h = P.historico.get('200');
  return { maisAntigas: h.maisAntigas, botao: c.$('conversaMsgs').innerHTML.includes('conversa-anteriores'), msgs: h.msgs.length };
}

test('R28-5-02: depois de carregar a conversa inteira, reabrir NÃO mostra o "Ver mensagens anteriores"', async () => {
  const r = await reabertura(40);
  assert.equal(r.msgs, 40, 'CONTROLE: a conversa não foi carregada inteira');
  assert.equal(r.maisAntigas, false, `maisAntigas voltou a true: ${JSON.stringify(r)}`);
  assert.equal(r.botao, false, 'o botão "Ver mensagens anteriores" voltou');
});

test('R28-5-02 (controle): conversa que ainda tem mensagens mais antigas continua oferecendo o botão', async () => {
  const todas = Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i, ts: T0 - (40 - i) * 60000, classe: 'texto', de: { id: '200' }, para: { id: EU }, texto: 't' + i, contexto: {} }));
  const api = { chat: async (q) => (q.acao === 'abrir' ? { success: true, mensagens: todas.slice(-20), maisAntigas: true, lida: true } : { success: true }) };
  const c = novoCliente({ api, agora: T0, perfilId: Number(EU) });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa('200'); await settle(8);
  c.escopo.closeModal('conversaModal'); c.P.presencaEsquecerAberta(); await settle(8);
  c.P.presencaAbrirConversa('200'); await settle(8);
  assert.equal(c.P.Presenca.historico.get('200').maisAntigas, true);
  assert.ok(c.$('conversaMsgs').innerHTML.includes('conversa-anteriores'), 'o botão sumiu com mensagens mais antigas por carregar');
});

// R28-5-03: o teto de 4 s do anúncio vale também com a conversa aberta.
async function escritasDoAnuncio(aberta) {
  const c = novoCliente({ api: { chat: async () => ({ success: true, mensagens: [], maisAntigas: false, lida: true }), presencaApp: async () => ({ success: true, online: [], conversas: [] }) }, agora: T0 });
  c.P.presencaMontar();
  const P = c.P.Presenca; P.desvio = 0;
  c.P.chatConhecer('200'); c.P.chatConhecer('300');
  await c.P.presencaAtualizar(); await settle(6);
  if (aberta) { c.P.presencaAbrirConversa('200'); await settle(6); }
  const el = c.$('conversaAnuncio');
  const escritas = [];
  let v = '';
  Object.defineProperty(el, 'textContent', { get: () => v, set: (x) => { escritas.push(x); v = x; } });
  for (let i = 0; i < 3; i++) {
    c.relogio.agora += 300;
    c.P.presencaMensagemDoFluxo({ classe: 'texto', id: 'b' + i, ts: c.relogio.agora, de: { id: '300' }, para: { id: EU }, texto: 'oi ' + i, contexto: { app: 'wazeplaces' } }, false);
    await settle(6);
  }
  return escritas;
}

test('R28-5-03: com a conversa aberta, três mensagens de outra pessoa em ~1 s fazem UMA escrita na região viva (as outras esperam o teto)', async () => {
  const escritas = await escritasDoAnuncio(true);
  assert.equal(escritas.length, 1, `escritas na região viva: ${JSON.stringify(escritas)}`);
});

test('R28-5-03 (controle): sem a conversa aberta o `#conversaAnuncio` não é tocado', async () => {
  const escritas = await escritasDoAnuncio(false);
  assert.equal(escritas.length, 0, JSON.stringify(escritas));
});

// R28-1-01: colar texto enorme sem espaço no campo do código não trava a aba (regex quadrática).
import { readFileSync } from 'node:fs';
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
function fatiarFn(nome) {
  const ini = APP.indexOf(`function ${nome}(`);
  assert.ok(ini >= 0, `${nome} sumiu`);
  let prof = 0, i = APP.indexOf('{', ini);
  for (let j = i; j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}') { prof--; if (prof === 0) return APP.slice(ini, j + 1); }
  }
  throw new Error('chave não fechou');
}
function extrator() {
  const consts = ['PAIR_ALFABETO'].map((n) => {
    const m = new RegExp(`^const ${n} = ([^;]+);`, 'm').exec(APP);
    assert.ok(m, `${n} sumiu`);
    return `const ${n} = ${m[1]};`;
  }).join('\n');
  return new Function(`const PAIR_CODE_LEN = 6;\n${consts}\n${fatiarFn('extrairCodigoPareamento')}\nreturn extrairCodigoPareamento;`)();
}

test('R28-1-01: 32 KB de «a-a-a-…» no campo do código voltam em milissegundos, não em segundos', () => {
  const ext = extrator();
  assert.equal(ext('Código: K7M-4QX'), 'K7M4QX', 'CONTROLE: o extrator não acha o código normal');
  const t0 = performance.now();
  ext('a-'.repeat(16000));
  const ms = performance.now() - t0;
  assert.ok(ms < 300, `o colar de 32 KB levou ${Math.round(ms)} ms (quadrático)`);
});

test('R28-1-01 (controle): o código no começo de um texto longo ainda é achado', () => {
  const ext = extrator();
  assert.equal(ext('Código: K7M-4QX ' + 'x '.repeat(3000)), 'K7M4QX');
});

// R29-1-03: o erro do campo do código é da tentativa de antes — digitar de novo o apaga.
test('R29-1-03: digitar no campo do código esconde o erro («Digite o código…» não pode ficar com o campo preenchido)', () => {
  const APP_SEM = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(APP_SEM, /const campoDoCodigo = \$\('pairCodeInput'\);\s*campoDoCodigo\?\.addEventListener\('input', \(\) => \$\('pairEnterError'\)\?\.classList\.add\('hidden'\)\);/,
    'o campo do código não esconde o erro ao digitar');
});
