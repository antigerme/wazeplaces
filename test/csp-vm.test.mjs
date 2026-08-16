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
