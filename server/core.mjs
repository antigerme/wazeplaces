// core.mjs — lógica compartilhada do backend do Waze Places.
//
// Não depende de plataforma: usa só `fetch` e `crypto.subtle` (Web Crypto),
// que existem tanto no Cloudflare Workers quanto no Node 18+. Toda I/O de
// plataforma (armazenamento de sessão, chave de criptografia) é injetada pelos
// adaptadores (functions/api/[[route]].js no Cloudflare, server/node.mjs na VM).
//
// Porte fiel do antigo api/config.php + os 9 endpoints PHP. Diferenças
// intencionais na migração:
//   - AES-256-CBC → AES-256-GCM (autenticado; sem dado legado a preservar)
//   - cURL + arquivo de cookie temporário → fetch com header Cookie
//   - erro 500 nunca vaza detalhe interno (dispatch devolve mensagem genérica)

// ─────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────

export const WAZE_REGIONS = {
  row: 'https://www.waze.com/row-Descartes/app/v1',
  na: 'https://www.waze.com/na-Descartes/app/v1',
  il: 'https://www.waze.com/il-Descartes/app/v1',
  world: 'https://www.waze.com/Descartes/app/v1',
};

const WAZE_BASE_REGIONS = {
  row: 'https://www.waze.com/row-Descartes/app',
  na: 'https://www.waze.com/na-Descartes/app',
  il: 'https://www.waze.com/il-Descartes/app',
  world: 'https://www.waze.com/Descartes/app',
};

const WAZE_FEATURES_REGIONS = {
  row: 'https://www.waze.com/row-Descartes/app/Features?ignoreWarnings=false&language=pt-BR',
  na: 'https://www.waze.com/na-Descartes/app/Features?ignoreWarnings=false&language=pt-BR',
  il: 'https://www.waze.com/il-Descartes/app/Features?ignoreWarnings=false&language=pt-BR',
  world: 'https://www.waze.com/Descartes/app/Features?ignoreWarnings=false&language=pt-BR',
};

const WAZE_IMAGE_BASE = 'https://venue-image.waze.com/thumbs/thumb700_';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

export const SESSION_TTL = 1814400; // 21 dias (cookies do Waze duram ~28d)
const MIN_RANK_WAZE = 2; // display L3+ (Waze é 0-indexed)

const wazeIssuesEndpoint = (r) => (WAZE_REGIONS[r] || WAZE_REGIONS.row) + '/Issues/Search/List';
const wazeMarkReadEndpoint = (r) => (WAZE_REGIONS[r] || WAZE_REGIONS.row) + '/Issues/Read';
const wazeFeaturesEndpoint = (r) => WAZE_FEATURES_REGIONS[r] || WAZE_FEATURES_REGIONS.row;
// Endereço oficial do WME, sem segmento de idioma (decisão do owner: sempre a
// URL canônica; o Waze redireciona conforme o idioma de quem abre, se quiser).
const WME_EDITOR_URL = 'https://www.waze.com/editor';

const wazeSessionEndpoint = (r) => (WAZE_BASE_REGIONS[r] || WAZE_BASE_REGIONS.row) + '/Session?language=pt-BR';
const wazeCountriesEndpoint = (r) => (WAZE_BASE_REGIONS[r] || WAZE_BASE_REGIONS.row) + '/LocationSearch/Countries';
const wazeStatesEndpoint = (r, countryId) => (WAZE_BASE_REGIONS[r] || WAZE_BASE_REGIONS.row) + '/LocationSearch/States?countryId=' + (parseInt(countryId, 10) || 0);
const wazeRefererEnv = (r) => (r === 'na' ? 'usa' : r === 'il' ? 'il' : 'row');

// ─────────────────────────────────────────────────────────────────────────
// Erro de API — equivalente ao `jsonError(...); exit;` do PHP.
// Handlers/helpers lançam; o dispatch captura e serializa.
// ─────────────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(body, status = 400) {
    super(body && body.error ? body.error : 'erro');
    this.body = body;
    this.status = status;
  }
}
// `message` fica em português de propósito: é o último recurso, para cliente
// antigo em cache que ainda não conhece a chave nova (o SW é cache-first pra
// assets, então isso acontece de verdade por alguns dias após cada deploy).
// Quem manda na tela é a CHAVE — o frontend a traduz no idioma do editor.
const apiError = (message, status = 400, key = null, vars = null) => {
  const body = { success: false, error: message };
  if (key) body.errorKey = key;
  if (vars) body.errorVars = vars;
  throw new ApiError(body, status);
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers base64 / bytes (btoa/atob são globais no Node 16+ e no Workers)
// ─────────────────────────────────────────────────────────────────────────

function bytesToBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToBase64(b);
}

// ─────────────────────────────────────────────────────────────────────────
// Criptografia AES-256-GCM (chave = 32 bytes crus)
// Formato do blob: base64(iv) + '::' + base64(ciphertext+tag)
// ─────────────────────────────────────────────────────────────────────────

async function encryptCookies(plaintext, keyBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return bytesToBase64(iv) + '::' + bytesToBase64(new Uint8Array(ct));
}

async function decryptCookies(blob, keyBytes) {
  try {
    const [ivB, ctB] = String(blob).split('::');
    if (!ivB || !ctB) return null;
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivB) }, key, base64ToBytes(ctB));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Cookies: extração de CSRF, validação de formato, montagem do header Cookie
// ─────────────────────────────────────────────────────────────────────────

export function extractCSRFToken(cookiesContent) {
  const m = String(cookiesContent).match(/_csrf_token=([^;\s]+)/);
  if (m) return m[1].trim();
  for (const line of String(cookiesContent).split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const parts = t.split(/\s+/);
    if (parts.length >= 7 && parts[5] === '_csrf_token') return parts[6].trim();
  }
  return null;
}

export function validateCookiesFormat(cookiesContent) {
  const s = String(cookiesContent);
  if (s.includes('_csrf_token=')) return true;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    if (t.includes('_csrf_token') && t.includes('\t')) return true;
  }
  return false;
}

// Um cookie pertence ao domínio do Waze? (coluna de domínio do formato Netscape)
export function isWazeCookieDomain(domain) {
  const d = String(domain).replace(/^\./, '').toLowerCase();
  return d === 'waze.com' || d.endsWith('.waze.com');
}

// Mantém apenas as linhas de cookies de waze.com (formato Netscape). O cookies.txt
// exportado do navegador traz cookies de TODOS os sites logados (redhat, microsoft,
// github, ifood…) — dezenas deles. Enviá-los/guardá-los seria (a) VAZAR credenciais
// de terceiros pro servidor do Waze e (b) estourar o tamanho do header `Cookie`
// (30KB+ vs ~1.7KB só do Waze) → o Waze/Cloudflare rejeita com HTTP 400. Filtramos
// na entrada pra que o store só persista cookies do Waze. Formato header (sem tabs)
// não expõe o domínio → devolve como veio (a extensão já coleta só cookies do Waze).
export function filterWazeCookies(cookiesContent) {
  const s = String(cookiesContent).trim();
  if (!s.includes('\t')) return s;
  const kept = [];
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const parts = t.split(/\s+/);
    if (parts.length >= 7 && isWazeCookieDomain(parts[0])) kept.push(t);
  }
  return kept.join('\n');
}

// Constrói o valor do header `Cookie:` a partir do conteúdo salvo.
// Aceita formato Netscape (cookies.txt, com tabs) ou header ("a=b; c=d").
export function cookieHeaderFrom(cookiesContent) {
  const s = String(cookiesContent).trim();
  if (!s.includes('\t')) {
    // já é formato header (ou uma linha só) — normaliza
    return s
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && l[0] !== '#')
      .join('; ')
      .replace(/;\s*;/g, ';')
      .replace(/;\s*$/, '');
  }
  const pairs = [];
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const parts = t.split(/\s+/);
    // Defesa em profundidade: só cookies de waze.com viram header (mesmo que algo
    // não-filtrado tenha sido armazenado). Ver filterWazeCookies acima.
    if (parts.length >= 7 && isWazeCookieDomain(parts[0])) pairs.push(parts[5] + '=' + parts[6]);
  }
  return pairs.join('; ');
}

// ─────────────────────────────────────────────────────────────────────────
// Chamada ao Waze via fetch (substitui makeCurlRequest/cURL)
// ─────────────────────────────────────────────────────────────────────────

async function callWaze(url, cookieHeader, csrfToken, postData, region) {
  const env = wazeRefererEnv(region);
  const headers = {
    Accept: '*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Content-Type': 'application/json; charset=utf-8',
    Origin: 'https://www.waze.com',
    // URL canônica do WME, sem locale. MEDIDO antes de mexer, porque este
    // arquivo avisa que header errado quebra a comunicação: 4 endpoints × 6
    // variantes de Referer (com locale, sem locale, sem query, outro locale,
    // SEM o header, e lixo) devolvem resposta byte a byte idêntica. O Waze não
    // inspeciona o Referer aqui — cravar `/pt-BR/` só documentava errado de
    // onde a chamada vinha.
    Referer: WME_EDITOR_URL + '?env=' + env + '&tab=issue_tracker',
    'X-CSRF-Token': csrfToken,
    Cookie: cookieHeader,
    'User-Agent': USER_AGENT,
    'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Linux"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
  const init = { method: postData != null ? 'POST' : 'GET', headers };
  if (postData != null) init.body = JSON.stringify(postData);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let res, response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
      // Leitura do corpo DENTRO da janela do timer — resposta lenta no body
      // também aborta nos 30s (antes o clearTimeout vinha antes do .text()).
      response = await res.text();
    } finally {
      clearTimeout(timer);
    }
    return { httpCode: res.status, response, error: '' };
  } catch (e) {
    return { httpCode: 0, response: '', error: e && e.message ? e.message : 'fetch failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Categorização de erro do Waze (porte 1:1 do PHP — ver comentário histórico)
// ─────────────────────────────────────────────────────────────────────────

export function categorizeWazeError(httpCode, responseBody, fetchError = '') {
  if (fetchError) return { category: 'transient', message: 'Erro de conexão: ' + fetchError, messageKey: 'srv.err.connection' };
  if (httpCode === 401 || httpCode === 403) return { category: 'unauthorized', message: 'Cookies expirados ou inválidos', messageKey: 'srv.err.cookiesExpired' };

  let errorCode = null;
  let errorDetails = '';
  try {
    const parsed = JSON.parse(String(responseBody));
    if (parsed && parsed.errorList && parsed.errorList[0]) {
      errorCode = parsed.errorList[0].code ?? null;
      errorDetails = String(parsed.errorList[0].details ?? '').toLowerCase();
    }
  } catch {}
  const bodyLower = String(responseBody).toLowerCase();

  if (errorCode === 702 || errorDetails.includes('was not found')) {
    return { category: 'already_processed', message: 'Já tratado por outro editor', messageKey: 'srv.err.alreadyHandled' };
  }
  if (errorCode === 300 && errorDetails.includes('failed to handle')) {
    return { category: 'already_processed', message: 'Já tratado ou modificado por outro editor', messageKey: 'srv.err.alreadyHandledOrModified' };
  }
  if (httpCode === 409) return { category: 'already_processed', message: 'Já tratado por outro editor', messageKey: 'srv.err.alreadyHandled' };
  if (httpCode === 404) return { category: 'not_found', message: 'Place não existe mais (possivelmente já tratado)', messageKey: 'srv.err.gone' };

  const hasAlreadyHint =
    bodyLower.includes('already') ||
    bodyLower.includes('duplicate') ||
    bodyLower.includes('updated by another') ||
    bodyLower.includes('no longer') ||
    bodyLower.includes('has been resolved');
  if ((httpCode === 200 || httpCode === 400 || httpCode === 422) && hasAlreadyHint) {
    return { category: 'already_processed', message: 'Já tratado por outro editor', messageKey: 'srv.err.alreadyHandled' };
  }

  if (httpCode >= 500 || httpCode === 408 || httpCode === 429 || httpCode === 0) {
    return { category: 'transient', message: `Servidor Waze indisponível (HTTP ${httpCode})`, messageKey: 'srv.err.wazeDown', messageVars: { code: httpCode } };
  }
  return { category: 'unknown', message: `Erro do Waze (HTTP ${httpCode})`, messageKey: 'srv.err.wazeUnknown', messageVars: { code: httpCode } };
}

// ─────────────────────────────────────────────────────────────────────────
// Gate de acesso (Staff OU rank>=2 & Area Manager)
// ─────────────────────────────────────────────────────────────────────────

export function isUserAllowed(profile) {
  if (!profile || typeof profile !== 'object') return { allowed: false, reason: 'Perfil inválido', reasonKey: 'srv.err.badProfile' };
  if (profile.isStaff) return { allowed: true, reason: null };
  const rank = Number.isInteger(profile.rank) ? profile.rank : (profile.rank != null ? parseInt(profile.rank, 10) : -1);
  const isAM = !!profile.isAreaManager;
  if (rank >= MIN_RANK_WAZE && isAM) return { allowed: true, reason: null };
  const displayRank = rank >= 0 ? rank + 1 : '?';
  const tags = ['L' + displayRank, isAM ? 'AM' : 'não-AM'];
  const minDisplay = MIN_RANK_WAZE + 1;
  return {
    allowed: false,
    reason: `Acesso restrito a editores Area Manager com nível ${minDisplay}+ ou Staff. Seu perfil: ${tags.join(' · ')}.`,
    // A chave NÃO carrega o perfil: o frontend já renderiza nome e selos no
    // #accessDeniedProfile, com os selos traduzidos (profile.tag.*). Repetir aqui
    // era justamente o pedaço que chegava em português — e duplicado.
    reasonKey: 'srv.err.accessDenied',
    reasonVars: { minLevel: minDisplay },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Sessões — fábrica que recebe o store (KV/filesystem) e a chave
// ─────────────────────────────────────────────────────────────────────────

// ── Pareamento (computador → celular) ──────────────────────────────────────
// Copiar cookies no celular é inviável na prática. A saída é logar UMA vez no
// computador (onde a extensão resolve num clique) e transferir a sessão pro
// telefone, tipo WhatsApp Web ao contrário.
export const PAIR_TTL = 300; // 5 min — janela curta de propósito
// Alfabeto sem 0/O/1/I: ninguém erra de digitar. 32 símbolos ^ 6 = 1,07 bilhão
// de combinações, ~1000× mais que 6 dígitos, com o mesmo esforço pra digitar.
const PAIR_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PAIR_CODE_LEN = 6;

function randomPairCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(PAIR_CODE_LEN));
  let out = '';
  // 256 % 32 === 0, então o módulo NÃO enviesa: cada símbolo é equiprovável.
  for (const b of bytes) out += PAIR_ALPHABET[b % PAIR_ALPHABET.length];
  return out;
}

// Aceita "abc-123", "ABC 123", "abc123" — o usuário digita como quiser.
export function normalizePairCode(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function makeSessions({ store, keyBytes }) {
  return {
    async createSession(cookiesContent) {
      const token = randomToken();
      const hash = await sha256hex(token);
      const blob = await encryptCookies(cookiesContent, keyBytes);
      await store.put(hash, blob, SESSION_TTL);
      return token;
    },
    async loadSession(token) {
      if (!token) return null;
      const hash = await sha256hex(token);
      const blob = await store.get(hash);
      if (!blob) return null;
      return decryptCookies(blob, keyBytes);
    },
    async destroySession(token) {
      if (!token) return;
      const hash = await sha256hex(token);
      await store.delete(hash);
    },

    // Guarda os cookies (JÁ criptografados) sob um código curto e efêmero.
    // A validade vai DENTRO do valor, e não só no TTL do store, porque os dois
    // adaptadores tratam TTL de formas diferentes: o KV expira sozinho, mas o
    // store de arquivo da VM ignora o TTL do put (usa mtime + SESSION_TTL, que
    // são 21 dias). Sem o carimbo interno, um código de pareamento sobreviveria
    // três semanas na VM. Com ele, o prazo vale igual nos dois.
    async createPairing(cookiesContent) {
      const code = randomPairCode();
      const hash = await sha256hex('pair:' + code);
      const exp = Math.floor(Date.now() / 1000) + PAIR_TTL;
      const blob = await encryptCookies(cookiesContent, keyBytes);
      await store.put(hash, exp + '|' + blob, PAIR_TTL);
      return { code, expiresIn: PAIR_TTL };
    },

    // Uso único: apaga ANTES de validar a expiração, pra um código não poder
    // ser tentado duas vezes nem virar oráculo de "existe mas venceu".
    async claimPairing(code) {
      const limpo = normalizePairCode(code);
      if (limpo.length !== PAIR_CODE_LEN) return null;
      const hash = await sha256hex('pair:' + limpo);
      const raw = await store.get(hash);
      if (!raw) return null;
      await store.delete(hash);
      const sep = raw.indexOf('|');
      if (sep < 0) return null;
      const exp = parseInt(raw.slice(0, sep), 10);
      if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
      return decryptCookies(raw.slice(sep + 1), keyBytes);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Utilidades de request
// ─────────────────────────────────────────────────────────────────────────

function requireRegion(data) {
  let region = data && data.region ? String(data.region).toLowerCase().trim() : 'row';
  if (!WAZE_REGIONS[region]) region = 'row';
  return region;
}

async function resolveCookies(data, sessions) {
  if (data && data.sessionToken) {
    const cookies = await sessions.loadSession(data.sessionToken);
    if (!cookies) throw new ApiError({ success: false, error: 'Sessão expirada ou inválida', errorKey: 'srv.err.sessionExpired' }, 401);
    return cookies;
  }
  if (data && data.cookies) return String(data.cookies).trim();
  throw new ApiError({ success: false, error: 'Sessão ou cookies não fornecidos', errorKey: 'srv.err.sessionMissing' }, 401);
}

// Prepara cookieHeader + csrf a partir do conteúdo, validando formato.
function prepareAuth(cookiesContent) {
  if (!validateCookiesFormat(cookiesContent)) apiError('Formato de cookies inválido', 400, 'srv.err.cookieFormat');
  const csrf = extractCSRFToken(cookiesContent);
  if (!csrf) apiError('Token CSRF não encontrado', 400, 'srv.err.csrfMissing');
  return { cookieHeader: cookieHeaderFrom(cookiesContent), csrf };
}

// `changedVenue` NÃO é um diff: é um objeto de venue com os valores propostos.
// Junto dos campos que o usuário pediu para mudar vêm os de escrituração, que
// ninguém editou — `id` é a identidade do local (idêntica antes e depois) e
// `updatedOn`/`updatedBy` são o carimbo de modificação, que muda porque a edição
// acontece, não porque alguém pediu. O WME oficial só lista campo editável; nós
// listávamos tudo, e o ruído ainda empurrava mudança de verdade pro "+N mais"
// (MAX_CHANGES_DISPLAY), escondendo o que o editor precisava ver.
//
// É lista de EXCLUSÃO, não de inclusão, de propósito: campo novo que o Waze
// passe a mandar aparece com o nome cru (o fallback do fieldLabels) — feio, mas
// visível. Uma lista de inclusão esconderia calado uma mudança de verdade, que
// é o oposto do que a app existe pra fazer.
const CAMPOS_ESCRITURACAO = new Set([
  'id', 'permissions', 'updatedOn', 'updatedBy', 'createdOn', 'createdBy',
]);

// O core NÃO escreve texto de interface: `js/i18n.js` é a fonte única, nas três
// línguas. Aqui os valores especiais viram TIPOS, e o frontend decide a palavra:
//   null  → campo vazio            ('(vazio)' / '(empty)' / '(vacío)')
//   true  → sim   · false → não
//   ''    → existe mas não tem nome ('(sem nome)') — só o resolveIdField produz,
//           e não colide com dado real porque string vazia já virou null acima.
// Antes isto saía do servidor em português e um editor em inglês lia
// "Nome: (vazio) → Novo Nome" no meio de uma interface traduzida.
const formatValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(', ');
  // Objeto simples caía no String(value) e chegava na tela como "[object Object]"
  // — visto num pedido REAL de mudança de geometria (AmBev, Manaus), em qualquer
  // idioma. Array já era tratado; objeto não, e o `geometry` do Waze é GeoJSON.
  // O caso bonito de geometria é formatado no laço de changes (formatGeometry);
  // isto é a rede pra QUALQUER campo novo que venha como objeto: JSON feio é
  // legível e diagnosticável — "[object Object]" não diz nem que campo era.
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return null; }
  }
  return String(value);
};

// Geometria do Waze é GeoJSON (Point/Polygon/MultiPolygon). O que o editor quer
// ler é a coordenada, não a estrutura. Ponto decimal e não vírgula de propósito:
// coordenada se escreve com ponto em qualquer idioma no contexto de mapas.
export const formatGeometry = (geom) => {
  const par = extractLonLatDeep(geom);
  if (!par) return null;
  const [lon, lat] = par;
  const coord = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  // Point é um ponto só: a coordenada é a geometria inteira, e pronto.
  const tipo = geom && typeof geom === 'object' ? String(geom.type || '') : '';
  if (tipo === 'Point' || !tipo) return coord;
  // Polígono NÃO: mostrar só o primeiro vértice faria um polígono que mudou nos
  // outros vértices parecer IDÊNTICO ao anterior — pior que o "[object Object]"
  // de antes, porque afirma uma igualdade falsa em vez de só ser feio. O total
  // de vértices desempata os casos comuns (mover/redesenhar muda a contagem ou
  // o primeiro ponto) sem encher a linha de números.
  return `${coord} · ${contarVertices(geom)} pts`;
};

// Quanto o ponto andou, em metros. É ISTO que decide se a mudança importa: no
// dado real, 12 de 33 movimentos são menores que 1 METRO (mediana 6m). Ler duas
// coordenadas de 6 casas e subtrair de cabeça não é trabalho de gente.
// Equiretangular basta: a menos de 1km o erro é irrelevante e não puxa trig cara.
// Centróide (média dos vértices), não o primeiro ponto. Medido no dado real: o
// polígono da AmBev ganhou um vértice sem mexer no primeiro, e a distância pelo
// primeiro vértice deu ZERO — o card dizia "moveu 0 m" sobre uma forma que
// mudou. Afirmar que nada aconteceu é pior que não dizer nada.
const centroide = (geom) => {
  let sx = 0, sy = 0, n = 0;
  const desce = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') { sx += c[0]; sy += c[1]; n++; return; }
    for (const item of c) desce(item);
  };
  desce(geom && geom.coordinates);
  return n ? [sx / n, sy / n] : null;
};

export const distanciaEntreGeometrias = (a, b) => {
  const pa = centroide(a) || extractLonLatDeep(a);
  const pb = centroide(b) || extractLonLatDeep(b);
  if (!pa || !pb) return null;
  const [lonA, latA] = pa;
  const [lonB, latB] = pb;
  const dLat = (latB - latA) * 111320;
  const dLon = (lonB - lonA) * 111320 * Math.cos((latA * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

// O que ENTROU e o que SAIU de um campo de lista. Mostrar as duas listas
// inteiras obriga o editor a fazer o diff com o olho — medido no dado real:
// `services` troca 1 item entre 5, `categories` ganha 1 entre 2. Um app
// profissional mostra a diferença, não o antes-e-depois cru.
// Devolve valores CRUS (enums do Waze); quem traduz é o frontend.
export const diffDeLista = (antes, depois) => {
  if (!Array.isArray(antes) || !Array.isArray(depois)) return null;
  const chave = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
  const setA = new Map(antes.map((v) => [chave(v), v]));
  const setB = new Map(depois.map((v) => [chave(v), v]));
  const add = [...setB].filter(([k]) => !setA.has(k)).map(([, v]) => v);
  const del = [...setA].filter(([k]) => !setB.has(k)).map(([, v]) => v);
  if (!add.length && !del.length) return null;
  return { add, del };
};

const contarVertices = (geom) => {
  let n = 0;
  const desce = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') { n++; return; }
    for (const item of c) desce(item);
  };
  desce(geom && geom.coordinates);
  return n;
};

// Mesmo desce-recursivo do buildPlacesFromSearch, mas no escopo do módulo pra
// o formatGeometry poder usar (lá ele é local a uma função).
const extractLonLatDeep = (coords) => {
  if (!Array.isArray(coords)) {
    if (coords && typeof coords === 'object' && coords.coordinates) return extractLonLatDeep(coords.coordinates);
    return null;
  }
  if (coords.length === 0) return null;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') return [coords[0], coords[1]];
  if (Array.isArray(coords[0]) || (coords[0] && typeof coords[0] === 'object')) return extractLonLatDeep(coords[0]);
  return null;
};

// ─────────────────────────────────────────────────────────────────────────
// Handlers — cada um retorna { status, body }
// ─────────────────────────────────────────────────────────────────────────

async function handleSessao(data, { sessions }) {
  const action = (data && data.action) || 'create';
  if (action === 'create') {
    if (!data.cookies) apiError('Cookies não fornecidos', 400, 'srv.err.cookiesMissing');
    // Filtra pro domínio do Waze antes de armazenar (ver filterWazeCookies).
    const cookies = filterWazeCookies(String(data.cookies).trim());
    if (!validateCookiesFormat(cookies)) apiError('Formato de cookies inválido ou nenhum cookie do Waze encontrado', 400, 'srv.err.cookieFormatNoWaze');
    if (!extractCSRFToken(cookies)) apiError('Token CSRF não encontrado', 400, 'srv.err.csrfMissing');
    const token = await sessions.createSession(cookies);
    return { status: 200, body: { success: true, sessionToken: token, expiresIn: SESSION_TTL } };
  }
  if (action === 'destroy') {
    await sessions.destroySession(data && data.sessionToken);
    return { status: 200, body: { success: true } };
  }
  apiError('Ação inválida', 400, 'srv.err.badAction');
}

// Pareamento: `create` exige sessão válida (só quem já está logado gera código);
// `claim` troca o código por uma sessão nova pro segundo aparelho.
// A sessão de origem continua intacta — o computador não é deslogado.
async function handleParear(data, { sessions }) {
  const action = (data && data.action) || 'create';

  if (action === 'create') {
    const cookies = await resolveCookies(data, sessions); // 401 se não autenticado
    const { code, expiresIn } = await sessions.createPairing(cookies);
    return { status: 200, body: { success: true, code, expiresIn } };
  }

  if (action === 'claim') {
    const cookies = await sessions.claimPairing(data && data.code);
    // Mensagem ÚNICA pros casos "não existe", "já usado" e "expirou": diferenciar
    // transformaria o endpoint num oráculo pra quem estivesse chutando códigos.
    if (!cookies) apiError('Código inválido ou expirado. Gere um novo no aparelho logado.', 400, 'srv.err.pairCodeInvalid');
    const token = await sessions.createSession(cookies);
    return { status: 200, body: { success: true, sessionToken: token, expiresIn: SESSION_TTL } };
  }

  apiError('Ação inválida', 400, 'srv.err.badAction');
}

async function handleTestarCookies(data, { sessions }) {
  if (!data || !data.cookies) apiError('Cookies não fornecidos', 400, 'srv.err.cookiesMissing');
  const region = requireRegion(data);
  // Filtra pro domínio do Waze logo na entrada: o cookies.txt do navegador traz
  // cookies de dezenas de sites — guardar/enviar só os do Waze evita vazar
  // credenciais de terceiros e o HTTP 400 por header gigante. Ver filterWazeCookies.
  const cookies = filterWazeCookies(String(data.cookies).trim());
  if (!validateCookiesFormat(cookies)) apiError('Formato de cookies inválido ou nenhum cookie do Waze encontrado. Exporte os cookies logado no Waze Map Editor (formato Netscape).', 400, 'srv.err.cookieFormatExport');
  const csrf = extractCSRFToken(cookies);
  if (!csrf) apiError('Token CSRF não encontrado nos cookies. Certifique-se de estar logado no Waze Map Editor.', 400, 'srv.err.csrfMissingLogin');

  const result = await callWaze(wazeSessionEndpoint(region), cookieHeaderFrom(cookies), csrf, null, region);
  if (result.httpCode === 401 || result.httpCode === 403) {
    apiError('Cookies expirados ou inválidos. Faça login novamente no Waze Map Editor e exporte novos cookies.', 400, 'srv.err.cookiesExpiredRelogin');
  }
  if (result.httpCode !== 200) apiError(`Erro ao validar cookies (HTTP ${result.httpCode})`);

  let profile;
  try {
    profile = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze', 400, 'srv.err.badWazeResponse');
  }
  if (!profile || typeof profile !== 'object' || !profile.userName) apiError('Resposta inválida da API do Waze', 400, 'srv.err.badWazeResponse');

  const check = isUserAllowed(profile);
  if (!check.allowed) {
    return {
      status: 403,
      body: {
        success: false,
        error: check.reason,
        errorKey: check.reasonKey,
        errorVars: check.reasonVars,
        errorCategory: 'access_denied',
        profile: {
          userName: profile.userName || '',
          rank: profile.rank ?? null,
          isAreaManager: !!profile.isAreaManager,
          isStaff: !!profile.isStaff,
        },
      },
    };
  }

  const token = await sessions.createSession(cookies);
  return {
    status: 200,
    body: { success: true, message: 'Cookies válidos! Você está autenticado.', sessionToken: token, expiresIn: SESSION_TTL },
  };
}

async function handleBuscarPlaces(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  const { cookieHeader, csrf } = prepareAuth(cookies);

  const page = data.page ? Math.max(1, parseInt(data.page, 10) || 1) : 1;
  const countryId = data.countryId ? parseInt(data.countryId, 10) || 30 : 30;
  const stateId = data.stateId !== undefined && data.stateId !== '' && data.stateId !== null ? parseInt(data.stateId, 10) : null;
  const managedAreaId = data.managedAreaId !== undefined && data.managedAreaId !== '' && data.managedAreaId !== null ? parseInt(data.managedAreaId, 10) : null;
  const bbox = Array.isArray(data.bbox) && data.bbox.length === 4 ? data.bbox : null;
  const filterTypes = Array.isArray(data.types) && data.types.length > 0 ? data.types : null;
  const filterCategories = Array.isArray(data.categories) && data.categories.length > 0 ? data.categories : null;
  const residential = data.residential !== undefined ? !!data.residential : null;
  const unreadOnly = data.unreadOnly !== undefined ? !!data.unreadOnly : true;

  const payload = {
    fromCreationTime: null,
    fromUpdateTime: null,
    toCreationTime: null,
    toUpdateTime: null,
    bbox,
    cityId: null,
    countryId: bbox ? null : countryId,
    managedAreaId,
    managedAreaIds: null,
    stateId,
    userPropertiesFilter: unreadOnly ? { isRead: false } : {},
    venueUpdateRequestsFilter: {
      categories: filterCategories,
      lockRanks: [0, 1, 2, 3, 4, 5],
      page,
      residential,
      // types SEMPRE null pro Waze (array parcial => HTTP 406). Filtramos por reqType abaixo.
      types: null,
      orderBy: 'SORTING_UPDATE_TIME_DESC',
    },
  };

  const result = await callWaze(wazeIssuesEndpoint(region), cookieHeader, csrf, payload, region);
  if (result.httpCode !== 200) {
    const cat = categorizeWazeError(result.httpCode, result.response, result.error);
    return {
      status: cat.category === 'unauthorized' ? 401 : 500,
      body: { success: false, error: cat.message, errorKey: cat.messageKey, errorVars: cat.messageVars, errorCategory: cat.category, httpCode: result.httpCode },
    };
  }

  let rd;
  try {
    rd = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze', 500, 'srv.err.badWazeResponse');
  }

  const { places, blocked } = buildPlacesFromSearch(rd, { filterTypes, unreadOnly });

  const hasMore = !!(rd?.mapIssues?.venueUpdateRequests?.hasMore);
  return {
    status: 200,
    body: {
      success: true,
      places,
      hasMore,
      page,
      total: places.length,
      // totalAll = o que existe na região pros filtros atuais, INCLUINDO os que
      // este editor não pode editar (venue.permissions >= 0). A app trata só os
      // editáveis; o extra vira a dica "de N na região" no contador (D13).
      totalAll: places.length + blocked,
      blocked,
    },
  };
}

// Expansão pura da resposta do Issues/Search/List em cards (um por PUR).
// Devolve { places, blocked }: `blocked` são PURs que passariam nos filtros de
// tipo/leitura mas cujo venue o usuário não tem permissão de editar.
// Exportada pra suite testar com fixtures de HAR real, sem rede.
export function buildPlacesFromSearch(rd, { filterTypes = null, unreadOnly = true } = {}) {
  const usersDict = {};
  for (const u of rd?.users?.objects || []) usersDict[u.id] = u.userName;
  const streetsDict = {};
  for (const s of rd?.streets?.objects || []) streetsDict[s.id] = s;
  const citiesDict = {};
  for (const c of rd?.cities?.objects || []) citiesDict[c.id] = c;
  const statesDict = {};
  for (const st of rd?.states?.objects || []) statesDict[st.id] = st.name;

  const brandLookup = {};
  const categoryBrands = rd?.venues?.categoryBrands || {};
  for (const cat of Object.keys(categoryBrands)) {
    for (const b of categoryBrands[cat] || []) {
      const k = String(b).trim().toLowerCase();
      if (k) brandLookup[k] = true;
    }
  }

  const fieldLabels = {
    name: 'Nome', description: 'Descrição', houseNumber: 'Número', phone: 'Telefone',
    geometry: 'Localização', categories: 'Categorias', aliases: 'Nomes Alternativos',
    url: 'Site', openingHours: 'Horário', streetID: 'Rua', cityID: 'Cidade',
    residential: 'Residencial', brand: 'Marca', entryExitPoints: 'Ponto de entrada/saída',
  };

  // GeoJSON recursivo: Point/Polygon/MultiPolygon → primeiro par [lon,lat] numérico
  const extractLonLat = (coords) => {
    if (!Array.isArray(coords) || coords.length === 0) return null;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') return [coords[0], coords[1]];
    if (Array.isArray(coords[0])) return extractLonLat(coords[0]);
    return null;
  };
  const resolveIdField = (field, value) => {
    if (value === null || value === undefined || value === '') return null;
    if (field === 'streetID' && streetsDict[value]) {
      const name = String(streetsDict[value].name || '').trim();
      return name; // '' = a rua/cidade existe mas não tem nome (frontend traduz)
    }
    if (field === 'cityID' && citiesDict[value]) {
      const name = String(citiesDict[value].name || '').trim();
      return name; // '' = a rua/cidade existe mas não tem nome (frontend traduz)
    }
    return null;
  };

  const places = [];
  let blocked = 0;
  for (const venue of rd?.venues?.objects || []) {
    if (!Array.isArray(venue.venueUpdateRequests) || venue.venueUpdateRequests.length === 0) continue;
    // permissions: bitmask signed 32-bit. <0 = pode editar; >=0 = sem permissão.
    // Antes descartávamos o venue aqui. Agora seguimos o laço só pra CONTAR
    // (blocked) os PURs que passariam nos demais filtros — é o que alimenta o
    // "de N na região" (D13). Nenhum card é emitido pra venue não-editável.
    const editable = !(venue.permissions !== undefined && venue.permissions >= 0);
    if (!editable) {
      // Só contagem: aplica os MESMOS filtros de leitura/tipo pra que o número
      // seja comparável com places.length, e pula o trabalho caro (endereço,
      // imagens, diff de mudanças) que nunca vai virar card.
      for (const ur of venue.venueUpdateRequests) {
        if (unreadOnly && ur.isRead === true) continue;
        if (filterTypes !== null && !filterTypes.includes(ur.type || '')) continue;
        blocked++;
      }
      continue;
    }

    let venueLat = null, venueLon = null;
    if (venue.geometry && venue.geometry.coordinates) {
      const pair = extractLonLat(venue.geometry.coordinates);
      if (pair) { venueLon = pair[0]; venueLat = pair[1]; }
    }

    const addressParts = [];
    if (venue.streetID && streetsDict[venue.streetID]) {
      const street = streetsDict[venue.streetID];
      const streetName = String(street.name || '').trim();
      if (streetName !== '') addressParts.push(streetName);
      if (venue.houseNumber && String(venue.houseNumber).trim() !== '') addressParts.push(String(venue.houseNumber).trim());
      if (street.cityID && citiesDict[street.cityID]) {
        const city = citiesDict[street.cityID];
        const cityName = String(city.name || '').trim();
        if (cityName !== '') {
          let cityPart = cityName;
          if (city.stateID && statesDict[city.stateID]) {
            const stateName = String(statesDict[city.stateID]).trim();
            if (stateName !== '') cityPart += ' - ' + stateName;
          }
          addressParts.push(cityPart);
        }
      }
    } else if (venue.houseNumber && String(venue.houseNumber).trim() !== '') {
      addressParts.push(String(venue.houseNumber).trim());
    }
    const venueAddress = addressParts.length ? addressParts.join(', ') : null;

    const allImageUrls = [];
    for (const img of venue.images || []) {
      if (img && img.id) allImageUrls.push(WAZE_IMAGE_BASE + img.id);
    }

    for (const ur of venue.venueUpdateRequests) {
      const creatorId = ur.createdBy ?? null;
      const creatorName = creatorId && usersDict[creatorId] ? usersDict[creatorId] : creatorId;

      const reqType = ur.type || '';
      const reqSubType = ur.subType || '';
      // O filtro isRead que mandamos ao Waze (userPropertiesFilter) é POR VENUE:
      // o venue volta se QUALQUER PUR dele estiver não-lido. Sem este skip por
      // PUR, uma foto já lida re-vira card eternamente enquanto um PUR irmão
      // (ex.: REQUEST, gated e invisível na app) seguir não-lido — o place
      // "volta" sem o user ter como sair do loop. Confirmado via HAR (Batalhão
      // PMDF: IMAGE isRead:true + REQUEST isRead:false → venue retornava sempre).
      if (unreadOnly && ur.isRead === true) continue;
      if (filterTypes !== null && !filterTypes.includes(reqType)) continue;

      let updateTypeStr = 'Desconhecido';
      let updateTypeKey = 'UNKNOWN';
      const changes = [];
      let isDelete = false;
      let flagComment = null;
      let flagType = null;
      let flagSubjectType = null;
      let flagEntityID = null;

      if (reqType === 'VENUE') {
        updateTypeStr = 'Novo Local';
        updateTypeKey = 'VENUE';
      } else if (reqType === 'IMAGE') {
        updateTypeStr = 'Nova Foto';
        updateTypeKey = 'IMAGE';
      } else if (reqType === 'REQUEST' && reqSubType === 'FLAG') {
        updateTypeStr = 'Reporte (Sinalização)';
        updateTypeKey = 'FLAG';
        // O `flagComment` (texto livre) quase sempre vem VAZIO — confirmado no HAR
        // do "Ponto de Mergulho - Barragem do Lago Paranoá". Quem carrega o motivo
        // é o `flagType` (enum: INAPPROPRIATE…), que a app ignorava: o card saía
        // sem dizer nada, enquanto o WME mostrava "Motivo da marcação: Inapropriado".
        // `flagSubjectType` diz o que foi denunciado (IMAGE = uma foto, não o local)
        // e `flagEntityID` é o id DELA — bate exatamente com `venue.images[].id`,
        // que é como o card sabe qual das 4 fotos marcar.
        // Passamos os enums CRUS: a tradução é do frontend (js/i18n.js é a fonte
        // única de string de UI) e valor não mapeado aparece cru, nunca some.
        flagComment = String(ur.flagComment || '').trim() || null;
        flagType = String(ur.flagType || '').trim() || null;
        flagSubjectType = String(ur.flagSubjectType || '').trim() || null;
        flagEntityID = String(ur.flagEntityID || '').trim() || null;
      } else if (reqType === 'REQUEST' && reqSubType === 'DELETE') {
        updateTypeStr = 'Pedido de remoção';
        updateTypeKey = 'DELETE';
        isDelete = true;
      } else if (reqType === 'REQUEST' && reqSubType === 'UPDATE') {
        if (ur.changedVenue && typeof ur.changedVenue === 'object') {
          for (const k of Object.keys(ur.changedVenue)) {
            if (CAMPOS_ESCRITURACAO.has(k)) continue;
            const newValue = ur.changedVenue[k];
            const label = fieldLabels[k] || (k.charAt(0).toUpperCase() + k.slice(1));
            const resolvedFrom = resolveIdField(k, venue[k] ?? null);
            const resolvedTo = resolveIdField(k, newValue);
            // Geometria primeiro: é o campo que chegava como "[object Object]".
            const fmt = k === 'geometry'
              ? (v) => (formatGeometry(v) ?? formatValue(v))
              : formatValue;
            const mudanca = {
              field: k,
              label,
              from: resolvedFrom !== null ? resolvedFrom : fmt(venue[k] ?? null),
              to: resolvedTo !== null ? resolvedTo : fmt(newValue),
            };
            // Quanto andou. O frontend formata o número no locale do editor —
            // aqui vai cru, em metros, porque o core não sabe o idioma dele.
            if (k === 'geometry') {
              const d = distanciaEntreGeometrias(venue[k] ?? null, newValue);
              if (d !== null && Number.isFinite(d)) mudanca.movedM = d;
              // Vértices como NÚMERO, não sufixo de texto: o card precisa saber
              // "ganhou um vértice" pra não anunciar "moveu 0 m" numa forma que
              // mudou. Quem escolhe a frase é o frontend.
              const vA = contarVertices(venue[k] ?? null);
              const vB = contarVertices(newValue);
              if (vA || vB) { mudanca.vertsFrom = vA; mudanca.vertsTo = vB; }
            }
            // Campo de lista: o que entrou e o que saiu, em vez de duas listas
            // inteiras pro editor comparar de olho.
            const delta = diffDeLista(venue[k] ?? null, newValue);
            if (delta) mudanca.delta = delta;
            changes.push(mudanca);
          }
        }
        updateTypeStr = changes.length > 0 ? 'Atualização: ' + changes.map((c) => c.label).join(', ') : 'Atualização (Detalhes)';
        updateTypeKey = changes.length > 0 ? 'UPDATE' : 'UPDATE_DETAILS';
      }

      let brand = venue.brand ?? null;
      if (ur.changedVenue && ur.changedVenue.brand !== undefined) brand = ur.changedVenue.brand;
      let brandKnown = null;
      if (brand !== null && String(brand).trim() !== '') brandKnown = !!brandLookup[String(brand).trim().toLowerCase()];

      places.push({
        venueID: venue.id,
        updateRequestID: ur.id,
        name: venue.name || null,   // o frontend põe 'Sem nome'/'No name'/'Sin nombre'
        categories: venue.categories || [],
        address: venueAddress,
        updateType: updateTypeStr,
        updateTypeKey,
        reqType,
        reqSubType,
        isDelete,
        flagComment,
        flagType,
        flagSubjectType,
        flagEntityID,
        dateAdded: ur.dateAdded ?? null,
        isStarred: !!ur.isStarred,
        createdBy: creatorName,
        imageUrl: allImageUrls.length ? allImageUrls[0] : null,
        imageUrls: allImageUrls,
        changes,
        brand,
        brandKnown,
        lat: venueLat,
        lon: venueLon,
      });
    }
  }

  return { places, blocked };
}

async function handleMarcarLido(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);

  const ids = [];
  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item && item.venueID !== undefined && item.updateRequestID !== undefined) {
        ids.push({ id: item.updateRequestID, venueId: item.venueID });
      }
    }
  } else if (data.venueID !== undefined && data.updateRequestID !== undefined) {
    ids.push({ id: data.updateRequestID, venueId: data.venueID });
  }
  if (ids.length === 0) apiError('Dados incompletos', 400, 'srv.err.incompleteData');

  const { cookieHeader, csrf } = prepareAuth(cookies);
  const payload = { value: true, venueUpdateRequestIds: ids };
  const result = await callWaze(wazeMarkReadEndpoint(region), cookieHeader, csrf, payload, region);
  const cat = categorizeWazeError(result.httpCode, result.response, result.error);

  if (result.httpCode === 200 && cat.category !== 'already_processed') {
    return {
      status: 200,
      body: { success: true, count: ids.length, message: ids.length === 1 ? 'Place marcado como lido com sucesso' : `${ids.length} places marcados como lidos` },
    };
  }
  return {
    status: cat.category === 'already_processed' || cat.category === 'not_found' ? 200 : 500,
    body: { success: false, error: cat.message, errorKey: cat.messageKey, errorVars: cat.messageVars, errorCategory: cat.category, httpCode: result.httpCode },
  };
}

async function handleValidarPlace(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  if (data.venueID === undefined || data.updateRequestID === undefined) apiError('Parâmetros incompletos', 400, 'srv.err.incompleteParams');

  const { cookieHeader, csrf } = prepareAuth(cookies);
  const payload = {
    actions: {
      name: 'DESCARTES_SERIALIZATION',
      _subActions: [
        {
          name: 'UPDATE_PLACE_UPDATE',
          _subActions: [
            {
              name: 'UPDATE_PLACE_UPDATE',
              _objectType: 'venueUpdateRequest',
              action: 'UPDATE',
              attributes: { approve: false, id: data.updateRequestID, venueID: data.venueID },
            },
          ],
        },
      ],
    },
  };
  const result = await callWaze(wazeFeaturesEndpoint(region), cookieHeader, csrf, payload, region);
  const cat = categorizeWazeError(result.httpCode, result.response, result.error);

  if (result.httpCode === 200 && cat.category !== 'already_processed') {
    return { status: 200, body: { success: true, message: 'Place rejeitado com sucesso', action: 'rejected' } };
  }
  return {
    status: cat.category === 'already_processed' || cat.category === 'not_found' ? 200 : 500,
    body: { success: false, error: cat.message, errorKey: cat.messageKey, errorVars: cat.messageVars, errorCategory: cat.category, httpCode: result.httpCode },
  };
}

async function handlePerfil(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  const { cookieHeader, csrf } = prepareAuth(cookies);

  const result = await callWaze(wazeSessionEndpoint(region), cookieHeader, csrf, null, region);
  if (result.httpCode !== 200) {
    const cat = categorizeWazeError(result.httpCode, result.response, result.error);
    return {
      status: cat.category === 'unauthorized' ? 401 : 500,
      body: { success: false, error: cat.message, errorKey: cat.messageKey, errorVars: cat.messageVars, errorCategory: cat.category, httpCode: result.httpCode },
    };
  }
  let rd;
  try {
    rd = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze', 500, 'srv.err.badWazeResponse');
  }

  const areas = [];
  for (const area of rd.areas || []) {
    let bbox = null;
    const coords = area?.geometry?.coordinates?.[0];
    if (Array.isArray(coords) && coords.length) {
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      bbox = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
    }
    areas.push({ type: area.type ?? null, bbox });
  }
  const managedAreas = [];
  for (const ma of rd.managedAreas || []) managedAreas.push({ id: ma.id ?? null, name: ma.name || '' });

  return {
    status: 200,
    body: {
      success: true,
      profile: {
        id: rd.id ?? null,
        userName: rd.userName || '',
        rank: rd.rank ?? null,
        isStaff: rd.isStaff ?? false,
        isAreaManager: rd.isAreaManager ?? false,
        isEditor: rd.isEditor ?? false,
        profileImageUrl: rd.profileImageUrl || '',
        editableCountryIDs: rd.editableCountryIDs || [],
        totalPoints: rd.totalPoints || 0,
        totalEdits: rd.totalEdits || 0,
        areas,
        managedAreas,
      },
    },
  };
}

async function handleListaPaises(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  const { cookieHeader, csrf } = prepareAuth(cookies);

  const result = await callWaze(wazeCountriesEndpoint(region), cookieHeader, csrf, null, region);
  if (result.httpCode !== 200) {
    const cat = categorizeWazeError(result.httpCode, result.response, result.error);
    return {
      status: cat.category === 'unauthorized' ? 401 : 500,
      body: { success: false, error: cat.message, errorKey: cat.messageKey, errorVars: cat.messageVars, errorCategory: cat.category, httpCode: result.httpCode },
    };
  }
  let rd;
  try {
    rd = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze', 500, 'srv.err.badWazeResponse');
  }
  const countries = (rd.countries || []).map((c) => ({
    id: c.id ?? null,
    name: c.name || '',
    abbr: c.abbr || '',
    env: String(c.env || 'row').toLowerCase(),
  }));
  // Ordem BASE, só pra resposta ser estável (cache, teste, outro consumidor).
  // O locale aqui é 'en' e não 'pt-BR' porque o servidor NÃO SABE quem está
  // lendo: qualquer idioma que ele escolhesse estaria errado pra alguém — e
  // 'pt-BR' ordenava a lista de um editor francês por regra portuguesa. Quem
  // ordena de verdade é o cliente, que conhece o idioma (ordenarPorNome em app.js).
  countries.sort((a, b) => String(a.name).localeCompare(String(b.name), 'en'));
  return { status: 200, body: { success: true, countries } };
}

async function handleListaEstados(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  const countryId = data.countryId ? parseInt(data.countryId, 10) : 0;
  if (countryId <= 0) apiError('countryId obrigatório', 400, 'srv.err.countryRequired');
  const { cookieHeader, csrf } = prepareAuth(cookies);

  const result = await callWaze(wazeStatesEndpoint(region, countryId), cookieHeader, csrf, null, region);
  if (result.httpCode !== 200) {
    const cat = categorizeWazeError(result.httpCode, result.response, result.error);
    return {
      status: cat.category === 'unauthorized' ? 401 : 500,
      body: { success: false, error: cat.message, errorKey: cat.messageKey, errorVars: cat.messageVars, errorCategory: cat.category, httpCode: result.httpCode },
    };
  }
  let rd;
  try {
    rd = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze', 500, 'srv.err.badWazeResponse');
  }
  const states = [];
  for (const s of rd.states || []) {
    if (Number(s.countryId) !== countryId) continue;
    states.push({ id: s.id ?? null, name: s.name || '', countryId: s.countryId ?? null });
  }
  // Ordem BASE, só pra resposta ser estável (cache, teste, outro consumidor).
  // O locale aqui é 'en' e não 'pt-BR' porque o servidor NÃO SABE quem está
  // lendo: qualquer idioma que ele escolhesse estaria errado pra alguém — e
  // 'pt-BR' ordenava a lista de um editor francês por regra portuguesa. Quem
  // ordena de verdade é o cliente, que conhece o idioma (ordenarPorNome em app.js).
  states.sort((a, b) => String(a.name).localeCompare(String(b.name), 'en'));
  return { status: 200, body: { success: true, states } };
}

// ─────────────────────────────────────────────────────────────────────────
// Roteamento
// ─────────────────────────────────────────────────────────────────────────

const ROUTES = {
  sessao: handleSessao,
  parear: handleParear,
  'testar-cookies': handleTestarCookies,
  'buscar-places': handleBuscarPlaces,
  'marcar-lido': handleMarcarLido,
  'validar-place': handleValidarPlace,
  perfil: handlePerfil,
  'lista-paises': handleListaPaises,
  'lista-estados': handleListaEstados,
};

/**
 * Executa um endpoint. `name` sem `.php` (tolera sufixo por compat de cache).
 * ctx = { sessions }. Sempre resolve — nunca lança (ApiError vira resposta;
 * erro inesperado vira 500 genérico, sem vazar detalhe interno).
 */
export async function dispatch(name, data, ctx) {
  const clean = String(name || '').replace(/\.php$/, '');
  const handler = ROUTES[clean];
  if (!handler) return { status: 404, body: { success: false, error: 'Endpoint não encontrado', errorKey: 'srv.err.endpointNotFound' } };
  try {
    return await handler(data || {}, ctx);
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: e.body };
    return { status: 500, body: { success: false, error: 'Erro interno', errorKey: 'srv.err.internal' } };
  }
}
