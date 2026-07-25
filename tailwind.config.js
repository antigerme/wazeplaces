/** Config do Tailwind usada SÓ na geração do css/tailwind.css (npm run css).
 *  Não é carregada em runtime — a app serve o CSS já compilado.
 *
 *  IMPORTANTE: o vendor bundle antigo (js/tailwindcss_*.js) NÃO pode entrar no
 *  content — ele contém o dicionário inteiro de classes do Tailwind e faria o
 *  scanner gerar ~3MB de CSS morto.
 */
module.exports = {
  darkMode: 'class', // .dark no <html> (o mesmo que o bundle runtime usava)
  content: [
    './index.html',
    './js/app.js',
    './js/api.js',
    './js/swipe.js',
    './js/i18n.js',
    './js/version.js',
  ],
  theme: { extend: {} },
  plugins: [],
};

// Curiosidade que já custou um CI vermelho: o scanner do Tailwind extrai
// palavras de QUALQUER texto dos arquivos de content — inclusive de dentro de
// atributos e comentários. O host `static.cloudflareinsights.com` na CSP faz
// aparecer um `.static{position:static}` no CSS gerado. São 24 bytes mortos e
// inevitáveis enquanto o host estiver liberado. NÃO use `blocklist` pra tirar:
// viraria armadilha silenciosa no dia em que alguém usar `class="static"`.
