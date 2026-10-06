// A espera dos smokes (`tools/esperar-saida.mjs`) separa a página que CAIU da
// página que ainda não chegou no estado. O CI do #259 (2026-10-06) reprovou o bloco
// do pareamento do smoke de layout no WebKit com "a espera por o QR com a contagem
// estourou (15000ms)", e a reprodução aqui (com a máquina carregada, e com o
// código do lote 11 na mesma proporção) mostrou "page.evaluate: Target crashed":
// o processo da página do WebKit morreu, e a
// espera, que trata todo erro do `evaluate` como "ainda não", esperou o teto
// inteiro e culpou o estado da página. Erro de NAVEGAÇÃO segue sendo "ainda não"
// (a página volta); o de página morta encerra na hora, dizendo que caiu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { esperarNaPagina, esperarOuExplodir, PAGINA_MORTA } from '../tools/esperar-saida.mjs';

// Uma página de mentira: `respostas` é a sequência do que cada `evaluate` faz
// (um valor, ou um Error pra lançar); a última se repete.
const pagina = (respostas) => {
  let i = 0;
  return {
    chamadas: () => i,
    evaluate: async () => {
      const r = respostas[Math.min(i, respostas.length - 1)];
      i++;
      if (r instanceof Error) throw r;
      return r;
    },
  };
};

test('esperarNaPagina: a página que CAIU encerra a espera na hora, dizendo que caiu', async () => {
  const p = pagina([new Error('page.evaluate: Target crashed ')]);
  const t0 = Date.now();
  const r = await esperarNaPagina(p, () => true, 5000, 10);
  assert.equal(r.ok, false);
  assert.match(String(r.caiu), /Target crashed/, `a espera não disse que a página caiu: ${JSON.stringify(r)}`);
  assert.equal(p.chamadas(), 1, 'a espera seguiu perguntando a uma página morta');
  assert.ok(Date.now() - t0 < 1000, 'a espera esperou o teto com a página morta');
  // A página, o contexto ou o navegador FECHADOS também não voltam.
  for (const msg of ['page.evaluate: Target page, context or browser has been closed', 'Target closed']) {
    const f = await esperarNaPagina(pagina([new Error(msg)]), () => true, 5000, 10);
    assert.ok(f.caiu, `"${msg}" não foi tratado como página morta`);
  }
});

test('esperarNaPagina: CONTROLE — o erro de NAVEGAÇÃO segue sendo "ainda não", e a condição que chega vale', async () => {
  const p = pagina([new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation'), false, true]);
  const r = await esperarNaPagina(p, () => true, 5000, 10);
  assert.equal(r.ok, true, `a espera desistiu no erro de navegação: ${JSON.stringify(r)}`);
  assert.equal(r.caiu, undefined);
  assert.equal(p.chamadas(), 3);
  // E a régua não confunde navegação com página morta.
  assert.doesNotMatch('Execution context was destroyed, most likely because of a navigation', PAGINA_MORTA);
});

test('esperarOuExplodir: a página que caiu explode com a CAUSA, não com "estourou"', async () => {
  await assert.rejects(esperarOuExplodir(pagina([new Error('page.evaluate: Target crashed')]), () => true, 'o QR com a contagem', 5000),
    (e) => /CAIU durante a espera por o QR com a contagem/.test(e.message) && /Target crashed/.test(e.message) && !/estourou/.test(e.message));
  // CONTROLE: a página viva que não chega no estado segue "estourando".
  await assert.rejects(esperarOuExplodir(pagina([false]), () => true, 'o QR com a contagem', 50),
    (e) => /estourou \(50ms\)/.test(e.message));
});
