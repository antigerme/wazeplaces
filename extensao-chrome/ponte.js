// ponte.js — content script que roda DENTRO do Waze Places.
//
// Substitui o `auto-login.js` da v0.0.3. A diferença é quem começa a conversa:
// antes a extensão empurrava um token guardado e recarregava a página; agora a
// APP pede quando precisa, e a ponte responde. Com isso o login funciona nos
// dois momentos que antes exigiam voltar ao WME e clicar:
//
//   • abrir places.wazebrasil.com direto, sem sessão
//   • a sessão da app vencer no meio do uso
//
// E some o `location.reload()`: o token chega pela mesma janela, a app o usa na
// hora, e ninguém vê a tela piscar.

const MARCA_APP = 'wazeplaces';       // pedidos vindos da app
const MARCA_EXT = 'wazeplaces-ext';   // respostas vindas daqui

function responder(dados) {
  // `window.location.origin` e não '*': a resposta carrega um token de sessão,
  // e não há motivo pra ela ser legível por um iframe de outra origem.
  window.postMessage({ source: MARCA_EXT, ...dados }, window.location.origin);
}

// 1) A app pediu sessão.
window.addEventListener('message', (ev) => {
  // `ev.source !== window` barra mensagem de iframe; a origem barra o resto.
  if (ev.source !== window || ev.origin !== window.location.origin) return;
  const d = ev.data;
  if (!d || d.source !== MARCA_APP || d.action !== 'precisa-de-sessao') return;

  // Responde AGORA que está trabalhando. É o que permite a app não punir quem
  // NÃO tem a extensão: sem este aviso ela mostra a tela de login em 350ms; com
  // ele, espera a ida ao Waze (~1,8s medidos) mostrando "Entrando pelo WME…".
  responder({ action: 'aguarde' });

  // Contexto ÓRFÃO: quando a extensão se atualiza sozinha, o content script
  // antigo continua vivo na página mas o `chrome.runtime` dele morre, e
  // `sendMessage` LANÇA. Sem este try, o `aguarde` já tinha sido enviado e a app
  // esperava o prazo inteiro dela — medido: 8,45s de spinner antes da tela de
  // entrada ficar utilizável. Dizer "não consegui" na hora custa 0s, e a aba
  // volta a funcionar sozinha no próximo carregamento.
  try {
    chrome.runtime.sendMessage({ action: 'autenticar' }, (r) => {
      // `lastError` acontece quando o service worker foi descarregado e não
      // respondeu. Silenciar sem responder deixaria a app esperando até o prazo
      // dela — melhor dizer "não consegui" e ela cai no login na hora.
      if (chrome.runtime.lastError || !r) return responder({ action: 'sem-sessao' });
      if (r.success && r.sessionToken) return responder({ action: 'sessao', token: r.sessionToken });
      responder({ action: 'sem-sessao', motivo: r.semLogin ? 'sem-login-wme' : 'erro' });
    });
  } catch (e) {
    responder({ action: 'sem-sessao', motivo: 'contexto-invalido' });
  }
});

// 2) Token deixado pelo botão do WME (a aba acabou de ser aberta por ele).
//    Entregue no `document_start`, antes de a app ler o localStorage — por isso
//    não precisa de reload. O `remove` evita entregar duas vezes.
chrome.storage.local.get(['token_pendente'], (res) => {
  if (!res || !res.token_pendente) return;
  const token = res.token_pendente;
  chrome.storage.local.remove('token_pendente');
  try {
    localStorage.setItem('waze_session_token', token);
  } catch (e) {
    // localStorage bloqueado (cookies de terceiros desligados, modo restrito):
    // manda pela ponte, que não depende de armazenamento.
    responder({ action: 'sessao', token });
  }
});
