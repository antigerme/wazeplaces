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
const MAX_EMPTY_PAGES = 5;
const TYPES_ALL = ['VENUE', 'IMAGE', 'REQUEST'];
const UNAUTHORIZED_REDIRECT_MS = 800;
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
    filters: { types: ['VENUE', 'IMAGE', 'REQUEST'], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true, categories: [], sortOrder: 'newest' },
    preferences: { undoEnabled: true, semUndoSeguidas: 0 },
    devMode: { unlocked: false, active: false },
    profile: null,
    countries: [],
    statesByCountry: {},
    seenCategories: [],      // categorias vistas nos places carregados (fonte do filtro de categoria)
    history: null            // acumulado histórico { 'YYYY-MM-DD': { read, rejected } } (carregado lazy)
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

    loadStats();
    loadFilters();
    loadPreferences();
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
    setupKeyboardInset();
    setupAlturaDoHeader();
    setupDescargaAoSair();
    marcarSuporteAExtensao();
    setupInstalarApp();

    // Link de pareamento (?pair=CODE): o editor mandou pra si mesmo e abriu no
    // celular — entra direto, sem digitar nada. Tratado ANTES da sessão salva
    // porque um código novo deve vencer uma sessão velha do mesmo aparelho.
    const codigoNaURL = (() => {
        try { return new URLSearchParams(window.location.search).get('pair'); } catch (e) { return null; }
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
        showAuthScreen();
    }
}

// ── Gerenciador de modais ─────────────────────────────────────────────────
// Todos os diálogos (role="dialog") passam por aqui: foco entra no modal ao
// abrir e volta pro elemento de origem ao fechar; Esc fecha o modal aberto
// (via handleKeyDown); clique no scrim fecha; body trava o scroll.
// Novo modal? Adicionar o id em MODAL_IDS e usar openModal/closeModal.
const MODAL_IDS = ['pasteModal', 'logoutModal', 'accessDeniedModal', 'filtersModal', 'helpModal', 'batchReadModal', 'pairShowModal', 'pairEnterModal'];
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
    pairShowModal() {
        pararTickerPareamento();
        // O código é credencial e já não vale nada aqui: não fica desenhado
        // esperando alguém reabrir o modal e escanear um QR morto.
        const code = document.getElementById('pairCode');
        if (code) { code.textContent = '······'; delete code.dataset.raw; code.classList.remove('opacity-40', 'line-through'); }
        const exp = document.getElementById('pairExpiry');
        if (exp) exp.textContent = '';
        limparQrPareamento();
        const copiar = document.getElementById('pairCopyLinkBtn');
        if (copiar) copiar.disabled = true;
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
    $('helpBtn').addEventListener('click', () => openModal('helpModal'));
    $('closeHelp').addEventListener('click', () => closeModal('helpModal'));
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
let pairTicker = null;

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

function desenharQrPareamento(url) {
    const canvas = document.getElementById('pairQr');
    if (!canvas || typeof gerarQR !== 'function') return;
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
    closeModal('helpModal');
    openModal('pairShowModal');
    const codeEl = document.getElementById('pairCode');
    const expEl = document.getElementById('pairExpiry');
    codeEl.textContent = '······';
    delete codeEl.dataset.raw;
    codeEl.classList.remove('opacity-40', 'line-through');
    expEl.textContent = '';
    limparQrPareamento();
    document.getElementById('pairCopyLinkBtn').disabled = true;

    const r = await API.criarPareamento();
    if (!r.success) {
        closeModal('pairShowModal');
        showToast(msgDoServidor(r, t('toast.pairCreateError')), 'error');
        return;
    }
    codeEl.textContent = formatarCodigoPareamento(r.code);
    // O link de "copiar" e o QR usam o código CRU — separador é só apresentação.
    codeEl.dataset.raw = r.code;
    desenharQrPareamento(location.origin + '/?pair=' + r.code);
    document.getElementById('pairCopyLinkBtn').disabled = false;

    // Contagem regressiva: deixa claro que o código morre — e evita o editor
    // ficar tentando um código velho achando que a app quebrou.
    let restante = r.expiresIn;
    const tick = () => {
        if (restante <= 0) {
            expEl.textContent = t('pair.expired');
            codeEl.classList.add('opacity-40', 'line-through');
            clearInterval(pairTicker);
            pairTicker = null;
            return;
        }
        const m = Math.floor(restante / 60);
        const s = String(restante % 60).padStart(2, '0');
        expEl.textContent = t('pair.expiresIn', { time: m + ':' + s });
        restante--;
    };
    if (pairTicker) clearInterval(pairTicker);
    tick();
    pairTicker = setInterval(tick, 1000);
}

function pararTickerPareamento() {
    if (pairTicker) { clearInterval(pairTicker); pairTicker = null; }
}

async function copiarLinkPareamento() {
    const raw = document.getElementById('pairCode').dataset.raw;
    if (!raw) return;
    const url = location.origin + '/?pair=' + raw;
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

    // Pareamento
    $('pairCreateBtn')?.addEventListener('click', abrirPareamento);
    $('pairCopyLinkBtn')?.addEventListener('click', copiarLinkPareamento);
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
    $('prefDevModeActive').addEventListener('change', (e) => {
        if (!AppState.devMode.unlocked) return;
        AppState.devMode.active = e.target.checked;
        saveDevMode();
        updateDevBadge();
        renderRequestTypeRow(); // linha REQUEST aparece/some ao vivo na aba Filtros
        if (!e.target.checked) {
            // Dev off: desmarca REQUEST no DOM (a linha some, mas um checked
            // fantasma iria junto no próximo Aplicar) e tira do filtro salvo.
            const reqCb = document.querySelector('.filter-type[value="REQUEST"]');
            if (reqCb) reqCb.checked = false;
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
    open(urls, startIdx, newImageIdx, placeName, eDenuncia) {
        if (!urls || urls.length === 0) return;
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
    },
    close({ viaHistorico = false } = {}) {
        if (!this.isOpen()) return;
        if (!viaHistorico) CamadaVoltar.consumir();
        document.getElementById('imageLightbox').classList.add('hidden');
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
        count.classList.toggle('hidden', !multiple);
        if (multiple) count.textContent = `${this.idx + 1} / ${this.urls.length}`;
        badge.textContent = this.eDenuncia ? '🚩' : '✨';
        badge.setAttribute('data-i18n-title', this.eDenuncia ? 'card.flaggedPhoto.title' : 'card.newPhoto.title');
        badge.title = t(this.eDenuncia ? 'card.flaggedPhoto.title' : 'card.newPhoto.title');
        badge.classList.toggle('hidden', this.idx !== this.newIdx);
    }
};

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

function openLightbox(urls, startIdx, newImageIdx, placeName, eDenuncia) {
    Lightbox.open(urls, startIdx, newImageIdx, placeName, eDenuncia);
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
    renderRequestTypeRow();
    renderUndoGateUI();
    $('filterUnreadOnly').checked = AppState.filters.unreadOnly !== false;
    document.querySelectorAll('.filter-type').forEach(cb => {
        cb.checked = AppState.filters.types.includes(cb.value);
    });
    $('filterResidential').value = AppState.filters.residential;
    $('filterRegion').value = API.getRegion();

    if (AppState.countries.length === 0) {
        const r = await API.listCountries();
        if (r.success) AppState.countries = r.countries;
    }
    populateCountrySelect();
    populateManagedAreaSelect();
    await loadStatesIntoSelect(API.getCountry());

    $('filterMyArea').checked = AppState.filters.myArea;
    const disabled = AppState.filters.myArea;
    $('filterCountry').disabled = disabled;
    $('filterState').disabled = disabled;
    $('filterManagedArea').disabled = disabled;

    populateCategorySelect();
    const sortSel = $('filterSort');
    if (sortSel) sortSel.value = AppState.filters.sortOrder || 'newest';
    renderHistory();

    openModal('filtersModal');
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
    if (AppState.filters.types.length === 0) AppState.filters.types = ['VENUE', 'IMAGE'];
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
    resetQueue();
    startFetching();
}

function handleKeyDown(e) {
    if (Lightbox.isOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); Lightbox.close(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); Lightbox.prev(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); Lightbox.next(); }
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
        AppState.pendingAction.undo();
        AppState.pendingAction = null;
        removeUndoBanner();
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
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');
    document.getElementById('filtersBtn').classList.add('hidden');
    document.getElementById('refreshBtn').classList.add('hidden');
    document.getElementById('userProfileBadge').classList.add('hidden');
    const brandTitle = document.getElementById('brandTitle');
    if (brandTitle) brandTitle.classList.remove('sr-only'); // volta visível ao deslogar
    AppState.authenticated = false;
    AppState.profile = null;
}

function showMainScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('filtersBtn').classList.remove('hidden');
    document.getElementById('refreshBtn').classList.remove('hidden');
    AppState.authenticated = true;
    updateDevBadge();
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
        renderProfileHeader();
    }
    if (countriesRes.success) {
        AppState.countries = countriesRes.countries;
    }
}

function handleUnauthorized() {
    // Cancela ação pendente: a sessão já morreu no Waze, o executor falharia e
    // mostraria "erro ao marcar" na tela de login. Cancelar reverte o stat otimista.
    if (AppState.pendingAction) {
        AppState.pendingAction.cancel();
        AppState.pendingAction = null;
    }
    removeUndoBanner();
    showToast(t('toast.sessionExpired'), 'error');
    API.setSession(null);
    AppState.profile = null;
    AppState.authenticated = false;
    setTimeout(() => showAuthScreen(), UNAUTHORIZED_REDIRECT_MS);
}

function renderProfileHeader() {
    const p = AppState.profile;
    if (!p) return;
    const badge = document.getElementById('userProfileBadge');
    const avatar = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    const rankEl = document.getElementById('userRank');
    if (p.profileImageUrl) {
        avatar.src = p.profileImageUrl;
        avatar.style.display = '';
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
    AppState.filters = { types: ['VENUE', 'IMAGE', 'REQUEST'], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true };
    AppState.preferences = { undoEnabled: true };
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

function showCurrentPlace() {
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
    }
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
            type: place.updateType ? ', ' + place.updateType : ''
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
    card.querySelector('.card-no-name-badge').classList.toggle('hidden', !ident.semNome);
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
    const temMudancas = Array.isArray(place.changes) && place.changes.length > 0;
    card.querySelector('.card-type').textContent = temMudancas
        ? t('card.type.update')
        // "Reporte (Sinalização)" não diz o que foi reportado. Quando é foto, o
        // WME chama de "Foto sinalizada" — e o card marca QUAL das fotos é.
        : (place.flagSubjectType === 'IMAGE' ? t('card.type.flagImage')
            // `updateTypeKey` é a chave crua (VENUE, IMAGE, FLAG…). O
            // `updateType` em português continua vindo do core e serve de
            // último recurso, pra chave nova nunca deixar o campo vazio.
            : (rotuloDeEnum('card.updateType.', place.updateTypeKey)
               || place.updateType || ''));
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
    if (place.flagComment || place.flagType) {
        const box = card.querySelector('.card-flag-comment');
        const text = card.querySelector('.card-flag-comment-text');
        if (place.flagType) {
            // Enum não mapeado aparece CRU, pela mesma razão do diff de mudanças:
            // esconder o motivo de uma denúncia é pior que mostrá-lo em inglês.
            card.querySelector('.card-flag-reason-value').textContent =
                rotuloDeEnum('card.flagType.', place.flagType);
            card.querySelector('.card-flag-reason').classList.remove('hidden');
        }
        if (place.flagComment) {
            text.textContent = place.flagComment;
        } else {
            // Sem texto livre a caixa não pode reivindicar a sobra do card: viraria
            // um retângulo rosa vazio ocupando meia tela (gotcha #29).
            text.classList.add('hidden');
            box.classList.remove('flex-1', 'min-h-0');
            box.classList.add('flex-shrink-0');
        }
        box.classList.remove('hidden');
    }

    const wmeLink = card.querySelector('.card-wme-link');
    const region = API.getRegion();
    const envParam = region === 'na' ? 'usa' : region;
    const wmeParams = [`env=${envParam}`];
    if (place.lat && place.lon) {
        wmeParams.push(`lat=${place.lat}`, `lon=${place.lon}`, 'zoomLevel=22');
    }
    // O parâmetro venueUpdateRequest do WME espera o venueID (formato dotted
    // tipo "205522459.2055159053.3242788"), NÃO o id do venueUpdateRequest
    // (que é um UUID). Confirmado via HAR comparando URL do WME nativo.
    if (place.venueID) {
        wmeParams.push(`venueUpdateRequest=${encodeURIComponent(place.venueID)}`);
    }
    // URL CANÔNICA do WME, sem segmento de idioma (decisão do owner). Estava
    // `/pt-BR/editor`: um editor que usa a app em francês clicava no ↗ e caía
    // num WME em português. O `/editor` cru responde 200 direto (medido, sem
    // redirect HTTP) e o Waze resolve o idioma pela conta de quem abriu — que é
    // exatamente o certo, porque quem decide não somos nós.
    wmeLink.href = `${WME_EDITOR_URL}?${wmeParams.join('&')}`;

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
    prefetchNextImage();
}

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

    if (urls.length === 0) {
        img.classList.add('hidden');
        noImg.classList.remove('hidden');
        return;
    }

    // Um card é UM updateRequest: ou PROPÕE foto nova (✨ âmbar) ou DENUNCIA uma
    // existente (🚩 rosa) — nunca os dois. Daí um marcador só, com dois estados.
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

    const updateImage = () => {
        img.src = urls[currentImgIdx];
        img.alt = t('card.img.alt', { name: identidadeDoPlace(place).titulo, i: currentImgIdx + 1, n: urls.length });
        imgCount.textContent = `${currentImgIdx + 1} / ${urls.length}`;
        const isNew = currentImgIdx === newImageIdx;
        newBadge.classList.toggle('hidden', !isNew);
        newBorder.classList.toggle('hidden', !isNew);
    };
    img.classList.remove('hidden');
    img.classList.add('cursor-zoom-in');
    noImg.classList.add('hidden');
    img.decoding = 'async';
    // Foto quebrada (404 do Waze) → cai pro placeholder "Sem Imagem".
    img.onerror = () => { img.classList.add('hidden'); noImg.classList.remove('hidden'); };
    updateImage();

    img.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openLightbox(urls, currentImgIdx, newImageIdx, place.name, eDenuncia);
    });

    if (urls.length > 1) {
        imgNav.classList.remove('hidden');
        imgPrev.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            currentImgIdx = (currentImgIdx - 1 + urls.length) % urls.length;
            updateImage();
        });
        imgNext.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            currentImgIdx = (currentImgIdx + 1) % urls.length;
            updateImage();
        });
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
function itemDeLista(v, cls, sinal) {
    const txt = escapeHtml(valorDeLista(v));
    const corpo = itemDeListaAusente(v) ? `<span class="valor-ausente">${txt}</span>` : txt;
    return `<span class="${cls}"><span aria-hidden="true">${sinal}</span> ${corpo}</span>`;
}

function valorDeLista(v) {
    // MESMO placeholder do resto do card (`valorDoDiff` já fazia isto). Os
    // parênteses não são enfeite: resolvem a ambiguidade de um valor que
    // poderia se chamar "vazio", e são TEXTO, então leitor de tela lê.
    if (itemDeListaAusente(v)) return t('card.value.empty');
    if (v && typeof v === 'object') {
        // Ponto de entrada/saída: o que importa é qual é e onde fica.
        const p = v.point && v.point.coordinates;
        if (Array.isArray(p) && p.length >= 2) {
            const tipo = v.entry === false ? t('card.eep.exit') : t('card.eep.entry');
            const nome = String(v.name || '').trim();
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
function focarAutor(nome) {
    if (!nome) return;
    const daPessoa = AppState.queue.filter((x) => x.createdBy === nome);
    if (daPessoa.length === 0) return;
    AppState.queue = [...daPessoa, ...AppState.queue.filter((x) => x.createdBy !== nome)];
    AppState.autorEmFoco = nome;
    AppState.currentPlace = AppState.queue[0];
    renderFocoAutor();
    removeCurrentCardEl();
    showCurrentPlace();
    updatePendingCount();
}

function limparFocoAutor() {
    if (!AppState.autorEmFoco) return;
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
    const nome = AppState.autorEmFoco;
    const atual = AppState.queue[0];
    if (!nome || !atual || atual.createdBy !== nome) {
        if (nome && atual && atual.createdBy !== nome) AppState.autorEmFoco = null;
        bar.classList.add('hidden');
        return;
    }
    const restam = AppState.queue.filter((x) => x.createdBy === nome).length;
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
        if (rot) selos.push({ cls: 'selo-src', txt: rot, title: t('card.source.title') });
    }
    const mesmos = (AppState.queue || [])
        .filter((x) => x !== place && x.createdBy && x.createdBy === place.createdBy).length;
    if (mesmos > 0) {
        selos.push({ cls: 'selo-lote', txt: t('card.sameAuthor', { n: mesmos }),
                     title: t('card.sameAuthor.acao'), acao: place.createdBy });
    }
    if (!selos.length) return;
    const box = document.createElement('span');
    box.className = 'selos-proc';
    for (const s of selos) {
        // O selo do lote é o único que AGE: vira botão de verdade (não span com
        // onclick), pra receber foco no Tab e ser anunciado como acionável.
        const el = document.createElement(s.acao ? 'button' : 'span');
        el.className = 'selo-proc ' + s.cls;
        el.textContent = s.txt;
        el.title = s.title;
        if (s.acao) {
            el.type = 'button';
            el.classList.add('selo-acionavel');
            el.addEventListener('click', (ev) => { ev.stopPropagation(); focarAutor(s.acao); });
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
            const add = (c.delta.add || []).map((v) => itemDeLista(v, 'diff-add', '+')).join('');
            const del = (c.delta.del || []).map((v) => itemDeLista(v, 'diff-del', '−')).join('');
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
            const linhas = c.objDelta.map((l) => {
                const caminho = `<span class="diff-obj-caminho">${escapeHtml(l.caminho)}</span>`;
                // Folha que é LISTA usa o mesmo vocabulário do campo de lista de
                // topo (+ verde entra, − vermelho sai). Dois blocos de JSON lado
                // a lado era o que estava aqui — medido no `chargingPorts` de um
                // eletroposto, e ninguém lia.
                if (l.delta && ((l.delta.add || []).length || (l.delta.del || []).length)) {
                    const add = (l.delta.add || []).map((v) => itemDeLista(v, 'diff-add', '+')).join('');
                    const del = (l.delta.del || []).map((v) => itemDeLista(v, 'diff-del', '−')).join('');
                    return `<span class="diff-obj-linha diff-obj-linha-lista">${caminho}`
                        + `<span class="diff-delta">${add}${del}</span></span>`;
                }
                return `<span class="diff-obj-linha">${caminho}`
                    + `<span class="diff-from">${escapeHtml(valorDoDiff(l.de))}</span>`
                    + `<span class="diff-to">${escapeHtml(valorDoDiff(l.para))}</span></span>`;
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
    return !!AppState.pendingAction;
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
// num pedido de place ela é informação de decisão.
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

// Traduz enum do Waze por prefixo de chave, humanizando o que não conhecemos.
function rotuloDeEnum(prefixo, valor) {
    if (!valor) return '';
    const chave = prefixo + valor;
    const traduzido = t(chave);
    return traduzido === chave ? humanizarEnum(valor) : traduzido;
}

// Pré-carrega a imagem do próximo place da fila — mata o flash branco no swipe.
function prefetchNextImage() {
    const next = AppState.queue[1];
    if (!next) return;
    const url = (next.imageUrls && next.imageUrls[0]) || next.imageUrl;
    if (url) { const im = new Image(); im.src = url; }
}

function showNoPlaces() {
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
    // Migração do formato antigo (só baldes): soma o que já existe pro
    // acumulador, senão a primeira poda faria o "Total" encolher.
    if (!h._total) {
        const t = { read: 0, rejected: 0 };
        for (const [k, v] of Object.entries(h)) {
            if (k === '_total' || !v) continue;
            t.read += v.read || 0;
            t.rejected += v.rejected || 0;
        }
        h._total = t;
    }
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
function renderHistory() {
    const el = document.getElementById('historyBody');
    if (!el) return;
    const s = getHistoryStats();
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

function handleActionResult(actionType, place, result) {
    if (!result) return;
    if (result.success) { recordHistory(actionType, 1); return; }

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

function handleMarkAsRead() {
    if (!AppState.currentPlace) return;
    if (acoesTravadas()) return;   // janela do Desfazer correndo
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

function scheduleAction(type, place, executor) {
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
        cancel: () => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                if (type === 'read') AppState.stats.read = Math.max(0, AppState.stats.read - 1);
                else if (type === 'reject') AppState.stats.rejected = Math.max(0, AppState.stats.rejected - 1);
                else if (type === 'skip') AppState.stats.skipped = Math.max(0, AppState.stats.skipped - 1);
            }
        },
        undo: () => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                // Usou: a evidência de "nunca desfaz" morre aqui e recomeça do
                // zero. Quem desfaz de vez em quando não deve receber a dica.
                zerarJanelasSemUndo();
                if (type === 'read') AppState.stats.read = Math.max(0, AppState.stats.read - 1);
                else if (type === 'reject') AppState.stats.rejected = Math.max(0, AppState.stats.rejected - 1);
                else if (type === 'skip') AppState.stats.skipped = Math.max(0, AppState.stats.skipped - 1);
                if (type !== 'skip') AppState.serverTotal++; // skip nunca decrementou o total
                updateStats();
                saveStats();
                AppState.queue.unshift(place);
                updatePendingCount();
                showCurrentPlace();
            }
        }
    };

    const undoMsg = type === 'reject' ? t('undo.reject') : type === 'skip' ? t('undo.skip') : t('undo.read');
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
    document.getElementById('undoBtn').addEventListener('click', () => {
        if (AppState.pendingAction) {
            AppState.pendingAction.undo();
            AppState.pendingAction = null;
        }
        removeUndoBanner();
    });
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

function setCount(el, valor, sufixo = '') {
    if (!el) return;
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

function updateStats() {
    // Todo caminho que mexe em Lidos/Rejeitados passa por aqui (swipe, botão,
    // lote, undo revertendo) — é o único ponto que pega todos sem espalhar
    // chamadas por seis handlers.
    checkUndoGateUnlock();
    setCount(document.getElementById('readCount'), AppState.stats.read);
    setCount(document.getElementById('rejectedCount'), AppState.stats.rejected);
    setCount(document.getElementById('skippedCount'), AppState.stats.skipped);
    updatePendingCount();
}

function updatePendingCount() {
    const el = document.getElementById('pendingCount');
    if (!el) return;
    if (!AppState.authenticated) {
        el.textContent = '—';
        return;
    }
    if (AppState.fetching && AppState.serverTotal === 0) {
        el.textContent = '…';
        return;
    }
    setCount(el, AppState.serverTotal, AppState.hasMore ? '+' : '');
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
            AppState.filters.types = parsed.types || ['VENUE', 'IMAGE'];
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

function savePreferences() {
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
            // undefined = nunca decidido (user antigo ou primeira visita).
            // Só copia se for boolean, pra initUndoGateSeen poder decidir depois.
            if (typeof parsed.undoGateSeen === 'boolean') {
                AppState.preferences.undoGateSeen = parsed.undoGateSeen;
            }
            if (typeof parsed.dicaDesfazerVista === 'boolean') {
                AppState.preferences.dicaDesfazerVista = parsed.dicaDesfazerVista;
            }
            if (typeof parsed.semUndoSeguidas === 'number' && parsed.semUndoSeguidas >= 0) {
                AppState.preferences.semUndoSeguidas = parsed.semUndoSeguidas;
            }
        }
    } catch (e) {}
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
    if (!AppState.pendingAction) return;
    // Fetch normal é cancelado no unload; keepalive sobrevive.
    if (typeof API !== 'undefined' && API.setSaindo) API.setSaindo(true);
    try {
        AppState.pendingAction.execute();
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

// REQUEST (Reportes/Atualizações) é gated por dev mode enquanto o flow de
// LIBERADO. O tipo REQUEST (mudanças, reportes e pedidos de remoção) ficou
// atrás do Modo Desenvolvedor enquanto os cards não davam conta dele — que é
// pra isso que o modo dev existe neste projeto: soltar recurso quando fica
// redondo.
//
// O custo de deixar fechado era grande e só apareceu medindo: numa fila real de
// 137 pedidos, 135 eram REQUEST. O editor abria a app e via DOIS. 98% do
// trabalho estava escondido atrás de uma caixa que ele nem enxergava.
//
// O que faltava, e foi feito antes de abrir: geometria virou distância legível
// (era "[object Object]"), listas mostram o que entrou e saiu, os três tipos de
// reporte que existem de verdade ganharam tradução (o dicionário só tinha
// INAPPROPRIATE, que não ocorre nenhuma vez), openingHours e entryExitPoints
// pararam de vazar JSON, e o card de remoção parou de repetir a própria frase.
// Auditado em 960 renders — 40 viewports do Chrome DevTools × 4 idiomas × 6
// tipos de card, com pedido REAL — com zero problema.
function renderRequestTypeRow() {
    const row = document.getElementById('filterTypeRequestRow');
    if (!row) return;
    row.classList.remove('hidden');
}

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

function getUndoUnlockThreshold() {
    if (AppState.profile && AppState.profile.isStaff) return 0;
    const rank = AppState.profile && AppState.profile.rank;
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
    if (typeof AppState.preferences.undoGateSeen === 'boolean') return;
    AppState.preferences.undoGateSeen = undoGateAtingido();
    savePreferences();
}

function checkUndoGateUnlock() {
    if (AppState.preferences.undoGateSeen) return;
    // Sem perfil a cota é Infinity — não dispara nada até o perfil chegar.
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
    setTimeout(dismiss, durationMs);
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
