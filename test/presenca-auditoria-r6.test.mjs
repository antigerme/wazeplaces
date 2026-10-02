// A presença e a conversa depois da auditoria de 2026-10-01 (rodada 6, R6-5):
// a dívida do "lida" que abrir outra conversa apagava, o "invisível" pendente
// que fechar o app perdia, o diário cheio do desligar repetido, o banner do
// Desfazer por cima da conversa e a conversa sem saída na espera do perfil. Os
// rótulos R6-5-n são os do relatório dessa rodada. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
//
// Dois instrumentos: o js/presenca.js INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs`, e as funções do app.js FATIADAS e rodadas num escopo
// de mentira (o padrão de test/presenca-wme.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const EU = '12444348';
const CAF = '183164343';
const OUTRA = '555000111';
const APP_CTX = { app: 'wazeplaces' };
const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const inbox = (bytes, n = 1) => ({ inboxMessage: { messageId: uuid(900 + n), messageType: 'X', message: b64(bytes) } });
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
const lidas = (c, com) => c.chamadas.chat.filter((x) => x.acao === 'lida' && (!com || x.com === com));
const chega = async (c, n, de) => c.P.presencaQuadro(fluxoDe(c),
  inbox(await bytesDeMensagem({ id: uuid(n), de, para: EU, texto: 'msg ' + n, ctx: APP_CTX, ts: T + n }), n));
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };

// O Waze de mentira: o "lida" falha enquanto `rede.fora`, e `naoLida` é o que
// segue NÃO LIDO no Waze (o que a lista seguinte devolveria como "mensagem nova").
function comWaze() {
  const rede = { fora: false };
  const naoLida = new Set();
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') { naoLida.delete(x.com); return { success: true, mensagens: [], maisAntigas: false, lida: true }; }
    if (x.acao === 'lida') {
      if (rede.fora) return { success: false, errorCategory: 'transient', _motivo: 'TypeError' };
      naoLida.delete(x.com);
      return { success: true };
    }
    return { success: true };
  } } });
  return { c, rede, naoLida };
}

// A conversa com a CAF aberta, uma mensagem dela vista, e o "lida" falhando na
// rajada E no fechamento: a dívida fica.
async function comDividaDaCaf() {
  const m = comWaze();
  m.c.P.presencaAbrirConversa(CAF);
  await tick();
  m.rede.fora = true;
  await chega(m.c, 1, CAF);
  m.naoLida.add(CAF);
  await m.c.rodarTimers();                                  // a rajada: falha
  await tick();
  fechar(m.c);                                              // o fechamento paga… e falha de novo
  await tick();
  m.rede.fora = false;                                      // o sinal volta
  return m;
}

// O app.js, fatiado.
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) {
      const corpo = APP_SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
function montar(nomes, deps) {
  const chaves = Object.keys(deps);
  return new Function(...chaves, nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]));
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// ── R6-5-1: a dívida do "lida" mora num CONJUNTO, separado da rajada ────────

test('R6-5-1 abrir OUTRA conversa (mesmo vazia) não apaga a dívida do "lida": o fechamento dela a paga', async () => {
  const m = await comDividaDaCaf();
  assert.equal(lidas(m.c, CAF).length, 2, 'CONTROLE: a rajada e o fechamento tinham que ter tentado (e falhado)');
  m.c.$('conversaModal').classList.remove('hidden');
  m.c.P.presencaAbrirConversa(OUTRA);                       // a conversa com outra pessoa, sem mensagem nenhuma
  await tick();
  await m.c.rodarTimers();                                  // a rajada da outra (nada a marcar nela)
  await tick();
  fechar(m.c);
  await tick();
  assert.equal(m.naoLida.has(CAF), false, 'DEFEITO: abrir outra conversa apagou a dívida — a mensagem vista segue NÃO LIDA no Waze');
  assert.equal(lidas(m.c, CAF).length, 3, 'o "lida" devido não saiu (ou saiu mais de uma vez)');
  assert.equal(m.c.P.Presenca.lidaDevendo.size, 0, 'paga, a dívida ficou');
  // E não sai de novo no próximo `presencaSincronizar`.
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(m.c, CAF).length, 3, 'a dívida paga saiu de novo');
});

test('R6-5-1 CONTROLE: sem abrir outra conversa, a dívida sai no próximo `presencaSincronizar`', async () => {
  const m = await comDividaDaCaf();
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(m.naoLida.has(CAF), false, 'o `presencaSincronizar` deixou de pagar a dívida');
  assert.equal(lidas(m.c, CAF).length, 3);
});

test('R6-5-1 a falha que chega com a rajada de OUTRA conversa correndo também vira dívida — e o fechamento paga as duas', async () => {
  let soltarA = null;
  const naoLida = new Set([CAF]);
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') return { success: true, mensagens: [], maisAntigas: false, lida: true };
    if (x.acao === 'lida' && x.com === CAF && !soltarA) return new Promise((ok) => { soltarA = ok; });
    if (x.acao === 'lida') { naoLida.delete(x.com); return { success: true }; }
    return { success: true };
  } } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  await chega(c, 3, CAF);
  await c.rodarTimers();                                    // o "lida" da CAF sai e fica no ar
  fechar(c);
  c.$('conversaModal').classList.remove('hidden');
  c.P.presencaAbrirConversa(OUTRA);
  await tick();
  await chega(c, 4, OUTRA);
  assert.equal(c.P.Presenca.lidaPendente, OUTRA, 'CONTROLE: a rajada da outra tem que estar correndo');
  soltarA({ success: false, errorCategory: 'transient', _motivo: 'TypeError' });
  await tick();
  assert.deepEqual([...c.P.Presenca.lidaDevendo], [CAF], 'DEFEITO: a falha da CAF, com a rajada da outra correndo, nem virou dívida');
  await c.rodarTimers();                                    // a rajada da outra sai
  await tick();
  fechar(c);                                                // e o fechamento paga a dívida da CAF
  await tick();
  assert.equal(lidas(c, OUTRA).length, 1, 'a rajada da outra não saiu');
  assert.equal(lidas(c, CAF).length, 2, 'a dívida da CAF não foi paga no fechamento');
  assert.equal(naoLida.has(CAF), false, 'a mensagem vista da CAF segue não lida no Waze');
});

test('R6-5-1 a mensagem que chega FORA DA VISTA tira a dívida da conversa: pagar a marcaria como lida sem ninguém ter visto', async () => {
  const m = await comDividaDaCaf();
  assert.deepEqual([...m.c.P.Presenca.lidaDevendo], [CAF], 'CONTROLE: tem que haver a dívida');
  await chega(m.c, 2, CAF);                                 // uma mensagem NOVA da CAF, com a conversa fechada
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(m.c, CAF).length, 2, 'DEFEITO: o "lida" da conversa inteira saiu com uma mensagem que ninguém viu');
  assert.equal(m.c.P.presencaNaoLidasDe(CAF), 1, 'a mensagem nova sumiu da conta sem ter sido vista');
});

test('R6-5-1 a rajada em curso da MESMA conversa não é adiantada pela dívida: ela a cobre', async () => {
  const respostas = [{ success: false, errorCategory: 'transient', _motivo: 'TypeError' }, { success: true }, { success: true }];
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
    ? { success: true, mensagens: [], maisAntigas: false, lida: true }
    : x.acao === 'lida' ? (respostas.shift() || { success: true }) : { success: true }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  await chega(c, 5, CAF);
  await c.rodarTimers();                                    // a rajada falha: dívida (a conversa segue aberta)
  await tick();
  await chega(c, 6, CAF);                                   // chega outra, na tela: a rajada corre de novo
  await c.P.presencaSincronizar();                          // não adianta a rajada
  await tick();
  assert.equal(lidas(c, CAF).length, 1, 'o `presencaSincronizar` adiantou a rajada em curso (um pedido por mensagem)');
  await c.rodarTimers();
  await tick();
  assert.equal(lidas(c, CAF).length, 2, 'CONTROLE: a rajada tem que sair no prazo');
  assert.equal(c.P.Presenca.lidaDevendo.size, 0, 'o "lida" da rajada cobre a conversa inteira: a dívida tinha que sair');
});

test('R6-5-1 o "lida" que falha entra no diário — uma linha por minuto no máximo, com quantos vieram juntos', async () => {
  const m = await comDividaDaCaf();
  const linhas = () => m.c.chamadas.dfato.filter(([k]) => k === 'chat.lida');
  assert.deepEqual(linhas().map(([, o]) => o), [{ ok: false, categoria: 'transient', juntas: 1 }],
    'a falha do "lida" não foi pro diário (ou foi uma linha por falha)');
  // Mais uma falha, passado o minuto: uma linha, contando as duas desde a anterior.
  m.rede.fora = true;
  m.c.relogio.agora += 61_000;
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(linhas().length, 2);
  assert.deepEqual(linhas()[1][1], { ok: false, categoria: 'transient', juntas: 2 });
});

test('R6-5-1 o "Sair", a troca de conta e a queda DESCARTAM a dívida — nada sai com a sessão de outra pessoa', async () => {
  const m = await comDividaDaCaf();
  assert.equal(m.c.P.Presenca.lidaDevendo.size, 1, 'CONTROLE: tem que haver a dívida');
  // O "Sair", na ordem do `handleLogout`: a sessão, o perfil e o `authenticated`
  // saem ANTES do `presencaEsquecer`.
  m.c.API.getSession = () => null;
  m.c.AppState.profile = null;
  m.c.AppState.authenticated = false;
  m.c.P.presencaEsquecer();
  assert.equal(m.c.P.Presenca.lidaDevendo.size, 0, 'a dívida (de quem é a conversa: dado de terceiro) ficou na memória depois do "Sair"');
  // Outra conta entra: nada da anterior sai pela sessão dela.
  m.c.API.getSession = () => 'token-da-outra';
  m.c.AppState.authenticated = true;
  m.c.AppState.profile = { id: Number(CAF), userName: 'outra conta' };
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(m.c, CAF).length, 2, 'a dívida da conta que saiu foi paga pela sessão de outra');
});

