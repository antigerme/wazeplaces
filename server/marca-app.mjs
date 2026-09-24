// A MARCA de quem está usando a NOSSA app, gravada dentro da própria presença
// do Waze.
//
// A lista de "editores online" do WME traz todo mundo que está visível, sem
// dizer de onde a pessoa veio. A única coisa que a pessoa escreve nesse registro
// é a POSIÇÃO — inteiros em milionésimos de grau (`lon×1e6`, `lat×1e6`) —, e o
// Waze devolve exatamente os dígitos que recebeu: MEDIDO com as duas contas do
// owner em 2026-09-23, três posições (duas com dígitos marcados e uma de
// controle, redonda) escritas por uma conta e lidas pela outra, 3 de 3 iguais.
//
// Então a app grava a posição do card com os últimos dígitos num padrão nosso:
//   · lat em µ°, resto por 100  = MARCA_APP → "esta pessoa está na app"
//   · lon em µ°, resto por 1000 = o país da fila (countryId, 1–999)
// e, na fase da lista, fica só com quem tem a marca, no país dela. Sem tabela
// de fronteiras: o país vai NA marca.
//
// O resto é o MATEMÁTICO (sempre 0 a m−1, também pra número negativo), e não o
// do valor absoluto: pelo absoluto as posições marcadas ficam com um buraco
// perto do zero (±999 µ° em volta do meridiano de Greenwich), e o deslocamento
// dobrava ali — foi o que o teste dos extremos pegou na primeira versão. Pelo
// resto matemático elas ficam espaçadas por igual, e o teto vale em todo lugar
// — menos na linha de data, onde o candidato do outro lado sairia do mundo.
//
// O custo é deslocar o bonequinho no WME: no máximo 50 µ° na latitude (~5,6 m)
// e 500 µ° na longitude (~55 m no equador, menos longe dele) — não se nota
// num mapa. A chance de uma posição QUALQUER do WME cair na marca e no mesmo
// país por acaso é 1 em 100 mil (2 dígitos × 3 dígitos), e o custo disso é
// baixo por construção: quem está no WME já pode ver e falar com quem usa a
// app de qualquer jeito.
//
// Puro como o `wme-grpc.mjs`: sem I/O e sem relógio. Quem ESCREVE é o core, e
// quem vai LER (a lista, na fase 3) também — por isso as duas pontas moram aqui.

export const MARCA_APP = 47;
export const PAIS_MAX = 999;

const MICRO = 1e6;
const LIMITE_LAT = 90 * MICRO;
const LIMITE_LON = 180 * MICRO;

const micro = (graus) => Math.round(graus * MICRO);

const resto = (u, m) => ((u % m) + m) % m;

// O inteiro mais perto de `u` que deixa resto `r` em `m`. Os três candidatos (o
// da faixa de baixo, o da própria e o da de cima) garantem deslocamento de no
// máximo m/2; o `limite` só corta candidato que sairia do mundo, e é por isso
// que na linha de data (|lon| perto de 180°) o teto pode estourar.
function comResto(u, m, r, limite) {
  const base = u - resto(u, m);
  let melhor = null;
  for (const c of [base - m + r, base + r, base + m + r]) {
    if (Math.abs(c) > limite) continue;
    if (melhor === null || Math.abs(c - u) < Math.abs(melhor - u)) melhor = c;
  }
  return melhor;
}

export function paisValido(pais) {
  return Number.isInteger(pais) && pais >= 1 && pais <= PAIS_MAX;
}

// { lat, lon } em graus → a mesma posição com a marca da app e o país, em
// graus, com os milionésimos EXATOS (o codec arredonda ×1e6 de volta ao mesmo
// inteiro). Lança com país inválido: posição da app sem país não é marcável, e
// quem chama decide o que fazer (o core simplesmente não escreve).
export function marcarPosicao({ lat, lon }, pais) {
  if (!paisValido(pais)) throw new Error('país inválido para a marca');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('posição inválida para a marca');
  }
  return {
    lat: comResto(micro(lat), 100, MARCA_APP, LIMITE_LAT) / MICRO,
    lon: comResto(micro(lon), 1000, pais, LIMITE_LON) / MICRO,
  };
}

export function temMarcaDaApp({ lat }) {
  return Number.isFinite(lat) && resto(micro(lat), 100) === MARCA_APP;
}

export function paisDaMarca({ lon }) {
  return Number.isFinite(lon) ? resto(micro(lon), 1000) : null;
}
