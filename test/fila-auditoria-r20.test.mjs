// Lote 24, rodada 20 da auditoria — fila, contas, abas e teclado.
//
// R20-2-01  a recusa automática tira da fila, marca "em andamento" e captura sessão/geração/fila ANTES da
//           espera pela trava entre abas (= R20-1-01)
// R20-1-02  Enter/Espaço SEGURADO num botão não repete a ação (guarda geral; = R20-2-02, R20-3-03)
// R20-3-02  as marcas "no ar" das escritas da foto não atravessam o "Sair" (= R20-2-03)
// R20-1-03  o ✓ único da conta A no ar não tira o pedido da fila da B
// R20-7-02  o histórico guardado que não é um objeto não derruba o `recordHistory`
// (e o texto do `toast.loteNaoSaiu`, em test/fila-auditoria-r19.test.mjs)
//
// Os testes FATIAM o código de verdade do js/app.js (como os r14 a r19), ignoram comentário (gotcha #67) e,
// onde o defeito está na ORDEM de coisas que acontecem (a trava, o "Sair"), rodam as funções DE VERDADE —
// `aplicarRecusaAutomatica`, `enviarLote`, `callWithRetry` — contra uma trava de mentira que segura o
// `request`. O que só o navegador responde (a tecla segurada, a trava de verdade entre duas páginas) mora
// nos blocos do tools/smoke-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const semComentario = (txt) => txt.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const SEM = semComentario(APP);

function fatiar(nome, fonte = SEM) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) {
      const corpo = fonte.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = [\\s\\S]*?;\\n', 'm').exec(SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}

// O que o teste não fornece vira um "buraco negro" (o molde do test/fila-auditoria-r19.test.mjs).
function buracoNegro(nome, chamou) {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro(nome + '.' + k, chamou)),
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}
function montar(nomes, deps, extra = '') {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      return typeof k === 'string' ? buracoNegro(k, chamou) : undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = ['contagemDoHistorico', ...nomes].map((n) => fatiar(n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${extra}\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}
const tique = () => new Promise((ok) => setImmediate(ok));
async function ateQue(cond, msg, teto = 3000) {
  const fim = Date.now() + teto;
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a espera estourou: ' + msg);
    await tique();
  }
}
const chaveDe = new Function(fatiar('chaveDoPedido') + '\nreturn chaveDoPedido;')();
const P = (i, extra = {}) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 77, createdBy: 'spam', ...extra });

// ═══ R20-2-01 · a recusa automática e a trava entre abas ═══════════════════════════════════════════════
// A espera pela trava (`navigator.locks`, R19-2-02) vem DEPOIS de os alvos saírem da fila, mas o
// `marcarEmAndamento`, a época da sessão, a geração do "Sair" e a fila moravam dentro do `enviarLote`, que
// só começa quando a trava é concedida. Na espera os alvos não estavam em `pedidosEmAndamento` e nada
// conferia sessão/conta/fila depois: o "Sair" os devolvia à fila da tela de entrada; o login de OUTRA conta
// os rejeitava com a sessão dela; o ↻ os trazia de volta como card e eles saíam duas vezes.
//
// A trava de mentira SEGURA o `request` (uma 2ª "página" a tem) e SOLTA antes de resolver a promessa, como o
// navegador (gotcha #19: nada em laço sem teto).
function travaSegurada() {
  const filas = [];
  let tomada = false;
  const liberar = () => {
    tomada = false;
    const prox = filas.shift();
    if (prox) prox();
  };
  const trava = {
    // Como o navegador: `request(nome, [opcoes,] cb)`, e o `signal` tira o pedido da FILA (rejeita com AbortError)
    // enquanto ele espera — depois de concedida, abortar não faz nada (lote 25, R21-2-02/05).
    request(nome, opcoes, cb) {
      if (typeof opcoes === 'function') { cb = opcoes; opcoes = {}; }
      const signal = opcoes && opcoes.signal;
      return new Promise((resolve, reject) => {
        const tenta = () => {
          tomada = true;
          Promise.resolve().then(() => cb({ name: nome })).then((v) => { liberar(); resolve(v); }, (e) => { liberar(); reject(e); });
        };
        if (signal && signal.aborted) { reject(new DOMException('The operation was aborted.', 'AbortError')); return; }
        if (!tomada) { tenta(); return; }
        filas.push(tenta);
        if (signal) {
          signal.addEventListener('abort', () => {
            const i = filas.indexOf(tenta);
            if (i >= 0) { filas.splice(i, 1); reject(new DOMException('The operation was aborted.', 'AbortError')); }
          }, { once: true });
        }
      });
    },
  };
  // A "outra página" pega a trava e a segura até o teste soltar.
  let soltarDela;
  const dela = new Promise((ok) => { soltarDela = ok; });
  trava.request('wp-recusa-automatica', () => dela);
  return { trava, soltar: () => soltarDela() };
}

function recusaComTrava({ alvos = [P(1), P(2), P(3)], comTrava = true } = {}) {
  const t = comTrava ? travaSegurada() : null;
  const enviados = [];
  const devolvidos = [];
  const AppState = {
    queue: alvos.map((p) => ({ ...p })), currentPlace: null, fetchEpoch: 0, geracaoDoSair: 0, authenticated: true, inFlightActions: 0,
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 10, pendingAction: null,
  };
  const deps = {
    AppState, Treino: { ativo: false }, navigator: { locks: t ? t.trava : undefined, onLine: true },
    RECUSA_AUTOMATICA_TRAVA: 'wp-recusa-automatica', RECUSA_AUTOMATICA_ESPERA_MAX_MS: 180000, recusasEsperandoATrava: new Set(), epocaDaSessao: 1,
    podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true, autoLigado: (c) => c === 77,
    pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), rejeicoesDeLoteNoAr: new Set(), decididosPorOutraAbaComCardAqui: new WeakSet(),
    decididoNaOutraAbaDepoisDe: () => false,
    recusaAutomaticaRodando: false, recusaAutomaticaPedidaDeNovo: false, recusaAutomaticaNestaFila: false, avisoDaRecusaAutomatica: null,
    updatePendingCount() {}, aoMudarAFilaPorBaixo() {}, updateInFlightIndicator() {}, updateStats() {}, saveStats() {},
    API: { getRegion: () => 'row', rejectPlace: async (v, u) => { enviados.push(u); return { success: true }; } },
    carimboDoGesto: () => ({ dia: 'x', onde: '30' }), quemDecideAgora: () => ({ s: 'a', conta: '1' }),
    showToast: () => ({ texto() {}, dispensar() {} }), t: (k) => k, dfato() {}, filaReal: () => AppState.queue,
    registrarPouso() {}, recordHistory() {}, registrarRejeicaoDeAutor() {}, registrarAcaoConfirmada() {}, tirarDaFilaDeSaida() {},
    registrarPousoDepoisDaQueda() {}, descontarGestoSemSessao() {}, showCurrentPlace() {},
    devolverPedidoRecusado: (lista) => { devolvidos.push(...[].concat(lista).map((p) => p.updateRequestID)); },
    mostrarResultadoDoLote() {}, pousouPorOutraAba() {}, aprovacaoDelaJaPousou: () => false, handleUnauthorized() {},
    callWithRetryReal: true,
  };
  const h = montar(['aplicarRecusaAutomatica', 'enviarLote', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'callWithRetry', 'sessaoTrocou',
    'chaveDoPedido', 'pousouNoWaze'], deps);
  return { h, deps, AppState, enviados, devolvidos, trava: t };
}
// O que o "Sair" faz com o que importa aqui (o `handleLogout`).
function sairDeVerdade(m) {
  m.deps.epocaDaSessao++;
  m.AppState.geracaoDoSair++;
  m.AppState.fetchEpoch++;
  m.AppState.authenticated = false;
  m.AppState.queue = [];
  m.deps.pedidosEmAndamento.clear();
  m.AppState.inFlightActions = 0;
}

test('R20-2-01: durante a espera pela trava os alvos já estão "em andamento" — e saem UMA vez quando ela é concedida (controle)', async () => {
  const m = recusaComTrava();
  const fim = m.h.aplicarRecusaAutomatica();
  await tique(); await tique();
  assert.deepEqual(m.AppState.queue, [], 'PRÉ-CONDIÇÃO: os alvos saem da fila antes da espera');
  assert.equal(m.enviados.length, 0, 'PRÉ-CONDIÇÃO: nada saiu com a trava na mão da outra página (o instrumento enxerga a espera)');
  assert.deepEqual([...m.deps.pedidosEmAndamento].sort(), ['v1|u1', 'v2|u2', 'v3|u3'],
    'DEFEITO: na espera os alvos não estão em `pedidosEmAndamento` — a busca de uma fila refeita os traz de volta como card');
  m.trava.soltar();
  await fim;
  assert.deepEqual(m.enviados, ['u1', 'u2', 'u3'], 'CONTROLE: com a sessão de pé, cada alvo vai uma vez');
  assert.equal(m.deps.pedidosEmAndamento.size, 0, 'o fim do lote não soltou as marcas');
  assert.equal(m.AppState.stats.rejected, 3, 'CONTROLE: o placar conta ao pousar');
});

test('R20-2-01: o "Sair" na espera — ao soltar a trava NADA sai e NADA volta (a fila da tela de entrada fica vazia)', async () => {
  const m = recusaComTrava();
  const fim = m.h.aplicarRecusaAutomatica();
  await tique(); await tique();
  sairDeVerdade(m);
  m.trava.soltar();
  await fim;
  assert.deepEqual(m.enviados, [], 'DEFEITO: a recusa de quem saiu rejeitou no Waze depois do "Sair"');
  assert.deepEqual(m.AppState.queue, [], 'DEFEITO: os alvos voltaram à fila de uma sessão que não existe (dado de terceiro na memória da tela de entrada)');
  assert.deepEqual(m.devolvidos, [], 'os alvos de quem saiu foram "devolvidos" à busca');
  assert.equal(m.AppState.inFlightActions, 0, 'o lote velho mexeu no contador da sessão nova');
  assert.equal(m.deps.recusaAutomaticaRodando, false, 'a recusa ficou presa depois do "Sair"');
  assert.equal(m.deps.rejeicoesDeLoteNoAr.size, 0, 'o lote velho deixou o indicador "enviando"');
});

test('R20-2-01: o "Sair" e o login de OUTRA conta na espera — a conta nova não rejeita, nem conta, o que era da fila da anterior', async () => {
  const m = recusaComTrava();
  const fim = m.h.aplicarRecusaAutomatica();
  await tique(); await tique();
  sairDeVerdade(m);
  // A conta nova entra (nova sessão, fila nova, o mesmo autor marcado por ela):
  m.AppState.authenticated = true;
  m.AppState.queue = [P(50)].map((p) => ({ ...p }));
  m.trava.soltar();
  await fim;
  assert.deepEqual(m.enviados, [], 'DEFEITO: os pedidos da fila da conta anterior foram rejeitados com a sessão da conta nova');
  assert.equal(m.AppState.stats.rejected, 0, 'DEFEITO: o placar da conta nova contou a rejeição da anterior');
  assert.deepEqual(m.AppState.queue.map((p) => p.updateRequestID), ['u50'], 'os alvos da anterior caíram na fila da conta nova');
});

test('R20-2-01: o ↻ na aba que espera — os alvos não reaparecem como card, e a passada pedida de novo não os manda uma 2ª vez', async () => {
  const m = recusaComTrava();
  const fim = m.h.aplicarRecusaAutomatica();
  await tique(); await tique();
  // O ↻: a fila é REFEITA (`resetQueue` sobe a época) e a busca traz o que o Waze tem — com os alvos, que
  // seguem pendentes lá; a busca deixa de fora o que está "em andamento" (`semOsJaDecididos`).
  m.AppState.fetchEpoch++;
  const doWaze = [P(1), P(2), P(3), P(9, { creatorId: 1 })];
  m.AppState.queue = doWaze.filter((p) => !m.deps.pedidosEmAndamento.has(chaveDe(p))).map((p) => ({ ...p }));
  assert.deepEqual(m.AppState.queue.map((p) => p.updateRequestID), ['u9'], 'DEFEITO: os alvos reapareceram como card depois do ↻');
  // E uma passada pedida de novo na espera (a página que pousou com a recusa rodando).
  await m.h.aplicarRecusaAutomatica();
  m.trava.soltar();
  await fim;
  assert.deepEqual(m.enviados, ['u1', 'u2', 'u3'], 'DEFEITO: cada alvo tem de ir ao Waze UMA vez só: ' + JSON.stringify(m.enviados));
  assert.equal(m.AppState.stats.rejected, 3);
});

test('R20-2-01: a QUEDA na espera com a renovação da MESMA conta — o envio SEGUE com a sessão de agora, cada alvo uma vez, e nada volta como card', async () => {
  const m = recusaComTrava();
  const fim = m.h.aplicarRecusaAutomatica();
  await tique(); await tique();
  m.deps.epocaDaSessao++;          // a queda e a renovação: a época sobe; o "Sair" não passou, a fila ficou, há sessão de pé
  m.trava.soltar();
  await fim;
  assert.deepEqual(m.enviados, ['u1', 'u2', 'u3'],
    'DEFEITO: a rejeição que a pessoa armou parou na queda com a MESMA conta (os alvos viravam card e ninguém os rejeitava): ' + JSON.stringify(m.enviados));
  assert.deepEqual(m.AppState.queue, [], 'os alvos voltaram como card mesmo tendo sido rejeitados');
  assert.equal(m.AppState.stats.rejected, 3, 'o placar conta ao pousar, na sessão renovada');
  assert.equal(m.deps.pedidosEmAndamento.size, 0, 'as marcas ficaram presas');
});

test('R20-2-01: a queda na espera com a fila REFEITA (a renovação entrou como OUTRA conta) — nada sai e os alvos voltam pela busca', async () => {
  const m = recusaComTrava();
  const fim = m.h.aplicarRecusaAutomatica();
  await tique(); await tique();
  m.deps.epocaDaSessao++;
  m.AppState.fetchEpoch++;         // o `esquecerOutraConta` refez a fila
  m.AppState.queue = [P(50, { creatorId: 1 })].map((p) => ({ ...p }));
  m.trava.soltar();
  await fim;
  assert.deepEqual(m.enviados, [], 'DEFEITO: os pedidos da fila da conta anterior foram rejeitados com a sessão da conta nova');
  assert.deepEqual(m.devolvidos.sort(), ['u1', 'u2', 'u3'], 'os alvos não foram devolvidos à busca da sessão de agora (o objeto velho nunca entra na fila nova)');
  assert.deepEqual(m.AppState.queue.map((p) => p.updateRequestID), ['u50'], 'o objeto velho entrou na fila nova');
});

test('R20-2-01: a queda na espera SEM sessão ainda (a renovação não respondeu) — nada sai e os alvos voltam como card na fila que ficou', async () => {
  const m = recusaComTrava();
  const fim = m.h.aplicarRecusaAutomatica();
  await tique(); await tique();
  m.deps.epocaDaSessao++;
  m.AppState.authenticated = false;
  m.trava.soltar();
  await fim;
  assert.deepEqual(m.enviados, [], 'DEFEITO: o lote saiu sem sessão (ou com a época velha)');
  assert.deepEqual(m.AppState.queue.map((p) => p.updateRequestID).sort(), ['u1', 'u2', 'u3'], 'os alvos que não saíram não voltaram como card');
});

test('R20-2-01: a renovação como OUTRA conta que ainda NÃO se confirmou — o `aindaVale` a cada ida segura: nada sai e os alvos voltam', async () => {
  const m = recusaComTrava();
  const fim = m.h.aplicarRecusaAutomatica();
  await tique(); await tique();
  m.deps.epocaDaSessao++;           // a sessão renovada (a fila ainda é a velha: o perfil dela não chegou)
  m.deps.contaConfirmada = () => false;
  m.trava.soltar();
  await fim;
  assert.deepEqual(m.enviados, [], 'DEFEITO: a sessão da conta ainda não confirmada rejeitou os pedidos da lista de autores da anterior');
  assert.deepEqual(m.AppState.queue.map((p) => p.updateRequestID).sort(), ['u1', 'u2', 'u3'], 'os alvos não voltaram como card');
});

test('R20-2-01: CONTROLE — sem `navigator.locks` nada muda: os alvos saem uma vez cada, na hora', async () => {
  const m = recusaComTrava({ comTrava: false });
  await m.h.aplicarRecusaAutomatica();
  assert.deepEqual(m.enviados, ['u1', 'u2', 'u3']);
});

test('R20-2-01 (estrutura): `marcarEmAndamento` e as capturas (época, fila, geração, quem) vêm ANTES da espera pela trava, e o `enviarLote` as recebe', () => {
  const corpo = fatiar('aplicarRecusaAutomatica');
  const iCaptura = corpo.indexOf('const naSessao = {');
  const iMarca = corpo.indexOf('marcarEmAndamento(alvos, true, naSessao.geracao);');
  const iTrava = corpo.indexOf('locks.request(RECUSA_AUTOMATICA_TRAVA');
  assert.ok(iCaptura > 0 && iMarca > iCaptura && iTrava > iMarca, 'as capturas e a marca dos alvos têm de vir antes da espera pela trava');
  for (const campo of ['epoca: epocaDaSessao', 'epocaFila: AppState.fetchEpoch', 'geracao: AppState.geracaoDoSair']) {
    assert.ok(corpo.includes(campo), `a captura de "${campo}" sumiu`);
  }
  assert.match(corpo, /if \(naSessao\.geracao !== AppState\.geracaoDoSair\) return;/, 'o envio sob a trava deixou de conferir o "Sair"');
  assert.match(corpo, /if \(naSessao\.epoca !== epocaDaSessao && naSessao\.epocaFila === AppState\.fetchEpoch && AppState\.authenticated === true\) \{\s*naSessao\.epoca = epocaDaSessao;/,
    'a queda com a MESMA conta (fila ficou, sessão de pé) deixou de renovar a sessão do lote — a rejeição armada pararia na queda');
  assert.match(corpo, /await enviarLote\(alvos, \{\s*naSessao,/, 'o lote deixou de receber as capturas');
  const lote = fatiar('enviarLote');
  assert.match(lote, /const epoca = naSessao \? naSessao\.epoca : epocaDaSessao;/, 'o lote recaptura a época de depois da espera');
  assert.match(lote, /const epocaFila = naSessao \? naSessao\.epocaFila : AppState\.fetchEpoch;/);
  assert.match(lote, /: API\.rejectPlace\([^)]*\)\), epoca,\s*aoLandar/, 'a ida do lote deixou de levar a ÉPOCA DO LOTE: com a época velha ela sairia com a sessão de agora');
  assert.equal((corpo.match(/\bawait\b/g) || []).length, 3, 'a recusa ganhou outra espera: tudo antes do envio tem de seguir síncrono');
});

// ═══ R20-1-02 · o Enter/Espaço SEGURADO não repete a ação ══════════════════════════════════════════════
const guarda = montar(['guardaDoEnterSegurado'], {}, constante('CONTROLES_QUE_REPETEM')).guardaDoEnterSegurado;
function alvoDe(seletoresQueCasam, { tag = 'button' } = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    matches: (sel) => seletoresQueCasam.some((s) => sel.split(',').map((x) => x.trim()).includes(s)),
    closest: (sel) => (sel.includes(tag) || (sel.includes('[role="button"]') && tag === 'role') ? el : null),
  };
  return el;
}
function tecla(key, { repeat = true, alvo = alvoDe([]) } = {}) {
  const e = { key, repeat, target: alvo, preventDefault() { this.preso = true; } };
  guarda(e);
  return !!e.preso;
}

test('R20-1-02: Enter e Espaço SEGURADOS num botão perdem o `click` da repetição — o primeiro `keydown` não', () => {
  assert.equal(tecla('Enter'), true, 'DEFEITO: o Enter segurado num botão gera um `click` por repetição (16 `parear:claim` em 3 s)');
  assert.equal(tecla(' '), true, 'o Espaço segurado não foi coberto');
  assert.equal(tecla('Enter', { repeat: false }), false, 'CONTROLE: o primeiro Enter (sem repeat) tem de clicar');
  assert.equal(tecla('Tab'), false, 'outra tecla repetida não é com a guarda');
  assert.equal(tecla('ArrowLeft'), false);
});

test('R20-1-02: onde segurar é ANDAR a repetição segue valendo — aproximar/afastar o mapa e passar as fotos', () => {
  const ids = ['#mapaLbMais', '#mapaLbMenos', '#lightboxPrev', '#lightboxNext', '.card-image-prev', '.card-image-next'];
  for (const id of ids) assert.equal(tecla('Enter', { alvo: alvoDe([id]) }), false, `${id}: segurar o Enter deixou de repetir`);
  // CONTROLE: o recentrar do mapa e o Fechar NÃO andam, e a guarda os cobre.
  assert.equal(tecla('Enter', { alvo: alvoDe(['#mapaLbCentrar']) }), true, 'o recentrar repete');
  assert.equal(tecla('Enter', { alvo: alvoDe(['#lightboxClose']) }), true, 'o fechar repete');
  // Os ids existem de verdade no HTML (gotcha #68: id errado em seletor some com o dado calado).
  for (const id of ids.filter((x) => x.startsWith('#'))) {
    assert.ok(HTML.includes(`id="${id.slice(1)}"`), `o ${id} não existe no index.src.html`);
  }
  for (const cls of ids.filter((x) => x.startsWith('.'))) {
    assert.ok(HTML.includes(`class="${cls.slice(1)} `) || HTML.includes(` ${cls.slice(1)} `), `a classe ${cls} não existe no index.src.html`);
  }
});

test('R20-1-02: campo de texto não é botão — a guarda não toca nele; o Enter do nome e do código de pareamento ignoram a repetição', () => {
  const campo = { tagName: 'INPUT', matches: () => false, closest: () => null };
  assert.equal(tecla('Enter', { alvo: campo }), false, 'a guarda cancelou o Enter de um campo de texto');
  assert.equal(tecla('Enter', { alvo: { tagName: 'DIV' } }), false, 'alvo sem `closest` quebrou a guarda');
  const ouvintes = fatiar('setupModalListeners');
  assert.match(ouvintes, /if \(ev\.key === 'Enter'\) \{ ev\.preventDefault\(\); if \(!ev\.repeat\) confirmarRenomear\(\); \}/, 'o Enter segurado no nome salva em série');
  assert.match(ouvintes, /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); if \(!e\.repeat\) resgatarPareamento\(/, 'o Enter segurado no código resgata em série');
});

test('R20-1-02 (estrutura): a guarda é UMA, em captura no `document`, e entra ANTES do `handleKeyDown`', () => {
  const setup = SEM.slice(SEM.indexOf("document.addEventListener('keydown', guardaDoEnterSegurado, true);") - 200);
  assert.ok(setup.includes("document.addEventListener('keydown', guardaDoEnterSegurado, true);"), 'a guarda deixou de ser ligada em captura no `document`');
  const i = SEM.indexOf("document.addEventListener('keydown', guardaDoEnterSegurado, true);");
  const j = SEM.indexOf("window.addEventListener('keydown', handleKeyDown);");
  assert.ok(i > 0 && j > i && j - i < 400, 'a guarda tem de vir logo antes do `handleKeyDown`');
  assert.match(fatiar('guardaDoEnterSegurado'), /e\.repeat !== true \|\| \(e\.key !== 'Enter' && e\.key !== ' '\)\) return;/);
  // A guarda dos três botões do card (R19-2-01) segue lá: defesa em camadas.
  assert.match(fatiar('renderCurrentCard'), /if \(ev\.repeat && \(ev\.key === 'Enter' \|\| ev\.key === ' '\)\) ev\.preventDefault\(\);/);
});

// ═══ R20-3-02 · as marcas "no ar" das escritas da FOTO atravessavam o "Sair" ═══════════════════════════
function fotosDeMentira() {
  const portoes = [];
  const AppState = { authenticated: true, geracaoDoSair: 0, geracaoDasEscritasDeFoto: 0, preferences: { undoEnabled: false }, fetchEpoch: 0 };
  const place = { venueID: 'v1', updateRequestID: 'u1', name: 'Antes' };
  const deps = {
    AppState, Treino: { ativo: false }, aprovandoAgora: false, excluindoAgora: false, aprovacaoPendente: null, exclusaoPendente: null,
    renomeacoesNoAr: new Set(), escritasDeFotoNoLocal: new Map(), escritasConferindo: 0, canDisableUndo: () => true, fotoDoLightboxNaTela: () => true,
    Lightbox: { podeAprovarAtual: () => true, place, idx: 0, isOpen: () => false, idFotoAtual: () => 'f1', urls: ['u'], newIdx: -1, eDenuncia: false, removerFoto() {} },
    decididosPorOutraAbaComCardAqui: new WeakSet(), API: { getRegion: () => 'row' },
    document: { getElementById: () => ({ classList: { toggle() {} } }) }, aplicarTravaDeAcao() {}, manterFocoNoLightbox() {},
    refazerSelosSeOutroNaTela() {}, marcarEmAndamento() {}, anunciarNoLightbox() {}, anuncioDoCardAoFechar: () => () => {},
    enviarAprovacao: () => new Promise((ok) => portoes.push(ok)),
    enviarExclusao: () => new Promise((ok) => portoes.push(ok)),
    enviarRenomeacao: undefined,
  };
  const h = montar(['aprovarFotoAtual', 'pedirExclusaoDaFoto', 'estadoAprovando', 'lixeiraOcupada', 'soltarAsEscritasDeFotoDaSessaoQueAcabou'], deps);
  return { h, deps, AppState, portoes, place };
}

test('R20-3-02: o "Sair" solta o spinner do "Aprovar" e da lixeira — a conta nova não nasce com os botões travados', () => {
  const m = fotosDeMentira();
  m.h.aprovarFotoAtual();
  assert.equal(m.deps.aprovandoAgora, true, 'PRÉ-CONDIÇÃO: a aprovação sem janela está no ar');
  m.h.lixeiraOcupada(true);
  assert.equal(m.deps.excluindoAgora, true, 'PRÉ-CONDIÇÃO: a exclusão sem janela está no ar');
  m.h.soltarAsEscritasDeFotoDaSessaoQueAcabou();
  assert.equal(m.deps.aprovandoAgora, false, 'DEFEITO: o "Aprovar" da sessão nova nasce travado até a resposta da antiga (até 45 s)');
  assert.equal(m.deps.excluindoAgora, false, 'DEFEITO: a lixeira da sessão nova nasce travada');
  assert.equal(m.AppState.geracaoDasEscritasDeFoto, 1, 'a geração das escritas da foto não subiu');
});

test('R20-3-02: a resposta da aprovação da sessão que SAIU não solta o spinner da aprovação de quem entrou', async () => {
  const m = fotosDeMentira();
  m.h.aprovarFotoAtual();                                       // A (sem janela)
  m.h.soltarAsEscritasDeFotoDaSessaoQueAcabou();                // o "Sair"
  m.h.aprovarFotoAtual();                                       // B aprova (a sessão nova)
  assert.equal(m.deps.aprovandoAgora, true, 'PRÉ-CONDIÇÃO: a aprovação de B está no ar');
  m.portoes[0](false);                                          // A responde
  await tique(); await tique();
  assert.equal(m.deps.aprovandoAgora, true, 'DEFEITO: a resposta de A desligou o spinner da aprovação de B (B ainda está no ar)');
  m.portoes[1](false);
  await tique(); await tique();
  assert.equal(m.deps.aprovandoAgora, false, 'CONTROLE: a resposta da própria sessão solta o spinner');
});

test('R20-3-02: a resposta da exclusão da sessão que SAIU não solta a lixeira de quem entrou — e a da MESMA sessão solta', async () => {
  const m = fotosDeMentira();
  m.h.pedirExclusaoDaFoto();                                    // A (sem janela)
  assert.equal(m.deps.excluindoAgora, true, 'PRÉ-CONDIÇÃO: a exclusão de A está no ar');
  m.h.soltarAsEscritasDeFotoDaSessaoQueAcabou();
  m.h.pedirExclusaoDaFoto();                                    // B
  assert.equal(m.deps.excluindoAgora, true, 'PRÉ-CONDIÇÃO: a exclusão de B está no ar');
  m.portoes[0](false);
  await tique(); await tique();
  assert.equal(m.deps.excluindoAgora, true, 'DEFEITO: a resposta de A destravou a lixeira de B');
  m.portoes[1](false);
  await tique(); await tique();
  assert.equal(m.deps.excluindoAgora, false, 'CONTROLE: a resposta da própria sessão solta a lixeira');
});

test('R20-3-02: a pílula do nome — o "Sair" solta a renomeação no ar, e a resposta velha não solta a do mesmo local na sessão nova', async () => {
  const portoes = [];
  const AppState = { geracaoDoSair: 0, geracaoDasEscritasDeFoto: 0, fetchEpoch: 0, authenticated: true };
  const deps = {
    AppState, epocaDaSessao: 1, renomeacoesNoAr: new Set(), escritasDeFotoNoLocal: new Map(), aprovandoAgora: false, excluindoAgora: false, escritasConferindo: 0,
    API: { renomearLocal: () => new Promise((ok) => portoes.push(ok)) },
    callWithRetry: (fn) => fn(), esperaDaEscritaNoSair: () => () => {}, aplicarTravaDeAcao() {}, nomeDestaEscrita: () => true,
    refazerDepoisDo401: async () => null, aplicarNosIrmaos() {}, contarConquista() {}, devolverNome: () => false,
    msgDoServidor: () => '', showToast() {}, t: (k) => k,
  };
  const h = montar(['enviarRenomeacao', 'soltarAsEscritasDeFotoDaSessaoQueAcabou'], deps);
  const alvo = { place: { venueID: 'v-9', name: 'Novo' }, novo: 'Novo', antigo: 'Velho', regiao: 'row' };
  const a = h.enviarRenomeacao(alvo);
  await ateQue(() => portoes.length === 1, 'a renomeação de A saiu');
  assert.ok(deps.renomeacoesNoAr.has('v-9'), 'PRÉ-CONDIÇÃO: a pílula do local está travada');
  h.soltarAsEscritasDeFotoDaSessaoQueAcabou();
  assert.equal(deps.renomeacoesNoAr.size, 0, 'DEFEITO: o "Sair" não soltou a pílula do nome (a sessão nova a vê travada, calada)');
  AppState.geracaoDoSair++; deps.epocaDaSessao++;
  const b = h.enviarRenomeacao(alvo);                           // B renomeia o mesmo local
  await ateQue(() => portoes.length === 2, 'a renomeação de B saiu');
  portoes[0]({ success: true });                                // A responde
  await a;
  assert.ok(deps.renomeacoesNoAr.has('v-9'), 'DEFEITO: a resposta de A destravou a pílula do local enquanto a renomeação de B segue no ar');
  portoes[1]({ success: true });
  await b;
  assert.equal(deps.renomeacoesNoAr.size, 0, 'CONTROLE: a resposta da própria sessão solta a pílula');
});

test('R20-3-02: a conferência de um 401 da sessão que saiu não segura a sessão nova (`escritasConferindo`)', async () => {
  const AppState = { geracaoDasEscritasDeFoto: 0 };
  let sonda;
  const deps = {
    AppState, epocaDaSessao: 1, escritasConferindo: 0, verificandoSessao: false, conferenciaDaSessao: null, aplicarTravaDeAcao() {},
    handleUnauthorized: () => new Promise((ok) => { sonda = ok; }), sessaoVivaDepoisDe: () => false, navigator: { onLine: true },
    aprovandoAgora: false, excluindoAgora: false, renomeacoesNoAr: new Set(), escritasDeFotoNoLocal: new Map(), estadoAprovando() {}, lixeiraOcupada() {},
  };
  const h = montar(['refazerDepoisDo401', 'soltarAsEscritasDeFotoDaSessaoQueAcabou', 'callWithRetry', 'sessaoTrocou'], deps);
  const andando = h.refazerDepoisDo401(1, async () => ({ success: true }));
  await ateQue(() => !!sonda, 'a conferência não começou');
  assert.equal(deps.escritasConferindo, 1, 'PRÉ-CONDIÇÃO: a conferência trava o card');
  h.soltarAsEscritasDeFotoDaSessaoQueAcabou();                  // o "Sair"
  assert.equal(deps.escritasConferindo, 0, 'DEFEITO: o card da sessão nova segue travado pela conferência da antiga');
  deps.escritasConferindo = 1;                                  // a sessão nova abre a sua conferência
  sonda();
  await andando;
  assert.equal(deps.escritasConferindo, 1, 'DEFEITO: o fim da conferência velha desceu a conta da conferência da sessão nova');
});

test('R20-3-02 (estrutura): o "Sair", a troca de conta e os LOGINS que refazem a fila soltam as escritas da foto; a QUEDA com a mesma conta não', () => {
  assert.match(fatiar('handleLogout'), /^\s+soltarAsEscritasDeFotoDaSessaoQueAcabou\(\);/m, 'o "Sair" não solta as escritas da foto');
  assert.match(fatiar('esquecerOutraConta'), /^\s+soltarAsEscritasDeFotoDaSessaoQueAcabou\(\);/m, 'a troca de conta não solta as escritas da foto');
  // Os logins que REFAZEM a fila (R21-3-01): a queda SEM renovação seguida de um login novo — a extensão que não renova, ou a
  // pessoa que não a tem — deixava as marcas, globais, ligadas até a resposta da sessão que caiu (até 45 s). O comportamento
  // de cada um está em test/fotos-auditoria-r21.test.mjs; aqui, o encanamento.
  for (const login of ['authenticateWithCookies', 'resgatarPareamento', 'adotarSessaoDoAparelho']) {
    assert.match(fatiar(login), /^\s+soltarAsEscritasDeFotoDaSessaoQueAcabou\(\);/m, `${login} refaz a fila e não solta as escritas da foto da sessão que caiu`);
  }
  assert.match(fatiar('entrarPelaExtensao'), /\} else \{\s*resetQueue\(\);[\s\S]*?soltarAsEscritasDeFotoDaSessaoQueAcabou\(\);\s*\}/,
    'a extensão que entra com a fila refeita não solta as escritas da foto');
  // A queda com a MESMA conta: a escrita segue no ar e pousa depois — soltar reabriria a 2ª aprovação (L24). Vale também pro
  // ramo `manterFila` da extensão, que é a renovação dela (a fila ATRAVESSA).
  assert.doesNotMatch(fatiar('derrubarSessao'), /soltarAsEscritasDeFotoDaSessaoQueAcabou/, 'a queda com a mesma conta soltou a escrita da foto no ar');
  assert.doesNotMatch(fatiar('soltarOsLotesDaSessaoQueAcabou'), /soltarAsEscritasDeFotoDaSessaoQueAcabou/);
  const ext = fatiar('entrarPelaExtensao');
  const manter = ext.slice(ext.indexOf('if (manterFila) {'), ext.indexOf('} else {', ext.indexOf('if (manterFila) {')));
  assert.ok(manter.length > 40 && manter.includes('filaAtravessouSessao = true'), 'o ramo `manterFila` mudou de forma — o instrumento quebrou');
  assert.doesNotMatch(manter, /soltarAsEscritasDeFotoDaSessaoQueAcabou/, 'a renovação da queda (a fila que atravessa) soltou as escritas da foto');
});

// ═══ R20-1-03 · o ✓ único da conta A no ar × a fila da B ═══════════════════════════════════════════════
function decisaoUnicaNoAr(tipo = 'read') {
  const portoes = [];
  const AppState = { geracaoDoSair: 0, inFlightActions: 0, pendingAction: null, preferences: { undoEnabled: false }, queue: [], currentPlace: null };
  const deps = {
    AppState, epocaDaSessao: 1, pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), alvosDoLoteDeLidosNoAr: new Map(),
    decisoesPorContaNoAr: new Map(), canDisableUndo: () => true, presencaFolhaAberta: () => false, redesenharAvisoDoSairSeAberto() {},
    aplicarTravaDeAcao() {}, removeUndoBanner() {}, updateInFlightIndicator() {}, atenderOFimDaJanela() {}, API: { getRegion: () => 'row' },
    setTimeout, clearTimeout,
  };
  const h = montar(['scheduleAction', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'chaveDoPedido', 'soltarOLoteDeLidosDaContaAnterior'], deps);
  const pedido = P(1);
  h.scheduleAction(tipo, pedido, () => new Promise((ok) => portoes.push(ok)));
  return { h, deps, AppState, portoes, pedido, chave: chaveDe(pedido) };
}

test('R20-1-03: o ✓ ÚNICO da conta A no ar — a troca de conta (a renovação entrando como OUTRA) solta o pedido pra busca da B', async () => {
  const m = decisaoUnicaNoAr('read');
  await tique();
  assert.ok(m.deps.pedidosEmAndamento.has(m.chave), 'PRÉ-CONDIÇÃO: o ✓ no ar segura o pedido');
  assert.equal(m.deps.decisoesPorContaNoAr.get(m.chave), 1, 'o ✓ no ar não leva a época da sessão que o mandou');
  m.deps.epocaDaSessao++;                                       // a queda com renovação, entrando como OUTRA conta
  m.h.soltarOLoteDeLidosDaContaAnterior();                      // o `esquecerOutraConta`
  assert.equal(m.deps.pedidosEmAndamento.has(m.chave), false,
    'DEFEITO: o pedido que a A marcou como lido segue fora da fila da B ("lido" é por conta: pra B ele está pendente)');
  m.portoes[0]({ success: true });
  await tique(); await tique();
  assert.equal(m.deps.decisoesPorContaNoAr.size, 0, 'o fim do envio deixou a marca da conta no mapa');
});

test('R20-1-03: a resposta velha do ✓ da A NÃO solta o "em andamento" do mesmo pedido que a B já decidiu', async () => {
  const m = decisaoUnicaNoAr('read');
  await tique();
  m.deps.epocaDaSessao++;
  m.h.soltarOLoteDeLidosDaContaAnterior();
  m.h.marcarEmAndamento(m.pedido, true);                        // a B decide o mesmo pedido (o ✕ dela)
  m.deps.decisoesPorContaNoAr.set(m.chave, m.deps.epocaDaSessao);
  m.portoes[0]({ success: true });
  await tique(); await tique();
  assert.equal(m.deps.pedidosEmAndamento.has(m.chave), true, 'DEFEITO: o fim do envio da A soltou a marca da decisão da B');
});

test('R20-1-03: CONTROLES — a queda com a MESMA conta mantém o pedido preso até a resposta; o ✕ (global no Waze) nunca entra no mapa', async () => {
  const mesma = decisaoUnicaNoAr('read');
  await tique();
  mesma.deps.epocaDaSessao++;                                   // a queda: a época sobe, a conta é a mesma (nada solta)
  assert.ok(mesma.deps.pedidosEmAndamento.has(mesma.chave), 'a queda com a mesma conta soltou o pedido (a resposta ainda vem)');
  mesma.portoes[0]({ success: true });
  await tique(); await tique();
  assert.equal(mesma.deps.pedidosEmAndamento.has(mesma.chave), false, 'a resposta da mesma conta não soltou a marca');
  const rejeitar = decisaoUnicaNoAr('reject');
  await tique();
  assert.equal(rejeitar.deps.decisoesPorContaNoAr.size, 0, 'o ✕ entrou no mapa das decisões por conta: rejeitar é global, a B não deve voltar a ver o pedido');
  assert.ok(rejeitar.deps.pedidosEmAndamento.has(rejeitar.chave));
  const estrela = decisaoUnicaNoAr('skip');
  await tique();
  assert.equal(estrela.deps.decisoesPorContaNoAr.get(estrela.chave), 1, 'a estrela (por conta, como o "lido") não entrou no mapa');
});

test('R20-1-03 (estrutura): o "Sair" esvazia o mapa, e a troca de conta o consulta junto do lote de lidos', () => {
  assert.match(fatiar('handleLogout'), /^\s+decisoesPorContaNoAr\.clear\(\);/m, 'o "Sair" deixou o mapa das decisões por conta');
  assert.match(fatiar('soltarOLoteDeLidosDaContaAnterior'), /for \(const \[k, epoca\] of \[\.\.\.decisoesPorContaNoAr\]\) \{\s*if \(epoca === epocaDaSessao\) continue;/);
  assert.match(fatiar('scheduleAction'), /const porConta = type === 'read' \|\| type === 'skip';/);
});

// ═══ R20-7-02 · o histórico guardado que não é um objeto ═══════════════════════════════════════════════
function historicoGuardado(texto) {
  const guardado = new Map(texto === undefined ? [] : [['waze_places_history', texto]]);
  const AppState = { history: null };
  const deps = {
    AppState, HISTORY_KEY: 'waze_places_history', HISTORY_MAX_DIAS: 400,
    localStorage: { getItem: (k) => (guardado.has(k) ? guardado.get(k) : null), setItem: (k, v) => guardado.set(k, v) },
    historyTodayKey: () => '2026-10-14', ondeAgora: () => '30', contaAgora: () => null, agendarRedesenhoDoHistorico() {},
    garantirLinhaDeBaseDasConquistas() {}, textoDaCopia: new WeakMap(),
  };
  const h = montar(['copiaEmDia', 'lembrarTextoDaCopia', 'loadHistory', 'podarHistorico', 'salvarHistorico', 'recordHistory', 'getHistoryStats',
    'diasEntreChaves'], deps);
  return { h, deps, AppState, guardado };
}
const AGORA_NO_TESTE = '2026-10-14';

test('R20-7-02: histórico guardado que NÃO é um objeto (`"x"`, `5`, `{"2026-10-14":5}`, `[]`) — `recordHistory` grava em vez de lançar', () => {
  for (const texto of ['"x"', '5', '[]', 'true', '{"2026-10-14":5}', '{"2026-10-14":"x"}', '{"_total":"a"}', '{"_total":[1]}', '{"2026-10-14":[1,2]}']) {
    const m = historicoGuardado(texto);
    assert.doesNotThrow(() => m.h.recordHistory('reject', 1), `DEFEITO: o histórico ${texto} derruba o recordHistory (a exceção morre calada na cadeia assíncrona)`);
    const salvo = JSON.parse(m.guardado.get('waze_places_history'));
    assert.equal(salvo._total.rejected, 1, `${texto}: a rejeição não chegou ao total`);
    assert.equal(salvo[AGORA_NO_TESTE].rejected, 1, `${texto}: a rejeição não chegou ao balde do dia`);
    assert.doesNotThrow(() => m.h.getHistoryStats(), `${texto}: as estatísticas lançam`);
  }
});

test('R20-7-02: o balde estragado na MEMÓRIA também não derruba — e as estatísticas o ignoram', () => {
  const m = historicoGuardado(JSON.stringify({ _total: { read: 0, rejected: 0 } }));
  m.h.recordHistory('read', 1);
  m.AppState.history['2026-10-13'] = 7;                         // algo escreveu um número no lugar do balde
  assert.doesNotThrow(() => m.h.getHistoryStats(), 'as estatísticas lançam com um balde que não é objeto');
  m.AppState.history[AGORA_NO_TESTE] = 'x';
  assert.doesNotThrow(() => m.h.recordHistory('reject', 1), 'o recordHistory lança com o balde do dia estragado');
  assert.equal(m.AppState.history[AGORA_NO_TESTE].rejected, 1);
});

test('R20-7-02: CONTROLES — os históricos de sempre seguem somando, e o lixo de campo (`_total.read` texto, `onde` lista) não vira NaN', () => {
  const bom = historicoGuardado(JSON.stringify({ _total: { read: 5, rejected: 2 }, [AGORA_NO_TESTE]: { read: 1, rejected: 1, onde: { 30: 2 } } }));
  bom.h.recordHistory('reject', 1);
  const s = JSON.parse(bom.guardado.get('waze_places_history'));
  assert.deepEqual([s._total.read, s._total.rejected, s[AGORA_NO_TESTE].rejected, s[AGORA_NO_TESTE].onde['30']], [5, 3, 2, 3], 'CONTROLE: o histórico válido deixou de somar');
  const vazio = historicoGuardado(undefined);
  vazio.h.recordHistory('read', 1);
  assert.equal(JSON.parse(vazio.guardado.get('waze_places_history'))._total.read, 1, 'CONTROLE: o aparelho novo não grava');
  const sujo = historicoGuardado(JSON.stringify({ _total: { read: 'x' }, [AGORA_NO_TESTE]: { read: 'y', rejected: 0, onde: [1] } }));
  sujo.h.recordHistory('read', 1);
  const t = JSON.parse(sujo.guardado.get('waze_places_history'));
  assert.equal(t._total.read, 1, 'o total com texto virou NaN');
  assert.equal(t[AGORA_NO_TESTE].read, 1, 'o balde com texto virou NaN');
  assert.deepEqual(t[AGORA_NO_TESTE].onde, { 30: 1 }, 'o `onde` que era lista não virou objeto');
});
