// FONTE ÚNICA dos países de validação. Instrução permanente do owner.
//
// Script que meça QUALQUER COISA — dado do Waze, layout de card, tradução —
// importa daqui. Não copie a lista; copiar é como ela volta a ser só o Brasil
// na próxima sessão, que é exatamente o que esta lista existe pra impedir.
// Mesmo padrão do `waze-jitter.mjs`: a regra não pode depender da minha
// memória, então ela mora num arquivo que o teste cobra.
//
// ── POR QUE ISTO EXISTE, com número ──────────────────────────────────────
// A auditoria de layout rodava só com a fila brasileira e dava ZERO problema
// em 1872 renders. Refeita com 12 países, achou 26 pedidos que não cabem no
// Galaxy Fold — 17 deles do tipo `FLAGGED_PHOTO`, do qual a fila do Brasil
// não tem NENHUM. Um recurso inteiro passou por "sem problema" porque o dado
// que o quebra não existe no país onde eu media.
//
// É a mesma família do gotcha #25 (a string mais larga quase nunca está no
// idioma em que você desenvolve), agora valendo pro DADO e não só pro texto.
//
// ── COMO USAR ────────────────────────────────────────────────────────────
// O owner VÊ os PURs de fora mesmo sem poder editar lá. Como
// `buildPlacesFromSearch` (com razão) descarta venue sem permissão, a fixture
// de teste força `permissions: -1` antes de expandir — maquiagem de FIXTURE,
// nunca da app: o filtro de permissão segue valendo em produção, e é o
// `test/core.test.mjs` que cobre isso.

// Os SEIS que nunca faltam. Lista fechada pelo owner; tirar um é decisão dele.
export const PAISES_OBRIGATORIOS = Object.freeze([
  // Brasil primeiro porque é a fila que o owner tria todo dia.
  { nome: 'Brasil', id: 30, abbr: 'BR', porque: 'país do owner' },
  // Francês é o idioma que mais estoura layout neste projeto (gotcha #25).
  { nome: 'França', id: 73, abbr: 'FR', porque: 'idioma que mais estoura layout' },
  // Endereço britânico não se parece com nenhum dos outros.
  { nome: 'Reino Unido', id: 234, abbr: 'UK', porque: 'formato de endereço distinto' },
  { nome: 'México', id: 145, abbr: 'MX', porque: 'fila grande, espanhol americano' },
  { nome: 'Espanha', id: 203, abbr: 'SP', porque: 'espanhol europeu, muita foto' },
  // Portugal é o caso que derruba tabela de tradução por idioma: mesmo idioma
  // do Brasil, vocabulário diferente (`ônibus` × `autocarro`) — é o argumento
  // do owner que manteve CATEGORIA sem tradução (gotcha #39/#46).
  { nome: 'Portugal', id: 181, abbr: 'PO', porque: 'português NÃO-brasileiro' },
]);

// Complemento opcional: mais alfabeto, mais tamanho de nome, mais formato de
// endereço. Entra quando a medição comporta; sair daqui não reprova nada.
export const PAISES_EXTRAS = Object.freeze([
  { nome: 'Itália', id: 107, abbr: 'IT' },
  { nome: 'Alemanha', id: 81, abbr: 'DE' },
  { nome: 'Polônia', id: 180, abbr: 'PL' },
  { nome: 'Argentina', id: 10, abbr: 'AR' },
  { nome: 'Indonésia', id: 102, abbr: 'ID' },
  { nome: 'Filipinas', id: 178, abbr: 'PH' },
  { nome: 'Chile', id: 44, abbr: 'CL' },
]);

// Todos na região `row` — nenhum é `na` (Américas do Norte) nem `il`.
export const REGIAO_DOS_PAISES = 'row';

export const PAISES_VALIDACAO = Object.freeze([...PAISES_OBRIGATORIOS, ...PAISES_EXTRAS]);
