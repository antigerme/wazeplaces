// Rodada 31 (auditoria da build final), servidor: cada teste nasceu de um roteiro do auditor e reprova sem o conserto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, makeSessions } from '../server/core.mjs';

const memStore = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => [...m.keys()] }; };
const NETSCAPE = (d, n, v) => `${d}\tTRUE\t/\tTRUE\t0\t${n}\t${v}`;

// R31-1: `excluir-foto` com `action` desconhecida (maiúscula, boolean, typo) caía na EXCLUSÃO de verdade.
test('R31-1: excluir-foto com action desconhecida responde 400 e não escreve no Waze', async () => {
  const VID = 'v-1';
  const FOTOS = [
    { id: 'alvo', approved: true, creatorUserId: 1, date: 10, scanned: true, street: false, location: { type: 'Point', coordinates: [1, 2] } },
    { id: 'fica', approved: true, creatorUserId: 2, date: 20, scanned: true, street: false, location: { type: 'Point', coordinates: [3, 4] } },
  ];
  // Cada tentativa numa sessão NOVA (a releitura e a lista do local são por sessão).
  const tentar = async (action) => {
    const sessions = makeSessions({ store: memStore(), keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
    const token = await sessions.createSession([NETSCAPE('.waze.com', '_csrf_token', 'abc123'), NETSCAPE('.waze.com', '_web_session', 'xyz')].join('\n'));
    let escritas = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      if (/\/Session/.test(String(url))) return j({ userName: 'a', rank: 5, isAreaManager: true, isStaff: false });
      if (init?.method === 'POST') { escritas++; return j({ venues: { [VID]: { id: VID, images: JSON.parse(init.body).actions._subActions[0].attributes.images } }, status: 0, synced: true }); }
      return j({ venues: { objects: [{ id: VID, images: FOTOS, permissions: -1 }] }, users: { objects: [] } });
    };
    try {
      const corpo = { sessionToken: token, region: 'row', venueID: VID, imageID: 'alvo', lat: -12.8, lon: -38.3, ...(action === undefined ? {} : { action }) };
      const r = await dispatch('excluir-foto', corpo, { sessions });
      return { r, escritas };
    } finally { globalThis.fetch = original; }
  };
  for (const action of ['Preparar', 'prepare', true, 'apagar', 1, {}]) {
    const { r, escritas } = await tentar(action);
    assert.equal(r.status, 400, `action ${JSON.stringify(action)} devia ser recusada`);
    assert.equal(r.body.errorKey, 'srv.err.badAction');
    assert.equal(escritas, 0, `action ${JSON.stringify(action)} chegou a escrever no Waze`);
  }
  // CONTROLES: sem action, com null e com 'excluir', a exclusão acontece (1 escrita cada).
  for (const action of [undefined, null, 'excluir']) {
    const { r, escritas } = await tentar(action);
    assert.equal(r.status, 200, `action ${JSON.stringify(action)} devia excluir: ${JSON.stringify(r.body)}`);
    assert.equal(escritas, 1, `action ${JSON.stringify(action)} devia escrever uma vez`);
  }
});

// R31-2: o `.card-map` anuncia role="button" e está no Tab — Enter e Espaço abrem a ampliação como o toque.
import { readFileSync } from 'node:fs';
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
test('R31-2-1: o box do mini-mapa abre pelo teclado (Enter e Espaço), sem roubar Ctrl/Meta/Alt', () => {
  const sem = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(sem, /mapaBoxF\.addEventListener\('keydown', \(ev\) => \{\s*if \(ev\.target !== mapaBoxF \|\| \(ev\.key !== 'Enter' && ev\.key !== ' '\)\) return;\s*if \(atalhoDoNavegador\(ev\)\) return;\s*ev\.stopPropagation\(\); ev\.preventDefault\(\);\s*MapaLightbox\.open\(place\);/,
    'o mapa do card não abre por Enter/Espaço');
});

// R31-2-2: os selos acionáveis (17 px) ganham área de toque invisível; 4 px (25 px de altura) — mais que isso cobre o chip vizinho quando quebram de linha.
test('R31-2-2: .selo-acionavel tem área de toque de 4 px (não 14) sem mudar o desenho', () => {
  assert.match(CSS, /\.selo-acionavel::after \{ content: ''; position: absolute; inset: -4px -2px; \}/, 'a área de toque do selo mudou');
  assert.match(CSS, /\.selo-acionavel \{ position: relative; \}/);
});
