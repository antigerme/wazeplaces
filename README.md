# Waze Places — Limpeza de Pedidos

PWA estilo Tinder para **editores do Waze Map Editor (WME)** limparem rapidamente os pedidos de places enviados por usuários — fotos lixo, nomes ruins, endereços errados, categorias absurdas. Arraste para rejeitar (lixo) ou marcar como lido (você decide depois no WME).

> ⚠️ **Esta aplicação NUNCA aprova places.** Aprovação exige ajuste no mapa e precisa ser feita no WME oficial. Aqui você só **rejeita** ou **marca como lido**, eliminando o lixo antes que outro editor novato aprove besteira.

---

## 📑 Índice

- [🟢 Para Editores (Guia Simples)](#-para-editores-guia-simples)
  - [O que essa app faz](#o-que-essa-app-faz)
  - [Como usar (a forma mais fácil)](#como-usar-a-forma-mais-fácil)
  - [Como exportar seus cookies do Waze](#como-exportar-seus-cookies-do-waze)
  - [Usando a aplicação](#usando-a-aplicação)
  - [Instalar como app no celular](#instalar-como-app-no-celular)
  - [Quem pode usar](#quem-pode-usar)
  - [Problemas comuns](#problemas-comuns)
- [🔧 Para Desenvolvedores (Avançado)](#-para-desenvolvedores-avançado)

---

## 🟢 Para Editores (Guia Simples)

### O que essa app faz

Quando você abre o **Issue Tracker** do Waze Map Editor, vê uma fila enorme de pedidos enviados por usuários comuns. Muitos são lixo: foto borrada, nome errado, categoria absurda. Limpar isso no WME um por um é lento.

Esta aplicação mostra os pedidos em formato de **cards estilo Tinder**:

- **Arraste para a esquerda (←)** → Rejeita o pedido (lixo)
- **Arraste para a direita (→)** → Marca como lido (você decide depois no WME)
- **Arraste para cima (↑)** → Pula (não chama nada, só avança)
- **Botões ✕ / ↑ / ✓** no rodapé do card fazem o mesmo (o gesto é atalho)
- **Botão ↗ no card** → Abre o local direto no WME para você ajustar e aprovar manualmente

Funciona no celular, no tablet ou no PC, e pode ser **instalada como app no seu celular** (sem precisar de Play Store / App Store).

### Como usar (a forma mais fácil)

Você **não precisa instalar nada** — a app roda hospedada. Basta acessar:

👉 **https://places.wazebrasil.com**

Aí é só fazer login com seus cookies do Waze (veja abaixo). A forma mais cômoda no desktop é a extensão de login automático:

- **Login automático (recomendado, Chrome):** instale a extensão **WazePlaces Rapid Access** ([Chrome Web Store](https://chromewebstore.google.com/detail/dpinfpcoggnilplfgkpnkhbmfokhnhnn), feita por [@daflash](https://www.waze.com/pt-BR/user/editor/daflash) da comunidade WME). Estando logado no WME, clique nela e a app abre já autenticada — sem copiar cookies.
- **Login manual:** exporte seu `cookies.txt` do Waze (instruções abaixo) e faça upload / cole na tela inicial.

> 📱 **No celular** (onde não há extensões): use o login manual com o `cookies.txt`.

### Como exportar seus cookies do Waze

A app precisa dos seus cookies de login para acessar a fila de pedidos no seu nome.

#### Chrome / Edge / Brave

1. Instale a extensão **"Get cookies.txt LOCALLY"** da Chrome Web Store ([link direto](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc))
2. Acesse https://www.waze.com/editor e **faça login**
3. Clique no ícone da extensão (no canto direito do navegador)
4. Clique em **Export** ou **Download**
5. Vai baixar um arquivo `cookies.txt` para sua pasta de Downloads

#### Firefox

1. Instale a extensão **"cookies.txt"** ([link direto](https://addons.mozilla.org/firefox/addon/cookies-txt/))
2. Acesse https://www.waze.com/editor e **faça login**
3. Clique no ícone da extensão
4. Clique em **Export cookies.txt**
5. Vai baixar o arquivo

### Usando a aplicação

1. Faça login (extensão de login automático ou upload/colar do `cookies.txt`).
2. Aguarde alguns segundos. Se tudo der certo, aparece **"Autenticado com sucesso!"**, seu **avatar do Waze e nome** aparecem no topo, e os cards começam a carregar (Brasil é o padrão).
3. Pra trocar o **país**, a **região** ou filtrar por **estado** / **área gerenciada**, clique no ícone de **filtros 📂** no topo. Os países/estados aparecem em listas com nomes (sem precisar saber ID).
4. Processe os pedidos arrastando os cards, usando os **botões do card**, ou as setas do teclado:
   - **← (esquerda):** Rejeitar (lixo)
   - **→ (direita):** Marcar como lido
   - **↑ (cima):** Pular (não chama API, só passa pro próximo)
5. Cometeu um erro? Tem uma **janela de 5 segundos** para clicar em "Desfazer" antes da ação ser enviada ao Waze.
6. O botão de **ajuda (?)** no topo abre um painel com atalhos, legenda, instruções e o botão **"Sair"**.

**Coisas que aparecem no card:**
- **Marca** do place + selo "✓ conhecida" (se está na lista oficial do Waze) ou "? não listada" (suspeita)
- **Carrossel de fotos** (compare a foto nova ✨ com as existentes — toque pra ampliar, com zoom por pinça)
- **Mudanças propostas** lado a lado (antes → depois) para pedidos de atualização
- **Link ↗** para abrir o local direto no WME

**Caixa de estatísticas:** **Lidos** · **Rejeitados** · **Pulados** · **Restam**. "Restam" mostra quantos pedidos ainda estão pendentes no Waze; diminui a cada `Lido`/`Rejeitado` (pular não diminui). Sinal `+` (ex: `215+`) = ainda há mais páginas a buscar.

### Instalar como app no celular

Depois de abrir a app no celular:

- **Chrome / Edge:** Toque no menu (3 pontinhos) → **"Instalar aplicativo"** ou **"Adicionar à tela inicial"**
- **Safari (iPhone):** Toque no ícone de compartilhar (quadrado com seta) → **"Adicionar à Tela de Início"**

Vai virar um ícone normal no seu celular, abrindo em tela cheia sem barra do navegador.

### Quem pode usar

Esta aplicação é **restrita** a editores do Waze com perfil mais avançado, para reduzir risco de uso indevido por editores novatos:

- **Staff do Waze** (qualquer nível) → libera direto
- **Area Manager** com nível **3 ou maior** → libera

Editores nível 1-2, ou sem badge de Area Manager, recebem a mensagem **"Acesso restrito"** ao tentar fazer login.

### Problemas comuns

| Problema | O que fazer |
|----------|-------------|
| **"Acesso restrito"** | Você precisa ser Staff do Waze ou Area Manager nível 3+. Verifique seu perfil no WME |
| **"Cookies expirados ou inválidos"** | Faça logout do WME, faça login de novo, exporte os cookies novamente |
| **"Token CSRF não encontrado"** | O arquivo `cookies.txt` está incompleto. Confirme que você fez login antes de exportar |
| **"Não há places para mostrar"** | Não tem nada na fila daquela região/país. Tente outro país no menu de filtros |
| **A app não atualiza para a versão nova** | No navegador: `Ctrl+Shift+R`. No celular: geralmente atualiza sozinha; se não, feche e reabra o app |

---

## 🔧 Para Desenvolvedores (Avançado)

### Stack

- **Frontend:** HTML + JavaScript vanilla + Tailwind CSS (bundle JS local `tailwindcss_3_4_17.js`) + PWA (manifest + service worker)
- **Backend:** JavaScript (ESM), **sem build**, no padrão **core compartilhado + adaptadores**:
  - `server/core.mjs` — toda a lógica (proxy pro Waze, sessões, cripto, gate). Só usa `fetch` e Web Crypto → roda **igual** em Cloudflare Workers e Node 18+.
  - `functions/api/[[route]].js` — adaptador **Cloudflare Pages** (sessões em Workers KV, chave em Secret).
  - `server/node.mjs` — adaptador **VM/Node** (sessões em filesystem, chave em env/arquivo).
- **Auth:** cookies do WME → sessão criptografada server-side (**AES-256-GCM**). O client só guarda um `sessionToken` opaco.

> Histórico: até a v2.x o backend era PHP + Apache. A v3.0 migrou pra JS (Cloudflare/Node) mantendo o mesmo contrato de API. O planejamento e o mapa de conversão estão em [`docs/cloudflare-migration.md`](docs/cloudflare-migration.md).

### Arquitetura

```
Browser (PWA)
  ↓ POST /api/testar-cookies   (cookies → sessionToken criptografado)
  ↓ POST /api/buscar-places    (sessionToken → places normalizados)
  ↓ POST /api/marcar-lido      (sessionToken, venueID, updateRequestID)
  ↓ POST /api/validar-place    (sessionToken, venueID, updateRequestID)
Backend (server/core.mjs, stateless por request)
  ↓ Lê a sessão no store (KV no Cloudflare / filesystem na VM)
  ↓ Descriptografa os cookies (AES-256-GCM)
  ↓ fetch() ao Waze (CSRF token + headers de origem)
APIs internas do Waze
  - /Issues/Search/List      (buscar pedidos)
  - /Issues/Read             (marcar como lido)
  - /Descartes/app/Features  (rejeitar)
  - /Session, /LocationSearch/{Countries,States}
```

### Estrutura de arquivos

```
wazeplaces/
├── index.html              # Single-page app
├── manifest.json           # PWA manifest
├── service-worker.js       # Service worker (cache + auto-update)
├── icons/                  # icon-192.svg, icon-512.svg
├── css/styles.css
├── js/
│   ├── app.js              # Lógica principal, AppState, UI
│   ├── api.js              # Wrapper do fetch() para /api/*
│   ├── swipe.js            # Gestos drag/swipe
│   └── tailwindcss_3_4_17.js
├── server/
│   ├── core.mjs            # Lógica compartilhada (proxy Waze, sessões, cripto, gate)
│   └── node.mjs            # Adaptador VM/Node (http + estáticos + fs sessions)
├── functions/
│   └── api/[[route]].js    # Adaptador Cloudflare Pages Functions (KV + Secret)
├── _headers                # Headers/CSP no Cloudflare (substitui o antigo .htaccess)
├── wrangler.jsonc          # Config Cloudflare (binding do KV)
├── .assetsignore           # Exclui server/docs/etc do publish estático
├── package.json            # Scripts (start / cf:dev / cf:deploy)
├── docs/                   # Referência de dev (NÃO servido em runtime)
├── README.md
└── CLAUDE.md
```

### Rodar local

Precisa de **Node 18+** (nada de npm install — zero dependências):

```bash
git clone https://github.com/antigerme/wazeplaces.git
cd wazeplaces
node server/node.mjs          # http://localhost:8080
```

Variáveis de ambiente (todas opcionais):

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `8080` | Porta de escuta |
| `HOST` | `0.0.0.0` | Host bind (`127.0.0.1` restringe ao localhost) |
| `ENCRYPTION_KEY` | auto-gera | Chave AES base64 (32 bytes). Sem ela, gera uma em `SESSION_KEY_FILE` |
| `SESSION_DIR` | `/tmp/waze_places_sessions` | Onde ficam os blobs de sessão |
| `SESSION_KEY_FILE` | `/tmp/waze_places.key` | Arquivo da chave auto-gerada |

Para simular o ambiente Cloudflare localmente (Functions + KV): `npx wrangler pages dev .` (precisa do `wrangler`).

### Deploy

#### Opção A — Cloudflare Pages + Workers (recomendado)

```bash
# 1. Namespace KV pras sessões (cole o id em wrangler.jsonc)
npx wrangler kv namespace create SESSIONS

# 2. Chave de criptografia como Secret
openssl rand -base64 32 | npx wrangler pages secret put ENCRYPTION_KEY

# 3. Deploy
npx wrangler pages deploy .
```

Ou conecte o repositório no dashboard (**Workers & Pages → Create → Connect to Git**) pra deploy automático a cada push na `main`. Configure o binding KV `SESSIONS` e o Secret `ENCRYPTION_KEY` nas *Settings* do projeto.

Ganhos: sem servidor pra manter, escala automática, edge global, HTTPS automático. O `_headers` cuida da CSP e do cache. **Free tier:** 100k requests/dia, 100k leituras KV/dia, 1k escritas/dia (cada login = 1 escrita; cada ação = 1 leitura). Passou disso, Workers Paid custa US$5/mês.

#### Opção B — VM Red Hat / RHEL / Rocky / Alma (Node + nginx)

Fallback sem depender do Cloudflare. Mesma `server/core.mjs`, zero divergência.

```bash
sudo dnf install -y nodejs git
sudo git clone https://github.com/antigerme/wazeplaces /opt/wazeplaces
```

Serviço systemd (`/etc/systemd/system/wazeplaces.service`):

```ini
[Service]
User=nobody
ExecStart=/usr/bin/node /opt/wazeplaces/server/node.mjs
Environment=PORT=8080
Environment=ENCRYPTION_KEY=<gere com: openssl rand -base64 32>
Environment=SESSION_DIR=/var/lib/wazeplaces/sessions
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/wazeplaces/sessions
sudo systemctl enable --now wazeplaces
```

HTTPS via nginx (reverse proxy na frente do Node):

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

`sudo certbot --nginx -d seudominio.com` pro TLS. Vantagem sobre o stack PHP antigo: um processo Node só, sem SELinux booleans, sem `restorecon`, sem tuning de workers.

### Multi-região

| Região | Endpoint base | Uso típico |
|---|---|---|
| `row` | `www.waze.com/row-Descartes/...` | Brasil, Europa, outros |
| `na` | `www.waze.com/na-Descartes/...` | EUA, Canadá |
| `il` | `www.waze.com/il-Descartes/...` | Israel |
| `world` | `www.waze.com/Descartes/...` | Fallback |

Configure pelo modal de filtros (header). Default `row`.

### Gate de acesso (quem pode usar)

Critério mínimo aplicado **no backend** (`isUserAllowed` em `server/core.mjs`), dentro do `testar-cookies` antes de criar a sessão:

```
isStaff === true                          → libera
(rank >= MIN_RANK_WAZE && isAreaManager)  → libera
caso contrário                            → 403 access_denied
```

`MIN_RANK_WAZE = 2` (Waze é 0-indexed; equivale a "display L3+"). Como a checagem é no servidor **antes** de criar a sessão, não dá pra burlar editando JS no DevTools.

### Resiliência a race conditions entre editores

Vários editores tratam o mesmo place ao mesmo tempo. `categorizeWazeError(httpCode, body, err)` em `server/core.mjs` classifica a resposta do Waze e o backend devolve `errorCategory` no JSON.

**Códigos reais observados (via HAR do WME):**
- `Features` (rejeitar) → HTTP **404** + `errorList[0].code: 702` + `"was not found"`
- `Issues/Read` (marcar lido) → HTTP **500** + `errorList[0].code: 300` + `"Failed to handle request"`

| Categoria | Quando | Frontend |
|---|---|---|
| `already_processed` | code ∈ {702, 300+"failed to handle"}, HTTP 409, ou hint textual | Toast "Já tratado por outro editor 👍", **mantém** stats |
| `not_found` | HTTP 404 puro | Idem |
| `unauthorized` | HTTP 401/403 | Invalida sessão local, volta pra tela de login |
| `transient` | 5xx sem padrão de race, 408, 429, 0, erro de rede | `callWithRetry` 2x com backoff (1.5s, 3.5s) |
| `unknown` | Resto | Reverte stat, toast de erro |

A checagem de `errorList[0].code` acontece **antes** da regra `5xx → transient`, pra uma race no `Issues/Read` (HTTP 500) não virar "instabilidade real".

### Segurança

- **Cookies trafegam apenas no login.** Viram um `sessionToken` opaco; os cookies ficam criptografados (**AES-256-GCM**) no store (KV/filesystem).
- **Chave de criptografia:** Secret `ENCRYPTION_KEY` no Cloudflare; env var ou arquivo `0600` na VM. Nunca commitada.
- **TTL de sessão:** 21 dias (`SESSION_TTL` em `server/core.mjs`). No KV expira sozinho (TTL nativo); na VM, por mtime + touch. Cookies do Waze duram ~28 dias — o TTL menor dá folga. Quando expiram de verdade, o backend devolve 401 e o frontend cai pra tela de login.
- **Erros 500 não vazam detalhe interno** — o `dispatch` devolve mensagem genérica.
- **CSP** definida em `index.html` e no `_headers` (precisa `unsafe-eval` por causa do Tailwind via JS — remova ao pré-compilar).

### O que NÃO está implementado (decisão consciente)

- Rate limiting no nível do app (Waze Staff pediu pra manter sem, por ora)
- Tailwind pré-compilado (usa o bundle JS por enquanto)
- iOS/desktop nativo (a PWA cobre; ver `docs/native-android-analysis.md`)

### Service Worker

- **Estratégia:** network-first pra HTML/JS/CSS/JSON (com `cache: 'reload'` pra bypassar o HTTP cache); cache-first pra imagens/fontes. Cache é fallback offline.
- **Pra invalidar caches:** bump `CACHE_NAME` em `service-worker.js` **e** `APP_VERSION` em `js/app.js`, juntos, em toda PR que toque em `index.html`/`js`/`css`/`icons`.

### Validação rápida antes de commitar

```bash
for f in js/*.js server/*.mjs "functions/api/[[route]].js"; do node --check "$f"; done
node server/node.mjs   # smoke test: sobe, serve estáticos, /api/* responde
```

> ⚠️ O sandbox de CI e agentes tem allowlist que bloqueia `*.waze.com`. Não dá pra testar contra o Waze real automaticamente — valide com fixtures de HAR ou teste manual.

### Contribuindo

1. Fork → branch a partir de `main`
2. Mudanças + `node --check`
3. PR com descrição do **porquê** (não só o quê)

---

## ⚠️ Avisos

1. **Não compartilhe seu `cookies.txt`** — contém suas credenciais de login do Waze
2. **Esta aplicação NÃO é oficial do Waze** — é uma ferramenta da comunidade
3. **Respeite as diretrizes do Waze** — não rejeite em massa sem analisar cada pedido

---

**Desenvolvido para a comunidade Waze Brasil** 🇧🇷
