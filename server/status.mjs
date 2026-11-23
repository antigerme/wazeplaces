// server/status.mjs — Estatísticas PÚBLICAS de uso (a página /status.html).
//
// PURO (zero API de Node), como manter-conectado.mjs e marca-app.mjs: só CONTA
// chaves que já existem no store de sessão — nunca decifra, nunca lê o VALOR
// de uma entrada. "Secret + dump do KV, SEM o token, não abre nada"
// (test/core.test.mjs) continua valendo inteiro: isto não lê segredo nenhum.
//
// O QUE CONTA, por FORMA — positivo, nunca por exclusão. Excluir prefixo a
// prefixo (pair_, reler_…) deixaria um prefixo FUTURO cair no balde errado
// (contado como sessão, calado); casar pela forma exata das duas únicas
// chaves que isto conta deixa qualquer coisa nova de fora por padrão:
//   · sessão normal:        64 hex minúsculo (sha256 do token, sem prefixo)
//   · «Manter conectado»:   ka_ + 64 hex minúsculo
// `pair_…`, `reler_…` e `reler_toque_…` (e qualquer prefixo futuro) não casam
// com nenhum dos dois — ficam de fora das duas contagens, de propósito.
const EH_SESSAO = /^[0-9a-f]{64}$/;
const EH_MANTER = /^ka_[0-9a-f]{64}$/;

// A tendência de 90 dias (decisão do owner, 2026-11-21 — o mockup aprovado
// mostrava 30; o "Resumo do mês" já cobre 1 mês de detalhe por dia, isto é só
// a contagem agregada, sem dado de pessoa, então o custo de guardar mais dias
// é irrisório: 90 baldes pequenos no blob, nada por sessão).
export const STATUS_HISTORICO_DIAS = 90;

// Teto do "atualizado há": achado medindo em produção (2026-11-23) — com a
// contagem estável por horas (madrugada, comunidade pequena), `atualizadoEm`
// ficava congelado na última vez que o número MUDOU, enquanto `agora` seguia
// andando (`atualizado há 413 min` ao lado do selo "dados ao vivo"). Mesmo
// sintoma de um cron MORTO — a página não distinguia os dois. Por isso
// `calcularStatusPublico` agora também marca `mudou=true` quando faz mais de
// STATUS_ATUALIZACAO_MAX_MIN desde a última gravação, mesmo sem mudança de
// contagem: o adaptador grava de novo, só pra provar que a varredura rodou.
// Custo: no máximo 1 escrita extra a cada STATUS_ATUALIZACAO_MAX_MIN (6/dia
// com 240 min), longe da cota de 1.000/dia (18 entradas «Manter conectado»
// hoje, teto medido de 80-125 — ver server/manter-conectado.mjs). Escolhido
// 4h (câmbio entre custo e provar vida): revise se a comunidade crescer perto
// do teto medido.
export const STATUS_ATUALIZACAO_MAX_MIN = 240;

// Conta as chaves BRUTAS do store (como `store.list('')` devolve: sem o
// prefixo de arquivo/KV, mas com os prefixos lógicos como `ka_`).
export function contarChaves(chaves) {
  let sessoesAtivas = 0;
  let manterConectado = 0;
  for (const c of Array.isArray(chaves) ? chaves : []) {
    if (typeof c !== 'string') continue;
    if (EH_MANTER.test(c)) manterConectado++;
    else if (EH_SESSAO.test(c)) sessoesAtivas++;
  }
  return { sessoesAtivas, manterConectado };
}

// 'YYYY-MM-DD' em UTC — nem o fuso do visitante, nem o do servidor: um dia
// civil fixo, pra o balde de hoje ser o MESMO em qualquer fuso que rodar o
// adaptador (a VM pode estar em qualquer lugar; o Worker roda na borda).
export function diaChaveUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Funde a contagem de HOJE no histórico (array por dia, mais antigo primeiro):
// substitui o balde do mesmo dia se já existir (duas execuções no mesmo dia
// não duplicam) e PODA o que passou de `maxDias`. PURA: devolve array novo,
// nunca muta o recebido — a mesma disciplina do `atualizarHistorico` que o
// Histórico do app já segue (ver AppState.history em app.js).
export function atualizarHistorico(historicoAnterior, dia, contagem, { maxDias = STATUS_HISTORICO_DIAS } = {}) {
  const lista = Array.isArray(historicoAnterior) ? historicoAnterior.filter((b) => b && typeof b.dia === 'string') : [];
  const sem = lista.filter((b) => b.dia !== dia);
  const novo = [...sem, { dia, sessoesAtivas: contagem.sessoesAtivas, manterConectado: contagem.manterConectado }];
  novo.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
  return novo.slice(-Math.max(1, maxDias));
}

/**
 * Uma execução da contagem — chamada pelo MESMO cron do «Manter conectado»,
 * mas DEPOIS dele terminar (nunca em paralelo: a contagem usa `list`, que já
 * está no orçamento de subrequisições da varredura — ver o comentário de
 * orçamento em manter-conectado.mjs). Nunca lança: falha ao listar mantém o
 * que já havia (`mudou: false`), nunca apaga o status por uma falha passageira
 * do store.
 *
 *   listar    (prefixo) => chaves, como o store das sessões (`store.list`)
 *   agoraMs   () => epoch ms — o relógio do SERVIDOR (a página usa este
 *             carimbo pra "atualizado há…", nunca o relógio do visitante)
 *   anterior  o blob já gravado (ou null, no primeiro boot)
 *
 * Devolve `{ blob, mudou }`. `mudou` é falso quando a contagem E o histórico
 * são EXATAMENTE os de antes E a última gravação é recente (dentro de
 * STATUS_ATUALIZACAO_MAX_MIN) — só então o adaptador pula a gravação (o KV
 * tem cota de escrita, 1.000/dia, dividida com o app e com o «Manter
 * conectado»). Depois de STATUS_ATUALIZACAO_MAX_MIN sem gravar, `mudou` vira
 * true mesmo com a contagem igual: é o "heartbeat" que prova que a varredura
 * rodou, não só que o número mudou (ver o comentário da constante).
 */
export async function calcularStatusPublico({ listar, agoraMs = () => Date.now(), anterior = null } = {}) {
  const agora = typeof agoraMs === 'function' ? agoraMs() : agoraMs;
  let chaves;
  try { chaves = typeof listar === 'function' ? await listar('') : null; } catch { chaves = null; }
  if (!Array.isArray(chaves)) {
    return { blob: anterior || { atualizadoEm: agora, sessoesAtivas: 0, manterConectado: 0, historico: [] }, mudou: false };
  }
  const contagem = contarChaves(chaves);
  const dia = diaChaveUTC(agora);
  const historico = atualizarHistorico(anterior && anterior.historico, dia, contagem);
  const blob = { atualizadoEm: agora, ...contagem, historico };
  const conteudoMudou = !anterior
    || anterior.sessoesAtivas !== contagem.sessoesAtivas
    || anterior.manterConectado !== contagem.manterConectado
    || JSON.stringify(anterior.historico || []) !== JSON.stringify(historico);
  // Sem carimbo anterior LEGÍVEL (blob de formato antigo, ou nenhum): idade
  // infinita — força o heartbeat e se autocura, sem lançar.
  const idadeMs = anterior && Number.isFinite(anterior.atualizadoEm) ? agora - anterior.atualizadoEm : Infinity;
  const mudou = conteudoMudou || idadeMs >= STATUS_ATUALIZACAO_MAX_MIN * 60000;
  return { blob, mudou };
}
