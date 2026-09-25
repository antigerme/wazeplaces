// O estático da VM revalida em vez de rebaixar?
//
// O service worker deixou de usar `cache: 'reload'` porque a garantia de
// "nunca servir versão velha" passou a vir do CABEÇALHO (`no-cache,
// must-revalidate`), não de pular o cache. Isso torna o SW dependente de duas
// coisas que o servidor precisa fazer, e é aqui que elas ficam cobradas:
//
//   1. `no-cache` nos tipos que são CÓDIGO (html/js/css/json). Sem isso o
//      navegador pode reusar sem perguntar, e volta o version skew (gotcha
//      #18): HTML novo com JS velho, recurso novo falhando em silêncio.
//   2. ETag, e 304 quando ele bate. `no-cache` manda REVALIDAR — sem ETag não
//      há o que perguntar, a revalidação vira download inteiro e a economia
//      não existe. Era exatamente o caso da VM: o Cloudflare mandava ETag
//      sozinho, o adaptador Node não mandava nenhum.
//
// Comparar string em arquivo não provaria nada disso: é resposta HTTP. Mesmo
// motivo do `test/csp-vm.test.mjs`, e mesma lacuna que ele fechou — adaptador
// não herda a cobertura do core (gotcha #61).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as dormir } from 'node:timers/promises';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = 8473;
const URL_ = (p) => `http://127.0.0.1:${PORTA}${p}`;

// Código = o que o SW trata como network-first. Se esta lista divergir da do
// `service-worker.js` (`isCode`), um tipo fica sem a garantia e ninguém vê.
//
// Os caminhos são os que o app CARREGA (`/js/min/…`), não os fontes. Até
// 2026-09-22 esta lista pedia `/js/app.js` e `/js/i18n.js`, que o app nunca
// busca — ela media o cabeçalho de um arquivo que ninguém recebe, e passava
// verde enquanto o `js/min/` real seguia sem ser conferido aqui. O conserto
// que tirou os fontes de circulação foi o que denunciou: eles viraram 404 e a
// asserção caiu.
const CODIGO = ['/', '/index.html', '/js/min/app.js', '/js/min/i18n.js', '/css/app.css', '/manifest.json'];

async function comServidor(fn) {
  const p = spawn(process.execPath, [join(RAIZ, 'server', 'node.mjs')], {
    env: { ...process.env, PORT: String(PORTA), HOST: '127.0.0.1',
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(URL_('/')); if (r.ok) break; } catch { /* subindo */ }
      await dormir(100);
    }
    await fn();
  } finally { p.kill(); }
}

test('estáticos da VM: no-cache no código, ETag em tudo, e 304 quando bate', async () => {
  await comServidor(async () => {
    for (const caminho of CODIGO) {
      const r = await fetch(URL_(caminho));
      assert.equal(r.status, 200, `${caminho} não respondeu 200`);

      const cc = r.headers.get('cache-control') || '';
      assert.match(cc, /no-cache/,
        `${caminho} sem no-cache — o navegador pode reusar sem perguntar e volta o version skew`);

      const etag = r.headers.get('etag');
      assert.ok(etag, `${caminho} sem ETag — a revalidação vira download inteiro`);

      // O ETag tem que ser ESTÁVEL: se mudar a cada pedido, nenhum 304 ocorre
      // e o defeito fica invisível (as respostas seguem "corretas", só caras).
      const r2 = await fetch(URL_(caminho));
      assert.equal(r2.headers.get('etag'), etag, `${caminho}: ETag muda entre pedidos iguais`);

      const cond = await fetch(URL_(caminho), { headers: { 'If-None-Match': etag } });
      assert.equal(cond.status, 304, `${caminho} não devolve 304 com o ETag dele`);
      assert.equal((await cond.text()).length, 0, `${caminho} mandou corpo junto com o 304`);
    }
  });
});

test('estáticos da VM: ETag diferente para conteúdo diferente, e nada de 304 falso', async () => {
  await comServidor(async () => {
    // Dois arquivos distintos não podem compartilhar ETag — senão o navegador
    // recebe 304 pra um recurso que ele nunca baixou e o app quebra em silêncio.
    // Os caminhos são os SERVIDOS. Com os fontes (`/js/app.js`) isto media dois
    // 404 sem ETag: `notEqual(null, null)` reprova — mas se só UM fosse nulo
    // passaria, e o teste estaria verde medindo o nada. Daí a checagem de
    // presença antes da comparação.
    const a = (await fetch(URL_('/js/min/app.js'))).headers.get('etag');
    const b = (await fetch(URL_('/js/min/i18n.js'))).headers.get('etag');
    assert.ok(a && b, 'um dos dois veio sem ETag — sem isto a comparação abaixo passa por vácuo');
    assert.notEqual(a, b, 'dois arquivos diferentes com o mesmo ETag');

    // E ETag que não bate NÃO pode virar 304.
    const r = await fetch(URL_('/js/min/app.js'), { headers: { 'If-None-Match': '"naoexiste"' } });
    assert.equal(r.status, 200, 'devolveu 304 pra um ETag que não é o do arquivo');
    assert.ok((await r.text()).length > 0, '200 sem corpo');
  });
});

test('o service worker não volta a pular o cache HTTP', async () => {
  // `cache: 'reload'` pula o cache E não manda If-None-Match, então todo
  // carregamento rebaixa o app inteiro. MEDIDO no fio, num F5 com o SW no
  // controle: 680 KB com `reload` contra 4,2 KB sem opção nenhuma. E
  // `cache: 'no-cache'` NÃO resolve — medido igual ao `reload`, 0 × 304.
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(join(RAIZ, 'service-worker.js'), 'utf8');
  const chamada = sw.match(/fetch\(event\.request[^)]*\)/g) || [];
  assert.ok(chamada.length > 0, 'sumiu o fetch do ramo network-first');
  for (const c of chamada) {
    assert.doesNotMatch(c, /cache:\s*'(reload|no-cache)'/,
      `${c} rebaixa o app inteiro a cada carregamento — a garantia anti-skew é do no-cache do servidor`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  A raiz serve o HTML MINIFICADO — e NENHUM adaptador remapeia rota
// ═══════════════════════════════════════════════════════════════════════════
//
// `index.html` é o GERADO por `npm run html`; o fonte comentado é o
// `index.src.html`, que é o que se edita, o que os testes leem e o que o
// Tailwind varre. MEDIDO num 3G com CPU 4x lenta: 36 → 20 KB gzip, FCP de
// 2036 para 1648ms, load de 4543 para 3540ms.
//
// ── POR QUE ESTE GUARD MUDOU DE FORMA ────────────────────────────────────
// A versão anterior cobrava que os DOIS adaptadores REMAPEASSEM a raiz pro
// `index.min.html`. Os dois remapeavam, o guard passava — e no Cloudflare o
// remap NUNCA rodou: com `assets.directory: "."` o `index.html` existe como
// asset, `/` casa com ele, e o pipeline responde ANTES do Worker. O guard
// verificava INTENÇÃO (o `if` está escrito) e não COMPORTAMENTO (ele roda).
// MEDIDO em produção: `/` devolvia 182.791 bytes do fonte por três semanas.
//
// Hoje não há rota pra desviar, então o guard cobra o que dá pra verificar
// daqui: que o arquivo servido está minificado, que o fonte não é alcançável
// por caminho nenhum, e que ninguém reintroduziu o remap.
test('raiz: o index.html servido é o minificado, e o fonte não vaza', () => {
  const node = readFileSync(new URL('../server/node.mjs', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker/index.mjs', import.meta.url), 'utf8');
  const ignore = readFileSync(new URL('../.assetsignore', import.meta.url), 'utf8');
  const tw = readFileSync(new URL('../tailwind.config.js', import.meta.url), 'utf8');

  // ── Ancorar na ESTRUTURA, nunca na menção do nome ──────────────────────
  // A primeira versão deste guard procurava a STRING `index.min.html` nos
  // adaptadores, e reprovou no próprio comentário que documenta o conserto
  // (gotcha #14 ao contrário). A segunda tentou varrer comentário antes — e o
  // varredor comeu 86% do node.mjs, porque a string da CSP tem
  // `https://*.waze.com` e o `/*` dali casa até o próximo `*/` de verdade.
  // Terceira e definitiva: cobrar o MECANISMO e a ENTRADA ENTRE ASPAS, que
  // comentário em prosa não produz.

  // 1) A VM resolve a raiz pro índice, e não remapeia pra lugar nenhum.
  assert.match(node, /if \(isRoot\) rel = '\/index\.html';/,
    'a VM parou de resolver a raiz pro index.html gerado — a raiz daria 404');
  assert.ok(!/rel = '\/index\.min\.html'/.test(node),
    'voltou a atribuição pro index.min.html na VM — o arquivo não existe mais');

  // 2) O Worker NÃO reescreve rota. Com `assets.directory: "."` o `/` casa com
  //    o asset `index.html` e o pipeline responde ANTES do Worker, então um
  //    remap aqui é um `if` que mente. MEDIDO em produção: `/` devolvia o fonte
  //    de 182.791 bytes por três semanas com este `if` escrito e verde no teste.
  assert.ok(!/alvo\.pathname/.test(worker),
    'o Worker voltou a reescrever pathname — no Cloudflare esse ramo não roda');
  assert.ok(!/new Request\(alvo/.test(worker),
    'o Worker voltou a montar Request com alvo reescrito');
  assert.match(worker, /return env\.ASSETS\.fetch\(request\);/,
    'o Worker deixou de delegar o estático direto pro ASSETS');

  // 3) O FONTE não é alcançável em NENHUM destino. A asserção é pela ENTRADA
  //    ENTRE ASPAS: o comentário logo acima da lista CITA `/index.src.html`
  //    em prosa, e é isso que precisa não contar.
  const bloco = node.slice(node.indexOf('ALLOWED_ROOT_FILES = new Set(['),
                           node.indexOf(']);', node.indexOf('ALLOWED_ROOT_FILES')));
  assert.ok(bloco.includes("'/index.html',"), 'o gerado saiu da allowlist da VM — a raiz daria 404');
  assert.ok(!bloco.includes("'/index.src.html'"),
    'o FONTE entrou na allowlist da VM: 178 KB com 73 comentários por um segundo caminho');
  // CONTRAPROVA de que a asserção acima distingue prosa de entrada:
  assert.ok(bloco.includes('index.src.html'),
    'o comentário que explica a ausência do fonte saiu da lista — sem ele a próxima pessoa relista');
  assert.match(ignore, /^index\.src\.html$/m,
    'o FONTE saiu do .assetsignore — o Cloudflare passaria a publicá-lo');

  // 4) O Tailwind varre o FONTE. Varrer o gerado cria dependência de ORDEM
  //    entre `npm run html` e `npm run css`, e classe nova some em silêncio.
  assert.ok(tw.includes("'./index.src.html'"), 'o Tailwind deixou de varrer o fonte');
  assert.ok(!tw.includes("'./index.html'"), 'o Tailwind passou a varrer o GERADO');

  // 5) O gerado está minificado. Este par fecha um buraco real do gerador:
  //    quando o hash do inline divergia, a versão antiga gravava o FONTE na
  //    saída — e aí o diff do CI PASSAVA (regenerar dava o mesmo cru) com a
  //    raiz servindo 67 KB a mais. Hoje o gerador não escreve nada nesse caso,
  //    e estas duas linhas são a segunda camada.
  const fonte = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  const gerado = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(gerado.length < fonte.length * 0.8,
    `o index.html não está minificado (${gerado.length} de ${fonte.length}) — rode \`npm run html\``);
  assert.ok(!gerado.includes('<!--'), 'sobrou comentário no index.html gerado');

  // 6) O hash do inline é o que a CSP autoriza: um byte a mais e o tema é
  //    bloqueado EM SILÊNCIO (o app abre no esquema de cor errado).
  const h = (x) => {
    const m = /<script>([\s\S]*?)<\/script>/.exec(x);
    return m ? createHash('sha256').update(m[1], 'utf8').digest('base64') : null;
  };
  assert.ok(h(fonte), 'sumiu o script inline do tema do fonte');
  assert.equal(h(gerado), h(fonte),
    'a minificação mudou o script inline — a CSP bloquearia o tema sem avisar');
});

// ── O .assetsignore decide o que o Cloudflare PUBLICA, e o esquecimento é mudo ──
//
// Medido na produção em 2026-09-22, com o app no ar: `/tools/waze-probe.mjs`,
// `/tools/fixtures-paises.json` e `/test/core.test.mjs` respondiam **200** —
// 23 arquivos de ferramenta e 47 de teste servidos como se fossem frontend. E
// junto deles os FONTES comentados: `js/app.js` com 622 KB contra os 201 KB do
// `js/min/app.js` que o app de fato carrega, `css/styles.css` com 117 KB
// contra 77 KB do `css/app.css`.
//
// Nada disso dá erro. O `assets.directory` é a raiz, então o padrão é PUBLICAR,
// e quem não está na lista entra — pasta nova nasce pública e ninguém percebe,
// porque o app continua funcionando exatamente igual. É o contrário do modo de
// falha normal: aqui o defeito é algo a MAIS existir, e teste que exercita o
// app nunca olha pra isso.
//
// Daí os dois sentidos abaixo. O primeiro cobra que toda entrada da raiz tenha
// uma DECISÃO (frontend ou ignorada) — pasta nova reprova em vez de vazar. O
// segundo é o inverso e é o que protege a produção: tudo que o `index.html` e
// o `service-worker.js` carregam tem que CONTINUAR publicado. Sem ele, um
// padrão largo demais (`js/*.js` escrito como `js/**`) apagaria o `js/min/` e
// derrubaria o app inteiro — e o primeiro guard passaria feliz.

// Casador no estilo .gitignore, só o que a lista usa: nome exato (casa em
// qualquer nível), `dir/arquivo`, `dir/*.ext` (o `*` NÃO atravessa `/`) e
// `*.ext`. É o bastante pros padrões daqui, e é explícito pra não virar
// adivinhação silenciosa quando alguém acrescentar um padrão novo.
function ignorado(caminho, padroes) {
  const partes = caminho.split('/');
  for (const p of padroes) {
    if (!p.includes('/')) {
      // sem barra: casa em qualquer nível
      const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
      if (partes.some((s) => re.test(s))) return p;
      continue;
    }
    // com barra: ancorado na raiz, e `*` não atravessa `/`
    const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '(/|$)');
    if (re.test(caminho)) return p;
  }
  return null;
}

const PADROES = readFileSync(join(RAIZ, '.assetsignore'), 'utf8')
  .split('\n').map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));   // comentário nunca é padrão (gotcha #67)

test('.assetsignore: toda entrada da raiz tem DECISÃO — frontend ou ignorada', () => {
  // O que é frontend de verdade. Curto de propósito: crescer esta lista é um
  // ato deliberado, que é justamente o que faltou pro `tools/` e pro `test/`.
  const FRONTEND = new Set([
    'index.html', 'manifest.json', 'service-worker.js',
    'js', 'css', 'icons', 'fonts',
    '_headers',            // consumido pelo Cloudflare, nunca servido
    'LICENSE',             // licença do projeto: publicar é o certo
    'extensao-chrome',     // a extensão que o editor instala — distribuição
  ]);
  // `git ls-files` e não `ls-tree HEAD`: o índice já enxerga a pasta nova que
  // alguém acabou de `git add`, e é aí que o aviso vale — depois de commitada
  // ela já está a um merge de ser publicada. Em CI os dois dão o mesmo.
  const entradas = [...new Set(execSync('git ls-files', { cwd: RAIZ, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => s.split('/')[0]))];
  assert.ok(entradas.length > 10, 'não consegui listar a raiz do repo — instrumento quebrado');

  const vazando = entradas.filter((e) => !FRONTEND.has(e) && !ignorado(e, PADROES));
  assert.deepEqual(vazando, [],
    `estas entradas da raiz seriam PUBLICADAS e não são frontend: ${vazando.join(', ')}. ` +
    'Ou acrescente ao .assetsignore, ou declare como frontend na lista deste teste.');

  // As duas que motivaram o guard, por nome — pra a regressão dizer o que quebrou
  for (const d of ['tools', 'test']) {
    assert.ok(ignorado(d, PADROES), `${d}/ voltou a ser publicado (23+47 arquivos de dev no ar)`);
  }
  // E os FONTES, que são entrada de build e não asset (mesma decisão do index.src.html)
  assert.ok(ignorado('js/app.js', PADROES), 'o fonte comentado do app voltou a ser publicado');
  assert.ok(ignorado('css/styles.css', PADROES), 'o fonte do CSS voltou a ser publicado');
  // E o que só existe na máquina de quem desenvolve: um `wrangler deploy` local
  // publica o diretório como ele está, e é nele que o cookies.txt do owner
  // circula (seção 🔑 do CLAUDE.md), ao lado de logs e diagnósticos com token.
  for (const f of ['cookies.txt', 'antigerme_cookies.txt', 'tools/smoke.log', 'diagnostico-2026-09-25.zip']) {
    assert.ok(ignorado(f, PADROES), `${f} seria PUBLICADO num deploy feito da máquina local`);
  }
});

test('.assetsignore: nada que o app CARREGA pode estar ignorado', () => {
  // O sentido inverso, e é o que protege a produção. Um padrão largo demais
  // apaga o `js/min/` e o app morre inteiro — com o guard de cima passando.
  const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
  const sw = readFileSync(join(RAIZ, 'service-worker.js'), 'utf8');

  const doHtml = [...html.matchAll(/(?:src|href)="((?!https?:|data:|\/\/)[^"]+\.(?:js|css))"/g)]
    .map((m) => m[1].replace(/^\.?\//, ''));
  const doSw = [...sw.matchAll(/^\s*'\/((?:js|css)\/[^']+)',?\s*$/gm)].map((m) => m[1]);
  const carregados = [...new Set([...doHtml, ...doSw, 'js/min/qr.js'])];   // qr entra sob demanda

  assert.ok(carregados.length >= 9,
    `achei só ${carregados.length} recursos carregados — o extrator quebrou, não o .assetsignore`);
  assert.ok(carregados.some((c) => c.startsWith('js/min/')) && carregados.includes('css/app.css'),
    'o extrator não achou nem os js/min nem o css/app.css — instrumento errado');

  const mortos = carregados.map((c) => [c, ignorado(c, PADROES)]).filter(([, p]) => p);
  assert.deepEqual(mortos, [],
    'o .assetsignore está apagando arquivo que o app CARREGA — a produção subiria quebrada: ' +
    mortos.map(([c, p]) => `${c} (pelo padrão "${p}")`).join(', '));
});

test('a VM NÃO serve fonte de build — e o .assetsignore não alcança ela', async () => {
  // O outro destino. O `.assetsignore` é arquivo de Cloudflare e o Node nunca o
  // leu: tirar `js/*.js` de lá conserta a borda e deixa a VM servindo os mesmos
  // 622 KB. Gotcha #14 — o app tem que ser o MESMO nos dois, senão "levar pra
  // uma VM" deixa de ser decisão de infraestrutura e vira mudança de
  // comportamento. E por RESPOSTA HTTP, não por string: o `csp-vm` já pagou
  // essa lição (arquivo igual não prova cabeçalho enviado).
  await comServidor(async () => {
    const SOME = ['/js/app.js', '/js/i18n.js', '/js/swipe.js', '/js/mapa.js', '/js/api.js',
                  '/css/styles.css', '/css/tailwind.src.css',
                  '/tools/waze-probe.mjs', '/test/core.test.mjs'];
    for (const c of SOME) {
      const r = await fetch(URL_(c));
      assert.equal(r.status, 404,
        `${c} é servido pela VM (${r.status}) — fonte de build ou ferramenta de dev no ar`);
    }
    // CONTROLE, e sem ele o teste acima passa por vácuo: um corte largo demais
    // levaria o `js/min/` junto e TODO caminho daria 404, com as asserções de
    // cima todas verdes e o app morto.
    const FICA = ['/js/min/app.js', '/js/min/i18n.js', '/js/min/qr.js', '/js/min/version.js',
                  '/css/app.css', '/index.html', '/manifest.json', '/service-worker.js',
                  '/icons/icon-192.svg', '/fonts/inter-latin-wght-normal.woff2'];
    for (const c of FICA) {
      const r = await fetch(URL_(c));
      assert.equal(r.status, 200, `${c} PAROU de ser servido pela VM — o app sobe quebrado`);
    }
  });
});

test('estáticos da VM: o ETag FRACO que a borda devolve também dá 304 (e a lista, e o *)', async () => {
  // Auditoria de 2026-09-25: atrás do Cloudflare a borda comprime e rebaixa o
  // ETag pra `W/"…"`; com a igualdade estrita a VM nunca respondia 304.
  await comServidor(async () => {
    const etag = (await fetch(URL_('/js/min/app.js'))).headers.get('etag');
    assert.ok(etag && etag.startsWith('"'), 'a VM deixou de mandar ETag forte');
    for (const pedida of ['W/' + etag, '"outro", W/' + etag, '*']) {
      const r = await fetch(URL_('/js/min/app.js'), { headers: { 'If-None-Match': pedida } });
      assert.equal(r.status, 304, `If-None-Match ${pedida} não deu 304`);
    }
    // Controle: o fraco de OUTRO conteúdo segue dando 200.
    const r = await fetch(URL_('/js/min/app.js'), { headers: { 'If-None-Match': 'W/"naoexiste"' } });
    assert.equal(r.status, 200);
  });
});

test('a VM roteia a API pelo caminho NORMALIZADO, como o Worker (`/api/./sessao` é `sessao`)', async () => {
  const { request } = await import('node:http');
  const postCru = (caminho) => new Promise((ok, erro) => {
    const r = request({ host: '127.0.0.1', port: PORTA, method: 'POST', path: caminho, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let corpo = ''; res.on('data', (c) => { corpo += c; }); res.on('end', () => ok({ status: res.statusCode, corpo }));
    });
    r.on('error', erro);
    r.end('{}');
  });
  await comServidor(async () => {
    const normal = await postCru('/api/sessao');
    const comPonto = await postCru('/api/./sessao');
    assert.equal(comPonto.status, normal.status, `o mesmo pedido teve duas respostas: ${normal.status} × ${comPonto.status}`);
    assert.equal(comPonto.corpo, normal.corpo);
    // Controle: rota que não existe continua não existindo.
    const nada = await postCru('/api/nao-existe');
    assert.notEqual(nada.status, normal.status);
  });
});
