// Auditoria de i18n — a rede que garante "nunca esquecer os outros idiomas".
// Roda no CI (node --test). Falha se:
//   - faltar algum idioma declarado no dicionário;
//   - qualquer chave não existir em TODAS as línguas (paridade);
//   - algum valor estiver vazio;
//   - os placeholders {x} divergirem entre as línguas de uma mesma chave;
//   - alguma chave usada no index.html (data-i18n*) não existir no dicionário.
//
// A lista de línguas é DERIVADA de I18N_DICT — adicionar idioma não exige mexer aqui.
// Mesma ideia da auditoria do botequei (tests/audit.mjs cobra a paridade das línguas).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Carrega o js/i18n.js (script clássico) num contexto Node e captura o dicionário.
function loadDict() {
  const ctx = { navigator: { language: 'pt' }, document: { documentElement: {} } };
  vm.createContext(ctx);
  vm.runInContext(read('js/i18n.js'), ctx);
  return ctx.I18N_DICT;
}

const DICT = loadDict();
// Derivado do dicionário, nunca uma lista à parte: idioma adicionado sem entrar
// aqui passaria por TODAS as auditorias de paridade sem ser conferido — o pior
// tipo de falha, porque o CI fica verde.
const LANGS = Object.keys(DICT);
// Língua de referência da comparação de placeholders. É o pt porque é onde as
// strings nascem (as outras são tradução dela).
const LANG_REF = 'pt';
const placeholders = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');

test('i18n: dicionário tem os idiomas suportados', () => {
  // O app declara os suportados em LANGS_SUPORTADOS = Object.keys(I18N_DICT) e
  // monta os <option> a partir de LANG_NOMES. Idioma no dicionário sem nome no
  // mapa apareceria como o código cru ("fr") no seletor.
  assert.ok(LANGS.length >= 3, `só ${LANGS.length} idioma(s) no dicionário`);
  for (const l of LANGS) {
    assert.ok(DICT[l] && typeof DICT[l] === 'object', `falta o idioma ${l}`);
    assert.match(l, /^[a-z]{2}$/, `código de idioma fora do padrão de 2 letras: ${l}`);
  }
  const i18n = read('js/i18n.js');
  assert.match(i18n, /const LANGS_SUPORTADOS = Object\.keys\(I18N_DICT\)/,
    'os idiomas suportados têm que sair do próprio dicionário, não de uma lista à parte');
  const mapa = i18n.match(/const LANG_NOMES = \{([^}]*)\}/);
  assert.ok(mapa, 'sumiu o LANG_NOMES, que alimenta os <option> dos seletores');
  for (const l of LANGS) {
    assert.match(mapa[1], new RegExp(`\\b${l}:`), `${l} não tem nome em LANG_NOMES — o seletor mostraria "${l}" cru`);
  }
  const locales = i18n.match(/const LOCALE_POR_LANG = \{([^}]*)\}/);
  assert.ok(locales, 'sumiu o LOCALE_POR_LANG, que dá o locale de toLocaleString');
  for (const l of LANGS) {
    assert.match(locales[1], new RegExp(`\\b${l}:`),
      `${l} não tem locale — número e data sairiam no padrão do fallback sem ninguém notar`);
  }

  // Decisão do owner: o app tem UM idioma por língua, nunca variante regional
  // como opção separada. Só se vê pt, en, es, fr — não pt-BR ao lado de pt-PT,
  // nem fr-FR ao lado de fr-CA. Variante do NAVEGADOR colapsa no idioma (provado
  // no teste do fallback); variante como CHAVE seria um segundo francês no
  // seletor, com dicionário próprio pra manter em paridade.
  //
  // Regional é legítimo só como VALOR do LOCALE_POR_LANG (pt → 'pt-BR'), que é o
  // locale de Intl/toLocaleString — coisa diferente da identidade do idioma.
  const chavesDeMapa = (bloco) => [...bloco.matchAll(/(?:^|[{,\s])'?([A-Za-z][\w-]*)'?\s*:/g)].map((m) => m[1]);
  for (const [rot, bloco] of [['LANG_NOMES', mapa[1]], ['LOCALE_POR_LANG', locales[1]]]) {
    for (const k of chavesDeMapa(bloco)) {
      assert.match(k, /^[a-z]{2}$/,
        `${rot} tem a chave "${k}": idioma é código de 2 letras, e variante regional ` +
        'não entra como idioma separado (o navegador em fr-CA já cai em fr)');
    }
  }
});

test('i18n: paridade — toda chave existe em TODAS as línguas', () => {
  const all = new Set(LANGS.flatMap((l) => Object.keys(DICT[l])));
  const missing = [];
  for (const l of LANGS) for (const k of all) if (!(k in DICT[l])) missing.push(`${l} → ${k}`);
  assert.equal(missing.length, 0, `Chaves sem tradução (adicione nas ${LANGS.length} línguas):\n` + missing.join('\n'));
});

test('i18n: nenhum valor vazio', () => {
  const empty = [];
  for (const l of LANGS) for (const [k, v] of Object.entries(DICT[l])) if (!String(v).trim()) empty.push(`${l} → ${k}`);
  assert.equal(empty.length, 0, 'Valores vazios:\n' + empty.join('\n'));
});

test('i18n: placeholders {x} consistentes entre as línguas', () => {
  const bad = [];
  for (const k of Object.keys(DICT[LANG_REF])) {
    const ref = placeholders(DICT[LANG_REF][k]);
    for (const l of LANGS.filter((x) => x !== LANG_REF)) {
      if (!(k in DICT[l])) continue;
      if (placeholders(DICT[l][k]) !== ref) bad.push(`${k}: ${LANG_REF}[${ref}] vs ${l}[${placeholders(DICT[l][k])}]`);
    }
  }
  assert.equal(bad.length, 0, 'Placeholders divergentes:\n' + bad.join('\n'));
});

test('i18n: toda chave usada no index.html (data-i18n*) existe no dicionário', () => {
  const html = read('index.src.html');
  const used = new Set();
  const re = /\bdata-i18n(?:-html|-ph|-aria|-title)?="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) used.add(m[1]);
  const orphans = [...used].filter((k) => !(k in DICT.pt));
  assert.equal(orphans.length, 0, 'data-i18n no HTML sem chave no dicionário:\n' + orphans.join('\n'));
});

// Regressão: `data-i18n` escreve textContent, então markup no valor do
// dicionário chega ESCAPADO na tela — o editor lê "Toque em <strong>Compartilhar
// </strong>" literalmente. Aconteceu com os passos de instalação no iPhone, que
// é justamente quem não tem outro caminho. Nada quebra: a chave existe, a
// paridade passa, o texto só fica com as tags à mostra. Quem tem markup usa
// `data-i18n-html` (innerHTML, valores do próprio dicionário — nunca da rede).
test('i18n: chave ligada por textContent (data-i18n) não pode ter markup no valor', () => {
  const html = read('index.src.html');
  const textuais = new Set();
  const re = /\bdata-i18n="([^"]+)"/g;   // sem sufixo: textContent
  let m;
  while ((m = re.exec(html)) !== null) textuais.add(m[1]);
  const comTag = [];
  for (const k of textuais) {
    for (const lang of LANGS) {
      const v = DICT[lang] && DICT[lang][k];
      if (typeof v === 'string' && /<[a-z][^>]*>/i.test(v)) comTag.push(`${lang} · ${k} → ${v.slice(0, 60)}`);
    }
  }
  assert.equal(comTag.length, 0,
    'valor com HTML numa chave que vira textContent (use data-i18n-html):\n' + comTag.join('\n'));
});

test('i18n: toda chave t(\'...\') do app.js/api.js existe no dicionário', () => {
  const src = read('js/app.js') + '\n' + read('js/api.js');
  const keys = new Set();
  let m;
  // t('chave' ...) e t(cond ? 'a' : 'b' ...)
  const re1 = /t\(\s*\??\s*['"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)['"]/g;
  while ((m = re1.exec(src)) !== null) keys.add(m[1]);
  const re2 = /[?:]\s*['"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)['"]/g;
  while ((m = re2.exec(src)) !== null) keys.add(m[1]);
  const orphans = [...keys].filter((k) => !(k in DICT.pt));
  assert.equal(orphans.length, 0, "t('chave') sem correspondência no dicionário:\n" + orphans.join('\n'));
});

// Regressão: o card é clonado de um <template>, e conteúdo de template NÃO é
// alcançado por document.querySelectorAll — então o applyI18n() global nunca
// via as chaves de dentro dele. Efeito: em en/es o card voltava pro português
// A CADA SWIPE. A única correção possível é traduzir o clone; se alguém tirar
// essa chamada, o bug volta silencioso (nada quebra, só fica em pt).
test("i18n: renderCurrentCard aplica o dicionário no clone do <template>", () => {
  const src = read('js/app.js');
  assert.ok(
    /applyI18n\(\s*card\s*\)/.test(src),
    'js/app.js precisa chamar applyI18n(card) no clone do cardTemplate — sem isso ' +
    'o card fica sempre em português pra quem usa inglês/espanhol'
  );
});

// Regressão: o fallback atende TODO idioma sem dicionário próprio — alemão,
// italiano, japonês, russo, chinês. O francês SAIU desta lista quando ganhou
// tradução: um idioma suportado nunca deve cair no fallback, e é justamente
// isso que este teste pega se alguém adicionar o dicionário e esquecer o resto.
// Quem tem idioma suportado vem da detecção e nunca chega ao fallback, então o
// fallback só decide o que ver quem NÃO é atendido — e aí inglês é a língua
// franca da comunidade WME. Voltar pra 'pt' é escolha de produto, não detalhe.
test('i18n: idioma desconhecido cai em inglês, não em português', () => {
  const ctx = { navigator: { language: 'de-DE' }, document: { documentElement: {} } };
  vm.createContext(ctx);
  vm.runInContext(read('js/i18n.js'), ctx);
  // `const` no topo de um script não vira propriedade do global (só `function`
  // vira), então LANG_FALLBACK não dá pra ler daqui — o que vale é o
  // comportamento do resolveLang, testado abaixo.
  assert.match(read('js/i18n.js'), /LANG_FALLBACK\s*=\s*'en'/, "LANG_FALLBACK deixou de ser 'en'");
  for (const loc of ['de-DE', 'it-IT', 'ja-JP', 'ru-RU', 'zh-CN', 'nl-NL', '']) {
    ctx.navigator.language = loc;
    assert.equal(ctx.resolveLang(), 'en', `locale ${loc || '(vazio)'} devia cair em inglês`);
  }
  // E quem É atendido vem da detecção, sem passar pelo fallback. Repare que a
  // lista tem VARIANTES REGIONAIS de propósito: ela prova que todas colapsam num
  // idioma de 2 letras. O app tem UM francês, como tem UM português — nunca
  // fr-FR e fr-CA como coisas separadas no seletor.
  for (const [loc, esperado] of [['pt-BR', 'pt'], ['pt-PT', 'pt'], ['en-GB', 'en'], ['es-AR', 'es'],
                                 ['fr-FR', 'fr'], ['fr-CA', 'fr']]) {
    ctx.navigator.language = loc;
    assert.equal(ctx.resolveLang(), esperado, `locale ${loc} devia dar ${esperado}`);
  }
});

// O seletor de idioma vivia só em Filtros → Preferências, e o botão de Filtros
// fica escondido sem sessão: quem caísse num idioma que não lê teria que entrar
// primeiro, lendo instruções que não entende. O modal de Ajuda é o único
// alcançável deslogado — por isso o segundo seletor.
test('i18n: dá pra trocar o idioma antes de entrar', () => {
  const html = read('index.src.html');
  const app = read('js/app.js');
  const ids = ['langSelect', 'langSelectHelp'];
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `sumiu o seletor #${id}`);
  }
  // O da Ajuda precisa estar DENTRO do #helpModal, senão não é alcançável deslogado.
  const ajuda = html.slice(html.indexOf('id="helpModal"'));
  assert.ok(
    ajuda.indexOf('id="langSelectHelp"') !== -1 &&
    ajuda.indexOf('id="langSelectHelp"') < ajuda.indexOf('id="helpModal"', 1) + 1e9,
    'o seletor de idioma saiu do modal de Ajuda'
  );
  for (const id of ids) {
    assert.ok(app.includes(`'${id}'`), `${id} não está em SELETORES_IDIOMA — os dois sairiam de sincronia`);
  }
  assert.match(app, /function aplicarIdioma/, 'sumiu o aplicarIdioma() que mantém os seletores em sincronia');
});

// A duração da janela de Desfazer é UM número (UNDO_WINDOW_MS), e aparece em duas
// frases × três línguas. Escrevê-la à mão deixa o texto mentindo quando a
// constante muda, em seis lugares dos quais alguém sempre esquece um. As duas
// usam {undoSeg}, alimentado por setI18nVars() a partir da constante.
const CHAVES_COM_DURACAO = ['toast.undoHint', 'prefs.undo.desc'];

test('frases da janela de Desfazer não cravam a duração', () => {
  for (const chave of CHAVES_COM_DURACAO) {
    for (const lang of LANGS) {
      const msg = DICT[lang][chave];
      assert.ok(msg, `falta ${chave} em ${lang}`);
      assert.ok(msg.includes('{undoSeg}'),
        `${chave} (${lang}) deve usar {undoSeg} pra duração, não o número escrito`);
      // Tira o placeholder antes de procurar dígito: "{undoSeg} segundos" é o certo,
      // "3 segundos" é o que não pode voltar.
      const semPlaceholder = msg.split('{undoSeg}').join('§');
      assert.ok(!/\d+\s*-?\s*(s\b|second|segundo)/i.test(semPlaceholder),
        `${chave} (${lang}) ainda tem duração escrita à mão: ${msg}`);
    }
  }
});

// O mecanismo só funciona se alguém REGISTRAR o valor: sem isto o {undoSeg} vaza
// cru pra tela, e nenhum teste de dicionário enxergaria (a chave existe, a
// paridade passa). Guarda as duas pontas — a função em i18n.js e o registro no app.
test('{undoSeg} é registrado por setI18nVars a partir de UNDO_WINDOW_MS', () => {
  const i18n = read('js/i18n.js');
  const app = read('js/app.js');

  assert.match(i18n, /function setI18nVars\(/, 'sumiu o setI18nVars() de js/i18n.js');
  assert.match(i18n, /const I18N_VARS = \{\}/, 'sumiu o mapa I18N_VARS');
  assert.match(i18n, /window\.setI18nVars = setI18nVars/,
    'setI18nVars precisa ir pro escopo global — o app.js é script clássico');

  const registro = app.match(/setI18nVars\(\{[^}]*undoSeg[^}]*\}\)/);
  assert.ok(registro, 'js/app.js precisa registrar {undoSeg} via setI18nVars()');
  assert.match(registro[0], /UNDO_WINDOW_MS/,
    'o valor de {undoSeg} tem que vir de UNDO_WINDOW_MS, não de um número solto');
  assert.match(registro[0], /=>/,
    'registre uma FUNÇÃO: valor fixo congela o locale da carga e não reformata na troca de idioma');
  assert.match(registro[0], /i18nLocale\(\)/,
    'número em texto passa por toLocaleString(i18nLocale()) — nunca locale cravado');
});

// ── A ponte servidor → dicionário ─────────────────────────────────────────
// O core manda `errorKey`; o frontend traduz e, se a chave não existir, cai na
// frase crua do servidor — que é PORTUGUÊS. Então chave nova no core sem entrada
// aqui não quebra nada: só devolve o app pro português para quem escolheu outro
// idioma, exatamente o bug que a chave existe pra consertar. Nenhuma auditoria
// de dicionário pega isso, porque a chave chega pela REDE.
test('i18n: toda errorKey do backend existe no dicionário', () => {
  const core = read('server/core.mjs');
  const emitidas = new Set([...core.matchAll(/['"](srv\.err\.[a-zA-Z0-9.]+)['"]/g)].map((m) => m[1]));
  assert.ok(emitidas.size >= 20,
    `só ${emitidas.size} chave(s) srv.err.* no core — o regex parou de achar as citações?`);
  const faltando = [];
  for (const k of emitidas) {
    for (const l of LANGS) if (!(k in DICT[l])) faltando.push(`${l} → ${k}`);
  }
  assert.equal(faltando.length, 0,
    'errorKey emitida pelo backend sem tradução (cai em português calado):\n' + faltando.join('\n'));
});

// E o caminho inverso: chave srv.err.* no dicionário que o core não emite mais
// é peso morto que finge cobertura. Não reprova (pode ser emitida por um
// adaptador), mas avisa em quantidade — é sinal de que o core mudou e o
// dicionário ficou para trás.
test('i18n: dicionário não acumula srv.err.* órfã', () => {
  const core = read('server/core.mjs') + read('worker/index.mjs') + read('server/node.mjs');
  const noDict = Object.keys(DICT[LANG_REF]).filter((k) => k.startsWith('srv.err.'));
  const orfas = noDict.filter((k) => !core.includes(k));
  assert.ok(orfas.length <= 2,
    `${orfas.length} chaves srv.err.* não são mais emitidas por ninguém:\n` + orfas.join('\n'));
});

// O `||` que fazia o português do servidor GANHAR da tradução. Era o buraco de
// i18n mais fundo do app: 8 pontos onde `result.error || t('...')` mostrava a
// frase do backend e só usava o dicionário se o servidor não dissesse nada.
test('i18n: mensagem do servidor passa pelo tradutor, não pelo ||', () => {
  const app = read('js/app.js');
  assert.match(app, /function msgDoServidor\(/,
    'sumiu o msgDoServidor(), que prefere errorKey traduzida à frase crua do servidor');
  const semComentarios = app.replace(/^\s*\/\/.*$/gm, '');
  const cruas = [...semComentarios.matchAll(/\b(?:result|r)\.error\s*\|\|/g)];
  assert.equal(cruas.length, 0,
    `${cruas.length} ponto(s) voltaram a mostrar result.error direto — use msgDoServidor()`);
});

// ── O manifest é servido IGUAL pra todo mundo ──────────────────────────────
// Não tem como traduzi-lo por leitor: é arquivo estático, e o sistema o lê uma
// vez, na instalação. Então o texto dele é neutro — o mesmo critério do
// LANG_FALLBACK, que atende quem o app não consegue detectar. Estava em
// português: nome, descrição, `lang`, as duas legendas de screenshot e os DOIS
// atalhos (que aparecem no toque longo do ícone no Android) — 10 strings, e eu
// só tinha achado 3 na primeira varredura porque parei no topo do arquivo.
test('manifest: texto neutro e lang igual ao LANG_FALLBACK', () => {
  const man = JSON.parse(read('manifest.json'));
  const fallback = (read('js/i18n.js').match(/LANG_FALLBACK\s*=\s*'([a-z]{2})'/) || [])[1];
  assert.ok(fallback, "não achei o LANG_FALLBACK em js/i18n.js");
  assert.equal(man.lang, fallback,
    `manifest.lang (${man.lang}) tem que ser o LANG_FALLBACK (${fallback}): os dois respondem ` +
    'à mesma pergunta — o que mostrar pra quem o app não sabe identificar');

  // Diacrítico de pt/es/fr em qualquer campo de TEXTO do manifest. Não é prova
  // de idioma, é farol: acusa a recaída óbvia (voltar a escrever "Validação",
  // "Atualizar", "Préférences") sem tentar adivinhar língua.
  const textos = [];
  const colher = (o, caminho) => {
    if (typeof o === 'string') { textos.push([caminho, o]); return; }
    if (Array.isArray(o)) return o.forEach((v, i) => colher(v, `${caminho}[${i}]`));
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (['src', 'type', 'sizes', 'purpose', 'url', 'id', 'start_url', 'scope',
             'display', 'orientation', 'dir', 'lang', 'background_color', 'theme_color'].includes(k)) continue;
        colher(v, caminho ? `${caminho}.${k}` : k);
      }
    }
  };
  colher(man, '');
  // E o <title> e a descrição da página: são a PRÉVIA do link (Discord,
  // WhatsApp, fórum) e nada os traduz — o `applyI18n` só roda depois. Estavam em
  // português ("Waze Places - Validação"), o que ainda contradizia o "nunca aprova".
  const html = read('index.src.html');
  textos.push(['<title>', (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '']);
  textos.push(['<meta description>', (/<meta name="description" content="([^"]*)"/.exec(html) || [])[1] || '']);
  assert.ok(textos.every(([, v]) => v), 'o <title> ou a descrição sumiram — o guard ficaria cego');
  const comAcento = textos.filter(([, v]) => /[ãõçáéíóúâêôàèùïüñ]/i.test(v) || /Valida[çc]/i.test(v));
  assert.equal(comAcento.length, 0,
    'texto acentuado no manifest (ele é servido igual pra todo mundo):\n' +
    comAcento.map(([c, v]) => `  ${c} → ${v}`).join('\n'));
});


// ═══════════════════════════════════════════════════════════════════════════
//  Os selos de texto do card seguem UMA regra de caixa
// ═══════════════════════════════════════════════════════════════════════════
//
// A linha do criador é `L1 · App · Ver +2 · ✕ 46`. Os selos que são PALAVRA
// começam com maiúscula; `L1` e `✕ 46` ficam de fora porque não são palavra —
// são identificador e contagem.
//
// A regra vale para o GRUPO, não para um selo: capitalizar `App` e deixar
// `ajuda` em minúscula é a inconsistência que este projeto proíbe (mesmo
// conceito, mesmo tratamento). Pedido do owner, que leu `app`/`site` em
// minúscula a 10px e achou difícil de varrer. MEDIDO antes de aceitar: o custo
// de largura é ≤1px, e o nome do criador (que disputa a mesma linha) não perde
// nada — 80% no Pixel 7 antes e depois.
//
// Selo de texto NOVO entra nesta lista junto com a sua chave.
test('selos do card: todo selo que é PALAVRA começa com maiúscula, nas 4 línguas', () => {
  const dict = read('js/i18n.js');
  const SELOS_DE_TEXTO = [
    'card.source.WEB', 'card.source.MOBILE_CLIENT',
    'card.source.MOBILE_WEB', 'card.source.REPORTING_AGENT',
    'card.sameAuthor',
  ];
  for (const chave of SELOS_DE_TEXTO) {
    const re = new RegExp("'" + chave.replace(/\./g, '\\.') + "': '([^']*)'", 'g');
    const vals = [...dict.matchAll(re)].map((m) => m[1]);
    assert.equal(vals.length, 4, `${chave} não está nas 4 línguas`);
    for (const v of vals) {
      const primeira = v.replace(/^[^\p{L}]+/u, '')[0];
      assert.ok(primeira && primeira === primeira.toUpperCase(),
        `${chave} = "${v}" começa em minúscula; os selos de texto do card seguem uma regra só`);
    }
  }
  // Contraprova de ESCOPO: as dicas do toque longo são FRASES, com a redação
  // oficial do WME, e não entram nesta regra — se um dia virarem rótulo curto,
  // que seja decisão e não arrasto.
  const dica = dict.match(/'card\.source\.MOBILE_CLIENT\.title': '([^']*)'/);
  assert.ok(dica && dica[1].length > 15, 'a dica virou rótulo curto — foi decisão?');
});

// "App" em português é MASCULINO — decisão do owner (2026-09-24): *"normalmente
// falamos 'no app' e não 'na app'"*. O app, no app, do app, pelo app, este app,
// um app — e a concordância junto ("o app fica aberto", "Ele rejeita…"). A UI
// portuguesa é a brasileira (`LOCALE_POR_LANG.pt` é pt-BR); "o app" e
// "aplicação" são o uso de Portugal. A regra pega o artigo ou a preposição
// FEMININA colada em "app", no dicionário pt e no texto VISÍVEL do
// index.src.html (sem comentário nem <script>: o HTML é o que aparece antes do
// applyI18n). A concordância que vem DEPOIS ("o app está aberta") ela não
// enxerga — essa foi revisada à mão, e é o que se confere ao escrever texto novo.
const APP_FEMININO = /(^|[^\p{L}\p{N}_])(a|as|à|às|na|nas|da|das|pela|pelas|uma|numa|duma|esta|nesta|desta|essa|nessa|dessa|aquela|naquela|daquela|sua|nossa|minha|toda|outra|própria|mesma|nova)\s+apps?(?![\p{L}\p{N}_])/iu;
const APLICACAO = /aplicaç(ão|ões)/iu;
const textoVisivelDoHtml = (html) => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
const femininoEm = (s) => APP_FEMININO.test(s) || APLICACAO.test(s);

test('pt: "app" é masculino — no dicionário e no texto visível do HTML', () => {
  // Contraprova: a regra enxerga as formas que o app tinha, e deixa passar as certas.
  for (const errado of ['Quem está na app:', 'Para anular: sair da app.', 'Esta aplicação nunca aprova',
    'reabra a app pra tentar', 'usar a app em 2 idiomas', 'volte à app', 'nesta app', 'A app guarda'])
    assert.ok(femininoEm(errado), `a regra não enxerga "${errado}"`);
  for (const certo of ['Quem está no app:', 'sair do app', 'Este app nunca aprova', 'reabra o app',
    'Sua sessão no app venceu', 'Instalar o aplicativo', 'mande no WhatsApp', 'os apps do celular', 'para app'])
    assert.ok(!femininoEm(certo), `a regra acusa "${certo}", que está certo`);

  const noDicionario = Object.entries(DICT.pt)
    .filter(([, v]) => femininoEm(String(v)))
    .map(([k, v]) => `${k}: ${String(v).slice(0, 90)}`);
  assert.deepEqual(noDicionario, [],
    '"app" no feminino no português — no Brasil é "o app"/"no app"/"do app", e "aplicação" vira "app"');

  const html = textoVisivelDoHtml(read('index.src.html'));
  assert.ok(html.includes('data-i18n="help.presenca.title"'), 'o recorte do HTML perdeu a Ajuda — a regra estaria lendo nada');
  const noHtml = [...html.matchAll(new RegExp(APP_FEMININO.source, 'giu'))].map((m) => m[0].trim())
    .concat([...html.matchAll(new RegExp(APLICACAO.source, 'giu'))].map((m) => m[0]));
  assert.deepEqual(noHtml, [], '"app" no feminino no texto visível do index.src.html');
});

test('contagem regressiva com 1: forma SINGULAR, e o app a usa (era "Faltam 1…")', () => {
  // Aparecia justamente no último toque antes do modo dev, e na patente e no
  // gate do Desfazer (auditoria de 2026-09-25).
  const app = read('js/app.js');
  const dic = read('js/i18n.js');
  for (const [k, uso] of [
    ['toast.devCountdown', /t\(remaining === 1 \? 'toast\.devCountdownUm' : 'toast\.devCountdown'/],
    ['conq.patente.faltam', /t\(prox\.min - tratados === 1 \? 'conq\.patente\.faltamUm' : 'conq\.patente\.faltam'/],
    ['prefs.undo.gate.countdown', /t\(remaining === 1 \? 'prefs\.undo\.gate\.countdownUm' : 'prefs\.undo\.gate\.countdown'/],
  ]) {
    assert.equal((dic.match(new RegExp(`'${k.replace(/\./g, '\\.')}Um':`, 'g')) || []).length, 4, `${k}Um não existe nas 4 línguas`);
    assert.match(app, uso, `${k}: o app não escolhe a forma singular com 1`);
  }
  // E o português de fato muda: "Falta 1", não "Faltam 1".
  assert.match(dic, /'toast\.devCountdownUm': 'Falta \{n\} /);
});

test('todo tipo de pedido que o SERVIDOR manda tem rótulo nas 4 línguas (o UPDATE saía em inglês)', () => {
  // `updateTypeKey = changes.length > 0 ? 'UPDATE' : 'UPDATE_DETAILS'` — e só o
  // segundo estava no dicionário: o card de atualização caía no `humanizarEnum`
  // ("Update", em inglês, pra todo mundo) e a folha do pedido recebido mostrava
  // a chave crua (auditoria de 2026-09-25).
  const core = read('server/core.mjs');
  const dic = read('js/i18n.js');
  const tipos = new Set([...core.matchAll(/updateTypeKey = (?:[^;]*?)'([A-Z_]+)'/g)].map((m) => m[1]));
  for (const m of core.matchAll(/updateTypeKey = changes\.length > 0 \? '([A-Z_]+)' : '([A-Z_]+)'/g)) { tipos.add(m[1]); tipos.add(m[2]); }
  assert.ok(tipos.has('UPDATE') && tipos.has('VENUE'), `o extrator não achou os tipos do core (${[...tipos]})`);
  for (const tipo of tipos) {
    const n = (dic.match(new RegExp(`'card\\.updateType\\.${tipo}':`, 'g')) || []).length;
    assert.equal(n, 4, `card.updateType.${tipo} aparece ${n}× — tem que ser 4`);
  }
  assert.doesNotMatch(read('js/app.js'), /t\('card\.updateType\.' \+ /, 'rótulo de tipo por `t` direto: chave nova sai crua');
});

test('o ↑ tem UM nome por língua — botão, selo, Ajuda, "Como funciona" e a preferência', () => {
  // O francês chamava o mesmo gesto de "Ignorer" no botão, no placar e na Ajuda,
  // e de "Passer" no "Como funciona" e no treino (auditoria de 2026-09-25) — e
  // "Ignorées" no placar lia como pedido DESCARTADO, o contrário do ↑ (fica pra
  // depois). A regra de consistência do CLAUDE.md: um conceito, um nome.
  for (const lang of LANGS) {
    const d = DICT[lang];
    const nome = d['card.btn.skip.aria'];
    for (const k of ['help.action.skip', 'card.stamp.skip', 'modal.comoFunciona.skip.nome']) {
      assert.equal(d[k], nome, `${lang}: ${k} = "${d[k]}", e o botão diz "${nome}"`);
    }
    for (const k of ['card.btn.skip.title', 'card.stamp.skipGuarda', 'prefs.pularGuarda.label']) {
      assert.ok(d[k].startsWith(nome.slice(0, 4)), `${lang}: ${k} = "${d[k]}", e o botão diz "${nome}"`);
    }
  }
  assert.doesNotMatch(Object.values(DICT.fr).join('\n'), /\bIgnor(er|ée|ées)\b/, 'fr: "Ignorer" voltou como nome do ↑');
});

test('o que o Desfazer desfaz é o PEDIDO, não o local (e o erro da ação idem)', () => {
  for (const lang of LANGS) {
    for (const k of ['undo.reject', 'undo.skip', 'action.verb.reject']) {
      assert.doesNotMatch(DICT[lang][k], /\bplace\b|\blieu\b/i, `${lang}: ${k} = "${DICT[lang][k]}"`);
    }
  }
});

test('treino: com o "Pular guarda o pedido" ligado, o efeito do ↑ NÃO diz que "não envia nada"', () => {
  const app = read('js/app.js');
  assert.match(app, /'treino\.efeito\.' \+ \(tipo === 'skip' && AppState\.preferences\.pularGuarda === true \? 'skipGuarda' : tipo\)/);
  for (const lang of LANGS) assert.match(DICT[lang]['treino.efeito.skipGuarda'], /⭐/, lang);
});

test('o "Sair" e a Privacidade dizem o que o aparelho guarda e o que FICA (idioma e tema)', () => {
  // Auditoria de 2026-09-25: o diálogo prometia apagar "cookies" (o aparelho não
  // guarda cookie nenhum, só o token) e "todos os dados" (idioma e tema ficam,
  // de propósito); a Privacidade omitia as conquistas e a lista de autores
  // rejeitados — id e nome de TERCEIROS.
  for (const lang of LANGS) {
    const sair = DICT[lang]['modal.logout.body'];
    const aparelho = DICT[lang]['help.privacy.device'];
    assert.doesNotMatch(sair, /cookie/i, `${lang}: o "Sair" promete apagar cookies do aparelho`);
    const conq = DICT[lang]['conq.titulo'].toLowerCase();
    assert.ok(sair.toLowerCase().includes(conq) && aparelho.toLowerCase().includes(conq), `${lang}: "${conq}" não aparece`);
    // Os dois textos dizem que idioma e tema FICAM.
    const fica = { pt: /idioma e o tema/, en: /language and theme/, es: /idioma y el tema/, fr: /langue et le thème/ }[lang];
    assert.match(sair, fica, `${lang}: o "Sair" não diz que idioma e tema ficam`);
    assert.match(aparelho, fica, `${lang}: a Privacidade não diz que idioma e tema ficam`);
  }
  // O que o logout MANTÉM é exatamente isso (a lista do teste de layout).
  const layout = read('test/layout.test.mjs');
  assert.match(layout, /const MANTIDAS = \['THEME_KEY', 'LANG_KEY'\];/);
});

test('espanhol: pedido é "solicitud" (feminino), e o placar concorda com ela', () => {
  // Auditoria de 2026-09-25: 71 textos diziam "solicitud" e dois "pedido"; e o
  // placar dizia "Leídos/Rechazados/Saltados" enquanto o Resumo do mês dizia
  // "leídas/rechazadas" — o mesmo conceito com dois gêneros.
  const es = DICT.es;
  for (const [k, v] of Object.entries(es)) assert.doesNotMatch(v, /\bpedidos?\b/i, `es: ${k} diz "pedido": "${v}"`);
  assert.deepEqual([es['stats.read'], es['stats.rejected'], es['stats.skipped']], ['Leídas', 'Rechazadas', 'Saltadas']);
  assert.match(es['resumo.img.lidos'], /leídas/);
});

test('inglês e francês usam o apóstrofo tipográfico (’) — só as strings OFICIAIS do WME ficam como vieram', () => {
  // Auditoria de 2026-09-25: 9 textos em inglês e 8 em francês tinham o
  // apóstrofo reto no meio de centenas com o tipográfico. Os `card.attr.*` são
  // colhidos da página do WME em cada idioma e ficam byte a byte como lá.
  for (const lang of ['en', 'fr']) {
    for (const [k, v] of Object.entries(DICT[lang])) {
      if (k.startsWith('card.attr.')) continue;
      assert.doesNotMatch(v.replace(/<[^>]*>/g, ''), /[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/, `${lang}: ${k} tem apóstrofo reto: "${v}"`);
    }
  }
  // francês: a DEMANDA é marcada como lue (feminino), como no botão.
  for (const k of ['undo.read', 'consequencia.read', 'modal.comoFunciona.read.nome', 'card.btn.read.aria']) {
    assert.match(DICT.fr[k], /lue\b/, `fr: ${k} = "${DICT.fr[k]}"`);
  }
});
