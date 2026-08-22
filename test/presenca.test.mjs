// O núcleo da sala de presença (`server/presenca.mjs`) — o que ele aceita, o
// que recusa, e o que ele se recusa a saber.
//
// Existe porque a sala é o único pedaço do projeto que roda em dois servidores
// ao mesmo tempo (o Durable Object da Cloudflare e o adaptador Node) e não tem
// tela pra denunciar quando diverge. Crachá que aceita assinatura errada, lista
// que inclui você mesmo ou nome de sala montado diferente nos dois lados não
// quebram nada visível — só ficam errados.
//
// Relógio é INJETADO em toda função de tempo, então nada aqui dorme.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  salaDaFila, limpar, credenciaisTurn, listaDePares,
  assinarCracha, conferirCracha, corpoDoCracha, igualEmTempoConstante,
  CRACHA_TTL, LIMITE_LISTA, MAX_BODY,
} from '../server/presenca.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// O mesmo HMAC que o adaptador injeta. Assinatura de teste feita com outro
// algoritmo mediria o teste, não o código.
const hmac = async (segredo, msg) => createHmac('sha1', segredo).update(msg).digest('base64');
const SEGREDO = 'segredo-de-teste';
const T0 = 1_700_000_000_000;

// ── A SALA É A FILA ─────────────────────────────────────────────────────────

test('salaDaFila resolve a fila em nome de sala', () => {
  assert.equal(salaDaFila('row', 30, 5), 'row:30:5');
  assert.equal(salaDaFila('row', '30', null), 'row:30');
  assert.equal(salaDaFila('row', 30, ''), 'row:30');
  assert.equal(salaDaFila('row', 30, 'SP'), 'row:30', 'estado não-numérico devia ser ignorado');
  assert.equal(salaDaFila(null, 30), 'row:30', 'região ausente devia cair no padrão');

  // Sem país não existe sala: "todo mundo do mundo" não é a fila de ninguém, e
  // a lista deixaria de dizer o que promete (quem está triando O MESMO lugar).
  assert.equal(salaDaFila('row', null), null);
  assert.equal(salaDaFila('row', 0), null);
  assert.equal(salaDaFila('row', 'abc'), null);

  // O nome vira id de Durable Object e chave de mapa: `..` de path e `/` de
  // URL não podem sobreviver.
  assert.equal(salaDaFila('../../etc', 30), 'etc:30');
  assert.equal(limpar('a b/c\nd'), 'abcd');
  assert.equal(limpar('x'.repeat(200)).length, 64, 'sem teto de tamanho');
});

test('o NOME DA SALA nasce só no servidor — o cliente usa o que o crachá diz', () => {
  // Duas montagens do mesmo nome divergem sozinhas (o estado entra num lado e
  // não no outro) e o sintoma é "não vejo ninguém", que ninguém sabe depurar.
  // Por isso o cliente NÃO monta: manda região/país/estado, o servidor resolve
  // com `salaDaFila` e devolve a sala DENTRO do crachá assinado — o mesmo valor
  // que a sala confere na entrada.
  const CLIENTE = read('js/presenca.js');
  assert.equal(/salaDaFila/.test(CLIENTE), false, 'o cliente voltou a montar o nome da sala');
  assert.match(CLIENTE, /cracha\.sala/, 'o cliente parou de usar a sala do crachá');

  const CORE = read('server/core.mjs');
  assert.match(CORE, /salaDaFila\(/, 'o servidor parou de usar a fonte única do nome da sala');
});

// ── CRACHÁ ──────────────────────────────────────────────────────────────────

test('crachá válido passa; assinatura de outro segredo não', async () => {
  const c = await assinarCracha({ peer: 'p1', nome: 'Ana', rank: 5, am: true, sala: 'row:30' }, SEGREDO, T0, hmac);
  assert.equal(c.exp, Math.floor(T0 / 1000) + CRACHA_TTL);
  assert.ok(await conferirCracha(c, SEGREDO, T0, hmac), 'crachá recém-assinado foi recusado');
  assert.equal(await conferirCracha(c, 'outro-segredo', T0, hmac), null, 'aceitou assinatura de outro segredo');
});

test('crachá adulterado é recusado em QUALQUER campo — inclusive rank e AM', async () => {
  // O ponto do crachá: rank e AM carregam reputação. Se dessem pra editar no
  // cliente, a lista viraria um convite a se passar por gente com autoridade.
  const base = { peer: 'p1', nome: 'Ana', rank: 1, am: false, staff: false, sala: 'row:30' };
  const c = await assinarCracha(base, SEGREDO, T0, hmac);
  for (const campo of ['peer', 'nome', 'rank', 'am', 'staff', 'sala', 'exp']) {
    const forjado = { ...c };
    forjado[campo] = campo === 'rank' ? 6 : (campo === 'am' || campo === 'staff') ? true
      : campo === 'exp' ? c.exp + 3600 : `${c[campo]}x`;
    assert.equal(await conferirCracha(forjado, SEGREDO, T0, hmac), null, `aceitou crachá com ${campo} trocado`);
  }
});

test('crachá vencido é recusado, e lixo não derruba a conferência', async () => {
  const c = await assinarCracha({ peer: 'p1', nome: 'Ana', sala: 'row:30' }, SEGREDO, T0, hmac);
  assert.ok(await conferirCracha(c, SEGREDO, T0 + CRACHA_TTL * 1000 - 1000, hmac), 'venceu antes da hora');
  assert.equal(await conferirCracha(c, SEGREDO, T0 + CRACHA_TTL * 1000 + 1000, hmac), null, 'crachá vencido entrou');

  // Quem chama está no caminho de rede: `null` é resposta, exceção é queda.
  for (const lixo of [null, undefined, 0, 'x', [], {}, { sig: 'a' }, { sig: 'a', exp: 'ontem' }]) {
    assert.equal(await conferirCracha(lixo, SEGREDO, T0, hmac), null, `lançou ou aceitou com ${JSON.stringify(lixo)}`);
  }
});

test('o corpo assinado tem ordem FIXA e normaliza booleano', async () => {
  // Assinatura é sobre string: chave em ordem diferente é outra string. E
  // `true` × `'true'` assinariam diferente depois de uma volta pelo JSON.
  const c = { peer: 'p1', nome: 'Ana', rank: 5, am: true, staff: false, sala: 'row:30', exp: 123 };
  assert.equal(corpoDoCracha(c), 'p1|Ana|5|1|0|row:30|123');
  assert.equal(corpoDoCracha({ ...c, am: 1, staff: 0 }), corpoDoCracha(c));
});

test('a comparação de assinatura é em tempo constante', () => {
  assert.equal(igualEmTempoConstante('abc', 'abc'), true);
  assert.equal(igualEmTempoConstante('abc', 'abd'), false);
  assert.equal(igualEmTempoConstante('abc', 'ab'), false);
  assert.equal(igualEmTempoConstante('', ''), true);
  // O que o guard protege é o CÓDIGO: `===` volta silencioso e vira oráculo de
  // prefixo pra forjar assinatura byte a byte.
  const src = read('server/presenca.mjs');
  const fn = src.match(/export function igualEmTempoConstante[\s\S]*?\n\}/);
  assert.ok(fn, 'sumiu a comparação de tempo constante');
  assert.match(fn[0], /\^/, 'a comparação deixou de ser por XOR acumulado');
  const conferir = src.match(/export async function conferirCracha[\s\S]*?\n\}/)[0];
  assert.match(conferir, /igualEmTempoConstante/, 'a conferência voltou a comparar assinatura com ===');
});

test('a sala confere o crachá, e confere que ele é DESTA sala', async () => {
  // Crachá é assinado para uma sala. Sem conferir o campo `sala`, um crachá
  // legítimo do Brasil entraria na sala de Portugal — assinatura válida, lugar
  // errado, e ninguém veria erro nenhum.
  for (const arq of ['worker/sala-do.mjs', 'server/node.mjs']) {
    const src = read(arq);
    assert.match(src, /conferir\(/, `${arq} não confere crachá`);
    assert.match(src, /cracha\.sala\s*!==|cracha\.sala\s*!=/, `${arq} aceita crachá de outra sala`);
  }
});

// ── A LISTA ─────────────────────────────────────────────────────────────────

test('a lista NÃO inclui quem perguntou, e sai em ordem estável', () => {
  // Incluir você mesmo faria a pílula contar "1 editor online" com você sozinho
  // na sala. E ordem instável faz a folha piscar a cada entrada e saída.
  const gente = [
    { peer: 'eu', nome: 'Zeca' },
    { peer: 'b', nome: 'Bia' },
    { peer: 'a', nome: 'Ana' },
    { peer: 'b', nome: 'Bia' },   // dois sockets do mesmo peer: conta uma vez
  ];
  const r = listaDePares(gente, 'eu');
  assert.deepEqual(r.peers.map((p) => p.peer), ['a', 'b'], 'ordem instável, duplicou ou incluiu a si mesmo');
  assert.equal(r.total, 2);
  assert.deepEqual(listaDePares(gente, 'eu').peers.map((p) => p.peer), ['a', 'b'], 'duas leituras, ordens diferentes');
  assert.deepEqual(listaDePares([], 'eu'), { total: 0, peers: [] });
});

test('a lista tem teto, mas o total continua verdadeiro', () => {
  // Fila grande (o Brasil inteiro) pode ter muita gente. Cortar a lista sem
  // mandar o total faria a pílula mentir justamente onde há mais companhia.
  const muitos = Array.from({ length: LIMITE_LISTA + 10 }, (_, i) => ({ peer: `p${String(i).padStart(3, '0')}`, nome: `E${i}` }));
  const r = listaDePares(muitos, 'ninguem');
  assert.equal(r.peers.length, LIMITE_LISTA, 'a lista passou do teto');
  assert.equal(r.total, LIMITE_LISTA + 10, 'o total foi cortado junto com a lista');
});

test('a lista carrega rank/AM/staff, e só isso', () => {
  // O que aparece na folha. Campo a mais aqui é campo que o servidor repassa
  // sem ninguém ter decidido — e a Ajuda promete uma lista curta.
  const [p] = listaDePares([{ peer: 'a', nome: 'Ana', rank: 5, am: true, staff: false, ip: '1.2.3.4' }], 'eu').peers;
  assert.deepEqual(Object.keys(p).sort(), ['am', 'nome', 'peer', 'rank', 'staff']);
});

// ── TURN ────────────────────────────────────────────────────────────────────

test('credencial TURN segue o padrão do coturn (use-auth-secret)', async () => {
  const { iceServers } = await credenciaisTurn('turn:a:3478,turns:a:5349', SEGREDO, 3600, T0, hmac);
  const [srv] = iceServers;
  assert.deepEqual(srv.urls, ['turn:a:3478', 'turns:a:5349'], 'a lista separada por vírgula não virou array');
  // username = expiração unix; credential = base64(HMAC-SHA1(segredo, username)).
  // Divergir disso não dá erro daqui: dá 401 no coturn, do outro lado da rede.
  assert.equal(srv.username, String(Math.floor(T0 / 1000) + 3600));
  assert.equal(srv.credential, createHmac('sha1', SEGREDO).update(srv.username).digest('base64'));

  const arr = await credenciaisTurn(['turn:b:3478'], SEGREDO, 0, T0, hmac);
  assert.deepEqual(arr.iceServers[0].urls, ['turn:b:3478'], 'array não passou direto');
  assert.equal(arr.iceServers[0].username, String(Math.floor(T0 / 1000) + 86400), 'ttl inválido não caiu no padrão');
});

test('o TURN do servidor é assinado com SHA-1 — o coturn não valida outra coisa', () => {
  // HMAC-SHA256 aqui não dá erro nenhum do nosso lado: dá 401 no coturn, longe
  // daqui, e o sintoma é "a conversa não conecta em rede simétrica".
  const CORE = read('server/core.mjs');
  const chamada = CORE.match(/credenciaisTurn\([\s\S]{0,400}?\)\);/);
  assert.ok(chamada, 'sumiu a emissão de credencial TURN');
  assert.match(chamada[0], /'SHA-1'/, 'o TURN deixou de ser assinado com SHA-1');
});

// ── O QUE O SERVIDOR NÃO SABE ───────────────────────────────────────────────

test('o núcleo da sala não fala com plataforma nenhuma', () => {
  // Ele roda no Worker E no Node. Um `node:` aqui quebra o Worker; um
  // `console` aqui é log de quem está online, num servidor que promete não
  // guardar nada.
  const src = read('server/presenca.mjs');
  const codigo = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const proibido of [/require\s*\(/, /from\s+'node:/, /\bprocess\./, /\bconsole\./, /globalThis\./]) {
    assert.equal(proibido.test(codigo), false, `o núcleo puro passou a usar ${proibido}`);
  }
  // Relógio injetado: `Date.now()` aqui torna a validade do crachá impossível
  // de testar sem dormir, e é assim que teste de tempo vira teste que ninguém roda.
  assert.equal(/Date\.now\(\)/.test(codigo), false, 'o núcleo passou a ler o relógio sozinho');
});

test('a presença é a CONEXÃO, não um registro com prazo', () => {
  // Contrato publicado na Ajuda: "some assim que você sai". Isso só é verdade
  // enquanto ninguém guardar presença com TTL — no minuto em que a sala passar
  // a lembrar de quem fechou a app, a Ajuda vira mentira nas 4 línguas.
  const src = read('server/presenca.mjs');
  assert.equal(/PRESENCA_TTL|setTimeout|setInterval/.test(src), false,
    'a sala passou a guardar presença com prazo: revisite a frase da Ajuda');

  // E os adaptadores não podem GRAVAR presença em lugar nenhum. `Map` em
  // memória é a implementação certa: ela some com o processo, que é
  // exatamente o que a Ajuda promete.
  const DO = read('worker/sala-do.mjs');
  assert.equal(/state\.storage|\.sql\b|ctx\.storage/.test(DO), false,
    'o Durable Object passou a persistir — o servidor prometeu não guardar');
  const NODE = read('server/node.mjs');
  const salaNoNode = NODE.slice(NODE.indexOf('const salas = new Map()'), NODE.indexOf('server.listen('));
  assert.ok(salaNoNode.length > 500, 'sumiu a sala do adaptador Node');
  assert.equal(/writeFile|fsStore|SESSION_DIR/.test(salaNoNode), false,
    'a sala do Node passou a escrever em disco');
});

test('frame maior que MAX_BODY é recusado nos dois adaptadores', () => {
  // SDP grande cabe com folga em 64KB. Sem teto, um cliente hostil manda um
  // frame de 2GB e o servidor aloca o buffer antes de olhar o conteúdo.
  assert.equal(MAX_BODY, 65536);
  for (const arq of ['worker/sala-do.mjs', 'server/node.mjs']) {
    assert.match(read(arq), /MAX_BODY/, `${arq} não tem teto de tamanho de frame`);
  }
});
