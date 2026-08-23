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

test('quem é "a mesma pessoa" é o NOME, nunca o peer', () => {
  // Relatado pelo owner com print: recarregar a página o duplicava na lista —
  // e ele aparecia na PRÓPRIA lista, com a pílula contando 3 onde havia 1
  // colega. Recarregando de novo, acumulava; os colegas o viam repetido também.
  //
  // A causa: o `peer` é sorteado A CADA CARGA DA PÁGINA. Ele endereça uma
  // CONEXÃO, não um editor. Enquanto o socket antigo não fecha, a mesma pessoa
  // está na sala com dois peers, e a comparação por peer não os junta.
  //
  // O nome vem do crachá ASSINADO pelo servidor (username do WME): único por
  // conta, e não dá pra forjar.
  const sala = [
    { peer: 'p1', nome: 'antigerme', rank: 5, am: true, staff: false, desde: 1 },
    { peer: 'p2', nome: 'antigerme', rank: 5, am: true, staff: false, desde: 2 },
    { peer: 'p3', nome: 'antigerme', rank: 5, am: true, staff: false, desde: 3 },
    { peer: 'p9', nome: 'PatrickBLopes', rank: 5, am: true, staff: false, desde: 1 },
  ];

  // Eu, no socket mais novo: NÃO me vejo, e a pílula conta só o colega.
  const meu = listaDePares(sala, { peer: 'p3', nome: 'antigerme' });
  assert.equal(meu.total, 1, 'a pílula voltou a contar as minhas próprias conexões');
  assert.deepEqual(meu.peers.map((p) => p.nome), ['PatrickBLopes']);

  // O colega vê UM antigerme — e o do socket MAIS RECENTE, porque é pra esse
  // peer que a conversa é chamada; o antigo é o que está morrendo.
  const dele = listaDePares(sala, { peer: 'p9', nome: 'PatrickBLopes' });
  assert.equal(dele.total, 1, 'o colega voltou a ver a mesma pessoa repetida');
  assert.equal(dele.peers[0].peer, 'p3', 'a lista aponta pra conexão velha, e a conversa cairia num socket morto');

  // Sem nome (não deveria acontecer, mas não pode juntar gente diferente).
  const anon = listaDePares([{ peer: 'x' }, { peer: 'y' }], { peer: 'z' });
  assert.equal(anon.total, 2, 'sem nome, peers distintos viraram a mesma pessoa');
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

// ── TURN da Cloudflare ──────────────────────────────────────────────────────
// Mecanismo DIFERENTE do coturn: a credencial não é calculada, é pedida por
// HTTP. Testado com `fetch` injetado, e a resposta é a que foi MEDIDA na conta
// real — não uma que eu imaginei.

test('turnDaCloudflare devolve os iceServers no formato do RTCPeerConnection', async () => {
  const { turnDaCloudflare } = await import('../server/core.mjs');
  // Resposta REAL de /credentials/generate-ice-servers (usuário e senha
  // trocados). As portas 53/80/443 são o motivo de usarmos ESTE endpoint e não
  // o irmão: 3478 é bloqueado em muita rede corporativa.
  const respostaReal = {
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:3478?transport=tcp',
          'turns:turn.cloudflare.com:5349?transport=tcp',
          'turn:turn.cloudflare.com:53?transport=udp',
          'turn:turn.cloudflare.com:80?transport=tcp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'u', credential: 'c',
      },
    ],
  };
  let visto = null;
  const falso = async (url, opts) => { visto = { url, opts }; return { status: 201, json: async () => respostaReal }; };

  const lista = await turnDaCloudflare('chave-123', 'token-abc', 900, falso);
  assert.deepEqual(lista, respostaReal.iceServers);
  assert.match(visto.url, /\/v1\/turn\/keys\/chave-123\/credentials\/generate-ice-servers$/);
  assert.equal(visto.opts.method, 'POST');
  assert.equal(visto.opts.headers.Authorization, 'Bearer token-abc');
  assert.deepEqual(JSON.parse(visto.opts.body), { ttl: 900 });
  // Porta que atravessa firewall corporativo — o que este endpoint tem a mais.
  assert.ok(lista[1].urls.some((u) => u.includes(':443')), 'sumiu a porta 443 do TURN');
});

test('turnDaCloudflare aceita a forma de OBJETO do endpoint irmão', async () => {
  // `/credentials/generate` devolve `iceServers` como objeto único, não array.
  // Trocar a URL sem tratar isso entregaria `iceServers` inválido pro browser.
  const { turnDaCloudflare } = await import('../server/core.mjs');
  const falso = async () => ({ status: 201, json: async () => ({ iceServers: { urls: ['turn:x:3478'], username: 'u', credential: 'c' } }) });
  assert.deepEqual(await turnDaCloudflare('k', 't', 900, falso), [{ urls: ['turn:x:3478'], username: 'u', credential: 'c' }]);
});

test('TURN fora do ar NÃO derruba a presença — devolve null e o STUN assume', async () => {
  // Trocar "a conversa não conecta em NAT simétrico" por "ninguém aparece na
  // lista" seria piorar o problema. Qualquer falha vira `null`.
  const { turnDaCloudflare } = await import('../server/core.mjs');
  const casos = [
    ['HTTP 401', async () => ({ status: 401, json: async () => ({}) })],
    ['HTTP 500', async () => ({ status: 500, json: async () => ({}) })],
    ['corpo sem iceServers', async () => ({ status: 201, json: async () => ({}) })],
    ['lista vazia', async () => ({ status: 201, json: async () => ({ iceServers: [] }) })],
    ['json quebrado', async () => ({ status: 201, json: async () => { throw new Error('json'); } })],
    ['rede fora', async () => { throw new Error('ECONNREFUSED'); }],
  ];
  for (const [nome, falso] of casos) {
    assert.equal(await turnDaCloudflare('k', 't', 900, falso), null, `${nome} devia virar null`);
  }
});

test('o token do TURN não vaza no core', () => {
  // Ele é credencial de conta, não de sessão. O core não tem `console`, mas o
  // guard existe porque a tentação de "só um log pra depurar" é exatamente aqui.
  const CORE = read('server/core.mjs');
  const bloco = CORE.slice(CORE.indexOf('export async function turnDaCloudflare'));
  const fim = bloco.indexOf('\n}');
  assert.equal(/console\.|apiToken\s*\+|\$\{apiToken\}[^`]*`\s*\)/.test(bloco.slice(0, fim)), false,
    'o token do TURN entrou em log ou em concatenação fora do header');
});

// ── O CLIENTE ───────────────────────────────────────────────────────────────

test('todo método que o app.js chama existe mesmo no objeto Presenca', () => {
  // O bug que isto trava chegou na tela do owner: `Presenca.fecharConversa is
  // not a function` ao tocar no ✕ da conversa. Havia DOIS `Presenca` — o
  // `const` do estado e o `window.Presenca` dos métodos — e binding léxico
  // global GANHA de propriedade de window em script clássico, então o app.js
  // achava o objeto errado. Só o ✕ quebrava, porque todo o resto escreve
  // `window.Presenca?.…` explícito.
  const APP = read('js/app.js');
  const CLI = read('js/presenca.js');

  const expostos = new Set();
  const bloco = CLI.match(/Object\.assign\(Presenca, \{([\s\S]*?)\}\);/);
  assert.ok(bloco, 'sumiu o Object.assign que pendura os métodos no estado');
  for (const m of bloco[1].matchAll(/(\w+)\s*:/g)) expostos.add(m[1]);
  // Campos do próprio estado também são alcançáveis por quem escreve `Presenca.x`.
  const estado = CLI.match(/^const Presenca = \{([\s\S]*?)^\};/m);
  assert.ok(estado, 'sumiu o objeto de estado');
  for (const m of estado[1].matchAll(/^\s{4}(\w+):/gm)) expostos.add(m[1]);

  const usados = [...APP.matchAll(/(?:window\.)?Presenca\??\.(\w+)/g)].map((m) => m[1]);
  assert.ok(usados.length, 'o app.js parou de falar com a presença');
  const faltando = [...new Set(usados)].filter((u) => !expostos.has(u));
  assert.deepEqual(faltando, [],
    `o app.js chama Presenca.${faltando.join('/')} que não existe no objeto`);
});

test('o estado e o objeto exportado são o MESMO — nada de dois Presenca', () => {
  // Enquanto forem dois objetos, `Presenca.x` e `window.Presenca.x` podem
  // divergir, e a diferença só aparece em runtime, num clique específico.
  const CLI = read('js/presenca.js');
  assert.match(CLI, /window\.Presenca = Presenca;/,
    'window.Presenca precisa APONTAR pro objeto de estado, não ser outro objeto');
  assert.equal(/window\.Presenca = \{/.test(CLI), false,
    'voltou a existir um segundo objeto Presenca — é o bug do ✕ de novo');
});

// ── O CUSTO DE RECONECTAR ───────────────────────────────────────────────────

test('o recuo só zera quando o servidor ACEITA, não quando o socket abre', () => {
  // O bug mais caro do recurso, e ele não aparece em teste de layout nem de
  // protocolo: `onopen` zerava o contador de tentativas. Mas abrir o socket
  // NÃO é ter conectado — a recusa do crachá, o fechamento pelo servidor e a
  // queda de rede vêm todos DEPOIS do `onopen`. Zerando ali, o recuo nunca
  // cresce e cada falha vira uma tentativa nova a cada 2 segundos, pra sempre.
  //
  // MEDIDO com o servidor fechando logo após o upgrade: 16 tentativas em 31s,
  // todas espaçadas 2s. Cada uma custa DUAS requisições ao Worker (o crachá e
  // o upgrade) e uma chamada ao Waze — ~3.600 requisições/hora por aparelho
  // preso. Depois do conserto, ~120.
  const CLI = read('js/presenca.js');

  const onopen = CLI.match(/ws\.onopen = \(\) => \{[\s\S]*?\n    \};/);
  assert.ok(onopen, 'sumiu o onopen do socket');
  assert.equal(/tentativa\s*=\s*0/.test(onopen[0]), false,
    'o `onopen` voltou a zerar o recuo — abrir o socket não é ter conectado');

  // Quem zera é a confirmação do servidor.
  assert.match(CLI, /m\.t === 'eu'\s*\)\s*\{\s*Presenca\.tentativa = 0/,
    'só a mensagem `eu` (servidor aceitou o crachá) pode zerar o recuo');
});

test('a espera de reconexão tem jitter', () => {
  // Servidor que cai desconecta TODO mundo no mesmo instante. Espera igual pra
  // todos transforma uma queda numa rajada sincronizada de volta — o mesmo
  // motivo do jitter das chamadas ao Waze, agora do lado do cliente.
  const CLI = read('js/presenca.js');
  const fn = CLI.match(/function presencaReagendar\(\)[\s\S]*?\n\}/);
  assert.ok(fn, 'sumiu o presencaReagendar');
  assert.match(fn[0], /Math\.random\(\)/, 'a espera de reconexão voltou a ser fixa');
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
