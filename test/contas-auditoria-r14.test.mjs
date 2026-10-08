// A conta, as abas, a sessão e o "Sair" (auditoria da rodada 14, R14-8 e R14-1 —
// o lote 18 da área "contas"):
//
//  · R14-8-09 — o "N esperando envio" ficava na tela de entrada depois da queda;
//  · R14-8-06 — o "Sair" aberto na janela do Desfazer descartava a decisão calado;
//  · R14-1-04 — a aba que CAIU, com a pergunta à extensão NO AR e texto colado:
//    OUTRA conta entrando noutra aba não a alcançava depois (o fim da pergunta não
//    entrava nem adotava). E o irmão: a pergunta da RENOVAÇÃO da queda que falha;
//  · a pista do lote 17 (s13) — duas abas perguntando à extensão com um login no
//    ar numa delas: a que decidia primeiro apagava no servidor a sessão que a
//    outra ia usar;
//  · R14-1-03 — duas abas da MESMA conta com sessões DIFERENTES: quando a GUARDADA
//    no aparelho caía numa delas, a outra, VIVA, ficava sem sessão no aparelho
//    (recarregá-la levava à tela de entrada, com a sessão dela órfã no servidor).
//    DECIDIDO: a viva volta a guardar a sua. O aviso do token sozinho não separa a
//    queda do "Sair" — MEDIDO: no "Sair" ele chega com a CONTA ainda no aparelho
//    (abas em processos diferentes) —, e quem diz que foi a queda é a aba que caiu,
//    pelo canal da sessão.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada e anota o nome. Cada
// teste foi visto REPROVANDO com o conserto desfeito (as sabotagens estão no
// relatório do lote).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP = ler('js/app.js');
const APP_SEM = semComentario(APP);
const I18N = ler('js/i18n.js');

function fatiarDe(fonte, nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
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
const fatiar = (nome) => fatiarDe(APP_SEM, nome);
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada, e anota as
// chamadas pelo caminho.
function buracoNegro(nome, chamou) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}

// `deps`: o que as funções enxergam (funções e as variáveis de módulo, que elas
// leem e escrevem direto no objeto). O resto é buraco negro.
function montar(nomes, deps) {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map(fatiar).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}

const TOKEN = 'waze_session_token';
const CONTA_KEY = constante('CONTA_KEY');
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
const tique = () => new Promise((ok) => setImmediate(ok));
const tiques = async (n = 4) => { for (let i = 0; i < n; i++) await tique(); };
const TEXTO_COLADO = '# Netscape HTTP Cookie File\n.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tconta=333';

// O armazenamento de UMA aba, espionado.
function aparelho(inicial = {}) {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const escritas = [];
  const localStorage = {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { escritas.push('grava:' + k); dados.set(k, String(v)); },
    removeItem: (k) => { escritas.push('apaga:' + k); dados.delete(k); },
  };
  const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  return { dados, escritas, localStorage, safeLS };
}

// ═══ R14-8-09 · o "N esperando envio" e a sessão ═════════════════════════════
// A tela de mentira, com o corpo onde o indicador nasce e some.
function telaComIndicador({ autenticado = true, fila = ['v1'] } = {}) {
  const els = {};
  const elemento = (id) => {
    const classes = new Set();
    const e = {
      id, style: {}, className: '', innerHTML: '', title: '', textContent: '',
      classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, v) => (v ? classes.add(c) : classes.delete(c)) },
      remove() { delete els[this.id]; },
    };
    return e;
  };
  for (const id of ['authScreen', 'appScreen', 'filtersBtn', 'refreshBtn', 'userProfileBadge', 'brandTitle', 'cardLiveRegion']) els[id] = elemento(id);
  els.logoutModal = elemento('logoutModal');
  els.logoutModal.classList.add('hidden');
  const document = {
    getElementById: (id) => els[id] || null,
    createElement: () => elemento(''),
    body: { appendChild: (e) => { els[e.id] = e; } },
    documentElement: { classList: { remove() {}, add() {} } },
    querySelectorAll: () => [],
  };
  const AppState = { authenticated: autenticado, inFlightActions: 0, profile: { id: 111 }, pendingAction: null, fetchEpoch: 1 };
  const deps = {
    document, AppState, window: { Presenca: { desligar() {}, sincronizar() {} } },
    carregarFilaDeSaida: () => fila.map((v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v })),
    pedidosEmAndamento: new Set(), chaveDoPedido: (x) => x.venueID + '|' + x.updateRequestID,
    reivindicadoPorOutraAba: () => false, indicadorMarcaVence: null, SAIDA_REIVINDICACAO_MS: 60000,
    t: (k, v) => k + (v ? ':' + JSON.stringify(v) : ''), escapeHtml: (s) => String(s),
    // O `derrubarSessao`: a sessão desta aba é a guardada, e a renovação fica no ar.
    API: { sessionToken: 'TOK-A', setSession() {}, soltarSessao() {} }, safeLS: { get: () => 'TOK-A' },
    epocaDaSessao: 0, quedaAnunciada: false, Treino: { ativo: false },
    entrarPelaExtensao: () => new Promise(() => {}), avisarOutrasAbasDaQueda: () => {},
  };
  const h = montar(['updateInFlightIndicator', 'saindoPelaOutraAba', 'showAuthScreen', 'showMainScreen', 'derrubarSessao',
    'sessaoDestaAbaEhAGuardada'], deps);
  const indicador = () => (els.inFlightIndicator ? els.inFlightIndicator.title : null);
  return { h, AppState, indicador };
}

test('R14-8-09: a QUEDA tira da tela o "N esperando envio" (sem sessão a fila de saída não aparece) — e a tela de entrada também', () => {
  for (const [caso, cair] of [['a queda (`derrubarSessao`)', (m) => m.h.derrubarSessao('srv.err.sessionExpired')],
    ['a tela de entrada (`showAuthScreen`)', (m) => m.h.showAuthScreen()]]) {
    const m = telaComIndicador();
    m.h.updateInFlightIndicator();
    assert.equal(m.indicador(), 'indicator.waiting:{"n":1}', 'PRÉ-CONDIÇÃO: o indicador não estava na tela');
    cair(m);
    assert.equal(m.AppState.authenticated, false);
    assert.equal(m.indicador(), null,
      `DEFEITO (${caso}): o "1 esperando envio" ficou na tela sem sessão — no canto do "Bem-vindo!", com o relógio de "parado esperando rede"`);
  }
});

test('R14-8-09: a sessão que VOLTA (`showMainScreen`, a renovação) mostra de novo o que espera envio', () => {
  const m = telaComIndicador({ autenticado: false });
  m.h.updateInFlightIndicator();
  assert.equal(m.indicador(), null, 'PRÉ-CONDIÇÃO: sem sessão, o indicador apareceu');
  m.h.showMainScreen();
  assert.equal(m.indicador(), 'indicator.waiting:{"n":1}',
    'DEFEITO: a sessão voltou e o que espera envio na fila de saída não apareceu (a queda o tirou da tela)');
  // CONTROLE: sem nada na fila, nada aparece.
  const v = telaComIndicador({ autenticado: false, fila: [] });
  v.h.showMainScreen();
  assert.equal(v.indicador(), null);
});
