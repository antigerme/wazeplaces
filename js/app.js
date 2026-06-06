const APP_VERSION = '2.19.1';
const TRANSIENT_RETRY_ATTEMPTS = 2;
const TRANSIENT_RETRY_DELAYS_MS = [1500, 3500];
const STATS_KEY = 'waze_places_stats';
const FILTERS_KEY = 'waze_places_filters';
const PREFERENCES_KEY = 'waze_places_preferences';
const DEVMODE_KEY = 'waze_places_devmode';
const THEME_KEY = 'waze_places_theme';
const DEVMODE_TAPS_NEEDED = 7;
const DEVMODE_TAP_TIMEOUT_MS = 3000;
const UNDO_WINDOW_MS = 3000;
const MAX_CHANGES_DISPLAY = 4;
const PREFETCH_THRESHOLD = 3;
const MAX_EMPTY_PAGES = 5;

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
    filters: { types: ['VENUE', 'IMAGE'], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true },
    preferences: { undoEnabled: true },
    devMode: { unlocked: false, active: false },
    profile: null,
    countries: [],
    statesByCountry: {}
};

window.AppState = AppState;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

window.addEventListener('error', (e) => {
    console.error('Erro JS não-tratado:', e.error || e.message, e.filename, e.lineno);
    if (window.showToast) {
        window.showToast('Erro inesperado: ' + (e.message || 'recarregue a página'), 'error');
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
        versionEl.textContent = 'v' + APP_VERSION;
        setupDevModeTapTrigger(versionEl);
    }

    loadStats();
    loadFilters();
    loadPreferences();
    loadDevMode();
    enforceDevGatedFilters();
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');

    API.getRegion();
    API.getCountry();

    setupAuthListeners();
    setupAppListeners();
    setupModalListeners();
    setupLightbox();
    if (window.initSwipe) window.initSwipe();

    const savedToken = API.getSession();
    if (savedToken) {
        showMainScreen();
        loadProfileAndAuxData();
        startFetching();
    } else {
        showAuthScreen();
    }
}

function setupAuthListeners() {
    const $ = id => document.getElementById(id);

    $('uploadBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', handleFileUpload);
    $('pasteBtn').addEventListener('click', () => $('pasteModal').classList.remove('hidden'));
    $('confirmPaste').addEventListener('click', handlePasteConfirm);
    $('cancelPaste').addEventListener('click', () => {
        $('pasteModal').classList.add('hidden');
        $('cookiesTextarea').value = '';
    });
    $('byAuthor').addEventListener('click', () => {
        window.open('https://www.waze.com/user/editor/antigerme', '_blank');
    });
    $('closeAccessDenied').addEventListener('click', () => $('accessDeniedModal').classList.add('hidden'));

    const regionSelect = $('regionSelect');
    regionSelect.value = API.getRegion();
    regionSelect.addEventListener('change', () => API.setRegion(regionSelect.value));
}

function setupAppListeners() {
    const $ = id => document.getElementById(id);

    // Fecha o helpModal antes de abrir o logoutModal porque ambos têm z-50 e
    // helpModal está depois no DOM (renderizaria por cima, escondendo a
    // confirmação de Sair até o user fechar o help manualmente).
    $('logoutBtn').addEventListener('click', () => {
        $('helpModal').classList.add('hidden');
        $('logoutModal').classList.remove('hidden');
    });
    $('confirmLogout').addEventListener('click', handleLogout);
    $('cancelLogout').addEventListener('click', () => $('logoutModal').classList.add('hidden'));

    $('reloadBtn').addEventListener('click', () => {
        resetQueue();
        startFetching();
    });
    $('helpBtn').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
    $('closeHelp').addEventListener('click', () => $('helpModal').classList.add('hidden'));
    $('themeBtn').addEventListener('click', toggleTheme);
    $('filtersBtn').addEventListener('click', openFiltersModal);

    window.addEventListener('keydown', handleKeyDown);
}

function setupModalListeners() {
    const $ = id => document.getElementById(id);
    $('closeFilters').addEventListener('click', () => $('filtersModal').classList.add('hidden'));
    $('cancelFilters').addEventListener('click', () => $('filtersModal').classList.add('hidden'));
    $('applyFilters').addEventListener('click', applyFiltersFromModal);
    $('filterCountry').addEventListener('change', (e) => {
        loadStatesIntoSelect(parseInt(e.target.value, 10));
    });
    $('filterMyArea').addEventListener('change', (e) => {
        const checked = e.target.checked;
        $('filterCountry').disabled = checked;
        $('filterState').disabled = checked;
        $('filterManagedArea').disabled = checked;
    });
}

const Lightbox = {
    urls: [],
    idx: 0,
    newIdx: -1,
    isOpen() {
        return !document.getElementById('imageLightbox').classList.contains('hidden');
    },
    open(urls, startIdx, newImageIdx) {
        if (!urls || urls.length === 0) return;
        this.urls = urls;
        this.idx = Math.max(0, Math.min(startIdx || 0, urls.length - 1));
        this.newIdx = (newImageIdx !== undefined && newImageIdx !== null) ? newImageIdx : -1;
        document.getElementById('imageLightbox').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this._render();
    },
    close() {
        document.getElementById('imageLightbox').classList.add('hidden');
        document.body.style.overflow = '';
        document.getElementById('lightboxImage').removeAttribute('src');
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
    _render() {
        document.getElementById('lightboxImage').src = this.urls[this.idx];
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
    document.getElementById('lightboxClose').addEventListener('click', () => Lightbox.close());
    document.getElementById('lightboxPrev').addEventListener('click', (e) => { e.stopPropagation(); Lightbox.prev(); });
    document.getElementById('lightboxNext').addEventListener('click', (e) => { e.stopPropagation(); Lightbox.next(); });
    lb.addEventListener('click', (e) => {
        if (e.target === lb) Lightbox.close();
    });
}

function openLightbox(urls, startIdx, newImageIdx) {
    Lightbox.open(urls, startIdx, newImageIdx);
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
        `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join('');

    const current = API.getCountry();
    if (countries.some(c => c.id === current)) {
        select.value = current;
    } else if (countries.length > 0) {
        select.value = countries[0].id;
        API.setCountry(countries[0].id);
    }
}

async function loadStatesIntoSelect(countryId) {
    const select = document.getElementById('filterState');
    select.innerHTML = '<option value="">Todos os estados</option>';
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
    select.innerHTML = '<option value="">Nenhuma</option>' +
        areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    if (AppState.filters.managedAreaId) select.value = AppState.filters.managedAreaId;
}

async function openFiltersModal() {
    const $ = id => document.getElementById(id);
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

    $('filtersModal').classList.remove('hidden');
}

function applyFiltersFromModal() {
    const $ = id => document.getElementById(id);
    // Dev Mode: aplicado antes pra que canDisableUndo já reflita a nova flag
    // antes de a gente decidir o undoEnabled.
    if (AppState.devMode.unlocked) {
        AppState.devMode.active = $('prefDevModeActive').checked;
        saveDevMode();
        updateDevBadge();
    }
    // Gate: se o user ainda não atingiu a cota (e dev mode não tá ativo),
    // ignora o checkbox e força true. Evita burla via DevTools no DOM.
    AppState.preferences.undoEnabled = canDisableUndo() ? $('prefUndoEnabled').checked : true;
    savePreferences();

    AppState.filters.unreadOnly = $('filterUnreadOnly').checked;
    AppState.filters.types = Array.from(document.querySelectorAll('.filter-type:checked')).map(cb => cb.value);
    // Se o user desligou dev mode neste mesmo Apply, REQUEST pode ter ficado
    // checked no DOM mas precisa sair do filtro.
    enforceDevGatedFilters();
    AppState.filters.residential = $('filterResidential').value;
    AppState.filters.stateId = $('filterState').value;
    AppState.filters.managedAreaId = $('filterManagedArea').value;
    AppState.filters.myArea = $('filterMyArea').checked;
    API.setCountry($('filterCountry').value);
    API.setRegion($('filterRegion').value);
    saveFilters();
    $('filtersModal').classList.add('hidden');
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

    if (!AppState.currentPlace) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

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

function showAuthScreen() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');
    document.getElementById('filtersBtn').classList.add('hidden');
    document.getElementById('userProfileBadge').classList.add('hidden');
    const brandTitle = document.getElementById('brandTitle');
    if (brandTitle) brandTitle.classList.remove('hidden');
    AppState.authenticated = false;
    AppState.profile = null;
}

function showMainScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('filtersBtn').classList.remove('hidden');
    AppState.authenticated = true;
    updateDevBadge();
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const content = await file.text();
        await authenticateWithCookies(content);
    } catch (error) {
        showToast('Erro ao ler arquivo', 'error');
    }
}

async function handlePasteConfirm() {
    const content = document.getElementById('cookiesTextarea').value.trim();
    if (!content) {
        showToast('Por favor, cole o conteúdo dos cookies', 'error');
        return;
    }
    document.getElementById('pasteModal').classList.add('hidden');
    await authenticateWithCookies(content);
    document.getElementById('cookiesTextarea').value = '';
}

async function authenticateWithCookies(cookies) {
    showToast('Validando cookies...', 'info');
    try {
        const result = await API.testCookies(cookies);
        if (result.success) {
            showMainScreen();
            resetQueue();
            loadProfileAndAuxData();
            startFetching();
            showToast('Autenticado com sucesso!', 'success');
        } else if (result.errorCategory === 'access_denied') {
            showAccessDenied(result);
        } else {
            showToast(result.error || 'Cookies inválidos', 'error');
        }
    } catch (error) {
        showToast('Erro ao validar cookies', 'error');
    }
}

function showAccessDenied(result) {
    const modal = document.getElementById('accessDeniedModal');
    const msg = document.getElementById('accessDeniedMessage');
    const profileBox = document.getElementById('accessDeniedProfile');
    msg.textContent = result.error || 'Acesso negado.';
    if (result.profile && result.profile.userName) {
        const p = result.profile;
        const displayRank = (p.rank !== null && p.rank !== undefined) ? ('L' + (p.rank + 1)) : '';
        const tags = [];
        if (displayRank) tags.push(displayRank);
        tags.push(p.isStaff ? 'Staff' : (p.isAreaManager ? 'AM' : 'não-AM'));
        profileBox.innerHTML = `<strong>${escapeHtml(p.userName)}</strong> <span class="text-slate-400">· ${escapeHtml(tags.join(' · '))}</span>`;
        profileBox.classList.remove('hidden');
    } else {
        profileBox.classList.add('hidden');
    }
    modal.classList.remove('hidden');
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
    showToast('Sessão expirou — faça login novamente', 'error');
    API.setSession(null);
    AppState.profile = null;
    AppState.authenticated = false;
    setTimeout(() => showAuthScreen(), 800);
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
    if (p.isStaff) tags.push('Staff');
    else if (p.isAreaManager) tags.push('AM');
    rankEl.textContent = tags.join(' · ');
    badge.classList.remove('hidden');
    const brandTitle = document.getElementById('brandTitle');
    if (brandTitle) brandTitle.classList.add('hidden');
}

// Sair = esquecer o user completamente. Apaga sessão, stats, filters,
// preferences, region e country deste dispositivo. Equivale a "reinstalar
// a app". Único item mantido: tema (light/dark) por ser preferência de
// dispositivo, não identidade do usuário. handleUnauthorized (cookies
// expiram pelo Waze) NÃO chama isso — preserva tudo pra próximo login.
async function handleLogout() {
    document.getElementById('logoutModal').classList.add('hidden');
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
    const regionSelect = document.getElementById('regionSelect');
    if (regionSelect) regionSelect.value = 'row';
    showToast('Sessão encerrada e dados apagados.', 'info');
}

function resetQueue() {
    AppState.queue = [];
    AppState.nextPage = 1;
    AppState.hasMore = true;
    AppState.emptyPagesInRow = 0;
    AppState.currentPlace = null;
    AppState.serverTotal = 0;
    updatePendingCount();
}

function showLoading(visible) {
    document.getElementById('loadingCard').classList.toggle('hidden', !visible);
}

async function fetchNextPage() {
    if (AppState.fetching) return;
    if (!AppState.hasMore) return;
    if (!AppState.authenticated) return;

    AppState.fetching = true;
    const filters = {
        unreadOnly: AppState.filters.unreadOnly !== false
    };
    if (AppState.filters.types.length < 3) filters.types = AppState.filters.types;
    if (AppState.filters.residential === 'true') filters.residential = true;
    if (AppState.filters.residential === 'false') filters.residential = false;
    if (AppState.filters.myArea && AppState.profile && AppState.profile.areas) {
        const driveArea = AppState.profile.areas.find(a => a.type === 'drive' && a.bbox);
        if (driveArea) filters.bbox = driveArea.bbox;
    } else {
        if (AppState.filters.stateId) filters.stateId = AppState.filters.stateId;
        if (AppState.filters.managedAreaId) filters.managedAreaId = AppState.filters.managedAreaId;
    }

    try {
        const result = await API.fetchPlaces(AppState.nextPage, filters);
        if (!result.success) {
            if (result.errorCategory === 'unauthorized' ||
                (result.error && result.error.toLowerCase().includes('sess'))) {
                AppState.hasMore = false;
                handleUnauthorized();
            } else {
                showToast(result.error || 'Erro ao carregar places', 'error');
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
        }
    } catch (error) {
        console.error('fetchNextPage error', error);
        showToast('Erro ao carregar places', 'error');
        AppState.hasMore = false;
    } finally {
        AppState.fetching = false;
        updatePendingCount();
    }
}

async function startFetching() {
    showLoading(true);
    document.getElementById('noMoreCards').classList.add('hidden');
    removeCurrentCardEl();
    updatePendingCount();

    while (AppState.queue.length === 0 && AppState.hasMore) {
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
            window.showToast('Erro ao mostrar place, pulando…', 'error');
        }
        AppState.queue.shift();
        AppState.currentPlace = null;
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

    const template = document.getElementById('cardTemplate');
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.place-card');

    card.querySelector('.card-name').textContent = place.name;
    card.querySelector('.card-category').textContent = place.categories && place.categories.length > 0
        ? place.categories.join(', ')
        : 'Sem categoria';
    card.querySelector('.card-address').textContent = place.address || 'Endereço não disponível';
    card.querySelector('.card-type').textContent = place.updateType || 'Tipo desconhecido';
    card.querySelector('.card-creator').textContent = place.createdBy || 'Desconhecido';

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
        ageEl.title = new Date(place.dateAdded).toLocaleString('pt-BR');
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

    if (urls.length > 0) {
        const newImageIdx = place.updateRequestID
            ? urls.findIndex(u => u.indexOf(place.updateRequestID) !== -1)
            : -1;
        let currentImgIdx = newImageIdx >= 0 ? newImageIdx : 0;

        const updateImage = () => {
            img.src = urls[currentImgIdx];
            imgCount.textContent = `${currentImgIdx + 1} / ${urls.length}`;
            const isNew = currentImgIdx === newImageIdx;
            newBadge.classList.toggle('hidden', !isNew);
            newBorder.classList.toggle('hidden', !isNew);
        };
        img.classList.remove('hidden');
        img.classList.add('cursor-zoom-in');
        noImg.classList.add('hidden');
        updateImage();

        img.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            openLightbox(urls, currentImgIdx, newImageIdx);
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
    } else {
        img.classList.add('hidden');
        noImg.classList.remove('hidden');
    }

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

    const changesBox = card.querySelector('.card-changes');
    const changesList = card.querySelector('.card-changes-list');
    if (place.changes && place.changes.length > 0) {
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
            html += `<div class="text-xs text-slate-500 italic pt-1">+ ${hiddenCount} outra(s) mudança(s)</div>`;
        }
        changesList.innerHTML = html;
        changesBox.classList.remove('hidden');
    }

    removeCurrentCardEl();
    document.getElementById('cardStack').appendChild(card);
    document.getElementById('noMoreCards').classList.add('hidden');
}

function showNoPlaces() {
    AppState.currentPlace = null;
    removeCurrentCardEl();
    showLoading(false);
    document.getElementById('noMoreCards').classList.remove('hidden');
}

function formatRelativeTime(ts) {
    if (!ts || typeof ts !== 'number' || ts <= 0) return null;
    const diff = Date.now() - ts;
    if (diff < 0) return 'agora';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'agora';
    const min = Math.floor(sec / 60);
    if (min < 60) return `há ${min}min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `há ${hr}h`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `há ${days}d`;
    const months = Math.floor(days / 30);
    if (months < 12) return `há ${months}m`;
    const years = Math.floor(days / 365);
    return `há ${years}a`;
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

function handleActionResult(actionType, place, result) {
    if (!result) return;
    if (result.success) return;

    const cat = result.errorCategory || 'unknown';

    if (cat === 'already_processed' || cat === 'not_found') {
        showToast('Já tratado por outro editor 👍', 'info');
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
    const verb = actionType === 'read' ? 'marcar como lido' : 'rejeitar place';
    showToast((result.error || `Erro ao ${verb}`) + ' (não contabilizado)', 'error');
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
    AppState.stats.skipped++;
    updateStats();
    saveStats();
    advanceQueue();
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
        undo: () => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                if (type === 'read') AppState.stats.read = Math.max(0, AppState.stats.read - 1);
                if (type === 'reject') AppState.stats.rejected = Math.max(0, AppState.stats.rejected - 1);
                AppState.serverTotal++;
                updateStats();
                saveStats();
                AppState.queue.unshift(place);
                updatePendingCount();
                showCurrentPlace();
            }
        }
    };

    showUndoBanner(type === 'reject' ? 'Place rejeitado' : 'Marcado como lido');
}

function showUndoBanner(message) {
    removeUndoBanner();
    const container = document.getElementById('undoContainer');
    const banner = document.createElement('div');
    banner.className = 'undo-banner';
    banner.innerHTML = `
        <span>${escapeHtml(message)}</span>
        <button type="button" id="undoBtn">Desfazer</button>
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
        <span>Enviando ${AppState.inFlightActions}…</span>
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
            if (window.showToast) window.showToast('Modo Desenvolvedor desbloqueado 🛠️', 'success');
        } else if (remaining > 0 && remaining <= 3) {
            if (window.showToast) {
                window.showToast(`Faltam ${remaining} para o Modo Desenvolvedor`, 'info');
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
        gateMsg.textContent = '🔒 Disponível depois de você logar e a app carregar seu perfil.';
    } else {
        const remaining = Math.max(0, threshold - current);
        gateMsg.textContent = `🔒 Disponível depois de tratar ${threshold} PURs (você tem ${current} — faltam ${remaining}).`;
    }
    gateMsg.classList.remove('hidden');
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.body.classList.toggle('dark', isDark);
    document.getElementById('themeIconLight').classList.toggle('hidden', isDark);
    document.getElementById('themeIconDark').classList.toggle('hidden', !isDark);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', isDark ? '#0f172a' : '#33CCFF');
}

function toggleTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    const next = isDark ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');

    const colors = {
        success: 'bg-emerald-500',
        error: 'bg-rose-500',
        info: 'bg-cyan-500'
    };

    const icons = {
        success: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
        error: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
        info: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };

    toast.className = `${colors[type]} text-white px-5 py-3 rounded-xl shadow-lg transform transition-all duration-300 translate-x-full flex items-center space-x-3 backdrop-blur-sm border border-white/20 font-medium`;
    toast.innerHTML = `${icons[type]}<span>${escapeHtml(message)}</span>`;

    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });
    setTimeout(() => {
        toast.style.transform = 'translateX(150%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showWorkerWarning() {
    if (document.getElementById('workerWarning')) return;
    const banner = document.createElement('div');
    banner.id = 'workerWarning';
    banner.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 bg-amber-500 text-amber-950 px-4 py-3 rounded-xl shadow-2xl z-50 max-w-sm text-sm flex items-start gap-3';
    banner.innerHTML = `
        <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z"/>
        </svg>
        <div class="flex-1">
            <p class="font-semibold mb-1">Servidor lento detectado</p>
            <p class="text-xs leading-relaxed">A app pode travar entre cliques. Pare o servidor (<strong>Ctrl+C</strong>) e inicie com <code class="bg-amber-200 px-1 rounded font-mono">./start.sh</code> (Linux/macOS) ou <code class="bg-amber-200 px-1 rounded font-mono">start.bat</code> (Windows).</p>
        </div>
        <button type="button" id="workerWarningClose" class="text-amber-950 hover:text-amber-700 flex-shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
    `;
    document.body.appendChild(banner);
    document.getElementById('workerWarningClose').addEventListener('click', () => banner.remove());
}

function onSwipeLeft() { handleReject(); }
function onSwipeRight() { handleMarkAsRead(); }
function onSwipeUp() { handleSkip(); }
window.onSwipeLeft = onSwipeLeft;
window.onSwipeRight = onSwipeRight;
window.onSwipeUp = onSwipeUp;
window.showToast = showToast;
window.showWorkerWarning = showWorkerWarning;
