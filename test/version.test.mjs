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
  if (y < 2024 || y > 2099 || nn < 1 || nn > 99) return false;
  // Data de CALENDÁRIO real: a checagem antiga (d <= 31) deixava passar 20260231.
  // O Date normaliza datas impossíveis (31/02 vira 03/03), então comparamos de volta.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Data do serial em UTC, à meia-noite.
function serialDate(s) {
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
}

test('serial existe em js/version.js e no service-worker.js', () => {
  assert.ok(serialFromVersionJs(), 'APP_VERSION não encontrado em js/version.js');
  assert.ok(serialFromServiceWorker(), 'CACHE_NAME waze-places-<serial> não encontrado no service-worker.js');
});

test('formato do serial é YYYYMMDDnn (zona DNS, RFC 1912)', () => {
  assert.ok(isValidSerial(serialFromVersionJs()), 'js/version.js: serial fora do formato YYYYMMDDnn');
});

// A data do serial não pode estar no FUTURO. Pega erro de digitação (mês/dia
// trocados, ano errado) sem nenhum risco de falso positivo: carimbar uma versão
// com data futura nunca é intencional. A tolerância de 1 dia cobre o fuso do
// runner e a virada de meia-noite entre commit e execução do teste.
test('data do serial não está no futuro', () => {
  const s = serialFromVersionJs();
  const dias = (serialDate(s) - Date.now()) / 86400000;
  assert.ok(
    dias <= 1,
    `Serial ${s} tem data no futuro (${Math.round(dias)} dias à frente). ` +
    'Rode `date -u +%Y%m%d` e use a data de hoje com revisão 01.'
  );
});

test('paridade: version.js e service-worker.js usam o MESMO serial', () => {
  assert.equal(
    serialFromVersionJs(),
    serialFromServiceWorker(),
    'Serial divergente — bump de versão é mexer em js/version.js E service-worker.js juntos'
  );
});
