// Street View no lightbox do mapa — o botão que abre o panorama ONDE A PESSOA
// ESTÁ OLHANDO.
//
// O que este arquivo trava, e por que cada coisa está aqui:
//
//  1. A ORDEM DAS COORDENADAS. Mesmo defeito do "Perto de mim" e mesma razão
//     pra não dar sintoma: `MapaLightbox.centro` é [lat, lon] (o core INVERTE
//     o GeoJSON antes de mandar). Lido ao contrário o link abre um lugar
//     PLAUSÍVEL e errado — medido no Terminal 2 de Guarulhos, [lon,lat] cai no
//     Atlântico Sul, e os dois passam num teste de |lat| <= 90. Por isso aqui
//     tem CONTRAPROVA: com a ordem trocada o teste TEM que reprovar.
//  2. O link é reescrito no `desenhar()`, e não num dos quatro chamadores.
//     Abrir, arrastar, zoom e recentrar todos mexem no centro; amarrar a um só
//     deixaria os outros três com o link velho, e o panorama abriria no lugar
//     anterior SEM erro nenhum na tela.
//  3. UM slot de ação por lightbox. O canto de baixo à direita do mapa tem um
//     ocupante só; segundo candidato divide o slot, não ganha canto novo.
//  4. Link externo carrega `rel="noopener noreferrer"` e `target="_blank"`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');

// Âncora em DECLARAÇÃO, nunca em distância (gotcha #67).
function fatiar(nome) {
  const ini = APP.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu do app.js`);
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:async function |function |const |let |\/\/ ──|\/\/ ═)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return APP.slice(ini, ini + 1 + fim);
}

function carregar() {
  const base = APP.match(/const STREET_VIEW_URL = '[^']+';/);
  assert.ok(base, 'STREET_VIEW_URL sumiu do app.js');
  const src = base[0] + '\n' + fatiar('linkStreetView') + '\nreturn { linkStreetView, STREET_VIEW_URL };';
  return new Function(src)();
}

// ── 1. A ORDEM DAS COORDENADAS, com contraprova ────────────────────────────
test('o link usa centro como [lat, lon]', () => {
  const { linkStreetView } = carregar();
  // Terminal 2 do aeroporto de Guarulhos, da fila real: lat -23.43, lon -46.48.
  const centro = [-23.427056, -46.481807];
  const u = new URL(linkStreetView(centro));
  const vp = u.searchParams.get('viewpoint');
  assert.equal(vp, '-23.427056,-46.481807',
    'o viewpoint tem que sair lat,lon — na ordem em que o core manda');
  assert.equal(u.searchParams.get('map_action'), 'pano');
  assert.equal(u.searchParams.get('api'), '1');
});

test('CONTRAPROVA: com o centro invertido o viewpoint muda', () => {
  const { linkStreetView } = carregar();
  const certo = new URL(linkStreetView([-23.427056, -46.481807]));
  const trocado = new URL(linkStreetView([-46.481807, -23.427056]));
  // Se este assert passar a falhar, alguém fez o builder ignorar a ordem — e aí
  // o teste de cima deixou de significar qualquer coisa.
  assert.notEqual(certo.searchParams.get('viewpoint'), trocado.searchParams.get('viewpoint'),
    'inverter o centro TEM que mudar o link; se não muda, o teste acima é decoração');
  // E a inversão de Guarulhos cai no oceano: lat -46 é latitude de mar aberto
  // no Atlântico Sul. Nenhuma checagem de faixa pega isso (|-46| <= 90).
  assert.equal(Math.abs(-46.481807) <= 90, true,
    'a inversão passa em teste de faixa — é por isso que ela precisa de contraprova');
});

test('coordenada ausente ou inválida não produz link', () => {
  const { linkStreetView } = carregar();
  for (const ruim of [null, undefined, [], [1], ['a', 'b'], [NaN, 0], [0, Infinity]]) {
    assert.equal(linkStreetView(ruim), null, `deveria recusar ${JSON.stringify(ruim)}`);
  }
  // Zero é coordenada legítima (Golfo da Guiné) e NÃO pode ser recusado por
  // falsy — é o mesmo cuidado do `!id` com creatorId 0.
  assert.ok(linkStreetView([0, 0]), 'lat/lon 0,0 é coordenada válida');
});

test('o host é o do Google Maps, não um caminho interno', () => {
  const { STREET_VIEW_URL } = carregar();
  const u = new URL(STREET_VIEW_URL);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.hostname, 'www.google.com');
  assert.ok(!/layer=c|cbll/.test(STREET_VIEW_URL),
    'a forma `?layer=c&cbll=` é caminho interno, não contrato publicado');
});

// ── 2. FONTE ÚNICA: o href é reescrito no desenhar() ───────────────────────
test('atualizarStreetView é chamado do desenhar(), não de um chamador só', () => {
  const des = APP.slice(APP.indexOf('    desenhar() {'));
  const corpo = des.slice(0, des.indexOf('\n    },'));
  assert.match(corpo, /this\.atualizarStreetView\(\)/,
    'sem isto, arrastar ou dar zoom deixa o link no lugar anterior, sem sintoma');
});

test('nenhum dos quatro caminhos atualiza o link por fora', () => {
  // open/pan/zoom/recentrar chamam desenhar(); se algum chamar
  // atualizarStreetView direto, a fonte única deixou de ser única.
  const fora = APP.split('\n').filter((l) => /atualizarStreetView\(\)/.test(l));
  assert.equal(fora.length, 2,
    `esperava 2 ocorrências (a declaração e a chamada no desenhar), achei ${fora.length}`);
});

// ── 3. UM slot de ação por lightbox ────────────────────────────────────────
test('o lightbox do mapa tem UM ocupante no canto de baixo à direita', () => {
  const ini = HTML.indexOf('id="mapaLightbox"');
  assert.ok(ini > 0);
  const bloco = HTML.slice(ini, HTML.indexOf('id="imageLightbox"'));
  // Conta elementos ancorados em bottom+right dentro do lightbox do mapa.
  const noCanto = (bloco.match(/right:\s*0\.75rem;\s*bottom:/g) || []).length;
  assert.equal(noCanto, 1,
    'segundo candidato divide o slot por exclusão mútua, não ganha um canto novo');
});

test('o botão é um link externo seguro e tem alvo de 44px', () => {
  const ini = HTML.indexOf('id="mapaLbStreetView"');
  assert.ok(ini > 0, 'o botão sumiu do index.html');
  const tag = HTML.slice(ini, HTML.indexOf('>', ini));
  assert.match(tag, /target="_blank"/);
  assert.match(tag, /rel="noopener noreferrer"/);
  assert.match(tag, /\bw-11\b/, 'alvo de toque mínimo do projeto é 44px');
  assert.match(tag, /\bh-11\b/);
  // Ícone sozinho não transmite informação: quem anuncia é o aria-label.
  assert.match(tag, /data-i18n-aria="card\.map\.streetView"/);
  assert.match(tag, /data-i18n-title="card\.map\.streetView"/);
});

// ── 4. i18n nas quatro línguas ─────────────────────────────────────────────
test('a chave existe nas 4 línguas e mantém a marca sem traduzir', () => {
  const achados = I18N.match(/'card\.map\.streetView':\s*'([^']+)'/g) || [];
  assert.equal(achados.length, 4, 'faltou idioma em card.map.streetView');
  for (const a of achados) {
    assert.match(a, /Street View/,
      'Street View é MARCA e não se traduz (regra do CLAUDE.md)');
  }
});
