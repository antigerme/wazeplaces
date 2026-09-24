// A presença do app — a lista de quem usa o app e a conversa, que desde a
// fase 3 são as do WME. Aqui ficam as regras que se leem no TEXTO do cliente,
// e o guard que impede a sala própria de voltar.
//
// O comportamento mora em outros arquivos: o do cliente em
// `test/presenca-cliente.test.mjs` (o `presenca.js` inteiro num navegador de
// mentira), o do servidor em `test/presenca-app.test.mjs`,
// `test/presenca-carona.test.mjs` e `test/wme-grpc.test.mjs`.
//
// Até a fase 4 este arquivo era o do núcleo da sala (`server/presenca.mjs`):
// crachá assinado, nome da sala, lista e TURN. A sala saiu inteira — o núcleo,
// o WebSocket da VM, o Durable Object e a rota `presenca` —, e os testes dela
// junto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// Comentário fora ANTES de casar: o comentário que explica por que algo saiu
// cita o nome do que saiu (gotcha #67).
const semComentario = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ── A SALA PRÓPRIA NÃO VOLTA ────────────────────────────────────────────────

test('a sala própria não existe mais — nem no cliente, nem nos servidores, nem no wrangler', async () => {
  // Saiu na fase 4. O que sobrasse dela seria código que ninguém chama e que
  // alguém um dia "conserta" — ou um Durable Object pendurado no deploy.
  for (const arq of ['server/presenca.mjs', 'server/ws.mjs', 'worker/sala-do.mjs']) {
    assert.equal(existsSync(join(ROOT, arq)), false, `${arq} voltou`);
  }

  // A rota, pelo COMPORTAMENTO: o dispatch a trata como qualquer rota que não existe.
  const { dispatch } = await import('../server/core.mjs');
  const r = await dispatch('presenca', { region: 'row', countryId: 30 }, {});
  assert.equal(r.status, 404, 'a rota `presenca` voltou');
  assert.equal(r.body.errorKey, 'srv.err.endpointNotFound');
  // Controle: uma rota que existe NÃO dá 404 — senão o 404 acima mediria um
  // dispatch quebrado, e não a ausência da rota.
  const viva = await dispatch('presenca-app', {}, {});
  assert.notEqual(viva.status, 404, 'o controle falhou: presenca-app deu 404, e o 404 acima não prova nada');

  // Os dois adaptadores: nenhum atende o /sala nem sobe servidor WebSocket.
  assert.doesNotMatch(semComentario(read('worker/index.mjs')), /['"]\/sala['"]|SalaDO|env\.SALA/,
    'o Worker voltou a atender a sala');
  assert.doesNotMatch(semComentario(read('server/node.mjs')), /\.on\('upgrade'|['"]\/sala['"]/,
    'o node.mjs voltou a atender a sala');

  // O wrangler: sem binding, e com a migração que APAGA a classe. A de criação
  // fica antes dela: as migrações são um HISTÓRICO, e a Cloudflare aplica só as
  // tags posteriores à última já aplicada no servidor.
  const cfg = JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(cfg.durable_objects, undefined, 'o binding do Durable Object voltou');
  assert.deepEqual((cfg.migrations || []).map((m) => m.tag).slice(0, 2), ['v1', 'v2'],
    'as migrações não começam mais em v1 → v2: a história não bate com a do servidor');
  assert.deepEqual(cfg.migrations[0].new_sqlite_classes, ['SalaDO'], 'a migração de criação sumiu ou mudou');
  assert.deepEqual(cfg.migrations[1].deleted_classes, ['SalaDO'], 'sumiu a migração que apaga o SalaDO');
  assert.equal('exports' in cfg, false, '`exports` e `migrations` são mutuamente exclusivos: a Cloudflare recusa os dois');

  // E o cliente não fala com nada disso.
  const CLIENTE = semComentario(read('js/presenca.js'));
  for (const proibido of [/new WebSocket/, /RTCPeerConnection/, /['"]\/sala['"]/, /API\.presenca\(/, /cracha/]) {
    assert.equal(proibido.test(CLIENTE), false, `o cliente voltou a usar a sala própria (${proibido})`);
  }
  assert.match(CLIENTE, /API\.presencaApp\(/, 'o cliente parou de pedir a lista do app');
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

test('o pedido mandado pela conversa leva a foto que o CARD mostra', () => {
  // Levava `place.imageUrl`, que é a PRIMEIRA foto do local. Num pedido de
  // "Nova foto" o card abre na foto EM DECISÃO — que na fila do owner não é a
  // primeira em 13 de 76 pedidos de foto —, então o colega recebia uma foto que
  // o local já tinha, e não a que se perguntava. A regra é a do carrossel:
  // `fotosDoCard`, fonte única.
  const APP = read('js/app.js');
  const i = APP.indexOf('function cardParaConversa(');
  assert.ok(i !== -1, 'cardParaConversa sumiu do app.js');
  const a = APP.indexOf('{', APP.indexOf(')', i));
  let prof = 0, fim = -1;
  for (let j = a; j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}' && --prof === 0) { fim = j + 1; break; }
  }
  // Só CÓDIGO: o comentário da função cita `place.imageUrl` justamente pra
  // explicar por que ele saiu (gotcha #67).
  const corpo = APP.slice(i, fim).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(corpo, /fotosDoCard\(place\)/, 'a conversa voltou a escolher a foto por conta própria');
  assert.match(corpo, /imageUrl: fotos\.urls\[fotos\.inicial\]/,
    'a conversa tem que mandar a foto em que o card ABRE');
  assert.doesNotMatch(corpo, /place\.imageUrl|imageUrls\[0\]/,
    'a conversa voltou a mandar a primeira foto do local');
  // CRUA: o sufixo `?w=` é do cache de quem MANDA, e o de quem recebe é outro.
  assert.doesNotMatch(corpo, /urlDaFoto\(/, 'a foto da conversa não pode levar o sufixo do offline');
});

test('o smoke da presença manda um pedido cuja foto do pedido NÃO é a primeira', () => {
  // Com a lista de fotos vazia, o smoke nunca perguntava QUAL foto ia pela
  // conversa. A fixture tem que DISTINGUIR: duas fotos, `imageUrl` com a
  // primeira (como o servidor manda) e o pedido casado com a segunda.
  const SMOKE = read('tools/smoke-presenca.mjs');
  assert.match(SMOKE, /imageUrl: 'https:\/\/venue-image\.waze\.com\/thumbs\/thumb700_ja-no-local'/,
    'a fixture perdeu a primeira foto no `imageUrl` — sem ela o código antigo passaria');
  assert.match(SMOKE, /recebido\.foto === 'https:\/\/venue-image\.waze\.com\/thumbs\/thumb700_ur-smoke'/,
    'o smoke deixou de cobrar que chega a foto DO PEDIDO');
  // E nunca vai ao CDN de verdade: no CI o navegador tem rede.
  assert.match(SMOKE, /ctx\.route\('\*\*\/venue-image\.waze\.com\/\*\*'/,
    'o smoke passaria a pedir a foto ao Waze de verdade');
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

test('o recuo do tempo real só zera quando o Google ENTREGA o lote, não quando a conexão abre', () => {
  // O bug mais caro da sala, e ele vale pro fluxo do Google do mesmo jeito:
  // zerar o recuo ao abrir faz toda falha virar uma tentativa nova a cada
  // poucos segundos, pra sempre. O que prova que a conexão SERVE é o fim do
  // lote inicial (`endOfBatch`) — é o `eu` da sala, noutra roupa. O desligar
  // também zera, e é outra coisa: é a pessoa saindo, não a rede voltando.
  const CLI = read('js/presenca.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // DENTRO do bloco do fim do lote, medido casando as chaves — e não "na mesma
  // linha", que reprovava o bloco assim que ele ganhou mais de uma instrução
  // (gotcha #67: guard amarrado na forma, não na estrutura).
  const iniLote = CLI.indexOf('if (o.endOfBatch) {');
  assert.ok(iniLote > 0, 'sumiu o tratamento do fim do lote');
  let prof = 0, fimLote = -1;
  for (let i = CLI.indexOf('{', iniLote); i < CLI.length; i++) {
    if (CLI[i] === '{') prof++;
    else if (CLI[i] === '}' && --prof === 0) { fimLote = i; break; }
  }
  const zeragens = [...CLI.matchAll(/fluxoTentativa\s*=\s*0/g)].map((m) => {
    const linha = CLI.slice(CLI.lastIndexOf('\n', m.index) + 1, CLI.indexOf('\n', m.index));
    const fn = [...CLI.slice(0, m.index).matchAll(/function (\w+)\(/g)].pop();
    return { linha: linha.trim(), fn: fn ? fn[1] : '?', noLote: m.index > iniLote && m.index < fimLote };
  });
  assert.ok(zeragens.some((z) => z.noLote), 'o fim do lote deixou de zerar o recuo');
  const fora = zeragens.filter((z) => !z.noLote && z.fn !== 'presencaDesligar');
  assert.deepEqual(fora.map((z) => `${z.fn}: ${z.linha}`), [],
    'o recuo do tempo real é zerado fora do fim do lote — abrir a conexão não é ter conectado');
});

test('o `online` do navegador não zera o recuo do tempo real', () => {
  // Herdado da sala própria, onde custou caro: zerar o recuo num evento que
  // não prova conexão fazia cada falha virar uma tentativa nova a cada 2 s, pra
  // sempre (MEDIDO na época: ~3.600 requisições por hora por aparelho preso).
  // `online` quer dizer "existe interface de rede", não "a internet funciona",
  // e num wi-fi instável ele dispara em laço. Quem zera é o fim do lote do
  // Google (o teste acima).
  const CLI = read('js/presenca.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const online = CLI.match(/addEventListener\('online', [^\n]*/);
  assert.ok(online, 'sumiu o ouvinte do `online`');
  assert.doesNotMatch(online[0], /Tentativa\s*=\s*0|tentativa\s*=\s*0/, 'o `online` voltou a zerar o recuo');
});

test('a espera de reconexão tem jitter', () => {
  // Servidor que cai desconecta TODO mundo no mesmo instante. Espera igual pra
  // todos transforma uma queda numa rajada sincronizada de volta — o mesmo
  // motivo do jitter das chamadas ao Waze, agora do lado do cliente. O fim
  // NORMAL do fluxo (o Google fecha a cada ~6 min) religa em 1 s, sem recuo.
  const CLI = read('js/presenca.js');
  const fn = CLI.match(/function presencaFluxoReagendar\(fimNormal\)[\s\S]*?\n\}/);
  assert.ok(fn, 'sumiu o presencaFluxoReagendar');
  assert.match(fn[0], /Math\.random\(\)/, 'a espera de reconexão voltou a ser fixa');
  assert.match(fn[0], /if \(fimNormal\) \{\s+espera = PRESENCA_FLUXO_RELIGAR_MS;/,
    'o fim normal do fluxo deixou de religar logo');
});
