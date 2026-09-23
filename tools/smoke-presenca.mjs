// Smoke da presença — DOIS navegadores de verdade, uma sala de verdade, uma
// conversa de verdade.
//
// Existe porque nada mais aqui prova que o recurso FUNCIONA. `test/presenca`
// cobre as regras (crachá, lista, sala) e `test/sala-node` cobre o protocolo do
// servidor, mas o pedaço que o editor usa — abrir o socket, ver o outro
// aparecer, o DataChannel conectar, o texto chegar — só existe em cima de
// WebRTC, e WebRTC não tem versão sem browser.
//
// Mora em `tools/` pelo mesmo motivo do `smoke-browser.mjs`: o `node --test`
// varre `test/` inteiro, e a suíte do projeto promete rodar com ZERO
// dependência.
//
//   npm run test:presenca
//
// O que fica de fora: o `/api/presenca`, que precisa dos cookies do Waze pra
// emitir o crachá. Aqui o crachá é assinado pelo MESMO `makeCrachas` do
// servidor e injetado — é exatamente o que o handler devolveria.

import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeCrachas, base64ToBytes } from '../server/core.mjs';
import { setTimeout as dormir } from 'node:timers/promises';
import { carregarPlaywright, abrirNavegador, motorPedido, resumoDosPulos } from './navegador.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.SMOKE_PORT || 8134);
const CHAVE = Buffer.alloc(32, 5).toString('base64');

// `WebRtcHideLocalIpsWithMdns` faz o Chromium anunciar o candidato host como um
// nome `.local` de mDNS em vez do IP. É proteção de privacidade e está certa no
// browser de verdade — mas dentro de contêiner a resolução de mDNS pode
// simplesmente não responder, e aí a conexão falha SEM erro, de vez em quando.
// Foi o que apareceu aqui: uma execução com "o DataChannel não abriu" e 21
// seguintes verdes. Desligar é ajuste do INSTRUMENTO (o teste roda em
// localhost), não do produto — a app continua com o padrão do browser.
const ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

// O MESMO ajuste, no WebKit — que não aceita a chave acima (MEDIDO: o launch
// falha com qualquer chave do Chromium). Lá o candidato de rede também chega
// como `<uuid>.local`, e sem resposta de mDNS no contêiner o ICE nem começa.
// MEDIDO com duas conexões na MESMA página: com o `.local`, o estado fica em
// "new" e o DataChannel não abre; com o mesmo candidato apontando pra
// 127.0.0.1, "connected" e abre. Ajuste do INSTRUMENTO, como o de cima: a app
// segue com o padrão do navegador, e num iPhone de verdade o candidato que
// conecta vem do STUN/TURN, não do nome local.
async function iceSemMdnsForaDoChromium(ctx) {
  if (MOTOR === 'chromium') return;
  await ctx.addInitScript(() => {
    const original = RTCPeerConnection.prototype.addIceCandidate;
    RTCPeerConnection.prototype.addIceCandidate = function (c, ...resto) {
      if (c && typeof c.candidate === 'string' && /\.local\b/i.test(c.candidate)) {
        const base = typeof c.toJSON === 'function' ? c.toJSON() : c;
        c = { ...base, candidate: c.candidate.replace(/[0-9a-f-]+\.local\b/i, '127.0.0.1') };
      }
      return original.call(this, c, ...resto);
    };
  });
}

const falhas = [];
const anota = (m) => { falhas.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

const dir = await mkdtemp(join(tmpdir(), 'wp-presenca-'));
const srv = spawn(process.execPath, [join(ROOT, 'server', 'node.mjs')], {
  env: { ...process.env, PORT: String(PORTA), HOST: '127.0.0.1', SESSION_DIR: dir, ENCRYPTION_KEY: CHAVE },
  stdio: 'ignore',
});
for (let i = 0; i < 100; i++) {
  try { await fetch(`http://127.0.0.1:${PORTA}/`); break; } catch { await dormir(100); }
}

const pw = await carregarPlaywright();
const MOTOR = motorPedido();
const browser = await abrirNavegador(pw, { args: ARGS });
const crachas = makeCrachas({ keyBytes: base64ToBytes(CHAVE) });

async function editor(nome, peer, rank, am, lang, preparar) {
  // `serviceWorkers: 'block'`: o SW da app se auto-atualiza e RECARREGA a página
  // no `controllerchange`. No meio do teste isso apaga o estado injetado e o
  // sintoma chega como "Presenca is not defined" — parece bug do produto e é do
  // instrumento. O smoke de layout já bloqueia pelo mesmo motivo.
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
  });
  await iceSemMdnsForaDoChromium(ctx);
  // Script que precisa estar na página ANTES da app (o `addInitScript` só vale
  // pra navegação seguinte) — o passo 11 atrasa a sala por aqui.
  if (preparar) await preparar(ctx);
  // A foto do pedido mandado pela conversa é do Waze: servida AQUI, pra o smoke
  // nunca bater no CDN de verdade (no CI o navegador tem rede).
  await ctx.route('**/venue-image.waze.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/gif',
    body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => anota(`[${nome}] erro de página: ${e.message}`));
  await page.addInitScript((l) => { try { localStorage.setItem('waze_places_lang', l); } catch (e) {} }, lang || 'pt');
  await page.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'domcontentloaded' });
  // Mesmo motivo do `esperar` abaixo: nada de `waitForFunction` neste arquivo.
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(() => !!(window.Presenca && window.AppState)).catch(() => false)) break;
    await dormir(100);
  }
  const cracha = await crachas.assinar({ peer, nome, rank, am, sala: 'row:30' });
  await page.evaluate(({ cracha, peer }) => {
    AppState.authenticated = true;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('userProfileBadge').classList.remove('hidden');
    Presenca.peer = peer;
    Presenca.cracha = cracha;
    Presenca.ice = { iceServers: [] };   // localhost: o candidato host basta
    window.presencaAbrirSocket();
  }, { cracha, peer });
  return { nome, page, ctx };
}

// A espera é um laço de `page.evaluate` daqui, e NÃO `page.waitForFunction`.
//
// Não é preferência: o `waitForFunction` reprovou no CI com a condição JÁ
// VERDADEIRA, e reprovou na hora — não por prazo. A prova veio do próprio
// diagnóstico impresso ao lado do ✗:
//
//   ✗ ana não viu bia — estado: {"peers":["bia"], ...}
//   ✗ o DataChannel da ana não abriu — estado: {"conversas":["pb:aberta/open"]}
//
// Ou seja: no instante da "falha", `peers` tinha bia e o canal estava aberto —
// e o `page.evaluate` que imprimiu isso rodou normalmente, na mesma página, em
// milissegundos. Trocar o `polling` de 'raf' pra intervalo não mudou nada, e o
// mesmo código passa 20 vezes seguidas aqui. Não consegui reproduzir a causa
// no runner, então o conserto é tirar a incógnita do caminho: `page.evaluate`
// é o primitivo que comprovadamente funciona nos DOIS ambientes.
//
// A hipótese que sobrou, e que o conserto torna irrelevante: `Presenca` é um
// `const` de escopo de script, não uma propriedade de `window`. O
// `page.evaluate` do diagnóstico enxergou; o `waitForFunction` não — o que casa
// com o predicado ter sido avaliado num escopo que não vê binding léxico
// global, e com a rejeição ser INSTANTÂNEA (exceção) em vez de por prazo.
// Descartado como causa: o binário do browser. Rodei a versão anterior com o
// MESMO `chromium_headless_shell` build 1148 que o CI baixa, e ela passou aqui.
const esperar = async (e, fn, oq, ms = 15000) => {
  const ate = Date.now() + ms;
  for (;;) {
    let valor = false;
    try { valor = await e.page.evaluate(fn); } catch (err) { valor = false; }
    if (valor) return true;
    if (Date.now() >= ate) {
      // Espera que estoura sem dizer o que ESTAVA no lugar é a pior falha de
      // CI: dá pra reproduzir por horas sem saber o que olhar.
      const estado = await e.page.evaluate(() => ({
        peers: Presenca.peers.map((p) => p.nome),
        conversas: [...Presenca.conversas].map(([k, c]) => `${k}:${c.estado}/${c.canal && c.canal.readyState}`),
        socket: Presenca.ws && Presenca.ws.readyState,
      })).catch((err) => `(não deu pra ler: ${String(err.message).split('\n')[0]})`);
      anota(`${oq} — estado: ${JSON.stringify(estado)}`);
      return false;
    }
    await dormir(100);
  }
};

try {
  const ana = await editor('ana_am', 'pa', 5, true);
  const bia = await editor('bia', 'pb', 2, true);

  // 1) Cada uma vê a outra — e vê o RANK que o servidor assinou, não o que o
  //    cliente disser. É o ponto inteiro do crachá.
  if (await esperar(ana, () => Presenca.peers.length === 1 && Presenca.peers[0].nome === 'bia', 'ana não viu bia')) ok('a lista chega nos dois lados');
  await esperar(bia, () => Presenca.peers.length === 1 && Presenca.peers[0].nome === 'ana_am', 'bia não viu ana');

  const pilula = await ana.page.evaluate(() => ({
    visivel: !document.getElementById('presencaPill').classList.contains('hidden'),
    selo: document.getElementById('presencaCount').textContent,
  }));
  if (pilula.visivel && pilula.selo === '1') ok('a pílula aparece com a contagem certa');
  else anota(`pílula errada: ${JSON.stringify(pilula)}`);

  const linha = await ana.page.evaluate(() => {
    openModal('presencaModal'); window.presencaRenderLista();
    return document.querySelector('.presenca-linha').textContent.replace(/\s+/g, ' ').trim();
  });
  if (/bia/.test(linha) && /L3/.test(linha)) ok('o rank do crachá chega na lista: ' + linha);
  else anota(`linha da lista errada: ${linha}`);

  // 2) A conversa conecta de verdade: DataChannel aberto dos dois lados.
  // Sem `closeModal` antes: `openModal` já esconde a lista, e fechar-e-abrir no
  // mesmo quadro empilha um `history.back()` junto com um `push` — o saldo fica
  // errado e o Esc seguinte SAI DA APP. Foi assim que este smoke morreu com
  // "Presenca is not defined": a página tinha ido embora.
  await ana.page.evaluate(() => window.presencaAbrirConversa('pb'));
  const a1 = await esperar(ana, () => Presenca.conversas.get('pb')?.estado === 'aberta', 'o DataChannel da ana não abriu');
  const b1 = await esperar(bia, () => Presenca.conversas.get('pa')?.estado === 'aberta', 'o DataChannel da bia não abriu');
  if (a1 && b1) ok('o DataChannel abre nos dois lados');

  // 3) Texto de ida e volta.
  await ana.page.evaluate(() => window.presencaMandarTexto('pb', 'oi, viu o posto da Faria Lima?'));
  if (await esperar(bia, () => (Presenca.conversas.get('pa')?.msgs || []).some((m) => !m.meu && m.txt.includes('Faria Lima')), 'a bia não recebeu')) ok('a mensagem chega');

  // O aviso de mensagem TROCA O ÍCONE, não só a cor (WCAG 1.4.1).
  const aviso = await bia.page.evaluate(() => ({
    naoLidas: Presenca.conversas.get('pa').naoLidas,
    gente: !document.getElementById('presencaIconGente').classList.contains('hidden'),
    msg: !document.getElementById('presencaIconMsg').classList.contains('hidden'),
  }));
  if (aviso.naoLidas === 1 && aviso.msg && !aviso.gente) ok('a pílula troca pro ícone de mensagem');
  else anota(`aviso de mensagem errado: ${JSON.stringify(aviso)}`);

  // ── RECIBO ────────────────────────────────────────────────────────────────
  // O momento é perfeito e é natural do roteiro: a bia RECEBEU mas ainda não
  // ABRIU a conversa. Então a mensagem da ana tem que estar em ENTREGUE — e é
  // erro grave se estiver em 'lida', porque aí o recibo estaria afirmando que
  // alguém leu algo que ninguém abriu.
  if (await esperar(ana, () => Presenca.conversas.get('pb')?.recibos === true,
    'o `oi` do protocolo não chegou — sem ele nenhum recibo aparece')) ok('os dois lados se anunciam (oi)');

  if (await esperar(ana, () => Presenca.conversas.get('pb')?.msgs.find((m) => m.meu)?.estado === 'entregue',
    'a mensagem da ana não chegou a ENTREGUE')) ok('o recibo chega a "entregue" pelo DataChannel');

  const antesDeAbrir = await ana.page.evaluate(() => Presenca.conversas.get('pb')?.msgs.find((m) => m.meu)?.estado);
  if (antesDeAbrir !== 'lida') ok('não diz "lida" antes de a pessoa abrir a conversa');
  else anota('a mensagem apareceu como LIDA com a conversa fechada do outro lado');

  await bia.page.evaluate(() => { window.presencaAbrirConversa('pa'); window.presencaMandarTexto('pa', 'vi sim, foto de cardápio'); });

  // Abrir a conversa é o ato que vira leitura — e o `lido` volta pelo mesmo
  // canal, sem tocar no servidor.
  if (await esperar(ana, () => Presenca.conversas.get('pb')?.msgs.find((m) => m.meu)?.estado === 'lida',
    'a mensagem da ana não virou LIDA depois de a bia abrir a conversa')) ok('abrir a conversa devolve o recibo de leitura');

  // A linha "Lida" é TEXTO na tela, não só um tique de cor (WCAG 1.4.1).
  //
  // Com `esperar` e não com um `evaluate` cru: a asserção de cima é sobre o
  // ESTADO, e o desenho vem depois dele. Ler o DOM na linha seguinte é apostar
  // que o render coube no mesmo instante — aposta que o CI perdeu em 2026-09-03,
  // reprovando aqui com o estado já em 'lida'. Esperar pelo elemento afirma a
  // mesma coisa sem depender de quem chega primeiro.
  if (await esperar(ana, () => !!document.querySelector('#conversaMsgs .conversa-lida'),
    'o estado "lida" não virou texto — sobraria só a cor do tique')) {
    const linhaLida = await ana.page.evaluate(() =>
      document.querySelector('#conversaMsgs .conversa-lida').textContent.trim());
    ok(`a linha "${linhaLida}" aparece na tela`);
  }
  if (await esperar(ana, () => (Presenca.conversas.get('pb')?.msgs || []).some((m) => !m.meu && m.txt.includes('cardápio')), 'a ana não recebeu a resposta')) ok('a resposta volta');

  // ── MANDAR O PEDIDO ABERTO ────────────────────────────────────────────────
  // O caminho inteiro num WebRTC de verdade: prender à barra, mandar junto com
  // a pergunta, e o outro lado receber UM cartão com legenda.
  const anexou = await ana.page.evaluate(() => {
    // `cardParaConversa` lê o AppState; sem fila não há pedido aberto, então o
    // smoke põe um — é dado nosso, não do Waze.
    window.AppState.currentPlace = {
      venueID: '205522459.2055159053.3242788', updateRequestID: 'ur-smoke',
      name: 'Padaria Estrela do Norte', address: 'R. Aurora, 412 — São Paulo',
      categories: ['BAKERY'], updateTypeKey: 'IMAGE',
      // DUAS fotos, e a do pedido é a SEGUNDA — a que o card mostra, casada pelo
      // `updateRequestID` na URL, como no Waze. Com a lista vazia o smoke nunca
      // perguntava QUAL foto ia pela conversa, e ela levava a PRIMEIRA do local
      // (`imageUrl`, que o servidor preenche com ela). Relato do owner, 2026-09-22.
      imageUrls: ['https://venue-image.waze.com/thumbs/thumb700_ja-no-local',
                  'https://venue-image.waze.com/thumbs/thumb700_ur-smoke'],
      imageUrl: 'https://venue-image.waze.com/thumbs/thumb700_ja-no-local',
      lat: -23.55, lon: -46.63,
    };
    window.presencaRenderAnexo();
    const botaoVisivel = !document.getElementById('conversaCardBtn').classList.contains('hidden');
    document.getElementById('conversaCardBtn').click();
    return {
      botaoVisivel,
      tirinha: !document.getElementById('conversaAnexo').classList.contains('hidden'),
      nome: document.getElementById('conversaAnexoNome').textContent,
      // Com pedido preso, o botão SAI: já tem um esperando.
      botaoSaiu: document.getElementById('conversaCardBtn').classList.contains('hidden'),
    };
  });
  if (anexou.botaoVisivel && anexou.tirinha && anexou.botaoSaiu
      && anexou.nome.includes('Padaria')) ok('a tirinha mostra o pedido antes de mandar');
  else anota(`tirinha errada: ${JSON.stringify(anexou)}`);

  // A tela também tem que concordar — classe no DOM não é o mesmo que sumir
  // (gotcha #27: styles.css carrega depois e um `display` cru vence o .hidden).
  const sumiuMesmo = await ana.page.evaluate(() =>
    getComputedStyle(document.getElementById('conversaCardBtn')).display);
  if (sumiuMesmo === 'none') ok('o botão some de verdade, não só no DOM');
  else anota(`o botão do card continua com display:${sumiuMesmo} apesar do .hidden`);

  await ana.page.evaluate(() => {
    document.getElementById('conversaInput').value = 'isso é fachada ou é a sala?';
    document.getElementById('conversaForm').requestSubmit();
  });

  if (await esperar(bia, () => (Presenca.conversas.get('pa')?.msgs || []).some((m) => m.card && m.card.venueID),
    'a bia não recebeu o pedido')) ok('o pedido chega inteiro pelo DataChannel');

  const recebido = await bia.page.evaluate(() => {
    const m = (Presenca.conversas.get('pa')?.msgs || []).find((x) => x.card);
    return m ? { nome: m.card.name, tipo: m.card.updateTypeKey, cat: m.card.categories,
                 txt: m.txt, foto: m.card.imageUrl, regiao: m.card.region } : null;
  });
  if (recebido && recebido.nome === 'Padaria Estrela do Norte' && recebido.tipo === 'IMAGE'
      && recebido.txt.includes('fachada')) ok('card e pergunta chegam como UMA mensagem');
  else anota(`o que chegou está errado: ${JSON.stringify(recebido)}`);
  if (recebido && recebido.foto === 'https://venue-image.waze.com/thumbs/thumb700_ur-smoke') {
    ok('a foto que chega é a DO PEDIDO (a 2ª do local), não a primeira');
  } else anota(`a foto que chegou não é a do pedido: ${JSON.stringify(recebido && recebido.foto)}`);

  // Mandou: a tirinha tem que sumir, senão o pedido apareceria em dois lugares.
  const depoisDeMandar = await ana.page.evaluate(() => ({
    tirinha: !document.getElementById('conversaAnexo').classList.contains('hidden'),
    anexo: !!Presenca.anexo,
    cartoes: document.querySelectorAll('#conversaMsgs .conversa-pedido').length,
  }));
  if (!depoisDeMandar.tirinha && !depoisDeMandar.anexo && depoisDeMandar.cartoes === 1) {
    ok('a tirinha some ao mandar e o cartão fica na conversa');
  } else anota(`estado errado depois de mandar: ${JSON.stringify(depoisDeMandar)}`);

  // O cartão é um <button> com rótulo: sem isso teclado e leitor de tela não
  // chegam nele, e ele é a única coisa abrível da conversa.
  const cartao = await bia.page.evaluate(() => {
    const el = document.querySelector('#conversaMsgs .conversa-pedido');
    return el ? { tag: el.tagName, rotulo: !!el.getAttribute('aria-label') } : null;
  });
  if (cartao && cartao.tag === 'BUTTON' && cartao.rotulo) ok('o cartão é alcançável por teclado');
  else anota(`cartão não é botão rotulado: ${JSON.stringify(cartao)}`);

  // Abrir o pedido recebido: SÓ LEITURA, e sem ✕ ↑ ✓ em lugar nenhum.
  await bia.page.evaluate(() => document.querySelector('#conversaMsgs .conversa-pedido').click());
  const folha = await bia.page.evaluate(() => {
    const mo = document.getElementById('pedidoModal');
    return {
      aberto: !mo.classList.contains('hidden'),
      nome: document.getElementById('pedidoNome').textContent,
      de: document.getElementById('pedidoDe').textContent,
      wme: document.getElementById('pedidoWme').getAttribute('href') || '',
      // Nenhum botão de decisão pode existir aqui dentro.
      acoes: mo.querySelectorAll('.card-btn-reject, .card-btn-skip, .card-btn-read').length,
    };
  });
  if (folha.aberto && folha.nome.includes('Padaria') && folha.acoes === 0
      && folha.wme.includes('venueUpdateRequest=') && !folha.wme.includes('/pt-BR/')) {
    ok('a folha do pedido abre em só leitura, com o ↗ pro WME');
  } else anota(`folha do pedido errada: ${JSON.stringify(folha)}`);
  await bia.page.keyboard.press('Escape');

  // 4) Fechar a conversa por Esc solta o estado. Não é detalhe: o `aberta`
  //    mora no `const Presenca` do js/presenca.js, e o `Presenca` visível no
  //    app.js é o objeto EXPORTADO — escrever de lá criava um campo num objeto
  //    que ninguém lê, e a conversa ficava "aberta" pra sempre. Mensagem nova
  //    nunca mais viraria aviso, sem erro nenhum na tela.
  // Os DOIS caminhos de fechar, e o ✕ vem primeiro porque foi ele que quebrou
  // em produção: só ele resolvia `Presenca` sem o `window.`, e o smoke antigo
  // fechava a conversa apenas com Esc. Teste que exercita um caminho de dois
  // dá verde sobre metade do recurso.
  await ana.page.click('#conversaClose');
  await ana.page.waitForTimeout(150);
  const porX = await ana.page.evaluate(() => ({
    modal: document.getElementById('conversaModal').classList.contains('hidden'),
    aberta: Presenca.aberta,
  }));
  if (porX.modal && porX.aberta === null) ok('o ✕ fecha a conversa E solta o estado');
  else anota(`o ✕ não fechou direito: ${JSON.stringify(porX)}`);
  await ana.page.evaluate(() => window.presencaAbrirConversa('pb'));
  await esperar(ana, () => Presenca.aberta === 'pb', 'a conversa não reabriu depois do ✕');

  await ana.page.keyboard.press('Escape');
  await ana.page.waitForTimeout(120);
  const fechou = await ana.page.evaluate(() => ({
    modal: document.getElementById('conversaModal').classList.contains('hidden'),
    aberta: Presenca.aberta,
  }));
  if (fechou.modal && fechou.aberta === null) ok('Esc fecha a conversa E solta o estado');
  else anota(`fechar por Esc não soltou o estado: ${JSON.stringify(fechou)}`);
  await ana.page.evaluate(() => window.presencaAbrirConversa('pb'));
  await esperar(ana, () => Presenca.aberta === 'pb', 'a conversa não reabriu');

  // 5) Fechou a aba, saiu da sala — sem prazo, sem varredura.
  await bia.ctx.close();
  await esperar(ana, () => Presenca.peers.length === 0, 'a ana continuou vendo a bia depois de ela sair');
  const depois = await ana.page.evaluate(() => ({
    escondida: document.getElementById('presencaPill').classList.contains('hidden'),
    estado: Presenca.conversas.get('pb')?.estado,
  }));
  if (depois.escondida) ok('a pílula some quando a sala esvazia');
  else anota('a pílula ficou na tela sem ninguém na sala');
  // `saiu` e não `fechada`: o `onclose` do canal escrevia por cima do motivo
  // que já tinha sido decidido, e os dois casos deixavam de ser distinguíveis.
  // Qual aviso chega primeiro aqui é SORTE (o do canal ou o da sala); o
  // passo 11 força a ordem ruim, que já reprovou este passo uma vez no WebKit.
  if (depois.estado === 'saiu') ok('a conversa diz que a pessoa saiu');
  else anota(`a conversa não avisou a saída (estado: ${depois.estado})`);

  // 6) A pílula não pode contar o que a pessoa não consegue abrir. Chegou na
  //    tela do owner: pílula dizendo 4 com 2 na lista. A causa é estrutural —
  //    o `peer` é sorteado a cada carga, então quem recarrega deixa a conversa
  //    anterior órfã, com as não lidas presas dentro dela.
  await ana.page.evaluate(() => {
    Presenca.peers = [{ peer: 'p-vivo', nome: 'carla_am', rank: 5, am: true, staff: false }];
    Presenca.total = 1;
    const conv = (nome, n) => ({ pc: null, canal: null, msgs: [], naoLidas: n, nome, estado: 'parado', pendentes: [], iceEspera: [], fila: null });
    Presenca.conversas.set('p-vivo', conv('carla_am', 2));
    Presenca.conversas.set('p-fantasma', conv('carla_am', 3));   // peer que já saiu
    window.presencaRenderPilula();
  });
  const contagem = await ana.page.evaluate(() => {
    openModal('presencaModal'); window.presencaRenderLista();
    return {
      pilula: document.getElementById('presencaCount').textContent,
      naLista: [...document.querySelectorAll('.presenca-badge')].reduce((a, e) => a + Number(e.textContent), 0),
    };
  });
  if (Number(contagem.pilula) === contagem.naLista && contagem.naLista === 2) ok(`a pílula conta só o que dá pra abrir (${contagem.pilula}, não 5)`);
  else anota(`pílula ${contagem.pilula} × ${contagem.naLista} na lista — conversa órfã inflando o selo`);

  // 7) NÃO existe bloqueio de pessoa, em lugar nenhum da tela.
  //
  //    O recurso foi removido por decisão de produto: a app só admite editor
  //    L3+ Area Manager, e abuso se resolve no Waze, não aqui. Enquanto ele
  //    existiu custou três defeitos — beco sem saída, contagem inflada e uma
  //    folha que se contradizia. Isto aqui é pra ele não voltar de fininho.
  const semBloqueio = await ana.page.evaluate(() => {
    const seletores = ['[data-bloquear]', '[data-desbloquear]', '#conversaBloquear', '#presencaBloqueados', '.presenca-bloquear', '.presenca-desbloquear'];
    return {
      naTela: seletores.filter((s) => document.querySelector(s)),
      noObjeto: ['bloqueados', 'bloquear', 'desbloquear'].filter((k) => k in Presenca),
    };
  });
  if (!semBloqueio.naTela.length && !semBloqueio.noObjeto.length) ok('não há bloqueio de pessoa em lugar nenhum');
  else anota(`sobrou bloqueio: tela=${JSON.stringify(semBloqueio.naTela)} objeto=${JSON.stringify(semBloqueio.noObjeto)}`);

  // 8) A limpeza da chave antiga SAIU em 2026-09-10, e este bloco saiu junto.
  //
  //    Ela era migração: apagava `waze_places_bloqueados` do aparelho de quem
  //    usou a versão com bloqueio. Removida a pedido do owner, com o argumento
  //    de que a app não está em produção — todos são testadores e podem zerar o
  //    app. Consequência assumida: num aparelho que teve o recurso a chave
  //    permanece até alguém limpar à mão, e ela guardava ids de PEER.
  //
  //    O que continua cobrado é o bloco 7 acima — que o RECURSO não volte. O
  //    que sumiu é só a faxina do resíduo dele.
  await ana.page.evaluate(() => closeModal('presencaModal'));


  // ── 9) RECARREGAR A PÁGINA NÃO DUPLICA NINGUÉM ────────────────────────────
  //
  // Relatado pelo owner com print: a cada recarga ele aparecia mais uma vez na
  // lista — e aparecia na PRÓPRIA lista, com a pílula contando 3 onde havia 1
  // colega. Os colegas o viam repetido também.
  //
  // A causa: o `peer` é sorteado a CADA CARGA DA PÁGINA — endereça uma CONEXÃO,
  // não um editor. Enquanto o socket antigo não fecha, a mesma pessoa está na
  // sala com dois peers, e comparar por peer não os junta.
  //
  // ESTE BLOCO É AUTOSSUFICIENTE, e não é preciosismo: a primeira versão
  // reaproveitava os editores dos passos anteriores e passou VERDE COM A
  // SABOTAGEM — porque a conexão velha já tinha sido fechada lá atrás, e sem
  // conexão velha não há o que duplicar. Passou por AUSÊNCIA.
  //
  // A conexão anterior fica VIVA de propósito: é o pior caso, e é o que
  // acontece quando o navegador não manda o quadro de fechamento. Depender de
  // o socket velho morrer sozinho seria depender de sorte de timing.
  {
    const ligar = async (nome, peer) => {
      const c = await browser.newContext({ viewport: { width: 393, height: 851 }, serviceWorkers: 'block' });
      await iceSemMdnsForaDoChromium(c);
      const pg = await c.newPage();
      await pg.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'domcontentloaded' });
      for (let i = 0; i < 150; i++) {
        if (await pg.evaluate(() => !!(window.Presenca && window.AppState)).catch(() => false)) break;
        await dormir(100);
      }
      const cr = await crachas.assinar({ peer, nome, rank: 5, am: true, sala: 'row:30' });
      await pg.evaluate(({ cracha, peer: pr }) => {
        AppState.authenticated = true;
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        Presenca.peer = pr; Presenca.cracha = cracha; Presenca.ice = { iceServers: [] };
        window.presencaAbrirSocket();
      }, { cracha: cr, peer });
      return { nome, page: pg, ctx: c };
    };

    const obs = await ligar('carla', 'carla-1');
    const antiga = await ligar('duda', 'duda-aba-velha');
    await esperar(obs, () => (Presenca.peers || []).some((p) => p.nome === 'duda'),
      'controle do reload: carla não viu a duda na 1ª carga');

    // CONTROLE: antes da 2ª carga tem que haver EXATAMENTE uma duda. Sem isto,
    // "não duplicou" seria verdade por não haver ninguém.
    const antes = await obs.page.evaluate(() => (Presenca.peers || []).filter((p) => p.nome === 'duda').length);
    if (antes === 1) ok('controle: uma conexão da duda antes de recarregar');
    else anota(`controle do reload falhou: ${antes} dudas antes de recarregar`);

    // A duda "recarrega": peer NOVO, mesmo nome — e a aba velha NÃO fecha.
    const nova = await ligar('duda', 'duda-recarregada');
    await esperar(obs, () => (Presenca.peers || []).some((p) => p.peer === 'duda-recarregada'),
      'carla não viu a duda recarregada');
    await dormir(600);   // deixa a lista assentar

    const visto = await obs.page.evaluate(() => ({
      dudas: (Presenca.peers || []).filter((p) => p.nome === 'duda').length,
      peers: (Presenca.peers || []).map((p) => p.peer),
    }));
    if (visto.dudas === 1) ok('recarregar não duplica: a carla vê UMA duda');
    else anota(`recarregar duplicou: carla vê ${visto.dudas} dudas — ${JSON.stringify(visto.peers)}`);
    if (visto.peers.includes('duda-recarregada') && !visto.peers.includes('duda-aba-velha')) {
      ok('a lista aponta pra conexão NOVA (a conversa não cai num socket morto)');
    } else {
      anota(`a lista não convergiu pra conexão nova: ${JSON.stringify(visto.peers)}`);
    }

    const seVe = await nova.page.evaluate(() => (Presenca.peers || []).filter((p) => p.nome === 'duda').length);
    if (seVe === 0) ok('ninguém aparece na própria lista');
    else anota(`a duda aparece ${seVe}× na própria lista`);

    await antiga.ctx.close();
    await nova.ctx.close();
    await obs.ctx.close();
  }


  // ── 10) SOCKET QUE MORRE EM SILÊNCIO, E LISTA QUE SE PERDE ────────────────
  //
  // Relato do owner: "muitas vezes o App só mostra que tem alguém online quando
  // atualizo a página".
  //
  // Dois defeitos distintos, e nenhum aparece num teste que só liga e desliga
  // socket — porque em ambos NADA é fechado:
  //
  //   (a) a conexão morre EM SILÊNCIO (sem quadro de fechamento — o caso comum
  //       em rede móvel, NAT e proxy). O `readyState` fica OPEN pra sempre, o
  //       `onclose` nunca dispara, e o keepalive falava sozinho: mandava `ping`
  //       e nunca cobrava o `pong`. MEDIDO antes do conserto: 70s depois,
  //       readyState=1, zero tentativas, lista vazia.
  //
  //   (b) a sala só DIFUNDE em entrada e saída. Um piscar de rede no instante
  //       errado engole a difusão e NINGUÉM reenvia — a lista fica errada até a
  //       página ser recarregada, com o socket perfeitamente vivo.
  //
  // Pra medir isso é preciso um BURACO NEGRO: um proxy que repassa tudo e, na
  // hora marcada, PARA de repassar nos dois sentidos sem fechar nada. Fechar
  // simularia outro defeito — esse o cliente já tratava.
  {
    let engolir = false;
    const PORTA_PROXY = PORTA + 700;
    const proxy = createServer((doNavegador) => {
      const proApp = connect(PORTA, '127.0.0.1');
      doNavegador.on('data', (b) => { if (!engolir) proApp.write(b); });
      proApp.on('data', (b) => { if (!engolir) doNavegador.write(b); });
      const morrer = () => { try { doNavegador.destroy(); } catch {} try { proApp.destroy(); } catch {} };
      doNavegador.on('error', morrer); proApp.on('error', morrer);
      doNavegador.on('close', () => { if (!engolir) morrer(); });
      proApp.on('close', () => { if (!engolir) morrer(); });
    });
    await new Promise((k) => proxy.listen(PORTA_PROXY, '127.0.0.1', k));

    // Um editor que fala com a app ATRAVÉS do buraco negro.
    const viaProxy = await browser.newContext({ viewport: { width: 393, height: 851 }, serviceWorkers: 'block' });
    await iceSemMdnsForaDoChromium(viaProxy);
    const pgx = await viaProxy.newPage();
    // `/api/presenca` exige cookies REAIS do Waze; aqui o crachá é assinado
    // localmente, porque o que se mede é o RELIGAMENTO, não a autenticação.
    await pgx.route('**/api/presenca', async (route) => {
      const corpo = JSON.parse(route.request().postData() || '{}');
      const c = await crachas.assinar({ peer: corpo.peer, nome: 'eva', rank: 5, am: true, sala: 'row:30' });
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, cracha: c, ice: { iceServers: [] } }) });
    });
    await pgx.goto(`http://127.0.0.1:${PORTA_PROXY}/`, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 150; i++) {
      if (await pgx.evaluate(() => !!(window.Presenca && window.AppState)).catch(() => false)) break;
      await dormir(100);
    }
    const crEva = await crachas.assinar({ peer: 'eva1', nome: 'eva', rank: 5, am: true, sala: 'row:30' });
    await pgx.evaluate(({ c, p }) => {
      // Sem sessão e país, `presencaPodeConectar()` é falso e o religamento nem
      // TENTA — o teste mediria a ausência da precondição, não o comportamento.
      API.setSession('tk'); API.setCountry(30);
      AppState.preferences = AppState.preferences || {};
      AppState.preferences.presenca = true;
      AppState.authenticated = true;
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      Presenca.peer = p; Presenca.cracha = c; Presenca.ice = { iceServers: [] };
      window.presencaAbrirSocket();
    }, { c: crEva, p: 'eva1' });
    await dormir(700);

    const eva = { nome: 'eva', page: pgx, ctx: viaProxy };
    const veEva = () => pgx.evaluate(() => ({
      rs: Presenca.ws ? Presenca.ws.readyState : -1,
      peers: (Presenca.peers || []).map((x) => x.nome),
    }));

    // CONTROLE: sem buraco negro a eva está conectada. Sem isto, tudo abaixo
    // seria verdade numa app que simplesmente nunca conectou.
    const antes = await veEva();
    if (antes.rs === 1) ok('controle do buraco negro: a eva conectou pelo proxy');
    else anota(`controle do buraco negro falhou: readyState=${antes.rs}`);

    // (b) O PISCAR DE REDE: engole por 6s, e alguém entra nesse intervalo.
    engolir = true;
    const fran = await editor('fran', 'fran1', 5, true, 'pt');
    await dormir(6000);
    engolir = false;                       // a rede voltou; o socket sobreviveu
    await dormir(1200);
    const perdeu = await veEva();
    if (perdeu.rs === 1 && !perdeu.peers.includes('fran')) {
      ok('a difusão perdida no piscar de rede deixa a lista velha (é o defeito)');
    } else if (perdeu.peers.includes('fran')) {
      ok('a lista chegou mesmo com o piscar — melhor ainda');
    }
    // Voltar pra tela tem que RESSINCRONIZAR, sem depender de recarregar.
    await pgx.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await dormir(1500);
    const depois = await veEva();
    if (depois.peers.includes('fran')) ok('voltar pra tela ressincroniza a lista');
    else anota(`voltar pra tela NÃO ressincronizou: ${JSON.stringify(depois)}`);

    // ── A TELA APAGADA POR MUITO TEMPO ──────────────────────────────────
    //
    // Pergunta do owner: "se eu deixar a tela apagada por muito tempo e voltar,
    // a lista funciona?". Ela expôs um buraco que a versão anterior tinha.
    //
    // Quando a tela apaga, os timers do navegador CONGELAM. Um socket que
    // estava a meio caminho — CONNECTING ou CLOSING — fica assim, e ao voltar
    // não há como saber HÁ QUANTO TEMPO. A versão anterior de `presencaAoVoltar`
    // só tratava dois estados (ABERTO e SEM SOCKET): com o socket a meio, os
    // dois ramos falhavam e a pessoa ficava esperando o prazo de 12s pra nada.
    {
      const esconder = (v) => pgx.evaluate((valor) => {
        Object.defineProperty(document, 'visibilityState', { value: valor, configurable: true });
        Object.defineProperty(document, 'hidden', { value: valor === 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, v);

      // Tela apaga, a conexão morre em silêncio, e a turma muda nesse meio-tempo.
      await esconder('hidden');
      engolir = true;
      const gil = await editor('gil', 'gil1', 5, true, 'pt');
      await dormir(3000);

      // O caso do buraco: um socket a MEIO CAMINHO quando a tela volta.
      await pgx.evaluate(() => {
        // Um socket que nunca vai completar — é o que sobra de uma tentativa
        // iniciada pouco antes de a tela apagar.
        Presenca.ws = new WebSocket('ws://127.0.0.1:9/sala?s=row%3A30');
      });
      await dormir(300);
      // O buraco NÃO era um readyState específico: era `Presenca.ws` PREENCHIDO
      // e diferente de OPEN. Os dois ramos da versão anterior exigiam
      // `readyState === OPEN` ou `!Presenca.ws` — qualquer outro estado
      // (CONNECTING, CLOSING, CLOSED) escapava dos dois.
      //
      // Aceito 0, 2 ou 3 de propósito: qual deles aparece depende de o destino
      // recusar ou engolir, e isso é do AMBIENTE, não do defeito. Cravar um
      // número faria o controle falhar por motivo errado — foi o que aconteceu
      // na primeira tentativa (esperava 0, veio 3, porque a porta recusa).
      const meio = await pgx.evaluate(() => (Presenca.ws ? Presenca.ws.readyState : -1));
      if (meio !== -1 && meio !== 1) ok(`controle: socket preenchido e não-OPEN antes de voltar (readyState=${meio})`);
      else anota(`controle falhou: esperava socket não-OPEN, veio ${meio === -1 ? 'nenhum socket' : 'OPEN'}`);

      engolir = false;
      await esconder('visible');
      await dormir(4000);

      const volta = await veEva();
      if (volta.peers.includes('gil')) ok('tela apagada por muito tempo: ao voltar a lista se corrige sozinha');
      else anota(`tela apagada: NÃO recuperou — ${JSON.stringify(volta)}`);
      await gil.ctx.close();
    }

    await fran.ctx.close();
    await eva.ctx.close();
    proxy.close();
  }

  // ── 11) O CANAL FECHA ANTES DE A SALA AVISAR ──────────────────────────────
  //
  // Quando alguém sai, os dois avisos partem juntos (o `pagehide` manda o
  // `sair` e fecha o canal), mas o do canal vai DIRETO ao outro aparelho e o
  // da sala dá dois saltos pelo servidor. MEDIDO saindo como o usuário sai
  // (`close({ runBeforeUnload: true })`): 1 em 8 rodadas o canal chegava
  // primeiro, nos dois motores. A conversa ficava em 'fechada', a sala era
  // ignorada, e 15 s depois a falha do pc que seguia vivo trocava o cabeçalho
  // pra "Não deu pra conectar com esta pessoa". O passo 5 só pegava a ordem
  // ruim por sorte — foi assim que ele reprovou UMA vez no WebKit.
  //
  // Aqui a ordem é FORÇADA no TRANSPORTE, sem depender de nome de função da
  // app: as mensagens da sala ficam RETIDAS na hana até o canal fechar — o
  // servidor mais longe que o outro aparelho, o caso comum fora do localhost.
  // Retidas e não atrasadas por um prazo: 500 ms bastavam no WebKit e nem
  // sempre no Chromium, e prazo mede a velocidade da máquina (gotcha #62).
  //
  // A ines sai pelo MESMO caminho da app — o ouvinte de `pagehide` —, mas com
  // a página VIVA até o fechamento do canal chegar. MEDIDO: com a página
  // morrendo junto (`close({ runBeforeUnload: true })`), o Chromium às vezes
  // nem manda o fechamento (3 de 16 tentativas) e não há a ordem que este
  // bloco mede; com ela viva, 20 de 20 nos dois motores. A saída com a página
  // morrendo segue medida no passo 5. Se mesmo assim o canal não fechar, o
  // bloco tenta com outro par — até 3 vezes, e IMPRIME quantas precisou.
  {
    const segurarSala = (ctx) => ctx.addInitScript(() => {
      const d = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
      window.__salaRetida = [];
      window.__salaSoltar = () => { window.__salaSegurar = false; for (const f of window.__salaRetida.splice(0)) f(); };
      Object.defineProperty(WebSocket.prototype, 'onmessage', {
        configurable: true,
        get() { return d.get.call(this); },
        set(fn) {
          d.set.call(this, fn && function (ev) {
            const entregar = () => {
              // CONTROLE: em que estado a conversa estava quando a LISTA chegou.
              let t = null;
              try { t = JSON.parse(ev.data).t; } catch (e) {}
              if (t === 'lista' && window.__salaAlvo) {
                try { (window.__antesDaLista ||= []).push(Presenca.conversas.get(window.__salaAlvo)?.estado); } catch (e) {}
              }
              fn.call(this, ev);
            };
            if (window.__salaSegurar) window.__salaRetida.push(entregar);
            else entregar();
          });
        },
      });
    });
    // Espera sem anotar: aqui "não aconteceu" é uma resposta, não uma falha.
    const quando = async (e, fn, arg, ms) => {
      for (const fim = Date.now() + ms; Date.now() < fim; await dormir(50)) {
        if (await e.page.evaluate(fn, arg).catch(() => false)) return true;
      }
      return false;
    };

    const tentar = async (n) => {
      const ph = 'ph' + n, pi = 'pi' + n;
      const hana = await editor('hana', ph, 4, true, 'pt', segurarSala);
      const ines = await editor('ines', pi, 3, true);
      try {
        if (!await esperar(hana, new Function(`return Presenca.peers.some((p) => p.peer === '${pi}')`), 'hana não viu ines')) return { erro: true };
        await hana.page.evaluate((p) => window.presencaAbrirConversa(p), pi);
        if (!await esperar(hana, new Function(`return Presenca.conversas.get('${pi}')?.estado === 'aberta'`), 'o canal hana→ines não abriu')
          || !await esperar(ines, new Function(`return Presenca.conversas.get('${ph}')?.estado === 'aberta'`), 'o canal ines→hana não abriu')) return { erro: true };
        // O "não chegou" só aparece depois do `oi` do outro lado (é o portão
        // do PRESENCA_CONVERSA_V): sem ele, o que se mediria é a ausência.
        if (!await esperar(hana, new Function(`return Presenca.conversas.get('${pi}')?.recibos === true`),
          'controle: a ines não se anunciou (oi) — sem isso o "não chegou" nem aparece')) return { erro: true };

        // A resposta da ines não volta a tempo: a mensagem da hana fica EM VOO
        // quando ela sai, que é a que o "não chegou" tem que explicar.
        await ines.page.evaluate((p) => { Presenca.conversas.get(p).canal.onmessage = () => {}; }, ph);
        await hana.page.evaluate((p) => window.presencaMandarTexto(p, 'ainda está aí?'), pi);
        if (!await esperar(hana, new Function(`return Presenca.conversas.get('${pi}').msgs.some((m) => m.meu && m.estado === 'enviada')`),
          'controle: a mensagem da hana não ficou em voo')) return { erro: true };

        await hana.page.evaluate((p) => { window.__salaAlvo = p; window.__salaSegurar = true; }, pi);
        await ines.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
        const fechou = await quando(hana, (p) => Presenca.conversas.get(p)?.estado === 'fechada', pi, 3000);
        await hana.page.evaluate(() => window.__salaSoltar());
        await ines.ctx.close();
        if (!fechou) return { semOrdem: true };

        const saiu = await quando(hana, (p) => Presenca.conversas.get(p)?.estado === 'saiu', pi, 5000);
        const r = await hana.page.evaluate((p) => {
          const c = Presenca.conversas.get(p);
          return {
            antesDaLista: window.__antesDaLista || [],
            estado: c && c.estado,
            msgs: document.getElementById('conversaMsgs').textContent,
            fraseSaiu: t('presenca.recibo.naoChegouSaiu', { nome: 'ines' }),
            fraseConexao: t('presenca.recibo.naoChegouConexao'),
            conexaoVelha: !!(c && (c.pc || c.canal)),
            recibos: c && c.recibos,
            minhas: c ? c.msgs.filter((m) => m.meu).map((m) => `${m.estado}/${m.motivo}`) : [],
          };
        }, pi);
        return { saiu, r };
      } finally {
        await ines.ctx.close().catch(() => {});
        await hana.ctx.close();
      }
    };

    let res = null, tentativas = 0;
    while (tentativas < 3) {
      tentativas++;
      res = await tentar(tentativas);
      if (!res.semOrdem) break;
    }
    if (res.semOrdem) anota(`o canal não fechou antes da sala em ${tentativas} tentativas — o bloco não mediu a ordem que existe pra medir`);
    else if (!res.erro) {
      const { saiu, r } = res;
      if (r.antesDaLista.includes('fechada')) ok(`controle: o canal fechou ANTES de a lista da sala chegar${tentativas > 1 ? ` (na tentativa ${tentativas})` : ''}`);
      else anota(`controle: a ordem não foi forçada — estado quando a lista chegou: ${JSON.stringify(r.antesDaLista)}`);
      if (saiu) ok('a sala confirma a saída depois do canal fechado');
      else anota(`o canal fechou antes da sala e a conversa NÃO passou a "saiu" (estado: ${r.estado})`);
      // O CABEÇALHO não se confere aqui, de propósito: 'fechada' já mostra o
      // mesmo "saiu da fila", então a asserção passava com e sem o conserto
      // (sabotado). O que ele erra é 15 s depois, e é o que a checagem da
      // conexão velha, logo abaixo, cobre sem pagar os 15 s.
      if (r.msgs.includes(r.fraseSaiu) && !r.msgs.includes(r.fraseConexao)) ok('a mensagem em voo diz que não chegou porque ela SAIU');
      else anota(`o "não chegou" deu outro motivo: ${JSON.stringify(r.msgs.slice(-120))} — recibos=${r.recibos} minhas=${JSON.stringify(r.minhas)}`);
      // Sem conexão velha, nada reescreve o cabeçalho 15 s depois (MEDIDO: é o
      // `connectionstatechange` do pc que ficava vivo). O efeito tardio em si
      // está no test/presenca-saida.test.mjs, com o pc que falha depois.
      if (!r.conexaoVelha) ok('a conexão velha é encerrada: nada a reescreve depois');
      else anota('a conexão velha segue viva — em ~15 s a falha dela reescreve a conversa');
    }
  }

} finally {
  await browser.close();
  srv.kill('SIGKILL');
}

if (resumoDosPulos(MOTOR)) console.log(resumoDosPulos(MOTOR));
console.log(falhas.length ? `\n✗ ${falhas.length} falha(s)` : '\n✓ presença ok');
process.exit(falhas.length ? 1 : 0);
