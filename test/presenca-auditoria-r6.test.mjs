// A presença e a conversa depois da auditoria de 2026-10-01 (rodada 6, R6-5):
// a dívida do "lida" que abrir outra conversa apagava, o "invisível" pendente
// que fechar o app perdia, o diário cheio do desligar repetido, o banner do
// Desfazer por cima da conversa e a conversa sem saída na espera do perfil. Os
// rótulos R6-5-n são os do relatório dessa rodada. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
//
// Dois instrumentos: o js/presenca.js INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs`, e as funções do app.js FATIADAS e rodadas num escopo
// de mentira (o padrão de test/presenca-wme.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const EU = '12444348';
const CAF = '183164343';
const OUTRA = '555000111';
const APP_CTX = { app: 'wazeplaces' };
const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const inbox = (bytes, n = 1) => ({ inboxMessage: { messageId: uuid(900 + n), messageType: 'X', message: b64(bytes) } });
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
const lidas = (c, com) => c.chamadas.chat.filter((x) => x.acao === 'lida' && (!com || x.com === com));
const chega = async (c, n, de) => c.P.presencaQuadro(fluxoDe(c),
  inbox(await bytesDeMensagem({ id: uuid(n), de, para: EU, texto: 'msg ' + n, ctx: APP_CTX, ts: T + n }), n));
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };

// O Waze de mentira: o "lida" falha enquanto `rede.fora`, e `naoLida` é o que
// segue NÃO LIDO no Waze (o que a lista seguinte devolveria como "mensagem nova").
function comWaze() {
  const rede = { fora: false };
  const naoLida = new Set();
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') { naoLida.delete(x.com); return { success: true, mensagens: [], maisAntigas: false, lida: true }; }
    if (x.acao === 'lida') {
      if (rede.fora) return { success: false, errorCategory: 'transient', _motivo: 'TypeError' };
      naoLida.delete(x.com);
      return { success: true };
    }
    return { success: true };
  } } });
  return { c, rede, naoLida };
}

// A conversa com a CAF aberta, uma mensagem dela vista, e o "lida" falhando na
// rajada E no fechamento: a dívida fica.
async function comDividaDaCaf() {
  const m = comWaze();
  m.c.P.presencaAbrirConversa(CAF);
  await tick();
  m.rede.fora = true;
  await chega(m.c, 1, CAF);
  m.naoLida.add(CAF);
  await m.c.rodarTimers();                                  // a rajada: falha
  await tick();
  fechar(m.c);                                              // o fechamento paga… e falha de novo
  await tick();
  m.rede.fora = false;                                      // o sinal volta
  return m;
}

// O app.js, fatiado.
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) {
      const corpo = APP_SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
function montar(nomes, deps) {
  const chaves = Object.keys(deps);
  return new Function(...chaves, nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]));
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// ── R6-5-1: a dívida do "lida" mora num CONJUNTO, separado da rajada ────────

test('R6-5-1 abrir OUTRA conversa (mesmo vazia) não apaga a dívida do "lida": o fechamento dela a paga', async () => {
  const m = await comDividaDaCaf();
  assert.equal(lidas(m.c, CAF).length, 2, 'CONTROLE: a rajada e o fechamento tinham que ter tentado (e falhado)');
  m.c.$('conversaModal').classList.remove('hidden');
  m.c.P.presencaAbrirConversa(OUTRA);                       // a conversa com outra pessoa, sem mensagem nenhuma
  await tick();
  await m.c.rodarTimers();                                  // a rajada da outra (nada a marcar nela)
  await tick();
  fechar(m.c);
  await tick();
  assert.equal(m.naoLida.has(CAF), false, 'DEFEITO: abrir outra conversa apagou a dívida — a mensagem vista segue NÃO LIDA no Waze');
  assert.equal(lidas(m.c, CAF).length, 3, 'o "lida" devido não saiu (ou saiu mais de uma vez)');
  assert.equal(m.c.P.Presenca.lidaDevendo.size, 0, 'paga, a dívida ficou');
  // E não sai de novo no próximo `presencaSincronizar`.
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(m.c, CAF).length, 3, 'a dívida paga saiu de novo');
});

test('R6-5-1 CONTROLE: sem abrir outra conversa, a dívida sai no próximo `presencaSincronizar`', async () => {
  const m = await comDividaDaCaf();
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(m.naoLida.has(CAF), false, 'o `presencaSincronizar` deixou de pagar a dívida');
  assert.equal(lidas(m.c, CAF).length, 3);
});

test('R6-5-1 a falha que chega com a rajada de OUTRA conversa correndo também vira dívida — e o fechamento paga as duas', async () => {
  let soltarA = null;
  const naoLida = new Set([CAF]);
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') return { success: true, mensagens: [], maisAntigas: false, lida: true };
    if (x.acao === 'lida' && x.com === CAF && !soltarA) return new Promise((ok) => { soltarA = ok; });
    if (x.acao === 'lida') { naoLida.delete(x.com); return { success: true }; }
    return { success: true };
  } } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  await chega(c, 3, CAF);
  await c.rodarTimers();                                    // o "lida" da CAF sai e fica no ar
  fechar(c);
  c.$('conversaModal').classList.remove('hidden');
  c.P.presencaAbrirConversa(OUTRA);
  await tick();
  await chega(c, 4, OUTRA);
  assert.equal(c.P.Presenca.lidaPendente, OUTRA, 'CONTROLE: a rajada da outra tem que estar correndo');
  soltarA({ success: false, errorCategory: 'transient', _motivo: 'TypeError' });
  await tick();
  assert.deepEqual([...c.P.Presenca.lidaDevendo], [CAF], 'DEFEITO: a falha da CAF, com a rajada da outra correndo, nem virou dívida');
  await c.rodarTimers();                                    // a rajada da outra sai
  await tick();
  fechar(c);                                                // e o fechamento paga a dívida da CAF
  await tick();
  assert.equal(lidas(c, OUTRA).length, 1, 'a rajada da outra não saiu');
  assert.equal(lidas(c, CAF).length, 2, 'a dívida da CAF não foi paga no fechamento');
  assert.equal(naoLida.has(CAF), false, 'a mensagem vista da CAF segue não lida no Waze');
});

test('R6-5-1 a mensagem que chega FORA DA VISTA tira a dívida da conversa: pagar a marcaria como lida sem ninguém ter visto', async () => {
  const m = await comDividaDaCaf();
  assert.deepEqual([...m.c.P.Presenca.lidaDevendo], [CAF], 'CONTROLE: tem que haver a dívida');
  await chega(m.c, 2, CAF);                                 // uma mensagem NOVA da CAF, com a conversa fechada
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(m.c, CAF).length, 2, 'DEFEITO: o "lida" da conversa inteira saiu com uma mensagem que ninguém viu');
  assert.equal(m.c.P.presencaNaoLidasDe(CAF), 1, 'a mensagem nova sumiu da conta sem ter sido vista');
});

test('R6-5-1 a rajada em curso da MESMA conversa não é adiantada pela dívida: ela a cobre', async () => {
  const respostas = [{ success: false, errorCategory: 'transient', _motivo: 'TypeError' }, { success: true }, { success: true }];
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
    ? { success: true, mensagens: [], maisAntigas: false, lida: true }
    : x.acao === 'lida' ? (respostas.shift() || { success: true }) : { success: true }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  await chega(c, 5, CAF);
  await c.rodarTimers();                                    // a rajada falha: dívida (a conversa segue aberta)
  await tick();
  await chega(c, 6, CAF);                                   // chega outra, na tela: a rajada corre de novo
  await c.P.presencaSincronizar();                          // não adianta a rajada
  await tick();
  assert.equal(lidas(c, CAF).length, 1, 'o `presencaSincronizar` adiantou a rajada em curso (um pedido por mensagem)');
  await c.rodarTimers();
  await tick();
  assert.equal(lidas(c, CAF).length, 2, 'CONTROLE: a rajada tem que sair no prazo');
  assert.equal(c.P.Presenca.lidaDevendo.size, 0, 'o "lida" da rajada cobre a conversa inteira: a dívida tinha que sair');
});

test('R6-5-1 o "lida" que falha entra no diário — uma linha por minuto no máximo, com quantos vieram juntos', async () => {
  const m = await comDividaDaCaf();
  const linhas = () => m.c.chamadas.dfato.filter(([k]) => k === 'chat.lida');
  assert.deepEqual(linhas().map(([, o]) => o), [{ ok: false, categoria: 'transient', juntas: 1 }],
    'a falha do "lida" não foi pro diário (ou foi uma linha por falha)');
  // Mais uma falha, passado o minuto: uma linha, contando as duas desde a anterior.
  m.rede.fora = true;
  m.c.relogio.agora += 61_000;
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(linhas().length, 2);
  assert.deepEqual(linhas()[1][1], { ok: false, categoria: 'transient', juntas: 2 });
});

test('R6-5-1 o "Sair", a troca de conta e a queda DESCARTAM a dívida — nada sai com a sessão de outra pessoa', async () => {
  const m = await comDividaDaCaf();
  assert.equal(m.c.P.Presenca.lidaDevendo.size, 1, 'CONTROLE: tem que haver a dívida');
  // O "Sair", na ordem do `handleLogout`: a sessão, o perfil e o `authenticated`
  // saem ANTES do `presencaEsquecer`.
  m.c.API.getSession = () => null;
  m.c.AppState.profile = null;
  m.c.AppState.authenticated = false;
  m.c.P.presencaEsquecer();
  assert.equal(m.c.P.Presenca.lidaDevendo.size, 0, 'a dívida (de quem é a conversa: dado de terceiro) ficou na memória depois do "Sair"');
  // Outra conta entra: nada da anterior sai pela sessão dela.
  m.c.API.getSession = () => 'token-da-outra';
  m.c.AppState.authenticated = true;
  m.c.AppState.profile = { id: Number(CAF), userName: 'outra conta' };
  await m.c.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(m.c, CAF).length, 2, 'a dívida da conta que saiu foi paga pela sessão de outra');
});

// ── R6-5-2: o "invisível" pendente fica GRAVADO, com a conta ─────────────────

// Um aparelho: o armazenamento sobrevive à "página", a memória (presencaWme,
// AppState) não. Cada `pagina()` é uma abertura nova.
function aparelho() {
  const guardado = new Map();
  const localStorage = {
    getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => guardado.set(k, String(v)),
    removeItem: (k) => guardado.delete(k),
  };
  const pedidos = [];
  return {
    guardado, pedidos,
    gravado: () => (JSON.parse(guardado.get('waze_places_preferences') || '{}').presencaWmeDesligar || null),
    pagina({ perfil = null, resposta = { success: true }, sessao = 'tok' } = {}) {
      // A página com sessão é a LOGADA, com a sessão na memória (R11-1-02).
      const AppState = { authenticated: !!sessao, preferences: { undoEnabled: true, semUndoSeguidas: 0, presenca: true, pularGuarda: false }, profile: perfil };
      const presencaWme = { ligarNaProxima: false, desligarPendente: false, desligarEm: 0, desligarSessao: null };
      const fatos = [];
      const deps = {
        AppState, presencaWme, localStorage, PREFERENCES_KEY: constante('PREFERENCES_KEY'),
        preferenciasCarregadas: true, CONTA_KEY: constante('CONTA_KEY'),
        PRESENCA_WME_DESLIGAR_REPETIR_MS: constante('PRESENCA_WME_DESLIGAR_REPETIR_MS'),
        safeLS: { get: (k) => localStorage.getItem(k) },
        dfato: (k, o) => fatos.push([k, o]),
        API: { getSession: () => sessao, temSessaoNaMemoria: () => !!sessao, sessionToken: sessao,
          presencaWaze: async (c) => { pedidos.push(c); return typeof resposta === 'function' ? resposta() : resposta; } },
      };
      const h = montar(['marcaDaSessao', 'marcaDestaAba', 'savePreferences', 'lerPreferenciasGuardadas', 'presencaWmeDesligar',
        'presencaWmeGravarPendente', 'presencaWmeEsquecerGravado', 'presencaWmeAnotarDesligar',
        'presencaWmeRefazerDesligar', 'presencaWmeReligar', 'presencaWmeZerar'], deps);
      h.lerPreferenciasGuardadas();
      return { ...h, AppState, presencaWme, fatos };
    },
  };
}
const SEM_REDE = { success: false, errorCategory: 'transient', _motivo: 'TypeError' };
const espera = () => new Promise((r) => setTimeout(r, 0));

test('R6-5-2 o "invisível" que não saiu (sem rede) sobrevive a fechar o app: o perfil da MESMA conta, ao chegar, o manda', async () => {
  const a = aparelho();
  const p1 = a.pagina({ perfil: { id: Number(EU) }, resposta: SEM_REDE });
  p1.AppState.preferences.presenca = false;                // o interruptor
  p1.savePreferences();
  p1.presencaWmeDesligar();                                 // o gesto
  await espera();
  assert.equal(p1.presencaWme.desligarPendente, true, 'CONTROLE: sem rede, o desligar fica pendente');
  assert.deepEqual(Object.keys(a.gravado() || {}), ['conta', 'em'], 'DEFEITO: o pendente não foi gravado no aparelho');
  assert.equal(a.gravado().conta, EU);
  // Fecha o app e abre de novo: a memória é outra, o armazenamento o mesmo. O
  // perfil ainda não chegou (a carga da abertura), e a prova de rede não manda.
  const p2 = a.pagina({ perfil: null });
  assert.equal(p2.AppState.preferences.presenca, false);
  p2.presencaWmeRefazerDesligar();
  await espera();
  assert.equal(a.pedidos.length, 1, 'sem o perfil (de quem é a sessão?), o pendente saiu');
  // O perfil chega (o `definirPerfil` chama o refazer): sai, e o gravado sai junto.
  p2.AppState.profile = { id: Number(EU) };
  p2.presencaWmeRefazerDesligar();
  await espera();
  assert.deepEqual(a.pedidos.slice(1), [{ userId: EU, visivel: false }], 'DEFEITO: fechar o app perdeu o "invisível" — a pessoa segue visível no WME');
  assert.equal(a.gravado(), null, 'o "invisível" chegou e ficou gravado (sairia de novo na próxima abertura)');
  // E não sai de novo.
  const p3 = a.pagina({ perfil: { id: Number(EU) } });
  p3.presencaWmeRefazerDesligar();
  await espera();
  assert.equal(a.pedidos.length, 2, 'o "invisível" que já chegou saiu de novo');
});

test('R6-5-2 só a MESMA conta o manda — o perfil de OUTRA conta não, e o religar (ou a troca de conta) o apaga', async () => {
  const gravarPendente = async () => {
    const a = aparelho();
    const p1 = a.pagina({ perfil: { id: Number(EU) }, resposta: SEM_REDE });
    p1.AppState.preferences.presenca = false;
    p1.savePreferences();
    p1.presencaWmeDesligar();
    await espera();
    assert.ok(a.gravado(), 'CONTROLE: o pendente tem que estar gravado');
    return a;
  };
  // Outra conta.
  const outra = await gravarPendente();
  const q = outra.pagina({ perfil: { id: Number(CAF) } });
  q.presencaWmeRefazerDesligar();
  await espera();
  assert.equal(outra.pedidos.length, 1, 'DEFEITO: o "invisível" de uma conta foi pro WME no nome de OUTRA');
  // Religou à mão (o ouvinte do interruptor grava as preferências logo depois).
  const religou = await gravarPendente();
  const r = religou.pagina({ perfil: { id: Number(EU) } });
  r.AppState.preferences.presenca = true;
  r.presencaWmeReligar();
  r.savePreferences();
  assert.equal(religou.gravado(), null, 'religou e o "invisível" seguiu gravado');
  // A troca de conta: sai da memória (quem chama grava).
  const troca = await gravarPendente();
  const t1 = troca.pagina({ perfil: { id: Number(EU) } });
  assert.ok(t1.AppState.preferences.presencaWmeDesligar, 'CONTROLE: a abertura tem que ler o gravado');
  t1.presencaWmeZerar();
  assert.equal(t1.AppState.preferences.presencaWmeDesligar, undefined, 'a troca de conta deixou o "invisível" da anterior');
  // Gravado com o interruptor LIGADO (armazenamento editado, versão velha): a leitura o ignora.
  const ligado = aparelho();
  ligado.guardado.set('waze_places_preferences', JSON.stringify({ presenca: true, presencaWmeDesligar: { conta: EU, em: 1 } }));
  const l = ligado.pagina({ perfil: { id: Number(EU) } });
  assert.equal(l.AppState.preferences.presencaWmeDesligar, undefined, 'com o interruptor ligado, o "invisível" gravado foi lido');
});

test('R6-5-2 a ordem que protege a conta: o perfil confere a conta ANTES de refazer, e a troca grava o que apagou', () => {
  const def = fatiar('definirPerfil');
  const iConta = def.indexOf('aoConhecerConta(perfil);');
  const iRefazer = def.indexOf('presencaWmeRefazerDesligar();');
  assert.ok(iConta > 0 && iRefazer > iConta, 'o "invisível" gravado sairia antes de a troca de conta o apagar');
  const troca = fatiar('esquecerOutraConta');
  const iZerar = troca.indexOf('presencaWmeZerar();');
  const iGravar = troca.indexOf('esquecerEscolhasDaContaAnterior();');
  assert.ok(iZerar > 0 && iGravar > iZerar, 'a troca de conta apaga o "invisível" da memória e ninguém grava depois');
  assert.match(fatiar('esquecerEscolhasDaContaAnterior'), /savePreferences\(\);/);
  // O "Sair" repõe as preferências de fábrica (sem o gravado) e grava.
  const sair = fatiar('handleLogout');
  assert.ok(sair.indexOf('AppState.preferences = preferenciasDeFabrica();') > 0 && /savePreferences\(\);/.test(sair));
  assert.equal('presencaWmeDesligar' in new Function(fatiar('preferenciasDeFabrica') + '\nreturn preferenciasDeFabrica();')(), false);
});

// ── R6-5-3: o desligar repetido no diário, com limitador ─────────────────────

test('R6-5-3 o desligar repetido com o Waze fora não enche o diário: a mesma falha entra uma vez a cada 10 min, com o total', async () => {
  let agora = T;
  const pedidos = [];
  let resposta = { success: false, errorCategory: 'transient', errorKey: 'srv.err.connection' };
  const AppState = { authenticated: true, preferences: { presenca: false }, profile: { id: Number(EU) } };
  const presencaWme = { ligarNaProxima: false, desligarPendente: false, desligarEm: 0, desligarSessao: null };
  const fatos = [];
  const deps = {
    AppState, presencaWme, PREFERENCES_KEY: 'p', preferenciasCarregadas: false, localStorage: { setItem() {} },
    CONTA_KEY: 'c', safeLS: { get: () => null }, Date: { now: () => agora },
    PRESENCA_WME_DESLIGAR_REPETIR_MS: constante('PRESENCA_WME_DESLIGAR_REPETIR_MS'),
    dfato: (k, o) => fatos.push([k, o]),
    API: { getSession: () => 'tok', temSessaoNaMemoria: () => true, sessionToken: 'tok',
      presencaWaze: async (c) => { pedidos.push(c); return resposta; } },
  };
  const h = montar(['marcaDaSessao', 'marcaDestaAba', 'savePreferences', 'presencaWmeDesligar', 'presencaWmeGravarPendente',
    'presencaWmeEsquecerGravado', 'presencaWmeAnotarDesligar', 'presencaWmeRefazerDesligar'], deps);
  const linhas = () => fatos.filter(([k]) => k === 'presencaWme.visivel');
  h.presencaWmeDesligar();                                  // o gesto
  await espera();
  // Duas horas de triagem: uma resposta da nossa API a cada 10 s (a prova de rede).
  for (let s = 10; s <= 120 * 60; s += 10) { agora += 10_000; h.presencaWmeRefazerDesligar(); await espera(); }
  assert.ok(pedidos.length >= 120 && pedidos.length <= 121, `CONTROLE: o teto de um por minuto mudou (${pedidos.length} pedidos)`);
  assert.ok(linhas().length <= 13, `DEFEITO: ${linhas().length} linhas do desligar em 2 h — o anel (120) ficaria só com elas`);
  assert.equal(linhas()[0][1].ok, false, 'CONTROLE: o resultado do GESTO tem que ir pro diário');
  assert.equal(linhas().at(-1)[1].total >= 110, true, 'a linha não diz quantas vezes ele falhou');
  // Categoria NOVA entra na hora.
  const antes = linhas().length;
  resposta = { success: false, errorCategory: 'unauthorized' };
  agora += 61_000;
  h.presencaWmeRefazerDesligar();
  await espera();
  assert.equal(linhas().length, antes + 1, 'a falha de outro tipo tem que entrar na hora');
  assert.equal(linhas().at(-1)[1].categoria, 'unauthorized');
  // Um GESTO novo entra sempre, mesmo com a mesma falha de há pouco.
  agora += 1000;
  h.presencaWmeDesligar();
  await espera();
  assert.equal(linhas().length, antes + 2, 'o gesto de desligar sumiu do diário');
  // E o sucesso, que encerra o pendente, também.
  resposta = { success: true };
  agora += 61_000;
  presencaWme.desligarSessao = 'outra';                     // (sem esperar o teto)
  h.presencaWmeRefazerDesligar();
  await espera();
  assert.deepEqual(linhas().at(-1)[1], { desligou: true, via: 'interruptor', ok: true });
  assert.equal(presencaWme.desligarPendente, false);
});

// O 401 do desligar com a sessão VIVA (o caso do R5-5-8): cada repetição — uma
// por minuto, o teto — conferia a sessão de novo, e cada conferência era uma
// sonda do perfil e um "Sua sessão continua válida" na cara de quem tria. Com a
// sessão confirmada viva DEPOIS do 401 que a conferiu, a repetição não confere
// mais (o critério do `u401` da fila de saída). Aqui o `handleUnauthorized` é o
// DE VERDADE, fatiado, com a sonda de mentira (`API.getProfile`).
function montarDesligar401({ sonda }) {
  const relogio = { agora: T };
  const pedidos = [], toasts = [], quedas = [], fatos = [];
  const sondas = { n: 0 };
  const sessao = { token: 'tok-A' };
  const AppState = { authenticated: true, preferences: { presenca: false }, profile: { id: Number(EU) } };
  const presencaWme = { ligarNaProxima: false, desligarPendente: false, desligarEm: 0, desligarSessao: null, desligar401Em: null };
  const deps = {
    AppState, presencaWme, Date: { now: () => relogio.agora },
    PRESENCA_WME_DESLIGAR_REPETIR_MS: constante('PRESENCA_WME_DESLIGAR_REPETIR_MS'),
    preferenciasCarregadas: false, localStorage: { setItem() {} }, PREFERENCES_KEY: 'p',
    safeLS: { get: () => null }, CONTA_KEY: 'c',
    dfato: (k, o) => fatos.push([k, o]), dlog: () => {}, dlogCapturarAuto: () => {},
    VERIFICA_SESSAO_MS: 0, setTimeout,
    API: {
      getSession: () => sessao.token,
      temSessaoNaMemoria: () => !!sessao.token,   // a sessão desta aba é a da memória (R11-1-02)
      get sessionToken() { return sessao.token; },
      getRegion: () => 'row',   // a região em que a sonda pergunta (R8-6-03)
      // O Waze da presença recusa o "invisível" com 401, com a sessão viva.
      presencaWaze: async (c) => { pedidos.push(c); return { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.cookiesExpired', httpCode: 401 }; },
      // A sonda leva o seu tempo: a confirmação é DEPOIS do 401.
      getProfile: async () => { sondas.n++; relogio.agora += 1500; return sonda; },
    },
    // As variáveis de módulo que a conferência e a prova de vida usam.
    verificandoSessao: false, conferenciaDaSessao: null, sessaoVivaEm: { s: null, em: 0 }, epocaDaSessao: 0,
    derrubarSessao: (k) => quedas.push(k), showAccessDenied: () => {}, showAuthScreen: () => {},
    definirPerfil: () => true, completarPerfilChegado: () => {},
    anotarEditaveis: () => {},   // os editáveis do perfil da sonda (R8-6-03): aqui, nada a anotar
    showToast: (k) => toasts.push(k), t: (k) => k,
    rebuscarDepoisDeFalha: () => {}, esvaziarFilaDeSaida: () => {},
  };
  const h = montar(['marcaDaSessao', 'marcaDestaAba', 'savePreferences', 'marcarSessaoViva', 'sessaoVivaDepoisDe', 'handleUnauthorized',
    'presencaWmeDesligar', 'presencaWmeGravarPendente', 'presencaWmeEsquecerGravado', 'presencaWmeAnotarDesligar',
    'presencaWmeRefazerDesligar'], deps);
  const assentar = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    h, pedidos, toasts, quedas, presencaWme, sessao, assentar,
    sondas: () => sondas.n,
    passar: (ms) => { relogio.agora += ms; },
    linhas: () => fatos.filter(([k]) => k === 'presencaWme.visivel'),
  };
}

test('R6-5-3 (sobra) com a sessão CONFIRMADA viva depois do 401, a repetição do desligar não confere de novo — nada de sonda e "Sua sessão continua válida" a cada minuto', async () => {
  const m = montarDesligar401({ sonda: { success: true, profile: { id: Number(EU) } } });
  m.h.presencaWmeDesligar();                                // o gesto: 401
  await m.assentar();
  assert.equal(m.sondas(), 1, 'CONTROLE: o PRIMEIRO 401 tem que conferir a sessão');
  assert.deepEqual(m.toasts, ['toast.sessionKeptAlive']);
  // Cinco minutos de triagem: uma resposta da nossa API a cada 10 s (a prova de rede).
  for (let s = 10; s <= 300; s += 10) { m.passar(10_000); m.h.presencaWmeRefazerDesligar(); await m.assentar(); }
  assert.ok(m.pedidos.length >= 5 && m.pedidos.length <= 6, `CONTROLE: o teto de um por minuto mudou (${m.pedidos.length} pedidos)`);
  assert.equal(m.sondas(), 1, `DEFEITO: a repetição do desligar conferiu a sessão de novo (${m.sondas()} sondas em 5 min)`);
  assert.deepEqual(m.toasts, ['toast.sessionKeptAlive'], 'um "Sua sessão continua válida" a cada minuto, na cara de quem tria');
  assert.equal(m.presencaWme.desligarPendente, true, 'o "invisível" deixou de ficar pendente');
  assert.equal(m.linhas().length, 1, 'o diário não anotou pelo limitador (o gesto e mais nada em 5 min)');
  // Um gesto NOVO é uma série nova: o 401 dele confere de novo.
  m.passar(1000);
  m.h.presencaWmeDesligar();
  await m.assentar();
  assert.equal(m.sondas(), 2, 'o 401 do gesto novo não conferiu a sessão');
});

test('R6-5-3 (sobra) CONTROLE: sem prova de vida a repetição confere de novo, a sessão morta de verdade cai, e numa sessão NOVA o 401 confere', async () => {
  // (a) A sonda não deu pra saber (5xx): não é prova de vida — a repetição confere.
  const a = montarDesligar401({ sonda: { success: false, errorCategory: 'transient', httpCode: 502 } });
  a.h.presencaWmeDesligar();
  await a.assentar();
  a.passar(61_000);
  a.h.presencaWmeRefazerDesligar();
  await a.assentar();
  assert.equal(a.pedidos.length, 2, 'CONTROLE: a repetição tem que ter saído');
  assert.equal(a.sondas(), 2, 'sem a sessão confirmada viva, a repetição deixou de conferir');
  // (b) A sessão morta de verdade: a sonda diz "não autoriza", e ela cai.
  const b = montarDesligar401({ sonda: { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionExpired' } });
  b.h.presencaWmeDesligar();
  await b.assentar();
  assert.deepEqual(b.quedas, ['srv.err.sessionExpired'], 'a sessão morta de verdade não caiu');
  // (c) Confirmada viva na sessão A; a renovação traz OUTRA sessão: o 401 dela confere.
  const c = montarDesligar401({ sonda: { success: true, profile: { id: Number(EU) } } });
  c.h.presencaWmeDesligar();
  await c.assentar();
  c.sessao.token = 'tok-novo';
  c.passar(1000);
  c.h.presencaWmeRefazerDesligar();
  await c.assentar();
  assert.equal(c.pedidos.length, 2, 'CONTROLE: numa sessão nova o pendente sai já');
  assert.equal(c.sondas(), 2, 'a prova de vida da sessão ANTERIOR dispensou a conferência do 401 da nova');
});

// ── R6-5-4: a folha da presença despacha a janela do Desfazer ────────────────

test('R6-5-4 abrir a lista (a pílula) e abrir a conversa DESPACHAM a janela do Desfazer — o banner não fica por cima da folha', () => {
  const c = novoCliente();
  c.P.presencaMontar();
  c.$('presencaPill').disparar('click');
  assert.equal(c.chamadas.despacharJanela, 1, 'abrir a lista deixou a janela do Desfazer correndo por baixo dela');
  assert.deepEqual(c.chamadas.openModal, ['presencaModal'], 'CONTROLE: a pílula tem que abrir a lista');
  c.P.presencaAbrirConversa(CAF);
  assert.equal(c.chamadas.despacharJanela, 2, 'abrir a conversa deixou a janela do Desfazer correndo por baixo dela');
  // A folha na tela é a régua de quem decide a próxima janela (ver o `scheduleAction`).
  assert.equal(c.P.presencaFolhaAberta(), true);
  fechar(c);
  c.$('presencaModal').classList.add('hidden');
  assert.equal(c.P.presencaFolhaAberta(), false, 'CONTROLE: com a folha fechada, a janela volta a abrir');
});

test('R6-5-4 despachar: a janela do card e as do lightbox SAEM, e o banner sai com elas', () => {
  const log = [];
  const AppState = { pendingAction: { execute: () => log.push('card') } };
  const { despacharJanelaDoDesfazer } = montar(['despacharJanelaDoDesfazer'], {
    AppState, enviarPendenciasDoLightbox: () => log.push('lightbox'), removeUndoBanner: () => log.push('banner'),
  });
  despacharJanelaDoDesfazer();
  assert.deepEqual(log, ['card', 'lightbox', 'banner']);
  assert.equal(AppState.pendingAction, null);
  // Sem janela nenhuma, nada a despachar (e nada lança).
  log.length = 0;
  despacharJanelaDoDesfazer();
  assert.deepEqual(log, ['lightbox', 'banner']);
});

function montarAgenda({ folha }) {
  const AppState = { pendingAction: null, preferences: { undoEnabled: true }, stats: { read: 0, rejected: 1, skipped: 0 },
    serverTotal: 10, queue: [], inFlightActions: 0 };
  const log = [];
  const deps = {
    AppState, dlog: () => {}, dlogPlace: () => null,
    marcarEmAndamento: () => {}, removeUndoBanner: () => {}, aplicarTravaDeAcao: () => {}, updateInFlightIndicator: () => {},
    canDisableUndo: () => false, registrarJanelaSemUndo: () => {}, zerarJanelasSemUndo: () => {},
    updateStats: () => {}, saveStats: () => {}, updatePendingCount: () => {}, showCurrentPlace: () => {},
    showUndoBanner: () => log.push('banner'), t: (k) => k, enfileirarSaida: () => true, API: { getRegion: () => 'row' },
    setTimeout: () => { log.push('janela'); return 1; }, clearTimeout: () => {}, UNDO_WINDOW_MS: 3000,
    console: { error: () => {} }, reivindicacaoDestaAba: () => null,
    presencaFolhaAberta: () => folha,
  };
  const { scheduleAction } = montar(['scheduleAction', 'atenderOFimDaJanela'], deps);
  return { scheduleAction, AppState, log };
}

test('R6-5-4 a decisão que CHEGA com a folha da presença aberta sai na hora — a janela não abre por baixo dela', async () => {
  const m = montarAgenda({ folha: true });
  let saiu = 0;
  m.scheduleAction('reject', { venueID: 'v1', updateRequestID: 'u1' }, async () => { saiu++; });
  await tick();
  assert.equal(saiu, 1, 'DEFEITO: com a folha aberta, a decisão ficou esperando a janela');
  assert.deepEqual(m.log, [], 'a janela (e o banner) abriu por baixo da folha');
  assert.equal(m.AppState.pendingAction, null);
  // CONTROLE: sem a folha, a janela abre como sempre — e um valor que só PARECE verdadeiro não conta.
  for (const folha of [false, 'sim', {}]) {
    const c = montarAgenda({ folha });
    let saiuC = 0;
    c.scheduleAction('reject', { venueID: 'v2', updateRequestID: 'u2' }, async () => { saiuC++; });
    await tick();
    assert.equal(saiuC, 0, `sem a folha (${JSON.stringify(folha)}), a decisão saiu sem a janela`);
    assert.deepEqual(c.log, ['janela', 'banner']);
    assert.ok(c.AppState.pendingAction);
  }
});

// ── R6-5-5: a conversa na espera do perfil tem saída ─────────────────────────

test('R6-5-5 na espera do perfil, abrir a conversa, os dois "Tentar de novo" e o "Enviar" PEDEM o perfil — e o "Enviar" não fica calado', async () => {
  const c = novoCliente({ agora: T });
  c.P.presencaMontar();
  c.AppState.profile = null;                                // a renovação: a sessão voltou, o perfil não
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.equal(c.chamadas.refazerPerfil, 1, 'abrir a conversa na espera não pediu o perfil');
  assert.equal(c.chamadas.chat.length, 0, 'CONTROLE: na espera nada sai');
  c.P.presencaCarregarConversa(CAF);                        // o "Tentar de novo" do histórico
  assert.equal(c.chamadas.refazerPerfil, 2, 'o "Tentar de novo" do histórico não pediu o perfil');
  c.$('conversaInput').value = 'oi na espera';
  c.$('conversaForm').disparar('submit');
  await tick();
  assert.equal(c.chamadas.refazerPerfil, 3, 'o "Enviar" na espera não pediu o perfil');
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'enviar').length, 0, 'saiu sem saber de quem é a sessão');
  assert.match(c.$('conversaMsgs').innerHTML, /oi na espera[\s\S]*presenca\.recibo\.naoEnviadaErro/,
    'DEFEITO: o "Enviar" na espera não disse nada — a mensagem não está na conversa como "Não enviada."');
  assert.deepEqual(c.chamadas.dfato.filter(([k]) => k === 'chat.envio').map(([, o]) => o.categoria), ['semPerfil'],
    'a mensagem que nem saiu não foi pro diário');
  c.P.presencaTentarDeNovo();                               // o "Tentar de novo" da mensagem
  assert.equal(c.chamadas.refazerPerfil, 4, 'o "Tentar de novo" da mensagem não pediu o perfil');
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'enviar').length, 0);
  // CONTROLE: com o perfil, nenhum desses gestos pede o perfil — e o "Tentar de novo" manda.
  const d = novoCliente({ agora: T });
  d.P.presencaMontar();
  d.P.presencaAbrirConversa(CAF);
  await tick();
  d.$('conversaInput').value = 'oi';
  d.$('conversaForm').disparar('submit');
  await tick();
  d.P.presencaTentarDeNovo();
  assert.equal(d.chamadas.refazerPerfil, 0, 'com o perfil na mão, um gesto pediu o perfil de novo');
  assert.equal(d.chamadas.chat.filter((x) => x.acao === 'enviar').length, 1);
});
