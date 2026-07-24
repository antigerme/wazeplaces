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
const apiError = (message, status = 400) => {
  throw new ApiError({ success: false, error: message }, status);
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
    Referer: 'https://www.waze.com/pt-BR/editor?env=' + env + '&tab=issue_tracker',
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
  if (fetchError) return { category: 'transient', message: 'Erro de conexão: ' + fetchError };
  if (httpCode === 401 || httpCode === 403) return { category: 'unauthorized', message: 'Cookies expirados ou inválidos' };

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
    return { category: 'already_processed', message: 'Já tratado por outro editor' };
  }
  if (errorCode === 300 && errorDetails.includes('failed to handle')) {
    return { category: 'already_processed', message: 'Já tratado ou modificado por outro editor' };
  }
  if (httpCode === 409) return { category: 'already_processed', message: 'Já tratado por outro editor' };
  if (httpCode === 404) return { category: 'not_found', message: 'Place não existe mais (possivelmente já tratado)' };

  const hasAlreadyHint =
    bodyLower.includes('already') ||
    bodyLower.includes('duplicate') ||
    bodyLower.includes('updated by another') ||
    bodyLower.includes('no longer') ||
    bodyLower.includes('has been resolved');
  if ((httpCode === 200 || httpCode === 400 || httpCode === 422) && hasAlreadyHint) {
    return { category: 'already_processed', message: 'Já tratado por outro editor' };
  }

  if (httpCode >= 500 || httpCode === 408 || httpCode === 429 || httpCode === 0) {
    return { category: 'transient', message: `Servidor Waze indisponível (HTTP ${httpCode})` };
  }
  return { category: 'unknown', message: `Erro do Waze (HTTP ${httpCode})` };
}

// ─────────────────────────────────────────────────────────────────────────
// Gate de acesso (Staff OU rank>=2 & Area Manager)
// ─────────────────────────────────────────────────────────────────────────

export function isUserAllowed(profile) {
  if (!profile || typeof profile !== 'object') return { allowed: false, reason: 'Perfil inválido' };
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
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Sessões — fábrica que recebe o store (KV/filesystem) e a chave
// ─────────────────────────────────────────────────────────────────────────

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
    if (!cookies) throw new ApiError({ success: false, error: 'Sessão expirada ou inválida' }, 401);
    return cookies;
  }
  if (data && data.cookies) return String(data.cookies).trim();
  throw new ApiError({ success: false, error: 'Sessão ou cookies não fornecidos' }, 401);
}

// Prepara cookieHeader + csrf a partir do conteúdo, validando formato.
function prepareAuth(cookiesContent) {
  if (!validateCookiesFormat(cookiesContent)) apiError('Formato de cookies inválido');
  const csrf = extractCSRFToken(cookiesContent);
  if (!csrf) apiError('Token CSRF não encontrado');
  return { cookieHeader: cookieHeaderFrom(cookiesContent), csrf };
}

const formatValue = (value) => {
  if (value === null || value === undefined || value === '') return '(vazio)';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(', ');
  return String(value);
};

// ─────────────────────────────────────────────────────────────────────────
// Handlers — cada um retorna { status, body }
// ─────────────────────────────────────────────────────────────────────────

async function handleSessao(data, { sessions }) {
  const action = (data && data.action) || 'create';
  if (action === 'create') {
    if (!data.cookies) apiError('Cookies não fornecidos');
    // Filtra pro domínio do Waze antes de armazenar (ver filterWazeCookies).
    const cookies = filterWazeCookies(String(data.cookies).trim());
    if (!validateCookiesFormat(cookies)) apiError('Formato de cookies inválido ou nenhum cookie do Waze encontrado');
    if (!extractCSRFToken(cookies)) apiError('Token CSRF não encontrado');
    const token = await sessions.createSession(cookies);
    return { status: 200, body: { success: true, sessionToken: token, expiresIn: SESSION_TTL } };
  }
  if (action === 'destroy') {
    await sessions.destroySession(data && data.sessionToken);
    return { status: 200, body: { success: true } };
  }
  apiError('Ação inválida');
}

async function handleTestarCookies(data, { sessions }) {
  if (!data || !data.cookies) apiError('Cookies não fornecidos');
  const region = requireRegion(data);
  // Filtra pro domínio do Waze logo na entrada: o cookies.txt do navegador traz
  // cookies de dezenas de sites — guardar/enviar só os do Waze evita vazar
  // credenciais de terceiros e o HTTP 400 por header gigante. Ver filterWazeCookies.
  const cookies = filterWazeCookies(String(data.cookies).trim());
  if (!validateCookiesFormat(cookies)) apiError('Formato de cookies inválido ou nenhum cookie do Waze encontrado. Exporte os cookies logado no Waze Map Editor (formato Netscape).');
  const csrf = extractCSRFToken(cookies);
  if (!csrf) apiError('Token CSRF não encontrado nos cookies. Certifique-se de estar logado no Waze Map Editor.');

  const result = await callWaze(wazeSessionEndpoint(region), cookieHeaderFrom(cookies), csrf, null, region);
  if (result.httpCode === 401 || result.httpCode === 403) {
    apiError('Cookies expirados ou inválidos. Faça login novamente no Waze Map Editor e exporte novos cookies.');
  }
  if (result.httpCode !== 200) apiError(`Erro ao validar cookies (HTTP ${result.httpCode})`);

  let profile;
  try {
    profile = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze');
  }
  if (!profile || typeof profile !== 'object' || !profile.userName) apiError('Resposta inválida da API do Waze');

  const check = isUserAllowed(profile);
  if (!check.allowed) {
    return {
      status: 403,
      body: {
        success: false,
        error: check.reason,
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
      body: { success: false, error: cat.message, errorCategory: cat.category, httpCode: result.httpCode },
    };
  }

  let rd;
  try {
    rd = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze', 500);
  }

  const places = buildPlacesFromSearch(rd, { filterTypes, unreadOnly });

  const hasMore = !!(rd?.mapIssues?.venueUpdateRequests?.hasMore);
  return { status: 200, body: { success: true, places, hasMore, page, total: places.length } };
}

// Expansão pura da resposta do Issues/Search/List em cards (um por PUR).
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
    residential: 'Residencial', brand: 'Marca',
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
      return name !== '' ? name : '(sem nome)';
    }
    if (field === 'cityID' && citiesDict[value]) {
      const name = String(citiesDict[value].name || '').trim();
      return name !== '' ? name : '(sem nome)';
    }
    return null;
  };

  const places = [];
  for (const venue of rd?.venues?.objects || []) {
    if (!Array.isArray(venue.venueUpdateRequests) || venue.venueUpdateRequests.length === 0) continue;
    // permissions: bitmask signed 32-bit. <0 = pode editar; >=0 = descartar.
    if (venue.permissions !== undefined && venue.permissions >= 0) continue;

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
      const changes = [];
      let isDelete = false;
      let flagComment = null;

      if (reqType === 'VENUE') {
        updateTypeStr = 'Novo Local';
      } else if (reqType === 'IMAGE') {
        updateTypeStr = 'Nova Foto';
      } else if (reqType === 'REQUEST' && reqSubType === 'FLAG') {
        updateTypeStr = 'Reporte (Sinalização)';
        flagComment = String(ur.flagComment || '').trim() || null;
      } else if (reqType === 'REQUEST' && reqSubType === 'DELETE') {
        updateTypeStr = 'Pedido de remoção';
        isDelete = true;
      } else if (reqType === 'REQUEST' && reqSubType === 'UPDATE') {
        if (ur.changedVenue && typeof ur.changedVenue === 'object') {
          for (const k of Object.keys(ur.changedVenue)) {
            if (k === 'permissions') continue;
            const newValue = ur.changedVenue[k];
            const label = fieldLabels[k] || (k.charAt(0).toUpperCase() + k.slice(1));
            const resolvedFrom = resolveIdField(k, venue[k] ?? null);
            const resolvedTo = resolveIdField(k, newValue);
            changes.push({
              field: k,
              label,
              from: resolvedFrom !== null ? resolvedFrom : formatValue(venue[k] ?? null),
              to: resolvedTo !== null ? resolvedTo : formatValue(newValue),
            });
          }
        }
        updateTypeStr = changes.length > 0 ? 'Atualização: ' + changes.map((c) => c.label).join(', ') : 'Atualização (Detalhes)';
      }

      let brand = venue.brand ?? null;
      if (ur.changedVenue && ur.changedVenue.brand !== undefined) brand = ur.changedVenue.brand;
      let brandKnown = null;
      if (brand !== null && String(brand).trim() !== '') brandKnown = !!brandLookup[String(brand).trim().toLowerCase()];

      places.push({
        venueID: venue.id,
        updateRequestID: ur.id,
        name: venue.name || 'Sem nome',
        categories: venue.categories || [],
        address: venueAddress,
        updateType: updateTypeStr,
        reqType,
        reqSubType,
        isDelete,
        flagComment,
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

  return places;
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
  if (ids.length === 0) apiError('Dados incompletos');

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
    body: { success: false, error: cat.message, errorCategory: cat.category, httpCode: result.httpCode },
  };
}

async function handleValidarPlace(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  if (data.venueID === undefined || data.updateRequestID === undefined) apiError('Parâmetros incompletos');

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
    body: { success: false, error: cat.message, errorCategory: cat.category, httpCode: result.httpCode },
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
      body: { success: false, error: cat.message, errorCategory: cat.category, httpCode: result.httpCode },
    };
  }
  let rd;
  try {
    rd = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze', 500);
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
      body: { success: false, error: cat.message, errorCategory: cat.category, httpCode: result.httpCode },
    };
  }
  let rd;
  try {
    rd = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze', 500);
  }
  const countries = (rd.countries || []).map((c) => ({
    id: c.id ?? null,
    name: c.name || '',
    abbr: c.abbr || '',
    env: String(c.env || 'row').toLowerCase(),
  }));
  countries.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  return { status: 200, body: { success: true, countries } };
}

async function handleListaEstados(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  const countryId = data.countryId ? parseInt(data.countryId, 10) : 0;
  if (countryId <= 0) apiError('countryId obrigatório');
  const { cookieHeader, csrf } = prepareAuth(cookies);

  const result = await callWaze(wazeStatesEndpoint(region, countryId), cookieHeader, csrf, null, region);
  if (result.httpCode !== 200) {
    const cat = categorizeWazeError(result.httpCode, result.response, result.error);
    return {
      status: cat.category === 'unauthorized' ? 401 : 500,
      body: { success: false, error: cat.message, errorCategory: cat.category, httpCode: result.httpCode },
    };
  }
  let rd;
  try {
    rd = JSON.parse(result.response);
  } catch {
    apiError('Resposta inválida da API do Waze', 500);
  }
  const states = [];
  for (const s of rd.states || []) {
    if (Number(s.countryId) !== countryId) continue;
    states.push({ id: s.id ?? null, name: s.name || '', countryId: s.countryId ?? null });
  }
  states.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  return { status: 200, body: { success: true, states } };
}

// ─────────────────────────────────────────────────────────────────────────
// Roteamento
// ─────────────────────────────────────────────────────────────────────────

const ROUTES = {
  sessao: handleSessao,
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
  if (!handler) return { status: 404, body: { success: false, error: 'Endpoint não encontrado' } };
  try {
    return await handler(data || {}, ctx);
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: e.body };
    return { status: 500, body: { success: false, error: 'Erro interno' } };
  }
}
