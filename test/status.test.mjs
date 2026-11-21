// A contagem pública (/status.html): server/status.mjs (puro) e a rota
// `status` do core — sem sessão, sem Waze, só o blob que o cron deixou pronto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { contarChaves, diaChaveUTC, atualizarHistorico, calcularStatusPublico, STATUS_HISTORICO_DIAS } from '../server/status.mjs';
import { dispatch } from '../server/core.mjs';
import { STATUS_CAPACIDADE_CONFORTAVEL, STATUS_CAPACIDADE_LIMITE, STATUS_CAPACIDADE_TETO_MEDIDO } from '../server/manter-conectado.mjs';
import { PAISES_OBRIGATORIOS } from '../tools/paises-validacao.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const HEX64 = 'a'.repeat(64);
const HEX64B = 'b'.repeat(64);

test('contarChaves: casa POSITIVO por forma — sessão é 64 hex nu, manter é ka_ + 64 hex', () => {
  const chaves = [
    HEX64, HEX64B,                         // 2 sessões
    'ka_' + HEX64,                         // 1 «manter conectado»
    'pair_' + HEX64,                       // pareamento: fora das duas
    'reler_' + HEX64,                      // releitura de fotos: fora
    'reler_toque_' + HEX64,                // idem
    'algo-novo_' + HEX64,                  // prefixo FUTURO desconhecido: fora por padrão, nunca contado como sessão
    HEX64.slice(0, 63),                    // 63 chars: não casa (nem sessão nem manter)
    HEX64 + 'g',                           // 65 chars com caractere inválido: não casa
    null, undefined, 42,                   // tipos não-string: ignorados, sem lançar
  ];
  const r = contarChaves(chaves);
  assert.deepEqual(r, { sessoesAtivas: 2, manterConectado: 1 });
});

test('contarChaves: lista vazia ou não-array devolve zero, sem lançar', () => {
  assert.deepEqual(contarChaves([]), { sessoesAtivas: 0, manterConectado: 0 });
  assert.deepEqual(contarChaves(null), { sessoesAtivas: 0, manterConectado: 0 });
  assert.deepEqual(contarChaves(undefined), { sessoesAtivas: 0, manterConectado: 0 });
});

test('diaChaveUTC: YYYY-MM-DD em UTC, não no fuso local', () => {
  // meio-dia UTC de um dia qualquer — não pode escorregar pro dia vizinho
  const ms = Date.UTC(2026, 10, 21, 12, 0, 0);
  assert.equal(diaChaveUTC(ms), '2026-11-21');
});

test('atualizarHistorico: funde o balde do dia (sem duplicar), ordena e poda', () => {
  let h = [];
  h = atualizarHistorico(h, '2026-01-01', { sessoesAtivas: 10, manterConectado: 3 });
  h = atualizarHistorico(h, '2026-01-02', { sessoesAtivas: 12, manterConectado: 4 });
  // Regravar o MESMO dia substitui o balde, não duplica.
  h = atualizarHistorico(h, '2026-01-01', { sessoesAtivas: 11, manterConectado: 3 });
  assert.equal(h.length, 2);
  assert.deepEqual(h[0], { dia: '2026-01-01', sessoesAtivas: 11, manterConectado: 3 });
  assert.deepEqual(h[1], { dia: '2026-01-02', sessoesAtivas: 12, manterConectado: 4 });

  // Poda: mais de `maxDias` baldes mantém só os mais RECENTES.
  let p = [];
  for (let i = 1; i <= 5; i++) p = atualizarHistorico(p, `2026-01-0${i}`, { sessoesAtivas: i, manterConectado: 0 });
  p = atualizarHistorico(p, '2026-01-06', { sessoesAtivas: 6, manterConectado: 0 }, { maxDias: 3 });
  assert.deepEqual(p.map((b) => b.dia), ['2026-01-04', '2026-01-05', '2026-01-06']);

  // Não muta o array recebido (disciplina pura).
  const antes = [{ dia: '2026-02-01', sessoesAtivas: 1, manterConectado: 0 }];
  const copia = JSON.parse(JSON.stringify(antes));
  atualizarHistorico(antes, '2026-02-02', { sessoesAtivas: 2, manterConectado: 0 });
  assert.deepEqual(antes, copia);
});

test('atualizarHistorico: o padrão de poda é STATUS_HISTORICO_DIAS (decisão do owner: 90 dias)', () => {
  assert.equal(STATUS_HISTORICO_DIAS, 90);
});

test('calcularStatusPublico: listar falhando mantém o blob ANTERIOR, com mudou=false', async () => {
  const anterior = { atualizadoEm: 111, sessoesAtivas: 9, manterConectado: 2, historico: [{ dia: '2026-01-01', sessoesAtivas: 9, manterConectado: 2 }] };
  const r1 = await calcularStatusPublico({ listar: async () => { throw new Error('store fora'); }, anterior, agoraMs: () => 222 });
  assert.equal(r1.mudou, false);
  assert.deepEqual(r1.blob, anterior);

  // Sem `anterior` também: nunca lança, devolve o vazio.
  const r2 = await calcularStatusPublico({ listar: () => null, agoraMs: () => 222 });
  assert.equal(r2.mudou, false);
  assert.deepEqual(r2.blob, { atualizadoEm: 222, sessoesAtivas: 0, manterConectado: 0, historico: [] });
});

test('calcularStatusPublico: primeira execução (sem anterior) sempre MUDA; execução igual à anterior NÃO muda', async () => {
  const agora = Date.UTC(2026, 10, 21, 10, 0, 0);
  const chaves = [HEX64, 'ka_' + HEX64];
  const r1 = await calcularStatusPublico({ listar: async () => chaves, anterior: null, agoraMs: () => agora });
  assert.equal(r1.mudou, true);
  assert.equal(r1.blob.sessoesAtivas, 1);
  assert.equal(r1.blob.manterConectado, 1);
  assert.equal(r1.blob.historico.length, 1);

  // MESMO dia, MESMA contagem: o adaptador não precisa gravar de novo.
  const r2 = await calcularStatusPublico({ listar: async () => chaves, anterior: r1.blob, agoraMs: () => agora + 1000 });
  assert.equal(r2.mudou, false);

  // Contagem MUDOU: grava de novo, e o balde do dia é substituído (não duplica).
  const r3 = await calcularStatusPublico({ listar: async () => [HEX64, HEX64B, 'ka_' + HEX64], anterior: r1.blob, agoraMs: () => agora + 2000 });
  assert.equal(r3.mudou, true);
  assert.equal(r3.blob.sessoesAtivas, 2);
  assert.equal(r3.blob.historico.length, 1);

  // Dia NOVO, mesma contagem do dia anterior: muda (ganha um balde a mais no histórico).
  const amanha = agora + 24 * 3600 * 1000;
  const r4 = await calcularStatusPublico({ listar: async () => chaves, anterior: r1.blob, agoraMs: () => amanha });
  assert.equal(r4.mudou, true);
  assert.equal(r4.blob.historico.length, 2);
});

// ─── A rota `status` do core ────────────────────────────────────────────────

test('dispatch("status"): sem statusStore devolve o estado vazio, 200, nunca erro — é vitrine pública', async () => {
  const { status, body } = await dispatch('status', {}, {});
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.sessoesAtivas, 0);
  assert.equal(body.manterConectado, 0);
  assert.deepEqual(body.historico, []);
  assert.deepEqual(body.capacidade, {
    confortavel: STATUS_CAPACIDADE_CONFORTAVEL, limite: STATUS_CAPACIDADE_LIMITE, tetoMedido: STATUS_CAPACIDADE_TETO_MEDIDO,
  });
});

test('dispatch("status"): lê o blob do statusStore e devolve junto da capacidade', async () => {
  const blob = { atualizadoEm: 12345, sessoesAtivas: 7, manterConectado: 3, historico: [{ dia: '2026-11-20', sessoesAtivas: 7, manterConectado: 3 }] };
  const statusStore = { get: async () => JSON.stringify(blob) };
  const { status, body } = await dispatch('status', {}, { statusStore });
  assert.equal(status, 200);
  assert.equal(body.sessoesAtivas, 7);
  assert.equal(body.manterConectado, 3);
  assert.equal(body.atualizadoEm, 12345);
  assert.equal(body.historico.length, 1);
});

test('dispatch("status"): blob ilegível (nunca escrito, ou corrompido) NUNCA lança — cai no vazio', async () => {
  for (const bruto of [null, '', 'não é json', '42', '"string solta"']) {
    const { status, body } = await dispatch('status', {}, { statusStore: { get: async () => bruto } });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.sessoesAtivas, 'number');
  }
});

test('dispatch("status"): não exige sessionToken nem rejeita quando a rota não manda um', async () => {
  // `renovarPrazoNoFim` (fim do dispatch) não pode lançar por falta de `sessions`
  // no ctx — a rota pública não tem sessão nenhuma pra renovar.
  const { status } = await dispatch('status', { sessionToken: undefined }, {});
  assert.equal(status, 200);
});

// ─── A lista de países da página é a FONTE ÚNICA, não uma cópia ────────────

test('status.src.html: os países mostrados são EXATAMENTE os PAISES_OBRIGATORIOS (fonte: tools/paises-validacao.mjs)', () => {
  const html = readFileSync(join(ROOT, 'status.src.html'), 'utf8');
  const idsNaPagina = [...html.matchAll(/data-pais-id="(\d+)"/g)].map((m) => Number(m[1]));
  const idsObrigatorios = PAISES_OBRIGATORIOS.map((p) => p.id);
  assert.deepEqual(idsNaPagina, idsObrigatorios,
    'status.src.html mostra um conjunto de países diferente de PAISES_OBRIGATORIOS — a lista de validação mudou e a página não acompanhou (ou vice-versa)');

  // Cada país tem uma chave `status.pais.<id>` citada na página (data-i18n), e
  // o dicionário (as 4 línguas) tem essa chave — travado por outro teste
  // (i18n: toda chave do dicionário é usada), este confere o lado da PÁGINA.
  for (const id of idsObrigatorios) {
    assert.ok(html.includes(`data-i18n="status.pais.${id}"`),
      `status.src.html não tem data-i18n="status.pais.${id}" pro país id ${id}`);
  }
});
