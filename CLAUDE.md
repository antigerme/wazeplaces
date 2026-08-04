# CLAUDE.md

Contexto pra agentes Claude que trabalham neste repo. Diferente do `README.md` (público, focado em **editores do Waze** que vão instalar a app), este arquivo é **para você, IA**: arquitetura, convenções, gotchas, decisões já tomadas e workflows típicos.

**Sempre leia este arquivo antes de fazer mudanças não-triviais.**

---

## 🎯 O que é o projeto

PWA estilo Tinder para **editores do Waze Map Editor (WME)** limparem rapidamente os pedidos de places enviados por usuários comuns — fotos lixo, nomes ruins, endereços errados, categorias absurdas. Cards aparecem um por vez e o editor faz swipe.

**Regra de ouro de produto:** a app **NUNCA aprova** places, **só rejeita ou marca como lido**. Aprovar exige ajuste no mapa via WME oficial (link "↗ abrir no WME" em cada card resolve isso). Se você encontrar referência a "aprovar" no código ou docs, é bug — corrija ou pergunte.

**Regra de ouro de interface: GUI/UX primeiro, com M3 + HIG de régua SEMPRE.** Não é checklist de acabamento pra passar no fim — é o critério que decide **o que aparece na tela e quando**. Na prática, antes de dar qualquer coisa por pronta, olhe a tela no aparelho de verdade e pergunte:

- **Isto é acionável AQUI?** Nunca ofereça ação impossível no aparelho. Extensão de Chrome desktop num celular não é "opção de baixa prioridade" — é beco sem saída, e ainda por cima estava marcada como "RECOMENDADO". Reordenar resolve o que é *inconveniente*; o que é *impossível* tem que sair da frente.
- **O teclado virtual vai cobrir isto?** Todo campo de texto é um teclado esperando pra ocupar metade da tela. Modal centralizado com input vira modal invisível. Testar SEM abrir o teclado é não testar.
- **Isto interrompe sem ser chamado?** Banner que o navegador oferece (install prompt do PWA) é interrupção que o site pode e deve controlar — `beforeinstallprompt` + `preventDefault()`, e a ação vai pra um lugar previsível. M3/HIG: convite persistente que tapa conteúdo é anti-padrão.
- Alvo de toque ≥ 44px, ordem de botões (dismissiva à esquerda, afirmativa à direita), zoom nunca bloqueado, `reduced-motion` respeitado — esses já estão detalhados na seção **Padrões de UI**.

Já falhei nos três primeiros ao mesmo tempo, e o owner teve que apontar com print do celular. Se a única validação foi Playwright em viewport emulada, você não testou teclado nem prompt de instalação — diga isso em vez de dar por validado.

**Regra de ouro de consistência: o que a app MOSTRA e o que a app ACEITA são a mesma coisa — sempre, em qualquer dimensão.** Inconsistência não aparece como erro: aparece como o editor hesitando, digitando errado e achando que ele é que errou.

O caso que originou a regra: o pareamento mostrava o código como `6C4-97S` e pedia `ABC123` no campo. Quem copiava da tela não sabia se o hífen entrava. Só não quebrava por **duas coincidências** — o `maxlength` estava em 7 (dimensionado pro hífen, sem ninguém dizer isso) e o servidor limpava não-alfanuméricos. Bastava alguém "corrigir" o maxlength pra 6 e o fluxo travava no 7º caractere.

- **Formato**: quem mostra e quem lê passam pela MESMA função. Se o valor é apresentado agrupado/mascarado, o campo aceita e formata igual — nunca deixe o usuário adivinhar se o separador conta. `formatarCodigoPareamento()` em `app.js` é o modelo.
- **Termo**: o mesmo conceito tem UM nome em toda a app, e o mesmo nome em TODAS as línguas. Se mudou em uma tela, mudou em todas.
- **Ordem e posição**: dismissiva à esquerda, afirmativa à direita — em TODOS os diálogos, sem exceção "porque neste aqui fica melhor".
- **Ícone e cor**: o mesmo conceito usa o mesmo ícone e a mesma cor em toda a app (✕ rejeitar/rosa, ✓ lido/verde, ↑ pular/âmbar).
- **Unidade e formato de número/data**: sempre via `i18nLocale()`, nunca hardcode.

**Toda vez que você criar um par "isto exibe / aquilo recebe", pergunte: um usuário copiando o que vê consegue colar no que recebe, sem pensar?** Se a resposta depende de o servidor limpar o valor, está errado — limpeza no servidor é defesa, não contrato de interface.

PWA = instala no celular sem precisar de Play Store / App Store. Funciona offline para assets, online para API.

---

## 🏗 Stack & decisões fundamentais

| Camada | Escolha | Por quê |
|---|---|---|
| **Frontend** | HTML + JavaScript **vanilla** + Tailwind CSS | Zero build. Editor leigo baixa, roda, funciona. |
| **Tailwind** | **Pré-compilado** em `css/tailwind.css` (~34KB, COMMITADO) via `npm run css` | Zero build pra quem só roda a app (o CSS já está no repo). Tirou 407KB e o `unsafe-eval` da CSP. Mexeu em classe? `npm run css` (o CI cobra com diff). |
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
│   ├── styles.css           # Estilos custom (@font-face da Inter, componentes)
│   ├── tailwind.css         # GERADO por `npm run css` — commitado, NÃO editar à mão
│   └── tailwind.src.css     # Entrada (@tailwind base/components/utilities)
├── fonts/                   # Inter auto-hospedada (woff2 variável) + licença OFL
├── tailwind.config.js       # Config do build de CSS (darkMode: 'class', content)
├── CHANGELOG.md             # Histórico de mudanças voltado ao editor (não é git log)
├── js/
│   ├── mapa.js              # Mini-mapa de evidência (JS puro, zero dep): Mercator, escolha de zoom,
│   │                        #   encaixe em tile e posição dos marcadores. Tiles do PRÓPRIO Waze, camada
│   │                        #   `live/base` (não `editor/roads`). Testado em test/mapa.test.mjs sem browser.
│   ├── qr.js                # Gerador de QR (JS puro, zero dep): modo byte, correção M, versões 1–6.
│   │                        #   Só o pareamento usa. Verificado módulo a módulo contra o pacote `qrcode`
│   │                        #   em 106 entradas; vetores dourados em test/qr.test.mjs. Carregado antes do app.js
│   ├── version.js           # FONTE ÚNICA da versão: serial de zona DNS YYYYMMDDnn (APP_VERSION + verLabel). Carregado antes do app.js
│   ├── i18n.js              # i18n pt/en/es/fr (sem lib): I18N_DICT + t()/applyI18n()/setLang() + setI18nVars(). FONTE ÚNICA de strings de UI.
│   │                        #   LANGS_SUPORTADOS = Object.keys(I18N_DICT) — a lista de idiomas é o próprio dicionário. Carregado antes do app.js
│   ├── api.js               # Wrapper fetch() dos endpoints /api/* (única fonte de chamadas HTTP; SEM .php)
│   ├── app.js               # AppState, render, handlers, fila, prefetch, error handling
│   ├── swipe.js             # Gestos drag/swipe (esquerda, direita, cima)
│   ├── tema.js              # Aplica o tema ANTES do first paint. Externo (não inline) pra CSP
│   │                        #   poder proibir script inline. Vai DEPOIS do CSS: o paint já espera
│   │                        #   o stylesheet, então não custa nada (medido: 996 → 992ms de FCP)
│   ├── sw-register.js       # Registro/auto-update do service worker. Externo pelo mesmo motivo
│   └── (sem vendor: Tailwind é pré-compilado em css/tailwind.css)
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
├── tools/
│   ├── fixtures-paises.json # 51 pedidos REAIS dos 6 países obrigatórios, usados pelo smoke E pelo
│   │                        #   test/mapa-fixtures.test.mjs. Gerados medindo (não por heurística de
│   │                        #   volume — gotcha #52). `createdBy` anonimizado; o resto é dado público
│   │                        #   de mapa, e é ele que decide layout.
│   ├── paises-validacao.mjs # FONTE ÚNICA dos países de validação (ver seção 🌍). Script que MEÇA
│   │                        #   qualquer coisa importa daqui — copiar a lista é como ela volta a ser
│   │                        #   só o Brasil. Travado em test/consistencia.test.mjs.
│   ├── smoke-browser.mjs    # Smoke de layout (npm run test:browser): aparelhos × idiomas × tipos de card
│   ├── waze-jitter.mjs      # FONTE ÚNICA do ritmo das chamadas ao Waze: pausaComJitter().
│   │                        #   Script novo que fale com o Waze IMPORTA daqui, não reinventa sleep.
│   └── waze-probe.mjs       # Fala com o Waze REAL, só leitura (ver seção 🔑). Valida cookies,
│                            #   lista países/estados, sonda se Accept-Language é honrado.
│                            #   RECUSA /Features e /Issues/Read por construção e tem jitter
│                            #   aleatório (700–2200ms): as duas regras que protegem a conta do
│                            #   owner não dependem de eu lembrar delas.
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
npm run css            # SÓ se mexeu em classe do Tailwind (regenera css/tailwind.css; CI cobra)
node server/node.mjs   # smoke: sobe, serve estáticos, /api/* responde (401 sem sessão, etc.)
node tools/waze-probe.mjs <cookies.txt>   # OBRIGATÓRIO se mexeu em algo que fala com o Waze (ver 🔑)
```

**Os tipos REQUEST (UPDATE/FLAG/DELETE) saíram do gate de dev mode** em v2026.07.30-04, e o motivo importa pro próximo recurso que for solto: o gate custava caro e ninguém sabia. Medido na fila real do owner, **135 de 137 pedidos eram REQUEST** — um editor comum abria a app e via DOIS. Antes de abrir foi preciso: geometria virar distância legível (era `[object Object]`), lista virar diff `+/−`, os 3 tipos de reporte que existem de verdade ganharem tradução (o dicionário só tinha `INAPPROPRIATE`, que **não ocorre nenhuma vez**), `openingHours`/`entryExitPoints` pararem de vazar JSON, e o card de DELETE parar de repetir a própria frase. Auditado em **960 renders** (40 viewports do Chrome DevTools × 4 idiomas × 6 tipos de card, com pedido REAL) com zero problema. `enforceDevGatedFilters()` ficou como ponto de extensão, sem nada gated hoje. **Lição pro próximo gate**: meça quanto da fila ele esconde antes de deixá-lo fechado mais um mês.

**Auditoria de layout em TODOS os presets** (`scratchpad/presets.mjs`): 40 viewports distintos × 4 idiomas × 6 casos de card. Duas armadilhas de instrumento, ambas já corrigidas nele: (a) contar como "área rolando" qualquer `scrollHeight > clientHeight` acusa 148 falsos positivos, porque `overflow:hidden` com line-clamp satisfaz isso sem rolar — exija `overflow-y: auto|scroll`; (b) `eval(string)` no `page.evaluate` bate na CSP da app (que corretamente não tem `unsafe-eval`) e função como ARGUMENTO o Playwright não serializa — a medição vai INLINE no callback.

**Smoke de browser (`npm run test:browser`, roda no CI):** `tools/smoke-browser.mjs` renderiza o card em 5 aparelhos × 4 idiomas × 4 tipos de pedido e MEDE — rolagem dupla, alvo de toque < 44px, estouro horizontal, área rolável sem nome, caixa longa com teto fixo, português vazando fora do pt. Mora em `tools/` e **não** em `test/` de propósito: o `node --test` varre o diretório `test/` inteiro e o smoke precisa de browser — dentro de `test/` ele entrava no `npm test` e quebrava a promessa de suíte com zero dependência (já aconteceu). No CI o Playwright entra com `npm i --no-save` + `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, usando o Chrome que o runner já traz.

**Testar em BROWSER de verdade (existe Chromium no ambiente!):** o sandbox tem
Playwright + Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`,
`require('/opt/node22/lib/node_modules/playwright')`). Dá pra subir o
`server/node.mjs`, abrir a app, **injetar estado fake** (`AppState.queue`,
`showCurrentPlace()`) pra renderizar card/modais sem tocar o Waze, e tirar
screenshot. Foi assim que o A2 (dark mode) foi validado: capturar antes/depois e
comparar **pixel a pixel** (PIL disponível). Para refactor visual, essa é a
prova — não confie em leitura de código. Use um worktree
(`git worktree add --detach <dir> origin/main`) pro "antes" em vez de `git stash`.
CI (`.github/workflows/ci.yml`) roda check + test + boot smoke + **guard do bump de `CACHE_NAME`** (gotcha #17). **Gatilhos: `pull_request` e `push` só em `main`** — push em branch de agente NÃO roda CI. Já me enganei com isso: prometi "aviso o resultado do CI" depois de empurrar dois commits numa branch sem PR, e nenhum run existia pra reportar. Se a validação precisa ser do CI e não só local, **abra o PR** (o owner já autoriza isso na seção de workflow abaixo). A suite de testes usa só `node:test`/`node:assert` (built-in) e cobre cripto/sessão, `categorizeWazeError`, `isUserAllowed`, parsing de cookies e o filtro de domínio.

### 🌍 SEMPRE valide com estes PAÍSES (instrução permanente)

Toda medição de dado ou de layout usa o **máximo de países possível**, e estes **seis nunca faltam** — lista fechada pelo owner:

| país | `countryId` | por quê está aqui |
|---|---|---|
| **Brasil** | 30 | é o país do owner e a fila que ele tria |
| **França** | 73 | acento, nome longo, e o idioma que mais estoura layout (gotcha #25) |
| **Reino Unido** | 234 | endereço em formato completamente diferente |
| **México** | 145 | fila grande, espanhol |
| **Espanha** | 203 | espanhol europeu, muita foto |
| **Portugal** | 181 | português NÃO-brasileiro — o caso que derruba tabela de tradução |

**A lista mora em `tools/paises-validacao.mjs`, que é a FONTE ÚNICA** — script que meça qualquer coisa importa de lá, nunca copia (mesmo padrão do `waze-jitter.mjs`: instrução que depende da minha memória volta a ser esquecida). `test/consistencia.test.mjs` reprova se a lista mudar sem o teste ser revisitado, se um país entrar sem o motivo escrito, ou se esta seção sumir daqui.

Todos na região `row`. O owner **vê** os PURs de fora mesmo sem poder editar lá; como `buildPlacesFromSearch` (com razão) descarta venue sem permissão, a fixture de teste força `permissions: -1` — maquiagem de FIXTURE, nunca da app.

**Isto não é preciosismo, e o custo de ignorar já foi medido.** A auditoria de layout rodava só com a fila brasileira e dava zero problema. Com 12 países ela achou **26 pedidos que não cabem no Galaxy Fold, 17 deles `FLAGGED_PHOTO`** — tipo do qual a fila do Brasil **não tem NENHUM**. Um recurso inteiro passou por 1872 renders "sem problema" porque o dado que o quebra não existe no país onde eu media. Mesma família do gotcha #25 (a string mais larga quase nunca está no idioma em que você desenvolve), agora valendo pro DADO e não só pra tradução.

**E quando achar falha, meça os dois lados antes de culpar o recurso novo.** Os 26 acima apareceram junto com o mini-mapa e não foram causados por ele: medido contra `origin/main` com os MESMOS cards, 26 de 26 já estavam quebrados. Sem essa comparação eu teria desfeito o recurso errado.

### 🔑 SEMPRE valide contra o WME real, com os cookies do owner (instrução permanente)

**Isto não é "quando der" nem "se precisar": é etapa obrigatória.** Mexeu em qualquer coisa que fale com o Waze — endpoint, header, payload, parsing de resposta, formatação de campo que vem dele? Então valide contra o **WME real**, com o `cookies.txt` do owner, usando `https://www.waze.com/editor`. Palavras dele: *"quero SEMPRE que valide usando meus cookies e usando o https://www.waze.com/editor"*, e antes disso: *"sempre me peça meus cookies... isso pode nos economizar muito tempo entre indas e vindas de HAR pois você mesmo pode checar tudo sem precisar me perguntar."*

**Não tem cookies válidos? PEÇA.** Não desista, não caia no HAR, não conclua "não dá pra testar aqui" — essa frase esteve ERRADA neste repo por muito tempo (a allowlist não bloqueia mais o `waze.com`) e travou validação de verdade por meses.

**E não fique aconselhando o owner a trocar de cookie.** Ele decidiu o tradeoff, com o risco já explicitado: *"não se preocupe com meus cookies"*. Avisar uma vez é informar; repetir a cada entrega é ignorar a decisão dele. As regras de uso abaixo continuam valendo — elas protegem a conta dele, e disso ele não abriu mão.

Motivo: HAR é uma foto do passado, chega em 5–20MB, e cada dúvida nova custa outra rodada de pedido → export → upload → parse. Com cookies você responde na hora, e responde o que **de fato** acontece. Já se pagou na primeira vez: eu tinha afirmado que os nomes de país vinham em português por causa de `?language=pt-BR`, e estava errado nos dois pontos — o parâmetro não existe nesse endpoint e os nomes vêm **sempre em inglês**. Nenhum HAR teria mostrado isso, porque a pergunta era "o que muda se eu variar o header", e isso só se responde chamando.

**Como saber que expiraram** (Waze dura ~28 dias, e sair no WME rotaciona antes disso): `node tools/waze-probe.mjs <cookies.txt>` devolve HTTP 200 + perfil se valem (sai 1 se expirado, 3 se você tentar um path de escrita), e 403 `code: 101` "not allowed by guest user" se não. Ao detectar expirado, **peça de novo em vez de desistir e voltar pro HAR**.

**Regras de uso, não-negociáveis** — o `cookies.txt` do WME NÃO tem versão "só leitura": vem com `_web_session` + `_csrf_token` e `permissions: -1` (todos os bits). É credencial de **escrita** na conta do owner.

- **A URL do WME é SEMPRE `https://www.waze.com/editor`, sem segmento de idioma** (instrução permanente do owner). O Waze pode redirecionar conforme o idioma, e essa escolha é de quem abre — não nossa. Constante `WME_EDITOR_URL`, declarada em `js/app.js` e `server/core.mjs`. **Onde estava errado**: o link ↗ do card era `/pt-BR/editor` (um editor usando a app em francês caía num WME em português) e o `Referer` do `callWaze` também. **Medido antes de mexer no header**, porque este arquivo avisa que header errado quebra a comunicação: 4 endpoints × 6 variantes de Referer — com locale, sem locale, sem query, outro locale, **SEM o header** e **lixo** (`https://exemplo.invalido/nada`) — devolvem resposta **byte a byte idêntica**. O Waze não inspeciona o Referer nesses endpoints; cravar `/pt-BR/` só documentava errado de onde a chamada vinha. Depois da troca, o caminho real seguiu buscando (138 pedidos). E `/editor` responde **200 direto, sem redirect HTTP** — o redirecionamento por idioma é do lado do cliente.
- **SEMPRE jitter entre chamadas** (instrução permanente do owner, dita duas vezes: *"vá devagar nas consultas diretas ao WME, sempre use um jitter"*). Rajada é o padrão que faz um WAF marcar cliente, e **a conta bloqueada seria a dele** — o custo do meu descuido cai no acesso dele ao WME, não no meu. **Fonte única: `tools/waze-jitter.mjs`** — importe `pausaComJitter()`, NUNCA escreva um `setTimeout` seu. O modo errado de cumprir a regra é cada script inventar a sua pausa (foi o que eu fiz nos primeiros): script novo nasce sem, e ninguém percebe até o bloqueio chegar. Faixa **1500–4000ms**, subida de 700–2200 quando o owner pediu "devagar" pela segunda vez — na dúvida entre rápido e seguro o projeto escolhe seguro, porque o custo do excesso é meu tempo e o da falta é o acesso DELE ao WME. **Aleatório, não fixo**: intervalo constante é por si só assinatura de automação (medido: 3830 · 2995 · 2155 · 3886 · 3735ms, nenhuma repetida). O probe anuncia a espera estimada antes de começar, porque "parece travado" é o que faz alguém arrancar o jitter. **Não vale pro `callWaze` do `server/core.mjs`** — lá é UMA chamada por ação de um editor real, e atrasar de propósito quem está triando pedidos é pagar o custo no lugar errado. Jitter é pra script que varre, não pra app que atende. Script novo que fale com o Waze → copie o `pausaComJitter`, não invente um `sleep` fixo.
- **Só leitura.** NUNCA `/Features` (rejeitar) nem `/Issues/Read` (marcar lido) — são os dois caminhos que alteram dado real, e alteram no nome dele. O `tools/waze-probe.mjs` recusa esses paths de propósito, pra a regra não depender da minha memória.
- **Nunca imprima valor de cookie** em log, saída de teste, commit ou mensagem. Nome de cookie pode; valor não.
- **Nunca copie o arquivo** pra fora do diretório de upload, e nunca commite. Não existe caso de uso pra isso.
- **Relate o que foi VALIDADO, não o estado da credencial.** No fim, diga quais endpoints reais você exercitou e o que mediu ("login · perfil L6 · 138 pedidos · card em francês"). O owner já sabe que os cookies seguem válidos e pediu pra não ser lembrado disso.

**Sandbox/CI:** ~~allowlist bloqueia `*.waze.com`~~ — **não bloqueia mais** (medido em 2026-07-29: as respostas vêm do `Google Frontend` com `errorList` do próprio Waze). Caminho autenticado exige `cookies.txt` — e a regra é **pedir** (ver 🔑 acima), não contornar com HAR. Mas dá pra testar TUDO que não é o Waze: subir o `node server/node.mjs` e exercitar cripto/sessão/roteamento/erros e, com `cookies.txt` real, o caminho autenticado inteiro — foi assim que o idioma dos nomes de país foi medido).

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
6. Sessão expira em 21 dias **sem uso** (`SESSION_TTL` em `core.mjs`) — janela DESLIZANTE nos dois adaptadores: `loadSession` renova o prazo (carimbo `ts|blob` no valor, no máximo 1 escrita por `SESSION_REFRESH_AFTER`), e a VM ainda faz `touch` por mtime. Até v2026.07.31-01 o KV **não** renovava e a validade contava do login — gotcha #41. Cookies do Waze duram ~28 dias — TTL menor dá folga de 1 semana. Quando os cookies expiram de verdade, o backend devolve 401 e o frontend invalida a sessão local (`API.setSession(null)` + `showAuthScreen`)

**Contrato do "Sair" (decisão do owner, por PRIVACIDADE — não é conveniência):** *"se pedir para sair, é realmente para sair/limpar de tudo"*. Vale nos dois lados: `store.delete(sha256(token))` no servidor e todas as chaves do aparelho. Três consequências que já morderam:
- **Chave nova no `localStorage` precisa de decisão de logout.** O marcador do convite de instalar ficou pra trás por descuido. `test/layout.test.mjs` varre os literais `waze*` de `js/*.js` e reprova o que não estiver nem na tabela de apagadas nem em `MANTIDAS` (só tema e idioma ficam — apagar o idioma devolveria a pessoa a uma língua que ela pode não ler, justamente deslogada, sem o botão de Filtros).
- **A limpeza local NÃO espera rede.** O token é copiado, o armazenamento é limpo na hora (medido: 26ms) e a exclusão remota vai depois. `API.destroySession(token)` aceita o token explícito por isso — sem ele a retentativa sairia pelo `if (!sessionToken)` fingindo sucesso.
- **A exclusão remota não pode falhar calada.** O `_post` devolve erro em vez de lançar, então a rede fora deixava o blob no servidor sem ninguém saber. Hoje passa por `callWithRetry` e, se ainda falhar, o editor recebe `toast.logoutServerFailed` — o blob fica órfão (a chave é o hash do token, que já foi embora) e expira em até 21 dias.

**E sair da app NÃO invalida os cookies no Waze** — só o WME faz isso. O diálogo de logout diz isso com link, porque quem sai preocupado com privacidade conclui o contrário. O aviso de privacidade da Ajuda (`help.privacy.*`, 7 itens em todas as línguas) cobre GDPR Art. 13 / LGPD Art. 9 e nomeia o contato para direitos (LGPD Art. 18). **Dados de terceiros no card** (nome de quem enviou, fotos): o owner consultou colegas e **fechou como resolvido para projeto de comunidade** — a app é cliente de dados que o editor já acessa no WME e nada é retido, ainda que o servidor busque e repasse. **Canal de contato**: fica como está — o perfil do WME notifica por e-mail e dentro do Waze, então já existe caminho de resposta; não criar um segundo canal pra manter.

**Chave de criptografia:** Secret `ENCRYPTION_KEY` (base64, 32 bytes) no Cloudflare; env var ou arquivo `0600` auto-gerado na VM. **Nunca commitada.** O core não sabe de onde vem — o adaptador injeta `keyBytes` em `makeSessions({ store, keyBytes })`.

---

## 🌐 Endpoints proxy → Waze

Todos os handlers em `server/core.mjs` são **proxies stateless**: recebem `sessionToken`, carregam os cookies criptografados do store, fazem `fetch` ao Waze (via `callWaze`), normalizam a resposta. Roteados por `dispatch(name, data, { sessions })`. O nome do endpoint é **sem `.php`** (o dispatch tolera sufixo `.php` por compat de cache antigo). Multi-região (`row`/`na`/`il`/`world`) via helpers em `core.mjs` (`wazeIssuesEndpoint`, etc).

| App endpoint | Waze endpoint | Notas |
|---|---|---|
| `sessao` | — (apenas local) | `action: create\|destroy` |
| `parear` | — (apenas local) | **QR é o caminho principal** (`js/qr.js` desenha o link `?pair=` num canvas): aponta a câmera e entra, sem instrução nenhuma. O código de 6 chars ficou como alternativa pra quem não tem câmera. Cada tela explicando o OUTRO aparelho era o sintoma de que a interface não se explicava sozinha. `action: create\|claim`. Pareamento computador→celular: `create` exige sessão e devolve código de 6 chars (alfabeto sem 0/O/1/I, TTL 5min, uso único); `claim` troca o código por uma sessão NOVA. Existe porque copiar cookies no celular é inviável. Validade vai DENTRO do valor guardado, não só no TTL do store — o adaptador de arquivo da VM ignora o TTL do `put`. |
| `testar-cookies` | `Session` (smoke test + gate) | Valida, checa `isUserAllowed`, cria sessão e devolve token |
| `buscar-places` | `/row-Descartes/app/v1/Issues/Search/List` | Aceita `page`, `countryId`, `stateId`, `managedAreaId`, `bbox`, `types[]` (os 7 tipos do WME — ver `PUR_TIPOS`/`purTypeDoUR`; o corte é NOSSO, ver gotcha #49), `categories[]`, `residential`, `unreadOnly`. Envia `orderBy: SORTING_UPDATE_TIME_DESC`. |
| `marcar-lido` | `/row-Descartes/app/v1/Issues/Read` | Aceita single (`venueID`+`updateRequestID`) ou batch (`items[]`) |
| `validar-place` | `/row-Descartes/app/Features` (sempre `approve: false`) | Único caminho de "rejeitar" |
| `perfil` | `/row-Descartes/app/Session?language=pt-BR` | Extrai bbox de `areas[].geometry.coordinates` |
| `lista-paises` | `/row-Descartes/app/LocationSearch/Countries` | Nomes vêm **sempre em inglês** (ver nota abaixo). Ordem base no servidor; o cliente reordena na colação do idioma (`ordenarPorNome`) |
| `lista-estados` | `/row-Descartes/app/LocationSearch/States?countryId=N` | Nomes vêm no idioma **local** (Amapá, Ceará) — é o nome próprio. Idem ordenação |

**Em que idioma o Waze devolve os nomes — MEDIDO, não suposto** (248 países, cookies reais, `scratchpad/idioma-do-waze.mjs`): **país sempre em inglês** (`France`, `Germany`, `Spain`), e o Waze **ignora** `Accept-Language`, o `Referer` com locale e o `?language=` nesses endpoints — as quatro variantes devolvem byte a byte a mesma coisa. **Estado vem no idioma local** (`Amapá`, `Ceará`), que é o nome próprio: não há tradução a fazer. Consequência prática: **não existe conserto pelo header** — mexer no `Accept-Language` do `callWaze` não mudaria nada, e um editor brasileiro também lê "Germany". Se um dia isso incomodar, o caminho é tabela de tradução de país no dicionário (por `abbr`/ISO), não o header. **E não confunda com CATEGORIA**, que é problema diferente e provavelmente sem solução por tabela: o owner deu o argumento que fecha a questão — o Waze regionaliza categoria por PAÍS, não por idioma, e o mesmo idioma diverge entre países (`ônibus` no pt-BR × `autocarro` no pt-PT). Uma tabela por idioma erra em metade dos países que falam esse idioma, então nem a chave `pt` resolve. Enquanto não houver fonte de regionalização do próprio Waze, categoria sai CRUA — ver gotcha #39. **O que ERA defeito de verdade** e foi corrigido: o servidor ordenava com `localeCompare(..., 'pt-BR')` cravado, aplicando regra portuguesa à lista de qualquer editor. Ordenar migrou pro cliente (`ordenarPorNome`, via `i18nLocale()`). Note que hoje isso **não muda um pixel**: com só 3 nomes acentuados (`Curaçao`, `Côte d’Ivoire`, `Saint Barthélemy`), pt/en/es/fr dão ordem idêntica — a divergência aparece em colação diferente (medido: sueco difere no índice 52, Å/Ä/Ö no fim do alfabeto). Está no cliente porque a decisão pertence a quem sabe o idioma, não porque resolve algo hoje.

**O sandbox ALCANÇA o `waze.com`** (corrige a nota da seção "Como rodar local", que dizia o contrário): a resposta com credencial falsa é um erro **do Waze** (`server: Google Frontend`, `errorList[0].code: 101`, "not allowed by guest user"), não `403 Host not in allowlist`. O que falta é credencial, não rota — então dá pra testar contra o Waze real assim que o owner mandar um `cookies.txt`. O texto de erro da API **não** é localizado (sempre inglês, testado em pt/fr/es/de/he), então não serve como sonda de idioma.

**Headers críticos no `fetch` ao Waze** (em `callWaze`): `Cookie: <montado dos cookies salvos>`, `Referer: https://www.waze.com/pt-BR/editor?env=<env>&tab=issue_tracker`, `X-CSRF-Token: <extraído dos cookies>`, `Origin`, sec-ch-ua-*, sec-fetch-*. Mudar isso quebra a comunicação. O `env` segue tabela `row → row`, `na → usa`, `il → il`, `world → row` (em `wazeRefererEnv`).

### Resposta do `buscar-places`

Volta `{ success, places[], hasMore, page, total }`. Cada `place`:
```js
{
  venueID, updateRequestID,
  name, categories[], address, updateType,
  reqType, reqSubType, createdBy,
  purType,                    // Qual dos 7 tipos do WME (NEW_PLACE, DETAILS_UPDATE,
                              //   FLAGGED_PLACE, DELETE_PLACE, NEW_PHOTO, FLAGGED_PHOTO,
                              //   DELETE_PHOTO). É o que o FILTRO usa, e sai de
                              //   `purTypeDoUR` — fonte única da classificação.
                              //   **Não confundir com `updateTypeKey`**, que é o RÓTULO
                              //   DO CARD: aquele separa UPDATE de UPDATE_DETAILS (há ou
                              //   não diff pra mostrar) e NÃO separa reporte de local do
                              //   de foto. Granularidades e propósitos diferentes.
  source,                     // De onde o pedido saiu. **Só o tipo REQUEST tem** — VENUE
                              //   (local novo) e IMAGE (foto nova) NUNCA trazem, e isso não
                              //   é bug nosso nem regressão (ver gotcha #48). 4 valores:
                              //   MOBILE_CLIENT, WEB, MOBILE_WEB, REPORTING_AGENT. O 5º,
                              //   SOURCE_UNSPECIFIED, o core DESCARTA — o próprio WME não
                              //   o exibe. Traduzido no frontend por `card.source.<ENUM>`,
                              //   com a redação oficial do WME no `.title`.
  imageUrl, imageUrls[],
  brand, brandKnown,          // brandKnown vem de lookup em categoryBrands da resposta
  flagType,                   // FLAG: motivo CRU do Waze (INAPPROPRIATE…). Traduzido no
                              //   frontend via `card.flagType.<ENUM>`; enum não mapeado
                              //   aparece cru. É a informação PRINCIPAL do reporte —
                              //   `flagComment` (texto livre) quase sempre vem vazio.
  flagSubjectType,            // FLAG: IMAGE = denúncia de FOTO, não do local
  flagEntityID,               // FLAG: id da foto denunciada; casa com venue.images[].id
                              //   (é assim que o card marca qual das N fotos é)
  changes[],                  // [{ field, label, from, to }] para UPDATE requests.
                              #   **Valor objeto vira "[object Object]" se ninguém formatar.**
                              #   `formatValue` tratava null/boolean/array; objeto simples caía no
                              #   `String(value)`. O `geometry` do Waze é GeoJSON, então TODA mudança
                              #   de posição aparecia como "[object Object] → [object Object]" — em
                              #   qualquer idioma, pra todo editor. Medido em fila REAL: 33 de 142
                              #   pedidos. Nenhuma fixture pegava, porque fixture muda string. Hoje
                              #   `formatGeometry` dá "lat, lon" (Point) e "lat, lon · N pts"
                              #   (Polygon/MultiPolygon); `formatValue` cai em `JSON.stringify` pra
                              #   qualquer outro objeto — feio, nunca invisível. **A contagem de
                              #   vértices não é enfeite**: sem ela, polígono alterado nos vértices
                              #   seguintes formata IGUAL ao anterior e a tela afirma que nada mudou
                              #   — pior que ser feio. Apareceu no 1º teste com dado real (11→12 pts).
                              #   **Aberto**: `changedVenue` não é diff e a app não filtra linha com
                              #   `from === to` — 15 de 140 pedidos mostram "X → X" (12 geometria).
                              #   Filtrar é decisão de produto; se for, compare o valor CRU, porque
                              #   polígono diferente pode formatar igual.
                              //   `ur.changedVenue` NÃO é um diff: é um venue com os
                              //   valores propostos, então vem com escrituração junto.
                              //   `CAMPOS_ESCRITURACAO` (core.mjs) tira id/updatedOn/
                              //   updatedBy/createdOn/createdBy/permissions. É lista de
                              //   EXCLUSÃO: campo novo aparece com nome cru, nunca some.
  mapa,                       // Evidência ESPACIAL pro mini-mapa: { centro, proposto, movidoM,
                              //   entradas[{ll, estado, nome, distM}] }. Vai em TODO tipo de
                              //   pedido — "onde fica isto" é pergunta de todos. `null` só quando
                              //   não há coordenada nenhuma (o card então não monta o slide, em
                              //   vez de desenhar um mapa do oceano no ponto (0,0)).
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
  preferences,            // undoEnabled — toggle no modal "Filtros e Preferências", persiste em localStorage waze_places_preferences. Sujeito a gate de experiência: novatos não podem desligar até bater cota ceil(UNDO_GATE_BASE/(rank+1)) de read+rejected, UNDO_GATE_BASE=120 → L1 120 · L3 40 · L6 20 (staff isento). Ver canDisableUndo(). **Desbloqueio avisa**: `checkUndoGateUnlock()` (chamado de `updateStats`) dispara confete + toast dourado clicável que abre a aba Preferências com a linha destacada. Marcador `preferences.undoGateSeen` garante uma vez só; quem JÁ estava acima da cota nasce com `seen=true` (`initUndoGateSeen`), pra ninguém ser parabenizado por trabalho anterior ao deploy. Usa a comparação crua `tratados >= cota`, NÃO `canDisableUndo()` — este devolve true com dev mode e dispararia falsa conquista. **Mas aviso de transição não alcança quem já passou**: `initUndoGateSeen` silencia justamente os editores mais ativos (relatado por um deles — "nunca soube que existia"), que são os que mais perdem com a espera. Daí a **dica por comportamento**: `registrarJanelaSemUndo()` conta janelas do Desfazer que expiraram sem ninguém desfazer (só a expiração NATURAL — `execute()` forçado não dá a janela inteira e inflaria a evidência), `undo()` zera, e em `DICA_SEM_UNDO` o `checkDicaDesfazer()` oferece desligar. Só dispara se `canDisableUndo()` — oferecer o que o gate bloqueia é beco sem saída. **O limiar é orçamento de TEMPO, não número escolhido a dedo**: `ceil(ESPERA_DESPERDICADA_ANTES_DA_DICA_MS / UNDO_WINDOW_MS)` = 60000/3000 = 20 hoje. Janela que expira sozinha custa exatamente `UNDO_WINDOW_MS` de tela travada (`acoesTravadas()` barra tudo), então mexer na janela reajusta o limiar sozinho — o que a app promete é o minuto, não o vinte. **Rank não entra**, ao contrário da cota do gate: cota mede COMPETÊNCIA (rank é proxy razoável), a dica mede PREFERÊNCIA revelada pelo comportamento — existe L6 cauteloso e L1 apressado. E escalar por rank disparia na hora justamente pra quem a dica existe: `stats` é acumulado, então quem já está muito acima da cota satisfaz `cota + N` antes de tocar em nada, sem evidência alguma. A duração na frase vem de `UNDO_WINDOW_MS` via `{undoSeg}` (ver **i18n**) — estava cravada à mão em duas chaves × cada língua. Cruzar a cota marca `dicaDesfazerVista` junto, senão os dois banners saem quase juntos dizendo o mesmo (o L6 passa em 20 pedidos, dá empate). Tipo de toast `'hint'`: banner do topo como a conquista, cyan em vez de dourado — informar não é comemorar.
  devMode,                // { unlocked, active } — easter egg estilo Android. 7 taps na versão do rodapé desbloqueia; toggle no modal "Avançado" ativa. Quando active=true, canDisableUndo() retorna true (bypassa o gate). NÃO é segurança — qualquer um seta via DevTools; só esconde de usuário comum. handleLogout limpa ambas as flags.
  profile, countries, statesByCountry
}
```

Constantes em `app.js`:
- `UNDO_WINDOW_MS = 3000` — janela de undo antes de a ação ser enviada ao Waze (só aplica se `AppState.preferences.undoEnabled === true`, padrão; quando desativado em `scheduleAction`, o executor roda na hora). Banner mostra countdown visual (`.undo-progress`). **Enquanto a janela corre, NADA prossegue**: `acoesTravadas()` barra os três caminhos (botão, gesto e tecla) e os botões ficam `disabled` + acinzentados (`.acoes-travadas`) — botão morto com cara de vivo lê como app quebrada. Antes dava pra tratar o próximo, o que despachava o anterior sem aviso; e por acidente de layout o banner cobria os botões em **6 de 8 aparelhos** medidos, então o comportamento mudava com a tela. Decisão do owner, custo MEDIDO (não estimado): 2431ms por pedido travado contra 33ms sem trava — 200 pedidos ≈ **8,1 min** de espera pura. Desligar o Desfazer tira a janela inteira. Cuidado ao medir: `undoEnabled: false` sozinho NÃO desliga — `canDisableUndo()` também precisa da cota, senão você mede a mesma coisa duas vezes (aconteceu). **Sair da página nessa janela descarrega a ação** (`descarregarAcaoPendente`, em `pagehide` e ao esconder a aba) com `keepalive` — sem isso a ação sumia com o placar já incrementado e salvo. `test/version.test.mjs` trava a paridade deste número com o doc: ele já esteve escrito aqui como 5000 enquanto o código dizia 3000
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
- **Placar** (`#placar` / `#placarGrid`) — um nome só, em código, doc e conversa: grid de 4 colunas `Lidos · Rejeitados · Pulados · Restam`. Números com `.tnum` (tabular) e shades -600+ no light (contraste WCAG). **Não é alvo de toque**, então a régua de 44/48px não se aplica aqui — o que vale é rótulo ≥ 11px e espaçamento na grade de 8dp. Foi compactado em v2026.07.27-12 (87 → 67px) porque o produto da app é o card: cada pixel acima dele é pixel a menos de foto. As chaves de i18n seguem `stats.*` e os contadores `#readCount…` — escopo diferente, renomear chave de dicionário é risco sem ganho
- **Vão percebido se mede até a TINTA, não até a caixa.** O owner insistiu que o espaço entre a barra fixa e o placar era grande depois de eu já ter "compactado" — e estava certo: eu media a margem CSS (24px), mas o olho mede a distância até o primeiro pixel do número, que somava margem + padding do cartão + borda + entrelinha = **35px**. Meça com `Range.getBoundingClientRect()` do texto, não `getBoundingClientRect()` do elemento. Hoje: `pt-2` no `<main>` → 19px até a tinta.
- **Espaçamento da tela do card vem de `gap` no `#appScreen`, não de `space-y-*`**: o utilitário põe margem em todo filho a partir do 2º, e os dois elementos `sr-only` (absolute, invisíveis) contavam como irmãos — o placar levava 16px de margem por causa de coisa que ninguém vê. `gap` de flex ignora filho absolute. A regra está em `styles.css` com `:not(.hidden)` porque `display:flex` como utility disputaria com o `hidden`
- **Identidade do card: nome → endereço → `(local sem nome)`** (`identidadeDoPlace` em app.js). Sem nome, o ENDEREÇO vira o título — é o que identifica, e é o padrão do Google Maps pra ponto sem nome; antes "sem nome" ocupava o slot de 1.35rem e o endereço ficava em cinza pequeno abaixo. A ausência não some: vira o selo `.card-no-name-badge`, porque num pedido de place ela é informação de decisão. Endereço promovido não repete na linha de baixo (`.card-address-row` some) e é calibrado a 1.1rem/4 linhas — em 1.35rem/2 ele truncava o estado.
- **Placeholder SEMPRE entre parênteses + `.valor-ausente`** (itálico esmaecido, via `escreverValor`). **O esmaecido é MEDIDO, não escolhido a olho**: `opacity` em texto mistura a cor com o fundo e derruba o contraste, e `getComputedStyle().color` não conta isso. Nasceu em `0.65` e deu **3.79:1** no tema claro — reprovado no WCAG 1.4.3 (mín. 4.5:1). Tabela medida sobre branco: `0.65→3.79 ✗ · 0.70→4.35 ✗ · 0.75→4.95 · 0.80→5.74`. Hoje é `0.8`. O escuro sempre passou. O `tools/smoke-browser.mjs` mede contraste de todo `.valor-ausente` nos DOIS temas a cada PR — não confie no número do CSS sozinho. Um local pode se chamar "sem nome"; ninguém batiza um de "(desconhecido)" — então os parênteses RESOLVEM a ambiguidade, não só sinalizam. E são texto, então leitor de tela lê; o itálico é reforço, porque estilo sozinho não transmite informação (WCAG 1.4.1). Placeholder novo → parênteses em todas as línguas + `escreverValor`.
- **Card** (`<template id="cardTemplate">`): imagem (+ nav prev/next se múltiplas) → nome → categorias → endereço → tipo/criador → brand + selo (✓ conhecida / ? não listada via `categoryBrands` da resposta do Waze) → mudanças propostas (diff antes/depois para UPDATE requests) → **barra de botões ✕/↑/✓** (`.card-btn-reject/skip/read`). Gesto é atalho; botão é o caminho canônico e acessível — NÃO remover os botões
- **O `.card-content` é UMA coluna flex com `gap-3`, e nela só a caixa longa rola.** Linha de altura previsível → `flex-shrink-0`; caixa longa (`.card-changes` OU `.card-flag-comment`) → `flex-1 min-h-0`, com o corpo (`.card-changes-list` / `.card-flag-comment-text`) em `flex-1 min-h-0 overflow-y-auto`. Elemento novo no card → decida em qual dos dois grupos ele está; sem `flex-shrink-0` ele vira o alvo do encolhimento no lugar da caixa longa (gotcha #29). Área rolável nova → entra TAMBÉM na lista de exceção do `handleDragStart` (`js/swipe.js`) e ganha `marcarBordaRolagem`, senão o arraste engole a rolagem e nada avisa que dá pra rolar
- **Camadas (z-index)**: card/esqueleto `z-50` · **banner do topo `z-[55]`** · modais `z-[60]` · lightbox `z-[65]` · toasts `z-[70]`. **Banner (topo) × snackbar (rodapé)** é distinção do M3, não estética: snackbar confirma o que você ACABOU de fazer e some rápido; banner é proeminente, tem ação e fica mais tempo. O aviso de conquista é banner — e no rodapé ele tapava os três botões do card por 8s em 2 de 3 aparelhos (gotcha #26). O `#bannerStack` se ancora em `--header-h`, MEDIDO por `ResizeObserver` no `setupAlturaDoHeader()`: o header cresce com a safe-area do iPhone e com a fonte do sistema, então número fixo erraria em algum aparelho. **Nunca empate com o `#loadingCard`**: ele e os modais ficaram os dois em `z-50` por muito tempo e, como o esqueleto vem depois no HTML, ele tapava o MEIO do modal — abrir Filtros durante a busca mostrava diálogo pela metade. Modal novo → `z-[60]`.
- **Convite de instalar (`#installInvite`) mora no "Tudo limpo!", e só ali.** É o único momento da app em que o editor TERMINOU algo: não há próximo gesto esperando, e a tela já é de festa (mesmo motivo do confete). Convite em qualquer outro lugar disputa com o swipe — e o banner que o navegador oferece sozinho é interrupção que o site deve controlar (`beforeinstallprompt` + `preventDefault()`, guardado em `promptInstalacao`). Três estados, em `convitePodeAparecer()`: com prompt → botão; **iOS sem prompt → passos manuais** (o Safari NUNCA dispara `beforeinstallprompt`, e sem isso o iPhone fica sem caminho nenhum — o QR do pareamento empurra justamente pro celular); já instalada (`display-mode: standalone` **ou** `navigator.standalone`) ou dispensada (`waze_places_install_dispensado`) → nada. Precisa dos DOIS sinais de "já instalada": cada um cobre metade dos aparelhos.
- **Tela de entrada se adapta por PONTEIRO, não por largura** (`@media (pointer: coarse)` em styles.css, classes `.auth-opt-*` com `order`). No dedo, "Entrar com um código" vai pra 1º e ganha estilo primário; upload/colar/extensão descem. **REORDENA, não esconde** — se a detecção errar, tudo continua alcançável. Largura seria pior: janela estreita no desktop continua sendo desktop.
- **Texto de auth é NEUTRO de aparelho** ("Conectar outro aparelho", não "Usar no celular"). O mesmo HTML roda nos dois, então texto que assume o dispositivo aparece justamente no lugar errado.
- **O VOLTAR do aparelho fecha a camada de cima** (`CamadaVoltar` em `js/app.js`), tanto lightbox quanto modal. Veio de retorno de uma editora: no ritmo do swipe, ir até o ✕ quebra a cadência. **Vale para os dois de propósito** — fazer só no lightbox seria PIOR que não fazer, porque a pessoa aprenderia que voltar fecha, tentaria em Filtros e sairia da app perdendo os filtros. **O detalhe que decide se ajuda ou atrapalha é CONSUMIR a entrada** quando a camada fecha por outro caminho (✕, Esc, scrim, arrastar): sem isso sobra entrada morta e o próximo voltar não faz nada — a pessoa aperta, vê a tela parada, aperta de novo e sai da app. Por isso `close()`/`closeModal()` recebem `viaHistorico` e o `popstate` distingue o pop que nós causamos (`CamadaVoltar.consumindo`) do pop do usuário. **Trocar de modal não empilha** (`openModal` só empilha se não havia modal aberto), senão um voltar fecharia nada. iOS em standalone não tem voltar — lá o ✕ e o arrastar pra baixo seguem sendo o caminho; isto ADICIONA um jeito, não substitui.
- **Modais**: SEMPRE via `openModal(id)`/`closeModal(id)` (app.js) — cuidam de foco, Esc, clique no scrim e scroll-lock. **Limpeza de estado do modal vai em `LIMPEZA_AO_FECHAR[id]`, nunca no handler do botão**: modal fecha por TRÊS caminhos (botão, Esc, scrim) e amarrar a limpeza a um deixa os outros dois vazando — foi assim que o ticker do pareamento seguia rodando pelo resto da sessão e o QR de uma credencial morta ficava desenhado no canvas. Modal novo → adicionar id em `MODAL_IDS` + `role="dialog" aria-modal="true" aria-labelledby`. Ordem de botões: dismissiva à esquerda, afirmativa à direita (M3/HIG)
- **Modal "Filtros e Preferências" é TABBED** (3 abas WAI-ARIA: Filtros | Preferências | Histórico — `FILTER_TABS`/`switchFilterTab` em app.js, `.seg-tabs` em styles.css). Rodapé é **contextual**: Cancelar/Aplicar só na aba Filtros; as outras mostram "Fechar". **Preferências (idioma/undo/dev mode) aplicam NA HORA via change listener** — não passam pelo `applyFiltersFromModal` (que é só da aba Filtros). Campo de filtro novo → aba Filtros; preferência nova → aba Preferências + listener próprio. Abre sempre na aba Filtros
- **Snackbar/toast**: `showToast(msg, type, durationMs=4000)` — bottom-center no `#notifyStack` (respeita safe-area), clique dispensa, `aria-live` no container. Undo banner vive no mesmo stack
- **Switches vs checkboxes**: preferência on/off = `<input type="checkbox" class="ui-switch">` (estilo M3, JS lê `.checked` normal); seleção múltipla (tipos) = checkbox com `accent-cyan-600`
- **Tema**: segue o sistema até o user tocar no toggle (aí persiste em `localStorage.waze_places_theme`). `applyTheme` também atualiza `<meta name="theme-color">`. Dark mode: usar variantes `dark:` do Tailwind no HTML em código novo; os overrides `!important` do styles.css são legado
- **Safe areas (iOS PWA)**: header tem `padding-top: env(safe-area-inset-top)`; `#notifyStack`/footer usam `env(safe-area-inset-bottom)`. Não criar elemento fixed sem considerar isso
- **Zoom NUNCA bloqueado** no viewport (WCAG 1.4.4). Lightbox tem pinch/double-tap/wheel zoom + swipe pra trocar/fechar
- **Reduced motion**: media query global em styles.css zera animações — não criar animação essencial sem fallback estático
- **Animação NUNCA entra entre o swipe e o próximo card.** O valor da app é ritmo: 200 pedidos × 300ms de cerimônia = 1 minuto de espera pura. Animar só onde o tempo já ia ser gasto — durante o arraste (selos), na entrada do card (paralela ao próximo gesto), ou no "Tudo limpo!" (não há próxima ação esperando). Os selos (`.swipe-stamp`) ficam na **borda oposta** ao gesto de propósito: ancorados na borda que se move, saem da tela junto com o card (já apareceu "EITAR" cortado). Idem o gradiente — a cor vive no lado que fica.
- **Contador que muda de 1 não conta, PULA.** Entre 12 e 13 não existe inteiro pra mostrar: contar é invisível. `setCount` pula (`.count-pop`) sempre que o número muda e só conta quando |Δ| ≥ 2 (ex.: fila carregando 0 → 191).
- **Versão visível**: fim do modal de Ajuda, `v{verLabel(APP_VERSION)}` (ex.: `v2026.07.18-01`) — sempre bump o serial em mudança visual (formato `YYYYMMDDnn`, ver seção do Service Worker). Morava num `<footer>` fixo até v2026.07.27-05; saiu porque custava 40px de rolagem em toda tela e **não devolvia um pixel de card** (o card é `dvh`, não sobra de layout) — num 393×852 esses 40px eram 65% de toda a rolagem, e rolagem disputa com o gesto de "pular". O botão ⓘ está no header **inclusive deslogado**, que é exatamente quando se pergunta "qual versão você está vendo?"

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
- ⚠️ **RODE `date -u +%Y%m%d` ANTES DE BUMPAR.** O serial é `data + revisão`: em dia novo o certo é **zerar a revisão** (`2026072403` → `2026072501`), não seguir incrementando (`…04`). Já aconteceu: dois deploys do dia 25 saíram carimbados como 24 e o rodapé passou a mentir sobre a data — a única coisa que este esquema promete entregar. **Agora tem trava no CI**: num PR que mexe em `js/version.js`, a data do serial precisa bater com a do **commit HEAD do PR**. É comparado com o commit, e não com "hoje", de propósito — "hoje" falharia sozinho num PR aberto num dia e mergeado no outro, e CI que falha sem culpa treina todo mundo a ignorar CI. Se o seu PR atravessou a meia-noite, re-bumpe. A auditoria `test/version.test.mjs` ainda cobre calendário impossível (`20260231`) e data no futuro.
- HTML: **network-first** (sempre tenta fresh, fallback cache); assets: **cache-first**
- `/api/*` NÃO é interceptado (sempre vai direto à rede)
- **Auto-update**: detecta nova versão via `registration.updatefound` → posta `SKIP_WAITING` → `controllerchange` dispara reload **apenas se já havia controller anterior** (evita flicker na primeira instalação)
- **Versionamento = serial de zona DNS (RFC 1912): `YYYYMMDDnn`** (data + revisão do dia; ex.: `2026071801` = 1ª revisão de 2026-07-18). Fonte única: `APP_VERSION` em **`js/version.js`** — carregado como `<script>` clássico ANTES do `app.js`, expõe `APP_VERSION`/`verLabel` no escopo global (como o `API` do api.js). O `CACHE_NAME` do `service-worker.js` é `'waze-places-' + o MESMO serial` (hardcoded). A auditoria `test/version.test.mjs` trava paridade + formato no CI. O `#appVersionDisplay` (fim do modal de Ajuda) mostra `verLabel()` → `v2026.07.18-01`. Cresce sempre, compara como número, e diz DE QUANDO é a versão só de olhar. (Ideia trazida do projeto botequei.)

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

### i18n (pt/en/es/fr) — REGRA PERMANENTE
- **TODA string de UI nasce em `js/i18n.js`, em TODAS as línguas (hoje pt/en/es/fr).** Nunca hardcode texto pt no HTML ou no JS.
- **UM idioma por língua — variante regional NUNCA é idioma separado** (decisão do owner). Só se vê `pt`, `en`, `es`, `fr`: nada de `pt-BR` ao lado de `pt-PT`, nem `fr-FR` ao lado de `fr-CA`. Variante do NAVEGADOR colapsa no idioma (`resolveLang` corta em 2 letras — medido: `fr-FR`, `fr-CA`, `fr-BE`, `fr-CH` todas dão `fr`; `pt-PT` e `pt-BR` dão `pt`). Variante como CHAVE seria um segundo francês no seletor, com dicionário próprio pra manter em paridade — custo alto, ganho nenhum. **Regional é legítimo só como VALOR do `LOCALE_POR_LANG`** (`pt: 'pt-BR'`), que é o locale de `Intl`/`toLocaleString` — coisa diferente da identidade do idioma. `test/i18n.test.mjs` reprova chave de idioma que não seja `^[a-z]{2}$` em `I18N_DICT`, `LANG_NOMES` e `LOCALE_POR_LANG`. **Resíduo conhecido**: `<html lang>` recebe `i18nLocale()`, então sai `pt-BR` no português e `fr` no francês. Não uniformizei porque, pra leitor de tela, `pt-BR` é MELHOR que `pt` (pronúncia), e a UI portuguesa da app é brasileira mesmo — mas é uma assimetria, e a decisão é de produto.
- **A lista de idiomas é o próprio dicionário.** `LANGS_SUPORTADOS = Object.keys(I18N_DICT)`; os `<option>` dos dois seletores saem de `LANG_NOMES` (nome NA PRÓPRIA língua — não se traduz "English") e o locale de `toLocaleString` sai de `LOCALE_POR_LANG`. Antes havia whitelist cravada no `resolveLang` (`pref === 'en' || 'es' || 'pt'`): o idioma novo entrava pela detecção do navegador mas era **ignorado ao ser escolhido no seletor**, caindo de volta no idioma do sistema sem erro nenhum. E os `<option>` eram duas listas de HTML duplicadas. Idioma novo = bloco no dicionário + entrada nos dois mapas; `test/i18n.test.mjs` reprova quem esquecer um deles.
- **Isso vale para o BACKEND também, e é o buraco que a auditoria não enxerga.** `test/i18n.test.mjs` varre HTML e dicionário; string que chega pela REDE passa batido. Ficou assim por muito tempo: rótulos do diff (`Nome`, `Telefone`), valores especiais (`(vazio)`, `Sim/Não`) e tipos de pedido (`Novo Local`) saíam do `core.mjs` em português e apareciam no meio de uma interface em inglês. **O core manda CHAVE ou TIPO, o frontend escolhe a palavra**: `changes[].field` → `card.field.<chave>`; `from`/`to` `null`/boolean/`''` → `card.value.*`; `updateTypeKey` → `card.updateType.<CHAVE>`; `flagType` → `card.flagType.<ENUM>`. Chave não mapeada cai em `humanizarEnum()`/`label` cru — **feio, nunca invisível**. **As MENSAGENS DE ERRO eram o resto do buraco, e eram o pedaço maior**: 26 frases saíam do core em português e o frontend as exibia com `result.error || t('...')` — o `||` fazia o português do servidor **ganhar** da tradução, então quem usava a app em qualquer outro idioma lia português em todo erro de sessão, cookie, rede ou race (medido: en, es e fr, todos). Hoje o core manda `errorKey` + `errorVars` (`srv.err.*`, via `apiError(msg, status, chave, vars)` e `categorizeWazeError().messageKey`), e o frontend traduz por `msgDoServidor()`. A frase crua fica no FIM da cadeia de propósito: o SW é cache-first pra assets, então por alguns dias após cada deploy existe cliente com dicionário velho — português é ruim, `srv.err.cookieFormat` na tela é pior. `isUserAllowed` devolve `reasonKey`/`reasonVars` e **não** repete o perfil, que o `#accessDeniedProfile` já renderiza com os selos traduzidos. Campo novo no core → adicionar a chave em todas as línguas, não o texto no servidor.
- **HTML**: `data-i18n="chave"` (textContent), `data-i18n-html` (innerHTML — só valores do próprio dicionário, nunca dado da rede), `data-i18n-ph` (placeholder), `data-i18n-aria` (aria-label), `data-i18n-title` (title). O `applyI18n()` preenche em runtime.
- **JS**: `t('chave', { var: valor })` — interpola `{var}`. String que vai pra innerHTML → `escapeHtml(t(...))`.
- **Número que vem de constante NUNCA se escreve na frase — registre em `setI18nVars()`.** `applyI18n()` chama `t(chave)` **sem parâmetro**, então chave ligada por `data-i18n` não tem call site onde passar valor: o número acabava escrito à mão, e em N línguas alguém sempre esquece uma (aconteceu — `prefs.undo.desc` e `toast.undoHint` cravavam "3s" enquanto `UNDO_WINDOW_MS` era a fonte). `I18N_VARS` (em `js/i18n.js`) é o conjunto de valores **sempre disponíveis** pra interpolação; quem tem a constante registra, o dicionário só consome — a dependência aponta assim porque `i18n.js` carrega ANTES do `app.js` e não pode ler constante dele. **Registre uma FUNÇÃO, não um valor**: é reavaliada a cada `t()`, então trocar de idioma reformata no locale novo (provado com valor fracionário: `2,5` no pt/es, `2.5` no en); valor fixo congela o separador decimal do idioma que estava ativo na carga. Parâmetro explícito de `t()` ganha do global em caso de nome repetido. Sem o registro o `{undoSeg}` **vaza cru pra tela** e nenhuma auditoria de dicionário enxerga (a chave existe, a paridade passa) — daí o guard em `test/i18n.test.mjs` cobrir as duas pontas. Hoje só `{undoSeg}`; **atenção ao plural**, que não tem ICU: valor < 2s daria "1 segundos" no pt/es.
- **Plural**: chaves separadas (`.x` singular / `.xPlural`), escolhidas com `n === 1 ? 'x' : 'xPlural'`. Sem ICU.
- **Números/datas**: use `i18nLocale()` no `toLocaleString(...)` — nunca hardcode `'pt-BR'`.
- **Adicionou UMA string? Adicione em TODAS as línguas.** A auditoria `test/i18n.test.mjs` (CI) FALHA se faltar paridade, houver valor vazio, placeholders divergentes, ou `data-i18n` sem chave no dicionário.
- Idioma detectado de `navigator.language`, persiste em `localStorage.waze_places_lang`. **Fallback = `en`, não `pt`** (`LANG_FALLBACK` em `js/i18n.js`): quem fala pt/en/es vem da detecção e nunca passa pelo fallback, então ele atende exclusivamente o balde "nenhum dos suportados" — alemão, italiano, japonês, russo, chinês — onde inglês é a língua franca da comunidade WME. O francês SAIU desse balde ao ganhar dicionário, e `test/i18n.test.mjs` trava as duas listas: idioma suportado nunca deve cair no fallback. **Dois seletores**, sincronizados por `aplicarIdioma()` em `app.js`: `#langSelect` (Filtros → Preferências, onde se procura por preferência) e `#langSelectHelp` (modal de Ajuda). O segundo existe porque o botão de Filtros fica escondido sem sessão — quem caísse num idioma que não lê teria que entrar primeiro, lendo instruções que não entende. Seletor novo → some em `SELETORES_IDIOMA` (os `<option>` ele recebe do `popularSeletoresDeIdioma()`). `js/i18n.js` carrega como `<script>` clássico antes do `app.js` (expõe `t`/`applyI18n`/`setLang`/`getLang`/`i18nLocale`/`setI18nVars`/`LANGS_SUPORTADOS`/`LANG_NOMES` no escopo global). Mecanismo espelhado do botequei.
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
- Toasts curtos, via `t('toast.…')` (pt/en/es/fr — ver seção **i18n**, nunca hardcode); emoji ocasional onde ajuda ("Já tratado por outro editor 👍")
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

14. **CSP precisa permitir os domínios externos usados** — e o browser aplica a **INTERSEÇÃO** de todas as CSPs ativas (vence a mais restritiva). `img-src` precisa de `venue-image.waze.com` (fotos), `social-row.waze.com` (avatar) e **`www.waze.com`** (tiles do mini-mapa). `script-src`/`connect-src` precisam de **`static.cloudflareinsights.com`** e **`cloudflareinsights.com`**: o Cloudflare INJETA o beacon do Web Analytics no HTML quando o request vem de navegador (com `curl` sem UA de browser ele não aparece — não confie nisso pra testar). São dois hosts porque o script vem de um e a telemetria vai pro outro (`/cdn-cgi/rum`). **Fontes e Tailwind NÃO precisam mais de host externo** (Inter auto-hospedada em `fonts/`, Tailwind pré-compilado) — por isso `font-src` é só `'self' data:` e não há `unsafe-eval`. **Duas cópias da CSP em sync**: o `<meta>` do `index.html` E o arquivo **`_headers`** (Cloudflare). Ao mexer, atualize as duas — e confira com um User-Agent de navegador de verdade. Desde v2026.07.28-06 `test/layout.test.mjs` **compara as duas diretiva a diretiva** e falha se divergirem. **`script-src` NÃO tem `'unsafe-inline'`** e o HTML não tem NENHUM `<script>` inline nem handler `onclick=` — é isso que impede um XSS de ler o `sessionToken` do localStorage (provado: no build anterior o script injetado executava e lia o token). Script novo → arquivo em `js/`, nunca inline. `style-src` **continua** com `'unsafe-inline'` de propósito: o swipe escreve `el.style.transform` a cada frame, e trocar por `style-src-attr` quebraria no Safari, que não o implementa — CSS injetado também não lê localStorage, então o ganho não paga o risco.

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

21. **O filtro `isRead` do Waze é POR VENUE, não por PUR** (consertado 2026-07-24, HAR do "3o Batalhão PMDF"). `userPropertiesFilter: {isRead:false}` devolve o venue se **qualquer** PUR dele estiver não-lido — inclusive quando o único não-lido é um REQUEST (gated por dev mode, invisível na app). Sem filtrar `ur.isRead` na expansão (`buildPlacesFromSearch` em `server/core.mjs`), uma foto já lida re-virava card eternamente: user marcava de novo (Waze aceita, no-op), venue voltava na próxima busca → boomerang sem saída pela app. **Regra**: a expansão pula `ur.isRead === true` quando `unreadOnly`; campo ausente entra (defensivo). Teste de regressão com a fixture do HAR real em `test/core.test.mjs`. Se um place "volta" de novo um dia: conferir se o venue tem PUR irmão não-lido de tipo não exibido (só tratável no WME) — a app não deve re-emitir os lidos.

24. **Conteúdo de `<template>` é invisível pro `applyI18n()`** (consertado v2026.07.26-01). `document.querySelectorAll` NÃO entra em `<template>`, então as 25 chaves `data-i18n*` de dentro do `cardTemplate` nunca eram traduzidas: o clone trazia o texto pt hardcoded e, em en/es, o card voltava pro português **a cada swipe**. Sintoma traiçoeiro: trocar o idioma com um card na tela FUNCIONA (o card já está no documento) — só o próximo card revela o bug. Fix: `applyI18n(card)` no clone, dentro de `renderCurrentCard`. Travado por teste de regressão em `test/i18n.test.mjs`. **Regra**: markup novo dentro de `<template>` precisa que alguém chame `applyI18n` no clone.

25. **Texto que vaza da própria célula NÃO é estouro horizontal — e nenhum teste de `scrollWidth` acha** (consertado v2026.07.27-04). Auditoria em 23 aparelhos × 9 telas do Chrome DevTools deu **0 estouro**, e mesmo assim os rótulos do grid de stats se sobrepunham no celular: `REJEITADOS` transbordava a coluna e invadia `PULADOS`. Como a sobra é simétrica e centralizada, o documento não cresce e `document.scrollWidth - clientWidth` continua 0. **Só medindo caixa contra caixa aparece** (`Range.getBoundingClientRect()` do texto vs. a célula; e comparar vizinhos só quando estão na MESMA fileira, senão o 2×2 dá falso positivo).
    **E teste nas três línguas**: o pior rótulo não era o português. `RECHAZADOS` (es) mede 82px e a coluna só chega lá num aparelho de **390px** — a auditoria rodou em `locale: pt-BR` e por isso subestimou o alcance do bug (pt colidia até 344px, es até 375px). **Regra**: auditoria de layout roda em TODAS as línguas, porque a string mais larga decide o layout e ela quase nunca está no idioma em que você desenvolve. Confirmado de novo com o francês: `Signalement d’un utilisateur` quebrava em 2 linhas numa caixa de 196px (Galaxy Fold) onde pt/en/es faziam 1, e o smoke reprovou sozinho — virou `Signalement utilisateur`, que mantém a raiz do tipo do pedido como pt/es fazem.

26. **Feedback transitório NÃO pode cobrir o alvo que ainda precisa ser tocado** (consertado v2026.07.27-05). O dev mode pede 7 toques na versão e mostrava um countdown por **toast** a partir do 3º que falta. O toast é bottom-center em `z-[70]`, com `pointer-events-auto` (é clicável pra dispensar) — e cobria justamente a versão. Do 5º toque em diante quem recebia o clique era o toast: os 3 últimos toques **nunca chegavam** e o dev mode era **impossível de desbloquear em qualquer aparelho, desde sempre**. A funcionalidade que dava o feedback era a que impedia de concluir. Fix: countdown inline ao lado da versão (`#devTapHint`); o toast de conquista fica, porque aí já desbloqueou e não há mais toque a receber. **Regra**: se um overlay aparece em resposta a um toque e o mesmo alvo precisa de mais toques, o feedback vai ao lado do alvo — nunca por cima. Diagnóstico: `document.elementFromPoint` no centro do alvo depois de cada toque diz quem realmente recebe.
    **E cuidado ao medir**: rodar o teste de alcance DEPOIS dos 7 toques dá falso negativo, porque aí é o toast de *sucesso* que cobre a versão. Alcance se mede antes de disparar a ação.

27. **Regra de UMA classe no styles.css NUNCA vence utility do Tailwind** (v2026.07.27-07). O `tailwind.css` carrega DEPOIS do `styles.css` (ordem deliberada, gotcha #22). Seletor de uma classe empata em especificidade com a utility e **perde por ordem de carga** — sem erro, sem aviso, só a regra não valendo. Já mordeu QUATRO vezes: `.modal-root { padding-bottom }` perdeu pro `p-4` (o modal não subia com o teclado), `.auth-opt-pair { color:#fff }` perdeu pro `text-slate-700` (o botão de código nunca teve texto branco, e escurecer o gradiente derrubou o contraste pra 1.9:1), `.auth-opt-upload { background }` perdeu pro `bg-gradient-to-r`, e `.auth-precondicao { display: block }` perdeu pro `hidden`. **A regra não é "duas classes"** — um `#id` vence utility sozinho; o que vale é a especificidade passar de (0,1,0). O guard em `test/layout.test.mjs` já falhou em pegar isso duas vezes: uma porque não olhava `display`, outra porque parseava só o PRIMEIRO bloco `@media (pointer: coarse)` e tratava o próprio `@media {` como seletor. Hoje varre todos e mede especificidade. Nos três a intenção parecia implementada e o CSS estava lá. **Regra**: quem sobrescreve utility usa duas classes no seletor (`.auth-options .auth-opt-pair`) — e no dark precisa de TRÊS, porque `dark:text-*` já é `.dark .text-*` (0,2,0). Nunca `!important`. Travado em `test/layout.test.mjs`. **Diagnóstico**: leia o valor COMPUTADO, não o arquivo — foi só medindo `getComputedStyle(...).paddingBottom` que apareceu.

28. **A régua M3+HIG se mede, não se estima — e o instrumento erra primeiro** (v2026.07.27-07). Auditoria completa (contraste, alvo, foco, diálogo, movimento, escala) em `scratchpad`. Falsos positivos que o próprio harness produziu, todos já corrigidos nele: (a) contraste "1:1" porque `backgroundColor` é transparente em fundo com `bg-gradient-*` — tem que ler os stops do `background-image`; (b) alvo de toque de 20px porque o `<label>` de texto ACIMA de um `<select>` foi tomado como alvo efetivo — o label só substitui o controle se o ENVOLVER; (c) "app inteira sem anel de foco" porque `transition-all` anima `outline-width` de 0 e a medida veio no meio da animação — esperar ~200ms; (d) foco por `el.focus()` raramente casa `:focus-visible`, o teste que vale é com Tab. **Regra**: achado que acusa a app inteira é suspeito do instrumento antes de ser bug.

29. **Barra de rolagem dentro de superfície de swipe é ambiguidade de GESTO, não sobra de layout** (v2026.07.28-01). O `.card-content` rolava e o app ligava `touch-action: pan-y` pra você conseguir ler — o que, sem ninguém notar, **desligava o "pular"**: arrastar pra cima rolava em vez de tratar o pedido. E não era caso de canto: medido, **25 de 32** combinações de aparelho × tipo de pedido, ou seja, o normal em UPDATE e FLAG. Duas rolagens aninhadas (card + lista), nenhuma com afordância. O owner viu antes de qualquer teste: *"como a pessoa vai rolar a barra já que se puxar para cima o card Pula?"*.
    **O desenho que resolve**: o card tem **UMA** área rolável, e ela é uma das duas caixas que o `handleDragStart` já ignora (`.card-changes-list`, `.card-flag-comment-text` — mutuamente exclusivas: mudanças é UPDATE, reporte é FLAG). Tudo de altura previsível é `flex-shrink-0`; a caixa longa leva `flex-1 min-h-0` e absorve a sobra. Fora dela, arrastar pra cima pula — sempre, em qualquer card.
    **Cuidado com a matemática do flex**: item com `flex: 1 1 0%` tem fator de encolhimento escalado pela base 0 e **não cede**; sem `flex-shrink-0` nos irmãos, quem encolhe são eles — nome e endereço cortados enquanto a caixa longa fica intacta. É o oposto do que a intuição diz.
    **Espaço não se acha apertando, se acha tirando repetição**: o Tipo de um UPDATE é `'Atualização: ' + labels.join(', ')` — os MESMOS campos que a caixa "Mudanças propostas" lista logo abaixo, com valores. Os dois cartões de Tipo/Criador comiam 139px (mais que a lista inteira) pra dizer duas coisas curtas, uma delas duplicada.
    **Área que rola sem dizer que rola é área que ninguém rola** — e aqui isso custa caro, porque o gesto óbvio faz outra coisa. Daí o `.rola-mais` (scroll edge effect do M3): **máscara**, não gradiente colorido, senão são três cores (âmbar, rosa, escuro) pra manter em sincronia. Precisa do `-webkit-` também, ou o iPhone fica sem o único aviso.
    **Deitado, empilhar não cabe** — a foto sozinha comia 40% de um card de 334px. A resposta é `display: grid` no `.card-body` com a foto ocupando as duas linhas da coluna esquerda: mesma árvore de DOM, outra planta. E soltar `max-w-md`/`max-w-[400px]`, senão sobra meia tela vazia ao lado enquanto o endereço quebra em duas linhas.
    Tudo travado em `test/layout.test.mjs` (13 guards, cada um verificado desfazendo a correção de propósito). Harness: `rolagem.mjs` (32 combinações × 4 idiomas) e `gesto2.mjs` (toque de verdade via CDP — `page.mouse` NÃO rola div, e evento sintético também não).
    **Fica um resíduo conhecido**: celular deitado (393px de altura) com um UPDATE extremo ainda estoura 41px e cai na rede de segurança (`.card-content-rola`). Nessa altura não cabe sem cortar informação; o botão ↑ continua na tela e o esmaecido avisa.

34. **Barra de rolagem por UM PIXEL: `scrollHeight`/`clientHeight` são inteiros arredondados** (v2026.07.30-09). O owner relatou "scroll pequeno mas parece que não precisaria" no desktop. Reproduzido com o card dele (HAR + a foto real servida do disco): conteúdo **284,x px numa caixa de 283,y px**. Altura fracionária da foto propaga pela cadeia flex, os dois contadores arredondam pra lados diferentes e sobra 1px que não existe. Com `overflow-y-auto` **cravado no HTML** — valendo sempre — um pixel fantasma já desenha a barra; no celular não aparecia porque lá a barra é overlay. **A correção não é tirar o `auto` e pronto**: se o conteúdo estourar DEPOIS (girar o aparelho, fonte maior, zoom só-de-texto), o texto fica cortado sem saída — um guard existente barrou exatamente isso, com razão. O que vale é a medição ser **VIVA**: `vigiarEstouroDoConteudo()` com `ResizeObserver` liga a rede quando estoura de verdade, com **tolerância de 2px** (o erro máximo de arredondamento de duas bordas). E o seletor precisa de **DUAS classes** (`.card-content.card-content-rola`) — com uma só, a utility `overflow-y-hidden` do Tailwind ganha por ordem de carga e a rede liga sem nada rolar (gotcha #27 de novo; medido: `rede ON` com `overflow: hidden`).

35. **Callback de `ResizeObserver` que escreve no DOM vira erro na cara do editor** (v2026.07.30-10). O owner abriu a foto de um card no laptop e levou um toast VERMELHO: `Erro inesperado: ResizeObserver loop completed with undelivered notifications`. A `vigiarEstouroDoConteudo()` do gotcha #34 ligava a classe **de dentro** do callback do observer — e ligar a classe muda o `overflow-y`, que onde a barra de rolagem é **clássica** (desktop) ocupa largura e encolhe o content box **que aquele mesmo observer observa**. Re-entrada no mesmo quadro, o browser reclama, o `window.onerror` transforma em toast. Duas lições: **(a)** callback de observer só AGENDA (`requestAnimationFrame`), a escrita vai no quadro seguinte, fora do ciclo de entrega — e só escreve se a decisão mudou, senão o custo é por quadro pra sempre; **(b)** aviso de browser não-acionável não pode virar erro pro usuário — `RUIDO_RESIZE_OBSERVER` filtra pro `console.warn`, com regex estreita (só esta família, nunca "todo erro que eu não quero ver"). **O bug era invisível pra TODA a automação**: este Chromium headless só tem barra SOBREPOSTA, que não ocupa largura — medido, `overflow-y: scroll` dá 0px de barra até num caso trivial, e nem `--disable-features=OverlayScrollbars` muda. `scrollbar-gutter: stable` é a única propriedade que ocupa largura aqui (15px) e é **ela que emula o desktop**; entrou como passada separada no `tools/smoke-browser.mjs`. E só dispara na faixa **marginal** (sobra 3-4px), porque é onde a classe TROCA de estado — com estouro claro ela já nasce ligada e nada re-dispara.

36. **No card quem cede espaço é a FOTO, e apertar o texto não devolve um pixel** (v2026.07.30-10). Mesmo relato: "aparece um scroll, mas parece que não precisaria", com a última linha cortada. **Não era arredondamento** (isso era o #34): medido no card do relato, o conteúdo tem 241px FIXOS (toda linha é `flex-shrink-0`) e a caixa encolhe com a janela — 264,8 → 239,7 → 238,5 → 237,7px, falta crescendo contínua (0,17 → 1,34 → 2,55 → 3,28px). A causa é `.card-content` ser `flex-initial min-h-0`: **encolhe até zero**, enquanto `.card-photo` é `flex-auto shrink-[30]` com piso de 9rem. Então o texto era o elo que cedia e a foto ficava intacta. **A tentativa óbvia falha e vale registrar**: compactar o texto num degrau novo de `max-height` devolveu 14px e a sobra não mudou **nada** — a foto reabsorveu na hora (conteúdo 241→227px, caixa 237,7→224,2px). O que resolve é dar PISO ao texto: `min-height: min-content`. **Mas o escopo é obrigatório e cada metade custou uma medição**: sem `:not(:has(...))` o min-content conta a lista INTEIRA de um UPDATE e leva a barra ✕/↑/✓ pra **152-278px fora da tela** num Fold (51 falhas no smoke — o `min-h-0` do corpo rolável NÃO zera a contribuição dele pro min-content do pai); e sem `:not(.hidden)` a regra não vale em lugar nenhum, porque as duas caixas longas moram no template e são só escondidas por classe, então `:has(.card-changes)` casa em TODO card. Onde não houver `:has()` o seletor inteiro é ignorado e volta o comportamento antigo — degradação segura.

37. **Linha "X → X" no diff: filtrar é certo, mas só pelo valor CRU** (v2026.07.30-11). `ur.changedVenue` não é diff — é o local inteiro com os valores propostos — então campo que ninguém tocou vinha junto com o valor ATUAL e virava linha anunciando mudança. Medido na tela (não no dado): **3 linhas em 174**, e as 3 são de campos escalares. **A contagem crua superestima em 3x**: comparar `from`/`to` acusa 10, porque geometria NÃO usa `from`/`to` no card — ela renderiza `moveu 84 m` via `movedM`, e já estava certa. Medir o dado quando a pergunta é sobre a tela foi meu erro duas vezes seguidas neste tema. **O filtro mora no `core.mjs` e compara o valor CRU** (`mesmoValor`, deep-equal — `JSON.stringify` não serve porque ordem de chave não é garantida): por texto formatado ele apagaria mudança real, já que `formatGeometry` imprime primeiro vértice + contagem e um polígono do Condomínio Guaianás andou **84 metros** mantendo os dois. Validado contra a resposta crua: 3 campos escondidos, **0 discordâncias** com uma segunda serialização independente. **Empty state é decisão de produto e a frase importa**: o owner pendia pra "nenhuma mudança detectada"; virou **"Nada a alterar — os valores enviados são iguais aos atuais"**, porque a primeira fala da APP (se errarmos, lê-se como falha da ferramenta) e a segunda fala do DADO, que é verificável. E o card só afirma isso quando houve o que comparar — `camposSemMudanca > 0` distingue "comparamos e nada muda" de "não veio nada", que dizem coisas diferentes.

38. **Diff de objeto: o remédio quase envenenou a geometria** (v2026.07.30-11). O `formatValue` cai em `JSON.stringify` pra objeto que não é lista — documentado como "feio, nunca invisível", e correto contra sumir com informação, mas era JSON cru na cara de quem tria (`categoryAttributes` de um eletroposto, pra dizer que a rede mudou de nome). `diffDeObjeto` acha as folhas que mudaram e mostra só elas. **Três armadilhas, todas medidas**: (a) `geometry` TAMBÉM é objeto simples e foi sequestrada na hora — o `moveu 62 m` virou coordenada crua; hoje é excluída no core E no frontend, guarda dupla porque o sintoma é silencioso; (b) folha que é ARRAY imprimia `[object Object]` — `valorDoDiff` agora serializa objeto, mantendo a regra de nunca sumir; (c) o aviso novo custou 66px e derrubou o Fold (280×653) — o smoke pegou, o card inteiro passava a rolar e isso desliga o gesto de pular (gotcha #29). Sai o ✓ (é `aria-hidden`, repete o que a frase diz) e aperta o respiro; **a frase fica inteira**. E o francês reprovou sozinho depois dos outros três passarem, de novo: `Rien à modifier — les valeurs envoyées sont identiques aux actuelles` não cabia, virou `valeurs envoyées identiques aux actuelles`. Fixture nova no `tools/smoke-browser.mjs` pros dois casos, senão a auditoria de 960 renders não os exercita — ela usa fila cacheada, que é anterior a estes campos.
    **Segunda rodada (v2026.07.30-12), a pedido do owner**: a folha que era LISTA continuava em JSON — no mesmo eletroposto, os pontos de recarga eram dois blocos de ~150 caracteres lado a lado. Hoje passa pelo `diffDeLista` como qualquer campo de lista de topo, então usa o MESMO verde-entra/vermelho-sai (o card não pode ter duas gramáticas pra mesma ideia), e o item sai por `objetoLegivel()`: `portId TYPE2.11 · connectorTypes TYPE2 · count 2`, sem chaves nem aspas. **Sem tabela de campos de propósito** — isto atende o objeto DESCONHECIDO, e o Waze acrescenta campo sem avisar; quem tem tratamento próprio (ponto de entrada, horário) é resolvido antes. O `JSON.stringify` **continua** no fundo, atrás de um teto de profundidade 2: aninhamento fundo achatado vira sopa de palavras, e aí o JSON é mais honesto sobre a estrutura. A ordem de prioridade não mudou — sumir com informação é pior que ser feio.

39. **Revert pela metade: a categoria voltou traduzida onde ninguém olhou** (v2026.07.30-13). O owner mandou reverter a tradução de categoria (o Waze REGIONALIZA por país). Reverti o topo do card e **esqueci o diff** — o mesmo `NATURAL_FEATURES` saía cru em cima e `Natural features` na caixa "Mudanças propostas", **na mesma tela**. Ele viu num print, de novo, e disse o que doía: *"para não ficarmos nos repetindo algo que deveria ter sido pego bem lá atrás quando pedi para voltar"*. **Regra**: revert de apresentação se persegue pelo CONCEITO, não pelo lugar — `grep` do valor em todos os caminhos de render antes de dar por revertido. **A causa raiz era pior que o sintoma**: `valorDeLista` chamava `rotuloDeEnum('card.enum.', …)` e `card.enum.` tinha **ZERO chaves** no dicionário — mecanismo de tradução vazio, então TUDO caía no `humanizarEnum`, que faz `lowercase`. Isso corrompia dado que nem enum é: `aliases` é nome próprio (`Escola Estadual Leovegildo de Melo` → `Escola estadual leovegildo de melo`) e `externalProviderIDs` é ID opaco do Google (`ChIJfYn3umKwnZMRWQEl…` → `Chijfyn3umkwnzmrwqel…`, **deixa de ser o ID** — quem copiasse da tela colaria um valor inexistente, que é exatamente a regra de ouro de consistência sendo violada). Hoje item de lista sai CRU; o `rotuloDeEnum` fica onde há dicionário de verdade (`card.updateType.` 16 chaves, `card.flagType.` 16, `card.field.` 36), e lá humanizar é fallback de enum não mapeado, não a regra. Travado em `test/consistencia.test.mjs`, que também reprova se `card.enum.*` for repovoado — repovoar significa que a decisão mudou e o teste tem que ser revisitado junto. **E o guard nasceu errado**: reprovou a própria correção porque o comentário que EXPLICA a remoção cita `rotuloDeEnum` — guard tem que ler código, não prosa (hoje tira as linhas de `//` antes de olhar).

40. **`opacity` medida num fundo NÃO vale em outro** (v2026.07.30-14). O owner viu `Serviços: +` sem nada do lado. Causa: o Waze manda `services: [""]` de verdade (1 item vazio em 111 na fila real), e `valorDeLista` devolvia a string crua — enquanto `valorDoDiff` já tratava ausente com `(vazio)`. **Assimetria clássica: duas funções pro mesmo conceito, uma corrigida e a outra não**; hoje há UM `itemDeLista()` (eram dois trechos idênticos copiados, que é como as telas divergem sem ninguém notar). **O que quase passou**: pôr `.valor-ausente` no item fez o que o CLAUDE.md manda… e reprovou. O `opacity: 0.8` foi medido pro **slate-700 sobre branco** (5.74:1); sobre o **verde do `.diff-add`** dá **3.41:1**, abaixo do mínimo do WCAG 1.4.3 — o smoke pegou em 12 combinações. O itálico fica e a opacidade sai (`.diff-add .valor-ausente { opacity: 1 }`): quem carrega a informação é o texto entre parênteses, que leitor de tela lê, então o estilo é reforço e não canal (WCAG 1.4.1). **Regra**: constante de contraste tem escopo — o fundo em que foi medida. Reusá-la noutro fundo é começar do zero, não herdar.

41. **A sessão do Cloudflare tinha prazo FIXO, não deslizante — e o doc dizia o contrário** (v2026.07.31-01). Relato do owner: *"constantes problemas de expiração mesmo sem ter pedido no App para sair"*. O `expirationTtl` do KV conta do `put`, e o `get` **não estende nada** — então a validade contava do LOGIN. Medido com o core de verdade e um KV simulado: editor usando a app **todo dia** era deslogado no dia 21, com **ZERO escritas no KV** no período. Este arquivo descrevia os dois adaptadores como equivalentes ("no KV expira sozinha; na VM por mtime + touch"), e não são: só a VM tinha janela deslizante. Hoje o carimbo vai no VALOR (`ts|blob`, o mesmo formato que `createPairing` já usava — `|` é seguro porque base64 não o produz) e `loadSession` renova. **A granularidade (`SESSION_REFRESH_AFTER`, 1 dia) não é economia à toa**: o KV aceita **1 escrita/s por chave** e a app faz 3 chamadas só ao abrir — renovar a cada leitura trocaria o logout por estouro de limite. Medido: 30 leituras em 30s → 0 escritas. **Compatibilidade é obrigatória aqui**: sessão gravada no formato antigo (sem carimbo) tem que seguir valendo, senão o deploy desloga todo mundo de uma vez — o defeito que se está corrigindo, só que pior. E a renovação é melhor-esforço dentro de `try/catch`: falha de escrita não pode virar 401.

42. **Um 401 NÃO é prova de sessão morta** (v2026.07.31-01). Do mesmo relato, com print de **dois** toasts "Sessão expirou" empilhados. Três coisas chegam como 401 e só UMA exige relogar: cookies mortos, **403 do Waze por rajada/WAF**, e blip do KV. O `categorizeWazeError` trata 401 e 403 igual, o backend devolve 401, e o `_post` do `js/api.js` apagava a sessão **dentro da camada de transporte** — decisão tomada antes de qualquer verificação e sem chance de retry (`unauthorized` é justamente a única categoria que o `callWithRetry` não retenta). Hoje o transporte não decide nada; `handleUnauthorized` **confirma** com uma segunda chamada (`VERIFICA_SESSAO_MS`, 1,2s) e só derruba se ela também recusar. **Os dois toasts eram concorrência, não repetição**: ao abrir a app saem TRÊS chamadas ao Waze quase juntas (`perfil` + `lista-paises` em `Promise.all`, mais o `buscar-places` do `startFetching`) — cada 401 fazia a sua própria derrubada. Trava `verificandoSessao` resolve. Validado no browser interceptando `/api/*`: 401 passageiro mantém token e não vai pra tela de login; 401 real derruba com **um** toast.

43. **O Waze ROTACIONA o cookie de sessão a cada resposta — e o core jogava fora** (v2026.08.01-01). Esta é a causa raiz do "expira sem eu ter pedido pra sair", e as duas hipóteses anteriores estavam erradas. **Medido com cookies reais**: 3 chamadas ao `Session` devolveram **3 valores distintos** de `_web_session` (o `_csrf_token` não muda), e `callWaze` **nunca olhava `Set-Cookie`** — zero ocorrências no arquivo. A app congelava o retrato do login e ele azedava sozinho. Hoje `callWaze` devolve `setCookie` e regrava a sessão. **A hipótese que eu tinha e que MEDIR derrubou**: eu apostava em 403 por rajada/WAF, porque a app dispara 3 chamadas paralelas ao abrir — medido contra o Waze real, **15/15 em 200 OK** em 5 rodadas. Rajada não era o problema; era o cookie parado. **Três detalhes que decidem se funciona**: (a) `headers.get('set-cookie')` JUNTA tudo separado por vírgula e valor de cookie contém vírgula (`Expires=Wed, 01 Jan…`) — só `getSetCookie()` serve; (b) a regravação vai no `callWaze`, não em cada handler, porque são 7 pontos de chamada e o esquecimento seria **silencioso** (a sessão só azedaria semanas depois); (c) `await` de verdade, sem promessa solta — em Workers, promessa depois do `return` é cancelada. **Estrangulado em 1h** (`SESSION_COOKIE_REFRESH`): há uma chamada por swipe e o KV aceita 1 escrita/s por chave — regravar a cada resposta trocaria o logout por estouro de limite, outro logout com outro nome.

44. **Traduzi um enum do Waze pelo palpite e inverti o sentido** (v2026.08.01-04). `DOES_NOT_MATCH_SEARCH` estava como "Não aparece na busca". O WME diz **"Não corresponde aos resultados da pesquisa"** — o oposto: o local APARECEU numa busca à qual não corresponde. O owner perguntou "o que é isso?" e foi assim que se descobriu. **A diferença muda a AÇÃO do editor**: na leitura errada a saída é *adicionar* apelido pra o local aparecer; na certa é *revisar* um nome genérico demais que está poluindo busca alheia. **O argumento que decide sem consultar ninguém**: pra reportar um local a pessoa precisa estar OLHANDO pra ele — o reporte vem amarrado a um `venueID`. Não dá pra denunciar o que não apareceu. **A fonte é o próprio WME**: `update_requests.flags` no HTML do editor, extraível de um HAR (`grep DOES_NOT_MATCH_SEARCH`). Ela trouxe os **10** tipos que existem, contra os 4 que o dicionário tinha, e revelou um segundo erro: `CLOSED` era "Fechado permanentemente" e o Waze não diz "permanentemente". Usar a redação do WME também fecha o vão de tradução: é a mesma palavra que o editor vê ao conferir pelo ↗ do card. **Regra**: enum do Waze não se traduz por intuição — o HAR do WME tem o dicionário oficial, em todas as línguas que o editor abrir.

45. **Frase mais longa cai num precipício, não numa ladeira** (v2026.08.01-04). A redação certa do `DOES_NOT_MATCH_SEARCH` é o dobro da errada, e no Fold (280×653) isso levou o card a rolar inteiro. Medido: motivo de 1 linha → sobra **0**; de 2 linhas → sobra **187px**. Não é a linha (20px): quando o conteúdo estoura, a rede de segurança liga e troca a caixa longa de `flex: 1 1 0%` pra `flex: 0 0 auto`, então ela assume a altura natural — o conteúdo salta de 289 pra 476px. **O 187 é consequência, não causa**; medir o número sem entender isso leva a caçar 187px que não existem. **Duas tentativas minhas, ambas medidas**: comprimir a fonte no degrau estreito-e-baixo resolveu o francês (`Résidentiel (domicile)` ia a 2 linhas, agora cabe em 1) e ficou; empilhar o rótulo acima do valor pareceu óbvio e **piorou tudo** — vira sempre 2 linhas, então TODOS os tipos passaram a estourar, inclusive os que estavam bem. Revertido. **Resíduo conhecido**, na linha do gotcha #29: motivo de 2 linhas + comentário longo num Fold ainda cai na rede. Só o `DOES_NOT_MATCH_SEARCH` chega lá, e medido na fila real os 3 casos dele vieram SEM comentário — a combinação que estoura não apareceu na prática. A fixture do smoke usa `CLOSED` (7 ocorrências reais) com comentário longo, e o motivo disso está escrito nela.

46. **O Transifex do Waze é a fonte de enum que faltava — e ela distingue o que dá pra traduzir do que não dá** (v2026.08.01-05). O owner tem acesso e mandou `waze-map-editor-dexter-integrated` em pt_BR/en_US/es/fr. Traz `venues.update_requests.flags` (10), `venues.services` (23) e `venues.categories` (134); o recurso irmão `editor-profile` traz `countries` (239). **Cobertura medida contra a fila real: 3/3 reportes, 10/10 serviços, 54/54 categorias, 204/248 países.** Duas armadilhas de instrumento, ambas minhas: o primeiro parser achou **5** categorias de 134 (pulava chave repetida — o arquivo tem `categories:` em 16 contextos) e eu quase concluí "não serve", que era também o que o owner achava; e o primeiro arquivo de espanhol veio do recurso ERRADO (`editor-profile`, que não tem enum de venue nenhum). **Confira a contagem contra o `grep` cru antes de concluir que uma fonte é inútil.** **O que ENTROU**: serviços, porque é comodidade genérica — ar-condicionado é ar-condicionado em qualquer país. **O que NÃO entrou**: categoria, e a razão é do owner — o Waze regionaliza por PAÍS e o mesmo idioma diverge entre eles (`ônibus` no pt-BR × `autocarro` no pt-PT), então adotar pt_BR acerta no Brasil e erra em Portugal. A decisão ficou com ele, não comigo. **A tradução é por CAMPO** (`valorDeLista(v, campo)`), nunca genérica: genérica foi exatamente o que corrompeu apelido e ID do Google no gotcha #39.

47. **Tradução oficial não é literal entre idiomas — e por isso a minha errou** (v2026.08.01-05). Eu tinha traduzido `MOVED` como "mudança de endereço" em en/es/fr. O oficial é `Place moved` / `Lugar movido` / `Lieu déplacé` — o LOCAL se mudou, não o endereço. E o oficial em **pt** é "Mudança de endereço" mesmo: o Waze traduziu cada idioma por conta, então traduzir a partir do português produz erro nos outros três. **Regra**: quando existir string oficial, use a DAQUELE idioma; nunca a tradução da sua. **Duas exceções deliberadas ficaram registradas no dicionário**, e só duas: `DUPLICATE` (o WME escreve "Duplicado DE <local>" e sem o alvo o "de" fica pendurado) e `DOES_NOT_MATCH_SEARCH` em pt (o oficial ocupa 3 linhas num Fold — gotcha #45; nas outras línguas o oficial é mais CURTO que o meu).

48. **"Sumiu um selo" quase sempre é a FILA que mudou, não o código — mas a investigação achou um defeito de verdade ao lado** (v2026.08.02-01). O owner: *"o que aconteceu que parou de aparecer a origem que vinha 'pelo app' e 'pelo site'?"*. Não aconteceu nada: **`source` só existe no tipo REQUEST**. VENUE (local novo) e IMAGE (foto nova) nunca trazem, e a fila dele passou de quase só REQUEST pra 34% (medido HOJE, ao vivo: 369 URs → VENUE 188 · REQUEST 125 · IMAGE 56, e nos REQUEST só MOBILE_CLIENT 72 · WEB 53). **Confirmado nos TRÊS endpoints que o WME usa**, não em um só — foi ele quem pediu (*"olhe todas solicitações e todos os endpoints sem falta"*), e estava certo em desconfiar: minha primeira conclusão saiu de `Issues/Search/List` sozinho. HAR de 1341 entradas, 213 respostas de API, 358 URs únicos: `Issues/Search/List`, `Issues/Search/Map` **e `Features`** (este é o que o WME chama ao ABRIR um pedido) concordam — 185 VENUE e 51 IMAGE, zero com `source`. Não há campo de origem escondido no `venue` (só `createdBy`/`createdOn`/`externalProviderIDs`) nem no `image` (só `creatorUserId`/`date`/`location`/`approved`/`scanned`), e o gRPC do WME não carrega nada disso. **Não confunda com `editProposals[].provider.source = GEO`**: é a Sugestão de Edição do Google, conceito diferente, dicionário diferente (`GEO`/`GEO_UGC`/`WME`).
    **O defeito que apareceu no caminho**: o Waze tem **5** valores de origem e a app traduzia **2**. O bundle do WME é a fonte (`J = {SOURCE_UNSPECIFIED: Symbol("UNMAPPED_UPDATE_REQUEST_SOURCE"), MOBILE_CLIENT: REPORT_MENU, WEB: LIVE_MAP, MOBILE_WEB: HELP_AND_FEEDBACK, REPORTING_AGENT: REPORTING_AGENT}`), e o `info/config` do ambiente do owner traz **`URSourceReportingAgent: true`** — ou seja, o valor sem tradução está LIGADO. `MOBILE_WEB`/`REPORTING_AGENT` cairiam no `humanizarEnum` e sairiam "Mobile web"/"Reporting agent", em inglês, nas quatro línguas. `SOURCE_UNSPECIFIED` o core descarta, porque o próprio WME não o exibe.
    **O bundle do WME dentro do HAR é fonte de enum tão boa quanto o Transifex, e responde o que o Transifex não responde**: quais valores EXISTEM e qual o mapeamento entre eles. O Transifex dá a redação (`issue_tracker.filters.UPDATE_REQUESTS.sources.<ENUM>.title|tooltip`, nas 4 línguas) — e cuidado, **ele chaveia pelo ENUM, não pelo alias**: procurar `REPORT_MENU` acha 1 de 4 e parece que a fonte não serve (mesma armadilha do gotcha #46).
    **Selo curto, oficial no `title`**: a linha do selo divide espaço com o nível e o lote, e frase longa ali derruba o card no Fold (gotcha #45). Então o selo fica na gramática curta e uniforme da app (`pelo app` · `pelo site` · `pela ajuda` · `por voz`) e a redação oficial do WME vai no `title`, onde espaço não custa — é ela que o editor reencontra ao abrir o ↗. Medido: 3 aparelhos × 4 idiomas × 5 valores, zero estouro.

49. **O filtro de tipos era 3 caixas grossas onde o WME tem 7 — e o que travava era um comentário errado** (v2026.08.04-01). O owner mandou o print do filtro do WME e perguntou se eu entendia os tipos ou se precisava de HAR. Não precisou: os NÚMEROS saem do bundle (`{NEW_PLACE:1, DETAILS_UPDATE:2, DELETE_PLACE:3, FLAGGED_PLACE:4, NEW_PHOTO:5, DELETE_PHOTO:6, FLAGGED_PHOTO:7}`) e a classificação se mede — uma chamada de leitura por número. A app tinha `VENUE`/`IMAGE`/`REQUEST`, e o terceiro era saco de gato: `DETAILS_UPDATE` (48 na fila real), `FLAGGED_PLACE` (17), `DELETE_PLACE` (3), mais os dois de foto. Hoje são os 7, com a redação oficial do WME nas 4 línguas, e o `purTypeDoUR` é a **fonte única** da classificação.
    **O comentário que travava**: `types` ia `null` pro Waze com a nota *"array parcial ⇒ HTTP 406"*. Errado — medido: `[1,5]` devolve **200 com 151 pedidos**, `['VENUE','IMAGE']` devolve **406**. O que o Waze recusa é o TIPO do valor (a lista é de números). Um comentário errado escondeu por meses que dá pra filtrar server-side. **Mesmo assim seguimos filtrando aqui**, e por um motivo medido, não por inércia: **o `types` do Waze filtra por VENUE, não por PUR** — a mesma armadilha do `isRead` (gotcha #21). Pedir só `DETAILS_UPDATE` devolveu 76 certos **+ 2 marcados + 1 foto**, que são pedidos irmãos do mesmo local. Filtro que não filtra sozinho faria o contador mentir.
    **A prova do mapeamento veio de pedidos criados de propósito**: o owner abriu uma conta de teste e criou 4 pedidos num mesmo local. Eles casaram com **exatamente** `DETAILS_UPDATE` + `FLAGGED_PLACE` e com **nenhum** dos outros cinco — é a EXCLUSÃO que fecha, não a inclusão. As formas viraram fixture em `test/core.test.mjs`. `INAPPROPRIATE` apareceu aí pela primeira vez em dado real (este arquivo registrava que ele nunca ocorria).
    **Meu instrumento gritou antes de mim, e errado**: o script acusou "mapeamento não é 1:1" porque cada pedido voltava em duas consultas. Era o filtro por venue de novo — os 4 pedidos moram no MESMO local. A pergunta certa não é *em quantas consultas este pedido apareceu*, e sim *o conjunto de tipos que o LOCAL casou bate com o dos pedidos dele?*. Achado que acusa o Waze é suspeito do instrumento primeiro (gotcha #28).
    **`DELETE_PHOTO` nunca foi observado** — zero em 9 países e zero no teste dedicado; é provável que não exista mais caminho pra criar. Fica no mapa mesmo assim, porque o filtro é lista de PERMITIDOS: tipo fora da lista sumiria calado. Pelo mesmo motivo, `UNKNOWN` **nunca** é descartado (`purFiltrado`) — o Waze inventar um subType não pode esvaziar fila sem erro na tela.
    **`TYPES_ALL` ≠ `TYPES_PADRAO`** (v2026.08.04-02). `DETAILS_UPDATE` e `FLAGGED_PLACE` nascem **DESMARCADOS** a pedido do owner: o card deles ainda estoura em tela pequena quando o pedido vem carregado (diff longo, lista grande, comentário comprido). **Desmarcado, nunca escondido** — a caixa continua no filtro, com o nome do WME; esconder faria o editor achar que a fila acabou, desmarcar diz "existe, e você decide". Medido: instalação nova abre com 161 dos 226 cards da fila real, então ainda há trabalho na tela. Quando o layout for acertado, o conserto é tirar os dois do `TYPES_PADRAO` **e** pôr `checked` no HTML — o guard cobra as duas pontas juntas, porque divergir é silencioso nos dois sentidos (caixa marcada sem pedido vindo = "acabou"; caixa desmarcada com pedido vindo = "filtro quebrado").
    **Seguem DESMARCADOS, mas por outro motivo** (v2026.08.04-04). Eles chegaram a ser remarcados na v2026.08.04-03, quando a medição de layout autorizou (gotcha #50) — e o owner os desmarcou de novo por decisão de PRODUTO: *"a aplicação tem um foco de Tinder onde as pessoas vão avaliando mais por coisas relacionadas ou que contenham fotos"*. Medido na fila real, o argumento fecha: os 5 tipos do padrão somam 178 cards com **66% de foto** (`NEW_PHOTO` tem 2,27 fotos por card), contra 117 cards e **44%** nos dois de fora. **A troca de motivo é o que importa registrar**: enquanto era layout, consertar o layout os traria de volta; agora não traz, e mexer no card tentando isso seria trabalho perdido. A separação `TYPES_ALL` × `TYPES_PADRAO` fica de qualquer jeito — são perguntas diferentes, e só a primeira decide se vale mandar o filtro ao Waze.
    **O guard AVALIA as constantes, não parseia a expressão.** A primeira versão casava `TYPES_ALL.filter((t) => …)` por regex e, ao trocar a forma de propósito pra testar, reprovou com `Cannot read properties of null` — pegava a regressão e não dizia nada. Guard acoplado à FORMA já mordeu em `valorDeLista`, `derrubarSessao` e `avaliar`. Hoje um `new Function` avalia as duas declarações: forma diferente com valor certo passa, valor errado reprova com a frase certa.

50. **Quem não cabia era o card MAGRO, não o cheio — e as duas gramáticas de rótulo eram a conta** (v2026.08.04-03). Os dois tipos desmarcados no gotcha #49 voltaram a caber. O caminho todo foi contraintuitivo e vale inteiro.
    **A medição derrubou a hipótese óbvia.** 117 pedidos REAIS × 4 aparelhos × 4 idiomas = 1872 renders: **156 com problema, e sempre o mesmo sintoma** (o card rolando por dentro, que desliga o gesto de pular). Só **dois** aparelhos falhavam — Fold (280×653) e paisagem (852×393); iPhone SE e Pixel 7 zeraram. E **idêntico nos 4 idiomas** (39 cada), o que aponta pro DADO e não pra tradução — o oposto do gotcha #25. Aí veio o choque: quem falha tem **MENOS** conteúdo. Mediana de 0 mudanças e comentário vazio, contra 1 mudança e até 690 caracteres em quem passa. **15 dos 17 reportes que falhavam tinham comentário VAZIO, e nenhum dos que passavam.**
    **Duas hipóteses minhas, ambas mortas por medição.** (a) `min-height: min-content` (gotcha #36) — o computado é `0px` em todos os casos que falham; não era ela. (b) A caixa longa não flexionava — verdade, mas é a rede de segurança JÁ disparada: eu estava lendo a consequência e chamando de causa. A conta que decide é outra: **soma das linhas que não cedem + gaps contra a altura disponível**. No Fold, 300px de linhas fixas + 36px de gaps numa caixa de 289px — nenhum arranjo de flex conserta isso, e a caixa longa precisava de ZERO.
    **A gordura era estrutural: o card tinha DUAS gramáticas pro mesmo conceito.** `Tipo`/`Criador`/`Marca`/`Motivo` eram `RÓTULO: valor` em 20px; `Categorias`/`Endereço` tinham caixinha de ícone (36px de piso: `p-2` + svg de 20px) com rótulo empilhado, custando 43-63px. Unificar é a regra de ouro de consistência aplicada ao layout — e devolve espaço pra FOTO, que é o produto do card: **+95px no Pixel 7, +76px no laptop, +47px no Fold**.
    **A segunda metade: o motivo do reporte saiu de dentro da caixa rosa.** A caixa existe pra segurar o texto livre; com o comentário vazio (a maioria), sobravam ~40px de moldura — borda + padding + cabeçalho — pra exibir uma linha. Hoje o motivo é linha própria (segue em rosa: perdeu a caixa, não o destaque) e a caixa só aparece com texto. O malabarismo de flex que existia só porque ela aparecia vazia sumiu junto.
    **Medi CADA candidato por DOM antes de escrever uma linha de código, e foi o que salvou.** Dois dos quatro primeiros **pioravam** (26 → 70px de sobra). `C2+C5` deu **0 falhas e 0px**; `C1` (tirar o cabeçalho da caixa) não somava nada em cima, então ficou de fora — mudança que não paga não entra. Resultado final: **1872 renders, zero estouro.**
    **Três armadilhas de instrumento numa tarefa só**, todas minhas: (a) `new Function(string)` no `page.evaluate` bate na CSP — a mudança tem que ir INLINE no callback (já estava escrito aqui, e mesmo assim bati); (b) comparei contraste de `span:first` antes × depois e "vi" queda de 10.35 pra 4.76 — eram ELEMENTOS diferentes (o markup mudou de posição), medir por CLASSE mostrou rótulo 4.76 e valor 10.35 dos dois lados, idênticos ao que já existia; (c) `git worktree add` DENTRO do repo fez o `node --test` varrer os dois e a suíte "passou" 288 testes — o worktree do "antes" vai pra fora da árvore.
    **O smoke reprovou o card certo, e o guard é que estava errado.** Ele acusava "tipo em português" ao ver `Reporte` em espanhol — que é a tradução CORRETA de FLAG lá, idêntica ao português por coincidência de língua irmã. Só teve sorte de não morder antes porque a única fixture de FLAG era de FOTO. Hoje o guard só acusa se a palavra for do português **e** o dicionário do idioma atual disser outra coisa; verificado forçando um vazamento real. Lista de palavras não distingue vazamento de homógrafo — o dicionário distingue.

51. **Coordenada é exata e injulgável — o mini-mapa nasceu disso** (v2026.08.04-05). O owner, que é L6, olhou o próprio card de "Atualização de detalhes" e disse: *"não sei o que fazer com isso"*. Medido, ele tinha razão e o motivo é estrutural: os dois campos mais pedidos nesse tipo são ESPACIAIS — `geometry` (27 de 83) e `entryExitPoints` (21) —, e o card os mostrava como `moveu 36 m` e `entrada -15.88749, -52.26094`. **Exato e inútil**: 36 metros pode ser acertar a porta ou jogar o local dentro do rio, e não há como saber de cabeça. O swipe pressupõe decisão num olhar; essa não era.
    **Tiles do próprio Waze, camada `live/base` e não `editor/roads`.** Respondem sem credencial (medido: 200, PNG 512×512, nas três regiões) e não entra terceiro no projeto. A camada importa: a do editor traz setas de mão única e marcas de edição — o que se precisa pra EDITAR. Aqui a pergunta é "isto faz sentido neste lugar?", e quem responde é a base cartográfica (parque, água, prédios, pontos nomeados). O fluxo do owner é julgar rápido no card e abrir o WME pelo ↗ depois. **A camada saiu de um HAR do livemap que ele levantou** — eu tinha achado só a do editor.
    **O mapa é um SLIDE do carrossel que já existia**, nunca uma linha nova: o card tinha acabado de ser espremido até caber (gotcha #50) e não havia um pixel sobrando. Quando não há foto — 58% dos DETAILS_UPDATE — ele toma o lugar do "Sem Imagem", que era espaço morto. Custo de altura: **zero**, medido.
    **Rede é o custo real, e a alavanca não era o zoom.** 2,79 tiles por card a 29–147 KB dá ~357 KB — inaceitável no celular. Baixar o zoom quase não muda a contagem (2,79 → 2,59) porque o problema é a caixa (412×250) atravessar a borda do tile (512×512) mesmo sendo MENOR que ele. Centrar nos pontos não é requisito: o requisito é caber com folga, o que deixa liberdade pro canto. Deslizar até um tile só levou a **2,13** sem perder um pixel de evidência. O resto vem do carregamento preguiçoso: slide que ninguém abriu não pede tile.
    **O que não cabe em zoom nenhum é DITO, não empurrado pra fora da tela.** A primeira versão devolvia o zoom mínimo assim mesmo e o marcador caía fora da caixa, calado — o mapa mostrava um ponto só e o editor concluiria que nada mudou de lugar. Meu PRÓPRIO teste pegou. Hoje `mapaMontar` devolve `foraDoMapa` e o card avisa em vermelho. Não é canto raro: **33 casos em 4188**, incluindo pedidos propondo mover um local 82 km.
    **Instrução permanente que saiu daqui: validar com o MÁXIMO de países, sempre incluindo França, México, Espanha e Brasil.** O owner vê PURs de fora mesmo sem poder editar lá (a fixture força `permissions: -1`; o filtro segue valendo em produção). A auditoria de 12 países achou **26 pedidos que não cabem no Fold, 17 deles `FLAGGED_PHOTO`** — tipo que a fila brasileira **não tem nenhum**. Medido nos dois lados contra `origin/main`: **26 de 26 já estavam quebrados antes do mapa, 0 causados por ele**. Ou seja, a instrução dos países achou um bug real que a validação só-Brasil nunca acharia, e a comparação antes/depois evitou que eu culpasse o recurso errado.

52. **A fixture do teste escondia o defeito que ela existia pra achar** (v2026.08.04-06). O owner pediu pra o CI cobrar os seis países em vez de depender da minha memória. Ao converter as fixtures do smoke pra pedidos REAIS, o smoke passou — e passar era o resultado ERRADO, porque eu tinha 26 cards medidos que não cabiam.
    **Primeiro erro meu, e é o gotcha #50 esquecido**: selecionei a fixture de cada país × tipo pelo card mais PESADO. Mas quem não cabe é o card MAGRO — já estava escrito aqui. Heurística de volume seleciona sistematicamente o lado errado. Refeito MEDINDO todos os cards dos 6 países e escolhendo o que de fato estoura: 51 fixtures, 20 reproduzindo a falha.
    **A causa raiz era outra, e maior**: `.card-photo` era `flex-auto`, e `flex-basis: auto` resolve a base pelo tamanho INTRÍNSECO do conteúdo — que aqui é uma `<img>`. Ou seja, **a proporção da foto que o usuário tirou decidia quanto de altura sobrava pro texto**. Medido em 51 pedidos reais num Fold: 800×400 → **0** estouram; 512×512 → **20**; 1080×1920 → **31**. Foto de pedido é tirada de celular, então retrato é o caso COMUM.
    **E a fixture do smoke era 800×400 — o único formato que nunca falha.** O defeito valia pra todo tipo de card e todo país, inclusive o Brasil, e nenhuma das auditorias anteriores (1872 renders, 5728 renders) o viu, porque todas usavam essa mesma imagem. Fixture não é só "dado de entrada": ela define o que o teste é CAPAZ de enxergar. Hoje ela é 1080×1920.
    **Conserto**: `flex-basis: 0` na foto — ela passa a receber uma fração do espaço livre em vez de partir do próprio tamanho, e o layout fica igual pra qualquer imagem. `shrink-[30]`, piso e teto continuam. Verificado desfazendo: o smoke sai de 0 pra **140 falhas**.
    **O guard reprovou a correção certa**, de novo: exigia o literal `flex-auto`. Acoplado à FORMA, não à propriedade — quinta vez neste repo. Hoje exige que a foto CRESÇA e ENCOLHA (qualquer forma) e que a base seja 0.

53. **Levar a medição pra dentro do CI achou um gasto que eu nunca tinha medido** (v2026.08.04-07). O owner perguntou se o máximo de teste já estava no CI. Não estava — e mover três coisas pra lá pagou na hora.
    **`test/mapa-fixtures.test.mjs` é o padrão que vale repetir**: dado REAL (as 51 fixtures de país, que já estavam no repo pro smoke) verificado por função PURA, então roda no `npm test` de zero dependência, sem browser e sem rede. Cobre enquadramento, orçamento de tiles, coerência do zoom e região. Custo: milissegundos.
    **Ele achou na primeira execução**: em PAISAGEM a caixa do mapa tem 852px e o tile 512, então "caber num tile" era impossível — e o meu encaixe DESISTIA quando não cabia, deixando a caixa centrada e atravessando até TRÊS colunas. Média de 3,24 tiles por card, com casos de SEIS, a 29–147 KB cada. Eu só tinha medido a caixa retrato (412×250) e concluí que estava resolvido. Generalizado pra minimizar tiles ATRAVESSADOS (o caso de um tile vira o caso particular), foi pra 1,29 · 2,27 · 1,29.
    **Lição de forma**: "encaixar em um" é caso particular de "minimizar" — e a versão particular falha silenciosamente fora do seu caso. Quando um otimizador tem cláusula de desistência, meça o ramo em que ele desiste.
    **As outras duas que entraram**: os TRÊS formatos de foto (a fixture única, mesmo sendo o pior caso, não pega regressão que quebre só paisagem) e o contraste do texto do mapa nos 4 idiomas (o mapa desenha sobre tile colorido, e o `.valor-ausente` já ensinou que contraste medido num fundo não vale em outro — gotcha #40). Custo total no smoke: **2m35s → 3m50s**.
    **O que NÃO foi**, por decisão de custo e não de esquecimento: os outros 2 aparelhos nas fixtures de país (dobraria o smoke por aparelhos onde 100% das falhas nunca apareceram) e a auditoria de 12 países (5728 renders, ~25 min). E o `waze-probe.mjs` nunca vai — precisa dos cookies do owner.

22. **`css/tailwind.css` é GERADO e commitado — nunca edite à mão** (v2026.07.24-02). O Tailwind deixou de compilar no browser: mexeu em classe no `index.html`/`js/*`? rode **`npm run css`** e commite o CSS junto. O CI regenera e falha no diff se esquecer. Some com o estilo em produção sem nenhum erro no console — é silencioso.
    **A ORDEM dos `<link>` importa**: `styles.css` vem ANTES de `tailwind.css`. O bundle runtime antigo injetava o CSS gerado no fim do `<head>`, então as utilities venciam empates de especificidade contra o `styles.css`. Inverter a ordem muda anéis de foco/cantos de leve. Se precisar mexer, valide com o harness de screenshot (Playwright) — foi assim que isso apareceu.

23. **Dark mode é 100% `dark:` no HTML/JS — não crie override global** (v2026.07.24-02). O bloco `.dark .bg-white { !important }` do styles.css MORREU. Ele obrigava toda exceção (inclusive `:hover`) a virar mais um override global. Componente novo → declare `dark:` ao lado do estilo claro. Se um `dark:` "não pega", é empate de especificidade: use `dark:hover:` explícito (foi o caso do `#helpBtn`, onde `dark:bg-*` vencia o `hover:bg-*`).

30. **`data-i18n` escreve textContent — markup no valor chega ESCAPADO na tela** (v2026.07.29-03). Os passos de instalação do iPhone diziam literalmente `Toque em <strong>Compartilhar</strong>, na barra do Safari`. Nada quebra: a chave existe, a paridade das línguas passa, o texto só aparece com as tags à mostra — e justamente pra quem não tem outro caminho de instalar. Valor com markup usa **`data-i18n-html`** (innerHTML, só com valor do próprio dicionário — nunca dado da rede). `test/i18n.test.mjs` cobre agora: chave ligada por `data-i18n` cujo valor tenha tag em QUALQUER língua reprova.

31. **`align-items: center` corta dos DOIS lados; `margin: auto` não** (v2026.07.29-03). O "Tudo limpo!" ganhou o convite de instalar e passou a não caber: 16px cortados no Fold (280×653), 48px deitado. Num flex centralizado por eixo, conteúdo maior que a caixa transborda pra cima E pra baixo, e o pedaço de cima fica inalcançável **mesmo com `overflow: auto`** — a rolagem não vai pra trás do início. `margin-top/bottom: auto` centraliza igual e cede quando falta espaço. Regra: caixa que pode transbordar centraliza por MARGEM, não por `align-items`.
    **E medir "cabe" contra o painel não basta**: o `#noMoreCards` é `absolute inset-0` do `#cardStack`, que já nasce mais alto que a janela em tela curta (medido: 88px abaixo da dobra no Fold, 93px deitado — vale pro card também, não é do convite). O que conta é a **viewport**, não o contêiner. Meu primeiro harness aprovou os dois casos que o screenshot mostrou cortados.
    Onde falta altura, sai enfeite e fica ação — o selo verde do "Tudo limpo!" repete o ✓ que o título já diz e custava 64px. Degraus em `styles.css`: `(max-height:700px)`, `(max-height:700px) and (max-width:360px)` e o de paisagem.

32. **Altura de fração da janela ignora o que já foi gasto acima dela** (v2026.07.29-04). O `#cardStack` era `h-[min(80dvh,640px)] min-h-[min(520px,85dvh)]`: 80% da JANELA, sem descontar os 152px de header + placar + margens (219px no aparelho estreito, onde o placar vira 2×2). A barra ✕/↑/✓ nascia **abaixo da dobra em 4 aparelhos** — 87px no Fold, 92px deitado, 17px no iPhone SE, 3px no S8+ — e no Fold e no deitado o `elementFromPoint` nem devolvia o botão. Pior: **não dá pra rolar até ele com o dedo no card**, porque `.place-card` tem `touch-action: none` (arrastar pra cima é "pular"); a rolagem só existe agarrando a margem. Ação principal fora da tela, sem gesto que a traga de volta.
    **A correção é a cadeia de flex do `<body>` até o `#cardStack`** (`flex: 1 1 auto` + `min-height: 0` em cada elo), que já existia — mas trancada em `@media (min-width: 768px)`, porque no celular "a rolagem da página era o desenho de sempre". Não era: era o bug. Hoje vale em todo aparelho, o teto de 640px continua mandando onde sobra espaço (Pixel 7, 14 Pro, iPad seguem idênticos) e **o piso de 26rem segue preso a `min-height: 700px`** — preso à largura ele estoura o celular deitado, que tem 852px de largura e 393 de altura.
    **A altura mora num lugar só**: classe de altura no HTML do `#cardStack` volta a competir com a cadeia e a vencer no lugar errado. O guard reprova `h-[`/`min-h-[`/`max-h-[` ali.
    **Deitado, a barra de ações foi pra baixo da FOTO** (`grid-column: 1`), e o texto passou a ocupar as duas fileiras: com as ações na coluna do texto sobravam 193px de 268 e um UPDATE comum pede 253 — o card rolava por dentro nos quatro tipos, o que desliga o arraste (gotcha #29).
    **Cuidado ao medir**: `falta: 0` logo depois de `showCurrentPlace()` é mentira do instrumento — sem esperar o layout assentar, `scrollHeight` ainda não conta. E a fixture do smoke é deliberadamente pesada; medir com uma leve dá aprovado.

33. **Regra que "compacta" sem compactar nada** (v2026.07.29-04). O degrau `max-width: 359.98px` do placar dizia recuperar ~25px com `font-size: 1.25rem` (que é **exatamente** o `text-xl` do HTML — medido, 20px/28px dos dois lados) e `padding: 0.75rem` (que é **maior** que o `p-2`, custando 8px a mais justamente no aparelho mais apertado). Foram escritas quando o HTML era outro e ficaram pra trás, com o comentário afirmando o contrário do que o código fazia. **Comentário não é prova: leia o valor computado.** A compactação que vale é por ALTURA (`max-height: 700px`), porque é a altura que decide se o card rola.

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
- Pipeline completo: subir `node server/node.mjs` e `curl` nos endpoints — sessão fake dá 401 limpo. Com `cookies.txt` real do owner o caminho autenticado funciona de ponta a ponta (o sandbox alcança o `waze.com`; ver a nota na seção de endpoints). **Sem cookies válidos**, o Waze responde `403` + `code: 101` "not allowed by guest user", que o core categoriza como `unauthorized` — prova que roteamento + cripto + fetch funcionam

### Investigar bug reportado pelo usuário
1. **Peça o `cookies.txt`** (ver a seção 🔑 acima — o owner quer que seja o padrão) e reproduza contra o Waze de verdade: `node tools/waze-probe.mjs` pra conferir validade, depois suba `node server/node.mjs` e exercite o fluxo pela app. Isso responde "o que o Waze devolve HOJE", que é a pergunta na maioria dos casos.
2. **HAR é o plano B**, não o A: use quando o bug depende do que a app ENVIOU num momento específico que já passou, ou quando o owner não pode mandar cookies. Parseie com `jq`/Python (5–20MB é normal).
3. Olhar request payloads (o que **a app** enviou) e response bodies (o que **o Waze** devolveu)
4. Confirmar se é bug do app, do Waze, ou expectativa errada
5. Se for bug do app, reproduzir mentalmente o fluxo, adicionar defesa + try-catch onde fizer sentido, bump o serial (`js/version.js` + `service-worker.js`)
6. **Rode o fluxo com dado real antes de dar por pronto.** Fixture mede o que você imaginou; dado real mede o que existe. Dois bugs visíveis a todo editor passaram por N auditorias de fixture e caíram na primeira fila de verdade: `[object Object]` em toda mudança de geometria (33 de 142 pedidos) e 4 campos sem tradução.

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
