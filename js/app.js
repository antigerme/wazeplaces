const APP_VERSION = '2.9.1';
const TRANSIENT_RETRY_ATTEMPTS = 2;
const TRANSIENT_RETRY_DELAYS_MS = [1500, 3500];
const STATS_KEY = 'waze_places_stats';
const FILTERS_KEY = 'waze_places_filters';
const THEME_KEY = 'waze_places_theme';
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
    filters: { types: ['VENUE', 'IMAGE', 'REQUEST'], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true },
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
    if (versionEl) versionEl.textContent = 'v' + APP_VERSION;

    loadStats();
    loadFilters();
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

    $('logoutBtn').addEventListener('click', () => $('logoutModal').classList.remove('hidden'));
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
    AppState.filters.unreadOnly = $('filterUnreadOnly').checked;
    AppState.filters.types = Array.from(document.querySelectorAll('.filter-type:checked')).map(cb => cb.value);
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
    if (profileRes.success) {
        AppState.profile = profileRes.profile;
        renderProfileHeader();
    }
    if (countriesRes.success) {
        AppState.countries = countriesRes.countries;
    }
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

async function handleLogout() {
    document.getElementById('logoutModal').classList.add('hidden');
    await API.destroySession();
    resetQueue();
    AppState.stats = { read: 0, rejected: 0, skipped: 0 };
    AppState.pendingAction = null;
    AppState.inFlightActions = 0;
    removeUndoBanner();
    updateInFlightIndicator();
    saveStats();
    updateStats();
    showAuthScreen();
    removeCurrentCardEl();
    showToast('Sessão encerrada', 'info');
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
            if (result.error && result.error.toLowerCase().includes('sess')) {
                AppState.hasMore = false;
                showAuthScreen();
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

    const wmeLink = card.querySelector('.card-wme-link');
    const region = API.getRegion();
    const envParam = region === 'na' ? 'usa' : region;
    if (place.lat && place.lon) {
        wmeLink.href = `https://www.waze.com/editor?env=${envParam}&lat=${place.lat}&lon=${place.lon}&zoom=18`;
    } else {
        wmeLink.href = `https://www.waze.com/editor?env=${envParam}`;
    }

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
        showToast('Sessão expirou — faça login novamente', 'error');
        API.setSession(null);
        AppState.profile = null;
        setTimeout(() => showAuthScreen(), 800);
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
            AppState.filters.types = parsed.types || ['VENUE', 'IMAGE', 'REQUEST'];
            AppState.filters.residential = parsed.residential || '';
            AppState.filters.stateId = parsed.stateId || '';
            AppState.filters.managedAreaId = parsed.managedAreaId || '';
            AppState.filters.myArea = !!parsed.myArea;
            AppState.filters.unreadOnly = parsed.unreadOnly !== false;
        }
    } catch (e) {}
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
