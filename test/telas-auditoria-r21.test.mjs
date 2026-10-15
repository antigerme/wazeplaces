// Lote 25, rodada 21 da auditoria — as margens LATERAIS de segurança da foto e do mapa ampliados (R21-3-05).
//
// O iPhone deitado (Dynamic Island, notch) tem 44 a 59 px de recorte de cada lado, e os controles de borda ficavam a
// 0,5–1 rem da borda física. A correção é uma conta de CSS, e a conta é o que se confere aqui, com um avaliador mínimo
// de `max()`, `calc()`, `env()` e `rem`/`px`/`vw`; o pixel (sem recorte, nenhum controle mexe um pixel; com recorte, o
// controle na borda da área segura) mora no bloco do tools/smoke-browser.mjs, com o override de recorte do Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const CSS_SEM = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

// ═══ R21-3-05 · as margens LATERAIS de segurança das ampliações ═════════════════════════════════════════
// O iPhone deitado (Dynamic Island, notch) tem 44 a 59 px de recorte de cada lado, e os controles de borda ficavam a
// 0,5–1 rem da borda física. O CSS é só uma conta: `max(base, env(safe-area-inset-X))`, sem recorte o valor de sempre
// (nenhum pixel muda) e com ele o controle na borda da área segura. As RESERVAS (a dica e a legenda, que param antes do
// botão de ação do canto) acompanham o botão, e cada controle mantém a SUA base (as setas 0,5 rem; a escala 1 rem).
// A conta aqui é a do navegador: um avaliador mínimo de `max()`, `calc()`, `env()` e `rem`/`px`/`vw`.
function valorCss(expressao, ins = {}, larguraDaTela = 844) {
  const s = String(expressao).trim();
  let i = 0;
  const espaco = () => { while (s[i] === ' ') i++; };
  const termo = () => {
    espaco();
    if (s.startsWith('max(', i)) {
      i += 4; const a = soma(); espaco(); assert.equal(s[i++], ',', 'max() sem vírgula: ' + s); const b = soma(); espaco(); assert.equal(s[i++], ')');
      return Math.max(a, b);
    }
    if (s.startsWith('calc(', i)) { i += 5; const v = soma(); espaco(); assert.equal(s[i++], ')'); return v; }
    if (s.startsWith('env(', i)) {
      const m = /^env\(safe-area-inset-(left|right|top|bottom),\s*0px\)/.exec(s.slice(i));
      assert.ok(m, 'env() fora do molde (com o 0px de reserva): ' + s.slice(i));
      i += m[0].length; return ins[m[1]] || 0;
    }
    const m = /^(-?\d*\.?\d+)(rem|px|vw)/.exec(s.slice(i));
    assert.ok(m, `número esperado em "${s.slice(i)}" (${s})`);
    i += m[0].length;
    return Number(m[1]) * (m[2] === 'rem' ? 16 : m[2] === 'vw' ? larguraDaTela / 100 : 1);
  };
  const soma = () => {
    let v = termo();
    for (;;) {
      espaco();
      if (s[i] === '+') { i++; v += termo(); } else if (s[i] === '-') { i++; v -= termo(); } else return v;
    }
  };
  const v = soma(); espaco();
  assert.equal(i, s.length, 'sobrou expressão: ' + s.slice(i));
  return v;
}

// As declarações de uma tag do HTML (o atributo `style`, em ordem) ou de uma regra do CSS.
function estiloDaTag(id) {
  const ini = HTML.indexOf(`id="${id}"`);
  assert.ok(ini > 0, `#${id} não existe no index.src.html (gotcha #68)`);
  const tag = HTML.slice(HTML.lastIndexOf('<', ini), HTML.indexOf('>', ini));
  const m = /style="([^"]*)"/.exec(tag);
  return { tag, decl: m ? declaracoes(m[1]) : [] };
}
function declaracoes(texto) {
  const out = [];
  let prof = 0, atual = '';
  for (const c of texto) {
    if (c === '(') prof++;
    if (c === ')') prof--;
    if (c === ';' && prof === 0) { out.push(atual); atual = ''; } else atual += c;
  }
  if (atual.trim()) out.push(atual);
  return out.map((d) => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }).filter(([k]) => k);
}
function regraCss(seletor) {
  const i = CSS_SEM.indexOf(seletor + ' {');
  assert.ok(i >= 0, `regra sumiu: ${seletor}`);
  return declaracoes(CSS_SEM.slice(i + seletor.length + 2, CSS_SEM.indexOf('}', i)));
}
// O valor que vale: a ÚLTIMA declaração da propriedade (a de cima é a reserva de quem não entende `max()`).
const vale = (decl, prop) => { const l = decl.filter(([k]) => k === prop); return l.length ? l.at(-1)[1] : undefined; };
const reserva = (decl, prop) => { const l = decl.filter(([k]) => k === prop); return l.length ? l[0][1] : undefined; };

// Cada controle com a SUA base e o lado. `px`: a base em px.
const CONTROLES = [
  ['lightboxClose', 'right', 12], ['lightboxPrev', 'left', 8], ['lightboxNext', 'right', 8], ['lightboxCount', 'left', 12],
  ['lightboxZoomHint', 'left', 16], ['lightboxZoomHint', 'right', 80], ['lightboxDelete', 'right', 12], ['lightboxApprove', 'right', 12],
  ['mapaLbClose', 'right', 12], ['mapaLbZoom', 'left', 12], ['mapaLbEscala', 'left', 16], ['mapaLbLegenda', 'left', 16],
  ['mapaLbLegenda', 'right', 64], ['mapaLbStreetView', 'right', 12],
];
const RECORTES = [{}, { left: 44, right: 44 }, { left: 59, right: 59 }, { left: 0, right: 59 }, { left: 59, right: 0 }, { left: 6, right: 6 }];

test('R21-3-05: sem recorte nenhum controle mexe um pixel — cada um mantém a SUA base (as setas 0,5 rem, a escala 1 rem, a dica 5 rem)', () => {
  for (const [id, lado, base] of CONTROLES) {
    const { decl } = estiloDaTag(id);
    assert.equal(valorCss(vale(decl, lado), {}), base, `#${id} ${lado}: com o recorte zerado o valor mudou (era ${base}px)`);
    assert.equal(valorCss(reserva(decl, lado)), base, `#${id} ${lado}: a reserva de quem não entende max() não é a base de sempre`);
  }
  for (const [lado, base] of [['left', 12], ['right', 12]]) {
    const decl = regraCss('.lb-nome');
    assert.equal(valorCss(vale(decl, lado), {}), base, `.lb-nome ${lado}`);
    assert.equal(valorCss(reserva(decl, lado)), base, `.lb-nome ${lado}: reserva`);
  }
  for (const lado of ['left', 'right']) {
    const decl = regraCss('#lightboxStrip');
    assert.equal(valorCss(vale(decl, 'padding-' + lado), {}), 12, `#lightboxStrip padding-${lado} (o px-3)`);
  }
});

test('R21-3-05: com recorte o controle vai pra borda da área segura — e só nele (o lado sem recorte fica onde estava)', () => {
  for (const ins of RECORTES.slice(1)) {
    for (const [id, lado, base] of CONTROLES.filter(([i, l]) => !(i === 'lightboxZoomHint' && l === 'right') && !(i === 'mapaLbLegenda' && l === 'right'))) {
      const v = valorCss(vale(estiloDaTag(id).decl, lado), ins);
      assert.equal(v, Math.max(base, ins[lado] || 0), `#${id} ${lado} com recorte ${JSON.stringify(ins)}: ${v}px`);
    }
  }
});

test('R21-3-05: as RESERVAS acompanham o botão do canto — a dica e a legenda param antes dele com o recorte que for, a pílula e o ✕ não se tocam', () => {
  for (const ins of RECORTES) {
    const ir = ins.right || 0, il = ins.left || 0;
    const acao = (id) => valorCss(vale(estiloDaTag(id).decl, 'right'), ins);
    // A dica de zoom: o botão de ação (48 px) + 20 px de vão (1,25 rem), como era com o botão a 12 px (80 = 12 + 48 + 20).
    const dica = valorCss(vale(estiloDaTag('lightboxZoomHint').decl, 'right'), ins);
    assert.equal(dica - (acao('lightboxDelete') + 48), 20, `a dica não guarda o vão do botão de ação com o recorte ${JSON.stringify(ins)}`);
    assert.equal(acao('lightboxApprove'), acao('lightboxDelete'), 'o "Aprovar" e a lixeira dividem o mesmo canto');
    // A legenda do mapa: o Street View (44 px) + 8 px de vão (4 rem = 12 + 44 + 8).
    const leg = valorCss(vale(estiloDaTag('mapaLbLegenda').decl, 'right'), ins);
    assert.equal(leg - (acao('mapaLbStreetView') + 44), 8, `a legenda não guarda o vão do Street View com o recorte ${JSON.stringify(ins)}`);
    // A pílula do nome (largura cheia, `pointer-events: none`) termina onde o botão de ação termina: a reserva interna dela
    // (`calc(100% - 4.25rem)`) é a mesma de sempre, contada da borda direita da caixa.
    assert.equal(valorCss(vale(regraCss('.lb-nome'), 'right'), ins), acao('lightboxDelete'),
      `a caixa da pílula do nome e o botão de ação divergem na borda direita com o recorte ${JSON.stringify(ins)}`);
    assert.equal(valorCss(vale(regraCss('.lb-nome'), 'left'), ins), valorCss(vale(estiloDaTag('lightboxCount').decl, 'left'), ins),
      'a pílula do nome e o contador divergem na borda esquerda');
    // A pílula do contador (`max-width` com o recorte já descontado) não encosta no ✕: o vão de 8 px, no mínimo, em toda largura.
    for (const largura of [280, 320, 360, 412, 667, 844, 932]) {
      const maxw = valorCss(vale(regraCss('#lightboxCount'), 'max-width'), ins, largura);
      const direitaDaPilula = valorCss(vale(estiloDaTag('lightboxCount').decl, 'left'), ins) + maxw;
      const esquerdaDoFechar = largura - valorCss(vale(estiloDaTag('lightboxClose').decl, 'right'), ins) - 44;
      assert.ok(esquerdaDoFechar - direitaDaPilula >= 8, `a pílula do contador cobre o ✕ a ${largura} px com o recorte ${JSON.stringify(ins)} (vão ${esquerdaDoFechar - direitaDaPilula}px)`);
    }
    void ir; void il;
  }
});

test('R21-3-05: a declaração de CIMA é a reserva (a base de sempre) e a de baixo o `max()` — e nada do markup disputa a posição', () => {
  for (const [id, lado] of CONTROLES) {
    const { decl, tag } = estiloDaTag(id);
    const ds = decl.filter(([k]) => k === lado);
    assert.equal(ds.length, 2, `#${id} ${lado}: esperava a reserva e o max()`);
    assert.doesNotMatch(ds[0][1], /max\(|env\(/, `#${id} ${lado}: a reserva já usa max()/env()`);
    assert.match(ds[1][1], /env\(safe-area-inset-(left|right), 0px\)/, `#${id} ${lado}: o max() não lê o recorte`);
    // As utilidades do Tailwind que antes punham a posição (`left-2`, `right-20`…) saíram: inline vence, e classe morta confunde.
    assert.doesNotMatch(tag, /class="[^"]*\b(left|right)-(2|4|16|20)\b/, `#${id}: sobrou uma utilidade de posição lateral no class`);
  }
  // O `px-3` da tira segue (é a reserva do `padding`), a regra com `max()` está no CSS.
  assert.match(estiloDaTag('lightboxStrip').tag, /\bpx-3\b/);
});
