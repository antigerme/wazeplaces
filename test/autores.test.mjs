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
    + ' esquecerAutor, esquecerAutores, loadAutores, podarAutores, AUTORES_KEY, AUTORES_VISIVEIS,'
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

// O anel expira por CAPACIDADE e o mapa por IDADE — então o teto do anel tem
// que COBRIR a janela do mapa, senão a app para de promover quem foi rejeitado
// no dia 1 e no dia 25 (o id do dia 1 já saiu por lotação) e a promessa do card
// quebra em SILÊNCIO. Foi o defeito real: com 2.000, a fila do owner dava 19
// dias contra os 30 prometidos.
//
// Este teste é o que impede baixar o anel ou subir os dias sem refazer a conta.
test('autores: o anel cobre a janela de dias que o card promete', () => {
  const m = montar();
  // Rejeições que ENTRAM no anel por dia, medido na fila real do owner: 856
  // numa semana (~120/dia), das quais ~100 são autores de primeira viagem.
  const POR_DIA = 100;
  const diasCobertos = m.AUTORES_MAX_VISTOS / POR_DIA;
  assert.ok(diasCobertos >= m.AUTORES_MAX_DIAS,
    `o anel guarda ${diasCobertos} dias de rejeições mas o card promete `
    + `${m.AUTORES_MAX_DIAS}: quem for rejeitado depois disso não é promovido, `
    + 'e nada avisa. Suba AUTORES_MAX_VISTOS ou refaça a conta de POR_DIA.');
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

test('selo vermelho é SEMPRE tocável, e a folha é que se adapta ao tamanho da fila', () => {
  // O selo vermelho já esteve amarrado TAMBÉM a `pedidosDoAutorNaFila > 1`, e o
  // owner reportou o sintoma: `✕ 8` vermelho e morto na tela. Em ~3 de cada 4
  // cards o autor é o único dele na fila (27,3% têm outro, medido em 2.785
  // cards dos 6 países), então a condição extra matava o caso COMUM.
  //
  // O raciocínio que a produziu continua certo — com um só na fila, "Ver o 1" e
  // "Rejeitar o 1" são o card que já está na tela, e a segunda é PIOR que o ✕
  // (o lote não tem a janela de Desfazer). O erro foi cortar o botão em vez de
  // cortar as duas linhas. Este teste trava as DUAS metades do conserto.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');

  const iSelo = semComentarios.indexOf('function renderSelosDeProcedencia');
  const selo = semComentarios.slice(iSelo, semComentarios.indexOf('function ', iSelo + 10));
  assert.match(selo, /folha: reincidente >= AUTOR_LIMIAR_DESTAQUE \? place : null/,
    'a cor é a promessa: selo vermelho sem toque é promessa quebrada');
  assert.ok(!/folha:[^,]*pedidosDoAutorNaFila/.test(selo),
    'a contagem da fila decide o CONTEÚDO da folha, nunca se ela abre');
  assert.ok(!/folha: pedidosDoAutorNaFila\(place\)\.length > 1 \? place/.test(selo),
    'sem o limiar, a app oferece rejeição em lote pra quem ela nem acusa');

  const iFolha = semComentarios.indexOf('function abrirFolhaDoAutor');
  const folha = semComentarios.slice(iFolha, semComentarios.indexOf('\nfunction ', iFolha + 10));
  assert.match(folha, /const emLote = naFila\.length > 1;/,
    'é aqui que o tamanho da fila decide, e não no selo');
  // As duas linhas de lote e o aviso vermelho ficam DENTRO do ternário do
  // `emLote` — exigido COLADO nos dois extremos (`(emLote ?` … `: '')`), e não
  // por distância: guard por distância erra nos dois sentidos (gotcha #67).
  assert.match(folha,
    /\(emLote\s*\?\s*linha\(ICONE_OLHO[\s\S]{0,400}?autor\.sheet\.rejeitar[\s\S]{0,140}?:\s*''\)/,
    'ver/rejeitar precisam morrer juntos quando há um só na fila — a de rejeitar é PIOR que o ✕ (sem Desfazer)');
  assert.match(folha,
    /\(emLote\s*\?\s*`<p class="mt-4[\s\S]{0,400}?autor\.sheet\.aviso[\s\S]{0,60}?:\s*''\)/,
    'o aviso descreve a rejeição em lote: sem ela na tela ele passa a descrever o interruptor errado');

  // O que substitui as linhas removidas, e por isso não pode ser condicional ao
  // lote: sem isso a folha do caso comum abre vazia.
  assert.match(folha, /t\('stats\.autores\.esquecer'\)/, 'o esquecer vale nos dois tamanhos');
  assert.match(folha, /podeRecusarAutomaticoAqui\(\) \? linhaAuto\(\) : ''/,
    'o interruptor da recusa automática usa o MESMO portão da lista do Histórico');
  assert.ok(!/emLote[\s\S]{0,200}linhaAuto\(\)/.test(folha),
    'o interruptor não pode depender do tamanho da fila');
});

test('folha do autor: esquecer refaz o card, senão o selo apagado fica na tela', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf("getElementById('autorEsquecer')");
  assert.ok(i !== -1, 'a linha de esquecer sumiu da folha');
  const bloco = semComentarios.slice(i, i + 320);
  assert.match(bloco, /esquecerAutor\(chave\)/, 'esquece pela CHAVE (creatorId), nunca pelo nome');
  assert.match(bloco, /removeCurrentCardEl\(\);\s*\n?\s*showCurrentPlace\(\);/,
    'sem refazer o card, o `✕ N` segue na tela afirmando a contagem que acabou de ser apagada');
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
  // não há o que cancelar. O aviso é só acompanhamento: conta e some.
  const dict = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  for (const chave of ['auto.andando', 'auto.andandoPlural']) {
    const re = new RegExp("'" + chave.replace('.', '\\.') + "': '([^']*)'", 'g');
    const achadas = [...dict.matchAll(re)];
    assert.equal(achadas.length, 4, `${chave} não está nas 4 línguas`);
    for (const m of achadas) {
      assert.doesNotMatch(m[1], /desfaz|undo|deshac|défaire|cancel|annul/i,
        `${chave} promete desfazer ou cancelar, e não há nem um nem outro: "${m[1]}"`);
    }
  }
  assert.ok(dict.includes("'auto.andandoPlural': '"), 'sem par plural: "1 pedidos" volta');
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  assert.match(semComentarios, /q === 1 \? 'auto\.andando' : 'auto\.andandoPlural'/,
    'a escolha de plural precisa ser explícita (o projeto não usa ICU)');
});

test('auto: o aviso SOME quando acaba — nenhum banner sobra depois', () => {
  // Decisão do owner: "a ideia do toast é só informar". Havia um banner de fim
  // de 20s com "toque para desligar isto"; ele dizia "N rejeitados" com o N
  // ORIGINAL, então mentia justamente quando algo falhava. Quem falha volta
  // pra fila e reaparece como card — é esse o retorno de erro.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('async function aplicarRecusaAutomatica');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\n}\n', i));
  assert.match(bloco, /finally \{[^}]*aviso\.dispensar\(\);/,
    'o aviso tem que ser dispensado no finally — inclusive quando o laço estoura');
  assert.doesNotMatch(bloco, /auto\.feito/, 'o banner de fim voltou');
  assert.doesNotMatch(bloco, /auto\.desligado/, 'a ação de desligar voltou pro banner');
  // showToast só uma vez em todo o fluxo: o acompanhamento, e nada depois.
  const chamadas = [...bloco.matchAll(/showToast\(/g)].length;
  assert.equal(chamadas, 1, `showToast chamado ${chamadas}x; esperado 1 (só o acompanhamento)`);
  const dict = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  for (const morta of ['auto.feito', 'auto.feitoPlural', 'auto.desligado']) {
    assert.ok(!dict.includes("'" + morta + "'"), `${morta} ficou no dicionário sem ninguém usar`);
  }
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


test('data: a linha mostra a ÚLTIMA REJEIÇÃO, e o registro tem só os 4 campos', () => {
  // Não há campo novo pra isto: o 3º campo já é o dia da última rejeição, e é
  // ELE que a poda usa. Ou seja, a linha é o relógio da anistia à vista —
  // 30 dias depois do que ela mostra, o autor sai da lista.
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'entregas'));
  m.registrarRejeicaoDeAutor(place(111, 'entregas'));
  const e = m.loadAutores().r['111'];
  assert.equal(e.length, 3, 'quantas vezes, nome, dia — e o 4º só ao ligar o automático');
  assert.equal(e[2], m.dia, 'o 3º campo é o dia da última rejeição');
  assert.equal(m.listaDeAutores()[0].dia, m.dia, 'é ele que a lista expõe');
});

test('data: a última rejeição ANDA a cada pedido novo, inclusive automático', () => {
  // Isto é o comportamento, não um efeito colateral: a recusa automática passa
  // pelo mesmo `registrarRejeicaoDeAutor`, então quem continua mandando tem a
  // data (e a anistia) renovada. A linha na tela é o que torna isso visível.
  const m = montar();
  m.guardado.set(m.AUTORES_KEY, JSON.stringify({
    v: [], r: { '111': [9, 'entregas', m.dia - 22, 1] },
  }));
  assert.equal(m.listaDeAutores()[0].dia, m.dia - 22, 'antes: parada há 22 dias');
  m.registrarRejeicaoDeAutor(place(111, 'entregas'));
  assert.equal(m.listaDeAutores()[0].dia, m.dia, 'depois: a data andou pra hoje');
});

test('data: ligar e desligar o automático NÃO mexe na data nem cria campo', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function alternarAutoDoAutor');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nlet ', i));
  assert.match(bloco, /e\[3\] = e\[3\] === 1 \? 0 : 1;/, 'o interruptor é o 4º campo, e só');
  assert.doesNotMatch(bloco, /e\[4\]/, 'não existe 5º campo — a data já mora no 3º');
  assert.doesNotMatch(bloco, /e\[2\]/, 'ligar o automático não é uma rejeição, não pode mexer na data');
});

test('data: a frase é em DIAS, não no formatador de horas do app', () => {
  // O dado é o dia. O formatRelativeTime desce a horas e fazia algo rejeitado
  // de manhã virar "há 12h" — precisão que o dado não tem.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function rejeitadoQuando');
  assert.ok(i > 0, 'rejeitadoQuando sumiu');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\nfunction ', i));
  assert.doesNotMatch(bloco, /formatRelativeTime/,
    'o formatador de horas promete precisão que o dado não tem');
  assert.match(bloco, /n === 1 \? 'stats\.autores\.rejeitadoDias' : 'stats\.autores\.rejeitadoDiasPlural'/,
    'plural explícito (o projeto não usa ICU)');
  assert.match(bloco, /n <= 0\) return t\('stats\.autores\.rejeitadoHoje'\)/, 'faltou o caso de hoje');
  const dict = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  for (const k of ['rejeitadoHoje', 'rejeitadoDias', 'rejeitadoDiasPlural']) {
    const n = [...dict.matchAll(new RegExp("'stats\\.autores\\." + k + "':", 'g'))].length;
    assert.equal(n, 4, `stats.autores.${k} não está nas 4 línguas`);
  }
});

test('data: a linha aparece pra TODO autor da lista, marcado ou não', () => {
  // Todo autor da lista tem última rejeição — é o que o põe lá. Esconder de
  // quem não está no automático seria esconder o relógio da anistia justamente
  // de quem só tem esse relógio.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const j = semComentarios.indexOf('function renderAutores');
  const render = semComentarios.slice(j, semComentarios.indexOf('\nfunction ', j + 10));
  assert.match(render, /rejeitadoQuando\(a\.dia\)/, 'a linha tem que ler o dia da última rejeição');
  assert.doesNotMatch(render, /marcadoEm/, 'o campo do dia da marca não existe mais');
  const trecho = render.slice(render.indexOf('rejeitadoQuando') - 400, render.indexOf('rejeitadoQuando'));
  assert.doesNotMatch(trecho, /podeRecusarAutomaticoAqui\(\)\s*\n?\s*\?[^`]*`<span class="basis-full/,
    'a linha não pode ficar atrás do portão do automático');
});

test('data: a frase ocupa a linha INTEIRA, não a coluna do nome', () => {
  // Medido: o selo, o interruptor e a lixeira apertam a coluna do nome a ~55px
  // num Fold de 280px. Lá dentro, "rejeté il y a 22 jours" quebrava em três
  // pedaços. Como item de largura cheia ela cabe em UMA linha nos 4 idiomas, e
  // a largura do nome não muda (medido nos dois arranjos: 51/55/58/58px).
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const j = semComentarios.indexOf('function renderAutores');
  const render = semComentarios.slice(j, semComentarios.indexOf('\nfunction ', j + 10));
  const linha = render.match(/`<div class="autor-lin ([^"]*)"/);
  assert.ok(linha, 'a linha do autor perdeu a classe autor-lin');
  assert.match(linha[1], /\bflex-wrap\b/, 'sem flex-wrap o basis-full não manda a data pra outra linha');
  const data = render.match(/`<span class="([^"]*)">`\s*\n\s*\+ `\$\{escapeHtml\(rejeitadoQuando/);
  assert.ok(data, 'o <span> da data mudou de forma');
  assert.match(data[1], /\bbasis-full\b/,
    'sem basis-full a data volta a dividir a coluna apertada com o nome');
});


test('teto: o botão só existe quando SOBRA alguém — 10 exatos não geram botão', () => {
  // A borda que é fácil errar. Com a lista igual ao teto nada é escondido, então
  // um botão ali diria "Ver mais 0" ou sumiria sem explicação — pior que não ter
  // teto. MEDIDO no browser: 0,1,7,9,10 autores → nenhum botão; 11 → "Ver mais 1".
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const j = semComentarios.indexOf('function renderAutores');
  const render = semComentarios.slice(j, semComentarios.indexOf('\nfunction ', j + 10));
  assert.match(render, /Math\.max\(0,\s*todas\.length - AUTORES_VISIVEIS\)/,
    'o número escondido é o que SOBRA, e nunca negativo');
  assert.match(render, /escondidas > 0 \? todas\.slice\(0, AUTORES_VISIVEIS\) : todas/,
    'sem sobra a lista sai inteira — fatiar sempre esconderia nada e mesmo assim cortaria');
  assert.match(render, /escondidas > 0 \|\| autoresExpandido\s*\n?\s*\?/,
    'o botão precisa exigir sobra (ou já estar expandido, pra oferecer a volta)');
});

test('teto: o número vai NO rótulo, com plural, nas 4 línguas', () => {
  // "Ver mais" sozinho não diz se são 3 ou 300 — e é isso que decide o toque.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const j = semComentarios.indexOf('function renderAutores');
  const render = semComentarios.slice(j, semComentarios.indexOf('\nfunction ', j + 10));
  assert.match(render, /escondidas === 1 \? 'stats\.autores\.verMais' : 'stats\.autores\.verMaisPlural'/,
    'plural explícito (o projeto não usa ICU)');
  assert.match(render, /\{ n: escondidas \}/, 'o número tem que ser interpolado');
  const dict = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  for (const k of ['verMais', 'verMaisPlural', 'verMenos']) {
    const n = [...dict.matchAll(new RegExp("'stats\\.autores\\." + k + "':", 'g'))].length;
    assert.equal(n, 4, `stats.autores.${k} não está nas 4 línguas`);
  }
  for (const k of ['verMais', 'verMaisPlural']) {
    for (const m of dict.matchAll(new RegExp("'stats\\.autores\\." + k + "': '([^']*)'", 'g'))) {
      assert.match(m[1], /\{n\}/, `${k} sem {n}: "${m[1]}" viraria "Ver mais" sem número`);
    }
  }
});

test('teto: expandido volta ao padrão pelos TRÊS caminhos de fechar', () => {
  // Modal fecha por botão, Esc e scrim. Amarrar a limpeza ao botão deixa os
  // outros dois vazando o estado — o gotcha dos modais deste projeto.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('const LIMPEZA_AO_FECHAR');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('\n};', i));
  assert.match(bloco, /filtersModal\(\)\s*\{[^}]*autoresExpandido = false/,
    'a volta ao padrão precisa estar em LIMPEZA_AO_FECHAR, não no handler de um botão');
});

test('teto: o corte é 10, e o número tem a medição atrás', () => {
  const m = montar();
  assert.equal(m.AUTORES_VISIVEIS, 10);
  const i = fonte.indexOf('const AUTORES_VISIVEIS');
  const antes = fonte.slice(Math.max(0, i - 900), i);
  assert.match(antes, /medido|MEDIDO/,
    'teto sem medição atrás vira número escolhido a dedo, e o próximo a mexer não sabe o que reabrir');
  assert.ok(m.AUTORES_VISIVEIS < m.AUTORES_MAX_REINCIDENTES,
    'mostrar mais do que cabe na memória não faria sentido');
});

// ── nada volta a chavear por NOME ───────────────────────────────────────────
//
// O `createdBy` serve pra EXIBIR e nada mais. Comparar por ele é a armadilha
// que já existiu neste módulo: o `Ver +N` contava por nome e o `✕ N` decidia o
// botão por id, e dava pra ver os dois discordando no mesmo card.
//
// A justificativa NÃO é "medimos e não colide": colisão de nome é impossível
// por construção (usuário do Waze é único), então medir isso não prova nada. O
// que importa é que o nome MUDA — 69% dos autores têm nome gerado
// (`world_xxxxx`) que troca no dia em que a pessoa escolhe um. Um instantâneo
// da fila nunca mostra essa troca, então nenhuma medição de uma coleta só
// poderia autorizar a chave fraca. A regra vale por construção.
test('autores: nada compara por createdBy — nome é pra exibir, id é pra chavear', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const proibidos = [
    ...app.matchAll(/\S*\.createdBy\s*(?:===|!==|==(?!=)|!=(?!=))[^\n]{0,40}/g),
    ...app.matchAll(/(?:===|!==|==(?!=)|!=(?!=))\s*\S*\.createdBy/g),
    ...app.matchAll(/\[\s*\w+\.createdBy\s*\]/g),
  ].map((m) => m[0].trim());
  assert.deepEqual(proibidos, [],
    'voltou a chavear por nome:\n  ' + proibidos.join('\n  '));
  // CONTRAPROVA: o guard enxerga alguma coisa? O `creatorId` TEM que aparecer
  // em comparação — se não aparecer, o padrão parou de casar e o teste virou
  // decoração silenciosa.
  const porId = app.match(/\S*\.creatorId\s*(?:===|!==)/g) || [];
  assert.ok(porId.length >= 3,
    `só ${porId.length} comparações por creatorId — o varredor parou de casar`);
});
