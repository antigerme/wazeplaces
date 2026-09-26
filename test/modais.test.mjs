// Modais: o que acontece com o de BAIXO quando outro abre por cima.
//
// Modais não empilham — `openModal` esconde o que estiver aberto. Até a
// auditoria de 2026-09-25 ele só ESCONDIA, e o modal escondido não passava pela
// limpeza dele (`LIMPEZA_AO_FECHAR`), que só o `closeModal` chamava. Dois
// defeitos com a mesma raiz:
//   · Filtros → Histórico → "Resumo do mês": a escada aberta e a conquista
//     tocada voltavam na próxima abertura de Filtros (H15);
//   · a conversa escondida pelo pedido que chegou nela seguia "aberta" (achado
//     da presença).
// E o foco: fechar o Resumo devolvia o foco ao botão DENTRO de Filtros, que
// estava escondido — o foco caía no `<body>`.
//
// O que NÃO pode acontecer no conserto é chamar o `closeModal` no lugar da
// limpeza: ele agenda um `history.back()`, que come a entrada que a camada
// acabou de empilhar, e o voltar do aparelho passa a tirar a pessoa do app
// (gotcha #65). Os testes contam o `consumir` por isso.
//
// Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Do `{`/`[` que abre até o que fecha, contando só o delimitador pedido.
function fecharDelimitador(txt, i, abre, fecha) {
  let prof = 0;
  for (let j = txt.indexOf(abre, i); j < txt.length; j++) {
    if (txt[j] === abre) prof++;
    else if (txt[j] === fecha) { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fecharDelimitador(APP_SEM, i, '{', '}'));
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
function fatiarConst(nome, abre, fecha) {
  const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP_SEM);
  assert.ok(m, `const ${nome} sumiu do app.js`);
  return APP_SEM.slice(m.index, fecharDelimitador(APP_SEM, m.index, abre, fecha)) + ';';
}

// Um DOM mínimo: os modais, o botão que abre Filtros e o botão do Resumo, que
// mora DENTRO de Filtros. `hidden` do botão de dentro acompanha o do modal.
function montar() {
  const doc = { activeElement: null };
  const els = new Map();
  const elemento = (id, dentroDe = null) => {
    const classes = new Set();
    const el = {
      id,
      classList: {
        add: (c) => classes.add(c), remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, f) => { const ter = f === undefined ? !classes.has(c) : !!f; if (ter) classes.add(c); else classes.delete(c); return ter; },
      },
      // Focar um elemento ESCONDIDO não pega, como no navegador: o foco fica
      // onde estava (o `<body>`, no caso que interessa).
      focus() {
        const escondido = classes.has('hidden') || (dentroDe && els.get(dentroDe).classList.contains('hidden'));
        if (!escondido) doc.activeElement = el;
      },
      // O que o `focavelNaTela` do fechar de modal consulta: escondido não tem
      // caixa na tela, e o que mora dentro de um modal está numa CAMADA.
      isConnected: true,
      disabled: false,
      getClientRects() {
        const escondido = classes.has('hidden') || (dentroDe && els.get(dentroDe).classList.contains('hidden'));
        return escondido ? [] : [{}];
      },
      closest: (sel) => (sel === '[role="dialog"]' ? (dentroDe ? els.get(dentroDe) : (id.endsWith('Modal') ? el : null)) : null),
      querySelector: () => els.get(id + '_fechar') || null,
    };
    els.set(id, el);
    return el;
  };
  const MODAIS = ['filtersModal', 'resumoModal', 'helpModal', 'conversaModal', 'pedidoModal', 'presencaModal'];
  for (const id of MODAIS) { elemento(id).classList.add('hidden'); elemento(id + '_fechar', id); }
  const filtersBtn = elemento('filtersBtn');
  const resumoBotao = elemento('resumoBotao', 'filtersModal');
  const body = { id: 'body', style: {}, contains: (el) => !!el && els.get(el.id) === el };
  doc.activeElement = body;
  const document = Object.assign(doc, { body, getElementById: (id) => els.get(id) || null });

  const camada = { empilhar: 0, consumir: 0 };
  const presenca = { esquecerAberta: 0, esquecerLista: 0 };
  const deps = {
    document,
    dfato: () => {},
    Lightbox: { isOpen: () => false },
    CamadaVoltar: { empilhar: () => { camada.empilhar++; }, consumir: () => { camada.consumir++; } },
    window: { Presenca: { esquecerAberta: () => { presenca.esquecerAberta++; }, esquecerLista: () => { presenca.esquecerLista++; } } },
    URL: { revokeObjectURL: () => {} },
    pararTickerPareamento: () => {}, limparQrPareamento: () => {},
  };
  const corpo = [
    // O estado de VISUALIZAÇÃO que a limpeza de Filtros zera (módulo, no app).
    'let autoresExpandido = false, escadaAberta = false, conquistaTocada = null, novasDestaAbertura = null;',
    'let resumoAtual = null, lastFocusedBeforeModal = null, ultimoFocoForaDasCamadas = null;',
    fatiarConst('MODAL_IDS', '[', ']'),
    fatiar('openModal'), fatiar('closeModal'), fatiar('topOpenModal'),
    fatiar('devolverFoco'), fatiar('focavelNaTela'), fatiar('dentroDeCamada'),
    fatiarConst('LIMPEZA_AO_FECHAR', '{', '}'),
    'return { openModal, closeModal,',
    '  mexerNoHistorico: () => { escadaAberta = true; conquistaTocada = "coruja"; autoresExpandido = true; },',
    '  visao: () => ({ escadaAberta, conquistaTocada, autoresExpandido }) };',
  ].join('\n');
  const chaves = Object.keys(deps);
  const api = new Function(...chaves, corpo)(...chaves.map((k) => deps[k]));
  return { ...api, document, els, camada, presenca, filtersBtn, resumoBotao, body };
}
const visivel = (m, id) => !m.els.get(id).classList.contains('hidden');

test('abrir um modal POR CIMA roda a limpeza do de baixo — Resumo do mês sobre Filtros não vaza a escada', () => {
  const m = montar();
  m.document.activeElement = m.filtersBtn;
  m.openModal('filtersModal');
  m.mexerNoHistorico();                       // escada aberta, coruja tocada, lista expandida
  m.document.activeElement = m.resumoBotao;   // o toque no "Compartilhar meu resumo"
  m.openModal('resumoModal');
  assert.ok(!visivel(m, 'filtersModal') && visivel(m, 'resumoModal'), 'o Resumo não substituiu Filtros');
  assert.deepEqual(m.visao(), { escadaAberta: false, conquistaTocada: null, autoresExpandido: false },
    'Filtros saiu da tela sem a limpeza dele: a escada e a conquista tocada voltam na próxima abertura');
  // O conserto NÃO pode passar pelo closeModal: trocar de modal é a mesma
  // camada, e o history.back() agendado comeria a entrada (gotcha #65).
  assert.equal(m.camada.empilhar, 1, 'trocar de modal empilhou outra entrada de histórico');
  assert.equal(m.camada.consumir, 0,
    'trocar de modal consumiu a entrada da camada — o próximo voltar tiraria a pessoa do app');
});

test('fechar o Resumo devolve o foco a quem abriu a CAMADA, não ao botão escondido de Filtros', () => {
  const m = montar();
  m.document.activeElement = m.filtersBtn;
  m.openModal('filtersModal');
  m.document.activeElement = m.resumoBotao;
  m.openModal('resumoModal');
  m.closeModal('resumoModal');
  assert.equal(m.document.activeElement, m.filtersBtn,
    `o foco foi para ${m.document.activeElement && m.document.activeElement.id} — o botão de dentro de Filtros está escondido e o foco se perde no <body>`);
  assert.equal(m.camada.consumir, 1, 'fechar a camada tem que consumir UMA entrada');
});

test('a conversa escondida pelo pedido que chegou nela é SOLTA (a limpeza dela roda)', () => {
  const m = montar();
  m.openModal('presencaModal');
  m.openModal('conversaModal');              // abrir uma conversa pela lista
  assert.equal(m.presenca.esquecerLista, 1, 'a lista escondida pela conversa ficou desenhada no DOM');
  m.openModal('pedidoModal');                // tocar no cartão que veio na conversa
  assert.equal(m.presenca.esquecerAberta, 1,
    'a conversa saiu da tela sem soltar o `aberta` — a próxima mensagem dela não viraria aviso');
  assert.equal(m.camada.empilhar, 1);
  assert.equal(m.camada.consumir, 0);
});

test('CONTROLE: só roda a limpeza do que ESTAVA na tela, e nunca a do próprio modal que abre', () => {
  const m = montar();
  // Nada aberto: nenhuma limpeza (a de Filtros zeraria o estado sem motivo).
  m.mexerNoHistorico();
  m.openModal('helpModal');
  assert.deepEqual(m.visao(), { escadaAberta: true, conquistaTocada: 'coruja', autoresExpandido: true },
    'rodou a limpeza de um modal que já estava fechado');
  // Reabrir o MESMO modal não o limpa: a conversa reaberta com outra pessoa
  // já escreveu o `aberta` novo ANTES do openModal.
  m.openModal('conversaModal');
  const antes = m.presenca.esquecerAberta;
  m.openModal('conversaModal');
  assert.equal(m.presenca.esquecerAberta, antes, 'reabrir a conversa soltou a que acabou de abrir');
});
