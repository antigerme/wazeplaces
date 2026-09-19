// FUNÇÃO CHAMADA QUE NÃO EXISTE — o defeito que nenhum teste deste repo via.
//
// Em #215 ("o aviso de conquista vira um ponto") três funções foram removidas.
// Uma precisava sair; as outras duas — `registrarAcaoConfirmada` e
// `registrarDesfazer` — foram junto por engano, e os TRÊS call sites ficaram.
// O resultado foi pra produção e rodou dias:
//   · `desfazerAcaoPendente()` lançava ANTES de tirar o banner e reabilitar os
//     botões, então desfazer devolvia o pedido e deixava o card MORTO (banner
//     preso, ✕ ↑ ✓ desabilitados). O GESTO seguia funcionando, que é o que
//     escondeu — a mesma assinatura do gotcha #63.
//   · `handleActionResult()` lançava nas DUAS trilhas de sucesso (confirmada e
//     "já tratado por outro editor"), silenciosamente: a chamada é a última
//     instrução, e dentro da cadeia assíncrona do executor a exceção não chega
//     nem ao `window.onerror`. O que se perdia era o contador de conquistas —
//     5 das 16 ficaram INALCANÇÁVEIS.
//
// Nada disso aparece em `node --check` (é erro de execução, não de sintaxe),
// nem nos testes de unidade (eles FATIAM a fonte, não a rodam), nem no smoke
// de então (não exercitava o Desfazer até o fim).
//
// Este guard fecha a classe: toda chamada em posição de INSTRUÇÃO precisa ter
// declaração visível nos scripts que a app carrega.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A MESMA lista de scripts que o index.html carrega — todos compartilham o
// escopo global, então uma função de um arquivo vale nos outros.
const ARQUIVOS = ['app.js', 'api.js', 'i18n.js', 'version.js', 'mapa.js',
                  'qr.js', 'swipe.js', 'presenca.js', 'sw-register.js'];
const FONTE = Object.fromEntries(ARQUIVOS.map((f) =>
  [f, readFileSync(new URL('../js/' + f, import.meta.url), 'utf8')]));

// Apaga o CONTEÚDO do comentário e PRESERVA a linha: sem isso o número
// relatado é o da fonte encolhida e o guard aponta pro lugar errado (foi o que
// aconteceu ao escrevê-lo). Comentário fora também é o gotcha #67.
const semComentario = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');

const TUDO = semComentario(Object.values(FONTE).join('\n'));

function declaradas() {
  const d = new Set();
  const add = (re, i = 1) => { for (const m of TUDO.matchAll(re)) d.add(m[i]); };
  add(/(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g);
  add(/(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g);
  add(/(?:^|\s)class\s+([A-Za-z_$][\w$]*)/g);
  add(/window\.([A-Za-z_$][\w$]*)\s*=/g);
  // Parâmetros — é daqui que sai o `resolve` de `new Promise((resolve) => …)`.
  for (const re of [/\(([^()]{0,200})\)\s*=>/g, /function[^(]*\(([^()]{0,300})\)/g]) {
    for (const m of TUDO.matchAll(re)) {
      for (const p of m[1].split(',')) {
        const n = p.trim().replace(/[=:].*$/, '').replace(/[{}[\].\s]/g, '');
        if (/^[A-Za-z_$][\w$]*$/.test(n)) d.add(n);
      }
    }
  }
  return d;
}

// Globais do navegador que se chamam SEM prefixo (são do `window` implícito).
const GLOBAIS = new Set(['addEventListener', 'removeEventListener', 'dispatchEvent',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask',
  'fetch', 'alert', 'confirm', 'prompt', 'reportError', 'structuredClone',
  'scrollTo', 'scrollBy', 'focus', 'blur', 'close', 'print', 'postMessage']);

// Só posição de INSTRUÇÃO (`nome(...);` sozinho na linha). Restringir assim é o
// que torna o guard utilizável: a varredura de QUALQUER `nome(` devolvia 147
// candidatos — método de objeto literal, propriedade e pedaço de frase do
// dicionário —, e guard com 147 falsos positivos ninguém lê.
const CHAMADA = /^\s*([a-z][A-Za-z0-9_$]{2,})\((?:[^()]|\([^()]*\))*\);\s*$/;

function orfas() {
  const d = declaradas();
  const fora = [];
  for (const [arq, s] of Object.entries(FONTE)) {
    semComentario(s).split('\n').forEach((linha, i) => {
      const m = CHAMADA.exec(linha);
      if (!m || d.has(m[1]) || GLOBAIS.has(m[1])) return;
      fora.push(`js/${arq}:${i + 1} → ${m[1]}()`);
    });
  }
  return fora;
}

test('nenhuma função é CHAMADA sem existir', () => {
  const fora = orfas();
  assert.deepEqual(fora, [],
    'chamada a função que não está declarada em nenhum script carregado — '
    + '`node --check` não vê (é erro de execução) e os testes de unidade não '
    + 'veem (eles fatiam a fonte, não a rodam):\n  ' + fora.join('\n  '));
});

test('o guard enxerga a sabotagem (senão ele é decoração)', () => {
  // A prova de que ele reprovaria: as duas funções que a #215 apagou, com os
  // call sites de então. Se este bloco passar limpo, o teste acima não vale.
  const d = declaradas();
  for (const nome of ['registrarAcaoConfirmada', 'registrarDesfazer']) {
    assert.ok(d.has(nome), `${nome} voltou a sumir — era exatamente este o defeito`);
  }
  const inventado = '        funcaoQueNaoExisteEmLugarNenhum(1, 2);';
  assert.ok(CHAMADA.test(inventado), 'o padrão não reconhece uma chamada de instrução');
  assert.ok(!d.has('funcaoQueNaoExisteEmLugarNenhum'), 'o coletor inventou uma declaração');
  // E não pode acusar o que é legítimo: método de objeto e global implícito.
  assert.ok(!CHAMADA.test('    isOpen: () => !!Lightbox.urls,'), 'acusaria método de objeto literal');
  assert.ok(GLOBAIS.has('addEventListener'), 'o global implícito do window viraria falso positivo');
});
