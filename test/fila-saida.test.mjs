// A FILA DE SAÍDA — o que você fez não se perde quando a rede some.
//
// O defeito que isto conserta existia HOJE, pra todo editor, sem viagem
// nenhuma: bastava o sinal oscilar. O caminho medido no código de antes era
// placar sobe e É GRAVADO → card sai da tela → 3s de janela → envia → falha →
// duas retentativas → **o último ramo do `handleActionResult` revertia o placar
// e descartava a ação**. O pedido continuava no Waze e o editor via o número
// voltar atrás uns 5 segundos depois de já ter seguido em frente.
//
// A app não tinha NENHUMA noção de estar offline — nem uma chave no dicionário.
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
  assert.match(h, /cat === 'transient' && enfileirarSaida\(actionType, place\)/,
    'o gancho da fila de saída saiu, ou deixou de exigir `transient`');
  // As três categorias que NÃO podem entrar, e o motivo de cada uma:
  //  · already_processed/not_found → já é sucesso (outro editor chegou antes)
  //  · unauthorized ............... → a sessão morreu; enfileirar adia o relogin
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
  const iFila = h.indexOf('enfileirarSaida(actionType, place)');
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
  assert.match(l, /errorCategory === 'transient' && !aoLandar && enfileirarSaida\('reject', p\)/,
    'o lote enfileira no modo `contarAoLandar`: a ação some do placar e do Histórico');
  // E o modo otimista PRECISA enfileirar, senão a promessa vale só pro swipe.
  assert.ok(l.indexOf("enfileirarSaida('reject', p)") > 0,
    'o lote parou de enfileirar de vez — o rejeitar em lote volta a perder por rede');
});

test('esvaziar tem RITMO, e o número sai de uma medição', () => {
  const r = /const SAIDA_RITMO_MS = (\d+);/.exec(APP_SEM);
  assert.ok(r, 'a constante de ritmo sumiu');
  // MEDIDO: o piso da app sem Desfazer é 377 ms por pedido (40 pedidos reais,
  // esperando o card trocar de verdade). Esvaziar mais rápido que isso é a app
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
  // E o `shift` tem que acontecer DEPOIS, senão a exceção some com o item.
  const iTry = f.indexOf('try { registrarPousoDeSaida');
  const iShift = f.indexOf('f.shift()', iTry);
  assert.ok(iShift > iTry, 'o item sai da fila antes do pouso');
});

test('esvaziar para no que não adianta insistir, e mantém a fila', () => {
  const f = fatiar('esvaziarFilaDeSaida');
  assert.match(f, /errorCategory === 'transient'\) break/,
    'rede fora de novo deixou de interromper — vira falha em série gastando o free tier');
  assert.match(f, /errorCategory === 'unauthorized'\).*break/s,
    'sessão morta deixou de interromper o esvaziamento');
  // O `shift` só acontece DEPOIS de um pouso que não foi rede nem 401: item
  // que não saiu não pode sumir da fila.
  const iBreak = f.indexOf("'transient') break");
  const iShift = f.indexOf('f.shift()');
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
  const iShift = f.indexOf('f.shift()', iPouso);
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
  assert.match(p, /registrarAcaoConfirmada\(actionType, place\)/,
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
  const porItem = (e.match(/dfato\(/g) || []).length;
  assert.equal(porItem, 1, `enfileirarSaida escreve no diário ${porItem}× — só a abertura cabe`);
});

test('dois esvaziamentos não rodam juntos', () => {
  const f = fatiar('esvaziarFilaDeSaida');
  assert.match(f, /if \(esvaziandoSaida\) return/,
    'sumiu a trava: `online` e a abertura da app podem coincidir e mandar tudo duas vezes');
  assert.match(f, /esvaziandoSaida = false/, 'a trava nunca é solta');
});

test('os DOIS gatilhos existem, e nenhum é polling', () => {
  assert.match(APP_SEM, /addEventListener\('online', \(\) => \{ esvaziarFilaDeSaida\(\); \}\)/,
    'o gatilho do evento `online` sumiu');
  const init = fatiar('initApp');
  const iEsvazia = init.indexOf('esvaziarFilaDeSaida()');
  const iMain = init.indexOf('showMainScreen()');
  assert.ok(iEsvazia > 0,
    'a abertura da app deixou de esvaziar: quem ficou offline e fechou tudo nunca mandaria');
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
  // Os testes acima fatiam o FONTE; a app carrega o `js/min/`. Editar um sem
  // regerar o outro passa limpo aqui e manda a versão velha pra produção
  // (gotcha #22) — foi exatamente o que aconteceu ao escrever este recurso.
  assert.match(MIN, /enfileirarSaida/, 'o js/min/app.js não tem a fila de saída — falta `npm run js`');
  assert.match(MIN, /waze_places_saida/, 'a chave da fila não chegou ao bundle gerado');
});
