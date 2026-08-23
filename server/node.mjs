// Adaptador VM (RedHat/Node) — servidor HTTP puro, sem dependências npm.
//
// Serve os arquivos estáticos do frontend e roteia POST /api/* pro core,
// usando o filesystem pra sessões (espelha o modelo /tmp do PHP antigo).
// Mesma server/core.mjs que roda no Cloudflare — zero divergência de lógica.
//
// Rodar:   node server/node.mjs   (Node 22 ou mais novo)
// Env:     PORT (8080), HOST (0.0.0.0), ENCRYPTION_KEY (base64; auto-gera se
//          ausente), SESSION_DIR, SESSION_KEY_FILE
//
// Deploy RedHat: ver README (systemd + Apache/nginx pra HTTPS).

// ── PISO: Node 22 ───────────────────────────────────────────────────────────
// Recusa AQUI, e não lá na frente com um erro críptico. Numa VM o `nodejs` da
// distro costuma vir mais antigo, e o sintoma de rodar abaixo do piso seria um
// `ReferenceError` no meio de um pedido — difícil de ligar à causa por quem só
// quer subir a app. O `engines` do package.json avisa quem usa npm; isto avisa
// quem roda `node server/node.mjs` direto, que é como o README manda.
const MIN_NODE = 22;
const versaoAtual = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(versaoAtual) || versaoAtual < MIN_NODE) {
  console.error(`Waze Places precisa de Node ${MIN_NODE} ou mais novo — este é o ${process.versions.node}.`);
  console.error('Veja a seção de instalação no README.');
  process.exit(1);
}

import { createServer } from 'node:http';
import { readFile, writeFile, unlink, stat, mkdir, utimes, readdir } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch, makeSessions, makeCrachas, base64ToBytes, SESSION_TTL } from './core.mjs';
import { listaDePares, limpar, MAX_BODY } from './presenca.mjs';
import { aceitarWebSocket } from './ws.mjs';

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
const crachas = makeCrachas({ keyBytes });
// TURN é opcional: sem ele a conversa fica só com STUN, que resolve a maioria
// das redes. Com coturn na própria VM, `TURN_SECRET` é o mesmo
// `static-auth-secret` do coturn.
const turn = {
  keyId: process.env.TURN_KEY_ID || '',
  apiToken: process.env.TURN_API_TOKEN || '',
  urls: process.env.TURN_URLS || '',
  segredo: process.env.TURN_SECRET || '',
};

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

        // Pareamento vale 5 MINUTOS, não 21 dias, e é reconhecível pelo NOME
        // (`sess_pair_…`). Antes a varredura tentava distinguir pelo carimbo do
        // VALOR, e isso apagava toda sessão válida: no pareamento o carimbo é a
        // EXPIRAÇÃO (futuro), na sessão é o ÚLTIMO USO (sempre passado), então
        // "carimbo < agora" dava vencido pra tudo. Medido antes do conserto: a
        // sessão sumia no primeiro boot.
        if (name.startsWith('sess_pair_')) {
          const corte = /^(\d+)\|/.exec(await readFile(f, 'utf8').catch(() => ''));
          if (!corte || Number(corte[1]) * 1000 < now) await unlink(f).catch(() => {});
          continue;
        }

        // Sessão: quem manda é o mtime, que o `.get` renova a cada uso.
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
  // Fonte Inter auto-hospedada. MIME errado aqui = browser recusa a fonte.
  '.woff2': 'font/woff2',
};
// no-cache pra código (SW controla versão); cache longo pra imagens/fontes
const noCache = new Set(['.js', '.mjs', '.css', '.json', '.html', '.webmanifest']);

// Headers de segurança, em PARIDADE com o _headers do Cloudflare.
//
// A CSP entra aqui, e não entrava. O `_headers` é arquivo de Cloudflare — o
// Node nunca o leu —, então na VM a única política ativa era o `<meta>` do
// index.html. Rodar na VM era rodar com uma camada a menos, sem nada avisando.
//
// Isso importa além do detalhe de segurança: a app precisa ser a MESMA nos dois
// destinos, senão "levar pra uma VM" deixa de ser uma decisão de infraestrutura
// e vira uma mudança de comportamento. `test/layout.test.mjs` compara as TRÊS
// cópias (meta, _headers e esta) diretiva por diretiva, e `test/csp-vm.test.mjs`
// sobe o servidor e confere que o cabeçalho SAI de verdade — string igual num
// arquivo não prova resposta HTTP.
//
// Divergência de CSP não dá erro: o browser aplica a INTERSEÇÃO, então o efeito
// é alguma coisa parar de carregar em produção, calada (gotcha #14).
const CSP = "default-src 'self'; script-src 'self' 'sha256-pheT8R9zuy7UG1vwGSFJUN70Be6pv23ool5Rw4ohJWg=' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https://venue-image.waze.com https://social-row.waze.com https://www.waze.com; connect-src 'self' https://venue-image.waze.com https://social-row.waze.com https://cloudflareinsights.com; worker-src 'self' blob:; base-uri 'self'; form-action 'self'; object-src 'none';";
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  // HSTS estava SÓ no `_headers`, ou seja só no Cloudflare — mesma lacuna que a
  // CSP tinha (gotcha #14) e que foi fechada, só que esta ficou pra trás. Numa
  // VM o cabeçalho sumia e ninguém via: a app deixava de ser a MESMA nos dois
  // destinos, e "levar pra uma VM" virava mudança de comportamento em vez de
  // decisão de infraestrutura.
  // Mandar sempre é seguro: o navegador IGNORA HSTS em conexão não-HTTPS, então
  // em `localhost` ele não faz nada; atrás de TLS (proxy reverso ou certificado
  // no próprio Node) ele vale. O contrário — só mandar sob HTTPS — daria um
  // cabeçalho que depende de como o servidor foi posto no ar, que é justamente
  // o tipo de divergência que este bloco existe pra impedir.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': CSP,
};

// ALLOWLIST de estáticos: só o frontend conhecido é servido do disco. Qualquer
// outra coisa (wrangler.jsonc, CLAUDE.md, README.md, package.json, _headers,
// dotfiles, server/, docs/, worker/…) nunca é lida. Mais seguro que a blocklist
// antiga, que servia com 200 os arquivos da raiz não listados.
const ALLOWED_DIRS = ['/css/', '/js/', '/icons/', '/fonts/'];
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
    // O corte é por CAMINHO onde o `_headers` corta por caminho, não só por
    // extensão. Os ícones são o caso que divergia: `.svg` não está no `noCache`,
    // então caíam no `immutable` de um ANO — mas o NOME deles é fixo
    // (`icon-512.svg`), diferente da fonte, cujo nome mudaria junto com o
    // conteúdo. Trocar um ícone deixaria todo mundo com o antigo por um ano.
    // Isso passa despercebido enquanto o Cloudflare serve os estáticos (o
    // `_headers` manda), e passa a valer no dia em que a origem vira a VM —
    // que é exatamente quando ninguém está olhando pra isso.
    if (file.endsWith('service-worker.js')) headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    else if (noCache.has(ext)) headers['Cache-Control'] = 'no-cache, must-revalidate';
    else if (safe.startsWith('/icons/')) headers['Cache-Control'] = 'public, max-age=86400';
    else headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    // ETag + 304. `no-cache` manda REVALIDAR, não rebaixar: sem ETag o
    // navegador não tem o que perguntar e a revalidação vira download inteiro.
    // O Cloudflare já fazia isto sozinho (medido em produção); a VM não fazia,
    // então lá cada carregamento custava a app inteira. Hash do conteúdo, não
    // mtime: `git checkout` mexe no mtime sem mudar um byte, e aí o editor
    // rebaixaria tudo por causa de um deploy que não mudou nada.
    const etag = '"' + createHash('sha256').update(buf).digest('base64url').slice(0, 22) + '"';
    headers.ETag = etag;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
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
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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
      const { status, body } = await dispatch(route, data, { sessions, crachas, turn });
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: false, error: 'Erro interno' }));
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro interno');
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Sala de presença — a paridade com o Durable Object da Cloudflare
// ─────────────────────────────────────────────────────────────────────────
//
// Lá cada fila é um Durable Object (um objeto por sala, distribuído). Aqui é
// UM processo: as salas são um Map em memória. O que os dois têm que fazer
// IGUAL — conferir o crachá, montar a lista, repassar o sinal opaco — mora em
// `server/presenca.mjs`, e é o que o teste cobra dos dois arquivos.
//
// A presença é a CONEXÃO: nada em disco, nada com prazo. Socket fechou, saiu.
const salas = new Map();   // nome da sala -> Set de conexões

const TETO_SINAIS = 120;
const JANELA_MS = 60_000;

// Fecha as conexões que já estavam na sala com a MESMA identidade.
function despejarOutrasConexoes(conn) {
  const eu = String(conn.ident.nome || '').trim().toLowerCase() || conn.ident.peer;
  for (const outro of salas.get(conn.sala) || []) {
    if (outro === conn || !outro.ident) continue;
    const dele = String(outro.ident.nome || '').trim().toLowerCase() || outro.ident.peer;
    if (dele !== eu) continue;
    // 1000 = fechamento normal: é a conexão anterior da mesma pessoa saindo.
    try { outro.ws.fechar(1000, 'reentrou'); } catch { /* já morrendo */ }
  }
}

// A lista atual, só pra UMA conexão. O `difundirLista` manda pra todos; este
// atende quem pediu ressincronia.
function enviarListaPara(conn) {
  const conjunto = salas.get(conn.sala);
  if (!conjunto || !conn.ident) return;
  const presentes = [...conjunto].filter((c) => c.ident);
  const lista = listaDePares(presentes.map((p) => p.ident), conn.ident);
  try { conn.ws.enviar(JSON.stringify({ t: 'lista', ...lista })); } catch { /* socket morrendo */ }
}

function difundirLista(sala) {
  const conjunto = salas.get(sala);
  if (!conjunto) return;
  const presentes = [...conjunto].filter((c) => c.ident);
  for (const c of presentes) {
    // O ident INTEIRO, não só o peer: quem é "a mesma pessoa" é o NOME.
    const lista = listaDePares(presentes.map((p) => p.ident), c.ident);
    c.ws.enviar(JSON.stringify({ t: 'lista', ...lista }));
  }
}

function sairDaSala(conn) {
  const conjunto = salas.get(conn.sala);
  if (!conjunto) return;
  conjunto.delete(conn);
  if (!conjunto.size) salas.delete(conn.sala);
  else difundirLista(conn.sala);
}

async function tratarMensagemDaSala(conn, texto) {
  // Keepalive. Na Cloudflare quem responde é o RUNTIME
  // (`setWebSocketAutoResponse`), sem acordar o Durable Object; aqui responde
  // o processo, que já está de pé. Os dois falam o mesmo par 'ping'/'pong'
  // porque é o cliente que precisa não saber em qual servidor está.
  if (texto === 'ping') return conn.ws.enviar('pong');

  // Frame gigante já foi barrado pelo codec (`MAX_BODY`); aqui só o parse.
  let m;
  try { m = JSON.parse(texto); } catch { return; }
  if (!m || typeof m !== 'object') return;

  if (m.t === 'entrar') {
    const cracha = await crachas.conferir(m.cracha);
    if (!cracha) return conn.ws.fechar(4003, 'cracha invalido');
    // Crachá é assinado PARA uma sala: sem esta linha um crachá legítimo do
    // Brasil entraria na sala de Portugal, com assinatura válida.
    if (cracha.sala !== conn.sala) return conn.ws.fechar(4004, 'outra sala');
    conn.ident = {
      peer: cracha.peer, nome: cracha.nome, rank: cracha.rank,
      am: !!cracha.am, staff: !!cracha.staff,
      // Desempata duas conexões da MESMA pessoa: a lista mostra a mais recente.
      desde: Date.now(),
    };
    // UMA presença por pessoa — mesma regra do adaptador da Cloudflare, e pelo
    // mesmo motivo: recarregar sorteia um `peer` novo e o socket antigo demora
    // a fechar, então a pessoa ficava repetida na sala. Ver o comentário longo
    // em worker/sala-do.mjs.
    despejarOutrasConexoes(conn);
    conn.ws.enviar(JSON.stringify({ t: 'eu', peer: conn.ident.peer }));
    difundirLista(conn.sala);
    return;
  }

  // Socket anônimo não vê a lista nem fala com ninguém.
  if (!conn.ident) return conn.ws.fechar(4001, 'sem cracha');

  if (m.t === 'sair') return conn.ws.fechar(1000, 'saiu');

  // "Me manda a lista de novo."
  //
  // A sala só DIFUNDE quando alguém entra ou sai. Se a conexão do editor piscar
  // exatamente nesse instante, a mensagem se perde e NINGUÉM reenvia — a lista
  // dele fica errada até a página ser recarregada. Era isto que o owner via:
  // "muitas vezes o App só mostra que tem alguém online quando atualizo".
  //
  // MEDIDO: com a rede engolindo os pacotes por 20s e voltando, o socket
  // continua vivo (nada quebrou) e a lista fica vazia pra sempre.
  //
  // Só pra quem pediu: reenviar pra sala inteira faria o pedido de um custar
  // uma mensagem por editor presente.
  if (m.t === 'lista') return enviarListaPara(conn);
  if (m.t !== 'sinal') return;

  const agora = Date.now();
  if (agora - conn.desde > JANELA_MS) { conn.desde = agora; conn.n = 0; }
  if (++conn.n > TETO_SINAIS) return;

  const para = limpar(m.para);
  if (!para || para === conn.ident.peer) return;
  const destinos = [...(salas.get(conn.sala) || [])].filter((c) => c.ident && c.ident.peer === para);
  if (!destinos.length) {
    conn.ws.enviar(JSON.stringify({ t: 'ausente', peer: para }));
    return;
  }
  // `tipo` e `payload` passam OPACOS: são SDP e candidato ICE. O texto da
  // conversa nem chega aqui — vai cifrado pelo DataChannel.
  const fora = JSON.stringify({
    t: 'sinal', de: conn.ident.peer, nome: conn.ident.nome,
    tipo: String(m.tipo || '').slice(0, 24), payload: m.payload ?? null,
  });
  for (const d of destinos) d.ws.enviar(fora);
}

server.on('upgrade', (req, socket) => {
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { socket.destroy(); return; }
  if (url.pathname !== '/sala') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }

  const sala = limpar(url.searchParams.get('s'));
  if (!sala) { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }

  const ws = aceitarWebSocket(req, socket, MAX_BODY);
  if (!ws) return;

  const conn = { ws, sala, ident: null, desde: Date.now(), n: 0 };
  if (!salas.has(sala)) salas.set(sala, new Set());
  salas.get(sala).add(conn);

  ws.on('mensagem', (texto) => {
    tratarMensagemDaSala(conn, texto).catch(() => ws.fechar(1011, 'erro'));
  });
  ws.on('fim', () => sairDaSala(conn));
});

server.listen(PORT, HOST, () => {
  console.log(`Waze Places rodando em http://${HOST}:${PORT}`);
  console.log(`Sessões: ${SESSION_DIR}`);
});
