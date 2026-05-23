# PWA Waze Map Editor - Validação Estilo Tinder

## Estrutura do Projeto

### Frontend (PWA)
1. **index.html** - Página principal da aplicação
2. **manifest.json** - Configuração PWA (ícones, nome, tema)
3. **service-worker.js** - Cache offline e instalação
4. **css/styles.css** - Estilos da aplicação (Tailwind CDN + custom)
5. **js/app.js** - Lógica principal da aplicação
6. **js/swipe.js** - Gerenciamento de gestos de arrastar
7. **js/api.js** - Comunicação com backend PHP

### Backend PHP (Stateless)
8. **api/config.php** - Configurações e constantes
9. **api/buscar-places.php** - Endpoint para buscar places pendentes
10. **api/validar-place.php** - Endpoint para aprovar/rejeitar place
11. **api/testar-cookies.php** - Endpoint para validar cookies do usuário
12. **.htaccess** - Configuração Apache (CORS, rewrite)

### Documentação
13. **README.md** - Instruções completas de instalação e uso
14. **COOKIES-GUIDE.md** - Como extrair cookies.txt do navegador

## Fluxo da Aplicação

1. Usuário acessa a PWA
2. Sistema solicita upload/cola do cookies.txt
3. Cookies são validados via backend PHP
4. Backend busca places pendentes da API do Waze
5. Interface mostra cards com informações do place
6. Usuário arrasta: direita = aprovar, esquerda = rejeitar
7. Backend envia ação para API do Waze
8. Próximo place é carregado automaticamente

## APIs do Waze (baseadas no script bash)

### Buscar Places Pendentes
- **Endpoint**: `https://www.waze.com/row-Descartes/app/v1/Issues/Search/List`
- **Método**: POST
- **Headers**: Content-Type: application/json, X-CSRF-Token
- **Body**: JSON com filtros (countryId: 30 para Brasil)

### Validar Place (Aprovar/Rejeitar)
- **Endpoint**: `https://www.waze.com/row-Descartes/app/Features?language=pt-BR&bbox=0%2C0%2C0%2C0`
- **Método**: POST
- **Headers**: Content-Type: application/json, X-CSRF-Token
- **Body**: CompositeAction com approve: true/false

### Autenticação
- Cookies necessários: csrf_token (extraído do arquivo cookies.txt)
- Formato Netscape: domínio, flag, path, secure, expiration, name, value

## Funcionalidades Implementadas

- ✅ Upload de cookies.txt ou colar conteúdo
- ✅ Validação de formato de cookies
- ✅ Armazenamento seguro no sessionStorage
- ✅ Interface de cards estilo Tinder
- ✅ Gestos de swipe (arrastar)
- ✅ Animações suaves
- ✅ Contador de validações
- ✅ Feedback visual (aprovado/rejeitado)
- ✅ Modo offline básico
- ✅ Instalável como app
- ✅ Backend PHP stateless (sem armazenamento)
- ✅ Proxy transparente para APIs do Waze
- ✅ Tratamento de erros
- ✅ Tudo em português

## Segurança

- HTTPS obrigatório
- Cookies armazenados apenas no cliente
- Backend não persiste dados
- Arquivos temporários deletados imediatamente
- Sanitização de inputs
- Headers de segurança (CORS, CSP)
- Validação de tokens CSRF