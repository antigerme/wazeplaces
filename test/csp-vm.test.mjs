// A VM manda MESMO a CSP no cabeçalho?
//
// String igual num arquivo não prova resposta HTTP. O `test/layout.test.mjs`
// compara as três cópias da política; este aqui sobe o `server/node.mjs` de
// verdade e lê os cabeçalhos que saem — que é o que o navegador vai ver.
//
// Existe porque a lacuna que ele fecha passou muito tempo invisível: o
// `_headers` é arquivo de Cloudflare, o Node nunca o leu, e rodar na VM era
// rodar só com o `<meta>` do index.html. Ninguém percebia porque tudo
// "funcionava" — só a segunda camada não existia. Comparar arquivos não teria
// achado isso; só pedindo a página e olhando a resposta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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
      await new Promise((r) => setTimeout(r, 100));
    }
    await fn();
  } finally { p.kill(); }
}

test('a VM manda a CSP no cabeçalho, e não só no <meta>', async () => {
  await comServidor(8471, async () => {
    // O HTML é o que mais importa (é onde o script roda), mas os estáticos
    // também levam: a política vale pra resposta, não pra "página".
    for (const caminho of ['/', '/js/app.js', '/css/app.css']) {
      const r = await fetch('http://127.0.0.1:8471' + caminho);
      assert.equal(r.status, 200, `${caminho} não respondeu 200`);
      const csp = r.headers.get('content-security-policy');
      assert.ok(csp, `${caminho}: a VM não mandou Content-Security-Policy — a app fica só com o <meta>`);
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
    '/js/*': '/js/app.js',
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
