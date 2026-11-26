// O PALCO (js/palco.js): o que é puro, e a paridade com o app e com o servidor.
// Cada regra foi vista REPROVANDO com a sabotagem (gotcha #28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { maioriaDe as maioriaDoServidor } from '../server/demo-resultado.mjs';
import { SALA_RECADO_MAX } from '../server/demo-sala.mjs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const fonte = ler('js/palco.js');
const demoFonte = ler('js/demo.js');
const app = ler('js/app.js');
const janela = {};
vm.runInNewContext(fonte, { window: janela });
const P = janela.PalcoPuro;
const demo = {};
vm.runInNewContext(ler('js/demo-fluxo.js'), { window: demo });
vm.runInNewContext(demoFonte, { window: demo, crypto: globalThis.crypto, btoa: globalThis.btoa });

test('o palco expõe as funções puras sem tocar no DOM', () => {
  assert.ok(P && typeof P.acaoPrincipal === 'function' && typeof P.esc === 'function');
});

// ── a ação principal e o teclado ────────────────────────────────────────────
const V = (o) => ({ fase: 'andamento', modo: 'sinc', total: 3, atual: 1, revelado: false, naSala: 5, ...o });

test('acaoPrincipal: começa no saguão (com gente), revela, passa, e o último «próximo» encerra', () => {
  assert.deepEqual({ ...P.acaoPrincipal(V({ fase: 'saguao', naSala: 2 })) }, { tipo: 'comecar' });
  assert.equal(P.acaoPrincipal(V({ fase: 'saguao', naSala: 0 })), null, 'sem ninguém não começa');
  assert.deepEqual({ ...P.acaoPrincipal(V({})) }, { tipo: 'revelar' });
  assert.deepEqual({ ...P.acaoPrincipal(V({ revelado: true })) }, { tipo: 'proximo', ultimo: false });
  assert.deepEqual({ ...P.acaoPrincipal(V({ revelado: true, atual: 3 })) }, { tipo: 'proximo', ultimo: true });
  assert.deepEqual({ ...P.acaoPrincipal(V({ fase: 'pausada' })) }, { tipo: 'retomar' });
  assert.equal(P.acaoPrincipal(V({ modo: 'livre' })), null, 'no livre nenhuma tecla encerra: encerrar tem confirmação');
  assert.equal(P.acaoPrincipal(V({ fase: 'encerrada' })), null);
  assert.equal(P.acaoPrincipal(null), null);
});

test('acaoDaTecla: Espaço, → e Enter são a principal; P pausa e retoma; R abre o recado; 1 2 3 votam a referência', () => {
  for (const k of [' ', 'ArrowRight', 'Enter']) assert.deepEqual({ ...P.acaoDaTecla(k, V({})) }, { tipo: 'revelar' }, k);
  // O passador de slides (clicker) manda PageDown/PageUp: PageDown avança, PageUp não faz nada (não há voltar).
  assert.deepEqual({ ...P.acaoDaTecla('PageDown', V({})) }, { tipo: 'revelar' });
  assert.equal(P.acaoDaTecla('PageUp', V({})), null);
  assert.deepEqual({ ...P.acaoDaTecla('p', V({})) }, { tipo: 'pausar' });
  assert.deepEqual({ ...P.acaoDaTecla('P', V({ fase: 'pausada' })) }, { tipo: 'retomar' });
  assert.equal(P.acaoDaTecla('p', V({ fase: 'saguao' })), null, 'não se pausa o saguão');
  assert.deepEqual({ ...P.acaoDaTecla('r', V({ fase: 'saguao' })) }, { tipo: 'recado' });
  assert.equal(P.acaoDaTecla('r', V({ fase: 'encerrada' })), null);
  assert.deepEqual({ ...P.acaoDaTecla('1', V({})) }, { tipo: 'votarRef', voto: 'R' });
  assert.deepEqual({ ...P.acaoDaTecla('2', V({})) }, { tipo: 'votarRef', voto: 'P' }, '2 é «pular» (↑), a ordem dos botões ✕ ↑ ✓');
  assert.deepEqual({ ...P.acaoDaTecla('3', V({})) }, { tipo: 'votarRef', voto: 'L' });
  assert.equal(P.acaoDaTecla('x', V({})), null);
});

test('telaDaVisao: cada fase tem a sua tela; chave ausente e erro vencem a visão', () => {
  assert.equal(P.telaDaVisao(null, 'abrindo'), 'abrindo');
  assert.equal(P.telaDaVisao(V({}), 'semChave'), 'semChave');
  assert.equal(P.telaDaVisao(V({}), 'erro'), 'erro');
  assert.equal(P.telaDaVisao(V({ fase: 'saguao' }), 'ok'), 'saguao');
  assert.equal(P.telaDaVisao(V({ fase: 'contagem' }), 'ok'), 'contagem');
  assert.equal(P.telaDaVisao(V({}), 'ok'), 'sinc');
  assert.equal(P.telaDaVisao(V({ modo: 'livre' }), 'ok'), 'livre');
  assert.equal(P.telaDaVisao(V({ fase: 'pausada', modo: 'livre' }), 'ok'), 'livre', 'pausada segue na tela do modo');
  assert.equal(P.telaDaVisao(V({ fase: 'encerrada' }), 'ok'), 'fim');
});

test('refNoPedido: «-» não votou, «*» votou (escondido), letra = revelado', () => {
  assert.equal(P.refNoPedido({ ref: '*-R' }, 1), '*');
  assert.equal(P.refNoPedido({ ref: '*-R' }, 2), '-');
  assert.equal(P.refNoPedido({ ref: '*-R' }, 3), 'R');
  assert.equal(P.refNoPedido({ ref: null }, 1), '-');
  assert.equal(P.refNoPedido(null, 1), '-');
});

// ── os números ──────────────────────────────────────────────────────────────
test('maioriaDe do palco é a do servidor (o palco calcula ao vivo; o servidor, no resultado)', () => {
  for (const c of [{ R: 3, L: 1, P: 0 }, { R: 2, L: 2, P: 0 }, { R: 0, L: 0, P: 0 }, { R: 1, L: 1, P: 1 }, { R: 0, L: 4, P: 4 }, { R: 0, L: 0, P: 2 }]) {
    assert.equal(P.maioriaDe(c), maioriaDoServidor(c), JSON.stringify(c));
  }
});

test('partesDaDuracao: segundos, minutos e segundos, ou horas e minutos', () => {
  assert.deepEqual({ ...P.partesDaDuracao(9_400) }, { h: 0, m: 0, s: 9, forma: 's' });
  assert.deepEqual({ ...P.partesDaDuracao(252_000) }, { h: 0, m: 4, s: 12, forma: 'ms' });
  assert.deepEqual({ ...P.partesDaDuracao(4_200_000) }, { h: 1, m: 10, s: 0, forma: 'hm' });
  assert.deepEqual({ ...P.partesDaDuracao(-5) }, { h: 0, m: 0, s: 0, forma: 's' });
});

test('ordenarPedidos: demo, mais unânimes, mais divididos — e o desempate é o número do pedido', () => {
  const l = [{ topo: 0.5, n: 10 }, { topo: 0.9, n: 10 }, { topo: 0.9, n: 10 }, { topo: 0.7, n: 3 }];
  assert.deepEqual(P.ordenarPedidos(l, 'ordem').map((p) => p.idx), [1, 2, 3, 4]);
  assert.deepEqual(P.ordenarPedidos(l, 'unanimes').map((p) => p.idx), [2, 3, 4, 1]);
  assert.deepEqual(P.ordenarPedidos(l, 'divididos').map((p) => p.idx), [1, 4, 2, 3]);
});

test('listaDeAvanco: os mais adiantados primeiro, e «e outros N»', () => {
  const g = Array.from({ length: 30 }, (_, i) => ({ nome: 'p' + i, feitos: i }));
  const { vistas, outros } = P.listaDeAvanco(g, 12);
  assert.equal(vistas.length, 12);
  assert.equal(vistas[0].feitos, 29);
  assert.equal(outros, 18);
});

test('esc: o apelido do convidado nunca vira HTML', () => {
  assert.equal(P.esc('<img src=x onerror=1>"\'&'), '&lt;img src=x onerror=1&gt;&quot;&#39;&amp;');
  assert.equal(P.esc(null), '');
  assert.equal(P.esc(0), '0');
});

// ── paridade ────────────────────────────────────────────────────────────────
test('paridade: a chave do aparelho é a que o app grava, e o teto do recado é o do servidor', () => {
  const noApp = /^const DEMO_PALCO_KEY = '([^']+)';/m.exec(app)[1];
  assert.equal(P.CHAVE_DO_PALCO, noApp);
  assert.equal(P.RECADO_MAX, SALA_RECADO_MAX);
  assert.equal(P.COORD_CASAS, Number(/^const COORD_CASAS = (\d+);/m.exec(app)[1]), 'o ↗ do palco arredonda como o do app');
});

test('o código curto sai no formato que o campo da página /demo aceita', () => {
  for (const bruto of ['k7q2m9', 'K7Q-2M9', ' k7 q2 m9 ', 'K7Q2M9XYZ', 'k7', '', null]) {
    assert.equal(P.formatarCodigo(bruto), demo.DemoPuro.formatarCodigo(bruto), String(bruto));
  }
});

test('o ↗ do palco é o MESMO permalink do app (linkWmeDoPedido), com o id real', () => {
  const corpo = (() => {
    const i = app.indexOf('function linkWmeDoPedido(');
    let prof = 0;
    for (let j = app.indexOf('{', i); j < app.length; j++) { if (app[j] === '{') prof++; else if (app[j] === '}' && --prof === 0) return app.slice(i, j + 1); }
    throw new Error('não fechou');
  })();
  const doApp = new Function('WME_EDITOR_URL', 'COORD_CASAS', 'coordDoLink', corpo + '\nreturn linkWmeDoPedido;')(
    'https://www.waze.com/editor', 5, (n) => Number(n.toFixed(5)));
  for (const [ped, regiao] of [
    [{ lat: -22.308091234, lon: -42.52281234, venueID: '123.456.789' }, 'row'],
    [{ lat: 0, lon: 0, venueID: 'a/b' }, 'row'],
    [{ lat: 40.7, lon: -74.0, venueID: '9' }, 'na'],
    [{ venueID: '9' }, 'il'],
  ]) {
    assert.equal(P.linkDoWme(ped, { venueID: ped.venueID }, regiao), doApp({ ...ped }, regiao), JSON.stringify(ped));
  }
  // Latitude 0 é Macapá, longitude 0 é Greenwich: não cai fora (a regra do app).
  assert.ok(/lat=0&lon=0/.test(P.linkDoWme({ lat: 0, lon: 0 }, null, 'row')));
  assert.ok(!/venues=/.test(P.linkDoWme({ lat: 1, lon: 1 }, null, 'row')), 'sem id real não há seleção');
});

test('toda chave T(\'palco.…\') existe no dicionário, nas quatro línguas', () => {
  const dic = {};
  vm.runInNewContext(ler('js/i18n.js') + '\nglobalThis.__d = I18N_DICT;', dic);
  // As montadas por prefixo («palco.premio.» + a chave do prêmio) saem daqui e entram no laço dos prêmios, mais abaixo.
  const chaves = new Set([...fonte.matchAll(/\bT\('([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.')));
  const html = ler('palco.src.html');
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) chaves.add(m[1]);
  assert.ok(chaves.size > 60, 'o varredor não achou as chaves: instrumento errado');
  const faltam = [];
  for (const lg of ['pt', 'en', 'es', 'fr']) for (const k of chaves) if (!dic.__d[lg][k]) faltam.push(lg + ':' + k);
  assert.deepEqual(faltam, []);
  // As chaves montadas (prêmios): uma por prêmio que o servidor sabe dar, mais o detalhe.
  for (const lg of ['pt', 'en', 'es', 'fr']) for (const c of ['menteColetiva', 'almaIndependente', 'gatilho', 'coracaoMole', 'cauteloso', 'maisRapido']) {
    assert.ok(dic.__d[lg]['palco.premio.' + c] && dic.__d[lg]['palco.premio.' + c + '.d'], `${lg}: falta o prêmio ${c}`);
  }
});

// ── o que o palco NÃO pode ter ──────────────────────────────────────────────
test('o palco não tem script inline, não lê a chave pra tela e não a manda por URL', () => {
  const html = ler('palco.src.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.equal([...html.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/\bsrc=/.test(m[1])).length, 0, 'script inline: a CSP o bloquearia em silêncio');
  const sem = fonte.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/location\.(hash|search)|history\.(push|replace)State/.test(sem), 'a chave não pode ir pra URL (o endereço aparece no projetor)');
  assert.ok(!/textContent\s*=\s*[^;]*hostKey|innerHTML\s*=\s*[^;]*hostKey|esc\([^)]*hostKey/.test(sem), 'a hostKey foi escrita na tela');
  assert.ok(!/console\.\w+\([^)]*(hostKey|chave)/.test(sem), 'a chave foi pro console');
  assert.ok(!/EventSource/.test(sem));
});

test('todo texto de convidado que vai a innerHTML passa por esc() (apelido, país, nome do pedido)', () => {
  const sem = fonte.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const campo of ['p.nome', 'p.pais', 'titulo', 'p.address', 'nome\\)']) {
    const soltos = [...sem.matchAll(new RegExp("\\+\\s*" + campo + "\\s*\\+", 'g'))];
    assert.equal(soltos.length, 0, `${campo} concatenado sem esc()`);
  }
  assert.ok(/esc\(p\.nome\)/.test(sem) && /esc\(p\.pais\)/.test(sem), 'o apelido e o país precisam passar por esc()');
});

test('a ação do palco não manda a divisão do voto escolhido pra tela antes da revelação (o texto da confirmação é neutro)', () => {
  assert.ok(/<span aria-hidden="true">●<\/span> ' \+ esc\(T\('palco\.ref\.registrada'\)\)/.test(fonte), 'a confirmação deixou de ser neutra (● em vez de ✓/✕/↑)');
});
