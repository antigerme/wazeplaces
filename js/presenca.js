// Presença e conversa entre editores — quem mais está usando o app no mesmo
// país que você, e um jeito de falar com essa pessoa.
//
// ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
// Triar pedido é trabalho solitário: você abre o app, faz 40 swipes e fecha,
// sem sinal nenhum de que tem mais gente do outro lado fazendo o mesmo. A
// companhia já estava lá — dá pra notar pedidos sumindo da própria fila —, só
// não estava VISÍVEL. A pílula do cabeçalho é isso: você não está sozinho.
//
// ── DE ONDE VEM (fase 3 da troca da sala própria) ───────────────────────────
// A presença e o chat são OS DO WME. O modelo é do owner, e ele não é "o app é
// o WME": a infra é do Waze, mas o app mostra SÓ o que é entre usuários do app.
//   · A LISTA é a de quem está online no WME, filtrada no servidor pela MARCA
//     do app na posição (`server/marca-app.mjs`) e pelo país do filtro. Quem
//     só usa o WME não aparece.
//   · As CONVERSAS são as do chat do WME que começaram no app: a marca vai no
//     contexto de toda mensagem que sai daqui, e o aparelho lembra as que já
//     viu (`conhecidos`) pra que uma resposta dada pelo WME não tire a conversa
//     da lista. Mensagem de quem só usa o WME: o app não mostra nada.
//   · A conversa FICA GUARDADA no chat do Waze e aparece no chat do WME dos
//     dois. Por isso não há mais "não chegou": quem saiu lê quando voltar.
//
// ── O QUE CUSTA (free tier) ─────────────────────────────────────────────────
// Nada de polling. A lista chega (a) de carona nas ações ✕/✓, sem pedido
// novo, e (b) ao abrir o app, ao abrir a lista e ao voltar do segundo plano —
// um pedido cada. Mensagem chegando custa ZERO: o tempo real vai do navegador
// DIRETO ao Google (CORS aberto, medido), com um token que o `presenca-app`
// devolve. Confirmar ao Google o que chegou também é de graça: os ids vão de
// carona no próximo pedido que o app já faria.
//
// ── O QUE FICA NO APARELHO ──────────────────────────────────────────────────
// Uma chave só (`CHAT_KEY`): a instalação do chat (o "aparelho" pro Waze), as
// conversas conhecidas, até onde cada pessoa leu, e os ids a confirmar. Sem
// texto de mensagem nenhum. O TOKEN do tempo real NUNCA vai pro armazenamento:
// é credencial, e o diagnóstico leva o localStorage inteiro.

const CHAT_KEY = 'waze_places_chat';

// O servidor corta no mesmo número (`CONHECIDOS_MAX` no core). Mais que isso
// não mudaria nada: a lista de conversas lida é a primeira página do Waze, e
// ela tem 50.
const PRESENCA_CONHECIDOS_MAX = 50;
const PRESENCA_LIDAS_MAX = 50;
const PRESENCA_CONFIRMAR_MAX = 100;

// Com muitas conversas a lista fica longa; o combinado nos mockups foi mostrar
// as mais recentes. As que têm mensagem NÃO LIDA entram sempre, além destas:
// número que a pessoa não consegue zerar é o gotcha #66.
const PRESENCA_CONVERSAS_NA_LISTA = 5;

// Voltar do segundo plano custa UM pedido (as não lidas e a lista). Trocar de
// app três vezes num minuto não pode custar três.
const PRESENCA_VOLTA_MIN_MS = 60_000;

// O token do tempo real vale 24 h (medido). Renovar com uma hora de folga faz
// a renovação cair num pedido que o app já faria, em vez de o fluxo morrer.
const PRESENCA_TOKEN_FOLGA_MS = 60 * 60 * 1000;
// Pedir token de novo tem teto: um token recusado em laço seria um pedido à
// nossa API a cada reconexão.
const PRESENCA_TOKEN_REPETIR_MS = 5 * 60 * 1000;

// O Google manda sinal de vida a cada 10 s (medido). 35 s sem NADA é conexão
// morta em silêncio — o caso comum em rede móvel, em que nenhum evento dispara.
const PRESENCA_FLUXO_SILENCIO_MS = 35_000;
// A conexão cai SOZINHA a cada ~6,2 min (medido, é tempo máximo do Google):
// esse fim é normal e religa em 1 s. Erro de verdade usa o recuo, com jitter —
// reconectar em rajada é o que faz um WAF marcar o cliente.
const PRESENCA_FLUXO_RELIGAR_MS = 1000;
// Quanto uma conexão sem nenhum fim de lote precisa ter durado pra o fim dela
// contar como NORMAL (ver `presencaFluxoAbrir`). Bem abaixo dos ~6 min medidos.
const PRESENCA_FLUXO_VIVEU_MS = 60 * 1000;
const PRESENCA_FLUXO_ESPERAS_MS = [2000, 5000, 15_000, 30_000, 60_000];

// Mensagens que chegam juntas viram UM "lida" só.
const PRESENCA_LIDA_ATRASO_MS = 1200;
// No diário, mensagem (chegando ou saindo) entra no máximo uma vez por minuto
// de cada tipo, com quantas vieram juntas — ver `presencaAnotarMsg`.
const PRESENCA_DIAG_MSG_MS = 60_000;

const PRESENCA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESENCA_ID = /^\d{1,19}$/;

const Presenca = {
    online: [],             // [{ id, nome, rank, lat, lon }] — quem usa o app no país
    conversas: [],          // [{ id, nome, naoLidas, atividade, ultima }] — as do app
    pais: null,             // o país da lista na tela
    atualizadaEm: 0,        // quando a última lista SAIU (o pedido), não quando chegou
    // Quando o último pedido da lista SAIU, tenha dado certo ou não — é por ele
    // que os gatilhos baratos (voltar do fundo, aplicar filtro) contam o teto de
    // um por minuto (ver `presencaUltimaTentativa`).
    tentadaEm: 0,
    contagem: null,         // o PORQUÊ da lista, do servidor (ver `contarOnlineDaApp` no core)
    diagUltimaLista: null,  // a última lista anotada no diário (só a MUDANÇA entra)
    diagMsgs: {},           // por tipo de linha: { em, juntas } (ver `presencaAnotarMsg`)
    pedindo: null,          // a promessa do `presenca-app` em voo (um por vez)
    // Relógio do SERVIDOR menos o do APARELHO (ms), medido a cada lista. As
    // horas que vêm de fora (o prazo do token, a hora de cada mensagem) são
    // levadas pro relógio daqui antes de comparar com ele: aparelho com a hora
    // errada contava mensagem duas vezes, perdia a não lida, ou — um dia
    // adiantado — nunca abria o tempo real (auditoria de 2026-09-25).
    desvio: 0,
    chat: null,             // { token, base, chave, expiraEm } — só em memória
    tokenPedidoEm: 0,
    fluxo: null,            // a conexão de tempo real aberta agora
    fluxoTentativa: 0,
    fluxoDiag: { aberturas: 0, quadros: 0, mensagens: 0, recibos: 0, ignoradas: 0, loteMensagens: 0,
                 ultimoFim: null, ultimoErro: null, quedasSeguidas: 0, erroAnotado: null, conectou: false },
    // Mensagens que chegaram AO VIVO com a conversa fechada, por pessoa. Somam
    // às não lidas do servidor até a próxima lista, que já as conta.
    vivas: new Map(),
    vistas: new Set(),      // ids de mensagem já contados (o fluxo reentrega)
    historico: new Map(),   // pessoa -> { msgs, maisAntigas, carregada, erro, carregando }
    aberta: null,           // id da pessoa da conversa aberta
    // O nome dela, guardado ao abrir: a conversa NOVA (ainda sem mensagem) só
    // tem o nome na lista de quem está no app, e a lista seguinte sem a pessoa
    // trocava o título por "Editor" (auditoria de 2026-09-29).
    nomeDaAberta: null,
    anexo: null,
    // O texto digitado e não mandado é DA CONVERSA, como o anexo: `rascunhoDe`
    // é a pessoa dona do que está no campo, e as outras conversas guardam o
    // delas aqui (só em memória). Ver `presencaTrocarRascunho`.
    rascunhos: new Map(),
    rascunhoDe: null,
    ultimaPosicao: null,    // [lat, lon] do último card na tela — o "daqui"
    // As fotos de cartão que NÃO carregaram nesta conversa (ver o `error` no
    // `presencaMontar`). A conversa é redesenhada a cada mensagem, e cada
    // redesenho recriava a <img> — pedindo de novo a foto que o CDN recusa:
    // MEDIDO sem rota nenhuma, 1 → 6 pedidos em 5 redesenhos (a resposta do CDN
    // pra foto que sumiu é 403 com `max-age=0`, e erro não fica no cache de
    // imagem do navegador; a foto boa fica em 1). Como os tiles do mapa
    // ampliado (`_falhos`): abrir a conversa de novo tenta de novo.
    fotosFalhas: new Set(),
    lidaEnviadaAte: new Map(),
    lidaPendente: null,     // de quem é o "lida" que espera a RAJADA (`timers.lida`, ver `presencaPagarLida`)
    // As conversas que DEVEM um "lida": o que falhou (a rede, o Waze fora) e o
    // que venceu sem saber de quem é a sessão. Separado da rajada: morava no
    // mesmo campo, e abrir OUTRA conversa — mesmo vazia — o sobrescrevia; a
    // mensagem que a pessoa viu ficava não lida no Waze (auditoria de
    // 2026-10-01, R6-5-1). Ver `presencaPagarDevidas`.
    lidaDevendo: new Set(),
    // As MINHAS mensagens que um recibo de "lida" citou pelo id antes de a hora
    // do Waze delas chegar (ver `presencaLidaPorId`).
    lidasPorId: new Set(),
    // Quando saiu (no relógio DAQUI) o último "lida" CONFIRMADO de cada
    // conversa — o do `abrir` e o do `chat/lida` (ver `presencaAplicarLista`).
    lidaSaiuEm: new Map(),
    epoca: 0,               // ++ a cada desligar: resposta velha não pousa
    timers: { fluxo: null, silencio: null, lida: null, nome: null },
};

// ── linha do tempo pro diagnóstico ──────────────────────────────────────────
// A presença e o chat anotam no `dfato` (o anel sempre ligado) só TRANSIÇÃO: a
// lista mudou ou falhou, o token veio ou não, o tempo real conectou, caiu ou
// voltou, uma conversa abriu, um envio saiu ou falhou, uma mensagem chegou.
// Nunca por quadro nem por swipe, e sem texto livre: o `dfato` roda pra TODO
// editor, o tempo todo. Até v2026.09.24-02 este arquivo não anotava NADA — um
// relato de "a mensagem não chegou às 14h" viria só com os contadores do
// instante em que o relatório foi gerado, sem linha do tempo.
function presencaAnotar(k, o) {
    try { if (typeof dfato === 'function') dfato(k, o); } catch (e) { /* diagnóstico nunca derruba nada */ }
}

// A lista entra no diário quando MUDA (quantos no app, conversas, não lidas, as
// contagens do servidor) ou quando falha: a carona devolve a mesma lista a cada
// ação, e anotar cada uma seria ruído por swipe. A `via` fica fora da
// comparação — a mesma lista pelo pedido e pela carona é uma linha só. E o
// `noWme` também: é o total de editores no WME do mundo inteiro, que anda sem
// nada mudar no app (39 → 41 entre duas ações, medido no relatório real) — com
// ele na comparação, quase toda carona virava linha. Ele vai junto quando a
// linha entra por outro motivo.
function presencaAnotarLista({ via, falhou = null }) {
    const c = Presenca.contagem || {};
    const o = falhou ? { via, falhou } : {
        via, online: Presenca.online.length, conversas: Presenca.conversas.length, naoLidas: presencaNaoLidasTotal(),
        ...(c.online ? { wme: c.online } : {}), ...(c.conversas ? { chat: c.conversas } : {}),
    };
    const chave = JSON.stringify({ ...o, via: null, wme: o.wme ? { ...o.wme, noWme: null } : undefined });
    if (chave === Presenca.diagUltimaLista) return;
    Presenca.diagUltimaLista = chave;
    presencaAnotar('presenca.lista', o);
}

// Mensagem é conversa, e uma conversa animada não pode empurrar o resto do anel
// (120) pra fora: de cada tipo entra no máximo uma linha por minuto, com
// `juntas` = quantas vieram desde a linha anterior, esta inclusive. Por MINUTO e
// não um teto por página: o app fica aberto por horas, e com teto a mensagem
// que "não chegou" no fim da tarde era justamente a que ficava de fora.
function presencaAnotarMsg(k, o) {
    const x = Presenca.diagMsgs[k] || (Presenca.diagMsgs[k] = { em: -Infinity, juntas: 0 });
    x.juntas += 1;
    const agora = Date.now();
    if (agora - x.em < PRESENCA_DIAG_MSG_MS) return;
    presencaAnotar(k, { ...o, juntas: x.juntas });
    x.em = agora;
    x.juntas = 0;
}

function presencaLigada() {
    // Opt-out: o padrão é ligado. `!== false` e não `=== true` porque quem
    // nunca tocou na preferência tem `undefined`, e essa pessoa é a maioria.
    return AppState.preferences.presenca !== false;
}

function presencaEu() {
    const id = AppState.profile && AppState.profile.id;
    return id !== null && id !== undefined && PRESENCA_ID.test(String(id)) ? String(id) : null;
}

function presencaPodeConectar() {
    return !!(AppState.authenticated && presencaLigada() && API.getSession() && API.getCountry() && presencaEu());
}

// ── o que fica no aparelho ──────────────────────────────────────────────────

function chatGuardado() {
    try {
        const o = JSON.parse(safeLS.get(CHAT_KEY) || '{}');
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
}

// Só com sessão. A resposta de um pedido em voo (a lista, o `abrir`, a
// confirmação de carona) chegava DEPOIS do "Sair" e recriava a chave que o
// `presencaEsquecer` tinha acabado de apagar — com a instalação, as conversas
// conhecidas e os ids a confirmar de quem saiu. MEDIDO em produção
// (2026-09-25): conversar, sair, e a chave estava de volta no aparelho.
function chatGuardar(o) {
    if (!AppState.authenticated) return;
    safeLS.set(CHAT_KEY, JSON.stringify(o));
}

function presencaUuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// A instalação é o APARELHO pro chat do Waze. Ela é estável de propósito: o
// token é por instalação, e o fluxo reentrega à MESMA instalação o que ela não
// confirmou (medido). Sorteada por pedido, cada abertura seria um aparelho
// novo, e o que chegou com o app fechado se perderia.
function chatInstalacao() {
    const g = chatGuardado();
    if (typeof g.inst === 'string' && PRESENCA_UUID.test(g.inst)) return g.inst;
    g.inst = presencaUuid();
    chatGuardar(g);
    return g.inst;
}

function chatConhecidos() {
    const l = chatGuardado().conhecidos;
    return Array.isArray(l) ? l.filter((x) => PRESENCA_ID.test(String(x))).map(String) : [];
}

// Conversa conhecida vai pra FRENTE: o teto descarta a que ficou mais tempo
// sem movimento, nunca a de agora.
function chatConhecer(ids) {
    const novos = (Array.isArray(ids) ? ids : [ids]).map(String).filter((x) => PRESENCA_ID.test(x));
    if (!novos.length) return;
    const g = chatGuardado();
    const velhos = Array.isArray(g.conhecidos) ? g.conhecidos.map(String) : [];
    const lista = [...novos, ...velhos.filter((x) => !novos.includes(x))].slice(0, PRESENCA_CONHECIDOS_MAX);
    if (lista.join(',') === velhos.join(',')) return;   // nada mudou: sem escrita
    g.conhecidos = lista;
    chatGuardar(g);
}

function chatConhecido(id) {
    return chatConhecidos().includes(String(id));
}

// Até quando a pessoa leu o que eu mandei (ms). O histórico do Waze NÃO traz
// os recibos (medido): o "Lida" de uma conversa antiga só existe porque o
// aparelho guardou o que o fluxo contou.
function chatLidaAte(id) {
    const l = chatGuardado().lidas;
    const v = l && typeof l === 'object' ? l[String(id)] : null;
    return Number.isFinite(v) ? v : 0;
}

function chatMarcarLidaAte(id, ts) {
    if (!Number.isFinite(ts)) return;
    const g = chatGuardado();
    const l = g.lidas && typeof g.lidas === 'object' ? g.lidas : {};
    const k = String(id);
    if ((l[k] || 0) >= ts) return;
    l[k] = ts;
    // Teto: fica quem leu por último.
    const ordem = Object.entries(l).sort((a, b) => b[1] - a[1]).slice(0, PRESENCA_LIDAS_MAX);
    g.lidas = Object.fromEntries(ordem);
    chatGuardar(g);
}

function chatAConfirmar() {
    const l = chatGuardado().confirmar;
    return Array.isArray(l) ? l.filter((x) => PRESENCA_UUID.test(String(x))) : [];
}

function chatGuardarAConfirmar(id) {
    if (!PRESENCA_UUID.test(String(id))) return;
    const g = chatGuardado();
    const l = Array.isArray(g.confirmar) ? g.confirmar : [];
    if (l.includes(id)) return;
    l.push(id);
    // Se estourar, saem os MAIS VELHOS: o pior que acontece é o fluxo os
    // reentregar, e o aparelho já os descarta como repetidos.
    g.confirmar = l.slice(-PRESENCA_CONFIRMAR_MAX);
    chatGuardar(g);
}

// Solta SÓ o que foi mandado e o Waze confirmou; o que chegou no meio fica.
function chatSoltarConfirmados(enviados) {
    const g = chatGuardado();
    const l = Array.isArray(g.confirmar) ? g.confirmar : [];
    g.confirmar = l.filter((x) => !enviados.includes(x));
    chatGuardar(g);
}

// O que vai de carona num pedido: a instalação e os ids a confirmar.
function chatCarona() {
    const confirmar = chatAConfirmar().slice(0, PRESENCA_CONFIRMAR_MAX);
    return confirmar.length ? { instalacao: chatInstalacao(), confirmar } : {};
}

function chatAoResponder(r, carona) {
    if (r && r.confirmados && carona && carona.confirmar) chatSoltarConfirmados(carona.confirmar);
}

// ── a lista ─────────────────────────────────────────────────────────────────

// Só falta o PERFIL, com a sessão de pé: é a renovação silenciosa pela extensão
// (a queda apaga o perfil, e o `showMainScreen` chama a presença antes de ele
// voltar) — ou a abertura, antes de o primeiro perfil chegar.
function presencaEsperandoPerfil() {
    return !!(AppState.authenticated && presencaLigada() && API.getSession() && API.getCountry() && !presencaEu());
}

async function presencaSincronizar() {
    // Esperando o perfil, ESPERA — com a tela como está. Desligar aqui fechava a
    // conversa aberta, a lista e a folha do pedido, e o pedido preso se perdia,
    // com a MESMA conta voltando segundos depois (auditoria de 2026-09-29). O
    // perfil que chegar chama isto de novo (`completarPerfilChegado`); OUTRA
    // conta limpa tudo pelo `esquecerOutraConta`, e o "Sair" pelo
    // `presencaEsquecer`. Só o tempo real fecha: o que chegasse por ele sem
    // saber de quem é a sessão não teria como entrar (ver `presencaQuadro`), e
    // reaberto com o perfil ele reentrega o que ficou sem confirmar.
    if (presencaEsperandoPerfil()) {
        clearTimeout(Presenca.timers.fluxo);
        presencaFluxoFechar();
        return;
    }
    if (!presencaPodeConectar()) return presencaDesligar();
    // O "lida" que ficou DEVENDO — na espera do perfil, ou o que falhou (ver
    // `presencaPagarDevidas`). A rajada em curso não se adianta: ela tem
    // relógio próprio.
    presencaPagarDevidas();
    // O histórico que a conversa aberta pediu na espera do perfil (ver
    // `presencaCarregarConversa`): com o perfil, ele sai agora.
    const espera = Presenca.aberta ? (Presenca.historico.get(Presenca.aberta) || {}).esperaPerfil : null;
    if (espera) presencaCarregarConversa(Presenca.aberta, espera);
    // Mesmo país e lista fresca: nada a pedir. Sem esta guarda, cada filtro
    // aplicado (tipo, ordem, categoria) custaria um pedido sem mudar a lista.
    const fresca = Date.now() - presencaUltimaTentativa() < PRESENCA_VOLTA_MIN_MS;
    if (Presenca.pais === API.getCountry() && fresca) { presencaFluxoGarantir(); return; }
    await presencaAtualizar();
    // E o tempo real, também aqui: a lista só abre o fluxo quando traz token
    // NOVO, e o fechado na espera do perfil (acima), com o token ainda valendo,
    // ficava fechado até o app voltar do segundo plano. Sem pedir token: a
    // lista acabou de pedir o que faltava.
    presencaFluxoGarantir({ pedirToken: false });
}

// O teto de UM pedido por minuto dos gatilhos baratos (voltar do segundo plano,
// aplicar filtro) conta da última TENTATIVA, não da última lista boa: com a
// lista falhando COM resposta (o Waze fora), a lista boa não andava, e cada
// volta do fundo pedia de novo (MEDIDO: 4 voltas em 40 s, 4 pedidos; auditoria
// de 2026-09-29). O pedido que nem teve resposta não conta (ver o
// `presencaAtualizar`): ele não chegou ao servidor, e a rede voltando o refaz.
function presencaUltimaTentativa() {
    return Math.max(Presenca.atualizadaEm, Presenca.tentadaEm);
}

// A falha que nem chegou a ter resposta (ver o `catch` do `_post` no api.js).
function presencaSemResposta(r) {
    return !r || typeof r._motivo === 'string';
}

async function presencaAtualizar({ token = false } = {}) {
    if (!presencaPodeConectar()) return;
    if (Presenca.pedindo) return Presenca.pedindo;
    const epoca = Presenca.epoca;
    const pais = API.getCountry();
    const inicio = Date.now();
    const querToken = token || !presencaTokenValido();
    const carona = chatCarona();
    const campos = { pais, userId: presencaEu(), conhecidos: chatConhecidos(), ...carona };
    if (querToken) { campos.instalacao = chatInstalacao(); campos.token = true; Presenca.tokenPedidoEm = inicio; }
    const tentadaAntes = Presenca.tentadaEm;
    Presenca.tentadaEm = inicio;
    let refazer = false;
    Presenca.pedindo = (async () => {
        try {
            const r = await API.presencaApp(campos);
            if (epoca !== Presenca.epoca) return;       // desligou ou saiu no meio
            chatAoResponder(r, carona);
            if (r && Number.isFinite(r.agora)) Presenca.desvio = r.agora - Date.now();
            if (!r || !r.success) {
                // O que nem teve resposta não chegou ao servidor: não conta no
                // teto dos gatilhos baratos (ver `presencaUltimaTentativa`).
                if (presencaSemResposta(r)) Presenca.tentadaEm = tentadaAntes;
                // Pedido de token que falhou por REDE não conta no teto de 5 min:
                // aberto sem sinal, o app ficava 5 min sem o tempo real depois de
                // a rede voltar (o `online` achava o pedido "recente" e desistia).
                // Recusa de verdade segue contando (auditoria de 2026-09-25).
                //
                // E "por rede" é SEM RESPOSTA: o `_post` só põe `_motivo` quando a
                // resposta nem chegou (rede, DNS, tempo esgotado). O Waze falhando
                // também volta `transient`, mas COM resposta — e ela prova rede:
                // zerado aí, cada ação (`presencaAoProvarRede`) pediria o token de
                // novo enquanto o Waze estivesse fora, uma requisição a mais por
                // swipe no free tier (auditoria de 2026-09-26).
                if (querToken && presencaSemResposta(r)) Presenca.tokenPedidoEm = 0;
                presencaAnotarLista({ via: 'pedido', falhou: (r && r.errorCategory) || 'sem resposta' });
                if (r && r.errorCategory === 'unauthorized' && typeof handleUnauthorized === 'function') handleUnauthorized();
                return;
            }
            // Trocou de país no meio: a LISTA que chegou é do país velho e fica
            // de fora — mas o TOKEN do chat não tem país e fica (jogá-lo fora
            // deixava o tempo real parado até o próximo pedido de token, 5 min
            // depois). E o país novo pede a lista DELE quando esta termina: quem
            // pediu no meio recebeu ESTA promessa e ficava sem lista até a
            // próxima ação. O caso comum é a abertura: o app troca pro país do
            // perfil com o primeiro pedido no ar (auditoria de 2026-09-25).
            if (pais !== API.getCountry()) refazer = true;
            else presencaAplicarLista(r, inicio, pais, 'pedido');
            if (r.chat && r.chat.token) {
                // O prazo vem no relógio do servidor; vai pro daqui (ver `desvio`).
                Presenca.chat = Number.isFinite(r.chat.expiraEm)
                    ? { ...r.chat, expiraEm: r.chat.expiraEm - Presenca.desvio } : r.chat;
                presencaFluxoGarantir();
            }
            if (querToken) {
                // O prazo JÁ levado pro relógio daqui (o `Presenca.chat` de
                // cima): o cru é do relógio do SERVIDOR, e contra o do aparelho
                // o diário dizia "vence em -1 h" com o token recém-chegado num
                // aparelho um dia adiantado — o resumo, que usa o convertido,
                // dizia 24 (auditoria de 2026-09-26).
                const veio = !!(r.chat && r.chat.token);
                presencaAnotar('presenca.token', { veio,
                    expiraEmH: veio && Number.isFinite(Presenca.chat.expiraEm) ? Math.round((Presenca.chat.expiraEm - Date.now()) / 36e5) : null });
            }
        } catch (e) {
            /* presença é acessório: nunca tira ninguém da fila */
            presencaAnotarLista({ via: 'pedido', falhou: 'excecao' });
        } finally {
            // Só o pedido DESTA época solta a marca: o de antes de um desligar,
            // chegando depois, apagava a do pedido novo em voo — e um terceiro
            // saía junto, pagando o free tier em dobro (auditoria de 2026-09-25).
            if (epoca === Presenca.epoca) {
                Presenca.pedindo = null;
                if (refazer) presencaAtualizar();
            }
        }
    })();
    return Presenca.pedindo;
}

// A mesma resposta chega por dois caminhos: a rota própria e a carona das
// ações. `null` numa parte é "não veio", NUNCA "ninguém": manter a anterior é
// melhor que a pílula sumir por uma falha passageira.
function presencaAplicarLista(r, inicio, pais, via = 'carona') {
    // A lista que SAIU antes da última que entrou é mais velha que ela: a
    // carona de uma ação antiga, pousando depois do pedido novo, devolvia a não
    // lida que a pessoa já tinha lido (auditoria de 2026-09-29).
    if (inicio < Presenca.atualizadaEm) return;
    // Trocou de país e a lista do WME não veio (`online: null`): a que está na
    // tela é de OUTRO país, e ficava com o nome do novo no subtítulo — e
    // contava como fresca, então nada a pedia de novo (auditoria de
    // 2026-09-29). Com o país trocado, a parte que não veio é "ninguém que se
    // saiba", e a lista não conta como atualizada. As conversas não têm país.
    const trocouDePais = Presenca.pais !== null && String(Presenca.pais) !== String(pais);
    let incompleta = false;
    if (Array.isArray(r.online)) Presenca.online = r.online.filter((p) => p && PRESENCA_ID.test(String(p.id)));
    else if (trocouDePais) { Presenca.online = []; incompleta = true; }
    if (Array.isArray(r.conversas)) {
        Presenca.conversas = r.conversas.filter((c) => c && PRESENCA_ID.test(String(c.id)));
        // O que chegou ao vivo ANTES de o pedido sair o servidor já contou. E o
        // que chegou DEPOIS pode ter entrado na conta também: a lista é lida no
        // Waze depois de o pedido sair, e a mensagem gravada nesse meio vem
        // nela. Até onde a lista foi dizem a `atividade` da conversa e a hora
        // da ÚLTIMA mensagem dela — as duas no relógio do Waze, que carimba a
        // mensagem ao guardá-la (MEDIDO na gravação do WME: o pedido saiu com
        // 1790182219825 e voltou guardado com 1790182220160), o mesmo relógio
        // da hora que o fluxo traz. O que chegou com hora até ali, a lista já
        // contou. Sem isto, UMA mensagem virava "2 mensagens novas" (auditoria
        // de 2026-09-29).
        //
        // E a lista que SAIU antes do último "lida" CONFIRMADO de uma conversa
        // foi lida no Waze antes dele: o "1" que ela traz é de mensagem que a
        // pessoa já leu. Pedida com a pílula e chegando depois de a conversa
        // ser aberta e fechada, ela acendia "1 mensagem nova" até a lista
        // seguinte (auditoria de 2026-09-30, R5-5-4). Pra essa conversa a lista
        // vale zero, e a conta dela não serve de régua pras vivas (o que chegou
        // depois do "lida" segue contando por elas).
        const lidaDepois = (cid) => inicio < (Presenca.lidaSaiuEm.get(cid) || 0);
        for (const c of Presenca.conversas) if (lidaDepois(c.id)) c.naoLidas = 0;
        for (const [id, v] of Presenca.vivas) {
            if (v.ultimaTs < inicio) { Presenca.vivas.delete(id); continue; }
            if (lidaDepois(id)) continue;
            const c = Presenca.conversas.find((x) => x.id === id);
            const ate = c ? Math.max(Number.isFinite(c.atividade) ? c.atividade : 0,
                c.ultima && Number.isFinite(c.ultima.ts) ? c.ultima.ts : 0) : 0;
            if (!ate || !Array.isArray(v.servs)) continue;
            const depois = v.servs.filter((s) => !(s <= ate));
            if (depois.length === v.servs.length) continue;
            v.n = Math.max(0, v.n - (v.servs.length - depois.length));
            v.servs = depois;
            if (!v.n) Presenca.vivas.delete(id);
        }
        // A conversa que a pessoa está OLHANDO está lida, diga a lista o que
        // disser. A lista pode ter sido lida no Waze ANTES do "lida" — pedida
        // junto com o toque que abriu a conversa, ou na volta do segundo plano
        // —, e ela sobrescrevia com "1" a conversa aberta e lida: a pílula
        // dizia "1 mensagem nova" com a mensagem na tela (auditoria de
        // 2026-09-26). O que chega com ela na tela já não vira não lida
        // (`presencaMensagemDoFluxo`); aqui é a mesma regra pro que a lista diz.
        const olhando = Presenca.aberta && presencaOlhando(Presenca.aberta) ? Presenca.aberta : null;
        if (olhando) {
            const c = Presenca.conversas.find((x) => x.id === olhando);
            if (c) c.naoLidas = 0;
            Presenca.vivas.delete(olhando);
        }
        // Conversa que o servidor diz ser do app o aparelho passa a conhecer:
        // é isso que a mantém na lista quando a resposta vier pelo WME, sem a
        // marca. As mais recentes primeiro, pelo teto.
        chatConhecer([...Presenca.conversas].sort((a, b) => (b.atividade || 0) - (a.atividade || 0)).map((c) => c.id));
    }
    if (r.contagem && typeof r.contagem === 'object') Presenca.contagem = r.contagem;
    Presenca.pais = pais;
    if (!incompleta) Presenca.atualizadaEm = Math.max(Presenca.atualizadaEm, inicio);
    presencaRenderTudo();
    presencaAnotarLista({ via });
}

// Chamado pelo app.js com o que voltou DE CARONA na ação (`presencaApp`).
// `pais` é o que a carona LEVOU: a lista que volta é a desse país. Com o
// filtro trocado com a ação no ar, a lista do Brasil entrava como a da França
// — e, com ela "fresca", o pedido do país novo nem saía (auditoria de
// 2026-09-26). Lista de outro país fica de fora; a do país novo vem pelo
// pedido que a troca de filtro já faz.
function presencaAoCarona(p, inicio, pais) {
    try {
        if (!p || !presencaPodeConectar()) return;
        const atual = API.getCountry();
        if (pais !== undefined && pais !== null && String(pais) !== String(atual)) return;
        presencaAplicarLista(p, Number.isFinite(inicio) ? inicio : Date.now() - 2000, atual, 'carona');
    } catch (e) { /* diagnóstico nunca derruba a ação */ }
}

// Os ids já contados, com TETO: o app fica aberto por horas e cada mensagem que
// passa (ao vivo, do lote, do histórico) entrava pra sempre (auditoria de
// 2026-09-25). O que o teto solta é o mais VELHO: a reentrega que o `vistas`
// existe pra barrar é a da reconexão, de minutos, e cada lote é confirmado.
const PRESENCA_VISTAS_MAX = 2000;
function presencaMarcarVista(id) {
    Presenca.vistas.add(id);
    if (Presenca.vistas.size > PRESENCA_VISTAS_MAX) Presenca.vistas.delete(Presenca.vistas.values().next().value);
}

function presencaNaoLidasDe(id) {
    const c = Presenca.conversas.find((x) => x.id === id);
    const v = Presenca.vivas.get(id);
    return (c ? c.naoLidas || 0 : 0) + (v ? v.n : 0);
}

function presencaNaoLidasTotal() {
    let n = 0;
    for (const c of Presenca.conversas) n += c.naoLidas || 0;
    for (const v of Presenca.vivas.values()) n += v.n;
    return n;
}

function presencaDesligar() {
    Presenca.epoca += 1;
    presencaFluxoFechar();
    clearTimeout(Presenca.timers.fluxo);
    // O "lida" pendente é DESCARTADO, não pago: desligar é o "Sair", a troca de
    // conta ou a queda da sessão — e o fechamento da conversa logo abaixo não
    // pode mandá-lo (ver `presencaPagarLida`). O que estava DEVENDO também.
    clearTimeout(Presenca.timers.lida);
    Presenca.lidaPendente = null;
    Presenca.lidaDevendo.clear();
    clearTimeout(Presenca.timers.nome);
    Presenca.online = [];
    Presenca.conversas = [];
    Presenca.vivas.clear();
    Presenca.vistas.clear();
    Presenca.historico.clear();
    Presenca.lidaEnviadaAte.clear();
    Presenca.lidasPorId.clear();
    Presenca.lidaSaiuEm.clear();
    Presenca.fotosFalhas.clear();
    Presenca.pais = null;
    Presenca.atualizadaEm = 0;
    Presenca.tentadaEm = 0;
    Presenca.pedindo = null;
    Presenca.chat = null;
    Presenca.fluxoTentativa = 0;
    // A conversa, a lista e a folha do pedido FECHAM junto. Desligar é o que o
    // `showAuthScreen` chama quando a sessão acaba, e elas ficavam por cima da
    // tela de entrada — com a conversa (texto de terceiro) à mostra e um campo
    // que engolia o que se digitava (auditoria de 2026-09-26). Pelo
    // `closeModal`, que consome a entrada do voltar e roda a limpeza de cada
    // uma; só a que está NA TELA (fechar a escondida gastaria um voltar).
    // Quem abre um diálogo logo depois (o portão fechado) o abre ANTES do
    // `showAuthScreen`: fechar e abrir no mesmo quadro é o gotcha #65.
    if (typeof closeModal === 'function') {
        for (const id of ['conversaModal', 'presencaModal', 'pedidoModal']) {
            const m = document.getElementById(id);
            if (m && !m.classList.contains('hidden')) closeModal(id);
        }
    }
    // A conversa aberta e o pedido preso nela são DESTA sessão, e o `aberta` e
    // o `anexo` ficavam de pé quando outra camada tinha escondido a conversa
    // sem a limpeza dela: atravessavam o "Sair", e o pedido de uma conta
    // aparecia — e saía no envio — na conversa da conta seguinte (auditoria de
    // 2026-09-26). A limpeza do fechamento faz o resto: tira do DOM a conversa
    // e o anúncio (texto de terceiro) e redesenha a pílula e a lista.
    presencaEsquecerAberta();
}

// Logout: "se pedir para sair, é realmente para sair". `soMemoria`: o "Sair"
// foi numa OUTRA aba, que já apagou a chave do chat — esta fecha o tempo real e
// solta a memória, sem mexer no aparelho (ver o `handleLogout`).
function presencaEsquecer({ soMemoria = false } = {}) {
    presencaDesligar();
    Presenca.ultimaPosicao = null;
    // O que ficou digitado e não saiu também: o campo não é apagado quando o
    // envio não pode sair (ver o `submit`), e a conta seguinte o acharia lá. E
    // os rascunhos das outras conversas, pelo mesmo motivo.
    const campo = document.getElementById('conversaInput');
    if (campo) campo.value = '';
    Presenca.rascunhos.clear();
    Presenca.rascunhoDe = null;
    if (!soMemoria) safeLS.remove(CHAT_KEY);
}

// ── o tempo real (direto do navegador ao Google) ────────────────────────────

// Não precisa de token novo: tem um, e ele vale por mais de uma hora (a folga).
function presencaTokenValido() {
    const c = Presenca.chat;
    if (!c || !c.token || !c.base || !c.chave) return false;
    return !Number.isFinite(c.expiraEm) || c.expiraEm - Date.now() > PRESENCA_TOKEN_FOLGA_MS;
}

// O token ABRE o fluxo até vencer DE FATO. A folga de uma hora é só a hora de
// pedir o próximo, e as duas coisas eram uma só: na última hora o app parava
// de abrir o fluxo e esperava o token novo — e se a renovação não viesse (o
// provedor falhou no Waze, a rede caiu), o tempo real ficava parado com um
// token que ainda valia, e nada o religava (auditoria de 2026-09-26).
function presencaTokenAbre() {
    const c = Presenca.chat;
    if (!c || !c.token || !c.base || !c.chave) return false;
    return !Number.isFinite(c.expiraEm) || c.expiraEm > Date.now();
}

// `pedirToken: false` é pra quem ACABOU de pedir a lista: ela já levou o pedido
// do token que faltava (ver o `querToken` do `presencaAtualizar`).
function presencaFluxoGarantir({ pedirToken = true } = {}) {
    if (!presencaPodeConectar()) return;
    if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
    // A renovação vai À PARTE, com o teto de 5 min: falta token, ele está na
    // última hora, ou o Google o recusou. Chega pelo `presencaAtualizar`, que
    // abre o fluxo quando o token vem.
    if (pedirToken && !presencaTokenValido() && Date.now() - Presenca.tokenPedidoEm > PRESENCA_TOKEN_REPETIR_MS) {
        presencaAtualizar({ token: true });
    }
    if (!Presenca.fluxo && presencaTokenAbre()) presencaFluxoAbrir();
}

// Resposta NOSSA que chega prova rede (`API.aoProvarRede`, o gancho que a fila
// de saída já usa). Sem token que abra o fluxo — o provedor voltou vazio, a
// renovação caiu, o Google recusou —, nada mais o pedia de novo: o recuo do
// fluxo desiste sem token e nenhum timer ficava de pé, então o tempo real
// só voltava reabrindo o app (auditoria de 2026-09-26). Aqui ele é pedido de
// novo, com o MESMO teto de 5 min — e nada além disso: com token, quem cuida
// do fluxo é o recuo, senão cada ação viraria uma reconexão ao Google.
function presencaAoProvarRede() {
    if (presencaTokenAbre()) return;
    presencaFluxoGarantir();
}

function presencaFluxoFechar() {
    const f = Presenca.fluxo;
    Presenca.fluxo = null;
    clearTimeout(Presenca.timers.silencio);
    if (f) { try { f.ctl.abort(); } catch (e) {} }
}

function presencaVigiarSilencio(fluxo) {
    clearTimeout(Presenca.timers.silencio);
    Presenca.timers.silencio = setTimeout(() => {
        if (Presenca.fluxo !== fluxo) return;
        Presenca.fluxoDiag.ultimoErro = 'silencio';
        try { fluxo.ctl.abort(); } catch (e) {}
    }, PRESENCA_FLUXO_SILENCIO_MS);
}

async function presencaFluxoAbrir() {
    const chat = Presenca.chat;
    const fluxo = { ctl: new AbortController(), emLote: false, epoca: Presenca.epoca, desde: Date.now(), vivoEm: Date.now() };
    Presenca.fluxo = fluxo;
    Presenca.fluxoDiag.aberturas += 1;
    // O erro é DESTA conexão. Sem zerar, um "silencio" antigo GRUDAVA: o `catch`
    // abaixo não sobrescreve "silencio" (é o vigia abortando, não erro novo), e
    // toda queda seguinte, de outro motivo, ficava registrada como "silencio"
    // (auditoria de 2026-09-25). O histórico vai no diário (`presenca.fluxo`).
    Presenca.fluxoDiag.ultimoErro = null;
    presencaVigiarSilencio(fluxo);
    let fimNormal = false;
    try {
        const base = chat.base.endsWith('/') ? chat.base : chat.base + '/';
        const res = await fetch(base + 'v1/messages:receive', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': chat.chave },
            body: JSON.stringify({ header: {
                request_id: presencaUuid(), app: 'Waze',
                client_info: { api_version: 'V4', platform_type: 7 },
                auth_token_payload: chat.token,
            } }),
            signal: fluxo.ctl.signal,
            credentials: 'omit',
            cache: 'no-store',
        });
        if (res.status === 401 || res.status === 403) {
            // Token recusado: descarta e pede outro, com teto (ver o garantir).
            if (Presenca.chat === chat) Presenca.chat = null;
            Presenca.fluxoDiag.ultimoErro = 'token ' + res.status;
            return;
        }
        if (!res.ok || !res.body) throw new Error('http ' + res.status);
        const leitor = res.body.getReader();
        const dec = new TextDecoder();
        const ler = presencaLeitorDeArray();
        for (;;) {
            const { value, done } = await leitor.read();
            if (done) break;
            if (Presenca.fluxo !== fluxo) return;
            fluxo.vivoEm = Date.now();
            presencaVigiarSilencio(fluxo);
            for (const quadro of ler(dec.decode(value, { stream: true }))) presencaQuadro(fluxo, quadro);
        }
        // Normal é o fim de uma conexão que VIVEU: o Google fecha a cada ~6
        // min, depois de lotes. Uma que termina sem lote nenhum e logo (proxy
        // cortando, corpo vazio) religava a cada 1 s pra sempre, sem recuo.
        fimNormal = !!fluxo.teveLote || Date.now() - fluxo.desde > PRESENCA_FLUXO_VIVEU_MS;
        if (!fimNormal) Presenca.fluxoDiag.ultimoErro = 'fim sem lote';
    } catch (e) {
        if (Presenca.fluxo === fluxo && Presenca.fluxoDiag.ultimoErro !== 'silencio') {
            Presenca.fluxoDiag.ultimoErro = String((e && e.name) || e).slice(0, 40);
        }
    } finally {
        if (Presenca.fluxo === fluxo) {
            Presenca.fluxo = null;
            clearTimeout(Presenca.timers.silencio);
            Presenca.fluxoDiag.ultimoFim = Date.now();
            if (!fimNormal) presencaAnotarQueda(fluxo);
            presencaFluxoReagendar(fimNormal);
        }
    }
}

// A queda vira linha no diário, mas não TODA: numa rede fora por uma hora o
// recuo tenta a cada minuto, e 60 linhas iguais empurrariam o resto do anel
// (120) pra fora. Entram as 3 primeiras de cada série, toda troca de erro e uma
// a cada 10, com o número da queda — que diz quanto a série durou. O fim NORMAL
// (o Google fecha a cada ~6 min) não entra: é contado em `aberturas`.
function presencaAnotarQueda(fluxo) {
    const d = Presenca.fluxoDiag;
    d.quedasSeguidas += 1;
    const n = d.quedasSeguidas, erro = d.ultimoErro || 'fim sem erro';
    if (n <= 3 || erro !== d.erroAnotado || n % 10 === 0) {
        d.erroAnotado = erro;
        presencaAnotar('presenca.fluxo', { ev: 'caiu', erro, quedas: n, durouS: Math.round((Date.now() - fluxo.desde) / 1000) });
    }
}

function presencaFluxoReagendar(fimNormal) {
    if (!presencaPodeConectar()) return;
    clearTimeout(Presenca.timers.fluxo);
    let espera;
    if (fimNormal) {
        espera = PRESENCA_FLUXO_RELIGAR_MS;
    } else {
        const base = PRESENCA_FLUXO_ESPERAS_MS[Math.min(Presenca.fluxoTentativa, PRESENCA_FLUXO_ESPERAS_MS.length - 1)];
        // Jitter de ±25%: se o Google derrubar todo mundo junto, todo mundo
        // volta junto — espera igual pra todos transforma queda em rajada.
        espera = Math.round(base * (0.75 + Math.random() * 0.5));
        Presenca.fluxoTentativa += 1;
    }
    Presenca.timers.fluxo = setTimeout(presencaFluxoGarantir, espera);
}

// O fluxo é UM array JSON que chega aos pedaços e nunca fecha enquanto a
// conexão vive. Este leitor devolve cada objeto do topo assim que ele fecha.
function presencaLeitorDeArray() {
    let buf = '', prof = 0, emStr = false, esc = false, ini = -1;
    return (pedaco) => {
        const saida = [];
        for (let i = 0; i < pedaco.length; i++) {
            const ch = pedaco[i];
            buf += ch;
            if (emStr) {
                if (esc) esc = false;
                else if (ch === '\\') esc = true;
                else if (ch === '"') emStr = false;
                continue;
            }
            if (ch === '"') { emStr = true; continue; }
            if (ch === '{') { if (prof === 0) ini = buf.length - 1; prof += 1; }
            else if (ch === '}') {
                prof -= 1;
                if (prof === 0 && ini >= 0) {
                    try { saida.push(JSON.parse(buf.slice(ini))); } catch (e) { /* quadro quebrado: ignora */ }
                    buf = '';
                    ini = -1;
                }
            }
        }
        // Entre objetos só passam vírgula, colchete e espaço: não acumula.
        if (prof === 0 && ini < 0) buf = '';
        return saida;
    };
}

function presencaQuadro(fluxo, o) {
    if (!o || typeof o !== 'object') return;
    Presenca.fluxoDiag.quadros += 1;
    if (o.startOfBatch) { fluxo.emLote = true; Presenca.fluxoDiag.loteMensagens = 0; return; }
    if (o.endOfBatch) {
        fluxo.emLote = false;
        fluxo.teveLote = true;
        Presenca.fluxoTentativa = 0;
        // O fim do primeiro lote é a prova de que a conexão está VIVA (é aqui que
        // o recuo zera). Entra no diário a primeira da página e a volta depois
        // de queda; as religadas normais, a cada ~6 min, não.
        const d = Presenca.fluxoDiag;
        if (!d.conectou || d.quedasSeguidas) {
            presencaAnotar('presenca.fluxo', d.conectou ? { ev: 'voltou', depoisDe: d.quedasSeguidas } : { ev: 'conectou' });
        }
        if (d.loteMensagens) presencaAnotar('chat.chegou', { lote: d.loteMensagens });
        d.conectou = true;
        d.quedasSeguidas = 0;
        d.loteMensagens = 0;
        return;
    }
    const im = o.inboxMessage;
    if (!im) return;
    // Sem saber de quem é a sessão (o perfil que a renovação ainda não trouxe),
    // a mensagem não tem como entrar — e CONFIRMADA ela não voltaria mais. Fica
    // sem confirmar: o fluxo a reentrega quando reabrir, com o perfil.
    if (!presencaEu()) return;
    // TUDO que chega é confirmado — inclusive a mensagem de quem só usa o WME,
    // que o app não mostra. Confirmar não marca nada como lido (isso é outro
    // método) e não mexe na fila do WME da pessoa: a fila é da INSTALAÇÃO.
    if (im.messageId) chatGuardarAConfirmar(String(im.messageId).toLowerCase());
    if (im.messageType === 'USERDATA' || typeof im.message !== 'string') return;
    let m;
    try { m = presencaLerMensagem(presencaDeBase64(im.message)); } catch (e) { return; }
    presencaMensagemDoFluxo(m, fluxo.emLote);
}

// ── protobuf, só a leitura que o fluxo precisa ──────────────────────────────
//
// Espelho do `server/wme-grpc.mjs` (`lerCampos` + `lerMensagem`), e é o MESMO
// formato: `test/presenca-cliente.test.mjs` decodifica os bytes da fixture com
// os dois e exige o mesmo resultado. Varint vira Number: ids e horas cabem
// folgados em 2^53.
function presencaDeBase64(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}

function presencaLerCampos(u8) {
    const campos = [];
    let i = 0;
    const varint = () => {
        let v = 0, mult = 1, b;
        do {
            if (i >= u8.length) throw new Error('varint cortado');
            b = u8[i++];
            v += (b & 0x7f) * mult;
            mult *= 128;
        } while (b & 0x80);
        return v;
    };
    while (i < u8.length) {
        const chave = varint();
        const n = Math.floor(chave / 8), t = chave % 8;
        if (t === 0) campos.push({ n, v: varint() });
        else if (t === 2) {
            const len = varint();
            if (i + len > u8.length) throw new Error('campo cortado');
            campos.push({ n, v: u8.subarray(i, i + len) });
            i += len;
        } else if (t === 1) i += 8;
        else if (t === 5) i += 4;
        else throw new Error('tipo de fio desconhecido: ' + t);
    }
    return campos;
}

function presencaLerMensagem(u8) {
    const dec = new TextDecoder();
    const um = (c, n) => { const x = c.find((y) => y.n === n); return x ? x.v : undefined; };
    const todos = (c, n) => c.filter((y) => y.n === n).map((y) => y.v);
    const sub = (v) => (v instanceof Uint8Array ? presencaLerCampos(v) : []);
    const txt = (v) => (v instanceof Uint8Array ? dec.decode(v) : null);
    const num = (v) => (typeof v === 'number' ? v : null);
    const ident = (v) => { const c = sub(v); return { tipo: num(um(c, 1)), id: txt(um(c, 2)) }; };
    const c = presencaLerCampos(u8);
    const classe = num(um(c, 6));
    const out = {
        id: txt(um(c, 2)),
        ts: num(um(c, 1)),
        de: um(c, 4) ? ident(um(c, 4)) : null,
        para: um(c, 3) ? ident(um(c, 3)) : null,
        classe: classe === 1 ? 'texto' : classe === 2 ? 'recibo' : 'outro',
        texto: null,
        recibo: null,
        contexto: null,
    };
    if (um(c, 101)) {
        const t = um(sub(um(c, 101)), 101);
        if (t) out.texto = txt(um(sub(t), 1)) ?? '';
    }
    if (um(c, 102)) {
        const r = sub(um(c, 102));
        out.recibo = {
            tipo: ({ 1: 'entregue', 2: 'lida' })[num(um(r, 1))] || 'outro',
            ids: todos(r, 2).map((info) => txt(um(sub(info), 1))),
        };
    }
    if (um(c, 5)) {
        const pares = todos(sub(um(c, 5)), 4).map(sub);
        out.contexto = Object.fromEntries(pares.map((p) => [txt(um(p, 1)), txt(um(p, 2))]));
    }
    return out;
}

// ── as mensagens ────────────────────────────────────────────────────────────

// O texto que vai pro Waze leva, além da pergunta, o nome do local e o link —
// é o que quem lê pelo WME vê (o cartão vai num campo que o WME não mostra).
// No app, a linha e o link não aparecem: aparece o cartão, e a pergunta sai
// daqui de volta (`presencaLegendaDoTexto`).
function presencaTextoParaWme(legenda, card) {
    if (!card) return legenda;
    const link = typeof linkWmeDoPedido === 'function' ? linkWmeDoPedido(card, card.region || API.getRegion()) : '';
    return (legenda ? legenda + '\n' : '') + presencaLinhaDoPedido(card) + (link ? '\n' + link : '');
}

// "📍 Padaria · Nova foto": o pedido numa linha de texto — a do WME e a do
// anúncio pro leitor de tela.
function presencaLinhaDoPedido(card) {
    const nome = (card.name || '').trim() || (card.address || '').trim() || t('card.noName');
    const tipo = presencaTipo(card.updateTypeKey);
    return '📍 ' + nome + (tipo ? ' · ' + tipo : '');
}

// A pergunta de uma mensagem com pedido: tudo ANTES da linha do 📍. A última
// ocorrência, porque a pergunta pode citar o alfinete; a linha do pedido vem
// sempre depois dela.
function presencaLegendaDoTexto(texto) {
    const s = String(texto || '');
    const i = s.lastIndexOf('📍 ');
    if (i < 0) return null;
    if (i === 0) return '';
    return s[i - 1] === '\n' ? s.slice(0, i - 1) : null;
}

// Uma mensagem do Waze (do histórico ou do fluxo) no formato da tela.
function presencaMsgDoWaze(m, eu) {
    const ctx = m.contexto || {};
    let card = null;
    if (typeof ctx.card === 'string') {
        try { card = presencaCardSeguro(JSON.parse(ctx.card)); } catch (e) { card = null; }
    }
    const meu = !!(m.de && String(m.de.id) === eu);
    let legenda = null;
    if (card) {
        legenda = presencaLegendaDoTexto(m.texto);
        if (legenda === null) legenda = typeof ctx.legenda === 'string' ? ctx.legenda : '';
    }
    return {
        id: String(m.id || ''),
        // Sem a hora do Waze, a de agora — no relógio de LÁ, como as outras.
        ts: Number.isFinite(m.ts) ? m.ts : Date.now() + Presenca.desvio,
        meu,
        texto: String(m.texto || '').slice(0, 4000),
        card,
        legenda,
        estado: meu ? 'enviada' : null,
    };
}

function presencaMensagemDoFluxo(m, doLote) {
    const eu = presencaEu();
    if (!eu || !m) return;
    if (m.classe === 'recibo') {
        // Só o "lida" interessa: o "entregue" sairia de graça do aparelho de
        // quem recebe, e o app não o mostra (decisão do owner: só Enviada e Lida).
        if (!m.recibo || m.recibo.tipo !== 'lida') return;
        const de = m.de && String(m.de.id);
        if (!de || de === eu || !PRESENCA_ID.test(de)) return;
        Presenca.fluxoDiag.recibos += 1;
        // Ler a conversa marca TUDO até ali: o recibo vale pra toda mensagem
        // minha mandada antes dele. E pras que ele CITA pelo id, que podem ter
        // hora DEPOIS da dele: o "lida" que a pessoa fez ao abrir a conversa sai
        // com a hora do pedido, e a minha mensagem guardada com esse pedido no
        // ar vem citada nos `ids` com hora maior — só pela hora, ela nunca
        // virava "Lida" (auditoria de 2026-09-30, R5-5-1, V2). A citada que
        // ainda não tem a hora do Waze (saindo) espera por ela
        // (`presencaLidaPorId`).
        let ate = Number.isFinite(m.ts) ? m.ts : Date.now() + Presenca.desvio;
        const citadas = new Set((m.recibo.ids || []).map((x) => String(x || '').toLowerCase()).filter(Boolean));
        const hDela = citadas.size ? Presenca.historico.get(de) : null;
        if (hDela) {
            for (const x of hDela.msgs) {
                if (!x.meu || !citadas.has(String(x.id).toLowerCase())) continue;
                if (x.estado === 'enviada') ate = Math.max(ate, x.ts);
                else Presenca.lidasPorId.add(x.id);
            }
        }
        chatMarcarLidaAte(de, ate);
        if (Presenca.aberta === de) presencaRenderConversa();
        return;
    }
    if (m.classe !== 'texto' || !m.id) return;
    const deMim = !!(m.de && String(m.de.id) === eu);
    const com = String(deMim ? (m.para && m.para.id) : (m.de && m.de.id));
    if (!PRESENCA_ID.test(com) || com === eu) return;
    const daApp = (m.contexto && m.contexto.app === 'wazeplaces')
        || chatConhecido(com) || Presenca.conversas.some((c) => c.id === com);
    // Quem só usa o WME: o app não mostra nada (decisão do owner). Conta, pra o
    // diagnóstico dizer que ela CHEGOU e foi deixada de lado de propósito.
    if (!daApp) { Presenca.fluxoDiag.ignoradas += 1; return; }
    Presenca.fluxoDiag.mensagens += 1;
    chatConhecer(com);
    const msg = presencaMsgDoWaze(m, eu);
    // Junta MESMO com a conversa carregando: a mensagem que chegava com o
    // `abrir` no ar ficava de fora (a resposta dele podia ser anterior a ela) e
    // sumia da conversa — e o "lida" saía por uma mensagem que ninguém viu.
    const h = Presenca.historico.get(com);
    if (h) presencaJuntarMsgs(h, [msg]);
    if (deMim) presencaLidaPorId(com, msg);
    presencaAtualizarPrevia(com, msg);
    const nova = !Presenca.vistas.has(msg.id);
    presencaMarcarVista(msg.id);
    // No diário: a do LOTE vira um número no fim dele; a que chega ao vivo, uma
    // linha por minuto no máximo (`presencaAnotarMsg`).
    if (!deMim && nova) {
        if (doLote) Presenca.fluxoDiag.loteMensagens += 1;
        else presencaAnotarMsg('chat.chegou', { aoVivo: true, olhando: presencaOlhando(com) });
    }
    if (!deMim && nova) {
        if (presencaOlhando(com)) { presencaAgendarLida(com); presencaAnunciar(msg); }
        // Do LOTE só conta o que chegou depois da última lista: o resto a lista
        // já contou, e o fluxo reentrega o que não foi confirmado.
        //
        // Tudo no relógio DAQUI, que é o da `atualizadaEm` e o do `inicio` de
        // cada lista: a do lote vem com a hora do Google, convertida pelo
        // `desvio`; a ao vivo vale pela hora em que CHEGOU, que é exatamente o
        // que a lista seguinte precisa saber ("chegou antes de eu pedir?").
        // E a hora do SERVIDOR de cada uma vai junto (`servs`): é ela que a
        // `atividade` da lista seguinte mede (ver `presencaAplicarLista`).
        else {
            // A mensagem que a pessoa NÃO viu tira a dívida do "lida" desta
            // conversa (`lidaDevendo`): o Waze marca a conversa INTEIRA, e
            // pagá-la agora marcaria esta também — "Lida" pra quem a mandou, e
            // a não lida sumindo daqui sem ninguém ter visto. Ela segue não lida
            // (com a que tinha sido vista), e abrir a conversa marca tudo.
            Presenca.lidaDevendo.delete(com);
            const chegou = doLote ? msg.ts - Presenca.desvio : Date.now();
            if (!doLote || chegou > Presenca.atualizadaEm) {
                const v = Presenca.vivas.get(com) || { n: 0, ultimaTs: 0, servs: [] };
                v.n += 1;
                v.ultimaTs = Math.max(v.ultimaTs, chegou);
                if (Array.isArray(v.servs)) v.servs.push(msg.ts);
                Presenca.vivas.set(com, v);
            }
        }
    }
    presencaRenderTudo();
}

// Junta sem repetir (o fluxo reentrega, e o eco da minha própria mensagem
// volta por ele) e mantém a ordem do relógio.
function presencaJuntarMsgs(h, novas) {
    for (const m of novas) {
        if (!m.id) continue;
        const i = h.msgs.findIndex((x) => x.id === m.id);
        if (i < 0) { h.msgs.push(m); continue; }
        const velha = h.msgs[i];
        // A minha, que estava saindo, virou enviada; o resto não rebaixa.
        if (velha.meu && velha.estado !== 'enviada') { velha.estado = 'enviada'; velha.motivo = null; }
        if (Number.isFinite(m.ts)) velha.ts = m.ts;
    }
    h.msgs.sort((a, b) => a.ts - b.ts);
}

// A minha mensagem que um recibo de "lida" citou pelo id quando ela ainda não
// tinha a hora do Waze (ver o recibo em `presencaMensagemDoFluxo`): com a hora
// (a resposta do `enviar` ou o eco), ela entra na marca do "lida".
function presencaLidaPorId(com, msg) {
    if (!msg || !Presenca.lidasPorId.delete(msg.id)) return;
    chatMarcarLidaAte(com, msg.ts);
}

function presencaAtualizarPrevia(com, msg) {
    let c = Presenca.conversas.find((x) => x.id === com);
    if (!c) {
        const on = Presenca.online.find((p) => p.id === com);
        c = { id: com, nome: on ? on.nome : '', naoLidas: 0, atividade: 0, ultima: null };
        Presenca.conversas.push(c);
        // Conversa nova de quem não está na lista: o nome vem da próxima lista.
        // UM pedido, e só nesse caso raro (primeira mensagem de alguém de fora).
        if (!c.nome) presencaPedirNome();
    }
    if ((c.atividade || 0) > msg.ts) return;
    c.atividade = msg.ts;
    c.ultima = {
        deMim: msg.meu, ts: msg.ts, recibo: false,
        texto: String((msg.card ? msg.legenda : msg.texto) || '').slice(0, 140),
        card: msg.card ? { name: msg.card.name, updateTypeKey: msg.card.updateTypeKey } : null,
    };
}

function presencaPedirNome() {
    clearTimeout(Presenca.timers.nome);
    Presenca.timers.nome = setTimeout(() => presencaAtualizar(), 3000);
}

// "Lida" só é verdade com a conversa ABERTA e o app NA TELA. Modal aberto com
// o celular no bolso não é leitura, e um recibo que mente é pior que nenhum.
//
// E "aberta" é a conversa VISÍVEL, não o `Presenca.aberta`: o `openModal` de
// outra camada (o pedido que chegou pela conversa, por exemplo) ESCONDE a
// conversa sem passar pela limpeza dela, e o `aberta` fica. Sem conferir a
// tela, a próxima mensagem dessa pessoa virava "lida" com a conversa fora da
// vista (achado pelo smoke da presença).
function presencaOlhando(id) {
    return Presenca.aberta === id && document.visibilityState === 'visible' && presencaConversaNaTela();
}

// O modal da conversa está visível. É a régua de "olhando" (acima) e de quem
// pode DESENHAR a conversa (`presencaRenderConversa`): escondida por outra
// camada, ela era redesenhada a cada mensagem que chegava, e a captura do
// diagnóstico (que leva o DOM inteiro) mostrava uma conversa que não estava na
// tela (auditoria de 2026-09-26).
function presencaConversaNaTela() {
    const modal = document.getElementById('conversaModal');
    return !!modal && !modal.classList.contains('hidden');
}

// Quem usa leitor de tela não ouvia a mensagem que chega com a conversa aberta.
// Região viva na lista não serve: ela é redesenhada INTEIRA a cada mensagem, e o
// leitor leria a conversa toda de novo. O anúncio vai por uma região PRÓPRIA, só
// com a que chegou (auditoria de 2026-09-25). Sai ao fechar, com o resto.
function presencaAnunciar(msg) {
    const el = document.getElementById('conversaAnuncio');
    if (!el) return;
    const nome = (document.getElementById('conversaTitle') || {}).textContent || '';
    // Com pedido, o que se ouve é o que a TELA mostra — a pergunta e o pedido
    // —, não o texto que vai pro WME: ele leva o link LONGO do ↗, e o leitor
    // de tela o soletrava inteiro (auditoria de 2026-09-26).
    const texto = msg.card ? [msg.legenda, presencaLinhaDoPedido(msg.card)].filter(Boolean).join('\n') : msg.texto;
    el.textContent = t('presenca.conversa.anuncio', { nome, texto: String(texto || '').slice(0, 280) });
}

// O "lida" que espera a rajada: `lidaPendente` diz de QUEM (a conversa que
// estava na tela) e `timers.lida` é o relógio dele. Só a rajada: o "lida"
// DEVENDO (o que falhou, o que venceu sem saber de quem é a sessão) mora em
// `lidaDevendo`, e a rajada de uma conversa não apaga a dívida de outra — até
// a auditoria de 2026-10-01 (R6-5-1) era o mesmo campo, e abrir OUTRA conversa,
// mesmo vazia, sobrescrevia a dívida. Se ainda houver a rajada de OUTRA
// conversa esperando, ela também não se perde: vira dívida.
function presencaAgendarLida(id) {
    clearTimeout(Presenca.timers.lida);
    if (Presenca.lidaPendente && Presenca.lidaPendente !== id) Presenca.lidaDevendo.add(Presenca.lidaPendente);
    Presenca.lidaPendente = id;
    Presenca.timers.lida = setTimeout(() => presencaPagarLida(), PRESENCA_LIDA_ATRASO_MS);
}

// Manda o "lida" pendente — o MESMO pedido, pela rajada que venceu, pelo
// fechamento da conversa (`fechando`) ou pelo perfil que voltou.
//
// "Olhando é lida": fechar a conversa antes de a rajada vencer (1,2 s) deixava
// no Waze como não lida uma mensagem que a pessoa viu, e a lista seguinte a
// devolvia como "1 mensagem nova" (auditoria de 2026-09-29). Os quatro caminhos
// de fechar (✕, Esc, fundo e voltar) e esconder a conversa sob outro modal
// passam pela limpeza do modal, que PAGA o pendente na hora. Sem pendente, nada
// sai — e o `presencaMarcarLida` ainda não pede quando não há o que marcar.
//
// Sem saber de quem é a sessão (a renovação silenciosa, antes do perfil), ele
// ESPERA, como a fila de saída: vira DÍVIDA (`lidaDevendo`), e o perfil que
// chegar a paga (`presencaSincronizar`). E o "Sair", a troca de conta e a queda
// pra tela de entrada o DESCARTAM (`presencaDesligar`), como o "Sair" descarta
// o swipe que esperava o Desfazer: sessão que sai não grava nada depois. Outra
// conta nunca o paga: o `definirPerfil` roda o `esquecerOutraConta` (que
// desliga) no mesmo passo em que o perfil novo entra — antes de qualquer um
// poder pagar.
//
// O FECHAMENTO paga também as dívidas (`presencaPagarDevidas`): é o momento em
// que a pessoa deixa de olhar, e o "lida" que ficou devendo de OUTRA conversa
// (falhou quando ela fechou aquela) sai junto.
function presencaPagarLida({ fechando = false } = {}) {
    const id = Presenca.lidaPendente;
    if (id) {
        clearTimeout(Presenca.timers.lida);
        Presenca.timers.lida = null;
        Presenca.lidaPendente = null;
        if (presencaEu()) presencaMarcarLida(id, { fechando });
        else Presenca.lidaDevendo.add(id);   // devendo: espera o perfil
    }
    if (fechando) presencaPagarDevidas();
}

// Paga o que está DEVENDO (`lidaDevendo`): o mesmo pedido de sempre, um por
// conversa. Só no fechamento de uma conversa e no `presencaSincronizar` — o
// freio que já existia: nunca por relógio, por mensagem ou por swipe, então
// com o Waze fora é um pedido por conversa devendo a cada gesto desses, e nada
// mais. Sem saber de quem é a sessão, segue devendo. A conversa com a rajada
// correndo fica pra ela (a rajada não se adianta, e o "lida" dela cobre o da
// dívida: o Waze marca a conversa inteira).
//
// É sempre de mensagem que a pessoa VIU: a que chega fora da vista tira a
// dívida da conversa (ver `presencaMensagemDoFluxo`). Por isso sai como a do
// fechamento (`fechando`), sem conferir se a conversa ainda está na tela.
function presencaPagarDevidas() {
    if (!Presenca.lidaDevendo.size || !presencaEu()) return;
    for (const id of [...Presenca.lidaDevendo]) {
        if (id === Presenca.lidaPendente && Presenca.timers.lida) continue;
        Presenca.lidaDevendo.delete(id);
        presencaMarcarLida(id, { fechando: true });
    }
}

// `fechando`: o pago no fechamento — a conversa já saiu (ou está saindo) da
// tela, e era nela que a pessoa estava olhando (ver `presencaPagarLida`).
async function presencaMarcarLida(id, { fechando = false } = {}) {
    if (!fechando && !presencaOlhando(id)) return;
    const h = Presenca.historico.get(id);
    // Conversa ainda carregando: o que chegou nela ainda não está na tela.
    if (!h || !h.carregada) return;
    const ultimaDela = Math.max(0, ...h.msgs.filter((m) => !m.meu).map((m) => m.ts));
    // Nada dela, ou nada depois do último "lida": não há o que marcar, e o
    // pedido seria à toa (voltar pra tela chama isto sempre). Mas a contagem
    // DAQUI pode estar velha — uma lista lida no Waze antes do último "lida",
    // chegada com o app no segundo plano —, e com a conversa na tela ela é zero.
    if (!ultimaDela || (Presenca.lidaEnviadaAte.get(id) || 0) >= ultimaDela) {
        presencaZerarNaoLidas(id, Date.now());
        return;
    }
    const carona = chatCarona();
    const epoca = Presenca.epoca;
    const enviadoEm = Date.now();
    const r = await API.chat({ acao: 'lida', com: id, ...carona });
    chatAoResponder(r, carona);
    if (epoca !== Presenca.epoca) return;   // desligou ou saiu no meio
    // Só DEPOIS da resposta: marcado antes, um "lida" que falhou (rede) ficava
    // dado como enviado — o Waze seguia contando a mensagem como não lida, a
    // pílula mostrava "1" com a conversa aberta e lida, e nada tentava de novo.
    if (r && r.success) {
        Presenca.lidaEnviadaAte.set(id, Math.max(Presenca.lidaEnviadaAte.get(id) || 0, ultimaDela));
        Presenca.lidaSaiuEm.set(id, Math.max(Presenca.lidaSaiuEm.get(id) || 0, enviadoEm));
        // O Waze marca a conversa INTEIRA: a dívida dela, se houver, está paga.
        Presenca.lidaDevendo.delete(id);
        presencaZerarNaoLidas(id, enviadoEm);
    } else {
        // Falhou (a rede, o Waze fora): a mensagem que a pessoa VIU seguia não
        // lida no Waze e nada a refazia — o fechamento não pagava mais nada, e
        // a lista seguinte a devolvia como "1 mensagem nova" (auditoria de
        // 2026-09-30, R5-5-5). Volta a DEVER: o fechamento e o próximo
        // `presencaSincronizar` o pagam. Um pedido a mais, só quando este
        // falhou. SEMPRE, e não só com o campo da rajada vazio: era o mesmo
        // campo, e a falha que chegava com a rajada de OUTRA conversa correndo
        // nem era anotada (R6-5-1).
        Presenca.lidaDevendo.add(id);
        // No diário, que não mostrava falha nenhuma do "lida": uma linha por
        // minuto no máximo, com quantas vieram juntas — o Waze fora faria uma
        // por conversa devendo a cada fechamento (`presencaAnotarMsg`).
        presencaAnotarMsg('chat.lida', { ok: false, categoria: (r && r.errorCategory) || 'sem resposta' });
    }
}

// O Waze zerou a conversa: a contagem DAQUI também. Sem isto, o "1" que a lista
// trouxe com o app no segundo plano (ou que chegou ao vivo com a tela apagada)
// ficava na pílula com a conversa aberta e lida, até a próxima lista (auditoria
// de 2026-09-26). O que chegou ao vivo DEPOIS de `ate` — com a conversa fechada
// no meio do "lida" — continua contando.
function presencaZerarNaoLidas(id, ate) {
    const c = Presenca.conversas.find((x) => x.id === id);
    const v = Presenca.vivas.get(id);
    const tinha = !!(c && c.naoLidas) || !!v;
    if (c) c.naoLidas = 0;
    if (v && v.ultimaTs <= ate) Presenca.vivas.delete(id);
    if (!tinha) return;
    presencaRenderPilula();
    presencaRenderLista();
}

// ── a conversa ──────────────────────────────────────────────────────────────

// A folha da presença (a lista, a conversa e o pedido que chegou nela) mora no
// RODAPÉ, embaixo do banner do Desfazer (`#notifyStack`, z-70, também no
// rodapé). Aberta na janela do Desfazer, o banner ficava em cima da linha da
// pessoa, do campo e do "Enviar" — e o toque no "Enviar" caía no "Desfazer": a
// decisão do card era desfeita atrás da folha, e a mensagem não saía (auditoria
// de 2026-10-01, R6-5-4, medido no 393 e no Fold). Abrir a folha DESPACHA a
// janela, como fechar a foto ampliada despacha a aprovação e o "Marcar todos" e
// o treino despacham a do card: a decisão sai agora, e o banner sai com ela.
// Nada muda na tela além do banner sumir — como some quando a janela termina.
function presencaDespacharJanela() {
    if (typeof despacharJanelaDoDesfazer === 'function') despacharJanelaDoDesfazer();
}

// A folha está na tela. Com ela aberta, a decisão que CHEGA (o gesto saiu antes
// e a animação do card dura 350 ms: tocar a pílula nesse meio era o mesmo
// defeito por outro caminho) sai sem janela — quem pergunta é o `scheduleAction`
// do app.js, que carrega antes deste arquivo e chama esta função pelo nome.
function presencaFolhaAberta() {
    return ['presencaModal', 'conversaModal', 'pedidoModal'].some((id) => {
        const m = document.getElementById(id);
        return !!m && !m.classList.contains('hidden');
    });
}

function presencaAbrirConversa(id) {
    id = String(id);
    if (!PRESENCA_ID.test(id)) return;
    // O pedido preso é da conversa em que foi preso. Escondida por outra camada
    // (a folha do pedido recebido), a conversa não passa pela limpeza dela, e o
    // anexo ficava: abrir a conversa com OUTRA pessoa mostrava o pedido na
    // tirinha — e ele saía junto no envio, pra quem não era o destino
    // (auditoria de 2026-09-26).
    if (Presenca.aberta !== id) { Presenca.anexo = null; Presenca.nomeDaAberta = null; }
    // A janela do Desfazer não fica por cima da conversa (ver a função).
    presencaDespacharJanela();
    Presenca.aberta = id;
    // O nome de quem se abriu, de onde ele estiver agora (ver `nomeDaAberta`).
    const quem = Presenca.online.find((p) => p.id === id) || Presenca.conversas.find((x) => x.id === id);
    if (quem && quem.nome) Presenca.nomeDaAberta = quem.nome;
    // Abrir é a hora de tentar de novo a foto que não tinha carregado.
    Presenca.fotosFalhas.clear();
    // E o TEXTO no campo também é da conversa (ver a função).
    presencaTrocarRascunho(id);
    chatConhecer(id);
    // Abrir é ler: o servidor marca como lida no mesmo pedido do histórico.
    const c = Presenca.conversas.find((x) => x.id === id);
    if (c) c.naoLidas = 0;
    Presenca.vivas.delete(id);
    // `openModal` sozinho: ele JÁ esconde os outros modais, e trocar de camada
    // não empilha histórico (gotcha #65).
    openModal('conversaModal');
    presencaRenderConversa({ rolarAoFim: true });
    presencaRenderAnexo();
    presencaRenderPilula();
    presencaRenderLista();
    presencaCarregarConversa(id);
    const campo = document.getElementById('conversaInput');
    if (campo) campo.focus();
}

async function presencaCarregarConversa(id, { antes = null } = {}) {
    let h = Presenca.historico.get(id);
    if (!h) { h = { msgs: [], maisAntigas: false, carregada: false, erro: false, carregando: false }; Presenca.historico.set(id, h); }
    if (h.carregando) return;
    // De quem é a sessão decide o que é MEU no histórico (`presencaMsgDoWaze`).
    // Na renovação silenciosa (a extensão devolveu a sessão e o perfil ainda não
    // voltou), o `abrir` saía mesmo assim: as minhas mensagens vinham como
    // "dela" e ficavam assim pelo resto da sessão — e o "lida" do `abrir` saía
    // sem saber de quem era a sessão (auditoria de 2026-09-30, R5-5-2). Não
    // sai: fica "Carregando", e o perfil que chegar o pede
    // (`presencaSincronizar`). Como o "Enviar" e o "Tentar de novo" do envio.
    const eu = presencaEu();
    if (!eu) {
        // Sem o histórico na tela, o que espera é a PRIMEIRA página: a antiga
        // só existe depois dela.
        h.esperaPerfil = { antes: h.carregada ? antes : null };
        if (h.esperaPerfil.antes) h.antigas = 'carregando';
        else h.erro = false;
        presencaRenderConversa();
        return;
    }
    h.esperaPerfil = null;
    h.carregando = true;
    // A página antiga tem estado PRÓPRIO (`antigas`): a falha dela não é a do
    // histórico, que já está na tela (ver `presencaHtmlAnteriores`). E a
    // primeira página recomeça as duas: reabrir a conversa não traz de volta o
    // erro de uma página antiga que falhou da outra vez.
    if (antes) h.antigas = 'carregando';
    else { h.erro = false; h.antigas = null; }
    presencaRenderConversa();
    const epoca = Presenca.epoca;
    const carona = chatCarona();
    // A hora em que o `abrir` SAI: o "lida" dele só cobre o que já estava
    // guardado (ver o `corte`, abaixo).
    const saiuEm = Date.now();
    const r = await API.chat({ acao: 'abrir', com: id, ...(antes ? { antesDe: antes } : {}), ...carona });
    h.carregando = false;
    if (epoca !== Presenca.epoca) return;
    chatAoResponder(r, carona);
    if (!r || !r.success) {
        if (antes) h.antigas = 'erro';
        else h.erro = true;
        presencaAnotar('chat.abrir', { ok: false, categoria: (r && r.errorCategory) || 'sem resposta', pagina: antes ? 'antiga' : 'primeira' });
        if (r && r.errorCategory === 'unauthorized' && typeof handleUnauthorized === 'function') handleUnauthorized();
        presencaRenderConversa();
        return;
    }
    // `eu` é o de QUANDO o pedido saiu: a sessão pode ter caído com ele no ar
    // (o perfil some), e a resposta é da conta que perguntou.
    const msgs = (Array.isArray(r.mensagens) ? r.mensagens : [])
        .filter((m) => m && m.classe === 'texto' && m.id)
        .map((m) => presencaMsgDoWaze(m, eu));
    for (const m of msgs) presencaMarcarVista(m.id);
    presencaJuntarMsgs(h, msgs);
    // `maisAntigas` diz se há página ANTES da que chegou. Na primeira, é a
    // resposta; numa página antiga, idem — a de cima da lista é sempre a última.
    h.maisAntigas = !!r.maisAntigas;
    h.carregada = true;
    if (antes) h.antigas = null;
    presencaAnotar('chat.abrir', { ok: true, mensagens: msgs.length, maisAntigas: h.maisAntigas, pagina: antes ? 'antiga' : 'primeira' });
    if (!antes) {
        // O "lida" do `abrir` cobre só o que já estava guardado quando ele
        // SAIU: o servidor lê o histórico e marca como lida EM PARALELO, e a
        // mensagem guardada entre os dois vem no histórico sem ter sido marcada.
        // Contada como coberta, nem a rajada nem o fechamento a marcavam: ela
        // ficava não lida no Waze, quem mandou nunca via "Lida", e a lista
        // seguinte a devolvia como "1 mensagem nova" (auditoria de 2026-09-30,
        // R5-5-1, V3). O corte é a saída do pedido no relógio do Waze (pelo
        // `desvio`); o que passou dele o `presencaAgendarLida` do fim marca —
        // um pedido a mais, só nessa corrida.
        const corte = saiuEm + Presenca.desvio;
        const ultimaDela = Math.max(0, ...msgs.filter((m) => !m.meu && m.ts <= corte).map((m) => m.ts));
        // Só com o "lida" CONFIRMADO pelo servidor (`lida: true`). Falhou no
        // Waze, a resposta vinha igual à de "nada a marcar", o app dava a
        // conversa como lida e nunca mais pedia com ela aberta (auditoria de
        // 2026-09-26). Sem a marca aqui, o `presencaAgendarLida` logo abaixo
        // manda o "lida" que faltou — um pedido, só quando o do `abrir` falhou.
        if (ultimaDela && r.lida === true) Presenca.lidaEnviadaAte.set(id, ultimaDela);
        if (r.lida === true) Presenca.lidaSaiuEm.set(id, Math.max(Presenca.lidaSaiuEm.get(id) || 0, saiuEm));
    }
    presencaRenderConversa({ rolarAoFim: !antes, manterTopo: !!antes });
    // O que chegou pelo fluxo DURANTE o carregamento entrou no histórico (ver
    // `presencaMensagemDoFluxo`) depois do "lida" que o `abrir` já fez: agora
    // que está na tela, marca.
    if (!antes && presencaOlhando(id)) presencaAgendarLida(id);
}

// A página ANTES da primeira mensagem na tela.
function presencaCarregarAntigas(id) {
    const h = Presenca.historico.get(id);
    const antes = h && h.msgs.length ? h.msgs[0].ts : null;
    if (antes) presencaCarregarConversa(id, { antes });
}

function presencaFecharConversa() {
    closeModal('conversaModal');   // a limpeza do modal solta o `aberta`
}

// O texto no campo é da conversa `rascunhoDe`. Ele ATRAVESSAVA pra conversa com
// outra pessoa: digitado pra X, sem mandar, fechar e abrir a de Y o mostrava
// no campo de Y — e o "Enviar" o mandava pra Y (reproduzido também depois de
// uma queda de sessão, que preserva o que foi digitado). Trocar de conversa
// guarda o texto de uma e põe o da outra (vazio, se ela não tiver). Com a
// MESMA conversa, nada muda: é o que a queda preserva, pro mesmo destinatário
// (auditoria da costura, 2026-09-26, K10).
function presencaTrocarRascunho(id) {
    const campo = document.getElementById('conversaInput');
    if (!campo) return;
    if (Presenca.rascunhoDe) {
        if (String(campo.value || '').trim()) Presenca.rascunhos.set(Presenca.rascunhoDe, campo.value);
        else Presenca.rascunhos.delete(Presenca.rascunhoDe);
    }
    campo.value = Presenca.rascunhos.get(id) || '';
    Presenca.rascunhos.delete(id);
    Presenca.rascunhoDe = id;
}

// Chamado por LIMPEZA_AO_FECHAR['conversaModal'] — ou seja, por QUALQUER
// caminho de fechamento (✕, Esc, scrim, voltar do aparelho).
function presencaEsquecerAberta() {
    // O "lida" pendente é da conversa que sai da tela: sai agora (ver
    // `presencaPagarLida`).
    presencaPagarLida({ fechando: true });
    Presenca.aberta = null;
    Presenca.nomeDaAberta = null;
    // O anexo é da conversa, não do aparelho: fechar sem mandar descarta. Vai
    // AQUI e não no ✕, pelos mesmos quatro caminhos de fechamento.
    Presenca.anexo = null;
    presencaRenderAnexo();
    // Fechada, a conversa não fica desenhada: o próximo abrir redesenha do
    // zero, e a captura do diagnóstico (que leva o DOM inteiro) mostra o que
    // estava NA TELA, não a última conversa aberta escondida num modal.
    presencaDesenhar(document.getElementById('conversaMsgs'), '');
    const anuncio = document.getElementById('conversaAnuncio');
    if (anuncio) anuncio.textContent = '';
    // O TOPO também: o nome de quem conversou e onde a pessoa está (nível e
    // distância) ficavam no DOM depois de fechar — e depois do "Sair", que passa
    // por aqui (auditoria de 2026-09-29).
    const titulo = document.getElementById('conversaTitle');
    if (titulo) titulo.textContent = '';
    const estado = document.getElementById('conversaEstado');
    if (estado) { presencaDesenhar(estado, ''); estado.classList.add('hidden'); }
    presencaRenderPilula();
    presencaRenderLista();
}

// Idem para a lista.
function presencaEsquecerLista() {
    presencaDesenhar(document.getElementById('presencaLista'), '');
}

function presencaEnviar(legenda, card) {
    const id = Presenca.aberta;
    const eu = presencaEu();
    if (!id || !eu) return;
    const h = Presenca.historico.get(id) || { msgs: [], maisAntigas: false, carregada: false, erro: false, carregando: false };
    Presenca.historico.set(id, h);
    // A hora é a do SERVIDOR (o relógio daqui mais o `desvio`), até a resposta
    // trazer a de verdade: as das mensagens dela e a `atividade` da conversa são
    // de lá. Com a hora crua de um aparelho 2 min adiantado, a minha mensagem
    // ficava "mais nova" que a resposta dela, e a prévia da lista não mudava
    // mais (auditoria de 2026-09-29).
    const msg = {
        id: presencaUuid(), ts: Date.now() + Presenca.desvio, meu: true,
        texto: presencaTextoParaWme(legenda, card), card: card || null, legenda: card ? legenda : null,
        estado: 'enviando', motivo: null,
    };
    h.msgs.push(msg);
    chatConhecer(id);
    presencaAtualizarPrevia(id, msg);
    presencaRenderConversa({ rolarAoFim: true });
    presencaMandar(id, msg);
}

async function presencaMandar(com, msg) {
    msg.estado = 'enviando';
    msg.motivo = null;
    presencaRenderConversa();
    // O cartão vai num campo que o WME não mostra, com a pergunta curta pra
    // prévia da lista. A MARCA do app quem põe é o servidor.
    const contexto = msg.card ? { legenda: String(msg.legenda || '').slice(0, 280), card: JSON.stringify(msg.card) } : undefined;
    const carona = chatCarona();
    // Uma tentativa só, sem `callWithRetry`: repetir sozinho pode duplicar a
    // mensagem no Waze. Quem repete é a pessoa, no "Tentar de novo" — com o
    // MESMO id, que é o que dá ao Waze a chance de reconhecer a repetição.
    const r = await API.chat({
        acao: 'enviar', para: com, id: msg.id, texto: msg.texto, de: presencaEu(),
        ...(contexto ? { contexto } : {}), ...carona,
    });
    chatAoResponder(r, carona);
    // A falha entra SEMPRE (é o que o relato investiga, e cada uma espera um
    // "Tentar de novo" da pessoa); o envio que deu certo, uma linha por minuto.
    const envio = { bytes: String(msg.texto || '').length, comPedido: !!msg.card };
    if (r && r.success) presencaAnotarMsg('chat.envio', { ok: true, ...envio });
    else presencaAnotar('chat.envio', { ok: false, categoria: (r && r.errorCategory) || 'sem resposta', ...envio });
    if (r && r.success) {
        msg.estado = 'enviada';
        if (Number.isFinite(r.ts)) msg.ts = r.ts;
        presencaMarcarVista(msg.id);
        presencaLidaPorId(com, msg);
    } else if (msg.estado === 'enviada') {
        // O ECO já voltou pelo tempo real (`presencaJuntarMsgs`): o Waze RECEBEU
        // a mensagem, e foi a resposta que se perdeu no caminho. Rebaixar pra
        // "Não enviada" mentia, e o "Tentar de novo" mandaria de novo o que já
        // chegou (auditoria de 2026-09-25).
        if (r && r.errorCategory === 'unauthorized' && typeof handleUnauthorized === 'function') handleUnauthorized();
    } else {
        msg.estado = 'falhou';
        // "Sem conexão" só quando a resposta NEM CHEGOU (o `_post` põe
        // `_motivo`). O Waze fora também volta `transient`, mas COM resposta: a
        // rede está boa, e dizer "sem conexão" mandava a pessoa procurar sinal
        // (auditoria de 2026-09-29). Aí é o "Não enviada." sem motivo.
        msg.motivo = presencaSemResposta(r) ? 'conexao' : 'erro';
        if (r && r.errorCategory === 'unauthorized' && typeof handleUnauthorized === 'function') handleUnauthorized();
    }
    presencaRenderConversa();
    presencaRenderLista();
}

function presencaTentarDeNovo() {
    const id = Presenca.aberta;
    const h = id && Presenca.historico.get(id);
    // Sem o id do perfil (a sessão renovando), não sai — como o "Enviar" com o
    // campo cheio: sairia pela sessão NOVA, que pode ser de outra conta. A
    // mensagem segue "Não enviada", com o botão, até o perfil chegar.
    if (!h || !presencaEu()) return;
    for (const m of h.msgs.filter((x) => x.meu && x.estado === 'falhou')) presencaMandar(id, m);
}

// Prende o pedido ABERTO à barra. Não manda ainda: a tirinha existe justamente
// pra você conferir o que vai sair, porque com a conversa aberta o card está
// atrás do modal e não dá pra ver de outro jeito.
function presencaAnexarCard() {
    if (!Presenca.aberta) return;
    const card = window.cardParaConversa ? window.cardParaConversa() : null;
    if (!card) return;   // sem pedido aberto não há o que prender
    Presenca.anexo = card;
    presencaRenderAnexo();
    const campo = document.getElementById('conversaInput');
    if (campo) campo.focus();
}

function presencaSoltarAnexo() {
    Presenca.anexo = null;
    presencaRenderAnexo();
}

// O ✕ da tirinha ("Não mandar este pedido"): solta, e o foco que estava nela
// não cai no <body> — a tirinha some com ele dentro, e quem usa teclado ou
// leitor de tela perdia o lugar (auditoria de 2026-09-30, R5-5-7). Vai pro
// botão de prender, que volta a aparecer no mesmo lugar; sem ele, pro ✕ da
// conversa. Nunca pro campo: abriria o teclado do celular.
function presencaTirarAnexo() {
    const tira = document.getElementById('conversaAnexo');
    const tinhaFoco = !!(tira && document.activeElement && tira.contains(document.activeElement));
    presencaSoltarAnexo();
    if (!tinhaFoco) return;
    const botao = document.getElementById('conversaCardBtn');
    const alvo = botao && !botao.classList.contains('hidden') ? botao : document.getElementById('conversaClose');
    if (alvo) alvo.focus({ preventScroll: true });
}

// Desenha a tirinha e decide se o BOTÃO existe. As duas coisas na mesma função
// porque são o mesmo estado visto de dois lugares: com anexo preso, a tirinha
// aparece e o botão sai (já tem um pedido esperando); sem anexo, o botão só
// existe se houver pedido aberto pra mandar.
function presencaRenderAnexo() {
    const tira = document.getElementById('conversaAnexo');
    const botao = document.getElementById('conversaCardBtn');
    if (!tira || !botao) return;
    const a = Presenca.anexo;
    tira.classList.toggle('hidden', !a);
    const img = document.getElementById('conversaAnexoFoto');
    if (a) {
        const nome = (a.name || '').trim() || (a.address || '').trim() || t('card.noName');
        document.getElementById('conversaAnexoNome').textContent = nome;
        document.getElementById('conversaAnexoMeta').textContent = presencaResumoDoCard(a);
        // Quem some é a CAIXA, não o <img>: escondendo só a imagem sobravam
        // 40px de vão vazio com o `gap` do lado, que lê como foto que não
        // carregou.
        const caixa = img.parentElement;
        if (a.imageUrl) { img.src = a.imageUrl; caixa.classList.remove('hidden'); }
        else { img.removeAttribute('src'); caixa.classList.add('hidden'); }
    } else {
        // Solto — mandado, tirado, ou a conversa fechou: a tirinha escondida
        // guardava o nome e a foto do pedido (dado de TERCEIRO), e a captura do
        // diagnóstico os levava depois do "Sair" (auditoria de 2026-09-29).
        document.getElementById('conversaAnexoNome').textContent = '';
        document.getElementById('conversaAnexoMeta').textContent = '';
        img.removeAttribute('src');
        img.parentElement.classList.add('hidden');
    }
    // Ação impossível sai da frente em vez de virar botão morto.
    const temPedido = !!(window.cardParaConversa && window.cardParaConversa());
    botao.classList.toggle('hidden', !!a || !temPedido);
}

// O nome do tipo do pedido, pela MESMA regra do card (`rotuloDeEnum`): chave que
// o dicionário não conhece sai humanizada — feio, nunca a chave crua na tela. O
// tipo que chega é de OUTRO aparelho, e ele pode ser de uma versão que conhece
// um tipo que esta não conhece.
function presencaTipo(chave) {
    if (!chave) return '';
    return typeof rotuloDeEnum === 'function' ? rotuloDeEnum('card.updateType.', chave) : t('card.updateType.' + chave);
}

// "Foto nova · Padaria". Tipo e categoria são CHAVE e enum crus no que trafega;
// a palavra é escolhida aqui, na língua de quem lê.
function presencaResumoDoCard(card) {
    const partes = [];
    if (card.updateTypeKey) partes.push(presencaTipo(card.updateTypeKey));
    // Categoria sai CRUA: o Waze regionaliza por PAÍS, não por idioma (gotcha #39).
    if (card.categories && card.categories.length) partes.push(card.categories[0]);
    return partes.join(' · ');
}

// O que chega pela rede é DADO DE OUTRO APARELHO, e o outro aparelho pode estar
// rodando qualquer coisa. Aqui se copia campo a campo, com tipo e teto — nada de
// espalhar o objeto recebido, que aceitaria qualquer chave que ele inventasse.
//
// A `imageUrl` é o campo perigoso: ela vira `src` de uma <img>, então só passa
// URL https do HOST das fotos do Waze — o único que o card monta
// (`WAZE_IMAGE_BASE` no core). Aceitava qualquer `*.waze.com`, e aí quem manda
// escolheria um GET em `www.waze.com` que o aparelho de quem recebe faria com
// os cookies do WME dele (auditoria de 2026-09-25). A CSP é a outra camada.
const PRESENCA_FOTO_OK = /^https:\/\/venue-image\.waze\.com\//i;
function presencaCardSeguro(c) {
    if (!c || typeof c !== 'object') return null;
    const txt = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const num = (v) => (Number.isFinite(v) ? v : null);
    const venueID = txt(c.venueID, 128);
    if (!venueID) return null;   // sem alvo não há pedido
    const foto = txt(c.imageUrl, 500);
    return {
        venueID,
        updateRequestID: txt(c.updateRequestID, 128) || null,
        name: txt(c.name, 200),
        address: txt(c.address, 300),
        categories: Array.isArray(c.categories)
            ? c.categories.filter((x) => typeof x === 'string').slice(0, 4).map((x) => x.slice(0, 60))
            : [],
        updateTypeKey: txt(c.updateTypeKey, 40) || null,
        imageUrl: PRESENCA_FOTO_OK.test(foto) ? foto : null,
        lat: num(c.lat), lon: num(c.lon),
        // MIGRACAO: regiao-world — cartão mandado por versão anterior, que
        // ainda chamava a América do Norte de `world`.
        region: c.region === 'world' ? 'na' : REGIOES_DO_WAZE.includes(c.region) ? c.region : 'row',
    };
}

// ── interface ───────────────────────────────────────────────────────────────

// ── redesenhar só o que MUDOU, com o foco onde estava ──────────────────────
//
// A lista e a conversa são redesenhadas por `innerHTML` a cada mensagem que
// chega e a cada resposta, e o `innerHTML` DESTRÓI o elemento focado: o foco
// caía no <body>, e quem usa teclado ou leitor de tela voltava pro topo da
// página no meio da conversa (auditoria de 2026-09-29, medido no Chromium e no
// WebKit). E o topo da conversa (`#conversaEstado`, região viva) era reescrito
// com a MESMA frase duas vezes por mensagem — e região viva reescrita pode ser
// lida de novo. Duas regras, na mesma função:
//   · o que não mudou não é redesenhado;
//   · o que mudou devolve o foco ao MESMO controle (a mesma pessoa, a mesma
//     mensagem), como o `devolverFocoAoPainel` do Histórico. Sem equivalente,
//     o ✕ da folha — nunca o <body>, e nunca o campo de texto, que abriria o
//     teclado do celular por cima da conversa.
const PRESENCA_DESENHADO = new WeakMap();
// Os controles que o `innerHTML` recria: a linha de uma pessoa, o cartão de um
// pedido e os três botões de texto da conversa.
const PRESENCA_FOCAVEIS = ['presenca-linha', 'conversa-pedido', 'conversa-reenviar', 'conversa-recarregar', 'conversa-anteriores'];

// QUEM o controle representa: a pessoa da linha, a mensagem do cartão, ou a
// página antiga do "Tentar de novo". Os outros botões são únicos na conversa.
function presencaQuemE(el) {
    return el.getAttribute('data-pessoa') || el.getAttribute('data-id') || el.getAttribute('data-antigas') || '';
}

function presencaChaveDoFoco(raiz) {
    const a = document.activeElement;
    if (!raiz || !a || a === raiz || !a.classList || !raiz.contains(a)) return null;
    const classe = PRESENCA_FOCAVEIS.find((c) => a.classList.contains(c));
    if (!classe) return null;
    return { classe, quem: presencaQuemE(a), i: [...raiz.querySelectorAll('.' + classe)].indexOf(a) };
}

function presencaDevolverFoco(raiz, chave, reserva) {
    const irmaos = [...raiz.querySelectorAll('.' + chave.classe)];
    let alvo = irmaos.find((e) => presencaQuemE(e) === chave.quem) || null;
    // Na lista, quem saiu cede o lugar à linha da mesma posição — como numa
    // lista que se apaga item a item.
    if (!alvo && chave.classe === 'presenca-linha') alvo = irmaos[Math.min(chave.i, irmaos.length - 1)] || null;
    if (!alvo) alvo = document.getElementById(reserva);
    if (alvo && typeof alvo.focus === 'function') alvo.focus({ preventScroll: true });
}

// Troca o conteúdo de `el` SÓ se ele mudou, e devolve se trocou. Com `reserva`
// (o id do ✕ da folha), o foco que estava dentro volta ao mesmo controle.
// Quem esvazia uma destas regiões passa por aqui também: escrever por fora
// deixaria a memória do último desenho mentindo, e o redesenho seguinte, igual
// ao último, seria pulado com a região vazia.
function presencaDesenhar(el, html, reserva) {
    if (!el) return false;
    if (PRESENCA_DESENHADO.get(el) === html) return false;
    const foco = reserva ? presencaChaveDoFoco(el) : null;
    el.innerHTML = html;
    PRESENCA_DESENHADO.set(el, html);
    if (foco) presencaDevolverFoco(el, foco, reserva);
    return true;
}

function presencaRenderTudo() {
    presencaRenderPilula();
    const folha = document.getElementById('presencaModal');
    if (folha && !folha.classList.contains('hidden')) presencaRenderLista();
    if (Presenca.aberta) presencaRenderConversa();
}

function presencaRenderPilula() {
    const btn = document.getElementById('presencaPill');
    if (!btn) return;
    const ligado = presencaLigada() && AppState.authenticated;
    const n = Presenca.online.length;
    const naoLidas = presencaNaoLidasTotal();
    // Sem ninguém e sem mensagem, a pílula SOME: ela não é botão de recurso, é
    // a notícia de que tem gente. Com mensagem NÃO LIDA ela fica, mesmo sem
    // ninguém no app — a mensagem pode vir de quem já saiu, e sem a pílula a
    // conversa não teria caminho de volta.
    const some = !ligado || (n === 0 && naoLidas === 0);
    btn.classList.toggle('hidden', some);
    if (some) return;
    // Mensagem nova troca o ÍCONE (gente → balão), não só a cor: cor sozinha
    // não transmite informação (WCAG 1.4.1).
    document.getElementById('presencaIconGente').classList.toggle('hidden', naoLidas > 0);
    document.getElementById('presencaIconMsg').classList.toggle('hidden', naoLidas === 0);
    const selo = document.getElementById('presencaCount');
    const valor = naoLidas > 0 ? naoLidas : n;
    selo.classList.toggle('hidden', valor === 0);
    selo.textContent = valor > 99 ? '99+' : String(valor);
    selo.classList.toggle('tem-msg', naoLidas > 0);
    const rotulo = naoLidas > 0
        ? presencaRotuloNaoLidas(naoLidas)
        : t(n === 1 ? 'presenca.pill.aria' : 'presenca.pill.ariaPlural', { n });
    btn.setAttribute('aria-label', rotulo);
    btn.setAttribute('title', rotulo);
}

// De onde medir o "a 3 km daqui": o card NA TELA, que é onde a pessoa está
// olhando — e é a mesma posição que a carona escreve no WME. Sem card na tela
// (fila vazia), vale o último que esteve.
function presencaMinhaPosicao() {
    const c = AppState.currentPlace && AppState.currentPlace.mapa && AppState.currentPlace.mapa.centro;
    if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) Presenca.ultimaPosicao = [c[0], c[1]];
    return Presenca.ultimaPosicao;
}

// Contagem sai CRUA (decisão do owner: número inteiro é portável pra qualquer
// idioma), então "a 1920 km", sem separador de milhar.
function presencaDistancia(p) {
    const eu = presencaMinhaPosicao();
    if (!eu || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || typeof distanciaKm !== 'function') return null;
    const km = distanciaKm(eu, [p.lat, p.lon]);
    return { km, texto: km < 1 ? t('presenca.distPerto') : t('presenca.dist', { km: String(Math.round(km)) }) };
}

function presencaNomeDoPais(id) {
    const c = (AppState.countries || []).find((x) => String(x.id) === String(id));
    return c ? c.name : '';
}

// Hora curta pra lista: hoje "14:02", ontem "ontem", na semana o dia, e antes
// disso a data. Sempre no locale de quem lê.
function presencaHoraCurta(ts) {
    if (!Number.isFinite(ts)) return '';
    const d = new Date(ts), hoje = new Date();
    const dias = Math.round((new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
        - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
    if (dias <= 0) return d.toLocaleTimeString(i18nLocale(), { hour: '2-digit', minute: '2-digit' });
    if (dias === 1) return t('presenca.hora.ontem');
    if (dias < 7) return d.toLocaleDateString(i18nLocale(), { weekday: 'short' });
    return d.toLocaleDateString(i18nLocale(), { day: 'numeric', month: 'short' });
}

function presencaPrevia(u) {
    if (!u) return '';
    if (u.card) {
        if (u.texto) return '📍 ' + u.texto;
        const nome = (u.card.name || '').trim() || t('card.noName');
        const tipo = presencaTipo(u.card.updateTypeKey);
        return '📍 ' + nome + (tipo ? ' · ' + tipo : '');
    }
    return u.texto || '';
}

function presencaBadge(n) {
    return n ? `<span class="presenca-badge">${n > 9 ? '9+' : n}</span>` : '';
}

// "3 mensagens novas" — as MESMAS palavras da pílula (mesmo conceito, mesmo
// termo). Vazio sem nada novo.
function presencaRotuloNaoLidas(n) {
    return n ? t(n === 1 ? 'presenca.pill.msg' : 'presenca.pill.msgPlural', { n }) : '';
}

function presencaRenderLista() {
    const lista = document.getElementById('presencaLista');
    if (!lista) return;
    // Só com a folha NA TELA. Abrir e fechar uma conversa, mandar uma mensagem e
    // desligar redesenhavam a lista com a folha fechada, e a prévia das conversas
    // (texto de terceiro) voltava pro DOM escondida — a captura do diagnóstico
    // mostrava o que NÃO estava na tela (auditoria de 2026-09-25). Fechada, ela
    // fica vazia; abrir redesenha (o toque na pílula chama isto DEPOIS do
    // `openModal`).
    const folha = document.getElementById('presencaModal');
    if (!folha || folha.classList.contains('hidden')) { presencaDesenhar(lista, ''); return; }
    const sub = document.getElementById('presencaSub');
    if (sub) {
        const pais = presencaNomeDoPais(Presenca.pais || API.getCountry());
        sub.textContent = pais ? t('presenca.sheet.sub', { pais }) : t('presenca.sheet.subSemPais');
    }
    // Quem está no app, do mais perto pro mais longe: "a quem perguntar sobre
    // este lugar" é a pergunta que a distância responde.
    const gente = Presenca.online.map((p) => ({ p, d: presencaDistancia(p) }))
        .sort((a, b) => (a.d ? a.d.km : Infinity) - (b.d ? b.d.km : Infinity)
            || String(a.p.nome || '').localeCompare(String(b.p.nome || ''), i18nLocale()));
    // Cada linha leva o nome acessível MONTADO, com as partes separadas: tirado
    // do conteúdo, o leitor de tela lia "cafanhaL4 a 3 km daqui3" — o nome
    // colado no nível, e um "3" solto no fim, sem dizer que eram mensagens
    // (auditoria de 2026-09-26). A tela não muda.
    const linhasOnline = gente.map(({ p, d }) => {
        const nome = p.nome || t('presenca.anon');
        const nivel = 'L' + String((p.rank || 0) + 1);
        const n = presencaNaoLidasDe(p.id);
        const rotulo = [nome, nivel, d && d.texto, presencaRotuloNaoLidas(n)].filter(Boolean).join(', ');
        return `<li>
            <button type="button" class="presenca-linha" data-pessoa="${escapeHtml(p.id)}" aria-label="${escapeHtml(rotulo)}">
                <span class="presenca-txt">
                    <span class="presenca-l1"><span class="presenca-nome">${escapeHtml(nome)}</span><span class="presenca-selos">${escapeHtml(nivel)}</span></span>
                    ${d ? `<span class="presenca-l2">${escapeHtml(d.texto)}</span>` : ''}
                </span>
                ${presencaBadge(n)}
            </button>
        </li>`;
    }).join('');

    // Conversas com quem NÃO está no app agora (quem está já aparece acima,
    // com o selo das não lidas): as mais recentes, e toda que tiver não lida.
    const naApp = new Set(Presenca.online.map((p) => p.id));
    const conversas = Presenca.conversas.filter((c) => !naApp.has(c.id))
        .sort((a, b) => (b.atividade || 0) - (a.atividade || 0));
    const mostrar = conversas.filter((c, i) => i < PRESENCA_CONVERSAS_NA_LISTA || presencaNaoLidasDe(c.id) > 0);
    const linhasConversa = mostrar.map((c) => {
        const n = presencaNaoLidasDe(c.id);
        const hora = presencaHoraCurta(c.ultima ? c.ultima.ts : c.atividade);
        const nome = c.nome || t('presenca.anon');
        const previa = presencaPrevia(c.ultima);
        const rotulo = [nome, previa, hora, presencaRotuloNaoLidas(n)].filter(Boolean).join(', ');
        return `<li>
            <button type="button" class="presenca-linha" data-pessoa="${escapeHtml(c.id)}" aria-label="${escapeHtml(rotulo)}">
                <span class="presenca-txt">
                    <span class="presenca-l1"><span class="presenca-nome">${escapeHtml(nome)}</span></span>
                    <span class="presenca-l2${n ? ' forte' : ''}">${escapeHtml(previa)}</span>
                </span>
                <span class="presenca-dir">${hora ? `<span class="presenca-hora">${escapeHtml(hora)}</span>` : ''}${presencaBadge(n)}</span>
            </button>
        </li>`;
    }).join('');

    // A resposta da lista pedida ao abrir a folha costuma chegar IGUAL à que já
    // está na tela: redesenhá-la tirava o foco da linha em que a pessoa estava.
    presencaDesenhar(lista, `<li class="presenca-secao">${escapeHtml(t('presenca.sheet.agora'))}</li>`
        + (linhasOnline || `<li class="presenca-vazio">${escapeHtml(t('presenca.sheet.vazio'))}</li>`)
        + (linhasConversa ? `<li class="presenca-secao">${escapeHtml(t('presenca.sheet.conversas'))}</li>` + linhasConversa : ''), 'presencaClose');
}

// ── DESENHO DO RECIBO ───────────────────────────────────────────────────────
//
// Dois estados, decididos com o owner: ✓ "Enviada" (o Waze guardou) e ✓✓ com
// a palavra "Lida". A distinção é de FORMA — um tique, dois tiques, relógio,
// alerta — e não de cor (WCAG 1.4.1), e "Lida" ganha uma LINHA DE TEXTO embaixo
// da última lida, que o leitor de tela também lê.
const PRESENCA_GLIFO = {
    enviando: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
    enviada: '<path d="M4 12.5l5 5L20 6.5"/>',
    lida: '<path d="M1 12.5l4 4L13 8"/><path d="M9.5 14.5l2 2L21 7"/>',
    falhou: '<path d="M12 3.8L22 20H2z"/><path d="M12 9.5v4.2"/><path d="M12 16.6h.01"/>',
};

function presencaRecibo(estado, id = '') {
    const glifo = PRESENCA_GLIFO[estado];
    if (!glifo) return '';
    const rotulo = t('presenca.recibo.' + (estado === 'falhou' ? 'naoEnviadaErro' : estado));
    return `<span${id ? ` id="${escapeHtml(id)}"` : ''} class="presenca-recibo ${estado}" role="img" aria-label="${escapeHtml(rotulo)}">`
        + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${estado === 'enviando' || estado === 'falhou' ? '2.2' : '2.5'}"`
        + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glifo}</svg></span>`;
}

// O estado do recibo de uma mensagem MINHA. "Lida" tem duas provas: o recibo
// que o fluxo contou (guardado no aparelho) e a resposta da pessoa — quem
// respondeu depois leu.
function presencaEstadoDaMinha(m, lidaAte, ultimaDela) {
    if (m.estado === 'enviando' || m.estado === 'falhou') return m.estado;
    return m.ts <= lidaAte || m.ts < ultimaDela ? 'lida' : 'enviada';
}

function presencaRotuloDoDia(ts) {
    const d = new Date(ts), hoje = new Date();
    const dias = Math.round((new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
        - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
    if (dias <= 0) return t('presenca.dia.hoje');
    if (dias === 1) return t('presenca.dia.ontem');
    return d.toLocaleDateString(i18nLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

function presencaHtmlDasMsgs(id, h) {
    const lidaAte = chatLidaAte(id);
    const ultimaDela = Math.max(0, ...h.msgs.filter((m) => !m.meu).map((m) => m.ts));
    const estados = h.msgs.map((m) => (m.meu ? presencaEstadoDaMinha(m, lidaAte, ultimaDela) : null));
    let ultimaLida = -1, ultimaFalha = -1;
    estados.forEach((e, i) => {
        if (e === 'lida') ultimaLida = i;
        if (e === 'falhou') ultimaFalha = i;
    });
    let dia = '';
    return h.msgs.map((m, i) => {
        let html = '';
        const rotulo = presencaRotuloDoDia(m.ts);
        if (rotulo !== dia) { dia = rotulo; html += `<div class="conversa-dia"><span>${escapeHtml(rotulo)}</span></div>`; }
        // No cartão sem pergunta, é o recibo que DESCREVE o botão (ver
        // `presencaHtmlDoPedido`): ele ganha o id que o `aria-describedby` cita.
        const recibo = m.meu ? presencaRecibo(estados[i], m.card && !m.legenda ? presencaIdDaDescricao(i) : '') : '';
        html += m.card
            ? presencaHtmlDoPedido(m, i, recibo)
            : `<div class="conversa-bolha ${m.meu ? 'minha' : 'dela'}${recibo ? ' com-recibo' : ''}">${escapeHtml(m.texto)}${recibo}</div>`;
        if (i === ultimaFalha) {
            const frase = m.motivo === 'conexao' ? t('presenca.recibo.naoEnviada') : t('presenca.recibo.naoEnviadaErro');
            html += `<p class="conversa-falhou">${escapeHtml(frase)} <button type="button" class="conversa-reenviar">${escapeHtml(t('presenca.conversa.tentar'))}</button></p>`;
        } else if (i === ultimaLida) {
            html += `<p class="conversa-lida">${escapeHtml(t('presenca.recibo.lida'))}</p>`;
        }
        return html;
    }).join('');
}

// O pedido dentro da conversa. É um CARTÃO, não uma bolha de texto — e é um
// <button> porque se abre: sem isso o teclado e o leitor de tela não chegam
// nele. Card e pergunta são UMA mensagem: um recibo em vez de dois.
function presencaHtmlDoPedido(m, i, recibo) {
    const card = m.card;
    const nome = (card.name || '').trim() || (card.address || '').trim() || t('card.noName');
    const meta = presencaResumoDoCard(card);
    // A foto que já não carregou nesta conversa não volta pro desenho (ver
    // `Presenca.fotosFalhas`).
    const foto = card.imageUrl && !Presenca.fotosFalhas.has(card.imageUrl)
        ? `<span class="cp-foto"><img src="${escapeHtml(card.imageUrl)}" alt="" width="62" height="62"></span>`
        : '';
    const topo = `<span class="cp-topo">${foto}<span class="cp-txt">`
        + `<span class="cp-nome">${escapeHtml(nome)}</span>`
        + (meta ? `<span class="cp-meta">${escapeHtml(meta)}</span>` : '')
        + '</span></span>';
    // A pergunta e o recibo moram DENTRO do botão, e botão não expõe o que tem
    // dentro: o nome acessível é o `aria-label`, e o leitor de tela nunca
    // ouvia a pergunta nem se a mensagem foi lida (auditoria de 2026-09-26).
    // Elas viram a DESCRIÇÃO do botão (`aria-describedby`), sem mexer em nada
    // na tela: com pergunta, a linha dela (que leva o recibo); sem, o recibo.
    const desc = presencaIdDaDescricao(i);
    const legenda = m.legenda
        ? `<span id="${desc}" class="cp-legenda">${escapeHtml(m.legenda)}${recibo}</span>`
        : '';
    const descrito = legenda || recibo.includes(`id="${desc}"`);
    // `data-id` é QUAL mensagem: o `data-msg` é a posição, que anda quando a
    // página antiga entra em cima — e é pelo id que o foco volta ao mesmo
    // cartão depois do redesenho (ver `presencaDesenhar`).
    return `<button type="button" class="conversa-pedido ${m.meu ? 'minha' : 'dela'}`
        + `${legenda ? ' com-legenda' : ''}" data-msg="${i}" data-id="${escapeHtml(m.id)}"`
        + ` aria-label="${escapeHtml(t('presenca.pedido.abrir', { nome }))}"`
        + `${descrito ? ` aria-describedby="${desc}"` : ''}>`
        + topo + legenda + (legenda ? '' : recibo) + '</button>';
}

// O id da descrição do cartão `i` da conversa na tela (há uma por vez).
function presencaIdDaDescricao(i) {
    return 'conversa-pedido-' + i + '-desc';
}

// "Ver mensagens anteriores" nos três momentos, com o que a conversa JÁ tem —
// nenhum elemento novo. Antes a tela ficava igual antes, durante e depois de
// uma falha, e o toque parecia não ter feito nada (auditoria de 2026-09-26):
// carregando, o MESMO botão, desabilitado e com o rótulo trocado; falhou, a
// MESMA linha de erro da conversa, com o "Tentar de novo" (que refaz a página
// antiga, não a conversa: `data-antigas`).
//
// "Desabilitado" é `aria-disabled`, e não `disabled`: botão `disabled` não
// segura o foco, e quem apertou Enter nele caía no <body> (auditoria de
// 2026-09-29). O toque no meio não manda nada: o `presencaCarregarConversa`
// ignora com a página no ar.
function presencaHtmlAnteriores(h) {
    if (h.antigas === 'carregando') {
        return `<button type="button" class="conversa-anteriores" aria-disabled="true">${escapeHtml(t('presenca.conversa.anterioresCarregando'))}</button>`;
    }
    if (h.antigas === 'erro') {
        return `<p class="conversa-vazio">${escapeHtml(t('presenca.conversa.anterioresErro'))} <button type="button" class="conversa-recarregar" data-antigas="1">${escapeHtml(t('presenca.conversa.tentar'))}</button></p>`;
    }
    return h.maisAntigas ? `<button type="button" class="conversa-anteriores">${escapeHtml(t('presenca.conversa.anteriores'))}</button>` : '';
}

function presencaRenderConversa({ rolarAoFim = false, manterTopo = false } = {}) {
    const id = Presenca.aberta;
    if (!id || !presencaConversaNaTela()) return;
    const pessoa = Presenca.online.find((p) => p.id === id);
    const conversa = Presenca.conversas.find((c) => c.id === id);
    // O nome de agora, se a lista o traz; senão o que se sabia ao abrir (ou que
    // uma lista trouxe depois): a pessoa que sai do app não vira "Editor".
    const sabido = (pessoa && pessoa.nome) || (conversa && conversa.nome) || '';
    if (sabido) Presenca.nomeDaAberta = sabido;
    const nome = sabido || Presenca.nomeDaAberta || t('presenca.anon');
    const titulo = document.getElementById('conversaTitle');
    if (titulo && titulo.textContent !== nome) titulo.textContent = nome;

    // Onde a pessoa está. "Fora do app" não é aviso de problema: a mensagem
    // fica guardada e ela lê quando voltar — por isso o campo nunca trava.
    // É região viva: só é reescrita quando a frase MUDA (ver `presencaDesenhar`).
    const estado = document.getElementById('conversaEstado');
    if (estado) {
        let frase;
        if (pessoa) {
            const d = presencaDistancia(pessoa);
            frase = [t('presenca.conversa.naApp'), 'L' + ((pessoa.rank || 0) + 1), d && d.texto].filter(Boolean).join(' · ');
        } else frase = t('presenca.conversa.fora');
        presencaDesenhar(estado, `<span class="presenca-estado"><span class="presenca-ponto${pessoa ? '' : ' fora'}" aria-hidden="true"></span>${escapeHtml(frase)}</span>`);
        estado.classList.remove('hidden');
    }

    const corpo = document.getElementById('conversaMsgs');
    if (corpo) {
        const h = Presenca.historico.get(id) || { msgs: [], carregada: false };
        const pertoDoFim = corpo.scrollHeight - corpo.scrollTop - corpo.clientHeight < 80;
        const alturaAntes = corpo.scrollHeight;
        const topoAntes = corpo.scrollTop;
        let html = `<p class="conversa-aviso">${escapeHtml(t('presenca.conversa.aviso'))}</p>`;
        html += presencaHtmlAnteriores(h);
        // O histórico que não veio segue dizendo que não veio — e oferecendo o
        // "Tentar de novo" — mesmo depois que uma mensagem chega ou sai. Antes
        // o erro só existia com a conversa VAZIA: a primeira mensagem ao vivo
        // o apagava, o histórico nunca mais era pedido e o "lida" nunca saía
        // (ele espera o histórico, ver `presencaMarcarLida`) — auditoria de
        // 2026-09-26. Refazer o `abrir` sozinho quando a mensagem chega foi
        // descartado: mensagem chegando custa ZERO, e com o Waze falhando cada
        // uma viraria um pedido. Quem pede de novo é a pessoa, no botão.
        const semHistorico = h.erro && !h.carregada;
        if (semHistorico) html += `<p class="conversa-vazio">${escapeHtml(t('presenca.conversa.erro'))} <button type="button" class="conversa-recarregar">${escapeHtml(t('presenca.conversa.tentar'))}</button></p>`;
        if (h.msgs.length) html += presencaHtmlDasMsgs(id, h);
        else if (!semHistorico) html += `<p class="conversa-vazio">${escapeHtml(t(h.carregada ? 'presenca.conversa.vazio' : 'presenca.conversa.carregando'))}</p>`;
        presencaDesenhar(corpo, html, 'conversaClose');
        // Página antiga entrando em cima: a mensagem que estava na tela fica
        // onde estava. Mensagem nova: segue o fim só se a pessoa já estava lá
        // — quem rolou pra ler o começo não é arrancado de volta.
        if (manterTopo) corpo.scrollTop = topoAntes + (corpo.scrollHeight - alturaAntes);
        else if (rolarAoFim || pertoDoFim) corpo.scrollTop = corpo.scrollHeight;
    }
    const enviar = document.getElementById('conversaEnviar');
    const campo = document.getElementById('conversaInput');
    if (enviar) enviar.disabled = false;
    if (campo) campo.disabled = false;
}

// ── ligações com o app ──────────────────────────────────────────────────────

function presencaAoVoltar() {
    if (!presencaPodeConectar()) return;
    // O fluxo pode ter morrido com a tela apagada (os timers congelam): se não
    // chegou nada no prazo do silêncio, descarta e religa já.
    const f = Presenca.fluxo;
    if (f && Date.now() - (f.vivoEm || f.desde) > PRESENCA_FLUXO_SILENCIO_MS) presencaFluxoFechar();
    // Da última TENTATIVA: com a lista falhando, a lista boa não anda.
    if (Date.now() - presencaUltimaTentativa() >= PRESENCA_VOLTA_MIN_MS) presencaAtualizar();
    clearTimeout(Presenca.timers.fluxo);
    presencaFluxoGarantir();
    // Voltar pra tela com a conversa aberta É ler o que chegou nesse meio-tempo.
    if (Presenca.aberta) presencaAgendarLida(Presenca.aberta);
}

function presencaMontar() {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') presencaAoVoltar();
    });
    // bfcache (o jeito comum de um PWA voltar no iOS): a página volta congelada,
    // nem sempre com `visibilitychange`.
    window.addEventListener('pageshow', (ev) => { if (ev.persisted) presencaAoVoltar(); });
    window.addEventListener('online', () => { clearTimeout(Presenca.timers.fluxo); presencaFluxoGarantir(); });
    // Sair da página fecha a conexão com o Google na hora. Voltar pelo bfcache
    // religa pelo `pageshow`.
    window.addEventListener('pagehide', () => presencaFluxoFechar());

    const pill = document.getElementById('presencaPill');
    if (pill) pill.addEventListener('click', () => {
        // A janela do Desfazer não fica por cima da lista (ver a função).
        presencaDespacharJanela();
        openModal('presencaModal');
        presencaRenderLista();
        // Abrir a lista custa UM pedido: é o momento em que ela é OLHADA.
        presencaAtualizar();
    });

    const folha = document.getElementById('presencaModal');
    if (folha) folha.addEventListener('click', (ev) => {
        const linha = ev.target.closest('.presenca-linha');
        if (linha) presencaAbrirConversa(linha.dataset.pessoa);
    });

    const form = document.getElementById('conversaForm');
    if (form) form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const campo = document.getElementById('conversaInput');
        const texto = (campo.value || '').trim().slice(0, 2000);
        // Com pedido preso, mandar SÓ o card é legítimo — perguntar é opcional.
        if ((!texto && !Presenca.anexo) || !Presenca.aberta) return;
        // Sem o id do perfil o envio não sai (a sessão acabou de cair, ou o
        // perfil ainda não chegou), e o campo era apagado assim mesmo: o que se
        // digitou sumia calado (auditoria de 2026-09-26). Fica no campo.
        if (!presencaEu()) return;
        const card = Presenca.anexo;
        campo.value = '';
        // Solta o anexo ANTES de mandar: redesenhar com a tirinha ainda presa
        // mostraria o pedido em dois lugares no mesmo quadro.
        if (card) presencaSoltarAnexo();
        presencaEnviar(texto, card);
    });

    const btnCard = document.getElementById('conversaCardBtn');
    if (btnCard) btnCard.addEventListener('click', () => presencaAnexarCard());
    const tirar = document.getElementById('conversaAnexoTirar');
    if (tirar) tirar.addEventListener('click', () => presencaTirarAnexo());

    // Delegado: as bolhas são redesenhadas a cada mensagem, e ouvinte por
    // bolha vazaria a cada render.
    const msgs = document.getElementById('conversaMsgs');
    if (msgs) {
        msgs.addEventListener('click', (ev) => {
            const id = Presenca.aberta;
            if (!id) return;
            if (ev.target.closest('.conversa-reenviar')) return presencaTentarDeNovo();
            const recarregar = ev.target.closest('.conversa-recarregar');
            if (recarregar) {
                return recarregar.dataset && recarregar.dataset.antigas ? presencaCarregarAntigas(id) : presencaCarregarConversa(id);
            }
            if (ev.target.closest('.conversa-anteriores')) return presencaCarregarAntigas(id);
            const alvo = ev.target.closest('.conversa-pedido');
            if (!alvo) return;
            const h = Presenca.historico.get(id);
            const m = h && h.msgs[Number(alvo.dataset.msg)];
            if (!m || !m.card) return;
            // A folha diz "de quem" porque o pedido aberto ali não é da fila de
            // ninguém: é o que alguém mostrou.
            const conv = Presenca.conversas.find((c) => c.id === id) || Presenca.online.find((p) => p.id === id);
            const de = m.meu ? (AppState.profile && AppState.profile.userName) : ((conv && conv.nome) || Presenca.nomeDaAberta);
            window.abrirPedidoRecebido?.(m.card, de);
        });
        // Foto de terceiro que não carrega (apagada no Waze, rede caída) não
        // pode virar ícone quebrado no meio da conversa. `error` NÃO borbulha:
        // só se pega na fase de CAPTURA. E ela é lembrada: sem isso o próximo
        // redesenho a pedia de novo (ver `Presenca.fotosFalhas`). O `src` do
        // ATRIBUTO, que é o `imageUrl` do cartão — a propriedade vem resolvida.
        msgs.addEventListener('error', (ev) => {
            const img = ev.target;
            if (!img || img.tagName !== 'IMG') return;
            const url = img.getAttribute('src');
            if (url) Presenca.fotosFalhas.add(url);
            img.closest('.cp-foto')?.remove();
        }, true);
    }
    const anexoFoto = document.getElementById('conversaAnexoFoto');
    if (anexoFoto) anexoFoto.addEventListener('error', () => {
        anexoFoto.parentElement.classList.add('hidden');
    });
}

// O RESUMO da presença no diagnóstico: contagens, estado e o porquê que o
// servidor contou. A conversa em si vai, com o modo dev, pelo registro de
// chamadas e pelo DOM (privacidade não é critério no modo dev, decisão do
// owner). O token e a chave do tempo real, nunca: credencial que não ajuda a
// depurar nada.
function presencaDiag() {
    const agora = Date.now();
    return {
        ligada: presencaLigada(),
        online: Presenca.online.length,
        conversas: Presenca.conversas.length,
        naoLidas: presencaNaoLidasTotal(),
        atualizadaHaS: Presenca.atualizadaEm ? Math.round((agora - Presenca.atualizadaEm) / 1000) : null,
        // `valido` é "não precisa renovar" (conta a folga de 1 h); `abre` é
        // "ainda abre o tempo real" (vence DE FATO). Só com o primeiro, o resumo
        // dizia "o token venceu" com ele valendo mais meia hora (auditoria de
        // 2026-09-29).
        token: Presenca.chat ? { valido: presencaTokenValido(), abre: presencaTokenAbre(),
            expiraEmH: Number.isFinite(Presenca.chat.expiraEm) ? Math.round((Presenca.chat.expiraEm - agora) / 36e5) : null } : null,
        fluxo: {
            aberto: !!Presenca.fluxo,
            haS: Presenca.fluxo ? Math.round((agora - Presenca.fluxo.desde) / 1000) : null,
            tentativa: Presenca.fluxoTentativa,
            ...Presenca.fluxoDiag,
        },
        conhecidos: chatConhecidos().length,
        aConfirmar: chatAConfirmar().length,
        conversaAberta: !!Presenca.aberta,
        // Quantas conversas DEVEM um "lida" (ver `presencaPagarDevidas`): com
        // ela acima de zero, a "mensagem nova" de uma conversa já vista é isto.
        lidaDevendo: Presenca.lidaDevendo.size,
        // O porquê da lista, como o servidor contou na última (ver o core).
        contagem: Presenca.contagem,
    };
}

// Os métodos vão NO PRÓPRIO objeto de estado, e `window.Presenca` aponta pra
// ele. `const Presenca` é um binding LÉXICO global, e binding léxico GANHA de
// propriedade de `window` em script clássico: com dois objetos, `Presenca.x()`
// no app.js achava o de estado e dava "is not a function" (gotcha #64).
Object.assign(Presenca, {
    sincronizar: presencaSincronizar,
    desligar: presencaDesligar,
    esquecer: presencaEsquecer,
    montar: presencaMontar,
    fecharConversa: presencaFecharConversa,
    esquecerAberta: presencaEsquecerAberta,
    esquecerLista: presencaEsquecerLista,
    renderPilula: presencaRenderPilula,
    aoCarona: presencaAoCarona,
    aoProvarRede: presencaAoProvarRede,
    conhecidos: chatConhecidos,
    diag: presencaDiag,
});
window.Presenca = Presenca;
