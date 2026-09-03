// APP_VERSION (serial de zona DNS) vem de js/version.js — carregado antes deste.
const TRANSIENT_RETRY_ATTEMPTS = 2;
const TRANSIENT_RETRY_DELAYS_MS = [1500, 3500];
const STATS_KEY = 'waze_places_stats';
const FILTERS_KEY = 'waze_places_filters';
const PREFERENCES_KEY = 'waze_places_preferences';
const DEVMODE_KEY = 'waze_places_devmode';
const THEME_KEY = 'waze_places_theme';
const LANG_KEY = 'waze_places_lang';
const HISTORY_KEY = 'waze_places_history';
const SESSAO_KEY = 'waze_places_sessao_expira';
// Rank e staff do último perfil que CARREGOU. Não é preferência — é memória do
// que o Waze já respondeu, e existe por um motivo medido: sem ela, abrir a app
// com a conexão ruim faz o `/api/perfil` falhar, o perfil fica nulo, e a cota
// do Desfazer volta a travar. O editor que já tinha conquistado o direito de
// desligar leva a janela de 3s de volta — e a tela ainda diz "disponível
// depois que o app carregar seu perfil", como se fosse culpa dele.
const PERFIL_GATE_KEY = 'waze_places_perfil_gate';
const DEVMODE_TAPS_NEEDED = 7;
const DEVMODE_TAP_TIMEOUT_MS = 3000;
const UNDO_WINDOW_MS = 3000;

// Endereço oficial do Waze Map Editor. SEM segmento de idioma, sempre: o Waze
// pode redirecionar conforme o idioma da conta, e essa escolha é de quem abre,
// não nossa. Cravar `/pt-BR/` mandava todo mundo pro português.
const WME_EDITOR_URL = 'https://www.waze.com/editor';

// A duração da janela aparece em DUAS frases (o toggle nas Preferências e a dica
// "você nunca desfaz"), nas três línguas — seis lugares onde o número estava
// escrito à mão. Registrado como variável global de i18n, ele vem daqui: mexer
// no UNDO_WINDOW_MS acima corrige os seis de uma vez.
//
// Função, não valor: é reavaliada a cada t(), então trocar de idioma reformata no
// locale novo. Registrar o resultado formatado congelaria o separador decimal do
// idioma que estava ativo na carga.
//
// Ponto conhecido: valor abaixo de 2000 produziria "1 segundos" no pt/es (o
// projeto não tem ICU; plural são chaves separadas, ver CLAUDE.md). Nenhum valor
// realista de janela de desfazer é < 2s, então não construí a maquinaria de
// plural pra uma hipótese — mas se alguém baixar, é aqui que quebra.
if (typeof setI18nVars === 'function') {
    setI18nVars({ undoSeg: () => (UNDO_WINDOW_MS / 1000).toLocaleString(i18nLocale()) });
}

// Nível mínimo pra entrar, COMO O EDITOR VÊ (o Waze conta rank de 0; a UI conta
// de 1 — gotcha #15). A verdade mora no `MIN_RANK_WAZE` do `server/core.mjs`,
// que é quem barra de fato; aqui é só o número que a tela de entrada mostra
// ANTES de existir qualquer resposta do servidor pra citar. `test/consistencia`
// reprova se os dois divergirem — divergir aqui é a app prometer um critério e
// aplicar outro, que é pior do que não avisar nada.
//
// Vai por `setI18nVars` e não escrito na frase porque `applyI18n()` chama
// `t(chave)` SEM parâmetro: sem o registro, o número seria digitado à mão em
// quatro línguas e alguém esqueceria uma na próxima mudança (já aconteceu com
// o "3s" da janela de desfazer).
const NIVEL_MINIMO_EXIBIDO = 3;
if (typeof setI18nVars === 'function') {
    setI18nVars({ nivelMinimo: () => NIVEL_MINIMO_EXIBIDO });
}
// Sem cap: a caixa de mudanças rola por dentro, cresce com o card e avisa que
// rola (esmaecido de borda). Com `MAX_CHANGES_DISPLAY = 4` a 5ª mudança era
// INALCANÇÁVEL — nem rolando — e a linha "+1 mais" gastava exatamente o espaço
// de uma linha de mudança pra dizer menos.

// Formato canônico do código de pareamento: XXX-XXX. O agrupamento 3+3 existe
// porque facilita ler em voz alta e digitar — mas quem MOSTRA e quem LÊ têm que
// concordar. Mostrar "6C4-97S" e pedir "ABC123" convida o editor a errar: ou ele
// digita o hífen sem saber se pode, ou omite achando que o que viu estava errado.
// Antes isso só não quebrava por duas coincidências (maxlength dimensionado pro
// hífen e o servidor limpando o que não é alfanumérico) — nenhuma delas
// combinada de propósito. Agora é UMA função, usada nos dois lados.
const PAIR_CODE_LEN = 6;
const PAIR_CODE_GRUPO = 3;
function formatarCodigoPareamento(bruto) {
    const limpo = String(bruto || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, PAIR_CODE_LEN);
    return limpo.length > PAIR_CODE_GRUPO
        ? limpo.slice(0, PAIR_CODE_GRUPO) + '-' + limpo.slice(PAIR_CODE_GRUPO)
        : limpo;
}
const PREFETCH_THRESHOLD = 3;

// ── Aquecimento dos próximos cards ────────────────────────────────────────
// A regra do owner: **o próximo card sempre pronto, e pronto por inteiro** —
// foto, as outras fotos e os tiles do mapa. Isso é a LARGURA, e ela vale só
// pro card seguinte (segundo laço do prefetchNextImage).
//
// PROFUNDIDADE é outra grandeza: quantos cards à frente têm o PRIMEIRO SLIDE
// pronto — a imagem que aparece quando o card entra na tela, antes de tocar
// nas setas do carrossel. Ela é **de graça em total de bytes**: a fila é
// sequencial, esses cards vão aparecer de qualquer jeito, então só se move
// byte no tempo. Medido: sessão de 200 cards fica em ~35MB com profundidade
// 1 ou 3.
//
// O que ela compra é converter TEMPO OCIOSO em reserva. Com profundidade 1 o
// aquecimento só começa quando um card aparece: quem para 10s lendo um diff
// gasta 0,4s baixando o seguinte e deixa o link parado o resto. Triagem real
// é pausa, pausa, três swipes rápidos — a profundidade guarda a pausa. Numa
// rede boa 1 e 3 são indistinguíveis; a diferença aparece em rede sofrível
// com swipe rápido, que é justamente o caso que dói.
//
// O laço é genérico: esta constante é a única coisa a mexer pra mudar de
// ideia, e ela NUNCA afeta a largura.
const PREFETCH_PROFUNDIDADE = 3;
// Teto de fotos por card, escolhido pelo owner. Medido na fila real de 12
// países: 91,7% dos cards têm 4 fotos ou menos e são aquecidos por INTEIRO;
// nos 8,3% restantes as fotos além da 4ª carregam quando a pessoa chegar nelas
// no carrossel — e quem está navegando o carrossel não está passando rápido.
// O teto também segura o rabo: o pior card da fila tem TRINTA fotos, 2,3MB de
// dados móveis sozinho.
const PREFETCH_TETO_FOTOS = 4;

const MAX_EMPTY_PAGES = 5;
// Os 7 tipos do WME, na ordem em que aparecem no filtro (local → foto). É a
// MESMA ordem do index.html de propósito: duas listas com a mesma ideia em
// ordens diferentes é como o editor descobre que a app se contradiz.
const TYPES_ALL = ['NEW_PLACE', 'DETAILS_UPDATE', 'FLAGGED_PLACE', 'DELETE_PLACE',
                   'NEW_PHOTO', 'FLAGGED_PHOTO', 'DELETE_PHOTO'];
// Quais vêm MARCADOS numa instalação nova. `DETAILS_UPDATE` e `FLAGGED_PLACE`
// ficam de fora, e o motivo é de PRODUTO, não de layout: a app é estilo Tinder,
// e o gesto rápido funciona quando há o que OLHAR. Decisão do owner.
//
// Os dois já estiveram desmarcados por um motivo diferente — o card deles não
// cabia na tela — e isso foi corrigido (1872 renders, zero estouro). A troca de
// motivo importa pro próximo que vier aqui: não adianta mexer no layout de novo
// pra tentar remarcá-los, porque não é o layout que os mantém fora.
//
// Medido na fila real, o argumento se sustenta em número: os 5 tipos do padrão
// somam 178 cards com 66% de foto (e `NEW_PHOTO` tem 2,27 fotos por card),
// contra 117 cards e 44% nos dois de fora.
//
// **Desmarcado ≠ escondido**: a caixa continua no filtro, com o nome do WME, a
// um toque. Esconder faria o editor achar que a fila acabou; desmarcar diz
// "existe, e você decide".
//
// A constante fica separada do TYPES_ALL mesmo quando os conjuntos coincidem:
// "todos os tipos que existem" e "os que vêm marcados" são perguntas
// diferentes, e só a primeira decide se vale mandar o filtro ao Waze.
const TYPES_PADRAO = TYPES_ALL.filter((t) => t !== 'DETAILS_UPDATE' && t !== 'FLAGGED_PLACE');
// O filtro salvo pode trazer lixo: storage de uma versão que não existe mais,
// chave editada à mão, JSON meio gravado. Fica só o que a app conhece — e se
// não sobrar NADA, volta ao padrão em vez de virar filtro vazio, que abriria a
// app numa fila sem um card e sem um erro na tela. "Parece que acabou o
// trabalho" é o defeito mais caro possível, porque ninguém reporta.
function sanearTiposSalvos(lista) {
    if (!Array.isArray(lista)) return TYPES_PADRAO.slice();
    const validos = TYPES_ALL.filter((t) => lista.includes(t));
    return validos.length ? validos : TYPES_PADRAO.slice();
}
const UNAUTHORIZED_REDIRECT_MS = 800;
// Espera antes de confirmar se a sessão morreu mesmo. Curto o bastante pra não
// atrasar quem precisa relogar de verdade, e longo o bastante pra a rajada que
// provocou o 403 do WAF já ter passado.
const VERIFICA_SESSAO_MS = 1200;
const STATE_RECOVERY_MS = 200;

const AppState = {
    authenticated: false,
    currentPlace: null,
    queue: [],
    nextPage: 1,
    hasMore: true,
    emptyPagesInRow: 0,
    fetching: false,
    serverTotal: 0,
    serverBlocked: 0,   // D13: pedidos da região que este editor não pode editar
    blockedPartial: false, // true = paramos antes do fim → serverBlocked é piso
    stats: { read: 0, rejected: 0, skipped: 0 },
    pendingAction: null,
    inFlightActions: 0,
    fetchEpoch: 0,
    _fetchPromise: null,
    _profilePromise: null,
    loadError: false,
    filters: { types: TYPES_PADRAO.slice(), residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true, categories: [], sortOrder: 'newest' },
    preferences: { undoEnabled: true, semUndoSeguidas: 0, presenca: true },
    devMode: { unlocked: false, active: false },
    profile: null,
    countries: [],
    statesByCountry: {},
    seenCategories: [],      // categorias vistas nos places carregados (fonte do filtro de categoria)
    history: null,           // acumulado histórico { 'YYYY-MM-DD': { read, rejected } } (carregado lazy)
    autores: null,           // reincidência por autor: { v: [ids vistos 1x], r: { id: [n, nome, dia] } }
    sessaoExpiraEm: null     // quando a sessão do WAZE vence (epoch em segundos). Prazo FIXO, ver AVISO_SESSAO_DIAS
};

window.AppState = AppState;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// Aviso do browser, não defeito da app: o navegador emite isto quando um
// ResizeObserver provoca layout que exige mais uma rodada de entrega no mesmo
// quadro. Nada quebrou, não há o que o editor fazer, e a app já convergiu no
// quadro seguinte — mas chegava como toast VERMELHO "Erro inesperado" em cima
// do card. Fica no console pra não virar invisível; some da cara de quem tria.
// Filtro estreito de propósito: só esta família de mensagem, nunca "todo erro
// que eu não quero ver".
const RUIDO_RESIZE_OBSERVER = /ResizeObserver loop/i;

window.addEventListener('error', (e) => {
    if (RUIDO_RESIZE_OBSERVER.test(e.message || '')) {
        console.warn('Ruído de ResizeObserver ignorado:', e.message);
        return;
    }
    console.error('Erro JS não-tratado:', e.error || e.message, e.filename, e.lineno);
    if (window.showToast) {
        window.showToast(t('toast.unexpectedError', { msg: e.message || t('toast.unexpectedError.reload') }), 'error');
    }
    if (window.AppState && window.AppState.authenticated) {
        const cardStack = document.getElementById('cardStack');
        if (cardStack && !cardStack.querySelector('.place-card') &&
            document.getElementById('loadingCard').classList.contains('hidden') &&
            document.getElementById('noMoreCards').classList.contains('hidden')) {
            console.warn('Estado inconsistente detectado, tentando recuperar…');
            setTimeout(() => {
                if (typeof advanceQueue === 'function') advanceQueue();
            }, 100);
        }
    }
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Promise rejeitada:', e.reason);
});

function initApp() {
    // Armado ANTES de tudo: erro que acontece na carga é justamente o que não
    // aparece em lugar nenhum depois, e é o que mais interessa num socorro.
    diagCapturarErros();
    const versionEl = document.getElementById('appVersionDisplay');
    if (versionEl) {
        versionEl.textContent = 'v' + (typeof verLabel === 'function' ? verLabel(APP_VERSION) : APP_VERSION);
        setupDevModeTapTrigger(versionEl);
    }

    // i18n: idioma salvo (localStorage) ou detectado do navegador; aplica o
    // dicionário ao DOM estático logo no início (antes de renderizar o resto).
    if (typeof setLang === 'function') {
        setLang(safeLS.get(LANG_KEY) || undefined);
        applyI18n();
    }

    // Preferências ANTES das stats, e não é arrumação: `loadStats()` chama
    // `updateStats()`, que avalia o portão da conquista. Avaliar o portão sem
    // ter lido as preferências fazia o aviso "Mandou bem" sair a CADA recarga —
    // ele disparava, marcava na memória e a marca era descartada por
    // `savePreferences()` (que corretamente recusa gravar antes de ler).
    loadPreferences();
    loadStats();
    // Com o perfil em CACHE a cota já é conhecida aqui, então a linha de base se
    // decide na hora; sem ele, `guardarPerfilDoPortao` decide quando o perfil
    // chegar. Sem esta chamada existe uma janela — entre abrir e o /api/perfil
    // responder — em que cruzar a cota não seria comemorado.
    initUndoGateSeen();
    loadFilters();
    carregarPrazoDaSessao();
    loadDevMode();
    enforceDevGatedFilters();
    // Tema: segue o sistema até o user escolher manualmente (M3/HIG).
    applyTheme(getPreferredTheme());
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    if (systemTheme.addEventListener) {
        systemTheme.addEventListener('change', (e) => {
            let stored = null;
            try { stored = localStorage.getItem(THEME_KEY); } catch (err) {}
            if (!stored) applyTheme(e.matches ? 'dark' : 'light');
        });
    }

    API.getRegion();
    API.getCountry();

    setupAuthListeners();
    setupAppListeners();
    setupModalListeners();
    setupLightbox();
    setupMapaLightbox();
    setupKeyboardInset();
    setupAlturaDoHeader();
    setupDescargaAoSair();
    marcarSuporteAExtensao();
    setupInstalarApp();

    // Link de pareamento (/#pair=SEGREDO): o editor apontou a câmera ou mandou o
    // link pra si mesmo — entra direto, sem digitar nada. Tratado ANTES da
    // sessão salva porque um código novo deve vencer uma sessão velha do mesmo
    // aparelho.
    //
    // FRAGMENTO, não query. O navegador não envia o fragmento ao servidor, então
    // o segredo não entra no log de acesso — e ele é justamente a chave que
    // decifra o registro de pareamento (ver `derivarChave` no core). Com
    // `?pair=` o segredo ia parar no log ao lado do dado que ele protege, o que
    // anulava a proteção inteira. A query segue sendo LIDA por tolerância (link
    // antigo ainda no histórico de alguém), mas nunca mais é GERADA.
    const codigoNaURL = (() => {
        try {
            const frag = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
            return frag.get('pair') || new URLSearchParams(window.location.search).get('pair');
        } catch (e) { return null; }
    })();
    if (codigoNaURL) {
        try { window.history.replaceState({}, '', window.location.pathname); } catch (e) {}
        showAuthScreen();
        resgatarPareamento(codigoNaURL, { silencioso: true });
        return;
    }

    const savedToken = API.getSession();
    if (savedToken) {
        showMainScreen();
        AppState._profilePromise = loadProfileAndAuxData();
        startFetching();
        handleLaunchAction();
    } else {
        // Sem sessão: antes de mostrar a tela de login, PERGUNTA à extensão.
        // Quem tem a extensão instalada e está logado no WME entra sem tocar em
        // nada; quem não tem cai na tela de sempre depois de EXT_ESPERA_MS.
        entrarPelaExtensao().then((entrou) => {
            if (entrou) return;
            // Escrita ATRASADA não pode atropelar estado novo. Entre o pedido e
            // esta linha passam centenas de ms, e nesse meio alguém pode ter
            // entrado por outro caminho (colar cookies, código de pareamento,
            // token injetado). Sem esta guarda o `showAuthScreen` derrubava a
            // sessão recém-criada e escondia a app JÁ montada — apareceu como
            // "card sem endereço / botões 0px" no smoke, mudando de aparelho a
            // cada rodada porque atinge sempre o PRIMEIRO card medido.
            if (API.getSession() || AppState.authenticated) return;
            showAuthScreen();
        });
    }
}

// ── Handshake com a extensão WazePlaces Rapid Access (@daflash) ───────────
//
// A extensão já sabia fazer login sozinha, mas só reagia ao botão dela dentro
// do WME: abrir a app direto não acionava nada, e sessão vencida obrigava a
// voltar ao WME e clicar de novo. O handshake inverte quem começa a conversa —
// a APP pede, a extensão responde —, e com isso o login vira invisível nos dois
// momentos que importam: ao abrir, e quando a sessão morre no meio do uso.
//
// O protocolo é `postMessage` na própria janela porque a extensão já injeta um
// content script na app (`auto-login.js`): é o canal que existe sem pedir
// permissão nova no manifesto dela.
//
// SEGURANÇA: aceitar um token por postMessage NÃO abre superfície nova —
// qualquer script na página já pode escrever `localStorage.waze_session_token`
// direto. Mesmo assim exigimos `event.source === window` e origem própria, pra
// não aceitar nada vindo de iframe ou de outra janela.
// Dois prazos, e a diferença entre eles é o desenho todo.
//
// A extensão leva ~1,8s pra responder — ela faz ida e volta ao Waze de verdade
// (medido com a extensão carregada). Esperar isso calado penalizaria QUEM NÃO
// TEM a extensão com 2 segundos de tela vazia; e mostrar o login na hora faria
// quem TEM ver a tela piscar antes de entrar.
//
// Por isso a ponte responde `aguarde` IMEDIATAMENTE (é mensagem local, sem
// rede) e só depois manda o token. Quem não tem extensão não recebe `aguarde`
// nenhum e cai no login em EXT_PRESENTE_MS — tempo que ninguém percebe.
const EXT_PRESENTE_MS = 350;    // "tem extensão aí?" — só espera local
const EXT_ESPERA_MS = 8000;     // depois do `aguarde`, o prazo da ida ao Waze
let extPerguntando = false;

function entrarPelaExtensao({ silencioso = false } = {}) {
    if (extPerguntando) return Promise.resolve(false);
    extPerguntando = true;

    return new Promise((resolve) => {
        let terminou = false;
        let prazo = setTimeout(() => fim(false), EXT_PRESENTE_MS);
        function fim(ok) {
            if (terminou) return;
            terminou = true;
            window.removeEventListener('message', ouvir);
            clearTimeout(prazo);
            extPerguntando = false;
            mostrarEntrandoPelaExtensao(false);
            resolve(ok);
        }
        function ouvir(ev) {
            if (ev.source !== window || ev.origin !== window.location.origin) return;
            const d = ev.data;
            if (!d || d.source !== 'wazeplaces-ext') return;
            // "estou aqui, trabalhando" — só agora vale mostrar o spinner e
            // esperar de verdade. Sem isto, quem não tem a extensão pagaria a
            // espera dela.
            if (d.action === 'aguarde') {
                clearTimeout(prazo);
                prazo = setTimeout(() => fim(false), EXT_ESPERA_MS);
                if (!silencioso) mostrarEntrandoPelaExtensao(true);
                return;
            }
            if (d.action === 'sem-sessao') return fim(false);   // instalada, mas sem login no WME
            if (d.action !== 'sessao' || !d.token) return;
            API.setSession(String(d.token));
            showMainScreen();
            AppState._profilePromise = loadProfileAndAuxData();
            startFetching();
            fim(true);
        }
        window.addEventListener('message', ouvir);
        try {
            window.postMessage({ source: 'wazeplaces', action: 'precisa-de-sessao' }, window.location.origin);
        } catch (e) { fim(false); }
    });
}

// Ao LIGAR esconde a tela de login e mostra o spinner. Ao desligar, esconde só
// o spinner — quem decide se a tela de login volta é o CHAMADOR, que sabe se o
// handshake deu certo. A primeira versão fazia o `toggle` nos dois no mesmo
// lugar e, ao terminar com sucesso, re-exibia o "Bem-vindo!" por cima da app já
// logada. Só apareceu com a extensão carregada de verdade.
function mostrarEntrandoPelaExtensao(ligado) {
    document.getElementById('extLoginState')?.classList.toggle('hidden', !ligado);
    if (ligado) document.getElementById('authScreen')?.classList.add('hidden');
}

// ── Gerenciador de modais ─────────────────────────────────────────────────
// Todos os diálogos (role="dialog") passam por aqui: foco entra no modal ao
// abrir e volta pro elemento de origem ao fechar; Esc fecha o modal aberto
// (via handleKeyDown); clique no scrim fecha; body trava o scroll.
// Novo modal? Adicionar o id em MODAL_IDS e usar openModal/closeModal.
const MODAL_IDS = ['pasteModal', 'logoutModal', 'accessDeniedModal', 'filtersModal', 'helpModal', 'batchReadModal', 'pairShowModal', 'pairEnterModal', 'comoFuncionaModal', 'treinoFimModal', 'presencaModal', 'conversaModal', 'pedidoModal', 'autorModal'];

let lastFocusedBeforeModal = null;

// ── O VOLTAR do aparelho fecha o que está por cima ────────────────────────
// Pedido de uma editora: no ritmo do swipe, ir até o ✕ do lightbox quebra a
// cadência. No Android o reflexo é o botão/gesto de voltar, que em toda app
// nativa significa "fecha a camada de cima".
//
// Vale pra lightbox E pra modais de propósito. Fazer só na foto seria PIOR que
// não fazer: a pessoa aprenderia que voltar fecha, tentaria em Filtros e SAIRIA
// DA APP — e ainda perderia os filtros que estava montando.
//
// O detalhe que decide se isto ajuda ou atrapalha é CONSUMIR a entrada quando a
// camada fecha por outro caminho (✕, Esc, scrim, arrastar). Sem isso sobra uma
// entrada morta no histórico e o próximo voltar não faz nada — o usuário aperta,
// olha pra tela parada e aperta de novo, aí sai da app. Pior que o ✕.
//
// iOS em modo standalone não tem voltar; lá o ✕ e o arrastar pra baixo seguem
// sendo o caminho. Isto ADICIONA um jeito, não substitui nenhum.
const CamadaVoltar = {
    profundidade: 0,
    // Ligado só durante o history.back() que nós mesmos disparamos, pra o
    // popstate resultante não fechar uma segunda camada por engano.
    consumindo: false,

    empilhar() {
        try {
            this.profundidade++;
            history.pushState({ wpCamada: this.profundidade }, '');
        } catch (e) { /* histórico indisponível: o ✕ continua funcionando */ }
    },

    consumir() {
        if (this.profundidade <= 0) return;
        this.profundidade--;
        this.consumindo = true;
        try { history.back(); } catch (e) { this.consumindo = false; }
    },
};

window.addEventListener('popstate', () => {
    if (CamadaVoltar.consumindo) { CamadaVoltar.consumindo = false; return; }
    // O mapa ampliado é a camada de cima: o voltar do aparelho fecha ELE
    // primeiro, como faz com o lightbox de foto.
    if (typeof MapaLightbox !== 'undefined' && MapaLightbox.isOpen()) {
        CamadaVoltar.profundidade = Math.max(0, CamadaVoltar.profundidade - 1);
        MapaLightbox.close(true);
        return;
    }
    // Veio do usuário. Fecha a camada de cima — o lightbox está acima dos modais
    // (z-[65] contra z-[60]), então ele tem prioridade.
    if (Lightbox.isOpen()) {
        CamadaVoltar.profundidade = Math.max(0, CamadaVoltar.profundidade - 1);
        Lightbox.close({ viaHistorico: true });
        return;
    }
    const m = topOpenModal();
    if (m) {
        CamadaVoltar.profundidade = Math.max(0, CamadaVoltar.profundidade - 1);
        closeModal(m.id, { viaHistorico: true });
    }
});

function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    const jaHaviaModal = !!topOpenModal();
    // Modais não empilham: fecha qualquer outro aberto (ex.: Sair a partir da Ajuda)
    MODAL_IDS.forEach(other => {
        if (other !== id) document.getElementById(other)?.classList.add('hidden');
    });
    // Empilha uma entrada só por CAMADA, não por modal: openModal fecha o modal
    // anterior antes de abrir o novo (eles não empilham), então trocar de modal
    // não pode empilhar histórico — senão um voltar fecharia nada.
    if (!jaHaviaModal) CamadaVoltar.empilhar();
    lastFocusedBeforeModal = document.activeElement;
    m.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const focusable = m.querySelector('textarea, input:not([type=hidden]):not(:disabled), select, button');
    if (focusable) focusable.focus();
}

// Limpeza específica de cada modal. Fica AQUI e não no botão de fechar porque
// modal fecha por três caminhos — botão, Esc e clique no scrim — e amarrar a
// limpeza a um deles deixa os outros dois vazando. Foi o que aconteceu com o
// ticker do pareamento: fechando por Esc, o setInterval seguia rodando pelo
// resto da sessão.
const LIMPEZA_AO_FECHAR = {
    // O padrão da lista de autores é a forma CURTA. Amarrar isto ao botão de
    // fechar deixaria os outros dois caminhos (Esc e scrim) vazando o estado
    // expandido pra próxima abertura — o gotcha dos modais deste projeto.
    filtersModal() { autoresExpandido = false; },
    pairShowModal() {
        pararTickerPareamento();
        // O código é credencial e já não vale nada aqui: não fica desenhado
        // esperando alguém reabrir o modal e escanear um QR morto.
        const code = document.getElementById('pairCode');
        if (code) {
            code.textContent = '······';
            delete code.dataset.raw;
            delete code.dataset.curto;
            code.classList.remove('opacity-40', 'line-through');
        }
        for (const id of ['pairExpiry', 'pairCodeExpiry']) {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        }
        // O código revelado volta a ficar escondido: revelar é um pedido, e cada
        // pedido cria um registro fraco novo no servidor. Herdar o estado da vez
        // passada faria a próxima abertura já nascer com a cópia fraca à mostra.
        document.getElementById('pairCodeReveal')?.classList.add('hidden');
        const btnCodigo = document.getElementById('pairShowCodeBtn');
        if (btnCodigo) { btnCodigo.classList.remove('hidden'); btnCodigo.disabled = false; }
        limparQrPareamento();
        const copiar = document.getElementById('pairCopyLinkBtn');
        if (copiar) copiar.disabled = true;
    },
    conversaModal() {
        // Fechar a conversa por QUALQUER caminho (✕, Esc, scrim, voltar) tem
        // que soltar o `aberta` — senão a próxima mensagem daquela pessoa
        // continua chegando como "conversa aberta" e nunca vira aviso.
        window.Presenca?.esquecerAberta?.();
    },
    pairEnterModal() {
        const campo = document.getElementById('pairCodeInput');
        if (campo) campo.value = '';
        document.getElementById('pairEnterError')?.classList.add('hidden');
    },
};

function closeModal(id, { viaHistorico = false } = {}) {
    const m = document.getElementById(id);
    if (!m || m.classList.contains('hidden')) return;
    m.classList.add('hidden');
    if (!viaHistorico) CamadaVoltar.consumir();
    try { LIMPEZA_AO_FECHAR[id]?.(); } catch (e) { /* limpeza nunca derruba o fechamento */ }
    if (!topOpenModal() && !Lightbox.isOpen()) document.body.style.overflow = '';
    if (lastFocusedBeforeModal && document.body.contains(lastFocusedBeforeModal)) {
        lastFocusedBeforeModal.focus();
    }
    lastFocusedBeforeModal = null;
}

function topOpenModal() {
    for (const id of MODAL_IDS) {
        const m = document.getElementById(id);
        if (m && !m.classList.contains('hidden')) return m;
    }
    return null;
}

function setupAuthListeners() {
    const $ = id => document.getElementById(id);

    $('uploadBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', handleFileUpload);
    $('pasteBtn').addEventListener('click', () => openModal('pasteModal'));
    $('confirmPaste').addEventListener('click', handlePasteConfirm);
    $('cancelPaste').addEventListener('click', () => {
        closeModal('pasteModal');
        $('cookiesTextarea').value = '';
    });
    $('byAuthor').addEventListener('click', () => {
        window.open('https://www.waze.com/user/editor/antigerme', '_blank', 'noopener');
    });
    $('closeAccessDenied').addEventListener('click', () => closeModal('accessDeniedModal'));
    // Região default sempre 'row' pra fluxos novos (público alvo BR/Latam).
    // Quem precisa de NA/IL/world muda no modal "Filtros e Preferências"
    // depois de logar (filterRegion). Não exibimos picker no authScreen
    // porque era fricção desnecessária pra 95% dos usuários.
}

function setupAppListeners() {
    const $ = id => document.getElementById(id);

    // openModal fecha o helpModal automaticamente (modais não empilham)
    $('logoutBtn').addEventListener('click', () => openModal('logoutModal'));
    $('confirmLogout').addEventListener('click', handleLogout);
    $('cancelLogout').addEventListener('click', () => closeModal('logoutModal'));

    $('reloadBtn').addEventListener('click', () => {
        resetQueue();
        startFetching();
    });
    $('refreshBtn').addEventListener('click', () => {
        if (AppState.fetching) return;
        resetQueue();
        startFetching();
        showToast(t('toast.refreshing'), 'info');
    });
    $('retryLoadBtn')?.addEventListener('click', () => {
        resetQueue();
        startFetching();
    });
    $('diagBtn')?.addEventListener('click', baixarDiagnostico);
    $('helpBtn').addEventListener('click', () => openModal('helpModal'));
    $('presencaClose').addEventListener('click', () => closeModal('presencaModal'));
    $('pedidoClose').addEventListener('click', () => closeModal('pedidoModal'));
    $('autorClose').addEventListener('click', () => closeModal('autorModal'));
    $('conversaClose').addEventListener('click', () => Presenca.fecharConversa());
    // O resto da presença (pílula, lista, envio) se liga sozinho: `montar` é do
    // js/presenca.js, que carrega depois deste arquivo.
    window.Presenca?.montar?.();
    $('closeHelp').addEventListener('click', () => closeModal('helpModal'));
    $('reverComoFunciona')?.addEventListener('click', abrirComoFunciona);
    $('comoFuncionaOk')?.addEventListener('click', () => closeModal('comoFuncionaModal'));
    $('comoFuncionaTreinar')?.addEventListener('click', () => { closeModal('comoFuncionaModal'); Treino.entrar(); });
    $('abrirTreino')?.addEventListener('click', () => { closeModal('helpModal'); Treino.entrar(); });
    $('treinoSairBtn')?.addEventListener('click', () => Treino.sair());
    $('treinoFimOk')?.addEventListener('click', () => { closeModal('treinoFimModal'); Treino.sair(); });

    // "Instalei… e agora?" — o beco sem saída medido: a app pergunta à extensão
    // UMA vez, no carregamento, com 350ms de janela, e o `ponte.js` não é
    // injetado numa aba que já estava aberta. Quem instala olhando pra esta tela
    // fica aqui pra sempre. Aparece só DEPOIS do clique em instalar, pra não ser
    // ruído pra quem nem foi à loja.
    $('extInstallLink')?.addEventListener('click', () => {
        const b = $('extJaInstalei');
        if (!b) return;
        b.hidden = false;
        b.classList.replace('hidden', 'flex');
    });
    $('extJaInstalei')?.addEventListener('click', () => window.location.reload());

    // E ao voltar pra esta aba, pergunta de novo — em silêncio. Hoje isso cobre
    // quem recarregou noutro lugar ou reabriu o WME; quando a extensão passar a
    // se injetar nas abas abertas (onInstalled + scripting, versão futura dela),
    // este mesmo caminho resolve a instalação sem toque nenhum e o botão acima
    // deixa de ser necessário. Só onde extensão existe: no celular seria uma
    // espera de 350ms por nada, repetida a cada troca de aba.
    if (podeInstalarExtensao()) {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            if (AppState.authenticated || API.getSession()) return;
            if (document.getElementById('authScreen')?.classList.contains('hidden')) return;
            entrarPelaExtensao({ silencioso: true });
        });
    }
    $('themeBtn').addEventListener('click', toggleTheme);
    $('filtersBtn').addEventListener('click', openFiltersModal);

    // Clique no scrim fecha o modal (padrão M3/HIG pra diálogos dispensáveis)
    MODAL_IDS.forEach(id => {
        const m = $(id);
        if (m) m.addEventListener('click', (e) => { if (e.target === m) closeModal(id); });
    });

    window.addEventListener('keydown', handleKeyDown);
}

// Seletor de idioma. São DOIS controles: um em Filtros → Preferências (onde se
// procura por preferência) e outro na Ajuda — porque o botão de Filtros fica
// escondido sem sessão, e quem caiu num idioma que não lê precisa trocar ANTES
// de conseguir entrar. Os dois ficam em sincronia.
const SELETORES_IDIOMA = ['langSelect', 'langSelectHelp'];

function aplicarIdioma(valor) {
    setLang(valor);
    safeLS.set(LANG_KEY, valor);
    applyI18n();
    // Os dois seletores mostram a mesma escolha, tenha sido feita em qual for.
    for (const id of SELETORES_IDIOMA) {
        const s = document.getElementById(id);
        if (s && s.value !== valor) s.value = valor;
    }
    if (AppState.profile) renderProfileHeader(AppState.profile);
    if (AppState.currentPlace) showCurrentPlace();
    updateStats();
    updatePendingCount();
    if (typeof showToast === 'function') showToast(t('toast.langChanged'), 'success');
}

// Os <option> vinham escritos DUAS vezes no index.html, um par por seletor —
// idioma novo exigia lembrar dos dois, e o de baixo (o da Ajuda) já tinha sido
// esquecido antes. Agora saem de LANG_NOMES, que é a mesma fonte do dicionário.
function popularSeletoresDeIdioma() {
    const nomes = (typeof LANG_NOMES === 'object' && LANG_NOMES) || {};
    const langs = (typeof LANGS_SUPORTADOS !== 'undefined' && LANGS_SUPORTADOS) || Object.keys(nomes);
    for (const id of SELETORES_IDIOMA) {
        const sel = document.getElementById(id);
        if (!sel) continue;
        sel.textContent = '';
        for (const l of langs) {
            const o = document.createElement('option');
            o.value = l;
            // Sem entrada em LANG_NOMES o código cru aparece — feio, nunca invisível.
            o.textContent = nomes[l] || l;
            sel.appendChild(o);
        }
    }
}

function setupLanguageSwitcher() {
    if (typeof setLang !== 'function') return;
    popularSeletoresDeIdioma();
    const atual = (typeof getLang === 'function') ? getLang() : 'pt';
    for (const id of SELETORES_IDIOMA) {
        const sel = document.getElementById(id);
        if (!sel) continue;
        sel.value = atual;
        sel.addEventListener('change', () => aplicarIdioma(sel.value));
    }
}

// Abas do modal "Filtros e Preferências" (padrão WAI-ARIA Tabs: aria-selected,
// roving tabindex, navegação por setas). Cada aba mostra seu painel e ajusta o
// rodapé: Filtros é formulário (Cancelar/Aplicar); Preferências aplicam na hora
// e Histórico é só leitura (ambas mostram só "Fechar").
const FILTER_TABS = [
    { tab: 'filtersTabFilters', panel: 'filtersPanelFilters' },
    { tab: 'filtersTabPrefs', panel: 'filtersPanelPrefs' },
    { tab: 'filtersTabHistory', panel: 'filtersPanelHistory' }
];

function switchFilterTab(tabId) {
    const $ = id => document.getElementById(id);
    FILTER_TABS.forEach(({ tab, panel }) => {
        const selected = tab === tabId;
        const btn = $(tab);
        if (!btn) return;
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        btn.tabIndex = selected ? 0 : -1;
        $(panel).classList.toggle('hidden', !selected);
    });
    const isFilters = tabId === 'filtersTabFilters';
    $('cancelFilters').classList.toggle('hidden', !isFilters);
    $('applyFilters').classList.toggle('hidden', !isFilters);
    $('closeFiltersFooter').classList.toggle('hidden', isFilters);
}

function setupFilterTabs() {
    const $ = id => document.getElementById(id);
    FILTER_TABS.forEach(({ tab }, i) => {
        const btn = $(tab);
        if (!btn) return;
        btn.addEventListener('click', () => switchFilterTab(tab));
        btn.addEventListener('keydown', (e) => {
            let target = null;
            if (e.key === 'ArrowRight') target = FILTER_TABS[(i + 1) % FILTER_TABS.length];
            else if (e.key === 'ArrowLeft') target = FILTER_TABS[(i - 1 + FILTER_TABS.length) % FILTER_TABS.length];
            else if (e.key === 'Home') target = FILTER_TABS[0];
            else if (e.key === 'End') target = FILTER_TABS[FILTER_TABS.length - 1];
            if (!target) return;
            e.preventDefault();
            switchFilterTab(target.tab);
            $(target.tab).focus();
        });
    });
}

// Atalhos do manifest PWA (long-press no ícone da app): /?action=filters e
// /?action=refresh. Só valem com sessão ativa — deslogado a tela de auth manda.
// A query é limpa da URL depois (replaceState) pra um F5 não repetir a ação.
function handleLaunchAction() {
    let action = null;
    try {
        action = new URLSearchParams(window.location.search).get('action');
    } catch (e) { return; }
    if (!action) return;
    try {
        window.history.replaceState({}, '', window.location.pathname);
    } catch (e) {}
    if (action === 'filters') {
        openFiltersModal();
    } else if (action === 'refresh') {
        resetQueue();
        startFetching();
        showToast(t('toast.refreshing'), 'info');
    }
}

// ── Pareamento computador → celular ────────────────────────────────────────
// O problema que isto resolve: copiar cookies num celular é inviável na prática.
// Aqui o editor loga UMA vez no computador (onde a extensão faz num clique) e
// traz a sessão pro telefone com um código de 6 caracteres, válido 5 minutos.
const pairTickers = new Map();

// Desenha o QR do link de pareamento. É a única forma de conectar que não
// precisa de instrução nenhuma: aponta a câmera e entra — sem memorizar caminho
// de menu no outro aparelho, sem trocar de aparelho com um código na cabeça,
// sem a dúvida de digitar ou não o separador.
// Escala inteira de propósito: módulo em fração de pixel borra a leitura.
// Apaga o QR desenhado. Canvas guarda o último desenho pra sempre; sem isto,
// reabrir o modal mostra o QR do código ANTERIOR até a resposta chegar.
function limparQrPareamento() {
    const canvas = document.getElementById('pairQr');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// O gerador de QR (12KB) só serve ao pareamento, que a maioria dos editores
// nunca abre — e era baixado em TODA abertura da app. Aqui ele vem sob demanda,
// uma vez por sessão. É `self` na CSP, então injetar a tag é permitido.
let _qrCarregando = null;
function carregarQr() {
    if (typeof gerarQR === 'function') return Promise.resolve(true);
    if (_qrCarregando) return _qrCarregando;
    _qrCarregando = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'js/min/qr.js';
        s.onload = () => resolve(typeof gerarQR === 'function');
        // Falhar não pode travar o pareamento: o código digitável continua lá.
        s.onerror = () => { _qrCarregando = null; resolve(false); };
        document.head.appendChild(s);
    });
    return _qrCarregando;
}

async function desenharQrPareamento(url) {
    const canvas = document.getElementById('pairQr');
    if (!canvas) return;
    if (!(await carregarQr())) { canvas.classList.add('hidden'); return; }
    const qr = gerarQR(url);
    if (!qr) { canvas.classList.add('hidden'); return; }
    canvas.classList.remove('hidden');
    const QUIET = 4;                         // margem exigida pela norma
    const lado = qr.tamanho + QUIET * 2;
    const escala = Math.max(2, Math.floor(220 / lado));
    const px = lado * escala;
    canvas.width = px * (window.devicePixelRatio || 1);
    canvas.height = canvas.width;
    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    // Fundo claro SEMPRE, inclusive no tema escuro: leitor de QR espera
    // módulos escuros sobre claro, e inverter derruba a taxa de leitura.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#0f172a';
    for (let l = 0; l < qr.tamanho; l++) {
        for (let c = 0; c < qr.tamanho; c++) {
            if (qr.modulos[l][c]) {
                ctx.fillRect((c + QUIET) * escala, (l + QUIET) * escala, escala, escala);
            }
        }
    }
}

async function abrirPareamento() {
    // `openModal` sozinho: ele JÁ esconde os outros modais, e trocar de modal
    // é a MESMA camada — não empilha histórico.
    //
    // Fechar antes, no mesmo quadro, dessincronizava o contador do voltar do
    // jeito mais traiçoeiro possível: o `closeModal` agenda um `history.back()`,
    // o `openModal` seguinte empilha uma entrada NOVA, e o back que estava
    // pendente come justamente essa. Sobra `profundidade: 1` sem entrada real
    // por trás — e o próximo fechamento manda o `back()` pra fora da app.
    //
    // MEDIDO: Ajuda → Conectar outro aparelho → fechar tirava o editor da
    // página. O contador não denuncia (fica em 1, com history.length 3): só
    // a navegação mostra.
    openModal('pairShowModal');
    const codeEl = document.getElementById('pairCode');
    const expEl = document.getElementById('pairExpiry');
    codeEl.textContent = '······';
    delete codeEl.dataset.raw;
    codeEl.classList.remove('opacity-40', 'line-through');
    expEl.textContent = '';
    // O código volta a ficar escondido a cada abertura: revelar é um pedido, e
    // pedido não se herda da vez passada — cada revelação cria um registro
    // fraco novo no servidor.
    document.getElementById('pairCodeReveal').classList.add('hidden');
    document.getElementById('pairShowCodeBtn').classList.remove('hidden');
    document.getElementById('pairShowCodeBtn').disabled = false;
    document.getElementById('pairCodeExpiry').textContent = '';
    limparQrPareamento();
    document.getElementById('pairCopyLinkBtn').disabled = true;

    const r = await API.criarPareamento();
    if (!r.success) {
        closeModal('pairShowModal');
        showToast(msgDoServidor(r, t('toast.pairCreateError')), 'error');
        return;
    }
    // O segredo do QR NÃO é exibido: ele tem 20 símbolos e ninguém vai digitar
    // isso. Quem não tem câmera pede um código curto no botão, e aí sim.
    codeEl.dataset.raw = r.code;
    desenharQrPareamento(location.origin + '/#pair=' + r.code);
    document.getElementById('pairCopyLinkBtn').disabled = false;

    iniciarTickerPareamento(expEl, r.expiresIn, () => limparQrPareamento());
}

// Contagem regressiva: deixa claro que o segredo morre — e evita o editor ficar
// tentando um código velho achando que a app quebrou. Vale pro QR e pro código
// digitado, que são registros SEPARADOS e vencem cada um no seu tempo.
function iniciarTickerPareamento(elemento, segundos, aoVencer) {
    let restante = segundos;
    const tick = () => {
        if (restante <= 0) {
            elemento.textContent = t('pair.expired');
            if (aoVencer) aoVencer();
            pararTickerPareamento(elemento);
            return;
        }
        const m = Math.floor(restante / 60);
        const seg = String(restante % 60).padStart(2, '0');
        elemento.textContent = t('pair.expiresIn', { time: m + ':' + seg });
        restante--;
    };
    pararTickerPareamento(elemento);
    tick();
    pairTickers.set(elemento, setInterval(tick, 1000));
}

// Um ticker por elemento: o QR e o código correm juntos, e um `clearInterval`
// só derrubaria o outro em silêncio. Sem argumento, para todos — é o que a
// LIMPEZA_AO_FECHAR precisa, e é o caminho que já mordeu antes (o ticker seguia
// rodando pelo resto da sessão porque a limpeza morava no handler do botão).
function pararTickerPareamento(elemento) {
    if (elemento) {
        clearInterval(pairTickers.get(elemento));
        pairTickers.delete(elemento);
        return;
    }
    for (const id of pairTickers.values()) clearInterval(id);
    pairTickers.clear();
}

// Cria um registro de pareamento CURTO (6 chars, digitável) — só quando pedido.
// Ver o comentário no index.html: o curto é fraco por construção, e existir só
// sob demanda é o que impede que ele enfraqueça o QR de todo mundo.
async function revelarCodigoPareamento() {
    const btn = document.getElementById('pairShowCodeBtn');
    const codeEl = document.getElementById('pairCode');
    const expEl = document.getElementById('pairCodeExpiry');
    btn.disabled = true;
    const r = await API.criarPareamento({ comCodigo: true });
    if (!r.success) {
        btn.disabled = false;
        showToast(msgDoServidor(r, t('toast.pairCreateError')), 'error');
        return;
    }
    btn.classList.add('hidden');
    document.getElementById('pairCodeReveal').classList.remove('hidden');
    codeEl.textContent = formatarCodigoPareamento(r.code);
    // O CRU é o que vale pro resgate — o separador é só apresentação.
    codeEl.dataset.curto = r.code;
    codeEl.classList.remove('opacity-40', 'line-through');
    iniciarTickerPareamento(expEl, r.expiresIn, () => codeEl.classList.add('opacity-40', 'line-through'));
}

async function copiarLinkPareamento() {
    const raw = document.getElementById('pairCode').dataset.raw;
    if (!raw) return;
    const url = location.origin + '/#pair=' + raw;
    try {
        await navigator.clipboard.writeText(url);
        showToast(t('toast.pairLinkCopied'), 'success');
    } catch (e) {
        // clipboard exige contexto seguro e permissão; sem ele, mostra o link
        // pro editor copiar na mão em vez de falhar em silêncio.
        showToast(url, 'info', 12000);
    }
}

async function resgatarPareamento(code, { silencioso = false } = {}) {
    const err = document.getElementById('pairEnterError');
    const r = await API.resgatarPareamento(code);
    if (!r.success) {
        if (silencioso) {
            showToast(msgDoServidor(r, t('toast.pairInvalid')), 'error');
        } else if (err) {
            err.textContent = msgDoServidor(r, t('toast.pairInvalid'));
            err.classList.remove('hidden');
        }
        return false;
    }
    closeModal('pairEnterModal');
    showToast(t('toast.pairSuccess'), 'success');
    showMainScreen();
    AppState._profilePromise = loadProfileAndAuxData();
    startFetching();
    return true;
}

function setupModalListeners() {
    const $ = id => document.getElementById(id);
    $('closeFilters').addEventListener('click', () => closeModal('filtersModal'));
    $('cancelFilters').addEventListener('click', () => closeModal('filtersModal'));
    $('closeFiltersFooter').addEventListener('click', () => closeModal('filtersModal'));
    $('applyFilters').addEventListener('click', applyFiltersFromModal);
    $('batchReadBtn')?.addEventListener('click', openBatchReadConfirm);
    $('confirmBatchRead')?.addEventListener('click', handleBatchMarkRead);
    $('cancelBatchRead')?.addEventListener('click', () => closeModal('batchReadModal'));
    $('lightboxDelete')?.addEventListener('click', pedirExclusaoDaFoto);
    $('lightboxApprove')?.addEventListener('click', aprovarFotoAtual);
    $('lightboxNomeBtn')?.addEventListener('click', abrirEdicaoNome);
    $('lightboxNomeOk')?.addEventListener('click', confirmarRenomear);
    $('lightboxNomeCancel')?.addEventListener('click', fecharEdicaoNome);
    $('lightboxNomeInput')?.addEventListener('input', atualizarBotaoSalvarNome);
    $('lightboxNomeInput')?.addEventListener('keydown', (ev) => {
        // Enter confirma, Esc cancela — e o Esc PARA aqui (`stopPropagation`),
        // senão ele fecha o lightbox inteiro e a pessoa perde a foto que estava
        // usando de prova só por desistir de um caractere.
        if (ev.key === 'Enter') { ev.preventDefault(); confirmarRenomear(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fecharEdicaoNome(); }
    });

    // Pareamento
    $('pairCreateBtn')?.addEventListener('click', abrirPareamento);
    $('pairCopyLinkBtn')?.addEventListener('click', copiarLinkPareamento);
    $('pairShowCodeBtn')?.addEventListener('click', revelarCodigoPareamento);
    $('pairShowClose')?.addEventListener('click', () => { pararTickerPareamento(); closeModal('pairShowModal'); });
    $('pairEnterBtn')?.addEventListener('click', () => {
        const input = $('pairCodeInput');
        if (input) input.value = '';
        $('pairEnterError')?.classList.add('hidden');
        openModal('pairEnterModal');
    });
    $('pairEnterCancel')?.addEventListener('click', () => closeModal('pairEnterModal'));
    $('pairEnterConfirm')?.addEventListener('click', () => resgatarPareamento($('pairCodeInput').value));
    $('pairCodeInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); resgatarPareamento(e.target.value); }
    });
    // O campo assume o MESMO formato da tela que mostra o código: digitou 3
    // caracteres, o hífen entra sozinho. Assim tanto faz o editor digitar o
    // separador ou não — o resultado na tela é o mesmo que ele está copiando.
    $('pairCodeInput')?.addEventListener('input', (e) => {
        const el = e.target;
        // Reformatar e jogar o cursor pro fim atrapalha quem corrige no meio;
        // conta quantos caracteres ÚTEIS havia antes do cursor e recoloca ali.
        const uteisAntes = el.value.slice(0, el.selectionStart).replace(/[^0-9A-Za-z]/g, '').length;
        el.value = formatarCodigoPareamento(el.value);
        let pos = 0, vistos = 0;
        while (pos < el.value.length && vistos < uteisAntes) {
            if (el.value[pos] !== '-') vistos++;
            pos++;
        }
        if (el.value[pos] === '-') pos++;   // o cursor pula o separador sozinho
        el.setSelectionRange(pos, pos);
    });
    setupFilterTabs();
    setupLanguageSwitcher();
    $('focoAutorBar').addEventListener('click', limparFocoAutor);
    $('filterCountry').addEventListener('change', (e) => {
        loadStatesIntoSelect(parseInt(e.target.value, 10));
    });
    $('filterMyArea').addEventListener('change', (e) => {
        const checked = e.target.checked;
        $('filterCountry').disabled = checked;
        $('filterState').disabled = checked;
        $('filterManagedArea').disabled = checked;
    });

    // Preferências aplicam NA HORA (padrão M3 pra settings: switch = efeito
    // imediato; o "Aplicar" do rodapé pertence só à aba Filtros). O idioma já
    // funcionava assim (setupLanguageSwitcher); undo e dev mode agora também —
    // antes, trocar o switch e fechar sem "Aplicar" perdia a mudança em silêncio.
    $('prefUndoEnabled').addEventListener('change', (e) => {
        // Gate: sem cota o checkbox fica disabled e nem dispara change; o
        // canDisableUndo aqui é cinto de segurança contra DOM editado à mão.
        AppState.preferences.undoEnabled = canDisableUndo() ? e.target.checked : true;
        savePreferences();
    });
    $('prefPresenca').addEventListener('change', (e) => {
        AppState.preferences.presenca = e.target.checked;
        // O carimbo é do DESLIGAR. Religar à mão zera: quem voltou por vontade
        // própria não está no meio de nenhuma contagem.
        if (e.target.checked) delete AppState.preferences.presencaOffEm;
        else AppState.preferences.presencaOffEm = Date.now();
        savePreferences();
        window.Presenca?.sincronizar?.();
    });
    $('prefDevModeActive').addEventListener('change', (e) => {
        if (!AppState.devMode.unlocked) return;
        AppState.devMode.active = e.target.checked;
        saveDevMode();
        updateDevBadge();
        if (!e.target.checked) {
            enforceDevGatedFilters();
            // Dev off pode re-travar o gate do undo → força ligado de novo.
            if (!canDisableUndo() && AppState.preferences.undoEnabled === false) {
                AppState.preferences.undoEnabled = true;
                savePreferences();
            }
        }
        renderUndoGateUI();
    });
}

// SOBRE O `thumb100_` DO WAZE, E POR QUE ELE NÃO É USADO AQUI
//
// O Waze serve `thumb100_` (100x75, 3,2 KB) além do `thumb700_` (700x525,
// 80,8 KB) — 25x menos bytes. A tira de miniaturas chegou usando ele, e estava
// ERRADO. O owner apontou: o aquecimento JÁ baixou os `thumb700` deste card.
//
// Medido: renderizar um card dispara o aquecimento das 4 fotos do SEGUINTE em
// `thumb700` (`PREFETCH_TETO_FOTOS = 4`, cobrindo 91,7% dos cards por inteiro),
// e o `venue-image.waze.com` responde com `max-age=3600`. Quando o lightbox
// abre, essas fotos estão em cache e custam ZERO.
//
// O `thumb100` é outra URL, então nunca aproveita esse cache: seriam 4
// requisições novas e ~12,8 KB por local, por fotos que o aparelho já tem. Numa
// sessão de triagem com dezenas de locais de várias fotos, isso vira centenas
// de KB de duplicata — na conta de dados do editor.
//
// E tem o outro lado: reusar o `thumb700` na tira PRÉ-AQUECE o carrossel (é a
// mesma imagem que aparece ao tocar em ›), enquanto o `thumb100` baixa algo que
// nunca mais é usado. O preço é decodificar 700x525 pra desenhar em 59x44 —
// pago em memória, não em rede, e limitado pelo `loading="lazy"` (só as
// miniaturas visíveis decodificam).
//
// Resumo pro próximo que achar o `thumb100`: ele é ótimo em abstrato e inútil
// aqui, porque a app já tem a foto grande antes de precisar da pequena.

// Quando a foto foi tirada, na forma que o editor usa pra decidir.
//
// POR QUE ISTO IMPORTA: no lightbox mora a lixeira, e a pergunta que antecede
// excluir é "isto ainda é este lugar?". MEDIDO nos 6 países obrigatórios (3176
// fotos): a distribuição é BIMODAL — 48,5% têm menos de um mês (são as
// propostas) e 39,2% têm MAIS DE TRÊS ANOS, chegando a 12. Quase nada no meio.
// Ou seja, a data separa na hora "esta é a proposta" de "este é o acervo
// antigo", e hoje 39% das fotos chegam sem nenhum sinal disso na tela.
//
// FORMATO guiado pelos próprios dados: relativo pras recentes (metade dos
// casos, e "há 3 dias" lê melhor que uma data) e ANO pras antigas ("2019" lê
// melhor que "há 2350 dias"). O corte é 1 ano.
//
// `Intl.RelativeTimeFormat` em vez de chaves no dicionário: ele resolve plural
// por idioma sozinho, e o projeto não tem ICU — chave manual é exatamente onde
// nasce o "1 dias" (ver a nota do {undoSeg} no CLAUDE.md). Aqui não há string
// nossa pra traduzir: é dado formatado no locale, como o resto dos números.
function idadeDaFoto(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const dias = Math.floor((Date.now() - ms) / 86400000);
    if (dias < 0) return null;   // relógio torto ou data no futuro: não inventa
    const loc = i18nLocale();
    try {
        if (dias >= 365) return new Date(ms).toLocaleDateString(loc, { year: 'numeric' });
        const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
        if (dias < 1) return rtf.format(0, 'day');
        if (dias < 30) return rtf.format(-dias, 'day');
        return rtf.format(-Math.round(dias / 30), 'month');
    } catch (e) {
        return new Date(ms).toLocaleDateString(loc);
    }
}

// As duas ações de foto (excluir / aprovar) aparecem por REGRA DE ESTADO,
// avaliada a cada render — nunca por um esconder de disparo único.
//
// Foi exatamente isso que quebrou, relatado pelo owner: `abrirEdicaoNome()`
// escondia os botões UMA vez, e o render da foto seguinte os reacendia sem
// saber que havia renomeação em curso. Reapareciam logo ABAIXO do
// confirmar/cancelar do nome — o canto pra onde o dedo já estava indo, com
// duas ações que gravam no mapa.
//
// Mesma lição do `acoesTravadas()` (gotcha #63): regra que vale em dois
// momentos mora em UMA função, senão os dois momentos divergem sem ninguém ver.
function atualizarAcoesDeFoto() {
    // No treino as duas ações NÃO existem: escrevem no mapa e não têm ensaio
    // possível. Some em vez de desabilitar — botão morto com cara de vivo lê
    // como app quebrada, e "desabilitado" convida à pergunta "por que não
    // posso?", que num treino não tem resposta boa.
    //
    // Renomeando, mesma coisa: elas ficam no mesmo canto do confirmar/cancelar.
    // Trocar de foto DURANTE a renomeação continua valendo (é legítimo conferir
    // a grafia noutra fachada) — o que não pode é a ação destrutiva voltar.
    const some = Treino.ativo || editandoNome();
    const del = document.getElementById('lightboxDelete');
    if (del) del.classList.toggle('hidden', some || !Lightbox.idFotoAtual());
    // Mutuamente exclusivos: pendente se APROVA, aprovada se EXCLUI. Sem isso
    // os dois brigariam pelo mesmo canto, e o editor teria que adivinhar qual
    // vale pra foto que está vendo.
    const apr = document.getElementById('lightboxApprove');
    if (apr) apr.classList.toggle('hidden', some || !Lightbox.podeAprovarAtual());
}

const Lightbox = {
    urls: [],
    idx: 0,
    newIdx: -1,
    placeName: '',
    // Estado de zoom/pan (gestos estilo visualizador de fotos: pinch,
    // double-tap, arrastar pra trocar/fechar quando sem zoom)
    scale: 1,
    tx: 0,
    ty: 0,
    isOpen() {
        return !document.getElementById('imageLightbox').classList.contains('hidden');
    },
    open(urls, startIdx, newImageIdx, placeName, eDenuncia, place) {
        if (!urls || urls.length === 0) return;
        // O place vem EXPLÍCITO em vez de sair do AppState: a lixeira grava no
        // Waze, e ler o alvo de uma variável global é como se apaga a foto do
        // card errado quando a fila anda embaixo de um lightbox aberto.
        this.place = place || null;
        this.urls = urls;
        this.idx = Math.max(0, Math.min(startIdx || 0, urls.length - 1));
        this.newIdx = (newImageIdx !== undefined && newImageIdx !== null) ? newImageIdx : -1;
        this.eDenuncia = !!eDenuncia;
        this.placeName = placeName || '';
        CamadaVoltar.empilhar();
        document.getElementById('imageLightbox').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        const closeBtn = document.getElementById('lightboxClose');
        if (closeBtn) closeBtn.focus(); // foco entra no lightbox (Esc/Enter acessíveis)
        const hint = document.getElementById('lightboxZoomHint');
        if (hint) {
            hint.classList.remove('hidden');
            clearTimeout(this._hintTimer);
            this._hintTimer = setTimeout(() => hint.classList.add('hidden'), 4000);
        }
        this._render();
        mostrarNomeNoLightbox();
    },
    close({ viaHistorico = false } = {}) {
        fecharEdicaoNome();
        if (!this.isOpen()) return;
        if (!viaHistorico) CamadaVoltar.consumir();
        document.getElementById('imageLightbox').classList.add('hidden');
        // Aprovou aqui dentro? O pedido está resolvido no Waze, então o card sai
        // agora — decisão do owner: ficar visível enquanto se olham as outras
        // fotos, e avançar ao fechar. Fica DEPOIS de esconder o lightbox pra o
        // card novo não aparecer por baixo de uma camada que ainda está aberta.
        avancarSeAprovado();
        if (!topOpenModal()) document.body.style.overflow = '';
        document.getElementById('lightboxImage').removeAttribute('src');
        this.resetZoom();
    },
    prev() {
        if (this.urls.length < 2) return;
        this.idx = (this.idx - 1 + this.urls.length) % this.urls.length;
        this._render();
    },
    next() {
        if (this.urls.length < 2) return;
        this.idx = (this.idx + 1) % this.urls.length;
        this._render();
    },
    resetZoom() {
        this.scale = 1;
        this.tx = 0;
        this.ty = 0;
        this._applyTransform();
    },
    zoomTo(scale, cx, cy) {
        // cx/cy em coordenadas de viewport; mantém o ponto tocado sob o dedo
        const img = document.getElementById('lightboxImage');
        const rect = img.getBoundingClientRect();
        const prevScale = this.scale;
        this.scale = Math.max(1, Math.min(4, scale));
        if (this.scale === 1) {
            this.tx = 0;
            this.ty = 0;
        } else if (cx !== undefined) {
            const imgCx = rect.left + rect.width / 2;
            const imgCy = rect.top + rect.height / 2;
            const ratio = this.scale / prevScale;
            this.tx = (this.tx - (cx - imgCx)) * ratio + (cx - imgCx);
            this.ty = (this.ty - (cy - imgCy)) * ratio + (cy - imgCy);
        }
        this._applyTransform();
    },
    panBy(dx, dy) {
        if (this.scale <= 1) return;
        this.tx += dx;
        this.ty += dy;
        this._applyTransform();
    },
    _applyTransform() {
        const img = document.getElementById('lightboxImage');
        if (!img) return;
        img.style.transform = this.scale === 1 && this.tx === 0 && this.ty === 0
            ? ''
            : `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    },
    _render() {
        this.resetZoom();
        const img = document.getElementById('lightboxImage');
        img.src = this.urls[this.idx];
        img.alt = this.placeName ? t('lightbox.img.alt', { name: this.placeName }) : t('lightbox.img.altGeneric');
        const prevBtn = document.getElementById('lightboxPrev');
        const nextBtn = document.getElementById('lightboxNext');
        const count = document.getElementById('lightboxCount');
        const badge = document.getElementById('lightboxNewBadge');
        const multiple = this.urls.length > 1;
        prevBtn.classList.toggle('hidden', !multiple);
        nextBtn.classList.toggle('hidden', !multiple);
        // A pílula do canto passa a dizer DUAS coisas: qual foto e de quando.
        // Vai junto porque é o mesmo assunto ("a foto que estou vendo") e
        // porque espaço no lightbox é disputado — elemento novo brigaria com
        // fechar, selo, dica de zoom, ações e a tira. Com uma foto só, o
        // "1 / 1" seria ruído: fica só a idade.
        const ms = this.dataDaFotoAtual();
        const idade = idadeDaFoto(ms);
        const partes = [];
        if (multiple) partes.push(`${this.idx + 1} / ${this.urls.length}`);
        if (idade) partes.push(idade);
        count.classList.toggle('hidden', partes.length === 0);
        count.textContent = partes.join(' · ');
        // A data exata fica no title: a forma curta responde "é velha?", que é
        // a pergunta de decisão; quem precisar do dia tem onde olhar.
        if (ms) count.title = new Date(ms).toLocaleString(i18nLocale());
        else count.removeAttribute('title');
        badge.textContent = this.eDenuncia ? '🚩' : '✨';
        badge.setAttribute('data-i18n-title', this.eDenuncia ? 'card.flaggedPhoto.title' : 'card.newPhoto.title');
        badge.title = t(this.eDenuncia ? 'card.flaggedPhoto.title' : 'card.newPhoto.title');
        badge.classList.toggle('hidden', this.idx !== this.newIdx);
        // No treino as duas ações de foto NÃO existem: elas escrevem no mapa e
        // não têm ensaio possível. Some em vez de desabilitar — botão morto com
        // cara de vivo lê como app quebrada, e "desabilitado" convida à pergunta
        // "por que não posso?", que num treino não tem resposta boa.
        atualizarAcoesDeFoto();
        this._renderTira();
    },
    // Todas as fotos do local de uma vez, tocáveis pra pular direto.
    //
    // O problema que resolve: 32% dos pedidos da fila real têm 2+ fotos (até 7),
    // e hoje só dá pra tatear no `‹ ›` sem saber quantas faltam nem o que vem.
    // Em `FLAGGED_PHOTO` e `NEW_PHOTO` isso é a própria decisão — "esta, entre
    // estas" e "a proposta ao lado das que o local já tem".
    _renderTira() {
        const tira = document.getElementById('lightboxStrip');
        const lb = document.getElementById('imageLightbox');
        if (!tira || !lb) return;
        const varias = this.urls.length > 1;
        lb.classList.toggle('com-tira', varias);
        tira.classList.toggle('hidden', !varias);
        if (!varias) { tira.innerHTML = ''; tira.dataset.chave = ''; return; }
        // Reconstrói só quando a LISTA muda. Excluir uma foto muda; trocar de
        // foto não — e recriar a cada troca perderia a rolagem da tira e
        // rebaixaria as miniaturas já carregadas.
        const chave = this.urls.join('|');
        if (tira.dataset.chave !== chave) {
            tira.innerHTML = '';
            this.urls.forEach((u, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'lb-mini';
                const im = document.createElement('img');
                im.src = u;   // a MESMA URL da foto grande: já está em cache (ver a nota acima)
                im.alt = '';
                im.decoding = 'async';
                im.loading = 'lazy';
                b.appendChild(im);
                b.addEventListener('click', () => { this.idx = i; this._render(); });
                tira.appendChild(b);
            });
            tira.dataset.chave = chave;
        }
        [...tira.children].forEach((b, i) => {
            const atual = i === this.idx;
            b.classList.toggle('atual', atual);
            b.setAttribute('aria-current', atual ? 'true' : 'false');
            b.setAttribute('aria-label', t('lightbox.strip.item', { i: i + 1, n: this.urls.length }));
            // O selo vai junto: sem ele a tira mostra N fotos iguais e esconde
            // qual delas É o pedido — que é a única coisa que importa aqui.
            const velho = b.querySelector('.lb-mini-selo');
            if (velho) velho.remove();
            if (i === this.newIdx && this.newIdx >= 0) {
                const selo = document.createElement('span');
                selo.className = 'lb-mini-selo';
                selo.setAttribute('aria-hidden', 'true');
                selo.textContent = this.eDenuncia ? '🚩' : '✨';
                b.appendChild(selo);
            }
        });
        const atual = tira.children[this.idx];
        if (atual && atual.scrollIntoView) atual.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    // A foto aberta é a PENDENTE deste pedido e este editor pode aprovar?
    //
    // `newIdx` é o índice do ✨, derivado do `updateRequestID` — então "a foto
    // pendente" é exatamente a que este card propõe. Denúncia (🚩) fica de
    // fora: ali a foto JÁ está no mapa e o que se decide é outra coisa.
    podeAprovarAtual() {
        const p = this.place;
        if (!p || this.eDenuncia) return false;
        if (this.idx !== this.newIdx || this.newIdx < 0) return false;
        if (!p.venueID || !p.updateRequestID) return false;
        return podeAgirComoL6Aqui();   // mesmo portão, decisão do owner
    },
    // Depois de aprovada, a foto passa a estar no mapa: o ✨ some e ela entra
    // na lista de excluíveis — o botão vira lixeira sozinho.
    marcarComoAprovada(id) {
        const p = this.place;
        if (p && Array.isArray(p.approvedImageIds) && !p.approvedImageIds.includes(id)) p.approvedImageIds.push(id);
        if (this.newIdx === this.idx) this.newIdx = -1;
        if (this.isOpen()) this._render();
    },
    desmarcarAprovada(id, idxDoNovo) {
        const p = this.place;
        if (p && Array.isArray(p.approvedImageIds)) p.approvedImageIds = p.approvedImageIds.filter((x) => x !== id);
        this.newIdx = idxDoNovo;
        if (this.isOpen()) this._render();
    },
    // Devolve o id da foto aberta SÓ se ela puder ser excluída — as duas
    // perguntas numa função só, de propósito: separadas, uma delas acaba
    // esquecida em algum caminho novo e a lixeira aparece onde não deve.
    //
    // Excluível é a foto JÁ APROVADA (o core manda `approvedImageIds`). A
    // pendente — a do ✨ — ainda não está no mapa: tirá-la por aqui apagaria a
    // imagem e deixaria o pedido órfão, sem ninguém tratar. O caminho dela é o
    // ✕/✓ do card.
    // A data da foto ABERTA. Busca pelo id contido na URL, mesmo padrão do
    // `idFotoAtual` — o índice não identifica foto (o carrossel reordena).
    dataDaFotoAtual() {
        const mapa = this.place && this.place.imageDates;
        if (!mapa) return null;
        const url = this.urls[this.idx] || '';
        const id = Object.keys(mapa).find((k) => k && url.indexOf(k) !== -1);
        return id ? mapa[id] : null;
    },
    idFotoAtual() {
        const p = this.place;
        if (!p || !p.venueID || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) return null;
        if (!podeExcluirFotoAqui()) return null;
        const url = this.urls[this.idx] || '';
        const ids = Array.isArray(p.approvedImageIds) ? p.approvedImageIds : [];
        return ids.find(id => id && url.indexOf(id) !== -1) || null;
    },
    // Recoloca a foto na posição em que estava — usado pelo Desfazer e quando o
    // envio falha. Sem isto, desfazer devolveria a foto pro fim da lista e a
    // pessoa veria a ordem mudar sozinha.
    recolocarFoto(url, idx) {
        if (!url || this.urls.some((u) => u === url)) return;
        const pos = Math.max(0, Math.min(idx, this.urls.length));
        this.urls.splice(pos, 0, url);
        if (this.newIdx >= pos) this.newIdx += 1;
        this.idx = pos;
        if (!this.isOpen()) return;
        this._render();
    },
    // Tira a foto da lista aberta depois que o Waze confirmou. Sem fila e sem
    // recarregar: quem está olhando quer ver a foto sumir.
    removerFoto(id) {
        const p = this.place;
        const fora = (u) => u.indexOf(id) === -1;
        if (p) {
            if (Array.isArray(p.imageUrls)) p.imageUrls = p.imageUrls.filter(fora);
            if (Array.isArray(p.approvedImageIds)) p.approvedImageIds = p.approvedImageIds.filter(x => x !== id);
            p.imageUrl = (p.imageUrls && p.imageUrls[0]) || null;
        }
        const antes = this.idx;
        this.urls = this.urls.filter(fora);
        if (!this.urls.length) { this.close(); return; }
        // O ✨ é apontado por ÍNDICE; tirar uma foto antes dele desloca tudo.
        if (this.newIdx > antes) this.newIdx -= 1;
        else if (this.newIdx === antes) this.newIdx = -1;
        this.idx = Math.min(antes, this.urls.length - 1);
        this._render();
    }
};

// ═══════════════════════════════════════════════════════════════════════════
//  O portão dos recursos destrutivos: L6 + Area Manager, ou staff
// ═══════════════════════════════════════════════════════════════════════════
//
// A app tem DOIS níveis, e o par é deliberado:
//   · ENTRAR é L3+AM (`isUserAllowed`, no core) — é o portão de verdade, no
//     SERVIDOR, e é ele que impede que qualquer um com cookies do Waze use a app.
//   · AGIR de forma destrutiva é L6+AM — este aqui, só do CLIENTE.
//
// Só do cliente é decisão, não esquecimento: o Waze valida `permissions` e
// `lockRank` na gravação, então quem não pode por aqui também não consegue por
// lá. Isto nunca foi fronteira de segurança — é trava de produto pra o recurso
// não aparecer pra qualquer editor na NOSSA app. Houve um espelho no servidor,
// com cache de perfil pra não custar caro, e SAIU: a chamada que ele exigia era
// a mais lenta das três (977ms medidos) e existia pra reconfirmar o que o Waze
// reconfirma de novo ao gravar (gotcha #59).
//
// O nome NÃO fala de foto de propósito. Ele já guardava três recursos — excluir
// foto, aprovar foto e renomear local — e chamá-lo de "excluir foto" fazia cada
// novo call site parecer estranho, o que empurra a próxima pessoa a
// re-implementar `rank >= 5` em vez de delegar. `test/gates.test.mjs` reprova
// quem re-implementar.
//
// Recurso novo entra por uma função PRÓPRIA que delega (ver `podeRenomearAqui`),
// nunca chamando esta direto: são decisões de produto que hoje COINCIDEM, e se
// um dia o owner separar uma delas, o call site não muda.
function podeAgirComoL6Aqui() {
    const p = AppState.profile;
    if (!p) return false;
    if (p.isStaff) return true;
    // Rank CRU do Waze, 0-indexed: 5 aqui é o L6 que o editor vê (gotcha #15).
    const rank = Number.isInteger(p.rank) ? p.rank : parseInt(p.rank, 10);
    return rank >= 5 && !!p.isAreaManager;
}

// Excluir foto: o primeiro recurso a usar o portão, e agora um delegador como
// os outros dois. Existir como função própria — em vez de o call site chamar a
// base — é o que mantém a invariante que o teste cobra: NENHUM recurso fala
// direto com `podeAgirComoL6Aqui`, cada um tem o seu nome. Assim, separar um
// deles um dia é editar uma função, não caçar call sites.
function podeExcluirFotoAqui() {
    return podeAgirComoL6Aqui();
}

// Gestos do mapa ampliado. Ponteiros unificados (mouse e dedo pelo mesmo
// caminho) porque o mapa é o mesmo nos dois; o que muda é só quantos pontos
// tocam a tela.
function setupMapaLightbox() {
    const lb = document.getElementById('mapaLightbox');
    if (!lb) return;
    document.getElementById('mapaLbClose').addEventListener('click', () => MapaLightbox.close());
    document.getElementById('mapaLbMais').addEventListener('click', () => MapaLightbox.zoom(1));
    document.getElementById('mapaLbMenos').addEventListener('click', () => MapaLightbox.zoom(-1));
    document.getElementById('mapaLbCentrar').addEventListener('click', () => MapaLightbox.recentrar());

    // Os listeners de mover/soltar vão na JANELA, não no elemento.
    //
    // A primeira versão usava `setPointerCapture` no próprio mapa e PERDIA o
    // arrasto: medido, só 2 de 14 movimentos chegavam e o `pointerup` nunca
    // vinha. O motivo é o próprio redesenho — `desenhar()` remove e recria os
    // <img> dos tiles no meio do gesto, e a captura não sobrevive a isso.
    // Escutar na janela não depende de nenhum elemento continuar existindo.
    //
    // E o desenho é AGENDADO por quadro em vez de rodar a cada evento: mover o
    // dedo dispara dezenas de eventos por segundo, e reposicionar 20 tiles em
    // cada um trava a mão. Mesma lição do gotcha #35 — o handler decide, o
    // quadro seguinte escreve.
    const ativos = new Map();
    let acumX = 0, acumY = 0, quadro = 0, arrastou = false, ultimo = null, distPinch = 0;
    const aplicar = () => {
        quadro = 0;
        const dx = acumX, dy = acumY;
        acumX = acumY = 0;
        if (dx || dy) MapaLightbox.arrastar(dx, dy);
    };
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(aplicar); };
    const doisDedos = () => {
        const [a, b] = [...ativos.values()];
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const mover = (e) => {
        if (!ativos.has(e.pointerId)) return;
        ativos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ativos.size >= 2) {
            const c = doisDedos();
            // Um degrau por DOBRO de distância: é a relação natural do pinch e
            // não dispara com tremor de dedo.
            if (distPinch > 0 && (c.d / distPinch > 1.6 || distPinch / c.d > 1.6)) {
                MapaLightbox.zoom(c.d > distPinch ? 1 : -1, c.x, c.y);
                distPinch = c.d;
            }
            arrastou = true;
            return;
        }
        if (!ultimo) return;
        const dx = e.clientX - ultimo.x, dy = e.clientY - ultimo.y;
        if (!dx && !dy) return;
        arrastou = true;
        ultimo = { x: e.clientX, y: e.clientY };
        acumX += dx; acumY += dy;
        agendar();
    };
    const soltar = (e) => {
        ativos.delete(e.pointerId);
        if (ativos.size === 0) {
            ultimo = null;
            removeEventListener('pointermove', mover);
            removeEventListener('pointerup', soltar);
            removeEventListener('pointercancel', soltar);
            if (quadro) { cancelAnimationFrame(quadro); aplicar(); }
        } else {
            const p0 = [...ativos.values()][0];
            ultimo = { x: p0.x, y: p0.y };
        }
    };
    lb.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;   // botão é botão
        e.preventDefault();
        ativos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        arrastou = false;
        if (ativos.size === 2) distPinch = doisDedos().d;
        else ultimo = { x: e.clientX, y: e.clientY };
        addEventListener('pointermove', mover);
        addEventListener('pointerup', soltar);
        addEventListener('pointercancel', soltar);
    });
    // Roda do mouse: o desktop não tem pinch.
    lb.addEventListener('wheel', (e) => {
        e.preventDefault();
        MapaLightbox.zoom(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    }, { passive: false });
    // Duplo toque aproxima, como em qualquer mapa.
    let ultimoToque = 0;
    lb.addEventListener('click', (e) => {
        if (e.target.closest('button') || arrastou) return;
        const agora = Date.now();
        if (agora - ultimoToque < 300) MapaLightbox.zoom(1, e.clientX, e.clientY);
        ultimoToque = agora;
    });
    // Girar o aparelho muda a caixa: sem redesenhar, sobra faixa sem tile.
    addEventListener('resize', () => { if (MapaLightbox.isOpen()) MapaLightbox.desenhar(); });
}

function setupLightbox() {
    const lb = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImage');
    document.getElementById('lightboxClose').addEventListener('click', () => Lightbox.close());
    document.getElementById('lightboxPrev').addEventListener('click', (e) => { e.stopPropagation(); Lightbox.prev(); });
    document.getElementById('lightboxNext').addEventListener('click', (e) => { e.stopPropagation(); Lightbox.next(); });
    lb.addEventListener('click', (e) => {
        if (e.target === lb) Lightbox.close();
    });

    // ── Gestos (Pointer Events): pinch zoom, double-tap, pan, swipe ──
    const pointers = new Map();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragging = false;

    img.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        img.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchStartDist = Math.hypot(b.x - a.x, b.y - a.y);
            pinchStartScale = Lightbox.scale;
            dragging = false;
            return;
        }

        // Double-tap → alterna zoom no ponto tocado
        const now = performance.now();
        if (now - lastTapTime < 300 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40) {
            lastTapTime = 0;
            if (Lightbox.scale > 1) Lightbox.resetZoom();
            else Lightbox.zoomTo(2.5, e.clientX, e.clientY);
            return;
        }
        lastTapTime = now;
        lastTapX = e.clientX;
        lastTapY = e.clientY;

        dragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
    });

    img.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        const prev = pointers.get(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(b.x - a.x, b.y - a.y);
            if (pinchStartDist > 0) {
                const cx = (a.x + b.x) / 2;
                const cy = (a.y + b.y) / 2;
                Lightbox.zoomTo(pinchStartScale * (dist / pinchStartDist), cx, cy);
            }
            return;
        }

        if (Lightbox.scale > 1) {
            Lightbox.panBy(e.clientX - prev.x, e.clientY - prev.y);
        }
    });

    const endPointer = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStartDist = 0;

        // Sem zoom: swipe horizontal troca foto, vertical pra baixo fecha
        if (dragging && pointers.size === 0 && Lightbox.scale === 1) {
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) Lightbox.next();
                else Lightbox.prev();
            } else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
                Lightbox.close();
            }
        }
        if (pointers.size === 0) dragging = false;
    };
    img.addEventListener('pointerup', endPointer);
    img.addEventListener('pointercancel', endPointer);

    // Desktop: scroll do mouse dá zoom no cursor
    lb.addEventListener('wheel', (e) => {
        if (!Lightbox.isOpen()) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        Lightbox.zoomTo(Lightbox.scale * factor, e.clientX, e.clientY);
    }, { passive: false });
}

function openLightbox(urls, startIdx, newImageIdx, placeName, eDenuncia, place) {
    Lightbox.open(urls, startIdx, newImageIdx, placeName, eDenuncia, place);
}

// ── Excluir a foto aberta ─────────────────────────────────────────────────
//
// SEM diálogo de confirmação, por decisão do owner: a pessoa já fez três gestos
// deliberados pra chegar aqui (abrir a foto, navegar até ela, mirar num alvo
// pequeno), e perguntar de novo é desconfiar dela. No lugar entra a JANELA DE
// DESFAZER que a app já usa no swipe — que não desfaz depois, ADIA o envio.
//
// A janela respeita a preferência do editor, igual ao swipe. Quem a desligou
// paga o preço da própria escolha: a exclusão vai na hora, e não há volta —
// medimos que re-adicionar a foto não persiste (o Waze responde 200 com
// `synced: true` e ignora).
//
// A janela daqui NÃO usa o `AppState.pendingAction` do card, e isso é
// deliberado: lá a trava existe porque a próxima ação despacharia a anterior,
// mas prender ✕/↑/✓ por 3s porque alguém apagou uma foto no lightbox seria
// efeito colateral sem motivo.
let exclusaoPendente = null;   // { id, place, timer, enviar, desfazer }

// A lixeira vira spinner SÓ quando há espera de verdade — ou seja, no caminho
// SEM Desfazer. Com Desfazer a foto some na hora e nada foi enviado ainda:
// spinner ali seria mentira sobre uma espera que não existe, e ainda
// bloquearia excluir a PRÓXIMA foto, que passou a ocupar aquele botão.
function lixeiraOcupada(ligado) {
    const btn = document.getElementById('lightboxDelete');
    if (!btn) return;
    btn.disabled = ligado;
    btn.classList.toggle('lixeira-ocupada', ligado);
}

// Manda pro Waze de verdade. Se falhar, a foto VOLTA — mesma gramática do
// swipe, que reverte o placar quando o Waze recusa.
async function enviarExclusao(alvo) {
    try {
        const r = await API.excluirFoto(alvo.place.venueID, alvo.id, alvo.place.lat, alvo.place.lon);
        if (r && r.success) {
            // Sem toast de sucesso: a foto sumindo JÁ é a confirmação, e
            // anunciar o que a pessoa está vendo acontecer é ruído. O aviso
            // fica só pro caso em que nada muda na tela por causa dela.
            if (r.jaExcluida) showToast(t('toast.photoAlreadyGone'), 'info');
            return;
        }
        if (r && r.errorCategory === 'unauthorized') { handleUnauthorized(); return; }
        devolverFoto(alvo);
        showToast(msgDoServidor(r) || t('toast.photoDeleteFailed'), 'error');
    } catch (e) {
        devolverFoto(alvo);
        showToast(t('toast.photoDeleteFailed'), 'error');
    }
}

// Recoloca a foto onde estava — no desfazer e na falha do envio.
function devolverFoto(alvo) {
    const p = alvo.place;
    if (p && Array.isArray(p.imageUrls) && !p.imageUrls.some((u) => u.indexOf(alvo.id) !== -1)) {
        p.imageUrls.splice(Math.min(alvo.idx, p.imageUrls.length), 0, alvo.url);
        if (Array.isArray(p.approvedImageIds) && !p.approvedImageIds.includes(alvo.id)) p.approvedImageIds.push(alvo.id);
        p.imageUrl = p.imageUrls[0] || null;
    }
    if (Lightbox.place === p) Lightbox.recolocarFoto(alvo.url, alvo.idx);
    if (AppState.currentPlace === p) showCurrentPlace();
}

function pedirExclusaoDaFoto() {
    // Treino não escreve. Antes isto era garantido pelo DADO — os cards de
    // treino não tinham foto, então o lightbox nem abria. Com pedido real na
    // fila de treino essa proteção acidental some, e o `venueID` é REAL: sem
    // este guard, a lixeira apagaria uma foto do mapa enquanto a faixa promete
    // que nada é enviado. Proteção não pode depender de a fixture ser pobre.
    if (Treino.ativo) return;
    const id = Lightbox.idFotoAtual();
    if (!id) return;
    const place = Lightbox.place;
    const alvo = { id, place, idx: Lightbox.idx, url: Lightbox.urls[Lightbox.idx] };

    // Uma exclusão por vez: tocar na lixeira de novo despacha a anterior, como
    // o swipe faz. Sem isto, duas janelas correndo escreveriam listas que se
    // ignoram — a segunda apagaria só a dela, ressuscitando a primeira.
    if (exclusaoPendente) exclusaoPendente.enviar();
    // E a APROVAÇÃO pendente também: a foto recém-aprovada vira alvo da lixeira
    // no mesmo canto, e sem despachar antes as duas escritas cruzam — a
    // exclusão relê um local onde a foto ainda está pendente, monta a lista sem
    // ela, e aí a aprovação chega depois e a devolve. O editor mandou excluir e
    // a foto fica. Hoje o banner do Desfazer TAPA a lixeira (medido:
    // elementFromPoint devolve #undoBtn), mas isso é acidente de sobreposição —
    // se o banner mudar de lugar a proteção some sem ninguém notar.
    if (aprovacaoPendente) aprovacaoPendente.enviar();

    // Gate de experiência igual ao do swipe: a preferência salva como false só
    // vale se o editor qualifica (senão um legado de versão sem gate liberaria).
    const semJanela = AppState.preferences.undoEnabled === false && canDisableUndo();
    if (semJanela) {
        // Espera REAL: a chamada sai agora. Spinner no lugar da lixeira e a
        // foto só sai da tela quando o Waze confirmar.
        lixeiraOcupada(true);
        enviarExclusao(alvo).finally(() => {
            lixeiraOcupada(false);
            Lightbox.removerFoto(alvo.id);
            if (AppState.currentPlace === place) showCurrentPlace();
        });
        return;
    }

    // Com janela: a foto some JÁ (é o retorno imediato) e o envio espera.
    // A releitura é aquecida agora — os ~557ms dela cabem dentro da janela.
    API.prepararExclusao(place.venueID, place.lat, place.lon);
    Lightbox.removerFoto(alvo.id);
    if (AppState.currentPlace === place) showCurrentPlace();

    let saiu = false;
    const enviar = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(exclusaoPendente && exclusaoPendente.timer);
        if (exclusaoPendente && exclusaoPendente.id === alvo.id) exclusaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        enviarExclusao(alvo);
    };
    const desfazer = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(exclusaoPendente && exclusaoPendente.timer);
        if (exclusaoPendente && exclusaoPendente.id === alvo.id) exclusaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        devolverFoto(alvo);
    };
    const timer = setTimeout(enviar, UNDO_WINDOW_MS);
    exclusaoPendente = { id: alvo.id, place, timer, enviar, desfazer };
    aplicarTravaDeAcao();
    mostrarDesfazer(t('undo.photoDeleted'), () => exclusaoPendente && exclusaoPendente.desfazer());
}

// ── Aprovar a foto pendente ───────────────────────────────────────────────
//
// Espelho da lixeira, e de propósito: mesmo portão (L6+AM ou staff), mesma
// janela de Desfazer, mesma regra de que o envio só sai quando a janela fecha
// SOZINHA. O que muda é o sentido — aqui a foto passa a valer no mapa.
//
// Por que aprovar foto não fere a regra de ouro ("a app nunca aprova"): a regra
// existe porque aprovar dado de LOCAL exige ajuste no WME — nome, categoria,
// posição têm campo pra corrigir. Foto não tem: ou serve ou não serve, e a
// decisão está inteira na tela. Decisão do owner, a pedido de um global champ.
let aprovacaoPendente = null;

// O card fica na tela depois de aprovar (decisão do owner) e só avança quando o
// lightbox fechar. Sem isto, o pedido ficaria resolvido no Waze e pendurado na
// fila — e o ✓ seguinte devolveria "já tratado por outro editor", que é um
// toast confuso pra quem acabou de tratar ele mesmo.
let placeResolvidoPorAprovacao = null;

function estadoAprovando(ligado) {
    const btn = document.getElementById('lightboxApprove');
    const spin = document.getElementById('lightboxApproveSpinner');
    const ico = document.getElementById('lightboxApproveIcon');
    if (btn) btn.disabled = ligado;
    if (spin) spin.classList.toggle('hidden', !ligado);
    if (ico) ico.classList.toggle('hidden', ligado);
}

async function enviarAprovacao(alvo) {
    try {
        const r = await API.aprovarPedido(alvo.place.venueID, alvo.place.updateRequestID);
        if (r && r.success) {
            // Sem toast de sucesso: o ✨ sumindo e o botão virando lixeira JÁ
            // dizem que valeu — mesma razão do excluir.
            placeResolvidoPorAprovacao = alvo.place;
            AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
            updateStats();
            return;
        }
        if (r && r.errorCategory === 'unauthorized') { handleUnauthorized(); return; }
        // `already_processed` conta como sucesso: outro editor aprovou antes, e
        // o objetivo de quem tocou foi cumprido (mesma lógica do resto da app).
        if (r && (r.errorCategory === 'already_processed' || r.errorCategory === 'not_found')) {
            placeResolvidoPorAprovacao = alvo.place;
            AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
            updateStats();
            return;
        }
        Lightbox.desmarcarAprovada(alvo.id, alvo.idx);
        showToast(msgDoServidor(r) || t('toast.photoApproveFailed'), 'error');
    } catch (e) {
        Lightbox.desmarcarAprovada(alvo.id, alvo.idx);
        showToast(t('toast.photoApproveFailed'), 'error');
    }
}

// Avança o card cujo pedido foi aprovado — chamado ao fechar o lightbox.
// A aprovação em voo (janela do Desfazer aberta) é despachada antes: fechar o
// lightbox é sinal de que a pessoa terminou, e deixar a janela correndo com o
// card já fora da tela é pedir pra ela desfazer algo que não vê mais.
function avancarSeAprovado() {
    if (aprovacaoPendente) aprovacaoPendente.enviar();
    const alvo = placeResolvidoPorAprovacao;
    if (!alvo) return;
    placeResolvidoPorAprovacao = null;
    if (AppState.currentPlace !== alvo) return;   // a fila já andou por outro caminho
    advanceQueue();
}

function aprovarFotoAtual() {
    // Treino não escreve. Antes isto era garantido pelo DADO — os cards de
    // treino não tinham foto, então o lightbox nem abria. Com pedido real na
    // fila de treino essa proteção acidental some, e o `venueID` é REAL: sem
    // este guard, a lixeira apagaria uma foto do mapa enquanto a faixa promete
    // que nada é enviado. Proteção não pode depender de a fixture ser pobre.
    if (Treino.ativo) return;
    if (!Lightbox.podeAprovarAtual()) return;
    const place = Lightbox.place;
    const alvo = { id: place.updateRequestID, place, idx: Lightbox.idx };
    if (aprovacaoPendente) aprovacaoPendente.enviar();
    // Mesma razão do lado de lá: as duas escritas mexem no mesmo local, então
    // quem chega depois tem que ver o resultado de quem chegou antes.
    if (exclusaoPendente) exclusaoPendente.enviar();

    const semJanela = AppState.preferences.undoEnabled === false && canDisableUndo();
    if (semJanela) {
        estadoAprovando(true);
        enviarAprovacao(alvo).finally(() => {
            estadoAprovando(false);
            Lightbox.marcarComoAprovada(alvo.id);
        });
        return;
    }

    // Com janela: o ✨ some JÁ (é o retorno imediato) e o envio espera.
    Lightbox.marcarComoAprovada(alvo.id);
    let saiu = false;
    const enviar = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(aprovacaoPendente && aprovacaoPendente.timer);
        aprovacaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        enviarAprovacao(alvo);
    };
    const desfazer = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(aprovacaoPendente && aprovacaoPendente.timer);
        aprovacaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        Lightbox.desmarcarAprovada(alvo.id, alvo.idx);
    };
    aprovacaoPendente = { timer: setTimeout(enviar, UNDO_WINDOW_MS), enviar, desfazer };
    aplicarTravaDeAcao();
    mostrarDesfazer(t('undo.photoApproved'), () => aprovacaoPendente && aprovacaoPendente.desfazer());
}

// ── Renomear o local, do lightbox ──────────────────────────────────────────
//
// A ÚNICA escrita de dado de LOCAL da app, e o que a justifica é a natureza da
// decisão, não a conveniência: o editor está com a FACHADA ampliada na tela, que
// é prova primária do nome. E a alternativa não é decidir melhor no WME — é a
// MESMA gravação com uma ida e volta no meio. Medido no HAR do owner renomeando
// lá: o WME não busca duplicado, não valida convenção, não confere nada. Manda
// `{id, name}`.
//
// Portão: o mesmo dos outros destrutivos (`podeAgirComoL6Aqui`), e só do
// CLIENTE — o Waze valida `permissions`/`lockRank` na gravação, então quem não
// pode por aqui também não consegue por lá.
let renomeacaoPendente = null;   // { timer, enviar, desfazer }

function podeRenomearAqui() {
    // Mesmo portão da foto. Função própria (em vez de chamar a outra direto)
    // porque são DUAS decisões de produto que hoje coincidem: se um dia o owner
    // separar, o call site não muda.
    if (!podeAgirComoL6Aqui()) return false;
    const p = Lightbox.place;
    // v1 só CORRIGE nome existente. Batizar local sem nome é outra decisão (e
    // outra conversa) — sem isto, um toque acidental nomearia um lugar anônimo.
    if (!(p && p.venueID && String(p.name || '').trim())) return false;
    // O Waze RECUSA escrever atributo em local que ainda não existe no mapa —
    // MEDIDO com controle: mesmo payload, mesma sessão, `approved:false` → 406,
    // `approved:true` → 200. Oferecer aqui é beco sem saída: o editor abre a
    // foto, digita o nome certo, confirma e leva "Erro do Waze (HTTP 406)" —
    // que ainda por cima cai em `errorCategory: unknown`, o balde que reverte o
    // placar e mostra erro genérico.
    // Não é caso de canto: 711 de 2420 cards com nome (29%) estão em local não
    // aprovado nos 6 países obrigatórios, e 40% da fila do owner no Brasil.
    return p.localAprovado !== false;
}

function mostrarNomeNoLightbox() {
    const cx = document.getElementById('lightboxNome');
    if (!cx) return;
    const pode = podeRenomearAqui() && !Treino.ativo;
    cx.classList.toggle('hidden', !pode);
    // A dica de zoom mora no mesmo canto. Some pra quem tem a pílula — é editor
    // L6+AM, que já sabe dar zoom; pro resto ela continua lá.
    const dica = document.getElementById('lightboxZoomHint');
    if (dica) dica.classList.toggle('hidden', pode);
    if (!pode) { fecharEdicaoNome(); return; }
    const txt = document.getElementById('lightboxNomeTxt');
    if (txt) txt.textContent = Lightbox.place.name;
}

function abrirEdicaoNome() {
    if (!podeRenomearAqui() || Treino.ativo || acoesTravadas()) return;
    const cx = document.getElementById('lightboxNome');
    const nome = Lightbox.place.name;
    cx.classList.add('editando');
    // A pílula CONTINUA na tela, mostrando o nome antigo — é ela a referência
    // enquanto se digita. Vira RÓTULO: `disabled` tira do Tab e mata o clique,
    // e o lápis sai porque prometer ação onde não há é o que faz botão morto
    // parecer vivo. Isto substitui a linha "Antes:" que eu tinha posto embaixo:
    // o owner viu o nome DUAS vezes na tela e preferiu, com razão, ficar só com
    // a pílula — ela flutua sobre a foto e não custa altura de layout.
    const btn = document.getElementById('lightboxNomeBtn');
    btn.disabled = true;
    btn.querySelector('.lb-nome-lapis')?.classList.add('hidden');
    document.getElementById('lightboxNomeEdit').classList.remove('hidden');
    const inp = document.getElementById('lightboxNomeInput');
    inp.value = nome;
    // As ações de foto somem enquanto edita — mas quem decide é
    // `atualizarAcoesDeFoto()`, e não um esconder aqui: esconder aqui era um
    // disparo único, e a próxima troca de foto o desfazia.
    document.getElementById('imageLightbox').classList.add('editando-nome');
    atualizarAcoesDeFoto();
    inp.focus();
    // Cursor no FIM, não seleção: quem vem corrigir grafia quer ajustar, e
    // selecionar tudo faz a primeira tecla apagar o nome inteiro.
    try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { /* tipo sem seleção */ }
    atualizarBotaoSalvarNome();
}

function fecharEdicaoNome() {
    const cx = document.getElementById('lightboxNome');
    if (!cx) return;
    cx.classList.remove('editando');
    const btn = document.getElementById('lightboxNomeBtn');
    const ed = document.getElementById('lightboxNomeEdit');
    if (btn) {
        btn.disabled = false;
        btn.querySelector('.lb-nome-lapis')?.classList.remove('hidden');
    }
    if (ed) ed.classList.add('hidden');
    document.getElementById('imageLightbox').classList.remove('editando-nome');
    // Recalcula em vez de restaurar o que foi guardado: a foto pode ter mudado
    // durante a edição, e restaurar devolveria o estado da foto ERRADA.
    atualizarAcoesDeFoto();
}

function editandoNome() {
    const cx = document.getElementById('lightboxNome');
    return !!(cx && cx.classList.contains('editando'));
}

function atualizarBotaoSalvarNome() {
    const inp = document.getElementById('lightboxNomeInput');
    const ok = document.getElementById('lightboxNomeOk');
    if (!inp || !ok) return;
    const v = inp.value.trim();
    // Vazio ou igual ao atual não é renomeação. Botão morto com cara de vivo lê
    // como app quebrada, então ele fica `disabled` E esmaecido.
    ok.disabled = !v || v === String(Lightbox.place && Lightbox.place.name || '').trim();
}

function confirmarRenomear() {
    if (Treino.ativo || !podeRenomearAqui()) return;
    const inp = document.getElementById('lightboxNomeInput');
    const novo = inp ? inp.value.trim() : '';
    const place = Lightbox.place;
    const antigo = String(place.name || '').trim();
    if (!novo || novo === antigo) { fecharEdicaoNome(); return; }

    // As três escritas mexem no mesmo local: quem chega depois tem que ver o
    // resultado de quem chegou antes.
    if (renomeacaoPendente) renomeacaoPendente.enviar();
    if (aprovacaoPendente) aprovacaoPendente.enviar();
    if (exclusaoPendente) exclusaoPendente.enviar();

    fecharEdicaoNome();
    aplicarNomeNaTela(place, novo);      // retorno imediato; o envio espera

    const alvo = { place, antigo, novo };
    const semJanela = AppState.preferences.undoEnabled === false && canDisableUndo();
    if (semJanela) { enviarRenomeacao(alvo); return; }

    let saiu = false;
    const enviar = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(renomeacaoPendente && renomeacaoPendente.timer);
        renomeacaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        enviarRenomeacao(alvo);
    };
    const desfazer = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(renomeacaoPendente && renomeacaoPendente.timer);
        renomeacaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        aplicarNomeNaTela(place, antigo);
    };
    renomeacaoPendente = { timer: setTimeout(enviar, UNDO_WINDOW_MS), enviar, desfazer };
    aplicarTravaDeAcao();
    mostrarDesfazer(t('undo.renamed', { nome: novo }), () => renomeacaoPendente && renomeacaoPendente.desfazer());
}

// O nome vive em três lugares e os três têm que andar juntos, senão o card diz
// uma coisa e o lightbox outra.
function aplicarNomeNaTela(place, nome) {
    place.name = nome;
    if (Lightbox.place === place) Lightbox.placeName = nome;
    const txt = document.getElementById('lightboxNomeTxt');
    if (txt && Lightbox.place === place) txt.textContent = nome;
    const card = document.querySelector('.place-card');
    if (card && AppState.currentPlace === place) {
        const el = card.querySelector('.card-name');
        if (el) el.textContent = nome;
    }
}

async function enviarRenomeacao(alvo) {
    try {
        const r = await callWithRetry(() => API.renomearLocal(alvo.place.venueID, alvo.novo));
        if (r && r.success) return;             // sem toast de sucesso: o nome na tela já diz
        if (r && r.errorCategory === 'unauthorized') { handleUnauthorized(); return; }
        // Falhou: o nome na tela precisa VOLTAR, senão a app afirma uma gravação
        // que não houve — e o editor segue triando achando que corrigiu.
        aplicarNomeNaTela(alvo.place, alvo.antigo);
        showToast(msgDoServidor(r) || t('toast.renameFailed'), 'error');
    } catch (e) {
        aplicarNomeNaTela(alvo.place, alvo.antigo);
        showToast(t('toast.renameFailed'), 'error');
    }
}

// Banner próprio, com a MESMA aparência e o mesmo tempo do Desfazer do card —
// é a mesma ideia, e duas gramáticas pro mesmo conceito é como o editor
// descobre que a app se contradiz.
function mostrarDesfazer(mensagem, aoDesfazer) {
    removeUndoBanner();
    const container = document.getElementById('undoContainer');
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'undo-banner';
    banner.innerHTML = `
        <span>${escapeHtml(mensagem)}</span>
        <button type="button" id="undoBtn">${escapeHtml(t('undo.button'))}</button>
        <span class="undo-progress" style="animation-duration: ${UNDO_WINDOW_MS}ms" aria-hidden="true"></span>
    `;
    container.appendChild(banner);
    document.getElementById('undoBtn').addEventListener('click', () => aoDesfazer());
}

function populateCountrySelect() {
    const select = document.getElementById('filterCountry');
    const hint = document.getElementById('filterCountryHint');
    const editable = (AppState.profile && AppState.profile.editableCountryIDs) || [];
    let countries = AppState.countries;

    if (editable.length > 0) {
        const filtered = countries.filter(c => editable.includes(c.id));
        if (filtered.length > 0) {
            countries = filtered;
            hint.classList.remove('hidden');
        }
    }

    select.innerHTML = ordenarPorNome(countries).map(c =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
    ).join('');

    const current = API.getCountry();
    if (countries.some(c => c.id === current)) {
        select.value = current;
    } else if (countries.length > 0) {
        // Só ajusta o select visualmente; a persistência do país acontece no
        // Aplicar (antes, abrir o modal já trocava o país mesmo cancelando).
        select.value = countries[0].id;
    }
}

// Ordena nomes na colação do idioma ATUAL. Fica no cliente porque é o único
// lado que conhece o idioma — o servidor ordenava com 'pt-BR' cravado, aplicando
// regra portuguesa à lista de um editor francês.
//
// MEDIDO contra o Waze de verdade (248 países, cookies reais do owner), e o
// resultado corrige o que eu supunha: os nomes de país vêm SEMPRE EM INGLÊS
// ("France", "Germany", "Spain"), e o Waze ignora Accept-Language, Referer e
// ?language= nesses endpoints. Só 3 nomes têm acento (Curaçao, Côte d’Ivoire,
// Saint Barthélemy) e pt/en/es/fr os ordenam IGUAL — a ordem é idêntica nos
// quatro. Nomes de estado vêm no idioma local (Amapá, Ceará), que é o nome
// próprio deles: não há tradução a fazer.
//
// Ou seja: hoje isto não muda um pixel. Está aqui porque a decisão pertence a
// quem sabe o idioma, e porque a ordem DIVERGE em línguas de colação diferente
// (medido: sueco difere no índice 52, por causa do Å/Ä/Ö no fim do alfabeto).
// Se entrar sueco/polonês/turco, aí a ordem passa a mudar ao trocar de idioma
// com o modal aberto — e só então vale reordenar em aplicarIdioma().
function ordenarPorNome(itens) {
    const colator = new Intl.Collator(i18nLocale(), { sensitivity: 'base', numeric: true });
    return [...itens].sort((a, b) => colator.compare(String(a.name || ''), String(b.name || '')));
}

async function loadStatesIntoSelect(countryId) {
    const select = document.getElementById('filterState');
    select.innerHTML = '<option value="">' + escapeHtml(t('filters.state.all')) + '</option>';
    if (!countryId) return;

    let states = AppState.statesByCountry[countryId];
    if (!states) {
        const result = await API.listStates(countryId);
        if (result.success) {
            states = result.states || [];
            AppState.statesByCountry[countryId] = states;
        } else {
            return;
        }
    }

    for (const s of ordenarPorNome(states)) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        select.appendChild(opt);
    }
    if (AppState.filters.stateId) {
        select.value = AppState.filters.stateId;
    }
}

function populateManagedAreaSelect() {
    const select = document.getElementById('filterManagedArea');
    const areas = (AppState.profile && AppState.profile.managedAreas) || [];
    select.innerHTML = '<option value="">' + escapeHtml(t('filters.managedArea.none')) + '</option>' +
        areas.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
    if (AppState.filters.managedAreaId) select.value = AppState.filters.managedAreaId;
}

// Preenche o select de categoria a partir das categorias vistas (B5).
function populateCategorySelect() {
    const sel = document.getElementById('filterCategory');
    if (!sel) return;
    const current = (AppState.filters.categories && AppState.filters.categories[0]) || '';
    const opts = ['<option value="">' + escapeHtml(t('filters.category.all')) + '</option>'];
    for (const c of AppState.seenCategories) {
        opts.push('<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>');
    }
    sel.innerHTML = opts.join('');
    sel.value = current;
}

async function openFiltersModal() {
    const $ = id => document.getElementById(id);
    // Sempre abre na aba Filtros (uso primário do botão do header); as outras
    // abas ficam a um toque, sem "lembrar" estado velho de forma surpreendente.
    switchFilterTab('filtersTabFilters');
    renderDevModeSection();
    renderUndoGateUI();
    renderPresencaPref();
    $('filterUnreadOnly').checked = AppState.filters.unreadOnly !== false;
    document.querySelectorAll('.filter-type').forEach(cb => {
        cb.checked = AppState.filters.types.includes(cb.value);
    });
    $('filterResidential').value = AppState.filters.residential;
    $('filterRegion').value = API.getRegion();

    populateManagedAreaSelect();
    $('filterMyArea').checked = AppState.filters.myArea;
    const disabled = AppState.filters.myArea;
    $('filterCountry').disabled = disabled;
    $('filterState').disabled = disabled;
    $('filterManagedArea').disabled = disabled;

    populateCategorySelect();
    const sortSel = $('filterSort');
    if (sortSel) sortSel.value = AppState.filters.sortOrder || 'newest';
    renderHistory();

    // O modal ABRE AQUI, antes de qualquer rede. País e estado vêm do Waze e,
    // na PRIMEIRA abertura da sessão, são duas idas — MEDIDO com a app de pé:
    // o modal só aparecia aos 480ms em rede boa e aos 1337ms em rede ruim,
    // porque o `openModal` era a última linha de uma função `async`. O editor
    // tocava em Filtros e não acontecia NADA até o Waze responder duas vezes.
    // Da segunda abertura em diante era 80ms, porque as duas listas ficam em
    // cache de memória — daí a lentidão ser intermitente e difícil de nomear.
    //
    // Tudo que é síncrono já está pronto acima; só as duas listas chegam depois
    // e se preenchem sozinhas. Quem abre pra mexer em tipo, categoria, ordem ou
    // preferência não espera rede nenhuma.
    openModal('filtersModal');
    await popularPaisEstado();
}

// As duas listas que vêm do Waze. Fora do `openFiltersModal` porque ele agora
// só as AGENDA — e porque um erro aqui não pode impedir o modal de abrir.
async function popularPaisEstado() {
    const select = document.getElementById('filterCountry');
    // Enquanto não chega, o seletor diz o que está havendo em vez de ficar
    // vazio: seletor vazio parece defeito, e o editor toca de novo.
    const carregando = AppState.countries.length === 0;
    if (carregando && select) {
        select.innerHTML = `<option value="">${escapeHtml(t('filters.carregando'))}</option>`;
        select.disabled = true;
    }
    try {
        if (AppState.countries.length === 0) {
            const r = await API.listCountries();
            if (r.success) AppState.countries = r.countries;
        }
        populateCountrySelect();
        await loadStatesIntoSelect(API.getCountry());
    } finally {
        // O `myArea` marcado desabilita os três de propósito (regra de cima);
        // fora isso, devolve o seletor ao editor mesmo se a rede falhou.
        if (select) select.disabled = !!AppState.filters.myArea;
    }
}

function applyFiltersFromModal() {
    const $ = id => document.getElementById(id);

    // Valida ANTES de mutar qualquer estado: 0 tipos = sem filtro = todos os tipos
    // (inclusive REQUEST gated). Bloqueia o Aplicar com aviso.
    const selectedTypes = Array.from(document.querySelectorAll('.filter-type:checked')).map(cb => cb.value);
    if (selectedTypes.length === 0) {
        showToast(t('toast.selectAtLeastOneType'), 'error');
        return;
    }

    // Preferências (undo/dev/idioma) NÃO passam por aqui — aplicam na hora,
    // via change listeners na aba Preferências (ver setupModalListeners).
    // Este handler é só da aba Filtros.
    AppState.filters.unreadOnly = $('filterUnreadOnly').checked;
    AppState.filters.types = selectedTypes;
    // Backstop: se REQUEST entrou em selectedTypes com dev mode desligado
    // (DOM editado à mão, estado velho), sai do filtro aqui.
    enforceDevGatedFilters();
    // Segurança: se o gate esvaziou os tipos (edge: só REQUEST + dev desligado),
    // volta ao default em vez de virar "todos os tipos".
    if (AppState.filters.types.length === 0) AppState.filters.types = TYPES_PADRAO.slice();
    AppState.filters.residential = $('filterResidential').value;
    AppState.filters.stateId = $('filterState').value;
    AppState.filters.managedAreaId = $('filterManagedArea').value;
    AppState.filters.myArea = $('filterMyArea').checked;
    API.setCountry($('filterCountry').value);
    // Troca de região invalida o cache de países/estados (eram da região anterior).
    const newRegion = $('filterRegion').value;
    if (newRegion !== API.getRegion()) {
        AppState.countries = [];
        AppState.statesByCountry = {};
    }
    API.setRegion(newRegion);
    const catVal = $('filterCategory') ? $('filterCategory').value : '';
    AppState.filters.categories = catVal ? [catVal] : [];
    AppState.filters.sortOrder = ($('filterSort') && $('filterSort').value === 'oldest') ? 'oldest' : 'newest';
    saveFilters();
    closeModal('filtersModal');
    // A sala É a fila: mudou país ou estado, a companhia é outra.
    window.Presenca?.sincronizar?.();
    resetQueue();
    startFetching();
}

// Teclas que pertencem ao CURSOR quando o foco está num campo de texto.
const TECLAS_DE_CURSOR = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

function focoEmCampoDeTexto() {
    const el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    // Checkbox e botão não consomem seta; campo de texto (e range) consomem.
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(
        String(el.type || 'text').toLowerCase());
}

function handleKeyDown(e) {
    // Foco num campo de texto: as setas são do CURSOR, não da app.
    //
    // Relatado pelo owner renomeando um local: usar ← → pra corrigir uma letra
    // TROCAVA A FOTO, e o `preventDefault()` do lightbox ainda matava o
    // movimento do cursor — as duas coisas erradas de uma vez.
    //
    // A guarda já existia, mas lá embaixo, DEPOIS do bloco do lightbox — que
    // retorna antes de chegar nela. Ela nasceu pro card e o lightbox foi
    // acrescentado por cima; o buraco é a ordem, não a falta.
    //
    // Só as teclas de cursor: Esc e Tab seguem passando, porque têm significado
    // de CAMADA (fechar, navegar) e o campo do nome já trata o Esc dele.
    if (focoEmCampoDeTexto() && TECLAS_DE_CURSOR.includes(e.key)) return;

    // O mapa ampliado é a camada MAIS alta quando aberto: Esc e ↓ fecham ele
    // antes de qualquer outra coisa, como o lightbox de foto faz.
    if (typeof MapaLightbox !== 'undefined' && MapaLightbox.isOpen()) {
        if (e.key === 'Escape' || e.key === 'ArrowDown') { e.preventDefault(); MapaLightbox.close(); }
        else if (e.key === '+' || e.key === '=') { e.preventDefault(); MapaLightbox.zoom(1); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); MapaLightbox.zoom(-1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); MapaLightbox.arrastar(80, 0); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); MapaLightbox.arrastar(-80, 0); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); MapaLightbox.arrastar(0, 80); }
        return;
    }
    if (Lightbox.isOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); Lightbox.close(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); Lightbox.prev(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); Lightbox.next(); }
        // ↓ fecha, espelhando o arraste pra baixo do toque. Relato do owner:
        // aprendeu o gesto no celular, sentou no laptop e a mão foi pro ↓ —
        // o modelo mental funcionando e a app não correspondendo.
        //
        // Só BAIXO, porque é só o que o toque faz (`dy > 80`); inventar ↑ aqui
        // criaria um gesto que o celular não tem. E é caminho ADICIONAL: o Esc
        // continua sendo o principal, que é a convenção de desktop — por isso
        // a dica não muda de texto (decisão do owner: um texto só, não um
        // catatau por plataforma).
        else if (e.key === 'ArrowDown') { e.preventDefault(); Lightbox.close(); }
        return;
    }

    // Com modal aberto: Esc fecha, e as setas NÃO disparam swipe no card
    // atrás do diálogo (antes disparavam — ação destrutiva invisível).
    const openedModal = topOpenModal();
    if (openedModal) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal(openedModal.id);
        } else if (e.key === 'Tab') {
            trapTabInModal(e, openedModal);
        }
        return;
    }

    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    // Desfazer via teclado (power-user opera por teclas): z (ou Ctrl/Cmd+Z).
    if ((e.key === 'z' || e.key === 'Z') && AppState.pendingAction) {
        e.preventDefault();
        desfazerAcaoPendente();
        return;
    }

    if (!AppState.currentPlace) return;
    // As setas também respeitam a trava — senão o teclado seria um atalho pra
    // furar a janela do Desfazer que o dedo respeita.
    if (acoesTravadas() && ['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        return;
    }

    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (window.triggerSwipe) window.triggerSwipe('left', handleReject);
        else handleReject();
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (window.triggerSwipe) window.triggerSwipe('right', handleMarkAsRead);
        else handleMarkAsRead();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (window.triggerSwipe) window.triggerSwipe('up', handleSkip);
        else handleSkip();
    }
}

// Confina o Tab dentro do modal aberto — sem isso, Tab saía do diálogo e Enter
// podia disparar uma ação destrutiva no card invisível atrás (M3/HIG).
function trapTabInModal(e, modal) {
    const sel = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const list = Array.from(modal.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

function showAuthScreen() {
    // A aposta do script inline do <head> era otimista (havia token no
    // aparelho). Se chegamos aqui, ela estava errada — token vencido, logout,
    // pareamento. Tirar a marca devolve o comando às classes `hidden`, que a
    // partir do JS são a única fonte de verdade.
    document.documentElement.classList.remove('tem-sessao');
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');
    document.getElementById('filtersBtn').classList.add('hidden');
    document.getElementById('refreshBtn').classList.add('hidden');
    document.getElementById('userProfileBadge').classList.add('hidden');
    const brandTitle = document.getElementById('brandTitle');
    if (brandTitle) brandTitle.classList.remove('sr-only'); // volta visível ao deslogar
    AppState.authenticated = false;
    AppState.profile = null;
    // Deslogado não tem crachá, então não tem sala. Fecha o socket na hora em
    // vez de deixar a conexão viva com uma sessão que já não vale.
    window.Presenca?.desligar?.();
}

function showMainScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('filtersBtn').classList.remove('hidden');
    document.getElementById('refreshBtn').classList.remove('hidden');
    AppState.authenticated = true;
    updateDevBadge();
    // A sala só faz sentido logado: é o crachá do WME que abre a porta.
    window.Presenca?.sincronizar?.();
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) { e.target.value = ''; return; }
    try {
        const content = await file.text();
        await authenticateWithCookies(content);
    } catch (error) {
        showToast(t('toast.fileReadError'), 'error');
    } finally {
        e.target.value = ''; // permite re-selecionar o mesmo arquivo (dispara change)
    }
}

async function handlePasteConfirm() {
    const content = document.getElementById('cookiesTextarea').value.trim();
    if (!content) {
        showToast(t('toast.pasteEmpty'), 'error');
        return;
    }
    closeModal('pasteModal');
    await authenticateWithCookies(content);
    document.getElementById('cookiesTextarea').value = '';
}

let authInFlight = false;
async function authenticateWithCookies(cookies) {
    if (authInFlight) return;            // evita duplo-envio (criaria 2 sessões)
    authInFlight = true;
    setAuthLoading(true);
    showToast(t('toast.validatingCookies'), 'info');
    try {
        const result = await API.testCookies(cookies);
        if (result.success) {
            guardarPrazoDaSessao(result);
            showMainScreen();
            resetQueue();
            AppState._profilePromise = loadProfileAndAuxData();
            startFetching();
            showToast(t('toast.authSuccess'), 'success');
        } else if (result.errorCategory === 'access_denied') {
            showAccessDenied(result);
        } else {
            showToast(msgDoServidor(result, t('toast.invalidCookies')), 'error');
        }
    } catch (error) {
        showToast(t('toast.authError'), 'error');
    } finally {
        authInFlight = false;
        setAuthLoading(false);
    }
}

// Desabilita os botões de login enquanto valida (feedback + trava duplo-envio).
function setAuthLoading(loading) {
    ['uploadBtn', 'pasteBtn'].forEach(id => {
        const b = document.getElementById(id);
        if (b) {
            b.disabled = loading;
            b.classList.toggle('opacity-60', loading);
            b.classList.toggle('cursor-wait', loading);
        }
    });
}

function showAccessDenied(result) {
    const modal = document.getElementById('accessDeniedModal');
    const msg = document.getElementById('accessDeniedMessage');
    const profileBox = document.getElementById('accessDeniedProfile');
    msg.textContent = msgDoServidor(result, t('accessDenied.defaultMsg'));
    if (result.profile && result.profile.userName) {
        const p = result.profile;
        const displayRank = (p.rank !== null && p.rank !== undefined) ? ('L' + (p.rank + 1)) : '';
        const tags = [];
        if (displayRank) tags.push(displayRank);
        tags.push(p.isStaff ? t('profile.tag.staff') : (p.isAreaManager ? t('profile.tag.am') : t('profile.tag.notAm')));
        profileBox.innerHTML = `<strong>${escapeHtml(p.userName)}</strong> <span class="text-slate-500 dark:text-slate-400">· ${escapeHtml(tags.join(' · '))}</span>`;
        profileBox.classList.remove('hidden');
    } else {
        profileBox.classList.add('hidden');
    }
    openModal('accessDeniedModal');
}

async function loadProfileAndAuxData() {
    const [profileRes, countriesRes] = await Promise.all([
        API.getProfile(),
        API.listCountries()
    ]);
    // Se qualquer um dos dois detectar sessão expirada/revogada no Waze (401/403),
    // deslogar e mandar pra tela de auth. Sem isso o user fica preso vendo
    // "Erro ao buscar X (HTTP 403)" sem entender por quê.
    if (profileRes.errorCategory === 'unauthorized' || countriesRes.errorCategory === 'unauthorized') {
        handleUnauthorized();
        return;
    }
    if (profileRes.success) {
        AppState.profile = profileRes.profile;
        guardarPerfilDoPortao(profileRes.profile);
        guardarPrazoDaSessao(profileRes);
        renderProfileHeader();
    }
    if (countriesRes.success) {
        AppState.countries = countriesRes.countries;
    }
}

// UM 401 não é prova de que a sessão morreu — e tratar como se fosse era o
// caminho mais curto pro editor cair na tela de login sem ter pedido pra sair.
//
// Três coisas chegam aqui como 401 e só UMA delas exige entrar de novo:
//   · o Waze recusou os cookies de verdade (expiraram)           → é pra sair
//   · o Waze devolveu 403 por rajada/WAF                          → passageiro
//   · o KV devolveu vazio num blip de propagação                  → passageiro
// O core já manda chaves diferentes (`srv.err.cookiesExpired` × `sessionExpired`),
// mas nenhuma delas distingue passageiro de definitivo — só uma segunda
// chamada distingue.
//
// Então confirma antes de derrubar: espera um pouco e pergunta o perfil. Se
// responder, a sessão está viva e nada é apagado. Custa ~1s no caso em que os
// cookies morreram MESMO, e evita o logout falso no caso em que não morreram.
let verificandoSessao = false;

// Recompõe a fila depois de uma falha que NÃO era sessão morta.
//
// Existe porque `startFetching()` sozinho NÃO recompõe nada, e é isso que
// produziu a tela do owner ("Tudo limpo!" sobre 217 pedidos pendentes): a busca
// que falhou deixa `hasMore: false`, e o laço do `startFetching` é GUARDADO por
// `hasMore` — ou seja a "retentativa" não busca coisa nenhuma, só zera o
// `loadError` e desenha o painel de fila vazia. Os dois caminhos de
// recomposição (alarme falso do 401, e renovação pela extensão) chamavam
// `startFetching()` cru. O botão "Tentar novamente" nunca caiu nisto porque ele
// passa antes pelo `resetQueue`, que repõe `hasMore` — foi o que escondeu o
// defeito: testar pelo botão dava certo.
//
// `loadError` é o que distingue "a fila esvaziou por FALHA" de "a fila acabou
// de verdade". Sem essa distinção, forçar `hasMore` gastaria uma requisição a
// mais toda vez que o backlog tivesse realmente zerado — e a app roda no free
// tier, onde requisição é recurso contado.
const MAX_REBUSCAS_AUTO = 2;
let rebuscasAuto = 0;

function rebuscarDepoisDeFalha() {
    if (AppState.queue.length > 0 || AppState.fetching) return;
    // Fila vazia SEM falha: não há o que repor, e o `startFetching` vai só
    // pintar o "Tudo limpo!" — que aí é verdade.
    if (!AppState.loadError) { startFetching(); return; }
    // TETO, e ele não é preciosismo: sem isto o desenho é um laço de requisição
    // (falha → confere → alarme falso → rebusca → falha…). Estourado o teto, o
    // erro FICA na tela com o botão de tentar de novo — honesto, e quem decide
    // gastar a próxima requisição é a pessoa.
    if (rebuscasAuto >= MAX_REBUSCAS_AUTO) return;
    rebuscasAuto++;
    AppState.hasMore = true;
    startFetching();
}

// ── Diagnóstico: baixa TUDO que existe do lado do cliente ──────────────────
//
// Pedido do owner, depois de horas em que eu adivinhei o defeito do aparelho
// dele em vez de olhar. O botão vive atrás do modo dev e gera UM arquivo.
//
// DUAS COISAS QUE ELE **NÃO** CONSEGUE TRAZER, e é honesto dizer no próprio
// arquivo em vez de deixar a pessoa procurar:
//
//  1. Os cookies do WAZE. Eles são de `waze.com`, outra origem — o JavaScript
//     desta página não os enxerga, por regra do navegador, e nem existem aqui:
//     depois do login eles vivem CIFRADOS no servidor e nunca mais voltam ao
//     aparelho. O que dá pra trazer é `document.cookie` desta origem.
//  2. O corpo do que o Service Worker guardou de OUTRA origem (tiles do Waze):
//     a resposta é opaca. As URLs vêm; o conteúdo, não.
//
// O QUE ELE TRAZ, e o peso disso: o `waze_session_token` vai INTEIRO. Ele é
// credencial viva — quem tiver o arquivo pode agir na conta do Waze do dono até
// a sessão vencer, e é METADE da chave que decifra os cookies no servidor (ver
// `derivarChave`). Foi pedido assim de propósito, porque é ele que permite
// REPRODUZIR a falha em vez de teorizar. O arquivo diz isso na primeira linha,
// e o caminho de anular é sair da app, que destrói a sessão no servidor.
const DIAG_VERSAO = 1;

// JSON de coisa viva: `AppState` tem Promise, função e referência circular
// (`currentPlace` é o mesmo objeto de `queue[0]`). Sem isto o `stringify` lança
// e o arquivo sai vazio — falha silenciosa no instrumento de socorro.
function diagSeguro(v, prof = 0, vistos = new WeakSet()) {
    if (v === null || typeof v !== 'object') {
        return typeof v === 'function' ? '[função]' : v;
    }
    if (vistos.has(v)) return '[circular]';
    if (prof > 8) return '[fundo]';
    if (v instanceof Promise) return '[promise]';
    if (typeof Element !== 'undefined' && v instanceof Element) return '[elemento ' + v.tagName + ']';
    if (v instanceof Map) return { '[Map]': [...v.keys()].map(String) };
    if (v instanceof Set) return { '[Set]': [...v].map(String) };
    vistos.add(v);
    if (Array.isArray(v)) return v.map((x) => diagSeguro(x, prof + 1, vistos));
    const o = {};
    for (const k of Object.keys(v)) {
        try { o[k] = diagSeguro(v[k], prof + 1, vistos); } catch (e) { o[k] = '[erro: ' + e.message + ']'; }
    }
    return o;
}

// Erros de JS acumulados desde a carga. Armado cedo, no `initApp`.
const diagErros = [];
function diagCapturarErros() {
    addEventListener('error', (e) => {
        diagErros.push({ t: new Date().toISOString(), tipo: 'error',
            msg: String(e.message || ''), fonte: String(e.filename || ''), linha: e.lineno });
        if (diagErros.length > 50) diagErros.shift();
    });
    addEventListener('unhandledrejection', (e) => {
        diagErros.push({ t: new Date().toISOString(), tipo: 'rejeicao',
            msg: String((e.reason && e.reason.message) || e.reason || '').slice(0, 300) });
        if (diagErros.length > 50) diagErros.shift();
    });
}

async function diagCorpo() {
    const meu = location.origin;
    // Só recurso da NOSSA origem: de terceiro a resposta é opaca e a leitura
    // ainda gastaria rede. `cache: 'force-cache'` pra pegar o que o aparelho
    // REALMENTE tem — que é a pergunta quando se suspeita de PWA com código
    // velho; buscar da rede mediria o servidor, não o aparelho.
    const texto = async (url) => {
        try {
            const r = await fetch(url, { cache: 'force-cache' });
            return { http: r.status, tipo: r.headers.get('content-type'),
                     etag: r.headers.get('etag'), corpo: await r.text() };
        } catch (e) { return { erro: String((e && e.message) || e) }; }
    };

    const ls = {}, ss = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); } }
    catch (e) { ls._erro = String(e); }
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k); } }
    catch (e) { ss._erro = String(e); }

    const sw = { suportado: 'serviceWorker' in navigator,
                 controlando: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
                 registros: [] };
    try {
        for (const r of await navigator.serviceWorker.getRegistrations()) {
            sw.registros.push({ escopo: r.scope,
                ativo: r.active && r.active.scriptURL, estadoAtivo: r.active && r.active.state,
                esperando: r.waiting && r.waiting.scriptURL,
                instalando: r.installing && r.installing.scriptURL });
        }
    } catch (e) { sw.erro = String(e); }

    const cachesDoAparelho = {};
    try {
        for (const nome of await caches.keys()) {
            const c = await caches.open(nome);
            cachesDoAparelho[nome] = (await c.keys()).map((r) => r.url);
        }
    } catch (e) { cachesDoAparelho._erro = String(e); }

    // O CÓDIGO que está rodando, com o corpo. É isto que responde "o PWA está
    // com a versão velha?" — pergunta que o serial sozinho não responde, porque
    // ele só diz o que o `version.js` carregado afirma, não o que o resto é.
    const recursos = performance.getEntriesByType('resource')
        .map((r) => ({ url: r.name, tipo: r.initiatorType, ms: Math.round(r.duration),
                       bytes: r.transferSize,
                       doCache: r.transferSize === 0 && r.decodedBodySize > 0 }));
    const codigo = {};
    const nossos = [...new Set([location.href,
        ...recursos.map((r) => r.url).filter((u) => u.startsWith(meu))])];
    for (const u of nossos) codigo[u] = await texto(u);

    const idb = {};
    try { for (const d of await indexedDB.databases()) idb[d.name] = d.version; }
    catch (e) { idb._erro = String(e); }

    const c = navigator.connection || {};
    return {
        _leia_isto: 'Este arquivo contém o waze_session_token, que é CREDENCIAL VIVA da conta do Waze '
            + 'de quem gerou. Trate como senha. Pra anular: sair da app, o que destrói a sessão no '
            + 'servidor. NÃO contém os cookies do Waze — eles são de outra origem e não ficam neste aparelho.',
        _versaoDoDiag: DIAG_VERSAO,
        _gerado: new Date().toISOString(),
        app: { versao: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null,
               rotulo: typeof verLabel === 'function' ? verLabel(APP_VERSION) : null,
               url: location.href,
               idioma: typeof getLang === 'function' ? getLang() : null },
        ambiente: {
            ua: navigator.userAgent, plataforma: navigator.platform, idiomas: navigator.languages,
            online: navigator.onLine,
            conexao: { tipo: c.effectiveType, downlink: c.downlink, rtt: c.rtt, economia: c.saveData },
            standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
            tela: { w: screen.width, h: screen.height, dpr: devicePixelRatio,
                    janela: innerWidth + 'x' + innerHeight },
            fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
            escuro: matchMedia('(prefers-color-scheme: dark)').matches,
            memoria: navigator.deviceMemory, nucleos: navigator.hardwareConcurrency,
        },
        // Cookies DESTA origem. Os do Waze não estão aqui — ver o cabeçalho.
        cookiesDestaOrigem: document.cookie || '(vazio)',
        localStorage: ls,
        sessionStorage: ss,
        indexedDB: idb,
        serviceWorker: sw,
        caches: cachesDoAparelho,
        chamadas: (typeof API !== 'undefined' && API.chamadas) || [],
        recursos,
        erros: diagErros,
        appState: diagSeguro(typeof AppState !== 'undefined' ? AppState : null),
        // O HTML como está AGORA, com as classes que decidem o que aparece na
        // tela. É o que mostra qual painel estava visível no momento da queixa.
        dom: document.documentElement.outerHTML,
        codigo,
    };
}

async function baixarDiagnostico() {
    const btn = document.getElementById('diagBtn');
    if (btn) { btn.disabled = true; btn.textContent = t('filters.diag.gerando'); }
    try {
        const corpo = await diagCorpo();
        const blob = new Blob([JSON.stringify(corpo, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        // Começa com `diag-` e NÃO com `waze`: o guard do logout varre os
        // literais `waze*` do js/ procurando chave nova de armazenamento, e um
        // nome de arquivo com esse prefixo é indistinguível de uma chave pra
        // ele. Afrouxar o guard pra caber um nome bonito é o caminho errado.
        a.download = 'diag-wazeplaces-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        showToast(t('toast.diagPronto'), 'success');
    } catch (e) {
        // O instrumento de socorro NÃO pode falhar calado: se ele quebrar,
        // ninguém descobre por que o socorro não veio.
        showToast(t('toast.diagFalhou', { erro: String((e && e.message) || e).slice(0, 80) }), 'error', 9000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = t('filters.diag.btn'); }
    }
}

async function handleUnauthorized() {
    // Concorrência é o normal aqui, não a exceção: ao abrir a app saem TRÊS
    // chamadas ao Waze quase juntas (perfil, países, busca). Sem esta trava,
    // cada uma que voltasse 401 fazia sua própria verificação e seu próprio
    // toast — foi assim que o owner recebeu DOIS "Sessão expirou" empilhados.
    if (verificandoSessao || !AppState.authenticated) return;
    verificandoSessao = true;
    try {
        await new Promise((r) => setTimeout(r, VERIFICA_SESSAO_MS));
        const r = await API.getProfile();
        // Teste POSITIVO de vida, não ausência de marcador.
        //
        // Antes era `r.errorCategory !== 'unauthorized'`, o que infere "viva" de
        // NÃO encontrar um carimbo — e um 401 sem carimbo (o do nosso próprio
        // store, que não passa pelo `categorizeWazeError`) caía aqui como alarme
        // falso. A sessão morta era MANTIDA, o toast de "conexão instável"
        // aparecia a cada tentativa, e o único jeito de sair era o logout manual.
        // Foi o que aconteceu com todos os testadores no deploy da derivação de
        // chave, que invalidou as sessões existentes de uma vez.
        //
        // As três saídas agora são explícitas: respondeu → viva; disse que não
        // autoriza → morta; qualquer outra coisa (rede, 5xx, timeout) → não dá
        // pra saber, e aí NÃO se derruba ninguém, que é o que o gotcha #42 pede.
        const morta = r && (r.errorCategory === 'unauthorized'
            || r.errorKey === 'srv.err.sessionExpired'
            || r.errorKey === 'srv.err.sessionMissing'
            || r.errorKey === 'srv.err.cookiesExpired');
        if (r && !morta) {
            // Alarme falso. O pedido que falhou já foi revertido por quem o
            // chamou; aqui só recompomos o que o 401 tinha interrompido.
            if (r.success && r.profile) {
                AppState.profile = r.profile;
                guardarPerfilDoPortao(r.profile);
                renderProfileHeader();
            }
            showToast(t('toast.sessionKeptAlive'), 'info');
            rebuscarDepoisDeFalha();
            return;
        }
        // A confirmação também diz de QUAL lado falhou, e isso vira a mensagem:
        // o core já mandava chaves diferentes (`srv.err.cookiesExpired` quando o
        // Waze recusou; `srv.err.sessionExpired` quando a nossa sessão sumiu) e
        // o frontend juntava as duas numa frase só. Separar transforma a próxima
        // ocorrência em EVIDÊNCIA — dá pra saber de onde veio sem HAR nem
        // exportar cookie de novo — e ainda diz ao editor algo que ele pode
        // usar: "o Waze recusou" e "você ficou fora tempo demais" pedem cuidados
        // diferentes, mesmo que a ação seja a mesma.
        derrubarSessao(r && r.errorKey);
    } finally {
        verificandoSessao = false;
    }
}

// Chave do core → frase que o editor lê. Chave desconhecida cai na frase
// genérica de sempre: mensagem vaga é ruim, mensagem errada é pior.
const MOTIVO_DA_QUEDA = {
    'srv.err.cookiesExpired': 'toast.sessionExpired.waze',
    'srv.err.sessionExpired': 'toast.sessionExpired.local',
};

function derrubarSessao(errorKey) {
    // Cancela ação pendente: a sessão já morreu no Waze, o executor falharia e
    // mostraria "erro ao marcar" na tela de login. Cancelar reverte o stat otimista.
    if (AppState.pendingAction) {
        AppState.pendingAction.cancel();
        AppState.pendingAction = null;
    }
    removeUndoBanner();
    API.setSession(null);
    AppState.profile = null;
    AppState.authenticated = false;
    // O prazo era desta sessão, que acabou de morrer. Deixá-lo guardado faria a
    // próxima entrada nascer com a contagem da sessão ANTERIOR na tela, até a
    // primeira resposta do Waze corrigir.
    esquecerPrazoDaSessao();

    // Antes de mandar pra tela de login, PERGUNTA à extensão — em silêncio.
    //
    // A sessão da app venceu, mas o login do editor no WME quase sempre não:
    // são prazos diferentes. Quem tem a extensão renova sem sair do lugar, e a
    // fila continua na tela. Só quem não tem (ou está deslogado do WME) vê o
    // toast e cai no login — por isso o aviso é ADIADO até a extensão falhar:
    // avisar antes seria assustar quem nem ia ser interrompido.
    entrarPelaExtensao({ silencioso: true }).then((renovou) => {
        if (renovou) {
            showToast(t('toast.sessionRenewed'), 'info');
            rebuscarDepoisDeFalha();
            return;
        }
        showToast(t(MOTIVO_DA_QUEDA[errorKey] || 'toast.sessionExpired'), 'error', 9000);
        setTimeout(() => showAuthScreen(), UNAUTHORIZED_REDIRECT_MS);
    });
}

// ── A foto de perfil espera o primeiro card ──────────────────────────────
// Ela é a imagem MAIS PESADA da app e a MENOS importante: 214 KB vindos do
// Waze para aparecer com 32px no cabeçalho, e não existe variante menor
// (sondadas 5 formas de URL, todas devolvem os mesmos 218 KB). O
// `fetchpriority="low"` já a tirou da frente na fila de prioridades, mas os
// bytes continuavam disputando a banda — em 1,6 Mbps são mais de um segundo de
// cano, no exato momento em que o editor espera VER o pedido. Medido no
// relatório de produção: 213 dos 249 KB de economia de imagem eram só ela.
//
// Então ela nem começa a ser buscada antes do primeiro card estar na tela.
// Depois disso ainda espera a thread ficar ociosa — com `timeout`, porque
// página ocupada pode nunca ficar ociosa e aí o avatar nunca chegaria.
//
// A CAIXA fica reservada desde o começo (o `w-8 h-8` com fundo cinza do
// index.html), então quando a foto chega nada se move: trocar peso por
// deslocamento de layout seria péssimo negócio.
let avatarPendente = null;
let telaPronta = false;

function liberarAvatar() {
    if (!avatarPendente || !telaPronta) return;
    const url = avatarPendente;
    avatarPendente = null;
    const carregar = () => {
        const el = document.getElementById('userAvatar');
        // `authenticated` de novo aqui: entre o agendamento e o disparo cabe um
        // logout, e aí a busca sairia já na tela de entrada.
        if (el && AppState.authenticated) el.src = url;
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(carregar, { timeout: 2000 });
    else setTimeout(carregar, 800);
}

// Chamado de onde a tela DEIXA de depender da rede. Fila vazia e erro de carga
// contam: sem eles, quem abre com tudo tratado ficaria no cinza para sempre.
// Idempotente de propósito — roda a cada swipe.
function marcarTelaPronta() {
    if (telaPronta) return;
    telaPronta = true;
    liberarAvatar();
}

function renderProfileHeader() {
    const p = AppState.profile;
    if (!p) return;
    const badge = document.getElementById('userProfileBadge');
    const avatar = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    const rankEl = document.getElementById('userRank');
    if (p.profileImageUrl) {
        avatar.style.display = '';
        // Já é esta a foto? Não mexe. Esta função roda de novo a cada troca de
        // idioma, e reatribuir o `src` faz o navegador re-decodificar à toa.
        if (avatar.getAttribute('src') !== p.profileImageUrl) {
            avatarPendente = p.profileImageUrl;
            liberarAvatar();
        }
    } else {
        avatar.style.display = 'none';
    }
    nameEl.textContent = p.userName || '';
    const tags = [];
    if (p.rank !== null && p.rank !== undefined) tags.push('L' + (p.rank + 1));
    if (p.isStaff) tags.push(t('profile.tag.staff'));
    else if (p.isAreaManager) tags.push(t('profile.tag.am'));
    rankEl.textContent = tags.join(' · ');
    // Pontos/edições no tooltip do badge (feature barata; já vem do /Session).
    const pstats = [];
    if (p.totalPoints) pstats.push(t('profile.points', { n: Number(p.totalPoints).toLocaleString(i18nLocale()) }));
    if (p.totalEdits) pstats.push(t('profile.edits', { n: Number(p.totalEdits).toLocaleString(i18nLocale()) }));
    badge.title = pstats.length ? ((p.userName || '') + ' — ' + pstats.join(' · ')) : (p.userName || '');
    badge.classList.remove('hidden');
    const brandTitle = document.getElementById('brandTitle');
    // sr-only (não 'hidden'): some visualmente mas fica na árvore de a11y como h1
    // — mantém a hierarquia de headings contínua (h1 → h2 fila → h3 card).
    if (brandTitle) brandTitle.classList.add('sr-only');
}

// Sair = esquecer o user completamente. Apaga sessão, stats, filters,
// preferences, region e country deste dispositivo. Equivale a "reinstalar
// a app". Único item mantido: tema (light/dark) por ser preferência de
// dispositivo, não identidade do usuário. handleUnauthorized (cookies
// expiram pelo Waze) NÃO chama isso — preserva tudo pra próximo login.
async function handleLogout() {
    closeModal('logoutModal');
    // Cancela ação pendente ANTES de destruir a sessão: logout = esquecer tudo,
    // então descartamos (não enviamos) o swipe em buffer e evitamos o executor
    // rodando com sessão nula (que mostrava "erro ao marcar" na tela de login).
    if (AppState.pendingAction) {
        AppState.pendingAction.cancel();
        AppState.pendingAction = null;
    }
    // O token sai do armazenamento AGORA e a limpeza local acontece inteira sem
    // esperar rede nenhuma — pedir pra sair tem que ser instantâneo. A cópia
    // serve pra exclusão no servidor, que vai depois, com retentativa.
    const tokenParaApagar = API.getSession();
    API.setSession(null);
    resetQueue();
    AppState.stats = { read: 0, rejected: 0, skipped: 0 };
    AppState.filters = { types: TYPES_PADRAO.slice(), residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true };
    AppState.preferences = { undoEnabled: true, presenca: true };
    AppState.devMode = { unlocked: false, active: false };
    AppState.profile = null;
    AppState.authenticated = false;
    AppState.pendingAction = null;
    AppState.inFlightActions = 0;
    AppState.history = {};
    safeLS.remove(HISTORY_KEY); // logout = esquecer tudo (inclui histórico)
    // "Sair limpa tudo" não tem exceção que ninguém decidiu: este marcador (o
    // "Agora não" do convite de instalar) ficava pra trás só por descuido.
    safeLS.remove(CHAVE_INSTALL_DISPENSADO);
    safeLS.remove(PERFIL_GATE_KEY);   // rank do último perfil: some com o resto
    esquecerAutores();  // contagem por autor: é dado de TERCEIRO, sai primeiro
    // Fecha a conexão da sala e apaga os bloqueios: são escolhas de quem
    // entrou, não preferência do aparelho.
    window.Presenca?.esquecer?.();
    esquecerPrazoDaSessao(); // prazo da sessão do Waze: some com o resto
    avatarPendente = null;   // a próxima entrada volta a esperar o primeiro card
    telaPronta = false;
    saveStats();
    saveFilters();
    savePreferences();
    saveDevMode();
    API.setRegion('row');
    API.setCountry(30);
    removeUndoBanner();
    updateInFlightIndicator();
    updateStats();
    updateDevBadge();
    removeCurrentCardEl();
    showAuthScreen();
    showToast(t('toast.loggedOut'), 'info');

    // A exclusão no servidor é METADE da promessa do "Sair", e falhava calada
    // com a rede fora: o `_post` devolve erro em vez de lançar, então ninguém
    // ficava sabendo. Agora tenta de novo (mesma política de transiente do resto
    // da app) e, se ainda assim não for, diz o que aconteceu e o que acontece
    // depois — o blob fica órfão (a chave é o hash do token, que já foi embora)
    // e expira sozinho em até 21 dias.
    if (tokenParaApagar) {
        const saida = await callWithRetry(() => API.destroySession(tokenParaApagar));
        if (!saida || !saida.success) {
            showToast(t('toast.logoutServerFailed'), 'error', 9000);
        }
    }
}

function resetQueue() {
    // Descarrega ação no buffer de undo ANTES de zerar a fila: sem isso, a ação
    // pendente (nunca enviada ao Waze) era re-buscada e o "Desfazer" duplicava o
    // place + dobrava stats. Refresh/filtros honram o swipe (execute); logout e
    // sessão expirada cancelam a ação antes de chamar resetQueue.
    if (AppState.pendingAction) {
        AppState.pendingAction.execute();
        AppState.pendingAction = null;
    }
    removeUndoBanner();
    AppState.fetchEpoch++;              // invalida fetch em voo (descarta obsoleto)
    AppState.queue = [];
    AppState.nextPage = 1;
    AppState.hasMore = true;
    AppState.emptyPagesInRow = 0;
    // Gesto explícito (atualizar, filtro, tentar de novo) recomeça a conta.
    rebuscasAuto = 0;
    AppState.currentPlace = null;
    AppState.serverTotal = 0;
    AppState.serverBlocked = 0;
    AppState.blockedPartial = false;
    AppState.loadError = false;
    updatePendingCount();
}

function showLoading(visible) {
    document.getElementById('loadingCard').classList.toggle('hidden', !visible);
}

// Ordena a fila por data do pedido conforme AppState.filters.sortOrder. Client-side:
// o Waze devolve tudo de uma vez, então ordenar localmente é confiável (B6).
function sortQueue() {
    const asc = AppState.filters.sortOrder === 'oldest';
    AppState.queue.sort((a, b) => {
        const da = (a && a.dateAdded) || 0;
        const db = (b && b.dateAdded) || 0;
        return asc ? da - db : db - da;
    });
}

// Acumula as categorias vistas nos places carregados — fonte do filtro de categoria (B5).
function trackSeenCategories(places) {
    const set = new Set(AppState.seenCategories);
    for (const p of places) {
        if (Array.isArray(p.categories)) for (const c of p.categories) if (c) set.add(c);
    }
    AppState.seenCategories = [...set].sort((a, b) => String(a).localeCompare(String(b), i18nLocale()));
}

function fetchNextPage() {
    // Reentrância: se já há um fetch em voo, devolve a MESMA promise (não gira
    // busy-loop de microtasks — era o P0 que congelava a aba no startFetching).
    if (AppState.fetching) return AppState._fetchPromise || Promise.resolve();
    if (!AppState.hasMore) return Promise.resolve();
    if (!AppState.authenticated) return Promise.resolve();

    AppState.fetching = true;
    // Época capturada aqui: se resetQueue() rodar durante o await (refresh, troca
    // de filtro, logout), a época muda e descartamos o resultado obsoleto pra não
    // injetar places de filtros/região antigos na fila nova.
    const epoch = AppState.fetchEpoch;
    const pageToFetch = AppState.nextPage;
    const filters = {
        unreadOnly: AppState.filters.unreadOnly !== false
    };
    if (AppState.filters.types.length > 0 && AppState.filters.types.length < TYPES_ALL.length) {
        filters.types = AppState.filters.types;
    }
    if (AppState.filters.residential === 'true') filters.residential = true;
    if (AppState.filters.residential === 'false') filters.residential = false;
    if (AppState.filters.myArea && AppState.profile && AppState.profile.areas) {
        const areas = AppState.profile.areas;
        // Prefere a área de gerência (drive); cai pra qualquer área com bbox
        // (managed areas não-drive) se não houver drive — amplia o "minha área".
        const area = areas.find(a => a.type === 'drive' && a.bbox) || areas.find(a => a.bbox);
        if (area) filters.bbox = area.bbox;
    } else {
        if (AppState.filters.stateId) filters.stateId = AppState.filters.stateId;
        if (AppState.filters.managedAreaId) filters.managedAreaId = AppState.filters.managedAreaId;
    }
    if (Array.isArray(AppState.filters.categories) && AppState.filters.categories.length > 0) {
        filters.categories = AppState.filters.categories; // backend filtra server-side (core.mjs já aceita)
    }

    AppState._fetchPromise = (async () => {
        try {
            const result = await API.fetchPlaces(pageToFetch, filters);
            if (epoch !== AppState.fetchEpoch) return; // reset durante o fetch → descarta
            if (!result.success) {
                if (result.errorCategory === 'unauthorized' ||
                    (result.error && result.error.toLowerCase().includes('sess'))) {
                    AppState.hasMore = false;
                    // `loadError` TAMBÉM aqui, e a falta dele foi o defeito que o
                    // owner viu: "Tudo limpo!" sobre 217 pedidos pendentes.
                    //
                    // Este ramo confia no `handleUnauthorized` pra recompor — ou
                    // ele derruba pra tela de entrar (sessão morta), ou ele
                    // rebusca (alarme falso). Só que ele tem uma TRAVA de
                    // concorrência (`verificandoSessao`): ao abrir a app saem
                    // três chamadas quase juntas, e a segunda que chega encontra
                    // a trava fechada e volta NA HORA, sem derrubar e sem
                    // rebuscar. A rebusca do alarme falso também reentra aqui e
                    // encontra a própria trava. Em qualquer desses caminhos
                    // sobrava fila vazia + `hasMore: false` + `loadError: false`,
                    // que o `showNoPlaces` desenha como "Tudo limpo!".
                    //
                    // Marcar aqui é seguro porque quem REBUSCA limpa: o
                    // `startFetching` zera `loadError` antes de tentar. Ou seja,
                    // a flag só sobrevive quando de fato ninguém recompôs — que é
                    // exatamente quando a tela precisa dizer "Falha ao carregar"
                    // com o botão de tentar de novo.
                    //
                    // O comentário do `showNoPlaces` já dizia a intenção desde
                    // sempre ("o editor acharia que zerou o backlog"); faltava
                    // este ramo. E é o pior defeito possível pela régua do
                    // próprio projeto: "parece que acabou o trabalho" ninguém
                    // reporta — o editor fecha a app achando que terminou.
                    AppState.loadError = true;
                    handleUnauthorized();
                } else {
                    showToast(msgDoServidor(result, t('toast.loadPlacesError')), 'error');
                    AppState.loadError = true;
                    AppState.hasMore = false;
                }
                return;
            }

            AppState.hasMore = !!result.hasMore;
            AppState.nextPage++;
            // Busca que deu certo encerra a cadeia: o teto é de tentativas
            // SEGUIDAS sem sucesso, não da vida da sessão.
            rebuscasAuto = 0;
            // Esta é a chamada que se repete, então é ela que mantém o prazo em
            // dia: se o editor relogar no WME, o Waze passa a mandar um `Expires`
            // novo e o aviso some sozinho, sem a app precisar perguntar nada.
            guardarPrazoDaSessao(result);

            // D13: acumula igual ao serverTotal (uma busca pode vir em páginas).
            // Backend antigo não manda o campo → 0, e a dica simplesmente não aparece.
            AppState.serverBlocked += Number(result.blocked) || 0;

            const newPlaces = result.places || [];
            if (newPlaces.length === 0) {
                AppState.emptyPagesInRow++;
                if (AppState.emptyPagesInRow >= MAX_EMPTY_PAGES) {
                    // Desistimos com o Waze ainda dizendo hasMore → o que contamos
                    // até aqui (inclusive `blocked`) é um PISO, não o total. Sem
                    // esta flag a dica do D13 mostraria número parcial com cara de
                    // exato. Acontece de verdade: região onde o editor não pode
                    // editar nada devolve páginas cheias de bloqueados e zero cards.
                    if (result.hasMore) AppState.blockedPartial = true;
                    AppState.hasMore = false;
                }
            } else {
                AppState.emptyPagesInRow = 0;
                AppState.queue.push(...newPlaces);
                AppState.serverTotal += newPlaces.length;
                trackSeenCategories(newPlaces);
                sortQueue();
                aplicarRecusaAutomatica();
            }
        } catch (error) {
            console.error('fetchNextPage error', error);
            if (epoch === AppState.fetchEpoch) {
                showToast(t('toast.loadPlacesError'), 'error');
                AppState.loadError = true;
                AppState.hasMore = false;
            }
        } finally {
            // Sempre limpa: esta invocação é a dona da flag fetching. Sem o guard
            // de época aqui (senão fetching ficaria preso true e voltaria o freeze).
            AppState.fetching = false;
            AppState._fetchPromise = null;
            updatePendingCount();
        }
    })();
    return AppState._fetchPromise;
}

async function startFetching() {
    AppState.loadError = false;
    showLoading(true);
    document.getElementById('noMoreCards').classList.add('hidden');
    document.getElementById('loadErrorState')?.classList.add('hidden');
    removeCurrentCardEl();
    updatePendingCount();

    // "Minha área" precisa do perfil (áreas/bbox). Se ainda não chegou, espera —
    // senão o 1º fetch cai no ramo país/estado e carrega places de fora da área.
    if (AppState.filters.myArea && !(AppState.profile && AppState.profile.areas) && AppState._profilePromise) {
        try { await AppState._profilePromise; } catch (e) {}
    }

    while (AppState.queue.length === 0 && AppState.hasMore && AppState.authenticated) {
        await fetchNextPage();
    }

    showLoading(false);

    if (AppState.queue.length > 0) {
        showCurrentPlace();
        maybePrefetch();
    } else {
        showNoPlaces();
    }
}

function maybePrefetch() {
    if (AppState.queue.length <= PREFETCH_THRESHOLD && AppState.hasMore && !AppState.fetching) {
        fetchNextPage().then(() => {
            if (!AppState.currentPlace && AppState.queue.length > 0) {
                showCurrentPlace();
            }
        });
    }
}

function removeCurrentCardEl() {
    const cardStack = document.getElementById('cardStack');
    const existingCard = cardStack.querySelector('.place-card');
    if (existingCard) existingCard.remove();
}

// ── "Como funciona": uma vez, no primeiro card ────────────────────────────
// Os três botões do card só têm `aria-label` e `title` — e `title` NÃO existe no
// toque. No celular, quem nunca usou vê três círculos coloridos e adivinha. Não
// havia nada explicando em lugar nenhum da app.
//
// A alternativa era rótulo fixo sob cada botão, e ela foi medida e recusada:
// custa 20px de FOTO em todo card, pra sempre (329 → 309px no iPhone; 181 → 160
// no Fold), pra ensinar o que se aprende uma vez. Este aviso custa zero pixel
// permanente.
//
// Mora no `preferences` (que já é persistido e já é apagado no logout) de
// propósito: chave nova no localStorage exigiria decisão de logout própria e
// entraria na varredura do test/layout — e não há nada aqui que justifique uma.
function mostrarComoFuncionaSePrimeiraVez() {
    if (AppState.preferences.comoFuncionaVisto) return;
    // Só quando existe card na tela: o aviso fala dos botões DELE, e aparecer
    // sobre "Tudo limpo!" ou sobre o esqueleto de carregamento explicaria algo
    // que a pessoa não está vendo.
    if (!AppState.currentPlace || !document.querySelector('.place-card')) return;
    AppState.preferences.comoFuncionaVisto = true;
    savePreferences();
    abrirComoFunciona();
}

// Direto no `openModal`, mesmo vindo da Ajuda: ele JÁ esconde o modal anterior
// sem passar pelo `closeModal`, e só empilha histórico quando não havia nenhum
// aberto. Minha primeira versão fechava a Ajuda antes "para não empilhar" — e
// era exatamente isso que quebrava: `closeModal` CONSOME a entrada do histórico
// e o `openModal` seguinte, vendo nenhum modal aberto, empilhava outra. Medido,
// o Esc depois disso levava a `about:blank` — a pessoa saía da app inteira.
function abrirComoFunciona() {
    openModal('comoFuncionaModal');
}

// O tipo do pedido, em UMA função: o rótulo visível e o que o leitor de tela
// ANUNCIA têm que dizer a mesma coisa, no mesmo idioma. Eram duas cópias, e a
// da região viva nunca foi traduzida (ver o comentário no call site).
//
// "Reporte (Sinalização)" não diz o que foi reportado; quando é foto, o WME
// chama de "Foto sinalizada", e o card marca QUAL das fotos é.
// `updateTypeKey` é a chave crua (VENUE, IMAGE, FLAG…); o `updateType` em
// português segue vindo do core e serve de último recurso, pra chave nova
// nunca deixar o campo vazio — feio, nunca invisível.
function rotuloDoTipo(place) {
    if (!place) return '';
    if (Array.isArray(place.changes) && place.changes.length > 0) return t('card.type.update');
    if (place.flagSubjectType === 'IMAGE') return t('card.type.flagImage');
    return rotuloDeEnum('card.updateType.', place.updateTypeKey) || place.updateType || '';
}

function showCurrentPlace() {
    marcarTelaPronta();   // libera a foto de perfil (ver `liberarAvatar`)
    try {
        renderCurrentCard();
    } catch (err) {
        console.error('Erro ao montar card, pulando place:', err, AppState.queue[0]);
        if (window.showToast) {
            window.showToast(t('toast.renderCardError'), 'error');
        }
        AppState.queue.shift();
        // Place quebrado descartado conta como tratado: decrementa o total e
        // atualiza o contador (invariante do serverTotal — antes superconta).
        AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
        AppState.currentPlace = null;
        updatePendingCount();
        if (AppState.queue.length > 0) {
            setTimeout(showCurrentPlace, 0);
        } else if (AppState.hasMore) {
            startFetching();
        } else {
            showNoPlaces();
        }
        return;
    }
    // FORA do try de propósito: uma falha aqui não pode fazer o card ser tratado
    // como quebrado e o pedido ser DESCARTADO (o catch acima faz `queue.shift()`
    // e decrementa o total). O aviso é acessório; o pedido é o produto.
    try { mostrarComoFuncionaSePrimeiraVez(); } catch (e) { console.error(e); }
}

function renderCurrentCard() {
    const place = AppState.queue[0];
    if (!place) {
        AppState.currentPlace = null;
        if (AppState.hasMore) {
            showLoading(true);
            startFetching();
        } else {
            showNoPlaces();
        }
        return;
    }

    AppState.currentPlace = place;

    // Anuncia o novo card a leitor de tela (a fila avança sem foco mudar).
    const liveRegion = document.getElementById('cardLiveRegion');
    if (liveRegion) {
        liveRegion.textContent = t('card.live.newRequest', {
            name: identidadeDoPlace(place).titulo,
            // A MESMA função do rótulo visível. Aqui estava `place.updateType`
            // cru — o português que o core manda como último recurso —, então
            // quem usa leitor de tela em en/es/fr ouvia português em TODO card.
            // Não dava pra ver: região viva não aparece na tela, e por isso
            // passou por auditoria visual nenhuma.
            type: rotuloDoTipo(place) ? ', ' + rotuloDoTipo(place) : ''
        });
    }

    const template = document.getElementById('cardTemplate');
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.place-card');

    const ident = identidadeDoPlace(place);
    const elNome = card.querySelector('.card-name');
    elNome.textContent = ident.titulo;
    elNome.classList.toggle('valor-ausente', ident.ausente);
    elNome.classList.toggle('titulo-endereco', ident.tituloEhEndereco);
    // `semNome` segue verdadeiro (o local É sem nome, e outros pontos podem
    // querer saber); o que muda é MOSTRAR — ver ausenciaDeNomeEsperada.
    card.querySelector('.card-no-name-badge')
        .classList.toggle('hidden', !ident.semNome || ausenciaDeNomeEsperada(place));
    // Categoria vai CRUA, de propósito. Traduzi as mais comuns uma vez e o owner
    // reverteu com um motivo que eu não tinha: o Waze REGIONALIZA categoria por
    // país, então uma tabela fixa pt/en/es/fr está errada fora do recorte onde
    // foi medida — e "errado com cara de certo" é pior que o enum. O identificador
    // cru também é o que casa com o WME quando o editor vai conferir lá.
    // Quando aparecer a fonte de regionalização do Waze, dá pra tentar de novo.
    escreverValor(card.querySelector('.card-category'),
        place.categories && place.categories.length > 0 ? place.categories.join(', ') : '',
        'card.categories.empty');
    // Endereço que virou título não se repete embaixo: seria a mesma informação
    // duas vezes, gastando uma linha que a caixa de mudanças usa melhor.
    card.querySelector('.card-address-row').classList.toggle('hidden', ident.tituloEhEndereco);
    escreverValor(card.querySelector('.card-address'), place.address, 'card.address.empty');
    // Num UPDATE o backend monta o tipo como "Atualização: Id, Nome, Telefone…" —
    // exatamente os rótulos que a caixa "Mudanças propostas" repete logo abaixo,
    // COM os valores. Mostrar os dois era a mesma informação duas vezes, e a de
    // cima truncada. Com a lista na tela, o tipo diz só o que ela não diz.
    card.querySelector('.card-type').textContent = rotuloDoTipo(place);
    const elTipo = card.querySelector('.card-type');
    escreverValor(elTipo, elTipo.textContent, 'card.type.empty');
    escreverValor(card.querySelector('.card-creator'), place.createdBy, 'card.creator.empty');
    renderSelosDeProcedencia(card, place);
    renderFocoAutor();

    if (place.isDelete) {
        card.querySelector('.card-delete-banner').classList.remove('hidden');
        // O banner âmbar já diz "⚠ Pedido de remoção", e a linha "TIPO:" dizia a
        // MESMA frase logo abaixo — era ela que truncava: em francês, a 320px,
        // "Demande de suppression" pede 171px numa caixa de 162 e vira
        // "Demande de suppressio…". Mesma lição do UPDATE, que já não repete a
        // enumeração de campos: espaço não se acha apertando, se acha tirando
        // repetição.
        //
        // Some o RÓTULO e o TEXTO, não a linha: a idade ("há 3d") mora nela e é
        // informação de decisão num pedido de remoção. Tentei antes mover a
        // idade pra dentro do banner e não funciona — `applyI18n(card)` roda
        // depois e o banner tem `data-i18n`, que escreve textContent e apaga
        // qualquer filho anexado (gotcha #24).
        const linha = card.querySelector('.card-type-row');
        if (linha) {
            const rotulo = linha.querySelector('[data-i18n="card.type"]');
            if (rotulo) rotulo.classList.add('hidden');
            const tipo = linha.querySelector('.card-type');
            if (tipo) tipo.classList.add('hidden');
        }
    }

    if (place.isStarred) {
        card.querySelector('.card-starred').classList.remove('hidden');
    }

    const ageStr = formatRelativeTime(place.dateAdded);
    if (ageStr) {
        const ageEl = card.querySelector('.card-age');
        ageEl.textContent = ageStr;
        ageEl.title = new Date(place.dateAdded).toLocaleString(i18nLocale());
        ageEl.classList.remove('hidden');
    }

    // Reporte: o motivo (`flagType`) é a informação principal e quase sempre a
    // ÚNICA — o comentário livre vem vazio na maioria dos casos. A app só olhava
    // o comentário, então o card de reporte saía sem dizer por que o local foi
    // denunciado, enquanto o WME mostrava "Motivo da marcação: Inapropriado".
    if (place.flagType) {
        // Enum não mapeado aparece CRU, pela mesma razão do diff de mudanças:
        // esconder o motivo de uma denúncia é pior que mostrá-lo em inglês.
        let motivo = rotuloDeEnum('card.flagType.', place.flagType);
        // "Duplicado" sozinho não é um motivo: é meia frase. O WME escreve
        // "Duplicado DE <local>", e o alvo é justamente a informação que decide
        // — sem ela o editor tem que abrir o WME só pra saber de quem. O core
        // resolve o nome quando consegue (ver `resolverDuplicados`); quando não
        // consegue, fica a forma isolada, que é o que a app já mostrava.
        // Só com NOME. Alvo achado e sem nome existe, e aí a frase completa
        // sairia `Duplicado de “(local sem nome)”` — aspas em volta de
        // parênteses, que é a marca de placeholder da app: duas convenções
        // empilhadas dizendo a mesma ausência. Nesse caso o texto volta a ser o
        // de hoje e quem responde "onde" é o marcador no mapa, que continua lá.
        if (place.flagType === 'DUPLICATE' && place.duplicado && place.duplicado.nome) {
            motivo = t('card.flagDuplicateOf', { alvo: place.duplicado.nome });
        }
        // A distância vai no TEXTO e não só no mapa porque o mapa nem sempre é
        // o primeiro slide (`mapaVemPrimeiro()`): num pedido com foto o editor
        // pode decidir sem nunca deslizar até ele, e aí "onde" ficaria sem
        // resposta. É também o que separa na hora o duplicado plausível do
        // vizinho parecido — medido na fila real: 94 · 96 · 101 · 110 · 146 m.
        if (place.duplicado && Number.isFinite(place.duplicado.distM)) {
            motivo += ' · ' + formatarMetros(place.duplicado.distM);
        }
        card.querySelector('.card-flag-reason-value').textContent = motivo;
        card.querySelector('.card-flag-reason').classList.remove('hidden');
    }
    // A caixa aparece só quando HÁ texto livre — ela existe pra segurá-lo. Antes
    // ela vinha junto com o motivo e, sem texto, sobrava um retângulo rosa
    // gastando ~40px de moldura numa linha vazia. (O número que estava aqui —
    // "15 de 17 reportes" — vinha de uma amostra pequena e brasileira; medido
    // em 438 reportes de 13 países, 60% TÊM texto, e nos dois tipos mais comuns
    // passa de 86%. A caixa aparecer só com conteúdo continua certo; o que
    // estava errado era chamar o conteúdo de raro.) O malabarismo de flex que existia aqui pra ela não
    // reivindicar a sobra saiu junto: sem conteúdo, ela simplesmente não existe.
    if (place.flagComment) {
        const cx = card.querySelector('.card-flag-comment');
        const txt = card.querySelector('.card-flag-comment-text');
        txt.textContent = place.flagComment;
        cx.classList.remove('hidden');
        // O que sobra da janela se alcança ROLANDO dentro da própria caixa —
        // não há botão. O aviso de que sobra texto é a borda esmaecida, e ela
        // é armada logo abaixo por `marcarBordaRolagem`, junto com as outras
        // áreas roláveis do card.
    }

    // O ↗ do card e o ↗ da folha de leitura saem da MESMA função
    // (`linkWmeDoPedido`): eram duas montagens iguais em lugares diferentes, e
    // é assim que uma ganha um parâmetro e a outra não.
    //
    // O parâmetro venueUpdateRequest do WME espera o venueID (formato dotted
    // tipo "205522459.2055159053.3242788"), NÃO o id do venueUpdateRequest
    // (que é um UUID). Confirmado via HAR comparando URL do WME nativo.
    //
    // A URL é CANÔNICA, sem segmento de idioma (decisão do owner). Estava
    // `/pt-BR/editor`: um editor que usa a app em francês clicava no ↗ e caía
    // num WME em português. O `/editor` cru responde 200 direto (medido, sem
    // redirect HTTP) e o Waze resolve o idioma pela conta de quem abriu — que é
    // exatamente o certo, porque quem decide não somos nós.
    card.querySelector('.card-wme-link').href = linkWmeDoPedido(place, API.getRegion());

    renderCardImages(card, place);

    const brandRow = card.querySelector('.card-brand-row');
    const brandStr = (place.brand !== null && place.brand !== undefined) ? String(place.brand).trim() : '';
    if (brandStr !== '') {
        card.querySelector('.card-brand').textContent = brandStr;
        if (place.brandKnown === true) {
            card.querySelector('.card-brand-known').classList.remove('hidden');
        } else if (place.brandKnown === false) {
            card.querySelector('.card-brand-unknown').classList.remove('hidden');
        }
        brandRow.classList.remove('hidden');
    }

    renderCardChanges(card, place);

    // Botões de ação explícitos — gesto é atalho, nunca o único caminho
    // (M3/HIG). Também é o único caminho acessível a leitor de tela.
    let actionFired = false;
    const fireAction = (direction, handler) => {
        if (actionFired) return;
        actionFired = true;
        if (window.triggerSwipe) window.triggerSwipe(direction, handler);
        else handler();
    };
    card.querySelector('.card-btn-reject').addEventListener('click', () => fireAction('left', handleReject));
    card.querySelector('.card-btn-skip').addEventListener('click', () => fireAction('up', handleSkip));
    card.querySelector('.card-btn-read').addEventListener('click', () => fireAction('right', handleMarkAsRead));

    // BUG CORRIGIDO: o card é clonado de um <template>, e conteúdo de template
    // NÃO é alcançado por document.querySelectorAll — então o applyI18n() global
    // nunca via estas 25 chaves. Resultado: em inglês/espanhol o card voltava pro
    // português A CADA SWIPE (o clone traz o texto pt hardcoded do HTML).
    // Traduzir aqui, no clone, é o único ponto que pega todo card novo.
    if (typeof applyI18n === 'function') applyI18n(card);

    // O card novo nasce travado se a janela do Desfazer ainda estiver correndo
    // (o `undo` devolve o place anterior à fila e re-renderiza).
    card.classList.toggle('acoes-travadas', acoesTravadas());
    for (const cls of ['.card-btn-reject', '.card-btn-skip', '.card-btn-read']) {
        card.querySelector(cls).disabled = acoesTravadas();
    }

    // As duas ÚNICAS áreas que podem rolar (nunca as duas no mesmo card: reporte
    // é FLAG, mudanças é UPDATE). O swipe.js já não pega o gesto dentro delas.
    marcarBordaRolagem(card.querySelector('.card-changes-list'));
    marcarBordaRolagem(card.querySelector('.card-flag-comment-text'));

    // Rede de segurança: o layout acima é dimensionado pra caber sempre, mas
    // fonte gigante do sistema, zoom só-de-texto ou uma tela deitada muito baixa
    // podem estourar mesmo assim — e conteúdo cortado sem jeito de alcançar é
    // pior que perder o gesto. Quando dispara, o arraste vertical rola em vez de
    // pular (o botão ↑ nunca some) — e o esmaecido avisa que ainda tem coisa.
    marcarBordaRolagem(card.querySelector('.card-content'));
    vigiarEstouroDoConteudo(card.querySelector('.card-content'));

    // Mola na entrada (280ms). Roda enquanto o dedo já vai pro próximo gesto —
    // ninguém espera por ela. A classe sai no fim pra não sobrescrever o
    // transform do arraste (o swipe.js também tira, se você agarrar antes).
    card.classList.add('card-enter');
    card.addEventListener('animationend', () => card.classList.remove('card-enter'), { once: true });

    removeCurrentCardEl();
    document.getElementById('cardStack').appendChild(card);
    // Tira o .celebrate junto: sem isso o confete não reinicia quando a fila
    // zerar de novo (a classe ficaria pendurada do "Tudo limpo!" anterior).
    document.getElementById('noMoreCards').classList.remove('celebrate');
    document.getElementById('noMoreCards').classList.add('hidden');
    agendarAquecimento(card);
}

// Tempo máximo que o aquecimento espera a foto do card. Rede de segurança: foto
// que trava não pode cancelar o aquecimento do próximo pedido, senão o recurso
// desaparece exatamente na rede ruim, que é onde ele mais serve.
const AQUECIMENTO_ESPERA_MAX_MS = 2500;

// O aquecimento do PRÓXIMO pedido esperava zero: `prefetchNextImage()` era
// chamado na linha seguinte ao card entrar no DOM, então as fotos do próximo
// começavam no mesmo instante que a do atual.
//
// MEDIDO no relatório de produção, num pedido com 4 fotos:
//
//   2715ms   12KB  ← a foto do card (é ela o LCP)
//   2715ms   54KB  ┐
//   2715ms   79KB  ├ fotos do PRÓXIMO pedido, aquecendo junto
//   2716ms   44KB  ┘
//
// 189 KB do que ainda não é preciso disputando banda com os 12 KB que o editor
// precisa ver AGORA. Elas já iam com `fetchPriority: low`, mas prioridade
// ordena a fila, não cria banda: num link estrangulado o LCP paga na mesma.
//
// Agora o aquecimento começa quando a foto atual termina. Card sem foto (20% da
// fila medida) ou com o mapa no primeiro slide não tem o que esperar — dispara
// na hora.
function agendarAquecimento(card) {
    let disparado = false;
    const disparar = () => {
        if (disparado) return;
        disparado = true;
        prefetchNextImage();
    };
    setTimeout(disparar, AQUECIMENTO_ESPERA_MAX_MS);
    const img = card.querySelector('.card-image');
    // `complete` é true também pra <img> sem src — a checagem do src vem antes.
    if (!img || img.classList.contains('hidden') || !img.getAttribute('src') || img.complete) return disparar();
    img.addEventListener('load', disparar, { once: true });
    img.addEventListener('error', disparar, { once: true });
}

// Desenha o mini-mapa de evidência dentro do slide.
//
// Preguiçoso de propósito: só monta quando o slide aparece. Medido na fila
// real, são 2,13 tiles por card a 29–147 KB cada; baixar isso pra card que o
// editor nem chega a ver seria cobrar dele por evidência que não pediu.
//
// As cores são as MESMAS do diff — verde entra, vermelho sai. O card já ensina
// essa gramática na caixa de mudanças; inventar outra aqui obrigaria o editor a
// aprender duas.
// A caixa do mapa cresceu depois do enquadramento? Refaz.
//
// Não é caso raro: o card é flex e assenta depois do primeiro render, então a
// medida do momento do render quase sempre subestima. Girar o aparelho e mudar
// a fonte do sistema fazem o mesmo.
//
// Duas regras que vêm do gotcha #35 e não são opcionais: o callback do
// ResizeObserver só AGENDA (a escrita vai no quadro seguinte, fora do ciclo de
// entrega), e só refaz quando a caixa CRESCEU além do que o enquadramento
// cobre — encolher não abre buraco, e refazer à toa é custo por quadro pra
// sempre. Sem essas duas, isto vira o "ResizeObserver loop completed with
// undelivered notifications" na cara do editor.
function vigiarCaixaDoMapa(box, card, place) {
    if (box._roMapa) return;
    let agendado = 0;
    box._roMapa = new ResizeObserver(() => {
        if (agendado) return;
        agendado = requestAnimationFrame(() => {
            agendado = 0;
            const w = box.clientWidth, h = box.clientHeight;
            if (!w || !h) return;
            if (w <= (+box.dataset.mapaW || 0) + 0.5 && h <= (+box.dataset.mapaH || 0) + 0.5) return;
            try { renderMapa(card, place, true); } catch (e) { /* mapa nunca derruba o card */ }
        });
    });
    box._roMapa.observe(box);
}

// Os marcadores do mapa deste pedido, em ordem ESTÁVEL — é ela que casa cada
// pixel devolvido pelo `mapaMontar` com o seu marcador.
//
// FONTE ÚNICA de propósito: a mesma lista decide o enquadramento do mapinha do
// card, o do mapa ampliado e os tiles que o prefetch aquece. Ela morava
// copiada nos três, e ponto a mais num só deles não é "um marcador faltando":
// é ZOOM diferente, ou seja, o ampliado abrindo noutro enquadramento e o
// prefetch aquecendo tile que ninguém vai pedir. Mesma lição do gotcha #63.
function pontosDoMapa(place) {
    const m = place && place.mapa;
    if (!m) return [];
    const pontos = [];
    if (m.centro) pontos.push({ ll: m.centro, cls: 'mapa-atual', rot: m.proposto ? 'card.map.antes' : 'card.map.aqui' });
    if (m.proposto) pontos.push({ ll: m.proposto, cls: 'mapa-proposto', rot: 'card.map.depois' });
    for (const e of m.entradas || []) {
        pontos.push({
            ll: e.ll, nome: e.nome,
            cls: 'mapa-entrada mapa-e-' + e.estado,
            rot: 'card.map.entrada.' + e.estado,
        });
    }
    // O "onde" do duplicado. O nome responde DE QUEM; o marcador responde ONDE
    // — e ONDE é o que decide se são de fato o mesmo lugar. Medido na fila
    // real: 94 · 96 · 101 · 110 · 146 m. Nessa faixa o `mapaMontar` já escolhe
    // sozinho o zoom que cabe, sem caso especial aqui.
    if (place.duplicado && place.duplicado.ll) {
        pontos.push({
            ll: place.duplicado.ll,
            nome: place.duplicado.nome,
            cls: 'mapa-duplicado',
            rot: 'card.map.duplicado',
        });
    }
    return pontos;
}

function renderMapa(card, place, refazendo) {
    const box = card.querySelector('.card-map');
    if (!box || !place.mapa || (box.dataset.pronto === '1' && !refazendo)) return !!(box && place.mapa);
    const m = place.mapa;

    const pontos = pontosDoMapa(place);
    // A caixa é medida AGORA, e o enquadramento vale só pra este tamanho: os
    // tiles são enumerados pra cobrir exatamente `larguraPx × alturaPx`. Se a
    // caixa crescer depois — e ela cresce, porque o card é flex e assenta
    // depois do primeiro render —, a faixa nova fica SEM tile. Medido: caixa
    // de 359×329 recebendo o enquadramento de uma caixa mais baixa, um tile só
    // em `top:-248px` cobrindo até y=264, e 65px de nada embaixo. Guardar as
    // dimensões usadas é o que deixa o observer lá embaixo decidir se refaz.
    const larguraCaixa = box.clientWidth || 400;
    const alturaCaixa = box.clientHeight || 240;
    const r = window.mapaMontar
        ? mapaMontar(pontos.map((p) => p.ll), larguraCaixa, alturaCaixa, API.getRegion())
        : null;
    if (!r) return false;
    box.dataset.mapaW = String(larguraCaixa);
    box.dataset.mapaH = String(alturaCaixa);
    vigiarCaixaDoMapa(box, card, place);

    const tiles = box.querySelector('.card-map-tiles');
    const marks = box.querySelector('.card-map-marks');
    tiles.textContent = '';
    marks.textContent = '';
    for (const t of r.tiles) {
        const im = new Image();
        im.src = t.url;
        im.alt = '';
        im.decoding = 'async';
        im.className = 'absolute mapa-tile';
        im.style.cssText = `left:${t.left}px;top:${t.top}px;width:${r.tamanho}px;height:${r.tamanho}px`;
        // Tile que não vem não pode deixar um alt quebrado no meio do mapa.
        im.onerror = () => im.remove();
        tiles.appendChild(im);
    }
    // Linha do movimento: sem ela, dois pontos próximos parecem dois locais
    // diferentes em vez de um que andou.
    if (m.proposto && m.centro && r.pixels.length >= 2) {
        const [a, b] = r.pixels;
        const linha = document.createElement('div');
        linha.className = 'mapa-linha';
        const dx = b.left - a.left, dy = b.top - a.top;
        linha.style.cssText = `left:${a.left}px;top:${a.top}px;width:${Math.hypot(dx, dy)}px;`
            + `transform:rotate(${Math.atan2(dy, dx)}rad)`;
        marks.appendChild(linha);
    }
    r.pixels.forEach((px, i) => {
        const p = pontos[i];
        const el = document.createElement('span');
        el.className = 'mapa-marca ' + p.cls;
        el.style.cssText = `left:${px.left}px;top:${px.top}px`;
        el.title = p.nome ? `${t(p.rot)} — ${p.nome}` : t(p.rot);
        marks.appendChild(el);
    });
    // O que não coube em zoom NENHUM vira frase, não marcador escondido.
    // Acontece de verdade: há pedidos propondo mover um local dezenas de
    // quilômetros, e é justamente o card em que a evidência decide sozinha.
    // Sem isto o mapa mostrava um ponto só e calava sobre o outro — o editor
    // concluiria que nada mudou de lugar.
    if (r.foraDoMapa && r.foraDoMapa.length) {
        const aviso = document.createElement('span');
        aviso.className = 'mapa-fora';
        // Duas frases, não uma com buraco: quando o que ficou de fora é um
        // PONTO DE ENTRADA (e não a geometria), não há distância medida pra
        // pôr, e "está a muito longe" é agramatical em português.
        aviso.textContent = m.movidoM
            ? t('card.map.foraDoMapa', { d: formatarMetros(m.movidoM) })
            : t('card.map.foraDoMapa.semDist');
        marks.appendChild(aviso);
    }

    // Escala: sem ela o mapa mente sobre distância, porque o zoom muda de card
    // pra card conforme o que precisa caber.
    const alvo = 64;
    const metros = alvo * r.metrosPorPixel;
    const bonito = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].reduce(
        (a, b) => (Math.abs(b - metros) < Math.abs(a - metros) ? b : a));
    const esc = box.querySelector('.card-map-scale');
    esc.style.width = Math.round(bonito / r.metrosPorPixel) + 'px';
    esc.textContent = bonito >= 1000
        ? t('card.map.km', { n: (bonito / 1000).toLocaleString(i18nLocale()) })
        : t('card.map.m', { n: bonito });

    // Legenda: o marcador sozinho não diz qual é qual, e cor não pode ser o
    // único canal de informação (WCAG 1.4.1).
    const leg = box.querySelector('.card-map-legend');
    leg.textContent = '';
    const jaPos = new Set();
    // Só o que foi DESENHADO entra na legenda: prometer um marcador que não
    // está na tela faz o editor procurar o que não existe.
    const fora = new Set(r.foraDoMapa || []);
    for (const [i, p] of pontos.entries()) {
        if (fora.has(i)) continue;
        if (jaPos.has(p.rot)) continue;
        jaPos.add(p.rot);
        const s = document.createElement('span');
        s.className = 'mapa-leg';
        const pt = document.createElement('span');
        pt.className = 'mapa-marca ' + p.cls;
        s.appendChild(pt);
        s.appendChild(document.createTextNode(t(p.rot)));
        leg.appendChild(s);
    }
    // Clicar amplia — o mesmo gesto da foto, que é o que os testadores
    // pediram. `once` porque `renderMapa` só monta uma vez por card.
    box.style.cursor = 'zoom-in';
    box.addEventListener('click', (ev) => {
        if (ev.target.closest('button')) return;   // as setas do carrossel não
        ev.stopPropagation(); ev.preventDefault();
        MapaLightbox.open(place);
    }, { once: false });
    box.dataset.pronto = '1';
    return true;
}

// ── Mapa AMPLIADO: arrastar, zoom, e tiles buscados conforme navega ──────
//
// O mapinha do card responde "onde é isto"; este responde "e o que tem em
// volta?" — pedido dos testadores. A diferença não é de tamanho: ampliar foto
// estica uma imagem que já está em mãos, enquanto aqui arrastar e dar zoom
// BUSCA tiles novos. Fazer o barato (esticar o que o card já baixou) daria
// zoom borrado e arrasto que não revela nada: entregaria o gesto e frustraria
// a expectativa, que é pior que não ter.
//
// Sem biblioteca, como o resto. A matemática mora em `js/mapa.js` (`mapaGrade`,
// com `projetar`/`desprojetar`), e aqui fica só gesto e DOM.
const MapaLightbox = {
    centro: null, z: 16, pontos: [], _tiles: new Map(), _inicial: null,
    isOpen() { return !document.getElementById('mapaLightbox').classList.contains('hidden'); },

    open(place) {
        if (!place || !place.mapa || !window.mapaGrade) return;
        this.pontos = pontosDoMapa(place);
        if (!this.pontos.length) return;

        const el = document.getElementById('mapaLightbox');
        // Abre no MESMO enquadramento do card: a pessoa clicou no que estava
        // vendo, e o mapa saltar pra outro lugar quebraria a continuidade.
        const r = mapaMontar(this.pontos.map((p) => p.ll), innerWidth, innerHeight, API.getRegion());
        this.z = r ? r.z : 16;
        const lls = this.pontos.map((p) => p.ll);
        this.centro = [ (Math.min(...lls.map((l) => l[0])) + Math.max(...lls.map((l) => l[0]))) / 2,
                        (Math.min(...lls.map((l) => l[1])) + Math.max(...lls.map((l) => l[1]))) / 2 ];
        this._inicial = { centro: this.centro.slice(), z: this.z };
        this._tiles.clear();
        document.getElementById('mapaLbTiles').textContent = '';
        CamadaVoltar.empilhar();
        el.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        const fechar = document.getElementById('mapaLbClose');
        if (fechar) fechar.focus();
        this.desenhar();
    },

    close(viaHistorico) {
        const el = document.getElementById('mapaLightbox');
        if (el.classList.contains('hidden')) return;
        el.classList.add('hidden');
        document.body.style.overflow = '';
        // Consome a entrada de histórico quando NÃO foi o voltar que fechou —
        // sem isso sobra entrada morta e o próximo voltar não faz nada, a
        // pessoa aperta de novo e sai da app (a mesma regra do lightbox).
        if (!viaHistorico) CamadaVoltar.consumir();
    },

    // Redesenha a grade. Tiles já baixados são REAPROVEITADOS (mapa por chave
    // z/x/y): sem isso, arrastar 10px refazia o DOM e piscava a tela inteira.
    desenhar() {
        const el = document.getElementById('mapaLightbox');
        const w = el.clientWidth || innerWidth;
        const h = el.clientHeight || innerHeight;
        const g = mapaGrade(this.centro, this.z, w, h, API.getRegion());
        this.z = g.z;
        const caixa = document.getElementById('mapaLbTiles');
        const vivos = new Set();
        for (const t of g.tiles) {
            vivos.add(t.chave);
            let im = this._tiles.get(t.chave);
            if (!im) {
                im = new Image();
                im.src = t.url; im.alt = ''; im.decoding = 'async';
                im.className = 'absolute mapa-tile';
                im.style.width = im.style.height = g.tamanho + 'px';
                im.onerror = () => { im.remove(); this._tiles.delete(t.chave); };
                this._tiles.set(t.chave, im);
                caixa.appendChild(im);
            }
            im.style.left = t.left + 'px';
            im.style.top = t.top + 'px';
        }
        // Tile que saiu de vista sai do DOM: navegar bastante encheria a página
        // de <img> invisível, e aí o custo vira memória em vez de rede.
        for (const [k, im] of this._tiles) {
            if (!vivos.has(k)) { im.remove(); this._tiles.delete(k); }
        }
        this.desenharMarcas(g);
    },

    desenharMarcas(g) {
        const marks = document.getElementById('mapaLbMarks');
        marks.textContent = '';
        const px = this.pontos.map((p) => g.projetar(p.ll));
        // Linha do movimento: mesma gramática do card (verde entra, tracejada
        // porque é trajeto proposto e não feição do mapa).
        if (this.pontos.length >= 2 && this.pontos[1].cls === 'mapa-proposto') {
            const [a, b] = px;
            const linha = document.createElement('div');
            linha.className = 'mapa-linha';
            const dx = b.left - a.left, dy = b.top - a.top;
            linha.style.cssText = `left:${a.left}px;top:${a.top}px;width:${Math.hypot(dx, dy)}px;`
                + `transform:rotate(${Math.atan2(dy, dx)}rad)`;
            marks.appendChild(linha);
        }
        this.pontos.forEach((p, i) => {
            const e = document.createElement('span');
            e.className = 'mapa-marca ' + p.cls;
            e.style.cssText = `left:${px[i].left}px;top:${px[i].top}px`;
            e.title = p.nome ? `${t(p.rot)} — ${p.nome}` : t(p.rot);
            marks.appendChild(e);
        });
        const alvo = 96;
        const metros = alvo * g.metrosPorPixel;
        const bonito = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]
            .reduce((a, b) => (Math.abs(b - metros) < Math.abs(a - metros) ? b : a));
        const esc = document.getElementById('mapaLbEscala');
        esc.style.width = Math.round(bonito / g.metrosPorPixel) + 'px';
        esc.textContent = bonito >= 1000
            ? t('card.map.km', { n: (bonito / 1000).toLocaleString(i18nLocale()) })
            : t('card.map.m', { n: bonito });
        const leg = document.getElementById('mapaLbLegenda');
        leg.textContent = '';
        const ja = new Set();
        for (const p of this.pontos) {
            if (ja.has(p.rot)) continue;
            ja.add(p.rot);
            const sp = document.createElement('span');
            sp.className = 'mapa-leg';
            const pt = document.createElement('span');
            pt.className = 'mapa-marca ' + p.cls;
            sp.appendChild(pt);
            sp.appendChild(document.createTextNode(t(p.rot)));
            leg.appendChild(sp);
        }
    },

    // Arrastar: converte o deslocamento em pixels para uma coordenada nova, via
    // `desprojetar`. Ir pelo pixel e não por "graus por pixel" mantém a conta
    // correta em qualquer latitude e qualquer zoom.
    arrastar(dxPx, dyPx) {
        const el = document.getElementById('mapaLightbox');
        const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
        const g = mapaGrade(this.centro, this.z, w, h, API.getRegion());
        this.centro = g.desprojetar(w / 2 - dxPx, h / 2 - dyPx);
        this.desenhar();
    },

    // Zoom mantendo FIXO o ponto sob o dedo (ou o centro, se não houver foco).
    // Sem isso, dar zoom no que interessa manda o alvo pra fora da tela.
    zoom(delta, focoX, focoY) {
        const el = document.getElementById('mapaLightbox');
        const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
        const fx = focoX === undefined ? w / 2 : focoX;
        const fy = focoY === undefined ? h / 2 : focoY;
        const g0 = mapaGrade(this.centro, this.z, w, h, API.getRegion());
        const alvoLL = g0.desprojetar(fx, fy);
        const zNovo = Math.max(MAPA_Z_NAV_MIN, Math.min(MAPA_Z_NAV_MAX, Math.round(this.z + delta)));
        if (zNovo === this.z) return;
        this.z = zNovo;
        const g1 = mapaGrade(alvoLL, this.z, w, h, API.getRegion());
        // Onde o alvo caiu com o centro provisório? Corrige o centro pela sobra.
        const p = g1.projetar(alvoLL);
        this.centro = g1.desprojetar(p.left + (w / 2 - fx), p.top + (h / 2 - fy));
        this.desenhar();
    },

    recentrar() {
        if (!this._inicial) return;
        this.centro = this._inicial.centro.slice();
        this.z = this._inicial.z;
        this.desenhar();
    },
};

// Renderiza a imagem/carrossel do card (extraído de renderCurrentCard — A1).
function renderCardImages(card, place) {
    const img = card.querySelector('.card-image');
    const noImg = card.querySelector('.card-no-image');
    const imgNav = card.querySelector('.card-image-nav');
    const imgCount = card.querySelector('.card-image-count');
    const imgPrev = card.querySelector('.card-image-prev');
    const imgNext = card.querySelector('.card-image-next');
    const newBadge = card.querySelector('.card-image-new-badge');
    const newBorder = card.querySelector('.card-image-new-border');
    const urls = place.imageUrls && place.imageUrls.length > 0
        ? place.imageUrls
        : (place.imageUrl ? [place.imageUrl] : []);

    // O mapa é mais um SLIDE do carrossel — nunca uma linha nova no card, que
    // acabou de ser espremido até caber. Ele vem PRIMEIRO quando é a evidência
    // principal (o pedido mexe em posição, ou não há foto nenhuma pra olhar) e
    // por último quando a foto é que responde a pergunta.
    const temMapa = !!place.mapa;
    const mapaPrimeiro = mapaVemPrimeiro(place);
    const slides = urls.map((u) => ({ foto: u }));
    if (temMapa) slides.splice(mapaPrimeiro ? 0 : slides.length, 0, { mapa: true });
    const idxMapa = temMapa ? (mapaPrimeiro ? 0 : slides.length - 1) : -1;

    if (slides.length === 0) {
        img.classList.add('hidden');
        noImg.classList.remove('hidden');
        return;
    }

    // Um card é UM updateRequest: ou PROPÕE foto nova (✨ âmbar) ou DENUNCIA uma
    // existente (🚩 rosa) — nunca os dois. Daí um marcador só, com dois estados.
    //
    // NUM LOCAL NOVO O SELO NÃO APARECE, e isso é deliberado. O owner reparou e
    // perguntou: se o local é novo, a foto também é — não deveria vir marcada?
    // Tecnicamente sim, e a ausência do selo chega a ser uma meia-mentira. Mas
    // medido na fila real: dos 86 fotos em locais novos, 86 estão NÃO aprovadas
    // e ZERO aprovadas — é impossível um local novo ter foto que já esteja no
    // mapa. O selo apareceria em 100% desses cards, e selo que nunca varia não
    // é selo: é decoração. Pior, local novo é o tipo mais comum da fila (140 de
    // 295), então o editor veria ✨ o tempo todo e ele pararia de significar
    // algo justamente onde discrimina — no pedido de FOTO, em que uma entre
    // quatro é a nova. E o contexto já desambigua: a linha `Tipo: Novo local`
    // diz que tudo ali é novo. Decisão do owner depois da medição.
    // O vínculo com a foto denunciada é o `flagEntityID`, que bate exatamente com
    // `venue.images[].id` (confirmado no HAR do "Ponto de Mergulho"). Sem ele o
    // editor via 4 fotos e nenhuma pista de qual tinha sido reportada.
    const idxPorId = (id) => (id ? urls.findIndex(u => u.indexOf(id) !== -1) : -1);
    const denunciadaIdx = idxPorId(place.flagEntityID);
    const eDenuncia = denunciadaIdx >= 0;
    const newImageIdx = eDenuncia ? denunciadaIdx : idxPorId(place.updateRequestID);
    newBadge.textContent = eDenuncia ? '🚩' : '✨';
    // Via atributo, não via .title: o applyI18n() roda DEPOIS deste render e
    // sobrescreveria um title escrito na mão.
    newBadge.setAttribute('data-i18n-title', eDenuncia ? 'card.flaggedPhoto.title' : 'card.newPhoto.title');
    newBorder.classList.toggle('ring-amber-400', !eDenuncia);
    newBorder.classList.toggle('ring-rose-500', eDenuncia);
    let currentImgIdx = newImageIdx >= 0 ? newImageIdx : 0;

    // O índice do carrossel agora anda pelos SLIDES; a foto tem o seu próprio,
    // porque `newImageIdx` e o lightbox falam em posição na lista de FOTOS.
    let slideIdx = 0;
    const mapaBox = card.querySelector('.card-map');
    const updateImage = () => {
        const s = slides[slideIdx];
        imgCount.textContent = `${slideIdx + 1} / ${slides.length}`;
        if (s.mapa) {
            img.classList.add('hidden');
            noImg.classList.add('hidden');
            newBadge.classList.add('hidden');
            newBorder.classList.add('hidden');
            mapaBox.classList.remove('hidden');
            // Só aqui o tile é pedido: slide que ninguém abriu não custa rede.
            if (!renderMapa(card, place)) mapaBox.classList.add('hidden');
            return;
        }
        if (mapaBox) mapaBox.classList.add('hidden');
        currentImgIdx = urls.indexOf(s.foto);
        // A foto do card é o LCP da app, e o Lighthouse aponta que ela chega sem
        // dica de prioridade (`priorityHinted: false`). Pré-carregar não dá — a
        // URL só existe depois da resposta da API —, mas dizer que ela é a mais
        // importante da página, dá. Faz par com o `fetchpriority="low"` do
        // avatar: os dois juntos é que tiram os 214 KB da foto de perfil da
        // frente dos ~50 KB que o editor precisa VER pra decidir.
        img.fetchPriority = 'high';
        img.src = s.foto;
        // Num LOCAL NOVO toda foto está sendo proposta junto com o local — e o
        // card não põe o ✨ nelas de propósito (ver a nota longa acima: o selo
        // ficaria sempre ligado e perderia sentido onde ele decide algo). Mas a
        // informação não pode simplesmente sumir: quem usa leitor de tela ou
        // passa o mouse ouve/lê aqui, sem custar um pixel na tela nem competir
        // com o selo real. Foi a saída que o owner escolheu depois de a medição
        // mostrar que o selo visível não pagava.
        const propostaComOLocal = place.purType === 'NEW_PLACE' || place.reqType === 'VENUE';
        img.alt = t(propostaComOLocal ? 'card.img.altNovoLocal' : 'card.img.alt',
            { name: identidadeDoPlace(place).titulo, i: currentImgIdx + 1, n: urls.length });
        img.title = propostaComOLocal ? t('card.img.novoLocal.title') : '';
        img.classList.remove('hidden');
        noImg.classList.add('hidden');
        const isNew = currentImgIdx === newImageIdx;
        newBadge.classList.toggle('hidden', !isNew);
        newBorder.classList.toggle('hidden', !isNew);
    };
    slideIdx = idxMapa === 0 ? 0 : slides.findIndex((s) => s.foto === urls[currentImgIdx]);
    if (slideIdx < 0) slideIdx = 0;
    img.classList.add('cursor-zoom-in');
    img.decoding = 'async';
    // Foto quebrada (404 do Waze) → cai pro placeholder "Sem Imagem".
    img.onerror = () => { img.classList.add('hidden'); noImg.classList.remove('hidden'); };
    updateImage();

    img.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openLightbox(urls, currentImgIdx, newImageIdx, place.name, eDenuncia, place);
    });

    if (slides.length > 1) {
        imgNav.classList.remove('hidden');
        const anda = (d) => (e) => {
            e.stopPropagation();
            e.preventDefault();
            slideIdx = (slideIdx + d + slides.length) % slides.length;
            updateImage();
        };
        imgPrev.addEventListener('click', anda(-1));
        imgNext.addEventListener('click', anda(1));
    }
}

// Renderiza o diff de mudanças propostas (extraído de renderCurrentCard — A1).
// Distância que o ponto andou, no formato de quem está lendo. Abaixo de 1m o
// número inteiro esconde a informação ("0 m" não diz nada), então vai com uma
// casa; acima de 1km metro não importa mais.
function formatarDistancia(m) {
    if (!Number.isFinite(m)) return '';
    const loc = i18nLocale();
    if (m < 1) return t('card.change.movedM', { d: m.toLocaleString(loc, { maximumFractionDigits: 1 }) });
    if (m < 1000) return t('card.change.movedM', { d: Math.round(m).toLocaleString(loc) });
    return t('card.change.movedKm', { d: (m / 1000).toLocaleString(loc, { maximumFractionDigits: 1 }) });
}

// A mesma distância SEM o verbo. `formatarDistancia` diz "moveu 36 m", que é a
// frase certa pra geometria e errada pra qualquer outra coisa — reusá-la no
// ponto de entrada produziu "a MOVEU 16,3 km do local". Número e frase são
// coisas separadas; quem monta a frase escolhe o verbo.
function formatarMetros(m) {
    if (!Number.isFinite(m)) return '';
    const loc = i18nLocale();
    if (m < 1000) {
        return t('card.map.m', { n: (m < 1 ? m.toLocaleString(loc, { maximumFractionDigits: 1 })
                                          : Math.round(m).toLocaleString(loc)) });
    }
    return t('card.map.km', { n: (m / 1000).toLocaleString(loc, { maximumFractionDigits: 1 }) });
}

// Valor de lista: enum do Waze quando conhecemos, cru quando não. Objeto (um
// entryExitPoint, por exemplo) vira resumo curto em vez de JSON na cara.
// Nomes de dia SEM dicionário: o Intl já sabe em toda língua, e uma tabela de
// 7 dias × 4 idiomas seria 28 strings pra manter em paridade sem ganho nenhum.
// 2024-01-07 é um domingo, que é o dia 0 do Waze.
function nomeDoDia(d) {
    try {
        return new Date(Date.UTC(2024, 0, 7 + Number(d)))
            .toLocaleDateString(i18nLocale(), { weekday: 'short', timeZone: 'UTC' });
    } catch (e) { return String(d); }
}

// Item de lista sem conteúdo. O Waze manda isso de verdade: medido na fila
// real, um pedido do "Posto Equador" propunha `services: [""]` — um array com
// uma string vazia. O card mostrava `Serviços: +` e mais nada, que lê como app
// quebrada, não como "estão adicionando um item vazio".
function itemDeListaAusente(v) {
    return v === null || v === undefined || v === '';
}

// UM renderizador de item de lista, usado pelo campo de lista de topo E pela
// folha de objeto que é lista. Eram dois trechos idênticos copiados, que é
// exatamente como duas telas do mesmo conceito divergem sem ninguém notar.
// Valor ausente leva `.valor-ausente` como qualquer placeholder do card — e o
// smoke mede o contraste dele nos dois temas a cada PR.
function itemDeLista(v, cls, sinal, campo) {
    const txt = escapeHtml(valorDeLista(v, campo));
    const corpo = itemDeListaAusente(v) ? `<span class="valor-ausente">${txt}</span>` : txt;
    return `<span class="${cls}"><span aria-hidden="true">${sinal}</span> ${corpo}</span>`;
}

function valorDeLista(v, campo) {
    // MESMO placeholder do resto do card (`valorDoDiff` já fazia isto). Os
    // parênteses não são enfeite: resolvem a ambiguidade de um valor que
    // poderia se chamar "vazio", e são TEXTO, então leitor de tela lê.
    if (itemDeListaAusente(v)) return t('card.value.empty');
    if (v && typeof v === 'object') {
        // Ponto de entrada/saída: DISTÂNCIA até o local, não coordenada.
        //
        // `+ entrada -23.50382, -46.84458` é exato e injulgável — o editor não
        // tem como saber se aquilo fica na calçada ou na cidade vizinha. Medido
        // na fila de 12 países: a mediana é 29 m (plausível), mas há pedidos
        // propondo entrada a 16 e a 82 QUILÔMETROS do próprio local, e em
        // coordenada isso passava batido. Mesma lição do `geometry`, que já
        // virou "moveu 36 m". O nome fica quando existe: é por ele que o editor
        // reconhece o ponto ao abrir o WME.
        const p = v.point && v.point.coordinates;
        if (Array.isArray(p) && p.length >= 2) {
            const tipo = v.entry === false ? t('card.eep.exit') : t('card.eep.entry');
            const nome = String(v.name || '').trim();
            const centro = AppState.currentPlace && AppState.currentPlace.mapa
                && AppState.currentPlace.mapa.centro;
            if (centro) {
                const dLat = (p[1] - centro[0]) * 111320;
                const dLon = (p[0] - centro[1]) * 111320 * Math.cos(centro[0] * Math.PI / 180);
                const d = Math.sqrt(dLat * dLat + dLon * dLon);
                return `${nome ? nome + ' · ' : ''}${tipo} ${t('card.eep.aDistancia', { d: formatarMetros(d) })}`;
            }
            // Sem posição do local não há distância a calcular — aí a
            // coordenada volta, porque sumir com o dado é pior que ser cru.
            return `${nome ? nome + ' · ' : ''}${tipo} ${Number(p[1]).toFixed(5)}, ${Number(p[0]).toFixed(5)}`;
        }
        // Horário de funcionamento: vinha como JSON cru na tela (medido na fila
        // real). 7 dias vira "todos os dias" em vez de enfileirar a semana.
        if (Array.isArray(v.days) && v.fromHour !== undefined) {
            const dias = v.days.length >= 7 ? t('card.oh.everyday') : v.days.map(nomeDoDia).join(', ');
            return `${dias} · ${v.fromHour}–${v.toHour}`;
        }
        // Objeto que a app não conhece: em vez de JSON cru, `chave valor` com
        // separador. Nenhuma chave e nenhum valor somem — a regra continua
        // sendo "feio, nunca invisível" — mas sem chaves, aspas e vírgulas, que
        // é o que fazia o editor pular a linha inteira. Medido no
        // `chargingPorts` de um eletroposto: 152 caracteres de JSON viravam
        // uma linha que ninguém lia.
        return objetoLegivel(v);
    }
    // Item de lista sai CRU. Aqui passava por `rotuloDeEnum('card.enum.', …)`,
    // que nunca teve UMA chave no dicionário — era um mecanismo de tradução
    // vazio, então TUDO caía no `humanizarEnum`, que faz lowercase. Três danos,
    // medidos na fila real:
    //
    //   · CATEGORIA humanizada, contra a decisão do owner de mostrá-la crua
    //     (o Waze regionaliza categoria por país). O MESMO card mostrava
    //     `NATURAL_FEATURES` no topo e `Natural features` no diff — o mesmo
    //     conceito com dois nomes na mesma tela.
    //   · `aliases` é NOME PRÓPRIO, não enum: "Escola Estadual Leovegildo de
    //     Melo" virava "Escola estadual leovegildo de melo".
    //   · `externalProviderIDs` é ID opaco do Google: `ChIJfYn3umKwnZMRWQEl…`
    //     virava `Chijfyn3umkwnzmrwqel…` — deixa de ser o ID. Quem copiasse da
    //     tela colaria um valor que não existe.
    //
    // O `rotuloDeEnum` continua onde ele tem dicionário de verdade (updateType,
    // flagType, source) — lá humanizar é fallback de enum não mapeado, não a
    // regra. Se um dia houver fonte de regionalização do Waze, o lugar de
    // traduzir categoria é essa fonte, não uma humanização mecânica.
    //
    // ÚNICA exceção: `services`, e ela é por CAMPO, nunca genérica. O
    // dicionário veio do Transifex do Waze e serviço é comodidade genérica —
    // "ar-condicionado" é ar-condicionado em qualquer país. Categoria não entra
    // aqui porque o Waze a regionaliza POR PAÍS; apelido e ID do Google também
    // não, porque não são enum coisa nenhuma. Chave que faltar cai no valor
    // cru, como todo o resto: feio, nunca invisível.
    if (campo === 'services') {
        const chave = 'card.service.' + String(v);
        const traduzido = t(chave);
        if (traduzido !== chave) return traduzido;
    }
    return String(v);
}

// `{portId: "TYPE2.11", connectorTypes: ["TYPE2"], count: 2}` →
// `portId TYPE2.11 · connectorTypes TYPE2 · count 2`.
//
// Sem tabela de campos de propósito: isto atende o objeto DESCONHECIDO, e o
// Waze adiciona campo sem avisar. Quem tem tratamento próprio (ponto de
// entrada, horário) é resolvido antes de chegar aqui.
function objetoLegivel(v, prof = 0) {
    if (v === null || v === undefined) return t('card.value.empty');
    if (Array.isArray(v)) return v.map((x) => objetoLegivel(x, prof + 1)).join(', ');
    if (typeof v !== 'object') return String(v);
    // Teto de profundidade: aninhamento fundo vira sopa de palavras, e aí o
    // JSON é mais honesto sobre a estrutura do que uma lista achatada.
    if (prof >= 2) {
        try { return JSON.stringify(v); } catch { return String(v); }
    }
    const partes = Object.keys(v).map((k) => `${k} ${objetoLegivel(v[k], prof + 1)}`);
    return partes.length ? partes.join(' · ') : '{}';
}

// Quem pediu, de onde, e se veio sozinho. Três sinais que o Waze manda e a app
// descartava — todos cabem na linha do criador, sem custar altura de card.
//
// Por que cada um decide algo:
//   · rank    L1 anônimo pedindo mudança num local travado é outra coisa que L5
//   · source  MOBILE_CLIENT é alguém dirigindo; WEB é alguém sentado conferindo
//   · lote    42% da fila vem de quem enviou 3+ — se os primeiros do autor forem
//             lixo, os outros provavelmente são, e isso muda o ritmo da triagem
// ── Foco num autor: os pedidos dele vêm PRIMEIRO ─────────────────────────
// 42% da fila vem de quem enviou 3+ pedidos. Se os primeiros de um autor são
// lixo, os outros costumam ser — decidir uma vez e tratar 14 seguidos é o maior
// ganho de tempo que apareceu medindo a fila real.
//
// É PRIORIZAÇÃO, não filtragem, e a diferença importa: esconder os outros 126
// faria a fila "esvaziar" depois dos 14 e a app mostraria "Tudo limpo!" com 126
// pendentes — mentira. Aqui os do autor sobem pra frente e o resto continua
// depois, na mesma ordem relativa. Nada some, nada mente, e o editor recebe
// exatamente o que queria: a série do autor em sequência.
// Chaveado pelo ID, exibido pelo NOME.
//
// O módulo de reincidência já era por `creatorId`; o foco era por `createdBy`,
// e o mesmo card podia mostrar `Ver +2` (por nome) ao lado de um `✕ 6` que não
// virava botão (por id) — dois sistemas de identidade na mesma linha.
//
// Eu quase justifiquei isto com a medição ERRADA, e vale registrar: medi
// COLISÕES (dois ids com o mesmo nome) em 2.035 autores e deu zero — mas nome
// de usuário do Waze é único por construção, então zero era resultado
// garantido, não evidência. O modo de falha real é o MESMO id trocar de nome
// ENTRE sessões, e um instantâneo único nunca consegue ver isso.
//
// E a troca não é hipótese: 69% dos autores da fila real têm nome GERADO
// (`world_xxxxx`), que muda no dia em que a pessoa escolhe um. É o ciclo de
// vida normal da maioria, não um caso de borda.
//
// `id` pode ser 0 em teoria, então as comparações são contra `null`/`undefined`
// explicitamente. `!id` mandaria o foco embora num id 0 sem ninguém ver.
function focarAutor(id) {
    if (id === null || id === undefined || id === '') return;
    const daPessoa = AppState.queue.filter((x) => x.creatorId === id);
    if (daPessoa.length === 0) return;
    AppState.queue = [...daPessoa, ...AppState.queue.filter((x) => x.creatorId !== id)];
    AppState.autorEmFoco = id;
    AppState.currentPlace = AppState.queue[0];
    renderFocoAutor();
    removeCurrentCardEl();
    showCurrentPlace();
    updatePendingCount();
}

function limparFocoAutor() {
    if (AppState.autorEmFoco === null || AppState.autorEmFoco === undefined) return;
    AppState.autorEmFoco = null;
    // A ordem NÃO volta atrás: reordenar de novo tiraria da frente o pedido que
    // o editor está olhando agora. Sair do foco é parar de destacar, não desfazer.
    renderFocoAutor();
}

// A barra some sozinha quando a série acaba — sem isso ela ficaria mentindo
// sobre um foco que não existe mais assim que o card muda de autor.
function renderFocoAutor() {
    const bar = document.getElementById('focoAutorBar');
    if (!bar) return;
    const id = AppState.autorEmFoco;
    const atual = AppState.queue[0];
    const semFoco = id === null || id === undefined;
    if (semFoco || !atual || atual.creatorId !== id) {
        if (!semFoco && atual && atual.creatorId !== id) AppState.autorEmFoco = null;
        bar.classList.add('hidden');
        return;
    }
    // O nome é só rótulo. Sem ele o id vira o texto — feio, nunca invisível,
    // como o resto do card faz com valor que o Waze não nomeia.
    const nome = atual.createdBy || String(id);
    const restam = AppState.queue.filter((x) => x.creatorId === id).length;
    document.getElementById('focoAutorTexto').textContent = t('card.focoAutor', { autor: nome });
    document.getElementById('focoAutorContagem').textContent =
        t('card.focoAutor.contagem', { n: restam, total: AppState.queue.length });
    bar.setAttribute('aria-label', t('card.focoAutor.aria', { n: restam, autor: nome }));
    bar.classList.remove('hidden');
}

function renderSelosDeProcedencia(card, place) {
    const linha = card.querySelector('.card-creator-row');
    if (!linha) return;
    const selos = [];
    if (Number.isInteger(place.creatorRank)) {
        // +1 porque o Waze é 0-indexed e humano conta de 1 (gotcha #15).
        selos.push({ cls: 'selo-rank', txt: 'L' + (place.creatorRank + 1),
                     title: t('card.creatorRank.title') });
    }
    if (place.source) {
        const rot = rotuloDeEnum('card.source.', place.source);
        // Cada origem tem a redação oficial do WME no title; o genérico atende
        // valor que o Waze inventar depois — o selo cru já diz QUAL é, e a dica
        // ao menos diz o que aquilo significa.
        const dica = t('card.source.' + place.source + '.title');
        if (rot) selos.push({ cls: 'selo-src', txt: rot,
                              title: dica.startsWith('card.source.') ? t('card.source.title') : dica });
    }
    // Por `creatorId`, igual ao `pedidosDoAutorNaFila` logo abaixo: eram dois
    // sistemas de identidade na mesma linha, e um card podia mostrar `Ver +2`
    // ao lado de um `✕ 6` que não virava botão.
    const mesmos = (AppState.queue || [])
        .filter((x) => x !== place && x.creatorId != null && x.creatorId === place.creatorId).length;
    if (mesmos > 0) {
        selos.push({ cls: 'selo-lote', txt: t('card.sameAuthor', { n: mesmos }),
                     title: t('card.sameAuthor.acao'), acao: place.creatorId });
    }
    // Reincidência: quantos pedidos DESTE autor você já rejeitou. Rosa é a cor
    // do ✕ em toda a app — reincidência é rejeição acumulada, então herda dele.
    // Abaixo do limiar sai em cinza: a app CONTA, não acusa.
    const reincidente = contagemDoAutor(place);
    if (reincidente >= 2) {
        selos.push({
            cls: reincidente >= AUTOR_LIMIAR_DESTAQUE ? 'selo-reinc' : 'selo-src',
            txt: '✕ ' + reincidente,
            title: t('card.reincidencia.title', { n: reincidente }),
            // Vira BOTÃO sempre que o selo está VERMELHO — a cor é a promessa,
            // e selo vermelho sem toque é promessa quebrada. Vermelho quer dizer
            // "a app está acusando esta pessoa"; se acusa, tem que haver pra onde
            // ir. Abaixo do limiar o selo é cinza (a app CONTA sem acusar) e
            // segue sendo span: não há decisão a tomar sobre quem ela não acusa.
            //
            // Já esteve amarrado TAMBÉM a `pedidosDoAutorNaFila(place).length > 1`,
            // e essa segunda condição estava errada — mas não pelo motivo óbvio.
            // O raciocínio original ("com um só na fila a folha oferece 'Ver o 1'
            // e 'Rejeitar o 1', que é o card na tela com os três botões abaixo")
            // continua verdadeiro; o que estava errado foi a metade que eu cortei.
            // Diante de uma folha redundante eu tirei o BOTÃO, quando o certo era
            // tirar as duas linhas redundantes e pôr no lugar o que o card não
            // consegue mostrar: o que "✕ N" significa (o `title` não existe no
            // toque), o interruptor da recusa automática e o esquecer. Ver
            // `abrirFolhaDoAutor`, que agora se adapta ao tamanho da fila.
            //
            // Reportado pelo owner com um `✕ 8` vermelho e morto na tela — o caso
            // MAIS comum, porque só 27,3% dos cards têm outro pedido do mesmo
            // autor na fila (medido nos 6 países obrigatórios, 2.785 cards). Ou
            // seja: em ~3 de cada 4 vezes o selo vermelho não fazia nada.
            //
            // Contar por `creatorId` e não pelo nome é a razão de sempre neste
            // módulo: 69% dos autores têm nome GERADO, que muda no dia em que a
            // pessoa escolhe um.
            folha: reincidente >= AUTOR_LIMIAR_DESTAQUE ? place : null,
        });
    }
    if (!selos.length) return;
    const box = document.createElement('span');
    box.className = 'selos-proc';
    for (const s of selos) {
        // O selo do lote é o único que AGE: vira botão de verdade (não span com
        // onclick), pra receber foco no Tab e ser anunciado como acionável.
        // `s.acao != null` e não `s.acao`: a ação virou o `creatorId`, e um id 0
        // seria falsy — o selo perderia o botão sem nada avisar.
        const el = document.createElement(s.acao != null || s.folha ? 'button' : 'span');
        el.className = 'selo-proc ' + s.cls;
        el.textContent = s.txt;
        el.title = s.title;
        if (s.acao != null) {
            el.type = 'button';
            el.classList.add('selo-acionavel');
            el.addEventListener('click', (ev) => { ev.stopPropagation(); focarAutor(s.acao); });
        } else if (s.folha) {
            el.type = 'button';
            el.classList.add('selo-acionavel');
            el.addEventListener('click', (ev) => { ev.stopPropagation(); abrirFolhaDoAutor(s.folha); });
        }
        box.appendChild(el);
    }
    linha.appendChild(box);
}

function renderCardChanges(card, place) {
    if (!place.changes || place.changes.length === 0) {
        // Nenhuma linha, mas por dois motivos MUITO diferentes, e só um deles
        // pode virar afirmação: ou o core comparou campo a campo e todos vieram
        // iguais ao valor atual (`camposSemMudanca > 0`), ou não veio nada pra
        // comparar. Dizer "nada a alterar" no segundo caso seria inventar.
        if (place.camposSemMudanca > 0) {
            const aviso = card.querySelector('.card-sem-diferenca');
            if (aviso) { aviso.classList.remove('hidden'); aviso.classList.add('flex'); }
        }
        return;
    }
    const changesBox = card.querySelector('.card-changes');
    const changesList = card.querySelector('.card-changes-list');
    changesList.innerHTML = place.changes.map((c) => {
        const rotulo = `<span class="text-xs font-semibold text-slate-600 dark:text-slate-300">${escapeHtml(rotuloDoCampo(c))}:</span>`;

        // Campo de LISTA: o que entrou e o que saiu. Mostrar as duas listas
        // inteiras obrigava o editor a comparar de olho — no dado real
        // `services` troca 1 item entre 5 e `categories` ganha 1 entre 2.
        if (c.delta && ((c.delta.add || []).length || (c.delta.del || []).length)) {
            const add = (c.delta.add || []).map((v) => itemDeLista(v, 'diff-add', '+', c.field)).join('');
            const del = (c.delta.del || []).map((v) => itemDeLista(v, 'diff-del', '−', c.field)).join('');
            return `<div class="diff-row diff-row-lista">${rotulo}<span class="diff-delta">${add}${del}</span></div>`;
        }

        // Objeto simples: só as folhas que mudaram. Antes o card mostrava o
        // objeto inteiro em JSON pra dizer que um campo virou outro — medido na
        // fila real com `categoryAttributes` de um eletroposto. O caminho da
        // folha vai cru (`CHARGING_STATION.network`) porque é o identificador
        // que casa com o WME, mesma razão da categoria.
        // `geometry` NUNCA entra aqui: o core já a exclui, e a guarda dupla é
        // porque ela também é objeto simples e o sequestro desta linha desfaz
        // silenciosamente o "moveu 84 m" (aconteceu ao introduzir isto).
        if (c.field !== 'geometry' && c.objDelta && c.objDelta.length) {
            // Só `categoryAttributes` traduz. Diff de objeto é genérico e serve
            // qualquer campo — aplicar a tabela fora dali seria traduzir o que
            // não é enum de atributo.
            const attr = c.field === 'categoryAttributes';
            // Valor de item de lista: traduzido em atributo, intocado no resto.
            const vItem = (l, v) => (attr ? (valorDeAtributo(l.caminho, v) ?? v) : v);
            const linhas = c.objDelta.map((l) => {
                // Traduzido é PROSA ("Elevação do estacionamento"); cru é
                // IDENTIFICADOR (`PARKING_LOT.lotType`). O identificador precisa
                // de monoespaçado e `break-all` — sem isso um nome longo sem
                // espaço não quebra em lugar nenhum. A prosa com a mesma régua
                // parte no meio da palavra: apareceu "Número de vaga / s" na
                // primeira captura desta mudança.
                const rot = attr ? rotuloDeAtributo(l.caminho) : null;
                const caminho = `<span class="diff-obj-caminho${rot ? ' diff-obj-rotulo' : ''}">`
                    + `${escapeHtml(rot ?? l.caminho)}</span>`;
                const val = (v) => (attr ? (valorDeAtributo(l.caminho, v) ?? valorDoDiff(v)) : valorDoDiff(v));
                // Folha que é LISTA usa o mesmo vocabulário do campo de lista de
                // topo (+ verde entra, − vermelho sai). Dois blocos de JSON lado
                // a lado era o que estava aqui — medido no `chargingPorts` de um
                // eletroposto, e ninguém lia.
                if (l.delta && ((l.delta.add || []).length || (l.delta.del || []).length)) {
                    // `lotType`, `paymentType` e `paymentMethods` são LISTAS de enum,
                    // e é onde o código mais aparecia — o caso do owner tinha
                    // `− UNDERGROUND + MULTI_LEVEL`.
                    //
                    // Traduz o VALOR e entrega ao renderizador ÚNICO. Envolver o
                    // `itemDeLista` num segundo renderizador é o que o guard de
                    // layout proíbe, e com razão: eram dois trechos idênticos
                    // copiados, que é como duas telas do mesmo conceito divergem.
                    const add = (l.delta.add || []).map((v) => itemDeLista(vItem(l, v), 'diff-add', '+')).join('');
                    const del = (l.delta.del || []).map((v) => itemDeLista(vItem(l, v), 'diff-del', '−')).join('');
                    return `<span class="diff-obj-linha diff-obj-linha-lista">${caminho}`
                        + `<span class="diff-delta">${add}${del}</span></span>`;
                }
                return `<span class="diff-obj-linha">${caminho}`
                    + `<span class="diff-from">${escapeHtml(val(l.de))}</span>`
                    + `<span class="diff-to">${escapeHtml(val(l.para))}</span></span>`;
            }).join('');
            return `<div class="diff-row diff-row-obj">${rotulo}<span class="diff-obj">${linhas}</span></div>`;
        }

        // GEOMETRIA tem linha própria. Duas coordenadas de 6 casas quase iguais,
        // uma riscada em vermelho e outra em verde, ocupavam meio card e não
        // respondiam a pergunta do editor, que é "mudou muito?". Aqui a resposta
        // vem primeiro; a coordenada nova fica de referência, pequena.
        if (c.field === 'geometry') {
            const mudouForma = Number.isFinite(c.vertsFrom) && Number.isFinite(c.vertsTo)
                && c.vertsFrom !== c.vertsTo;
            // Abaixo de 5cm é a mesma posição. Dizer "moveu 0 m" numa forma que
            // ganhou vértice é afirmar que nada aconteceu — pior que ser vago.
            const parado = !Number.isFinite(c.movedM) || c.movedM < 0.05;
            let resumo;
            if (parado && mudouForma) resumo = t('card.change.reshaped');
            else if (parado) resumo = t('card.change.samePlace');
            else resumo = formatarDistancia(c.movedM);
            const verts = mudouForma
                ? `<span class="diff-hint">${escapeHtml(t('card.change.verts', { de: c.vertsFrom, para: c.vertsTo }))}</span>`
                : '';
            return `<div class="diff-row diff-row-geo">${rotulo}`
                + `<span class="diff-geo-resumo">${escapeHtml(resumo)}</span>`
                + `${verts}`
                + `<span class="diff-geo-coord">${escapeHtml(valorDoDiff(c.to))}</span></div>`;
        }

        // Realce só quando a diferença é agulha em palheiro (ver `realceDoMiolo`).
        // Nos outros casos a linha sai exatamente como sempre saiu.
        const realce = realceDoMiolo(c.from, c.to);
        if (realce) {
            // O valor inteiro fica no `title`: a janela mostra o que decide, e
            // quem quiser o resto tem onde ver sem abrir o WME.
            const tDe = escapeHtml(String(c.from)), tPara = escapeHtml(String(c.to));
            return `<div class="diff-row">${rotulo}`
                + `<span class="diff-from" title="${tDe}">${ladoRealcado(realce, 'de', 'diff-mark diff-mark-del')}</span>`
                + `<span class="diff-to" title="${tPara}">${ladoRealcado(realce, 'para', 'diff-mark diff-mark-add')}</span></div>`;
        }
        return `<div class="diff-row">${rotulo}`
            + `<span class="diff-from">${escapeHtml(valorDoDiff(c.from))}</span>`
            + `<span class="diff-to">${escapeHtml(valorDoDiff(c.to))}</span></div>`;
    }).join('');
    changesBox.classList.remove('hidden');
}

// Enquanto a janela do "Desfazer" corre, o pedido AINDA NÃO foi pro Waze e dá
// pra voltar atrás. Tratar o próximo nesse meio-tempo despachava o anterior sem
// aviso — e, por acidente de layout, em 6 de 8 aparelhos o banner cobria os
// botões, então o comportamento ainda mudava conforme a tela. Agora é decisão
// explícita: durante os UNDO_WINDOW_MS ninguém prossegue, em nenhum aparelho e
// por nenhum caminho (botão, gesto ou tecla).
//
// Só vale com o "Desfazer" LIGADO. Desligado (Preferências, depois da cota), a
// ação vai na hora e não há janela nenhuma — nem espera.
function acoesTravadas() {
    // Inclui as ações de FOTO (aprovar/excluir), não só o swipe. Elas abrem a
    // mesma janela de Desfazer e escrevem no mesmo local — deixar os botões do
    // lightbox vivos durante ela era o defeito que o owner viu: "não estão
    // sendo desativados que nem é feito nos cards".
    return !!(AppState.pendingAction || aprovacaoPendente || exclusaoPendente || renomeacaoPendente);
}

// Botão travado precisa PARECER travado: botão que não responde e parece normal
// lê como app quebrada (M3/HIG). O `disabled` também tira da ordem do Tab e faz
// o leitor de tela anunciar. A contagem regressiva do banner diz por quanto.
function aplicarTravaDeAcao() {
    const travado = acoesTravadas();
    const card = document.querySelector('.place-card');
    if (card) card.classList.toggle('acoes-travadas', travado);
    for (const cls of ['.card-btn-reject', '.card-btn-skip', '.card-btn-read']) {
        const b = card && card.querySelector(cls);
        if (b) b.disabled = travado;
    }
    // Os do lightbox seguem a MESMA regra e a mesma função. Regra duplicada é
    // como as duas telas divergem sem ninguém notar; o esmaecido vem do
    // `:disabled` no CSS, então basta o atributo.
    for (const id of ['lightboxApprove', 'lightboxDelete']) {
        const b = document.getElementById(id);
        if (b) b.disabled = travado;
    }
}

// A rolagem do conteúdo é CONSEQUÊNCIA de estourar, não estado padrão — e a
// medição precisa ser VIVA, não uma foto do primeiro quadro.
//
// Antes, o `overflow-y: auto` estava cravado no HTML e valia sempre. Uma sobra
// de UM PIXEL — arredondamento de fração do flex, não conteúdo que não cabe —
// já desenhava barra de rolagem no desktop. Relatado pelo owner e reproduzido
// com o card dele (conteúdo 284,x px numa caixa de 283,y px).
//
// Tirar o auto do HTML sozinho seria pior: se o conteúdo estourar DEPOIS (girar
// o aparelho, aumentar a fonte do sistema, zoom só-de-texto), o texto ficaria
// cortado sem saída — que é exatamente o que o guard de layout protege. Por isso
// aqui tem ResizeObserver: quem garante a saída é a medição continuar rodando,
// não um overflow ligado pra sempre.
//
// Tolerância de 2px: scrollHeight e clientHeight são INTEIROS arredondados de
// alturas fracionárias, e cada borda pode errar ~1px. Ela cobre SÓ isso — a
// falta de espaço de verdade cresce contínua com a janela (medido no card do
// segundo relato: 0,17 → 1,34 → 2,55 → 3,28px) e quem a resolve é o piso do
// texto no CSS, não uma tolerância maior aqui.
const TOLERANCIA_ARREDONDAMENTO_PX = 2;

function vigiarEstouroDoConteudo(el) {
    if (!el) return;

    // O callback do observer NÃO pode mexer no DOM: ligar a classe muda o
    // `overflow-y`, e onde a barra de rolagem é CLÁSSICA (desktop) ela ocupa
    // largura — encolhendo justamente o content box que este observer observa.
    // O browser detecta a re-entrada e emite "ResizeObserver loop completed
    // with undelivered notifications", que o window.onerror mostrava como toast
    // vermelho pro editor. Reproduzido no card do owner: só acontece na faixa
    // marginal (sobra de 3-4px), porque é onde a classe TROCA de estado; com
    // estouro claro ela já nasce ligada e nada re-dispara.
    //
    // Por isso o observer só AGENDA: a escrita acontece no quadro seguinte,
    // fora do ciclo de entrega. E só escreve se a decisão mudou, então em
    // regime permanente o custo é zero.
    //
    // Converge sempre, e isso é propriedade da geometria, não sorte: barra
    // VERTICAL não muda a altura da caixa, só estreita o conteúdo. Estreitar
    // só faz o texto ficar mais alto — então o que estourava sem barra segue
    // estourando com ela, e o que cabe COM a barra também cabe sem. Os dois
    // sentidos são estáveis; não há como piscar.
    let ligado = el.classList.contains('card-content-rola');
    let agendado = false;

    const escrever = () => {
        agendado = false;
        const estoura = el.scrollHeight > el.clientHeight + TOLERANCIA_ARREDONDAMENTO_PX;
        if (estoura === ligado) return;
        ligado = estoura;
        el.classList.toggle('card-content-rola', estoura);
    };
    // O primeiro quadro mente: antes do layout assentar, scrollHeight não vale.
    const agendar = () => {
        if (agendado) return;
        agendado = true;
        requestAnimationFrame(escrever);
    };

    agendar();
    if (typeof ResizeObserver === 'function') {
        const obs = new ResizeObserver(agendar);
        // A caixa é `flex-1` dentro de um card de altura fixa: quando o texto
        // cresce sem a caixa mudar de tamanho — fonte do sistema maior, zoom
        // só-de-texto — observar SÓ a caixa não dispara nada e a rede nunca
        // liga. Quem denuncia esse caso são os filhos.
        obs.observe(el);
        for (const filho of el.children) obs.observe(filho);
    }
}

// Scroll edge effect (M3): esmaece a borda de baixo enquanto sobra conteúdo.
// Área que rola sem dizer que rola é área que ninguém rola — e aqui isso custa
// caro, porque arrastar o card pra cima PULA: quem não souber que a caixa rola
// nunca vai ver o resto da lista. Some ao chegar no fim, pra não parecer corte.
// O ResizeObserver existe porque a caixa é `flex-1`: ela muda de tamanho quando
// o card entra, quando a foto carrega e quando o aparelho gira.
function marcarBordaRolagem(el) {
    if (!el) return;
    const atualizar = () => {
        el.classList.toggle('rola-mais', el.scrollHeight - el.scrollTop - el.clientHeight > 1);
    };
    el.addEventListener('scroll', atualizar, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(atualizar).observe(el);
    requestAnimationFrame(atualizar);
}

// Sem nome, o ENDEREÇO é a identidade — é o que o Google Maps faz com ponto sem
// nome, e o que faltava aqui: "sem nome" ocupava o slot de 1.35rem enquanto a
// única coisa que identificava o local ficava em cinza pequeno logo abaixo.
// Invertido. A ausência não some: vira selo (ver .card-no-name-badge), porque
// num pedido de place ela PODE ser informação de decisão — mas só onde ela é
// INESPERADA, e é isso que `ausenciaEsperada` decide.
//
// Cadeia: nome → endereço → "(local sem nome)". Só o último é placeholder — o
// endereço promovido é DADO, e por isso não leva o esmaecido de ausente.
function identidadeDoPlace(place) {
    const nome = String(place.name || '').trim();
    if (nome) return { titulo: nome, semNome: false, tituloEhEndereco: false, ausente: false };
    const endereco = String(place.address || '').trim();
    if (endereco) return { titulo: endereco, semNome: true, tituloEhEndereco: true, ausente: false };
    return { titulo: t('card.noName'), semNome: true, tituloEhEndereco: false, ausente: true };
}

// ── MANDAR O PEDIDO ABERTO PELA CONVERSA ────────────────────────────────────
//
// Vai um RESUMO, não o place inteiro: o `changes[]`, o `mapa` e a escrituração
// do venue não cabem numa pergunta ("isso é fachada ou é a sala?") e só
// engordariam o que trafega. O que vai é o que a folha de leitura mostra.
//
// E vai CHAVE, nunca texto renderizado (`updateTypeKey`, categorias cruas):
// quem manda pode estar em português e quem recebe em francês. É a mesma regra
// que o servidor já segue com o card — o remetente não escolhe a palavra que
// aparece na tela do outro.
//
// Devolve `null` quando não há pedido aberto (fila vazia, "Tudo limpo!", modo
// treino), e é isso que faz o botão sumir em vez de virar botão morto.
function cardParaConversa() {
    const place = AppState.currentPlace;
    if (!place || !place.venueID) return null;
    if (place._treino) return null;   // pedido inerte não existe pra mais ninguém
    const fotos = Array.isArray(place.imageUrls) ? place.imageUrls : [];
    return {
        venueID: place.venueID,
        updateRequestID: place.updateRequestID || null,
        name: place.name || '',
        address: place.address || '',
        categories: Array.isArray(place.categories) ? place.categories.slice(0, 4) : [],
        updateTypeKey: place.updateTypeKey || null,
        imageUrl: place.imageUrl || fotos[0] || null,
        lat: place.lat ?? null,
        lon: place.lon ?? null,
        // A região vai junto porque o link do WME depende dela e quem recebe
        // pode estar filtrando outra. Sem isto o ↗ levaria pro ambiente errado.
        region: API.getRegion(),
    };
}

// Monta a URL do WME pro pedido — a MESMA regra do ↗ do card (env por região,
// lat/lon com zoom 22, venueUpdateRequest com o venueID). Fonte única: o card e
// a folha de leitura chamam daqui, senão os dois links divergem sem ninguém ver.
// Casas decimais da coordenada no permalink. O número é do PRÓPRIO WME, lido no
// bundle dele (v2.367): `units: { lonLatPrecision: 5 }`, e é esse valor que o
// construtor de permalink aplica (`n.lat.toFixed(Config.units.lonLatPrecision)`).
// As duas URLs que o owner colou vêm com 5 casas porque saíram de lá.
//
// Cinco casas são ~1,1 m. No zoom 22 isso são ~30 px de deslocamento no CENTRO
// do mapa — e é aceitável porque quem marca o local é o `venues=`, não a
// coordenada: ela só enquadra. Precisão maior alongaria a URL sem mudar o que a
// pessoa vê selecionado.
const COORD_CASAS = 5;

// `Number(...)` por fora do `toFixed` corta zero à direita (`-23.40000` vira
// `-23.4`), que é o objetivo aqui: encurtar. O próprio WME usa esta MESMA forma
// no "copiar coordenadas" (`Number(e.toFixed(s))`); o permalink dele usa o
// `toFixed` cru, e os dois valem o mesmo NÚMERO — a diferença é só o texto.
//
// Não vira notação exponencial: depois do `toFixed(5)` o menor valor não-nulo é
// 0.00001, e o JS só troca pra exponencial abaixo de 1e-6.
const coordDoLink = (n) => Number(n.toFixed(COORD_CASAS));

// A URL do ↗ é um PERMALINK do WME, e a gramática dele é `tipoDeFeature=ids`.
// MEDIDO no bundle do WME (v2.367, `app-f7541f99…js`): o construtor de permalink
// espalha o `getMapSelection()` — um mapa `{tipo: ids}` — direto na query, e
// `venues`/`venueUpdateRequest` são dois desses tipos. `feature_editor` é um
// nome de aba (ao lado de `issue_tracker`, `areas`, `prefs`…). Ou seja: não é
// truque, é o link que o próprio WME gera quando você seleciona os dois e copia.
//
// `venues=` e `tab=feature_editor` entraram a pedido do owner (2026-09-03): sem
// eles o WME abria a SOLICITAÇÃO mas não selecionava o local, então quem clicava
// pra corrigir ainda tinha que achar o lugar no mapa. Com eles, cai no editor do
// local com a solicitação aberta — que é exatamente o que o ↗ promete, já que a
// app não edita dado de local por princípio.
//
// Os DOIS levam o `venueID`, e é contraintuitivo: `venueUpdateRequest` NÃO leva
// o id do pedido. Já estava assim (confirmado por HAR do WME nativo) e foi
// reconfirmado agora com dado real — nas duas URLs que o owner colou, uma é
// `NEW_PHOTO` cujo `updateRequestID` é um UUID (`ab3f9d27-…`) e mesmo assim o
// permalink que FUNCIONA traz o venueID. Medido na fila do Brasil (503 pedidos):
// `venueID === updateRequestID` só em `NEW_PLACE` (213); nos outros 290 o pedido
// é UUID. Se algum dia alguém "consertar" isto passando o UUID, quebra em 58%
// dos cards — travado em `test/layout.test.mjs`.
function linkWmeDoPedido(dados, region) {
    const envParam = region === 'na' ? 'usa' : region;
    const params = [`env=${envParam}`];
    // `Number.isFinite` e não a checagem por verdade: latitude 0 corta o Brasil
    // (Macapá) e longitude 0 corta o Reino Unido (Greenwich) — dois dos seis
    // países de validação. Com `dados.lat && dados.lon` o zero cai fora e o
    // editor abre no último lugar que a pessoa estava, sem sintoma nenhum.
    if (Number.isFinite(dados.lat) && Number.isFinite(dados.lon)) {
        params.push(`lat=${coordDoLink(dados.lat)}`, `lon=${coordDoLink(dados.lon)}`, 'zoomLevel=22');
    }
    if (dados.venueID) {
        const id = encodeURIComponent(dados.venueID);
        params.push(`venues=${id}`, `venueUpdateRequest=${id}`);
        // A aba só entra COM seleção: `feature_editor` sem nada selecionado abre
        // um painel vazio, que é pior que deixar o WME escolher a aba dele.
        params.push('tab=feature_editor');
    }
    return `${WME_EDITOR_URL}?${params.join('&')}`;
}

// Abre o pedido que CHEGOU pela conversa. Só leitura: sem ✕ ↑ ✓, porque ele não
// está na fila de quem recebe.
function abrirPedidoRecebido(dados, deQuem) {
    if (!dados) return;
    // O `$` deste arquivo é LOCAL de cada função que o declara, não global —
    // três funções já fazem exatamente isto. Assumi que era global porque o vi
    // sendo usado no setup, e o smoke devolveu `$ is not defined` na cara.
    const $ = (id) => document.getElementById(id);
    const ident = identidadeDoPlace(dados);
    $('pedidoNome').textContent = ident.titulo;
    $('pedidoDe').textContent = t('presenca.pedido.de', { nome: deQuem || t('presenca.anon') });

    const foto = $('pedidoFoto');
    if (dados.imageUrl) {
        $('pedidoFotoImg').src = dados.imageUrl;
        foto.classList.remove('hidden');
    } else {
        $('pedidoFotoImg').removeAttribute('src');
        foto.classList.add('hidden');
    }

    const linha = (idRow, idVal, valor) => {
        $(idRow).classList.toggle('hidden', !valor);
        if (valor) $(idVal).textContent = valor;
    };
    linha('pedidoTipoRow', 'pedidoTipo', dados.updateTypeKey
        ? t('card.updateType.' + dados.updateTypeKey) : '');
    // Categoria sai CRUA de propósito: o Waze regionaliza por PAÍS, não por
    // idioma, então traduzir erraria em metade dos países (ver gotcha #39).
    linha('pedidoCatRow', 'pedidoCat', (dados.categories || []).join(', '));
    // Sem nome o endereço já virou o TÍTULO — repeti-lo aqui seria dizer a
    // mesma coisa duas vezes, que é o que o card também evita.
    linha('pedidoEndRow', 'pedidoEnd', ident.tituloEhEndereco ? '' : (dados.address || ''));

    $('pedidoWme').href = linkWmeDoPedido(dados, dados.region || API.getRegion());
    openModal('pedidoModal');
}

// Categorias em que NÃO ter nome é o normal — o selo não aparece nelas.
//
// MEDIDO em 4692 pedidos dos 13 países de validação (o dado CRU do Waze, não a
// fila filtrada por permissão, que fora do Brasil devolve zero): a ausência de
// nome é 100% em RESIDENCE_HOME (325 de 325) e exceção em todo o resto —
// PARKING_LOT 8,1%, PARK 8,3%, CHARGING_STATION 4,0%, e ZERO em GAS_STATION
// (427), RESTAURANT (149) e SUPERMARKET_GROCERY (125).
//
// Sinal que dispara em 100% de uma classe não distingue nada dentro dela: ele
// não diz "olhe isto", diz "isto é RESIDENCE_HOME" — que a linha de categoria
// logo abaixo já diz. Pior: selo em destaque no topo lê como alerta, e para
// casa a ausência é normal, então ele convidava a rejeitar o que está certo.
// São 8% da fila global e 15% da do owner — não é caso de canto.
//
// A regra que fica: o selo marca ausência INESPERADA, não ausência. Categoria
// nova entra aqui só com a taxa medida perto de 100%; abaixo disso, o selo
// informa e deve aparecer.
//
// Isto substitui a justificativa antiga ("RESIDENCE_HOME sem nome é forte
// candidato a rejeitar"), que era raciocínio de escrivaninha sobre uma amostra
// brasileira pequena — e que o dado nega.
const CATEGORIAS_SEM_NOME_ESPERADO = Object.freeze(['RESIDENCE_HOME']);

function ausenciaDeNomeEsperada(place) {
    const cats = Array.isArray(place && place.categories) ? place.categories : [];
    return cats.some((c) => CATEGORIAS_SEM_NOME_ESPERADO.includes(c));
}

// Escreve valor OU placeholder, marcando qual dos dois é. O texto entre
// parênteses já diz sozinho (e o leitor de tela lê); o esmaecido em itálico é
// reforço visual. Cor sozinha não serviria — WCAG 1.4.1.
function escreverValor(el, valor, chaveVazio) {
    if (!el) return;
    const v = valor === null || valor === undefined ? '' : String(valor).trim();
    el.textContent = v || t(chaveVazio);
    el.classList.toggle('valor-ausente', !v);
}

// O core manda TIPO, não palavra: null = vazio, boolean = sim/não, '' = existe
// sem nome. Ver formatValue em server/core.mjs.
// Onde exatamente dois textos diferem, quando isso NÃO se vê num relance.
//
// O card já mostra o valor antigo riscado em vermelho e o novo em verde, lado a
// lado — e pra quase toda mudança isso basta: `Bom Atacarejo` → `Strapasson` se
// lê num piscar. O owner recusou (com razão) selo que explica o óbvio: editor de
// mapa não precisa de muleta pra comparar dois nomes.
//
// O que engana o olho é OUTRA coisa, e ela se descobriu medindo: a diferença
// que NÃO muda o tamanho da string. Sem mudança de tamanho não há pista de
// forma, e as duas linhas parecem a mesma linha:
//
//   Aeroport Josep Tarradellas Barcelona - El Prat T1     CDG Terminal 2F
//   Aeroport Josep Tarradellas Barcelona - El Prat T2     CDG Terminal 2C
//                                                  ^                   ^
//
// Compare com o que CRESCE, e que ninguém deixa passar:
//   Goose Street Car Park  →  Goose Street Car Parkuuuu
//   Termas Prexigueiro     →  Termas de Prexigueiro
//
// MEDIDO em 453 mudanças de texto de 13 países. Os três limiares saem daí:
//
//   `REALCE_DELTA_MAX` é O QUE DECIDE. Δ≤1 separa limpo: de um lado ficam
//   `Radmore`→`Radmoor`, `Sánchez`→`Sanchez`, `Inglesia`→`Iglesia`,
//   `Rincón del`→`Rincón de`, `Falésia`→`Falésiau`, `Sé Catedral`→`Sé QCatedral`,
//   `Gate 7`→`Gate 8`, e as 12 variantes de `CDG Terminal 2F`. Do outro, tudo
//   que ganha ou perde pedaço visível (`…Barajas T2`, `W Boulangerie`,
//   `Corporationhhdh`, `/天汇`).
//
//   `REALCE_MIOLO_MAX` = 3. Em 2 perderia `CDG Terminal 2F`→`T2d`; em 4 entraria
//   `ChaMiLukie`→`ChaMiLuLiLi`, que já se vê. O empate é DESEQUILIBRADO e por
//   isso resolvido pra cima: realçar de mais custa um destaque que ninguém
//   pediu; realçar de menos custa aprovar `T1` achando que é `T1`.
//
//   `REALCE_CONTEXTO_MIN` = 10 é piso, não fronteira — de 8 a 10 dá o mesmo
//   número. Existe pra `"71"`→`"20"` solto nunca virar realce.
//
// Resultado: 49 de 453 (10,8%). Uma primeira versão usava "contexto ≥ 18 e
// miolo ≤ 6" e estava errada nas duas pontas — deixava de fora TODOS os
// `CDG Terminal 2F` (contexto 14) e marcava os apensos visíveis.
const REALCE_DELTA_MAX = 1;      // diferença de comprimento entre os dois textos
const REALCE_MIOLO_MAX = 3;      // caracteres que de fato mudam, no maior dos dois
const REALCE_CONTEXTO_MIN = 10;  // caracteres idênticos somando início e fim
// Quanto do texto IDÊNTICO fica em volta do realce. Existe porque `.diff-from` e
// `.diff-to` são `-webkit-line-clamp: 3`, e MEDIDO no Galaxy Fold a coluna cabe
// ~15 caracteres por linha: um nome de 49 é cortado ANTES da diferença. Sem
// isto o recurso ficaria invisível justamente na tela mais apertada — e, pior,
// o card de hoje já esconde ali a informação que decide (`…El Prat T1` e
// `…El Prat T2` saem idênticos num Fold).
//
// 16 é folgado de propósito: os valores curtos, que são a maioria dos casos
// (`CDG Terminal 2F` tem 13 de contexto), passam INTEIROS e nada se perde. Só
// encurta o que seria cortado de qualquer jeito — e aí mostrar a vizinhança da
// diferença é estritamente melhor que mostrar um prefixo que termina antes
// dela. O valor completo continua no `title`.
const REALCE_JANELA = 16;

// Prefixo e sufixo comuns, por CARACTERE Unicode (`[...s]`, não `s[i]`): com
// índice de UTF-16 um emoji ou um acento composto se parte no meio e o realce
// sairia cortando o próprio caractere.
//
// Prefixo/sufixo em vez de distância de edição completa porque é isso que o
// olho faz — e nos casos reais dá a mesma resposta com uma fração do custo.
// Devolve `null` quando a regra não se aplica: quem chama não decide nada.
function realceDoMiolo(de, para) {
    if (typeof de !== 'string' || typeof para !== 'string' || de === para) return null;
    const A = [...de], B = [...para];
    if (Math.abs(A.length - B.length) > REALCE_DELTA_MAX) return null;
    let p = 0;
    while (p < A.length && p < B.length && A[p] === B[p]) p++;
    let s = 0;
    while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
    const mA = A.length - p - s, mB = B.length - p - s;
    if (p + s < REALCE_CONTEXTO_MIN) return null;
    if (Math.max(mA, mB) > REALCE_MIOLO_MAX) return null;
    // Janela: o prefixo e o sufixo comuns entram no máximo `REALCE_JANELA`
    // caracteres. O que sobrar vira reticência — e ela é do mesmo lado nos dois
    // valores, senão as duas linhas deixariam de se alinhar na leitura.
    const cortaIni = p > REALCE_JANELA, cortaFim = s > REALCE_JANELA;
    const ini = cortaIni ? p - REALCE_JANELA : 0;
    const fimA = cortaFim ? p + mA + REALCE_JANELA : A.length;
    const fimB = cortaFim ? p + mB + REALCE_JANELA : B.length;
    return {
      de: [A.slice(ini, p), A.slice(p, p + mA), A.slice(p + mA, fimA)].map((x) => x.join('')),
      para: [B.slice(ini, p), B.slice(p, p + mB), B.slice(p + mB, fimB)].map((x) => x.join('')),
      cortaIni, cortaFim,
    };
}

function ladoRealcado(realce, lado, classe) {
    const [antes, meio, depois] = realce[lado];
    return (realce.cortaIni ? '…' : '')
        + escapeHtml(antes)
        + (meio ? `<mark class="${classe}">${escapeHtml(meio)}</mark>` : '')
        + escapeHtml(depois)
        + (realce.cortaFim ? '…' : '');
}

function valorDoDiff(v) {
    if (v === null || v === undefined) return t('card.value.empty');
    if (v === true) return t('card.value.yes');
    if (v === false) return t('card.value.no');
    if (v === '') return t('card.value.unnamed');
    // Objeto/array chegando aqui vira "[object Object]" no `String()` — o
    // defeito que já apareceu em 33 de 142 pedidos com geometria. O diff de
    // objeto pode ter folha que é lista (`chargingPorts` de um eletroposto,
    // medido), e ela precisa de saída. JSON é feio; invisível é pior.
    if (typeof v === 'object') {
        try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
}

// Rótulo do campo pela CHAVE (`name`, `phone`…). Campo não mapeado cai no `label`
// que o core ainda manda — feio (nome cru da API) mas nunca invisível.
function rotuloDoCampo(mudanca) {
    const chave = 'card.field.' + mudanca.field;
    const traduzido = t(chave);
    return traduzido === chave ? (mudanca.label || mudanca.field) : traduzido;
}

// ENUM_ASSIM_NAO_SE_LE → "Enum assim nao se le". Enum que ainda não mapeamos
// aparece legível em vez de gritando em caixa alta — mesmo critério do fallback
// de rótulo de campo no core. Continua em inglês, e é de propósito: esconder o
// valor seria pior, e traduzir sem confirmar seria chute.
function humanizarEnum(valor) {
    const s = String(valor).replace(/_/g, ' ').trim().toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── ATRIBUTOS DE CATEGORIA (estacionamento, eletroposto) ────────────────────
//
// O diff de `categoryAttributes` mostrava CÓDIGO: `PARKING_LOT.parkingType`
// com `PUBLIC → PRIVATE`, `R_61_TO_100 → R_1_TO_10`. Não era regressão — o
// caminho da folha nunca traduziu —, só ficou visível quando apareceu um
// pedido que altera atributo, que é raro: 22 de 4.898 pedidos (0,45%) medidos
// nos 13 países de validação.
//
// As strings são as OFICIAIS do WME, colhidas da página do editor em cada
// idioma (gotcha #47: nunca a tradução da minha língua). Só existem duas
// categorias com atributo — `PARKING_LOT` e `CHARGING_STATION` —, e isso se
// manteve nos 13 países.
//
// A chave é `categoria.campo[.VALOR]`, nunca `campo.VALOR`: `costType` existe
// nas duas com conjuntos DIFERENTES, e `PUBLIC`/`RESTRICTED` aparecem tanto em
// `parkingType` quanto em `accessType`. Achatar por campo traduziria errado.
const ATTR_PREFIXO = 'card.attr.';

// `PARKING_LOT.parkingType` → "Tipo principal". Sem string oficial, devolve o
// caminho CRU — que é o identificador que casa com o WME, como antes.
function rotuloDeAtributo(caminho) {
    const chave = ATTR_PREFIXO + caminho;
    const s = t(chave);
    return s === chave ? null : s;   // null = sem string oficial, usa o caminho cru
}

// `PARKING_LOT.parkingType` + `PUBLIC` → "Público".
//
// Valor sem string oficial cai no `humanizarEnum` — "Membership card" em vez
// de `MEMBERSHIP_CARD`. São 7 dos 46 valores observados, e eles existem no dado
// mas não na tabela do WME.
//
// **Texto livre não passa por aqui**: `network` traz nome de rede (`Belib'`,
// `ChargeGuru`) e `locationInVenue` traz frase inteira. Eles têm rótulo na
// tabela e NÃO têm valores, então o `t()` devolve a chave e o valor sai cru —
// que é o certo. Humanizar ali corromperia marca própria, exatamente como já
// corrompeu apelido e ID do Google (gotcha #39).
// Campos cujo VALOR é texto livre, e que por isso nunca passam pela tabela nem
// pelo `humanizarEnum`. A lista é por CAMPO, não pela forma do valor — e essa
// é a lição, porque a forma engana: `network` traz marca em CAIXA ALTA
// (`DRIVECO`, `ESB`, `JOINON`, `ZSE`, `ETECNIC`, medidos em 13 países), que
// passa por qualquer regex de enum e sai humanizada como "Driveco", "Esb",
// "Zse". `ESB` e `ZSE` são siglas: humanizar não é feio, é ERRADO.
//
// Terceira vez que este projeto tropeça no mesmo lugar (gotcha #39): já
// corrompeu apelido e ID do Google. A regra que sobrevive é "o campo diz se o
// valor é enumerável", nunca "o valor parece um enum".
const ATTR_TEXTO_LIVRE = new Set([
    'CHARGING_STATION.network',
    'CHARGING_STATION.locationInVenue',
    'CHARGING_STATION.chargingPorts',
]);

function valorDeAtributo(caminho, valor) {
    if (valor === null || valor === undefined || typeof valor === 'object') return null;
    if (ATTR_TEXTO_LIVRE.has(caminho)) return null;
    const bruto = String(valor);
    // SÓ CAIXA ALTA passa. Isto faz dois trabalhos: barra o texto livre e barra
    // o booleano (`"true"` é minúsculo), que já sai como Sim/Não pelo
    // `valorDoDiff`. Havia um `typeof valor === 'boolean'` explícito aqui e ele
    // era código morto — a sabotagem que o removia passava limpa, porque a
    // regex já cobria o caso.
    if (!/^[A-Z][A-Z0-9_]*$/.test(bruto)) return null;
    const chave = ATTR_PREFIXO + caminho + '.' + bruto;
    const s = t(chave);
    return s === chave ? humanizarEnum(bruto) : s;
}

// Traduz enum do Waze por prefixo de chave, humanizando o que não conhecemos.
function rotuloDeEnum(prefixo, valor) {
    if (!valor) return '';
    const chave = prefixo + valor;
    const traduzido = t(chave);
    return traduzido === chave ? humanizarEnum(valor) : traduzido;
}

// Pré-carrega a imagem do próximo place da fila — mata o flash branco no swipe.
// O que este card mostra PRIMEIRO: o mapa ou a foto?
//
// FONTE ÚNICA da decisão. Ela vale em dois lugares — o carrossel, que monta os
// slides, e o prefetch, que aquece o próximo. Duplicada, elas divergem e o
// prefetch passa a aquecer o ativo errado sem ninguém notar, que é exatamente
// o defeito que esta função veio consertar.
//
// O mapa vem primeiro quando é a evidência principal: não há foto pra olhar, ou
// o pedido mexe em POSIÇÃO (e aí a coordenada crua não se julga — foi por isso
// que o mapa existe).
function mapaVemPrimeiro(place) {
    if (!place || !place.mapa) return false;
    const nFotos = (place.imageUrls && place.imageUrls.length)
        || (place.imageUrl ? 1 : 0);
    const eEspacial = (place.changes || [])
        .some((c) => c.field === 'geometry' || c.field === 'entryExitPoints');
    return nFotos === 0 || eEspacial;
}

// Aquece o que o PRÓXIMO card vai mostrar primeiro — não "a foto dele".
//
// Antes isto era `imageUrls[0]`, sempre. Medido em 4188 cards reais de 12
// países: em 23% o primeiro slide é o MAPA, e em 20% não há foto nenhuma —
// nesses o prefetch não aquecia NADA e o editor via a caixa cinza esperando o
// tile. Nos outros ~3%, ele baixava 56 KB de uma foto que não aparece primeiro.
//
// Não é gastar mais rede: é gastar no que a pessoa vai ver. Os tiles do próximo
// card seriam baixados de qualquer forma quando ele chegasse — a fila é
// sequencial, então o "próximo" é literalmente o próximo que ela vê.

// Rede em que aquecer mais ATRAPALHA. Prefetch disputa banda com o card que
// está na tela: numa 2G ou com economia de dados ligada, encher o cano com o
// que talvez nem seja visto deixa mais lento justamente o que a pessoa está
// olhando agora. `navigator.connection` não existe no Safari — sem ele a
// resposta é "não é econômica", que é o comportamento de antes.
function redeEconomica() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    return /(^|-)2g$/i.test(c.effectiveType || '');
}

// Uma imagem aquecida NUNCA compete com o card na tela: `fetchPriority: low`
// põe o pedido atrás do que está sendo pintado. Onde o navegador não suporta,
// atribuir a propriedade é inócuo — degrada pro comportamento de antes.
function aquecer(url) {
    if (!url) return;
    const im = new Image();
    im.fetchPriority = 'low';
    im.decoding = 'async';
    im.src = url;
}

// Os tiles que o mini-mapa DESTE card vai pedir. Usa a caixa do card atual: o
// próximo ainda não existe e o layout é o mesmo. Errar por alguns pixels só
// muda o zoom em casos de fronteira, e aí o tile aquecido é vizinho do certo.
function tilesDoCard(place, w, h) {
    if (!place || !place.mapa || !window.mapaMontar) return [];
    const r = mapaMontar(pontosDoMapa(place).map((p) => p.ll), w, h, API.getRegion());
    return r ? r.tiles.map((t) => t.url) : [];
}

// Aquece o que o próximo card mostra PRIMEIRO — não "a foto dele".
//
// Antes isto era `imageUrls[0]`, sempre. Medido em 4188 cards reais de 12
// países: em 23% o primeiro slide é o MAPA, e em 20% não há foto nenhuma —
// nesses o prefetch não aquecia NADA e o editor via a caixa cinza esperando o
// tile. Nos outros ~3%, baixava uma foto que não aparece primeiro.
function aquecerPrimeiroSlide(place, w, h) {
    if (!place) return;
    if (mapaVemPrimeiro(place)) { for (const u of tilesDoCard(place, w, h)) aquecer(u); return; }
    aquecer((place.imageUrls && place.imageUrls[0]) || place.imageUrl);
}

// O RESTO do card: as outras fotos e, se o mapa não era o primeiro slide, os
// tiles dele. Serve quem PAROU e começou a explorar o carrossel — por isso vai
// só pro card seguinte, e com teto.
function aquecerRestoDoCard(place, w, h) {
    if (!place) return;
    const fotos = (place.imageUrls && place.imageUrls.length ? place.imageUrls : [place.imageUrl]).filter(Boolean);
    const inicio = mapaVemPrimeiro(place) ? 0 : 1;   // a [0] já foi no primeiro slide
    for (const u of fotos.slice(inicio, PREFETCH_TETO_FOTOS)) aquecer(u);
    if (!mapaVemPrimeiro(place)) for (const u of tilesDoCard(place, w, h)) aquecer(u);
}

function prefetchNextImage() {
    if (!AppState.queue[1]) return;
    const cx = document.querySelector('.place-card .card-photo');
    const w = (cx && cx.clientWidth) || 400;
    const h = (cx && cx.clientHeight) || 240;
    const economica = redeEconomica();

    // PROFUNDIDADE: o 1º slide dos próximos N (hoje 1, ver a constante).
    const fundo = economica ? 1 : PREFETCH_PROFUNDIDADE;
    for (let i = 1; i <= fundo; i++) {
        if (!AppState.queue[i]) break;
        aquecerPrimeiroSlide(AppState.queue[i], w, h);
    }
    // LARGURA: só o card seguinte, e nunca em rede econômica.
    if (!economica) aquecerRestoDoCard(AppState.queue[1], w, h);
}

function showNoPlaces() {
    marcarTelaPronta();   // fila vazia ou erro: não vem card, mas a tela está pronta
    AppState.currentPlace = null;
    removeCurrentCardEl();
    showLoading(false);
    const noMore = document.getElementById('noMoreCards');
    const errEl = document.getElementById('loadErrorState');
    if (AppState.loadError && errEl) {
        // Falha de rede/servidor: NÃO mostra "Tudo limpo!" (o editor acharia que
        // zerou o backlog). Mostra estado de erro com "Tentar novamente".
        noMore.classList.add('hidden');
        errEl.classList.remove('hidden');
    } else {
        if (errEl) errEl.classList.add('hidden');
        noMore.classList.remove('hidden');
        atualizarConviteInstalar();
        // Com o convite embaixo, o painel pode não caber (Fold, tela deitada,
        // fonte grande do sistema). Aí ele rola — e área que rola sem dizer que
        // rola é área que ninguém rola (gotcha #29). Uma vez só por elemento:
        // o próprio marcarBordaRolagem reavalia via ResizeObserver.
        if (!noMore.dataset.bordaRolagem) {
            marcarBordaRolagem(noMore);
            noMore.dataset.bordaRolagem = '1';
        }
        // Festa só quando o editor de fato zerou algo NESTA sessão. Abrir a app
        // numa fila já vazia não é conquista — confete ali seria ruído.
        const tratou = (AppState.stats.read || 0) + (AppState.stats.rejected || 0) > 0;
        noMore.classList.remove('celebrate');
        if (tratou) {
            // Reflow forçado: sem isso o browser junta remove+add num só estilo
            // computado e a animação não reinicia na segunda vez que a fila zera.
            void noMore.offsetWidth;
            noMore.classList.add('celebrate');
        }
    }
}

function formatRelativeTime(ts) {
    if (!ts || typeof ts !== 'number' || ts <= 0) return null;
    const diff = Date.now() - ts;
    if (diff < 0) return t('time.now');
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t('time.now');
    const min = Math.floor(sec / 60);
    if (min < 60) return t('time.minutes', { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('time.hours', { n: hr });
    const days = Math.floor(hr / 24);
    if (days < 30) return t('time.days', { n: days });
    const months = Math.floor(days / 30);
    if (months < 12) return t('time.months', { n: months });
    const years = Math.floor(days / 365);
    return t('time.years', { n: years });
}

// ── Mensagem de erro que veio do servidor ─────────────────────────────────
// O backend manda CHAVE (`errorKey`) + `errorVars`; a frase em `error` é só o
// último recurso. Antes daqui o padrão era `result.error || t('...')`, e o `||`
// fazia a string PORTUGUESA do servidor GANHAR da tradução: quem usava a app em
// inglês, espanhol ou francês lia português em todo erro de sessão, cookie,
// rede ou race — e a tradução ao lado só entrava se o servidor não dissesse
// nada. Era o buraco de i18n mais fundo da app, porque nenhuma auditoria de
// dicionário enxerga string que chega pela rede.
//
// A frase crua continua no fim da cadeia de propósito: o service worker é
// cache-first pra assets, então por alguns dias após um deploy existe cliente
// com dicionário velho que não conhece a chave nova. Português é ruim; chave
// crua na tela ("srv.err.cookieFormat") é pior.
function msgDoServidor(result, textoFallback) {
    if (result && result.errorKey) {
        const traduzido = t(result.errorKey, result.errorVars || undefined);
        if (traduzido !== result.errorKey) return traduzido;
    }
    return (result && result.error) || textoFallback;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function callWithRetry(fn) {
    let result = await fn();
    let attempt = 0;
    while (result && !result.success && result.errorCategory === 'transient' && attempt < TRANSIENT_RETRY_ATTEMPTS) {
        const delay = TRANSIENT_RETRY_DELAYS_MS[attempt] || 5000;
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        result = await fn();
    }
    return result;
}

// ── Histórico acumulado (B7): buckets diários em localStorage ────────────────
// Baldes mais velhos que isto são podados. Cobre com folga os recortes que a
// UI mostra (hoje/semana/mês) — e o "Total" continua verdadeiro porque vive
// num acumulador à parte, que sobrevive à poda.
const HISTORY_MAX_DIAS = 400;

function loadHistory() {
    if (AppState.history) return AppState.history;
    let h = {};
    try { h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}') || {}; } catch (e) { h = {}; }
    // Acumulador que sobrevive à poda dos baldes diários. Só inicializa — a
    // soma retroativa do formato antigo saiu junto com os outros resíduos.
    if (!h._total) h._total = { read: 0, rejected: 0 };
    AppState.history = h;
    if (podarHistorico(h)) salvarHistorico(h);
    return h;
}

// Sem isto o objeto cresce um balde por dia PRA SEMPRE — e como o
// recordHistory serializa o objeto inteiro a cada ação confirmada, o custo de
// cada swipe cresceria junto, sem nada em troca.
function podarHistorico(h) {
    const limite = Date.now() - HISTORY_MAX_DIAS * 86400000;
    let podou = false;
    for (const k of Object.keys(h)) {
        if (k === '_total') continue;
        const quando = new Date(k + 'T00:00:00').getTime();
        if (!Number.isFinite(quando) || quando < limite) { delete h[k]; podou = true; }
    }
    return podou;
}

function salvarHistorico(h) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (e) {}
}
function historyTodayKey() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Registra no histórico persistente. type: 'read' | 'reject'. delta normalmente +1.
function recordHistory(type, delta) {
    if (type !== 'read' && type !== 'reject') return;
    const h = loadHistory();
    const k = historyTodayKey();
    if (!h[k]) h[k] = { read: 0, rejected: 0 };
    const field = type === 'read' ? 'read' : 'rejected';
    h[k][field] = Math.max(0, (h[k][field] || 0) + (delta || 0));
    h._total[field] = Math.max(0, (h._total[field] || 0) + (delta || 0));
    salvarHistorico(h);
}
function getHistoryStats() {
    const h = loadHistory();
    const now = Date.now();
    const tk = historyTodayKey();
    const acc = { today: { read: 0, rejected: 0 }, week: { read: 0, rejected: 0 }, month: { read: 0, rejected: 0 }, total: { read: 0, rejected: 0 } };
    // "Total" sai do acumulador, não da soma dos baldes: os antigos foram
    // podados, e somar só o que sobrou faria o número encolher sozinho.
    acc.total.read = (h._total && h._total.read) || 0;
    acc.total.rejected = (h._total && h._total.rejected) || 0;
    for (const [k, v] of Object.entries(h)) {
        if (k === '_total' || !v) continue;
        const r = v.read || 0, j = v.rejected || 0;
        if (k === tk) { acc.today.read += r; acc.today.rejected += j; }
        const ageDays = Math.floor((now - new Date(k + 'T00:00:00').getTime()) / 86400000);
        if (ageDays >= 0 && ageDays < 7) { acc.week.read += r; acc.week.rejected += j; }
        if (ageDays >= 0 && ageDays < 30) { acc.month.read += r; acc.month.rejected += j; }
    }
    return acc;
}
// ═══════════════════════════════════════════════════════════════════════════
//  Recusa automática: os pedidos que chegam de um autor marcado
// ═══════════════════════════════════════════════════════════════════════════
//
// É o único recurso da app que decide sobre pedido que ainda não existia quando
// o editor escolheu. Duas coisas foram desenhadas contra o instinto:
//
// 1. PORTÃO. Só L6+AM ou staff — champs e staff do Waze, não qualquer editor.
//    Foi a condição do owner pra o recurso existir, e é ela que sustenta o
//    resto: quem marca alguém aqui está fazendo julgamento informado sobre um
//    spammer persistente, não um toque apressado.
//
// 2. O PLACAR ANDA COM O ENVIO, não antes dele (`contarAoLandar`). Em todo o
//    resto da app o placar é otimista, porque existe uma janela de Desfazer que
//    devolve o número. Aqui não há janela: os pedidos vão direto, um a um. Se
//    a página morresse no meio de um laço já contado, o placar ficaria com
//    números que nunca saíram — e não haveria quando reconciliar. Contando ao
//    landar, o número na tela é sempre o que de fato foi enviado.
//
// Houve uma janela de 20s aqui, com aviso no futuro ("serão rejeitados") e
// oferta de cancelar. Saiu por decisão do owner, e o motivo é o que a linha do
// tempo mostrou: a janela começa quando o APP BUSCA a fila, não quando o editor
// escolhe — ou seja, sempre no meio de outro card. Vinte segundos parados sobre
// algo que ninguém está olhando não protegem; só atrasam. O que ficou no lugar
// é honesto sobre o mesmo fato: o aviso conta enquanto acontece.

function podeRecusarAutomaticoAqui() {
    // Função própria que delega, como os outros destrutivos: são decisões de
    // produto que hoje coincidem, e se o owner separar uma o call site não muda.
    return podeAgirComoL6Aqui();
}

// O interruptor mora no MESMO registro da contagem: a poda de 30 dias vale pros
// dois, e isso é o certo — autor que parou de mandar por um mês não precisa
// seguir com recusa automática armada.
function autoLigado(chave) {
    const e = loadAutores().r[String(chave)];
    return Array.isArray(e) && e[3] === 1;
}

function alternarAutoDoAutor(chave) {
    if (!podeRecusarAutomaticoAqui()) return;
    const a = loadAutores();
    const e = a.r[String(chave)];
    if (!Array.isArray(e)) return;
    e[3] = e[3] === 1 ? 0 : 1;
    salvarAutores(a);
    renderHistory();
}

// Uma execução por vez: a fila pode crescer de novo enquanto o laço corre, e
// duas passagens simultâneas mandariam o mesmo pedido duas vezes.
let recusaAutomaticaRodando = false;

// Chamado depois de a fila crescer. Tira os pedidos dos autores marcados e
// rejeita na hora, um a um, com o aviso contando quantos faltam.
async function aplicarRecusaAutomatica() {
    if (!podeRecusarAutomaticoAqui()) return;
    if (Treino.ativo) return;               // no treino a fila é de exemplos
    if (recusaAutomaticaRodando) return;
    const alvos = (AppState.queue || []).filter(
        (x) => x && x.creatorId !== undefined && x.creatorId !== null && autoLigado(x.creatorId));
    if (alvos.length === 0) return;

    recusaAutomaticaRodando = true;
    const n = alvos.length;
    const autor = alvos[0].createdBy || String(alvos[0].creatorId);
    // Saem da fila ANTES de enviar: senão o editor veria como card o pedido que
    // a app já está rejeitando, e poderia agir nele — dois envios pro mesmo.
    const fora = new Set(alvos);
    const eraOAtual = AppState.currentPlace && fora.has(AppState.currentPlace);
    AppState.queue = AppState.queue.filter((x) => !fora.has(x));
    updatePendingCount();
    if (eraOAtual) {
        AppState.currentPlace = null;
        removeCurrentCardEl();
        if (AppState.queue.length > 0) showCurrentPlace();
        else if (AppState.hasMore) startFetching();
        else showNoPlaces();
    }

    // O aviso é só ACOMPANHAMENTO: conta enquanto acontece e some quando acaba.
    // Decisão do owner — "a ideia do toast é só informar". Não sobra banner
    // depois, porque depois não há nada a informar: o trabalho terminou.
    //
    // O prazo é folgado (10 min) de propósito: quem dispensa é o `finally`, não
    // o relógio. Ele existe só pra que uma falha exótica no laço não deixe o
    // aviso preso na tela pra sempre.
    //
    // Quem falhou VOLTA PRA FILA (ver `enviarLote`) e reaparece como card —
    // é esse o retorno em caso de erro. O aviso de fim que existia aqui dizia
    // "N rejeitados" com o N ORIGINAL, então mentia justamente quando algo
    // dava errado.
    const andando = (q) => t(q === 1 ? 'auto.andando' : 'auto.andandoPlural', { n: q, autor });
    const aviso = showToast(andando(n), 'hint', 600000);
    try {
        await enviarLote(alvos, {
            silencioso: true,
            contarAoLandar: true,
            aoProgredir: (faltam) => {
                if (faltam > 0) aviso.texto(andando(faltam));
            },
        });
    } finally {
        recusaAutomaticaRodando = false;
        // Acabou: o aviso sai. Desligar o automático de alguém continua onde
        // sempre esteve — o interruptor da lista, na aba Histórico.
        aviso.dispensar();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  A série de um autor: ver primeiro, ou rejeitar os que estão na fila
// ═══════════════════════════════════════════════════════════════════════════
//
// Abre pelo selo `✕ N`. NÃO há tela de confirmação depois: o número vai no
// próprio botão e o aviso diz que começa ao tocar — que é exatamente o que uma
// segunda pergunta carregaria. Confirmação que só repete o número treina todo
// mundo a tocar sem ler.
//
// O lote vai UM A UM, e isso não é preguiça: o lote atômico do WME falha
// INTEIRO quando outro editor já tratou um dos itens (o mesmo caso que a app
// já sabe tratar como `already_processed`). N requisições que sempre terminam
// valem mais que uma que às vezes morre inteira.
const ICONE_OLHO = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5'
    + 'c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
const ICONE_X = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>';
// A lixeira é a MESMA da lista do Histórico — mesmo conceito, mesmo ícone em
// toda a app. Era um `const lixo` local do `renderAutores`; virou módulo quando
// a folha do autor passou a oferecer o mesmo esquecer.
const ICONE_LIXO = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"'
    + ' d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0'
    + ' 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
// Raio = "acontece sozinho", que é exatamente o que a recusa automática faz.
const ICONE_RAIO = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>';

// Os pedidos DESTE autor que estão na fila carregada agora.
function pedidosDoAutorNaFila(place) {
    const id = place && place.creatorId;
    if (id === null || id === undefined || id === '') return [];
    return (AppState.queue || []).filter((x) => x && x.creatorId === id);
}

// A folha se adapta ao TAMANHO da fila, e é essa adaptação que justifica o selo
// vermelho ser sempre tocável.
//
// Com MAIS DE UM pedido na fila há trabalho em lote de verdade: ver todos na
// frente, rejeitar todos de uma vez (destrutivo, sem Desfazer depois de enviado).
//
// Com UM SÓ — o caso de ~3 em cada 4 cards — essas duas linhas seriam o card que
// já está na tela, com os três botões logo abaixo, e a de rejeitar seria ESTRITAMENTE
// PIOR que o ✕: o lote não tem a janela de Desfazer que o card único tem. Então
// elas somem, e o que fica é o que o card NÃO consegue mostrar:
//   · o que "✕ N" quer dizer — o `title` do selo não existe no toque, e este é o
//     único jeito de descobrir num celular o que aquele número conta;
//   · a recusa automática deste autor, que hoje só se alcança por Filtros →
//     Histórico, rolando até achar a pessoa;
//   · o esquecer, pra quando você discorda da contagem.
// Esses três valem nos DOIS tamanhos, então ficam sempre.
function abrirFolhaDoAutor(place) {
    if (!place) return;
    const corpo = document.getElementById('autorCorpo');
    const titulo = document.getElementById('autorTitle');
    if (!corpo || !titulo) return;
    const naFila = pedidosDoAutorNaFila(place);
    const emLote = naFila.length > 1;
    const chave = String(place.creatorId);
    const nome = place.createdBy || chave;
    titulo.textContent = nome;
    const linha = (ic, cor, t1, t2, id) =>
        `<button type="button" id="${id}" class="flex items-center gap-3 w-full min-h-[56px] py-2 text-left`
        + ` border-b border-slate-100 dark:border-slate-700 last:border-0">`
        + `<span class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${cor}">${ic}</span>`
        + `<span class="flex-1 min-w-0"><span class="block text-[0.9375rem] font-semibold text-slate-800 dark:text-slate-100 leading-tight">`
        + `${escapeHtml(t1)}</span><span class="block text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">`
        + `${escapeHtml(t2)}</span></span></button>`;
    // O interruptor é uma LINHA-label, não um botão: o alvo de 44px é a linha
    // inteira (aqui dá, ao contrário da lista do Histórico, que também tem a
    // lixeira na mesma linha e um toque perto dela alternaria sem querer).
    const linhaAuto = () =>
        `<label class="flex items-center gap-3 w-full min-h-[56px] py-2 text-left cursor-pointer`
        + ` border-b border-slate-100 dark:border-slate-700 last:border-0">`
        + `<span class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0`
        + ` bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">${ICONE_RAIO}</span>`
        + `<span class="flex-1 min-w-0"><span class="block text-[0.9375rem] font-semibold text-slate-800 dark:text-slate-100 leading-tight">`
        + `${escapeHtml(t('stats.autores.auto'))}</span><span class="block text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">`
        + `${escapeHtml(t('stats.autores.autoDesc'))}</span></span>`
        + `<input type="checkbox" id="autorAuto" class="ui-switch flex-shrink-0"${autoLigado(chave) ? ' checked' : ''}></label>`;
    corpo.innerHTML =
        `<p class="text-[0.8125rem] text-slate-500 dark:text-slate-400 mb-4 leading-snug">`
        + `${escapeHtml(t(emLote ? 'autor.sheet.sub' : 'autor.sheet.subUm',
                          { n: contagemDoAutor(place), fila: naFila.length, dias: AUTORES_MAX_DIAS }))}</p>`
        + (emLote
            ? linha(ICONE_OLHO, 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                    t('autor.sheet.ver', { n: naFila.length }), t('autor.sheet.ver.desc'), 'autorVer')
              + linha(ICONE_X, 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
                      t('autor.sheet.rejeitar', { n: naFila.length }), t('autor.sheet.rejeitar.desc'), 'autorRejeitar')
            : '')
        // Mesmo portão da lista do Histórico: mostrar o interruptor desabilitado
        // anunciaria um recurso que a pessoa não pode usar, e a app não faz isso.
        + (podeRecusarAutomaticoAqui() ? linhaAuto() : '')
        + linha(ICONE_LIXO, 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                t('stats.autores.esquecer'), t('autor.sheet.esquecer.desc'), 'autorEsquecer')
        // O aviso é da rejeição em LOTE, então acompanha a linha que ele descreve.
        // Sem ela na tela, um aviso vermelho sobre "não há segunda pergunta"
        // descreveria o interruptor errado — e o interruptor tem a própria frase.
        + (emLote
            ? `<p class="mt-4 text-xs leading-relaxed text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-500/10`
              + ` border border-rose-100 dark:border-rose-500/30 rounded-xl px-3 py-2.5">${t('autor.sheet.aviso')}</p>`
            : '');
    if (emLote) {
        document.getElementById('autorVer').addEventListener('click', () => {
            closeModal('autorModal');
            focarAutor(place.creatorId);
        });
        document.getElementById('autorRejeitar').addEventListener('click', () => {
            closeModal('autorModal');
            rejeitarLoteDoAutor(place);
        });
    }
    const auto = document.getElementById('autorAuto');
    // Relê o estado depois de alternar em vez de confiar no `.checked`: se o
    // `alternarAutoDoAutor` recusar (registro sumiu por poda entre o render e o
    // toque), o interruptor volta sozinho em vez de mentir que ligou.
    if (auto) auto.addEventListener('change', () => {
        alternarAutoDoAutor(chave);
        auto.checked = autoLigado(chave);
    });
    document.getElementById('autorEsquecer').addEventListener('click', () => {
        closeModal('autorModal');
        esquecerAutor(chave);
        // O selo que abriu esta folha some agora: fechar deixando o `✕ N` na tela
        // faria a app afirmar uma contagem que ela acabou de apagar.
        removeCurrentCardEl();
        showCurrentPlace();
    });
    openModal('autorModal');
}

// O lote, com a MESMA janela de Desfazer de um card só — a trava dos botões, o
// banner com a contagem, o `resetQueue`. A diferença é `aoSair: 'cancel'`.
function rejeitarLoteDoAutor(place) {
    if (acoesTravadas()) return;
    if (Treino.ativo) { showToast(t('treino.semLote'), 'info'); return; }
    const places = pedidosDoAutorNaFila(place);
    if (places.length === 0) { showToast(t('toast.batchEmpty'), 'info'); return; }
    const n = places.length;
    // Otimista, como o card único: o placar anda agora e volta no Desfazer.
    AppState.stats.rejected += n;
    AppState.serverTotal = Math.max(0, AppState.serverTotal - n);
    updateStats();
    saveStats();
    const ids = new Set(places);
    AppState.queue = (AppState.queue || []).filter((x) => !ids.has(x));
    AppState.currentPlace = null;
    updatePendingCount();
    if (AppState.queue.length > 0) { removeCurrentCardEl(); showCurrentPlace(); maybePrefetch(); }
    else if (AppState.hasMore) { removeCurrentCardEl(); startFetching(); }
    else { removeCurrentCardEl(); showNoPlaces(); }
    scheduleAction('reject', places, () => enviarLote(places), { aoSair: 'cancel' });
}

// Um a um, e o resultado NÃO é um número só: cada pedido tem destino próprio.
// "Já tratado por outro editor" conta como cumprido — é a mesma regra que a app
// usa no card único, e chamá-lo de falha aqui daria dois nomes à mesma coisa.
// `silencioso` existe pra recusa automática: lá quem presta contas é o banner
// (que já diz o número e oferece desligar), e abrir a folha por cima do card
// seria a app interrompendo por algo que o editor não pediu.
// `contarAoLandar` troca o placar OTIMISTA pelo placar que anda junto com o
// envio. O lote manual (que tem janela de Desfazer) precisa do otimista: ele
// mostra o resultado antes de mandar, e o Desfazer devolve. A recusa automática
// não tem janela nenhuma — contar antes ali criaria uma divergência que ninguém
// pode reconciliar se a página morrer no meio do laço.
// `aoProgredir` recebe quantos AINDA FALTAM, pra quem quiser mostrar.
async function enviarLote(places, opts = {}) {
    const conta = { ok: 0, ja: 0, erro: 0 };
    const aoLandar = !!opts.contarAoLandar;
    const progresso = () => {
        if (aoLandar) { updateStats(); saveStats(); updatePendingCount(); }
        if (opts.aoProgredir) opts.aoProgredir(places.length - conta.ok - conta.ja - conta.erro, conta);
    };
    AppState.inFlightActions++;
    updateInFlightIndicator();
    try {
        for (const p of places) {
            const r = await callWithRetry(() => API.rejectPlace(p.venueID, p.updateRequestID));
            if (r && r.success) {
                conta.ok++;
                recordHistory('reject', 1);
                registrarRejeicaoDeAutor(p);
                if (aoLandar) {
                    AppState.stats.rejected++;
                    AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
                }
            } else if (r && (r.errorCategory === 'already_processed' || r.errorCategory === 'not_found')) {
                conta.ja++;
                if (aoLandar) AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
            } else if (r && r.errorCategory === 'unauthorized') {
                handleUnauthorized();
                return;
            } else {
                conta.erro++;
                // O que não saiu volta pra fila. Com o placar otimista é preciso
                // devolver o número junto; contando ao landar não há o que devolver,
                // porque o número nunca foi somado.
                if (!aoLandar) {
                    AppState.stats.rejected = Math.max(0, AppState.stats.rejected - 1);
                    AppState.serverTotal++;
                }
                AppState.queue.push(p);
            }
            progresso();
        }
    } finally {
        AppState.inFlightActions = Math.max(0, AppState.inFlightActions - 1);
        updateInFlightIndicator();
        updateStats();
        saveStats();
        updatePendingCount();
    }
    if (!opts.silencioso) mostrarResultadoDoLote(conta);
}

function mostrarResultadoDoLote(conta) {
    const corpo = document.getElementById('autorCorpo');
    const titulo = document.getElementById('autorTitle');
    if (!corpo || !titulo) return;
    const total = conta.ok + conta.ja + conta.erro;
    titulo.textContent = t('autor.lote.titulo', { n: total });
    const linha = (emoji, cor, t1, t2) =>
        `<div class="flex items-start gap-3 py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-0">`
        + `<span class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-base font-extrabold ${cor}"`
        + ` aria-hidden="true">${emoji}</span>`
        + `<span class="flex-1 min-w-0"><span class="block text-[0.9375rem] font-semibold text-slate-800 dark:text-slate-100 leading-tight">`
        + `${escapeHtml(t1)}</span><span class="block text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">`
        + `${escapeHtml(t2)}</span></span></div>`;
    let html = '';
    if (conta.ok) html += linha('✓', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-300',
        t('autor.lote.rejeitados', { n: conta.ok }), t('autor.lote.rejeitados.desc'));
    if (conta.ja) html += linha('👍', 'bg-sky-100 text-sky-800 dark:bg-sky-400/20 dark:text-sky-200',
        t('autor.lote.jaTratados', { n: conta.ja }), t('autor.lote.jaTratados.desc'));
    if (conta.erro) html += linha('!', 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
        t('autor.lote.falharam', { n: conta.erro }), t('autor.lote.falharam.desc'));
    corpo.innerHTML = html;
    openModal('autorModal');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Reincidência de autor — quantos pedidos DESTA pessoa você já rejeitou
// ═══════════════════════════════════════════════════════════════════════════
//
// O caso que originou: um entregador fotografa o PACOTE em cada parada, e o
// rótulo costuma trazer nome, endereço e telefone do destinatário. Não é foto
// ruim — é dado pessoal de terceiro indo pro mapa público, e o mesmo autor
// repete por semanas.
//
// O que a app NÃO consegue: distinguir esse autor do melhor contribuinte da
// fila pelos metadados. Medido — os dois são 100% foto, 1 foto por local, e o
// ritmo se sobrepõe. O único sinal que separa é a SUA rejeição repetida, e
// esse a app jogava fora: o histórico só guardava números por dia.
//
// ── POR QUE DUAS LISTAS, e não um mapa só ────────────────────────────────
// Medido na fila real (4.008 pedidos, 12 países, varredura só-leitura):
// 87% dos autores mandam UM pedido só (81–91% conforme o país), e a fila do
// owner recebe ~360 autores distintos por dia. Guardar todo autor rejeitado
// num mapa com nome e datas estouraria 2.000 registros em menos de uma semana
// e chegaria a 88 ms de gravação POR SWIPE — atacando exatamente o ritmo que
// o recurso existe pra devolver.
//
// Então quem foi rejeitado UMA vez mora num anel de ids (sem nome, sem data) e
// só é promovido ao mapa caro na SEGUNDA rejeição. Medido: 41 KB e 0,87 ms.
const AUTORES_KEY = 'waze_places_autores';
// Teto do mapa dos que repetiram. Ao encher, sai quem tem a rejeição mais
// antiga — é o que torna o custo CONSTANTE, não importa quantos anos de uso.
const AUTORES_MAX_REINCIDENTES = 500;
// Teto do anel dos vistos-uma-vez. Só ids, sem nome e sem data.
//
// O número sai dos 30 DIAS logo abaixo, não de performance — e essa é a parte
// que engana. O mapa expira por IDADE; o anel expira por CAPACIDADE. Se ele não
// segurar 30 dias de rejeições, a app deixa de promover quem foi rejeitado no
// dia 1 e no dia 25, porque o id do dia 1 já saiu por lotação. A promessa que o
// próprio card faz ("entra quem você rejeitou 2 vezes") quebra EM SILÊNCIO, e o
// editor não tem como perceber.
//
// Era 2.000, e a fila real do owner mostrou o buraco: 856 rejeições numa semana
// (~120/dia, ~100 delas entrando no anel) davam **19 dias** de memória contra os
// 30 prometidos. 4.000 dá ~38.
//
// Performance NÃO é o limite aqui, e a tabela do mapa (mais acima, no
// CLAUDE.md) não vale pra este anel: ela mede `nome → [contagem, datas]`, que é
// muito mais pesado por entrada. MEDIDO no ciclo completo de uma rejeição
// (ler + procurar + gravar), num Chromium com a CPU 6× lenta:
//   anel 2.000 → 4,04 ms · 4.000 → 4,32 ms · 8.000 → 4,72 ms
// Um quadro a 60fps são 8,3 ms, então dobrar custou 0,28 ms — ruído. Tamanho no
// aparelho: 39,6 KB → 63,0 KB.
//
// O que tornaria este número errado: um editor que rejeite MUITO mais que ~130
// por dia volta a não cobrir os 30 dias. O conserto definitivo seria guardar o
// DIA junto do id e podar por idade, como o mapa faz — aí o teto deixa de ser
// palpite sobre o ritmo de quem usa. Fica como decisão separada: muda o formato
// gravado e exige migração.
const AUTORES_MAX_VISTOS = 4000;
// ANISTIA, e não só arrumação — a razão é do owner: "30 dias é para tirar a
// pessoa do castigo caso o editor esqueça de desmarcar do automático e/ou o
// editor use muito pouco o app". Ou seja, o prazo protege o AUTOR de um
// esquecimento nosso, não o arquivo do tamanho. Quem continua mandando tem a
// data renovada a cada rejeição (inclusive as automáticas), então o prazo só
// corre pra quem de fato parou.
const AUTORES_MAX_DIAS = 30;
// Quantas linhas a lista mostra antes do "Ver mais N". NÃO é gosto: medido na
// fila real do owner, 232 pedidos deram 174 autores distintos e 23 com 2+
// rejeições — e os 10 primeiros são os que repetem de verdade (o resto tem
// contagem 2–3). Cortar em 5 esconderia 8 de 13 num caso comum, o que faz do
// botão parada obrigatória em vez de atalho; cortar em 15 quase não cortaria.
//
// O ganho é a altura ficar CONSTANTE: medido a 390×844, a lista inteira custa
// 2,4 telas com 23 autores, 7,1 com 100 e 34,9 com 500 (59px por linha, sempre);
// com o teto são 1,2 tela em qualquer tamanho. Render nunca foi o problema
// (22ms com 500) — o custo é o polegar.
const AUTORES_VISIVEIS = 10;
// Acima disto o selo passa de cinza (a app CONTA) a rosa (a app DESTACA).
//
// Era 10, e a justificativa escrita aqui dizia que "o maior lote de um mesmo
// autor num único instantâneo foi 7", logo 10 exigiria repetição ENTRE buscas.
// REMEDIDO em 2026-09-01 nos 6 países obrigatórios, 1.967 autores: essa frase
// não vale mais. O maior lote num instantâneo é 30 (Espanha), com 25 em
// Portugal, 24 na França e 17 no Brasil — o 10 já era ultrapassado por uma
// única busca, então ele não garantia mais o que prometia.
//
// Baixar pra 6 é decisão do owner. O efeito medido: num instantâneo dos 6
// países, o rosa passaria de 6 para 17 autores — de 1.967, ou seja menos de 1%
// nos dois casos. Não é a diferença entre "discreto" e "gritante".
//
// Se um dia alguém quiser um limiar que signifique de novo "voltou em outro
// dia", o caminho não é o número: é comparar a DATA da primeira rejeição com a
// da última, que o registro já guarda.
const AUTOR_LIMIAR_DESTAQUE = 6;

const diaDeHoje = () => Math.floor(Date.now() / 86400000);

function loadAutores() {
    if (AppState.autores) return AppState.autores;
    let a = null;
    try { a = JSON.parse(localStorage.getItem(AUTORES_KEY) || 'null'); } catch (e) { a = null; }
    if (!a || typeof a !== 'object') a = {};
    if (!Array.isArray(a.v)) a.v = [];
    if (!a.r || typeof a.r !== 'object') a.r = {};
    AppState.autores = a;
    if (podarAutores(a)) salvarAutores(a);
    return a;
}

function salvarAutores(a) {
    try { localStorage.setItem(AUTORES_KEY, JSON.stringify(a)); } catch (e) {}
}

// Poda por TEMPO e por TETO, nessa ordem: o tempo tira o que não informa mais,
// o teto garante que o custo pare de crescer mesmo se o tempo não bastar.
function podarAutores(a) {
    let mudou = false;
    const limite = diaDeHoje() - AUTORES_MAX_DIAS;
    for (const id of Object.keys(a.r)) {
        const e = a.r[id];
        if (!Array.isArray(e) || !Number.isFinite(e[2]) || e[2] < limite) { delete a.r[id]; mudou = true; }
    }
    const ids = Object.keys(a.r);
    if (ids.length > AUTORES_MAX_REINCIDENTES) {
        // Sai quem tem a rejeição mais ANTIGA — não quem tem a menor contagem:
        // contagem alta e parada há um mês informa menos que contagem 2 de hoje.
        ids.sort((x, y) => (a.r[x][2] || 0) - (a.r[y][2] || 0));
        for (const id of ids.slice(0, ids.length - AUTORES_MAX_REINCIDENTES)) delete a.r[id];
        mudou = true;
    }
    if (a.v.length > AUTORES_MAX_VISTOS) { a.v = a.v.slice(-AUTORES_MAX_VISTOS); mudou = true; }
    return mudou;
}

// Chaveado pelo ID, nunca pelo nome. 69% dos autores da fila real são anônimos
// `world_xxxxx` — nome GERADO pra quem nunca escolheu um, e que muda no dia em
// que a pessoa escolhe. Pelo nome, o histórico sumiria justamente aí.
function registrarRejeicaoDeAutor(place) {
    const id = place && place.creatorId;
    if (id === null || id === undefined || id === '') return;
    const chave = String(id);
    const a = loadAutores();
    const nome = (place.createdBy && String(place.createdBy)) || chave;
    const hoje = diaDeHoje();
    if (a.r[chave]) {
        const e = a.r[chave];
        e[0] = (e[0] || 1) + 1;
        e[1] = nome;   // o nome de EXIBIÇÃO acompanha: se a pessoa escolheu um, mostra o novo
        e[2] = hoje;
    } else {
        const i = a.v.indexOf(chave);
        if (i === -1) {
            a.v.push(chave);
            if (a.v.length > AUTORES_MAX_VISTOS) a.v.shift();
        } else {
            a.v.splice(i, 1);
            a.r[chave] = [2, nome, hoje];
            podarAutores(a);
        }
    }
    salvarAutores(a);
}

// Quantas rejeições SUAS este autor acumulou. 0 ou 1 devolve 0: o anel não
// guarda contagem, e "1" não é reincidência — é uma rejeição.
function contagemDoAutor(place) {
    const id = place && place.creatorId;
    if (id === null || id === undefined || id === '') return 0;
    const e = loadAutores().r[String(id)];
    return Array.isArray(e) ? (e[0] || 0) : 0;
}

function esquecerAutor(chave) {
    const a = loadAutores();
    if (!a.r[chave]) return;
    delete a.r[chave];
    salvarAutores(a);
    renderHistory();
}

// Ordena por contagem, depois pelo mais recente — quem mais repetiu primeiro.
function listaDeAutores() {
    const a = loadAutores();
    return Object.entries(a.r)
        .map(([id, e]) => ({ id, n: e[0] || 0, nome: e[1] || id, dia: e[2] || 0 }))
        .sort((x, y) => (y.n - x.n) || (y.dia - x.dia));
}

function esquecerAutores() {
    AppState.autores = null;
    safeLS.remove(AUTORES_KEY);
}

// O registro guarda o DIA, não o instante — então a frase é em dias. Usar o
// `formatRelativeTime` do app (que desce a horas e minutos) fazia algo de hoje
// de manhã aparecer como "há 12h": precisão que o dado não tem.
//
// É o MESMO dia que a poda usa (`e[2]`), então esta linha é o relógio da
// anistia à vista: 30 dias depois do que ela mostra, o autor sai da lista.
function rejeitadoQuando(dia) {
    const n = diaDeHoje() - dia;
    if (!Number.isFinite(n) || n <= 0) return t('stats.autores.rejeitadoHoje');
    return t(n === 1 ? 'stats.autores.rejeitadoDias' : 'stats.autores.rejeitadoDiasPlural', { n });
}

// Expandido é estado de SESSÃO da lista, não preferência: o padrão é a lista
// curta, e reabrir o painel volta a ele (limpo em LIMPEZA_AO_FECHAR). Precisa
// sobreviver ao re-render, porém — o painel é redesenhado inteiro a cada
// esquecimento e a cada troca de interruptor, e perder a expansão ali jogaria
// o editor de volta pro topo no meio de uma faxina.
let autoresExpandido = false;

// A lista fica ABAIXO do placar do editor, nunca no lugar dele. E some inteira
// quando ninguém repetiu — seção vazia num painel curto é ruído, não informação.
function renderAutores() {
    const el = document.getElementById('autoresBody');
    if (!el) return;
    const todas = listaDeAutores();
    if (todas.length === 0) { el.innerHTML = ''; return; }
    // Só corta se SOBRA alguém: com 10 autores exatos nada é escondido e o botão
    // não existe. Botão dizendo "ver mais 0" — ou sumindo sem explicação — é pior
    // que não ter teto nenhum.
    const escondidas = autoresExpandido ? 0 : Math.max(0, todas.length - AUTORES_VISIVEIS);
    const linhas = escondidas > 0 ? todas.slice(0, AUTORES_VISIVEIS) : todas;
    const lixo = ICONE_LIXO;
    el.innerHTML =
        `<p class="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">${escapeHtml(t('stats.autores.title'))}</p>`
        + `<p class="text-xs text-slate-500 dark:text-slate-400 mb-2 leading-snug">`
        + `${escapeHtml(t('stats.autores.desc', { dias: AUTORES_MAX_DIAS }))}`
        + (podeRecusarAutomaticoAqui() ? ' ' + escapeHtml(t('stats.autores.autoDesc')) : '')
        + `</p>`
        + linhas.map((a) =>
            // `flex-wrap` + `basis-full` na data: ela vai pra uma SEGUNDA linha,
            // com a largura inteira da lista. Dentro da coluna do nome ela não
            // cabia — o selo, o interruptor e a lixeira apertam essa coluna a
            // ~55px num Fold, e "rejeté il y a 22 jours" quebrava em TRÊS
            // pedaços. Medido: a largura do nome é a MESMA nos dois arranjos,
            // então isto não tira nada dele.
            `<div class="autor-lin flex flex-wrap items-center gap-x-2 min-h-[44px] border-b border-slate-100 dark:border-slate-700 last:border-0">`
            + `<span class="flex-1 min-w-0 text-sm font-medium text-slate-700 truncate dark:text-slate-200">${escapeHtml(a.nome)}</span>`
            + `<span class="selo-proc ${a.n >= AUTOR_LIMIAR_DESTAQUE ? 'selo-reinc' : 'selo-src'} flex-shrink-0">`
            + `✕ ${a.n}</span>`
            // O interruptor da recusa automática só EXISTE pra quem passa no
            // portão: mostrá-lo desabilitado anunciaria um recurso que a pessoa
            // não pode usar, e a app não faz isso em nenhum outro lugar.
            + (podeRecusarAutomaticoAqui()
                // O <label> de 44px é o ALVO; o interruptor em si tem 26px de
                // altura (componente padrão da app). Nas Preferências o alvo vem
                // da linha inteira ser um label — aqui não dá, porque a linha
                // também tem a lixeira, e um toque perto dela alternaria o
                // automático sem querer.
                ? `<label class="flex items-center min-h-[44px] flex-shrink-0 cursor-pointer">`
                  + `<input type="checkbox" class="ui-switch autor-auto"`
                  + ` data-autor="${escapeHtml(a.id)}"${autoLigado(a.id) ? ' checked' : ''}`
                  + ` title="${escapeHtml(t('stats.autores.auto'))}"`
                  + ` aria-label="${escapeHtml(t('stats.autores.auto'))}"></label>`
                : '')
            + `<button type="button" class="autor-esquecer min-w-[44px] min-h-[44px] flex items-center justify-center`
            + ` text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded-full flex-shrink-0"`
            + ` data-autor="${escapeHtml(a.id)}" title="${escapeHtml(t('stats.autores.esquecer'))}"`
            + ` aria-label="${escapeHtml(t('stats.autores.esquecer'))}">${lixo}</button>`
            // `-mt-1.5` recolhe a folga que o min-h-[44px] da linha de cima já
            // deixou: sem isso a data flutua longe do nome que ela descreve.
            + `<span class="basis-full text-[0.6875rem] text-slate-500 dark:text-slate-400 leading-tight -mt-1.5 pb-1.5">`
            + `${escapeHtml(rejeitadoQuando(a.dia))}</span>`
            + `</div>`).join('')
        // Largura cheia e 44px de alvo, como todo botão da app. O número vai NO
        // rótulo porque "Ver mais" sozinho não diz se são 3 ou 300 — e é isso que
        // decide se vale o toque. O "Ver menos" existe porque sem ele expandir é
        // irreversível sem fechar o modal.
        + (escondidas > 0 || autoresExpandido
            ? `<button type="button" id="autoresVerMais" class="w-full min-h-[44px] mt-2 mb-4`
              + ` border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-semibold`
              + ` text-cyan-700 dark:text-cyan-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition">`
              + `${escapeHtml(autoresExpandido
                    ? t('stats.autores.verMenos')
                    : t(escondidas === 1 ? 'stats.autores.verMais' : 'stats.autores.verMaisPlural',
                        { n: escondidas }))}</button>`
            : '');
    const verMais = document.getElementById('autoresVerMais');
    if (verMais) verMais.addEventListener('click', () => {
        autoresExpandido = !autoresExpandido;
        renderAutores();
        // Ao recolher, o botão sobe junto com a lista e o dedo fica sobre outra
        // coisa. Devolver a lista ao campo de visão é o mínimo pra não parecer
        // que a app pulou pra outro lugar.
        if (!autoresExpandido) el.scrollIntoView({ block: 'nearest' });
    });
    // Delegação seria mais curta, mas o painel é re-renderizado inteiro a cada
    // esquecimento — o listener por linha morre junto com a linha.
    for (const b of el.querySelectorAll('.autor-esquecer')) {
        b.addEventListener('click', () => esquecerAutor(b.dataset.autor));
    }
    for (const c of el.querySelectorAll('.autor-auto')) {
        c.addEventListener('change', () => alternarAutoDoAutor(c.dataset.autor));
    }
}

function renderHistory() {
    const el = document.getElementById('historyBody');
    if (!el) return;
    const s = getHistoryStats();
    renderAutores();
    if (s.total.read + s.total.rejected === 0) {
        el.innerHTML = `<p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t('stats.history.empty'))}</p>`;
        return;
    }
    const rows = [['today', s.today], ['week', s.week], ['month', s.month], ['total', s.total]];
    el.innerHTML = rows.map(([k, v]) =>
        `<div class="flex justify-between items-baseline text-sm py-0.5">` +
        `<span class="text-slate-600 dark:text-slate-300">${escapeHtml(t('stats.history.' + k))}</span>` +
        `<span class="tnum font-medium"><span class="text-emerald-700 dark:text-emerald-400">${v.read}</span>` +
        ` · <span class="text-rose-600 dark:text-rose-400">${v.rejected}</span></span></div>`
    ).join('');
}

// Na PRIMEIRA vez que cada ação é confirmada pelo Waze, diz o que ela fez lá —
// não o que ela quis dizer aqui. A app explicava a INTENÇÃO ("o pedido não deve
// entrar no mapa") e nunca a CONSEQUÊNCIA, e as duas divergem no caso que mais
// importa: marcar como lido NÃO aprova nada, mas o ✓ verde diz o contrário pra
// quem chegou agora.
//
// Dispara na CONFIRMAÇÃO, não no gesto: durante a janela de Desfazer nada foi
// enviado ainda, e "rejeição enviada" ali seria mentira — além de disputar a
// tela com o banner do Desfazer.
function avisarConsequencia(actionType) {
    if (!CONSEQUENCIA_AVISADA[actionType]) return;
    const vistas = AppState.preferences.consequenciaVista || {};
    if (vistas[actionType]) return;
    vistas[actionType] = true;
    AppState.preferences.consequenciaVista = vistas;
    savePreferences();
    showToast(t('consequencia.' + actionType), 'hint', 7000);
}
// Só as que ESCREVEM no Waze. Pular é local — o pedido volta na próxima busca,
// e isso o treino e o "Como funciona" já dizem.
const CONSEQUENCIA_AVISADA = { reject: true, read: true };

function handleActionResult(actionType, place, result) {
    if (!result) return;
    if (result.success) {
        recordHistory(actionType, 1);
        // Só REJEIÇÃO conta reincidência. Marcar como lido não é juízo
        // sobre o pedido — é "eu vi" —, e contá-lo transformaria quem
        // manda muita coisa BOA em reincidente.
        if (actionType === 'reject') registrarRejeicaoDeAutor(place);
        avisarConsequencia(actionType);
        return;
    }

    const cat = result.errorCategory || 'unknown';

    if (cat === 'already_processed' || cat === 'not_found') {
        recordHistory(actionType, 1);
        showToast(t('toast.alreadyProcessed'), 'info');
        return;
    }

    if (cat === 'unauthorized') {
        handleUnauthorized();
        return;
    }

    const statKey = actionType === 'read' ? 'read' : 'rejected';
    AppState.stats[statKey] = Math.max(0, AppState.stats[statKey] - 1);
    AppState.serverTotal++;
    updateStats();
    saveStats();
    const verb = actionType === 'read' ? t('action.verb.read') : t('action.verb.reject');
    showToast(msgDoServidor(result, t('toast.actionError', { verb })), 'error');
}


// ── Modo treino: errar sem consequência ───────────────────────────────────
// Duas das três ações ESCREVEM no Waze em nome da pessoa, e a rejeição não tem
// volta depois dos 3s. Numa app assim, poder errar de mentira vale mais que
// qualquer texto explicativo — e é a única forma de "pegar na mão" que não cobra
// nada de quem já sabe, porque só entra quem pede.
//
// O owner apontou o que decide o desenho: "os testadores atuais não enxergam
// problemas de UX/UI pois já estão acostumados, só os novos que ficam
// perguntando". Ajuda que interrompe todo mundo pra atender o novato cobra o
// preço da fila inteira — daí sob demanda, e não automático.
//
// A TRAVA É ESTRUTURAL, não uma promessa: o guard está no TOPO de
// handleReject/handleMarkAsRead/handleSkip, antes de mexer em stat, em fila ou
// em `scheduleAction`. Não existe caminho em que um card de treino chegue ao
// `API.rejectPlace`. O smoke mede isso pela REDE, não lendo o código.
// Fecha as camadas presas ao pedido atual. Usada nas duas pontas da troca de
// modo (entrar/sair do treino): o que está aberto pertence ao pedido do outro
// lado, e reaproveitar a camada exigiria manter cada controle dela coerente com
// o modo novo — uma regra por controle, todas dependentes de ordem.
function fecharCamadasDeFoto() {
    if (typeof Lightbox !== 'undefined' && Lightbox.isOpen()) Lightbox.close();
    if (typeof MapaLightbox !== 'undefined' && MapaLightbox.isOpen()) MapaLightbox.close();
}

const Treino = {
    ativo: false,
    _salvo: null,
    passo: 0,

    // O `updateRequestID` que substitui o real. As duas escritas do card
    // (`validar-place` e `marcar-lido`) precisam de venueID E updateRequestID,
    // então um pedido de treino não endereça pedido nenhum: se algum dia
    // vazasse, o Waze responderia 702 "not found on venue" — que a app já trata
    // como "já tratado por outro editor". É a segunda camada; a primeira é o
    // guard no topo dos handlers.
    //
    // O `venueID` fica REAL de propósito: é ele que o ↗ usa pra abrir o lugar
    // certo no WME, e um treino que leva a um editor vazio ensinaria errado.
    // Quem protege as escritas que usam só o venueID (foto) é o guard delas.
    UR_INERTE: 'treino-inerte',

    // Clona fundo: o objeto real continua intocado na fila salva, e nada do que
    // acontecer no treino pode alcançá-lo por referência.
    neutralizar(p) {
        const c = JSON.parse(JSON.stringify(p));
        c.updateRequestID = this.UR_INERTE;
        c._treino = true;
        return c;
    },

    // Quantos pedidos reais o treino usa. 30 é o tamanho de UMA PÁGINA do WME
    // (ele pagina a lista em blocos de 30), então é a unidade mental que o
    // editor já tem — pedido do owner.
    MAX_REAIS: 30,
    // Piso: abaixo disto o treino completa com sintéticos. Fila vazia não pode
    // deixar ninguém sem treino, e é justamente no primeiro minuto — logo depois
    // do "Como funciona" — que a fila tem menos chance de já ter carregado.
    MIN_CARDS: 3,

    // O que faz um card ENSINAR algo que o anterior não ensinou. `updateTypeKey`
    // é o rótulo do card (separa UPDATE com e sem diff), e ter foto muda a tela
    // inteira: é o carrossel, o lightbox, a lixeira e o aprovar.
    chaveDeVariedade(p) {
        return (p.updateTypeKey || '—') + '|' + ((p.imageUrls || []).length ? 'foto' : 'sem');
    },

    // Reais em ordem de VARIEDADE, não a ordem da fila — e a diferença é enorme,
    // não cosmética. MEDIDO na fila real do owner (170 pedidos, 10 tipos
    // distintos): os 3 PRIMEIROS da fila são todos do MESMO tipo, então o treino
    // que pegava `slice(0, 3)` mostrava UM tipo de pedido e chamava isso de
    // treino. Pegando 30 em ordem, ainda seriam 7 dos 10.
    //
    // Rodízio (um de cada tipo, depois o segundo de cada…) porque a pessoa PODE
    // sair no meio: assim quem parar no 5º card viu 5 tipos diferentes, e não 5
    // vezes o mesmo. Com 10 grupos, os 10 primeiros cobrem os 10 tipos.
    porVariedade(fila) {
        const grupos = new Map();
        for (const p of fila) {
            const k = this.chaveDeVariedade(p);
            if (!grupos.has(k)) grupos.set(k, []);
            grupos.get(k).push(p);
        }
        const baldes = [...grupos.values()];
        const out = [];
        for (let i = 0; baldes.some((b) => i < b.length); i++) {
            for (const b of baldes) if (i < b.length) out.push(b[i]);
        }
        return out;
    },

    // Reais quando existem, sintéticos só como piso. O exemplo inventado ensina
    // o gesto; o julgamento — foto borrada, nome ruim, endereço errado — só vem
    // no pedido de verdade, e é ele que o treino precisa treinar.
    cards() {
        const fila = (this._salvo && this._salvo.queue) ? this._salvo.queue : [];
        const reais = this.porVariedade(fila).slice(0, this.MAX_REAIS).map((p) => this.neutralizar(p));
        if (reais.length >= this.MIN_CARDS) return reais;
        return [...reais, ...this.sinteticos()].slice(0, this.MIN_CARDS);
    },

    // Exemplos sintéticos: sem foto de propósito (não dependem de rede, e
    // "pedido sem foto" é caso real — 20% da fila medida). Os três cobrem os
    // três desfechos que a pessoa vai encontrar de verdade.
    sinteticos() {
        const base = {
            updateRequestID: 'treino', reqSubType: '', isDelete: false,
            createdBy: t('treino.autor'), creatorRank: 0, source: null,
            flagType: null, flagSubjectType: null, flagEntityID: null, flagComment: '',
            brand: null, brandKnown: null, camposSemMudanca: 0, imageUrls: [],
            mapa: null, isStarred: false, lat: null, lon: null,
            dateAdded: Date.now() - 3600000,
        };
        return [
            { ...base, venueID: 'treino1', name: t('treino.c1.nome'),
              categories: ['RESTAURANT'], address: t('treino.c1.endereco'),
              updateType: 'Novo Local', updateTypeKey: 'VENUE', purType: 'NEW_PLACE',
              reqType: 'VENUE', changes: [] },
            { ...base, venueID: 'treino2', name: t('treino.c2.nome'),
              categories: ['PHARMACY'], address: t('treino.c2.endereco'),
              updateType: 'Atualização', updateTypeKey: 'UPDATE_DETAILS', purType: 'DETAILS_UPDATE',
              reqType: 'REQUEST',
              changes: [{ field: 'phone', label: 'phone', from: '(11) 3333-0000', to: '(11) 4444-1111' }] },
            { ...base, venueID: 'treino3', name: t('treino.c3.nome'),
              categories: ['GAS_STATION'], address: t('treino.c3.endereco'),
              updateType: 'Novo Local', updateTypeKey: 'VENUE', purType: 'NEW_PLACE',
              reqType: 'VENUE', changes: [] },
        ];
    },

    entrar() {
        if (this.ativo) return;
        // Uma janela de Desfazer pendente é de um pedido REAL: despacha antes de
        // trocar a fila debaixo dela, senão ela executaria sobre outro estado.
        if (AppState.pendingAction) { AppState.pendingAction.execute(); AppState.pendingAction = null; }
        removeUndoBanner();
        this._salvo = {
            queue: AppState.queue, currentPlace: AppState.currentPlace,
            stats: AppState.stats, serverTotal: AppState.serverTotal,
            hasMore: AppState.hasMore, fetching: AppState.fetching,
        };
        this.ativo = true;
        this.passo = 0;
        AppState.fetching = false;
        AppState.hasMore = false;
        AppState.stats = { read: 0, rejected: 0, skipped: 0 };
        AppState.queue = this.cards();
        // Do TAMANHO da fila de treino, nunca de um número cravado. Estava em 3
        // enquanto o treino montava 4 cards (1 sintético + 3 reais): o "Restam"
        // zerava com um card ainda na tela — o que a app MOSTRA divergindo do
        // que ela ACEITA, que é a regra de ouro de consistência do projeto.
        AppState.serverTotal = AppState.queue.length;
        AppState.currentPlace = AppState.queue[0];
        document.getElementById('treinoBanner')?.classList.replace('hidden', 'flex');
        document.getElementById('noMoreCards')?.classList.add('hidden');
        showLoading(false);
        updateStats(true);   // troca de contexto: pula, não conta
        updatePendingCount(true);
        showCurrentPlace();
        // Trocar de modo ZERA as camadas: o lightbox (e a renomeação dentro
        // dele) pertencem ao pedido do OUTRO lado, e mantê-los abertos deixaria
        // na tela o confirmar/cancelar de um nome que este modo não vai gravar.
        //
        // Fechar é melhor do que manter cada controle coerente com o modo novo:
        // uma linha em vez de uma regra por controle, e sem depender de ORDEM —
        // que é a forma exata dos dois defeitos que o owner relatou hoje.
        fecharCamadasDeFoto();
    },

    sair() {
        if (!this.ativo) return;
        this.ativo = false;
        const s = this._salvo || {};
        AppState.queue = s.queue || [];
        AppState.currentPlace = s.currentPlace || null;
        AppState.stats = s.stats || { read: 0, rejected: 0, skipped: 0 };
        AppState.serverTotal = s.serverTotal || 0;
        AppState.hasMore = !!s.hasMore;
        AppState.fetching = !!s.fetching;
        this._salvo = null;
        document.getElementById('treinoBanner')?.classList.replace('flex', 'hidden');
        removeCurrentCardEl();
        updateStats(true);
        updatePendingCount(true);
        if (AppState.queue.length) { AppState.currentPlace = AppState.queue[0]; showCurrentPlace(); }
        else if (AppState.hasMore) startFetching();
        else showNoPlaces();
    },

    // Chamado do TOPO dos handlers reais. Explica o que TERIA acontecido e
    // avança — sem stat, sem fila real, sem rede.
    // Um aviso por vez, e o modal final só entra depois que o último foi lido.
    // Sem isso os três se empilham e TAPAM o "Ir para a fila": medido, o botão
    // ficava inalcançável no Galaxy Fold, no iPhone SE e no celular deitado —
    // 3 de 4 aparelhos. É o gotcha #26 de novo (feedback transitório cobrindo o
    // alvo que ainda precisa ser tocado), agora numa tela de aprender a usar.
    limparAvisos() {
        // , não : o segundo é o POSICIONADOR fixo, e
        // limpá-lo apagaria o container. Errei nisso e o throw abortava a ação
        // inteira — o card nem avançava.
        const pilha = document.getElementById('toastContainer');
        if (pilha) [...pilha.children].forEach((n) => n.remove());
        // Simétrico ao entrar(): sair com uma foto de TREINO aberta deixaria o
        // lightbox do modo real em cima de um pedido inerte.
        fecharCamadasDeFoto();
    },

    agir(tipo) {
        if (!this.ativo) return;
        const ultimo = AppState.queue.length <= 1;
        this.limparAvisos();
        // No último, o efeito vai DENTRO do modal final: fora dele viraria um
        // aviso flutuante sobre a área do card já vazia (o swipe animou o card
        // pra fora), e esperar pra ler deixava 2,2s de tela em branco.
        if (!ultimo) showToast(t('treino.efeito.' + tipo), tipo === 'reject' ? 'error' : 'info', 5000);
        AppState.stats[tipo === 'reject' ? 'rejected' : tipo === 'read' ? 'read' : 'skipped']++;
        AppState.serverTotal = Math.max(0, AppState.serverTotal - (tipo === 'skip' ? 0 : 1));
        updateStats();
        AppState.queue.shift();
        AppState.currentPlace = AppState.queue[0] || null;
        this.passo++;
        updatePendingCount();
        // No ÚLTIMO, o card fica na tela enquanto o aviso é lido: tirá-lo deixava
        // 2,2s de área em branco antes do modal final, o que lê como app quebrada.
        // Quem limpa é o `sair()`.
        if (AppState.currentPlace) { removeCurrentCardEl(); showCurrentPlace(); return; }
        const efeito = document.getElementById('treinoFimEfeito');
        if (efeito) {
            efeito.textContent = t('treino.efeito.' + tipo);
            efeito.classList.remove('hidden');
        }
        openModal('treinoFimModal');
    },
};
window.Treino = Treino;

function handleMarkAsRead() {
    if (!AppState.currentPlace) return;
    if (acoesTravadas()) return;   // janela do Desfazer correndo
    // Treino ANTES de tudo: nem stat, nem fila, nem rede.
    if (Treino.ativo) return Treino.agir('read');
    const place = AppState.currentPlace;
    AppState.stats.read++;
    AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
    updateStats();
    saveStats();
    advanceQueue();
    scheduleAction('read', place, async () => {
        const result = await callWithRetry(() => API.markAsRead(place.venueID, place.updateRequestID));
        handleActionResult('read', place, result);
    });
}

function handleReject() {
    if (!AppState.currentPlace) return;
    if (acoesTravadas()) return;   // janela do Desfazer correndo
    // Treino ANTES de tudo: nem stat, nem fila, nem rede.
    if (Treino.ativo) return Treino.agir('reject');
    const place = AppState.currentPlace;
    AppState.stats.rejected++;
    AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
    updateStats();
    saveStats();
    advanceQueue();
    scheduleAction('reject', place, async () => {
        const result = await callWithRetry(() => API.rejectPlace(place.venueID, place.updateRequestID));
        handleActionResult('reject', place, result);
    });
}

function handleSkip() {
    if (!AppState.currentPlace) return;
    if (acoesTravadas()) return;   // janela do Desfazer correndo
    // Treino ANTES de tudo: nem stat, nem fila, nem rede.
    if (Treino.ativo) return Treino.agir('skip');
    const place = AppState.currentPlace;
    AppState.stats.skipped++;
    updateStats();
    saveStats();
    advanceQueue();
    // Skip não envia nada ao Waze (o place segue pendente) — executor no-op.
    // Passa pelo scheduleAction só pra ganhar a janela de Desfazer (feature).
    scheduleAction('skip', place, async () => {});
}

// ── Marcar em lote (o backend já aceita items[]; feature de UI) ────────────
// Marca como lido TODOS os places atualmente na fila local. Como o Waze devolve
// tudo de uma vez (hasMore geralmente false), a fila local ≈ tudo que resta.
function openBatchReadConfirm() {
    // Marcar o LOTE também escreve. No treino a fila é de exemplos: deixar o
    // botão vivo mandaria um lote de ids inertes ao Waze — sem efeito, mas é
    // requisição que ninguém pediu, e o aviso mente sobre o que aconteceu.
    if (Treino.ativo) { showToast(t('treino.semLote'), 'info'); return; }
    const n = AppState.queue.length;
    if (n === 0) { showToast(t('toast.batchEmpty'), 'info'); return; }
    const msgEl = document.getElementById('batchReadMessage');
    if (msgEl) msgEl.textContent = t(n === 1 ? 'modal.batchRead.body' : 'modal.batchRead.bodyPlural', { n });
    openModal('batchReadModal');
}

async function handleBatchMarkRead() {
    closeModal('batchReadModal');
    const items = AppState.queue
        .filter(p => p.venueID && p.updateRequestID)
        .map(p => ({ venueID: p.venueID, updateRequestID: p.updateRequestID }));
    if (items.length === 0) { showToast(t('toast.batchEmpty'), 'info'); return; }
    // Descarrega qualquer undo pendente antes (consistência de estado).
    if (AppState.pendingAction) { AppState.pendingAction.execute(); AppState.pendingAction = null; }
    removeUndoBanner();
    const n = items.length;
    AppState.inFlightActions++;
    updateInFlightIndicator();
    showToast(t('toast.batchMarking', { n }), 'info');
    try {
        const result = await callWithRetry(() => API.markAsReadBatch(items));
        if (result && result.success) {
            AppState.stats.read += n;
            updateStats();
            saveStats();
            resetQueue();       // zera a fila local; startFetching re-busca o que sobrou
            startFetching();
            showToast(t(n === 1 ? 'toast.batchDone' : 'toast.batchDonePlural', { n }), 'success');
        } else if (result && result.errorCategory === 'unauthorized') {
            handleUnauthorized();
        } else {
            showToast(msgDoServidor(result, t('toast.batchError')), 'error');
        }
    } catch (e) {
        showToast(t('toast.batchError'), 'error');
    } finally {
        AppState.inFlightActions = Math.max(0, AppState.inFlightActions - 1);
        updateInFlightIndicator();
    }
}

function advanceQueue() {
    AppState.queue.shift();
    AppState.currentPlace = null;
    updatePendingCount();

    if (AppState.queue.length > 0) {
        showCurrentPlace();
        maybePrefetch();
    } else if (AppState.hasMore) {
        startFetching();
    } else {
        showNoPlaces();
    }

    setTimeout(() => {
        const stack = document.getElementById('cardStack');
        if (!stack) return;
        const hasCard = !!stack.querySelector('.place-card');
        const loadingHidden = document.getElementById('loadingCard').classList.contains('hidden');
        const noMoreHidden = document.getElementById('noMoreCards').classList.contains('hidden');
        if (!hasCard && loadingHidden && noMoreHidden) {
            console.warn('Estado inconsistente após advanceQueue, forçando recuperação');
            if (AppState.queue.length > 0) {
                showCurrentPlace();
            } else if (AppState.hasMore) {
                startFetching();
            } else {
                showNoPlaces();
            }
        }
    }, 200);
}

// `place` aceita UM place ou um ARRAY deles (o lote). Um mecanismo só, de
// propósito: o Desfazer do lote tem que seguir exatamente as mesmas regras do
// Desfazer de um card — a trava dos botões, o banner com a contagem regressiva,
// o descarregamento ao sair, o `resetQueue`. Dois mecanismos seriam duas
// listas de regras pra manter em sincronia, e a segunda envelheceria.
//
// `opts.aoSair` diz o que fazer quando a página morre no meio da janela:
//   'execute' (padrão) — despacha com keepalive. Uma requisição: ou vai ou não.
//   'cancel'           — descarta sem enviar. É o certo pro LOTE, e o motivo é
//                        que N requisições disparadas no `pagehide` completam
//                        PARCIALMENTE: sete vão, sete não, e o placar já contou
//                        as catorze. Meio-lote enviado é a única falha aqui sem
//                        sintoma nenhum — perder o lote se refaz em dois toques.
function scheduleAction(type, place, executor, opts = {}) {
    const places = Array.isArray(place) ? place : [place];
    const n = places.length;
    const aoSair = opts.aoSair === 'cancel' ? 'cancel' : 'execute';
    // Reverte o placar otimista. `salvar` existe porque o `cancel` do logout
    // não precisa gravar (tudo é apagado depois) mas o do `pagehide` precisa:
    // o número inflado JÁ foi pro armazenamento quando a ação foi agendada.
    const reverterPlacar = (salvar) => {
        if (type === 'read') AppState.stats.read = Math.max(0, AppState.stats.read - n);
        else if (type === 'reject') AppState.stats.rejected = Math.max(0, AppState.stats.rejected - n);
        else if (type === 'skip') AppState.stats.skipped = Math.max(0, AppState.stats.skipped - n);
        if (salvar) { updateStats(); saveStats(); }
    };
    if (AppState.pendingAction) {
        AppState.pendingAction.execute();
        AppState.pendingAction = null;
    }
    removeUndoBanner();

    let executed = false;
    const runExecutor = async () => {
        // A ação saiu: a janela do Desfazer acabou e os botões voltam.
        AppState.pendingAction = null;
        aplicarTravaDeAcao();
        AppState.inFlightActions++;
        updateInFlightIndicator();
        try {
            await executor();
        } catch (err) {
            console.error('action error', err);
        } finally {
            AppState.inFlightActions = Math.max(0, AppState.inFlightActions - 1);
            updateInFlightIndicator();
        }
    };

    // Gate de experiência: mesmo se a pref está salva como false (ex: legado de
    // versão sem gate, ou outro dispositivo), só pula o undo se o user qualifica.
    if (AppState.preferences.undoEnabled === false && canDisableUndo()) {
        executed = true;
        runExecutor();
        return;
    }

    const timerId = setTimeout(() => {
        if (!executed) {
            executed = true;
            AppState.pendingAction = null;
            removeUndoBanner();
            // A janela correu inteira e ninguém desfez: evidência de que, pra
            // este editor, o Desfazer é só espera (ver DICA_SEM_UNDO).
            registrarJanelaSemUndo();
            runExecutor();
        }
    }, UNDO_WINDOW_MS);

    AppState.pendingAction = {
        type,
        place,
        execute: () => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                runExecutor();
            }
        },
        // Descarta a ação sem enviar e reverte o stat otimista. Usado no logout e
        // na sessão expirada (não há sessão válida pra enviar). Não re-enfileira
        // nem re-renderiza — o chamador reseta/zera a fila.
        cancel: (salvarPlacar) => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                reverterPlacar(!!salvarPlacar);
            }
        },
        // O que fazer quando a página está morrendo. Ver o comentário da
        // assinatura: o lote CANCELA porque meio-lote enviado não tem sintoma.
        aoSair,
        undo: () => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                // Usou: a evidência de "nunca desfaz" morre aqui e recomeça do
                // zero. Quem desfaz de vez em quando não deve receber a dica.
                zerarJanelasSemUndo();
                reverterPlacar(false);
                if (type !== 'skip') AppState.serverTotal += n; // skip nunca decrementou o total
                updateStats();
                saveStats();
                // `unshift(...places)` e NÃO um laço: um laço de unshift inverte
                // a ordem, e a fila voltaria embaralhada — sem erro visível, só
                // discordando do WME na hora de conferir.
                AppState.queue.unshift(...places);
                updatePendingCount();
                // Volta pro PRIMEIRO dos restaurados. Sem isto, desfazer um lote
                // mostraria o card de outro autor, e leria como se o Desfazer
                // tivesse feito outra coisa.
                showCurrentPlace();
            }
        }
    };

    const undoMsg = n > 1
        ? t('undo.lote', { n })
        : type === 'reject' ? t('undo.reject') : type === 'skip' ? t('undo.skip') : t('undo.read');
    showUndoBanner(undoMsg);
    aplicarTravaDeAcao();
}

function showUndoBanner(message) {
    removeUndoBanner();
    const container = document.getElementById('undoContainer');
    const banner = document.createElement('div');
    banner.className = 'undo-banner';
    banner.innerHTML = `
        <span>${escapeHtml(message)}</span>
        <button type="button" id="undoBtn">${escapeHtml(t('undo.button'))}</button>
        <span class="undo-progress" style="animation-duration: ${UNDO_WINDOW_MS}ms" aria-hidden="true"></span>
    `;
    container.appendChild(banner);
    document.getElementById('undoBtn').addEventListener('click', desfazerAcaoPendente);
}

// Desfazer, pelos DOIS caminhos (o botão do banner e a tecla z).
//
// O `aplicarTravaDeAcao()` no fim é o que conserta um defeito que existia desde
// antes do lote e que ninguém tinha visto: os dois caminhos limpavam o
// `pendingAction` e o banner, mas nunca reabilitavam os botões do card. E não
// dava pra perceber pela ordem certa — o `undo()` chama `showCurrentPlace()`
// ANTES de o chamador zerar o `pendingAction`, então o card novo nascia travado
// e nada voltava a olhar pra ele. O gesto seguia funcionando (o `acoesTravadas`
// já era falso), o que escondia o problema: só o caminho canônico e acessível,
// os três botões, é que ficava morto — inclusive pra quem usa leitor de tela,
// porque `disabled` também tira da ordem do Tab.
function desfazerAcaoPendente() {
    if (AppState.pendingAction) {
        AppState.pendingAction.undo();
        AppState.pendingAction = null;
    }
    removeUndoBanner();
    aplicarTravaDeAcao();
}

function removeUndoBanner() {
    const container = document.getElementById('undoContainer');
    if (container) container.innerHTML = '';
}

function updateInFlightIndicator() {
    let el = document.getElementById('inFlightIndicator');
    if (AppState.inFlightActions <= 0) {
        if (el) el.remove();
        return;
    }
    if (!el) {
        el = document.createElement('div');
        el.id = 'inFlightIndicator';
        el.className = 'fixed top-20 right-4 bg-slate-800 text-white text-xs px-3 py-2 rounded-full shadow-lg z-40 flex items-center gap-2';
        document.body.appendChild(el);
    }
    el.innerHTML = `
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>
        <span>${escapeHtml(t('indicator.sending', { n: AppState.inFlightActions }))}</span>
    `;
}

// Feedback quando um número muda. São DOIS mecanismos, porque contar não serve
// pro caso mais comum: cada swipe move o contador em 1, e entre 12 e 13 não
// existe inteiro nenhum pra mostrar — a "contagem" seria invisível.
//   · pulo (pop):  SEMPRE que o número muda. É o que comunica "isso mexeu".
//   · contagem:    só com |Δ| >= 2, aí sim há valores intermediários (ex.: a
//                  fila carregando de 0 pra 191).
// Ambos rodam em paralelo com o próximo card entrando: custo zero pro editor.
const COUNT_ANIM_MIN_MS = 220;
const COUNT_ANIM_MAX_MS = 650;

// `semAnimar` existe pra UMA situação: a troca de CONTEXTO do placar (entrar e
// sair do treino). Contar de 7 pra 0 sugere que o trabalho da pessoa mudou —
// quando o que mudou foi o placar que ela está olhando. É o mesmo raciocínio do
// "contador que muda de 1 PULA, não conta", visto do outro lado: animação aqui
// conta uma história falsa. Medido: 7/2/1/99 contando até 0/0/0/3 levava ~1s.
function setCount(el, valor, sufixo = '', semAnimar = false) {
    if (!el) return;
    if (semAnimar) {
        if (el._countRaf) cancelAnimationFrame(el._countRaf);
        el.textContent = String(valor) + sufixo;
        return;
    }
    const anterior = parseInt(String(el.textContent).replace(/\D/g, ''), 10);
    const alvo = Number(valor);
    const mudou = !Number.isFinite(anterior) || anterior !== alvo;

    if (!Number.isFinite(alvo) || prefersReducedMotion()) {
        el.textContent = String(valor) + sufixo;
        return;
    }
    // Sem valor anterior legível ('—', '…'): escreve direto, mas ainda pula.
    if (!Number.isFinite(anterior) || Math.abs(alvo - anterior) < 2) {
        el.textContent = String(alvo) + sufixo;
        if (mudou) popCount(el);
        return;
    }

    // Um contador por elemento: cancela o anterior antes de começar outro,
    // senão dois rAF disputam o mesmo textContent e o número treme.
    if (el._countRaf) cancelAnimationFrame(el._countRaf);
    const dur = Math.min(COUNT_ANIM_MAX_MS, COUNT_ANIM_MIN_MS + Math.abs(alvo - anterior) * 6);
    const inicio = performance.now();
    const passo = (agora) => {
        const p = Math.min(1, (agora - inicio) / dur);
        const eased = 1 - Math.pow(1 - p, 3); // ease-out: rápido no começo
        el.textContent = String(Math.round(anterior + (alvo - anterior) * eased)) + sufixo;
        if (p < 1) el._countRaf = requestAnimationFrame(passo);
        else el._countRaf = null;
    };
    el._countRaf = requestAnimationFrame(passo);
    popCount(el);
}

// Reinicia o pulo mesmo em mudanças seguidas (swipe rápido): tirar a classe,
// forçar reflow e recolocar — sem o reflow o browser junta tudo num estilo só
// e a animação não toca de novo.
function popCount(el) {
    el.classList.remove('count-pop');
    void el.offsetWidth;
    el.classList.add('count-pop');
    el.addEventListener('animationend', () => el.classList.remove('count-pop'), { once: true });
}

function prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

function updateStats(semAnimar = false) {
    // Todo caminho que mexe em Lidos/Rejeitados passa por aqui (swipe, botão,
    // lote, undo revertendo) — é o único ponto que pega todos sem espalhar
    // chamadas por seis handlers.
    checkUndoGateUnlock();
    setCount(document.getElementById('readCount'), AppState.stats.read, '', semAnimar);
    setCount(document.getElementById('rejectedCount'), AppState.stats.rejected, '', semAnimar);
    setCount(document.getElementById('skippedCount'), AppState.stats.skipped, '', semAnimar);
    updatePendingCount(semAnimar);
}

// ── Ponto no ícone da app instalada ──────────────────────────────────────
// PONTO, não número, e a razão é honestidade: o badge só é escrito quando a app
// RODA, então um número fica velho no instante em que a pessoa fecha. "118" no
// ícone dois dias depois é uma afirmação falsa; o ponto diz "há trabalho", que
// continua verdadeiro enquanto a fila não zera — e a fila medida do owner nunca
// zerou (211, 196, 108 em três dias).
//
// Nunca PEDE permissão. No iOS o badge exige notificação autorizada, e um
// prompt não solicitado é exatamente a interrupção que a régua do projeto
// proíbe. Sem autorização a promessa rejeita, e aqui isso é silêncio: o recurso
// simplesmente não existe naquele aparelho.
function atualizarPontoNoIcone() {
    try {
        if (!('setAppBadge' in navigator)) return;
        const temTrabalho = AppState.authenticated && AppState.serverTotal > 0;
        // `setAppBadge()` sem argumento é o PONTO; com número seria a contagem.
        const p = temTrabalho ? navigator.setAppBadge() : navigator.clearAppBadge();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* aparelho sem suporte não pode derrubar o placar */ }
}

// ── Aviso de sessão vencendo ─────────────────────────────────────────────
// Existe porque o fim da sessão chega como surpresa no pior lugar possível: no
// celular, onde não há como renovar. Quem entrou pelo QR precisa de um
// computador, e descobrir isso no meio da fila custa a sessão inteira de
// triagem.
//
// O prazo é o do WAZE, não o da app, e a diferença é o que torna a conta
// honesta. O `SESSION_TTL` da app (21 dias) é DESLIZANTE — o `loadSession`
// renova a cada uso, então quem usa nunca chega perto dele e contar a partir
// dali seria inventar um prazo que não vence. Já o cookie do Waze tem prazo
// FIXO: MEDIDO com 3 chamadas de leitura seguidas, o valor do `_web_session`
// mudou nas três (o Waze rotaciona a cada resposta, gotcha #43) e o `Expires`
// ficou parado, com o `Max-Age` só decrescendo. O servidor lê esse prazo do
// `Set-Cookie` que já recebe e manda junto (`sessaoExpiraEm`).
//
// Não guarda nada a mais no servidor e não encosta na criptografia: o prazo
// vem de um cabeçalho que a resposta já trazia, e mora no aparelho.
const AVISO_SESSAO_DIAS = 5;

function carregarPrazoDaSessao() {
    const bruto = Number(safeLS.get(SESSAO_KEY));
    AppState.sessaoExpiraEm = Number.isFinite(bruto) && bruto > 0 ? bruto : null;
}

// Ausente NÃO é "não vence": o Waze só manda `Set-Cookie` quando rotaciona, e
// uma resposta sem ele não desmente a anterior. Por isso só grava valor válido
// — apagar aqui faria o aviso piscar a cada chamada que não trouxe o cabeçalho.
function guardarPrazoDaSessao(body) {
    if (!body || typeof body !== 'object') return;
    const prazo = Number(body.sessaoExpiraEm);
    if (!Number.isFinite(prazo) || prazo <= 0) return;
    AppState.sessaoExpiraEm = prazo;
    safeLS.set(SESSAO_KEY, String(prazo));
    atualizarAvisoDeSessao();
}

function esquecerPrazoDaSessao() {
    AppState.sessaoExpiraEm = null;
    safeLS.remove(SESSAO_KEY);
    atualizarAvisoDeSessao();
}

function atualizarAvisoDeSessao() {
    const el = document.getElementById('avisoSessao');
    if (!el) return;
    const prazo = AppState.sessaoExpiraEm;
    const esconder = () => { el.classList.add('hidden'); el.textContent = ''; };
    if (!AppState.authenticated || !prazo) return esconder();
    const faltaMs = prazo * 1000 - Date.now();
    // Já venceu: quem avisa é o 401, que leva pra tela de entrar. Repetir aqui
    // seria dizer "vence em -1 dia" atrás de uma tela que nem está mais visível.
    if (faltaMs <= 0) return esconder();
    // `floor`, nunca `round`: com 4,9 dias o certo é dizer 4. Arredondar pra cima
    // daria mais prazo do que existe, que é o único erro que custa caro aqui.
    const dias = Math.floor(faltaMs / 86400000);
    if (dias > AVISO_SESSAO_DIAS) return esconder();
    el.textContent = dias === 0
        ? t('sessao.vence.hoje')
        : t(dias === 1 ? 'sessao.vence.dias' : 'sessao.vence.diasPlural', { n: dias });
    el.classList.remove('hidden');
}

function updatePendingCount(semAnimar = false) {
    const el = document.getElementById('pendingCount');
    atualizarPontoNoIcone();
    atualizarAvisoDeSessao();
    if (!el) return;
    if (!AppState.authenticated) {
        el.textContent = '—';
        return;
    }
    if (AppState.fetching && AppState.serverTotal === 0) {
        el.textContent = '…';
        return;
    }
    setCount(el, AppState.serverTotal, AppState.hasMore ? '+' : '', semAnimar);
    updatePendingTotalHint();
}

// D13: "de N na região". `serverBlocked` são pedidos que existem na região mas
// cujo venue este editor não pode editar — o backend os tira da fila (senão o
// editor via card que não consegue tratar). Sem essa linha, o número da app
// parece "errado" contra o que o WME mostra. Só aparece quando há bloqueados.
function updatePendingTotalHint() {
    const hint = document.getElementById('pendingTotalHint');
    if (!hint) return;
    const blocked = AppState.serverBlocked || 0;
    if (!AppState.authenticated || blocked <= 0) {
        hint.classList.add('hidden');
        hint.textContent = '';
        hint.removeAttribute('title');
        return;
    }
    // "+" quando a contagem é piso (paramos por MAX_EMPTY_PAGES com o Waze
    // ainda oferecendo páginas) — mesma convenção do contador "Restam".
    const total = AppState.serverTotal + blocked;
    const rotulo = AppState.blockedPartial ? total + '+' : String(total);
    hint.textContent = t('stats.pending.ofRegion', { total: rotulo });
    hint.title = t('stats.pending.ofRegion.title', { blocked });
    hint.classList.remove('hidden');
}

function saveStats() {
    try {
        localStorage.setItem(STATS_KEY, JSON.stringify(AppState.stats));
    } catch (e) {}
}

function loadStats() {
    try {
        const raw = localStorage.getItem(STATS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            AppState.stats = {
                read: parsed.read || 0,
                rejected: parsed.rejected || 0,
                skipped: parsed.skipped || 0
            };
        }
    } catch (e) {}
    updateStats();
}

function saveFilters() {
    try {
        localStorage.setItem(FILTERS_KEY, JSON.stringify(AppState.filters));
    } catch (e) {}
}

function loadFilters() {
    try {
        const raw = localStorage.getItem(FILTERS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            AppState.filters.types = sanearTiposSalvos(parsed.types);
            AppState.filters.residential = parsed.residential || '';
            AppState.filters.stateId = parsed.stateId || '';
            AppState.filters.managedAreaId = parsed.managedAreaId || '';
            AppState.filters.myArea = !!parsed.myArea;
            AppState.filters.unreadOnly = parsed.unreadOnly !== false;
            AppState.filters.categories = Array.isArray(parsed.categories) ? parsed.categories : [];
            AppState.filters.sortOrder = parsed.sortOrder === 'oldest' ? 'oldest' : 'newest';
        }
    } catch (e) {}
}

// Gravar preferência ANTES de tê-las lido apaga a escolha da pessoa com o
// padrão. E não é hipotético: com o `/api/perfil` falhando, o
// `checkUndoGateUnlock` chega a `savePreferences()` num momento em que a
// memória ainda é o literal de origem — medido, com o `undoEnabled: false` do
// editor virando `true` no armazenamento, de forma PERMANENTE.
//
// ── ANISTIA DA PRESENÇA ─────────────────────────────────────────────────────
// Desligar "Ver quem está na fila" é decisão de um dia; ficar invisível pra
// sempre por causa dela raramente é a intenção. Quem experimentou o desligar
// no primeiro contato e esqueceu nunca mais vê o recurso — e não tem como
// descobrir que ele existe, porque a pílula (que é a única coisa que o anuncia)
// é justamente o que ele desligou.
//
// Depois de 9 dias desligado, volta sozinho e EM SILÊNCIO: sem toast, sem
// banner. Anunciar seria transformar uma reativação discreta numa interrupção,
// que é o oposto do que ela existe pra consertar.
//
// Quem quiser desligar de novo desliga, e ganha outros 9 dias. Quem religa à
// mão zera o carimbo — a contagem é do DESLIGAR, não do calendário.
const PRESENCA_ANISTIA_DIAS = 9;
const PRESENCA_ANISTIA_MS = PRESENCA_ANISTIA_DIAS * 24 * 60 * 60 * 1000;

// A ordem certa é garantida por invariante, não por sorte de quem chama antes:
// enquanto não se leu, não se escreve.
let preferenciasCarregadas = false;

function savePreferences() {
    if (!preferenciasCarregadas) return;
    try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(AppState.preferences));
    } catch (e) {}
}

function loadPreferences() {
    try {
        const raw = localStorage.getItem(PREFERENCES_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            AppState.preferences.undoEnabled = parsed.undoEnabled !== false;
            // Opt-out: só desliga quem DISSE que quer desligado. `undefined`
            // (quem nunca abriu as Preferências) fica ligado, que é o padrão.
            if (typeof parsed.presenca === 'boolean') AppState.preferences.presenca = parsed.presenca;
            // undefined = nunca decidido (user antigo ou primeira visita).
            // Só copia se for boolean, pra initUndoGateSeen poder decidir depois.
            if (typeof parsed.undoGateSeen === 'boolean') {
                AppState.preferences.undoGateSeen = parsed.undoGateSeen;
            }
            if (typeof parsed.dicaDesfazerVista === 'boolean') {
                AppState.preferences.dicaDesfazerVista = parsed.dicaDesfazerVista;
            }
            if (typeof parsed.comoFuncionaVisto === 'boolean') {
                AppState.preferences.comoFuncionaVisto = parsed.comoFuncionaVisto;
            }
            if (parsed.consequenciaVista && typeof parsed.consequenciaVista === 'object') {
                AppState.preferences.consequenciaVista = parsed.consequenciaVista;
            }
            if (typeof parsed.semUndoSeguidas === 'number' && parsed.semUndoSeguidas >= 0) {
                AppState.preferences.semUndoSeguidas = parsed.semUndoSeguidas;
            }
            if (Number.isFinite(parsed.presencaOffEm) && parsed.presencaOffEm > 0) {
                AppState.preferences.presencaOffEm = parsed.presencaOffEm;
            }
        }
    } catch (e) {}
    preferenciasCarregadas = true;
    if (aplicarAnistiaDaPresenca()) savePreferences();
}

// Devolve true quando MUDOU alguma coisa (pra quem chama saber se grava).
//
// Roda depois do `preferenciasCarregadas = true` de propósito: o
// `savePreferences` sai calado antes disso, e a anistia precisa PERSISTIR —
// senão ela reavalia a cada carga e o carimbo velho fica pra sempre no
// aparelho.
function aplicarAnistiaDaPresenca() {
    const p = AppState.preferences;
    if (p.presenca !== false) {
        // Ligado não tem contagem correndo. Carimbo sobrando é resíduo de uma
        // versão anterior ou de armazenamento editado à mão.
        if (p.presencaOffEm === undefined) return false;
        delete p.presencaOffEm;
        return true;
    }
    // Desligado ANTES desta versão existir: não há de quando contar. Carimba
    // agora, e a anistia cai daqui a 9 dias.
    //
    // Carimbar em vez de anistiar na hora é deliberado: religar de uma vez todo
    // mundo que já estava desligado transforma um deploy numa mudança em massa
    // que ninguém pediu — e some com o significado dos 9 dias.
    if (!Number.isFinite(p.presencaOffEm) || p.presencaOffEm <= 0) {
        p.presencaOffEm = Date.now();
        return true;
    }
    // Relógio que andou pra trás dá diferença negativa: isso não é 9 dias.
    const decorrido = Date.now() - p.presencaOffEm;
    if (decorrido < PRESENCA_ANISTIA_MS) return false;
    p.presenca = true;
    delete p.presencaOffEm;
    return true;
}

// Modo Desenvolvedor: easter egg estilo Android. User toca 7 vezes na versão
// no rodapé (timeout de 3s entre taps reseta contador). Quando desbloqueado,
// uma seção "Avançado" aparece no modal de Preferências com toggle para ativar.
// Quando ativo, AppState.devMode.active = true bypassa restrições (hoje só o
// gate do undo). NÃO é segurança — qualquer um pode setar via DevTools.
// É só pra esconder de usuário comum.
function saveDevMode() {
    try {
        localStorage.setItem(DEVMODE_KEY, JSON.stringify(AppState.devMode));
    } catch (e) {}
}

function loadDevMode() {
    try {
        const raw = localStorage.getItem(DEVMODE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            AppState.devMode.unlocked = !!parsed.unlocked;
            AppState.devMode.active = !!parsed.active && !!parsed.unlocked;
        }
    } catch (e) {}
}

// ── Teclado virtual ────────────────────────────────────────────────────────
// Todo campo de texto é um teclado esperando pra ocupar metade da tela. No
// celular, o modal "Entrar com um código" ficava ATRÁS do teclado: campo e
// botões invisíveis, sem nada indicando que era só rolar. Aqui a altura coberta
// vira `--kb-inset`, que os modais usam pra subir e pra encolher (styles.css +
// `max-h-[calc(...)]` no HTML). É a segunda camada: a primeira é o
// `interactive-widget=resizes-content` do <meta viewport>, que alguns
// navegadores ignoram.
// A ação fica UNDO_WINDOW_MS (3s) no buffer do "Desfazer" ANTES de ir pro Waze — mas o contador
// já foi incrementado e salvo em localStorage na hora do swipe. Fechar a aba
// nessa janela fazia a ação sumir com o placar dizendo que ela aconteceu: o
// pedido voltava na próxima busca, mas o número ficava errado pra sempre. E
// fechar logo depois do último swipe não é caso raro — é como se termina de usar.
//
// `pagehide` cobre fechar/navegar. `visibilitychange` para oculto cobre o
// celular: quando o sistema mata uma aba em segundo plano, esse é o último
// callback confiável (page lifecycle). O preço é que trocar de app comita na
// hora, encurtando o "Desfazer" — e é o lado certo de errar: a ação ia comitar
// em 3s de qualquer jeito, enquanto perdê-la é dano permanente no placar.
function descarregarAcaoPendente() {
    // As três escritas do lightbox têm a mesma janela e o mesmo risco: sair da
    // página com uma pendente a faria sumir depois de a tela já ter mudado.
    for (const p of [renomeacaoPendente, aprovacaoPendente, exclusaoPendente]) {
        if (!p) continue;
        if (typeof API !== 'undefined' && API.setSaindo) API.setSaindo(true);
        try { p.enviar(); } catch (e) { console.error('Falha ao descarregar:', e); }
    }
    if (!AppState.pendingAction) return;
    // Fetch normal é cancelado no unload; keepalive sobrevive.
    if (typeof API !== 'undefined' && API.setSaindo) API.setSaindo(true);
    try {
        // O LOTE cancela em vez de despachar (ver `aoSair` no scheduleAction).
        // `true` grava o placar revertido: o número inflado já foi pro
        // armazenamento quando o lote foi agendado, e sem isto ele sobreviveria
        // ao recarregamento contando pedidos que nunca saíram.
        if (AppState.pendingAction.aoSair === 'cancel') AppState.pendingAction.cancel(true);
        else AppState.pendingAction.execute();
    } catch (e) {
        console.error('Falha ao descarregar a ação pendente:', e);
    }
}

function setupDescargaAoSair() {
    window.addEventListener('pagehide', descarregarAcaoPendente);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') descarregarAcaoPendente();
    });
}

// O banner do topo se ancora abaixo do header, e o header não tem altura fixa:
// cresce com a safe-area do iPhone e com a preferência de fonte do sistema.
// Número chutado no CSS erraria em algum aparelho — daí medir e publicar.
function setupAlturaDoHeader() {
    const header = document.querySelector('header');
    if (!header) return;
    const medir = () => {
        document.documentElement.style.setProperty('--header-h', header.getBoundingClientRect().height + 'px');
    };
    if (typeof ResizeObserver === 'function') new ResizeObserver(medir).observe(header);
    window.addEventListener('resize', medir);
    medir();
}

function setupKeyboardInset() {
    const vv = window.visualViewport;
    if (!vv) return;
    const aplicar = () => {
        const coberto = Math.round(window.innerHeight - vv.height - vv.offsetTop);
        // Abaixo de 80px é barra do navegador entrando/saindo, não teclado —
        // reagir a isso faria o modal pular a cada rolagem.
        const inset = coberto > 80 ? coberto : 0;
        document.documentElement.style.setProperty('--kb-inset', inset + 'px');
    };
    vv.addEventListener('resize', aplicar);
    vv.addEventListener('scroll', aplicar);
    aplicar();

    // Rede de segurança pra navegador sem nenhum dos dois mecanismos: leva o
    // campo focado pra área visível. O atraso espera o teclado assentar —
    // medir antes disso mede a tela errada.
    document.addEventListener('focusin', (e) => {
        const campo = e.target;
        if (!campo || typeof campo.matches !== 'function') return;
        if (!campo.matches('input, textarea, select')) return;
        if (!campo.closest('.modal-root')) return;
        setTimeout(() => {
            try { campo.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) {}
        }, 250);
    });
}

// ── Extensão do Chrome: só onde ela existe ─────────────────────────────────
// Chrome/Edge de Android e qualquer navegador de iOS não instalam extensão da
// Chrome Web Store. Oferecer isso num celular não é "opção de baixa
// prioridade": é beco sem saída — e ainda vinha marcado como "RECOMENDADO",
// mandando o editor justamente pro caminho que não funciona ali. Reordenar
// resolve o que é inconveniente; o que é impossível sai da frente.
// Os outros três caminhos (código, upload, colar) seguem visíveis, então
// errar a detecção não tranca ninguém do lado de fora.
function podeInstalarExtensao() {
    const dados = navigator.userAgentData;
    if (dados && typeof dados.mobile === 'boolean') return !dados.mobile;
    return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

function marcarSuporteAExtensao() {
    if (!podeInstalarExtensao()) {
        document.documentElement.classList.add('sem-extensao');
    }
}

// ── Convite de instalação do PWA ───────────────────────────────────────────
// Sem `preventDefault()`, o Chrome mostra a própria barra de instalação: fica
// grudada no rodapé, tapa conteúdo (inclusive o meio dos modais) e não sai da
// frente. Convite persistente que cobre conteúdo é anti-padrão M3/HIG. Então
// guardamos o evento e oferecemos a instalação num lugar previsível — o menu
// de Ajuda — onde o editor decide quando.
let promptInstalacao = null;

// Já rodando instalada? Nada de convidar quem já aceitou. `display-mode` cobre
// Android/desktop; `navigator.standalone` é o jeito do iOS, que não implementa
// a media query.
function appJaInstalada() {
    try {
        if (window.matchMedia('(display-mode: standalone)').matches) return true;
        if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
    } catch (e) { /* matchMedia pode faltar em WebView antiga */ }
    return navigator.standalone === true;
}

// iOS não tem `beforeinstallprompt`: no Safari a instalação é manual. Sem
// detectar isso, o iPhone fica SEM CAMINHO NENHUM — e o pareamento por QR
// empurra justamente pro celular. iPadOS se identifica como Mac desde o iOS 13,
// daí o teste extra por toque.
function ehIOS() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

const CHAVE_INSTALL_DISPENSADO = 'waze_places_install_dispensado';

function convitePodeAparecer() {
    if (appJaInstalada()) return false;
    if (safeLS && safeLS.get && safeLS.get(CHAVE_INSTALL_DISPENSADO) === '1') return false;
    // Só há o que oferecer se houver prompt (Chrome/Android/desktop) ou se for
    // iOS, onde mostramos o passo a passo manual.
    return !!promptInstalacao || ehIOS();
}

// O convite vive no "Tudo limpo!" porque é o ÚNICO momento em que o editor
// terminou algo: não há próxima ação esperando e a tela já é de festa. Em
// qualquer outro lugar ele disputaria com o gesto.
function atualizarConviteInstalar() {
    const box = document.getElementById('installInvite');
    if (!box) return;
    const mostra = convitePodeAparecer();
    box.classList.toggle('hidden', !mostra);
    if (!mostra) return;
    // Com prompt: botão. Sem prompt e iOS: passo a passo. Nunca os dois.
    document.getElementById('installInviteBtn').classList.toggle('hidden', !promptInstalacao);
    document.getElementById('installIosSteps').classList.toggle('hidden', !!promptInstalacao);
}

function atualizarBotaoInstalar() {
    const btn = document.getElementById('installAppBtn');
    if (btn) btn.classList.toggle('hidden', !promptInstalacao || appJaInstalada());
    atualizarConviteInstalar();
}

function setupInstalarApp() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        promptInstalacao = e;
        atualizarBotaoInstalar();
    });
    window.addEventListener('appinstalled', () => {
        promptInstalacao = null;
        atualizarBotaoInstalar();
    });
    const instalar = async () => {
        if (!promptInstalacao) return;
        promptInstalacao.prompt();
        // O evento é de uso único: depois de escolher, some de qualquer jeito.
        try { await promptInstalacao.userChoice; } catch (err) {}
        promptInstalacao = null;
        atualizarBotaoInstalar();
    };
    document.getElementById('installAppBtn')?.addEventListener('click', instalar);
    document.getElementById('installInviteBtn')?.addEventListener('click', instalar);
    document.getElementById('installDismissBtn')?.addEventListener('click', () => {
        // "Agora não" é pra valer: sem persistir, a fila zerar de novo traria o
        // convite de volta, e convite que não aceita não é convite.
        safeLS.set(CHAVE_INSTALL_DISPENSADO, '1');
        atualizarConviteInstalar();
    });
    atualizarBotaoInstalar();
}

function setupDevModeTapTrigger(el) {
    let tapCount = 0;
    let resetTimer = null;
    el.addEventListener('click', () => {
        if (AppState.devMode.unlocked) return;
        tapCount++;
        const hint = document.getElementById('devTapHint');
        const limparHint = () => {
            if (hint) { hint.textContent = ''; hint.classList.add('hidden'); hint.classList.remove('block'); }
        };
        if (resetTimer) clearTimeout(resetTimer);
        // Parou de tocar? zera a contagem E some com o countdown, senão ficaria
        // "faltam 2" pendurado ao lado da versão para sempre.
        resetTimer = setTimeout(() => { tapCount = 0; limparHint(); }, DEVMODE_TAP_TIMEOUT_MS);
        const remaining = DEVMODE_TAPS_NEEDED - tapCount;
        if (remaining === 0) {
            AppState.devMode.unlocked = true;
            saveDevMode();
            tapCount = 0;
            limparHint();
            // O toast de conquista é seguro: já desbloqueou, não há mais toque a
            // receber. É o do COUNTDOWN que não podia ser toast (ver abaixo).
            if (window.showToast) window.showToast(t('toast.devUnlocked'), 'success');
        } else if (remaining > 0 && remaining <= 3) {
            // Countdown fica ao LADO da versão, nunca num toast. O toast é
            // bottom-center em z-[70] e cobria o próprio alvo: do 5º toque em
            // diante quem recebia o clique era ele, os 3 últimos toques não
            // chegavam e o dev mode era impossível de desbloquear — em todo
            // aparelho, desde sempre. Overlay transitório não pode ficar por
            // cima de um alvo que ainda precisa ser tocado.
            if (hint) {
                hint.textContent = t('toast.devCountdown', { n: remaining });
                // `block` e não `inline`: em tela estreita o texto embolava com o
                // serial da versão em vez de virar uma linha própria.
                hint.classList.remove('hidden');
                hint.classList.add('block');
            }
        }
    });
}

function updateDevBadge() {
    const badge = document.getElementById('devModeBadge');
    if (!badge) return;
    badge.classList.toggle('hidden', !AppState.devMode.active);
}

function renderDevModeSection() {
    const section = document.getElementById('devModeSection');
    const checkbox = document.getElementById('prefDevModeActive');
    if (!section || !checkbox) return;
    if (AppState.devMode.unlocked) {
        section.classList.remove('hidden');
        checkbox.checked = !!AppState.devMode.active;
    } else {
        section.classList.add('hidden');
        checkbox.checked = false;
    }
}

// A linha REQUEST do filtro (e a função que a mostrava) MORREU: ela virou as
// quatro do WME — atualização de detalhes, local marcado, excluir local e foto
// sinalizada. Fica o registro do que ela custou enquanto esteve fechada atrás
// do modo dev, porque a lição vale pro próximo gate: numa fila real de 137
// pedidos, 135 eram REQUEST — o editor abria a app e via DOIS. Meça quanto da
// fila um gate esconde antes de deixá-lo fechado mais um mês.
//
// Não há mais tipo gated por dev mode. A função fica como ponto de extensão
// (o próximo recurso a ser solto passa por aqui) e para não quebrar os call
// sites, mas hoje não tira nada de ninguém — tirava REQUEST do filtro salvo,
// que era justamente o que mantinha o editor sem ver 98% da fila.
function enforceDevGatedFilters() {
    /* nada gated no momento */
}

// Gate de experiência pro toggle "Permitir desfazer ações".
// Ideia: novatos não conseguem desligar o undo até pegarem ritmo. Editores de
// nível mais alto têm cota menor (são mais experientes).
// Fórmula: ceil(UNDO_GATE_BASE / (rank + 1)). Waze devolve rank 0-indexed:
//   rank 5 (L6) → 20 PURs, rank 4 (L5) → 24, rank 3 (L4) → 30, rank 2 (L3) → 40,
//   rank 1 (L2) → 60, rank 0 (L1) → 120.
// "PURs tratados" = read + rejected (skipped não treina o ritmo de ação destrutiva).
// Staff são isentos. Esta NÃO é proteção de segurança — é UX/educação. localStorage
// pode ser editado pelo user esperto; o objetivo é proteger quem é genuinamente novato.
//
// A base era 3000 (L1 levava ~100 min de swipe contínuo pra desbloquear — exagero
// que na prática travava todo mundo pra sempre). 300 mantém o gate significativo
// pro novato (uma sessão de trabalho de verdade) e some do caminho de quem tem
// ritmo. Baixar mais (30/60) apagaria o gate: L6 passaria em 10 segundos, e a
// escala por nível viraria ruído (L5=6 vs L6=5 não distingue ninguém).
const UNDO_GATE_BASE = 120;

function getUndoTreatedCount() {
    return (AppState.stats.read || 0) + (AppState.stats.rejected || 0);
}

function guardarPerfilDoPortao(p) {
    if (!p || typeof p.rank !== 'number') return;
    safeLS.set(PERFIL_GATE_KEY, JSON.stringify({ rank: p.rank, isStaff: !!p.isStaff }));
    // O perfil ACABOU de ficar conhecido, e era a única peça que faltava pra
    // estabelecer a linha de base da conquista. Aqui e não no `initApp` porque
    // é este o momento em que a cota deixa de ser Infinity — nas DUAS entradas
    // de perfil, sem depender de quem lembra de chamar.
    initUndoGateSeen();
}

// O perfil que a COTA usa: o vivo, se houver; senão o último que carregou.
// A cota mede a EXPERIÊNCIA da pessoa, que não muda porque a rede caiu.
function perfilDoPortao() {
    if (AppState.profile && typeof AppState.profile.rank === 'number') return AppState.profile;
    try {
        const c = JSON.parse(safeLS.get(PERFIL_GATE_KEY) || 'null');
        return c && typeof c.rank === 'number' ? c : null;
    } catch (e) { return null; }
}

function getUndoUnlockThreshold() {
    const p = perfilDoPortao();
    if (p && p.isStaff) return 0;
    const rank = p && p.rank;
    if (typeof rank !== 'number') return Infinity;
    return Math.ceil(UNDO_GATE_BASE / (rank + 1));
}

// ── Aviso de desbloqueio do gate ──────────────────────────────────────────
// Antes disso o desbloqueio era INVISÍVEL: a pessoa cruzava a cota e nada
// acontecia — só descobriria abrindo Filtros → Preferências por acaso. Esforço
// feito e não reconhecido é pior que não ter recompensa.
//
// Repare que usa a comparação CRUA (tratados >= cota), e não canDisableUndo():
// aquele devolve true com o Modo Desenvolvedor ligado, e aí ligar o dev mode
// dispararia um "parabéns" por conquista nenhuma.
function undoGateAtingido() {
    return getUndoTreatedCount() >= getUndoUnlockThreshold();
}

// Chamado quando perfil E stats já existem. Quem JÁ está acima da cota nasce
// marcado como "visto": parabenizar por trabalho feito antes de a comemoração
// existir soaria falso — e apareceria pra toda a base no primeiro deploy.
function initUndoGateSeen() {
    // Mesma invariante do savePreferences: sem ter lido, não se decide.
    if (!preferenciasCarregadas) return;
    if (typeof AppState.preferences.undoGateSeen === 'boolean') return;
    // Sem cota conhecida NÃO HÁ decisão a tomar — adiar é o certo. Cota Infinity
    // responderia "não atingiu" pra quem tem 200 tratados, e o pedido seguinte
    // viraria uma falsa conquista pelo acumulado de meses.
    if (!isFinite(getUndoUnlockThreshold())) return;
    AppState.preferences.undoGateSeen = undoGateAtingido();
    savePreferences();
}

function checkUndoGateUnlock() {
    // `undefined` = a LINHA DE BASE ainda não foi estabelecida: `initUndoGateSeen`
    // não pôde decidir se este acumulado é trabalho de ANTES. Celebrar aqui
    // parabeniza pelo histórico, e é o que fazia o aviso sair a cada recarga.
    // Só `false` — decisão tomada, ainda não atingiu — libera a comemoração.
    if (typeof AppState.preferences.undoGateSeen !== 'boolean') return;
    if (AppState.preferences.undoGateSeen) return;
    if (!undoGateAtingido()) return;
    AppState.preferences.undoGateSeen = true;
    // Este aviso já abre a mesma porta. Sem isto, quem cruza a cota com 20
    // janelas sem desfazer nas costas (o L6 passa em 20 pedidos — dá empate)
    // levaria os dois banners quase juntos, dizendo a mesma coisa duas vezes.
    AppState.preferences.dicaDesfazerVista = true;
    savePreferences();
    dispararConfeteNaFila();
    showToast(
        t('toast.undoUnlocked', { n: getUndoUnlockThreshold() }),
        'achievement',
        // 20s. A mensagem tem 16 palavras: a ~200 palavras/min de leitura atenta
        // são ~4,8s só de leitura, mais notar que apareceu e decidir se toca —
        // os 8s anteriores ficavam exatamente no limite, e o owner sentiu isso
        // usando. 20s cobre leitura tranquila com folga.
        //
        // Ficar aqui não custa mais nada: desde que virou banner no TOPO, ele
        // não tapa botão nenhum (medido em 4 aparelhos × 2 temas), e aparece uma
        // vez na vida (undoGateSeen). Toque dispensa e abre as Preferências.
        //
        // O desenho que dispensaria o número — banner persistente com ✕ próprio,
        // que é o comportamento de banner no M3 — foi oferecido e o owner
        // preferiu o ajuste simples.
        20000,
        abrirPreferenciaDoUndo
    );
}

// Confete por cima da fila, reaproveitando o mesmo CSS do "Tudo limpo!".
// Some sozinho — nada fica pendurado no DOM.
function dispararConfeteNaFila() {
    if (prefersReducedMotion()) return;
    const stack = document.getElementById('cardStack');
    if (!stack) return;
    const burst = document.createElement('div');
    burst.className = 'confetti confetti-burst';
    burst.setAttribute('aria-hidden', 'true');
    burst.innerHTML = '<span></span>'.repeat(12);
    stack.appendChild(burst);
    setTimeout(() => burst.remove(), 2200);
}

// Leva direto ao interruptor em vez de mandar procurar em Filtros → Preferências.
async function abrirPreferenciaDoUndo() {
    await openFiltersModal();
    switchFilterTab('filtersTabPrefs');
    const linha = document.getElementById('prefUndoRow');
    if (!linha || prefersReducedMotion()) return;
    linha.classList.remove('pref-highlight');
    void linha.offsetWidth;   // reflow: sem isso a animação não reinicia
    linha.classList.add('pref-highlight');
    linha.addEventListener('animationend', () => linha.classList.remove('pref-highlight'), { once: true });
}

// ── Dica por COMPORTAMENTO: "você nunca desfaz" ───────────────────────────
// O aviso de desbloqueio dispara na TRANSIÇÃO de cruzar a cota — e por isso
// nunca alcança quem já estava acima dela quando a comemoração foi lançada
// (`initUndoGateSeen` marca essa pessoa como "já viu", pra não parabenizar por
// trabalho anterior ao deploy). O efeito colateral é que os editores MAIS
// ativos são justamente os que nunca ficam sabendo que a espera pode ser
// desligada — e são os que mais perdem com ela: 2431ms por pedido contra 33ms.
//
// Este gatilho não depende de transição nenhuma: conta janelas do Desfazer que
// expiraram SEM ninguém desfazer — evidência do próprio editor de que, pra ele,
// o recurso é só espera. Dispara uma vez.
//
// O LIMIAR NÃO É NÚMERO ESCOLHIDO A DEDO: é um orçamento de tempo. Quanto da
// vida do editor a app deixa evaporar antes de mencionar que existe um
// interruptor. Um minuto é a régua — dá pra sentir, e ainda é um oitavo do que
// 200 pedidos custam (~8 min).
const ESPERA_DESPERDICADA_ANTES_DA_DICA_MS = 60000;

// Só a expiração NATURAL conta (ver registrarJanelaSemUndo), e uma janela que
// expira sozinha custa exatamente UNDO_WINDOW_MS de tela travada: enquanto ela
// corre, acoesTravadas() barra botão, gesto e tecla. Então o limiar é o orçamento
// dividido pelo custo de UMA janela — hoje 60000/3000 = 20, o mesmo valor de
// antes, agora derivado. Mexer no UNDO_WINDOW_MS reajusta sozinho, porque o que
// a app promete é o MINUTO, não o vinte.
//
// Rank não entra aqui, de propósito: a cota do gate escala por rank porque mede
// COMPETÊNCIA, e rank é proxy razoável disso. Isto mede PREFERÊNCIA revelada pelo
// comportamento — existe L6 cauteloso e L1 apressado, e um minuto perdido é um
// minuto perdido nos dois. Escalar por rank também disparia na hora pra quem a
// dica existe: `stats` é acumulado (waze_places_stats), então quem já está muito
// acima da cota satisfaz "cota + N" antes de tocar em nada, sem evidência alguma.
const DICA_SEM_UNDO = Math.ceil(ESPERA_DESPERDICADA_ANTES_DA_DICA_MS / UNDO_WINDOW_MS);

// Só a expiração natural conta. `execute()` forçado (sair da página, trocar
// filtro) despacha sem dar a janela inteira — não é a pessoa decidindo não
// desfazer, e contar isso inflaria a evidência.
function registrarJanelaSemUndo() {
    AppState.preferences.semUndoSeguidas = (AppState.preferences.semUndoSeguidas || 0) + 1;
    savePreferences();
    checkDicaDesfazer();
}

function zerarJanelasSemUndo() {
    if (!AppState.preferences.semUndoSeguidas) return;
    AppState.preferences.semUndoSeguidas = 0;
    savePreferences();
}

function checkDicaDesfazer() {
    if (AppState.preferences.dicaDesfazerVista) return;
    if (AppState.preferences.undoEnabled === false) return;   // já desligado: nada a oferecer
    if ((AppState.preferences.semUndoSeguidas || 0) < DICA_SEM_UNDO) return;
    // Nunca ofereça o que não dá pra fazer AQUI: sem passar a cota o toggle está
    // desabilitado, e a dica viraria beco sem saída. O contador continua correndo
    // — quando a cota cair, a evidência já está pronta.
    if (!canDisableUndo()) return;
    AppState.preferences.dicaDesfazerVista = true;
    savePreferences();
    showToast(
        // {undoSeg} é global (setI18nVars) — não passa aqui de propósito, pra ter
        // UMA definição servindo esta frase e a de prefs.undo.desc, que é aplicada
        // por applyI18n() e não tem call site onde passar parâmetro.
        t('toast.undoHint', { n: DICA_SEM_UNDO }),
        'hint',
        // Mesma régua do aviso de conquista: banner do topo, com ação, uma vez
        // na vida. 20s cobrem leitura tranquila e decisão sem correria.
        20000,
        abrirPreferenciaDoUndo
    );
}

function canDisableUndo() {
    // Modo Desenvolvedor bypassa o gate de experiência completamente.
    if (AppState.devMode && AppState.devMode.active) return true;
    return getUndoTreatedCount() >= getUndoUnlockThreshold();
}

function renderPresencaPref() {
    const cb = document.getElementById('prefPresenca');
    if (cb) cb.checked = AppState.preferences.presenca !== false;
}

function renderUndoGateUI() {
    // O perfil já existe quando isto roda, então é o momento certo de decidir
    // se este usuário nasce com o aviso "já visto" (quem já passou da cota).
    initUndoGateSeen();
    const checkbox = document.getElementById('prefUndoEnabled');
    const gateMsg = document.getElementById('prefUndoGateMsg');
    if (canDisableUndo()) {
        checkbox.disabled = false;
        checkbox.checked = AppState.preferences.undoEnabled !== false;
        gateMsg.classList.add('hidden');
        gateMsg.textContent = '';
        return;
    }
    checkbox.disabled = true;
    checkbox.checked = true; // gate força ligado
    const threshold = getUndoUnlockThreshold();
    const current = getUndoTreatedCount();
    if (!isFinite(threshold)) {
        gateMsg.textContent = t('prefs.undo.gate.noProfile');
    } else {
        const remaining = Math.max(0, threshold - current);
        gateMsg.textContent = t('prefs.undo.gate.countdown', { threshold, current, remaining });
    }
    gateMsg.classList.remove('hidden');
}

// Tema: preferência explícita do user (localStorage) vence; sem preferência,
// segue o sistema (M3/HIG). O listener em initApp acompanha mudanças do SO.
function getPreferredTheme() {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.body.classList.toggle('dark', isDark);
    document.getElementById('themeIconLight').classList.toggle('hidden', isDark);
    document.getElementById('themeIconDark').classList.toggle('hidden', !isDark);
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    // Status bar (Android/PWA) acompanha a surface do header, não a cor da marca
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', isDark ? '#0f172a' : '#f8fafc');
}

function toggleTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    const next = isDark ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
}

// Snackbar M3: bottom-center (via #notifyStack), desliza de baixo, um clique
// dispensa. Duração 4s (mínimo M3). aria-live está no container (index.html).
// `onClick` opcional: quando presente, o toast vira um atalho (executa a ação
// E dispensa). Sem ele, o comportamento de sempre — clicar só dispensa.
function showToast(message, type = 'info', durationMs = 4000, onClick = null) {
    // Conquista é BANNER (topo), não snackbar (rodapé) — distinção do M3, e aqui
    // com motivo medido: no rodapé ela tapava os três botões do card por 8s em 2
    // de 3 aparelhos (gotcha #26). Snackbar confirma o que você acabou de fazer;
    // banner é proeminente, tem ação e fica mais tempo. Este convida a abrir as
    // Preferências — não confirma nada.
    // 'hint' segue a mesma régua da conquista: é banner, não snackbar — tem ação
    // (abre as Preferências), fica mais tempo e não confirma nada que acabou de
    // acontecer. O que muda é a cor: informar não é comemorar.
    const ehBanner = type === 'achievement' || type === 'hint';
    const container = document.getElementById(ehBanner ? 'bannerContainer' : 'toastContainer');
    const toast = document.createElement('div');

    const colors = {
        success: 'bg-emerald-700',
        error: 'bg-rose-600',
        info: 'bg-slate-800 dark:bg-slate-100 dark:text-slate-900',
        // Conquista: dourado, pra não se confundir com um "sucesso" qualquer.
        achievement: 'bg-gradient-to-r from-amber-700 to-amber-800',
        // Dica: cyan da marca. Não é conquista (não houve mérito), não é erro e
        // não é confirmação — é a app contando algo que ela observou.
        hint: 'bg-gradient-to-r from-cyan-700 to-cyan-800'
    };

    const icons = {
        success: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
        error: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
        info: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
        achievement: '<svg class="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 21h8m-4-4v4m6-17v4a6 6 0 11-12 0V4h12zm0 2h2a2 2 0 010 4h-2m-12-4H4a2 2 0 000 4h2"></path></svg>',
        // Cronômetro: a dica é sobre TEMPO, e o ícone diz isso antes do texto.
        hint: '<svg class="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };

    toast.className = `toast ${colors[type] || colors.info} text-white font-medium text-sm`;
    toast.innerHTML = `${(icons[type] || icons.info)}<span class="flex-1">${escapeHtml(message)}</span>`;
    toast.title = t('toast.dismissHint');

    let removed = false;
    const dismiss = () => {
        if (removed) return;
        removed = true;
        toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        toast.style.opacity = '0';
        // Sai por onde entrou: pra cima no topo, pra baixo no rodapé.
        toast.style.transform = `translateY(${type === 'achievement' ? '-20px' : '20px'})`;
        setTimeout(() => toast.remove(), 250);
    };
    toast.addEventListener('click', () => {
        if (onClick) {
            try { onClick(); } catch (e) { console.error('onClick do toast falhou', e); }
        }
        dismiss();
    });

    // Teto de empilhamento: no máx. 3 toasts (remove o mais antigo) pra não cobrir
    // os botões do card numa rajada de erros.
    while (container.children.length >= 3) {
        container.removeChild(container.firstElementChild);
    }
    container.appendChild(toast);
    const relogio = setTimeout(dismiss, durationMs);
    // Punho pra quem precisa ACOMPANHAR algo: trocar o texto no lugar em vez de
    // empilhar um toast por passo. Call site que não precisa simplesmente ignora.
    return {
        texto(novo) {
            const alvo = toast.querySelector('span.flex-1');
            if (alvo) alvo.textContent = novo;
        },
        dispensar() { clearTimeout(relogio); dismiss(); },
    };
}

function onSwipeLeft() { handleReject(); }
function onSwipeRight() { handleMarkAsRead(); }
function onSwipeUp() { handleSkip(); }
window.onSwipeLeft = onSwipeLeft;
window.onSwipeRight = onSwipeRight;
window.onSwipeUp = onSwipeUp;
window.showToast = showToast;

// Usado pelo swipe.js: o arraste não pode furar a janela do Desfazer.
window.acoesTravadas = acoesTravadas;

// Usados pelo presenca.js, que carrega DEPOIS deste arquivo.
window.cardParaConversa = cardParaConversa;
window.abrirPedidoRecebido = abrirPedidoRecebido;
