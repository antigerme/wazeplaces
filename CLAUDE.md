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
| **Backend** | PHP 7.4+ stateless (sessão criptografada em `/tmp`) | PHP é o que editores costumam ter no servidor. Stateless = simples. |
| **Auth** | Cookies do WME do usuário → session token AES-256-CBC server-side | Cookies não trafegam mais que uma vez. Token opaco no client. |
| **PWA** | manifest + service worker network-first pra HTML, cache-first pra assets | HTML sempre fresco, assets rápidos. Auto-update via `controllerchange`. |
| **i18n** | Português puro na UI; código em português + inglês misturado | Editores Waze BR são o público-alvo. |

**Não introduza build step, framework, npm, bundler, ORM, ou banco de dados sem discussão explícita com o usuário.** Esse é um valor explícito do projeto: simplicidade extrema para que qualquer editor possa rodar local.

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
│   ├── api.js               # Wrapper fetch() dos endpoints /api/*.php (única fonte de chamadas HTTP)
│   ├── app.js               # AppState, render, handlers, fila, prefetch, error handling
│   ├── swipe.js             # Gestos drag/swipe (esquerda, direita, cima)
│   └── tailwindcss_3_4_17.js # Tailwind CDN bundle congelado localmente
├── api/
│   ├── config.php           # Constantes, helpers: sessão, cURL, categorização de erro
│   ├── sessao.php           # POST {action: create|destroy}
│   ├── testar-cookies.php   # Valida cookies + cria sessão (1ª chamada após login)
│   ├── buscar-places.php    # Lista pedidos (Issues/Search/List)
│   ├── marcar-lido.php      # POST: aceita item único OU items[] (batch) — Issues/Read
│   ├── validar-place.php    # POST: rejeita (Features endpoint, sempre approve=false)
│   ├── perfil.php           # GET Session do Waze (userName, rank, areas, editableCountryIDs)
│   ├── lista-paises.php     # GET LocationSearch/Countries
│   └── lista-estados.php    # GET LocationSearch/States?countryId=N
├── .htaccess                # Apache config (rewrite, headers, cache, compressão)
├── start.sh                 # Wrapper dev Linux/macOS: PHP_CLI_SERVER_WORKERS=4 + php -S
├── start.bat                # Wrapper dev Windows: idem
├── README.md                # Doc pública (editores leigos + devs)
├── CLAUDE.md                # Este arquivo
└── .gitignore
```

---

## 🚀 Como rodar local (CRÍTICO)

**Sempre use `./start.sh` (Linux/macOS) ou `start.bat` (Windows).** Eles setam `PHP_CLI_SERVER_WORKERS=4` por padrão. **Nunca recomende `php -S 0.0.0.0:8080` puro** ao usuário, porque single-thread bloqueia todas as outras requisições enquanto um cURL ao Waze (1-2s) está em andamento — vira "app travada".

Os scripts respeitam env vars `PHP_CLI_SERVER_WORKERS`, `PORT`, `HOST` se já estiverem setadas.

**Sandbox/CI:** o ambiente onde este agente roda **tem allowlist de hosts** que bloqueia `*.waze.com` (resposta `403 Host not in allowlist` com header `x-deny-reason: host_not_allowed`). Você NÃO consegue testar contra o Waze real — valide com **fixtures de HAR reais** que o usuário envia, ou peça pra ele testar na máquina dele.

---

## 🔐 Fluxo de autenticação

1. Editor exporta `cookies.txt` do navegador (extensão "Get cookies.txt LOCALLY" ou similar) após login no WME
2. Frontend manda o `cookies.txt` cru para `POST /api/sessao.php?action=create`
3. Backend (`config.php::createSession`):
   - Valida formato e extrai `_csrf_token`
   - Criptografa cookies com **AES-256-CBC** usando chave em `/tmp/waze_places.key` (criada na 1ª vez, `0600`)
   - Grava em `/tmp/waze_places_sessions/sess_<sha256(token)>` com `0600`
   - Retorna `sessionToken` (32 bytes base64) ao client
4. Client armazena o `sessionToken` em `sessionStorage` e usa em **todas** as chamadas seguintes
5. Cookies originais **nunca mais trafegam** após o login
6. Sessão expira em 2h (`SESSION_TTL` em `config.php`); cada uso renova via `touch()`
7. Limpeza de sessões expiradas acontece automaticamente em cada `createSession`

**Por que `/tmp` e não `api/.encryption-key`?** Apache do Red Hat tem `PrivateTmp=yes` no systemd, então `/tmp` é isolado do Apache — só ele lê/escreve. Vantagem: **zero permissão de escrita** necessária no DocumentRoot. Editor avançado faz `git clone /var/www/html/wazeplaces` + `restorecon -R` + `setsebool -P httpd_can_network_connect 1` e acabou.

---

## 🌐 Endpoints proxy → Waze

Todos os endpoints PHP em `api/` são **proxies stateless** que recebem `sessionToken`, lêem cookies criptografados, fazem cURL ao Waze, normalizam resposta. Multi-região (`row`/`na`/`il`/`world`) via helpers em `config.php` (`wazeIssuesEndpoint`, `wazeSessionEndpoint`, etc).

| App endpoint | Waze endpoint | Notas |
|---|---|---|
| `sessao.php` | — (apenas local) | `action: create\|destroy` |
| `testar-cookies.php` | `Issues/Search/List` (1 chamada de smoke test) | Cria sessão e devolve token |
| `buscar-places.php` | `/row-Descartes/app/v1/Issues/Search/List` | Aceita `page`, `countryId`, `stateId`, `managedAreaId`, `bbox`, `types[]`, `categories[]`, `residential`, `unreadOnly`. Envia `orderBy: SORTING_UPDATE_TIME_DESC`. |
| `marcar-lido.php` | `/row-Descartes/app/v1/Issues/Read` | Aceita single (`venueID`+`updateRequestID`) ou batch (`items[]`) |
| `validar-place.php` | `/row-Descartes/app/Features` (sempre `approve: false`) | Único caminho de "rejeitar" |
| `perfil.php` | `/row-Descartes/app/Session?language=pt-BR` | Extrai bbox de `areas[].geometry.coordinates` |
| `lista-paises.php` | `/row-Descartes/app/LocationSearch/Countries` | Ordenado alfabeticamente |
| `lista-estados.php` | `/row-Descartes/app/LocationSearch/States?countryId=N` | Idem |

**Headers críticos no cURL ao Waze** (em `makeCurlRequest`): `Referer: https://www.waze.com/pt-BR/editor?env=<env>&tab=issue_tracker`, `X-CSRF-Token: <extraído dos cookies>`, `Origin`, sec-ch-ua-*, sec-fetch-*. Mudar isso quebra a comunicação. O `env` segue tabela `row → row`, `na → usa`, `il → il`, `world → row` (em `wazeRefererEnv`).

### Resposta do `buscar-places.php`

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

---

## ⚠️ Race conditions e categorização de erros (IMPORTANTE)

Vários editores tratam o mesmo place ao mesmo tempo. Quando outro chega primeiro, a app **não pode quebrar nem culpar o usuário**.

Estrutura unificada na resposta de erro de `validar-place.php` e `marcar-lido.php`:
```json
{ "success": false, "error": "...", "errorCategory": "...", "httpCode": 500 }
```

`categorizeWazeError($httpCode, $body, $curlError)` em `config.php` produz a categoria, **parseando `errorList[0].code` do body JSON** primeiro (antes de regras por HTTP status):

| Categoria | Identificadores reais (do HAR) | Frontend (`handleActionResult`) |
|---|---|---|
| `already_processed` | `errorList[0].code === 702` + "was not found"; `code === 300` + "failed to handle"; HTTP 409; ou hint textual (`already`, `duplicate`, `no longer`, `has been resolved`) em body | Toast info ("Já tratado por outro editor 👍"), **mantém stats** — objetivo do usuário foi cumprido independente de quem fez |
| `not_found` | HTTP 404 puro | Idem `already_processed` |
| `unauthorized` | HTTP 401/403 | Toast erro, invalida sessão local, volta pra `authScreen` |
| `transient` | HTTP 5xx **sem** padrão de race, 408, 429, 0, cURL error | `callWithRetry` tenta 2x com backoff (1.5s, 3.5s) antes de aceitar falha |
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
  pendingAction,          // ação no buffer de undo de 3s
  inFlightActions,        // ações já enviadas, aguardando resposta
  filters,                // tipos, residencial, país, estado, área, myArea, unreadOnly
  profile, countries, statesByCountry
}
```

Constantes em `app.js`:
- `UNDO_WINDOW_MS = 3000` — janela de undo antes de a ação ser enviada ao Waze
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

- **Header**: logo + perfil (avatar/nome/rank) + filtros + tema + ajuda
- **Stats**: grid de 4 colunas — `Lidos · Rejeitados · Pulados · Restam`
- **Card** (`<template id="cardTemplate">`): imagem (+ nav prev/next se múltiplas) → nome → categorias → endereço → tipo/criador → brand + selo (✓ conhecida / ? não listada via `categoryBrands` da resposta do Waze) → mudanças propostas (diff antes/depois para UPDATE requests) → botões Rejeitar / Pular / Lido
- **Tema escuro**: classes `.dark` no `<html>` + overrides Tailwind em `css/styles.css`. Persistido em `localStorage.waze_places_theme`
- **Versão visível**: rodapé fixo `v{APP_VERSION}` — sempre bump em mudança visual (`2.5.x` formato)

### Gestos (swipe.js)

- ← arrastar/seta esquerda → Rejeitar
- → arrastar/seta direita → Marcar como lido
- ↑ arrastar/seta cima → Pular
- Threshold: 25% da largura da tela (horizontal) ou 120px (vertical)
- `triggerSwipe(direction, callback)` exposto em `window` pra usar via teclado/botão
- `enableSwipeOnCard(card)` é chamado automaticamente via `MutationObserver` em `index.html` quando novo card é adicionado ao `#cardStack`

---

## ⚡ Service Worker e versionamento

- `CACHE_NAME = 'waze-places-vN'` em `service-worker.js` — **OBRIGATÓRIO: bump em TODA PR que toque em `index.html`, qualquer arquivo `js/`, `css/`, ou `icons/`**. Sem isso, users que já têm o SW instalado continuam vendo a versão velha (cache-first pra assets). Bug típico: "feature X parou de funcionar" depois de várias PRs sem bump.
- Checklist antes do PR: tocou em `index.html` / `js/*.js` / `css/*.css` / `icons/*`? → bump `CACHE_NAME` E `APP_VERSION`.
- HTML: **network-first** (sempre tenta fresh, fallback cache); assets: **cache-first**
- `/api/*` NÃO é interceptado (sempre vai direto à rede)
- **Auto-update**: detecta nova versão via `registration.updatefound` → posta `SKIP_WAITING` → `controllerchange` dispara reload **apenas se já havia controller anterior** (evita flicker na primeira instalação)
- `APP_VERSION` em `js/app.js` vai no rodapé (`#appVersionDisplay`) — sobe junto com `CACHE_NAME`. Usa **semver suave**: `MAJOR.MINOR.PATCH` (não tem release process rígido)

---

## 📐 Convenções

### PHP
- Stateless por request, sem session_start nativo (sessão = arquivo em `/tmp`)
- `getCookiesFromRequest($data)` resolve `sessionToken` → cookies decriptados (em qualquer endpoint que precise)
- Sempre `jsonResponse($data, $status)` ou `jsonError($msg, $status)` — nunca `echo`/`print` direto
- Erros do Waze sempre passam por `categorizeWazeError` (já é padrão)
- Sintaxe limpa: `php -l api/*.php` antes de commit

### JavaScript
- Vanilla. Zero framework. Zero dependência npm.
- Async/await. Sem callback hell. Sem Promise chain longo.
- Funções globais expostas em `window.*` quando precisarem ser chamadas de outro arquivo (`window.triggerSwipe`, `window.enableSwipeOnCard`, `window.showToast`, etc)
- `escapeHtml(str)` SEMPRE em strings que vão pra `innerHTML` (XSS guard)
- Validação rápida: `node --check js/app.js` antes de commit

### Git
- Branches do agente: `claude/<descrição-curta-kebab>`
- Commit messages: descritivos, em português, body explica **por que** não só o **o quê**
- Squash merge é o padrão do owner — não precisa rebase manual
- Owner faz merge + delete da branch no GitHub UI; agente espera próxima task

### Estilo de mensagens ao usuário
- Toasts curtos em português; emoji ocasional onde ajuda ("Já tratado por outro editor 👍")
- Erros de Waze nunca expõem detalhes técnicos crus pro editor (vira "Servidor Waze indisponível" etc)

---

## 🪤 Gotchas / Anti-patterns conhecidos

Bugs já encontrados e corrigidos — **não repita**:

1. **Variável `gallery` órfã** (commit `1632ad4`): quando troquei galeria horizontal por carousel single-image, deixei `gallery.classList.add('hidden')` num else branch. Qualquer place sem imagens (`imageUrls: []`) lançava `ReferenceError`, matava `showCurrentPlace` silenciosamente e a tela inteira ficava órfã. **Lição**: refatorou variável? `grep` pelo nome no projeto inteiro antes de commit. E `try-catch` ao redor do render do card sempre vale.

2. **Notificações removidas** (commit `419c9bc`): tinha sino com badge no header. Owner pediu remoção. Se aparecer demanda de "notificações" de novo, considere ressuscitar `api/notificacoes.php` (estava chamando `/Feed/Notifications`).

3. **`Issues/Search/List` retorna tudo de uma vez** — confirmado via HAR. Não tente implementar "paginação real" assumindo que cada page tem N items. Use `hasMore` como verdade e trate a queue como global.

4. **PHP_CLI_SERVER_WORKERS** (commit `b2e633e` e prévios): `php -S` é single-thread por padrão. Owner enviou HAR mostrando app "travando" porque cada cURL ao Waze bloqueava todas as outras requests. Solução: `start.sh`/`start.bat` setam `=4` por padrão. **Nunca documente `php -S` puro** — sempre os scripts.

5. **Filtro padrão = não lidos** (commit `419c9bc`): backend manda `userPropertiesFilter: {isRead: false}` por padrão (vs WME que manda `{}` = tudo). Owner quis o filtro como default mas configurável via checkbox no modal.

6. **HTTP 500 no Issues/Read não é sempre transient!** (commit `5912dc6`): é o padrão do Waze quando outro editor já marcou como lido (`code 300 + "Failed to handle request"`). Categorização precisa olhar `errorList[0].code` **antes** de cair em "5xx → transient".

7. **Service worker primeira instalação não deve recarregar a página** (commit `1632ad4`): listener de `controllerchange` só dispara reload se `hadController` era truthy no início. Senão fica flickering eterno na primeira visita.

8. **iOS Safari não suporta SVG inline em `data:` para PWA icons**. Use arquivos em `icons/icon-*.svg`. Se quiser instalável em iPhone bonitinho, vai precisar PNG real algum dia.

9. **`AppState.queue` é mutável e referenciado em vários lugares**. Toda mutação chama `updatePendingCount`. Se adicionar nova mutação, adicione a chamada também.

10. **Não exponha cookies em logs/toasts**. São credenciais.

11. **Service worker NÃO pode usar `caches.match('/index.html')` como fallback genérico** para requests não-HTML. Em produção atrás de Cloudflare/mod_pagespeed, se um JS falha por qualquer motivo, o fallback retornava HTML como resposta de `api.js` → o browser engasga e `const API = {...}` nunca executa → toast "API is not defined" no `app.js`. Desde v6: fetch nativo segue, sem fallback HTML pra assets. **Também ignorar requests cross-origin** (`url.origin !== self.location.origin → return`) — senão o SW intercepta o `cloudflareinsights.com/beacon.min.js` e dá `TypeError: Failed to convert value to 'Response'`.

12. **Atrás de Cloudflare**: desabilitar **Rocket Loader**, **Auto Minify**, **Script Monitor** (Page Shield). Esses reescrevem HTML/JS. Documentado em detalhe no README seção "Atrás de Cloudflare".

13. **Apache do RHEL costuma vir com `mod_pagespeed` habilitado** por padrão, que também reordena/combina/minifica scripts e quebra a ordem `api.js → app.js`. O `.htaccess` da app desabilita via `<IfModule pagespeed_module>ModPagespeed off</IfModule>`.

14. **CSP do `.htaccess` precisa permitir domínios externos do Waze**. Browser aplica a INTERSEÇÃO de todas as CSPs ativas (header HTTP + meta) — vence a mais restritiva. Quando a do header era apenas `connect-src 'self'`, fetches de fonts/imagens externos eram bloqueados. Lista mínima atualmente: `img-src` precisa de `venue-image.waze.com` (fotos de places) e `social-row.waze.com` (avatar do perfil); `connect-src` precisa dos mesmos + `fonts.googleapis.com` e `fonts.gstatic.com` (caso o SW velho intercepte antes de atualizar). **Sempre que adicionar um host externo na app, atualizar a CSP no `.htaccess` E no `<meta>` do `index.html`** — manter as duas em sync.

15. **Rank do editor é 0-indexed no Waze, +1 na UI** (regra de convenção sagrada deste projeto). O `/Session` do Waze retorna `rank: 0..5` mas humanos contam `1..6`:
    - **Toda exibição pro user** usa `rank + 1` (já implementado em `renderProfileHeader` como `'L' + (p.rank + 1)`)
    - **Toda comparação interna** usa o valor cru do Waze (`MIN_RANK_WAZE = 2` no gate = "display L3+")
    - **Mensagens de erro/permissão** que citam nível devem mostrar `rank + 1` pra não confundir o user
    - Owner disse explicitamente: "um editor nível 1 nos dados do Waze aparece como nível 0, um editor nível 6 aparece como nível 5"
    - Adicionou novo cálculo de rank? Confira nos dois lados (display vs comparação). Confundir os dois é fonte garantida de bug com erro silencioso (todo mundo permitido / ninguém permitido)

16. **Gate de acesso (`isUserAllowed` em `config.php`)**: a app só permite login pra editores **`isStaff` OU `(rank >= MIN_RANK_WAZE && isAreaManager)`**. Como o Waze usa rank 0-indexed e a UI mostra `rank + 1`, `MIN_RANK_WAZE = 2` significa "display L3+". Mudar o critério aqui afeta todo login. `testar-cookies.php` chama `/Session` como smoke test e nega `createSession` se não passar — frontend mostra modal `accessDeniedModal` com perfil do user e mensagem clara, sem persistir nada. Bloqueio acontece no backend; **não dá pra burlar editando JS**.

17. **Esquecer de bumpar `CACHE_NAME` do SW é o bug mais ranzinza do projeto**. Já aconteceu múltiplas vezes: PR adiciona feature em JS, deploy ok, mas users que já tinham o SW instalado **continuam vendo a versão velha por dias** porque SW é cache-first pra assets. Sintoma típico: "feature X parou de funcionar" relatado por um user, mas outros confirmam que funciona (cache deles é mais novo). **Cheque-list**: tocou em `index.html`, `js/*`, `css/*`, ou `icons/*`? → bump `CACHE_NAME` no `service-worker.js` E `APP_VERSION` no `js/app.js` juntos no mesmo commit. Se passou batido, basta um PR posterior fazendo só o bump pra liberar pra todos.

---

## 🛠 Workflows típicos

### Adicionar novo endpoint Waze
1. Adicionar helper de URL em `config.php` (`wazeXxxEndpoint($region)`)
2. Criar `api/xxx.php` seguindo o padrão dos outros (POST → `readJsonInput` → `getCookiesFromRequest` → `extractCSRFToken` → `createTempCookieFile` → `makeCurlRequest` → `categorizeWazeError` ou parsing direto)
3. Adicionar método em `js/api.js` (sempre passa `sessionToken` e `region` no body)
4. Usar em `app.js`
5. Documentar a tabela de endpoints neste CLAUDE.md
6. Bump `APP_VERSION` se for visível ao usuário

### Adicionar novo filtro
1. Backend: aceitar campo no payload de `buscar-places.php` e propagar pro `$payload` do cURL
2. HTML: adicionar input no `#filtersModal`
3. `app.js`: adicionar campo em `AppState.filters`, popular em `openFiltersModal`, ler em `applyFiltersFromModal`, propagar em `fetchNextPage`, persistir em `loadFilters`/`saveFilters`
4. Testar com fixture do HAR (ver seção "Validação sem Waze ao vivo" abaixo)

### Validar mudanças quando sandbox bloqueia o Waze
- Sintaxe: `for f in api/*.php; do php -l "$f"; done` + `node --check js/*.js`
- Lógica de parsing PHP: rodar script de teste que importa `config.php` e alimenta `categorizeWazeError`/`makeCurlRequest` com fixtures extraídas de HARs antigos
- Lógica frontend isolada: rodar em `node` com mocks de DOM (já tem exemplos nos commits anteriores)
- Endpoint roteamento: subir `./start.sh` e curl com `sessionToken` fake — esperar erro de Waze 403/401 e validar que o JSON de resposta tem o `errorCategory` certo

### Investigar bug reportado pelo usuário
1. Pedir HAR do Chrome/Firefox DevTools (sempre o owner manda)
2. Parsear com `jq` ou Python (cuidado, HARs costumam ter 5-20MB)
3. Olhar request payloads (o que **a app** enviou) e response bodies (o que **o Waze** devolveu)
4. Confirmar se é bug do app, do Waze, ou expectativa errada
5. Se for bug do app, reproduzir mentalmente o fluxo, adicionar defesa + try-catch onde fizer sentido, bump `APP_VERSION`

---

## 🔗 Decisões com link pro contexto

| Decisão | PR/Commit | Por quê |
|---|---|---|
| `start.sh` com `PHP_CLI_SERVER_WORKERS=4` por padrão | (vários, sprint Red Hat) | App travava com `php -S` puro |
| Sessão criptografada em `/tmp` (não em `api/`) | (deploy RHEL express) | Apache do RHEL tem PrivateTmp; zero permissão escrita no DocumentRoot |
| `.htaccess` ativo no repo (não `.htaccess.todo`) | (deploy RHEL express) | Mesma coisa: zero ação manual |
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
