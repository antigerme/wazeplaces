// R17-6-A5 (auditoria da rodada 17): `.github/ISSUE_TEMPLATE/config.yml` mandava o
// editor pro WME em `/pt-BR/editor`. A regra permanente do projeto é UMA URL, sem
// idioma — o Waze redireciona conforme o idioma de quem abre, e essa escolha é
// dele, não nossa (CLAUDE.md, "SEMPRE valide contra o WME real").
import test from 'node:test';
import assert from 'node:assert/strict';
// O `layout.test.mjs` cobre o código do app; os formulários do GitHub e os READMEs
// também mandam o editor pro WME.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test('R17-6-A5: os formulários do GitHub, o README e a extensão apontam o WME SEM idioma (https://www.waze.com/editor)', () => {
  const raiz = join(import.meta.dirname, '..');
  const arquivos = ['README.md', 'extensao-chrome/README.md', 'extensao-chrome/background.js', 'extensao-chrome/content.js'];
  for (const f of readdirSync(join(raiz, '.github', 'ISSUE_TEMPLATE'))) arquivos.push(`.github/ISSUE_TEMPLATE/${f}`);
  const cravados = [];
  for (const arq of arquivos) {
    let texto;
    try { texto = readFileSync(join(raiz, arq), 'utf8'); } catch { continue; }
    for (const m of texto.matchAll(/waze\.com\/([a-z]{2}(?:-[A-Z]{2})?)\/editor/g)) cravados.push(`${arq} → /${m[1]}/editor`);
  }
  assert.deepEqual(cravados, [], 'URL do WME com idioma cravado (o editor cai num WME que não é o dele):\n' + cravados.join('\n'));
  // CONTROLE: o formulário que tinha o defeito está na lista e aponta o link canônico.
  const config = readFileSync(join(raiz, '.github/ISSUE_TEMPLATE/config.yml'), 'utf8');
  assert.match(config, /url: https:\/\/www\.waze\.com\/editor\s*$/m, 'o link do WME no config.yml sumiu ou mudou');
  // CONTROLE do detector: a forma errada, escrita, é pega pela mesma regex.
  assert.match('https://www.waze.com/pt-BR/editor', /waze\.com\/([a-z]{2}(?:-[A-Z]{2})?)\/editor/);
  assert.doesNotMatch('https://www.waze.com/pt-BR/user/editor/antigerme', /waze\.com\/([a-z]{2}(?:-[A-Z]{2})?)\/editor/);
});
