# Changelog

Mudanças relevantes do **Waze Places**, das mais recentes pras mais antigas.

A versão que a app mostra no rodapé é um **serial de zona DNS** (`YYYYMMDDnn` → exibido como `v2026.07.24-01`): data da build + revisão do dia. Ela cresce sempre e diz *de quando* é o código que está rodando no seu celular. Fonte única: `js/version.js`.

Formato inspirado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

---

## v2026.07.27-08

### Alterado
- **Quem não fala português, inglês ou espanhol agora vê a app em inglês** (antes via em português). A mudança não afeta ninguém que já era atendido — brasileiro, americano e hispano-falante continuam vindo da detecção do navegador. Ela vale só para o resto: francês, alemão, italiano, japonês, russo, holandês, chinês.

### Adicionado
- **Dá pra trocar o idioma sem estar logado.** O seletor existia só em Filtros → Preferências, e o botão de Filtros só aparece depois de entrar — ou seja, quem caísse num idioma que não lê precisaria fazer login lendo instruções que não entende. Agora há um seletor também no menu de Ajuda (ⓘ), que fica visível o tempo todo. Os dois ficam em sincronia.

## v2026.07.27-07

### Alterado
- **Passamos a app inteira pela régua de acessibilidade (Material Design 3 + Apple HIG)** e ajustamos tudo que não passava, em 5 aparelhos × 13 telas × claro/escuro × pt/en/es:
  - **Botões coloridos ficaram legíveis.** "Aplicar", "Entrar", "Confirmar" e os botões da tela de entrada tinham texto branco sobre um azul claro demais — a leitura ficava fraca especialmente no sol. Agora o fundo é mais fundo no tema claro e, no escuro, o botão fica claro com texto escuro.
  - **Nenhum texto abaixo de 11px**, e todos os tamanhos passaram a acompanhar a preferência de tamanho de fonte do seu celular (antes alguns ficavam fixos e ignoravam esse ajuste).
  - **Mais respiro entre os botões do topo**, pra diminuir toque errado.

### Corrigido
- **O botão "Entrar com um código" estava com o texto na cor errada** no celular — devia ser branco sobre o fundo colorido e vinha escuro. Pelo mesmo motivo, o botão de upload continuava colorido quando já devia ser discreto.
- **"Conectar outro aparelho" estava espremido ao lado do X** no menu de Ajuda, ocupando um terço da largura. Agora ocupa a linha inteira, logo abaixo do título.

## v2026.07.27-06

### Corrigido
- **O teclado cobria o campo em "Entrar com um código".** Ao tocar no campo, o teclado subia por cima do diálogo e escondia o código e os botões, sem nada indicando o que fazer. Agora o diálogo sobe junto com o teclado e, se ainda assim faltar espaço, rola por dentro.
- **A extensão do Chrome não aparece mais no celular.** Ela só instala no computador, mas vinha em destaque na tela de entrada do telefone — e ainda marcada como "recomendado", mandando justamente pro caminho que não funciona ali. No celular a primeira opção passa a ser "Entrar com um código", que é a feita pra isso. No computador nada muda.
- **A barra "Instalar" do navegador parou de ficar grudada no rodapé.** Ela cobria parte da tela o tempo todo, inclusive por cima dos diálogos. Agora instalar o aplicativo é um botão dentro do menu de Ajuda (ⓘ), que aparece só quando dá pra instalar — você escolhe a hora.

## v2026.07.27-05

### Alterado
- **A versão saiu do rodapé e foi pro fim do menu de Ajuda (ⓘ).** O rodapé fixo custava 40px de rolagem em toda tela e não deixava o card nem um pixel maior. Num iPhone 14 Pro esses 40px eram **65% de toda a rolagem da página** — agora a app praticamente não rola, e rolar deixa de disputar com o gesto de "pular". O ⓘ está no topo mesmo sem estar logado, então continua fácil dizer que versão você está usando.

### Corrigido
- **O Modo Desenvolvedor era impossível de desbloquear.** Os 7 toques na versão nunca chegavam ao fim: o aviso "faltam 3 toques" aparecia por cima da própria versão e passava a receber os toques no lugar dela — em qualquer aparelho, desde sempre. Agora o aviso aparece **ao lado** da versão.
- **O placar 2×2 ficou mais compacto** em telas bem estreitas (abaixo de 360px), devolvendo parte da altura que a segunda fileira custou.

## v2026.07.27-04

### Corrigido
- **Os rótulos do placar (Lidos · Rejeitados · Pulados · Restam) se encostavam em celular estreito.** Em telas de até 375px "Rejeitados" invadia "Pulados" — e em espanhol, onde a palavra é "Rechazados", isso acontecia em quase todo celular. Agora o rótulo é um pouco menor no telefone e, abaixo de 360px, o placar se organiza em **2×2** em vez de 4 colunas espremidas. Nada foi encurtado nem abreviado.

## v2026.07.27-03

### Alterado
- **A tela de entrada agora se adapta ao aparelho.** No celular, "Entrar com um código" passa a ser a **primeira** opção e com destaque — antes vinha por último, depois de duas opções que praticamente não funcionam em telefone (subir arquivo e colar cookies). No computador, a ordem continua a de sempre. Nada foi escondido: todas as opções seguem disponíveis nos dois, só mudou a ordem.
- **Os textos não falam mais em "celular" e "computador"** onde isso confundia. Virou **"Conectar outro aparelho"** e **"Entrar com um código"** — antes o celular mostrava "Usar no celular" e o computador mostrava "tenho um código do computador", cada um oferecendo justamente o que não fazia sentido ali.
- **"Conectar outro aparelho" saiu do fundo do menu de Ajuda** e agora aparece logo no topo, sem precisar rolar.

## v2026.07.27-02

### Adicionado
- **Dá pra entrar no celular sem copiar cookies.** Copiar cookies num telefone é quase impossível — agora você entra **uma vez no computador** e traz a sessão pro celular com um código de 6 caracteres:
  1. No computador: menu de ajuda → **"Usar no celular"**
  2. No celular: **"Tenho um código do computador"** e digite

  Ou toque em **copiar link** e mande pra você mesmo: abrindo no celular, entra direto, sem digitar nada. O código vale **5 minutos** e serve **uma única vez**; a sessão do computador continua funcionando normalmente. Depois disso, o celular tem os mesmos 21 dias de validade de sempre.

### Corrigido
- **Diálogos apareciam pela metade durante o carregamento.** Abrir Filtros (ou qualquer outro diálogo) enquanto a fila estava buscando fazia a silhueta de carregamento cobrir o meio da janela. Oito diálogos afetados.

## v2026.07.27-01

### Alterado
- **Ficou bem mais fácil liberar o "Permitir desfazer ações".** A cota caiu de 3000 pedidos para **300**, dividida pelo seu nível de editor:

  | Nível | Pedidos |
  |---|---|
  | L1 | 300 |
  | L2 | 150 |
  | L3 | 100 |
  | L4 | 75 |
  | L5 | 60 |
  | L6 | 50 |
  | Staff | isento |

  A regra antiga pedia cerca de **100 minutos de swipe contínuo** para um L1 — na prática ninguém chegava lá, e o que deveria ser um degrau virou um muro. Só contam **Lidos e Rejeitados** (pular não conta, porque não treina o cuidado com ação que altera o mapa).

### Adicionado
- **Aviso quando você desbloqueia.** Antes o desbloqueio era invisível: você cruzava a cota e nada acontecia — só descobriria por acaso, abrindo os filtros. Agora cai confete sobre a fila e aparece um aviso dourado; **tocar nele leva direto ao interruptor**, já com a linha destacada, em vez de mandar você procurar.
- O aviso toca **uma vez só**. E quem já estava acima da cota antes desta versão não recebe parabéns por trabalho anterior — a comemoração é para quem cruzar daqui em diante.

## v2026.07.26-01

### Adicionado
- **Selos de gesto no card.** Arrastando, aparece um carimbo dizendo o que vai acontecer: **✕ Rejeitar**, **✓ Lido** ou **↑ Pular**, na cor do gesto e crescendo conforme você se compromete. O "Pular" (arrastar pra cima) era o único gesto **sem nenhum retorno visual** — agora tem. Os botões e o teclado também acendem o selo, então o mesmo gesto dá o mesmo retorno por qualquer caminho.
- **Mola na entrada do card.** O próximo pedido sobe com um leve pulo, em vez de simplesmente aparecer.
- **Números que reagem.** O contador dá um pulinho quando muda (é o que se vê num +1) e conta subindo quando o salto é grande (a fila carregando de 0 a 191).
- **Comemoração no "Tudo limpo!"** — confete quando você zera a fila. Só toca se você de fato tratou algo na sessão: abrir a app numa fila já vazia não é conquista.

### Corrigido
- **O card não voltava mais pro português.** Quem usava a app em inglês ou espanhol via o card inteiro (Categorias, Endereço, Tipo, Criador, botões) reverter pro português **a cada swipe**. São 25 textos no elemento mais importante da tela. Causa: o card é montado a partir de um molde que o tradutor não alcançava.

### Sobre o ritmo
- Nenhuma dessas animações entra **entre** o seu swipe e o próximo card. Todas rodam em cima de tempo que já ia ser gasto de qualquer jeito — o backlog continua sendo limpo na mesma velocidade. Quem usa o sistema com "reduzir movimento" ligado não vê animação nenhuma; os selos continuam aparecendo, porque ali é informação e não enfeite.

## v2026.07.25-01

### Corrigido
- **A data no rodapé estava errada.** As duas versões publicadas em 25/07 saíram carimbadas como `2026.07.24` — a revisão foi incrementada sem reconferir o dia. Como o número serve justamente pra dizer *de quando* é a versão que está no seu celular, ele estava mentindo. Nenhuma mudança de comportamento na app; só o carimbo corrigido.

### Sobre a versão anterior (v2026.07.24-03, publicada em 25/07)
- Liberado na política de segurança (CSP) o script de analytics que o Cloudflare injeta. Antes ele era bloqueado: sobrava um erro no console a cada carregamento e nenhuma estatística coletada.

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
