// Os MANUAIS contra o que o código faz: o README (quem instala e confere a
// instalação) e o README da extensão (o protocolo que o @daflash publica). Frase
// de manual que não bate com o código é um passo que falha na mão de alguém —
// e sem erro nenhum no repositório (auditoria de 2026-09-29, T1, T2, A13, T4 e
// A14). Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { dispatch, makeSessions } from '../server/core.mjs';

const raiz = new URL('../', import.meta.url);
const ler = (p) => readFileSync(new URL(p, raiz), 'utf8');
const README = ler('README.md');
const EXT = ler('extensao-chrome/README.md');
const blocos = (md, lingua) => [...md.matchAll(new RegExp('```' + lingua + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]);

// ── README ───────────────────────────────────────────────────────────────────
// T1, MEDIDO rodando a VM como `nobody` (setpriv) num diretório criado pelo
// passo do README: com o `sudo mkdir -p`, o diretório fica do root (755), toda
// gravação de sessão falha e o `parear` responde 500 "Erro interno" (o login
// igual); com o dono certo, 200.
test('README, Opção B: o diretório das sessões é do usuário do serviço (senão todo login dá "Erro interno")', () => {
  const unidade = blocos(README, 'ini').find((b) => /ExecStart=.*server\/node\.mjs/.test(b));
  assert.ok(unidade, 'CONTROLE: a unidade systemd da Opção B sumiu do README');
  const usuario = (/^User=(\S+)$/m.exec(unidade) || [])[1];
  const dir = (/^Environment=SESSION_DIR=(\S+)$/m.exec(unidade) || [])[1];
  assert.ok(usuario && dir, 'CONTROLE: a unidade não diz o User= e o SESSION_DIR=');
  const comandos = blocos(README, 'bash').join('\n').split('\n').filter((l) => !/^\s*#/.test(l));
  const donos = [];
  for (const l of comandos) {
    const i = /\binstall\s+-d\s+-o\s+(\S+)\s+-g\s+\S+\s+-m\s+\S+\s+(\S+)/.exec(l);
    if (i) donos.push({ usuario: i[1], caminho: i[2], recursivo: false });
    const c = /\bchown\s+(-R\s+)?([^:\s]+)(?::\S+)?\s+(\S+)/.exec(l);
    if (c) donos.push({ usuario: c[2], caminho: c[3], recursivo: !!c[1] });
  }
  assert.ok(donos.some((d) => d.usuario === usuario
    && (d.caminho === dir || (d.recursivo && dir.startsWith(d.caminho.replace(/\/$/, '') + '/')))),
  `o README cria ${dir} sem dá-lo ao ${usuario} (o User= do serviço): criado pelo root, o ${usuario} não grava nele, e todo login e todo pareamento respondem "Erro interno"`);
});

// T2: o POST cru leva 403 do Bot Fight Mode do Cloudflare (MEDIDO em produção,
// ver o CLAUDE.md), e a tabela da conferência não tinha a linha do 403 — quem
// seguisse o README concluía que a API estava fora.
test('README: a conferência da API com curl passa pelo Bot Fight Mode, e o 403 dele está na tabela', () => {
  const curl = blocos(README, 'bash').find((b) => /\bcurl\b[\s\S]*\/api\/perfil/.test(b));
  assert.ok(curl, 'CONTROLE: a conferência da API sumiu do README');
  assert.match(curl, /\s-A\s+'Mozilla\/5\.0 [^']+'/,
    'o curl sai sem User-Agent de navegador: o Bot Fight Mode responde 403 antes de a API ver o pedido');
  assert.match(README, /^\| \*\*403\*\* \|[^\n]*Bot Fight Mode/m, 'a tabela da conferência não explica o 403 do Bot Fight Mode');
});

// A13: "invalida sessão local, volta pra tela de login" era o app de antes. Hoje
// a ação vai pra fila de saída, a sessão é CONFERIDA (401 muitas vezes é alarme
// falso) e a extensão renova em silêncio. A linha e o código, juntos.
test('README: a linha do `unauthorized` diz o que o app faz hoje — e o código faz o que ela diz', () => {
  const linha = (/^\| `unauthorized` \|[^\n]*$/m.exec(README) || [])[0];
  assert.ok(linha, 'CONTROLE: a tabela das categorias sumiu do README');
  assert.doesNotMatch(linha, /[Ii]nvalida (a )?sessão local/, 'a linha segue dizendo que o 401 derruba a sessão na hora');
  for (const termo of ['fila de saída', 'confere', 'extensão']) {
    assert.ok(linha.includes(termo), `a linha do unauthorized não fala de "${termo}"`);
  }
  const APP = ler('js/app.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const ini = APP.indexOf("if (cat === 'unauthorized') {", APP.indexOf('function handleActionResult('));
  assert.ok(ini > 0, 'CONTROLE: o ramo do 401 sumiu do handleActionResult');
  let prof = 0, fim = ini;
  for (let j = APP.indexOf('{', ini); j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}') { prof--; if (prof === 0) { fim = j; break; } }
  }
  const ramo = APP.slice(ini, fim);
  assert.match(ramo, /enfileirarSaida\(/, 'o README diz que a ação vai pra fila de saída, e o ramo do 401 não a enfileira');
  assert.match(ramo, /handleUnauthorized\(\)/, 'o README diz que a sessão é conferida, e o ramo do 401 não confere');
});

// R56-8 (auditoria de 2026-10-01): a conta das escritas no KV do free tier
// dizia "até 2" por exclusão de foto. Eram 2 no caminho comum — a lista de fotos
// do local, gravada pelo `preparar` do toque na lixeira, e a regravação dela
// depois de excluir —, e MAIS UMA a cada vez que a exclusão saía sem essa lista
// valendo (ela vale `RELEITURA_TTL`) e a relia do Waze. Desde a rodada 13
// (R13-3-03) a lista do toque mora numa chave PRÓPRIA, do gesto, e a exclusão
// que a usa não regrava nada: 1 no caminho comum, e 2 a mais (a lista relida e a
// regravação) quando a exclusão sai sem ela. O toque e a exclusão levam o GESTO,
// como o app manda. Os números saem do SERVIDOR DE VERDADE, com um Waze de
// mentira e o relógio adiantado — mexeu no core, o README tem que acompanhar.
//
// E a exclusão SEM toque (auditoria da rodada 14, R14-3-02 e R14-6-05): com o
// Desfazer desligado o app não manda o toque, e com outra escrita de foto do
// local no ar também não (a exclusão espera a vez do local). O README do lote 17
// contava só o caminho com o toque ("1 por exclusão … e mais 2"), e o servidor
// grava 2 nesses — ou 1, quando a lista que outra exclusão do local releu ainda
// vale. `toque`: o app mandou o toque (e a exclusão leva o gesto dele);
// `antes(excluir)`: o que o local viveu antes da exclusão medida, sem contar.
async function escritasDaLixeira({ toque = true, segundosAteOEnvio = 3, antes = null } = {}) {
  const VENUE = '1.2.3';
  let imagens = [{ id: 'a', approved: true }, { id: 'b', approved: true }, { id: 'c', approved: true }, { id: 'p', approved: false }];
  const original = globalThis.fetch, agora = Date.now;
  let adiante = 0;
  Date.now = () => agora.call(Date) + adiante;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'POST') {
      const sub = JSON.parse(init.body).actions._subActions[0];
      // A aprovação da foto p (o caminho de `validar-place` com `approve`); o
      // resto é a lista do local que a exclusão manda.
      if (sub.name === 'UPDATE_PLACE_UPDATE') imagens = imagens.map((f) => (f.id === 'p' ? { ...f, approved: true } : f));
      else imagens = sub.attributes.images;
    }
    return new Response(JSON.stringify({ venues: { objects: [{ id: VENUE, images: imagens }] } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const mem = new Map();
    let escritas = 0;
    const store = { get: async (k) => (mem.has(k) ? mem.get(k) : null), put: async (k, v) => { escritas++; mem.set(k, v); }, delete: async (k) => { mem.delete(k); } };
    const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
    const sessionToken = await sessions.createSession(['.waze.com\tTRUE\t/\tTRUE\t9999999999\t_csrf_token\tc',
      '.waze.com\tTRUE\t/\tTRUE\t9999999999\t_web_session\ts'].join('\n'));
    const base = { sessionToken, region: 'row', venueID: VENUE, lat: -23.5, lon: -46.6 };
    const excluir = async (imageID, gesto) => {
      if (gesto) await dispatch('excluir-foto', { ...base, action: 'preparar', imageID: 'preparar', aquecimento: gesto }, { sessions });
      const r = await dispatch('excluir-foto', { ...base, imageID, ...(gesto ? { aquecimento: gesto } : {}) }, { sessions });
      assert.ok(r.body && r.body.success && !r.body.jaExcluida, `CONTROLE: a exclusão de mentira de ${imageID} não saiu`);
    };
    const aprovar = async () => {
      const r = await dispatch('validar-place', { ...base, updateRequestID: 'p', approve: true }, { sessions });
      assert.ok(r.body && r.body.success, 'CONTROLE: a aprovação de mentira não saiu');
    };
    if (antes) await antes({ excluir, aprovar });
    escritas = 0;   // a sessão do login e o que veio antes não são desta exclusão
    if (toque) await dispatch('excluir-foto', { ...base, action: 'preparar', imageID: 'preparar', aquecimento: 'gesto-conta-01' }, { sessions });
    adiante += segundosAteOEnvio * 1000;
    const r = await dispatch('excluir-foto', { ...base, imageID: 'a', ...(toque ? { aquecimento: 'gesto-conta-01' } : {}) }, { sessions });
    assert.ok(r.body && r.body.success && !r.body.jaExcluida, 'CONTROLE: a exclusão de mentira não saiu');
    return escritas;
  } finally {
    globalThis.fetch = original;
    Date.now = agora;
  }
}

test('README: as escritas no KV da lixeira de foto são as que o servidor faz (R56-8, R14-3-02)', async () => {
  const frase = (/a lixeira de foto \(([^)]*)\)/.exec(README) || [])[1];
  assert.ok(frase, 'CONTROLE: a lixeira sumiu da conta das escritas do README');
  const ttl = Number((/^const RELEITURA_TTL = (\d+);/m.exec(ler('server/core.mjs')) || [])[1]);
  assert.ok(ttl > 3, 'CONTROLE: o RELEITURA_TTL sumiu do core (ou ficou menor que a janela do Desfazer)');
  // As duas partes da frase: com o toque (o Desfazer ligado) e sem ele.
  const corte = frase.indexOf('; com o Desfazer desligado');
  assert.ok(corte > 0, `o README não separa a exclusão SEM o toque (o Desfazer desligado) da com o toque: "${frase}"`);
  const comToque = frase.slice(0, corte), semToque = frase.slice(corte);
  const comum = await escritasDaLixeira();                                  // o toque e o envio no fim da janela do Desfazer
  const vencida = await escritasDaLixeira({ segundosAteOEnvio: ttl + 1 });  // a lista guardada venceu antes do envio
  assert.ok(comum >= 1 && vencida > comum, `CONTROLE: o servidor gravou ${comum} e ${vencida} — a medida não separa os casos`);
  assert.ok(comToque.includes(`${comum} por exclusão`),
    `o servidor grava ${comum} vezes numa exclusão comum, e o README diz: "${comToque}"`);
  assert.ok(comToque.includes(`mais ${vencida - comum} cada vez`),
    `com a lista vencida o servidor grava ${vencida} (mais ${vencida - comum}), e o README não conta a releitura: "${comToque}"`);
  assert.ok(comToque.includes(`${ttl} s`), `a lista vale ${ttl} s no servidor, e o README diz outra coisa: "${comToque}"`);
  // SEM o toque: o Desfazer desligado (a exclusão sai no toque, sem a leitura
  // antes), e a exclusão que esperou outra escrita de foto do mesmo local — uma
  // exclusão que usou a lista do toque dela (a releitura do local não fica
  // guardada) ou uma aprovação (que esquece as listas). E com a lista que OUTRA
  // exclusão do local releu ainda valendo (duas seguidas sem o Desfazer).
  const sem = await escritasDaLixeira({ toque: false, segundosAteOEnvio: 0 });
  const depoisDoToque = await escritasDaLixeira({ toque: false, segundosAteOEnvio: 0, antes: ({ excluir }) => excluir('b', 'gesto-conta-02') });
  const depoisDaAprovacao = await escritasDaLixeira({ toque: false, segundosAteOEnvio: 0, antes: ({ aprovar }) => aprovar() });
  const comALista = await escritasDaLixeira({ toque: false, segundosAteOEnvio: 0, antes: ({ excluir }) => excluir('b') });
  assert.ok(comALista >= 1 && sem > comALista, `CONTROLE: sem o toque o servidor gravou ${sem} e, com a lista relida valendo, ${comALista} — a medida não separa os casos`);
  assert.deepEqual([depoisDoToque, depoisDaAprovacao], [sem, sem],
    `a exclusão que esperou outra escrita do local grava ${depoisDoToque} (depois de uma exclusão com o toque) e ${depoisDaAprovacao} (depois de uma aprovação), não ${sem} — o README conta um número só`);
  assert.ok(semToque.includes(`${sem} por exclusão`),
    `sem o toque o servidor grava ${sem} vezes por exclusão, e o README diz: "${semToque}"`);
  assert.ok(semToque.includes(`ou ${comALista} quando`),
    `com a lista relida por outra exclusão ainda valendo o servidor grava ${comALista}, e o README não diz: "${semToque}"`);
  assert.ok(semToque.includes('espera outra escrita de foto do mesmo local'),
    `o README não diz que a exclusão que espera outra escrita de foto do local também sai sem o toque: "${semToque}"`);
  assert.ok(!comToque.includes('espera outra escrita'),
    `o README conta a espera por outra escrita do local no caminho COM o toque (o app não manda o toque nela): "${comToque}"`);
  assert.ok(semToque.includes(`${ttl} s`), `a lista relida vale ${ttl} s no servidor, e o README diz outra coisa: "${semToque}"`);
});

// R9-6-07 (auditoria da rodada 9): a conta dos APAGAMENTOS no KV — a cota curta
// do plano grátis, 1.000 por dia — dizia "o 'Sair', o resgate e o cancelamento
// do código". O servidor apaga em mais três casos, e um deles vira RAJADA no dia
// em que se troca o `ENCRYPTION_KEY`: cada sessão que volta não abre mais e é
// apagada uma vez. Os números saem do SERVIDOR DE VERDADE (o `dispatch`, com um
// store que conta os `delete`) e de um Waze de mentira: cada caso apaga 1, e os
// CONTROLES (aprovar sem a lixeira, o perfil que passa no portão) apagam 0 —
// mexeu num apagamento do core, o README acompanha.
const COOKIES_DO_TESTE = ['.waze.com\tTRUE\t/\tTRUE\t9999999999\t_csrf_token\tc',
  '.waze.com\tTRUE\t/\tTRUE\t9999999999\t_web_session\ts'].join('\n');
const PERFIL_QUE_PASSA = { id: 1, userName: 'x', rank: 5, isAreaManager: true, isStaff: false };
async function apagamentosNoKv(cenario, { sessao = PERFIL_QUE_PASSA } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(/\/Session\b/.test(String(url)) ? sessao
    : { venues: { objects: [{ id: '1.2.3', images: [{ id: 'a', approved: true }] }] } }),
  { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const mem = new Map();
    let apagados = 0;
    const store = { get: async (k) => (mem.has(k) ? mem.get(k) : null), put: async (k, v) => { mem.set(k, v); },
      delete: async (k) => { apagados++; mem.delete(k); } };
    const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
    const sessionToken = await sessions.createSession(COOKIES_DO_TESTE);
    // O que o cenário faz ANTES do gesto medido (gerar o código, tocar na
    // lixeira) não conta: a contagem recomeça no `medir`.
    await cenario({ sessions, sessionToken, mem, medir: () => { apagados = 0; } });
    return apagados;
  } finally {
    globalThis.fetch = original;
  }
}
const FOTO = { region: 'row', venueID: '1.2.3', lat: -23.5, lon: -46.6 };
const aprovar = ({ sessions, sessionToken }) => dispatch('validar-place',
  { ...FOTO, sessionToken, updateRequestID: '99', approve: true }, { sessions });
const CASOS_DE_APAGAMENTO = [
  ['o "Sair"', /"Sair"/, async ({ sessions, sessionToken, medir }) => {
    medir();
    await dispatch('sessao', { action: 'destroy', sessionToken }, { sessions });
  }],
  ['o resgate do código', /resgate/, async ({ sessions, sessionToken, medir }) => {
    const { body } = await dispatch('parear', { action: 'create', sessionToken }, { sessions });
    medir();
    const r = await dispatch('parear', { action: 'claim', code: body.code }, { sessions });
    assert.ok(r.body.success, 'CONTROLE: o resgate não deu certo');
  }],
  ['o cancelamento do código', /cancelamento/, async ({ sessions, sessionToken, medir }) => {
    const { body } = await dispatch('parear', { action: 'create', sessionToken }, { sessions });
    medir();
    await dispatch('parear', { action: 'cancel', code: body.code }, { sessions });
  }],
  ['a aprovação de foto com a lista da lixeira guardada', /aprovação de foto/, async (amb) => {
    await dispatch('excluir-foto', { ...FOTO, sessionToken: amb.sessionToken, action: 'preparar', imageID: 'preparar', aquecimento: 'gesto-apaga-01' }, { sessions: amb.sessions });
    amb.medir();
    const r = await aprovar(amb);
    assert.ok(r.body.success, 'CONTROLE: a aprovação de mentira não saiu');
  }],
  ['a sessão que a conferência do perfil recusa (o portão)', /conferência do perfil/, async ({ sessions, sessionToken, medir }) => {
    medir();
    const r = await dispatch('perfil', { sessionToken, region: 'row' }, { sessions });
    assert.equal(r.status, 403, 'CONTROLE: o portão não recusou o perfil de rank 0');
  }, { sessao: { ...PERFIL_QUE_PASSA, rank: 0 } }],
  ['a sessão que não abre mais (outra ENCRYPTION_KEY, formato de antes)', /ENCRYPTION_KEY/, async ({ sessions, sessionToken, mem, medir }) => {
    for (const k of mem.keys()) mem.set(k, Math.floor(Date.now() / 1000) + '|lixo::lixo');
    medir();
    const r = await dispatch('perfil', { sessionToken, region: 'row' }, { sessions });
    assert.equal(r.status, 401, 'CONTROLE: a sessão que não abre não deu 401');
  }],
];

test('README: os apagamentos no KV são os que o servidor faz — o "Sair" e o código, a aprovação de foto, o portão e a sessão que não abre (R9-6-07)', async () => {
  const frase = (/Apagam: (.*?)Passou disso/.exec(README) || [])[1];
  assert.ok(frase, 'CONTROLE: a conta dos apagamentos sumiu do README');
  for (const [caso, noReadme, cenario, opcoes] of CASOS_DE_APAGAMENTO) {
    const n = await apagamentosNoKv(cenario, opcoes);
    assert.equal(n, 1, `${caso}: o servidor apagou ${n} vezes no KV (o README conta 1)`);
    assert.match(frase, noReadme, `${caso}: o servidor apaga no KV, e o README não conta: "${frase}"`);
  }
  // A aprovação apaga as DUAS listas da lixeira guardadas (R13-3-02): a do toque
  // e a da releitura, quando a exclusão anterior a regravou — e o README diz
  // quanto. As duas existem juntas quando uma exclusão sai sem a lista do toque
  // (a página saindo antes da resposta dele, a lixeira tocada com outra escrita
  // de foto do local no ar): o toque de X, e a exclusão de Y relendo o local.
  const duas = await apagamentosNoKv(async (amb) => {
    await dispatch('excluir-foto', { ...FOTO, sessionToken: amb.sessionToken, action: 'preparar', imageID: 'preparar', aquecimento: 'gesto-apaga-02' }, { sessions: amb.sessions });
    const r = await dispatch('excluir-foto', { ...FOTO, sessionToken: amb.sessionToken, imageID: 'a' }, { sessions: amb.sessions });
    assert.ok(r.body.success, 'CONTROLE: a exclusão que relê não saiu');
    amb.medir();
    await aprovar(amb);
  });
  assert.equal(duas, 2, `com as duas listas guardadas, a aprovação apagou ${duas} (as duas listas são da sessão)`);
  assert.ok(frase.includes(`até ${duas} por aprovação`), `o README não diz quanto a aprovação de foto apaga (até ${duas}): "${frase}"`);
  // CONTROLES: sem a lista da lixeira guardada, aprovar não apaga; o perfil que
  // passa no portão também não (o instrumento não conta apagamento à toa).
  assert.equal(await apagamentosNoKv(async (amb) => { amb.medir(); await aprovar(amb); }), 0,
    'CONTROLE: aprovar sem a lixeira apagou no KV');
  assert.equal(await apagamentosNoKv(async ({ sessions, sessionToken, medir }) => {
    medir();
    await dispatch('perfil', { sessionToken, region: 'row' }, { sessions });
  }), 0, 'CONTROLE: o perfil que passa no portão apagou no KV');
});

// R10-6-04 (auditoria da rodada 10): o README dizia que a aprovação apaga "só no
// minuto depois de ALGUÉM tocar numa lixeira daquele local". A lista guardada é
// POR SESSÃO (a chave é `reler_` + sha256 de `sessionToken|venueID`): a lixeira
// de outro editor no mesmo local não conta, e a frase superestimava os
// apagamentos da cota curta. O que o README diz sai do SERVIDOR DE VERDADE: a
// lixeira tocada por uma sessão e a aprovação pela outra; e, de CONTROLE, as duas
// pela mesma (que apaga 1). Mexeu na chave da lista, o README acompanha.
test('README: a aprovação de foto só apaga a lista da lixeira tocada na MESMA sessão — a de outra sessão não conta (R10-6-04)', async () => {
  const frase = (/Apagam: (.*?)Passou disso/.exec(README) || [])[1];
  assert.ok(frase, 'CONTROLE: a conta dos apagamentos sumiu do README');
  const trecho = (/a aprovação de foto[^)]*\)/.exec(frase) || [])[0];
  assert.ok(trecho, `CONTROLE: a aprovação de foto sumiu da conta dos apagamentos: "${frase}"`);
  const tocarALixeira = (sessions, sessionToken) => dispatch('excluir-foto',
    { ...FOTO, sessionToken, action: 'preparar', imageID: 'preparar', aquecimento: 'gesto-sessao-01' }, { sessions });
  const mesma = await apagamentosNoKv(async (amb) => {
    await tocarALixeira(amb.sessions, amb.sessionToken);
    amb.medir();
    const r = await aprovar(amb);
    assert.ok(r.body.success, 'CONTROLE: a aprovação de mentira não saiu');
  });
  const outra = await apagamentosNoKv(async ({ sessions, sessionToken, medir }) => {
    await tocarALixeira(sessions, sessionToken);
    const daOutraSessao = await sessions.createSession(COOKIES_DO_TESTE);
    medir();
    const r = await aprovar({ sessions, sessionToken: daOutraSessao });
    assert.ok(r.body.success, 'CONTROLE: a aprovação da outra sessão não saiu');
  });
  assert.equal(mesma, 1, `CONTROLE: a lixeira e a aprovação na MESMA sessão apagaram ${mesma} vezes no KV`);
  if (outra === 0) {
    assert.match(trecho, /\bsua sessão\b/,
      `só a lixeira da MESMA sessão faz a aprovação apagar, e o README não diz que a lista guardada é da sessão: "${trecho}"`);
    assert.doesNotMatch(trecho, /\balguém\b/,
      `só a lixeira da MESMA sessão faz a aprovação apagar, e o README conta a lixeira de qualquer um: "${trecho}"`);
  } else {
    assert.doesNotMatch(trecho, /\bsua sessão\b/,
      `a lixeira de OUTRA sessão também faz a aprovação apagar (${outra}), e o README diz que só a da sua sessão conta: "${trecho}"`);
  }
});

// R12-6-03 (auditoria da rodada 12): a conta das LEITURAS no KV dizia "Cada ação
// = 1 leitura". As da foto custam mais — a lixeira confere a lista de fotos
// guardada, o lote 15 somou à exclusão a conferência do registro que ela leu
// (R11-3-01), e aprovar foto confere a lista da lixeira antes de apagá-la —, e o
// README não contava (MEDIDO: 2 no toque, 3 na exclusão, 2 na aprovação). Os
// números saem do SERVIDOR DE VERDADE (o `dispatch`, com um store que conta os
// `get`) e de um Waze de mentira, em cada variante que muda o caminho: a lista de
// fotos valendo ou vencida, a aprovação com e sem a lixeira guardada. Mexeu numa
// leitura do core, o README acompanha.
async function leiturasNoKv() {
  const VENUE = '1.2.3';
  let imagens = [{ id: 'a', approved: true }, { id: 'b', approved: true }, { id: 'c', approved: true }, { id: 'd', approved: true },
    { id: 'p', approved: false }];
  const original = globalThis.fetch, agora = Date.now;
  let adiante = 0;
  Date.now = () => agora.call(Date) + adiante;
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (/\/Session\b/.test(u)) return json(PERFIL_QUE_PASSA);
    if (/Issues\/Search/.test(u)) return json({ urs: { objects: [] }, venues: { objects: [] }, users: { objects: [] }, hasMore: false });
    if (/Issues\/(Read|Star)/.test(u)) return json({});
    if ((init.method || 'GET') === 'GET') return json({ venues: { objects: [{ id: VENUE, images: imagens }] } });
    const sub = JSON.parse(init.body).actions._subActions[0];
    if (sub.name === 'UPDATE_OBJECT' && sub.attributes.images) imagens = sub.attributes.images;
    return json({ venues: { objects: [{ id: VENUE, images: imagens, name: sub.attributes && sub.attributes.name }] } });
  };
  try {
    const mem = new Map();
    let leituras = 0;
    const store = { get: async (k) => { leituras++; return mem.has(k) ? mem.get(k) : null; }, put: async (k, v) => { mem.set(k, v); },
      delete: async (k) => { mem.delete(k); } };
    const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
    const sessionToken = await sessions.createSession(COOKIES_DO_TESTE);
    const medir = async (rota, corpo) => {
      const antes = leituras;
      const r = await dispatch(rota, { sessionToken, region: 'row', ...corpo }, { sessions });
      assert.ok(r.body && r.body.success, `CONTROLE: ${rota} de mentira não deu certo: ${JSON.stringify(r.body).slice(0, 160)}`);
      return leituras - antes;
    };
    const FOTO_AQUI = { venueID: VENUE, lat: -23.5, lon: -46.6 };
    const PEDIDO = { venueID: '9.9.9', updateRequestID: '99' };
    const n = {};
    n.perfil = await medir('perfil', {});
    n.busca = await medir('buscar-places', { countryId: 30 });
    n.rejeitar = await medir('validar-place', PEDIDO);
    n.lido = await medir('marcar-lido', PEDIDO);
    n.estrela = await medir('guardar-pedido', { ...PEDIDO, value: true });
    n.renomear = await medir('renomear-local', { ...FOTO_AQUI, nome: 'Nome novo' });
    n.aprovarSemLixeira = await medir('validar-place', { ...FOTO_AQUI, updateRequestID: '98', approve: true });
    // O toque e a exclusão levam o GESTO, como o app manda (R13-3-03).
    const toque = (g) => ({ ...FOTO_AQUI, action: 'preparar', imageID: 'preparar', aquecimento: g });
    n.toque = await medir('excluir-foto', toque('gesto-le-01'));
    n.exclusao = await medir('excluir-foto', { ...FOTO_AQUI, imageID: 'a', aquecimento: 'gesto-le-01' });
    n.toqueDeNovo = await medir('excluir-foto', toque('gesto-le-02'));
    adiante += 60 * 1000;   // a lista de fotos guardada vence antes do envio
    n.exclusaoVencida = await medir('excluir-foto', { ...FOTO_AQUI, imageID: 'b', aquecimento: 'gesto-le-02' });
    // A lista da RELEITURA valendo (a exclusão acima a regravou): o toque não lê
    // o Waze, e a exclusão a usa.
    n.toqueComALista = await medir('excluir-foto', toque('gesto-le-03'));
    n.exclusaoComALista = await medir('excluir-foto', { ...FOTO_AQUI, imageID: 'c', aquecimento: 'gesto-le-03' });
    await medir('excluir-foto', toque('gesto-le-04'));
    n.aprovarComLixeira = await medir('validar-place', { ...FOTO_AQUI, updateRequestID: '97', approve: true });
    // A exclusão SEM o toque (o Desfazer desligado, ou a que esperou outra escrita
    // de foto do local, R14-3-02): relê o local e confere a regravação — as mesmas
    // leituras da exclusão com o toque.
    n.exclusaoSemToque = await medir('excluir-foto', { ...FOTO_AQUI, imageID: 'd' });
    return n;
  } finally {
    globalThis.fetch = original;
    Date.now = agora;
  }
}

test('README: as leituras no KV são as que o servidor faz — 1 por ação, e as da foto contadas (R12-6-03)', async () => {
  // O toque na lixeira pode custar uma leitura a mais quando relê a lista de fotos
  // do Waze do que com a lista ainda valendo: aí o README diz os dois, na forma
  // "N leituras no toque (M com a lista de fotos ainda valendo)".
  // E a exclusão, uma a mais quando a lista do toque já venceu (ela confere as
  // duas listas guardadas e a regravação): "N na exclusão (M quando a lista do
  // toque já venceu)" (R13-3-03).
  const m = /Cada ação = (\d+) leitura, menos as da foto: a lixeira custa (\d+) leituras no toque(?: \((\d+) com a lista de fotos ainda valendo\))? e (\d+) na exclusão(?: \((\d+) quando a lista do toque já venceu\))?, e aprovar foto, (\d+)\./.exec(README);
  assert.ok(m, 'CONTROLE: a conta das leituras no KV sumiu do README (ou mudou de forma)');
  const [umaAcao, toque, toqueValendo, exclusao, exclusaoVencidaReadme, aprovar] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  const n = await leiturasNoKv();
  // CONTROLE: o instrumento separa os casos (senão "bate" por não medir nada):
  // as da foto leem mais que uma ação comum.
  assert.ok(n.perfil >= 1 && n.toque > n.perfil && n.toqueDeNovo > n.perfil && n.exclusao > n.perfil && n.aprovarSemLixeira > n.perfil,
    `CONTROLE: as leituras medidas não separam os casos: ${JSON.stringify(n)}`);
  for (const acao of ['perfil', 'busca', 'rejeitar', 'lido', 'estrela', 'renomear'])
    assert.equal(n[acao], umaAcao, `${acao}: o servidor lê ${n[acao]} vez(es) no KV, e o README diz ${umaAcao} por ação`);
  assert.equal(n.toque, toque, `a lixeira (o toque que relê a lista do Waze): o servidor lê ${n.toque} vezes no KV, e o README diz ${toque} no toque`);
  const comALista = toqueValendo === undefined ? toque : toqueValendo;
  assert.equal(n.toqueDeNovo, comALista,
    `a lixeira (o toque com a lista ainda valendo): o servidor lê ${n.toqueDeNovo} vezes no KV, e o README diz ${comALista}`);
  assert.equal(n.toqueComALista, comALista,
    `a lixeira (o toque com a lista da releitura valendo): o servidor lê ${n.toqueComALista} vezes no KV, e o README diz ${comALista}`);
  for (const caso of ['exclusao', 'exclusaoComALista', 'exclusaoSemToque'])
    assert.equal(n[caso], exclusao, `a exclusão (${caso}): o servidor lê ${n[caso]} vezes no KV, e o README diz ${exclusao}`);
  const vencida = exclusaoVencidaReadme === undefined ? exclusao : exclusaoVencidaReadme;
  assert.equal(n.exclusaoVencida, vencida,
    `a exclusão com a lista do toque vencida: o servidor lê ${n.exclusaoVencida} vezes no KV, e o README diz ${vencida}`);
  for (const caso of ['aprovarSemLixeira', 'aprovarComLixeira'])
    assert.equal(n[caso], aprovar, `aprovar foto (${caso}): o servidor lê ${n[caso]} vezes no KV, e o README diz ${aprovar}`);
});

// ── A extensão ───────────────────────────────────────────────────────────────
// T4/A14: o protocolo do README não tinha o `conta` do `sessao`, e dizia que
// "nenhuma mudança de protocolo" tinha havido depois de duas. As respostas da
// ponte, lidas do CÓDIGO, e o que o README documenta.
test('extensão: o protocolo do README é o que a ponte manda — cada ação, campo e motivo', () => {
  const ponte = ler('extensao-chrome/ponte.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const chamadas = [...ponte.matchAll(/responder\(\{([\s\S]*?)\}\s*\)/g)].map((m) => m[1]);
  assert.ok(chamadas.length >= 5, `CONTROLE: só ${chamadas.length} respostas lidas da ponte — o recorte quebrou`);
  const protocolo = blocos(EXT, 'js').find((b) => b.includes("'wazeplaces-ext'"));
  assert.ok(protocolo, 'CONTROLE: o bloco do protocolo sumiu do README da extensão');
  const falta = [];
  for (const c of chamadas) {
    const acao = (/action:\s*'([^']+)'/.exec(c) || [])[1];
    assert.ok(acao, `CONTROLE: resposta da ponte sem action: ${c}`);
    if (!protocolo.includes(`action: '${acao}'`)) falta.push(`action '${acao}'`);
    // Os campos de cima (fora `action` e o `negado`, cujos campos vêm abaixo).
    const deCima = c.replace(/negado:\s*\{[^}]*\}/g, 'negado');
    for (const [, campo] of deCima.matchAll(/(?:^|[{,])\s*([a-zA-Z]+)\s*(?=[:,}]|$)/g)) {
      if (['action', 'motivo', 'negado'].includes(campo)) continue;
      if (!new RegExp(`action: '${acao}'[^\\n]*\\b${campo}\\b`).test(protocolo)) falta.push(`${acao}.${campo}`);
    }
    for (const [, lit] of (/motivo:\s*([^\n]*)/.exec(c) || ['', ''])[1].matchAll(/'([^']+)'/g)) {
      if (!EXT.includes('`' + lit + '`') && !protocolo.includes(`'${lit}'`)) falta.push(`motivo '${lit}'`);
    }
    const negado = /negado:\s*\{([^}]*)\}/.exec(c);
    if (negado) {
      for (const [, k] of negado[1].matchAll(/([a-zA-Z]+)\s*:/g)) {
        if (!new RegExp(`negado: \\{[^}]*\\b${k}\\b`).test(protocolo)) falta.push(`negado.${k}`);
      }
    }
  }
  assert.deepEqual(falta, [], 'o README da extensão não documenta o que a ponte manda');
  assert.ok(!/Nenhuma mudança de protocolo/.test(EXT), 'o README segue dizendo que o protocolo não mudou');
});

// E o outro lado: a PERGUNTA do app à ponte, cada campo (a `espera`, desde a
// rodada 9, R9-1-02, é o prazo do login da ponte — e quem publica a extensão
// precisa saber que ele existe).
test('extensão: o README documenta a pergunta do app à ponte — cada campo que o app manda', () => {
  const app = ler('js/app.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const m = /postMessage\(\{\s*(source: 'wazeplaces',\s*action: 'precisa-de-sessao'[^}]*)\}/.exec(app);
  assert.ok(m, 'CONTROLE: a pergunta do app à ponte sumiu do app.js');
  const campos = [...m[1].matchAll(/([a-zA-Z]+)\s*:/g)].map((x) => x[1]);
  assert.ok(campos.includes('source') && campos.includes('action'), `CONTROLE: o recorte da pergunta quebrou: ${campos}`);
  const bloco = blocos(EXT, 'js').find((b) => b.includes("action: 'precisa-de-sessao'"));
  assert.ok(bloco, 'CONTROLE: o bloco da pergunta do app sumiu do README da extensão');
  const falta = campos.filter((c) => !new RegExp(`\\b${c}\\s*:`).test(bloco));
  assert.deepEqual(falta, [], 'o README da extensão não documenta o que o app manda na pergunta');
});

// O código que vai pra Web Store (tudo menos o README), sem comentário e sem a
// própria versão do manifesto: mudar comentário não pede publicação; mudar
// código pede. Linha a linha e sem arrancar bloco multilinha, porque o
// `'https://places.wazebrasil.com/*'` do background.js abriria um "bloco" e
// engoliria o resto do arquivo (gotcha #67.1).
function semComentarios(js) {
  const aspasOk = (s) => ['\'', '"', '`'].every((q) => (s.split(q).length - 1) % 2 === 0);
  return js.split('\n').map((l) => {
    if (/^\s*\/\//.test(l)) return '';
    l = l.replace(/\/\*(?:(?!\*\/).)*\*\//g, '');
    const m = /^(.*?[\s;,)])\/\/.*$/.exec(l);
    if (m && aspasOk(m[1])) return m[1].trimEnd();
    return l.trimEnd();
  }).filter((l) => l.trim() !== '').join('\n');
}
function hashDoCodigoDaExtensao() {
  const h = createHash('sha256');
  const dir = new URL('extensao-chrome/', raiz);
  for (const nome of readdirSync(dir).filter((n) => n !== 'README.md').sort()) {
    let conteudo = readFileSync(new URL(nome, dir));
    if (nome.endsWith('.js')) conteudo = Buffer.from(semComentarios(conteudo.toString('utf8')));
    else if (nome === 'manifest.json') {
      const m = JSON.parse(conteudo.toString('utf8'));
      delete m.version;
      conteudo = Buffer.from(JSON.stringify(m));
    }
    h.update(nome + '\0'); h.update(conteudo); h.update('\0');
  }
  return h.digest('hex');
}
// O código de cada versão, medido na história do git: 0.2.0 = e467f08 e
// e7135b0 (este só mudou comentário, e o hash é o mesmo — é o controle do
// normalizador); d85895e (o `negado`) e c6d9f91 (a `conta`) mudaram o código com
// o manifesto parado em 0.2.0, que é o defeito T4. 0.3.1 = o painel com a régua
// do servidor, o alerta na língua do WME e o botão com a conta (rodada 6: R66-1,
// R66-2 e R6-1-10); a 0.3.0 não chegou a ser publicada, e a 0.3.1 a leva junto.
// 0.3.2 = o ACESSAR que trava enquanto loga e volta em qualquer desfecho, e o
// painel que diz o que acontece quando o login falha (rodada 7: R7-1-06 e
// R7-6-07); ainda não publicada, então as duas mudanças são a MESMA versão.
// 0.3.3 = o login do ACESSAR com prazo TOTAL abaixo do teto do botão: nenhuma
// ida depois dele, a que está no ar é cancelada, e a aba não abre depois do
// aviso (rodada 8: R8-6-01 = R8-1-02). 0.3.4 = o login da PONTE com o prazo de
// quem pergunta (a `espera` do app), e um por vez (rodada 9: R9-1-02 = R9-6-02).
const CODIGO_POR_VERSAO = {
  '0.2.0': '70aa3ce409d9449234e3183bfc7f7f8f21b6e769e11431865915657c565144a2',
  '0.3.0': '7183aaef5597ed54d3c68ed709dab8659ba69cda22d6c306e789f3b25fa7f36e',
  '0.3.1': '9845a36bdabe98e5baf540f6cdac90c4d5d5332f7420848334dd2c00bf677596',
  '0.3.2': '5a8fd648c151b022ca3c11b2c30fc980bda1023406b78c785716245e6e78483b',
  '0.3.3': 'fae3ead541b97453a0b66f8ecc6eebf7b333fff4cc6abfbfebdad52bd648d430',
  '0.3.4': '98cbedc9239c03bfef84a9a94056e8b60cab8ad26ee521cd02b09102b2419ff7',
};
const semver = (v) => v.split('.').map(Number);
const antes = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

test('extensão: o código publicado muda JUNTO com a versão do manifesto — e o README diz qual é', () => {
  const man = JSON.parse(ler('extensao-chrome/manifest.json'));
  const h = hashDoCodigoDaExtensao();
  assert.ok(CODIGO_POR_VERSAO[man.version],
    `a versão ${man.version} não está no registro: registre o código dela — '${man.version}': '${h}'`);
  assert.equal(h, CODIGO_POR_VERSAO[man.version],
    `o código da extensão mudou e o manifesto seguiu em ${man.version}: quem tem a extensão publicada fica com o `
    + `comportamento velho, e nada diz que ela precisa ser publicada de novo. Suba a versão no manifest.json e `
    + `registre aqui: '<versão nova>': '${h}'`);
  const versoes = Object.keys(CODIGO_POR_VERSAO).sort(antes);
  assert.equal(versoes.at(-1), man.version, 'o manifesto voltou pra uma versão anterior à mais nova do registro');
  assert.equal(new Set(Object.values(CODIGO_POR_VERSAO)).size, versoes.length, 'duas versões com o MESMO código');
  const v = man.version.replace(/\./g, '\\.');
  assert.match(EXT, new RegExp(`^# .*\\bv${v}\\b`, 'm'), 'o título do README da extensão não é a versão do manifesto');
  assert.match(EXT, new RegExp(`^## v${v}\\b`, 'm'), 'o README da extensão não tem a seção da versão do manifesto (o que mudou nela)');
});

test('extensão: CONTROLE do normalizador — comentário não conta, código conta, URL em texto fica', () => {
  assert.equal(semComentarios('a(); // um\n// dois\nb();'), semComentarios('a(); // outro\nb(); /* três */'));
  assert.notEqual(semComentarios('a();'), semComentarios('b();'));
  assert.equal(semComentarios("const u = 'https://x.com/*';"), "const u = 'https://x.com/*';");
  assert.equal(semComentarios("x = '// não é comentário';"), "x = '// não é comentário';");
});
