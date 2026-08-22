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
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeCrachas, base64ToBytes } from '../server/core.mjs';

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
  try { await fetch(`http://127.0.0.1:${PORTA}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
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
  await page.waitForFunction(() => window.Presenca && window.AppState, null, { timeout: 15000 });
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

// `polling: 'interval'` e não o padrão `'raf'`: só UMA aba fica em primeiro
// plano, e o Chromium ESTRANGULA o requestAnimationFrame das outras. Com duas
// páginas abertas — que é o cenário inteiro deste teste — a espera da página de
// trás pode estourar o prazo sem a condição nunca ter sido consultada. Passou
// aqui e reprovou no CI com o mesmo código.
const esperar = (e, fn, oq) => e.page.waitForFunction(fn, null, { timeout: 15000, polling: 200 })
  .then(() => true)
  .catch(async () => {
    // Espera que estoura sem dizer o que ESTAVA no lugar é a pior falha de CI:
    // dá pra reproduzir por horas sem saber o que olhar. O estado vai junto.
    const estado = await e.page.evaluate(() => ({
      peers: Presenca.peers.map((p) => p.nome),
      conversas: [...Presenca.conversas].map(([k, c]) => `${k}:${c.estado}/${c.canal && c.canal.readyState}`),
      socket: Presenca.ws && Presenca.ws.readyState,
    })).catch((err) => `(não deu pra ler: ${String(err.message).split('\n')[0]})`);
    anota(`${oq} — estado: ${JSON.stringify(estado)}`);
    return false;
  });

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
} finally {
  await browser.close();
  srv.kill('SIGKILL');
}

console.log(falhas.length ? `\n✗ ${falhas.length} falha(s)` : '\n✓ presença ok');
process.exit(falhas.length ? 1 : 0);
