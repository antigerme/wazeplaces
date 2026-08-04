// Mini-mapa de evidência: onde o pedido acontece, com os tiles do PRÓPRIO Waze.
//
// Por que existe: medido na fila real, os dois campos mais pedidos numa
// "Atualização de detalhes" são espaciais — `geometry` (27 de 83) e
// `entryExitPoints` (21). O card os mostrava como texto exato e injulgável
// ("moveu 36 m", "entrada -15.88749, -52.26094"). Coordenada não se julga de
// cabeça: 36 metros pode ser acertar a porta ou jogar o local dentro do rio, e
// o editor não tinha como saber qual. O owner, que é L6, resumiu olhando o
// próprio card: "não sei o que fazer com isso".
//
// Por que os tiles do Waze e não um mapa qualquer: respondem sem credencial
// (medido: HTTP 200, PNG 512×512, nas três regiões), e não entra terceiro
// nenhum no projeto — valor explícito daqui. Nenhuma biblioteca: a projeção de
// Mercator cabe em seis linhas e é a mesma desde 2005.
//
// **Camada `live/base`, não `editor/roads`** — e a escolha importa. A do editor
// é a que o WME desenha: setas de mão única, sentido de segmento, marcas de
// edição. Isso é o que se precisa pra EDITAR, e não é o que este card faz. Aqui
// a pergunta é "isto faz sentido neste lugar?", e quem responde é a base
// cartográfica: parque em verde, água em azul, prédios, e os pontos nomeados da
// vizinhança. Um local que pulou pra dentro de um lago se reconhece num relance
// numa e não na outra. O fluxo do owner é esse: julgar rápido aqui, abrir o WME
// pelo ↗ depois pra ajustar — cada mapa no seu momento.
// (A camada saiu de um HAR do livemap que o próprio owner levantou.)
//
// Carregado como <script> clássico antes do app.js, como o api.js e o i18n.js.

// Tamanho do tile que o Waze serve. Medido, não suposto.
const MAPA_TILE = 512;

// Zoom máximo pra não pedir tile que não existe, e mínimo pra o mapa ainda
// dizer ONDE fica. 17 mostra a quadra; abaixo de 13 vira mancha de cidade.
const MAPA_Z_MAX = 17;
const MAPA_Z_MIN = 13;

// Mercator esférica: a mesma projeção do WME, do Google e de todo mundo desde
// 2005. Devolve a posição em "pixels do mundo" no zoom dado, o que torna o
// resto (qual tile, que offset dentro dele) uma subtração.
function mapaProjetar(lat, lon, z) {
  const escala = MAPA_TILE * Math.pow(2, z);
  const x = (lon + 180) / 360 * escala;
  const senoLat = Math.sin(lat * Math.PI / 180);
  // Trava perto dos polos: sem isso o log estoura pra ±Infinity e o mapa some.
  const s = Math.max(-0.9999, Math.min(0.9999, senoLat));
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * escala;
  return { x, y };
}

// Metros por pixel na latitude dada — é o que transforma "cabe em 36 metros"
// na pergunta que o zoom responde.
function mapaMetrosPorPixel(lat, z) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
}

// Estes pontos cabem na caixa neste zoom? A margem é a mesma que o encaixe
// usa (28px de cada lado): marcador colado na borda fica ilegível e some sob
// o recorte, então "cabe" quer dizer "cabe com folga de ver".
function mapaCabe(pontos, larguraPx, alturaPx, z) {
  const util = { w: Math.max(32, larguraPx - 56), h: Math.max(32, alturaPx - 56) };
  const proj = pontos.map((p) => mapaProjetar(p[0], p[1], z));
  const dx = Math.max(...proj.map((p) => p.x)) - Math.min(...proj.map((p) => p.x));
  const dy = Math.max(...proj.map((p) => p.y)) - Math.min(...proj.map((p) => p.y));
  return dx <= util.w && dy <= util.h;
}

// O maior zoom em que TODOS os pontos ainda cabem na caixa.
//
// Escolher zoom fixo erraria dos dois lados: 17 corta um movimento de 300 m ao
// meio, e 13 mostra um movimento de 4 m como um pixel só. O enquadramento é a
// diferença entre o mapa ser evidência e ser enfeite.
function mapaZoomQueCabe(pontos, larguraPx, alturaPx) {
  if (!pontos.length) return MAPA_Z_MAX;
  for (let z = MAPA_Z_MAX; z >= MAPA_Z_MIN; z--) {
    if (mapaCabe(pontos, larguraPx, alturaPx, z)) return z;
  }
  return MAPA_Z_MIN;
}

// Monta o que a tela precisa: quais tiles buscar, onde encostá-los, e a posição
// em pixel de cada marcador. Função PURA — dá pra testar sem browser e sem rede,
// que é como o resto do core deste projeto é testado.
function mapaMontar(pontos, larguraPx, alturaPx, região) {
  const validos = (pontos || []).filter((p) => Array.isArray(p)
    && Number.isFinite(p[0]) && Number.isFinite(p[1])
    // (0,0) é o Golfo da Guiné e, na prática, coordenada perdida. Um mapa do
    // oceano é pior que nenhum: parece informação e não é.
    && !(p[0] === 0 && p[1] === 0));
  if (!validos.length) return null;

  // Quando NEM o zoom mínimo dá conta, o enquadramento não é possível — e a
  // saída honesta não é forçá-lo. Antes, `mapaZoomQueCabe` devolvia o mínimo
  // assim mesmo e os marcadores caíam fora da caixa CALADOS: o mapa mostrava
  // um ponto só e não dizia que faltava outro. Isso acontece de verdade e é
  // justamente onde a evidência mais vale — na fila real há pedidos propondo
  // mover um local 82 QUILÔMETROS, e ver isso é decidir na hora.
  //
  // Agora o mapa enquadra o PRIMEIRO ponto (a posição de hoje, que é sempre o
  // primeiro na ordem que o card monta) e devolve `foraDoMapa` com os índices
  // que não couberam. Quem desenha diz o resto em palavra — "82 km daqui" cabe
  // numa linha e não cabe em nenhum zoom.
  let usados = validos;
  let foraDoMapa = [];
  if (validos.length > 1 && !mapaCabe(validos, larguraPx, alturaPx, MAPA_Z_MIN)) {
    usados = [validos[0]];
    foraDoMapa = validos.map((_, i) => i).slice(1);
  }
  const z = mapaZoomQueCabe(usados, larguraPx, alturaPx);
  const proj = usados.map((p) => mapaProjetar(p[0], p[1], z));
  const centro = {
    x: (Math.min(...proj.map((p) => p.x)) + Math.max(...proj.map((p) => p.x))) / 2,
    y: (Math.min(...proj.map((p) => p.y)) + Math.max(...proj.map((p) => p.y))) / 2,
  };
  // Canto superior-esquerdo da caixa, em pixels do mundo.
  const orig = { x: centro.x - larguraPx / 2, y: centro.y - alturaPx / 2 };

  // Encaixar a caixa DENTRO de um tile só, quando der.
  //
  // A caixa (ex.: 412×250) é menor que um tile (512×512), mas centrá-la nos
  // pontos a faz atravessar a borda quase sempre — medido na fila real: 2,79
  // tiles por card, e 126 dos 295 pedindo QUATRO. A 29–147 KB cada, isso é
  // ~357 KB por card, que não se pede de um editor no celular.
  //
  // Centrar não é requisito: o requisito é os marcadores caberem com folga.
  // Isso deixa uma faixa de liberdade pro canto da caixa, e dentro dela quase
  // sempre existe uma posição que cai num tile só. Deslizar até lá não perde
  // um pixel de evidência — só troca o enquadramento, que ninguém pediu.
  const encaixar = (o, min, max, tam) => {
    const M = 28;   // a mesma margem do zoom: marcador colado na borda some
    // Faixa em que o canto pode ficar sem empurrar ponto pra fora.
    const lo = max + M - tam;
    const hi = min - M;
    if (lo > hi) return o;                       // não cabe nem centrado: mantém
    const alvo = Math.min(hi, Math.max(lo, o));  // preferência pelo centro
    // O tile onde o conteúdo já está; se a caixa couber nele, desliza pra lá.
    const t = Math.floor((min + max) / 2 / MAPA_TILE);
    const dentroLo = Math.max(lo, t * MAPA_TILE);
    const dentroHi = Math.min(hi, (t + 1) * MAPA_TILE - tam);
    return dentroLo <= dentroHi ? Math.min(dentroHi, Math.max(dentroLo, o)) : alvo;
  };
  const xs = proj.map((p) => p.x), ys = proj.map((p) => p.y);
  orig.x = encaixar(orig.x, Math.min(...xs), Math.max(...xs), larguraPx);
  orig.y = encaixar(orig.y, Math.min(...ys), Math.max(...ys), alturaPx);

  const tiles = [];
  const tx0 = Math.floor(orig.x / MAPA_TILE);
  const ty0 = Math.floor(orig.y / MAPA_TILE);
  const tx1 = Math.floor((orig.x + larguraPx) / MAPA_TILE);
  const ty1 = Math.floor((orig.y + alturaPx) / MAPA_TILE);
  const nMax = Math.pow(2, z);
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      // Fora da faixa vertical do mundo não existe tile; horizontalmente o
      // mundo dá a volta, então o x se enrola em vez de sumir.
      if (ty < 0 || ty >= nMax) continue;
      const txw = ((tx % nMax) + nMax) % nMax;
      tiles.push({
        url: `https://www.waze.com/${região || 'row'}-tiles/live/base/${z}/${txw}/${ty}/tile.png`,
        left: tx * MAPA_TILE - orig.x,
        top: ty * MAPA_TILE - orig.y,
      });
    }
  }

  return {
    z,
    tiles,
    tamanho: MAPA_TILE,
    // Cada ponto vira posição em pixel DENTRO da caixa, na mesma ordem que entrou.
    pixels: proj.map((p) => ({ left: p.x - orig.x, top: p.y - orig.y })),
    // Índices (na lista que ENTROU) que não couberam em zoom nenhum. Vazio no
    // caso normal; quem desenha usa pra dizer em palavra o que o mapa não pode
    // mostrar, em vez de desenhar um marcador fora da tela.
    foraDoMapa,
    metrosPorPixel: mapaMetrosPorPixel(validos[0][0], z),
  };
}

if (typeof window !== 'undefined') {
  window.mapaMontar = mapaMontar;
  window.mapaProjetar = mapaProjetar;
  window.mapaZoomQueCabe = mapaZoomQueCabe;
  window.mapaCabe = mapaCabe;
  window.mapaMetrosPorPixel = mapaMetrosPorPixel;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapaMontar, mapaProjetar, mapaZoomQueCabe, mapaCabe, mapaMetrosPorPixel, MAPA_TILE, MAPA_Z_MAX, MAPA_Z_MIN };
}
