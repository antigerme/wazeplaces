// A marca de quem está na NOSSO app, gravada na posição da presença do WME
// (`server/marca-app.mjs`).
//
// O que ela precisa garantir, e que este arquivo cobra com dado REAL (os
// pedidos de `tools/fixtures-paises.json`, dos seis países obrigatórios):
//   · a posição marcada TEM a marca e carrega o país da fila;
//   · o deslocamento fica no teto prometido (50 µ° na lat, 500 µ° na lon);
//   · ninguém sai do mundo, nem perto do meridiano de Greenwich e do equador;
//   · a marca sobrevive ao fio: o codec escreve exatamente os inteiros marcados;
//   · e posição QUALQUER quase nunca parece marcada (a taxa de falso positivo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marcarPosicao, temMarcaDaApp, paisDaMarca, paisValido, MARCA_APP, PAIS_MAX } from '../server/marca-app.mjs';
import * as g from '../server/wme-grpc.mjs';
import { PAISES_OBRIGATORIOS } from '../tools/paises-validacao.mjs';

const FIXTURES = JSON.parse(readFileSync(new URL('../tools/fixtures-paises.json', import.meta.url), 'utf8'));
const idDoPais = Object.fromEntries(PAISES_OBRIGATORIOS.map((p) => [p.nome, p.id]));
const micro = (x) => Math.round(x * 1e6);
const um = (campos, n) => campos.find((c) => c.n === n)?.v;
const assinado = (v) => Number(BigInt.asIntN(64, BigInt(v)));

test('marca: nos pedidos REAIS dos seis países, a posição marcada tem a marca e o país da fila', () => {
  let n = 0;
  for (const p of FIXTURES) {
    const pais = idDoPais[p._pais];
    assert.ok(pais, `fixture sem país conhecido: ${p._pais}`);
    const centro = p.mapa && p.mapa.centro;
    if (!Array.isArray(centro)) continue;
    // `mapa.centro` é [lat, lon] (o core inverte o GeoJSON) — ler ao contrário
    // daria lugar plausível e errado; aqui a ordem é a do app.
    const [lat, lon] = centro;
    const m = marcarPosicao({ lat, lon }, pais);
    assert.ok(temMarcaDaApp(m), `${p._pais}: sem a marca do app`);
    assert.equal(paisDaMarca(m), pais, `${p._pais}: o país não foi na marca`);
    assert.ok(Math.abs(micro(m.lat) - micro(lat)) <= 50, `${p._pais}: a latitude andou mais que 50 µ°`);
    assert.ok(Math.abs(micro(m.lon) - micro(lon)) <= 500, `${p._pais}: a longitude andou mais que 500 µ°`);
    n++;
  }
  // Controle: se a fixture viesse sem coordenadas, o laço passaria sem medir nada.
  assert.ok(n >= 40, `só ${n} pedidos com centro — a fixture mudou?`);
});

test('marca: sobrevive ao FIO — o codec escreve exatamente os inteiros marcados', () => {
  for (const [lat, lon, pais] of [[-12.597498, -39.511208, 30], [48.856613, 2.352222, 73], [51.507351, -0.127758, 234],
    [19.432608, -99.133209, 145], [40.416775, -3.70379, 203], [38.722252, -9.139337, 181]]) {
    const m = marcarPosicao({ lat, lon }, pais);
    const corpo = g.corpoAtualizarPresenca({ userId: '12444348', ...m });
    const editor = g.lerCampos(um(g.lerCampos(corpo), 1));
    const ll = g.lerCampos(um(editor, 2));
    const latU = assinado(um(ll, 102)), lonU = assinado(um(ll, 101));
    const resto = (u, m) => ((u % m) + m) % m;
    assert.equal(resto(latU, 100), MARCA_APP, `${pais}: a marca não sobreviveu ao ×1e6 do codec`);
    assert.equal(resto(lonU, 1000), pais, `${pais}: o país não sobreviveu ao ×1e6 do codec`);
    // E a volta: o que o Waze devolve (lerEditorOnline divide por 1e6) é lido
    // como marcado de novo.
    assert.ok(temMarcaDaApp({ lat: latU / 1e6 }));
    assert.equal(paisDaMarca({ lon: lonU / 1e6 }), pais);
  }
});

test('marca: posição QUALQUER quase nunca parece marcada (1 em 100 na marca, 1 em 100 mil com o país)', () => {
  // Gerador determinístico: o teste não pode passar ou falhar por sorte.
  let s = 20260923;
  const aleatorio = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const N = 200000;
  let comMarca = 0, comMarcaEPais = 0;
  for (let i = 0; i < N; i++) {
    const p = { lat: -60 + aleatorio() * 130, lon: -180 + aleatorio() * 360 };
    if (temMarcaDaApp(p)) {
      comMarca++;
      if (paisDaMarca(p) === 30) comMarcaEPais++;
    }
  }
  // 1% esperado (2000 em 200 mil); a faixa é larga o bastante pra não ser
  // frágil e estreita o bastante pra reprovar uma marca de 1 dígito (10%).
  assert.ok(comMarca > 1500 && comMarca < 2500, `taxa da marca fora do esperado: ${comMarca}/${N}`);
  assert.ok(comMarcaEPais <= 10, `marca + país por acaso demais: ${comMarcaEPais}/${N}`);
});

test('marca: o CONTROLE — a mesma posição sem marcar não passa por marcada', () => {
  // Sem este controle, um `temMarcaDaApp` que devolvesse sempre true passaria
  // em todos os testes acima.
  let semMarca = 0;
  for (const p of FIXTURES) {
    const c = p.mapa && p.mapa.centro;
    if (Array.isArray(c) && !temMarcaDaApp({ lat: c[0] })) semMarca++;
  }
  assert.ok(semMarca >= 40, `posições cruas lidas como marcadas: sobraram só ${semMarca} sem marca`);
});

test('marca: nos extremos do mundo ninguém sai do mapa, e perto do zero o teto continua valendo', () => {
  for (const [lat, lon] of [[89.99999, 179.99999], [-89.99999, -179.99999], [-0.00001, 0.0000123], [0, 0], [0.00002, -0.00002]]) {
    for (const pais of [1, 30, 999]) {
      const m = marcarPosicao({ lat, lon }, pais);
      assert.ok(Math.abs(m.lat) <= 90 && Math.abs(m.lon) <= 180, `${lat},${lon} saiu do mundo`);
      assert.ok(temMarcaDaApp(m) && paisDaMarca(m) === pais, `${lat},${lon},${pais}: sem marca`);
      assert.ok(Math.abs(micro(m.lat) - micro(lat)) <= 50, 'latitude andou demais');
      // Só na linha de data (|lon| perto de 180) o teto da longitude pode
      // estourar: o candidato do outro lado sairia do mundo.
      if (Math.abs(lon) < 179.9995) assert.ok(Math.abs(micro(m.lon) - micro(lon)) <= 500, 'longitude andou demais');
    }
  }
});

test('marca: país e posição inválidos LANÇAM — posição do app sem país não é marcável', () => {
  assert.equal(PAIS_MAX, 999);
  for (const pais of [0, -1, 1000, 30.5, '30', null, undefined, NaN]) {
    assert.equal(paisValido(pais), false, String(pais));
    assert.throws(() => marcarPosicao({ lat: 1, lon: 1 }, pais), /país inválido/);
  }
  for (const p of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: NaN, lon: 0 }, { lat: '1', lon: 1 }, {}]) {
    assert.throws(() => marcarPosicao(p, 30), /posição inválida/, JSON.stringify(p));
  }
});
