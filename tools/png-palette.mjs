// Re-encoda um PNG truecolor opaco como PNG de PALETA (8 bits indexados).
//
// POR QUE. As splash do iOS são fundo chapado com o logo no meio, e o Chromium
// as escreve em RGBA: 4 bytes por pixel pra uma imagem que usa ~700 cores. Uma
// splash de iPhone 16 Pro Max sai a 31 KB, e são 34 arquivos — quase 1 MB no
// repositório pra desenhar um retângulo com um alfinete. Em paleta o mesmo
// arquivo cai pra ~15 KB, com diferença máxima de 4/255 por canal, só nas bordas
// antisserrilhadas do logo e do texto (medido).
//
// Zero dependência, como o resto do backend: `node:zlib` faz o deflate e o CRC
// é tabela própria (o `zlib.crc32` só existe no Node 20.15+, e o projeto promete
// Node 18+).
//
// A paleta é escolhida por FARTHEST-POINT (k-center), não por frequência. A
// primeira versão pegava as 256 cores mais frequentes e mapeava o resto na mais
// próxima — e isso gastava slots em quase-duplicatas da cor popular deixando
// buraco no resto: medido, erro máximo de 49/255 num canal da splash clara.
// Farthest-point escolhe a cada passo a cor mais DISTANTE do que a paleta já
// cobre, que é exatamente a grandeza que se quer limitar (o erro do pior pixel,
// não o do pixel médio). Com ~800 cores distintas o custo é 256×800 contas.
// Numa foto a escolha seria outra — lá o olho perdoa o pior pixel e não perdoa
// o banding, então frequência/median-cut ganham.

import { inflateSync, deflateSync } from 'node:zlib';

const ASSINATURA = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const cabeca = Buffer.alloc(8);
  cabeca.writeUInt32BE(dados.length, 0);
  cabeca.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cabeca.subarray(4), dados])), 0);
  return Buffer.concat([cabeca, dados, crc]);
}

// Paeth do próprio spec do PNG (RFC 2083, seção 6.6) — copiar errado aqui
// produz imagem quase certa, com falha só nas diagonais.
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodificar(png) {
  if (!png.subarray(0, 8).equals(ASSINATURA)) throw new Error('não é PNG');
  let pos = 8, ihdr = null;
  const idat = [];
  while (pos < png.length) {
    const tam = png.readUInt32BE(pos);
    const tipo = png.toString('ascii', pos + 4, pos + 8);
    const dados = png.subarray(pos + 8, pos + 8 + tam);
    if (tipo === 'IHDR') {
      ihdr = {
        largura: dados.readUInt32BE(0), altura: dados.readUInt32BE(4),
        bits: dados[8], tipoCor: dados[9], entrelacado: dados[12],
      };
    } else if (tipo === 'IDAT') idat.push(Buffer.from(dados));
    else if (tipo === 'IEND') break;
    pos += 12 + tam;
  }
  if (!ihdr) throw new Error('PNG sem IHDR');
  if (ihdr.bits !== 8) throw new Error(`só 8 bits por canal (veio ${ihdr.bits})`);
  if (ihdr.entrelacado) throw new Error('PNG entrelaçado não é suportado');
  const canais = { 2: 3, 6: 4 }[ihdr.tipoCor];
  if (!canais) throw new Error(`só truecolor RGB/RGBA (veio tipo ${ihdr.tipoCor})`);

  const cru = inflateSync(Buffer.concat(idat));
  const { largura, altura } = ihdr;
  const passo = largura * canais;
  const pixels = Buffer.alloc(passo * altura);
  let de = 0;
  for (let y = 0; y < altura; y++) {
    const filtro = cru[de++];
    const linha = pixels.subarray(y * passo, (y + 1) * passo);
    const acima = y ? pixels.subarray((y - 1) * passo, y * passo) : null;
    for (let x = 0; x < passo; x++) {
      const bruto = cru[de + x];
      const a = x >= canais ? linha[x - canais] : 0;
      const b = acima ? acima[x] : 0;
      const c = acima && x >= canais ? acima[x - canais] : 0;
      let v;
      if (filtro === 0) v = bruto;
      else if (filtro === 1) v = bruto + a;
      else if (filtro === 2) v = bruto + b;
      else if (filtro === 3) v = bruto + ((a + b) >> 1);
      else if (filtro === 4) v = bruto + paeth(a, b, c);
      else throw new Error(`filtro PNG desconhecido: ${filtro}`);
      linha[x] = v & 0xff;
    }
    de += passo;
  }
  return { largura, altura, canais, pixels };
}

export function paletizar(png, maxCores = 256) {
  const { largura, altura, canais, pixels } = decodificar(png);
  const total = largura * altura;

  const contagem = new Map();
  for (let i = 0; i < total; i++) {
    const p = i * canais;
    if (canais === 4 && pixels[p + 3] !== 255) {
      throw new Error('imagem tem transparência — a paleta aqui é só pra splash opaca');
    }
    const chave = (pixels[p] << 16) | (pixels[p + 1] << 8) | pixels[p + 2];
    contagem.set(chave, (contagem.get(chave) || 0) + 1);
  }

  const cores = [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const comp = cores.map((c) => [c >> 16, (c >> 8) & 0xff, c & 0xff]);
  const dist2 = (i, j) => {
    const a = comp[i], b = comp[j];
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  };

  // Semente: a cor mais frequente (o fundo). Depois, sempre a mais distante do
  // que já está coberto. `maisProxima[i]` guarda a distância de cada cor à
  // paleta atual, atualizada em O(n) por inclusão.
  const escolhidas = [0];
  const maisProxima = cores.map((_, i) => dist2(i, 0));
  const donoDe = cores.map(() => 0);
  while (escolhidas.length < Math.min(maxCores, cores.length)) {
    let alvo = -1, pior = -1;
    for (let i = 0; i < cores.length; i++) {
      if (maisProxima[i] > pior) { pior = maisProxima[i]; alvo = i; }
    }
    if (pior <= 0) break; // toda cor já está exata na paleta
    const slot = escolhidas.length;
    escolhidas.push(alvo);
    for (let i = 0; i < cores.length; i++) {
      const d = dist2(i, alvo);
      if (d < maisProxima[i]) { maisProxima[i] = d; donoDe[i] = slot; }
    }
  }

  const paleta = escolhidas.map((i) => cores[i]);
  const indiceDe = new Map(cores.map((c, i) => [c, donoDe[i]]));

  // Filtro 0 (None) em toda linha: com 1 byte por pixel e fundo chapado, o
  // deflate já resolve, e filtro em imagem indexada costuma ATRAPALHAR (a
  // diferença entre índices vizinhos não tem significado numérico).
  const bruto = Buffer.alloc((largura + 1) * altura);
  let saida = 0;
  for (let y = 0; y < altura; y++) {
    bruto[saida++] = 0;
    for (let x = 0; x < largura; x++) {
      const p = (y * largura + x) * canais;
      const chave = (pixels[p] << 16) | (pixels[p + 1] << 8) | pixels[p + 2];
      bruto[saida++] = indiceDe.get(chave);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;   // bits por amostra
  ihdr[9] = 3;   // tipo de cor: paleta
  const plte = Buffer.alloc(paleta.length * 3);
  paleta.forEach((c, i) => {
    plte[i * 3] = c >> 16; plte[i * 3 + 1] = (c >> 8) & 0xff; plte[i * 3 + 2] = c & 0xff;
  });

  return Buffer.concat([
    ASSINATURA,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
