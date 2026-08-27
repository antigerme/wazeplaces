// Anistia da presença: "Ver quem está na fila" volta sozinha depois de 9 dias.
//
// O módulo mora no js/app.js (script de browser, não módulo), então o teste
// FATIA a fonte e a executa num escopo de mentira — mesmo padrão do
// test/autores.test.mjs. Fatiar em vez de reimplementar é o que garante que o
// teste exercite o código que roda no aparelho, e não uma cópia que envelhece.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

// Âncoras em DECLARAÇÃO, nunca em distância (gotcha #67).
const INICIO = 'const PRESENCA_ANISTIA_DIAS =';
const FIM = 'function saveDevMode() {';
assert.ok(fonte.includes(INICIO), 'a anistia da presença sumiu do app.js');
assert.ok(fonte.includes(FIM), 'saveDevMode sumiu — o corte do teste precisa ser revisto');
const a = fonte.indexOf(INICIO), b = fonte.indexOf(FIM);
assert.ok(b > a, 'o corte pegaria o arquivo ao contrário');
const trecho = fonte.slice(a, b);

const DIA = 24 * 60 * 60 * 1000;

function montar(prefs, agoraMs = Date.UTC(2026, 7, 27, 12)) {
  const guardado = new Map();
  const escopo = {
    AppState: { preferences: { ...prefs } },
    localStorage: {
      getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
      setItem: (k, v) => guardado.set(k, String(v)),
      removeItem: (k) => guardado.delete(k),
    },
    PREFERENCES_KEY: 'waze_places_preferences',
    Date: { now: () => agoraMs, UTC: Date.UTC },
  };
  const nomes = Object.keys(escopo);
  const corpo = trecho
    + '\nreturn { aplicarAnistiaDaPresenca, loadPreferences, savePreferences,'
    + ' PRESENCA_ANISTIA_DIAS, PRESENCA_ANISTIA_MS };';
  const api = new Function(...nomes, corpo)(...nomes.map((n) => escopo[n]));
  return { ...api, prefs: escopo.AppState.preferences, guardado, agoraMs };
}

test('anistia: 9 dias, e a constante não se escreve à mão em milissegundos', () => {
  const m = montar({ presenca: true });
  assert.equal(m.PRESENCA_ANISTIA_DIAS, 9);
  assert.equal(m.PRESENCA_ANISTIA_MS, 9 * DIA, 'os ms têm que sair dos dias, não de um número solto');
});

test('anistia: desligar carimba a hora; o carimbo é do DESLIGAR', () => {
  // O carimbo em si é posto pelo listener do toggle; aqui se cobra que a
  // anistia PRESERVE um carimbo recente em vez de reescrevê-lo a cada carga —
  // reescrever adiaria a volta pra sempre, e o defeito seria invisível.
  const agora = Date.UTC(2026, 7, 27, 12);
  const m = montar({ presenca: false, presencaOffEm: agora - 3 * DIA }, agora);
  assert.equal(m.aplicarAnistiaDaPresenca(), false, 'com 3 dias não muda nada');
  assert.equal(m.prefs.presenca, false);
  assert.equal(m.prefs.presencaOffEm, agora - 3 * DIA, 'o carimbo não pode ser reescrito');
});

test('anistia: 8 dias e 23h ainda NÃO volta', () => {
  const agora = Date.UTC(2026, 7, 27, 12);
  const m = montar({ presenca: false, presencaOffEm: agora - (9 * DIA - 3600000) }, agora);
  assert.equal(m.aplicarAnistiaDaPresenca(), false);
  assert.equal(m.prefs.presenca, false);
});

test('anistia: aos 9 dias volta a ligar e o carimbo some', () => {
  const agora = Date.UTC(2026, 7, 27, 12);
  const m = montar({ presenca: false, presencaOffEm: agora - 9 * DIA }, agora);
  assert.equal(m.aplicarAnistiaDaPresenca(), true);
  assert.equal(m.prefs.presenca, true);
  assert.equal('presencaOffEm' in m.prefs, false, 'carimbo cumprido tem que sair');
});

test('anistia: quem desligou ANTES desta versão é carimbado, não anistiado na hora', () => {
  // Religar de uma vez todo mundo que já estava desligado transforma um deploy
  // numa mudança em massa que ninguém pediu — e some com o significado dos 9
  // dias. Carimbar dá a eles a mesma contagem que todo mundo.
  const agora = Date.UTC(2026, 7, 27, 12);
  const m = montar({ presenca: false }, agora);
  assert.equal(m.aplicarAnistiaDaPresenca(), true, 'mudou: ganhou carimbo');
  assert.equal(m.prefs.presenca, false, 'NÃO pode religar no mesmo instante');
  assert.equal(m.prefs.presencaOffEm, agora);
});

test('anistia: relógio que andou pra trás não conta como 9 dias', () => {
  const agora = Date.UTC(2026, 7, 27, 12);
  const m = montar({ presenca: false, presencaOffEm: agora + 30 * DIA }, agora);
  assert.equal(m.aplicarAnistiaDaPresenca(), false);
  assert.equal(m.prefs.presenca, false);
});

test('anistia: carimbo corrompido é tratado como ausente', () => {
  for (const lixo of ['ontem', NaN, 0, -5, null, {}]) {
    const agora = Date.UTC(2026, 7, 27, 12);
    const m = montar({ presenca: false, presencaOffEm: lixo }, agora);
    assert.equal(m.aplicarAnistiaDaPresenca(), true, `carimbo ${JSON.stringify(lixo)}`);
    assert.equal(m.prefs.presenca, false);
    assert.equal(m.prefs.presencaOffEm, agora);
  }
});

test('anistia: ligado não carrega contagem — carimbo sobrando é limpo', () => {
  const m = montar({ presenca: true, presencaOffEm: 1 });
  assert.equal(m.aplicarAnistiaDaPresenca(), true);
  assert.equal('presencaOffEm' in m.prefs, false);
});

test('anistia: ligado e sem carimbo não mexe em nada', () => {
  const m = montar({ presenca: true });
  assert.equal(m.aplicarAnistiaDaPresenca(), false, 'não pode gravar à toa a cada carga');
});

// ── a integração com o load, que é onde a persistência acontece ─────────────

test('anistia: o loadPreferences aplica E persiste — senão reavalia pra sempre', () => {
  // `savePreferences` sai calado enquanto `preferenciasCarregadas` for false.
  // Se a anistia rodar antes disso, ela muda a memória e não o aparelho: na
  // carga seguinte o carimbo velho volta e a volta é adiada indefinidamente.
  const agora = Date.UTC(2026, 7, 27, 12);
  const m = montar({ presenca: true }, agora);
  m.guardado.set('waze_places_preferences', JSON.stringify({
    undoEnabled: true, presenca: false, presencaOffEm: agora - 10 * DIA,
  }));
  m.loadPreferences();
  assert.equal(m.prefs.presenca, true, 'anistiado na carga');
  const gravado = JSON.parse(m.guardado.get('waze_places_preferences'));
  assert.equal(gravado.presenca, true, 'e GRAVADO — não só na memória');
  assert.equal('presencaOffEm' in gravado, false);
});

test('anistia: carga normal (desligado há pouco) não religa nem perde o carimbo', () => {
  const agora = Date.UTC(2026, 7, 27, 12);
  const m = montar({ presenca: true }, agora);
  m.guardado.set('waze_places_preferences', JSON.stringify({
    undoEnabled: true, presenca: false, presencaOffEm: agora - 2 * DIA,
  }));
  m.loadPreferences();
  assert.equal(m.prefs.presenca, false);
  assert.equal(m.prefs.presencaOffEm, agora - 2 * DIA);
});

test('anistia: quem nunca abriu as Preferências continua LIGADO e sem carimbo', () => {
  // Opt-out: `undefined` é quem nunca decidiu, e não pode virar desligado.
  const m = montar({ presenca: true });
  m.guardado.set('waze_places_preferences', JSON.stringify({ undoEnabled: true }));
  m.loadPreferences();
  assert.equal(m.prefs.presenca, true);
  assert.equal('presencaOffEm' in m.prefs, false);
});
