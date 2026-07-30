// Suite mínima do core (zero dependências — usa node:test + node:assert nativos).
// Rodar: `node --test`  (ou `npm test`).
//
// Cobre a lógica pura testável sem tocar o Waze: cripto/sessões (round-trip),
// categorização de erro (casos reais do HAR), gate de acesso, parsing de cookies
// e o filtro de domínio (crítico de segurança/privacidade).

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// core.mjs usa `crypto` global (Web Crypto) — garante disponível no runner.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  makeSessions,
  categorizeWazeError,
  isUserAllowed,
  extractCSRFToken,
  validateCookiesFormat,
  filterWazeCookies,
  cookieHeaderFrom,
  isWazeCookieDomain,
  buildPlacesFromSearch,
  SESSION_TTL,
  WAZE_REGIONS,
} from '../server/core.mjs';

const NETSCAPE = (domain, name, value) =>
  `${domain}\tTRUE\t/\tTRUE\t9999999999\t${name}\t${value}`;

function memStore() {
  const m = new Map();
  return {
    _m: m,
    get: (h) => m.get('sess_' + h) ?? null,
    put: (h, blob) => { m.set('sess_' + h, blob); },
    delete: (h) => { m.delete('sess_' + h); },
  };
}

test('cripto: round-trip createSession → loadSession, sem vazar plaintext', async () => {
  const store = memStore();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const sessions = makeSessions({ store, keyBytes });
  const cookies = [NETSCAPE('.waze.com', '_csrf_token', 'abc123'),
                   NETSCAPE('.waze.com', '_web_session', 'segredo-xyz')].join('\n');

  const token = await sessions.createSession(cookies);
  assert.ok(typeof token === 'string' && token.length > 0);
  assert.equal(await sessions.loadSession(token), cookies);

  // Chave do store é hash do token, não o token cru; blob não contém o plaintext.
  const keys = [...store._m.keys()];
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes(token), 'chave do store não deve conter o token');
  const blob = store._m.get(keys[0]);
  assert.ok(!blob.includes('segredo-xyz'), 'blob criptografado não pode conter o cookie');
});

test('cripto: token inválido/nulo → loadSession null; destroySession remove', async () => {
  const store = memStore();
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  assert.equal(await sessions.loadSession('nao-existe'), null);
  assert.equal(await sessions.loadSession(null), null);
  const t = await sessions.createSession(NETSCAPE('.waze.com', '_csrf_token', 'abc'));
  await sessions.destroySession(t);
  assert.equal(await sessions.loadSession(t), null);
});

test('categorizeWazeError: casos reais do HAR e fallbacks', () => {
  const c = (h, b, e) => categorizeWazeError(h, b, e).category;
  // Features (rejeitar) 404 + code 702 → race, não erro
  assert.equal(c(404, JSON.stringify({ errorList: [{ code: 702, details: 'was not found on venue' }] })), 'already_processed');
  // Issues/Read 500 + code 300 → race (NÃO transient)
  assert.equal(c(500, JSON.stringify({ errorList: [{ code: 300, details: 'Failed to handle request' }] })), 'already_processed');
  assert.equal(c(500, '{}'), 'transient');
  assert.equal(c(401, ''), 'unauthorized');
  assert.equal(c(403, ''), 'unauthorized');
  assert.equal(c(404, ''), 'not_found');
  assert.equal(c(409, ''), 'already_processed');
  assert.equal(c(0, '', 'network fail'), 'transient');
  assert.equal(c(418, 'teapot'), 'unknown');
});

test('isUserAllowed: matriz do gate (Staff OU rank>=2 & AM)', () => {
  assert.equal(isUserAllowed({ isStaff: true, rank: 0 }).allowed, true);
  assert.equal(isUserAllowed({ rank: 2, isAreaManager: true }).allowed, true);   // display L3 AM
  assert.equal(isUserAllowed({ rank: 5, isAreaManager: true }).allowed, true);
  assert.equal(isUserAllowed({ rank: 1, isAreaManager: true }).allowed, false);  // L2 AM
  assert.equal(isUserAllowed({ rank: 4, isAreaManager: false }).allowed, false); // L5 não-AM
  assert.equal(isUserAllowed(null).allowed, false);
});

test('extractCSRFToken: formato header e Netscape', () => {
  assert.equal(extractCSRFToken('_csrf_token=abc123; _web_session=xyz'), 'abc123');
  assert.equal(extractCSRFToken(NETSCAPE('.waze.com', '_csrf_token', 'def456')), 'def456');
  assert.equal(extractCSRFToken('sem token aqui'), null);
});

test('validateCookiesFormat', () => {
  assert.equal(validateCookiesFormat('_csrf_token=abc'), true);
  assert.equal(validateCookiesFormat(NETSCAPE('.waze.com', '_csrf_token', 'abc')), true);
  assert.equal(validateCookiesFormat('nada'), false);
});

test('filterWazeCookies: descarta outros domínios (Netscape), preserva Waze', () => {
  const raw = [
    NETSCAPE('.waze.com', '_csrf_token', 'abc'),
    NETSCAPE('.redhat.com', 'sso', 'SEGREDO-RH'),
    NETSCAPE('www.waze.com', '_web_session', 'xyz'),
    NETSCAPE('.github.com', 'gh', 'SEGREDO-GH'),
  ].join('\n');
  const filtered = filterWazeCookies(raw);
  assert.ok(filtered.includes('_csrf_token'));
  assert.ok(filtered.includes('_web_session'));
  assert.ok(!filtered.includes('redhat'));
  assert.ok(!filtered.includes('SEGREDO-RH'));
  assert.ok(!filtered.includes('SEGREDO-GH'));
});

test('filterWazeCookies: formato header (sem tabs) passa direto', () => {
  const header = '_csrf_token=abc; _web_session=xyz';
  assert.equal(filterWazeCookies(header), header);
});

test('cookieHeaderFrom: só cookies waze.com viram header (defesa em profundidade)', () => {
  const raw = [
    NETSCAPE('.waze.com', '_csrf_token', 'abc'),
    NETSCAPE('.redhat.com', 'sso', 'SEGREDO'),
    NETSCAPE('www.waze.com', '_web_session', 'xyz'),
  ].join('\n');
  const header = cookieHeaderFrom(raw);
  assert.ok(header.includes('_csrf_token=abc'));
  assert.ok(header.includes('_web_session=xyz'));
  assert.ok(!header.includes('sso=SEGREDO'));
});

test('isWazeCookieDomain: aceita waze.com/subdomínios, rejeita look-alikes', () => {
  assert.equal(isWazeCookieDomain('.waze.com'), true);
  assert.equal(isWazeCookieDomain('www.waze.com'), true);
  assert.equal(isWazeCookieDomain('waze.com'), true);
  assert.equal(isWazeCookieDomain('.redhat.com'), false);
  assert.equal(isWazeCookieDomain('notwaze.com'), false);
  assert.equal(isWazeCookieDomain('evil-waze.com.br'), false);
  assert.equal(isWazeCookieDomain('waze.com.evil.com'), false);
});

test('constantes de sanidade', () => {
  assert.equal(SESSION_TTL, 1814400);
  assert.ok(WAZE_REGIONS.row.includes('waze.com'));
});

// ─── buildPlacesFromSearch: expansão de PURs em cards ────────────────────────
// Fixture derivada de HAR REAL (bug "place volta", 2026-07-24): venue
// "3o Batalhão PMDF" com 2 PURs — IMAGE já lida + REQUEST/UPDATE não-lido.
// O filtro isRead do Waze é POR VENUE, então o venue volta na busca de não
// lidos enquanto o REQUEST (gated, invisível na app) seguir não-lido. O core
// PRECISA pular PURs já lidos, senão a foto lida re-vira card eternamente.
const harBatalhao = () => ({
  users: { objects: [{ id: 2254353226, userName: 'AoInfinito' }] },
  streets: { objects: [] },
  cities: { objects: [] },
  states: { objects: [] },
  venues: {
    objects: [
      {
        id: '204539498.2045591592.1970007',
        name: '3o Batalhão PMDF',
        permissions: -1,
        categories: ['POLICE_STATION'],
        images: [{ id: 'img-aprovada-1' }],
        venueUpdateRequests: [
          {
            id: '3f0be7f8-d26f-4d59-96e0-4a62e3cbc380',
            venueID: '204539498.2045591592.1970007',
            type: 'REQUEST',
            subType: 'UPDATE',
            changedVenue: { categories: ['OTHER', 'POLICE_STATION'] },
            createdBy: 2254353226,
            isRead: false,
          },
          {
            id: '5dd54258-1bfe-4739-8b72-db4c418b1e79',
            venueID: '204539498.2045591592.1970007',
            type: 'IMAGE',
            createdBy: 2254353226,
            isRead: true,
          },
        ],
      },
    ],
  },
});

test('buildPlacesFromSearch: PUR já lido NÃO vira card com unreadOnly (bug do "place volta")', () => {
  // Cenário exato do HAR: user marcou a foto como lida, venue volta na busca
  // por causa do REQUEST irmão. Antes do fix: 1 card (a foto lida, de novo).
  const { places } = buildPlacesFromSearch(harBatalhao(), { filterTypes: ['VENUE', 'IMAGE'], unreadOnly: true });
  assert.equal(places.length, 0, 'foto já lida não pode voltar como card');
});

test('buildPlacesFromSearch: unreadOnly=false inclui PURs lidos (modo "incluir lidos")', () => {
  const { places } = buildPlacesFromSearch(harBatalhao(), { filterTypes: ['VENUE', 'IMAGE'], unreadOnly: false });
  assert.equal(places.length, 1);
  assert.equal(places[0].updateRequestID, '5dd54258-1bfe-4739-8b72-db4c418b1e79');
  assert.equal(places[0].reqType, 'IMAGE');
});

test('buildPlacesFromSearch: PUR não-lido vira card normalmente', () => {
  const rd = harBatalhao();
  rd.venues.objects[0].venueUpdateRequests[1].isRead = false;
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['VENUE', 'IMAGE'], unreadOnly: true });
  assert.equal(places.length, 1);
  assert.equal(places[0].updateRequestID, '5dd54258-1bfe-4739-8b72-db4c418b1e79');
});

test('buildPlacesFromSearch: isRead ausente entra na fila (defensivo, como permissions)', () => {
  const rd = harBatalhao();
  delete rd.venues.objects[0].venueUpdateRequests[1].isRead;
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['VENUE', 'IMAGE'], unreadOnly: true });
  assert.equal(places.length, 1);
});

test('buildPlacesFromSearch: REQUEST/UPDATE não-lido vira card quando o tipo é pedido (dev mode)', () => {
  const { places } = buildPlacesFromSearch(harBatalhao(), { filterTypes: ['REQUEST'], unreadOnly: true });
  assert.equal(places.length, 1);
  assert.equal(places[0].reqType, 'REQUEST');
  assert.equal(places[0].createdBy, 'AoInfinito');
  assert.ok(places[0].changes.some((c) => c.field === 'categories'));
});

// Fixture do caso REAL reportado pelo owner (2026-07-28): "Estádio Gigante do
// Itiberê", em Paranaguá. O WME oficial mostra UMA mudança — categorias. A app
// mostrava TRÊS: Id, Categorias e UpdatedOn.
const harEstadio = () => ({
  users: { objects: [{ id: 999, userName: 'AsafeCorrea' }] },
  streets: { objects: [] },
  cities: { objects: [] },
  states: { objects: [] },
  venues: {
    objects: [
      {
        id: '204146185.2041396312.1604788',
        name: 'Estádio Gigante do Itiberê',
        permissions: -1,
        categories: ['STADIUM_ARENA'],
        venueUpdateRequests: [
          {
            id: 'ur-estadio-1',
            venueID: '204146185.2041396312.1604788',
            type: 'REQUEST',
            subType: 'UPDATE',
            // O `changedVenue` é um objeto de venue, não um diff: vem com a
            // identidade e o carimbo de modificação junto do que mudou.
            changedVenue: {
              id: '204146185.2041396312.1604788',
              categories: ['STADIUM_ARENA', 'SPORT_COURT'],
              updatedOn: 1785283200000,
              updatedBy: 999,
            },
            createdBy: 999,
            isRead: false,
          },
        ],
      },
    ],
  },
});

test('buildPlacesFromSearch: escrituração do venue não vira "mudança proposta"', () => {
  // `id` é a identidade do local — idêntica antes e depois, ninguém a editou.
  // `updatedOn`/`updatedBy` mudam porque a edição acontece, não porque alguém
  // pediu. Mostrá-los custava linha na caixa de mudanças e, com
  // MAX_CHANGES_DISPLAY, chegava a empurrar mudança de VERDADE pro "+N mais".
  const { places } = buildPlacesFromSearch(harEstadio(), { filterTypes: ['REQUEST'], unreadOnly: true });
  assert.equal(places.length, 1);
  const campos = places[0].changes.map((c) => c.field);
  assert.deepEqual(campos, ['categories'], `sobrou escrituração no diff: ${campos.join(', ')}`);
  // O tipo é montado a partir dos MESMOS rótulos — se sobra ruído aqui, sobra lá.
  assert.equal(places[0].updateType, 'Atualização: Categorias');
});

test('buildPlacesFromSearch: campo desconhecido continua aparecendo, com o nome cru', () => {
  // Lista de EXCLUSÃO, não de inclusão. Campo novo que o Waze passe a mandar
  // aparece feio (nome cru da API), mas aparece — esconder calado uma mudança
  // de verdade é o oposto do que a app existe pra fazer.
  const rd = harEstadio();
  rd.venues.objects[0].venueUpdateRequests[0].changedVenue.campoNovoDoWaze = 'valor';
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['REQUEST'], unreadOnly: true });
  const novo = places[0].changes.find((c) => c.field === 'campoNovoDoWaze');
  assert.ok(novo, 'campo desconhecido sumiu — a lista virou de inclusão');
  assert.equal(novo.label, 'CampoNovoDoWaze');
});

// Fixture do HAR REAL do "Ponto de Mergulho - Barragem do Lago Paranoá"
// (2026-07-28): reporte de FOTO. O card saía em branco — dizia só "Reporte
// (Sinalização)" e o criador — enquanto o WME mostrava "Foto sinalizada",
// "Motivo da marcação: Inapropriado" e destacava QUAL das 4 fotos.
const harMergulho = () => ({
  users: { objects: [{ id: 2271935404, userName: 'world_6yh76rfm' }] },
  streets: { objects: [] }, cities: { objects: [] }, states: { objects: [] },
  venues: {
    objects: [
      {
        id: '204605034.2046181412.2355613',
        name: 'Ponto de Mergulho - Barragem do Lago Paranoá',
        permissions: -1,
        categories: ['BEACH'],
        images: [
          { id: '1e60b14e-4afc-469d-ad06-295157ab424f', approved: true },
          { id: '405416f8-0beb-46da-89dc-17d82ef60a48', approved: true },
          { id: '47abfef8-e412-47a9-b4e6-34e0ce413da8', approved: true },
          { id: '5862d6e7-708a-46a9-a7e6-4ffffac4386f', approved: true },
        ],
        venueUpdateRequests: [
          {
            id: 'fa4413fd-5ea8-4f94-af80-fa36d8fe9103',
            venueID: '204605034.2046181412.2355613',
            type: 'REQUEST',
            subType: 'FLAG',
            flagType: 'INAPPROPRIATE',
            flagSubjectType: 'IMAGE',
            flagComment: '',                 // vazio no HAR real — é o normal
            flagEntityID: '1e60b14e-4afc-469d-ad06-295157ab424f',
            source: 'MOBILE_CLIENT',
            createdBy: 2271935404,
            dateAdded: 1785203731191,
            isRead: false,
          },
        ],
      },
    ],
  },
});

test('buildPlacesFromSearch: reporte leva o MOTIVO, não só o comentário vazio', () => {
  // A app lia só `flagComment` (texto livre), herdado do PHP e nunca conferido
  // contra um reporte real. Ele vem vazio: quem carrega o motivo é o `flagType`.
  const { places } = buildPlacesFromSearch(harMergulho(), { filterTypes: null, unreadOnly: true });
  assert.equal(places.length, 1);
  const p = places[0];
  assert.equal(p.flagComment, null, 'comentário vazio continua virando null');
  assert.equal(p.flagType, 'INAPPROPRIATE', 'sem o motivo o card de reporte fica em branco');
  assert.equal(p.flagSubjectType, 'IMAGE', 'sem isto não dá pra dizer que o reporte é de FOTO');
});

test('buildPlacesFromSearch: o reporte aponta QUAL foto foi denunciada', () => {
  // `flagEntityID` casa com `venue.images[].id` — é o único vínculo. Sem ele o
  // editor vê 4 fotos e nenhuma pista de qual foi reportada.
  const { places } = buildPlacesFromSearch(harMergulho(), { filterTypes: null, unreadOnly: true });
  const p = places[0];
  assert.equal(p.imageUrls.length, 4);
  const idx = p.imageUrls.findIndex((u) => u.includes(p.flagEntityID));
  assert.equal(idx, 0, 'a foto denunciada não é mais localizável pela URL');
});

test('buildPlacesFromSearch: enum de motivo passa CRU (a tradução é do frontend)', () => {
  // js/i18n.js é a fonte única de string de UI, e motivo não mapeado tem que
  // aparecer cru — esconder o motivo de uma denúncia é pior que mostrar em inglês.
  const rd = harMergulho();
  rd.venues.objects[0].venueUpdateRequests[0].flagType = 'ALGUM_MOTIVO_NOVO';
  const { places } = buildPlacesFromSearch(rd, { filterTypes: null, unreadOnly: true });
  assert.equal(places[0].flagType, 'ALGUM_MOTIVO_NOVO', 'o core traduziu ou filtrou o enum');
});

test('buildPlacesFromSearch: o core não escreve texto de interface', () => {
  // js/i18n.js é a fonte única de string de UI, nas TRÊS línguas — e a auditoria
  // test/i18n.test.mjs não alcança string que chega pela REDE. Resultado medido
  // antes desta correção: um editor em inglês lia "Nome: (vazio) → Novo Nome" e
  // "Novo Local" no meio de uma interface traduzida.
  const rd = harEstadio();
  const ur = rd.venues.objects[0].venueUpdateRequests[0];
  ur.changedVenue = { name: null, residential: true, categories: ['A'] };
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['REQUEST'], unreadOnly: true });
  const p = places[0];
  const porCampo = Object.fromEntries(p.changes.map((c) => [c.field, c]));

  // Valores especiais viram TIPO, não palavra: o frontend decide a língua.
  // (`from` = valor ATUAL do venue; `to` = o que o usuário propôs.)
  assert.equal(porCampo.name.to, null, 'valor vazio proposto virou texto de novo');
  assert.equal(porCampo.residential.from, null, 'campo ausente no venue devia virar null');
  assert.equal(porCampo.residential.to, true, 'boolean virou "Sim"/"Não" no servidor');

  // O tipo vai por CHAVE; a string pt continua só como último recurso.
  assert.equal(p.updateTypeKey, 'UPDATE', 'sumiu a chave do tipo de pedido');

  // Nenhum valor do diff pode ser uma palavra de UI em português.
  const UI_PT = /^\((vazio|sem nome)\)$|^(Sim|Não|Desconhecido|Sem nome)$/;
  for (const c of p.changes) {
    for (const v of [c.from, c.to]) {
      assert.ok(typeof v !== 'string' || !UI_PT.test(v), `valor de UI em português no core: "${v}"`);
    }
  }
});

test('buildPlacesFromSearch: nome ausente também é decisão do frontend', () => {
  const rd = harEstadio();
  delete rd.venues.objects[0].name;
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['REQUEST'], unreadOnly: true });
  assert.equal(places[0].name, null, 'o core voltou a escrever "Sem nome"');
});

test('buildPlacesFromSearch: cada tipo de pedido tem sua chave', () => {
  const casos = [
    [{ type: 'VENUE' }, 'VENUE'],
    [{ type: 'IMAGE' }, 'IMAGE'],
    [{ type: 'REQUEST', subType: 'FLAG' }, 'FLAG'],
    [{ type: 'REQUEST', subType: 'DELETE' }, 'DELETE'],
    [{ type: 'REQUEST', subType: 'UPDATE' }, 'UPDATE_DETAILS'],
    [{ type: 'OUTRA_COISA' }, 'UNKNOWN'],
  ];
  for (const [forma, esperado] of casos) {
    const rd = harEstadio();
    const ur = rd.venues.objects[0].venueUpdateRequests[0];
    Object.assign(ur, { subType: undefined }, forma);
    delete ur.changedVenue;
    const { places } = buildPlacesFromSearch(rd, { filterTypes: null, unreadOnly: true });
    assert.equal(places[0].updateTypeKey, esperado, `${JSON.stringify(forma)} devia dar ${esperado}`);
  }
});

test('buildPlacesFromSearch: venue sem permissão de edição é descartado inteiro', () => {
  const rd = harBatalhao();
  rd.venues.objects[0].permissions = 0;
  rd.venues.objects[0].venueUpdateRequests.forEach((ur) => { ur.isRead = false; });
  const { places } = buildPlacesFromSearch(rd, { filterTypes: null, unreadOnly: true });
  assert.equal(places.length, 0);
});

// ─── D13: contagem de PURs bloqueados por permissão (contador "de N na região")
test('buildPlacesFromSearch: conta em `blocked` os PURs de venue não-editável', () => {
  const rd = harBatalhao();
  rd.venues.objects[0].permissions = 0; // sem permissão
  rd.venues.objects[0].venueUpdateRequests.forEach((ur) => { ur.isRead = false; });
  const { places, blocked } = buildPlacesFromSearch(rd, { filterTypes: null, unreadOnly: true });
  assert.equal(places.length, 0, 'não emite card pra venue sem permissão');
  assert.equal(blocked, 2, 'mas contabiliza os 2 PURs pendentes dele');
});

test('buildPlacesFromSearch: `blocked` respeita os MESMOS filtros de tipo e leitura', () => {
  const rd = harBatalhao();
  rd.venues.objects[0].permissions = 0;
  // 1 IMAGE já lida + 1 REQUEST não-lido (estado original da fixture)
  const soImagem = buildPlacesFromSearch(rd, { filterTypes: ['IMAGE'], unreadOnly: true });
  assert.equal(soImagem.blocked, 0, 'a única IMAGE está lida → não conta');
  const incluindoLidos = buildPlacesFromSearch(rd, { filterTypes: ['IMAGE'], unreadOnly: false });
  assert.equal(incluindoLidos.blocked, 1, 'com lidos incluídos, a IMAGE entra na conta');
  const soRequest = buildPlacesFromSearch(rd, { filterTypes: ['REQUEST'], unreadOnly: true });
  assert.equal(soRequest.blocked, 1, 'o REQUEST não-lido conta');
});

test('buildPlacesFromSearch: venue editável não gera `blocked`', () => {
  const { places, blocked } = buildPlacesFromSearch(harBatalhao(), { filterTypes: ['REQUEST'], unreadOnly: true });
  assert.equal(places.length, 1);
  assert.equal(blocked, 0);
});

// Regressão do "[object Object]" — achado num pedido REAL (AmBev, Manaus), não
// numa fixture: 33 de 142 pedidos da fila do owner tinham mudança de geometria e
// TODOS apareciam como "[object Object] → [object Object]" na tela, em qualquer
// idioma. `formatValue` tratava null, boolean e array; objeto simples caía no
// String(value), e o `geometry` do Waze é GeoJSON — objeto.
test('geometria vira coordenada legível, e polígono alterado nunca formata igual', async () => {
  const { formatGeometry } = await import('../server/core.mjs');

  // Point: a coordenada É a geometria inteira. lat, lon (ordem de mapa), 6 casas.
  assert.equal(formatGeometry({ type: 'Point', coordinates: [-60.0267, -3.0757] }),
    '-3.075700, -60.026700');

  // Polígono com o MESMO primeiro vértice e um vértice A MAIS: é o caso real que
  // mostrou por que a contagem precisa aparecer. Sem ela, os dois formatariam
  // idêntico e a tela afirmaria que nada mudou — pior que ser feio.
  const antes = { type: 'Polygon', coordinates: [[[-60.0267, -3.0757], [-60.0268, -3.0758], [-60.0269, -3.0759]]] };
  const depois = { type: 'Polygon', coordinates: [[[-60.0267, -3.0757], [-60.0268, -3.0758], [-60.0269, -3.0759], [-60.027, -3.076]]] };
  assert.notEqual(formatGeometry(antes), formatGeometry(depois),
    'polígono que mudou formatou igual ao anterior — a tela mentiria dizendo que nada mudou');
  assert.match(formatGeometry(antes), /3 pts$/);
  assert.match(formatGeometry(depois), /4 pts$/);

  // MultiPolygon (o Waze manda) e lixo não derrubam.
  assert.match(formatGeometry({ type: 'MultiPolygon', coordinates: [[[[-60.1, -3.2], [-60.2, -3.3]]]] }),
    /^-3\.200000, -60\.100000 · 2 pts$/);
  for (const ruim of [null, undefined, {}, { type: 'Point' }, { coordinates: [] }, 'texto', 42]) {
    assert.equal(formatGeometry(ruim), null, `formatGeometry(${JSON.stringify(ruim)}) devia dar null`);
  }
});

// A distância de uma mudança de geometria mede do CENTRÓIDE, não do primeiro
// vértice. Medido no dado real: o polígono da AmBev ganhou um vértice sem mexer
// no primeiro, e pelo primeiro vértice a distância dava ZERO — o card dizia
// "moveu 0 m" sobre uma forma que mudou. Afirmar que nada aconteceu é pior que
// ser vago. Trocar pelo centróide corrigiu 11 dos 12 falsos zeros da fila.
test('distância de geometria usa centróide, não o primeiro vértice', async () => {
  const { distanciaEntreGeometrias } = await import('../server/core.mjs');

  // Mesmo primeiro vértice, vértice extra deslocado: pelo primeiro ponto daria
  // 0; pelo centróide dá distância real. É o caso AmBev.
  const antes = { type: 'Polygon', coordinates: [[[-60.02, -3.07], [-60.02, -3.08], [-60.03, -3.08]]] };
  const depois = { type: 'Polygon', coordinates: [[[-60.02, -3.07], [-60.02, -3.08], [-60.03, -3.08], [-60.05, -3.10]]] };
  const d = distanciaEntreGeometrias(antes, depois);
  assert.ok(d > 100, `centróide devia se mover >100m, deu ${d}`);

  // Point simples: a distância é a do ponto, e bate com o esperado por grau.
  const p1 = { type: 'Point', coordinates: [-60.0, -3.0] };
  const p2 = { type: 'Point', coordinates: [-60.0, -3.001] };
  const dp = distanciaEntreGeometrias(p1, p2);
  assert.ok(dp > 100 && dp < 120, `0,001° de latitude ≈ 111m, deu ${dp}`);

  // Idêntico = zero, e lixo = null (nunca NaN chegando na tela).
  assert.equal(distanciaEntreGeometrias(p1, p1), 0);
  for (const ruim of [null, undefined, {}, 'x', 42]) {
    assert.equal(distanciaEntreGeometrias(ruim, p1), null, `entrada ${JSON.stringify(ruim)} devia dar null`);
  }
});

// Campo de lista mostra o que ENTROU e o que SAIU. Mostrar as duas listas
// inteiras obrigava o editor a comparar de olho — no dado real `services` troca
// 1 item entre 5 e `categories` ganha 1 entre 2.
test('diffDeLista devolve só a diferença, com valores crus', async () => {
  const { diffDeLista } = await import('../server/core.mjs');

  const d = diffDeLista(['A', 'B', 'C'], ['A', 'C', 'D']);
  assert.deepEqual(d, { add: ['D'], del: ['B'] });

  // Sem diferença → null, pra não render uma linha vazia.
  assert.equal(diffDeLista(['A'], ['A']), null);
  // Ordem não é mudança: reordenar não deve virar +/−.
  assert.equal(diffDeLista(['A', 'B'], ['B', 'A']), null);
  // Campo que NASCE (null → lista) é diff também: tudo adição. Antes devolvia
  // null aqui, e o par caía no formatValue — que serializa objeto em JSON e
  // mandava `{"days":[0,1,...],"fromHour":"00:00"}` pra tela. Medido na fila
  // real: openingHours e entryExitPoints costumam vir de nada.
  assert.deepEqual(diffDeLista(null, ['A']), { add: ['A'], del: [] });
  assert.deepEqual(diffDeLista(['A'], null), { add: [], del: ['A'] });
  // Mas null dos DOIS lados não é mudança, e não-array de verdade segue null.
  assert.equal(diffDeLista(null, null), null);
  assert.equal(diffDeLista(['A'], 'texto'), null);
  assert.equal(diffDeLista('texto', ['A']), null);

  // Objeto na lista (entryExitPoints) compara por conteúdo, não por referência.
  const pa = { name: '', entry: true };
  assert.equal(diffDeLista([pa], [{ name: '', entry: true }]), null);
  // Os valores voltam CRUS: quem traduz é o frontend (contrato de i18n).
  assert.deepEqual(diffDeLista([], ['AIR_CONDITIONING']), { add: ['AIR_CONDITIONING'], del: [] });
});

test('mesmoValor compara valor CRU e é o que decide esconder a linha repetida', async () => {
  const { mesmoValor } = await import('../server/core.mjs');

  // `ur.changedVenue` não é um diff: é o local inteiro, então campo que ninguém
  // tocou vem junto com o valor ATUAL e virava linha "mudou: X → X". Medido na
  // fila real: `BR-060 → BR-060`, `Brickell Avenue → Brickell Avenue`, e um
  // entryExitPoints que ainda por cima vazava JSON cru.
  assert.equal(mesmoValor('BR-060', 'BR-060'), true);
  assert.equal(mesmoValor(null, null), true);
  assert.equal(mesmoValor(null, undefined), false, 'null e undefined não são o mesmo dado');
  assert.equal(mesmoValor(0, ''), false, 'nada de coerção: 0 não é string vazia');
  assert.equal(mesmoValor(1, '1'), false);

  // Ordem de chave NÃO pode decidir: dois objetos iguais montados em ordens
  // diferentes são o mesmo valor. JSON.stringify erraria aqui e traria a linha
  // inútil de volta — é por isso que a comparação é profunda de verdade.
  assert.equal(mesmoValor({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(mesmoValor({ a: 1 }, { a: 1, b: undefined }), false, 'chave a mais é diferença');

  // Lista compara por conteúdo E por ordem (reordenar geometria é mudança).
  assert.equal(mesmoValor([1, 2], [1, 2]), true);
  assert.equal(mesmoValor([1, 2], [2, 1]), false);
  assert.equal(mesmoValor([1, 2], [1, 2, 3]), false);
  assert.equal(mesmoValor({ x: [1, { y: 'z' }] }, { x: [1, { y: 'z' }] }), true);

  // Array × objeto nunca são o mesmo valor, mesmo com as mesmas "chaves".
  assert.equal(mesmoValor([], {}), false);

  // O caso que PROVA por que a comparação é do valor cru e não do texto: dois
  // polígonos que o `formatGeometry` imprime IGUAL (mesmo primeiro vértice,
  // mesma contagem) mas que são formas diferentes — medido na fila real, um
  // deles andou 84 metros. Comparar o que aparece na tela apagaria a linha.
  const polyA = { type: 'Polygon', coordinates: [[[-46.1, -23.8], [-46.2, -23.9], [-46.1, -23.8]]] };
  const polyB = { type: 'Polygon', coordinates: [[[-46.1, -23.8], [-46.7, -23.4], [-46.1, -23.8]]] };
  assert.equal(mesmoValor(polyA, polyB), false, 'forma diferente NUNCA pode ser tratada como igual');
  assert.equal(mesmoValor(polyA, JSON.parse(JSON.stringify(polyA))), true);
});

test('diffDeObjeto mostra só a folha que mudou, em vez do JSON inteiro', async () => {
  const { diffDeObjeto } = await import('../server/core.mjs');

  // `categoryAttributes` de um eletroposto: o card mostrava o objeto inteiro em
  // JSON pra dizer que a rede mudou de nome. Medido na fila real.
  const antes = { PARKING_LOT: null, CHARGING_STATION: { source: 'ECO_MOVEMENT', network: 'Porsche' } };
  const depois = { PARKING_LOT: null, CHARGING_STATION: { source: 'WME', network: 'Ponto de Carga' } };
  const d = diffDeObjeto(antes, depois);
  assert.equal(d.length, 2, 'só as folhas que mudaram');
  assert.deepEqual(d.map((l) => l.caminho).sort(),
    ['CHARGING_STATION.network', 'CHARGING_STATION.source']);
  assert.deepEqual(d.find((l) => l.caminho.endsWith('.source')), 
    { caminho: 'CHARGING_STATION.source', de: 'ECO_MOVEMENT', para: 'WME' });

  // Sem diferença → null, pra não render linha vazia.
  assert.equal(diffDeObjeto(antes, JSON.parse(JSON.stringify(antes))), null);
  // Só vale pra objeto SIMPLES: lista tem o diffDeLista, e escalar tem from/to.
  assert.equal(diffDeObjeto(['a'], ['b']), null);
  assert.equal(diffDeObjeto('a', 'b'), null);
  assert.equal(diffDeObjeto(null, { a: 1 }), null);

  // Objeto grande devolve null de propósito: isto alimenta um card de celular,
  // e uma lista enorme afogaria o que interessa. Melhor cair no fallback.
  const grande = {}; const grande2 = {};
  for (let i = 0; i < 40; i++) { grande['k' + i] = i; grande2['k' + i] = i + 1; }
  assert.equal(diffDeObjeto(grande, grande2), null, 'objeto grande cai no fallback');
});
