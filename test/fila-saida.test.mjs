// A FILA DE SAÍDA — o que você fez não se perde quando a rede some.
//
// O defeito que isto conserta existia HOJE, pra todo editor, sem viagem
// nenhuma: bastava o sinal oscilar. O caminho medido no código de antes era
// placar sobe e É GRAVADO → card sai da tela → 3s de janela → envia → falha →
// duas retentativas → **o último ramo do `handleActionResult` revertia o placar
// e descartava a ação**. O pedido continuava no Waze e o editor via o número
// voltar atrás uns 5 segundos depois de já ter seguido em frente.
//
// O app não tinha NENHUMA noção de estar offline — nem uma chave no dicionário.
//
// O que estes guards protegem não é a feliz: é cada uma das bordas em que ela
// se transforma em outra coisa — enfileirar o que não devia, contar o trabalho
// duas vezes, esvaziar em rajada, ou perder em silêncio ao encher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const MIN = readFileSync(new URL('../js/min/app.js', import.meta.url), 'utf8');

// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA — não com
// replace(/\/\/[^\n]*/g), que come tudo depois de qualquer https://.
const semComentarios = (s) => s.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const APP_SEM = semComentarios(APP);

// Pula a ASSINATURA antes de casar chaves. Começar no primeiro `{` depois do
// nome parece óbvio e está errado: `enviarLote(places, opts = {})` tem um `{}`
// de parâmetro padrão, que abre e fecha na hora — o corpo "medido" saía com 37
// caracteres e a asserção reprovava código certo, parecendo defeito do código.
// Instrumento que devolve um corpo minúsculo em silêncio é o gotcha #28.
function fatiar(nome) {
  const marca = APP_SEM.indexOf('function ' + nome + '(');
  assert.ok(marca >= 0, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', marca);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  i = APP_SEM.indexOf('{', i);
  let prof = 0, fim = APP_SEM.length;
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(marca, fim);
  // Corpo absurdamente curto é instrumento quebrado, não função vazia.
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}

test('só REDE entra na fila — recusa do Waze não', () => {
  const h = fatiar('handleActionResult');
  // O gancho é um bloco desde que a fila passou a recusar o pedido REPETIDO
  // (v2026.09.22-06): quem enfileira fica DENTRO do `if` da categoria.
  assert.match(h, /if \(cat === 'transient'\) \{\s*const naFila = enfileirarSaida\(actionType, place, regiao\);/,
    'o gancho da fila de saída saiu, ou deixou de exigir `transient`');
  // As categorias e o destino de cada uma:
  //  · already_processed/not_found → já é sucesso (outro editor chegou antes)
  //  · unauthorized ............... → ENFILEIRA e confere a sessão NA HORA
  //    (v2026.09.25-03): 401 muitas vezes é alarme falso, e o que a pessoa fez
  //    não pode evaporar — mas o relogin não pode esperar a fila
  //  · unknown .................... → retentar pra sempre o que não se entende
  const iJa = h.indexOf("cat === 'already_processed'");
  const iAuth = h.indexOf("cat === 'unauthorized'");
  const iFila = h.indexOf("cat === 'transient'");
  assert.ok(iJa > 0 && iAuth > 0 && iFila > 0, 'sumiu algum dos ramos de categoria');
  assert.ok(iJa < iFila && iAuth < iFila,
    'a fila de saída passou na frente de "já tratado" ou de "sessão morta" — '
    + 'esses dois têm destino próprio e enfileirá-los é adiar o que precisa acontecer agora');
});

test('o gancho vem ANTES da reversão — senão o placar já voltou', () => {
  const h = fatiar('handleActionResult');
  const iFila = h.indexOf('enfileirarSaida(actionType, place, regiao)');
  const iRevert = h.indexOf('AppState.stats[statKey] = Math.max(0');
  assert.ok(iFila > 0 && iRevert > 0, 'não achei as âncoras');
  assert.ok(iFila < iRevert,
    'enfileirar ficou DEPOIS da reversão: o número volta atrás na cara do editor '
    + 'e só então a ação é guardada — o defeito continua visível');
});

test('a fila tem TETO, e encher não descarta em silêncio', () => {
  const e = fatiar('enfileirarSaida');
  assert.match(e, /f\.length >= SAIDA_MAX/, 'o teto sumiu — estrutura que cresce por item precisa de um');
  // Devolver `false` faz o chamador cair na reversão de sempre, que AVISA.
  // Um `shift()` aqui descartaria o trabalho mais antigo sem ninguém saber, e
  // perda calada é exatamente o que este arquivo existe pra acabar.
  assert.ok(!/shift\(\)/.test(e),
    'a fila passou a descartar item ao encher — perda silenciosa é o defeito original de volta');
  const teto = /const SAIDA_MAX = (\d+);/.exec(APP_SEM);
  assert.ok(teto, 'a constante do teto sumiu');
  // A fila real do Brasil tem ~442 pedidos e o Waze guarda ~3 dias: o teto
  // precisa folgar sobre o que existe pra fazer, senão ele morde no uso normal.
  assert.ok(+teto[1] >= 500, `teto de ${teto[1]} é menor que a fila real (medida: 442)`);
});

test('o LOTE só enfileira no modo de placar OTIMISTA', () => {
  // `enviarLote` tem dois modos. No `contarAoLandar` (a recusa automática) o
  // placar só anda no `r.success`, e o pouso da fila de propósito não soma
  // nada — enfileirar ali faria a ação não contar em lugar NENHUM. E não há
  // nada a salvar: o ramo de erro já devolve o pedido pra `AppState.queue`.
  const l = fatiar('enviarLote');
  assert.match(l, /errorCategory === 'transient' && !aoLandar && enfileirarSaida\('reject', p, opts\.regiao\)/,
    'o lote enfileira no modo `contarAoLandar`: a ação some do placar e do Histórico');
  // E o modo otimista PRECISA enfileirar, senão a promessa vale só pro swipe.
  assert.ok(l.indexOf("enfileirarSaida('reject', p, opts.regiao)") > 0,
    'o lote parou de enfileirar de vez — o rejeitar em lote volta a perder por rede');
});

test('esvaziar tem RITMO, e o número sai de uma medição', () => {
  const r = /const SAIDA_RITMO_MS = (\d+);/.exec(APP_SEM);
  assert.ok(r, 'a constante de ritmo sumiu');
  // MEDIDO: o piso do app sem Desfazer é 377 ms por pedido (40 pedidos reais,
  // esperando o card trocar de verdade). Esvaziar mais rápido que isso é o app
  // fazendo o que nenhum humano faz — e rajada marca cliente num WAF.
  assert.ok(+r[1] >= 377,
    `ritmo de ${r[1]}ms é mais rápido que o piso humano medido (377ms) — vira rajada`);
  const f = fatiar('esvaziarFilaDeSaida');
  assert.match(f, /setTimeout\(ok, SAIDA_RITMO_MS\)/, 'a pausa entre envios sumiu');
});

test('exceção no POUSO não leva o resto da fila junto', () => {
  // Foi ISTO que o CI pegou, e o sintoma era caro de ler: "2 requisições para
  // 8 ações" com 6 sobrando. O pouso mexe em histórico, reincidência,
  // conquistas e DOM; uma exceção ali caía no `catch` do LAÇO e o esvaziamento
  // morria no meio, deixando o resto encalhado em silêncio (só um `dfato`).
  // Reproduzido no navegador sabotando o miolo do pouso no 3º item: com o
  // `try` local drena os 8; sem ele param em 6 — o número do CI.
  //
  // O item JÁ SAIU do Waze quando o pouso roda: o que falhou foi a
  // contabilidade dele, e contabilidade de um item não é motivo pra não mandar
  // os outros sete.
  const f = fatiar('esvaziarFilaDeSaida');
  assert.match(f, /try \{ registrarPousoDeSaida\(item\.tipo, place, r, item\); \}/,
    'o pouso voltou a rodar SEM proteção: uma exceção nele encalha o resto da fila');
  assert.match(f, /catch \(e\) \{ dfato\('saida\.pouso\.erro'/,
    'a falha do pouso deixou de ser registrada: encalhe sem rastro é indepurável');
  // E o item tem que sair DEPOIS, senão a exceção some com ele. Sai pela
  // CHAVE (`splice`), não pela posição: outra aba pode ter mexido na fila.
  const iTry = f.indexOf('try { registrarPousoDeSaida');
  const iShift = f.indexOf('f.splice(saiu, 1)', iTry);
  assert.ok(iShift > iTry, 'o item sai da fila antes do pouso');
});

test('esvaziar para no que não adianta insistir, e mantém a fila', () => {
  const f = fatiar('esvaziarFilaDeSaida');
  // REDE fora (sem resposta do Waze pro pedido) para a passada. O 5xx que o Waze
  // devolve PRA ESTE pedido também para — mas manda o item pro fim (O8).
  assert.match(f, /errorCategory === 'transient' && !\(Number\(r\.httpCode\) >= 500\)\) break/,
    'rede fora de novo deixou de interromper — vira falha em série gastando o free tier');
  assert.match(f, /errorCategory === 'unauthorized'\).*break/s,
    'sessão morta deixou de interromper o esvaziamento');
  // O `shift` só acontece DEPOIS de um pouso que não foi rede nem 401: item
  // que não saiu não pode sumir da fila.
  const iBreak = f.indexOf(">= 500)) break");
  const iShift = f.indexOf('f.splice(saiu, 1)');
  assert.ok(iBreak > 0 && iShift > iBreak,
    'o item é removido da fila antes de se saber que saiu');
});

test('o esvaziamento RELÊ antes de gravar — senão perde o que chegou no meio', () => {
  // PERDA DE DADO dentro da feature que existe pra não perder dado. A lista é
  // lida ANTES do `await`; nesse meio-tempo o editor desliza um pedido que
  // também falha por rede e `enfileirarSaida` grava [A,B,C]. Gravando a lista
  // VELHA depois do pouso de A, sai [B] por cima — e o C some sem sintoma.
  const f = fatiar('esvaziarFilaDeSaida');
  // Ancorado DEPOIS do pouso de propósito: `f = carregarFilaDeSaida()` casa
  // também com a leitura inicial (`let f = …`), lá em cima da função — foi
  // assim que esta asserção nasceu reprovando código certo (gotcha #67).
  const iPouso = f.indexOf('registrarPousoDeSaida(');
  assert.ok(iPouso > 0, 'não achei o pouso');
  const iRele = f.indexOf('f = carregarFilaDeSaida()', iPouso);
  const iShift = f.indexOf('f.splice(saiu, 1)', iPouso);
  const iSalva = f.indexOf('salvarFilaDeSaida(f)', iPouso);
  assert.ok(iRele > 0, 'o esvaziamento parou de reler a fila antes de gravar');
  assert.ok(iShift > 0 && iSalva > 0, 'não achei o tirar/gravar depois do pouso');
  assert.ok(iRele < iShift && iShift < iSalva,
    'a releitura saiu de lugar: ela precisa vir DEPOIS do pouso e ANTES de tirar e gravar');
});

test('sair no meio do esvaziamento PARA', () => {
  // Sem isto o item já em voo pousa depois do logout e o `recordHistory`
  // recria o histórico que o "Sair" acabou de apagar — e "sair é sair de tudo".
  const f = fatiar('esvaziarFilaDeSaida');
  const iWhile = f.indexOf('while (f.length)');
  const iAuth = f.indexOf('if (!AppState.authenticated) break');
  const iEnvio = f.indexOf('await API.');
  assert.ok(iAuth > iWhile && iAuth < iEnvio,
    'o teste de sessão saiu de dentro do laço, ou ficou depois do envio');
});

test('o pouso NÃO conta o placar de novo', () => {
  // O número subiu quando a pessoa deslizou. Somar de novo aqui contaria o
  // mesmo trabalho duas vezes — e o editor veria o placar inflar sozinho ao
  // voltar a rede, sem ter feito nada.
  const p = fatiar('registrarPousoDeSaida');
  assert.ok(!/AppState\.stats\.(read|rejected)\s*\+\+/.test(p),
    'o pouso voltou a somar no placar — trabalho contado duas vezes');
  assert.match(p, /recordHistory\(actionType, 1[,)]/,
    'o pouso parou de registrar o histórico: o placar diria uma coisa e o Histórico outra');
  // `[,)]`: o pouso passa também o MOMENTO do gesto (ver
  // test/conquistas-momento.test.mjs), e o guard é sobre a chamada existir.
  assert.match(p, /registrarAcaoConfirmada\(actionType, place[,)]/,
    'o pouso parou de alimentar as conquistas do trabalho feito offline');
});

test('falha de VERDADE no pouso desfaz o placar — que é persistido', () => {
  // O número subiu no gesto e foi GRAVADO (`waze_places_stats`). Se o pouso
  // descobre que a ação falhou mesmo (nem rede, nem sessão, nem "já tratado"),
  // deixar só o `serverTotal` voltar deixa "Rejeitados" inflado PARA SEMPRE por
  // algo que nunca saiu — e nada na tela liga uma coisa à outra.
  const p = fatiar('registrarPousoDeSaida');
  assert.match(p, /AppState\.stats\[statKey\] = Math\.max\(0, AppState\.stats\[statKey\] - 1\)/,
    'o pouso parou de desfazer o placar numa falha real');
  assert.match(p, /saveStats\(\)/,
    'o placar é desfeito em memória mas não gravado — volta inflado no próximo reload');
  assert.match(p, /AppState\.serverTotal\+\+/,
    'o pedido parou de voltar pro "Restam" quando a ação falhou de verdade');
});

test('o NOME do autor viaja junto — senão a lista vira número', () => {
  // A reincidência CHAVEIA por id e EXIBE por nome (`e[1]` em loadAutores), e o
  // `registrarRejeicaoDeAutor` REESCREVE esse nome a cada rejeição, caindo no id
  // quando não recebe `createdBy`. Sem carregar o nome na fila, um autor que já
  // aparecia com nome no Histórico voltaria a aparecer como NÚMERO depois de uma
  // rejeição feita offline — e ninguém liga uma coisa à outra.
  const e = fatiar('enfileirarSaida');
  assert.match(e, /nome: place\.createdBy \? String\(place\.createdBy\) : null/,
    'a fila parou de guardar o nome de exibição do autor');
  const f = fatiar('esvaziarFilaDeSaida');
  assert.match(f, /createdBy: item\.nome \|\| undefined/,
    'o nome é guardado mas não volta pro place no pouso — o mesmo defeito, um passo adiante');
});

test('o DIA e a REGIÃO são os do gesto, não os do pouso', () => {
  // `recordHistory` usa `historyTodayKey()` e `ondeAgora()` por padrão. Numa
  // ação que pousa depois — que é a razão de a fila existir — isso põe o
  // trabalho no balde do dia em que a REDE VOLTOU e na região do filtro de
  // AGORA. Quem triou 40 pedidos no sábado offline veria domingo no Histórico
  // e no Resumo do mês, sem nada ligando uma coisa à outra.
  const e = fatiar('enfileirarSaida');
  assert.match(e, /dia: historyTodayKey\(\), onde: ondeAgora\(\)/,
    'a fila parou de carimbar o dia e a região no GESTO');
  const p = fatiar('registrarPousoDeSaida');
  assert.match(p, /recordHistory\(actionType, 1, item\.dia, item\.onde\)/,
    'o pouso voltou a registrar no dia/região de quando a rede voltou');
  // E o CONSUMIDOR, senão tudo acima vira encanamento pra lugar nenhum: o
  // `recordHistory` pode voltar a ignorar o que recebe e os dois guards de cima
  // passam limpos (provado por sabotagem — esta asserção nasceu dessa falha).
  const rh = fatiar('recordHistory');
  assert.match(rh, /function recordHistory\(type, delta, dia, onde\)/,
    'o recordHistory deixou de aceitar dia/região');
  assert.match(rh, /const k = dia \|\| historyTodayKey\(\)/,
    'o recordHistory voltou a cravar HOJE, ignorando o dia que recebeu');
  assert.match(rh, /const lugar = onde \|\| ondeAgora\(\)/,
    'o recordHistory voltou a cravar o filtro de agora, ignorando a região que recebeu');
  // E o caminho ONLINE não pode mudar: lá os dois são omitidos e valem hoje.
  const h = fatiar('handleActionResult');
  assert.ok(/recordHistory\(actionType, 1\)/.test(h),
    'o caminho online passou a passar dia/região — ali o padrão É hoje');
});

test('o diário registra a TRANSIÇÃO, não cada swipe', () => {
  // `dfato` é anel de 120 e a regra da casa é "nada por swipe". 200 pedidos
  // tratados numa sombra de conectividade despejariam todo o resto do diário —
  // justamente o que se quer ler ao lado dele. O evento é ficar sem rede.
  const e = fatiar('enfileirarSaida');
  assert.match(e, /if \(f\.length === 1\) dfato\(/,
    'o diário voltou a registrar item a item — o anel de 120 vira só isto');
  // Duas anotações e nenhuma é por item: a abertura da fila, e o ALARME do
  // pedido repetido — que só existe num ramo que não deveria acontecer nunca
  // (o filtro de entrada impede o card de voltar). Qualquer terceira é nova.
  const chaves = [...e.matchAll(/dfato\('([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(chaves, ['saida.abriu', 'saida.repetida'],
    `enfileirarSaida escreve no diário ${JSON.stringify(chaves)} — só a abertura e o alarme cabem`);
  assert.equal((e.match(/dfato\(/g) || []).length, 2, 'há dfato fora das duas chaves conhecidas');
  // O alarme mora no ramo do repetido, que SAI na linha seguinte. Solto no
  // corpo, ele viraria um registro por item.
  assert.match(e, /dfato\('saida\.repetida'[^\n]*\n\s*return 'repetida';/,
    'o alarme do repetido saiu do ramo do repetido — virou anotação por item');
});

test('dois esvaziamentos não rodam juntos', () => {
  const f = fatiar('esvaziarFilaDeSaida');
  // A trava é cobrada pelo QUE ela faz, não pela grafia de uma linha só: ela
  // ganhou um irmão (anotar o gatilho, ver o teste da rede em dois tempos) e a
  // regex que casava a linha inteira reprovou código certo.
  assert.match(f, /if \(esvaziandoSaida\)[^\n]*return/,
    'sumiu a trava: `online` e a abertura do app podem coincidir e mandar tudo duas vezes');
  assert.match(f, /esvaziandoSaida = false/, 'a trava nunca é solta');
});

test('os DOIS gatilhos existem, e nenhum é polling', () => {
  // O ouvinte cresceu (hoje ele também refaz a BUSCA que falhou), então o
  // guard cobra o QUE ele faz, não a forma de uma linha só — casar a linha
  // inteira reprovava código certo na primeira vez que ela ganhou um irmão.
  // Há mais de um ouvinte de `online` (o diagnóstico anota a transição da rede
  // num deles), então o guard procura o que ESVAZIA — pegar "o primeiro do
  // arquivo" passou a ler o do diagnóstico e reprovou código certo (gotcha #67).
  const ouvintes = [...APP_SEM.matchAll(/addEventListener\('online'/g)]
    .map((m) => APP_SEM.slice(m.index, m.index + 600));
  assert.ok(ouvintes.length > 0, 'o gatilho do evento `online` sumiu');
  const ouvinte = ouvintes.find((o) => /esvaziarFilaDeSaida\(\)/.test(o)) || '';
  assert.match(ouvinte, /esvaziarFilaDeSaida\(\)/,
    'o `online` deixou de esvaziar a fila de saída');
  // A abertura com sessão salva mora no `abrirComSessaoSalva` desde que o link
  // de pareamento vencido num aparelho logado passou a cair nela também
  // (2026-09-26); o `initApp` a chama quando há token.
  assert.match(fatiar('initApp'), /if \(API\.getSession\(\)\) \{\s*abrirComSessaoSalva\(\);/,
    'a abertura com token salvo deixou de passar pelo abrirComSessaoSalva');
  const init = fatiar('abrirComSessaoSalva');
  const iEsvazia = init.indexOf('esvaziarFilaDeSaida()');
  const iMain = init.indexOf('showMainScreen()');
  assert.ok(iEsvazia > 0,
    'a abertura do app deixou de esvaziar: quem ficou offline e fechou tudo nunca mandaria');
  // ORDEM: é o `showMainScreen` que põe `AppState.authenticated = true`, e o
  // esvaziamento sai na primeira linha sem isso. Antes dele o gatilho da
  // abertura não faz NADA, calado — e a chamada continua lá pra enganar quem
  // procurar por ela. Foi assim que este guard nasceu decorativo.
  assert.ok(iMain > 0 && iMain < iEsvazia,
    'o esvaziamento ficou ANTES do showMainScreen: sai no `!AppState.authenticated` e não manda nada');
  // O free tier é restrição de projeto: nada de "tenta a cada N minutos".
  const trecho = APP_SEM.slice(APP_SEM.indexOf('function carregarFilaDeSaida'),
                               APP_SEM.indexOf('function handleActionResult'));
  assert.ok(!/setInterval/.test(trecho),
    'a fila de saída passou a fazer polling — o free tier é restrição de projeto');
});

test('sem rede não se retenta, e o teste é de UMA MÃO', () => {
  const c = fatiar('callWithRetry');
  // A CONDIÇÃO DO LAÇO, não a existência do helper: tirar `!semRede()` do
  // `while` deixa a declaração `const semRede = …` intacta, e um guard que
  // procura a string passa limpo. Foi assim que esta asserção nasceu
  // decorativa — provado por sabotagem, que passou verde.
  const laco = /while \(([\s\S]{0,240}?)\) \{/.exec(c);
  assert.ok(laco, 'não achei o laço de retentativa');
  assert.match(laco[1], /!semRede\(\)/,
    'a retentativa voltou a insistir offline: 2 requisições e ~5s por ação, já condenadas');
  assert.match(c, /const semRede = \(\) => navigator\.onLine === false;/,
    'o teste de rede mudou de forma');
  // `onLine === true` NÃO prova que há rede (portal cativo de hotel diz true e
  // mente). Só o `false` pode mudar o comportamento.
  assert.ok(!/navigator\.onLine === true|navigator\.onLine\s*\)/.test(c),
    'o código passou a confiar no `onLine === true`, que não prova nada');
});

test('o bundle GERADO tem a fila — senão nada disso está no ar', () => {
  // Os testes acima fatiam o FONTE; o app carrega o `js/min/`. Editar um sem
  // regerar o outro passa limpo aqui e manda a versão velha pra produção
  // (gotcha #22) — foi exatamente o que aconteceu ao escrever este recurso.
  assert.match(MIN, /enfileirarSaida/, 'o js/min/app.js não tem a fila de saída — falta `npm run js`');
  assert.match(MIN, /waze_places_saida/, 'a chave da fila não chegou ao bundle gerado');
});

test('o gatilho que chega COM o esvaziamento no ar não pode evaporar', () => {
  const f = fatiar('esvaziarFilaDeSaida');
  // A guarda de reentrada ANOTA em vez de descartar. `navigator.onLine === true`
  // não prova rede — o projeto já não confia nele em nenhum outro lugar —, então
  // a rede que volta em dois tempos (túnel, elevador, 4G firmando) manda um
  // `online` com a rede ainda ruim e outro logo depois já firme. O primeiro entra,
  // quebra no `transient` e sai; sem esta linha o segundo caía na guarda e sumia,
  // deixando a fila presa com a rede boa até a PRÓXIMA abertura do app.
  assert.match(f, /if \(esvaziandoSaida\) \{ saidaPedidaDeNovo = true; return; \}/,
    'a guarda de reentrada voltou a DESCARTAR o gatilho em vez de anotá-lo');
  // E o pedido anotado é atendido no fim.
  assert.match(f, /if \(saidaPedidaDeNovo\) \{\s*saidaPedidaDeNovo = false;\s*return esvaziarFilaDeSaida\(\);\s*\}/,
    'ninguém atende o gatilho anotado — anotar sem atender é o mesmo defeito com mais código');
  // Zerar ao ENTRAR, e não ao sair: zerar no fim apagaria justamente o pedido
  // que esta passada não pôde atender, que é o caso inteiro.
  const iEntra = f.indexOf('esvaziandoSaida = true;');
  const iZera = f.indexOf('saidaPedidaDeNovo = false;');
  const iLaco = f.indexOf('while (f.length)');
  assert.ok(iEntra > 0 && iZera > 0 && iLaco > 0, 'não achei as âncoras');
  assert.ok(iEntra < iZera && iZera < iLaco,
    'a bandeira precisa ser zerada DEPOIS de travar e ANTES do laço — fora daí ela apaga '
    + 'o pedido que esta passada não pôde atender, ou perde o que chegou durante o laço');
  // E o `js/min/` é o que o navegador carrega (gotcha #22).
  assert.ok(/saidaPedidaDeNovo/.test(MIN),
    'js/min/app.js não tem a correção — faltou `npm run js`, e o browser segue com o defeito');
});

test('resposta que CHEGA é prova de rede, e é o terceiro gatilho', () => {
  const api = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
  const apiSem = semComentarios(api);
  const apiMin = readFileSync(new URL('../js/min/api.js', import.meta.url), 'utf8');

  // O evento `online` do navegador NÃO basta: ele chega quando o rádio liga, e
  // nesse instante a rede ainda não passa tráfego. O esvaziamento entra, quebra
  // no `transient` e sai — e não vem gatilho novo, porque o app não foi fechado.
  // Relatado no iPhone do owner: 3 presas enquanto 2 novas saíam com sucesso.
  const iDisparo = apiSem.indexOf('this.aoProvarRede(');
  assert.ok(iDisparo > 0,
    'o transporte não avisa mais que uma resposta chegou: a fila de saída volta a '
    + 'depender só do evento `online`, que pode não vir');

  // POSIÇÃO: tem que ser onde a resposta EXISTE. No `catch` seria o contrário do
  // que o nome diz — falha de rede "provando" rede.
  const iPost = apiSem.indexOf('async _post(');
  const iCatch = apiSem.indexOf('} catch (error) {', iPost);
  const iRet = apiSem.indexOf('return data;', iPost);
  assert.ok(iPost > 0 && iCatch > 0 && iRet > 0, 'não achei as âncoras do _post');
  assert.ok(iDisparo > iPost && iDisparo < iCatch,
    'o aviso saiu de dentro do `try`: no `catch` ele diria que a rede voltou '
    + 'justamente quando ela não respondeu');
  assert.ok(iDisparo < iRet, 'o aviso ficou depois do `return` — código morto');

  // E ele NUNCA pode derrubar a resposta que o editor está esperando.
  const trecho = apiSem.slice(iDisparo - 120, iDisparo + 120);
  assert.match(trecho, /try \{[^}]*this\.aoProvarRede\([^)]*\)[^}]*\} catch/,
    'o aviso roda sem try/catch: um erro no consumidor derruba a resposta');

  // O CONSUMIDOR: sem ele o gancho é decoração.
  const iReg = APP_SEM.indexOf('API.aoProvarRede =');
  assert.ok(iReg > 0, 'ninguém registra o gancho — o transporte avisa no vácuo');
  const consumidor = APP_SEM.slice(iReg, iReg + 260);
  assert.match(consumidor, /esvaziarFilaDeSaida\(\)/,
    'o gancho deixou de esvaziar a fila de saída');
  // SAI CEDO durante o esvaziamento: cada item que ele manda passaria por aqui e
  // marcaria `saidaPedidaDeNovo`, fazendo a passada re-executar no fim — o laço
  // que quebrou por rede ruim tentaria de novo NA HORA, gastando requisição
  // justamente quando ela falha. Contraria o "para no primeiro `transient`".
  const iSai = consumidor.indexOf('if (esvaziandoSaida) return;');
  const iChama = consumidor.indexOf('esvaziarFilaDeSaida()');
  assert.ok(iSai >= 0 && iSai < iChama,
    'o gancho deixou de sair cedo durante o esvaziamento: a fila volta a ser '
    + 'retentada na hora depois de um `transient`, contra a política de rede');

  // gotcha #22: é o js/min/ que o navegador carrega.
  assert.ok(/aoProvarRede/.test(apiMin) && /aoProvarRede/.test(MIN),
    'js/min/ não tem o gancho — faltou `npm run js`, e o iPhone segue com o defeito');
});

test('o indicador é ÍCONE + número, e o ícone é que diz o estado', () => {
  const f = fatiar('updateInFlightIndicator');
  // Decisão do owner (2026-09-21) olhando mockups na tela real: a frase inteira
  // custava 128px e tapava 100% da tinta do RESTAM no iPhone; isto custa 23px e
  // zero. Encolher resolveu de graça o que tinha sido mantido a contragosto.
  assert.ok(!/rounded-full/.test(f) || !/bg-slate-800/.test(f),
    'a pílula voltou: o indicador cresce de novo e volta a tapar o número do placar');
  // O que separa "saindo agora" de "parado esperando rede" é o ÍCONE, nunca a
  // cor sozinha (WCAG 1.4.1) — e nunca só o número, que foi medido e recusado
  // porque "2" e "3" ficam visualmente idênticos.
  const iEnviando = f.indexOf('animate-spin');
  const iEsperando = f.indexOf('M12 7v5l3 2');       // ponteiros do relógio
  assert.ok(iEnviando > 0, 'o spinner do estado "enviando" sumiu');
  assert.ok(iEsperando > 0,
    'o ícone do estado "esperando" sumiu: sem ele os dois estados viram o mesmo '
    + 'número e some a distinção entre o trabalho estar saindo e estar encalhado');
  // Cor é REFORÇO, e as shades do claro são -800 porque sem pílula o contraste
  // é contra o cartão do placar: -700 media 4,8:1 pra um mínimo de 4,5 (0,3 de
  // folga), -800 mede 6,78:1. Gotcha #40.
  assert.match(f, /text-cyan-800 dark:text-cyan-300/,
    'a cor do "enviando" saiu do -800 no claro — a folga de contraste some');
  assert.match(f, /text-amber-800 dark:text-amber-300/,
    'a cor do "esperando" saiu do -800 no claro — a folga de contraste some');
  // A FRASE INTEIRA continua pra quem usa leitor de tela: encolheu o pixel, não
  // a informação. Sem isto ele ouve "3" e mais nada.
  assert.match(f, /sr-only[\s\S]{0,60}escapeHtml\(texto\)/,
    'o texto completo saiu do `sr-only`: quem usa leitor de tela passa a ouvir só '
    + 'o número, que não diz nem o que são nem em que estado estão');
  assert.match(f, /el\.title = texto/,
    'o `title` sumiu — é o que explica o ícone pra quem aponta no desktop');
  // gotcha #22: é o js/min/ que o navegador carrega.
  assert.ok(/M12 7v5l3 2/.test(MIN),
    'js/min/app.js não tem o ícone novo — faltou `npm run js`');
});

// ── 401: a ação não evapora (auditoria de 2026-09-25) ─────────────────────
// Um 401 numa ação — muitas vezes alarme falso (WAF, blip do KV) — fazia a ação
// SUMIR: o card já tinha saído, o placar já tinha contado e o Waze nunca
// recebia nada. Agora ela vai pra fila de saída, e a sessão é conferida na hora.
function montarResultado() {
  const guardado = new Map();
  const chamadas = [];
  const AppState = { stats: { read: 3, rejected: 5, skipped: 0 }, serverTotal: 10 };
  const deps = {
    AppState,
    safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
    SAIDA_KEY: 'waze_places_saida', SAIDA_MAX: 1000,
    API: { getRegion: () => 'row', getSession: () => 'tok' },
    dlog: () => {}, dfato: () => {},
    registrarPouso: () => chamadas.push('pouso'), recordHistory: () => chamadas.push('historico'),
    registrarRejeicaoDeAutor: () => {}, avisarConsequencia: () => {}, registrarAcaoConfirmada: () => {},
    showToast: (m, tipo) => chamadas.push('toast:' + tipo), msgDoServidor: (r, d) => d, t: (k) => k,
    handleUnauthorized: () => chamadas.push('confere'),
    updateStats: () => {}, saveStats: () => {}, updateInFlightIndicator: () => {},
    historyTodayKey: () => '2026-09-25', ondeAgora: () => '30', contaAgora: () => null,
    marcaDaSessao: () => 'marca',
  };
  const fontes = 'const descargaNaFila = new WeakSet();\n' + ['chaveDoPedido', 'carregarFilaDeSaida', 'salvarFilaDeSaida',
    'enfileirarSaida', 'tirarDaFilaDeSaida', 'marcarNaSaida', 'handleActionResult'].map(fatiar).join('\n');
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, fontes + '\nreturn { handleActionResult, carregarFilaDeSaida };')(...nomes.map((n) => deps[n]));
  return { app, AppState, chamadas };
}

test('401 numa ação: ela vai pra FILA DE SAÍDA (com a região do gesto) e a sessão é conferida na hora', () => {
  const { app, AppState, chamadas } = montarResultado();
  app.handleActionResult('reject', { venueID: 'v1', updateRequestID: 'u1', creatorId: 7 },
    { success: false, errorCategory: 'unauthorized' }, 'na');
  const f = app.carregarFilaDeSaida();
  assert.equal(f.length, 1, 'a ação com 401 evaporou — não foi pra fila de saída');
  assert.equal(f[0].regiao, 'na');
  assert.equal(AppState.stats.rejected, 5, 'o placar voltou atrás de um trabalho que segue guardado');
  assert.equal(AppState.serverTotal, 10);
  assert.ok(chamadas.includes('confere'), 'a sessão não foi conferida');
  assert.ok(!chamadas.some((c) => c.startsWith('toast:error')), 'toast de erro pra uma ação que está guardada');
});

test('401 com a fila de saída CHEIA: aí sim reverte o placar (como a recusa), e confere a sessão', () => {
  const { app, AppState, chamadas } = montarResultado();
  // Enche pelo caminho de verdade: 1000 ações que caíram por rede.
  for (let i = 0; i < 1000; i++) {
    app.handleActionResult('read', { venueID: 'x' + i, updateRequestID: 'y' + i }, { success: false, errorCategory: 'transient' }, 'row');
  }
  assert.equal(app.carregarFilaDeSaida().length, 1000, 'o teste não encheu a fila — não mediria o que diz');
  app.handleActionResult('reject', { venueID: 'v1', updateRequestID: 'u1' }, { success: false, errorCategory: 'unauthorized' }, 'row');
  assert.equal(AppState.stats.rejected, 4, 'fila cheia: o gesto que não coube tem que sair do placar');
  assert.equal(AppState.serverTotal, 11);
  assert.ok(chamadas.includes('confere'));
});

test('o "N enviados" do fim do esvaziamento conta só o que POUSOU (a recusa já avisou com erro)', () => {
  // Auditoria de 2026-09-25: a recusa de verdade mostrava o toast de erro e
  // entrava no "N enviados" de sucesso logo depois — o mesmo pedido dito falho e
  // enviado.
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const i = src.indexOf('async function esvaziarFilaDeSaida(');
  const corpo = src.slice(i, src.indexOf('\nfunction ', i + 10));
  assert.match(corpo, /if \(r && \(r\.success \|\| r\.errorCategory === 'already_processed' \|\| r\.errorCategory === 'not_found'\)\) \{?\s*enviados\+\+;/,
    'o contador de enviados voltou a somar as recusas');
});

// ── O1: 401 PERSISTENTE numa escrita não vira laço (auditoria de 2026-09-26) ──
// O Waze recusando a escrita DE UM PEDIDO com 401/403 (trava do local, WAF — e
// o core põe qualquer 403 em `unauthorized`), com a sonda do perfil respondendo:
// alarme falso → esvaziar → a mesma escrita → 401 → confere → … MEDIDO no
// navegador: 45 escritas e 22 sondas em 30 s depois de UM ✕, um toast a cada
// ~1,3 s. Aqui o ciclo roda DE VERDADE — `handleActionResult`, o
// `handleUnauthorized`, a fila e o esvaziamento fatiados do app.js —, com a
// "prova de rede" do `_post` (toda resposta que chega chama o esvaziamento).
// O `fatiar` deste arquivo começa em `function` e perde o `async` da frente: pra
// RODAR a função (e não só casar texto), o prefixo tem de vir junto.
function fatiarComAsync(nome) {
  const corpo = fatiar(nome);
  const i = APP_SEM.indexOf('function ' + nome + '(');
  return APP_SEM.slice(Math.max(0, i - 6), i) === 'async ' ? 'async ' + corpo : corpo;
}
function ciclo401({ sonda, escrita, relogio = { t: 1000 } }) {
  const guardado = new Map();
  const medidas = { escritas: 0, sondas: 0, toasts: [] };
  const AppState = { authenticated: true, profile: { id: 1 }, stats: { read: 0, rejected: 1, skipped: 0 }, serverTotal: 5 };
  const deps = {
    AppState, epocaDaSessao: 0, navigator: { onLine: true },
    safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
    SAIDA_KEY: 'waze_places_saida', SAIDA_MAX: 1000, SAIDA_RITMO_MS: 0, CONTA_KEY: 'waze_places_conta',
    SAIDA_RECUO_401_MS: [0, 15000, 60000, 300000], VERIFICA_SESSAO_MS: 0,
    Date: { now: () => relogio.t }, setTimeout: (f) => f(),
    dlog: () => {}, dfato: () => {}, dlogCapturarAuto: () => {}, t: (k) => k, msgDoServidor: (r, d) => d,
    showToast: (m, tipo) => medidas.toasts.push(tipo + ':' + m),
    registrarPouso: () => {}, recordHistory: () => {}, registrarRejeicaoDeAutor: () => {},
    registrarAcaoConfirmada: () => {}, avisarConsequencia: () => {},
    updateStats: () => {}, saveStats: () => {}, updateInFlightIndicator: () => {},
    historyTodayKey: () => '2026-09-26', ondeAgora: () => '30',
    rebuscarDepoisDeFalha: () => {}, derrubarSessao: () => medidas.toasts.push('derrubou'),
    showAuthScreen: () => {}, showAccessDenied: () => {}, completarPerfilChegado: () => {},
    definirPerfil: (r) => !!(r && r.success && r.profile),
    medidas, sonda, escrita, relogio, setImmediate,
  };
  const nomes = ['marcaDaSessao', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido',
    'enfileirarSaida', 'tirarDaFilaDeSaida', 'marcarNaSaida', 'marcarSessaoViva', 'sessaoVivaDepoisDe', 'recuarSaida', 'saidaEmRecuo',
    'registrarPousoDeSaida', 'esvaziarFilaDeSaida', 'handleActionResult', 'handleUnauthorized'];
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `
    let esvaziandoSaida = false, saidaPedidaDeNovo = false, saidaEsperandoConta = false, verificandoSessao = false;
    let sessaoVivaEm = { s: null, em: 0 }, saidaRecuo = { s: null, n: 0, ate: 0 };
    const pedidosEmAndamento = new Set(), descargaNaFila = new WeakSet();
    // O _post: a resposta leva uma volta de rede (outra tarefa, com o relógio
    // andando), e toda resposta que CHEGA chama a prova de rede ANTES de voltar.
    const aoProvarRede = () => { if (!esvaziandoSaida) esvaziarFilaDeSaida(); };
    // TETO do instrumento: se o laço voltar, ele não pode prender o processo do
    // teste pra sempre (foi o que a sabotagem do recuo fez: 10 min de timeout em
    // vez de um "not ok"). Passado o teto, a "rede" nunca responde — promessa
    // parada não segura o processo — e as asserções de contagem reprovam.
    const rede = async (resposta) => {
      if (medidas.escritas + medidas.sondas > 60) return new Promise(() => {});
      await new Promise((ok) => setImmediate(ok)); relogio.t += 50; aoProvarRede(); return resposta();
    };
    const API = {
      getSession: () => 'tok', getRegion: () => 'row',
      getProfile: () => { medidas.sondas++; return rede(sonda); },
      rejectPlace: () => { const n = ++medidas.escritas; return rede(() => escrita(n)); },
      markAsRead: () => { const n = ++medidas.escritas; return rede(() => escrita(n)); },
    };
    ${nomes.map(fatiarComAsync).join('\n')}
    return { handleActionResult, esvaziarFilaDeSaida, carregarFilaDeSaida };`)(...chaves.map((k) => deps[k]));
  return { app, conta: medidas, AppState, relogio };
}
const aquietar = async () => { for (let i = 0; i < 200; i++) await new Promise((r) => setImmediate(r)); };
const RECUSA_401 = { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.cookiesExpired', httpCode: 403 };
const PERFIL_VIVO = () => ({ success: true, profile: { id: 1 } });

test('O1: o 2º 401 do MESMO pedido com a sessão CONFIRMADA viva tira o item — sem laço', async () => {
  // A escrita recusa as 30 primeiras vezes: com o laço de antes, elas saíam todas.
  const c = ciclo401({ sonda: PERFIL_VIVO, escrita: (n) => (n <= 30 ? RECUSA_401 : { success: true }) });
  c.app.handleActionResult('reject', { venueID: 'v1', updateRequestID: 'u1', creatorId: 7 }, RECUSA_401, 'row');
  await aquietar();
  assert.ok(c.conta.escritas <= 2, `a mesma escrita recusada saiu ${c.conta.escritas} vezes — é o laço do 401`);
  assert.ok(c.conta.sondas <= 1, `${c.conta.sondas} sondas pra uma escrita recusada`);
  assert.equal(c.app.carregarFilaDeSaida().length, 0, 'o pedido recusado ficou na fila, pra girar de novo');
  assert.equal(c.AppState.stats.rejected, 0, 'o placar do gesto que o Waze recusou não desceu');
  assert.equal(c.AppState.serverTotal, 6, 'o pedido recusado segue pendente no Waze: o "Restam" tem de voltar');
  assert.ok(c.conta.toasts.includes('error:toast.actionError'), 'a recusa de verdade não avisou');
  assert.ok(!c.conta.toasts.includes('derrubou'), 'a sessão viva foi derrubada');
});

test('O1: sonda que NÃO confirma (5xx, rede) não tira o item — mas o ciclo tem RECUO', async () => {
  // Sem confirmação positiva não há como separar sessão de escrita: o item
  // FICA. O que não pode é girar: cada passada que para no 401 espera mais.
  const c = ciclo401({ sonda: () => ({ success: false, errorCategory: 'transient', httpCode: 500 }), escrita: () => RECUSA_401 });
  c.app.handleActionResult('reject', { venueID: 'v1', updateRequestID: 'u1' }, RECUSA_401, 'row');
  await aquietar();
  for (let i = 0; i < 10; i++) { c.app.esvaziarFilaDeSaida(); await aquietar(); }   // dez gatilhos no MESMO instante
  assert.ok(c.conta.escritas <= 3, `${c.conta.escritas} escritas no mesmo instante: o recuo não segurou`);
  assert.equal(c.app.carregarFilaDeSaida().length, 1, 'sem a sessão confirmada viva, o item tem de FICAR');
  assert.equal(c.AppState.stats.rejected, 1, 'o placar do item guardado não pode descer');
  const antes = c.conta.escritas;
  c.relogio.t += 5 * 60 * 1000 + 1;   // passado o recuo, o próximo gatilho tenta de novo
  c.app.esvaziarFilaDeSaida(); await aquietar();
  assert.ok(c.conta.escritas > antes, 'depois do recuo o item nunca mais foi tentado — ficaria preso pra sempre');
});

test('O1: a confirmação de OUTRA sessão não vale — e um pouso zera o recuo', () => {
  const src = ['marcaDaSessao', 'marcarSessaoViva', 'sessaoVivaDepoisDe'].map(fatiar).join('\n');
  const sessao = { token: 'tok-A', t: 1000 };
  const f = new Function('API', 'Date', `let sessaoVivaEm = { s: null, em: 0 };\n${src}
    return { marcarSessaoViva, sessaoVivaDepoisDe };`)({ getSession: () => sessao.token }, { now: () => sessao.t });
  sessao.t = 2000; f.marcarSessaoViva();
  assert.equal(f.sessaoVivaDepoisDe(1500), true);
  assert.equal(f.sessaoVivaDepoisDe(2500), false, 'confirmação ANTES do 401 valeu como depois');
  assert.equal(f.sessaoVivaDepoisDe(undefined), false, 'item sem `u401` (1º 401) foi tirado sem 2ª chance');
  sessao.token = 'tok-B';
  assert.equal(f.sessaoVivaDepoisDe(1500), false, 'a confirmação da sessão ANTERIOR valeu na nova');
  const e = fatiar('esvaziarFilaDeSaida');
  assert.match(e, /enviados\+\+;\s*saidaRecuo = \{ s: null, n: 0, ate: 0 \};/,
    'o pouso deixou de zerar o recuo: depois de um 401 passageiro a fila esperaria à toa');
  assert.match(e, /if \(saidaEmRecuo\(\)\) return;/, 'o esvaziamento não respeita o recuo');
});

// ── O5: a DESCARGA com rede (ou "lie-fi") não perde a decisão ────────────────
// Fechar o app na janela do Desfazer com `onLine === true` mas sem tráfego
// (túnel, portal cativo): a descarga gravava o POUSO antes do envio `keepalive`,
// o envio morria, e a decisão sumia — a reabertura sem rede ESCONDIA o pedido e
// o placar ficava +1 (auditoria de 2026-09-26, medido no navegador: p6). Aqui o
// aparelho roda de verdade — `handleReject`, `scheduleAction`, a descarga, o
// `handleActionResult` e o esvaziamento fatiados do app.js —, com o armazenamento
// sobrevivendo à "página" (cada `pagina()` é uma abertura nova, memória zerada).
function aparelhoO5(guardado = new Map()) {
  return function pagina({ resposta }) {
    const medidas = { envios: [], pousos: 0, historico: 0, diario: [] };
    const AppState = { authenticated: true, profile: { id: 1 }, currentPlace: null, queue: [], pendingAction: null,
      inFlightActions: 0, serverTotal: 5, stats: JSON.parse(guardado.get('stats') || '{"read":0,"rejected":0,"skipped":0}'),
      preferences: { undoEnabled: true } };
    const deps = {
      AppState, epocaDaSessao: 0, navigator: { onLine: true },
      safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
      SAIDA_KEY: 'waze_places_saida', SAIDA_MAX: 1000, SAIDA_RITMO_MS: 0, CONTA_KEY: 'waze_places_conta',
      SAIDA_RECUO_401_MS: [0, 15000, 60000, 300000], UNDO_WINDOW_MS: 3000,
      // A janela do Desfazer NUNCA vence sozinha aqui: quem fecha é a descarga.
      setTimeout: () => 0, clearTimeout: () => {},
      dlog: () => {}, dlogPlace: () => null, dfato: (k) => medidas.diario.push(k), t: (k) => k, msgDoServidor: (r, d) => d,
      showToast: () => {}, showUndoBanner: () => {}, removeUndoBanner: () => {}, aplicarTravaDeAcao: () => {},
      updateInFlightIndicator: () => {}, updateStats: () => {}, updatePendingCount: () => {}, showCurrentPlace: () => {},
      saveStats: () => guardado.set('stats', JSON.stringify(AppState.stats)),
      canDisableUndo: () => false, registrarJanelaSemUndo: () => {}, zerarJanelasSemUndo: () => {},
      acoesTravadas: () => false, direcaoTravada: () => false, Treino: { ativo: false }, advanceQueue: () => {},
      presencaWmeDaAcao: () => null, presencaWmeAoResponder: () => {}, callWithRetry: (fn) => fn(),
      registrarPouso: () => { medidas.pousos++; }, recordHistory: () => { medidas.historico++; },
      registrarRejeicaoDeAutor: () => {}, registrarAcaoConfirmada: () => {}, avisarConsequencia: () => {},
      historyTodayKey: () => '2026-09-26', ondeAgora: () => '30', handleUnauthorized: () => {},
      renomeacaoPendente: null, aprovacaoPendente: null, exclusaoPendente: null, console: { error: () => {} },
      medidas, resposta, setImmediate,
    };
    const nomes = ['marcaDaSessao', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido',
      'marcarEmAndamento', 'enfileirarSaida', 'tirarDaFilaDeSaida', 'marcarNaSaida', 'sessaoVivaDepoisDe', 'recuarSaida',
      'saidaEmRecuo', 'registrarPousoDeSaida', 'esvaziarFilaDeSaida', 'handleActionResult', 'scheduleAction',
      'handleReject', 'descarregarAcaoPendente'];
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, `
      let esvaziandoSaida = false, saidaPedidaDeNovo = false, saidaEsperandoConta = false, tratouNestaFila = false;
      let sessaoVivaEm = { s: null, em: 0 }, saidaRecuo = { s: null, n: 0, ate: 0 };
      const pedidosEmAndamento = new Set(), descargaNaFila = new WeakSet();
      // O _post: toda resposta que CHEGA chama a prova de rede, ANTES de voltar.
      const aoProvarRede = () => { if (!esvaziandoSaida) esvaziarFilaDeSaida(); };
      const rede = async (quem, v) => {
        medidas.envios.push(quem + ':' + v);
        const r = resposta(v, medidas.envios.length);
        if (r === 'pendura') return new Promise(() => {});           // a página morreu com o envio no ar
        await new Promise((ok) => setImmediate(ok));
        if (r === 'rede') return { success: false, errorCategory: 'transient' };
        aoProvarRede();
        return r === '702' ? { success: false, errorCategory: 'already_processed' } : { success: true };
      };
      const API = { getSession: () => 'tok', getRegion: () => 'row', setSaindo: () => {},
        rejectPlace: (v) => rede('rejeitar', v), markAsRead: (v) => rede('ler', v) };
      ${nomes.map(fatiarComAsync).join('\n')}
      return { handleReject, descarregarAcaoPendente, esvaziarFilaDeSaida, carregarFilaDeSaida };`)(...chaves.map((k) => deps[k]));
    return { app, AppState, medidas };
  };
}
const esperarRede = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)); };
const PEDIDO_O5 = () => ({ venueID: 'v1', updateRequestID: 'u1', creatorId: 7 });
function tratarEFechar(pagina) {
  pagina.AppState.currentPlace = PEDIDO_O5();
  pagina.app.handleReject();                    // o ✕, na janela do Desfazer
  pagina.app.descarregarAcaoPendente();        // e o app vai pro fundo / fecha
}

test('O5 lie-fi: a descarga põe a decisão na fila ANTES do envio — o envio morre e ela SAI na reabertura, contando UMA vez', async () => {
  const aparelho = aparelhoO5();
  const a = aparelho({ resposta: () => 'pendura' });
  tratarEFechar(a);
  await esperarRede();
  assert.deepEqual(a.app.carregarFilaDeSaida().map((x) => x.venueID), ['v1'], 'a decisão sumiu com o envio que morreu');
  assert.equal(a.medidas.pousos, 0, 'o pouso foi gravado sem resposta — a reabertura esconderia um pedido que não saiu');
  assert.equal(a.AppState.stats.rejected, 1);
  // Reaberto COM rede (memória zerada, armazenamento o mesmo): a fila sai.
  const b = aparelho({ resposta: () => 'ok' });
  await b.app.esvaziarFilaDeSaida();
  assert.deepEqual(b.medidas.envios, ['rejeitar:v1']);
  assert.equal(b.app.carregarFilaDeSaida().length, 0);
  assert.equal(b.medidas.historico, 1);
  assert.equal(b.AppState.stats.rejected, 1, 'o placar do gesto não pode contar de novo nem descer');
});

test('O5: o envio CHEGOU e a página morreu antes da resposta — o reenvio volta "já tratado" e conta UMA vez', async () => {
  const aparelho = aparelhoO5();
  tratarEFechar(aparelho({ resposta: () => 'pendura' }));
  await esperarRede();
  const b = aparelho({ resposta: () => '702' });
  await b.app.esvaziarFilaDeSaida();
  assert.equal(b.app.carregarFilaDeSaida().length, 0);
  assert.equal(b.medidas.historico, 1, 'o "já tratado" do reenvio não contou (ou contou duas vezes)');
  assert.equal(b.AppState.stats.rejected, 1);
});

test('O5: a resposta chega com a página VIVA — tira o item da fila, e a prova de rede dela não reenvia', async () => {
  const aparelho = aparelhoO5();
  // O 1º envio (a descarga) dá certo; qualquer outro seria o MESMO pedido de novo.
  const a = aparelho({ resposta: (v, n) => (n === 1 ? 'ok' : '702') });
  tratarEFechar(a);
  await esperarRede();
  assert.deepEqual(a.medidas.envios, ['rejeitar:v1'], 'o esvaziamento puxado pela resposta mandou o mesmo pedido de novo');
  assert.equal(a.app.carregarFilaDeSaida().length, 0, 'a decisão que pousou ficou na fila de saída');
  assert.equal(a.medidas.historico, 1, 'o pedido contou duas vezes no Histórico');
  assert.equal(a.medidas.pousos, 1, 'o pouso não veio com a resposta');
  // E a página viva com a resposta de REDE: o item fica, sem o gesto contar de novo.
  const c = aparelhoO5()({ resposta: () => 'rede' });
  tratarEFechar(c);
  await esperarRede();
  assert.equal(c.app.carregarFilaDeSaida().length, 1, 'a decisão sumiu com a resposta de rede');
  assert.equal(c.AppState.stats.rejected, 1, 'o placar desceu como "repetido" — é o próprio item da descarga');
  assert.ok(!c.medidas.diario.includes('saida.repetida'), 'o item da descarga foi tratado como gesto repetido');
});

test('O5: a descarga que acha a decisão deste pedido JÁ na fila não envia de novo, e o gesto sai do placar', async () => {
  const guardado = new Map([['waze_places_saida', JSON.stringify([{ tipo: 'read', venueID: 'v1', updateRequestID: 'u1', conta: '1', regiao: 'row' }])]]);
  const a = aparelhoO5(guardado)({ resposta: () => 'ok' });
  a.AppState.currentPlace = PEDIDO_O5();
  a.app.handleReject();
  a.app.descarregarAcaoPendente();
  await esperarRede();
  assert.deepEqual(a.medidas.envios.filter((e) => e.startsWith('rejeitar')), [], 'a segunda decisão do mesmo pedido saiu');
  assert.equal(a.AppState.stats.rejected, 0, 'o gesto repetido contou no placar');
});

// ── O8: 5xx num pedido SÓ não segura a fila (auditoria de 2026-09-26) ────────
// O esvaziamento dava `break` no primeiro `transient`, e um pedido que o Waze
// recusa SEMPRE com 5xx ficava na cabeça segurando os outros pra sempre (p8:
// 6 provas de rede, 6 envios do MESMO pedido, os outros dois nunca saíram).
function drenarO8(itens, resposta) {
  const guardado = new Map([['waze_places_saida', JSON.stringify(itens)]]);
  const relogio = { t: 1000 };
  const medidas = { enviados: [], erros: 0, diario: [] };
  const AppState = { authenticated: true, profile: { id: 1 }, stats: { read: 1, rejected: 2, skipped: 0 }, serverTotal: 5 };
  const deps = {
    AppState, navigator: { onLine: true }, epocaDaSessao: 0,
    safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
    // TETO do instrumento: um laço que volte (mover e seguir na mesma passada)
    // não pode prender o processo do teste — passado o teto, a "rede" nunca
    // responde, e as contagens reprovam em vez de pendurar.
    API: { getSession: () => 'tok',
      rejectPlace: async (v) => { if (medidas.enviados.length > 60) return new Promise(() => {});
        relogio.t += 50; medidas.enviados.push(v); return resposta(v); },
      markAsRead: async (v) => { if (medidas.enviados.length > 60) return new Promise(() => {});
        relogio.t += 50; medidas.enviados.push(v); return resposta(v); } },
    Date: { now: () => relogio.t }, setTimeout: (f) => f(),
    SAIDA_KEY: 'waze_places_saida', CONTA_KEY: 'waze_places_conta', SAIDA_RITMO_MS: 0,
    SAIDA_RECUO_401_MS: [0, 15000, 60000, 300000], POUSO_NA_MEMORIA_MS: 600000,
    SAIDA_TENTATIVAS_POR_ITEM: Number(/^const SAIDA_TENTATIVAS_POR_ITEM = (\d+);/m.exec(APP_SEM)[1]),
    offlineLigado: () => false, recordHistory: () => {}, registrarRejeicaoDeAutor: () => {}, registrarAcaoConfirmada: () => {},
    updateStats: () => {}, saveStats: () => {}, updateInFlightIndicator: () => {}, handleUnauthorized: () => {},
    showToast: (m, tipo) => { if (tipo === 'error') medidas.erros++; }, t: (k) => k, msgDoServidor: (r, d) => d,
    dfato: (k) => medidas.diario.push(k),
  };
  const nomes = ['marcaDaSessao', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido', 'marcarNaSaida',
    'moverProFimDaSaida', 'sessaoVivaDepoisDe', 'recuarSaida', 'saidaEmRecuo', 'registrarPouso', 'registrarPousoDeSaida',
    'esvaziarFilaDeSaida'];
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `
    let esvaziandoSaida = false, saidaPedidaDeNovo = false, saidaEsperandoConta = false, ultimaEscritaOkEm = 0;
    let sessaoVivaEm = { s: null, em: 0 }, saidaRecuo = { s: null, n: 0, ate: 0 };
    const pedidosEmAndamento = new Set(), pousosDaPagina = new Map();
    ${nomes.map(fatiarComAsync).join('\n')}
    return { esvaziarFilaDeSaida, carregarFilaDeSaida };`)(...chaves.map((k) => deps[k]));
  return { app, AppState, medidas };
}
const ITEM_O8 = (v, tipo = 'reject') => ({ tipo, venueID: v, updateRequestID: 'u' + v, conta: '1', regiao: 'row' });
const QUINHENTOS = { success: false, errorCategory: 'transient', errorKey: 'srv.err.wazeDown', httpCode: 500 };

test('O8: o pedido com 5xx vai pro FIM — os outros saem, e ele sai como falha depois de N com outra escrita pousada', async () => {
  const d = drenarO8([ITEM_O8('vA'), ITEM_O8('vB'), ITEM_O8('vC', 'read')], (v) => (v === 'vA' ? QUINHENTOS : { success: true }));
  for (let i = 0; i < 6; i++) await d.app.esvaziarFilaDeSaida();     // seis provas de rede
  assert.ok(d.medidas.enviados.includes('vB') && d.medidas.enviados.includes('vC'),
    `o pedido com 5xx segurou os outros: ${d.medidas.enviados.join(' ')}`);
  assert.ok(d.medidas.enviados.filter((v) => v === 'vA').length <= 3, `o mesmo pedido saiu ${d.medidas.enviados.join(' ')}`);
  assert.deepEqual(d.app.carregarFilaDeSaida(), [], 'o pedido que o Waze recusa sempre ficou na fila pra sempre');
  assert.equal(d.AppState.stats.rejected, 1, 'o placar do pedido recusado não desceu');
  assert.equal(d.AppState.serverTotal, 6, 'o pedido recusado segue pendente no Waze: o "Restam" tem de voltar');
  assert.equal(d.medidas.erros, 1, 'a recusa de verdade não avisou (ou avisou mais de uma vez)');
  assert.ok(d.medidas.diario.includes('saida.recusada'));
});

test('O8: 5xx pra TODOS (o Waze fora do ar) — nada é descartado, e cada gatilho gasta UMA requisição', async () => {
  const d = drenarO8([ITEM_O8('vA'), ITEM_O8('vB'), ITEM_O8('vC', 'read')], () => QUINHENTOS);
  // Doze gatilhos: cada pedido passa de N tentativas (é o caso que decide).
  for (let i = 0; i < 12; i++) {
    const antes = d.medidas.enviados.length;
    await Promise.race([d.app.esvaziarFilaDeSaida(), new Promise((ok) => setTimeout(ok, 200))]);
    if (d.medidas.enviados.length - antes > 1) break;              // rajada: nem espera o resto
  }
  assert.equal(d.medidas.enviados.length, 12, `rajada com o Waze fora: ${d.medidas.enviados.length} envios em 12 gatilhos`);
  assert.equal(d.app.carregarFilaDeSaida().length, 3, 'descartou decisão SEM prova de que o Waze aceita escrita');
  assert.deepEqual(d.AppState.stats, { read: 1, rejected: 2, skipped: 0 });
  assert.equal(d.medidas.erros, 0);
});

test('O8: REDE fora (sem resposta do Waze) não conta tentativa nem mexe na ordem', async () => {
  const d = drenarO8([ITEM_O8('vA'), ITEM_O8('vB')], () => ({ success: false, errorCategory: 'transient' }));
  for (let i = 0; i < 4; i++) await d.app.esvaziarFilaDeSaida();
  const f = d.app.carregarFilaDeSaida();
  assert.deepEqual(f.map((x) => x.venueID), ['vA', 'vB'], 'a queda de rede mudou a ordem da fila');
  assert.equal(f[0].tt, undefined, 'a queda de rede contou tentativa contra o pedido');
  assert.deepEqual(d.medidas.enviados, ['vA', 'vA', 'vA', 'vA']);
});
