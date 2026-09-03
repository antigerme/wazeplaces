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
//   · a fonte Inter é binária e o diagnóstico a lê como texto, então a
//     renderização usa a fonte do sistema: o texto pode medir um pouco diferente.
//
// A página é montada SEM JAVASCRIPT e SEM REDE de propósito: o DOM capturado já
// é o resultado; re-executar scripts mudaria o instante que se quer olhar.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const arquivo = process.argv[2];
const saida = process.argv[3] || '/tmp/diag-tela';
if (!arquivo) {
  console.error('uso: node tools/diag-tela.mjs <arquivo.json> [pasta-de-saida]');
  process.exit(2);
}
const d = JSON.parse(readFileSync(arquivo, 'utf8'));
mkdirSync(saida, { recursive: true });

// Os dois formatos convivem: o primeiro diagnóstico guardava UM `dom`; o do FAB
// guarda N `momentos`. Ler os dois evita que arquivo antigo vire inútil.
const momentos = Array.isArray(d.momentos) && d.momentos.length
  ? d.momentos
  : (d.dom ? [{ t: d._gerado, motivo: 'arquivo v1', dom: d.dom,
                imagens: [], canvas: [], modais: [], painel: '?' }] : []);
if (!momentos.length) {
  console.error('o arquivo não tem nem `momentos` nem `dom` — nada pra remontar');
  process.exit(1);
}

const codigo = d.codigo || {};
const css = Object.entries(codigo)
  .filter(([u, v]) => /\.css($|\?)/.test(u) && v && typeof v.corpo === 'string')
  .map(([, v]) => v.corpo).join('\n');
if (!css) console.warn('aviso: nenhum CSS no arquivo — a tela sai sem estilo');

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
  const marca = `
    /* Substitutos: o que NÃO pôde ser remontado fica VISÍVEL, nunca em branco —
       espaço vazio se confunde com "estava vazio pra ele". */
    img { background: repeating-linear-gradient(45deg,#33415533,#33415533 6px,#1e293b33 6px,#1e293b33 12px);
          outline: 1px dashed #64748b; outline-offset: -1px; }
    img[data-diag-quebrada] { outline-color: #fb7185; }
    #devFab { outline: 2px dashed #a855f7; }
  `;
  html = html.replace(/<\/head>/i, `<style>${css}</style><style>${marca}</style></head>`);
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
    return `<div class="${cls}" style="outline:2px dashed #fbbf24;min-height:80px"`
         + ` title="canvas não capturado: ${cv.erro || '?'}"></div>`;
  });
  return html;
}

const browser = await chromium.launch();
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
    process.exit(1);
  }
  writeFileSync(tmp, pronto);
  await page.goto('file://' + tmp, { waitUntil: 'load' });

  const nome = `momento-${String(i + 1).padStart(2, '0')}.png`;
  await page.screenshot({ path: join(saida, nome), fullPage: false });
  await ctx.close();
  linhas.push({
    arquivo: nome, quando: m.t, motivo: m.motivo, painel: m.painel,
    modais: (m.modais || []).join(',') || '—',
    toasts: (m.toastsNaTela || []).length,
    imagensQuebradas: (m.imagens || []).filter((x) => x.quebrada).length,
  });
}
await browser.close();

const resumo = {
  de: basename(arquivo),
  versaoDaApp: (d.app && d.app.rotulo) || null,
  janela, dpr, tema: (d.ambiente && d.ambiente.escuro) ? 'escuro' : 'claro',
  cssBytes: css.length,
  momentos: linhas,
  // O que a remontagem NÃO consegue — dito aqui pra ninguém ler a imagem como
  // se fosse foto.
  ressalvas: [
    'imagem de outra origem não carrega: moldura tracejada (rosa = o aparelho disse que estava quebrada)',
    'canvas sem dataURL fica com moldura âmbar — o navegador recusou por origem cruzada',
    'fonte do sistema no lugar da Inter: o texto pode medir um pouco diferente',
    'sem JavaScript e sem rede de propósito — o DOM capturado já é o resultado',
  ],
};
writeFileSync(join(saida, 'resumo.json'), JSON.stringify(resumo, null, 1));
console.log(`${linhas.length} momento(s) remontado(s) em ${saida}`);
for (const l of linhas) {
  console.log(`  ${l.arquivo}  ${l.motivo}  painel=${l.painel}  modais=${l.modais}`
    + `  toasts=${l.toasts}  imgsQuebradas=${l.imagensQuebradas}`);
}
