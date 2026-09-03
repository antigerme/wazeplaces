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
  cookieValePraHost,
  prepareAuth,
  buildPlacesFromSearch,
  dispatch,
  purTypeDoUR,
  PUR_TIPOS,
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

// ── beta.waze.com é OUTRO AMBIENTE ─────────────────────────────────────────
// Achado com os cookies do owner, que tinha as duas sessões no mesmo export.
// MEDIDO contra `Issues/Search/List` (só leitura): tudo → 403 · só beta → 403 ·
// só www → 200 com 500 pedidos. E o login PASSAVA, porque `/Session` é tolerante
// — então a app dizia "Cookies válidos!" e tudo depois morria com "expirados".
test('cookie de beta.waze.com NUNCA entra: é outro ambiente, com sessão própria', () => {
  const raw = [
    NETSCAPE('beta.waze.com', '_csrf_token', 'CSRF-DO-BETA'),
    NETSCAPE('beta.waze.com', '_web_session', 'SESSAO-DO-BETA'),
    NETSCAPE('www.waze.com', '_csrf_token', 'CSRF-DO-WWW'),
    NETSCAPE('www.waze.com', '_web_session', 'SESSAO-DO-WWW'),
  ].join('\n');
  const f = filterWazeCookies(raw);
  assert.ok(!f.includes('BETA'), 'cookie do beta vazou pro conjunto que vai ao www');
  assert.ok(f.includes('CSRF-DO-WWW') && f.includes('SESSAO-DO-WWW'), 'o do www tem que ficar');
  // O `extractCSRFToken` pega o PRIMEIRO que acha, e no export do owner o do
  // beta vinha ANTES. É por isso que o conserto mora no filtro, e não nele.
  assert.equal(extractCSRFToken(f), 'CSRF-DO-WWW');
  assert.ok(!cookieHeaderFrom(raw).includes('BETA'), 'a defesa em profundidade tem que ter a MESMA régua');
});

test('cookieValePraHost: é a regra do RFC 6265 contra www.waze.com, não "contém waze"', () => {
  for (const d of ['waze.com', '.waze.com', 'www.waze.com', '.www.waze.com']) {
    assert.equal(cookieValePraHost(d), true, `${d} deveria valer pro www`);
  }
  for (const d of ['beta.waze.com', 'editor.waze.com', '.beta.waze.com', 'waze.com.br', 'evilwaze.com',
    // Estes dois separam a regra do RFC de um `endsWith` cru, e sem eles a
    // asserção é decoração: `'www.waze.com'.endsWith('aze.com')` é TRUE, e um
    // `aze.com` registrável mandaria o cookie dele junto pro Waze. A regra real
    // exige a fronteira de ponto (`.aze.com`), que não casa.
    'aze.com', 'w.waze.com']) {
    assert.equal(cookieValePraHost(d), false, `${d} NÃO deveria valer pro www`);
  }
  // `isWazeCookieDomain` segue existindo e segue LARGO — são perguntas
  // diferentes ("é da waze?" × "o navegador mandaria isto pro www?").
  assert.equal(isWazeCookieDomain('beta.waze.com'), true);
});

// O filtro por host é ENDURECIMENTO, nunca PORTÃO — e a diferença virou defeito
// em produção no MESMO dia em que ele entrou. O owner recebeu "Formato de
// cookies inválido" no meio do trabalho, com 0 RESTAM na tela.
//
// A causa: o filtro nasceu no `handleTestarCookies`, onde recusar entrada ruim é
// certo (a pessoa está ali colando o arquivo e pode corrigir). Ao ir pro
// `prepareAuth` ele passou a rodar sobre SESSÃO JÁ GRAVADA — dado que já existe
// no mundo, em formato que ninguém pode re-pedir.
test('sessão já gravada NUNCA é recusada por FORMATO — o filtro recua, não barra', () => {
  const N = (d, n, v) => [d, 'TRUE', '/', 'TRUE', '1799999999', n, v].join('\t');
  // As três formas que o teste diferencial (antes × depois) pegou regredindo.
  const casos = {
    'só beta.waze.com': [N('beta.waze.com', '_csrf_token', 'a'), N('beta.waze.com', '_web_session', 'b')].join('\n'),
    'header com tab no meio': '_csrf_token=a;\t_web_session=b',
    'domínio editor.waze.com': [N('editor.waze.com', '_csrf_token', 'a'), N('editor.waze.com', '_web_session', 'b')].join('\n'),
  };
  for (const [nome, cru] of Object.entries(casos)) {
    // Chama o `prepareAuth` DE VERDADE. A primeira versão desta asserção
    // replicava o recuo aqui dentro, e a sabotagem que devolvia o filtro a
    // PORTÃO passou limpa — asserção que não distingue as duas versões é
    // decoração, não teste.
    let r;
    assert.doesNotThrow(() => { r = prepareAuth(cru); },
      `${nome}: sessão já gravada foi recusada por FORMATO`);
    assert.ok(r.csrf, `${nome}: CSRF sumiu`);
    // E o header não pode sair VAZIO: header vazio não dá erro nenhum, o Waze é
    // que responde 403 e a culpa parece ser dos cookies da pessoa.
    assert.notEqual(r.cookieHeader, '', `${nome}: header saiu vazio`);
  }
});

test('o recuo do header é pra régua LARGA, e ela ainda é só waze.com', () => {
  const N = (d, n, v) => [d, 'TRUE', '/', 'TRUE', '1799999999', n, v].join('\t');
  // Sem nenhum cookie que sirva ao www, recua pro que é da waze — e NUNCA pro
  // que é de terceiro, que é a razão de o filtro existir (não vazar credencial
  // alheia pro servidor do Waze).
  const h = cookieHeaderFrom([
    N('beta.waze.com', '_csrf_token', 'DA-WAZE'),
    N('.redhat.com', 'sso', 'SEGREDO-RH'),
    N('.github.com', 'gh', 'SEGREDO-GH'),
  ].join('\n'));
  assert.ok(h.includes('DA-WAZE'), 'o recuo tem que devolver o cookie da waze');
  assert.ok(!h.includes('SEGREDO-RH') && !h.includes('SEGREDO-GH'),
    'o recuo NÃO pode afrouxar pra cookie de terceiro');

  // E com cookie do www presente, o recuo não acontece: o beta fica de fora.
  const misto = cookieHeaderFrom([
    N('beta.waze.com', '_csrf_token', 'CSRF-BETA'),
    N('www.waze.com', '_csrf_token', 'CSRF-WWW'),
  ].join('\n'));
  assert.ok(misto.includes('CSRF-WWW') && !misto.includes('BETA'),
    'com o www presente o beta não pode entrar — é o conserto que este recuo não pode desfazer');
});

test('filterWazeCookies: export duplicado não dobra o header', () => {
  // O arquivo do owner trazia cada cookie 2×. Dedup por (domínio, nome).
  const uma = NETSCAPE('www.waze.com', '_web_session', 'v1');
  assert.equal(filterWazeCookies([uma, uma].join('\n')).split('\n').length, 1);
  // Mas nomes iguais em domínios DIFERENTES são dois cookies de verdade, e o
  // navegador manda os dois — dedup por nome só apagaria um deles.
  const dois = filterWazeCookies([
    NETSCAPE('.waze.com', '_t', 'do-ponto'),
    NETSCAPE('www.waze.com', '_t', 'do-www'),
  ].join('\n'));
  assert.equal(dois.split('\n').length, 2);
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

test('buildPlacesFromSearch: a data de cada foto sai por ID, e o campo é `date`', () => {
  // O campo se chama `date` na resposta do Search/List — o SDK do Waze declara
  // `creationDate` em VenueImage, e ir pela tipagem daria `undefined` em tudo.
  // Não é caso isolado: o SDK também diz `isApproved` onde a resposta usa
  // `approved` (o `approvedImageIds` já dependia disso). MEDIDO nos 6 países
  // obrigatórios: 3176 de 3176 fotos trazem `date`.
  //
  // Por ID e não por índice porque o carrossel reordena e o frontend remove a
  // foto excluída da lista — posição não identifica foto nenhuma.
  const har = harBatalhao();
  har.venues.objects[0].images = [
    { id: 'img-velha', approved: true, date: 1400000000000 },
    { id: 'img-nova', approved: true, date: 1780000000000 },
    { id: 'img-sem-data', approved: true },
    { id: 'img-data-zero', approved: true, date: 0 },
    { id: 'img-data-lixo', approved: true, date: 'ontem' },
  ];
  const { places } = buildPlacesFromSearch(har, { unreadOnly: false });
  const p = places[0];
  assert.ok(p, 'sumiu o card');
  assert.deepEqual(p.imageDates, { 'img-velha': 1400000000000, 'img-nova': 1780000000000 },
    'só as fotos com data válida entram, e a chave é o ID');
  // A URL carrega o id, que é como o frontend acha a data da foto aberta.
  const url = p.imageUrls.find((u) => u.includes('img-velha'));
  assert.ok(url, 'a URL da foto não carrega o id — o frontend não acha a data');
  assert.equal(p.imageDates[Object.keys(p.imageDates).find((k) => url.includes(k))], 1400000000000);
});

test('buildPlacesFromSearch: PUR já lido NÃO vira card com unreadOnly (bug do "place volta")', () => {
  // Cenário exato do HAR: user marcou a foto como lida, venue volta na busca
  // por causa do REQUEST irmão. Antes do fix: 1 card (a foto lida, de novo).
  const { places } = buildPlacesFromSearch(harBatalhao(), { filterTypes: ['NEW_PLACE', 'NEW_PHOTO'], unreadOnly: true });
  assert.equal(places.length, 0, 'foto já lida não pode voltar como card');
});

test('buildPlacesFromSearch: unreadOnly=false inclui PURs lidos (modo "incluir lidos")', () => {
  const { places } = buildPlacesFromSearch(harBatalhao(), { filterTypes: ['NEW_PLACE', 'NEW_PHOTO'], unreadOnly: false });
  assert.equal(places.length, 1);
  assert.equal(places[0].updateRequestID, '5dd54258-1bfe-4739-8b72-db4c418b1e79');
  assert.equal(places[0].reqType, 'IMAGE');
});

test('buildPlacesFromSearch: PUR não-lido vira card normalmente', () => {
  const rd = harBatalhao();
  rd.venues.objects[0].venueUpdateRequests[1].isRead = false;
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['NEW_PLACE', 'NEW_PHOTO'], unreadOnly: true });
  assert.equal(places.length, 1);
  assert.equal(places[0].updateRequestID, '5dd54258-1bfe-4739-8b72-db4c418b1e79');
});

test('buildPlacesFromSearch: isRead ausente entra na fila (defensivo, como permissions)', () => {
  const rd = harBatalhao();
  delete rd.venues.objects[0].venueUpdateRequests[1].isRead;
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['NEW_PLACE', 'NEW_PHOTO'], unreadOnly: true });
  assert.equal(places.length, 1);
});

test('buildPlacesFromSearch: REQUEST/UPDATE não-lido vira card quando o tipo é pedido (dev mode)', () => {
  const { places } = buildPlacesFromSearch(harBatalhao(), { filterTypes: ['DETAILS_UPDATE', 'FLAGGED_PLACE', 'DELETE_PLACE', 'FLAGGED_PHOTO', 'DELETE_PHOTO'], unreadOnly: true });
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
  const { places } = buildPlacesFromSearch(harEstadio(), { filterTypes: ['DETAILS_UPDATE', 'FLAGGED_PLACE', 'DELETE_PLACE', 'FLAGGED_PHOTO', 'DELETE_PHOTO'], unreadOnly: true });
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
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['DETAILS_UPDATE', 'FLAGGED_PLACE', 'DELETE_PLACE', 'FLAGGED_PHOTO', 'DELETE_PHOTO'], unreadOnly: true });
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
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['DETAILS_UPDATE', 'FLAGGED_PLACE', 'DELETE_PLACE', 'FLAGGED_PHOTO', 'DELETE_PHOTO'], unreadOnly: true });
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
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['DETAILS_UPDATE', 'FLAGGED_PLACE', 'DELETE_PLACE', 'FLAGGED_PHOTO', 'DELETE_PHOTO'], unreadOnly: true });
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
  const soImagem = buildPlacesFromSearch(rd, { filterTypes: ['NEW_PHOTO'], unreadOnly: true });
  assert.equal(soImagem.blocked, 0, 'a única IMAGE está lida → não conta');
  const incluindoLidos = buildPlacesFromSearch(rd, { filterTypes: ['NEW_PHOTO'], unreadOnly: false });
  assert.equal(incluindoLidos.blocked, 1, 'com lidos incluídos, a IMAGE entra na conta');
  const soRequest = buildPlacesFromSearch(rd, { filterTypes: ['DETAILS_UPDATE', 'FLAGGED_PLACE', 'DELETE_PLACE', 'FLAGGED_PHOTO', 'DELETE_PHOTO'], unreadOnly: true });
  assert.equal(soRequest.blocked, 1, 'o REQUEST não-lido conta');
});

test('buildPlacesFromSearch: venue editável não gera `blocked`', () => {
  const { places, blocked } = buildPlacesFromSearch(harBatalhao(), { filterTypes: ['DETAILS_UPDATE', 'FLAGGED_PLACE', 'DELETE_PLACE', 'FLAGGED_PHOTO', 'DELETE_PHOTO'], unreadOnly: true });
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

test('folha de objeto que é lista vira delta, não dois blocos de JSON', async () => {
  const { diffDeObjeto } = await import('../server/core.mjs');

  // `chargingPorts` de um eletroposto: dois blocos de JSON lado a lado, 152
  // caracteres, e ninguém lia. Vira o mesmo +/− do campo de lista de topo.
  const a = { CHARGING_STATION: { ports: [{ portId: '1', kw: 11 }, { portId: '2', kw: 11 }] } };
  const b = { CHARGING_STATION: { ports: [{ portId: 'TYPE2.11', kw: 11 }] } };
  const d = diffDeObjeto(a, b);
  assert.equal(d.length, 1);
  const folha = d[0];
  assert.equal(folha.caminho, 'CHARGING_STATION.ports');
  assert.ok(folha.delta, 'folha que é lista precisa vir com delta');
  assert.deepEqual(folha.delta.add, [{ portId: 'TYPE2.11', kw: 11 }]);
  assert.equal(folha.delta.del.length, 2);
  // Os valores CRUS continuam lá: o delta é adicional, não substitui — quem
  // não souber renderizar delta ainda tem de/para (feio, nunca invisível).
  assert.ok(Array.isArray(folha.de) && Array.isArray(folha.para));

  // Folha escalar segue sem delta: +/− num par de strings seria ruído.
  const e = diffDeObjeto({ x: { n: 'a' } }, { x: { n: 'b' } });
  assert.equal(e[0].delta, undefined);
  assert.deepEqual([e[0].de, e[0].para], ['a', 'b']);
});

test('a sessão é janela DESLIZANTE: usar a app renova o prazo', async () => {
  const { makeSessions, SESSION_TTL, SESSION_REFRESH_AFTER } = await import('../server/core.mjs');

  // O adaptador de arquivo da VM sempre renovou (mtime + touch). O KV do
  // Cloudflare NÃO: `expirationTtl` conta do `put` e o `get` não estende nada.
  // Medido com este mesmo simulador antes da correção: editor usando a app
  // TODO DIA era deslogado no dia 21, com ZERO escritas no KV no período.
  const DIA = 86400;
  const T0 = 1785000000;
  let agora = T0;
  const relogio = Date.now;
  Date.now = () => agora * 1000;

  try {
    const kv = new Map();
    let escritas = 0;
    const store = {
      get: (h) => {
        const e = kv.get(h);
        if (!e) return null;
        if (agora >= e.gravadoEm + e.ttl) { kv.delete(h); return null; }  // KV expira sozinho
        return e.blob;
      },
      put: (h, blob, ttl) => { escritas++; kv.set(h, { blob, gravadoEm: agora, ttl: ttl || SESSION_TTL }); },
      delete: (h) => kv.delete(h),
    };
    const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
    const token = await sessions.createSession('_web_session=a; _csrf_token=b');

    // Uso diário por muito mais que o TTL: tem que continuar viva.
    for (let dia = 1; dia <= 90; dia++) {
      agora = T0 + dia * DIA;
      assert.ok(await sessions.loadSession(token), `sessão morreu no dia ${dia} com uso diário`);
    }

    // Rajada no MESMO dia não pode virar uma escrita por leitura: o KV aceita
    // 1 escrita/s por chave, e a app faz 3 chamadas só ao abrir. Trocar o
    // logout por estouro de limite de escrita seria trocar de defeito.
    const antes = escritas;
    for (let i = 0; i < 30; i++) { agora += 1; await sessions.loadSession(token); }
    assert.equal(escritas, antes, 'rajada no mesmo dia gerou escrita a cada leitura');
    assert.ok(SESSION_REFRESH_AFTER >= 3600, 'granularidade de renovação curta demais pro limite do KV');

    // Sumir por MAIS que o TTL ainda expira — a janela desliza, não é eterna.
    agora += SESSION_TTL + DIA;
    assert.equal(await sessions.loadSession(token), null, 'sessão sobreviveu além do TTL sem uso');
  } finally {
    Date.now = relogio;
  }
});

test('valor de sessão SEM carimbo é rejeitado, não adivinhado', async () => {
  const { makeSessions } = await import('../server/core.mjs');

  // Formato único: `carimbo|blob`. Havia compatibilidade pro formato antigo
  // (blob puro) enquanto se supunha sessão em produção pra preservar — o owner
  // confirmou que a app está em dev/testes, então saiu. Aceitar as duas formas
  // faria a renovação de prazo depender de adivinhação: sem carimbo não dá pra
  // saber quando a sessão foi escrita.
  const kv = new Map();
  const store = { get: (h) => kv.get(h) ?? null, put: (h, v) => kv.set(h, v), delete: (h) => kv.delete(h) };
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });

  const cookies = '_web_session=x; _csrf_token=y';
  const token = await sessions.createSession(cookies);
  const [hash] = [...kv.keys()];
  const comCarimbo = kv.get(hash);
  const sep = comCarimbo.indexOf('|');
  assert.ok(sep > 0, 'createSession parou de gravar o carimbo');
  assert.equal(await sessions.loadSession(token), cookies);

  // Rebaixado pro formato antigo → some, em vez de valer com prazo inventado.
  kv.set(hash, comCarimbo.slice(sep + 1));
  assert.equal(await sessions.loadSession(token), null, 'valor sem carimbo foi aceito');

  // Carimbo que não é número também não passa.
  kv.set(hash, 'abc|' + comCarimbo.slice(sep + 1));
  assert.equal(await sessions.loadSession(token), null, 'carimbo não-numérico foi aceito');
});

test('cookie rotacionado pelo Waze é aplicado por cima do guardado', async () => {
  const { aplicarCookiesRotacionados } = await import('../server/core.mjs');

  // MEDIDO com cookies reais: o Waze devolve `Set-Cookie: _web_session=…` em
  // TODA resposta, com valor novo a cada vez (3 chamadas → 3 valores). O
  // `_csrf_token` volta igual. Guardar o retrato do login e nunca atualizá-lo
  // fazia o retrato azedar sozinho — o "expira sem eu ter pedido pra sair".
  const netscape = [
    '# Netscape HTTP Cookie File',
    '.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tVALOR_ANTIGO',
    '.waze.com\tTRUE\t/\tTRUE\t0\t_csrf_token\tCSRF1',
  ].join('\n');

  const novo = aplicarCookiesRotacionados(netscape, [
    '_web_session=VALOR_NOVO; path=/; HttpOnly; Expires=Wed, 01 Jan 2027 00:00:00 GMT',
    '_csrf_token=CSRF1; path=/',
  ]);
  assert.ok(novo, 'não detectou a rotação');
  assert.match(novo, /_web_session\tVALOR_NOVO/, 'não aplicou o valor novo');
  assert.match(novo, /_csrf_token\tCSRF1/, 'perdeu o csrf');
  assert.doesNotMatch(novo, /VALOR_ANTIGO/, 'ficou com o valor velho');

  // Nada mudou → null, pra não reescrever a sessão à toa (o KV aceita 1
  // escrita/s por chave e há uma chamada ao Waze por swipe).
  assert.equal(aplicarCookiesRotacionados(netscape, ['_csrf_token=CSRF1; path=/']), null);
  assert.equal(aplicarCookiesRotacionados(netscape, []), null);
  assert.equal(aplicarCookiesRotacionados(netscape, null), null);

  // Cookie que NÃO estava guardado não entra: o Waze manda Set-Cookie de coisa
  // que não interessa, e engordar o header a cada chamada levaria ao HTTP 400
  // por header gigante que o filterWazeCookies já evita.
  const comIntruso = aplicarCookiesRotacionados(netscape, ['_web_session=X', 'analytics_bobagem=Y']);
  assert.doesNotMatch(comIntruso, /analytics_bobagem/, 'cookie de terceiro entrou na sessão');

  // Valor com vírgula (Expires) não pode ser cortado no meio.
  const comVirgula = aplicarCookiesRotacionados(netscape, ['_web_session=a,b,c; Expires=Wed, 01 Jan 2027 00:00:00 GMT']);
  assert.match(comVirgula, /_web_session\ta,b,c/, 'o valor foi cortado na vírgula');
});

test('o prazo da sessão do Waze é FIXO, e é ele que a app conta', async () => {
  const { prazoDaSessaoWaze } = await import('../server/core.mjs');

  // Cabeçalho REAL, copiado das 3 chamadas de leitura que mediram a questão que
  // decide se a contagem regressiva pode existir: o VALOR do `_web_session`
  // mudou nas três (o Waze rotaciona a cada resposta, gotcha #43) e o `Expires`
  // ficou PARADO, com o `Max-Age` só decrescendo — 2622757 → 2622754 → 2622751,
  // exatamente os segundos passados. Prazo fixo, então contar é dizer a verdade.
  //
  // Se um dia o Waze passar a DESLIZAR o prazo, este teste é onde se percebe:
  // as três chamadas passariam a devolver o mesmo `Max-Age` e um `Expires`
  // andando pra frente — e aí o aviso da app vira mentira e tem que sair.
  const ROTACOES = [2622757, 2622754, 2622751].map((maxAge) => ([
    `_web_session=VALOR${maxAge}; Path=/; Expires=Tue, 15-Sep-2026 02:04:14 GMT; Max-Age=${maxAge}; Secure; HttpOnly`,
    `_csrf_token=CSRF; Path=/; Expires=Tue, 15-Sep-2026 02:04:14 GMT; Max-Age=${maxAge}; Secure`,
  ]));
  const T0 = Date.parse('2026-08-15T17:30:00Z');
  const prazos = ROTACOES.map((sc, i) => prazoDaSessaoWaze(sc, T0 + i * 3000));
  assert.deepEqual(prazos, [prazos[0], prazos[0], prazos[0]],
    'o prazo ANDOU entre rotações — se o Waze passou a deslizar, a contagem na tela virou mentira');

  // `Expires` sozinho (sem Max-Age) também serve, e vem no formato com hífen.
  const soExpires = prazoDaSessaoWaze(['_web_session=X; Expires=Tue, 15-Sep-2026 02:04:14 GMT'], T0);
  assert.equal(soExpires, Math.floor(Date.parse('2026-09-15T02:04:14Z') / 1000));
  assert.equal(prazoDaSessaoWaze(['_web_session=X; Expires=Tue, 15 Sep 2026 02:04:14 GMT'], T0), soExpires,
    'o formato com espaços deixou de ser aceito');

  // Não saber é `null`, nunca um número inventado: a app trata ausente como
  // "mantém o que já sabia", e um 0 ou NaN aqui viraria "vence hoje" na tela.
  assert.equal(prazoDaSessaoWaze([], T0), null);
  assert.equal(prazoDaSessaoWaze(null, T0), null);
  assert.equal(prazoDaSessaoWaze(['_csrf_token=Y; Max-Age=99'], T0), null, 'leu o prazo do cookie errado');
  assert.equal(prazoDaSessaoWaze(['x_web_session=X; Max-Age=99'], T0), null, 'casou com nome que só termina igual');
  assert.equal(prazoDaSessaoWaze(['_web_session=X; Expires=banana; Max-Age=abc'], T0), null);
  assert.equal(prazoDaSessaoWaze(['_web_session=X; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'], T0), null,
    'aceitou um prazo já vencido');
});

test('regravar a sessão com o cookie novo é estrangulado no tempo', async () => {
  const { makeSessions, SESSION_COOKIE_REFRESH } = await import('../server/core.mjs');

  // Há uma chamada ao Waze por swipe e o KV aceita 1 escrita/s por chave.
  // Regravar a cada resposta trocaria o logout por estouro de limite de
  // escrita — outro logout, com outro nome.
  assert.ok(SESSION_COOKIE_REFRESH >= 600, 'teto de regravação curto demais pro limite do KV');

  const T0 = 1785000000;
  let agora = T0;
  const relogio = Date.now;
  Date.now = () => agora * 1000;
  try {
    const kv = new Map();
    let escritas = 0;
    const store = {
      get: (h) => kv.get(h) ?? null,
      put: (h, v) => { escritas++; kv.set(h, v); },
      delete: (h) => kv.delete(h),
    };
    const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
    const token = await sessions.createSession('c1');
    const naCriacao = escritas;

    // Rajada logo depois do login: nada é regravado.
    for (let i = 0; i < 20; i++) { agora += 1; await sessions.refreshCookies(token, 'c2'); }
    assert.equal(escritas, naCriacao, 'regravou dentro da janela de estrangulamento');

    // Passada a janela, regrava UMA vez — e a próxima rajada volta a esperar.
    agora = T0 + SESSION_COOKIE_REFRESH + 1;
    assert.equal(await sessions.refreshCookies(token, 'c3'), true, 'não regravou depois da janela');
    assert.equal(escritas, naCriacao + 1);
    for (let i = 0; i < 10; i++) { agora += 1; await sessions.refreshCookies(token, 'c4'); }
    assert.equal(escritas, naCriacao + 1, 'a janela não reiniciou depois de regravar');

    // E o conteúdo novo é o que passa a valer.
    agora = T0 + 2 * SESSION_COOKIE_REFRESH + 2;
    await sessions.refreshCookies(token, 'c5');
    assert.equal(await sessions.loadSession(token), 'c5', 'a sessão não ficou com o cookie novo');

    // Token inexistente não cria sessão do nada nem lança.
    assert.equal(await sessions.refreshCookies('nao-existe', 'x'), false);
    assert.equal(await sessions.refreshCookies(null, 'x'), false);
    assert.equal(await sessions.refreshCookies(token, null), false);
  } finally {
    Date.now = relogio;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Os 7 tipos de PUR do WME
// ─────────────────────────────────────────────────────────────────────────────
//
// As formas abaixo NÃO são inventadas: saíram do Waze real. Cinco vieram de
// pedidos que o owner criou de propósito com uma conta de teste (o local casou
// EXATAMENTE com os tipos dos pedidos dele e com nenhum outro, que é o que
// fecha o mapeamento), e o FLAGGED_PHOTO de um pedido real encontrado no
// México — no Brasil não havia nenhum.
const PUR_REAIS = [
  // { type: VENUE } — local novo proposto por um usuário
  [{ type: 'VENUE' }, 'NEW_PLACE'],
  // { type: IMAGE } — foto nova enviada pra um local existente
  [{ type: 'IMAGE' }, 'NEW_PHOTO'],
  // editar detalhes pelo app → o pedido carrega changedVenue
  [{ type: 'REQUEST', subType: 'UPDATE' }, 'DETAILS_UPDATE'],
  // marcar impróprio / fechado / duplicado → 3 motivos, MESMO tipo
  [{ type: 'REQUEST', subType: 'FLAG', flagType: 'INAPPROPRIATE', flagSubjectType: 'VENUE' }, 'FLAGGED_PLACE'],
  [{ type: 'REQUEST', subType: 'FLAG', flagType: 'CLOSED', flagSubjectType: 'VENUE' }, 'FLAGGED_PLACE'],
  [{ type: 'REQUEST', subType: 'FLAG', flagType: 'DUPLICATE', flagSubjectType: 'VENUE' }, 'FLAGGED_PLACE'],
  // denúncia de FOTO: mesmo subType FLAG, o que muda é o flagSubjectType
  [{ type: 'REQUEST', subType: 'FLAG', flagType: 'UNRELATED', flagSubjectType: 'IMAGE' }, 'FLAGGED_PHOTO'],
  [{ type: 'REQUEST', subType: 'DELETE' }, 'DELETE_PLACE'],
];

test('purTypeDoUR: classifica cada forma REAL no tipo do WME', () => {
  for (const [ur, esperado] of PUR_REAIS) {
    assert.equal(purTypeDoUR(ur), esperado,
      `${JSON.stringify(ur)} deveria ser ${esperado}`);
  }
  // O par que distingue local de foto é `flagSubjectType`, e é o ÚNICO sinal:
  // trocá-lo tem que trocar o tipo, senão a app junta duas coisas diferentes.
  assert.notEqual(
    purTypeDoUR({ type: 'REQUEST', subType: 'FLAG', flagSubjectType: 'VENUE' }),
    purTypeDoUR({ type: 'REQUEST', subType: 'FLAG', flagSubjectType: 'IMAGE' }),
    'reporte de local e de foto colapsaram no mesmo tipo');
  assert.equal(purTypeDoUR({ type: 'REQUEST', subType: 'DELETE', flagSubjectType: 'IMAGE' }),
    'DELETE_PHOTO', 'a exclusão de foto perdeu o tipo próprio');
});

test('PUR_TIPOS: os 7 números do WME, sem buraco nem repetição', () => {
  const nums = Object.values(PUR_TIPOS);
  assert.equal(nums.length, 7, 'o WME tem 7 tipos no filtro de PUR');
  assert.deepEqual([...nums].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7],
    'os números são 1..7 (lidos do bundle do WME v2.361) — sem pular nem repetir');
  // Todo tipo classificável tem número, e todo número tem classificação.
  const classificaveis = new Set(PUR_REAIS.map(([, t]) => t));
  classificaveis.add('DELETE_PHOTO');
  for (const t of classificaveis) {
    assert.ok(PUR_TIPOS[t], `${t} é classificado mas não tem número no PUR_TIPOS`);
  }
});

test('tipo desconhecido NUNCA some da fila por causa do filtro', () => {
  // O filtro é lista de PERMITIDOS. Se o Waze inventar um subType amanhã, ele
  // não estaria na lista e sumiria calado de TODA fila — e some sem erro, que é
  // o defeito que ninguém reporta porque ninguém vê. Melhor rótulo feio.
  const inventado = { type: 'REQUEST', subType: 'ALGO_QUE_O_WAZE_INVENTOU' };
  assert.equal(purTypeDoUR(inventado), 'UNKNOWN');

  const rd = {
    users: { objects: [] }, streets: { objects: [] }, cities: { objects: [] },
    venues: { objects: [{
      id: 'v1', name: 'Local', permissions: -1, categories: [], images: [],
      venueUpdateRequests: [{ id: 'u1', ...inventado, isRead: false }],
    }] },
  };
  // Filtro que NÃO inclui o tipo novo: ele tem que passar assim mesmo.
  const { places } = buildPlacesFromSearch(rd, { filterTypes: ['NEW_PLACE'], unreadOnly: true });
  assert.equal(places.length, 1, 'PUR de tipo desconhecido sumiu da fila');
  assert.equal(places[0].purType, 'UNKNOWN', 'o tipo cru deixou de ser exposto');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Excluir foto (a lixeira do lightbox)
// ═══════════════════════════════════════════════════════════════════════════

test('approvedImageIds: só a foto aprovada é excluível', () => {
  // Dado com a forma REAL medida no Waze: a foto pendente do pedido tem
  // `approved: false`, as antigas têm `true`. Excluir a pendente pelo venue
  // apagaria a imagem e deixaria o pedido órfão — por isso ela fica de fora.
  const rd = {
    users: { objects: [{ id: 7, userName: 'quemquer', rank: 1 }] },
    venues: {
      objects: [{
        id: 'v1',
        name: 'Vista Chinesa',
        permissions: -1,
        images: [
          { id: 'nova-pendente', approved: false, creatorUserId: 7, date: 1 },
          { id: 'velha-aprovada', approved: true, creatorUserId: 7, date: 2 },
          { id: 'sem-o-campo', creatorUserId: 7, date: 3 },
        ],
        venueUpdateRequests: [{ id: 'nova-pendente', type: 'IMAGE', isRead: false }],
      }],
    },
  };
  const { places } = buildPlacesFromSearch(rd, { unreadOnly: true });
  assert.equal(places.length, 1);
  const p = places[0];
  assert.equal(p.imageUrls.length, 3, 'o carrossel continua mostrando TODAS as fotos');
  assert.deepEqual(p.approvedImageIds, ['velha-aprovada'],
    'só entra quem é approved===true; pendente e campo ausente ficam de fora');
  // O id excluível tem que casar por substring com a URL — é assim que o
  // frontend liga uma coisa na outra, sem um segundo campo pra desalinhar.
  const url = p.imageUrls.find((u) => u.indexOf('velha-aprovada') !== -1);
  assert.ok(url, 'o id aprovado não aparece em nenhuma URL do carrossel');
});

test('excluir-foto: relê o local e monta a escrita como o WME (URLs medidas contra o Waze real)', async () => {
  // Este teste nasceu de um bug que só o Waze de verdade acusou: HTTP 406.
  // `wazeFeaturesEndpoint` JÁ vem com `?ignoreWarnings=false&language=pt-BR`
  // grudado, então acrescentar `?bbox=...` gerava um SEGUNDO `?` e o
  // `language` virava `pt-BR?bbox=...`. Sondei 5 variantes de header e de
  // parâmetro antes de olhar a URL — daí o teste travar a URL, que é onde o
  // defeito estava, e não os headers, que nunca tiveram culpa.
  const store = memStore();
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const token = await sessions.createSession([
    NETSCAPE('.waze.com', '_csrf_token', 'abc123'),
    NETSCAPE('.waze.com', '_web_session', 'xyz'),
  ].join('\n'));

  const VID = 'v-1';
  const FOTOS = [
    { id: 'alvo', approved: true, creatorUserId: 1, date: 10, scanned: true, street: false, location: { type: 'Point', coordinates: [1, 2] } },
    { id: 'fica', approved: true, creatorUserId: 2, date: 20, scanned: true, street: false, location: { type: 'Point', coordinates: [3, 4] } },
  ];
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    chamadas.push({ url: u, metodo: init?.method || 'GET' });
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/Session/.test(u)) return j({ userName: 'a', rank: 5, isAreaManager: true, isStaff: false });
    if (init?.method === 'POST') {
      const enviadas = JSON.parse(init.body).actions._subActions[0].attributes.images;
      return j({ venues: { [VID]: { id: VID, images: enviadas } }, status: 0, synced: true });
    }
    return j({ venues: { objects: [{ id: VID, images: FOTOS, permissions: -1 }] }, users: { objects: [] } });
  };
  try {
    const r = await dispatch('excluir-foto', { sessionToken: token, region: 'row', venueID: VID, imageID: 'alvo', lat: -12.8, lon: -38.3 }, { sessions });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.restantes, ['fica']);

    const get = chamadas.find((c) => c.metodo === 'GET' && /Features/.test(c.url));
    const post = chamadas.find((c) => c.metodo === 'POST' && /Features/.test(c.url));
    assert.ok(get, 'não releu o local antes de gravar');
    assert.equal((get.url.match(/\?/g) || []).length, 1, 'a URL da releitura tem mais de um "?" — foi assim que veio o 406');
    assert.ok(/[?&]bbox=/.test(get.url), 'a releitura não mandou bbox');
    // Sem `language` cravado: medido contra o Waze real, ele não muda um byte
    // da resposta, e pt-BR na URL de um editor francês documenta errado de
    // onde a chamada veio (o mesmo defeito do antigo Referer com /pt-BR/).
    assert.ok(!/[?&]language=/.test(get.url), 'voltou o language cravado na releitura — ele não muda nada e mente sobre o idioma de quem chamou');
    // Ordem importa: reler DEPOIS de gravar não protegeria nada.
    assert.ok(chamadas.indexOf(get) < chamadas.indexOf(post), 'gravou antes de reler');
    assert.equal(post.url, 'https://www.waze.com/row-Descartes/app/Features?ignoreWarnings=false&language=pt-BR');
  } finally {
    globalThis.fetch = original;
  }
});

test('excluir-foto: escreve a lista que veio da RELEITURA, não a que o celular tinha', async () => {
  // O caso que a releitura existe pra evitar: entre abrir a foto e tocar na
  // lixeira, outro editor subiu uma foto. Mandar a lista do celular a apagaria
  // em silêncio — o Waze não faz merge, ele SUBSTITUI o array inteiro.
  const store = memStore();
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const token = await sessions.createSession([
    NETSCAPE('.waze.com', '_csrf_token', 'abc'), NETSCAPE('.waze.com', '_web_session', 'x'),
  ].join('\n'));
  const VID = 'v-2';
  const original = globalThis.fetch;
  let enviadas = null;
  globalThis.fetch = async (url, init) => {
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/Session/.test(String(url))) return j({ rank: 5, isAreaManager: true });
    if (init?.method === 'POST') {
      enviadas = JSON.parse(init.body).actions._subActions[0].attributes.images;
      return j({ venues: { [VID]: { id: VID, images: enviadas } }, status: 0, synced: true });
    }
    // O Waze AGORA tem uma foto a mais do que o celular viu.
    return j({ venues: { objects: [{ id: VID, permissions: -1, images: [
      { id: 'alvo', approved: true }, { id: 'antiga', approved: true }, { id: 'recem-chegada', approved: true },
    ] }] }, users: { objects: [] } });
  };
  try {
    const r = await dispatch('excluir-foto', { sessionToken: token, region: 'row', venueID: VID, imageID: 'alvo', lat: 0, lon: 0 }, { sessions });
    assert.equal(r.status, 200);
    const ids = enviadas.map((i) => i.id);
    assert.ok(ids.includes('recem-chegada'), 'a foto que chegou no meio do caminho foi apagada junto');
    assert.ok(!ids.includes('alvo'), 'a foto alvo continuou na lista');
    assert.deepEqual(ids, ['antiga', 'recem-chegada']);
  } finally {
    globalThis.fetch = original;
  }
});

// ── O que está guardado no servidor não presta sem o aparelho do editor ─────
//
// Este teste É a frase pública. Se ele passar a falhar, a app deixou de poder
// dizer que "nem quem opera consegue abrir o que está guardado" — e a frase
// está na Ajuda, em quatro idiomas.
//
// Cenário: o atacante tem TUDO do lado do servidor — o `ENCRYPTION_KEY` e um
// dump completo do KV. Falta só o token, que vive no aparelho da pessoa. É o
// cenário do vazamento, do token de leitura roubado e do pedido judicial.
test('sessão: Secret + dump do KV, SEM o token, não abre nada', async () => {
  const { makeSessions } = await import('../server/core.mjs');
  const COOKIES = ['_web_session', '_csrf_token']
    .map((n) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${n}\tvalor-de-teste`).join('\n');
  const SECRET = crypto.getRandomValues(new Uint8Array(32));

  const kv = new Map();
  const store = {
    get: async (h) => kv.get(h) ?? null,
    put: async (h, b) => { kv.set(h, b); },
    delete: async (h) => { kv.delete(h); },
  };
  const sessions = makeSessions({ store, keyBytes: SECRET });
  const token = await sessions.createSession(COOKIES);

  // 1. O dump não tem cookie em claro, nem diz de quem é a sessão.
  const dump = [...kv.entries()];
  assert.equal(dump.length, 1);
  const [chave, valor] = dump[0];
  assert.ok(!/_web_session|valor-de-teste/.test(valor), 'o valor guardado não pode conter o cookie');
  assert.ok(!/_web_session|valor-de-teste/.test(chave), 'nem a chave');

  // 2. Com o Secret CRU — o jeito que abriria antes desta versão — não abre.
  //    É este `assert` que morde se alguém remover a derivação.
  const blob = valor.slice(valor.indexOf('|') + 1);
  const [ivB, ctB] = blob.split('::');
  const b64 = (x) => Uint8Array.from(Buffer.from(x, 'base64'));
  const cruas = await crypto.subtle.importKey('raw', SECRET, { name: 'AES-GCM' }, false, ['decrypt']);
  await assert.rejects(
    () => crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(ivB) }, cruas, b64(ctB)),
    'o Secret sozinho NÃO pode decifrar — se decifrou, a derivação sumiu');

  // 3. Com o token (a requisição normal), abre — senão a app não funcionaria.
  assert.equal(await sessions.loadSession(token), COOKIES);

  // 4. E o token de outra pessoa não abre esta sessão.
  const outro = await sessions.createSession('nada');
  assert.equal(await sessions.loadSession(outro + 'x'), null);
});

// Mesma propriedade no pareamento — mas só o registro do QR a tem. O código
// digitado é 30 bits e a garantia dele é OUTRA (5 minutos + uso único); este
// teste existe pra ninguém "melhorar" o padrão de volta pro curto sem perceber.
test('pareamento: o registro padrão é o forte, o curto só sob demanda', async () => {
  const { makeSessions } = await import('../server/core.mjs');
  const SECRET = crypto.getRandomValues(new Uint8Array(32));
  const kv = new Map();
  const store = {
    get: async (h) => kv.get(h) ?? null,
    put: async (h, b) => { kv.set(h, b); },
    delete: async (h) => { kv.delete(h); },
  };
  const sessions = makeSessions({ store, keyBytes: SECRET });

  const padrao = await sessions.createPairing('cookies-x');
  assert.equal(padrao.code.length, 20, 'sem pedir, o segredo é o longo (do QR)');
  assert.equal(padrao.curto, false);

  const sobDemanda = await sessions.createPairing('cookies-x', { comCodigo: true });
  assert.equal(sobDemanda.code.length, 6, 'o digitável só quando pedido');
  assert.equal(sobDemanda.curto, true);

  // Os dois resgatam — o curto continua servindo a quem não tem câmera.
  assert.equal(await sessions.claimPairing(padrao.code), 'cookies-x');
  assert.equal(await sessions.claimPairing(sobDemanda.code), 'cookies-x');
});

// Sessão que não abre é APAGADA, não deixada vencendo.
//
// O caso real é o deploy da derivação: registros do formato anterior seguem
// decifráveis com o Secret sozinho — justamente o que a versão nova impede — e
// ficariam assim por até SESSION_TTL. O editor já era deslogado; o blob é que
// ficava. Verificado desfazendo o `descartar()`: este teste reprova.
test('sessão ilegível é apagada do store, não deixada expirar', async () => {
  const { makeSessions } = await import('../server/core.mjs');
  const SECRET = crypto.getRandomValues(new Uint8Array(32));
  const kv = new Map();
  const store = {
    get: async (h) => kv.get(h) ?? null,
    put: async (h, b) => { kv.set(h, b); },
    delete: async (h) => { kv.delete(h); },
  };
  const sessions = makeSessions({ store, keyBytes: SECRET });
  const token = await sessions.createSession('cookies-x');
  const [chave, valor] = [...kv.entries()][0];

  // Formato ANTIGO: cifrado com o Secret cru, sem derivação.
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  const k = await crypto.subtle.importKey('raw', SECRET, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode('cookies-x'));
  kv.set(chave, valor.slice(0, valor.indexOf('|') + 1) + b64(iv) + '::' + b64(new Uint8Array(ct)));

  assert.equal(await sessions.loadSession(token), null, 'formato antigo não pode abrir');
  assert.equal(kv.has(chave), false, 'o blob antigo tem que SUMIR — com o Secret ele ainda abriria');

  // E valor corrompido (sem carimbo) também sai.
  const t2 = await sessions.createSession('cookies-y');
  const c2 = [...kv.keys()][0];
  kv.set(c2, 'lixo-sem-carimbo');
  assert.equal(await sessions.loadSession(t2), null);
  assert.equal(kv.has(c2), false, 'valor corrompido também é descartado');
});

// ── DUPLICATE: de QUEM o local é duplicado ──────────────────────────────────
//
// Os dados abaixo são de um pedido REAL da fila brasileira (medido nos 6 países
// obrigatórios). O `flagEntityID` do DUPLICATE carrega o id do OUTRO local, e o
// `Issues/Search/List` não devolve esse outro local — ele só devolve quem tem
// pedido pendente. Medido: o alvo aparece na própria resposta em 0 de 6 casos
// genuínos. Quem resolve é a releitura por bbox.
const DUP_ORIGEM = '205391388.2053651740.4527272';
const DUP_ALVO = '205391388.2053651740.12920425';
const DUP_LON = -46.6, DUP_LAT = -23.5;

const buscaComFlag = (ur) => ({
  users: { objects: [] },
  venues: { objects: [{
    id: DUP_ORIGEM, name: 'Estacionamento Times Park', permissions: -1,
    geometry: { type: 'Point', coordinates: [DUP_LON, DUP_LAT] },
    images: [],
    venueUpdateRequests: [Object.assign({
      id: 'ur-dup', venueID: DUP_ORIGEM, type: 'REQUEST', subType: 'FLAG',
      isRead: false, dateAdded: 1786982736809,
    }, ur)],
  }] },
  mapIssues: { venueUpdateRequests: { hasMore: false } },
});

// O alvo, ~96 m ao norte — a distância REAL deste pedido.
const RESPOSTA_BBOX = { venues: { objects: [{
  id: DUP_ALVO, name: 'Natan Estacionamento', permissions: -1,
  geometry: { type: 'Point', coordinates: [DUP_LON, DUP_LAT + 0.00086] },
}] } };

async function buscarComStub(ur, { bbox = RESPOSTA_BBOX, bboxStatus = 200 } = {}) {
  const store = memStore();
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const token = await sessions.createSession([
    NETSCAPE('.waze.com', '_csrf_token', 'abc'), NETSCAPE('.waze.com', '_web_session', 'x'),
  ].join('\n'));
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    chamadas.push({ url: u, metodo: init?.method || 'GET' });
    const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    if (/Issues\/Search\/List/.test(u)) return j(buscaComFlag(ur));
    if (/\/Features/.test(u)) return j(bbox, bboxStatus);
    return j({});
  };
  try {
    const r = await dispatch('buscar-places', { sessionToken: token, region: 'row' }, { sessions });
    return { r, chamadas };
  } finally {
    globalThis.fetch = original;
  }
}

test('DUPLICATE: o card recebe DE QUEM é duplicado, resolvido por releitura de bbox', async () => {
  const { r, chamadas } = await buscarComStub({
    flagType: 'DUPLICATE', flagSubjectType: 'VENUE', flagEntityID: DUP_ALVO,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body.places[0];
  assert.ok(p.duplicado, 'o alvo do duplicado não foi resolvido — o card volta a dizer só "Duplicado"');
  assert.equal(p.duplicado.id, DUP_ALVO);
  assert.equal(p.duplicado.nome, 'Natan Estacionamento');
  // O "onde": sem coordenada não há marcador no mapa, e o card responde
  // metade da pergunta ("de quem", nunca "onde").
  assert.ok(Array.isArray(p.duplicado.ll), 'o alvo veio sem coordenada');
  assert.ok(p.duplicado.distM >= 90 && p.duplicado.distM <= 100,
    `distância fora do esperado: ${p.duplicado.distM} m`);

  const leitura = chamadas.find((c) => c.metodo === 'GET' && /\/Features/.test(c.url));
  assert.ok(leitura, 'não releu por bbox');
  // O raio é medido, não escolhido: com o raio do excluir-foto (0,0002°) o alvo
  // não é achado em NENHUM dos 6 casos reais. Se alguém "unificar" as duas
  // constantes, este número cai e o recurso para de funcionar em silêncio.
  const bboxQ = new URL(leitura.url).searchParams.get('bbox').split(',').map(Number);
  assert.ok(Math.abs((bboxQ[2] - bboxQ[0]) / 2 - 0.004) < 1e-9,
    `raio da releitura mudou: ${(bboxQ[2] - bboxQ[0]) / 2}`);
  assert.equal((leitura.url.match(/\?/g) || []).length, 1, 'URL com dois "?" — foi assim que veio o 406 no excluir-foto');
  assert.equal(chamadas.filter((c) => /\/Features/.test(c.url)).length, 1, 'mais de uma leitura pro mesmo duplicado');
});

test('DUPLICATE que aponta o PRÓPRIO local não gasta leitura', async () => {
  // 1 dos 7 casos reais. Ou o pedido é lixo, ou o app do celular preencheu o
  // campo por não ter outro valor — em nenhuma das duas há nome pra mostrar,
  // então o certo é não chamar o Waze à toa.
  const { r, chamadas } = await buscarComStub({
    flagType: 'DUPLICATE', flagSubjectType: 'VENUE', flagEntityID: DUP_ORIGEM,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.places[0].duplicado, undefined);
  assert.equal(chamadas.filter((c) => /\/Features/.test(c.url)).length, 0,
    'releu o bbox pra um alvo que é o próprio local');
});

test('FLAG de FOTO não dispara releitura — o mesmo campo carrega id de foto', async () => {
  // `flagEntityID` é id de VENUE quando o subject é VENUE e UUID de FOTO quando
  // é IMAGE. Sem distinguir, todo reporte de foto (UNRELATED, LOW_QUALITY —
  // 24 dos 264 FLAG medidos) viraria uma leitura extra contra o Waze.
  const { r, chamadas } = await buscarComStub({
    flagType: 'LOW_QUALITY', flagSubjectType: 'IMAGE',
    flagEntityID: '89abe179-43a6-4d44-b4cd-d9ef2fd4ab70',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.places[0].duplicado, undefined);
  assert.equal(chamadas.filter((c) => /\/Features/.test(c.url)).length, 0);
});

test('releitura do duplicado que falha não derruba a busca', async () => {
  // Melhor-esforço: sem o nome o card volta a ser o que era, e é só isso.
  const { r } = await buscarComStub(
    { flagType: 'DUPLICATE', flagSubjectType: 'VENUE', flagEntityID: DUP_ALVO },
    { bbox: { erro: 1 }, bboxStatus: 500 });
  assert.equal(r.status, 200, 'a busca inteira caiu por causa de uma leitura acessória');
  assert.equal(r.body.places.length, 1);
  assert.equal(r.body.places[0].duplicado, undefined);
});

// ── A caixa do duplicado se centra no CENTRÓIDE, não no primeiro vértice ────
//
// Reproduz o caso REAL que o owner trouxe (SolPark Av. Octávio Mangabeira,
// Salvador): local em polígono cujo PRIMEIRO VÉRTICE fica 272 m do próprio
// centro. Como `place.lat/lon` saem do `extractLonLat` — o primeiro vértice —,
// a caixa nascia deslocada e o alvo caía fora pela borda, com o raio inteiro
// disponível do outro lado. Medido: 12/14 pelo vértice contra 13/14 pelo
// centróide, e na chamada real ao Waze o mesmo raio de 0,004 acha ou não acha
// o alvo só conforme o centro.
//
// Aqui o polígono é construído pra isso: os 4 vértices somam (0,0), então o
// centróide é (0,0) e o primeiro vértice está em lon −0,003. O alvo fica em
// lon +0,0035 — DENTRO do raio contado do centro, FORA se contado do vértice.
const DUP_POLI_ALVO = '9.9.222';
const buscaPoligono = () => ({
  users: { objects: [] },
  venues: { objects: [{
    id: '9.9.111', name: 'SolPark', permissions: -1, images: [],
    geometry: { type: 'Polygon', coordinates: [[[-0.003, 0], [0.001, 0.001], [0.001, -0.001], [0.001, 0]]] },
    venueUpdateRequests: [{
      id: 'ur-poli', venueID: '9.9.111', type: 'REQUEST', subType: 'FLAG',
      flagType: 'DUPLICATE', flagSubjectType: 'VENUE', flagEntityID: DUP_POLI_ALVO,
      isRead: false, dateAdded: 1786982736809,
    }],
  }] },
  mapIssues: { venueUpdateRequests: { hasMore: false } },
});
// O alvo, a lon +0,0035 do CENTRO do polígono.
const DUP_POLI_LL = [0.0035, 0];   // [lon, lat]

test('duplicado: a caixa se centra no centróide, não no primeiro vértice', async () => {
  const store = memStore();
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const token = await sessions.createSession([
    NETSCAPE('.waze.com', '_csrf_token', 'abc'), NETSCAPE('.waze.com', '_web_session', 'x'),
  ].join('\n'));
  let caixa = null;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/Issues\/Search\/List/.test(u)) return j(buscaPoligono());
    if (/\/Features/.test(u)) {
      // O Waze só devolve o que está DENTRO da caixa. Simular isso é o que faz
      // este teste medir o CENTRO e não só a existência da chamada — com um
      // stub que devolvesse o alvo sempre, o defeito passaria verde.
      const [w, s, e, n] = new URL(u).searchParams.get('bbox').split(',').map(Number);
      caixa = { w, s, e, n };
      const dentro = DUP_POLI_LL[0] >= w && DUP_POLI_LL[0] <= e && DUP_POLI_LL[1] >= s && DUP_POLI_LL[1] <= n;
      return j({ venues: { objects: dentro
        ? [{ id: DUP_POLI_ALVO, name: 'Condomínio Sol e Maré', permissions: -1,
             geometry: { type: 'Point', coordinates: DUP_POLI_LL } }]
        : [] } });
    }
    return j({});
  };
  try {
    const r = await dispatch('buscar-places', { sessionToken: token, region: 'row' }, { sessions });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const p = r.body.places[0];
    // O que a app expõe como posição do local É o primeiro vértice — é daqui
    // que vinha o erro, e deixar isso explícito impede de "consertar" o
    // extractLonLat, que está certo pro que ele serve.
    assert.equal(p.lon, -0.003, 'place.lon deixou de ser o primeiro vértice — o teste perdeu o sentido');
    assert.deepEqual(p.mapa.centro, [0, 0], 'o centróide do polígono mudou; refaça a fixture');

    assert.ok(caixa, 'não releu por bbox');
    const cLon = (caixa.w + caixa.e) / 2, cLat = (caixa.s + caixa.n) / 2;
    assert.ok(Math.abs(cLon - 0) < 1e-9 && Math.abs(cLat - 0) < 1e-9,
      `a caixa foi centrada em (${cLat}, ${cLon}), não no centróide (0, 0)`);
    assert.ok(p.duplicado, 'o alvo cabia no raio a partir do centro e mesmo assim não foi achado');
    assert.equal(p.duplicado.nome, 'Condomínio Sol e Maré');
    // A distância exibida sai do MESMO centro que enquadrou a caixa: se
    // saísse do vértice, o card diria ~720 m onde o certo é ~390 m.
    assert.ok(p.duplicado.distM > 340 && p.duplicado.distM < 440,
      `distância medida de outro ponto: ${p.duplicado.distM} m`);
  } finally {
    globalThis.fetch = original;
  }
});

// ── Renomear o local ────────────────────────────────────────────────────────
//
// A ÚNICA escrita de dado de LOCAL da app. O payload abaixo é o do WME byte a
// byte, tirado de um HAR do owner renomeando "Teste AG" → "Teste AGE": só `id` e
// `name`. É PATCH, não substituição — o oposto do que as fotos fazem (gotcha
// #57), e supor o contrário teria feito a app mandar o venue inteiro.
//
// O caminho foi exercitado contra o Waze REAL no local de testes do owner, com
// autorização explícita dele: renomear → releitura independente confirmando →
// devolver ao nome original. `status: 0`, `synced: true` nas duas gravações.
async function renomearComStub(data, resposta, status = 200) {
  const store = memStore();
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const token = await sessions.createSession([
    NETSCAPE('.waze.com', '_csrf_token', 'abc'), NETSCAPE('.waze.com', '_web_session', 'x'),
  ].join('\n'));
  const enviados = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init && init.method === 'POST') { try { enviados.push(JSON.parse(init.body)); } catch { enviados.push(null); } }
    return new Response(JSON.stringify(resposta), { status, headers: { 'content-type': 'application/json' } });
  };
  try {
    const r = await dispatch('renomear-local', { sessionToken: token, region: 'row', ...data }, { sessions });
    return { r, enviados };
  } finally {
    globalThis.fetch = original;
  }
}

test('renomear-local: manda o payload do WME, byte a byte na estrutura', async () => {
  const VID = '210830983.2108178759.43076799';
  const { r, enviados } = await renomearComStub(
    { venueID: VID, nome: '  Odontodente Sorriso  ' },       // com espaço de sobra de propósito
    { venues: { [VID]: { id: VID, name: 'Odontodente Sorriso' } }, status: 0, synced: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, true);
  assert.equal(r.body.nome, 'Odontodente Sorriso', 'o nome não foi aparado');
  assert.equal(enviados.length, 1, 'mais de uma gravação para uma renomeação');
  assert.deepEqual(enviados[0], {
    actions: {
      name: 'DESCARTES_SERIALIZATION',
      _subActions: [{
        name: 'UPDATE_OBJECT', _objectType: 'venue', action: 'UPDATE',
        attributes: { id: VID, name: 'Odontodente Sorriso' },
      }],
    },
  }, 'o payload divergiu do que o WME manda');
  // PATCH, não substituição: mandar mais atributos apagaria o que não veio.
  const attrs = Object.keys(enviados[0].actions._subActions[0].attributes);
  assert.deepEqual(attrs.sort(), ['id', 'name'], `foram junto atributos a mais: ${attrs}`);
});

test('renomear-local: recusa nome vazio e venueID ausente, sem tocar no Waze', async () => {
  for (const data of [{ venueID: 'v1', nome: '' }, { venueID: 'v1', nome: '   ' },
                      { venueID: '', nome: 'X' }, { nome: 'X' }, { venueID: 'v1' }]) {
    const { r, enviados } = await renomearComStub(data, {});
    assert.equal(r.status, 400, `deixou passar ${JSON.stringify(data)}`);
    assert.equal(enviados.length, 0, 'chamou o Waze com parâmetro inválido');
  }
  // Teto de tamanho: nosso, defensivo. Quem recusa de verdade é o Waze.
  const { r, enviados } = await renomearComStub({ venueID: 'v1', nome: 'x'.repeat(256) }, {});
  assert.equal(r.status, 400);
  assert.equal(enviados.length, 0);
});

test('renomear-local: o Waze dizer 200 e NÃO ter mudado vira erro, não sucesso', async () => {
  // O eco não é prova (mesma ressalva do excluir-foto), mas quando ele CONTRADIZ
  // o pedido, afirmar sucesso seria a app mentir na cara do editor.
  const VID = 'v-1';
  const { r } = await renomearComStub(
    { venueID: VID, nome: 'Nome Novo' },
    { venues: { [VID]: { id: VID, name: 'Nome Velho' } }, status: 0, synced: true });
  assert.equal(r.status, 500);
  assert.equal(r.body.success, false);
  assert.equal(r.body.errorKey, 'srv.err.nameUnchanged');
});

test('renomear-local: 403 do Waze vira unauthorized, não erro genérico', async () => {
  const { r } = await renomearComStub({ venueID: 'v1', nome: 'X' },
    { errorList: [{ code: 101, message: 'not allowed' }] }, 403);
  assert.equal(r.body.success, false);
  assert.equal(r.body.errorCategory, 'unauthorized');
});

// O local JÁ EXISTE no mapa, ou ele próprio ainda é um pedido pendente?
//
// É o único sinal que prevê se o Waze aceita escrita de atributo — MEDIDO com
// controle contra o WME real: renomear com o MESMO payload, na MESMA sessão,
// devolve 406 em local `approved:false` e 200 em `approved:true`. Sem o campo,
// o portão do renomear teria que adivinhar pelo tipo do card, e `NEW_PLACE`
// erra por pouco mas erra (9 de 711 locais não aprovados aparecem com card de
// outro tipo, medido em 2420 cards com nome dos 6 países obrigatórios).
test('buildPlacesFromSearch: o place diz se o LOCAL já foi aprovado', () => {
  const monta = (approved) => {
    const venue = { id: 'v1', name: 'Local', permissions: -1, categories: [], images: [],
      venueUpdateRequests: [{ id: 'u1', type: 'VENUE', isRead: false }] };
    if (approved !== undefined) venue.approved = approved;
    return buildPlacesFromSearch({ users: { objects: [] }, streets: { objects: [] },
      cities: { objects: [] }, venues: { objects: [venue] } }, { unreadOnly: true }).places[0];
  };
  assert.equal(monta(false).localAprovado, false, 'local pendente passou por aprovado — o renomear vira 406');
  assert.equal(monta(true).localAprovado, true, 'local aprovado passou por pendente — o renomear some sem motivo');
  // Ausente cai no lado PERMISSIVO: se o Waze parar de mandar o campo, o
  // comportamento volta a ser o de hoje em vez de esconder o renomear de todo
  // mundo em silêncio. Errar pro lado que o editor VÊ é recuperável; errar pro
  // lado que some não avisa ninguém.
  assert.equal(monta(undefined).localAprovado, true, 'campo ausente passou a esconder o renomear, e isso falha calado');
});
