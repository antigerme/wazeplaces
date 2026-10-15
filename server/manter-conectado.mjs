// «Manter conectado» — a varredura que RENOVA o cookie do Waze de quem pediu.
//
// POR QUE EXISTE (MEDIDO): o Waze invalida o valor do `_web_session` ~24 h
// depois de renovado, se ninguém o renova. Quem renova é a RESPOSTA do Waze
// (cada uma traz um valor novo, que `refreshCookies` grava no máximo 1x/h), ou
// seja: só quando o editor USA o app. Quem passa mais de ~24 h sem abri-lo perde
// a sessão (`srv.err.cookiesExpired`) e refaz o pareamento. Reabrir sessão morta
// não é possível (testado: nem o WME real se reconecta). A única saída é
// renovar ANTES — e esta varredura faz isso, de ~6 em ~6 h, só para as sessões
// que ligaram «Manter conectado» (opt-in por sessão).
//
// PRIVACIDADE — o compromisso, que fica escrito e testado:
//   · a sessão NORMAL segue cifrada com HKDF(Secret, token): «Secret + dump do KV,
//     SEM o token, não abre nada» (test/core.test.mjs). Nada aqui muda isso;
//   · só as sessões COM «Manter conectado» ficam recuperáveis pelo servidor: a
//     entrada `ka_<sha256(token)>` guarda o TOKEN cifrado com uma chave derivada
//     SÓ do `ENCRYPTION_KEY` (HKDF com salt constante). Quem tiver o Secret e o
//     dump abre essas entradas, acha o token e abre a sessão correspondente.
//     É o preço de renovar sem o editor presente, e é opt-in, por sessão,
//     desligável a qualquer hora (o interruptor, o «Sair» e o 401 apagam a
//     entrada). `test/manter-conectado.test.mjs` prova os dois lados.
//
// COMO FUNCIONA
//   · O store (o MESMO das sessões) ganha o método OPCIONAL `list(prefixo)`: a
//     varredura lista as chaves `ka_…`. Sem `list`, ela não faz nada.
//   · A chave da sessão é `<hash>` e a da entrada é `ka_<hash>` — o MESMO hash.
//     Então dá pra saber se a sessão está devida lendo SÓ a sessão (o carimbo
//     dela é o prefixo do valor), sem decifrar nada. A entrada só é lida (e o
//     token só decifrado) para quem está devida.
//   · Devida = o carimbo da SESSÃO tem mais de `devidoApos` (5 h). Quem usa o
//     app o dia todo tem carimbo novo (o `refreshCookies` regrava de hora em
//     hora) e nunca é tocado: a varredura só trabalha por quem sumiu.
//   · Renovar = UMA leitura barata ao Waze (`Session`, a do `perfil`) pelo
//     `callWaze` COM contexto: o cookie novo da resposta é gravado pelo
//     `refreshCookies` (que respeita a trava de 1 h; como a devida passa de 5 h,
//     ela grava). Nenhuma gravação nossa além dessa.
//   · 401/403 do Waze = sessão morta: apaga a entrada e deixa a sessão vencer.
//     Rede/5xx: tenta na próxima execução, sem apagar. Sessão ausente: apaga a
//     entrada. Entrada com mais de 14 dias (`KA_TTL`) sem o editor reabrir o app
//     também sai — e é conferida pelo CARIMBO do valor, não pelo TTL do store: o
//     arquivo da VM renova o mtime a cada leitura, e a varredura lê.
//
// ORÇAMENTO (plano grátis do Cloudflare: 50 subrequisições por execução — KV
// conta — e 1.000 ESCRITAS de KV por dia, divididas com o uso normal do app)
//   por execução:  1 `list` (+1 por página de 1.000 chaves)
//                + até `examinar` (15) leituras de sessão, uma por entrada vista
//                + por sessão RENOVADA (até `lote` = 6): 1 leitura da entrada,
//                  1 `fetch` ao Waze, 1 leitura + 1 gravação do `refreshCookies`
//                = 1 + 15 + 6×4 = 40 no pior caso — sob o teto de 50. Escrita:
//                no máximo 6 por execução (a da sessão).
//   por dia:       cron de 30 min = 48 execuções × 6 = 288 renovações no teto.
//                Cada sessão mantida é renovada a cada ~5,5 h (5 h devida + até
//                30 min de espera da próxima execução) = ~4,4 gravações por dia,
//                então 288 renovações/dia cobrem ~65 pessoas — e o teto REAL é a
//                cota de ESCRITA do KV (1.000/dia, compartilhada com o app): ~220
//                pessoas sozinhas, bem menos com o uso normal somado. Pra mais
//                gente: subir `lote` (e conferir as 50 subrequisições) ou
//                encurtar o cron — e, passando de ~100 mantidas, pagar o plano.
//   CPU: cada sessão faz 2 HKDF e 3 AES (abrir a entrada, abrir a sessão,
//                regravar). O plano grátis dá ~10 ms de CPU por execução: se o
//                log do Worker mostrar «exceeded CPU», baixe `lote` (a conta
//                acima escala linear).
//
// RITMO: pausa ALEATÓRIA de 1,5 a 4 s entre sessões (regra do dono: quem varre
// usa jitter — rajada é a assinatura que faz um WAF marcar a conta, e a conta
// bloqueada seria a do editor) e teto de ~20 s de relógio por execução.
//
// Este módulo é PURO: nada de API de Node nem de `console` (o core também não
// tem). Quem o liga ao store, ao Waze e ao cron são os adaptadores, pelo
// `varrerMantidosDoStore` do core.

export const KA_PREFIXO = 'ka_';
export const KA_TTL = 14 * 24 * 3600;        // 14 dias: religa a cada abertura do app
export const KA_REGRAVA_APOS = 24 * 3600;    // não regrava a entrada à toa (escrita escassa)
export const MANTER_DEVIDO_APOS = 5 * 3600;  // sessão devida: carimbo com mais de 5 h
export const MANTER_LOTE = 6;                // renovações por execução
export const MANTER_EXAMINAR = 15;           // sessões LIDAS por execução (conta de leituras)
export const MANTER_TETO_MS = 20_000;        // relógio de uma execução
export const MANTER_ESPERA_WAZE_MS = 5_000;  // teto de UMA ida ao Waze (o `callWaze` padrão é 30 s)
export const PAUSA_MIN_MS = 1_500;
export const PAUSA_MAX_MS = 4_000;
export const MANTER_CRON_MIN = 30;           // de quanto em quanto tempo os adaptadores varrem

// A mesma faixa do `tools/waze-jitter.mjs` (fonte do dono), reescrita aqui porque
// aquele usa `node:timers/promises` e este módulo roda no Worker.
export function pausaPadrao() {
  const ms = Math.round(PAUSA_MIN_MS + Math.random() * (PAUSA_MAX_MS - PAUSA_MIN_MS));
  return new Promise((ok) => setTimeout(ok, ms));
}

function embaralharPadrao(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Uma execução da varredura. Nunca lança por causa de UMA sessão; devolve só
 * contagens (nenhum dado de pessoa) para o adaptador pôr no log.
 *
 *   store      o store das sessões (`get`/`delete`; `list` opcional)
 *   listar     (prefixo) => chaves `ka_…` (padrão: `store.list`)
 *   sessions   o `makeSessions` (`manterExaminar`, `renovarPrazo`)
 *   chamarWaze ({ token, region, cookies, sessions }) =>
 *              { resultado: 'ok'|'morta'|'falhou', rotacionou? } — o core liga
 *              isto ao `callWaze`; os testes põem um Waze de mentira
 *   agora      () => segundos-epoch   relogio () => ms (o teto de tempo)
 *   pausa      () => Promise          embaralhar (lista) => lista
 *
 * `vistas` = entradas examinadas · `renovadas` = Waze respondeu 200 ·
 * `mortas` = entrada apagada (sessão ausente/morta/estragada) · `adiadas` =
 * devidas que ficaram pra próxima (tempo esgotado, rede, 5xx) ·
 * `emDia` = ainda não devidas · `semRotacao` = 200 sem cookie novo (continua
 * devida) · `expiradas` = entrada com mais de 14 dias sem o app ser aberto.
 */
export async function varrerMantidos({
  store, listar, sessions, chamarWaze,
  agora = () => Math.floor(Date.now() / 1000),
  relogio = () => Date.now(),
  lote = MANTER_LOTE,
  examinar = MANTER_EXAMINAR,
  devidoApos = MANTER_DEVIDO_APOS,
  tetoMs = MANTER_TETO_MS,
  pausa = pausaPadrao,
  embaralhar = embaralharPadrao,
} = {}) {
  const resumo = { vistas: 0, renovadas: 0, mortas: 0, adiadas: 0, emDia: 0, semRotacao: 0, expiradas: 0 };
  const lista = typeof listar === 'function' ? listar : (store && typeof store.list === 'function' ? (p) => store.list(p) : null);
  if (!lista || !sessions || typeof chamarWaze !== 'function') return resumo;

  let chaves;
  try { chaves = await lista(KA_PREFIXO); } catch { return resumo; }
  if (!Array.isArray(chaves)) return resumo;
  chaves = embaralhar(chaves.filter((c) => typeof c === 'string' && c.startsWith(KA_PREFIXO) && c.length > KA_PREFIXO.length));

  const inicio = relogio();
  let renovando = 0;      // sessões que foram ao Waze nesta execução
  for (const chave of chaves) {
    if (resumo.vistas >= examinar || renovando >= lote) break;
    resumo.vistas++;
    let ex;
    try { ex = await sessions.manterExaminar(chave, { agora: agora(), devidoApos }); } catch { resumo.adiadas++; continue; }

    if (ex.estado === 'emDia') { resumo.emDia++; continue; }
    if (ex.estado !== 'devida') {
      // Sem sessão, entrada que não abre ou vencida: não há o que renovar.
      if (ex.estado === 'vencida') resumo.expiradas++; else resumo.mortas++;
      try { await store.delete(chave); } catch { /* a próxima execução tenta */ }
      continue;
    }

    // Devida. O tempo: a pausa mais longa que pode vir ainda tem que caber.
    if (renovando > 0 && relogio() - inicio + PAUSA_MAX_MS > tetoMs) { resumo.adiadas++; break; }
    if (renovando > 0) { try { await pausa(); } catch { /* a pausa nunca derruba a varredura */ } }
    renovando++;

    let r;
    try {
      r = await chamarWaze({ token: ex.token, region: ex.region, cookies: ex.cookies, sessions });
    } catch {
      r = { resultado: 'falhou' };
    }
    if (r.resultado === 'ok') {
      resumo.renovadas++;
      if (r.rotacionou === false) resumo.semRotacao++;
      // Sem cookie novo o `refreshCookies` não gravou; o prazo do app segue
      // deslizante (no máximo uma escrita por dia, e sem custo se já está em dia).
      try { await sessions.renovarPrazo(ex.token); } catch { /* melhor-esforço */ }
    } else if (r.resultado === 'morta') {
      resumo.mortas++;
      try { await store.delete(chave); } catch { /* a próxima execução tenta */ }
    } else {
      resumo.adiadas++;
    }
  }
  return resumo;
}
