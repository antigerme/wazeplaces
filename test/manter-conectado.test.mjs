// "Manter conectado" — o lado do CLIENTE (Preferências).
//
// O Waze invalida o cookie ~24 h depois se ninguém o renova; com o interruptor
// ligado o servidor (um Cron) renova a sessão uma ou duas vezes por dia. O que o
// cliente promete, e cada teste aqui existe pra reprovar se uma promessa quebrar:
//   1. o padrão mora em UMA constante (`MANTER_CONECTADO_PADRAO`), opt-OUT;
//   2. o `perfil` manda `manter` (booleano ESTRITO) só com a preferência definida,
//      e `API.manterConectado(on)` fala `sessao` com `action: 'manter'`;
//   3. o gesto salva, avisa o servidor e, se não deu, VOLTA ao estado real com um
//      aviso — nunca fica ligado sobre um servidor que não ligou;
//   4. o "Sair" volta ao de fábrica, e a troca de conta decide o que fica (escrito);
//   5. a Ajuda diz a verdade (a garantia vale SEM o interruptor; COM ele, não);
//   6. o relatório do diagnóstico diz se está ligado e o que o servidor respondeu.
//
// O app.js é script de browser: o teste FATIA a fonte e a executa num escopo de
// mentira (gotcha #52 — o código que roda no aparelho, não uma cópia).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const lerArq = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = lerArq('js/app.js');
const API_SRC = lerArq('js/api.js');
const I18N = lerArq('js/i18n.js');
const HTML = lerArq('index.src.html');

// Sem comentário (gotcha #67: guard que lê o código lê só CÓDIGO), por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP_SEM = semComentario(APP);

// Âncora em DECLARAÇÃO; fecha na próxima declaração de topo.
function fatiarFuncao(nome, fonte = APP_SEM) {
  const m = new RegExp(`^(?:async )?function ${nome}\\(`, 'm').exec(fonte);
  assert.ok(m, `a função ${nome} sumiu do app.js`);
  const resto = fonte.slice(m.index + 1);
  const fim = resto.search(/\n(?:async function |function |const |let |class )/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return fonte.slice(m.index, m.index + 1 + fim);
}

function dicionario() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(I18N + '\nthis.D = I18N_DICT;', ctx);
  return ctx.D;
}
const D = dicionario();
const LINGUAS = ['pt', 'en', 'es', 'fr'];

// ── 1. O PADRÃO: uma constante só ───────────────────────────────────────────
test('o padrão mora em UMA constante nomeada, e ela é o que a fábrica, a leitura e o HTML usam', () => {
  const m = /^const MANTER_CONECTADO_PADRAO = (true|false);/m.exec(APP_SEM);
  assert.ok(m, 'sumiu a constante MANTER_CONECTADO_PADRAO');
  assert.equal(m[1], 'true', 'o padrão decidido é LIGADO (opt-out); mudou? confirme com o dono e acerte os textos');
  // A fábrica a lê.
  const fab = new Function('MANTER_CONECTADO_PADRAO', fatiarFuncao('preferenciasDeFabrica') + '\nreturn preferenciasDeFabrica;');
  assert.equal(fab(true)().manterConectado, true);
  assert.equal(fab(false)().manterConectado, false, 'a fábrica não segue a constante: virar o padrão exigiria mexer em dois lugares');
  // A leitura do aparelho a lê (nenhum `true`/`false` à mão pro padrão).
  const leitura = fatiarFuncao('lerPreferenciasGuardadas');
  assert.match(leitura, /manterConectado = typeof parsed\.manterConectado === 'boolean'\s*\?\s*parsed\.manterConectado\s*:\s*MANTER_CONECTADO_PADRAO/);
  // Nenhum OUTRO lugar escreve o padrão como literal na preferência (fora o gesto e a volta).
  const fora = APP_SEM.replace(fatiarFuncao('aoMudarManterConectado'), '')
    .match(/manterConectado\s*[:=]\s*(?:true|false)\b/g) || [];
  assert.deepEqual(fora, [], 'a preferência recebeu um literal fora da constante: ' + fora.join(' | '));
  // O `checked` do HTML (o primeiro quadro) acompanha a constante.
  const input = /<input id="prefManterConectado"[^>]*>/.exec(HTML);
  assert.ok(input, 'sumiu o interruptor do HTML');
  assert.equal(/\schecked\b/.test(input[0]), m[1] === 'true', 'o `checked` do HTML diverge do padrão');
});

test('a leitura do aparelho: sem a chave vale o padrão; só BOOLEANO muda (nada de coerção)', () => {
  const montar = (guardado) => {
    const AppState = { preferences: { ...{ manterConectado: true } } };
    const localStorage = { getItem: () => (guardado === undefined ? null : JSON.stringify(guardado)) };
    const fn = new Function('AppState', 'localStorage', 'PREFERENCES_KEY', 'MANTER_CONECTADO_PADRAO',
      fatiarFuncao('lerPreferenciasGuardadas') + '\nreturn lerPreferenciasGuardadas;')(AppState, localStorage, 'k', true);
    fn();
    return AppState.preferences.manterConectado;
  };
  assert.equal(montar({}), true, 'quem nunca abriu as Preferências fica no padrão (ligado)');
  assert.equal(montar({ manterConectado: false }), false, 'quem desligou fica desligado');
  assert.equal(montar({ manterConectado: true }), true);
  assert.equal(montar({ manterConectado: 'false' }), true, 'a string "false" não é um "desligado": só booleano vale');
  assert.equal(montar({ manterConectado: 0 }), true);
  assert.equal(montar(undefined), true, 'sem nada guardado (nem o objeto) fica no padrão');
});

// ── 2. O CONTRATO COM O SERVIDOR ────────────────────────────────────────────
// `api.js` DE VERDADE num contexto do vm, com o `fetch` anotando o que sai.
function apiDeVerdade({ manter, sessao = 'tok-1' } = {}) {
  const enviados = [];
  const ctx = {
    navigator: { language: 'pt', onLine: true },
    document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console, setTimeout, clearTimeout, performance, AbortController,
    fetch: async (url, opt) => {
      enviados.push({ url: String(url), corpo: JSON.parse(opt.body) });
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ success: true, manterConectado: true }) };
    },
  };
  ctx.window = {};
  if (manter !== 'sem-funcao') ctx.manterConectadoParaOServidor = () => manter;
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + API_SRC + '\nthis.API = API;', ctx);
  ctx.API.sessionToken = sessao;
  return { API: ctx.API, enviados };
}

test('a PREFERÊNCIA é lida antes do primeiro `perfil` da abertura — senão o `manter` nunca vai na ida que mais importa', () => {
  // Do começo do `initApp` em diante (a função é longa e tem blocos próprios; o que se cobra é a ORDEM das duas chamadas).
  const ini = APP_SEM.search(/^function initApp\(/m);
  assert.ok(ini >= 0, 'sumiu o initApp');
  const init = APP_SEM.slice(ini);
  const iPref = init.indexOf('loadPreferences();');
  const iPerfil = init.indexOf('loadProfileAndAuxData()');
  assert.ok(iPref > 0 && iPerfil > 0, 'CONTROLE: o recorte do initApp não achou as duas chamadas');
  assert.ok(iPref < iPerfil, 'o `perfil` da abertura sai antes de as preferências serem lidas: `manterConectadoParaOServidor` devolveria undefined');
});

test('perfil: manda `manter` BOOLEANO quando a preferência está definida — e NADA quando não está', async () => {
  for (const [valor, esperado] of [[true, true], [false, false]]) {
    const { API, enviados } = apiDeVerdade({ manter: valor });
    await API.getProfile();
    assert.equal(enviados.length, 1);
    assert.match(enviados[0].url, /\/perfil$/);
    assert.strictEqual(enviados[0].corpo.manter, esperado, 'o `manter` tem que ir como booleano estrito');
  }
  for (const nada of [undefined, null, 'true', 1]) {
    const { API, enviados } = apiDeVerdade({ manter: nada });
    await API.getProfile();
    assert.ok(!('manter' in enviados[0].corpo), `preferência indefinida (${String(nada)}) não pode mandar \`manter\`: ligaria no servidor o que a pessoa ainda não decidiu`);
  }
  const sem = apiDeVerdade({ manter: 'sem-funcao' });
  await sem.API.getProfile();
  assert.ok(!('manter' in sem.enviados[0].corpo), 'sem a função do app (harness), nada vai');
  // O perfil de OUTRO servidor (`regiao`) leva a mesma preferência: ela é da sessão.
  const o = apiDeVerdade({ manter: true });
  await o.API.getProfile('il');
  assert.equal(o.enviados[0].corpo.region, 'il');
});

test('API.manterConectado(on): POST `sessao` com action "manter", `on` booleano estrito e a região', async () => {
  const { API, enviados } = apiDeVerdade({});
  const r = await API.manterConectado(true);
  assert.equal(r.success, true);
  assert.match(enviados[0].url, /\/sessao$/);
  assert.deepEqual(Object.keys(enviados[0].corpo).sort(), ['action', 'on', 'region', 'sessionToken']);
  assert.equal(enviados[0].corpo.action, 'manter');
  assert.strictEqual(enviados[0].corpo.on, true);
  assert.equal(enviados[0].corpo.sessionToken, 'tok-1');
  await API.manterConectado(false);
  assert.strictEqual(enviados[1].corpo.on, false);
  // Coerção é o risco real (`'false'` é truthy): só `true` liga.
  await API.manterConectado('false');
  await API.manterConectado(1);
  assert.strictEqual(enviados[2].corpo.on, false);
  assert.strictEqual(enviados[3].corpo.on, false);
  // Sem sessão: nada sai.
  const sem = apiDeVerdade({ sessao: null });
  const rs = await sem.API.manterConectado(true);
  assert.equal(rs.success, false);
  assert.equal(sem.enviados.length, 0, 'sem sessão o interruptor não pode ir à rede');
});

test('API.manterConectado não retenta e não tem rota nova no `_post` — é gesto; o `perfil` é o que repete', () => {
  const corpo = /async manterConectado\(on\) \{[\s\S]*?\n    \},/.exec(API_SRC);
  assert.ok(corpo, 'sumiu API.manterConectado');
  assert.doesNotMatch(corpo[0], /callWithRetry|for \(|while \(/, 'o interruptor ganhou retentativa: é gesto, e o free tier conta cada ida');
});

test('manterConectadoParaOServidor: indefinido ANTES de ler o aparelho; depois, booleano estrito', () => {
  const montar = (preferenciasCarregadas, prefs) => new Function('AppState', 'preferenciasCarregadas',
    fatiarFuncao('manterConectadoParaOServidor') + '\nreturn manterConectadoParaOServidor();')({ preferences: prefs }, preferenciasCarregadas);
  assert.strictEqual(montar(false, { manterConectado: true }), undefined);
  assert.strictEqual(montar(true, { manterConectado: true }), true);
  assert.strictEqual(montar(true, { manterConectado: false }), false);
  assert.strictEqual(montar(true, {}), true, 'preferência sem a chave vale o padrão (!== false), e vai como booleano');
  assert.strictEqual(montar(true, { manterConectado: 'false' }), true);
});

// ── 3. O GESTO: salva, avisa e, se falhar, VOLTA ───────────────────────────
function gesto({ resposta, prefs = { manterConectado: true }, servidor = null } = {}) {
  const log = [];
  const AppState = { preferences: { ...prefs }, manterDoServidor: servidor };
  let epoca = 0;
  const deps = {
    AppState,
    API: { manterConectado: async (on) => { log.push('api:' + on); return typeof resposta === 'function' ? resposta(on, log) : resposta; } },
    savePreferences: () => log.push('salvou:' + AppState.preferences.manterConectado),
    desenharChavesDePreferencia: () => log.push('desenhou'),
    showToast: (m, tipo) => log.push('toast:' + m + ':' + tipo),
    t: (k) => k, dfato: (k) => log.push('dfato:' + k),
    getEpoca: () => epoca,
  };
  const nomes = Object.keys(deps);
  const fn = new Function(...nomes,
    `let epocaDaSessao = 0; let manterNoAr = 0; let manterVez = 0;\n${fatiarFuncao('aoMudarManterConectado')}\n`
    + 'return { aoMudar: aoMudarManterConectado, sair() { epocaDaSessao++; }, noAr() { return manterNoAr; } };')(...nomes.map((n) => deps[n]));
  return { ...fn, log, AppState, ate: () => new Promise((r) => setImmediate(r)) };
}

test('gesto: dá certo → salva ANTES de ir à rede, manda `on` estrito, e não avisa nada', async () => {
  const g = gesto({ resposta: { success: true, manterConectado: false } });
  await g.aoMudar(false);
  assert.deepEqual(g.log, ['salvou:false', 'api:false'], 'primeiro salva (o gesto vale mesmo sem rede), depois avisa o servidor');
  assert.equal(g.AppState.preferences.manterConectado, false);
  assert.equal(g.AppState.manterDoServidor, false, 'o que o servidor confirmou fica anotado (o relatório mostra)');
  assert.equal(g.noAr(), 0);
});

test('gesto: a rede cai (a chamada LANÇA) → volta ao estado de antes, salva, redesenha e AVISA', async () => {
  const g = gesto({ resposta: () => { throw new Error('rede'); } });
  await g.aoMudar(false);
  assert.equal(g.AppState.preferences.manterConectado, true, 'ficou desligado sobre um servidor que não desligou: estado enganoso');
  assert.deepEqual(g.log.filter((x) => !x.startsWith('dfato')), ['salvou:false', 'api:false', 'salvou:true', 'desenhou', 'toast:toast.manterFalhou:error']);
});

test('gesto: o servidor recusa (success false) → mesmo desfecho; o `perfil` não é derrubado por isso', async () => {
  const g = gesto({ resposta: { success: false, error: 'x', errorCategory: 'unauthorized' } });
  await g.aoMudar(false);
  assert.equal(g.AppState.preferences.manterConectado, true);
  assert.ok(g.log.includes('toast:toast.manterFalhou:error'));
  assert.ok(!g.log.some((x) => /sess|logout|Unauthorized/i.test(x)), 'o interruptor não pode derrubar a sessão');
});

test('gesto: sem sessão ou resposta sem o campo (servidor antigo) → também volta (nunca "ligado" sem prova)', async () => {
  for (const resposta of [{ success: true }, { success: false, errorCategory: 'unknown' }, null, undefined]) {
    const g = gesto({ resposta, prefs: { manterConectado: false } });
    await g.aoMudar(true);
    assert.equal(g.AppState.preferences.manterConectado, false, `resposta ${JSON.stringify(resposta)}: o interruptor ficou ligado sem o servidor confirmar`);
  }
});

test('gesto: o servidor respondeu com OUTRO estado → vale o dele (estado real), com aviso', async () => {
  const g = gesto({ resposta: { success: true, manterConectado: false } });
  await g.aoMudar(true);
  assert.equal(g.AppState.preferences.manterConectado, false);
  assert.equal(g.AppState.manterDoServidor, false);
  assert.ok(g.log.includes('toast:toast.manterFalhou:error'));
});

test('gesto: a falha de quem o servidor JÁ tem como a pessoa pediu não desfaz nada (sem aviso falso)', async () => {
  const g = gesto({ resposta: { success: false }, prefs: { manterConectado: false }, servidor: true });
  await g.aoMudar(true);
  assert.equal(g.AppState.preferences.manterConectado, true);
  assert.ok(!g.log.some((x) => x.startsWith('toast:')), 'avisou "não deu" com o servidor já do jeito pedido');
});

test('gesto: duas trocas seguidas — só a resposta da ÚLTIMA decide, venha na ordem que vier', async () => {
  const liberar = [];
  const g = gesto({ resposta: (on) => new Promise((ok) => liberar.push(() => ok({ success: false }))) });
  const a = g.aoMudar(false);   // liga → desliga
  const b = g.aoMudar(true);    // e logo religa
  liberar[1]();                 // a mais nova falha primeiro
  await b;
  liberar[0]();                 // a velha falha depois: não pode desfazer por cima
  await a;
  // Só uma volta: a da mais nova (antes dela a preferência estava em `false`).
  assert.equal(g.log.filter((x) => x.startsWith('toast:')).length, 1, 'a resposta velha também mexeu na chave');
  assert.equal(g.AppState.preferences.manterConectado, false);
});

test('gesto: o "Sair" (ou a queda) no meio → a resposta tardia não escreve nada', async () => {
  let liberar;
  const g = gesto({ resposta: () => new Promise((ok) => { liberar = () => ok({ success: false }); }) });
  const p = g.aoMudar(false);
  const antes = g.log.length;
  g.sair();
  liberar();
  await p;
  assert.equal(g.log.length, antes, 'a resposta de uma sessão que acabou gravou preferência/avisou');
});

test('ouvinte: o interruptor chama o gesto com o estado ESTRITO do checkbox; abrir a aba o redesenha sem desfazer uma troca no ar', () => {
  assert.match(APP_SEM, /\$\('prefManterConectado'\)\.addEventListener\('change', \(e\) => \{ aoMudarManterConectado\(e\.target\.checked\); \}\);/);
  assert.match(fatiarFuncao('desenharChavesDePreferencia'), /marcar\('prefManterConectado', p\.manterConectado !== false\);/);
  assert.match(fatiarFuncao('renderPularGuardaPref'), /manterNoAr === 0\) manter\.checked = AppState\.preferences\.manterConectado !== false;/);
});

// ── 4. O "SAIR" E A TROCA DE CONTA ──────────────────────────────────────────
test('o "Sair" não ganha chamada nova (a `sessao destroy` já apaga o keepalive) e volta ao de fábrica', () => {
  const sair = fatiarFuncao('handleLogout');
  assert.match(sair, /AppState\.preferences = preferenciasDeFabrica\(\);/, 'o "Sair" deixou de repor a fábrica — o interruptor sobraria do dono anterior');
  assert.doesNotMatch(sair, /manterConectado\(/, 'o "Sair" chamou a rota do interruptor: o servidor apaga o keepalive no destroy');
  assert.match(sair, /AppState\.manterDoServidor = null;/, 'o que o servidor disse era da sessão que saiu');
  // Nenhuma chave nova de aparelho: a preferência mora no blob de preferências (que o "Sair" repõe).
  assert.ok(!/waze_places_manter/.test(APP), 'chave nova no localStorage precisa de decisão de logout (layout.test varre `waze*`)');
});

test('a troca de conta: o interruptor FICA (escolha do aparelho), o que o servidor disse sai', () => {
  const f = fatiarFuncao('esquecerEscolhasDaContaAnterior');
  assert.doesNotMatch(f, /prefs\.manterConectado\s*=/, 'a troca de conta passou a mexer na escolha do aparelho');
  assert.match(f, /AppState\.manterDoServidor = null;/);
  assert.match(f, /AppState\.manterEnviado = null;/);
  // E o `perfil` da conta nova anota o que o servidor disse DEPOIS da troca.
  const def = fatiarFuncao('definirPerfil');
  const iConta = def.indexOf('aoConhecerConta(perfil);');
  const iAnota = def.indexOf("AppState.manterDoServidor = res.manterConectado;");
  assert.ok(iConta > 0 && iAnota > iConta, 'o estado do servidor é anotado antes da troca de conta e a troca o apagaria');
});

// ── 5. TEXTO: nas 4 línguas, e a Ajuda diz a verdade ────────────────────────
test('i18n: título, descrição e aviso nas 4 línguas; o rótulo do HTML é o do dicionário pt', () => {
  for (const l of LINGUAS) {
    for (const k of ['prefs.manter.label', 'prefs.manter.desc', 'toast.manterFalhou']) {
      assert.ok(D[l][k] && D[l][k].length > 5, `${l}: falta ${k}`);
    }
    assert.doesNotMatch(D[l]['prefs.manter.desc'], /\d/, `${l}: a descrição escreve um número (de horas?) — só "uma ou duas vezes por dia" (o 1 e o 2 são palavras)`);
  }
  assert.match(HTML, new RegExp(`data-i18n="prefs.manter.label">${D.pt['prefs.manter.label']}<`));
  assert.match(HTML, new RegExp(`data-i18n="prefs.manter.desc">${D.pt['prefs.manter.desc'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
  // "app" é MASCULINO em português.
  assert.doesNotMatch(D.pt['prefs.manter.desc'] + D.pt['help.privacy.zeroKnowledge'], /\b(?:na|da|esta|uma|pela) app\b/i);
});

test('a descrição é honesta: o ganho, o preço e o desligar apaga — nas 4 línguas', () => {
  const ESPERADO = {
    pt: [/uma ou duas vezes por dia/, /sem o seu aparelho/, /Desligar apaga/],
    en: [/once or twice a day/, /without your device/, /Turning it off erases/],
    es: [/una o dos veces al día/, /sin tu dispositivo/, /Al desactivarlo, se borra/],
    fr: [/une ou deux fois par jour/, /sans votre appareil/, /Le désactiver efface/],
  };
  for (const l of LINGUAS) {
    assert.ok(ESPERADO[l], `CONTROLE: língua nova (${l}) sem a frase esperada neste teste`);
    for (const re of ESPERADO[l]) assert.match(D[l]['prefs.manter.desc'], re, `${l}: a descrição perdeu "${re}"`);
  }
});

test('Ajuda/Privacidade: a garantia do servidor vale SEM o interruptor; COM ele, não — e cita o NOME dele', () => {
  const CITA = { pt: '“Manter conectado”', en: '“Stay logged in”', es: '«Mantener conectado»', fr: '« Rester connecté »' };
  const SEM = { pt: /vale <strong>sem<\/strong>/, en: /holds <strong>without<\/strong>/, es: /vale <strong>sin<\/strong>/, fr: /vaut <strong>sans<\/strong>/ };
  const COM = { pt: /com ele <strong>ligado<\/strong>, o servidor guarda uma chave/, en: /with it <strong>on<\/strong>, the server keeps a key/,
    es: /con él <strong>activado<\/strong>, el servidor guarda una clave/, fr: /avec lui <strong>activé<\/strong>, le serveur conserve une clé/ };
  const APAGA = { pt: /“Sair” \(a chave desta sessão é apagada\)/, en: /“Log out” \(this session’s key is erased\)/, es: /«Salir» \(la clave de esta sesión se borra\)/, fr: /« Se déconnecter » \(la clé de cette session est effacée\)/ };
  for (const l of LINGUAS) {
    const z = D[l]['help.privacy.zeroKnowledge'];
    assert.ok(z.includes(CITA[l]), `${l}: a Ajuda não cita o nome do interruptor (${CITA[l]})`);
    assert.ok(D[l]['prefs.manter.label'] === CITA[l].replace(/[“”«»]/g, '').trim(), `${l}: o nome citado na Ajuda não é o do interruptor`);
    assert.match(z, SEM[l], `${l}: a Ajuda não diz que a garantia vale SEM o interruptor`);
    assert.match(z, COM[l], `${l}: a Ajuda não diz o que muda COM o interruptor`);
    assert.match(z, APAGA[l], `${l}: a Ajuda não diz que o “Sair” apaga a chave`);
    assert.ok(z.includes('{parearMin}'), `${l}: a exceção do código de pareamento (e o prazo) sumiu da frase`);
    assert.ok(D[l]['help.privacy.server'].includes(CITA[l]), `${l}: "a única outra coisa é passageira" voltou a ser falso com o interruptor ligado`);
  }
});

test('o interruptor é a ÚLTIMA linha da aba Preferências: nenhuma outra mudou de lugar', () => {
  const iOff = HTML.indexOf('id="prefOfflineDisponivel"');
  const iMan = HTML.indexOf('id="prefManterConectado"');
  const iHist = HTML.indexOf('id="filtersPanelHistory"');
  assert.ok(iOff > 0 && iMan > iOff && iMan < iHist, 'a linha nova não é a última da aba (empurraria as outras)');
  // No molde das vizinhas: o mesmo rótulo de 44px, o texto que encolhe e o `ui-switch`.
  const linha = HTML.slice(HTML.lastIndexOf('<label', iMan), HTML.indexOf('</label>', iMan));
  assert.match(linha, /class="flex items-center justify-between gap-3 text-sm cursor-pointer min-h-\[44px\]"/);
  assert.match(linha, /<span class="min-w-0 break-words">/);
  assert.match(linha, /class="ui-switch"/);
  assert.match(linha, /text-xs text-slate-600 dark:text-slate-300/, 'a descrição saiu do molde das vizinhas');
});

// ── 6. DIAGNÓSTICO ──────────────────────────────────────────────────────────
test('diag: o relatório diz se o interruptor está ligado e o que o servidor respondeu — sem dado de terceiro', () => {
  const ent = (prefs, servidor) => new Function('AppState', 'MANTER_CONECTADO_PADRAO',
    fatiarFuncao('diagManterConectado') + '\nreturn diagManterConectado();')({ preferences: prefs, manterDoServidor: servidor, profile: { id: 1, userName: 'segredo' } }, true);
  assert.deepEqual(ent({ manterConectado: false }, true), { ligado: false, servidor: true, padrao: true });
  assert.deepEqual(ent({}, null), { ligado: true, servidor: null, padrao: true }, 'servidor desconhecido é null, não "desligado"');
  assert.match(APP_SEM, /^\s+manterConectado: diagManterConectado\(\),$/m, 'o relatório deixou de levar a seção');
});

// ── 7. O interruptor nunca mostra o que o servidor não tem ─────────────────
test('perfil: a resposta volta com `manterEnviado` (o que ESTA ida mandou) — nada quando não mandou', async () => {
  const a = apiDeVerdade({ manter: false });
  const r = await a.API.getProfile();
  assert.strictEqual(r.manterEnviado, false);
  assert.strictEqual(r.manterConectado, true, 'a resposta do servidor segue como veio');
  const b = apiDeVerdade({ manter: undefined });
  assert.ok(!('manterEnviado' in (await b.API.getProfile())));
});

function conciliar({ pref, servidor, enviado, noAr = 0 }) {
  const log = [];
  const AppState = { preferences: { manterConectado: pref }, manterDoServidor: servidor, manterEnviado: enviado };
  const fn = new Function('AppState', 'dfato', 'savePreferences', `let manterNoAr = ${noAr};\n${fatiarFuncao('conciliarManterComOServidor')}\nreturn conciliarManterComOServidor;`)(
    AppState, (k) => log.push('dfato:' + k), () => log.push('salvou:' + AppState.preferences.manterConectado));
  fn();
  return { AppState, log };
}

test('conciliar: o servidor disse OUTRA coisa ao que a pessoa tem hoje → a chave mostra e grava a verdade', () => {
  const m = conciliar({ pref: true, servidor: false, enviado: true });
  assert.equal(m.AppState.preferences.manterConectado, false, 'a chave seguiu ligada sobre um servidor que está desligado');
  assert.deepEqual(m.log, ['dfato:manter.divergiu', 'salvou:false']);
  const n = conciliar({ pref: false, servidor: true, enviado: false });
  assert.equal(n.AppState.preferences.manterConectado, true);
});

test('conciliar: não mexe quando concorda, quando a resposta é velha, quando há troca no ar ou o servidor não disse nada', () => {
  for (const c of [
    { pref: true, servidor: true, enviado: true },        // concordam
    { pref: false, servidor: true, enviado: true },       // a pessoa trocou DEPOIS do pedido: a resposta é velha
    { pref: true, servidor: false, enviado: null },       // sem saber a que a resposta responde
    { pref: true, servidor: false, enviado: true, noAr: 1 }, // troca no ar
    { pref: true, servidor: null, enviado: true },        // servidor sem o recurso / resposta sem o campo
  ]) {
    const m = conciliar(c);
    assert.equal(m.AppState.preferences.manterConectado, c.pref, 'mexeu onde não devia: ' + JSON.stringify(c));
    assert.deepEqual(m.log, [], 'gravou/anotou onde não devia: ' + JSON.stringify(c));
  }
});

test('conciliar roda quando as Preferências abrem; `definirPerfil` guarda o `manterEnviado`; o gesto invalida a resposta velha', () => {
  assert.match(fatiarFuncao('renderPularGuardaPref'), /conciliarManterComOServidor\(\);\s*const manter = document\.getElementById\('prefManterConectado'\);/);
  assert.match(fatiarFuncao('definirPerfil'), /AppState\.manterEnviado = typeof res\.manterEnviado === 'boolean' \? res\.manterEnviado : null;/);
  assert.match(fatiarFuncao('aoMudarManterConectado'), /AppState\.manterEnviado = null;/);
});

test('Ajuda: o que o app faz EM SEU NOME inclui a renovação da sessão pelo servidor (com o nome do interruptor)', () => {
  const CITA = { pt: '“Manter conectado”', en: '“Stay logged in”', es: '«Mantener conectado»', fr: '« Rester connecté »' };
  for (const l of LINGUAS) {
    const c = D[l]['help.privacy.credentials'];
    assert.ok(c.includes(CITA[l]), `${l}: as credenciais não dizem que o servidor renova a sessão com o interruptor ligado`);
    assert.ok(c.indexOf(CITA[l]) > c.indexOf(';'), `${l}: a frase nova caiu dentro da enumeração de ações (o teste da conjunção a lê)`);
  }
});
