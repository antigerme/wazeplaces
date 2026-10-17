// FUZZ que FECHA a família «aparelho que LÊ e não GRAVA» na fila de saída (lote 28, R24-1-02/03, R24-2-01).
//
// A família foi consertada em remendos três rodadas seguidas (R22 → R23 → R24) e cada remendo foi achado
// incompleto na rodada seguinte: a lembrança dos itens tirados era um Map «tipo|venue|pedido» → UM `t` (sem ids
// virava laço, id objeto nunca casava, 3 itens do mesmo pedido giravam), e as marcas do 5xx/401 e o «pro fim»
// dependiam de a gravação pegar. Este teste não escolhe os casos: SORTEIA a fila (com semente, determinístico) e
// confere os invariantes, nos três modos do armazenamento:
//
//   · grava   — o de sempre;
//   · recusa  — LÊ e não GRAVA (modo restrito, disco cheio): toda escrita devolve `false`;
//   · cota    — recusa o que CRESCE e aceita o que encolhe (a cota de verdade).
//
// Conteúdo sorteado: o mesmo pedido várias vezes (com `t` igual e diferente), ids nulos, ids objeto e lista,
// item ENVENENADO (o Waze responde 503 ou 401 SEMPRE àquele pedido), item de OUTRA conta e item SEM DONO.
// Invariantes: (1) a passada TERMINA — o harness põe teto nas leituras e reprova com a contagem (gotcha #19);
// (2) nenhum item de outra conta ou sem dono vai ao Waze; (3) cada item é enviado no máximo uma vez por página
// (o envenenado, no máximo as tentativas que o app promete: 3 no 5xx com escrita aceita no meio, senão uma por
// gatilho; 2 no 401); (4) os itens ATRÁS de um envenenado ainda saem;
// (5) a fila efetiva fecha em 0, ou só com o envenenado de 5xx (sem prova de que o Waze aceita escrita, ele fica).
//
// PROVA contra o código de ANTES: `FUZZ_APP_JS=/caminho/do/app-antigo.js node --test test/fila-nao-grava-fuzz.test.mjs`
// (o main e98324f reprova: laço, reenvio sem teto e o envenenado que nunca sai).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP_SEM = semComentario(process.env.FUZZ_APP_JS ? readFileSync(process.env.FUZZ_APP_JS, 'utf8') : ler('js/app.js'));

function fatiarDe(fonte, nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) {
      const corpo = fonte.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
function buracoNegro(nome, chamou) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}
function montar(nomes, deps) {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map((n) => fatiarDe(APP_SEM, n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}

// PRNG com semente (mulberry32): o fuzz é DETERMINÍSTICO — falha de uma rodada se reproduz na seguinte.
function prng(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEITURAS_TETO = 600;   // o laço síncrono do defeito não prende o processo do teste (gotcha #19)
const ENVIOS_TETO = 80;

// ── o aparelho: LÊ sempre; GRAVA conforme o `modo` ──────────────────────────────────────────────────
function aparelho({ itens, modo = 'grava', conta = '111', guardado = null, nome = '' }) {
  guardado = guardado || new Map([['waze_places_saida', JSON.stringify(itens)]]);
  const med = { envios: [], pousos: [], leituras: 0, sucessos: 0, tirouSemEnviar: [] };
  const est = { modo, estourou: false };
  const AppState = { authenticated: true, profile: { id: Number(conta) }, stats: { read: 0, rejected: itens.length, skipped: 0 }, queue: [] };
  const safeLS = {
    get: (k) => {
      if (k === 'waze_places_saida' && ++med.leituras > LEITURAS_TETO) { est.estourou = true; return '[]'; }
      return guardado.has(k) ? guardado.get(k) : null;
    },
    set: (k, v) => {
      if (est.modo === 'recusa') return false;
      const novo = String(v);
      if (est.modo === 'cota' && novo.length > (guardado.get(k) || '').length) return false;   // o que CRESCE é recusado
      guardado.set(k, novo);
      return true;
    },
    remove: (k) => guardado.delete(k),
  };
  const chaveEnvio = (tipo, venue, upd) => `${tipo}|${JSON.stringify(venue)}|${JSON.stringify(upd)}`;
  const resposta = (tipo) => (venue, upd) => {
    med.envios.push(chaveEnvio(tipo, venue, upd) + (nome ? '@' + nome : ''));
    // Mais de ENVIOS_TETO idas é o laço sem teto: a resposta nunca chega, o teste conta e reprova.
    if (med.envios.length > ENVIOS_TETO) return new Promise(() => {});
    const v = JSON.stringify(venue) || '';
    return new Promise((ok) => setImmediate(() => {
      if (/^"P503/.test(v)) ok({ success: false, errorCategory: 'transient', httpCode: 503 });
      else if (/^"P401/.test(v)) ok({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
      else { med.sucessos++; ok({ success: true }); }
    }));
  };
  const deps = {
    AppState, epocaDaSessao: 0, navigator: { onLine: true }, safeLS, SAIDA_KEY: 'waze_places_saida', SAIDA_RITMO_MS: 0,
    SAIDA_TENTATIVAS_POR_ITEM: 3, CONTA_KEY: 'waze_places_conta',
    esvaziandoSaida: false, saidaPedidaDeNovo: false, saidaEsperandoConta: false, verificandoSessao: false,
    ultimaEscritaOkEm: 0, saidaRecuo: { s: null, n: 0, ate: 0 },
    saidaTiradosSemGravar: new Map(),
    pedidosEmAndamento: new Set(),
    chaveDoPedido: (x) => (x && x.venueID != null && x.updateRequestID != null ? String(x.venueID) + '|' + String(x.updateRequestID) : ''),
    contaAgora: () => conta, marcaDaSessao: () => 'm', saidaEmRecuo: () => false, reivindicadoPorOutraAba: () => false,
    travaDaSaida: async () => ({ reserva: false, soltar() {} }),
    API: { getSession: () => 'tok', get sessionToken() { return 'tok'; }, rejectPlace: resposta('reject'), markAsRead: resposta('read') },
    // O pouso de verdade soma `ultimaEscritaOkEm` (a prova de que o Waze aceita escrita) só no sucesso.
    registrarPousoDeSaida: (tipo, place, r) => {
      med.pousos.push(chaveEnvio(tipo, place.venueID, place.updateRequestID));
      if (r && r.success) deps.ultimaEscritaOkEm = Date.now() + 100000;
    },
    atenderProvaDoEsvaziamento: () => {}, updateInFlightIndicator: () => {}, updateStats: () => {}, saveStats: () => {},
    dfato: (nome2) => { if (/outraConta|semDono/.test(nome2)) med.tirouSemEnviar.push(nome2); }, showToast: () => {}, t: (k) => k,
    // A sonda do 401 RESPONDEU com o perfil depois do 1º 401 do item: a sessão está viva, o defeito é do item.
    sessaoVivaDepoisDe: (t) => Number.isFinite(t), recuarSaida: () => {}, handleUnauthorized: () => {}, console,
  };
  const m = montar(['esvaziarFilaDeSaida', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'salvarFilaSemOs', 'chaveDoItemDaSaida',
    'tirarDaFilaDeSaida', 'moverProFimDaSaida', 'marcarNaSaida', 'diagResumoDaSaida'], deps);
  return { ...m, med, est, AppState, guardado, deps,
    efetiva: () => m.carregarFilaDeSaida(),
    noAparelho: () => JSON.parse(guardado.get('waze_places_saida') || '[]') };
}

async function passar(ap) {
  const p = ap.esvaziarFilaDeSaida().then(() => 'fim', () => 'erro');
  const teto = new Promise((ok) => setTimeout(() => ok('teto'), 4000));
  const r = await Promise.race([p, teto]);
  for (let i = 0; i < 6; i++) await new Promise((ok) => setImmediate(ok));
  return r;
}

// ── a fila sorteada ─────────────────────────────────────────────────────────────────────────────
function sortear(rnd) {
  const n = 1 + Math.floor(rnd() * 7);
  const pool = ['a', 'b', 'c'];
  const itens = [];
  for (let i = 0; i < n; i++) {
    const p = pool[Math.floor(rnd() * pool.length)];
    const veneno = rnd() < 0.25 ? (rnd() < 0.5 ? 'P503' : 'P401') : null;
    let venue = (veneno || 'v') + p, upd = 'u' + p;
    if (!veneno) {
      const f = rnd();
      if (f < 0.12) venue = null;                    // ids nulos
      else if (f < 0.22) venue = { a: p };           // id objeto
      else if (f < 0.32) upd = [p];                  // id lista
    }
    const d = rnd();
    const dono = d < 0.6 ? { conta: '111', s: 'm' }
      : d < 0.75 ? { conta: '999', s: 'm' }          // OUTRA conta
      : d < 0.9 ? { conta: null, s: 'x' }            // SEM DONO (outra sessão, sem conta)
      : { conta: null, s: 'm' };                     // sem conta, mas desta sessão: sai
    itens.push({ tipo: rnd() < 0.5 ? 'reject' : 'read', venueID: venue, updateRequestID: upd, creatorId: 9, nome: 'z',
      t: 1000 + Math.floor(rnd() * 3), dia: '2026-10-15', onde: '30', lang: 'pt', regiao: 'row', ...dono });
  }
  return itens;
}

const MINHA = (it) => it.conta === '111' || (!it.conta && it.s === 'm');
const imp = (it) => { const { tt, tf, u401, rv, rvEm, ...c } = it; return JSON.stringify(c); };
const chaveDe = (it) => `${it.tipo}|${JSON.stringify(it.venueID)}|${JSON.stringify(it.updateRequestID)}`;

for (const modo of ['grava', 'recusa', 'cota']) {
  test(`FUZZ (${modo}): a passada termina, ninguém de fora vai ao Waze, cada item sai uma vez e os de trás de um envenenado também`, async () => {
    const rnd = prng(0xC0FFEE ^ modo.length);
    for (let rodada = 0; rodada < 60; rodada++) {
      const itens = sortear(rnd);
      const rotulo = `[${modo} #${rodada}] ${JSON.stringify(itens.map((x) => [x.tipo[0], x.venueID, x.updateRequestID, x.t, x.conta, x.s]))}`;
      const ap = aparelho({ itens, modo });
      const minhas = itens.filter(MINHA);
      const veneno = (it) => /^"P503/.test(JSON.stringify(it.venueID) || '') ? 503 : /^"P401/.test(JSON.stringify(it.venueID) || '') ? 401 : 0;
      const envenenadas = new Set(minhas.filter(veneno).map(imp));
      const passadas = 3 * envenenadas.size + 3;
      let feitas = 0;
      for (let k = 0; k < passadas && ap.efetiva().length; k++) {
        feitas++;
        const r = await passar(ap);
        assert.equal(r, 'fim', `DEFEITO: a passada ${k} não terminou (${r}) — ${rotulo}`);
        assert.ok(!ap.est.estourou, `DEFEITO: o esvaziamento leu a fila ${ap.med.leituras}× — girou sem await (a aba congelava) — ${rotulo}`);
        assert.ok(ap.med.envios.length <= ENVIOS_TETO, `DEFEITO: ${ap.med.envios.length} envios ao Waze — o laço sem teto — ${rotulo}`);
      }
      // (2) ninguém de outra conta ou sem dono vai ao Waze: o que foi enviado tem que ser de uma fila MINHA.
      const permitidas = new Set(minhas.map(chaveDe));
      for (const e of ap.med.envios) assert.ok(permitidas.has(e), `DEFEITO: ${e} foi ao Waze e não é desta conta — ${rotulo}`);
      // (3) cada item sai no máximo uma vez: por chave, no máximo os itens DISTINTOS dela (cópias idênticas valem uma);
      // o envenenado, no máximo as tentativas que o app promete (3 no 5xx, 2 no 401: o 2º já é depois da sonda).
      const distintos = new Map();
      for (const it of minhas) {
        const k = chaveDe(it);
        const o = distintos.get(k) || new Map();
        // O envenenado de 5xx sai na 3ª tentativa SE outra escrita pousou (prova de que o Waze aceita escrita); sem
        // ela ele fica, e cada gatilho (passada) manda UMA requisição — nunca uma rajada.
        o.set(imp(it), veneno(it) === 503 ? (ap.med.sucessos > 0 ? 3 : feitas) : veneno(it) === 401 ? 2 : 1);
        distintos.set(k, o);
      }
      const contados = new Map();
      for (const e of ap.med.envios) contados.set(e, (contados.get(e) || 0) + 1);
      for (const [k, n] of contados) {
        const teto = [...distintos.get(k).values()].reduce((a, b) => a + b, 0);
        assert.ok(n <= teto, `DEFEITO: ${k} foi enviado ${n}× (teto ${teto}) — ${rotulo}`);
      }
      // (4)+(5) tudo que NÃO é envenenado saiu; sobra no máximo o envenenado de 5xx, e só se nada pousou no Waze.
      const sobra = ap.efetiva();
      for (const it of sobra) assert.equal(veneno(it), 503, `DEFEITO: sobrou na fila ${imp(it)} — o que não é envenenado de 5xx tinha que sair — ${rotulo}`);
      if (ap.med.sucessos > 0) assert.deepEqual(sobra, [], `DEFEITO: houve escrita aceita e o envenenado de 5xx não saiu como falha — ${rotulo}`);
    }
  });
}

// ── o desenho, por partes ───────────────────────────────────────────────────────────────────────────
const ITEM = (v, extra = {}) => ({ tipo: 'reject', venueID: 'x' + v, updateRequestID: 'y' + v, creatorId: 9, nome: 'z',
  t: 1000 + v, dia: '2026-10-15', onde: '30', lang: 'pt', conta: '111', s: 'm', regiao: 'row', ...extra });

test('A impressão digital do item NUNCA é nula (ids nulos, ausentes, objeto, lista) e distingue o `t` — mas não as marcas', () => {
  const { chaveDoItemDaSaida: k } = aparelho({ itens: [] });
  for (const it of [{}, { tipo: 'read' }, ITEM(1, { venueID: null }), ITEM(1, { venueID: { a: 1 } }), ITEM(1, { updateRequestID: [1] }), null, 7, 'x']) {
    assert.equal(typeof k(it), 'string', `${JSON.stringify(it)} ficou sem impressão`);
  }
  assert.notEqual(k(ITEM(1)), k(ITEM(1, { t: 2 })), 'o MESMO pedido com outro `t` é outro item');
  assert.notEqual(k(ITEM(1, { venueID: { a: 1 } })), k(ITEM(1, { venueID: { a: 2 } })));
  assert.equal(k(ITEM(1)), k({ ...ITEM(1), tt: 2, tf: 5, u401: 9, rv: 'aba', rvEm: 3 }), 'as marcas do esvaziamento e da reserva mudaram a identidade');
});

test('Três ou mais itens do MESMO pedido com o aparelho que recusa: cada um sai uma vez, sem laço (R24-1-03)', async () => {
  const ap = aparelho({ itens: [ITEM(1, { t: 10 }), ITEM(1, { t: 11 }), ITEM(1, { t: 12 }), ITEM(1, { t: 13 })].map((x) => ({ ...x, venueID: 'x1', updateRequestID: 'y1' })), modo: 'recusa' });
  assert.equal(await passar(ap), 'fim');
  assert.ok(!ap.est.estourou, 'DEFEITO: a passada girou (a lembrança guardava UM `t` por pedido)');
  assert.equal(ap.med.envios.length, 4, `os 4 itens saem uma vez cada (foram ${ap.med.envios.length})`);
  assert.deepEqual(ap.efetiva(), []);
});

test('Item sem `venueID`/`updateRequestID` com o aparelho que recusa: sai sem congelar (R24-1-02)', async () => {
  const ap = aparelho({ itens: [{ tipo: 'reject', conta: '999', t: 1 }, { tipo: 'reject', conta: '999', t: 2, venueID: null, updateRequestID: null }, ITEM(3, { conta: '111' })], modo: 'recusa' });
  assert.equal(await passar(ap), 'fim');
  assert.ok(!ap.est.estourou, `DEFEITO: o laço síncrono dos itens de outra conta sem ids girou (${ap.med.leituras} leituras)`);
  assert.deepEqual(ap.med.envios, ['reject|"x3"|"y3"'], 'só o item desta conta vai ao Waze');
});

test('O envenenado (503) com a cota cheia: as marcas e o «pro fim» ficam em MEMÓRIA — chega a 3 tentativas e os de trás saem (R24-2-01)', async () => {
  for (const modo of ['recusa', 'cota']) {
    const ap = aparelho({ itens: [ITEM(1, { venueID: 'P503a' }), ITEM(2), ITEM(3)], modo });
    await passar(ap);                                       // 1ª: o envenenado leva o 503, vai pro fim e a passada para
    assert.deepEqual(ap.efetiva().map((x) => [x.venueID, x.tt]), [['x2', undefined], ['x3', undefined], ['P503a', 1]], `${modo}: a marca/ordem não ficou na memória`);
    await passar(ap);                                       // 2ª: os de trás saem, o envenenado leva o 2º 503
    await passar(ap);                                       // 3ª: 3 tentativas + escrita aceita depois → sai como falha
    assert.deepEqual(ap.efetiva(), [], `${modo}: o envenenado nunca saiu da fila`);
    const idas = ap.med.envios.filter((e) => /P503a/.test(e)).length;
    assert.equal(idas, 3, `${modo}: o envenenado foi ${idas}× ao Waze (o app promete 3)`);
    assert.equal(ap.med.envios.filter((e) => !/P503a/.test(e)).length, 2, `${modo}: os de trás não saíram uma vez cada`);
  }
});

test('O envenenado (401) com o aparelho que recusa: o `u401` fica em memória — o 2º 401 já o tira (R24-2-01)', async () => {
  const ap = aparelho({ itens: [ITEM(1, { venueID: 'P401a' }), ITEM(2)], modo: 'recusa' });
  await passar(ap);
  assert.equal(ap.efetiva()[0].venueID, 'P401a', 'o 401 não para os de trás? (a passada parou nele — é o desenho)');
  assert.ok(Number.isFinite(ap.efetiva()[0].u401), 'DEFEITO: o `u401` não ficou na memória — a 2ª vez seria igual à 1ª, pra sempre');
  await passar(ap);
  assert.deepEqual(ap.efetiva(), [], 'o envenenado de 401 nunca saiu');
  assert.equal(ap.med.envios.filter((e) => /P401a/.test(e)).length, 2);
});

test('Gravação que PEGA: a lembrança em memória sai, o aparelho recebe a fila efetiva, e o MESMO pedido que volta (outro `t`) não é escondido', async () => {
  const ap = aparelho({ itens: [ITEM(1), ITEM(2, { venueID: 'P503z' }), ITEM(3)], modo: 'recusa' });
  await passar(ap);
  assert.ok(ap.deps.saidaTiradosSemGravar.size > 0, 'PRÉ-CONDIÇÃO: o aparelho recusou e a memória lembra');
  assert.equal(ap.noAparelho().length, 3, 'PRÉ-CONDIÇÃO: o aparelho não gravou nada');
  ap.est.modo = 'grava';
  const lista = ap.efetiva();
  lista.push(ITEM(1, { t: 9999 }));                         // o mesmo pedido de novo, outra decisão
  assert.equal(ap.salvarFilaDeSaida(lista), true);
  assert.equal(ap.deps.saidaTiradosSemGravar.size, 0, 'a gravação que pegou não limpou a lembrança');
  assert.deepEqual(ap.efetiva().map((x) => [x.venueID, x.t, x.tt]), [['x3', 1003, undefined], ['P503z', 1002, 1], ['x1', 9999, undefined]],
    'o que o aparelho passou a ter não é a fila efetiva (com a marca e a ordem) mais o item novo');
});

test('Entre abas o at-least-once continua: cada aba envia UMA vez o que o aparelho ainda guarda (R24 d)', async () => {
  const guardado = new Map([['waze_places_saida', JSON.stringify([ITEM(1), ITEM(2)])]]);
  const A = aparelho({ itens: [ITEM(1), ITEM(2)], modo: 'recusa', guardado, nome: 'A' });
  const B = aparelho({ itens: [ITEM(1), ITEM(2)], modo: 'recusa', guardado, nome: 'B' });
  await passar(A); await passar(B);
  await passar(A); await passar(B);
  assert.deepEqual(A.med.envios, ['reject|"x1"|"y1"@A', 'reject|"x2"|"y2"@A'], 'a aba A mandou mais (ou menos) de uma vez cada');
  assert.deepEqual(B.med.envios, ['reject|"x1"|"y1"@B', 'reject|"x2"|"y2"@B'], 'a aba B mandou mais (ou menos) de uma vez cada');
});

test('O resumo do diagnóstico leva `lembradosSemGravar`: só as decisões que JÁ SAÍRAM (não as marcas) (R24-4-08)', async () => {
  const ap = aparelho({ itens: [ITEM(1), ITEM(2), ITEM(3, { venueID: 'P503q' })], modo: 'recusa' });
  assert.equal(ap.diagResumoDaSaida().lembradosSemGravar, 0);
  await passar(ap);                                         // x1 e x2 saem; o envenenado fica com uma MARCA (não conta)
  const r = ap.diagResumoDaSaida();
  assert.equal(r.lembradosSemGravar, 2, `a contagem das decisões enviadas e não removidas: ${JSON.stringify(r)}`);
  assert.equal(r.n, 1, '«esperando envio» é a fila efetiva (só o envenenado)');
});

test('O «Sair» e a fonte: a lembrança continua saindo no «Sair» e NÃO na troca de conta; a estrutura é UMA só', () => {
  const sair = fatiarDe(APP_SEM, 'handleLogout');
  assert.match(sair, /saidaTiradosSemGravar\.clear\(\)/, 'o «Sair» deixou de esquecer a lembrança');
  const troca = fatiarDe(APP_SEM, 'esquecerOutraConta');
  assert.ok(!/saidaTiradosSemGravar\.clear\(\)/.test(troca), 'a troca de conta zerou a lembrança: os itens que já saíram voltariam');
  assert.match(APP_SEM, /^const saidaTiradosSemGravar = new Map\(\);/m);
  // As marcas e a ordem moram na MESMA estrutura (não há um segundo Map pelo caminho): quem as grava passa por `salvarFilaSemOs`.
  assert.match(fatiarDe(APP_SEM, 'moverProFimDaSaida'), /salvarFilaSemOs\(resto, \[\], \[\{ item: it, campos, fim: true \}\]\)/);
  assert.match(fatiarDe(APP_SEM, 'marcarNaSaida'), /salvarFilaSemOs\(f, \[\], \[\{ item: iguais\[0\], campos \}\]\)/);
});

// A GUARDA DE PROGRESSO (R24 c): a lembrança em memória é o que impede o reenvio, mas o laço do esvaziamento não
// pode DEPENDER dela — se um caminho novo escapar dela, congelar a aba (gotcha #19) ou mandar a mesma decisão de
// novo tem que continuar impossível. Aqui a lembrança é SABOTADA de propósito (`set` que não guarda nada): o laço tem
// que parar sozinho, com cada item enviado uma vez e os de outra conta tirados sem laço síncrono.
test('Guarda de progresso: com a lembrança que NÃO pega, o laço do esvaziamento termina e não manda o mesmo item de novo', async () => {
  const ap = aparelho({ itens: [ITEM(1), ITEM(2, { conta: '999' }), ITEM(3, { conta: '999', venueID: null }), ITEM(4)], modo: 'recusa' });
  ap.deps.saidaTiradosSemGravar = new (class extends Map { set() { return this; } })();
  assert.equal(await passar(ap), 'fim');
  assert.ok(!ap.est.estourou, `DEFEITO: o laço leu a fila ${ap.med.leituras}× — sem a lembrança, girava sem progresso`);
  const contados = new Map();
  for (const e of ap.med.envios) contados.set(e, (contados.get(e) || 0) + 1);
  for (const [k, n] of contados) assert.equal(n, 1, `DEFEITO: ${k} foi enviado ${n}× na MESMA passada`);
  assert.ok(ap.med.envios.length <= 2, `só os 2 itens desta conta podem ir ao Waze (foram ${ap.med.envios.length})`);
});

test('Guarda de progresso: está na fonte do laço (a impressão do que a passada já tratou, e o `break` quando ele volta)', () => {
  const e = fatiarDe(APP_SEM, 'esvaziarFilaDeSaida');
  assert.match(e, /const jaTratados = new Set\(\);/);
  assert.match(e, /if \(jaTratados\.has\(impressao\)\) \{[^\n]*break; \}/, 'o laço perdeu o `break` do item que volta depois de tratado');
  assert.ok((e.match(/jaTratados\.add\(impressao\);/g) || []).length >= 3, 'os três caminhos (outra conta, sem dono e envio) têm que anotar o item tratado');
});
