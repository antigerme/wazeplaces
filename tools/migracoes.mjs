// FONTE ÚNICA do código que existe só por causa de uma versão ANTERIOR.
//
// Por que isto existe: código de compatibilidade não avisa quando fica
// desnecessário. Ele fica, ninguém lembra por que, e — pior — o CLAUDE.md
// chegou a prometer uma tolerância a sufixo `.php` no `dispatch` que já tinha
// sido removida do código. Doc que promete o que não existe é pior que código
// morto: o código morto não engana ninguém.
//
// COMO FUNCIONA, e é nos DOIS sentidos:
//   1. No código vai um marcador `// MIGRACAO: <id>` colado no trecho.
//   2. Aqui vai a entrada com a data e — o que decide — a CONDIÇÃO de remoção.
//   3. `test/migracoes.test.mjs` cobra os dois lados: entrada sem marcador
//      reprova (foi removido e o registro mentiu), marcador sem entrada reprova
//      (nasceu sem data). É exato, sem heurística: nada de varrer comentário
//      atrás da palavra "legado", que geraria falso positivo — e falso positivo
//      treina todo mundo a ignorar a seção, que é como ela morre.
//
// O PRAZO NÃO APAGA NADA. Passou de `revisarEm`, o teste REPROVA e mostra a
// condição, pra um humano responder "ainda é preciso?". Deleção automática não
// serve aqui por duas razões medidas: (a) migração quase nunca é um arquivo, é
// um RAMO dentro de código vivo — dos 3 candidatos levantados em 2026-09-10, só
// UM era uma linha deletável, e outro (`initUndoGateSeen`) nem migração era,
// porque todo aparelho NOVO precisa dele; (b) relógio não sabe se ainda existe
// dado no formato antigo, que é a única pergunta que importa.
//
// Decidiu manter? Empurre o `revisarEm` — ato deliberado e datado, não um
// silêncio. Decidiu remover? Tire o marcador do código e a entrada daqui.
//
// A ÉPOCA IMPORTA: o app não está em produção — todos são testadores e podem
// zerar o app se preciso (decisão do owner, 2026-09-10). Isso encurta o prazo,
// porque a cauda de quem some deixa de custar. O precedente já estava no código
// antes de virar regra: o `loadSession` DESCARTA sessão no formato anterior em
// vez de carregar compatibilidade, com esta mesma justificativa escrita.
// Quando houver base de verdade, esta nota some e os prazos sobem.
//
// EXERCIDA em 2026-09-10, a pedido do owner ("limpe todo o legado agora"),
// com as duas entradas de família `aparelho` — que tinham 14 e 15 dias, bem
// abaixo dos 30. Saíram: a limpeza de `waze_places_bloqueados` e o carimbo
// legado da anistia. A de família `arquivo` FICOU, e a razão é a que separa
// as famílias: aparelho se zera, arquivo enviado não.

export const PRAZO_PADRAO_DIAS = 30;

export const MIGRACOES = [
  {
    id: 'regiao-world',
    desde: '2026-09-25',
    revisarEm: '2026-10-25',
    familia: 'aparelho',
    onde: 'server/core.mjs',
    oque: 'A região `world` virando `na`: no `requireRegion` do core (pedido de '
        + 'cliente antigo), no `getRegion` do api.js (a escolha guardada no '
        + 'aparelho) e no cartão da conversa do presenca.js (mandado por versão '
        + 'anterior). `world` era a 4ª opção do filtro e sempre apontou pro '
        + 'servidor da América do Norte (`/Descartes/`); a opção `na` apontava pra '
        + '`na-Descartes`, que NÃO EXISTE (medido: 404 em tudo). A v2026.09.25-03 '
        + 'corrigiu o `na` e tirou o `world` do seletor.',
    removerQuando: 'Todo aparelho de testador tiver aberto a versão nova (o '
        + '`getRegion` regrava `na` na primeira leitura) e o cache do service '
        + 'worker da versão anterior tiver saído de circulação. O cartão da '
        + 'conversa é o único resíduo que dura mais: cartão antigo no histórico do '
        + 'chat abre com a região `row` se a linha sair, o que só erra o link do WME.',
  },
  {
    id: 'historico-onde',
    desde: '2026-09-14',
    revisarEm: '2027-10-20',
    familia: 'compat',
    onde: 'js/app.js',
    oque: 'O `|| {}` no `v.onde` de cada balde diário, no `geografiaDoHistorico`. '
        + 'A partir de v2026.09.14-04 o `recordHistory` grava ONDE o trabalho foi '
        + 'feito (`pais` ou `pais:estado`), que é o dado de "Andarilho" e "Viajante" '
        + '— e o mesmo que tirou o "onde" do Resumo do mês. Balde gravado '
        + 'ANTES disso não tem o campo, e não existe como descobrir onde '
        + 'aquele trabalho foi feito: ele simplesmente não conta.',
    removerQuando: 'A poda de `HISTORY_MAX_DIAS` (400 dias, feita no `loadHistory`) '
        + 'tiver levado o último balde sem `onde`: os de até 2026-09-14 saem em '
        + '2027-10-19. **A entrada nasceu ERRADA**, como `aparelho`, com revisão em '
        + '30 dias e a condição "todo aparelho abriu o app depois da versão nova". '
        + 'Abrir o app não apaga balde velho: ele fica guardado até a poda. E sem o '
        + '`|| {}` o `geografiaDoHistorico` lança dentro do `checarConquistas`, que '
        + 'roda a cada ação confirmada, no Desfazer e na fila zerada: seguir a '
        + 'entrada antiga em outubro de 2026 quebraria as conquistas de todo '
        + 'testador com histórico de antes de 14/09. Todo balde novo já nasce com '
        + '`onde` (toda gravação é de uma ação, e o país do filtro tem padrão 30), '
        + 'então depois da poda o campo pode ser exigido. Antecipar, só se todo '
        + 'testador usar o "Sair", que apaga o histórico.',
  },
  {
    id: 'diag-formato-2',
    desde: '2026-09-10',
    revisarEm: '2026-12-10',
    familia: 'arquivo',
    onde: 'tools/diag-replay.mjs',
    oque: 'Remenda o `queue[0]` que saía como a string "[circular]" — era '
        + 'sempre o card que a pessoa estava vendo. **A entrada nasceu ERRADA '
        + 'dizendo "formato < 3"**: o `currentPlaceIdx` que consertou isso '
        + 'entrou em v2026.09.10-02 SEM bumpar o `DIAG_FORMATO`, então há '
        + 'arquivo de formato 3 que precisa do remendo do mesmo jeito. MEDIDO '
        + 'nos 7 diagnósticos guardados: 3 precisam, e DOIS deles são formato '
        + '3 — inclusive o mais recente do owner, com 395 pedidos.',
    removerQuando: 'Os diagnósticos guardados deixarem de interessar. **Não** '
        + 'expira por uso do app, e é por isso que ele sobreviveu à limpeza de '
        + '2026-09-10: "todos são testadores e podem zerar o app" vale pra '
        + 'APARELHO, e um arquivo já enviado não se zera — ele está no disco e '
        + 'no WhatsApp, e é justamente o que se usa pra comparar antes/depois. '
        + 'Tirar isto hoje quebraria o replay do arquivo que o owner mandou '
        + 'hoje de manhã.',
  },
  {
    id: 'fila-guardada-desde',
    desde: '2026-09-22',
    revisarEm: '2026-10-22',
    familia: 'aparelho',
    onde: 'js/app.js',
    oque: 'O `: guardada.t` no `offlineTentarAbrirSemRede`. A partir de '
        + 'v2026.09.22-06 a fila guardada do offline leva `desde` — o instante '
        + 'em que a LISTA foi tirada —, e é contra ele que os pousos filtram a '
        + 'reabertura sem rede (o pedido tratado com rede depois da foto não '
        + 'volta como card). Fila guardada ANTES disso não tem o campo, e o '
        + 'mais perto que se sabe é a hora em que ela foi gravada.',
    removerQuando: 'Toda fila guardada tiver sido regravada por '
        + 'v2026.09.22-06 ou depois — o que acontece na primeira busca ou '
        + 'varredura COM rede, ou seja no primeiro uso com sinal. Passou do '
        + 'prazo? Some com o `: guardada.t` e deixe `desde` ser exigido: sem '
        + 'ele o filtro usa 0 e tira TODO pouso gravado, que é o lado seguro '
        + '(esconder o que foi decidido, nunca mostrá-lo de novo).',
  },
];
