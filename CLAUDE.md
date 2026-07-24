# CLAUDE.md

Contexto pra agentes Claude que trabalham neste repo. Diferente do `README.md` (público, focado em **editores do Waze** que vão instalar a app), este arquivo é **para você, IA**: arquitetura, convenções, gotchas, decisões já tomadas e workflows típicos.

**Sempre leia este arquivo antes de fazer mudanças não-triviais.**

---

## 🎯 O que é o projeto

PWA estilo Tinder para **editores do Waze Map Editor (WME)** limparem rapidamente os pedidos de places enviados por usuários comuns — fotos lixo, nomes ruins, endereços errados, categorias absurdas. Cards aparecem um por vez e o editor faz swipe.

**Regra de ouro de produto:** a app **NUNCA aprova** places, **só rejeita ou marca como lido**. Aprovar exige ajuste no mapa via WME oficial (link "↗ abrir no WME" em cada card resolve isso). Se você encontrar referência a "aprovar" no código ou docs, é bug — corrija ou pergunte.

PWA = instala no celular sem precisar de Play Store / App Store. Funciona offline para assets, online para API.

---

## 🏗 Stack & decisões fundamentais

| Camada | Escolha | Por quê |
|---|---|---|
| **Frontend** | HTML + JavaScript **vanilla** + Tailwind CSS | Zero build. Editor leigo baixa, roda, funciona. |
| **Tailwind** | Bundle JS local em `js/tailwindcss_3_4_17.js` (~407KB) | Sem `npm install`. Tradeoff: bundle gordo. Vale considerar pré-compilar em produção mas mantém zero-build pra dev. |
| **Backend** | JavaScript ESM (**sem build, sem npm install**) no padrão **core compartilhado + adaptadores** | `server/core.mjs` = lógica; `worker/index.mjs` = adaptador Cloudflare Workers; `server/node.mjs` = adaptador VM. Só usa `fetch` + Web Crypto → roda igual em Workers e Node 18+. |
| **Auth** | Cookies do WME do usuário → session token, cookies criptografados **AES-256-GCM** server-side | Cookies não trafegam mais que uma vez. Token opaco no client. |
| **Sessão** | Store abstrato: **Workers KV** (Cloudflare) ou **filesystem** (VM) | KV tem TTL nativo; VM espelha o modelo `/tmp` antigo. Injetado no core pelo adaptador. |
| **PWA** | manifest + service worker network-first pra HTML/JS/CSS, cache-first pra imagens | HTML/código sempre fresco (fim do version skew), imagens rápidas. Auto-update via `controllerchange`. |
| **i18n** | Português puro na UI; código em português + inglês misturado | Editores Waze BR são o público-alvo. |

> **v3.0 — migração PHP → JS (Cloudflare/Node).** Até a v2.x o backend era PHP 7.4 + Apache + `.htaccess`, sessões em `/tmp` com AES-256-CBC, `start.sh`/`start.bat` com `PHP_CLI_SERVER_WORKERS`. Tudo isso foi **removido**. Se você achar referência a PHP/`.htaccess`/`start.sh`/cURL/`config.php` em qualquer lugar (fora de `docs/` histórico), é resíduo — corrija. Contrato de API preservado (mesmos paths, agora **sem `.php`**). Mapa de conversão: `docs/cloudflare-migration.md`.

**Não introduza build step, framework, bundler, ORM, ou banco de dados sem discussão explícita com o usuário.** Valor explícito do projeto: simplicidade extrema. O backend é ESM puro rodável direto com `node` (sem `npm install` — zero dependências).

---

## 📁 Estrutura

```
wazeplaces/
├── index.html               # SPA: header + authScreen + appScreen + modais + template do card
├── manifest.json            # PWA manifest (ícones SVG em icons/)
├── service-worker.js        # Cache + auto-update (controllerchange + SKIP_WAITING)
├── icons/
│   ├── icon-192.svg
│   └── icon-512.svg
├── css/
│   └── styles.css           # Estilos custom + dark mode overrides do Tailwind
├── js/
│   ├── version.js           # FONTE ÚNICA da versão: serial de zona DNS YYYYMMDDnn (APP_VERSION + verLabel). Carregado antes do app.js
│   ├── i18n.js              # i18n pt/en/es (sem lib): I18N_DICT + t()/applyI18n()/setLang(). FONTE ÚNICA de strings de UI. Carregado antes do app.js
│   ├── api.js               # Wrapper fetch() dos endpoints /api/* (única fonte de chamadas HTTP; SEM .php)
│   ├── app.js               # AppState, render, handlers, fila, prefetch, error handling
│   ├── swipe.js             # Gestos drag/swipe (esquerda, direita, cima)
│   └── tailwindcss_3_4_17.js # Tailwind CDN bundle congelado localmente
├── server/
│   ├── core.mjs             # Lógica compartilhada: sessões, cripto (AES-GCM), callWaze (fetch),
│   │                        #   categorizeWazeError, isUserAllowed, 8 handlers, dispatch(). ÚNICO lugar de lógica.
│   └── node.mjs             # Adaptador VM/Node: http server + estáticos + fs sessions + key auto-gen
├── worker/
│   └── index.mjs            # Adaptador Cloudflare Workers: roteia /api/* (store=KV, key=Secret) e delega estáticos pro ASSETS
├── _headers                 # Cloudflare: headers/CSP/cache (substitui o antigo .htaccess)
├── wrangler.jsonc           # Cloudflare: binding do KV SESSIONS + compat date
├── .assetsignore            # Exclui server/docs/etc do publish estático dos Workers (static assets)
├── package.json             # Scripts: start (node), cf:dev, cf:deploy. Zero dependências.
├── docs/                    # Referência pra dev (NÃO servido em runtime)
│   ├── README.md            # Procedência dos docs
│   ├── wme-sdk-typings.d.ts # Tipagens oficiais do WME SDK (Waze) — referência canônica de schemas
│   ├── native-android-analysis.md  # Discussão sobre eventual versão Android nativa
│   ├── native-android-analysis.pdf # Mesmo doc renderizado pra compartilhar
│   ├── cloudflare-migration.md     # Planejamento de migração Cloudflare Pages/Workers (+ fallback VM RedHat)
│   ├── cloudflare-migration.pdf    # Mesmo doc renderizado pra compartilhar
│   └── scripts/md2pdf.py    # Conversor markdown → PDF estilizado (paleta cyan da app)
├── README.md                # Doc pública (editores leigos + devs)
├── CLAUDE.md                # Este arquivo
└── .gitignore
```

**`docs/wme-sdk-typings.d.ts`**: tipagem oficial do Waze Map Editor SDK (v2.354). Não é importada em runtime — está aqui só pra consultar quando surgir dúvida sobre o schema do Waze (campos do `Venue`, valores válidos de enum, formato de `OpeningHour`/`NavigationPoint`, etc.). Use sempre como referência canônica antes de inventar estrutura no `handleBuscarPlaces` (em `server/core.mjs`).

---

## 🚀 Como rodar local (CRÍTICO)

**`node server/node.mjs`** (precisa Node 18+). Sobe em `http://localhost:8080`, serve os estáticos e roteia `/api/*`. Zero `npm install` — o backend não tem dependências. Env vars opcionais: `PORT`, `HOST`, `ENCRYPTION_KEY` (auto-gera se ausente), `SESSION_DIR`, `SESSION_KEY_FILE`.

Pra simular o ambiente Cloudflare (Worker + KV): `npx wrangler dev`.

**Validação rápida antes de commitar:**
```bash
npm run check          # node --check em js/*.js server/*.mjs worker/*.mjs
npm test               # node --test — suite pura do core (test/core.test.mjs), ZERO deps
node server/node.mjs   # smoke: sobe, serve estáticos, /api/* responde (401 sem sessão, etc.)
```
CI (`.github/workflows/ci.yml`) roda check + test + boot smoke + **guard do bump de `CACHE_NAME`** (gotcha #17) em todo PR/push. A suite de testes usa só `node:test`/`node:assert` (built-in) e cobre cripto/sessão, `categorizeWazeError`, `isUserAllowed`, parsing de cookies e o filtro de domínio.

**Sandbox/CI:** o ambiente onde este agente roda **tem allowlist de hosts** que bloqueia `*.waze.com` (resposta `403 Host not in allowlist`). Você NÃO consegue testar contra o Waze real — valide com **fixtures de HAR reais** que o usuário envia, ou peça pra ele testar. Mas dá pra testar TUDO que não é o Waze: subir o `node server/node.mjs` e exercitar cripto/sessão/roteamento/erros (o `fetch` ao Waze retorna o 403 do allowlist, que o core categoriza como `unauthorized` — prova que o pipeline funciona).

---

## 🔐 Fluxo de autenticação

1. Editor autentica de uma de duas formas: (a) extensão Chrome **WazePlaces Rapid Access** (@daflash) que coleta cookies e chama `testar-cookies`; (b) upload/colar do `cookies.txt` cru
2. Frontend manda os cookies para `POST /api/testar-cookies` (ou `sessao` action=create)
3. Backend (`server/core.mjs`, via `makeSessions().createSession`):
   - Valida formato e extrai `_csrf_token`
   - Criptografa cookies com **AES-256-GCM** (Web Crypto) usando a chave injetada pelo adaptador (Secret no CF / env/arquivo na VM)
   - Grava no store: `sess_<sha256(token)>` → blob `base64(iv)::base64(ct)`
   - Retorna `sessionToken` (32 bytes base64) ao client
4. Client armazena o `sessionToken` em `localStorage` (persiste entre abas e dias) e usa em **todas** as chamadas seguintes
5. Cookies originais **nunca mais trafegam** após o login
6. Sessão expira em 21 dias (`SESSION_TTL` em `core.mjs`). No **KV** expira sozinha (TTL nativo); na **VM** por mtime + `touch` a cada uso. Cookies do Waze duram ~28 dias — TTL menor dá folga de 1 semana. Quando os cookies expiram de verdade, o backend devolve 401 e o frontend invalida a sessão local (`API.setSession(null)` + `showAuthScreen`)

**Chave de criptografia:** Secret `ENCRYPTION_KEY` (base64, 32 bytes) no Cloudflare; env var ou arquivo `0600` auto-gerado na VM. **Nunca commitada.** O core não sabe de onde vem — o adaptador injeta `keyBytes` em `makeSessions({ store, keyBytes })`.

---

## 🌐 Endpoints proxy → Waze

Todos os handlers em `server/core.mjs` são **proxies stateless**: recebem `sessionToken`, carregam os cookies criptografados do store, fazem `fetch` ao Waze (via `callWaze`), normalizam a resposta. Roteados por `dispatch(name, data, { sessions })`. O nome do endpoint é **sem `.php`** (o dispatch tolera sufixo `.php` por compat de cache antigo). Multi-região (`row`/`na`/`il`/`world`) via helpers em `core.mjs` (`wazeIssuesEndpoint`, etc).

| App endpoint | Waze endpoint | Notas |
|---|---|---|
| `sessao` | — (apenas local) | `action: create\|destroy` |
| `testar-cookies` | `Session` (smoke test + gate) | Valida, checa `isUserAllowed`, cria sessão e devolve token |
| `buscar-places` | `/row-Descartes/app/v1/Issues/Search/List` | Aceita `page`, `countryId`, `stateId`, `managedAreaId`, `bbox`, `types[]`, `categories[]`, `residential`, `unreadOnly`. Envia `orderBy: SORTING_UPDATE_TIME_DESC`. |
| `marcar-lido` | `/row-Descartes/app/v1/Issues/Read` | Aceita single (`venueID`+`updateRequestID`) ou batch (`items[]`) |
| `validar-place` | `/row-Descartes/app/Features` (sempre `approve: false`) | Único caminho de "rejeitar" |
| `perfil` | `/row-Descartes/app/Session?language=pt-BR` | Extrai bbox de `areas[].geometry.coordinates` |
| `lista-paises` | `/row-Descartes/app/LocationSearch/Countries` | Ordenado alfabeticamente |
| `lista-estados` | `/row-Descartes/app/LocationSearch/States?countryId=N` | Idem |

**Headers críticos no `fetch` ao Waze** (em `callWaze`): `Cookie: <montado dos cookies salvos>`, `Referer: https://www.waze.com/pt-BR/editor?env=<env>&tab=issue_tracker`, `X-CSRF-Token: <extraído dos cookies>`, `Origin`, sec-ch-ua-*, sec-fetch-*. Mudar isso quebra a comunicação. O `env` segue tabela `row → row`, `na → usa`, `il → il`, `world → row` (em `wazeRefererEnv`).

### Resposta do `buscar-places`

Volta `{ success, places[], hasMore, page, total }`. Cada `place`:
```js
{
  venueID, updateRequestID,
  name, categories[], address, updateType,
  reqType, reqSubType, createdBy,
  imageUrl, imageUrls[],
  brand, brandKnown,          // brandKnown vem de lookup em categoryBrands da resposta
  changes[],                  // [{ field, label, from, to }] para UPDATE requests
  lat, lon
}
```

O Waze **devolve todos os places de uma vez** numa única chamada (`hasMore: false` normalmente) — confirmado via HAR: ~200 places, response de ~2MB. O WME pagina client-side em chunks de 30. Nossa app trata tudo como uma queue local.

### Filtro de permissão de edição

`handleBuscarPlaces` (em `server/core.mjs`) **descarta** venues que o usuário logado não pode editar antes de devolver pra app. Campo `venue.permissions` é um **bitmask signed 32-bit**:

- `permissions < 0` (ex: `-1` = todos os bits) → pode editar → **entra na fila**
- `permissions >= 0` (ex: `0` = nenhum bit) → sem permissão → **silenciosamente descartado**
- Campo ausente → entra (defensivo)

Resultado: `serverTotal`/header "Restam" reflete apenas o que o usuário pode realmente tratar. Sem badge 🔒, sem atalhos desabilitados — o PUR simplesmente não aparece. Tradeoff: perde-se visibilidade de "total da minha região no Waze". Se precisar adicionar, expor um segundo contador (`totalAll` × `editáveis`).

---

## ⚠️ Race conditions e categorização de erros (IMPORTANTE)

Vários editores tratam o mesmo place ao mesmo tempo. Quando outro chega primeiro, a app **não pode quebrar nem culpar o usuário**.

Estrutura unificada na resposta de erro de `validar-place` e `marcar-lido`:
```json
{ "success": false, "error": "...", "errorCategory": "...", "httpCode": 500 }
```

`categorizeWazeError(httpCode, body, fetchError)` em `server/core.mjs` produz a categoria, **parseando `errorList[0].code` do body JSON** primeiro (antes de regras por HTTP status):

| Categoria | Identificadores reais (do HAR) | Frontend (`handleActionResult`) |
|---|---|---|
| `already_processed` | `errorList[0].code === 702` + "was not found"; `code === 300` + "failed to handle"; HTTP 409; ou hint textual (`already`, `duplicate`, `no longer`, `has been resolved`) em body | Toast info ("Já tratado por outro editor 👍"), **mantém stats** — objetivo do usuário foi cumprido independente de quem fez |
| `not_found` | HTTP 404 puro | Idem `already_processed` |
| `unauthorized` | HTTP 401/403 | Toast erro, invalida sessão local, volta pra `authScreen` |
| `transient` | HTTP 5xx **sem** padrão de race, 408, 429, 0, erro de fetch/rede | `callWithRetry` tenta 2x com backoff (1.5s, 3.5s) antes de aceitar falha |
| `unknown` | Resto | Reverte stat (`--`) e `serverTotal++`, toast erro genérico |

**Casos reais já mapeados (do HAR enviado):**
- `Features` (rejeitar) → HTTP **404** + `code: 702` + `"was not found on venue ..."`
- `Issues/Read` (marcar lido) → HTTP **500** + `code: 300` + `"Failed to handle request"` ← **importante**: NÃO é `transient`, é race

**Se aparecer um caso novo que vira `unknown` em produção:** capture o body do erro, adicione mais um `if` em `categorizeWazeError` mantendo a heurística por palavras-chave como fallback. Está concentrado em uma função só.

---

## 🧠 AppState e fila de places

`AppState` em `app.js` é o estado central:
```js
{
  authenticated, currentPlace,
  queue,                  // []Place — fila local de pendentes
  nextPage, hasMore, emptyPagesInRow, fetching,
  serverTotal,            // total visível no header "Restam"; reflete total real do Waze ajustado por ações locais
  stats: { read, rejected, skipped },
  pendingAction,          // ação no buffer de undo de 5s. Tem execute()/undo()/cancel(): cancel() descarta sem enviar (logout/sessão expirada) revertendo o stat otimista. Também cobre 'skip' (undo no Pular)
  inFlightActions,        // ações já enviadas, aguardando resposta
  fetchEpoch,             // ++ em resetQueue; fetchNextPage descarta resultado se a época mudou durante o await (não injeta places de filtro/região antigos na fila nova)
  loadError,              // true quando a fila esvaziou por FALHA → mostra estado de erro (#loadErrorState) em vez de "Tudo limpo!"
  // _fetchPromise/_profilePromise — promises em voo (await compartilhado, sem busy-loop)
  filters,                // tipos, residencial, país, estado, área, myArea, unreadOnly, categories[] (filtro B5, server-side), sortOrder ('newest'|'oldest', client-side em sortQueue)
  seenCategories,         // categorias vistas nos places carregados — fonte do select de categoria (B5)
  history,                // acumulado histórico { 'YYYY-MM-DD': {read,rejected} } em localStorage waze_places_history — registrado em handleActionResult (só ações confirmadas), zerado no logout. Ver getHistoryStats/renderHistory
  preferences,            // undoEnabled — toggle no modal "Filtros e Preferências", persiste em localStorage waze_places_preferences. Sujeito a gate de experiência: novatos não podem desligar até bater cota ceil(3000/(rank+1)) de read+rejected (staff isento). Ver canDisableUndo()
  devMode,                // { unlocked, active } — easter egg estilo Android. 7 taps na versão do rodapé desbloqueia; toggle no modal "Avançado" ativa. Quando active=true, canDisableUndo() retorna true (bypassa o gate). NÃO é segurança — qualquer um seta via DevTools; só esconde de usuário comum. handleLogout limpa ambas as flags.
  profile, countries, statesByCountry
}
```

Constantes em `app.js`:
- `UNDO_WINDOW_MS = 5000` — janela de undo antes de a ação ser enviada ao Waze (só aplica se `AppState.preferences.undoEnabled === true`, padrão; quando desativado em `scheduleAction`, o executor roda na hora). Banner mostra countdown visual (`.undo-progress`)
- `MAX_CHANGES_DISPLAY = 4` — máximo de mudanças exibidas no card (UPDATE requests)
- `PREFETCH_THRESHOLD = 3` — quando a fila tem ≤3 cards, dispara próximo `fetchNextPage` em background
- `MAX_EMPTY_PAGES = 5` — guarda contra loop infinito se Waze retornar páginas vazias com `hasMore: true`
- `TRANSIENT_RETRY_ATTEMPTS = 2`, `TRANSIENT_RETRY_DELAYS_MS = [1500, 3500]` — política de retry para `transient`

### Regras do `serverTotal`

- Setado em `fetchNextPage` (`+= newPlaces.length`)
- Decrementa em `handleReject`/`handleMarkAsRead` (ação que muda estado no Waze)
- **Skip NÃO decrementa** (place continua pendente)
- Incrementa em erro de API e em undo (reverte ação)
- Renderiza com `+` se `hasMore: true` (ex: `30+`); sem `+` se `hasMore: false`; `…` enquanto carrega; `—` quando deslogado

### Regras do `queue`

Mutações em 5 lugares — **toda mutação deve chamar `updatePendingCount`** (já está garantido):
- `resetQueue()` (logout, troca de filtro)
- `fetchNextPage()` (push de novos)
- `advanceQueue()` (shift após ação)
- `showCurrentPlace()` fallback de erro (descarta place quebrado)
- `scheduleAction.undo()` (unshift de volta)

---

## 🎨 Padrões de UI

- **Header**: logo + perfil (avatar/nome/rank) + refresh + filtros + tema + ajuda. Alvos de toque mínimos 44px (`min-w-[44px] min-h-[44px]`) — régua M3 (48dp) / HIG (44pt); manter em botões novos
- **Stats**: grid de 4 colunas — `Lidos · Rejeitados · Pulados · Restam`. Números com `.tnum` (tabular) e shades -600 no light (contraste WCAG)
- **Card** (`<template id="cardTemplate">`): imagem (+ nav prev/next se múltiplas) → nome → categorias → endereço → tipo/criador → brand + selo (✓ conhecida / ? não listada via `categoryBrands` da resposta do Waze) → mudanças propostas (diff antes/depois para UPDATE requests) → **barra de botões ✕/↑/✓** (`.card-btn-reject/skip/read`). Gesto é atalho; botão é o caminho canônico e acessível — NÃO remover os botões
- **Modais**: SEMPRE via `openModal(id)`/`closeModal(id)` (app.js) — cuidam de foco, Esc, clique no scrim e scroll-lock. Modal novo → adicionar id em `MODAL_IDS` + `role="dialog" aria-modal="true" aria-labelledby`. Ordem de botões: dismissiva à esquerda, afirmativa à direita (M3/HIG)
- **Modal "Filtros e Preferências" é TABBED** (3 abas WAI-ARIA: Filtros | Preferências | Histórico — `FILTER_TABS`/`switchFilterTab` em app.js, `.seg-tabs` em styles.css). Rodapé é **contextual**: Cancelar/Aplicar só na aba Filtros; as outras mostram "Fechar". **Preferências (idioma/undo/dev mode) aplicam NA HORA via change listener** — não passam pelo `applyFiltersFromModal` (que é só da aba Filtros). Campo de filtro novo → aba Filtros; preferência nova → aba Preferências + listener próprio. Abre sempre na aba Filtros
- **Snackbar/toast**: `showToast(msg, type, durationMs=4000)` — bottom-center no `#notifyStack` (respeita safe-area), clique dispensa, `aria-live` no container. Undo banner vive no mesmo stack
- **Switches vs checkboxes**: preferência on/off = `<input type="checkbox" class="ui-switch">` (estilo M3, JS lê `.checked` normal); seleção múltipla (tipos) = checkbox com `accent-cyan-600`
- **Tema**: segue o sistema até o user tocar no toggle (aí persiste em `localStorage.waze_places_theme`). `applyTheme` também atualiza `<meta name="theme-color">`. Dark mode: usar variantes `dark:` do Tailwind no HTML em código novo; os overrides `!important` do styles.css são legado
- **Safe areas (iOS PWA)**: header tem `padding-top: env(safe-area-inset-top)`; `#notifyStack`/footer usam `env(safe-area-inset-bottom)`. Não criar elemento fixed sem considerar isso
- **Zoom NUNCA bloqueado** no viewport (WCAG 1.4.4). Lightbox tem pinch/double-tap/wheel zoom + swipe pra trocar/fechar
- **Reduced motion**: media query global em styles.css zera animações — não criar animação essencial sem fallback estático
- **Versão visível**: rodapé fixo `v{verLabel(APP_VERSION)}` (ex.: `v2026.07.18-01`) — sempre bump o serial em mudança visual (formato `YYYYMMDDnn`, ver seção do Service Worker)

### Gestos (swipe.js)

- ← arrastar/seta esquerda → Rejeitar
- → arrastar/seta direita → Marcar como lido
- ↑ arrastar/seta cima → Pular
- Threshold: 25% da largura da tela (horizontal) ou 120px (vertical)
- `triggerSwipe(direction, callback)` exposto em `window` pra usar via teclado/botão
- `enableSwipeOnCard(card)` é chamado automaticamente via `MutationObserver` em `index.html` quando novo card é adicionado ao `#cardStack`

---

## ⚡ Service Worker e versionamento

- `CACHE_NAME = 'waze-places-<serial>'` em `service-worker.js` — **OBRIGATÓRIO: bump em TODA PR que toque em `index.html`, qualquer arquivo `js/`, `css/`, ou `icons/`**. Sem isso, users que já têm o SW instalado continuam vendo a versão velha (cache-first pra assets). Bug típico: "feature X parou de funcionar" depois de várias PRs sem bump.
- Checklist antes do PR: tocou em `index.html` / `js/*.js` / `css/*.css` / `icons/*`? → bump o serial em **`js/version.js`** (`APP_VERSION`) **E** no `service-worker.js` (`CACHE_NAME`), juntos (a auditoria `test/version.test.mjs` falha se divergirem).
- HTML: **network-first** (sempre tenta fresh, fallback cache); assets: **cache-first**
- `/api/*` NÃO é interceptado (sempre vai direto à rede)
- **Auto-update**: detecta nova versão via `registration.updatefound` → posta `SKIP_WAITING` → `controllerchange` dispara reload **apenas se já havia controller anterior** (evita flicker na primeira instalação)
- **Versionamento = serial de zona DNS (RFC 1912): `YYYYMMDDnn`** (data + revisão do dia; ex.: `2026071801` = 1ª revisão de 2026-07-18). Fonte única: `APP_VERSION` em **`js/version.js`** — carregado como `<script>` clássico ANTES do `app.js`, expõe `APP_VERSION`/`verLabel` no escopo global (como o `API` do api.js). O `CACHE_NAME` do `service-worker.js` é `'waze-places-' + o MESMO serial` (hardcoded). A auditoria `test/version.test.mjs` trava paridade + formato no CI. O rodapé (`#appVersionDisplay`) mostra `verLabel()` → `v2026.07.18-01`. Cresce sempre, compara como número, e diz DE QUANDO é a versão só de olhar. (Ideia trazida do projeto botequei.)

---

## 📐 Convenções

### Backend (server/core.mjs)
- ESM puro, zero dependência. Só `fetch` + Web Crypto (roda em Workers e Node 18+). **Nada de API específica de Node no core** (`node:fs`, `process`, etc) — isso vive só nos adaptadores.
- `resolveCookies(data, sessions)` resolve `sessionToken` → cookies decriptados (em qualquer handler que precise). Lança `ApiError` 401 se inválido.
- Handlers retornam `{ status, body }` — nunca escrevem resposta direto. Erro → `apiError(msg, status)` (lança `ApiError`, capturado pelo `dispatch`).
- Erros do Waze sempre passam por `categorizeWazeError` (já é padrão).
- Novo endpoint → adicionar handler + entrada em `ROUTES`. Adaptadores não mudam (o `worker/index.mjs` e o `node.mjs` roteiam por nome automaticamente).
- Validação: `node --check server/core.mjs` + smoke test `node server/node.mjs`.

### JavaScript (frontend)
- Vanilla. Zero framework. Zero dependência npm.
- Async/await. Sem callback hell. Sem Promise chain longo.
- Funções globais expostas em `window.*` quando precisarem ser chamadas de outro arquivo (`window.triggerSwipe`, `window.enableSwipeOnCard`, `window.showToast`, etc)
- `escapeHtml(str)` SEMPRE em strings que vão pra `innerHTML` (XSS guard)
- Validação rápida: `node --check js/app.js` antes de commit

### i18n (pt/en/es) — REGRA PERMANENTE
- **TODA string de UI nasce em `js/i18n.js`, nas TRÊS línguas (pt/en/es).** Nunca hardcode texto pt no HTML ou no JS.
- **HTML**: `data-i18n="chave"` (textContent), `data-i18n-html` (innerHTML — só valores do próprio dicionário, nunca dado da rede), `data-i18n-ph` (placeholder), `data-i18n-aria` (aria-label), `data-i18n-title` (title). O `applyI18n()` preenche em runtime.
- **JS**: `t('chave', { var: valor })` — interpola `{var}`. String que vai pra innerHTML → `escapeHtml(t(...))`.
- **Plural**: chaves separadas (`.x` singular / `.xPlural`), escolhidas com `n === 1 ? 'x' : 'xPlural'`. Sem ICU.
- **Números/datas**: use `i18nLocale()` no `toLocaleString(...)` — nunca hardcode `'pt-BR'`.
- **Adicionou UMA string? Adicione nas TRÊS línguas.** A auditoria `test/i18n.test.mjs` (CI) FALHA se faltar paridade, houver valor vazio, placeholders divergentes, ou `data-i18n` sem chave no dicionário.
- Idioma detectado de `navigator.language`, persiste em `localStorage.waze_places_lang`, trocável no seletor do modal de filtros. `js/i18n.js` carrega como `<script>` clássico antes do `app.js` (expõe `t`/`applyI18n`/`setLang`/`getLang`/`i18nLocale` no escopo global). Mecanismo espelhado do botequei.
- **Não traduzir**: marcas/nomes (Waze, WME, cookies.txt, @daflash), siglas (ROW/NA/IL, PUR, AM/Staff), serial de versão, emojis.

### Git
- Branches do agente: `claude/<descrição-curta-kebab>`
- Commit messages: descritivos, em português, body explica **por que** não só o **o quê**
- Squash merge é o padrão do owner — não precisa rebase manual
- Owner faz merge + delete da branch no GitHub UI; agente espera próxima task

### Workflow PR ↔ owner (regras fixadas pelo owner)
- **Agente pode abrir PR sempre que sentir que a branch tá madura** — não precisa pedir permissão pra abrir
- **Owner sempre faz squash merge + apaga a branch ao aprovar** — agente sincroniza main e deleta local sem perguntar
- **Sempre que abrir PR, agente subscreve no `subscribe_pr_activity`** e acompanha CI/review comments até a branch ser mergeada. Bugs apontados no review devem ser corrigidos no mesmo PR (push direto na branch). CI vermelho deve ser corrigido (não ignorado).

### Perfis de editor do Waze (referência rápida)
- **URL canônica do perfil**: `https://www.waze.com/pt-BR/user/editor/<username>` (sem `pt-BR/` também funciona, redirect pra locale do user)
- Quando mencionar nome de editor da comunidade WME (próprio owner, colaboradores tipo @daflash etc), sempre transformar em link clicável `target="_blank" rel="noopener noreferrer"` apontando pra esse perfil
- Padrão visual: cor de destaque (cyan/purple), `hover:underline`, `font-semibold`. Ver exemplo `index.html#filterTypeRequestRow` da extensão @daflash
- Owner do projeto: `@antigerme` → `https://www.waze.com/user/editor/antigerme` (já linkado no `byAuthor` button do auth screen)

### Estilo de mensagens ao usuário
- Toasts curtos, via `t('toast.…')` (pt/en/es — ver seção **i18n**, nunca hardcode); emoji ocasional onde ajuda ("Já tratado por outro editor 👍")
- Erros de Waze nunca expõem detalhes técnicos crus pro editor (vira "Servidor Waze indisponível" etc)

---

## 🪤 Gotchas / Anti-patterns conhecidos

Bugs já encontrados e corrigidos — **não repita**:

1. **Variável `gallery` órfã** (commit `1632ad4`): quando troquei galeria horizontal por carousel single-image, deixei `gallery.classList.add('hidden')` num else branch. Qualquer place sem imagens (`imageUrls: []`) lançava `ReferenceError`, matava `showCurrentPlace` silenciosamente e a tela inteira ficava órfã. **Lição**: refatorou variável? `grep` pelo nome no projeto inteiro antes de commit. E `try-catch` ao redor do render do card sempre vale.

2. **Notificações removidas** (commit `419c9bc`): tinha sino com badge no header. Owner pediu remoção. Se aparecer demanda de "notificações" de novo, considere ressuscitar o endpoint de notificações (`/Feed/Notifications`) como handler no core.

3. **`Issues/Search/List` retorna tudo de uma vez** — confirmado via HAR. Não tente implementar "paginação real" assumindo que cada page tem N items. Use `hasMore` como verdade e trate a queue como global.

3.5. **Um venue pode ter VÁRIOS `venueUpdateRequests`** (consertado v2.14.0). Caso típico: usuário sobe 2 fotos novas pra mesma loja, então o mesmo venue volta com 2 PURs do tipo IMAGE. Pegar só `venueUpdateRequests[0]` (como o código antigo fazia) causa bug "place volta": user marca o primeiro lido, próximo fetch o venue reaparece com o segundo. Tratamento certo: **um card por updateRequest**, não por venue. **Sempre devolver TODAS as imagens do venue** (aprovadas + pendentes) em `imageUrls`, mesmo pra IMAGE PUR — o editor precisa comparar a foto nova com as existentes. O frontend identifica a foto nova via `image.id === updateRequest.id` (confirmado via HAR) e marca com ✨ + borda âmbar. Já regredi isso uma vez (v2.14.0 enviava só a foto pareada, escondendo o carrossel) — não regredir de novo.

4. ~~**PHP_CLI_SERVER_WORKERS**~~ **(OBSOLETO na v3.0 — histórico)**: no backend PHP, `php -S` single-thread travava a app (cada cURL ao Waze bloqueava as outras requests); `start.sh` setava `=4`. Não se aplica mais — Workers escalam por request e o Node é assíncrono. Registrado só pra contexto.

5. **Filtro padrão = não lidos** (commit `419c9bc`): backend manda `userPropertiesFilter: {isRead: false}` por padrão (vs WME que manda `{}` = tudo). Owner quis o filtro como default mas configurável via checkbox no modal.

6. **HTTP 500 no Issues/Read não é sempre transient!** (commit `5912dc6`): é o padrão do Waze quando outro editor já marcou como lido (`code 300 + "Failed to handle request"`). Categorização precisa olhar `errorList[0].code` **antes** de cair em "5xx → transient".

7. **Service worker primeira instalação não deve recarregar a página** (commit `1632ad4`): listener de `controllerchange` só dispara reload se `hadController` era truthy no início. Senão fica flickering eterno na primeira visita.

8. **iOS Safari não suporta SVG inline em `data:` para PWA icons**. Use arquivos em `icons/icon-*.svg`. Se quiser instalável em iPhone bonitinho, vai precisar PNG real algum dia.

9. **`AppState.queue` é mutável e referenciado em vários lugares**. Toda mutação chama `updatePendingCount`. Se adicionar nova mutação, adicione a chamada também.

10. **Não exponha cookies em logs/toasts**. São credenciais.

11. **Service worker NÃO pode usar `caches.match('/index.html')` como fallback genérico** para requests não-HTML. Em produção atrás de Cloudflare/mod_pagespeed, se um JS falha por qualquer motivo, o fallback retornava HTML como resposta de `api.js` → o browser engasga e `const API = {...}` nunca executa → toast "API is not defined" no `app.js`. Desde v6: fetch nativo segue, sem fallback HTML pra assets. **Também ignorar requests cross-origin** (`url.origin !== self.location.origin → return`) — senão o SW intercepta o `cloudflareinsights.com/beacon.min.js` e dá `TypeError: Failed to convert value to 'Response'`.

12. **Atrás de Cloudflare**: desabilitar **Rocket Loader**, **Auto Minify**, **Script Monitor** (Page Shield). Esses reescrevem HTML/JS. Documentado em detalhe no README seção "Atrás de Cloudflare".

13. ~~**mod_pagespeed do Apache**~~ **(OBSOLETO na v3.0 — histórico)**: no deploy Apache/RHEL, `mod_pagespeed` reordenava/minificava scripts e quebrava a ordem `api.js → app.js`; o `.htaccess` desabilitava. Não se aplica ao Cloudflare/Node. Registrado só pra contexto.

14. **CSP precisa permitir domínios externos do Waze**. Browser aplica a INTERSEÇÃO de todas as CSPs ativas — vence a mais restritiva. `img-src` precisa de `venue-image.waze.com` (fotos de places) e `social-row.waze.com` (avatar); `font-src`/`connect-src` precisam de `fonts.googleapis.com`/`fonts.gstatic.com`. **Duas cópias da CSP em sync**: o `<meta>` do `index.html` E o arquivo **`_headers`** (Cloudflare) / o header no `server/node.mjs` se um dia setar lá. Ao adicionar host externo, atualize as duas. (Nota: as chamadas ao Waze são server-side agora — `connect-src` do browser continua só `'self'` + fontes/imagens.)

15. **Rank do editor é 0-indexed no Waze, +1 na UI** (regra de convenção sagrada deste projeto). O `/Session` do Waze retorna `rank: 0..5` mas humanos contam `1..6`:
    - **Toda exibição pro user** usa `rank + 1` (já implementado em `renderProfileHeader` como `'L' + (p.rank + 1)`)
    - **Toda comparação interna** usa o valor cru do Waze (`MIN_RANK_WAZE = 2` no gate = "display L3+")
    - **Mensagens de erro/permissão** que citam nível devem mostrar `rank + 1` pra não confundir o user
    - Owner disse explicitamente: "um editor nível 1 nos dados do Waze aparece como nível 0, um editor nível 6 aparece como nível 5"
    - Adicionou novo cálculo de rank? Confira nos dois lados (display vs comparação). Confundir os dois é fonte garantida de bug com erro silencioso (todo mundo permitido / ninguém permitido)

16. **Gate de acesso (`isUserAllowed` em `server/core.mjs`)**: a app só permite login pra editores **`isStaff` OU `(rank >= MIN_RANK_WAZE && isAreaManager)`**. Como o Waze usa rank 0-indexed e a UI mostra `rank + 1`, `MIN_RANK_WAZE = 2` significa "display L3+". Mudar o critério aqui afeta todo login. `handleTestarCookies` chama `/Session` como smoke test e nega a criação de sessão se não passar — frontend mostra modal `accessDeniedModal` com perfil do user e mensagem clara, sem persistir nada. Bloqueio acontece no backend; **não dá pra burlar editando JS**.

17. **Esquecer de bumpar `CACHE_NAME` do SW é o bug mais ranzinza do projeto**. Já aconteceu múltiplas vezes: PR adiciona feature em JS, deploy ok, mas users que já tinham o SW instalado **continuam vendo a versão velha por dias** porque SW é cache-first pra assets. Sintoma típico: "feature X parou de funcionar" relatado por um user, mas outros confirmam que funciona (cache deles é mais novo). **Cheque-list**: tocou em `index.html`, `js/*`, `css/*`, ou `icons/*`? → bump o serial em `js/version.js` (`APP_VERSION`) E no `service-worker.js` (`CACHE_NAME`) juntos no mesmo commit (a auditoria `test/version.test.mjs` trava a paridade). Se passou batido, basta um PR posterior fazendo só o bump pra liberar pra todos.

19. **`startFetching` não pode busy-loopar em microtasks** (P0 consertado v3.1.0). O laço `while (queue.length===0 && hasMore) await fetchNextPage()` congelava a aba quando um fetch já estava em voo: o guard `if (fetching) return` saía síncrono, o laço virava cascata de microtasks e **impedia o event loop de processar a resposta em voo** → `fetching` nunca zerava → freeze permanente. Fix: `fetchNextPage` retorna a **mesma promise em voo** (`_fetchPromise`) quando `fetching`, então o `await` realmente espera (event loop livre); e o laço checa `&& authenticated`. **Regra**: nunca `while (cond) await fn()` onde `fn` pode retornar síncrono sem progredir — garanta que o await ceda o event loop.

20. **Reset de fila precisa lidar com fetch em voo E ação no buffer de undo** (v3.1.0). `resetQueue` faz `fetchEpoch++` (invalida resultado obsoleto do fetch em voo) e descarrega o `pendingAction` (`execute()` no refresh/filtros — honra o swipe; `cancel()` no logout/sessão-expirada — descarta sem enviar, revertendo o stat). Sem isso: places de filtro antigo entravam na fila nova e o "Desfazer" duplicava place + dobrava stats. Toda nova origem de reset passa por `resetQueue` (ou cancela o pending antes, como `handleLogout`/`handleUnauthorized`).

18. **Version skew HTML vs JS — 2 camadas de cache** (consertado parcialmente em v2.13.1, completado em v2.17.2). Antes: HTML era network-first no SW e JS era cache-first. Quando deployava uma feature nova (HTML novo referenciando funções/IDs novos), o user pegava o HTML fresh mas continuava com o JS velho do cache. Resultado: feature aparecia na UI (HTML novo tem o checkbox), mas não funcionava (JS velho não conhece o ID, não salva no localStorage). Sintoma diagnóstico: F5 não conserta — só `Ctrl+Shift+R` (cache bypass total). **Mobile não tem `Ctrl+Shift+R`**, então o user fica preso. Fix v2.13.1: JS/CSS/JSON network-first no SW. Mas regrediu em v2.17.1 — F5 ainda não funcionava no mobile! Causa: o `fetch()` do SW passa pelo **HTTP cache do navegador** antes da rede. O `.htaccess` mandava `Cache-Control: max-age=2592000` (1 mês) pra JS via `ExpiresByType` → mesmo com SW network-first, o browser servia do HTTP cache local. Fix v2.17.2 (defesa em duas camadas): (a) `fetch(req, { cache: 'reload' })` no SW força bypass do HTTP cache; (b) Cache-Control `no-cache, must-revalidate` pra JS/CSS/manifest — na v3.0 isso vive no **`_headers`** (Cloudflare) e no `serveStatic` do `server/node.mjs` (o `.htaccess` foi removido). Também: `updateViaCache: 'none'` + `reg.update()` imediato + tratamento de `reg.waiting` no register. **Antes de quebrar essas regras**: pra atualização funcionar com F5 no mobile, três camadas precisam estar alinhadas — estratégia do SW, opção `cache` do `fetch`, e Cache-Control do servidor (`_headers`/Node). Mexer em uma só rompe a cadeia.

---

## 🛠 Workflows típicos

### Adicionar novo endpoint Waze
1. Adicionar helper de URL em `server/core.mjs` (`wazeXxxEndpoint(region)`)
2. Escrever `async function handleXxx(data, { sessions })` seguindo o padrão (→ `resolveCookies` → `prepareAuth` → `callWaze` → `categorizeWazeError` ou parsing direto → retorna `{ status, body }`)
3. Registrar em `ROUTES` (`'xxx': handleXxx`). Os adaptadores roteiam por nome — não precisam mudar.
4. Adicionar método em `js/api.js` (sempre passa `sessionToken` e `region` no body; nome do endpoint **sem `.php`**)
5. Usar em `app.js`; documentar a tabela de endpoints neste CLAUDE.md
6. Bump o serial (`js/version.js` + `CACHE_NAME` do `service-worker.js`) se tocou frontend

### Adicionar novo filtro
1. Backend: ler o campo em `handleBuscarPlaces` e propagar pro `payload` do `callWaze`
2. HTML: adicionar input no `#filtersModal`
3. `app.js`: adicionar campo em `AppState.filters`, popular em `openFiltersModal`, ler em `applyFiltersFromModal`, propagar em `fetchNextPage`, persistir em `loadFilters`/`saveFilters`
4. Testar com fixture do HAR

### Validar mudanças quando sandbox bloqueia o Waze
- Sintaxe: `for f in js/*.js server/*.mjs worker/*.mjs; do node --check "$f"; done`
- Lógica pura do core: `import('./server/core.mjs')` e alimentar `categorizeWazeError`/`isUserAllowed`/`makeSessions` com fixtures/valores (ver o smoke test usado na migração v3.0 no histórico de commits)
- Pipeline completo: subir `node server/node.mjs` e `curl` nos endpoints — sessão fake dá 401 limpo; sessão válida tenta o Waze e o 403 do allowlist vira `errorCategory: unauthorized` (prova que roteamento + cripto + fetch funcionam)

### Investigar bug reportado pelo usuário
1. Pedir HAR do Chrome/Firefox DevTools (sempre o owner manda)
2. Parsear com `jq` ou Python (cuidado, HARs costumam ter 5-20MB)
3. Olhar request payloads (o que **a app** enviou) e response bodies (o que **o Waze** devolveu)
4. Confirmar se é bug do app, do Waze, ou expectativa errada
5. Se for bug do app, reproduzir mentalmente o fluxo, adicionar defesa + try-catch onde fizer sentido, bump o serial (`js/version.js` + `service-worker.js`)

---

## 🔗 Decisões com link pro contexto

| Decisão | PR/Commit | Por quê |
|---|---|---|
| **Backend JS (Cloudflare/Node), core+adapters** | v3.0 | Sem servidor pra manter, escala automática, edge; VM Node como fallback. Padrão validado no botequei. Ver `docs/cloudflare-migration.md` |
| Sessões em Workers KV (CF) / filesystem (VM), AES-256-GCM | v3.0 | KV tem TTL nativo; GCM é autenticado; store injetado no core |
| ~~`start.sh` / `/tmp` / `.htaccess`~~ | v2.x (removido na v3.0) | Eram do stack PHP+Apache; histórico só |
| Total "Restam" via `serverTotal` (não `queue.length`) | (PR add-total-pendentes) | Skip não deveria mudar contador — usuário não tratou |
| Categorização de erro com parsing de `errorList[0].code` | (PR #8) | HAR mostrou `Issues/Read 500 + code 300` que não era erro real |
| Notificações removidas | (PR #6) | Owner não queria. Simplificar UI |
| Default = não lidos | (PR #6) | Cenário primário do editor é "limpar o backlog" |

---

## 📝 Quando atualizar este arquivo

- Toda mudança arquitetural (novo endpoint, nova convenção, novo gotcha encontrado)
- Toda decisão que vai surpreender o próximo agente
- **Não** atualize a cada feature pequena — só quando vale como **contexto durável**

Mantenha curto. Se ficar enorme, divide em arquivos por tópico (ex: `docs/race-conditions.md`).
