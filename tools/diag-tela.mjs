// Remonta a TELA a partir de um diagnóstico do modo dev.
//
//   node tools/diag-tela.mjs <arquivo.json> [pasta-de-saida]
//
// POR QUE ISTO EXISTE, e por que não é um screenshot: página web não fotografa
// os próprios pixels no Android — `getDisplayMedia` não existe lá, biblioteca
// de canvas é dependência que este projeto não tem e ainda esbarra na CSP, e
// `foreignObject` quebra em imagem de outra origem e em fonte. Mas o
// diagnóstico já carrega o DOM, o CSS inteiro e o viewport exato: com essas três
// peças a tela se remonta, e o que sai é o que a pessoa via.
//
// MEDIDO no arquivo real do owner: DOM de 187 KB, `app.css` de 71 KB, janela
// 411×841 a 2,625×. Deu pra ler direto do JSON que o painel de erro estava
// visível e o placar em 801·905·18·0 — a imagem só torna isso imediato.
//
// O QUE NÃO SAI FIEL, e cada linha está no rodapé da imagem em vez de escondida:
//   · imagem de outra origem (foto do Waze) não carrega aqui — vira moldura
//     tracejada com a marca de QUEBRADA quando o aparelho disse que ela estava;
//   · pixel de canvas não vive no DOM — usa o `dataURL` do momento quando ele
//     existe, e diz "origem cruzada" quando o navegador se recusou a dá-lo;
//   · a fonte vem do REPOSITÓRIO (o diagnóstico não a traz): quando ela não
//     carrega na remontagem, o rodapé diz, e o texto pode medir diferente.
//
// A página é montada SEM JAVASCRIPT e SEM REDE de propósito: o DOM capturado já
// é o resultado; re-executar scripts mudaria o instante que se quer olhar.
import { carregarPlaywright, abrirChromium } from './navegador.mjs';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { lerDiagnostico } from './diag-ler.mjs';
import { basename, join } from 'node:path';

// `--cru` tira as MARCAS da ferramenta (hachura na imagem que faltou, moldura no
// canvas e no FAB). Elas existem porque espaço vazio se confunde com "estava
// vazio pra ele" — mas são anotação do instrumento, não desenho do app. O
// `tools/smoke-diag-tela.mjs` compara a remontagem com a tela ao vivo pixel a
// pixel, e com as marcas ligadas ele mediria a anotação: medido, elas sozinhas
// respondem por ~6 pontos percentuais num card com foto.
const cru = process.argv.includes('--cru');
const args = process.argv.slice(2).filter((a) => a !== '--cru');
const arquivo = args[0];
const saida = args[1] || '/tmp/diag-tela';
if (!arquivo) {
  console.error('uso: node tools/diag-tela.mjs <arquivo.json> [pasta-de-saida]');
  process.exit(2);
}
// Aceita `.zip` (o formato de hoje) e `.json` cru (relato antigo, ou
// navegador sem CompressionStream). Farejado pelos bytes, não pela extensão.
const { dados: d, origem: _origemDoDiag } = lerDiagnostico(arquivo);
mkdirSync(saida, { recursive: true });

// Os dois formatos convivem: o primeiro diagnóstico guardava UM `dom`; o do FAB
// guarda N `momentos`. Ler os dois evita que arquivo antigo vire inútil.
//
// Relatório SEM captura (a pessoa baixou sem tocar no botão) remonta o `dom` da
// hora de baixar — e o rótulo dizia "arquivo v1 · painel=?" num v10, como se o
// relatório fosse do primeiro formato e ninguém soubesse o que estava na tela
// (auditoria de 2026-09-26). A versão é a DELE, e o painel e os modais são os
// que o próprio relatório mediu (`resumo.telaAgora`).
function momentosDoRelatorio(d) {
  if (Array.isArray(d.momentos) && d.momentos.length) return d.momentos;
  if (!d.dom) return [];
  const ta = (d.resumo && d.resumo.telaAgora) || {};
  return [{ t: d._gerado, motivo: `relatório v${d._versaoDoDiag ?? '?'}, sem captura (a tela na hora de baixar)`,
            dom: d.dom, imagens: [], canvas: [], modais: Array.isArray(ta.modais) ? ta.modais : [],
            painel: ta.painel || '?' }];
}
const atuais = momentosDoRelatorio(d);
// E as capturas das ABERTURAS ANTERIORES (o app fechado e reaberto com o modo
// dev ligado): são justamente as do defeito que atravessa um fechar e reabrir,
// e ficavam de fora da remontagem (auditoria de 2026-09-25). Vão primeiro, na
// ordem em que aconteceram, com a abertura no rótulo.
const anteriores = (Array.isArray(d.aberturasAnteriores) ? d.aberturasAnteriores : [])
  .flatMap((a, ia) => (Array.isArray(a && a.momentos) ? a.momentos : [])
    .filter((m) => m && m.dom)
    .map((m) => ({ ...m, motivo: `[abertura ${(a && a.id) || ia + 1}] ` + (m.motivo || '') })));
const momentos = [...anteriores, ...atuais];
if (!momentos.length) {
  console.error('o arquivo não tem nem `momentos` nem `dom` — nada pra remontar');
  process.exit(1);
}

const codigo = d.codigo || {};
const cssDoAparelho = Object.entries(codigo)
  .filter(([u, v]) => /\.css($|\?)/.test(u) && v && typeof v.corpo === 'string')
  .map(([, v]) => v.corpo).join('\n');
if (!cssDoAparelho) console.warn('aviso: nenhum CSS no arquivo — a tela sai sem estilo');

// A FONTE vem do repositório, não do diagnóstico. O diagnóstico lê todo recurso
// como TEXTO (é o que serve pro HTML/JS/CSS), e um `.woff2` lido assim chega
// corrompido — a remontagem caía na fonte do sistema e o texto media diferente,
// o que arruína qualquer comparação com a tela de verdade. A fonte é ARQUIVO DO
// PROJETO: casar pelo nome e embutir em base64 devolve a métrica exata.
//
// E ela entra NO LUGAR do `url(…)` da PRÓPRIA `@font-face` do app, que vem no
// CSS do aparelho: a família, o peso e o `unicode-range` são os que o app
// declara. Até a auditoria de 2026-09-26 a ferramenta registrava a fonte com um
// nome INVENTADO ("Inter var", 100–900), que o CSS do app (`Inter`, 300–700)
// nunca pede — a face embutida ficava `unloaded`, a remontagem saía na fonte do
// sistema, e `fontesEmbutidas` afirmava o contrário. Registrar pela regra do app
// é o que faz a família nunca mais divergir: se o app trocar o nome, a
// remontagem segue.
//
// Só casa por NOME DE ARQUIVO dentro de `fonts/` deste repositório: nada é
// buscado na rede, e diagnóstico de outro app simplesmente não encontra par.
function embutirFontes(css, lerFonte) {
  const fontes = [];
  const novo = String(css).replace(/url\(\s*(['"]?)([^'")]*\/fonts\/([\w.-]+\.woff2?))\1\s*\)/g, (tudo, _aspas, url, nome) => {
    const b64 = lerFonte(nome);
    if (!b64) return tudo;
    if (!fontes.some((f) => f.nome === nome)) fontes.push({ nome, url, b64Bytes: b64.length });
    return `url(data:font/woff2;base64,${b64})`;
  });
  return { css: novo, fontes };
}
const { css, fontes } = embutirFontes(cssDoAparelho, (nome) => {
  const local = new URL('../fonts/' + nome, import.meta.url);
  return existsSync(local) ? readFileSync(local).toString('base64') : null;
});

const janela = (d.ambiente && d.ambiente.tela && d.ambiente.tela.janela) || '390x844';
const [W, H] = janela.split('x').map((n) => parseInt(n, 10) || 0);
const dpr = (d.ambiente && d.ambiente.tela && d.ambiente.tela.dpr) || 2;

// Prepara o HTML: fora os scripts (o DOM já é o resultado; re-executar mudaria
// o instante), fora os <link> de estilo (o CSS entra inline, e a rede está
// cortada), e a foto de fora vira moldura visível em vez de ícone de quebrado.
function preparar(m) {
  let html = m.dom;
  // COMENTÁRIO SAI PRIMEIRO, e a ordem é o conserto de um defeito que produziu
  // uma imagem inteira ERRADA: o `index.html` deste projeto é fortemente
  // comentado, e um dos comentários CITA `<script ...>` como texto. O regex de
  // remover script casava com essa citação e comia tudo até o `</script>`
  // seguinte — junto com o `-->` que fechava o comentário. O documento ficava
  // com um comentário ABERTO, o `<style>` era injetado DENTRO dele, e o
  // navegador descartava a folha inteira: a remontagem saía sem estilo nenhum,
  // parecendo outra tela. Zero erro, zero aviso — só a imagem mentindo.
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, '');
  const quebradas = new Set((m.imagens || []).filter((i) => i.quebrada).map((i) => i.src));
  const marca = cru ? '' : `
    /* Substitutos: o que NÃO pôde ser remontado fica VISÍVEL, nunca em branco —
       espaço vazio se confunde com "estava vazio pra ele". */
    img { background: repeating-linear-gradient(45deg,#33415533,#33415533 6px,#1e293b33 6px,#1e293b33 12px);
          outline: 1px dashed #64748b; outline-offset: -1px; }
    img[data-diag-quebrada] { outline-color: #fb7185; }
    #devFab { outline: 2px dashed #a855f7; }
  `;
  // ANIMAÇÃO VAI PRO FIM. O DOM capturado não guarda progresso de animação: ao
  // recarregar, toda `animation`/`transition` recomeça do quadro ZERO. MEDIDO
  // comparando com a tela ao vivo: o toast, que já tinha terminado de entrar,
  // remontava mais baixo e semitransparente — 69% de diferença na faixa de
  // baixo da imagem, só por isso. Vale pra tudo que anima: selo do swipe, barra
  // do Desfazer, confete do "Tudo limpo!".
  //
  // `duration: 0s` + `fill-mode: forwards` salta pro ÚLTIMO quadro, que é o
  // estado assentado — o mais próximo da verdade que um instantâneo permite.
  const semAnimacao = `*, *::before, *::after {
    animation-duration: 0s !important; animation-delay: 0s !important;
    animation-fill-mode: forwards !important; animation-iteration-count: 1 !important;
    transition-duration: 0s !important; transition-delay: 0s !important;
  }`;
  html = html.replace(/<\/head>/i,
    `<style>${css}</style><style>${semAnimacao}</style><style>${marca}</style></head>`);
  for (const src of quebradas) {
    html = html.split(src).join(src + '" data-diag-quebrada="1');
  }
  // O canvas vira `<img>` AQUI, no texto, e não por `page.evaluate`: a página é
  // renderizada com o JavaScript DESLIGADO (o DOM capturado já é o resultado —
  // re-executar script mudaria o instante que se quer olhar), e sem JS não há
  // evaluate. Pixel de canvas não vive no DOM; o `dataURL` do momento é a única
  // via, e quando o navegador o recusou por origem cruzada fica a moldura âmbar
  // dizendo isso — em vez de um retângulo branco que ninguém sabe interpretar.
  let iCanvas = 0;
  html = html.replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, (tag) => {
    const cv = (m.canvas || [])[iCanvas++] || {};
    const cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
    if (cv.url) return `<img class="${cls}" src="${cv.url}" alt="canvas">`;
    return `<div class="${cls}" style="${cru ? '' : 'outline:2px dashed #fbbf24;'}min-height:80px"`
         + ` title="canvas não capturado: ${cv.erro || '?'}"></div>`;
  });
  return html;
}

const browser = await abrirChromium(await carregarPlaywright());
const linhas = [];
for (let i = 0; i < momentos.length; i++) {
  const m = momentos[i];
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: Math.min(3, dpr),
    colorScheme: (d.ambiente && d.ambiente.escuro) ? 'dark' : 'light',
    javaScriptEnabled: false,
  });
  // SEM REDE: só `file:` (a própria página) e `data:` (o canvas embutido)
  // passam. Sem isto, um recurso que carregasse AQUI e não no aparelho dele
  // produziria uma imagem que ninguém viu — instrumento mentindo, que é o erro
  // que este projeto mais paga.
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    return (u.startsWith('data:') || u.startsWith('file:')) ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  // `goto` num arquivo, e NÃO `setContent`: o `setContent` do Playwright precisa
  // de JavaScript pra montar o documento, e com o JS desligado ele entregava a
  // página SEM as folhas de estilo injetadas — a remontagem saía sem estilo
  // nenhum e parecendo a tela errada. Navegar de verdade faz o parser do
  // navegador ler o documento inteiro, `<style>` incluído.
  const tmp = join(saida, `.momento-${i + 1}.html`);
  const pronto = preparar(m);
  // AUTOCONFERÊNCIA antes de renderizar: o estilo tem que estar num ponto que o
  // parser vá ler. Comentário desbalanceado antes dele é exatamente o que já
  // produziu uma imagem sem estilo — e imagem errada é pior que imagem nenhuma,
  // porque ninguém desconfia dela.
  const ate = pronto.indexOf('<style>');
  const abertos = (pronto.slice(0, ate).match(/<!--/g) || []).length;
  const fechados = (pronto.slice(0, ate).match(/-->/g) || []).length;
  if (ate === -1 || abertos !== fechados) {
    console.error(`momento ${i + 1}: o CSS não chegou a um ponto renderizável`
      + ` (style em ${ate}, comentários ${abertos} abertos × ${fechados} fechados).`
      + ' A imagem sairia sem estilo — abortando em vez de entregar tela errada.');
    // Fecha o navegador antes de sair: `process.exit` no meio do laço deixava um
    // Chromium órfão por execução, e ninguém repara até a máquina ficar cheia.
    await ctx.close();
    await browser.close();
    process.exit(1);
  }
  writeFileSync(tmp, pronto);
  await page.goto('file://' + tmp, { waitUntil: 'load' });
  // A FONTE CARREGOU? Medido na página, e não deduzido da lista acima: o
  // `evaluate` roda mesmo com o JavaScript da página desligado. É a família que
  // o CSS do app pede pro corpo (`Inter`), e esperar as fontes antes do print
  // tira a corrida entre a troca de fonte (`font-display: swap`) e a imagem.
  const fonte = await page.evaluate(async () => {
    try {
      await document.fonts.ready;
      const familia = getComputedStyle(document.body).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      return { familia, carregou: document.fonts.check(`16px "${familia}"`) };
    } catch (e) { return { erro: String(e && e.message).slice(0, 80) }; }
  });

  const nome = `momento-${String(i + 1).padStart(2, '0')}.png`;
  await page.screenshot({ path: join(saida, nome), fullPage: false });
  await ctx.close();
  linhas.push({
    arquivo: nome, quando: m.t, motivo: m.motivo, painel: m.painel,
    modais: (m.modais || []).join(',') || '—',
    toasts: (m.toastsNaTela || []).length,
    imagensQuebradas: (m.imagens || []).filter((x) => x.quebrada).length,
    fonte: fonte && fonte.familia ? `${fonte.familia}${fonte.carregou ? '' : ' (NÃO carregou)'}` : '?',
  });
}
await browser.close();

// As SENTINELAS vêm antes de tudo. Quem roda esta ferramenta está procurando o
// que está errado; se o app já sabe, ele diz aqui, e não numa linha perdida de
// 1 MB de JSON.
const alertas = (d.resumo && d.resumo.alertas) || [];

const resumo = {
  de: basename(arquivo),
  versaoDaApp: (d.app && d.app.rotulo) || null,
  alertas,
  janela, dpr, tema: (d.ambiente && d.ambiente.escuro) ? 'escuro' : 'claro',
  cssBytes: cssDoAparelho.length,
  // Embutidas NA `@font-face` do app — e se a família CARREGOU em cada
  // momento está em `momentos[].fonte`, medido na página remontada.
  fontesEmbutidas: fontes.map((f) => f.nome),
  momentos: linhas,
  // O que a remontagem NÃO consegue — dito aqui pra ninguém ler a imagem como
  // se fosse foto. A da fonte só entra quando ela NÃO carregou: ela estava
  // sempre aqui, inclusive quando o rodapé devia dizer o contrário.
  ressalvas: [
    'imagem de outra origem não carrega: moldura tracejada (rosa = o aparelho disse que estava quebrada)',
    'canvas sem dataURL fica com moldura âmbar — o navegador recusou por origem cruzada',
    ...(linhas.some((l) => / \(NÃO carregou\)$|^\?$/.test(l.fonte))
      ? ['a fonte do app NÃO carregou em algum momento (ver `momentos[].fonte`): ali o texto sai na fonte do sistema e pode medir diferente']
      : []),
    'sem JavaScript e sem rede de propósito — o DOM capturado já é o resultado',
  ],
};
writeFileSync(join(saida, 'resumo.json'), JSON.stringify(resumo, null, 1));
if (alertas.length) {
  console.log(`\n⚠ ${alertas.length} alerta(s) do app — invariante conhecida quebrada NO APARELHO:`);
  for (const al of alertas) {
    const extra = Object.entries(al).filter(([k]) => k !== 'chave' && k !== 'msg')
      .map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`  · [${al.chave}] ${al.msg}${extra ? '  (' + extra + ')' : ''}`);
  }
  console.log('');
}
console.log(`${linhas.length} momento(s) remontado(s) em ${saida}   (lido de ${_origemDoDiag})`);
for (const l of linhas) {
  console.log(`  ${l.arquivo}  ${l.motivo}  painel=${l.painel}  modais=${l.modais}`
    + `  toasts=${l.toasts}  imgsQuebradas=${l.imagensQuebradas}  fonte=${l.fonte}`);
}
