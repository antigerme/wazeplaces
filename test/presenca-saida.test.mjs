// Quando a outra pessoa SAI, a conversa tem que dizer que ela saiu — venha
// primeiro o aviso da sala ou o fechamento do canal.
//
// Os dois partem juntos (o `pagehide` manda o `sair` e fecha o canal no mesmo
// instante), mas o do canal vai direto ao outro aparelho e o da sala dá dois
// saltos pelo servidor. MEDIDO saindo da app como o usuário sai, nos dois
// motores: 1 em 8 rodadas o canal chegava primeiro, a conversa ficava em
// 'fechada', a sala era ignorada — e 15 s depois a falha de conexão do pc que
// seguia vivo trocava o cabeçalho para "Não deu pra conectar com esta pessoa".
//
// Mesmo padrão do test/recibos.test.mjs: FATIA o js/presenca.js e o executa
// num escopo de mentira, pra exercitar o código que roda no aparelho.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/presenca.js', import.meta.url), 'utf8');

// Âncoras em DECLARAÇÃO, nunca em comentário nem em distância (gotcha #67).
function fatiar(inicio, fim) {
  assert.ok(fonte.includes(inicio), `sumiu do presenca.js: ${inicio}`);
  assert.ok(fonte.includes(fim), `sumiu do presenca.js: ${fim} — o corte precisa ser revisto`);
  const a = fonte.indexOf(inicio), b = fonte.indexOf(fim);
  assert.ok(b > a, `${fim} veio ANTES de ${inicio} — o corte pegaria o arquivo ao contrário`);
  return fonte.slice(a, b);
}
const trecho = [
  fatiar('function presencaConversa(', 'function presencaSinalRecebido('),
  fatiar('function presencaMotivoDaFalha(', 'function presencaOlhando('),
  fatiar('function presencaEncerrarConversa(', 'function presencaEsquecerBloqueioAntigo('),
].join('\n');

// O pc de mentira guarda o ouvinte que a app pendura nele: é por esse ouvinte
// que a falha de conexão de 15 s depois reescreveria o cabeçalho.
class PCFalso {
  constructor() {
    this.connectionState = 'connected';
    this.signalingState = 'stable';
    this.onicecandidate = this.ondatachannel = this.onconnectionstatechange = null;
    this.fechou = false;
  }
  close() { this.fechou = true; }
  // O bastante pro `presencaChamar` religar a conversa.
  createDataChannel() { const c = canalFalso(); c.readyState = 'connecting'; return c; }
  async createOffer() { return { type: 'offer', sdp: '' }; }
  async setLocalDescription() {}
  // O que o navegador faz ~15 s depois de o outro lado sumir (medido nos dois
  // motores): a conexão vira 'failed' e o evento dispara — se houver ouvinte.
  falharMaisTarde() {
    this.connectionState = 'failed';
    if (this.onconnectionstatechange) this.onconnectionstatechange();
  }
}
const canalFalso = () => ({
  readyState: 'open', enviados: [], fechou: false,
  onopen: null, onclose: null, onmessage: null,
  send(x) { this.enviados.push(x); },
  close() { this.fechou = true; this.readyState = 'closed'; },
});

function montar() {
  const escopo = {
    Presenca: { aberta: 'pb', conversas: new Map(), peers: [{ peer: 'pb', nome: 'bia' }] },
    RTCPeerConnection: PCFalso,
    PRESENCA_CONVERSA_V: 2,
    presencaEnviarSinal: () => {},
    presencaEntregarMsg: () => {},
    presencaRenderConversa: () => {},
    presencaRenderLista: () => {},
  };
  const nomes = Object.keys(escopo);
  const corpo = trecho + '\nreturn { presencaConversa, presencaCriarPC, presencaLigarCanal, presencaChamar,'
    + ' presencaMotivoDaFalha, presencaMarcarNaoChegou, presencaConferirSumicos, presencaMarcarAusente };';
  const api = new Function(...nomes, corpo)(...nomes.map((n) => escopo[n]));
  return { ...api, Presenca: escopo.Presenca };
}

// Uma conversa CONECTADA com a bia, pelo caminho da app: pc, canal, `abriu`.
function conversaAberta(m, ...msgs) {
  const c = m.presencaConversa('pb', 'bia');
  const pc = m.presencaCriarPC('pb');
  const canal = canalFalso();
  m.presencaLigarCanal('pb', canal);
  assert.equal(c.estado, 'aberta', 'pré-condição: a conversa abriu pelo caminho da app');
  c.msgs.push(...msgs);
  return { c, pc, canal };
}
const minha = (id, estado, motivo = null) => ({ meu: true, txt: 'oi', ts: 0, id, estado, motivo });

// ═══ a ordem comum: a sala avisa primeiro ═══════════════════════════════════

test('saída: a sala avisa primeiro — a conversa diz que SAIU e encerra a conexão', () => {
  const m = montar();
  const { c, pc, canal } = conversaAberta(m, minha(1, 'enviada'));
  m.Presenca.peers = [];
  m.presencaConferirSumicos();
  assert.equal(c.estado, 'saiu');
  assert.equal(c.msgs[0].estado, 'falhou');
  assert.equal(c.msgs[0].motivo, 'saiu');
  assert.ok(pc.fechou && canal.fechou, 'a conexão velha fica fechada');
});

// ═══ a ordem que falhava: o canal fecha primeiro ════════════════════════════

test('saída: o canal fecha primeiro — o motivo é PROVISÓRIO até a sala falar', () => {
  const m = montar();
  const { c, canal } = conversaAberta(m, minha(1, 'enviada'));
  canal.onclose();
  // Até aqui a app só sabe que o canal fechou, e diz isso.
  assert.equal(c.estado, 'fechada');
  assert.equal(c.msgs[0].motivo, 'conexao');
  m.Presenca.peers = [];
  m.presencaConferirSumicos();
  assert.equal(c.estado, 'saiu', 'a sala confirmou a saída: a conversa não pode ficar em "fechada"');
  assert.equal(c.msgs[0].motivo, 'saiu', 'a mensagem derrubada pelo fechamento não chegou porque ela SAIU');
});

test('saída: confirmada pela sala, a falha TARDIA do pc não reescreve nada', () => {
  // O sintoma que o editor via: 15 s depois, "Não deu pra conectar com esta
  // pessoa" no lugar de "saiu da fila". Vinha do ouvinte do pc que ficava vivo.
  const m = montar();
  const { c, pc, canal } = conversaAberta(m, minha(1, 'enviada'));
  canal.onclose();
  m.Presenca.peers = [];
  m.presencaConferirSumicos();
  pc.falharMaisTarde();
  assert.equal(c.estado, 'saiu');
  assert.equal(c.msgs[0].motivo, 'saiu');
  assert.ok(pc.fechou, 'o pc da conversa encerrada é fechado');
});

test('saída: o aviso de AUSENTE do servidor faz a mesma correção', () => {
  const m = montar();
  const { c, pc, canal } = conversaAberta(m, minha(1, 'enviando'));
  canal.onclose();
  m.presencaMarcarAusente('pb');
  pc.falharMaisTarde();
  assert.equal(c.estado, 'saiu');
  assert.equal(c.msgs[0].motivo, 'saiu');
});

// ═══ o que NÃO se corrige ═══════════════════════════════════════════════════

test('saída: canal fechado com a pessoa AINDA na sala não vira saída inventada', () => {
  const m = montar();
  const { c, canal } = conversaAberta(m, minha(1, 'enviada'));
  canal.onclose();
  m.presencaConferirSumicos();   // a lista ainda tem a bia
  assert.equal(c.estado, 'fechada');
  assert.equal(c.msgs[0].motivo, 'conexao');
});

test('saída: a falha de uma conexão ANTERIOR segue sendo de conexão', async () => {
  // Só o fechamento imediatamente anterior é corrigido. Aqui o canal cai com a
  // bia AINDA na sala, a conversa é religada pelo caminho da app, e só depois
  // ela sai: a mensagem da conexão anterior caiu mesmo pela conexão.
  const m = montar();
  const { c, canal } = conversaAberta(m, minha(1, 'enviada'));
  canal.onclose();
  m.presencaConferirSumicos();   // a bia segue na sala: nada muda
  assert.equal(c.estado, 'fechada');
  await m.presencaChamar('pb', 'bia');
  const novo = c.canal;
  assert.notEqual(novo, canal, 'pré-condição: a conversa religou com um canal NOVO');
  novo.readyState = 'open';
  novo.onopen();
  assert.equal(c.estado, 'aberta', 'pré-condição: a conversa religada abriu');
  c.msgs.push(minha(2, 'enviada'));
  m.Presenca.peers = [];
  m.presencaConferirSumicos();
  assert.equal(c.estado, 'saiu');
  assert.equal(c.msgs[0].motivo, 'conexao', 'a falha da conexão anterior não é reescrita');
  assert.equal(c.msgs[1].motivo, 'saiu');
});

test('saída: o que JÁ chegou não vira falha quando a sala confirma a saída', () => {
  const m = montar();
  const { c, canal } = conversaAberta(m, minha(1, 'entregue'), minha(2, 'lida'));
  canal.onclose();
  m.Presenca.peers = [];
  m.presencaConferirSumicos();
  assert.deepEqual(c.msgs.map((x) => [x.estado, x.motivo]), [['entregue', null], ['lida', null]]);
});
