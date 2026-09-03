// O anel de chamadas do `js/api.js`, que é o que o diagnóstico carrega.
//
// Ele existe porque a pergunta que mais custou tempo neste projeto foi "o que
// exatamente falhou no aparelho dele?", e o toast conta só o desfecho. O teste
// FATIA a fonte e executa — o módulo é script de browser, e reimplementar aqui
// mediria uma cópia que envelhece.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');

// Monta um `API` de mentira com só o pedaço que interessa, e uma `fetch`
// controlada. `devAtivo` liga o `AppState.devMode.active` que o `_guardaCorpo` lê.
function montar({ status = 200, corpo = '{"success":true}', cab = {}, lanca = null, devAtivo = false } = {}) {
  const i = fonte.indexOf('    chamadas: [],');
  const j = fonte.indexOf('    },', fonte.indexOf('async _post')) + 6;
  assert.ok(i !== -1 && j > i, 'o corte do api.js precisa ser revisto — âncoras sumiram');
  const trecho = fonte.slice(i, j);

  const escopo = {
    t: () => 'erro de conexão',
    AppState: { devMode: { unlocked: true, active: devAtivo } },
    performance: { now: () => 0 },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: (f) => 0, clearTimeout: () => {},
    console: { error: () => {} },
    fetch: async () => {
      if (lanca) throw lanca;
      return { status, headers: { get: (h) => cab[h] || null }, text: async () => corpo };
    },
  };
  const nomes = Object.keys(escopo);
  const api = new Function(...nomes, 'return { baseUrl: "/api", saindo: false,\n' + trecho + '\n};')(
    ...nomes.map((n) => escopo[n]));
  return api;
}

// ═══ o buraco que valia horas ════════════════════════════════════════════════
test('corpo que NÃO é JSON preserva o status real — não vira "sem rede"', async () => {
  // A app roda atrás do Bot Fight Mode da Cloudflare. Desafio do WAF, 502 da
  // borda e página de erro do gateway devolvem HTML: o `.json()` lança, e antes
  // do conserto o `catch` registrava `http: 0` — indistinguível de rede caída.
  // "A Cloudflare barrou o aparelho" e "o wifi piscou" ficavam idênticos.
  const api = montar({ status: 403, corpo: '<!DOCTYPE html>Attention Required! | Cloudflare',
                       cab: { 'cf-ray': '9abc-GRU', 'content-type': 'text/html' } });
  await api._post('buscar-places', { sessionToken: 'x' });
  const c = api.chamadas[0];
  assert.equal(c.http, 403, 'o status REAL se perdeu — é o defeito de volta');
  assert.match(c.naoEraJson, /Cloudflare/, 'sem o começo do corpo não dá pra reconhecer o WAF');
  assert.equal(c.cab['cf-ray'], '9abc-GRU', 'o cf-ray diz qual execução respondeu');
  // E não pode registrar DUAS vezes: o `catch` corre depois do `finally`, e um
  // segundo registro sobrescreveria o status por 0, desfazendo o conserto.
  assert.equal(api.chamadas.length, 1, 'a mesma chamada foi registrada duas vezes');
});

test('falha ANTES de existir resposta continua sendo http 0', async () => {
  // O contraste do teste acima: rede caída/DNS/timeout não têm status, e
  // inventar um esconderia justamente a diferença que o outro teste protege.
  const api = montar({ lanca: Object.assign(new Error('failed'), { name: 'TypeError' }) });
  await api._post('perfil', { sessionToken: 'x' });
  assert.equal(api.chamadas[0].http, 0);
  assert.equal(api.chamadas[0].errorCategory, 'transient');
});

// ═══ o token ═════════════════════════════════════════════════════════════════
test('o corpo da requisição vai SEM o token, sempre', async () => {
  // O token vai em toda chamada. Ele já está no arquivo uma vez (localStorage),
  // que é onde deve estar: repetir 60 vezes não acrescenta segredo, só
  // multiplica a chance de escapar num recorte de tela ou num trecho colado.
  const api = montar({ devAtivo: true });
  await api._post('buscar-places', { sessionToken: 'SEGREDO', cookies: 'CHAVEIRO', countryId: 30 });
  const tudo = JSON.stringify(api.chamadas);
  assert.ok(!tudo.includes('SEGREDO'), 'o token vazou pro corpo da requisição');
  assert.ok(!tudo.includes('CHAVEIRO'), 'os cookies do login vazaram');
  // …e o resto continua lá: redigir sem manter o útil não serve pra depurar.
  assert.equal(api.chamadas[0].corpoReq.countryId, 30, 'o filtro enviado sumiu junto com o token');
});

// ═══ corpo da resposta ═══════════════════════════════════════════════════════
test('corpo da resposta só é guardado com o modo dev ATIVO', async () => {
  // As DUAS metades. Só a primeira passaria com o corpo preso em "nunca"; só a
  // segunda passaria com ele preso em "sempre" — que é a versão que põe a fila
  // inteira (com nome de quem enviou cada pedido) na memória de todo mundo.
  const desligado = montar({ corpo: '{"success":true,"places":[1,2,3]}', devAtivo: false });
  await desligado._post('buscar-places', {});
  assert.equal(desligado.chamadas[0].corpoResposta, undefined, 'guardou corpo com o dev DESLIGADO');
  assert.equal(desligado.chamadas[0].n, 3, 'a CONTAGEM tem que vir sempre — é ela que distingue "respondeu vazio" de "respondeu cheio"');

  const ligado = montar({ corpo: '{"success":true,"places":[1,2,3]}', devAtivo: true });
  await ligado._post('buscar-places', {});
  assert.match(ligado.chamadas[0].corpoResposta, /places/, 'não guardou corpo com o dev LIGADO');
});

test('o teto de corpos poda os mais ANTIGOS e preserva o registro', async () => {
  // Sem teto, `buscar-places` (326 KB medidos na produção) × várias chamadas
  // vira dezenas de MB na memória de um celular e um arquivo que ninguém manda.
  const grande = '{"success":true,"x":"' + 'a'.repeat(1024 * 1024) + '"}';
  const api = montar({ corpo: grande, devAtivo: true });
  for (let i = 0; i < 6; i++) await api._post('buscar-places', {});
  const comCorpo = api.chamadas.filter((c) => c.corpoResposta);
  const total = comCorpo.reduce((a, c) => a + c.corpoResposta.length, 0);
  assert.ok(total <= api._TETO_CORPOS, `os corpos somaram ${total}, acima do teto ${api._TETO_CORPOS}`);
  assert.ok(comCorpo.length < 6, 'nada foi podado — o teto não está agindo');
  // O REGISTRO fica: perder a sequência pra caber o conteúdo seria trocar o
  // essencial pelo detalhe.
  assert.equal(api.chamadas.length, 6, 'a poda levou o registro junto com o corpo');
  assert.ok(api.chamadas.some((c) => c.corpoPodado), 'a poda tem que ficar VISÍVEL, senão parece que nunca houve corpo');
  // E poda do mais ANTIGO: o recente é o que interessa quando algo acabou de
  // falhar.
  assert.ok(api.chamadas[api.chamadas.length - 1].corpoResposta, 'a poda comeu o corpo mais RECENTE');
});

test('o anel para em 60 e nunca cresce sem fim', async () => {
  const api = montar();
  for (let i = 0; i < 70; i++) await api._post('perfil', {});
  assert.equal(api.chamadas.length, 60);
});

// ═══ o `_guardaCorpo` e o gotcha #64 ═════════════════════════════════════════
test('a leitura do modo dev NÃO passa por `window.` (gotcha #64)', () => {
  // `AppState` é `const` no escopo global de um script clássico: binding
  // LÉXICO, não propriedade de `window`. Escrito como `window.AppState`, isto
  // devolvia `false` SEMPRE e o corpo nunca era guardado — falha silenciosa que
  // só apareceu porque o teste exigia o corpo PRESENTE, não só ausente.
  // Sem comentários: o próprio comentário do conserto CITA `window.AppState`
  // pra explicar o que não fazer, e o guard reprovava o texto que o documenta.
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('_guardaCorpo()');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('},', i));
  assert.ok(!/window\.AppState/.test(bloco),
    'voltou a ler `window.AppState` — em script clássico isso é sempre undefined');
  assert.match(bloco, /typeof AppState/, 'a leitura precisa ser pelo binding global, com guarda de existência');
});
