// «Manter conectado» — a varredura que RENOVA o cookie do Waze de quem pediu.
//
// POR QUE EXISTE (MEDIDO): o Waze invalida o valor do `_web_session` ~24 h
// depois de renovado, se ninguém o renova. Quem renova é a RESPOSTA do Waze
// (cada uma traz um valor novo, que `refreshCookies` grava no máximo 1x/h), ou
// seja: só quando o editor USA o app. Quem passa mais de ~24 h sem abri-lo perde
// a sessão (`srv.err.cookiesExpired`) e refaz o pareamento. Reabrir sessão morta
// não é possível (testado: nem o WME real se reconecta). A única saída é
// renovar ANTES — e esta varredura faz isso, de ~10 em ~10 h, só para as sessões
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
//   · Devida = o carimbo da SESSÃO tem mais de `devidoApos` (10 h). Quem usa o
//     app o dia todo tem carimbo novo (o `refreshCookies` regrava de hora em
//     hora) e nunca é tocado: a varredura só trabalha por quem sumiu.
//   · Renovar = UMA leitura barata ao Waze (`Session`, a do `perfil`) pelo
//     `callWaze` COM contexto: o cookie novo da resposta é gravado pelo
//     `refreshCookies` (que respeita a trava de 1 h; como a devida passa de 10 h,
//     ela grava). Nenhuma gravação nossa além dessa.
//   · 401/403 do Waze numa sessão com menos de 20 h (`MANTER_MORTA_APOS`): não é «o cookie
//     morreu de velho»; fica pra próxima execução, sem apagar (R26-2-02).
//   · 401/403 do Waze: CONFIRMA uma vez (outra pausa e outro `Session`); só a
//     2ª negativa apaga a entrada e deixa a sessão vencer (gotcha #42: 401
//     isolado pode ser alarme falso). Rede/5xx: tenta na próxima execução, sem apagar. Sessão ausente: apaga a
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
//                + 1 `fetch` de confirmação por sessão que levou 401/403
//                = 1 + 15 + 6×5 = 46 no pior caso — sob o teto de 50 —, MAIS 1 apagamento
//                por entrada morta/vencida vista na frente (medido: 9 mortas na frente
//                de 6 devidas com 403 e depois 200 = 53–55 operações; a que passa de 50
//                lança dentro de um `try` e vira «adiada», sem perda). Se as operações
//                de KV de fato contam nas 50 é premissa NÃO verificada no Cloudflare.
//                Escrita: no máximo 6 por execução (a da sessão) + a regravação diária
//                da entrada de quem abre o app (`manterLigar`).
//   por dia:       cron de 30 min = 48 execuções × 6 = 288 renovações no teto.
//                Cada sessão mantida é VISITADA a cada K execuções (a fatia da vez, K =
//                ceil(n / 10): 10 com 100 pessoas = 5 h) e renovada na visita em que
//                está devida (10 h): ~2 gravações por dia. MEDIDO (simulação do cron por
//                8 dias, carimbos iniciais espalhados, teto de 20 s, Waze a 0,4–1,2 s por ida):
//                com a população PARADA, 100 pessoas → 0 mortes em 2.500 sessões (maior idade 20 h);
//                110 → 0 (21 h); 125 → 0 (23 h); 140 → 0 (24 h); 160 → 4 %; 200 → 57–83 %. Com
//                ROTATIVIDADE a margem some (R27-1-03): cada pessoa que entra ou sai desloca as posições
//                e re-fase as fatias, e as sessões já mortas ocupam vaga do lote; com 100 vivas e ~5
//                trocas por dia, ~1 % das sessões passam de 24 h, e com 125 e uma troca a cada ~5
//                execuções, ~10 mortes em 4 dias (workerd, R26-2). Por isso a promessa é «~80 com
//                folga, ~100 se a lista for estável»; acima disso o desenho tem que mudar (examinar
//                TODAS e renovar as de carimbo mais antigo primeiro; pede o carimbo de cada uma sem
//                uma leitura por pessoa, p. ex. como `metadata` do `put`). O gargalo MEDIDO é a própria
//                varredura (lote de 6 dentro do teto de 20 s: ~5 renovações por execução); a cota de
//                ESCRITA do KV (1.000/dia, dividida com o app) é o limite seguinte, não medido aqui.
//                O prazo de 10 h (e não 5) é escolha de capacidade: o Waze só invalida o valor
//                depois de ~24 h (MEDIDO: 24 a 26 h), então sobram ~13 h de folga pra um Waze
//                fora do ar ou uma execução perdida. O «carimbo» da sessão é a hora da última
//                GRAVAÇÃO, não a idade exata do valor do cookie: o `renovarPrazo` regrava o mesmo
//                blob com `agora − 1 h` (R27-1-01), então uma sessão que um 401 visitou parece mais
//                jovem do que é; o guard de 20 h é a favor da entrada (ela fica uma ou duas visitas a
//                mais). Pra mais gente: Workers Paid e/ou o desenho por urgência. O cron TEM que ser
//                `*/<MANTER_CRON_MIN>` (a fatia usa o número da execução); encurtá-lo pede mudar as
//                duas coisas (`test/manter-conectado-servidor.test.mjs` amarra o wrangler.jsonc).
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
export const MANTER_DEVIDO_APOS = 10 * 3600; // sessão devida: carimbo com mais de 10 h
export const MANTER_LOTE = 6;                // renovações por execução
export const MANTER_EXAMINAR = 15;           // sessões LIDAS por execução (conta de leituras)
export const MANTER_TETO_MS = 20_000;        // relógio de uma execução
export const MANTER_ESPERA_WAZE_MS = 5_000;  // teto de UMA ida ao Waze (o `callWaze` padrão é 30 s)
export const PAUSA_MIN_MS = 1_500;
export const PAUSA_MAX_MS = 4_000;
export const MANTER_MORTA_APOS = 20 * 3600;  // 403/401 só vale como «morta» com o carimbo da sessão tão velho (o valor morre em 24–26 h)
export const MANTER_CRON_MIN = 30;           // de quanto em quanto tempo os adaptadores varrem

// A mesma faixa do `tools/waze-jitter.mjs` (fonte do dono), reescrita aqui porque
// aquele usa `node:timers/promises` e este módulo roda no Worker.
export function pausaPadrao() {
  const ms = Math.round(PAUSA_MIN_MS + Math.random() * (PAUSA_MAX_MS - PAUSA_MIN_MS));
  return new Promise((ok) => setTimeout(ok, ms));
}

// A FATIA DA VEZ (R25-6-01, refeita na R26-1). O sorteio puro de `examinar` entradas por execução deixava sessões
// devidas sem ser vistas: MEDIDO por simulação do cron de 30 min por 8 dias, com 100 pessoas ausentes 11 % passavam de
// 24 h e com 125, 23 %. Agora cada execução olha UMA fatia da lista ORDENADA: `K = ceil(n / ALVO_DA_FATIA)` e a fatia da
// vez é `execução % K` (o número da execução de 30 min); a entrada de posição `i` está na fatia `i % K`. Toda entrada é visitada a cada K execuções (K = 13 com
// 125 pessoas = 6,5 h), sem estado e sem escrita extra, e as fatias têm tamanho IGUAL (±1). A primeira versão escolhia
// pela hash da chave: fatias de tamanho binomial (média 10, desvio ~3, as de 15–20 medidas), e o excedente que o lote de 6
// ou o teto de 20 s empurrava pra visita seguinte (6,5 h depois) passava de 24 h — 3–8 % de mortes a partir de 100 pessoas
// numa simulação com carimbos iniciais espalhados (R26-1-01). Pela posição o resultado medido é 0 % até ~110 e < 1 % com
// 125. O preço: quando uma pessoa entra ou sai, as posições depois dela deslocam (um intervalo a mais ou a menos numa ou
// noutra entrada); com ~1–2 entradas por dia isso custa menos que a variância da hash. Dentro da fatia ainda se embaralha
// (a que passa de `examinar` não corta sempre as mesmas).
export const MANTER_ALVO_DA_FATIA = 10;       // entradas por execução, em média (o teto é `examinar` = 15)

export function fatiaDaVez(chaves, agoraSeg, { alvo = MANTER_ALVO_DA_FATIA, cronMin = MANTER_CRON_MIN } = {}) {
  const k = Math.max(1, Math.ceil(chaves.length / Math.max(1, alvo)));
  if (k === 1) return [...chaves];
  const execucao = Math.floor(agoraSeg / (cronMin * 60));
  const fatia = execucao % k;
  return [...chaves].sort().filter((_, i) => i % k === fatia);
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
 * `confirmadas` = segundas idas depois de um 401/403 (só apaga se a 2ª também
 * for 401/403) · `emDia` = ainda não devidas · `semRotacao` = 200 sem cookie novo (continua
 * devida) · `expiradas` = entrada com mais de 14 dias sem o app ser aberto.
 */
export async function varrerMantidos({
  store, listar, sessions, chamarWaze,
  agora = () => Math.floor(Date.now() / 1000),
  relogio = () => Date.now(),
  lote = MANTER_LOTE,
  examinar = MANTER_EXAMINAR,
  devidoApos = MANTER_DEVIDO_APOS,
  mortaApos = MANTER_MORTA_APOS,
  tetoMs = MANTER_TETO_MS,
  pausa = pausaPadrao,
  embaralhar = null,
} = {}) {
  const resumo = { vistas: 0, renovadas: 0, mortas: 0, adiadas: 0, emDia: 0, semRotacao: 0, expiradas: 0, confirmadas: 0 };
  const lista = typeof listar === 'function' ? listar : (store && typeof store.list === 'function' ? (p) => store.list(p) : null);
  if (!lista || !sessions || typeof chamarWaze !== 'function') return resumo;

  let chaves;
  try { chaves = await lista(KA_PREFIXO); } catch { return resumo; }
  if (!Array.isArray(chaves)) return resumo;
  chaves = chaves.filter((c) => typeof c === 'string' && c.startsWith(KA_PREFIXO) && c.length > KA_PREFIXO.length);
  // Quem injeta `embaralhar` (os testes, que querem a ordem na mão) leva a lista inteira; o padrão olha a FATIA da vez.
  chaves = embaralhar ? embaralhar(chaves) : embaralharPadrao(fatiaDaVez(chaves, agora()));

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

    const ir = async () => {
      try { return await chamarWaze({ token: ex.token, region: ex.region, cookies: ex.cookies, sessions }); } catch { return { resultado: 'falhou' }; }
    };
    let r = await ir();
    // R26-2-02: o Waze só invalida o valor depois de ~24 h, e renovamos com 10 h. Um 401/403 numa sessão
    // JOVEM (carimbo < 20 h) não é «o cookie morreu de velho»: é o Waze (ou a borda) errando por alguns
    // segundos, e apagar a entrada tiraria do «Manter conectado» quem está viva, em silêncio. Fica pra
    // próxima execução, sem apagar e sem a ida de confirmação; se a sessão morreu de verdade (o «Sair» do
    // WME), a entrada sai quando o carimbo passar de 20 h.
    if (r.resultado === 'morta' && Number.isFinite(ex.idade) && ex.idade < mortaApos) { resumo.adiadas++; continue; }
    // Um 401/403 ISOLADO não prova sessão morta (gotcha #42: WAF, blip do Waze):
    // confirma UMA vez, depois de outra pausa com jitter, e só apaga a entrada se
    // a segunda também for 401/403. Sem tempo pra confirmar, fica pra próxima
    // execução SEM apagar. Custa no máximo +1 `fetch` por sessão que falhou
    // (1 + 15 + 6 × 5 = 46 operações no pior caso, ainda sob as 50).
    if (r.resultado === 'morta') {
      if (relogio() - inicio + PAUSA_MAX_MS > tetoMs) { resumo.adiadas++; continue; }
      try { await pausa(); } catch { /* a pausa nunca derruba a varredura */ }
      resumo.confirmadas++;
      r = await ir();
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
