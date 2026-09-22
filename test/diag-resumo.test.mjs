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
  // v2026.09.22-06: o relato que atravessa fechar e reabrir a app. O defeito
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
