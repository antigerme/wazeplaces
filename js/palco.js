// js/palco.js — o PALCO da demo (/palco): a tela do apresentador, feita pra ser projetada.
//
// Uma página própria, e não uma camada do app (ver o cabeçalho do palco.src.html): o app só CRIA a demo e
// guarda a chave (`waze_demo_palco`); aqui se conduz. O que a sala decide é do SERVIDOR (server/demo-sala*.mjs):
// o palco manda ações (`demo-host`) e desenha a visão que o servidor devolve (SSE, o mesmo leitor da página do
// convidado). Nada daqui fala com o Waze, e a chave nunca vai pra tela nem pra URL.
//
// Três regras de verdade que moram no desenho:
//   • a TELA É PROJETADA — o voto de referência do apresentador só aparece como «registrado» até o pedido ser
//     revelado (o servidor já manda `*`), e no modo livre a divisão dos votos só sai quando a demo acaba;
//   • cada número vem do servidor (`analise`: unânime/dividido, prêmios, países, projeção), e aqui só se desenha;
//   • tudo que o convidado escreveu (apelido, país) passa por `esc()` — é texto de terceiro numa tela de projetor.
//
// Script clássico em IIFE; as funções puras saem em `window.PalcoPuro` (testadas sem navegador).
(function () {
  'use strict';

  const CHAVE_DO_PALCO = 'waze_demo_palco';   // a MESMA que o app grava (test/palco-pagina.test.mjs confere)
  const COORD_CASAS = 5;                       // espelha o COORD_CASAS do app.js (o ↗ do pedido)
  const WME_EDITOR_URL = 'https://www.waze.com/editor';
  const RECADO_MAX = 60;                       // espelha SALA_RECADO_MAX
  const PASSO_MIN_MS = 700;                    // entre duas ações principais: o Espaço duplo não pula uma revelação
  const AVANCO_TOPO = 12;                      // quantos aparecem na lista de avanço do modo livre
  const SIMBOLO = { R: '✕', L: '✓', P: '↑' };
  const NOME_VOTO = { R: 'card.stamp.reject', L: 'card.stamp.read', P: 'card.stamp.skip' };

  // ═════════════════════════════ funções puras ═════════════════════════════

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // O código curto, no formato que o convidado digita («K7Q-2M9»): a MESMA conta do campo da página /demo.
  function formatarCodigo(bruto) {
    const s = String(bruto == null ? '' : bruto).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    return s.length > 3 ? s.slice(0, 3) + '-' + s.slice(3) : s;
  }

  // O voto mais escolhido, ou null se não há voto ou há empate no topo (o MESMO critério do servidor).
  function maioriaDe(c) {
    if (!c) return null;
    const max = Math.max(c.R || 0, c.L || 0, c.P || 0);
    if (!max) return null;
    const topo = ['R', 'P', 'L'].filter((k) => (c[k] || 0) === max);
    return topo.length === 1 ? topo[0] : null;
  }

  const pct = (c, k) => { const n = (c.R || 0) + (c.L || 0) + (c.P || 0); return n ? Math.round((c[k] || 0) * 100 / n) : 0; };

  // «4 min 12 s» · «1 h 10 min» · «9 s» — as partes, e quem desenha escolhe a frase (em cada língua).
  function partesDaDuracao(ms) {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return { h, m, s: 0, forma: 'hm' };
    if (m > 0) return { h: 0, m, s, forma: 'ms' };
    return { h: 0, m: 0, s, forma: 's' };
  }

  // A ordem da lista de pedidos do resultado: a da demo, os mais unânimes ou os mais divididos primeiro (o
  // desempate é sempre o número do pedido, pra a lista não pular a cada recarga).
  function ordenarPedidos(lista, modo) {
    const itens = lista.map((p, i) => ({ ...p, idx: p.idx || i + 1 }));
    if (modo === 'unanimes') itens.sort((a, b) => (b.topo || 0) - (a.topo || 0) || (b.n || 0) - (a.n || 0) || a.idx - b.idx);
    else if (modo === 'divididos') itens.sort((a, b) => (a.topo === undefined ? 1 : a.topo) - (b.topo === undefined ? 1 : b.topo) || (b.n || 0) - (a.n || 0) || a.idx - b.idx);
    else itens.sort((a, b) => a.idx - b.idx);
    return itens;
  }

  // Quem aparece na lista de avanço (modo livre): os mais adiantados, e «e outros N».
  function listaDeAvanco(pessoas, topo) {
    const ordenadas = [...pessoas].sort((a, b) => (b.feitos || 0) - (a.feitos || 0));
    return { vistas: ordenadas.slice(0, topo), outros: Math.max(0, ordenadas.length - topo) };
  }

  // O ↗ do pedido no WME: o MESMO permalink do app (`linkWmeDoPedido`), com o id real que só o apresentador tem.
  function linkDoWme(pedido, ids, regiao) {
    const env = regiao === 'na' ? 'usa' : (regiao || 'row');
    const params = ['env=' + env];
    if (Number.isFinite(pedido.lat) && Number.isFinite(pedido.lon)) {
      params.push('lat=' + Number(pedido.lat.toFixed(COORD_CASAS)), 'lon=' + Number(pedido.lon.toFixed(COORD_CASAS)), 'zoomLevel=22');
    }
    if (ids && ids.venueID) {
      const id = encodeURIComponent(ids.venueID);
      params.push('venues=' + id, 'venueUpdateRequest=' + id, 'tab=feature_editor');
    }
    return WME_EDITOR_URL + '?' + params.join('&');
  }

  // Qual TELA a visão pede. Uma função só, pura.
  function telaDaVisao(v, estado) {
    if (estado === 'semChave') return 'semChave';
    if (estado === 'erro') return 'erro';
    if (!v) return 'abrindo';
    if (v.fase === 'saguao') return 'saguao';
    if (v.fase === 'contagem') return 'contagem';
    if (v.fase === 'encerrada') return 'fim';
    return v.modo === 'sinc' ? 'sinc' : 'livre';
  }

  // A AÇÃO PRINCIPAL (Espaço e →): começar, revelar, próximo, retomar. No modo livre não há — encerrar tem
  // confirmação, e uma tecla não confirma nada. Devolve `{ tipo, ultimo }` ou null.
  function acaoPrincipal(v) {
    if (!v) return null;
    if (v.fase === 'saguao') return v.naSala >= 1 ? { tipo: 'comecar' } : null;
    if (v.fase === 'pausada') return { tipo: 'retomar' };
    if (v.fase === 'andamento' && v.modo === 'sinc') {
      return v.revelado ? { tipo: 'proximo', ultimo: v.atual >= v.total } : { tipo: 'revelar' };
    }
    return null;
  }

  // O que a tecla `key` faz com a visão `v` (o dono do teclado é quem chama; aqui só a tabela).
  function acaoDaTecla(key, v) {
    const k = String(key || '');
    // PageDown: o passador de slides (clicker) manda PageDown/PageUp, não → nem Espaço. PageUp fica sem função (não há voltar).
    if (k === ' ' || k === 'ArrowRight' || k === 'Enter' || k === 'PageDown') return acaoPrincipal(v);
    if (k === 'p' || k === 'P') {
      if (v && v.fase === 'andamento') return { tipo: 'pausar' };
      if (v && v.fase === 'pausada') return { tipo: 'retomar' };
      return null;
    }
    if (k === 'r' || k === 'R') return v && v.fase !== 'encerrada' ? { tipo: 'recado' } : null;
    if (k === '1' || k === '2' || k === '3') return { tipo: 'votarRef', voto: { 1: 'R', 2: 'P', 3: 'L' }[k] };
    return null;
  }

  // A referência no pedido `idx`: '-' (não votou), '*' (votou, escondido) ou o voto (revelado).
  const refNoPedido = (v, idx) => (v && typeof v.ref === 'string' && v.ref[idx - 1]) || '-';

  // Ctrl, ⌘ ou Alt com uma tecla é do NAVEGADOR (Alt+← é «voltar»): a mesma regra do app, copiada porque as
  // páginas não compartilham escopo — e travada IGUAL à do app.js em test/atalhos-do-navegador.test.mjs.
  function atalhoDoNavegador(e) {
    return !!(e && (e.ctrlKey || e.metaKey || e.altKey));
  }

  window.PalcoPuro = {
    esc, formatarCodigo, maioriaDe, pct, partesDaDuracao, ordenarPedidos, listaDeAvanco, linkDoWme, telaDaVisao, acaoPrincipal,
    acaoDaTecla, refNoPedido, atalhoDoNavegador, CHAVE_DO_PALCO, COORD_CASAS, RECADO_MAX, AVANCO_TOPO,
  };

  // Em Node (um teste que carrega só as funções puras) não há página.
  if (typeof document === 'undefined') return;

  // ═════════════════════════════ a página ═════════════════════════════

  const $ = (id) => document.getElementById(id);
  const P = {
    chave: null,            // { demo, segredo, hostKey, expiraEm }
    cfg: null,
    deck: [],               // os pedidos como o CONVIDADO os recebe (a mesma ordem)
    ids: [],                // os ids reais, só do apresentador (o ↗)
    regiao: 'row',
    visao: null,
    seq: -1,
    desvio: 0,
    estado: 'abrindo',      // 'abrindo' | 'ok' | 'erro' | 'semChave'
    erroTexto: '',
    telaMontada: null,
    resultado: null,        // o resultado inteiro (só depois de encerrada)
    aba: 'pedidos',
    ordem: 'ordem',
    detalhe: null,          // o pedido aberto em detalhe (idx) ou null
    recadoAberto: false,
    confirmandoEncerrar: false,
    codigo: null,           // { texto, ate } — o código curto, só sob demanda
    ultimoPasso: 0,
    timers: { relogio: null, confirma: null, aviso: null },
    perdeu: false,          // a chave foi apagada (Sair no app): o palco solta o controle
  };

  // ── tema e idioma: o do app, quando a pessoa escolheu; senão o do sistema ──────────────────────────
  function aplicarTema() {
    let escolha = null;
    try { escolha = localStorage.getItem('waze_places_theme'); } catch (e) { /* sem armazenamento */ }
    let escuro = escolha === 'dark';
    if (escolha !== 'dark' && escolha !== 'light') {
      try { escuro = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { escuro = false; }
    }
    document.documentElement.classList.toggle('dark', escuro);
    document.documentElement.classList.toggle('tema-claro', !escuro);
    document.body.classList.toggle('dark', escuro);
  }
  function aplicarIdioma() {
    let pref = null;
    try { pref = localStorage.getItem('waze_places_lang'); } catch (e) { /* sem armazenamento */ }
    window.setLang(pref || undefined);
    window.applyI18n();
  }
  // O palco é lido de longe: a fonte cresce com a largura (16 px a 1366, ~22 px a 1920).
  function escalar() { document.documentElement.style.fontSize = 'clamp(16px, 1.17vw, 22px)'; }

  // ── a chave (do aparelho) ───────────────────────────────────────────────────────────────────────
  function lerChave() {
    let bruto = null;
    try { bruto = localStorage.getItem(CHAVE_DO_PALCO); } catch (e) { return null; }
    if (!bruto) return null;
    try {
      const d = JSON.parse(bruto);
      const ok = d && typeof d === 'object' && typeof d.demo === 'string' && typeof d.segredo === 'string' && typeof d.hostKey === 'string' && Number.isFinite(d.expiraEm);
      return ok && d.expiraEm > Date.now() ? d : null;
    } catch (e) { return null; }
  }

  // ── rede ────────────────────────────────────────────────────────────────────────────────────────
  async function api(rota, corpo, prazoMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), prazoMs || 15000);
    try {
      const r = await fetch('/api/' + rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: ctl.signal });
      let body = null;
      try { body = await r.json(); } catch (e) { body = null; }
      return { status: r.status, ok: r.ok && !!body && body.success !== false, body: body || {} };
    } finally { clearTimeout(timer); }
  }
  const host = (tipo, extra) => api('demo-host', { demo: P.chave.demo, hostKey: P.chave.hostKey, tipo, ...(extra || {}) });
  function frase(body) {
    const k = body && body.errorKey;
    if (k && window.t(k) !== k) return window.t(k, body.errorVars);
    return window.t('palco.erro.generico');
  }
  const agoraDoServidor = () => Date.now() + P.desvio;

  // ── avisos ──────────────────────────────────────────────────────────────────────────────────────
  function avisar(texto, ms) {
    $('palcoAvisoTexto').textContent = texto;
    $('palcoAviso').classList.remove('hidden');
    clearTimeout(P.timers.aviso);
    if (ms) P.timers.aviso = setTimeout(() => $('palcoAviso').classList.add('hidden'), ms);
  }
  const esconderAviso = () => { clearTimeout(P.timers.aviso); $('palcoAviso').classList.add('hidden'); };

  // ── a abertura ──────────────────────────────────────────────────────────────────────────────────
  // Abaixo disto o palco não cabe (a grade lateral tem 22–28 rem fixos): o celular é do convidado, o palco é do computador.
  const PALCO_LARGURA_MIN_PX = 720;

  async function abrir() {
    P.chave = lerChave();
    if (!P.chave) { P.estado = 'semChave'; render(); return; }
    // Janela estreita (celular): o palco é desenhado pra ser projetado e o que passa da caixa some calado. Diz isso
    // em vez de mostrar uma tela cortada; nada vai à rede.
    if (window.innerWidth < PALCO_LARGURA_MIN_PX) { P.estado = 'erro'; P.erroTitulo = T('palco.estreita.titulo'); P.erroTexto = T('palco.estreita'); render(); return; }
    P.estado = 'abrindo'; render();
    let a; let r;
    try {
      a = await api('demo-abrir', { segredo: P.chave.segredo });
      r = await host('resultado');
    } catch (e) { return falhar(window.t('palco.erro.rede')); }
    P.erroTitulo = null;
    if (!a.ok) return falhar(frase(a.body));
    if (!r.ok) return falhar(frase(r.body));
    P.cfg = a.body.cfg;
    P.deck = Array.isArray(a.body.convidado) ? a.body.convidado : [];
    P.ids = Array.isArray(r.body.apresentador) ? r.body.apresentador : [];
    P.regiao = r.body.regiao || (P.cfg && P.cfg.regiao) || 'row';
    P.estado = 'ok';
    if (r.body.resultado && r.body.resultado.fase === 'encerrada') P.resultado = r.body.resultado;
    aplicarVisao(r.body.visao);
    fluxo().conectar();
  }
  function falhar(texto) { P.estado = 'erro'; P.erroTexto = texto; render(); }

  // ── o fluxo ao vivo (o leitor é o js/demo-fluxo.js, o MESMO da página do convidado) ─────────────
  let fluxoDoPalco = null;
  function fluxo() {
    if (!fluxoDoPalco) {
      fluxoDoPalco = window.DemoFluxo.criar({
        corpo: () => ({ demo: P.chave.demo, hostKey: P.chave.hostKey }),
        aoEstado: aplicarVisao,
        encerrou: () => P.perdeu,
        aoRecusa: (corpo) => {
          if (corpo.motivo === 'sem-permissao' || corpo.errorKey === 'srv.err.demoNaoEncontrada') { falhar(frase(corpo)); return 'parar'; }
          return 'religar';
        },
        aoRede: (e) => { if (e === 'caiu') avisar(window.t('palco.rede.caiu')); else avisar(window.t('palco.rede.voltou'), 1500); },
      });
    }
    return fluxoDoPalco;
  }

  async function aplicarVisao(v) {
    if (!v || P.perdeu) return;
    if (typeof v.seq === 'number') { if (v.seq < P.seq) return; P.seq = v.seq; }
    if (typeof v.agora === 'number') P.desvio = v.agora - Date.now();
    const antes = P.visao;
    P.visao = v;
    if (v.fase === 'encerrada' && !P.resultado && P.chave && !P.carregandoResultado) {
      // O resultado inteiro (prêmios, resumo) só existe depois do fim: uma ida, na hora em que ele chega.
      P.carregandoResultado = true;
      render();
      try { const r = await host('resultado'); if (r.ok && r.body.resultado) P.resultado = r.body.resultado; } catch (e) { /* o fim mostra o que há */ }
      P.carregandoResultado = false;
    }
    if (antes && antes.fase !== v.fase) { P.confirmandoEncerrar = false; P.recadoAberto = false; }
    if (antes && antes.atual !== v.atual) P.detalhe = null;
    render();
  }

  // ── as ações ────────────────────────────────────────────────────────────────────────────────────
  async function executar(acao) {
    if (!acao || P.perdeu || !P.chave) return;
    if (acao.tipo === 'recado') { abrirRecado(); return; }
    const agora = Date.now();
    const principal = ['comecar', 'revelar', 'proximo'].includes(acao.tipo);
    if (principal && agora - P.ultimoPasso < PASSO_MIN_MS) return;   // Espaço duplo: nenhuma revelação é pulada
    if (principal) P.ultimoPasso = agora;
    if (acao.tipo === 'votarRef') {
      const v = P.visao;
      if (!v || !v.referencia || v.modo !== 'sinc' || v.fase !== 'andamento') return;
      if (refNoPedido(v, v.atual) !== '-') return;      // vale a primeira, como a de todo mundo
    }
    let r;
    try { r = await host(acao.tipo, acao.tipo === 'votarRef' ? { idx: acao.idx || P.visao.atual, voto: acao.voto } : (acao.extra || {})); }
    catch (e) { avisar(window.t('palco.erro.rede'), 2500); return; }
    if (r.ok) { if (r.body.visao) aplicarVisao(r.body.visao); return; }
    const m = r.body && r.body.motivo;
    if (m === 'nao-revelado') avisar(window.t('palco.aviso.revelePrimeiro'), 2500);
    else if (m !== 'fase' && m !== 'fechada') avisar(frase(r.body), 3000);
  }

  // ── o código curto, sob demanda ─────────────────────────────────────────────────────────────────
  async function pedirCodigo() {
    const botao = $('palcoCodigoBtn');
    if (botao) botao.disabled = true;
    let r;
    try { r = await host('codigo'); } catch (e) { r = null; }
    if (botao) botao.disabled = false;
    if (!r || !r.ok) { avisar(r ? frase(r.body) : window.t('palco.erro.rede'), 3000); return; }
    P.codigo = { texto: formatarCodigo(r.body.codigo), ate: r.body.ate };
    atualizarCodigo();
  }
  function atualizarCodigo() {
    const caixa = $('palcoCodigo');
    if (!caixa) return;
    caixa.classList.toggle('hidden', !P.codigo);
    const botao = $('palcoCodigoBtn');
    if (botao) botao.classList.toggle('hidden', !!P.codigo);
    if (P.codigo) $('palcoCodigoTexto').textContent = P.codigo.texto;
  }

  // ── o recado ────────────────────────────────────────────────────────────────────────────────────
  function abrirRecado() {
    P.recadoAberto = true;
    atualizarRecado();
    setTimeout(() => { const c = $('palcoRecadoCampo'); if (c) { try { c.focus({ preventScroll: true }); } catch (e) { /* sem foco */ } } }, 0);
  }
  function fecharRecado() { P.recadoAberto = false; atualizarRecado(); }
  async function enviarRecado() {
    const campo = $('palcoRecadoCampo');
    const texto = [...String(campo && campo.value || '').trim()].slice(0, RECADO_MAX).join('');
    if (!texto) return;
    fecharRecado();
    let r;
    try { r = await host('recado', { texto }); } catch (e) { r = null; }
    if (r && r.ok) { if (r.body.visao) aplicarVisao(r.body.visao); avisar(window.t('palco.recado.enviado'), 1800); }
    else avisar(window.t('palco.erro.rede'), 2500);
  }
  function atualizarRecado() {
    const caixa = $('palcoRecado');
    if (!caixa) return;
    caixa.classList.toggle('hidden', !P.recadoAberto);
    caixa.classList.toggle('flex', P.recadoAberto);
    if (!P.recadoAberto) { const c = $('palcoRecadoCampo'); if (c) c.value = ''; }
  }

  // ── encerrar (com confirmação, no próprio botão: o app não mostra diálogo do sistema) ───────────
  function pedirEncerrar() {
    P.confirmandoEncerrar = true;
    clearTimeout(P.timers.confirma);
    P.timers.confirma = setTimeout(() => { P.confirmandoEncerrar = false; atualizarRodape(); }, 6000);
    atualizarRodape();
  }
  function cancelarEncerrar() { P.confirmandoEncerrar = false; clearTimeout(P.timers.confirma); atualizarRodape(); }

  // ═════════════════════════════ desenho ═════════════════════════════

  const T = (k, v) => window.t(k, v);
  const rotuloVoto = (k) => SIMBOLO[k] + ' ' + T(NOME_VOTO[k]);
  const BTN = 'min-h-[48px] px-5 rounded-xl font-bold text-base inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap';
  const BTN_PRIM = BTN + ' bg-cyan-600 hover:bg-cyan-700 text-white disabled:opacity-60';
  const BTN_SEC = BTN + ' bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700';
  const CARTAO = 'rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700';
  const ROTULO = 'text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400';
  const kbd = (tx) => '<kbd class="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[0.6875rem] font-bold text-slate-600 dark:text-slate-300">' + esc(tx) + '</kbd>';
  const SVG_PAUSA = '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>';
  const SVG_PLAY = '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const SVG_RECADO = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h8M8 14h5m-9 6l3-3h11a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v14z"/></svg>';
  const SVG_PESSOA = '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 10-8 0 4 4 0 008 0zm-4 5c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z"/></svg>';
  const SVG_EXTERNO = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>';

  function chip(texto, cor) {
    return '<span class="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ' + (cor || 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200') + '">' + esc(texto) + '</span>';
  }

  function topo(faseTexto) {
    return '<header class="flex-shrink-0 flex items-center gap-3 px-6 h-16 palco-baixo:h-12 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">'
      + '<div class="w-10 h-10 rounded-xl bg-cyan-600 flex items-center justify-center flex-shrink-0"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" aria-hidden="true"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg></div>'
      + '<p class="font-black text-lg">Waze Places</p>'
      + '<span class="text-[0.6875rem] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-300 px-2.5 py-1 rounded-full">' + esc(T('palco.chip')) + '</span>'
      + '<span id="palcoFase" class="ml-2 text-sm font-semibold text-slate-500 dark:text-slate-400 truncate">' + esc(faseTexto || '') + '</span>'
      + '<div class="flex-1"></div>'
      + (typeof document !== 'undefined' && document.fullscreenEnabled
        ? '<button type="button" data-acao="telacheia" class="inline-flex items-center gap-2 rounded-full border border-slate-300 dark:border-slate-600 px-3.5 min-h-[40px] text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700">' + esc(document.fullscreenElement ? T('palco.telaCheiaSair') : T('palco.telaCheia')) + '</button>' : '')
      + '<span id="palcoNaSala" class="hidden items-center gap-2 rounded-full bg-cyan-50 dark:bg-cyan-500/15 text-cyan-800 dark:text-cyan-200 px-3.5 py-1.5 text-base font-bold tnum">' + SVG_PESSOA + '<span id="palcoNaSalaTxt"></span></span>'
      + '</header>';
  }

  // ── o pedido em foco: GRANDE (a plateia lê no projetor) ────────────────────────────────────────
  function pontosDoMapa(p) {
    const m = p.mapa;
    if (!m) return [];
    const pontos = [];
    if (m.centro) pontos.push({ ll: m.centro, cls: 'mapa-atual' });
    if (m.proposto) pontos.push({ ll: m.proposto, cls: 'mapa-proposto' });
    for (const e of m.entradas || []) pontos.push({ ll: e.ll, cls: 'mapa-entrada mapa-e-' + e.estado });
    if (p.duplicado && p.duplicado.ll) pontos.push({ ll: p.duplicado.ll, cls: 'mapa-duplicado' });
    return pontos;
  }
  function desenharMapa(box, p) {
    if (!box || !window.mapaMontar || !p.mapa) return;
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h || box.dataset.pronto === w + 'x' + h) return;
    const pontos = pontosDoMapa(p);
    const r = window.mapaMontar(pontos.map((x) => x.ll), w, h, P.regiao || 'row');
    if (!r) return;
    box.dataset.pronto = w + 'x' + h;
    box.textContent = '';
    for (const tl of r.tiles) {
      const im = new Image();
      im.src = tl.url; im.alt = ''; im.decoding = 'async'; im.draggable = false;
      im.className = 'absolute';
      im.style.cssText = 'left:' + tl.left + 'px;top:' + tl.top + 'px;width:' + r.tamanho + 'px;height:' + r.tamanho + 'px';
      im.onerror = () => im.remove();
      box.appendChild(im);
    }
    const idx = r.idx || r.pixels.map((_, k) => k);
    r.pixels.forEach((px, k) => {
      const el = document.createElement('span');
      el.className = 'mapa-marca ' + pontos[idx[k]].cls;
      el.style.cssText = 'left:' + px.left + 'px;top:' + px.top + 'px';
      box.appendChild(el);
    });
  }

  function rotuloEnum(prefixo, valor) {
    if (!valor) return '';
    const k = prefixo + valor;
    const s = T(k);
    if (s !== k) return s;
    const h = String(valor).replace(/_/g, ' ').trim().toLowerCase();
    return h.charAt(0).toUpperCase() + h.slice(1);
  }
  function valorDoDiff(v) {
    if (v === null || v === undefined) return T('card.value.empty');
    if (v === true) return T('card.value.yes');
    if (v === false) return T('card.value.no');
    if (v === '') return T('card.value.unnamed');
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }

  // O cartão do pedido `idx`: mídia à esquerda/em cima, texto embaixo. `altura` é do contêiner.
  function cartaoDoPedido(idx, opcoes) {
    const p = P.deck[idx - 1];
    if (!p) return '<section class="' + CARTAO + ' p-6"></section>';
    const titulo = p.name || p.address || T('card.noName');
    const tipo = (p.changes && p.changes.length) ? T('card.type.update')
      : p.flagSubjectType === 'IMAGE' ? T('card.type.flagImage') : (rotuloEnum('card.updateType.', p.updateTypeKey) || p.updateType || '');
    const motivo = p.flagType ? (p.flagType === 'DUPLICATE' && p.duplicado && p.duplicado.nome ? T('card.flagDuplicateOf', { alvo: p.duplicado.nome }) : rotuloEnum('card.flagType.', p.flagType)) : '';
    const fotos = (p.imageUrls || []).slice(0, 1);
    const temMapa = !!p.mapa;
    const link = P.ids[idx - 1] ? linkDoWme(p, P.ids[idx - 1], P.regiao) : null;
    const mud = Array.isArray(p.changes) ? p.changes : [];
    const diff = mud.slice(0, 4).map((m) => {
      const k = 'card.field.' + m.field; const rot = T(k) === k ? (m.label || m.field) : T(k);
      return '<p class="text-lg leading-snug break-words" dir="auto"><span class="font-semibold">' + esc(rot) + ':</span> <span class="line-through text-rose-700 dark:text-rose-300">' + esc(valorDoDiff(m.from)) + '</span> → <span class="font-medium text-emerald-700 dark:text-emerald-300">' + esc(valorDoDiff(m.to)) + '</span></p>';
    }).join('') + (mud.length > 4 ? '<p class="text-sm text-slate-500">+' + (mud.length - 4) + '</p>' : '');
    const midia = (fotos.length ? '<div class="relative bg-slate-200 dark:bg-slate-700 ' + (temMapa ? 'basis-1/2' : 'flex-1') + ' min-w-0"><img src="' + esc(fotos[0]) + '" alt="" draggable="false" class="absolute inset-0 w-full h-full object-cover" data-foto></div>' : '')
      + (temMapa ? '<div class="relative overflow-hidden bg-slate-200 dark:bg-slate-700 flex-1 min-w-0" data-mapa="' + idx + '"></div>' : '')
      + (!fotos.length && !temMapa ? '<div class="flex-1 flex items-center justify-center text-slate-400 bg-slate-100 dark:bg-slate-700">' + esc(T('card.noImage')) + '</div>' : '');
    return '<section class="' + CARTAO + ' overflow-hidden shadow-sm flex flex-col min-w-0 min-h-0 ' + (opcoes && opcoes.classe || '') + '" data-pedido="' + idx + '">'
      + '<div class="relative flex-1 min-h-[12rem] flex gap-0.5">' + midia
      + '<span class="absolute top-3 left-3 rounded-full bg-black/60 text-white text-sm font-bold px-3 py-1 tnum">' + esc(T('palco.pedido', { i: idx, n: P.cfg ? P.cfg.total : P.deck.length })) + '</span></div>'
      + '<div class="p-5 flex flex-col gap-1.5 min-w-0 flex-shrink-0">'
      + '<h2 class="text-3xl font-extrabold leading-tight break-words" dir="auto">' + esc(titulo) + '</h2>'
      + (p.name && p.address ? '<p class="text-lg text-slate-600 dark:text-slate-300 break-words" dir="auto">' + esc(p.address) + '</p>' : '')
      + '<div class="flex flex-wrap items-center gap-2 pt-1">'
      + ((p.categories || []).length ? chip((p.categories || []).slice(0, 2).join(', ')) : '')
      + (tipo ? chip(tipo, 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200') : '')
      + (motivo ? chip(motivo, 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300') : '')
      + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" class="ml-auto inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-cyan-50 text-cyan-700 dark:bg-cyan-600/20 dark:text-cyan-300 font-semibold text-sm">' + esc(T('palco.abrirWme')) + ' ' + SVG_EXTERNO + '</a>' : '')
      + '</div>' + diff + '</div></section>';
  }
  // Depois de o cartão estar no DOM: o mapa mede o contêiner de verdade (o enquadramento depende dele).
  function acabarCartao(raiz) {
    if (!raiz) return;
    for (const box of raiz.querySelectorAll('[data-mapa]')) {
      const p = P.deck[+box.dataset.mapa - 1];
      const desenhar = () => desenharMapa(box, p);
      requestAnimationFrame(desenhar);
      if (window.ResizeObserver) { const ro = new ResizeObserver(() => requestAnimationFrame(desenhar)); ro.observe(box); box._ro = ro; }
    }
    for (const img of raiz.querySelectorAll('img[data-foto]')) img.addEventListener('error', () => img.remove());
  }

  // ── as barras ✕ ↑ ✓ ─────────────────────────────────────────────────────────────────────────────
  const COR_BARRA = { R: 'bg-rose-500', P: 'bg-amber-500', L: 'bg-emerald-500' };
  function barras(c, escondida) {
    const lin = (k) => '<div class="flex flex-col gap-1"><div class="flex items-baseline justify-between"><span class="text-lg palco-baixo:text-base font-extrabold">' + esc(rotuloVoto(k)) + '</span>'
      + '<span class="text-lg palco-baixo:text-base font-black tnum">' + (escondida ? '?' : esc((c[k] || 0) + ' · ' + pct(c, k) + '%')) + '</span></div>'
      + '<div class="h-4 palco-baixo:h-3 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">'
      + (escondida ? '<div class="h-full w-full" style="background:repeating-linear-gradient(45deg,transparent 0 10px,rgba(148,163,184,.25) 10px 20px)"></div>'
        : '<div class="h-full rounded-full ' + COR_BARRA[k] + '" style="width:' + pct(c, k) + '%"></div>') + '</div></div>';
    return '<div class="flex flex-col gap-2 palco-baixo:gap-1">' + ['R', 'P', 'L'].map(lin).join('') + '</div>';
  }

  // ── montar: o esqueleto de cada tela (uma vez) ───────────────────────────────────────────────
  function montar(tela) {
    const raiz = $('palcoRaiz');
    P.telaMontada = tela;
    if (tela === 'semChave' || tela === 'erro' || tela === 'abrindo') {
      const msg = tela === 'semChave' ? T('palco.semChave') : tela === 'erro' ? P.erroTexto : T('palco.abrindo');
      raiz.innerHTML = topo('') + '<main class="flex-1 flex items-center justify-center p-8 text-center"><div class="max-w-xl flex flex-col items-center gap-4">'
        + '<p class="text-5xl" aria-hidden="true">' + (tela === 'abrindo' ? '⏳' : '🫥') + '</p>'
        + '<h1 class="text-2xl font-extrabold">' + esc(tela === 'abrindo' ? T('palco.abrindo') : (P.erroTitulo || T('palco.erro.titulo'))) + '</h1>'
        + (tela !== 'abrindo' ? '<p id="palcoMsg" class="text-lg text-slate-600 dark:text-slate-300" role="alert">' + esc(msg) + '</p>' : '')
        + '</div></main>';
      return;
    }
    if (tela === 'saguao') return montarSaguao(raiz);
    if (tela === 'contagem') {
      raiz.innerHTML = topo(T('palco.fase.contagem')) + '<main class="flex-1 flex flex-col items-center justify-center gap-2" role="status" aria-live="assertive">'
        + '<p class="text-2xl font-semibold text-slate-600 dark:text-slate-300">' + esc(T('palco.contagem')) + '</p>'
        + '<p id="palcoContagemNum" class="font-black text-cyan-600 dark:text-cyan-400 tnum leading-none" style="font-size:16rem">3</p></main>';
      return;
    }
    if (tela === 'sinc') return montarSinc(raiz);
    if (tela === 'livre') return montarLivre(raiz);
    if (tela === 'fim') return montarFim(raiz);
  }

  function montarSaguao(raiz) {
    raiz.innerHTML = topo(T('palco.fase.saguao'))
      + '<main class="flex-1 min-h-0 grid grid-cols-[28rem_1fr] gap-8 px-8 py-6">'
      + '<section class="flex flex-col items-center gap-3 min-h-0"><h1 class="text-3xl font-extrabold text-center leading-tight">' + esc(T('palco.entre')) + '</h1>'
      + '<canvas id="palcoQr" class="rounded-2xl bg-white p-3 shadow-md border border-slate-200 flex-shrink-0" role="img" aria-label="' + esc(T('palco.qr.aria')) + '"></canvas>'
      + '<p class="text-center text-base text-slate-600 dark:text-slate-300">' + esc(T('palco.aponte')) + '<br><span id="palcoLink" class="font-mono font-bold text-slate-800 dark:text-slate-100 break-all"></span></p>'
      + '<button id="palcoCodigoBtn" type="button" class="min-h-[44px] px-3 text-base font-semibold text-cyan-700 dark:text-cyan-300 underline">' + esc(T('palco.semCamera')) + '</button>'
      + '<div id="palcoCodigo" class="hidden w-full text-center"><p class="text-sm text-slate-500 dark:text-slate-400">' + esc(T('palco.codigo.digite')) + '</p>'
      + '<p id="palcoCodigoTexto" class="text-6xl font-black tracking-[0.15em] text-cyan-700 dark:text-cyan-300 tnum select-all"></p></div></section>'
      + '<section class="min-w-0 min-h-0 flex flex-col gap-4"><div id="palcoChips" class="flex items-center gap-3 flex-wrap"></div>'
      + '<h2 class="' + ROTULO + '">' + esc(T('palco.quemEntrou')) + '</h2><ul id="palcoNomes" class="flex flex-wrap gap-2.5 content-start overflow-hidden min-h-0"></ul></section></main>'
      + rodape();
    const canvas = $('palcoQr');
    const url = location.origin + '/demo#' + P.chave.segredo;
    $('palcoLink').textContent = location.host + '/demo';
    desenharQr(canvas, url);
    $('palcoCodigoBtn').addEventListener('click', pedirCodigo);
    ligarRodape();
  }
  function desenharQr(canvas, url) {
    if (!canvas) return;
    const qr = typeof window.gerarQR === 'function' ? window.gerarQR(url) : null;
    if (!qr) { canvas.classList.add('hidden'); return; }
    const Q = 4;
    const lado = qr.tamanho + Q * 2;
    const alvo = Math.max(220, Math.min(420, Math.round(window.innerHeight * 0.48)));
    const esc2 = Math.max(3, Math.floor(alvo / lado));
    const px = lado * esc2;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = px * dpr; canvas.height = px * dpr;
    canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#0f172a';
    for (let l = 0; l < qr.tamanho; l++) for (let c = 0; c < qr.tamanho; c++) if (qr.modulos[l][c]) ctx.fillRect((c + Q) * esc2, (l + Q) * esc2, esc2, esc2);
  }

  // O rodapé tem duas partes: o CORPO (progresso, teclas e botões, refeito a cada visão) e o recado, montado UMA vez —
  // se o campo fosse refeito junto, cada voto que chega apagaria o que o apresentador está digitando.
  function rodape() {
    return '<footer id="palcoRodape" class="flex-shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-8 py-3 flex flex-col gap-2.5"><div id="palcoRodapeCorpo" class="flex flex-col gap-2.5"></div>'
      + '<div id="palcoRecado" class="hidden items-center gap-3"><label class="sr-only" for="palcoRecadoCampo">' + esc(T('palco.recado.label')) + '</label>'
      + '<input id="palcoRecadoCampo" type="text" maxlength="' + RECADO_MAX + '" autocomplete="off" dir="auto" placeholder="' + esc(T('palco.recado.ph')) + '" class="flex-1 min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 text-lg dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500">'
      + '<button type="button" id="palcoRecadoCancelar" class="' + BTN_SEC + '">' + esc(T('common.cancel')) + '</button><button type="button" id="palcoRecadoEnviar" class="' + BTN_PRIM + '">' + esc(T('palco.recado.enviar')) + '</button></div></footer>';
  }
  function ligarRodape() {
    const r = $('palcoRodape');
    if (!r || r._ligado) return;
    r._ligado = true;
    $('palcoRecadoEnviar').addEventListener('click', enviarRecado);
    $('palcoRecadoCancelar').addEventListener('click', fecharRecado);
    $('palcoRecadoCampo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enviarRecado(); } else if (e.key === 'Escape') { e.preventDefault(); fecharRecado(); } });
    r.addEventListener('click', (e) => {
      const b = e.target.closest('[data-acao]');
      if (!b) return;
      const a = b.dataset.acao;
      if (a === 'principal') executar(acaoPrincipal(P.visao));
      else if (a === 'pausar') executar({ tipo: 'pausar' });
      else if (a === 'retomar') executar({ tipo: 'retomar' });
      else if (a === 'recado') executar({ tipo: 'recado' });
      else if (a === 'encerrar') pedirEncerrar();
      else if (a === 'encerrar-sim') { cancelarEncerrar(); executar({ tipo: 'encerrar' }); }
      else if (a === 'encerrar-nao') cancelarEncerrar();
      else if (a === 'telacheia') alternarTelaCheia();
      else if (a === 'pedido') abrirDetalhe(+b.dataset.idx);
    });
  }

  // Tela cheia: só por gesto (clique), e a falha é calada (o navegador pode recusar). O texto do botão acompanha o estado.
  function alternarTelaCheia() {
    try {
      const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* sem tela cheia aqui */ }
  }

  function montarSinc(raiz) {
    raiz.innerHTML = topo('') + '<main id="palcoMain" class="flex-1 min-h-0 grid grid-cols-[1fr_28rem] gap-6 px-8 py-4 palco-baixo:py-2"><div id="palcoFoco" class="min-h-0 flex flex-col"></div><aside id="palcoLado" class="flex flex-col gap-3 min-w-0 min-h-0 overflow-hidden"></aside></main>' + rodape();
    ligarRodape();
    P.focoMontado = null;
  }
  function montarLivre(raiz) {
    raiz.innerHTML = topo(T('palco.fase.livre')) + '<main class="flex-1 min-h-0 grid grid-cols-[22rem_1fr] gap-6 px-8 py-5">'
      + '<section class="flex flex-col gap-3 min-w-0 min-h-0"><div id="palcoDecisoes" class="' + CARTAO + ' p-5"></div><div id="palcoAvanco" class="' + CARTAO + ' p-5 flex-1 min-h-0 overflow-hidden"></div></section>'
      + '<section class="min-w-0 min-h-0 flex flex-col gap-3"><div class="flex items-baseline gap-3"><h2 class="' + ROTULO + '">' + esc(T('palco.livre.pedidos')) + '</h2><span class="text-xs text-slate-500 dark:text-slate-400">' + esc(T('palco.livre.toque')) + '</span></div><div id="palcoGrade" class="grid grid-cols-6 gap-2 content-start overflow-y-auto min-h-0"></div></section></main>'
      + rodape();
    ligarRodape();
  }
  function montarFim(raiz) {
    raiz.innerHTML = topo(T('palco.fase.fim')) + '<nav class="flex-shrink-0 flex items-center gap-2 px-8 pt-4" role="tablist" id="palcoAbas"></nav><main id="palcoFimCorpo" class="flex-1 min-h-0 overflow-y-auto px-8 py-4"></main>';
    $('palcoAbas').addEventListener('click', (e) => { const b = e.target.closest('[data-aba]'); if (b) { P.aba = b.dataset.aba; atualizarFim(); } });
    $('palcoFimCorpo').addEventListener('click', (e) => {
      const o = e.target.closest('[data-ordem]'); if (o) { P.ordem = o.dataset.ordem; atualizarFim(); return; }
      const p = e.target.closest('[data-pedido-abrir]'); if (p && !e.target.closest('a')) abrirDetalhe(+p.dataset.pedidoAbrir);
    });
  }

  // ── atualizar: o que muda a cada visão ───────────────────────────────────────────────────────
  function render() {
    const tela = telaDaVisao(P.visao, P.estado);
    if (tela !== P.telaMontada) montar(tela);
    const v = P.visao;
    const naSala = $('palcoNaSala');
    if (naSala && v) { naSala.classList.remove('hidden'); naSala.classList.add('inline-flex'); $('palcoNaSalaTxt').textContent = T(v.naSala === 1 ? 'palco.naSala1' : 'palco.naSala', { n: v.naSala }); }
    if (tela === 'saguao') atualizarSaguao(v);
    else if (tela === 'contagem') atualizarContagem(v);
    else if (tela === 'sinc') atualizarSinc(v);
    else if (tela === 'livre') atualizarLivre(v);
    else if (tela === 'fim') atualizarFim();
    atualizarDetalhe();
    ajustarRelogio();
  }

  function atualizarSaguao(v) {
    const nomes = $('palcoNomes');
    if (nomes) {
      const gente = (v.pessoas || []).slice(0, 80);
      nomes.innerHTML = gente.map((p) => '<li class="rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2 text-lg font-semibold shadow-sm max-w-[18rem] truncate" dir="auto">'
        + esc(p.nome) + (p.pais ? ' <span class="text-sm font-medium text-slate-500 dark:text-slate-400">' + esc(p.pais) + '</span>' : '') + '</li>').join('')
        + ((v.pessoas || []).length > 80 ? '<li class="px-2 py-2 text-base font-semibold text-slate-500">' + esc(T('palco.outros', { n: v.pessoas.length - 80 })) + '</li>' : '');
    }
    const modo = v.modo === 'sinc' ? T('palco.modo.sinc') + (v.tempoMs ? ' · ' + T('palco.tempo', { s: v.tempoMs / 1000 }) : '') : T('palco.modo.livre');
    const chips = $('palcoChips');
    if (chips) chips.innerHTML = chip(modo, 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-200') + chip(T(v.total === 1 ? 'palco.pedidos1' : 'palco.pedidos', { n: v.total }))
      + (v.referencia ? chip(T('palco.voceVotaEscondido'), 'bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-300') : '');
    atualizarCodigo();
    atualizarRodape();
  }
  function atualizarContagem(v) {
    const n = Math.max(1, Math.min(3, Math.ceil(((v.contagemAte || 0) - agoraDoServidor()) / 1000)));
    const el = $('palcoContagemNum'); if (el) el.textContent = String(n);
  }

  // O texto da fase, com a PAUSA dita em letra grande (o projetor mostra «Pausada» a todos, e o palco também).
  function marcarFase(v, texto) {
    const fase = $('palcoFase');
    if (!fase) return;
    const pausada = v.fase === 'pausada';
    fase.textContent = pausada ? '⏸ ' + T('palco.pausada') : texto;
    fase.className = 'ml-2 truncate ' + (pausada ? 'text-base font-black uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-400/20 px-3 py-1 rounded-full' : 'text-sm font-semibold text-slate-500 dark:text-slate-400');
  }

  // O pedido da vez (modo sincronizado).
  function atualizarSinc(v) {
    const idx = v.atual || 1;
    marcarFase(v, T('palco.fase.sinc') + (v.tempoMs ? ' · ' + T('palco.tempo', { s: v.tempoMs / 1000 }) : ''));
    const foco = $('palcoFoco');
    if (foco && P.focoMontado !== idx) {
      foco.innerHTML = cartaoDoPedido(idx, { classe: 'flex-1' });
      acabarCartao(foco);
      P.focoMontado = idx;
    }
    atualizarLadoSinc(v, idx);
    atualizarRodape();
  }

  function atualizarLadoSinc(v, idx) {
    const lado = $('palcoLado');
    if (!lado) return;
    const c = (v.pedidos && v.pedidos[idx - 1]) || { n: v.votaram || 0 };
    const revelado = v.revelado === true;
    const n = c.n || 0;
    const sala = v.naSala || 0;
    let h = '<div class="' + CARTAO + ' p-4 palco-baixo:p-3 flex items-center gap-4 flex-shrink-0"><div class="relative w-20 h-20 palco-baixo:w-14 palco-baixo:h-14 flex-shrink-0"><svg viewBox="0 0 100 100" class="w-20 h-20 palco-baixo:w-14 palco-baixo:h-14 -rotate-90" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" class="text-slate-200 dark:text-slate-700" stroke-width="10"/><circle id="palcoAnel" cx="50" cy="50" r="44" fill="none" stroke="#06b6d4" stroke-width="10" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg>'
      + '<span id="palcoSegundos" class="absolute inset-0 flex items-center justify-center text-3xl palco-baixo:text-xl font-black tnum"></span></div>'
      + '<div><p class="' + ROTULO + '">' + esc(T('palco.votaram')) + '</p><p class="text-4xl palco-baixo:text-3xl font-black tnum leading-none mt-0.5">' + n + '<span class="text-xl text-slate-400 font-bold"> / ' + sala + '</span></p>'
      + '<p class="text-sm text-slate-500 dark:text-slate-400 mt-1.5">' + esc(T('palco.palpites', { n: (v.palpites && v.palpites.n) || 0 })) + '</p></div></div>';
    h += '<div class="' + CARTAO + ' p-4 palco-baixo:p-3 flex-shrink-0"><p class="' + ROTULO + ' mb-2">' + esc(revelado ? T('palco.comoVotou', { n }) : T('palco.escolheEscondido')) + '</p>' + barras(c, !revelado);
    if (revelado) {
      const m = maioriaDe(c);
      h += '<p class="mt-2 text-xl font-black ' + (m === 'R' ? 'text-rose-600 dark:text-rose-400' : m === 'L' ? 'text-emerald-600 dark:text-emerald-400' : m === 'P' ? 'text-amber-600 dark:text-amber-400' : '') + '">' + esc(m ? T('palco.salaEscolheu', { voto: rotuloVoto(m) }) : n ? T('palco.empate') : '') + '</p>';
    }
    h += '</div>';
    // A referência: confirmação neutra antes da revelação (a tela é projetada), o voto depois. Ela e o «adivinharam» dividem uma
    // fileira quando os dois existem (a coluna é estreita e a altura é o que falta num projetor).
    const temAdivinharam = revelado && v.palpites && v.palpites.n && maioriaDe(c);
    h += (v.referencia && temAdivinharam) ? '<div class="grid grid-cols-2 gap-3 flex-shrink-0">' : '<div class="contents">';
    if (v.referencia) {
      const r = refNoPedido(v, idx);
      h += '<div class="rounded-3xl bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-400/30 p-3 flex-shrink-0"><p class="text-[0.6875rem] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">' + esc(T('palco.ref.titulo')) + '</p>';
      if (revelado) {
        h += r === '-' ? '<p class="text-lg font-semibold mt-1">' + esc(T('palco.ref.naoVotou')) + '</p>'
          : '<p class="text-xl font-extrabold mt-0.5">' + esc(rotuloVoto(r)) + ' <span class="text-sm font-semibold text-slate-600 dark:text-slate-300">· ' + esc(T('palco.ref.pensam', { n: c[r] || 0 })) + '</span></p>';
      } else if (r === '-') {
        h += '<div class="flex gap-2 mt-2" role="group" aria-label="' + esc(T('palco.ref.titulo')) + '">' + ['R', 'P', 'L'].map((k, i) => '<button type="button" data-ref="' + k + '" class="flex-1 min-h-[48px] rounded-xl border-2 font-bold text-base ' + ({ R: 'border-rose-500 text-rose-600 dark:text-rose-300', P: 'border-amber-500 text-amber-700 dark:text-amber-300', L: 'border-emerald-500 text-emerald-700 dark:text-emerald-300' })[k] + ' bg-white dark:bg-slate-800">' + esc(SIMBOLO[k]) + ' <span class="text-[0.6875rem] opacity-70">' + (({ R: 1, P: 2, L: 3 })[k]) + '</span></button>').join('') + '</div>'
          + '<p class="text-xs text-slate-600 dark:text-slate-300 mt-1.5">' + esc(T('palco.ref.dica')) + '</p>';
      } else {
        h += '<p class="text-lg font-semibold mt-1"><span aria-hidden="true">●</span> ' + esc(T('palco.ref.registrada')) + '</p>';   // «●», nunca «✓»: o ✓ é o voto «lido», e a confirmação não pode parecer um voto
      }
      h += '</div>';
    }
    if (temAdivinharam) {
      const m = maioriaDe(c);
      h += '<div class="' + CARTAO + ' p-3 flex-shrink-0"><p class="' + ROTULO + '">' + esc(T('palco.adivinharam')) + '</p><p class="text-lg font-extrabold mt-0.5">🎯 ' + esc(T('palco.acertaram', { a: v.palpites[m] || 0, b: v.palpites.n })) + '</p></div>';
    }
    h += '</div>';
    lado.innerHTML = h;
    for (const b of lado.querySelectorAll('[data-ref]')) b.addEventListener('click', () => executar({ tipo: 'votarRef', voto: b.dataset.ref }));
  }

  // O avanço de cada um e o calor por pedido (modo livre): SÓ contagens ao vivo.
  function atualizarLivre(v) {
    marcarFase(v, T('palco.fase.livre'));
    const pessoas = v.pessoas || [];
    const total = v.total;
    const feitos = pessoas.reduce((a, p) => a + (p.feitos || 0), 0);
    const terminaram = pessoas.filter((p) => p.terminou).length;
    const dec = $('palcoDecisoes');
    if (dec) dec.innerHTML = '<p class="' + ROTULO + '">' + esc(T('palco.livre.decisoes')) + '</p><p id="palcoDecisoesNum" class="text-6xl font-black tnum leading-none mt-1 text-cyan-700 dark:text-cyan-300">' + feitos + '</p>'
      + '<p class="text-sm text-slate-500 dark:text-slate-400 mt-2">' + esc(T('palco.livre.deTotal', { total: pessoas.length * total, fim: terminaram })) + '</p>';
    const av = $('palcoAvanco');
    if (av) {
      const { vistas, outros } = listaDeAvanco(pessoas, AVANCO_TOPO);
      av.innerHTML = '<p class="' + ROTULO + ' mb-3">' + esc(T('palco.livre.avanco')) + '</p><ul class="flex flex-col gap-2.5">'
        + vistas.map((p) => '<li class="flex items-center gap-3"><span class="w-36 truncate text-base font-semibold" dir="auto">' + esc(p.nome) + '</span>'
          + '<div class="flex-1 h-4 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div class="h-full rounded-full ' + (p.terminou ? 'bg-emerald-500' : 'bg-cyan-500') + '" style="width:' + Math.round((p.feitos || 0) * 100 / total) + '%"></div></div>'
          + '<span class="w-14 text-right tnum text-sm font-bold ' + (p.terminou ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500') + '">' + (p.terminou ? '✓' : (p.feitos || 0) + '/' + total) + '</span></li>').join('')
        + '</ul>' + (outros ? '<p class="mt-3 text-sm font-semibold text-slate-500">' + esc(T('palco.outros', { n: outros })) + '</p>' : '');
    }
    const grade = $('palcoGrade');
    if (grade) {
      grade.innerHTML = (v.pedidos || []).map((c, i) => '<button type="button" data-acao="pedido" data-idx="' + (i + 1) + '" class="rounded-lg p-2 flex flex-col gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left hover:border-cyan-500 min-h-[44px]">'
        + '<span class="flex justify-between text-xs font-bold text-slate-500 tnum"><span>' + (i + 1) + '</span><span>' + (c.n || 0) + '</span></span>'
        + '<span class="block h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><span class="block h-full rounded-full bg-cyan-500" style="width:' + Math.round((c.n || 0) * 100 / Math.max(1, pessoas.length)) + '%"></span></span></button>').join('');
    }
    atualizarRodape();
  }

  // O rodapé: o que se pode fazer AGORA.
  function atualizarRodape() {
    const r = $('palcoRodapeCorpo');
    const v = P.visao;
    if (!r || !v) return;
    const pausada = v.fase === 'pausada';
    const principal = acaoPrincipal(v);
    let teclas = '';
    let botoes = '';
    if (v.fase === 'saguao') {
      teclas = kbd(T('palco.tecla.espaco')) + ' ' + esc(T('palco.tecla.comecar')) + ' &nbsp; ' + kbd('R') + ' ' + esc(T('palco.tecla.recado'));
      botoes = botaoRecado() + '<button type="button" data-acao="principal" ' + (principal ? '' : 'disabled') + ' class="' + BTN_PRIM + ' text-lg min-h-[56px] px-8">' + esc(T(v.naSala === 1 ? 'palco.comecar1' : 'palco.comecar', { n: v.naSala })) + '</button>';
    } else {
      const sinc = v.modo === 'sinc';
      teclas = sinc ? kbd(T('palco.tecla.espaco')) + ' ' + esc(T('palco.tecla.avancar')) + ' &nbsp; ' : '';
      teclas += kbd('P') + ' ' + esc(T('palco.tecla.pausa')) + ' &nbsp; ' + kbd('R') + ' ' + esc(T('palco.tecla.recado')) + (sinc && v.referencia ? ' &nbsp; ' + kbd('1 2 3') + ' ' + esc(T('palco.tecla.voto')) : '');
      botoes = '<button type="button" data-acao="' + (pausada ? 'retomar' : 'pausar') + '" class="' + BTN_SEC + '">' + (pausada ? SVG_PLAY + esc(T('palco.retomar')) : SVG_PAUSA + esc(T('palco.pausar'))) + '</button>' + botaoRecado();
      if (pausada) botoes += '<button type="button" data-acao="retomar" class="' + BTN_PRIM + ' text-lg min-h-[56px] px-8">' + esc(T('palco.retomar')) + '</button>';
      else if (sinc && principal) {
        const rot = principal.tipo === 'revelar' ? T('palco.revelar') : principal.ultimo ? T('palco.encerrarVer') : T('palco.proximo');
        botoes += '<button type="button" data-acao="principal" class="' + BTN_PRIM + ' text-lg min-h-[56px] px-8">' + esc(rot) + '</button>';
      } else if (!sinc) {
        botoes += P.confirmandoEncerrar
          ? '<span class="text-base font-semibold text-slate-600 dark:text-slate-300 self-center">' + esc(T('palco.encerrar.pergunta')) + '</span><button type="button" data-acao="encerrar-nao" class="' + BTN_SEC + '">' + esc(T('common.cancel')) + '</button><button type="button" data-acao="encerrar-sim" class="' + BTN_PRIM + ' bg-rose-600 hover:bg-rose-700">' + esc(T('palco.encerrar.sim')) + '</button>'
          : '<button type="button" data-acao="encerrar" class="' + BTN_PRIM + ' text-lg min-h-[56px] px-8">' + esc(T('palco.encerrarVer')) + '</button>';
      }
    }
    let progresso = '';
    if (v.modo === 'sinc' && v.fase !== 'saguao') {
      progresso = '<div class="flex items-center gap-1 flex-wrap">' + Array.from({ length: v.total }, (_, i) => {
        const n = i + 1; const rev = n < v.atual || (n === v.atual && v.revelado);
        return '<button type="button" data-acao="pedido" data-idx="' + n + '" aria-label="' + esc(T('palco.pedido', { i: n, n: v.total })) + '" class="w-6 h-6 rounded-md text-[0.6875rem] font-bold tnum '
          + (n === v.atual ? 'bg-cyan-600 text-white ring-2 ring-cyan-300' : rev ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400') + '">' + n + '</button>';
      }).join('') + '</div>';
    }
    r.innerHTML = progresso + '<div class="flex items-center gap-3 flex-wrap"><span class="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5">' + teclas + '</span><div class="flex-1"></div>' + botoes + '</div>';
    atualizarRecado();
  }
  const botaoRecado = () => '<button type="button" data-acao="recado" class="' + BTN_SEC + '">' + SVG_RECADO + esc(T('palco.recado')) + '</button>';

  // ── o detalhe de um pedido (do trilho, da grade e do resultado) ─────────────────────────────
  function abrirDetalhe(idx) {
    if (!idx || !P.deck[idx - 1]) return;
    P.detalhe = idx;
    atualizarDetalhe();
  }
  function fecharDetalhe() { P.detalhe = null; atualizarDetalhe(); }
  function atualizarDetalhe() {
    let camada = $('palcoDetalhe');
    if (P.detalhe === null) { if (camada) camada.remove(); return; }
    const v = P.visao;
    const idx = P.detalhe;
    const fim = v && v.fase === 'encerrada';
    const atualDoSinc = v && v.modo === 'sinc' && v.atual === idx && !v.revelado && !fim;
    const c = fim && P.resultado ? P.resultado.pedidos[idx - 1] : (v && v.pedidos && v.pedidos[idx - 1]) || { n: 0 };
    const mostra = c && c.R !== undefined;
    if (!camada) {
      camada = document.createElement('div');
      camada.id = 'palcoDetalhe';
      camada.className = 'fixed inset-0 z-[60] bg-slate-900/70 flex items-center justify-center p-8';
      camada.setAttribute('role', 'dialog'); camada.setAttribute('aria-modal', 'true'); camada.setAttribute('aria-label', T('palco.detalhe'));
      document.body.appendChild(camada);
      camada.addEventListener('click', (e) => { if (e.target === camada || e.target.closest('[data-fechar]')) fecharDetalhe(); });
    }
    const assinatura = idx + '|' + JSON.stringify(c) + '|' + !!atualDoSinc;
    if (camada._assinatura === assinatura) return;
    camada._assinatura = assinatura;
    camada.innerHTML = '<div class="w-full max-w-6xl h-full max-h-[48rem] grid grid-cols-[1fr_24rem] gap-6 bg-slate-50 dark:bg-slate-900 rounded-3xl p-6 overflow-hidden">'
      + '<div class="min-h-0 flex flex-col">' + cartaoDoPedido(idx, { classe: 'flex-1' }) + '</div>'
      + '<div class="flex flex-col gap-4 min-h-0"><div class="flex items-center"><p class="' + ROTULO + '">' + esc(T('palco.detalhe')) + '</p><div class="flex-1"></div><button type="button" data-fechar class="' + BTN_SEC + ' min-h-[44px]">' + esc(T('common.close')) + '</button></div>'
      + '<div class="' + CARTAO + ' p-5">' + (atualDoSinc ? '<p class="text-base text-slate-600 dark:text-slate-300">' + esc(T('palco.detalhe.emAndamento')) + '</p>' : barras(mostra ? c : { R: 0, L: 0, P: 0 }, !mostra)) + '</div></div></div>';
    acabarCartao(camada);
  }

  // ── o relógio do pedido e o 3-2-1 ───────────────────────────────────────────────────────────────
  function ajustarRelogio() {
    clearInterval(P.timers.relogio);
    P.timers.relogio = null;
    const v = P.visao;
    if (!v) return;
    const contagem = v.fase === 'contagem';
    const comRelogio = v.fase === 'andamento' && v.modo === 'sinc' && v.fimEm && v.tempoMs > 0 && !v.revelado;
    const pausada = v.fase === 'pausada' && v.modo === 'sinc' && v.restanteMs != null && v.tempoMs > 0;
    const passo = () => {
      if (contagem) { atualizarContagem(v); return; }
      const falta = pausada ? v.restanteMs : Math.max(0, v.fimEm - agoraDoServidor());
      const f = Math.min(1, falta / v.tempoMs);
      const anel = $('palcoAnel');
      if (anel) { anel.setAttribute('stroke-dashoffset', String(276.5 * (1 - f))); anel.setAttribute('stroke', falta <= 2000 ? '#f43f5e' : falta <= 5000 ? '#f59e0b' : '#06b6d4'); }
      const seg = $('palcoSegundos'); if (seg) seg.textContent = String(Math.ceil(falta / 1000));
    };
    if (!contagem && !comRelogio && !pausada) {
      const seg = $('palcoSegundos'); if (seg) seg.textContent = v.modo === 'sinc' && v.tempoMs === 0 ? '∞' : '';
      const anel = $('palcoAnel'); if (anel) anel.setAttribute('stroke-dashoffset', v.revelado ? '276.5' : '0');
      return;
    }
    passo();
    if (!pausada) P.timers.relogio = setInterval(passo, 100);
  }

  // ═════════════════════════════ o fim: os três quadros ═════════════════════════════

  const fraseDeDuracao = (ms) => {
    const d = partesDaDuracao(ms);
    return d.forma === 'hm' ? T('palco.dur.hm', { h: d.h, m: d.m }) : d.forma === 'ms' ? T('palco.dur.ms', { m: d.m, s: d.s }) : T('palco.dur.s', { s: d.s });
  };

  function atualizarFim() {
    const abas = $('palcoAbas'); const corpo = $('palcoFimCorpo');
    if (!abas || !corpo) return;
    const lista = [['pedidos', T('palco.aba.pedidos')], ['pessoas', T('palco.aba.pessoas')], ['resumo', T('palco.aba.resumo')]];
    abas.innerHTML = lista.map(([k, tx]) => '<button type="button" role="tab" data-aba="' + k + '" aria-selected="' + (k === P.aba) + '" class="min-h-[44px] px-5 rounded-full text-base font-bold ' + (k === P.aba ? 'bg-cyan-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200') + '">' + esc(tx) + '</button>').join('');
    const res = P.resultado;
    if (!res || !res.analise) { corpo.innerHTML = '<p class="text-lg text-slate-500 dark:text-slate-400 p-6" role="status">' + esc(T('palco.fim.carregando')) + '</p>'; return; }
    if (P.aba === 'pedidos') corpo.innerHTML = quadroDePedidos(res);
    else if (P.aba === 'pessoas') corpo.innerHTML = quadroDePessoas(res);
    else corpo.innerHTML = quadroDoResumo(res);
  }

  function quadroDePedidos(res) {
    const base = res.pedidos.map((p, i) => ({ ...p, idx: i + 1 }));
    const itens = ordenarPedidos(base, P.ordem);
    const nPessoas = res.analise.resumo.pessoas;
    const ordens = [['ordem', T('palco.ordem.demo')], ['unanimes', T('palco.ordem.unanimes')], ['divididos', T('palco.ordem.divididos')]];
    return '<div class="flex items-center gap-2 pb-3 flex-wrap"><span class="text-sm text-slate-500 dark:text-slate-400">' + esc(T('palco.ordenar')) + '</span>'
      + ordens.map(([k, tx]) => '<button type="button" data-ordem="' + k + '" class="min-h-[40px] px-3.5 rounded-lg text-sm font-bold ' + (k === P.ordem ? 'bg-cyan-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200') + '">' + esc(tx) + '</button>').join('')
      + '<div class="flex-1"></div><span class="text-sm text-slate-500 dark:text-slate-400">' + esc(T(nPessoas === 1 ? 'palco.pessoasVotaram1' : 'palco.pessoasVotaram', { n: nPessoas })) + '</span></div>'
      + '<ul class="flex flex-col">' + itens.map((p) => {
        const d = P.deck[p.idx - 1] || {};
        const nome = d.name || d.address || T('card.noName');
        const total = p.n || 0;
        const rot = p.classe === 'unanime' ? ['palco.unanime', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'] : p.classe === 'dividido' ? ['palco.dividido', 'bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-300'] : null;
        return '<li><button type="button" data-pedido-abrir="' + p.idx + '" class="w-full grid grid-cols-[2rem_minmax(0,1fr)_16rem_7rem_6rem] items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/50 text-left min-h-[44px]">'
          + '<span class="text-sm font-bold text-slate-500 tnum">' + p.idx + '</span>'
          + '<span class="min-w-0"><span class="block truncate font-semibold" dir="auto">' + esc(nome) + '</span><span class="block truncate text-xs text-slate-500" dir="auto">' + esc((d.categories || [])[0] || '') + '</span></span>'
          + '<span class="flex h-4 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700">' + ['R', 'P', 'L'].map((k) => '<span class="' + COR_BARRA[k] + '" style="width:' + (total ? Math.round((p[k] || 0) * 100 / total) : 0) + '%"></span>').join('') + '</span>'
          + '<span class="text-xs font-bold tnum text-slate-600 dark:text-slate-300">' + SIMBOLO.R + (p.R || 0) + ' ' + SIMBOLO.P + (p.P || 0) + ' ' + SIMBOLO.L + (p.L || 0) + '</span>'
          + '<span>' + (rot ? '<span class="text-[0.6875rem] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ' + rot[1] + '">' + esc(T(rot[0])) + '</span>' : '') + '</span></button></li>';
      }).join('') + '</ul>';
  }

  function quadroDePessoas(res) {
    const premios = res.analise.premios || [];
    const EMOJI = { menteColetiva: '🧠', almaIndependente: '🦅', gatilho: '🎯', coracaoMole: '💚', cauteloso: '🧐', maisRapido: '⚡' };
    const detalhe = (p) => p.chave === 'maisRapido' ? T('palco.premio.maisRapido.d', { tempo: fraseDeDuracao(p.a) }) : T('palco.premio.' + p.chave + '.d', { a: p.a, b: p.b });
    const cartoes = premios.length ? '<ul class="grid grid-cols-3 gap-3">' + premios.map((p) => '<li class="' + CARTAO.replace('rounded-3xl', 'rounded-2xl') + ' p-4 flex gap-3 items-start"><span class="text-3xl leading-none" aria-hidden="true">' + (EMOJI[p.chave] || '⭐') + '</span>'
      + '<div class="min-w-0"><p class="' + ROTULO + '">' + esc(T('palco.premio.' + p.chave)) + '</p><p class="text-xl font-extrabold truncate" dir="auto">' + esc(p.nome) + '</p><p class="text-sm text-slate-500 dark:text-slate-400">' + esc(detalhe(p)) + '</p></div></li>').join('') + '</ul>'
      + '<p class="mt-3 text-xs text-slate-500 dark:text-slate-400">' + esc(T('palco.premios.regra')) + '</p>'
      : '<p class="text-base text-slate-600 dark:text-slate-300 ' + CARTAO + ' p-5">' + esc(T('palco.premios.nenhum')) + '</p>';
    const gente = P.resultado.pessoas || [];
    return cartoes + '<h3 class="mt-5 mb-2 ' + ROTULO + '">' + esc(T('palco.todos', { n: gente.length })) + '</h3><div class="flex flex-wrap gap-2">'
      + gente.slice(0, 150).map((p) => '<span class="rounded-full bg-slate-200 dark:bg-slate-700 px-3 py-1.5 text-sm font-semibold" dir="auto">' + esc(p.nome) + (p.pais ? ' <span class="font-medium text-slate-500 dark:text-slate-400">' + esc(p.pais) + '</span>' : '') + '</span>').join('') + '</div>';
  }

  function quadroDoResumo(res) {
    const r = res.analise.resumo;
    const projecao = r.projecao ? (() => {
      const sozinha = r.projecao.msPorPedido * r.projecao.fila;
      return '<hr class="border-cyan-400/40"><p class="text-lg leading-snug">' + esc(T('palco.resumo.projecao', { fila: r.projecao.fila, sozinha: fraseDeDuracao(sozinha), sala: fraseDeDuracao(sozinha / Math.max(1, r.pessoas)) })) + '</p>';
    })() : '';
    const pal = r.palpites && r.palpites.dados ? Math.round(r.palpites.certos * 100 / r.palpites.dados) + '%' : '—';
    const mini = (rot, val) => '<div><p class="' + ROTULO + '">' + esc(rot) + '</p><p class="text-3xl font-black tnum">' + esc(val) + '</p></div>';
    return '<div class="grid grid-cols-[1.3fr_1fr] gap-4"><section class="rounded-3xl bg-gradient-to-br from-cyan-600 to-cyan-800 text-white p-7 flex flex-col gap-3">'
      + '<p class="text-sm font-semibold uppercase tracking-wider text-cyan-100">' + esc(T('palco.resumo.titulo')) + '</p>'
      + '<p class="text-6xl font-black tnum leading-none">' + r.decisoes + ' <span class="text-2xl font-bold text-cyan-100">' + esc(T('palco.resumo.decisoes')) + '</span></p>'
      + '<p class="text-xl font-semibold">' + esc(T('palco.resumo.conta', { pessoas: r.pessoas, total: r.total })) + (r.duracaoMs ? ' · ' + esc(fraseDeDuracao(r.duracaoMs)) : '') + '</p>' + projecao + '</section>'
      + '<section class="flex flex-col gap-3"><div class="' + CARTAO.replace('rounded-3xl', 'rounded-2xl') + ' p-4"><p class="' + ROTULO + ' mb-2">' + esc(T('palco.resumo.votos')) + '</p>' + barras(r.votos, false) + '</div>'
      + '<div class="' + CARTAO.replace('rounded-3xl', 'rounded-2xl') + ' p-4 flex gap-6 flex-wrap">' + mini(T('palco.resumo.paises'), r.paises ? String(r.paises) : '—') + mini(T('palco.resumo.palpites'), pal) + mini(T('palco.resumo.unanimes'), String(r.unanimes)) + '</div></section></div>'
      + '<p class="mt-4 text-sm text-slate-500 dark:text-slate-400">' + esc(T('palco.resumo.rodape')) + '</p>';
  }

  // ═════════════════════════════ início ═════════════════════════════
  function iniciar() {
    aplicarTema(); aplicarIdioma(); escalar();
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarTema); } catch (e) { /* sem escuta */ }

    // A chave sumiu do aparelho («Sair» no app, troca de conta): o palco solta o controle na hora.
    window.addEventListener('storage', (e) => {
      if (e.key !== null && e.key !== CHAVE_DO_PALCO) return;
      if (lerChave()) return;
      P.perdeu = true;
      if (fluxoDoPalco) fluxoDoPalco.parar();
      P.chave = null; P.visao = null; P.resultado = null; P.detalhe = null;
      P.estado = 'semChave';
      const camada = $('palcoDetalhe'); if (camada) camada.remove();
      esconderAviso();
      montar('semChave');
    });

    // Teclado (o do apresentador no laptop). Ctrl, ⌘ e Alt são do navegador; com o campo do recado em foco,
    // o campo manda.
    document.addEventListener('keydown', (e) => {
      if (atalhoDoNavegador(e) || e.repeat) return;
      const alvo = e.target;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') { if (P.detalhe !== null) { fecharDetalhe(); e.preventDefault(); } else if (P.recadoAberto) { fecharRecado(); e.preventDefault(); } else if (P.confirmandoEncerrar) cancelarEncerrar(); return; }
      if (alvo && (alvo.tagName === 'BUTTON' || alvo.tagName === 'A') && (e.key === ' ' || e.key === 'Enter')) return;   // o botão focado age por si
      if (P.detalhe !== null) return;
      const acao = acaoDaTecla(e.key, P.visao);
      if (!acao) return;
      e.preventDefault();
      executar(acao);
    });

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && fluxoDoPalco && !P.perdeu) fluxoDoPalco.acordar(); });
    document.addEventListener('fullscreenchange', () => {
      for (const b of document.querySelectorAll('[data-acao="telacheia"]')) b.textContent = document.fullscreenElement ? T('palco.telaCheiaSair') : T('palco.telaCheia');
    });
    window.addEventListener('offline', () => { if (fluxoDoPalco && !P.perdeu) fluxoDoPalco.caiu(); });
    window.addEventListener('online', () => { if (fluxoDoPalco && !P.perdeu) fluxoDoPalco.voltouARede(); });
    window.addEventListener('resize', () => { for (const b of document.querySelectorAll('[data-mapa]')) { const p = P.deck[+b.dataset.mapa - 1]; if (p) { b.dataset.pronto = ''; requestAnimationFrame(() => desenharMapa(b, p)); } } });

    abrir();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
