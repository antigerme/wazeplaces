// A VM guarda a chave auto-gerada (e as sessões) num diretório de ESTADO, nunca no /tmp.
// Motivo (2026-10-20, endurecimento da infra): o /tmp é limpo no boot por muitas distros e esvaziado
// a cada reinício do serviço pelo `PrivateTmp` do systemd — perder a chave desloga todo mundo, calado.
// Onde fica: $STATE_DIRECTORY (o `StateDirectory=` do systemd) ou ~/.waze-places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subirVM } from './_vm.mjs';

const semChaveNemSessoes = { ENCRYPTION_KEY: '', SESSION_DIR: '', SESSION_KEY_FILE: '' };

test('VM: com STATE_DIRECTORY, a chave auto-gerada nasce lá dentro, com modo 0600', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp-estado-'));
  const vm = await subirVM({ ...semChaveNemSessoes, STATE_DIRECTORY: dir, HOME: join(dir, 'casa-que-nao-deve-ser-usada') });
  try {
    const chave = join(dir, 'chave');
    assert.ok(existsSync(chave), 'a chave não foi criada no STATE_DIRECTORY');
    assert.equal(statSync(chave).mode & 0o777, 0o600, 'a chave precisa ser só do dono');
    assert.ok(Buffer.from(readFileSync(chave, 'utf8'), 'base64').length >= 32, 'chave curta demais');
    assert.equal(existsSync(join(dir, 'casa-que-nao-deve-ser-usada')), false, 'com STATE_DIRECTORY a VM não podia tocar no HOME');
  } finally { vm.parar(); rmSync(dir, { recursive: true, force: true }); }
});

test('VM: sem STATE_DIRECTORY, a chave nasce em ~/.waze-places (e não no /tmp)', async () => {
  const casa = mkdtempSync(join(tmpdir(), 'wp-casa-'));
  const vm = await subirVM({ ...semChaveNemSessoes, STATE_DIRECTORY: '', HOME: casa });
  try {
    const chave = join(casa, '.waze-places', 'chave');
    assert.ok(existsSync(chave), 'a chave não foi criada em ~/.waze-places');
    assert.equal(statSync(join(casa, '.waze-places')).mode & 0o777, 0o700, 'o diretório de estado precisa ser só do dono');
  } finally { vm.parar(); rmSync(casa, { recursive: true, force: true }); }
});

test('VM: o fonte do adaptador não volta a usar o /tmp como padrão', () => {
  const fonte = readFileSync(new URL('../server/node.mjs', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.equal(/\btmpdir\s*\(/.test(fonte), false, 'o node.mjs voltou a chamar tmpdir() — o padrão não pode ser o /tmp');
});
