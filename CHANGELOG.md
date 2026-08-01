# Changelog

Mudanças relevantes do **Waze Places**, das mais recentes pras mais antigas.

A versão que a app mostra no rodapé é um **serial de zona DNS** (`YYYYMMDDnn` → exibido como `v2026.07.24-01`): data da build + revisão do dia. Ela cresce sempre e diz *de quando* é o código que está rodando no seu celular. Fonte única: `js/version.js`.

Formato inspirado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

---

## v2026.08.01-04

### Corrigido
- **Um motivo de reporte estava com o sentido invertido.** `DOES_NOT_MATCH_SEARCH` aparecia como "Não aparece na busca", quando o Waze quer dizer o contrário: o local **apareceu** numa busca à qual ele não corresponde. A diferença muda o que o editor faz — na leitura errada a saída seria *adicionar* nome alternativo; na certa, é revisar um nome ou apelido genérico demais. Agora: **"Não corresponde à busca"**.
- **"Fechado permanentemente" virou "Local fechado".** O Waze não diz "permanentemente", e um local pode estar fechado temporariamente.

### Adicionado
- **Mais seis motivos de reporte ganharam tradução**: duplicado, baixa qualidade, mudança de endereço, outro, residencial (casa) e sem relação. Antes apareciam com o nome técnico em inglês. A lista completa e a redação vieram do próprio editor de mapas do Waze, então é a mesma palavra que você vê ao conferir pelo ↗ do card.
- **Em telas estreitas, o motivo do reporte ficou mais compacto** para caber numa linha. Em francês, "Résidentiel (domicile)" quebrava em duas e fazia o card inteiro rolar — o que atrapalha o gesto de pular.

## v2026.08.01-01

### Alterado
- **Quando a sessão cair de verdade, a app agora diz de qual lado falhou.** Antes era sempre a mesma frase. Agora: *"O Waze recusou o acesso: seus cookies mudaram ou expiraram"* quando o problema veio de lá, e *"Sua sessão no app venceu por inatividade"* quando foi daqui. A ação é a mesma — entrar de novo — mas na próxima vez que acontecer dá pra saber a origem sem investigação.

### Corrigido
- **A causa raiz da sessão que expirava sozinha: o Waze troca o cookie a cada resposta e a app jogava fora.** Medido com cookies reais — três chamadas devolveram três valores diferentes. A app guardava o retrato do login e nunca mais o atualizava, então o retrato azedava sozinho, por mais válido que o seu acesso ao Waze estivesse. Agora a app acompanha a troca: enquanto o seu acesso ao Waze valer, a sessão vale junto.

### Removido
- **Todo o código de compatibilidade com versões antigas.** A app está em testes e o owner avisou a turma que vai precisar reinstalar. Saíram: a migração de token do armazenamento de sessão, a tolerância a endereços terminados em `.php` (herança do backend anterior), o formato de sessão sem carimbo de data e a soma retroativa do histórico. **Quem já usava precisa entrar de novo.**

## v2026.07.31-01

### Corrigido
- **A sessão expirava sozinha, sem você ter pedido pra sair.** Eram dois problemas somados.
  - **O prazo contava do login, não do último uso.** Na hospedagem atual o prazo de 21 dias era gravado uma vez e nunca renovado: quem usava a app todo dia era deslogado no dia 21 do mesmo jeito. Agora cada uso renova — enquanto você aparecer pelo menos uma vez a cada 21 dias, a sessão não vence. Quem some por mais que isso continua precisando entrar de novo, como sempre.
  - **Uma única resposta de recusa derrubava a sessão na hora.** E "recusa" não quer dizer só "seus cookies venceram": o Waze também responde assim quando recebe várias chamadas juntas, e a app faz três ao abrir. Agora, antes de derrubar, ela confirma com uma segunda chamada — se a sessão estiver viva, nada é apagado e você só vê um aviso discreto de conexão instável.
- **Dois avisos de "Sessão expirou" apareciam empilhados.** Cada chamada que falhava avisava por conta própria. Agora é uma verificação só, e um aviso só.

## v2026.07.30-14

### Corrigido
- **Um item de lista vazio aparecia como um `+` sozinho, sem nada do lado.** Acontece quando o pedido propõe adicionar um serviço em branco — o Waze manda isso mesmo. Lido na tela parecia app quebrada; agora aparece `+ (vazio)`, que é o que de fato está sendo pedido.

## v2026.07.30-13

### Corrigido
- **A categoria voltava convertida na lista de mudanças.** Ela já aparecia como o Waze a nomeia no topo do card, mas na caixa "Mudanças propostas" ainda saía como `Natural features` — o mesmo `NATURAL_FEATURES` com dois nomes na mesma tela. A conversão saiu de vez: onde o Waze regionaliza, quem manda é o Waze.
- **Nome alternativo perdia as maiúsculas.** "Escola Estadual Leovegildo de Melo" aparecia como "Escola estadual leovegildo de melo" — a mesma conversão sendo aplicada a um nome próprio, que não é código nenhum.
- **O identificador do Google deixava de ser o identificador.** `ChIJfYn3umKwnZMRWQElCsPkDJ4` aparecia como `Chijfyn3umkwnzmrwqelcspkdj4`. Quem copiasse da tela colava um valor que não existe.

## v2026.07.30-11

### Alterado
- **Sumiram as linhas que diziam "mudou" e mostravam a mesma coisa dos dois lados.** O Waze não manda um "o que mudou": manda o local inteiro com os valores propostos, então campos que ninguém tocou vinham junto carregando o valor atual e viravam linha (`BR-060 → BR-060`). Agora só entra na lista o que realmente mudou. A comparação é feita antes de qualquer formatação, de propósito: uma área pode mudar de forma e ser escrita igual na tela — na sua fila havia uma que andou 84 metros assim.
- **Quando o pedido não altera nada, o card agora diz isso** em vez de ficar mudo: *"Nada a alterar — os valores enviados são iguais aos atuais."* Só aparece quando de fato houve o que comparar; se o pedido não trouxe nenhum campo, nada é afirmado.

### Corrigido
- **Campo com estrutura interna aparecia como um bloco de JSON.** Um eletroposto mostrava o objeto inteiro só pra dizer que a rede tinha mudado de nome. Agora aparece só o que mudou lá dentro: `CHARGING_STATION.network: Porsche Smart Mobility GmbH → Ponto de Carga`.
- **E quando o que mudou lá dentro era uma lista, ela também virava JSON.** No mesmo eletroposto, a troca dos pontos de recarga eram dois blocos de 150 caracteres lado a lado. Agora é o mesmo verde-entra/vermelho-sai que a app já usa nos outros campos de lista, com o conteúdo legível: `+ portId TYPE2.11 · connectorTypes TYPE2 · count 2`.

## v2026.07.30-10

### Corrigido
- **O erro vermelho "ResizeObserver loop…" que aparecia ao abrir a foto.** Nada estava quebrado: era um aviso do navegador que a app mostrava como se fosse defeito, bem em cima do card. A causa era a própria vigia que decide se o card precisa rolar — ela mexia no layout no meio da medição, e no computador (onde a barra de rolagem ocupa espaço) isso se mordia a si mesmo. Agora a vigia mede primeiro e só depois mexe, e avisos do navegador que não pedem ação nenhuma ficam no console em vez de na sua frente.
- **A última linha do card ficava cortada e aparecia uma barra de rolagem por causa de poucos pixels.** Quem encolhia era o texto, com a foto intacta — e apertar o texto não ajudava, porque a foto reabsorvia o espaço na hora. Agora quem cede é a foto, que é o elemento que mais sobra. Nos cards de mudanças e de reporte nada muda: lá a lista continua sendo a única área que rola.

## v2026.07.30-09

### Corrigido
- **A barra de rolagem que aparecia no computador sem ter o que rolar.** Era um pixel a mais que não existia: a altura da foto quase nunca dá um número redondo, e as duas contas que decidem se o conteúdo cabe arredondam pra lados diferentes. Bastava isso pro card ficar com barra o tempo todo, e no celular ninguém via porque lá a barra é sobreposta. Agora o card só passa a rolar quando o conteúdo estoura de verdade — e continua vigiando, então girar o aparelho, aumentar a fonte do sistema ou dar zoom só no texto liga a rolagem na hora em que ela faz falta.

## v2026.07.30-07

### Adicionado
- **O botão voltar do aparelho agora fecha a foto e os diálogos**, em vez de sair da app. Veio de um retorno de editora: no ritmo do swipe, ir até o ✕ quebra a cadência. Vale para a foto ampliada e para todos os diálogos — fazer só na foto seria pior, porque você aprenderia que voltar fecha, tentaria em Filtros e sairia da app perdendo o que estava montando. No iPhone em modo app não existe voltar; lá o ✕ e o arrastar continuam.
- **A dica da foto ampliada agora conta que arrastar pra baixo fecha.** Esse gesto sempre existiu e não estava escrito em lugar nenhum.
- **O card mostra de onde veio o pedido e quem mandou**: o nível de quem enviou (L1…L6), se veio do site ou do app do celular, e quantos outros pedidos daquela mesma pessoa estão na fila. Um pedido de nível 1 feito dirigindo é uma coisa; um de nível 5 feito na mesa é outra — e quando alguém mandou 15, decidir sobre o primeiro costuma decidir sobre os outros.

## v2026.07.30-06

### Corrigido
- **Numa mudança com muitas linhas, o nome do campo sumia da vista.** O rótulo ficava centralizado na altura inteira do bloco: com dois pontos de entrada, a linha passava de 470px dentro de uma caixa de 106px, e o rótulo ia parar bem abaixo do que dá pra ver. Você rolava até lá e encontrava um bloco de texto sem saber de que campo era. Agora o rótulo fica sempre colado na primeira linha do seu valor.

## v2026.07.30-05

### Alterado
- **A categoria voltou a aparecer como o Waze a nomeia.** Na versão anterior eu havia traduzido as mais comuns, e estava errado: o Waze regionaliza categoria por país, então uma tabela fixa acerta no lugar onde foi medida e erra fora dele. O identificador original também é o que casa com o que você vê no WME. Quando houver uma fonte de regionalização, tentamos de novo.

## v2026.07.30-04

### Adicionado
- **Mudanças, reportes e pedidos de remoção agora aparecem para todo mundo.** Estavam atrás do Modo Desenvolvedor enquanto os cards não davam conta deles. O custo disso só ficou claro medindo uma fila de verdade: de 137 pedidos, **135 eram desses tipos** — o editor abria a app e via dois.

### Corrigido
- **Mudança de posição no mapa dizia `[object Object]`.** Agora diz quanto o ponto andou ("moveu 36 m") e, quando é uma área, quantos vértices ela ganhou ou perdeu. A distância é medida do centro da forma: medir do primeiro ponto fazia uma área que mudou parecer parada.
- **Campos de lista mostravam as duas listas inteiras** e você comparava de olho. Agora aparece só o que entrou e o que saiu: "Categorias: + Ao ar livre".
- **Os três motivos de reporte que existem de verdade não tinham tradução** — apareciam com o nome técnico do Waze. O único que estava traduzido não ocorre nenhuma vez na prática.
- **Horário de funcionamento e ponto de entrada apareciam como JSON.** Agora: "todos os dias · 00:00–00:00" e "Entrada · entrada -22.89161, -42.03520".
- **A categoria aparecia em MAIÚSCULAS_COM_UNDERLINE** na segunda linha de todo card. Agora é o nome legível.
- **O card de remoção repetia a própria frase** — no banner e na linha "Tipo:" logo abaixo — e em francês, em telas de 320px, a segunda ficava cortada.
- **Na tela mais baixa que existe, o card tinha duas áreas de rolagem**, o que atrapalha o gesto de pular. Agora tem uma só.

## v2026.07.30-02

### Corrigido
- **O botão ↗ do card abria o WME em português para todo mundo.** O endereço tinha o idioma cravado, então quem usa a app em inglês, espanhol ou francês clicava e caía numa interface que não é a dele. Agora abre o endereço oficial (`waze.com/editor`) e o Waze escolhe o idioma pela sua conta — que é quem deve decidir.

## v2026.07.30-01

### Adicionado
- **A app fala francês.** Todas as 309 mensagens, do card aos diálogos, avisos e mensagens de erro. Quem tem o navegador em francês passa a cair no francês sozinho, e o idioma está nos dois seletores (Filtros → Preferências e a Ajuda, que funciona mesmo sem estar conectado). Como nos outros, é **um** francês — quem tem o navegador em qualquer variante cai no mesmo idioma, do mesmo jeito que português do Brasil e de Portugal caem em um só.

### Corrigido
- **A app falava português com quem escolheu outro idioma sempre que dava erro.** Este é o mais sério da leva. As mensagens de erro nasciam prontas no servidor, em português, e a tela as mostrava direto — a tradução ao lado só era usada se o servidor não dissesse nada. Resultado: cookie recusado, sessão expirada, falha de conexão, código de pareamento errado ou pedido já tratado por outro editor apareciam **em português para quem usava a app em inglês, espanhol ou francês**. São 26 mensagens. Agora o servidor manda um código e quem escolhe a palavra é a app, no idioma de quem está lendo.
- **O aviso de acesso restrito também vinha em português** — e justamente para quem foi bloqueado, no momento em que a explicação mais importa. Ele repetia o seu perfil, que a tela já mostrava logo abaixo com os selos traduzidos.
- **Escolher um idioma no seletor podia ser ignorado.** A app tinha uma lista fixa de idiomas aceitos, separada da lista de traduções: qualquer idioma novo era reconhecido pelo navegador mas descartado quando escolhido à mão, voltando calado para o idioma do sistema. As duas listas agora são a mesma coisa.
- **Números e datas em francês saíam no formato inglês.** O idioma não tinha formato próprio declarado e caía no padrão do inglês sem avisar.
- **Mudança de posição no mapa aparecia como `[object Object]`.** Em toda a app, em qualquer idioma, desde sempre. Medido na fila de um editor de verdade: **33 de 142 pedidos** tinham mudança de geometria, e em todos eles a linha "Mudanças propostas" mostrava esse texto no lugar da coordenada. Agora mostra a coordenada (e, quando é uma área e não um ponto, também quantos vértices ela tem — sem isso, uma área que mudou nos outros cantos apareceria como se nada tivesse mudado).
- **Quatro campos apareciam com o nome técnico do Waze** (`ExternalProviderIDs`, `Services`, `LockRank`, `CategoryAttributes`) porque não tinham tradução. Agora têm, nas quatro línguas.
- **O nome, a descrição e os atalhos da app instalada estavam em português para todos.** O arquivo que o celular lê na instalação é o mesmo para o mundo inteiro, então não havia como traduzi-lo por pessoa: passou a ser neutro. Quem já instalou continua com o mesmo app (a identidade não mudou); o rótulo no celular acompanha na próxima atualização.
- **A lista de países era ordenada pela regra do português para todo mundo.** Ordenar agora acontece no idioma de quem está lendo. Medindo, ficou claro que hoje isso não muda nada visível — os nomes de país vêm do Waze **sempre em inglês**, e nenhuma das quatro línguas os ordena diferente. Fica certo para quando entrar um idioma que ordene de outro jeito.
- **No celular mais estreito (dobrável de 280px), o card de reporte em francês passava a rolar por dentro** — o que desliga o gesto de "pular". O título da seção quebrava em duas linhas onde as outras línguas cabem em uma.

## v2026.07.29-06

### Adicionado
- **A Ajuda agora tem "Privacidade e dados".** Em sete linhas: no servidor fica só o seu cookie do Waze, criptografado; nenhum dado de pedido é gravado em lugar nenhum; o prazo é de 21 dias ou até você sair; o que fica neste aparelho; que os seus cookies são credenciais e que a app nunca aprova nada; onde ela roda; e com quem falar para acessar ou apagar seus dados.
- **O diálogo de "Sair" avisa que sair da app não desconecta você do Waze.** Os seus cookies continuam válidos lá — quem quiser encerrar de verdade precisa sair também no Waze Map Editor, e agora o link está ali.

### Corrigido
- **"Sair" com a internet fora não engana mais.** A limpeza do aparelho sempre aconteceu; a do servidor falhava em silêncio. Agora ela é tentada de novo e, se ainda assim não completar, você é avisado do que ficou pendente — e de que expira sozinho em até 21 dias.
- **Sair ficou instantâneo.** Antes a tela esperava a resposta do servidor para limpar; agora o aparelho é limpo na hora (medido: 26ms) e a parte remota acontece em seguida.
- **O "Agora não" do convite de instalar também é apagado ao sair.** Era a única marca que ficava para trás.

## v2026.07.29-05

### Adicionado
- **A app agora avisa quem nunca usa o "Desfazer".** Se você deixou passar 20 pedidos seguidos sem desfazer nenhum, ela conta que dá para desligar a espera de 3 segundos — uma vez só, num aviso no topo que abre a preferência com um toque. Antes, o único aviso aparecia no momento exato em que você cruzava a cota de liberação; quem já estava acima dela quando esse aviso foi criado nunca soube que a opção existia. Eram justamente os editores mais ativos — os que mais perdem tempo com a espera.
- **A Ajuda passou a dizer que a opção existe.** Era o lugar onde alguém curioso iria procurar, e não estava escrito lá.

## v2026.07.29-04

### Corrigido
- **Os botões ✕/↑/✓ agora ficam sempre na tela.** Em quatro aparelhos medidos eles nasciam abaixo da dobra — 87px no Galaxy Fold, 92px com o celular deitado, 17px no iPhone SE, 3px no Galaxy S8+. E não dava para rolar até eles com o dedo no card, porque arrastar para cima é "pular": só rolando pela margem. A altura do card vinha de uma fração da janela e ignorava o que o cabeçalho e o placar já tinham ocupado; agora o card recebe **o espaço que sobra**. Onde já cabia, nada muda (Pixel 7, iPhone 14 Pro, iPad seguem com o card idêntico).
- **A página não rola mais em nenhum aparelho.** Rolagem de página disputa com o gesto de pular.
- **Com o celular deitado, os botões passaram para baixo da foto.** Assim o texto recebe a altura inteira do card e para de rolar por dentro nos quatro tipos de pedido.

### Alterado
- **O placar ficou mais enxuto em telas baixas**, devolvendo até 42px para o card — que é o produto da app. Os rótulos não encolheram: 11px é o piso de legibilidade.

## v2026.07.29-03

### Adicionado
- **A app agora convida você a instalá-la na tela inicial — na hora certa.** O convite aparece no **"Tudo limpo!"**, o único momento em que você terminou a fila e não há próximo pedido esperando. Em qualquer outro lugar ele disputaria com o gesto. Um toque em "Agora não" e ele não volta mais.
- **Quem usa iPhone finalmente tem um caminho.** O Safari nunca oferece o botão de instalar (no iOS a instalação é manual), então o convite mostra os dois passos: **Compartilhar → Adicionar à Tela de Início**. Antes, quem entrava pelo QR do pareamento — que empurra justamente para o celular — não tinha instrução nenhuma.
- **Quem já instalou não é mais convidado.** A app passou a reconhecer que está rodando instalada, tanto no Android/desktop quanto no iPhone.

### Corrigido
- **O "Tudo limpo!" não corta mais o convite em tela pequena.** Medido: no Galaxy Fold o botão de instalar ficava fora da tela e, com o celular deitado, os passos do iPhone — a instrução, no aparelho que não tem botão. Onde falta espaço, sai a decoração (o selo verde repete o ✓ que o título já diz) e fica a ação. Em último caso o painel rola, com o aviso de que há mais conteúdo abaixo.

## v2026.07.29-02

### Alterado
- **O aviso de que o "Desfazer" virou opcional passou a ficar 20 segundos na tela**, em vez de 8. São 16 palavras para ler: em 8 segundos a mensagem sumia antes de muita gente terminar. Ficar mais tempo não custa nada desde que ele foi para o topo — medido em 3 aparelhos, os botões do card seguem livres durante os 20 segundos inteiros. Um toque continua abrindo as Preferências e dispensando o aviso.

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
