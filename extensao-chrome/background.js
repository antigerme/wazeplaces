// background.js — coleta os cookies do Waze e troca por um token de sessão.
//
// Baseado no original do @daflash (v0.0.3). O que mudou e por quê está no
// README.md desta pasta; aqui ficam só as razões que precisam viver ao lado do
// código que elas explicam.

const MAX_TENTATIVAS = 4;
const ESPERAS_MS = [600, 1500, 2500, 3000];
const API_BASE = 'https://places.wazebrasil.com';

// O prazo TOTAL do login do botão ACESSAR (`abrirPlaces`), contado do TOQUE e
// valendo pra TODAS as tentativas (auditoria da rodada 8, R8-6-01 = R8-1-02).
// O painel desiste em 45 s (`ESPERA_DO_BOTAO_MS`, no content.js), e a conta de
// lá comparava UMA ida com o prazo do servidor pro Waze (30 s) — só que o login
// daqui se repete em toda falha passageira: até 4 idas, com 4,6 s de espera
// entre elas, 4 × 30 + 4,6 = 124,6 s no pior caso. O Waze que estourava os 30 s
// na 1ª ida e respondia na 2ª abria a aba DEPOIS do aviso de "a extensão não
// respondeu", e quem obedecia ao "tente de novo" abria a segunda sessão e a
// segunda aba (MEDIDO com os dois scripts de verdade num relógio virtual).
// Passado o prazo, nenhuma ida começa, a que está no ar é cancelada e a
// resposta é a falha, antes do teto do painel e com o aviso do que aconteceu.
// Maior que os 30 s do servidor: uma ida lenta que dá certo ainda cabe.
const PRAZO_DO_BOTAO_MS = 40000;

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
// e o app atende qualquer país onde o editor tenha permissão.
//
// `sinal` cancela a ida, e a leitura do corpo junto (ela também fica no ar).
async function trocarPorToken(cookiesTxt, sinal) {
  const resp = await fetch(`${API_BASE}/api/testar-cookies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies: cookiesTxt, region: 'row' }),
    signal: sinal,
  });
  return resp.json();
}

// `ate`: a hora (`Date.now()`) em que o login DESISTE — o prazo do botão (ver
// `PRAZO_DO_BOTAO_MS`). A ponte não passa prazo, e lá tudo segue como era.
async function autenticar(urlDaAba, ate = Infinity) {
  const controle = new AbortController();
  const teto = ate === Infinity ? null : setTimeout(() => controle.abort(), Math.max(0, ate - Date.now()));
  try {
    return await tentarAte(urlDaAba, ate, controle.signal);
  } finally {
    clearTimeout(teto);
  }
}

// As idas do login, até o prazo `ate`; o `sinal` cancela a que estiver no ar.
async function tentarAte(urlDaAba, ate, sinal) {
  // O relógio também conta, e não só o cancelamento: com o prazo já vencido na
  // chegada, o `setTimeout(…, 0)` só cancelaria depois de a 1ª ida ter saído.
  const venceu = () => sinal.aborted || Date.now() >= ate;
  // A falha da ida ANTERIOR é a que sai quando o prazo acaba no meio da
  // seguinte (o Waze que estourou os 30 s no servidor, por exemplo). Sem
  // nenhuma, quem não respondeu a tempo foi o próprio Waze Places.
  let ultima = null;
  const desistir = () => ultima
    || { success: false, errorKey: 'ext.conexao', error: 'Erro de conexão: o login passou do prazo.' };
  // Anota a falha desta ida (é ela que sai se não houver outra) e espera a
  // próxima — se ainda houver tentativa e a espera acabar DENTRO do prazo: a ida
  // que começaria depois dele não começa, e esperar pra então desistir só
  // seguraria o botão à toa.
  const outraIda = async (tentativa, falha) => {
    ultima = falha;
    const espera = ESPERAS_MS[tentativa - 1];
    if (tentativa >= MAX_TENTATIVAS || venceu() || Date.now() + espera >= ate) return false;
    await dormir(espera);
    return !venceu();
  };
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    if (venceu()) return desistir();
    try {
      // Re-coleta a cada tentativa: o Waze rotaciona o cookie de sessão, então
      // um valor de 3 segundos atrás pode já não valer.
      const cookies = await coletarCookies(urlDaAba);
      if (!cookies.length) {
        if (await outraIda(tentativa, { success: false, semLogin: true, errorKey: 'ext.semCookies', error: 'Nenhum cookie do Waze encontrado.' })) continue;
        return desistir();
      }

      const r = await trocarPorToken(formatarNetscape(cookies), sinal);
      // A resposta que chega DEPOIS do prazo não vale, nem a que deu certo: o
      // botão já voltou com o aviso da falha, e a aba aberta agora o desmentiria.
      if (venceu()) return desistir();
      if (r && r.success && r.sessionToken) return r;

      // O PORTÃO do app recusou esta conta (nível ou área — `isUserAllowed` no
      // servidor). É resposta DEFINITIVA: tentar de novo não muda o nível de
      // ninguém, e cada tentativa era uma ida ao /Session do Waze no nome da
      // pessoa (medido: 4 tentativas em 4,7 s, e a ponte ainda dizia só "erro").
      // O motivo e o perfil vão junto, pra o app mostrar o MESMO diálogo do
      // login por arquivo (auditoria de 2026-09-26).
      if (r && r.errorCategory === 'access_denied') {
        return { success: false, negado: true, error: r.error, errorKey: r.errorKey, errorVars: r.errorVars, profile: r.profile };
      }

      // 400 com cookie inválido/expirado é "não está logado no WME" — insistir
      // não muda nada e só atrasa a tela. Retry é pra falha de REDE.
      //
      // A CHAVE do servidor vai junto da frase, em toda falha: quem mostra é o
      // painel no WME, na língua dele, e a frase crua é sempre a portuguesa do
      // servidor — no cookie vencido, mandando "exportar os cookies" a quem usa
      // a extensão (auditoria da rodada 6, R66-2). As falhas daqui mesmo levam
      // chave própria (`ext.*`), pelo mesmo motivo.
      if (r && r.error && /expirad|inválid|invalid|csrf/i.test(String(r.error))) {
        return { success: false, semLogin: true, error: r.error, errorKey: r.errorKey, errorVars: r.errorVars };
      }
      if (await outraIda(tentativa, r || { success: false, errorKey: 'ext.semToken', error: 'A API não devolveu token.' })) continue;
      return desistir();
    } catch (e) {
      // A ida que o PRAZO cancelou não é falha de rede: sai a da ida anterior.
      if (venceu()) return desistir();
      if (await outraIda(tentativa, { success: false, errorKey: 'ext.conexao', error: 'Erro de conexão: ' + e.message })) continue;
      return desistir();
    }
  }
  return desistir();
}

chrome.runtime.onMessage.addListener((req, sender, responder) => {
  // Pedido vindo da PONTE (o app pediu sessão). Devolve o token pra ela, sem
  // abrir aba nem gravar nada: quem guarda é o próprio app, no localStorage
  // dele. Guardar aqui também era o que obrigava o `location.reload()`.
  if (req.action === 'autenticar') {
    autenticar(sender.tab ? sender.tab.url : null).then(responder);
    return true;
  }

  // Pedido vindo do botão no WME. Mesma autenticação; a diferença é que aqui
  // ainda não existe aba do app, então o token vai por `chrome.storage` e a
  // ponte o entrega quando o app da aba nova pede — com a CONTA, como no login
  // pela ponte, e com a HORA, porque pendente velho não se entrega (ver a ponte).
  //
  // O prazo do login (`PRAZO_DO_BOTAO_MS`) conta do TOQUE, que o painel manda
  // (`desde`), e não de quando a mensagem chegou: o service worker adormecido
  // leva um tempo pra acordar, e o teto do painel conta do toque. A mensagem que
  // chega depois do prazo nem vai ao Waze.
  if (req.action === 'abrirPlaces') {
    const desde = Number.isFinite(req.desde) ? Math.min(req.desde, Date.now()) : Date.now();
    autenticar(sender.tab ? sender.tab.url : null, desde + PRAZO_DO_BOTAO_MS).then((r) => {
      if (r && r.success && r.sessionToken) {
        const pendente = { token: r.sessionToken, conta: r.conta || null, em: Date.now() };
        chrome.storage.local.set({ token_pendente: pendente }, () => {
          chrome.tabs.create({ url: API_BASE + '/' });
          responder({ success: true });
        });
      } else {
        responder(r || { success: false, errorKey: 'ext.desconhecida', error: 'Falha desconhecida' });
      }
    });
    return true;
  }
});

// ── Quem instala com a aba do Places já aberta ───────────────────────────
// O beco sem saída que o owner mediu: o app pergunta à ponte UMA vez, no
// carregamento, com 350ms de janela — e o Chrome NÃO injeta content script numa
// aba que já estava aberta. Resultado: quem instala olhando pra tela de entrada
// ficava ali pra sempre. Recarregar a aba resolve os dois lados de uma vez: a
// ponte entra e o app pergunta de novo.
//
// NÃO PRECISA DE PERMISSÃO NOVA, e isso foi medido antes de escrever a linha:
// `chrome.tabs.query({url})` é autorizado pelo `host_permissions` que já
// existe, e `chrome.tabs.reload` não exige a permissão `tabs` (o
// `chrome.tabs.create` acima já provava isso). Permissão nova seria um
// impedimento REAL: o Chrome desativa a extensão de todo mundo até cada um
// reaprovar — o custo cairia em quem já usa, pra ajudar quem está chegando.
//
// Só no `install`. No `update` a aba aberta tem a ponte ÓRFÃ (o content script
// antigo continua na página com o `chrome.runtime` morto) e recarregar
// consertaria — mas atropelaria quem está triando no meio da fila. Pra esse
// caso a defesa é a de baixo, no ponte.js: falhar rápido em vez de pendurar.
const ALVO_PLACES = 'https://places.wazebrasil.com/*';

chrome.runtime.onInstalled.addListener((detalhes) => {
  if (!detalhes || detalhes.reason !== 'install') return;
  try {
    chrome.tabs.query({ url: [ALVO_PLACES] }, (abas) => {
      if (chrome.runtime.lastError) return;   // sem acesso: silêncio, não quebra
      (abas || []).forEach((aba) => {
        try { chrome.tabs.reload(aba.id); } catch (e) { /* aba morta no meio */ }
      });
    });
  } catch (e) { /* nunca derruba a instalação */ }
});
