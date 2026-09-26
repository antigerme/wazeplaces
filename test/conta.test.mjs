// DE QUEM é o que está no aparelho (auditoria de 2026-09-25).
//
// Depois de uma QUEDA de sessão (sem o "Sair"), outra pessoa pode entrar no
// mesmo aparelho. A fila de saída guardava as decisões de quem estava — e elas
// iam pro Waze no nome de quem entrou —, e a lista de autores com a recusa
// automática, o placar, o Histórico, as conversas e a fila do offline ficavam.
// Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const SEM = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = SEM.indexOf('(', m.index);
  for (let j = i; j < SEM.length; j++) {
    if (SEM[j] === '(') par++;
    else if (SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = SEM.indexOf('{', i); j < SEM.length; j++) {
    if (SEM[j] === '{') prof++;
    else if (SEM[j] === '}' && --prof === 0) return SEM.slice(m.index, j + 1);
  }
  throw new Error('não fechou: ' + nome);
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

function montar({ perfil = null, token = 'tok-B' } = {}) {
  const guardado = new Map();
  const log = [];
  const safeLS = {
    get: (k) => (guardado.has(k) ? guardado.get(k) : null),
    set: (k, v) => guardado.set(k, String(v)),
    remove: (k) => { log.push('-' + k); guardado.delete(k); },
  };
  const AppState = { profile: perfil, stats: { read: 3, rejected: 5, skipped: 0 }, history: {}, conquistas: {}, authenticated: true };
  const sessao = { token };
  const deps = {
    safeLS, AppState,
    API: { getSession: () => sessao.token, getRegion: () => 'row' },
    CONTA_KEY: constante('CONTA_KEY'), SAIDA_KEY: constante('SAIDA_KEY'), SAIDA_MAX: constante('SAIDA_MAX'),
    HISTORY_KEY: constante('HISTORY_KEY'), CONQUISTAS_KEY: constante('CONQUISTAS_KEY'),
    dfato: (k) => log.push('dfato:' + k),
    updateInFlightIndicator: () => {}, historyTodayKey: () => '2026-09-25', ondeAgora: () => '30',
    esquecerAutores: () => log.push('autores'), atualizarSeloDeConquista: () => {},
    esquecerFocoAutor: () => log.push('foco'),
    saveStats: () => log.push('saveStats'), updateStats: () => {},
    offlineEsquecer: () => log.push('offline'), dlogApagar: () => log.push('dlog'),
    showToast: (m) => log.push('toast:' + m), t: (k) => k,
    window: { Presenca: { esquecer: () => log.push('chat') } },
    esvaziarFilaDeSaida: () => log.push('esvaziar'),
    esquecerFocoAutor: () => log.push('foco'),
  };
  const nomes = ['marcaDaSessao', 'contaAgora', 'aoConhecerConta', 'esquecerOutraConta', 'carimbarContaNaSaida',
    'adotarSaidaSemMarca', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido', 'enfileirarSaida'];
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let saidaEsperandoConta = false;\n${nomes.map(fatiar).join('\n')}
    return { ${nomes.join(', ')}, esperando: () => saidaEsperandoConta, esperar: () => { saidaEsperandoConta = true; } };`)(
    ...chaves.map((k) => deps[k]));
  return { app, guardado, log, AppState, sessao, deps };
}
const P = (v, u) => ({ venueID: v, updateRequestID: u, creatorId: 9 });

test('a conta de agora: o perfil vivo; sem ele, a guardada SÓ se foi vista nesta sessão', () => {
  const m = montar({ perfil: { id: 111 } });
  assert.equal(m.app.contaAgora(), '111');
  // Perfil chegou: a conta fica guardada com a marca da sessão.
  m.app.aoConhecerConta({ id: 111 });
  m.AppState.profile = null;                        // reaberto sem rede, mesma sessão
  assert.equal(m.app.contaAgora(), '111', 'sem rede, a conta desta mesma sessão tem que valer');
  m.sessao.token = 'tok-OUTRA';                     // sessão nova, perfil ainda a caminho
  assert.equal(m.app.contaAgora(), null, 'a conta da sessão ANTERIOR valeu na sessão nova');
});

test('cada item da fila de saída leva a conta do gesto', () => {
  const m = montar({ perfil: { id: 111 } });
  m.app.enfileirarSaida('reject', P('v1', 'u1'));
  assert.equal(m.app.carregarFilaDeSaida()[0].conta, '111');
  // Sessão nova sem perfil: desconhecida (e é desta sessão).
  const n = montar({ perfil: null });
  n.app.enfileirarSaida('read', P('v2', 'u2'));
  assert.equal(n.app.carregarFilaDeSaida()[0].conta, null);
});

test('OUTRA conta entrou: o que era da anterior sai do aparelho — e o dela que esperava envio NÃO vai pro Waze', () => {
  const m = montar({ perfil: { id: 'A' }, token: 'tok-A' });
  m.app.aoConhecerConta({ id: 'A' });
  m.app.enfileirarSaida('reject', P('v1', 'u1'));   // decisão de A, esperando rede
  // A sessão de A cai; B entra no mesmo aparelho.
  m.AppState.profile = null;
  m.sessao.token = 'tok-B';
  m.app.enfileirarSaida('read', P('v2', 'u2'));     // B, antes de o perfil dele chegar
  m.AppState.profile = { id: 'B' };
  m.app.aoConhecerConta({ id: 'B' });
  const fila = m.app.carregarFilaDeSaida();
  assert.deepEqual(fila.map((x) => x.venueID), ['v2'], 'a decisão de A ficou pra sair no nome de B');
  for (const o of ['autores', 'foco', 'chat', 'offline', 'dlog', 'dfato:conta.trocou', 'toast:toast.outraConta']) {
    assert.ok(m.log.includes(o), `a troca de conta não levou: ${o}`);
  }
  assert.ok(m.log.includes('-waze_places_history') && m.log.includes('-waze_places_conquistas'));
  assert.deepEqual(m.AppState.stats, { read: 0, rejected: 0, skipped: 0 }, 'o placar de A ficou pra B');
  assert.equal(JSON.parse(m.guardado.get('waze_places_conta')).id, 'B');
  // Controle: a MESMA conta voltando (a sessão caiu e ela entrou de novo) não perde nada.
  const c = montar({ perfil: { id: 'A' }, token: 'tok-A' });
  c.app.aoConhecerConta({ id: 'A' });
  c.app.enfileirarSaida('reject', P('v1', 'u1'));
  c.sessao.token = 'tok-A2';
  c.app.aoConhecerConta({ id: 'A' });
  assert.equal(c.app.carregarFilaDeSaida().length, 1, 'a mesma conta perdeu a fila de saída');
  assert.ok(!c.log.includes('autores') && !c.log.includes('foco') && !c.log.includes('dfato:conta.trocou'));
});

test('o esvaziamento que parou esperando a conta é chamado quando o perfil chega', () => {
  const m = montar({ perfil: null });
  m.app.esperar();
  m.app.aoConhecerConta({ id: 'B' });
  assert.ok(m.log.includes('esvaziar'), 'a fila ficou parada esperando uma conta que já chegou');
  assert.equal(m.app.esperando(), false);
});

// ── o esvaziamento, rodado de verdade ────────────────────────────────────────
function drenar({ itens, perfil, token = 'tok-B', guardada = null }) {
  const guardado = new Map([['waze_places_saida', JSON.stringify(itens)]]);
  if (guardada) guardado.set('waze_places_conta', JSON.stringify(guardada));
  const enviados = [];
  const log = [];
  const AppState = { profile: perfil, authenticated: true, stats: { read: 1, rejected: 1, skipped: 0 } };
  const deps = {
    safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
    AppState, navigator: { onLine: true }, epocaDaSessao: 0,
    API: {
      getSession: () => token,
      markAsRead: async (v) => { enviados.push(v); return { success: true }; },
      rejectPlace: async (v) => { enviados.push(v); return { success: true }; },
    },
    CONTA_KEY: constante('CONTA_KEY'), SAIDA_KEY: constante('SAIDA_KEY'), SAIDA_RITMO_MS: 0,
    SAIDA_RECUO_401_MS: constante('SAIDA_RECUO_401_MS'),
    registrarPousoDeSaida: () => {}, handleUnauthorized: () => {}, updateInFlightIndicator: () => {},
    updateStats: () => {}, saveStats: () => log.push('saveStats'), dfato: (k) => log.push(k),
    showToast: () => {}, t: (k) => k, setTimeout: (f) => f(),
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let esvaziandoSaida = false, saidaPedidaDeNovo = false, saidaEsperandoConta = false;
    let sessaoVivaEm = { s: null, em: 0 }, saidaRecuo = { s: null, n: 0, ate: 0 };
    const pedidosEmAndamento = new Set();
    ${['marcaDaSessao', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido', 'marcarNaSaida', 'sessaoVivaDepoisDe',
       'recuarSaida', 'saidaEmRecuo', 'esvaziarFilaDeSaida'].map(fatiar).join('\n')}
    return { esvaziarFilaDeSaida, carregarFilaDeSaida, esperando: () => saidaEsperandoConta };`)(...chaves.map((k) => deps[k]));
  return { app, enviados, log, AppState, guardado };
}
const I = (v, conta, tipo = 'reject', marcaDoGesto) => ({ tipo, venueID: v, updateRequestID: 'u' + v, conta, regiao: 'row',
  ...(marcaDoGesto !== undefined ? { s: marcaDoGesto } : {}) });
const marcaDe = (token) => new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')()(token);

test('esvaziar: item de OUTRA conta não vai ao Waze, e o placar do gesto desce', async () => {
  const d = drenar({ itens: [I('v1', 'A'), I('v2', 'B')], perfil: { id: 'B' } });
  await d.app.esvaziarFilaDeSaida();
  assert.deepEqual(d.enviados, ['v2'], 'a decisão de A saiu no nome de B');
  assert.equal(d.app.carregarFilaDeSaida().length, 0);
  assert.equal(d.AppState.stats.rejected, 0, 'o placar do gesto que não saiu ficou');
  assert.ok(d.log.includes('saida.outraConta'));
});

test('esvaziar: conta ainda DESCONHECIDA (sessão nova, perfil a caminho) espera — nada sai', async () => {
  const d = drenar({ itens: [I('v1', 'A')], perfil: null, guardada: { id: 'A', s: 'outra-sessao' } });
  await d.app.esvaziarFilaDeSaida();
  assert.deepEqual(d.enviados, [], 'saiu sem saber de quem é a sessão');
  assert.equal(d.app.carregarFilaDeSaida().length, 1, 'a espera jogou o item fora');
  assert.equal(d.app.esperando(), true);
});

test('esvaziar: sem rede no perfil mas NA MESMA sessão, a conta guardada vale e a fila sai', async () => {
  // O caso do "Disponível offline": aberto sem rede, o perfil não carrega.
  const token = 'tok-A';
  const marca = marcaDe(token);
  const d = drenar({ itens: [I('v1', 'A'), I('v2', null, 'reject', marca)], perfil: null, token, guardada: { id: 'A', s: marca } });
  await d.app.esvaziarFilaDeSaida();
  assert.deepEqual(d.enviados, ['v1', 'v2']);
  // E o item SEM conta feito NESTA sessão (antes de haver conta) sai: o token é o mesmo do gesto.
});

// ── O3: o item SEM conta tem dono pela SESSÃO (auditoria de 2026-09-26) ─────
// Gesto antes de o perfil de uma sessão nova chegar: `conta: null`. Esse item
// saía no nome de QUALQUER conta que entrasse depois — medido no navegador (p1):
// o ✕ de A foi pro Waze com o token de B, antes de o perfil de B chegar.
test('O3: item SEM conta de OUTRA sessão tem dono desconhecido — não vai ao Waze, e o placar desce', async () => {
  const d = drenar({ itens: [I('vA', null, 'reject', marcaDe('tok-A'))], perfil: null, token: 'tok-B' });
  await d.app.esvaziarFilaDeSaida();
  assert.deepEqual(d.enviados, [], 'a decisão feita na sessão de A saiu com o token de B');
  assert.equal(d.app.carregarFilaDeSaida().length, 0, 'o item de dono desconhecido ficou na fila');
  assert.equal(d.AppState.stats.rejected, 0, 'o placar do gesto que não saiu ficou');
  assert.ok(d.log.includes('saida.semDono'));
  // O mesmo vale pro item gravado SEM a marca (versão anterior) que não foi adotado.
  const e = drenar({ itens: [I('vL', null)], perfil: null, token: 'tok-B' });
  await e.app.esvaziarFilaDeSaida();
  assert.deepEqual(e.enviados, [], 'item sem conta e sem marca saiu no nome de quem está aí');
});

test('O3: cada item leva a marca da SESSÃO do gesto, e o perfil que chega carimba a conta SÓ nos desta sessão', () => {
  const m = montar({ perfil: null, token: 'tok-A' });
  m.app.enfileirarSaida('reject', P('v1', 'u1'));                 // A, antes do perfil
  assert.equal(m.app.carregarFilaDeSaida()[0].s, marcaDe('tok-A'), 'o item não levou a marca da sessão');
  m.sessao.token = 'tok-B';                                        // a sessão de A cai; B entra
  m.app.enfileirarSaida('read', P('v2', 'u2'));                    // B, antes do perfil dele
  m.AppState.profile = { id: 'B' };
  m.app.aoConhecerConta({ id: 'B' });
  const f = m.app.carregarFilaDeSaida();
  const de = (v) => f.find((x) => x.venueID === v);
  assert.equal(de('v2') && de('v2').conta, 'B', 'o gesto de B, feito antes do perfil, não ganhou a conta de B');
  assert.ok(!de('v1') || !de('v1').conta, 'o item da sessão de A ganhou a conta de B — sairia no nome dele');
});

test('O3: a troca de conta leva o que é de dono desconhecido junto com o da conta anterior', () => {
  const m = montar({ perfil: null, token: 'tok-A' });
  m.app.aoConhecerConta({ id: 'A' });
  m.AppState.profile = null;
  m.app.enfileirarSaida('reject', P('v1', 'u1'));                  // A, sem perfil vivo: conta pela guardada
  m.guardado.set('waze_places_saida', JSON.stringify([...m.app.carregarFilaDeSaida(),
    { tipo: 'read', venueID: 'vX', updateRequestID: 'uX', conta: null, s: marcaDe('tok-OUTRA') }]));
  m.sessao.token = 'tok-B';
  m.AppState.profile = { id: 'B' };
  m.app.aoConhecerConta({ id: 'B' });
  assert.deepEqual(m.app.carregarFilaDeSaida().map((x) => x.venueID), [],
    'a troca de conta deixou na fila o que não é de quem entrou');
});

test('O3 (MIGRACAO saida-sem-marca): o item de versão anterior é adotado pela sessão ABERTA, antes do esvaziamento', () => {
  const m = montar({ perfil: null, token: 'tok-A' });
  m.guardado.set('waze_places_saida', JSON.stringify([
    { tipo: 'reject', venueID: 'v1', updateRequestID: 'u1', conta: null },           // versão anterior, sem conta
    { tipo: 'reject', venueID: 'v2', updateRequestID: 'u2' },                        // anterior ao lote 5: sem nada
    { tipo: 'read', venueID: 'v3', updateRequestID: 'u3', conta: 'A' },              // com conta: não precisa
    { tipo: 'read', venueID: 'v4', updateRequestID: 'u4', conta: null, s: 'x' },     // já marcado: não mexe
  ]));
  m.app.adotarSaidaSemMarca();
  const f = m.app.carregarFilaDeSaida();
  assert.equal(f[0].s, marcaDe('tok-A'));
  assert.equal(f[1].s, marcaDe('tok-A'));
  assert.equal(f[2].s, undefined, 'item com conta ganhou marca à toa');
  assert.equal(f[3].s, 'x', 'item já marcado foi remarcado — sairia no nome da sessão de agora');
  // A abertura COM sessão salva mora no `abrirComSessaoSalva`, que o
  // `initApp` só chama com token (o link de pareamento vencido também cai nela).
  const ini = fatiar('initApp');
  assert.match(ini, /if \(API\.getSession\(\)\) \{\s*abrirComSessaoSalva\(\);/,
    'a adoção só vale COM a sessão aberta: a abertura com token saiu do initApp');
  const abre = fatiar('abrirComSessaoSalva');
  const iAdota = abre.indexOf('adotarSaidaSemMarca();');
  const iEsvazia = abre.indexOf('esvaziarFilaDeSaida();');
  assert.ok(iAdota > 0 && iEsvazia > iAdota, 'a adoção tem de vir ANTES do esvaziamento da abertura');
});

test('o "Sair" apaga de quem eram os dados, e o perfil chegando confere a conta ANTES do que depende dele', () => {
  const sair = SEM.slice(SEM.indexOf('async function handleLogout'), SEM.indexOf('function resetQueue'));
  assert.match(sair, /safeLS\.remove\(CONTA_KEY\);/);
  const def = fatiar('definirPerfil');
  assert.match(def, /AppState\.profile = perfil;\s*aoConhecerConta\(perfil\);/,
    'a conta tem que ser conferida logo que o perfil chega, antes da recusa automática e da presença');
  const carga = fatiar('loadProfileAndAuxData');
  assert.match(carga, /if \(definirPerfil\(profileRes\)\) await completarPerfilChegado\(profileRes\.profile, epoca\);/,
    'a carga da abertura deixou de passar pela fonte única do perfil');
});

// ── O PERFIL CHEGOU: fonte única (auditoria de 2026-09-26, O2) ───────────────
// O alarme falso do 401 gravava o perfil da sonda direto no `AppState`, sem o
// `aoConhecerConta`: quem entrava num aparelho cuja sessão anterior tinha caído,
// com o 1º perfil levando um 401 passageiro, nunca tinha a troca de conta
// detectada — e a recusa automática da conta ANTERIOR agia no nome dele.
test('só a fonte única (`definirPerfil`) grava um perfil no AppState — nenhum caminho da rede escapa', () => {
  const fora = [];
  for (const arq of ['app.js', 'presenca.js', 'api.js', 'swipe.js', 'mapa.js', 'i18n.js']) {
    let src;
    try { src = readFileSync(new URL('../js/' + arq, import.meta.url), 'utf8'); } catch (e) { continue; }
    const semCom = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const def = arq === 'app.js' ? fatiar('definirPerfil') : '';
    const resto = def ? semCom.replace(def, '') : semCom;
    for (const m of resto.matchAll(/AppState\.profile\s*=(?!=)\s*([^;\n]+)/g)) {
      if (m[1].trim() !== 'null') fora.push(`${arq}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(fora, [], 'perfil gravado por fora da fonte única — a conta não é conferida:\n  ' + fora.join('\n  '));
  // CONTRAPROVA: o varredor enxerga a gravação que EXISTE (a da própria fonte).
  assert.match(fatiar('definirPerfil'), /AppState\.profile\s*=\s*perfil;/, 'o varredor parou de ver a gravação da fonte única');
});

function alarmeFalso({ sonda, contaGuardada, tokenAgora = 'tok-B', perfilAntes = null }) {
  const guardado = new Map();
  const log = [];
  const safeLS = {
    get: (k) => (guardado.has(k) ? guardado.get(k) : null),
    set: (k, v) => guardado.set(k, String(v)),
    remove: (k) => { log.push('-' + k); guardado.delete(k); },
  };
  const marca = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
  if (contaGuardada) safeLS.set('waze_places_conta', JSON.stringify({ id: contaGuardada.id, s: marca(contaGuardada.token) }));
  const AppState = { authenticated: true, profile: perfilAntes, stats: { read: 3, rejected: 5, skipped: 0 }, history: {}, conquistas: {} };
  const deps = {
    safeLS, AppState, epocaDaSessao: 0,
    API: { getSession: () => tokenAgora, getProfile: async () => sonda },
    CONTA_KEY: constante('CONTA_KEY'), SAIDA_KEY: constante('SAIDA_KEY'),
    HISTORY_KEY: constante('HISTORY_KEY'), CONQUISTAS_KEY: constante('CONQUISTAS_KEY'),
    VERIFICA_SESSAO_MS: 0, setTimeout: (f) => f(),
    dlog: () => {}, dfato: (k) => log.push('dfato:' + k), dlogCapturarAuto: () => {},
    showToast: (m) => log.push('toast:' + m), t: (k) => k,
    guardarReferencias: () => {}, guardarPerfilDoPortao: () => {}, guardarPrazoDaSessao: () => {},
    renderProfileHeader: () => {}, presencaWmeAoCarregarPerfil: () => {},
    completarPerfilChegado: () => log.push('completar'),
    rebuscarDepoisDeFalha: () => {}, esvaziarFilaDeSaida: () => log.push('esvaziar'),
    derrubarSessao: () => log.push('derrubar'), showAuthScreen: () => {}, showAccessDenied: () => {},
    updateInFlightIndicator: () => {}, esquecerAutores: () => log.push('autores'),
    atualizarSeloDeConquista: () => {}, saveStats: () => {}, updateStats: () => {},
    offlineEsquecer: () => {}, dlogApagar: () => {}, window: { Presenca: { esquecer: () => {} } },
    esquecerFocoAutor: () => log.push('foco'),
  };
  const nomes = ['marcaDaSessao', 'aoConhecerConta', 'esquecerOutraConta', 'carimbarContaNaSaida', 'carregarFilaDeSaida',
    'salvarFilaDeSaida', 'definirPerfil', 'marcarSessaoViva', 'handleUnauthorized'];
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let saidaEsperandoConta = false, verificandoSessao = false, sessaoVivaEm = { s: null, em: 0 };
    ${nomes.map(fatiar).join('\n')}
    return { handleUnauthorized };`)(...chaves.map((k) => deps[k]));
  return { app, log, AppState, guardado };
}
const PERFIL_B = { id: 222, userName: 'contaB', rank: 5, isAreaManager: true, isStaff: false };

test('alarme falso com o perfil de OUTRA conta: a troca é detectada e o que era da anterior sai', async () => {
  const m = alarmeFalso({ sonda: { success: true, profile: PERFIL_B }, contaGuardada: { id: '111', token: 'tok-A' } });
  await m.app.handleUnauthorized();
  assert.equal(m.AppState.profile && m.AppState.profile.id, 222, 'a sonda viva não gravou o perfil');
  assert.ok(m.log.includes('dfato:conta.trocou'),
    'a troca de conta NÃO foi detectada no alarme falso — a recusa automática da conta anterior age no nome de quem entrou');
  assert.ok(m.log.includes('autores'), 'a lista de autores (com a recusa automática) da conta anterior ficou');
  assert.equal(JSON.parse(m.guardado.get('waze_places_conta')).id, '222');
  // Era o PRIMEIRO perfil da sessão: o que a abertura não fez (país, presença,
  // recusa) é completado; e a fila de saída é chamada, como sempre.
  assert.ok(m.log.includes('completar'), 'o primeiro perfil vindo do alarme falso não completou a chegada');
  assert.ok(m.log.includes('esvaziar'));
  assert.ok(!m.log.includes('derrubar'));
});

test('alarme falso com o perfil JÁ conhecido: confere a conta, sem refazer a chegada (país, presença)', async () => {
  const m = alarmeFalso({ sonda: { success: true, profile: PERFIL_B }, contaGuardada: { id: '222', token: 'tok-B' },
    perfilAntes: PERFIL_B });
  await m.app.handleUnauthorized();
  assert.ok(!m.log.includes('dfato:conta.trocou'), 'a MESMA conta foi tratada como troca');
  assert.ok(!m.log.includes('completar'), 'refazer o país no meio da sessão trocaria a fila de quem está triando');
});

test('a recusa automática só age com a conta CONFIRMADA nesta sessão (`contaConfirmada`)', () => {
  const r = fatiar('aplicarRecusaAutomatica');
  const iPortao = r.indexOf('if (!podeRecusarAutomaticoAqui()) return;');
  const iConta = r.indexOf('if (!contaConfirmada()) return;');
  const iAlvos = r.indexOf('const alvos');
  assert.ok(iPortao > 0 && iConta > iPortao && iConta < iAlvos, 'a recusa automática não confere de quem é a lista de autores');
  const marca = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
  const confirma = (perfil, guardada, token) => {
    const g = new Map();
    if (guardada) g.set('waze_places_conta', JSON.stringify(guardada));
    return new Function('AppState', 'safeLS', 'CONTA_KEY', 'API', fatiar('marcaDaSessao') + '\n' + fatiar('contaConfirmada')
      + '\nreturn contaConfirmada();')({ profile: perfil }, { get: (k) => (g.has(k) ? g.get(k) : null) },
      'waze_places_conta', { getSession: () => token });
  };
  assert.equal(confirma({ id: 222 }, { id: '222', s: marca('tok-B') }, 'tok-B'), true);
  assert.equal(confirma({ id: 222 }, { id: '111', s: marca('tok-A') }, 'tok-B'), false,
    'o perfil de B com a lista de A no aparelho passou como confirmado');
  assert.equal(confirma({ id: 222 }, { id: '222', s: marca('tok-A') }, 'tok-B'), false,
    'a conta vista em OUTRA sessão passou como confirmada nesta');
  assert.equal(confirma(null, { id: '222', s: marca('tok-B') }, 'tok-B'), false, 'sem perfil vivo não há quem confirmar');
});
