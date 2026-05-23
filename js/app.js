// Estado da aplicação
const AppState = {
    authenticated: false,
    currentPlace: null,
    places: [],
    currentIndex: 0,
    stats: {
        read: 0,
        rejected: 0,
        total: 0
    },
    loading: false
};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    // Verifica se já está autenticado
    const savedCookies = sessionStorage.getItem('waze_cookies');
    if (savedCookies) {
        API.setCookies(savedCookies);
        showMainScreen();
        loadPlaces();
    } else {
        showAuthScreen();
    }

    // Event listeners
    setupAuthListeners();
    setupAppListeners();
    
    // Inicializa swipe
    initSwipe();
}

function setupAuthListeners() {
    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    
    document.getElementById('pasteBtn').addEventListener('click', () => {
        document.getElementById('pasteModal').classList.remove('hidden');
    });
    
    document.getElementById('confirmPaste').addEventListener('click', handlePasteConfirm);
    document.getElementById('cancelPaste').addEventListener('click', () => {
        document.getElementById('pasteModal').classList.add('hidden');
        document.getElementById('cookiesTextarea').value = '';
    });
    
    document.getElementById('howToGetCookies').addEventListener('click', () => {
        window.open('COOKIES-GUIDE.md', '_blank');
    });

    document.getElementById('byAuthor').addEventListener('click', () => {
        window.open('https://www.waze.com/user/editor/antigerme', '_blank');
    });
}

function setupAppListeners() {
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('reloadBtn').addEventListener('click', loadPlaces);
    document.getElementById('helpBtn').addEventListener('click', () => {
        document.getElementById('helpModal').classList.remove('hidden');
    });
    document.getElementById('closeHelp').addEventListener('click', () => {
        document.getElementById('helpModal').classList.add('hidden');
    });

    window.addEventListener('keydown', handleKeyDown);
}

function handleKeyDown(e) {
    // Se não tiver um card na tela ou estiver carregando, ignora
    const card = document.querySelector('.place-card');
    if (!card || AppState.loading) return;

    if (e.key === 'ArrowLeft' || e.code === 'ArrowLeft' || e.keyCode === 37) {
        e.preventDefault();
        if (window.triggerSwipe) {
            window.triggerSwipe('left', handleReject);
        } else {
            handleReject();
        }
    } else if (e.key === 'ArrowRight' || e.code === 'ArrowRight' || e.keyCode === 39) {
        e.preventDefault();
        if (window.triggerSwipe) {
            window.triggerSwipe('right', handleMarkAsRead);
        } else {
            handleMarkAsRead();
        }
    }
}

function showAuthScreen() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');
    AppState.authenticated = false;
}

function showMainScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
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
            API.setCookies(cookies);
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

function handleLogout() {
    if (confirm('Tem certeza que deseja sair? Seus cookies serão removidos.')) {
        sessionStorage.removeItem('waze_cookies');
        API.setCookies(null);
        AppState.places = [];
        AppState.currentIndex = 0;
        AppState.stats = { read: 0, rejected: 0, total: 0 };
        showAuthScreen();
        showToast('Sessão encerrada', 'info');
    }
}

async function loadPlaces() {
    if (AppState.loading) return;
    
    AppState.loading = true;
    document.getElementById('loadingCard').classList.remove('hidden');
    document.getElementById('noMoreCards').classList.add('hidden');
    
    try {
        const result = await API.fetchPlaces();
        
        if (result.success) {
            AppState.places = result.places;
            AppState.stats.total = result.total;
            AppState.currentIndex = 0;
            
            if (AppState.places.length > 0) {
                showCurrentPlace();
                updateStats();
            } else {
                showNoPlaces();
            }
        } else {
            showToast(result.error || 'Erro ao carregar places', 'error');
        }
    } catch (error) {
        showToast('Erro ao carregar places', 'error');
    } finally {
        AppState.loading = false;
        document.getElementById('loadingCard').classList.add('hidden');
    }
}

function showCurrentPlace() {
    const place = AppState.places[AppState.currentIndex];
    if (!place) {
        showNoPlaces();
        return;
    }
    
    AppState.currentPlace = place;
    
    const template = document.getElementById('cardTemplate');
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.place-card');
    
    // Preenche dados
    card.querySelector('.card-name').textContent = place.name;
    card.querySelector('.card-category').textContent = place.categories && place.categories.length > 0 
        ? place.categories.join(', ') 
        : 'Sem categoria';
    card.querySelector('.card-address').textContent = place.address || 'Endereço não disponível';
    card.querySelector('.card-type').textContent = place.updateType || 'Tipo desconhecido';
    card.querySelector('.card-creator').textContent = place.createdBy || 'Desconhecido';
    
    // Imagem
    const img = card.querySelector('.card-image');
    const noImg = card.querySelector('.card-no-image');
    if (place.imageUrl) {
        img.src = place.imageUrl;
        img.classList.remove('hidden');
        noImg.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        noImg.classList.remove('hidden');
    }
    
    // Event listeners dos botões
    card.querySelector('.reject-btn').addEventListener('click', () => {
        if (window.triggerSwipe) window.triggerSwipe('left', handleReject);
        else handleReject();
    });
    card.querySelector('.approve-btn').addEventListener('click', () => {
        if (window.triggerSwipe) window.triggerSwipe('right', handleMarkAsRead);
        else handleMarkAsRead();
    });
    
    // Limpa container e adiciona novo card
    const cardStack = document.getElementById('cardStack');
    const existingCard = cardStack.querySelector('.place-card');
    if (existingCard) {
        existingCard.remove();
    }
    cardStack.appendChild(card);
    
    document.getElementById('noMoreCards').classList.add('hidden');
}

function showNoPlaces() {
    const cardStack = document.getElementById('cardStack');
    const existingCard = cardStack.querySelector('.place-card');
    if (existingCard) {
        existingCard.remove();
    }
    document.getElementById('noMoreCards').classList.remove('hidden');
}

async function handleMarkAsRead() {
    if (!AppState.currentPlace || AppState.loading) return;
    
    AppState.loading = true;
    const place = AppState.currentPlace;
    
    try {
        const result = await API.markAsRead(place.venueID, place.updateRequestID);
        
        if (result.success) {
            AppState.stats.read++;
            updateStats();
            showToast('✅ Place marcado como lido!', 'success');
            nextPlace();
        } else {
            showToast(result.error || 'Erro ao marcar como lido', 'error');
        }
    } catch (error) {
        showToast('Erro ao marcar como lido', 'error');
    } finally {
        AppState.loading = false;
    }
}

async function handleReject() {
    if (!AppState.currentPlace || AppState.loading) return;
    
    AppState.loading = true;
    const place = AppState.currentPlace;
    
    try {
        const result = await API.validatePlace(place.venueID, place.updateRequestID, false);
        
        if (result.success) {
            AppState.stats.rejected++;
            updateStats();
            showToast('❌ Place rejeitado!', 'success');
            nextPlace();
        } else {
            showToast(result.error || 'Erro ao rejeitar place', 'error');
        }
    } catch (error) {
        showToast('Erro ao rejeitar place', 'error');
    } finally {
        AppState.loading = false;
    }
}

function nextPlace() {
    AppState.currentIndex++;
    
    if (AppState.currentIndex < AppState.places.length) {
        showCurrentPlace();
    } else {
        showNoPlaces();
    }
}

function updateStats() {
    document.getElementById('approvedCount').textContent = AppState.stats.read;
    document.getElementById('rejectedCount').textContent = AppState.stats.rejected;
    document.getElementById('totalCount').textContent = AppState.stats.total;
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
    toast.innerHTML = `
        ${icons[type]}
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Anima entrada
    requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
    });
    
    setTimeout(() => {
        toast.style.transform = 'translateX(150%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Funções chamadas pelo swipe.js
function onSwipeLeft() {
    handleReject();
}

function onSwipeRight() {
    handleMarkAsRead();
}
