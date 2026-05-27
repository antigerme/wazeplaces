# Waze Places — Limpeza de Pedidos

PWA estilo Tinder para **editores do Waze Map Editor (WME)** limparem rapidamente os pedidos de places enviados por usuários — fotos lixo, nomes ruins, endereços errados, categorias absurdas. Arraste para rejeitar (lixo) ou marcar como lido (você decide depois no WME).

> ⚠️ **Esta aplicação NUNCA aprova places.** Aprovação exige ajuste no mapa e precisa ser feita no WME oficial. Aqui você só **rejeita** ou **marca como lido**, eliminando o lixo antes que outro editor novato aprove besteira.

---

## 📑 Índice

- [🟢 Para Editores (Guia Simples)](#-para-editores-guia-simples)
  - [O que essa app faz](#o-que-essa-app-faz)
  - [Como rodar na sua máquina (3 passos)](#como-rodar-na-sua-própria-máquina-3-passos)
  - [Como exportar seus cookies do Waze](#como-exportar-seus-cookies-do-waze)
  - [Usando a aplicação](#usando-a-aplicação)
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
- **Botão ↗ no card** → Abre o local direto no WME para você ajustar e aprovar manualmente

Funciona no celular, no tablet ou no PC, e pode ser **instalada como app no seu celular** (sem precisar de Play Store / App Store).

### Como rodar na sua própria máquina (3 passos)

A app é simples e roda com o **PHP** (que já vem instalado em muitos sistemas, ou é fácil instalar).

#### Passo 1 — Baixe o código

**Opção A (botão):** Vá em https://github.com/antigerme/wazeplaces, clique em **"Code"** → **"Download ZIP"** e descompacte em alguma pasta do seu computador (ex: `Documentos/wazeplaces`).

**Opção B (linha de comando):** Se você tem `git` instalado:
```bash
git clone https://github.com/antigerme/wazeplaces.git
cd wazeplaces
```

#### Passo 2 — Instale o PHP (se ainda não tem)

| Sistema | Como instalar |
|---------|---------------|
| **Windows** | Baixe o ZIP em https://windows.php.net/download/ → descompacte numa pasta (ex: `C:\php`) → adicione `C:\php` no PATH do sistema → abra um **novo** terminal (cmd ou PowerShell) e teste com `php -v` |
| **macOS**   | PHP geralmente já vem instalado. Se não vier: `brew install php` (precisa do [Homebrew](https://brew.sh)) |
| **Linux** (Ubuntu/Debian) | `sudo apt update && sudo apt install -y php php-curl` |
| **Linux** (Fedora) | `sudo dnf install -y php php-curl` |

Para conferir, abra o terminal e rode:
```bash
php -v
```
Deve aparecer algo como `PHP 8.x.x`. **Precisa ser 7.4 ou maior.**

#### Passo 3 — Rodar a aplicação

Dentro da pasta `wazeplaces` (a que você baixou), rode o script de inicialização:

**Linux / macOS** (no terminal):
```bash
./start.sh
```

**Windows** — dê duplo clique em `start.bat`, ou rode no cmd/PowerShell:
```cmd
start.bat
```

**Windows (cmd):**
```cmd
set PHP_CLI_SERVER_WORKERS=4 && php -S 0.0.0.0:8080
```

**Windows (PowerShell):**
```powershell
$env:PHP_CLI_SERVER_WORKERS=4; php -S 0.0.0.0:8080
```

> ⚠️ **Importante:** o `PHP_CLI_SERVER_WORKERS=4` faz o servidor atender 4 requisições ao mesmo tempo. **Sem isso**, o PHP atende uma de cada vez e a app fica travando entre cada ação (porque cada requisição ao Waze leva 1-2 segundos).

Pronto! Abra o navegador (Chrome, Firefox, Edge…) e acesse:

👉 **http://localhost:8080**

> 💡 **Para parar o servidor:** aperte `Ctrl+C` no terminal (ou feche a janela do `start.bat`).

> 💡 **Para acessar do celular na mesma rede Wi-Fi:** descubra o IP do PC (`ipconfig` no Windows, `ifconfig` ou `ip addr` no Linux/Mac) e acesse `http://SEU-IP:8080` no celular. Ex: `http://192.168.0.10:8080`.

> 💡 **No Linux/macOS, se der "permission denied"** ao rodar `./start.sh`, primeiro rode `chmod +x start.sh` uma vez.

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

1. Na tela inicial, escolha sua **Região do Waze**:
   - **Brasil, Portugal, Europa, América Latina** → `ROW`
   - **EUA, Canadá** → `NA`
   - **Israel** → `IL`
2. Clique em **"Fazer Upload do cookies.txt"** e escolha o arquivo que você baixou (ou cole o conteúdo).
3. Aguarde alguns segundos. Se tudo der certo, aparece **"Autenticado com sucesso!"**, seu **avatar do Waze e nome** aparecem no topo, e os cards começam a carregar (Brasil é o padrão).
4. Pra trocar o **país** ou filtrar por **estado** ou **área gerenciada**, clique no ícone de **filtros 📂** no topo. Os países/estados aparecem em listas com nomes (sem precisar saber ID).
5. Processe os pedidos arrastando os cards (ou usando as setas do teclado):
   - **← (esquerda):** Rejeitar (lixo)
   - **→ (direita):** Marcar como lido
   - **↑ (cima):** Pular (não chama API, só passa pro próximo)
6. Cometeu um erro? Tem uma **janela de 3 segundos** para clicar em "Desfazer" antes da ação ser enviada ao Waze.
7. O botão de **ajuda (?)** no topo abre um painel com os atalhos, instruções e o botão **"Sair e Limpar Dados"**.

**Coisas que aparecem no card:**
- **Marca** do place + selo "✓ conhecida" (se está na lista oficial do Waze) ou "? não listada" (suspeita)
- **Galeria de fotos** (se houver mais de uma)
- **Mudanças propostas** lado a lado (antes → depois) para pedidos de atualização
- **Link ↗** para abrir o local direto no WME

**Header:**
- **Avatar + nome** do seu usuário Waze
- **Filtros 📂** para país/estado/área/tipo de pedido (e checkbox "Apenas pedidos não lidos", ligado por padrão — desmarque se quiser revisar pedidos já marcados como lidos)
- **Tema 🌙** alterna entre claro e escuro

**Caixa de estatísticas:**
- **Lidos** · **Rejeitados** · **Pulados** · **Restam**
- "Restam" mostra quantos pedidos ainda estão pendentes no Waze (equivalente ao "PUR (N)" no WME oficial). O número diminui a cada `Lido` ou `Rejeitado`. **Pular não diminui** — o pedido continua pendente para você ou outro editor.
- Se aparecer com sinal `+` (ex: `215+`), significa que ainda há mais páginas a buscar do Waze conforme você for processando.

### Instalar como app no celular

Depois de abrir a app no celular:

- **Chrome / Edge:** Toque no menu (3 pontinhos) → **"Instalar aplicativo"** ou **"Adicionar à tela inicial"**
- **Safari (iPhone):** Toque no ícone de compartilhar (quadrado com seta) → **"Adicionar à Tela de Início"**

Vai virar um ícone normal no seu celular, abrindo em tela cheia sem barra do navegador.

### Quem pode usar

Esta aplicação é **restrita** a editores do Waze com perfil mais avançado, para reduzir risco de uso indevido por editores novatos:

- **Staff do Waze** (qualquer nível) → libera direto
- **Area Manager** com nível **3 ou maior** → libera

Editores nível 1-2, ou editores sem badge de Area Manager, vão receber a mensagem **"Acesso restrito"** ao tentar fazer login.

Se você acha que deveria ter acesso, abra seu perfil no Waze Map Editor e confirme que você tem `Area Manager` ativo e nível ≥ 3.

### Problemas comuns

| Problema | O que fazer |
|----------|-------------|
| **"Acesso restrito"** | Você precisa ser Staff do Waze ou Area Manager nível 3+. Verifique seu perfil no WME |
| **"Cookies expirados ou inválidos"** | Faça logout do WME, faça login de novo, exporte os cookies novamente |
| **"Token CSRF não encontrado"** | O arquivo `cookies.txt` está incompleto. Confirme que você fez login antes de exportar |
| **"Não há places para mostrar"** | Não tem nada na fila daquela região/país. Tente outro país no menu de filtros |
| **A app não atualiza para a versão nova** | No navegador: `Ctrl+Shift+R` (Windows/Linux) ou `Cmd+Shift+R` (Mac). No celular: feche e reabra o app |
| **PHP não inicia** | Confirme que está dentro da pasta `wazeplaces` (`ls` ou `dir` deve mostrar `index.html`) |
| **Erro "cURL not loaded"** | Instale a extensão cURL do PHP: `sudo apt install php-curl` (Linux) ou habilite no `php.ini` (Windows) |
| **A app trava ao clicar várias vezes** | Use o script `start.sh` / `start.bat` em vez de rodar `php -S` direto (eles ligam o modo multi-tarefa do PHP) |

---

## 🔧 Para Desenvolvedores (Avançado)

### Stack

- **Frontend:** HTML + JavaScript vanilla + Tailwind CSS (carregado via `tailwindcss_3_4_17.js`)
- **Backend:** PHP 7.4+ stateless (apenas sessões temporárias em `/tmp`)
- **Auth:** cookies do WME exportados pelo usuário → sessão criptografada server-side (AES-256-CBC)
- **PWA:** manifest.json + service worker com network-first para HTML

### Arquitetura

```
Browser (PWA)
  ↓ POST /api/sessao.php (cookies → sessionToken criptografado)
  ↓ POST /api/buscar-places.php (sessionToken → places normalizados)
  ↓ POST /api/marcar-lido.php (sessionToken, venueID, updateRequestID)
  ↓ POST /api/validar-place.php (sessionToken, venueID, updateRequestID)
PHP Backend (stateless por request)
  ↓ Lê sessão em /tmp/waze_places_sessions/sess_<hash>
  ↓ Descriptografa cookies com chave em /tmp/waze_places.key
  ↓ Monta requisição cURL ao Waze (CSRF token + headers de origem)
APIs internas do Waze
  - /Issues/Search/List      (buscar pedidos)
  - /Issues/Read             (marcar como lido)
  - /Descartes/app/Features  (rejeitar)
```

### Estrutura de arquivos

```
wazeplaces/
├── index.html           # Single-page app
├── manifest.json        # PWA manifest
├── service-worker.js    # Service worker (cache + auto-update)
├── icons/
│   ├── icon-192.svg
│   └── icon-512.svg
├── css/
│   └── styles.css
├── js/
│   ├── app.js                    # Lógica principal, AppState, UI
│   ├── api.js                    # Wrapper do fetch() para /api/*
│   ├── swipe.js                  # Gestos drag/swipe (horizontal + up)
│   └── tailwindcss_3_4_17.js     # Tailwind via JS (substituir por build estático em prod)
├── api/
│   ├── config.php           # Constantes, sessões, cURL, regiões
│   ├── sessao.php           # POST {action: create|destroy}
│   ├── testar-cookies.php   # Valida cookies + cria sessão
│   ├── buscar-places.php    # Lista pedidos pendentes
│   ├── marcar-lido.php      # Marca como lido (Issues/Read)
│   └── validar-place.php    # Rejeita (Features endpoint, approve=false)
├── .htaccess            # Config Apache (rewrite, headers, cache, compressão)
├── start.sh             # Wrapper dev (Linux/macOS): PHP_CLI_SERVER_WORKERS=4 + php -S
├── start.bat            # Wrapper dev (Windows): idem
├── README.md
└── .gitignore
```

### Multi-região

A app suporta as URLs base do Waze:

| Região   | Endpoint base                            | Uso típico                |
|----------|------------------------------------------|---------------------------|
| `row`    | `www.waze.com/row-Descartes/...`         | Brasil, Europa, outros    |
| `na`     | `www.waze.com/na-Descartes/...`          | EUA, Canadá               |
| `il`     | `www.waze.com/il-Descartes/...`          | Israel                    |
| `world`  | `www.waze.com/Descartes/...`             | Fallback                  |

Configure pelo seletor na tela de login ou pelo modal de filtros (header).

### Gate de acesso (quem pode usar)

A app aplica um critério mínimo de permissão **no backend** em `testar-cookies.php` antes mesmo de criar a sessão. Helper `isUserAllowed($profile)` em `config.php`:

```php
isStaff === true                              → libera
(rank >= MIN_RANK_WAZE && isAreaManager)      → libera
caso contrário                                → 403 access_denied
```

`MIN_RANK_WAZE = 2` (Waze é 0-indexed; equivale a "display L3+"). Pra ajustar, mude essa constante em `config.php`.

Frontend trata `errorCategory: 'access_denied'` mostrando o modal `accessDeniedModal` com o perfil do user (userName + rank+1 + AM/não-AM/Staff) e mantém na tela de auth. Como a checagem é no PHP **antes** de `createSession`, não há como burlar editando JS no DevTools — o cookie nem chega a virar sessão útil.

### Resiliência a race conditions entre editores

Vários editores tratam o mesmo place ao mesmo tempo. A app trata o cenário "outro editor chegou primeiro" sem quebrar o fluxo nem zerar stats injustamente.

O backend (`validar-place.php`, `marcar-lido.php`) categoriza o erro do Waze via `categorizeWazeError($httpCode, $body, $curlError)` em `config.php` e devolve `errorCategory` no JSON.

**Códigos de erro reais observados em race conditions (capturados via HAR do WME):**
- `Features` (rejeitar) → HTTP **404** com `errorList[0].code: 702` e `details` contendo `"was not found"`
- `Issues/Read` (marcar lido) → HTTP **500** com `errorList[0].code: 300` e `details: "Failed to handle request"`

| Categoria | Quando | Frontend (`handleActionResult`) |
|---|---|---|
| `already_processed` | `errorList[0].code` ∈ {702, 300+"failed to handle"}, HTTP 409, ou hint textual ("was not found", "already", "duplicate", "no longer", "has been resolved") | Toast info "Já tratado por outro editor 👍", **mantém** stats (objetivo do user foi cumprido) |
| `not_found` | HTTP 404 sem código específico | Idem `already_processed` |
| `unauthorized` | HTTP 401/403 | Toast de erro, invalida sessão local, volta pra tela de login |
| `transient` | HTTP 5xx (sem padrão de race), 408, 429, 0, ou erro de cURL | `callWithRetry` tenta de novo 2x com backoff (1.5s, 3.5s) antes de aceitar falha |
| `unknown` | Outros | Reverte stat (`stats.read--`/`stats.rejected--` + `serverTotal++`), toast de erro |

Importante: a checagem do `errorList[0].code` acontece **antes** da regra `5xx → transient`, pra que uma race no `Issues/Read` (HTTP 500) não seja confundida com instabilidade real do servidor.

### Segurança

- **Cookies trafegam apenas no login.** O backend troca por um session token e os cookies originais ficam criptografados (AES-256-CBC) em `/tmp/waze_places_sessions/sess_<hash>` com permissão `0600`.
- **Chave de encriptação** é gerada uma única vez em `/tmp/waze_places.key` (`0600`). No Apache do Red Hat, `/tmp` é isolado por `PrivateTmp=yes` (systemd), então só o próprio Apache lê/escreve. Se o Apache reinicia, chave nova e sessões antigas viram inválidas — usuários fazem login novamente.
- **TTL de sessão:** 30 dias (`SESSION_TTL` em `api/config.php`). Cada uso renova o tempo (touch). Token fica em `localStorage` (persiste entre abas/dias). Quando os cookies do Waze expiram de verdade, o backend devolve 401 e o frontend cai pra tela de login automaticamente.
- **Arquivos temporários** de cookies usados pelo cURL têm `0600` e são deletados imediatamente após cada chamada.
- **Sessões expiradas** são limpas automaticamente em cada criação de sessão.
- **CSP** definida em `index.html` e no `.htaccess` (precisa `unsafe-eval` por causa do Tailwind via JS — remova ao pré-compilar).
- **Nada é escrito no DocumentRoot.** Apache só lê os arquivos do repo; tudo que precisa ser writable vai pro `/tmp`.

### O que NÃO está implementado (decisão consciente)

- Rate limiting (no nível do app)
- HTTPS forçado por código (responsabilidade do servidor)
- Bloqueio por IP / WAF (fica no nível do servidor)
- Tailwind pré-compilado (usa o bundle JS pesado por enquanto)

### Deploy

#### Red Hat / RHEL / Rocky / Alma (Apache + PHP já instalados)

Três comandos. Sem editar nada além do que é estritamente necessário:

```bash
sudo git clone https://github.com/antigerme/wazeplaces.git /var/www/html/wazeplaces
sudo restorecon -R /var/www/html/wazeplaces
sudo setsebool -P httpd_can_network_connect 1
```

Acesse `http://servidor/wazeplaces/`. Pronto.

**Por que cada comando:**
- `restorecon` — aplica o contexto SELinux correto (`httpd_sys_content_t`) nos arquivos recém-clonados
- `setsebool httpd_can_network_connect` — libera Apache pra fazer cURL pro `waze.com` (necessário; sem isso o backend retorna erro de conexão)

**Não é necessário:**
- Mexer em permissões — Apache só precisa **ler** os arquivos (escritas vão pro `/tmp` isolado por PrivateTmp do systemd)
- Renomear `.htaccess` — já vem ativo no repo
- Habilitar módulos Apache — `mod_rewrite`, `mod_headers`, `mod_deflate`, `mod_expires` já vêm habilitados no RHEL padrão
- `AllowOverride All` — a app funciona com `AllowOverride None` (default RHEL); só perde otimizações de cache e headers extras do `.htaccess`

**Atualizar depois:**
```bash
cd /var/www/html/wazeplaces && sudo git pull && sudo restorecon -R .
```

#### Outras distros / Nginx

- Debian/Ubuntu: `chown -R www-data:www-data /var/www/html/wazeplaces` e pronto (sem SELinux)
- Nginx: roteamento padrão (servir estáticos + `*.php` via PHP-FPM); replique os headers do `.htaccess` na config do server block

#### HTTPS (recomendado para PWA instalar)

```bash
sudo certbot --apache -d seudominio.com
```

#### Atrás de Cloudflare (ou outro CDN/proxy reescritor)

Se você for usar Cloudflare na frente da app, **desabilite** essas features no painel da CF — elas reescrevem o HTML/JS e quebram a app:

| Feature | Onde fica | Por quê desabilitar |
|---|---|---|
| **Rocket Loader** | Speed → Optimization → Content Optimization | Carrega scripts em modo async e quebra a ordem `api.js → app.js` (`API is not defined`) |
| **Auto Minify** (JS) | Speed → Optimization → Content Optimization | Pode estragar templates do Tailwind e comentários funcionais |
| **Mirage** / **Polish** | Speed → Optimization → Image Optimization | Mexem em imagens de places (URLs já são CDN do Waze, não precisa) |
| **Email Obfuscation** | Scrape Shield | Insere `<script>` injetado no HTML, pode bagunçar layout |
| **Web Analytics** beacon | Analytics → Web Analytics | Insere `<script defer>` em `cloudflareinsights.com`. Não quebra a app desde a v2.6.1, mas é um request a mais |
| **Script Monitor** (Page Shield) | Security → Page Shield | Adiciona header `content-security-policy-report-only` com `connect-src 'none'` e enche o console de avisos (não bloqueia, só ruído) |

Funções da CF que **vale a pena manter**:
- **Caching** (estáticos)
- **TLS / HTTPS**
- **WAF / Bot Fight Mode** (com cuidado — `Bot Fight Mode` muito agressivo pode fazer challenge para o próprio editor)
- **Brotli/Gzip compression**

A app já tem defesa contra parte desses casos:
- O service worker (v6+) **ignora requests cross-origin** (não intercepta beacon do CF, etc)
- O service worker **não usa mais `index.html` como fallback para JS** (evitava o caso clássico em que um `api.js` falho era servido como HTML, causando `API is not defined`)
- O `.htaccess` desabilita `mod_pagespeed` (que também reescreve JS no Apache do RHEL)

Se mesmo assim aparecer `Uncaught ReferenceError: API is not defined`, abra o DevTools → Application → Service Workers → Unregister e Application → Storage → Clear site data, depois recarregue (Ctrl+Shift+R).

### Desenvolvendo

Os scripts `start.sh` e `start.bat` configuram `PHP_CLI_SERVER_WORKERS=4` por padrão e chamam `php -S 0.0.0.0:8080`. Esse flag é **essencial** — sem ele o servidor builtin do PHP atende uma request por vez, e cada cURL ao Waze leva 1-2s, bloqueando todas as outras requisições e fazendo a app parecer travada.

Os scripts respeitam variáveis de ambiente caso você queira customizar:

```bash
PHP_CLI_SERVER_WORKERS=8 PORT=9000 HOST=127.0.0.1 ./start.sh
```

| Variável                  | Padrão      | O que faz                                                  |
|---------------------------|-------------|------------------------------------------------------------|
| `PHP_CLI_SERVER_WORKERS`  | `4`         | Workers paralelos do `php -S` (requer PHP 7.4+)            |
| `PORT`                    | `8080`      | Porta de escuta                                            |
| `HOST`                    | `0.0.0.0`   | Host bind (use `127.0.0.1` para restringir ao localhost)   |

Se preferir rodar manualmente sem os scripts:

```bash
PHP_CLI_SERVER_WORKERS=4 php -S 0.0.0.0:8080
```

Validação rápida de sintaxe antes de commitar:
```bash
# JS
for f in js/*.js; do node --check "$f"; done

# PHP
for f in api/*.php; do php -l "$f"; done
```

### Service Worker

- **Versão atual:** `waze-places-v3`
- **Estratégia HTML:** network-first (sempre tenta buscar versão nova, cai pro cache se offline)
- **Estratégia assets:** cache-first (rápido, atualiza em background)
- **Auto-update:** detecta nova versão e força reload automático via `controllerchange`
- **Pra invalidar caches:** incremente `CACHE_NAME` em `service-worker.js`

### Contribuindo

PRs são bem-vindos. Fluxo:

1. Fork → branch a partir de `main`
2. Faça as mudanças, valide com `php -l` e `node --check`
3. Teste manualmente com `php -S` antes de commitar
4. PR com descrição do **porquê** (não só o quê)

---

## ⚠️ Avisos

1. **Não compartilhe seu `cookies.txt`** — ele contém suas credenciais de login do Waze
2. **Esta aplicação NÃO é oficial do Waze** — é uma ferramenta da comunidade
3. **Respeite as diretrizes do Waze** — não rejeite em massa sem analisar cada pedido

---

**Desenvolvido para a comunidade Waze Brasil** 🇧🇷
