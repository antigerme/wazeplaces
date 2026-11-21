// Os portões do app: quem passa, e quem tem o direito de decidir isso.
//
// O app tem DOIS níveis, e o par é deliberado:
//   · ENTRAR é L2+AM (L3+AM até 2026-09-09) — `isUserAllowed`, no SERVIDOR. É o portão de verdade, e
//     `test/core.test.mjs` já cobre a matriz dele.
//   · AGIR de forma destrutiva é L5+AM (L6+AM até 2026-11-21) — `podeAgirDestrutivoAqui`, só do
//     CLIENTE, lendo `MIN_RANK_DESTRUTIVO`. Este arquivo é o que faltava: até agora nada reprovava
//     quem trocasse a comparação por uma cópia solta.
//
// O portão do cliente ser só do cliente é decisão, não esquecimento (gotcha
// #59): o Waze valida `permissions`/`lockRank` na gravação. O que se guarda
// aqui é a TRAVA DE PRODUTO — que o recurso não apareça pra qualquer editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIN_RANK_WAZE_DISPLAY } from './_gates-helper.mjs';

const fonte = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');

// Fatia a função e a executa num escopo de mentira — mesmo padrão do
// test/qr.test.mjs. Fatiar em vez de reimplementar é o que garante que o teste
// exercite o código que roda no aparelho. A constante vem JUNTO: ela mora logo
// antes da função, e a função LÊ dela — fatiar só a função sem ela deixaria
// `MIN_RANK_DESTRUTIVO` indefinida no escopo de mentira.
const INICIO_CONST = 'const MIN_RANK_DESTRUTIVO = ';
const INICIO = 'function podeAgirDestrutivoAqui() {';
assert.ok(fonte.includes(INICIO_CONST), 'a constante do portão dos destrutivos sumiu do app.js');
assert.ok(fonte.includes(INICIO), 'o portão dos destrutivos sumiu do app.js');
const trecho = fonte.slice(fonte.indexOf(INICIO_CONST), fonte.indexOf('\n}\n', fonte.indexOf(INICIO)) + 2);

function comPerfil(profile) {
  const escopo = { AppState: { profile } };
  return new Function('AppState', trecho + '\nreturn podeAgirDestrutivoAqui();')(escopo.AppState);
}

test('portão L5: a matriz de quem passa', () => {
  // rank do Waze é 0-indexed: 4 aqui é o L5 que o editor vê (gotcha #15).
  assert.equal(comPerfil({ isStaff: true, rank: 0, isAreaManager: false }), true, 'staff passa em qualquer nível');
  assert.equal(comPerfil({ rank: 4, isAreaManager: true }), true, 'L5 + AM passa');
  assert.equal(comPerfil({ rank: 5, isAreaManager: true }), true, 'acima de L5 (L6) passa');
  assert.equal(comPerfil({ rank: 4, isAreaManager: false }), false, 'L5 SEM AM não passa');
  assert.equal(comPerfil({ rank: 3, isAreaManager: true }), false, 'L4 + AM não passa');
  assert.equal(comPerfil({ rank: 3, isAreaManager: false }), false, 'L4 sem AM não passa');
  assert.equal(comPerfil(null), false, 'sem perfil não passa');
  assert.equal(comPerfil(undefined), false, 'perfil ausente não passa');
});

// NÃO existe teste de "rank em texto": ele foi escrito, sabotado e removido.
// A ideia era travar a normalização (`Number.isInteger(p.rank) ? p.rank :
// parseInt(...)`) contra alguém simplificar pra `p.rank >= MIN_RANK_DESTRUTIVO`.
// Mas as duas formas concordam em tudo que importa — `'4' >= 4` coage pra true,
// `'abc' >= 4` dá false — e o único valor que as separa é `'4abc'`, que a versão
// atual ACEITA como L5. Travar isso seria afirmar que "4abc" é um rank válido,
// o que é pior que não testar. A guarda que de fato protege este portão é a de
// baixo: ninguém re-implementa a comparação.

test('portão L5: NINGUÉM re-implementa a comparação', () => {
  // É esta a guarda que protege o próximo recurso. Sem ela, o jeito mais fácil
  // de adicionar um quarto destrutivo é copiar `rank >= 4 && isAreaManager` (ou
  // qualquer outro número) — e aí existem dois portões que precisam mudar
  // juntos, e um vai ficar pra trás.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const i = semComentarios.indexOf(INICIO_CONST);
  const fora = semComentarios.slice(0, i) + semComentarios.slice(semComentarios.indexOf('\n}\n', semComentarios.indexOf(INICIO)));
  const copias = [...fora.matchAll(/rank\s*>=\s*\d+/g)];
  assert.equal(copias.length, 0,
    'alguém comparou rank >= N fora do portão: delegue a podeAgirDestrutivoAqui() em vez de copiar');
});

test('portão L5: cada recurso tem o SEU nome, e todos delegam', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  // Os delegadores conhecidos hoje. Recurso novo entra aqui junto com o seu.
  const DELEGADORES = ['podeExcluirFotoAqui', 'podeRenomearAqui', 'podeAprovarAtual',
                       'podeRecusarAutomaticoAqui', 'conquistasComPortaoAqui'];
  for (const nome of DELEGADORES) {
    assert.ok(semComentarios.includes(nome), `${nome} sumiu`);
  }
  // A base não pode ser chamada por ninguém além dos delegadores: o call site
  // direto é o que faz "separar um recurso" virar caçada por call sites.
  const chamadas = [...semComentarios.matchAll(/podeAgirDestrutivoAqui\(\)/g)].length;
  assert.ok(chamadas <= DELEGADORES.length + 1,
    `a base é chamada ${chamadas} vezes; esperado no máximo ${DELEGADORES.length + 1}`
    + ' (um por delegador + a própria definição). Recurso novo precisa da sua função.');

  // E o CLAUDE.md nomeia os MESMOS. Este guard existe porque a lista JÁ
  // divergiu: `podeRecusarAutomaticoAqui` entrou aqui e nunca chegou ao doc,
  // então o arquivo que descreve os portões listava três de quatro — e o
  // esquecido é o único que rejeita SOZINHO, em lote. Sem isto, a divergência é
  // invisível: o teste passa, o doc mente, e quem lê o doc é o próximo agente.
  const doc = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
  for (const nome of DELEGADORES) {
    assert.ok(doc.includes(nome),
      `${nome} delega ao portão destrutivo mas não está nomeado no CLAUDE.md (gotcha #16)`);
  }
});

test('portões: ENTRAR (L2, servidor) e AGIR (L5, cliente) são níveis diferentes de propósito', () => {
  // Não é inconsistência: entrar é amplo, agir destrutivamente é estreito. O
  // teste existe pra que mexer num não arraste o outro sem alguém decidir.
  const m = core.match(/const MIN_RANK_WAZE = (\d+);/);
  assert.ok(m, 'MIN_RANK_WAZE sumiu do core');
  const entrar = parseInt(m[1], 10);
  assert.equal(entrar + 1, MIN_RANK_WAZE_DISPLAY, 'o nível de ENTRADA mudou — foi decisão?');
  const g = fonte.match(/const MIN_RANK_DESTRUTIVO = (\d+);/);
  assert.ok(g, 'a constante do portão dos destrutivos mudou de forma');
  const agir = parseInt(g[1], 10);
  assert.ok(agir > entrar,
    `agir (L${agir + 1}) tem que ser MAIS restrito que entrar (L${entrar + 1}) — se ficaram iguais,`
    + ' um dos dois portões perdeu o sentido e a decisão é do owner');
});
