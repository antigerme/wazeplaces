// Auditoria da versão — trava a paridade e o formato do serial de zona DNS.
// Fonte única: js/version.js (APP_VERSION). O service-worker.js DEVE usar o MESMO
// serial em CACHE_NAME ('waze-places-<serial>'). Bump = mexer nos dois juntos; se
// esquecer um, este teste falha (roda no CI). Formato: YYYYMMDDnn (RFC 1912).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function serialFromVersionJs() {
  const m = read('js/version.js').match(/APP_VERSION\s*=\s*['"](\d+)['"]/);
  return m ? m[1] : null;
}
function serialFromServiceWorker() {
  const m = read('service-worker.js').match(/CACHE_NAME\s*=\s*['"]waze-places-(\d+)['"]/);
  return m ? m[1] : null;
}

function isValidSerial(s) {
  if (!/^\d{10}$/.test(String(s))) return false;
  const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8), nn = +s.slice(8, 10);
  return y >= 2024 && y <= 2099 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && nn >= 1 && nn <= 99;
}

test('serial existe em js/version.js e no service-worker.js', () => {
  assert.ok(serialFromVersionJs(), 'APP_VERSION não encontrado em js/version.js');
  assert.ok(serialFromServiceWorker(), 'CACHE_NAME waze-places-<serial> não encontrado no service-worker.js');
});

test('formato do serial é YYYYMMDDnn (zona DNS, RFC 1912)', () => {
  assert.ok(isValidSerial(serialFromVersionJs()), 'js/version.js: serial fora do formato YYYYMMDDnn');
});

test('paridade: version.js e service-worker.js usam o MESMO serial', () => {
  assert.equal(
    serialFromVersionJs(),
    serialFromServiceWorker(),
    'Serial divergente — bump de versão é mexer em js/version.js E service-worker.js juntos'
  );
});
