const STATS_KEY = 'waze_places_stats';
const FILTERS_KEY = 'waze_places_filters';
const THEME_KEY = 'waze_places_theme';
const UNDO_WINDOW_MS = 3000;

const AppState = {
    authenticated: false,
    currentPlace: null,
    places: [],
    currentIndex: 0,
    page: 1,
    hasMore: false,
    stats: { read: 0, rejected: 0, skipped: 0 },
    loading: false,
    pendingAction: null,
    filters: { types: ['VENUE', 'IMAGE', 'REQUEST'], residential: '' }
};

window.AppState = AppState;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    loadStats();
    loadFilters();
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');

    const savedToken = API.getSession();
    API.getRegion();
    API.getCountry();

    if (savedToken) {
        showMainScreen();
        loadPlaces();
    } else {
        showAuthScreen();
    }

    setupAuthListeners();
    setupAppListeners();
    setupModalListeners();

    if (window.initSwipe) window.initSwipe();
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

    const regionSelect = $('regionSelect');
    const countryInput = $('countryInput');
    regionSelect.value = API.getRegion();
    countryInput.value = API.getCountry();
    regionSelect.addEventListener('change', () => API.setRegion(regionSelect.value));
    countryInput.addEventListener('change', () => API.setCountry(countryInput.value));
}

function setupAppListeners() {
    const $ = id => document.getElementById(id);

    $('logoutBtn').addEventListener('click', () => $('logoutModal').classList.remove('hidden'));
    $('confirmLogout').addEventListener('click', handleLogout);
    $('cancelLogout').addEventListener('click', () => $('logoutModal').classList.add('hidden'));

    $('reloadBtn').addEventListener('click', () => {
        AppState.page = 1;
        loadPlaces();
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
}

function openFiltersModal() {
    const $ = id => document.getElementById(id);
    document.querySelectorAll('.filter-type').forEach(cb => {
        cb.checked = AppState.filters.types.includes(cb.value);
    });
    $('filterResidential').value = AppState.filters.residential;
    $('filterCountry').value = API.getCountry();
    $('filterRegion').value = API.getRegion();
    $('filtersModal').classList.remove('hidden');
}

function applyFiltersFromModal() {
    const $ = id => document.getElementById(id);
    AppState.filters.types = Array.from(document.querySelectorAll('.filter-type:checked')).map(cb => cb.value);
    AppState.filters.residential = $('filterResidential').value;
    API.setCountry($('filterCountry').value);
    API.setRegion($('filterRegion').value);
    saveFilters();
    $('filtersModal').classList.add('hidden');
    AppState.page = 1;
    loadPlaces();
}

function handleKeyDown(e) {
    if (!document.querySelector('.place-card') || AppState.loading) return;
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
    AppState.authenticated = false;
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
            await loadPlaces();
            showToast('Autenticado com sucesso!', 'success');
        } else {
            showToast(result.error || 'Cookies inválidos', 'error');
        }
    } catch (error) {
        showToast('Erro ao validar cookies', 'error');
    }
}

async function handleLogout() {
    document.getElementById('logoutModal').classList.add('hidden');
    await API.destroySession();
    AppState.places = [];
    AppState.currentIndex = 0;
    AppState.page = 1;
    AppState.stats = { read: 0, rejected: 0, skipped: 0 };
    saveStats();
    updateStats();
    showAuthScreen();
    showToast('Sessão encerrada', 'info');
}

async function loadPlaces() {
    if (AppState.loading) return;

    AppState.loading = true;
    document.getElementById('loadingCard').classList.remove('hidden');
    document.getElementById('noMoreCards').classList.add('hidden');

    const filters = {};
    if (AppState.filters.types.length < 3) filters.types = AppState.filters.types;
    if (AppState.filters.residential === 'true') filters.residential = true;
    if (AppState.filters.residential === 'false') filters.residential = false;

    try {
        const result = await API.fetchPlaces(AppState.page, filters);

        if (result.success) {
            AppState.places = result.places || [];
            AppState.hasMore = result.hasMore || false;
            AppState.currentIndex = 0;

            if (AppState.places.length > 0) {
                showCurrentPlace();
            } else if (AppState.hasMore) {
                AppState.page++;
                AppState.loading = false;
                return loadPlaces();
            } else {
                showNoPlaces();
            }
        } else {
            if (result.error && result.error.includes('Sessão')) {
                showAuthScreen();
            }
            showToast(result.error || 'Erro ao carregar places', 'error');
            showNoPlaces();
        }
    } catch (error) {
        showToast('Erro ao carregar places', 'error');
        showNoPlaces();
    } finally {
        AppState.loading = false;
        document.getElementById('loadingCard').classList.add('hidden');
    }
}

function showCurrentPlace() {
    const place = AppState.places[AppState.currentIndex];
    if (!place) {
        if (AppState.hasMore) {
            AppState.page++;
            loadPlaces();
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
        wmeLink.href = `https://www.waze.com/editor?env=${envParam}&lat=${place.lat}&lon=${place.lon}&zoomLevel=18&segments=${place.venueID}`;
    } else {
        wmeLink.href = `https://www.waze.com/editor?env=${envParam}`;
    }

    const gallery = card.querySelector('.card-gallery');
    const noImg = card.querySelector('.card-no-image');
    const imgCount = card.querySelector('.card-image-count');
    const urls = place.imageUrls && place.imageUrls.length > 0
        ? place.imageUrls
        : (place.imageUrl ? [place.imageUrl] : []);

    if (urls.length > 0) {
        gallery.innerHTML = urls.map(u => `<img src="${u}" alt="Place" class="w-full h-full">`).join('');
        gallery.classList.remove('hidden');
        noImg.classList.add('hidden');
        if (urls.length > 1) {
            imgCount.textContent = `1/${urls.length}`;
            imgCount.classList.remove('hidden');
            gallery.addEventListener('scroll', () => {
                const idx = Math.round(gallery.scrollLeft / gallery.clientWidth);
                imgCount.textContent = `${idx + 1}/${urls.length}`;
            });
        }
    } else {
        gallery.classList.add('hidden');
        noImg.classList.remove('hidden');
    }

    const changesBox = card.querySelector('.card-changes');
    const changesList = card.querySelector('.card-changes-list');
    if (place.changes && place.changes.length > 0) {
        changesList.innerHTML = place.changes.map(c => `
            <div class="diff-row">
                <span class="text-xs font-semibold text-slate-600">${escapeHtml(c.label)}:</span>
                <span class="diff-from">${escapeHtml(c.from)}</span>
                <span class="diff-to">${escapeHtml(c.to)}</span>
            </div>
        `).join('');
        changesBox.classList.remove('hidden');
    }

    card.querySelector('.reject-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.triggerSwipe) window.triggerSwipe('left', handleReject);
        else handleReject();
    });
    card.querySelector('.approve-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.triggerSwipe) window.triggerSwipe('right', handleMarkAsRead);
        else handleMarkAsRead();
    });
    card.querySelector('.skip-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.triggerSwipe) window.triggerSwipe('up', handleSkip);
        else handleSkip();
    });

    const cardStack = document.getElementById('cardStack');
    const existingCard = cardStack.querySelector('.place-card');
    if (existingCard) existingCard.remove();
    cardStack.appendChild(card);

    document.getElementById('noMoreCards').classList.add('hidden');
}

function showNoPlaces() {
    const cardStack = document.getElementById('cardStack');
    const existingCard = cardStack.querySelector('.place-card');
    if (existingCard) existingCard.remove();
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

function handleMarkAsRead() {
    if (!AppState.currentPlace) return;
    const place = AppState.currentPlace;
    AppState.stats.read++;
    updateStats();
    saveStats();
    nextPlace();
    scheduleAction('read', place, async () => {
        const result = await API.markAsRead(place.venueID, place.updateRequestID);
        if (!result.success) {
            AppState.stats.read = Math.max(0, AppState.stats.read - 1);
            updateStats();
            saveStats();
            showToast(result.error || 'Erro ao marcar como lido', 'error');
        }
    });
}

function handleReject() {
    if (!AppState.currentPlace) return;
    const place = AppState.currentPlace;
    AppState.stats.rejected++;
    updateStats();
    saveStats();
    nextPlace();
    scheduleAction('reject', place, async () => {
        const result = await API.rejectPlace(place.venueID, place.updateRequestID);
        if (!result.success) {
            AppState.stats.rejected = Math.max(0, AppState.stats.rejected - 1);
            updateStats();
            saveStats();
            showToast(result.error || 'Erro ao rejeitar place', 'error');
        }
    });
}

function handleSkip() {
    if (!AppState.currentPlace) return;
    AppState.stats.skipped++;
    updateStats();
    saveStats();
    nextPlace();
}

function scheduleAction(type, place, executor) {
    if (AppState.pendingAction) {
        AppState.pendingAction.execute();
        AppState.pendingAction = null;
        removeUndoBanner();
    }

    let executed = false;
    const timerId = setTimeout(() => {
        if (!executed) {
            executed = true;
            executor();
            AppState.pendingAction = null;
            removeUndoBanner();
        }
    }, UNDO_WINDOW_MS);

    AppState.pendingAction = {
        type,
        place,
        execute: () => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                executor();
            }
        },
        undo: () => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                if (type === 'read') AppState.stats.read = Math.max(0, AppState.stats.read - 1);
                if (type === 'reject') AppState.stats.rejected = Math.max(0, AppState.stats.rejected - 1);
                updateStats();
                saveStats();
                AppState.places.splice(AppState.currentIndex, 0, place);
                AppState.currentPlace = place;
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
        <span>${message}</span>
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
    container.innerHTML = '';
}

function nextPlace() {
    AppState.currentIndex++;
    if (AppState.currentIndex < AppState.places.length) {
        showCurrentPlace();
    } else if (AppState.hasMore) {
        AppState.page++;
        loadPlaces();
    } else {
        showNoPlaces();
    }
}

function updateStats() {
    document.getElementById('readCount').textContent = AppState.stats.read;
    document.getElementById('rejectedCount').textContent = AppState.stats.rejected;
    document.getElementById('skippedCount').textContent = AppState.stats.skipped;
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

function onSwipeLeft() { handleReject(); }
function onSwipeRight() { handleMarkAsRead(); }
function onSwipeUp() { handleSkip(); }
window.onSwipeLeft = onSwipeLeft;
window.onSwipeRight = onSwipeRight;
window.onSwipeUp = onSwipeUp;
