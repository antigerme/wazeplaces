// Roda o js/presenca.js INTEIRO num navegador de mentira, pra testar o que ele
// FAZ — não o texto dele. É script clássico de browser (não módulo), então o
// arquivo é avaliado com os globais que ele usa no escopo: DOM mínimo,
// armazenamento em memória, API que responde o que o teste mandar e relógio
// de timers manual (nada espera de verdade).
//
// O que vem do app.js (escapeHtml, distanciaKm, linkWmeDoPedido) é FATIADO de
// lá, não reescrito: dublê mais generoso que o original mede um comportamento
// que o app não tem.
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const FONTE = readFileSync(new URL('../js/presenca.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function fatiarDoApp(nome) {
  const i = APP.search(new RegExp(`^(?:const|function) ${nome}\\b`, 'm'));
  if (i < 0) throw new Error(`sumiu do app.js: ${nome}`);
  if (APP.startsWith('const', i)) return APP.slice(i, APP.indexOf(';\n', i) + 2);
  const a = APP.indexOf('{', APP.indexOf(')', i));
  let prof = 0;
  for (let j = a; j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}' && --prof === 0) return APP.slice(i, j + 1);
  }
  throw new Error(`não delimitei ${nome}`);
}
// O dicionário de VERDADE, pro que o teste quer ver traduzido (os tipos de
// pedido). O resto do `t` devolve a própria chave, que é o que as asserções
// casam — e é também o caso "chave que esta versão não conhece".
const I18N = new Function('window', 'navigator', 'localStorage', 'document',
  readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8') + '\nreturn I18N_DICT;')(
  {}, { language: 'pt-BR' }, { getItem: () => null, setItem() {} }, { documentElement: {}, querySelectorAll: () => [] });
const TRADUZIDAS = /^card\.updateType\./;

const DO_APP = ['WME_EDITOR_URL', 'COORD_CASAS', 'coordDoLink', 'linkWmeDoPedido', 'distanciaKm', 'escapeHtml', 'humanizarEnum', 'rotuloDeEnum', 'MARCA_DA_ABA_TRAVA',
  'focavelNaTela']
  .map(fatiarDoApp).join('\n');

class Classes {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach((x) => this.s.add(x)); }
  remove(...c) { c.forEach((x) => this.s.delete(x)); }
  contains(c) { return this.s.has(c); }
  toggle(c, forca) {
    const ter = forca === undefined ? !this.s.has(c) : !!forca;
    if (ter) this.s.add(c); else this.s.delete(c);
    return ter;
  }
}

function elemento(id) {
  const ouvintes = {};
  const el = {
    id, innerHTML: '', textContent: '', value: '', disabled: false, dataset: {},
    scrollTop: 0, scrollHeight: 0, clientHeight: 0, childElementCount: 0,
    classList: new Classes(), atributos: {},
    // Pro `focavelNaTela` do app.js (fatiado acima): está no documento, e só
    // tem caixa na tela quando não está escondido — sem ancestrais aqui.
    isConnected: true,
    getClientRects() { return el.classList.contains('hidden') ? [] : [{ width: 44, height: 44 }]; },
    setAttribute(k, v) { this.atributos[k] = String(v); },
    getAttribute(k) { return this.atributos[k] ?? null; },
    removeAttribute(k) { delete this.atributos[k]; },
    focus() { el.focado = true; },
    addEventListener(tipo, fn) { (ouvintes[tipo] ||= []).push(fn); },
    disparar(tipo, ev = {}) { for (const fn of ouvintes[tipo] || []) fn({ preventDefault() {}, ...ev }); },
    parentElement: { classList: new Classes() },
  };
  return el;
}

// Cria um cliente novo. `api` responde por rota: `presencaApp(campos)` e
// `chat(campos)` devolvem a resposta (ou uma promessa dela). `aba` é a marca
// da aba (`ABA_DESTA_PAGINA`, do app.js); sem ela, a página não tem marca.
export function novoCliente({ api = {}, perfilId = 12444348, pais = 30, visivel = 'visible', agora = null, paisDaFila = undefined, aba = undefined } = {}) {
  const els = new Map();
  const $ = (id) => { if (!els.has(id)) els.set(id, elemento(id)); return els.get(id); };
  const armazenado = new Map();
  // `saindoNoChat[i]` é o modo "saindo" do api.js (o `keepalive`) na hora da
  // chamada `chat[i]`: é ele que diz se o pedido sobrevive à página que morre.
  const chamadas = { presencaApp: [], chat: [], saindoNoChat: [], setSaindo: [], openModal: [], closeModal: [], unauthorized: 0,
    fetch: [], dfato: [], refazerPerfil: 0, despacharJanela: 0 };
  const timers = [];
  let proximoTimer = 1;
  const relogio = { agora: agora ?? Date.now() };
  const DateFalso = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(relogio.agora); }
    static now() { return relogio.agora; }
  };
  const doc = {
    visibilityState: visivel,
    getElementById: $,
    addEventListener(tipo, fn) { (doc._ouv[tipo] ||= []).push(fn); },
    _ouv: {},
  };
  const win = {
    crypto: webcrypto,
    _ouv: {},
    addEventListener(tipo, fn) { (win._ouv[tipo] ||= []).push(fn); },
    cardParaConversa: null,
    abrirPedidoRecebido: (...a) => { chamadas.pedidoAberto = a; },
  };
  const AppState = {
    authenticated: true,
    preferences: {},
    profile: { id: perfilId, userName: 'antigerme' },
    currentPlace: null,
    countries: [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }],
  };
  const API = {
    getSession: () => 'token-de-teste',
    getCountry: () => pais,
    getRegion: () => 'row',
    async presencaApp(c) { chamadas.presencaApp.push(c); return api.presencaApp ? api.presencaApp(c) : { success: true, online: [], conversas: [] }; },
    async chat(c) { chamadas.chat.push(c); chamadas.saindoNoChat.push(API.saindo === true); return api.chat ? api.chat(c) : { success: true }; },
    // O modo "saindo" do api.js: com ele, o pedido vai com `keepalive`.
    saindo: false,
    setSaindo(v) { chamadas.setSaindo.push(!!v); API.saindo = !!v; },
  };
  const escopo = {
    document: doc,
    window: win,
    navigator: { onLine: true },
    AppState,
    API,
    safeLS: {
      get: (k) => (armazenado.has(k) ? armazenado.get(k) : null),
      set: (k, v) => armazenado.set(k, String(v)),
      remove: (k) => armazenado.delete(k),
    },
    t: (k, v) => (TRADUZIDAS.test(k) && I18N.pt[k] ? I18N.pt[k] : v ? `${k}${JSON.stringify(v)}` : k),
    i18nLocale: () => 'pt-BR',
    openModal: (id) => { chamadas.openModal.push(id); $(id).classList.remove('hidden'); },
    closeModal: (id) => { chamadas.closeModal.push(id); $(id).classList.add('hidden'); },
    handleUnauthorized: () => { chamadas.unauthorized += 1; },
    // Do app.js: pedir de novo o perfil que falta (com o teto de 1/min dele) e
    // despachar a janela do Desfazer. Aqui só CONTAM — quem faz é o app.
    refazerPerfilSeFaltar: () => { chamadas.refazerPerfil += 1; },
    despacharJanelaDoDesfazer: () => { chamadas.despacharJanela += 1; },
    // O diário sempre ligado do app.js (`dfato`). Aqui ele só GUARDA, pra o
    // teste ver a linha do tempo que a presença deixa pro diagnóstico.
    dfato: (k, o) => { chamadas.dfato.push([k, o]); },
    fetch: async (...a) => { chamadas.fetch.push(a); return api.fetch ? api.fetch(...a) : new Response('[]'); },
    setTimeout: (fn, ms) => { const id = proximoTimer++; timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    crypto: webcrypto,
    atob, TextDecoder, Response,
    Date: DateFalso,
    // Do api.js (carregado antes do presenca.js no app de verdade).
    REGIOES_DO_WAZE: ['row', 'na', 'il'],
    // Do app.js: o país da FILA (com "Minha área", o da área), que é o país da
    // presença. Sem ele, a presença usa o do filtro (`API.getCountry`). O teste
    // que o quer passa o de verdade, fatiado do app.js.
    paisDaFila,
    // Do app.js: a marca desta aba (a da fila de saída e do "invisível").
    ABA_DESTA_PAGINA: aba,
  };
  const nomes = [...new Set([...FONTE.matchAll(/^(?:async )?function (\w+)\(/gm), ...FONTE.matchAll(/^const (\w+)/gm)].map((m) => m[1]))];
  const globais = Object.keys(escopo);
  const corpo = `${DO_APP}\n${FONTE}\nreturn { ${nomes.join(', ')} };`;
  const P = new Function(...globais, corpo)(...globais.map((g) => escopo[g]));
  // Todos os elementos que a presença consulta nascem ESCONDIDOS, como no HTML.
  for (const id of ['presencaPill', 'presencaModal', 'conversaModal', 'pedidoModal', 'conversaAnexo', 'conversaCardBtn', 'presencaIconMsg', 'conversaEstado']) $(id).classList.add('hidden');
  return {
    P, $, els, armazenado, chamadas, timers, relogio, AppState, API, doc, win, escopo,
    // Roda os timers pendentes (os que existem AGORA), em ordem de prazo.
    async rodarTimers() {
      const agora = timers.splice(0).sort((a, b) => a.ms - b.ms);
      for (const x of agora) await x.fn();
    },
    guardado() { return JSON.parse(armazenado.get('waze_places_chat') || '{}'); },
  };
}

// Bytes de uma mensagem do chat, montados pelo MESMO construtor do servidor.
export async function bytesDeMensagem(m) {
  const g = await import('../server/wme-grpc.mjs');
  const corpo = g.corpoEnviarTexto({ cabecalho: null, ts: m.ts ?? 1790182220160, id: m.id, para: m.para, de: m.de ?? null, texto: m.texto ?? 'oi', ctx: m.ctx ?? null });
  return g.lerCampos(corpo).find((c) => c.n === 2).v;
}
export async function bytesDeRecibo(m) {
  const g = await import('../server/wme-grpc.mjs');
  const corpo = g.corpoRecibo({ cabecalho: null, ts: m.ts ?? 1790182220160, id: m.id, para: m.para, de: m.de ?? null, tipo: m.tipo === 'lida' ? 2 : 1, ids: m.ids });
  return g.lerCampos(corpo).find((c) => c.n === 2).v;
}
export const b64 = (u8) => Buffer.from(u8).toString('base64');
