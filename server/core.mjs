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
// De quanto em quanto tempo o prazo é reescrito no store. Não é o prazo: é a
// granularidade da renovação. Um dia limita a ~1 escrita por sessão por dia
// (o KV do Cloudflare aceita 1 escrita/s por chave, e a app faz 3 chamadas só
// ao abrir), e ainda deixa 20 dias de folga sobre o TTL de 21.
export const SESSION_REFRESH_AFTER = 86400; // 1 dia
// De quanto em quanto tempo os cookies rotacionados pelo Waze são regravados.
// Mais curto que o de cima porque aqui o atraso custa a validade da credencial,
// não só o prazo da nossa sessão. Ainda assim tem teto: uma chamada por swipe
// contra 1 escrita/s por chave no KV.
export const SESSION_COOKIE_REFRESH = 3600; // 1 hora
const MIN_RANK_WAZE = 2; // display L3+ (Waze é 0-indexed)

const wazeIssuesEndpoint = (r) => (WAZE_REGIONS[r] || WAZE_REGIONS.row) + '/Issues/Search/List';
const wazeMarkReadEndpoint = (r) => (WAZE_REGIONS[r] || WAZE_REGIONS.row) + '/Issues/Read';
const wazeFeaturesEndpoint = (r) => WAZE_FEATURES_REGIONS[r] || WAZE_FEATURES_REGIONS.row;
// A constante acima JÁ vem com `?ignoreWarnings=false&language=pt-BR` grudado.
// Quem precisa acrescentar parâmetro (a releitura por bbox) tem que partir da
// base SEM query — concatenar outro `?` faz o `language` virar
// `pt-BR?bbox=...` e o Waze responde 406. Medido: a mesma consulta com a URL
// certa devolve 200 e 11 locais, e nenhum header ou parâmetro extra tinha a
// ver com o erro (sondei 5 variantes antes de olhar a URL).
const wazeFeaturesBase = (r) => wazeFeaturesEndpoint(r).split('?')[0];
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

// A chave que cifra de verdade NÃO é o Secret: é HKDF(Secret, segredoDoCliente).
//
// O Secret sozinho não abre nada, porque falta o segredo — que vive no aparelho
// do editor (o `sessionToken`) e chega a cada requisição. Consequência prática,
// e é ela que justifica o custo: um dump do KV mais o `ENCRYPTION_KEY` não
// devolve cookie nenhum. Vale pra vazamento, pra token de leitura roubado e pra
// pedido judicial — o que está guardado não presta sem o lado do cliente.
//
// O que isto NÃO protege, e não adianta fingir: quem publica código no Worker
// pode registrar o segredo quando ele chega. A diferença é o alcance — deixa de
// ser "todos os editores, inclusive os de ontem" e vira "quem usar a app
// enquanto esse código estiver no ar", com rastro em `wrangler deployments`.
//
// Depende de UMA coisa: o segredo nunca pode entrar em log. Hoje o token viaja
// só no CORPO do POST (nunca em URL, query ou header) e o core não tem nenhum
// `console`. O QR do pareamento usa FRAGMENTO (`/#pair=`), que o navegador não
// manda pro servidor — antes usava query, e aí o segredo caía no log de acesso.
// Mexeu em qualquer um desses dois pontos? A garantia caiu junto.
async function derivarChave(keyBytes, segredo) {
  const ikm = await crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(String(segredo)),
    info: new TextEncoder().encode('wazeplaces/v1'),
  }, ikm, 256);
  return new Uint8Array(bits);
}

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

// `ctx` (opcional) = { data, sessions, cookies } — o que permite regravar a
// sessão com os cookies que o Waze rotacionou. Fica AQUI, e não em cada
// handler, porque o modo de falha deste repo é "o próximo handler nasce sem":
// são 7 pontos de chamada hoje e o esquecimento seria silencioso — a sessão
// só azedaria semanas depois, longe de quem escreveu o código.
async function callWaze(url, cookieHeader, csrfToken, postData, region, ctx = null) {
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
    // O Waze ROTACIONA o cookie de sessão a cada resposta — MEDIDO com cookies
    // reais: 3 chamadas ao `Session` devolveram 3 valores distintos de
    // `_web_session` (o `_csrf_token` não muda). A app guardava o retrato do
    // login e nunca mais o atualizava, então o retrato azedava sozinho e o
    // editor era deslogado "sem ter pedido pra sair" — o relato do owner.
    //
    // Devolver os cookies novos aqui é o que permite reescrever a sessão. Quem
    // decide se vale a escrita é o chamador (ver `atualizarCookiesDaSessao`):
    // o KV aceita 1 escrita/s por chave e há uma chamada por swipe.
    const setCookie = lerSetCookie(res);
    // Melhor-esforço e sem `await` no caminho crítico do editor? NÃO: em
    // Workers, promessa solta depois do return é cancelada quando a requisição
    // termina. Custa uma leitura e (no máximo 1x/h) uma escrita no KV.
    if (ctx && ctx.sessions && ctx.data && ctx.data.sessionToken && setCookie.length) {
      const atualizado = aplicarCookiesRotacionados(ctx.cookies, setCookie);
      if (atualizado) await ctx.sessions.refreshCookies(ctx.data.sessionToken, atualizado);
    }
    return { httpCode: res.status, response, error: '', setCookie };
  } catch (e) {
    return { httpCode: 0, response: '', error: e && e.message ? e.message : 'fetch failed' };
  }
}

// `headers.get('set-cookie')` JUNTA todos num string só, separados por vírgula —
// e valor de cookie pode conter vírgula (Expires=Wed, 01 Jan...), então o split
// corrompe. `getSetCookie()` é o único jeito correto; onde não existir, melhor
// devolver nada do que devolver lixo.
function lerSetCookie(res) {
  try {
    if (res && res.headers && typeof res.headers.getSetCookie === 'function') {
      return res.headers.getSetCookie();
    }
  } catch {}
  return [];
}

// Aplica os cookies rotacionados por cima dos guardados e devolve o conteúdo
// novo — ou null se nada mudou (aí não há por que reescrever a sessão).
//
// Só troca o VALOR de cookie que já existia: o Waze manda `Set-Cookie` de
// coisas que não interessam (analytics), e engordar o header a cada chamada
// levaria ao HTTP 400 por header gigante que o `filterWazeCookies` já evita.
export function aplicarCookiesRotacionados(conteudoAtual, setCookie) {
  if (!setCookie || !setCookie.length) return null;
  const novos = new Map();
  for (const linha of setCookie) {
    const igual = linha.indexOf('=');
    if (igual <= 0) continue;
    const nome = linha.slice(0, igual).trim();
    const valor = linha.slice(igual + 1).split(';')[0].trim();
    if (nome && valor) novos.set(nome, valor);
  }
  if (!novos.size) return null;

  let mudou = false;
  const linhas = String(conteudoAtual).split('\n').map((linha) => {
    if (!linha.trim() || linha.startsWith('#')) return linha;
    const p = linha.split('\t');
    if (p.length < 7) return linha;
    const nome = p[5];
    if (!novos.has(nome)) return linha;
    const valor = novos.get(nome);
    if (p[6].trim() === valor) return linha;
    p[6] = valor;
    mudou = true;
    return p.join('\t');
  });
  return mudou ? linhas.join('\n') : null;
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
// O QR não é digitado, então o segredo dele pode ser longo de graça — e precisa
// ser: a chave do blob sai DELE (ver `derivarChave`), e 6 caracteres são ~30
// bits, que se quebra offline em segundos. 20 símbolos do mesmo alfabeto dão
// 100 bits, o que põe a força bruta fora de alcance.
//
// MESMO alfabeto de propósito: assim `normalizePairCode` e a validação servem
// aos dois, e não existe um segundo formato pra manter em sincronia.
const PAIR_SECRET_LEN = 20;

function randomPairCode(len = PAIR_CODE_LEN) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
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
    // Exposto pra quem precisa de cache curto próprio (a releitura do local
    // antes de excluir foto). Quem usar isto escolhe prefixo próprio na chave.
    store,
    async createSession(cookiesContent) {
      const token = randomToken();
      const hash = await sha256hex(token);
      const blob = await encryptCookies(cookiesContent, await derivarChave(keyBytes, token));
      // Já nasce com carimbo: sem ele a PRIMEIRA leitura de toda sessão nova
      // dispararia uma renovação imediata — uma escrita a mais no KV por login,
      // à toa.
      await store.put(hash, Math.floor(Date.now() / 1000) + '|' + blob, SESSION_TTL);
      return token;
    },
    // Renova o prazo A CADA USO — janela deslizante, não prazo fixo.
    //
    // O adaptador de arquivo da VM sempre fez isso (mtime + touch). O KV do
    // Cloudflare NÃO: `expirationTtl` conta do `put`, e o `get` não estende
    // nada. Resultado medido com o core de verdade e um KV simulado: editor
    // usando a app TODO DIA era deslogado no dia 21, com ZERO escritas no KV
    // no período. A validade contava do login, não do último uso — e o
    // CLAUDE.md descrevia os dois adaptadores como se fossem equivalentes.
    //
    // O carimbo vai no VALOR, no mesmo formato que `createPairing` já usa
    // (`ts|blob`), porque o KV não sabe dizer quanto falta do TTL. `|` é seguro
    // como separador: base64 não o produz.
    //
    // Só reescreve depois de SESSION_REFRESH_AFTER, e isso não é economia à
    // toa: o KV limita 1 escrita por segundo por chave, e renovar a cada
    // chamada (são 3 só ao abrir a app) esbarraria nesse teto — trocaria um
    // logout por outro.
    async loadSession(token) {
      if (!token) return null;
      const hash = await sha256hex(token);
      const raw = await store.get(hash);
      if (!raw) return null;

      // Formato único: `carimbo|blob`. Valor sem carimbo é lixo (formato de
      // antes desta versão) e não vale a pena carregar compatibilidade — a app
      // ainda está em dev/testes, não há sessão de produção pra preservar.
      const sep = raw.indexOf('|');
      const carimbo = sep > 0 ? parseInt(raw.slice(0, sep), 10) : NaN;
      if (!Number.isFinite(carimbo)) return null;
      const blob = raw.slice(sep + 1);

      const cookies = await decryptCookies(blob, await derivarChave(keyBytes, token));
      if (!cookies) return null;

      const agora = Math.floor(Date.now() / 1000);
      if (agora - carimbo >= SESSION_REFRESH_AFTER) {
        // Renovar é melhor-esforço: se o KV recusar (limite de escrita, blip),
        // a sessão segue valendo com o prazo antigo. Deixar isto lançar
        // transformaria uma falha de renovação em 401 — exatamente o defeito
        // que esta função existe pra corrigir.
        try {
          await store.put(hash, agora + '|' + blob, SESSION_TTL);
        } catch (e) {
          // silêncio proposital: nada aqui deve derrubar a sessão
        }
      }
      return cookies;
    },
    async destroySession(token) {
      if (!token) return;
      const hash = await sha256hex(token);
      await store.delete(hash);
    },

    // Reescreve a sessão com os cookies que o Waze rotacionou.
    //
    // MEDIDO com cookies reais: o Waze devolve `Set-Cookie: _web_session=…` em
    // TODA resposta, com valor novo a cada vez (3 chamadas → 3 valores; o
    // `_csrf_token` não muda). Guardar o retrato do login e nunca atualizá-lo
    // faz o retrato azedar sozinho — é o "expira sem eu ter pedido pra sair".
    //
    // Estrangulado no tempo de propósito: há uma chamada ao Waze por swipe, e o
    // KV aceita 1 escrita/s por chave. Sem o teto, um editor em ritmo trocaria
    // o logout por estouro de limite de escrita — outro logout, com outro nome.
    // Uma hora é folgado pra qualquer janela de tolerância plausível e mantém a
    // escrita em no máximo 1/h por sessão ativa.
    //
    // Nunca lança: falha em renovar não pode derrubar a requisição do editor.
    async refreshCookies(token, conteudoNovo) {
      if (!token || !conteudoNovo) return false;
      try {
        const hash = await sha256hex(token);
        const raw = await store.get(hash);
        if (!raw) return false;
        const sep = raw.indexOf('|');
        const carimbo = sep > 0 ? parseInt(raw.slice(0, sep), 10) : NaN;
        const agora = Math.floor(Date.now() / 1000);
        if (Number.isFinite(carimbo) && agora - carimbo < SESSION_COOKIE_REFRESH) return false;
        const blob = await encryptCookies(conteudoNovo, await derivarChave(keyBytes, token));
        await store.put(hash, agora + '|' + blob, SESSION_TTL);
        return true;
      } catch {
        return false;
      }
    },

    // Guarda os cookies (JÁ criptografados) sob um código curto e efêmero.
    // A validade vai DENTRO do valor, e não só no TTL do store, porque os dois
    // adaptadores tratam TTL de formas diferentes: o KV expira sozinho, mas o
    // store de arquivo da VM ignora o TTL do put (usa mtime + SESSION_TTL, que
    // são 21 dias). Sem o carimbo interno, um código de pareamento sobreviveria
    // três semanas na VM. Com ele, o prazo vale igual nos dois.
    //
    // DOIS tamanhos de segredo, e o padrão é o longo. O curto (digitável) só
    // nasce quando alguém pede — se ele existisse SEMPRE, um dump do KV teria
    // sempre a cópia de 30 bits ao lado da de 100, e a força do QR seria
    // decorativa. É por isso que o botão "não tenho câmera" cria um registro
    // novo em vez de revelar um que já estava lá.
    async createPairing(cookiesContent, { comCodigo = false } = {}) {
      const segredo = randomPairCode(comCodigo ? PAIR_CODE_LEN : PAIR_SECRET_LEN);
      const hash = await sha256hex('pair:' + segredo);
      const exp = Math.floor(Date.now() / 1000) + PAIR_TTL;
      const blob = await encryptCookies(cookiesContent, await derivarChave(keyBytes, segredo));
      await store.put(hash, exp + '|' + blob, PAIR_TTL);
      return { code: segredo, curto: comCodigo, expiresIn: PAIR_TTL };
    },

    // Uso único: apaga ANTES de validar a expiração, pra um código não poder
    // ser tentado duas vezes nem virar oráculo de "existe mas venceu".
    async claimPairing(code) {
      const limpo = normalizePairCode(code);
      // Os dois tamanhos são válidos: 6 é o código digitado, 20 é o do QR.
      // Qualquer outro comprimento sai aqui sem tocar no store.
      if (limpo.length !== PAIR_CODE_LEN && limpo.length !== PAIR_SECRET_LEN) return null;
      const hash = await sha256hex('pair:' + limpo);
      const raw = await store.get(hash);
      if (!raw) return null;
      await store.delete(hash);
      const sep = raw.indexOf('|');
      if (sep < 0) return null;
      const exp = parseInt(raw.slice(0, sep), 10);
      if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
      return decryptCookies(raw.slice(sep + 1), await derivarChave(keyBytes, limpo));
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

// A coordenada que REPRESENTA uma geometria, como [lat, lon].
//
// Mesma fonte da distância — o centróide — e isso é obrigatório, não estético:
// se o marcador do mapa usasse o primeiro vértice e a frase usasse o centróide,
// o card diria "moveu 84 m" com dois marcadores no mesmo lugar. Duas contas pra
// mesma pergunta é como a tela passa a se contradizer sem ninguém notar.
export const pontoDeGeometria = (geom) => {
  const par = centroide(geom) || extractLonLatDeep(geom);
  return par ? [par[1], par[0]] : null;   // GeoJSON é [lon, lat]; aqui sai [lat, lon]
};

// O que o mini-mapa do card precisa saber, num objeto só.
//
// Existe porque a evidência que falta pro editor decidir é ESPACIAL: "moveu
// 36 m" e "entrada -15.88749, -52.26094" são exatos e injulgáveis. Com as
// posições em mãos, o card desenha — e desenhar é o que transforma o pedido
// em algo que se decide num olhar, que é a promessa do gesto.
//
// Vem null quando não há coordenada nenhuma: o card então não monta o slide,
// em vez de desenhar um mapa do oceano no ponto (0, 0).
export const montarMapa = (venue, changes) => {
  const pontoDoEEP = (item) => {
    const c = item && item.point && item.point.coordinates;
    return Array.isArray(c) && typeof c[0] === 'number' ? [c[1], c[0]] : null;
  };
  const centro = pontoDeGeometria(venue && venue.geometry);
  const geo = (changes || []).find((c) => c.field === 'geometry');
  const eep = (changes || []).find((c) => c.field === 'entryExitPoints');

  const entradas = [];
  const vistos = new Set();
  const pushEntrada = (item, estado) => {
    const ll = pontoDoEEP(item);
    if (!ll) return;
    // Ponto que entra E sai é o MESMO ponto renomeado/reposicionado; a chave
    // inclui o estado pra não colapsar os dois lados de um movimento.
    const chave = `${estado}|${ll[0].toFixed(6)},${ll[1].toFixed(6)}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    // Distância até o local. É ELA que se julga — a coordenada é exata e não
    // diz nada. Medido na fila de 12 países: há pedidos propondo entrada a
    // dezenas de quilômetros do próprio local, e em coordenada crua isso passa
    // batido. Mesma lição do `geometry`, que já virou "moveu 36 m".
    const d = centro ? distanciaEntrePontos(centro, ll) : null;
    entradas.push({ ll, estado, nome: (item && item.name) || null,
                    distM: Number.isFinite(d) ? d : null });
  };
  // Os que já existem no mapa hoje. Se o pedido mexe neles, o delta abaixo
  // repõe os mesmos como "saindo" — e é justamente o par que conta a história.
  if (!eep) for (const it of (venue && venue.entryExitPoints) || []) pushEntrada(it, 'atual');
  else {
    for (const it of (venue && venue.entryExitPoints) || []) pushEntrada(it, 'saindo');
    for (const it of (eep.delta && eep.delta.add) || []) pushEntrada(it, 'nova');
  }

  // Ponto que sai e entra na MESMA coordenada não se moveu: foi renomeado. Dois
  // marcadores no mesmo pixel viram um borrão que sugere movimento onde não
  // houve — evidência errada é pior que evidência nenhuma. Fica só o proposto.
  // Medido: acontece de verdade (o "Entrada Av. José Salomé Rodrigues" da fila
  // real ganhou nome sem sair do lugar).
  const chaveLL = (e) => `${e.ll[0].toFixed(6)},${e.ll[1].toFixed(6)}`;
  const novas = new Set(entradas.filter((e) => e.estado === 'nova').map(chaveLL));
  const limpas = entradas.filter((e) => !(e.estado === 'saindo' && novas.has(chaveLL(e))));

  const proposto = geo && geo.pontos ? geo.pontos.para : null;
  if (!centro && !proposto && limpas.length === 0) return null;
  return {
    centro,
    proposto: proposto && centro && proposto[0] === centro[0] && proposto[1] === centro[1] ? null : proposto,
    movidoM: geo && Number.isFinite(geo.movedM) ? geo.movedM : null,
    entradas: limpas,
  };
};

// Distância entre dois [lat, lon], em metros. Equiretangular: a menos de 1 km
// o erro é irrelevante e não puxa trigonometria cara — a mesma conta que
// `distanciaEntreGeometrias` já usa, agora com nome próprio porque passou a ter
// dois usuários.
export const distanciaEntrePontos = (a, b) => {
  if (!a || !b) return null;
  const dLat = (b[0] - a[0]) * 111320;
  const dLon = (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
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

// Igualdade PROFUNDA de dois valores crus do Waze.
//
// Existe porque `ur.changedVenue` não é um diff: é o local inteiro com os
// valores propostos, então campos que ninguém tocou vêm junto carregando o
// valor ATUAL. Sem isto o card monta uma linha dizendo "mudou" e mostra a mesma
// coisa dos dois lados — medido na fila real: `BR-060 → BR-060` (Posto Décio),
// `Brickell Avenue → Brickell Avenue`, e um `entryExitPoints` que ainda por
// cima vazava JSON cru, porque duas listas idênticas não produzem delta e a
// linha caía no `formatValue`.
//
// A comparação é do valor CRU, e isso NÃO é preciosismo: por texto formatado
// ela esconderia mudança de verdade. `formatGeometry` imprime o primeiro
// vértice + a contagem, e a distância é medida do centroide — medido na mesma
// fila, um polígono do Condomínio Guaianás andou 84 METROS mantendo o primeiro
// vértice e a contagem, ou seja, formatando IGUAL nos dois lados. Comparar o
// que aparece na tela apagaria essa linha.
//
// `JSON.stringify` não serve: a ordem das chaves de dois objetos distintos não
// é garantida, e um falso "diferente" traz a linha inútil de volta.
export const mesmoValor = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => mesmoValor(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && mesmoValor(a[k], b[k]));
};

// Diferença entre dois OBJETOS simples, folha a folha.
//
// O `formatValue` cai em `JSON.stringify` pra objeto que não é lista, e o
// CLAUDE.md registra isso como "feio, nunca invisível" — a escolha certa contra
// sumir com a informação, mas ainda assim JSON cru na cara de quem tria. Medido
// na fila real: `categoryAttributes` de um eletroposto mostrava o objeto inteiro
// pra dizer que a rede mudou de "Porsche Smart Mobility GmbH" pra "Ponto de
// Carga". A informação estava lá, ilegível.
//
// Achatando em caminhos de folha dá pra mostrar SÓ o que mudou, que é o mesmo
// desenho já usado em campo de lista. Continua sem esconder nada: se o achatar
// falhar ou não houver folha diferente, quem chama mantém o fallback antigo.
//
// Profundidade e quantidade têm teto porque isto alimenta um card de celular —
// um objeto grande viraria uma lista de rolagem infinita, e o editor perderia o
// que interessa no meio.
const OBJ_DIFF_PROFUNDIDADE = 4;
const OBJ_DIFF_MAX_LINHAS = 12;

const achatarObjeto = (o, prefixo = '', prof = 0, saida = {}) => {
  if (prof >= OBJ_DIFF_PROFUNDIDADE || o === null || typeof o !== 'object' || Array.isArray(o)) {
    saida[prefixo] = o;
    return saida;
  }
  const chaves = Object.keys(o);
  if (chaves.length === 0) saida[prefixo] = o;
  for (const k of chaves) achatarObjeto(o[k], prefixo ? `${prefixo}.${k}` : k, prof + 1, saida);
  return saida;
};

export const diffDeObjeto = (antes, depois) => {
  const simples = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!simples(antes) || !simples(depois)) return null;
  const a = achatarObjeto(antes);
  const b = achatarObjeto(depois);
  const linhas = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (mesmoValor(a[k] ?? null, b[k] ?? null)) continue;
    const linha = { caminho: k, de: a[k] ?? null, para: b[k] ?? null };
    // Folha que é LISTA ganha o mesmo tratamento do campo de lista de topo:
    // o que entrou e o que saiu, não as duas listas inteiras. Sem isto a folha
    // `chargingPorts` de um eletroposto imprimia dois blocos de JSON lado a
    // lado — a informação estava lá e ninguém lia. O `diffDeLista` também
    // resolve o caso de nascer do nada (null → lista).
    const delta = diffDeLista(linha.de, linha.para);
    if (delta) linha.delta = delta;
    linhas.push(linha);
    if (linhas.length > OBJ_DIFF_MAX_LINHAS) return null; // grande demais: melhor o fallback
  }
  return linhas.length ? linhas : null;
};

// O que ENTROU e o que SAIU de um campo de lista. Mostrar as duas listas
// inteiras obriga o editor a fazer o diff com o olho — medido no dado real:
// `services` troca 1 item entre 5, `categories` ganha 1 entre 2. Um app
// profissional mostra a diferença, não o antes-e-depois cru.
// Devolve valores CRUS (enums do Waze); quem traduz é o frontend.
export const diffDeLista = (antes, depois) => {
  // Campo que NASCE (null → [...]) também é diff de lista: é tudo adição. Sem
  // isto o par caía no formatValue e o card mostrava JSON cru — medido na fila
  // real com `openingHours` e `entryExitPoints`, que costumam vir de nada.
  if (antes == null && Array.isArray(depois)) antes = [];
  if (depois == null && Array.isArray(antes)) depois = [];
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
    const { code, curto, expiresIn } = await sessions.createPairing(cookies, { comCodigo: !!(data && data.comCodigo) });
    return { status: 200, body: { success: true, code, curto, expiresIn } };
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

  const result = await callWaze(wazeSessionEndpoint(region), cookieHeaderFrom(cookies), csrf, null, region, { data, sessions, cookies });
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
      // types SEMPRE null pro Waze, e o corte fino é nosso (`purFiltrado`).
      //
      // O comentário antigo culpava o "array parcial" pelo HTTP 406 e estava
      // errado: medido contra o Waze real, `[1,5]` devolve 200 com 151 pedidos
      // e `['VENUE','IMAGE']` devolve 406 — o que ele recusa é o TIPO do valor,
      // porque a lista é de NÚMEROS (ver PUR_TIPOS). Mandar server-side é,
      // portanto, possível; não fazemos porque o filtro do Waze seleciona o
      // VENUE e devolve todos os pedidos dele, então o corte por PUR
      // continuaria aqui de qualquer jeito — e um filtro que não filtra tudo
      // sozinho é o tipo de meia-verdade que faz o contador mentir.
      types: null,
      orderBy: 'SORTING_UPDATE_TIME_DESC',
    },
  };

  const result = await callWaze(wazeIssuesEndpoint(region), cookieHeader, csrf, payload, region, { data, sessions, cookies });
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

// Os 7 tipos de PUR que o WME oferece no filtro "Tipos de Atualização", com o
// número que o Waze usa no fio (`venueUpdateRequestsFilter.types`). Os números
// saíram do bundle do WME v2.361; a classificação foi MEDIDA contra o Waze real
// — uma chamada de leitura por número, e o que voltou em cada uma.
//
// Cuidado com a leitura desses números: **o filtro do Waze é por VENUE, não por
// PUR** — a mesma armadilha do `isRead` (gotcha #21). Pedir só DETAILS_UPDATE
// devolve o LOCAL que tem uma atualização, e com ele TODOS os pedidos dele,
// inclusive marcados e fotos. Medido três vezes. Por isso o corte fino é nosso,
// aqui embaixo, e não do servidor.
export const PUR_TIPOS = Object.freeze({
  NEW_PLACE: 1, DETAILS_UPDATE: 2, DELETE_PLACE: 3, FLAGGED_PLACE: 4,
  NEW_PHOTO: 5, DELETE_PHOTO: 6, FLAGGED_PHOTO: 7,
});

// De que tipo é este pedido, na régua do WME. FONTE ÚNICA da classificação:
// o filtro usa isto, e nada mais deve reimplementar a mesma decisão.
//
// Não confundir com `updateTypeKey`, que é o RÓTULO DO CARD e responde outra
// pergunta: ele separa UPDATE de UPDATE_DETAILS (há ou não diff pra mostrar) e
// não separa reporte de local do de foto, porque quem faz isso no card é o
// `flagSubjectType`. Granularidades diferentes, propósitos diferentes.
//
// DELETE_PHOTO nunca foi observado: zero em 9 países e zero no teste que o
// owner criou de propósito com uma conta separada. Fica no mapa mesmo assim —
// se um dia aparecer, cai num tipo nomeado em vez de sumir calado do filtro.
export function purTypeDoUR(ur) {
  const tipo = ur?.type || '';
  if (tipo === 'VENUE') return 'NEW_PLACE';
  if (tipo === 'IMAGE') return 'NEW_PHOTO';
  const foto = ur?.flagSubjectType === 'IMAGE';
  switch (ur?.subType) {
    case 'UPDATE': return 'DETAILS_UPDATE';
    case 'DELETE': return foto ? 'DELETE_PHOTO' : 'DELETE_PLACE';
    case 'FLAG': return foto ? 'FLAGGED_PHOTO' : 'FLAGGED_PLACE';
    default: return 'UNKNOWN';
  }
}

// Este PUR deve ser DESCARTADO pelo filtro de tipos? (true = descarta)
//
// Tipo que a app não sabe nomear (`UNKNOWN`) NUNCA é descartado: o filtro é uma
// lista de PERMITIDOS, então um tipo novo que o Waze inventasse sumiria calado
// de toda fila — e "sumiu" é o defeito mais caro deste projeto, porque ninguém
// reporta o que não vê. Melhor aparecer com rótulo feio do que não aparecer.
function purFiltrado(ur, filterTypes) {
  if (filterTypes === null) return false;
  const t = purTypeDoUR(ur);
  return t !== 'UNKNOWN' && !filterTypes.includes(t);
}

// Expansão pura da resposta do Issues/Search/List em cards (um por PUR).
// Devolve { places, blocked }: `blocked` são PURs que passariam nos filtros de
// tipo/leitura mas cujo venue o usuário não tem permissão de editar.
// Exportada pra suite testar com fixtures de HAR real, sem rede.
export function buildPlacesFromSearch(rd, { filterTypes = null, unreadOnly = true } = {}) {
  const usersDict = {};
  // Guarda o objeto inteiro, não só o nome: o rank de quem PEDIU é sinal de
  // triagem (L1 anônimo × L5 editor) e vinha sendo jogado fora aqui.
  for (const u of rd?.users?.objects || []) usersDict[u.id] = u;
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
        if (purFiltrado(ur, filterTypes)) continue;
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
    // Só a foto JÁ APROVADA pode ser excluída pela lixeira do lightbox. A
    // pendente (a do ✨) ainda não está no mapa e o caminho dela é o ✕/✓ do
    // card — excluí-la pelo venue tiraria a imagem e deixaria o pedido órfão.
    // A lista vai por ID e não por índice: o carrossel reordena, o índice não
    // identifica nada, e apagar por posição é como se apaga a foto errada.
    const approvedImageIds = [];
    for (const img of venue.images || []) {
      if (!img || !img.id) continue;
      allImageUrls.push(WAZE_IMAGE_BASE + img.id);
      if (img.approved === true) approvedImageIds.push(img.id);
    }

    for (const ur of venue.venueUpdateRequests) {
      const creatorId = ur.createdBy ?? null;
      const creatorObj = creatorId ? usersDict[creatorId] : null;
      const creatorName = creatorObj ? creatorObj.userName : creatorId;
      // Rank CRU do Waze (0-indexed). Quem soma 1 pra exibir é o frontend —
      // regra sagrada do projeto, ver gotcha #15.
      const creatorRank = creatorObj && Number.isInteger(creatorObj.rank) ? creatorObj.rank : null;
      // De onde veio. Enum CRU, traduzido no frontend por card.source.<ENUM>.
      // O Waze tem 5 valores (lidos do bundle do WME v2.361): MOBILE_CLIENT,
      // WEB, MOBILE_WEB, REPORTING_AGENT e SOURCE_UNSPECIFIED — e este último
      // o próprio WME NÃO exibe (cai num Symbol("UNMAPPED_UPDATE_REQUEST_SOURCE")).
      // Descartar aqui é o que evita um selo dizendo "Source unspecified", que
      // não informa nada e ainda sai em inglês. Só o tipo REQUEST traz o campo:
      // VENUE (local novo) e IMAGE (foto nova) nunca têm — medido em 369 URs da
      // fila real e nos 3 endpoints que o WME usa (Search/List, Search/Map,
      // Features), 358 URs, zero ocorrências fora de REQUEST.
      const sourceCru = String(ur.source || '').trim();
      const source = sourceCru && sourceCru !== 'SOURCE_UNSPECIFIED' ? sourceCru : null;

      const reqType = ur.type || '';
      const reqSubType = ur.subType || '';
      // O filtro isRead que mandamos ao Waze (userPropertiesFilter) é POR VENUE:
      // o venue volta se QUALQUER PUR dele estiver não-lido. Sem este skip por
      // PUR, uma foto já lida re-vira card eternamente enquanto um PUR irmão
      // (ex.: REQUEST, gated e invisível na app) seguir não-lido — o place
      // "volta" sem o user ter como sair do loop. Confirmado via HAR (Batalhão
      // PMDF: IMAGE isRead:true + REQUEST isRead:false → venue retornava sempre).
      if (unreadOnly && ur.isRead === true) continue;
      if (purFiltrado(ur, filterTypes)) continue;
      const purType = purTypeDoUR(ur);

      let updateTypeStr = 'Desconhecido';
      let updateTypeKey = 'UNKNOWN';
      const changes = [];
      // Quantos campos vieram no pacote iguais ao valor atual. Distingue o
      // pedido que COMPARAMOS e não altera nada daquele que não trouxe nada
      // pra comparar — só no primeiro o card pode afirmar "nada a alterar".
      let camposSemMudanca = 0;
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
            // Campo que veio no pacote mas não mudou não vira linha. Conta,
            // porém: é a diferença entre "comparamos e nada muda" e "não veio
            // nada pra comparar", e as duas dizem coisas diferentes pro editor.
            if (mesmoValor(venue[k] ?? null, newValue ?? null)) {
              camposSemMudanca++;
              continue;
            }
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
              // As duas posições, pro card poder DESENHAR em vez de só narrar.
              // "Moveu 36 m" é honesto e injulgável: 36 metros pode ser acertar
              // a porta ou jogar o local dentro do rio, e o editor não tem como
              // saber qual. Medido na fila real, geometria é o campo mais
              // pedido (27 de 83) e o segundo é ponto de entrada (21) — juntos,
              // a maioria do que a caixa de mudanças mostra hoje em coordenada
              // crua. O texto FICA: é o que sobra quando o mapa não carrega.
              const pDe = pontoDeGeometria(venue[k] ?? null);
              const pPara = pontoDeGeometria(newValue);
              if (pDe || pPara) mudanca.pontos = { de: pDe, para: pPara };
            }
            // Campo de lista: o que entrou e o que saiu, em vez de duas listas
            // inteiras pro editor comparar de olho.
            const delta = diffDeLista(venue[k] ?? null, newValue);
            if (delta) mudanca.delta = delta;
            // Objeto simples (não lista): mostra as folhas que mudaram em vez do
            // JSON inteiro. Se não der, o `from`/`to` do fallback continua lá —
            // feio, nunca invisível.
            // `geometry` fica DE FORA: ela é objeto simples e cairia aqui,
            // sequestrando a linha que hoje diz "moveu 84 m · 9 → 10 pts" e
            // devolvendo o editor às coordenadas cruas que o gotcha do
            // `[object Object]` já tinha resolvido. Medido ao introduzir isto.
            else if (k !== 'geometry') {
              const objDelta = diffDeObjeto(venue[k] ?? null, newValue);
              if (objDelta) mudanca.objDelta = objDelta;
            }
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
        purType,
        // Evidência espacial pro mini-mapa. Vai em TODO tipo de pedido, não só
        // nos que mexem em geometria: "onde fica isto" é pergunta de todos —
        // um local novo no meio do rio e uma foto de um lugar que não existe se
        // reconhecem no mapa antes de qualquer texto.
        mapa: montarMapa(venue, changes),
        camposSemMudanca,
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
        creatorRank,
        source,
        imageUrl: allImageUrls.length ? allImageUrls[0] : null,
        imageUrls: allImageUrls,
        approvedImageIds,
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
  const result = await callWaze(wazeMarkReadEndpoint(region), cookieHeader, csrf, payload, region, { data, sessions, cookies });
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

// Rejeita OU aprova um pedido. Os dois caminhos são a MESMA chamada com a flag
// invertida — confirmado num HAR do owner aprovando uma foto no WME: mesma
// estrutura byte a byte, `approve: true`. A resposta ecoa o venue com a imagem
// já em `approved: true`, e o id da foto é o mesmo do updateRequest.
//
// Aprovar existe SÓ pra foto, e essa restrição vive no cliente — como a da
// lixeira, e pelo mesmo motivo do owner: quem quiser aprovar outra coisa já
// consegue pelo WME. O que a app promete é não OFERECER, não impedir.
async function handleValidarPlace(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  if (data.venueID === undefined || data.updateRequestID === undefined) apiError('Parâmetros incompletos', 400, 'srv.err.incompleteParams');

  // `=== true` e não coerção: sem isso, qualquer valor truthy que escapasse
  // (uma string "false", por exemplo) viraria uma aprovação.
  const aprovar = data.approve === true;

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
              attributes: { approve: aprovar, id: data.updateRequestID, venueID: data.venueID },
            },
          ],
        },
      ],
    },
  };
  const result = await callWaze(wazeFeaturesEndpoint(region), cookieHeader, csrf, payload, region, { data, sessions, cookies });
  const cat = categorizeWazeError(result.httpCode, result.response, result.error);

  if (result.httpCode === 200 && cat.category !== 'already_processed') {
    return {
      status: 200,
      body: {
        success: true,
        message: aprovar ? 'Pedido aprovado com sucesso' : 'Place rejeitado com sucesso',
        action: aprovar ? 'approved' : 'rejected',
      },
    };
  }
  return {
    status: cat.category === 'already_processed' || cat.category === 'not_found' ? 200 : 500,
    body: { success: false, error: cat.message, errorKey: cat.messageKey, errorVars: cat.messageVars, errorCategory: cat.category, httpCode: result.httpCode },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Excluir uma foto do local (a lixeira do lightbox)
// ═══════════════════════════════════════════════════════════════════════════
//
// É a PRIMEIRA escrita da app no mapa em si. Todas as outras (rejeitar, marcar
// lido) mexem no PEDIDO; esta mexe no LOCAL. Daí o cuidado extra.
//
// O contrato do Waze não tem "apague a foto X" — só "a lista de fotos agora é
// esta" (UPDATE_OBJECT com o array `images` inteiro), sem campo de revisão nem
// If-Match. Medido no HAR do owner: ele tinha 3 fotos, o POST mandou 2, e a
// terceira sumiu por AUSÊNCIA. Quem escreve por último ganha.
//
// Consequência: mandar a lista que o CELULAR tinha apagaria em silêncio a foto
// que outro editor subiu enquanto a pessoa decidia. Por isso RELEMOS o local
// (instrução do owner) e montamos a lista a partir do que o Waze diz AGORA,
// tirando só o id alvo. Isso é seguro nos três casos:
//   · outro somou uma foto  → ela vem na releitura e é preservada;
//   · outro tirou outra foto → ela já não vem, e continua fora;
//   · outro tirou ESTA foto  → o id não está lá, e devolvemos "já tratado".
// Como a exclusão é por ID e não por índice, o carrossel ter reordenado também
// não engana ninguém.

// Caixa mínima em volta do local pra reler. Não há leitura por ID: sondei
// `objects=venue.<id>`, `venues=`, `venueIds=`, `ids=` e `objects=` contra o
// Waze real e as CINCO devolvem 406; as variações que encolhem a resposta
// (`venueLevel=1`, sem `venueFilter`) trazem 200 mas SEM o local. Então bbox é
// o único caminho, e o que dá pra ajustar é o tamanho dela.
//
// O risco de apertar não é lentidão, é o local NÃO VIR — e aí a exclusão fica
// impossível com "local não encontrado". Por isso o valor é MEDIDO em locais
// reais de países diferentes, não deduzido: ver scratchpad/bbox-segura.mjs.
const RELEITURA_BBOX_GRAUS = 0.0002;

// Quanto tempo a releitura vale antes de a app ter que fazê-la de novo.
//
// A releitura é disparada quando o editor TOCA na lixeira, e usada quando ele
// CONFIRMA — assim os ~700ms dela cabem dentro do tempo em que ele lê o
// diálogo, e a espera depois do "Excluir" passa a ser só a escrita.
//
// Este número é o TAMANHO DA JANELA DA CORRIDA, e é por isso que ele é curto:
// se outro editor subir uma foto dentro dela, a nossa escrita a apaga em
// silêncio. Antes da releitura essa janela era a idade da fila — horas. Com 15s
// ela cobre a hesitação normal e nada além; quem parar pra pensar mais que isso
// paga a releitura de novo, que é o certo.
const RELEITURA_TTL = 15;
// Relê o local no Waze e guarda o resultado por RELEITURA_TTL.
//
// O cache fica no SERVIDOR de propósito. A alternativa óbvia — o cliente ler,
// guardar e mandar a lista na hora de excluir — entregaria a lista de fotos a
// quem está sendo verificado: bastaria mandar uma lista curta pra apagar tudo.
// Hoje o cliente só diz QUAL foto quer excluir; quem monta a lista é o
// servidor, a partir do que o Waze respondeu.
async function relerLocal(data, sessions, cookieHeader, csrf, region) {
  const venueID = data.venueID;
  const chave = 'reler_' + (await sha256hex(String(data.sessionToken) + '|' + venueID));
  try {
    const bruto = await sessions.store.get(chave);
    if (bruto) {
      const corte = bruto.indexOf('|');
      const ts = parseInt(bruto.slice(0, corte), 10);
      if (Number.isFinite(ts) && Math.floor(Date.now() / 1000) - ts <= RELEITURA_TTL) {
        return { venue: JSON.parse(bruto.slice(corte + 1)), doCache: true };
      }
    }
  } catch (e) { /* cache ilegível é cache ausente */ }

  const d = RELEITURA_BBOX_GRAUS;
  const lat = Number(data.lat), lon = Number(data.lon);
  const q = new URLSearchParams({
    bbox: [lon - d, lat - d, lon + d, lat + d].join(','),
    v: '2', apiV2: 'true', venueLevel: '4', venueFilter: '1,1,1,1', zoomLevel: '22',
  });
  const lida = await callWaze(`${wazeFeaturesBase(region)}?${q}`, cookieHeader, csrf, null, region, { data, sessions });
  if (lida.httpCode !== 200) return { erro: categorizeWazeError(lida.httpCode, lida.response, lida.error), httpCode: lida.httpCode };
  let atual;
  try { atual = JSON.parse(lida.response); } catch { return { erroParse: true }; }
  const venue = ((atual.venues && atual.venues.objects) || []).find((v) => v && v.id === venueID);
  if (!venue) return { semLocal: true };
  // Só o que a escrita precisa. Guardar o venue inteiro seria guardar geometria
  // e escrituração à toa.
  const enxuto = { id: venue.id, images: (venue.images || []).filter((i) => i && i.id) };
  try {
    await sessions.store.put(chave, Math.floor(Date.now() / 1000) + '|' + JSON.stringify(enxuto), RELEITURA_TTL);
  } catch (e) { /* sem cache a app só fica mais lenta */ }
  return { venue: enxuto, doCache: false };
}

async function handleExcluirFoto(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  const venueID = data.venueID;
  const imageID = data.imageID;
  if (!venueID || !imageID) apiError('Parâmetros incompletos', 400, 'srv.err.incompleteParams');
  const lat = Number(data.lat);
  const lon = Number(data.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    apiError('Parâmetros incompletos', 400, 'srv.err.incompleteParams');
  }

  const { cookieHeader, csrf } = prepareAuth(cookies);

  // SEM portão no servidor, e a razão é do owner: *"a pessoa já pode apagar a
  // foto se abrir o WME"*. O Waze valida `permissions` e `lockRank` na
  // gravação — quem não pode apagar por aqui também não consegue por lá. Então
  // isto nunca foi fronteira de segurança: era trava de PRODUTO, pra o recurso
  // não aparecer pra qualquer editor na NOSSA app. Trava de produto vive no
  // cliente (`podeExcluirFotoAqui`), onde já estava desde o começo.
  //
  // Eu tinha feito o contrário — portão no servidor com cache de perfil pra
  // deixá-lo rápido. Isto é melhor: em vez de acelerar uma chamada de 977ms
  // (medida, a mais lenta das três), ela SOME. Menos código, nada guardado a
  // mais, e mais rápido. Vale como lição: antes de otimizar uma etapa, vale
  // perguntar se ela precisa existir.

  // MODO PREPARAR: só aquece a releitura e volta. É o que o cliente dispara
  // quando o editor TOCA na lixeira, pra os ~700ms dela correrem enquanto ele
  // lê a pergunta do diálogo. Não escreve nada e não devolve a lista — quem
  // decide o que gravar continua sendo o servidor.
  if (data.action === 'preparar') {
    const prep = await relerLocal(data, sessions, cookieHeader, csrf, region);
    // Falha aqui é silenciosa de propósito: preparar é otimização. Se der
    // errado, o `excluir` faz a releitura na hora e a pessoa só espera mais.
    return { status: 200, body: { success: true, preparado: !prep.erro && !prep.semLocal && !prep.erroParse } };
  }

  // 2) RELEITURA. É o passo que impede de apagar junto a foto de outro editor.
  //    Vem do cache quando o cliente já pediu `preparar` ao abrir o diálogo —
  //    aí os ~700ms dela couberam no tempo de leitura da pergunta.
  const rel = await relerLocal(data, sessions, cookieHeader, csrf, region);
  if (rel.erro) {
    return {
      status: rel.erro.category === 'unauthorized' ? 401 : 500,
      body: { success: false, error: rel.erro.message, errorKey: rel.erro.messageKey, errorVars: rel.erro.messageVars, errorCategory: rel.erro.category, httpCode: rel.httpCode },
    };
  }
  if (rel.erroParse) apiError('Resposta inválida da API do Waze', 500, 'srv.err.badWazeResponse');
  if (rel.semLocal) apiError('Local não encontrado', 404, 'srv.err.venueGone');
  const venue = rel.venue;

  const imagensAgora = (venue.images || []).filter((i) => i && i.id);
  // Foto já não existe: outro editor chegou primeiro. Isso NÃO é erro — o
  // objetivo de quem tocou na lixeira foi cumprido (mesma lógica que o
  // `already_processed` de rejeitar/marcar lido).
  if (!imagensAgora.some((i) => i.id === imageID)) {
    return { status: 200, body: { success: true, jaExcluida: true, restantes: imagensAgora.map((i) => i.id) } };
  }
  const restantes = imagensAgora.filter((i) => i.id !== imageID);

  // 3) Escrita. Mesma forma do HAR do WME, byte a byte na estrutura.
  const payload = {
    actions: {
      name: 'DESCARTES_SERIALIZATION',
      _subActions: [
        {
          name: 'UPDATE_OBJECT',
          _objectType: 'venue',
          action: 'UPDATE',
          attributes: { id: venueID, images: restantes },
        },
      ],
    },
  };
  const result = await callWaze(wazeFeaturesEndpoint(region), cookieHeader, csrf, payload, region, { data, sessions, cookies });
  const cat = categorizeWazeError(result.httpCode, result.response, result.error);
  if (result.httpCode !== 200 || cat.category === 'already_processed') {
    return {
      status: cat.category === 'already_processed' || cat.category === 'not_found' ? 200 : 500,
      body: { success: false, error: cat.message, errorKey: cat.messageKey, errorVars: cat.messageVars, errorCategory: cat.category, httpCode: result.httpCode },
    };
  }

  // 4) Conferência pelo que o Waze DEVOLVEU — e o eco NÃO É PROVA, então isto
  //    é uma rede a mais, não a garantia.
  //
  //    Medido escrevendo de verdade no local de teste do owner: ao mandar de
  //    volta uma foto que tinha acabado de ser excluída, o Waze respondeu
  //    HTTP 200 com `status: 0, synced: true` e ECOOU as 5 fotos, inclusive a
  //    re-adicionada (com `date` novo e `scanned: false`) — e persistiu 4.
  //    Três leituras seguidas, mesmo `updatedOn`: a foto não voltou.
  //
  //    Pro nosso caso o eco e a realidade concordam (a exclusão persiste, e
  //    isso foi verificado por leitura independente: 5 → 4). Mas ele só
  //    detecta o Waze dizendo "continua aí"; não detecta o Waze dizendo "saiu"
  //    e guardando outra coisa. Vale como sinal barato, não como contrato.
  let confirmado = null;
  try {
    const eco = JSON.parse(result.response);
    const v = eco && eco.venues && eco.venues[venueID];
    if (v && Array.isArray(v.images)) confirmado = !v.images.some((i) => i && i.id === imageID);
  } catch { /* sem eco legível: seguimos com o 200, que já é a resposta do Waze */ }
  if (confirmado === false) {
    apiError('O Waze aceitou a chamada mas a foto continua no local', 500, 'srv.err.photoStillThere');
  }

  return { status: 200, body: { success: true, restantes: restantes.map((i) => i.id) } };
}

async function handlePerfil(data, { sessions }) {
  const cookies = await resolveCookies(data, sessions);
  const region = requireRegion(data);
  const { cookieHeader, csrf } = prepareAuth(cookies);

  const result = await callWaze(wazeSessionEndpoint(region), cookieHeader, csrf, null, region, { data, sessions, cookies });
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

  const result = await callWaze(wazeCountriesEndpoint(region), cookieHeader, csrf, null, region, { data, sessions, cookies });
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

  const result = await callWaze(wazeStatesEndpoint(region, countryId), cookieHeader, csrf, null, region, { data, sessions, cookies });
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
  'excluir-foto': handleExcluirFoto,
  perfil: handlePerfil,
  'lista-paises': handleListaPaises,
  'lista-estados': handleListaEstados,
};

/**
 * Executa um endpoint, pelo nome exato da rota.
 * ctx = { sessions }. Sempre resolve — nunca lança (ApiError vira resposta;
 * erro inesperado vira 500 genérico, sem vazar detalhe interno).
 */
export async function dispatch(name, data, ctx) {
  const handler = ROUTES[String(name || '')];
  if (!handler) return { status: 404, body: { success: false, error: 'Endpoint não encontrado', errorKey: 'srv.err.endpointNotFound' } };
  try {
    return await handler(data || {}, ctx);
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: e.body };
    return { status: 500, body: { success: false, error: 'Erro interno', errorKey: 'srv.err.internal' } };
  }
}
