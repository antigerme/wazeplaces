# Changelog

Mudanças relevantes do **Waze Places**, das mais recentes pras mais antigas.

A versão que a app mostra no rodapé é um **serial de zona DNS** (`YYYYMMDDnn` → exibido como `v2026.07.24-01`): data da build + revisão do dia. Ela cresce sempre e diz *de quando* é o código que está rodando no seu celular. Fonte única: `js/version.js`.

Formato inspirado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

---

## v2026.07.24-02

### Adicionado
- **Contador "de N na região"** abaixo de *Restam*: aparece quando existem pedidos na sua região que você **não tem permissão de editar**. Eles nunca entraram na fila (a app não mostra card que você não consegue tratar), mas até agora sumiam sem explicação — a diferença pro número do WME parecia um bug. Passe o mouse/toque pra ver quantos são.
- **Atalhos na PWA**: segurando o ícone da app aparecem *Filtros* e *Atualizar*, que abrem direto na ação.
- **Screenshots no instalador**: a tela de instalação da PWA agora mostra prévias da app.

### Alterado
- **Tailwind pré-compilado**: o CSS deixou de ser gerado no seu navegador a cada carregamento. São **407 KB a menos** pra baixar e nada de compilar no celular. Como efeito colateral de segurança, a política de conteúdo (CSP) não precisa mais liberar `unsafe-eval`.
- **Fonte Inter auto-hospedada**: a app não busca mais nada no Google Fonts — carrega mais rápido, funciona offline de verdade e para de vazar sua visita pra um terceiro.

### Interno
- Dark mode migrado dos overrides globais com `!important` para variantes `dark:` por elemento. Refactor puro, validado por comparação de captura de tela pixel a pixel (light e dark, incluindo estados de *hover*): **nenhuma mudança visual**.

## v2026.07.24-01

### Corrigido
- **Places que voltavam mesmo depois de marcados como lidos** (Batalhão PMDF, Padaria do Moinho, Praia de Tarituba e outros). O filtro de "não lidos" do Waze é por *local*, não por *pedido*: bastava um pedido irmão invisível na app (ex.: alteração de categoria) pra o local inteiro voltar, e a app re-emitia a foto **já lida** como card novo. Agora pedido já lido nunca vira card de novo.

### Alterado
- Modal **Filtros e Preferências** reorganizado em 3 abas (*Filtros* · *Preferências* · *Histórico*), com rodapé contextual. Preferências (idioma, desfazer, modo dev) passam a valer **na hora** — antes, trocar o botão e fechar no X perdia a mudança em silêncio.
- Janela de **desfazer** reduzida de 5s para 3s: o swipe rápido voltou a fluir sem perder a rede de segurança.

## v2026.07.18-02

### Adicionado
- **Três idiomas: português, inglês e espanhol**, com seletor no modal de filtros (detecta o idioma do navegador na primeira visita).
- **Filtro por categoria** e **ordenação** (mais recentes / mais antigos primeiro — útil pra atacar backlog histórico).
- **Histórico acumulado** de ações (hoje / semana / mês / total).

### Acessibilidade
- Título principal vira texto de leitor de tela ao logar, botão de tema anuncia seu estado, modal de colar cookies rola quando o conteúdo é grande.

## v2026.07.18-01

### Adicionado
- **Licença GPL-3.0** e **CI no GitHub Actions** (checagem de sintaxe, testes e trava do bump de versão).
- Suíte de testes sem dependências (`node --test`) cobrindo criptografia/sessão, categorização de erro do Waze e filtro de cookies.
- **Versionamento por serial de zona DNS**, visível no rodapé.

### Corrigido
- Auditoria completa do projeto: 60 correções de P0 a P3 (segurança, corrida de estado, acessibilidade, PWA).

## v3.0 — Backend em JavaScript

### Alterado
- Backend migrado de **PHP + Apache** para **JavaScript puro** rodando em Cloudflare Workers (com adaptador Node para VM). Mesma lógica nos dois ambientes, zero dependências, sem build.
- Sessões com **AES-256-GCM**; cookies do Waze nunca mais trafegam depois do login.

### Corrigido
- **Login falhando com HTTP 400**: a app mandava *todos* os cookies do navegador (~30 KB, 41 domínios) pro Waze. Agora só os de `waze.com` — corrige o login e para de vazar credenciais de terceiros.

## Versões anteriores (2.x)

- Overhaul de interface com as réguas Material 3 e Human Interface Guidelines.
- **Modo Desenvolvedor** (7 toques na versão do rodapé).
- **Gate de experiência** no botão "Permitir desfazer ações": editores novatos não conseguem desligá-lo antes de pegar ritmo.
- Um card por **pedido**, não por local — fim da primeira encarnação do bug "place volta".
- Carrossel completo nas fotos, com a foto nova destacada.
- Correção de "F5 não atualiza no celular": alinhamento das três camadas de cache (service worker, cache do navegador e servidor).
- Categorização de corrida entre editores: quando outro editor trata o mesmo pedido antes, a app mostra "já tratado por outro editor 👍" em vez de erro.
