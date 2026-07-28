// Aplica o tema ANTES do first paint. Era um <script> inline; saiu daqui pra
// que a CSP possa proibir script inline (`script-src` sem 'unsafe-inline'), que
// é o que impede um script injetado de ler o sessionToken do localStorage.
//
// Carregado SEM defer/async e DEPOIS dos <link rel=stylesheet>: o paint já
// espera o CSS, então o browser busca os dois em paralelo e este arquivo não
// atrasa nada. Medido — ver a seção do flash de tema no CLAUDE.md.
// Aplica o tema ANTES do first paint: evita flash de tela clara + status bar
// cyan em quem usa dark (o app.js só roda no DOMContentLoaded, tarde demais).
(function () {
  try {
    var t = localStorage.getItem('waze_places_theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (t === 'dark') document.documentElement.classList.add('dark');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#0f172a' : '#f8fafc');
  } catch (e) {}
})();
