// js/demo.js — a página do CONVIDADO da demo (/demo#<segredo>).
//
// Pública e sem sessão: a pessoa entra pelo link (ou pelo código curto), escolhe
// um apelido e tria os MESMOS pedidos que o apresentador escolheu — o card é o
// do app (cópia do <template>), o gesto é o do app (swipe.js), mas NADA vai ao
// Waze: o voto vai pra sala (`/api/demo-votar`), e a sala é um Durable Object
// (Cloudflare) ou um arquivo (VM) — ver server/demo-sala*.mjs.
//
// O que o SERVIDOR decide (a regra do jogo) e o que esta página só DESENHA:
//   • fase (saguão → contagem → andamento ⇄ pausada → encerrada), o pedido da
//     vez e o relógio vêm na VISÃO que o servidor manda pra esta pessoa;
//   • a visão chega por um fluxo (POST + text/event-stream lido por `fetch`: o
//     segredo vai no CORPO, nunca na URL) e o estado é sempre o INTEIRO — por
//     isso reconectar é só abrir de novo, sem remendo de mensagem perdida;
//   • o voto é OTIMISTA (o card sai na hora) e vale a PRIMEIRA escolha (sem
//     Desfazer); a retentativa é idempotente (`repetido`).
//
// Script clássico em IIFE: o nome de topo não disputa o escopo global com o
// i18n.js/swipe.js/mapa.js desta página (gotcha #64). O que um teste precisa
// ver sem navegador sai em `window.DemoPuro`.
(function () {
  'use strict';

  // ── constantes (espelham o servidor; test/demo-pagina.test.mjs confere) ──
  const SEGREDO_LEN = 20;
  const CODIGO_LEN = 6;
  const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const APELIDO_MAX = 20;
  const PAIS_MAX = 40;
  const RECADO_MS = 6000;
  const VOTO_TENTATIVAS = 20;
  const CHAVE_PARTICIPANTE = 'demo_participante';   // só nesta página; sem login, sem "Sair"

  // ── funções puras (testáveis sem DOM) ────────────────────────────────────

  // Só o que o alfabeto aceita, maiúsculo, no formato do que o apresentador vê
  // («K7Q-2M9»): quem digita, cola ou ouve ditado entra do mesmo jeito.
  function formatarCodigo(bruto) {
    const s = String(bruto == null ? '' : bruto).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODIGO_LEN);
    return s.length > 3 ? s.slice(0, 3) + '-' + s.slice(3) : s;
  }
  const codigoPronto = (s) => formatarCodigo(s).replace('-', '').length === CODIGO_LEN;

  // O segredo do link: tolera o `#` e espaços de quem copiou com o texto em volta.
  function segredoDoHash(hash) {
    const s = String(hash || '').replace(/^#/, '').trim().toUpperCase();
    if (s.length !== SEGREDO_LEN) return null;
    for (const c of s) if (!ALFABETO.includes(c)) return null;
    return s;
  }

  // Corta em PONTOS DE CÓDIGO (emoji não vira meio caractere), como o servidor.
  const cortar = (s, n) => [...String(s == null ? '' : s)].slice(0, n).join('');

  // Id desta pessoa na sala: aleatório, 22 símbolos de base64url (o servidor
  // aceita [A-Za-z0-9_-]{16,40}).
  function novaParte() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    let bin = '';
    for (const x of b) bin += String.fromCharCode(x);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // O voto de uma pessoa no pedido `idx` (1-based): a palavra do SERVIDOR vale;
  // o que ainda está saindo (otimista) completa. '-' = nada.
  function votoEm(votos, pendentes, idx) {
    const s = typeof votos === 'string' ? votos[idx - 1] : undefined;
    if (s && s !== '-') return s;
    return (pendentes && pendentes.get(idx)) || null;
  }

  // O pedido que esta pessoa vê agora, e por que não há nenhum.
  //   sinc  → o da vez (`atual`), se ainda não votou nele; senão espera a sala
  //   livre → o primeiro que ainda não votou; senão terminou
  function pedidoDaVez(v, pendentes) {
    if (!v || v.fase !== 'andamento' && v.fase !== 'pausada') return { idx: null, motivo: 'fase' };
    if (v.modo === 'sinc') {
      if (!v.atual) return { idx: null, motivo: 'fase' };
      if (v.revelado) return { idx: null, motivo: 'revelado' };
      return votoEm(v.votos, pendentes, v.atual) ? { idx: null, motivo: 'votou' } : { idx: v.atual, motivo: null };
    }
    for (let i = 1; i <= v.total; i++) if (!votoEm(v.votos, pendentes, i)) return { idx: i, motivo: null };
    return { idx: null, motivo: 'terminou' };
  }

  // Qual TELA a visão pede. Uma função só, pura: a tela nunca é decidida por um
  // `if` solto no meio do desenho.
  function telaDaVisao(v, pendentes) {
    if (!v) return 'abrindo';
    if (v.fora) return 'entrada';
    if (v.fase === 'encerrada') return 'fim';
    if (v.fase === 'saguao') return 'saguao';
    if (v.fase === 'contagem') return 'contagem';
    const { idx, motivo } = pedidoDaVez(v, pendentes);
    if (idx) return 'triagem';
    if (motivo === 'revelado') return 'revelacao';
    if (motivo === 'votou') return 'aguarda';
    if (motivo === 'terminou') return 'fim';
    return 'aguarda';
  }

  // Quem ganhou a sala, em percentuais inteiros que somam 100 (maior resto) —
  // três barras de 33% não podem somar 99.
  function percentuais(c) {
    const chaves = ['R', 'P', 'L'];
    const n = chaves.reduce((a, k) => a + (c[k] || 0), 0);
    if (!n) return { R: 0, P: 0, L: 0 };
    const exato = chaves.map((k) => ({ k, v: (c[k] || 0) * 100 / n }));
    const out = {};
    let soma = 0;
    for (const e of exato) { out[e.k] = Math.floor(e.v); soma += out[e.k]; }
    exato.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
    for (let i = 0; soma < 100; i++, soma++) out[exato[i % 3].k]++;
    return out;
  }

  const contarVotos = (votos) => {
    const c = { R: 0, L: 0, P: 0, n: 0 };
    for (const x of String(votos || '')) if (x === 'R' || x === 'L' || x === 'P') { c[x]++; c.n++; }
    return c;
  };

  window.DemoPuro = {
    formatarCodigo, codigoPronto, segredoDoHash, cortar, votoEm, pedidoDaVez, telaDaVisao, percentuais, contarVotos,
    SEGREDO_LEN, CODIGO_LEN, APELIDO_MAX, PAIS_MAX, ALFABETO, RECADO_MS,
  };

  // Em Node (um teste que carrega só as funções puras) não há página.
  if (typeof document === 'undefined') return;

  // ═════════════════════════════════════════════════════════════════════════
  //  A página
  // ═════════════════════════════════════════════════════════════════════════
  const $ = (id) => document.getElementById(id);
  const TELAS = ['abrindo', 'erro', 'codigo', 'entrada', 'saguao', 'contagem', 'triagem', 'aguarda', 'revelacao', 'fim'];

  const E = {
    segredo: null,
    demo: null,            // id da sala (o servidor devolve; não é o segredo)
    cfg: null,
    deck: [],
    parte: null,
    nome: null,
    visao: null,
    seq: -1,
    desvio: 0,             // relógio do servidor − relógio daqui (ms)
    pendentes: new Map(),  // idx → voto que ainda não pousou
    palpitesPendentes: new Map(),
    cardIdx: null,
    card: null,
    tela: null,
    recadoVisto: -1,
    encerrou: false,
  };

  // Ctrl, ⌘ ou Alt com uma tecla é do NAVEGADOR (Alt+← é "voltar"): a mesma regra do
  // app, copiada porque as duas páginas não compartilham escopo — e travada IGUAL
  // à do app.js em test/atalhos-do-navegador.test.mjs.
  function atalhoDoNavegador(e) {
    return !!(e && (e.ctrlKey || e.metaKey || e.altKey));
  }

  // ── tema e idioma ────────────────────────────────────────────────────────
  // A página não tem o script inline do tema (a CSP só autoriza o do app, por
  // hash): segue o SISTEMA, pelo js.
  function aplicarTema() {
    let escuro = false;
    try { escuro = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { /* claro */ }
    document.documentElement.classList.toggle('dark', escuro);
    document.documentElement.classList.toggle('tema-claro', !escuro);
    document.body.classList.toggle('dark', escuro);
  }

  // ── armazenamento: só o que faz a pessoa voltar à MESMA sala ao recarregar ──
  function lerParticipante() {
    try {
      const o = JSON.parse(localStorage.getItem(CHAVE_PARTICIPANTE) || 'null');
      return o && typeof o === 'object' && typeof o.parte === 'string' && typeof o.ref === 'string' ? o : null;
    } catch (e) { return null; }
  }
  function guardarParticipante() {
    try { localStorage.setItem(CHAVE_PARTICIPANTE, JSON.stringify({ ref: E.segredo || E.demo, demo: E.demo, parte: E.parte, nome: E.nome })); } catch (e) { /* sem armazenamento: recarregar pede o apelido de novo */ }
  }
  function esquecerParticipante() {
    try { localStorage.removeItem(CHAVE_PARTICIPANTE); } catch (e) { /* idem */ }
  }

  // ── rede ─────────────────────────────────────────────────────────────────
  async function api(rota, corpo, prazoMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), prazoMs || 15000);
    try {
      const r = await fetch('/api/' + rota, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: ctl.signal,
      });
      let body = null;
      try { body = await r.json(); } catch (e) { body = null; }
      return { status: r.status, ok: r.ok && !!body && body.success !== false, body: body || {} };
    } finally { clearTimeout(timer); }
  }

  // A frase de um erro do servidor: pela CHAVE, na língua da pessoa.
  function frase(body) {
    const k = body && body.errorKey;
    if (k && t(k) !== k) return t(k, body.errorVars);
    return t('demo.erro.generico');
  }

  // ── telas ────────────────────────────────────────────────────────────────
  const ID_DA_TELA = {
    abrindo: 'telaAbrindo', erro: 'telaErro', codigo: 'telaCodigo', entrada: 'telaEntrada', saguao: 'telaSaguao',
    contagem: 'telaContagem', triagem: 'telaTriagem', aguarda: 'telaAguarda', revelacao: 'telaRevelacao', fim: 'telaFim',
  };
  function mostrar(tela) {
    E.tela = tela;
    for (const n of TELAS) $(ID_DA_TELA[n]).classList.toggle('hidden', n !== tela);
  }
  function erroFatal(texto, comCodigo) {
    pararFluxo();
    $('telaErroTexto').textContent = texto;
    $('erroCodigo').classList.toggle('hidden', !comCodigo);
    mostrar('erro');
  }

  // ── a abertura ───────────────────────────────────────────────────────────
  async function abrir(corpo) {
    mostrar('abrindo');
    let r;
    try { r = await api('demo-abrir', corpo); } catch (e) { return erroFatal(t('demo.rede.semSinal'), false); }
    if (!r.ok) return erroFatal(frase(r.body), r.status === 404 || r.status === 400);
    E.demo = r.body.demo;
    E.cfg = r.body.cfg;
    E.deck = Array.isArray(r.body.convidado) ? r.body.convidado : [];
    const salvo = lerParticipante();
    if (salvo && (salvo.demo === E.demo || salvo.ref === E.segredo)) { E.parte = salvo.parte; E.nome = salvo.nome; }
    if (E.parte && corpo.parte === undefined) {
      // Quem recarregou: pede a visão DELE (`parte`), não a de um estranho.
      try { r = await api('demo-abrir', { ...corpo, parte: E.parte }); } catch (e) { return erroFatal(t('demo.rede.semSinal'), false); }
      if (r.ok) { E.cfg = r.body.cfg; E.deck = r.body.convidado || E.deck; }
    }
    const v = r.body.visao;
    if (v && v.fora && v.fase === 'encerrada') return erroFatal(t('srv.err.demoEncerrada'), false);
    if (v && v.fora) E.parte = null;
    if (v && v.nome) E.nome = v.nome;
    aplicarVisao(v);
    if (E.parte && E.nome && !(v && v.fora)) conectar();
  }

  // ── a entrada ────────────────────────────────────────────────────────────
  function prepararEntrada() {
    const n = E.cfg ? E.cfg.total : 0;
    $('entradaSub').textContent = t(n === 1 ? 'demo.entrada.sub1' : 'demo.entrada.sub', { n });
    mostrar('entrada');
    setTimeout(() => { try { $('apelidoCampo').focus({ preventScroll: true }); } catch (e) { /* sem foco */ } }, 50);
  }
  async function entrar(ev) {
    ev.preventDefault();
    const apelido = cortar($('apelidoCampo').value.trim(), APELIDO_MAX);
    const erro = $('entradaErro');
    erro.classList.add('hidden');
    if (!apelido) { erro.textContent = t('srv.err.demoApelido'); erro.classList.remove('hidden'); $('apelidoCampo').focus(); return; }
    const botao = $('entradaBtn');
    botao.disabled = true;
    const parte = E.parte || novaParte();
    let r;
    try { r = await api('demo-entrar', { demo: E.demo, parte, apelido, pais: cortar($('paisCampo').value.trim(), PAIS_MAX) }); }
    catch (e) { botao.disabled = false; erro.textContent = t('demo.rede.semSinal'); erro.classList.remove('hidden'); return; }
    botao.disabled = false;
    if (!r.ok) {
      const m = r.body && r.body.motivo;
      if (m === 'encerrada' || m === 'prazo' || m === 'cheia') return erroFatal(frase(r.body), false);
      erro.textContent = frase(r.body);
      erro.classList.remove('hidden');
      return;
    }
    E.parte = parte;
    E.nome = r.body.nome || apelido;
    guardarParticipante();
    aplicarVisao(r.body.visao);
    conectar();
  }

  // ── o código curto ───────────────────────────────────────────────────────
  async function entrarComCodigo(ev) {
    ev.preventDefault();
    const campo = $('codigoCampo');
    const erro = $('codigoErro');
    erro.classList.add('hidden');
    if (!codigoPronto(campo.value)) { erro.textContent = t('srv.err.demoLinkInvalido'); erro.classList.remove('hidden'); campo.focus(); return; }
    $('codigoEntrar').disabled = true;
    let r;
    try { r = await api('demo-abrir', { codigo: campo.value.replace('-', '') }); }
    catch (e) { $('codigoEntrar').disabled = false; erro.textContent = t('demo.rede.semSinal'); erro.classList.remove('hidden'); return; }
    $('codigoEntrar').disabled = false;
    if (!r.ok) { erro.textContent = frase(r.body); erro.classList.remove('hidden'); return; }
    // Daqui em diante é a mesma sala do link: o id dela, e o segredo nunca existiu aqui.
    E.segredo = null;
    E.demo = r.body.demo; E.cfg = r.body.cfg; E.deck = r.body.convidado || [];
    const salvo = lerParticipante();
    if (salvo && salvo.demo === E.demo) { E.parte = salvo.parte; E.nome = salvo.nome; }
    if (E.parte) {
      try { r = await api('demo-abrir', { codigo: campo.value.replace('-', ''), parte: E.parte }); } catch (e) { /* segue sem a visão dele */ }
      if (r.ok && r.body.visao && r.body.visao.nome) { E.nome = r.body.visao.nome; aplicarVisao(r.body.visao); conectar(); return; }
      E.parte = null;
    }
    aplicarVisao(r.body.visao);
  }

  // ── o fluxo (SSE por fetch): o leitor é o js/demo-fluxo.js, o MESMO do palco ──
  let fluxo = null;
  function fluxoDaSala() {
    if (!fluxo) {
      fluxo = window.DemoFluxo.criar({
        corpo: () => ({ demo: E.demo, parte: E.parte }),
        aoEstado: aplicarVisao,
        encerrou: () => E.encerrou,
        aoRecusa: (corpo) => {
          if (corpo.motivo === 'fora-da-sala') { reentrar(); return 'parar'; }
          if (corpo.motivo === 'cheia') avisarRede(t('srv.err.demoCheia'), true);
          return 'religar';
        },
        aoRede: (e) => { if (e === 'caiu') avisarRede(t('demo.rede.caiu'), true); else avisarRede(t('demo.rede.voltou'), false, 1500); },
      });
    }
    return fluxo;
  }
  function pararFluxo() { if (fluxo) fluxo.parar(); }
  function conectar() {
    if (E.encerrou || !E.demo || !E.parte) return;
    fluxoDaSala().conectar();
  }
  // O servidor não conhece mais esta parte (a sala foi refeita, ou a pessoa nunca
  // entrou): volta à entrada, com o apelido que ela já tinha.
  async function reentrar() {
    pararFluxo();
    if (E.nome && E.parte) {
      try {
        const r = await api('demo-entrar', { demo: E.demo, parte: E.parte, apelido: E.nome, pais: '' });
        if (r.ok) { aplicarVisao(r.body.visao); conectar(); return; }
      } catch (e) { /* cai na entrada */ }
    }
    E.parte = null; E.visao = null; E.seq = -1;
    esquecerParticipante();
    prepararEntrada();
  }
  function avisarRede(texto, fica, ms) {
    const caixa = $('demoRede');
    $('demoRedeTexto').textContent = texto;
    caixa.classList.remove('hidden');
    clearTimeout(avisarRede.t);
    if (!fica) avisarRede.t = setTimeout(() => caixa.classList.add('hidden'), ms || 1500);
  }

  // ── a visão chegou ───────────────────────────────────────────────────────
  function aplicarVisao(v) {
    if (!v) return;
    if (typeof v.seq === 'number') {
      if (v.seq < E.seq) return;               // uma visão velha chegando atrasada
      E.seq = v.seq;
    }
    if (typeof v.agora === 'number') E.desvio = v.agora - Date.now();
    // O que o servidor já confirma sai da lista de pendentes.
    for (const [idx] of E.pendentes) if (typeof v.votos === 'string' && v.votos[idx - 1] && v.votos[idx - 1] !== '-') E.pendentes.delete(idx);
    for (const [idx] of E.palpitesPendentes) if (typeof v.palpites === 'string' && v.palpites[idx - 1] && v.palpites[idx - 1] !== '-') E.palpitesPendentes.delete(idx);
    E.visao = v;
    if (v.fase === 'encerrada') E.encerrou = true;
    if (v.recado && v.recado.n !== E.recadoVisto) mostrarRecado(v.recado);
    desenhar();
  }

  const agoraServidor = () => Date.now() + E.desvio;

  function desenhar() {
    const v = E.visao;
    const tela = telaDaVisao(v, E.pendentes);
    $('telaPausa').classList.toggle('hidden', !(v && v.fase === 'pausada'));
    if (tela === 'entrada') { if (E.tela !== 'entrada') prepararEntrada(); return; }
    if (tela !== E.tela) mostrar(tela);
    if (tela !== 'triagem') descartarCard();
    switch (tela) {
      case 'saguao': desenharSaguao(v); break;
      case 'contagem': desenharContagem(v); break;
      case 'triagem': desenharTriagem(v); break;
      case 'aguarda': desenharAguarda(v); break;
      case 'revelacao': desenharRevelacao(v); break;
      case 'fim': desenharFim(v); break;
      default: break;
    }
    ajustarRelogios(v);
  }

  // ── saguão e contagem ────────────────────────────────────────────────────
  function desenharSaguao(v) {
    $('saguaoNome').textContent = E.nome || '';
    const n = v.naSala || 0;
    $('saguaoQuantos').textContent = t(n === 1 ? 'demo.saguao.quantos1' : 'demo.saguao.quantos', { n });
    const lista = $('saguaoNomes');
    lista.textContent = '';
    const nomes = Array.isArray(v.nomes) ? v.nomes : [];
    for (const nome of nomes.slice(0, 60)) {
      const li = document.createElement('li');
      li.className = 'text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200 rounded-full px-2.5 py-1 max-w-[10rem] truncate';
      li.dir = 'auto';
      li.textContent = nome;
      lista.appendChild(li);
    }
    if (nomes.length > 60) {
      const li = document.createElement('li');
      li.className = 'text-xs font-medium text-slate-500 dark:text-slate-400 px-1 py-1';
      li.textContent = '+' + (nomes.length - 60);
      lista.appendChild(li);
    }
  }
  function desenharContagem(v) {
    const falta = Math.max(1, Math.min(3, Math.ceil(((v.contagemAte || 0) - agoraServidor()) / 1000)));
    $('contagemNumero').textContent = String(falta);
  }

  // ── a triagem ────────────────────────────────────────────────────────────
  function faixa(v, idx) {
    $('faixaPedido').textContent = t('demo.faixa.pedido', { i: idx, n: v.total });
    if (v.modo === 'sinc') {
      $('faixaVotaram').textContent = (v.votaram || 0) > 0 ? t('demo.faixa.votaram', { a: v.votaram }) : '';
    } else {
      $('faixaVotaram').textContent = t('demo.faixa.feitos', { a: v.feitos || 0, n: v.total });
    }
  }
  function podeVotar() {
    const v = E.visao;
    if (!v || v.fase !== 'andamento' || !E.card) return false;
    const idx = +E.card.dataset.idx;
    if (votoEm(v.votos, E.pendentes, idx)) return false;
    if (v.modo === 'sinc' && (v.atual !== idx || v.revelado)) return false;
    return true;
  }
  function descartarCard() {
    if (E.card && E.card.parentNode) E.card.remove();
    E.card = null; E.cardIdx = null;
  }
  function desenharTriagem(v) {
    const { idx } = pedidoDaVez(v, E.pendentes);
    $('demoVazio').classList.add('hidden');
    faixa(v, idx);
    if (E.cardIdx === idx && E.card) return;      // o card certo já está na tela: não se refaz por causa de contagem
    descartarCard();
    const place = E.deck[idx - 1];
    if (!place) { $('demoVazio').textContent = t('demo.erro.generico'); $('demoVazio').classList.remove('hidden'); return; }
    const card = montarCard(place, idx);
    $('demoCardStack').appendChild(card);
    E.card = card; E.cardIdx = idx;
    if (window.enableSwipeOnCard) window.enableSwipeOnCard(card);
    requestAnimationFrame(() => { desenharMapaDoCard(card, place); });
  }

  // O rótulo de um enum pela chave do dicionário, ou o enum legível (feio, nunca invisível).
  function rotuloEnum(prefixo, valor) {
    if (!valor) return '';
    const k = prefixo + valor;
    const s = t(k);
    if (s !== k) return s;
    const h = String(valor).replace(/_/g, ' ').trim().toLowerCase();
    return h.charAt(0).toUpperCase() + h.slice(1);
  }
  function escreverValor(el, valor, chaveVazio) {
    if (valor) { el.textContent = valor; el.classList.remove('valor-ausente'); }
    else { el.textContent = t(chaveVazio); el.classList.add('valor-ausente'); }
  }
  function idade(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const dif = Date.now() - ts;
    try {
      const f = new Intl.RelativeTimeFormat(window.i18nLocale(), { numeric: 'auto', style: 'narrow' });
      const min = Math.floor(dif / 60000);
      if (min < 1) return f.format(0, 'second');
      if (min < 60) return f.format(-min, 'minute');
      const h = Math.floor(min / 60);
      if (h < 24) return f.format(-h, 'hour');
      const d = Math.floor(h / 24);
      if (d < 30) return f.format(-d, 'day');
      if (d < 365) return f.format(-Math.round(d / 30), 'month');
      return new Date(ts).toLocaleDateString(window.i18nLocale(), { year: 'numeric' });
    } catch (e) { return null; }
  }
  function valorDoDiff(v) {
    if (v === null || v === undefined) return t('card.value.empty');
    if (v === true) return t('card.value.yes');
    if (v === false) return t('card.value.no');
    if (v === '') return t('card.value.unnamed');
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }
  function rotuloDoCampo(m) {
    const k = 'card.field.' + m.field;
    const s = t(k);
    return s === k ? (m.label || m.field) : s;
  }

  function montarCard(p, idx) {
    const molde = $('cardTemplate');
    const card = molde.content.cloneNode(true).querySelector('.place-card');
    window.applyI18n(card);
    card.dataset.idx = String(idx);
    const q = (s) => card.querySelector(s);

    // Identidade: nome → endereço → «(local sem nome)». O selo marca o que o nome não diz.
    const semNome = !p.name;
    const titulo = p.name || p.address || t('card.noName');
    const elNome = q('.card-name');
    elNome.textContent = titulo;
    elNome.classList.toggle('valor-ausente', !p.name && !p.address);
    elNome.classList.toggle('titulo-endereco', semNome && !!p.address);
    q('.card-no-name-badge').classList.toggle('hidden', !semNome);
    escreverValor(q('.card-category'), (p.categories || []).join(', '), 'card.categories.empty');
    q('.card-address-row').classList.toggle('hidden', semNome && !!p.address);
    escreverValor(q('.card-address'), p.address, 'card.address.empty');

    const tipo = (p.changes && p.changes.length) ? t('card.type.update')
      : p.flagSubjectType === 'IMAGE' ? t('card.type.flagImage')
      : (rotuloEnum('card.updateType.', p.updateTypeKey) || p.updateType || '');
    escreverValor(q('.card-type'), tipo, 'card.type.empty');
    const quando = idade(p.dateAdded);
    if (quando) {
      const el = q('.card-age');
      el.textContent = quando;
      el.title = new Date(p.dateAdded).toLocaleString(window.i18nLocale());
      el.classList.remove('hidden');
    }
    q('.card-delete-banner').classList.toggle('hidden', !p.isDelete);
    // O mapa da demo é só figura: sem o "toque para ampliar" que o app tem.
    const caixaMapa = q('.card-map');
    for (const a of ['title', 'data-i18n-title', 'tabindex']) caixaMapa.removeAttribute(a);
    caixaMapa.setAttribute('role', 'img');
    caixaMapa.setAttribute('aria-label', t('card.map.slide'));
    caixaMapa.removeAttribute('data-i18n-aria');

    // O motivo do reporte (sem o texto livre: a demo não o recebe).
    if (p.flagType) {
      const el = q('.card-flag-reason');
      const alvo = p.duplicado && p.duplicado.nome;
      const txt = p.flagType === 'DUPLICATE' && alvo ? t('card.flagDuplicateOf', { alvo }) : rotuloEnum('card.flagType.', p.flagType);
      const v = q('.card-flag-reason-value');
      v.textContent = txt;
      v.title = txt;
      el.classList.remove('hidden');
    }
    if (p.brand) {
      q('.card-brand-row').classList.remove('hidden');
      q('.card-brand').textContent = p.brand;
      q(p.brandKnown ? '.card-brand-known' : '.card-brand-unknown').classList.remove('hidden');
    }

    // O diff: «campo: antes → depois».
    const mud = Array.isArray(p.changes) ? p.changes : [];
    if (mud.length) {
      q('.card-changes').classList.remove('hidden');
      const lista = q('.card-changes-list');
      for (const m of mud) {
        const linha = document.createElement('div');
        linha.className = 'text-sm leading-snug';
        const rot = document.createElement('span');
        rot.className = 'font-semibold text-slate-700 dark:text-slate-200';
        rot.textContent = rotuloDoCampo(m) + ': ';
        const de = document.createElement('span');
        de.className = 'text-rose-700 dark:text-rose-300 line-through break-words';
        de.dir = 'auto';
        de.textContent = valorDoDiff(m.from);
        const seta = document.createTextNode(' → ');
        const para = document.createElement('span');
        para.className = 'text-emerald-700 dark:text-emerald-300 font-medium break-words';
        para.dir = 'auto';
        para.textContent = valorDoDiff(m.to);
        linha.append(rot, de, seta, para);
        lista.appendChild(linha);
      }
    } else if ((p.camposSemMudanca || 0) > 0) {
      q('.card-sem-diferenca').classList.remove('hidden');
      q('.card-sem-diferenca').classList.add('flex');
    }

    montarSlides(card, p);

    // Botões: o MESMO caminho do gesto (o swipe anima e chama o voto).
    q('.card-btn-reject').addEventListener('click', () => window.triggerSwipe('left', (c) => votarNoCard(c, 'R')));
    q('.card-btn-skip').addEventListener('click', () => window.triggerSwipe('up', (c) => votarNoCard(c, 'P')));
    q('.card-btn-read').addEventListener('click', () => window.triggerSwipe('right', (c) => votarNoCard(c, 'L')));
    return card;
  }

  // O carrossel da foto: [mapa?] + fotos. O mapa vem primeiro quando é a prova do
  // pedido (mudou de lugar, nova entrada) ou quando não há foto.
  function slidesDoPedido(p) {
    const fotos = (p.imageUrls || []).map((u) => ({ tipo: 'foto', url: u }));
    const mapa = p.mapa ? [{ tipo: 'mapa' }] : [];
    const espacial = (p.changes || []).some((c) => c.field === 'geometry' || c.field === 'entryExitPoints');
    return !fotos.length || espacial ? [...mapa, ...fotos] : [...fotos, ...mapa];
  }
  function montarSlides(card, p) {
    const slides = slidesDoPedido(p);
    const img = card.querySelector('.card-image');
    const mapa = card.querySelector('.card-map');
    const sem = card.querySelector('.card-no-image');
    const nav = card.querySelector('.card-image-nav');
    const cont = card.querySelector('.card-image-count');
    card._slides = slides; card._slide = 0;
    const ir = (i) => {
      card._slide = (i + slides.length) % slides.length;
      const s = slides[card._slide];
      img.classList.toggle('hidden', !(s && s.tipo === 'foto'));
      mapa.classList.toggle('hidden', !(s && s.tipo === 'mapa'));
      sem.classList.toggle('hidden', !!s);
      if (s && s.tipo === 'foto') { img.alt = ''; img.src = s.url; }
      cont.textContent = (card._slide + 1) + '/' + slides.length;
      if (s && s.tipo === 'mapa' && card.isConnected) desenharMapaDoCard(card, p);
    };
    card._ir = ir;
    nav.classList.toggle('hidden', slides.length < 2);
    card.querySelector('.card-image-prev').addEventListener('click', (e) => { e.stopPropagation(); ir(card._slide - 1); });
    card.querySelector('.card-image-next').addEventListener('click', (e) => { e.stopPropagation(); ir(card._slide + 1); });
    img.addEventListener('error', () => { img.classList.add('hidden'); sem.classList.remove('hidden'); });
    ir(0);
  }

  // O mapinha: os tiles do próprio Waze, com os marcadores do pedido.
  function pontosDoMapa(p) {
    const m = p.mapa;
    if (!m) return [];
    const pontos = [];
    if (m.centro) pontos.push({ ll: m.centro, cls: 'mapa-atual', rot: m.proposto ? 'card.map.antes' : 'card.map.aqui' });
    if (m.proposto) pontos.push({ ll: m.proposto, cls: 'mapa-proposto', rot: 'card.map.depois' });
    for (const e of m.entradas || []) pontos.push({ ll: e.ll, cls: 'mapa-entrada mapa-e-' + e.estado, rot: 'card.map.entrada.' + e.estado, nome: e.nome });
    if (p.duplicado && p.duplicado.ll) pontos.push({ ll: p.duplicado.ll, cls: 'mapa-duplicado', rot: 'card.map.duplicado', nome: p.duplicado.nome });
    return pontos;
  }
  function desenharMapaDoCard(card, p) {
    const box = card.querySelector('.card-map');
    if (!box || !p.mapa || !window.mapaMontar || box.classList.contains('hidden')) return;
    const w = box.clientWidth || 400, h = box.clientHeight || 240;
    if (box.dataset.pronto === w + 'x' + h) return;
    const pontos = pontosDoMapa(p);
    const r = window.mapaMontar(pontos.map((x) => x.ll), w, h, (E.cfg && E.cfg.regiao) || 'row');
    if (!r) return;
    box.dataset.pronto = w + 'x' + h;
    const tiles = box.querySelector('.card-map-tiles');
    const marks = box.querySelector('.card-map-marks');
    tiles.textContent = ''; marks.textContent = '';
    for (const tl of r.tiles) {
      const im = new Image();
      im.src = tl.url; im.alt = ''; im.decoding = 'async'; im.draggable = false;
      im.className = 'absolute mapa-tile';
      im.style.cssText = `left:${tl.left}px;top:${tl.top}px;width:${r.tamanho}px;height:${r.tamanho}px`;
      im.onerror = () => im.remove();
      tiles.appendChild(im);
    }
    const idx = r.idx || r.pixels.map((_, k) => k);
    r.pixels.forEach((px, k) => {
      const pt = pontos[idx[k]];
      const el = document.createElement('span');
      el.className = 'mapa-marca ' + pt.cls;
      el.style.cssText = `left:${px.left}px;top:${px.top}px`;
      el.title = pt.nome ? `${t(pt.rot)} — ${pt.nome}` : t(pt.rot);
      marks.appendChild(el);
    });
    if (r.foraDoMapa && r.foraDoMapa.length) {
      const aviso = document.createElement('span');
      aviso.className = 'mapa-fora';
      aviso.textContent = t('card.map.foraDoMapa.semDist');
      marks.appendChild(aviso);
    }
    const leg = box.querySelector('.card-map-legend');
    leg.textContent = '';
    const ja = new Set();
    const desenhados = new Set(idx);
    pontos.forEach((pt, i) => {
      if (!desenhados.has(i) || ja.has(pt.rot)) return;
      ja.add(pt.rot);
      const s = document.createElement('span');
      s.className = 'mapa-leg';
      const marca = document.createElement('span');
      marca.className = 'mapa-marca ' + pt.cls;
      s.appendChild(marca);
      s.appendChild(document.createTextNode(t(pt.rot)));
      leg.appendChild(s);
    });
    const esc = box.querySelector('.card-map-scale');
    if (esc && window.mapaEscala) {
      const e = window.mapaEscala(r.metrosPorPixel, 80);
      if (e) {
        esc.style.width = e.px + 'px';
        esc.textContent = e.metros >= 1000 ? t('card.map.km', { n: (e.metros / 1000).toLocaleString(window.i18nLocale()) }) : t('card.map.m', { n: e.metros });
      }
    }
  }

  // ── o voto ───────────────────────────────────────────────────────────────
  function votarNoCard(card, voto) {
    const idx = +(card && card.dataset.idx);
    if (!idx) return;
    if (card.parentNode) card.remove();
    if (E.card === card) { E.card = null; E.cardIdx = null; }
    if (E.visao && votoEm(E.visao.votos, E.pendentes, idx)) { desenhar(); return; }
    E.pendentes.set(idx, voto);
    enviarVoto(idx, voto, 0);
    desenhar();
  }
  async function enviarVoto(idx, voto, tentativa) {
    if (!E.pendentes.has(idx)) return;
    let r = null;
    try { r = await api('demo-votar', { demo: E.demo, parte: E.parte, idx, voto }); } catch (e) { r = null; }
    if (!E.pendentes.has(idx)) return;
    if (r && r.ok) { if (r.body.visao) aplicarVisao(r.body.visao); E.pendentes.delete(idx); desenhar(); return; }
    const motivo = r && r.body && r.body.motivo;
    if (r && r.status < 500 && r.status !== 429) {
      // Recusa DE VERDADE (fechou, pausou, acabou): o voto não vale, e a tela volta ao que a sala diz.
      E.pendentes.delete(idx);
      if (motivo === 'fora-da-sala') { await reentrar(); return; }
      if (motivo === 'pausada') toast(t('demo.voto.pausada'));
      else if (motivo === 'fechada') toast(t('demo.voto.fechada'));
      desenhar();
      return;
    }
    // Sem rede ou servidor ruim: tenta de novo (o voto é idempotente), com recuo.
    if (tentativa >= VOTO_TENTATIVAS) { E.pendentes.delete(idx); toast(t('demo.voto.falhou')); desenhar(); return; }
    setTimeout(() => enviarVoto(idx, voto, tentativa + 1), window.DemoFluxo.recuoDaTentativa(tentativa + 1));
  }
  async function enviarPalpite(idx, palpite, tentativa) {
    if (!E.palpitesPendentes.has(idx)) return;
    let r = null;
    try { r = await api('demo-palpitar', { demo: E.demo, parte: E.parte, idx, palpite }); } catch (e) { r = null; }
    if (!E.palpitesPendentes.has(idx)) return;
    if (r && r.ok) { if (r.body.visao) aplicarVisao(r.body.visao); E.palpitesPendentes.delete(idx); desenhar(); return; }
    if (r && r.status < 500 && r.status !== 429) { E.palpitesPendentes.delete(idx); desenhar(); return; }
    if (tentativa >= 6) { E.palpitesPendentes.delete(idx); desenhar(); return; }
    setTimeout(() => enviarPalpite(idx, palpite, tentativa + 1), 1000 * (tentativa + 1));
  }

  // Um aviso curto que some sozinho (o que a trava do card diz, o voto que não saiu).
  function toast(texto) {
    const caixa = $('demoRede');
    $('demoRedeTexto').textContent = texto;
    caixa.classList.remove('hidden');
    clearTimeout(avisarRede.t);
    avisarRede.t = setTimeout(() => caixa.classList.add('hidden'), 2500);
  }

  // ── esperando a sala (modo sincronizado, depois do voto) ─────────────────
  const SIMBOLO = { R: '✕', L: '✓', P: '↑' };
  const NOME_VOTO = { R: 'card.stamp.reject', L: 'card.stamp.read', P: 'card.stamp.skip' };
  function rotuloVoto(v) { return SIMBOLO[v] + ' ' + t(NOME_VOTO[v]); }

  function desenharAguarda(v) {
    const idx = v.atual || 0;
    faixa(v, idx || 1);
    const place = E.deck[idx - 1];
    $('aguardaNome').textContent = (place && (place.name || place.address)) || t('card.noName');
    const voto = votoEm(v.votos, E.pendentes, idx);
    $('aguardaVoto').textContent = voto ? t('demo.aguarda.voto', { voto: rotuloVoto(voto) }) : '';
    const sinc = v.modo === 'sinc';
    $('aguardaTexto').textContent = sinc ? t('demo.aguarda.sala') : t('demo.aguarda.apresentador');
    // O palpite: só no modo sincronizado, depois do voto e antes da revelação.
    const palpite = sinc && typeof v.palpites === 'string' && v.palpites[idx - 1] !== '-' ? v.palpites[idx - 1] : E.palpitesPendentes.get(idx);
    const pode = sinc && !!voto && !palpite && v.fase === 'andamento';
    $('palpiteBloco').classList.toggle('hidden', !pode);
    const feito = $('palpiteFeito');
    feito.classList.toggle('hidden', !palpite);
    if (palpite) feito.textContent = t('demo.palpite.feito', { voto: rotuloVoto(palpite) });
  }
  function palpitar(p) {
    const v = E.visao;
    if (!v || v.modo !== 'sinc' || !v.atual || v.revelado) return;
    const idx = v.atual;
    if (E.palpitesPendentes.has(idx)) return;
    E.palpitesPendentes.set(idx, p);
    enviarPalpite(idx, p, 0);
    desenhar();
  }

  // ── a revelação ──────────────────────────────────────────────────────────
  function desenharRevelacao(v) {
    const idx = v.atual || 1;
    const place = E.deck[idx - 1];
    $('revNome').textContent = (place && (place.name || place.address)) || t('card.noName');
    const sala = v.sala || { R: 0, L: 0, P: 0, n: 0, maioria: null };
    const pct = percentuais(sala);
    const meu = votoEm(v.votos, E.pendentes, idx);
    const lista = $('revBarras');
    lista.textContent = '';
    for (const k of ['R', 'P', 'L']) {
      const cor = k === 'R' ? 'bg-rose-500' : k === 'P' ? 'bg-amber-500' : 'bg-emerald-500';
      const li = document.createElement('li');
      li.className = 'flex flex-col gap-1 rounded-xl px-3 py-2 ' + (meu === k ? 'ring-2 ring-cyan-500 bg-cyan-50 dark:bg-cyan-500/10' : 'bg-white dark:bg-slate-800');
      const topo = document.createElement('div');
      topo.className = 'flex items-baseline justify-between gap-2 text-sm font-semibold';
      const nome = document.createElement('span');
      nome.textContent = rotuloVoto(k) + (meu === k ? ' · ' + t('demo.rev.voce') : '');
      const num = document.createElement('span');
      num.className = 'tnum';
      num.textContent = sala[k] + ' · ' + pct[k] + '%';
      topo.append(nome, num);
      const trilho = document.createElement('div');
      trilho.className = 'h-3 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden';
      const barra = document.createElement('div');
      barra.className = 'h-full rounded-full ' + cor;
      barra.style.width = pct[k] + '%';
      trilho.appendChild(barra);
      li.append(topo, trilho);
      lista.appendChild(li);
    }
    $('revMaioria').textContent = sala.maioria ? t('demo.rev.maioria', { voto: rotuloVoto(sala.maioria) }) : (sala.n ? t('demo.rev.empate') : '');
    $('revVoce').textContent = meu ? '' : t('demo.rev.naoVotou');
    const ref = $('revRef');
    const r = v.refAtual && v.refAtual !== '-' ? v.refAtual : null;
    ref.classList.toggle('hidden', !r);
    if (r) ref.textContent = t('demo.rev.ref', { voto: rotuloVoto(r) });
    const pal = typeof v.palpites === 'string' && v.palpites[idx - 1] !== '-' ? v.palpites[idx - 1] : null;
    const pEl = $('revPalpite');
    pEl.classList.toggle('hidden', !pal);
    if (pal) {
      const acertou = !!sala.maioria && pal === sala.maioria;
      pEl.textContent = acertou ? t('demo.rev.palpiteCerto') : t('demo.rev.palpiteErrou', { voto: rotuloVoto(pal) });
      pEl.className = 'text-center text-sm font-semibold ' + (acertou ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300');
    }
  }

  // ── o fim ────────────────────────────────────────────────────────────────
  function desenharFim(v) {
    const encerrada = v.fase === 'encerrada';
    const titulo = $('fimTitulo');
    titulo.setAttribute('data-i18n', encerrada ? 'demo.fim.titulo' : 'demo.fim.terminou');
    titulo.textContent = t(encerrada ? 'demo.fim.titulo' : 'demo.fim.terminou');
    const c = contarVotos(v.votos);
    $('fimResumo').textContent = encerrada
      ? t(c.n === 1 ? 'demo.fim.resumo1' : 'demo.fim.resumo', { a: c.n, n: v.total })
      : t('demo.fim.aguarde');
    $('fimVotos').textContent = c.n ? `✕ ${c.R} · ↑ ${c.P} · ✓ ${c.L}` : '';
    const palp = contarVotos(v.palpites);
    const el = $('fimPalpites');
    el.classList.toggle('hidden', !palp.n);
    if (palp.n) el.textContent = t(palp.n === 1 ? 'demo.fim.palpites1' : 'demo.fim.palpites', { n: palp.n });
  }

  // ── o recado do apresentador ─────────────────────────────────────────────
  function mostrarRecado(r) {
    E.recadoVisto = r.n;
    const caixa = $('demoRecado');
    $('demoRecadoTexto').textContent = r.texto;
    caixa.classList.remove('hidden');
    clearTimeout(mostrarRecado.t);
    mostrarRecado.t = setTimeout(() => caixa.classList.add('hidden'), RECADO_MS);
  }

  // ── relógios (o do pedido e o 3-2-1): só desenho, a regra é do servidor ──
  function ajustarRelogios(v) {
    clearInterval(ajustarRelogios.i);
    ajustarRelogios.i = null;
    const barraCaixa = $('relogio');
    const comRelogio = !!v && v.fase === 'andamento' && v.modo === 'sinc' && v.fimEm && v.tempoMs > 0 && !v.revelado
      && (E.tela === 'triagem' || E.tela === 'aguarda');
    barraCaixa.classList.toggle('hidden', !comRelogio);
    const contagem = !!v && v.fase === 'contagem';
    if (!comRelogio && !contagem) return;
    const passo = () => {
      const agora = agoraServidor();
      if (contagem) {
        const falta = Math.max(1, Math.min(3, Math.ceil((v.contagemAte - agora) / 1000)));
        $('contagemNumero').textContent = String(falta);
        return;
      }
      const falta = Math.max(0, v.fimEm - agora);
      const f = Math.min(1, falta / v.tempoMs);
      const b = $('relogioBarra');
      b.style.transform = `scaleX(${f})`;
      b.classList.toggle('bg-cyan-500', falta > 5000);
      b.classList.toggle('bg-amber-500', falta <= 5000 && falta > 2000);
      b.classList.toggle('bg-rose-500', falta <= 2000);
    };
    passo();
    ajustarRelogios.i = setInterval(passo, 100);
  }

  // ── o que a trava do card diz ao toque ───────────────────────────────────
  let avisadoEm = 0;
  function avisarTrava() {
    if (Date.now() - avisadoEm < 3000) return;
    avisadoEm = Date.now();
    const v = E.visao;
    if (v && v.fase === 'pausada') toast(t('demo.voto.pausada'));
    else if (v && v.modo === 'sinc' && v.revelado) toast(t('demo.voto.fechada'));
  }

  // ── início ───────────────────────────────────────────────────────────────
  function iniciar() {
    window.setLang();
    aplicarTema();
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarTema); } catch (e) { /* sem escuta */ }
    window.applyI18n();

    // Ganchos do swipe.js (os mesmos nomes do app).
    window.cardDaFrente = () => E.card;
    window.acoesTravadas = () => !podeVotar();
    window.avisarTravaAoTocar = avisarTrava;
    window.direcaoTravada = () => false;
    window.onSwipeLeft = (c) => votarNoCard(c, 'R');
    window.onSwipeRight = (c) => votarNoCard(c, 'L');
    window.onSwipeUp = (c) => votarNoCard(c, 'P');

    // Campos
    $('codigoCampo').addEventListener('input', (e) => { e.target.value = formatarCodigo(e.target.value); });
    $('apelidoCampo').addEventListener('input', (e) => { const c = cortar(e.target.value, APELIDO_MAX); if (c !== e.target.value) e.target.value = c; });
    $('paisCampo').addEventListener('input', (e) => { const c = cortar(e.target.value, PAIS_MAX); if (c !== e.target.value) e.target.value = c; });
    $('telaCodigo').addEventListener('submit', entrarComCodigo);
    $('telaEntrada').addEventListener('submit', entrar);
    $('erroCodigo').addEventListener('click', () => { mostrar('codigo'); $('codigoCampo').focus(); });
    for (const b of document.querySelectorAll('.demo-palpite')) b.addEventListener('click', () => palpitar(b.dataset.palpite));

    // Teclado no card (as setas e o espaço do app; o card da demo só decide, nunca abre nada)
    document.addEventListener('keydown', (e) => {
      if (E.tela !== 'triagem' || atalhoDoNavegador(e)) return;
      const alvo = e.target;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return;
      const mapa = { ArrowLeft: ['left', 'R'], ArrowRight: ['right', 'L'], ArrowUp: ['up', 'P'] }[e.key];
      if (!mapa) return;
      e.preventDefault();
      window.triggerSwipe(mapa[0], (c) => votarNoCard(c, mapa[1]));
    });

    // Voltou pra aba (celular desbloqueado, outra aba): a conexão pode ter morrido calada.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || E.encerrou || !E.parte || !fluxo) return;
      fluxo.acordar();
    });
    // O navegador diz que a rede foi embora (ou voltou). A conexão aberta pode demorar a morrer
    // (celular entrando em túnel): avisa já, e ao voltar reabre sem esperar o recuo.
    window.addEventListener('offline', () => { if (!E.encerrou && E.parte) fluxoDaSala().caiu(); });
    window.addEventListener('online', () => { if (!E.encerrou && E.parte) fluxoDaSala().voltouARede(); });

    // Entrada: o link traz o segredo no fragmento; sem ele, o código.
    E.segredo = segredoDoHash(location.hash);
    if (E.segredo) abrir({ segredo: E.segredo });
    else { mostrar('codigo'); setTimeout(() => { try { $('codigoCampo').focus({ preventScroll: true }); } catch (e) { /* sem foco */ } }, 50); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
