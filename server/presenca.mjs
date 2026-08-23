// Núcleo PURO da sala de presença — o pedaço compartilhado pelos DOIS
// servidores: o Durable Object da Cloudflare (`worker/sala-do.mjs`) e o
// adaptador Node (`server/node.mjs`). Sem API de plataforma, sem I/O, sem
// relógio próprio: só as regras que os dois precisam aplicar IGUAL.
//
// ── O QUE O SERVIDOR SABE, E POR QUANTO TEMPO ───────────────────────────────
// Enquanto a conexão está aberta, o servidor sabe: nome do editor, rank, se é
// AM, e a fila que ele escolheu. Nada em disco. Quando o socket fecha — app
// fechada, aba trocada, celular bloqueado — some na hora, porque a presença NÃO
// é um registro com prazo: é a própria conexão aberta.
//
// Isso é decisão de projeto, e ela some com um problema inteiro: não há TTL pra
// acertar, não há linha da Ajuda com um número pra divergir do código, e não há
// janela em que o servidor lembra de quem já foi embora. A Ajuda diz "some
// assim que você sai" nas 4 línguas porque é literalmente o que acontece.
//
// A MENSAGEM não passa por aqui. A sala só transporta o aperto de mão do
// WebRTC (offer/answer/ICE); o texto vai cifrado direto entre os aparelhos.
// O que trafega é SDP e candidato, nunca conteúdo.
//
// ── POR QUE A IDENTIDADE NÃO VEM DO CLIENTE ────────────────────────────────
// O nome é o do WME, e ele carrega REPUTAÇÃO (rank, Area Manager). Se qualquer
// um pudesse se dizer `carla_am`, a lista viraria um convite a se passar por
// gente com autoridade. Por isso o nome vem de um CRACHÁ que o servidor assina
// depois de chamar o `/Session` do Waze com os cookies daquela sessão.

export const MAX_BODY = 65536;   // teto de frame — SDP grande cabe com folga
export const CRACHA_TTL = 900;   // 15 min de validade (segundos)

// Teto da lista enviada ao cliente. Uma fila grande (o Brasil inteiro) pode ter
// muita gente, e mandar tudo custa banda a cada entrada e saída. O cliente
// recebe `total` junto, então a pílula continua contando certo.
export const LIMITE_LISTA = 50;

// Higieniza id vindo da rede (sala/peer). Tudo que não for alfanumérico, `_`,
// `-` ou `:` some — o `:` fica porque é o separador da sala (`row:30:5`).
export const limpar = (s) => String(s || '').replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 64);

// ── A SALA É A FILA, e isso é a decisão de produto que dispensa código ──────
// No botequei alguém CRIA a mesa e passa o link. Aqui ninguém combina nada:
// dois editores triando a fila do Brasil já estão, por definição, no mesmo
// lugar. A sala sai do filtro que o editor já escolheu — descoberta de graça.
//
// Fonte ÚNICA, e ela mora SÓ no servidor: o cliente nunca monta este nome. Ele
// manda região/país/estado, recebe a sala dentro do crachá assinado e usa
// aquilo. Montar a string dos dois lados é como os dois deixam de casar sem
// ninguém perceber, e o sintoma seria "não vejo ninguém" — que não se depura.
export function salaDaFila(region, countryId, stateId) {
  const r = limpar(region) || 'row';
  const c = parseInt(countryId, 10);
  if (!Number.isFinite(c) || c <= 0) return null;   // sem país não há sala
  const s = stateId === undefined || stateId === null || stateId === '' ? null : parseInt(stateId, 10);
  return Number.isFinite(s) && s > 0 ? `${r}:${c}:${s}` : `${r}:${c}`;
}

// Credenciais TURN efêmeras no padrão coturn "use-auth-secret"
// (draft-uberti-behave-turn-rest): username = <expiração unix> e credential =
// base64(HMAC-SHA1(segredo, username)). O coturn valida com o MESMO
// static-auth-secret, sem lista de usuários — então dá pra subir coturn na
// PRÓPRIA VM e não depender de TURN de terceiro nenhum.
//
// O HMAC entra por INJEÇÃO porque os dois adaptadores têm crypto diferente
// (Node = `node:crypto` síncrono; Worker = WebCrypto assíncrono). Assim esta
// função fica pura e testável.
export async function credenciaisTurn(urls, segredo, ttlSeg, agora, hmacBase64) {
  const ttl = Number.isFinite(ttlSeg) && ttlSeg > 0 ? Math.floor(ttlSeg) : 86400;
  const username = String(Math.floor(agora / 1000) + ttl);
  const credential = await hmacBase64(segredo, username);
  const lista = Array.isArray(urls) ? urls.filter(Boolean)
    : String(urls || '').split(',').map((u) => u.trim()).filter(Boolean);
  return { iceServers: [{ urls: lista, username, credential }] };
}

// ── CRACHÁ ──────────────────────────────────────────────────────────────────
// Prova, para a SALA, que este peer é mesmo aquele editor do WME. O servidor
// já validou os cookies e chamou o `/Session`; aqui só se assina o resultado.
//
// Por que não mandar o `sessionToken` direto pra sala: ele é a metade da chave
// que decifra os cookies (`HKDF(Secret, token)`, gotcha #60). Ele viaja HOJE
// só no CORPO do POST, nunca em URL — e um upgrade de WebSocket carrega a URL.
// Mandar o token ali o poria no log de acesso ao lado do dado que ele protege.
// O crachá existe pra ser o que PODE aparecer numa query.
export function corpoDoCracha(c) {
  // Ordem fixa: assinatura é sobre string, e chave em ordem diferente é outra
  // string. Serializar com JSON.stringify de objeto montado à mão em dois
  // lugares é como a verificação passa a falhar sem ninguém mexer na chave.
  return [c.peer, c.nome, c.rank, c.am ? 1 : 0, c.staff ? 1 : 0, c.sala, c.exp].join('|');
}

export async function assinarCracha(dados, segredo, agora, hmacBase64) {
  const cracha = {
    peer: limpar(dados.peer),
    nome: String(dados.nome || '').slice(0, 64),
    rank: Number.isFinite(dados.rank) ? dados.rank : 0,
    am: !!dados.am,
    staff: !!dados.staff,
    sala: limpar(dados.sala),
    exp: Math.floor(agora / 1000) + CRACHA_TTL,
  };
  cracha.sig = await hmacBase64(segredo, corpoDoCracha(cracha));
  return cracha;
}

// Devolve o crachá quando ele vale, ou `null` — nunca lança. Quem chama está
// no caminho de rede e trata `null` como "não entra".
export async function conferirCracha(cracha, segredo, agora, hmacBase64) {
  if (!cracha || typeof cracha !== 'object' || !cracha.sig) return null;
  if (!Number.isFinite(cracha.exp) || cracha.exp * 1000 < agora) return null;
  const esperada = await hmacBase64(segredo, corpoDoCracha(cracha));
  // Comparação de tempo constante: `===` em string vaza o prefixo comum pelo
  // tempo de resposta. É barato fazer certo, e o custo de fazer errado é um
  // oráculo pra forjar assinatura.
  if (!igualEmTempoConstante(String(cracha.sig), String(esperada))) return null;
  return cracha;
}

export function igualEmTempoConstante(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

// ── A LISTA ─────────────────────────────────────────────────────────────────
// Recebe os presentes (um por conexão aberta) e devolve o que o cliente vê.
// Compartilhada porque os dois adaptadores desenham a MESMA lista, e "quase
// igual" aqui é a pílula contando 3 num servidor e 4 no outro.
//
// QUEM É "A MESMA PESSOA" É O NOME, NUNCA O `peer`.
//
// O `peer` é sorteado A CADA CARGA DA PÁGINA — ele endereça uma CONEXÃO, não um
// editor. Comparar por ele foi o defeito que o owner viu: recarregar a página
// sorteia um peer novo, o socket antigo demora a fechar, e por essa janela os
// dois estão na sala com nomes iguais e peers diferentes. Resultado medido:
// ele aparecia 2× na PRÓPRIA lista e a pílula contava 3 onde havia 1 colega.
// Recarregando de novo, acumulava — e os colegas o viam repetido também.
//
// O nome vem do CRACHÁ ASSINADO pelo servidor (o username do WME), então é
// único por conta e não dá pra forjar. Sem nome, o peer serve de identidade —
// é o melhor disponível e não junta gente diferente.
const identidadeDe = (p) => String(p && p.nome || '').trim().toLowerCase() || (p && p.peer) || '';

export function listaDePares(presentes, me) {
  // `me` aceita o ident inteiro OU um peer solto (os adaptadores antigos
  // passavam o peer). Com o ident, a comparação é por IDENTIDADE.
  const euId = typeof me === 'string' ? String(me).trim().toLowerCase() : identidadeDe(me);
  const euPeer = typeof me === 'string' ? me : (me && me.peer) || '';
  const porId = new Map();
  for (const p of presentes || []) {
    if (!p || !p.peer) continue;
    const id = identidadeDe(p);
    // SEM o próprio: quem pergunta já sabe que está aqui, e devolver faria a
    // contagem da pílula incluir você — "1 editor online" sozinho na sala.
    if (id === euId || p.peer === euPeer) continue;
    // Mesma pessoa em duas conexões aparece UMA vez, e vale a MAIS RECENTE:
    // o `peer` da lista é o endereço para onde a conversa é chamada, e o antigo
    // é justamente o socket que está morrendo.
    const atual = porId.get(id);
    if (atual && (atual.desde || 0) >= (p.desde || 0)) continue;
    porId.set(id, p);
  }
  const out = [...porId.values()].map((p) => ({
    peer: p.peer, nome: p.nome || '', rank: p.rank || 0, am: !!p.am, staff: !!p.staff,
  }));
  // Ordem estável: sem isso a lista embaralha a cada mudança e a folha pisca.
  out.sort((a, b) => (a.nome || '').localeCompare(b.nome || '') || a.peer.localeCompare(b.peer));
  return { total: out.length, peers: out.slice(0, LIMITE_LISTA) };
}


