// Adaptador VM (RedHat/Node) — servidor HTTP puro, sem dependências npm.
//
// Serve os arquivos estáticos do frontend e roteia POST /api/* pro core,
// usando o filesystem pra sessões (espelha o modelo /tmp do PHP antigo).
// Mesma server/core.mjs que roda no Cloudflare — zero divergência de lógica.
//
// Rodar:   node server/node.mjs
// Env:     PORT (8080), HOST (0.0.0.0), ENCRYPTION_KEY (base64; auto-gera se
//          ausente), SESSION_DIR, SESSION_KEY_FILE
//
// Deploy RedHat: ver README (systemd + nginx pra HTTPS).

import { createServer } from 'node:http';
import { readFile, writeFile, unlink, stat, mkdir, utimes } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch, makeSessions, base64ToBytes, SESSION_TTL } from './core.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // raiz do repo
const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_DIR = process.env.SESSION_DIR || join(tmpdir(), 'waze_places_sessions');
const SESSION_KEY_FILE = process.env.SESSION_KEY_FILE || join(tmpdir(), 'waze_places.key');

// ── Chave de criptografia ────────────────────────────────────────────────
// Prioridade: env ENCRYPTION_KEY > arquivo > auto-gera (conveniência dev/VM).
function loadOrCreateKey() {
  if (process.env.ENCRYPTION_KEY) return base64ToBytes(process.env.ENCRYPTION_KEY.trim());
  if (existsSync(SESSION_KEY_FILE)) return base64ToBytes(readFileSync(SESSION_KEY_FILE, 'utf8').trim());
  const key = randomBytes(32);
  writeFileSync(SESSION_KEY_FILE, key.toString('base64'), { mode: 0o600 });
  return new Uint8Array(key);
}
const keyBytes = loadOrCreateKey();

// ── Store de sessão em filesystem (TTL por mtime, touch a cada uso) ────────
const fsStore = {
  async get(hash) {
    const f = join(SESSION_DIR, 'sess_' + hash);
    try {
      const st = await stat(f);
      if (Date.now() / 1000 - st.mtimeMs / 1000 > SESSION_TTL) {
        await unlink(f).catch(() => {});
        return null;
      }
      const blob = await readFile(f, 'utf8');
      const now = new Date();
      await utimes(f, now, now).catch(() => {}); // touch: renova TTL em uso
      return blob;
    } catch {
      return null;
    }
  },
  async put(hash, blob) {
    await mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
    await writeFile(join(SESSION_DIR, 'sess_' + hash), blob, { mode: 0o600 });
  },
  async delete(hash) {
    await unlink(join(SESSION_DIR, 'sess_' + hash)).catch(() => {});
  },
};
const sessions = makeSessions({ store: fsStore, keyBytes });

// ── Estáticos ──────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};
// no-cache pra código (SW controla versão); cache longo pra imagens/fontes
const noCache = new Set(['.js', '.mjs', '.css', '.json', '.html', '.webmanifest']);

// Pastas/arquivos que NÃO devem ser servidos como estático
const BLOCKED = ['/server/', '/functions/', '/docs/', '/node_modules/', '/.git/'];

async function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  if (BLOCKED.some((b) => ('/' + safe).includes(b)) || safe.includes('..')) {
    return serveIndexFallback(res);
  }
  const file = join(ROOT, safe);
  try {
    const buf = await readFile(file);
    const ext = extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (file.endsWith('service-worker.js')) headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    else if (noCache.has(ext)) headers['Cache-Control'] = 'no-cache, must-revalidate';
    else headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    headers['X-Content-Type-Options'] = 'nosniff';
    res.writeHead(200, headers);
    res.end(buf);
  } catch {
    serveIndexFallback(res);
  }
}

async function serveIndexFallback(res) {
  try {
    const buf = await readFile(join(ROOT, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5_000_000) req.destroy(); // guarda contra body gigante
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

const server = createServer(async (req, res) => {
  const url = req.url || '/';

  if (url.startsWith('/api/')) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Método não permitido' }));
      return;
    }
    const route = url.slice(5).split('?')[0];
    let data = {};
    try {
      data = JSON.parse(await readBody(req)) || {};
    } catch {
      data = {};
    }
    const { status, body } = await dispatch(route, data, { sessions });
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }
  await serveStatic(res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Waze Places rodando em http://${HOST}:${PORT}`);
  console.log(`Sessões: ${SESSION_DIR}`);
});
