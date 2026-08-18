# CLAUDE.md

Contexto pra agentes Claude que trabalham neste repo. Diferente do `README.md` (público, focado em **editores do Waze** que vão instalar a app), este arquivo é **para você, IA**: arquitetura, convenções, gotchas, decisões já tomadas e workflows típicos.

**Sempre leia este arquivo antes de fazer mudanças não-triviais.**

---

## 🎯 O que é o projeto

PWA estilo Tinder para **editores do Waze Map Editor (WME)** limparem rapidamente os pedidos de places enviados por usuários comuns — fotos lixo, nomes ruins, endereços errados, categorias absurdas. Cards aparecem um por vez e o editor faz swipe.

**Regra de ouro de produto:** a app **nunca aprova dado de LOCAL** — nome, categoria, endereço, posição, horário. Nesses, aprovar é escolher entre um valor e outro, e o WME é que tem campo pra corrigir: o card só **rejeita** ou **marca como lido**, e quem quiser aprovar abre o ↗.

**A única exceção é FOTO NOVA, e o que a justifica é a natureza da decisão, não a conveniência** (v2026.08.06-05, a pedido de um global champ, decidida pelo owner). Foto não tem campo pra ajustar: ou serve ou não serve. A decisão está **inteira na tela** — a foto ampliada no lightbox é o dado completo, não um resumo dele —, é **binária**, e é **reversível** pelo mesmo caminho (a lixeira que já existe tira do mapa a foto que entrou). Aprovar dado de local não tem nenhuma das três. A ação mora no **lightbox**, nunca no card: pra aprovar é preciso ter ABERTO a foto, e é isso que garante que ela foi vista em tamanho de decisão — o swipe do card decide o pedido, não o pixel.
**Portão:** o mesmo do excluir (`podeExcluirFotoAqui()`: `isStaff || (rank >= 5 && isAreaManager)`, ou seja **L6+AM ou staff**), e ele é só do CLIENTE — o Waze já recusa quem não pode, e portão no servidor seria segunda regra pra manter em sincronia (ver gotcha #59).
**Continua valendo:** aprovar QUALQUER outro tipo de pedido é bug. `handleValidarPlace` só manda `approve: true` quando `data.approve === true` — booleano estrito, sem coerção, travado em `test/dispatch.test.mjs` com valores truthy que precisam ser recusados.

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
| **Tailwind** | **Pré-compilado** com o `styles.css` num `css/app.css` só (COMMITADO) via `npm run css` → `tools/gerar-css.mjs` | Zero build pra quem só roda a app (o CSS já está no repo). Tirou 407KB e o `unsafe-eval` da CSP. **Um `<link>` em vez de dois, e o `styles.css` agora sai MINIFICADO** — ele é fortemente comentado e comentário comprime mas não some: 23,4 → 5,3 KB comprimidos, num recurso que bloqueia o render. Mexeu em classe do Tailwind **ou no styles.css**? `npm run css` (o CI cobra com diff). |
| **Backend** | JavaScript ESM (**sem build, sem npm install**) no padrão **core compartilhado + adaptadores** | `server/core.mjs` = lógica; `worker/index.mjs` = adaptador Cloudflare Workers; `server/node.mjs` = adaptador VM. Só usa `fetch` + Web Crypto → roda igual em Workers e Node 18+. |
| **Auth** | Cookies do WME do usuário → session token, cookies criptografados **AES-256-GCM** server-side | Cookies não trafegam mais que uma vez. Token opaco no client. |
| **Sessão** | Store abstrato: **Workers KV** (Cloudflare) ou **filesystem** (VM) | KV tem TTL nativo; VM espelha o modelo `/tmp` antigo. Injetado no core pelo adaptador. |
| **PWA** | manifest + service worker network-first pra HTML/JS/CSS, cache-first pra imagens | HTML/código sempre fresco (fim do version skew), imagens rápidas. Auto-update via `controllerchange`. |
| **i18n** | Português puro na UI; código em português + inglês misturado | Editores Waze BR são o público-alvo. |

> **v3.0 — migração PHP → JS (Cloudflare/Node).** Até a v2.x o backend era PHP 7.4 + Apache + `.htaccess`, sessões em `/tmp` com AES-256-CBC, `start.sh`/`start.bat` com `PHP_CLI_SERVER_WORKERS`. Tudo isso foi **removido**. Se você achar referência a PHP/`.htaccess`/`start.sh`/cURL/`config.php` em qualquer lugar (fora de `docs/` histórico), é resíduo — corrija. Contrato de API preservado (mesmos paths, agora **sem `.php`**). Mapa de conversão: `docs/cloudflare-migration.md`.

**Não introduza build step, framework, bundler, ORM, ou banco de dados sem discussão explícita com o usuário.** Valor explícito do projeto: simplicidade extrema. O backend é ESM puro rodável direto com `node` (sem `npm install` — zero dependências).

**A app roda no FREE TIER do Cloudflare, e isso é restrição de projeto, não detalhe de infra** (dito pelo owner: *"quero evitar ao máximo consultas ao servidor pois uso o free tier que tem um certo limite"*). Requisição ao nosso `/api/*` é recurso escasso e contado. Consequências pra qualquer recurso novo: **nada de polling**, nada de "atualiza a cada N minutos", nada de background sync periódico, e retentativa só onde já existe política (`callWithRetry`, 2 tentativas). Quando a escolha for entre uma chamada a mais e uma conveniência, a conveniência perde. Foi por isso que o `Periodic Background Sync` — único caminho técnico pro pontinho funcionar no Android — foi **recusado pelo owner** mesmo sendo viável e sem mexer na criptografia.

---

## 📁 Estrutura

```
wazeplaces/
├── index.html               # SPA: header + authScreen + appScreen + modais + template do card
├── manifest.json            # PWA manifest (ícones SVG em icons/)
├── service-worker.js        # Cache + auto-update (controllerchange + SKIP_WAITING)
├── icons/
│   ├── icon-192.svg
│   ├── icon-512.svg
│   ├── splash/              # GERADO por `node tools/gerar-splash.mjs` — 17 tamanhos × claro/escuro
│   └── screenshots/         # Capturas do prompt de instalação (ver **PWA: splash e capturas**)
├── css/
│   ├── styles.css           # Estilos custom (@font-face da Inter, componentes)
│   ├── app.css              # GERADO por `npm run css` (tools/gerar-css.mjs) — commitado, NÃO editar
│   │                        #   à mão. É tailwind + styles.css, nessa ordem, os dois minificados.
│   └── tailwind.src.css     # Entrada (@tailwind base/components/utilities)
├── fonts/                   # Inter auto-hospedada (woff2 variável) + licença OFL
├── tailwind.config.js       # Config do build de CSS (darkMode: 'class', content)
├── CHANGELOG.md             # Histórico de mudanças voltado ao editor (não é git log)
├── js/
│   ├── mapa.js              # Mapa de evidência (JS puro, zero dep). DUAS funções, duas perguntas:
│   │                        #   `mapaMontar` = mapinha do card (enquadramento fixo, escolhido pra caber,
│   │                        #   minimiza tiles); `mapaGrade` = mapa AMPLIADO (centro e zoom são do
│   │                        #   editor, com projetar/desprojetar pro arrasto). Tiles do PRÓPRIO Waze,
│   │                        #   camada `live/base` (não `editor/roads`). Testado sem browser.
│   ├── qr.js                # Gerador de QR (JS puro, zero dep): modo byte, correção M, versões 1–6.
│   │                        #   Só o pareamento usa. Verificado módulo a módulo contra o pacote `qrcode`
│   │                        #   em 106 entradas; vetores dourados em test/qr.test.mjs. Carregado antes do app.js
│   ├── version.js           # FONTE ÚNICA da versão: serial de zona DNS YYYYMMDDnn (APP_VERSION + verLabel). Carregado antes do app.js
│   ├── i18n.js              # i18n pt/en/es/fr (sem lib): I18N_DICT + t()/applyI18n()/setLang() + setI18nVars(). FONTE ÚNICA de strings de UI.
│   │                        #   LANGS_SUPORTADOS = Object.keys(I18N_DICT) — a lista de idiomas é o próprio dicionário. Carregado antes do app.js
│   ├── api.js               # Wrapper fetch() dos endpoints /api/* (única fonte de chamadas HTTP; SEM .php)
│   ├── app.js               # AppState, render, handlers, fila, prefetch, error handling
│   ├── swipe.js             # Gestos drag/swipe (esquerda, direita, cima)
│   │                        # (o tema virou <script> INLINE no index.html, autorizado por HASH
│   │                        #  na CSP — nunca unsafe-inline. Era a última requisição bloqueando
│   │                        #  o render junto do CSS. test/layout.test.mjs recalcula o hash e
│   │                        #  reprova se as DUAS cópias da CSP não tiverem o novo.)
│   ├── sw-register.js       # Registro/auto-update do service worker. Externo pelo mesmo motivo
│   └── (sem vendor: Tailwind é pré-compilado em css/app.css)
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
│   ├── gerar-splash.mjs     # Gera icons/splash/. Lê as DUAS metas theme-color do index.html e o
│   │                        #   icon-512.svg — a cor NÃO se digita aqui. `--links` imprime as <link>.
│   ├── png-palette.mjs      # PNG truecolor → paleta 8 bits, zero dep (só node:zlib). Splash chapada
│   │                        #   em RGBA custava 946KB; em paleta, 335KB. k-center, não frequência.
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
npm run css            # SÓ se mexeu em classe do Tailwind OU no css/styles.css (regenera css/app.css; CI cobra)
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

**A chave que cifra NÃO é o Secret: é `HKDF(Secret, segredoDoCliente)`** (`derivarChave` em `core.mjs`, v2026.08.06-07). O Secret sozinho não abre nada — falta o token, que vive no aparelho do editor e chega a cada requisição. **Dump do KV + `ENCRYPTION_KEY` = zero**, e isso vale pra vazamento, token de leitura roubado e pedido judicial. Travado em `test/core.test.mjs` ("Secret + dump do KV, SEM o token, não abre nada"), que **é** a frase publicada na Ajuda (`help.privacy.zeroKnowledge`, 4 línguas) — se o teste cair, a app está mentindo.
**O que isto NÃO protege**, e não adianta escrever bonito: quem publica código no Worker registra o segredo quando ele chega. A diferença é o alcance — de "todos os editores, inclusive os de ontem" pra "quem usar a app enquanto o código estiver no ar", com rastro em `wrangler deployments`.
**Depende de DUAS coisas, e mexer em qualquer uma derruba a garantia:** (a) o token viaja só no CORPO do POST — nunca URL, query ou header — e o core não tem `console`; (b) o QR do pareamento usa **fragmento** (`/#pair=`), que o navegador não manda pro servidor. Com `?pair=` o segredo caía no log de acesso ao lado do dado que protege.
**Sessão que não decifra é APAGADA, não deixada vencer** (`descartar()` no `loadSession`). Não é arrumação: registro do formato anterior segue decifrável com o Secret sozinho, e ficaria assim por até `SESSION_TTL`. Apagar é seguro porque a falha do AES-GCM é determinística. Isso cobre quem VOLTA; **pra fechar a janela no dia do deploy, rotacione o `ENCRYPTION_KEY`** — aí todo blob antigo morre de uma vez (e todo mundo é deslogado, o que aconteceria de qualquer jeito).
**Pareamento tem DOIS tamanhos de segredo**: 20 símbolos (QR, 100 bits, padrão) e 6 (digitável, ~30 bits, **só sob demanda** pelo botão "sem câmera"). O curto é fraco por construção; existir só quando pedido é o que impede que ele enfraqueça o QR de todo mundo — se estivesse sempre lá, o dump traria a cópia fraca ao lado da forte. Depois do `claim` os dois convergem: o aparelho ganha uma sessão nova, com a derivação cheia.

---

## 🌐 Endpoints proxy → Waze

Todos os handlers em `server/core.mjs` são **proxies stateless**: recebem `sessionToken`, carregam os cookies criptografados do store, fazem `fetch` ao Waze (via `callWaze`), normalizam a resposta. Roteados por `dispatch(name, data, { sessions })`. O nome do endpoint é **sem `.php`** (o dispatch tolera sufixo `.php` por compat de cache antigo). Multi-região (`row`/`na`/`il`/`world`) via helpers em `core.mjs` (`wazeIssuesEndpoint`, etc).

| App endpoint | Waze endpoint | Notas |
|---|---|---|
| `sessao` | — (apenas local) | `action: create\|destroy` |
| `parear` | — (apenas local) | **QR é o caminho principal** (`js/qr.js` desenha o link `?pair=` num canvas): aponta a câmera e entra, sem instrução nenhuma. O código de 6 chars ficou como alternativa pra quem não tem câmera. Cada tela explicando o OUTRO aparelho era o sintoma de que a interface não se explicava sozinha. `action: create\|claim`. Pareamento computador→celular: `create` exige sessão e devolve código de 6 chars (alfabeto sem 0/O/1/I, TTL 5min, uso único); `claim` troca o código por uma sessão NOVA. Existe porque copiar cookies no celular é inviável. Validade vai DENTRO do valor guardado, não só no TTL do store — o adaptador de arquivo da VM ignora o TTL do `put`. |
| `testar-cookies` | `Session` (smoke test + gate) | Valida, checa `isUserAllowed`, cria sessão e devolve token |
| `buscar-places` | `/row-Descartes/app/v1/Issues/Search/List` | Aceita `page`, `countryId`, `stateId`, `managedAreaId`, `bbox`, `types[]` (os 7 tipos do WME — ver `PUR_TIPOS`/`purTypeDoUR`; o corte é NOSSO, ver gotcha #49), `categories[]`, `residential`, `unreadOnly`. Envia `orderBy: SORTING_UPDATE_TIME_DESC`. **Pode fazer UMA leitura a mais por pedido DUPLICATE** (`resolverDuplicados`, GET em `/Features` por bbox), pra descobrir o NOME do local duplicado — o `Search/List` só devolve quem tem pedido pendente, e o alvo do duplicado normalmente não tem. Raio 0,004° (~444 m), MEDIDO: com o raio do excluir-foto (0,0002°) o alvo não é achado em nenhum dos 6 casos reais. Teto de 4 leituras por página; frequência real 0,24% dos pedidos, então na prática é 0 ou 1. |
| `marcar-lido` | `/row-Descartes/app/v1/Issues/Read` | Aceita single (`venueID`+`updateRequestID`) ou batch (`items[]`) |
| `validar-place` | `/row-Descartes/app/Features` | `approve: false` (rejeitar) é o padrão — **só manda `true` com `data.approve === true`**, booleano estrito. Aprovar é caminho exclusivo de FOTO NOVA (ver a regra de ouro de produto) |
| `excluir-foto` | `/row-Descartes/app/Features` (`UPDATE_OBJECT`/`venue`) | O Waze **não apaga: SUBSTITUI a lista `images` inteira** — daí o `relerLocal` por bbox antes de escrever (gotcha #57). `action: 'preparar'` só aquece o cache de releitura |
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
  flagEntityID,               // FLAG: o id do ALVO da denúncia, e o que ele identifica
                              //   depende do `flagSubjectType`. IMAGE → id da foto, casa
                              //   com venue.images[].id (é assim que o card marca qual das
                              //   N fotos é). VENUE → id de OUTRO LOCAL, que hoje só o
                              //   DUPLICATE usa: é o local do qual este é duplicado.
                              //   MEDIDO nos 6 países (2881 URs): os 7 DUPLICATE trazem o
                              //   campo, todos no formato de id de venue — com componente
                              //   do meio podendo ser NEGATIVO, que regex ingênua recusa.
  duplicado,                  // DUPLICATE: o local apontado, resolvido pelo core →
                              //   { id, nome, ll, distM }. `nome: null` = existe e não tem
                              //   nome. Ausente = não deu pra resolver, e aí o card volta
                              //   à forma isolada ("Duplicado"), sem "de" pendurado.
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
  sessaoExpiraEm,         // quando a sessão do WAZE vence (epoch/s), em localStorage waze_places_sessao_expira. Vira a linha
                          //   discreta sob o placar nos últimos AVISO_SESSAO_DIAS=5 (`atualizarAvisoDeSessao`). **Não confundir
                          //   com o SESSION_TTL da app**, que é DESLIZANTE e por isso não serve pra contar nada: quem usa nunca
                          //   chega perto dele. O prazo do Waze é FIXO — MEDIDO em 3 leituras seguidas do `/Session`, o valor do
                          //   `_web_session` mudou nas três e o `Expires` ficou parado, com o `Max-Age` só decrescendo. O core lê
                          //   isso do `Set-Cookie` que já recebia (`prazoDaSessaoWaze`) e devolve em `testar-cookies`/`perfil`/
                          //   `buscar-places`; nada novo é guardado no servidor e a criptografia não é tocada. Resposta SEM o campo
                          //   NÃO apaga o que já se sabia (o Waze só manda Set-Cookie quando rotaciona). Se um dia o prazo passar a
                          //   deslizar, o aviso vira mentira e sai — o teste do core é onde isso aparece.
  profile, countries, statesByCountry
}
```

**Modo treino (`Treino` em `app.js`)**: troca a fila por pedidos INERTES (`UR_INERTE`, clone profundo, `_treino: true`) e os handlers reais têm guard no topo — nada de rede, stat ou fila. Usa **os pedidos reais da pessoa**, `MAX_REAIS = 30` (o tamanho de uma página do WME, unidade que o editor já tem); os sintéticos ficam só como **piso** (`MIN_CARDS = 3`), pra fila vazia — que é o caso comum no primeiro minuto, antes de ela carregar. **A ordem é de VARIEDADE, não a da fila, e isso é medido, não gosto**: a fila vem por data, então tipos iguais se agrupam. Nas filas reais dos 6 países obrigatórios, 30 cards em ordem de fila cobrem **5–8** dos 7–11 tipos existentes; por rodízio (um de cada tipo, depois o segundo de cada) cobrem **todos, nos seis** — e no Brasil os 3 primeiros da fila são do MESMO tipo, ou seja o treino antigo (`slice(0,3)`) mostrava **1 tipo de 10**. Rodízio e não "um de cada e depois o resto" porque a pessoa pode sair no meio: assim quem para no 5º viu 5 tipos. `serverTotal` sai de `queue.length` — cravá-lo já fez o "Restam" zerar com card na tela.

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
- **Ponto no ícone (`atualizarPontoNoIcone`) é recurso de DESKTOP, e não adianta tentar consertar.** Chamado do `updatePendingCount`, acende com `authenticated && serverTotal > 0` e usa `setAppBadge()` **sem argumento** (ponto, nunca número: o badge só é escrito com a app ABERTA, então um número congela e mente assim que ela fecha). **No Chrome do Android a API não existe** — `'setAppBadge' in navigator` é falso e a função sai em silêncio. Não é bug nosso: o badge do Android é derivado de notificação e o sistema só deixa SUPRIMIR, nunca acender, então o Chrome nunca portou. **Trocar por número piora**: o número é exatamente o que o Android não sabe fazer. Funciona em Windows/macOS/ChromeOS (app instalada) e no iOS **com notificação autorizada** — que a app nunca pede, por causa da régua de não interromper. O único caminho pro Android seria notificação via `Periodic Background Sync`, **recusado pelo owner** pelo custo de requisições (ver free tier, na seção de stack). Relatado por ele com a app instalada e "Restam 2" na tela: WebAPK legítimo (aparece na gaveta), zero ponto. Quem indica trabalho em todo aparelho é o "Restam".
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

### PWA: splash e capturas de instalação

**A splash NÃO segue a preferência no Android, e isso não é bug nosso — é a plataforma.** O `background_color` do manifest é UM valor, lido uma vez, pintado antes de qualquer CSS/JS. Não existe variante por esquema de cor: a [issue do W3C](https://github.com/w3c/manifest/issues/1045) segue aberta e o origin trial do Chrome pra isso (109–114) era **desktop** e nunca virou recurso. Antes de "consertar" isso de novo, saiba que já foi medido na produção real (v2026.08.11-01): a app troca de tema, o manifest não muda nada. As três defesas que EXISTEM, e por quê:

1. **Duas metas `theme-color` com `media`** — a barra de status segue o esquema antes do JS. Isto é padrão e funciona.
2. **`@media (prefers-color-scheme: dark)` no `styles.css`, escopado em `:not(.tema-claro)`** — aposta na brecha do MDN ("o navegador *pode* derivar o fundo do splash de um `prefers-color-scheme` no seu CSS"). Sem o escopo, quem **escolheu** claro num sistema escuro recebe fundo escuro sob app clara.
3. **`background_color`/`theme_color` = o mesmo `body.dark`** — fallback de quem não honrar o item 2.

**No iOS existe o caminho de verdade**: `apple-touch-startup-image` aceita `prefers-color-scheme` no `media`, então há uma imagem clara e uma escura por tamanho. O iOS **não redimensiona** — casa exato (device-width × device-height × dpr × orientação) ou descarta e volta a splash branca. Tamanho novo entra em `APARELHOS_IOS` (`tools/gerar-splash.mjs`) e sai com o par completo; `test/layout.test.mjs` reprova par incompleto, arquivo ausente, dimensão que não bate com a media query, e PNG que não seja de paleta.

**As capturas do manifest são em INGLÊS e não há como variar por idioma.** `screenshots` **não** é localizável: a localização de manifest do Chrome/Edge 148 (sufixo `_localized`) cobre `name`, `short_name`, `description`, `icons` e `shortcuts`, e para aí. Três regras que o Chrome aplica **em silêncio** antes de montar o diálogo rico — se falhar, ele volta pro diálogo velho sem avisar: dimensão entre 320 e 3840, lado maior ≤ 2,3× o menor, e **mesma proporção entre capturas do mesmo `form_factor`**. Travado no guard. E capturas são públicas: o nome de quem enviou o pedido sai (vira `wazer`) — foto e endereço são dado público de mapa, nome de pessoa não.

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
- O repo tem **Automatically delete head branches** ligado: a branch some do GitHub sozinha no merge. O agente sincroniza a main e apaga a local; ninguém apaga nada à mão.

### Workflow PR ↔ owner (regras fixadas pelo owner)
- **Agente pode abrir PR sempre que sentir que a branch tá madura** — não precisa pedir permissão pra abrir
- **Owner faz squash merge ao aprovar, e a branch é apagada AUTOMATICAMENTE** pelo GitHub (*Automatically delete head branches*). O agente sincroniza a main e apaga a local, sem perguntar.
- **Sincronize com `git fetch --prune`.** Sem o prune sobram refs `origin/claude/…` mortos, apontando pra commits que não existem mais no remoto. Num ambiente onde o container pode voltar a um estado antigo, ref velho é exatamente como se acredita que a árvore está em dia quando não está — **confira `git log --oneline -1` contra o GitHub antes de acreditar no estado local**. Em 2026-08-07 o container voltou CINCO vezes pra uma main de três PRs atrás; das cinco, duas só foram percebidas porque a contagem de testes não bateu (168 onde eram 180), e uma delas quase virou um push que reverteria três PRs.
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

> **REGRA PERMANENTE (instrução do owner): a falha NÃO PODE SE REPETIR — e se repetir, ela vira anotação aqui.** *"Quero que não se repita. A ideia é se a falha repetir, anotar."*
>
> O critério de entrada neste arquivo é **reincidência, não ocorrência**. Errar uma vez, corrigir e seguir não vira parágrafo — vira ruído, e o arquivo já pede pra ser curto. Errar a MESMA coisa de novo é o sinal de que a lição não pegou sozinha e precisa estar escrita. Antes de anotar, então: *isto já aconteceu antes?* Se sim, procure o gotcha do mesmo tema e some o caso novo lá, em vez de abrir um irmão — a repetição é mais informativa junta do que espalhada.
>
> **Falha de INSTRUMENTO conta igual à de produção**, e reincide mais: é ela que me faz declarar "validado" sobre coisa quebrada, e foi assim que o mapa chegou no celular do owner com uma faixa vazia atravessando a tela depois de eu ter dito que estava medido.
>
> **As três perguntas abaixo estão aqui porque JÁ reincidiram** — fixture que esconde o defeito (#52 e #58), instrumento errado antes do código (#28, #50, #55), medida do lado errado (#33, #34, #58). Valem antes de escrever "validado":
> 1. **Se o defeito existisse, este teste FALHARIA?** Prove desfazendo a correção de propósito. Teste que nunca foi visto reprovando não é teste, é decoração.
> 2. **A fixture DISTINGUE os casos?** Conteúdo idêntico para recursos distintos não detecta erro de posição, de ordem nem de ausência. Foto 800×400 só-paisagem escondeu o bug de proporção (gotcha #52); tile cinza igual para todo x/y escondeu a faixa vazia (gotcha #58).
> 3. **Estou medindo a coisa ou a intenção dela?** `style.width` é o que pedi; `getBoundingClientRect().width` é o que a tela deu. Contar FALHAS de rede não é contar SUCESSOS — zero requisição lê como "zero problema".


> **DUAS CAMADAS.** Abaixo fica a **regra** de cada gotcha, em uma ou duas
> linhas — é o que precisa estar sempre carregado, porque é o que impede de
> repetir. A **história completa** de cada um (sintoma, hipótese errada,
> medição que a derrubou, conserto, armadilha do instrumento) mora em
> **`docs/gotchas.md`**, com a mesma numeração.
>
> **Leia o inteiro teor quando o assunto aparecer**: veio mexer em mapa? leia
> os de mapa antes de medir. A regra curta te faz lembrar que existe um
> buraco; a história te diz onde ele fica.
>
> Por que separar: este arquivo chegou a 163 KB — ~44 mil tokens reenviados a
> cada mensagem —, e **51% disso era esta seção**. Gotcha novo: história no
> `docs/gotchas.md`, regra curta aqui.

1. **Refatorou variável? `grep` pelo nome no projeto inteiro antes de commitar** — um `gallery` órfão num else matava o render inteiro em silêncio. E `try-catch` em volta do card sempre vale.
2. **Notificações foram REMOVIDAS a pedido do owner** — se a demanda voltar, o endpoint é `/Feed/Notifications`.
3. **`Issues/Search/List` devolve tudo de uma vez** — não implemente "paginação real"; use `hasMore` como verdade e trate a fila como global.
3.5. **Um card por updateRequest, NUNCA por venue** — um venue tem vários PURs, e pegar só o `[0]` faz o place "voltar" pra sempre. Sempre devolva TODAS as imagens do venue, mesmo em PUR de foto.
5. **Filtro padrão = não lidos** (`userPropertiesFilter: {isRead:false}`), diferente do WME que manda tudo.
6. **HTTP 500 no `Issues/Read` quase sempre é RACE, não erro** — `code 300` + "Failed to handle request". Categorize por `errorList[0].code` ANTES de olhar o status HTTP.
7. **O SW só recarrega a página se já havia controller** — senão a primeira visita entra em flicker eterno.
8. **iOS não aceita SVG inline em `data:` pra ícone de PWA** — use arquivo em `icons/`.
9. **Toda mutação de `AppState.queue` chama `updatePendingCount`** — são 5 lugares hoje.
10. **NUNCA exponha valor de cookie** em log, toast, commit ou mensagem. Nome pode; valor não.
11. **O SW não pode usar fallback de HTML pra asset que falha** — devolvia HTML no lugar do `api.js` e a app morria com "API is not defined". E ignore cross-origin (`url.origin !== self.location.origin → return`).
12. **Atrás de Cloudflare: desabilite Rocket Loader, Auto Minify e Script Monitor** — reescrevem HTML/JS.
14. **A CSP tem TRÊS cópias em sincronia** (`<meta>` do index.html, `_headers` do Cloudflare e o `CSP` do `server/node.mjs`), e o browser aplica a INTERSEÇÃO. **A da VM entrou depois, fechando uma lacuna que ninguém via**: o `_headers` é arquivo de Cloudflare e o Node nunca o leu, então rodar na VM era rodar só com o `<meta>` — uma camada a menos, sem aviso. A app tem que ser a MESMA nos dois destinos, senão "levar pra uma VM" deixa de ser decisão de infraestrutura e vira mudança de comportamento. `test/layout.test.mjs` compara as três diretiva por diretiva; `test/csp-vm.test.mjs` **sobe o servidor** e confere que o cabeçalho SAI — string igual num arquivo não prova resposta HTTP. **O bootstrap inline do Bot Fight Mode fica bloqueado de propósito, e não há conserto** — MEDIDO: hash é impossível (o script carrega `cf-ray` e timestamp, 3 cargas = 3 hashes) e nonce não chega, porque o Cloudflare injeta o script ANTES da fase de cabeçalho onde a Transform Rule geraria o nonce (testado em produção: nonce no cabeçalho mudando a cada resposta, tag injetada SEM `nonce=` nas três). O preço é `errors-in-console` zerado → Boas práticas 92, com dois erros inertes que somem no dia em que a app sair do Cloudflare. `unsafe-inline` resolveria e está fora de questão. Também não há `cloudflareinsights` na CSP: o beacon do Web Analytics não é injetado (conferido no HTML de produção), era permissão morta. Sem `unsafe-eval` e sem `'unsafe-inline'` em `script-src`. **Script inline é permitido SÓ com HASH**, e hoje há exatamente um: o do tema, que precisa rodar antes do primeiro paint e não vale uma requisição bloqueante. Hash libera aquele texto e mais nada — XSS tem outro conteúdo, outro hash, segue bloqueado. **Só serve pra conteúdo NOSSO e estável**: o script da Cloudflare (Bot Management) carrega `cf-ray` e timestamp, então muda a cada resposta e não pode ser liberado assim (medido: 3 cargas, 3 hashes). Inline novo → hash próprio nas duas cópias, e `test/layout.test.mjs` recalcula e reprova quem esquecer — hash defasado BLOQUEIA o script em silêncio. Fora isso, script vai pra arquivo em `js/`. `style-src` mantém `unsafe-inline` de propósito (o swipe escreve `style.transform` por quadro).
15. **Rank do Waze é 0-indexed; a UI mostra `rank + 1`** — exibição soma 1, comparação usa o valor cru. Confundir dá bug silencioso em qualquer direção.
16. **O gate de login é `isStaff || (rank >= MIN_RANK_WAZE && isAreaManager)`**, no BACKEND — não dá pra burlar editando JS.
17. **Bumpe `js/version.js` E o `CACHE_NAME` do SW no MESMO commit** ao tocar em `index.html`, `js/`, `css/` ou `icons/`. É o bug mais ranzinza do projeto: users ficam dias na versão velha.
19. **Nunca `while (cond) await fn()` onde `fn` pode retornar síncrono sem progredir** — vira cascata de microtasks e congela a aba. Garanta que o await ceda o event loop.
20. **Todo reset de fila passa por `resetQueue`** — ele faz `fetchEpoch++` e descarrega o `pendingAction` (execute no refresh, cancel no logout).
21. **O filtro `isRead` do Waze é por VENUE, não por PUR** — a expansão pula `ur.isRead === true`, senão a foto já lida re-vira card eternamente.
22. **`css/app.css` é GERADO — nunca edite à mão.** Mexeu em classe do Tailwind **ou no `css/styles.css`**? `npm run css`, e commite. O CI cobra no diff, e some com o estilo em produção sem erro no console. **A pegadinha nova é o `styles.css`**: antes ele ia cru pro browser e editar bastava; agora ele é minificado pra dentro do `app.css`, então editar sem regerar não muda nada na tela.
    **A ORDEM é `tailwind` ANTES de `styles`** desde v2026.08.05-04 — o nosso CSS vence o empate de especificidade. Era a ordem dos `<link>`; com um arquivo só, virou a ordem da CONCATENAÇÃO em `tools/gerar-css.mjs`. Travado em `test/layout.test.mjs`, que confere dentro do arquivo gerado.
23. **Dark mode é 100% `dark:` no HTML/JS** — não crie override global. Se um `dark:` "não pega", é empate de especificidade: use `dark:hover:` explícito.
24. **`applyI18n()` não entra em `<template>`** — chame `applyI18n(card)` no clone, senão o card volta pro português a cada swipe.
25. **Auditoria de layout roda em TODAS as línguas** — a string mais larga decide o layout e quase nunca está no idioma em que você desenvolve. E texto que vaza da própria célula não aparece em teste de `scrollWidth`: meça caixa contra caixa.
26. **Feedback transitório não pode cobrir o alvo que ainda precisa ser tocado** — o countdown do dev mode tornava o próprio dev mode impossível de desbloquear. Diagnóstico: `document.elementFromPoint` no centro do alvo.
27. **RESOLVIDO em v2026.08.05-04 invertendo a ordem do CSS.** Era: seletor de uma classe do `styles.css` perdia pra utility por ordem de carga — mordeu 6 vezes em silêncio.
28. **Achado que acusa a app inteira é suspeito do INSTRUMENTO antes de ser bug** — contraste "1:1" por fundo em gradiente, alvo de 20px por ler `<label>` errado, "sem anel de foco" por medir no meio da animação, "1px abaixo da dobra" por medir no mesmo `evaluate` do render (e com viewport inventada). **Todo laço de medição de layout leva um caso de CONTROLE — a app de hoje, sem a mudança**: defeito que aparece igual com e sem o recurso não é do recurso.
29. **O card tem UMA área rolável, e ela é uma das duas que o `handleDragStart` ignora** — barra de rolagem em superfície de swipe desliga o gesto de pular. Linha de altura previsível → `flex-shrink-0`; caixa longa → `flex-1 min-h-0`. Área rolável nova → entra na exceção do arraste E ganha `marcarBordaRolagem`.
30. **`data-i18n` escreve textContent** — valor com markup chega escapado na tela. Use `data-i18n-html`, só com valor do próprio dicionário.
31. **Caixa que pode transbordar centraliza por MARGEM, não por `align-items`** — centralizado por eixo, o pedaço de cima fica inalcançável mesmo com `overflow:auto`. E meça contra a VIEWPORT, não contra o contêiner.
32. **A altura do `#cardStack` mora na cadeia de flex, não numa classe** — fração da janela ignora o que já foi gasto acima e joga a barra ✕/↑/✓ abaixo da dobra, sem gesto que a traga de volta.
33. **Comentário não é prova: leia o valor computado** — havia regra "compactando" com `font-size` idêntico e `padding` MAIOR que o do HTML.
34. **`scrollHeight`/`clientHeight` são inteiros arredondados** — 1px fantasma desenha barra de rolagem. A medição tem que ser VIVA (`ResizeObserver` com tolerância de 2px), e o seletor precisa de DUAS classes.
35. **Callback de `ResizeObserver` que escreve no DOM só AGENDA** (`requestAnimationFrame`) — senão re-entra no mesmo quadro e o aviso vira toast vermelho na cara do editor.
36. **No card quem cede espaço é a FOTO; apertar o texto não devolve pixel** — o que resolve é dar PISO ao texto (`min-height: min-content`), com escopo obrigatório em `:not(:has(...))` e `:not(.hidden)`.
37. **Linha "X → X" no diff se filtra pelo valor CRU** (deep-equal), nunca pelo texto formatado — polígono que andou 84m formata igual.
38. **Diff de objeto: `geometry` fica de FORA** (ela vira "moveu N m"), e folha que é lista passa pelo mesmo verde-entra/vermelho-sai do resto. `JSON.stringify` fica no fundo, atrás de um teto de profundidade 2.
39. **Revert de apresentação se persegue pelo CONCEITO, não pelo lugar** — `grep` do valor em todos os caminhos de render. Item de lista sai CRU: `humanizarEnum` corrompia apelido e ID do Google.
40. **Constante de contraste tem ESCOPO — o fundo em que foi medida.** `opacity: 0.8` vale pro slate sobre branco (5,74:1); sobre o verde do diff dá 3,41:1 e reprova. **Pior quando o fundo é VARIÁVEL**: botão translúcido sobre a foto ampliada dava 2,85:1 em foto clara e 8,45:1 em foto média — some com o problema pondo preenchimento SÓLIDO, e a borda precisa de DOIS tons porque toda cor sólida encontra uma foto igual a ela. Guard lê a cor COMPUTADA e recusa alfa < 1: classe que não existe no CSS compilado é indistinguível de classe certa se você olhar só o HTML.
41. **A sessão do KV precisa de janela DESLIZANTE** — `expirationTtl` conta do `put` e o `get` não estende nada. Carimbo no VALOR (`ts|blob`) + `SESSION_REFRESH_AFTER`; formato antigo tem que seguir valendo, senão o deploy desloga todo mundo.
42. **Um 401 NÃO é prova de sessão morta** — três coisas chegam como 401 e só uma exige relogar. `handleUnauthorized` confirma com uma segunda chamada, e o transporte não decide nada.
43. **O Waze ROTACIONA `_web_session` a cada resposta** — `callWaze` regrava a sessão. Use `getSetCookie()` (o `.get()` junta com vírgula e valor de cookie tem vírgula), `await` de verdade, e estrangule em 1h.
44. **Enum do Waze não se traduz por intuição** — o HAR do WME tem o dicionário oficial. `DOES_NOT_MATCH_SEARCH` estava com o sentido INVERTIDO, e isso muda a ação do editor.
45. **Frase mais longa cai num precipício, não numa ladeira** — quando o conteúdo estoura, a rede de segurança troca o flex da caixa longa e o conteúdo salta ~190px de uma vez.
46. **Transifex do Waze é a fonte de enum** — confira a contagem contra o `grep` cru antes de concluir que uma fonte é inútil (meu parser achou 5 de 134 e eu quase descartei).
47. **Tradução oficial não é literal entre idiomas** — use a string DAQUELE idioma, nunca a tradução da sua.
48. **`source` só existe no tipo REQUEST** — VENUE e IMAGE nunca trazem. O bundle do WME dentro do HAR responde o que o Transifex não responde: quais valores EXISTEM.
49. **O filtro `types` do Waze é por VENUE, não por PUR** — pedir um tipo devolve os pedidos irmãos do mesmo local. Por isso o corte continua sendo nosso. `TYPES_ALL` ≠ `TYPES_PADRAO`, e guard AVALIA a constante, não parseia a expressão.
50. **Quem não cabe é o card MAGRO, não o cheio** — e medir cada candidato por DOM antes de escrever código salvou: dois dos quatro primeiros PIORAVAM.
51. **Coordenada é exata e injulgável** — daí o mini-mapa, com tiles do próprio Waze na camada `live/base` (não `editor/roads`). O que não cabe em zoom nenhum é DITO, não empurrado pra fora da tela.
52. **Fixture define o que o teste é CAPAZ de enxergar** — a foto 800×400 do smoke era o único formato que nunca falha, e escondeu que a PROPORÇÃO da foto decidia o layout. Selecionar fixture pelo card mais PESADO é escolher sistematicamente o lado errado.
53. **Quando um otimizador tem cláusula de desistência, meça o ramo em que ele desiste** — "encaixar em um tile" é caso particular de "minimizar", e a versão particular falhava calada em paisagem.
54. **O prefetch mira no primeiro SLIDE, não na foto** — `mapaVemPrimeiro()` é fonte única e vale nos dois lados. O SW **não** cacheia tiles (ignora cross-origin) e tile vem com `max-age=600`.
55. **Os tiles são de TERCEIRO e o card sobrevive à queda deles** — marcadores e escala ficam, a `<img>` quebrada sai do DOM. E a seleção do teste usa a MESMA regra do carrossel.
56. **Gesto contínuo sobre conteúdo que se redesenha NÃO usa captura de ponteiro** — escute na `window`. E agende o desenho por quadro. Reusar CSS por classe arrasta junto o que não é aparência.
57. **Excluir foto: o Waze não apaga, SUBSTITUI a lista** — sem revisão nem If-Match, quem escreve por último ganha. Relê o local e monta a lista do que o Waze diz AGORA. Não existe leitura por ID (5 formas, todas 406).
57.1. **A grade de gerenciar fotos foi decidida como NÃO** — e o 42% que parece pedi-la é armadilha: medi fotos que EXISTEM, não que são EXCLUÍDAS.
58. **O tile era desenhado com 393px onde o código pedia 512** — `img{max-width:100%}` do preflight. Meça `getBoundingClientRect()` (o que a tela deu), não `style.width` (o que você pediu). Stub idêntico pra todo recurso não detecta erro de posição.
59. **Regra de produto que muda não some: vira contrato mais estreito** — a app passou a aprovar FOTO, e o que guarda a regra antiga é `data.approve === true`, booleano estrito. Coerção é o risco real (`'false'` é truthy). O portão é só do CLIENTE de propósito, e caminho de ESCRITA se valida comparando o payload com o do WME no HAR — `/Features` não se chama com os cookies do owner.
63. **Regra de estado que vale em duas telas mora em UMA função** — `acoesTravadas()`/`aplicarTravaDeAcao()` agora cobrem o card E o lightbox. Enquanto a trava era só do card, os botões de foto seguiam vivos durante o Desfazer. Meça o ATRIBUTO e o PIXEL: `disabled` sem esmaecer é "botão morto com cara de vivo"; esmaecer sem `disabled` engana Tab e leitor de tela.
62. **Não infira "está vivo" da AUSÊNCIA de um marcador** — o 401 do nosso store não passa pelo `categorizeWazeError` e vinha sem `errorCategory`; o cliente lia "não é unauthorized" e mantinha a sessão morta, mostrando "conexão instável" pra sempre. Carimbe na origem E decida por sinal POSITIVO. Fixture que usa token falso passa a medir outra coisa quando o 401 vira real.
61. **Registro de tipos diferentes no MESMO store precisa de sinal no NOME** — a varredura da VM podava pelo carimbo do valor, mas ele é "vence em" no pareamento e "último uso" na sessão: apagava toda sessão válida a cada boot. Hoje o pareamento é `sess_pair_`. Teste de ADAPTADOR não sai de graça com teste de core.
60. **Criptografia em repouso só vale se a chave não estiver do lado do dado** — `HKDF(Secret, token)`, e o token nunca em URL/query/header/log. O QR do pareamento vazava o segredo na query. Segredo digitável é fraco por tamanho: crie-o sob demanda, senão ele rebaixa o caminho forte.
18. **Version skew: três camadas precisam estar alinhadas** — estratégia do SW, opção `cache` do `fetch` (`{ cache: 'reload' }`) e Cache-Control do servidor. Mexer numa só rompe a cadeia, e no celular não há `Ctrl+Shift+R`.


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
