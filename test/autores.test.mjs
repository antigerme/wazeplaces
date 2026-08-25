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
  assert.match(bloco, /conta\.erro\+\+[\s\S]{0,420}AppState\.queue\.push\(p\)/,
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

test('auto: não existe ESPERA entre decidir e enviar', () => {
  // Houve uma janela de 20s aqui, com oferta de cancelar. Saiu por decisão do
  // owner: ela começava quando o APP BUSCA a fila — sempre no meio de outro
  // card —, então eram 20s parados sobre algo que ninguém estava olhando.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('async function aplicarRecusaAutomatica');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nfunction ', i));
  assert.doesNotMatch(bloco, /setTimeout|AUTO_CANCELAR_MS/,
    'voltou a esperar antes de enviar: a janela foi removida de propósito');
  assert.match(bloco, /await enviarLote\(/, 'o envio precisa ser direto');
});

test('auto: o placar conta AO LANDAR, nunca antes', () => {
  // É isto que substitui o cancelamento. Sem janela, um placar otimista deixaria
  // números que nunca saíram se a página morresse no meio do laço — e não haveria
  // quando reconciliar. Contando ao landar, o que está na tela é o que foi enviado.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('async function aplicarRecusaAutomatica');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nfunction ', i));
  assert.match(bloco, /contarAoLandar: true/, 'a recusa automática precisa contar ao landar');
  assert.doesNotMatch(bloco, /AppState\.stats\.rejected \+=/,
    'somar o placar antes de enviar é exatamente o que não pode acontecer sem janela');
  // e do outro lado: o lote MANUAL segue otimista, porque tem Desfazer que devolve
  const k = semComentarios.indexOf('function rejeitarLoteDoAutor');
  const manual = semComentarios.slice(k, semComentarios.indexOf('\nasync function', k));
  assert.match(manual, /AppState\.stats\.rejected \+= n/,
    'o lote manual tem janela de Desfazer: ali o otimista é o certo');
});

test('auto: o aviso CONTA enquanto acontece', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('async function aplicarRecusaAutomatica');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nfunction ', i));
  assert.match(bloco, /aoProgredir:/, 'sem progresso o aviso vira um número parado');
  assert.match(bloco, /aviso\.texto\(/, 'o texto precisa mudar NO LUGAR, não empilhar um toast por pedido');
  assert.match(bloco, /aviso\.dispensar\(\)/, 'o aviso de progresso precisa sair quando o laço acaba');
});

test('auto: a palavra nunca promete desfazer nem cancelar', () => {
  // "desfazer" pressupõe que foi VOCÊ quem fez, e não foi. E depois de enviado
  // não há o que cancelar: a única ação verdadeira que sobra é DESLIGAR.
  const dict = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  for (const chave of ['auto.andando', 'auto.andandoPlural', 'auto.feito', 'auto.feitoPlural', 'auto.desligado']) {
    const re = new RegExp("'" + chave.replace('.', '\\.') + "': '([^']*)'", 'g');
    const achadas = [...dict.matchAll(re)];
    assert.equal(achadas.length, 4, `${chave} não está nas 4 línguas`);
    for (const m of achadas) {
      assert.doesNotMatch(m[1], /desfaz|undo|deshac|défaire|cancel|annul/i,
        `${chave} promete desfazer ou cancelar, e não há nem um nem outro: "${m[1]}"`);
    }
  }
  // Passado no fim (aí é verdade), e o par singular/plural existe — o projeto
  // não tem ICU, então "1 pedidos" só não acontece se as duas chaves existirem.
  const feito = dict.slice(dict.indexOf("'auto.feito': '"));
  assert.match(feito.slice(0, 90), /rejeitad[oa]/, 'o aviso do fim precisa estar no passado');
  for (const base of ['auto.andando', 'auto.feito']) {
    assert.ok(dict.includes("'" + base + "Plural': '"), `${base} sem par plural: "1 pedidos" volta`);
  }
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  assert.match(semComentarios, /q === 1 \? 'auto\.andando' : 'auto\.andandoPlural'/,
    'a escolha de plural precisa ser explícita (o projeto não usa ICU)');
});

test('auto: nada acontece sem o portão, nem no treino, nem duas vezes ao mesmo tempo', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('async function aplicarRecusaAutomatica');
  const bloco = semComentarios.slice(i, i + 400);
  assert.match(bloco, /if \(!podeRecusarAutomaticoAqui\(\)\) return;/, 'o portão saiu da recusa automática');
  assert.match(bloco, /if \(Treino\.ativo\) return;/, 'no treino a fila é de exemplos');
  assert.match(bloco, /if \(recusaAutomaticaRodando\) return;/,
    'a fila pode crescer durante o laço: duas passagens mandariam o mesmo pedido duas vezes');
});

test('auto: os pedidos saem da fila ANTES de serem enviados', () => {
  // Senão o editor veria como card um pedido que a app já está rejeitando, e
  // poderia agir nele — dois envios pro mesmo pedido.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('async function aplicarRecusaAutomatica');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nfunction ', i));
  const iFila = bloco.indexOf('AppState.queue = AppState.queue.filter');
  const iEnvio = bloco.indexOf('await enviarLote(');
  assert.ok(iFila > 0 && iEnvio > iFila, 'a fila tem que ser limpa antes do envio começar');
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


test('marca: o dia de MARCAR é campo próprio, separado da última rejeição', () => {
  // O 3º campo (última rejeição) anda sozinho a cada pedido dela — inclusive
  // pelas rejeições automáticas, que são justamente o que um marcado gera. Se a
  // frase "marcado há N dias" saísse dele, ela diria "marcado hoje" para alguém
  // marcado há meses, e a anistia dos 30 dias ficaria invisível na tela.
  const m = montar();
  // Entrada marcada HÁ 22 DIAS (o `alternarAutoDoAutor` mora fora do corte, então
  // o carimbo entra direto no armazenamento — é o estado que ele produz).
  m.guardado.set(m.AUTORES_KEY, JSON.stringify({
    v: [], r: { '111': [9, 'entregas', m.dia - 22, 1, m.dia - 22] },
  }));
  m.registrarRejeicaoDeAutor(place(111, 'entregas'));   // chega mais um pedido HOJE
  const e = m.loadAutores().r['111'];
  assert.equal(e[2], m.dia, 'a última rejeição tem que andar');
  assert.equal(e[4], m.dia - 22, 'o dia da MARCA não pode andar junto');
  assert.equal(m.listaDeAutores()[0].marcadoEm, m.dia - 22,
    'a lista precisa expor o dia da marca, não o da última rejeição');
});

test('marca: quem não é marcado não carrega o campo', () => {
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'a'));
  m.registrarRejeicaoDeAutor(place(111, 'a'));
  assert.equal(m.loadAutores().r['111'].length, 3, 'campo a mais em 500 registros é peso à toa');
  assert.equal(m.listaDeAutores()[0].marcadoEm, null, 'sem marca, sem frase');
});

test('marca: desligar apaga o campo, e não deixa lixo', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function alternarAutoDoAutor');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nlet ', i));
  assert.match(bloco, /if \(e\[3\] === 1\) e\[4\] = diaDeHoje\(\);/, 'ligar precisa carimbar o dia');
  assert.match(bloco, /else e\.length = 4;/, 'desligar precisa apagar o carimbo');
});

test('marca: a frase é em DIAS, não no formatador de horas do app', () => {
  // A marca guarda o dia. Usar o formatRelativeTime (que desce a horas) fazia
  // algo marcado de manhã aparecer como "marcado há 12h".
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function marcadoQuando');
  assert.ok(i > 0, 'marcadoQuando sumiu');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nfunction ', i));
  assert.doesNotMatch(bloco, /formatRelativeTime/,
    'o formatador de horas promete precisão que o dado não tem');
  assert.match(bloco, /n === 1 \? 'stats\.autores\.marcadoDias' : 'stats\.autores\.marcadoDiasPlural'/,
    'plural explícito (o projeto não usa ICU)');
  assert.match(bloco, /n <= 0\) return t\('stats\.autores\.marcadoHoje'\)/, 'faltou o caso de hoje');
  const dict = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  for (const k of ['marcadoHoje', 'marcadoDias', 'marcadoDiasPlural']) {
    const n = [...dict.matchAll(new RegExp("'stats\\.autores\\." + k + "':", 'g'))].length;
    assert.equal(n, 4, `stats.autores.${k} não está nas 4 línguas`);
  }
});

test('marca: a linha só aparece para quem ESTÁ marcado', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function listaDeAutores');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nfunction ', i));
  assert.match(bloco, /marcadoEm: e\[3\] === 1 && Number\.isFinite\(e\[4\]\) \? e\[4\] : null/,
    'sem o teste do flag, um registro antigo com lixo no 4º campo viraria uma data');
  const j = semComentarios.indexOf('function renderAutores');
  const render = semComentarios.slice(j, semComentarios.indexOf('\nfunction ', j + 10));
  assert.match(render, /a\.marcadoEm\s*\n?\s*\?/, 'a frase precisa estar atrás do campo');
});

test('marca: a frase ocupa a linha INTEIRA, não a coluna do nome', () => {
  // Medido: o selo, o interruptor e a lixeira apertam a coluna do nome a ~55px
  // num Fold de 280px. Lá dentro, "marqué il y a 22 jours" quebrava em três
  // pedaços ("marqué il / y a 22 / jours"). Como item de largura cheia ela cabe
  // em UMA linha nos quatro idiomas, e a largura do nome não muda (medido nos
  // dois arranjos: 51/55/58/58px em ambos).
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const j = semComentarios.indexOf('function renderAutores');
  const render = semComentarios.slice(j, semComentarios.indexOf('\nfunction ', j + 10));
  const linha = render.match(/`<div class="autor-lin ([^"]*)"/);
  assert.ok(linha, 'a linha do autor perdeu a classe autor-lin');
  assert.match(linha[1], /\bflex-wrap\b/, 'sem flex-wrap o basis-full não manda a data pra outra linha');
  // A data precisa ser IRMÃ dos controles, não filha da coluna do nome — é o
  // que `basis-full` só consegue fazer estando no mesmo flex container.
  const data = render.match(/a\.marcadoEm\s*\n?\s*\?\s*`<span class="([^"]*)"/);
  assert.ok(data, 'o <span> da data mudou de forma');
  assert.match(data[1], /\bbasis-full\b/,
    'sem basis-full a data volta a dividir a coluna apertada com o nome');
});
