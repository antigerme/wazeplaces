// js/demo-fluxo.js — o fluxo ao vivo da demo, UM leitor pras duas páginas (/demo e /palco).
//
// POST + `text/event-stream` lido por `fetch` (o segredo e a chave vão no CORPO, nunca em URL: o
// `EventSource` só faz GET). O servidor manda o estado INTEIRO a cada mudança, então reconectar é só
// abrir de novo — nenhuma mensagem perdida precisa de remendo. Aqui mora só o transporte: reconexão com
// recuo, vigia de conexão muda e a leitura dos eventos. O que uma visão significa é de quem chama.
//
// Script clássico em IIFE (os nomes não disputam o escopo global das páginas). Em Node (um teste) só
// expõe as funções puras.
(function () {
  'use strict';

  const RECUO_MS = [1000, 2000, 4000, 8000];
  const SEM_BYTES_MS = 45000;   // o servidor manda um batimento a cada 20 s

  // Eventos COMPLETOS de um texto SSE já acumulado, e o resto que ainda não fechou. Linha que começa com
  // ':' é batimento.
  function lerEventos(texto) {
    const eventos = [];
    const blocos = texto.split(/\r?\n\r?\n/);
    const resto = blocos.pop();
    for (const b of blocos) {
      let nome = 'message';
      const dados = [];
      for (const linha of b.split(/\r?\n/)) {
        if (!linha || linha[0] === ':') continue;
        const i = linha.indexOf(':');
        const campo = i < 0 ? linha : linha.slice(0, i);
        const valor = i < 0 ? '' : linha.slice(i + 1).replace(/^ /, '');
        if (campo === 'event') nome = valor;
        else if (campo === 'data') dados.push(valor);
      }
      if (dados.length) eventos.push({ nome, dados: dados.join('\n') });
    }
    return { eventos, resto };
  }

  // O tempo até a próxima tentativa (1 s, 2 s, 4 s, 8 s…), com um pouco de jitter: a sala inteira perdendo o
  // sinal junto não volta no mesmo milissegundo.
  const recuoDaTentativa = (n, aleatorio) => RECUO_MS[Math.min(Math.max(n, 1) - 1, RECUO_MS.length - 1)] + (aleatorio === undefined ? Math.random() : aleatorio) * 500;

  // Cria o fluxo. `opcoes`:
  //   corpo()          o corpo do POST (chamado a CADA conexão: a chave pode ter mudado)
  //   aoEstado(visao)  uma visão chegou
  //   aoRecusa(corpo, status)  o servidor recusou: devolve 'parar' (some de vez), 'religar' (tenta de novo no
  //                    recuo) ou nada (= 'religar')
  //   aoRede(estado)   'caiu' (2ª tentativa seguida) ou 'voltou' (chegou a primeira visão depois de uma queda)
  //   encerrou()       quem chama já não quer mais conexão (demo encerrada)
  function criar(opcoes) {
    const f = { abort: null, vivo: false, tentativa: 0, timer: null, ultimoByte: 0, parado: false };
    const rede = (e) => { try { if (opcoes.aoRede) opcoes.aoRede(e); } catch (err) { /* aviso nunca derruba o fluxo */ } };

    function parar() {
      f.vivo = false;
      if (f.timer) { clearTimeout(f.timer); f.timer = null; }
      if (f.abort) { try { f.abort.abort(); } catch (e) { /* já parado */ } f.abort = null; }
    }
    function religarDepois() {
      if ((opcoes.encerrou && opcoes.encerrou()) || f.parado || f.timer) return;
      f.tentativa++;
      if (f.tentativa >= 2) rede('caiu');
      f.timer = setTimeout(() => { f.timer = null; abrir(); }, recuoDaTentativa(f.tentativa));
    }
    // O recuo e o `acordar` passam pelo `abrir` (que respeita o `parado`); o `conectar` PÚBLICO é uma ordem de
    // quem chama, e reabre o que uma recusa tinha parado (a pessoa que entrou de novo na sala).
    function conectar() { f.parado = false; abrir(); }
    function abrir() {
      if ((opcoes.encerrou && opcoes.encerrou()) || f.parado || f.vivo) return;
      parar();
      f.vivo = true;
      const ctl = new AbortController();
      f.abort = ctl;
      f.ultimoByte = Date.now();
      ler(ctl).catch(() => {}).then(() => {
        if (!f.vivo || f.abort !== ctl) return;   // alguém já mandou parar ou trocou de conexão
        f.vivo = false;
        religarDepois();
      });
    }
    async function ler(ctl) {
      const vigia = setInterval(() => { if (Date.now() - f.ultimoByte > SEM_BYTES_MS) { try { ctl.abort(); } catch (e) { /* já */ } } }, 5000);
      try {
        const r = await fetch('/api/demo-ao-vivo', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opcoes.corpo()), signal: ctl.signal,
        });
        const tipo = r.headers.get('Content-Type') || '';
        if (!r.ok || !tipo.includes('text/event-stream') || !r.body) {
          let corpo = {};
          try { corpo = await r.json(); } catch (e) { corpo = {}; }
          const quer = opcoes.aoRecusa ? opcoes.aoRecusa(corpo, r.status) : 'religar';
          if (quer === 'parar') { f.parado = true; parar(); }
          return;
        }
        const dec = new TextDecoder();
        const leitor = r.body.getReader();
        let acumulado = '';
        for (;;) {
          const { value, done } = await leitor.read();
          if (done) break;
          f.ultimoByte = Date.now();
          acumulado += dec.decode(value, { stream: true });
          const lido = lerEventos(acumulado);
          acumulado = lido.resto;
          for (const ev of lido.eventos) {
            if (ev.nome !== 'estado') continue;
            let v = null;
            try { v = JSON.parse(ev.dados); } catch (e) { v = null; }
            if (!v) continue;
            if (f.tentativa > 0) { f.tentativa = 0; rede('voltou'); }
            opcoes.aoEstado(v);
          }
        }
      } finally { clearInterval(vigia); }
    }

    return {
      conectar,
      parar,
      // Voltou pra aba / a rede voltou: se a conexão morreu calada, reabre já, sem esperar o recuo.
      acordar() {
        if (f.parado || (opcoes.encerrou && opcoes.encerrou())) return;
        if (!f.vivo || Date.now() - f.ultimoByte > SEM_BYTES_MS) { parar(); abrir(); }
      },
      // O navegador disse que a rede foi embora: já conta como queda (o aviso sai na 1ª tentativa seguinte).
      caiu() { f.tentativa = Math.max(f.tentativa, 1); rede('caiu'); },
      voltouARede() { if (f.parado) return; f.tentativa = Math.max(f.tentativa, 1); parar(); abrir(); },
      get vivo() { return f.vivo; },
      get tentativa() { return f.tentativa; },
      // Só pra teste: o instante do último byte.
      get ultimoByte() { return f.ultimoByte; },
    };
  }

  const exposto = { lerEventos, recuoDaTentativa, criar, RECUO_MS, SEM_BYTES_MS };
  if (typeof window !== 'undefined') window.DemoFluxo = exposto;
  else if (typeof globalThis !== 'undefined') globalThis.DemoFluxo = exposto;
})();
