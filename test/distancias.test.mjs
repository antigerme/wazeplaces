// Uma DISTÂNCIA na tela tem um formato só, nos 4 idiomas (auditoria da rodada
// 9): o que o app mostra como "12,3 km" no card não pode aparecer como
// "±12346 m" na dica do "📍 Perto de mim" (R9-6-05), e a troca de metro pra
// quilômetro se decide pelo número que a tela MOSTRA — de 999,5 a 999,9 m saía
// "1.000 m" (R9-6-06). As funções rodam DE VERDADE, fatiadas do app.js, com o
// `t` e o `i18nLocale` do js/i18n.js e o dicionário real. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = ler('js/app.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) {
      const corpo = APP_SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}

// O js/i18n.js é script clássico: roda num contexto à parte (como o test/i18n),
// e as funções do app rodam NO MESMO contexto — com o `t` e o `i18nLocale` dele.
function contexto() {
  const dica = { textContent: '', className: '', classList: { toggle() {} } };
  const ctx = { navigator: { language: 'pt' }, document: { documentElement: {}, getElementById: (id) => (id === 'filterSortHint' ? dica : null) } };
  vm.createContext(ctx);
  vm.runInContext(ler('js/i18n.js'), ctx);
  vm.runInContext(`var estadoDaDicaDeOrdem = null; var posicaoDoModal = null; var posicaoGps = null; var ORDEM_PADRAO = 'newest';\n`
    + ['formatarDistancia', 'formatarMetros', 'atualizarDicaDeOrdem'].map(fatiar).join('\n'), ctx);
  return { ctx, dica };
}
const LINGUAS = ['pt', 'en', 'es', 'fr'];

// ═══ R9-6-05 · a precisão da posição é uma distância como as outras ═════════
test('R9-6-05: a dica do "📍 Perto de mim" dá a precisão no formato das outras distâncias — "±12,3 km", não "±12346 m"', () => {
  const { ctx, dica } = contexto();
  const vistos = {};
  for (const lang of LINGUAS) {
    ctx.setLang(lang);
    for (const [precisaoM, esperado] of [[12346, /12[,.]3\s?km/], [800, /\b800\s?m\b/]]) {
      vm.runInContext(`posicaoGps = { ll: [-23.55, -46.63], precisaoM: ${precisaoM} };`, ctx);
      ctx.atualizarDicaDeOrdem('ok');
      const texto = dica.textContent;
      vistos[lang + precisaoM] = texto;
      // CONTROLE: o card diz a MESMA distância assim — é a régua.
      const doCard = ctx.formatarMetros(precisaoM);
      assert.match(doCard, esperado, `${lang}: CONTROLE — o card não diz ${precisaoM} m como o esperado ("${doCard}")`);
      assert.ok(texto.includes('±' + doCard),
        `${lang}: a dica diz "${texto}", e a mesma distância no card é "${doCard}"`);
      assert.doesNotMatch(texto, /[{}]/, `${lang}: placeholder cru na dica: "${texto}"`);
      assert.ok(!texto.includes(String(precisaoM)) || precisaoM < 1000,
        `${lang}: a dica dá a precisão em metros crus: "${texto}"`);
    }
  }
  // As 4 línguas dizem coisas diferentes (o instrumento não lê o mesmo texto em todas).
  assert.equal(new Set(LINGUAS.map((l) => vistos[l + 12346])).size, 4, `CONTROLE: a dica não mudou com o idioma: ${JSON.stringify(vistos)}`);
});

test('R9-6-05: no dicionário, a frase da dica não leva unidade própria — quem a põe é a formatação da distância', () => {
  const ctx = { navigator: { language: 'pt' }, document: { documentElement: {} } };
  vm.createContext(ctx);
  vm.runInContext(ler('js/i18n.js'), ctx);
  for (const lang of LINGUAS) {
    const frase = ctx.I18N_DICT[lang]['filters.sort.hint.ok'];
    assert.ok(frase, `${lang}: a frase da dica sumiu`);
    assert.match(frase, /±\{d\}\)/, `${lang}: a precisão não vem pronta (com a unidade) na frase: "${frase}"`);
    assert.doesNotMatch(frase, /\}\s*(m|km)\b/, `${lang}: a frase crava uma unidade ao lado do número: "${frase}"`);
  }
});

// ═══ R9-6-06 · a unidade sai do número ARREDONDADO ═══════════════════════════
test('R9-6-06: entre 999,5 e 1000 m a distância já é "1 km" — nunca "1.000 m" —, com e sem o verbo, nos 4 idiomas', () => {
  const { ctx } = contexto();
  for (const lang of LINGUAS) {
    ctx.setLang(lang);
    const km = ctx.formatarMetros(1000);
    const moveuKm = ctx.formatarDistancia(1000);
    // CONTROLE: 1000 m é "1 km", e 999,4 ainda é metro (o instrumento separa os dois lados).
    assert.equal(km, ctx.t('card.map.km', { n: '1' }), `${lang}: CONTROLE — 1000 m não é "1 km" ("${km}")`);
    assert.equal(ctx.formatarMetros(999.4), ctx.t('card.map.m', { n: '999' }), `${lang}: CONTROLE — 999,4 m não é "999 m"`);
    assert.equal(ctx.formatarDistancia(999.4), ctx.t('card.change.movedM', { d: '999' }), `${lang}: CONTROLE — "moveu 999 m"`);
    for (const m of [999.5, 999.7, 999.99]) {
      assert.equal(ctx.formatarMetros(m), km, `${lang}: ${m} m saiu "${ctx.formatarMetros(m)}" — o mesmo número de 1000 m em outra unidade`);
      assert.equal(ctx.formatarDistancia(m), moveuKm, `${lang}: ${m} m saiu "${ctx.formatarDistancia(m)}"`);
    }
  }
  // Nenhuma distância sai com mil metros, em lugar nenhum da faixa.
  ctx.setLang('pt');
  for (let m = 990; m <= 1010; m += 0.05) {
    for (const s of [ctx.formatarMetros(m), ctx.formatarDistancia(m)]) {
      assert.doesNotMatch(s, /1[.,\s  ]?000\s?m\b/, `${m.toFixed(2)} m saiu "${s}"`);
    }
  }
});
