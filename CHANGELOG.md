# Changelog

Mudanças relevantes do **Waze Places**, das mais recentes pras mais antigas.

A versão que a app mostra no rodapé é um **serial de zona DNS** (`YYYYMMDDnn` → exibido como `v2026.07.24-01`): data da build + revisão do dia. Ela cresce sempre e diz *de quando* é o código que está rodando no seu celular. Fonte única: `js/version.js`.

Formato inspirado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

---

## v2026.07.29-01

### Alterado
- **Desligar o "Desfazer" fica disponível bem mais cedo.** A cota de pedidos tratados caiu para menos da metade em todos os níveis: **L6 passou de 50 para 20**, L3 de 100 para 40, L1 de 300 para 120.
- **O aviso de que o "Desfazer" virou opcional mudou de lugar e de tempo.** Passou para o **topo da tela**, logo abaixo da barra, e agora fica **8 segundos** (era 6). No rodapé ele tapava os três botões do card — medido em iPhone SE e em notebook. Continua clicável: um toque abre as Preferências direto na opção, e dispensa o aviso.

## v2026.07.28-09

### Corrigido
- **O texto esmaecido continua legível.** Ele nasceu apagado demais na versão anterior (3,79:1, abaixo do mínimo de acessibilidade) e foi corrigido — agora 5,74:1 no tema claro e 8,15:1 no escuro. A verificação automática mede isso a cada mudança, nos dois temas.

## v2026.07.28-08

### Alterado
- **Pedido sem nome agora é identificado pelo endereço.** Antes o card estampava **"sem nome"** no maior texto da tela, e a única coisa que identificava o local — o endereço — ficava em cinza pequeno logo abaixo. Estava invertido. Agora o endereço ocupa o título, e um selo **SEM NOME** ao lado registra a falta, que continua sendo informação útil para decidir. Sem nome e sem endereço, aparece *(local sem nome)*.
- **Dá para saber o que é dado e o que é a app falando.** Tudo que a app escreve no lugar de um valor ausente agora vem entre parênteses e em itálico esmaecido — *(desconhecido)*, *(sem categoria)*, *(sem endereço)*. Antes um local chamado "sem nome" era indistinguível de um local sem nome.

## v2026.07.28-07

### Alterado
- **Durante os 3 segundos do "Desfazer", o próximo pedido fica travado.** Antes dava para tratar o seguinte enquanto o anterior ainda estava na janela de arrependimento — e isso despachava o anterior sem aviso. Pior: por acidente de layout, o aviso de "Desfazer" cobria os botões em **6 dos 8 aparelhos medidos**, então o comportamento mudava conforme a tela. Agora é regra, igual em todo lugar e por todos os caminhos (botão, gesto e teclado): os três botões ficam visivelmente desabilitados e a barra do aviso mostra quanto falta.
- **Isso custa tempo, e o número é medido:** com o "Desfazer" ligado, cada pedido leva no mínimo 2,4 segundos — uma fila de 200 vira **cerca de 8 minutos** só de espera. Com o "Desfazer" desligado (Filtros → Preferências, depois da cota), o mesmo percurso leva segundos.

## v2026.07.28-06

### Segurança
- **Um script injetado não consegue mais ler a sua sessão.** A app guarda o token de sessão no navegador e a política de segurança permitia executar script escrito direto na página — juntos, isso significava que uma única brecha bastava para roubar a sessão. Os dois blocos de script que estavam dentro do HTML viraram arquivos, e a política agora recusa script inline. Medido nos dois: no que está no ar, o script injetado executou e leu o token; agora é bloqueado.
- **A tela não pisca claro para quem usa tema escuro** — conferido quadro a quadro numa carga lenta, antes e depois. E o primeiro desenho da tela continua no mesmo tempo (992ms contra 996ms, com rede e processador lentos).

## v2026.07.28-05

### Corrigido
- **Fechar a app logo depois de tratar um pedido fazia a ação se perder — com o placar dizendo que ela aconteceu.** O "Desfazer" segura a ação por 3 segundos antes de mandar pro Waze, mas o contador já era somado e salvo na hora do gesto. Quem fechava a aba (ou trocava de app) nesses 3 segundos ficava com o pedido intacto no Waze e o número errado para sempre. Medido: **nenhuma** requisição chegava ao servidor. Agora a ação é despachada ao sair, e chega.
- **O aviso de "nova versão" falava português com todo mundo.** A tradução já existia nas três línguas; a mensagem simplesmente não a usava.

### Nota para quem edita o projeto
- O `CLAUDE.md` dizia que a janela do "Desfazer" era de 5 segundos; o código sempre usou 3. Corrigido, e agora um teste compara as constantes do documento com as do código a cada mudança.

## v2026.07.28-04

### Corrigido
- **A app falava português com quem escolheu inglês ou espanhol.** No card de atualização, os nomes dos campos (`Nome`, `Telefone`, `Descrição`) e os valores especiais (`(vazio)`, `Sim`/`Não`) vinham prontos do servidor, em português, no meio de uma interface traduzida. O mesmo com os tipos de pedido: um local novo aparecia como "Novo Local" em qualquer idioma. Agora tudo isso é traduzido de verdade nas três línguas. Termo que ainda não conhecemos continua aparecendo — em inglês, nunca escondido.
- **Nenhuma mudança proposta fica mais escondida.** O card mostrava no máximo 4 e resumia o resto em "+N mais" — e essas não apareciam nem rolando. Agora a caixa lista todas; ela já rola e avisa que rola.
- **A caixa que rola agora funciona com teclado e leitor de tela.** Ela é o único caminho para ver o resto das mudanças, mas não tinha nome nem lugar na ordem do Tab: só era alcançável por um recurso recente do Chrome, que o Safari/iPhone não tem.

### Adicionado
- **Verificação automática em navegador de verdade a cada mudança.** Antes de qualquer alteração ir pro ar, o card é desenhado em 3 aparelhos × 3 idiomas × 3 tipos de pedido e medido: rolagem no lugar errado, botão pequeno demais, texto vazando, área sem nome, idioma trocado. Os testes antigos liam o código; este olha a tela.

## v2026.07.28-03

### Corrigido
- **Reportes vinham em branco.** O card de um reporte mostrava só "Reporte (Sinalização)" e quem reportou — nem o motivo, nem o que foi reportado. O WME, no mesmo pedido, mostra "Foto sinalizada" e "Motivo da marcação: Inapropriado". A app lia apenas o campo de comentário livre, que quase sempre vem vazio; o motivo mora em outro campo, que ninguém lia desde a versão em PHP.

### Adicionado
- **O card diz o motivo do reporte** — "Inapropriado" e afins — em português, inglês e espanhol. Motivo que ainda não conhecemos aparece com o nome original, nunca é escondido.
- **🚩 na foto denunciada.** Reporte de foto num local com várias fotos deixava você adivinhando qual era. Agora a foto reportada tem borda rosa, o marcador 🚩 e o carrossel já abre nela. Está na Legenda, dentro da Ajuda, ao lado do ✨ da foto nova.
- **O Tipo diz "Foto sinalizada"** quando o reporte é de uma foto, em vez do genérico "Reporte (Sinalização)".

## v2026.07.28-02

### Corrigido
- **"Mudanças propostas" mostrava linhas que ninguém propôs.** Num pedido de atualização apareciam `Id` e `UpdatedOn` junto da mudança de verdade — o WME oficial mostra só a mudança. `Id` é a identificação do local (a mesma antes e depois) e `UpdatedOn` é o carimbo de "última modificação", que muda porque a edição acontece, não porque alguém pediu. Os dois vinham porque o Waze devolve o local inteiro com os valores novos, não só o que mudou. Reportado com o caso do *Estádio Gigante do Itiberê*, em Paranaguá: a app listava 3 mudanças, o editor do Waze listava 1.
- **Isso podia esconder mudança de verdade.** O card mostra até 4 mudanças e resume o resto em "+N mais" — com duas linhas de ruído no meio, um pedido com 4 alterações reais mostrava só 2 delas.

## v2026.07.28-01

### Corrigido
- **A barra de rolagem sumiu do card — e com ela o conflito com o gesto de "pular".** O card inteiro rolava, escondendo até 423px de texto, e enquanto rolava o arraste pra cima deixava de pular: em vez de tratar o pedido, você rolava a página. Pior: isso acontecia em **25 das 32 combinações** de aparelho × tipo de pedido que medimos, ou seja, era o comportamento normal em pedidos de atualização e reportes, não a exceção. Agora só a caixa da vez rola ("Mudanças propostas" ou "Reporte do usuário"), e ela nunca rouba o gesto — em todo o resto do card, arrastar pra cima pula, sempre.
- **A caixa que rola agora avisa que rola.** A borda de baixo esmaece enquanto ainda tem coisa embaixo e volta ao normal quando chega no fim. Antes o texto era só cortado, e quem não adivinhasse não via o resto.
- **"Mudanças propostas" e "Reporte do usuário" ganharam muito mais espaço.** Tinham teto fixo (128px e 96px); agora ocupam toda a sobra do card. Num Pixel 7, o reporte passou de 96 para **~250px** — a maioria dos reportes cabe inteira sem rolar nada.

### Alterado
- **Tipo e Criador viraram uma linha cada, no mesmo desenho da linha de Marca.** Eram dois cartões que sozinhos comiam 139px — mais que a lista de mudanças inteira — para dizer duas coisas curtas.
- **O Tipo parou de repetir a lista de mudanças.** Num pedido de atualização ele mostrava "Atualização: Id, Nome, Telefone, EntryExitPoints, UpdatedOn" — os mesmos campos que a caixa logo abaixo já lista, com os valores. Agora diz só "Atualização". Quem usa leitor de tela continua ouvindo o detalhe.
- **Telas baixas (iPhone SE, Galaxy Fold, janela apertada) ficaram mais compactas** — só respiro, nenhuma informação some e nenhum botão encolhe.
- **Com o celular deitado, a foto vai para o lado do texto** em vez de ficar em cima. Empilhado, a foto sozinha comia 40% de um card de 334px e não sobrava nada para o texto.

## v2026.07.27-15

### Corrigido
- **O código e o QR de pareamento sumiam da tela só se você usasse o botão "Fechar".** Fechando com Esc ou clicando fora, eles ficavam desenhados — e o contador seguia rodando em segundo plano pelo resto da sessão. Agora qualquer forma de fechar limpa tudo: código de pareamento é credencial e não tem por que ficar na tela depois de fechado.
- **O histórico crescia para sempre**, um registro por dia, sem limite — e ele é regravado inteiro a cada pedido tratado. Agora guarda pouco mais de um ano de detalhe; o **Total continua contando tudo desde sempre**, como antes.
- **Na instalação em servidor próprio**, códigos de pareamento gerados e nunca usados ficavam 21 dias no disco em vez dos 5 minutos que valem.

## v2026.07.27-14

### Adicionado
- **QR code para entrar no celular.** No computador, "Conectar outro aparelho" agora mostra um QR: aponte a câmera do celular e pronto — sem digitar código, sem decorar caminho de menu, sem decidir como mandar o link pra você mesmo. O código de 6 caracteres continua ali embaixo para quem não tem câmera à mão.
- **A tela de entrada no celular agora diz o que é preciso.** Quem abre a app direto no telefone, sem nunca ter entrado num computador, não tinha caminho nenhum — e a app não avisava: a pessoa tentava as três opções, falhava nas três e achava que o erro era dela. Agora a primeira coisa que aparece é: *a sessão começa num computador*.

### Alterado
- **Os textos do pareamento encolheram.** Cada tela explicava o que fazer no outro aparelho, que não está na sua frente. Com o QR, quase não sobra o que explicar.

## v2026.07.27-13

### Alterado
- **O espaço entre a barra do topo e o placar diminuiu.** Era 24px de margem, mas o que o olho enxerga é a distância até o número: 35px contando o padding do cartão e a entrelinha. Agora são 19px — e o card ganhou mais 24px. Num notebook 1366×768 o card foi de 577 para **601px**; num iPhone SE a rolagem da página caiu de 58 para **34px**.

## v2026.07.27-12

### Alterado
- **O placar (Lidos · Rejeitados · Pulados · Restam) ficou mais enxuto e o card cresceu.** O produto da app é o card, e cada pixel acima dele era pixel a menos de foto. O placar foi de 87 para 67px e o espaço morto ao redor caiu junto — no total, **44px a mais de card** em toda tela. Os números continuam grandes e empilhados: o placar segue legível de relance.
  - Num notebook 1366×768, o card foi de 533 para **577px**.
  - Num iPhone SE, a rolagem da página caiu de 102 para **58px**; no celular deitado, de 177 para **133px**.

### Corrigido
- **Havia 16px de espaço vindo de elementos invisíveis.** Dois elementos usados só por leitores de tela empurravam o placar para baixo sem aparecer na tela.

## v2026.07.27-11

### Corrigido
- **Sumiu a barra de rolagem que aparecia dentro do card.** Em notebook de tela mais baixa, o bloco de texto rolava por apenas 12px enquanto a foto estava folgada — quem devia ceder era a foto. Agora ela cede primeiro, e a barra não aparece.
- **A página parou de rolar em notebook.** Num 1366×768 sobravam 82px pra fora da tela: dava barra lateral e rolagem que disputava com o gesto de pular. O card agora ocupa exatamente o espaço que sobra. No celular nada muda, nem em pé nem deitado.

## v2026.07.27-10

### Corrigido
- **A informação do CRIADOR podia ficar cortada, sem jeito de ver.** Em celular menor (iPhone SE e parecidos), a última linha do card era engolida pela borda e não havia rolagem nenhuma — nem arrastando. Agora o texto rola quando não cabe.
- **Sobrava um vão branco enorme embaixo dos dados** em pedidos curtos (um "Novo Local" sem mudanças propostas): 113px de nada num Pixel 7, quase um quinto do card.

### Alterado
- **A foto agora usa o espaço que sobra.** Ela era fixa em 208px de altura enquanto o texto ficava com toda a folga — por isso o vão. Agora é o contrário: a foto cresce quando o pedido tem pouca informação (chega a **298px, +43%**) e cede quando tem muita. Como é a foto que você olha pra decidir, o espaço vai pra onde importa. Os botões continuam exatamente no mesmo lugar em todos os cards.

## v2026.07.27-09

### Corrigido
- **O código de pareamento aparecia de um jeito e era pedido de outro.** A tela mostrava `6C4-97S` e o campo sugeria `ABC123`, sem hífen — dava pra ficar na dúvida se o traço entrava ou não. Agora o campo assume o mesmo formato: digitou 3 caracteres, o traço entra sozinho. Tanto faz digitar com ou sem ele, e colar direto o que está na tela funciona.
- **"Marcar em lote" perguntava uma coisa e o botão dizia outra** ("Marcar como lido os N pedidos?" com botão "Marcar lidos"). O botão agora repete o verbo da pergunta.
- **A tela de sair falava em "dispositivo"** enquanto o resto da app fala em "aparelho".

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
