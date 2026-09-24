// A foto de perfil é de TERCEIRO, e ela já sumiu uma vez.
//
// O caso (v2026.09.14-01, relatado pelo owner com print do iPhone): o Waze
// mudou o endereço da foto de `social-row.waze.com/SocialMediaServer/images/
// profile/<id>` pra `sms-profile-image.waze.com/<id>`. O host novo não estava
// na CSP, então o navegador BLOQUEOU a imagem antes da rede — medido no HAR
// dele: status 0 em 0,06 ms, sem IP de servidor (uma requisição que sai de
// verdade e falha leva ~25 ms, que é o que o beacon bloqueado do mesmo HAR
// mostra). O `<img>` sem tratamento de erro então desenhou o ícone de imagem
// quebrada dentro do círculo do cabeçalho, em toda tela do app.
//
// São DUAS coisas separadas, e por isso dois blocos de teste:
//   1. o host de hoje está nas TRÊS cópias da CSP (conserta ESTE endereço);
//   2. quando a foto falhar — por CSP, 404, host fora do ar ou rede caída — o
//      app degrada pro estado "perfil sem foto" que ele JÁ tinha, em vez do
//      ícone de quebrado. Isto é o que sobrevive à PRÓXIMA mudança de host,
//      que o Waze não vai avisar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// FONTE ÚNICA do casamento de host na CSP — a mesma que o waze-probe usa.
import { CSP_COPIAS, lerCsp, diretiva, hostLiberado } from '../tools/csp-img.mjs';

const REPO = new URL('../', import.meta.url);

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');

// Âncora em DECLARAÇÃO, nunca em distância (gotcha #67).
function fatiarFuncao(nome) {
  const ini = APP.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu do app.js`);
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:async function |function |const |let |\/\/ ──|\/\/ ═)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return APP.slice(ini, ini + 1 + fim);
}

// ── 1. O HOST DE HOJE, E O PRÓXIMO ────────────────────────────────────────
test('img-src libera os hosts de imagem do Waze nas TRÊS cópias da CSP', () => {
  // Desde v2026.09.14-03 a allowlist é o CURINGA `https://*.waze.com`, e não
  // uma lista de hosts. O motivo é este mesmo defeito: o Waze move host sem
  // avisar, e listar host por host conserta ESTE endereço e não o próximo —
  // com as fotos do CARD (o produto do app) no mesmo risco.
  //
  // O casamento vem da FONTE ÚNICA `tools/csp-img.mjs`, a mesma que o
  // `waze-probe` usa: `includes()` acerta o caso comum e erra o que importa.
  const DEVEM_PASSAR = [
    'sms-profile-image.waze.com',   // a foto de perfil de hoje
    'social-row.waze.com',          // a de ontem, que ainda serve
    'venue-image.waze.com',         // as fotos do CARD
    'www.waze.com',                 // os tiles do mini-mapa
    'algo-que-o-waze-ainda-vai-inventar.waze.com',
  ];
  // CONTROLE: o curinga não pode virar porta dos fundos. Um `endsWith('waze.com')`
  // ingênuo deixaria os dois primeiros entrarem — são domínios de OUTRO dono.
  const NAO_PODEM = ['evilwaze.com', 'waze.com.br', 'waze.com', 'exemplo.invalido'];
  for (const arquivo of Object.keys(CSP_COPIAS)) {
    const img = diretiva(lerCsp(arquivo, REPO), 'img-src');
    assert.ok(img, `${arquivo}: CSP sem diretiva img-src`);
    for (const h of DEVEM_PASSAR) {
      assert.ok(hostLiberado(h, img), `${arquivo}: img-src BLOQUEIA ${h} — a imagem morre antes da rede`);
    }
    for (const h of NAO_PODEM) {
      assert.ok(!hostLiberado(h, img), `${arquivo}: img-src LIBERA ${h}, que não é do Waze`);
    }
    // `data:` e `blob:` continuam (splash/ícone e o Resumo do mês).
    assert.match(img, /\bdata:/, `${arquivo}: sumiu data: do img-src`);
    assert.match(img, /\bblob:/, `${arquivo}: sumiu blob: — a imagem do Resumo do mês chega quebrada`);
  }
});

test('o curinga vale SÓ pra imagem — connect-src segue nominal', () => {
  // img-src com curinga é risco baixo (imagem não executa). `connect-src` é o
  // caminho de SAÍDA de dado: lá, subdomínio novo do Waze não entra sozinho.
  for (const arquivo of Object.keys(CSP_COPIAS)) {
    const conn = diretiva(lerCsp(arquivo, REPO), 'connect-src');
    assert.ok(conn, `${arquivo}: CSP sem connect-src`);
    assert.doesNotMatch(conn, /\*\.waze\.com/,
      `${arquivo}: connect-src virou curinga — isso abre saída de dado, não entrada de imagem`);
  }
});

// ── 2. A DEGRADAÇÃO (o que sobrevive à PRÓXIMA mudança) ────────────────────
test('falha na foto esconde o avatar em vez de mostrar o ícone de quebrado', () => {
  const lib = fatiarFuncao('liberarAvatar');
  assert.match(lib, /el\.onerror\s*=/, 'o avatar voltou a carregar sem tratar erro');
  // O handler tem que ESCONDER. Exige as duas coisas COLADAS no mesmo handler,
  // e não em qualquer lugar da função (gotcha #67).
  const handler = lib.match(/el\.onerror\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n        \};/);
  assert.ok(handler, 'não consegui delimitar o onerror do avatar');
  assert.match(handler[1], /avatarFalhou = url/, 'a falha não é lembrada — o ícone volta na troca de idioma');
  assert.match(handler[1], /el\.style\.display = 'none'/, 'o onerror não esconde o avatar');
});

test('o avatar que falhou NÃO reaparece quando a tela é redesenhada', () => {
  // `renderProfileHeader` roda de novo a cada troca de idioma. Sem consultar o
  // `avatarFalhou`, ela reexibe o <img> morto e o ícone de quebrado volta.
  const render = fatiarFuncao('renderProfileHeader');
  assert.match(render, /if \(p\.profileImageUrl && p\.profileImageUrl !== avatarFalhou\)/,
    'renderProfileHeader voltou a exibir o avatar sem checar se aquela URL já falhou');
  // E o `else` que esconde continua sendo o mesmo caminho de "perfil sem foto".
  assert.match(render, /\} else \{\s*\n\s*avatar\.style\.display = 'none';/,
    'sumiu o estado "perfil sem foto", que é pra onde a falha degrada');
});

test('sair zera a memória da falha — outro editor pode ter foto', () => {
  const logout = APP.slice(APP.indexOf('avatarPendente = null;   //'));
  assert.match(logout.slice(0, 300), /avatarFalhou = null/,
    'o logout não zera avatarFalhou: quem entrar depois herda a falha do anterior');
});

test('o registro da falha leva o HOST e nenhum dado de terceiro', () => {
  const lib = fatiarFuncao('liberarAvatar');
  assert.match(lib, /dfato\('avatar\.falhou'/, 'a falha não é registrada — a próxima só se investiga com HAR');
  // `dfato` é o anel SEM portão: entra o que é raro e não identifica ninguém.
  const chamada = lib.match(/dfato\('avatar\.falhou',\s*\{([^}]*)\}/);
  assert.ok(chamada, 'não consegui ler os campos do dfato do avatar');
  assert.match(chamada[1], /\bhost\b/, 'o registro não diz o host — que é justamente o que muda');
  for (const proibido of ['userName', 'creatorId', 'createdBy', 'url', 'src', 'id']) {
    assert.doesNotMatch(chamada[1], new RegExp('\\b' + proibido + '\\b'),
      `o registro da falha leva "${proibido}" — o dfato não carrega dado de terceiro`);
  }
});

test('o comentário do avatar no HTML não promete um peso que não é mais o de hoje', () => {
  // O comentário afirmava "214 KB (medido)" e "os mesmos 218 KB" — números do
  // host ANTIGO. Doc que promete o que não existe é pior que código morto.
  const i = HTML.indexOf('id="userAvatar"');
  assert.ok(i > 0, 'sumiu o #userAvatar');
  const comentario = HTML.slice(Math.max(0, i - 1400), i);
  assert.match(comentario, /fetchpriority/, 'não achei o comentário do avatar');
  assert.doesNotMatch(comentario, /214 KB \(medido\)/,
    'o comentário ainda cita 214 KB, que era o peso no host antigo');
  assert.match(comentario, /sms-profile-image\.waze\.com/,
    'o comentário não menciona o host de hoje');
});
