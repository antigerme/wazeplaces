// FONTE ÚNICA de ESPERAR, num smoke, SEM injetar nada na página.
//
// Duas esperas moram aqui, e o que elas têm em comum é o que importa: as duas
// pollam pelo lado do NODE. O smoke do offline MEDE a superfície de erro do app
// (`pageerror` e o `unhandledrejection` que ele mesmo captura), então instrumento
// que injeta código nessa superfície vira ruído indistinguível de defeito — e foi
// assim que o CI acusou um `EvalError: Refused to evaluate a string as JavaScript`
// que o app não produz (ele não tem `eval` nenhum).
//
// Nasceu dentro do `smoke-browser.mjs`, depois de aquele bloco reprovar TRÊS
// vezes no CI e NUNCA aqui. Virou módulo quando o `smoke-offline.mjs` precisou
// da mesma espera e eu, escrevendo a seção da ESTRADA, repeti exatamente o erro
// que o comentário de lá já descrevia — a lição não pega por estar escrita num
// arquivo que o outro teste não importa. É o mesmo motivo do `waze-jitter.mjs`
// e do `paises-validacao.mjs`: instrução que depende da minha memória volta a
// ser esquecida.
//
// Espera por SINAL POSITIVO: ou a fila zera, ou o `dfato` registra o fim
// (`saida.saiu`) ou a falha (`saida.erro`). Prazo fixo não serve — ele mede a
// velocidade do runner, e no CI o `setTimeout` da pausa de 400ms é estrangulado
// a ponto de 8 itens não caberem em 40s. O teto é rede contra travar de vez,
// não expectativa: local termina em ~4s.

/**
 * @param {import('playwright').Page} page
 * @param {number} tetoMs
 * @returns {Promise<{motivo: string, ms?: number, erro?: string, verDiario?: boolean, fim?: number, base?: number}>}
 */
export async function esperarFimDaSaida(page, tetoMs = 180000) {
  // POLL PELO LADO DO NODE, e não `page.waitForFunction`. Três motivos, todos
  // MEDIDOS — e os três voltaram a morder na seção da ESTRADA:
  //  · o padrão do `waitForFunction` é pollar por `requestAnimationFrame`, que
  //    NÃO dispara em página de segundo plano — a espera pode nem avaliar;
  //  · com `polling: <ms>` ele passa a usar timer DA PÁGINA, que é justamente
  //    o que o runner estrangula — o mesmo mal que se está esperando passar;
  //  · e o `.catch(() => {})` que se põe em volta engole qualquer rejeição, o
  //    que transforma "esperei e desisti" em "não esperei" sem deixar rastro.
  //
  // Há ainda uma QUARTA, de assinatura, que foi a que reprovou o CI na PR da
  // camada de teste: `waitForFunction(fn, opts)` passa `opts` como ARGUMENTO da
  // função, não como opções — a assinatura é `(pageFunction, arg, options)`. O
  // `timeout` e o `polling` que você escreveu não valem nada, e nada avisa.
  //
  // Um laço aqui no Node não depende de nada disso, e DIZ por que terminou.
  const conta = () => page.evaluate(() => {
    let fim = 0, vazia = false;
    try { vazia = JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length === 0; } catch (e) {}
    try {
      const d = typeof dfatoAnel !== 'undefined' ? dfatoAnel : null;
      if (d === null) return { verDiario: false, vazia, fim: 0 };
      fim = d.filter((e) => e.k === 'saida.saiu' || e.k === 'saida.erro').length;
    } catch (e) { return { verDiario: false, vazia, fim: 0 }; }
    return { verDiario: true, vazia, fim };
  });
  // A base sai DEPOIS de qualquer navegação: o anel é cumulativo (um
  // `saida.saiu` anterior satisfaria a condição na hora) e a recarga o zera.
  let base = null;
  try { base = await conta(); } catch (e) { return { motivo: 'evaluate-falhou', erro: String(e).slice(0, 80) }; }
  const t0 = Date.now();
  for (;;) {
    let st;
    try { st = await conta(); } catch (e) { return { motivo: 'evaluate-falhou', erro: String(e).slice(0, 80) }; }
    if (st.vazia) return { motivo: 'fila-vazia', ms: Date.now() - t0 };
    if (st.verDiario && st.fim > base.fim) return { motivo: 'diario-cresceu', ms: Date.now() - t0 };
    if (Date.now() - t0 > tetoMs) {
      return { motivo: 'TETO', ms: Date.now() - t0, verDiario: st.verDiario, fim: st.fim, base: base.fim };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Espera uma condição NA PÁGINA pollando pelo lado do Node.
 *
 * `page.waitForFunction` seria o caminho óbvio e tem quatro armadilhas já
 * documentadas aqui — e uma quinta: ele instala maquinaria DENTRO da página,
 * que é exatamente o lugar que este smoke está medindo. `page.evaluate(fn)`
 * chama a função por referência, sem avaliar string.
 *
 * @param {import('playwright').Page} page
 * @param {() => boolean} fn   avaliada na página; erro ou contexto morto conta como "ainda não"
 * @param {number} tetoMs      rede contra travar, nunca expectativa
 * @param {number} passoMs
 * @returns {Promise<{ok: boolean, ms: number}>}
 */
export async function esperarNaPagina(page, fn, tetoMs = 20000, passoMs = 200) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await page.evaluate(fn); } catch (e) { v = null; }   // navegando: tenta de novo
    if (v) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 > tetoMs) return { ok: false, ms: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, passoMs));
  }
}

/**
 * A mesma espera, mas que EXPLODE em vez de voltar calada.
 *
 * `esperarNaPagina` devolve `{ok:false}` no estouro, e trocar por ela uma
 * espera que hoje LANÇA rebaixa uma falha alta a uma silenciosa — o gotcha #62
 * dentro do próprio conserto. Onde o smoke quer parar, é esta que se usa, e a
 * mensagem diz por quem se esperava.
 *
 * @param {import('playwright').Page} page
 * @param {() => boolean} fn
 * @param {string} oQue   aparece na mensagem do erro
 * @param {number} tetoMs
 */
export async function esperarOuExplodir(page, fn, oQue, tetoMs = 15000) {
  const r = await esperarNaPagina(page, fn, tetoMs);
  if (!r.ok) throw new Error(`a espera por ${oQue} estourou (${tetoMs}ms) — a página não chegou no estado esperado`);
  return r;
}
