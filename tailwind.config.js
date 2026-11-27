/** Config do Tailwind usada SÓ na geração do css/app.css (npm run css).
 *  Não é carregada em runtime — o app serve o CSS já compilado.
 *
 *  IMPORTANTE: o vendor bundle antigo (js/tailwindcss_*.js) NÃO pode entrar no
 *  content — ele contém o dicionário inteiro de classes do Tailwind e faria o
 *  scanner gerar ~3MB de CSS morto.
 */
module.exports = {
  darkMode: 'class', // .dark no <html> (o mesmo que o bundle runtime usava)
  content: [
    './index.src.html',   // o FONTE — varrer o gerado criaria dependência de ordem
    './status.src.html',  // idem, pro /status.html
    './demo.src.html',    // idem, pro /demo.html (a página do convidado da demo)
    './palco.src.html',   // idem, pro /palco.html (a tela do apresentador)
    './js/app.js',
    './js/api.js',
    './js/swipe.js',
    './js/i18n.js',
    './js/version.js',
    './js/status.js',
    './js/demo.js',
    './js/palco.js',
  ],
  theme: {
    extend: {
      // O palco (/palco) em janela baixa ou estreita: o laptop com a barra do navegador (~650 de altura) e o espelhamento
      // de projetor em 1280×720 ou 1024×768. A 1366×768 inteira não compacta (o que cabe a 1× não muda um pixel).
      screens: { 'palco-baixo': { raw: '(max-height: 740px), (max-width: 1100px)' } },
    },
  },
  plugins: [],
};

// Curiosidade que já custou um CI vermelho: o scanner do Tailwind extrai
// palavras de QUALQUER texto dos arquivos de content — inclusive de dentro de
// atributos e comentários. O host `static.cloudflareinsights.com` na CSP faz
// aparecer um `.static{position:static}` no CSS gerado. São 24 bytes mortos e
// inevitáveis enquanto o host estiver liberado. Idem o `c.blur()` do palco, que gera `.blur` e `.filter`. NÃO use `blocklist` pra tirar:
// viraria armadilha silenciosa no dia em que alguém usar `class="static"`.
