// A sala na VM: o WebSocket escrito à mão (`server/ws.mjs`) e o roteamento da
// sala em `server/node.mjs`.
//
// Duas camadas de prova, e a ordem importa:
//
//  1. VETORES DOURADOS DA RFC 6455. O handshake e os quadros são conferidos
//     contra os exemplos da PRÓPRIA especificação (§1.3 e §5.7) — bytes que
//     não saíram daqui. Sem isso o teste seria o meu cliente concordando com o
//     meu servidor sobre um mal-entendido comum aos dois, que é como um codec
//     escrito à mão passa em teste e falha no browser.
//  2. PONTA A PONTA com o servidor de verdade, usando um cliente mínimo cujo
//     codificador já foi validado pelos vetores acima.
//
// O caminho equivalente na Cloudflare é o runtime deles, não este código — lá
// o que precisa casar é a REGRA (crachá, sala, lista), e disso cuida o
// `test/presenca.test.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCrachas, base64ToBytes } from '../server/core.mjs';
import { setTimeout as dormir } from 'node:timers/promises';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAVE_B64 = Buffer.alloc(32, 9).toString('base64');
const readFile = (p) => readFileSync(join(RAIZ, p), 'utf8');

// ── 1. VETORES DA RFC 6455 ──────────────────────────────────────────────────

test('handshake: o Sec-WebSocket-Accept é o da RFC 6455 §1.3', () => {
  // A chave e a resposta são as do exemplo normativo. Se a constante GUID ou o
  // sha1/base64 saírem do lugar, o browser recusa o 101 sem dizer por quê.
  const chave = 'dGhlIHNhbXBsZSBub25jZQ==';
  const accept = createHash('sha1')
    .update(chave + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  assert.equal(accept, 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');

  const src = readFile('server/ws.mjs');
  assert.match(src, /258EAFA5-E914-47DA-95CA-C5AB0DC85B11/, 'sumiu o GUID da RFC');
  assert.match(src, /sha1/, 'o accept deixou de ser sha1');
});

test('quadro: os bytes da RFC 6455 §5.7 são decodificados e produzidos', () => {
  // Cliente → servidor, "Hello" mascarado. Vetor normativo.
  const mascarado = Buffer.from([0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58]);
  assert.deepEqual(decodificar(mascarado).textos, ['Hello']);

  // Servidor → cliente, "Hello" SEM máscara. Mascarar aqui é violação da RFC
  // (§5.1) e o browser derruba a conexão.
  assert.deepEqual(quadroServidor('Hello'), Buffer.from([0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]));

  // Fragmentado: "Hel" + "lo" em dois quadros.
  const frag = Buffer.concat([
    Buffer.from([0x01, 0x03, 0x48, 0x65, 0x6c]),
    Buffer.from([0x80, 0x02, 0x6c, 0x6f]),
  ]);
  assert.deepEqual(decodificar(frag.subarray(0, 5)).textos, [], 'fragmento não-final virou mensagem');
  assert.deepEqual(decodificar(frag).textos, ['Hello'], 'a remontagem não juntou os fragmentos');

  // Duas mensagens no MESMO buffer saem as duas.
  assert.deepEqual(decodificar(Buffer.concat([quadroServidor('a'), quadroServidor('b')])).textos, ['a', 'b']);
});

// ── 2. PONTA A PONTA ────────────────────────────────────────────────────────

test('dois editores na mesma fila se veem, conversam e somem ao sair', async () => {
  await comServidor(async (porta, crachas) => {
    const ana = await entrar(porta, crachas, { peer: 'pa', nome: 'Ana', rank: 5, am: true, sala: 'row:30' });
    assert.deepEqual(await ana.esperar('eu'), { t: 'eu', peer: 'pa' });
    // Sozinha na sala: a lista vem vazia. Se viesse com ela mesma, a pílula
    // diria "1 editor online" pra quem está sozinho.
    assert.deepEqual((await ana.esperar('lista')).peers, []);

    const bia = await entrar(porta, crachas, { peer: 'pb', nome: 'Bia', rank: 2, am: true, sala: 'row:30' });
    await bia.esperar('eu');

    // A entrada de uma avisa a outra: ninguém fica com lista velha esperando
    // um poll que não existe.
    const listaDaAna = await ana.esperar('lista');
    assert.deepEqual(listaDaAna.peers.map((p) => p.nome), ['Bia']);
    assert.equal(listaDaAna.peers[0].rank, 2, 'o rank não chegou');
    assert.equal(listaDaAna.total, 1);

    // Sinalização: passa opaca de uma ponta à outra, com o remetente carimbado
    // pelo SERVIDOR (`de`), não pelo cliente.
    ana.enviar({ t: 'sinal', para: 'pb', tipo: 'offer', payload: { sdp: 'v=0' } });
    const sinal = await bia.esperar('sinal');
    assert.equal(sinal.de, 'pa');
    assert.equal(sinal.tipo, 'offer');
    assert.deepEqual(sinal.payload, { sdp: 'v=0' });

    // Sinal pra quem não está: o remetente é avisado em vez de ficar chamando
    // pra sempre sem resposta.
    ana.enviar({ t: 'sinal', para: 'pz', tipo: 'offer', payload: null });
    assert.equal((await ana.esperar('ausente')).peer, 'pz');

    // Saiu = sumiu, na hora. Não há prazo pra vencer.
    bia.fechar();
    assert.deepEqual((await ana.esperar('lista')).peers, [], 'quem fechou o socket ficou na lista');
    ana.fechar();
  });
});

test('crachá de outra sala não entra, e sem crachá não se fala', async () => {
  await comServidor(async (porta, crachas) => {
    // Assinatura VÁLIDA, sala errada. Sem a conferência, um crachá legítimo do
    // Brasil entraria na sala de Portugal e ninguém veria erro nenhum.
    const c = await crachas.assinar({ peer: 'px', nome: 'X', sala: 'row:181' });
    const ws = await abrir(porta, 'row:30');
    ws.enviar({ t: 'entrar', cracha: c });
    assert.equal(await ws.esperarFim(), 4004, 'crachá de outra sala foi aceito');

    // Assinatura adulterada.
    const c2 = await crachas.assinar({ peer: 'py', nome: 'Y', sala: 'row:30' });
    const ws2 = await abrir(porta, 'row:30');
    ws2.enviar({ t: 'entrar', cracha: { ...c2, nome: 'Staff', rank: 6 } });
    assert.equal(await ws2.esperarFim(), 4003, 'crachá adulterado foi aceito');

    // Socket anônimo: não vê lista, não fala com ninguém.
    const ws3 = await abrir(porta, 'row:30');
    ws3.enviar({ t: 'sinal', para: 'pa', tipo: 'offer' });
    assert.equal(await ws3.esperarFim(), 4001, 'socket sem crachá conseguiu falar');
  });
});

test('salas diferentes não se enxergam', async () => {
  // A sala É a fila. Quem tria Portugal não deve aparecer pra quem tria o
  // Brasil — a promessa da lista é "gente no MESMO lugar que você".
  await comServidor(async (porta, crachas) => {
    const br = await entrar(porta, crachas, { peer: 'pbr', nome: 'Ana', sala: 'row:30' });
    await br.esperar('eu'); await br.esperar('lista');
    const pt = await entrar(porta, crachas, { peer: 'ppt', nome: 'Rui', sala: 'row:181' });
    await pt.esperar('eu');
    assert.deepEqual((await pt.esperar('lista')).peers, [], 'a sala de Portugal enxergou o Brasil');
    assert.equal(br.recebidas.filter((m) => m.t === 'lista' && m.peers.length).length, 0,
      'a sala do Brasil recebeu alguém de outra fila');
    br.fechar(); pt.fechar();
  });
});

test('quadro acima do teto derruba a conexão em vez de alocar', async () => {
  // Sem teto, um cliente hostil anuncia um payload gigante e o servidor aloca
  // o buffer antes de olhar o conteúdo.
  await comServidor(async (porta) => {
    const ws = await abrir(porta, 'row:30');
    ws.cru(quadroCliente('x'.repeat(70000)));
    assert.equal(await ws.esperarFim(), 1009, 'o teto de tamanho não fechou a conexão');
  });
});

test('quadro do cliente SEM máscara é recusado (RFC 6455 §5.1)', async () => {
  // Aceitar quadro não-mascarado é o buraco que permite envenenar cache de
  // proxy: o payload atravessa a rede parecendo uma requisição HTTP.
  await comServidor(async (porta) => {
    const ws = await abrir(porta, 'row:30');
    ws.cru(quadroServidor('{"t":"entrar"}'));   // sem máscara, como se fosse servidor
    assert.equal(await ws.esperarFim(), 1002, 'quadro sem máscara foi aceito');
  });
});

// ── cliente mínimo (codificador validado pelos vetores acima) ───────────────

function quadroServidor(texto) {
  const d = Buffer.from(texto, 'utf8');
  const cab = d.length < 126 ? Buffer.from([0x81, d.length])
    : Buffer.concat([Buffer.from([0x81, 126]), uint16(d.length)]);
  return Buffer.concat([cab, d]);
}

function quadroCliente(texto) {
  const d = Buffer.from(texto, 'utf8');
  const mask = randomBytes(4);
  const corpo = Buffer.allocUnsafe(d.length);
  for (let i = 0; i < d.length; i++) corpo[i] = d[i] ^ mask[i & 3];
  let cab;
  if (d.length < 126) cab = Buffer.from([0x81, 0x80 | d.length]);
  else if (d.length < 65536) cab = Buffer.concat([Buffer.from([0x81, 0x80 | 126]), uint16(d.length)]);
  else cab = Buffer.concat([Buffer.from([0x81, 0x80 | 127]), uint32(0), uint32(d.length)]);
  return Buffer.concat([cab, mask, corpo]);
}

const uint16 = (n) => { const b = Buffer.allocUnsafe(2); b.writeUInt16BE(n); return b; };
const uint32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(n); return b; };

// Decodificador de quadro do SERVIDOR (sem máscara). Devolve TODAS as
// mensagens completas que estavam no buffer, não a última: um `data` do TCP
// costuma trazer várias juntas, e devolver só uma engole silenciosamente o
// resto. Foi assim que este teste falhou dizendo "esperei 'lista' e não veio"
// enquanto o servidor tinha mandado tudo certo — instrumento errado antes do
// código (gotcha #28).
function decodificar(buf, estado = { frag: [] }) {
  let i = 0;
  const textos = [];
  let codigo;
  while (i + 2 <= buf.length) {
    const fin = (buf[i] & 0x80) !== 0;
    const op = buf[i] & 0x0f;
    let tam = buf[i + 1] & 0x7f;
    const mascarado = (buf[i + 1] & 0x80) !== 0;
    let j = i + 2;
    if (tam === 126) { if (buf.length < j + 2) break; tam = buf.readUInt16BE(j); j += 2; }
    else if (tam === 127) { if (buf.length < j + 8) break; tam = buf.readUInt32BE(j + 4); j += 8; }
    let mask = null;
    if (mascarado) { if (buf.length < j + 4) break; mask = buf.subarray(j, j + 4); j += 4; }
    if (buf.length < j + tam) break;
    let d = buf.subarray(j, j + tam);
    if (mask) { const c = Buffer.from(d); for (let k = 0; k < c.length; k++) c[k] ^= mask[k & 3]; d = c; }
    i = j + tam;
    if (op === 0x8) { codigo = tam >= 2 ? d.readUInt16BE(0) : 1005; continue; }
    if (op === 0x1 || op === 0x0) {
      estado.frag.push(d);
      if (fin) { textos.push(Buffer.concat(estado.frag).toString('utf8')); estado.frag = []; }
    }
  }
  return { textos, codigo, resto: buf.subarray(i) };
}

function abrir(porta, sala) {
  return new Promise((ok, falha) => {
    const s = connect(porta, '127.0.0.1', () => {
      s.write(
        `GET /sala?s=${encodeURIComponent(sala)} HTTP/1.1\r\nHost: local\r\n`
        + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
        + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
      );
    });
    const cli = {
      recebidas: [], fim: null, _esperas: [], _fimEspera: null, _lidas: new Set(),
      enviar: (o) => s.write(quadroCliente(JSON.stringify(o))),
      cru: (b) => s.write(b),
      fechar: () => s.destroy(),
      // Consome a primeira mensagem daquele tipo que ainda não foi lida. O
      // controle fica FORA da mensagem: carimbar um `_lida` dentro dela
      // contamina todo `deepEqual` do teste com um campo que o servidor não
      // mandou.
      esperar(tipo, ms = 4000) {
        const achada = this.recebidas.find((m) => m.t === tipo && !this._lidas.has(m));
        if (achada) { this._lidas.add(achada); return Promise.resolve(achada); }
        return new Promise((r, f) => {
          const t = setTimeout(() => f(new Error(`esperei '${tipo}' e não veio`)), ms);
          this._esperas.push({ tipo, r: (m) => { clearTimeout(t); r(m); } });
        });
      },
      esperarFim(ms = 4000) {
        if (this.fim !== null) return Promise.resolve(this.fim);
        return new Promise((r, f) => {
          const t = setTimeout(() => f(new Error('esperei o fechamento e não veio')), ms);
          this._fimEspera = (c) => { clearTimeout(t); r(c); };
        });
      },
    };
    let buf = Buffer.alloc(0);
    let cabecalhoLido = false;
    const estado = { frag: [] };
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!cabecalhoLido) {
        const corte = buf.indexOf('\r\n\r\n');
        if (corte < 0) return;
        const cab = buf.subarray(0, corte).toString();
        if (!/^HTTP\/1\.1 101/.test(cab)) { falha(new Error(`sem upgrade: ${cab.split('\r\n')[0]}`)); return; }
        assert.match(cab, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/,
          'o servidor devolveu um accept que não é o da RFC pra esta chave');
        buf = buf.subarray(corte + 4);
        cabecalhoLido = true;
        ok(cli);
      }
      const r = decodificar(buf, estado);
      buf = r.resto;
      if (r.codigo !== undefined) { cli.fim = r.codigo; if (cli._fimEspera) cli._fimEspera(r.codigo); }
      for (const texto of r.textos) {
        const m = JSON.parse(texto);
        cli.recebidas.push(m);
        const espera = cli._esperas.findIndex((e) => e.tipo === m.t);
        if (espera >= 0) { cli._lidas.add(m); cli._esperas.splice(espera, 1)[0].r(m); }
      }
    });
    s.on('close', () => { if (cli.fim === null) { cli.fim = 1006; if (cli._fimEspera) cli._fimEspera(1006); } });
    s.on('error', falha);
  });
}

async function entrar(porta, crachas, dados) {
  const ws = await abrir(porta, dados.sala);
  ws.enviar({ t: 'entrar', cracha: await crachas.assinar(dados) });
  return ws;
}

// A porta se PERGUNTA ao sistema, nunca se sorteia. Sortear em [8100,8899] sem
// conferir se está livre deixou o CI vermelho de vez em quando, e o sintoma não
// se depurava: `test/csp-vm` (8218), `test/vm-gc` (8351 e 8352) e
// `test/vm-estaticos` (8473) sobem `server/node.mjs` em porta FIXA dentro dessa
// faixa, e o `node --test` roda os arquivos em PARALELO. Na colisão, o servidor
// desta suíte não conseguia escutar e morria calado (`stdio: 'ignore'`) — mas o
// laço de prontidão via o servidor DO OUTRO teste responder, o upgrade de
// WebSocket funcionava (é o mesmo `server/node.mjs`) e só o crachá é que não
// valia, porque a chave era outra. Resultado: "esperei 'eu' e não veio" depois
// de 4s, num arquivo que passa sozinho 100% das vezes.
// Com 5 servidores por execução e 4 portas fixas em 800, dá ~2,5% por rodada —
// o padrão "quase sempre verde, às vezes vermelho" que ensina todo mundo a
// ignorar o CI.
function portaLivre() {
  return new Promise((ok, falha) => {
    const s = createServer();
    s.on('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function comServidor(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'wp-sala-'));
  const porta = await portaLivre();
  // `stdio: 'ignore'` era metade do problema: o filho que não conseguia escutar
  // morria sem deixar rastro. Agora esperamos o ANÚNCIO dele — sinal POSITIVO,
  // e não a ausência de um marcador (gotcha #62). Um `fetch` que responde não
  // prova nada: na colisão quem respondia era o servidor do OUTRO arquivo de
  // teste, e o nosso filho ainda nem tinha tentado escutar, então `exitCode`
  // seguia `null` e qualquer checagem de "morreu?" passava batido.
  const p = spawn(process.execPath, [join(RAIZ, 'server', 'node.mjs')], {
    env: { ...process.env, PORT: String(porta), HOST: '127.0.0.1', SESSION_DIR: dir, ENCRYPTION_KEY: CHAVE_B64 },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const subiu = new Promise((ok, falha) => {
      let saida = '';
      const prazo = setTimeout(() => falha(new Error(
        `o servidor da sala não anunciou a porta ${porta} em 8s. Saída: ${saida.slice(0, 300)}`)), 8000);
      p.stdout.on('data', (d) => {
        saida += d;
        if (saida.includes(`:${porta}`)) { clearTimeout(prazo); ok(); }
      });
      p.stderr.on('data', (d) => { saida += d; });
      p.on('exit', (c, sig) => falha(new Error(
        `o servidor da sala morreu ao subir na porta ${porta} (saída ${c ?? sig}) `
        + `— porta tomada por outro teste? Saída: ${saida.slice(0, 300)}`)));
    });
    await subiu;
    await fn(porta, makeCrachas({ keyBytes: base64ToBytes(CHAVE_B64) }));
  } finally {
    p.kill('SIGKILL');
  }
}
