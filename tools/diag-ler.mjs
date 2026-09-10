// FONTE ÚNICA de "abrir um diagnóstico", nas duas formas em que ele chega.
//
// Desde v2026.09.10-04 o modo dev entrega um `.zip` (2,61 MB → 532 KB medidos
// no arquivo real do owner). O `.json` cru continua existindo — é o que sai em
// navegador sem `CompressionStream` (iOS < 16.4) e é o que já está guardado dos
// relatos antigos. As ferramentas não podem escolher uma e ignorar a outra: a
// mais velha é justamente a que se usa pra comparar "antes e depois".
//
// Farejar os BYTES MÁGICOS e não a extensão, porque o arquivo chega por
// WhatsApp e por e-mail, que renomeiam à vontade.
import { readFileSync } from 'node:fs';
import { inflateRawSync, gunzipSync } from 'node:zlib';

// Um ZIP se lê a partir do FIM: o End Of Central Directory diz onde está o
// diretório, e o diretório diz onde está cada entrada. Ler o primeiro cabeçalho
// local direto "funcionaria" com o nosso ZIP e quebraria com qualquer outro —
// e um arquivo reempacotado pelo caminho (já vi acontecer) deixa de abrir sem
// dizer por quê.
function doZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP sem diretório central (arquivo truncado?)');
  const n = buf.readUInt16LE(eocd + 10);
  let o = buf.readUInt32LE(eocd + 16);
  const entradas = [];
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(o) !== 0x02014b50) throw new Error('diretório central corrompido');
    const metodo = buf.readUInt16LE(o + 10);
    const comp = buf.readUInt32LE(o + 20);
    const tamNome = buf.readUInt16LE(o + 28);
    const tamExtra = buf.readUInt16LE(o + 30);
    const tamCom = buf.readUInt16LE(o + 32);
    const off = buf.readUInt32LE(o + 42);
    const nome = buf.toString('utf8', o + 46, o + 46 + tamNome);
    entradas.push({ nome, metodo, comp, off });
    o += 46 + tamNome + tamExtra + tamCom;
  }
  // O nome é fixo do nosso lado, mas cair no primeiro `.json` cobre o arquivo
  // reempacotado com outro nome — e é melhor que falhar dizendo "não achei".
  const e = entradas.find((x) => x.nome === 'diagnostico.json')
         || entradas.find((x) => x.nome.endsWith('.json'));
  if (!e) throw new Error('ZIP sem .json dentro (entradas: ' + entradas.map((x) => x.nome).join(', ') + ')');
  const tamNome = buf.readUInt16LE(e.off + 26);
  const tamExtra = buf.readUInt16LE(e.off + 28);
  const ini = e.off + 30 + tamNome + tamExtra;
  const corpo = buf.subarray(ini, ini + e.comp);
  if (e.metodo === 0) return corpo;            // guardado cru (sem CompressionStream)
  if (e.metodo === 8) return inflateRawSync(corpo);
  throw new Error('método de compressão ' + e.metodo + ' não suportado');
}

// Devolve o objeto já parseado. `origem` diz qual forma veio, pra a ferramenta
// poder imprimir — saber que se está olhando um relato antigo importa.
export function lerDiagnostico(caminho) {
  const buf = readFileSync(caminho);
  let texto, origem;
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) { texto = doZip(buf); origem = 'zip'; }
  else if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) { texto = gunzipSync(buf); origem = 'gzip'; }
  else { texto = buf; origem = 'json'; }
  return { dados: JSON.parse(texto.toString('utf8')), origem, bytes: buf.length };
}
