// Smoke da página do CONVIDADO da demo (/demo), no navegador de verdade, contra
// a VM de verdade (server/node.mjs) com salas SEMEADAS em arquivo (criar uma
// demo de ponta a ponta precisa do Waze; isso é do test/demo-rotas.test.mjs).
//
//   npm run test:demo
//
// O dado é o que QUEBRA (CLAUDE.md, «Mudança visual se mostra ANTES de existir»):
// os 51 pedidos REAIS das fixtures dos seis países (tools/fixtures-paises.json,
// passados pelo MESMO `montarRetrato` do servidor), no iPhone-ish (393) e no Fold
// (280), nas quatro línguas. O que se mede é o que a tela DEU (retângulo, hit-test
// com `elementFromPoint`, `scrollWidth`), nunca o que o CSS pediu.
//
// Esperas são pelo FIM (a condição, com teto) — `page.waitForFunction` é proibido
// aqui (ver tools/esperar-saida.mjs).
import { carregarPlaywright, abrirNavegador } from './navegador.mjs';
import { esperarNaPagina, esperarOuExplodir } from './esperar-saida.mjs';
import { subirServidorLocal } from './servidor-local.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { novaSala } from '../server/demo-sala.mjs';
import { montarRetrato, gerarTexto, DEMO_SEGREDO_LEN } from '../server/demo.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.SMOKE_DEMO_PORT || 8251);
const BASE = `http://127.0.0.1:${PORTA}`;
const SECOES = process.env.SMOKE_DEMO_SECOES ? process.env.SMOKE_DEMO_SECOES.split(',').map(Number) : null;   // só estas seções (diagnóstico)
const rodar = (n) => !SECOES || SECOES.includes(n);
const PRINTS = process.env.SMOKE_DEMO_PRINTS || null;       // pasta onde guardar capturas (opcional)
const sha = (s) => createHash('sha256').update(s).digest('hex');

let falhas = 0;
const checa = (ok, oq, detalhe = '') => {
  if (!ok) { falhas++; console.log(`  ✗ ${oq}${detalhe ? ' — ' + detalhe : ''}`); } else console.log(`  ✓ ${oq}`);
};

// ── o servidor e as salas semeadas ─────────────────────────────────────────
const raiz = mkdtempSync(join(tmpdir(), 'smoke-demo-'));
const dirDemos = join(raiz, 'demos');
mkdirSync(dirDemos, { recursive: true });
const subir = () => subirServidorLocal({
  porta: PORTA, variavel: 'SMOKE_DEMO_PORT', stderr: 'ignore',
  env: { DEMO_DIR: dirDemos, STATE_DIRECTORY: raiz, MANTER_DESLIGADO: '1', ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
});
let { servidor } = await subir();
// Derruba o servidor de verdade e espera ele SAIR (a porta tem que ficar livre pra subir de novo).
const derrubar = () => new Promise((resolve) => { servidor.once('exit', resolve); servidor.kill('SIGTERM'); });

const fixtures = JSON.parse(readFileSync(join(RAIZ, 'tools', 'fixtures-paises.json'), 'utf8'));
const { convidado: DECK, apresentador: DECK_HOST } = montarRetrato(fixtures.filter((p) => p && typeof p === 'object'), 60);
console.log(`deck: ${DECK.length} pedidos reais (${fixtures.length} nas fixtures)`);

function semear({ modo, tempoMs = 0, total = DECK.length, referencia = false, max = 150 }) {
  const segredo = gerarTexto(DEMO_SEGREDO_LEN);
  const hostKey = gerarTexto(20);
  const id = sha('demo:' + segredo).slice(0, 40);
  const agora = Date.now();
  const est = novaSala({
    id, hostHash: sha('demo-host:' + hostKey), modo, tempoMs, referencia, total, max,
    criadoEm: agora, votosAte: agora + 3 * 3600_000, expiraEm: agora + 48 * 3600_000,
  }, agora);
  const deck = { convidado: DECK.slice(0, total), apresentador: DECK_HOST.slice(0, total), regiao: 'row' };
  writeFileSync(join(dirDemos, `demo_sala_${id}.json`), JSON.stringify({ est, deck }));
  return { segredo, hostKey, id };
}
async function host(sala, tipo, extra = {}) {
  const r = await fetch(BASE + '/api/demo-host', { method: 'POST', body: JSON.stringify({ demo: sala.id, hostKey: sala.hostKey, tipo, ...extra }) });
  return { status: r.status, body: await r.json() };
}

// Espera pelo lado do SERVIDOR (o que a sala sabe), com teto.
async function esperarNaSala(sala, pred, oQue, teto = 10000) {
  const fim = Date.now() + teto;
  for (;;) {
    const v = (await host(sala, 'visao')).body.visao;
    if (v && pred(v)) return v;
    if (Date.now() > fim) throw new Error(`a espera por ${oQue} estourou (${teto}ms): ${JSON.stringify(v).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ── o navegador ────────────────────────────────────────────────────────────
const pw = await carregarPlaywright();
const browser = await abrirNavegador(pw);
const APARELHOS = [
  { nome: 'iPhone 393×852', viewport: { width: 393, height: 852 } },
  { nome: 'Fold 280×653', viewport: { width: 280, height: 653 } },
];
const LINGUAS = ['pt-BR', 'en-US', 'es-ES', 'fr-FR'];

async function abrirPagina(ap, locale, url) {
  const ctx = await browser.newContext({ viewport: ap.viewport, locale, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e.message).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|waze\.com/.test(m.text())) erros.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { ctx, page, erros };
}
const telaVisivel = (page) => page.evaluate(() => {
  const ids = ['telaAbrindo', 'telaErro', 'telaCodigo', 'telaEntrada', 'telaSaguao', 'telaContagem', 'telaTriagem', 'telaAguarda', 'telaRevelacao', 'telaFim'];
  return ids.filter((i) => { const e = document.getElementById(i); return e && !e.classList.contains('hidden'); }).map((i) => i.slice(4).toLowerCase());
});
const esperarTela = (page, nome, teto = 15000) => esperarOuExplodir(page, new Function(
  `const e = document.getElementById(${JSON.stringify('tela' + nome[0].toUpperCase() + nome.slice(1))}); return !!e && !e.classList.contains('hidden');`), `a tela «${nome}»`, teto);
const entrarNaSala = async (page, apelido) => {
  await esperarTela(page, 'entrada');
  await page.locator('#apelidoCampo').fill(apelido);
  await page.locator('#entradaBtn').click();
  await esperarTela(page, 'saguao');
};

// O card da frente cabe? A barra ✕ ↑ ✓ está dentro da janela, recebe o dedo (hit-test) e nada rola de lado.
const medirCard = (page) => page.evaluate(() => {
  const card = document.querySelector('#demoCardStack .place-card');
  if (!card) return { semCard: true };
  const bar = card.querySelector('.card-actions').getBoundingClientRect();
  const alvo = (sel) => {
    const b = card.querySelector(sel).getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { ok: !!el && !!el.closest(sel), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const doc = document.documentElement;
  return {
    idx: +card.dataset.idx,
    barraFim: Math.round(bar.bottom), janela: window.innerHeight,
    horizontal: doc.scrollWidth - doc.clientWidth,
    reject: alvo('.card-btn-reject'), skip: alvo('.card-btn-skip'), read: alvo('.card-btn-read'),
    nome: card.querySelector('.card-name').textContent.slice(0, 40),
  };
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n1) Sem segredo no endereço: o código curto');
if (rodar(1)) {
  const sala = semear({ modo: 'livre', total: 3 });
  const ap = APARELHOS[0];
  const { ctx, page, erros } = await abrirPagina(ap, 'pt-BR', BASE + '/demo');
  await esperarTela(page, 'codigo');
  checa(true, 'sem fragmento a página pede o código');
  await page.locator('#codigoCampo').fill('k7q2m9');
  checa(await page.locator('#codigoCampo').inputValue() === 'K7Q-2M9', 'o campo formata como o apresentador vê («K7Q-2M9»)');
  await page.locator('#codigoEntrar').click();
  await esperarOuExplodir(page, () => { const e = document.getElementById('codigoErro'); return !!e && !e.classList.contains('hidden') && e.textContent.length > 0; }, 'o erro do código desconhecido');
  checa(true, 'código que não existe diz o motivo, sem sair da tela');
  // Um código de verdade (pedido pela rota do apresentador, a mesma do app).
  const c = await host(sala, 'codigo');
  checa(c.status === 200 && c.body.codigo, 'o apresentador gera o código curto', JSON.stringify(c.body).slice(0, 80));
  await page.locator('#codigoCampo').fill(c.body.codigo);
  await page.locator('#codigoEntrar').click();
  await esperarTela(page, 'entrada');
  checa(true, 'o código certo abre a sala (a mesma do link)');
  checa(erros.length === 0, 'sem erro de página', erros.join(' | '));
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n2) Link ruim e sala que acabou');
if (rodar(2)) {
  const ap = APARELHOS[0];
  let { ctx, page } = await abrirPagina(ap, 'en-US', BASE + '/demo#ABCDEFGHJKLMNPQRSTUV');
  await esperarTela(page, 'erro');
  const texto = await page.locator('#telaErroTexto').textContent();
  checa(/not found|may have ended|valid/i.test(texto), 'sala inexistente: a frase vem do servidor, na língua da pessoa', texto);
  await ctx.close();
  const sala = semear({ modo: 'livre', total: 2 });
  await host(sala, 'encerrar');   // nem começou: encerrar do saguão é permitido
  ({ ctx, page } = await abrirPagina(ap, 'pt-BR', `${BASE}/demo#${sala.segredo}`));
  await esperarTela(page, 'erro');
  checa(/terminou/i.test(await page.locator('#telaErroTexto').textContent()), 'sala encerrada: «Esta demo já terminou.»');
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n3) A fila inteira cabe — 51 pedidos reais × 2 aparelhos × 4 línguas (modo livre, voto pelo ✕)');
if (rodar(3)) for (const ap of APARELHOS) {
  for (const lingua of LINGUAS) {
    const sala = semear({ modo: 'livre' });
    const { ctx, page, erros } = await abrirPagina(ap, lingua, `${BASE}/demo#${sala.segredo}`);
    await entrarNaSala(page, 'Ana ' + lingua.slice(0, 2));
    await host(sala, 'comecar');
    await esperarTela(page, 'triagem', 20000);
    const ruins = [];
    let vistos = 0;
    for (let i = 1; i <= DECK.length; i++) {
      await esperarOuExplodir(page, new Function(`const c = document.querySelector('#demoCardStack .place-card'); return !!c && +c.dataset.idx === ${i};`), `o card ${i}`, 10000);
      const m = await medirCard(page);
      vistos++;
      const motivos = [];
      if (m.barraFim > m.janela) motivos.push(`barra além da janela (${m.barraFim} > ${m.janela})`);
      if (m.horizontal > 0) motivos.push(`rola de lado (${m.horizontal}px)`);
      for (const b of ['reject', 'skip', 'read']) if (!m[b].ok || m[b].w < 44 || m[b].h < 44) motivos.push(`${b} ${m[b].ok ? 'pequeno ' + m[b].w + '×' + m[b].h : 'coberto'}`);
      if (motivos.length) ruins.push(`#${i} «${m.nome}»: ${motivos.join('; ')}`);
      if (PRINTS && (i === 1 || i === 7)) { mkdirSync(PRINTS, { recursive: true }); await page.screenshot({ path: join(PRINTS, `card-${ap.viewport.width}-${lingua}-${i}.png`) }); }
      await page.locator('#demoCardStack .place-card .card-btn-reject').click();
    }
    checa(ruins.length === 0, `${ap.nome} · ${lingua}: ${vistos} cards, barra visível e tocável, sem rolagem lateral`, ruins.slice(0, 3).join(' || '));
    await esperarTela(page, 'fim', 15000);
    // O servidor guardou os 51 votos (e nada além): a tela mentir seria o pior defeito.
    const v = await (await fetch(BASE + '/api/demo-host', { method: 'POST', body: JSON.stringify({ demo: sala.id, hostKey: sala.hostKey, tipo: 'visao' }) })).json();
    const p = (v.visao.pessoas || [])[0];
    checa(p && p.feitos === DECK.length && p.terminou === true, `${lingua}: o servidor tem os ${DECK.length} votos da pessoa`, JSON.stringify(p));
    checa(erros.length === 0, `${lingua}: sem erro de página`, erros.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n4) O jogo sincronizado: saguão, contagem, voto, palpite, revelação, recado, pausa, fim');
if (rodar(4)) {
  const ap = APARELHOS[0];
  const sala = semear({ modo: 'sinc', tempoMs: 0, total: 3, referencia: true });
  const { ctx, page, erros } = await abrirPagina(ap, 'pt-BR', `${BASE}/demo#${sala.segredo}`);
  await entrarNaSala(page, 'Beto');
  checa((await page.locator('#saguaoNome').textContent()) === 'Beto', 'saguão mostra o apelido');
  // Um segundo convidado com o MESMO apelido: o servidor desempata.
  const outra = await abrirPagina(ap, 'pt-BR', `${BASE}/demo#${sala.segredo}`);
  await entrarNaSala(outra.page, 'Beto');
  checa((await outra.page.locator('#saguaoNome').textContent()) === 'Beto 2', 'apelido repetido vira «Beto 2»');
  await esperarOuExplodir(page, () => document.querySelectorAll('#saguaoNomes li').length === 2, 'a lista do saguão com as duas pessoas');
  checa(true, 'a lista do saguão se atualiza sozinha (fluxo ao vivo)');

  // Recarregar não perde a pessoa: volta ao saguão com o MESMO apelido.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await esperarTela(page, 'saguao');
  checa((await page.locator('#saguaoNome').textContent()) === 'Beto', 'recarregar a página volta à mesma sala, com o mesmo apelido');

  await host(sala, 'comecar');
  await esperarTela(page, 'contagem');
  checa(true, 'contagem 3-2-1 aparece');
  await esperarTela(page, 'triagem', 15000);
  checa((await page.locator('#faixaPedido').textContent()).includes('1'), 'a faixa diz o pedido 1');
  // O palpite só vem DEPOIS do voto.
  checa(await page.locator('#palpiteBloco').isHidden(), 'antes do voto, nada de palpite');
  await page.locator('#demoCardStack .place-card .card-btn-read').click();
  await esperarTela(page, 'aguarda');
  checa((await page.locator('#aguardaVoto').textContent()).includes('✓'), 'depois do voto: «Seu voto: ✓ …»');
  await esperarOuExplodir(page, () => !document.getElementById('palpiteBloco').classList.contains('hidden'), 'o palpite');
  await page.locator('[data-palpite="L"]').click();
  await esperarOuExplodir(page, () => !document.getElementById('palpiteFeito').classList.contains('hidden'), 'o palpite confirmado');
  checa(true, 'palpite registrado');
  // A outra pessoa vota ✕ e o apresentador revela.
  await esperarTela(outra.page, 'triagem', 15000);
  await outra.page.locator('#demoCardStack .place-card .card-btn-reject').click();
  await esperarNaSala(sala, (v) => v.pedidos[0].n === 2, 'os dois votos no pedido 1');
  await host(sala, 'votarRef', { idx: 1, voto: 'L' });
  await host(sala, 'revelar');
  await esperarTela(page, 'revelacao');
  const barras = await page.locator('#revBarras li').allTextContents();
  checa(barras.length === 3 && barras.some((b) => /✕.*1 · 50%/.test(b)) && barras.some((b) => /✓.*1 · 50%/.test(b)), 'a revelação mostra a sala 50/50', barras.join(' | '));
  checa(/Empate/i.test(await page.locator('#revMaioria').textContent()), 'empate é dito como empate');
  checa(!(await page.locator('#revRef').isHidden()) && /✓/.test(await page.locator('#revRef').textContent()), 'o voto de referência do apresentador aparece na revelação');
  // Recado e pausa
  await host(sala, 'recado', { texto: 'Atenção aqui, pessoal!' });
  await esperarOuExplodir(page, () => !document.getElementById('demoRecado').classList.contains('hidden'), 'o recado');
  checa((await page.locator('#demoRecadoTexto').textContent()) === 'Atenção aqui, pessoal!', 'o recado do apresentador aparece');
  await host(sala, 'pausar');
  await esperarOuExplodir(page, () => !document.getElementById('telaPausa').classList.contains('hidden'), 'a pausa');
  checa(true, 'pausa cobre a tela');
  await host(sala, 'retomar');
  await esperarOuExplodir(page, () => document.getElementById('telaPausa').classList.contains('hidden'), 'o fim da pausa');
  await host(sala, 'proximo');
  await esperarTela(page, 'triagem');
  checa((await page.locator('#faixaPedido').textContent()).includes('2'), 'o próximo pedido chega pra todos');
  // Vota pelo GESTO (arrastar com o dedo/mouse até passar do limiar).
  const caixa = await page.locator('#demoCardStack .place-card').boundingBox();
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 3);
  await page.mouse.down();
  await page.mouse.move(caixa.x + caixa.width / 2 - 200, caixa.y + caixa.height / 3, { steps: 12 });
  await page.mouse.up();
  await esperarTela(page, 'aguarda', 8000);
  checa((await page.locator('#aguardaVoto').textContent()).includes('✕'), 'arrastar o card pra esquerda é ✕ (o gesto do app)');
  // Fim
  await host(sala, 'revelar'); await host(sala, 'proximo'); await host(sala, 'revelar'); await host(sala, 'proximo');
  await esperarTela(page, 'fim', 15000);
  checa(/2 de 3|1 de 3/.test(await page.locator('#fimResumo').textContent()), 'o fim resume quantos pedidos a pessoa triou', await page.locator('#fimResumo').textContent());
  const v = (await host(sala, 'visao')).body.visao;
  checa(v.fase === 'encerrada', 'a sala encerra no último pedido');
  checa(erros.length === 0 && outra.erros.length === 0, 'sem erro de página', [...erros, ...outra.erros].slice(0, 2).join(' | '));
  await outra.ctx.close();
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n5) O relógio do pedido (10 s) fecha o pedido e revela sozinho');
if (rodar(5)) {
  const sala = semear({ modo: 'sinc', tempoMs: 10000, total: 2 });
  const { ctx, page, erros } = await abrirPagina(APARELHOS[0], 'en-US', `${BASE}/demo#${sala.segredo}`);
  await entrarNaSala(page, 'Cris');
  await host(sala, 'comecar');
  await esperarTela(page, 'triagem', 15000);
  await esperarOuExplodir(page, () => !document.getElementById('relogio').classList.contains('hidden'), 'a barra do relógio');
  const f1 = await page.evaluate(() => document.getElementById('relogioBarra').style.transform);
  await new Promise((r) => setTimeout(r, 1500));
  const f2 = await page.evaluate(() => document.getElementById('relogioBarra').style.transform);
  const num = (s) => Number(/scaleX\(([\d.]+)\)/.exec(s)?.[1] ?? NaN);
  checa(num(f2) < num(f1), 'a barra do tempo anda (CONTROLE: parada não passaria)', `${f1} → ${f2}`);
  // Ninguém vota: no fim do prazo (+ a graça) a sala revela sozinha.
  await esperarTela(page, 'revelacao', 20000);
  checa(true, 'sem voto, o tempo acaba e a sala revela sozinha');
  checa(/didn.t vote/i.test(await page.locator('#revVoce').textContent()), 'quem não votou lê «You didn’t vote on this request.»');
  checa(erros.length === 0, 'sem erro de página', erros.join(' | '));
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n6) A conexão cai e volta: o estado se refaz sozinho');
if (rodar(6)) {
  const sala = semear({ modo: 'livre', total: 4 });
  const { ctx, page, erros } = await abrirPagina(APARELHOS[0], 'pt-BR', `${BASE}/demo#${sala.segredo}`);
  await entrarNaSala(page, 'Dani');
  // Modo avião: a conexão do tempo real morre, e a página precisa perceber e voltar sozinha.
  await ctx.setOffline(true);
  await host(sala, 'comecar');   // enquanto a página está sem rede, a sala anda (o servidor segue no ar)
  await esperarOuExplodir(page, () => !document.getElementById('demoRede').classList.contains('hidden'), 'o aviso de sem sinal', 20000);
  checa(true, 'com o fluxo fora, a página avisa («tentando reconectar»)');
  await ctx.setOffline(false);
  await esperarTela(page, 'triagem', 30000);
  checa(true, 'ao voltar o sinal a página alcança a fase que perdeu (o fluxo manda o estado INTEIRO)');
  checa(erros.length === 0, 'sem erro de página', erros.slice(0, 2).join(' | '));
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n7) O SERVIDOR cai e sobe de novo (a VM reiniciou): a sala volta do arquivo e a pessoa continua nela');
if (rodar(7)) {
  const sala = semear({ modo: 'livre', total: 4 });
  const { ctx, page, erros } = await abrirPagina(APARELHOS[0], 'fr-FR', `${BASE}/demo#${sala.segredo}`);
  await entrarNaSala(page, 'Eva');
  await derrubar();
  await esperarOuExplodir(page, () => !document.getElementById('demoRede').classList.contains('hidden'), 'o aviso de sem sinal com o servidor fora', 40000);
  checa(/signal/i.test(await page.locator('#demoRedeTexto').textContent()), 'com o servidor fora, a página avisa na língua da pessoa', await page.locator('#demoRedeTexto').textContent());
  ({ servidor } = await subir());
  await host(sala, 'comecar');
  await esperarTela(page, 'triagem', 40000);
  checa(true, 'o servidor volta, a sala vem do arquivo e a página religa sozinha (sem recarregar)');
  await esperarOuExplodir(page, () => document.getElementById('demoRede').classList.contains('hidden'), 'o aviso sumir', 10000);
  checa(true, 'o aviso de sem sinal some depois de conectar');
  checa(erros.length === 0, 'sem erro de página', erros.slice(0, 2).join(' | '));
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n8) As telas que não são o card cabem — entrada, saguão, palpite, revelação e fim × 2 aparelhos × 4 línguas');
// Cabe = nada rola de lado, nenhum botão/campo passa da borda e nenhum rótulo é cortado (o texto mais
// largo quase nunca está na língua em que se desenvolve: gotcha #25).
const layoutDaTela = (page) => page.evaluate(() => {
  const doc = document.documentElement;
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('.hidden'); };
  const ruins = [];
  for (const el of document.querySelectorAll('button, input, li, h1, h2, p')) {
    if (!visivel(el) || el.closest('template')) continue;
    const r = el.getBoundingClientRect();
    const nome = (el.id || el.getAttribute('data-palpite') || el.tagName) + ':' + (el.textContent || '').trim().slice(0, 18);
    if (r.right > doc.clientWidth + 0.5 || r.left < -0.5) ruins.push('fora da tela ' + nome);
    if ((el.tagName === 'BUTTON') && el.scrollWidth > el.clientWidth + 1) ruins.push('rótulo cortado ' + nome);
    if (el.tagName === 'BUTTON' && r.height < 44) ruins.push('alvo baixo ' + nome + ' ' + Math.round(r.height));
  }
  return { horizontal: doc.scrollWidth - doc.clientWidth, ruins };
});
if (rodar(8)) {
  // CONTROLE: o instrumento TEM de acusar (um botão de 600 px numa tela de 280 passa da borda).
  const sala = semear({ modo: 'livre', total: 2 });
  const { ctx, page } = await abrirPagina(APARELHOS[1], 'pt-BR', `${BASE}/demo#${sala.segredo}`);
  await esperarTela(page, 'entrada');
  await page.evaluate(() => { const b = document.getElementById('entradaBtn'); b.style.width = '600px'; b.style.maxWidth = 'none'; });
  const l = await layoutDaTela(page);
  checa(l.horizontal > 0 && l.ruins.some((r) => r.startsWith('fora da tela')), 'CONTROLE: o medidor acusa um botão que passa da borda', JSON.stringify(l));
  await ctx.close();
}
if (rodar(8)) for (const ap of APARELHOS) {
  for (const lingua of LINGUAS) {
    const sala = semear({ modo: 'sinc', tempoMs: 0, total: 3, referencia: true });
    const { ctx, page, erros } = await abrirPagina(ap, lingua, `${BASE}/demo#${sala.segredo}`);
    const achados = [];
    const confere = async (tela) => {
      const l = await layoutDaTela(page);
      if (l.horizontal > 0) achados.push(`${tela}: rola de lado ${l.horizontal}px`);
      for (const r of l.ruins) achados.push(`${tela}: ${r}`);
    };
    await esperarTela(page, 'entrada');
    await page.locator('#apelidoCampo').fill('Marina da Silva Gonçalves 😀 Pereira');
    await confere('entrada');
    await page.locator('#entradaBtn').click();
    await esperarTela(page, 'saguao');
    await confere('saguão');
    await host(sala, 'comecar');
    await esperarTela(page, 'triagem', 20000);
    await page.locator('#demoCardStack .place-card .card-btn-reject').click();
    await esperarTela(page, 'aguarda');
    await esperarOuExplodir(page, () => !document.getElementById('palpiteBloco').classList.contains('hidden'), 'o palpite');
    await confere('palpite');
    await page.locator('[data-palpite="L"]').click();
    await host(sala, 'votarRef', { idx: 1, voto: 'P' });
    await host(sala, 'revelar');
    await esperarTela(page, 'revelacao');
    await confere('revelação');
    await host(sala, 'encerrar');
    await esperarTela(page, 'fim');
    await confere('fim');
    checa(achados.length === 0, `${ap.nome} · ${lingua}: as telas cabem`, achados.slice(0, 4).join(' || '));
    checa(erros.length === 0, `${lingua}: sem erro de página`, erros.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
await browser.close();
await derrubar();
await new Promise((r) => setTimeout(r, 300));
rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
console.log(falhas ? `\n✗ ${falhas} falha(s)` : '\n✓ smoke da demo: tudo passou');
process.exit(falhas ? 1 : 0);
