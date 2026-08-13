# Waze Places Rapid Access — proposta de v0.2.0

Reescrita da extensão do [@daflash](https://www.waze.com/user/editor/daflash) para que o login
entre o **Waze Map Editor** e o **Waze Places** seja totalmente automático.

> **Esta pasta é uma PROPOSTA.** A extensão é dele, publicada na Chrome Web Store com a chave
> dele. Nada aqui é publicado por nós — o código está no repositório para ele revisar, testar e
> publicar se concordar.

## O que a v0.0.3 já fazia (e que quase ninguém sabe)

Ela **já** lia os cookies (`permissions: ["cookies"]`), formatava em Netscape, chamava
`/api/testar-cookies` e injetava o `sessionToken` no `localStorage` do site. O botão "ACESSAR" no
WME fazia o login inteiro — não era só um atalho.

E o comentário dela sobre o formato Netscape é a razão certa, encontrada por ele sozinho:

> *"A API aceita os dois, mas só no formato Netscape ela consegue ACOMPANHAR a rotação do cookie
> de sessão: o Waze devolve um `_web_session` novo a cada resposta."*

Isso está mantido.

## O que faltava

1. **Só agia a partir do WME.** Abrir `places.wazebrasil.com` direto não acionava nada — o
   `auto-login.js` rodava, mas só entregava um token se ele já estivesse guardado, o que só
   acontecia logo depois do clique no botão.
2. **Não renovava.** Sessão da app vencida obrigava a voltar ao WME e clicar de novo.

## O que mudou

| | v0.0.3 | v0.1.0 |
|---|---|---|
| quem começa a conversa | a extensão empurra | **a app pede** (`postMessage`) |
| abrir o site direto | tela de login | **entra sozinho** |
| sessão vencida | volta ao WME e clica | **renova sem sair da fila** |
| `location.reload()` | sim, a tela piscava | **não** |
| `countryId: 30` | enviado | **removido** — o `testar-cookies` nunca leu |
| nome da mensagem | `getCookies` | `abrirPlaces` (botão) e `autenticar` (ponte) |
| `auto-login.js` | injeta e recarrega | vira **`ponte.js`** |

Permissões: **as mesmas**. Nenhum acesso novo é pedido.

## O protocolo

A app manda, na própria janela:

```js
window.postMessage({ source: 'wazeplaces', action: 'precisa-de-sessao' }, location.origin);
```

A ponte responde com uma de duas:

```js
{ source: 'wazeplaces-ext', action: 'sessao',     token: '…' }   // deu certo
{ source: 'wazeplaces-ext', action: 'sem-sessao', motivo: '…' }  // sem login no WME, ou erro
```

Se ninguém responder em 2,5 s, a app mostra a tela de login normal.

**Sobre segurança:** aceitar um token por `postMessage` **não abre superfície nova** — qualquer
script na página já pode escrever `localStorage.waze_session_token` direto. Mesmo assim os dois
lados exigem `event.source === window` e `event.origin === location.origin`, para não aceitar
nada vindo de iframe ou de outra janela, e a resposta é postada na origem exata (nunca `'*'`).

## Antes de publicar: `key` e `update_url`

Este manifesto **não** traz `"key"` nem `"update_url"`. Eles existiam na v0.0.3 e servem só pra
publicação — a `key` fixa o ID `dpinfpcoggnilplfgkpnkhbmfokhnhnn` (o mesmo da Web Store) e o
`update_url` aponta pro canal de atualização.

Num build carregado sem compactação eles não ajudam e só criam dúvida: a cópia local passa a ter
a mesma identidade da versão publicada, e o `update_url` faz o Chrome considerar atualizar por
cima do que você está testando. **@daflash: adicione os dois de volta ao publicar** (ou deixe a
Web Store atribuir), copiando da v0.0.3.

## Como testar sem publicar

1. `chrome://extensions` → ativar **Modo do desenvolvedor**
2. **Carregar sem compactação** → apontar para esta pasta
3. Abrir o WME e fazer login
4. Abrir `https://places.wazebrasil.com` **direto** — tem que entrar sem clicar em nada

Para testar a renovação, com a app aberta, no console:

```js
localStorage.setItem('waze_session_token', 'token-morto'); location.reload();
```

Deve voltar sozinho para a fila, sem passar pela tela de login.

## Como isto foi verificado

`scratchpad/e2e-extensao.mjs` carrega **esta extensão de verdade** num Chrome com
`--load-extension` (headless não carrega MV3; roda com `xvfb`), planta cookies reais do Waze no
perfil e mede os dois fluxos. Duas rodadas seguidas:

```
✓ service worker da extensão subiu
✓ abrir a app sem sessão → NÃO parou no login · entrou · token gravado · card na tela (fila=77)
✓ sessão morre no meio → NÃO caiu no login · token RENOVADO · fila continuou (77 → 77)
```


---

## v0.2.0 — quem instala com a aba do Places já aberta

Dois buracos, os dois medidos antes de escrever qualquer linha.

### 1. Instalar com a aba aberta não fazia nada

A app pergunta à ponte **uma vez**, no carregamento, com 350ms de janela — e o Chrome **não
injeta content script numa aba que já estava aberta**. Quem instalava olhando pra tela de entrada
ficava ali pra sempre. (A app ganhou um "Já instalei — entrar" pra esse caso; isto aqui torna o
botão desnecessário.)

`chrome.runtime.onInstalled` agora recarrega as abas do Places. **Sem permissão nova** — e isso
foi medido, não suposto:

```
sonda com as permissões da 0.1.0 → {"query":"ok","abas":1,"reload":"ok"}
```

`chrome.tabs.query({url})` é autorizado pelo `host_permissions` que já existe, e
`chrome.tabs.reload` não exige a permissão `tabs` (o `chrome.tabs.create` da 0.1.0 já provava).
Isso importa: permissão que gera aviso faz o Chrome **desativar a extensão de todo mundo** até
cada pessoa reaprovar — o custo do recurso novo cairia em quem já está trabalhando.

Só no `reason === 'install'`. No `update` a aba aberta também precisaria, mas recarregar
atropelaria quem está triando no meio da fila — pra esse caso a defesa é a de baixo.

### 2. Contexto órfão pendurava a app por 8 segundos

Quando a extensão se atualiza sozinha, o content script antigo continua vivo na página mas o
`chrome.runtime` dele morre, e `sendMessage` **lança**. O `aguarde` já tinha sido enviado, então
a app esperava o prazo inteiro dela:

```
antes:  tela de entrada utilizável após 8450ms
depois: tela de entrada utilizável após  233ms
```

Agora a ponte responde `sem-sessao` na hora, e a aba volta a funcionar sozinha no próximo
carregamento.

### Compatibilidade

| app | extensão | resultado |
|---|---|---|
| atual | 0.1.0 | funciona (é o que roda hoje) |
| atual | 0.2.0 | funciona, e instalar com a aba aberta passa a resolver sozinho |
| anterior | 0.2.0 | funciona — o reload leva a app a perguntar no carregamento, como sempre |

Nenhuma mudança de protocolo entre app e extensão: as mensagens (`precisa-de-sessao`, `aguarde`,
`sessao`, `sem-sessao`) são as mesmas.
