// A varredura de sessões da VM (`gcSessions` em server/node.mjs) apaga o que
// deve e SÓ o que deve.
//
// Existe porque o adaptador de arquivo não tem TTL nativo: sem varrer, quem
// nunca mais volta deixa o blob no disco pra sempre. Mas o critério dela já
// esteve errado de um jeito que nenhum teste do core pegaria — ela é do
// ADAPTADOR, e o `node --test` só exercitava o core.
//
// O defeito medido (v2026.08.07-01): o corte lia `<unix>|` do valor e apagava
// se aquele instante já tinha passado. Isso valia quando só o PAREAMENTO tinha
// carimbo, porque lá o número é a expiração (futuro). A sessão ganhou carimbo
// depois (janela deslizante) e nela o número é o ÚLTIMO USO — sempre passado.
// Resultado: toda sessão válida sumia no primeiro boot. Hoje o pareamento é
// reconhecível pelo NOME (`sess_pair_`), que é o sinal que faltava.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, utimes } from 'node:fs/promises';
import { makeSessions } from '../server/core.mjs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as dormir } from 'node:timers/promises';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const COOKIES = ['_web_session', '_csrf_token']
  .map((n) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${n}\tvalor-de-teste`).join('\n');

async function comServidor(dir, porta, fn) {
  const p = spawn(process.execPath, [join(RAIZ, 'server', 'node.mjs')], {
    env: {
      ...process.env, PORT: String(porta), HOST: '127.0.0.1', SESSION_DIR: dir,
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
    stdio: 'ignore',
  });
  try {
    // Espera o boot em vez de dormir um número fixo: sleep curto demais mede o
    // servidor que ainda não subiu, e longo demais é imposto no CI inteiro.
    for (let i = 0; i < 60; i++) {
      try { await fetch(`http://127.0.0.1:${porta}/`); break; } catch { await dormir(100); }
    }
    return await fn(async (nome, corpo) => (await fetch(`http://127.0.0.1:${porta}/api/${nome}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
    })).json());
  } finally {
    p.kill();
  }
}

test('varredura da VM: preserva sessão viva e apaga pareamento vencido', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wp-gc-'));

  // A sessão nasce direto no disco, com a MESMA chave e o MESMO nome de arquivo
  // que o adaptador usa: a rota que criava sessão de cookies crus (`sessao`
  // com `create`) era o furo do portão e saiu. Entrar pelo `testar-cookies`
  // exigiria o Waze de verdade.
  const sessoes = makeSessions({
    store: {
      get: async (h) => { try { return await readFile(join(dir, 'sess_' + h), 'utf8'); } catch { return null; } },
      put: async (h, v) => { await writeFile(join(dir, 'sess_' + h), v, { mode: 0o600 }); },
      delete: async () => {},
    },
    keyBytes: new Uint8Array(32).fill(7),
  });
  const token = await sessoes.createSession(COOKIES);
  // O cache da releitura do excluir-foto (`reler_…`) vale 15 s: um VELHO tem
  // que sair na varredura, e não ficar os 21 dias de uma sessão.
  const relerVelho = join(dir, 'sess_reler_' + 'a'.repeat(64));
  await writeFile(relerVelho, '1|{}');
  const umaHoraAtras = new Date(Date.now() - 3600 * 1000);
  await utimes(relerVelho, umaHoraAtras, umaHoraAtras);

  const { arquivos } = await comServidor(dir, 8351, async (api) => {
    const par = await api('parear', { action: 'create', sessionToken: token });
    assert.ok(par.code, 'não deu pra criar o pareamento de teste');
    return { arquivos: await readdir(dir) };
  });

  assert.equal(arquivos.filter((n) => !n.startsWith('sess_reler_')).length, 2, 'esperava sessão + pareamento no disco');
  const doPar = arquivos.filter((n) => n.startsWith('sess_pair_'));
  assert.equal(doPar.length, 1, 'o pareamento precisa ser reconhecível pelo NOME — é isso que a varredura usa');

  // Envelhece o pareamento à força pra não depender de esperar 5 minutos.
  const f = join(dir, doPar[0]);
  const v = await readFile(f, 'utf8');
  await writeFile(f, String(Math.floor(Date.now() / 1000) - 10) + v.slice(v.indexOf('|')));

  // Um segundo processo no MESMO diretório: a varredura roda no boot dele.
  await comServidor(dir, 8352, async (api) => {
    // A varredura roda no boot SEM `await` (de propósito: não se atrasa o boot
    // por causa de faxina), então o servidor já atende enquanto ela trabalha.
    // Ler o diretório na hora é uma corrida — aqui ela nunca se perde, e no
    // runner do CI se perdeu. Espera o efeito acontecer, com prazo e mensagem.
    const ate = Date.now() + 10000;
    let depois = await readdir(dir);
    while (depois.some((n) => n.startsWith('sess_pair_')) && Date.now() < ate) {
      await dormir(100);
      depois = await readdir(dir);
    }
    assert.equal(depois.filter((n) => n.startsWith('sess_pair_')).length, 0,
      'pareamento vencido tinha que sair em até 10s — ele vale 5 min, não 21 dias');
    assert.equal(depois.filter((n) => n.startsWith('sess_') && !n.startsWith('sess_pair_') && !n.startsWith('sess_reler_')).length, 1,
      'a SESSÃO não pode ser apagada pela varredura');
    assert.equal(depois.filter((n) => n.startsWith('sess_reler_')).length, 0,
      'o cache da releitura de 1 h atrás seguiu no disco — ele vale 15 s, não 21 dias');

    // E ela tem que seguir funcionando de verdade, não só existir no disco.
    const r = await api('perfil', { sessionToken: token, region: 'row' });
    assert.notEqual(r.errorKey, 'srv.err.sessionExpired',
      'a sessão sobreviveu no disco mas parou de valer — a varredura corrompeu algo');
  });
});

// A gravação da sessão na VM é ATÔMICA (temporário + rename): um processo
// derrubado no meio da escrita deixava a sessão truncada — que não decifra, é
// apagada e desloga a pessoa (auditoria de 2026-09-25). E o temporário que
// sobrar de uma queda sai na varredura.
test('VM: a sessão é gravada inteira (temporário + rename), e o temporário velho sai na varredura', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wp-atom-'));
  const tmpVelho = join(dir, '.tmp_' + 'b'.repeat(64) + '_123_abcd');
  await writeFile(tmpVelho, 'lixo');
  const umaHoraAtras = new Date(Date.now() - 3600 * 1000);
  await utimes(tmpVelho, umaHoraAtras, umaHoraAtras);
  const sessoes = makeSessions({
    store: {
      get: async (h) => { try { return await readFile(join(dir, 'sess_' + h), 'utf8'); } catch { return null; } },
      put: async (h, v) => { await writeFile(join(dir, 'sess_' + h), v, { mode: 0o600 }); },
      delete: async () => {},
    },
    keyBytes: new Uint8Array(32).fill(7),
  });
  const token = await sessoes.createSession(COOKIES);
  await comServidor(dir, 8353, async (api) => {
    // O pareamento GRAVA pelo `put` do adaptador — é a escrita que se mede.
    const par = await api('parear', { action: 'create', sessionToken: token });
    assert.ok(par.code, 'não deu pra criar o pareamento de teste');
    const ate = Date.now() + 10000;
    let nomes = await readdir(dir);
    while (nomes.includes(tmpVelho.split('/').pop()) && Date.now() < ate) { await dormir(100); nomes = await readdir(dir); }
    assert.ok(!nomes.includes(tmpVelho.split('/').pop()), 'o temporário velho de uma queda seguiu no disco');
    assert.ok(!nomes.some((n) => n.startsWith('.tmp_')), 'a gravação deixou temporário pra trás');
    assert.ok(nomes.some((n) => n.startsWith('sess_pair_')), 'o pareamento não foi gravado');
  });
  const fonte = await readFile(join(RAIZ, 'server', 'node.mjs'), 'utf8');
  const put = fonte.slice(fonte.indexOf('  async put(hash, blob, ttl) {'), fonte.indexOf('  async delete(hash) {'));
  assert.match(put, /await writeFile\(temp,[\s\S]*await rename\(temp, final\)/, 'a gravação voltou a escrever direto no arquivo final');
});

// O prazo CURTO que o core pede no `put` (a lista de fotos do excluir-foto,
// 1 min; o pareamento, 5 min) é cumprido pelo KV no Cloudflare, e na VM ficava
// pra varredura de hora em hora: a lista de fotos da lixeira seguia no disco
// por até ~70 min, com a Ajuda prometendo 1 (auditoria de 2026-09-26).
const FONTE_NODE = await readFile(join(RAIZ, 'server', 'node.mjs'), 'utf8');
function fatiarNode(nome) {
  const ini = FONTE_NODE.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, 'sumiu o ' + nome + ' do adaptador da VM');
  const abre = FONTE_NODE.indexOf('{', FONTE_NODE.indexOf(')', ini));
  let n = 0;
  for (let i = abre; i < FONTE_NODE.length; i++) {
    if (FONTE_NODE[i] === '{') n++;
    else if (FONTE_NODE[i] === '}' && --n === 0) return FONTE_NODE.slice(ini, i + 1);
  }
  throw new Error('fatiar: chaves desbalanceadas em ' + nome);
}

test('VM: o relógio do prazo curto apaga no prazo — e não apaga a gravação MAIS NOVA na mesma chave', () => {
  const montar = () => {
    const relogios = [];
    const apagados = [];
    let agora = 1000;
    const apagarNoPrazo = new Function('prazosCurtos', 'setTimeout', 'unlink', 'Date',
      fatiarNode('apagarNoPrazo') + '\nreturn apagarNoPrazo;')(
      new Map(),
      (fn, ms) => { relogios.push({ fn, quando: agora + ms }); return { unref() {} }; },
      async (f) => { apagados.push(f); },
      { now: () => agora });
    const avancar = (ate) => {
      agora = ate;
      for (const r of relogios.filter((x) => !x.feito && x.quando <= ate)) { r.feito = true; r.fn(); }
    };
    return { apagarNoPrazo, apagados, avancar, relogios };
  };

  // CONTROLE: uma gravação só sai no prazo dela, e não antes.
  const a = montar();
  a.apagarNoPrazo('/s/sess_reler_x', 61000);
  a.avancar(30000);
  assert.deepEqual(a.apagados, [], 'apagou antes do prazo');
  a.avancar(61100);
  assert.deepEqual(a.apagados, ['/s/sess_reler_x'], 'a gravação de prazo curto não saiu no prazo');

  // A gravação mais nova na MESMA chave empurra o prazo: o relógio da
  // anterior dispara e não pode apagá-la.
  const b = montar();
  b.apagarNoPrazo('/s/sess_reler_y', 61000);
  b.avancar(40000);
  b.apagarNoPrazo('/s/sess_reler_y', 100000);
  b.avancar(61100);
  assert.deepEqual(b.apagados, [], 'o relógio da gravação ANTERIOR apagou a mais nova');
  b.avancar(100100);
  assert.deepEqual(b.apagados, ['/s/sess_reler_y'], 'a gravação mais nova não saiu no prazo dela');

  // E quem registra o prazo é o `put` do adaptador, só pro que vale pouco:
  // sessão (21 dias) segue com a varredura, e a gravação longa numa chave
  // esquece o prazo curto que houvesse.
  const put = FONTE_NODE.slice(FONTE_NODE.indexOf('  async put(hash, blob, ttl) {'), FONTE_NODE.indexOf('  async delete(hash) {'));
  assert.match(put, /Number\(ttl\) <= PRAZO_CURTO_MAX_S\) apagarNoPrazo\(final, Date\.now\(\) \+ Number\(ttl\) \* 1000\)/,
    'o put deixou de registrar o prazo curto que o core pede');
  assert.match(put, /else prazosCurtos\.delete\(final\)/, 'gravação longa não esquece o prazo curto anterior');
});

test('VM: a lista de fotos relida que sobra de um reinício sai no minuto dela, não na próxima varredura', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wp-reler-'));
  const agoraS = Math.floor(Date.now() / 1000);
  // Lida no Waze há 57 s: faltam ~3 s pro minuto que a Ajuda promete.
  const quase = join(dir, 'sess_reler_' + 'c'.repeat(64));
  await writeFile(quase, (agoraS - 57) + '|{"id":"1","images":[]}');
  // CONTROLE: lida agora — tem que seguir no disco quando a de cima sair,
  // senão "sumiu" só quer dizer que a varredura apaga toda releitura.
  const nova = join(dir, 'sess_reler_' + 'd'.repeat(64));
  await writeFile(nova, agoraS + '|{"id":"2","images":[]}');
  await comServidor(dir, 8354, async () => {
    const ate = Date.now() + 15000;
    let nomes = await readdir(dir);
    while (nomes.includes(quase.split('/').pop()) && Date.now() < ate) { await dormir(100); nomes = await readdir(dir); }
    assert.ok(!nomes.includes(quase.split('/').pop()),
      'a lista de fotos lida há 57 s seguiu no disco depois do minuto — a Ajuda promete até 1 minuto');
    assert.ok(nomes.includes(nova.split('/').pop()),
      'a lista de fotos lida AGORA sumiu junto — a varredura está apagando toda releitura, não a vencida');
  });
});
