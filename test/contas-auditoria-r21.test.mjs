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

// ═══ R21-1-03 · o link do "Copiar link" colado no campo do código ═══════════════════════════════════════
// O 2º critério da extração ("seis símbolos soltos do alfabeto") casava o "places" do host de produção
// (`places.wazebrasil.com`: seis letras, todas do alfabeto), e o colar TROCAVA o campo por ele ("PLA-CES"):
// a recusa dizia "Código inválido ou expirado" com o segredo de 20 símbolos do link ainda valendo. O que o
// app MOSTRA (o link que o "Copiar link" copia) e o que o campo ACEITA têm que ser a mesma coisa.
const NET = (d, n, v) => `${d}\tTRUE\t/\tTRUE\t0\t${n}\t${v}`;
const COOKIES_WAZE = [NET('.waze.com', '_csrf_token', 'abc'), NET('.waze.com', '_web_session', 'sessao')].join('\n');
const CONSTANTES_DO_PAREAMENTO = {
  PAIR_CODE_LEN: constante('PAIR_CODE_LEN'), PAIR_CODE_GRUPO: constante('PAIR_CODE_GRUPO'),
  PAIR_ALFABETO: constante('PAIR_ALFABETO'), PAIR_SEGREDO_LEN: constante('PAIR_SEGREDO_LEN'),
};
const PRODUCAO = 'https://places.wazebrasil.com';
const montarColar = (extra = {}) => montar(['formatarCodigoPareamento', 'extrairCodigoPareamento', 'extrairSegredoDoLinkDePareamento', 'colarCodigoPareamento'],
  { ...CONSTANTES_DO_PAREAMENTO, window: {}, ...extra });
// O que o campo mostra depois de colar `texto`: o nosso colar e, se ele deixar passar, o do navegador seguido do `input`.
function colando(m, texto, antes = '') {
  let impedido = false;
  const campo = { value: antes, setSelectionRange() {} };
  m.colarCodigoPareamento({ clipboardData: { getData: () => texto }, preventDefault: () => { impedido = true; }, target: campo });
  return { impedido, campo: impedido ? campo.value : m.formatarCodigoPareamento(antes + texto) };
}

test('R21-1-03: `PAIR_SEGREDO_LEN` do app é o `PAIR_SECRET_LEN` do servidor', () => {
  const doServidor = Number(/^const PAIR_SECRET_LEN = (\d+);/m.exec(ler('server/core.mjs'))[1]);
  assert.equal(CONSTANTES_DO_PAREAMENTO.PAIR_SEGREDO_LEN, doServidor, 'o app procura um segredo de tamanho diferente do que o servidor emite');
});

test('R21-1-03: o código NÃO perde pro host do link — nem o código sem algarismo (uns 18% deles)', () => {
  const { extrairCodigoPareamento } = montarColar();
  // Códigos só de letras do alfabeto: o 2º critério os tratava como palavra e o último ganhava.
  const codigos = ['KMQXRT', 'HXKTPW', 'BCDFGH', 'WXYZKM'];
  const em = (codigo) => [
    `Código: ${codigo} ${PRODUCAO}`,
    `${PRODUCAO} Código: ${codigo}`,
    `Código: ${codigo}\n${PRODUCAO}/#pair=U5P25D77X9W2BGW78UPR`,
    `Entrar: ${codigo} (http://localhost:8080/)`,
    `${codigo} www.places.wazebrasil.com`,
    `places.wazebrasil.com/#x Código ${codigo}`,
    `Código ${codigo} places.wazebrasil.com/#x`,    // o host DEPOIS do código: o "último ganha" não salva
    `Seu código é ${codigo}. Abra ${PRODUCAO}.`,
  ];
  const errados = [];
  for (const c of codigos) for (const texto of em(c)) if (extrairCodigoPareamento(texto) !== c) errados.push(`${JSON.stringify(texto)} → ${extrairCodigoPareamento(texto)}`);
  assert.deepEqual(errados, [], 'DEFEITO: o host do link ganhou do código colado junto');
  // O formato da tela (XXX-XXX) também não é lido DENTRO de uma URL.
  assert.equal(extrairCodigoPareamento('https://exemplo.com/ABC-999 Código: KMQ-XRT'), 'KMQXRT');
  assert.equal(extrairCodigoPareamento('https://exemplo.com/ABC-999'), null, 'um traço dentro da URL virou código');
});

test('R21-1-03: o LINK sozinho não vira código (o campo não é trocado por "PLACES")', () => {
  const { extrairCodigoPareamento } = montarColar();
  for (const link of [`${PRODUCAO}/#pair=U5P25D77X9W2BGW78UPR`, `${PRODUCAO}`, 'places.wazebrasil.com/#pair=U5P25D77X9W2BGW78UPR', `${PRODUCAO}/?pair=U5P25D77X9W2BGW78UPR`]) {
    assert.equal(extrairCodigoPareamento(link), null, `${link} virou "${extrairCodigoPareamento(link)}"`);
  }
});

test('R21-1-03: CONTROLES — os formatos de sempre seguem entrando (a tela, o rótulo, o traço de aplicativo, frase sem espaço depois do ponto)', () => {
  const m = montarColar();
  const casos = [
    ['ABC-234', 'ABC-234'], ['ABC234', 'ABC-234'], [' ABC-234', 'ABC-234'], ['Código: ABC-234', 'ABC-234'], ['Código: 6C4–97S', '6C4-97S'],
    ['Seu codigo: 6C497S', '6C4-97S'], ['Entrar HXKTPW', 'HXK-TPW'], ['HXKTPW expira em 4:59', 'HXK-TPW'],
    ['ABC-234.Vale por 5 min', 'ABC-234'], ['Código:6C497S.Expira', '6C4-97S'], ['ABC 234', 'ABC-234'],
  ];
  const errados = casos.filter(([t, e]) => colando(m, t).campo !== e).map(([t, e]) => `${JSON.stringify(t)} → ${JSON.stringify(colando(m, t).campo)} (esperado ${e})`);
  assert.deepEqual(errados, [], 'um formato que já entrava deixou de entrar');
});

test('R21-1-03: `extrairSegredoDoLinkDePareamento` — o segredo do link (#pair= ou a ?pair= antiga), maiúsculo, só com 20 símbolos', () => {
  const { extrairSegredoDoLinkDePareamento: extrai } = montarColar();
  const S = 'U5P25D77X9W2BGW78UPR';
  assert.equal(extrai(`${PRODUCAO}/#pair=${S}`), S);
  assert.equal(extrai(`http://localhost:8080/#pair=${S}`), S, 'o host não importa');
  assert.equal(extrai(`${PRODUCAO}/?pair=${S}`), S, 'a query antiga (link que ficou no histórico)');
  assert.equal(extrai(`${PRODUCAO}/?x=1&pair=${S}&y=2`), S);
  assert.equal(extrai(`veja (${PRODUCAO}/#pair=${S}), obrigado`), S, 'pontuação em volta');
  assert.equal(extrai(`${PRODUCAO}/#pair=${S.toLowerCase()}`), S, 'um aplicativo que baixou a caixa do link');
  assert.equal(extrai(`${PRODUCAO}/#pair=${S}\n`), S);
  // O que NÃO é o segredo:
  assert.equal(extrai(`${PRODUCAO}/#pair=${S}X`), null, '21 símbolos');
  assert.equal(extrai(`${PRODUCAO}/#pair=${S.slice(1)}`), null, '19 símbolos');
  assert.equal(extrai(S), null, 'o segredo sem o link não é rótulo nenhum');
  assert.equal(extrai(`${PRODUCAO}/#repair=${S}`), null, 'outro parâmetro que termina em "pair"');
  assert.equal(extrai('Código: ABC-234'), null);
  assert.equal(extrai(''), null);
  assert.equal(extrai(undefined), null);
});

test('R21-1-03: o link colado ENTRA — o resgate sai com o segredo, o campo fica como estava e o colar do navegador é impedido', () => {
  const resgates = [];
  const m = montarColar({ resgatarPareamento: (c) => { resgates.push(c); return Promise.resolve(true); } });
  const S = 'U5P25D77X9W2BGW78UPR';
  for (const antes of ['', 'XY']) {
    resgates.length = 0;
    const r = colando(m, `${PRODUCAO}/#pair=${S}`, antes);
    assert.deepEqual(resgates, [S], `DEFEITO: o link colado não foi resgatado (campo "${r.campo}")`);
    assert.equal(r.impedido, true, 'o colar do navegador não foi impedido: o link entraria no campo');
    assert.equal(r.campo, antes, `DEFEITO: o campo virou "${r.campo}" (o lixo que parece código)`);
  }
  // CONTROLES: o código curto, de dentro de uma mensagem com link, ENTRA NO CAMPO e não resgata sozinho.
  resgates.length = 0;
  const c = colando(m, `Código: KMQ-XRT ${PRODUCAO}`);
  assert.deepEqual([c.campo, resgates.length], ['KMQ-XRT', 0], 'o código com o host junto não entrou no campo (ou resgatou sozinho)');
  // E o texto que não é nenhum dos dois segue o colar do navegador.
  const outro = colando(m, 'olá');
  assert.deepEqual([outro.impedido, resgates.length], [false, 0]);
});

test('R21-1-03: o que o app MOSTRA e o que o campo ACEITA — o link que o "Copiar link" copia, colado no campo, resgata no servidor', async () => {
  const { dispatch } = await import('../server/core.mjs');
  const { sessaoDeTeste } = await import('./_sessao.mjs');
  const s = await sessaoDeTeste(COOKIES_WAZE);
  const criado = await dispatch('parear', { action: 'create', ...s.dados }, s.ctx);
  assert.equal(criado.status, 200);
  // O texto que o app põe na área de transferência: a função DE VERDADE.
  let copiado = null;
  const copiar = montar(['copiarLinkPareamento'], {
    document: { getElementById: () => ({ dataset: { raw: criado.body.code } }) }, pairQrVenceEm: Infinity, aoVencerQrPareamento() {},
    location: { origin: PRODUCAO }, navigator: { clipboard: { writeText: async (u) => { copiado = u; } } }, showToast() {}, t: (k) => k, TOAST_COPIAVEL_MS: 1,
  });
  await copiar.copiarLinkPareamento();
  assert.ok(copiado && copiado.startsWith(PRODUCAO), 'CONTROLE: o "Copiar link" não copiou o link');
  // Colado no campo do código: o segredo chega ao resgate...
  const resgates = [];
  const m = montarColar({ resgatarPareamento: (c) => { resgates.push(c); return Promise.resolve(true); } });
  const r = colando(m, copiado);
  assert.equal(r.campo, '', `DEFEITO: o link copiado virou "${r.campo}" no campo do código`);
  assert.equal(resgates.length, 1, 'o link copiado não foi resgatado');
  // ... e é o que o servidor ACEITA.
  const claim = await dispatch('parear', { action: 'claim', code: resgates[0] }, s.ctx);
  assert.equal(claim.status, 200, 'o segredo tirado do link copiado não resgata no servidor: ' + JSON.stringify(claim.body));
  assert.equal(claim.body.success, true);
  // O código curto (6 símbolos, "Sem câmera?") faz o mesmo caminho pelo que a TELA mostra.
  const curto = await dispatch('parear', { action: 'create', ...s.dados, comCodigo: true }, s.ctx);
  const mostrado = m.formatarCodigoPareamento(curto.body.code);
  const colado = colando(m, `Código: ${mostrado} ${PRODUCAO}`);
  assert.equal(colado.campo, mostrado, 'o código que a tela mostra, colado com o host, não entrou como a tela o mostra');
  const claimCurto = await dispatch('parear', { action: 'claim', code: colado.campo }, s.ctx);
  assert.equal(claimCurto.body.success, true, 'o código do campo (com o hífen) não resgata no servidor');
});

// ═══ R21-1-04 / R21-2-06 · contagem guardada que não é número ═══════════════════════════════════════════
// O lote 24 pôs o `numero()` no `read`/`rejected`/`_total` do `recordHistory`, mas o contador por lugar
// (`onde`), o placar guardado e o que o `getHistoryStats` lê ficaram de fora: texto no contador virava NaN
// (e gravava `null`), `[1]` somava como "11", e a aba Histórico mostrava "0x · 07", "a · 2" e "faltam NaN pra …".
// Só por armazenamento editado à mão — a mesma classe do R20-7-02.
const HOJE = '2026-10-14';
function historicoDe(texto) {
  const guardado = new Map(texto === undefined ? [] : [['waze_places_history', texto]]);
  const AppState = { history: null };
  const deps = {
    AppState, HISTORY_KEY: 'waze_places_history', HISTORY_MAX_DIAS: 400,
    localStorage: { getItem: (k) => (guardado.has(k) ? guardado.get(k) : null), setItem: (k, v) => guardado.set(k, v) },
    historyTodayKey: () => HOJE, ondeAgora: () => '30', contaAgora: () => null, agendarRedesenhoDoHistorico() {},
    garantirLinhaDeBaseDasConquistas() {}, textoDaCopia: new WeakMap(),
  };
  const h = montar(['copiaEmDia', 'lembrarTextoDaCopia', 'loadHistory', 'podarHistorico', 'salvarHistorico', 'recordHistory', 'getHistoryStats',
    'diasEntreChaves'], deps);
  return { h, deps, AppState, guardado, salvo: () => JSON.parse(guardado.get('waze_places_history')) };
}
const diaAtras = (n) => { const [a, m, d] = HOJE.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d - n)).toISOString().slice(0, 10); };

test('R21-1-04: o contador por lugar (`onde`) com texto, objeto ou lista não vira NaN nem concatena — e o número de verdade segue somando', () => {
  const casos = [['texto', 'texto', 1], ['objeto', { a: 1 }, 1], ['"NaN"', 'NaN', 1], ['lista [1]', [1], 1], ['null', null, 1],
    ['CONTROLE número 3', 3, 4], ['CONTROLE zero', 0, 1]];
  for (const [nome, valor, esperado] of casos) {
    const m = historicoDe(JSON.stringify({ _total: { read: 0, rejected: 0 }, [HOJE]: { read: 0, rejected: 0, onde: { 30: valor, 73: 5 } } }));
    assert.doesNotThrow(() => m.h.recordHistory('read', 1, undefined, '30'), `${nome}: lançou`);
    const emMemoria = m.AppState.history[HOJE].onde['30'];
    assert.ok(Number.isFinite(emMemoria), `DEFEITO (${nome}): o contador por lugar virou ${emMemoria} em memória`);
    assert.equal(m.salvo()[HOJE].onde['30'], esperado, `DEFEITO (${nome}): gravou ${JSON.stringify(m.salvo()[HOJE].onde['30'])}`);
    assert.equal(m.salvo()[HOJE].onde['73'], 5, `${nome}: o contador de OUTRO lugar mudou`);
  }
});

function placarDe(texto) {
  const dados = new Map(texto === undefined ? [] : [['waze_places_stats', texto]]);
  return montar(['placarGuardado'], { STATS_KEY: 'waze_places_stats',
    localStorage: { getItem: (k) => (dados.has(k) ? dados.get(k) : null) } }).placarGuardado;
}

test('R21-2-06: o placar guardado com texto, lista ou objeto no contador vale 0 (não "Lidos NaN"), e o texto de DÍGITOS segue sendo número', () => {
  const casos = [
    ['{"read":"x","rejected":[],"skipped":{}}', { read: 0, rejected: 0, skipped: 0 }],
    ['{"read":"7","rejected":null}', { read: 7, rejected: 0, skipped: 0 }],
    ['{"read":-5,"rejected":2,"skipped":"12"}', { read: 0, rejected: 2, skipped: 12 }],
    ['{"read":"1e3","rejected":"0x10","skipped":"  4"}', { read: 0, rejected: 0, skipped: 0 }],
    ['{"read":3,"rejected":2,"skipped":1}', { read: 3, rejected: 2, skipped: 1 }],       // CONTROLE
    ['{"read":"007","rejected":"","skipped":true}', { read: 7, rejected: 0, skipped: 0 }],
  ];
  for (const [texto, esperado] of casos) assert.deepEqual(placarDe(texto)(), esperado, `DEFEITO: ${texto}`);
  assert.equal(placarDe(undefined)(), null, 'CONTROLE: aparelho sem placar devolve null');
  assert.equal(placarDe('não é json')(), null, 'CONTROLE: JSON quebrado devolve null');
  // O ✓ seguinte soma em cima de um NÚMERO: "7" + um ✓ são 8 (e o lixo + um ✓ é 1, não NaN).
  const lixo = placarDe('{"read":"x"}')(); lixo.read++;
  assert.equal(lixo.read, 1, 'o ✓ sobre o contador com texto deu NaN');
  const digitos = placarDe('{"read":"7"}')(); digitos.read++;
  assert.equal(digitos.read, 8, 'CONTROLE: o texto de dígitos deixou de valer como número');
});

test('R21-2-06: as estatísticas do Histórico leem só número — texto, HTML e objeto valem 0 (não "0x · 07", não "faltam NaN")', () => {
  const lixo = historicoDe(JSON.stringify({ [diaAtras(1)]: { read: 'x', rejected: '7' }, _total: { read: 'a', rejected: 2 } }));
  const s = lixo.h.getHistoryStats();
  assert.deepEqual(s.total, { read: 0, rejected: 2 }, 'DEFEITO: o total somou texto');
  assert.deepEqual([s.week, s.month], [{ read: 0, rejected: 0 }, { read: 0, rejected: 0 }], 'DEFEITO: o balde com texto somou como texto');
  const html = historicoDe(JSON.stringify({ [diaAtras(1)]: { read: 1, rejected: 1 }, _total: { read: '<img src=x alt=bad>', rejected: { a: 1 } } }));
  assert.deepEqual(html.h.getHistoryStats().total, { read: 0, rejected: 0 }, 'DEFEITO: o HTML do campo chegou ao painel');
  const tudo = JSON.stringify(html.h.getHistoryStats());
  assert.ok(!/NaN|<img|\[object/.test(tudo), 'sobrou NaN, HTML ou objeto nas estatísticas: ' + tudo);
  // CONTROLE: o histórico limpo (o da conta que só usa o app) mostra "3 · 2" e "10 · 4".
  const limpo = historicoDe(JSON.stringify({ [diaAtras(1)]: { read: 3, rejected: 2 }, _total: { read: 10, rejected: 4 } }));
  const c = limpo.h.getHistoryStats();
  assert.deepEqual([c.week, c.month, c.total], [{ read: 3, rejected: 2 }, { read: 3, rejected: 2 }, { read: 10, rejected: 4 }], 'CONTROLE: o histórico limpo mudou');
});

test('R21-2-06: o painel do Histórico escreve os números ESCAPADOS (um campo com HTML não vira elemento), e o limpo sai igual', () => {
  const escrever = (stats) => {
    const el = { innerHTML: '', dataset: {}, insertAdjacentHTML() {}, appendChild() {}, contains: () => false };
    const m = montar(['renderHistory', 'escapeHtml'], {
      document: { getElementById: (id) => (id === 'historyBody' ? el : null), activeElement: null, body: {} },
      getHistoryStats: () => stats, chaveDoFoco: () => null, renderAutores() {}, devolverFocoAoPainel() {}, htmlPatente: () => '', htmlConquistas: () => '',
      dadosDoResumo: () => ({ total: 0 }), loadHistory: () => ({}), ligarConquistas() {}, i18nLocale: () => 'pt-BR', t: (k) => k });
    m.renderHistory();
    return el.innerHTML;
  };
  const par = (r, j) => ({ read: r, rejected: j });
  const sujo = escrever({ today: par('<img src=x onerror=alert(1)>', '<b>x</b>'), week: par(1, 1), month: par(1, 1), total: par(2, 2) });
  assert.ok(!/<img|<b>/.test(sujo), 'DEFEITO: o campo do Histórico virou elemento no painel: ' + sujo.slice(0, 200));
  assert.ok(sujo.includes('&lt;img'), 'o campo não saiu escapado');
  const limpo = escrever({ today: par(0, 0), week: par(3, 2), month: par(3, 2), total: par(10, 4) });
  assert.match(limpo, /<span class="text-emerald-700 dark:text-emerald-400">3<\/span> · <span class="text-rose-600 dark:text-rose-400">2<\/span>/, 'CONTROLE: a linha "3 · 2" mudou');
  assert.match(limpo, /<span class="text-emerald-700 dark:text-emerald-400">10<\/span> · <span class="text-rose-600 dark:text-rose-400">4<\/span>/, 'CONTROLE: a linha "10 · 4" mudou');
});
