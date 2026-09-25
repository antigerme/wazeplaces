// O HORÁRIO DE VERÃO no Histórico (auditoria de 2026-09-25). O dia da troca tem
// 23 ou 25 horas, e o app somava 86.400.000 ms por dia: a sequência de 6 dias
// atravessando o fim do horário de verão da Europa (25/10/2026) contava 7, e a
// "idade" dos baldes errava por um perto da meia-noite. Roda com o fuso de
// PARIS — um processo por arquivo no `node --test`, então isto não vaza.
process.env.TZ = 'Europe/Paris';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, nome + ' sumiu');
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', APP_SEM.indexOf(')', m.index)); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) return APP_SEM.slice(m.index, j + 1); }
  }
  throw new Error('não fechou');
}
const dias = (...ks) => Object.fromEntries(ks.map((k) => [k, { read: 1, rejected: 0 }]));

test('controle do instrumento: o fuso do teste é mesmo o de Paris, e o 25/10/2026 tem 25 horas', () => {
  const h = (new Date(2026, 9, 26).getTime() - new Date(2026, 9, 25).getTime()) / 3600000;
  assert.equal(h, 25, `o dia 25/10 tem ${h} h — o fuso não pegou, e o teste abaixo mediria nada`);
});

test('a maior sequência atravessando o fim do horário de verão conta os dias de CALENDÁRIO', () => {
  const M = new Function(fatiar('chaveMaisDias') + '\n' + fatiar('maiorSequenciaDeDias') + '\nreturn maiorSequenciaDeDias;')();
  assert.equal(M(dias('2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27')), 6);
  // E a do início do horário de verão (29/03/2026, 23 h).
  assert.equal(M(dias('2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30')), 4);
  // Buraco quebra a sequência.
  assert.equal(M(dias('2026-10-24', '2026-10-26')), 1);
});

test('a idade dos baldes do Histórico é em dias de calendário, a qualquer hora', () => {
  const idade = new Function(fatiar('diasEntreChaves') + '\nreturn diasEntreChaves;')();
  assert.equal(idade('2026-10-21', '2026-10-27'), 6);
  assert.equal(idade('2026-10-20', '2026-10-27'), 7);
  assert.equal(idade('2026-10-27', '2026-10-27'), 0);
  assert.equal(idade('2026-03-28', '2026-03-30'), 2);
  const stats = fatiar('getHistoryStats');
  assert.match(stats, /const ageDays = diasEntreChaves\(k, tk\);/, 'a idade voltou a sair de milissegundo local');
});
