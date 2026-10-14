// Contas, sessão, recusa automática e dados guardados depois da auditoria da rodada 21 (lote 25).
// O rótulo é o do relatório dessa rodada. Cada teste foi visto REPROVANDO com o conserto desfeito
// (as sabotagens estão no relatório do lote).
//
//   R21-1-02 / R21-5-04 / R21-5-08  o armazenamento ILEGÍVEL não é o "Sair" de outra aba
//   R21-1-03                         o link do "Copiar link" colado no campo do código
//   R21-1-04 / R21-2-06              contagem guardada que não é número (o `onde`, o placar, o Histórico)
//   R21-2-02 / R21-2-05              a recusa automática esperando a trava entre abas
//
// As funções rodam DE VERDADE, fatiadas do app.js; o que o teste não fornece vira um "buraco negro"
// (ver `contas-abas.test.mjs`). O `safeLS` é o de VERDADE, do api.js, sobre um armazenamento de mentira:
// o que ele faz com um `localStorage` que lança é justamente o defeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { novoCliente } from './_presenca-cliente.mjs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP = ler('js/app.js');
const APP_SEM = semComentario(APP);
const SAFELS_FONTE = /^const safeLS = \{[\s\S]*?^\};/m.exec(ler('js/api.js'))[0];

function fatiarDe(fonte, nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu`);
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
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada, e anota as chamadas pelo caminho.
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
// `deps`: o que as funções enxergam (funções e as variáveis de módulo, que elas leem e escrevem direto no
// objeto). O resto é buraco negro.
function montar(nomes, deps, fonte = APP_SEM) {
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
  const corpo = nomes.map((n) => fatiarDe(fonte, n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}
const tique = () => new Promise((ok) => setImmediate(ok));

// ═══ R21-1-02 / R21-5-04 / R21-5-08 · o armazenamento ILEGÍVEL não é o "Sair" de outra aba ═══════════════
// `safeLS.get` devolve `null` tanto pra "a chave não existe" quanto pra "não consegui ler". Com o
// `localStorage` lançando (navegador com "bloquear todos os cookies"), "sem token E sem conta" ficava
// verdadeiro com a sessão VIVA na memória: o retorno do bfcache encerrava a sessão e mandava
// `sessao:destroy`, e a volta do fundo da presença nunca mais pedia a lista.
const negado = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
// Os jeitos de o armazenamento não ler: o acesso à propriedade lança (Chromium: `Failed to read the
// 'localStorage' property`), os métodos lançam, ou nem existe (`null`).
const JEITOS_DE_NAO_LER = {
  'o acesso lança': () => new Proxy({}, { get: negado }),
  'os métodos lançam': () => ({ getItem: negado, setItem: negado, removeItem: negado }),
  'é null': () => null,
};
function aparelho(guardado = {}) {
  const dados = new Map(Object.entries(guardado));
  const localStorage = { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem: (k, v) => dados.set(k, String(v)), removeItem: (k) => dados.delete(k) };
  return { dados, localStorage };
}
const safeLSSobre = (localStorage) => new Function('localStorage', SAFELS_FONTE + '\nreturn safeLS;')(localStorage);
const TOKEN = 'waze_session_token';
const CONTA_KEY = constante('CONTA_KEY');

test('R21-1-02: `armazenamentoLegivel` — lê quando o aparelho lê (vazio ou não); não lê quando ele lança, de qualquer jeito', () => {
  const lê = (localStorage) => montar(['armazenamentoLegivel'], { localStorage }).armazenamentoLegivel();
  assert.equal(lê(aparelho().localStorage), true, 'CONTROLE: o aparelho vazio LÊ (a chave ausente não é "não leu")');
  assert.equal(lê(aparelho({ [TOKEN]: 'tok' }).localStorage), true, 'CONTROLE: o aparelho com a sessão lê');
  for (const [jeito, faz] of Object.entries(JEITOS_DE_NAO_LER)) {
    assert.equal(lê(faz()), false, `DEFEITO (${jeito}): o aparelho que nem lê foi dado como legível`);
  }
});

// A aba que volta do bfcache (ou que recebe o aviso `storage`) com a sessão VIVA na memória e o app na tela.
function abaLogada({ localStorage, safeLS = safeLSSobre(localStorage) }) {
  const log = [];
  const deps = {
    safeLS, localStorage, CONTA_KEY, tokenTiradoPorOutraAba: null,
    API: { temSessaoNaMemoria: () => true, sessionToken: 'tok-desta' },
    AppState: { authenticated: true, profile: { id: 111 }, queue: [], currentPlace: null, history: {}, conquistas: {}, autores: {} },
    document: { getElementById: (id) => (id === 'appScreen' ? { classList: { contains: () => false } } : null), querySelector: () => null },
    contaConfirmadaNestaAba: { id: '111', s: 'x' }, extPerguntando: false, sessaoCaiuNestaPagina: false,
    handleLogout: (o) => log.push(['sair', o]),
    relerPlacarDeOutraAba: () => log.push('placar'), relerPreferenciasDeOutraAba: () => log.push('preferencias'),
  };
  const h = montar(['aoVoltarDoBfcache', 'aoGravarEmOutraAba', 'sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba',
    'outraContaTomouOAparelhoDaQueCaiu', 'contaSegueNoAparelho', 'sessaoDestaAbaEhAGuardada', 'guardaASessaoQueCaiu', 'armazenamentoLegivel'], deps);
  return { h, log, deps };
}
const SAIU = ['sair', { porOutraAba: true }];

test('R21-5-08: o bfcache com o armazenamento ILEGÍVEL não relê nada — a sessão viva, o Histórico e as preferências desta sessão ficam', () => {
  for (const [jeito, faz] of Object.entries(JEITOS_DE_NAO_LER)) {
    const m = abaLogada({ localStorage: faz() });
    const { AppState } = m.deps;
    const historico = AppState.history, conquistas = AppState.conquistas, autores = AppState.autores;
    m.h.aoVoltarDoBfcache({ persisted: true });
    assert.deepEqual(m.log.filter((x) => Array.isArray(x)), [],
      `DEFEITO (${jeito}): a aba logada saiu como se outra aba tivesse dado "Sair" (e mandaria \`sessao:destroy\`) — o aparelho não lê, não há "Sair" a ver`);
    assert.equal(AppState.authenticated, true);
    assert.ok(AppState.history === historico && AppState.conquistas === conquistas && AppState.autores === autores,
      `DEFEITO (${jeito}): a volta soltou a cópia em memória do Histórico/das conquistas/dos autores — a próxima leitura é do aparelho que não lê (vazio)`);
    assert.deepEqual(m.log.filter((x) => !Array.isArray(x)), [],
      `DEFEITO (${jeito}): a volta releu o placar/as preferências de um aparelho que não lê — as preferências desta sessão voltavam à fábrica (${m.log})`);
  }
});

test('R21-5-08: CONTROLES — o "Sair" de verdade ainda encerra a aba (aparelho vazio que LÊ), e a queda e a sessão guardada não', () => {
  const sair = abaLogada({ localStorage: aparelho().localStorage });
  sair.h.aoVoltarDoBfcache({ persisted: true });
  assert.deepEqual(sair.log.filter((x) => Array.isArray(x)), [SAIU], 'CONTROLE: o "Sair" noutra aba (token E conta fora, aparelho legível) deixou de encerrar esta');
  const queda = abaLogada({ localStorage: aparelho({ [CONTA_KEY]: JSON.stringify({ id: 111, s: 'x' }) }).localStorage });
  queda.h.aoVoltarDoBfcache({ persisted: true });
  assert.deepEqual(queda.log.filter((x) => Array.isArray(x)), [], 'CONTROLE: a QUEDA da sessão guardada (sem token, COM a conta) virou "Sair"');
  const viva = abaLogada({ localStorage: aparelho({ [TOKEN]: 'tok-desta', [CONTA_KEY]: JSON.stringify({ id: 111, s: 'x' }) }).localStorage });
  viva.h.aoVoltarDoBfcache({ persisted: true });
  assert.deepEqual(viva.log.filter((x) => Array.isArray(x)), [], 'CONTROLE: a aba com a sessão no aparelho foi encerrada');
});

test('R21-5-08: o aviso `storage` do token saindo com o armazenamento ilegível também não encerra (o mesmo `aoSairEmOutraAba`)', () => {
  const m = abaLogada({ localStorage: JEITOS_DE_NAO_LER['os métodos lançam']() });
  m.h.aoGravarEmOutraAba({ key: TOKEN, newValue: null, oldValue: 'tok-velho' });
  m.h.aoGravarEmOutraAba({ key: CONTA_KEY, newValue: null, oldValue: '{}' });
  m.h.sincronizarComOutraAba(null);          // o "armazenamento limpo inteiro" (`key` nulo) também
  assert.deepEqual(m.log.filter((x) => Array.isArray(x)), [], 'o aviso do token/conta com o aparelho ilegível encerrou a aba');
});

// ── a presença: a volta do segundo plano e do bfcache (R21-5-04) ──
const T = 1790400000000;
const visibilidade = (c, v) => { c.doc.visibilityState = v; for (const fn of c.doc._ouv.visibilitychange || []) fn(); };
function voltaDaPagina(c, via) {
  c.relogio.agora += 120_000;      // o teto de 60 s da volta já passou
  if (via === 'pageshow') { for (const fn of c.win._ouv.pageshow || []) fn({ persisted: true }); }
  else { visibilidade(c, 'hidden'); visibilidade(c, 'visible'); }
}

for (const via of ['pageshow', 'visibilitychange']) {
  test(`R21-5-04 (${via}) com o armazenamento ILEGÍVEL a volta pede a lista da presença (a sessão está viva na memória)`, async () => {
    const c = novoCliente({ agora: T + 10, armazenamentoBloqueado: true });
    c.P.presencaMontar();
    await c.P.presencaAtualizar(); await tique();
    assert.equal(c.P.presencaAparelhoSaiu(), false, 'DEFEITO: o aparelho que nem lê foi dado como "Sair"');
    const antes = c.chamadas.presencaApp.length;
    voltaDaPagina(c, via);
    await tique(); await tique();
    assert.equal(c.chamadas.presencaApp.length - antes, 1, 'DEFEITO: a volta nunca mais pede a lista nem religa o tempo real');
  });

  test(`R21-5-04 (${via}) CONTROLES — o "Sair" de verdade (aparelho vazio que LÊ) segue sem pedido; com a sessão guardada, pede`, async () => {
    const sair = novoCliente({ agora: T + 10 });
    sair.P.presencaMontar();
    await sair.P.presencaAtualizar(); await tique();
    sair.armazenado.delete(TOKEN); sair.armazenado.delete(CONTA_KEY);
    assert.equal(sair.P.presencaAparelhoSaiu(), true, 'CONTROLE: o "Sair" deixou de ser visto');
    const a0 = sair.chamadas.presencaApp.length;
    voltaDaPagina(sair, via);
    await tique(); await tique();
    assert.equal(sair.chamadas.presencaApp.length - a0, 0, 'CONTROLE: depois do "Sair" noutra aba a volta pediu a lista');
    const viva = novoCliente({ agora: T + 10 });
    viva.P.presencaMontar();
    await viva.P.presencaAtualizar(); await tique();
    const v0 = viva.chamadas.presencaApp.length;
    voltaDaPagina(viva, via);
    await tique(); await tique();
    assert.equal(viva.chamadas.presencaApp.length - v0, 1, 'CONTROLE: o instrumento não enxerga a volta');
  });
}

test('R21-5-04: o escritor da chave do chat com o aparelho ilegível não lança (o `safeLS` engole) e a instalação segue sorteada', () => {
  const c = novoCliente({ agora: T + 10, armazenamentoBloqueado: true });
  assert.doesNotThrow(() => c.P.chatInstalacao());
  assert.equal(c.armazenado.has('waze_places_chat'), false, 'o aparelho não grava (o armazenamento é de mentira e bloqueado)');
});
