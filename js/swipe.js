let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;
let isDragging = false;
let currentCard = null;
let dragHandlers = null;
// Amostras recentes do drag pra calcular velocidade no soltar (flick).
let moveSamples = [];
// Trava reentrância durante a animação de saída (~350ms): sem isso, uma segunda
// seta/gesto agia no PRÓXIMO card (currentPlace já tinha avançado) — ação
// destrutiva no card errado.
let animating = false;

// Velocidade mínima (px/ms) pra comitar um flick mesmo abaixo do
// threshold de distância. ~0.6px/ms ≈ 600px/s, na faixa que M3 usa
// pra distinguir fling de drag.
const FLICK_VELOCITY = 0.6;
const FLICK_MIN_DISTANCE = 40;

function enableSwipeOnCard(card) {
    card.addEventListener('mousedown', handleDragStart);
    card.addEventListener('touchstart', handleDragStart, { passive: false });
}

function handleDragStart(e) {
    if (animating) return; // não inicia drag durante a animação de saída
    // Janela do "Desfazer" correndo: o pedido ainda não foi pro Waze e dá pra
    // voltar atrás. Deixar arrastar despacharia o anterior sem aviso. Os botões
    // ficam visivelmente desabilitados no mesmo período, então o card parado é
    // coerente com o resto da tela — não é travamento sem explicação.
    if (window.acoesTravadas && window.acoesTravadas()) return;
    // Controles interativos e áreas de scroll interno não iniciam drag —
    // sem a exceção das listas, o touch-action:none do card mataria o
    // scroll de "Mudanças propostas" e do reporte no mobile.
    if (e.target.closest('button, a, input, select, textarea, .card-changes-list, .card-flag-comment-text')) return;

    isDragging = true;
    currentCard = e.currentTarget;
    // Se o card ainda está entrando (mola de 280ms), a animação venceria o
    // transform inline do arraste e travaria o card no lugar. Tira a classe
    // e o dedo assume na hora.
    currentCard.classList.remove('card-enter');

    if (e.type === 'mousedown') {
        startX = e.clientX;
        startY = e.clientY;
    } else {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }
    currentX = startX;
    currentY = startY;
    moveSamples = [{ x: startX, y: startY, t: performance.now() }];

    currentCard.style.transition = 'none';

    dragHandlers = {
        move: handleDragMove,
        end: handleDragEnd,
        cancel: handleDragCancel
    };
    document.addEventListener('mousemove', dragHandlers.move);
    document.addEventListener('mouseup', dragHandlers.end);
    document.addEventListener('touchmove', dragHandlers.move, { passive: false });
    document.addEventListener('touchend', dragHandlers.end);
    document.addEventListener('touchcancel', dragHandlers.cancel);
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

    const now = performance.now();
    moveSamples.push({ x: currentX, y: currentY, t: now });
    // Só interessam os últimos ~120ms pra velocidade instantânea
    while (moveSamples.length > 2 && now - moveSamples[0].t > 120) {
        moveSamples.shift();
    }

    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    const dominantVertical = Math.abs(deltaY) > Math.abs(deltaX) && deltaY < -30;

    if (dominantVertical) {
        currentCard.style.transform = `translate(0, ${deltaY}px) scale(${Math.max(0.85, 1 + deltaY / 1000)})`;
        // Antes: updateSwipeIndicator(0, 0) — arrastar pra cima era o ÚNICO gesto
        // sem retorno visual. Agora o selo "Pular" acende igual aos outros dois.
        updateSwipeIndicator(0, 0, Math.min(Math.abs(deltaY) / 100, 1));
    } else {
        const rotation = deltaX * 0.1;
        currentCard.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotation}deg)`;
        const opacity = Math.min(Math.abs(deltaX) / 100, 1);
        updateSwipeIndicator(deltaX, opacity);
    }
}

function dragVelocity() {
    if (moveSamples.length < 2) return { vx: 0, vy: 0 };
    const first = moveSamples[0];
    const last = moveSamples[moveSamples.length - 1];
    const dt = Math.max(1, last.t - first.t);
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

// O browser tirou o gesto da gente (rolagem nativa numa área `pan-y`, chamada
// do sistema, gesto de voltar). Desfaz o arraste sem cometer ação: quem estava
// rolando o texto não queria pular o card.
function handleDragCancel() {
    if (!isDragging || !currentCard) return;
    isDragging = false;
    if (dragHandlers) {
        document.removeEventListener('mousemove', dragHandlers.move);
        document.removeEventListener('mouseup', dragHandlers.end);
        document.removeEventListener('touchmove', dragHandlers.move);
        document.removeEventListener('touchend', dragHandlers.end);
        document.removeEventListener('touchcancel', dragHandlers.cancel);
        dragHandlers = null;
    }
    currentCard.classList.remove('dragging');
    updateSwipeIndicator(0, 0, 0);
    currentCard.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    currentCard.style.transform = 'translate(0, 0) rotate(0deg)';
    const cardRef = currentCard;
    setTimeout(() => { if (cardRef) cardRef.style.transition = ''; }, 400);
    currentCard = null;
}

function handleDragEnd(e) {
    if (!isDragging || !currentCard) return;
    isDragging = false;

    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    const thresholdX = window.innerWidth * 0.25;
    const thresholdY = 120;
    const { vx, vy } = dragVelocity();

    if (dragHandlers) {
        document.removeEventListener('mousemove', dragHandlers.move);
        document.removeEventListener('mouseup', dragHandlers.end);
        document.removeEventListener('touchmove', dragHandlers.move);
        document.removeEventListener('touchend', dragHandlers.end);
        document.removeEventListener('touchcancel', dragHandlers.cancel);
        dragHandlers = null;
    }

    // Commit por distância OU por flick (velocidade alta com deslocamento mínimo)
    const commitUp = (Math.abs(deltaY) > thresholdY && deltaY < 0 && Math.abs(deltaY) > Math.abs(deltaX)) ||
        (vy < -FLICK_VELOCITY && deltaY < -FLICK_MIN_DISTANCE && Math.abs(deltaY) > Math.abs(deltaX));
    const commitX = Math.abs(deltaX) > thresholdX ||
        (Math.abs(vx) > FLICK_VELOCITY && Math.abs(deltaX) > FLICK_MIN_DISTANCE && Math.abs(deltaX) > Math.abs(deltaY));

    if (commitUp) {
        animateSwipeOut('up', () => {
            if (typeof onSwipeUp === 'function') onSwipeUp();
        });
    } else if (commitX) {
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
    animating = true;

    // Feedback tátil no commit (Android; iOS ignora silenciosamente)
    if (navigator.vibrate) navigator.vibrate(12);

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
        animating = false;
        updateSwipeIndicator(0, 0);
        if (callback) callback();
    }, 350);
}

// Acende o indicador do gesto em curso. `upOpacity` é opcional: as chamadas
// antigas `updateSwipeIndicator(0, 0)` continuam apagando os três.
// Além da opacidade do gradiente, empurra a escala do selo pela custom property
// --p (0.6 → 1.0): o carimbo cresce conforme você se compromete com o gesto.
function updateSwipeIndicator(deltaX, opacity, upOpacity = 0) {
    if (!currentCard) return;
    const setOne = (seletor, valor) => {
        const el = currentCard.querySelector(seletor);
        if (!el) return;
        el.style.opacity = valor;
        const stamp = el.querySelector('.swipe-stamp');
        if (stamp) stamp.style.setProperty('--p', 0.6 + 0.4 * valor);
    };
    setOne('.swipe-left', deltaX < 0 ? opacity : 0);
    setOne('.swipe-right', deltaX > 0 ? opacity : 0);
    setOne('.swipe-up', upOpacity);
}

function triggerSwipe(direction, callback) {
    if (animating) return; // ignora enquanto uma animação de saída está em curso
    if (window.acoesTravadas && window.acoesTravadas()) return;
    const card = document.querySelector('.place-card');
    if (!card) {
        if (callback) callback();
        return;
    }
    currentCard = card;
    // Botão e teclado não arrastam, então nunca acendiam o selo — o mesmo gesto
    // dava retornos diferentes conforme o caminho. Acende no talo antes de sair,
    // e o card já está saindo: nada é adicionado ao tempo do editor.
    const porGesto = { left: [-1, 1, 0], right: [1, 1, 0], up: [0, 0, 1] }[direction];
    if (porGesto) updateSwipeIndicator(porGesto[0], porGesto[1], porGesto[2]);
    animateSwipeOut(direction, callback);
}

window.enableSwipeOnCard = enableSwipeOnCard;
window.triggerSwipe = triggerSwipe;
window.isSwipeAnimating = () => animating;
