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
// Deploy RedHat: ver README (systemd + Apache/nginx pra HTTPS).

import { createServer } from 'node:http';
import { readFile, writeFile, unlink, stat, mkdir, utimes, readdir } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch, makeSessions, base64ToBytes, SESSION_TTL } from './core.mjs';

// Rede de segurança pra VM: um erro não capturado não pode derrubar o processo.
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));

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
  try {
    // 'wx' = criação exclusiva: se outro processo gravou a chave nesse meio-tempo,
    // lança EEXIST em vez de sobrescrever (evita race não-atômica no boot).
    writeFileSync(SESSION_KEY_FILE, key.toString('base64'), { flag: 'wx', mode: 0o600 });
    return new Uint8Array(key);
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      return base64ToBytes(readFileSync(SESSION_KEY_FILE, 'utf8').trim());
    }
    throw e;
  }
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

// ── GC de sessões órfãs ─────────────────────────────────────────────────────
// O fsStore só apaga uma sessão quando ela é reacessada (mtime no .get). Quem
// nunca mais volta deixa o blob no disco pra sempre → cresce sem limite. Varre
// o SESSION_DIR periodicamente e remove arquivos com idade > SESSION_TTL.
const GC_INTERVAL_MS = 60 * 60 * 1000; // 1h
async function gcSessions() {
  try {
    const files = await readdir(SESSION_DIR);
    const now = Date.now();
    for (const name of files) {
      if (!name.startsWith('sess_')) continue;
      const f = join(SESSION_DIR, name);
      try {
        const st = await stat(f);
        if (now - st.mtimeMs > SESSION_TTL * 1000) await unlink(f).catch(() => {});
      } catch {
        // arquivo sumiu no meio da varredura — ignora
      }
    }
  } catch {
    // SESSION_DIR ainda não existe ou erro de FS — nunca pode quebrar o processo
  }
}
gcSessions(); // varredura no boot
setInterval(gcSessions, GC_INTERVAL_MS).unref(); // não segura o event loop

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

// Headers de segurança (paridade com o _headers do Cloudflare). A CSP NÃO entra
// aqui — vive no <meta> do index.html + no _headers, gerida à parte.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

// ALLOWLIST de estáticos: só o frontend conhecido é servido do disco. Qualquer
// outra coisa (wrangler.jsonc, CLAUDE.md, README.md, package.json, _headers,
// dotfiles, server/, docs/, worker/…) nunca é lida. Mais seguro que a blocklist
// antiga, que servia com 200 os arquivos da raiz não listados.
const ALLOWED_DIRS = ['/css/', '/js/', '/icons/'];
const ALLOWED_ROOT_FILES = new Set([
  '/index.html',
  '/manifest.json',
  '/service-worker.js',
  '/favicon.ico',
  '/favicon.svg',
]);
function isAllowedAsset(path) {
  if (ALLOWED_ROOT_FILES.has(path)) return true;
  return ALLOWED_DIRS.some((d) => path.startsWith(d));
}

async function serveStatic(req, res, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    // URI malformada (ex.: GET '/%') — decodeURIComponent lança URIError.
    // Responde 400 sem derrubar o processo.
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Bad request');
    return;
  }

  const accept = req.headers['accept'] || '';
  const isRoot = rel === '/' || rel === '';
  // Navegação = raiz ou request que aceita HTML → serve o shell da SPA no miss.
  const isNavigation = isRoot || accept.includes('text/html');
  if (isRoot) rel = '/index.html';

  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');

  // Path traversal + allowlist: fora do frontend conhecido → 404 (ou SPA se navegação).
  if (safe.includes('..') || !isAllowedAsset(safe)) {
    return notFound(res, isNavigation);
  }

  const file = join(ROOT, safe);
  try {
    const buf = await readFile(file);
    const ext = extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ...SECURITY_HEADERS };
    if (file.endsWith('service-worker.js')) headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    else if (noCache.has(ext)) headers['Cache-Control'] = 'no-cache, must-revalidate';
    else headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    res.writeHead(200, headers);
    res.end(buf);
  } catch {
    // Consta na allowlist mas não existe no disco.
    return notFound(res, isNavigation);
  }
}

function notFound(res, isNavigation) {
  if (isNavigation) return serveIndexFallback(res);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
  res.end('Not found');
}

async function serveIndexFallback(res) {
  try {
    const buf = await readFile(join(ROOT, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not found');
  }
}

const MAX_BODY_BYTES = 5_000_000;
function readBody(req, res) {
  return new Promise((resolve) => {
    let data = '';
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;
      data += c;
      if (data.length > MAX_BODY_BYTES) {
        tooLarge = true;
        // Responde 413 limpo antes de cortar a conexão (em vez de só req.destroy()).
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Corpo da requisição muito grande' }));
        }
        req.destroy();
        resolve(null); // sinaliza pro chamador que a resposta já foi enviada
      }
    });
    req.on('end', () => { if (!tooLarge) resolve(data); });
    req.on('error', () => { if (!tooLarge) resolve(''); });
  });
}

const server = createServer(async (req, res) => {
  const url = req.url || '/';
  try {
    if (url.startsWith('/api/')) {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Método não permitido' }));
        return;
      }
      const route = url.slice(5).split('?')[0];
      const raw = await readBody(req, res);
      if (raw === null) return; // body grande demais → 413 já respondido
      let data = {};
      try {
        data = JSON.parse(raw) || {};
      } catch {
        data = {};
      }
      const { status, body } = await dispatch(route, data, { sessions });
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }
    await serveStatic(req, res, url);
  } catch (err) {
    // Handler async sem try/catch derrubava a request (e podia escalar).
    // Responde 500 limpo: JSON pra /api/*, texto pros estáticos.
    console.error('Erro no handler de request:', err);
    if (res.headersSent) {
      res.end();
      return;
    }
    if (url.startsWith('/api/')) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Erro interno' }));
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro interno');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Waze Places rodando em http://${HOST}:${PORT}`);
  console.log(`Sessões: ${SESSION_DIR}`);
});
