// A TELA no Galaxy Fold, na rodada 14 da auditoria (lote 18, área "tela";
// relatório r14-8). O HTML e o CSS de verdade, lidos do fonte:
//
//  R14-8-03 · no Galaxy Fold (280px) os botões `flex-1` das linhas de dois
//             botões dos diálogos não cabiam: em francês o "Se déconnecter" saía
//             da caixa do diálogo (com rolagem horizontal), e outros comiam o
//             padding (Colar cookies pt/es/fr, código fr, "Como funciona" es/fr,
//             "Marcar todos" fr, Filtros fr).
//  R14-8-11 · o ícone ao lado de um rótulo que quebra linha encolhia (sem
//             `flex-shrink-0`): entrada no Fold nos 4 idiomas e pareamento em
//             todo celular (o "Copiar link" com 6–14px em vez de 16).
//  R14-8-12 · o "Sair" da faixa do treino com 37–42px de largura no Fold, no
//             iPhone SE, no SE de 2016 e deitado (pt, en, es).
//
// O que só o NAVEGADOR mede — a caixa do diálogo, as linhas do rótulo, a largura
// do ícone e a do "Sair" — está no `tools/smoke-browser.mjs`: "OS DIÁLOGOS E OS
// ÍCONES NO FOLD" e o "Sair" no bloco do treino.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67).
const HTML_SEM = HTML.replace(/<!--[\s\S]*?-->/g, '');
const CSS_SEM = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

// ═══ R14-8-03 · os dois botões de um diálogo na tela estreita ════════════════
// Toda linha com DOIS botões `flex-1` (a régua do auditor: os botões que dividem
// a largura) leva a classe `dialogo-acoes`, e a regra dela abaixo de 320px deixa
// o botão encolher e o rótulo quebrar DENTRO dele. A medida na tela (caixa,
// rolagem, linhas do rótulo, ≥ 44px de altura) está no smoke.
function elementosComFilhos(html) {
  // Um varredor de TAG mínimo: abre e fecha <div>/<button>, guardando os filhos
  // diretos de cada <div>. O HTML do app é escrito à mão e bem formado.
  const pilha = [];
  const linhas = [];
  const re = /<(\/?)(div|button)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, fecha, tag, attrs] = m;
    if (!fecha) {
      const el = { tag, attrs, filhos: [], linha: html.slice(0, m.index).split('\n').length };
      if (pilha.length) pilha[pilha.length - 1].filhos.push(el);
      pilha.push(el);
      if (tag === 'div') linhas.push(el);
    } else {
      const el = pilha.pop();
      assert.equal(el && el.tag, tag, `o varredor de tags se perdeu perto de <${tag}> — o instrumento quebrou`);
    }
  }
  assert.equal(pilha.length, 0, 'o varredor de tags terminou com tag aberta — o instrumento quebrou');
  return linhas;
}
const classeDe = (attrs) => (/\bclass="([^"]*)"/.exec(attrs) || [, ''])[1].split(/\s+/);
const idDe = (attrs) => (/\bid="([^"]*)"/.exec(attrs) || [, ''])[1];

test('R14-8-03: toda linha de DOIS botões `flex-1` leva `dialogo-acoes` — a regra da tela estreita alcança todas', () => {
  const divs = elementosComFilhos(HTML_SEM);
  const linhas = divs.filter((d) => d.filhos.filter((f) => f.tag === 'button' && classeDe(f.attrs).includes('flex-1')).length >= 2);
  // CONTROLE: o varredor acha as linhas que o auditor mediu — sem isto, "nenhuma
  // linha sem a classe" passaria com o varredor cego.
  const ids = linhas.map((d) => d.filhos.filter((f) => f.tag === 'button').map((f) => idDe(f.attrs)).join('+'));
  for (const par of ['cancelLogout+confirmLogout', 'cancelPaste+confirmPaste', 'pairEnterCancel+pairEnterConfirm',
    'comoFuncionaTreinar+comoFuncionaOk', 'cancelBatchRead+confirmBatchRead', 'cancelFilters+applyFilters+closeFiltersFooter',
    'resumoBaixar+resumoCompartilhar']) {
    assert.ok(ids.includes(par), `CONTROLE: o varredor não achou a linha ${par} (achou: ${ids.join(' · ')})`);
  }
  const sem = linhas.filter((d) => !classeDe(d.attrs).includes('dialogo-acoes'));
  assert.deepEqual(sem.map((d) => `linha ${d.linha}`), [],
    'DEFEITO: linha de dois botões sem `dialogo-acoes` — no Galaxy Fold o botão de rótulo longo sai da caixa do diálogo (R14-8-03)');
});

test('R14-8-03: abaixo de 320px o botão da linha encolhe, perde padding e quebra o rótulo DENTRO dele', () => {
  // A regra, no CSS de verdade (sem comentário). Os números são os MEDIDOS: 6px
  // de padding dão 82px de texto, e toda palavra de pt, en e es cabe (a mais
  // longa, "Entendido", 79px); 8px quebravam o "Confirmar" do WebKit (78,3px).
  const bloco = /@media \(max-width: 319\.98px\) \{\s*\.dialogo-acoes > button \{([^}]*)\}\s*\}/.exec(CSS_SEM);
  assert.ok(bloco, 'sumiu a regra `.dialogo-acoes > button` da tela estreita (abaixo de 320px)');
  const decl = Object.fromEntries(bloco[1].split(';').map((d) => d.split(':').map((x) => x.trim())).filter((d) => d[0]));
  assert.equal(decl['min-width'], '0', 'o botão voltou a não encolher abaixo da palavra mais longa — sai da caixa no Fold');
  assert.equal(decl['overflow-wrap'], 'break-word', 'o rótulo que não cabe não quebra dentro do botão');
  assert.equal(decl['hyphens'], 'auto', 'sem hifenização, "déconnecter" quebra na letra onde o motor tem o dicionário');
  assert.equal(decl['hyphenate-limit-chars'], '10 4 4',
    'sem o limite, o motor hifeniza o que CABE ("Quero trei-/nar antes", num diálogo sem defeito)');
  for (const lado of ['padding-left', 'padding-right']) {
    const rem = parseFloat(decl[lado]);
    assert.ok(Number.isFinite(rem) && rem * 16 <= 6,
      `${lado} = ${decl[lado]}: com mais de 6px, "Cancelar" (pt/es) quebra no meio da palavra no Fold (R14-8-03)`);
  }
  // Escopo: a regra NÃO vale em 320px e acima — lá a linha cabe e nada pode mudar.
  assert.doesNotMatch(CSS_SEM.replace(bloco[0], ''), /\.dialogo-acoes\s*>\s*button/,
    'a regra dos botões do diálogo vazou pra fora da tela estreita (muda o SE e o Pixel, que não tinham defeito)');
  // E vence o padding do Tailwind: o styles.css vem DEPOIS no app.css gerado, e o
  // seletor `.dialogo-acoes > button` (0,1,1) passa do `.px-4` (0,1,0).
  const gerado = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  const iPx = gerado.indexOf('.px-4{');
  const iNossa = gerado.indexOf('.dialogo-acoes>button{');
  assert.ok(iPx >= 0 && iNossa > iPx, 'o css/app.css não tem a regra (rode `npm run css`) ou ela veio ANTES do Tailwind');
});

// ═══ R14-8-11 · o ícone ao lado do rótulo não encolhe ════════════════════════
test('R14-8-11: todo ícone de botão ou link COM rótulo de texto leva `flex-shrink-0` — o rótulo que quebra não o espreme', () => {
  const achados = [];
  const conferidos = [];
  for (const m of HTML_SEM.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const corpo = m[3];
    const svgs = [...corpo.matchAll(/<svg class="([^"]*)"/g)].map((s) => s[1].split(/\s+/));
    if (!svgs.length) continue;
    // O rótulo é texto que OCUPA a linha: fora do svg e de span absoluto (o selo
    // do FAB) ou só pro leitor de tela (`sr-only` também é absoluto).
    const fora = corpo.replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<span\b[^>]*\bclass="[^"]*\b(absolute|sr-only)\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, '');
    const rotulo = fora.replace(/<[^>]+>/g, '').trim() || (/data-i18n="/.test(fora) ? '(do dicionário)' : '');
    if (!rotulo) continue;
    const id = idDe(m[2]) || rotulo.slice(0, 20);
    for (const cls of svgs) {
      if (!cls.some((c) => /^w-\d/.test(c))) continue;   // sem tamanho declarado não encolhe por isto
      conferidos.push(id);
      if (!cls.includes('flex-shrink-0')) achados.push(id);
    }
  }
  // CONTROLE: os botões que o auditor mediu estão na conta — sem isto, um
  // varredor cego passaria com zero achado.
  for (const id of ['uploadBtn', 'pasteBtn', 'pairEnterBtn', 'pairShowCodeBtn', 'pairCopyLinkBtn', 'batchReadBtn', 'pairCreateBtn']) {
    assert.ok(conferidos.includes(id), `CONTROLE: o varredor não conferiu o ícone de #${id}`);
  }
  assert.deepEqual(achados, [], 'DEFEITO: ícone sem `flex-shrink-0` ao lado de um rótulo — encolhe quando o rótulo quebra linha (R14-8-11)');
});

// ═══ R14-8-12 · o "Sair" da faixa do treino ══════════════════════════════════
test('R14-8-12: o "Sair" da faixa do treino tem 44px de LARGURA mínima, não só de altura', () => {
  const m = /<button id="treinoSairBtn"[^>]*class="([^"]*)"/.exec(HTML_SEM);
  assert.ok(m, 'sumiu o #treinoSairBtn');
  const cls = m[1].split(/\s+/);
  assert.ok(cls.includes('min-h-[44px]'), 'o "Sair" do treino perdeu a altura mínima de 44px');
  assert.ok(cls.includes('min-w-[44px]'),
    'DEFEITO: o "Sair" do treino sem largura mínima — 37–42px no Galaxy Fold (pt, en, es), abaixo da régua de 44px (R14-8-12)');
});
