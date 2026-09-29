// O LEITOR ÚNICO do diagnóstico (`tools/diag-resumo.mjs`) — rodado de verdade,
// sobre um relatório sintético cheio de CANÁRIOS.
//
// O arquivo que o editor manda leva credencial VIVA (`waze_session_token`) e
// dado de terceiro em massa (a fila no `appState`, o `dom` inteiro, o corpo das
// chamadas). A promessa do leitor é imprimir a triagem sem nada disso — e
// promessa sobre SAÍDA só se prova olhando a saída, não o fonte: um guard que
// procurasse `localStorage` no código reprovaria o leitor certo (ele LÊ o token,
// pra poder trocá-lo por `<TOKEN>`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'CANARIO-TOKEN-9f8e7d6c5b4a';
const COOKIE = 'CANARIO-COOKIE-1a2b3c';
const LOCAL = 'CANARIO-LOCAL-Padaria-do-Ze';
const DOM = 'CANARIO-DOM-trecho';

const relatorioV4 = () => ({
  _versaoDoDiag: 4, _gerado: '2026-09-22T20:28:29.037Z',
  app: { versao: '2026092205', rotulo: '2026.09.22-05' },
  ambiente: { ua: 'Mozilla/5.0 (Linux; Android 10; K) Chrome/153', online: false, standalone: true,
              tela: { w: 412, h: 915, dpr: 2.625, janela: '411x841' } },
  resumo: {
    momentos: 2, chamadas: 2, falhas: 2, errosDeJs: 1, rede: false, offline: 'ligado',
    telaAgora: { tela: 'app', painel: 'carregando', cardMontado: true, modais: ['filtersModal'], lightbox: false },
    alertas: [],
    alertasNasCapturas: [{ t: '2026-09-22T20:27:24.824Z', motivo: 'manual', painel: 'carregando',
                           alertas: ['esqueletoSobreCard', 'toqueInterceptado'] }],
  },
  offline: { ligado: true, janelaServida: 1491757, janelaAtual: 1491757, resultado: null, varrendo: false,
             filaGuardada: { n: 236, idadeMin: 2 }, janelaGuardada: 1491757, tilesNoCache: 428,
             tilesGuardadosQueFalharam: 0 },
  serviceWorker: { controlando: true, registros: [{ estadoAtivo: 'activated', esperando: null, instalando: null }],
                   proprio: { versao: 'waze-places-2026092205', idadeMs: 252855, listaPronta: true,
                              tilesNaLista: 428, doCache: 386, cacheSemEntrada: 0, esperouLeitura: 21, foraDaLista: 499 } },
  diario: [
    { t: 1790108834504, k: 'rede.caiu', naAbertura: true },
    { t: 1790108834505, k: 'tela.carregando', visivel: true, naAbertura: true },
    { t: 1790108834590, k: 'tela.primeiroCard', fila: 236 },
    { t: 1790108834593, k: 'offline.abriu', n: 236, idade: 1 },
  ],
  chamadas: [
    { t: '2026-09-22T20:27:14.549Z', rota: 'perfil', ms: 21, http: 0, ok: false, errorCategory: 'transient',
      corpoReq: { sessionToken: TOKEN, region: 'row', nome: LOCAL } },
  ],
  momentos: [
    { t: '2026-09-22T20:27:24.824Z', motivo: 'manual', tela: 'app', painel: 'carregando', cardMontado: true,
      modais: [], rede: { online: false }, offline: { ligado: true },
      estado: { fila: 236, serverTotal: 236, hasMore: false, loadError: false,
                atual: { nome: LOCAL } },
      imagens: [{ src: 'https://x/' + LOCAL, quebrada: false }],
      alertas: [{ chave: 'esqueletoSobreCard', msg: 'x' }], dom: '<div>' + DOM + '</div>' },
  ],
  erros: [{ t: '2026-09-22T20:27:30.000Z', tipo: 'erro', msg: 'falhou levando ' + TOKEN + ' no meio' }],
  localStorage: { waze_session_token: TOKEN, waze_places_theme: 'dark' },
  sessionStorage: { x: TOKEN },
  cookiesDestaOrigem: 'sessao=' + COOKIE,
  appState: { queue: [{ name: LOCAL, address: 'Rua ' + LOCAL }] },
  dom: '<html>' + DOM + '</html>',
  codigo: { '/js/app.js': { corpo: DOM } },
});

function rodar(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'diag-resumo-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, JSON.stringify(obj));
  return execFileSync(process.execPath, [join(ROOT, 'tools/diag-resumo.mjs'), arq],
    { encoding: 'utf8', timeout: 20000 });
}

test('diag-resumo: mostra a triagem — alertas das capturas, offline, worker, diário', () => {
  const s = rodar(relatorioV4());
  assert.match(s, /nas capturas: 20:27:24\.824 manual \(painel carregando\) → esqueletoSobreCard, toqueInterceptado/,
    'o alerta DA CAPTURA tem que aparecer na triagem — é o que o relatório, gerado depois, não vê');
  assert.match(s, /relatório gerado com modal aberto/, 'o aviso de modal aberto sumiu');
  assert.match(s, /card montado: true/, 'a tela do relatório tem que dizer que havia card montado');
  assert.match(s, /fila guardada \{"n":236,"idadeMin":2\}/, 'a seção offline sumiu da triagem');
  assert.match(s, /lista pronta true com 428 tiles/, 'a resposta do worker sumiu da triagem');
  assert.match(s, /tela\.carregando/, 'o diário sumiu da triagem');
  assert.match(s, /\+0\.089s\s+offline\.abriu/, 'o diário tem que vir com o tempo RELATIVO (é ele que conta a história)');
  assert.match(s, /perfil\s+http 0 · FALHOU · 21 ms · transient/, 'as chamadas sumiram da triagem');
});

test('diag-resumo: NUNCA imprime credencial nem dado de terceiro em massa (canários)', () => {
  const s = rodar(relatorioV4());
  assert.ok(!s.includes(TOKEN), 'o TOKEN vazou na saída');
  assert.ok(!s.includes(COOKIE), 'um COOKIE vazou na saída');
  assert.ok(!s.includes(LOCAL), 'dado de terceiro (appState/estado/imagens/corpo) vazou na saída');
  assert.ok(!s.includes(DOM), 'o `dom`/`codigo` vazou na saída');
  // Defesa a mais: o token plantado DENTRO de uma mensagem de erro sai trocado.
  assert.match(s, /falhou levando <TOKEN> no meio/, 'a troca final do token não aconteceu');
});

test('diag-resumo: relatório ANTIGO abre, dizendo o que a versão dele não trazia', () => {
  const v2 = relatorioV4();
  v2._versaoDoDiag = 2;
  delete v2.offline; delete v2.serviceWorker.proprio;
  delete v2.resumo.alertasNasCapturas; delete v2.resumo.telaAgora.cardMontado;
  delete v2.resumo.rede; delete v2.resumo.offline;
  for (const m of v2.momentos) { delete m.alertas; delete m.cardMontado; delete m.rede; delete m.offline; }
  const s = rodar(v2);
  assert.match(s, /relatório v2/);
  assert.match(s, /nas capturas: \(ausente nesta versão\)/);
  assert.match(s, /── OFFLINE ─+\n\(ausente nesta versão\)/);
  assert.ok(!s.includes(TOKEN), 'o token vazou no relatório antigo');
});

test('diag-resumo: lê pela FONTE ÚNICA (`diag-ler.mjs`), não por um parser próprio', () => {
  const SRC = readFileSync(join(ROOT, 'tools/diag-resumo.mjs'), 'utf8');
  assert.match(SRC, /import \{ lerDiagnostico \} from '\.\/diag-ler\.mjs';/,
    'o leitor deixou de usar a fonte única — ZIP renomeado e relato antigo deixariam de abrir');
});

test('diag-resumo: a fila de saída sai em NÚMEROS, e o REPETIDO ganha aviso — sem ids nem autor', () => {
  // v2026.09.22-06: o relato de reabrir sem rede dependia da fila de saída, e o
  // resumo não a mencionava — ela estava só no localStorage, cru, junto do token.
  const VENUE = 'CANARIO-VENUE-8877';
  const d = relatorioV4();
  d._versaoDoDiag = 5;
  d.resumo.saida = { n: 3, distintas: 2, repetidas: 1, tipos: { reject: 2, read: 1 }, maisAntigaMin: 7 };
  d.offline.pousosGravados = 4;
  d.localStorage.waze_places_saida = JSON.stringify([{ tipo: 'reject', venueID: VENUE, updateRequestID: 'u1', nome: LOCAL }]);
  const s = rodar(d);
  assert.match(s, /── FILA DE SAÍDA ─+\nesperando envio 3 · pedidos distintos 2 · REPETIDOS 1 · tipos \{"reject":2,"read":1\} · o mais velho espera há 7 min/,
    'a fila de saída sumiu da triagem');
  assert.match(s, /ATENÇÃO: a mesma decisão está na fila mais de uma vez/, 'o repetido tem que ganhar aviso');
  assert.match(s, /pousos gravados depois da fila guardada: 4/, 'os pousos gravados sumiram da seção offline');
  assert.ok(!s.includes(VENUE), 'o id de um pedido da fila de saída vazou — o leitor não lê o localStorage');
  assert.ok(!s.includes(LOCAL), 'o autor de um pedido da fila de saída vazou');
  assert.ok(!s.includes(TOKEN), 'o token vazou');
  // Sem repetido, sem aviso: aviso que aparece sempre é o que se aprende a ignorar.
  d.resumo.saida = { n: 2, distintas: 2, repetidas: 0, tipos: { read: 2 }, maisAntigaMin: 1 };
  assert.ok(!/ATENÇÃO: a mesma decisão/.test(rodar(d)), 'o aviso de repetido apareceu sem repetido');
});

test('diag-resumo: relatório de antes da fila de saída no resumo diz que ela não vinha', () => {
  const s = rodar(relatorioV4());   // v4: sem `resumo.saida`
  assert.match(s, /── FILA DE SAÍDA ─+\n\(ausente nesta versão\)/);
  assert.match(s, /pousos gravados depois da fila guardada: \(ausente nesta versão\)/);
});

test('diag-resumo: as ABERTURAS ANTERIORES guardadas aparecem, com diário, capturas e alertas — sem dom nem corpo', () => {
  // v2026.09.22-06: o relato que atravessa fechar e reabrir o app. O defeito
  // foi capturado ANTES de fechar, noutra abertura, e o relatório de depois
  // tem que mostrar isso.
  const CORPO = 'CANARIO-CORPO-da-fila';
  const d = relatorioV4();
  d._versaoDoDiag = 5;
  d.aberturaAtual = { id: 'atual-1', inicio: '2026-09-22T22:02:14.000Z' };
  d.aberturasAnteriores = [{
    id: 'ant-9', inicio: Date.parse('2026-09-22T21:58:00.000Z'), salvoEm: Date.parse('2026-09-22T21:59:30.000Z'),
    salvoPor: 'oculta', versao: '2026092206',
    diario: [{ t: 1790114280000, k: 'offline.abriu', n: 276, excluidos: 0 },
             { t: 1790114300000, k: 'saida.abriu', tipo: 'read' }],
    chamadas: [{ t: '2026-09-22T21:58:10.000Z', rota: 'marcar-lido', http: 0, ok: false,
                 errorCategory: 'transient', corpoResposta: CORPO }],
    erros: [{ t: '2026-09-22T21:58:20.000Z', tipo: 'erro', msg: 'quebrou com ' + TOKEN }],
    momentos: [{ t: '2026-09-22T21:59:00.000Z', motivo: 'manual', tela: 'app', painel: 'card', cardMontado: true,
                 modais: [], estado: { fila: 276, serverTotal: 276, atual: { nome: LOCAL } },
                 alertas: [{ chave: 'pedidoDecididoNaFila', msg: 'x' }], dom: '<div>' + DOM + '</div>' }],
  }];
  d.resumo.alertasNasCapturas = [...d.resumo.alertasNasCapturas,
    { t: '2026-09-22T21:59:00.000Z', motivo: 'manual', painel: 'card', abertura: 'ant-9', alertas: ['pedidoDecididoNaFila'] }];
  const s = rodar(d);
  assert.match(s, /nas capturas: 21:59:00\.000 manual \(painel card\) → pedidoDecididoNaFila \[abertura anterior ant-9\]/,
    'o alerta de uma captura de abertura ANTERIOR tem que aparecer na triagem, dizendo de qual abertura');
  assert.match(s, /── ABERTURAS ANTERIORES \(guardadas no aparelho\) ─+\nabertura ant-9 · 2026-09-22 21:58:00 → 2026-09-22 21:59:30 \(guardada por: oculta\) · v2026092206/,
    'a seção das aberturas anteriores sumiu');
  assert.match(s, /diário 2 · chamadas 1 \(falhas 1\) · erros 1 · capturas 1/);
  assert.match(s, /\+20\.000s\s+saida\.abriu/, 'o diário da abertura anterior tem que vir com o tempo relativo DELA');
  assert.match(s, /chamada FALHOU 21:58:10\.000 marcar-lido http 0 · transient/);
  assert.match(s, /  21:59:00\.000  manual · tela app · painel card/, 'a captura da abertura anterior sumiu');
  assert.ok(!s.includes(DOM), 'o dom de uma captura anterior vazou');
  assert.ok(!s.includes(LOCAL), 'dado de terceiro de uma captura anterior vazou');
  assert.ok(!s.includes(CORPO), 'o corpo de uma chamada anterior vazou (nem devia estar guardado)');
  assert.ok(!s.includes(TOKEN), 'o token vazou de dentro de um erro de abertura anterior');
  assert.match(s, /quebrou com <TOKEN>/);
});

test('diag-resumo: relatório de antes das aberturas guardadas diz que elas não vinham', () => {
  assert.match(rodar(relatorioV4()), /── ABERTURAS ANTERIORES \(guardadas no aparelho\) ─+\n\(ausente nesta versão\)/);
});

test('diag-resumo: a presença do app (fase 3) sai em CONTAGENS, com os avisos — nunca nome, texto ou token', () => {
  const d = relatorioV4();
  d._versaoDoDiag = 7;
  d.resumo.presencaApp = {
    ligada: true, online: 2, conversas: 3, naoLidas: 1, atualizadaHaS: 40, conversaAberta: false,
    token: { valido: false, expiraEmH: -1 },
    fluxo: { aberto: true, haS: 12, tentativa: 0, aberturas: 4, quadros: 31, mensagens: 2, recibos: 1, ultimoFim: 1, ultimoErro: null },
    conhecidos: 5, aConfirmar: 95,
  };
  const s = rodar(d);
  assert.match(s, /── PRESENÇA NO APP \(lista e conversa\) ─+\nligada true · no app 2 · conversas 3 · não lidas 1/, 'a seção da presença do app sumiu');
  assert.match(s, /tempo real aberto true há 12 s · aberturas 4 · quadros 31 · mensagens 2 · recibos 1 · recuo 0/);
  assert.match(s, /ATENÇÃO: o token do tempo real venceu/, 'o aviso do token vencido não saiu');
  assert.match(s, /ATENÇÃO: a fila de confirmação está quase no teto/, 'o aviso da confirmação não saiu');
  assert.ok(!s.includes(TOKEN), 'o token vazou');
  // Relatório de antes da fase 3: a seção diz que não havia.
  const antigo = rodar(relatorioV4());
  assert.match(antigo, /── PRESENÇA NO APP \(lista e conversa\) ─+\n\(ausente nesta versão\)/);
});

// ── v8 (v2026.09.24-02): o relatório pra entender os relatos da fase 3 ──────
// Com o modo dev, o anel de chamadas passou a guardar a conversa (o texto que
// sai e a resposta do chat). O LEITOR segue imprimindo só a triagem: quem
// precisa da conversa abre o arquivo; o resumo é o que se cola numa conversa
// sobre o relato, e ali texto de terceiro não ajuda.
const TEXTO = 'CANARIO-TEXTO-da-conversa';

const relatorioV8 = () => {
  const d = relatorioV4();
  d._versaoDoDiag = 8;
  d.app = { versao: '2026092402', rotulo: '2026.09.24-02' };
  d.resumo.presencaWme = { ligada: true, ligarNaProxima: false, enviadas: 3, falhas: 0, ultimaFalha: null,
                           ultimaHaS: 1200, perfilVisivel: false, perfilHaS: 1300, marcaPerdida: false };
  d.resumo.presencaApp = {
    ligada: true, online: 0, conversas: 1, naoLidas: 0, atualizadaHaS: 30, conversaAberta: true,
    token: { valido: true, expiraEmH: 23 },
    fluxo: { aberto: true, haS: 12, tentativa: 0, aberturas: 2, quadros: 9, mensagens: 1, recibos: 0,
             ignoradas: 4, quedasSeguidas: 2, ultimoFim: 1, ultimoErro: 'TypeError' },
    conhecidos: 1, aConfirmar: 0,
    contagem: { online: { noWme: 48, comMarca: 3, noPais: 0 }, conversas: { noWaze: 9, marcadas: 1, daApp: 1 } },
  };
  d.chamadas.push(
    { t: '2026-09-24T18:00:01.000Z', rota: 'chat', ms: 180, http: 200, ok: true,
      corpoReq: { acao: 'enviar', texto: TEXTO, para: '183164343' }, corpoResposta: JSON.stringify({ success: true, eco: TEXTO }) },
    { t: '2026-09-24T18:00:02.000Z', rota: 'chat', ms: 90, http: 200, ok: true,
      corpoReq: { acao: 'abrir', com: '183164343' },
      corpoResposta: JSON.stringify({ success: true, mensagens: [{ texto: TEXTO }], token: '[credencial do tempo real]' }) });
  d.codigo = {
    'https://x.dev/': { http: 200, bytes: 20000, hash: 'aaaa' },
    'https://x.dev/js/min/version.js': { http: 200, bytes: 180, hash: 'bbbb', versao: '2026092402' },
    'https://x.dev/service-worker.js': { http: 200, bytes: 9000, hash: 'cccc', versao: '2026092401' },
    'https://x.dev/css/app.css': { http: 200, bytes: 60000, hash: 'dddd', corpo: '.x{}' + DOM },
  };
  d.cacheVsRede = {
    'https://x.dev/': { aparelho: 'aaaa', servidor: 'aaaa', igual: true, bytesAparelho: 20000, bytesServidor: 20000, http: 200 },
    'https://x.dev/js/min/app.js': { aparelho: 'eeee', servidor: 'ffff', igual: false, bytesAparelho: 70000, bytesServidor: 70100, http: 200 },
    'https://x.dev/manifest.json': { erro: 'Failed to fetch' },
  };
  return d;
};

test('diag-resumo v8: a lista do app vem com o PORQUÊ contado no servidor', () => {
  const s = rodar(relatorioV8());
  assert.match(s, /no WME agora: 48 visíveis · com a marca do app: 3 · no país do filtro: 0/, 'o porquê da lista de online sumiu');
  assert.match(s, /conversas no Waze: 9 · com a marca do app: 1 · entram na lista \(marca ou já conhecida\): 1/);
  assert.match(s, /mensagens só do WME \(ignoradas de propósito\) 4 · quedas seguidas do tempo real 2/);
  assert.match(s, /último erro: TypeError/);
  // Parte que falhou no servidor diz que falhou — não "0 visíveis".
  const f = relatorioV8();
  f.resumo.presencaApp.contagem = { online: { falhou: 'transient' }, conversas: { noWaze: 0, marcadas: 0, daApp: 0 } };
  assert.match(rodar(f), /lista do WME: FALHOU \(transient\)/);
  // Relatório v7 (sem contagem): a linha diz que a versão não trazia.
  const v7 = relatorioV8();
  v7._versaoDoDiag = 7;
  delete v7.resumo.presencaApp.contagem;
  assert.match(rodar(v7), /por que a lista é essa: \(ausente nesta versão\)/);
});

test('diag-resumo v8: a presença no WME diz o que o perfil disse e explica quem sumiu da lista por estar parado', () => {
  const s = rodar(relatorioV8());
  assert.match(s, /o perfil do WME disse visível: false \(há 1300 s\)/);
  assert.match(s, /nota: 20 min sem escrever a posição — pros outros, a pessoa já saiu da lista/);
  const d = relatorioV8();
  Object.assign(d.resumo.presencaWme, { enviadas: 0, ultimaHaS: null });
  assert.match(rodar(d), /nota: nenhuma ação com presença desde que o app abriu/);
  // Controle: quem escreveu há pouco não ganha nota nenhuma.
  Object.assign(d.resumo.presencaWme, { enviadas: 2, ultimaHaS: 60 });
  assert.ok(!/nota: .*(sem escrever|nenhuma ação)/.test(rodar(d)), 'nota de presença apareceu sem motivo');
});

test('diag-resumo v8: o CÓDIGO no aparelho — versões declaradas, arquivos diferentes do servidor, e nunca o corpo', () => {
  const s = rodar(relatorioV8());
  assert.match(s, /── CÓDIGO NO APARELHO ─+\napp 2026092402 · declarado nos arquivos: \/js\/min\/version\.js 2026092402 · \/service-worker\.js 2026092401/);
  assert.match(s, /nota: os arquivos declaram 2 versões diferentes/, 'a mistura de versões não foi notada');
  assert.match(s, /3 arquivos conferidos com o servidor · diferentes: 1 · sem conferir: 1/);
  assert.match(s, /DIFERENTE: \/js\/min\/app\.js \(aparelho 70000 bytes · servidor 70100 bytes\)/);
  assert.match(s, /ATENÇÃO: o aparelho roda código diferente do servidor/);
  assert.ok(!s.includes(DOM), 'o corpo do CSS vazou na saída');
  // Controle: tudo igual e uma versão só — nem nota, nem atenção.
  const d = relatorioV8();
  d.codigo['https://x.dev/service-worker.js'].versao = '2026092402';
  d.cacheVsRede = { 'https://x.dev/': d.cacheVsRede['https://x.dev/'] };
  const t = rodar(d);
  assert.ok(!/nota: os arquivos declaram/.test(t) && !/ATENÇÃO: o aparelho roda código diferente/.test(t), 'aviso de código sem diferença');
});

test('diag-resumo v8: as chamadas do chat dizem a AÇÃO — e a conversa que o modo dev guarda não sai no resumo', () => {
  const s = rodar(relatorioV8());
  assert.match(s, /chat \(enviar\)\s+http 200 · ok · 180 ms/);
  assert.match(s, /chat \(abrir\)\s+http 200 · ok · 90 ms/);
  assert.ok(!s.includes(TEXTO), 'o texto de uma conversa vazou no resumo');
  assert.ok(!s.includes('183164343'), 'o id de quem conversa vazou no resumo');
  assert.ok(!s.includes(TOKEN), 'o token vazou');
});

test('diag-resumo: o `/` que difere SÓ pelo script do Cloudflare não vira "versão velha" nos relatórios antigos', () => {
  // MEDIDO em produção em 2026-09-25: a borda injeta no HTML, a cada resposta,
  // um script com token e hora próprios — mesmo tamanho, bytes diferentes. Até o
  // v9 o app comparava com ele, e TODO relatório de produção dizia "o aparelho
  // roda código diferente do servidor".
  const d = relatorioV8();
  d.cacheVsRede = {
    'https://x.dev/': { aparelho: 'aaaa', servidor: 'abab', igual: false, bytesAparelho: 116709, bytesServidor: 116709, http: 200 },
    'https://x.dev/js/min/app.js': { aparelho: 'eeee', servidor: 'eeee', igual: true, bytesAparelho: 70000, bytesServidor: 70000, http: 200 },
  };
  const s = rodar(d);
  assert.match(s, /2 arquivos conferidos com o servidor · diferentes: 0/, 'o `/` do Cloudflare contou como diferença');
  assert.match(s, /DIFERENTE: \/ \(aparelho 116709 bytes · servidor 116709 bytes\) — com o mesmo tamanho: é o script que o Cloudflare injeta/);
  assert.doesNotMatch(s, /ATENÇÃO: o aparelho roda código diferente/, 'alarme falso de versão velha');
  // Controle 1: tamanhos diferentes no `/` É diferença de verdade, mesmo no v8.
  const c1 = relatorioV8();
  c1.cacheVsRede = { 'https://x.dev/': { aparelho: 'aaaa', servidor: 'abab', igual: false, bytesAparelho: 116709, bytesServidor: 117000, http: 200 } };
  assert.match(rodar(c1), /ATENÇÃO: o aparelho roda código diferente/, 'a exceção engoliu diferença real no `/`');
  // Controle 2: do v9 em diante o app já desconta a borda — o `/` diferente é real.
  const c2 = relatorioV8();
  c2._versaoDoDiag = 9;
  c2.cacheVsRede = { 'https://x.dev/': { aparelho: 'aaaa', servidor: 'abab', igual: false, bytesAparelho: 116709, bytesServidor: 116709, http: 200 } };
  assert.match(rodar(c2), /ATENÇÃO: o aparelho roda código diferente/, 'no v9 o `/` diferente passou a ser ignorado');
});

test('diag-resumo v10: o "já tratado" não é FALHOU — nem na lista, nem na conta, nem nas aberturas anteriores', () => {
  const d = relatorioV4();
  d._versaoDoDiag = 10;
  d.resumo.falhas = 1;
  d.resumo.jaTratadas = 1;
  d.chamadas = [
    { t: '2026-09-22T20:27:14.549Z', rota: 'validar-place', ms: 21, http: 200, ok: false,
      errorCategory: 'already_processed', errorKey: 'srv.err.alreadyHandled' },
    { t: '2026-09-22T20:27:15.549Z', rota: 'buscar-places', ms: 21, http: 0, ok: false, errorCategory: 'transient' },
  ];
  d.aberturasAnteriores = [{
    id: 'ant-1', inicio: '2026-09-22T21:58:00.000Z', fim: '2026-09-22T21:59:30.000Z', guardadaPor: 'oculta', app: '2026092206',
    diario: [], erros: [], momentos: [],
    chamadas: [{ t: '2026-09-22T21:58:10.000Z', rota: 'marcar-lido', http: 500, ok: false, errorCategory: 'already_processed' }],
  }];
  const s = rodar(d);
  assert.match(s, /validar-place\s+http 200 · já tratado · 21 ms · already_processed/,
    'o "já tratado" (outro editor chegou antes) saiu como FALHOU na lista de chamadas');
  assert.match(s, /buscar-places\s+http 0 · FALHOU · 21 ms · transient/, 'a falha de verdade deixou de ser FALHOU');
  assert.match(s, /chamadas 2 \(falhas 1 · já tratadas 1\)/, 'a triagem não separa o "já tratado" das falhas');
  assert.match(s, /diário 0 · chamadas 1 \(falhas 0\)/, 'a abertura anterior conta o "já tratado" como falha');
  assert.match(s, /chamada já tratado 21:58:10\.000 marcar-lido http 500 · already_processed/);
});

// ── A duração da sessão (auditoria de 2026-09-26) ─────────────────────────
// `resumo.sessaoDuracaoH` é um OBJETO desde que nasceu, e o leitor o
// interpolava cru: "duração da sessão (h): [object Object]" em todo relatório
// com um ciclo fechado, do v2 ao v10. A seção `sessao` aqui é a que o APP monta:
// `diagSessao` fatiado do fonte e rodado sobre um diário de sessões — o formato
// que o leitor recebe de verdade, e não um que eu imagino.
function sessaoDoApp(diario, nascimento) {
  const APP = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  const ini = APP.indexOf('\nfunction diagSessao() {');
  assert.ok(ini > 0, 'diagSessao sumiu do app.js');
  let prof = 0, fim = -1;
  for (let k = APP.indexOf('{', ini); k < APP.length; k++) {
    if (APP[k] === '{') prof++;
    else if (APP[k] === '}' && --prof === 0) { fim = k + 1; break; }
  }
  const diagSessao = new Function('safeLS', 'NASCIMENTO_KEY', 'lerDiarioDeSessoes',
    APP.slice(ini, fim) + '\nreturn diagSessao;')({ get: () => String(nascimento) }, 'n', () => diario);
  return diagSessao();
}

test('diag-resumo: a duração da sessão sai LEGÍVEL — mediana, menor–maior, n e os pisos (nunca "[object Object]")', () => {
  const H = 3600e3, agora = Date.now();
  // Dois ciclos que CAÍRAM (20 h cada, início medido), e o de agora começado num
  // `jaAtiva` (a sessão já existia quando o diário nasceu): um PISO, fora da conta.
  const sessao = sessaoDoApp([
    { t: agora - 60 * H, e: 'token+', via: 'cookies' }, { t: agora - 40 * H, e: 'caiu', motivo: 'srv.err.cookiesExpired' },
    { t: agora - 30 * H, e: 'token+', via: 'extensao' }, { t: agora - 10 * H, e: 'caiu', motivo: 'srv.err.sessionExpired' },
    { t: agora - 9 * H, e: 'jaAtiva' },
  ], agora - 70 * H);
  assert.deepEqual(sessao.duracaoH, { menor: 20, mediana: 20, maior: 20, n: 2 },
    'PRÉ-CONDIÇÃO: o app mudou o formato da duração — o leitor e este teste precisam ser revistos');
  const d = relatorioV4();
  d._versaoDoDiag = 10;
  d.resumo.sessaoDuracaoH = sessao.duracaoH;
  d.sessao = sessao;
  const s = rodar(d);
  assert.ok(!s.includes('[object Object]'), 'algum objeto foi interpolado cru na triagem');
  assert.match(s, /duração da sessão \(h\): mediana 20 · menor–maior 20–20 · n 2 · pisos 1 \(≥ 9, em curso\) · nascimento /,
    'a duração da sessão não saiu legível (mediana, menor–maior, n e os pisos)');
  // Sem ciclo fechado: a linha diz POR QUE não há número, em vez de um "—" mudo.
  const semCiclo = relatorioV4();
  semCiclo.resumo.sessaoDuracaoH = null;
  semCiclo.sessao = sessaoDoApp([{ t: agora - H, e: 'token+', via: 'cookies' }], agora - 2 * H);
  assert.match(rodar(semCiclo), /duração da sessão \(h\): — \(nenhum ciclo fechado com o início medido\) · pisos 0 · /);
  // Relatório ANTIGO (v2: a conta já era objeto, os pisos ainda não existiam).
  const v2 = relatorioV4();
  v2._versaoDoDiag = 2;
  v2.resumo.sessaoDuracaoH = { menor: 30, mediana: 30, maior: 30, n: 1 };
  v2.sessao = { nascimento: null, idadeDoArmazenamentoH: null, ciclos: [{ durouH: 30, fim: 'caiu' }] };
  const t2 = rodar(v2);
  assert.ok(!t2.includes('[object Object]'), 'o relatório antigo voltou a imprimir o objeto cru');
  assert.match(t2, /duração da sessão \(h\): mediana 30 · menor–maior 30–30 · n 1 · pisos \(ausente nesta versão\)/);
  // E o v1, que nem trazia a conta.
  assert.match(rodar(relatorioV4()), /duração da sessão \(h\): \(ausente nesta versão\) · nascimento/);
});

test('diag-resumo: o offline DESLIGADO diz "desligado" — não "ausente nesta versão"', () => {
  // Com o interruptor desligado o app sai cedo da seção (quem não marca não
  // paga nada): fila, janela e tiles não existem. O leitor atribuía isso à
  // VERSÃO do relatório — "fila guardada (ausente nesta versão)" num v10.
  const d = relatorioV4();
  d._versaoDoDiag = 10;
  d.offline = { ligado: false, janelaServida: null, janelaAtual: 1492033, resultado: null, varrendo: false,
                tilesGuardadosQueFalharam: 0 };
  const s = rodar(d);
  const secaoOff = (s.split('── OFFLINE ')[1] || '').split('\n── ')[0];
  assert.match(secaoOff, /desligado — nada guardado no aparelho/, 'o offline desligado não foi dito');
  assert.ok(!secaoOff.includes('ausente nesta versão'), 'o leitor atribuiu à versão o que é o interruptor desligado');
  // CONTROLE: ligado, a seção segue mostrando o que o aparelho guardou.
  assert.match(rodar(relatorioV4()), /fila guardada \{"n":236,"idadeMin":2\}/);
});

test('diag-resumo: o painel vem com a VARIANTE — "Fim da fila" não é "tudo limpo"', () => {
  // O `painel` dizia "tudoLimpo" também no "Fim da fila" (pulados pendentes) e
  // no "nada tratado nesta fila". A variante entrou no relatório v11.
  const d = relatorioV4();
  d._versaoDoDiag = 11;
  d.resumo.telaAgora = { ...d.resumo.telaAgora, painel: 'tudoLimpo', variante: 'fimDaFila' };
  d.momentos[0] = { ...d.momentos[0], painel: 'tudoLimpo', variante: 'nadaNestaFila' };
  const s = rodar(d);
  assert.match(s, /tela app · painel tudoLimpo \(fim da fila: há pulados pendentes\) · card montado/);
  assert.match(s, /manual · tela app · painel tudoLimpo \(nada tratado nesta fila\) · card montado/);
  // CONTROLE: relatório sem a variante (anterior ao v11) sai como sempre.
  assert.match(rodar(relatorioV4()), /tela app · painel carregando · card montado: true/);
});

test('diag-resumo: o link de PAREAMENTO nunca sai — nem de um relatório antigo que o trazia no diário', () => {
  // Até a auditoria de 2026-09-26 (D1), o toast copiável do pareamento (quando a
  // área de transferência falha) ia inteiro pro diário, e a triagem o imprimia.
  const SEGREDO = 'CANARIOPAREAMENTO20X';
  const d = relatorioV4();
  d.diario.push({ t: 1790108834600, k: 'toast', tipo: 'info', txt: 'https://app.x/#pair=' + SEGREDO });
  d.erros.push({ t: '2026-09-22T20:27:31.000Z', tipo: 'erro', msg: 'abriu /?pair=' + SEGREDO + '&x=1' });
  const s = rodar(d);
  assert.ok(!s.includes(SEGREDO), 'o segredo do pareamento saiu na triagem');
  assert.match(s, /#pair=<PAREAMENTO>/, 'o link do diário não foi trocado pelo marcador');
  assert.match(s, /\?pair=<PAREAMENTO>&x=1/, 'o link antigo (query) não foi trocado');
  // CONTROLE: o resto da linha do diário continua lá.
  assert.match(s, /toast\s+\{"tipo":"info","txt":"https:\/\/app\.x\/#pair=<PAREAMENTO>"\}/);
});

test('diag-resumo: a COLETA diz o que ficou sem resposta — a rede pendurada DITA, não deduzida', () => {
  // D15 (auditoria de 2026-09-26): o relatório passou a ter um orçamento, e o
  // que não chegou dentro dele sai em `coleta.semResposta`. Sem esta linha a
  // triagem mostrava só "sem conferir: N", que também é o 404 e o erro comum.
  const d = relatorioV4();
  d.coleta = { ms: 10012, orcamentoMs: 10000, semResposta: ['http://127.0.0.1:8080/js/min/app.js', '/css/app.css', '/'] };
  const s = rodar(d);
  assert.match(s, /coleta: 10012 ms \(orçamento 10000 ms\) · sem resposta: 3/, 'a coleta não aparece na triagem');
  assert.match(s, /ATENÇÃO: 3 leitura\(s\) sem resposta no orçamento — rede pendurada na hora do relatório: \/js\/min\/app\.js, \/css\/app\.css, \//,
    'o que não chegou não é nomeado (e sem a origem, como o resto da seção)');
  // CONTROLE: coleta limpa não acusa nada; relatório antigo (sem `coleta`) não ganha a linha.
  const boa = relatorioV4();
  boa.coleta = { ms: 812, orcamentoMs: 10000, semResposta: [] };
  const sb = rodar(boa);
  assert.match(sb, /coleta: 812 ms \(orçamento 10000 ms\) · sem resposta: 0/);
  assert.doesNotMatch(sb, /leitura\(s\) sem resposta/, 'a coleta limpa acusou rede pendurada');
  assert.doesNotMatch(rodar(relatorioV4()), /coleta:/, 'relatório sem coleta ganhou uma linha inventada');
});
