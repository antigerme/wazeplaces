// O anel de chamadas do `js/api.js`, que é o que o diagnóstico carrega.
//
// Ele existe porque a pergunta que mais custou tempo neste projeto foi "o que
// exatamente falhou no aparelho dele?", e o toast conta só o desfecho. O teste
// FATIA a fonte e executa — o módulo é script de browser, e reimplementar aqui
// mediria uma cópia que envelhece.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');

// Monta um `API` de mentira com só o pedaço que interessa, e uma `fetch`
// controlada. `devAtivo` liga o `AppState.devMode.active` que o `_guardaCorpo` lê.
function montar({ status = 200, corpo = '{"success":true}', cab = {}, lanca = null, devAtivo = false } = {}) {
  const i = fonte.indexOf('    chamadas: [],');
  const j = fonte.indexOf('    },', fonte.indexOf('async _post')) + 6;
  assert.ok(i !== -1 && j > i, 'o corte do api.js precisa ser revisto — âncoras sumiram');
  const trecho = fonte.slice(i, j);

  const escopo = {
    t: () => 'erro de conexão',
    AppState: { devMode: { unlocked: true, active: devAtivo } },
    performance: { now: () => 0 },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: (f) => 0, clearTimeout: () => {},
    console: { error: () => {} },
    fetch: async () => {
      if (lanca) throw lanca;
      return { status, headers: { get: (h) => cab[h] || null }, text: async () => corpo };
    },
  };
  const nomes = Object.keys(escopo);
  const api = new Function(...nomes, 'return { baseUrl: "/api", saindo: false,\n' + trecho + '\n};')(
    ...nomes.map((n) => escopo[n]));
  return api;
}

// ═══ o buraco que valia horas ════════════════════════════════════════════════
test('corpo que NÃO é JSON preserva o status real — não vira "sem rede"', async () => {
  // A app roda atrás do Bot Fight Mode da Cloudflare. Desafio do WAF, 502 da
  // borda e página de erro do gateway devolvem HTML: o `.json()` lança, e antes
  // do conserto o `catch` registrava `http: 0` — indistinguível de rede caída.
  // "A Cloudflare barrou o aparelho" e "o wifi piscou" ficavam idênticos.
  const api = montar({ status: 403, corpo: '<!DOCTYPE html>Attention Required! | Cloudflare',
                       cab: { 'cf-ray': '9abc-GRU', 'content-type': 'text/html' } });
  await api._post('buscar-places', { sessionToken: 'x' });
  const c = api.chamadas[0];
  assert.equal(c.http, 403, 'o status REAL se perdeu — é o defeito de volta');
  assert.match(c.naoEraJson, /Cloudflare/, 'sem o começo do corpo não dá pra reconhecer o WAF');
  assert.equal(c.cab['cf-ray'], '9abc-GRU', 'o cf-ray diz qual execução respondeu');
  // E não pode registrar DUAS vezes: o `catch` corre depois do `finally`, e um
  // segundo registro sobrescreveria o status por 0, desfazendo o conserto.
  assert.equal(api.chamadas.length, 1, 'a mesma chamada foi registrada duas vezes');
});

test('falha ANTES de existir resposta continua sendo http 0', async () => {
  // O contraste do teste acima: rede caída/DNS/timeout não têm status, e
  // inventar um esconderia justamente a diferença que o outro teste protege.
  const api = montar({ lanca: Object.assign(new Error('failed'), { name: 'TypeError' }) });
  await api._post('perfil', { sessionToken: 'x' });
  assert.equal(api.chamadas[0].http, 0);
  assert.equal(api.chamadas[0].errorCategory, 'transient');
});

// ═══ o token ═════════════════════════════════════════════════════════════════
test('o corpo da requisição vai SEM o token, sempre', async () => {
  // O token vai em toda chamada. Ele já está no arquivo uma vez (localStorage),
  // que é onde deve estar: repetir 60 vezes não acrescenta segredo, só
  // multiplica a chance de escapar num recorte de tela ou num trecho colado.
  const api = montar({ devAtivo: true });
  await api._post('buscar-places', { sessionToken: 'SEGREDO', cookies: 'CHAVEIRO', countryId: 30 });
  const tudo = JSON.stringify(api.chamadas);
  assert.ok(!tudo.includes('SEGREDO'), 'o token vazou pro corpo da requisição');
  assert.ok(!tudo.includes('CHAVEIRO'), 'os cookies do login vazaram');
  // …e o resto continua lá: redigir sem manter o útil não serve pra depurar.
  assert.equal(api.chamadas[0].corpoReq.countryId, 30, 'o filtro enviado sumiu junto com o token');
});

// ═══ corpo da resposta ═══════════════════════════════════════════════════════
test('corpo da resposta só é guardado com o modo dev ATIVO', async () => {
  // As DUAS metades. Só a primeira passaria com o corpo preso em "nunca"; só a
  // segunda passaria com ele preso em "sempre" — que é a versão que põe a fila
  // inteira (com nome de quem enviou cada pedido) na memória de todo mundo.
  const desligado = montar({ corpo: '{"success":true,"places":[1,2,3]}', devAtivo: false });
  await desligado._post('buscar-places', {});
  assert.equal(desligado.chamadas[0].corpoResposta, undefined, 'guardou corpo com o dev DESLIGADO');
  assert.equal(desligado.chamadas[0].n, 3, 'a CONTAGEM tem que vir sempre — é ela que distingue "respondeu vazio" de "respondeu cheio"');

  const ligado = montar({ corpo: '{"success":true,"places":[1,2,3]}', devAtivo: true });
  await ligado._post('buscar-places', {});
  assert.match(ligado.chamadas[0].corpoResposta, /places/, 'não guardou corpo com o dev LIGADO');
});

test('o teto de corpos poda os mais ANTIGOS e preserva o registro', async () => {
  // Sem teto, `buscar-places` (326 KB medidos na produção) × várias chamadas
  // vira dezenas de MB na memória de um celular e um arquivo que ninguém manda.
  const grande = '{"success":true,"x":"' + 'a'.repeat(1024 * 1024) + '"}';
  const api = montar({ corpo: grande, devAtivo: true });
  for (let i = 0; i < 6; i++) await api._post('buscar-places', {});
  const comCorpo = api.chamadas.filter((c) => c.corpoResposta);
  const total = comCorpo.reduce((a, c) => a + c.corpoResposta.length, 0);
  assert.ok(total <= api._TETO_CORPOS, `os corpos somaram ${total}, acima do teto ${api._TETO_CORPOS}`);
  assert.ok(comCorpo.length < 6, 'nada foi podado — o teto não está agindo');
  // O REGISTRO fica: perder a sequência pra caber o conteúdo seria trocar o
  // essencial pelo detalhe.
  assert.equal(api.chamadas.length, 6, 'a poda levou o registro junto com o corpo');
  assert.ok(api.chamadas.some((c) => c.corpoPodado), 'a poda tem que ficar VISÍVEL, senão parece que nunca houve corpo');
  // E poda do mais ANTIGO: o recente é o que interessa quando algo acabou de
  // falhar.
  assert.ok(api.chamadas[api.chamadas.length - 1].corpoResposta, 'a poda comeu o corpo mais RECENTE');
});

test('o anel para em 60 e nunca cresce sem fim', async () => {
  const api = montar();
  for (let i = 0; i < 70; i++) await api._post('perfil', {});
  assert.equal(api.chamadas.length, 60);
});

// ═══ o `_guardaCorpo` e o gotcha #64 ═════════════════════════════════════════
test('a leitura do modo dev NÃO passa por `window.` (gotcha #64)', () => {
  // `AppState` é `const` no escopo global de um script clássico: binding
  // LÉXICO, não propriedade de `window`. Escrito como `window.AppState`, isto
  // devolvia `false` SEMPRE e o corpo nunca era guardado — falha silenciosa que
  // só apareceu porque o teste exigia o corpo PRESENTE, não só ausente.
  // Sem comentários: o próprio comentário do conserto CITA `window.AppState`
  // pra explicar o que não fazer, e o guard reprovava o texto que o documenta.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('_guardaCorpo()');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('},', i));
  assert.ok(!/window\.AppState/.test(bloco),
    'voltou a ler `window.AppState` — em script clássico isso é sempre undefined');
  assert.match(bloco, /typeof AppState/, 'a leitura precisa ser pelo binding global, com guarda de existência');
});

// ═══ o diário e o FAB ════════════════════════════════════════════════════════
import { readFileSync as _rf } from 'node:fs';
const APP = _rf(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = _rf(new URL('../index.html', import.meta.url), 'utf8');
const semCom = APP.replace(/\/\/[^\n]*/g, '');

test('o diário sai na PRIMEIRA linha quando o dev está desligado', () => {
  // Custo zero desligado não é detalhe: são 200 swipes por sessão e o valor da
  // app é o ritmo. Nada de closure, objeto ou stringify antes da checagem.
  const i = semCom.indexOf('function dlog(');
  const corpo = semCom.slice(i, semCom.indexOf('\n}', i));
  const primeira = corpo.split('\n').filter((l) => l.trim())[1] || '';
  assert.match(primeira, /if \(!dlogLigado\(\)\) return;/,
    'a saída antecipada saiu da primeira linha — o diário passou a custar com o dev desligado');
});

test('o diário chaveia pedido por creatorId, NUNCA pelo nome', () => {
  // Mesma regra da reincidência: o nome é de terceiro e muda; o id resolve a
  // mesma pergunta e não muda.
  const i = semCom.indexOf('function dlogPlace(');
  const corpo = semCom.slice(i, semCom.indexOf('\n}', i));
  assert.ok(!/createdBy/.test(corpo), 'o nome de quem enviou o pedido entrou no diário');
  assert.match(corpo, /creatorId/, 'o id sumiu — sem ele o diário não identifica autor nenhum');
});

test('os FUNIS existem — cobertura por estrangulamento, não remendo', () => {
  // Instrumentar call site a call site envelhece: o próximo recurso nasce sem
  // log e ninguém percebe. Cada linha abaixo é um funil por onde TUDO passa.
  const funis = [
    [/function showToast[\s\S]{0,600}?dlog\('toast'/, 'toast — é o "print textual", e foi o que faltou no diagnóstico do owner'],
    [/function openModal\(id\) \{\s*dlog\('tela\.modal'/, 'abertura de modal'],
    [/function closeModal\([^)]*\) \{\s*dlog\('tela\.modal'/, 'fechamento de modal'],
    [/function showNoPlaces\(\) \{[\s\S]{0,400}?dlog\('tela\.vazia'/, 'painel de fila vazia'],
    [/function scheduleAction\([^)]*\) \{\s*dlog\('acao'/, 'ação do editor'],
    [/function handleActionResult\([^)]*\) \{\s*dlog\('acao\.fim'/, 'resultado da ação'],
    [/dlog\('sessao\.confere'/, 'decisão de vida/morte da sessão'],
    [/dlog\('busca\.ok'/, 'busca que deu certo'],
    [/dlog\('busca\.falhou'/, 'busca que falhou'],
    [/dlogVigiar\('buscar'\)/, 'watchdog da busca — fila congelada não grita'],
  ];
  for (const [re, oq] of funis) assert.match(semCom, re, `funil sumiu: ${oq}`);
});

test('desligar o dev APAGA o que ele gravou', () => {
  // Senão "desligado" é mentira: o dado (DOM com nome e endereço de terceiro)
  // continua no aparelho.
  const i = semCom.indexOf('function dlogApagar(');
  const corpo = semCom.slice(i, semCom.indexOf('\n}', i));
  assert.match(corpo, /dlogAnel = \[\]/, 'o diário sobreviveu ao desligar');
  assert.match(corpo, /dlogMomentos = \[\]/, 'os momentos sobreviveram — é onde mora o DOM com dado de terceiro');
  assert.match(corpo, /delete c\.corpoResposta/, 'os corpos de resposta guardados sobreviveram');
  // O anel de METADADOS fica: não tem dado pessoal e é a espinha do diagnóstico.
  assert.ok(!/API\.chamadas = \[\]/.test(corpo), 'apagou os metadados junto — perdeu a sequência sem precisar');
  // E o desligar avisa antes de levar captura não baixada embora.
  assert.match(semCom, /dlogNaoBaixados\(\) > 0[\s\S]{0,200}?toast\.devPerdeCaptura/,
    'desligar pode perder captura não baixada sem avisar');
});

test('o FAB fica acima dos modais e abaixo do toast', () => {
  // Acima dos modais porque o ponto é capturar EM CONTEXTO — o botão antigo,
  // dentro de Filtros, só conseguia capturar a tela de Filtros. Abaixo do toast
  // (70) porque tapar o aviso que se quer registrar é o mesmo erro ao contrário
  // — e MEDIDO, o toast em cima dele engolia o toque seguinte.
  const i = HTML.indexOf('id="devFab"');
  const bloco = HTML.slice(i - 200, i + 300);
  assert.match(bloco, /z-\[68\]/, 'o FAB saiu da faixa entre os modais (60) e o toast (70)');
  assert.match(bloco, /pointer-events-none/, 'o contêiner do FAB recebe toque e engole o gesto do card (gotcha #26)');
  assert.match(HTML, /id="devFabBtn"[^>]*pointer-events-auto/, 'o botão parou de receber toque');
  assert.match(HTML, /id="devFabBtn"[^>]*min-w-\[44px\][^>]*min-h-\[44px\]/, 'o alvo caiu abaixo de 44px');
});

test('a captura NÃO dispara toast — o instrumento não pode medir a si mesmo', () => {
  // MEDIDO: o toast vive acima do FAB e engolia o toque seguinte (dois toques
  // registravam um momento só), além de entrar na captura seguinte.
  // Ancorado DENTRO do `ligarFabDev`: existe outro `const soltar` no lightbox, e
  // um `indexOf` solto pegava o dele (gotcha #67 — âncora que alcança outra
  // ocorrência do mesmo nome deixa a sabotagem passar).
  const iF = semCom.indexOf('function ligarFabDev(');
  assert.ok(iF !== -1, 'ligarFabDev sumiu');
  const fab = semCom.slice(iF, semCom.indexOf('\nfunction ', iF + 10));
  const i = fab.indexOf('const soltar = ');
  const corpo = fab.slice(i, fab.indexOf('};', i));
  assert.match(corpo, /dlogCapturar\('manual'\)/, 'o toque parou de registrar');
  assert.ok(!/showToast/.test(corpo), 'voltou o toast na captura — ele bloqueia o toque seguinte');
});

test('a tela é lida pelo que decide o PIXEL, não por offsetParent', () => {
  // `offsetParent` é null para `position: fixed`, e TODO modal desta app é
  // fixed — com ele, `modais` vinha sempre vazio e o FAB não capturava o
  // contexto, em silêncio.
  const i = semCom.indexOf('function dlogTelaAtual(');
  const corpo = semCom.slice(i, semCom.indexOf('\n}', i));
  assert.ok(!/offsetParent/.test(corpo),
    'voltou o offsetParent — modal fixed volta a ser invisível pro diário');
  assert.match(corpo, /getComputedStyle/, 'a leitura precisa olhar o display computado');
});

// ── Onde o FAB nasce, e se dá pra tirá-lo de lá ───────────────────────────
//
// Os dois defeitos vieram do aparelho do owner. `tools/smoke-browser.mjs` os
// mede no PIXEL, com toque de verdade — é lá que a geometria se prova. Aqui
// ficam só as condições que dá pra travar sem browser, e que, se caírem,
// derrubam o smoke inteiro sem ele saber por quê.

test('o botão do FAB tem touch-action: none — sem isso o arrasto morre em 15px', () => {
    // MEDIDO em 3 celulares antes do conserto: dos 20 movimentos de dedo
    // despachados chegava UM, seguido de `pointercancel`. Com `touch-action`
    // em `auto` o navegador reivindica o gesto como rolagem e cancela o
    // ponteiro; o botão andava 10–17px e morria. É o `touch-none` que faz o
    // arrasto existir — nenhuma linha de JS substitui.
    assert.match(HTML, /id="devFabBtn"[^>]*\btouch-none\b/,
        'sumiu o touch-none do #devFabBtn: o navegador volta a cancelar o arrasto');
});

test('o FAB é excluído da PRÓPRIA medição de canto', () => {
    // `pointer-events: none` no contêiner NÃO tira o botão do hit-test, porque
    // ele traz `pointer-events-auto`. Sem esta exclusão o FAB media a si mesmo,
    // achava ocupado o canto onde já estava e FUGIA dele a cada troca de
    // camada — o botão ficava saltando entre os dois cantos de cima.
    const i = semCom.indexOf('function devFabVitimas(');
    assert.ok(i !== -1, 'devFabVitimas sumiu');
    const corpo = semCom.slice(i, semCom.indexOf('\n}', i));
    assert.match(corpo, /!fab\.contains\(alvo\)/,
        'o FAB voltou a contar como obstáculo de si mesmo');
    const j = semCom.indexOf('function posicionarFabDev(');
    const pos = semCom.slice(j, semCom.indexOf('\n}\n', j));
    assert.match(pos, /devFabBtn[\s\S]*?pointerEvents = 'none'/,
        'o BOTÃO precisa sair do hit-test junto com o contêiner');
    assert.match(pos, /if \(!fab \|\| devFabFixado/,
        'a posição escolhida pelo editor tem que ganhar da automática');
});

test('arrastar fixa a posição no COMEÇO do gesto, não no fim', () => {
    // Com toque o navegador dá captura implícita ao elemento do `pointerdown`,
    // então o `pointerup` volta pro BOTÃO mesmo com o dedo do outro lado da
    // tela — e o ouvinte do botão corre ANTES do da window. Marcando só no
    // `fim`, arrastar registrava um momento que ninguém pediu, e o
    // `atualizarFabDev` desse momento devolvia o botão pro canto automático:
    // ele voltava sozinho pro lugar de onde tinha acabado de sair.
    const iF = semCom.indexOf('function ligarFabDev(');
    const fab = semCom.slice(iF, semCom.indexOf('\nfunction ', iF + 10));
    const i = fab.indexOf('const mover = ');
    assert.ok(i !== -1, 'o `mover` do arrasto sumiu');
    const mover = fab.slice(i, fab.indexOf('};', i));
    assert.match(mover, /arrastando = true; devFabFixado = true; foiSegurar = true;/,
        'as três marcas do arrasto precisam cair juntas no início do gesto');
    // e o cancelamento desmonta igual ao soltar, senão sobra ouvinte na window
    assert.match(fab, /removeEventListener\('pointercancel', fim\)/,
        'o `fim` não solta o pointercancel — gesto cancelado deixa ouvinte pra sempre');
    assert.match(fab, /addEventListener\('pointercancel', fim\)/,
        'o pointercancel não desmonta o arrasto');
});

test('todo id de camada vigiada pelo FAB existe no index.html', () => {
    // `filter(Boolean)` come id errado SEM DIZER NADA, e comeu: eu tinha
    // escrito `lightbox` e o elemento se chama `imageLightbox`, então o
    // lightbox de foto simplesmente não era vigiado — o FAB não reavaliava o
    // canto ao abrir a foto, e nada acusava.
    const i = semCom.indexOf('const DEV_FAB_CAMADAS = [');
    assert.ok(i !== -1, 'DEV_FAB_CAMADAS sumiu');
    const lista = semCom.slice(i, semCom.indexOf(']', i));
    const ids = [...lista.matchAll(/'([A-Za-z][\w-]*)'/g)].map((m) => m[1]);
    assert.ok(ids.length >= 4, 'a lista de camadas ficou curta demais: ' + ids.join(','));
    for (const id of ids) {
        assert.ok(HTML.includes(`id="${id}"`), `#${id} é vigiado mas não existe no index.html`);
    }
    assert.ok(lista.includes('...MODAL_IDS'), 'os modais saíram da lista de camadas vigiadas');
});

test('desligar o modo dev apaga também a posição fixada do FAB', () => {
    // "Apagar tudo do modo dev" inclui onde o editor deixou o botão — e é o
    // único caminho de volta pra quem arrastou pra um lugar ruim e quer o
    // automático de novo.
    const i = semCom.indexOf('function dlogApagar(');
    const corpo = semCom.slice(i, semCom.indexOf('\n}', i));
    assert.match(corpo, /devFabFixado = false/, 'a fixação sobrevive ao desligar');
    assert.match(corpo, /removeItem\('__devFabPos'\)/, 'a posição fica gravada depois do desligar');
});
