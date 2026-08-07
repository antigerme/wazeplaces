// background.js — coleta os cookies do Waze e troca por um token de sessão.
//
// Baseado no original do @daflash (v0.0.3). O que mudou e por quê está no
// README.md desta pasta; aqui ficam só as razões que precisam viver ao lado do
// código que elas explicam.

const MAX_TENTATIVAS = 4;
const ESPERAS_MS = [600, 1500, 2500, 3000];
const API_BASE = 'https://places.wazebrasil.com';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const cookiesPorUrl = (url) =>
  new Promise((r) => chrome.cookies.getAll({ url }, (c) => r(c || [])));
const cookiesPorDominio = (domain) =>
  new Promise((r) => chrome.cookies.getAll({ domain }, (c) => r(c || [])));

// Busca por URL da aba E por domínio, e mescla. Uma só não basta: o WME grava
// cookies com path específico (`/pt-BR/editor`) que a busca por domínio pega,
// e outros de path `/` que a busca por URL pega. A por URL tem prioridade por
// ser a mais específica.
async function coletarCookies(urlDaAba) {
  const [porUrl, porDominio] = await Promise.all([
    urlDaAba ? cookiesPorUrl(urlDaAba) : Promise.resolve([]),
    cookiesPorDominio('waze.com'),
  ]);
  const mapa = new Map();
  for (const c of porDominio) mapa.set(c.name, c);
  for (const c of porUrl) mapa.set(c.name, c);
  return [...mapa.values()];
}

// Formato Netscape (o mesmo do cookies.txt), NÃO header string.
//
// A API aceita os dois, mas só no Netscape ela consegue ACOMPANHAR a rotação do
// cookie de sessão: o Waze devolve um `_web_session` novo a cada resposta e o
// servidor regrava a sessão com o valor novo. No formato header ele não tem
// como fazer isso, e a sessão azeda sozinha em alguns dias mesmo com o login do
// WME válido. (Descoberta do @daflash na v0.0.3 — mantida.)
function formatarNetscape(cookies) {
  const linhas = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    const dominio = c.hostOnly
      ? c.domain.replace(/^\./, '')
      : (c.domain.startsWith('.') ? c.domain : '.' + c.domain);
    linhas.push([
      dominio,
      c.hostOnly ? 'FALSE' : 'TRUE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      Math.floor(c.expirationDate || 0), // 0 = cookie de sessão
      c.name,
      c.value,
    ].join('\t'));
  }
  return linhas.join('\n');
}

// `region` é obrigatório na API. `countryId` NÃO é usado pelo `testar-cookies`
// — a v0.0.3 mandava 30 (Brasil) e o servidor ignorava. Sai daqui: mandar um
// país fixo num endpoint que não o lê só sugeria que a extensão é brasileira,
// e a app atende qualquer país onde o editor tenha permissão.
async function trocarPorToken(cookiesTxt) {
  const resp = await fetch(`${API_BASE}/api/testar-cookies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies: cookiesTxt, region: 'row' }),
  });
  return resp.json();
}

async function autenticar(urlDaAba) {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      // Re-coleta a cada tentativa: o Waze rotaciona o cookie de sessão, então
      // um valor de 3 segundos atrás pode já não valer.
      const cookies = await coletarCookies(urlDaAba);
      if (!cookies.length) {
        if (tentativa < MAX_TENTATIVAS) { await dormir(ESPERAS_MS[tentativa - 1]); continue; }
        return { success: false, semLogin: true, error: 'Nenhum cookie do Waze encontrado.' };
      }

      const r = await trocarPorToken(formatarNetscape(cookies));
      if (r && r.success && r.sessionToken) return r;

      // 400 com cookie inválido/expirado é "não está logado no WME" — insistir
      // não muda nada e só atrasa a tela. Retry é pra falha de REDE.
      if (r && r.error && /expirad|inválid|invalid|csrf/i.test(String(r.error))) {
        return { success: false, semLogin: true, error: r.error };
      }
      if (tentativa < MAX_TENTATIVAS) await dormir(ESPERAS_MS[tentativa - 1]);
      else return r || { success: false, error: 'A API não devolveu token.' };
    } catch (e) {
      if (tentativa < MAX_TENTATIVAS) await dormir(ESPERAS_MS[tentativa - 1]);
      else return { success: false, error: 'Erro de conexão: ' + e.message };
    }
  }
}

chrome.runtime.onMessage.addListener((req, sender, responder) => {
  // Pedido vindo da PONTE (a app pediu sessão). Devolve o token pra ela, sem
  // abrir aba nem gravar nada: quem guarda é a própria app, no localStorage
  // dela. Guardar aqui também era o que obrigava o `location.reload()`.
  if (req.action === 'autenticar') {
    autenticar(sender.tab ? sender.tab.url : null).then(responder);
    return true;
  }

  // Pedido vindo do botão no WME. Mesma autenticação; a diferença é que aqui
  // ainda não existe aba da app, então o token vai por `chrome.storage` e a
  // ponte o entrega assim que a aba abre.
  if (req.action === 'abrirPlaces') {
    autenticar(sender.tab ? sender.tab.url : null).then((r) => {
      if (r && r.success && r.sessionToken) {
        chrome.storage.local.set({ token_pendente: r.sessionToken }, () => {
          chrome.tabs.create({ url: API_BASE + '/' });
          responder({ success: true });
        });
      } else {
        responder(r || { success: false, error: 'Falha desconhecida' });
      }
    });
    return true;
  }
});
