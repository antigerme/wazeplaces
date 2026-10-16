// "Rejeitado hoje / há N dias" conta o DIA LOCAL, não o UTC (auditoria de
// 2026-09-25). Roda com o fuso de SÃO PAULO — um processo por arquivo no
// `node --test`, então isto não vaza. Lá, das 21h à meia-noite o dia UTC já é
// o seguinte: o rejeitado às 20h aparecia "há 1 dia" às 21h30 do MESMO dia, e o
// das 22h30 seguia "hoje" no dia seguinte inteiro.
process.env.TZ = 'America/Sao_Paulo';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, nome + ' sumiu do app.js');
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', APP_SEM.indexOf(')', m.index)); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) return APP_SEM.slice(m.index, j + 1); }
  }
  throw new Error('não fechou ' + nome);
}

// O relógio da página, parado onde o teste mandar.
function relogio() {
  const r = { agora: 0 };
  r.Date = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(r.agora); }
    static now() { return r.agora; }
  };
  return r;
}
function montar() {
  const r = relogio();
  const M = new Function('Date', 't', fatiar('diaDeHoje') + '\n' + fatiar('rejeitadoQuando')
    + '\nreturn { diaDeHoje, rejeitadoQuando };')(r.Date, (k, v) => k + (v ? JSON.stringify(v) : ''));
  return { ...M, em: (iso) => { r.agora = new Date(iso).getTime(); } };
}

test('controle do instrumento: o fuso do teste é mesmo o de São Paulo', () => {
  const d = new Date('2026-09-24T22:30:00-03:00');
  assert.equal(d.getDate(), 24, 'o fuso não pegou: 22h30 em São Paulo ainda é dia 24 lá');
  assert.equal(d.getUTCDate(), 25, 'CONTROLE: em UTC já é dia 25 — é essa diferença que o teste mede');
});

test('rejeitado às 20h e visto às 21h30 do MESMO dia local: "hoje"', () => {
  const m = montar();
  m.em('2026-09-24T20:00:00-03:00'); const dia = m.diaDeHoje();
  m.em('2026-09-24T21:30:00-03:00');
  assert.equal(m.rejeitadoQuando(dia), 'stats.autores.rejeitadoHoje',
    'o mesmo dia local apareceu como "há 1 dia" — o dia contado é o UTC');
});

test('rejeitado às 22h30 e visto no dia seguinte: "há 1 dia", de manhã e à noite', () => {
  const m = montar();
  m.em('2026-09-24T22:30:00-03:00'); const dia = m.diaDeHoje();
  for (const hora of ['2026-09-25T08:00:00-03:00', '2026-09-25T20:59:00-03:00']) {
    m.em(hora);
    assert.equal(m.rejeitadoQuando(dia), 'stats.autores.rejeitadoDias{"n":1}',
      `às ${hora.slice(11, 16)} do dia seguinte ainda dizia "hoje" — o dia contado é o UTC`);
  }
});
