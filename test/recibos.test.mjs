// Recibo de mensagem: entregue, lida, e o "não chegou" que só existe aqui.
//
// O módulo mora no js/presenca.js (script de browser, não módulo), então o
// teste FATIA a fonte e a executa num escopo de mentira — mesmo padrão do
// test/autores.test.mjs. Fatiar em vez de reimplementar é o que garante que o
// teste exercite o código que roda no aparelho, e não uma cópia que envelhece.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/presenca.js', import.meta.url), 'utf8');

// ── os dois cortes ──────────────────────────────────────────────────────────
// Âncoras em DECLARAÇÃO, nunca em comentário nem em distância: comentário se
// reescreve e distância alcança outra ocorrência do mesmo nome (gotcha #67).
function fatiar(inicio, fim) {
  assert.ok(fonte.includes(inicio), `sumiu do presenca.js: ${inicio}`);
  assert.ok(fonte.includes(fim), `sumiu do presenca.js: ${fim} — o corte precisa ser revisto`);
  const a = fonte.indexOf(inicio), b = fonte.indexOf(fim);
  assert.ok(b > a, `${fim} veio ANTES de ${inicio} — o corte pegaria o arquivo ao contrário`);
  return fonte.slice(a, b);
}
const trecho = fatiar('const PRESENCA_PESO = {', 'function presencaEncerrarConversa(')
  + '\n' + fatiar('const PRESENCA_GLIFO = {', 'function presencaRenderConversa() {');

function montar({ visivel = true, aberta = 'p1' } = {}) {
  const desenhos = [];
  const escopo = {
    Presenca: { aberta, conversas: new Map() },
    document: { visibilityState: visivel ? 'visible' : 'hidden' },
    // Dicionário de mentira que DEVOLVE A CHAVE: assim o teste afirma sobre a
    // chave escolhida, não sobre a redação — que muda sem ser defeito.
    t: (k, v) => (v && v.nome ? `${k}:${v.nome}` : k),
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    presencaRenderConversa: () => desenhos.push(1),
  };
  const nomes = Object.keys(escopo);
  const corpo = trecho + '\nreturn { PRESENCA_PESO, presencaConfirmar, presencaMotivoDaFalha,'
    + ' presencaMarcarNaoChegou, presencaOlhando, presencaMarcarLidas,'
    + ' PRESENCA_GLIFO, presencaRecibo, presencaFraseDaFalha, presencaHtmlDasMsgs };';
  const api = new Function(...nomes, corpo)(...nomes.map((n) => escopo[n]));
  return { ...api, escopo, desenhos };
}

// Conversa de mentira. `recibos: true` = o outro lado se anunciou.
const conv = (extra = {}) => ({
  nome: 'carla_am', estado: 'aberta', canal: null, naoLidas: 0,
  seq: 0, ultimaRecebida: 0, recibos: true, msgs: [], ...extra,
});
const minha = (id, estado) => ({ meu: true, txt: 'oi', ts: 0, id, estado, motivo: null });
const dela = (id) => ({ meu: false, txt: 'oi', ts: 0, id, estado: null, motivo: null });

// ═══ confirmação ════════════════════════════════════════════════════════════

test('recibo: o ack marca ENTREGUE só a mensagem daquele id', () => {
  const m = montar();
  const c = conv({ msgs: [minha(1, 'enviada'), minha(2, 'enviada')] });
  m.presencaConfirmar(c, 1, 'entregue');
  assert.equal(c.msgs[0].estado, 'entregue');
  assert.equal(c.msgs[1].estado, 'enviada', 'o ack de 1 não pode adiantar a 2');
});

test('recibo: o lido confirma um TRECHO — tudo até `ate`', () => {
  const m = montar();
  const c = conv({ msgs: [minha(1, 'entregue'), minha(2, 'enviada'), minha(3, 'enviada')] });
  m.presencaConfirmar(c, 2, 'lida');
  assert.deepEqual(c.msgs.map((x) => x.estado), ['lida', 'lida', 'enviada']);
});

test('recibo: confirmação NUNCA rebaixa — ack atrasado não desfaz a leitura', () => {
  // A rede reordena mais do que se imagina, e o `lido` cobre um trecho enquanto
  // o `ack` cobre uma. Sem o peso, um ack atrasado apagaria "Lida" da tela.
  const m = montar();
  const c = conv({ msgs: [minha(1, 'lida')] });
  m.presencaConfirmar(c, 1, 'entregue');
  assert.equal(c.msgs[0].estado, 'lida');
});

test('recibo: confirmação não toca nas mensagens DELA', () => {
  const m = montar();
  const c = conv({ msgs: [dela(1), minha(1, 'enviada')] });
  m.presencaConfirmar(c, 9, 'lida');
  assert.equal(c.msgs[0].estado, null, 'mensagem recebida não tem recibo pra mostrar');
  assert.equal(c.msgs[1].estado, 'lida');
});

test('recibo: chegar depois de eu ter desistido APAGA o motivo da falha', () => {
  const m = montar();
  const c = conv({ msgs: [{ ...minha(1, 'falhou'), motivo: 'conexao' }] });
  m.presencaConfirmar(c, 1, 'entregue');
  assert.equal(c.msgs[0].estado, 'entregue');
  assert.equal(c.msgs[0].motivo, null, 'a verdade passou a ser que chegou');
});

// ═══ o motivo da falha ══════════════════════════════════════════════════════

test('recibo: o motivo sai do estado da CONVERSA, e distingue os três casos', () => {
  const m = montar();
  assert.equal(m.presencaMotivoDaFalha(conv({ estado: 'saiu' })), 'saiu');
  assert.equal(m.presencaMotivoDaFalha(conv({ estado: 'falhou' })), 'conexao');
  assert.equal(m.presencaMotivoDaFalha(conv({ estado: 'fechada' })), 'conexao');
  // Canal ainda "aberto" e sem resposta: não se inventa causa que não foi medida.
  assert.equal(m.presencaMotivoDaFalha(conv({ estado: 'aberta' })), null);
});

test('recibo: a frase do "não chegou" NOMEIA quem saiu', () => {
  const m = montar();
  const c = conv({ nome: 'carla_am' });
  const frase = m.presencaFraseDaFalha(c, { motivo: 'saiu' });
  assert.match(frase, /naoChegouSaiu/, 'tem que usar a chave específica, não a genérica');
  assert.match(frase, /carla_am/, 'o nome tem que entrar na frase');
  assert.match(m.presencaFraseDaFalha(c, { motivo: 'conexao' }), /naoChegouConexao/);
  assert.match(m.presencaFraseDaFalha(c, { motivo: null }), /naoChegou$/);
});

test('recibo: sem motivo conhecido a frase é a seca, não uma inventada', () => {
  const m = montar();
  assert.equal(m.presencaFraseDaFalha(conv(), { motivo: 'coisa-que-nao-existe' }),
    'presenca.recibo.naoChegou');
});

// ═══ marcar não chegou ══════════════════════════════════════════════════════

test('recibo: saber que a pessoa saiu derruba o que estava EM VOO na hora', () => {
  // Sem isto a tela mentiria pelos 8s do prazo com a resposta já na mão.
  const m = montar();
  const c = conv({ estado: 'saiu', msgs: [minha(1, 'enviando'), minha(2, 'enviada')] });
  assert.equal(m.presencaMarcarNaoChegou(c), true);
  assert.deepEqual(c.msgs.map((x) => x.estado), ['falhou', 'falhou']);
  assert.deepEqual(c.msgs.map((x) => x.motivo), ['saiu', 'saiu']);
});

test('recibo: o que JÁ chegou não vira falha quando a conversa cai', () => {
  const m = montar();
  const c = conv({ estado: 'falhou', msgs: [minha(1, 'entregue'), minha(2, 'lida'), dela(1)] });
  m.presencaMarcarNaoChegou(c);
  assert.deepEqual(c.msgs.map((x) => x.estado), ['entregue', 'lida', null]);
});

// ═══ "lida" só é verdade com a app na tela ══════════════════════════════════

test('recibo: conversa aberta com a app ESCONDIDA não é leitura', () => {
  assert.equal(montar({ visivel: true, aberta: 'p1' }).presencaOlhando('p1'), true);
  assert.equal(montar({ visivel: false, aberta: 'p1' }).presencaOlhando('p1'), false,
    'modal aberto com o celular no bolso não é leitura');
  assert.equal(montar({ visivel: true, aberta: 'p2' }).presencaOlhando('p1'), false);
});

test('recibo: marcar lidas zera o contador E avisa o outro lado', () => {
  const m = montar();
  const enviados = [];
  const c = conv({ naoLidas: 3, ultimaRecebida: 7, canal: { readyState: 'open', send: (x) => enviados.push(JSON.parse(x)) } });
  m.escopo.Presenca.conversas.set('p1', c);
  m.presencaMarcarLidas('p1');
  assert.equal(c.naoLidas, 0);
  assert.deepEqual(enviados, [{ t: 'lido', ate: 7 }]);
});

test('recibo: canal morto ainda zera o contador — eu li, mesmo sem poder avisar', () => {
  const m = montar();
  const c = conv({ naoLidas: 2, ultimaRecebida: 4, canal: { readyState: 'closed', send: () => { throw new Error('morto'); } } });
  m.escopo.Presenca.conversas.set('p1', c);
  m.presencaMarcarLidas('p1');
  assert.equal(c.naoLidas, 0);
});

test('recibo: sem nada recebido não se manda `lido` — não há o que confirmar', () => {
  const m = montar();
  const enviados = [];
  const c = conv({ ultimaRecebida: 0, canal: { readyState: 'open', send: (x) => enviados.push(x) } });
  m.escopo.Presenca.conversas.set('p1', c);
  m.presencaMarcarLidas('p1');
  assert.deepEqual(enviados, []);
});

// ═══ o desenho ══════════════════════════════════════════════════════════════

test('recibo: a distinção é de FORMA, não de cor — 1 tique contra 2', () => {
  // Cor sozinha não transmite informação (WCAG 1.4.1). Se algum dia 'enviada' e
  // 'entregue' passarem a desenhar o MESMO glifo, só a cor separaria os dois.
  const m = montar();
  const paths = (s) => (s.match(/<path|<circle/g) || []).length;
  assert.equal(paths(m.PRESENCA_GLIFO.enviada), 1, 'enviada é UM tique');
  assert.equal(paths(m.PRESENCA_GLIFO.entregue), 2, 'entregue são DOIS tiques');
  assert.notEqual(m.PRESENCA_GLIFO.enviada, m.PRESENCA_GLIFO.entregue,
    'glifo igual deixaria a cor carregando a informação sozinha');
});

test('recibo: todo glifo leva rótulo de texto pro leitor de tela', () => {
  const m = montar();
  for (const estado of ['enviando', 'enviada', 'entregue', 'lida', 'falhou']) {
    const html = m.presencaRecibo(estado);
    assert.match(html, /aria-label="presenca\.recibo\./, `${estado} sem rótulo`);
    assert.match(html, /aria-hidden="true"/, `${estado}: o svg tem que ser escondido do leitor`);
  }
});

test('recibo: "Lida" sai como TEXTO, não só como tique claro', () => {
  // Dois tiques brancos contra dois tiques cyan é diferença só de cor. A palavra
  // é o que carrega o estado — e é o que o leitor de tela lê.
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv({ msgs: [minha(1, 'lida')] }));
  assert.match(html, /class="conversa-lida">presenca\.recibo\.lida</);
});

test('recibo: UMA linha de falha, na última — entrega é ordenada, falha é sufixo', () => {
  const m = montar();
  const c = conv({ estado: 'saiu', msgs: [minha(1, 'falhou'), minha(2, 'falhou')] });
  c.msgs.forEach((x) => { x.motivo = 'saiu'; });
  const html = m.presencaHtmlDasMsgs(c);
  assert.equal((html.match(/class="conversa-falhou"/g) || []).length, 1,
    'repetir a mesma frase por mensagem não diz nada novo');
});

// ═══ de onde vem a CAPACIDADE do outro lado ═════════════════════════════════
// O `oi` sai UMA vez, de dentro de um `try/catch` vazio. Se aquele `send` falha,
// ele some sem rastro e os recibos daquela conversa ficam desligados PARA SEMPRE
// — indistinguível do cliente antigo. Foi o que o CI pegou em 2026-09-03:
// `recibos` false com o `ack` do MESMO canal já processado.
test('recibo: `ack` e `lido` também acendem a capacidade — o `oi` pode se perder', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  for (const tipo of ['oi', 'ack', 'lido']) {
    const re = new RegExp(`m\\.t === '${tipo}'\\s*\\)\\s*\\{\\s*c\\.recibos = true;`);
    assert.match(semComentarios, re,
      `o recado '${tipo}' precisa acender \`recibos\` — capacidade não pode depender de UM quadro`);
  }
  // A inferência só é exata porque `ack`/`lido` NÃO EXISTEM antes do v2: cliente
  // antigo não os manda, então não pode acender isto por engano. Se algum dia um
  // recado passar a ser mandado por cliente de qualquer versão, esta conta muda.
  assert.match(fonte, /const PRESENCA_CONVERSA_V = 2;/,
    'a versão do protocolo é o que garante que só cliente v2 manda ack/lido');
});

test('recibo: o `oi` continua saindo, e ANTES da fila de pendentes', () => {
  // O `oi` segue sendo o caminho normal — o `ack` é a rede de segurança, não o
  // substituto. Sem o `oi`, a primeira mensagem de uma conversa em que ninguém
  // respondeu ainda ficaria sem recibo até alguém escrever de volta.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('const abriu = () =>');
  assert.ok(i !== -1, 'o `abriu` sumiu do presenca.js');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('canal.onopen', i));
  const envio = bloco.indexOf("t: 'oi'");
  const fila = bloco.indexOf('c.pendentes.splice(0)');
  assert.ok(envio !== -1, 'o `oi` não é mais enviado ao abrir o canal');
  assert.ok(fila !== -1, 'a fila de pendentes sumiu do `abriu`');
  assert.ok(envio < fila,
    'o `oi` tem que sair ANTES dos pendentes, senão a primeira mensagem sai sem recibo');
});

test('recibo: peer de versão ANTIGA não ganha recibo nenhum', () => {
  // O service worker é cache-first pra asset, então depois de cada deploy
  // sobra por dias aparelho rodando o presenca.js velho — que não confirma
  // nada. Mostrar tique ali seria um tique único PRA SEMPRE, indistinguível de
  // mensagem perdida. Degradar pro comportamento de antes é o honesto.
  const m = montar();
  const c = conv({ recibos: false, msgs: [minha(1, 'enviada'), minha(2, 'lida')] });
  const html = m.presencaHtmlDasMsgs(c);
  assert.ok(!html.includes('presenca-recibo'), 'nenhum glifo');
  assert.ok(!html.includes('conversa-lida'), 'nenhuma linha de "Lida"');
  assert.ok(!html.includes('com-recibo'), 'nem o vão reservado pro glifo');
  assert.match(html, /conversa-bolha minha/, 'mas a mensagem em si continua aparecendo');
});

test('recibo: mensagem DELA nunca leva glifo', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv({ msgs: [dela(1)] }));
  assert.ok(!html.includes('presenca-recibo'), 'recibo é da SUA mensagem, não da dela');
});

test('recibo: o texto continua escapado — recibo não abriu buraco de XSS', () => {
  const m = montar();
  const c = conv({ msgs: [{ ...minha(1, 'lida'), txt: '<img src=x onerror=alert(1)>' }] });
  const html = m.presencaHtmlDasMsgs(c);
  assert.ok(!html.includes('<img'), 'o texto da mensagem tem que sair escapado');
  assert.match(html, /&lt;img/);
});

// ═══ o CSS que o desenho pressupõe ══════════════════════════════════════════

test('recibo: o CSS existe pras 5 classes, e sem `opacity` no glifo', () => {
  // Classe que não existe no CSS é indistinguível de classe certa se você olhar
  // só o HTML (gotcha #40). E `opacity` mistura a cor com o fundo, derrubando o
  // contraste sem aparecer no valor computado — por isso cor SÓLIDA.
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const bloco = css.slice(css.indexOf('.conversa-bolha.com-recibo'), css.indexOf('#conversaForm'));
  assert.ok(bloco, 'o bloco do recibo sumiu do styles.css');
  for (const cls of ['enviando', 'enviada', 'entregue', 'lida', 'falhou']) {
    assert.match(bloco, new RegExp(`\\.presenca-recibo\\.${cls}\\b`), `sem cor pra .${cls}`);
  }
  assert.ok(!/\.presenca-recibo[^{]*\{[^}]*opacity/.test(bloco),
    'opacity no glifo derruba o contraste sem aparecer no valor computado');
});
