// O selo "✕ N" do autor mostrava SEMPRE uma rejeição a menos que o Histórico no card
// seguinte ao ✕ (relato do dono, 2026-11-15): o card seguinte entra na tela no gesto,
// com a contagem de ANTES, e a rejeição só entra nela quando o Waze confirma
// (`registrarRejeicaoDeAutor`, no pouso) — e ninguém redesenhava o selo depois.
// MEDIDO no navegador, com o Desfazer desligado: card e fundo "✕ 5", contagem do
// aparelho 6 depois da resposta.
//
// Agora registrar a rejeição agenda UM redesenho dos selos (card da frente e card de
// fundo do mesmo autor). Estes testes rodam o código de verdade, fatiado do app.js,
// com a tela de mentira; cada um tem o CONTROLE e o guard foi visto REPROVANDO com o
// gancho removido.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}') { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
// As duas declarações de estado, do FONTE (sabotar a declaração reprova).
const declaracao = (re, nome) => {
  const m = re.exec(APP_SEM);
  assert.ok(m, `a declaração de ${nome} sumiu do app.js`);
  return m[0];
};
const DECLARACOES = [
  declaracao(/^const autoresComContagemNova = new Set\(\);$/m, 'autoresComContagemNova'),
];

// Uma tela de mentira: o card da frente é do autor `frente`, o de fundo (`queue[1]`) do `fundo`.
function tela({ frente, fundo, aquecido = true, fundoNaTela = true, semCard = false } = {}) {
  const chamadas = [];
  const guardado = { r: {}, v: [] };
  const AppState = {
    currentPlace: frente === undefined ? null : { updateRequestID: 'u0', creatorId: frente },
    queue: [{ updateRequestID: 'u0', creatorId: frente }, fundo === undefined ? undefined : { updateRequestID: 'u1', creatorId: fundo }],
  };
  const deps = {
    AppState,
    loadAutores: () => guardado,
    salvarAutores: (a) => { chamadas.push('salvou:' + JSON.stringify(a.r)); },
    contagemDoHistorico: (n) => Number(n) || 0,
    diaDeHoje: () => 20407,
    podarAutores: () => {},
    cardDaFrente: () => (semCard ? null : {}),
    aoMudarAFilaPorBaixo: () => chamadas.push('frente'),
    montarCardDeFundo: () => chamadas.push('fundo'),
    document: { querySelector: () => (fundoNaTela ? {} : null) },
    console: { error: (...a) => chamadas.push('erro:' + a[0]) },
  };
  const nomes = ['registrarRejeicaoDeAutor', 'agendarSelosDoAutor', 'refazerSelosDosAutores'];
  const chaves = Object.keys(deps);
  const fonte = [
    `let aquecimentoDaFrenteFeito = ${aquecido};`,
    ...DECLARACOES,
    ...nomes.map(fatiar),
    `return { ${nomes.join(', ')} };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  return { app, AppState, chamadas, guardado, deps };
}
const microtarefas = () => new Promise((r) => setTimeout(r, 0));
const redesenhos = (c) => c.filter((x) => x === 'frente' || x === 'fundo');
const pedido = (id) => ({ creatorId: id, createdBy: 'world_x' + id });

test('a rejeição registrada refaz os selos do card da FRENTE do mesmo autor — e só depois de contar', async () => {
  const t = tela({ frente: 777, fundo: 888 });
  t.guardado.r['777'] = [5, 'world_x', 20407];
  t.app.registrarRejeicaoDeAutor(pedido(777));
  assert.equal(t.guardado.r['777'][0], 6, 'PRÉ-CONDIÇÃO: a contagem não subiu');
  assert.deepEqual(redesenhos(t.chamadas), [], 'DEFEITO: o redesenho rodou antes de a tarefa acabar (lia a contagem velha?)');
  await microtarefas();
  assert.deepEqual(redesenhos(t.chamadas), ['frente'],
    `DEFEITO: o card da frente do autor ficou com o número de antes: ${JSON.stringify(t.chamadas)}`);
});

test('o card de FUNDO do mesmo autor também é refeito (ele é um clone do que foi desenhado antes)', async () => {
  const t = tela({ frente: 111, fundo: 777 });
  t.guardado.r['777'] = [5, 'world_x', 20407];
  t.app.registrarRejeicaoDeAutor(pedido(777));
  await microtarefas();
  assert.deepEqual(redesenhos(t.chamadas), ['fundo'],
    `DEFEITO: o fundo do autor seguiu com o número de antes: ${JSON.stringify(t.chamadas)}`);
});

test('frente E fundo do mesmo autor: os dois, uma vez cada', async () => {
  const t = tela({ frente: 777, fundo: 777 });
  t.guardado.r['777'] = [5, 'world_x', 20407];
  t.app.registrarRejeicaoDeAutor(pedido(777));
  await microtarefas();
  assert.deepEqual(redesenhos(t.chamadas).sort(), ['frente', 'fundo']);
});

test('CONTROLE: outro autor na frente e no fundo não redesenha nada', async () => {
  const t = tela({ frente: 111, fundo: 222 });
  t.guardado.r['777'] = [5, 'world_x', 20407];
  t.app.registrarRejeicaoDeAutor(pedido(777));
  await microtarefas();
  assert.deepEqual(redesenhos(t.chamadas), [], 'redesenhou card de OUTRO autor');
});

test('CONTROLE: sem rejeição registrada (pedido sem autor) nada é agendado nem redesenhado', async () => {
  for (const id of [null, undefined, '']) {
    const t = tela({ frente: 777, fundo: 777 });
    t.app.registrarRejeicaoDeAutor({ creatorId: id });
    await microtarefas();
    assert.deepEqual(t.chamadas, [], `creatorId=${JSON.stringify(id)} mexeu em algo: ${t.chamadas}`);
  }
});

test('várias rejeições do MESMO autor na mesma tarefa (o "Rejeitar os N") refazem UMA vez', async () => {
  const t = tela({ frente: 777, fundo: 777 });
  t.guardado.r['777'] = [5, 'world_x', 20407];
  for (let i = 0; i < 25; i++) t.app.registrarRejeicaoDeAutor(pedido(777));
  assert.equal(t.guardado.r['777'][0], 30, 'PRÉ-CONDIÇÃO: nem todas contaram');
  await microtarefas();
  assert.deepEqual(redesenhos(t.chamadas).sort(), ['frente', 'fundo'], `refez mais de uma vez: ${redesenhos(t.chamadas)}`);
  // E nada fica preso: a rejeição seguinte, noutra tarefa, refaz de novo.
  t.chamadas.length = 0;
  t.app.registrarRejeicaoDeAutor(pedido(777));
  await microtarefas();
  assert.deepEqual(redesenhos(t.chamadas).sort(), ['frente', 'fundo'], 'o conjunto ficou preso depois da primeira rodada');
});

test('o fundo só é refeito se já existe na tela e o aquecimento já o montou', async () => {
  const a = tela({ frente: 111, fundo: 777, aquecido: false });
  a.guardado.r['777'] = [5, 'world_x', 20407];
  a.app.registrarRejeicaoDeAutor(pedido(777));
  await microtarefas();
  assert.deepEqual(redesenhos(a.chamadas), [], 'montou o fundo antes do aquecimento (ele nasce na hora dele)');
  const b = tela({ frente: 111, fundo: 777, fundoNaTela: false });
  b.guardado.r['777'] = [5, 'world_x', 20407];
  b.app.registrarRejeicaoDeAutor(pedido(777));
  await microtarefas();
  assert.deepEqual(redesenhos(b.chamadas), [], 'montou um fundo que não está na tela');
});

test('sem card na tela (o "Tudo limpo!" ou a abertura) nada é redesenhado', async () => {
  const t = tela({ frente: 777, fundo: 777, semCard: true });
  t.guardado.r['777'] = [5, 'world_x', 20407];
  t.app.registrarRejeicaoDeAutor(pedido(777));
  await microtarefas();
  assert.deepEqual(redesenhos(t.chamadas), []);
});

test('um defeito no redesenho nunca derruba a rejeição que acabou de ser registrada', async () => {
  const t = tela({ frente: 777, fundo: 888 });
  t.guardado.r['777'] = [5, 'world_x', 20407];
  const original = t.deps.aoMudarAFilaPorBaixo;
  // Refaz o ambiente com um redesenho que lança.
  const chaves = Object.keys(t.deps);
  t.deps.aoMudarAFilaPorBaixo = () => { throw new Error('quebrou o selo'); };
  const fonte = [
    'let aquecimentoDaFrenteFeito = true;', ...DECLARACOES,
    ...['registrarRejeicaoDeAutor', 'agendarSelosDoAutor', 'refazerSelosDosAutores'].map(fatiar),
    'return { registrarRejeicaoDeAutor };',
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => t.deps[k]));
  assert.doesNotThrow(() => app.registrarRejeicaoDeAutor(pedido(777)));
  await microtarefas();
  assert.equal(t.guardado.r['777'][0], 6, 'a contagem não foi gravada');
  assert.ok(t.chamadas.some((c) => c.startsWith('erro:')), 'o erro do redesenho sumiu calado');
  void original;
});

test('estrutura: o gancho vem DEPOIS de gravar, e a contagem segue sendo a CONFIRMADA (não a do gesto)', () => {
  const corpo = fatiar('registrarRejeicaoDeAutor');
  const gravou = corpo.indexOf('salvarAutores(a);');
  const agendou = corpo.indexOf('agendarSelosDoAutor(chave)');
  assert.ok(gravou > 0 && agendou > gravou, 'o redesenho precisa vir DEPOIS de salvarAutores (leria a contagem velha)');
  assert.match(corpo, /typeof agendarSelosDoAutor === 'function'/, 'o gancho perdeu a guarda dos harnesses que fatiam a função');
  // O gesto (✕) NÃO conta no selo antes da confirmação: o handler não toca na reincidência.
  for (const h of ['handleReject']) {
    assert.doesNotMatch(fatiar(h), /registrarRejeicaoDeAutor|agendarSelosDoAutor/, `${h} passou a contar o autor no gesto`);
  }
});
