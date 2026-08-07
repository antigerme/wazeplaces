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
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
      try { await fetch(`http://127.0.0.1:${porta}/`); break; } catch { await new Promise((k) => setTimeout(k, 100)); }
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

  const { token, arquivos } = await comServidor(dir, 8351, async (api) => {
    const s = await api('sessao', { action: 'create', cookies: COOKIES });
    assert.equal(s.success, true, 'não deu pra criar a sessão de teste');
    const par = await api('parear', { action: 'create', sessionToken: s.sessionToken });
    assert.ok(par.code, 'não deu pra criar o pareamento de teste');
    return { token: s.sessionToken, arquivos: await readdir(dir) };
  });

  assert.equal(arquivos.length, 2, 'esperava sessão + pareamento no disco');
  const doPar = arquivos.filter((n) => n.startsWith('sess_pair_'));
  assert.equal(doPar.length, 1, 'o pareamento precisa ser reconhecível pelo NOME — é isso que a varredura usa');

  // Envelhece o pareamento à força pra não depender de esperar 5 minutos.
  const f = join(dir, doPar[0]);
  const v = await readFile(f, 'utf8');
  await writeFile(f, String(Math.floor(Date.now() / 1000) - 10) + v.slice(v.indexOf('|')));

  // Um segundo processo no MESMO diretório: a varredura roda no boot dele.
  await comServidor(dir, 8352, async (api) => {
    const depois = await readdir(dir);
    assert.equal(depois.filter((n) => n.startsWith('sess_pair_')).length, 0,
      'pareamento vencido tinha que sair — ele vale 5 min, não 21 dias');
    assert.equal(depois.filter((n) => n.startsWith('sess_') && !n.startsWith('sess_pair_')).length, 1,
      'a SESSÃO não pode ser apagada pela varredura');

    // E ela tem que seguir funcionando de verdade, não só existir no disco.
    const r = await api('perfil', { sessionToken: token, region: 'row' });
    assert.notEqual(r.errorKey, 'srv.err.sessionExpired',
      'a sessão sobreviveu no disco mas parou de valer — a varredura corrompeu algo');
  });
});
