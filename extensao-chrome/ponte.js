// ponte.js — content script que roda DENTRO do Waze Places.
//
// Substitui o `auto-login.js` da v0.0.3. A diferença é quem começa a conversa:
// antes a extensão empurrava um token guardado e recarregava a página; agora o
// APP pede quando precisa, e a ponte responde. Com isso o login funciona nos
// dois momentos que antes exigiam voltar ao WME e clicar:
//
//   • abrir places.wazebrasil.com direto, sem sessão
//   • a sessão do app vencer no meio do uso
//
// E some o `location.reload()`: o token chega pela mesma janela, o app o usa na
// hora, e ninguém vê a tela piscar.

const MARCA_APP = 'wazeplaces';       // pedidos vindos do app
const MARCA_EXT = 'wazeplaces-ext';   // respostas vindas daqui

function responder(dados) {
  // `window.location.origin` e não '*': a resposta carrega um token de sessão,
  // e não há motivo pra ela ser legível por um iframe de outra origem.
  window.postMessage({ source: MARCA_EXT, ...dados }, window.location.origin);
}

// 1) O app pediu sessão.
window.addEventListener('message', (ev) => {
  // `ev.source !== window` barra mensagem de iframe; a origem barra o resto.
  if (ev.source !== window || ev.origin !== window.location.origin) return;
  const d = ev.data;
  if (!d || d.source !== MARCA_APP || d.action !== 'precisa-de-sessao') return;

  // Responde AGORA que está trabalhando. É o que permite o app não punir quem
  // NÃO tem a extensão: sem este aviso ele mostra a tela de login em 350ms; com
  // ele, espera a ida ao Waze (~1,8s medidos) mostrando "Entrando pelo WME…".
  //
  // A espera do app começa quando este aviso chega a ele, e dura `espera` ms (o
  // app a manda na pergunta; o de antes não manda, e esperava 8 s): o login no
  // background tem esse prazo, contado DAQUI — antes de o aviso chegar (R9-1-02).
  const desde = Date.now();
  const espera = typeof d.espera === 'number' ? d.espera : null;
  responder({ action: 'aguarde' });

  // O token que o botão do WME deixou pra esta aba vai PRIMEIRO, sem ida ao
  // Waze (ver o `pendenteLido`, abaixo). Uma vez só: a próxima pergunta desta
  // página (a sessão caiu) é um login novo.
  pendenteLido.then(() => {
    const p = pendente;
    pendente = null;
    if (pendenteValido(p)) return responder({ action: 'sessao', token: p.token, conta: p.conta });
    autenticarPeloBackground(desde, espera);
  });
});

function autenticarPeloBackground(desde, espera) {
  // Contexto ÓRFÃO: quando a extensão se atualiza sozinha, o content script
  // antigo continua vivo na página mas o `chrome.runtime` dele morre, e
  // `sendMessage` LANÇA. Sem este try, o `aguarde` já tinha sido enviado e o app
  // esperava o prazo inteiro dele — medido: 8,45s de spinner antes da tela de
  // entrada ficar utilizável. Dizer "não consegui" na hora custa 0s, e a aba
  // volta a funcionar sozinha no próximo carregamento.
  try {
    chrome.runtime.sendMessage({ action: 'autenticar', desde, espera }, (r) => {
      // `lastError` acontece quando o service worker foi descarregado e não
      // respondeu. Silenciar sem responder deixaria o app esperando até o prazo
      // dele — melhor dizer "não consegui" e ele cai no login na hora.
      if (chrome.runtime.lastError || !r) return responder({ action: 'sem-sessao' });
      // A conta vai junto (o `testar-cookies` a devolve): o app sabe de quem é a
      // sessão na hora, e troca a fila de quem estava se for OUTRA conta.
      if (r.success && r.sessionToken) return responder({ action: 'sessao', token: r.sessionToken, conta: r.conta });
      // O portão do app recusou a conta: o motivo e o perfil vão junto, pra o
      // app mostrar o diálogo "Acesso restrito". Continua sendo `sem-sessao` de
      // propósito — o app de ANTES não conhece o `negado` e cai no login na hora.
      if (r.negado) {
        return responder({ action: 'sem-sessao', motivo: 'negado',
          negado: { error: r.error, errorKey: r.errorKey, errorVars: r.errorVars, profile: r.profile } });
      }
      responder({ action: 'sem-sessao', motivo: r.semLogin ? 'sem-login-wme' : 'erro' });
    });
  } catch (e) {
    responder({ action: 'sem-sessao', motivo: 'contexto-invalido' });
  }
}

// 2) O token que o BOTÃO do WME deixou pra esta aba (`abrirPlaces` no
//    background, que acabou de abri-la). Vai pela resposta ao
//    `precisa-de-sessao` — que o app sem sessão SEMPRE manda na abertura —,
//    junto da CONTA, pelo mesmo caminho do login pela ponte. Era escrito direto
//    no localStorage, e o app o lia como sessão GUARDADA: a conta que o
//    `testar-cookies` devolve se perdia (o app só a sabia com o perfil), e o
//    diário de sessões marcava `jaAtiva` no lugar de `token+:extensao`, justo
//    nas sessões que ele existe pra medir (auditoria da rodada 6, R6-1-10).
//
//    O botão VENCE a sessão guardada, como quando o token era escrito por cima:
//    com um pendente pra entregar, a sessão guardada sai — sem ela, o app
//    pergunta. É lido no `document_start`, antes dos scripts do app. Pendente
//    VELHO não vale (a aba não abriu na hora: entregá-lo depois seria entrar
//    com o login de outra hora, talvez de outra conta do WME), e o `remove`
//    garante que nenhuma outra aba o entregue de novo.
//
//    A pergunta do app ESPERA essa leitura (que leva milissegundos), com teto: o
//    `chrome.storage` que não responde (a extensão atualizada nesse instante, e a
//    ponte órfã) não pode segurar a pergunta — a lição do `contexto-invalido`.
const PENDENTE_VALE_MS = 2 * 60 * 1000;
const PENDENTE_LEITURA_MS = 1000;
let pendente = null;
let pendenteJaLido = false;
function pendenteValido(p) {
  const idade = p && typeof p === 'object' ? Date.now() - p.em : NaN;
  return !!p && typeof p.token === 'string' && p.token !== '' && idade >= 0 && idade < PENDENTE_VALE_MS;
}
const pendenteLido = new Promise((pronto) => {
  const fim = () => { if (!pendenteJaLido) { pendenteJaLido = true; pronto(); } };
  setTimeout(fim, PENDENTE_LEITURA_MS);
  try {
    chrome.storage.local.get(['token_pendente'], (res) => {
      const p = res && res.token_pendente;
      if (p) chrome.storage.local.remove('token_pendente');
      // Depois do teto, nada: a pergunta já foi respondida sem ele.
      if (!pendenteJaLido && pendenteValido(p)) {
        pendente = { token: p.token, conta: typeof p.conta === 'string' ? p.conta : null, em: p.em };
        // localStorage bloqueado (cookies de terceiros desligados, modo
        // restrito): o app também não lê sessão guardada, e pergunta igual.
        try { localStorage.removeItem('waze_session_token'); } catch (e) { /* idem */ }
      }
      fim();
    });
  } catch (e) {
    fim();   // contexto órfão: sem pendente, a pergunta vai ao background
  }
});
