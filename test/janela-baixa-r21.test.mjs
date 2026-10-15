// A TELA na rodada 21 da auditoria (lote 25, área "telas: janela baixa e texto
// grande na presença"; relatório r21-5): o CSS de verdade, lido do fonte e AVALIADO
// (um avaliador pequeno de `calc()`/`min()`/`max()`/`clamp()` roda a própria
// expressão que está em `css/styles.css` — não uma cópia dela).
//
//  R21-5-02 · `.conversa-folha { height: min(70dvh, 100%) }` não tinha regra de janela
//             baixa: as partes que não encolhem (cabeçalho, estado, respiro da lista
//             e formulário) passam dos 70% e o campo e o Enviar pendiam pra fora da
//             folha e da tela. Agora a folha toma a janela inteira SÓ quando 70dvh
//             não comporta o piso; onde comporta, é a MESMA altura de hoje.
//  R21-5-03 · o selo numérico da pílula cobria 57–68% da tinta do balão a 1,5×–2×
//             (preso ao canto do botão, que é px, com ícone e selo em rem). Agora ele
//             se prende ao ícone e SOBE quanto cresce; a 1× fica EXATAMENTE em 2px/2px.
//  R21-5-07 · a foto da folha do pedido recebido era 150px fixos e, em janela baixa, a
//             folha abria mostrando só o cabeçalho e a foto. Agora, até 414px de altura
//             (onde o texto de nenhum pedido com foto cabe), ela é um item flex que
//             encolhe até 72px; fora disso é a de sempre — 150px, sem encolher, pixel a
//             pixel.
//
// A medida na tela (hit-test dos controles, tinta do selo, nome e ↗ da folha do pedido,
// a 1× sem diferença) está na seção 6c de `tools/smoke-presenca.mjs`, com os controles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const CSS = ler('css/styles.css');
const HTML = ler('index.src.html');
// Guard lê CÓDIGO, nunca comentário (gotcha #67).
const CSS_SEM = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

// O corpo `{ … }` de uma regra de UM seletor, a partir do seletor (sem aninhar).
function regra(seletor) {
  const i = CSS_SEM.indexOf('\n' + seletor + ' {');
  assert.ok(i >= 0, `regra sumiu: ${seletor}`);
  const ini = CSS_SEM.indexOf('{', i) + 1;
  return CSS_SEM.slice(ini, CSS_SEM.indexOf('}', ini));
}
// As declarações de um corpo, por `;` (nenhuma expressão daqui tem `;` dentro).
function declaracoes(corpo) {
  const d = {};
  for (const parte of corpo.split(';')) {
    const i = parte.indexOf(':');
    if (i < 0) continue;
    d[parte.slice(0, i).trim()] = parte.slice(i + 1).trim();
  }
  return d;
}
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);

// ── um avaliador mínimo de math do CSS ──────────────────────────────────────
// Valores: { px } (comprimento já em px) ou { n } (número sem unidade). `ctx`:
//   rem (px por rem), vw (px da largura da janela), dvh (px de 1% da altura),
//   pct (px que 100% vale na propriedade), vars (as `--x` já avaliadas).
function avaliar(texto, ctx) {
  const toks = [];
  // A ordem das alternativas importa: `--nome` antes do `-` solto; número com unidade
  // antes de tudo; função (`min(`) antes do identificador.
  const re = /\s*(-?\d*\.?\d+(?:rem|px|dvh|vw|%)?|--[a-z-]+|[a-z-]+\(|[()+*/,-])/gy;
  const s = texto.trim();
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    assert.ok(m, `avaliador: não entendi "${s.slice(pos, pos + 20)}" em «${s}»`);
    toks.push(m[1]);
    pos = re.lastIndex;
  }
  let i = 0;
  const comp = (v) => { assert.ok('px' in v, 'esperava um comprimento'); return v.px; };
  const soma = (a, b, sinal) => {
    if ('px' in a && 'px' in b) return { px: a.px + sinal * b.px };
    if ('n' in a && 'n' in b) return { n: a.n + sinal * b.n };
    return assert.fail('soma de comprimento com número');
  };
  const vezes = (a, b) => {
    if ('px' in a && 'n' in b) return { px: a.px * b.n };
    if ('n' in a && 'px' in b) return { px: a.n * b.px };
    if ('n' in a && 'n' in b) return { n: a.n * b.n };
    return assert.fail('comprimento vezes comprimento');
  };
  const num = (t) => {
    const mm = /^(-?\d*\.?\d+)(rem|px|dvh|vw|%)?$/.exec(t);
    assert.ok(mm, `número esperado, veio "${t}"`);
    const x = parseFloat(mm[1]);
    switch (mm[2]) {
      case 'rem': return { px: x * ctx.rem };
      case 'px': return { px: x };
      case 'dvh': return { px: x * ctx.dvh };
      case 'vw': return { px: x * ctx.vw / 100 };
      case '%': return { px: x * ctx.pct / 100 };
      default: return { n: x };
    }
  };
  function expr() {
    let v = termo();
    while (toks[i] === '+' || toks[i] === '-') { const op = toks[i++]; v = soma(v, termo(), op === '+' ? 1 : -1); }
    return v;
  }
  function termo() {
    let v = fator();
    while (toks[i] === '*' || toks[i] === '/') {
      const op = toks[i++];
      const w = fator();
      if (op === '*') v = vezes(v, w);
      else { assert.ok('n' in w, 'divisão por comprimento'); v = 'px' in v ? { px: v.px / w.n } : { n: v.n / w.n }; }
    }
    return v;
  }
  function fator() {
    const t = toks[i++];
    if (t === '(') { const v = expr(); assert.equal(toks[i++], ')'); return v; }
    if (t === 'var(') {
      const nome = toks[i++];
      assert.equal(toks[i++], ')');
      assert.ok(ctx.vars && nome in ctx.vars, `var ${nome} sem valor`);
      return ctx.vars[nome];
    }
    if (/^[a-z-]+\($/.test(t)) {
      const fn = t.slice(0, -1);
      const args = [expr()];
      while (toks[i] === ',') { i++; args.push(expr()); }
      assert.equal(toks[i++], ')', `fechar ${fn}(`);
      if (fn === 'calc') return args[0];
      const px = args.map(comp);
      if (fn === 'min') return { px: Math.min(...px) };
      if (fn === 'max') return { px: Math.max(...px) };
      if (fn === 'clamp') return { px: Math.max(px[0], Math.min(px[1], px[2])) };
      return assert.fail('função não prevista: ' + fn);
    }
    return num(t);
  }
  const v = expr();
  assert.equal(i, toks.length, `sobrou texto na expressão «${s}»`);
  return v;
}

test('o avaliador de math do CSS acerta o que o navegador acerta (controle do instrumento)', () => {
  const c = { rem: 16, vw: 400, dvh: 8, pct: 44 };
  assert.equal(avaliar('calc(2px + min(0px, 50% - 0.75rem - 10px))', c).px, 2 + Math.min(0, 22 - 12 - 10));
  assert.equal(avaliar('max(70dvh, calc(100px * 101 - 70dvh * 100))', c).px, Math.max(560, 100 * 101 - 560 * 100));
  assert.equal(avaliar('clamp(0px, calc((17.5rem - 100vw) * 100), 1rem)', c).px, 0, '280 − 400 < 0 → 0');
  assert.equal(avaliar('clamp(0px, calc((17.5rem - 100vw) * 100), 1rem)', { ...c, vw: 270 }).px, 16, '280 − 270 = 10 → ×100 passa de 1rem → 16');
  perto(avaliar('1.1 * (1.05rem - 16.8px)', { ...c, rem: 24 }).px, 1.1 * (25.2 - 16.8), 'multiplicar por número');
  assert.equal(avaliar('var(--x) * 2', { ...c, vars: { '--x': { px: 5 } } }).px, 10);
  assert.throws(() => avaliar('calc(2px + 3)', c), /soma de comprimento com número/);
});

// ═══ R21-5-02 · a folha da conversa em janela baixa ═════════════════════════

const CONVERSA = declaracoes(regra('.conversa-folha'));
const alturaDaConversa = ({ rem, vw, H, raiz }) => {
  const base = { rem, vw, dvh: H / 100, pct: raiz };
  const piso = avaliar(CONVERSA['--conversa-piso'], base);
  const h = avaliar(CONVERSA.height, { ...base, vars: { '--conversa-piso': piso } });
  // `max-height: 100%` corta — o navegador faz isto, o avaliador também.
  return { piso: piso.px, usada: Math.min(h.px, raiz) };
};
// A altura de hoje, o que a regra de antes dava: `min(70dvh, 100%)`, cortada em 100%.
const alturaDeAntes = ({ H, raiz }) => Math.min(raiz, Math.min(0.7 * H, raiz));

test('R21-5-02 · a folha da conversa segue com o teto de 100% da raiz, e o `height` leva o piso', () => {
  assert.equal(CONVERSA['max-height'], '100%', 'sem o teto de 100% da raiz (que já desconta o teclado)');
  assert.match(CONVERSA.height, /70dvh/);
  assert.match(CONVERSA.height, /var\(--conversa-piso\)/, 'o `height` não olha o piso');
  assert.match(CONVERSA.height, /^max\(/, 'o `height` não é um max(): 70dvh sozinho não sabe do piso');
  assert.ok('--conversa-piso' in CONVERSA, 'sumiu o piso');
});

test('R21-5-02 · o piso é a altura em que o campo e o Enviar ficam DENTRO da folha (178 a 1×, 222 a 1,5×, 270 a 2×)', () => {
  // As partes MEDIDAS no app (`tools/smoke-presenca.mjs`, 6c, confere a soma contra o
  // DOM): cabeçalho 69 + estado 32 + respiro da lista 24 + borda 1 + 8 + campo 44 = 178.
  const p = (rem, vw) => alturaDaConversa({ rem, vw, H: 1000, raiz: 1000 }).piso;
  assert.equal(p(16, 393), 178);
  assert.equal(p(24, 568), 222);
  assert.equal(p(32, 640), 270);
  assert.equal(p(16, 320), 178, 'o iPhone SE de 1ª geração (320 px, 20rem) a 1× tem que ficar como está');
  // O cabeçalho é max(44px, 1,5rem): só vira rem passando de 1,83× (rem 29,3).
  assert.equal(p(40, 900), 5.5 * 40 + 2 + 60 + 52);
});

// A linha de estado que QUEBRA (MEDIDA nos 4 idiomas, pessoa perto, longe e FORA do app,
// Chromium e WebKit, varrendo a largura de 2 em 2px a 1×, lote 25): ainda quebra em duas
// linhas a 19,625rem, em três a 11,625rem, em quatro a 9,625rem; os degraus ficam um
// passo (2px) acima: 19,8, 11,8 e 9,8rem. Cada linha a mais é 1rem; o piso soma os três.
const LIMITE_DE_DUAS_LINHAS_REM = 19.8;
const LIMITE_DE_TRES_LINHAS_REM = 11.8;
const LIMITE_DE_QUATRO_LINHAS_REM = 9.8;

test('R21-5-02 · a linha de estado que quebra soma 1rem por degrau, na largura da janela em rem (e só abaixo do limite)', () => {
  const p = (rem, vw) => alturaDaConversa({ rem, vw, H: 1000, raiz: 1000 }).piso;
  const base = (rem) => p(rem, 5000);
  // Acima do limite de duas linhas nada soma: 393 px a 1× são 24,6rem, 568 px a 1,5× são 23,7rem.
  assert.equal(p(16, 393), base(16));
  assert.equal(p(24, 568), base(24));
  assert.equal(p(24, 480), base(24), '480 px a 1,5× são 20rem: a frase mais longa ainda cabe numa linha');
  // Abaixo, uma linha: 360 px a 1,5× (15rem), 412 px a 2× (12,9rem), o Galaxy Fold a 1× (17,5rem).
  assert.equal(p(24, 360), base(24) + 24);
  assert.equal(p(32, 412), base(32) + 32);
  assert.equal(p(16, 280), base(16) + 16, 'o Fold a 1× quebra a linha quando a pessoa está a menos de 1 km (medido nos 4 idiomas)');
  assert.equal(p(32, 568), base(32) + 32, '568 px a 2× são 17,75rem: duas linhas');
  // Abaixo de 11,8rem, duas: 360 px e 320 px a 2×; abaixo de 9,8rem, três: o Fold a 2×.
  assert.equal(p(32, 360), base(32) + 64);
  assert.equal(p(32, 320), base(32) + 64);
  assert.equal(p(32, 280), base(32) + 96);
  // Os limites do CSS são os medidos (o degrau de baixo do limite é o que o CSS diz).
  const limites = [...CONVERSA['--conversa-piso'].matchAll(/clamp\(0px, calc\(\(([\d.]+)rem - 100vw\) \* 100\), 1rem\)/g)].map((m) => Number(m[1]));
  assert.deepEqual(limites, [LIMITE_DE_DUAS_LINHAS_REM, LIMITE_DE_TRES_LINHAS_REM, LIMITE_DE_QUATRO_LINHAS_REM], 'os degraus da linha de estado mudaram: refaça a medida das linhas');
  // O degrau é um degrau, não uma rampa: 2px abaixo do limite já soma a linha inteira.
  const vwLimite = LIMITE_DE_DUAS_LINHAS_REM * 16;
  assert.equal(p(16, vwLimite + 1), base(16));
  assert.equal(p(16, vwLimite - 2), base(16) + 16);
});

test('R21-5-02 · ONDE 70dvh comporta o piso a altura é a MESMA de hoje, em qualquer escala, janela e teclado', () => {
  // A prova de "nenhum pixel muda onde cabe": a altura usada com a regra nova é igual
  // (zero de diferença) à de `min(70dvh, 100%)` em toda combinação em que 70dvh ≥ piso.
  let comparados = 0;
  for (const rem of [13.6, 16, 20, 24, 28, 32, 40]) {
    for (const vw of [280, 320, 360, 393, 412, 568, 640, 732, 915]) {
      for (let H = 160; H <= 1100; H += 13) {
        for (const kb of [0, 160, 250, 300]) {
          const raiz = H - kb;
          if (raiz < 100) continue;
          const nova = alturaDaConversa({ rem, vw, H, raiz });
          if (0.7 * H >= nova.piso) {
            perto(nova.usada, alturaDeAntes({ H, raiz }), `mudou onde cabia: rem ${rem}, ${vw} px, janela ${H}, raiz ${raiz}`);
            comparados++;
          }
        }
      }
    }
  }
  assert.ok(comparados > 5000, `o laço quase não comparou nada (${comparados}): o controle do próprio teste`);
});

test('R21-5-02 · os casos da auditoria que não cabiam: a folha toma a janela e o campo passa a caber', () => {
  // A janela É o que o teclado deixou (Chrome do Android: `resizes-content`), e a raiz
  // do modal é a janela inteira. O campo termina em `precisa` do topo da folha (o piso de
  // uma linha de estado mais 1rem por linha que quebrou: `linhas`, MEDIDAS com a frase
  // "No app agora · L4 · a 438 km daqui" que o smoke usa), então cabe quando a folha (a
  // janela toda) é pelo menos isso — e o piso do CSS cobre o que o DOM precisa.
  const casos = [
    { nome: '732×412 deitado, teclado 180', rem: 16, vw: 732, H: 232, linhas: 1 },
    { nome: '640×360 deitado, teclado 180', rem: 16, vw: 640, H: 180, linhas: 1 },
    { nome: '320×568 a 2×, teclado 250', rem: 32, vw: 320, H: 318, linhas: 2 },
    { nome: '280×653 (Fold) a 2×, teclado 300', rem: 32, vw: 280, H: 353, linhas: 2 },
    { nome: '568×320 deitado a 2×, sem teclado', rem: 32, vw: 568, H: 320, linhas: 1 },
    { nome: '320×568 a 1,5×, teclado 250 (a linha de estado quebra)', rem: 24, vw: 320, H: 318, linhas: 2 },
  ];
  for (const c of casos) {
    const antes = alturaDeAntes({ H: c.H, raiz: c.H });
    const nova = alturaDaConversa({ rem: c.rem, vw: c.vw, H: c.H, raiz: c.H });
    const precisa = alturaDaConversa({ rem: c.rem, vw: 5000, H: 1000, raiz: 1000 }).piso + (c.linhas - 1) * c.rem;
    assert.ok(antes < precisa, `${c.nome}: o caso nem falhava hoje (70dvh ${antes} ≥ o que o campo precisa, ${precisa})`);
    perto(nova.usada, c.H, `${c.nome}: a folha não tomou a janela`);
    assert.ok(nova.usada >= precisa, `${c.nome}: a janela (${c.H}) é menor que o que o campo precisa (${precisa}) — não é caso que esta regra resolva`);
    assert.ok(nova.piso >= precisa - 1e-6, `${c.nome}: o piso do CSS (${nova.piso}) não cobre o que o DOM precisa (${precisa})`);
  }
  // O que a regra NÃO resolve fica registrado, pra ninguém achar que sim: 568×320 com o
  // teclado (janela de 160) é menor que o piso de 178 — a conta é de COMPACTAR a folha.
  const sem = alturaDaConversa({ rem: 16, vw: 568, H: 160, raiz: 160 });
  assert.ok(sem.usada < sem.piso, 'o caso de 568×320 com o teclado passou a caber: tire a nota do relatório do lote 25');
});

test('R21-5-02 · 568×320 a 1× e a 1,5× SEM teclado (o campo cabe) ficam em 224px, como hoje', () => {
  for (const rem of [16, 24]) {
    const nova = alturaDaConversa({ rem, vw: 568, H: 320, raiz: 320 });
    perto(nova.usada, 224, `a 568×320 com rem ${rem} a folha mudou de 224px`);
  }
});

test('R21-5-02 · a rampa é íngreme: abaixo do piso a folha chega a 100% no primeiro pixel de falta', () => {
  // Uma falta de 5px de 70dvh já dá a janela inteira (a inclinação 100 do `piso·101 −
  // 70dvh·100` é o que faz o degrau). 70dvh = piso − 5px ⇒ a janela é de 247px.
  const piso = alturaDaConversa({ rem: 16, vw: 393, H: 1000, raiz: 1000 }).piso;
  const H = (piso - 5) / 0.7;
  for (const raiz of [180, 200, 232, Math.floor(H)]) {
    const nova = alturaDaConversa({ rem: 16, vw: 393, H, raiz });
    perto(nova.usada, raiz, `raiz ${raiz}: com 5px de falta a folha não tomou a janela`);
  }
});

test('R21-5-02 · a conta do piso casa com o HTML: cada peça que não encolhe está lá, com as classes que ela usa', () => {
  const folha = HTML.slice(HTML.indexOf('id="conversaModal"'), HTML.indexOf('id="pedidoModal"'));
  // cabeçalho: py-3, o ✕ de 44px e a borda
  assert.match(folha, /px-4 py-3 border-b[^"]*flex-shrink-0/, 'o cabeçalho da conversa mudou: refaça a conta do piso');
  assert.match(folha, /id="conversaClose" type="button" class="min-w-\[44px\] min-h-\[44px\]/);
  // estado: py-2 e text-xs (1rem de linha), que NÃO encolhe
  assert.match(folha, /id="conversaEstado" class="hidden text-xs [^"]*px-4 py-2 flex-shrink-0"/, 'a linha de estado mudou: refaça a conta do piso');
  // lista: py-3, a que rola
  assert.match(folha, /id="conversaMsgs" class="conversa-msgs flex-1 min-h-0 overflow-y-auto [^"]*px-4 py-3/, 'a lista mudou: refaça a conta do piso');
  // formulário: py-2, a borda de cima e o campo de 44px
  assert.match(folha, /id="conversaForm" class="flex items-end gap-2 px-3 py-2 border-t[^"]*flex-shrink-0"/, 'o formulário mudou: refaça a conta do piso');
  assert.match(folha, /id="conversaInput"[^>]*class="[^"]*min-h-\[44px\]/);
  assert.match(folha, /id="conversaEnviar"[^>]*class="[^"]*min-h-\[44px\]/);
  // o respiro de baixo do formulário (0,5rem + área segura) fica FORA do piso, de propósito
  assert.match(CSS_SEM, /#conversaForm \{ padding-bottom: calc\(0\.5rem \+ env\(safe-area-inset-bottom\)\); \}/);
});

// ═══ R21-5-03 · o selo da pílula fora de cima do balão ═══════════════════════

const SELO = declaracoes(regra('.presenca-selo'));
// O botão tem mínimo de 44px (px) e o ícone é `w-6 h-6` (1,5rem): o botão é a maior
// das duas coisas, e o `50%` do `top`/`right` é metade dele.
const posicaoDoSelo = (rem) => {
  const botao = Math.max(44, 1.5 * rem);
  const ctx = { rem, vw: 393, dvh: 8.51, pct: botao };
  return { top: avaliar(SELO.top, ctx).px, right: avaliar(SELO.right, ctx).px, botao };
};

test('R21-5-03 · a 1× o selo fica EXATAMENTE em 2px/2px, e com texto menor também', () => {
  for (const rem of [16, 15, 14, 13.6, 12]) {
    const { top, right } = posicaoDoSelo(rem);
    assert.equal(top, 2, `a ${rem}px de rem o selo saiu do lugar (top ${top})`);
    assert.equal(right, 2, `a ${rem}px de rem o selo saiu do lugar (right ${right})`);
  }
});

test('R21-5-03 · com o texto maior o selo sobe (e nunca passa da borda do botão pra direita)', () => {
  let anterior = 2;
  for (const rem of [17, 18, 20, 22.4, 24, 28, 32, 40]) {
    const { top, right } = posicaoDoSelo(rem);
    assert.ok(top <= anterior + 1e-9, `o selo desceu a rem ${rem} (top ${top} depois de ${anterior})`);
    assert.ok(top < 2, `o selo não subiu a rem ${rem}`);
    assert.ok(right >= 0, `o selo passa da borda do botão (right ${right}) a rem ${rem}: roubaria toque do vizinho`);
    anterior = top;
  }
  // os dois números que o relatório usa, à mão (50% = 22 num botão de 44px, 24 num de 48px)
  const a = posicaoDoSelo(24);
  perto(a.top, 2 + Math.min(0, 22 - 18 - 10 - 1.1 * (1.05 * 24 - 16.8)), '1,5×: o `top` não é o da conta');
  assert.equal(a.right, 0);
  const b = posicaoDoSelo(32);
  perto(b.top, 2 + Math.min(0, 24 - 24 - 10 - 1.1 * (1.05 * 32 - 16.8)), '2×: o `top` não é o da conta');
});

test('R21-5-03 · o selo ainda cresce com o texto (o dígito inteiro dentro dele) e a pílula segue com o mesmo número e ícone', () => {
  // O conserto é de POSIÇÃO: tamanho, fonte e padding seguem em rem como eram.
  assert.equal(SELO['min-width'], '1.05rem');
  assert.equal(SELO.height, '1.05rem');
  assert.equal(SELO['line-height'], '1.05rem');
  assert.equal(SELO['font-size'], '0.625rem');
  assert.equal(SELO.padding, '0 0.25rem');
  assert.match(SELO['box-shadow'], /0 0 0 2px/, 'o anel do selo mudou');
  assert.equal(SELO.position, 'absolute');
  // O botão da pílula segue relativo e de 44px mínimo: a conta do `50%` parte dele.
  const pilula = HTML.slice(HTML.indexOf('id="presencaPill"'), HTML.indexOf('id="themeBtn"'));
  assert.match(pilula, /class="hidden relative min-w-\[44px\] min-h-\[44px\] flex items-center justify-center/);
  assert.match(pilula, /id="presencaIconMsg" class="hidden w-6 h-6"/);
  assert.match(pilula, /id="presencaIconGente" class="w-6 h-6"/);
});

// ═══ R21-5-07 · a foto da folha do pedido recebido cede em JANELA BAIXA ═══════

const MEDIA_FOTO = '@media (max-height: 414px)';
const LIMITE_JANELA_BAIXA = 414;
// O pedido com foto MAIS CURTO que o app consegue abrir (só o nome: sem tipo, categoria
// nem endereço), medido no navegador a 0,85× (o menor texto do Android): 307px de conteúdo
// (319 a 1×, 360 a 1,5×, 420 a 2×). Desses, 1rem (13,6px a 0,85×) é o RESPIRO de baixo do
// corpo (`pb-4`), que passar do teto não esconde nada: o que se compara com a folha é o TEXTO.
// A seção 6c do smoke da presença mede de novo a cada rodada.
const CONTEUDO_MINIMO_COM_FOTO_A_085 = 307;
const RESPIRO_DE_BAIXO_A_085 = 0.85 * 16;

// O corpo de um `@media (...) { … }` (com as chaves aninhadas), exigindo UMA ocorrência:
// guard que lê a primeira de um texto repetido lê a errada (o duplicado do lote 23).
function blocoDoMedia(texto) {
  const i = CSS_SEM.indexOf(texto + ' {');
  assert.ok(i >= 0, `sumiu o ${texto}`);
  assert.equal(CSS_SEM.indexOf(texto + ' {', i + 1), -1, `${texto} aparece mais de uma vez`);
  let prof = 0;
  let j = CSS_SEM.indexOf('{', i);
  const ini = j + 1;
  for (; j < CSS_SEM.length; j++) {
    if (CSS_SEM[j] === '{') prof++;
    else if (CSS_SEM[j] === '}' && --prof === 0) break;
  }
  return CSS_SEM.slice(ini, j);
}

test('R21-5-07 · FORA da janela baixa a foto do pedido recebido segue com 150px e não encolhe (o que cabia fica igual)', () => {
  const FOTO = declaracoes(regra('.pedido-foto'));
  assert.equal(FOTO.height, '150px', 'sem a altura de hoje, o caso que cabe muda');
  assert.match(FOTO.overflow, /hidden/);
  // A regra base não encolhe nem tem piso: quem a impede de encolher é o `flex-shrink-0`
  // do HTML, e o `@media` o vence pela ORDEM (o styles.css vem depois do Tailwind).
  assert.equal(FOTO['flex-shrink'], undefined, 'a regra base não pode permitir o encolhimento: ele mudaria 393×851 a 1,5× e o Galaxy Fold a 1×');
  assert.equal(FOTO['min-height'], undefined);
  const tag = (HTML.match(/<div id="pedidoFoto"[^>]*>/) || [])[0];
  assert.ok(tag, 'sumiu o #pedidoFoto');
  assert.match(tag, /\bflex-shrink-0\b/, 'o #pedidoFoto perdeu o `flex-shrink-0`: fora da janela baixa ele passaria a encolher');
});

test('R21-5-07 · só até 414px de altura a foto cede, de 150px até 72px (um item flex que encolhe)', () => {
  const bloco = blocoDoMedia(MEDIA_FOTO);
  const m = bloco.match(/^\s*\.pedido-foto \{([^}]*)\}\s*$/);
  assert.ok(m, `o @media da foto não tem só a regra da foto: ${JSON.stringify(bloco)}`);
  const d = declaracoes(m[1]);
  assert.deepEqual(Object.keys(d).sort(), ['flex-shrink', 'min-height'], 'a altura de 150px não pode mudar dentro do @media (é a base do flex)');
  assert.equal(d['flex-shrink'], '1');
  assert.match(d['min-height'], /^\d+px$/, 'o piso da foto é em px (a foto não cresce com o texto)');
  const piso = parseInt(d['min-height'], 10);
  assert.ok(piso >= 48 && piso <= 96, `o piso da foto (${piso}px) não é uma faixa que mostre o que a foto é`);
  // E o que faz ela ceder: a folha é coluna flex e tem teto (70dvh/100%) com rolagem.
  const folha = HTML.slice(HTML.indexOf('id="pedidoModal"'), HTML.indexOf('id="pedidoFoto"'));
  assert.match(folha, /<div class="folha [^"]*flex flex-col overflow-y-auto/, 'a folha do pedido deixou de ser coluna flex com rolagem: a foto não tem de quem ceder');
  assert.match(CSS_SEM, /\.folha \{ max-height: min\(70dvh, 100%\);/, 'o teto da folha mudou: refaça a conta da foto');
  // O empate com o `flex-shrink-0` do Tailwind se decide pela ORDEM no arquivo gerado.
  const APP = ler('css/app.css');
  const util = APP.indexOf('.flex-shrink-0{');
  const regraBaixa = APP.indexOf(`@media (max-height:${LIMITE_JANELA_BAIXA}px){.pedido-foto{`);
  assert.ok(util >= 0 && regraBaixa > util, 'o @media da foto precisa vir DEPOIS do `.flex-shrink-0` do Tailwind em css/app.css (npm run css)');
});

test('R21-5-07 · o TEXTO de nenhum pedido com foto cabe nas janelas do @media: o que a foto cede ali não tira nada de quem cabia', () => {
  // O desenho anterior encolhia em toda janela e mudava 393×851 a 1,5× e o Galaxy Fold a 1×
  // (o texto à vista, só o respiro de 1rem do corpo passando do teto). Abaixo do limite a
  // folha tem 70% dele; o TEXTO do pedido mais curto que há (o conteúdo menos o respiro de
  // baixo, que passar do teto não esconde nada) tem de passar disso, no menor texto.
  const textoMinimo = CONTEUDO_MINIMO_COM_FOTO_A_085 - RESPIRO_DE_BAIXO_A_085;
  assert.ok(0.7 * LIMITE_JANELA_BAIXA < textoMinimo,
    `70% de ${LIMITE_JANELA_BAIXA}px (${0.7 * LIMITE_JANELA_BAIXA}) comporta o texto do pedido mais curto (${textoMinimo}px): a foto passaria a ceder onde o texto cabia`);
  assert.ok(LIMITE_JANELA_BAIXA >= 412, 'o limite não alcança mais o Android deitado (412px de altura): a foto volta a empurrar o nome e o ↗');
  assert.ok(CSS_SEM.includes(`${MEDIA_FOTO} {`), 'o limite do teste e o do CSS divergem');
});

test('R21-5-07 · o cabeçalho e o corpo da folha do pedido NÃO encolhem antes da foto', () => {
  const folha = HTML.slice(HTML.indexOf('id="pedidoModal"'), HTML.indexOf('id="appScreen"'));
  // O cabeçalho é `flex-shrink-0`; o corpo é flex-shrink padrão com altura de conteúdo
  // (`min-height: auto`), então só a foto cede — é ela que o teste de tela mede.
  assert.match(folha, /px-4 py-3 border-b[^"]*flex-shrink-0/);
  assert.match(folha, /<div class="p-5 pb-4 flex flex-col gap-3">/);
});
