# Waze Places - Limpeza de Pedidos (PWA)

PWA para editores do Waze Map Editor limparem rapidamente os pedidos de places enviados por usuários — fotos lixo, nomes ruins, endereços errados, categorias absurdas. Interface estilo Tinder: arraste pra rejeitar (lixo) ou marque como lido (decide depois no WME).

> **A aplicação nunca aprova places.** Aprovação exige ajuste no mapa e precisa ser feita pelo WME oficial. Aqui você só rejeita ou marca como lido, eliminando o lixo antes que outro editor novato aprove besteira.

## 🚀 Características

- Interface estilo Tinder (swipe esquerda/direita/cima)
- 100% em português
- PWA instalável no dispositivo (sem precisar de Play Store / App Store)
- Funciona offline (cache de assets) com network-first para HTML
- Backend PHP com sessão criptografada (cookies não trafegam após login)
- Proxy transparente para APIs do Waze
- Multi-região (ROW, NA, IL, World) e país configurável
- Modo escuro
- Filtros por tipo de pedido (Local Novo, Foto, Atualização) e residencial
- Diff "antes/depois" para pedidos de atualização
- Galeria de imagens (não apenas a primeira)
- Link direto pro WME no card
- Botão "Pular" (apenas avança, não chama API)
- Undo de 3s — desfaça antes da requisição ir
- Stats persistidas (read / rejected / skipped)
- Atalhos: ← Rejeitar, → Lido, ↑ Pular

## 📋 Requisitos

### Servidor
- Apache 2.4+ (ou Nginx)
- PHP 7.4+ com extensões: cURL, JSON, OpenSSL
- mod_rewrite habilitado (Apache)
- HTTPS (necessário pra instalação PWA real)

### Cliente
- Navegador moderno (Chrome, Firefox, Edge, Safari)
- Conta ativa no Waze Map Editor
- Extensão de exportação de cookies

## 🔧 Instalação

1. Faça upload de todos os arquivos pro servidor.
2. Garanta que `api/` é gravável (pra criar `.encryption-key` e `/tmp/waze_places_sessions/`).
3. Renomeie `.htaccess.todo` pra `.htaccess` (se Apache) — aplica headers de segurança e cache.
4. Habilite HTTPS via Certbot ou similar.
5. Acesse pela URL e instale como PWA pelo menu do navegador.

### Permissões mínimas

```bash
chmod 755 api/
# api/.encryption-key será criado automaticamente em 0600 no 1º uso
```

## 🍪 Como Obter o cookies.txt

### Chrome / Edge / Brave
Instale a extensão **"Get cookies.txt LOCALLY"**, acesse `https://www.waze.com/editor`, faça login, clique no ícone da extensão e exporte.

### Firefox
Instale **"cookies.txt"** ([addons.mozilla.org](https://addons.mozilla.org/firefox/addon/cookies-txt/)), faça login no WME, exporte.

**Importante:** o cookie `_csrf_token` é obrigatório. Sem ele a app rejeita o arquivo.

## 📱 Como Usar

1. Selecione **Região** (Brasil = ROW) e **País** (Brasil = 30) na tela inicial.
2. Faça upload ou cole o conteúdo do `cookies.txt`.
3. O servidor valida, cria uma sessão criptografada (2h de validade) e retorna apenas um token de sessão pro seu dispositivo.
4. Processe os cards:
   - **← / Arrastar esquerda / Rejeitar**: marca como lixo (não aprovado)
   - **→ / Arrastar direita / Lido**: marca como lido (você decide no WME depois)
   - **↑ / Arrastar pra cima / Pular**: só avança, não chama API
   - **Ícone ↗ no card**: abre o local diretamente no WME pra ajustar e aprovar manualmente

## 🔒 Segurança

- Cookies do Waze são **criptografados** com AES-256-CBC no servidor (chave gerada uma vez em `api/.encryption-key`)
- O cliente só guarda um **session token** opaco (válido 2h)
- Sessões expiradas são removidas automaticamente do `/tmp`
- Cookies do Waze **não trafegam** novamente após o login
- Headers de segurança (X-Frame-Options, X-Content-Type-Options, CSP) via `.htaccess`
- Arquivos temporários de cookies usados pelo cURL têm permissão `0600` e são deletados após cada chamada

### O que **não** está implementado (conscientemente)
- Rate limiting (foi pedido pra não implementar)
- HTTPS forçado por código (config do servidor)
- Bloqueio de IP / WAF (fica no nível do servidor)

## 🌍 Multi-região

A app suporta as URLs base do Waze:

| Região | Endpoint base                              | Uso típico                |
|--------|--------------------------------------------|---------------------------|
| `row`  | `www.waze.com/row-Descartes/...`           | Brasil, Europa, outros    |
| `na`   | `www.waze.com/na-Descartes/...`            | EUA, Canadá               |
| `il`   | `www.waze.com/il-Descartes/...`            | Israel                    |
| `world`| `www.waze.com/Descartes/...`               | Fallback                  |

Configure pelo seletor na tela de login ou pelo modal de filtros.

## 🐛 Solução de Problemas

### "Sessão expirada ou inválida"
Sua sessão passou de 2h ou o servidor foi reiniciado. Refaça login com cookies novos.

### "Token CSRF não encontrado"
O `cookies.txt` está incompleto. Certifique-se de estar logado no WME ao exportar.

### "Erro ao buscar places (HTTP 401/403)"
Cookies expiraram do lado do Waze. Faça login de novo no WME e re-exporte.

### Cards não aparecem
Não há pedidos pendentes pro filtro atual. Tente abrir o modal de filtros e ampliar.

## 📊 Arquitetura

```
PWA (HTML/JS/Tailwind)
  ↓ POST /api/sessao.php (cookies → token criptografado)
  ↓ POST /api/buscar-places.php (token → places normalizados)
  ↓ POST /api/marcar-lido.php (token, venueID, updateRequestID)
  ↓ POST /api/validar-place.php (token, venueID, updateRequestID)
PHP backend (stateless por request)
  ↓ cURL com cookies descriptografados
  ↓ Sempre adiciona X-CSRF-Token + headers de origem
APIs internas do Waze
  - /Issues/Search/List
  - /Issues/Read
  - /Features (rejeição)
```

## 📝 Personalização

### Tema padrão
Edite a chave `waze_places_theme` no `localStorage` ou clique no ícone de sol/lua no header.

### Filtros padrão
Os filtros são persistidos em `localStorage` (`waze_places_filters`). Reset limpando o storage.

### Cores e estilo
Edite `css/styles.css` ou as classes Tailwind nos templates de `index.html`.

## ⚠️ Avisos

1. **Não compartilhe seu `cookies.txt`** — ele contém suas credenciais
2. **Esta aplicação NÃO é oficial do Waze** — é uma ferramenta da comunidade
3. **Respeite as diretrizes do Waze** — não rejeite em massa sem analisar

---

**Desenvolvido para a comunidade Waze Brasil** 🇧🇷
