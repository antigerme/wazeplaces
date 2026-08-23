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
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeCrachas, base64ToBytes } from '../server/core.mjs';
import { setTimeout as dormir } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.SMOKE_PORT || 8134);
const CHAVE = Buffer.alloc(32, 5).toString('base64');

async function carregarPlaywright() {
  const req = createRequire(import.meta.url);
  const tentativas = [
    () => req.resolve('playwright', { paths: [ROOT] }),
    () => '/opt/node22/lib/node_modules/playwright/index.mjs',
    () => 'playwright',
  ];
  const erros = [];
  for (const t of tentativas) {
    let mod;
    try { mod = await import(t()); } catch (e) { erros.push(String(e.message || e).split('\n')[0]); continue; }
    const pw = mod && mod.chromium ? mod : (mod && mod.default) || {};
    if (pw.chromium) return pw;
    erros.push(`${t()}: importou, mas sem export 'chromium'`);
  }
  console.error('✗ Playwright não encontrado. Tentativas:\n  - ' + erros.join('\n  - '));
  process.exit(1);
}

// `WebRtcHideLocalIpsWithMdns` faz o Chromium anunciar o candidato host como um
// nome `.local` de mDNS em vez do IP. É proteção de privacidade e está certa no
// browser de verdade — mas dentro de contêiner a resolução de mDNS pode
// simplesmente não responder, e aí a conexão falha SEM erro, de vez em quando.
// Foi o que apareceu aqui: uma execução com "o DataChannel não abriu" e 21
// seguintes verdes. Desligar é ajuste do INSTRUMENTO (o teste roda em
// localhost), não do produto — a app continua com o padrão do browser.
const ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

async function abrirBrowser(chromium) {
  const erros = [];
  for (const opcoes of [{ args: ARGS }, { channel: 'chrome', args: ARGS }, { channel: 'chromium', args: ARGS }]) {
    try { return await chromium.launch(opcoes); } catch (e) { erros.push(`${JSON.stringify(opcoes)}: ${String(e.message || e).split('\n')[0]}`); }
  }
  throw new Error('nenhum browser abriu:\n  - ' + erros.join('\n  - '));
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

const { chromium } = await carregarPlaywright();
const browser = await abrirBrowser(chromium);
const crachas = makeCrachas({ keyBytes: base64ToBytes(CHAVE) });

async function editor(nome, peer, rank, am, lang) {
  // `serviceWorkers: 'block'`: o SW da app se auto-atualiza e RECARREGA a página
  // no `controllerchange`. No meio do teste isso apaga o estado injetado e o
  // sintoma chega como "Presenca is not defined" — parece bug do produto e é do
  // instrumento. O smoke de layout já bloqueia pelo mesmo motivo.
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
  });
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

  await bia.page.evaluate(() => { window.presencaAbrirConversa('pa'); window.presencaMandarTexto('pa', 'vi sim, foto de cardápio'); });
  if (await esperar(ana, () => (Presenca.conversas.get('pb')?.msgs || []).some((m) => !m.meu && m.txt.includes('cardápio')), 'a ana não recebeu a resposta')) ok('a resposta volta');

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
      noArmazenamento: localStorage.getItem('waze_places_bloqueados'),
    };
  });
  if (!semBloqueio.naTela.length && !semBloqueio.noObjeto.length) ok('não há bloqueio de pessoa em lugar nenhum');
  else anota(`sobrou bloqueio: tela=${JSON.stringify(semBloqueio.naTela)} objeto=${JSON.stringify(semBloqueio.noObjeto)}`);

  // 8) E a chave que ficou no aparelho de quem usou a versão anterior é
  //    apagada na carga — dado órfão de recurso removido não envelhece calado.
  const limpou = await ana.page.evaluate(async () => {
    localStorage.setItem('waze_places_bloqueados', '["alguem"]');
    window.presencaMontar();
    return localStorage.getItem('waze_places_bloqueados');
  });
  if (limpou === null) ok('a chave antiga de bloqueio é apagada do aparelho');
  else anota(`a chave antiga sobreviveu: ${limpou}`);
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

    await fran.ctx.close();
    await eva.ctx.close();
    proxy.close();
  }

} finally {
  await browser.close();
  srv.kill('SIGKILL');
}

console.log(falhas.length ? `\n✗ ${falhas.length} falha(s)` : '\n✓ presença ok');
process.exit(falhas.length ? 1 : 0);
