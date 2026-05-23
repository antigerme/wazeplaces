let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;
let isDragging = false;
let currentCard = null;
let dragHandlers = null;

function initSwipe() {}

function enableSwipeOnCard(card) {
    card.addEventListener('mousedown', handleDragStart);
    card.addEventListener('touchstart', handleDragStart, { passive: false });
}

function handleDragStart(e) {
    if (window.AppState && window.AppState.loading) return;
    if (e.target.closest('button, a, input, select, textarea')) return;

    isDragging = true;
    currentCard = e.currentTarget;

    if (e.type === 'mousedown') {
        startX = e.clientX;
        startY = e.clientY;
    } else {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }
    currentX = startX;
    currentY = startY;

    currentCard.style.transition = 'none';

    dragHandlers = {
        move: handleDragMove,
        end: handleDragEnd
    };
    document.addEventListener('mousemove', dragHandlers.move);
    document.addEventListener('mouseup', dragHandlers.end);
    document.addEventListener('touchmove', dragHandlers.move, { passive: false });
    document.addEventListener('touchend', dragHandlers.end);
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
    const dominantVertical = Math.abs(deltaY) > Math.abs(deltaX) && deltaY < -30;

    if (dominantVertical) {
        currentCard.style.transform = `translate(0, ${deltaY}px) scale(${Math.max(0.85, 1 + deltaY / 1000)})`;
        updateSwipeIndicator(0, 0);
    } else {
        const rotation = deltaX * 0.1;
        currentCard.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotation}deg)`;
        const opacity = Math.min(Math.abs(deltaX) / 100, 1);
        updateSwipeIndicator(deltaX, opacity);
    }
}

function handleDragEnd(e) {
    if (!isDragging || !currentCard) return;
    isDragging = false;

    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    const thresholdX = window.innerWidth * 0.25;
    const thresholdY = 120;

    if (dragHandlers) {
        document.removeEventListener('mousemove', dragHandlers.move);
        document.removeEventListener('mouseup', dragHandlers.end);
        document.removeEventListener('touchmove', dragHandlers.move);
        document.removeEventListener('touchend', dragHandlers.end);
        dragHandlers = null;
    }

    if (Math.abs(deltaY) > thresholdY && deltaY < 0 && Math.abs(deltaY) > Math.abs(deltaX)) {
        animateSwipeOut('up', () => {
            if (typeof onSwipeUp === 'function') onSwipeUp();
        });
    } else if (Math.abs(deltaX) > thresholdX) {
        const dir = deltaX > 0 ? 'right' : 'left';
        animateSwipeOut(dir, () => {
            if (dir === 'right' && typeof onSwipeRight === 'function') onSwipeRight();
            if (dir === 'left' && typeof onSwipeLeft === 'function') onSwipeLeft();
        });
    } else {
        currentCard.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        currentCard.style.transform = 'translate(0, 0) rotate(0deg)';
        updateSwipeIndicator(0, 0);
        const cardRef = currentCard;
        setTimeout(() => {
            if (cardRef) cardRef.style.transition = '';
        }, 400);
        currentCard = null;
    }
}

function animateSwipeOut(direction, callback) {
    if (!currentCard) {
        if (callback) callback();
        return;
    }

    const card = currentCard;
    currentCard = null;

    if (direction === 'up') {
        card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        card.style.transform = 'translateY(-150%) scale(0.8)';
        card.style.opacity = '0';
    } else {
        const distance = window.innerWidth * 1.5;
        const translateX = direction === 'right' ? distance : -distance;
        card.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.35s';
        card.style.transform = `translateX(${translateX}px) rotate(${direction === 'right' ? 30 : -30}deg)`;
        card.style.opacity = '0';
    }

    setTimeout(() => {
        updateSwipeIndicator(0, 0);
        if (callback) callback();
    }, 350);
}

function updateSwipeIndicator(deltaX, opacity) {
    if (!currentCard) return;
    const leftIndicator = currentCard.querySelector('.swipe-left');
    const rightIndicator = currentCard.querySelector('.swipe-right');
    if (!leftIndicator || !rightIndicator) return;

    if (deltaX < 0) {
        leftIndicator.style.opacity = opacity;
        rightIndicator.style.opacity = 0;
    } else if (deltaX > 0) {
        rightIndicator.style.opacity = opacity;
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
    animateSwipeOut(direction, callback);
}

window.enableSwipeOnCard = enableSwipeOnCard;
window.triggerSwipe = triggerSwipe;
window.initSwipe = initSwipe;
