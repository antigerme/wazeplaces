// O VALOR de uma linha do diff depende do CAMPO — auditoria de 2026-09-26.
//
// `lockRank` é 0-indexado como o rank (gotcha #15), e o card mostrava o número
// cru: "Nível de trava: 0 → 4" onde o WME diz 1 → 5. O `renderCardChanges` de
// verdade roda aqui sobre um card de mentira; o que se confere é o HTML que
// ele escreve na lista.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', APP_SEM.indexOf(')', m.index)); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) return APP_SEM.slice(m.index, j + 1);
  }
  throw new Error('não fechou ' + nome);
}

// As linhas que o `renderCardChanges` escreve, lidas de volta do HTML: [de, para].
function linhas(changes) {
  const lista = { innerHTML: '' };
  const card = { querySelector: (s) => (s === '.card-changes-list' ? lista : { classList: { remove() {}, add() {} } }) };
  const deps = {
    t: (k) => ({ 'card.value.empty': '(vazio)', 'card.value.yes': 'Sim', 'card.value.no': 'Não', 'card.value.unnamed': '(sem nome)' }[k] || k),
    escapeHtml: (x) => String(x), realceDoMiolo: () => null, rotuloDoCampo: (c) => c.field,
  };
  const render = new Function(...Object.keys(deps),
    ['valorDoDiff', 'valorDoDiffDoCampo', 'renderCardChanges'].map(fatiar).join('\n') + '\nreturn renderCardChanges;')(
    ...Object.values(deps));
  render(card, { changes });
  return [...lista.innerHTML.matchAll(/<span class="diff-from">([^<]*)<\/span><span class="diff-to">([^<]*)<\/span>/g)]
    .map((m) => [m[1], m[2]]);
}

test('lockRank: o diff mostra o NÍVEL do WME (rank + 1), e o vazio segue vazio', () => {
  assert.deepEqual(linhas([{ field: 'lockRank', label: 'LockRank', from: 0, to: 4 }]), [['1', '5']],
    'o nível de trava saiu 0-indexado: o WME mostra 1 → 5');
  // As tipagens do WME dão `lockRank` de local como número SEMPRE: o vazio é o
  // Waze não ter mandado o campo, e "(vazio)" diz exatamente isso.
  assert.deepEqual(linhas([{ field: 'lockRank', label: 'LockRank', from: null, to: 2 }]), [['(vazio)', '3']]);
});

test('lockRank CONTROLE: o +1 é SÓ do lockRank — outro número segue cru, e o especial segue traduzido', () => {
  // Sem este controle, "somar 1 em todo número" passaria no teste acima.
  assert.deepEqual(linhas([{ field: 'houseNumber', label: 'HouseNumber', from: 0, to: 4 }]), [['0', '4']],
    'o +1 do nível de trava vazou pra outro campo numérico');
  assert.deepEqual(linhas([{ field: 'residential', label: 'Residential', from: true, to: false }]), [['Sim', 'Não']]);
  // E o que não é inteiro no lockRank (um dado estranho) não vira "NaN" nem soma.
  assert.deepEqual(linhas([{ field: 'lockRank', label: 'LockRank', from: '2', to: 1.5 }]), [['2', '1.5']]);
});
