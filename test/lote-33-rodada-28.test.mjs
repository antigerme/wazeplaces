// Rodada 28 (ponta a ponta), os três defeitos pequenos do R28-8 que mudam comportamento. Cada teste reprova sem o conserto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const API_JS = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');

function fatiar(fonte, nome, async_ = false) {
  const ini = fonte.indexOf(`${async_ ? 'async ' : ''}function ${nome}(`);
  assert.ok(ini >= 0, `${nome} sumiu`);
  let par = 0, i = fonte.indexOf('(', ini);
  for (let j = i; j < fonte.length; j++) { if (fonte[j] === '(') par++; else if (fonte[j] === ')') { par--; if (par === 0) { i = j + 1; break; } } }
  i = fonte.indexOf('{', i);
  let prof = 0;
  for (let j = i; j < fonte.length; j++) { if (fonte[j] === '{') prof++; else if (fonte[j] === '}') { prof--; if (prof === 0) return fonte.slice(ini, j + 1); } }
  throw new Error('chave não fechou');
}

// R28-8-03: «Entrar» com o campo do código vazio não vai ao servidor.
async function resgatar(codigo, { silencioso = false } = {}) {
  const idas = [];
  const erro = { textContent: '', classList: { removido: false, remove() { this.removido = true; } } };
  const document = { getElementById: (id) => (id === 'pairEnterModal' ? { classList: { contains: () => false } } : id === 'pairEnterError' ? erro : null) };
  const API = { resgatarPareamento: async (c) => { idas.push(c); return { success: false, error: 'servidor' }; } };
  const fn = new Function('document', 'API', 't', 'showToast', 'msgDoServidor',
    `let resgateEmVoo = false; let resgateNoAr = null;\n${fatiar(APP, 'resgatarPareamento', true)}\nreturn resgatarPareamento;`)(
    document, API, (k) => k, () => {}, (r, d) => d);
  const r = await fn(codigo, { silencioso });
  return { r, idas, erro };
}

test('R28-8-03: campo do código vazio (ou só espaço e traço) NÃO vai ao servidor e diz «digite o código»', async () => {
  for (const vazio of ['', '   ', ' - ', '\n']) {
    const { r, idas, erro } = await resgatar(vazio);
    assert.equal(r, false);
    assert.deepEqual(idas, [], `foi ao servidor com «${JSON.stringify(vazio)}»`);
    assert.equal(erro.textContent, 'toast.pairVazio', 'a mensagem local não apareceu');
    assert.equal(erro.classList.removido, true, 'o erro continua escondido');
  }
});

test('R28-8-03 (controle): com um código, o resgate segue ao servidor', async () => {
  const { idas } = await resgatar('K7M-4QX');
  assert.deepEqual(idas, ['K7M-4QX']);
});

// R28-8-04: sem rede de verdade o erro diz «sinal», o termo do resto do app.
function falhaDoPost(onLine) {
  const t = (k) => ({ 'api.error.connection': 'Erro de conexão', 'api.error.semSinal': 'Sem sinal' }[k] || k);
  const m = API_JS.match(/error: (t\(typeof navigator[^\n]*?'api\.error\.connection'\)),/);
  assert.ok(m, 'a escolha da frase da falha de rede sumiu do api.js');
  const navigator = onLine === undefined ? undefined : { onLine };
  return { error: new Function('t', 'navigator', `return ${m[1]};`)(t, navigator) };
}

test('R28-8-04: com `onLine === false` a falha de rede diz «Sem sinal»; com `true` (que não prova rede) segue «Erro de conexão»', () => {
  assert.equal(falhaDoPost(false).error, 'Sem sinal');
  assert.equal(falhaDoPost(true).error, 'Erro de conexão');
  assert.equal(falhaDoPost(undefined).error, 'Erro de conexão', 'sem `navigator` (harness) não pode lançar');
});

// R28-8-05: o aviso de queda some quando a pessoa entra de novo.
test('R28-8-05: entrar de novo tira da tela o aviso «sua sessão não vale mais» (não ficam os dois juntos)', () => {
  let removido = 0;
  const aviso = { naTela: () => true, remover: () => { removido++; } };
  const fn = new Function('avisoDaQueda0', `let avisoDaQueda = avisoDaQueda0; let saiuNestaPagina = true, sessaoCaiuNestaPagina = true, extNegadoNestaPagina = true, extNegado = {};
    ${fatiar(APP, 'aoEntrarNestaPagina')}\n aoEntrarNestaPagina(); return { avisoDaQueda };`);
  const r = fn(aviso);
  assert.equal(removido, 1, 'o aviso de queda continuou na tela');
  assert.equal(r.avisoDaQueda, null);
  assert.match(APP, /avisoDaQueda = showToast\(t\(MOTIVO_DA_QUEDA/, 'o aviso de queda não guarda o punho do toast');
});
