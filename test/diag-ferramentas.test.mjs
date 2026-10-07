// As duas ferramentas que leem um diagnóstico do modo dev.
//
// `diag-replay.mjs` reconstrói a TELA do editor localmente (sem rede) e
// `diag-api.mjs` PERGUNTA à API de produção com o token que o próprio arquivo
// carrega — ideia do owner, e ela tira a maior parte dos pedidos de `cookies.txt`
// do caminho: o token é a chave da NOSSA API, que tem os cookies do Waze
// cifrados no servidor.
//
// O que este arquivo trava é a SEGURANÇA da segunda. Ela age na conta de quem
// gerou o diagnóstico, então "só leitura" não pode depender de eu lembrar —
// tem que ser recusa por construção, como o `waze-probe.mjs` faz com `/Features`
// e `/Issues/Read`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = readFileSync(join(ROOT, 'tools/diag-api.mjs'), 'utf8');
const REPLAY = readFileSync(join(ROOT, 'tools/diag-replay.mjs'), 'utf8');
const APP = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
const CORE = readFileSync(join(ROOT, 'server/core.mjs'), 'utf8');

// Cada rota do core, CLASSIFICADA pelo que ela faz na conta de quem gerou o
// diagnóstico. A régua é "só lê" contra "escreve, DESLOGA, ou lê o que não é da
// ferramenta" (conversa privada, credencial do tempo real). `perfil` parecia
// leitura e APAGA a sessão quando o portão recusa — medido no teste logo abaixo,
// com o core de verdade —, e estava na lista de leitura da ferramenta até a
// auditoria de 2026-09-26. A lista sai do ROUTES do core, então rota nova sem
// classificação reprova aqui em vez de passar despercebida.
const SO_LE = new Set(['buscar-places', 'lista-paises', 'lista-estados']);
const RECUSADAS = new Set(['sessao', 'parear', 'testar-cookies', 'perfil', 'marcar-lido', 'guardar-pedido',
  'validar-place', 'excluir-foto', 'renomear-local', 'presenca-waze', 'presenca-app', 'chat']);
const conjunto = (nome) => {
  const bloco = API.match(new RegExp(`const ${nome} = new Set\\(\\[([^\\]]+)\\]\\)`));
  assert.ok(bloco, `a lista ${nome} sumiu da ferramenta`);
  return new Set([...bloco[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
};

test('diag-api: TODA rota que não só LÊ está na lista de recusa — e a de leitura é exatamente a das que só leem', () => {
  const recusadas = conjunto('ESCRITA');
  const leitura = conjunto('LEITURA');

  // Do bloco `ROUTES` inteiro, com e SEM aspas na chave: o padrão antigo só
  // casava chave entre aspas e deixava de fora `sessao`, `parear`, `perfil` e
  // `chat` (4 de 15) — rota nova de nome simples passaria calada.
  const ini = CORE.indexOf('const ROUTES = {');
  assert.ok(ini > 0, 'o bloco ROUTES sumiu do core');
  const blocoRotas = CORE.slice(ini, CORE.indexOf('};', ini));
  const rotas = [...blocoRotas.matchAll(/^\s*'?([a-z-]+)'?\s*:\s*handle/gm)].map((m) => m[1]);
  assert.ok(rotas.length >= 14, `só ${rotas.length} rotas achadas no core — o padrão do ROUTES mudou`);
  assert.ok(rotas.includes('sessao') && rotas.includes('chat'), 'o extrator voltou a perder as chaves sem aspas');
  for (const r of rotas) {
    assert.ok(SO_LE.has(r) !== RECUSADAS.has(r),
      `a rota "${r}" não está classificada (ou está nas duas listas) — decida se ela SÓ LÊ ou se escreve/desloga`);
    if (RECUSADAS.has(r)) {
      assert.ok(recusadas.has(r),
        `a rota "${r}" escreve/desloga e NÃO está recusada em diag-api.mjs — ela agiria na conta de terceiro`);
    }
  }
  assert.deepEqual([...leitura].sort(), [...SO_LE].sort(),
    'a lista de LEITURA da ferramenta não é a das rotas que só leem — `perfil` desloga quando o portão recusa');
});

// A CLASSIFICAÇÃO do `perfil` medida, não afirmada: com o core de verdade e um
// Waze de mentira, a conta que o portão recusa perde a sessão no servidor.
// CONTROLE: a conta que passa no portão continua com ela — sem isto, "a sessão
// sumiu" não distinguiria o portão de um store que apaga tudo.
test('diag-api: `perfil` DESLOGA quando o portão recusa (por isso a ferramenta o recusa)', async () => {
  const { sessaoDeTeste } = await import('./_sessao.mjs');
  const { dispatch } = await import('../server/core.mjs');
  const COOKIES = '.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tabc\n.waze.com\tTRUE\t/\tTRUE\t0\t_csrf_token\txyz\n';
  const fetchOriginal = globalThis.fetch;
  const perfilDoWaze = (rank, am) => async () => new Response(JSON.stringify({ id: 1, userName: 'x', rank, isAreaManager: am, isStaff: false }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const recusado = await sessaoDeTeste(COOKIES);
    globalThis.fetch = perfilDoWaze(0, false);
    const r = await dispatch('perfil', { sessionToken: recusado.sessionToken, region: 'row' }, recusado.ctx);
    assert.equal(r.status, 403, 'PRÉ-CONDIÇÃO: o portão não recusou a conta L1 sem AM');
    assert.equal(recusado.store.mem.size, 0, 'o `perfil` recusado deixou a sessão — se ele parou de deslogar, releia a classificação');
    const aceito = await sessaoDeTeste(COOKIES);
    globalThis.fetch = perfilDoWaze(5, true);
    const r2 = await dispatch('perfil', { sessionToken: aceito.sessionToken, region: 'row' }, aceito.ctx);
    assert.equal(r2.status, 200);
    assert.equal(aceito.store.mem.size, 1, 'CONTROLE: a conta que passa no portão perdeu a sessão — a medida acima não distingue nada');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('diag-api: a recusa acontece ANTES de qualquer rede', () => {
  const iRecusa = API.indexOf("if (!/^[a-z-]+$/.test(ROTA) || !LEITURA.has(ROTA))");
  const iFetch = API.indexOf('await fetch(');
  assert.ok(iRecusa > 0 && iFetch > iRecusa,
    'a checagem de escrita deixou de vir antes do fetch — a recusa viraria enfeite');
});

test('diag-api: o token nunca é impresso nem vai por linha de comando', () => {
  // Ele viaja no CORPO do POST, que é onde a criptografia do app pressupõe que
  // ele viva (gotcha #60: token em URL/query/log derruba a garantia).
  assert.ok(!/console\.log\([^)]*\btoken\b/.test(API), 'algum console.log imprime o token');
  assert.match(API, /sessionToken: '<TOKEN>'/, 'o resumo do corpo parou de mascarar o token');
  assert.match(API, /body: JSON\.stringify\(corpo\)/, 'o token saiu do corpo do POST');
  assert.ok(!/[?&]sessionToken=/.test(API), 'o token foi parar numa query string');
});

test('diag-api: usa o jitter da FONTE ÚNICA, não um sleep próprio', () => {
  assert.match(API, /import \{ pausaComJitter \} from '\.\/waze-jitter\.mjs'/,
    'parou de importar o jitter da fonte única');
  assert.match(API, /await pausaComJitter\(\)/, 'o jitter não é chamado');
  assert.ok(!/setTimeout\(\s*\w+\s*,\s*\d{3,}/.test(API), 'apareceu um sleep próprio no lugar do jitter');
});

test('diag-api: recusa de verdade, rodando o script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'diag-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, JSON.stringify({
    app: { url: 'https://exemplo.invalido/' },
    localStorage: { waze_session_token: 'nao-usado-porque-recusa-antes' },
  }));
  for (const rota of ['marcar-lido', 'validar-place', 'excluir-foto', 'renomear-local', 'sessao', 'perfil']) {
    let saiu = 0;
    try {
      execFileSync(process.execPath, [join(ROOT, 'tools/diag-api.mjs'), arq, rota],
        { stdio: 'pipe', timeout: 20000 });
    } catch (e) { saiu = e.status; }
    assert.equal(saiu, 3, `"${rota}" não foi recusada com saída 3`);
  }
});

// Comentário NÃO é código: a primeira versão deste teste reprovou o arquivo
// certo porque casou com a linha que DIZ "não chama /api/*". É o gotcha #14 —
// o grep que casa com o comentário que cita a coisa. Aqui os comentários saem
// antes de olhar, e a função tem contraprova logo abaixo.
const semComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

test('diag-replay: não fala com a rede — o estado vem do arquivo', () => {
  // Se ele chamasse `/api/*`, deixaria de reproduzir o arquivo e passaria a
  // medir a fila de HOJE — que é outra coisa, e sem aviso.
  const codigo = semComentarios(REPLAY);
  assert.ok(!/['"`]\/api\//.test(codigo) && !/api\/(perfil|buscar-places|marcar-lido)/.test(codigo),
    'o replay começou a chamar /api/ — ele deixaria de reproduzir o arquivo');
  assert.match(REPLAY, /serviceWorkers: 'block'/, 'o replay parou de bloquear o service worker');

  // CONTRAPROVA do instrumento: um fonte que REALMENTE chama tem que reprovar,
  // e um que só cita em comentário tem que passar. Sem isto o teste volta a ser
  // decoração — foi assim que ele nasceu.
  const chama = `await fetch('/api/perfil')`;
  const soCita = `// nunca chamamos /api/perfil aqui`;
  assert.ok(/['"`]\/api\//.test(semComentarios(chama)), 'o instrumento não enxerga uma chamada de verdade');
  assert.ok(!/['"`]\/api\//.test(semComentarios(soCita)), 'o instrumento ainda casa com comentário');
});

test('diag-replay: silencia a primeira execução antes da carga', () => {
  // O modal "Como funciona" cobre o card INTEIRO no Fold, e aí toda medição
  // mede o modal. Custou uma rodada de mockups descobrir.
  const iInit = REPLAY.indexOf('addInitScript');
  const iGoto = REPLAY.indexOf('page.goto(');
  assert.ok(iInit > 0 && iGoto > iInit, 'as preferências deixaram de entrar ANTES da carga');
  assert.match(REPLAY, /comoFuncionaVisto: true/, 'o replay parou de silenciar a primeira execução');
});

test('diagnóstico: currentPlace vai como ÍNDICE, não duplicado', () => {
  // `currentPlace` É `queue[0]`, então serializar os dois marcava um deles como
  // "[circular]" — e o perdido era sempre o card que a pessoa estava VENDO.
  assert.match(APP, /fora\.currentPlaceIdx = idx/, 'o índice sumiu do diagnóstico');
  assert.match(APP, /delete copia\.currentPlace/, 'o currentPlace voltou a ser duplicado no diagnóstico');
  // E o replay tem que continuar entendendo o formato ANTIGO, que já está no
  // aparelho dos editores.
  assert.match(REPLAY, /'\[circular\]'/, 'o replay parou de remendar os arquivos do formato antigo');
});

// ── diag-tela (auditoria de 2026-09-26) ─────────────────────────────────────
const TELA = readFileSync(join(ROOT, 'tools/diag-tela.mjs'), 'utf8');
const fatiarDaTela = (nome) => {
  const ini = TELA.indexOf('\nfunction ' + nome + '(');
  assert.ok(ini > 0, `${nome} sumiu do diag-tela`);
  let prof = 0, fim = -1;
  for (let k = TELA.indexOf('{', TELA.indexOf(')', ini)); k < TELA.length; k++) {
    if (TELA[k] === '{') prof++;
    else if (TELA[k] === '}' && --prof === 0) { fim = k + 1; break; }
  }
  return new Function(TELA.slice(ini, fim) + `\nreturn ${nome};`)();
};

test('diag-tela: a fonte entra NA `@font-face` do app — a família, o peso e o unicode-range são os dele', () => {
  // A ferramenta registrava a fonte como "Inter var" (100–900), um nome que o
  // CSS do app (`Inter`, 300–700) nunca pede: a face ficava `unloaded`, a tela
  // saía na fonte do sistema, e `fontesEmbutidas` afirmava o contrário. Aqui
  // roda sobre o CSS DE VERDADE (o `css/app.css` que o app serve).
  const embutirFontes = fatiarDaTela('embutirFontes');
  const APP_CSS = readFileSync(join(ROOT, 'css/app.css'), 'utf8');
  const lidas = [];
  const { css, fontes } = embutirFontes(APP_CSS, (nome) => { lidas.push(nome); return 'QUFBQQ=='; });
  const faces = css.match(/@font-face\{[^}]*\}/g) || [];
  assert.ok(faces.length >= 2, `PRÉ-CONDIÇÃO: o CSS do app tem ${faces.length} @font-face — o teste precisa ser revisto`);
  for (const f of faces) {
    assert.match(f, /font-family:\s*'?"?Inter'?"?;/, 'a família mudou na remontagem: o app pede `Inter`');
    assert.match(f, /font-weight:\s*300 700/, 'o peso mudou na remontagem: o app declara 300 700');
    assert.match(f, /unicode-range:/, 'o unicode-range da regra do app sumiu');
    assert.match(f, /src:\s*url\(data:font\/woff2;base64,QUFBQQ==\)/, 'a regra do app não recebeu a fonte embutida');
  }
  assert.ok(!/Inter var/.test(css), 'voltou a família inventada');
  assert.deepEqual(fontes.map((x) => x.nome).sort(), [...new Set(lidas)].sort(), '`fontesEmbutidas` tem que ser o que ENTROU no CSS');
  assert.ok(fontes.length >= 2);
  // CONTROLE: fonte que não está no repositório fica como estava (e não entra na lista).
  const semArquivo = embutirFontes(APP_CSS, () => null);
  assert.equal(semArquivo.css, APP_CSS);
  assert.deepEqual(semArquivo.fontes, []);
  // E a ferramenta MEDE se a família carregou, na página remontada.
  assert.match(TELA, /document\.fonts\.check\(/, 'o diag-tela deixou de medir se a fonte carregou');
});

test('diag-tela: relatório SEM captura é rotulado com a versão DELE e o painel que ele mediu', () => {
  // Um v10 sem capturas saía como "arquivo v1 · painel=?".
  const momentosDoRelatorio = fatiarDaTela('momentosDoRelatorio');
  const v10 = { _versaoDoDiag: 10, _gerado: 'x', dom: '<html></html>', momentos: [],
                resumo: { telaAgora: { painel: 'tudoLimpo', modais: ['filtersModal'] } } };
  const [m] = momentosDoRelatorio(v10);
  assert.match(m.motivo, /relatório v10/, 'o rótulo não diz a versão real do relatório');
  assert.equal(m.painel, 'tudoLimpo', 'o painel não veio do `resumo.telaAgora`');
  assert.deepEqual(m.modais, ['filtersModal']);
  assert.ok(!/v1\b/.test(m.motivo), 'voltou o "arquivo v1"');
  // CONTROLE: com capturas, são elas que se remontam, iguais.
  const cap = [{ motivo: 'manual', dom: '<html></html>' }];
  assert.equal(momentosDoRelatorio({ momentos: cap, dom: 'x' }), cap);
  assert.deepEqual(momentosDoRelatorio({ momentos: [] }), []);
});

// ── R10-4-09: a pasta de saída RELATIVA ─────────────────────────────────────
// O uso diz só `[pasta-de-saida]`. Com uma pasta relativa, a página remontada
// era aberta em `'file://' + caminho`: o primeiro nome do caminho virava o HOST
// da URL (em minúsculas) e a navegação morria em `net::ERR_INVALID_URL`
// (auditoria da rodada 10, MEDIDO: `file://tela-7uccjh/.momento-1.html`). O
// endereço sai do `urlDoArquivo` de VERDADE, com o `pathToFileURL` e o
// `resolve` do Node.
test('diag-tela: a pasta de saída RELATIVA vira um endereço `file:` que aponta pro arquivo (R10-4-09)', () => {
  const ini = TELA.indexOf('\nfunction urlDoArquivo(');
  assert.ok(ini > 0, 'urlDoArquivo sumiu do diag-tela');
  const fim = TELA.indexOf('\n}\n', ini) + 2;
  const urlDoArquivo = new Function('pathToFileURL', 'resolve', TELA.slice(ini, fim) + '\nreturn urlDoArquivo;')(pathToFileURL, resolve);
  for (const caminho of ['tela-7ucCjH/.momento-1.html', 'saida/Tela Nova #1/.momento-2.html', '/tmp/diag-tela/.momento-3.html']) {
    const u = urlDoArquivo(caminho);
    assert.equal(new URL(u).protocol, 'file:', `${caminho}: não saiu um endereço file:`);
    assert.equal(new URL(u).host, '', `${caminho}: o começo do caminho virou o HOST da URL (${u}) — a navegação morre em ERR_INVALID_URL`);
    assert.equal(fileURLToPath(u), resolve(caminho), `${caminho}: o endereço não aponta pro arquivo que a ferramenta escreveu`);
  }
  // E é ele que a navegação usa (fora de comentário, gotcha #67).
  const semCom = TELA.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(semCom, /await page\.goto\(urlDoArquivo\(tmp\), \{ waitUntil: 'load' \}\);/,
    'a navegação não passa pelo urlDoArquivo');
  assert.doesNotMatch(semCom, /'file:\/\/' \+/, 'voltou a URL montada à mão');
});

test('diag-api: decide por LISTA DE LEITURA — caminho torto até uma rota de escrita é recusado antes de ler o arquivo', () => {
  // A lista negra deixava passar `x/../marcar-lido`, `./validar-place` e
  // `marcar-lido?x=1`: a URL normaliza DEPOIS da recusa (auditoria 2026-09-25).
  const ferramenta = join(ROOT, 'tools/diag-api.mjs');
  for (const rota of ['x/../marcar-lido', './validar-place', 'marcar-lido?x=1', 'marcar-lido#x', 'MARCAR-LIDO', 'constructor']) {
    let codigo = 0;
    try { execFileSync(process.execPath, [ferramenta, '/nao/existe.zip', rota], { stdio: 'pipe' }); }
    catch (e) { codigo = e.status; }
    assert.equal(codigo, 3, `"${rota}" não foi recusada pela ferramenta (saiu ${codigo})`);
  }
  // CONTROLE: rota de leitura passa da recusa (e aí falha lendo o arquivo, com 1).
  let codigo = 0;
  try { execFileSync(process.execPath, [ferramenta, '/nao/existe.zip', 'buscar-places'], { stdio: 'pipe' }); }
  catch (e) { codigo = e.status; }
  assert.notEqual(codigo, 3, 'a rota de leitura foi recusada — a ferramenta ficou inútil');
  // A base é a ORIGEM da URL do app (com query ou caminho, o POST ia pro lugar errado).
  assert.match(API, /base = new URL\(String\(\(d\.app && d\.app\.url\) \|\| ''\)\)\.origin;/);
});

test('diag-tela: remonta TAMBÉM as capturas das aberturas anteriores (o defeito que atravessa fechar e reabrir)', () => {
  // Auditoria de 2026-09-25: a persistência existe justamente pro defeito que
  // só aparece fechando e reabrindo o app, e a ferramenta que remonta a tela lia
  // só as capturas da abertura atual.
  const TELA = readFileSync(join(ROOT, 'tools/diag-tela.mjs'), 'utf8');
  assert.match(TELA, /d\.aberturasAnteriores/, 'o diag-tela voltou a ignorar as aberturas anteriores');
  // Ancorado em linha, fora de comentário (gotcha #67): é o que a ferramenta USA.
  const semCom = TELA.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(semCom, /^const momentos = momentosEmOrdem\(d, atuais\);$/m);
});

// ── R7-4-04: a outra aba aberta, e a ORDEM do tempo, na remontagem ──────────
// "Primeiro as anteriores, na ordem em que aconteceram" deixou de ser a ordem do
// tempo quando o relatório passou a levar o que a OUTRA ABA aberta gravou
// (R6-4-5): no do auditor, a "anterior" tinha começado depois da do relatório.
test('diag-tela: as capturas vão pela HORA delas, e a da outra aba aberta junto sai rotulada como tal (R7-4-04)', () => {
  const momentosEmOrdem = fatiarDaTela('momentosEmOrdem');
  const d = {
    aberturaAtual: { id: 'esta', inicio: '2026-10-02T19:54:48.006Z' },
    aberturasAnteriores: [
      { id: 'B', inicio: Date.parse('2026-10-02T19:54:48.349Z'), salvoEm: Date.parse('2026-10-02T19:54:49.531Z'),
        momentos: [{ t: '2026-10-02T19:54:48.650Z', motivo: 'manual', dom: 'b1' }, { t: '2026-10-02T19:54:49.099Z', motivo: 'manual', dom: 'b2' }] },
      { id: 'velha', inicio: Date.parse('2026-10-02T18:00:00.000Z'), salvoEm: Date.parse('2026-10-02T18:30:00.000Z'),
        momentos: [{ t: '2026-10-02T18:10:00.000Z', motivo: 'manual', dom: 'v1' }, { t: '2026-10-02T18:11:00.000Z', motivo: 'auto:x' }] },
    ],
  };
  const atuais = [{ t: '2026-10-02T19:54:48.800Z', motivo: 'manual', dom: 'a1' }, { t: '2026-10-02T19:55:00.000Z', motivo: 'manual', dom: 'a2' }];
  const m = momentosEmOrdem(d, atuais);
  assert.deepEqual(m.map((x) => x.dom), ['v1', 'b1', 'a1', 'b2', 'a2'],
    'as capturas não saíram na ordem do TEMPO (as da outra aba aberta junto iam todas antes)');
  assert.deepEqual(m.map((x) => x.motivo), ['[abertura velha] manual', '[outra aba B] manual', 'manual', '[outra aba B] manual', 'manual'],
    'a outra aba aberta junto saiu rotulada como abertura anterior (ou a anterior como outra aba)');
  // Marcada pelo app (`simultanea`) vale mesmo sem a hora de gravação depois.
  const marcada = momentosEmOrdem({ aberturaAtual: d.aberturaAtual, aberturasAnteriores: [{ ...d.aberturasAnteriores[1], simultanea: true }] }, []);
  assert.match(marcada[0].motivo, /^\[outra aba velha\]/);
  // CONTROLE: hora ilegível não embaralha nada (fica no fim, na ordem em que veio) e não derruba.
  const torta = momentosEmOrdem({}, [{ t: 'x:11', motivo: 'm1', dom: 1 }, { t: '2026-10-02T19:00:00.000Z', motivo: 'm2', dom: 2 }, { motivo: 'm3', dom: 3 }]);
  assert.deepEqual(torta.map((x) => x.motivo), ['m2', 'm1', 'm3']);
  assert.deepEqual(momentosEmOrdem({}, []), []);
});

// ── R6-4-6 (auditoria de 2026-10-01): as sentinelas DAS CAPTURAS ──────────────
// O relatório costuma ser baixado com os Filtros abertos, quando as sentinelas
// de toque calam: o defeito está nas CAPTURAS (`m.alertas`, relatório v4+), que
// são justamente o que o diag-tela remonta — e ele lia só o `resumo.alertas`.
// Medido no navegador (t5): o `diag-resumo` do mesmo arquivo acusava
// "esqueletoSobreCard" na captura, e o diag-tela dizia `alertas: []`.
test('diag-tela: as sentinelas de CADA CAPTURA saem no terminal, na linha do momento e no resumo.json (R6-4-6)', () => {
  const sentinelasDaTela = fatiarDaTela('sentinelasDaTela');
  const cap = { t: '2026-10-01T00:30:41.462Z', motivo: 'manual', painel: 'carregando', alertas: [
    { chave: 'toqueInterceptado', msg: 'o toque no ✕ cai noutro elemento', alvo: 'button.card-btn-reject' },
    { chave: 'esqueletoSobreCard', msg: 'o esqueleto de "carregando" está POR CIMA de um card já montado' }] };
  const limpa = { t: '2026-10-01T00:31:00.000Z', motivo: 'manual', painel: 'card', alertas: [] };
  const antiga = { t: '2026-10-01T00:29:00.000Z', motivo: '[abertura x] manual', painel: 'card' };   // relatório < v4
  const semNada = { resumo: { alertas: [] } };   // o relatório baixado com os Filtros abertos
  const s = sentinelasDaTela(semNada, [antiga, cap, limpa], ['momento-01.png', 'momento-02.png', 'momento-03.png']);
  assert.deepEqual(s.porMomento, [[], ['toqueInterceptado', 'esqueletoSobreCard'], []],
    'a linha de cada momento não leva as sentinelas DA captura');
  assert.deepEqual(s.alertasNasCapturas, [{ arquivo: 'momento-02.png', quando: cap.t, motivo: 'manual', painel: 'carregando',
    alertas: ['toqueInterceptado', 'esqueletoSobreCard'] }], 'o resumo.json não diz QUAL captura acusou o quê');
  const texto = s.texto.join('\n');
  assert.match(texto, /momento-02\.png/, 'o terminal não diz qual imagem remontada tem o defeito');
  assert.match(texto, /\[esqueletoSobreCard\] o esqueleto/, 'o terminal não mostra o alerta da captura');
  assert.match(texto, /alvo=button\.card-btn-reject/, 'o terminal perdeu o detalhe do alerta (o alvo do toque)');
  // CONTROLE: sem alerta no relatório e em captura nenhuma, nada é dito.
  assert.deepEqual(sentinelasDaTela(semNada, [antiga, limpa], ['a.png', 'b.png']).texto, []);
  // E as do RELATÓRIO seguem saindo como antes.
  const r = sentinelasDaTela({ resumo: { alertas: [{ chave: 'temaSemClasse', msg: 'o app claro sem tema-claro' }] } }, [limpa], ['a.png']);
  assert.deepEqual(r.alertas.map((a) => a.chave), ['temaSemClasse']);
  assert.match(r.texto.join('\n'), /\[temaSemClasse\] o app claro/);
  assert.deepEqual(r.alertasNasCapturas, []);
  // E a ferramenta USA o que a função devolve — ancorado em linha, fora de comentário (gotcha #67).
  const semCom = TELA.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(semCom, /^const sentinelas = sentinelasDaTela\(d, momentos, momentos\.map\(\(_, i\) => nomeDoMomento\(i\)\)\);$/m,
    'a ferramenta deixou de calcular as sentinelas sobre os momentos que ela remonta');
  assert.match(semCom, /^\s+alertas: sentinelas\.porMomento\[i\],$/m, 'a linha do momento não leva as sentinelas dele');
  assert.match(semCom, /^const resumo = \{[\s\S]*?^\s+alertasNasCapturas,$[\s\S]*?^\};$/m, 'o resumo.json não leva as sentinelas das capturas');
  assert.match(semCom, /^if \(sentinelas\.texto\.length\) console\.log\('\\n' \+ sentinelas\.texto\.join\('\\n'\) \+ '\\n'\);$/m,
    'o terminal não imprime as sentinelas');
  assert.match(semCom, /^\s+\+ \(l\.alertas\.length \? `  alertas=\$\{l\.alertas\.join\(','\)\}` : ''\)\);$/m,
    'a linha impressa de cada momento não diz o alerta dele');
});

// O CORPO que a ferramenta mandaria, lido da própria saída dela: ela imprime o
// corpo (com o token mascarado) ANTES do jitter e da rede. O processo é morto
// assim que a linha aparece — nada sai pra rede, e o teste não espera o jitter.
async function corpoQueSairia(dados, rota, extra) {
  const { spawn } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'diag-api-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, JSON.stringify(dados));
  const filho = spawn(process.execPath, [join(ROOT, 'tools/diag-api.mjs'), arq, rota, ...(extra ? [extra] : [])],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  try {
    return await new Promise((ok, erro) => {
      const teto = setTimeout(() => erro(new Error('a ferramenta não imprimiu o corpo: ' + saida.slice(0, 300))), 10000);
      filho.stdout.on('data', (b) => {
        saida += b;
        const m = /^corpo: (.+)$/m.exec(saida);
        if (m) { clearTimeout(teto); ok(JSON.parse(m[1])); }
      });
      filho.once('exit', () => { clearTimeout(teto); erro(new Error('a ferramenta saiu antes do corpo: ' + saida.slice(0, 300))); });
    });
  } finally {
    filho.kill('SIGKILL');
  }
}

test('diag-api: pergunta na REGIÃO e no PAÍS do relatório, não nos de fábrica', async () => {
  // O corpo cravava `region: 'row'` e nenhum país: a fila de quem tria nos EUA
  // (servidor `na`) ou na França era perguntada ao servidor do resto do mundo e
  // no país padrão — a resposta "vazia" parecia o defeito que se investigava.
  const base = { app: { url: 'https://exemplo.invalido/' } };
  const deNa = await corpoQueSairia({ ...base, localStorage: { waze_session_token: 'tok-nao-impresso',
    waze_region: 'na', waze_country: '235' } }, 'buscar-places');
  assert.equal(deNa.region, 'na', 'a região do relatório não chegou ao corpo');
  assert.equal(deNa.countryId, 235, 'o país do relatório não chegou ao corpo');
  assert.equal(deNa.sessionToken, '<TOKEN>', 'o corpo impresso tem que mascarar o token');
  // O `json-extra` continua mandando: é assim que se pergunta OUTRO país.
  const outro = await corpoQueSairia({ ...base, localStorage: { waze_session_token: 'tok', waze_region: 'na', waze_country: '235' } },
    'lista-estados', '{"countryId":73}');
  assert.equal(outro.countryId, 73, 'o json-extra deixou de trocar o país');
  // CONTROLE: relatório sem região nem país cai no padrão do app (ROW, sem país).
  const semNada = await corpoQueSairia({ ...base, localStorage: { waze_session_token: 'tok' } }, 'buscar-places');
  assert.equal(semNada.region, 'row');
  assert.ok(!('countryId' in semNada), 'sem país no relatório, a ferramenta inventou um');
});

// ── diag-replay: a tela que ele reconstrói é a do aparelho (auditoria de 2026-09-26) ──
// Três coisas saíam diferentes do que a pessoa via: o tema (só o GUARDADO era
// lido — quem segue o sistema escuro remontava claro, e o init ainda gravava
// "light"), o cabeçalho (sem perfil, Filtros e Atualizar) e a sessão (logada
// SEM token, o que fazia a sentinela `tokenNaoPersiste` acusar um defeito que o
// aparelho não tinha). A tela inteira é medida no `tools/smoke-diag-tela.mjs`.
const temaDoRelatorio = (() => {
  const ini = REPLAY.indexOf('\nfunction temaDoRelatorio(d) {');
  assert.ok(ini > 0, 'temaDoRelatorio sumiu do diag-replay');
  let prof = 0, fim = -1;
  for (let k = REPLAY.indexOf('{', ini); k < REPLAY.length; k++) {
    if (REPLAY[k] === '{') prof++;
    else if (REPLAY[k] === '}' && --prof === 0) { fim = k + 1; break; }
  }
  return new Function(REPLAY.slice(ini, fim) + '\nreturn temaDoRelatorio;')();
})();

test('diag-replay: o TEMA é o da tela do aparelho — a escolha guardada, senão o que a tela mostrava, senão o sistema', () => {
  // O caso do relato: nada guardado, sistema escuro, tela escura.
  const doSistema = temaDoRelatorio({ localStorage: {}, ambiente: { escuro: true },
    computado: { tema: { htmlClasse: 'dark tem-sessao', guardado: null } } });
  assert.equal(doSistema.escuro, true, 'quem segue o sistema escuro remontou claro');
  assert.equal(doSistema.guardado, null, 'o replay inventou uma escolha que a pessoa não fez (e o app pararia de seguir o sistema)');
  // Relatório sem a camada computada (anterior ao v3): o sistema do aparelho decide.
  assert.equal(temaDoRelatorio({ localStorage: {}, ambiente: { escuro: true } }).escuro, true);
  // A escolha GUARDADA vence o sistema (quem escolheu claro num sistema escuro).
  const escolhido = temaDoRelatorio({ localStorage: { waze_places_theme: 'light' }, ambiente: { escuro: true },
    computado: { tema: { htmlClasse: '' } } });
  assert.deepEqual([escolhido.escuro, escolhido.guardado, escolhido.sistema], [false, 'light', true]);
  // `dark` é classe, não substring: `tema-dark-algo` não é o tema escuro.
  assert.equal(temaDoRelatorio({ localStorage: {}, computado: { tema: { htmlClasse: 'nao-dark-x' } } }).escuro, false);
  // CONTROLE: sistema claro e nada guardado → claro.
  assert.equal(temaDoRelatorio({ localStorage: {}, ambiente: { escuro: false }, computado: { tema: { htmlClasse: 'tem-sessao' } } }).escuro, false);
});

test('diag-replay: grava tema SÓ se a pessoa escolheu, monta o cabeçalho e dá à sessão um token fictício — sem rede', () => {
  // Comentário tirado por LINHA, e não com o `semComentarios` de cima: o glob
  // `'**/api/**'` tem um `/*` que o removedor de bloco lê como comentário e
  // come o código até o próximo `*/` (gotcha #67.1).
  const codigo = REPLAY.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(codigo, /if \(temaGuardado\) localStorage\.setItem\('waze_places_theme', temaGuardado\);/,
    'o replay voltou a gravar um tema que a pessoa não escolheu');
  assert.doesNotMatch(codigo, /escuro \? 'dark' : 'light'\]\);/, 'o init voltou a receber "light" quando nada estava guardado');
  assert.match(codigo, /showMainScreen\(\);\s*\n\s*renderProfileHeader\(\);/, 'o replay deixou de montar o cabeçalho (perfil, Filtros, Atualizar)');
  assert.match(codigo, /localStorage\.setItem\('waze_session_token', '[^']+'\)/, 'sem token, a sentinela `tokenNaoPersiste` acusa um defeito do replay');
  // O token é gravado DEPOIS da carga: no init, o app tentaria entrar com ele.
  const iInit = codigo.indexOf('addInitScript');
  const iFim = codigo.indexOf('});', iInit);
  assert.ok(!codigo.slice(iInit, iFim).includes('waze_session_token'), 'o token fictício entrou ANTES da carga');
  assert.match(codigo, /ctx\.route\('\*\*\/api\/\*\*', \(r\) => r\.abort\(/, 'com sessão fictícia, a API tem que estar cortada por construção');
  // E a espera é pelo lado do Node (o poller do `waitForFunction` avalia string e a CSP o barra).
  assert.doesNotMatch(codigo, /\.waitForFunction\(/, 'o replay voltou a usar waitForFunction');
});

// ── diag-replay: o PLACAR é o do aparelho (auditoria de 2026-09-29, T3) ──────
// A remontagem mostrava 0 · 0 · 0 e o tamanho do recorte injetado onde o
// aparelho tinha 801 · 905 · 18 · 20+ — e o "Restam" é o número que um relato de
// "a fila acabou" discute. A tela inteira é medida no `tools/smoke-diag-tela.mjs`.
const placarDoRelatorio = (() => {
  const ini = REPLAY.indexOf('\nfunction placarDoRelatorio(st, naFila) {');
  assert.ok(ini > 0, 'placarDoRelatorio sumiu do diag-replay');
  let prof = 0, fim = -1;
  for (let k = REPLAY.indexOf('{', ini); k < REPLAY.length; k++) {
    if (REPLAY[k] === '{') prof++;
    else if (REPLAY[k] === '}' && --prof === 0) { fim = k + 1; break; }
  }
  return new Function(REPLAY.slice(ini, fim) + '\nreturn placarDoRelatorio;')();
})();

test('diag-replay: o placar vem do relatório — Lidos, Rejeitados, Pulados e o "Restam" com o "+"', () => {
  const cheio = placarDoRelatorio({ stats: { read: 801, rejected: 905, skipped: 18 }, serverTotal: 311, hasMore: true }, 20);
  assert.deepEqual(cheio, { stats: { read: 801, rejected: 905, skipped: 18 }, serverTotal: 311, hasMore: true },
    'o placar do aparelho não chegou à remontagem');
  // Relatório sem os campos (antigo, ou montado à mão): como era — zerado, e o
  // "Restam" do tamanho da fila injetada, sem "+".
  assert.deepEqual(placarDoRelatorio({}, 20), { stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 20, hasMore: false });
  assert.deepEqual(placarDoRelatorio(null, 3), { stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, hasMore: false });
  // "Restam 0" do aparelho é 0, não o tamanho do recorte; lixo não vira número.
  assert.equal(placarDoRelatorio({ serverTotal: 0 }, 20).serverTotal, 0);
  assert.deepEqual(placarDoRelatorio({ stats: { read: '12', rejected: -3, skipped: 'x' }, hasMore: 'sim' }, 1),
    { stats: { read: 12, rejected: 0, skipped: 0 }, serverTotal: 1, hasMore: false });
  // E ele é o que entra na página: nada de recontar pelo recorte.
  const codigo = REPLAY.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(codigo, /placarDoRelatorio\(st, recorte\.length\)\]\);/, 'o placar do relatório não é passado pra página');
  assert.match(codigo, /AppState\.stats = placar\.stats;\s*\n\s*AppState\.serverTotal = placar\.serverTotal;\s*\n\s*AppState\.hasMore = placar\.hasMore;/,
    'a página não recebe o placar do relatório');
  assert.doesNotMatch(codigo, /AppState\.serverTotal = places\.length;/, 'o "Restam" voltou a ser o tamanho do recorte');
  assert.match(codigo, /updateStats\(true\);/, 'o placar não é redesenhado depois de restaurado');
});

// ── diag-replay: o relatório feito DENTRO do treino (auditoria da rodada 9, R9-4-08) ──
// Com o treino aberto, o `appState.queue` são os EXEMPLOS (os clones inertes e os
// sintéticos). A remontagem os injetava como a fila, sem a faixa do treino e sem
// dizer nada: com 40 pedidos reais, 30 exemplos na tela e "restam 40" (MEDIDO no
// navegador, n3). A fila real está no arquivo desde o v11 (`treino.fila`, com o
// `currentPlaceIdx` dela).
const filaDoRelatorio = (() => {
  const ini = REPLAY.indexOf('\nfunction filaDoRelatorio(d) {');
  assert.ok(ini > 0, 'filaDoRelatorio sumiu do diag-replay');
  let prof = 0, fim = -1;
  for (let k = REPLAY.indexOf('{', ini); k < REPLAY.length; k++) {
    if (REPLAY[k] === '{') prof++;
    else if (REPLAY[k] === '}' && --prof === 0) { fim = k + 1; break; }
  }
  return new Function(REPLAY.slice(ini, fim) + '\nreturn filaDoRelatorio;')();
})();

test('diag-replay: relatório feito DENTRO do treino — remonta a fila REAL que o treino guardava, e diz isso (R9-4-08)', () => {
  const exemplos = Array.from({ length: 30 }, (_, i) => ({ venueID: 'v' + i, updateRequestID: 'treino-inerte', _treino: true }));
  const reais = Array.from({ length: 40 }, (_, i) => ({ venueID: 'r' + i, updateRequestID: 'u' + i }));
  const d = { appState: { queue: exemplos, currentPlaceIdx: 0, serverTotal: 40 },
    treino: { ativo: true, passo: 1, exemplos: 30, fila: reais, currentPlaceIdx: 2 } };
  const f = filaDoRelatorio(d);
  assert.equal(f.doTreino, true, 'o relatório feito no treino não foi reconhecido');
  assert.deepEqual(f.fila.map((p) => p.updateRequestID), reais.map((p) => p.updateRequestID),
    'a remontagem injetou os EXEMPLOS do treino como se fossem a fila');
  assert.equal(f.idx, 2, 'o pedido da frente da fila real (o `currentPlaceIdx` dela) se perdeu');
  assert.equal(f.exemplos, 30);
  // CONTROLE: fora do treino, a fila do `appState`, e o remendo do formato antigo
  // ("[circular]" no lugar do card da frente) segue valendo.
  const fora = filaDoRelatorio({ appState: { queue: ['[circular]', reais[1]], currentPlace: reais[0], currentPlaceIdx: 1 },
    treino: { ativo: false } });
  assert.deepEqual([fora.doTreino, fora.idx, fora.fila.map((p) => p.updateRequestID)], [false, 1, ['u0', 'u1']]);
  // Relatório anterior ao v11 (sem `treino`) e o treino aberto SEM a fila no arquivo: a do `appState`.
  assert.equal(filaDoRelatorio({ appState: { queue: exemplos } }).doTreino, false);
  assert.equal(filaDoRelatorio({ appState: { queue: exemplos }, treino: { ativo: true } }).fila.length, 30);
  // Índice fora da fila real: a frente é a primeira.
  assert.equal(filaDoRelatorio({ appState: {}, treino: { ativo: true, fila: reais, currentPlaceIdx: 99 } }).idx, 0);
  // E é ela que a ferramenta usa — avisando que o relatório é de dentro do treino.
  const codigo = REPLAY.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(codigo, /const \{ fila, idx, doTreino, exemplos \} = filaDoRelatorio\(d\);/, 'a remontagem não usa a fila do relatório pela régua do treino');
  assert.match(codigo, /if \(doTreino\) \{\s*console\.log\(`AVISO:/, 'a remontagem do treino não avisa que trocou os exemplos pela fila real');
  assert.doesNotMatch(codigo, /^const fila = \(st\.queue/m, 'a fila voltou a sair só do `appState`');
});

// ── diag-replay: o que ESPERA o "Sair" do treino (auditoria da rodada 10, R10-4-08) ──
// Relatório feito no treino com a fila guardada do offline lida nele: a fila real
// que o treino guardava está VAZIA, e a remontagem mostrava "fila: 0" e o painel
// vazio sem dizer que 4 pedidos abrem no "Sair" (o `diag-resumo` do mesmo arquivo
// diz; MEDIDO no relatório do n2 da auditoria). O mesmo com a fila que o perfil
// mandou refazer: a remontada não é a que volta.
const filaQueVoltaDoTreino = (() => {
  const ini = REPLAY.indexOf('\nfunction filaQueVoltaDoTreino(d) {');
  assert.ok(ini > 0, 'filaQueVoltaDoTreino sumiu do diag-replay');
  let prof = 0, fim = -1;
  for (let k = REPLAY.indexOf('{', ini); k < REPLAY.length; k++) {
    if (REPLAY[k] === '{') prof++;
    else if (REPLAY[k] === '}' && --prof === 0) { fim = k + 1; break; }
  }
  return new Function(REPLAY.slice(ini, fim) + '\nreturn filaQueVoltaDoTreino;')();
})();

test('diag-replay: no treino, a fila guardada do offline que abre no "Sair" e a fila que o perfil manda refazer são DITAS (R10-4-08)', () => {
  const reais = Array.from({ length: 3 }, (_, i) => ({ venueID: 'r' + i, updateRequestID: 'u' + i }));
  const treino = (extra) => ({ appState: { queue: [] }, treino: { ativo: true, passo: 1, exemplos: 30, fila: [], ...extra } });
  // O caso do relatório: a fila real vazia, e 4 pedidos da guardada esperando o "Sair".
  const guardada = filaQueVoltaDoTreino(treino({ abrirGuardada: true, filaGuardadaLida: { n: 4, t: 1 } }));
  assert.equal(guardada.length, 1, 'a remontagem não diz nada sobre a fila guardada que abre no "Sair"');
  assert.match(guardada[0], /^4 pedido\(s\) da fila guardada do offline abre\(m\) no "Sair" do treino/,
    'a remontagem não diz QUANTOS pedidos da fila guardada abrem no "Sair"');
  // Sem a contagem (o `n` ilegível), diz a fila sem o número — nunca "NaN pedidos".
  assert.match(filaQueVoltaDoTreino(treino({ abrirGuardada: true, filaGuardadaLida: { n: 'x' } }))[0],
    /^a fila guardada do offline abre\(m\)/);
  // A fila real com pedidos: a guardada não abre no "Sair" (a do `Treino.sair()` vence).
  assert.match(filaQueVoltaDoTreino(treino({ fila: reais, abrirGuardada: true, filaGuardadaLida: { n: 4 } }))[0],
    /só abre\(m\) com a fila real vazia — e ela tem 3 pedido\(s\)/);
  // A fila que o perfil mandou refazer VENCE (o `sair()` a busca de novo, e a guardada não abre).
  const refeita = filaQueVoltaDoTreino(treino({ fila: reais, refazerFila: true, abrirGuardada: true, filaGuardadaLida: { n: 4 } }));
  assert.equal(refeita.length, 1);
  assert.match(refeita[0], /REFAZER a fila real: no "Sair" ela é buscada de novo/, 'a remontagem não diz que a fila refeita não é a remontada');
  // CONTROLE: o treino sem nada esperando, o treino fechado e o relatório sem o
  // treino não ganham aviso nenhum.
  assert.deepEqual(filaQueVoltaDoTreino(treino({ fila: reais })), []);
  assert.deepEqual(filaQueVoltaDoTreino({ treino: { ativo: false, abrirGuardada: true } }), []);
  assert.deepEqual(filaQueVoltaDoTreino({ appState: { queue: reais } }), []);
  assert.deepEqual(filaQueVoltaDoTreino({ treino: { ativo: true, abrirGuardada: true } }), [], 'o relatório sem a fila real no arquivo (antes do v11) inventou aviso');
  // E a ferramenta imprime cada linha como AVISO.
  const codigo = REPLAY.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(codigo, /^for \(const linha of filaQueVoltaDoTreino\(d\)\) console\.log\(`AVISO: {3}\$\{linha\}`\);$/m,
    'a ferramenta não imprime o que espera o "Sair" do treino');
});
