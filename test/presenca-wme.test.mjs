// A presença no mapa do WME, do lado da app (fase 2): a posição do card vai de
// carona na ação, com freio, e a visibilidade liga sozinha — respeitando quem
// desligou, inclusive pelo próprio WME.
//
// Mesmo padrão de `guardar-pedido.test.mjs`: o app.js é script de browser, então
// o teste FATIA a fonte e roda a função de verdade num escopo de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const API_JS = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');

// Âncora em DECLARAÇÃO, nunca em distância (gotcha #67).
function fatiarFuncao(fonte, nome) {
  const ini = fonte.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu`);
  const resto = fonte.slice(ini + 1);
  const fim = resto.search(/\n(?:function |async function |const |let |\/\/ ──)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return fonte.slice(ini, ini + 1 + fim);
}
// Só código: comentário que CITA um nome não pode satisfazer um guard (#67).
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function montar(nome, escopo) {
  const nomes = Object.keys(escopo);
  return new Function(...nomes, fatiarFuncao(APP, nome) + `\nreturn ${nome};`)(...nomes.map((n) => escopo[n]));
}

const CARD = { venueID: 'v1', updateRequestID: 'ur1', mapa: { centro: [-12.597498, -39.511208] } };
const PROXIMO = { venueID: 'v2', updateRequestID: 'ur2', mapa: { centro: [-22.9, -43.2] } };

function escopoDaAcao(sobre = {}) {
  const presencaWme = { ligarNaProxima: false, ultimaEm: 0, enviadas: 0, falhas: 0, ultimaFalha: null, marcaPerdida: false, ...(sobre.presencaWme || {}) };
  return {
    presencaWme,
    PRESENCA_WME_FREIO_MS: 30000,
    Treino: { ativo: false, ...(sobre.Treino || {}) },
    presencaLigada: () => (sobre.ligada ?? true),
    AppState: {
      authenticated: true,
      profile: { id: 12444348 },
      currentPlace: PROXIMO,
      preferences: {},
      ...(sobre.AppState || {}),
    },
    API: { getCountry: () => 30 },
    navigator: { onLine: sobre.onLine ?? true },
    Date: sobre.Date || Date,
    // A presença da app (fase 3): quais conversas o aparelho conhece.
    window: { Presenca: { conhecidos: () => (sobre.conhecidos ?? []) } },
  };
}

test('ação: a posição é a do card NA TELA, [lat, lon] na ordem certa, com o país da fila', () => {
  const e = escopoDaAcao();
  const p = montar('presencaWmeDaAcao', e)(CARD);
  assert.deepEqual(p, { userId: '12444348', lat: -22.9, lon: -43.2, pais: 30 });
  // Contraprova da ordem: com o centro invertido o lat viraria -43.2 — e -43.2
  // é uma latitude VÁLIDA, então nada reclamaria. É o defeito sem sintoma.
  assert.notEqual(p.lat, PROXIMO.mapa.centro[1]);
});

test('ação: as conversas que o aparelho conhece vão JUNTO — e só quando existem', () => {
  // Fase 3: a lista de conversas volta de carona, e ela só inclui as que foram
  // respondidas pelo WME (sem a marca da app) se o aparelho disser quais conhece.
  const com = montar('presencaWmeDaAcao', escopoDaAcao({ conhecidos: ['183164343', '600'] }))(CARD);
  assert.deepEqual(com.conhecidos, ['183164343', '600']);
  const sem = montar('presencaWmeDaAcao', escopoDaAcao({ conhecidos: [] }))(CARD);
  assert.ok(!('conhecidos' in sem), 'lista vazia foi junto: bytes à toa em toda ação');
  // Presença ausente (script ainda não carregou) não derruba a carona.
  const e = escopoDaAcao();
  e.window = {};
  assert.ok(montar('presencaWmeDaAcao', e)(CARD), 'sem a presença carregada a posição sumiu');
});

test('ação: sem card na tela (fila acabou), a posição é a do pedido decidido', () => {
  const e = escopoDaAcao({ AppState: { currentPlace: null } });
  const p = montar('presencaWmeDaAcao', e)(CARD);
  assert.equal(p.lat, -12.597498);
  assert.equal(p.lon, -39.511208);
});

test('ação: FREIO de 30 s — a segunda ação logo em seguida vai sem posição', () => {
  let agora = 1_000_000;
  const RelogioFalso = { now: () => agora };
  const e = escopoDaAcao({ Date: RelogioFalso });
  const f = montar('presencaWmeDaAcao', e);
  assert.ok(f(CARD), 'a primeira ação devia levar posição');
  agora += 29_999;
  assert.equal(f(CARD), null, 'passou pelo freio antes dos 30 s');
  agora += 1;
  assert.ok(f(CARD), 'o freio não soltou depois dos 30 s');
});

test('ação: pedido de ligar vai junto (visivel: true) quando o perfil mandou ligar', () => {
  const e = escopoDaAcao({ presencaWme: { ligarNaProxima: true } });
  assert.equal(montar('presencaWmeDaAcao', e)(CARD).visivel, true);
  const sem = escopoDaAcao();
  assert.ok(!('visivel' in montar('presencaWmeDaAcao', sem)(CARD)), 'mandou ligar sem ninguém pedir');
});

test('ação: SEM posição no treino, desligada, deslogada, sem rede, sem id e sem coordenada', () => {
  const casos = [
    ['treino', { Treino: { ativo: true } }],
    ['presença desligada', { ligada: false }],
    ['deslogada', { AppState: { authenticated: false } }],
    ['sem rede', { onLine: false }],
    ['sem perfil', { AppState: { profile: null } }],
    ['id que não é do Waze', { AppState: { profile: { id: '12a' } } }],
    ['card sem mapa', { AppState: { currentPlace: { venueID: 'x' } } }],
    ['centro não numérico', { AppState: { currentPlace: { mapa: { centro: ['a', 'b'] } } } }],
  ];
  for (const [nome, sobre] of casos) {
    const e = escopoDaAcao(sobre);
    assert.equal(montar('presencaWmeDaAcao', e)(CARD), null, nome);
    assert.equal(e.presencaWme.ultimaEm, 0, `${nome}: gastou o freio sem mandar nada`);
  }
});

test('ação: NUNCA lança — erro no cálculo vira "sem posição", e a ação segue', () => {
  const e = escopoDaAcao();
  Object.defineProperty(e.AppState, 'profile', { get() { throw new Error('boom'); } });
  assert.equal(montar('presencaWmeDaAcao', e)(CARD), null);
});

test('ação: a posição é montada DENTRO do executor (na hora do envio), e vai como 3º argumento', () => {
  for (const [handler, metodo] of [['handleMarkAsRead', 'markAsRead'], ['handleReject', 'rejectPlace']]) {
    const corpo = semComentario(fatiarFuncao(APP, handler));
    const exec = corpo.slice(corpo.indexOf('scheduleAction('));
    assert.ok(exec.length > 50, `${handler}: não achei o executor`);
    assert.match(exec, /const presenca = presencaWmeDaAcao\(place\);/, `${handler}: a posição não é montada no envio`);
    assert.match(exec, new RegExp(`API\\.${metodo}\\(place\\.venueID, place\\.updateRequestID, presenca\\)`),
      `${handler}: a posição não vai na ação`);
    const iResp = exec.indexOf('presencaWmeAoResponder(presenca, result)');
    const iAcao = exec.indexOf('handleActionResult(');
    assert.ok(iResp > 0 && iResp < iAcao, `${handler}: a resposta da presença tem que ser lida antes do resultado da ação`);
    // Antes do scheduleAction (no GESTO) não pode haver presença: ela seria a
    // do card de 3 s atrás, e iria pra fila de saída junto se a rede caísse.
    const gesto = corpo.slice(0, corpo.indexOf('scheduleAction('));
    assert.doesNotMatch(gesto, /presencaWme/, `${handler}: montou a posição no gesto`);
  }
});

test('ação: fila de saída, lote e lote de lidos NUNCA levam posição', () => {
  for (const nome of ['esvaziarFilaDeSaida', 'enviarLote']) {
    const corpo = semComentario(fatiarFuncao(APP, nome));
    const chamadas = corpo.match(/API\.(markAsRead|rejectPlace)\([^)]*\)/g) || [];
    assert.ok(chamadas.length > 0, `${nome}: não achei a chamada da ação (o guard ficaria cego)`);
    for (const c of chamadas) {
      assert.equal(c.split(',').length, 2, `${nome}: a ação leva mais que os dois ids — ${c}`);
    }
    assert.doesNotMatch(corpo, /presencaWme/, `${nome}: mexe na presença`);
  }
  assert.doesNotMatch(semComentario(API_JS.slice(API_JS.indexOf('async markAsReadBatch('), API_JS.indexOf('async guardarPedido('))),
    /presenca/, 'o lote de lidos passou a levar presença');
});

test('resposta: ligou de carona → "já vista ligada" gravada; marca perdida → UM aviso no diário', () => {
  const salvos = [];
  const fatos = [];
  const presencaWme = { ligarNaProxima: true, ultimaEm: 1, enviadas: 0, falhas: 0, ultimaFalha: null, marcaPerdida: false };
  const escopo = { presencaWme, AppState: { preferences: {} }, savePreferences: () => salvos.push(1), dfato: (k) => fatos.push(k) };
  const f = montar('presencaWmeAoResponder', escopo);
  // "Não sei" (eco sem posição) PRIMEIRO, com o aviso ainda não disparado: depois
  // do primeiro aviso ele não repete, e o caso ficaria cego (a sabotagem passou).
  f({}, { presenca: { ok: true, marca: null } });
  assert.equal(fatos.length, 0, '"não sei" (eco sem posição) virou "perdeu a marca"');
  f({ visivel: true }, { success: true, presenca: { ok: true, marca: true } });
  assert.equal(escopo.AppState.preferences.presencaWmeVisto, true);
  assert.equal(presencaWme.ligarNaProxima, false);
  assert.equal(salvos.length, 1);
  f({}, { presenca: { ok: true, marca: false } });
  f({}, { presenca: { ok: true, marca: false } });
  assert.deepEqual(fatos, ['presencaWme.marcaPerdida'], 'o aviso da marca perdida repetiu (ou não saiu)');
  f({}, { presenca: { ok: false, categoria: 'unauthorized' } });
  assert.equal(presencaWme.falhas, 1);
  assert.equal(presencaWme.ultimaFalha, 'unauthorized');
  assert.equal(presencaWme.enviadas, 4, 'as quatro escritas aceitas (ligar, duas sem marca e uma sem eco)');
  // Sem presença na ação, ou resposta sem o campo (servidor antigo): nada muda.
  f(null, { presenca: { ok: true } });
  f({}, { success: true });
  assert.equal(presencaWme.enviadas, 4);
  // Ligar que FALHOU segue pedindo pra ligar.
  const p2 = { ligarNaProxima: true, ultimaEm: 1, enviadas: 0, falhas: 0, ultimaFalha: null, marcaPerdida: false };
  montar('presencaWmeAoResponder', { ...escopo, presencaWme: p2 })({ visivel: true }, { presenca: { ok: false, categoria: 'transient' } });
  assert.equal(p2.ligarNaProxima, true);
});

test('resposta: a lista da app que voltou de carona vai pra presença, com o instante da SAÍDA', () => {
  // O instante é o de quando a carona saiu (`ultimaEm`): mensagem que chegou ao
  // vivo DEPOIS disso a lista ainda não contou, e a presença não pode apagá-la.
  const chamadas = [];
  const presencaWme = { ligarNaProxima: false, ultimaEm: 12345, enviadas: 0, falhas: 0, ultimaFalha: null, marcaPerdida: false };
  const escopo = {
    presencaWme, AppState: { preferences: {} }, savePreferences: () => {}, dfato: () => {},
    window: { Presenca: { aoCarona: (...a) => chamadas.push(a) } },
  };
  const f = montar('presencaWmeAoResponder', escopo);
  const lista = { online: [{ id: '1', nome: 'x' }], conversas: [] };
  f({ userId: '1' }, { success: true, presenca: { ok: true, marca: true }, presencaApp: lista });
  assert.deepEqual(chamadas, [[lista, 12345]]);
  assert.equal(presencaWme.enviadas, 1, 'a escrita deixou de ser contada');
  // Sem carona na ação, uma lista na resposta não é desta ação: não pousa.
  f(null, { success: true, presencaApp: lista });
  // A escrita falhou mas a lista veio: ela pousa assim mesmo.
  f({ userId: '1' }, { success: true, presenca: { ok: false, categoria: 'transient' }, presencaApp: lista });
  assert.equal(chamadas.length, 2);
  // Presença ainda não carregada: nada quebra.
  montar('presencaWmeAoResponder', { ...escopo, window: {} })({ userId: '1' }, { presencaApp: lista, presenca: { ok: true } });
});

function rodarPerfil(visivel, preferences) {
  const salvos = [];
  const fatos = [];
  const sincronizou = [];
  const presencaWme = { ligarNaProxima: false };
  const chk = { checked: true };
  const escopo = {
    AppState: { preferences },
    presencaWme,
    savePreferences: () => salvos.push({ ...preferences }),
    dfato: (k) => fatos.push(k),
    document: { getElementById: (id) => (id === 'prefPresenca' ? chk : null) },
    window: { Presenca: { sincronizar: () => sincronizou.push(1) } },
    Date: { now: () => 1_700_000_000_000 },
  };
  montar('presencaWmeAoCarregarPerfil', escopo)(visivel);
  return { preferences, presencaWme, salvos, fatos, sincronizou, chk };
}

test('perfil: visível no WME → a app anota que JÁ VIU ligada, e não pede pra ligar', () => {
  const r = rodarPerfil(true, { presenca: true });
  assert.equal(r.preferences.presencaWmeVisto, true);
  assert.equal(r.presencaWme.ligarNaProxima, false);
  assert.equal(r.salvos.length, 1);
});

test('perfil: desligada e NUNCA vista ligada → liga sozinha, de carona na próxima ação, sem aviso', () => {
  const r = rodarPerfil(false, { presenca: true });
  assert.equal(r.presencaWme.ligarNaProxima, true);
  assert.equal(r.preferences.presenca, true, 'desligou o toggle de quem nunca desligou nada');
  assert.equal(r.fatos.length, 0);
});

test('perfil: desligada DEPOIS de vista ligada → foi a pessoa, fora da app: conta como desligar (9 dias)', () => {
  const r = rodarPerfil(false, { presenca: true, presencaWmeVisto: true });
  assert.equal(r.preferences.presenca, false, 'religou quem se escondeu pelo WME');
  assert.equal(r.preferences.presencaOffEm, 1_700_000_000_000, 'sem o carimbo, a anistia de 9 dias nunca conta');
  assert.ok(!('presencaWmeVisto' in r.preferences));
  assert.equal(r.presencaWme.ligarNaProxima, false);
  assert.equal(r.chk.checked, false, 'o interruptor da tela ficou mentindo "ligado"');
  assert.equal(r.sincronizou.length, 1, 'a sala da app não soube que a pessoa desligou');
  assert.deepEqual(r.fatos, ['presencaWme.desligadaFora']);
});

test('perfil: com a presença DESLIGADA na app, nada muda; e sem o campo (servidor antigo), nada se decide', () => {
  for (const v of [true, false]) {
    const r = rodarPerfil(v, { presenca: false, presencaOffEm: 5 });
    assert.equal(r.presencaWme.ligarNaProxima, false);
    assert.equal(r.preferences.presencaOffEm, 5, 'mexeu no carimbo da anistia');
    assert.equal(r.salvos.length, 0);
  }
  for (const v of [null, undefined, 'false', 0]) {
    const r = rodarPerfil(v, { presenca: true, presencaWmeVisto: true });
    assert.equal(r.preferences.presenca, true, `${v}: desligou por ausência de dado`);
    assert.equal(r.presencaWme.ligarNaProxima, false);
  }
});

test('toggle: desligar some do WME NA HORA (visivel:false) e esquece o "já vista"; religar pede ligar sem freio', async () => {
  const pedidos = [];
  const presencaWme = { ligarNaProxima: true, ultimaEm: 99 };
  const prefs = { presencaWmeVisto: true };
  const escopo = {
    presencaWme, AppState: { preferences: prefs, profile: { id: 12444348 } },
    API: { getSession: () => 'tok', presencaWaze: async (c) => { pedidos.push(c); return { success: true }; } },
  };
  montar('presencaWmeDesligar', escopo)();
  assert.deepEqual(pedidos, [{ userId: '12444348', visivel: false }]);
  assert.ok(!('presencaWmeVisto' in prefs));
  assert.equal(presencaWme.ligarNaProxima, false);
  montar('presencaWmeReligar', escopo)();
  assert.equal(presencaWme.ligarNaProxima, true);
  assert.equal(presencaWme.ultimaEm, 0, 'quem religou esperaria o freio pra aparecer');
  // Sem sessão não há o que desligar no Waze (e nada lança).
  const semSessao = { ...escopo, API: { getSession: () => null, presencaWaze: () => assert.fail('chamou sem sessão') } };
  montar('presencaWmeDesligar', semSessao)();
});

test('toggle: o interruptor chama desligar/religar ANTES de gravar as preferências', () => {
  const ini = APP.indexOf("$('prefPresenca').addEventListener('change'");
  assert.ok(ini > 0, 'o ouvinte do interruptor sumiu');
  const corpo = semComentario(APP.slice(ini, APP.indexOf('});', ini)));
  const iRel = corpo.indexOf('presencaWmeReligar();');
  const iDes = corpo.indexOf('presencaWmeDesligar();');
  const iSalvar = corpo.indexOf('savePreferences();');
  assert.ok(iRel > 0 && iDes > 0, 'o interruptor não fala com a presença do WME');
  assert.ok(iRel < iSalvar && iDes < iSalvar, 'o "já vista" seria gravado antes de ser esquecido');
});

test('perfil e sair: o perfil decide a visibilidade; o "Sair" zera o freio e os contadores', () => {
  const perfil = semComentario(fatiarFuncao(APP, 'loadProfileAndAuxData'));
  assert.match(perfil, /presencaWmeAoCarregarPerfil\(profileRes\.visivelNoWme\)/);
  const sair = semComentario(fatiarFuncao(APP, 'handleLogout'));
  assert.match(sair, /presencaWmeZerar\(\);/, 'o "Sair" deixa o freio de quem saiu pra quem entra');
  const carga = APP.match(/if \(parsed\.presencaWmeVisto[^;]*;/);
  assert.ok(carga, 'o "já vista" não é carregado das preferências');
  assert.match(carga[0], /=== true/, 'a carga do "já vista" virou coerção');
});

test('api.js: a presença vai no corpo SÓ quando existe — sem ela o corpo é o de sempre', () => {
  for (const metodo of ['markAsRead', 'rejectPlace']) {
    const ini = API_JS.indexOf(`async ${metodo}(`);
    assert.ok(ini > 0, metodo);
    const corpo = API_JS.slice(ini, API_JS.indexOf('\n    },', ini));
    assert.match(corpo, new RegExp(`async ${metodo}\\(venueID, updateRequestID, presenca\\)`));
    assert.match(corpo, /\.\.\.\(presenca \? \{ presenca \} : \{\}\)/, `${metodo}: a presença vai sempre (ou nunca)`);
  }
  const pw = API_JS.slice(API_JS.indexOf('async presencaWaze('), API_JS.indexOf('async presenca(peer'));
  assert.match(pw, /this\._post\('presenca-waze'/);
});
