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

export const PRAZO_PADRAO_DIAS = 30;

export const MIGRACOES = [
  {
    id: 'presenca-chave-bloqueio',
    desde: '2026-08-26',
    revisarEm: '2026-09-25',
    familia: 'aparelho',
    onde: 'js/presenca.js',
    oque: 'Apaga `waze_places_bloqueados` do aparelho na carga. O bloqueio de '
        + 'pessoa foi removido inteiro (v2026.08.22-08) e a chave guardava ids '
        + 'de PEERS — dado de terceiro, não sobra de configuração.',
    removerQuando: 'Nenhum aparelho puder mais ter a chave. Como o dado é de '
        + 'terceiro, isto NÃO é arrumação: enquanto houver dúvida, fica. O '
        + '`tools/smoke-presenca.mjs` cobra a ausência da chave, então remover '
        + 'esta linha exige mexer nele também — de propósito.',
  },
  {
    id: 'presenca-anistia-carimbo',
    desde: '2026-08-27',
    revisarEm: '2026-09-26',
    familia: 'aparelho',
    onde: 'js/app.js',
    oque: 'Carimba `presencaOffEm` em quem desligou a presença ANTES de a '
        + 'anistia de 9 dias existir. Sem o carimbo não há de quando contar.',
    removerQuando: 'Ninguém puder mais ter `presenca: false` sem '
        + '`presencaOffEm`. Cuidado: é um RAMO de `aplicarAnistiaDaPresenca`, '
        + 'não a função — os outros dois ramos são comportamento permanente e '
        + 'apagar a função mataria o recurso.',
  },
  {
    id: 'diag-formato-2',
    desde: '2026-09-10',
    revisarEm: '2026-12-10',
    familia: 'arquivo',
    onde: 'tools/diag-replay.mjs',
    oque: 'Remenda o `queue[0]` que saía como a string "[circular]" nos '
        + 'diagnósticos de formato < 3 — era sempre o card que a pessoa estava '
        + 'vendo.',
    removerQuando: 'Os diagnósticos antigos deixarem de interessar. **Não** '
        + 'expira por uso da app: arquivo recebido é ARQUIVO MORTO, fica no '
        + 'disco e no WhatsApp para sempre, e é justamente o que se usa pra '
        + 'comparar antes/depois. Prazo longo por isso, não por descuido.',
  },
];
