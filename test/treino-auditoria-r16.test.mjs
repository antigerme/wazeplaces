// Treino e Preferências (auditoria da rodada 16, lote 20).
//
//   R16-7-01 — no ÚLTIMO exemplo do treino o card "fica na tela enquanto o aviso é
//              lido", mas ele já saiu pela animação do swipe; com o ✓ ele fica em
//              `translateX(+1,5 largura)`, à direita, e isso conta na largura do
//              conteúdo: no Chromium do celular o viewport de layout CRESCE
//              (innerWidth 1095 num aparelho de 393) e o "Treino concluído" cai fora
//              dos 393 px que a pessoa vê; no WebKit é o `scrollWidth`. Hoje o card
//              sai da conta (`display: none`). O que se mede no navegador está em
//              tools/smoke-browser.mjs (bloco "Treino concluído").
//   R16-7-03 — o modo dev desligado noutra aba não redesenhava a chave do Desfazer.
//   R16-7-04 — a Privacidade dizia que depois do "Sair" ficam SÓ o idioma e o tema.
//   R16-7-05 — a chave do Desfazer travada não apontava pra frase do motivo.
//   R16-7-06 — o "Como funciona" aberto sozinho deixava o foco em "Quero treinar
//              antes" (o Enter começava o treino em vez de dispensar o aviso).
//
// Os testes RODAM o código de verdade (fatiado do app.js, num escopo só); o que o
// teste não fornece é um "buraco negro" que aceita qualquer chamada. Cada um foi
// visto REPROVANDO com o conserto desfeito (as sabotagens estão no relatório).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = ler('js/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const HTML = ler('index.src.html');

function fechar(txt, i, abre = '{', fecha = '}') {
  let prof = 0;
  for (let j = txt.indexOf(abre, i); j < txt.length; j++) {
    if (txt[j] === abre) prof++;
    else if (txt[j] === fecha) { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
function treinoDeVerdade() {
  const m = /^const Treino = /m.exec(APP_SEM);
  assert.ok(m, 'o objeto Treino sumiu do app.js');
  return APP_SEM.slice(m.index, fechar(APP_SEM, m.index + m[0].length)) + ';';
}
function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
function rodar(deps, fontes, devolve) {
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : typeof k === 'string' ? buracoNegro() : undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('__escopo', `with (__escopo) {\n${fontes.join('\n')}\nreturn { ${devolve.join(', ')} };\n}`)(escopo);
}
function elemento() {
  const classes = new Set(['hidden']);
  return {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    textContent: '', disabled: false, checked: false, focado: 0,
    focus() { this.focado++; }, removeAttribute() {}, setAttribute() {},
  };
}

// ═══ R16-7-01 · o último exemplo sai da conta de layout ═══
// Um card de verdade tem `style`; o `document` de mentira entrega os que casam
// com o seletor da pilha, e só esse.
function montarFimDoTreino(restamNaFila) {
  const cards = [{ style: {} }];
  const els = {};
  const fila = Array.from({ length: restamNaFila }, (_, i) => ({ venueID: 'v' + i, updateRequestID: 'treino-inerte', _treino: true }));
  const AppState = { queue: fila, currentPlace: fila[0], preferences: { pularGuarda: false } };
  const deps = {
    AppState,
    document: {
      getElementById: (id) => (els[id] = els[id] || elemento()),
      querySelectorAll: (sel) => (sel === '#cardStack .place-card' ? cards : []),
    },
    t: (k) => k, showToast: () => ({ remover() {} }), semJanelaDeDesfazer: () => false,
    trocarTextoI18n: () => {}, openModal: () => {},
  };
  const app = rodar(deps, [fatiar('tirarDaContaOCardQueSaiu'), treinoDeVerdade()], ['Treino']);
  app.Treino.ativo = true;
  app.Treino.restam = restamNaFila;
  return { app, cards, AppState };
}

test('R16-7-01: no ÚLTIMO exemplo o card que já saiu da vista sai da conta de layout — ✓, ✕ e ↑', () => {
  for (const tipo of ['read', 'reject', 'skip']) {
    const m = montarFimDoTreino(1);
    m.app.Treino.agir(tipo);
    assert.equal(m.AppState.queue.length, 0, `PRÉ-CONDIÇÃO (${tipo}): sobrou exemplo na fila`);
    assert.equal(m.cards[0].style.display, 'none',
      `DEFEITO (${tipo}): o card do último exemplo segue na conta de layout — fora da vista à direita ele alarga a página e o "Treino concluído" cai fora da tela (R16-7-01)`);
  }
});

test('R16-7-01: CONTROLE — com exemplos na fila o card NÃO é escondido por esta via (quem o troca é o removeCurrentCardEl)', () => {
  const m = montarFimDoTreino(3);
  m.app.Treino.agir('read');
  assert.equal(m.AppState.queue.length, 2, 'PRÉ-CONDIÇÃO: a fila não andou');
  assert.equal(m.cards[0].style.display, undefined, 'o caminho dos cards seguintes mexeu no card (R16-7-01)');
});

test('R16-7-01: a chamada mora DEPOIS do retorno dos exemplos que sobram — o caminho dos cards reais não é tocado', () => {
  const agir = fatiarMetodo('agir');
  const iRetorno = agir.indexOf('if (AppState.currentPlace) { removeCurrentCardEl(); showCurrentPlace(); return; }');
  const iEscondeu = agir.indexOf('tirarDaContaOCardQueSaiu();');
  assert.ok(iRetorno >= 0, 'o retorno dos exemplos que sobram mudou de forma — o instrumento ficou cego');
  assert.ok(iEscondeu > iRetorno, 'tirarDaContaOCardQueSaiu() precisa vir DEPOIS do retorno dos exemplos que sobram');
  // O alvo é o card do #cardStack e nada além; sem `visibility`/`opacity` (que
  // seguem contando na largura).
  const corpo = fatiar('tirarDaContaOCardQueSaiu');
  assert.match(corpo, /querySelectorAll\('#cardStack \.place-card'\)/);
  assert.match(corpo, /style\.display = 'none'/, '`display: none` é o que tira da conta; visibility e opacity não tiram');
});
function fatiarMetodo(nome) {
  const t = treinoDeVerdade();
  const m = new RegExp('^    ' + nome + '\\(', 'm').exec(t);
  assert.ok(m, `Treino.${nome} sumiu`);
  return t.slice(m.index, fechar(t, t.indexOf('{', m.index)));
}

// ═══ R16-7-03 · o modo dev desligado noutra aba redesenha a chave do Desfazer ═══
function montarChaveDoDesfazer({ devAntes, devDepois, tratados = 2, cota = 30 }) {
  const els = { prefUndoEnabled: elemento(), prefUndoGateMsg: elemento() };
  const AppState = { devMode: devAntes, preferences: { undoEnabled: false } };
  const dep = { guardado: devDepois };
  const deps = {
    AppState, DEVMODE_KEY: 'k', preferenciasCarregadas: true,
    document: { getElementById: (id) => els[id] },
    localStorage: { getItem: () => JSON.stringify(dep.guardado) },
    t: (k, v) => k + (v ? JSON.stringify(v) : ''),
    getUndoTreatedCount: () => tratados, getUndoUnlockThreshold: () => cota,
    updateDevBadge() {}, renderDevModeSection() {}, diagAjustarRecursos() {}, dlogApagar() {},
    enforceDevGatedFilters() {}, atualizarFabDev() {}, savePreferences() {},
  };
  const app = rodar(deps, ['devModeDoArmazenamento', 'aoMudarModoDevEmOutraAba', 'renderUndoGateUI', 'canDisableUndo',
    'initUndoGateSeen'].map(fatiar), ['aoMudarModoDevEmOutraAba', 'renderUndoGateUI']);
  return { app, els, AppState };
}

test('R16-7-03: o modo dev desligado noutra aba trava a chave do Desfazer aqui — com a frase "falta N" —, e ligado a libera', () => {
  // Com o modo dev ligado a chave está livre (o gate é ignorado).
  const m = montarChaveDoDesfazer({ devAntes: { unlocked: true, active: true }, devDepois: { unlocked: true, active: false } });
  m.app.renderUndoGateUI();
  assert.equal(m.els.prefUndoEnabled.disabled, false, 'PRÉ-CONDIÇÃO: com o dev ligado e abaixo da cota a chave devia estar livre');
  assert.equal(m.els.prefUndoGateMsg.classList.contains('hidden'), true, 'PRÉ-CONDIÇÃO: a frase devia estar escondida');
  // A OUTRA aba desliga o modo dev; o aviso do navegador chega aqui.
  m.app.aoMudarModoDevEmOutraAba();
  assert.equal(m.AppState.devMode.active, false, 'PRÉ-CONDIÇÃO: o modo dev desta aba não acompanhou');
  assert.equal(m.els.prefUndoEnabled.disabled, true,
    'DEFEITO: o modo dev foi desligado noutra aba e a chave "Permitir desfazer ações" daqui segue livre (R16-7-03)');
  assert.equal(m.els.prefUndoEnabled.checked, true, 'a chave travada fica ligada (o gate força)');
  assert.equal(m.els.prefUndoGateMsg.classList.contains('hidden'), false, 'a frase "falta N" não apareceu');
  assert.match(m.els.prefUndoGateMsg.textContent, /prefs\.undo\.gate\.countdown/);
  assert.match(m.els.prefUndoGateMsg.textContent, /"remaining":28/, 'a frase não conta o que falta (30 − 2)');

  // O inverso: ligado noutra aba, a chave daqui se libera.
  const liga = montarChaveDoDesfazer({ devAntes: { unlocked: true, active: false }, devDepois: { unlocked: true, active: true } });
  liga.app.renderUndoGateUI();
  assert.equal(liga.els.prefUndoEnabled.disabled, true, 'PRÉ-CONDIÇÃO: sem dev e abaixo da cota a chave devia estar travada');
  liga.app.aoMudarModoDevEmOutraAba();
  assert.equal(liga.els.prefUndoEnabled.disabled, false, 'o modo dev ligado noutra aba não liberou a chave daqui');
  assert.equal(liga.els.prefUndoGateMsg.classList.contains('hidden'), true);
});

// ═══ R16-7-05 · a chave travada aponta pra frase do motivo ═══
test('R16-7-05: #prefUndoEnabled aponta (aria-describedby) pra #prefUndoGateMsg, e a frase só tem texto enquanto vale', () => {
  const chave = /<input id="prefUndoEnabled"[^>]*>/.exec(HTML);
  assert.ok(chave, 'a chave do Desfazer sumiu do HTML');
  assert.match(chave[0], /\baria-describedby="prefUndoGateMsg"/,
    'DEFEITO: a chave travada não aponta pra frase do motivo — o leitor de tela ouve só o nome, sem o "por quê" (R16-7-05)');
  assert.match(HTML, /<p id="prefUndoGateMsg" class="hidden /, 'a frase do motivo sumiu (ou deixou de nascer escondida)');
  // A descrição é lida mesmo com o elemento escondido: a frase só pode ter TEXTO
  // enquanto vale (senão o leitor lê um motivo que não existe mais).
  const livre = montarChaveDoDesfazer({ devAntes: { unlocked: true, active: true }, devDepois: { unlocked: true, active: true } });
  livre.els.prefUndoGateMsg.textContent = 'sobra de antes';
  livre.app.renderUndoGateUI();
  assert.equal(livre.els.prefUndoEnabled.disabled, false, 'PRÉ-CONDIÇÃO: o dev ligado devia liberar a chave');
  assert.equal(livre.els.prefUndoGateMsg.textContent, '', 'a frase ficou com texto escondida: o aria-describedby leria o motivo de um estado que passou');
  const travada = montarChaveDoDesfazer({ devAntes: { unlocked: false, active: false }, devDepois: { unlocked: false, active: false } });
  travada.app.renderUndoGateUI();
  assert.notEqual(travada.els.prefUndoGateMsg.textContent, '', 'travada, a frase do motivo precisa ter texto (é a descrição da chave)');
});

// ═══ R16-7-04 · a Privacidade diz o que FICA depois do "Sair" ═══
function dicionario() {
  const ctx = { navigator: { language: 'pt-BR' }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, console };
  vm.createContext(ctx);
  vm.runInContext(ler('js/i18n.js') + '\nthis.D = I18N_DICT;', ctx);
  return ctx.D;
}

test('R16-7-04: a Privacidade diz que ficam também as escolhas de fábrica do app — nos 4 idiomas, sem perder o recorte "idioma e tema"', () => {
  const D = dicionario();
  const fabrica = { pt: /escolhas de fábrica do app/, en: /app’s factory settings/, es: /ajustes de fábrica de la app/, fr: /réglages d’usine de l’app/ };
  const fica = { pt: /idioma e o tema/, en: /language and theme/, es: /idioma y el tema/, fr: /langue et le thème/ };
  for (const lang of Object.keys(fabrica)) {
    const texto = D[lang]['help.privacy.device'];
    assert.match(texto, fabrica[lang], `DEFEITO ${lang}: a Privacidade ainda diz que ficam SÓ o idioma e o tema (R16-7-04)`);
    assert.match(texto, fica[lang], `${lang}: o recorte "idioma e tema" (cobrado em i18n.test.mjs) sumiu da frase`);
  }
  // O texto de reserva do HTML (antes do JS) é o mesmo do dicionário pt.
  assert.match(HTML, /data-i18n="help\.privacy\.device">[^<]*ficam só o idioma e o tema, e as escolhas de fábrica do app \(nada que seja seu\)\.<\/li>/);
});

test('R16-7-04: CONTROLE — o "Sair" regrava de fato escolhas de fábrica (a frase fala de algo que existe)', () => {
  const sair = fatiar('handleLogout');
  assert.match(sair, /filtrosDeFabrica\(\)/, 'CONTROLE: o "Sair" não regrava mais os filtros de fábrica — a frase da Privacidade deve mudar de novo');
  assert.match(sair, /preferenciasDeFabrica\(\)/, 'CONTROLE: o "Sair" não regrava mais as preferências de fábrica');
});

// ═══ R16-7-06 · o "Como funciona" aberto sozinho deixa o foco no "Entendi" ═══
function montarComoFunciona() {
  const log = [];
  const els = { comoFuncionaOk: elemento(), comoFuncionaTreinar: elemento() };
  els.comoFuncionaOk.focus = () => log.push('foco:Entendi');
  els.comoFuncionaTreinar.focus = () => log.push('foco:Treinar');
  const AppState = { preferences: { comoFuncionaVisto: false }, currentPlace: { venueID: 'v1' } };
  const deps = {
    AppState, Treino: { ativo: false }, cardDaFrente: () => ({}), semCamadaAberta: () => true, acoesTravadas: () => false,
    CamadaVoltar: { consumindo: false }, comoFuncionaEsperaVoltar: false, comoFuncionaEsperaGesto: false,
    savePreferences() {},
    // O `openModal` de verdade foca o 1º controle: o de mentira faz o mesmo.
    openModal: (id) => { log.push('abre:' + id); els.comoFuncionaTreinar.focus(); },
    document: { getElementById: (id) => els[id] },
  };
  const app = rodar(deps, ['abrirComoFunciona', 'mostrarComoFuncionaSePrimeiraVez'].map(fatiar),
    ['abrirComoFunciona', 'mostrarComoFuncionaSePrimeiraVez']);
  return { app, log };
}

test('R16-7-06: aberto SOZINHO (o 1º card do 1º login), o foco termina no "Entendi" — não em "Quero treinar antes"', () => {
  const m = montarComoFunciona();
  m.app.mostrarComoFuncionaSePrimeiraVez();
  assert.deepEqual(m.log.slice(0, 1), ['abre:comoFuncionaModal'], 'PRÉ-CONDIÇÃO: o diálogo não abriu');
  assert.equal(m.log.at(-1), 'foco:Entendi',
    `DEFEITO: o diálogo automático deixa o foco em "Quero treinar antes" — o Enter começa o treino em vez de dispensar o aviso (R16-7-06): ${m.log.join(' > ')}`);
});

test('R16-7-06: CONTROLE — o "Ver de novo" da Ajuda (à mão) fica como sempre: o foco no 1º controle', () => {
  const m = montarComoFunciona();
  m.app.abrirComoFunciona();
  assert.equal(m.log.at(-1), 'foco:Treinar', `o aberto à mão mudou de foco: ${m.log.join(' > ')}`);
});
