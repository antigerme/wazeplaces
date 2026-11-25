// ═══════════════════════════════════════════════════════════════════════════
//  O RESULTADO da demo: o que o apresentador projeta no fim, PURO
// ═══════════════════════════════════════════════════════════════════════════
//
// Cada número que o palco mostra sai daqui, uma vez, e o cliente só o desenha:
// "unânime" e "dividido" são UMA função (a etiqueta da lista, a ordem e a
// contagem do resumo concordam por construção), e o prêmio é uma regra com
// desempate, não uma impressão. Nada aqui lê relógio: o estado da sala entra.
//
// Duas regras de verdade que o palco herda:
//   · quem não votou o bastante não ganha prêmio, e sala pequena não tem prêmio
//     de consenso (com 1 ou 2 pessoas, «mente coletiva» é automático);
//   · «mais rápido» e a projeção da fila só existem no modo LIVRE — no
//     sincronizado quem dita o ritmo é o apresentador, e o tempo da pessoa não
//     diz nada dela.

const NADA = '-';
const VOTOS = ['R', 'P', 'L'];

// Quantos votos uma sala precisa ter num pedido pra ele valer como «unânime» ou
// «dividido» (com 2 votos, 2×0 não é consenso nenhum).
export const RESULTADO_MIN_VOTOS = 3;
// A fatia do mais votado que faz um pedido ser unânime (≥) ou dividido (≤).
export const UNANIME_DE = 0.85;
export const DIVIDIDO_ATE = 0.6;
// Quem vota em pelo menos 2/3 dos pedidos entra nos prêmios, e a sala precisa ter
// pelo menos 3 pessoas assim pro consenso valer.
export const PREMIO_FRACAO_MIN = 2 / 3;
export const PREMIO_MIN_PESSOAS = 3;
// A fila de exemplo da projeção: a mediana medida em 13 países foi 497 pedidos.
export const FILA_DE_EXEMPLO = 500;

export const pessoasDaSala = (est) => est.ordem.filter((p) => p !== 'ref');

export function contarVotos(est, idx) {
  const c = { R: 0, L: 0, P: 0, n: 0 };
  for (const p of pessoasDaSala(est)) {
    const v = est.partes[p].votos[idx - 1];
    if (v && v !== NADA) { c[v]++; c.n++; }
  }
  return c;
}

export function contarPalpites(est, idx) {
  const c = { R: 0, L: 0, P: 0, n: 0 };
  for (const p of pessoasDaSala(est)) {
    const v = est.partes[p].palpites[idx - 1];
    if (v && v !== NADA) { c[v]++; c.n++; }
  }
  return c;
}

// O voto mais escolhido, ou null se não há voto ou se há EMPATE no topo.
export function maioriaDe(c) {
  const max = Math.max(c.R, c.L, c.P);
  if (!max) return null;
  const topo = VOTOS.filter((k) => c[k] === max);
  return topo.length === 1 ? topo[0] : null;
}

// A fatia do mais votado (0..1), ou 0 sem votos.
export const fatiaDoTopo = (c) => (c.n ? Math.max(c.R, c.L, c.P) / c.n : 0);

// UMA função pra etiqueta, a ordem e o resumo.
export function classeDoPedido(c) {
  if (!c || c.n < RESULTADO_MIN_VOTOS) return null;
  const f = fatiaDoTopo(c);
  if (f >= UNANIME_DE) return 'unanime';
  if (f <= DIVIDIDO_ATE) return 'dividido';
  return null;
}

// O país que a pessoa escreveu, sem caixa nem acento: «Brasil», «brasil » e
// «BRASIL» são o mesmo; «Brazil» NÃO é (não há lista de países pra consultar, e
// adivinhar sinônimo erraria calado).
export function chaveDoPais(p) {
  if (typeof p !== 'string') return '';
  return p.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const mediana = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// Quando o pedido `idx` já pode ser MOSTRADO com a divisão dos votos: no
// sincronizado, depois da revelação; no livre, só quando a demo acaba (a barra
// ao vivo orientaria quem ainda está votando).
export function pedidoVisivel(est, idx) {
  if (est.fase === 'encerrada') return true;
  return est.cfg.modo === 'sinc' && est.revelados.includes(idx);
}

export function analisar(est) {
  const total = est.cfg.total;
  const sinc = est.cfg.modo === 'sinc';
  const gente = pessoasDaSala(est);

  const pedidos = Array.from({ length: total }, (_, i) => {
    const idx = i + 1;
    const c = contarVotos(est, idx);
    return { idx, R: c.R, L: c.L, P: c.P, n: c.n, maioria: maioriaDe(c), topo: fatiaDoTopo(c), classe: classeDoPedido(c) };
  });

  // ── prêmios ──
  const minimo = Math.ceil(total * PREMIO_FRACAO_MIN);
  const elegiveis = gente.filter((p) => est.partes[p].votos.split('').filter((c) => c !== NADA).length >= minimo);
  const premios = [];
  if (elegiveis.length >= PREMIO_MIN_PESSOAS) {
    const ficha = elegiveis.map((id, ordem) => {
      const p = est.partes[id];
      let comparaveis = 0; let alinhados = 0; let R = 0; let L = 0; let P = 0;
      for (let i = 0; i < total; i++) {
        const v = p.votos[i];
        if (v === NADA) continue;
        if (v === 'R') R++; else if (v === 'L') L++; else P++;
        const ped = pedidos[i];
        if (ped.maioria && ped.n >= RESULTADO_MIN_VOTOS) { comparaveis++; if (v === ped.maioria) alinhados++; }
      }
      const tempo = !sinc && p.terminouEm !== null && est.comecouEm != null ? Math.max(0, p.terminouEm - Math.max(est.comecouEm, p.em)) : null;
      return { id, ordem, nome: p.nome, comparaveis, alinhados, fatia: comparaveis ? alinhados / comparaveis : null, R, L, P, tempo };
    });
    const ganhou = new Set();
    // Maior valor primeiro; empate: quem entrou antes. Quem já ganhou um prêmio não ganha outro
    // (o palco é pra a sala se ver, não pra um nome só).
    const escolher = (chave, valor, ordemMaior, aceita) => {
      const cands = ficha.filter((f) => !ganhou.has(f.id) && valor(f) !== null && aceita(f));
      cands.sort((a, b) => (ordemMaior ? valor(b) - valor(a) : valor(a) - valor(b)) || (b.comparaveis - a.comparaveis) || (a.ordem - b.ordem));
      const f = cands[0];
      if (!f) return;
      ganhou.add(f.id);
      premios.push({ chave, nome: f.nome, ...detalhe(chave, f) });
    };
    const detalhe = (chave, f) => {
      if (chave === 'menteColetiva') return { a: f.alinhados, b: f.comparaveis };
      if (chave === 'almaIndependente') return { a: f.comparaveis - f.alinhados, b: f.comparaveis };
      if (chave === 'gatilho') return { a: f.R, b: total };
      if (chave === 'coracaoMole') return { a: f.L, b: total };
      if (chave === 'cauteloso') return { a: f.P, b: total };
      return { a: f.tempo, b: 0 };
    };
    // O mais rápido escolhe PRIMEIRO: é a única disputa medida em segundos, e quem fez em menos tempo não pode
    // perdê-la porque já tinha levado «mente coletiva».
    if (!sinc) escolher('maisRapido', (f) => f.tempo, false, (f) => f.tempo !== null && f.tempo > 0);
    const comComparaveis = (f) => f.comparaveis >= Math.max(1, Math.ceil(minimo / 2));
    escolher('menteColetiva', (f) => f.fatia, true, comComparaveis);
    escolher('almaIndependente', (f) => f.fatia, false, comComparaveis);
    escolher('gatilho', (f) => f.R, true, (f) => f.R > 0);
    escolher('coracaoMole', (f) => f.L, true, (f) => f.L > 0);
    escolher('cauteloso', (f) => f.P, true, (f) => f.P > 0);
  }

  // ── resumo ──
  const votos = { R: 0, L: 0, P: 0 };
  let decisoes = 0;
  for (const p of pedidos) { votos.R += p.R; votos.L += p.L; votos.P += p.P; decisoes += p.n; }
  const paises = new Map();
  for (const id of gente) {
    const k = chaveDoPais(est.partes[id].pais);
    if (k && !paises.has(k)) paises.set(k, est.partes[id].pais);
  }
  let palpitesDados = 0; let palpitesCertos = 0;
  if (sinc) {
    for (const ped of pedidos) {
      if (!ped.maioria || !est.revelados.includes(ped.idx)) continue;
      const pa = contarPalpites(est, ped.idx);
      palpitesDados += pa.n;
      palpitesCertos += pa[ped.maioria];
    }
  }
  // Tempo da sala: do começo ao fim (livre: do último a terminar, ou do encerramento).
  const fim = est.encerradoEm ?? null;
  const duracaoMs = est.comecouEm != null && fim != null ? Math.max(0, fim - est.comecouEm) : null;
  // A projeção só vale com quem TERMINOU (ritmo próprio) e em número que não é anedota.
  let msPorPedido = null;
  if (!sinc) {
    const duracoes = gente.map((id) => est.partes[id]).filter((p) => p.terminouEm !== null && est.comecouEm != null)
      .map((p) => Math.max(0, p.terminouEm - Math.max(est.comecouEm, p.em)));
    if (duracoes.length >= PREMIO_MIN_PESSOAS) msPorPedido = Math.round(mediana(duracoes) / total);
  }

  return {
    pedidos,
    premios,
    resumo: {
      pessoas: gente.length,
      total,
      decisoes,
      votos,
      duracaoMs,
      paises: paises.size,
      nomesDePaises: [...paises.values()],
      unanimes: pedidos.filter((p) => p.classe === 'unanime').length,
      divididos: pedidos.filter((p) => p.classe === 'dividido').length,
      palpites: sinc ? { dados: palpitesDados, certos: palpitesCertos } : null,
      projecao: msPorPedido ? { msPorPedido, fila: FILA_DE_EXEMPLO } : null,
    },
  };
}
