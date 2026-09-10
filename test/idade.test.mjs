// A IDADE DO PEDIDO, que já mentiu pro owner três vezes.
//
// O defeito: `time.months` em português era `há {n}m` e `time.minutes` é
// `há {n}min`. Um pedido de NOVE MESES saía como "há 9m" — nove minutos pra
// qualquer falante de português. Ao lado, o rótulo de tipo dizia "Novo local".
// O relato que chegou foi literalmente "a mesma solicitação 'nova' entrando
// assim que abro a aplicação". Ele leu certo o que a app escreveu.
//
// A INVARIANTE aqui não é "meses tem que ser por extenso" — isso amarraria o
// teste na implementação de hoje. É a forma GERAL do defeito: **duas unidades
// de tempo diferentes nunca podem render strings em que uma é PREFIXO da
// outra**. "há 9m" é prefixo de "há 9min", e é exatamente aí que a leitura
// escorrega. Escrito assim, o teste pega a colisão de novo se alguém trocar o
// mecanismo por abreviatura em qualquer língua, presente ou futura.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');

const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR' };
const AGORA = Date.UTC(2026, 8, 10, 18, 32);   // fixo: Date.now() real tornaria o teste instável
const DIA = 86400000;

// Fatia a função do FONTE e executa. Reimplementar aqui mediria uma cópia que
// envelhece — mesmo padrão do resto da suíte.
function fatiar(nome) {
  const i = APP.indexOf(`function ${nome}(`);
  const j = APP.indexOf('\n}', i) + 2;
  assert.ok(i !== -1 && j > i, `as âncoras de ${nome} sumiram`);
  return APP.slice(i, j);
}

// A CONSTANTE de verdade, fatiada do fonte — nunca uma cópia escrita aqui.
//
// Esta função nasceu de duas sabotagens que PASSARAM: o harness injetava o seu
// próprio `const COLA_O_SIMBOLO = new Set(['pt'])`, então trocar o valor no
// `js/app.js` não mudava nada no teste. A fixture decidia o que o teste era
// capaz de enxergar (gotcha #52), e as asserções de tipografia por idioma eram
// decoração — passavam com o app configurado de qualquer jeito.
function fatiarConst(nome) {
  const re = new RegExp('^const ' + nome + ' = .*?;', 'm');
  const m = APP.match(re);
  assert.ok(m, `a constante ${nome} sumiu ou mudou de forma`);
  return m[0];
}

function montar(loc) {
  // Fatia as DUAS: o formatador chama `estiloDaIdade`, e sem ela o try/catch
  // do formatador engole o ReferenceError e devolve a data crua — o teste
  // passava a medir o fallback em vez do caminho real. Aconteceu.
  const src = 'const ESTILO_DA_IDADE = new Map();\n'
    + fatiarConst('UNIDADES_DA_IDADE') + '\n'
    + fatiarConst('COLA_O_SIMBOLO') + '\n'
    + fatiar('estiloDaIdade') + '\n' + fatiar('idadeComNormaLocal')
    + '\n' + fatiar('formatRelativeTime');
  return new Function('i18nLocale', 'Date', 't',
    src + '\nreturn formatRelativeTime;')(
      () => loc,
      class extends Date {
        constructor(...a) { super(...(a.length ? a : [AGORA])); }
        static now() { return AGORA; }
      },
      (k) => { throw new Error('não deve mais usar o dicionário: ' + k); });
}

const idadeDe = { minute: (n) => n * 60000 + 5000, hour: (n) => n * 3600000 + 60000,
                  day: (n) => n * DIA + 3600000, month: (n) => Math.round(n * 30) * DIA + DIA / 2 };

test('nenhuma unidade de tempo é PREFIXO de outra — a colisão que gerou o relato', () => {
  for (const [lang, loc] of Object.entries(LOCALES)) {
    const f = montar(loc);
    // n >= 2 porque em n = 1 vários idiomas usam palavra própria ("ontem",
    // "mês passado") e a comparação de prefixo perde o sentido.
    for (const n of [2, 3, 5, 9, 11]) {
      const saidas = Object.entries(idadeDe).map(([u, ms]) => [u, f(AGORA - ms(n))]);
      for (const [ua, sa] of saidas) {
        for (const [ub, sb] of saidas) {
          if (ua === ub) continue;
          assert.ok(!(sa !== sb && sb.startsWith(sa)),
            `${lang}: "${sa}" (${ua}) é prefixo de "${sb}" (${ub}) — ambíguo, é o defeito de "há 9m"`);
        }
      }
    }
  }
});

test('9 MESES nunca sai como "há 9m" — o caso exato do relato', () => {
  const f = montar('pt-BR');
  const saida = f(AGORA - 286 * DIA);   // o Studio Elchaday: 2025-11-27
  assert.ok(!/^há \d+m$/.test(saida), `voltou a abreviatura ambígua: "${saida}"`);
  assert.match(saida, /m[êe]s/i, `9 meses precisa dizer "meses": "${saida}"`);
  // E o espanhol, que tinha a MESMA colisão (hace {n}m × hace {n}min).
  assert.ok(!/^hace \d+m$/.test(montar('es-ES')(AGORA - 286 * DIA)));
});

test('a idade só ENVELHECE — nunca volta a um rótulo mais recente', () => {
  // Esta asserção nasceu de uma SABOTAGEM QUE PASSOU. A primeira versão
  // procurava o literal "0" na tela, porque o defeito original mostrava
  // "há 0a" entre 360 e 364 dias (`months < 12` mandava pro ramo de anos e
  // `floor(360/365)` dava 0). Mas com o Intl a MESMA aritmética errada produz
  // `format(-0, 'year')` = **"este ano"** — sem nenhum zero, e pior: um pedido
  // de 360 dias anunciado como sendo deste ano. O teste passava limpo.
  //
  // A invariante que distingue as duas versões é MONOTONICIDADE: conforme o
  // pedido envelhece, o rótulo só pode continuar igual ou virar um rótulo
  // NOVO — nunca reaparecer um que já ficou pra trás, e nunca voltar a um
  // rótulo de período corrente. Isso pega a família inteira de erros de faixa,
  // não só o caso de 360 dias que eu por acaso tinha medido.
  for (const [lang, loc] of Object.entries(LOCALES)) {
    const f = montar(loc);
    const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
    const agora = new Set(['second', 'minute', 'hour', 'day', 'month', 'year'].map((u) => rtf.format(0, u)));
    const vistos = new Map();
    let anterior = null;
    for (let h = 1; h <= 800 * 24; h += (h < 72 ? 1 : 12)) {
      const idade = h * 3600000;
      const s = f(AGORA - idade);
      assert.ok(s && s.length > 1, `${lang}: ${h}h renderiza vazio`);
      // "agora"/"este ano"/"este mês" só valem na PRIMEIRA faixa.
      if (h > 1 && agora.has(s)) {
        assert.fail(`${lang}: ${(h / 24).toFixed(0)} dias renderiza "${s}" — rótulo de período CORRENTE num pedido velho`);
      }
      if (s !== anterior) {
        assert.ok(!vistos.has(s),
          `${lang}: "${s}" reaparece em ${(h / 24).toFixed(0)} dias depois de ter saído em ${vistos.get(s)} dias — a idade andou pra trás`);
        vistos.set(s, (h / 24).toFixed(0));
        anterior = s;
      }
    }
  }
});

test('o singular não vira "1 dias" — o que chave manual sem ICU erra', () => {
  for (const [lang, loc] of Object.entries(LOCALES)) {
    const f = montar(loc);
    for (const [u, ms] of Object.entries(idadeDe)) {
      const s = f(AGORA - ms(1));
      assert.ok(!/\b1\s*\S*s\b/.test(s) || /\b(1\s)?(mês|mes)\b/.test(s),
        `${lang}/${u}: "${s}" parece plural com 1`);
    }
  }
});

test('as chaves time.* NÃO voltam ao dicionário', () => {
  // Elas existirem de novo significa duas mecânicas para o MESMO conceito — e
  // foi assim que o card passou a mostrar "há 9 meses" na foto (idadeDaFoto,
  // via Intl) e "há 9m" no pedido, ao mesmo tempo, na mesma tela.
  for (const k of ['time.now', 'time.minutes', 'time.hours', 'time.days', 'time.months', 'time.years']) {
    assert.ok(!I18N.includes(`'${k}'`), `a chave ${k} voltou: a abreviatura ambígua volta com ela`);
  }
});

test('a idade do PEDIDO usa o mesmo mecanismo da idade da FOTO', () => {
  const semCom = APP.replace(/\/\/[^\n]*/g, '');
  const corpoDe = (fn) => {
    const i = semCom.indexOf(`function ${fn}(`);
    assert.ok(i !== -1, `${fn} sumiu`);
    return semCom.slice(i, semCom.indexOf('\n}', i));
  };
  // A idade da FOTO usa Intl direto. A do PEDIDO delega pra
  // `idadeComNormaLocal`, que aplica a norma tipográfica do idioma — então a
  // asserção segue a CADEIA, não o corpo de uma função só. (A primeira versão
  // olhava só o corpo do `formatRelativeTime` e reprovou assim que ele passou
  // a delegar: guard amarrado na forma de hoje, não na invariante.)
  assert.match(corpoDe('idadeDaFoto'), /Intl\.RelativeTimeFormat/, 'idadeDaFoto parou de usar Intl');
  assert.match(corpoDe('idadeComNormaLocal'), /Intl\.RelativeTimeFormat/,
    'a cadeia da idade do pedido parou de usar Intl — plural e ambiguidade voltam por chave manual');
  assert.match(corpoDe('formatRelativeTime'), /idadeComNormaLocal|Intl\.RelativeTimeFormat/,
    'formatRelativeTime saiu da cadeia do Intl');
  for (const fn of ['formatRelativeTime', 'idadeDaFoto'])
    assert.match(corpoDe(fn), /i18nLocale\(\)/, `${fn} precisa formatar no locale do editor`);
});

// ── a ORDENAÇÃO, que é a outra metade do relato ────────────────────────────
test('pedido SEM data vai pro FIM — nunca crava a posição 0', () => {
  // O `|| 0` que estava no sortQueue transformava `dateAdded: null` em 0, que
  // em "mais antigos primeiro" é o mais antigo possível: o pedido ficava na
  // posição 0 da fila em TODA abertura da app, para sempre. É exatamente o
  // sintoma relatado ("a mesma solicitação entrando assim que abro"), por uma
  // causa diferente da que gerou o relato — e sem nada na tela explicando.
  //
  // Não estava ativo na fila do owner (370 de 370 com data), mas o core manda
  // `ur.dateAdded ?? null`: basta o Waze omitir o campo uma vez.
  const APPJS = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const i = APPJS.indexOf('function sortQueue()');
  const corpo = APPJS.slice(i, APPJS.indexOf('\n}', i) + 2);
  const monta = (ordem) => {
    const est = { queue: [], filters: { sortOrder: ordem } };
    const fn = new Function('AppState', corpo + '\nreturn sortQueue;')(est);
    return (fila) => { est.queue = fila.slice(); fn(); return est.queue.map((p) => p.id); };
  };
  const fila = [
    { id: 'novo', dateAdded: 3000 },
    { id: 'SEM-DATA', dateAdded: null },
    { id: 'velho', dateAdded: 1000 },
    { id: 'meio', dateAdded: 2000 },
  ];
  for (const ordem of ['oldest', 'newest']) {
    const saida = monta(ordem)(fila);
    assert.notEqual(saida[0], 'SEM-DATA',
      `${ordem}: o pedido sem data foi pra posição 0 — é o "não sai da minha frente"`);
    assert.equal(saida[saida.length - 1], 'SEM-DATA',
      `${ordem}: pedido sem data tem que ir pro FIM, não é "o mais antigo"`);
  }
  // E os COM data continuam ordenados certo — controle: sem isto, uma função
  // que jogasse tudo pro fim passaria nas duas asserções acima.
  assert.deepEqual(monta('oldest')(fila).slice(0, 3), ['velho', 'meio', 'novo']);
  assert.deepEqual(monta('newest')(fila).slice(0, 3), ['novo', 'meio', 'velho']);
});

test('usa a abreviação OFICIAL do idioma onde ela é inequívoca, e cai pro extenso onde não é', () => {
  // Pedido do owner: "não prefere usar as abreviações oficiais de cada idioma?".
  // Prefiro — e o `style: 'short'` do CLDR encolhe o rótulo 31% em português na
  // média ponderada pela fila real. Mas o "short" oficial do ESPANHOL colide:
  // `hace 9 m` (meses) é prefixo de `hace 9 min` (minutos), que é exatamente o
  // defeito que este arquivo consertou. Então a escolha é por MEDIÇÃO.
  //
  // Este teste é o lado POSITIVO da regra. Sem ele, alguém trava tudo em 'long'
  // e o ganho some sem nada reprovar — o teste de prefixo acima ficaria verde,
  // porque o extenso nunca é ambíguo.
  const esperado = { pt: 'short', en: 'short', fr: 'short', es: 'long' };
  const src = 'const ESTILO_DA_IDADE = new Map();\n'
    + fatiarConst('UNIDADES_DA_IDADE') + '\n'
    + fatiar('estiloDaIdade') + '\nreturn estiloDaIdade;';
  const estiloDaIdade = new Function(src)();
  for (const [lang, quero] of Object.entries(esperado)) {
    assert.equal(estiloDaIdade(LOCALES[lang]), quero,
      `${lang}: esperava estilo "${quero}"`);
  }
  // E o efeito na TELA, que é o que importa: em pt a hora abrevia e o mês não.
  const f = montar(LOCALES.pt);
  assert.match(f(AGORA - 12 * 3600000), /^há 12 ?h$/, 'pt deveria abreviar hora');
  assert.match(f(AGORA - 286 * DIA), /meses/, 'pt NÃO deve abreviar mês — não há forma curta segura');
  // O espanhol, caído no extenso, escreve os dois.
  const fes = montar(LOCALES.es);
  assert.match(fes(AGORA - 12 * 3600000), /horas/, 'es caiu pro extenso: hora por extenso');
  assert.match(fes(AGORA - 286 * DIA), /meses/, 'es caiu pro extenso: mês por extenso');
});

test('a TIPOGRAFIA segue a norma de cada idioma, e elas divergem', () => {
  // Pesquisado nas fontes normativas depois de o owner apontar que "há 12 h"
  // está errado em português — e está:
  //   pt-BR  ABNT NBR 5892: `15h`, `12h30min` — símbolo COLA no número, e
  //          minuto é `min` sem ponto (símbolo do SI não leva ponto).
  //   es     RAE: "12 h" com espaço OBRIGATÓRIO; ela diz que "12h" é erro.
  //   fr     Imprimerie nationale: "12 h" com espaço INSECÁVEL.
  //   en     AP/Chicago: "12 hr".
  // O CLDR acerta três e erra só o português — daí o conserto ser DELE, e o
  // controle abaixo garantir que os outros três não sejam tocados.
  const H = 3600000;
  const pt = montar(LOCALES.pt);
  assert.equal(pt(AGORA - 12 * H), 'há 12h', 'ABNT: símbolo cola no número');
  assert.equal(pt(AGORA - 28 * 60000), 'há 28min', 'ABNT: `min`, colado e SEM ponto');
  assert.match(pt(AGORA - 5 * DIA), /^há 5 dias$/, 'palavra NÃO cola — ninguém escreve "5dias"');
  assert.match(pt(AGORA - 286 * DIA), /^há \d+ meses$/, 'palavra NÃO cola');

  // CONTROLE — sem isto, uma função que colasse tudo em todo idioma passaria
  // nas asserções acima e quebraria a norma dos outros três em silêncio.
  const fr = montar(LOCALES.fr);
  assert.match(fr(AGORA - 12 * H), /^il y a 12.h$/, 'fr mantém o separador (Imprimerie nationale)');
  // Ancorado no CARACTERE, não num índice: contar posição à mão já me fez
  // apontar pro "2" em vez do separador.
  assert.ok(fr(AGORA - 12 * H).includes('\u00A0'),
    'fr exige espaço INSECÁVEL antes do símbolo — o CLDR já emite U+00A0 e não podemos perdê-lo');
  const en = montar(LOCALES.en);
  assert.match(en(AGORA - 12 * H), /^12 hr\. ago$/, 'en mantém o espaço (AP/Chicago)');
  const es = montar(LOCALES.es);
  assert.match(es(AGORA - 12 * H), /^hace 12 /, 'es mantém o espaço — a RAE diz que "12h" é erro');
});
