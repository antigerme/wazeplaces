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
