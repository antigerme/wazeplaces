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
console.log('\n9) O APP cria a demo: a linha das Preferências, o diálogo (4 línguas × 2 aparelhos), a chave e o «Sair»');
// A tela REAL do app com o estado injetado (a API é de mentira: nada fala com o Waze). O diálogo é o que tem
// campo e botões presos, então o que se mede é caber, o toque e a fileira presa — e a chave guardada de verdade.
const CRIAR_OK = { success: true, demo: 'd'.repeat(40), segredo: 'ABCDEFGHJKLMNPQRSTUV', hostKey: 'WXYZ2345679ABCDEFGHJ', total: 30, modo: 'sinc', tempoMs: 20000, referencia: true, max: 150, criadoEm: Date.now(), votosAte: Date.now() + 3 * 3600_000, expiraEm: Date.now() + 48 * 3600_000 };
async function appComoApresentador(ap, lingua, perfil) {
  const ctx = await browser.newContext({ viewport: ap.viewport, locale: lingua, serviceWorkers: 'block' });
  const corpos = [];
  await ctx.route('**/api/perfil', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, profile: perfil }) }));
  await ctx.route('**/api/buscar-places', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, places: [], hasMore: false, total: 0 }) }));
  await ctx.route('**/api/demo-criar', (r) => { corpos.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...CRIAR_OK, criadoEm: Date.now(), expiraEm: Date.now() + 48 * 3600_000 }) }); });
  await ctx.route('**/api/sessao', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await ctx.route('**/api/parear', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 120)));
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true, passagemDispensada: true, undoGateSeen: true, presenca: false })));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(async (perfil) => {
    applyI18n();
    AppState.authenticated = true;
    API.setSession('token-smoke');
    AppState.profile = perfil;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    showLoading(false); renderProfileHeader(AppState.profile); updateStats();
  }, perfil);
  return { ctx, page, erros, corpos };
}
const caixaDoDialogo = (page, id) => page.evaluate((i) => {
  const m = document.getElementById(i);
  // O cartão ROLA onde não cabe (o Fold): a fileira de ações é alcançada rolando — ou já está presa, onde o navegador tem o
  // portão de rolagem. O que se mede é que ela é ALCANÇÁVEL, não que nasça à vista.
  const fila = m.querySelector('.dialogo-acoes, .acoes-presas');
  if (fila) fila.scrollIntoView({ block: 'end' });
  const c = m.querySelector('.dialogo-cartao').getBoundingClientRect();
  const doc = document.documentElement;
  const alvo = (sel) => { const e = m.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { ok: !!h && !!h.closest(sel), w: Math.round(b.width), h: Math.round(b.height), dentro: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight + 1 }; };
  return { cartao: [Math.round(c.left), Math.round(c.top), Math.round(c.right), Math.round(c.bottom)], janela: [innerWidth, innerHeight], horizontal: doc.scrollWidth - doc.clientWidth,
    ok: alvo('#demoCriarOk') || alvo('#demoProntaFechar'), cancelar: alvo('#demoCriarCancelar'), abrir: alvo('#demoAbrirPalco') };
}, id);
if (rodar(9)) {
  // CONTROLE 1: quem NÃO pode criar não vê a linha (L5 com área gerenciada é o portão do destrutivo, não o da demo).
  {
    const { ctx, page } = await appComoApresentador(APARELHOS[0], 'pt-BR', { userName: 'a', rank: 4, isAreaManager: true, isStaff: false });
    await page.evaluate(() => abrirPerfil('filtersTabPrefs'));
    const visivel = await page.evaluate(() => !document.getElementById('prefDemoRow').classList.contains('hidden'));
    checa(visivel === false, 'CONTROLE: L5+AM não vê «Demo para apresentação» (o portão é L6+AM)');
    await ctx.close();
  }
  for (const ap of APARELHOS) {
    for (const lingua of LINGUAS) {
      const { ctx, page, erros, corpos } = await appComoApresentador(ap, lingua, { userName: 'a', rank: 5, isAreaManager: true, isStaff: false, id: 4242 });
      await page.evaluate(() => abrirPerfil('filtersTabPrefs'));
      const achados = [];
      const linha = await page.evaluate(() => { const l = document.getElementById('prefDemoRow'); const b = document.getElementById('prefDemoCriar').getBoundingClientRect(); return { visivel: !l.classList.contains('hidden'), palco: !document.getElementById('prefDemoPalco').classList.contains('hidden'), alvo: Math.round(b.height) }; });
      if (!linha.visivel) achados.push('a linha não apareceu pra L6+AM');
      if (linha.palco) achados.push('o link do palco apareceu sem demo guardada');
      if (linha.alvo < 44) achados.push('o botão «Criar…» tem ' + linha.alvo + ' px');
      await page.evaluate(() => document.getElementById('prefDemoCriar').scrollIntoView({ block: 'center' }));
      await page.locator('#prefDemoCriar').click();
      await esperarOuExplodir(page, () => !document.getElementById('demoCriarModal').classList.contains('hidden'), 'o diálogo de criar');
      let c = await caixaDoDialogo(page, 'demoCriarModal');
      if (PRINTS) { mkdirSync(PRINTS, { recursive: true }); await page.screenshot({ path: join(PRINTS, `criar-${ap.viewport.width}-${lingua}.png`) }); }
      if (c.horizontal > 0) achados.push('rola de lado ' + c.horizontal);
      if (c.cartao[0] < 0 || c.cartao[2] > c.janela[0] || c.cartao[3] > c.janela[1] + 1) achados.push('o cartão passa da janela ' + JSON.stringify(c.cartao) + ' em ' + JSON.stringify(c.janela));
      if (!c.ok || !c.ok.ok || !c.ok.dentro || c.ok.h < 44) achados.push('«Criar demo» não está à vista/tocável ' + JSON.stringify(c.ok));
      if (!c.cancelar || !c.cancelar.ok) achados.push('«Cancelar» coberto');
      // Num CELULAR a chave do palco não sai do aparelho: o diálogo diz isso ANTES de criar (compara com o texto da chave, nas 4 línguas).
      const dicaCel = await page.evaluate(() => ({ rodape: document.getElementById('demoCriarRodape').textContent, soAqui: t('demo.criar.soAqui'), largo: computadorDeTelaLarga() }));
      if (dicaCel.largo) achados.push('o celular foi tomado por computador de tela larga');
      if (!dicaCel.rodape.includes(dicaCel.soAqui)) achados.push('o diálogo de criar não avisa que o palco só abre neste aparelho: ' + dicaCel.rodape);
      const filtroTxt = await page.locator('#demoCriarFiltro').textContent();
      if (!/30/.test(filtroTxt)) achados.push('o resumo não diz «até 30»: ' + filtroTxt);
      // O tempo some no modo livre (e volta no sincronizado).
      await page.locator('input[name="demoModo"][value="livre"]').check({ force: true });
      if (await page.locator('#demoCriarTempo').isVisible()) achados.push('«Tempo por pedido» ficou no modo livre');
      await page.locator('input[name="demoModo"][value="sinc"]').check({ force: true });
      if (!(await page.locator('#demoCriarTempo').isVisible())) achados.push('«Tempo por pedido» sumiu no sincronizado');
      await page.locator('#demoCriarOk').scrollIntoViewIfNeeded();
      await page.locator('#demoCriarOk').click();
      await esperarOuExplodir(page, () => !document.getElementById('demoProntaModal').classList.contains('hidden'), 'o diálogo «criada»');
      if (await page.locator('#demoCriarModal').isVisible()) achados.push('o diálogo de criar ficou por baixo do «criada»');
      c = await caixaDoDialogo(page, 'demoProntaModal');
      if (!c.abrir || !c.abrir.ok || !c.abrir.dentro || c.abrir.h < 44) achados.push('«Abrir o palco» não está tocável ' + JSON.stringify(c.abrir));
      if (!c.ok || !c.ok.ok || !c.ok.dentro) achados.push('«Fechar» não está à vista');
      const avisoCel = await page.evaluate(() => { const p = document.querySelector('#demoProntaModal [data-i18n^="demo.pronta.aviso"]'); return { chave: p.getAttribute('data-i18n'), texto: p.textContent, esperado: t('demo.pronta.avisoCelular') }; });
      if (avisoCel.chave !== 'demo.pronta.avisoCelular' || avisoCel.texto !== avisoCel.esperado) achados.push('o «criada» no celular não diz que o palco só abre neste aparelho: ' + JSON.stringify(avisoCel));
      const href = await page.locator('#demoAbrirPalco').getAttribute('href');
      if (href !== '/palco') achados.push('o link do palco é ' + href + ' (a chave NÃO pode ir na URL)');
      const guardada = await page.evaluate(() => localStorage.getItem('waze_demo_palco'));
      const g = guardada ? JSON.parse(guardada) : null;
      if (!g || g.hostKey !== 'WXYZ2345679ABCDEFGHJ' || String(g.conta) !== '4242') achados.push('a chave não foi guardada com a conta: ' + guardada);
      const textoTela = await page.evaluate(() => document.body.innerText);
      if (textoTela.includes('WXYZ2345679ABCDEFGHJ') || textoTela.includes('ABCDEFGHJKLMNPQRSTUV')) achados.push('a chave ou o segredo foi escrito na tela');
      const c1 = corpos[0] || {};
      if (c1.modo !== 'sinc' || c1.tempoMs !== 20000 || c1.referencia !== true || c1.unreadOnly !== true || !c1.sessionToken) achados.push('o corpo do pedido não leva as escolhas e os filtros: ' + JSON.stringify({ ...c1, sessionToken: !!c1.sessionToken }));
      checa(achados.length === 0, `${ap.nome} · ${lingua}: a linha, o diálogo e a chave`, achados.slice(0, 4).join(' || '));
      // O diagnóstico omite a chave; o «Sair» a apaga.
      await page.evaluate(() => closeModal('demoProntaModal'));
      const linha2 = await page.evaluate(() => { abrirPerfil('filtersTabPrefs'); return !document.getElementById('prefDemoPalco').classList.contains('hidden'); });
      checa(linha2 === true, `${lingua}: com a demo guardada, o link do palco aparece nas Preferências`);
      await page.evaluate(() => handleLogout());
      await new Promise((r) => setTimeout(r, 300));
      const depois = await page.evaluate(() => localStorage.getItem('waze_demo_palco'));
      checa(depois === null, `${lingua}: o «Sair» apaga a chave da demo`);
      checa(erros.length === 0, `${lingua}: sem erro de página`, erros.slice(0, 2).join(' | '));
      await ctx.close();
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n10) O PALCO (/palco): o saguão com o QR e o código, o jogo conduzido pelo teclado, a referência escondida, o livre sem barra ao vivo, o resultado');
const PROJETORES = [{ nome: 'laptop 1366×768', viewport: { width: 1366, height: 768 } }, { nome: 'projetor 1920×1080', viewport: { width: 1920, height: 1080 } },
  // Janelas de verdade: o Chrome de um laptop 1366×768 deixa ~650 de altura, e o espelhamento de projetor costuma cair em 1280×720 ou 1024×768.
  { nome: 'janela 1366×650', viewport: { width: 1366, height: 650 } }, { nome: 'espelho 1280×720', viewport: { width: 1280, height: 720 } }, { nome: 'espelho 1024×768', viewport: { width: 1024, height: 768 } }];
const parteDe = (n) => 'parte-do-palco-' + String(n).padStart(4, '0');
async function convidar(sala, n, apelido, pais = 'Brasil') {
  const r = await fetch(BASE + '/api/demo-entrar', { method: 'POST', body: JSON.stringify({ demo: sala.id, parte: parteDe(n), apelido, pais }) });
  return r.json();
}
const votarComo = (sala, n, idx, voto) => fetch(BASE + '/api/demo-votar', { method: 'POST', body: JSON.stringify({ demo: sala.id, parte: parteDe(n), idx, voto }) }).then((r) => r.json());
const palpitarComo = (sala, n, idx, palpite) => fetch(BASE + '/api/demo-palpitar', { method: 'POST', body: JSON.stringify({ demo: sala.id, parte: parteDe(n), idx, palpite }) }).then((r) => r.json());
async function abrirPalco(pr, lingua, sala, { escuro = false } = {}) {
  const ctx = await browser.newContext({ viewport: pr.viewport, locale: lingua, colorScheme: escuro ? 'dark' : 'light' });
  const chave = sala ? JSON.stringify({ demo: sala.id, segredo: sala.segredo, hostKey: sala.hostKey, expiraEm: Date.now() + 48 * 3600_000, criadoEm: Date.now(), total: DECK.length, conta: '1' }) : null;
  if (chave) await ctx.addInitScript((c) => localStorage.setItem('waze_demo_palco', c), chave);
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e.message).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|waze\.com/.test(m.text())) erros.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(BASE + '/palco', { waitUntil: 'domcontentloaded' });
  return { ctx, page, erros };
}
const textoDe = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
const palcoCabe = (page) => page.evaluate(() => {
  const doc = document.documentElement;
  const ruins = [];
  for (const el of document.querySelectorAll('#palcoRaiz button, #palcoRaiz canvas, #palcoRaiz h1, #palcoRaiz h2')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || el.closest('.hidden')) continue;
    if (r.right > doc.clientWidth + 1 || r.left < -1) ruins.push('fora na horizontal: ' + (el.id || el.textContent.trim().slice(0, 20)));
    if (el.tagName === 'BUTTON' && r.bottom > innerHeight + 1 && !el.closest('#palcoFimCorpo, #palcoGrade, #palcoDetalhe')) ruins.push('botão abaixo da janela: ' + el.textContent.trim().slice(0, 20));
  }
  // O que passa da própria caixa (o painel lateral e o cartão do pedido têm `overflow: hidden`: o que passa SOME, calado).
  for (const id of ['palcoLado', 'palcoFoco', 'palcoAvanco', 'palcoDecisoes']) {
    const el = document.getElementById(id);
    if (el && el.scrollHeight > el.clientHeight + 1) ruins.push('cortado: #' + id + ' (' + el.scrollHeight + ' > ' + el.clientHeight + ')');
  }
  return { rolaDeLado: doc.scrollWidth - doc.clientWidth, rolaPraBaixo: document.body.scrollHeight - innerHeight, ruins };
});

if (rodar(10)) {
  // CONTROLE: sem chave, o palco diz de onde abri-lo — e não tenta nada na rede.
  {
    const { ctx, page } = await abrirPalco(PROJETORES[0], 'pt-BR', null);
    await esperarOuExplodir(page, () => !!document.getElementById('palcoMsg'), 'a mensagem sem chave');
    checa(/Preferências/.test(await textoDe(page, '#palcoMsg')), 'sem chave, o palco diz de onde abri-lo (Preferências → Demo)');
    await ctx.close();
  }

  // A volta completa, no laptop, em português, com a referência ligada.
  {
    const sala = semear({ modo: 'sinc', tempoMs: 0, total: 3, referencia: true });
    const { ctx, page, erros } = await abrirPalco(PROJETORES[0], 'pt-BR', sala);
    await esperarOuExplodir(page, () => !!document.getElementById('palcoQr'), 'o saguão do palco', 20000);
    // XSS: o apelido é TEXTO de terceiro numa tela projetada.
    await convidar(sala, 1, '<b id="xss1">Ana</b><img src=x onerror=window.__xss=1>', '<i>Brasil</i>');
    await convidar(sala, 2, 'Beto', 'México');
    await convidar(sala, 3, 'Carla', 'França');
    await esperarOuExplodir(page, () => document.querySelectorAll('#palcoNomes li').length === 3, 'os 3 nomes no saguão');
    const injetou = await page.evaluate(() => !!document.getElementById('xss1') || !!document.querySelector('#palcoNomes img') || window.__xss === 1);
    checa(!injetou, 'o apelido com HTML aparece como TEXTO (nada é injetado na tela do projetor)');
    checa((await textoDe(page, '#palcoNomes')).includes('<b id="xss1">'), 'o texto do apelido sai literal (escapado)');
    checa(/3 na sala/.test(await textoDe(page, '#palcoNaSalaTxt')), 'a pílula conta quem entrou');
    // O QR: desenhado (canvas com tinta de verdade) e o endereço SEM a chave.
    const qr = await page.evaluate(() => { const c = document.getElementById('palcoQr'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let escuros = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60) escuros++; return { w: c.clientWidth, escuros, total: d.length / 4 }; });
    checa(qr.w >= 220 && qr.escuros > qr.total * 0.15, 'o QR está desenhado e grande o bastante pra ler de longe', JSON.stringify(qr));
    const tela1 = await page.evaluate(() => document.body.innerText);
    checa(!tela1.includes(sala.hostKey) && !tela1.includes(sala.segredo), 'a chave e o segredo NÃO estão escritos na tela');
    // O código curto, sob demanda, e ele ABRE a sala do outro lado (a mesma da página do convidado).
    await page.locator('#palcoCodigoBtn').click();
    await esperarOuExplodir(page, () => !document.getElementById('palcoCodigo').classList.contains('hidden'), 'o código curto');
    const codigo = (await textoDe(page, '#palcoCodigoTexto')).trim();
    checa(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(codigo), 'o código aparece no formato que o convidado digita', codigo);
    const abre = await (await fetch(BASE + '/api/demo-abrir', { method: 'POST', body: JSON.stringify({ codigo: codigo.replace('-', '') }) })).json();
    checa(abre.success === true && abre.demo === sala.id, 'o código mostrado abre a MESMA sala');
    const cab1 = await palcoCabe(page);
    checa(cab1.rolaDeLado <= 0 && cab1.rolaPraBaixo <= 1 && cab1.ruins.length === 0, 'o saguão cabe no laptop (sem rolagem, nada fora da janela)', JSON.stringify(cab1));
    // Começa pelo ESPAÇO.
    await page.keyboard.press('Space');
    await esperarOuExplodir(page, () => !!document.getElementById('palcoContagemNum'), 'a contagem 3-2-1', 8000);
    checa(true, 'o Espaço começa a demo (contagem 3-2-1 na tela)');
    await esperarOuExplodir(page, () => !!document.getElementById('palcoFoco') && !!document.querySelector('#palcoFoco [data-pedido]'), 'o pedido em foco', 15000);
    checa((await textoDe(page, '#palcoFoco h2')) === (DECK[0].name || DECK[0].address), 'o pedido em foco é o 1º do baralho');
    // A REFERÊNCIA: confirma sem dizer qual (a tela é projetada).
    await page.keyboard.press('Digit1');   // ✕
    await esperarOuExplodir(page, () => /Referência registrada/.test(document.getElementById('palcoLado').textContent), 'a referência registrada');
    const lado = await textoDe(page, '#palcoLado');
    const painelRef = await page.evaluate(() => { const t = [...document.querySelectorAll('#palcoLado > div')].find((d) => /Seu voto/.test(d.textContent)); return t ? t.textContent : ''; });
    checa(!/[✕↑✓]/.test(painelRef), 'antes da revelação a tela NÃO diz qual foi o voto de referência', painelRef);
    const bruto = await page.evaluate(() => document.documentElement.outerHTML);
    checa(!/data-ref="R"[^>]*disabled|Rejeitar/.test((bruto.match(/id="palcoLado"[\s\S]*?<\/aside>/) || [''])[0].split('Seu voto')[1] || ''), 'o painel da referência não escreve o voto escolhido em lugar nenhum (nem em atributo)');
    // Os convidados votam; o palco conta e a barra ESPERA.
    await votarComo(sala, 1, 1, 'R'); await votarComo(sala, 2, 1, 'R'); await votarComo(sala, 3, 1, 'L');
    await palpitarComo(sala, 1, 1, 'R'); await palpitarComo(sala, 2, 1, 'L');
    await esperarOuExplodir(page, () => /3\s*\/\s*3/.test(document.getElementById('palcoLado').textContent.replace(/\s+/g, ' ')), 'os 3 votos contados');
    checa((await textoDe(page, '#palcoLado')).includes('?'), 'antes de revelar a barra mostra «?» (a sala não é orientada)');
    // Recado: o campo NÃO é apagado quando chega voto (a visão se refaz o tempo todo).
    await page.keyboard.press('KeyR');
    await esperarOuExplodir(page, () => !document.getElementById('palcoRecado').classList.contains('hidden'), 'o campo do recado');
    await page.locator('#palcoRecadoCampo').fill('Olhem o mapa!');
    await convidar(sala, 4, 'Dani'); await convidar(sala, 4, 'Dani');
    await esperarOuExplodir(page, () => /4\s*na sala|4 na sala/.test(document.getElementById('palcoNaSalaTxt').textContent), 'o 4º convidado na pílula');
    checa((await page.locator('#palcoRecadoCampo').inputValue()) === 'Olhem o mapa!', 'o que se digita no recado sobrevive às atualizações da sala');
    await page.locator('#palcoRecadoCampo').press('Enter');
    const vr = (await host(sala, 'visao')).body.visao;
    checa(vr.recado && vr.recado.texto === 'Olhem o mapa!', 'o recado chegou à sala');
    // Espaço DUPLO: revela uma vez, não pula o pedido.
    await page.keyboard.press('Space'); await page.keyboard.press('Space');
    await esperarOuExplodir(page, () => /Como a sala votou/.test(document.getElementById('palcoLado').textContent), 'a revelação');
    await new Promise((r) => setTimeout(r, 400));
    const vv = (await host(sala, 'visao')).body.visao;
    checa(vv.atual === 1 && vv.revelado === true, 'dois Espaços seguidos revelam e NÃO pulam o pedido (atual=' + vv.atual + ')');
    const barra = await textoDe(page, '#palcoLado');
    checa(/✕ Rejeitar\s*2 · 67%/.test(barra.replace(/\s+/g, ' ')) && /✓ Lido\s*1 · 33%/.test(barra.replace(/\s+/g, ' ')), 'a revelação mostra a sala (2 ✕ · 1 ✓)', barra.replace(/\s+/g, ' ').slice(0, 200));
    checa(/A sala escolheu: ✕/.test(barra), 'diz o que a sala escolheu');
    checa(/✕ Rejeitar.*2 pensam como você/s.test(barra.replace(/\s+/g, ' ')) || /pensam como você/.test(barra), 'a referência aparece DEPOIS da revelação, com quem pensa igual');
    checa(/1 de 2 acertaram/.test(barra.replace(/\s+/g, ' ')), 'o palpite da sala: 1 de 2 acertou');
    // Ctrl+→ é do navegador: não avança.
    await page.keyboard.press('Control+ArrowRight');
    await new Promise((r) => setTimeout(r, 900));
    checa((await host(sala, 'visao')).body.visao.atual === 1, 'Ctrl+→ não avança a demo (é atalho do navegador)');
    // Pausa por teclado.
    await page.keyboard.press('KeyP');
    await esperarOuExplodir(page, () => /Pausada/i.test(document.getElementById('palcoFase').textContent), 'a pausa');
    await page.keyboard.press('KeyP');
    await esperarOuExplodir(page, () => !/Pausada/i.test(document.getElementById('palcoFase').textContent), 'o fim da pausa');
    checa(true, 'P pausa e retoma, e a pausa fica dita na tela');
    // → avança; no último, encerra.
    await new Promise((r) => setTimeout(r, 800));
    await page.keyboard.press('ArrowRight');
    await esperarOuExplodir(page, () => /Pedido 2 de 3/.test(document.querySelector('#palcoFoco').textContent), 'o pedido 2');
    checa(true, '→ passa para o próximo pedido');
    const cab2 = await palcoCabe(page);
    checa(cab2.rolaDeLado <= 0 && cab2.rolaPraBaixo <= 1 && cab2.ruins.length === 0, 'o jogo cabe no laptop', JSON.stringify(cab2));
    checa(erros.length === 0, 'palco: sem erro de página', erros.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // O fim, o resultado e a REGRA DE «SAIR»: duas abas do mesmo aparelho.
  {
    const sala = semear({ modo: 'livre', total: 4, referencia: false });
    const { ctx, page, erros } = await abrirPalco(PROJETORES[1], 'en-US', sala, { escuro: true });
    await esperarOuExplodir(page, () => !!document.getElementById('palcoQr'), 'o saguão', 20000);
    for (let n = 1; n <= 4; n++) await convidar(sala, n, 'Pessoa' + n, n % 2 ? 'Brasil' : 'brasil');
    await esperarOuExplodir(page, () => document.querySelectorAll('#palcoNomes li').length === 4, 'os 4 nomes');
    await page.keyboard.press('Space');
    await esperarOuExplodir(page, () => !!document.getElementById('palcoGrade'), 'o painel do modo livre', 20000);
    // Os votos chegam: o palco mostra SÓ contagens — nenhuma barra colorida ao vivo.
    for (let n = 1; n <= 4; n++) for (let i = 1; i <= 4; i++) await votarComo(sala, n, i, n === 4 ? 'L' : 'R');
    await esperarOuExplodir(page, () => /16/.test(document.getElementById('palcoDecisoesNum').textContent), 'as 16 decisões', 15000);
    const aoVivo = await page.evaluate(() => document.getElementById('palcoGrade').innerHTML + document.getElementById('palcoAvanco').innerHTML);
    checa(!/bg-rose-500|bg-emerald-500|bg-amber-500/.test(aoVivo.replace(/bg-emerald-500">/g, '')) || !/bg-rose-500|bg-amber-500/.test(aoVivo), 'no modo livre a divisão colorida dos votos NÃO aparece ao vivo');
    checa(!/rose-500/.test(aoVivo), 'nenhuma barra de «rejeitar» na grade ao vivo');
    const cab = await palcoCabe(page);
    checa(cab.rolaDeLado <= 0 && cab.ruins.length === 0, 'o modo livre cabe no projetor 1920', JSON.stringify(cab));
    // Encerrar pede confirmação NO botão.
    await page.locator('[data-acao="encerrar"]').click();
    await esperarOuExplodir(page, () => !!document.querySelector('[data-acao="encerrar-sim"]'), 'a confirmação de encerrar');
    checa(!(await host(sala, 'visao')).body.visao.encerrada, 'o primeiro toque em «encerrar» NÃO encerra (pede confirmação)');
    await page.locator('[data-acao="encerrar-sim"]').click();
    await esperarOuExplodir(page, () => !!document.getElementById('palcoFimCorpo') && /Hive|Independent|Soft|Trigger|Fastest|Cautious/.test(document.getElementById('palcoFimCorpo').textContent + document.getElementById('palcoAbas').textContent) || !!document.querySelector('[data-pedido-abrir]'), 'o resultado', 20000);
    checa(true, 'confirmado, o resultado aparece');
    await page.locator('[data-aba="pessoas"]').click();
    const pessoasTxt = await textoDe(page, '#palcoFimCorpo');
    checa(/Fastest|Hive mind|Trigger finger|Independent soul|Soft heart/.test(pessoasTxt), 'a aba «Pessoas e prêmios» mostra os prêmios', pessoasTxt.slice(0, 160));
    await page.locator('[data-aba="resumo"]').click();
    const resumoTxt = (await textoDe(page, '#palcoFimCorpo')).replace(/\s+/g, ' ');
    checa(/16\s*decisions/.test(resumoTxt) && /4 people × 4 requests/.test(resumoTxt), 'o resumo diz 16 decisões (4 × 4)', resumoTxt.slice(0, 200));
    checa(/Countries named\s*1/.test(resumoTxt), '«Brasil» e «brasil» contam UM país', resumoTxt.slice(0, 260));
    await page.locator('[data-aba="pedidos"]').click();
    await page.locator('[data-ordem="divididos"]').click();
    const itens = await page.locator('[data-pedido-abrir]').count();
    checa(itens === 4, 'a lista de pedidos tem os 4');
    await page.locator('[data-pedido-abrir]').first().click();
    await esperarOuExplodir(page, () => !!document.getElementById('palcoDetalhe'), 'o detalhe do pedido');
    checa(await page.locator('#palcoDetalhe a[href*="waze.com/editor"]').count() === 1, 'o detalhe tem o ↗ do WME');
    const href = await page.locator('#palcoDetalhe a[href*="waze.com/editor"]').getAttribute('href');
    checa(DECK_HOST.some((d) => href.includes('venues=' + encodeURIComponent(d.venueID))) && !/venues=demo-/.test(href) && /env=row/.test(href), 'o ↗ leva o id REAL do pedido (o sintético «demo-N» é do convidado)', href);
    await page.keyboard.press('Escape');
    checa(await page.locator('#palcoDetalhe').count() === 0, 'Esc fecha o detalhe');
    // «Sair» no app apaga a chave: o palco de OUTRA aba solta o controle na hora.
    const outra = await ctx.newPage();
    await outra.goto(BASE + '/palco', { waitUntil: 'domcontentloaded' });
    await outra.evaluate(() => localStorage.removeItem('waze_demo_palco'));
    await esperarOuExplodir(page, () => !!document.getElementById('palcoMsg') && /Preferências|Preferences/.test(document.getElementById('palcoMsg').textContent), 'o palco soltar o controle', 8000);
    checa(true, 'com a chave apagada («Sair» no app), o palco aberto solta o controle e some o resultado');
    const sobrou = await page.evaluate(() => document.body.innerText);
    checa(!/Pessoa1|Pessoa2/.test(sobrou), 'o palco não deixa nome de convidado na tela depois de perder a chave');
    checa(erros.length === 0, 'palco (fim): sem erro de página', erros.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // O palco cabe nos DOIS tamanhos de projetor nas QUATRO línguas, claro e escuro (o texto mais largo está noutra língua).
  for (const pr of PROJETORES.filter((x) => !process.env.SMOKE_DEMO_JANELA || x.nome.includes(process.env.SMOKE_DEMO_JANELA))) {
    for (const [lingua, escuro] of [['pt-BR', false], ['en-US', true], ['es-ES', false], ['fr-FR', true]]) {
      const sala = semear({ modo: 'sinc', tempoMs: 20000, total: DECK.length, referencia: true });
      const { ctx, page, erros } = await abrirPalco(pr, lingua, sala, { escuro });
      const achados = [];
      await esperarOuExplodir(page, () => !!document.getElementById('palcoQr'), 'o saguão', 20000);
      for (let n = 1; n <= 12; n++) await convidar(sala, n, 'Marina da Silva Gonçalves ' + n, ['Brasil', 'France', 'México', 'Reino Unido'][n % 4]);
      await esperarOuExplodir(page, () => document.querySelectorAll('#palcoNomes li').length >= 12, 'os 12 nomes');
      let c = await palcoCabe(page);
      if (c.rolaDeLado > 0 || c.rolaPraBaixo > 1 || c.ruins.length) achados.push('saguão: ' + JSON.stringify(c));
      await page.keyboard.press('Space');
      await esperarOuExplodir(page, () => !!document.querySelector('#palcoFoco [data-pedido]'), 'o pedido em foco', 20000);
      // O pior cartão: o de nome mais longo do baralho, aberto de verdade.
      for (let k = 0; k < 3; k++) { await votarComo(sala, 1 + k, 1, 'R'); }
      await palpitarComo(sala, 1, 1, 'R'); await palpitarComo(sala, 2, 1, 'L');
      await page.keyboard.press('Digit2');
      await esperarOuExplodir(page, () => /3\s*\/\s*12/.test(document.getElementById('palcoLado').textContent.replace(/\s+/g, ' ')), 'os votos');
      c = await palcoCabe(page);
      if (c.rolaDeLado > 0 || c.rolaPraBaixo > 1 || c.ruins.length) achados.push('jogo: ' + JSON.stringify(c));
      await page.keyboard.press('Space');
      await esperarOuExplodir(page, () => /\d+ · \d+%/.test(document.getElementById('palcoLado').textContent), 'a revelação');
      c = await palcoCabe(page);
      if (c.rolaDeLado > 0 || c.rolaPraBaixo > 1 || c.ruins.length) achados.push('revelado: ' + JSON.stringify(c));
      const tinta = await page.evaluate(() => { const b = document.querySelector('[data-acao="principal"]'); if (!b) return 'sem botão principal'; const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h && h.closest('[data-acao="principal"]') ? 'ok' : 'coberto'; });
      if (tinta !== 'ok') achados.push('o botão principal: ' + tinta);
      checa(achados.length === 0, `${pr.nome} · ${lingua}${escuro ? ' · escuro' : ''}: o palco cabe e o botão principal recebe o toque`, achados.slice(0, 3).join(' || '));
      checa(erros.length === 0, `${lingua}: palco sem erro de página`, erros.slice(0, 2).join(' | '));
      if (PRINTS && lingua === 'pt-BR') { mkdirSync(PRINTS, { recursive: true }); await page.screenshot({ path: join(PRINTS, `palco-${pr.viewport.width}-revelado.png`) }); }
      await ctx.close();
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CONTROLE do aviso do celular: num computador de tela larga o diálogo NÃO o diz, e o «criada» fala de abrir no computador que projeta.
if (rodar(9)) {
  const { ctx, page, erros } = await appComoApresentador({ viewport: { width: 1366, height: 768 } }, 'pt-BR', { userName: 'a', rank: 5, isAreaManager: true, isStaff: false, id: 4242 });
  await page.evaluate(() => abrirPerfil('filtersTabPrefs'));
  await page.evaluate(() => document.getElementById('prefDemoCriar').scrollIntoView({ block: 'center' }));
  await page.locator('#prefDemoCriar').click();
  await esperarOuExplodir(page, () => !document.getElementById('demoCriarModal').classList.contains('hidden'), 'o diálogo de criar (computador)');
  const dica = await page.evaluate(() => ({ rodape: document.getElementById('demoCriarRodape').textContent, soAqui: t('demo.criar.soAqui'), largo: computadorDeTelaLarga() }));
  checa(dica.largo === true, 'CONTROLE: 1366×768 de mouse é computador de tela larga');
  checa(!dica.rodape.includes(dica.soAqui), 'CONTROLE: no computador o diálogo de criar NÃO diz «só abre neste aparelho»');
  await page.locator('#demoCriarOk').click();
  await esperarOuExplodir(page, () => !document.getElementById('demoProntaModal').classList.contains('hidden'), 'o diálogo «criada» (computador)');
  const chave = await page.evaluate(() => document.querySelector('#demoProntaModal [data-i18n^="demo.pronta.aviso"]').getAttribute('data-i18n'));
  checa(chave === 'demo.pronta.aviso', 'CONTROLE: no computador o «criada» usa a frase de abrir no computador que projeta', chave);
  checa(erros.length === 0, 'computador: sem erro de página', erros.slice(0, 2).join(' | '));
  await ctx.close();
}

// O palco numa janela de CELULAR não mostra uma tela cortada: diz que é pra computador, e não vai à rede.
if (rodar(10)) {
  const sala = semear({ modo: 'sinc', tempoMs: 0, total: 3, referencia: false });
  for (const lingua of LINGUAS) {
    const { ctx, page, erros } = await abrirPalco({ viewport: { width: 393, height: 852 } }, lingua, sala);
    const pedidos = [];
    page.on('request', (r) => { if (/\/api\//.test(r.url())) pedidos.push(r.url()); });
    await esperarOuExplodir(page, () => !!document.getElementById('palcoMsg'), 'a mensagem do palco estreito');
    const m = await page.evaluate(() => ({ msg: document.getElementById('palcoMsg').textContent, h1: document.querySelector('#palcoRaiz h1').textContent, esperado: t('palco.estreita'), titulo: t('palco.estreita.titulo'), rola: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    checa(m.msg === m.esperado && m.h1 === m.titulo, `${lingua}: o palco numa janela de celular diz que é pra computador`, JSON.stringify(m));
    checa(m.rola <= 0, `${lingua}: a mensagem do palco estreito cabe sem rolar de lado`, String(m.rola));
    checa(pedidos.length === 0, `${lingua}: o palco estreito não vai à rede`, pedidos.join(','));
    checa(erros.length === 0, `${lingua}: palco estreito sem erro de página`, erros.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

await browser.close();
await derrubar();
await new Promise((r) => setTimeout(r, 300));
rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
console.log(falhas ? `\n✗ ${falhas} falha(s)` : '\n✓ smoke da demo: tudo passou');
process.exit(falhas ? 1 : 0);
