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
//  A raiz serve o HTML MINIFICADO, e os dois adaptadores concordam
// ═══════════════════════════════════════════════════════════════════════════
//
// `index.min.html` é GERADO por `npm run html` e commitado; o `index.html` é o
// fonte comentado, que é o que se edita, o que os testes leem e o que o
// Tailwind varre. MEDIDO num 3G com CPU 4x lenta: 36 → 20 KB gzip, FCP de
// 2036 para 1648ms, load de 4543 para 3540ms.
//
// Os DOIS adaptadores precisam remapear igual. Divergência aqui é a família do
// gotcha #14: a app deixaria de ser a mesma nos dois destinos, e "levar pra uma
// VM" viraria mudança de comportamento em vez de decisão de infraestrutura.
test('raiz: os dois adaptadores servem o HTML minificado, não o fonte', async () => {
  const node = readFileSync(new URL('../server/node.mjs', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker/index.mjs', import.meta.url), 'utf8');

  // Cada um remapeia a raiz E o /index.html — senão são duas URLs com conteúdos
  // diferentes, e o service worker precacheia as duas.
  assert.match(node, /isRoot \|\| rel === '\/index\.html'\)\s*rel = '\/index\.min\.html'/,
    'o adaptador da VM parou de remapear a raiz pro minificado');
  assert.match(worker, /pathname === '\/' \|\| url\.pathname === '\/index\.html'/,
    'o adaptador do Cloudflare parou de remapear a raiz');
  assert.match(worker, /pathname = '\/index\.min\.html'/,
    'o adaptador do Cloudflare não aponta pro minificado');

  // O FONTE não pode ser alcançável: listá-lo na allowlist abriria um segundo
  // caminho pro arquivo comentado.
  const bloco = node.slice(node.indexOf('ALLOWED_ROOT_FILES'), node.indexOf('function isAllowedAsset'));
  assert.ok(bloco.includes("'/index.min.html'"), 'o minificado saiu da allowlist da VM');
  assert.ok(!/'\/index\.html',/.test(bloco), 'o fonte voltou pra allowlist — duas URLs, dois conteúdos');

  // E o gerado precisa estar EM DIA com o fonte: editar o index.html sem rodar
  // `npm run html` manda a versão velha pro navegador, sem quebrar teste nenhum.
  const fonte = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const min = readFileSync(new URL('../index.min.html', import.meta.url), 'utf8');
  assert.ok(min.length < fonte.length, 'o index.min.html não está minificado');
  assert.ok(!min.includes('<!--'), 'sobrou comentário no index.min.html');
  // O hash do inline é o que a CSP autoriza: um byte a mais e o tema é
  // bloqueado EM SILÊNCIO.
  const h = (s) => {
    const m = /<script>([\s\S]*?)<\/script>/.exec(s);
    return m ? createHash('sha256').update(m[1], 'utf8').digest('base64') : null;
  };
  assert.equal(h(min), h(fonte),
    'a minificação mudou o script inline — a CSP bloquearia o tema sem avisar');
});
