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
import { spawn } from 'node:child_process';
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
const CODIGO = ['/', '/index.html', '/js/app.js', '/js/i18n.js', '/css/app.css', '/manifest.json'];

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
    // recebe 304 pra um recurso que ele nunca baixou e a app quebra em silêncio.
    const a = (await fetch(URL_('/js/app.js'))).headers.get('etag');
    const b = (await fetch(URL_('/js/i18n.js'))).headers.get('etag');
    assert.notEqual(a, b, 'dois arquivos diferentes com o mesmo ETag');

    // E ETag que não bate NÃO pode virar 304.
    const r = await fetch(URL_('/js/app.js'), { headers: { 'If-None-Match': '"naoexiste"' } });
    assert.equal(r.status, 200, 'devolveu 304 pra um ETag que não é o do arquivo');
    assert.ok((await r.text()).length > 0, '200 sem corpo');
  });
});

test('o service worker não volta a pular o cache HTTP', async () => {
  // `cache: 'reload'` pula o cache E não manda If-None-Match, então todo
  // carregamento rebaixa a app inteira. MEDIDO no fio, num F5 com o SW no
  // controle: 680 KB com `reload` contra 4,2 KB sem opção nenhuma. E
  // `cache: 'no-cache'` NÃO resolve — medido igual ao `reload`, 0 × 304.
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(join(RAIZ, 'service-worker.js'), 'utf8');
  const chamada = sw.match(/fetch\(event\.request[^)]*\)/g) || [];
  assert.ok(chamada.length > 0, 'sumiu o fetch do ramo network-first');
  for (const c of chamada) {
    assert.doesNotMatch(c, /cache:\s*'(reload|no-cache)'/,
      `${c} rebaixa a app inteira a cada carregamento — a garantia anti-skew é do no-cache do servidor`);
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
  //    bloqueado EM SILÊNCIO (a app abre no esquema de cor errado).
  const h = (x) => {
    const m = /<script>([\s\S]*?)<\/script>/.exec(x);
    return m ? createHash('sha256').update(m[1], 'utf8').digest('base64') : null;
  };
  assert.ok(h(fonte), 'sumiu o script inline do tema do fonte');
  assert.equal(h(gerado), h(fonte),
    'a minificação mudou o script inline — a CSP bloquearia o tema sem avisar');
});
