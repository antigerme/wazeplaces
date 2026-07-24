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
const MAX_CHANGES_DISPLAY = 4;
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
    stats: { read: 0, rejected: 0, skipped: 0 },
    pendingAction: null,
    inFlightActions: 0,
    fetchEpoch: 0,
    _fetchPromise: null,
    _profilePromise: null,
    loadError: false,
    filters: { types: ['VENUE', 'IMAGE'], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true, categories: [], sortOrder: 'newest' },
    preferences: { undoEnabled: true },
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

window.addEventListener('error', (e) => {
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

    const savedToken = API.getSession();
    if (savedToken) {
        showMainScreen();
        AppState._profilePromise = loadProfileAndAuxData();
        startFetching();
    } else {
        showAuthScreen();
    }
}

// ── Gerenciador de modais ─────────────────────────────────────────────────
// Todos os diálogos (role="dialog") passam por aqui: foco entra no modal ao
// abrir e volta pro elemento de origem ao fechar; Esc fecha o modal aberto
// (via handleKeyDown); clique no scrim fecha; body trava o scroll.
// Novo modal? Adicionar o id em MODAL_IDS e usar openModal/closeModal.
const MODAL_IDS = ['pasteModal', 'logoutModal', 'accessDeniedModal', 'filtersModal', 'helpModal', 'batchReadModal'];
let lastFocusedBeforeModal = null;

function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    // Modais não empilham: fecha qualquer outro aberto (ex.: Sair a partir da Ajuda)
    MODAL_IDS.forEach(other => {
        if (other !== id) document.getElementById(other)?.classList.add('hidden');
    });
    lastFocusedBeforeModal = document.activeElement;
    m.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const focusable = m.querySelector('textarea, input:not([type=hidden]):not(:disabled), select, button');
    if (focusable) focusable.focus();
}

function closeModal(id) {
    const m = document.getElementById(id);
    if (!m || m.classList.contains('hidden')) return;
    m.classList.add('hidden');
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

// Seletor de idioma (no modal de filtros). Troca a língua, persiste, reaplica o
// dicionário e re-renderiza as partes dinâmicas.
function setupLanguageSwitcher() {
    const sel = document.getElementById('langSelect');
    if (!sel || typeof setLang !== 'function') return;
    sel.value = (typeof getLang === 'function') ? getLang() : 'pt';
    sel.addEventListener('change', () => {
        setLang(sel.value);
        safeLS.set(LANG_KEY, sel.value);
        applyI18n();
        if (AppState.profile) renderProfileHeader(AppState.profile);
        if (AppState.currentPlace) showCurrentPlace();
        updateStats();
        updatePendingCount();
        if (typeof showToast === 'function') showToast(t('toast.langChanged'), 'success');
    });
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

function setupModalListeners() {
    const $ = id => document.getElementById(id);
    $('closeFilters').addEventListener('click', () => closeModal('filtersModal'));
    $('cancelFilters').addEventListener('click', () => closeModal('filtersModal'));
    $('closeFiltersFooter').addEventListener('click', () => closeModal('filtersModal'));
    $('applyFilters').addEventListener('click', applyFiltersFromModal);
    $('batchReadBtn')?.addEventListener('click', openBatchReadConfirm);
    $('confirmBatchRead')?.addEventListener('click', handleBatchMarkRead);
    $('cancelBatchRead')?.addEventListener('click', () => closeModal('batchReadModal'));
    setupFilterTabs();
    setupLanguageSwitcher();
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
    open(urls, startIdx, newImageIdx, placeName) {
        if (!urls || urls.length === 0) return;
        this.urls = urls;
        this.idx = Math.max(0, Math.min(startIdx || 0, urls.length - 1));
        this.newIdx = (newImageIdx !== undefined && newImageIdx !== null) ? newImageIdx : -1;
        this.placeName = placeName || '';
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
    close() {
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

function openLightbox(urls, startIdx, newImageIdx, placeName) {
    Lightbox.open(urls, startIdx, newImageIdx, placeName);
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

    select.innerHTML = countries.map(c =>
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

    for (const s of states) {
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
            showToast(result.error || t('toast.invalidCookies'), 'error');
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
    msg.textContent = result.error || t('accessDenied.defaultMsg');
    if (result.profile && result.profile.userName) {
        const p = result.profile;
        const displayRank = (p.rank !== null && p.rank !== undefined) ? ('L' + (p.rank + 1)) : '';
        const tags = [];
        if (displayRank) tags.push(displayRank);
        tags.push(p.isStaff ? t('profile.tag.staff') : (p.isAreaManager ? t('profile.tag.am') : t('profile.tag.notAm')));
        profileBox.innerHTML = `<strong>${escapeHtml(p.userName)}</strong> <span class="text-slate-500">· ${escapeHtml(tags.join(' · '))}</span>`;
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
    await API.destroySession();
    resetQueue();
    AppState.stats = { read: 0, rejected: 0, skipped: 0 };
    AppState.filters = { types: ['VENUE', 'IMAGE'], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true };
    AppState.preferences = { undoEnabled: true };
    AppState.devMode = { unlocked: false, active: false };
    AppState.profile = null;
    AppState.authenticated = false;
    AppState.pendingAction = null;
    AppState.inFlightActions = 0;
    AppState.history = {};
    safeLS.remove(HISTORY_KEY); // logout = esquecer tudo (inclui histórico)
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
                    showToast(result.error || t('toast.loadPlacesError'), 'error');
                    AppState.loadError = true;
                    AppState.hasMore = false;
                }
                return;
            }

            AppState.hasMore = !!result.hasMore;
            AppState.nextPage++;

            const newPlaces = result.places || [];
            if (newPlaces.length === 0) {
                AppState.emptyPagesInRow++;
                if (AppState.emptyPagesInRow >= MAX_EMPTY_PAGES) {
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
            name: place.name || t('card.noName'),
            type: place.updateType ? ', ' + place.updateType : ''
        });
    }

    const template = document.getElementById('cardTemplate');
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.place-card');

    card.querySelector('.card-name').textContent = place.name;
    card.querySelector('.card-category').textContent = place.categories && place.categories.length > 0
        ? place.categories.join(', ')
        : t('card.categories.empty');
    card.querySelector('.card-address').textContent = place.address || t('card.address.empty');
    card.querySelector('.card-type').textContent = place.updateType || t('card.type.empty');
    card.querySelector('.card-creator').textContent = place.createdBy || t('card.creator.empty');

    if (place.isDelete) {
        card.querySelector('.card-delete-banner').classList.remove('hidden');
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

    if (place.flagComment) {
        const box = card.querySelector('.card-flag-comment');
        const text = card.querySelector('.card-flag-comment-text');
        text.textContent = place.flagComment;
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
    wmeLink.href = `https://www.waze.com/pt-BR/editor?${wmeParams.join('&')}`;

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

    removeCurrentCardEl();
    document.getElementById('cardStack').appendChild(card);
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

    const newImageIdx = place.updateRequestID
        ? urls.findIndex(u => u.indexOf(place.updateRequestID) !== -1)
        : -1;
    let currentImgIdx = newImageIdx >= 0 ? newImageIdx : 0;

    const updateImage = () => {
        img.src = urls[currentImgIdx];
        img.alt = t('card.img.alt', { name: place.name || t('card.noName'), i: currentImgIdx + 1, n: urls.length });
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
        openLightbox(urls, currentImgIdx, newImageIdx, place.name);
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
function renderCardChanges(card, place) {
    if (!place.changes || place.changes.length === 0) return;
    const changesBox = card.querySelector('.card-changes');
    const changesList = card.querySelector('.card-changes-list');
    const visible = place.changes.slice(0, MAX_CHANGES_DISPLAY);
    const hiddenCount = place.changes.length - visible.length;
    let html = visible.map(c => `
            <div class="diff-row">
                <span class="text-xs font-semibold text-slate-600">${escapeHtml(c.label)}:</span>
                <span class="diff-from">${escapeHtml(c.from)}</span>
                <span class="diff-to">${escapeHtml(c.to)}</span>
            </div>
        `).join('');
    if (hiddenCount > 0) {
        html += `<div class="text-xs text-slate-500 italic pt-1">${escapeHtml(t(hiddenCount === 1 ? 'card.changes.more' : 'card.changes.morePlural', { n: hiddenCount }))}</div>`;
    }
    changesList.innerHTML = html;
    changesBox.classList.remove('hidden');
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
function loadHistory() {
    if (AppState.history) return AppState.history;
    let h = {};
    try { h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}') || {}; } catch (e) { h = {}; }
    AppState.history = h;
    return h;
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
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (e) {}
}
function getHistoryStats() {
    const h = loadHistory();
    const now = Date.now();
    const tk = historyTodayKey();
    const acc = { today: { read: 0, rejected: 0 }, week: { read: 0, rejected: 0 }, month: { read: 0, rejected: 0 }, total: { read: 0, rejected: 0 } };
    for (const [k, v] of Object.entries(h)) {
        const r = v.read || 0, j = v.rejected || 0;
        acc.total.read += r; acc.total.rejected += j;
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
        el.innerHTML = `<p class="text-xs text-slate-500">${escapeHtml(t('stats.history.empty'))}</p>`;
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
    showToast(result.error || t('toast.actionError', { verb }), 'error');
}

function handleMarkAsRead() {
    if (!AppState.currentPlace) return;
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
            showToast((result && result.error) || t('toast.batchError'), 'error');
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

function updateStats() {
    document.getElementById('readCount').textContent = AppState.stats.read;
    document.getElementById('rejectedCount').textContent = AppState.stats.rejected;
    document.getElementById('skippedCount').textContent = AppState.stats.skipped;
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
    el.textContent = AppState.hasMore ? (AppState.serverTotal + '+') : String(AppState.serverTotal);
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

function setupDevModeTapTrigger(el) {
    let tapCount = 0;
    let resetTimer = null;
    el.addEventListener('click', () => {
        if (AppState.devMode.unlocked) return;
        tapCount++;
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { tapCount = 0; }, DEVMODE_TAP_TIMEOUT_MS);
        const remaining = DEVMODE_TAPS_NEEDED - tapCount;
        if (remaining === 0) {
            AppState.devMode.unlocked = true;
            saveDevMode();
            tapCount = 0;
            if (window.showToast) window.showToast(t('toast.devUnlocked'), 'success');
        } else if (remaining > 0 && remaining <= 3) {
            if (window.showToast) {
                window.showToast(t('toast.devCountdown', { n: remaining }), 'info');
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
// UPDATE PURs (mudanças, flags, deletes) ainda tem casos não cobertos.
// Quando estiver maduro, é só remover esse gate.
function renderRequestTypeRow() {
    const row = document.getElementById('filterTypeRequestRow');
    if (!row) return;
    row.classList.toggle('hidden', !AppState.devMode.active);
}

// Remove tipos gated do filtro salvo se o user não tem mais permissão.
// Cobre 2 cenários:
//   (1) migração: user com saved=['VENUE','IMAGE','REQUEST'] sem dev mode
//       precisa ter REQUEST retirado (default novo é só VENUE+IMAGE)
//   (2) user desliga dev mode no modal e tinha REQUEST checado → tira
function enforceDevGatedFilters() {
    if (AppState.devMode.active) return;
    const before = AppState.filters.types.length;
    AppState.filters.types = AppState.filters.types.filter(t => t !== 'REQUEST');
    if (AppState.filters.types.length !== before) saveFilters();
}

// Gate de experiência pro toggle "Permitir desfazer ações".
// Ideia: novatos não conseguem desligar o undo até pegarem ritmo. Editores de
// nível mais alto têm cota menor (são mais experientes).
// Fórmula: ceil(3000 / (rank + 1)). Waze devolve rank 0-indexed:
//   rank 5 (L6) → 500 PURs, rank 4 (L5) → 600, rank 3 (L4) → 750, rank 2 (L3) → 1000.
// "PURs tratados" = read + rejected (skipped não treina o ritmo de ação destrutiva).
// Staff são isentos. Esta NÃO é proteção de segurança — é UX/educação. localStorage
// pode ser editado pelo user esperto; o objetivo é proteger quem é genuinamente novato.
function getUndoTreatedCount() {
    return (AppState.stats.read || 0) + (AppState.stats.rejected || 0);
}

function getUndoUnlockThreshold() {
    if (AppState.profile && AppState.profile.isStaff) return 0;
    const rank = AppState.profile && AppState.profile.rank;
    if (typeof rank !== 'number') return Infinity;
    return Math.ceil(3000 / (rank + 1));
}

function canDisableUndo() {
    // Modo Desenvolvedor bypassa o gate de experiência completamente.
    if (AppState.devMode && AppState.devMode.active) return true;
    return getUndoTreatedCount() >= getUndoUnlockThreshold();
}

function renderUndoGateUI() {
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
function showToast(message, type = 'info', durationMs = 4000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');

    const colors = {
        success: 'bg-emerald-700',
        error: 'bg-rose-600',
        info: 'bg-slate-800 dark:bg-slate-100 dark:text-slate-900'
    };

    const icons = {
        success: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
        error: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
        info: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };

    toast.className = `toast ${colors[type]} text-white font-medium text-sm`;
    toast.innerHTML = `${icons[type]}<span class="flex-1">${escapeHtml(message)}</span>`;
    toast.title = t('toast.dismissHint');

    let removed = false;
    const dismiss = () => {
        if (removed) return;
        removed = true;
        toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 250);
    };
    toast.addEventListener('click', dismiss);

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
