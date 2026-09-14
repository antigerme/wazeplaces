// A foto de perfil é de TERCEIRO, e ela já sumiu uma vez.
//
// O caso (v2026.09.14-01, relatado pelo owner com print do iPhone): o Waze
// mudou o endereço da foto de `social-row.waze.com/SocialMediaServer/images/
// profile/<id>` pra `sms-profile-image.waze.com/<id>`. O host novo não estava
// na CSP, então o navegador BLOQUEOU a imagem antes da rede — medido no HAR
// dele: status 0 em 0,06 ms, sem IP de servidor (uma requisição que sai de
// verdade e falha leva ~25 ms, que é o que o beacon bloqueado do mesmo HAR
// mostra). O `<img>` sem tratamento de erro então desenhou o ícone de imagem
// quebrada dentro do círculo do cabeçalho, em toda tela da app.
//
// São DUAS coisas separadas, e por isso dois blocos de teste:
//   1. o host de hoje está nas TRÊS cópias da CSP (conserta ESTE endereço);
//   2. quando a foto falhar — por CSP, 404, host fora do ar ou rede caída — a
//      app degrada pro estado "perfil sem foto" que ela JÁ tinha, em vez do
//      ícone de quebrado. Isto é o que sobrevive à PRÓXIMA mudança de host,
//      que o Waze não vai avisar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Âncora em DECLARAÇÃO, nunca em distância (gotcha #67).
function fatiarFuncao(nome) {
  const ini = APP.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu do app.js`);
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:async function |function |const |let |\/\/ ──|\/\/ ═)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return APP.slice(ini, ini + 1 + fim);
}

// A CSP se extrai pela ESTRUTURA de cada arquivo, nunca por `img-src` solto: os
// comentários acima da meta e do `const CSP` CITAM a diretiva, e um grep frouxo
// casa com o comentário e deixa a sabotagem passar (gotcha #14).
function cspDe(arquivo) {
  const txt = readFileSync(new URL('../' + arquivo, import.meta.url), 'utf8');
  const m = arquivo === 'index.html'
    ? txt.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)
    : arquivo === '_headers'
      ? txt.match(/^\s*Content-Security-Policy:\s*(.+)$/m)
      : txt.match(/^const CSP = "([^"]*)"/m);
  assert.ok(m, `${arquivo}: não achei a CSP pela estrutura do arquivo`);
  return m[1];
}

// ── 1. O HOST DE HOJE ──────────────────────────────────────────────────────
test('img-src libera o host da foto de perfil nas TRÊS cópias da CSP', () => {
  // O host ANTIGO fica junto de propósito: ele continua servindo (medido, 200 +
  // 218 KB no mesmo id) e sessão aberta antes da mudança ainda carrega a URL
  // velha. Tirar um pra pôr o outro reabriria o defeito pra quem não recarregou.
  const HOSTS = ['https://sms-profile-image.waze.com', 'https://social-row.waze.com'];
  for (const arquivo of ['index.html', '_headers', 'server/node.mjs']) {
    const img = cspDe(arquivo).match(/img-src([^;]*)/);
    assert.ok(img, `${arquivo}: CSP sem diretiva img-src`);
    for (const host of HOSTS) {
      assert.ok(img[1].includes(host + ' ') || img[1].trim().endsWith(host),
        `${arquivo}: img-src sem ${host} — a foto de perfil é bloqueada antes da rede`);
    }
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
