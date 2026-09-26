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
// quer subir o app. O `engines` do package.json avisa quem usa npm; isto avisa
// quem roda `node server/node.mjs` direto, que é como o README manda.
const MIN_NODE = 22;
const versaoAtual = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(versaoAtual) || versaoAtual < MIN_NODE) {
  console.error(`Waze Places precisa de Node ${MIN_NODE} ou mais novo — este é o ${process.versions.node}.`);
  console.error('Veja a seção de instalação no README.');
  process.exit(1);
}

import { createServer } from 'node:http';
import { readFile, writeFile, unlink, stat, mkdir, utimes, readdir, rename } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch, makeSessions, base64ToBytes, SESSION_TTL, PAIR_TTL, RELEITURA_TTL_STORE } from './core.mjs';
import { readBody } from './corpo.mjs';

// Rede de segurança pra VM: um erro não capturado não pode derrubar o processo.
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // raiz do repo
// PORT=0 é "qualquer porta livre" (os testes pedem assim), e não "sem porta":
// o `parseInt(…) || 8080` o trocava por 8080, e duas VMs de teste brigavam por ela.
const PORT = /^\d+$/.test(process.env.PORT || '') ? Number(process.env.PORT) : 8080;
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
  // ATÔMICO: grava num arquivo temporário e troca pelo nome certo. Um processo
  // derrubado NO MEIO da escrita deixava a sessão truncada — que não decifra, é
  // apagada (`descartar`) e desloga a pessoa (auditoria de 2026-09-25). O
  // `rename` no mesmo diretório troca o arquivo inteiro de uma vez.
  async put(hash, blob, ttl) {
    await mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
    const final = join(SESSION_DIR, 'sess_' + hash);
    const temp = join(SESSION_DIR, '.tmp_' + hash + '_' + process.pid + '_' + randomBytes(4).toString('hex'));
    await writeFile(temp, blob, { mode: 0o600 });
    try {
      await rename(temp, final);
    } catch (e) {
      await unlink(temp).catch(() => {});
      throw e;
    }
    if (Number(ttl) > 0 && Number(ttl) <= PRAZO_CURTO_MAX_S) apagarNoPrazo(final, Date.now() + Number(ttl) * 1000);
    else prazosCurtos.delete(final);
  },
  async delete(hash) {
    const f = join(SESSION_DIR, 'sess_' + hash);
    prazosCurtos.delete(f);
    await unlink(f).catch(() => {});
  },
};

// ── O prazo CURTO que o core pede no `put` ──────────────────────────────────
// O KV do Cloudflare cumpre sozinho o prazo de cada gravação; este adaptador
// de arquivo não tem nada parecido. Pra sessão (21 dias) quem cumpre é a
// varredura de hora em hora, logo abaixo. Pro que vale MINUTOS — a lista de
// fotos que o excluir-foto relê (1 min) e o pareamento (5 min) — a hora da
// varredura ERA o prazo: a Ajuda promete que a lista de fotos da lixeira fica
// no servidor por até 1 minuto, e aqui ela ficava até ~70 (auditoria de
// 2026-09-26). Daí um relógio por gravação.
//
// O relógio confere o prazo REGISTRADO ao disparar, e não o mtime do arquivo:
// o `get` renova o mtime (é a janela deslizante da sessão), e uma gravação
// mais nova na mesma chave empurra o prazo — o relógio da anterior não pode
// apagá-la antes da hora.
const PRAZO_CURTO_MAX_S = 60 * 60;
const prazosCurtos = new Map(); // arquivo → instante (ms) a partir do qual ele sai
function apagarNoPrazo(arquivo, ateMs) {
  prazosCurtos.set(arquivo, ateMs);
  setTimeout(() => {
    const prazo = prazosCurtos.get(arquivo);
    if (prazo === undefined || prazo > Date.now()) return;
    prazosCurtos.delete(arquivo);
    unlink(arquivo).catch(() => {});
  }, Math.max(0, ateMs - Date.now()) + 50).unref();
}
const sessions = makeSessions({ store: fsStore, keyBytes });

// ── GC de sessões órfãs ─────────────────────────────────────────────────────
// O fsStore só apaga uma sessão quando ela é reacessada (mtime no .get). Quem
// nunca mais volta deixa o blob no disco pra sempre → cresce sem limite. Varre
// o SESSION_DIR periodicamente e remove arquivos com idade > SESSION_TTL.
const GC_INTERVAL_MS = 60 * 60 * 1000; // 1h
const TEMP_GC_MS = 10 * 60 * 1000;      // temporário de gravação: nenhuma dura 10 min
async function gcSessions() {
  try {
    const files = await readdir(SESSION_DIR);
    const now = Date.now();
    for (const name of files) {
      // Temporário da gravação atômica que ficou pra trás (o processo caiu entre
      // o `writeFile` e o `rename`): ninguém o lê, e sai com folga.
      if (name.startsWith('.tmp_')) {
        const t = join(SESSION_DIR, name);
        const st = await stat(t).catch(() => null);
        if (st && now - st.mtimeMs > TEMP_GC_MS) await unlink(t).catch(() => {});
        continue;
      }
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
        //
        // O que ainda não venceu ganha o relógio do prazo curto (ver
        // `apagarNoPrazo`): o da gravação morreu com o processo anterior, e
        // sem isto o que sobra de um reinício esperaria a próxima varredura.
        if (name.startsWith('sess_pair_')) {
          const corte = /^(\d+)\|/.exec(await readFile(f, 'utf8').catch(() => ''));
          const ateMs = corte ? Number(corte[1]) * 1000 : 0;
          if (ateMs < now || ateMs - now > PAIR_TTL * 1000) await unlink(f).catch(() => {});
          else if (!prazosCurtos.has(f)) apagarNoPrazo(f, ateMs);
          continue;
        }

        // A lista de fotos que o excluir-foto relê (`reler_…`): o carimbo do
        // valor é a hora da LEITURA no Waze, e ela sai RELEITURA_TTL_STORE
        // depois dele — o mesmo minuto que o KV cumpre no Cloudflare e que a
        // Ajuda promete. O carimbo, e não o mtime: o `get` renova o mtime.
        if (name.startsWith('sess_reler_')) {
          const corte = /^(\d+)\|/.exec(await readFile(f, 'utf8').catch(() => ''));
          const ateMs = corte ? (Number(corte[1]) + RELEITURA_TTL_STORE) * 1000 : 0;
          if (ateMs <= now || ateMs - now > RELEITURA_TTL_STORE * 1000) await unlink(f).catch(() => {});
          else if (!prazosCurtos.has(f)) apagarNoPrazo(f, ateMs);
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
  // As capturas do prompt de instalação (`icons/screenshots/*.jpg`) e a
  // licença da fonte saíam como `application/octet-stream` — e com `nosniff`,
  // que proíbe o navegador de adivinhar. O Cloudflare manda estes (MEDIDO no
  // `wrangler dev`, auditoria de 2026-09-26).
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
};
// Sem extensão, só o `LICENSE` é servido. O Cloudflare o manda SEM
// Content-Type, e o navegador o mostra como texto; aqui vai o tipo dito, que dá
// na mesma tela — `octet-stream` com `nosniff` virava download.
const MIME_SEM_EXTENSAO = { '/LICENSE': 'text/plain; charset=utf-8' };
// no-cache pra código (SW controla versão); cache longo pra imagens/fontes
const noCache = new Set(['.js', '.mjs', '.css', '.json', '.html', '.webmanifest']);

// Headers de segurança, em PARIDADE com o _headers do Cloudflare.
//
// A CSP entra aqui, e não entrava. O `_headers` é arquivo de Cloudflare — o
// Node nunca o leu —, então na VM a única política ativa era o `<meta>` do
// index.html. Rodar na VM era rodar com uma camada a menos, sem nada avisando.
//
// Isso importa além do detalhe de segurança: o app precisa ser o MESMO nos dois
// destinos, senão "levar pra uma VM" deixa de ser uma decisão de infraestrutura
// e vira uma mudança de comportamento. `test/layout.test.mjs` compara as TRÊS
// cópias (meta, _headers e esta) diretiva por diretiva, e `test/csp-vm.test.mjs`
// sobe o servidor e confere que o cabeçalho SAI de verdade — string igual num
// arquivo não prova resposta HTTP.
//
// Divergência de CSP não dá erro: o browser aplica a INTERSEÇÃO, então o efeito
// é alguma coisa parar de carregar em produção, calada (gotcha #14).
//
// `img-src blob:` é do Resumo do mês: a imagem é gerada no canvas e mostrada
// por object URL. Sem isto ela chega QUEBRADA e nada avisa — foi assim que o
// smoke a viu na primeira rodada (0×0). `test/resumo.test.mjs` trava nas três.
//
// `img-src https://*.waze.com` é CURINGA de propósito (v2026.09.14-03). A lista
// nominal (venue-image, social-row, sms-profile-image, www) já custou um defeito
// em produção: o Waze moveu a foto de perfil pra um host novo e o navegador a
// bloqueou ANTES da rede, sem sinal nenhum do nosso lado. A próxima mudança
// pode ser no `venue-image`, e aí some a foto do CARD, que é o produto do app.
// Curinga em IMAGEM é risco baixo — imagem não executa. O `connect-src` segue
// NOMINAL: lá o risco é de SAÍDA de dado, e é outra conversa.
//
// `connect-src https://instantmessaging-pa.googleapis.com` é o tempo real do
// chat do WME (fase 3 da presença): o navegador abre o fluxo DIRETO lá, com o
// token que o `presenca-app` devolve. Sem o host, a mensagem nova não chega —
// barrada antes da rede, sem erro na tela.
const CSP = "default-src 'self'; script-src 'self' 'sha256-quzrIZ27j7FNwTF7T/940jV0pWHxlsSbeQmnlqM5RhE=' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https://*.waze.com; connect-src 'self' https://www.waze.com https://venue-image.waze.com https://social-row.waze.com https://cloudflareinsights.com https://instantmessaging-pa.googleapis.com; worker-src 'self' blob:; base-uri 'self'; form-action 'self'; object-src 'none';";
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
  // HSTS estava SÓ no `_headers`, ou seja só no Cloudflare — mesma lacuna que a
  // CSP tinha (gotcha #14) e que foi fechada, só que esta ficou pra trás. Numa
  // VM o cabeçalho sumia e ninguém via: o app deixava de ser o MESMO nos dois
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
//
// A extensão do Chrome e a licença do projeto são PUBLICADAS no Cloudflare (o
// `test/vm-estaticos.test.mjs` as declara frontend: distribuição), e davam 404
// aqui — o mesmo app com duas respostas (gotcha #14; auditoria de 2026-09-26).
const ALLOWED_DIRS = ['/css/', '/js/', '/icons/', '/fonts/', '/extensao-chrome/'];
const ALLOWED_ROOT_FILES = new Set([
  // `/index.html` é o GERADO (minificado, `npm run html`) — é ele que a raiz
  // serve, aqui e no Cloudflare. O FONTE comentado é o `/index.src.html` e NÃO
  // está nesta lista de propósito: listá-lo abriria um segundo caminho pro
  // arquivo de 178 KB com os comentários de decisão — duas URLs, dois
  // conteúdos, 67 KB de diferença. O `.assetsignore` faz o mesmo no Cloudflare.
  '/index.html',
  '/manifest.json',
  '/service-worker.js',
  '/favicon.ico',
  '/favicon.svg',
  '/LICENSE',
]);
// O `.assetsignore` tira `README.md` em QUALQUER nível, e um mora dentro de um
// diretório servido: o da extensão (doc de quem desenvolve; 404 no Cloudflare,
// MEDIDO no `wrangler dev`).
const NUNCA_SERVIDOS = [/\/README\.md$/];
// Os FONTES comentados moram DENTRO de `/js/` e `/css/`, então a allowlist de
// diretório acima os deixava passar: `/js/app.js` respondia 200 com 622 KB ao
// lado dos 201 KB do `/js/min/app.js` que o app carrega, e `/css/styles.css`
// 117 KB ao lado dos 77 KB do `/css/app.css`. É a MESMA decisão já escrita pro
// `/index.src.html` logo acima — ela só não tinha sido aplicada aqui.
//
// E é o gotcha #14 outra vez: o `.assetsignore` corrige isto no Cloudflare e
// NÃO alcança a VM, que tem allowlist própria. Correção que vale num destino e
// não no outro é a divergência que faz "levar pra uma VM" deixar de ser decisão
// de infraestrutura e virar mudança de comportamento. `test/vm-estaticos.test.mjs`
// cobra os dois lados, e cobra pela RESPOSTA HTTP — não pela string no arquivo.
//
// O corte é por FORMA e não por lista de nomes: o que é servido de `/js/` é o
// que está em `/js/min/`, e de `/css/` é o `app.css`. Arquivo novo em `js/`
// nasce privado, que é o lado certo do erro.
const FONTE_DE_BUILD = [
  [/^\/js\//, /^\/js\/min\//],        // de /js/, só /js/min/
  [/^\/css\//, /^\/css\/app\.css$/],  // de /css/, só o app.css gerado
];
function isAllowedAsset(path) {
  if (ALLOWED_ROOT_FILES.has(path)) return true;
  if (!ALLOWED_DIRS.some((d) => path.startsWith(d))) return false;
  if (NUNCA_SERVIDOS.some((re) => re.test(path))) return false;
  for (const [dir, servivel] of FONTE_DE_BUILD) {
    if (dir.test(path) && !servivel.test(path)) return false;
  }
  return true;
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

  // A raiz é a do caminho NORMALIZADO: `//` e `/./` também são ela (no
  // Cloudflare, `//` redireciona pra `/` e `/./` serve o índice — medido no
  // `wrangler dev`). O smoke do pareamento abre `BASE + '/#pair='`, que é `//`.
  const isRoot = rel === '' || normalize(rel) === '/';
  // A raiz resolve pro índice do diretório, como qualquer servidor estático.
  // NÃO há mais remapeamento: o `index.html` JÁ É o minificado (o fonte é o
  // `index.src.html`), então `/` e `/index.html` servem o mesmo arquivo sem
  // ninguém desviar rota. Era o remap que o Cloudflare ignorava — ver a nota no
  // `tools/gerar-html.mjs`.
  if (isRoot) rel = '/index.html';

  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');

  // Path traversal + allowlist: fora do frontend conhecido → 404, SEMPRE.
  // Aqui havia um "shell da SPA": pedido que aceitasse HTML e não casasse com
  // arquivo nenhum recebia o index.html com 200. O Cloudflare NÃO faz isso —
  // MEDIDO no `wrangler dev` (auditoria de 2026-09-26): `/qualquer-rota` dá
  // 404 com e sem `Accept: text/html`, porque o `wrangler.jsonc` não liga o
  // `not_found_handling`. O app não tem rota além da raiz (o pareamento é
  // fragmento, `/#pair=`, e os atalhos do manifest são `/?action=`), então o
  // shell só servia pra o mesmo endereço dar 200 num destino e 404 no outro — e
  // pro service worker guardar uma página do app num caminho que não existe.
  if (safe.includes('..') || !isAllowedAsset(safe)) return notFound(res);

  const file = join(ROOT, safe);
  try {
    const buf = await readFile(file);
    const ext = extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || MIME_SEM_EXTENSAO[safe] || 'application/octet-stream', ...SECURITY_HEADERS };
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
    else if (safe.startsWith('/fonts/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    // O que o `_headers` não cobre (a licença, a extensão) leva o PADRÃO do
    // Cloudflare, MEDIDO no `wrangler dev`: `public, max-age=0, must-revalidate`.
    // O `immutable` de um ano era o do `/fonts/*` caindo em tudo que sobrava: um
    // ícone da extensão trocado ficaria um ano velho na VM.
    else headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
    // ETag + 304. `no-cache` manda REVALIDAR, não rebaixar: sem ETag o
    // navegador não tem o que perguntar e a revalidação vira download inteiro.
    // O Cloudflare já fazia isto sozinho (medido em produção); a VM não fazia,
    // então lá cada carregamento custava o app inteiro. Hash do conteúdo, não
    // mtime: `git checkout` mexe no mtime sem mudar um byte, e aí o editor
    // rebaixaria tudo por causa de um deploy que não mudou nada.
    const etag = '"' + createHash('sha256').update(buf).digest('base64url').slice(0, 22) + '"';
    headers.ETag = etag;
    // Comparação FRACA (RFC 9110 §13.1.2), que é a do If-None-Match: atrás do
    // Cloudflare — o destino da VM é ser a ORIGEM com ele na frente — a borda
    // comprime e rebaixa o ETag forte pra `W/"…"`, e é o fraco que o navegador
    // devolve. Com a igualdade estrita a VM nunca respondia 304 e cada
    // carregamento rebaixava o app inteiro, que é o que este ETag existe pra
    // evitar (auditoria de 2026-09-25). Pode vir uma LISTA, e `*` vale qualquer.
    const pedidas = String(req.headers['if-none-match'] || '').split(',').map((x) => x.trim().replace(/^W\//, ''));
    if (pedidas.includes(etag) || pedidas.includes('*')) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(buf);
  } catch {
    // Consta na allowlist mas não existe no disco.
    return notFound(res);
  }
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
  res.end('Not found');
}

// Cabeçalhos de TODA resposta de /api: `no-store` (ver o Worker) e os de
// segurança — a VM respondia a API (e o 405/500 dos estáticos) SEM eles, e o app
// deixava de ser o mesmo nos dois destinos (gotcha #14; auditoria de 2026-09-25).
const API_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS };

const server = createServer(async (req, res) => {
  const url = req.url || '/';
  // O caminho NORMALIZADO, como o Worker o vê (`new URL(request.url).pathname`):
  // `/api/./sessao` é a rota `sessao` lá e era a rota `./sessao` aqui — o mesmo
  // pedido com duas respostas (gotcha #14; auditoria de 2026-09-25). Prefixado
  // com a origem pra `//x` não virar HOST.
  let caminho;
  try { caminho = new URL('http://local' + url).pathname; } catch { caminho = url.split('?')[0]; }
  try {
    if (caminho.startsWith('/api/')) {
      if (req.method !== 'POST') {
        res.writeHead(405, API_HEADERS);
        res.end(JSON.stringify({ success: false, error: 'Método não permitido' }));
        return;
      }
      const route = caminho.slice(5);
      const raw = await readBody(req, res);
      if (raw === null) return; // body grande demais → 413 já respondido
      let data = {};
      try {
        data = JSON.parse(raw) || {};
      } catch {
        data = {};
      }
      // No Node o processo segue vivo depois da resposta: o que o handler deixa
      // correndo termina sozinho. Só não pode virar rejeição sem dono.
      const aoFundo = (p) => { Promise.resolve(p).catch(() => {}); };
      const { status, body } = await dispatch(route, data, { sessions, aoFundo });
      res.writeHead(status, API_HEADERS);
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
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
    if (caminho.startsWith('/api/')) {
      res.writeHead(500, API_HEADERS);
      res.end(JSON.stringify({ success: false, error: 'Erro interno' }));
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Erro interno');
    }
  }
});

// Porta ocupada (ou sem permissão) é FATAL. Sem isto o erro caía no
// `uncaughtException` lá de cima, que só registra, e o processo saía com
// código 0: um supervisor que reinicia "se falhar" lia a queda como sucesso.
server.on('error', (e) => {
  console.error('Waze Places não subiu:', e && e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  // A porta que o SISTEMA deu: com PORT=0 (os testes pedem uma livre), o
  // valor configurado é 0, e é esta linha que diz onde o servidor está.
  console.log(`Waze Places rodando em http://${HOST}:${server.address().port}`);
  console.log(`Sessões: ${SESSION_DIR}`);
});
