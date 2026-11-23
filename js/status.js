// js/status.js — a página pública /status.html.
//
// UMA leitura de /api/status ao abrir, nada de polling (a página é estática e
// quem quiser um número mais novo recarrega; o cron do «Manter conectado» já
// recomputa a cada 30 min — ver server/status.mjs). Script CLÁSSICO, carregado
// depois de version.js e i18n.js (a MESMA fonte única de texto do app).
//
// Zero dependência de app.js/AppState: esta página não tem fila, sessão nem
// gestos — é vitrine pública, lida por qualquer um, logado ou não.

// Espelha MANTER_CRON_MIN (server/manter-conectado.mjs) — o cliente não pode
// importar o core (script clássico, zero build), então é uma CÓPIA como
// SESSAO_DIAS_EXIBIDO/MANTER_DIAS_EXIBIDO em app.js: test/consistencia.test.mjs
// confere a paridade com o servidor, pelo MESMO padrão.
const MANTER_CRON_MIN_EXIBIDO = 30;

// Espelha STATUS_ATUALIZACAO_MAX_MIN (server/status.mjs), MESMO padrão acima.
const STATUS_ATUALIZACAO_MAX_MIN_EXIBIDO = 240;

// Além do heartbeat (STATUS_ATUALIZACAO_MAX_MIN_EXIBIDO), uma folga de DOIS
// ciclos do cron — UM só apertava demais: o carimbo é gravado DEPOIS da
// varredura (0-20 s de duração), então o teto do heartbeat pode só fechar no
// ciclo SEGUINTE a quando a idade realmente passou dele, e mais o atraso de
// leitura do KV (até ~60 s) e o arredondamento de `minutosDesde`. Com folga
// de um ciclo só, uma página SAUDÁVEL passava por "desatualizado" nos
// minutos antes do heartbeat — o falso positivo que a sentinela do projeto
// proíbe (ver docs/gotchas.md #28). Depois disso, nem o heartbeat gravou —
// sinal de que a varredura pode ter parado, não só que a contagem está
// estável.
const STATUS_DESATUALIZADO_APOS_MIN = STATUS_ATUALIZACAO_MAX_MIN_EXIBIDO + 2 * MANTER_CRON_MIN_EXIBIDO;

// Zona de capacidade, por LIMIAR — pura, testável sem DOM.
function zonaDaCapacidade(manterConectado, capacidade) {
  if (manterConectado <= capacidade.confortavel) return 'tranquila';
  if (manterConectado <= capacidade.limite) return 'atencao';
  return 'cheia';
}

// "atualizado há N min" — os DOIS lados são relógio do SERVIDOR (`agora` e
// `atualizadoEm`, ambos devolvidos pelo /api/status): o relógio de quem está
// vendo a página nunca entra na conta (o mesmo motivo do `Presenca.desvio`).
function minutosDesde(agoraServidor, atualizadoEm) {
  if (!Number.isFinite(agoraServidor) || !Number.isFinite(atualizadoEm)) return null;
  return Math.max(0, Math.round((agoraServidor - atualizadoEm) / 60000));
}

// A frase do "atualizado há": com o heartbeat (STATUS_ATUALIZACAO_MAX_MIN),
// a idade normal pode passar de 1h — "atualizado há 243 min" lê mal; em horas
// e minutos fica legível em qualquer faixa.
function fraseDeAtualizacao(min) {
  if (min < 1) return t('status.sessoes.atualizadoAgora');
  if (min < 60) return t('status.sessoes.atualizado', { min });
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0
    ? t('status.sessoes.atualizadoHorasExatas', { h })
    : t('status.sessoes.atualizadoHoras', { h, min: resto });
}

// 'YYYY-MM-DD' → Date ao meio-dia UTC (nunca a meia-noite: evita o dia vizinho
// por um pelo de fuso ao formatar no locale de quem está vendo).
function dataDoDia(dia) {
  const [a, m, d] = String(dia || '').split('-').map(Number);
  if (!a || !m || !d) return null;
  return new Date(Date.UTC(a, m - 1, d, 12, 0, 0));
}

// Os pontos do SVG (polyline), normalizados pro viewBox 760×140 — mesma conta
// do mockup aprovado: menor valor encosta embaixo, maior encosta em cima.
function pontosDoGrafico(valores, { largura = 760, altura = 140, folga = 6 } = {}) {
  if (!Array.isArray(valores) || valores.length === 0) return [];
  const min = Math.min(...valores), max = Math.max(...valores);
  const amplitude = max - min || 1; // histórico de 1 dia só, ou todo-igual: não divide por zero
  return valores.map((v, i) => ({
    x: valores.length > 1 ? (i / (valores.length - 1)) * largura : largura / 2,
    y: altura - folga - ((v - min) / amplitude) * (altura - folga * 2),
  }));
}

if (typeof window !== 'undefined') {
  window.zonaDaCapacidade = zonaDaCapacidade;
  window.minutosDesde = minutosDesde;
  window.dataDoDia = dataDoDia;
  window.pontosDoGrafico = pontosDoGrafico;
}

// ── Render ───────────────────────────────────────────────────────────────
const ZONA_COR = {
  tranquila: { texto: 'text-emerald-700', fundo: 'bg-emerald-50' },
  atencao: { texto: 'text-amber-700', fundo: 'bg-amber-50' },
  cheia: { texto: 'text-rose-700', fundo: 'bg-rose-50' },
};

function montarGauge(manterConectado, capacidade) {
  const teto = Math.max(1, capacidade.tetoMedido);
  const pctVerde = Math.min(100, (capacidade.confortavel / teto) * 100);
  const pctAmbar = Math.max(0, 100 - pctVerde);
  const pctBolinha = Math.min(100, (manterConectado / teto) * 100);
  document.getElementById('gaugeVerde').style.width = pctVerde + '%';
  document.getElementById('gaugeAmbar').style.width = pctAmbar + '%';
  document.getElementById('gaugeBolinha').style.left = `calc(${pctBolinha}% - 7px)`;
  document.getElementById('gaugeTeto').textContent = String(teto);
  document.getElementById('gaugeLegenda').textContent = t('status.capacidade.legenda', { n: manterConectado, teto });
  const zona = zonaDaCapacidade(manterConectado, capacidade);
  const pill = document.getElementById('gaugeZona');
  pill.textContent = t('status.capacidade.' + zona);
  pill.className = 'text-[0.6875rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap '
    + ZONA_COR[zona].texto + ' ' + ZONA_COR[zona].fundo;
}

// Alterna os DOIS selos "ao vivo" (cabeçalho e cartão, um por breakpoint —
// nunca os dois juntos) pro estado desatualizado: cor E texto mudam junto
// (WCAG 1.4.1 — a cor nunca é o único sinal), e o ponto some de pulsar.
function marcarSeloAoVivo(idSelo, idPonto, idTexto, desatualizado) {
  const selo = document.getElementById(idSelo);
  const ponto = document.getElementById(idPonto);
  selo.classList.toggle('text-emerald-700', !desatualizado);
  selo.classList.toggle('bg-emerald-50', !desatualizado && idSelo === 'aoVivoHeader');
  selo.classList.toggle('text-slate-500', desatualizado);
  selo.classList.toggle('bg-slate-100', desatualizado && idSelo === 'aoVivoHeader');
  ponto.classList.toggle('parada', desatualizado);
  document.getElementById(idTexto).textContent = desatualizado
    ? t(idSelo === 'aoVivoHeader' ? 'status.live.headerDesatualizado' : 'status.live.cardDesatualizado')
    : t(idSelo === 'aoVivoHeader' ? 'status.live.header' : 'status.live.card');
}

function montarSessoes(blob) {
  document.getElementById('sessoesNumero').textContent = String(blob.sessoesAtivas);
  document.getElementById('sessoesManter').innerHTML = t('status.sessoes.manter', { n: blob.manterConectado });
  const min = minutosDesde(blob.agora, blob.atualizadoEm);
  document.getElementById('sessoesAtualizado').textContent = min === null ? '' : fraseDeAtualizacao(min);
  // Desatualizado = nem o heartbeat gravou no prazo dele (STATUS_DESATUALIZADO_APOS_MIN):
  // sinal de que a varredura pode ter parado, não só que a contagem está estável
  // (ver o comentário da constante em server/status.mjs).
  const desatualizado = min !== null && min >= STATUS_DESATUALIZADO_APOS_MIN;
  marcarSeloAoVivo('aoVivoHeader', 'pontoAoVivoHeader', 'textoAoVivoHeader', desatualizado);
  marcarSeloAoVivo('aoVivoCard', 'pontoAoVivoCard', 'textoAoVivoCard', desatualizado);
}

function montarTendencia(historico) {
  const secao = document.getElementById('statusTendencia');
  if (!Array.isArray(historico) || historico.length === 0) { secao.classList.add('hidden'); return; }
  secao.classList.remove('hidden');
  const valores = historico.map((b) => b.sessoesAtivas);
  const pontos = pontosDoGrafico(valores);
  document.getElementById('linha').setAttribute('points', pontos.map((p) => `${p.x},${p.y}`).join(' '));
  const svg = document.getElementById('chart');
  // `dias` é o tamanho REAL do histórico recebido (nunca um número cravado): logo
  // após o deploy, ou nos primeiros dias de uma conta nova, o blob tem menos
  // baldes que STATUS_HISTORICO_DIAS, e a frase tem que dizer o que há de verdade.
  const dias = historico.length;
  document.getElementById('tendenciaTitulo').textContent = t('status.tendencia.title', { dias });
  svg.setAttribute('aria-label', t('status.tendencia.title', { dias }) + ': ' + valores.join(', '));
  document.getElementById('resumoInicio').textContent = t('status.tendencia.resumoInicio', { n: valores[0], dias });
  document.getElementById('resumoFim').textContent = t('status.tendencia.resumoFim', { n: valores[valores.length - 1] });

  const crosshair = document.getElementById('crosshair');
  const ponto = document.getElementById('ponto');
  const dica = document.getElementById('dica');
  const W = 760;

  function rotuloDoDia(i) {
    if (i === historico.length - 1) return t('status.tendencia.hoje');
    const d = dataDoDia(historico[i].dia);
    return d ? d.toLocaleDateString(i18nLocale(), { day: '2-digit', month: 'short' }) : historico[i].dia;
  }
  function mover(evt) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const xRel = ((evt.clientX - rect.left) / rect.width) * W;
    let i = Math.round((xRel / W) * (pontos.length - 1));
    i = Math.max(0, Math.min(pontos.length - 1, i));
    crosshair.setAttribute('x1', pontos[i].x); crosshair.setAttribute('x2', pontos[i].x);
    crosshair.style.display = 'block';
    ponto.setAttribute('cx', pontos[i].x); ponto.setAttribute('cy', pontos[i].y);
    ponto.style.display = 'block';
    dica.textContent = t('status.tendencia.tooltip', { n: valores[i], data: rotuloDoDia(i) });
    dica.style.display = 'block';
    const px = (pontos[i].x / W) * rect.width;
    dica.style.left = Math.min(Math.max(px - 40, 0), rect.width - 100) + 'px';
    dica.style.top = '-4px';
  }
  function sair() {
    crosshair.style.display = 'none'; ponto.style.display = 'none'; dica.style.display = 'none';
  }
  svg.addEventListener('mousemove', mover);
  svg.addEventListener('mouseleave', sair);
}

// 99 instalações no Chrome Web Store, medido em 2026-11-23 na página pública
// da loja (https://chromewebstore.google.com/detail/.../dpinfpcoggnilplfgkpnkhbmfokhnhnn).
// NÃO é dinâmico — não existe API pública pra isso (ver CLAUDE.md); atualizar
// este número é um ato manual, deliberado, quando alguém medir de novo.
const EXTENSAO_INSTALACOES_CHROME = 99;

function montarExtensao() {
  document.getElementById('extensaoInstalacoes').textContent = t('status.extensao.instalacoes', { n: EXTENSAO_INSTALACOES_CHROME });
}

function montarVersao() {
  const el = document.getElementById('versaoValor');
  if (typeof window.APP_VERSION === 'string' && typeof window.verLabel === 'function') {
    el.textContent = 'v' + window.verLabel(window.APP_VERSION);
  }
}

async function carregarStatus() {
  let resp;
  try {
    resp = await fetch('/api/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch {
    document.getElementById('statusErro').classList.remove('hidden');
    return;
  }
  let body;
  try { body = await resp.json(); } catch { body = null; }
  if (!resp.ok || !body || !body.success) {
    document.getElementById('statusErro').classList.remove('hidden');
    return;
  }
  if (!body.atualizadoEm) {
    // O cron ainda não rodou a 1ª vez depois do deploy (até 30 min) — estado
    // honesto, nunca zero fingindo ser contagem de verdade.
    document.getElementById('statusSemDados').classList.remove('hidden');
    return;
  }
  document.getElementById('statusLinha1').classList.remove('hidden');
  montarSessoes(body);
  montarGauge(body.manterConectado, body.capacidade || { confortavel: 0, limite: 0, tetoMedido: 1 });
  montarTendencia(body.historico);
}

(function init() {
  try { setLang(localStorage.getItem('waze_places_lang')); } catch { /* storage bloqueado: fica no padrão detectado */ }
  setI18nVars({ minCron: () => MANTER_CRON_MIN_EXIBIDO });
  applyI18n();
  montarVersao();
  montarExtensao();
  carregarStatus();
})();
