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
    // Marca o claro EXPLICITAMENTE pra a media query do styles.css saber que
    // não deve pintar escuro (ver o comentário lá). Sem isto, quem escolheu
    // claro num sistema escuro veria fundo escuro por baixo de uma app clara.
    else document.documentElement.classList.add('tema-claro');
    // As duas metas com `media` já acertam quando o tema SEGUE o sistema.
    // Só há o que corrigir quando a pessoa ESCOLHEU o contrário do sistema —
    // e aí as metas por esquema têm que sair, senão a do sistema volta a valer
    // (o navegador escolhe pela media query, não pela ordem).
    var escolheu = (t === 'light' || t === 'dark') && localStorage.getItem('waze_places_theme') === t;
    var sistema = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (escolheu && t !== sistema) {
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].parentNode.removeChild(metas[i]);
      var nova = document.createElement('meta');
      nova.setAttribute('name', 'theme-color');
      nova.setAttribute('content', t === 'dark' ? '#0f172a' : '#f8fafc');
      document.head.appendChild(nova);
    }
  } catch (e) {}
})();
