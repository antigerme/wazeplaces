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
// A ÉPOCA IMPORTA: a app não está em produção — todos são testadores e podem
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
        + 'expira por uso da app, e é por isso que ele sobreviveu à limpeza de '
        + '2026-09-10: "todos são testadores e podem zerar o app" vale pra '
        + 'APARELHO, e um arquivo já enviado não se zera — ele está no disco e '
        + 'no WhatsApp, e é justamente o que se usa pra comparar antes/depois. '
        + 'Tirar isto hoje quebraria o replay do arquivo que o owner mandou '
        + 'hoje de manhã.',
  },
];
