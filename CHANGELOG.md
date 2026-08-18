# Changelog

Mudanças relevantes do **Waze Places**, das mais recentes pras mais antigas.

A versão que a app mostra no rodapé é um **serial de zona DNS** (`YYYYMMDDnn` → exibido como `v2026.07.24-01`): data da build + revisão do dia. Ela cresce sempre e diz *de quando* é o código que está rodando no seu celular. Fonte única: `js/version.js`.

Formato inspirado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

---

## v2026.08.18-04

### Corrigido
- **O botão de aprovar foto não respondia ao toque.** A etiqueta com o nome do local, que entrou hoje, ficava por cima dele — invisivelmente: a caixa da etiqueta ocupa a largura toda, mesmo com o texto curto, e engolia o dedo. Valia para aprovar e para excluir. Relatado por [@antigerme](https://www.waze.com/user/editor/antigerme) com print de um pedido que ele queria aprovar e não conseguia.
- **A etiqueta também cobria a tira de miniaturas** em locais com duas ou mais fotos. Agora ela sobe junto com a tira, como os outros controles de baixo já faziam.

---

## v2026.08.18-03

### Corrigido
- **O nome do local aparecia duas vezes ao corrigi-lo.** A etiqueta sobre a foto e a linha "Antes:" mostravam a mesma coisa. Ficou só a etiqueta — ela flutua sobre a foto e não ocupa espaço, então a foto ganhou **30 pixels** de volta em todo aparelho. Reparado por [@antigerme](https://www.waze.com/user/editor/antigerme) na primeira vez que usou de verdade.

  A etiqueta devia sumir enquanto você digita, e não sumia: uma regra de estilo nossa vencia a que esconde elementos. Agora ela fica de propósito, como referência do nome antigo — e virou rótulo, não botão.

---

## v2026.08.18-02

### Adicionado
- **Dá para corrigir o nome do local sem sair da app.** Ao ampliar a foto de um pedido, o nome do local aparece embaixo. Toque nele, corrija e pronto — a gravação vai para o Waze depois dos 3 segundos de "Desfazer", como qualquer outra ação.

  Nasceu de um relato de um editor nível 6: às vezes chega uma foto boa de fachada e, olhando para ela, dá para ver que o nome cadastrado está errado — `Odontodente Consultório` onde a placa diz `Odontodente Sorriso`. Até agora o único caminho era abrir o Waze Map Editor no meio da triagem.

  **A foto continua na tela enquanto você digita**, e isso não é detalhe: ela é a prova do nome. A primeira versão usava uma folha deslizando de baixo e, medindo com o teclado aberto, sobravam 7 pixels de foto num Galaxy Fold — a placa ficava coberta justamente enquanto você a copiava. Por isso a edição acontece na própria linha do nome, e a foto encolhe para o espaço que sobra: 301 pixels no Fold, 513 num Pixel 7.

  Só aparece para **nível 6 com área gerenciada, ou staff** — o mesmo grupo que já pode excluir foto por aqui. No modo treino não aparece, porque treino não escreve. E vale só para corrigir nome que já existe: batizar local sem nome continua sendo assunto do WME.

---

## v2026.08.18-01

### Adicionado
- **Quando duas versões de um texto parecem iguais, a app marca o que mudou.** Nos pedidos de alteração, o card mostra o valor antigo riscado e o novo ao lado — e pra quase tudo isso basta: `Bom Atacarejo` → `Strapasson` se lê num piscar. Mas há um caso em que o olho não tem onde se agarrar:

  ```
  Aeroport Josep Tarradellas Barcelona - El Prat T1
  Aeroport Josep Tarradellas Barcelona - El Prat T2
  ```

  Duas linhas do mesmo tamanho, um caractere de diferença. Agora esse caractere aparece destacado dos dois lados, e o resto do texto continua como sempre.

  Só acende quando a diferença **não muda o tamanho** do texto — foi isso que a medição em 453 alterações de 13 países mostrou separar o difícil do óbvio. `Car Park` → `Car Parkuuuu` cresce e você vê; `Terminal 2F` → `Terminal 2C` não cresce e passa batido. Dispara em cerca de 1 em 10 alterações de texto; nas outras 9 a linha sai exatamente como antes.

  Em texto longo, a app mostra a vizinhança da diferença em vez do começo da frase (`…Barcelona - El Prat T1`). Isso conserta de quebra um problema que já existia: em tela estreita o card cortava o nome **antes** da parte que decide, então `T1` e `T2` apareciam idênticos. O valor completo fica no toque longo / passar o mouse.

  Ideia discutida com [@antigerme](https://www.waze.com/user/editor/antigerme), que recusou duas propostas anteriores (selos que explicavam o que o editor já lia) e apontou o caminho certo: *"os editores de mapas não são assim tão burros para precisar dessa muleta"*.

---

## v2026.08.17-01

### Adicionado
- **O pedido de "duplicado" agora diz duplicado DE QUEM — e mostra onde.** Antes o card dizia só `Motivo: Duplicado`, que é meia frase: o que decide é qual é o outro local. Agora ele diz `Duplicado de “Natan Estacionamento”` e o mini-mapa ganha um marcador (losango roxo) na posição desse outro local, ao lado do marcador do local do pedido — dá pra ver num olhar se são de fato o mesmo lugar ou dois vizinhos parecidos.

  O Waze sempre mandou o dado (medindo as filas dos seis países, **os 7 pedidos de duplicado trazem o id do outro local**), mas não manda o nome dele: a busca só devolve locais que têm pedido pendente, e o local duplicado normalmente não tem. Medido: em 6 de 6 casos reais o alvo **não** estava na resposta. A app agora vai buscar o nome, e acha em 6 de 6.

  Quando não dá pra resolver — local apagado, ou fora do alcance da busca —, o card volta a dizer só `Duplicado`, sem "de" pendurado. Achado por [@antigerme](https://www.waze.com/user/editor/antigerme), que reparou que o WME mostrava o nome e a app não.

  **Correção de servidor, sem número de versão novo** (o rodapé continua `v2026.08.17-01`): na primeira versão a busca pelo outro local partia do primeiro canto do local em vez do centro dele. Em local desenhado como área isso desloca a busca — num estacionamento em Salvador, **272 metros** —, e o duplicado ficava de fora por pouco, com espaço de sobra do outro lado. Achado por [@antigerme](https://www.waze.com/user/editor/antigerme) no primeiro caso real depois do lançamento.

---

## v2026.08.16-08

### Adicionado
- **Ao ampliar uma foto, você vê de quando ela é.** A etiqueta do canto, que antes só dizia qual foto era (`3 / 7`), agora diz também a idade: `3 / 7 · há 2 meses`, ou o ano quando é antiga. A data exata aparece ao passar o mouse.

  Isso importa por causa da lixeira: a pergunta que vem antes de excluir uma foto é *"isto ainda é este lugar?"*. Medindo as filas dos seis países, **39% das fotos têm mais de três anos** — a mais antiga tinha quase doze — e até agora nada na tela dizia isso. Quase metade tem menos de um mês, então a idade separa na hora o que é proposta nova do que é acervo antigo do local.

  Não custa nenhuma consulta a mais: o dado já vinha junto com as fotos. Ideia de [@antigerme](https://www.waze.com/user/editor/antigerme).

---

## v2026.08.16-05

### Adicionado
- **Ao ampliar uma foto, você vê todas as fotos do local de uma vez.** Uma tira de miniaturas embaixo, tocáveis para pular direto — antes só dava para ir tateando no `‹ ›`, sem saber quantas faltavam nem o que vinha. A foto do pedido continua marcada com o mesmo selo (✨ nova, 🚩 denunciada) também na tira, senão seriam N fotos iguais.

  Ajuda mais em dois casos que são exatamente onde a decisão mora: **foto denunciada** (o pedido é sobre uma foto entre várias) e **foto nova** (a proposta ao lado das que o local já tem).

  Aparece só quando o local tem duas ou mais fotos — cerca de um terço dos pedidos. E **não custa dados nenhum**: a app já adianta as fotos do pedido seguinte enquanto você olha o atual, então quando você amplia elas já estão no aparelho, e a tira reaproveita exatamente as mesmas. Observação de [@antigerme](https://www.waze.com/user/editor/antigerme), que percebeu o desperdício na primeira versão.

  **A tira nunca cobre a foto.** Medi o espaço livre em cinco aparelhos: na maioria sobra bastante, mas no iPhone SE com foto em pé sobram 27 pixels e no celular deitado, nenhum. Então ela ocupa espaço de verdade em vez de flutuar por cima — a foto encolhe um pouco, mas continua inteira à vista.

---

## v2026.08.16-04

### Corrigido
- **Rodando fora do Cloudflare, a app estava com uma camada de segurança a menos.** A política que restringe quais scripts podem rodar na página existia em dois lugares: dentro do próprio HTML e num arquivo que só o Cloudflare lê. Quem subisse a app num servidor próprio ficava só com a primeira — e nada avisava. Agora o servidor próprio manda a política junto, igual ao Cloudflare, e um teste sobe o servidor de verdade para conferir que ela sai na resposta.

### Alterado
- **Uma permissão que não servia para nada saiu da política de segurança.** Ela liberava o domínio da análise de tráfego do Cloudflare, que não é carregado nesta app. Permissão que não é usada é permissão que alguém reaproveita sem pensar.

---

## v2026.08.16-03

### Alterado
- **O carregamento do próximo pedido parou de atrapalhar o atual.** A app adianta as fotos do pedido seguinte enquanto você olha o de agora — bom recurso, mas ele começava no mesmo instante que a foto que você precisa ver. Num pedido com quatro fotos isso eram 189 KB do que ainda não interessa disputando banda com os 12 KB que interessam. Agora ele espera a foto atual terminar.
- **Menos uma coisa segurando o desenho da tela.** O trecho que aplica o tema antes de tudo virou parte da própria página em vez de um arquivo separado — uma requisição a menos, sem afrouxar nenhuma regra de segurança.

---

## v2026.08.16-02

### Alterado
- **A sua foto de perfil deixou de atrasar o primeiro pedido.** Ela vem do Waze com 214 KB para aparecer com 32 pixels no cabeçalho — é a imagem mais pesada da app e a menos importante, e não existe versão menor no Waze. Agora ela só começa a ser buscada **depois que o primeiro card está na tela**, e ainda espera o aparelho ficar ocioso.

  Em rede móvel esses 214 KB eram mais de um segundo de banda ocupada bem na hora em que você está esperando **ver** o pedido. O espaço dela no cabeçalho fica reservado desde o começo, então quando a foto chega nada se move.

  Se a sua fila estiver vazia, ela carrega assim mesmo — ninguém fica com o círculo cinza para sempre.

---

## v2026.08.16-01

### Alterado
- **A app abre mais rápido, principalmente no celular.** Quatro mudanças, todas medidas contra o relatório do Lighthouse que [@antigerme](https://www.waze.com/user/editor/antigerme) rodou na produção:

  - **Um arquivo de estilo em vez de dois, e agora minificado.** O nosso CSS ia para o navegador com todos os comentários — e comentário comprime, mas não some: eram 23,4 KB que viraram 5,3 KB. Como ele bloqueia o desenho da tela, essa é a maior economia da lista.
  - **As três miniaturas da tela de entrada emagreceram de 65 KB para 30 KB.** Elas tinham 240 pixels de largura e são exibidas com 72 — foram para 144, que já sobra até em tela de alta densidade. Foto não encolhe na compressão, então esses 35 KB eram desperdício puro em dado móvel.
  - **A sua foto de perfil deixou de atrapalhar.** Ela vem do Waze com 214 KB e aparece com 32 pixels no cabeçalho; não existe versão menor (testei). Agora ela é buscada com prioridade baixa e a **foto do pedido** com prioridade alta — o que você precisa ver para decidir passa na frente.
  - **Os scripts não seguram mais o desenho da página.**

  Nada disso muda o que a app faz, nem adiciona qualquer consulta ao servidor.

---

## v2026.08.15-03

### Alterado
- **O modo treino agora usa 30 pedidos seus de verdade, escolhidos para serem diferentes entre si.** Antes eram um exemplo inventado e três pedidos reais — os três primeiros da fila. O problema é que a fila vem ordenada por data, não por variedade: na fila do [@antigerme](https://www.waze.com/user/editor/antigerme) os três primeiros são **do mesmo tipo**, então o treino mostrava um tipo de pedido só, de dez que existiam.

  Agora o treino monta a lista em rodízio — um de cada tipo, depois o segundo de cada, e assim por diante. Medido nas filas reais de Brasil, França, Reino Unido, México, Espanha e Portugal: pegando 30 na ordem da fila, você veria de 5 a 8 dos tipos existentes; **por variedade, você vê todos, nos seis países**. E como a variedade fica na frente, quem sai no quinto card já viu cinco tipos diferentes.

  O 30 é o tamanho de uma página do WME, para ser a mesma unidade que você já conhece.

  **Os exemplos inventados continuam existindo, mas só como piso.** Se a sua fila estiver vazia ou muito curta — o que é comum no primeiro minuto, antes de ela terminar de carregar —, o treino completa com eles. Ninguém fica sem treino por estar com a fila limpa. Ideia de [@antigerme](https://www.waze.com/user/editor/antigerme).

### Corrigido
- **No treino, o "Restam" mostrava um número menor que a quantidade de cards.** Ele estava fixo em 3 enquanto o treino montava 4 cards, então o contador chegava a zero com um card ainda na tela. Agora sai da própria lista do treino.

---

## v2026.08.15-02

### Adicionado
- **A app avisa quando a sua sessão está para vencer.** Uma linha discreta embaixo do placar, nos últimos dias: *"Sua sessão vence em 3 dias · renove num computador"*. Ela existe porque o fim da sessão sempre chegava de surpresa, e chegava no pior lugar — no celular, onde não há como renovar: quem entrou pelo QR precisa de um computador, e descobrir isso no meio da fila custa a triagem inteira.

  **O prazo é real, medido, não estimado.** O Waze troca o seu cookie de sessão a cada resposta, mas o vencimento não muda junto: em três consultas seguidas o cookie veio diferente nas três e a data de validade ficou parada. É essa data que a app mostra. Se você entrar de novo no editor do Waze, o prazo novo chega na próxima busca e o aviso some sozinho.

  Não é botão nem link, de propósito: nesse tamanho de texto o alvo ficaria menor que o mínimo tocável, logo acima da área onde você desliza o card. E some no "Sair", como todo o resto. Ideia de [@antigerme](https://www.waze.com/user/editor/antigerme).

---

## v2026.08.15-01

### Adicionado
- **O ícone da app instalada ganha um pontinho quando há pedidos esperando — no computador.** Sem número, de propósito: o ponto só pode ser escrito enquanto a app está aberta, então um "118" ficaria congelado no ícone e mentiria a partir do instante em que você fecha. O ponto diz apenas *"tem trabalho"*, e isso continua verdade. Some sozinho quando a fila zera e quando você sai.

  **Onde ele aparece de verdade** (esta parte foi corrigida depois da entrega, quando [@antigerme](https://www.waze.com/user/editor/antigerme) testou no aparelho dele e não viu ponto nenhum):

  | onde | aparece? |
  |---|---|
  | Windows, macOS e ChromeOS, app instalada pelo Chrome ou Edge | sim |
  | **Android** | **não, e não é possível** |
  | iPhone e iPad, app na tela de início | só com notificações autorizadas |

  **No Android o pontinho nunca vai aparecer**, e não é falta da app nem instalação errada: o Chrome do Android não tem essa função. O badge do Android é derivado de notificação e o sistema só deixa *esconder* um, nunca acender — por isso a função nunca foi portada para lá. Trocar o ponto por um número também não resolveria: o número é justamente a parte que o Android não sabe fazer.

  **Não pede permissão de notificação nenhuma.** No iPhone o pontinho depende de notificações autorizadas; se não estiverem, ele simplesmente não aparece — e a app não te interrompe pra pedir. Onde a função não existe, a app não faz nada e não reclama: o "Restam" na tela continua sendo o indicador que funciona em todo aparelho. Ideia de [@antigerme](https://www.waze.com/user/editor/antigerme).

---

## v2026.08.14-01

### Corrigido
- **O botão de atualizar quebrava com "Erro inesperado".** Clicar em atualizar — ou aplicar um filtro — falhava com `semAnimar is not defined` e a fila não recarregava. Relatado por [@antigerme](https://www.waze.com/user/editor/antigerme), com print. Entrou na versão anterior e ficou algumas horas no ar. Corrigido.

---

## v2026.08.13-05

### Alterado
- **O modo treino agora usa os seus pedidos de verdade.** Antes eram três exemplos inventados, que ensinavam o gesto mas não o que é difícil: olhar uma foto borrada, um nome ruim, um endereço errado e **decidir**. Agora vem um exemplo controlado primeiro — pro primeiro toque não ter surpresa — e depois os seus próprios pedidos, com foto, mapa e mudanças propostas.

  Nada continua sendo enviado, e agora dá pra **ver** isso: os pedidos que você tratou no treino continuam na fila quando você sai. Ideia de [@antigerme](https://www.waze.com/user/editor/antigerme).

### Corrigido
- **As ações de foto não eram bloqueadas no modo treino.** Aprovar e excluir foto ficavam de fora da trava — o que não fazia diferença enquanto os exemplos não tinham foto, mas passaria a apagar foto do mapa de verdade agora que o treino usa pedidos reais. Bloqueadas, e os dois botões somem no treino. Marcar em lote também.

---

## v2026.08.13-04

### Corrigido
- **No Galaxy Fold, a faixa do modo treino empurrava os botões do card para fora da tela.** Ela ficou mais baixa em aparelhos de tela curta, e os três botões voltaram a caber.

  Ficava registrado aqui que, no celular deitado e no iPhone SE de 2016, os dois botões maiores passavam da borda por 2 a 4 pixels — algo que **já acontecia antes do modo treino existir**, também na fila normal.

  **Isso não acontece mais** (verificado em 2026-08-16). Medido em quatro aparelhos, com e sem foto, com e sem a faixa do treino: nenhum botão passa da borda, e sobram entre 15 e 17 pixels em todos. Não dá para apontar qual mudança resolveu — o layout do card foi reescrito várias vezes desde então —, então fica só o registro de que o defeito não existe mais, para ninguém procurá-lo de novo.

---

## v2026.08.13-03

### Corrigido
- **A faixa do modo treino ficava escrita por cima do placar.** Os dois textos ocupavam o mesmo espaço e se sobrepunham. Relatado por [@antigerme](https://www.waze.com/user/editor/antigerme), com print do celular. Agora a faixa fica acima do placar, ocupando espaço próprio.

- **O placar contava de trás pra frente ao entrar no treino.** Ele animava dos seus números reais até os do treino, o que dá a impressão de que o seu trabalho mudou — mudou só o placar que você está olhando. Agora ele troca na hora.

- **A tela ficava vazia por dois segundos ao terminar o treino.** O último aviso aparecia flutuando sobre uma área em branco. Agora ele vem dentro da própria tela de "Treino concluído", que abre na hora.

## v2026.08.13-02

### Adicionado
- **Modo treino: dá pra praticar sem enviar nada ao Waze.** Três pedidos de exemplo onde você rejeita, pula e marca como lido à vontade — e a cada ação a app diz o que *teria* acontecido de verdade. Nada sai daqui. Entra pela **Ajuda › "Praticar sem enviar nada"** ou pelo botão "Quero treinar antes" no aviso de primeira vez, e a sua fila real volta intacta ao sair.

  Ele existe porque duas das três ações escrevem no Waze **em seu nome**, e a rejeição não tem volta depois dos segundos do Desfazer. Poder errar de mentira vale mais que qualquer texto explicativo.

- **A app passou a dizer o que cada ação FAZ, não só o que ela quer dizer.** Na primeira vez que você rejeita e na primeira vez que marca como lido, aparece uma linha explicando o efeito real. A diferença importa mais no ✓: **marcar como lido não aprova nada** — o pedido continua existindo, só sai da sua fila. O ✓ verde sugere o contrário para quem chegou agora.

## v2026.08.13-01

### Adicionado
- **Um aviso "Como funciona" no primeiro card.** Os três botões (✕ ↑ ✓) só tinham nome para leitor de tela e para quem passa o mouse — e passar o mouse não existe no celular. Quem nunca usou via três círculos coloridos e adivinhava. Agora, no primeiro pedido da primeira vez, aparece uma explicação curta do que cada um faz. Uma vez só; depois disso, ela fica na **Ajuda › "Ver de novo Como funciona"**.

  A alternativa era escrever o nome embaixo de cada botão — e ela foi medida e recusada: custaria 20px de **foto** em todo card, para sempre, para ensinar algo que se aprende uma vez.

- **"Já instalei — entrar", na opção de login automático.** Quem instalava a extensão com a página aberta ficava esperando para sempre: a app pergunta à extensão uma única vez, no carregamento, e a extensão não entra numa aba que já estava aberta. O botão aparece depois que você clica em instalar e recarrega a página, que é o que faz a ligação funcionar. A app também volta a perguntar sozinha quando você retorna para a aba.

## v2026.08.12-02

### Adicionado
- **A tela de entrada agora diz quem pode entrar, antes de você tentar.** Até aqui só se descobria depois de instalar a extensão, entrar no WME e voltar — e a recusa dizia apenas "certos níveis de editor". Agora o critério está escrito logo de cara: **editor nível 3 ou acima que seja Area Manager, ou staff do Waze**. O modal de recusa passou a dizer o mesmo, em vez da frase vaga.

- **A app se mostra antes de pedir qualquer coisa.** Três telas de exemplo — um pedido com foto, o mapa e as mudanças propostas — logo abaixo das opções de entrada. Quem chega novo estava sendo convidado a instalar uma extensão sem nunca ter visto do que se trata.

### Alterado
- **A frase de boas-vindas parou de pedir a coisa errada.** Ela dizia *"você precisa fornecer seus cookies de autenticação"* — que não é verdade em dois dos três caminhos (pela extensão e pelo código você não fornece cookie nenhum), e que assusta quem não é técnico. Agora diz o que a app faz: *"Triagem rápida dos pedidos de places que chegam no Waze: você vê um por vez e decide com um toque."*

  No celular, a faixa de "quem pode entrar" fica **abaixo** dos botões, e no computador acima. Não é capricho: em cima, ela empurrava o botão principal para fora da primeira tela no Galaxy Fold e no iPhone SE. Medido antes e depois, em seis aparelhos — o botão principal continua exatamente onde estava.

## v2026.08.12-01

### Adicionado
- **No iPhone e no iPad, a tela de abertura agora tem versão clara e versão escura**, e o aparelho escolhe pela sua preferência. É o que faltava do relato de [@antigerme](https://www.waze.com/user/editor/antigerme) sobre o clarão branco na abertura.

  No Android a limitação continua: o fundo da abertura vem de um arquivo que o navegador lê uma vez e que **não** aceita duas cores. No iPhone existe um caminho diferente, que aceita — e é ele que está sendo usado agora, em 17 tamanhos de tela, do iPhone SE ao 16 Pro Max, mais os iPads.

- **As imagens que aparecem na hora de instalar o app foram refeitas.** Eram duas, antigas. Agora são seis, tiradas da fila de verdade: o card com foto, um pedido de foto nova com as fotos que o local já tem, o mapa de evidência, as mudanças propostas em antes/depois, a tela de filtros e a app no computador.

  Estão em inglês porque os testadores são de vários países e essas imagens **não** podem variar por idioma — quem escolhe a língua do resto do manifesto (nome, descrição, atalhos) não cobre as imagens. O nome de quem enviou cada pedido foi trocado por um genérico: são imagens públicas.

## v2026.08.11-01

### Corrigido
- **A tela de abertura não seguia mais o seu tema.** Quem usa o app instalado no celular em modo escuro via um clarão branco por meio segundo antes da app aparecer. Relatado por [@antigerme](https://www.waze.com/user/editor/antigerme), com vídeo e print do aparelho.

  A **barra de status** agora acompanha a sua preferência desde o primeiro instante — antes ela vinha num azul aceso fixo, que era metade do clarão. E o fundo da abertura passou a ser o mesmo do tema escuro do app, em vez de branco.

  Uma ressalva honesta: o fundo dessa tela é definido num arquivo que o navegador lê **uma vez**, e ele **não aceita** duas cores por preferência — é limitação da plataforma, não escolha nossa. Enquanto isso não mudar, ele é único. Quem usa o tema claro pode ver a abertura escura por um instante; é o inverso do problema relatado, e menor.

## v2026.08.07-03

### Corrigido
- **Os botões de aprovar e excluir foto ficavam ativos durante o Desfazer.** No card, os ✕/↑/✓ ficam apagados e sem resposta enquanto a janela corre; no lightbox eles continuavam com cara de clicáveis. Agora seguem a mesma regra — e é a **mesma função** que trava os dois, para não voltarem a divergir. Relatado por [@antigerme](https://www.waze.com/user/editor/antigerme).

- **"Conexão instável" que não passava, e só o "Sair" resolvia.** Depois do deploy anterior — que invalidou as sessões existentes de propósito —, quem tinha sessão antiga via esse aviso a cada tentativa e ficava preso: a app achava que a sessão continuava válida e nunca oferecia a tela de entrar. Relatado por [@antigerme](https://www.waze.com/user/editor/antigerme).

  A causa não era a criptografia: a app decidia "sessão viva" pela **ausência** de um sinal de erro, e a resposta que diz "sua sessão não existe mais" não trazia esse sinal. Agora ela traz, e a app só considera a sessão viva quando a verificação **responde de verdade**. Oscilação de rede continua não derrubando ninguém — que era o defeito oposto, corrigido antes.

## v2026.08.07-01

### Corrigido
- **Na VM, a limpeza automática apagava as sessões boas.** Quem rodasse a app fora da Cloudflare via todo mundo ser deslogado a cada boot do servidor e a cada hora. A rotina que remove sessões abandonadas usava o mesmo critério para dois tipos de registro que guardam datas com significados opostos — a do pareamento é "vence em", a da sessão é "usada pela última vez em" —, e por isso julgava tudo como vencido. Não afetava quem usa a versão hospedada.

## v2026.08.06-07

### Melhorado
- **O que está guardado no servidor não abre sem o seu aparelho.** Antes, a chave que decifra os seus cookies era um segredo do servidor: quem tivesse esse segredo e uma cópia do banco lia tudo. Agora a chave é derivada do **token de sessão que fica no seu aparelho** — o servidor sozinho não decifra nada. Um vazamento do banco, um acesso indevido ou um pedido judicial devolvem blocos embaralhados que não servem para nada.

  Isso **não** protege contra quem publica código novo no servidor: essa pessoa pode registrar o seu token quando ele chega. A diferença é o alcance — deixa de ser "todos os editores, inclusive os de ontem" e passa a ser "quem usar a app enquanto esse código estiver no ar". A Ajuda foi atualizada para dizer exatamente isso, sem promessa a mais.

- **Sessão que não abre mais é apagada na hora.** As sessões criadas antes desta mudança não funcionam mais (você entra de novo, uma vez). Antes elas ficavam guardadas até vencer, ainda legíveis pelo servidor — o oposto do que a mudança acima promete. Agora, na primeira tentativa de uso, o registro é removido.

- **O QR do pareamento parou de vazar o segredo no endereço.** O link virava `.../?pair=CÓDIGO`, e endereço fica registrado no servidor — ou seja, a chave ia parar no log ao lado do dado que ela protege. Agora vai depois do `#`, que o navegador **não** envia. Links antigos continuam funcionando.

- **O código de 6 caracteres agora aparece só quando você pede.** No "Conectar outro aparelho" existe um botão **"Sem câmera? Mostrar um código"**. O motivo não é de tela: o segredo do QR tem 20 caracteres e o digitado tem 6, e é dele que sai a chave do pareamento. Se o curto existisse sempre, um vazamento traria a versão fraca ao lado da forte. Criado só sob demanda, ele existe por 5 minutos, para quem realmente não tem câmera.

  Quem entra pelo código **não fica com nada mais fraco**: no fim do pareamento os dois caminhos criam a mesma sessão, com a mesma proteção.

## v2026.08.06-06

### Melhorado
- **Aprovar virou um botão só, do tamanho da lixeira, e os dois ganharam cor.** Saiu a barra preta com o texto "esta foto ainda não está no mapa": o ✨ em cima da foto já dizia isso, e a barra custava 78px de foto — numa app cujo produto é a foto, é o troco errado. No lugar, um **✓ verde** no mesmo canto onde mora a **🗑 vermelha**, do mesmo tamanho. Nunca aparecem juntos: foto pendente se aprova, foto que já está no mapa se exclui.

  A cor não é só enfeite — **conserta um problema de leitura que já estava no ar**. Os botões eram um preto transparente, então a foto atravessava e num fundo claro o ícone branco quase sumia (2,85:1, abaixo do mínimo de 3:1 das normas de acessibilidade). Com a cor cheia o número não depende mais da foto: 4,83:1 no vermelho e 5,48:1 no verde. Cada botão ganhou também uma borda de dois tons, clara por dentro e escura por fora, pra não desaparecer sobre uma foto da mesma cor dele.

  E a dica "toque duplo amplia…" parou de ficar **cortada** pelo botão em tela estreita. Sugerido por [@antigerme](https://www.waze.com/user/editor/antigerme).

### Corrigido
- **Excluir logo depois de aprovar podia deixar a foto no mapa.** Se você aprovasse uma foto e mandasse excluí-la antes de a janela do Desfazer fechar, as duas ordens cruzavam e a foto acabava ficando — o contrário do que você pediu. Agora a aprovação é sempre enviada antes da exclusão.

## v2026.08.06-05

### Adicionado
- **Dá para aprovar uma foto nova sem sair da app.** Abra a foto do pedido e, se ela ainda não está no mapa, aparece **"Aprovar"** embaixo. Tocou, ela entra — o ✨ some na hora e o botão vira lixeira, porque a partir dali a foto está no mapa como qualquer outra. Pedido de um global champ, trazido pelo [@antigerme](https://www.waze.com/user/editor/antigerme).

  Vale **só para foto**, e o motivo é o que a decisão exige de você: uma foto ou serve ou não serve, e ela está inteira na sua tela. Nome, categoria, endereço e posição continuam sem "aprovar" na app — ali aprovar é escolher um valor, e quem tem campo para isso é o WME (o botão ↗ do card).

  Aparece para quem já podia excluir foto: **nível 6 com Area Manager**, ou staff do Waze. E é preciso ter **ampliado** a foto — não há atalho pelo card, justamente porque aprovar sem olhar não é aprovar.

  O **Desfazer** funciona igual ao do swipe: a foto só é enviada ao Waze quando a janela fecha sozinha, então dá tempo de voltar atrás. Quem desligou o Desfazer nas Preferências continua sem banner, e o envio sai na hora com o botão virando indicador de progresso. Aprovar **não conta no placar** — o placar é do que você triou, e a foto é uma decisão dentro do pedido.

## v2026.08.06-04

### Melhorado
- **Excluir foto agora é um toque só.** Acabou a pergunta "excluir esta foto?": tocou na lixeira, a foto sai. Você já abriu a foto, navegou até ela e mirou num alvo pequeno — perguntar de novo era desconfiar de você.

  No lugar entra o **Desfazer** que a app já usa no swipe: a foto some na hora e você tem alguns segundos para se arrepender. Ele **respeita a sua preferência** — quem desligou o Desfazer nas Preferências não vê banner nenhum e a exclusão vai direto, com a lixeira virando um indicador de progresso enquanto o Waze responde.

  E some o aviso "Foto excluída": a foto sumindo já é a confirmação. Ficam só os avisos que a tela não mostra sozinha — "outro editor já tinha excluído" e os erros.

## v2026.08.06-03

### Melhorado
- **Excluir foto ficou bem mais rápido e deixou de parecer travado.** Antes, ao confirmar, o diálogo fechava na hora e por alguns segundos nada indicava que a app estava trabalhando — parecia que tinha engasgado. Agora o diálogo fica com **"Excluindo…"** até o Waze responder, e só então fecha.

  E a espera encolheu de verdade: a app deixou de perguntar ao Waze quem é você a cada exclusão, e passou a **adiantar** a consulta ao local no instante em que você toca na lixeira — enquanto você lê a pergunta. Medido: o tempo depois do "Excluir" caiu de **727 ms para 3 ms**. Relatado por [@antigerme](https://www.waze.com/user/editor/antigerme).

## v2026.08.06-01

### Melhorado
- **O próximo pedido já vem pronto.** A app carrega o pedido seguinte **por inteiro** enquanto você olha o atual — foto, as outras fotos e o mapinha. Quando você passa o card, ele já está lá: sem caixa cinza esperando carregar.

  E dos **dois pedidos depois desse** ela adianta a primeira imagem. Assim, se você parar um pouco num pedido e depois passar três rápido, os três já têm imagem. **Isso não consome dados a mais** — eles seriam baixados de qualquer jeito quando chegassem na sua vez; a app só aproveita o tempo em que a conexão estaria parada.

  **Sem pesar nos seus dados**: esse carregamento antecipado tem prioridade baixa, então nunca atrasa o que está na sua tela agora; respeita o modo de economia de dados do aparelho; e para nas 4 primeiras fotos de cada pedido — as demais chegam quando você navegar até elas.

## v2026.08.05-04

### Interno
- **Ordem de carregamento do CSS invertida.** Mudança de bastidor, sem efeito visível: medido pixel a pixel em 150 telas (25 estados × 3 aparelhos × claro e escuro), **zero diferença**. Serve pra que ajustes de estilo da app parem de ser silenciosamente ignorados pelo framework — uma fonte recorrente de "arrumei e não pegou".

### Corrigido
- **Botão ✕ ficava quadrado ao receber foco.** O anel de foco sobrescrevia o formato do próprio botão. Aparecia ao abrir Filtros, Ajuda, a foto ampliada e o mapa ampliado pelo teclado.

## v2026.08.05-03

### Corrigido
- **Faixa vazia atravessando o mapa.** No celular, o mapa aparecia cortado por uma tira em branco, com o mapa continuando do outro lado — como se os pedaços não se encaixassem. Encaixam agora, no mapa do card e no ampliado. Relatado por [@antigerme](https://www.waze.com/user/editor/antigerme) com print do aparelho.

## v2026.08.05-02

### Adicionado
- **Lixeira na foto ampliada.** Abriu a foto e é lixo? Toca na lixeira, no canto de baixo, e ela sai do local. Pergunta uma vez antes — é a única ação da app que muda o mapa em si, e não tem desfazer.

  Aparece só para **editores nível 6 que são gerentes de área**, e só na foto que já está no mapa: a foto **proposta no pedido** (a do ✨) continua saindo pelo ✕ ou ✓ do card, que é o caminho dela.

  Antes de excluir, a app **relê as fotos do local no Waze**. O motivo é que o Waze não aceita "apague esta foto" — só "a lista de fotos agora é esta". Sem reler, excluir uma foto lixo apagaria junto qualquer foto que outro editor tivesse subido nesse meio-tempo, sem aviso nenhum.

## v2026.08.05-01

### Adicionado
- **Toque no mapa para ampliar.** Pedido dos testadores: agora dá para tocar no mapa do card e abrir em tela cheia, arrastando e dando zoom para ver o entorno — pinça, roda do mouse, duplo toque, e botões de + / − para quem prefere. Um botão volta ao enquadramento do pedido quando você se perder.

  **É mapa de verdade, não a mesma imagem esticada**: arrastar busca as áreas novas conforme você navega. Fecha pelo ✕, pelo Esc e pelo voltar do aparelho, como a foto ampliada.

## v2026.08.04-11

### Interno
- **O mapa passou a ser testado contra a queda do servidor de blocos do Waze.** Eles vêm de fora e não estão sob nosso controle; se um dia mudarem de endereço ou bloquearem, o card continua mostrando os marcadores, a linha do movimento e a escala — você perde o desenho das ruas, mas não a informação que o texto sozinho não dá.

## v2026.08.04-10

### Corrigido
- **O card seguinte agora chega pronto quando ele abre no mapa.** A app já adiantava a foto do próximo pedido, mas em **1 de cada 4** o primeiro slide é o mapa — e em **1 de cada 5** não há foto nenhuma, então não adiantava nada e você via a caixa cinza esperando. Agora ela adianta o que o próximo card vai mostrar de fato.

  Não gasta mais dados: os blocos do mapa seriam baixados de qualquer jeito quando o card chegasse. A fila é sequencial, então o "próximo" é literalmente o próximo que você vê.

## v2026.08.04-09

### Alterado
- **A foto de um local novo agora se identifica como proposta.** Quem usa leitor de tela ouve "Foto proposta junto com o local novo…", e quem passa o mouse lê a mesma coisa. Antes ela era descrita como uma foto qualquer.

  **Sem selo ✨ de propósito**: num local novo *todas* as fotos são novas — não existe local novo com foto que já esteja no mapa. O selo apareceria em todos esses cards e deixaria de significar algo justamente onde ele decide: no pedido de foto, onde aponta *uma* entre várias.

## v2026.08.04-07

### Corrigido
- **O mapa gasta menos dados no celular deitado.** Em tela deitada a área do mapa é mais larga que um bloco do mapa do Waze, e a app acabava baixando até **6 blocos** por card em vez de 2. Agora são **2,27 em média** (era 3,24), com o mesmo enquadramento. Em pé a economia também apareceu: 1,29 por card, contra 1,94.

### Interno
- Mais medição saiu da bancada e entrou no teste automático: o mapa agora é verificado contra os **51 pedidos reais de 6 países** (enquadramento, orçamento de blocos, zoom coerente, região), os **três formatos de foto** (paisagem, quadrada e retrato) e o **contraste do texto do mapa** nos 4 idiomas. Foi esse teste que achou o gasto extra em tela deitada.

## v2026.08.04-06

### Corrigido
- **A proporção da foto não decide mais o layout do card.** Foto de retrato — que é como celular fotografa — espremia o texto e fazia o card rolar por dentro, e quando isso acontece **arrastar pra cima rola em vez de pular**: o gesto morre.

  Medido com 51 pedidos reais de 6 países num celular dobrável:

  | foto | cards que não cabiam |
  |---|---|
  | paisagem 800×400 | 0 de 51 |
  | quadrada 512×512 | 20 de 51 |
  | retrato 1080×1920 | **31 de 51** |

  Valia para todo tipo de pedido e todo país. Passava despercebido porque o teste automático usava uma foto 800×400 — o único formato que nunca falha.

### Alterado
- **O teste automático passou a usar pedidos reais de seis países** (Brasil, França, Reino Unido, México, Espanha e Portugal) em vez de sete cards escritos à mão, todos brasileiros. Agora todo envio de código renderiza endereço britânico, nome francês e tipos de pedido que a fila brasileira não tem.

## v2026.08.04-05

### Adicionado
- **Mini-mapa em todos os cards.** Ele entra como mais um slide do carrossel da foto — dá pra ir e voltar entre a foto e o mapa nas setas ‹ ›. Não ocupa espaço a mais: quando o pedido não tem foto, o mapa toma o lugar do "Sem Imagem".

  Ele mostra **onde o pedido acontece**, com o mapa do próprio Waze: parques em verde, água em azul, prédios e os pontos conhecidos da vizinhança. Quando o pedido move o local, aparecem os dois pontos — **antes** em cinza e **depois** em verde — ligados por uma linha, com barra de escala. Pontos de entrada aparecem como quadradinhos: verde o que entra, vermelho o que sai.

  Isso resolve o que era impossível decidir olhando: `moveu 36 m` é exato e não diz nada — 36 metros pode ser acertar a porta ou jogar o local dentro do rio.

- **Aviso quando a posição proposta não cabe no mapa.** Existe de verdade: na fila de teste há pedidos propondo mover um local **82 km**. Antes o mapa mostraria um ponto só, calado. Agora avisa em vermelho, e a decisão é imediata.

### Alterado
- **Ponto de entrada agora mostra a DISTÂNCIA, não a coordenada.** Era `+ entrada -23.50382, -46.84458`; agora é `+ Entrada Av. José Salomé · entrada a 4 m do local`. A mediana real é 29 m — mas apareceram pedidos propondo entrada a **16 e 82 km** do próprio local, que em coordenada passavam batido.

## v2026.08.04-04

### Alterado
- **"Atualização de detalhes" e "Local marcado" seguem desmarcados por padrão** — agora por escolha de produto, não por limitação. A app é estilo Tinder: o ritmo do swipe funciona quando há o que **olhar**, e esses dois tipos costumam ser texto. Na fila de teste, os 5 tipos do padrão somam 178 cards com **66% de foto**; os dois de fora, 117 cards com **44%**.

  Eles continuam no filtro, com o mesmo nome do WME, a um toque de distância — e agora **cabem na tela**, o que antes não acontecia. Se você trabalha bastante esses pedidos, é só marcar uma vez: sua escolha fica salva.

## v2026.08.04-03

### Corrigido
- **Os cards de "Atualização de detalhes" e "Local marcado" voltaram a caber na tela**, e por isso voltam a vir **marcados** no filtro. Em celular dobrável e em tela deitada eles passavam a rolar por dentro — e quando isso acontece, arrastar pra cima *rola* em vez de *pular*, ou seja, o gesto morre. Medido em 117 pedidos reais desses dois tipos, em 4 aparelhos × 4 idiomas: **156 casos com problema viraram zero.**

### Alterado
- **Categoria e Endereço agora seguem o mesmo desenho de Tipo, Criador e Marca**: `RÓTULO: valor` numa linha. Eram as únicas duas linhas com ícone e rótulo empilhado — duas maneiras de mostrar a mesma coisa no mesmo card. Além de ficar mais consistente, **sobra mais espaço pra foto**: até +95px em celular comum, +47px no dobrável.
- **O motivo do reporte saiu de dentro da caixa rosa.** Em 15 de cada 17 reportes o usuário não escreve comentário nenhum — e a caixa existe pra segurar esse texto. Sem ele, sobrava só a moldura ocupando espaço. O motivo continua em destaque; a caixa agora só aparece quando há de fato o que ler.

## v2026.08.04-02

### Alterado
- **"Atualização de detalhes" e "Local marcado" agora vêm DESMARCADOS.** Esses dois pedidos às vezes chegam carregados de informação — diff longo, lista grande, comentário comprido — e o card deles ainda não cabe em tela pequena nesses casos. Enquanto isso não for acertado com calma, eles ficam de fora por padrão.

  **Continuam no filtro**, com o mesmo nome do WME e a um toque de distância: é só marcar em *Filtros* para vê-los. Quem já tinha marcado alguma coisa mantém a própria escolha — o padrão só vale para quem está começando.

## v2026.08.04-01

### Alterado
- **O filtro de tipos agora tem as mesmas 7 opções do WME.** Antes eram 3, e a terceira — "Reportes/Atualizações" — juntava coisas bem diferentes num balaio só. Agora dá pra separar:

  | antes | agora |
  |---|---|
  | Novos Locais | **Novo local** |
  | Novas Fotos | **Nova foto** |
  | Reportes/Atualizações | **Atualização de detalhes** · **Local marcado** · **Excluir local** · **Foto sinalizada** · **Excluir foto** |

  Na fila de teste isso separou 48 atualizações de detalhes, 17 locais marcados e 3 pedidos de exclusão que antes vinham misturados. Quem quer passar só nos reportes de local fechado/duplicado agora consegue.

  Os nomes são os **mesmos do WME**, nos 4 idiomas — se você conferir pelo ↗, vai ler a mesma palavra nos dois lugares. A ordem na tela é por assunto (local primeiro, foto depois), que é diferente da do WME: lá é alfabética pelo nome técnico, o que em português coloca "Excluir foto" antes de "Novo local".

## v2026.08.02-01

### Adicionado
- **O selo de origem passou a cobrir as quatro formas de enviar um pedido**, não só duas. Além de "pelo app" e "pelo site", agora existem **"pela ajuda"** (o pedido veio pelo formulário de Ajuda e comentários) e **"por voz"** (Assistente do Mapa, o alerta falado dentro do app). Antes esses dois apareciam em inglês, com o nome técnico do Waze. Passar o mouse (ou tocar e segurar) mostra a explicação completa, com a mesma redação que você lê no WME.

### Corrigido
- **Pedido com origem "não especificada" não desenha mais um selo vazio de sentido.** O próprio WME não mostra nada nesse caso; agora a app faz igual.

### Sobre "sumiu o selo de origem"
Se você reparou que "pelo app" e "pelo site" aparecem menos do que antes, **não é defeito**: o Waze só informa a origem nos pedidos de **alteração** de um local que já existe. Local novo e foto nova nunca vêm com essa informação — e a proporção de cada tipo na sua fila muda sozinha conforme o que os usuários enviam.

## v2026.08.01-06

### Adicionado
- **No computador, a seta para baixo fecha a foto ampliada.** No celular você já fechava arrastando pra baixo; quem aprendeu o gesto ali e sentou no laptop ia direto no ↓ e não acontecia nada. O Esc continua funcionando e continua sendo o caminho principal — a seta é atalho a mais, não substituto. Só para baixo, que é o único sentido que o arraste do toque tem.

## v2026.08.01-05

### Adicionado
- **Os serviços do local agora aparecem no seu idioma.** Antes saíam com o nome técnico: `AIR_CONDITIONING`, `PARKING_FOR_CUSTOMERS`. Agora: "Ambiente climatizado", "Estacionamento para clientes". São 23 serviços, nos 4 idiomas, com a redação do próprio Waze.

### Alterado
- **Os motivos de reporte passaram a usar a redação oficial do Waze nos 4 idiomas.** Eu havia traduzido alguns por conta e errei o sentido de um: `MOVED` era "mudança de endereço" em inglês, espanhol e francês, quando o Waze diz "o local se mudou" — coisas diferentes. Curiosamente, em português o Waze usa "Mudança de endereço" mesmo: as traduções dele não são literais entre si, então cada idioma agora usa a sua.

**A categoria continua saindo como o Waze a nomeia** — a decisão anterior não mudou. Serviço é comodidade genérica (ar-condicionado é ar-condicionado em qualquer lugar); categoria o Waze regionaliza por país, e o mesmo idioma diverge entre eles.

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
