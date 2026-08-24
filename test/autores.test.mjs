// Reincidência de autor: a contagem, os dois tetos e a poda.
//
// O módulo mora no js/app.js (script de browser, não módulo), então o teste
// FATIA a fonte e a executa num escopo de mentira — mesmo padrão do
// test/qr.test.mjs. Fatiar em vez de reimplementar é o que garante que o teste
// exercite o código que roda no aparelho, e não uma cópia que envelhece.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

// ── o corte ──────────────────────────────────────────────────────────────
const INICIO = "const AUTORES_KEY = 'waze_places_autores';";
const FIM = 'function renderAutores() {';
assert.ok(fonte.includes(INICIO), 'o módulo de autores sumiu do app.js');
assert.ok(fonte.includes(FIM), 'renderAutores sumiu — o corte do teste precisa ser revisto');
const trecho = fonte.slice(fonte.indexOf(INICIO), fonte.indexOf(FIM));

function montar(agoraMs = Date.UTC(2026, 7, 24, 12)) {
  const guardado = new Map();
  const escopo = {
    AppState: { autores: null },
    localStorage: {
      getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
      setItem: (k, v) => guardado.set(k, String(v)),
      removeItem: (k) => guardado.delete(k),
    },
    safeLS: { remove: (k) => guardado.delete(k) },
    renderHistory: () => {},
    Date: { now: () => agoraMs, UTC: Date.UTC },
  };
  const nomes = Object.keys(escopo);
  const corpo = trecho + '\nreturn { registrarRejeicaoDeAutor, contagemDoAutor, listaDeAutores,'
    + ' esquecerAutor, esquecerAutores, loadAutores, podarAutores, AUTORES_KEY,'
    + ' AUTORES_MAX_REINCIDENTES, AUTORES_MAX_VISTOS, AUTORES_MAX_DIAS, AUTOR_LIMIAR_DESTAQUE };';
  const api = new Function(...nomes, corpo)(...nomes.map((n) => escopo[n]));
  return { ...api, guardado, escopo, dia: Math.floor(agoraMs / 86400000) };
}

const place = (id, nome) => ({ creatorId: id, createdBy: nome });

test('autores: a PRIMEIRA rejeição não vira contagem — vai pro anel', () => {
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  assert.equal(m.contagemDoAutor(place(111, 'world_abc')), 0,
    'uma rejeição não é reincidência, e contá-la chamaria de spammer quem errou uma vez');
  assert.deepEqual(m.listaDeAutores(), [], 'ninguém deveria aparecer na lista ainda');
  const guardado = JSON.parse(m.guardado.get(m.AUTORES_KEY));
  assert.deepEqual(guardado.v, ['111'], 'o id deveria estar no anel dos vistos-uma-vez');
});

test('autores: a SEGUNDA promove, e daí a contagem sobe de uma em uma', () => {
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  assert.equal(m.contagemDoAutor(place(111, 'world_abc')), 2);
  const guardado = JSON.parse(m.guardado.get(m.AUTORES_KEY));
  assert.deepEqual(guardado.v, [], 'ao ser promovido, o id sai do anel — senão conta duas vezes');
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  assert.equal(m.contagemDoAutor(place(111, 'world_abc')), 3);
});

test('autores: a chave é o ID, então trocar de nome NÃO perde o histórico', () => {
  // 69% dos autores da fila real são `world_xxxxx` — nome gerado, que muda no
  // dia em que a pessoa escolhe um. Pelo nome, a contagem zeraria justo aí.
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  m.registrarRejeicaoDeAutor(place(111, 'ze_das_couves'));   // escolheu um nome
  assert.equal(m.contagemDoAutor(place(111, 'ze_das_couves')), 3, 'a contagem seguiu o id');
  assert.equal(m.listaDeAutores()[0].nome, 'ze_das_couves', 'a lista mostra o nome NOVO');
});

test('autores: pedido sem autor não registra nada', () => {
  // 11% dos pedidos do tipo VENUE chegam sem `createdBy` — medido na fila real.
  const m = montar();
  for (const p of [place(null, null), place(undefined, 'x'), place('', 'y'), {}]) {
    m.registrarRejeicaoDeAutor(p);
  }
  assert.deepEqual(m.listaDeAutores(), []);
  const cru = m.guardado.get(m.AUTORES_KEY);
  assert.ok(cru === undefined || JSON.parse(cru).v.length === 0,
    'pedido sem autor não pode ocupar espaço no anel');
});

test('autores: a poda tira quem parou há mais de AUTORES_MAX_DIAS', () => {
  const m = montar();
  const a = m.loadAutores();
  a.r['111'] = [9, 'antigo', m.dia - m.AUTORES_MAX_DIAS - 1];
  a.r['222'] = [2, 'recente', m.dia];
  assert.equal(m.podarAutores(a), true, 'a poda deveria ter mexido');
  assert.deepEqual(Object.keys(a.r), ['222'], 'o antigo deveria ter saído, o recente ficado');
});

test('autores: no teto, sai quem tem a rejeição mais ANTIGA (não a menor contagem)', () => {
  const m = montar();
  const a = m.loadAutores();
  // contagem ALTA e parada informa menos que contagem 2 de hoje.
  a.r['velho'] = [99, 'velho', m.dia - 5];
  for (let i = 0; i < m.AUTORES_MAX_REINCIDENTES; i++) a.r['n' + i] = [2, 'n' + i, m.dia];
  m.podarAutores(a);
  assert.equal(Object.keys(a.r).length, m.AUTORES_MAX_REINCIDENTES, 'o teto não segurou');
  assert.ok(!a.r['velho'], 'devia sair o mais antigo, mesmo com a maior contagem');
});

test('autores: o anel também tem teto, e descarta o mais antigo', () => {
  const m = montar();
  for (let i = 0; i < m.AUTORES_MAX_VISTOS + 10; i++) m.registrarRejeicaoDeAutor(place(i, 'a' + i));
  const guardado = JSON.parse(m.guardado.get(m.AUTORES_KEY));
  assert.equal(guardado.v.length, m.AUTORES_MAX_VISTOS, 'o anel passou do teto');
  assert.equal(guardado.v[0], '10', 'os 10 primeiros deveriam ter saído pela frente');
});

test('autores: o logout apaga a lista inteira', () => {
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'a'));
  m.registrarRejeicaoDeAutor(place(111, 'a'));
  m.esquecerAutores();
  assert.equal(m.guardado.get(m.AUTORES_KEY), undefined, 'a chave sobreviveu ao logout');
  assert.equal(m.escopo.AppState.autores, null, 'o cache em memória sobreviveu ao logout');
});

test('autores: esquecer um autor tira só ele', () => {
  const m = montar();
  for (const id of [111, 222]) { m.registrarRejeicaoDeAutor(place(id, 'a' + id)); m.registrarRejeicaoDeAutor(place(id, 'a' + id)); }
  m.esquecerAutor('111');
  assert.deepEqual(m.listaDeAutores().map((x) => x.id), ['222']);
});

test('autores: armazenamento corrompido não derruba a app', () => {
  const m = montar();
  m.guardado.set(m.AUTORES_KEY, '{"v":"não é array","r":42}');
  m.escopo.AppState.autores = null;
  assert.doesNotThrow(() => m.registrarRejeicaoDeAutor(place(111, 'a')));
  assert.equal(m.contagemDoAutor(place(111, 'a')), 0);
});

// ── guardas ESTÁTICAS: o que o corte acima não alcança ───────────────────
test('autores: só REJEIÇÃO conta — marcar como lido não', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function handleActionResult');
  assert.ok(i > 0, 'handleActionResult sumiu');
  const bloco = semComentarios.slice(i, i + 900);
  assert.match(bloco, /actionType === 'reject'\s*\)\s*registrarRejeicaoDeAutor/,
    'a chamada precisa estar atrás de uma comparação estrita com reject:\n'
    + 'contar "lido" transformaria quem manda muita coisa BOA em reincidente');
});

test('autores: o selo só aparece a partir de 2, e o destaque só no limiar', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function renderSelosDeProcedencia');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('function ', i + 10));
  assert.match(bloco, /reincidente >= 2/, 'o piso de 2 saiu do selo');
  assert.match(bloco, /reincidente >= AUTOR_LIMIAR_DESTAQUE \? 'selo-reinc' : 'selo-src'/,
    'o rosa precisa ficar atrás do limiar — abaixo dele a app CONTA, não acusa');
});

test('autores: o core manda o id numérico junto com o nome', () => {
  const core = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
  const i = core.indexOf('createdBy: creatorName,');
  assert.ok(i > 0, 'o campo createdBy sumiu do core');
  assert.match(core.slice(i, i + 700), /\n\s*creatorId,/,
    'sem o creatorId a contagem cai de volta no nome, que muda sozinho');
});

// ── O LOTE ───────────────────────────────────────────────────────────────
// Guardas estáticas: o lote é uma ação SÓ, com as mesmas regras do Desfazer de
// um card. O que muda é a restauração de N e a interrupção.

test('lote: o Desfazer devolve os N na ORDEM, num unshift só', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function scheduleAction');
  const bloco = semComentarios.slice(i, i + 4200);
  assert.match(bloco, /AppState\.queue\.unshift\(\.\.\.places\)/,
    'um laço de unshift INVERTE a ordem: a fila voltaria embaralhada, sem erro visível');
  assert.doesNotMatch(bloco, /for\s*\([^)]*\)\s*AppState\.queue\.unshift/,
    'unshift dentro de laço é exatamente o jeito errado');
});

test('lote: o placar volta de N em N, não de 1 em 1', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function scheduleAction');
  const bloco = semComentarios.slice(i, i + 4200);
  assert.match(bloco, /AppState\.stats\.rejected - n\b/, 'o reverter precisa usar n, não 1');
  assert.match(bloco, /AppState\.serverTotal \+= n\b/, 'o serverTotal precisa voltar de N');
});

test('lote: interrompido ao sair, CANCELA em vez de despachar pela metade', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function descarregarAcaoPendente');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('function ', i + 10));
  assert.match(bloco, /aoSair === 'cancel'/,
    'N requisições no pagehide completam PARCIALMENTE — meio-lote enviado não tem sintoma');
  assert.match(bloco, /cancel\(true\)/,
    'o cancel do pagehide precisa GRAVAR o placar revertido: o número inflado já foi pro armazenamento');
});

test('lote: quem agenda o lote pede o cancelamento ao sair', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function rejeitarLoteDoAutor');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nasync function', i));
  assert.match(bloco, /scheduleAction\('reject', places, [^,]+, \{ aoSair: 'cancel' \}\)/,
    'sem o aoSair o lote herda o despacho do card único');
});

test('lote: "já tratado por outro editor" NÃO conta como falha', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('async function enviarLote');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('function mostrarResultadoDoLote'));
  assert.match(bloco, /already_processed[\s\S]{0,80}conta\.ja\+\+/,
    'a app já trata isso como objetivo cumprido no card único — chamar de falha aqui daria dois nomes à mesma coisa');
  assert.match(bloco, /conta\.erro\+\+[\s\S]{0,220}AppState\.queue\.push\(p\)/,
    'o que NÃO saiu tem que voltar pra fila, senão o pedido some sem ter sido tratado');
});

test('lote: o lote respeita a trava e o treino', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function rejeitarLoteDoAutor');
  const bloco = semComentarios.slice(i, i + 400);
  assert.match(bloco, /if \(acoesTravadas\(\)\) return;/, 'o lote tem que respeitar a janela em curso');
  assert.match(bloco, /if \(Treino\.ativo\)/, 'no treino a fila é de exemplos — o lote mandaria ids inertes ao Waze');
});

test('lote: o selo só abre a folha quando há pedido dele na fila', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function renderSelosDeProcedencia');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('function ', i + 10));
  assert.match(bloco, /folha: pedidosDoAutorNaFila\(place\)\.length > 0 \? place : null/,
    'selo que abre folha vazia ensina que o toque não serve pra nada');
});

test('desfazer: os dois caminhos passam pela MESMA função, e ela destrava os botões', () => {
  // Defeito que existia desde antes do lote: botão e tecla limpavam o
  // `pendingAction` e o banner, mas nunca reabilitavam os três botões do card.
  // O gesto seguia funcionando, o que escondia o problema — só o caminho
  // canônico e acessível ficava morto.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function desfazerAcaoPendente');
  assert.ok(i > 0, 'desfazerAcaoPendente sumiu');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('function ', i + 10));
  assert.match(bloco, /aplicarTravaDeAcao\(\)/,
    'sem isto o card volta do Desfazer com os três botões disabled — e disabled também tira do Tab');
  // e ninguém pode desfazer POR FORA dela
  const soltos = [...semComentarios.matchAll(/pendingAction\.undo\(\)/g)];
  assert.equal(soltos.length, 1,
    'undo() chamado fora de desfazerAcaoPendente: seria um caminho que esquece de destravar');
});

// ── RECUSA AUTOMÁTICA ────────────────────────────────────────────────────
// O único recurso que decide sobre pedido que ainda não existia quando o
// editor escolheu. Três desenhos foram feitos contra o instinto, e é isso
// que estas guardas seguram.

test('auto: a janela NÃO trava o card', () => {
  // O acoesTravadas() congela os três botões quando VOCÊ age e a app espera
  // confirmação. Aqui você não pediu nada — congelar seria pior que o problema.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function acoesTravadas');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('function ', i + 10));
  assert.doesNotMatch(bloco, /autoPendente/,
    'a recusa automática entrou na trava: o editor seria congelado por algo que não pediu');
  // e o slot é PRÓPRIO, não o pendingAction
  assert.match(fonte, /AppState\.autoPendente = \{/, 'o slot próprio sumiu');
});

test('auto: a palavra segue o tempo verbal', () => {
  // "desfazer" pressupõe que foi você quem fez, e não foi. Antes de sair é
  // CANCELAR; depois de sair não há o que cancelar e a única ação verdadeira
  // que sobra é DESLIGAR.
  const dict = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const i = dict.indexOf("'auto.futuro': '");
  const futuro = dict.slice(i, dict.indexOf("',", i));
  assert.match(futuro, /serão rejeitados/, 'o banner de antes precisa estar no FUTURO');
  assert.match(futuro, /cancelar/i, 'e oferecer cancelar, não desfazer');
  const j = dict.indexOf("'auto.feito': '");
  const feito = dict.slice(j, dict.indexOf("',", j));
  assert.match(feito, /rejeitados/, 'o banner de depois está no passado, que aí é verdade');
  assert.doesNotMatch(feito, /desfaz|cancelar/i,
    'depois de enviado, oferecer desfazer ou cancelar é mentira — a ação real é desligar');
  // e em NENHUMA língua a palavra "desfazer" aparece nas chaves da recusa automática
  for (const chave of ['auto.futuro', 'auto.feito', 'auto.cancelado', 'auto.desligado']) {
    const re = new RegExp("'" + chave.replace('.', '\\.') + "': '([^']*)'", 'g');
    for (const m of dict.matchAll(re)) {
      assert.doesNotMatch(m[1], /desfaz|undo|deshac|annuler l|défaire/i,
        `${chave} usa uma palavra de desfazer: "${m[1]}"`);
    }
  }
});

test('auto: sair no meio da janela CANCELA, e o logout também', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function descarregarRecusaAutomatica');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('function ', i + 10));
  assert.match(bloco, /autoPendente\.cancelar\(\)/,
    'N requisições no pagehide completam parcialmente — meio-lote sem sintoma nenhum');
  assert.match(semComentarios, /pagehide', descarregarRecusaAutomatica/, 'o pagehide não está ligado');
  const j = semComentarios.indexOf('async function handleLogout');
  assert.match(semComentarios.slice(j, j + 2500), /autoPendente\.cancelar\(\)/,
    'no logout nada pode ser enviado');
});

test('auto: nada acontece sem o portão, nem no treino', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function aplicarRecusaAutomatica');
  const bloco = semComentarios.slice(i, i + 400);
  assert.match(bloco, /if \(!podeRecusarAutomaticoAqui\(\)\) return;/, 'o portão saiu da recusa automática');
  assert.match(bloco, /if \(Treino\.ativo\) return;/, 'no treino a fila é de exemplos');
  assert.match(bloco, /if \(AppState\.autoPendente\) return;/, 'duas janelas ao mesmo tempo perderiam uma');
});

test('auto: o interruptor só aparece pra quem passa no portão', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function renderAutores');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('function ', i + 10));
  // Amarrado na ESTRUTURA, não na proximidade. `renderAutores` chama
  // `podeRecusarAutomaticoAqui()` duas vezes — a outra decide a descrição —, e
  // as duas tentativas por distância falharam nos dois sentidos: 60 caracteres
  // reprovavam o código certo quando o markup cresceu, e 300 alcançavam a
  // chamada errada e deixavam passar o portão arrancado. O que não tem esse
  // problema é exigir a condição COLADA no que ela guarda.
  assert.match(bloco, /\+ \(podeRecusarAutomaticoAqui\(\)\s*\?\s*`<label/,
    'o interruptor precisa estar atrás do portão: mostrá-lo desabilitado anunciaria'
    + ' um recurso que a pessoa não pode usar');
});

test('auto: a janela é mais longa que a do Desfazer, e o motivo é medido', () => {
  // 8s ficaram "exatamente no limite" pra o owner notar e ler um banner que não
  // esperava (ver o banner de conquista). Aqui ele espera ainda menos.
  const m = fonte.match(/const AUTO_CANCELAR_MS = (\d+);/);
  assert.ok(m, 'AUTO_CANCELAR_MS sumiu');
  const u = fonte.match(/const UNDO_WINDOW_MS = (\d+);/);
  assert.ok(parseInt(m[1], 10) > parseInt(u[1], 10) * 2,
    'a janela do automático precisa ser bem maior que a do Desfazer: o editor não está olhando');
});
