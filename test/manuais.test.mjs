// Os MANUAIS contra o que o código faz: o README (quem instala e confere a
// instalação) e o README da extensão (o protocolo que o @daflash publica). Frase
// de manual que não bate com o código é um passo que falha na mão de alguém —
// e sem erro nenhum no repositório (auditoria de 2026-09-29, T1, T2, A13, T4 e
// A14). Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const raiz = new URL('../', import.meta.url);
const ler = (p) => readFileSync(new URL(p, raiz), 'utf8');
const README = ler('README.md');
const EXT = ler('extensao-chrome/README.md');
const blocos = (md, lingua) => [...md.matchAll(new RegExp('```' + lingua + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]);

// ── README ───────────────────────────────────────────────────────────────────
// T1, MEDIDO rodando a VM como `nobody` (setpriv) num diretório criado pelo
// passo do README: com o `sudo mkdir -p`, o diretório fica do root (755), toda
// gravação de sessão falha e o `parear` responde 500 "Erro interno" (o login
// igual); com o dono certo, 200.
test('README, Opção B: o diretório das sessões é do usuário do serviço (senão todo login dá "Erro interno")', () => {
  const unidade = blocos(README, 'ini').find((b) => /ExecStart=.*server\/node\.mjs/.test(b));
  assert.ok(unidade, 'CONTROLE: a unidade systemd da Opção B sumiu do README');
  const usuario = (/^User=(\S+)$/m.exec(unidade) || [])[1];
  const dir = (/^Environment=SESSION_DIR=(\S+)$/m.exec(unidade) || [])[1];
  assert.ok(usuario && dir, 'CONTROLE: a unidade não diz o User= e o SESSION_DIR=');
  const comandos = blocos(README, 'bash').join('\n').split('\n').filter((l) => !/^\s*#/.test(l));
  const donos = [];
  for (const l of comandos) {
    const i = /\binstall\s+-d\s+-o\s+(\S+)\s+-g\s+\S+\s+-m\s+\S+\s+(\S+)/.exec(l);
    if (i) donos.push({ usuario: i[1], caminho: i[2], recursivo: false });
    const c = /\bchown\s+(-R\s+)?([^:\s]+)(?::\S+)?\s+(\S+)/.exec(l);
    if (c) donos.push({ usuario: c[2], caminho: c[3], recursivo: !!c[1] });
  }
  assert.ok(donos.some((d) => d.usuario === usuario
    && (d.caminho === dir || (d.recursivo && dir.startsWith(d.caminho.replace(/\/$/, '') + '/')))),
  `o README cria ${dir} sem dá-lo ao ${usuario} (o User= do serviço): criado pelo root, o ${usuario} não grava nele, e todo login e todo pareamento respondem "Erro interno"`);
});

// T2: o POST cru leva 403 do Bot Fight Mode do Cloudflare (MEDIDO em produção,
// ver o CLAUDE.md), e a tabela da conferência não tinha a linha do 403 — quem
// seguisse o README concluía que a API estava fora.
test('README: a conferência da API com curl passa pelo Bot Fight Mode, e o 403 dele está na tabela', () => {
  const curl = blocos(README, 'bash').find((b) => /\bcurl\b[\s\S]*\/api\/perfil/.test(b));
  assert.ok(curl, 'CONTROLE: a conferência da API sumiu do README');
  assert.match(curl, /\s-A\s+'Mozilla\/5\.0 [^']+'/,
    'o curl sai sem User-Agent de navegador: o Bot Fight Mode responde 403 antes de a API ver o pedido');
  assert.match(README, /^\| \*\*403\*\* \|[^\n]*Bot Fight Mode/m, 'a tabela da conferência não explica o 403 do Bot Fight Mode');
});

// A13: "invalida sessão local, volta pra tela de login" era o app de antes. Hoje
// a ação vai pra fila de saída, a sessão é CONFERIDA (401 muitas vezes é alarme
// falso) e a extensão renova em silêncio. A linha e o código, juntos.
test('README: a linha do `unauthorized` diz o que o app faz hoje — e o código faz o que ela diz', () => {
  const linha = (/^\| `unauthorized` \|[^\n]*$/m.exec(README) || [])[0];
  assert.ok(linha, 'CONTROLE: a tabela das categorias sumiu do README');
  assert.doesNotMatch(linha, /[Ii]nvalida (a )?sessão local/, 'a linha segue dizendo que o 401 derruba a sessão na hora');
  for (const termo of ['fila de saída', 'confere', 'extensão']) {
    assert.ok(linha.includes(termo), `a linha do unauthorized não fala de "${termo}"`);
  }
  const APP = ler('js/app.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const ini = APP.indexOf("if (cat === 'unauthorized') {", APP.indexOf('function handleActionResult('));
  assert.ok(ini > 0, 'CONTROLE: o ramo do 401 sumiu do handleActionResult');
  let prof = 0, fim = ini;
  for (let j = APP.indexOf('{', ini); j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}') { prof--; if (prof === 0) { fim = j; break; } }
  }
  const ramo = APP.slice(ini, fim);
  assert.match(ramo, /enfileirarSaida\(/, 'o README diz que a ação vai pra fila de saída, e o ramo do 401 não a enfileira');
  assert.match(ramo, /handleUnauthorized\(\)/, 'o README diz que a sessão é conferida, e o ramo do 401 não confere');
});

// ── A extensão ───────────────────────────────────────────────────────────────
// T4/A14: o protocolo do README não tinha o `conta` do `sessao`, e dizia que
// "nenhuma mudança de protocolo" tinha havido depois de duas. As respostas da
// ponte, lidas do CÓDIGO, e o que o README documenta.
test('extensão: o protocolo do README é o que a ponte manda — cada ação, campo e motivo', () => {
  const ponte = ler('extensao-chrome/ponte.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const chamadas = [...ponte.matchAll(/responder\(\{([\s\S]*?)\}\s*\)/g)].map((m) => m[1]);
  assert.ok(chamadas.length >= 5, `CONTROLE: só ${chamadas.length} respostas lidas da ponte — o recorte quebrou`);
  const protocolo = blocos(EXT, 'js').find((b) => b.includes("'wazeplaces-ext'"));
  assert.ok(protocolo, 'CONTROLE: o bloco do protocolo sumiu do README da extensão');
  const falta = [];
  for (const c of chamadas) {
    const acao = (/action:\s*'([^']+)'/.exec(c) || [])[1];
    assert.ok(acao, `CONTROLE: resposta da ponte sem action: ${c}`);
    if (!protocolo.includes(`action: '${acao}'`)) falta.push(`action '${acao}'`);
    // Os campos de cima (fora `action` e o `negado`, cujos campos vêm abaixo).
    const deCima = c.replace(/negado:\s*\{[^}]*\}/g, 'negado');
    for (const [, campo] of deCima.matchAll(/(?:^|[{,])\s*([a-zA-Z]+)\s*(?=[:,}]|$)/g)) {
      if (['action', 'motivo', 'negado'].includes(campo)) continue;
      if (!new RegExp(`action: '${acao}'[^\\n]*\\b${campo}\\b`).test(protocolo)) falta.push(`${acao}.${campo}`);
    }
    for (const [, lit] of (/motivo:\s*([^\n]*)/.exec(c) || ['', ''])[1].matchAll(/'([^']+)'/g)) {
      if (!EXT.includes('`' + lit + '`') && !protocolo.includes(`'${lit}'`)) falta.push(`motivo '${lit}'`);
    }
    const negado = /negado:\s*\{([^}]*)\}/.exec(c);
    if (negado) {
      for (const [, k] of negado[1].matchAll(/([a-zA-Z]+)\s*:/g)) {
        if (!new RegExp(`negado: \\{[^}]*\\b${k}\\b`).test(protocolo)) falta.push(`negado.${k}`);
      }
    }
  }
  assert.deepEqual(falta, [], 'o README da extensão não documenta o que a ponte manda');
  assert.ok(!/Nenhuma mudança de protocolo/.test(EXT), 'o README segue dizendo que o protocolo não mudou');
});

// O código que vai pra Web Store (tudo menos o README), sem comentário e sem a
// própria versão do manifesto: mudar comentário não pede publicação; mudar
// código pede. Linha a linha e sem arrancar bloco multilinha, porque o
// `'https://places.wazebrasil.com/*'` do background.js abriria um "bloco" e
// engoliria o resto do arquivo (gotcha #67.1).
function semComentarios(js) {
  const aspasOk = (s) => ['\'', '"', '`'].every((q) => (s.split(q).length - 1) % 2 === 0);
  return js.split('\n').map((l) => {
    if (/^\s*\/\//.test(l)) return '';
    l = l.replace(/\/\*(?:(?!\*\/).)*\*\//g, '');
    const m = /^(.*?[\s;,)])\/\/.*$/.exec(l);
    if (m && aspasOk(m[1])) return m[1].trimEnd();
    return l.trimEnd();
  }).filter((l) => l.trim() !== '').join('\n');
}
function hashDoCodigoDaExtensao() {
  const h = createHash('sha256');
  const dir = new URL('extensao-chrome/', raiz);
  for (const nome of readdirSync(dir).filter((n) => n !== 'README.md').sort()) {
    let conteudo = readFileSync(new URL(nome, dir));
    if (nome.endsWith('.js')) conteudo = Buffer.from(semComentarios(conteudo.toString('utf8')));
    else if (nome === 'manifest.json') {
      const m = JSON.parse(conteudo.toString('utf8'));
      delete m.version;
      conteudo = Buffer.from(JSON.stringify(m));
    }
    h.update(nome + '\0'); h.update(conteudo); h.update('\0');
  }
  return h.digest('hex');
}
// O código de cada versão, medido na história do git: 0.2.0 = e467f08 e
// e7135b0 (este só mudou comentário, e o hash é o mesmo — é o controle do
// normalizador); d85895e (o `negado`) e c6d9f91 (a `conta`) mudaram o código com
// o manifesto parado em 0.2.0, que é o defeito T4.
const CODIGO_POR_VERSAO = {
  '0.2.0': '70aa3ce409d9449234e3183bfc7f7f8f21b6e769e11431865915657c565144a2',
  '0.3.0': '7183aaef5597ed54d3c68ed709dab8659ba69cda22d6c306e789f3b25fa7f36e',
};
const semver = (v) => v.split('.').map(Number);
const antes = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

test('extensão: o código publicado muda JUNTO com a versão do manifesto — e o README diz qual é', () => {
  const man = JSON.parse(ler('extensao-chrome/manifest.json'));
  const h = hashDoCodigoDaExtensao();
  assert.ok(CODIGO_POR_VERSAO[man.version],
    `a versão ${man.version} não está no registro: registre o código dela — '${man.version}': '${h}'`);
  assert.equal(h, CODIGO_POR_VERSAO[man.version],
    `o código da extensão mudou e o manifesto seguiu em ${man.version}: quem tem a extensão publicada fica com o `
    + `comportamento velho, e nada diz que ela precisa ser publicada de novo. Suba a versão no manifest.json e `
    + `registre aqui: '<versão nova>': '${h}'`);
  const versoes = Object.keys(CODIGO_POR_VERSAO).sort(antes);
  assert.equal(versoes.at(-1), man.version, 'o manifesto voltou pra uma versão anterior à mais nova do registro');
  assert.equal(new Set(Object.values(CODIGO_POR_VERSAO)).size, versoes.length, 'duas versões com o MESMO código');
  const v = man.version.replace(/\./g, '\\.');
  assert.match(EXT, new RegExp(`^# .*\\bv${v}\\b`, 'm'), 'o título do README da extensão não é a versão do manifesto');
  assert.match(EXT, new RegExp(`^## v${v}\\b`, 'm'), 'o README da extensão não tem a seção da versão do manifesto (o que mudou nela)');
});

test('extensão: CONTROLE do normalizador — comentário não conta, código conta, URL em texto fica', () => {
  assert.equal(semComentarios('a(); // um\n// dois\nb();'), semComentarios('a(); // outro\nb(); /* três */'));
  assert.notEqual(semComentarios('a();'), semComentarios('b();'));
  assert.equal(semComentarios("const u = 'https://x.com/*';"), "const u = 'https://x.com/*';");
  assert.equal(semComentarios("x = '// não é comentário';"), "x = '// não é comentário';");
});
