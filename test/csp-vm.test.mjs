// A VM manda MESMO a CSP no cabeçalho?
//
// String igual num arquivo não prova resposta HTTP. O `test/layout.test.mjs`
// compara as três cópias da política; este aqui sobe o `server/node.mjs` de
// verdade e lê os cabeçalhos que saem — que é o que o navegador vai ver.
//
// Existe porque a lacuna que ele fecha passou muito tempo invisível: o
// `_headers` é arquivo de Cloudflare, o Node nunca o leu, e rodar na VM era
// rodar só com o `<meta>` do index.src.html. Ninguém percebia porque tudo
// "funcionava" — só a segunda camada não existia. Comparar arquivos não teria
// achado isso; só pedindo a página e olhando a resposta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { setTimeout as dormir } from 'node:timers/promises';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

async function comServidor(porta, fn) {
  const p = spawn(process.execPath, [join(RAIZ, 'server', 'node.mjs')], {
    env: { ...process.env, PORT: String(porta), HOST: '127.0.0.1',
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`http://127.0.0.1:${porta}/`); if (r.ok) break; } catch {}
      await dormir(100);
    }
    await fn();
  } finally { p.kill(); }
}

test('a VM manda a CSP no cabeçalho, e não só no <meta>', async () => {
  await comServidor(8471, async () => {
    // O HTML é o que mais importa (é onde o script roda), mas os estáticos
    // também levam: a política vale pra resposta, não pra "página".
    // `/js/min/app.js` e não `/js/app.js`: o fonte comentado deixou de ser
    // servido (é entrada de build, como o `index.src.html`), então pedi-lo aqui
    // media um 404 e a asserção reprovava por motivo alheio à CSP.
    for (const caminho of ['/', '/js/min/app.js', '/css/app.css']) {
      const r = await fetch('http://127.0.0.1:8471' + caminho);
      assert.equal(r.status, 200, `${caminho} não respondeu 200`);
      const csp = r.headers.get('content-security-policy');
      assert.ok(csp, `${caminho}: a VM não mandou Content-Security-Policy — o app fica só com o <meta>`);
      assert.match(csp, /script-src [^;]*'self'/,
        `${caminho}: a CSP da VM não restringe script`);
      assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/,
        `${caminho}: a CSP da VM permite script inline — um XSS lê o sessionToken`);
      // O tema é inline e passa por HASH: sem ele no cabeçalho, a VM abre no
      // esquema errado (o script é bloqueado) — o mesmo defeito silencioso que
      // o teste do hash cobre do lado do arquivo.
      assert.match(csp, /'sha256-[A-Za-z0-9+/=]+'/,
        `${caminho}: sumiu o hash do script de tema da CSP da VM`);
      // Paridade com os outros headers de segurança, pra ninguém achar que a
      // CSP entrou no lugar de alguma coisa.
      assert.equal(r.headers.get('x-frame-options'), 'DENY', `${caminho}: sumiu o X-Frame-Options`);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `${caminho}: sumiu o nosniff`);
    }
  });
});

// A CSP QUE SAI COM O SCRIPT DO SERVICE WORKER GOVERNA O `fetch` DELE.
//
// Isto não é dedução: foi MEDIDO com controle, em duas origens locais, mudando
// só o `connect-src` — sem o host, o `fetch` de dentro do worker morre em
// "Failed to fetch"; com ele, volta 200. O `<meta>` do index NÃO alcança o
// worker, então quem manda ali é exclusivamente este cabeçalho.
//
// É a causa raiz do mapa ter sumido do app de todo editor em v2026.09.21-08: o
// worker interceptava o tile, pagava com `fetch(event.request)`, a CSP dele
// barrava, e `respondWith` é PROMESSA DE RESPONDER — a imagem falhava onde sem
// o service worker o navegador a teria carregado.
//
// O guard existe porque a dependência é invisível pelos dois lados: quem mexe
// na CSP não pensa no worker, e quem mexe no worker não pensa na CSP.
test('o script do service worker sai COM a CSP, e ela deixa o worker buscar tile', async () => {
  await comServidor(8474, async () => {
    const r = await fetch('http://127.0.0.1:8474/service-worker.js');
    assert.equal(r.status, 200, 'o service-worker.js não respondeu 200');
    const csp = r.headers.get('content-security-policy');
    assert.ok(csp, 'o service-worker.js saiu SEM Content-Security-Policy — o <meta> não alcança o worker,'
      + ' então a política que governa o fetch dele deixaria de existir sem ninguém perceber');
    const conn = (csp.match(/connect-src ([^;]*)/) || [])[1] || '';
    assert.ok(/https:\/\/www\.waze\.com(\s|$)/.test(conn),
      'o connect-src da resposta do service worker não tem https://www.waze.com — o fetch do worker'
      + ' pelo tile é barrado e o MAPA SOME pra todo editor, inclusive quem nunca ligou o offline.'
      + ' connect-src = ' + conn);
    // E o worker tem que poder ser registrado: `worker-src` governa isso.
    assert.match(csp, /worker-src [^;]*'self'/,
      'a CSP não permite registrar worker de mesma origem — o service worker nem instala');
  });
});

// A CSP não é o único cabeçalho que o `_headers` declara e o Node precisa
// repetir. HSTS ficou pra trás quando a CSP foi portada — mesma família, mesmo
// arquivo, correção incompleta — e passou despercebido porque o teste olhava um
// cabeçalho só. Este compara o CONJUNTO: tudo que o `_headers` promete no `/*`
// tem que sair também na VM.
//
// Vale como rede pro próximo: cabeçalho novo no `_headers` que ninguém copiar
// pro adaptador reprova aqui, em vez de sumir calado numa migração.
test('os cabeçalhos de segurança da VM batem com os que o _headers promete', async () => {
  const headers = readFileSync(join(RAIZ, '_headers'), 'utf8');
  const bloco = headers.slice(headers.indexOf('/*'), headers.indexOf('\n#', headers.indexOf('/*')));
  const prometidos = Object.fromEntries(
    [...bloco.matchAll(/^\s+([A-Za-z-]+):\s*(.+)$/gm)].map((m) => [m[1].toLowerCase(), m[2].trim()]));
  assert.ok(Object.keys(prometidos).length >= 5,
    `só ${Object.keys(prometidos).length} cabeçalhos lidos do _headers — o parser quebrou`);

  await comServidor(8472, async () => {
    const r = await fetch('http://127.0.0.1:8472/');
    const faltando = [];
    for (const nome of Object.keys(prometidos)) {
      if (!r.headers.get(nome)) faltando.push(nome);
    }
    assert.deepEqual(faltando, [],
      `a VM não manda ${faltando.join(', ')} — o _headers promete e o Node não cumpre`);
    // A CSP tem teste próprio (é longa e tem regra de comparação por diretiva);
    // aqui o valor exato dos OUTROS é cobrado, porque valor diferente é tão
    // divergência quanto ausência.
    for (const [nome, valor] of Object.entries(prometidos)) {
      if (nome === 'content-security-policy') continue;
      assert.equal(r.headers.get(nome), valor,
        `${nome} diverge:\n  _headers: ${valor}\n  VM:       ${r.headers.get(nome)}`);
    }
  });
});

// Resposta de /api NUNCA pode ser cacheada, e nos DOIS destinos.
//
// Hoje nada ali é cacheado — é POST, e POST não entra em cache por padrão. Mas
// "por padrão" é a palavra: o painel do Cloudflare tem um interruptor de cache
// padrão pras respostas de fetch handler, e um proxy na frente da VM pode ter
// política própria. O modo de falha não é lentidão: é a resposta de um editor
// (perfil, fila, sessão) sendo servida pra outro.
test('toda resposta de /api sai com no-store, no Node e no Worker', async () => {
  const porta = 8218;
  await comServidor(porta, async () => {
    // Caminhos que respondem coisas diferentes: 401 sem sessão, 404 de rota
    // inexistente e 405 de método errado. Todos são resposta de API.
    const casos = [
      ['POST', 'perfil', 401],
      ['POST', 'rota-que-nao-existe', 404],
      ['GET', 'perfil', 405],
    ];
    for (const [metodo, rota, esperado] of casos) {
      const r = await fetch(`http://127.0.0.1:${porta}/api/${rota}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: metodo === 'POST' ? '{}' : undefined,
      });
      assert.equal(r.status, esperado, `${metodo} /api/${rota}`);
      assert.match(r.headers.get('cache-control') || '', /no-store/,
        `${metodo} /api/${rota} saiu sem no-store`);
      // E com `nosniff` (e o resto do conjunto de segurança): a VM respondia a
      // API sem eles (auditoria de 2026-09-25).
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `${metodo} /api/${rota} saiu sem nosniff`);
      assert.ok(r.headers.get('x-frame-options'), `${metodo} /api/${rota} saiu sem X-Frame-Options`);
    }
    // O 405 dos ESTÁTICOS também leva o conjunto.
    const r405 = await fetch(`http://127.0.0.1:${porta}/index.html`, { method: 'DELETE' });
    assert.equal(r405.status, 405);
    assert.equal(r405.headers.get('x-content-type-options'), 'nosniff', 'o 405 dos estáticos saiu sem nosniff');
  });

  // E o adaptador do Cloudflare tem que carimbar igual — os dois destinos
  // precisam ser o MESMO app (gotcha #14).
  const worker = readFileSync(join(RAIZ, 'worker', 'index.mjs'), 'utf8');
  const fn = worker.match(/const json = [\s\S]*?\}\);/);
  assert.ok(fn, 'sumiu o helper json() do worker');
  assert.match(fn[0], /'Cache-Control':\s*'no-store'/,
    'o Worker parou de carimbar no-store nas respostas de /api');
  assert.match(fn[0], /'X-Content-Type-Options':\s*'nosniff'/,
    'o Worker parou de carimbar nosniff nas respostas de /api');
});

// O `_headers` corta o Cache-Control por CAMINHO, e o adaptador cortava por
// EXTENSÃO — divergiam nos ícones, que caíam no `immutable` de um ano por
// `.svg` não estar na lista de no-cache. Nome de ícone é fixo (`icon-512.svg`),
// então um ano de immutable significa trocar o ícone e ninguém ver.
//
// Enquanto o Cloudflare serve os estáticos isso é inerte (quem manda é o
// `_headers`). Vira real no dia em que a origem for a VM e o Cloudflare ficar
// só de WAF na frente — cenário do owner —, porque aí o `_headers` deixa de
// ser aplicado e TUDO passa a vir do adaptador.
test('o Cache-Control por caminho da VM bate com o do _headers', async () => {
  const headers = readFileSync(join(RAIZ, '_headers'), 'utf8');
  const regras = {};
  let atual = null;
  for (const linha of headers.split('\n')) {
    if (linha.startsWith('/')) atual = linha.trim();
    else if (atual && /Cache-Control:/i.test(linha)) regras[atual] = linha.split(':').slice(1).join(':').trim();
  }
  // Um exemplo REAL por regra: padrão do `_headers` não se testa, testa-se o
  // arquivo que ele governa.
  const EXEMPLOS = {
    '/service-worker.js': '/service-worker.js',
    '/js/*': '/js/min/app.js',   // o SERVIDO; o fonte é entrada de build (404)
    '/css/*': '/css/app.css',
    '/manifest.json': '/manifest.json',
    '/icons/*': '/icons/icon-512.svg',
    '/fonts/*': '/fonts/inter-latin-wght-normal.woff2',
  };
  const semExemplo = Object.keys(regras).filter((r) => r !== '/*' && !EXEMPLOS[r]);
  assert.deepEqual(semExemplo, [],
    `regra nova no _headers sem exemplo aqui: ${semExemplo.join(', ')} — acrescente e confira`);

  await comServidor(8474, async () => {
    for (const [regra, caminho] of Object.entries(EXEMPLOS)) {
      if (!regras[regra]) continue;
      const r = await fetch(`http://127.0.0.1:8474${caminho}`);
      assert.equal(r.headers.get('cache-control'), regras[regra],
        `${caminho} diverge:\n  _headers (${regra}): ${regras[regra]}\n  VM:${' '.repeat(regra.length - 1)} ${r.headers.get('cache-control')}`);
    }
  });
});
