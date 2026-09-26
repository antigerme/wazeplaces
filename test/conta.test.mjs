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
  };
  const nomes = ['marcaDaSessao', 'contaAgora', 'aoConhecerConta', 'esquecerOutraConta',
    'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido', 'enfileirarSaida'];
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
    registrarPousoDeSaida: () => {}, handleUnauthorized: () => {}, updateInFlightIndicator: () => {},
    updateStats: () => {}, saveStats: () => log.push('saveStats'), dfato: (k) => log.push(k),
    showToast: () => {}, t: (k) => k, setTimeout: (f) => f(),
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let esvaziandoSaida = false, saidaPedidaDeNovo = false, saidaEsperandoConta = false;
    ${['marcaDaSessao', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'esvaziarFilaDeSaida'].map(fatiar).join('\n')}
    return { esvaziarFilaDeSaida, carregarFilaDeSaida, esperando: () => saidaEsperandoConta };`)(...chaves.map((k) => deps[k]));
  return { app, enviados, log, AppState, guardado };
}
const I = (v, conta, tipo = 'reject') => ({ tipo, venueID: v, updateRequestID: 'u' + v, conta, regiao: 'row' });

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
  const marca = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')()(token);
  const d = drenar({ itens: [I('v1', 'A'), I('v2', null)], perfil: null, token, guardada: { id: 'A', s: marca } });
  await d.app.esvaziarFilaDeSaida();
  assert.deepEqual(d.enviados, ['v1', 'v2']);
  // E o item SEM conta (feito antes de haver conta) sai como sempre saiu.
});

test('o "Sair" apaga de quem eram os dados, e o perfil chegando confere a conta ANTES do que depende dele', () => {
  const sair = SEM.slice(SEM.indexOf('async function handleLogout'), SEM.indexOf('function resetQueue'));
  assert.match(sair, /safeLS\.remove\(CONTA_KEY\);/);
  const carga = fatiar('loadProfileAndAuxData');
  assert.match(carga, /AppState\.profile = profileRes\.profile;\s*aoConhecerConta\(profileRes\.profile\);/,
    'a conta tem que ser conferida logo que o perfil chega, antes da recusa automática e da presença');
});
