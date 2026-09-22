// A TRIAGEM de um diagnóstico do modo dev: o que se lê PRIMEIRO, e nada que
// não se possa colar numa conversa.
//
//   node tools/diag-resumo.mjs <arquivo.zip|.gz|.json>
//
// POR QUE ISTO EXISTE. A cada relato eu escrevia um leitor avulso — e no de
// 2026-09-22 dois deles disseram o contrário do arquivo: `/\bhidden\b/` casou o
// `hidden` de `overflow-hidden` e deu "esqueleto escondido" com ele VISÍVEL, e
// contar `class="place-card` no `dom` contou o card do `<template>` e deu "dois
// cards da frente". Leitor único é onde a lição fica: aqui ninguém vasculha o
// `dom` — lê-se o que a app JÁ MEDIU (alertas, `cardMontado`, `telaDoCard`),
// que é pra isso que as medições existem.
//
// O QUE NUNCA SAI, por construção:
//  · CREDENCIAL. O arquivo leva o `waze_session_token`, que é credencial VIVA.
//    `localStorage`, `sessionStorage` e `cookiesDestaOrigem` não são lidos pra
//    saída; e, como defesa a mais, TODA a saída passa por uma troca do token
//    por `<TOKEN>` antes de ser impressa — se ele vazar pra dentro de alguma
//    mensagem de erro, não sai daqui.
//  · DADO DE TERCEIRO EM MASSA: `appState` (a fila inteira), `dom`, `codigo` e
//    o corpo das chamadas (`corpoReq`) ficam de fora. O diário do modo dev pode
//    citar um nome de local, como sempre citou — ele é assim por desenho.
// `test/diag-resumo.test.mjs` prova as duas coisas com CANÁRIOS.
//
// Relatório ANTIGO também abre: o que a versão dele não trazia sai como
// "(ausente nesta versão)" — o antigo é justamente o que se compara antes/depois.
import { lerDiagnostico } from './diag-ler.mjs';

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('uso: node tools/diag-resumo.mjs <diagnóstico .zip|.gz|.json>');
  process.exit(2);
}
let lido;
try { lido = lerDiagnostico(arquivo); }
catch (e) { console.error('não consegui abrir o diagnóstico: ' + String((e && e.message) || e).slice(0, 200)); process.exit(1); }
const { dados: d, origem, bytes } = lido;

const linhas = [];
const out = (s = '') => linhas.push(String(s));
const AUSENTE = '(ausente nesta versão)';
const j = (x, max = 240) => {
  if (x === undefined) return AUSENTE;
  const s = JSON.stringify(x);
  return s.length > max ? s.slice(0, max) + '…' : s;
};
const hora = (t) => {
  const dt = typeof t === 'number' ? new Date(t) : new Date(String(t));
  return Number.isNaN(dt.getTime()) ? String(t) : dt.toISOString().slice(11, 23);
};
const secao = (titulo) => { out(); out('── ' + titulo + ' ' + '─'.repeat(Math.max(3, 60 - titulo.length))); };

const r = d.resumo || {};
out(`arquivo: ${origem}, ${Math.round(bytes / 1024)} KB · relatório v${d._versaoDoDiag ?? '?'} · app ${d.app?.rotulo ?? d.app?.versao ?? '?'} · gerado ${d._gerado ?? '?'}`);
const amb = d.ambiente || {};
out(`aparelho: ${(amb.ua || '?').replace(/^Mozilla\/5\.0 /, '').slice(0, 90)} · tela ${amb.tela?.w}×${amb.tela?.h}@${amb.tela?.dpr} · janela ${amb.tela?.janela} · instalada: ${amb.standalone} · online: ${amb.online}`);

secao('ALERTAS (a primeira coisa a ler)');
const alertas = Array.isArray(r.alertas) ? r.alertas : null;
if (!alertas) out('no relatório: ' + AUSENTE);
else if (!alertas.length) out('no relatório: nenhum');
else for (const a of alertas) out(`no relatório: ${a.chave} — ${String(a.msg || '').slice(0, 200)}`);
const nasCapturas = r.alertasNasCapturas;
if (nasCapturas === undefined) out('nas capturas: ' + AUSENTE);
else if (!nasCapturas.length) out('nas capturas: nenhum');
else for (const c of nasCapturas) out(`nas capturas: ${hora(c.t)} ${c.motivo} (painel ${c.painel}) → ${c.alertas.join(', ')}`);

secao('TELA NA HORA DO RELATÓRIO');
const ta = r.telaAgora || {};
out(`tela ${ta.tela} · painel ${ta.painel} · card montado: ${ta.cardMontado === undefined ? AUSENTE : ta.cardMontado} · modais ${j(ta.modais)} · lightbox ${ta.lightbox}`);
out(`rede: ${r.rede === undefined ? AUSENTE : r.rede} · offline: ${r.offline === undefined ? AUSENTE : r.offline} · chamadas ${r.chamadas} (falhas ${r.falhas}) · erros de JS ${r.errosDeJs} · capturas ${r.momentos}`);
if ((ta.modais || []).length) {
  out('ATENÇÃO: relatório gerado com modal aberto — as sentinelas de TOQUE calam nessa hora; olhe as capturas.');
}

secao('OFFLINE');
const off = d.offline;
if (off === undefined) out(AUSENTE);
else {
  out(`ligado ${off.ligado} · resultado ${off.resultado} · varrendo ${off.varrendo} · janela servida ${off.janelaServida} / atual ${off.janelaAtual} / gravada ${off.janelaGuardada === undefined ? '—' : off.janelaGuardada}`);
  out(`fila guardada ${j(off.filaGuardada)} · tiles no cache ${j(off.tilesNoCache)} · tiles guardados que falharam ${off.tilesGuardadosQueFalharam}`);
  if (off.ligado) out(`pousos gravados depois da fila guardada: ${off.pousosGravados === undefined ? AUSENTE : off.pousosGravados}`);
}

// Só os NÚMEROS que a app mediu (`resumo.saida`). O conteúdo da fila de saída
// (ids e o autor de cada pedido) mora no localStorage, que este leitor não lê.
secao('FILA DE SAÍDA');
const sa = r.saida;
if (sa === undefined) out(AUSENTE);
else if (sa.erro) out('erro ao medir: ' + sa.erro);
else {
  out(`esperando envio ${sa.n} · pedidos distintos ${sa.distintas} · REPETIDOS ${sa.repetidas} · tipos ${j(sa.tipos)} · o mais velho espera há ${sa.maisAntigaMin ?? '—'} min`);
  if (sa.repetidas > 0) out('ATENÇÃO: a mesma decisão está na fila mais de uma vez — algum caminho devolveu um pedido já decidido.');
}

secao('SERVICE WORKER');
const sw = d.serviceWorker || {};
out(`controlando ${sw.controlando} · registros ${j((sw.registros || []).map((x) => ({ estado: x.estadoAtivo, esperando: !!x.esperando, instalando: !!x.instalando })))}`);
const sp = sw.proprio;
if (sp === undefined) out('por ele mesmo: ' + AUSENTE);
else if (!sp) out('por ele mesmo: sem controlador (nada a perguntar)');
else if (sp.semResposta) out('por ele mesmo: NÃO respondeu (worker de versão antiga, ou travado)');
else out(`por ele mesmo: ${sp.versao} · vivo há ${Math.round((sp.idadeMs || 0) / 1000)}s · lista pronta ${sp.listaPronta} com ${sp.tilesNaLista} tiles · do cache ${sp.doCache} · cache sem entrada ${sp.cacheSemEntrada} · esperou leitura ${sp.esperouLeitura} · fora da lista ${sp.foraDaLista}`);

secao('SESSÃO E ARMAZENAMENTO');
out(`duração da sessão (h): ${r.sessaoDuracaoH ?? '—'} · nascimento ${d.sessao?.nascimento ?? '—'} · idade do armazenamento (h) ${d.sessao?.idadeDoArmazenamentoH ?? '—'}`);
out(`risco de apagamento: ${r.riscoDeApagamento ?? '—'}`);
out(`recursos: ${j(d.recursosInfo)}`);

secao('DIÁRIO (linha do tempo)');
const diario = Array.isArray(d.diario) ? d.diario : [];
if (!diario.length) out('(vazio)');
const t0 = diario.length ? diario[0].t : 0;
for (const e of diario) {
  const { t, k, ...resto } = e;
  const delta = typeof t === 'number' && typeof t0 === 'number' ? ` +${((t - t0) / 1000).toFixed(3)}s` : '';
  out(`${hora(t)}${delta}  ${k}  ${Object.keys(resto).length ? j(resto, 200) : ''}`);
}

secao('CHAMADAS À API (sem corpo)');
const chamadas = Array.isArray(d.chamadas) ? d.chamadas : [];
if (!chamadas.length) out('(nenhuma)');
for (const c of chamadas.slice(-30)) {
  out(`${hora(c.t)}  ${String(c.rota).padEnd(16)} http ${c.http} · ${c.ok ? 'ok' : 'FALHOU'} · ${c.ms} ms${c.errorCategory ? ' · ' + c.errorCategory : ''}${c.errorKey ? ' · ' + c.errorKey : ''}`);
}
if (chamadas.length > 30) out(`(… e mais ${chamadas.length - 30} antes destas)`);

secao('CAPTURAS');
const momentos = Array.isArray(d.momentos) ? d.momentos : [];
if (!momentos.length) out('(nenhuma)');
for (const m of momentos) {
  const quebradas = Array.isArray(m.imagens) ? m.imagens.filter((i) => i.quebrada).length : '—';
  const alertasM = Array.isArray(m.alertas) ? (m.alertas.length ? m.alertas.map((a) => a.chave).join(', ') : 'nenhum') : AUSENTE;
  out(`${hora(m.t)}  ${m.motivo} · tela ${m.tela} · painel ${m.painel} · card montado ${m.cardMontado === undefined ? AUSENTE : m.cardMontado} · modais ${j(m.modais)}`);
  out(`    rede ${m.rede === undefined ? AUSENTE : j(m.rede)} · offline ${m.offline === undefined ? AUSENTE : j(m.offline)}`);
  out(`    fila ${m.estado?.fila} · restam ${m.estado?.serverTotal} · hasMore ${m.estado?.hasMore} · loadError ${m.estado?.loadError} · imagens quebradas ${quebradas} · alertas: ${alertasM}`);
}

secao('ERROS DE JS');
const erros = Array.isArray(d.erros) ? d.erros : [];
if (!erros.length) out('(nenhum)');
for (const e of erros.slice(-20)) out(`${hora(e.t)}  ${e.tipo || 'erro'}  ${String(e.msg || '').slice(0, 200)}`);

// A troca final: o token nunca sai, nem de dentro de uma mensagem.
let texto = linhas.join('\n');
const token = d.localStorage && typeof d.localStorage.waze_session_token === 'string'
  ? d.localStorage.waze_session_token : '';
if (token.length >= 8) texto = texto.split(token).join('<TOKEN>');
console.log(texto);
