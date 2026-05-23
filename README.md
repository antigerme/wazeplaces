# Waze Places - Validação PWA

Aplicação PWA (Progressive Web App) para validação de places do Waze Map Editor com interface estilo Tinder. Arraste para aprovar ou rejeitar places pendentes de forma rápida e intuitiva.

## 🚀 Características

- ✅ Interface estilo Tinder (swipe left/right)
- ✅ 100% em português
- ✅ PWA instalável no dispositivo
- ✅ Funciona offline (cache de assets)
- ✅ Backend PHP stateless (sem armazenamento de dados)
- ✅ Proxy transparente para APIs do Waze
- ✅ Autenticação via cookies.txt
- ✅ Responsivo (mobile e desktop)
- ✅ Animações suaves
- ✅ Contador de validações

## 📋 Requisitos

### Servidor
- Apache 2.4+
- PHP 7.4+ com extensões:
  - cURL
  - JSON
  - OpenSSL
- mod_rewrite habilitado
- mod_headers habilitado (opcional, mas recomendado)

### Cliente
- Navegador moderno (Chrome, Firefox, Edge, Safari)
- Conta ativa no Waze Map Editor
- Extensão para exportar cookies (ver seção abaixo)

## 🔧 Instalação

### 1. Upload dos Arquivos

Faça upload de todos os arquivos para o diretório do seu servidor Apache:

```
/var/www/html/waze-places/
├── index.html
├── manifest.json
├── service-worker.js
├── .htaccess
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── api.js
│   └── swipe.js
└── api/
    ├── config.php
    ├── testar-cookies.php
    ├── buscar-places.php
    └── validar-place.php
```

### 2. Configurar Permissões

```bash
# Permissões dos diretórios
chmod 755 /var/www/html/waze-places
chmod 755 /var/www/html/waze-places/api
chmod 755 /var/www/html/waze-places/css
chmod 755 /var/www/html/waze-places/js

# Permissões dos arquivos
chmod 644 /var/www/html/waze-places/*.html
chmod 644 /var/www/html/waze-places/*.json
chmod 644 /var/www/html/waze-places/*.js
chmod 644 /var/www/html/waze-places/css/*
chmod 644 /var/www/html/waze-places/js/*
chmod 644 /var/www/html/waze-places/api/*.php
chmod 644 /var/www/html/waze-places/.htaccess
```

### 3. Verificar Módulos Apache

```bash
# Habilitar mod_rewrite
sudo a2enmod rewrite

# Habilitar mod_headers (opcional)
sudo a2enmod headers

# Reiniciar Apache
sudo systemctl restart apache2
```

### 4. Configurar Virtual Host (Opcional)

Se desejar usar um domínio/subdomínio específico:

```apache
<VirtualHost *:80>
    ServerName waze-places.seudominio.com
    DocumentRoot /var/www/html/waze-places
    
    <Directory /var/www/html/waze-places>
        AllowOverride All
        Require all granted
    </Directory>
    
    ErrorLog ${APACHE_LOG_DIR}/waze-places-error.log
    CustomLog ${APACHE_LOG_DIR}/waze-places-access.log combined
</VirtualHost>
```

### 5. SSL/HTTPS (Altamente Recomendado)

Para usar HTTPS (necessário para algumas funcionalidades PWA):

```bash
# Usando Certbot (Let's Encrypt)
sudo apt install certbot python3-certbot-apache
sudo certbot --apache -d waze-places.seudominio.com
```

## 🍪 Como Obter o Arquivo cookies.txt

### Chrome / Edge / Brave

1. Instale a extensão **"Get cookies.txt LOCALLY"**
   - Link: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/
   
2. Acesse https://www.waze.com/editor e faça login

3. Clique no ícone da extensão

4. Clique em "Export" ou "Download"

5. Salve o arquivo `cookies.txt`

### Firefox

1. Instale a extensão **"cookies.txt"**
   - Link: https://addons.mozilla.org/firefox/addon/cookies-txt/
   
2. Acesse https://www.waze.com/editor e faça login

3. Clique no ícone da extensão

4. Clique em "Export cookies.txt"

5. Salve o arquivo

### Formato Esperado

O arquivo deve estar no formato Netscape:

```
# Netscape HTTP Cookie File
.waze.com	TRUE	/	FALSE	1234567890	cookie_name	cookie_value
.waze.com	TRUE	/	TRUE	1234567890	csrf_token	abc123xyz
```

**Importante:** O cookie `csrf_token` é obrigatório!

## 📱 Como Usar

### 1. Acesse a Aplicação

Abra o navegador e acesse:
- `http://localhost/waze-places/` (desenvolvimento local)
- `https://waze-places.seudominio.com/` (produção)

### 2. Forneça os Cookies

Na tela inicial, você tem duas opções:

**Opção A: Upload do Arquivo**
1. Clique em "Fazer Upload do cookies.txt"
2. Selecione o arquivo exportado
3. Aguarde a validação

**Opção B: Colar Conteúdo**
1. Clique em "Colar Conteúdo dos Cookies"
2. Abra o arquivo cookies.txt em um editor de texto
3. Copie todo o conteúdo (Ctrl+A, Ctrl+C)
4. Cole no campo de texto
5. Clique em "Confirmar"

### 3. Validar Places

Após autenticação bem-sucedida:

- **Arrastar para direita** ou clicar em **✅ Aprovar**: Aprova o place
- **Arrastar para esquerda** ou clicar em **❌ Rejeitar**: Rejeita o place
- Os cards são carregados automaticamente
- Estatísticas são atualizadas em tempo real

### 4. Instalar como App (Opcional)

No Chrome/Edge:
1. Clique nos 3 pontos (menu)
2. Selecione "Instalar Waze Places"
3. Confirme a instalação

No Firefox:
1. Clique no ícone de "+" na barra de endereços
2. Selecione "Instalar"

## 🔒 Segurança

### Dados do Usuário

- ✅ Cookies armazenados **apenas no navegador** (sessionStorage)
- ✅ Nenhum dado persistido no servidor
- ✅ Arquivos temporários deletados imediatamente após uso
- ✅ Permissões restritas (0600) em arquivos temporários
- ✅ Comunicação via HTTPS (recomendado)

### Headers de Segurança

A aplicação implementa:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Content-Security-Policy` (configurável)
- CORS restrito

### Boas Práticas

1. **Use HTTPS em produção**
2. **Mantenha PHP atualizado**
3. **Configure firewall adequadamente**
4. **Monitore logs do Apache**
5. **Renove cookies periodicamente**

## 🐛 Solução de Problemas

### Erro: "Cookies inválidos"

**Causa:** Cookies expirados ou formato incorreto

**Solução:**
1. Faça logout do Waze Map Editor
2. Faça login novamente
3. Exporte novos cookies
4. Tente novamente na aplicação

### Erro: "Token CSRF não encontrado"

**Causa:** Arquivo cookies.txt incompleto

**Solução:**
1. Certifique-se de estar logado no WME
2. Use uma extensão confiável para exportar
3. Verifique se o arquivo contém a linha com `csrf_token`

### Erro: "Erro ao buscar places"

**Causa:** Problema de conexão ou cookies expirados

**Solução:**
1. Verifique sua conexão com a internet
2. Renove os cookies
3. Verifique os logs do PHP: `/var/log/apache2/error.log`

### Cards não carregam

**Causa:** Pode não haver places pendentes

**Solução:**
1. Clique em "Recarregar"
2. Verifique se há places pendentes no WME
3. Tente mudar o país/região nas configurações (editar `api/buscar-places.php`, linha `countryId`)

### Gestos de swipe não funcionam

**Causa:** JavaScript desabilitado ou navegador incompatível

**Solução:**
1. Habilite JavaScript no navegador
2. Use um navegador moderno (Chrome, Firefox, Edge, Safari)
3. Limpe o cache do navegador

## 📊 Logs e Monitoramento

### Logs do Apache

```bash
# Erros
tail -f /var/log/apache2/error.log

# Acessos
tail -f /var/log/apache2/access.log
```

### Logs do PHP

Edite `api/config.php` para habilitar debug (apenas em desenvolvimento):

```php
// No topo do arquivo, adicione:
ini_set('display_errors', 1);
error_reporting(E_ALL);
```

**⚠️ NUNCA deixe isso habilitado em produção!**

## 🔄 Atualizações

Para atualizar a aplicação:

1. Faça backup dos arquivos atuais
2. Substitua pelos novos arquivos
3. Limpe o cache do navegador (Ctrl+Shift+Delete)
4. Recarregue a página (Ctrl+F5)

## 📝 Personalização

### Alterar País/Região

Edite `api/buscar-places.php` e `api/testar-cookies.php`:

```php
'countryId' => 30, // 30 = Brasil, altere conforme necessário
```

### Ajustar Filtros

Em `api/buscar-places.php`, você pode adicionar filtros adicionais:

```php
'venueUpdateRequestsFilter' => [
    'categories' => ['GAS_STATION', 'RESTAURANT'], // Filtrar por categoria
    'lockRanks' => [0, 1, 2], // Apenas ranks específicos
    'residential' => false, // Excluir residenciais
    // ... outros filtros
]
```

### Modificar Cores/Tema

Edite `css/styles.css` ou as classes Tailwind em `index.html`.

## 🤝 Suporte

Para problemas ou dúvidas:

1. Verifique a seção "Solução de Problemas"
2. Consulte os logs do servidor
3. Verifique a documentação do Waze Map Editor
4. Entre em contato com a comunidade Waze Brasil

## 📄 Licença

Este projeto é fornecido "como está", sem garantias. Use por sua conta e risco.

## ⚠️ Avisos Importantes

1. **Não compartilhe seu arquivo cookies.txt** - ele contém suas credenciais de acesso
2. **Renove os cookies regularmente** - eles expiram após algum tempo
3. **Use HTTPS em produção** - proteja seus dados
4. **Esta aplicação NÃO é oficial do Waze** - é uma ferramenta da comunidade
5. **Respeite as diretrizes do Waze** - valide apenas places legítimos

## 🎯 Roadmap

Funcionalidades futuras planejadas:

- [ ] Filtros avançados de places
- [ ] Histórico de validações
- [ ] Estatísticas detalhadas
- [ ] Modo escuro
- [ ] Suporte a múltiplos países
- [ ] Notificações push
- [ ] Exportar relatórios

---

**Desenvolvido para a comunidade Waze Brasil** 🇧🇷