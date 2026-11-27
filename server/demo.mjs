// ═══════════════════════════════════════════════════════════════════════════
//  A DEMO: o que é PURO (sem store, sem rede, sem API de Node)
// ═══════════════════════════════════════════════════════════════════════════
//
// O apresentador (L6+ com área gerenciada) cria uma demo; a sala abre um link,
// escolhe um apelido e tria os mesmos pedidos, sem login e sem nada indo ao
// Waze. Aqui moram as regras que não dependem de onde o dado fica:
//
//   · quantos pedidos (a cota de Desfazer do MENOR nível que entra no app);
//   · quem pode criar;
//   · o RETRATO (o que o convidado recebe do pedido real);
//   · o apelido e o voto (o que o convidado manda de volta).
//
// O retrato é montado por ALLOWLIST: escreve-se o que fica, nunca se tira o que
// sai. Campo novo do Waze nasce FORA do retrato, que vai pra um link aberto a
// qualquer pessoa — o contrário (lista de exclusão) vazaria campo novo calado.

// ── Quantos pedidos ─────────────────────────────────────────────────────────
// Decisão do dono: a demo tem o que um L2 trata pra destravar o Desfazer. A
// cota é `ceil(UNDO_GATE_BASE / (nível + 1))`, e o `UNDO_GATE_BASE` mora no
// `js/app.js` (a cópia daqui é conferida em `test/demo.test.mjs`, como as
// outras constantes espelhadas). Quem baixar o portão de entrada (MIN_RANK_WAZE)
// ou mexer na base muda a demo junto — e o teste reprova se uma cópia ficar.
export const DEMO_UNDO_GATE_BASE = 60;
export function cotaDaDemo(minRankWaze, base = DEMO_UNDO_GATE_BASE) {
  return Math.ceil(base / (Number(minRankWaze) + 1));
}

// ── Quem cria ───────────────────────────────────────────────────────────────
// Quem cria a demo é quem o app já considera de CONFIANÇA: o mesmo nível dos
// recursos destrutivos (decisão do dono, 2026-11-27). O rank do Waze é
// 0-INDEXADO (a tela mostra rank + 1): L5 é `rank >= 4`. O número mora no app
// (`MIN_RANK_CONFIAVEL`, `js/app.js`), que é script clássico e não importa daqui:
// esta é a cópia do SERVIDOR, e `test/demo.test.mjs` as compara. Staff passa,
// como em todo portão do app.
export const MIN_RANK_DEMO = 4;
export function podeCriarDemo(perfil) {
  if (!perfil || typeof perfil !== 'object') return false;
  if (perfil.isStaff === true) return true;
  return typeof perfil.rank === 'number' && perfil.rank >= MIN_RANK_DEMO && perfil.isAreaManager === true;
}

// ── Limites (a cota do KV é a restrição do projeto) ─────────────────────────
export const DEMO_TTL_S = 48 * 3600;          // o resultado fica lido por 48 h
export const DEMO_VOTOS_JANELA_S = 3 * 3600;  // votos entram por 3 h (ou até o «Encerrar»)
export const DEMO_MAX_PARTICIPANTES = 150;
export const DEMO_CODIGO_TTL_S = 3 * 3600;    // o código curto vale só enquanto a sala vota
export const DEMO_APELIDO_MAX = 20;
export const DEMO_PAIS_MAX = 40;
export const DEMO_SEGUNDOS_MAX = 24 * 3600;

// Mesmo alfabeto do pareamento (sem 0/O/1/I): quem lê no projetor não confunde.
export const DEMO_ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const DEMO_SEGREDO_LEN = 20;  // o link: 100 bits
export const DEMO_CODIGO_LEN = 6;    // o digitável, só sob demanda (~30 bits)
export const DEMO_CHAVE_LEN = 20;    // a chave do apresentador (não vai no link da sala)

export function gerarTexto(tamanho, aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  // Rejeição (não `% 32` direto): 256 é múltiplo de 32, então o resto é uniforme;
  // a conta fica explícita pra quem trocar o alfabeto por um de outro tamanho.
  const n = DEMO_ALFABETO.length;
  const limite = 256 - (256 % n);
  let out = '';
  while (out.length < tamanho) {
    for (const b of aleatorio(tamanho * 2)) {
      if (b < limite && out.length < tamanho) out += DEMO_ALFABETO[b % n];
    }
  }
  return out;
}

// O que o participante digita ou cola: maiúsculas, sem espaço nem hífen.
export function limparCodigo(bruto) {
  return String(bruto == null ? '' : bruto).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export const ehSegredo = (s) => s.length === DEMO_SEGREDO_LEN && [...s].every((c) => DEMO_ALFABETO.includes(c));
export const ehCodigoCurto = (s) => s.length === DEMO_CODIGO_LEN && [...s].every((c) => DEMO_ALFABETO.includes(c));

// ── Apelido e país: texto que a PESSOA digita ───────────────────────────────
// Entra num resultado que o apresentador projeta: sem controle bidi (o Trojan
// Source do CLAUDE.md), sem largura zero, sem quebra de linha. O corte é em
// PONTOS DE CÓDIGO (um emoji não vira meio caractere).
function textoLivreLimpo(bruto, max) {
  if (typeof bruto !== 'string') return null;
  const limpo = bruto.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  return [...limpo].slice(0, max).join('');
}
export const limparApelido = (b) => textoLivreLimpo(b, DEMO_APELIDO_MAX);
export const limparPais = (b) => textoLivreLimpo(b, DEMO_PAIS_MAX);

// ── Votos ───────────────────────────────────────────────────────────────────
// Um texto com UM caractere por pedido, na ordem do retrato: R (✕), L (✓), P (↑),
// `-` (não votou). 30 pedidos são 30 bytes: cabe em qualquer valor ou metadado.
export const VOTOS = ['R', 'L', 'P'];
export function votosValidos(texto, total) {
  return typeof texto === 'string' && texto.length === total && [...texto].every((c) => c === '-' || VOTOS.includes(c));
}
export const votosDoTexto = (texto) => [...texto].map((c) => (c === '-' ? null : c));
export const textoDeVotos = (lista) => lista.map((v) => (VOTOS.includes(v) ? v : '-')).join('');

// ── O RETRATO ───────────────────────────────────────────────────────────────
// Campos do diff que o convidado vê. O resto (descrição, telefone, site,
// apelidos, ids de provedor externo) é texto de TERCEIROS e fica fora — decisão
// do dono, a mesma do `flagComment`. Campo desconhecido também fica fora.
export const CAMPOS_DO_DIFF_NA_DEMO = new Set([
  'name', 'houseNumber', 'categories', 'geometry', 'openingHours', 'streetID', 'cityID',
  'residential', 'brand', 'entryExitPoints', 'services', 'categoryAttributes', 'lockRank',
]);

const texto = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : null);
const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Só https e só SUBDOMÍNIO de waze.com (a mesma régua do `img-src` da CSP). Pelo
// host parseado: um `[a-z0-9.-]*waze\.com` casaria `evilwaze.com`.
function fotoDoWaze(u) {
  if (typeof u !== 'string') return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname.endsWith('.waze.com');
  } catch {
    return false;
  }
}

function entradaDoMapa(e) {
  return e && typeof e === 'object'
    ? { ll: Array.isArray(e.ll) ? e.ll.slice(0, 2).map(numero) : null, estado: texto(e.estado, 40), nome: texto(e.nome), distM: numero(e.distM) }
    : null;
}
function mapaDoRetrato(m) {
  if (!m || typeof m !== 'object') return null;
  return {
    centro: Array.isArray(m.centro) ? m.centro.slice(0, 2).map(numero) : null,
    proposto: Array.isArray(m.proposto) ? m.proposto.slice(0, 2).map(numero) : null,
    movidoM: numero(m.movidoM),
    entradas: lista(m.entradas, 12).map(entradaDoMapa).filter(Boolean),
  };
}
function mudancaDoRetrato(c) {
  if (!c || typeof c !== 'object' || !CAMPOS_DO_DIFF_NA_DEMO.has(c.field)) return null;
  // `from`/`to` são o valor CRU do campo (objeto, lista, texto): passa inteiro,
  // porque o card os formata por campo; o que é texto livre já saiu pelo `field`.
  return { field: c.field, label: texto(c.label, 80), from: c.from === undefined ? null : c.from, to: c.to === undefined ? null : c.to };
}

// `pedidos`: a lista que o `buscar-places` devolveu (um card por pedido).
// Devolve { convidado: [...], apresentador: [...] }. O convidado NUNCA recebe id
// real (a rota de escrita do Waze com um id real e a sessão de QUALQUER editor
// reabre o pedido de outra pessoa); o apresentador guarda os ids, porque o
// resultado dele tem o ↗ pro WME.
export function montarRetrato(pedidos, max) {
  const convidado = [];
  const apresentador = [];
  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    if (convidado.length >= max) break;
    if (!p || typeof p !== 'object') continue;
    const n = convidado.length + 1;
    const d = p.duplicado && typeof p.duplicado === 'object' ? p.duplicado : null;
    convidado.push({
      n,
      venueID: 'demo-' + n,
      updateRequestID: 'demo-' + n,
      name: texto(p.name),
      categories: lista(p.categories, 8).map((c) => texto(c, 60)).filter(Boolean),
      address: texto(p.address),
      updateType: texto(p.updateType, 60),
      updateTypeKey: texto(p.updateTypeKey, 30),
      reqType: texto(p.reqType, 30),
      reqSubType: texto(p.reqSubType, 30),
      purType: texto(p.purType, 30),
      source: texto(p.source, 40),
      isDelete: p.isDelete === true,
      brand: texto(p.brand, 80),
      brandKnown: p.brandKnown === true,
      flagType: texto(p.flagType, 60),
      flagSubjectType: texto(p.flagSubjectType, 30),
      // O alvo da denúncia só ajuda o card quando é uma FOTO (casa com o id da
      // foto no venue); num duplicado é o id de OUTRO local, que não sai.
      flagEntityID: p.flagSubjectType === 'IMAGE' ? texto(String(p.flagEntityID ?? ''), 60) : null,
      duplicado: d ? { nome: texto(d.nome), distM: numero(d.distM), ll: Array.isArray(d.ll) ? d.ll.slice(0, 2).map(numero) : null } : null,
      changes: lista(p.changes, 20).map(mudancaDoRetrato).filter(Boolean),
      camposSemMudanca: numero(p.camposSemMudanca),
      mapa: mapaDoRetrato(p.mapa),
      imageUrls: lista(p.imageUrls, 12).filter(fotoDoWaze),
      dateAdded: numero(p.dateAdded),
      lat: numero(p.lat),
      lon: numero(p.lon),
    });
    apresentador.push({ n, venueID: texto(String(p.venueID ?? ''), 60), updateRequestID: texto(String(p.updateRequestID ?? ''), 60) });
  }
  return { convidado, apresentador };
}
