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

// Bloqueio é por pessoa e fica no aparelho: é decisão de quem bloqueia, não
// dado que o servidor precise saber. Sai no logout como todo o resto.
const PRESENCA_BLOQUEADOS_KEY = 'waze_places_bloqueados';

// Keepalive. Na Cloudflare quem responde é o RUNTIME (auto-response), sem
// acordar o Durable Object; na VM responde o processo. O cliente manda o mesmo
// `ping` nos dois — ele não precisa saber em qual servidor está.
const PRESENCA_KEEPALIVE_MS = 45_000;

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
    bloqueados: new Set(),
    aberta: null,           // peer da conversa aberta agora
    filtro: null,
    tentativa: 0,
    timers: { keepalive: null, renovar: null, religar: null },
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

    ws.onopen = () => {
        Presenca.tentativa = 0;
        ws.send(JSON.stringify({ t: 'entrar', cracha: Presenca.cracha }));
        clearInterval(Presenca.timers.keepalive);
        Presenca.timers.keepalive = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, PRESENCA_KEEPALIVE_MS);
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

function presencaReagendar() {
    if (!presencaPodeConectar()) return;
    clearTimeout(Presenca.timers.religar);
    const espera = PRESENCA_ESPERAS_MS[Math.min(Presenca.tentativa, PRESENCA_ESPERAS_MS.length - 1)];
    Presenca.tentativa += 1;
    Presenca.timers.religar = setTimeout(() => presencaConectar(Presenca.filtro), espera);
}

function presencaDesligar() {
    clearInterval(Presenca.timers.keepalive);
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

// Logout: "se pedir para sair, é realmente para sair". A lista de bloqueados é
// do aparelho, mas é escolha de QUEM ENTROU — sai junto.
function presencaEsquecer() {
    presencaDesligar();
    Presenca.peer = null;
    Presenca.bloqueados = new Set();
    safeLS.remove(PRESENCA_BLOQUEADOS_KEY);
}

function presencaReceber(bruto) {
    if (bruto === 'pong') return;
    let m;
    try { m = JSON.parse(bruto); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

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
        c = { pc: null, canal: null, msgs: [], naoLidas: 0, nome: nome || '', estado: 'parado', pendentes: [], iceEspera: [], fila: null };
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
        // O que foi digitado enquanto conectava não se perde: a pessoa apertou
        // enviar, e "some sem avisar" é pior que demorar.
        for (const txt of c.pendentes.splice(0)) presencaMandarTexto(peer, txt);
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
    canal.onclose = () => { c.estado = 'fechada'; presencaRenderConversa(); };
    canal.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        const txt = String(m && m.txt || '').slice(0, 2000);
        if (!txt) return;
        c.msgs.push({ meu: false, txt, ts: Date.now() });
        if (Presenca.aberta !== peer) {
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
    // Bloqueio é por NOME do WME, então a conferência também: o `peer` é
    // sorteado a cada carga da página, e checar por ele deixava quem foi
    // bloqueado voltar a chamar bastando recarregar — que é exatamente o que
    // essa pessoa faria.
    if (!peer || Presenca.bloqueados.has(m.nome)) return;
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
    if (!c.canal || c.canal.readyState !== 'open') { c.pendentes.push(txt); return; }
    try {
        c.canal.send(JSON.stringify({ txt }));
        c.msgs.push({ meu: true, txt, ts: Date.now() });
        presencaRenderConversa();
    } catch (e) {
        c.estado = 'falhou';
        presencaRenderConversa();
    }
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
    // `manterMsgs` marca "quem chamou já decidiu o estado" (saiu, bloqueado):
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
            presencaEncerrarConversa(peer, true);
        }
    }
    presencaRenderConversa();
}

function presencaMarcarAusente(peer) {
    const c = Presenca.conversas.get(peer);
    if (!c) return;
    c.estado = 'saiu';
    presencaEncerrarConversa(peer, true);
    presencaRenderConversa();
}

// ── bloqueio ────────────────────────────────────────────────────────────────

function presencaCarregarBloqueados() {
    try {
        const bruto = JSON.parse(safeLS.get(PRESENCA_BLOQUEADOS_KEY) || '[]');
        Presenca.bloqueados = new Set(Array.isArray(bruto) ? bruto.filter((x) => typeof x === 'string') : []);
    } catch (e) { Presenca.bloqueados = new Set(); }
}

// Bloqueia pelo NOME do WME, não pelo `peer`: o peer é sorteado a cada carga da
// página, então bloquear por ele duraria até a pessoa recarregar — que é
// exatamente o que ela faria.
function presencaBloquear(nome) {
    if (!nome) return;
    Presenca.bloqueados.add(nome);
    safeLS.set(PRESENCA_BLOQUEADOS_KEY, JSON.stringify([...Presenca.bloqueados]));
    for (const [peer, c] of Presenca.conversas) if (c.nome === nome) presencaEncerrarConversa(peer);
    if (Presenca.aberta && !Presenca.conversas.has(Presenca.aberta)) presencaFecharConversa();
    presencaRenderLista();
    presencaRenderPilula();
}

function presencaDesbloquear(nome) {
    Presenca.bloqueados.delete(nome);
    safeLS.set(PRESENCA_BLOQUEADOS_KEY, JSON.stringify([...Presenca.bloqueados]));
    presencaRenderLista();
    presencaRenderPilula();
}

const presencaVisiveis = () => Presenca.peers.filter((p) => !Presenca.bloqueados.has(p.nome));

// ── interface ───────────────────────────────────────────────────────────────

function presencaRenderPilula() {
    const btn = document.getElementById('presencaPill');
    if (!btn) return;
    const n = presencaVisiveis().length;
    const ligado = presencaLigada() && AppState.authenticated;
    // Sem ninguém, a pílula SOME. Ela não é um botão de recurso: é a notícia de
    // que tem gente, e "0 editores" não é notícia — é ruído ocupando o header.
    btn.classList.toggle('hidden', !ligado || n === 0);
    if (!ligado || n === 0) return;

    let naoLidas = 0;
    for (const c of Presenca.conversas.values()) if (!Presenca.bloqueados.has(c.nome)) naoLidas += c.naoLidas;

    // Mensagem nova troca o ÍCONE (gente → balão), não só a cor: cor sozinha
    // não transmite informação (WCAG 1.4.1).
    document.getElementById('presencaIconGente').classList.toggle('hidden', naoLidas > 0);
    document.getElementById('presencaIconMsg').classList.toggle('hidden', naoLidas === 0);

    const selo = document.getElementById('presencaCount');
    const total = Math.max(n, Presenca.total - Presenca.bloqueados.size);
    const valor = naoLidas > 0 ? naoLidas : total;
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
    const gente = presencaVisiveis();
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
            <button type="button" class="presenca-bloquear" data-bloquear="${escapeHtml(p.nome)}"
                    aria-label="${escapeHtml(t('presenca.bloquear', { nome: p.nome }))}"
                    title="${escapeHtml(t('presenca.bloquear', { nome: p.nome }))}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>
                </svg>
            </button>
        </li>`;
    }).join('');

    const bloq = document.getElementById('presencaBloqueados');
    if (bloq) {
        const nomes = [...Presenca.bloqueados];
        bloq.classList.toggle('hidden', nomes.length === 0);
        const ul = document.getElementById('presencaBloqueadosLista');
        if (ul) {
            ul.innerHTML = nomes.map((nome) => `<li>
                <span class="presenca-nome">${escapeHtml(nome)}</span>
                <button type="button" class="presenca-desbloquear" data-desbloquear="${escapeHtml(nome)}"
                        >${escapeHtml(t('presenca.desbloquear'))}</button>
            </li>`).join('');
        }
    }
}

function presencaAbrirConversa(peer) {
    const p = Presenca.peers.find((x) => x.peer === peer);
    const c = presencaConversa(peer, p && p.nome);
    Presenca.aberta = peer;
    c.naoLidas = 0;
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
            ? c.msgs.map((m) => `<div class="conversa-bolha ${m.meu ? 'minha' : 'dela'}">${escapeHtml(m.txt)}</div>`).join('')
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
    presencaCarregarBloqueados();

    const pill = document.getElementById('presencaPill');
    if (pill) pill.addEventListener('click', () => { openModal('presencaModal'); presencaRenderLista(); });

    const lista = document.getElementById('presencaModal');
    if (lista) lista.addEventListener('click', (ev) => {
        const linha = ev.target.closest('.presenca-linha');
        if (linha) return presencaAbrirConversa(linha.dataset.peer);
        const bloquear = ev.target.closest('[data-bloquear]');
        if (bloquear) return presencaBloquear(bloquear.dataset.bloquear);
        const desbloquear = ev.target.closest('[data-desbloquear]');
        if (desbloquear) return presencaDesbloquear(desbloquear.dataset.desbloquear);
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

window.Presenca = {
    sincronizar: presencaSincronizar,
    desligar: presencaDesligar,
    esquecer: presencaEsquecer,
    montar: presencaMontar,
    fecharConversa: presencaFecharConversa,
    esquecerAberta: presencaEsquecerAberta,
    renderPilula: presencaRenderPilula,
};
