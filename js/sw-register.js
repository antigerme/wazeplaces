// Registro e auto-atualização do service worker. Era um <script> inline; saiu
// daqui pelo mesmo motivo do js/tema.js — CSP sem 'unsafe-inline' em script-src.
// De quebra, agora a auditoria de i18n enxerga este arquivo: foi aqui que o
// aviso de nova versão ficou hardcoded em português sem ninguém ver.
    if ('serviceWorker' in navigator) {
        let refreshing = false;
        const hadController = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            if (!hadController) return;
            refreshing = true;
            window.location.reload();
        });

        const activateWaitingWorker = (worker) => {
            if (!worker) return;
            if (window.showToast) {
                // Pelo dicionário: `toast.newVersion` já existia nas três línguas
                // e ninguém usava — este literal falava português com todo mundo.
                // Este <script> é inline, então a auditoria de i18n não o varre;
                // por isso passou batido. O fallback cobre o caso de o i18n.js
                // não ter carregado (o toast é melhor que silêncio).
                window.showToast(
                    window.t ? window.t('toast.newVersion') : 'Nova versão disponível. Atualizando…',
                    'info');
            }
            worker.postMessage({ type: 'SKIP_WAITING' });
        };

        window.addEventListener('load', () => {
            // updateViaCache:'none' — força browser a sempre revalidar service-worker.js
            // contra a rede, ignorando HTTP cache. Defesa contra CDN/proxy cacheando o SW.
            navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
                .then(reg => {
                    // Cobre o caso de SW novo já estar em "waiting" desde uma sessão anterior
                    // (instalou mas nunca ativou). Sem isso, updatefound não dispara de novo
                    // e o user fica preso na versão velha até reload manual.
                    if (reg.waiting && navigator.serviceWorker.controller) {
                        activateWaitingWorker(reg.waiting);
                    }
                    // Check imediato por nova versão (sem esperar o intervalo de 1h)
                    reg.update().catch(() => {});

                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        if (!newWorker) return;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                activateWaitingWorker(newWorker);
                            }
                        });
                    });
                    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
                })
                .catch(err => console.log('Erro ao registrar Service Worker:', err));
        });
    }

    const cardObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.classList && node.classList.contains('place-card')) {
                    if (window.enableSwipeOnCard) window.enableSwipeOnCard(node);
                }
            });
        });
    });

    cardObserver.observe(document.getElementById('cardStack'), {
        childList: true,
        subtree: true
    });
