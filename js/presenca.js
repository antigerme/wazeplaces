// Presença e conversa entre editores — quem mais está triando a MESMA fila que
// você, e um jeito de falar com essa pessoa.
//
// ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
// Triar pedido é trabalho solitário: você abre a app, faz 40 swipes e fecha,
// sem sinal nenhum de que tem mais gente do outro lado fazendo o mesmo. A
// companhia já estava lá — dá pra notar pedidos sumindo da própria fila —, só
// não estava VISÍVEL. A pílula do cabeçalho é isso: você não está sozinho.
//
// ── ONDE A MENSAGEM PASSA (e onde NÃO passa) ────────────────────────────────
// O servidor só transporta o APERTO DE MÃO do WebRTC (offer/answer/ICE). O
// texto vai por um DataChannel, cifrado com DTLS, direto entre os dois
// aparelhos — não passa pelo nosso servidor nem fica guardado em lugar nenhum.
// Fechou a conversa, acabou: não há histórico pra buscar depois, e isso é
// decisão, não pendência.
//
// ── O QUE O SERVIDOR SABE ───────────────────────────────────────────────────
// Enquanto a conexão está aberta: seu nome do WME, rank, se é AM, e a fila
// escolhida. Nada em disco. Socket fechou, some — a presença É a conexão.
//
// ── QUEM DIZ QUE VOCÊ É VOCÊ ────────────────────────────────────────────────
// O nome NÃO sai daqui. Ele vem num CRACHÁ assinado pelo servidor, que o
// emitiu depois de chamar o `/Session` do Waze com os cookies da sua sessão.
// Aqui o nome carrega reputação (rank, Area Manager): se o cliente pudesse
// dizer o próprio nome, a lista seria um convite a se passar por autoridade.
//
// O `sessionToken` NUNCA entra aqui. Ele é metade da chave que decifra os
// cookies (gotcha #60) e viaja só no corpo do POST; o WebSocket carrega a URL
// pro log de acesso, então o que vai na URL é o nome da sala, e o crachá vai
// na primeira MENSAGEM.

// Chave de uma versão anterior, que teve bloqueio de pessoa. O recurso saiu (a
// app só admite editor L3+ AM, e abuso se resolve no Waze, não aqui), mas quem
// já tinha bloqueado alguém ficou com o registro no aparelho. Apagamos uma vez,
// na carga — dado órfão de recurso removido não deve envelhecer em silêncio.
const PRESENCA_CHAVE_ANTIGA_BLOQUEIO = 'waze_places_bloqueados';

// Keepalive. Na Cloudflare quem responde é o RUNTIME (auto-response), sem
// acordar o Durable Object; na VM responde o processo. O cliente manda o mesmo
// `ping` nos dois — ele não precisa saber em qual servidor está.
const PRESENCA_KEEPALIVE_MS = 45_000;

// Prazo pro `pong` voltar depois de um `ping`. É o que transforma o keepalive
// em DETECÇÃO — antes ele só falava sozinho.
//
// O defeito que isto conserta, relatado pelo owner ("muitas vezes o App só
// mostra que tem alguém online quando atualizo a página"): quando a conexão
// morre EM SILÊNCIO — sem quadro de fechamento, que é o caso comum em rede
// móvel, NAT e proxy —, o `readyState` fica OPEN pra sempre e o `onclose`
// NUNCA dispara. O cliente segue achando que está conectado, mandando ping pro
// vazio, com a lista vazia. Só recarregar resolvia.
//
// MEDIDO com um proxy que para de repassar nos dois sentidos sem fechar nada:
// 70 segundos depois, `readyState=1`, zero tentativas de religar, e a lista
// vazia enquanto havia gente na sala. E do outro lado é pior: os colegas
// continuam VENDO quem já não está lá, porque pro servidor o socket também
// parece vivo.
//
// 10s é folgado pro pong: quem responde é o runtime da Cloudflare (sem nem
// acordar o Durable Object) ou o processo na VM — nenhum dos dois pensa.
const PRESENCA_PONG_MS = 10_000;

// Ao voltar pra tela, o prazo é mais curto: o aparelho provavelmente dormiu e
// o socket provavelmente morreu. Esperar os 45s do keepalive aqui seria deixar
// a pessoa olhando uma lista mentirosa justo no momento em que ela voltou pra
// usar a app.
const PRESENCA_PONG_VOLTA_MS = 4000;

// Rede de segurança pra lista velha.
//
// A sala só DIFUNDE em entrada e saída. Se a conexão piscar exatamente nesse
// instante, a mensagem se perde e ninguém reenvia — MEDIDO: com os pacotes
// engolidos por 20s e a rede voltando, o socket segue vivo e a lista fica vazia
// pra sempre. Era este o relato do owner.
//
// O pedido é BARATO no servidor mas NÃO é de graça na Cloudflare: ele acorda o
// Durable Object, ao contrário do `ping`, que o runtime responde sozinho. Por
// isso 2 minutos, e não os 45s do keepalive: 30 acordadas por hora por editor
// em vez de 80. Os momentos que realmente importam são cobertos por evento
// (voltar pra tela, rede voltar, abrir a lista) e não pagam esta conta.
const PRESENCA_RESSINC_MS = 2 * 60 * 1000;

// Prazo pra conexão DAR CERTO — do `new WebSocket` até o `eu` do servidor.
//
// Sem isto o cliente pendura pra sempre: um socket que nunca completa o
// handshake não dispara `onopen`, nem `onerror`, nem `onclose`. MEDIDO, e foi
// assim que apareceu: o religamento saiu no meio de uma interrupção de rede, o
// `readyState` ficou em 0 (CONNECTING) e ali permaneceu — 35 segundos depois de
// a rede ter voltado, nada. Como o recuo só é reagendado a partir de um desses
// eventos, uma única tentativa infeliz encerrava as tentativas pra sempre.
//
// O marco é o `eu`, e não o `onopen`: abrir o socket não prova nada (a recusa
// do crachá vem depois). É o mesmo motivo que faz o recuo zerar só no `eu`.
const PRESENCA_ABRIR_MS = 12_000;

// Prazo pra confirmação de ENTREGA de uma mensagem voltar.
//
// Aqui isto vale mais que num app de mensagem comum, e a diferença é a
// arquitetura: o WhatsApp tem servidor guardando, então "um tique" significa
// "está a caminho, chega quando ela abrir". NÓS não temos — o texto vai direto
// de um aparelho pro outro. Se o outro lado não está lá, a mensagem não fica
// esperando em lugar nenhum: ela simplesmente não chega, e ninguém é avisado.
//
// E o caso que isto conserta é real: o `presencaMandarTexto` mostrava a
// mensagem na tela assim que o `send()` não lançava exceção. Só que o
// `readyState` diz `open` numa conexão que já morreu em silêncio — é a MESMA
// doença que o `PRESENCA_PONG_MS` trata no WebSocket. A mensagem aparecia
// bonitinha na tela e nunca tinha saído do aparelho.
//
// 8s por simetria com aquele prazo (10s): é o tempo que este projeto já usa
// pra transformar silêncio em informação. Quem confirma é o `onmessage` do
// outro lado, que não pensa — só responde.
const PRESENCA_RECIBO_MS = 8000;

// Versão do protocolo da CONVERSA (não do sinal). O `oi` é trocado na abertura
// do canal e é o que autoriza mostrar recibo.
//
// Sem ele o recurso mentiria por dias a cada deploy: o service worker é
// cache-first pra asset, então sobra por aí aparelho rodando o `presenca.js`
// antigo — que manda `{txt}` sem id e não sabe confirmar nada. Um cliente novo
// falando com um velho mostraria UM TIQUE PRA SEMPRE, indistinguível de
// mensagem perdida. Sem o `oi`, nenhum recibo aparece e a conversa volta a se
// comportar como antes. Degradar é honesto; tique errado não.
const PRESENCA_CONVERSA_V = 2;

// O crachá vale 15 min (CRACHA_TTL no servidor). Renovar aos 13 dá margem pra
// uma tentativa falhar sem derrubar quem está conversando.
const PRESENCA_RENOVAR_MS = 13 * 60 * 1000;

// Espera antes de tentar de novo. Cresce e para de crescer: rede de celular cai
// e volta o tempo todo, e reconectar em rajada é o que faz um WAF marcar o
// cliente. O último degrau se repete pra sempre — desistir calado deixaria a
// pílula mentindo "ninguém aqui".
const PRESENCA_ESPERAS_MS = [2000, 5000, 15_000, 30_000, 60_000];

const Presenca = {
    // `peer` é sorteado a cada carga da página. Não é identidade: identidade é
    // o nome do crachá. Ele só serve pra endereçar mensagem dentro da sala, e
    // ser efêmero é o ponto — não dá pra seguir alguém entre sessões por ele.
    peer: null,
    ws: null,
    cracha: null,
    ice: null,
    peers: [],
    total: 0,
    conversas: new Map(),   // peer -> { pc, canal, msgs, naoLidas, nome, estado }
    aberta: null,           // peer da conversa aberta agora
    filtro: null,
    tentativa: 0,
    timers: { keepalive: null, renovar: null, religar: null, vigia: null, ressinc: null, abrir: null },
    ligando: false,
};

function presencaLigada() {
    // Opt-out: o padrão é ligado. `!== false` e não `=== true` porque quem
    // nunca tocou na preferência tem `undefined`, e essa pessoa é a maioria.
    return AppState.preferences.presenca !== false;
}

function presencaPodeConectar() {
    return !!(AppState.authenticated && presencaLigada() && API.getSession() && API.getCountry());
}

// ── conexão ─────────────────────────────────────────────────────────────────

async function presencaSincronizar() {
    if (!presencaPodeConectar()) return presencaDesligar();
    // Já conectado com o MESMO filtro? Nada a fazer. Sem esta guarda, cada
    // aplicação de filtro derrubaria e refaria a conexão — inclusive quando o
    // filtro mudado não muda a sala (tipo de pedido, ordem, categoria).
    //
    // A comparação é sobre o PEDIDO (região, país, estado), não sobre o nome da
    // sala: quem traduz filtro em sala é o servidor, e reproduzir a fórmula
    // aqui pra poder comparar seria justamente a duplicação que a fonte única
    // existe pra evitar.
    const filtro = presencaFiltroAtual();
    if (Presenca.ws && Presenca.filtro === filtro) return;
    presencaDesligar();
    await presencaConectar(filtro);
}

function presencaFiltroAtual() {
    const st = parseInt(AppState.filters.stateId, 10);
    return `${API.getRegion()}|${API.getCountry()}|${Number.isFinite(st) && st > 0 ? st : ''}`;
}

async function presencaConectar(filtro) {
    if (Presenca.ligando || !presencaPodeConectar()) return;
    Presenca.ligando = true;
    Presenca.filtro = filtro || presencaFiltroAtual();
    try {
        if (!Presenca.peer) Presenca.peer = presencaSortearPeer();
        const r = await API.presenca(Presenca.peer, AppState.filters.stateId);
        if (!r || !r.success || !r.cracha) {
            // 401 já derruba a sessão pelo caminho comum da app; aqui só
            // reagenda. Presença é acessório: ela nunca tira ninguém da fila.
            presencaReagendar();
            return;
        }
        Presenca.cracha = r.cracha;
        Presenca.ice = r.ice || { iceServers: [] };
        presencaAbrirSocket();
    } catch (e) {
        presencaReagendar();
    } finally {
        Presenca.ligando = false;
    }
}

function presencaSortearPeer() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function presencaAbrirSocket() {
    const url = new URL('/sala', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('s', Presenca.cracha.sala);

    let ws;
    try { ws = new WebSocket(url.toString()); } catch (e) { presencaReagendar(); return; }
    Presenca.ws = ws;

    // Prazo pra conexão vingar. Sem ele, um handshake que nunca responde deixa
    // o cliente pendurado em CONNECTING e as tentativas param de acontecer.
    clearTimeout(Presenca.timers.abrir);
    Presenca.timers.abrir = setTimeout(() => presencaDeclararMorto(ws), PRESENCA_ABRIR_MS);

    ws.onopen = () => {
        // O contador de tentativas NÃO zera aqui. Abrir o socket não é ter
        // conectado: a recusa do crachá, o fechamento pelo servidor e a queda
        // de rede vêm todos DEPOIS do `onopen`. Zerando aqui, o recuo nunca
        // cresce — MEDIDO: 16 tentativas em 31s, todas a 2s, pra sempre. Cada
        // uma custa DUAS requisições ao Worker (crachá + upgrade) e uma
        // chamada ao Waze. Quem zera é o `eu`, que só chega se o servidor
        // aceitou o crachá.
        ws.send(JSON.stringify({ t: 'entrar', cracha: Presenca.cracha }));
        clearInterval(Presenca.timers.keepalive);
        Presenca.timers.keepalive = setInterval(
            () => presencaSondar(ws, PRESENCA_PONG_MS), PRESENCA_KEEPALIVE_MS);
        clearInterval(Presenca.timers.ressinc);
        Presenca.timers.ressinc = setInterval(presencaPedirLista, PRESENCA_RESSINC_MS);
        clearTimeout(Presenca.timers.renovar);
        // Renovar o crachá é reconectar: a sala confere o crachá na ENTRADA, e
        // trocar o passe de quem já está dentro não faria diferença nenhuma.
        Presenca.timers.renovar = setTimeout(() => { const f = Presenca.filtro; presencaDesligar(); presencaConectar(f); }, PRESENCA_RENOVAR_MS);
    };
    ws.onmessage = (ev) => presencaReceber(ev.data);
    ws.onclose = () => {
        if (Presenca.ws === ws) { Presenca.ws = null; presencaLimparLista(); presencaReagendar(); }
    };
    ws.onerror = () => { /* o `close` vem logo atrás e cuida do religamento */ };
}

// A tela voltou (destravou o celular, trocou de app de volta, bfcache).
//
// É o momento mais provável de a conexão estar quebrada E o mais provável de a
// pessoa estar OLHANDO — ela voltou pra usar a app. Os três estados possíveis:
//
//   ABERTO      — pode estar vivo ou morto em silêncio. Sonda com prazo curto
//                 e pede a lista, porque ela pode ter envelhecido enquanto a
//                 tela estava apagada (a difusão de quem entrou se perdeu).
//   A MEIO      — CONNECTING ou CLOSING. Não dá pra saber HÁ QUANTO TEMPO: os
//                 timers ficam congelados com a tela apagada, então um
//                 handshake pendurado pode estar assim há uma hora. Descarta e
//                 recomeça limpo — era o buraco desta função: nenhum ramo
//                 tratava isso e a pessoa esperava o prazo de 12s pra nada.
//   SEM SOCKET  — tenta agora, sem esperar o recuo (que pode estar em 60s).
//
// O recuo NÃO zera aqui, pelo mesmo motivo do `online`: voltar pra tela não diz
// nada sobre a rede. Quem zera é o `eu`. O que impede rajada é o `ligando`.
function presencaAoVoltar() {
    if (!presencaPodeConectar()) return;
    const ws = Presenca.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
        presencaSondar(ws, PRESENCA_PONG_VOLTA_MS);
        presencaPedirLista();
        return;
    }
    if (ws) {
        // A meio caminho, e sem saber desde quando: descarta.
        presencaDeclararMorto(ws);
    }
    if (Presenca.ligando) return;
    clearTimeout(Presenca.timers.religar);
    presencaConectar(Presenca.filtro);
}

// Pede a lista de novo. Usada quando ela provavelmente está velha: ao voltar
// pra tela, quando a rede volta, ao abrir a lista, e num intervalo de segurança.
function presencaPedirLista() {
    const ws = Presenca.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !Presenca.cracha) return;
    try { ws.send(JSON.stringify({ t: 'lista' })); } catch (e) { /* morrendo */ }
}

// Manda `ping` e cobra o `pong` dentro do prazo. Sem cobrar, o keepalive é só
// ruído: ele mantém o NAT aberto mas não descobre nada.
function presencaSondar(ws, prazo) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send('ping'); } catch (e) { presencaDeclararMorto(ws); return; }
    clearTimeout(Presenca.timers.vigia);
    Presenca.timers.vigia = setTimeout(() => presencaDeclararMorto(ws), prazo);
}

// O socket não respondeu: está morto, ainda que o navegador diga OPEN.
//
// NÃO confio no `onclose` pra religar aqui. Num socket em buraco negro, o
// `close()` manda um quadro de fechamento que nunca chega, e o navegador só
// dispara o `close` quando o prazo INTERNO dele vence — que pode ser longo, e
// não é meu. Então eu solto os ouvintes, fecho por educação e religo na mão.
function presencaDeclararMorto(ws) {
    clearTimeout(Presenca.timers.vigia);
    clearTimeout(Presenca.timers.abrir);
    if (Presenca.ws !== ws) return;           // já trocou de socket: nada a fazer
    Presenca.ws = null;
    clearInterval(Presenca.timers.keepalive);
    clearInterval(Presenca.timers.ressinc);
    clearTimeout(Presenca.timers.renovar);
    try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; } catch (e) {}
    try { ws.close(); } catch (e) {}
    presencaLimparLista();
    presencaReagendar();
}

function presencaReagendar() {
    if (!presencaPodeConectar()) return;
    clearTimeout(Presenca.timers.religar);
    const base = PRESENCA_ESPERAS_MS[Math.min(Presenca.tentativa, PRESENCA_ESPERAS_MS.length - 1)];
    // Jitter de ±25%: se o servidor cair, TODO mundo é desconectado no mesmo
    // instante e volta no mesmo instante. Espera igual pra todos transforma
    // uma queda em rajada sincronizada — o mesmo motivo do jitter das chamadas
    // ao Waze, agora do lado de cá.
    const espera = Math.round(base * (0.75 + Math.random() * 0.5));
    Presenca.tentativa += 1;
    Presenca.timers.religar = setTimeout(() => presencaConectar(Presenca.filtro), espera);
}

function presencaDesligar() {
    clearInterval(Presenca.timers.keepalive);
    clearInterval(Presenca.timers.ressinc);
    clearTimeout(Presenca.timers.vigia);
    clearTimeout(Presenca.timers.abrir);
    clearTimeout(Presenca.timers.renovar);
    clearTimeout(Presenca.timers.religar);
    if (Presenca.ws) {
        const ws = Presenca.ws;
        Presenca.ws = null;
        try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'sair' })); } catch (e) {}
        try { ws.close(); } catch (e) {}
    }
    for (const peer of [...Presenca.conversas.keys()]) presencaEncerrarConversa(peer);
    Presenca.cracha = null;
    Presenca.filtro = null;
    presencaLimparLista();
}

function presencaLimparLista() {
    Presenca.peers = [];
    Presenca.total = 0;
    presencaRenderPilula();
    presencaRenderLista();
}

// Logout: "se pedir para sair, é realmente para sair".
function presencaEsquecer() {
    presencaDesligar();
    Presenca.peer = null;
    presencaEsquecerBloqueioAntigo();
}

function presencaReceber(bruto) {
    // QUALQUER byte que chega prova que o socket está vivo — não só o `pong`.
    // Cobrar só o pong deixaria o vigia matando uma conexão movimentada que
    // por acaso não respondeu no prazo.
    clearTimeout(Presenca.timers.vigia);
    if (bruto === 'pong') return;
    let m;
    try { m = JSON.parse(bruto); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    // Entrou de verdade: só agora a conexão provou que serve, e só agora o
    // recuo pode ser zerado.
    if (m.t === 'eu') {
        // Chegou o `eu`: a conexão provou que serve. Só agora o prazo de abrir
        // é desarmado e o recuo zera.
        clearTimeout(Presenca.timers.abrir);
        Presenca.tentativa = 0;
        return;
    }

    if (m.t === 'lista') {
        Presenca.peers = Array.isArray(m.peers) ? m.peers : [];
        Presenca.total = m.total || 0;
        presencaRenderPilula();
        presencaRenderLista();
        presencaConferirSumicos();
        return;
    }
    if (m.t === 'ausente') return presencaMarcarAusente(m.peer);
    if (m.t === 'sinal') return presencaSinalRecebido(m);
}

// ── WebRTC ──────────────────────────────────────────────────────────────────

function presencaEnviarSinal(para, tipo, payload) {
    if (!Presenca.ws || Presenca.ws.readyState !== WebSocket.OPEN) return;
    Presenca.ws.send(JSON.stringify({ t: 'sinal', para, tipo, payload }));
}

function presencaConversa(peer, nome) {
    let c = Presenca.conversas.get(peer);
    if (!c) {
        c = {
            pc: null, canal: null, msgs: [], naoLidas: 0, nome: nome || '', estado: 'parado',
            pendentes: [], iceEspera: [], fila: null,
            // Numeração das MINHAS mensagens. Cada lado numera as suas, então
            // não há colisão: eu só confirmo as SUAS e você só as MINHAS.
            seq: 0,
            // Maior id que RECEBI — é o que vai no `lido`, que confirma até um
            // ponto em vez de uma por uma (ler é abrir a conversa e ver tudo).
            ultimaRecebida: 0,
            // Só vira true quando o outro lado se anuncia (ver PRESENCA_CONVERSA_V).
            recibos: false,
        };
        Presenca.conversas.set(peer, c);
    }
    if (nome) c.nome = nome;
    return c;
}

function presencaCriarPC(peer) {
    const c = presencaConversa(peer);
    if (c.pc) return c.pc;
    const pc = new RTCPeerConnection(Presenca.ice || { iceServers: [] });
    c.pc = pc;
    pc.onicecandidate = (ev) => {
        if (ev.candidate) presencaEnviarSinal(peer, 'ice', ev.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            c.estado = 'falhou';
            presencaMarcarNaoChegou(c);   // depois do estado: o motivo sai dele
            presencaRenderConversa();
        }
    };
    pc.ondatachannel = (ev) => presencaLigarCanal(peer, ev.channel);
    return pc;
}

function presencaLigarCanal(peer, canal) {
    const c = presencaConversa(peer);
    c.canal = canal;
    const abriu = () => {
        c.estado = 'aberta';
        // Anuncia que este lado sabe confirmar recebimento. Vai ANTES da fila
        // de pendentes: assim o outro lado já sabe confirmar o que chegar logo
        // atrás, em vez de a primeira mensagem ficar sem recibo por corrida.
        try { canal.send(JSON.stringify({ t: 'oi', v: PRESENCA_CONVERSA_V })); } catch (e) {}
        // O que foi digitado enquanto conectava não se perde: a pessoa apertou
        // enviar, e "some sem avisar" é pior que demorar.
        for (const m of c.pendentes.splice(0)) presencaEntregarMsg(peer, c, m);
        presencaRenderConversa();
        presencaRenderLista();
    };
    canal.onopen = abriu;
    // Quem RECEBE o canal (`ondatachannel`) pode recebê-lo JÁ ABERTO: aí o
    // `onopen` nunca dispara, porque o evento já passou. O estado ficava em
    // "Conectando…" pra sempre enquanto as mensagens iam e vinham normalmente —
    // e o que estava digitado antes ficava preso em `pendentes`, porque só o
    // `onopen` esvazia a fila. Conferir o `readyState` na hora de ligar é o
    // conserto; foi o CI que pegou, com o mesmo código passando aqui.
    if (canal.readyState === 'open') abriu();
    canal.onclose = () => {
        c.estado = 'fechada';
        presencaMarcarNaoChegou(c);
        presencaRenderConversa();
    };
    canal.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || typeof m !== 'object') return;

        // ── recados de protocolo ────────────────────────────────────────────
        // Cliente ANTIGO ignora todos estes em silêncio: ele lê `m.txt`, acha
        // vazio e sai pelo `if (!txt) return`. É o que torna a troca segura nos
        // dias em que as duas versões convivem.
        if (m.t === 'oi') { c.recibos = true; presencaRenderConversa(); return; }
        if (m.t === 'ack') { presencaConfirmar(c, m.id, 'entregue'); return; }
        if (m.t === 'lido') { presencaConfirmar(c, m.ate, 'lida'); return; }

        const txt = String(m.txt || '').slice(0, 2000);
        if (!txt) return;
        const id = Number.isFinite(m.id) ? m.id : 0;
        if (id > c.ultimaRecebida) c.ultimaRecebida = id;
        c.msgs.push({ meu: false, txt, ts: Date.now(), id, estado: null, motivo: null });

        // Confirma a ENTREGA na hora — é um fato do aparelho, não da pessoa.
        // Mensagem de cliente antigo vem sem id: não há o que confirmar.
        if (id) { try { canal.send(JSON.stringify({ t: 'ack', id })); } catch (e) {} }

        // Ler é outra coisa: só conta se a conversa estiver ABERTA e a app na
        // TELA. Modal aberto com o celular no bolso não é leitura, e um recibo
        // que mente é pior que recibo nenhum.
        if (presencaOlhando(peer)) presencaMarcarLidas(peer);
        else {
            c.naoLidas += 1;
            presencaRenderPilula();
            presencaRenderLista();
        }
        presencaRenderConversa();
    };
}

async function presencaChamar(peer, nome) {
    const c = presencaConversa(peer, nome);
    if (c.estado === 'aberta' || c.estado === 'chamando') return;
    c.estado = 'chamando';
    presencaRenderConversa();
    try {
        const pc = presencaCriarPC(peer);
        presencaLigarCanal(peer, pc.createDataChannel('conversa'));
        const oferta = await pc.createOffer();
        await pc.setLocalDescription(oferta);
        presencaEnviarSinal(peer, 'offer', { type: oferta.type, sdp: oferta.sdp });
    } catch (e) {
        c.estado = 'falhou';
        presencaRenderConversa();
    }
}

// Os sinais de UM par são tratados EM FILA, um de cada vez. Cada `onmessage`
// começa uma cadeia async própria, então sem a fila o `ice` que chega logo
// atrás do `offer` era processado ENQUANTO o offer ainda estava sendo aplicado
// — e caía no `else` de "ainda não tem remoteDescription", que descartava o
// candidato em silêncio. O sintoma era o pior possível: conexão que funciona na
// maioria das vezes e falha de vez em quando, sem erro nenhum.
function presencaSinalRecebido(m) {
    const peer = m.de;
    if (!peer) return;
    const c = presencaConversa(peer, m.nome);
    c.fila = (c.fila || Promise.resolve())
        .then(() => presencaTratarSinal(peer, c, m))
        .catch(() => { c.estado = 'falhou'; presencaRenderConversa(); });
}

async function presencaTratarSinal(peer, c, m) {
    if (m.tipo === 'offer') {
        // Quem chama tem prioridade de quem entrou primeiro: se os dois se
        // chamarem ao mesmo tempo, um dos lados descarta a própria oferta.
        // Sem isso as duas conexões ficam em `have-local-offer` e nenhuma
        // completa — e o sintoma é "conectando..." pra sempre.
        if (c.pc && c.pc.signalingState === 'have-local-offer') {
            if (Presenca.peer < peer) return;   // eu cedo, o outro comanda
            presencaEncerrarConversa(peer, true);
        }
        const pc = presencaCriarPC(peer);
        await pc.setRemoteDescription(m.payload);
        await presencaSoltarIce(c);
        const resposta = await pc.createAnswer();
        await pc.setLocalDescription(resposta);
        presencaEnviarSinal(peer, 'answer', { type: resposta.type, sdp: resposta.sdp });
        c.estado = 'chamando';
        presencaAvisarConvite(peer, c);
        return;
    }
    if (m.tipo === 'answer') {
        if (!c.pc) return;
        await c.pc.setRemoteDescription(m.payload);
        await presencaSoltarIce(c);
        return;
    }
    if (m.tipo === 'ice') {
        if (!c.pc) return;
        // Candidato que chega antes da descrição remota fica GUARDADO, não
        // descartado: sem ele o par pode simplesmente não achar caminho.
        if (!c.pc.remoteDescription) { (c.iceEspera || (c.iceEspera = [])).push(m.payload); return; }
        await c.pc.addIceCandidate(m.payload);
    }
}

async function presencaSoltarIce(c) {
    const espera = c.iceEspera;
    if (!espera || !espera.length) return;
    c.iceEspera = [];
    for (const cand of espera) {
        try { await c.pc.addIceCandidate(cand); } catch (e) { /* candidato velho não derruba a conexão */ }
    }
}

function presencaAvisarConvite(peer, c) {
    if (Presenca.aberta === peer) return;
    // Banner, não snackbar: tem ação e precisa esperar a pessoa terminar o
    // swipe que está no meio. Clicar abre a conversa.
    showToast(t('presenca.toast.convite', { nome: c.nome || t('presenca.anon') }), 'hint', 8000,
        () => presencaAbrirConversa(peer));
    presencaRenderPilula();
    presencaRenderLista();
}

function presencaMandarTexto(peer, txt) {
    const c = presencaConversa(peer);
    // A mensagem entra na lista JÁ — inclusive com o canal fechado. Antes ela
    // ficava invisível na fila de `pendentes` e só aparecia ao ser enviada; com
    // recibo, "enviando" é um estado que a pessoa PODE ver, e ver é melhor que
    // um vão em branco enquanto a conexão levanta.
    const m = { meu: true, txt, ts: Date.now(), id: ++c.seq, estado: 'enviando', motivo: null };
    c.msgs.push(m);
    presencaEntregarMsg(peer, c, m);
    presencaRenderConversa();
}

function presencaEntregarMsg(peer, c, m) {
    if (!c.canal || c.canal.readyState !== 'open') { c.pendentes.push(m); return; }
    try {
        c.canal.send(JSON.stringify({ txt: m.txt, id: m.id }));
        m.estado = 'enviada';
        // O prazo não se cancela: quando o `ack` chega, o estado deixa de ser
        // 'enviada' e este callback não faz nada. Guardar id de timer por
        // mensagem seria mais uma coisa pra limpar em cada caminho de saída.
        setTimeout(() => {
            if (m.estado !== 'enviada') return;
            m.estado = 'falhou';
            m.motivo = presencaMotivoDaFalha(c);
            presencaRenderConversa();
        }, PRESENCA_RECIBO_MS);
    } catch (e) {
        c.estado = 'falhou';
        m.estado = 'falhou';
        m.motivo = presencaMotivoDaFalha(c);
    }
}

// Marca as MINHAS mensagens até `ate` (inclusive) — o `ack` confirma uma, o
// `lido` confirma um trecho. Nunca REBAIXA: um `ack` que chegue depois do
// `lido` (a rede reordena mais do que se imagina) não pode desfazer a leitura.
const PRESENCA_PESO = { enviando: 0, enviada: 1, entregue: 2, lida: 3 };
function presencaConfirmar(c, ate, estado) {
    const teto = Number.isFinite(ate) ? ate : 0;
    if (!teto) return;
    let mudou = false;
    for (const m of c.msgs) {
        if (!m.meu || m.id > teto) continue;
        if ((PRESENCA_PESO[m.estado] || 0) >= PRESENCA_PESO[estado]) continue;
        m.estado = estado;
        m.motivo = null;   // chegou depois de eu ter desistido: a verdade é que chegou
        mudou = true;
    }
    if (mudou) presencaRenderConversa();
}

// Por que a mensagem não chegou. A app SABE distinguir os casos, e dizer qual
// é vale mais que um "não chegou" seco: quem lê decide se espera, se tenta de
// novo mais tarde, ou se procura a pessoa por outro caminho.
function presencaMotivoDaFalha(c) {
    if (c.estado === 'saiu') return 'saiu';
    if (c.estado === 'falhou' || c.estado === 'fechada') return 'conexao';
    // Canal ainda "aberto" e sem resposta: é o silêncio de sempre. Não invento
    // um motivo que não medi.
    return null;
}

// Tudo que estava a caminho vira "não chegou" no instante em que se descobre o
// motivo — sem esperar os 8s. Quando a pessoa saiu da fila, esperar o prazo é
// deixar a tela mentir por 8 segundos com a resposta já na mão.
function presencaMarcarNaoChegou(c) {
    let mudou = false;
    for (const m of c.msgs) {
        if (!m.meu || (m.estado !== 'enviando' && m.estado !== 'enviada')) continue;
        m.estado = 'falhou';
        m.motivo = presencaMotivoDaFalha(c);
        mudou = true;
    }
    return mudou;
}

// "Lida" só é verdade com a conversa ABERTA e a app NA TELA.
function presencaOlhando(peer) {
    return Presenca.aberta === peer && document.visibilityState === 'visible';
}

// Zera as não lidas E avisa o outro lado. As duas coisas juntas de propósito:
// enquanto eram separadas, a app zerava o contador em caminhos que não mandavam
// recibo nenhum, e o outro lado ficava esperando pra sempre.
function presencaMarcarLidas(peer) {
    const c = Presenca.conversas.get(peer);
    if (!c) return;
    c.naoLidas = 0;
    if (!c.ultimaRecebida) return;
    if (!c.canal || c.canal.readyState !== 'open') return;
    try { c.canal.send(JSON.stringify({ t: 'lido', ate: c.ultimaRecebida })); } catch (e) {}
}

function presencaEncerrarConversa(peer, manterMsgs) {
    const c = Presenca.conversas.get(peer);
    if (!c) return;
    // Solta os ouvintes ANTES de fechar. Fechar dispara `onclose`, que escrevia
    // `estado: 'fechada'` por cima do motivo que quem chamou já tinha decidido
    // — medido: sair da sala deixava a conversa em "fechada" em vez de "saiu",
    // e os dois casos deixavam de ser distinguíveis um minuto depois.
    try {
        if (c.canal) { c.canal.onopen = c.canal.onclose = c.canal.onmessage = null; c.canal.close(); }
    } catch (e) {}
    try {
        if (c.pc) { c.pc.onicecandidate = c.pc.ondatachannel = c.pc.onconnectionstatechange = null; c.pc.close(); }
    } catch (e) {}
    c.canal = null;
    c.pc = null;
    c.iceEspera = [];
    c.fila = null;
    // `manterMsgs` marca "quem chamou já decidiu o estado" (ex.: saiu):
    // sobrescrever aqui apagaria o motivo.
    if (!manterMsgs) { c.estado = 'parado'; Presenca.conversas.delete(peer); }
}

// Quem saiu da fila não some da conversa em silêncio: a pessoa merece saber
// por que parou de receber resposta.
function presencaConferirSumicos() {
    const vivos = new Set(Presenca.peers.map((p) => p.peer));
    for (const [peer, c] of Presenca.conversas) {
        if (vivos.has(peer) || c.estado === 'saiu') continue;
        if (c.estado === 'aberta' || c.estado === 'chamando') {
            c.estado = 'saiu';
            presencaMarcarNaoChegou(c);
            presencaEncerrarConversa(peer, true);
        }
    }
    presencaRenderConversa();
}

function presencaMarcarAusente(peer) {
    const c = Presenca.conversas.get(peer);
    if (!c) return;
    c.estado = 'saiu';
    presencaMarcarNaoChegou(c);
    presencaEncerrarConversa(peer, true);
    presencaRenderConversa();
}

function presencaEsquecerBloqueioAntigo() {
    safeLS.remove(PRESENCA_CHAVE_ANTIGA_BLOQUEIO);
}

// ── interface ───────────────────────────────────────────────────────────────

function presencaRenderPilula() {
    const btn = document.getElementById('presencaPill');
    if (!btn) return;
    const n = Presenca.peers.length;
    const ligado = presencaLigada() && AppState.authenticated;
    // Sem ninguém, a pílula SOME. Ela não é um botão de recurso: é a notícia de
    // que tem gente, e "0 editores" não é notícia — é ruído ocupando o header.
    //
    btn.classList.toggle('hidden', !ligado || n === 0);
    if (!ligado || n === 0) return;

    // Conta só as não lidas de quem está NA LISTA agora. Conversa cujo peer já
    // saiu não é abrível — a folha não a mostra —, então contá-la põe na pílula
    // um número que a pessoa não consegue zerar de jeito nenhum. E isso não é
    // caso raro: o `peer` é sorteado a cada carga da página, então quem
    // recarrega volta como outro peer e deixa a conversa anterior órfã, com as
    // não lidas presas. MEDIDO no aparelho do owner: pílula 4, lista 2.
    const vivos = new Set(Presenca.peers.map((p) => p.peer));
    let naoLidas = 0;
    for (const [peer, c] of Presenca.conversas) {
        if (vivos.has(peer)) naoLidas += c.naoLidas;
    }

    // Mensagem nova troca o ÍCONE (gente → balão), não só a cor: cor sozinha
    // não transmite informação (WCAG 1.4.1).
    document.getElementById('presencaIconGente').classList.toggle('hidden', naoLidas > 0);
    document.getElementById('presencaIconMsg').classList.toggle('hidden', naoLidas === 0);

    const selo = document.getElementById('presencaCount');
    const total = Math.max(n, Presenca.total);
    const valor = naoLidas > 0 ? naoLidas : total;
    // Zero não é notícia: "0" num selo lê como contador quebrado.
    selo.classList.toggle('hidden', valor === 0);
    selo.textContent = valor > 99 ? '99+' : String(valor);
    selo.classList.toggle('tem-msg', naoLidas > 0);

    const rotulo = naoLidas > 0
        ? t(naoLidas === 1 ? 'presenca.pill.msg' : 'presenca.pill.msgPlural', { n: naoLidas })
        : t(total === 1 ? 'presenca.pill.aria' : 'presenca.pill.ariaPlural', { n: total });
    btn.setAttribute('aria-label', rotulo);
    btn.setAttribute('title', rotulo);
}

function presencaRenderLista() {
    const lista = document.getElementById('presencaLista');
    if (!lista) return;
    const gente = Presenca.peers;
    document.getElementById('presencaVazio').classList.toggle('hidden', gente.length > 0);

    lista.innerHTML = gente.map((p) => {
        const c = Presenca.conversas.get(p.peer);
        const selo = p.staff ? t('profile.tag.staff') : (p.am ? t('profile.tag.am') : '');
        const nivel = 'L' + ((p.rank || 0) + 1);
        const badge = c && c.naoLidas
            ? `<span class="presenca-badge">${c.naoLidas > 9 ? '9+' : c.naoLidas}</span>`
            : '';
        return `<li>
            <button type="button" class="presenca-linha" data-peer="${escapeHtml(p.peer)}" data-nome="${escapeHtml(p.nome)}">
                <span class="presenca-nome">${escapeHtml(p.nome || t('presenca.anon'))}</span>
                <span class="presenca-selos">${escapeHtml(nivel)}${selo ? ' · ' + escapeHtml(selo) : ''}</span>
                ${badge}
            </button>
        </li>`;
    }).join('');

}

function presencaAbrirConversa(peer) {
    const p = Presenca.peers.find((x) => x.peer === peer);
    const c = presencaConversa(peer, p && p.nome);
    Presenca.aberta = peer;
    // `presencaMarcarLidas` e não `c.naoLidas = 0`: zerar aqui e avisar o outro
    // lado é a MESMA decisão, e separá-las é como um lado fica esperando um
    // recibo que o outro já considerou entregue.
    presencaMarcarLidas(peer);
    // `openModal` sozinho: ele JÁ esconde os outros modais, e trocar de camada
    // não empilha histórico. Fechar a lista antes empilhava um `history.back()`
    // e o `openModal` seguinte empurrava outra entrada no mesmo quadro — o
    // saldo ficava errado e o próximo Esc/voltar saía DA APP em vez de fechar a
    // conversa. Medido no smoke: a página ia pra `about:blank`.
    openModal('conversaModal');
    presencaRenderConversa();
    presencaRenderPilula();
    presencaRenderLista();
    if (c.estado !== 'aberta') presencaChamar(peer, c.nome);
    const campo = document.getElementById('conversaInput');
    if (campo) campo.focus();
}

function presencaFecharConversa() {
    closeModal('conversaModal');   // a limpeza do modal solta o `aberta`
}

// Chamado por LIMPEZA_AO_FECHAR['conversaModal'] — ou seja, por QUALQUER
// caminho de fechamento (✕, Esc, scrim, voltar do aparelho). Precisa ser uma
// FUNÇÃO exportada e não `Presenca.aberta = null` lá do app.js: o `Presenca`
// visível no app.js é o objeto EXPORTADO, e o estado real mora no `const
// Presenca` deste arquivo. Escrever de lá criava um campo num objeto que
// ninguém lê, e a conversa continuava "aberta" pra sempre — mensagem nova
// nunca mais viraria aviso.
function presencaEsquecerAberta() {
    Presenca.aberta = null;
    presencaRenderPilula();
    presencaRenderLista();
}

// ── DESENHO DO RECIBO ───────────────────────────────────────────────────────
//
// A distinção principal é de FORMA — um tique, dois tiques, relógio, alerta —
// e não de cor: cor sozinha não transmite informação (WCAG 1.4.1, a mesma régua
// que faz a pílula trocar de ícone em vez de só de tom).
//
// E é por isso que "Lida" ganha uma LINHA DE TEXTO embaixo da última lida: dois
// tiques brancos contra dois tiques cyan é diferença só de cor, e ninguém
// deveria precisar comparar dois tons pra saber se foi lida. O branco virou
// reforço; quem carrega o estado é a palavra — que o leitor de tela também lê.
const PRESENCA_GLIFO = {
    enviando: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
    enviada: '<path d="M4 12.5l5 5L20 6.5"/>',
    entregue: '<path d="M1 12.5l4 4L13 8"/><path d="M9.5 14.5l2 2L21 7"/>',
    lida: '<path d="M1 12.5l4 4L13 8"/><path d="M9.5 14.5l2 2L21 7"/>',
    falhou: '<path d="M12 3.8L22 20H2z"/><path d="M12 9.5v4.2"/><path d="M12 16.6h.01"/>',
};

function presencaRecibo(estado) {
    const glifo = PRESENCA_GLIFO[estado];
    if (!glifo) return '';
    const rotulo = t('presenca.recibo.' + (estado === 'falhou' ? 'naoChegou' : estado));
    return `<span class="presenca-recibo ${estado}" role="img" aria-label="${escapeHtml(rotulo)}">`
        + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${estado === 'enviando' || estado === 'falhou' ? '2.2' : '2.5'}"`
        + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glifo}</svg></span>`;
}

// A frase do "não chegou" DIZ O MOTIVO quando a app sabe qual é — e ela sabe,
// porque já distingue "saiu da fila" de "conexão caiu" pra decidir o texto do
// cabeçalho. Sem motivo conhecido fica o "Não chegou" seco: inventar uma causa
// que não foi medida é pior que não dizer.
function presencaFraseDaFalha(c, m) {
    if (m.motivo === 'saiu') return t('presenca.recibo.naoChegouSaiu', { nome: c.nome || t('presenca.anon') });
    if (m.motivo === 'conexao') return t('presenca.recibo.naoChegouConexao');
    return t('presenca.recibo.naoChegou');
}

function presencaHtmlDasMsgs(c) {
    // Entrega é ORDENADA e confiável (SCTP), então falha é sempre um sufixo:
    // existe no máximo UMA corrida de "não chegou", no fim. Uma linha por
    // mensagem falha repetiria a mesma frase N vezes sem dizer nada novo.
    let ultimaLida = -1, ultimaFalha = -1;
    for (let i = 0; i < c.msgs.length; i++) {
        const m = c.msgs[i];
        if (!m.meu) continue;
        if (m.estado === 'lida') ultimaLida = i;
        if (m.estado === 'falhou') ultimaFalha = i;
    }
    // Peer sem recibo (versão antiga) não ganha glifo nenhum — nem o de falha,
    // que ali seria adivinhação: ele nunca ia confirmar coisa alguma.
    const mostrar = c.recibos;
    return c.msgs.map((m, i) => {
        const recibo = mostrar && m.meu && m.estado ? presencaRecibo(m.estado) : '';
        let linha = '';
        if (mostrar && i === ultimaFalha) {
            linha = `<p class="conversa-falhou">${escapeHtml(presencaFraseDaFalha(c, m))}</p>`;
        } else if (mostrar && i === ultimaLida) {
            linha = `<p class="conversa-lida">${escapeHtml(t('presenca.recibo.lida'))}</p>`;
        }
        return `<div class="conversa-bolha ${m.meu ? 'minha' : 'dela'}${recibo ? ' com-recibo' : ''}">`
            + `${escapeHtml(m.txt)}${recibo}</div>${linha}`;
    }).join('');
}

function presencaRenderConversa() {
    if (!Presenca.aberta) return;
    const c = Presenca.conversas.get(Presenca.aberta);
    if (!c) return;
    const titulo = document.getElementById('conversaTitle');
    if (titulo) titulo.textContent = c.nome || t('presenca.anon');

    const estado = document.getElementById('conversaEstado');
    if (estado) {
        const textos = {
            chamando: t('presenca.conversa.conectando'),
            falhou: t('presenca.conversa.falhou'),
            saiu: t('presenca.conversa.saiu', { nome: c.nome || t('presenca.anon') }),
            fechada: t('presenca.conversa.saiu', { nome: c.nome || t('presenca.anon') }),
        };
        estado.textContent = textos[c.estado] || '';
        estado.classList.toggle('hidden', !textos[c.estado]);
    }

    const corpo = document.getElementById('conversaMsgs');
    if (corpo) {
        corpo.innerHTML = c.msgs.length
            ? presencaHtmlDasMsgs(c)
            : `<p class="conversa-vazio">${escapeHtml(t('presenca.conversa.vazio'))}</p>`;
        corpo.scrollTop = corpo.scrollHeight;
    }

    const enviar = document.getElementById('conversaEnviar');
    const campo = document.getElementById('conversaInput');
    const travado = c.estado === 'saiu' || c.estado === 'falhou' || c.estado === 'fechada';
    if (enviar) enviar.disabled = travado;
    if (campo) campo.disabled = travado;
}

// ── ligações com a app ──────────────────────────────────────────────────────

function presencaMontar() {
    presencaEsquecerBloqueioAntigo();

    // ── VOLTAR PRA TELA é o momento mais provável de o socket estar morto ────
    //
    // O caso real do editor: ele tria pedidos, troca de app ou trava o celular,
    // e volta minutos depois. O sistema operacional já matou a conexão — sem
    // avisar ninguém. Sem esta sonda, ele olharia uma lista vazia por até 45
    // segundos (o intervalo do keepalive) justo no instante em que voltou pra
    // usar a app, e concluiria que não há ninguém online.
    //
    // A sonda é BARATA: um `ping` de 4 bytes. Ela não reconecta por conta
    // própria — só faz a pergunta; quem declara a morte é o vigia do prazo.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        presencaAoVoltar();
        // Voltar pra tela com a conversa aberta É ler. Sem isto, quem deixou o
        // modal aberto e trocou de app voltava, lia tudo, e o outro lado seguia
        // com "Entregue" — o recibo ficaria certo só pra quem abre a conversa
        // do zero, que é o caminho menos comum de quem já está conversando.
        if (Presenca.aberta) {
            presencaMarcarLidas(Presenca.aberta);
            presencaRenderPilula();
            presencaRenderLista();
        }
    });

    // `pageshow` com `persisted` é o retorno pelo CACHE DE NAVEGAÇÃO (bfcache):
    // a página inteira volta congelada, com os timers e o socket do estado de
    // antes. No iOS é assim que um PWA costuma voltar, e nem sempre acompanha
    // um `visibilitychange`. Sem isto, justamente o aparelho mais comum entre
    // editores voltaria com a lista velha.
    window.addEventListener('pageshow', (ev) => { if (ev.persisted) presencaAoVoltar(); });

    // ── A REDE VOLTOU: tentar na hora, mas SEM zerar o recuo ────────────────
    //
    // Esperar o degrau de 60s aqui desperdiça o único sinal que o navegador
    // oferece. Mas o recuo NÃO zera, e a diferença importa: `online` quer dizer
    // "existe interface de rede", não "a internet funciona" — num wi-fi
    // instável ele dispara repetidamente sem que nada tenha melhorado. Zerar
    // ali seria o mesmo defeito que já custou caro neste recurso (o recuo que
    // nunca crescia), só que em outra roupa. Quem zera é o `eu`, e só ele.
    //
    // O que impede rajada é o `ligando`: enquanto uma tentativa está em voo, o
    // evento não inicia outra.
    window.addEventListener('online', () => {
        if (!presencaPodeConectar()) return;
        clearTimeout(Presenca.timers.religar);
        if (Presenca.ws) { presencaSondar(Presenca.ws, PRESENCA_PONG_VOLTA_MS); presencaPedirLista(); }
        else if (!Presenca.ligando) presencaConectar(Presenca.filtro);
    });

    const pill = document.getElementById('presencaPill');
    if (pill) pill.addEventListener('click', () => {
        openModal('presencaModal');
        presencaRenderLista();
        // Pedir aqui é de graça (só quando a pessoa toca) e garante que a lista
        // esteja certa exatamente no momento em que ela é OLHADA.
        presencaPedirLista();
    });

    const lista = document.getElementById('presencaModal');
    if (lista) lista.addEventListener('click', (ev) => {
        const linha = ev.target.closest('.presenca-linha');
        if (linha) return presencaAbrirConversa(linha.dataset.peer);
    });

    const form = document.getElementById('conversaForm');
    if (form) form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const campo = document.getElementById('conversaInput');
        const txt = (campo.value || '').trim().slice(0, 2000);
        if (!txt || !Presenca.aberta) return;
        campo.value = '';
        presencaMandarTexto(Presenca.aberta, txt);
    });

    // Sair da página fecha o socket na hora. Sem isto o outro lado continua
    // vendo você na lista até o TCP desistir sozinho — e a promessa é
    // "some assim que você sai".
    window.addEventListener('pagehide', () => presencaDesligar());
}

// Os métodos vão NO PRÓPRIO objeto de estado, e `window.Presenca` aponta pra
// ele. Não é estilo: é o conserto de um bug que chegou na tela do owner.
//
// `const Presenca` aqui em cima é um binding LÉXICO global — e binding léxico
// GANHA de propriedade de `window` em qualquer script clássico. Então um
// `Presenca.fecharConversa()` escrito no app.js não achava o objeto exportado:
// achava o de ESTADO, que não tem métodos. Resultado: "Presenca.fecharConversa
// is not a function" ao tocar no ✕ da conversa.
//
// O erro só aparecia no ✕ porque todos os outros pontos do app.js escrevem
// `window.Presenca?.…` explícito. Um objeto só acaba com a classe inteira:
// `Presenca` e `window.Presenca` passam a ser a MESMA coisa, e tanto faz como
// se escreve.
Object.assign(Presenca, {
    sincronizar: presencaSincronizar,
    desligar: presencaDesligar,
    esquecer: presencaEsquecer,
    montar: presencaMontar,
    fecharConversa: presencaFecharConversa,
    esquecerAberta: presencaEsquecerAberta,
    renderPilula: presencaRenderPilula,
});
window.Presenca = Presenca;
