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
// `dom` — lê-se o que o app JÁ MEDIU (alertas, `cardMontado`, `telaDoCard`),
// que é pra isso que as medições existem.
//
// O QUE NUNCA SAI, por construção:
//  · CREDENCIAL. O arquivo leva o `waze_session_token`, que é credencial VIVA.
//    `localStorage`, `sessionStorage` e `cookiesDestaOrigem` não são lidos pra
//    saída; e, como defesa a mais, TODA a saída passa por uma troca do token
//    por `<TOKEN>` antes de ser impressa — se ele vazar pra dentro de alguma
//    mensagem de erro, não sai daqui. O link de pareamento (`#pair=…`), idem.
//  · DADO DE TERCEIRO EM MASSA: `appState` (a fila inteira), a fila real que o
//    treino guarda (`treino`: só a contagem), `dom`, `codigo` e o corpo das
//    chamadas (`corpoReq`) ficam de fora. O diário do modo dev pode citar um
//    nome de local, como sempre citou — ele é assim por desenho.
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
// O MESMO painel diz coisas diferentes (auditoria de 2026-09-26): "tudoLimpo" era
// também o "Fim da fila" (pulados pendentes) e o "nada tratado nesta fila", e a
// falha podia ser "sem conexão". A `variante` entrou no relatório v11.
const VARIANTES = { limpo: 'tudo limpo de verdade', fimDaFila: 'fim da fila: há pulados pendentes',
  nadaNestaFila: 'nada tratado nesta fila', semConexao: 'sem conexão', falha: 'falha ao carregar' };
const painelComVariante = (x) => `${x.painel}${x.variante ? ` (${VARIANTES[x.variante] || x.variante})` : ''}`;

const r = d.resumo || {};
// A OUTRA ABA aberta junto com a do relatório vem em `aberturasAnteriores` desde
// que o relatório leva o que ela gravou (R6-4-5) — e não é uma abertura que
// FECHOU: tratada como "anterior", mandava quem lê atrás de um fechar e reabrir
// que não houve (R7-4-04). O app a marca (`simultanea`); no relatório anterior à
// marca, é a que gravou DEPOIS de a do relatório abrir — uma página de antes, na
// mesma aba, morre antes de a seguinte nascer.
const inicioDesta = Date.parse(d.aberturaAtual && d.aberturaAtual.inicio);
const juntoComEsta = (a) => !!a && (a.simultanea === true
  || (Number.isFinite(inicioDesta) && Number.isFinite(a.salvoEm) && a.salvoEm > inicioDesta));
const outraAbaPorId = new Set((Array.isArray(d.aberturasAnteriores) ? d.aberturasAnteriores : [])
  .filter(juntoComEsta).map((a) => a.id));
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
else {
  for (const c of nasCapturas) {
    const deOnde = !c.abertura ? ''
      : (c.outraAba || outraAbaPorId.has(c.abertura)) ? ` [outra aba ${c.abertura}, aberta junto com esta]`
      : ` [abertura anterior ${c.abertura}]`;
    out(`nas capturas: ${hora(c.t)} ${c.motivo} (painel ${c.painel}) → ${c.alertas.join(', ')}${deOnde}`);
  }
}

// O TREINO (R8-4-06): com ele aberto, a fila na tela — e no `appState` e no
// `estado.fila` das capturas — é a de EXEMPLOS, não a real. O app passou a dizer
// isso (`treino` na tela) e a levar a fila real que o treino guarda (`treino`,
// no corpo); a triagem diz o primeiro e CONTA o segundo, sem os pedidos.
const textoDoTreino = (tr) => (tr === undefined ? AUSENTE : !tr || tr.ativo === false ? 'fechado'
  : tr.ativo === true ? `ABERTO (passo ${tr.passo ?? '?'} · ${tr.exemplos ?? '?'} exemplos na fila)` : 'não se sabe');

secao('TELA NA HORA DO RELATÓRIO');
const ta = r.telaAgora || {};
out(`tela ${ta.tela} · painel ${painelComVariante(ta)} · card montado: ${ta.cardMontado === undefined ? AUSENTE : ta.cardMontado} · modais ${j(ta.modais)} · lightbox ${ta.lightbox} · treino ${textoDoTreino(ta.treino)}`);
if (ta.treino && ta.treino.ativo === true) {
  const g = d.treino && typeof d.treino === 'object' ? d.treino : {};
  const n = (x) => (Array.isArray(x) ? x.length : '?');
  out('ATENÇÃO: relatório gerado DENTRO do treino — a fila na tela e no `appState` é de EXEMPLOS; a fila real é a que o treino guarda.');
  out(`fila real guardada pelo treino: ${n(g.fila)} pedidos · recusados que voltam como card ao sair dele: ${n(g.devolver)} · perfil chegou nele: ${g.perfilChegou ?? '?'} · ordem trocada nele: ${g.ordemMudou ?? '?'} · época da fila real ${g.epoca ?? '?'} (a do treino ${g.epocaDoTreino ?? '?'}, a de agora ${g.epocaAgora ?? '?'})`);
}
// Desde o v10 o "já tratado" (outro editor chegou antes, que pro app é sucesso)
// sai das falhas e vem à parte; antes dele, `falhas` somava os dois.
const jaTratadas = typeof r.jaTratadas === 'number' ? ` · já tratadas ${r.jaTratadas}` : '';
out(`rede: ${r.rede === undefined ? AUSENTE : r.rede} · offline: ${r.offline === undefined ? AUSENTE : r.offline} · chamadas ${r.chamadas} (falhas ${r.falhas}${jaTratadas}) · erros de JS ${r.errosDeJs} · capturas ${r.momentos}`);
if ((ta.modais || []).length) {
  out('ATENÇÃO: relatório gerado com modal aberto — as sentinelas de TOQUE calam nessa hora; olhe as capturas.');
}

secao('OFFLINE');
const off = d.offline;
if (off === undefined) out(AUSENTE);
// DESLIGADO não é "ausente nesta versão": o app sai cedo da seção e não guarda
// fila, janela nem tile de quem não ligou o recurso (é a regra "quem não marca
// não paga nada"), então esses campos não EXISTEM — e o leitor atribuía à
// versão do relatório o que era o interruptor (auditoria de 2026-09-26).
else if (off.ligado === false) {
  out(`desligado — nada guardado no aparelho (a fila, a janela e os tiles só existem com o "Disponível offline" ligado) · tiles guardados que falharam ${off.tilesGuardadosQueFalharam ?? '—'}`);
} else {
  out(`ligado ${off.ligado} · resultado ${off.resultado} · varrendo ${off.varrendo} · janela servida ${off.janelaServida} / atual ${off.janelaAtual} / gravada ${off.janelaGuardada === undefined ? '—' : off.janelaGuardada}`);
  out(`fila guardada ${j(off.filaGuardada)} · tiles no cache ${j(off.tilesNoCache)} · tiles guardados que falharam ${off.tilesGuardadosQueFalharam}`);
  if (off.ligado) out(`pousos gravados depois da fila guardada: ${off.pousosGravados === undefined ? AUSENTE : off.pousosGravados}`);
}

// Só os NÚMEROS que o app mediu (`resumo.saida`). O conteúdo da fila de saída
// (ids e o autor de cada pedido) mora no localStorage, que este leitor não lê.
secao('FILA DE SAÍDA');
const sa = r.saida;
if (sa === undefined) out(AUSENTE);
else if (sa.erro) out('erro ao medir: ' + sa.erro);
else {
  out(`esperando envio ${sa.n} · pedidos distintos ${sa.distintas} · REPETIDOS ${sa.repetidas} · tipos ${j(sa.tipos)} · o mais velho espera há ${sa.maisAntigaMin ?? '—'} min`);
  if (sa.repetidas > 0) out('ATENÇÃO: a mesma decisão está na fila mais de uma vez — algum caminho devolveu um pedido já decidido.');
}

// A presença no mapa do WME (fase 2, `resumo.presencaWme`): só números e
// estados que o app mediu — nenhuma posição sai daqui.
secao('PRESENÇA NO WME');
const pw = r.presencaWme;
if (pw === undefined) out(AUSENTE);
else if (pw.erro) out('erro ao medir: ' + pw.erro);
else {
  // `visto` só existe em relatório de antes de v2026.09.24-02, quando o WME
  // ainda podia desligar a presença do app.
  out(`ligada ${pw.ligada}${pw.visto !== undefined ? ` · já vista ligada ${pw.visto}` : ''} · ligar na próxima ação ${pw.ligarNaProxima} · escritas ${pw.enviadas} · falhas ${pw.falhas}${pw.ultimaFalha ? ` (última: ${pw.ultimaFalha})` : ''} · última escrita há ${pw.ultimaHaS ?? '—'} s`);
  // `perfilVisivel` entrou no relatório v8.
  if (pw.perfilVisivel !== undefined) out(`o perfil do WME disse visível: ${pw.perfilVisivel ?? '—'}${pw.perfilHaS != null ? ` (há ${pw.perfilHaS} s)` : ''}`);
  // O "invisível" do GESTO de desligar que ainda não chegou ao WME, e quantas
  // vezes ele falhou (o lote 10 os pôs no relatório pro relato "desliguei e sigo
  // aparecendo no WME"). A triagem não os mostrava, e o "falhas 0" de cima — das
  // escritas de CARONA, não do desligar — lia como "nada falhou" (R7-4-07 =
  // R7-5-06).
  const semCampo = (v) => (v === undefined ? AUSENTE : v);
  out(`o desligar ("invisível" no WME): pendente ${semCampo(pw.desligarPendente)} · falhas ${semCampo(pw.desligarFalhas)}`);
  if (pw.desligarPendente === true) {
    const vezes = Number(pw.desligarFalhas) > 0 ? ` (falhou ${pw.desligarFalhas} ${Number(pw.desligarFalhas) === 1 ? 'vez' : 'vezes'})` : '';
    out(`ATENÇÃO: o "invisível" do desligar ainda não chegou ao WME${vezes}${pw.perfilVisivel === true ? ', e o perfil do WME dizia visível' : ''} — pros outros, a pessoa pode seguir aparecendo no mapa até ele sair.`);
  }
  if (pw.marcaPerdida) out('ATENÇÃO: o Waze devolveu a posição SEM a marca do app — a lista de quem está no app vai vir vazia.');
  // A presença do WME expira ~15 min depois da última escrita (medido): quem
  // parou de agir já sumiu da lista dos outros, e isso NÃO é defeito.
  if (pw.ligada && pw.ultimaHaS > 900) out(`nota: ${Math.round(pw.ultimaHaS / 60)} min sem escrever a posição — pros outros, a pessoa já saiu da lista (expira em ~15 min parado).`);
  if (pw.ligada && pw.enviadas === 0 && pw.ultimaHaS == null) out('nota: nenhuma ação com presença desde que o app abriu — pros outros, a pessoa só aparece depois da primeira ✕ ou ✓.');
}

// A lista e o chat do app (fase 3, `resumo.presencaApp`): só contagens e
// estados — nome, texto e token nunca vão pro relatório.
secao('PRESENÇA NO APP (lista e conversa)');
const pa = r.presencaApp;
if (pa === undefined) out(AUSENTE);
else if (!pa) out('sem a presença carregada');
else if (pa.erro) out('erro ao medir: ' + pa.erro);
else {
  const f = pa.fluxo || {};
  const tk = pa.token;
  out(`ligada ${pa.ligada} · no app ${pa.online} · conversas ${pa.conversas} · não lidas ${pa.naoLidas} · lista de há ${pa.atualizadaHaS ?? '—'} s · conversa aberta ${pa.conversaAberta}`);
  out(`token ${tk ? `válido ${tk.valido}${tk.abre !== undefined ? ` · abre o tempo real ${tk.abre}` : ''} (vence em ${tk.expiraEmH ?? '?'} h)` : 'nenhum'} · tempo real aberto ${f.aberto}${f.aberto ? ` há ${f.haS} s` : ''} · aberturas ${f.aberturas} · quadros ${f.quadros} · mensagens ${f.mensagens} · recibos ${f.recibos} · recuo ${f.tentativa}${f.ultimoErro ? ` · último erro: ${f.ultimoErro}` : ''}`);
  out(`conhecidas no aparelho ${pa.conhecidos} · a confirmar ${pa.aConfirmar}${f.ignoradas !== undefined ? ` · mensagens só do WME (ignoradas de propósito) ${f.ignoradas}` : ''}${f.quedasSeguidas ? ` · quedas seguidas do tempo real ${f.quedasSeguidas}` : ''}`);
  // As conversas que DEVEM um "lida" (lote 10): com ela acima de zero, a
  // "mensagem nova" de uma conversa já vista é isto (R7-4-07 = R7-5-06).
  out(`conversas devendo o "lida": ${pa.lidaDevendo === undefined ? AUSENTE : pa.lidaDevendo}`);
  if (Number(pa.lidaDevendo) > 0) {
    out(`nota: ${pa.lidaDevendo} ${Number(pa.lidaDevendo) === 1 ? 'conversa deve' : 'conversas devem'} o "lida" ao Waze — a "mensagem nova" de uma conversa já vista é isto, não mensagem que chegou.`);
  }
  // O PORQUÊ da lista, contado no servidor (relatório v8): separa "ninguém usa
  // o app agora" de "está no app, mas noutro país" e de "a marca se perdeu".
  const ct = pa.contagem;
  if (ct === undefined) out('por que a lista é essa: ' + AUSENTE);
  else if (!ct) out('por que a lista é essa: (nenhuma lista chegou ainda)');
  else {
    const o = ct.online, c = ct.conversas;
    if (o) out(o.falhou ? `lista do WME: FALHOU (${o.falhou})` : `no WME agora: ${o.noWme} visíveis · com a marca do app: ${o.comMarca} · no país do filtro: ${o.noPais}`);
    if (c) out(c.falhou ? `conversas do Waze: FALHOU (${c.falhou})` : `conversas no Waze: ${c.noWaze} · com a marca do app: ${c.marcadas} · entram na lista (marca ou já conhecida): ${c.daApp}`);
  }
  // `valido` diz "não precisa renovar": conta a folga de 1 h da renovação, e
  // falso nela NÃO é vencido — o aviso dizia "venceu" com o token abrindo o
  // tempo real por mais meia hora (auditoria de 2026-09-29). Quem diz se venceu
  // é o `abre`; no relatório que não o traz, só as horas NEGATIVAS provam.
  if (pa.ligada && tk) {
    const venceu = tk.abre !== undefined ? tk.abre === false
      : !tk.valido && Number.isFinite(tk.expiraEmH) && tk.expiraEmH < 0;
    if (venceu) out('ATENÇÃO: o token do tempo real venceu — mensagem nova só aparece no próximo pedido.');
    else if (!tk.valido) {
      out(tk.abre === undefined
        ? 'nota: o token do tempo real está na última hora, ou venceu há menos de meia hora — este relatório não diz se ele ainda abre o tempo real.'
        : 'nota: o token do tempo real está na última hora — ainda abre o tempo real, e a renovação sai no próximo pedido da lista.');
    }
  }
  if (pa.aConfirmar >= 90) out('ATENÇÃO: a fila de confirmação está quase no teto — a confirmação de carona pode não estar voltando.');
}

// Que código o aparelho está rodando. Desde o relatório v8 o `codigo` guarda o
// tamanho, o hash e a versão de cada arquivo (o corpo, só do CSS); o
// `cacheVsRede` compara o que o aparelho tem com o que o servidor serve AGORA.
secao('CÓDIGO NO APARELHO');
{
  const cod = d.codigo || {};
  const cvr = d.cacheVsRede || {};
  const nome = (u) => String(u).replace(/^https?:\/\/[^/]+/, '') || '/';
  const versoes = Object.entries(cod).filter(([, v]) => v && v.versao).map(([u, v]) => `${nome(u)} ${v.versao}`);
  out(`app ${d.app?.versao ?? '?'}${versoes.length ? ' · declarado nos arquivos: ' + versoes.join(' · ') : ''}`);
  // Nota e não alerta: numa atualização em curso o worker novo já chegou e a
  // página ainda roda a versão de antes, e isso é normal por alguns segundos.
  const distintas = new Set([d.app?.versao, ...Object.values(cod).map((v) => v && v.versao)].filter(Boolean));
  if (distintas.size > 1) out(`nota: os arquivos declaram ${distintas.size} versões diferentes — normal só durante uma atualização; fora dela, o cache está misturado.`);
  // Resposta com erro (status ≥ 400) não é o servidor: com a origem fora do ar,
  // quem responde é a BORDA, com a página de erro dela (502, ~50 bytes), e não
  // há com o que comparar. O app passou a marcá-la `erro: 'http N'`; o relatório
  // de antes a trazia como `igual: false` e a triagem acusava "código diferente
  // do servidor" em TODO arquivo (auditoria de 2026-10-01, R5-4-3).
  const semServidor = (v) => Number(v && v.http) >= 400;
  const dif = Object.entries(cvr).filter(([, v]) => v && v.igual === false && !semServidor(v));
  const erros = Object.entries(cvr).filter(([, v]) => v && (v.erro || semServidor(v)));
  // Relatório ANTERIOR ao v9 comparava o `/` com o script que o Cloudflare injeta
  // a cada resposta (token e hora próprios): diferia SEMPRE, com o mesmo tamanho
  // (MEDIDO em produção em 2026-09-25). Não é versão velha, e não vira alerta.
  const soBorda = (u, v) => (d._versaoDoDiag ?? 0) < 9 && nome(u) === '/' && v.bytesAparelho === v.bytesServidor;
  const reais = dif.filter(([u, v]) => !soBorda(u, v));
  out(`${Object.keys(cvr).length} arquivos conferidos com o servidor · diferentes: ${reais.length}${erros.length ? ` · sem conferir: ${erros.length}` : ''}`);
  const porStatus = new Map();
  for (const [, v] of erros) if (semServidor(v)) porStatus.set(Number(v.http), (porStatus.get(Number(v.http)) || 0) + 1);
  for (const [status, n] of porStatus) {
    out(`  sem conferir: o servidor respondeu ${status} em ${n} ${n === 1 ? 'arquivo' : 'arquivos'}`
      + (status >= 500 ? ' — a origem fora do ar (quem respondeu foi a borda, com a página de erro dela)' : '')
      + ': não há com o que comparar');
  }
  for (const [u, v] of dif) {
    out(`  DIFERENTE: ${nome(u)} (aparelho ${v.bytesAparelho} bytes · servidor ${v.bytesServidor} bytes)`
      + (soBorda(u, v) ? ' — com o mesmo tamanho: é o script que o Cloudflare injeta a cada resposta, que o relatório anterior ao v9 não descontava' : ''));
  }
  if (reais.length) out('ATENÇÃO: o aparelho roda código diferente do servidor — versão velha no cache, ou misturada.');
  // A COLETA (relatório v11+): o que NÃO respondeu no orçamento do relatório —
  // rede pendurada dita no arquivo, e não deduzida de um "sem conferir".
  const co = d.coleta;
  if (co && Array.isArray(co.semResposta)) {
    out(`coleta: ${co.ms} ms (orçamento ${co.orcamentoMs} ms) · sem resposta: ${co.semResposta.length}`);
    if (co.semResposta.length) out(`ATENÇÃO: ${co.semResposta.length} leitura(s) sem resposta no orçamento — rede pendurada na hora do relatório: ${co.semResposta.map(nome).slice(0, 8).join(', ')}${co.semResposta.length > 8 ? '…' : ''}`);
  }
}

secao('SERVICE WORKER');
const sw = d.serviceWorker || {};
out(`controlando ${sw.controlando} · registros ${j((sw.registros || []).map((x) => ({ estado: x.estadoAtivo, esperando: !!x.esperando, instalando: !!x.instalando })))}`);
const sp = sw.proprio;
if (sp === undefined) out('por ele mesmo: ' + AUSENTE);
else if (!sp) out('por ele mesmo: sem controlador (nada a perguntar)');
else if (sp.semResposta) out('por ele mesmo: NÃO respondeu (worker de versão antiga, ou travado)');
else out(`por ele mesmo: ${sp.versao} · vivo há ${Math.round((sp.idadeMs || 0) / 1000)}s · lista pronta ${sp.listaPronta} com ${sp.tilesNaLista} tiles · do cache ${sp.doCache} · cache sem entrada ${sp.cacheSemEntrada} · esperou leitura ${sp.esperouLeitura} · fora da lista ${sp.foraDaLista}`);

// `sessaoDuracaoH` é um OBJETO desde que nasceu (`{menor, mediana, maior, n}`,
// só dos ciclos com as duas pontas medidas), e esta linha o interpolava cru:
// saía "[object Object]" em TODO relatório com ciclo fechado, do v2 ao v10 — a
// resposta da pergunta que a seção existe pra responder ("dura 2 dias ou 7?")
// virava lixo na triagem (auditoria de 2026-09-26). Os PISOS (ciclo que começou
// num `jaAtiva`: a duração é "pelo menos") ficam FORA da conta de propósito, e
// a linha diz quantos são e quanto cada um já durou — `pisos` entrou depois do
// v2, então o relatório antigo diz que não o trazia.
function duracaoDaSessao(dur, sessao) {
  let conta;
  if (dur && typeof dur === 'object') {
    conta = `mediana ${dur.mediana ?? '?'} · menor–maior ${dur.menor ?? '?'}–${dur.maior ?? '?'} · n ${dur.n ?? '?'}`;
  } else if (dur === undefined) conta = AUSENTE;
  else if (dur === null) conta = '— (nenhum ciclo fechado com o início medido)';
  else conta = String(dur);
  if (!sessao) return conta;
  if (!Number.isFinite(sessao.pisos)) return `${conta} · pisos ${AUSENTE}`;
  const pisos = (Array.isArray(sessao.ciclos) ? sessao.ciclos : [])
    .filter((c) => c && c.inicioConhecido === false && Number.isFinite(c.durouH))
    .map((c) => `≥ ${c.durouH}${c.fim === 'em curso' ? ', em curso' : ''}`);
  return `${conta} · pisos ${sessao.pisos}${pisos.length ? ` (${pisos.join('; ')})` : ''}`;
}

secao('SESSÃO E ARMAZENAMENTO');
out(`duração da sessão (h): ${duracaoDaSessao(r.sessaoDuracaoH, d.sessao)} · nascimento ${d.sessao?.nascimento ?? '—'} · idade do armazenamento (h) ${d.sessao?.idadeDoArmazenamentoH ?? '—'}`);
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

// "Já tratado" chega com `ok: false`, mas é o pedido resolvido por outro editor
// (pro app, sucesso): chamá-lo de FALHOU manda o leitor atrás de defeito que
// não existe.
function estadoDaChamada(c) {
  if (c.ok) return 'ok';
  if (c.errorCategory === 'already_processed' || c.errorCategory === 'not_found') return 'já tratado';
  return 'FALHOU';
}

secao('CHAMADAS À API (sem corpo)');
const chamadas = Array.isArray(d.chamadas) ? d.chamadas : [];
if (!chamadas.length) out('(nenhuma)');
for (const c of chamadas.slice(-30)) {
  // A AÇÃO do chat (abrir, enviar, confirmar…) é o que distingue as chamadas
  // dele entre si; o resto do pedido fica no arquivo.
  const acao = c.rota === 'chat' && c.corpoReq && typeof c.corpoReq.acao === 'string' ? ` (${c.corpoReq.acao.slice(0, 12)})` : '';
  out(`${hora(c.t)}  ${(String(c.rota) + acao).padEnd(16)} http ${c.http} · ${estadoDaChamada(c)} · ${c.ms} ms${c.errorCategory ? ' · ' + c.errorCategory : ''}${c.errorKey ? ' · ' + c.errorKey : ''}`);
}
if (chamadas.length > 30) out(`(… e mais ${chamadas.length - 30} antes destas)`);

// Uma captura em três linhas — a mesma forma pra desta abertura e pras
// anteriores, senão as duas seções divergem na primeira mudança.
function linhasDaCaptura(m, recuo = '') {
  const quebradas = Array.isArray(m.imagens) ? m.imagens.filter((i) => i.quebrada).length : '—';
  const alertasM = Array.isArray(m.alertas) ? (m.alertas.length ? m.alertas.map((a) => a.chave).join(', ') : 'nenhum') : AUSENTE;
  // A captura feita DENTRO do treino (R8-4-06): a `fila` da 3ª linha conta os exemplos.
  const noTreino = m.treino && m.treino.ativo === true ? ` · DENTRO DO TREINO (${m.treino.exemplos ?? '?'} exemplos na fila)` : '';
  out(`${recuo}${hora(m.t)}  ${m.motivo} · tela ${m.tela} · painel ${painelComVariante(m)} · card montado ${m.cardMontado === undefined ? AUSENTE : m.cardMontado} · modais ${j(m.modais)}${noTreino}`);
  out(`${recuo}    rede ${m.rede === undefined ? AUSENTE : j(m.rede)} · offline ${m.offline === undefined ? AUSENTE : j(m.offline)}`);
  out(`${recuo}    fila ${m.estado?.fila} · restam ${m.estado?.serverTotal} · hasMore ${m.estado?.hasMore} · loadError ${m.estado?.loadError} · imagens quebradas ${quebradas} · alertas: ${alertasM}`);
}

secao('CAPTURAS');
const momentos = Array.isArray(d.momentos) ? d.momentos : [];
if (!momentos.length) out('(nenhuma)');
for (const m of momentos) linhasDaCaptura(m);

// As aberturas ANTERIORES que ficaram guardadas no aparelho (só com o modo dev
// ligado nelas) — é onde mora o defeito que atravessa fechar e reabrir o app.
// As mesmas regras do resto: nada de `dom`, nenhum corpo de chamada (que nem
// chega a ser guardado), e o token trocado no fim.
const quando = (t) => {
  const dt = typeof t === 'number' ? new Date(t) : new Date(String(t));
  return Number.isNaN(dt.getTime()) ? String(t) : dt.toISOString().replace('T', ' ').slice(0, 19);
};
// E a OUTRA ABA que viveu junto com a do relatório vem aqui também — marcada,
// porque entre as duas não houve fechar e reabrir (ver `juntoComEsta`).
secao('OUTRAS ABERTURAS (guardadas no aparelho: anteriores, ou outra aba aberta junto)');
const anteriores = d.aberturasAnteriores;
if (anteriores === undefined) out(AUSENTE);
else if (!anteriores.length) out('(nenhuma)');
else {
  for (const a of [...anteriores].sort((x, y) => (x.inicio || 0) - (y.inicio || 0))) {
    const di = Array.isArray(a.diario) ? a.diario : [];
    const ch = Array.isArray(a.chamadas) ? a.chamadas : [];
    const er = Array.isArray(a.erros) ? a.erros : [];
    const ms = Array.isArray(a.momentos) ? a.momentos : [];
    // `retrato`: veio do retrato SÍNCRONO do fechar (auditoria de 2026-09-29, D2), não da base —
    // a gravação da base não chegou ao fim. Se o teto do retrato cortou, o que
    // falta NÃO quer dizer "não aconteceu": as linhas abaixo dizem onde e quanto.
    out(`abertura ${a.id} · ${quando(a.inicio)} → ${quando(a.salvoEm)} (guardada por: ${a.salvoPor}${a.retrato ? ', retrato do fechar' : ''}) · v${a.versao ?? '?'}`);
    if (juntoComEsta(a)) {
      const agora = a.abertaAgora === true ? ' — seguia aberta na hora do relatório'
        : a.abertaAgora === false ? ' — já tinha fechado na hora do relatório' : '';
      out(`  OUTRA ABA, aberta junto com a do relatório${agora}: entre as duas não houve fechar e reabrir.`);
    }
    out(`  diário ${di.length} · chamadas ${ch.length} (falhas ${ch.filter((c) => estadoDaChamada(c) === 'FALHOU').length}) · erros ${er.length} · capturas ${ms.length}`);
    const NOMES_DO_CORTE = { diario: 'diário', chamadas: 'chamadas', erros: 'erros' };
    // ONDE o teto do retrato deixou falta (auditoria de 2026-10-01, R5-4-5). O
    // app de hoje grava `lacunas`, com o lugar e a conta da JUNÇÃO com a base: o
    // começo pode ter vindo da base, e aí a falta fica no MEIO. O de antes
    // trazia só `cortados` (os mais antigos do RETRATO), e a triagem afirmava
    // "no começo" mesmo quando a base o tinha — desse, não dá pra saber onde.
    const UNIDADE = { diario: ['registro do diário', 'registros do diário'], chamadas: ['chamada', 'chamadas'], erros: ['erro', 'erros'] };
    const lacunas = Object.entries(a.lacunas && typeof a.lacunas === 'object' ? a.lacunas : {})
      .filter(([lista, l]) => UNIDADE[lista] && l && Number(l.n) > 0);
    for (const [lista, l] of lacunas) {
      const n = Number(l.n);
      const onde = l.de === null || l.de === undefined
        ? `no começo, antes de ${hora(l.ate)}`
        : `no meio, entre ${hora(l.de)} e ${hora(l.ate)} — o que veio antes estava gravado`;
      out(`  o retrato cortou pelo TETO: ${n === 1 ? 'falta' : 'faltam'} ${n} ${UNIDADE[lista][n === 1 ? 0 : 1]} ${onde}; não quer dizer "não aconteceram"`);
    }
    const cortes = lacunas.length ? [] : Object.entries(a.cortados && typeof a.cortados === 'object' ? a.cortados : {})
      .filter(([lista, n]) => NOMES_DO_CORTE[lista] && Number(n) > 0);
    if (cortes.length) {
      out(`  o retrato cortou pelo TETO os mais antigos: ${cortes.map(([lista, n]) => `${NOMES_DO_CORTE[lista]} ${Number(n)}`).join(' · ')}`
        + ' — faltam no começo, ou no meio se a abertura já tinha sido gravada antes (este relatório não diz onde); não quer dizer "não aconteceram"');
    }
    const t0a = di.length ? di[0].t : 0;
    for (const e of di) {
      const { t, k, ...resto } = e;
      const delta = typeof t === 'number' && typeof t0a === 'number' ? ` +${((t - t0a) / 1000).toFixed(3)}s` : '';
      out(`  ${hora(t)}${delta}  ${k}  ${Object.keys(resto).length ? j(resto, 200) : ''}`);
    }
    for (const c of ch.filter((x) => !x.ok)) {
      out(`  chamada ${estadoDaChamada(c)} ${hora(c.t)} ${c.rota} http ${c.http}${c.errorCategory ? ' · ' + c.errorCategory : ''}${c.errorKey ? ' · ' + c.errorKey : ''}`);
    }
    for (const m of ms) linhasDaCaptura(m, '  ');
    for (const e of er) out(`  erro ${hora(e.t)} ${e.tipo || 'erro'} ${String(e.msg || '').slice(0, 200)}`);
  }
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
// E o SEGREDO DO PAREAMENTO: o link `/#pair=<segredo>` vale uma sessão nova por
// 5 min. Relatório anterior à auditoria de 2026-09-26 o trazia no diário (o toast
// copiável de quando a área de transferência falha, D1), e a triagem o
// imprimia. Pela FORMA do link, que é o que se repete em qualquer versão.
texto = texto.replace(/([#?&]pair=)[^\s"'&<>\\]+/g, '$1<PAREAMENTO>');
console.log(texto);
