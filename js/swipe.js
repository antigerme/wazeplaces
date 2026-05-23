// Gerenciamento de gestos de arrastar (swipe)
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;
let isDragging = false;
let currentCard = null;

function initSwipe() {
    // Event listeners serão adicionados dinamicamente aos cards
}

function enableSwipeOnCard(card) {
    // Mouse events
    card.addEventListener('mousedown', handleDragStart);
    
    // Touch events
    card.addEventListener('touchstart', handleDragStart, { passive: false });
}

function handleDragStart(e) {
    if (AppState.loading) return;
    
    // Ignora arraste se o usuário clicar num botão (evita conflito)
    if (e.target.closest('button')) return;
    
    isDragging = true;
    currentCard = e.currentTarget;
    
    if (e.type === 'mousedown') {
        startX = e.clientX;
        startY = e.clientY;
        currentX = e.clientX;
        currentY = e.clientY;
    } else {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        currentX = e.touches[0].clientX;
        currentY = e.touches[0].clientY;
    }
    
    currentCard.style.transition = 'none';
    
    // Adiciona listeners globais
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);
}

function handleDragMove(e) {
    if (!isDragging || !currentCard) return;
    
    e.preventDefault();
    
    if (e.type === 'mousemove') {
        currentX = e.clientX;
        currentY = e.clientY;
    } else {
        currentX = e.touches[0].clientX;
        currentY = e.touches[0].clientY;
    }
    
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    
    const rotation = deltaX * 0.1; // Rotação sutil
    
    currentCard.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotation}deg)`;
    
    // Mostra indicador visual
    const opacity = Math.min(Math.abs(deltaX) / 100, 1);
    updateSwipeIndicator(deltaX, opacity);
}

function handleDragEnd(e) {
    if (!isDragging || !currentCard) return;
    
    isDragging = false;
    
    const deltaX = currentX - startX;
    const threshold = window.innerWidth * 0.25; // 25% da tela para considerar swipe
    const velocity = Math.abs(deltaX) / 300; // velocidade aproximada
    
    // Adiciona classes para evitar interações
    currentCard.classList.remove('active:cursor-grabbing');
    
    // Remove listeners globais
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchmove', handleDragMove);
    document.removeEventListener('touchend', handleDragEnd);
    
    if (Math.abs(deltaX) > threshold || velocity > 0.5) {
        // Swipe completo
        if (deltaX > 0) {
            // Swipe direita - Marcar como lido
            animateSwipeOut('right', () => {
                if (typeof onSwipeRight === 'function') {
                    onSwipeRight();
                }
            });
        } else {
            // Swipe esquerda - Rejeitar
            animateSwipeOut('left', () => {
                if (typeof onSwipeLeft === 'function') {
                    onSwipeLeft();
                }
            });
        }
    } else {
        // Efeito mola para voltar ao centro
        currentCard.style.transition = 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        currentCard.style.transform = 'translate(0px, 0px) rotate(0deg)';
        updateSwipeIndicator(0, 0);
        
        setTimeout(() => {
            if (currentCard) {
                currentCard.classList.add('active:cursor-grabbing');
                currentCard = null;
            }
        }, 500);
    }
}

function animateSwipeOut(direction, callback) {
    if (!currentCard) return;
    
    const distance = window.innerWidth * 1.5;
    const translateX = direction === 'right' ? distance : -distance;
    
    currentCard.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    currentCard.style.transform = `translateX(${translateX}px) rotate(${direction === 'right' ? 30 : -30}deg)`;
    
    setTimeout(() => {
        if (currentCard) {
            currentCard.style.transition = 'none';
            currentCard.style.transform = '';
            updateSwipeIndicator(0, 0);
        }
        
        if (callback) callback();
        
        currentCard = null;
    }, 400);
}

function updateSwipeIndicator(deltaX, opacity) {
    if (!currentCard) return;
    
    const leftIndicator = currentCard.querySelector('.swipe-left');
    const rightIndicator = currentCard.querySelector('.swipe-right');
    
    if (deltaX < 0) {
        // Swipe esquerda - Rejeitar
        leftIndicator.style.opacity = opacity;
        leftIndicator.style.backgroundColor = `rgba(239, 68, 68, ${opacity * 0.3})`;
        rightIndicator.style.opacity = 0;
    } else if (deltaX > 0) {
        // Swipe direita - Marcar como lido
        rightIndicator.style.opacity = opacity;
        rightIndicator.style.backgroundColor = `rgba(34, 197, 94, ${opacity * 0.3})`;
        leftIndicator.style.opacity = 0;
    } else {
        leftIndicator.style.opacity = 0;
        rightIndicator.style.opacity = 0;
    }
}

function triggerSwipe(direction, callback) {
    const card = document.querySelector('.place-card');
    if (!card) {
        if (callback) callback();
        return;
    }
    
    currentCard = card;
    const distance = window.innerWidth * 1.5;
    const translateX = direction === 'right' ? distance : -distance;
    
    card.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    card.style.transform = `translateX(${translateX}px) rotate(${direction === 'right' ? 30 : -30}deg)`;
    
    setTimeout(() => {
        if (currentCard) {
            currentCard.style.transition = 'none';
            currentCard.style.transform = '';
            currentCard = null;
        }
        if (callback) callback();
    }, 400);
}

// Exporta função para habilitar swipe em novos cards
window.enableSwipeOnCard = enableSwipeOnCard;
window.triggerSwipe = triggerSwipe;