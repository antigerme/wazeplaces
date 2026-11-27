// As rotas da demo no core (`demo-*`), contra a VM de verdade (memória, sem
// arquivo) e um Waze de mentira que ANOTA cada chamada. Cada regra foi vista
// REPROVANDO com a sabotagem (gotcha #28, pergunta 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, fluxoDaDemo } from '../server/core.mjs';
import { criarSalasVm } from '../server/demo-salas-vm.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const NETSCAPE = (d, n, v) => `${d}\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'), NETSCAPE('.waze.com', '_web_session', 'sess-xyz')].join('\n');
const pid = (n) => 'parte-de-teste-' + String(n).padStart(4, '0');

// `n` venues editáveis, cada um com um PUR; o venue `residencial` (1-based) é casa.
const pedidosDoWaze = (n, { residencial = 0 } = {}) => JSON.stringify({
  users: { objects: [{ id: 7, userName: 'world_48213' }] },
  streets: { objects: [] }, cities: { objects: [] }, states: { objects: [] },
  mapIssues: { venueUpdateRequests: { hasMore: false } },
  venues: {
    objects: Array.from({ length: n }, (_, i) => ({
      id: 'v-real-' + (i + 1), name: 'Local ' + (i + 1), permissions: -1, categories: [i + 1 === residencial ? 'RESIDENCE_HOME' : 'BAR'], images: [],
      venueUpdateRequests: [{ id: 'ur-real-' + (i + 1), type: 'IMAGE', createdBy: 7, isRead: false }],
    })),
  },
});
const perfil = (campos) => JSON.stringify({ userName: 'apresentador', areas: [], managedAreas: [], ...campos });
const L5 = { rank: 4, isAreaManager: true, isStaff: false };

async function comWaze(responder, fn) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => { chamadas.push(String(url)); return responder(String(url), init); };
  try { return { r: await fn(), chamadas }; } finally { globalThis.fetch = original; }
}
const waze = ({ sessao = L5, venues = 40, residencial = 0 } = {}) => (url) => {
  if (url.includes('/Session')) return new Response(perfil(sessao), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('/Issues/Search/List')) return new Response(pedidosDoWaze(venues, { residencial }), { status: 200, headers: { 'content-type': 'application/json' } });
  throw new Error('a demo não podia ir a ' + url);
};

// Uma demo criada, com relógio que o teste anda.
async function demoCriada(extra = {}, opcoesDoWaze = {}) {
  const clock = { t: Date.now() };
  const salas = criarSalasVm({ agora: () => clock.t });
  const s = await sessaoDeTeste(COOKIES);
  const ctx = { ...s.ctx, salas };
  const { r, chamadas } = await comWaze(waze(opcoesDoWaze), () => dispatch('demo-criar', { ...s.dados, region: 'row', countryId: 30, ...extra }, ctx));
  return { ctx, salas, clock, r, chamadas, s };
}
const host = (d, tipo, extra = {}) => ({ demo: d.demo, hostKey: d.hostKey, tipo, ...extra });

// ── criar ───────────────────────────────────────────────────────────────────

test('criar: L5+AM cria; só o /Session e a busca vão ao Waze; o retrato tem 30, sem autor nem id real', async () => {
  const { r, chamadas, salas } = await demoCriada();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(chamadas.map((u) => u.replace(/^.*waze\.com/, '').split('?')[0]).sort(), ['/row-Descartes/app/Session', '/row-Descartes/app/v1/Issues/Search/List']);
  assert.ok(chamadas.every((u) => !/Features|Issues\/Read|Issues\/Star/.test(u)), 'a demo só LÊ do Waze');
  const b = r.body;
  assert.match(b.demo, /^[0-9a-f]{40}$/);
  assert.equal(b.segredo.length, 20);
  assert.equal(b.hostKey.length, 20);
  assert.equal(b.total, 30, 'a cota do menor nível que entra (L2): 30');
  assert.equal(b.max, 150);
  const sala = salas._salas.get(b.demo).sala;
  const convidado = JSON.stringify(sala.deck.convidado);
  for (const proibido of ['world_48213', 'createdBy', 'creatorId', 'v-real-', 'ur-real-']) assert.ok(!convidado.includes(proibido), 'vazou ' + proibido);
  assert.equal(sala.deck.apresentador[0].venueID, 'v-real-1', 'o apresentador guarda o id real (↗)');
  assert.equal(sala.deck.regiao, 'row');
  const guardado = JSON.stringify(sala.snapshot());
  assert.ok(!guardado.includes(b.hostKey) && !guardado.includes(b.segredo), 'a sala só guarda o HASH das duas chaves');
});

test('criar: o servidor confere o portão — L4+AM, L5 sem AM, /Session estragado e staff', async () => {
  const casos = [
    [{ rank: 3, isAreaManager: true, isStaff: false }, 403],
    [{ rank: 4, isAreaManager: true, isStaff: false }, 200],
    [{ rank: 4, isAreaManager: false, isStaff: false }, 403],
    [{ rank: '4', isAreaManager: true, isStaff: false }, 403],
    [{}, 403],
    [{ rank: 0, isAreaManager: false, isStaff: true }, 200],
    [{ rank: 6, isAreaManager: true, isStaff: false }, 200],
  ];
  for (const [sessao, esperado] of casos) {
    const { r, chamadas } = await demoCriada({}, { sessao });
    assert.equal(r.status, esperado, JSON.stringify(sessao) + ' → ' + JSON.stringify(r.body).slice(0, 100));
    if (esperado === 403) {
      assert.equal(r.body.errorKey, 'srv.err.demoSemPermissao');
      assert.equal(chamadas.length, 1, 'recusou antes de buscar pedidos');
    }
  }
});

test('criar: o portão recusa SEM apagar a sessão de quem pediu (não é o portão do app)', async () => {
  const { r, s } = await demoCriada({}, { sessao: { rank: 2, isAreaManager: true, isStaff: false } });
  assert.equal(r.status, 403);
  assert.ok(await s.sessions.loadSession(s.sessionToken), 'quem só não pode criar demo segue logado');
});

test('criar: residencial fica de fora e a numeração não tem buraco; poucos pedidos é 409', async () => {
  const { r, salas } = await demoCriada({}, { venues: 5, residencial: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 4);
  assert.ok(!JSON.stringify(salas._salas.get(r.body.demo).sala.deck.convidado).includes('RESIDENCE'));
  const poucos = await demoCriada({}, { venues: 2 });
  assert.equal(poucos.r.status, 409);
  assert.equal(poucos.r.body.errorKey, 'srv.err.demoPoucosPedidos');
  assert.deepEqual(poucos.r.body.errorVars, { n: 2, min: 3 });
});

test('criar: escolha fora do contrato é 400 ANTES de qualquer ida ao Waze; sem sessão é 401', async () => {
  for (const extra of [{ modo: 'torneio' }, { tempoMs: 7000 }, { referencia: 'sim' }, { modo: 7 }]) {
    const { r, chamadas } = await demoCriada(extra);
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(chamadas.length, 0, 'não gasta ida ao Waze com pedido ruim');
  }
  const salas = criarSalasVm();
  const { sessions } = await sessaoDeTeste(COOKIES);
  const { r, chamadas } = await comWaze(waze(), () => dispatch('demo-criar', { sessionToken: 'inventado', region: 'row' }, { sessions, salas }));
  assert.equal(r.status, 401);
  assert.equal(chamadas.length, 0);
});

test('criar: o apresentador escolhe modo, tempo e referência, e a sala os guarda', async () => {
  const { r, salas } = await demoCriada({ modo: 'livre', tempoMs: 0, referencia: true });
  assert.deepEqual([r.body.modo, r.body.tempoMs, r.body.referencia], ['livre', 0, true]);
  const cfg = salas._salas.get(r.body.demo).sala.est.cfg;
  assert.deepEqual([cfg.modo, cfg.tempoMs, cfg.referencia], ['livre', 0, true]);
  const padrao = await demoCriada();
  assert.deepEqual([padrao.r.body.modo, padrao.r.body.tempoMs, padrao.r.body.referencia], ['sinc', 20000, false]);
});

test('sem o adaptador das salas, toda rota da demo diz "indisponível" (503), nunca 500', async () => {
  const s = await sessaoDeTeste(COOKIES);
  for (const [rota, corpo] of [['demo-criar', { ...s.dados, region: 'row' }], ['demo-abrir', { segredo: 'A'.repeat(20) }], ['demo-entrar', {}], ['demo-votar', {}], ['demo-host', {}]]) {
    const r = await dispatch(rota, corpo, s.ctx);
    assert.equal(r.status, 503, rota);
    assert.equal(r.body.errorKey, 'srv.err.demoUnavailable');
  }
});

// ── abrir e entrar ──────────────────────────────────────────────────────────

test('abrir: pelo link (segredo) chega ao baralho e à config; link torto e demo desconhecida são recusados', async () => {
  const { ctx, r } = await demoCriada();
  const a = await dispatch('demo-abrir', { segredo: r.body.segredo }, ctx);
  assert.equal(a.status, 200);
  assert.equal(a.body.demo, r.body.demo);
  assert.equal(a.body.convidado.length, 30);
  assert.ok(!JSON.stringify(a.body).includes('hostHash'));
  const minuscula = await dispatch('demo-abrir', { segredo: r.body.segredo.toLowerCase() }, ctx);
  assert.equal(minuscula.status, 200, 'o que se cola, em minúscula, entra');
  for (const torto of ['', 'curto', 'A'.repeat(19), '0'.repeat(20)]) {
    assert.equal((await dispatch('demo-abrir', { segredo: torto }, ctx)).status, 400, 'segredo ' + torto);
  }
  assert.equal((await dispatch('demo-abrir', {}, ctx)).status, 400);
  assert.equal((await dispatch('demo-abrir', { segredo: 'A'.repeat(20) }, ctx)).status, 404, 'segredo certo no formato, de demo que não existe');
});

test('entrar, votar e palpitar passam pelo corpo validado e chegam à sala', async () => {
  const { ctx, r, clock } = await demoCriada({ modo: 'sinc', tempoMs: 0 });
  const d = r.body;
  const e = await dispatch('demo-entrar', { demo: d.demo, parte: pid(1), apelido: '  Maria   SP ' }, ctx);
  assert.equal(e.status, 200);
  assert.equal(e.body.nome, 'Maria SP');
  assert.equal((await dispatch('demo-entrar', { demo: d.demo, parte: 'curto', apelido: 'X' }, ctx)).status, 400);
  assert.equal((await dispatch('demo-entrar', { demo: 'xyz', parte: pid(2), apelido: 'X' }, ctx)).status, 400);
  assert.equal((await dispatch('demo-entrar', { demo: 'f'.repeat(40), parte: pid(2), apelido: 'X' }, ctx)).status, 404);
  assert.equal((await dispatch('demo-entrar', { demo: d.demo, parte: pid(2), apelido: String.fromCodePoint(0x202E) }, ctx)).body.errorKey, 'srv.err.demoApelido');
  const antes = await dispatch('demo-votar', { demo: d.demo, parte: pid(1), idx: 1, voto: 'R' }, ctx);
  assert.deepEqual([antes.status, antes.body.motivo], [409, 'nao-comecou']);
  assert.equal((await dispatch('demo-host', host(d, 'comecar'), ctx)).status, 200);
  clock.t += 3000;
  await ctx.salas._salas.get(d.demo).sala.tick();
  const v = await dispatch('demo-votar', { demo: d.demo, parte: pid(1), idx: 1, voto: 'R' }, ctx);
  assert.equal(v.status, 200);
  assert.equal(v.body.visao.votos.slice(0, 1), 'R');
  assert.equal((await dispatch('demo-votar', { demo: d.demo, parte: pid(1), idx: 1, voto: 'Z' }, ctx)).status, 400);
  const p = await dispatch('demo-palpitar', { demo: d.demo, parte: pid(1), idx: 1, palpite: 'L' }, ctx);
  assert.equal(p.status, 200);
  assert.equal(p.body.visao.palpites.slice(0, 1), 'L');
});

// ── o apresentador ──────────────────────────────────────────────────────────

test('demo-host: sem a chave certa nada acontece — nem a chave do corpo errado, nem de outra demo', async () => {
  const a = await demoCriada();
  const b = await demoCriada();
  const ctx = a.ctx;
  for (const hostKey of [undefined, '', 'curta', 'A'.repeat(20), b.r.body.hostKey, a.r.body.hostKey.toLowerCase() + 'x']) {
    const { status, body } = await dispatch('demo-host', { demo: a.r.body.demo, hostKey, tipo: 'encerrar' }, ctx);
    assert.ok([403].includes(status), `hostKey ${hostKey}: ${status} ${JSON.stringify(body).slice(0, 80)}`);
  }
  assert.equal(a.salas._salas.get(a.r.body.demo).sala.est.fase, 'saguao', 'a demo seguiu intacta');
  const ok = await dispatch('demo-host', host(a.r.body, 'visao'), ctx);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.visao.papel, 'host');
  assert.equal((await dispatch('demo-host', host(a.r.body, 'abracadabra'), ctx)).status, 400);
  assert.equal((await dispatch('demo-host', { ...host(a.r.body, 'visao'), hostKey: a.r.body.hostKey.toLowerCase() }, ctx)).status, 200, 'a chave em minúscula também vale');
});

test('demo-host: o resultado traz os ids reais pro ↗ e a referência só existe se foi pedida', async () => {
  const d = await demoCriada({ referencia: false });
  const res = await dispatch('demo-host', host(d.r.body, 'resultado'), d.ctx);
  assert.equal(res.status, 200);
  assert.equal(res.body.apresentador[0].venueID, 'v-real-1');
  assert.equal(res.body.regiao, 'row');
  const ref = await dispatch('demo-host', host(d.r.body, 'votarRef', { idx: 1, voto: 'R' }), d.ctx);
  assert.equal(ref.status, 409, 'sem a caixa da referência na criação, o apresentador não vota');
});

test('código curto: só sob demanda, 6 símbolos, leva à mesma demo; chave errada não cria; colisão tenta de novo e desiste', async () => {
  const d = await demoCriada();
  const { ctx } = d;
  assert.equal((await dispatch('demo-abrir', { codigo: 'ABC234' }, ctx)).status, 404, 'antes de pedirem, o código não existe');
  assert.equal((await dispatch('demo-host', { ...host(d.r.body, 'codigo'), hostKey: 'A'.repeat(20) }, ctx)).status, 403);
  const c = await dispatch('demo-host', host(d.r.body, 'codigo'), ctx);
  assert.equal(c.status, 200);
  assert.match(c.body.codigo, /^[2-9A-HJ-NP-Z]{6}$/);
  const a = await dispatch('demo-abrir', { codigo: c.body.codigo.toLowerCase().slice(0, 3) + '-' + c.body.codigo.slice(3).toLowerCase() }, ctx);
  assert.equal(a.status, 200, 'digitado com hífen e minúscula, como a pessoa lê no projetor');
  assert.equal(a.body.demo, d.r.body.demo);
  assert.equal((await dispatch('demo-abrir', { codigo: '0O1I23' }, ctx)).status, 400, 'símbolo fora do alfabeto');
  const cheio = { ...ctx, salas: { ...ctx.salas, definirCodigo: async () => false } };
  const desiste = await dispatch('demo-host', host(d.r.body, 'codigo'), cheio);
  assert.deepEqual([desiste.status, desiste.body.errorKey], [503, 'srv.err.demoCodigo']);
});

test('código curto: vence com o tempo e não vale pra OUTRA demo', async () => {
  const d = await demoCriada();
  const hash = 'abc'.repeat(21).slice(0, 64);
  assert.equal(await d.salas.definirCodigo(hash, 'a'.repeat(40), d.clock.t + 1000), true);
  assert.equal(await d.salas.definirCodigo(hash, 'b'.repeat(40), d.clock.t + 1000), false, 'código vivo de outra demo não é tomado');
  assert.equal(await d.salas.definirCodigo(hash, 'a'.repeat(40), d.clock.t + 1000), true, 'a mesma demo pode renová-lo');
  assert.equal(await d.salas.resolverCodigo(hash), 'a'.repeat(40));
  d.clock.t += 1001;
  assert.equal(await d.salas.resolverCodigo(hash), null);
  assert.equal(await d.salas.definirCodigo(hash, 'b'.repeat(40), d.clock.t + 1000), true, 'vencido, o código é de quem pedir');
});

// ── o fluxo ─────────────────────────────────────────────────────────────────

test('fluxo: validação igual à das rotas; quem não entrou e a chave errada recebem JSON de recusa', async () => {
  const d = await demoCriada();
  const { ctx } = d;
  assert.equal((await fluxoDaDemo({}, ctx)).status, 400);
  assert.equal((await fluxoDaDemo({ demo: d.r.body.demo }, ctx)).status, 400, 'sem parte nem chave');
  assert.equal((await fluxoDaDemo({ demo: d.r.body.demo, parte: pid(1) }, ctx)).body.motivo, 'fora-da-sala');
  assert.equal((await fluxoDaDemo({ demo: d.r.body.demo, hostKey: 'A'.repeat(20) }, ctx)).status, 403);
  assert.equal((await fluxoDaDemo({ demo: 'f'.repeat(40), parte: pid(1) }, ctx)).status, 404);
  assert.equal((await fluxoDaDemo({ demo: d.r.body.demo, hostKey: d.r.body.hostKey, extra: { toString: 1 } }, ctx)).status, 400, 'corpo com toString próprio, mesmo com a chave certa');
  assert.equal((await fluxoDaDemo({ demo: d.r.body.demo, parte: pid(1) }, { sessions: ctx.sessions })).status, 503);
  await dispatch('demo-entrar', { demo: d.r.body.demo, parte: pid(1), apelido: 'Ana' }, ctx);
  const res = await fluxoDaDemo({ demo: d.r.body.demo, parte: pid(1) }, ctx);
  assert.ok(res instanceof Response);
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  await res.body.cancel();
  const h = await fluxoDaDemo({ demo: d.r.body.demo, hostKey: d.r.body.hostKey }, ctx);
  assert.ok(h instanceof Response, 'o apresentador abre com a chave no CORPO');
  await h.body.cancel();
});
