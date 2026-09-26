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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

test('diag-tela: procura a FONTE também nos recursos — o coletor a deixa fora do `codigo`', () => {
  // Desde v2026.09.10-04 o coletor pula a fonte (binário lido como texto não
  // serve), e o `diag-tela` só procurava no `codigo`: toda tela remontada saiu
  // com a fonte do sistema, sem aviso. MEDIDO no relatório real de 2026-09-24:
  // `fontesEmbutidas: []` com o leitor de antes, a Inter com o de hoje.
  assert.match(APP, /if \(\/\\\.\(woff2\?\|ttf\|/, 'o coletor voltou a guardar a fonte? então este guard mudou de sentido — releia');
  const TELA = readFileSync(join(ROOT, 'tools/diag-tela.mjs'), 'utf8');
  const semCom = TELA.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const laco = semCom.match(/for \(const u of ([\w.()]+)\) \{\s*\n\s*const m = \/\\\/fonts\\\//);
  assert.ok(laco, 'sumiu o laço que casa a fonte pelo nome');
  const def = new RegExp(`const ${laco[1].replace(/[.()]/g, '\\$&')} = ([\\s\\S]*?);\\n`).exec(semCom);
  assert.ok(def && /d\.recursos/.test(def[1]), `a busca da fonte itera \`${laco[1]}\`, que não inclui os recursos da página`);
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
  assert.match(TELA, /const momentos = \[\.\.\.anteriores, \.\.\.atuais\];/);
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
