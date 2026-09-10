// O registro de compatibilidade tem que casar com o código nos DOIS sentidos, e
// o prazo tem que doer.
//
// O caso REAL que originou isto (2026-09-10): o CLAUDE.md prometia que o
// `dispatch` tolerava sufixo `.php` "por compat de cache antigo". Fui remover e
// descobri que o `dispatch` faz `ROUTES[String(name)]` — casamento exato. A
// tolerância já não existia, e o doc seguia afirmando que sim. Registro que só
// olha um lado vira exatamente isso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRACOES, PRAZO_PADRAO_DIAS } from '../tools/migracoes.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const MARCADOR = /\/\/\s*MIGRACAO:\s*([a-z0-9-]+)/g;

// Onde procurar marcador. Não varre `js/min/` (é gerado — acharia cada marcador
// duas vezes e uma remoção mal feita passaria pelo arquivo velho).
function fontes(dir = RAIZ, achados = []) {
  for (const nome of readdirSync(dir)) {
    if (['node_modules', '.git', 'min', 'scratchpad', 'docs', 'fonts', 'icons'].includes(nome)) continue;
    const cheio = join(dir, nome);
    if (statSync(cheio).isDirectory()) fontes(cheio, achados);
    else if (['.js', '.mjs'].includes(extname(nome)) && !cheio.includes('/test/')) achados.push(cheio);
  }
  return achados;
}

const noCodigo = new Map();   // id → [arquivos]
for (const arq of fontes()) {
  const txt = readFileSync(arq, 'utf8');
  for (const m of txt.matchAll(MARCADOR)) {
    const rel = arq.slice(RAIZ.length);
    if (rel.startsWith('tools/migracoes.mjs')) continue;   // o próprio registro cita ids
    noCodigo.set(m[1], [...(noCodigo.get(m[1]) || []), rel]);
  }
}

test('toda entrada do registro tem marcador NO CÓDIGO', () => {
  // Esta é a direção que pega o caso do `.php`: o trecho foi removido e o
  // registro continuou afirmando que ele existe.
  for (const m of MIGRACOES) {
    const onde = noCodigo.get(m.id);
    assert.ok(onde, `"${m.id}" está no registro e NÃO tem marcador em lugar nenhum — `
      + `foi removido do código? Então tire a entrada de tools/migracoes.mjs.`);
    assert.ok(onde.includes(m.onde),
      `"${m.id}" diz morar em ${m.onde}, mas o marcador está em ${onde.join(', ')}`);
  }
});

test('todo marcador no código tem entrada no registro', () => {
  // E esta é a que impede compat nova de nascer sem data — que é como a antiga
  // vira permanente sem ninguém decidir.
  const ids = new Set(MIGRACOES.map((m) => m.id));
  for (const [id, onde] of noCodigo) {
    assert.ok(ids.has(id), `marcador MIGRACAO: ${id} em ${onde.join(', ')} sem entrada `
      + `em tools/migracoes.mjs — compat sem data vira compat pra sempre.`);
  }
});

test('as datas são reais, e o prazo é um PRAZO', () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const vistos = new Set();
  for (const m of MIGRACOES) {
    assert.ok(!vistos.has(m.id), `id repetido: ${m.id}`);
    vistos.add(m.id);
    for (const campo of ['desde', 'revisarEm']) {
      const v = m[campo];
      assert.match(v, /^\d{4}-\d{2}-\d{2}$/, `${m.id}.${campo} não é uma data`);
      // Calendário impossível (`2026-02-31`) passa em regex e vira prazo que
      // nunca chega — mesma armadilha do serial de versão.
      assert.equal(new Date(v + 'T00:00:00Z').toISOString().slice(0, 10), v,
        `${m.id}.${campo}: ${v} não existe no calendário`);
    }
    assert.ok(m.desde <= hoje, `${m.id}.desde está no futuro`);
    assert.ok(m.revisarEm > m.desde, `${m.id}: revisar antes de nascer não é prazo`);
    // A CONDIÇÃO é o que decide a remoção; a data só chama o humano. Entrada sem
    // condição escrita devolve a decisão pro palpite de quem ler daqui a meses.
    assert.ok(m.oque && m.oque.length > 30, `${m.id}.oque: descreva o que o trecho faz`);
    assert.ok(m.removerQuando && m.removerQuando.length > 30,
      `${m.id}.removerQuando: escreva a CONDIÇÃO de remoção, não só a data`);
    assert.ok(['aparelho', 'compat', 'arquivo'].includes(m.familia),
      `${m.id}.familia inválida: ${m.familia}`);
  }
});

test('nenhuma migração passou do prazo de REVISÃO', () => {
  // Isto REPROVA, não apaga. Passou da data, alguém responde "ainda é preciso?"
  // — e se for, empurra o `revisarEm`, que é um ato deliberado e datado.
  const hoje = new Date().toISOString().slice(0, 10);
  const vencidas = MIGRACOES.filter((m) => m.revisarEm < hoje);
  assert.deepEqual(vencidas.map((m) => m.id), [],
    'migração vencida — decida:\n' + vencidas.map((m) =>
      `  · ${m.id} (${m.onde}, de ${m.desde})\n    remover quando: ${m.removerQuando}\n`
      + `    mantendo? empurre revisarEm em tools/migracoes.mjs`).join('\n'));
});

test('o prazo PADRÃO vale pra família "aparelho"', () => {
  // Migração de aparelho expira quando todo aparelho rodou — é o único caso em
  // que o relógio responde a pergunta certa, e é onde os 30 dias valem. Família
  // `arquivo` NÃO expira por uso da app (diagnóstico recebido fica no disco pra
  // sempre), então ela tem prazo próprio e mais longo, de propósito.
  const dia = 86400000;
  for (const m of MIGRACOES.filter((x) => x.familia === 'aparelho')) {
    const janela = Math.round((Date.parse(m.revisarEm) - Date.parse(m.desde)) / dia);
    assert.ok(janela <= PRAZO_PADRAO_DIAS,
      `${m.id}: ${janela} dias até a revisão, acima do padrão de ${PRAZO_PADRAO_DIAS}. `
      + `Se precisa de mais, mude a família ou escreva por quê.`);
  }
});
