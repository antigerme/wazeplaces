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
const SESSAO_KEY = 'waze_places_sessao_expira';
// Rank e staff do último perfil que CARREGOU. Não é preferência — é memória do
// que o Waze já respondeu, e existe por um motivo medido: sem ela, abrir a app
// com a conexão ruim faz o `/api/perfil` falhar, o perfil fica nulo, e a cota
// do Desfazer volta a travar. O editor que já tinha conquistado o direito de
// desligar leva a janela de 3s de volta — e a tela ainda diz "disponível
// depois que o app carregar seu perfil", como se fosse culpa dele.
const PERFIL_GATE_KEY = 'waze_places_perfil_gate';
const DEVMODE_TAPS_NEEDED = 7;
const DEVMODE_TAP_TIMEOUT_MS = 3000;
const UNDO_WINDOW_MS = 3000;

// Endereço oficial do Waze Map Editor. SEM segmento de idioma, sempre: o Waze
// pode redirecionar conforme o idioma da conta, e essa escolha é de quem abre,
// não nossa. Cravar `/pt-BR/` mandava todo mundo pro português.
const WME_EDITOR_URL = 'https://www.waze.com/editor';

// Forma DOCUMENTADA da Google Maps URLs API pra panorama. Existe a antiga
// `?layer=c&cbll=`, que é caminho interno e não contrato publicado — esta é a
// que a Google mantém como estável, e o custo de escolher errado aqui é o
// botão levar a um erro do Google na cara do editor.
const STREET_VIEW_URL = 'https://www.google.com/maps/@';

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

// Nível mínimo pra entrar, COMO O EDITOR VÊ (o Waze conta rank de 0; a UI conta
// de 1 — gotcha #15). A verdade mora no `MIN_RANK_WAZE` do `server/core.mjs`,
// que é quem barra de fato; aqui é só o número que a tela de entrada mostra
// ANTES de existir qualquer resposta do servidor pra citar. `test/consistencia`
// reprova se os dois divergirem — divergir aqui é a app prometer um critério e
// aplicar outro, que é pior do que não avisar nada.
//
// Vai por `setI18nVars` e não escrito na frase porque `applyI18n()` chama
// `t(chave)` SEM parâmetro: sem o registro, o número seria digitado à mão em
// quatro línguas e alguém esqueceria uma na próxima mudança (já aconteceu com
// o "3s" da janela de desfazer).
const NIVEL_MINIMO_EXIBIDO = 2;
if (typeof setI18nVars === 'function') {
    setI18nVars({ nivelMinimo: () => NIVEL_MINIMO_EXIBIDO });
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

// ── Aquecimento dos próximos cards ────────────────────────────────────────
// A regra do owner: **o próximo card sempre pronto, e pronto por inteiro** —
// foto, as outras fotos e os tiles do mapa. Isso é a LARGURA, e ela vale só
// pro card seguinte (segundo laço do prefetchNextImage).
//
// PROFUNDIDADE é outra grandeza: quantos cards à frente têm o PRIMEIRO SLIDE
// pronto — a imagem que aparece quando o card entra na tela, antes de tocar
// nas setas do carrossel. Ela é **de graça em total de bytes**: a fila é
// sequencial, esses cards vão aparecer de qualquer jeito, então só se move
// byte no tempo. Medido: sessão de 200 cards fica em ~35MB com profundidade
// 1 ou 3.
//
// O que ela compra é converter TEMPO OCIOSO em reserva. Com profundidade 1 o
// aquecimento só começa quando um card aparece: quem para 10s lendo um diff
// gasta 0,4s baixando o seguinte e deixa o link parado o resto. Triagem real
// é pausa, pausa, três swipes rápidos — a profundidade guarda a pausa. Numa
// rede boa 1 e 3 são indistinguíveis; a diferença aparece em rede sofrível
// com swipe rápido, que é justamente o caso que dói.
//
// O laço é genérico: esta constante é a única coisa a mexer pra mudar de
// ideia, e ela NUNCA afeta a largura.
const PREFETCH_PROFUNDIDADE = 3;
// Teto de fotos por card, escolhido pelo owner. Medido na fila real de 12
// países: 91,7% dos cards têm 4 fotos ou menos e são aquecidos por INTEIRO;
// nos 8,3% restantes as fotos além da 4ª carregam quando a pessoa chegar nelas
// no carrossel — e quem está navegando o carrossel não está passando rápido.
// O teto também segura o rabo: o pior card da fila tem TRINTA fotos, 2,3MB de
// dados móveis sozinho.
const PREFETCH_TETO_FOTOS = 4;

const MAX_EMPTY_PAGES = 5;
// Os 7 tipos do WME, na ordem em que aparecem no filtro (local → foto). É a
// MESMA ordem do index.html de propósito: duas listas com a mesma ideia em
// ordens diferentes é como o editor descobre que a app se contradiz.
const TYPES_ALL = ['NEW_PLACE', 'DETAILS_UPDATE', 'FLAGGED_PLACE', 'DELETE_PLACE',
                   'NEW_PHOTO', 'FLAGGED_PHOTO', 'DELETE_PHOTO'];
// Quais vêm MARCADOS numa instalação nova. `DETAILS_UPDATE` e `FLAGGED_PLACE`
// ficam de fora, e o motivo é de PRODUTO, não de layout: a app é estilo Tinder,
// e o gesto rápido funciona quando há o que OLHAR. Decisão do owner.
//
// Os dois já estiveram desmarcados por um motivo diferente — o card deles não
// cabia na tela — e isso foi corrigido (1872 renders, zero estouro). A troca de
// motivo importa pro próximo que vier aqui: não adianta mexer no layout de novo
// pra tentar remarcá-los, porque não é o layout que os mantém fora.
//
// Medido na fila real, o argumento se sustenta em número: os 5 tipos do padrão
// somam 178 cards com 66% de foto (e `NEW_PHOTO` tem 2,27 fotos por card),
// contra 117 cards e 44% nos dois de fora.
//
// **Desmarcado ≠ escondido**: a caixa continua no filtro, com o nome do WME, a
// um toque. Esconder faria o editor achar que a fila acabou; desmarcar diz
// "existe, e você decide".
//
// A constante fica separada do TYPES_ALL mesmo quando os conjuntos coincidem:
// "todos os tipos que existem" e "os que vêm marcados" são perguntas
// diferentes, e só a primeira decide se vale mandar o filtro ao Waze.
const TYPES_PADRAO = TYPES_ALL.filter((t) => t !== 'DETAILS_UPDATE' && t !== 'FLAGGED_PLACE');
// O filtro salvo pode trazer lixo: storage de uma versão que não existe mais,
// chave editada à mão, JSON meio gravado. Fica só o que a app conhece — e se
// não sobrar NADA, volta ao padrão em vez de virar filtro vazio, que abriria a
// app numa fila sem um card e sem um erro na tela. "Parece que acabou o
// trabalho" é o defeito mais caro possível, porque ninguém reporta.
function sanearTiposSalvos(lista) {
    if (!Array.isArray(lista)) return TYPES_PADRAO.slice();
    const validos = TYPES_ALL.filter((t) => lista.includes(t));
    return validos.length ? validos : TYPES_PADRAO.slice();
}
const UNAUTHORIZED_REDIRECT_MS = 800;
// Espera antes de confirmar se a sessão morreu mesmo. Curto o bastante pra não
// atrasar quem precisa relogar de verdade, e longo o bastante pra a rajada que
// provocou o 403 do WAF já ter passado.
const VERIFICA_SESSAO_MS = 1200;
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
    // Uma página nova chegou enquanto havia card na tela: a ordem dela espera
    // o `advanceQueue`. Ver o comentário no `fetchNextPage`.
    ordemPendente: false,
    filters: { types: TYPES_PADRAO.slice(), residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true, categories: [], sortOrder: 'newest' },
    preferences: { undoEnabled: true, semUndoSeguidas: 0, presenca: true, pularGuarda: false },
    devMode: { unlocked: false, active: false },
    profile: null,
    countries: [],
    statesByCountry: {},
    seenCategories: [],      // categorias vistas nos places carregados (fonte do filtro de categoria)
    history: null,           // acumulado histórico { 'YYYY-MM-DD': { read, rejected } } (carregado lazy)
    autores: null,           // reincidência por autor: { v: [ids vistos 1x], r: { id: [n, nome, dia] } }
    sessaoExpiraEm: null     // quando a sessão do WAZE vence (epoch em segundos). Prazo FIXO, ver AVISO_SESSAO_DIAS
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
        if (cardStack && !cardDaFrente() &&
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
    // Armado ANTES de tudo: erro que acontece na carga é justamente o que não
    // aparece em lugar nenhum depois, e é o que mais interessa num socorro.
    diagCapturarErros();
    // Carimba a IDADE DESTE ARMAZENAMENTO, pelo mesmo motivo da linha acima e
    // com a mesma urgência: tem que acontecer antes de qualquer ramo.
    //
    // Por que AQUI e não junto do `marcarSessaoJaAtiva()`, que é o irmão dele:
    // aquele só roda no ramo `if (savedToken)`, e o `initApp` ainda tem um
    // `return` antes disso (o código de pareamento na URL). O carimbo é sobre o
    // ARMAZENAMENTO, não sobre a sessão — abrir sem token, ou cair no
    // pareamento, é carga igual, e pular a marcação nesses casos daria uma
    // idade menor do que a real, justamente na direção que INVENTA um
    // apagamento que não houve.
    //
    // Ele nasceu sem chamador na v2026.09.18-02 (a #219 trouxe a constante, a
    // função, a leitura no `diagSessao` e a remoção no logout — e nenhuma
    // chamada), então `nascimento` e `idadeDoArmazenamentoH` saíram `null` em
    // TODO diagnóstico desde então. Medido nos bytes de produção, com o diário
    // ao lado gravando normalmente: 3 entradas e 2 ciclos contra carimbo nunca
    // escrito.
    nascimentoDoArmazenamento();
    ligarFabDev();
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

    // Preferências ANTES das stats, e não é arrumação: `loadStats()` chama
    // `updateStats()`, que avalia o portão da conquista. Avaliar o portão sem
    // ter lido as preferências fazia o aviso "Mandou bem" sair a CADA recarga —
    // ele disparava, marcava na memória e a marca era descartada por
    // `savePreferences()` (que corretamente recusa gravar antes de ler).
    loadPreferences();
    loadStats();
    // Com o perfil em CACHE a cota já é conhecida aqui, então a linha de base se
    // decide na hora; sem ele, `guardarPerfilDoPortao` decide quando o perfil
    // chegar. Sem esta chamada existe uma janela — entre abrir e o /api/perfil
    // responder — em que cruzar a cota não seria comemorado.
    initUndoGateSeen();
    loadFilters();
    carregarPrazoDaSessao();
    loadDevMode();
    enforceDevGatedFilters();
    // O que as aberturas anteriores deixaram guardado (só com o modo dev
    // ligado — sem ele a função sai na primeira linha e nem abre a base).
    diagCarregarAberturas();
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
    setupMapaLightbox();
    setupKeyboardInset();
    setupAlturaDoHeader();
    setupDescargaAoSair();
    // DEPOIS do de cima, e a ordem importa: os dois ouvem o ir-pro-fundo, e a
    // ação que estava na janela do Desfazer tem que ir pra fila de saída antes
    // de o diagnóstico ser guardado — senão o diário guardado não a mostra.
    setupGuardaDoDiagnostico();
    marcarSuporteAExtensao();
    setupInstalarApp();

    // Link de pareamento (/#pair=SEGREDO): o editor apontou a câmera ou mandou o
    // link pra si mesmo — entra direto, sem digitar nada. Tratado ANTES da
    // sessão salva porque um código novo deve vencer uma sessão velha do mesmo
    // aparelho.
    //
    // FRAGMENTO, não query. O navegador não envia o fragmento ao servidor, então
    // o segredo não entra no log de acesso — e ele é justamente a chave que
    // decifra o registro de pareamento (ver `derivarChave` no core). Com
    // `?pair=` o segredo ia parar no log ao lado do dado que ele protege, o que
    // anulava a proteção inteira. A query segue sendo LIDA por tolerância (link
    // antigo ainda no histórico de alguém), mas nunca mais é GERADA.
    const codigoNaURL = (() => {
        try {
            const frag = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
            return frag.get('pair') || new URLSearchParams(window.location.search).get('pair');
        } catch (e) { return null; }
    })();
    if (codigoNaURL) {
        try { window.history.replaceState({}, '', window.location.pathname); } catch (e) {}
        showAuthScreen();
        resgatarPareamento(codigoNaURL, { silencioso: true });
        return;
    }

    const savedToken = API.getSession();
    if (savedToken) {
        // O token veio do armazenamento, não do login: sem isto o ciclo desta
        // sessão nasce sem início e a duração não existe (ver a função).
        marcarSessaoJaAtiva();
        showMainScreen();
        // O que ficou esperando de uma sessão anterior aparece e sai agora.
        // É o segundo (e último) gatilho: o outro é o evento `online`. Nenhum
        // dos dois é polling — a regra do free tier proíbe.
        //
        // DEPOIS do `showMainScreen`, e isso é load-bearing: é ELE que põe
        // `AppState.authenticated = true`, e o esvaziamento sai na primeira
        // linha sem isso. Chamado antes, o gatilho da abertura não fazia nada —
        // calado, e justamente pra quem ficou offline e fechou a app.
        updateInFlightIndicator();
        esvaziarFilaDeSaida();
        AppState._profilePromise = loadProfileAndAuxData();
        // Sem rede, a fila guardada entra no lugar da tela de falha — e aí NÃO
        // se chama `startFetching`, que só gastaria uma requisição fadada a
        // falhar. Com rede, segue o caminho de sempre e a varredura pega
        // carona na resposta que chegar.
        offlineTentarAbrirSemRede().then((abriu) => { if (!abriu) startFetching(); });
        handleLaunchAction();
    } else {
        // Sem sessão: antes de mostrar a tela de login, PERGUNTA à extensão.
        // Quem tem a extensão instalada e está logado no WME entra sem tocar em
        // nada; quem não tem cai na tela de sempre depois de EXT_ESPERA_MS.
        entrarPelaExtensao().then((entrou) => {
            if (entrou) return;
            // Escrita ATRASADA não pode atropelar estado novo. Entre o pedido e
            // esta linha passam centenas de ms, e nesse meio alguém pode ter
            // entrado por outro caminho (colar cookies, código de pareamento,
            // token injetado). Sem esta guarda o `showAuthScreen` derrubava a
            // sessão recém-criada e escondia a app JÁ montada — apareceu como
            // "card sem endereço / botões 0px" no smoke, mudando de aparelho a
            // cada rodada porque atinge sempre o PRIMEIRO card medido.
            if (API.getSession() || AppState.authenticated) return;
            showAuthScreen();
        });
    }
}

// ── Handshake com a extensão WazePlaces Rapid Access (@daflash) ───────────
//
// A extensão já sabia fazer login sozinha, mas só reagia ao botão dela dentro
// do WME: abrir a app direto não acionava nada, e sessão vencida obrigava a
// voltar ao WME e clicar de novo. O handshake inverte quem começa a conversa —
// a APP pede, a extensão responde —, e com isso o login vira invisível nos dois
// momentos que importam: ao abrir, e quando a sessão morre no meio do uso.
//
// O protocolo é `postMessage` na própria janela porque a extensão já injeta um
// content script na app (`auto-login.js`): é o canal que existe sem pedir
// permissão nova no manifesto dela.
//
// SEGURANÇA: aceitar um token por postMessage NÃO abre superfície nova —
// qualquer script na página já pode escrever `localStorage.waze_session_token`
// direto. Mesmo assim exigimos `event.source === window` e origem própria, pra
// não aceitar nada vindo de iframe ou de outra janela.
// Dois prazos, e a diferença entre eles é o desenho todo.
//
// A extensão leva ~1,8s pra responder — ela faz ida e volta ao Waze de verdade
// (medido com a extensão carregada). Esperar isso calado penalizaria QUEM NÃO
// TEM a extensão com 2 segundos de tela vazia; e mostrar o login na hora faria
// quem TEM ver a tela piscar antes de entrar.
//
// Por isso a ponte responde `aguarde` IMEDIATAMENTE (é mensagem local, sem
// rede) e só depois manda o token. Quem não tem extensão não recebe `aguarde`
// nenhum e cai no login em EXT_PRESENTE_MS — tempo que ninguém percebe.
const EXT_PRESENTE_MS = 350;    // "tem extensão aí?" — só espera local
const EXT_ESPERA_MS = 8000;     // depois do `aguarde`, o prazo da ida ao Waze
let extPerguntando = false;

function entrarPelaExtensao({ silencioso = false } = {}) {
    if (extPerguntando) return Promise.resolve(false);
    extPerguntando = true;

    return new Promise((resolve) => {
        let terminou = false;
        let prazo = setTimeout(() => fim(false), EXT_PRESENTE_MS);
        function fim(ok) {
            if (terminou) return;
            terminou = true;
            window.removeEventListener('message', ouvir);
            clearTimeout(prazo);
            extPerguntando = false;
            mostrarEntrandoPelaExtensao(false);
            resolve(ok);
        }
        function ouvir(ev) {
            if (ev.source !== window || ev.origin !== window.location.origin) return;
            const d = ev.data;
            if (!d || d.source !== 'wazeplaces-ext') return;
            // "estou aqui, trabalhando" — só agora vale mostrar o spinner e
            // esperar de verdade. Sem isto, quem não tem a extensão pagaria a
            // espera dela.
            if (d.action === 'aguarde') {
                clearTimeout(prazo);
                prazo = setTimeout(() => fim(false), EXT_ESPERA_MS);
                if (!silencioso) mostrarEntrandoPelaExtensao(true);
                return;
            }
            if (d.action === 'sem-sessao') return fim(false);   // instalada, mas sem login no WME
            if (d.action !== 'sessao' || !d.token) return;
            API.setSession(String(d.token), 'extensao');
            showMainScreen();
            AppState._profilePromise = loadProfileAndAuxData();
            startFetching();
            fim(true);
        }
        window.addEventListener('message', ouvir);
        try {
            window.postMessage({ source: 'wazeplaces', action: 'precisa-de-sessao' }, window.location.origin);
        } catch (e) { fim(false); }
    });
}

// Ao LIGAR esconde a tela de login e mostra o spinner. Ao desligar, esconde só
// o spinner — quem decide se a tela de login volta é o CHAMADOR, que sabe se o
// handshake deu certo. A primeira versão fazia o `toggle` nos dois no mesmo
// lugar e, ao terminar com sucesso, re-exibia o "Bem-vindo!" por cima da app já
// logada. Só apareceu com a extensão carregada de verdade.
function mostrarEntrandoPelaExtensao(ligado) {
    document.getElementById('extLoginState')?.classList.toggle('hidden', !ligado);
    if (ligado) document.getElementById('authScreen')?.classList.add('hidden');
}

// ── Gerenciador de modais ─────────────────────────────────────────────────
// Todos os diálogos (role="dialog") passam por aqui: foco entra no modal ao
// abrir e volta pro elemento de origem ao fechar; Esc fecha o modal aberto
// (via handleKeyDown); clique no scrim fecha; body trava o scroll.
// Novo modal? Adicionar o id em MODAL_IDS e usar openModal/closeModal.
const MODAL_IDS = ['pasteModal', 'logoutModal', 'accessDeniedModal', 'filtersModal', 'helpModal', 'batchReadModal', 'pairShowModal', 'pairEnterModal', 'comoFuncionaModal', 'treinoFimModal', 'presencaModal', 'conversaModal', 'pedidoModal', 'autorModal', 'resumoModal'];

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
    // O mapa ampliado é a camada de cima: o voltar do aparelho fecha ELE
    // primeiro, como faz com o lightbox de foto.
    if (typeof MapaLightbox !== 'undefined' && MapaLightbox.isOpen()) {
        CamadaVoltar.profundidade = Math.max(0, CamadaVoltar.profundidade - 1);
        MapaLightbox.close(true);
        return;
    }
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
    dfato('tela.modal', { abre: id });
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
    // A imagem do Resumo é um object URL: solta a memória e o blob por
    // qualquer caminho de fechamento (✕, Esc, scrim, voltar).
    resumoModal() {
        resumoAtual = null;
        const img = document.getElementById('resumoImg');
        if (img && img.src) { try { URL.revokeObjectURL(img.src); } catch (e) {} img.removeAttribute('src'); }
    },
    // O padrão da lista de autores é a forma CURTA. Amarrar isto ao botão de
    // fechar deixaria os outros dois caminhos (Esc e scrim) vazando o estado
    // expandido pra próxima abertura — o gotcha dos modais deste projeto.
    filtersModal() { autoresExpandido = false; escadaAberta = false; conquistaTocada = null; },
    pairShowModal() {
        pararTickerPareamento();
        // O código é credencial e já não vale nada aqui: não fica desenhado
        // esperando alguém reabrir o modal e escanear um QR morto.
        const code = document.getElementById('pairCode');
        if (code) {
            code.textContent = '······';
            delete code.dataset.raw;
            delete code.dataset.curto;
            code.classList.remove('opacity-40', 'line-through');
        }
        for (const id of ['pairExpiry', 'pairCodeExpiry']) {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        }
        // O código revelado volta a ficar escondido: revelar é um pedido, e cada
        // pedido cria um registro fraco novo no servidor. Herdar o estado da vez
        // passada faria a próxima abertura já nascer com a cópia fraca à mostra.
        document.getElementById('pairCodeReveal')?.classList.add('hidden');
        const btnCodigo = document.getElementById('pairShowCodeBtn');
        if (btnCodigo) { btnCodigo.classList.remove('hidden'); btnCodigo.disabled = false; }
        limparQrPareamento();
        const copiar = document.getElementById('pairCopyLinkBtn');
        if (copiar) copiar.disabled = true;
    },
    conversaModal() {
        // Fechar a conversa por QUALQUER caminho (✕, Esc, scrim, voltar) tem
        // que soltar o `aberta` — senão a próxima mensagem daquela pessoa
        // continua chegando como "conversa aberta" e nunca vira aviso.
        window.Presenca?.esquecerAberta?.();
    },
    pairEnterModal() {
        const campo = document.getElementById('pairCodeInput');
        if (campo) campo.value = '';
        document.getElementById('pairEnterError')?.classList.add('hidden');
    },
};

function closeModal(id, { viaHistorico = false } = {}) {
    dfato('tela.modal', { fecha: id, viaHistorico });
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
    $('diagBtn')?.addEventListener('click', baixarDiagnostico);
    $('helpBtn').addEventListener('click', () => openModal('helpModal'));
    $('presencaClose').addEventListener('click', () => closeModal('presencaModal'));
    $('pedidoClose').addEventListener('click', () => closeModal('pedidoModal'));
    $('filterSort')?.addEventListener('change', aoTrocarOrdenacao);
    $('resumoClose')?.addEventListener('click', () => closeModal('resumoModal'));
    $('resumoCompartilhar')?.addEventListener('click', compartilharResumo);
    $('resumoBaixar')?.addEventListener('click', baixarResumo);
    $('autorClose').addEventListener('click', () => closeModal('autorModal'));
    $('conversaClose').addEventListener('click', () => Presenca.fecharConversa());
    // O resto da presença (pílula, lista, envio) se liga sozinho: `montar` é do
    // js/presenca.js, que carrega depois deste arquivo.
    window.Presenca?.montar?.();
    $('closeHelp').addEventListener('click', () => closeModal('helpModal'));
    $('reverComoFunciona')?.addEventListener('click', abrirComoFunciona);
    $('comoFuncionaOk')?.addEventListener('click', () => closeModal('comoFuncionaModal'));
    $('comoFuncionaTreinar')?.addEventListener('click', () => { closeModal('comoFuncionaModal'); Treino.entrar(); });
    $('abrirTreino')?.addEventListener('click', () => { closeModal('helpModal'); Treino.entrar(); });
    $('treinoSairBtn')?.addEventListener('click', () => Treino.sair());
    $('treinoFimOk')?.addEventListener('click', () => { closeModal('treinoFimModal'); Treino.sair(); });

    // "Instalei… e agora?" — o beco sem saída medido: a app pergunta à extensão
    // UMA vez, no carregamento, com 350ms de janela, e o `ponte.js` não é
    // injetado numa aba que já estava aberta. Quem instala olhando pra esta tela
    // fica aqui pra sempre. Aparece só DEPOIS do clique em instalar, pra não ser
    // ruído pra quem nem foi à loja.
    $('extInstallLink')?.addEventListener('click', () => {
        const b = $('extJaInstalei');
        if (!b) return;
        b.hidden = false;
        b.classList.replace('hidden', 'flex');
    });
    $('extJaInstalei')?.addEventListener('click', () => window.location.reload());

    // E ao voltar pra esta aba, pergunta de novo — em silêncio. Hoje isso cobre
    // quem recarregou noutro lugar ou reabriu o WME; quando a extensão passar a
    // se injetar nas abas abertas (onInstalled + scripting, versão futura dela),
    // este mesmo caminho resolve a instalação sem toque nenhum e o botão acima
    // deixa de ser necessário. Só onde extensão existe: no celular seria uma
    // espera de 350ms por nada, repetida a cada troca de aba.
    if (podeInstalarExtensao()) {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            if (AppState.authenticated || API.getSession()) return;
            if (document.getElementById('authScreen')?.classList.contains('hidden')) return;
            entrarPelaExtensao({ silencioso: true });
        });
    }
    $('themeBtn').addEventListener('click', toggleTheme);
    $('filtersBtn').addEventListener('click', () => {
        // O ponto aceso é o MOTIVO do toque: leva direto ao que destravou, como
        // o aviso do Desfazer já fazia. Sem ponto, o botão faz o que promete.
        //
        // Isso acontece NO MÁXIMO uma vez por conquista, e por CONSTRUÇÃO, não
        // por regra escrita: abrir a aba Histórico apaga o ponto (o
        // `marcarConquistasVistas` do `switchFilterTab`), então o próximo toque
        // já cai em Filtros. Medido com a app de pé, não deduzido — eu cheguei a
        // recusar este desvio achando que ele se repetiria por dias.
        //
        // O atalho do PWA (`/?action=filters`) NÃO passa por aqui de propósito:
        // ali a pessoa escolheu "Filtros" num menu, e o pedido é explícito.
        if (temConquistaNova()) abrirConquistaNova();
        else openFiltersModal();
    });

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
    registrarIdiomaUsado(valor);
    safeLS.set(LANG_KEY, valor);
    applyI18n();
    // Os dois seletores mostram a mesma escolha, tenha sido feita em qual for.
    for (const id of SELETORES_IDIOMA) {
        const s = document.getElementById(id);
        if (s && s.value !== valor) s.value = valor;
    }
    // O `applyI18n` acima reescreveu o texto das opções de data (elas têm
    // `data-i18n`), levando o ícone junto — redecora.
    popularOrdenacoes();
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
    // Abrir a aba Histórico apaga o selo (decisão do owner). Fica AQUI e não no
    // handler do botão porque a aba também se alcança pelo teclado (setas, Home,
    // End) — amarrar ao clique deixaria o selo aceso pra quem navega assim.
    if (tabId === 'filtersTabHistory') marcarConquistasVistas();
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
const pairTickers = new Map();

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

// O gerador de QR (12KB) só serve ao pareamento, que a maioria dos editores
// nunca abre — e era baixado em TODA abertura da app. Aqui ele vem sob demanda,
// uma vez por sessão. É `self` na CSP, então injetar a tag é permitido.
let _qrCarregando = null;
function carregarQr() {
    if (typeof gerarQR === 'function') return Promise.resolve(true);
    if (_qrCarregando) return _qrCarregando;
    _qrCarregando = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'js/min/qr.js';
        s.onload = () => resolve(typeof gerarQR === 'function');
        // Falhar não pode travar o pareamento: o código digitável continua lá.
        s.onerror = () => { _qrCarregando = null; resolve(false); };
        document.head.appendChild(s);
    });
    return _qrCarregando;
}

async function desenharQrPareamento(url) {
    const canvas = document.getElementById('pairQr');
    if (!canvas) return;
    if (!(await carregarQr())) { canvas.classList.add('hidden'); return; }
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
    // `openModal` sozinho: ele JÁ esconde os outros modais, e trocar de modal
    // é a MESMA camada — não empilha histórico.
    //
    // Fechar antes, no mesmo quadro, dessincronizava o contador do voltar do
    // jeito mais traiçoeiro possível: o `closeModal` agenda um `history.back()`,
    // o `openModal` seguinte empilha uma entrada NOVA, e o back que estava
    // pendente come justamente essa. Sobra `profundidade: 1` sem entrada real
    // por trás — e o próximo fechamento manda o `back()` pra fora da app.
    //
    // MEDIDO: Ajuda → Conectar outro aparelho → fechar tirava o editor da
    // página. O contador não denuncia (fica em 1, com history.length 3): só
    // a navegação mostra.
    openModal('pairShowModal');
    const codeEl = document.getElementById('pairCode');
    const expEl = document.getElementById('pairExpiry');
    codeEl.textContent = '······';
    delete codeEl.dataset.raw;
    codeEl.classList.remove('opacity-40', 'line-through');
    expEl.textContent = '';
    // O código volta a ficar escondido a cada abertura: revelar é um pedido, e
    // pedido não se herda da vez passada — cada revelação cria um registro
    // fraco novo no servidor.
    document.getElementById('pairCodeReveal').classList.add('hidden');
    document.getElementById('pairShowCodeBtn').classList.remove('hidden');
    document.getElementById('pairShowCodeBtn').disabled = false;
    document.getElementById('pairCodeExpiry').textContent = '';
    limparQrPareamento();
    document.getElementById('pairCopyLinkBtn').disabled = true;

    const r = await API.criarPareamento();
    if (!r.success) {
        closeModal('pairShowModal');
        showToast(msgDoServidor(r, t('toast.pairCreateError')), 'error');
        return;
    }
    // O segredo do QR NÃO é exibido: ele tem 20 símbolos e ninguém vai digitar
    // isso. Quem não tem câmera pede um código curto no botão, e aí sim.
    codeEl.dataset.raw = r.code;
    desenharQrPareamento(location.origin + '/#pair=' + r.code);
    document.getElementById('pairCopyLinkBtn').disabled = false;

    iniciarTickerPareamento(expEl, r.expiresIn, () => limparQrPareamento());
}

// Contagem regressiva: deixa claro que o segredo morre — e evita o editor ficar
// tentando um código velho achando que a app quebrou. Vale pro QR e pro código
// digitado, que são registros SEPARADOS e vencem cada um no seu tempo.
function iniciarTickerPareamento(elemento, segundos, aoVencer) {
    let restante = segundos;
    const tick = () => {
        if (restante <= 0) {
            elemento.textContent = t('pair.expired');
            if (aoVencer) aoVencer();
            pararTickerPareamento(elemento);
            return;
        }
        const m = Math.floor(restante / 60);
        const seg = String(restante % 60).padStart(2, '0');
        elemento.textContent = t('pair.expiresIn', { time: m + ':' + seg });
        restante--;
    };
    pararTickerPareamento(elemento);
    tick();
    pairTickers.set(elemento, setInterval(tick, 1000));
}

// Um ticker por elemento: o QR e o código correm juntos, e um `clearInterval`
// só derrubaria o outro em silêncio. Sem argumento, para todos — é o que a
// LIMPEZA_AO_FECHAR precisa, e é o caminho que já mordeu antes (o ticker seguia
// rodando pelo resto da sessão porque a limpeza morava no handler do botão).
function pararTickerPareamento(elemento) {
    if (elemento) {
        clearInterval(pairTickers.get(elemento));
        pairTickers.delete(elemento);
        return;
    }
    for (const id of pairTickers.values()) clearInterval(id);
    pairTickers.clear();
}

// Cria um registro de pareamento CURTO (6 chars, digitável) — só quando pedido.
// Ver o comentário no index.html: o curto é fraco por construção, e existir só
// sob demanda é o que impede que ele enfraqueça o QR de todo mundo.
async function revelarCodigoPareamento() {
    const btn = document.getElementById('pairShowCodeBtn');
    const codeEl = document.getElementById('pairCode');
    const expEl = document.getElementById('pairCodeExpiry');
    btn.disabled = true;
    const r = await API.criarPareamento({ comCodigo: true });
    if (!r.success) {
        btn.disabled = false;
        showToast(msgDoServidor(r, t('toast.pairCreateError')), 'error');
        return;
    }
    btn.classList.add('hidden');
    document.getElementById('pairCodeReveal').classList.remove('hidden');
    codeEl.textContent = formatarCodigoPareamento(r.code);
    // O CRU é o que vale pro resgate — o separador é só apresentação.
    codeEl.dataset.curto = r.code;
    codeEl.classList.remove('opacity-40', 'line-through');
    iniciarTickerPareamento(expEl, r.expiresIn, () => codeEl.classList.add('opacity-40', 'line-through'));
}

async function copiarLinkPareamento() {
    const raw = document.getElementById('pairCode').dataset.raw;
    if (!raw) return;
    const url = location.origin + '/#pair=' + raw;
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
    $('lightboxDelete')?.addEventListener('click', pedirExclusaoDaFoto);
    $('lightboxApprove')?.addEventListener('click', aprovarFotoAtual);
    $('lightboxNomeBtn')?.addEventListener('click', abrirEdicaoNome);
    $('lightboxNomeOk')?.addEventListener('click', confirmarRenomear);
    $('lightboxNomeCancel')?.addEventListener('click', fecharEdicaoNome);
    $('lightboxNomeInput')?.addEventListener('input', atualizarBotaoSalvarNome);
    $('lightboxNomeInput')?.addEventListener('keydown', (ev) => {
        // Enter confirma, Esc cancela — e o Esc PARA aqui (`stopPropagation`),
        // senão ele fecha o lightbox inteiro e a pessoa perde a foto que estava
        // usando de prova só por desistir de um caractere.
        if (ev.key === 'Enter') { ev.preventDefault(); confirmarRenomear(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fecharEdicaoNome(); }
    });

    // Pareamento
    $('pairCreateBtn')?.addEventListener('click', abrirPareamento);
    $('pairCopyLinkBtn')?.addEventListener('click', copiarLinkPareamento);
    $('pairShowCodeBtn')?.addEventListener('click', revelarCodigoPareamento);
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
    $('prefOfflineDisponivel')?.addEventListener('change', (e) => {
        AppState.preferences.offlineDisponivel = e.target.checked;
        savePreferences();
        // Zera ANTES dos dois ramos: alternar o toggle apaga o resultado da
        // varredura anterior, senão religar mostraria o "parcial" de antes.
        offlineUltimoResultado = null;
        if (e.target.checked) {
            offlineMarcarGesto();       // marcar JÁ é o gesto: não dorme
            offlineVarrer();            // enche agora, com o custo na tela
        } else {
            offlineEsquecer();          // desligou: some o que foi guardado
        }
        atualizarLinhaDoOffline(0, 0);
    });
    $('prefPularGuarda').addEventListener('change', (e) => {
        AppState.preferences.pularGuarda = e.target.checked;
        savePreferences();
        // O selo do ↑ muda de texto com a preferência, e o card já está na tela
        // atrás do modal — sem isto ele só se corrigiria no próximo swipe, e a
        // primeira vez que a pessoa arrastasse veria o texto antigo.
        atualizarSeloDePular();
    });
    $('prefPresenca').addEventListener('change', (e) => {
        AppState.preferences.presenca = e.target.checked;
        // O carimbo é do DESLIGAR. Religar à mão zera: quem voltou por vontade
        // própria não está no meio de nenhuma contagem. E a mesma chave vale
        // pro mapa do WME (fase 2): desligar some de lá na hora, religar volta
        // na próxima ação.
        if (e.target.checked) {
            delete AppState.preferences.presencaOffEm;
            presencaWmeReligar();
        } else {
            AppState.preferences.presencaOffEm = Date.now();
            presencaWmeDesligar();
        }
        savePreferences();
        window.Presenca?.sincronizar?.();
    });
    $('prefDevModeActive').addEventListener('change', (e) => {
        if (!AppState.devMode.unlocked) return;
        // Desligar APAGA o que o dev gravou — senão "desligado" é mentira: o
        // dado continua no aparelho. Mas nunca em silêncio: captura que ainda
        // não foi baixada é trabalho, e perder trabalho sem avisar é o pior
        // desfecho possível pra um instrumento de socorro.
        if (!e.target.checked && dlogNaoBaixados() > 0) {
            showToast(t('toast.devPerdeCaptura', { n: dlogNaoBaixados() }), 'error', 9000);
        }
        AppState.devMode.active = e.target.checked;
        saveDevMode();
        updateDevBadge();
        atualizarFabDev();
        diagAjustarRecursos();
        if (!e.target.checked) {
            dlogApagar();
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

// SOBRE O `thumb100_` DO WAZE, E POR QUE ELE NÃO É USADO AQUI
//
// O Waze serve `thumb100_` (100x75, 3,2 KB) além do `thumb700_` (700x525,
// 80,8 KB) — 25x menos bytes. A tira de miniaturas chegou usando ele, e estava
// ERRADO. O owner apontou: o aquecimento JÁ baixou os `thumb700` deste card.
//
// Medido: renderizar um card dispara o aquecimento das 4 fotos do SEGUINTE em
// `thumb700` (`PREFETCH_TETO_FOTOS = 4`, cobrindo 91,7% dos cards por inteiro),
// e o `venue-image.waze.com` responde com `max-age=3600`. Quando o lightbox
// abre, essas fotos estão em cache e custam ZERO.
//
// O `thumb100` é outra URL, então nunca aproveita esse cache: seriam 4
// requisições novas e ~12,8 KB por local, por fotos que o aparelho já tem. Numa
// sessão de triagem com dezenas de locais de várias fotos, isso vira centenas
// de KB de duplicata — na conta de dados do editor.
//
// E tem o outro lado: reusar o `thumb700` na tira PRÉ-AQUECE o carrossel (é a
// mesma imagem que aparece ao tocar em ›), enquanto o `thumb100` baixa algo que
// nunca mais é usado. O preço é decodificar 700x525 pra desenhar em 59x44 —
// pago em memória, não em rede, e limitado pelo `loading="lazy"` (só as
// miniaturas visíveis decodificam).
//
// Resumo pro próximo que achar o `thumb100`: ele é ótimo em abstrato e inútil
// aqui, porque a app já tem a foto grande antes de precisar da pequena.

// Quando a foto foi tirada, na forma que o editor usa pra decidir.
//
// POR QUE ISTO IMPORTA: no lightbox mora a lixeira, e a pergunta que antecede
// excluir é "isto ainda é este lugar?". MEDIDO nos 6 países obrigatórios (3176
// fotos): a distribuição é BIMODAL — 48,5% têm menos de um mês (são as
// propostas) e 39,2% têm MAIS DE TRÊS ANOS, chegando a 12. Quase nada no meio.
// Ou seja, a data separa na hora "esta é a proposta" de "este é o acervo
// antigo", e hoje 39% das fotos chegam sem nenhum sinal disso na tela.
//
// FORMATO guiado pelos próprios dados: relativo pras recentes (metade dos
// casos, e "há 3 dias" lê melhor que uma data) e ANO pras antigas ("2019" lê
// melhor que "há 2350 dias"). O corte é 1 ano.
//
// `Intl.RelativeTimeFormat` em vez de chaves no dicionário: ele resolve plural
// por idioma sozinho, e o projeto não tem ICU — chave manual é exatamente onde
// nasce o "1 dias" (ver a nota do {undoSeg} no CLAUDE.md). Aqui não há string
// nossa pra traduzir: é dado formatado no locale, como o resto dos números.
function idadeDaFoto(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const dias = Math.floor((Date.now() - ms) / 86400000);
    if (dias < 0) return null;   // relógio torto ou data no futuro: não inventa
    const loc = i18nLocale();
    try {
        if (dias >= 365) return new Date(ms).toLocaleDateString(loc, { year: 'numeric' });
        const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
        if (dias < 1) return rtf.format(0, 'day');
        if (dias < 30) return rtf.format(-dias, 'day');
        return rtf.format(-Math.round(dias / 30), 'month');
    } catch (e) {
        return new Date(ms).toLocaleDateString(loc);
    }
}

// As duas ações de foto (excluir / aprovar) aparecem por REGRA DE ESTADO,
// avaliada a cada render — nunca por um esconder de disparo único.
//
// Foi exatamente isso que quebrou, relatado pelo owner: `abrirEdicaoNome()`
// escondia os botões UMA vez, e o render da foto seguinte os reacendia sem
// saber que havia renomeação em curso. Reapareciam logo ABAIXO do
// confirmar/cancelar do nome — o canto pra onde o dedo já estava indo, com
// duas ações que gravam no mapa.
//
// Mesma lição do `acoesTravadas()` (gotcha #63): regra que vale em dois
// momentos mora em UMA função, senão os dois momentos divergem sem ninguém ver.
function atualizarAcoesDeFoto() {
    // No treino as duas ações NÃO existem: escrevem no mapa e não têm ensaio
    // possível. Some em vez de desabilitar — botão morto com cara de vivo lê
    // como app quebrada, e "desabilitado" convida à pergunta "por que não
    // posso?", que num treino não tem resposta boa.
    //
    // Renomeando, mesma coisa: elas ficam no mesmo canto do confirmar/cancelar.
    // Trocar de foto DURANTE a renomeação continua valendo (é legítimo conferir
    // a grafia noutra fachada) — o que não pode é a ação destrutiva voltar.
    const some = Treino.ativo || editandoNome();
    const del = document.getElementById('lightboxDelete');
    if (del) del.classList.toggle('hidden', some || !Lightbox.idFotoAtual());
    // Mutuamente exclusivos: pendente se APROVA, aprovada se EXCLUI. Sem isso
    // os dois brigariam pelo mesmo canto, e o editor teria que adivinhar qual
    // vale pra foto que está vendo.
    const apr = document.getElementById('lightboxApprove');
    if (apr) apr.classList.toggle('hidden', some || !Lightbox.podeAprovarAtual());
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
    open(urls, startIdx, newImageIdx, placeName, eDenuncia, place) {
        if (!urls || urls.length === 0) return;
        // O place vem EXPLÍCITO em vez de sair do AppState: a lixeira grava no
        // Waze, e ler o alvo de uma variável global é como se apaga a foto do
        // card errado quando a fila anda embaixo de um lightbox aberto.
        this.place = place || null;
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
        mostrarNomeNoLightbox();
    },
    close({ viaHistorico = false } = {}) {
        fecharEdicaoNome();
        if (!this.isOpen()) return;
        if (!viaHistorico) CamadaVoltar.consumir();
        document.getElementById('imageLightbox').classList.add('hidden');
        // Aprovou aqui dentro? O pedido está resolvido no Waze, então o card sai
        // agora — decisão do owner: ficar visível enquanto se olham as outras
        // fotos, e avançar ao fechar. Fica DEPOIS de esconder o lightbox pra o
        // card novo não aparecer por baixo de uma camada que ainda está aberta.
        avancarSeAprovado();
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
        img.src = urlDaFoto(this.urls[this.idx]);
        img.alt = this.placeName ? t('lightbox.img.alt', { name: this.placeName }) : t('lightbox.img.altGeneric');
        const prevBtn = document.getElementById('lightboxPrev');
        const nextBtn = document.getElementById('lightboxNext');
        const count = document.getElementById('lightboxCount');
        const badge = document.getElementById('lightboxNewBadge');
        const multiple = this.urls.length > 1;
        prevBtn.classList.toggle('hidden', !multiple);
        nextBtn.classList.toggle('hidden', !multiple);
        // A pílula do canto passa a dizer DUAS coisas: qual foto e de quando.
        // Vai junto porque é o mesmo assunto ("a foto que estou vendo") e
        // porque espaço no lightbox é disputado — elemento novo brigaria com
        // fechar, selo, dica de zoom, ações e a tira. Com uma foto só, o
        // "1 / 1" seria ruído: fica só a idade.
        const ms = this.dataDaFotoAtual();
        const idade = idadeDaFoto(ms);
        const autor = this.autorDaFotoAtual();
        // Ordem: QUAL foto · DE QUEM · DE QUANDO. Posição, identidade, tempo —
        // é a que se lê sem tropeçar, e foi a escolhida pelo owner nos mockups.
        //
        // Montado com nós, não com `textContent` de uma string só, porque o
        // NOME vem da rede e precisa encolher sozinho: no Galaxy Fold a pílula
        // com `world_onm8fgfi` media 260px e ATROPELAVA o ✕ (medido por
        // hit-test). Só o nome tem `text-overflow`; contador e idade são
        // `flex:none` e sobrevivem sempre — cortar a idade seria perder a
        // informação que já existia pra caber a que chegou depois.
        //
        // `textContent` em cada nó, nunca innerHTML: nome de usuário é dado de
        // terceiro.
        const partes = [];
        if (multiple) partes.push({ txt: `${this.idx + 1} / ${this.urls.length}`, fixo: true });
        if (autor) partes.push({ txt: autor, fixo: false });
        if (idade) partes.push({ txt: idade, fixo: true });
        count.classList.toggle('hidden', partes.length === 0);
        count.textContent = '';
        partes.forEach((parte, i) => {
            if (i) {
                const sep = document.createElement('span');
                sep.className = 'lb-pill-fixo';
                sep.textContent = ' · ';
                count.appendChild(sep);
            }
            const n = document.createElement('span');
            n.className = parte.fixo ? 'lb-pill-fixo' : 'lb-pill-nome';
            n.textContent = parte.txt;
            count.appendChild(n);
        });
        // A data exata fica no title: a forma curta responde "é velha?", que é
        // a pergunta de decisão; quem precisar do dia tem onde olhar.
        if (ms) count.title = new Date(ms).toLocaleString(i18nLocale());
        else count.removeAttribute('title');
        badge.textContent = this.eDenuncia ? '🚩' : '✨';
        badge.setAttribute('data-i18n-title', this.eDenuncia ? 'card.flaggedPhoto.title' : 'card.newPhoto.title');
        badge.title = t(this.eDenuncia ? 'card.flaggedPhoto.title' : 'card.newPhoto.title');
        badge.classList.toggle('hidden', this.idx !== this.newIdx);
        // No treino as duas ações de foto NÃO existem: elas escrevem no mapa e
        // não têm ensaio possível. Some em vez de desabilitar — botão morto com
        // cara de vivo lê como app quebrada, e "desabilitado" convida à pergunta
        // "por que não posso?", que num treino não tem resposta boa.
        atualizarAcoesDeFoto();
        this._renderTira();
    },
    // Todas as fotos do local de uma vez, tocáveis pra pular direto.
    //
    // O problema que resolve: 32% dos pedidos da fila real têm 2+ fotos (até 7),
    // e hoje só dá pra tatear no `‹ ›` sem saber quantas faltam nem o que vem.
    // Em `FLAGGED_PHOTO` e `NEW_PHOTO` isso é a própria decisão — "esta, entre
    // estas" e "a proposta ao lado das que o local já tem".
    _renderTira() {
        const tira = document.getElementById('lightboxStrip');
        const lb = document.getElementById('imageLightbox');
        if (!tira || !lb) return;
        const varias = this.urls.length > 1;
        lb.classList.toggle('com-tira', varias);
        tira.classList.toggle('hidden', !varias);
        if (!varias) { tira.innerHTML = ''; tira.dataset.chave = ''; return; }
        // Reconstrói só quando a LISTA muda. Excluir uma foto muda; trocar de
        // foto não — e recriar a cada troca perderia a rolagem da tira e
        // rebaixaria as miniaturas já carregadas.
        const chave = this.urls.join('|');
        if (tira.dataset.chave !== chave) {
            tira.innerHTML = '';
            this.urls.forEach((u, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'lb-mini';
                const im = document.createElement('img');
                // a MESMA URL da foto grande: já está em cache (ver a nota acima).
                // `urlDaFoto` é o que a torna a mesma — com o offline ligado a
                // grande leva o sufixo, e a crua seria outra cópia, baixada à toa
                // com sinal e quebrada sem ele.
                im.src = urlDaFoto(u);
                im.alt = '';
                im.decoding = 'async';
                im.loading = 'lazy';
                b.appendChild(im);
                b.addEventListener('click', () => { this.idx = i; this._render(); });
                tira.appendChild(b);
            });
            tira.dataset.chave = chave;
        }
        [...tira.children].forEach((b, i) => {
            const atual = i === this.idx;
            b.classList.toggle('atual', atual);
            b.setAttribute('aria-current', atual ? 'true' : 'false');
            b.setAttribute('aria-label', t('lightbox.strip.item', { i: i + 1, n: this.urls.length }));
            // O selo vai junto: sem ele a tira mostra N fotos iguais e esconde
            // qual delas É o pedido — que é a única coisa que importa aqui.
            const velho = b.querySelector('.lb-mini-selo');
            if (velho) velho.remove();
            if (i === this.newIdx && this.newIdx >= 0) {
                const selo = document.createElement('span');
                selo.className = 'lb-mini-selo';
                selo.setAttribute('aria-hidden', 'true');
                selo.textContent = this.eDenuncia ? '🚩' : '✨';
                b.appendChild(selo);
            }
        });
        const atual = tira.children[this.idx];
        if (atual && atual.scrollIntoView) atual.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    // A foto aberta é a PENDENTE deste pedido e este editor pode aprovar?
    //
    // `newIdx` é o índice do ✨, derivado do `updateRequestID` — então "a foto
    // pendente" é exatamente a que este card propõe. Denúncia (🚩) fica de
    // fora: ali a foto JÁ está no mapa e o que se decide é outra coisa.
    podeAprovarAtual() {
        const p = this.place;
        if (!p || this.eDenuncia) return false;
        if (this.idx !== this.newIdx || this.newIdx < 0) return false;
        if (!p.venueID || !p.updateRequestID) return false;
        return podeAgirComoL6Aqui();   // mesmo portão, decisão do owner
    },
    // Depois de aprovada, a foto passa a estar no mapa: o ✨ some e ela entra
    // na lista de excluíveis — o botão vira lixeira sozinho.
    marcarComoAprovada(id) {
        const p = this.place;
        if (p && Array.isArray(p.approvedImageIds) && !p.approvedImageIds.includes(id)) p.approvedImageIds.push(id);
        if (this.newIdx === this.idx) this.newIdx = -1;
        if (this.isOpen()) this._render();
    },
    desmarcarAprovada(id, idxDoNovo) {
        const p = this.place;
        if (p && Array.isArray(p.approvedImageIds)) p.approvedImageIds = p.approvedImageIds.filter((x) => x !== id);
        this.newIdx = idxDoNovo;
        if (this.isOpen()) this._render();
    },
    // Devolve o id da foto aberta SÓ se ela puder ser excluída — as duas
    // perguntas numa função só, de propósito: separadas, uma delas acaba
    // esquecida em algum caminho novo e a lixeira aparece onde não deve.
    //
    // Excluível é a foto JÁ APROVADA (o core manda `approvedImageIds`). A
    // pendente — a do ✨ — ainda não está no mapa: tirá-la por aqui apagaria a
    // imagem e deixaria o pedido órfão, sem ninguém tratar. O caminho dela é o
    // ✕/✓ do card.
    // A data da foto ABERTA. Busca pelo id contido na URL, mesmo padrão do
    // `idFotoAtual` — o índice não identifica foto (o carrossel reordena).
    dataDaFotoAtual() {
        const mapa = this.place && this.place.imageDates;
        if (!mapa) return null;
        const url = this.urls[this.idx] || '';
        const id = Object.keys(mapa).find((k) => k && url.indexOf(k) !== -1);
        return id ? mapa[id] : null;
    },
    // QUEM mandou a foto aberta. Duas fontes, e a ordem importa:
    //
    //  1. `imageAuthors` (o `creatorUserId` da própria foto). É a única
    //     atribuição que vale pro carrossel inteiro — MEDIDO: 23,7% dos locais
    //     têm fotos de pessoas DIFERENTES, então herdar o autor do pedido
    //     estaria errado num de cada quatro. E aqui se APROVA e se EXCLUI: uma
    //     atribuição errada numa tela dessas é o pior lugar possível.
    //  2. Só a foto do ✨ — a proposta NESTE pedido, que ainda não está no mapa
    //     e por isso não tem `creatorUserId` — cai no `createdBy` do pedido.
    //     Aí não há ambiguidade: o card é de UM pedido, e quem o enviou enviou
    //     essa foto. É o mesmo par que o WME mostra.
    //
    // Sem nenhuma das duas, devolve null e a pílula simplesmente não fala do
    // assunto — mesmo comportamento do contador quando há uma foto só.
    autorDaFotoAtual() {
        const p = this.place;
        if (!p) return null;
        const url = this.urls[this.idx] || '';
        const mapa = p.imageAuthors;
        if (mapa) {
            const id = Object.keys(mapa).find((k) => k && url.indexOf(k) !== -1);
            if (id && mapa[id]) return String(mapa[id]);
        }
        if (this.newIdx >= 0 && this.idx === this.newIdx && p.createdBy) return String(p.createdBy);
        return null;
    },
    idFotoAtual() {
        const p = this.place;
        if (!p || !p.venueID || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) return null;
        if (!podeExcluirFotoAqui()) return null;
        const url = this.urls[this.idx] || '';
        const ids = Array.isArray(p.approvedImageIds) ? p.approvedImageIds : [];
        return ids.find(id => id && url.indexOf(id) !== -1) || null;
    },
    // Recoloca a foto na posição em que estava — usado pelo Desfazer e quando o
    // envio falha. Sem isto, desfazer devolveria a foto pro fim da lista e a
    // pessoa veria a ordem mudar sozinha.
    recolocarFoto(url, idx) {
        if (!url || this.urls.some((u) => u === url)) return;
        const pos = Math.max(0, Math.min(idx, this.urls.length));
        this.urls.splice(pos, 0, url);
        if (this.newIdx >= pos) this.newIdx += 1;
        this.idx = pos;
        if (!this.isOpen()) return;
        this._render();
    },
    // Tira a foto da lista aberta depois que o Waze confirmou. Sem fila e sem
    // recarregar: quem está olhando quer ver a foto sumir.
    removerFoto(id) {
        const p = this.place;
        const fora = (u) => u.indexOf(id) === -1;
        if (p) {
            if (Array.isArray(p.imageUrls)) p.imageUrls = p.imageUrls.filter(fora);
            if (Array.isArray(p.approvedImageIds)) p.approvedImageIds = p.approvedImageIds.filter(x => x !== id);
            p.imageUrl = (p.imageUrls && p.imageUrls[0]) || null;
        }
        const antes = this.idx;
        this.urls = this.urls.filter(fora);
        if (!this.urls.length) { this.close(); return; }
        // O ✨ é apontado por ÍNDICE; tirar uma foto antes dele desloca tudo.
        if (this.newIdx > antes) this.newIdx -= 1;
        else if (this.newIdx === antes) this.newIdx = -1;
        this.idx = Math.min(antes, this.urls.length - 1);
        this._render();
    }
};

// ═══════════════════════════════════════════════════════════════════════════
//  O portão dos recursos destrutivos: L6 + Area Manager, ou staff
// ═══════════════════════════════════════════════════════════════════════════
//
// A app tem DOIS níveis, e o par é deliberado:
//   · ENTRAR é L3+AM (`isUserAllowed`, no core) — é o portão de verdade, no
//     SERVIDOR, e é ele que impede que qualquer um com cookies do Waze use a app.
//   · AGIR de forma destrutiva é L6+AM — este aqui, só do CLIENTE.
//
// Só do cliente é decisão, não esquecimento: o Waze valida `permissions` e
// `lockRank` na gravação, então quem não pode por aqui também não consegue por
// lá. Isto nunca foi fronteira de segurança — é trava de produto pra o recurso
// não aparecer pra qualquer editor na NOSSA app. Houve um espelho no servidor,
// com cache de perfil pra não custar caro, e SAIU: a chamada que ele exigia era
// a mais lenta das três (977ms medidos) e existia pra reconfirmar o que o Waze
// reconfirma de novo ao gravar (gotcha #59).
//
// O nome NÃO fala de foto de propósito. Ele já guardava três recursos — excluir
// foto, aprovar foto e renomear local — e chamá-lo de "excluir foto" fazia cada
// novo call site parecer estranho, o que empurra a próxima pessoa a
// re-implementar `rank >= 5` em vez de delegar. `test/gates.test.mjs` reprova
// quem re-implementar.
//
// Recurso novo entra por uma função PRÓPRIA que delega (ver `podeRenomearAqui`),
// nunca chamando esta direto: são decisões de produto que hoje COINCIDEM, e se
// um dia o owner separar uma delas, o call site não muda.
function podeAgirComoL6Aqui() {
    const p = AppState.profile;
    if (!p) return false;
    if (p.isStaff) return true;
    // Rank CRU do Waze, 0-indexed: 5 aqui é o L6 que o editor vê (gotcha #15).
    const rank = Number.isInteger(p.rank) ? p.rank : parseInt(p.rank, 10);
    return rank >= 5 && !!p.isAreaManager;
}

// Excluir foto: o primeiro recurso a usar o portão, e agora um delegador como
// os outros dois. Existir como função própria — em vez de o call site chamar a
// base — é o que mantém a invariante que o teste cobra: NENHUM recurso fala
// direto com `podeAgirComoL6Aqui`, cada um tem o seu nome. Assim, separar um
// deles um dia é editar uma função, não caçar call sites.
function podeExcluirFotoAqui() {
    return podeAgirComoL6Aqui();
}

// Gestos do mapa ampliado. Ponteiros unificados (mouse e dedo pelo mesmo
// caminho) porque o mapa é o mesmo nos dois; o que muda é só quantos pontos
// tocam a tela.
function setupMapaLightbox() {
    const lb = document.getElementById('mapaLightbox');
    if (!lb) return;
    document.getElementById('mapaLbClose').addEventListener('click', () => MapaLightbox.close());
    document.getElementById('mapaLbMais').addEventListener('click', () => MapaLightbox.zoom(1));
    document.getElementById('mapaLbMenos').addEventListener('click', () => MapaLightbox.zoom(-1));
    document.getElementById('mapaLbCentrar').addEventListener('click', () => MapaLightbox.recentrar());

    // Os listeners de mover/soltar vão na JANELA, não no elemento.
    //
    // A primeira versão usava `setPointerCapture` no próprio mapa e PERDIA o
    // arrasto: medido, só 2 de 14 movimentos chegavam e o `pointerup` nunca
    // vinha. O motivo é o próprio redesenho — `desenhar()` remove e recria os
    // <img> dos tiles no meio do gesto, e a captura não sobrevive a isso.
    // Escutar na janela não depende de nenhum elemento continuar existindo.
    //
    // E o desenho é AGENDADO por quadro em vez de rodar a cada evento: mover o
    // dedo dispara dezenas de eventos por segundo, e reposicionar 20 tiles em
    // cada um trava a mão. Mesma lição do gotcha #35 — o handler decide, o
    // quadro seguinte escreve.
    const ativos = new Map();
    let acumX = 0, acumY = 0, quadro = 0, arrastou = false, ultimo = null, distPinch = 0;
    const aplicar = () => {
        quadro = 0;
        const dx = acumX, dy = acumY;
        acumX = acumY = 0;
        if (dx || dy) MapaLightbox.arrastar(dx, dy);
    };
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(aplicar); };
    const doisDedos = () => {
        const [a, b] = [...ativos.values()];
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const mover = (e) => {
        if (!ativos.has(e.pointerId)) return;
        ativos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ativos.size >= 2) {
            const c = doisDedos();
            // Um degrau por DOBRO de distância: é a relação natural do pinch e
            // não dispara com tremor de dedo.
            if (distPinch > 0 && (c.d / distPinch > 1.6 || distPinch / c.d > 1.6)) {
                MapaLightbox.zoom(c.d > distPinch ? 1 : -1, c.x, c.y);
                distPinch = c.d;
            }
            arrastou = true;
            return;
        }
        if (!ultimo) return;
        const dx = e.clientX - ultimo.x, dy = e.clientY - ultimo.y;
        if (!dx && !dy) return;
        arrastou = true;
        ultimo = { x: e.clientX, y: e.clientY };
        acumX += dx; acumY += dy;
        agendar();
    };
    const soltar = (e) => {
        ativos.delete(e.pointerId);
        if (ativos.size === 0) {
            ultimo = null;
            removeEventListener('pointermove', mover);
            removeEventListener('pointerup', soltar);
            removeEventListener('pointercancel', soltar);
            if (quadro) { cancelAnimationFrame(quadro); aplicar(); }
        } else {
            const p0 = [...ativos.values()][0];
            ultimo = { x: p0.x, y: p0.y };
        }
    };
    lb.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;   // botão é botão
        e.preventDefault();
        ativos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        arrastou = false;
        if (ativos.size === 2) distPinch = doisDedos().d;
        else ultimo = { x: e.clientX, y: e.clientY };
        addEventListener('pointermove', mover);
        addEventListener('pointerup', soltar);
        addEventListener('pointercancel', soltar);
    });
    // Roda do mouse: o desktop não tem pinch.
    lb.addEventListener('wheel', (e) => {
        e.preventDefault();
        MapaLightbox.zoom(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    }, { passive: false });
    // Duplo toque aproxima, como em qualquer mapa.
    let ultimoToque = 0;
    lb.addEventListener('click', (e) => {
        if (e.target.closest('button') || arrastou) return;
        const agora = Date.now();
        if (agora - ultimoToque < 300) MapaLightbox.zoom(1, e.clientX, e.clientY);
        ultimoToque = agora;
    });
    // Girar o aparelho muda a caixa: sem redesenhar, sobra faixa sem tile.
    addEventListener('resize', () => { if (MapaLightbox.isOpen()) MapaLightbox.desenhar(); });
}

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

function openLightbox(urls, startIdx, newImageIdx, placeName, eDenuncia, place) {
    Lightbox.open(urls, startIdx, newImageIdx, placeName, eDenuncia, place);
}

// ── Excluir a foto aberta ─────────────────────────────────────────────────
//
// SEM diálogo de confirmação, por decisão do owner: a pessoa já fez três gestos
// deliberados pra chegar aqui (abrir a foto, navegar até ela, mirar num alvo
// pequeno), e perguntar de novo é desconfiar dela. No lugar entra a JANELA DE
// DESFAZER que a app já usa no swipe — que não desfaz depois, ADIA o envio.
//
// A janela respeita a preferência do editor, igual ao swipe. Quem a desligou
// paga o preço da própria escolha: a exclusão vai na hora, e não há volta —
// medimos que re-adicionar a foto não persiste (o Waze responde 200 com
// `synced: true` e ignora).
//
// A janela daqui NÃO usa o `AppState.pendingAction` do card, e isso é
// deliberado: lá a trava existe porque a próxima ação despacharia a anterior,
// mas prender ✕/↑/✓ por 3s porque alguém apagou uma foto no lightbox seria
// efeito colateral sem motivo.
let exclusaoPendente = null;   // { id, place, timer, enviar, desfazer }

// A lixeira vira spinner SÓ quando há espera de verdade — ou seja, no caminho
// SEM Desfazer. Com Desfazer a foto some na hora e nada foi enviado ainda:
// spinner ali seria mentira sobre uma espera que não existe, e ainda
// bloquearia excluir a PRÓXIMA foto, que passou a ocupar aquele botão.
function lixeiraOcupada(ligado) {
    const btn = document.getElementById('lightboxDelete');
    if (!btn) return;
    btn.disabled = ligado;
    btn.classList.toggle('lixeira-ocupada', ligado);
}

// Manda pro Waze de verdade. Se falhar, a foto VOLTA — mesma gramática do
// swipe, que reverte o placar quando o Waze recusa.
async function enviarExclusao(alvo) {
    try {
        const r = await API.excluirFoto(alvo.place.venueID, alvo.id, alvo.place.lat, alvo.place.lon);
        if (r && r.success) {
            // Sem toast de sucesso: a foto sumindo JÁ é a confirmação, e
            // anunciar o que a pessoa está vendo acontecer é ruído. O aviso
            // fica só pro caso em que nada muda na tela por causa dela.
            if (r.jaExcluida) showToast(t('toast.photoAlreadyGone'), 'info');
            return;
        }
        if (r && r.errorCategory === 'unauthorized') { handleUnauthorized(); return; }
        devolverFoto(alvo);
        showToast(msgDoServidor(r) || t('toast.photoDeleteFailed'), 'error');
    } catch (e) {
        devolverFoto(alvo);
        showToast(t('toast.photoDeleteFailed'), 'error');
    }
}

// Recoloca a foto onde estava — no desfazer e na falha do envio.
function devolverFoto(alvo) {
    const p = alvo.place;
    if (p && Array.isArray(p.imageUrls) && !p.imageUrls.some((u) => u.indexOf(alvo.id) !== -1)) {
        p.imageUrls.splice(Math.min(alvo.idx, p.imageUrls.length), 0, alvo.url);
        if (Array.isArray(p.approvedImageIds) && !p.approvedImageIds.includes(alvo.id)) p.approvedImageIds.push(alvo.id);
        p.imageUrl = p.imageUrls[0] || null;
    }
    if (Lightbox.place === p) Lightbox.recolocarFoto(alvo.url, alvo.idx);
    if (AppState.currentPlace === p) showCurrentPlace();
}

function pedirExclusaoDaFoto() {
    // Treino não escreve. Antes isto era garantido pelo DADO — os cards de
    // treino não tinham foto, então o lightbox nem abria. Com pedido real na
    // fila de treino essa proteção acidental some, e o `venueID` é REAL: sem
    // este guard, a lixeira apagaria uma foto do mapa enquanto a faixa promete
    // que nada é enviado. Proteção não pode depender de a fixture ser pobre.
    if (Treino.ativo) return;
    const id = Lightbox.idFotoAtual();
    if (!id) return;
    const place = Lightbox.place;
    const alvo = { id, place, idx: Lightbox.idx, url: Lightbox.urls[Lightbox.idx] };

    // Uma exclusão por vez: tocar na lixeira de novo despacha a anterior, como
    // o swipe faz. Sem isto, duas janelas correndo escreveriam listas que se
    // ignoram — a segunda apagaria só a dela, ressuscitando a primeira.
    if (exclusaoPendente) exclusaoPendente.enviar();
    // E a APROVAÇÃO pendente também: a foto recém-aprovada vira alvo da lixeira
    // no mesmo canto, e sem despachar antes as duas escritas cruzam — a
    // exclusão relê um local onde a foto ainda está pendente, monta a lista sem
    // ela, e aí a aprovação chega depois e a devolve. O editor mandou excluir e
    // a foto fica. Hoje o banner do Desfazer TAPA a lixeira (medido:
    // elementFromPoint devolve #undoBtn), mas isso é acidente de sobreposição —
    // se o banner mudar de lugar a proteção some sem ninguém notar.
    if (aprovacaoPendente) aprovacaoPendente.enviar();

    // Gate de experiência igual ao do swipe: a preferência salva como false só
    // vale se o editor qualifica (senão um legado de versão sem gate liberaria).
    const semJanela = AppState.preferences.undoEnabled === false && canDisableUndo();
    if (semJanela) {
        // Espera REAL: a chamada sai agora. Spinner no lugar da lixeira e a
        // foto só sai da tela quando o Waze confirmar.
        lixeiraOcupada(true);
        enviarExclusao(alvo).finally(() => {
            lixeiraOcupada(false);
            Lightbox.removerFoto(alvo.id);
            if (AppState.currentPlace === place) showCurrentPlace();
        });
        return;
    }

    // Com janela: a foto some JÁ (é o retorno imediato) e o envio espera.
    // A releitura é aquecida agora — os ~557ms dela cabem dentro da janela.
    API.prepararExclusao(place.venueID, place.lat, place.lon);
    Lightbox.removerFoto(alvo.id);
    if (AppState.currentPlace === place) showCurrentPlace();

    let saiu = false;
    const enviar = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(exclusaoPendente && exclusaoPendente.timer);
        if (exclusaoPendente && exclusaoPendente.id === alvo.id) exclusaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        enviarExclusao(alvo);
    };
    const desfazer = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(exclusaoPendente && exclusaoPendente.timer);
        if (exclusaoPendente && exclusaoPendente.id === alvo.id) exclusaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        devolverFoto(alvo);
    };
    const timer = setTimeout(enviar, UNDO_WINDOW_MS);
    exclusaoPendente = { id: alvo.id, place, timer, enviar, desfazer };
    aplicarTravaDeAcao();
    mostrarDesfazer(t('undo.photoDeleted'), () => exclusaoPendente && exclusaoPendente.desfazer());
}

// ── Aprovar a foto pendente ───────────────────────────────────────────────
//
// Espelho da lixeira, e de propósito: mesmo portão (L6+AM ou staff), mesma
// janela de Desfazer, mesma regra de que o envio só sai quando a janela fecha
// SOZINHA. O que muda é o sentido — aqui a foto passa a valer no mapa.
//
// Por que aprovar foto não fere a regra de ouro ("a app nunca aprova"): a regra
// existe porque aprovar dado de LOCAL exige ajuste no WME — nome, categoria,
// posição têm campo pra corrigir. Foto não tem: ou serve ou não serve, e a
// decisão está inteira na tela. Decisão do owner, a pedido de um global champ.
let aprovacaoPendente = null;

// O card fica na tela depois de aprovar (decisão do owner) e só avança quando o
// lightbox fechar. Sem isto, o pedido ficaria resolvido no Waze e pendurado na
// fila — e o ✓ seguinte devolveria "já tratado por outro editor", que é um
// toast confuso pra quem acabou de tratar ele mesmo.
let placeResolvidoPorAprovacao = null;

function estadoAprovando(ligado) {
    const btn = document.getElementById('lightboxApprove');
    const spin = document.getElementById('lightboxApproveSpinner');
    const ico = document.getElementById('lightboxApproveIcon');
    if (btn) btn.disabled = ligado;
    if (spin) spin.classList.toggle('hidden', !ligado);
    if (ico) ico.classList.toggle('hidden', ligado);
}

async function enviarAprovacao(alvo) {
    try {
        const r = await API.aprovarPedido(alvo.place.venueID, alvo.place.updateRequestID);
        if (r && r.success) {
            // Aprovar RESOLVE o pedido no Waze: é um pouso como o do ✕ e o do ✓.
            registrarPouso(alvo.place);
            // Sem toast de sucesso: o ✨ sumindo e o botão virando lixeira JÁ
            // dizem que valeu — mesma razão do excluir.
            placeResolvidoPorAprovacao = alvo.place;
            AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
            updateStats();
            // "Curador" conta CURADORIA SUA. O `already_processed` logo abaixo
            // é outro editor que aprovou antes — conta pro placar, não pra esta.
            contarConquista('fotos');
            return;
        }
        if (r && r.errorCategory === 'unauthorized') { handleUnauthorized(); return; }
        // `already_processed` conta como sucesso: outro editor aprovou antes, e
        // o objetivo de quem tocou foi cumprido (mesma lógica do resto da app).
        if (r && (r.errorCategory === 'already_processed' || r.errorCategory === 'not_found')) {
            registrarPouso(alvo.place);
            placeResolvidoPorAprovacao = alvo.place;
            AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
            updateStats();
            return;
        }
        Lightbox.desmarcarAprovada(alvo.id, alvo.idx);
        showToast(msgDoServidor(r) || t('toast.photoApproveFailed'), 'error');
    } catch (e) {
        Lightbox.desmarcarAprovada(alvo.id, alvo.idx);
        showToast(t('toast.photoApproveFailed'), 'error');
    }
}

// Avança o card cujo pedido foi aprovado — chamado ao fechar o lightbox.
// A aprovação em voo (janela do Desfazer aberta) é despachada antes: fechar o
// lightbox é sinal de que a pessoa terminou, e deixar a janela correndo com o
// card já fora da tela é pedir pra ela desfazer algo que não vê mais.
function avancarSeAprovado() {
    if (aprovacaoPendente) aprovacaoPendente.enviar();
    const alvo = placeResolvidoPorAprovacao;
    if (!alvo) return;
    placeResolvidoPorAprovacao = null;
    if (AppState.currentPlace !== alvo) return;   // a fila já andou por outro caminho
    advanceQueue();
}

function aprovarFotoAtual() {
    // Treino não escreve. Antes isto era garantido pelo DADO — os cards de
    // treino não tinham foto, então o lightbox nem abria. Com pedido real na
    // fila de treino essa proteção acidental some, e o `venueID` é REAL: sem
    // este guard, a lixeira apagaria uma foto do mapa enquanto a faixa promete
    // que nada é enviado. Proteção não pode depender de a fixture ser pobre.
    if (Treino.ativo) return;
    if (!Lightbox.podeAprovarAtual()) return;
    const place = Lightbox.place;
    const alvo = { id: place.updateRequestID, place, idx: Lightbox.idx };
    if (aprovacaoPendente) aprovacaoPendente.enviar();
    // Mesma razão do lado de lá: as duas escritas mexem no mesmo local, então
    // quem chega depois tem que ver o resultado de quem chegou antes.
    if (exclusaoPendente) exclusaoPendente.enviar();

    const semJanela = AppState.preferences.undoEnabled === false && canDisableUndo();
    if (semJanela) {
        estadoAprovando(true);
        enviarAprovacao(alvo).finally(() => {
            estadoAprovando(false);
            Lightbox.marcarComoAprovada(alvo.id);
        });
        return;
    }

    // Com janela: o ✨ some JÁ (é o retorno imediato) e o envio espera.
    Lightbox.marcarComoAprovada(alvo.id);
    let saiu = false;
    const enviar = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(aprovacaoPendente && aprovacaoPendente.timer);
        aprovacaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        enviarAprovacao(alvo);
    };
    const desfazer = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(aprovacaoPendente && aprovacaoPendente.timer);
        aprovacaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        Lightbox.desmarcarAprovada(alvo.id, alvo.idx);
    };
    aprovacaoPendente = { timer: setTimeout(enviar, UNDO_WINDOW_MS), enviar, desfazer };
    aplicarTravaDeAcao();
    mostrarDesfazer(t('undo.photoApproved'), () => aprovacaoPendente && aprovacaoPendente.desfazer());
}

// ── Renomear o local, do lightbox ──────────────────────────────────────────
//
// A ÚNICA escrita de dado de LOCAL da app, e o que a justifica é a natureza da
// decisão, não a conveniência: o editor está com a FACHADA ampliada na tela, que
// é prova primária do nome. E a alternativa não é decidir melhor no WME — é a
// MESMA gravação com uma ida e volta no meio. Medido no HAR do owner renomeando
// lá: o WME não busca duplicado, não valida convenção, não confere nada. Manda
// `{id, name}`.
//
// Portão: o mesmo dos outros destrutivos (`podeAgirComoL6Aqui`), e só do
// CLIENTE — o Waze valida `permissions`/`lockRank` na gravação, então quem não
// pode por aqui também não consegue por lá.
let renomeacaoPendente = null;   // { timer, enviar, desfazer }

function podeRenomearAqui() {
    // Mesmo portão da foto. Função própria (em vez de chamar a outra direto)
    // porque são DUAS decisões de produto que hoje coincidem: se um dia o owner
    // separar, o call site não muda.
    if (!podeAgirComoL6Aqui()) return false;
    const p = Lightbox.place;
    // v1 só CORRIGE nome existente. Batizar local sem nome é outra decisão (e
    // outra conversa) — sem isto, um toque acidental nomearia um lugar anônimo.
    if (!(p && p.venueID && String(p.name || '').trim())) return false;
    // O Waze RECUSA escrever atributo em local que ainda não existe no mapa —
    // MEDIDO com controle: mesmo payload, mesma sessão, `approved:false` → 406,
    // `approved:true` → 200. Oferecer aqui é beco sem saída: o editor abre a
    // foto, digita o nome certo, confirma e leva "Erro do Waze (HTTP 406)" —
    // que ainda por cima cai em `errorCategory: unknown`, o balde que reverte o
    // placar e mostra erro genérico.
    // Não é caso de canto: 711 de 2420 cards com nome (29%) estão em local não
    // aprovado nos 6 países obrigatórios, e 40% da fila do owner no Brasil.
    return p.localAprovado !== false;
}

function mostrarNomeNoLightbox() {
    const cx = document.getElementById('lightboxNome');
    if (!cx) return;
    const pode = podeRenomearAqui() && !Treino.ativo;
    cx.classList.toggle('hidden', !pode);
    // A dica de zoom mora no mesmo canto. Some pra quem tem a pílula — é editor
    // L6+AM, que já sabe dar zoom; pro resto ela continua lá.
    const dica = document.getElementById('lightboxZoomHint');
    if (dica) dica.classList.toggle('hidden', pode);
    if (!pode) { fecharEdicaoNome(); return; }
    const txt = document.getElementById('lightboxNomeTxt');
    if (txt) txt.textContent = Lightbox.place.name;
}

function abrirEdicaoNome() {
    if (!podeRenomearAqui() || Treino.ativo || acoesTravadas()) return;
    const cx = document.getElementById('lightboxNome');
    const nome = Lightbox.place.name;
    cx.classList.add('editando');
    // A pílula CONTINUA na tela, mostrando o nome antigo — é ela a referência
    // enquanto se digita. Vira RÓTULO: `disabled` tira do Tab e mata o clique,
    // e o lápis sai porque prometer ação onde não há é o que faz botão morto
    // parecer vivo. Isto substitui a linha "Antes:" que eu tinha posto embaixo:
    // o owner viu o nome DUAS vezes na tela e preferiu, com razão, ficar só com
    // a pílula — ela flutua sobre a foto e não custa altura de layout.
    const btn = document.getElementById('lightboxNomeBtn');
    btn.disabled = true;
    btn.querySelector('.lb-nome-lapis')?.classList.add('hidden');
    document.getElementById('lightboxNomeEdit').classList.remove('hidden');
    const inp = document.getElementById('lightboxNomeInput');
    inp.value = nome;
    // As ações de foto somem enquanto edita — mas quem decide é
    // `atualizarAcoesDeFoto()`, e não um esconder aqui: esconder aqui era um
    // disparo único, e a próxima troca de foto o desfazia.
    document.getElementById('imageLightbox').classList.add('editando-nome');
    atualizarAcoesDeFoto();
    inp.focus();
    // Cursor no FIM, não seleção: quem vem corrigir grafia quer ajustar, e
    // selecionar tudo faz a primeira tecla apagar o nome inteiro.
    try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { /* tipo sem seleção */ }
    atualizarBotaoSalvarNome();
}

function fecharEdicaoNome() {
    const cx = document.getElementById('lightboxNome');
    if (!cx) return;
    cx.classList.remove('editando');
    const btn = document.getElementById('lightboxNomeBtn');
    const ed = document.getElementById('lightboxNomeEdit');
    if (btn) {
        btn.disabled = false;
        btn.querySelector('.lb-nome-lapis')?.classList.remove('hidden');
    }
    if (ed) ed.classList.add('hidden');
    document.getElementById('imageLightbox').classList.remove('editando-nome');
    // Recalcula em vez de restaurar o que foi guardado: a foto pode ter mudado
    // durante a edição, e restaurar devolveria o estado da foto ERRADA.
    atualizarAcoesDeFoto();
}

function editandoNome() {
    const cx = document.getElementById('lightboxNome');
    return !!(cx && cx.classList.contains('editando'));
}

function atualizarBotaoSalvarNome() {
    const inp = document.getElementById('lightboxNomeInput');
    const ok = document.getElementById('lightboxNomeOk');
    if (!inp || !ok) return;
    const v = inp.value.trim();
    // Vazio ou igual ao atual não é renomeação. Botão morto com cara de vivo lê
    // como app quebrada, então ele fica `disabled` E esmaecido.
    ok.disabled = !v || v === String(Lightbox.place && Lightbox.place.name || '').trim();
}

function confirmarRenomear() {
    if (Treino.ativo || !podeRenomearAqui()) return;
    const inp = document.getElementById('lightboxNomeInput');
    const novo = inp ? inp.value.trim() : '';
    const place = Lightbox.place;
    const antigo = String(place.name || '').trim();
    if (!novo || novo === antigo) { fecharEdicaoNome(); return; }

    // As três escritas mexem no mesmo local: quem chega depois tem que ver o
    // resultado de quem chegou antes.
    if (renomeacaoPendente) renomeacaoPendente.enviar();
    if (aprovacaoPendente) aprovacaoPendente.enviar();
    if (exclusaoPendente) exclusaoPendente.enviar();

    fecharEdicaoNome();
    aplicarNomeNaTela(place, novo);      // retorno imediato; o envio espera

    const alvo = { place, antigo, novo };
    const semJanela = AppState.preferences.undoEnabled === false && canDisableUndo();
    if (semJanela) { enviarRenomeacao(alvo); return; }

    let saiu = false;
    const enviar = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(renomeacaoPendente && renomeacaoPendente.timer);
        renomeacaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        enviarRenomeacao(alvo);
    };
    const desfazer = () => {
        if (saiu) return;
        saiu = true;
        clearTimeout(renomeacaoPendente && renomeacaoPendente.timer);
        renomeacaoPendente = null;
        aplicarTravaDeAcao();
        removeUndoBanner();
        aplicarNomeNaTela(place, antigo);
    };
    renomeacaoPendente = { timer: setTimeout(enviar, UNDO_WINDOW_MS), enviar, desfazer };
    aplicarTravaDeAcao();
    mostrarDesfazer(t('undo.renamed', { nome: novo }), () => renomeacaoPendente && renomeacaoPendente.desfazer());
}

// O nome vive em três lugares e os três têm que andar juntos, senão o card diz
// uma coisa e o lightbox outra.
function aplicarNomeNaTela(place, nome) {
    place.name = nome;
    if (Lightbox.place === place) Lightbox.placeName = nome;
    const txt = document.getElementById('lightboxNomeTxt');
    if (txt && Lightbox.place === place) txt.textContent = nome;
    const card = cardDaFrente();
    if (card && AppState.currentPlace === place) {
        const el = card.querySelector('.card-name');
        if (el) el.textContent = nome;
    }
}

async function enviarRenomeacao(alvo) {
    try {
        const r = await callWithRetry(() => API.renomearLocal(alvo.place.venueID, alvo.novo));
        if (r && r.success) { contarConquista('nomes'); return; }   // sem toast: o nome na tela já diz
        if (r && r.errorCategory === 'unauthorized') { handleUnauthorized(); return; }
        // Falhou: o nome na tela precisa VOLTAR, senão a app afirma uma gravação
        // que não houve — e o editor segue triando achando que corrigiu.
        aplicarNomeNaTela(alvo.place, alvo.antigo);
        showToast(msgDoServidor(r) || t('toast.renameFailed'), 'error');
    } catch (e) {
        aplicarNomeNaTela(alvo.place, alvo.antigo);
        showToast(t('toast.renameFailed'), 'error');
    }
}

// Banner próprio, com a MESMA aparência e o mesmo tempo do Desfazer do card —
// é a mesma ideia, e duas gramáticas pro mesmo conceito é como o editor
// descobre que a app se contradiz.
function mostrarDesfazer(mensagem, aoDesfazer) {
    removeUndoBanner();
    const container = document.getElementById('undoContainer');
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'undo-banner';
    banner.innerHTML = `
        <span>${escapeHtml(mensagem)}</span>
        <button type="button" id="undoBtn">${escapeHtml(t('undo.button'))}</button>
        <span class="undo-progress" style="animation-duration: ${UNDO_WINDOW_MS}ms" aria-hidden="true"></span>
    `;
    container.appendChild(banner);
    document.getElementById('undoBtn').addEventListener('click', () => aoDesfazer());
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
    renderUndoGateUI();
    renderPresencaPref();
    renderPularGuardaPref();
    $('filterUnreadOnly').checked = AppState.filters.unreadOnly !== false;
    document.querySelectorAll('.filter-type').forEach(cb => {
        cb.checked = AppState.filters.types.includes(cb.value);
    });
    $('filterResidential').value = AppState.filters.residential;
    $('filterRegion').value = API.getRegion();

    populateManagedAreaSelect();
    $('filterMyArea').checked = AppState.filters.myArea;
    const disabled = AppState.filters.myArea;
    $('filterCountry').disabled = disabled;
    $('filterState').disabled = disabled;
    $('filterManagedArea').disabled = disabled;

    populateCategorySelect();
    popularOrdenacoes();
    const sortSel = $('filterSort');
    if (sortSel) sortSel.value = ordemValida(AppState.filters.sortOrder);
    atualizarDicaDeOrdem(sortSel && (sortSel.value === 'casa' || sortSel.value === 'trabalho') ? 'perfil'
        : (sortSel && sortSel.value === 'gps' ? 'ok' : null));
    renderHistory();

    // O modal ABRE AQUI, antes de qualquer rede. País e estado vêm do Waze e,
    // na PRIMEIRA abertura da sessão, são duas idas — MEDIDO com a app de pé:
    // o modal só aparecia aos 480ms em rede boa e aos 1337ms em rede ruim,
    // porque o `openModal` era a última linha de uma função `async`. O editor
    // tocava em Filtros e não acontecia NADA até o Waze responder duas vezes.
    // Da segunda abertura em diante era 80ms, porque as duas listas ficam em
    // cache de memória — daí a lentidão ser intermitente e difícil de nomear.
    //
    // Tudo que é síncrono já está pronto acima; só as duas listas chegam depois
    // e se preenchem sozinhas. Quem abre pra mexer em tipo, categoria, ordem ou
    // preferência não espera rede nenhuma.
    openModal('filtersModal');
    await popularPaisEstado();
}

// As duas listas que vêm do Waze. Fora do `openFiltersModal` porque ele agora
// só as AGENDA — e porque um erro aqui não pode impedir o modal de abrir.
async function popularPaisEstado() {
    const select = document.getElementById('filterCountry');
    // Enquanto não chega, o seletor diz o que está havendo em vez de ficar
    // vazio: seletor vazio parece defeito, e o editor toca de novo.
    const carregando = AppState.countries.length === 0;
    if (carregando && select) {
        select.innerHTML = `<option value="">${escapeHtml(t('filters.carregando'))}</option>`;
        select.disabled = true;
    }
    try {
        if (AppState.countries.length === 0) {
            const r = await API.listCountries();
            if (r.success) AppState.countries = r.countries;
        }
        populateCountrySelect();
        await loadStatesIntoSelect(API.getCountry());
    } finally {
        // O `myArea` marcado desabilita os três de propósito (regra de cima);
        // fora isso, devolve o seletor ao editor mesmo se a rede falhou.
        if (select) select.disabled = !!AppState.filters.myArea;
    }
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

    // A foto dos filtros de BUSCA antes de qualquer mutação: é ela que decide,
    // no fim, se dá pra reordenar no aparelho ou se é preciso ir ao Waze.
    const buscaAntes = assinaturaDeBusca();

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
    if (AppState.filters.types.length === 0) AppState.filters.types = TYPES_PADRAO.slice();
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
    AppState.filters.sortOrder = ordemValida($('filterSort') && $('filterSort').value);
    saveFilters();
    closeModal('filtersModal');
    // A sala É a fila: mudou país ou estado, a companhia é outra.
    window.Presenca?.sincronizar?.();

    // Trocar SÓ a ordem não é motivo pra ir ao Waze: ordenar é 100% no
    // aparelho (`sortQueue` é client-side, e o comentário dele já dizia isso).
    // Antes, qualquer Aplicar caía em `resetQueue` + `startFetching`, e isso
    // custava duas coisas: uma requisição e ~1–2 MB de resposta contra o free
    // tier, e os pedidos PULADOS voltavam — o skip não os marca no Waze, então
    // a fila refeita os traz de novo. Quem só queria outra ordem via a app
    // travar, recarregar e devolver o que ele tinha empurrado pra frente.
    if (assinaturaDeBusca() === buscaAntes && AppState.queue.length) {
        reordenarFilaNaTela();
        return;
    }
    resetQueue();
    startFetching();
}

// O que decide se é preciso RE-BUSCAR. Tudo de `filters` MENOS a ordem, mais
// região e país — e por exclusão de propósito: filtro novo entra aqui sozinho,
// enquanto uma lista de inclusão silenciaria a re-busca no dia em que alguém
// esquecesse de somar o campo dele. As chaves são ordenadas porque a ordem de
// inserção do objeto não é contrato.
function assinaturaDeBusca() {
    const { sortOrder, ...doServidor } = AppState.filters;
    const chaves = Object.keys(doServidor).sort();
    return JSON.stringify([chaves.map((k) => [k, doServidor[k]]), API.getRegion(), API.getCountry()]);
}

// Reordena e mostra o novo topo. O card na tela TROCA, e isso é o certo: a
// pessoa pediu outra ordem, então o primeiro da fila é outro. O que não pode é
// reordenar por baixo do card e deixar `currentPlace` e `queue[0]` diferentes —
// é o mesmo cuidado do `fetchNextPage`, e é ele que mantém o aquecimento
// mirando no card que vem (o `showCurrentPlace` reagenda em cima do novo topo).
function reordenarFilaNaTela() {
    sortQueue();
    AppState.currentPlace = AppState.queue[0];
    removeCurrentCardEl();
    showCurrentPlace();
    updatePendingCount();
}

// Teclas que pertencem ao CURSOR quando o foco está num campo de texto.
const TECLAS_DE_CURSOR = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

function focoEmCampoDeTexto() {
    const el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    // Checkbox e botão não consomem seta; campo de texto (e range) consomem.
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(
        String(el.type || 'text').toLowerCase());
}

function handleKeyDown(e) {
    // Foco num campo de texto: as setas são do CURSOR, não da app.
    //
    // Relatado pelo owner renomeando um local: usar ← → pra corrigir uma letra
    // TROCAVA A FOTO, e o `preventDefault()` do lightbox ainda matava o
    // movimento do cursor — as duas coisas erradas de uma vez.
    //
    // A guarda já existia, mas lá embaixo, DEPOIS do bloco do lightbox — que
    // retorna antes de chegar nela. Ela nasceu pro card e o lightbox foi
    // acrescentado por cima; o buraco é a ordem, não a falta.
    //
    // Só as teclas de cursor: Esc e Tab seguem passando, porque têm significado
    // de CAMADA (fechar, navegar) e o campo do nome já trata o Esc dele.
    if (focoEmCampoDeTexto() && TECLAS_DE_CURSOR.includes(e.key)) return;

    // O mapa ampliado é a camada MAIS alta quando aberto: Esc e ↓ fecham ele
    // antes de qualquer outra coisa, como o lightbox de foto faz.
    if (typeof MapaLightbox !== 'undefined' && MapaLightbox.isOpen()) {
        if (e.key === 'Escape' || e.key === 'ArrowDown') { e.preventDefault(); MapaLightbox.close(); }
        else if (e.key === '+' || e.key === '=') { e.preventDefault(); MapaLightbox.zoom(1); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); MapaLightbox.zoom(-1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); MapaLightbox.arrastar(80, 0); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); MapaLightbox.arrastar(-80, 0); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); MapaLightbox.arrastar(0, 80); }
        return;
    }
    if (Lightbox.isOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); Lightbox.close(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); Lightbox.prev(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); Lightbox.next(); }
        // ↓ fecha, espelhando o arraste pra baixo do toque. Relato do owner:
        // aprendeu o gesto no celular, sentou no laptop e a mão foi pro ↓ —
        // o modelo mental funcionando e a app não correspondendo.
        //
        // Só BAIXO, porque é só o que o toque faz (`dy > 80`); inventar ↑ aqui
        // criaria um gesto que o celular não tem. E é caminho ADICIONAL: o Esc
        // continua sendo o principal, que é a convenção de desktop — por isso
        // a dica não muda de texto (decisão do owner: um texto só, não um
        // catatau por plataforma).
        else if (e.key === 'ArrowDown') { e.preventDefault(); Lightbox.close(); }
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
        desfazerAcaoPendente();
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
    // A aposta do script inline do <head> era otimista (havia token no
    // aparelho). Se chegamos aqui, ela estava errada — token vencido, logout,
    // pareamento. Tirar a marca devolve o comando às classes `hidden`, que a
    // partir do JS são a única fonte de verdade.
    document.documentElement.classList.remove('tem-sessao');
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');
    document.getElementById('filtersBtn').classList.add('hidden');
    document.getElementById('refreshBtn').classList.add('hidden');
    document.getElementById('userProfileBadge').classList.add('hidden');
    const brandTitle = document.getElementById('brandTitle');
    if (brandTitle) brandTitle.classList.remove('sr-only'); // volta visível ao deslogar
    AppState.authenticated = false;
    AppState.profile = null;
    // Deslogado não tem crachá, então não tem sala. Fecha o socket na hora em
    // vez de deixar a conexão viva com uma sessão que já não vale.
    window.Presenca?.desligar?.();
}

function showMainScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('filtersBtn').classList.remove('hidden');
    document.getElementById('refreshBtn').classList.remove('hidden');
    AppState.authenticated = true;   // o selo lê isto; o resto da função repete abaixo
    atualizarSeloDeConquista();
    AppState.authenticated = true;
    updateDevBadge();
    // A sala só faz sentido logado: é o crachá do WME que abre a porta.
    window.Presenca?.sincronizar?.();
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
            guardarPrazoDaSessao(result);
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
        guardarReferencias(profileRes);
        guardarPerfilDoPortao(profileRes.profile);
        guardarPrazoDaSessao(profileRes);
        renderProfileHeader();
        presencaWmeAoCarregarPerfil(profileRes.visivelNoWme);
    }
    if (countriesRes.success) {
        AppState.countries = countriesRes.countries;
    }
}

// UM 401 não é prova de que a sessão morreu — e tratar como se fosse era o
// caminho mais curto pro editor cair na tela de login sem ter pedido pra sair.
//
// Três coisas chegam aqui como 401 e só UMA delas exige entrar de novo:
//   · o Waze recusou os cookies de verdade (expiraram)           → é pra sair
//   · o Waze devolveu 403 por rajada/WAF                          → passageiro
//   · o KV devolveu vazio num blip de propagação                  → passageiro
// O core já manda chaves diferentes (`srv.err.cookiesExpired` × `sessionExpired`),
// mas nenhuma delas distingue passageiro de definitivo — só uma segunda
// chamada distingue.
//
// Então confirma antes de derrubar: espera um pouco e pergunta o perfil. Se
// responder, a sessão está viva e nada é apagado. Custa ~1s no caso em que os
// cookies morreram MESMO, e evita o logout falso no caso em que não morreram.
let verificandoSessao = false;

// Recompõe a fila depois de uma falha que NÃO era sessão morta.
//
// Existe porque `startFetching()` sozinho NÃO recompõe nada, e é isso que
// produziu a tela do owner ("Tudo limpo!" sobre 217 pedidos pendentes): a busca
// que falhou deixa `hasMore: false`, e o laço do `startFetching` é GUARDADO por
// `hasMore` — ou seja a "retentativa" não busca coisa nenhuma, só zera o
// `loadError` e desenha o painel de fila vazia. Os dois caminhos de
// recomposição (alarme falso do 401, e renovação pela extensão) chamavam
// `startFetching()` cru. O botão "Tentar novamente" nunca caiu nisto porque ele
// passa antes pelo `resetQueue`, que repõe `hasMore` — foi o que escondeu o
// defeito: testar pelo botão dava certo.
//
// `loadError` é o que distingue "a fila esvaziou por FALHA" de "a fila acabou
// de verdade". Sem essa distinção, forçar `hasMore` gastaria uma requisição a
// mais toda vez que o backlog tivesse realmente zerado — e a app roda no free
// tier, onde requisição é recurso contado.
const MAX_REBUSCAS_AUTO = 2;
let rebuscasAuto = 0;

function rebuscarDepoisDeFalha() {
    if (AppState.queue.length > 0 || AppState.fetching) return;
    // Fila vazia SEM falha: não há o que repor, e o `startFetching` vai só
    // pintar o "Tudo limpo!" — que aí é verdade.
    if (!AppState.loadError) { startFetching(); return; }
    // TETO, e ele não é preciosismo: sem isto o desenho é um laço de requisição
    // (falha → confere → alarme falso → rebusca → falha…). Estourado o teto, o
    // erro FICA na tela com o botão de tentar de novo — honesto, e quem decide
    // gastar a próxima requisição é a pessoa.
    if (rebuscasAuto >= MAX_REBUSCAS_AUTO) return;
    rebuscasAuto++;
    AppState.hasMore = true;
    startFetching();
}

// ── Diário técnico do modo dev ────────────────────────────────────────────
//
// Modelo trazido do botequei (projeto do owner), onde ele já tinha resolvido o
// problema que eu ia apresentar como novidade. Duas ideias vieram de lá e são o
// que fazem isto funcionar:
//
//  1. COBERTURA POR FUNIS, não remendo em 200 lugares. Instrumentar cada call
//     site envelhece: o próximo recurso nasce sem log e ninguém percebe. Em vez
//     disso a instrumentação mora nos ESTRANGULAMENTOS por onde tudo passa —
//     `showToast`, `openModal`, a barra de ações, o `fetchNextPage`, o
//     `handleUnauthorized`. Recurso novo já nasce coberto.
//
//  2. O DIÁRIO DE TELA É O "PRINT TEXTUAL". Página web não tira foto dos
//     próprios pixels no Android (o `getDisplayMedia` não existe lá, e o resto
//     exige biblioteca e quebra na CSP). A jornada de telas + os toasts contam
//     o que a pessoa viu, e valem mais que uma imagem quase certa.
//
// O QUE ISTO CONSERTA, com evidência do dia em que nasceu: o botão de baixar
// ficava dentro de Filtros → Preferências. Pra apertá-lo era preciso abrir dois
// modais POR CIMA da tela com defeito — e o toast, que dura 4s, já tinha
// sumido. O diagnóstico do owner chegou com `loadErrorState` visível e ZERO
// toast no DOM, justamente perdendo a evidência ("Conexão instável") que
// derrubou a hipótese errada. Instrumento que não alcança o momento do defeito
// não é instrumento.
//
// CUSTO ZERO DESLIGADO: `dlog` sai na primeira linha. Nada de closure, nada de
// objeto criado, nada de `JSON.stringify` — a app tem 200 swipes por sessão e o
// valor dela é o ritmo.
const DLOG_TETO = 800;
// 3: entraram `resumo.alertas` (sentinelas) e a seção `computado` — a camada
// que o navegador decidiu, que o `dom` não mostra. Aditivo: leitor de formato 2
// só ignora as chaves novas.
const DIAG_FORMATO = 3;
let dlogAnel = [];

function dlogLigado() {
    return typeof AppState !== 'undefined' && !!(AppState.devMode && AppState.devMode.active);
}

// `k` é a CHAVE do evento (curta, estável, greppável). `d` é o que importa
// daquele evento — nunca o objeto inteiro de onde ele saiu.
function dlog(k, d) {
    if (!dlogLigado()) return;
    try {
        dlogAnel.push({ t: Date.now(), k, ...(d || {}) });
        if (dlogAnel.length > DLOG_TETO) dlogAnel.shift();
    } catch (e) {}
}

// ── O anel que NÃO tem portão ─────────────────────────────────────────────
//
// MEDIDO nos 7 diagnósticos reais recebidos até 2026-09-10: **4 chegaram com o
// diário VAZIO**, e o pior é justamente o dos modais achatados no iOS — anel de
// chamadas CHEIO (60, ou seja muita atividade) e `diario: []`. O motivo é
// estrutural, não descuido: o `dlog` sai na primeira linha com o modo dev
// desligado, e a pessoa só liga o modo dev DEPOIS de o problema acontecer. O
// instrumento apagava exatamente o trecho que interessa.
//
// Tem uma ironia que fecha o argumento: o `diagCapturarErros()` roda
// incondicionalmente no `initApp`, e lá dentro registra um observador de long
// task que chama `dlog('lenta', …)`. Ou seja, a captura sempre-ligada alimentava
// um anel com portão — o dado de travada era jogado fora exatamente quando
// ninguém estava gravando.
//
// **O portão do `dlog` continua valendo, e por CUSTO**: a app tem ~200 swipes
// por sessão e o valor dela é o ritmo. Por isso este anel é só o subconjunto que
// sai de graça, e o critério de entrada é duplo:
//   1. **RARO** — nada que aconteça uma vez por swipe. Modal abre, tela gira,
//      teclado sobe, busca falha: acontecem unidades de vezes por sessão.
//   2. **SEM DADO DE TERCEIRO** — nome de local, nome de autor e texto livre não
//      entram aqui nem com o modo dev ligado. Só id de elemento nosso, número e
//      chave de erro. O `dlog` segue sendo o lugar do que identifica pedido.
// Teto de 120 × ~40 bytes ≈ 5 KB. `API.chamadas` é o precedente: nunca teve
// portão, e é por isso que é a única coisa que sobrevive num relato de 1ª hora.
const DFATO_TETO = 120;
let dfatoAnel = [];

function dfato(k, d) {
    try {
        dfatoAnel.push({ t: Date.now(), k, ...(d || {}) });
        if (dfatoAnel.length > DFATO_TETO) dfatoAnel.shift();
    } catch (e) {}
}

// ── DIÁRIO DE SESSÕES: o que sobrevive ao tombo ──────────────────────────
//
// O `dfato` já é o anel sem portão, mas ele vive em MEMÓRIA — e a sessão cair
// é justamente o evento depois do qual o editor fecha a app. Quando ele volta
// pra gerar o diagnóstico, o anel está vazio: o mesmo buraco que fez o `dfato`
// nascer ("4 dos 7 diagnósticos chegaram com `diario: []`"), agora no evento
// mais caro que a app tem.
//
// Daí este anel em localStorage. Ele existe pra responder UMA pergunta que
// hoje depende da memória de quem relata — *"quanto tempo a sessão durou?"* —
// trocando "acho que uns dois dias" por dois carimbos de data.
//
// Regras de entrada, as mesmas do `dfato` e por isso mesmo: (a) RARO — entrar,
// cair e o prazo MUDAR, nunca por swipe, senão volta o custo de escrita que o
// gotcha do localStorage mede em quadros perdidos; (b) SEM DADO DE TERCEIRO e
// sem token: só instante, evento, caminho de entrada e a chave do motivo.
//
// Sai no "Sair", com o resto (contrato de privacidade). Isso não cega a
// investigação: quem deu Sair SABE que deu, e o caso que se investiga é o de
// quem NÃO saiu e perdeu a sessão assim mesmo.
const SESSOES_KEY = 'waze_places_sessoes';
const NASCIMENTO_KEY = 'waze_places_nascimento';
const SESSOES_TETO = 40;

function lerDiarioDeSessoes() {
    try {
        const v = JSON.parse(safeLS.get(SESSOES_KEY) || '[]');
        return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
}

function registrarEventoDeSessao(e, d) {
    try {
        const anel = lerDiarioDeSessoes();
        anel.push({ t: Date.now(), e, ...(d || {}) });
        while (anel.length > SESSOES_TETO) anel.shift();
        safeLS.set(SESSOES_KEY, JSON.stringify(anel));
    } catch (err) { /* armazenamento cheio/bloqueado: o diário é instrumento, nunca requisito */ }
}

// A sessão pode já estar ativa quando este registro começou a existir — e esse
// é o caso de TODO aparelho no dia do deploy, inclusive o dos testadores que
// vão relatar. `API.getSession()` lê o token do armazenamento SEM passar pelo
// `setSession`, que é onde o gancho mora, então a abertura não carimba nada: o
// `caiu` chega sozinho, sem início, e a duração — que é o produto inteiro desta
// seção — sai vazia justamente no primeiro relato.
//
// Marco PRÓPRIO, e não `token+`: "já estava ativa" NÃO é "entrou agora". A
// duração contada daí é um PISO ("pelo menos tanto"), nunca a medida — chamar
// os dois de entrada seria inventar um número, que é pior que não ter nenhum.
//
// Só registra quando NÃO há início em aberto, senão viraria uma linha por
// abertura da app e quebraria a regra de entrada do diário (raro, nunca por
// gesto repetido).
function marcarSessaoJaAtiva() {
    try {
        if (!safeLS.get('waze_session_token')) return;
        const anel = lerDiarioDeSessoes();
        for (let i = anel.length - 1; i >= 0; i--) {
            const e = anel[i].e;
            if (e === 'token+' || e === 'jaAtiva') return;          // já há início em aberto
            if (e === 'token-' || e === 'caiu' || e === 'saiu') break;  // o último ciclo fechou
        }
        registrarEventoDeSessao('jaAtiva');
    } catch (e) { /* instrumento nunca atrapalha a abertura */ }
}

// Quando esta app rodou pela PRIMEIRA vez NESTE armazenamento. É o detector de
// apagamento pelo navegador, e ele funciona por CONTRADIÇÃO: o Safari apaga
// todo o storage script-writable após 7 dias sem interação (webkit.org, e web
// app na tela inicial é ISENTA — tem contador próprio). Quando isso acontece o
// diário some junto, então a evidência não pode ser só o diário: um carimbo de
// ontem num aparelho onde a pessoa diz usar a app há um mês É o apagamento.
function nascimentoDoArmazenamento() {
    try {
        const v = Number(safeLS.get(NASCIMENTO_KEY));
        if (Number.isFinite(v) && v > 0) return v;
        const agora = Date.now();
        safeLS.set(NASCIMENTO_KEY, String(agora));
        return agora;
    } catch (e) { return null; }
}

// O `API.setSession` é o ponto ÚNICO por onde o token entra e sai do
// armazenamento, e o gancho mora LÁ de propósito: perseguir os call sites um a
// um é como se perde o próximo caminho de entrada que alguém adicionar (a
// mesma lição do gotcha #39 — persiga o CONCEITO, não o lugar). Aqui fica o
// fato BRUTO; quem sabe o motivo (caiu? saiu?) registra à parte, logo depois.
if (typeof window !== 'undefined') window.__sessaoEvento = registrarEventoDeSessao;

// Identidade de pedido no diário: `creatorId` (número) e NUNCA `createdBy`.
// O nome é dado de terceiro e o id resolve a mesma pergunta — é a mesma regra
// que a reincidência já segue (o nome muda, o id não).
function dlogPlace(p) {
    if (!p) return null;
    return { v: p.venueID, ur: p.updateRequestID, tipo: p.purType, autor: p.creatorId ?? null };
}

// ── Watchdog: o que NÃO volta no prazo ────────────────────────────────────
// Ideia do botequei, onde flagrou o `getCurrentPosition` preso no prompt. Aqui
// o alvo é a fila congelada: `fetching` que fica true, ação pendente que nunca
// executa, promessa de busca que não resolve. Nenhum desses grita — a tela só
// para, e "parece que acabou o trabalho" ninguém reporta.
const dlogPendencias = new Map();
function dlogVigiar(o, ms = 20000) {
    if (!dlogLigado()) return;
    if (dlogPendencias.has(o)) clearTimeout(dlogPendencias.get(o));
    dlogPendencias.set(o, setTimeout(() => {
        dlogPendencias.delete(o);
        dlog('pendurada', { o, ms });
    }, ms));
}
function dlogVoltou(o) {
    const h = dlogPendencias.get(o);
    if (h) { clearTimeout(h); dlogPendencias.delete(o); }
}

// ── Momentos: o que a pessoa via ──────────────────────────────────────────
// Cada toque no FAB congela UM momento. O código, os caches e o ambiente NÃO
// entram aqui — eles são iguais em todos e vão uma vez só no relatório. Sem
// isso, cada captura repetiria ~600 KB e o arquivo viraria intransportável.
let dlogMomentos = [];
const DLOG_MAX_MOMENTOS = 12;

// Teto POR MOTIVO, só pro que acontece por uso normal. Motivo que só dispara
// quando algo deu errado (erro de JS, alarme falso de sessão) não entra aqui:
// ali o anel inteiro é pouco. O arraste é o oposto — é o gesto central da app,
// e sem cota ele toma as 12 vagas sozinho.
// DOIS e não um: o primeiro arraste da sessão raramente é o que interessa, e
// com dois sobra o mais recente, que é o que a pessoa acabou de ver.
const DLOG_COTA_POR_MOTIVO = { 'auto:arraste': 2 };

function dlogTelaAtual() {
    // `offsetParent` NÃO serve aqui: ele é `null` para elemento `position:
    // fixed`, e TODO modal desta app é fixed. Com ele, `modais` vinha sempre
    // vazio — ou seja a capacidade central do FAB (registrar EM CONTEXTO, com o
    // modal por cima) não capturava o contexto, em silêncio. Pego pelo teste
    // ponta a ponta, que abria a Ajuda antes de tocar e cobrava o modal na
    // lista. Aqui vale o que decide o pixel: a classe, o `display` computado e
    // uma caixa com tamanho.
    const visivel = (id) => {
        const e = document.getElementById(id);
        if (!e || e.classList.contains('hidden')) return false;
        if (getComputedStyle(e).display === 'none') return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const modais = (typeof MODAL_IDS !== 'undefined' ? MODAL_IDS : []).filter(visivel);
    return {
        tela: visivel('authScreen') ? 'entrar' : (visivel('appScreen') ? 'app' : '?'),
        painel: visivel('loadErrorState') ? 'falhaAoCarregar'
              : visivel('noMoreCards') ? 'tudoLimpo'
              : visivel('loadingCard') ? 'carregando'
              : cardDaFrente() ? 'card' : 'nada',
        // O `painel` diz só a camada de CIMA. No relato de 2026-09-22 ele
        // disse "carregando" com um card montado por baixo, e a captura não
        // tinha como contar o resto — este campo conta.
        cardMontado: !!cardDaFrente(),
        modais,
        // Era `visivel('lightbox')`, e esse id NÃO EXISTE (os dois são
        // `imageLightbox` e `mapaLightbox`): o campo saiu `false` em TODO
        // momento de todo relatório, com o lightbox aberto ou não. É a mesma
        // falha que o comentário do FAB já registra ("escrevi `lightbox` e o
        // elemento se chama `imageLightbox`") — id errado num seletor some com
        // o dado SEM DIZER NADA. `test/diagnostico.test.mjs` cobra que todo id
        // consultado aqui exista no HTML.
        lightbox: visivel('imageLightbox') ? 'foto' : (visivel('mapaLightbox') ? 'mapa' : false),
    };
}

// ── REDE e OFFLINE no instante da captura ─────────────────────────────────
// O relato de 2026-09-22 foi TODO sobre a falta de rede, e nenhuma captura
// dizia se havia rede: a janela sem sinal foi reconstruída de 16 "Failed to
// fetch" e da fila de saída abrindo e fechando. E o estado do offline (a janela
// que monta a URL da foto, o resultado da varredura) morava em variáveis que
// não iam pro arquivo — a janela foi deduzida do sufixo das URLs. Duas funções
// baratas e síncronas, sem dado de ninguém.
function diagRedeAgora() {
    const c = navigator.connection || {};
    return { online: navigator.onLine, tipo: c.effectiveType || null };
}

function diagOfflineAgora() {
    try {
        return { ligado: offlineLigado(), janelaServida: offlineJanelaServida,
                 janelaAtual: Math.floor(Date.now() / OFFLINE_CICLO_MS),
                 resultado: offlineUltimoResultado, varrendo: offlineVarrendo };
    } catch (e) { return { erro: String((e && e.message) || e).slice(0, 120) }; }
}

// ── A camada COMPUTADA: o que o NAVEGADOR decidiu ─────────────────────────
// O diagnóstico já trazia o que a página É (`dom`) e o que a app ACHA
// (`AppState`). Faltava a terceira: o que o navegador decidiu. Bug de layout
// mora inteiro aí, e ela não se lê do `outerHTML`.
//
// Custou uma investigação inteira: o `--kb-inset` cravado em 388px no PWA do
// iOS (v2026.09.09-02). O valor que decidia era `visualViewport.height`, que
// NÃO era capturado — cheguei nele por sorte, porque o `--kb-inset` estava num
// `style=` inline do `<html>` e veio de carona no `dom`. E o segundo fato
// decisivo, que NADA estava focado, não estava no arquivo de jeito nenhum.
// A geometria do modal eu tive que reconstruir extraindo quadros do vídeo do
// editor com ffmpeg e medindo pixel a pixel — sendo que é um
// `getBoundingClientRect()`, 40 bytes de JSON.
//
// Nada aqui é dado de terceiro: são números da janela e do layout.
function diagComputado() {
    const fora = {};
    try {
        const vv = window.visualViewport;
        fora.janela = { innerW: window.innerWidth, innerH: window.innerHeight,
                        outerW: window.outerWidth, outerH: window.outerHeight };
        fora.visualViewport = vv ? {
            w: Math.round(vv.width), h: Math.round(vv.height),
            offsetTop: Math.round(vv.offsetTop) || 0, offsetLeft: Math.round(vv.offsetLeft) || 0,
            escala: Number(vv.scale.toFixed(3)),
            // A subtração JÁ FEITA — é ela que vira `--kb-inset`, e é ela que
            // mentiu. Deixar pra quem lê refazer a conta é deixar o erro passar.
            coberto: Math.round(window.innerHeight - vv.height - vv.offsetTop),
        } : null;

        const a = document.activeElement;
        fora.foco = a ? {
            tag: a.tagName, id: a.id || null, tipo: a.getAttribute && a.getAttribute('type'),
            emModal: !!(a.closest && a.closest('.modal-root')),
            abreTeclado: (typeof campoDeTextoFocado === 'function') ? campoDeTextoFocado() : null,
        } : null;

        // Lidas do COMPUTADO, nunca do atributo inline: o atributo é o que
        // alguém escreveu, o computado é o que vale.
        const cs = getComputedStyle(document.documentElement);
        fora.varsCss = {};
        for (const v of ['--kb-inset', '--header-h', '--linha-comentario', '--lb-tira']) {
            const t = cs.getPropertyValue(v).trim();
            if (t) fora.varsCss[v] = t;
        }
        // As safe-areas do iPhone RESOLVIDAS. `env()` não se lê direto — só
        // medindo um elemento que as use. Sem isto, a altura do header no iOS
        // só se adivinha.
        fora.safeArea = medirSafeArea();

        fora.media = {};
        for (const q of ['(pointer: coarse)', '(prefers-reduced-motion: reduce)',
                         '(orientation: portrait)', '(display-mode: standalone)',
                         '(prefers-color-scheme: dark)']) {
            fora.media[q] = matchMedia(q).matches;
        }

        fora.tema = {
            htmlClasse: document.documentElement.className,
            guardado: safeLS.get(THEME_KEY),
        };

        fora.camadasAbertas = diagCamadasAbertas().map((e) => e.id || e.className.slice(0, 40));
        fora.geometria = diagGeometria();
        // A foto do card da FRENTE: o aviso de "precisa de sinal" está lá, e a
        // foto carregou? Os dois juntos são o defeito do relato de 2026-09-22
        // (ver a sentinela `fotoEscondidaComAviso`). Só o da frente: o de fundo
        // é clone e não tem ouvinte nenhum.
        const frente = cardDaFrente();
        const foto = frente && frente.querySelector('.card-image');
        fora.fotoDaFrente = frente ? {
            aviso: !!frente.querySelector('.card-sem-foto'),
            carregada: !!(foto && foto.complete && foto.naturalWidth > 0),
            src: foto ? String(foto.currentSrc || foto.src || '').slice(0, 160) : null,
        } : null;
        fora.tilesGuardadosQueFalharam = diagTilesGuardadosQueFalharam.slice(-5);
        // O esqueleto de "carregando" e o card da frente, cada um por si: o
        // `painel` do `dlogTelaAtual` diz só o de CIMA ("carregando"), e foi
        // assim que o relato de 2026-09-22 chegou sem dizer que havia um card
        // montado por baixo (ver a sentinela `esqueletoSobreCard`). Classe E
        // caixa, a mesma régua do `visivel` de lá.
        const esq = document.getElementById('loadingCard');
        const rEsq = esq && esq.getBoundingClientRect();
        fora.telaDoCard = {
            esqueleto: !!(esq && !esq.classList.contains('hidden') && rEsq.width > 0 && rEsq.height > 0),
            card: !!frente,
        };
        // Pedido que já está esperando envio e voltou pra fila de pedidos: o
        // defeito do relato de 2026-09-22 (ver `semOsJaDecididos` e a sentinela
        // `pedidoDecididoNaFila`). Vai só a CONTAGEM — a chave é id de pedido
        // de terceiro, e o conteúdo da fila de saída já está no localStorage.
        const naSaida = new Set(carregarFilaDeSaida().map(chaveDoPedido).filter(Boolean));
        fora.decididos = {
            naSaida: naSaida.size,
            naFila: (AppState.queue || []).filter((p) => naSaida.has(chaveDoPedido(p))).length,
        };
    } catch (e) {
        fora._erro = String((e && e.message) || e).slice(0, 160);
    }
    return fora;
}

// `env(safe-area-inset-*)` não é legível por API. O jeito é pedir ao próprio
// navegador: um elemento fora da tela cujo padding SÃO os env(), e então
// `getComputedStyle` devolve os px resolvidos.
function medirSafeArea() {
    let d = null;
    try {
        d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;'
            + 'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);'
            + 'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
        document.body.appendChild(d);
        const c = getComputedStyle(d);
        return { top: parseFloat(c.paddingTop) || 0, right: parseFloat(c.paddingRight) || 0,
                 bottom: parseFloat(c.paddingBottom) || 0, left: parseFloat(c.paddingLeft) || 0 };
    } catch (e) {
        return null;
    } finally {
        if (d && d.parentNode) d.parentNode.removeChild(d);
    }
}

// A tabela que eu meço À MÃO em toda investigação de layout. `rect` diz onde a
// coisa FICOU (o que a tela deu), e `scrollHeight/clientHeight` + o `overflow-y`
// COMPUTADO dizem se ela rola ou se está cortada — que são coisas diferentes e
// `scrollHeight > clientHeight` é verdadeiro nas DUAS (gotcha #29).
const DIAG_ALVOS = ['.place-card:not(.card-fundo)', '.card-fundo', '.card-content', '.card-changes', '.card-flag-comment',
                    // O mapa entrou em v2026.09.21-05, e a razão é uma falha do
                    // próprio instrumento: o owner relatou o mapa do card de
                    // fundo mudando de tamanho ao virar frente, e o diagnóstico
                    // dele NÃO tinha como mostrar isso. A geometria já media os
                    // dois cards lado a lado, mas nenhuma coluna distinguia o
                    // caso — as CAIXAS sempre bateram; o que divergia era o
                    // ENQUADRAMENTO (`data-mapa-w/h`), que só existia no `dom`
                    // cru de 140 KB. Dado que só está no HTML é dado que
                    // ninguém procura sem já saber a resposta.
                    '.card-map:not(.hidden)',
                    '#cardStack', '#placar', 'header', '.modal-root:not(.hidden) > div',
                    '#imageLightbox:not(.hidden)', '#devFab:not(.hidden)',
                    '.card-btn-reject', '.card-btn-skip', '.card-btn-read'];
// Modal e lightbox ABERTOS. Camada aberta cobre o que está atrás — é a função
// dela —, e sem saber disso o hit-test acusa o normal como defeito.
function diagCamadasAbertas() {
    const ids = [...(typeof MODAL_IDS !== 'undefined' ? MODAL_IDS : []), 'imageLightbox', 'mapaLightbox'];
    return ids.map((id) => document.getElementById(id))
        .filter((e) => e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none');
}

function diagGeometria() {
    const fora = [];
    const camadas = diagCamadasAbertas();
    for (const sel of DIAG_ALVOS) {
        let els = [];
        try { els = [...document.querySelectorAll(sel)]; } catch (e) { continue; }
        for (const e of els.slice(0, 3)) {
            const r = e.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            const cs = getComputedStyle(e);
            fora.push({
                sel,
                x: Math.round(r.left), y: Math.round(r.top),
                w: Math.round(r.width), h: Math.round(r.height),
                scrollH: e.scrollHeight, clientH: e.clientHeight,
                overflowY: cs.overflowY,
                display: cs.display,
                // Quem RECEBE o dedo no centro. É o gotcha #26 — os dois
                // retângulos existem e só o hit-test diz quem intercepta —, e
                // ele já reincidiu três vezes neste projeto.
                noCentro: diagQuemEstaNoCentro(e, r),
                // O ENQUADRAMENTO do mapa: pra que tamanho ele foi desenhado.
                // Sem isto, frente e fundo saem idênticos no relatório mesmo
                // quando um deles está desenhado pra outra caixa.
                ...(e.dataset && e.dataset.mapaW
                    ? { mapaPara: e.dataset.mapaW + 'x' + e.dataset.mapaH } : {}),
                // Quantos tiles o desenho pediu e quantos FALHARAM. O tile que
                // falha sai da tela (ícone quebrado não informa nada), então
                // sem esta contagem "mapa com buraco" não aparece no arquivo.
                ...(e.dataset && e.dataset.tilesPedidos
                    ? { tiles: { pedidos: +e.dataset.tilesPedidos, falharam: +(e.dataset.tilesFalharam || 0) } } : {}),
                // Do card de FUNDO? Ele é coberto pelo da frente POR
                // CONSTRUÇÃO (`inert` + `pointer-events:none`), então o
                // hit-test nele acusa o normal como defeito — ver a sentinela
                // do toque.
                noFundo: !!(e.closest && e.closest('.card-fundo')),
                // DENTRO de uma camada aberta, ou atrás dela? Quem está atrás é
                // coberto por construção, e alertar nisso é ruído.
                naCamada: camadas.some((c) => c.contains(e)),
                camadaAberta: camadas.length > 0,
            });
        }
    }
    return fora;
}

function diagQuemEstaNoCentro(el, r) {
    try {
        const alvo = document.elementFromPoint(Math.round(r.left + r.width / 2),
                                               Math.round(r.top + r.height / 2));
        if (!alvo) return 'nada';
        if (alvo === el || el.contains(alvo)) return 'ele mesmo';
        // `className` de elemento SVG é um SVGAnimatedString, não uma string:
        // `String(...)` devolvia `[object SVGAnimatedString]` e o rótulo saía
        // como `path.[object` — inútil justamente no alerta cujo produto é
        // dizer QUEM interceptou. Os ícones do card são SVG, então isso valia
        // pra todo alerta de toque que já saiu.
        const cls = alvo.getAttribute ? (alvo.getAttribute('class') || '') : '';
        return (alvo.id ? '#' + alvo.id : alvo.tagName + (cls ? '.' + cls.split(' ')[0] : '')).slice(0, 60);
    } catch (e) { return null; }
}

// ── SENTINELAS: o arquivo não me dá material, ele DIZ o que está errado ────
// Cada uma nasce de um defeito que já chegou na tela de um editor. Elas rodam
// no APARELHO dele, onde eu não chego — e uma linha no topo do relatório vale
// mais que 1 MB pra vasculhar.
//
// Regra pra entrar aqui: só invariante que a app garante e que, quebrada,
// significa defeito — nunca "achei estranho". Falso positivo aqui treina a
// ignorar a seção inteira, que é como ela deixa de servir.
// ── O RETRATO DA SESSÃO, com a conta JÁ FEITA ────────────────────────────
//
// Esta seção existe porque a pergunta do relato — *"a sessão dura 2 dias ou 7?"*
// — hoje depende da memória de quem relata, e memória de duração é justamente
// o que ninguém tem. Ela devolve os INTERVALOS medidos entre entrar e cair.
//
// E entrega CONCLUÍDO em vez de dados crus de propósito: cruzar carimbos à mão
// num arquivo de 500 KB é o trabalho que faz a seção não ser lida.
function diagSessao() {
    const fora = { nascimento: null, idadeDoArmazenamentoH: null, diario: [], ciclos: [], erro: null };
    try {
        const nasc = Number(safeLS.get(NASCIMENTO_KEY)) || null;
        fora.nascimento = nasc ? new Date(nasc).toISOString() : null;
        fora.idadeDoArmazenamentoH = nasc ? Math.round((Date.now() - nasc) / 360000) / 10 : null;
        const anel = lerDiarioDeSessoes();
        fora.diario = anel.map((l) => ({ ...l, quando: new Date(l.t).toISOString() }));
        // Um CICLO é entrar e sair/cair. É ele que responde a pergunta, e a
        // duração vai em horas porque "2 dias" e "7 dias" se distinguem lá.
        let abriu = null;
        for (const l of anel) {
            if (l.e === 'token+' || l.e === 'jaAtiva') { abriu = l; continue; }
            if ((l.e === 'token-' || l.e === 'caiu' || l.e === 'saiu') && abriu) {
                fora.ciclos.push({
                    de: new Date(abriu.t).toISOString(),
                    ate: new Date(l.t).toISOString(),
                    durouH: Math.round((l.t - abriu.t) / 360000) / 10,
                    // `jaAtiva` significa que a sessão já existia quando o
                    // registro começou: a duração é um PISO, não a medida.
                    inicioConhecido: abriu.e !== 'jaAtiva',
                    fim: l.e, motivo: l.motivo || null,
                });
                abriu = null;
            }
        }
        if (abriu) {
            fora.ciclos.push({ de: new Date(abriu.t).toISOString(), ate: null,
                               durouH: Math.round((Date.now() - abriu.t) / 360000) / 10,
                               inicioConhecido: abriu.e !== 'jaAtiva', fim: 'em curso' });
        }
        // Só entra na estatística o ciclo com as DUAS pontas medidas. Um piso
        // misturado com medidas puxaria a mediana pra baixo e ela passaria a
        // afirmar menos tempo do que houve — erro na direção que confirma o
        // relato, que é a pior direção possível pra um instrumento.
        const fechados = fora.ciclos.filter((c) => (c.fim === 'caiu' || c.fim === 'token-') && c.inicioConhecido);
        fora.pisos = fora.ciclos.filter((c) => c.inicioConhecido === false).length;
        if (fechados.length) {
            const d = fechados.map((c) => c.durouH).sort((a, b) => a - b);
            fora.duracaoH = { menor: d[0], mediana: d[Math.floor(d.length / 2)], maior: d[d.length - 1], n: d.length };
        }
    } catch (e) { fora.erro = String((e && e.message) || e); }
    return fora;
}

// ── O AMBIENTE QUE DECIDE SE O ARMAZENAMENTO SOBREVIVE ───────────────────
//
// O relato ("preciso puxar os cookies toda semana") tem um candidato de
// PLATAFORMA que não é defeito nosso: o WebKit apaga TODO o storage
// script-writable depois de "seven days of Safari use without user interaction
// on the site" (webkit.org). E a isenção é exatamente o que a app pede:
// "web applications added to the home screen ... have their own counter".
//
// Ou seja: quem usa no Safari SEM instalar perde tudo em 7 dias, e o sintoma é
// idêntico a "a sessão expirou". Isto responde, no arquivo, de que lado está.
function diagArmazenamentoDuravel() {
    const f = { modoExibicao: null, iosStandalone: null, engine: null, navegador: null,
                riscoDeApagamento: null, pedimosPersistencia: false };
    try {
        for (const m of ['fullscreen', 'standalone', 'minimal-ui', 'browser']) {
            if (matchMedia('(display-mode: ' + m + ')').matches) { f.modoExibicao = m; break; }
        }
        f.iosStandalone = navigator.standalone === true;
        const ua = navigator.userAgent || '';
        // Heurística DECLARADA como tal: UA mente, e o que importa aqui é o
        // motor, não a marca. No iOS todo navegador é WebKit — Chrome incluso —,
        // então "é Chrome" não exclui a regra dos 7 dias.
        const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        f.engine = iOS || (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) ? 'WebKit'
                 : /Firefox|Gecko\//.test(ua) ? 'Gecko' : 'Blink';
        const mb = ua.match(/(Firefox|Edg|OPR|Chrome|CriOS|FxiOS|Version)\/([\d.]+)/);
        f.navegador = mb ? mb[1] + ' ' + mb[2] : null;
        f.iOS = iOS;
        const instalada = f.modoExibicao === 'standalone' || f.modoExibicao === 'fullscreen' || f.iosStandalone;
        f.instalada = instalada;
        // A conclusão, escrita: é isto que eu leio primeiro.
        f.riscoDeApagamento = f.engine === 'WebKit' && !instalada
            ? 'ALTO — WebKit fora da tela inicial: o navegador apaga todo o armazenamento após 7 dias sem abrir o site'
            : f.engine === 'WebKit' ? 'baixo — instalada na tela inicial, que o WebKit isenta do apagamento de 7 dias'
            : 'baixo — motor sem apagamento por inatividade (pode haver limpeza por pressão de espaço)';
    } catch (e) { f.erro = String((e && e.message) || e); }
    return f;
}

function diagSentinelas(comp) {
    const alertas = [];
    const diga = (chave, msg, dado) => alertas.push({ chave, msg, ...(dado || {}) });
    try {
        // 1. O bug de v2026.09.09-02, em uma linha.
        // UMA condição, e o `!== true` é deliberado: cobre nada focado, focado
        // em algo que não abre teclado, e DESCONHECIDO. A primeira versão pedia
        // `=== false` e ficava MUDA num build onde `campoDeTextoFocado` não
        // existe — que é exatamente o build antigo em que o defeito vive. A
        // sentinela não pode depender de o conserto já estar presente.
        const kb = parseFloat((comp.varsCss || {})['--kb-inset']) || 0;
        if (kb > 0 && !(comp.foco && comp.foco.abreTeclado === true)) {
            diga('kbInsetSemFoco',
                'há inset de teclado sem campo de texto focado — os modais achatam',
                { kbInset: kb, foco: (comp.foco && comp.foco.tag) || 'nada' });
        }
        // 2. `applyTheme` não remove `tema-claro`, então trocar pra escuro deixa
        //    as duas classes. Só alerta quando isso TEM consequência: a única
        //    regra que lê `.tema-claro` vive dentro de
        //    `@media (prefers-color-scheme: dark)`, então num sistema CLARO a
        //    contradição é inerte. Sem esse escopo a sentinela dispararia em
        //    todo diagnóstico de quem trocou de tema — e sentinela que dispara
        //    sempre é a que se aprende a ignorar, que é como esta seção morre.
        const cl = (comp.tema && comp.tema.htmlClasse) || '';
        const sistemaEscuro = !!(comp.media && comp.media['(prefers-color-scheme: dark)']);
        if (sistemaEscuro && cl.includes('tema-claro') && /\bdark\b/.test(cl)) {
            diga('temaContraditorio',
                '<html> tem `tema-claro` e `dark` juntos num sistema escuro — o fundo '
                + 'sob a app não acompanha', { classe: cl });
        }
        // 4. O armazenamento não está guardando NADA — e a app parece boa.
        //    Invariante dura: depois de entrar, o token ESTÁ no localStorage.
        //    Se há sessão ativa e ele não está lá, a sessão morre ao fechar a
        //    aba, toda vez, e nenhum outro campo deste arquivo diz isso.
        try {
            if (AppState.authenticated && !safeLS.get('waze_session_token')) {
                diga('tokenNaoPersiste',
                    'há sessão ativa mas o token NÃO está no armazenamento — ele morre ao fechar a aba '
                    + '(navegação privada, cookies bloqueados ou armazenamento cheio)');
            }
        } catch (e) { /* sonda nunca derruba o diagnóstico */ }
        // 5. O ambiente apaga o armazenamento antes do prazo que a app promete.
        //    NÃO é "achei estranho": é contradição entre o que a app garante
        //    (sessão de semanas, com janela deslizante) e o que ESTE ambiente
        //    faz — o WebKit apaga todo o storage após 7 dias sem interação, e
        //    isenta quem está na tela inicial. Escopo apertado de propósito:
        //    só com sessão ativa e fora da tela inicial, senão vira aviso
        //    genérico de plataforma em todo diagnóstico de iPhone.
        try {
            const dur = diagArmazenamentoDuravel();
            if (AppState.authenticated && dur.engine === 'WebKit' && !dur.instalada) {
                diga('apagamentoPorInatividade',
                    'WebKit fora da tela inicial: o navegador apaga TODO o armazenamento após 7 dias '
                    + 'sem abrir o site — a sessão vai sumir sozinha, e instalar na tela inicial isenta',
                    { modoExibicao: dur.modoExibicao, navegador: dur.navegador });
            }
        } catch (e) { /* idem */ }
        // 6. A sessão está caindo sozinha, e isso tem NÚMERO agora.
        //    Dois ciclos ou mais, cada um abaixo de 72 h, sem ter sido o editor
        //    que saiu. Um só poderia ser troca de aparelho ou logout no WME;
        //    dois é padrão. É o relato virando evidência sem depender da
        //    memória de quem relata.
        try {
            const curtos = (diagSessao().ciclos || [])
                .filter((c) => c.fim === 'caiu' && c.durouH != null && c.durouH < 72);
            if (curtos.length >= 2) {
                diga('sessaoCaiCedo',
                    `a sessão caiu ${curtos.length}× em menos de 72 h — o prazo do Waze é de ~28 dias`,
                    { duracoesH: curtos.map((c) => c.durouH), motivos: [...new Set(curtos.map((c) => c.motivo))] });
            }
        } catch (e) { /* idem */ }
        // 3. Gotcha #26, três reincidências: quem recebe o dedo não é o alvo.
        //    **Só vale pro controle que NÃO está atrás de camada aberta.** Modal
        //    cobrir o card é a função do modal, e sem esta condição a sentinela
        //    acusa os três botões toda vez que alguém abre os Filtros — foi o
        //    que ela fez no PRIMEIRO diagnóstico real que chegou (3 alertas, os
        //    3 falsos). O `#devFab` NÃO precisa de exceção: ele é `z-[68]`,
        //    acima dos modais, e o mesmo diagnóstico mostra `noCentro: "ele
        //    mesmo"` com o modal aberto — se um dia ele for coberto, é defeito
        //    de verdade e o smoke do FAB mede isso em 5 camadas por hit-test.
        for (const g of comp.geometria || []) {
            if (g.noCentro && g.noCentro !== 'ele mesmo' && g.noCentro !== 'nada'
                && /card-btn|devFab/.test(g.sel)
                && !(g.camadaAberta && !g.naCamada)
                // REINCIDIU pela PILHA (v2026.09.21-05): o card de fundo tem os
                // mesmos três botões, e eles são cobertos pelo da frente — que
                // é a função da pilha. MEDIDO com controle: 3 alertas com dois
                // pedidos na fila, ZERO com um. Ou seja, desde v2026.09.19-01
                // TODO diagnóstico com fila cheia trazia três alertas falsos,
                // na seção que se lê primeiro. Mesma sentinela, mesma
                // quantidade, causa nova — e a regra é a mesma do modal aberto.
                && !g.noFundo) {
                diga('toqueInterceptado',
                    'algo está por cima de um controle: o dedo não chega nele',
                    { alvo: g.sel, recebe: g.noCentro });
            }
            // 4. Alvo de toque abaixo da régua M3/HIG.
            if (/card-btn|devFab/.test(g.sel) && (g.w < 44 || g.h < 44)) {
                diga('alvoPequeno', 'alvo de toque abaixo de 44px',
                    { alvo: g.sel, w: g.w, h: g.h });
            }
        }
        // 5. O mapa desenhado pra uma caixa que não é a dele.
        //
        // INVARIANTE que a app garante: `renderMapa` enumera os tiles pra
        // cobrir exatamente `larguraPx × alturaPx`, então o enquadramento tem
        // que ser o tamanho da caixa. Quando não é, sobra faixa sem tile (caixa
        // maior que o enquadramento) ou o zoom foi escolhido pra outra
        // proporção (caixa menor) — os dois visíveis, nenhum detectável pelo
        // resto deste arquivo.
        //
        // Nasceu de uma falha do INSTRUMENTO: o owner relatou o mapa do card de
        // fundo mudando de tamanho ao virar frente, e o diagnóstico dele não
        // tinha como mostrar. A geometria já media os dois cards, mas as CAIXAS
        // sempre batem — o que diverge é o enquadramento.
        //
        // Tolerância de 1px porque `clientWidth` é inteiro arredondado
        // (gotcha #34) e o enquadramento guarda o valor lido na hora.
        for (const g of comp.geometria || []) {
            if (!g.mapaPara || !/card-map/.test(g.sel)) continue;
            const [mw, mh] = g.mapaPara.split('x').map(Number);
            if (Math.abs(mw - g.w) > 1 || Math.abs(mh - g.h) > 1) {
                diga('mapaForaDaCaixa',
                    'o mini-mapa foi desenhado pra um tamanho que não é o da caixa dele — '
                    + 'sobra faixa sem tile, ou o zoom é de outra proporção',
                    { onde: g.noFundo ? 'card de fundo' : 'card da frente',
                      caixa: g.w + 'x' + g.h, desenhadoPara: g.mapaPara });
            }
        }
        // 7. "A foto precisa de sinal" por cima de uma foto CARREGADA.
        //
        // INVARIANTE desde v2026.09.22-02: o aviso nasce do `onerror` da foto
        // em decisão, ou seja só existe DEPOIS de ela falhar — e foto que
        // falhou tem `naturalWidth` zero. Aviso com a foto carregada embaixo é
        // o defeito do relato de 2026-09-22 (o aviso posto por suposição
        // escondia a foto guardada), e aconteceu em 4 das 6 capturas dele sem
        // nenhuma sentinela dizer nada. Só o card da FRENTE: o de fundo é
        // clone e não tem ouvinte nenhum.
        const fd = comp.fotoDaFrente;
        if (fd && fd.aviso && fd.carregada) {
            diga('fotoEscondidaComAviso',
                'o card diz "a foto precisa de sinal" mas a foto em decisão CARREGOU — o aviso '
                + 'está escondendo uma foto que o aparelho tem', { foto: fd.src });
        }
        // 8. Pedaço de mapa GUARDADO que falhou na tela.
        //
        // INVARIANTE: com o service worker no comando, tile que está no cache
        // de tiles é servido do cache — com ou sem rede. O anel só recebe a
        // falha nas condições em que isso vale (ver `registrarFalhaDeTile`), e
        // é o defeito do mapa do relato de 2026-09-22 (o worker acordava sem
        // saber dos tiles), que o arquivo dele não tinha como mostrar: a app
        // tira da tela o tile que falha, e a prova ia junto.
        const tf = comp.tilesGuardadosQueFalharam || [];
        if (tf.length) {
            diga('tileGuardadoFalhou',
                'pedaço de mapa GUARDADO no aparelho falhou na tela — o service worker não o serviu',
                { n: tf.length, exemplos: tf.slice(-3).map((x) => x.url) });
        }
        // 9. O esqueleto de "carregando" POR CIMA de um card montado.
        //
        // INVARIANTE desde v2026.09.22-04: o `renderCurrentCard` esconde o
        // esqueleto ao pendurar o card, e todo card da frente passa por ele.
        // Os dois visíveis juntos é o defeito do relato de 2026-09-22 — a app
        // reaberta sem rede "não carregava nada" com o pedido montado por
        // baixo do esqueleto (z-50) —, e o resumo daquele arquivo dizia só
        // "carregando", sem alerta nenhum.
        const tc = comp.telaDoCard;
        if (tc && tc.esqueleto && tc.card) {
            diga('esqueletoSobreCard',
                'o esqueleto de "carregando" está POR CIMA de um card já montado — a tela parece '
                + 'parada e o pedido está ali embaixo');
        }
        // 10. Pedido que já está esperando envio DE VOLTA na fila de pedidos.
        //
        // INVARIANTE desde v2026.09.22-06: o que está na fila de saída não entra
        // na fila de pedidos — o filtro (`semOsJaDecididos`) está nos DOIS
        // caminhos por onde pedido entra, a busca e a reabertura sem rede. Os
        // dois juntos é o relato de 2026-09-22: reaberta no modo avião, a app
        // devolvia como card o que o owner já tinha tratado, e dava pra decidir
        // de novo — contando duas vezes e mandando duas decisões pro Waze.
        const dc = comp.decididos;
        if (dc && dc.naFila > 0) {
            diga('pedidoDecididoNaFila',
                'pedido que já está esperando envio voltou como card — dá pra decidir de novo, '
                + 'e o segundo gesto conta outra vez',
                { n: dc.naFila });
        }
        // NÃO existe sentinela de "modal achatado" por ALTURA, e a ausência é
        // deliberada. Eu escrevi uma (< 25% da janela) e ela não disparou no
        // caso real que a motivou: o modal de Filtros achatado tinha 302px de
        // 812 (37%), enquanto o `pairEnterModal` LEGÍTIMO tem 236px (29%) — ou
        // seja o normal é mais BAIXO que o defeito, e nenhum limiar separa os
        // dois. Afrouxar pra pegar 37% faria o modal certo alertar toda vez que
        // abrisse. Quem pega o achatamento é `kbInsetSemFoco`, que olha a CAUSA.
        // (Mesmo desfecho do gotcha #67: asserção que não distingue as duas
        // versões sai, com o motivo no lugar, em vez de ser remendada.)
    } catch (e) {
        alertas.push({ chave: '_erro', msg: String((e && e.message) || e).slice(0, 160) });
    }
    return alertas;
}

// As sentinelas NO INSTANTE da captura. Até v2026.09.22-04 só o relatório as
// rodava — e ele costuma ser gerado com o modal de Filtros ABERTO (o botão de
// baixar mora lá), quando as sentinelas de toque calam de propósito pela
// exceção de camada aberta. No relato de 2026-09-22 o toque no botão foi às
// 20:27:24, com o defeito na tela e NENHUM modal: rodadas ali, elas diriam
// "esqueleto por cima do card" (e três toques interceptados); rodadas no
// relatório, disseram nada. O `computado` vai junto porque é dele que as
// sentinelas leem — sentinela que nascer depois ainda pode ser conferida contra
// a captura velha. Custa ~1,5 KB por captura, contra os ~147 KB do `dom`, e
// nunca derruba a captura: o que falhar vira alerta, como no relatório.
function diagNoInstante() {
    try {
        const computado = diagComputado();
        return { computado, alertas: diagSentinelas(computado) };
    } catch (e) {
        return { alertas: [{ chave: '_erro', msg: String((e && e.message) || e).slice(0, 160) }] };
    }
}

function dlogCapturar(motivo) {
    try {
        const m = {
            t: new Date().toISOString(),
            motivo,
            rede: diagRedeAgora(),
            offline: diagOfflineAgora(),
            ...dlogTelaAtual(),
            // O que o navegador decidiu e o que as SENTINELAS acham, no INSTANTE
            // da captura (ver `diagNoInstante`).
            ...diagNoInstante(),
            // Os toasts NA TELA agora. O anel do diário guarda os que já
            // sumiram; este campo diz quais estavam visíveis no instante.
            toastsNaTela: [...document.querySelectorAll('#toastContainer > *, #bannerContainer > *')]
                .map((e) => (e.textContent || '').trim().slice(0, 120)),
            estado: {
                fila: (AppState.queue || []).length,
                serverTotal: AppState.serverTotal,
                hasMore: AppState.hasMore,
                loadError: AppState.loadError,
                fetching: AppState.fetching,
                nextPage: AppState.nextPage,
                pendingAction: AppState.pendingAction ? AppState.pendingAction.type : null,
                filtros: AppState.filters,
                autorEmFoco: AppState.autorEmFoco,
                atual: dlogPlace(AppState.currentPlace),
            },
            // Imagem quebrada é indistinguível de "meu sandbox não baixou" quando
            // eu reconstruo a tela — então quem sabe é o aparelho, e ele diz.
            imagens: [...document.images].map((i) => ({
                src: (i.currentSrc || i.src || '').slice(0, 160),
                quebrada: !!(i.complete && i.naturalWidth === 0),
            })).filter((x) => x.src),
            // Pixel de canvas não vai no outerHTML. `toDataURL` LANÇA quando o
            // canvas tem tile de outra origem (fica "tainted") — falhar dizendo
            // por quê é melhor que a imagem sair branca sem explicação.
            canvas: [...document.querySelectorAll('canvas')].map((c) => {
                try { return { classe: c.className, url: c.toDataURL('image/webp', 0.5).slice(0, 400000) }; }
                catch (e) { return { classe: c.className, erro: 'origem cruzada (tainted)' }; }
            }),
            rolagem: [...document.querySelectorAll('.card-changes-list, .card-flag-comment-text, #noMoreCards')]
                .map((e) => ({ classe: [...e.classList][0], top: e.scrollTop, altura: e.scrollHeight })),
            dom: document.documentElement.outerHTML,
        };
        dlogMomentos.push(m);
        // COTA POR MOTIVO pro que é FREQUENTE, e o arraste é o caso: ele é o
        // gesto central da app, então a uma captura por 30s ele enche as 12
        // vagas do anel em ~6 minutos de triagem — e empurra pra fora o momento
        // do erro de JS e o da queda de sessão, que são os que se quer ler.
        // É o mesmo risco que o comentário do `dlogCapturarAuto` já descrevia
        // ("um erro em laço enche o anel e empurra pra fora justamente o
        // começo"), só que disparado pelo uso NORMAL em vez de por defeito.
        //
        // MEDIDO: um momento pesa 147 KB e o anel cheio leva o diagnóstico de
        // 760 KB pra 2,5 MB — com TODAS as vagas em `auto:arraste`. Com a cota,
        // o arraste descarta o próprio mais antigo e nunca toca nos outros.
        const cota = DLOG_COTA_POR_MOTIVO[motivo];
        if (cota) {
            let sobrando = dlogMomentos.filter((x) => x.motivo === motivo).length - cota;
            for (let i = 0; i < dlogMomentos.length && sobrando > 0; ) {
                if (dlogMomentos[i].motivo === motivo) { dlogMomentos.splice(i, 1); sobrando--; }
                else i++;
            }
        }
        if (dlogMomentos.length > DLOG_MAX_MOMENTOS) dlogMomentos.shift();
        dlog('momento', { motivo, painel: m.painel, cardMontado: m.cardMontado,
                          alertas: (m.alertas || []).map((a) => a.chave) });
        // A captura vai pro aparelho NA HORA: é ela que prova o defeito, e a
        // app pode morrer antes de ir pro fundo (ver `diagGuardarAbertura`).
        diagGuardarAbertura('captura');
        return m;
    } catch (e) {
        dlog('momento.falhou', { erro: String((e && e.message) || e).slice(0, 120) });
        return null;
    }
}

// Captura AUTOMÁTICA. Vale mais que o botão: o defeito não espera a pessoa ser
// rápida. Um por motivo a cada 30s, senão um erro em laço enche o anel e empurra
// pra fora justamente o começo, que é onde a causa costuma estar.
const dlogUltimaAuto = {};
function dlogCapturarAuto(motivo) {
    if (!dlogLigado()) return;
    const agora = Date.now();
    if (dlogUltimaAuto[motivo] && agora - dlogUltimaAuto[motivo] < 30000) return;
    dlogUltimaAuto[motivo] = agora;
    dlogCapturar('auto:' + motivo);
}

// Desligar o dev APAGA o que ele gravou — senão "desligado" é mentira: o dado
// continua no aparelho. Some o diário, os momentos (o DOM deles carrega nome e
// endereço de terceiros) e os corpos de resposta guardados no anel da API.
// Fica o anel de METADADOS das chamadas: ele não tem dado pessoal e é a espinha
// de qualquer diagnóstico posterior.
function dlogApagar() {
    dlogAnel = [];
    dlogMomentos = [];
    // E o que ficou GUARDADO de aberturas anteriores, no aparelho e na memória:
    // desligado é desligado, e ali há o DOM das capturas, com dado de terceiro.
    diagAberturasAnteriores = [];
    diagBaixadoEm = 0;
    diagEsquecerGuardado();
    for (const h of dlogPendencias.values()) clearTimeout(h);
    dlogPendencias.clear();
    try { for (const c of (API.chamadas || [])) { delete c.corpoResposta; delete c._bytes; } } catch (e) {}
    // A posição em que o editor fixou o FAB é dado do modo dev como qualquer
    // outro: desligar apaga, e ligar de novo devolve a escolha automática do
    // canto. É também o único caminho de volta pra quem arrastou pra um lugar
    // ruim e quer o automático de novo.
    devFabFixado = false;
    try { sessionStorage.removeItem('__devFabPos'); } catch (e) {}
    atualizarFabDev();
}

// O selo do FAB e o aviso do desligar contam SÓ o que a PESSOA registrou (o
// motivo 'manual', o toque no FAB). Pedido do owner depois de ver o selo ir a
// 2, 4 e 5 em três toques: o número somava as capturas AUTOMÁTICAS — o arraste
// do card passando do limiar, com cota de 2 — às dele, então o primeiro toque
// já mostrava 2 e ele leu "capturou duas vezes". As automáticas continuam no
// anel e no relatório, iguais; só não entram num número que a pessoa lê como
// "quantas vezes eu apertei". Os dois pontos contam a MESMA coisa: aviso de
// "3 não baixados" com o selo mostrando 1 seria a app discordando de si mesma.
function dlogCapturasDoEditor() { return dlogMomentos.filter((m) => m.motivo === 'manual'); }

// Quais já foram BAIXADOS, marcados no próprio momento. Era uma CONTAGEM (o
// tamanho do anel na hora do download), que mentia assim que o anel cheio
// girava: com 12 baixados, uma captura nova empurrava a mais velha pra fora e
// a conta seguia dizendo "0 não baixados". `WeakSet` e não um campo no objeto
// porque o momento vai inteiro pro JSON do relatório.
const dlogJaBaixados = new WeakSet();
// As guardadas de aberturas ANTERIORES entram nas duas contas (ver
// `diagAberturasAnteriores`): o número do botão é "o que vai no próximo
// relatório", e é isso que precisa sobreviver a fechar a app.
function dlogMarcarBaixados() {
    for (const m of dlogMomentos) dlogJaBaixados.add(m);
    for (const m of diagMomentosAnteriores()) dlogJaBaixados.add(m);
}
function dlogNaoBaixados() {
    return [...dlogCapturasDoEditor(), ...diagCapturasAnterioresDoEditor()]
        .filter((m) => !dlogJaBaixados.has(m)).length;
}

// ── O DIAGNÓSTICO QUE SOBREVIVE A FECHAR A APP ────────────────────────────
//
// Relato de 2026-09-22 (owner, no modo avião): capturou o defeito com o botão
// duas vezes, fechou a app, reabriu — e o número sumiu do botão. As capturas,
// o diário, as chamadas e os erros viviam só em MEMÓRIA e morriam ao fechar. E
// o defeito daquele dia (o pedido tratado voltando como card) só existia
// ATRAVESSANDO um fechar e reabrir: o relatório, gerado numa abertura
// posterior, não tinha como mostrá-lo, e a prova de antes de fechar era
// exatamente o que sumia.
//
// Com o modo dev LIGADO, cada abertura guarda no aparelho o que o relatório
// levaria dela — as capturas ainda não baixadas, o diário, as chamadas (só os
// metadados) e os erros —, e as aberturas seguintes os devolvem: o número do
// botão sobrevive, e o relatório conta o que houve em cada uma. Decisão do
// owner, com o custo na mesa: até ~1,8 MB (12 capturas de ~150 KB) e, o que
// pesou, dado de terceiro no aparelho — a captura leva o DOM, com nome e
// endereço dos pedidos na tela. Por isso tudo tem saída: o que foi guardado
// some ao BAIXAR o diagnóstico (já foi entregue), ao DESLIGAR o modo dev, no
// "Sair", ou depois de 24 h.
//
// IndexedDB e não localStorage: 1,8 MB num `setItem` SÍNCRONO trava a thread do
// swipe. E base PRÓPRIA, não a do offline: aquela é apagada inteira quando o
// toggle dele desliga, e as duas coisas não têm nada a ver uma com a outra.
//
// Grava a cada CAPTURA e quando a app vai pro fundo (`visibilitychange`
// oculto, o último momento confiável no celular) ou sai (`pagehide`). NUNCA
// por swipe: o diário do modo dev anota cada ação, e gravar a cada anotação
// seria justamente o custo que o anel existe pra não ter.
const DIAG_DB = 'waze_places_diag';
const DIAG_STORE = 'aberturas';
const DIAG_GUARDA_MS = 24 * 60 * 60 * 1000;
const DIAG_ABERTURAS_MAX = 5;
// O mesmo teto do anel desta abertura (`DLOG_MAX_MOMENTOS`), somado entre TODAS
// as aberturas guardadas — é ele que segura o armazenamento em ~1,8 MB, e as
// capturas mais recentes ganham das mais velhas.
const DIAG_CAPTURAS_GUARDADAS_MAX = DLOG_MAX_MOMENTOS;
// Esta abertura: o id nasce com a página e morre com ela.
const DIAG_ABERTURA = { id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
                        inicio: Date.now() };
// O que as aberturas ANTERIORES deixaram, lido do aparelho na abertura (só com
// o modo dev ligado). Fica em memória até a página morrer: mesmo baixado, segue
// indo nos relatórios desta abertura — é o que já acontece com as capturas dela.
let diagAberturasAnteriores = [];
// O último download do diagnóstico NESTA abertura. O que veio antes já foi
// entregue: não volta a ser guardado.
let diagBaixadoEm = 0;

function diagMomentosAnteriores() {
    return diagAberturasAnteriores.flatMap((a) => (Array.isArray(a.momentos) ? a.momentos : []));
}
function diagCapturasAnterioresDoEditor() {
    return diagMomentosAnteriores().filter((m) => m && m.motivo === 'manual');
}

function diagDB() {
    return new Promise((ok, erro) => {
        let req;
        try { req = indexedDB.open(DIAG_DB, 1); } catch (e) { return erro(e); }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(DIAG_STORE)) db.createObjectStore(DIAG_STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => ok(req.result);
        req.onerror = () => erro(req.error);
    });
}

function diagLerGuardado(db) {
    return new Promise((ok, erro) => {
        const r = db.transaction(DIAG_STORE, 'readonly').objectStore(DIAG_STORE).getAll();
        r.onsuccess = () => ok(Array.isArray(r.result) ? r.result : []);
        r.onerror = () => erro(r.error);
    });
}

// A chamada vai só com os METADADOS. O corpo da resposta é a fila inteira —
// dado de terceiro em massa, e pesado — e o do pedido não responde nada do que
// se investiga entre uma abertura e outra.
function diagChamadaSemCorpo(c) {
    const { corpoReq, corpoResposta, _bytes, ...resto } = c || {};
    return resto;
}

// O que ESTA abertura guarda: só o que ainda não foi entregue — as capturas não
// baixadas e, do diário, das chamadas e dos erros, o que veio depois do último
// download (sem download, tudo).
function diagRegistroDaAbertura(motivo) {
    const depois = (x) => {
        if (!diagBaixadoEm) return true;
        const t = typeof x.t === 'number' ? x.t : Date.parse(x.t);
        return !(t <= diagBaixadoEm);
    };
    return {
        id: DIAG_ABERTURA.id,
        inicio: DIAG_ABERTURA.inicio,
        salvoEm: Date.now(),
        salvoPor: motivo,
        versao: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null,
        diario: [...dfatoAnel, ...dlogAnel].filter(depois).sort((a, b) => a.t - b.t),
        chamadas: (API.chamadas || []).filter(depois).map(diagChamadaSemCorpo),
        erros: diagErros.filter(depois),
        momentos: dlogMomentos.filter((m) => !dlogJaBaixados.has(m)),
    };
}

// A PODA, pura. O que passou de 24 h sai inteiro; das que ficam, só as
// DIAG_ABERTURAS_MAX mais recentes; e as capturas, somadas, não passam do teto —
// a abertura mais nova primeiro, e dentro de cada uma as capturas mais novas.
// Devolve o que manter (com as capturas já cortadas), os ids que saem e os ids
// cortados (que precisam ser regravados).
function diagPodarAberturas(lista, agora) {
    const todas = (Array.isArray(lista) ? lista : []).filter((a) => a && typeof a.id === 'string');
    const vivas = todas
        .filter((a) => Number.isFinite(a.salvoEm) && agora - a.salvoEm <= DIAG_GUARDA_MS)
        .sort((a, b) => (b.inicio || 0) - (a.inicio || 0))
        .slice(0, DIAG_ABERTURAS_MAX);
    let cabem = DIAG_CAPTURAS_GUARDADAS_MAX;
    const cortadas = [];
    const manter = vivas.map((a) => {
        const ms = Array.isArray(a.momentos) ? a.momentos : [];
        const ficam = cabem > 0 ? ms.slice(-cabem) : [];
        cabem -= ficam.length;
        if (ficam.length === ms.length) return a;
        cortadas.push(a.id);
        return { ...a, momentos: ficam };
    });
    const ficam = new Set(manter.map((a) => a.id));
    return { manter, sair: todas.filter((a) => !ficam.has(a.id)).map((a) => a.id), cortadas };
}

async function diagAplicarPoda(db, poda, novos) {
    await new Promise((ok, erro) => {
        const tx = db.transaction(DIAG_STORE, 'readwrite');
        const st = tx.objectStore(DIAG_STORE);
        for (const id of poda.sair) st.delete(id);
        for (const a of poda.manter) if (novos.has(a.id) || poda.cortadas.includes(a.id)) st.put(a);
        tx.oncomplete = ok;
        tx.onerror = () => erro(tx.error);
        tx.onabort = () => erro(tx.error);
    });
}

// Uma gravação de cada vez, em ORDEM: a de uma captura e a de ir pro fundo
// podem sair no mesmo instante, e a mais velha não pode pousar por cima da
// mais nova. O retrato é tirado DEPOIS do `await`, pelo mesmo motivo.
let diagGuardando = Promise.resolve();
function diagGuardarAbertura(motivo) {
    if (!dlogLigado()) return Promise.resolve(false);
    const esta = diagGuardando.then(async () => {
        if (!dlogLigado()) return false;
        let db = null;
        try {
            db = await diagDB();
            const guardadas = (await diagLerGuardado(db)).filter((a) => a.id !== DIAG_ABERTURA.id);
            const atual = diagRegistroDaAbertura(motivo);
            const poda = diagPodarAberturas([atual, ...guardadas], Date.now());
            await diagAplicarPoda(db, poda, new Set([atual.id]));
            return true;
        } catch (e) {
            dfato('diag.guardarFalhou', { motivo, erro: String((e && e.name) || e).slice(0, 60) });
            return false;
        } finally {
            try { if (db) db.close(); } catch (e) {}
        }
    });
    diagGuardando = esta.catch(() => false);
    return esta;
}

// Na abertura, com o modo dev ligado: traz o que as aberturas anteriores
// deixaram, já podado (o que venceu sai do aparelho aqui mesmo).
async function diagCarregarAberturas() {
    if (!dlogLigado()) return;
    let db = null;
    try {
        db = await diagDB();
        const guardadas = (await diagLerGuardado(db)).filter((a) => a.id !== DIAG_ABERTURA.id);
        const poda = diagPodarAberturas(guardadas, Date.now());
        if (poda.sair.length || poda.cortadas.length) await diagAplicarPoda(db, poda, new Set());
        diagAberturasAnteriores = poda.manter;
        dfato('diag.aberturas', { n: poda.manter.length, capturas: diagMomentosAnteriores().length });
        atualizarFabDev();
    } catch (e) {
        dfato('diag.carregarFalhou', { erro: String((e && e.name) || e).slice(0, 60) });
    } finally {
        try { if (db) db.close(); } catch (e) {}
    }
}

// Apaga TUDO o que foi guardado: no download (já foi entregue), no desligar do
// modo dev e no "Sair". Entra na MESMA fila das gravações: a que estava em voo
// termina antes (senão recriaria a base logo depois de apagada), e a que for
// pedida depois acontece depois.
function diagEsquecerGuardado() {
    const esta = diagGuardando.then(() => new Promise((ok) => {
        try {
            const r = indexedDB.deleteDatabase(DIAG_DB);
            r.onsuccess = r.onerror = r.onblocked = () => ok(true);
        } catch (e) { ok(false); }
    }));
    diagGuardando = esta.catch(() => false);
    return esta;
}

function setupGuardaDoDiagnostico() {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') diagGuardarAbertura('oculta');
    });
    window.addEventListener('pagehide', () => { diagGuardarAbertura('saida'); });
}

// ── O FAB ─────────────────────────────────────────────────────────────────
// UM gesto de toque e UM de arrasto, e nada mais. Toque = registra um momento;
// arrastar = move o botão. **Segurar NÃO faz mais nada**, e a remoção foi
// pedida pelo defeito: pressionar-e-segurar É como se pega um botão flutuante,
// então "segurar = baixar tudo" disputava com arrastar o mesmo começo de
// gesto. O owner descreveu exatamente isso — "seguro nele e parece que tem
// algo segurando" — e o diagnóstico que ele mandou tinha `momentos: 0`: ele
// nunca chegou a TOCAR, só segurava, e o que saía era o download.
// O baixar tudo continua inteiro no botão de Filtros → Avançado (`#diagBtn`),
// que é onde ele já morava antes de eu duplicá-lo aqui.
//
// Registrar VÁRIOS momentos importa porque defeito raramente é um instante: o
// que explica costuma ser "antes → ação → depois". Cada momento é leve (DOM +
// estado); o código, os caches e o ambiente entram UMA vez no relatório.

// ── ONDE O FAB NASCE ──────────────────────────────────────────────────────
//
// O owner pediu "que ele nasça no melhor lugar possível, em todos os casos".
// MEDIDO: esse lugar não existe como escolha fixa. O canto que está livre no
// card é exatamente o que tapa o ✕ do modal — em 3 de 3 celulares o FAB em
// cima à direita cobria `closeFilters` e `closeHelp` (no tablet, nenhum dos
// dois). Trocar de canto só muda de vítima.
//
// Então o canto não se escolhe: ele se MEDE, com a régua que este projeto já
// usa pra sobreposição (gotcha #26 — `elementFromPoint`, nunca retângulo, que
// os dois retângulos existem e só o hit-test diz quem recebe o dedo). A cada
// troca de camada o FAB testa os cantos na ordem de preferência e fica no
// primeiro em que nada acionável passa por baixo dele.
//
// A ordem de preferência também foi medida, não escolhida: pelo desvio-padrão
// dos pixels em 20 telas (4 aparelhos × 5 tipos de card, pedidos reais), os
// dois cantos de cima são ~3x mais vazios que qualquer outro (12,3 e 13,2
// contra 30,9 a 46,0) E são os únicos sem controle por baixo em tela nenhuma.
//
// Duas escolhas que não são gosto:
//  · **A posição do editor SEMPRE ganha.** Arrastou, fixou: a partir daí a app
//    não mexe mais. Instrumento que foge da mão é pior que instrumento no
//    lugar errado.
//  · **Nada de canto embaixo no centro.** Ali moram os toasts, em z-70 — ACIMA
//    do FAB. Não é o FAB que taparia o toast: é o toast que engoliria o toque
//    no FAB, que é justamente o defeito que já custou o "dois toques
//    registravam um momento só".
// Quanto tempo de dedo parado até o botão se dar por PEGO. 200ms é o toque
// longo curto: rápido o bastante pra não parecer travado, longo o bastante pra
// não pegar num toque comum. Toque devagar NÃO vira arrasto — quem decide é
// ter andado ou não, não o relógio.
const DEV_FAB_PEGAR_MS = 200;
const DEV_FAB_MARGEM = 12;
// Faixa de baixo reservada aos toasts/Desfazer. Não é chute: o `#notifyStack`
// se ancora em `bottom: 1rem + safe-area` e empilha caixas de ~56px.
const DEV_FAB_RESERVA_TOAST = 96;
// ORDEM = PREFERÊNCIA, e o meio caiu pro fim depois de medido. A faixa central
// é a FOTO e é a pista do polegar: MEDIDO em 4 aparelhos × 6 cards reais, o
// `meio-dir` encosta em controle de verdade (`card-image-next`, o ↗ do WME) em
// **5 de 6** cards — até 43px de um alvo de 44 —, e o `meio-esq` come a seta
// anterior em 3 a 4. O `baixo-*` fica livre em 6/6 no aparelho do owner e no
// Pixel 7, e nos dois estreitos só raspa 14px da BORDA de uma área rolável em
// 2 de 6. Trocar de lugar não tem custo: o `DEV_FAB_RESERVA_TOAST` já mantém
// essa faixa acima dos toasts.
const DEV_FAB_CANTOS = ['cima-dir', 'cima-esq', 'baixo-dir', 'baixo-esq', 'meio-dir', 'meio-esq'];
// Quem, por baixo, desqualifica um canto. Primeiro o que se TOCA: cobrir um
// controle ROUBA o dedo, e nem o esmaecido avisa.
const DEV_FAB_ACIONAVEL = 'button, a[href], input, select, textarea, label[for], [role="button"], [tabindex]:not([tabindex="-1"])';
// E o que se LÊ COMO VALOR, mesmo sem ser clicável. A regra antiga era "texto e
// foto o FAB pode cobrir, e o editor arrasta se incomodar" — ela vale pra prosa
// (nome, endereço, categoria): cortar ali ESCONDE, e a falta se percebe. Não
// vale pro placar, e a diferença não é gosto: "311" com a última coluna comida
// lê como "31" — um número inteiro, plausível e ERRADO. Cobrir prosa esconde;
// cobrir número MENTE, e ninguém arrasta o que não sabe que está errado.
// MEDIDO com a tinta (`Range.getBoundingClientRect`, não a caixa do elemento):
// no canto de cima o FAB comia 14% do "Restam" no aparelho do owner, 30% no
// iPhone SE, 13% no Pixel 7 — e 0% no Fold, onde o placar vira 2×2 e o número
// muda de lugar. Ou seja: o defeito aparecia e sumia com o aparelho.
// O marcador mora no HTML, e não como lista de ids AQUI, por um motivo: assim
// contador novo dentro do `#placar` já nasce protegido, em vez de depender de
// alguém lembrar de somá-lo a uma lista deste arquivo. E é marcador PURO — sem
// regra em CSS nenhuma —, senão reusar a classe arrastaria aparência junto
// (gotcha #56) e mexer nela deixaria de ser barato.
// Escopo de propósito ESTREITO: só o placar. As leituras curtas sobre a FOTO
// (escala do mapa, "3/5") ficam de fora porque a foto é justamente o que o FAB
// pode cobrir, e alargar o marcador até elas desqualificaria os cantos do meio
// — com a chance de não sobrar canto nenhum, que é pior que o defeito.
const DEV_FAB_LEITURA = '.nao-cobrir';
const DEV_FAB_EVITAR = DEV_FAB_ACIONAVEL + ', ' + DEV_FAB_LEITURA;

let devFabFixado = false;   // o editor arrastou → a app não escolhe mais

function devFabCoords(canto, w, h) {
    const cab = document.querySelector('header');
    const topo = (cab ? cab.getBoundingClientRect().bottom : 0) + 8;
    const x = canto.endsWith('dir') ? innerWidth - w - DEV_FAB_MARGEM : DEV_FAB_MARGEM;
    const y = canto.startsWith('cima') ? topo
            : canto.startsWith('meio') ? Math.round((innerHeight - h) / 2)
            : innerHeight - h - DEV_FAB_RESERVA_TOAST;
    return { x, y: Math.max(topo, Math.min(innerHeight - h - DEV_FAB_MARGEM, y)) };
}

// Quantas vítimas passariam por baixo do FAB neste canto — controle acionável
// ou leitura, os dois pesam igual (roubar o dedo e mentir o número são ruins do
// mesmo jeito).
//
// A GRADE VAI ATÉ A BORDA (0,02 / 0,5 / 0,98), e o recuo que havia antes era o
// defeito. A versão anterior amostrava 5 pontos com os cantos RECUADOS a 0,15 —
// e o comentário dizia, com todas as letras, que isso existia pra pegar "o alvo
// que encosta pela beirada". Não pegava: num quadro de 44px, 0,15 deixa **6,6px
// cegos** de cada lado, e é justamente aí que um vizinho encosta. MEDIDO quando
// o FAB desceu pro meio: ele invadia 6px do "›" (próxima foto), que ficava com
// 39px úteis de 44 e entregava o toque do topo AO FAB — e o amostrador de 5
// pontos via **NADA**, enquanto esta grade vê `card-image-next`. Ou seja: o
// guard tinha um ponto cego do tamanho do problema que ele existia pra achar.
// 0,02 e 0,98 são ~1px pra dentro: no limite exato o `elementFromPoint` fica
// ambíguo entre as duas caixas.
const DEV_FAB_AMOSTRAS = [0.02, 0.5, 0.98];

function devFabVitimas(canto, w, h, fab) {
    const { x, y } = devFabCoords(canto, w, h);
    const vitimas = new Set();
    const pontos = [];
    for (const fx of DEV_FAB_AMOSTRAS) for (const fy of DEV_FAB_AMOSTRAS) pontos.push([fx, fy]);
    for (const [fx, fy] of pontos) {
        const sob = document.elementFromPoint(x + w * fx, y + h * fy);
        const alvo = sob && sob.closest(DEV_FAB_EVITAR);
        // O próprio FAB nunca conta como vítima. A segunda condição não é
        // paranoia: `pointer-events: none` no contêiner NÃO tira o botão do
        // hit-test, porque ele traz `pointer-events-auto` — e sem esta linha o
        // FAB media a si mesmo, achava o canto onde já estava sempre ocupado e
        // fugia dele a cada troca de camada.
        if (alvo && !fab.contains(alvo)) vitimas.add(alvo);
    }
    return vitimas.size;
}

function posicionarFabDev() {
    const fab = document.getElementById('devFab');
    if (!fab || devFabFixado || fab.classList.contains('hidden')) return;
    const r = fab.getBoundingClientRect();
    const w = r.width || 44, h = r.height || 44;
    // O FAB inteiro sai do hit-test durante a medição — contêiner E botão —
    // senão ele não enxerga o que está POR BAIXO de si mesmo.
    const btn = document.getElementById('devFabBtn');
    const antes = fab.style.pointerEvents, antesBtn = btn ? btn.style.pointerEvents : '';
    fab.style.pointerEvents = 'none';
    if (btn) btn.style.pointerEvents = 'none';
    let melhor = DEV_FAB_CANTOS[0], menos = Infinity;
    try {
        for (const canto of DEV_FAB_CANTOS) {
            const n = devFabVitimas(canto, w, h, fab);
            if (n < menos) { melhor = canto; menos = n; }
            if (n === 0) break;   // ordem = preferência: o primeiro livre ganha
        }
    } finally {
        fab.style.pointerEvents = antes;
        if (btn) btn.style.pointerEvents = antesBtn;
    }
    const { x, y } = devFabCoords(melhor, w, h);
    fab.style.left = x + 'px'; fab.style.top = y + 'px';
    fab.style.right = 'auto'; fab.style.bottom = 'auto';
    fab.dataset.canto = melhor;
}

function atualizarFabDev() {
    const fab = document.getElementById('devFab');
    if (!fab) return;
    const ligado = typeof AppState !== 'undefined' && !!(AppState.devMode && AppState.devMode.active);
    fab.classList.toggle('hidden', !ligado);
    const selo = document.getElementById('devFabBadge');
    if (selo) {
        // Só as que a pessoa fez — ver `dlogCapturasDoEditor` —, desta abertura
        // e das anteriores que ficaram guardadas: o número é "o que vai no
        // próximo relatório", e ele tem que sobreviver a fechar a app.
        const n = dlogCapturasDoEditor().length + diagCapturasAnterioresDoEditor().length;
        selo.textContent = String(n);
        selo.classList.toggle('hidden', n === 0);
    }
    if (ligado) posicionarFabDev();
}

function ligarFabDev() {
    const btn = document.getElementById('devFabBtn');
    if (!btn) return;
    const fab = document.getElementById('devFab');

    // ── PEGAR E ARRASTAR ──────────────────────────────────────────────────
    //
    // Como o arrastar em mobile TEM que ser, e eu tinha errado o modelo antes
    // de errar o código: **segurar É o jeito de pegar**. Ícone da tela
    // inicial, bolha do Android, AssistiveTouch do iOS — em todos você
    // pressiona, o elemento AVISA que foi pego, e a partir dali ele acompanha
    // o dedo. O que existia aqui era o contrário: segurar disparava OUTRA
    // coisa (baixar tudo) e arrastar só valia se o dedo saísse na hora. O
    // owner descreveu o resultado exato — "seguro nele e parece que tem algo
    // segurando" — e o diagnóstico dele veio com `momentos: 0`: ele nunca
    // chegou a tocar, só segurava.
    //
    // Agora:
    //   · segurou `DEV_FAB_PEGAR_MS` → PEGOU (o botão cresce e vibra), e daí
    //     acompanha o dedo;
    //   · saiu andando antes disso → pega na hora, sem esperar;
    //   · soltou sem ter andado → é toque, registra um momento (não importa
    //     quanto tempo segurou — toque devagar continua sendo toque).
    //
    // E o gesto precisa de QUATRO defesas, nenhuma opcional. A prova de que é
    // assim está no próprio projeto: o swipe do card, que comprovadamente
    // funciona no aparelho dele, tem `touch-action: none` **e**
    // `user-select: none` juntos em `.place-card`. Eu tinha dado só o primeiro.
    //   1. `touch-none` (index.html) — sem ele o navegador reivindica o gesto
    //      como rolagem ao passar do próprio limiar e CANCELA o ponteiro.
    //      MEDIDO: dos 20 movimentos de dedo despachados chegava UM.
    //   2. `select-none` (index.html) — o selo do botão é TEXTO, e segurar em
    //      texto no Android começa uma seleção, que também cancela o ponteiro.
    //   3. `-webkit-touch-callout: none` (styles.css) — mata o balão de
    //      "abrir/copiar" do toque longo, que não tem utility no Tailwind.
    //   4. `contextmenu` barrado aqui — o toque longo do Android dispara esse
    //      evento, e o menu que ele abre leva o gesto embora.
    //
    // Ouvir na `window` e não capturar o ponteiro é a regra do gotcha #56.
    // Desenhar por QUADRO também: `pointermove` chega a 120Hz e escrever
    // `left/top` a cada um é layout jogado fora.
    let pego = false, arrastou = false, dx = 0, dy = 0, quadro = 0, alvo = null, relogio = null;
    const desenhar = () => {
        quadro = 0;
        if (!alvo) return;
        fab.style.left = alvo.x + 'px'; fab.style.top = alvo.y + 'px';
        fab.style.right = 'auto'; fab.style.bottom = 'auto';
    };
    // O AVISO de que pegou é o que faltava por inteiro: sem ele não há como
    // saber se a app agarrou o botão ou se o toque se perdeu — e "parece que
    // tem algo segurando" é exatamente a descrição de um gesto sem retorno.
    // São dois canais de propósito (WCAG 1.4.1 — sinal não pode viver só num):
    // o botão CRESCE e o aparelho VIBRA.
    const pegar = () => {
        if (pego) return;
        pego = true;
        devFabFixado = true;
        fab.classList.add('fab-pego');
        try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
    };
    const soltarPega = () => {
        pego = false;
        fab.classList.remove('fab-pego');
    };
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('pointerdown', (e) => {
        arrastou = false;
        const r = fab.getBoundingClientRect();
        dx = e.clientX - r.left; dy = e.clientY - r.top;
        fab.style.transition = 'none';   // dedo e transição brigando = botão escorregando
        relogio = setTimeout(pegar, DEV_FAB_PEGAR_MS);
        const mover = (ev) => {
            if (!pego && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 8) return;
            if (relogio) { clearTimeout(relogio); relogio = null; }
            pegar();
            arrastou = true;
            if (ev.cancelable) ev.preventDefault();
            alvo = {
                x: Math.min(innerWidth - r.width - 4, Math.max(4, ev.clientX - dx)),
                y: Math.min(innerHeight - r.height - 4, Math.max(4, ev.clientY - dy)),
            };
            if (!quadro) quadro = requestAnimationFrame(desenhar);
        };
        // `pointercancel` tem que desmontar igual ao `pointerup`. Sem isto o
        // gesto cancelado deixava `mover` e `fim` pendurados na window PRA
        // SEMPRE — a cada toque sobrava mais um par, todos escrevendo a mesma
        // posição a partir de coordenadas velhas.
        const fim = () => {
            removeEventListener('pointermove', mover);
            removeEventListener('pointerup', fim);
            removeEventListener('pointercancel', fim);
            if (relogio) { clearTimeout(relogio); relogio = null; }
            if (quadro) { cancelAnimationFrame(quadro); quadro = 0; desenhar(); }
            fab.style.transition = '';
            soltarPega();
            if (arrastou) {
                try { sessionStorage.setItem('__devFabPos', fab.style.left + '|' + fab.style.top); } catch (er) {}
            }
            alvo = null;
        };
        addEventListener('pointermove', mover, { passive: false });
        addEventListener('pointerup', fim);
        addEventListener('pointercancel', fim);
    });

    // ── TOCAR: registra um momento ────────────────────────────────────────
    // A distinção é ANDOU ou não andou, nunca o tempo: toque devagar continua
    // sendo toque, e é o que impede que segurar sem querer vire um beco.
    // `pointerup` e não `click` porque, com captura implícita, o clique nem
    // sempre chega quando o dedo saiu do botão.
    const soltar = () => {
        if (arrastou) return;   // arrastar não é tocar
        const m = dlogCapturar('manual');
        atualizarFabDev();
        // SEM toast, e o motivo é o próprio instrumento: o toast vive em z-70,
        // acima do FAB, e MEDIDO ele engolia o toque seguinte — dois toques
        // registravam um momento só. Pior: ele entrava na captura seguinte, ou
        // seja o instrumento passava a medir a si mesmo. O selo do botão já diz
        // quantos há, e o pulso dá o retorno sem cobrir nada.
        if (m) {
            btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }],
                        { duration: 220, easing: 'ease-out' });
        }
    };
    btn.addEventListener('pointerup', soltar);

    // ── Quando reavaliar o canto ──────────────────────────────────────────
    //
    // Observador nos ELEMENTOS de camada, e não chamada espalhada em cada
    // abrir/fechar: modal fecha por três caminhos (botão, Esc, scrim) e o
    // lightbox por mais alguns — amarrar a um deles deixa os outros vazando, o
    // gotcha dos modais deste projeto. Aqui o gatilho é o próprio `hidden`
    // mudando, então nenhum caminho novo precisa lembrar de avisar.
    //
    // `filter(Boolean)` some com id errado SEM DIZER NADA, e foi o que
    // aconteceu: escrevi `lightbox` e o elemento se chama `imageLightbox`, então
    // o lightbox de foto simplesmente não era vigiado. `test/diagnostico.test.mjs`
    // cobra que todo id desta lista exista no index.html.
    const DEV_FAB_CAMADAS = [...MODAL_IDS, 'imageLightbox', 'mapaLightbox', 'appScreen', 'authScreen'];
    const camadas = DEV_FAB_CAMADAS.map((id) => document.getElementById(id)).filter(Boolean);
    let pendente = 0;
    const reavaliar = () => {
        if (pendente) return;
        pendente = requestAnimationFrame(() => { pendente = 0; posicionarFabDev(); });
    };
    if (camadas.length) {
        const obs = new MutationObserver(reavaliar);
        for (const el of camadas) obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    }
    addEventListener('resize', () => {
        // Fixado, o FAB não se remove do lugar — mas precisa continuar DENTRO
        // da tela quando ela gira ou encolhe, senão some pra fora sem volta.
        if (!devFabFixado) return reavaliar();
        const r = fab.getBoundingClientRect();
        fab.style.left = Math.min(innerWidth - r.width - 4, Math.max(4, r.left)) + 'px';
        fab.style.top = Math.min(innerHeight - r.height - 4, Math.max(4, r.top)) + 'px';
    });

    try {
        const pos = sessionStorage.getItem('__devFabPos');
        if (pos) {
            const [x, y] = pos.split('|');
            fab.style.left = x; fab.style.top = y; fab.style.right = 'auto'; fab.style.bottom = 'auto';
            devFabFixado = true;
        }
    } catch (e) {}
}

// ── Diagnóstico: baixa TUDO que existe do lado do cliente ──────────────────
//
// Pedido do owner, depois de horas em que eu adivinhei o defeito do aparelho
// dele em vez de olhar. O botão vive atrás do modo dev e gera UM arquivo.
//
// DUAS COISAS QUE ELE **NÃO** CONSEGUE TRAZER, e é honesto dizer no próprio
// arquivo em vez de deixar a pessoa procurar:
//
//  1. Os cookies do WAZE. Eles são de `waze.com`, outra origem — o JavaScript
//     desta página não os enxerga, por regra do navegador, e nem existem aqui:
//     depois do login eles vivem CIFRADOS no servidor e nunca mais voltam ao
//     aparelho. O que dá pra trazer é `document.cookie` desta origem.
//  2. O corpo do que o Service Worker guardou de OUTRA origem (tiles do Waze):
//     a resposta é opaca. As URLs vêm; o conteúdo, não.
//
// O QUE ELE TRAZ, e o peso disso: o `waze_session_token` vai INTEIRO. Ele é
// credencial viva — quem tiver o arquivo pode agir na conta do Waze do dono até
// a sessão vencer, e é METADE da chave que decifra os cookies no servidor (ver
// `derivarChave`). Foi pedido assim de propósito, porque é ele que permite
// REPRODUZIR a falha em vez de teorizar. O arquivo diz isso na primeira linha,
// e o caminho de anular é sair da app, que destrói a sessão no servidor.
// 3 (v2026.09.22-03): entraram a seção `offline`, `serviceWorker.proprio` (o
// worker respondendo sobre si), `recursosInfo`, `rede`/`offline` em cada
// momento e `tiles` na geometria do mapa. Aditivo: leitor antigo só ignora.
// 4 (v2026.09.22-05): cada momento leva `computado` + `alertas` do instante e
// `cardMontado`; o resumo ganha `alertasNasCapturas`. Aditivo também.
// 5 (v2026.09.22-06): o resumo ganha `saida` (a fila de saída em números), o
// `computado` ganha `decididos` (e a sentinela `pedidoDecididoNaFila`), e a
// seção `offline` ganha `pousosGravados` e o `desdeMin` da fila guardada. E o
// arquivo passa a levar as ABERTURAS ANTERIORES guardadas no aparelho
// (`aberturasAnteriores`, `aberturaAtual`, e no resumo a contagem e os alertas
// das capturas delas, com a `abertura` de cada uma). Aditivo.
// 6 (v2026.09.23-03): o resumo ganha `presencaWme` (a presença no mapa do WME,
// de carona nas ações): ligada, já vista ligada, escritas, falhas e se a marca
// de quem está na app voltou diferente. Aditivo.
const DIAG_VERSAO = 6;

// JSON de coisa viva: `AppState` tem Promise, função e referência circular
// (`currentPlace` é o mesmo objeto de `queue[0]`). Sem isto o `stringify` lança
// e o arquivo sai vazio — falha silenciosa no instrumento de socorro.
function diagSeguro(v, prof = 0, vistos = new WeakSet()) {
    if (v === null || typeof v !== 'object') {
        return typeof v === 'function' ? '[função]' : v;
    }
    if (vistos.has(v)) return '[circular]';
    if (prof > 8) return '[fundo]';
    if (v instanceof Promise) return '[promise]';
    if (typeof Element !== 'undefined' && v instanceof Element) return '[elemento ' + v.tagName + ']';
    if (v instanceof Map) return { '[Map]': [...v.keys()].map(String) };
    if (v instanceof Set) return { '[Set]': [...v].map(String) };
    vistos.add(v);
    if (Array.isArray(v)) return v.map((x) => diagSeguro(x, prof + 1, vistos));
    const o = {};
    for (const k of Object.keys(v)) {
        try { o[k] = diagSeguro(v[k], prof + 1, vistos); } catch (e) { o[k] = '[erro: ' + e.message + ']'; }
    }
    return o;
}

// Erros de JS acumulados desde a carga. Armado cedo, no `initApp`.
const diagErros = [];
// ── O teto da lista de RECURSOS ───────────────────────────────────────────
// O navegador guarda só 250 entradas de Resource Timing e DESCARTA o que vem
// depois. No relato de 2026-09-22 tiles e fotos da varredura ocuparam 230 das
// 250 vagas, e o que aconteceu depois — o card sem sinal, a parte que
// interessava — não entrou. Com o modo dev ligado o teto sobe; desligado fica
// o padrão, que é de graça. Cada entrada é pequena (URL, duração, bytes).
const DIAG_RECURSOS_TETO = 1000;
let diagRecursosCheio = false;
function diagAjustarRecursos() {
    try {
        if (dlogLigado() && performance.setResourceTimingBufferSize) {
            performance.setResourceTimingBufferSize(DIAG_RECURSOS_TETO);
        }
    } catch (e) { /* navegador sem a API: fica o padrão */ }
}

function diagCapturarErros() {
    // A lista bateu no teto: o relatório tem que DIZER isso, senão a ausência
    // do que veio depois lê como "não aconteceu".
    try {
        performance.addEventListener('resourcetimingbufferfull', () => { diagRecursosCheio = true; });
    } catch (e) {}
    addEventListener('error', (e) => {
        // Com CONTEXTO DE TELA: erro sem saber ONDE aconteceu manda procurar no
        // arquivo inteiro. É a diferença entre pista e ruído.
        diagErros.push({ t: new Date().toISOString(), tipo: 'error',
            msg: String(e.message || ''), fonte: String(e.filename || ''), linha: e.lineno,
            ...(typeof dlogTelaAtual === 'function' ? { onde: dlogTelaAtual() } : {}) });
        if (diagErros.length > 50) diagErros.shift();
        dlogCapturarAuto('erroDeJs');
    });

    // O `console.error/warn` some com a aba fechada, e é onde o navegador conta
    // coisa que a app não vê: falha de WebRTC, storage recusando, recurso
    // bloqueado. Embrulhar aqui é um funil só, em vez de trocar 200 chamadas.
    for (const nivel of ['error', 'warn']) {
        const orig = console[nivel].bind(console);
        console[nivel] = (...a) => {
            dlog('console.' + nivel, { msg: a.map((x) => {
                try { return typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x); }
                catch (e) { return String(x); }
            }).join(' ').slice(0, 200) });
            orig(...a);
        };
    }

    // Travada de quadro é defeito de PRODUTO aqui: o valor da app é o ritmo do
    // swipe, e 200ms de thread presa são ~24 quadros perdidos.
    try {
        new PerformanceObserver((l) => {
            for (const e of l.getEntries()) if (e.duration > 200) dfato('lenta', { ms: Math.round(e.duration) });
        }).observe({ type: 'longtask', buffered: true });
    } catch (e) {}
    addEventListener('unhandledrejection', (e) => {
        diagErros.push({ t: new Date().toISOString(), tipo: 'rejeicao',
            msg: String((e.reason && e.reason.message) || e.reason || '').slice(0, 300) });
        if (diagErros.length > 50) diagErros.shift();
    });

    // A REDE CAIU / VOLTOU. O relato de 2026-09-22 foi todo sobre a falta de
    // rede, e o arquivo não dizia QUANDO ela faltou: a janela sem sinal foi
    // reconstruída de 16 "Failed to fetch" e da fila de saída abrindo e
    // fechando. Evento RARO e sem dado de ninguém — a regra de entrada do
    // `dfato`. `onLine === false` é a metade confiável (a da regra de uma mão
    // só): o que se registra é a TRANSIÇÃO que o navegador anuncia.
    addEventListener('offline', () => dfato('rede.caiu'));
    addEventListener('online', () => dfato('rede.voltou'));
    if (navigator.onLine === false) dfato('rede.caiu', { naAbertura: true });
    // O esqueleto nasce VISÍVEL no HTML, então a primeira transição dele é o
    // SUMIR — sem esta linha, o diário não diria desde quando ele estava lá.
    if (document.getElementById('loadingCard')?.classList.contains('hidden') === false) {
        dfato('tela.carregando', { visivel: true, naAbertura: true });
    }

    // A TELA MUDOU DE TAMANHO. Girar o aparelho, a barra do navegador sumir, a
    // janela do PWA reabrir — tudo isso remonta o layout, e num relato de "ficou
    // torto" a primeira pergunta é se aconteceu antes ou depois. Só quando o
    // tamanho MUDA de verdade: `resize` dispara em rajada durante o giro, e um
    // anel de 120 não sobrevive a isso.
    let ultimaJanela = '';
    const anotarJanela = () => {
        const j = innerWidth + 'x' + innerHeight;
        if (j === ultimaJanela) return;
        ultimaJanela = j;
        dfato('janela', { j, dpr: Math.round((devicePixelRatio || 1) * 100) / 100,
                          orient: innerWidth > innerHeight ? 'deitado' : 'em pé' });
    };
    addEventListener('resize', anotarJanela);
    anotarJanela();

    // O SW ASSUMIU. É o momento exato em que o código servido pode trocar
    // debaixo da página, e é a causa mais chata de "funcionava e parou": o
    // aparelho fica dias com asset velho porque o SW é cache-first. Sem esta
    // linha o arquivo diz QUAL código está rodando, mas não QUANDO ele entrou.
    try {
        if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('controllerchange',
                () => dfato('sw.assumiu', { v: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null }));
        }
    } catch (e) {}
}

// ── A FILA DE SAÍDA no resumo ─────────────────────────────────────────────
// Em NÚMEROS: quantos itens, quantos pedidos distintos, quantos repetidos, de
// que tipo e há quanto tempo o mais velho espera. `repetidas` > 0 é a mesma
// decisão mandada duas vezes — o que o relato de 2026-09-22 deixava acontecer.
// Os ids e o autor de cada pedido ficam de fora: são dado de terceiro, e o
// resumo é o que se lê primeiro e se cola numa conversa.
function diagResumoDaSaida() {
    try {
        const f = carregarFilaDeSaida();
        const chaves = f.map(chaveDoPedido).filter(Boolean);
        const distintas = new Set(chaves).size;
        const tipos = {};
        for (const it of f) tipos[it.tipo] = (tipos[it.tipo] || 0) + 1;
        const ts = f.map((it) => it.t).filter(Number.isFinite);
        return { n: f.length, distintas, repetidas: chaves.length - distintas, tipos,
                 maisAntigaMin: ts.length ? Math.round((Date.now() - Math.min(...ts)) / 60000) : null };
    } catch (e) { return { erro: String((e && e.message) || e).slice(0, 120) }; }
}

// ── O OFFLINE no relatório ────────────────────────────────────────────────
// O estado que decide se a foto e o mapa abrem sem sinal mora em variáveis de
// módulo e numa base IndexedDB, e nada disso ia pro arquivo: no relato de
// 2026-09-22 a janela servida foi deduzida do sufixo das URLs, e a idade da
// fila guardada não aparecia em lugar nenhum. A fila vai só como NÚMERO e
// IDADE — o conteúdo é pedido de terceiro e já está inteiro no `appState`.
// Quem nunca ligou o offline sai sem abrir a base: abrir CRIA a base.
async function diagOffline() {
    const o = { ...diagOfflineAgora(), tilesGuardadosQueFalharam: diagTilesGuardadosQueFalharam.length };
    if (!o.ligado) return o;
    try {
        const f = await offlineLerFila();
        // `desdeMin`: de quando é a LISTA (o começo da busca que a trouxe). É
        // contra ele que os pousos filtram a reabertura sem rede.
        o.filaGuardada = f ? { n: f.places.length, idadeMin: Math.round((Date.now() - f.t) / 60000),
                               desdeMin: Number.isFinite(f.desde) ? Math.round((Date.now() - f.desde) / 60000) : null } : null;
    } catch (e) { o.filaGuardada = { erro: String((e && e.message) || e).slice(0, 120) }; }
    // Quantos pedidos pousaram no Waze depois da foto — os que a reabertura sem
    // rede tira da fila guardada. Só o número.
    try { o.pousosGravados = offlineLerPousos().length; } catch (e) {}
    try { o.janelaGuardada = await offlineLerJanela(); } catch (e) {}
    try {
        if (window.caches && await caches.has(OFFLINE_TILES_CACHE)) {
            o.tilesNoCache = (await (await caches.open(OFFLINE_TILES_CACHE)).keys()).length;
        } else o.tilesNoCache = 0;
    } catch (e) { o.tilesNoCache = { erro: String((e && e.message) || e).slice(0, 120) }; }
    return o;
}

// ── O service worker, pela boca DELE ──────────────────────────────────────
// Até aqui o relatório só sabia que ele estava "ativo e controlando", e o
// defeito do mapa de 2026-09-22 — o worker ACORDANDO sem lembrar dos tiles —
// não aparecia em nada. Agora ele diz quando nasceu, se a lista está lida,
// quantos tiles conhece e o que fez com os que passaram por ele (ver o `DIAG`
// no `service-worker.js`). Com TETO: worker de versão antiga não conhece a
// pergunta e não responde, e o diagnóstico não pode esperar pra sempre.
function diagServiceWorker() {
    return new Promise((ok) => {
        try {
            const ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
            if (!ctl || typeof MessageChannel === 'undefined') return ok(null);
            const canal = new MessageChannel();
            const teto = setTimeout(() => ok({ semResposta: true }), 1500);
            canal.port1.onmessage = (e) => { clearTimeout(teto); ok(e.data); };
            ctl.postMessage({ type: 'DIAG' }, [canal.port2]);
        } catch (e) { ok({ erro: String((e && e.message) || e).slice(0, 120) }); }
    });
}

async function diagCorpo() {
    const meu = location.origin;
    // Só recurso da NOSSA origem: de terceiro a resposta é opaca e a leitura
    // ainda gastaria rede. `cache: 'force-cache'` pra pegar o que o aparelho
    // REALMENTE tem — que é a pergunta quando se suspeita de PWA com código
    // velho; buscar da rede mediria o servidor, não o aparelho.
    const texto = async (url) => {
        try {
            const r = await fetch(url, { cache: 'force-cache' });
            return { http: r.status, tipo: r.headers.get('content-type'),
                     etag: r.headers.get('etag'), corpo: await r.text() };
        } catch (e) { return { erro: String((e && e.message) || e) }; }
    };

    const ls = {}, ss = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); } }
    catch (e) { ls._erro = String(e); }
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k); } }
    catch (e) { ss._erro = String(e); }

    const sw = { suportado: 'serviceWorker' in navigator,
                 controlando: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
                 registros: [] };
    try {
        for (const r of await navigator.serviceWorker.getRegistrations()) {
            sw.registros.push({ escopo: r.scope,
                ativo: r.active && r.active.scriptURL, estadoAtivo: r.active && r.active.state,
                esperando: r.waiting && r.waiting.scriptURL,
                instalando: r.installing && r.installing.scriptURL });
        }
    } catch (e) { sw.erro = String(e); }
    sw.proprio = await diagServiceWorker();

    const cachesDoAparelho = {};
    try {
        for (const nome of await caches.keys()) {
            const c = await caches.open(nome);
            cachesDoAparelho[nome] = (await c.keys()).map((r) => r.url);
        }
    } catch (e) { cachesDoAparelho._erro = String(e); }

    // O CÓDIGO que está rodando, com o corpo. É isto que responde "o PWA está
    // com a versão velha?" — pergunta que o serial sozinho não responde, porque
    // ele só diz o que o `version.js` carregado afirma, não o que o resto é.
    const recursos = performance.getEntriesByType('resource')
        .map((r) => ({ url: r.name, tipo: r.initiatorType, ms: Math.round(r.duration),
                       bytes: r.transferSize,
                       doCache: r.transferSize === 0 && r.decodedBodySize > 0 }));
    const codigo = {};
    // O `service-worker.js` NÃO aparece em `performance.getEntriesByType` — ele
    // não é recurso DESTA página, é o processo que a serve. Sem pedir por nome,
    // o arquivo traz o conteúdo dos caches e a URL do SW, mas não o script que
    // está no comando: dava pra concluir "está atualizado" pelo `version.js` com
    // um SW de três versões atrás decidindo o que servir.
    const nossos = [...new Set([location.href, meu + '/service-worker.js',
        ...recursos.map((r) => r.url).filter((u) => u.startsWith(meu))])];
    for (const u of nossos) {
        // Nem tudo que vem da nossa origem é CÓDIGO, e duas coisas entravam aqui
        // sem servir pra nada. **A fonte**: `.woff2` é binário lido com
        // `r.text()`, então chega corrompido (byte inválido vira U+FFFD) — e
        // ainda que chegasse inteiro, fonte não causa defeito que este arquivo
        // investiga. MEDIDO no diagnóstico do owner: 111 KB crus, **42 KB
        // comprimidos, 8% do arquivo inteiro**. **E `/api/*`**: o coletor faz
        // GET e a API só aceita POST, então eram 6 entradas de `405 Método não
        // permitido` — um erro que a app nunca vê. O que fica é o que responde
        // "qual código este aparelho está rodando": o HTML, o SW, o CSS, os
        // `js/min/*` e o manifest.
        if (/\.(woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|ico|mp4|webm)(\?|$)/i.test(u)) continue;
        if (u.startsWith(meu + '/api/')) continue;
        codigo[u] = await texto(u);
    }

    // ── O que o aparelho tem × o que o servidor tem AGORA ──────────────────
    // Responde de vez a pergunta que sozinha custou horas: "o PWA está rodando
    // código velho?". O `codigo` acima é o lado do APARELHO (`force-cache`);
    // aqui o mesmo arquivo vem da REDE (`reload`) e os dois são comparados por
    // hash. Deduzir isso do serial não serve — o serial só diz o que o
    // `version.js` carregado afirma, não o que o resto dos arquivos é.
    //
    // Custa uma requisição por arquivo, e SÓ quando alguém aperta o botão.
    const hash = async (txt) => {
        try {
            const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
            return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('');
        } catch (e) { return 'sem-hash:' + txt.length; }
    };
    const cacheVsRede = {};
    for (const u of nossos) {
        const local = codigo[u] && codigo[u].corpo;
        if (typeof local !== 'string') { cacheVsRede[u] = { erro: 'sem corpo local' }; continue; }
        try {
            const r = await fetch(u, { cache: 'reload' });
            const remoto = await r.text();
            const [ha, hb] = [await hash(local), await hash(remoto)];
            cacheVsRede[u] = { aparelho: ha, servidor: hb, igual: ha === hb,
                               bytesAparelho: local.length, bytesServidor: remoto.length,
                               http: r.status };
        } catch (e) { cacheVsRede[u] = { erro: String((e && e.message) || e) }; }
    }

    // ── O armazenamento local funciona mesmo? ──────────────────────────────
    // O `safeLS` engole exceção DE PROPÓSITO, então armazenamento cheio ou
    // navegação privada falham em SILÊNCIO: filtro não persiste, sessão não
    // grava, e a app parece boa. É uma classe inteira de defeito que nenhum
    // outro campo deste arquivo revelaria — só a sonda escreve-lê-apaga.
    const armazenamento = { quota: null, uso: null, escreve: null, erroEscrita: null };
    try {
        const e = await navigator.storage.estimate();
        armazenamento.quota = e.quota; armazenamento.uso = e.usage;
        armazenamento.sobraPct = e.quota ? +(100 - (e.usage / e.quota) * 100).toFixed(2) : null;
    } catch (e) { armazenamento.erroQuota = String(e); }
    try {
        const k = '__diag_probe__', v = String(Date.now());
        localStorage.setItem(k, v);
        armazenamento.escreve = localStorage.getItem(k) === v;
        localStorage.removeItem(k);
    } catch (e) { armazenamento.escreve = false; armazenamento.erroEscrita = String((e && e.message) || e); }
    try { armazenamento.persistente = await navigator.storage.persisted(); } catch (e) {}

    // ── Relógio do aparelho × do servidor ──────────────────────────────────
    // Data errada no celular faz o aviso de sessão vencendo mentir e toda
    // comparação de prazo sair torta — e o sintoma nunca aponta pro relógio.
    const relogio = { aparelho: new Date().toISOString(), servidor: null, desvioSeg: null };
    try {
        const r = await fetch(meu + '/manifest.json', { cache: 'no-store', method: 'HEAD' });
        const d = r.headers.get('date');
        if (d) {
            relogio.servidor = new Date(d).toISOString();
            relogio.desvioSeg = Math.round((Date.now() - new Date(d).getTime()) / 1000);
        }
    } catch (e) { relogio.erro = String((e && e.message) || e); }

    const idb = {};
    try { for (const d of await indexedDB.databases()) idb[d.name] = d.version; }
    catch (e) { idb._erro = String(e); }

    const c = navigator.connection || {};
    // Computado UMA vez: as sentinelas leem dele, e medir duas vezes daria duas
    // fotos de instantes diferentes — que é como um alerta some do relatório
    // onde ele acabou de aparecer.
    const computado = diagComputado();
    const alertas = diagSentinelas(computado);
    return {
        _leia_isto: 'Este arquivo contém o waze_session_token, que é CREDENCIAL VIVA da conta do Waze '
            + 'de quem gerou. Trate como senha. Pra anular: sair da app, o que destrói a sessão no '
            + 'servidor. NÃO contém os cookies do Waze — eles são de outra origem e não ficam neste aparelho.',
        _versaoDoDiag: DIAG_VERSAO,
        _formato: DIAG_FORMATO,
        // RESUMO NO TOPO: o arquivo tem 1,7 MB e ninguém lê 1,7 MB procurando o
        // que está errado. Isto é o que eu olho primeiro.
        resumo: {
            momentos: dlogMomentos.length,
            chamadas: (API.chamadas || []).length,
            falhas: (API.chamadas || []).filter((c) => !c.ok).length,
            naoAutorizado: (API.chamadas || []).filter((c) => c.errorCategory === 'unauthorized').length,
            rotasQueFalharam: [...new Set((API.chamadas || []).filter((c) => !c.ok).map((c) => c.rota))],
            errosDeJs: diagErros.length,
            penduradas: dlogAnel.filter((l) => l.k === 'pendurada').map((l) => l.o),
            lentas: dlogAnel.filter((l) => l.k === 'lenta').length,
            telaAgora: dlogTelaAtual(),
            // O resumo é o que se lê primeiro; estas duas respondem o relato da
            // sessão sem abrir o resto do arquivo.
            sessaoDuracaoH: (() => { try { return diagSessao().duracaoH || null; } catch (e) { return null; } })(),
            riscoDeApagamento: (() => { try { return diagArmazenamentoDuravel().riscoDeApagamento; } catch (e) { return null; } })(),
            // O relato de 2026-09-22 foi todo sobre a falta de rede, e o resumo
            // não dizia nem se havia rede. A linha do tempo está no diário
            // (`rede.caiu`/`rede.voltou`); aqui vai o AGORA.
            rede: navigator.onLine,
            offline: (() => { const o = diagOfflineAgora(); return o.ligado ? o.resultado || 'ligado' : 'desligado'; })(),
            // A fila de saída em NÚMEROS. O relato de 2026-09-22 dependia dela
            // (pedido esperando envio que voltou como card) e o resumo não a
            // mencionava: estava no localStorage, cru, junto do token.
            saida: diagResumoDaSaida(),
            // A presença no mapa do WME (fase 2). Responde "não apareço no WME"
            // sem abrir o resto: ligada? a app já a viu ligada? as escritas de
            // carona estão saindo, falhando, voltando sem a marca?
            presencaWme: (() => { try { return presencaWmeDiag(); } catch (e) { return { erro: String(e && e.message) }; } })(),
            // PRIMEIRA coisa a olhar. Vazio = nenhuma invariante conhecida
            // quebrada; não significa "está tudo bem", significa "não é nenhum
            // dos defeitos que já vimos".
            alertas,
            // As sentinelas de cada CAPTURA, no instante dela (`diagNoInstante`),
            // só as que acusaram algo. É aqui que aparece o defeito que estava na
            // tela quando a pessoa tocou no botão — e que o relatório, gerado
            // depois e com o modal de Filtros por cima, não enxerga.
            alertasNasCapturas: dlogMomentos
                .filter((m) => Array.isArray(m.alertas) && m.alertas.length)
                .map((m) => ({ t: m.t, motivo: m.motivo, painel: m.painel,
                               alertas: m.alertas.map((a) => a.chave) }))
                // E as das aberturas ANTERIORES que ficaram guardadas, com a
                // abertura de cada uma: o defeito que só aparece depois de
                // fechar e reabrir foi capturado ANTES, noutra abertura.
                .concat(diagAberturasAnteriores.flatMap((a) => (a.momentos || [])
                    .filter((m) => Array.isArray(m.alertas) && m.alertas.length)
                    .map((m) => ({ t: m.t, motivo: m.motivo, painel: m.painel, abertura: a.id,
                                   alertas: m.alertas.map((x) => x.chave) }))))
                .sort((x, y) => Date.parse(x.t) - Date.parse(y.t)),
            // Quantas aberturas anteriores ficaram guardadas, e com quantas
            // capturas — a primeira pergunta de um relato que atravessa fechar
            // e reabrir a app.
            aberturasAnteriores: { n: diagAberturasAnteriores.length,
                                   capturas: diagMomentosAnteriores().length },
        },
        computado,
        // Os DOIS anéis numa linha do tempo só: o sempre-ligado (`dfato`) e o do
        // modo dev (`dlog`). Cada call site escolhe UM dos dois, então não há
        // duplicata — e o `diario` deixa de nascer vazio, que era o buraco que
        // custou a investigação dos modais achatados.
        diario: [...dfatoAnel, ...dlogAnel].sort((a, b) => a.t - b.t),
        momentos: dlogMomentos,
        // O que as aberturas ANTERIORES deixaram guardado no aparelho (só com o
        // modo dev ligado nelas): diário, chamadas sem corpo, erros e as
        // capturas não baixadas, cada abertura com o seu id, início e versão.
        // Ver `diagAberturasAnteriores`.
        aberturaAtual: { id: DIAG_ABERTURA.id, inicio: new Date(DIAG_ABERTURA.inicio).toISOString() },
        aberturasAnteriores: diagAberturasAnteriores,
        _gerado: new Date().toISOString(),
        // A seção que responde o relato "a sessão não dura": ciclos medidos em
        // horas, e o ambiente que decide se o armazenamento sobrevive.
        sessao: diagSessao(),
        armazenamentoDuravel: diagArmazenamentoDuravel(),
        app: { versao: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null,
               rotulo: typeof verLabel === 'function' ? verLabel(APP_VERSION) : null,
               url: location.href,
               idioma: typeof getLang === 'function' ? getLang() : null },
        ambiente: {
            ua: navigator.userAgent, plataforma: navigator.platform, idiomas: navigator.languages,
            online: navigator.onLine,
            conexao: { tipo: c.effectiveType, downlink: c.downlink, rtt: c.rtt, economia: c.saveData },
            standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
            tela: { w: screen.width, h: screen.height, dpr: devicePixelRatio,
                    janela: innerWidth + 'x' + innerHeight },
            fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
            escuro: matchMedia('(prefers-color-scheme: dark)').matches,
            memoria: navigator.deviceMemory, nucleos: navigator.hardwareConcurrency,
        },
        // Cookies DESTA origem. Os do Waze não estão aqui — ver o cabeçalho.
        cookiesDestaOrigem: document.cookie || '(vazio)',
        localStorage: ls,
        sessionStorage: ss,
        indexedDB: idb,
        serviceWorker: sw,
        offline: await diagOffline(),
        caches: cachesDoAparelho,
        chamadas: (typeof API !== 'undefined' && API.chamadas) || [],
        recursos,
        // Se a lista de recursos bateu no teto do navegador, o que veio DEPOIS
        // não está nela — e sem este aviso a ausência lê como "não aconteceu".
        recursosInfo: { n: recursos.length, encheu: diagRecursosCheio,
                        teto: dlogLigado() ? DIAG_RECURSOS_TETO : 'padrão do navegador (250)' },
        erros: diagErros,
        // `currentPlace` É `queue[0]` — o MESMO objeto —, então o `diagSeguro`
        // marcava um dos dois como `[circular]`, e quem perdia era sempre o card
        // que a pessoa estava VENDO. Já custou um remendo do meu lado ao ler um
        // arquivo real ("[circular]" no item 0 de 395). Aqui o `currentPlace` sai
        // como ÍNDICE, e a fila fica inteira e legível.
        appState: (() => {
            const st = typeof AppState !== 'undefined' ? AppState : null;
            if (!st) return null;
            const idx = st.currentPlace && Array.isArray(st.queue)
                ? st.queue.indexOf(st.currentPlace) : -1;
            const copia = { ...st };
            if (idx >= 0) delete copia.currentPlace;
            const fora = diagSeguro(copia);
            if (fora) fora.currentPlaceIdx = idx;
            return fora;
        })(),
        // O HTML como está AGORA, com as classes que decidem o que aparece na
        // tela. É o que mostra qual painel estava visível no momento da queixa.
        dom: document.documentElement.outerHTML,
        codigo,
        cacheVsRede,
        armazenamento,
        relogio,
    };
}

// ── Empacotar o diagnóstico ───────────────────────────────────────────────
//
// O arquivo é grande por natureza — ele carrega o código servido, a fila e o
// DOM — e MEDIDO no diagnóstico real do owner: 2,61 MB que viram **532 KB**,
// 4,9×. A compressão é do próprio navegador (`CompressionStream`), então isto
// não traz dependência nenhuma: custa ~65 linhas de container e **529 ms com
// CPU 6× mais lenta**, ao lado do segundo que a coleta já leva.
//
// ZIP e não `.gz` por duas razões práticas, nessa ordem:
//  1. O ZIP abre no PRÓPRIO celular, sem instalar nada. `.gz` é opaco no
//     Android e no iOS, e arquivo que o dono não consegue abrir é arquivo que
//     ele manda sem poder conferir o que está mandando.
//  2. O ZIP aceita MAIS DE UMA entrada — e isso resolve um problema que a
//     compressão criaria: hoje a primeira coisa dentro do JSON é o aviso de que
//     ele contém CREDENCIAL VIVA. Comprimido, esse aviso sumiria de vista. O
//     `LEIA-ME.txt` aparece na listagem de qualquer visualizador de ZIP, sem
//     extrair nada.
//
// `deflate-raw` é exatamente o que o ZIP quer no método 8 — a mesma compressão
// do gzip, sem o envelope dele.
const CRC_TAB = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TAB[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// ZIP "store or deflate", sem data/hora (campos zerados: o nome do arquivo já
// carrega o instante, e hora local dentro do pacote é um dado a mais sobre quem
// gerou). Um `DataView` little-endian, que é o que a especificação manda.
async function zipar(entradas) {
    const enc = new TextEncoder();
    const partes = [];
    for (const [nome, texto] of entradas) {
        const cru = enc.encode(texto);
        let corpo = cru, metodo = 0;
        try {
            corpo = new Uint8Array(await new Response(new Blob([cru]).stream()
                .pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
            metodo = 8;
        } catch (e) { /* sem CompressionStream: guarda cru, o ZIP segue válido */ }
        partes.push({ nome: enc.encode(nome), cru, corpo, metodo, crc: crc32(cru) });
    }
    let tam = 22;
    for (const e of partes) tam += 30 + e.nome.length + e.corpo.length + 46 + e.nome.length;
    const out = new Uint8Array(tam), dv = new DataView(out.buffer);
    const põe = (o, vals) => {
        let q = o;
        for (const [n, v] of vals) { if (n === 2) dv.setUint16(q, v, true); else dv.setUint32(q, v, true); q += n; }
        return q;
    };
    let o = 0;
    for (const e of partes) {
        e.off = o;
        o = põe(o, [[4, 0x04034b50], [2, 20], [2, 0], [2, e.metodo], [2, 0], [2, 0],
                    [4, e.crc], [4, e.corpo.length], [4, e.cru.length], [2, e.nome.length], [2, 0]]);
        out.set(e.nome, o); o += e.nome.length;
        out.set(e.corpo, o); o += e.corpo.length;
    }
    const inicioCd = o;
    for (const e of partes) {
        o = põe(o, [[4, 0x02014b50], [2, 20], [2, 20], [2, 0], [2, e.metodo], [2, 0], [2, 0],
                    [4, e.crc], [4, e.corpo.length], [4, e.cru.length],
                    [2, e.nome.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, e.off]]);
        out.set(e.nome, o); o += e.nome.length;
    }
    põe(o, [[4, 0x06054b50], [2, 0], [2, 0], [2, partes.length], [2, partes.length],
            [4, o - inicioCd], [4, inicioCd], [2, 0]]);
    return out;
}

async function baixarDiagnostico() {
    const btn = document.getElementById('diagBtn');
    if (btn) { btn.disabled = true; btn.textContent = t('filters.diag.gerando'); }
    try {
        const corpo = await diagCorpo();
        // Sem indentação quando vai comprimido: o `null, 1` existia pra o
        // arquivo ser legível a olho, e dentro do ZIP quem abre já usa um
        // visualizador. Cru continua indentado, que é o caso em que alguém vai
        // mesmo abrir no bloco de notas.
        const podeZipar = typeof CompressionStream === 'function';
        const json = JSON.stringify(corpo, null, podeZipar ? 0 : 1);
        // Começa com `diag-` e NÃO com `waze`: o guard do logout varre os
        // literais `waze*` do js/ procurando chave nova de armazenamento, e um
        // nome de arquivo com esse prefixo é indistinguível de uma chave pra
        // ele. Afrouxar o guard pra caber um nome bonito é o caminho errado.
        const base = 'diag-wazeplaces-' + new Date().toISOString().replace(/[:.]/g, '-');
        let blob, nome;
        if (podeZipar) {
            const zip = await zipar([
                ['diagnostico.json', json],
                // Visível na listagem do ZIP sem extrair nada — que é o motivo de
                // o aviso não poder ficar só dentro do JSON comprimido.
                ['LEIA-ME.txt', t('diag.leiame', { v: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?' })],
            ]);
            blob = new Blob([zip], { type: 'application/zip' });
            nome = base + '.zip';
        } else {
            // Navegador sem `CompressionStream` (iOS < 16.4). Cai pro JSON de
            // sempre em vez de falhar: o instrumento de socorro não pode ter
            // pré-requisito, senão ele falta justamente no aparelho estranho.
            blob = new Blob([json], { type: 'application/json' });
            nome = base + '.json';
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nome;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        dlogMarcarBaixados();
        // Entregue: o que estava guardado no aparelho sai (ver
        // `diagAberturasAnteriores`), e desta abertura só volta a ser guardado
        // o que acontecer daqui pra frente.
        diagBaixadoEm = Date.now();
        diagEsquecerGuardado();
        atualizarFabDev();
        showToast(t('toast.diagPronto'), 'success');
    } catch (e) {
        // O instrumento de socorro NÃO pode falhar calado: se ele quebrar,
        // ninguém descobre por que o socorro não veio.
        showToast(t('toast.diagFalhou', { erro: String((e && e.message) || e).slice(0, 80) }), 'error', 9000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = t('filters.diag.btn'); }
    }
}

async function handleUnauthorized() {
    // Concorrência é o normal aqui, não a exceção: ao abrir a app saem TRÊS
    // chamadas ao Waze quase juntas (perfil, países, busca). Sem esta trava,
    // cada uma que voltasse 401 fazia sua própria verificação e seu próprio
    // toast — foi assim que o owner recebeu DOIS "Sessão expirou" empilhados.
    // A decisão mais cara da app: derrubar ou não a sessão. Registrar as duas
    // pontas (o que motivou e o que a sonda respondeu) é o que transforma
    // "conexão instável pra sempre" em evidência.
    // O log vem ANTES da trava, e não dentro dela: assim a linha da trava fica
    // intacta pro guard que a protege (ele cobra o retorno COLADO na condição),
    // e o registro fica melhor — diz a tentativa E se ela seguiu adiante.
    dlog('sessao.confere', { seguiu: !verificandoSessao && !!AppState.authenticated });
    if (verificandoSessao || !AppState.authenticated) return;
    verificandoSessao = true;
    try {
        await new Promise((r) => setTimeout(r, VERIFICA_SESSAO_MS));
        const r = await API.getProfile();
        // Teste POSITIVO de vida, não ausência de marcador.
        //
        // Antes era `r.errorCategory !== 'unauthorized'`, o que infere "viva" de
        // NÃO encontrar um carimbo — e um 401 sem carimbo (o do nosso próprio
        // store, que não passa pelo `categorizeWazeError`) caía aqui como alarme
        // falso. A sessão morta era MANTIDA, o toast de "conexão instável"
        // aparecia a cada tentativa, e o único jeito de sair era o logout manual.
        // Foi o que aconteceu com todos os testadores no deploy da derivação de
        // chave, que invalidou as sessões existentes de uma vez.
        //
        // As três saídas agora são explícitas: respondeu → viva; disse que não
        // autoriza → morta; qualquer outra coisa (rede, 5xx, timeout) → não dá
        // pra saber, e aí NÃO se derruba ninguém, que é o que o gotcha #42 pede.
        const morta = r && (r.errorCategory === 'unauthorized'
            || r.errorKey === 'srv.err.sessionExpired'
            || r.errorKey === 'srv.err.sessionMissing'
            || r.errorKey === 'srv.err.cookiesExpired');
        if (r && !morta) {
            // Alarme falso. O pedido que falhou já foi revertido por quem o
            // chamou; aqui só recompomos o que o 401 tinha interrompido.
            if (r.success && r.profile) {
                AppState.profile = r.profile;
                guardarReferencias(r);
                guardarPerfilDoPortao(r.profile);
                renderProfileHeader();
            }
            dfato('sessao.alarmeFalso', { sondaOk: !!(r && r.success) });
            dlogCapturarAuto('alarmeFalso');
            showToast(t('toast.sessionKeptAlive'), 'info');
            rebuscarDepoisDeFalha();
            return;
        }
        // A confirmação também diz de QUAL lado falhou, e isso vira a mensagem:
        // o core já mandava chaves diferentes (`srv.err.cookiesExpired` quando o
        // Waze recusou; `srv.err.sessionExpired` quando a nossa sessão sumiu) e
        // o frontend juntava as duas numa frase só. Separar transforma a próxima
        // ocorrência em EVIDÊNCIA — dá pra saber de onde veio sem HAR nem
        // exportar cookie de novo — e ainda diz ao editor algo que ele pode
        // usar: "o Waze recusou" e "você ficou fora tempo demais" pedem cuidados
        // diferentes, mesmo que a ação seja a mesma.
        derrubarSessao(r && r.errorKey);
    } finally {
        verificandoSessao = false;
    }
}

// Chave do core → frase que o editor lê. Chave desconhecida cai na frase
// genérica de sempre: mensagem vaga é ruim, mensagem errada é pior.
const MOTIVO_DA_QUEDA = {
    'srv.err.cookiesExpired': 'toast.sessionExpired.waze',
    'srv.err.sessionExpired': 'toast.sessionExpired.local',
};

function derrubarSessao(errorKey) {
    // A queda é a decisão mais cara da app e era a ÚNICA que não chegava ao
    // anel sem portão: havia `dlog('sessao.confere')`, que o dev mode desligado
    // engole, e `dfato` só no ALARME FALSO — ou seja o caso em que ela NÃO cai.
    // O testador liga o dev mode DEPOIS do problema, então sem isto o evento
    // some exatamente para quem precisa relatá-lo.
    //
    // O prazo entra aqui porque o `esquecerPrazoDaSessao()` logo abaixo o apaga
    // — com razão, senão a próxima entrada nasce com a contagem da sessão morta
    // na tela. Ele sai da TELA e fica no REGISTRO.
    const prazoQueMorreu = AppState.sessaoExpiraEm || Number(safeLS.get(SESSAO_KEY)) || null;
    dfato('sessao.caiu', { motivo: errorKey || null });
    registrarEventoDeSessao('caiu', {
        motivo: errorKey || null,
        prazo: prazoQueMorreu || null,
        // Faltava muito, ou já tinha vencido? É o que separa "caiu antes da
        // hora" de "venceu como esperado", sem eu ter que cruzar datas à mão.
        faltavamH: prazoQueMorreu ? Math.round((prazoQueMorreu - Date.now() / 1000) / 360) / 10 : null,
    });
    // Cancela ação pendente: a sessão já morreu no Waze, o executor falharia e
    // mostraria "erro ao marcar" na tela de login. Cancelar reverte o stat otimista.
    if (AppState.pendingAction) {
        AppState.pendingAction.cancel();
        AppState.pendingAction = null;
    }
    removeUndoBanner();
    API.setSession(null);
    AppState.profile = null;
    AppState.authenticated = false;
    // O prazo era desta sessão, que acabou de morrer. Deixá-lo guardado faria a
    // próxima entrada nascer com a contagem da sessão ANTERIOR na tela, até a
    // primeira resposta do Waze corrigir.
    esquecerPrazoDaSessao();

    // Antes de mandar pra tela de login, PERGUNTA à extensão — em silêncio.
    //
    // A sessão da app venceu, mas o login do editor no WME quase sempre não:
    // são prazos diferentes. Quem tem a extensão renova sem sair do lugar, e a
    // fila continua na tela. Só quem não tem (ou está deslogado do WME) vê o
    // toast e cai no login — por isso o aviso é ADIADO até a extensão falhar:
    // avisar antes seria assustar quem nem ia ser interrompido.
    entrarPelaExtensao({ silencioso: true }).then((renovou) => {
        if (renovou) {
            showToast(t('toast.sessionRenewed'), 'info');
            rebuscarDepoisDeFalha();
            return;
        }
        showToast(t(MOTIVO_DA_QUEDA[errorKey] || 'toast.sessionExpired'), 'error', 9000);
        setTimeout(() => showAuthScreen(), UNAUTHORIZED_REDIRECT_MS);
    });
}

// ── A foto de perfil espera o primeiro card ──────────────────────────────
// Ela é a imagem MAIS PESADA da app e a MENOS importante: 214 KB vindos do
// Waze para aparecer com 32px no cabeçalho, e não existe variante menor
// (sondadas 5 formas de URL, todas devolvem os mesmos 218 KB). O
// `fetchpriority="low"` já a tirou da frente na fila de prioridades, mas os
// bytes continuavam disputando a banda — em 1,6 Mbps são mais de um segundo de
// cano, no exato momento em que o editor espera VER o pedido. Medido no
// relatório de produção: 213 dos 249 KB de economia de imagem eram só ela.
//
// Então ela nem começa a ser buscada antes do primeiro card estar na tela.
// Depois disso ainda espera a thread ficar ociosa — com `timeout`, porque
// página ocupada pode nunca ficar ociosa e aí o avatar nunca chegaria.
//
// A CAIXA fica reservada desde o começo (o `w-8 h-8` com fundo cinza do
// index.html), então quando a foto chega nada se move: trocar peso por
// deslocamento de layout seria péssimo negócio.
let avatarPendente = null;
let telaPronta = false;
// A URL que FALHOU, pra não tentar de novo e — principalmente — pra o ícone de
// imagem quebrada não voltar: `renderProfileHeader` roda a cada troca de idioma
// e reexibiria o <img> morto.
//
// Isto existe por causa de um caso REAL (v2026.09.14-01): o Waze mudou o
// endereço da foto de perfil de `social-row.waze.com/SocialMediaServer/images/
// profile/<id>` pra `sms-profile-image.waze.com/<id>`, que a CSP não conhecia.
// A imagem foi BLOQUEADA antes da rede (medido no HAR do owner: status 0 em
// 0,06 ms, sem IP de servidor) e o cabeçalho passou a mostrar o ícone de
// quebrado. O host novo entrou na CSP, mas isso conserta ESTE endereço, não a
// próxima mudança — e o Waze não avisa quando muda. Foto de terceiro que some
// tem que degradar pro estado que a app já tem pra "perfil sem foto".
let avatarFalhou = null;

function liberarAvatar() {
    if (!avatarPendente || !telaPronta) return;
    const url = avatarPendente;
    avatarPendente = null;
    const carregar = () => {
        const el = document.getElementById('userAvatar');
        // `authenticated` de novo aqui: entre o agendamento e o disparo cabe um
        // logout, e aí a busca sairia já na tela de entrada.
        if (!el || !AppState.authenticated) return;
        // `error` cobre TODOS os modos de falha desta imagem com um caminho só:
        // CSP bloqueando, host fora do ar, 404 e rede caída.
        el.onerror = () => {
            avatarFalhou = url;
            el.style.display = 'none';
            // SÓ o host — é o que muda quando o Waze move a foto de lugar, e é
            // a pergunta que custou um print de celular e um HAR pra responder.
            // Nome e id do editor ficam de fora (dado de terceiro no `dfato`).
            let host = '?';
            try { host = new URL(url).host; } catch (e) {}
            dfato('avatar.falhou', { host });
        };
        el.onload = () => { avatarFalhou = null; };
        el.src = url;
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(carregar, { timeout: 2000 });
    else setTimeout(carregar, 800);
}

// Chamado de onde a tela DEIXA de depender da rede. Fila vazia e erro de carga
// contam: sem eles, quem abre com tudo tratado ficaria no cinza para sempre.
// Idempotente de propósito — roda a cada swipe.
function marcarTelaPronta() {
    if (telaPronta) return;
    telaPronta = true;
    liberarAvatar();
}

function renderProfileHeader() {
    const p = AppState.profile;
    if (!p) return;
    const badge = document.getElementById('userProfileBadge');
    const avatar = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    const rankEl = document.getElementById('userRank');
    // A falha degrada pro MESMO estado de "perfil sem foto" (o `else` abaixo),
    // que a app já tinha — em vez do ícone de quebrado do navegador.
    if (p.profileImageUrl && p.profileImageUrl !== avatarFalhou) {
        avatar.style.display = '';
        // Já é esta a foto? Não mexe. Esta função roda de novo a cada troca de
        // idioma, e reatribuir o `src` faz o navegador re-decodificar à toa.
        if (avatar.getAttribute('src') !== p.profileImageUrl) {
            avatarPendente = p.profileImageUrl;
            liberarAvatar();
        }
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
    if (p.totalPoints) pstats.push(t('profile.points', { n: Number(p.totalPoints) }));
    if (p.totalEdits) pstats.push(t('profile.edits', { n: Number(p.totalEdits) }));
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
    AppState.filters = { types: TYPES_PADRAO.slice(), residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true };
    AppState.preferences = { undoEnabled: true, presenca: true };
    AppState.devMode = { unlocked: false, active: false };
    // O que o modo dev gravou sai junto — as capturas desta abertura (em
    // memória) e as das anteriores (guardadas no aparelho). Elas levam o DOM,
    // com nome e endereço dos pedidos na tela: "sair é sair de tudo". Antes
    // disto as da memória ficavam até a página fechar, e iriam no relatório de
    // quem entrasse depois e ligasse o modo dev.
    dlogApagar();
    AppState.profile = null;
    presencaWmeZerar();              // o freio e os contadores eram de quem saiu
    AppState.authenticated = false;
    AppState.pendingAction = null;
    AppState.inFlightActions = 0;
    AppState.history = {};
    safeLS.remove(HISTORY_KEY); // logout = esquecer tudo (inclui histórico)
    safeLS.remove(CONQUISTAS_KEY);   // patente, conquistas e contadores somem junto
    AppState.conquistas = null;
    atualizarSeloDeConquista();      // o selo é estado de quem entrou: sai junto
    // "Sair limpa tudo" não tem exceção que ninguém decidiu: este marcador (o
    // "Agora não" do convite de instalar) ficava pra trás só por descuido.
    safeLS.remove(CHAVE_INSTALL_DISPENSADO);
    safeLS.remove(PERFIL_GATE_KEY);   // rank do último perfil: some com o resto
    esquecerAutores();  // contagem por autor: é dado de TERCEIRO, sai primeiro
    // Fecha a conexão da sala e apaga os bloqueios: são escolhas de quem
    // entrou, não preferência do aparelho.
    window.Presenca?.esquecer?.();
    esquecerPrazoDaSessao(); // prazo da sessão do Waze: some com o resto
    // O diário de sessões e o carimbo de nascimento são do APARELHO, mas saem
    // aqui assim mesmo: o contrato do "Sair" é "limpar de tudo", sem exceção
    // que ninguém decidiu — foi por descuido assim que o marcador do convite de
    // instalar ficou pra trás. E não cega a investigação: quem deu Sair SABE
    // que deu, e o caso investigado é o de quem NÃO saiu e perdeu a sessão.
    registrarEventoDeSessao('saiu');   // fica no anel até a linha seguinte apagá-lo
    safeLS.remove(SESSOES_KEY);
    safeLS.remove(NASCIMENTO_KEY);
    // A fila de saída guarda venueID, updateRequestID e o creatorId de QUEM
    // MANDOU o pedido — dado de terceiro. Sai com o resto, e o efeito assumido
    // é que sair com a fila cheia descarta o que ainda não foi enviado: é
    // exatamente o que "sair é sair de tudo" promete.
    safeLS.remove(SAIDA_KEY);
    // O que foi decidido nesta página (ids de pedidos de terceiros, em memória).
    // Quem entrar depois começa do zero: a fila dele vem da busca dele.
    pousosDaPagina.clear();
    pedidosEmAndamento.clear();
    // A fila guardada tem nome de quem enviou e foto de terceiro. "Sair e sair
    // de tudo" nao abre excecao que ninguem decidiu. Leva junto os pousos
    // gravados (`OFFLINE_POUSOS_KEY`).
    offlineEsquecer();
    avatarPendente = null;   // a próxima entrada volta a esperar o primeiro card
    avatarFalhou = null;     // outro editor pode ter foto onde este não tinha
    // Casa, trabalho e posição são dado de LOCALIZAÇÃO do editor: sair é sair.
    referenciasDoPerfil = null;
    posicaoGps = null;
    telaPronta = false;
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
    AppState.ordemPendente = false;     // a fila vai embora; não há ordem a aplicar
    AppState.queue = [];
    AppState.nextPage = 1;
    AppState.hasMore = true;
    AppState.emptyPagesInRow = 0;
    // Gesto explícito (atualizar, filtro, tentar de novo) recomeça a conta.
    rebuscasAuto = 0;
    AppState.currentPlace = null;
    AppState.serverTotal = 0;
    AppState.serverBlocked = 0;
    AppState.blockedPartial = false;
    AppState.loadError = false;
    updatePendingCount();
}

function showLoading(visible) {
    const el = document.getElementById('loadingCard');
    if (!el) return;
    // O DIÁRIO anota a TRANSIÇÃO, nunca a chamada: o `renderCurrentCard` chama
    // isto a cada card montado — ou seja a cada swipe —, e o `dfato` é anel de
    // 120 sem portão; anotado por chamada, ele engoliria o resto do diário.
    // Com a transição, a linha do tempo do relato de 2026-09-22 teria saído
    // pronta: "carregando" desde a abertura, primeiro card 89 ms depois, e o
    // "carregando" NUNCA saindo.
    const estava = !el.classList.contains('hidden');
    el.classList.toggle('hidden', !visible);
    if (estava !== !!visible) dfato('tela.carregando', { visivel: !!visible });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Perto de mim — ordenar a fila por DISTÂNCIA
// ═══════════════════════════════════════════════════════════════════════════
//
// Três ordens novas no mesmo select de "Ordenar por": casa, trabalho e GPS. O
// celular sabe onde você está e o WME de mesa não, e um pedido a 900 m é um
// pedido que talvez você conheça de verdade.
//
// MEDIDO na fila real do owner (374 pedidos, Brasil inteiro): ordenando por
// casa, só 2 dos 20 primeiros coincidem com a ordem atual — ou seja, isto
// mostra pedidos que hoje ficam enterrados. São 1 a menos de 1 km, 9 dentro de
// 20 km e 19 dentro de 100 km, invisíveis numa fila por data.
//
// A REFERÊNCIA NÃO MORA NO AppState, e isso não é estilo: o `AppState` inteiro
// entra no diagnóstico que o editor manda por WhatsApp, e a coordenada da casa
// dele não pode viajar junto com um relato de bug. Por isso ela vive aqui, em
// escopo de módulo, e some no logout junto com o resto.
let referenciasDoPerfil = null;   // { casa: [lat, lon]|null, trabalho: [lat, lon]|null }
let posicaoGps = null;            // { ll: [lat, lon], precisaoM } — NUNCA persistida

// As ordens que medem distância em vez de data.
const ORDENS_POR_DISTANCIA = ['casa', 'trabalho', 'gps'];
// O ícone de cada ordem. Ele vivia DENTRO do texto no dicionário, e isso
// custava duas coisas:
//
// (a) **vazava pra prosa** — `filters.sort.hint.negado` interpola o rótulo da
//     ordem padrão numa frase ("a ordem voltou pra «…»"), e com o emoji no
//     texto a frase ganhava um 🆕 no meio, entre aspas;
// (b) o dicionário passava a carregar DECORAÇÃO, então a régua "o mesmo
//     conceito usa o mesmo ícone em toda a app" ficava espalhada por 4 línguas
//     em vez de num lugar só — e conferível por ninguém.
//
// Aqui o ícone é do CONCEITO (a ordem), não da tradução: um mapa só, e o
// dicionário volta a ser texto. Ordem nova entra aqui e no dicionário.
const ORDEM_ICONE = Object.freeze({
    newest: '🆕', oldest: '⏳', casa: '🏠', trabalho: '💼', gps: '📍',
});
const rotuloDaOrdem = (ordem) =>
    (ORDEM_ICONE[ordem] ? ORDEM_ICONE[ordem] + ' ' : '') + t('filters.sort.' + ordem);
const ORDEM_PADRAO = 'newest';

function referenciaDaOrdem(ordem) {
    if (ordem === 'gps') return posicaoGps && posicaoGps.ll;
    if (ordem === 'casa') return referenciasDoPerfil && referenciasDoPerfil.casa;
    if (ordem === 'trabalho') return referenciasDoPerfil && referenciasDoPerfil.trabalho;
    return null;
}

// Haversine, em km, entre dois pares [lat, lon].
//
// O core tem `distanciaEntrePontos`, e ele NÃO serve aqui por dois motivos:
// é módulo de servidor (o app.js é script clássico, não importa de lá) e é
// equiretangular, calibrado pra menos de 1 km. Aqui a fila cobre o país
// inteiro — medido, de 0,9 km a 2.830 km — e nessa escala a aproximação
// reordena. A ordem É o produto deste recurso.
function distanciaKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// A coordenada do pedido, SEMPRE [lat, lon].
//
// CUIDADO COM A ORDEM — as duas pontas do app usam ordens diferentes e isso já
// me pegou: `place.mapa.centro` vem do `pontoDeGeometria` do core, que INVERTE
// o GeoJSON de propósito e devolve [lat, lon]; o `homeLocation` do Waze é
// GeoJSON CRU, [lon, lat], e o core já o converte antes de mandar. Ler o centro
// como [lon, lat] não dá erro: dá uma ordenação plausível e ERRADA (medido:
// 500 pedidos "a ~4.000 km", todos praticamente iguais).
function pontoDoPlace(p) {
    const c = p && p.mapa && p.mapa.centro;
    if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) return c;
    if (Number.isFinite(p && p.lat) && Number.isFinite(p && p.lon)) return [p.lat, p.lon];
    return null;
}

// Ordena a fila por data do pedido conforme AppState.filters.sortOrder. Client-side:
// o Waze devolve tudo de uma vez, então ordenar localmente é confiável (B6).
function sortQueue() {
    const ref = referenciaDaOrdem(AppState.filters.sortOrder);
    if (ref) {
        AppState.queue.sort((a, b) => {
            // Pedido SEM coordenada vai pro FIM — a MESMA regra que o sort por
            // data já usa pra pedido sem data. "Não dá pra ordenar" não é
            // "primeiro da fila". Medido: 0 de 374 na fila do owner, mas o
            // core devolve `mapa: null` quando não há coordenada nenhuma.
            const da = pontoDoPlace(a), db = pontoDoPlace(b);
            if (!da) return db ? 1 : 0;
            if (!db) return -1;
            return distanciaKm(ref, da) - distanciaKm(ref, db);
        });
        return;
    }
    const asc = AppState.filters.sortOrder === 'oldest';
    AppState.queue.sort((a, b) => {
        // Pedido SEM data vai pro FIM, nos dois sentidos — e o `|| 0` que
        // estava aqui fazia o contrário. Um `dateAdded` nulo virava 0, que em
        // "mais antigos" é o mais antigo possível: o pedido cravava a posição
        // 0 da fila e ficava lá, em toda abertura da app, para sempre.
        //
        // É EXATAMENTE o sintoma que o owner relatou em 2026-09-10 (por outra
        // causa: o rótulo de idade ambíguo). Não estava ativo na fila dele —
        // medido, 370 de 370 com data —, mas o core devolve `ur.dateAdded ??
        // null` (core.mjs:1836), então basta o Waze omitir o campo em UM
        // pedido pra reproduzir o mesmo "isto não sai da minha frente" sem
        // nada na tela explicando.
        //
        // Sem data não é "mais antigo", é DESCONHECIDO — e o fim da fila é o
        // lugar honesto pra isso nas duas ordenações.
        const da = Number.isFinite(a && a.dateAdded) ? a.dateAdded : null;
        const db = Number.isFinite(b && b.dateAdded) ? b.dateAdded : null;
        if (da === null) return db === null ? 0 : 1;
        if (db === null) return -1;
        return asc ? da - db : db - da;
    });
}

// Pede a posição ao aparelho. APROXIMADA de propósito (`enableHighAccuracy:
// false`): pra ORDENAR uma fila, errar 1 km não muda a ordem que importa, e
// ligar o GPS fino acende o rádio e demora — a pessoa pediu uma ordem, não uma
// rota. Quem decide a precisão de verdade é o sistema: no Android 12+ a pessoa
// escolhe "precisa" ou "aproximada" ao conceder, e a app não força nada.
//
// NUNCA é chamada na abertura: só quando o editor ESCOLHE "Perto de mim" no
// filtro. Permissão pedida sem gesto é a interrupção que a régua da casa proíbe.
// Só aceita par numérico: o servidor pode mudar e um `null`/string aqui viraria
// NaN na distância, que ordena de forma imprevisível em vez de falhar.
const parDeCoordenadas = (v) =>
    (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null);

// Guarda casa/trabalho da resposta do perfil. Fora do AppState, de propósito.
function guardarReferencias(res) {
    const r = res && res.referencias;
    referenciasDoPerfil = r
        ? { casa: parDeCoordenadas(r.casa), trabalho: parDeCoordenadas(r.trabalho) }
        : null;
    // A referência pode chegar DEPOIS da primeira página (perfil e fila são
    // buscados em paralelo). Sem isto, quem salvou "perto de casa" veria a
    // primeira fila da sessão em ordem de data com o filtro dizendo outra
    // coisa. Só reordena antes de haver card na tela: re-ordenar por baixo de
    // um card já exibido trocaria o topo da fila sem trocar o que se vê.
    if (!AppState.currentPlace
        && ORDENS_POR_DISTANCIA.includes(AppState.filters.sortOrder)
        && referenciaDaOrdem(AppState.filters.sortOrder)) {
        sortQueue();
    }
}

const GPS_TIMEOUT_MS = 10000;
function pedirPosicao() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ ll: [pos.coords.latitude, pos.coords.longitude],
                               precisaoM: Math.round(pos.coords.accuracy || 0) }),
            // Negar, expirar e "indisponível" caem no MESMO lugar de propósito:
            // pro editor os três são "não deu", e a saída é a mesma.
            () => resolve(null),
            { enableHighAccuracy: false, timeout: GPS_TIMEOUT_MS, maximumAge: 300000 }
        );
    });
}

// A linha sob o select: de onde sai a referência, e o que houve com a permissão.
function atualizarDicaDeOrdem(estado) {
    const el = document.getElementById('filterSortHint');
    if (!el) return;
    const cores = {
        neutro: 'text-slate-500 dark:text-slate-400',
        ok: 'text-emerald-700 dark:text-emerald-400',
        alerta: 'text-amber-700 dark:text-amber-300',
    };
    const mapa = {
        perfil: ['filters.sort.hint.perfil', 'neutro', {}],
        pedindo: ['filters.sort.hint.pedindo', 'neutro', {}],
        ok: ['filters.sort.hint.ok', 'ok', { m: (posicaoGps && posicaoGps.precisaoM) || 0 }],
        negado: ['filters.sort.hint.negado', 'alerta', { padrao: t('filters.sort.' + ORDEM_PADRAO) }],
    };
    const item = mapa[estado];
    el.classList.toggle('hidden', !item);
    if (!item) return;
    el.className = 'text-[0.6875rem] mt-1 ' + cores[item[1]];
    el.textContent = t(item[0], item[2]);
}

// Monta as opções do "Ordenar por". As de DISTÂNCIA só entram quando há de onde
// medir: casa/trabalho dependem do perfil no WME (nem todo editor cadastrou) e o
// GPS depende de o aparelho ter a API. Oferecer o que não dá pra cumprir é beco
// sem saída — a mesma régua que tirou a extensão de Chrome da frente no celular.
// Uma ordem só vale se houver de onde medir AGORA: perfil sem casa, aparelho
// sem GPS ou permissão negada caem no padrão. Sem esta peneira, `sortOrder`
// ficaria num valor que o `sortQueue` ignora — a fila sairia por data com o
// filtro afirmando distância, calado.
function ordemValida(v) {
    if (v === 'oldest' || v === 'newest') return v;
    if (ORDENS_POR_DISTANCIA.includes(v) && referenciaDaOrdem(v)) return v;
    return ORDEM_PADRAO;
}

function popularOrdenacoes() {
    const sel = document.getElementById('filterSort');
    if (!sel) return;
    const disponivel = {
        casa: !!(referenciasDoPerfil && referenciasDoPerfil.casa),
        trabalho: !!(referenciasDoPerfil && referenciasDoPerfil.trabalho),
        gps: !!(typeof navigator !== 'undefined' && navigator.geolocation),
    };
    for (const ordem of ORDENS_POR_DISTANCIA) {
        const existente = sel.querySelector('option[value="' + ordem + '"]');
        if (!disponivel[ordem]) { if (existente) existente.remove(); continue; }
        const opt = existente || document.createElement('option');
        opt.value = ordem;
        opt.textContent = rotuloDaOrdem(ordem);
        if (!existente) sel.appendChild(opt);
    }
    // As duas de DATA vivem no HTML com `data-i18n`, então o `applyI18n` reescreve
    // o textContent delas e levaria o ícone junto. Decorar aqui é o que mantém as
    // cinco opções com a mesma régua — e é por isso que a troca de idioma chama
    // esta função DEPOIS do `applyI18n` (ver `aplicarIdioma`).
    for (const ordem of ['newest', 'oldest']) {
        const opt = sel.querySelector('option[value="' + ordem + '"]');
        if (opt) opt.textContent = rotuloDaOrdem(ordem);
    }
    // Ordem salva que não existe mais neste perfil/aparelho volta ao padrão em
    // vez de deixar o select num valor fantasma (que o browser mostra VAZIO).
    if (!sel.querySelector('option[value="' + sel.value + '"]')) sel.value = ORDEM_PADRAO;
}

// Trocar pra "Perto de mim" PEDE a posição na hora, e não no Aplicar: o
// resultado da permissão precisa caber na mesma tela em que a escolha foi feita.
// Negado, a ordem volta sozinha pro padrão — deixar "Perto de mim" selecionado
// sem posição seria um filtro que mente sobre o que vai fazer.
async function aoTrocarOrdenacao() {
    const sel = document.getElementById('filterSort');
    if (!sel) return;
    if (sel.value !== 'gps') {
        atualizarDicaDeOrdem(sel.value === 'casa' || sel.value === 'trabalho' ? 'perfil' : null);
        return;
    }
    if (posicaoGps) { atualizarDicaDeOrdem('ok'); return; }
    atualizarDicaDeOrdem('pedindo');
    const pos = await pedirPosicao();
    // A pessoa pode ter mudado o select enquanto o prompt estava aberto.
    if (sel.value !== 'gps') return;
    if (!pos) {
        posicaoGps = null;
        sel.value = ORDEM_PADRAO;
        atualizarDicaDeOrdem('negado');
        dfato('gps.negado');
        return;
    }
    posicaoGps = pos;
    atualizarDicaDeOrdem('ok');
    dfato('gps.ok', { precisaoM: pos.precisaoM });
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

    // VIGIA a busca: fila congelada não grita, a tela só para — e "parece que
    // acabou o trabalho" ninguém reporta. Ideia do botequei, onde o watchdog
    // flagrou o GPS preso no prompt comendo check-ins.
    dlogVigiar('buscar');
    // O instante em que a LISTA é pedida. Decisão que pousar depois disto pode
    // ou não estar refletida no que o Waze devolver — e por isso sai no filtro
    // (`semOsJaDecididos`). O que pousou antes, a lista já reflete.
    const inicioDaBusca = Date.now();
    AppState._fetchPromise = (async () => {
        try {
            const result = await API.fetchPlaces(pageToFetch, filters);
            if (epoch !== AppState.fetchEpoch) return; // reset durante o fetch → descarta
            if (!result.success) {
                dlogVoltou('buscar');
                dfato('busca.falhou', { key: result.errorKey || null,
                                        cat: result.errorCategory || null });
                dlogCapturarAuto('buscaFalhou');
                if (result.errorCategory === 'unauthorized' ||
                    (result.error && result.error.toLowerCase().includes('sess'))) {
                    AppState.hasMore = false;
                    // `loadError` TAMBÉM aqui, e a falta dele foi o defeito que o
                    // owner viu: "Tudo limpo!" sobre 217 pedidos pendentes.
                    //
                    // Este ramo confia no `handleUnauthorized` pra recompor — ou
                    // ele derruba pra tela de entrar (sessão morta), ou ele
                    // rebusca (alarme falso). Só que ele tem uma TRAVA de
                    // concorrência (`verificandoSessao`): ao abrir a app saem
                    // três chamadas quase juntas, e a segunda que chega encontra
                    // a trava fechada e volta NA HORA, sem derrubar e sem
                    // rebuscar. A rebusca do alarme falso também reentra aqui e
                    // encontra a própria trava. Em qualquer desses caminhos
                    // sobrava fila vazia + `hasMore: false` + `loadError: false`,
                    // que o `showNoPlaces` desenha como "Tudo limpo!".
                    //
                    // Marcar aqui é seguro porque quem REBUSCA limpa: o
                    // `startFetching` zera `loadError` antes de tentar. Ou seja,
                    // a flag só sobrevive quando de fato ninguém recompôs — que é
                    // exatamente quando a tela precisa dizer "Falha ao carregar"
                    // com o botão de tentar de novo.
                    //
                    // O comentário do `showNoPlaces` já dizia a intenção desde
                    // sempre ("o editor acharia que zerou o backlog"); faltava
                    // este ramo. E é o pior defeito possível pela régua do
                    // próprio projeto: "parece que acabou o trabalho" ninguém
                    // reporta — o editor fecha a app achando que terminou.
                    AppState.loadError = true;
                    handleUnauthorized();
                } else {
                    // UM anúncio só. Com a fila vazia o `showNoPlaces` desenha
                    // o painel de erro inteiro, e o toast repete o mesmo fato no
                    // RODAPÉ — onde ficam os botões do card. Com card na tela o
                    // painel não aparece, e aí o toast é o único sinal: fica.
                    //
                    // Este é o ramo que de fato pinta o toast vermelho que o
                    // owner viu: o `api.js` RETORNA a falha em vez de lançar,
                    // então o `catch` lá embaixo nem roda. Silenciar só o catch
                    // era mirar no lugar errado — medido na tela, com 2 toasts.
                    if (!!AppState.currentPlace || AppState.queue.length > 0) {
                        showToast(msgDoServidor(result, t('toast.loadPlacesError')), 'error');
                    }
                    AppState.loadError = true;
                    AppState.hasMore = false;
                }
                return;
            }

            dlogVoltou('buscar');
            dlog('busca.ok', { n: (result.places || []).length, hasMore: !!result.hasMore,
                               page: pageToFetch, total: result.total });
            AppState.hasMore = !!result.hasMore;
            AppState.nextPage++;
            // Busca que deu certo encerra a cadeia: o teto é de tentativas
            // SEGUIDAS sem sucesso, não da vida da sessão.
            rebuscasAuto = 0;
            // Esta é a chamada que se repete, então é ela que mantém o prazo em
            // dia: se o editor relogar no WME, o Waze passa a mandar um `Expires`
            // novo e o aviso some sozinho, sem a app precisar perguntar nada.
            guardarPrazoDaSessao(result);

            // D13: acumula igual ao serverTotal (uma busca pode vir em páginas).
            // Backend antigo não manda o campo → 0, e a dica simplesmente não aparece.
            AppState.serverBlocked += Number(result.blocked) || 0;

            // O que este aparelho já decidiu não entra de novo — ver
            // `semOsJaDecididos`. A contagem abaixo (`serverTotal`) é a da lista
            // FILTRADA: "Restam" é o que falta fazer, e o que está saindo já foi
            // feito.
            const filtrada = semOsJaDecididos(result.places || [], inicioDaBusca);
            if (filtrada.excluidos) dfato('busca.jaDecididos', { n: filtrada.excluidos });
            const newPlaces = filtrada.places;
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
                // Guardar o texto NAO custa requisicao: ele acabou de chegar.
                // Sai calado quando o toggle esta desligado. O `desde` é o
                // começo da BUSCA, não a hora de gravar: é dali que a lista é.
                offlineGravarFila(inicioDaBusca);
                AppState.serverTotal += newPlaces.length;
                trackSeenCategories(newPlaces);
                // Reordenar AQUI, com um card já na tela, quebra a invariante de
                // que o card exibido é o `queue[0]` — e o resto da app inteira
                // conta com ela. `advanceQueue` remove o TOPO (`shift`), mas a
                // ação é enviada pro `currentPlace`: divergindo os dois, a app
                // rejeita o que você vê e apaga OUTRO da fila, que some sem ser
                // tratado — e o seu volta na sua frente depois. MEDIDO no
                // navegador nas três ordens (recentes, antigos e perto de casa).
                // O aquecimento tem o mesmo prejuízo: ele mira no `queue[1]` do
                // instante em que dispara e não roda de novo, então baixa foto
                // que não vai aparecer e deixa de baixar a que vai.
                //
                // O outro ponto que reordena (`guardarReferencias`) já tinha
                // essa proteção, com o motivo escrito; este ficou sem.
                if (AppState.currentPlace) AppState.ordemPendente = true;
                else sortQueue();
                aplicarRecusaAutomatica();
            }
        } catch (error) {
            dlogVoltou('buscar');
            dlog('busca.erro', { erro: String((error && error.message) || error).slice(0, 120) });
            console.error('fetchNextPage error', error);
            if (epoch === AppState.fetchEpoch) {
                // O toast só fala quando o PAINEL não vai falar. Com a fila
                // vazia o `showNoPlaces` desenha o estado de erro inteiro, e
                // somar um toast vermelho é anunciar o mesmo fato duas vezes —
                // com o agravante de que ele pousa no rodapé, onde ficam os
                // botões do card. Com card na tela o painel NÃO aparece, e aí
                // o toast é o único sinal: ele continua.
                const temCard = !!AppState.currentPlace || AppState.queue.length > 0;
                if (temCard) showToast(t('toast.loadPlacesError'), 'error');
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
    // querySelectorAll, e não querySelector: desde a pilha existem DOIS
    // `.place-card` na tela (o da frente e o de fundo). Com `querySelector`
    // esta função tirava só um deles — e qual seria dependia da ordem do DOM,
    // o que é a pior forma de decidir: some o card errado e sobra um pedido
    // fantasma na tela, sem erro nenhum. Todos os 10 chamadores querem dizer
    // "limpa a área do card", então limpar tudo é o que eles já pediam.
    cardStack.querySelectorAll('.place-card').forEach((e) => e.remove());
}

// O card que o editor está TRATANDO — nunca o de fundo, que é só o próximo
// pedido espiando por baixo. FONTE ÚNICA de propósito: `document.querySelector
// ('.place-card')` estava em 9 lugares e passou a ser ambíguo no dia em que a
// pilha nasceu. Dois deles eram graves — o `triggerSwipe` (botão e teclado)
// mandaria SAIR o card errado, e o `aplicarTravaDeAcao` travaria o de fundo
// deixando os botões do da frente vivos durante o Desfazer. Nenhum dos dois dá
// erro no console: a tela simplesmente faz outra coisa.
function cardDaFrente() {
    return document.querySelector('#cardStack .place-card:not(.card-fundo)');
}

// ── "Como funciona": uma vez, no primeiro card ────────────────────────────
// Os três botões do card só têm `aria-label` e `title` — e `title` NÃO existe no
// toque. No celular, quem nunca usou vê três círculos coloridos e adivinha. Não
// havia nada explicando em lugar nenhum da app.
//
// A alternativa era rótulo fixo sob cada botão, e ela foi medida e recusada:
// custa 20px de FOTO em todo card, pra sempre (329 → 309px no iPhone; 181 → 160
// no Fold), pra ensinar o que se aprende uma vez. Este aviso custa zero pixel
// permanente.
//
// Mora no `preferences` (que já é persistido e já é apagado no logout) de
// propósito: chave nova no localStorage exigiria decisão de logout própria e
// entraria na varredura do test/layout — e não há nada aqui que justifique uma.
function mostrarComoFuncionaSePrimeiraVez() {
    if (AppState.preferences.comoFuncionaVisto) return;
    // Só quando existe card na tela: o aviso fala dos botões DELE, e aparecer
    // sobre "Tudo limpo!" ou sobre o esqueleto de carregamento explicaria algo
    // que a pessoa não está vendo.
    if (!AppState.currentPlace || !cardDaFrente()) return;
    AppState.preferences.comoFuncionaVisto = true;
    savePreferences();
    abrirComoFunciona();
}

// Direto no `openModal`, mesmo vindo da Ajuda: ele JÁ esconde o modal anterior
// sem passar pelo `closeModal`, e só empilha histórico quando não havia nenhum
// aberto. Minha primeira versão fechava a Ajuda antes "para não empilhar" — e
// era exatamente isso que quebrava: `closeModal` CONSOME a entrada do histórico
// e o `openModal` seguinte, vendo nenhum modal aberto, empilhava outra. Medido,
// o Esc depois disso levava a `about:blank` — a pessoa saía da app inteira.
function abrirComoFunciona() {
    openModal('comoFuncionaModal');
}

// O tipo do pedido, em UMA função: o rótulo visível e o que o leitor de tela
// ANUNCIA têm que dizer a mesma coisa, no mesmo idioma. Eram duas cópias, e a
// da região viva nunca foi traduzida (ver o comentário no call site).
//
// "Reporte (Sinalização)" não diz o que foi reportado; quando é foto, o WME
// chama de "Foto sinalizada", e o card marca QUAL das fotos é.
// `updateTypeKey` é a chave crua (VENUE, IMAGE, FLAG…); o `updateType` em
// português segue vindo do core e serve de último recurso, pra chave nova
// nunca deixar o campo vazio — feio, nunca invisível.
function rotuloDoTipo(place) {
    if (!place) return '';
    if (Array.isArray(place.changes) && place.changes.length > 0) return t('card.type.update');
    if (place.flagSubjectType === 'IMAGE') return t('card.type.flagImage');
    return rotuloDeEnum('card.updateType.', place.updateTypeKey) || place.updateType || '';
}

function showCurrentPlace() {
    marcarTelaPronta();   // libera a foto de perfil (ver `liberarAvatar`)
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
        return;
    }
    // FORA do try de propósito: uma falha aqui não pode fazer o card ser tratado
    // como quebrado e o pedido ser DESCARTADO (o catch acima faz `queue.shift()`
    // e decrementa o total). O aviso é acessório; o pedido é o produto.
    try { mostrarComoFuncionaSePrimeiraVez(); } catch (e) { console.error(e); }
}

let primeiroCardAnotado = false;   // `tela.primeiroCard`: uma vez por página
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
            // A MESMA função do rótulo visível. Aqui estava `place.updateType`
            // cru — o português que o core manda como último recurso —, então
            // quem usa leitor de tela em en/es/fr ouvia português em TODO card.
            // Não dava pra ver: região viva não aparece na tela, e por isso
            // passou por auditoria visual nenhuma.
            type: rotuloDoTipo(place) ? ', ' + rotuloDoTipo(place) : ''
        });
    }

    const card = montarCard(place);
    renderFocoAutor();

    // Botões de ação explícitos — gesto é atalho, nunca o único caminho
    // (M3/HIG). Também é o único caminho acessível a leitor de tela.
    //
    // Ficam FORA do `montarCard` porque o card de fundo não pode tê-los: ele
    // já é `inert` e `pointer-events:none`, mas ouvinte pendurado num botão
    // que só não dispara por causa de OUTRA camada é o tipo de coisa que
    // volta a disparar no dia em que alguém mexe na camada. Aqui não há o que
    // desfazer: o botão do fundo nunca chega a ser ligado.
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

    // Ampliar o mapa é interação, então segue a MESMA regra dos três botões
    // acima: mora no card da frente, nunca no `montarCard`. Antes ficava
    // dentro do `renderMapa`, que roda mais de uma vez por card — e aí cada
    // passada pendurava outro ouvinte no mesmo elemento (`stopPropagation`
    // não impede o irmão; isso seria `stopImmediatePropagation`).
    // O box existe sempre no template, mesmo quando o mapa não é o primeiro
    // slide: pendurar aqui é uma vez por card, e o clique só chega quando ele
    // está visível.
    const mapaBoxF = card.querySelector('.card-map');
    if (mapaBoxF) {
        mapaBoxF.addEventListener('click', (ev) => {
            if (ev.target.closest('button')) return;   // as setas do carrossel não
            ev.stopPropagation(); ev.preventDefault();
            MapaLightbox.open(place);
        });
    }


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

    // O card novo nasce SEM EFEITO NENHUM — decisão do owner, e o porquê de
    // cada coisa que já esteve aqui (mola, escala, fade) está medido no
    // styles.css, junto com o que o fade arrastava atrás de si.
    removeCurrentCardEl();
    document.getElementById('cardStack').appendChild(card);
    // Agora que a caixa existe. Sem isto o card da frente também guarda o
    // enquadramento do fallback — o observer só o corrige quando a caixa
    // CRESCE, e num card com diff ela encolhe. Ver `desenharMapaComCaixa`.
    desenharMapaComCaixa(card, place);
    // O aviso de "a foto precisa de sinal" NÃO nasce aqui: ele vem do `onerror`
    // da foto em decisão (ver `renderCardImages`). Posto no render, ele se
    // antecipava à imagem e escondia a foto que estava guardada.
    // Quem está deslizando está usando a app: a varredura não dorme.
    offlineMarcarGesto();
    // Tira o .celebrate junto: sem isso o confete não reinicia quando a fila
    // zerar de novo (a classe ficaria pendurada do "Tudo limpo!" anterior).
    document.getElementById('noMoreCards').classList.remove('celebrate');
    document.getElementById('noMoreCards').classList.add('hidden');
    // CARD NA TELA ⇒ NENHUM PAINEL POR CIMA DELE, e a regra mora AQUI porque
    // todo caminho que monta um card passa por esta função. O esqueleto
    // (`#loadingCard`, z-50) nasce VISÍVEL no HTML, e só o `startFetching` o
    // escondia — a abertura sem rede, que de propósito não chama o
    // `startFetching`, montava o card POR BAIXO dele: relato de 2026-09-22, app
    // reaberta no modo avião com 236 pedidos guardados, o card montado e o mapa
    // carregado do cache, e a tela parada no esqueleto. Nenhum smoke via porque
    // o helper que monta cards chamava `showLoading(false)` por conta própria.
    showLoading(false);
    document.getElementById('loadErrorState')?.classList.add('hidden');
    // UMA vez por página: o instante em que o primeiro pedido ficou pronto.
    // Junto do `tela.carregando`, é o par que separa "o card nunca montou" de
    // "montou e ficou coberto" — os dois pareciam a mesma tela parada.
    if (!primeiroCardAnotado) {
        primeiroCardAnotado = true;
        dfato('tela.primeiroCard', { fila: AppState.queue.length });
    }
    agendarAquecimento(card);
}

// Monta UM card a partir de UM pedido e devolve o elemento — sem pendurar na
// tela, sem ouvinte, sem observador. Nasceu de dentro do `renderCurrentCard`
// quando a pilha passou a precisar montar DOIS: o da frente e o de fundo.
// O que ficou de fora daqui ficou de propósito — é tudo que só o card da
// frente pode ter (ouvintes de botão, a trava do Desfazer, os
// ResizeObserver de rolagem, a mola de entrada e o aquecimento).
function montarCard(place) {
    const template = document.getElementById('cardTemplate');
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.place-card');

    const ident = identidadeDoPlace(place);
    const elNome = card.querySelector('.card-name');
    elNome.textContent = ident.titulo;
    elNome.classList.toggle('valor-ausente', ident.ausente);
    elNome.classList.toggle('titulo-endereco', ident.tituloEhEndereco);
    // `semNome` segue verdadeiro (o local É sem nome, e outros pontos podem
    // querer saber); o que muda é MOSTRAR — ver ausenciaDeNomeEsperada.
    card.querySelector('.card-no-name-badge')
        .classList.toggle('hidden', !ident.semNome || ausenciaDeNomeEsperada(place));
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
    card.querySelector('.card-type').textContent = rotuloDoTipo(place);
    const elTipo = card.querySelector('.card-type');
    escreverValor(elTipo, elTipo.textContent, 'card.type.empty');
    escreverValor(card.querySelector('.card-creator'), place.createdBy, 'card.creator.empty');
    renderSelosDeProcedencia(card, place);

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

    // A faixa "já lido". Só aparece quando o Waze diz que ESTE pedido já foi
    // lido — o que, com o filtro no padrão ("Apenas pedidos não lidos"), nunca
    // acontece, porque o pedido lido nem é devolvido. Ou seja: custo zero de
    // foto no fluxo em que a fila é triada, e a resposta pronta pra quem
    // desmarcou o filtro e estranha o pedido voltar depois de marcá-lo. Foi um
    // relato real, com a MESMA marcação feita duas vezes no mesmo pedido antes
    // de o editor desconfiar.
    card.querySelector('.card-read-banner')?.classList.toggle('hidden', place.isRead !== true);

    // Reporte: o motivo (`flagType`) é a informação principal e quase sempre a
    // ÚNICA — o comentário livre vem vazio na maioria dos casos. A app só olhava
    // o comentário, então o card de reporte saía sem dizer por que o local foi
    // denunciado, enquanto o WME mostrava "Motivo da marcação: Inapropriado".
    if (place.flagType) {
        // Enum não mapeado aparece CRU, pela mesma razão do diff de mudanças:
        // esconder o motivo de uma denúncia é pior que mostrá-lo em inglês.
        let motivo = rotuloDeEnum('card.flagType.', place.flagType);
        // "Duplicado" sozinho não é um motivo: é meia frase. O WME escreve
        // "Duplicado DE <local>", e o alvo é justamente a informação que decide
        // — sem ela o editor tem que abrir o WME só pra saber de quem. O core
        // resolve o nome quando consegue (ver `resolverDuplicados`); quando não
        // consegue, fica a forma isolada, que é o que a app já mostrava.
        // Só com NOME. Alvo achado e sem nome existe, e aí a frase completa
        // sairia `Duplicado de “(local sem nome)”` — aspas em volta de
        // parênteses, que é a marca de placeholder da app: duas convenções
        // empilhadas dizendo a mesma ausência. Nesse caso o texto volta a ser o
        // de hoje e quem responde "onde" é o marcador no mapa, que continua lá.
        if (place.flagType === 'DUPLICATE' && place.duplicado && place.duplicado.nome) {
            motivo = t('card.flagDuplicateOf', { alvo: place.duplicado.nome });
        }
        // A distância vai no TEXTO e não só no mapa porque o mapa nem sempre é
        // o primeiro slide (`mapaVemPrimeiro()`): num pedido com foto o editor
        // pode decidir sem nunca deslizar até ele, e aí "onde" ficaria sem
        // resposta. É também o que separa na hora o duplicado plausível do
        // vizinho parecido — medido na fila real: 94 · 96 · 101 · 110 · 146 m.
        if (place.duplicado && Number.isFinite(place.duplicado.distM)) {
            motivo += ' · ' + formatarMetros(place.duplicado.distM);
        }
        card.querySelector('.card-flag-reason-value').textContent = motivo;
        card.querySelector('.card-flag-reason').classList.remove('hidden');
    }
    // A caixa aparece só quando HÁ texto livre — ela existe pra segurá-lo. Antes
    // ela vinha junto com o motivo e, sem texto, sobrava um retângulo rosa
    // gastando ~40px de moldura numa linha vazia. (O número que estava aqui —
    // "15 de 17 reportes" — vinha de uma amostra pequena e brasileira; medido
    // em 438 reportes de 13 países, 60% TÊM texto, e nos dois tipos mais comuns
    // passa de 86%. A caixa aparecer só com conteúdo continua certo; o que
    // estava errado era chamar o conteúdo de raro.) O malabarismo de flex que existia aqui pra ela não
    // reivindicar a sobra saiu junto: sem conteúdo, ela simplesmente não existe.
    if (place.flagComment) {
        const cx = card.querySelector('.card-flag-comment');
        const txt = card.querySelector('.card-flag-comment-text');
        txt.textContent = place.flagComment;
        cx.classList.remove('hidden');
        // O que sobra da janela se alcança ROLANDO dentro da própria caixa —
        // não há botão. O aviso de que sobra texto é a borda esmaecida, e ela
        // é armada logo abaixo por `marcarBordaRolagem`, junto com as outras
        // áreas roláveis do card.
    }

    // O ↗ do card e o ↗ da folha de leitura saem da MESMA função
    // (`linkWmeDoPedido`): eram duas montagens iguais em lugares diferentes, e
    // é assim que uma ganha um parâmetro e a outra não.
    //
    // O parâmetro venueUpdateRequest do WME espera o venueID (formato dotted
    // tipo "205522459.2055159053.3242788"), NÃO o id do venueUpdateRequest
    // (que é um UUID). Confirmado via HAR comparando URL do WME nativo.
    //
    // A URL é CANÔNICA, sem segmento de idioma (decisão do owner). Estava
    // `/pt-BR/editor`: um editor que usa a app em francês clicava no ↗ e caía
    // num WME em português. O `/editor` cru responde 200 direto (medido, sem
    // redirect HTTP) e o Waze resolve o idioma pela conta de quem abriu — que é
    // exatamente o certo, porque quem decide não somos nós.
    card.querySelector('.card-wme-link').href = linkWmeDoPedido(place, API.getRegion());

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

    // BUG CORRIGIDO: o card é clonado de um <template>, e conteúdo de template
    // NÃO é alcançado por document.querySelectorAll — então o applyI18n() global
    // nunca via estas 25 chaves. Resultado: em inglês/espanhol o card voltava pro
    // português A CADA SWIPE (o clone traz o texto pt hardcoded do HTML).
    // Traduzir aqui, no clone, é o único ponto que pega todo card novo.
    atualizarSeloDePular(card);
    if (typeof applyI18n === 'function') applyI18n(card);

    return card;
}

// ── A PILHA: o próximo pedido aparece POR BAIXO do atual ────────────────────
//
// Ideia de um colega do owner, pelo paralelo com o Tinder: ao puxar o cartão
// pro lado já se vê o de baixo, sem concluir o gesto.
//
// O que ela NÃO faz, e isto foi MEDIDO antes de virar código: não acelera nada.
// Eu tinha previsto que sim — que ver o próximo adiantaria a decisão — e a
// medição derrubou. Ela entra pelo efeito visual, com o owner sabendo disso.
//
// Três decisões que não são gosto:
//
// 1. O VÉU É 35%, e o número tem escopo (gotcha #40). Mockups na app real, dois
//    aparelhos × dois temas: sem véu os dois cards ficam com o MESMO peso — dois
//    ✓ verdes igualmente acesos, e quem diz qual é o ativo é a posição, que
//    durante o arraste é justamente o que está mudando. A 55% funciona no tema
//    claro e QUEBRA no escuro: o card de fundo quase funde com o fundo da tela,
//    e aí some o que o recurso existe pra mostrar. O mesmo véu pesa mais sobre
//    um card que já é escuro. A 35% lê nos dois, e é por isso que o valor é UM
//    só e não um por tema.
//
// 2. ELE NASCE COM O AQUECIMENTO, não junto com o card da frente. A foto do
//    card é o LCP da app, e montar o de fundo na mesma hora põe a foto do
//    PRÓXIMO pedido disputando banda com a que o editor precisa ver AGORA — o
//    defeito exato que o `agendarAquecimento` já tinha medido e consertado
//    (189 KB atropelando 12 KB). Pendurar na mesma espera é uma política só; uma
//    espera própria seria uma segunda, pra envelhecer sozinha.
//
// 3. O QUE ELE CARREGA JÁ ESTÁ NA MÃO. O aquecimento aquece o primeiro slide E
//    o resto do card de `queue[1]` — inclusive o tile do mapa quando é ele que
//    vem primeiro (gotcha #54). O card de fundo desenha exatamente esse pedido,
//    logo depois: sai do cache. Custo de rede da pilha: ZERO.
// O mapa só sabe se enquadrar quando a caixa EXISTE, e ela só existe no DOM.
//
// `renderMapa` mede com `box.clientWidth || 400`: fora do DOM isso é 0 e ele
// enquadra pra 400×240 — um tamanho que não é o de card nenhum. O observer de
// `vigiarCaixaDoMapa` conserta só metade dos casos, porque ele refaz quando a
// caixa CRESCE (encolher não abre buraco, e refazer à toa é custo por quadro).
// Quando a caixa real é MENOR que o fallback — card com diff, que deixa pouca
// altura pro mapa — ele não refaz, e o enquadramento fica calculado pra outra
// proporção: 400×240 é 1,67 e 359×144 é 2,49, então o zoom escolhido é outro.
//
// MEDIDO nos dois sentidos: o card de fundo guardava 400×240 numa caixa de
// 359×337 (faixa sem mapa embaixo, o que o owner fotografou), e o da frente
// guardava 400×240 numa caixa de 359×144 (enquadramento de outra proporção).
// Chamar isto depois do `appendChild` conserta os dois pela raiz, em vez de
// repor o observer perdido no clone.
function desenharMapaComCaixa(card, place) {
    const box = card && card.querySelector('.card-map');
    // Escondido a caixa mede 0 e cairíamos no mesmo fallback. O mapa que não é
    // o primeiro slide se desenha quando o editor navega até ele — e aí o card
    // já está no DOM, que é justamente a condição que falta aqui.
    if (!box || box.classList.contains('hidden')) return;
    try { renderMapa(card, place, true); } catch (e) { /* mapa nunca derruba o card */ }
}

function montarCardDeFundo() {
    const stack = document.getElementById('cardStack');
    if (!stack) return;
    // IDEMPOTENTE de propósito. Ele é agendado junto com o aquecimento e pode
    // disparar com a fila já tendo andado (o editor é mais rápido que a foto).
    // Em vez de tentar cancelar o agendamento — que é como se perde o caso que
    // ninguém imaginou —, ele relê o estado AGORA e refaz. Disparo atrasado
    // vira trabalho repetido, nunca card errado na tela.
    stack.querySelectorAll('.card-fundo').forEach((e) => e.remove());
    if (!cardDaFrente()) return;
    const proximo = AppState.queue[1];
    // Último da fila: não há próximo a revelar, e a pilha simplesmente não
    // existe — por baixo fica o fundo da tela. Desenhar ali o "Tudo limpo!"
    // seria anunciar o fim antes de a ação ter sido confirmada, e a janela do
    // Desfazer pode devolver o pedido.
    if (!proximo) return;
    let fundo;
    try {
        fundo = montarCard(proximo);
    } catch (err) {
        // Um pedido quebrado NUNCA pode derrubar o card que o editor está
        // tratando. Sem este catch a exceção subiria pelo callback do
        // aquecimento até o `window.onerror`, que tem recuperação automática:
        // ele chamaria `advanceQueue()` e o pedido da frente sumiria da fila
        // sem ninguém ter decidido nada.
        console.error('Erro ao montar o card de fundo, seguindo sem pilha:', err);
        return;
    }
    // CLONE PROFUNDO: `cloneNode` copia atributos e NÃO copia ouvinte nenhum.
    // Os dos botões já ficavam de fora (eles moram no `renderCurrentCard`), mas
    // o `renderCardImages` pendura ouvinte na foto e nas setas do carrossel —
    // e o lightbox ABRIA com um `.click()` programático no card de fundo, ou
    // seja o ouvinte estava vivo e só não era alcançado por causa do `inert` e
    // do `pointer-events`. É o mesmo argumento que tirou os botões dali: o que
    // só não dispara por causa de OUTRA camada volta a disparar no dia em que
    // alguém mexe na camada. Depois desta linha o card de fundo é uma FIGURA.
    //
    // O que o clone perde são propriedades JS, e só uma importa: o `onerror`
    // da foto, que troca a imagem quebrada pelo "Sem Imagem". Ele é reposto
    // logo abaixo — sem isso, foto 404 no card de fundo viraria caixa vazia.
    fundo = fundo.cloneNode(true);
    const imgF = fundo.querySelector('.card-image');
    const semF = fundo.querySelector('.card-no-image');
    if (imgF && semF) imgF.onerror = () => { imgF.classList.add('hidden'); semF.classList.remove('hidden'); };

    fundo.classList.add('card-fundo');
    // As TRÊS, e cada uma cobre o que as outras não cobrem: `inert` tira do Tab
    // e da árvore de acessibilidade E bloqueia o ponteiro, mas é recente demais
    // pra ser a única linha de defesa; `aria-hidden` garante que nenhum leitor
    // de tela anuncie um segundo pedido que não está sendo tratado; e o
    // `pointer-events:none` do CSS vale mesmo onde o `inert` não existe. O modo
    // de falha que elas evitam é caro: um segundo ✕/↑/✓ alcançável pelo teclado,
    // idêntico ao real, agindo sobre o pedido errado.
    fundo.setAttribute('aria-hidden', 'true');
    fundo.inert = true;
    const veu = document.createElement('div');
    veu.className = 'card-fundo-veu';
    veu.setAttribute('aria-hidden', 'true');
    fundo.appendChild(veu);
    // No FIM do #cardStack de propósito, e não no começo: quem pinta em cima é
    // o z-index (explícito no CSS), então a ordem do DOM fica livre pra servir
    // ao outro leitor — `document.querySelector('.place-card')` segue achando o
    // card da FRENTE. É a diferença entre uma linha que todo mundo precisa
    // lembrar e uma que já nasce certa.
    stack.appendChild(fundo);

    // E SÓ AGORA o mapa, porque só agora a caixa tem tamanho.
    //
    // `renderMapa` mede com `box.clientWidth || 400` — fora do DOM isso é 0, e
    // ele enquadra pra 400×240, um tamanho que não é o do card. No card da
    // FRENTE o erro se conserta sozinho: o `ResizeObserver` de
    // `vigiarCaixaDoMapa` refaz quando a caixa assenta. No de fundo, não —
    // `cloneNode` copia atributo e **não copia propriedade JS**, então o
    // observer fica no original e o clone guarda o enquadramento errado PRA
    // SEMPRE.
    //
    // RELATADO pelo owner, com duas capturas do mesmo pedido: puxando o card
    // da frente, o mapa do de baixo tem um tamanho; quando ele chega à frente,
    // tem outro. REPRODUZIDO aqui — caixa 359×337 nos dois, desenhada pra
    // 359×337 na frente e pra 400×240 no fundo, com o tile 48px fora do lugar
    // e uma faixa sem mapa embaixo. O card de fundo é a PROMESSA do que vem;
    // promessa que muda ao virar realidade lê como a app tropeçando.
    //
    // Um redesenho basta, e ele reinstala o observer de quebra. Só quando o
    // mapa está VISÍVEL: escondido a caixa é 0 e cairíamos no mesmo fallback
    // que este conserto existe pra evitar.
    desenharMapaComCaixa(fundo, proximo);
}

// Tempo máximo que o aquecimento espera a foto do card. Rede de segurança: foto
// que trava não pode cancelar o aquecimento do próximo pedido, senão o recurso
// desaparece exatamente na rede ruim, que é onde ele mais serve.
const AQUECIMENTO_ESPERA_MAX_MS = 2500;

// O aquecimento do PRÓXIMO pedido esperava zero: `prefetchNextImage()` era
// chamado na linha seguinte ao card entrar no DOM, então as fotos do próximo
// começavam no mesmo instante que a do atual.
//
// MEDIDO no relatório de produção, num pedido com 4 fotos:
//
//   2715ms   12KB  ← a foto do card (é ela o LCP)
//   2715ms   54KB  ┐
//   2715ms   79KB  ├ fotos do PRÓXIMO pedido, aquecendo junto
//   2716ms   44KB  ┘
//
// 189 KB do que ainda não é preciso disputando banda com os 12 KB que o editor
// precisa ver AGORA. Elas já iam com `fetchPriority: low`, mas prioridade
// ordena a fila, não cria banda: num link estrangulado o LCP paga na mesma.
//
// Agora o aquecimento começa quando a foto atual termina. Card sem foto (20% da
// fila medida) ou com o mapa no primeiro slide não tem o que esperar — dispara
// na hora.
function agendarAquecimento(card) {
    let disparado = false;
    const disparar = () => {
        if (disparado) return;
        disparado = true;
        prefetchNextImage();
        // A pilha vem DEPOIS do aquecimento, na mesma espera e por dois motivos:
        // a foto do card de fundo é exatamente a que o aquecimento acabou de
        // pedir (sai do cache, custo zero), e montar antes seria pô-la pra
        // competir com o LCP — o defeito que esta espera existe pra evitar.
        montarCardDeFundo();
    };
    setTimeout(disparar, AQUECIMENTO_ESPERA_MAX_MS);
    const img = card.querySelector('.card-image');
    // `complete` é true também pra <img> sem src — a checagem do src vem antes.
    if (!img || img.classList.contains('hidden') || !img.getAttribute('src') || img.complete) return disparar();
    img.addEventListener('load', disparar, { once: true });
    img.addEventListener('error', disparar, { once: true });
}

// Desenha o mini-mapa de evidência dentro do slide.
//
// Preguiçoso de propósito: só monta quando o slide aparece. Medido na fila
// real, são 2,13 tiles por card a 29–147 KB cada; baixar isso pra card que o
// editor nem chega a ver seria cobrar dele por evidência que não pediu.
//
// As cores são as MESMAS do diff — verde entra, vermelho sai. O card já ensina
// essa gramática na caixa de mudanças; inventar outra aqui obrigaria o editor a
// aprender duas.
// A caixa do mapa cresceu depois do enquadramento? Refaz.
//
// Não é caso raro: o card é flex e assenta depois do primeiro render, então a
// medida do momento do render quase sempre subestima. Girar o aparelho e mudar
// a fonte do sistema fazem o mesmo.
//
// Duas regras que vêm do gotcha #35 e não são opcionais: o callback do
// ResizeObserver só AGENDA (a escrita vai no quadro seguinte, fora do ciclo de
// entrega), e só refaz quando a caixa CRESCEU além do que o enquadramento
// cobre — encolher não abre buraco, e refazer à toa é custo por quadro pra
// sempre. Sem essas duas, isto vira o "ResizeObserver loop completed with
// undelivered notifications" na cara do editor.
function vigiarCaixaDoMapa(box, card, place) {
    if (box._roMapa) return;
    let agendado = 0;
    box._roMapa = new ResizeObserver(() => {
        if (agendado) return;
        agendado = requestAnimationFrame(() => {
            agendado = 0;
            const w = box.clientWidth, h = box.clientHeight;
            if (!w || !h) return;
            if (w <= (+box.dataset.mapaW || 0) + 0.5 && h <= (+box.dataset.mapaH || 0) + 0.5) return;
            try { renderMapa(card, place, true); } catch (e) { /* mapa nunca derruba o card */ }
        });
    });
    box._roMapa.observe(box);
}

// Os marcadores do mapa deste pedido, em ordem ESTÁVEL — é ela que casa cada
// pixel devolvido pelo `mapaMontar` com o seu marcador.
//
// FONTE ÚNICA de propósito: a mesma lista decide o enquadramento do mapinha do
// card, o do mapa ampliado e os tiles que o prefetch aquece. Ela morava
// copiada nos três, e ponto a mais num só deles não é "um marcador faltando":
// é ZOOM diferente, ou seja, o ampliado abrindo noutro enquadramento e o
// prefetch aquecendo tile que ninguém vai pedir. Mesma lição do gotcha #63.
function pontosDoMapa(place) {
    const m = place && place.mapa;
    if (!m) return [];
    const pontos = [];
    if (m.centro) pontos.push({ ll: m.centro, cls: 'mapa-atual', rot: m.proposto ? 'card.map.antes' : 'card.map.aqui' });
    if (m.proposto) pontos.push({ ll: m.proposto, cls: 'mapa-proposto', rot: 'card.map.depois' });
    for (const e of m.entradas || []) {
        pontos.push({
            ll: e.ll, nome: e.nome,
            cls: 'mapa-entrada mapa-e-' + e.estado,
            rot: 'card.map.entrada.' + e.estado,
        });
    }
    // O "onde" do duplicado. O nome responde DE QUEM; o marcador responde ONDE
    // — e ONDE é o que decide se são de fato o mesmo lugar. Medido na fila
    // real: 94 · 96 · 101 · 110 · 146 m. Nessa faixa o `mapaMontar` já escolhe
    // sozinho o zoom que cabe, sem caso especial aqui.
    if (place.duplicado && place.duplicado.ll) {
        pontos.push({
            ll: place.duplicado.ll,
            nome: place.duplicado.nome,
            cls: 'mapa-duplicado',
            rot: 'card.map.duplicado',
        });
    }
    return pontos;
}

function renderMapa(card, place, refazendo) {
    const box = card.querySelector('.card-map');
    if (!box || !place.mapa || (box.dataset.pronto === '1' && !refazendo)) return !!(box && place.mapa);
    const m = place.mapa;

    const pontos = pontosDoMapa(place);
    // A caixa é medida AGORA, e o enquadramento vale só pra este tamanho: os
    // tiles são enumerados pra cobrir exatamente `larguraPx × alturaPx`. Se a
    // caixa crescer depois — e ela cresce, porque o card é flex e assenta
    // depois do primeiro render —, a faixa nova fica SEM tile. Medido: caixa
    // de 359×329 recebendo o enquadramento de uma caixa mais baixa, um tile só
    // em `top:-248px` cobrindo até y=264, e 65px de nada embaixo. Guardar as
    // dimensões usadas é o que deixa o observer lá embaixo decidir se refaz.
    const larguraCaixa = box.clientWidth || 400;
    const alturaCaixa = box.clientHeight || 240;
    const r = window.mapaMontar
        ? mapaMontar(pontos.map((p) => p.ll), larguraCaixa, alturaCaixa, API.getRegion())
        : null;
    if (!r) return false;
    box.dataset.mapaW = String(larguraCaixa);
    box.dataset.mapaH = String(alturaCaixa);
    // Quantos tiles este desenho PEDIU, e quantos falharam — contados ANTES de
    // o tile quebrado sair da tela (ver `registrarFalhaDeTile`). A geometria do
    // diagnóstico lê os dois.
    box.dataset.tilesPedidos = String(r.tiles.length);
    box.dataset.tilesFalharam = '0';
    vigiarCaixaDoMapa(box, card, place);

    const tiles = box.querySelector('.card-map-tiles');
    const marks = box.querySelector('.card-map-marks');
    tiles.textContent = '';
    marks.textContent = '';
    for (const t of r.tiles) {
        const im = new Image();
        im.src = t.url;
        im.alt = '';
        im.decoding = 'async';
        im.className = 'absolute mapa-tile';
        im.style.cssText = `left:${t.left}px;top:${t.top}px;width:${r.tamanho}px;height:${r.tamanho}px`;
        // Tile que não vem não pode deixar um alt quebrado no meio do mapa —
        // mas a falha é CONTADA antes, senão some a prova junto com o ícone.
        im.onerror = () => { registrarFalhaDeTile(box, t.url); im.remove(); };
        tiles.appendChild(im);
    }
    // Linha do movimento: sem ela, dois pontos próximos parecem dois locais
    // diferentes em vez de um que andou.
    if (m.proposto && m.centro && r.pixels.length >= 2) {
        const [a, b] = r.pixels;
        const linha = document.createElement('div');
        linha.className = 'mapa-linha';
        const dx = b.left - a.left, dy = b.top - a.top;
        linha.style.cssText = `left:${a.left}px;top:${a.top}px;width:${Math.hypot(dx, dy)}px;`
            + `transform:rotate(${Math.atan2(dy, dx)}rad)`;
        marks.appendChild(linha);
    }
    r.pixels.forEach((px, i) => {
        const p = pontos[i];
        const el = document.createElement('span');
        el.className = 'mapa-marca ' + p.cls;
        el.style.cssText = `left:${px.left}px;top:${px.top}px`;
        el.title = p.nome ? `${t(p.rot)} — ${p.nome}` : t(p.rot);
        marks.appendChild(el);
    });
    // O que não coube em zoom NENHUM vira frase, não marcador escondido.
    // Acontece de verdade: há pedidos propondo mover um local dezenas de
    // quilômetros, e é justamente o card em que a evidência decide sozinha.
    // Sem isto o mapa mostrava um ponto só e calava sobre o outro — o editor
    // concluiria que nada mudou de lugar.
    if (r.foraDoMapa && r.foraDoMapa.length) {
        const aviso = document.createElement('span');
        aviso.className = 'mapa-fora';
        // Duas frases, não uma com buraco: quando o que ficou de fora é um
        // PONTO DE ENTRADA (e não a geometria), não há distância medida pra
        // pôr, e "está a muito longe" é agramatical em português.
        aviso.textContent = m.movidoM
            ? t('card.map.foraDoMapa', { d: formatarMetros(m.movidoM) })
            : t('card.map.foraDoMapa.semDist');
        marks.appendChild(aviso);
    }

    // Escala: sem ela o mapa mente sobre distância, porque o zoom muda de card
    // pra card conforme o que precisa caber.
    const alvo = 64;
    const metros = alvo * r.metrosPorPixel;
    const bonito = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].reduce(
        (a, b) => (Math.abs(b - metros) < Math.abs(a - metros) ? b : a));
    const esc = box.querySelector('.card-map-scale');
    esc.style.width = Math.round(bonito / r.metrosPorPixel) + 'px';
    esc.textContent = bonito >= 1000
        ? t('card.map.km', { n: (bonito / 1000).toLocaleString(i18nLocale()) })
        : t('card.map.m', { n: bonito });

    // Legenda: o marcador sozinho não diz qual é qual, e cor não pode ser o
    // único canal de informação (WCAG 1.4.1).
    const leg = box.querySelector('.card-map-legend');
    leg.textContent = '';
    const jaPos = new Set();
    // Só o que foi DESENHADO entra na legenda: prometer um marcador que não
    // está na tela faz o editor procurar o que não existe.
    const fora = new Set(r.foraDoMapa || []);
    for (const [i, p] of pontos.entries()) {
        if (fora.has(i)) continue;
        if (jaPos.has(p.rot)) continue;
        jaPos.add(p.rot);
        const s = document.createElement('span');
        s.className = 'mapa-leg';
        const pt = document.createElement('span');
        pt.className = 'mapa-marca ' + p.cls;
        s.appendChild(pt);
        s.appendChild(document.createTextNode(t(p.rot)));
        leg.appendChild(s);
    }
    // Clicar amplia, mas o OUVINTE não mora aqui — ver `renderCurrentCard`.
    // O comentário que estava nesta linha dizia "`once` porque `renderMapa` só
    // monta uma vez por card", e as duas metades eram falsas: o código passava
    // `{ once: false }`, e o observer de caixa logo acima refaz o mapa sempre
    // que o layout assenta. MEDIDO: o mapa já NASCIA com dois ouvintes (um
    // clique abria o lightbox 2×) e ia a três depois do primeiro refazer.
    // Desenho puro aqui também é o que deixa o card de FUNDO redesenhar sem
    // ganhar interação — ele é uma figura, e precisa ser igual ao que vem.
    box.style.cursor = 'zoom-in';
    box.dataset.pronto = '1';
    return true;
}

// ── Mapa AMPLIADO: arrastar, zoom, e tiles buscados conforme navega ──────
//
// O mapinha do card responde "onde é isto"; este responde "e o que tem em
// volta?" — pedido dos testadores. A diferença não é de tamanho: ampliar foto
// estica uma imagem que já está em mãos, enquanto aqui arrastar e dar zoom
// BUSCA tiles novos. Fazer o barato (esticar o que o card já baixou) daria
// zoom borrado e arrasto que não revela nada: entregaria o gesto e frustraria
// a expectativa, que é pior que não ter.
//
// Sem biblioteca, como o resto. A matemática mora em `js/mapa.js` (`mapaGrade`,
// com `projetar`/`desprojetar`), e aqui fica só gesto e DOM.
// O Street View abre ONDE A PESSOA ESTÁ OLHANDO — e enquanto ela não mexeu no
// mapa, isso é o PEDIDO, não o enquadramento (ver `pontoDoStreetView`).
//
// Depois que ela arrasta ou dá zoom, o centro é escolha dela: no lightbox ela
// mexe pra entender qual é a entrada, e abrir no centróide jogaria fora a
// investigação que ela acabou de fazer. E isto só existe AQUI: o mini-mapa do
// card usa `mapaMontar`, que é enquadramento FIXO ("escolhido pra caber,
// minimiza tiles"), então lá a pergunta "onde você está olhando" não tem
// resposta. Foi o que fez o botão morar no lightbox e não no card — ver a
// regra do card decide / lightbox analisa, no CLAUDE.md.
//
// Não mandamos `heading`: MEDIDO contra a doc da Google — sem ele, "a default
// heading is chosen based on the viewpoint and the actual location of the
// image", ou seja o Google JÁ aponta a câmera do panorama pro viewpoint, e com
// a informação que nós não temos (onde a imagem está). Mandar um rumo
// calculado por nós trocaria o cálculo exato dele por uma estimativa.
//
// `centro` é [lat, lon]: o core INVERTE o GeoJSON antes de mandar. Ler ao
// contrário NÃO quebra nada visível — dá um lugar plausível e errado. Medido
// no Terminal 2 de Guarulhos: [lat,lon] cai no aeroporto, [lon,lat] cai no
// Atlântico Sul, e os dois passam num teste de |lat| <= 90. `test/streetview
// .test.mjs` carrega contraprova por isso.
//
// Não mandamos zoom nem `fov`: o zoom do MAPA não tem tradução pro campo de
// visão do panorama, e inventar uma seria número sem medida atrás.
function linkStreetView(centro) {
    if (!Array.isArray(centro) || centro.length < 2) return null;
    const lat = Number(centro[0]);
    const lon = Number(centro[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const p = new URLSearchParams({ api: '1', map_action: 'pano', viewpoint: lat + ',' + lon });
    return STREET_VIEW_URL + '?' + p;
}

const MapaLightbox = {
    centro: null, z: 16, pontos: [], _tiles: new Map(), _inicial: null, _local: null,
    isOpen() { return !document.getElementById('mapaLightbox').classList.contains('hidden'); },

    open(place) {
        if (!place || !place.mapa || !window.mapaGrade) return;
        this.pontos = pontosDoMapa(place);
        if (!this.pontos.length) return;

        const el = document.getElementById('mapaLightbox');
        // Abre no MESMO enquadramento do card: a pessoa clicou no que estava
        // vendo, e o mapa saltar pra outro lugar quebraria a continuidade.
        const r = mapaMontar(this.pontos.map((p) => p.ll), innerWidth, innerHeight, API.getRegion());
        this.z = r ? r.z : 16;
        const lls = this.pontos.map((p) => p.ll);
        this.centro = [ (Math.min(...lls.map((l) => l[0])) + Math.max(...lls.map((l) => l[0]))) / 2,
                        (Math.min(...lls.map((l) => l[1])) + Math.max(...lls.map((l) => l[1]))) / 2 ];
        // O ponto do PEDIDO, guardado à parte do enquadramento: o `centro` acima
        // é a média dos marcadores (local + entradas + posição proposta +
        // duplicado), que em 31% dos pedidos NÃO é o local.
        this._local = place.mapa.centro ? place.mapa.centro.slice() : null;
        this._inicial = { centro: this.centro.slice(), z: this.z };
        this._tiles.clear();
        document.getElementById('mapaLbTiles').textContent = '';
        CamadaVoltar.empilhar();
        el.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        const fechar = document.getElementById('mapaLbClose');
        if (fechar) fechar.focus();
        this.desenhar();
    },

    close(viaHistorico) {
        const el = document.getElementById('mapaLightbox');
        if (el.classList.contains('hidden')) return;
        el.classList.add('hidden');
        document.body.style.overflow = '';
        // Consome a entrada de histórico quando NÃO foi o voltar que fechou —
        // sem isso sobra entrada morta e o próximo voltar não faz nada, a
        // pessoa aperta de novo e sai da app (a mesma regra do lightbox).
        if (!viaHistorico) CamadaVoltar.consumir();
    },

    // Redesenha a grade. Tiles já baixados são REAPROVEITADOS (mapa por chave
    // z/x/y): sem isso, arrastar 10px refazia o DOM e piscava a tela inteira.
    // FONTE ÚNICA do link do Street View: chamada de dentro do `desenhar()`,
    // por onde passam abrir, arrastar, zoom e recentrar. Amarrar isto a um dos
    // quatro deixaria os outros três com o link velho, e o sintoma seria o
    // panorama abrir no lugar anterior — sem erro nenhum na tela.
    // FONTE ÚNICA do ponto que vai pro Street View, e a distinção que ela faz
    // não é firula: o `centro` do lightbox é o meio da CAIXA que enquadra todos
    // os marcadores, e enquanto a pessoa não mexeu no mapa esse ponto não foi
    // escolhido por ninguém — é subproduto do enquadramento. MEDIDO em 9.997
    // pedidos de 12 países: em 3.085 (31%) ele não é o local, com mediana de
    // 22 m e máximo de 3,6 km, quase sempre porque um ponto de entrada puxou a
    // caixa. Medindo onde o Google põe a câmera nos dois casos (849 pares):
    // a distância dela até o local cai de 79 m para 30 m na mediana, e o pior
    // caso despenca de 10.885 m para 393 m — melhor em 321, empate em 279 e
    // pior em 1, que é um parque onde nenhuma das duas mostra coisa alguma.
    //
    // Depois que ela arrasta, manda o centro DELA: aí o ponto é escolha, e é o
    // que faz o pedido de movimento funcionar de graça (quer ver a posição
    // proposta? arrasta até lá e abre de lá).
    pontoDoStreetView() {
        if (this._local && this._inicial && Array.isArray(this.centro)
            && this.centro[0] === this._inicial.centro[0]
            && this.centro[1] === this._inicial.centro[1]) return this._local;
        return this.centro;
    },

    atualizarStreetView() {
        const a = document.getElementById('mapaLbStreetView');
        if (!a) return;
        const url = linkStreetView(this.pontoDoStreetView());
        // Opção que não dá pra cumprir não aparece: sem coordenada, sem botão.
        if (url) { a.href = url; a.classList.remove('hidden'); }
        else { a.removeAttribute('href'); a.classList.add('hidden'); }
    },

    desenhar() {
        const el = document.getElementById('mapaLightbox');
        const w = el.clientWidth || innerWidth;
        const h = el.clientHeight || innerHeight;
        const g = mapaGrade(this.centro, this.z, w, h, API.getRegion());
        this.z = g.z;
        const caixa = document.getElementById('mapaLbTiles');
        const vivos = new Set();
        for (const t of g.tiles) {
            vivos.add(t.chave);
            let im = this._tiles.get(t.chave);
            if (!im) {
                im = new Image();
                im.src = t.url; im.alt = ''; im.decoding = 'async';
                im.className = 'absolute mapa-tile';
                im.style.width = im.style.height = g.tamanho + 'px';
                im.onerror = () => { registrarFalhaDeTile(null, t.url); im.remove(); this._tiles.delete(t.chave); };
                this._tiles.set(t.chave, im);
                caixa.appendChild(im);
            }
            im.style.left = t.left + 'px';
            im.style.top = t.top + 'px';
        }
        // Tile que saiu de vista sai do DOM: navegar bastante encheria a página
        // de <img> invisível, e aí o custo vira memória em vez de rede.
        for (const [k, im] of this._tiles) {
            if (!vivos.has(k)) { im.remove(); this._tiles.delete(k); }
        }
        this.desenharMarcas(g);
        this.atualizarStreetView();
    },

    desenharMarcas(g) {
        const marks = document.getElementById('mapaLbMarks');
        marks.textContent = '';
        const px = this.pontos.map((p) => g.projetar(p.ll));
        // Linha do movimento: mesma gramática do card (verde entra, tracejada
        // porque é trajeto proposto e não feição do mapa).
        if (this.pontos.length >= 2 && this.pontos[1].cls === 'mapa-proposto') {
            const [a, b] = px;
            const linha = document.createElement('div');
            linha.className = 'mapa-linha';
            const dx = b.left - a.left, dy = b.top - a.top;
            linha.style.cssText = `left:${a.left}px;top:${a.top}px;width:${Math.hypot(dx, dy)}px;`
                + `transform:rotate(${Math.atan2(dy, dx)}rad)`;
            marks.appendChild(linha);
        }
        this.pontos.forEach((p, i) => {
            const e = document.createElement('span');
            e.className = 'mapa-marca ' + p.cls;
            e.style.cssText = `left:${px[i].left}px;top:${px[i].top}px`;
            e.title = p.nome ? `${t(p.rot)} — ${p.nome}` : t(p.rot);
            marks.appendChild(e);
        });
        const alvo = 96;
        const metros = alvo * g.metrosPorPixel;
        const bonito = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]
            .reduce((a, b) => (Math.abs(b - metros) < Math.abs(a - metros) ? b : a));
        const esc = document.getElementById('mapaLbEscala');
        esc.style.width = Math.round(bonito / g.metrosPorPixel) + 'px';
        esc.textContent = bonito >= 1000
            ? t('card.map.km', { n: (bonito / 1000).toLocaleString(i18nLocale()) })
            : t('card.map.m', { n: bonito });
        const leg = document.getElementById('mapaLbLegenda');
        leg.textContent = '';
        const ja = new Set();
        for (const p of this.pontos) {
            if (ja.has(p.rot)) continue;
            ja.add(p.rot);
            const sp = document.createElement('span');
            sp.className = 'mapa-leg';
            const pt = document.createElement('span');
            pt.className = 'mapa-marca ' + p.cls;
            sp.appendChild(pt);
            sp.appendChild(document.createTextNode(t(p.rot)));
            leg.appendChild(sp);
        }
    },

    // Arrastar: converte o deslocamento em pixels para uma coordenada nova, via
    // `desprojetar`. Ir pelo pixel e não por "graus por pixel" mantém a conta
    // correta em qualquer latitude e qualquer zoom.
    arrastar(dxPx, dyPx) {
        const el = document.getElementById('mapaLightbox');
        const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
        const g = mapaGrade(this.centro, this.z, w, h, API.getRegion());
        this.centro = g.desprojetar(w / 2 - dxPx, h / 2 - dyPx);
        this.desenhar();
    },

    // Zoom mantendo FIXO o ponto sob o dedo (ou o centro, se não houver foco).
    // Sem isso, dar zoom no que interessa manda o alvo pra fora da tela.
    zoom(delta, focoX, focoY) {
        const el = document.getElementById('mapaLightbox');
        const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
        const fx = focoX === undefined ? w / 2 : focoX;
        const fy = focoY === undefined ? h / 2 : focoY;
        const g0 = mapaGrade(this.centro, this.z, w, h, API.getRegion());
        const alvoLL = g0.desprojetar(fx, fy);
        const zNovo = Math.max(MAPA_Z_NAV_MIN, Math.min(MAPA_Z_NAV_MAX, Math.round(this.z + delta)));
        if (zNovo === this.z) return;
        this.z = zNovo;
        const g1 = mapaGrade(alvoLL, this.z, w, h, API.getRegion());
        // Onde o alvo caiu com o centro provisório? Corrige o centro pela sobra.
        const p = g1.projetar(alvoLL);
        this.centro = g1.desprojetar(p.left + (w / 2 - fx), p.top + (h / 2 - fy));
        this.desenhar();
    },

    recentrar() {
        if (!this._inicial) return;
        this.centro = this._inicial.centro.slice();
        this.z = this._inicial.z;
        this.desenhar();
    },
};

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
    const fotos = fotosDoCard(place);
    const urls = fotos.urls;

    // O mapa é mais um SLIDE do carrossel — nunca uma linha nova no card, que
    // acabou de ser espremido até caber. Ele vem PRIMEIRO quando é a evidência
    // principal (o pedido mexe em posição, ou não há foto nenhuma pra olhar) e
    // por último quando a foto é que responde a pergunta.
    const temMapa = !!place.mapa;
    const mapaPrimeiro = mapaVemPrimeiro(place);
    const slides = urls.map((u) => ({ foto: u }));
    if (temMapa) slides.splice(mapaPrimeiro ? 0 : slides.length, 0, { mapa: true });
    const idxMapa = temMapa ? (mapaPrimeiro ? 0 : slides.length - 1) : -1;

    if (slides.length === 0) {
        img.classList.add('hidden');
        noImg.classList.remove('hidden');
        return;
    }

    // Um card é UM updateRequest: ou PROPÕE foto nova (✨ âmbar) ou DENUNCIA uma
    // existente (🚩 rosa) — nunca os dois. Daí um marcador só, com dois estados.
    //
    // NUM LOCAL NOVO O SELO NÃO APARECE, e isso é deliberado. O owner reparou e
    // perguntou: se o local é novo, a foto também é — não deveria vir marcada?
    // Tecnicamente sim, e a ausência do selo chega a ser uma meia-mentira. Mas
    // medido na fila real: dos 86 fotos em locais novos, 86 estão NÃO aprovadas
    // e ZERO aprovadas — é impossível um local novo ter foto que já esteja no
    // mapa. O selo apareceria em 100% desses cards, e selo que nunca varia não
    // é selo: é decoração. Pior, local novo é o tipo mais comum da fila (140 de
    // 295), então o editor veria ✨ o tempo todo e ele pararia de significar
    // algo justamente onde discrimina — no pedido de FOTO, em que uma entre
    // quatro é a nova. E o contexto já desambigua: a linha `Tipo: Novo local`
    // diz que tudo ali é novo. Decisão do owner depois da medição.
    // QUAL das N fotos é o pedido sai do `fotosDoCard` — a MESMA regra que o
    // aquecimento e a varredura do offline usam pra saber qual foto guardar.
    const eDenuncia = fotos.eDenuncia;
    const newImageIdx = fotos.emDecisao;
    newBadge.textContent = eDenuncia ? '🚩' : '✨';
    // Via atributo, não via .title: o applyI18n() roda DEPOIS deste render e
    // sobrescreveria um title escrito na mão.
    newBadge.setAttribute('data-i18n-title', eDenuncia ? 'card.flaggedPhoto.title' : 'card.newPhoto.title');
    newBorder.classList.toggle('ring-amber-400', !eDenuncia);
    newBorder.classList.toggle('ring-rose-500', eDenuncia);
    let currentImgIdx = fotos.inicial;

    // O índice do carrossel agora anda pelos SLIDES; a foto tem o seu próprio,
    // porque `newImageIdx` e o lightbox falam em posição na lista de FOTOS.
    let slideIdx = 0;
    const mapaBox = card.querySelector('.card-map');
    const updateImage = () => {
        const s = slides[slideIdx];
        imgCount.textContent = `${slideIdx + 1} / ${slides.length}`;
        if (s.mapa) {
            img.classList.add('hidden');
            noImg.classList.add('hidden');
            newBadge.classList.add('hidden');
            newBorder.classList.add('hidden');
            mapaBox.classList.remove('hidden');
            // Só aqui o tile é pedido: slide que ninguém abriu não custa rede.
            if (!renderMapa(card, place)) mapaBox.classList.add('hidden');
            return;
        }
        if (mapaBox) mapaBox.classList.add('hidden');
        currentImgIdx = urls.indexOf(s.foto);
        // A foto do card é o LCP da app, e o Lighthouse aponta que ela chega sem
        // dica de prioridade (`priorityHinted: false`). Pré-carregar não dá — a
        // URL só existe depois da resposta da API —, mas dizer que ela é a mais
        // importante da página, dá. Faz par com o `fetchpriority="low"` do
        // avatar: os dois juntos é que tiram os 214 KB da foto de perfil da
        // frente dos ~50 KB que o editor precisa VER pra decidir.
        img.fetchPriority = 'high';
        // urlDaFoto: MESMA URL que o aquecimento usou. Se divergir, o card pede
        // um endereco que ninguem aqueceu e a foto some offline, sem erro.
        img.src = urlDaFoto(s.foto);
        // Num LOCAL NOVO toda foto está sendo proposta junto com o local — e o
        // card não põe o ✨ nelas de propósito (ver a nota longa acima: o selo
        // ficaria sempre ligado e perderia sentido onde ele decide algo). Mas a
        // informação não pode simplesmente sumir: quem usa leitor de tela ou
        // passa o mouse ouve/lê aqui, sem custar um pixel na tela nem competir
        // com o selo real. Foi a saída que o owner escolheu depois de a medição
        // mostrar que o selo visível não pagava.
        const propostaComOLocal = place.purType === 'NEW_PLACE' || place.reqType === 'VENUE';
        img.alt = t(propostaComOLocal ? 'card.img.altNovoLocal' : 'card.img.alt',
            { name: identidadeDoPlace(place).titulo, i: currentImgIdx + 1, n: urls.length });
        img.title = propostaComOLocal ? t('card.img.novoLocal.title') : '';
        img.classList.remove('hidden');
        noImg.classList.add('hidden');
        const isNew = currentImgIdx === newImageIdx;
        newBadge.classList.toggle('hidden', !isNew);
        newBorder.classList.toggle('hidden', !isNew);
    };
    slideIdx = idxMapa === 0 ? 0 : slides.findIndex((s) => s.foto === urls[currentImgIdx]);
    if (slideIdx < 0) slideIdx = 0;
    img.classList.add('cursor-zoom-in');
    img.decoding = 'async';
    // Foto quebrada (404 do Waze) → cai pro placeholder "Sem Imagem".
    // E SEM REDE, se a que falhou é a foto EM DECISÃO, o card diz "precisa de
    // sinal" e trava ✕/✓ — mas só DEPOIS de a imagem falhar de verdade. Até
    // v2026.09.22-01 o aviso era posto por SUPOSIÇÃO (`offline` + tipo de foto)
    // antes de a imagem tentar, e escondia a foto que a varredura acabara de
    // guardar justamente pra este momento. RELATADO pelo owner com o toggle
    // ligado e a varredura em "Pronto" 1 minuto antes: os três cards de foto
    // vieram vazios. Reproduzido com controle: a mesma URL, numa <img> solta e
    // sem rede, carregava do cache.
    img.onerror = () => {
        img.classList.add('hidden');
        noImg.classList.remove('hidden');
        if (newImageIdx < 0 || currentImgIdx === newImageIdx) marcarCardSemFoto(card, place);
    };
    updateImage();

    img.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openLightbox(urls, currentImgIdx, newImageIdx, place.name, eDenuncia, place);
    });

    if (slides.length > 1) {
        imgNav.classList.remove('hidden');
        const anda = (d) => (e) => {
            e.stopPropagation();
            e.preventDefault();
            slideIdx = (slideIdx + d + slides.length) % slides.length;
            updateImage();
        };
        imgPrev.addEventListener('click', anda(-1));
        imgNext.addEventListener('click', anda(1));
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

// A mesma distância SEM o verbo. `formatarDistancia` diz "moveu 36 m", que é a
// frase certa pra geometria e errada pra qualquer outra coisa — reusá-la no
// ponto de entrada produziu "a MOVEU 16,3 km do local". Número e frase são
// coisas separadas; quem monta a frase escolhe o verbo.
function formatarMetros(m) {
    if (!Number.isFinite(m)) return '';
    const loc = i18nLocale();
    if (m < 1000) {
        return t('card.map.m', { n: (m < 1 ? m.toLocaleString(loc, { maximumFractionDigits: 1 })
                                          : Math.round(m).toLocaleString(loc)) });
    }
    return t('card.map.km', { n: (m / 1000).toLocaleString(loc, { maximumFractionDigits: 1 }) });
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
function itemDeLista(v, cls, sinal, campo) {
    const txt = escapeHtml(valorDeLista(v, campo));
    const corpo = itemDeListaAusente(v) ? `<span class="valor-ausente">${txt}</span>` : txt;
    return `<span class="${cls}"><span aria-hidden="true">${sinal}</span> ${corpo}</span>`;
}

function valorDeLista(v, campo) {
    // MESMO placeholder do resto do card (`valorDoDiff` já fazia isto). Os
    // parênteses não são enfeite: resolvem a ambiguidade de um valor que
    // poderia se chamar "vazio", e são TEXTO, então leitor de tela lê.
    if (itemDeListaAusente(v)) return t('card.value.empty');
    if (v && typeof v === 'object') {
        // Ponto de entrada/saída: DISTÂNCIA até o local, não coordenada.
        //
        // `+ entrada -23.50382, -46.84458` é exato e injulgável — o editor não
        // tem como saber se aquilo fica na calçada ou na cidade vizinha. Medido
        // na fila de 12 países: a mediana é 29 m (plausível), mas há pedidos
        // propondo entrada a 16 e a 82 QUILÔMETROS do próprio local, e em
        // coordenada isso passava batido. Mesma lição do `geometry`, que já
        // virou "moveu 36 m". O nome fica quando existe: é por ele que o editor
        // reconhece o ponto ao abrir o WME.
        const p = v.point && v.point.coordinates;
        if (Array.isArray(p) && p.length >= 2) {
            const tipo = v.entry === false ? t('card.eep.exit') : t('card.eep.entry');
            const nome = String(v.name || '').trim();
            const centro = AppState.currentPlace && AppState.currentPlace.mapa
                && AppState.currentPlace.mapa.centro;
            if (centro) {
                const dLat = (p[1] - centro[0]) * 111320;
                const dLon = (p[0] - centro[1]) * 111320 * Math.cos(centro[0] * Math.PI / 180);
                const d = Math.sqrt(dLat * dLat + dLon * dLon);
                return `${nome ? nome + ' · ' : ''}${tipo} ${t('card.eep.aDistancia', { d: formatarMetros(d) })}`;
            }
            // Sem posição do local não há distância a calcular — aí a
            // coordenada volta, porque sumir com o dado é pior que ser cru.
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
    //
    // ÚNICA exceção: `services`, e ela é por CAMPO, nunca genérica. O
    // dicionário veio do Transifex do Waze e serviço é comodidade genérica —
    // "ar-condicionado" é ar-condicionado em qualquer país. Categoria não entra
    // aqui porque o Waze a regionaliza POR PAÍS; apelido e ID do Google também
    // não, porque não são enum coisa nenhuma. Chave que faltar cai no valor
    // cru, como todo o resto: feio, nunca invisível.
    if (campo === 'services') {
        const chave = 'card.service.' + String(v);
        const traduzido = t(chave);
        if (traduzido !== chave) return traduzido;
    }
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
// Chaveado pelo ID, exibido pelo NOME.
//
// O módulo de reincidência já era por `creatorId`; o foco era por `createdBy`,
// e o mesmo card podia mostrar `Ver +2` (por nome) ao lado de um `✕ 6` que não
// virava botão (por id) — dois sistemas de identidade na mesma linha.
//
// Eu quase justifiquei isto com a medição ERRADA, e vale registrar: medi
// COLISÕES (dois ids com o mesmo nome) em 2.035 autores e deu zero — mas nome
// de usuário do Waze é único por construção, então zero era resultado
// garantido, não evidência. O modo de falha real é o MESMO id trocar de nome
// ENTRE sessões, e um instantâneo único nunca consegue ver isso.
//
// E a troca não é hipótese: 69% dos autores da fila real têm nome GERADO
// (`world_xxxxx`), que muda no dia em que a pessoa escolhe um. É o ciclo de
// vida normal da maioria, não um caso de borda.
//
// `id` pode ser 0 em teoria, então as comparações são contra `null`/`undefined`
// explicitamente. `!id` mandaria o foco embora num id 0 sem ninguém ver.
function focarAutor(id) {
    if (id === null || id === undefined || id === '') return;
    const daPessoa = AppState.queue.filter((x) => x.creatorId === id);
    if (daPessoa.length === 0) return;
    AppState.queue = [...daPessoa, ...AppState.queue.filter((x) => x.creatorId !== id)];
    AppState.autorEmFoco = id;
    AppState.currentPlace = AppState.queue[0];
    renderFocoAutor();
    removeCurrentCardEl();
    showCurrentPlace();
    updatePendingCount();
}

function limparFocoAutor() {
    if (AppState.autorEmFoco === null || AppState.autorEmFoco === undefined) return;
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
    const id = AppState.autorEmFoco;
    const atual = AppState.queue[0];
    const semFoco = id === null || id === undefined;
    if (semFoco || !atual || atual.creatorId !== id) {
        if (!semFoco && atual && atual.creatorId !== id) AppState.autorEmFoco = null;
        bar.classList.add('hidden');
        return;
    }
    // O nome é só rótulo. Sem ele o id vira o texto — feio, nunca invisível,
    // como o resto do card faz com valor que o Waze não nomeia.
    const nome = atual.createdBy || String(id);
    const restam = AppState.queue.filter((x) => x.creatorId === id).length;
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
        // Cada origem tem a redação oficial do WME no title; o genérico atende
        // valor que o Waze inventar depois — o selo cru já diz QUAL é, e a dica
        // ao menos diz o que aquilo significa.
        const dica = t('card.source.' + place.source + '.title');
        if (rot) selos.push({ cls: 'selo-src', txt: rot,
                              title: dica.startsWith('card.source.') ? t('card.source.title') : dica });
    }
    // Por `creatorId`, igual ao `pedidosDoAutorNaFila` logo abaixo: eram dois
    // sistemas de identidade na mesma linha, e um card podia mostrar `Ver +2`
    // ao lado de um `✕ 6` que não virava botão.
    const mesmos = (AppState.queue || [])
        .filter((x) => x !== place && x.creatorId != null && x.creatorId === place.creatorId).length;
    if (mesmos > 0) {
        selos.push({ cls: 'selo-lote', txt: t('card.sameAuthor', { n: mesmos }),
                     title: t('card.sameAuthor.acao'), acao: place.creatorId });
    }
    // Reincidência: quantos pedidos DESTE autor você já rejeitou. Rosa é a cor
    // do ✕ em toda a app — reincidência é rejeição acumulada, então herda dele.
    // Abaixo do limiar sai em cinza: a app CONTA, não acusa.
    const reincidente = contagemDoAutor(place);
    if (reincidente >= 2) {
        selos.push({
            cls: reincidente >= AUTOR_LIMIAR_DESTAQUE ? 'selo-reinc' : 'selo-src',
            txt: '✕ ' + reincidente,
            title: t('card.reincidencia.title', { n: reincidente }),
            // Vira BOTÃO sempre que o selo está VERMELHO — a cor é a promessa,
            // e selo vermelho sem toque é promessa quebrada. Vermelho quer dizer
            // "a app está acusando esta pessoa"; se acusa, tem que haver pra onde
            // ir. Abaixo do limiar o selo é cinza (a app CONTA sem acusar) e
            // segue sendo span: não há decisão a tomar sobre quem ela não acusa.
            //
            // Já esteve amarrado TAMBÉM a `pedidosDoAutorNaFila(place).length > 1`,
            // e essa segunda condição estava errada — mas não pelo motivo óbvio.
            // O raciocínio original ("com um só na fila a folha oferece 'Ver o 1'
            // e 'Rejeitar o 1', que é o card na tela com os três botões abaixo")
            // continua verdadeiro; o que estava errado foi a metade que eu cortei.
            // Diante de uma folha redundante eu tirei o BOTÃO, quando o certo era
            // tirar as duas linhas redundantes e pôr no lugar o que o card não
            // consegue mostrar: o que "✕ N" significa (o `title` não existe no
            // toque), o interruptor da recusa automática e o esquecer. Ver
            // `abrirFolhaDoAutor`, que agora se adapta ao tamanho da fila.
            //
            // Reportado pelo owner com um `✕ 8` vermelho e morto na tela — o caso
            // MAIS comum, porque só 27,3% dos cards têm outro pedido do mesmo
            // autor na fila (medido nos 6 países obrigatórios, 2.785 cards). Ou
            // seja: em ~3 de cada 4 vezes o selo vermelho não fazia nada.
            //
            // Contar por `creatorId` e não pelo nome é a razão de sempre neste
            // módulo: 69% dos autores têm nome GERADO, que muda no dia em que a
            // pessoa escolhe um.
            folha: reincidente >= AUTOR_LIMIAR_DESTAQUE ? place : null,
        });
    }
    if (!selos.length) return;
    const box = document.createElement('span');
    box.className = 'selos-proc';
    for (const s of selos) {
        // O selo do lote é o único que AGE: vira botão de verdade (não span com
        // onclick), pra receber foco no Tab e ser anunciado como acionável.
        // `s.acao != null` e não `s.acao`: a ação virou o `creatorId`, e um id 0
        // seria falsy — o selo perderia o botão sem nada avisar.
        const el = document.createElement(s.acao != null || s.folha ? 'button' : 'span');
        el.className = 'selo-proc ' + s.cls;
        el.textContent = s.txt;
        el.title = s.title;
        if (s.acao != null) {
            el.type = 'button';
            el.classList.add('selo-acionavel');
            el.addEventListener('click', (ev) => { ev.stopPropagation(); focarAutor(s.acao); });
        } else if (s.folha) {
            el.type = 'button';
            el.classList.add('selo-acionavel');
            el.addEventListener('click', (ev) => { ev.stopPropagation(); abrirFolhaDoAutor(s.folha); });
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
            const add = (c.delta.add || []).map((v) => itemDeLista(v, 'diff-add', '+', c.field)).join('');
            const del = (c.delta.del || []).map((v) => itemDeLista(v, 'diff-del', '−', c.field)).join('');
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
            // Só `categoryAttributes` traduz. Diff de objeto é genérico e serve
            // qualquer campo — aplicar a tabela fora dali seria traduzir o que
            // não é enum de atributo.
            const attr = c.field === 'categoryAttributes';
            // Valor de item de lista: traduzido em atributo, intocado no resto.
            const vItem = (l, v) => (attr ? (valorDeAtributo(l.caminho, v) ?? v) : v);
            const linhas = c.objDelta.map((l) => {
                // Traduzido é PROSA ("Elevação do estacionamento"); cru é
                // IDENTIFICADOR (`PARKING_LOT.lotType`). O identificador precisa
                // de monoespaçado e `break-all` — sem isso um nome longo sem
                // espaço não quebra em lugar nenhum. A prosa com a mesma régua
                // parte no meio da palavra: apareceu "Número de vaga / s" na
                // primeira captura desta mudança.
                const rot = attr ? rotuloDeAtributo(l.caminho) : null;
                const caminho = `<span class="diff-obj-caminho${rot ? ' diff-obj-rotulo' : ''}">`
                    + `${escapeHtml(rot ?? l.caminho)}</span>`;
                const val = (v) => (attr ? (valorDeAtributo(l.caminho, v) ?? valorDoDiff(v)) : valorDoDiff(v));
                // Folha que é LISTA usa o mesmo vocabulário do campo de lista de
                // topo (+ verde entra, − vermelho sai). Dois blocos de JSON lado
                // a lado era o que estava aqui — medido no `chargingPorts` de um
                // eletroposto, e ninguém lia.
                if (l.delta && ((l.delta.add || []).length || (l.delta.del || []).length)) {
                    // `lotType`, `paymentType` e `paymentMethods` são LISTAS de enum,
                    // e é onde o código mais aparecia — o caso do owner tinha
                    // `− UNDERGROUND + MULTI_LEVEL`.
                    //
                    // Traduz o VALOR e entrega ao renderizador ÚNICO. Envolver o
                    // `itemDeLista` num segundo renderizador é o que o guard de
                    // layout proíbe, e com razão: eram dois trechos idênticos
                    // copiados, que é como duas telas do mesmo conceito divergem.
                    const add = (l.delta.add || []).map((v) => itemDeLista(vItem(l, v), 'diff-add', '+')).join('');
                    const del = (l.delta.del || []).map((v) => itemDeLista(vItem(l, v), 'diff-del', '−')).join('');
                    return `<span class="diff-obj-linha diff-obj-linha-lista">${caminho}`
                        + `<span class="diff-delta">${add}${del}</span></span>`;
                }
                return `<span class="diff-obj-linha">${caminho}`
                    + `<span class="diff-from">${escapeHtml(val(l.de))}</span>`
                    + `<span class="diff-to">${escapeHtml(val(l.para))}</span></span>`;
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

        // Realce só quando a diferença é agulha em palheiro (ver `realceDoMiolo`).
        // Nos outros casos a linha sai exatamente como sempre saiu.
        const realce = realceDoMiolo(c.from, c.to);
        if (realce) {
            // O valor inteiro fica no `title`: a janela mostra o que decide, e
            // quem quiser o resto tem onde ver sem abrir o WME.
            const tDe = escapeHtml(String(c.from)), tPara = escapeHtml(String(c.to));
            return `<div class="diff-row">${rotulo}`
                + `<span class="diff-from" title="${tDe}">${ladoRealcado(realce, 'de', 'diff-mark diff-mark-del')}</span>`
                + `<span class="diff-to" title="${tPara}">${ladoRealcado(realce, 'para', 'diff-mark diff-mark-add')}</span></div>`;
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
    // Inclui as ações de FOTO (aprovar/excluir), não só o swipe. Elas abrem a
    // mesma janela de Desfazer e escrevem no mesmo local — deixar os botões do
    // lightbox vivos durante ela era o defeito que o owner viu: "não estão
    // sendo desativados que nem é feito nos cards".
    return !!(AppState.pendingAction || aprovacaoPendente || exclusaoPendente || renomeacaoPendente);
}

// Botão travado precisa PARECER travado: botão que não responde e parece normal
// lê como app quebrada (M3/HIG). O `disabled` também tira da ordem do Tab e faz
// o leitor de tela anunciar. A contagem regressiva do banner diz por quanto.
function aplicarTravaDeAcao() {
    const travado = acoesTravadas();
    const card = cardDaFrente();
    if (card) card.classList.toggle('acoes-travadas', travado);
    // Card de FOTO cuja foto não veio (`marcarCardSemFoto`): ✕ e ✓ ficam
    // travados MESMO fora da janela do Desfazer, com o ↑ vivo. Esta função roda
    // a cada ação que começa, termina ou é desfeita, e antes escrevia
    // `disabled = travado` nos três botões sem saber do aviso — então a ação
    // ANTERIOR terminar reabria ✕ e ✓ num card sem foto, e dava pra rejeitar
    // uma foto que ninguém viu. Visto no smoke da estrada rodando contra a main
    // de antes: aviso na tela e ✕ vivo. Duas escritas no mesmo atributo, sem
    // uma saber da outra, é o gotcha #63; a trava mora AQUI, numa função só.
    const semFoto = !!(card && card.querySelector('.card-sem-foto'));
    for (const cls of ['.card-btn-reject', '.card-btn-skip', '.card-btn-read']) {
        const b = card && card.querySelector(cls);
        if (b) b.disabled = travado || (semFoto && cls !== '.card-btn-skip');
    }
    // Os do lightbox seguem a MESMA regra e a mesma função. Regra duplicada é
    // como as duas telas divergem sem ninguém notar; o esmaecido vem do
    // `:disabled` no CSS, então basta o atributo.
    for (const id of ['lightboxApprove', 'lightboxDelete']) {
        const b = document.getElementById(id);
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
// num pedido de place ela PODE ser informação de decisão — mas só onde ela é
// INESPERADA, e é isso que `ausenciaEsperada` decide.
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

// ── MANDAR O PEDIDO ABERTO PELA CONVERSA ────────────────────────────────────
//
// Vai um RESUMO, não o place inteiro: o `changes[]`, o `mapa` e a escrituração
// do venue não cabem numa pergunta ("isso é fachada ou é a sala?") e só
// engordariam o que trafega. O que vai é o que a folha de leitura mostra.
//
// E vai CHAVE, nunca texto renderizado (`updateTypeKey`, categorias cruas):
// quem manda pode estar em português e quem recebe em francês. É a mesma regra
// que o servidor já segue com o card — o remetente não escolhe a palavra que
// aparece na tela do outro.
//
// Devolve `null` quando não há pedido aberto (fila vazia, "Tudo limpo!", modo
// treino), e é isso que faz o botão sumir em vez de virar botão morto.
function cardParaConversa() {
    const place = AppState.currentPlace;
    if (!place || !place.venueID) return null;
    if (place._treino) return null;   // pedido inerte não existe pra mais ninguém
    // A foto que o CARD mostra, pela mesma regra do carrossel (`fotosDoCard`):
    // num pedido de foto, a que está EM DECISÃO. Mandava `place.imageUrl`, que é
    // a PRIMEIRA do local — num pedido de "Nova foto" o colega recebia uma foto
    // que o local já tinha, e não a que se estava perguntando sobre. Vai CRUA,
    // sem o sufixo do offline: o cache de quem recebe não é o de quem manda.
    const fotos = fotosDoCard(place);
    return {
        venueID: place.venueID,
        updateRequestID: place.updateRequestID || null,
        name: place.name || '',
        address: place.address || '',
        categories: Array.isArray(place.categories) ? place.categories.slice(0, 4) : [],
        updateTypeKey: place.updateTypeKey || null,
        imageUrl: fotos.urls[fotos.inicial] || null,
        lat: place.lat ?? null,
        lon: place.lon ?? null,
        // A região vai junto porque o link do WME depende dela e quem recebe
        // pode estar filtrando outra. Sem isto o ↗ levaria pro ambiente errado.
        region: API.getRegion(),
    };
}

// Monta a URL do WME pro pedido — a MESMA regra do ↗ do card (env por região,
// lat/lon com zoom 22, venueUpdateRequest com o venueID). Fonte única: o card e
// a folha de leitura chamam daqui, senão os dois links divergem sem ninguém ver.
// Casas decimais da coordenada no permalink. O número é do PRÓPRIO WME, lido no
// bundle dele (v2.367): `units: { lonLatPrecision: 5 }`, e é esse valor que o
// construtor de permalink aplica (`n.lat.toFixed(Config.units.lonLatPrecision)`).
// As duas URLs que o owner colou vêm com 5 casas porque saíram de lá.
//
// Cinco casas são ~1,1 m. No zoom 22 isso são ~30 px de deslocamento no CENTRO
// do mapa — e é aceitável porque quem marca o local é o `venues=`, não a
// coordenada: ela só enquadra. Precisão maior alongaria a URL sem mudar o que a
// pessoa vê selecionado.
const COORD_CASAS = 5;

// `Number(...)` por fora do `toFixed` corta zero à direita (`-23.40000` vira
// `-23.4`), que é o objetivo aqui: encurtar. O próprio WME usa esta MESMA forma
// no "copiar coordenadas" (`Number(e.toFixed(s))`); o permalink dele usa o
// `toFixed` cru, e os dois valem o mesmo NÚMERO — a diferença é só o texto.
//
// Não vira notação exponencial: depois do `toFixed(5)` o menor valor não-nulo é
// 0.00001, e o JS só troca pra exponencial abaixo de 1e-6.
const coordDoLink = (n) => Number(n.toFixed(COORD_CASAS));

// A URL do ↗ é um PERMALINK do WME, e a gramática dele é `tipoDeFeature=ids`.
// MEDIDO no bundle do WME (v2.367, `app-f7541f99…js`): o construtor de permalink
// espalha o `getMapSelection()` — um mapa `{tipo: ids}` — direto na query, e
// `venues`/`venueUpdateRequest` são dois desses tipos. `feature_editor` é um
// nome de aba (ao lado de `issue_tracker`, `areas`, `prefs`…). Ou seja: não é
// truque, é o link que o próprio WME gera quando você seleciona os dois e copia.
//
// `venues=` e `tab=feature_editor` entraram a pedido do owner (2026-09-03): sem
// eles o WME abria a SOLICITAÇÃO mas não selecionava o local, então quem clicava
// pra corrigir ainda tinha que achar o lugar no mapa. Com eles, cai no editor do
// local com a solicitação aberta — que é exatamente o que o ↗ promete, já que a
// app não edita dado de local por princípio.
//
// Os DOIS levam o `venueID`, e é contraintuitivo: `venueUpdateRequest` NÃO leva
// o id do pedido. Já estava assim (confirmado por HAR do WME nativo) e foi
// reconfirmado agora com dado real — nas duas URLs que o owner colou, uma é
// `NEW_PHOTO` cujo `updateRequestID` é um UUID (`ab3f9d27-…`) e mesmo assim o
// permalink que FUNCIONA traz o venueID. Medido na fila do Brasil (503 pedidos):
// `venueID === updateRequestID` só em `NEW_PLACE` (213); nos outros 290 o pedido
// é UUID. Se algum dia alguém "consertar" isto passando o UUID, quebra em 58%
// dos cards — travado em `test/layout.test.mjs`.
function linkWmeDoPedido(dados, region) {
    const envParam = region === 'na' ? 'usa' : region;
    const params = [`env=${envParam}`];
    // `Number.isFinite` e não a checagem por verdade: latitude 0 corta o Brasil
    // (Macapá) e longitude 0 corta o Reino Unido (Greenwich) — dois dos seis
    // países de validação. Com `dados.lat && dados.lon` o zero cai fora e o
    // editor abre no último lugar que a pessoa estava, sem sintoma nenhum.
    if (Number.isFinite(dados.lat) && Number.isFinite(dados.lon)) {
        params.push(`lat=${coordDoLink(dados.lat)}`, `lon=${coordDoLink(dados.lon)}`, 'zoomLevel=22');
    }
    if (dados.venueID) {
        const id = encodeURIComponent(dados.venueID);
        params.push(`venues=${id}`, `venueUpdateRequest=${id}`);
        // A aba só entra COM seleção: `feature_editor` sem nada selecionado abre
        // um painel vazio, que é pior que deixar o WME escolher a aba dele.
        params.push('tab=feature_editor');
    }
    return `${WME_EDITOR_URL}?${params.join('&')}`;
}

// Abre o pedido que CHEGOU pela conversa. Só leitura: sem ✕ ↑ ✓, porque ele não
// está na fila de quem recebe.
function abrirPedidoRecebido(dados, deQuem) {
    if (!dados) return;
    // O `$` deste arquivo é LOCAL de cada função que o declara, não global —
    // três funções já fazem exatamente isto. Assumi que era global porque o vi
    // sendo usado no setup, e o smoke devolveu `$ is not defined` na cara.
    const $ = (id) => document.getElementById(id);
    const ident = identidadeDoPlace(dados);
    $('pedidoNome').textContent = ident.titulo;
    $('pedidoDe').textContent = t('presenca.pedido.de', { nome: deQuem || t('presenca.anon') });

    const foto = $('pedidoFoto');
    if (dados.imageUrl) {
        $('pedidoFotoImg').src = dados.imageUrl;
        foto.classList.remove('hidden');
    } else {
        $('pedidoFotoImg').removeAttribute('src');
        foto.classList.add('hidden');
    }

    const linha = (idRow, idVal, valor) => {
        $(idRow).classList.toggle('hidden', !valor);
        if (valor) $(idVal).textContent = valor;
    };
    linha('pedidoTipoRow', 'pedidoTipo', dados.updateTypeKey
        ? t('card.updateType.' + dados.updateTypeKey) : '');
    // Categoria sai CRUA de propósito: o Waze regionaliza por PAÍS, não por
    // idioma, então traduzir erraria em metade dos países (ver gotcha #39).
    linha('pedidoCatRow', 'pedidoCat', (dados.categories || []).join(', '));
    // Sem nome o endereço já virou o TÍTULO — repeti-lo aqui seria dizer a
    // mesma coisa duas vezes, que é o que o card também evita.
    linha('pedidoEndRow', 'pedidoEnd', ident.tituloEhEndereco ? '' : (dados.address || ''));

    $('pedidoWme').href = linkWmeDoPedido(dados, dados.region || API.getRegion());
    openModal('pedidoModal');
}

// Categorias em que NÃO ter nome é o normal — o selo não aparece nelas.
//
// MEDIDO em 4692 pedidos dos 13 países de validação (o dado CRU do Waze, não a
// fila filtrada por permissão, que fora do Brasil devolve zero): a ausência de
// nome é 100% em RESIDENCE_HOME (325 de 325) e exceção em todo o resto —
// PARKING_LOT 8,1%, PARK 8,3%, CHARGING_STATION 4,0%, e ZERO em GAS_STATION
// (427), RESTAURANT (149) e SUPERMARKET_GROCERY (125).
//
// Sinal que dispara em 100% de uma classe não distingue nada dentro dela: ele
// não diz "olhe isto", diz "isto é RESIDENCE_HOME" — que a linha de categoria
// logo abaixo já diz. Pior: selo em destaque no topo lê como alerta, e para
// casa a ausência é normal, então ele convidava a rejeitar o que está certo.
// São 8% da fila global e 15% da do owner — não é caso de canto.
//
// A regra que fica: o selo marca ausência INESPERADA, não ausência. Categoria
// nova entra aqui só com a taxa medida perto de 100%; abaixo disso, o selo
// informa e deve aparecer.
//
// Isto substitui a justificativa antiga ("RESIDENCE_HOME sem nome é forte
// candidato a rejeitar"), que era raciocínio de escrivaninha sobre uma amostra
// brasileira pequena — e que o dado nega.
const CATEGORIAS_SEM_NOME_ESPERADO = Object.freeze(['RESIDENCE_HOME']);

function ausenciaDeNomeEsperada(place) {
    const cats = Array.isArray(place && place.categories) ? place.categories : [];
    return cats.some((c) => CATEGORIAS_SEM_NOME_ESPERADO.includes(c));
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
// Onde exatamente dois textos diferem, quando isso NÃO se vê num relance.
//
// O card já mostra o valor antigo riscado em vermelho e o novo em verde, lado a
// lado — e pra quase toda mudança isso basta: `Bom Atacarejo` → `Strapasson` se
// lê num piscar. O owner recusou (com razão) selo que explica o óbvio: editor de
// mapa não precisa de muleta pra comparar dois nomes.
//
// O que engana o olho é OUTRA coisa, e ela se descobriu medindo: a diferença
// que NÃO muda o tamanho da string. Sem mudança de tamanho não há pista de
// forma, e as duas linhas parecem a mesma linha:
//
//   Aeroport Josep Tarradellas Barcelona - El Prat T1     CDG Terminal 2F
//   Aeroport Josep Tarradellas Barcelona - El Prat T2     CDG Terminal 2C
//                                                  ^                   ^
//
// Compare com o que CRESCE, e que ninguém deixa passar:
//   Goose Street Car Park  →  Goose Street Car Parkuuuu
//   Termas Prexigueiro     →  Termas de Prexigueiro
//
// MEDIDO em 453 mudanças de texto de 13 países. Os três limiares saem daí:
//
//   `REALCE_DELTA_MAX` é O QUE DECIDE. Δ≤1 separa limpo: de um lado ficam
//   `Radmore`→`Radmoor`, `Sánchez`→`Sanchez`, `Inglesia`→`Iglesia`,
//   `Rincón del`→`Rincón de`, `Falésia`→`Falésiau`, `Sé Catedral`→`Sé QCatedral`,
//   `Gate 7`→`Gate 8`, e as 12 variantes de `CDG Terminal 2F`. Do outro, tudo
//   que ganha ou perde pedaço visível (`…Barajas T2`, `W Boulangerie`,
//   `Corporationhhdh`, `/天汇`).
//
//   `REALCE_MIOLO_MAX` = 3. Em 2 perderia `CDG Terminal 2F`→`T2d`; em 4 entraria
//   `ChaMiLukie`→`ChaMiLuLiLi`, que já se vê. O empate é DESEQUILIBRADO e por
//   isso resolvido pra cima: realçar de mais custa um destaque que ninguém
//   pediu; realçar de menos custa aprovar `T1` achando que é `T1`.
//
//   `REALCE_CONTEXTO_MIN` = 10 é piso, não fronteira — de 8 a 10 dá o mesmo
//   número. Existe pra `"71"`→`"20"` solto nunca virar realce.
//
// Resultado: 49 de 453 (10,8%). Uma primeira versão usava "contexto ≥ 18 e
// miolo ≤ 6" e estava errada nas duas pontas — deixava de fora TODOS os
// `CDG Terminal 2F` (contexto 14) e marcava os apensos visíveis.
const REALCE_DELTA_MAX = 1;      // diferença de comprimento entre os dois textos
const REALCE_MIOLO_MAX = 3;      // caracteres que de fato mudam, no maior dos dois
const REALCE_CONTEXTO_MIN = 10;  // caracteres idênticos somando início e fim
// Quanto do texto IDÊNTICO fica em volta do realce. Existe porque `.diff-from` e
// `.diff-to` são `-webkit-line-clamp: 3`, e MEDIDO no Galaxy Fold a coluna cabe
// ~15 caracteres por linha: um nome de 49 é cortado ANTES da diferença. Sem
// isto o recurso ficaria invisível justamente na tela mais apertada — e, pior,
// o card de hoje já esconde ali a informação que decide (`…El Prat T1` e
// `…El Prat T2` saem idênticos num Fold).
//
// 16 é folgado de propósito: os valores curtos, que são a maioria dos casos
// (`CDG Terminal 2F` tem 13 de contexto), passam INTEIROS e nada se perde. Só
// encurta o que seria cortado de qualquer jeito — e aí mostrar a vizinhança da
// diferença é estritamente melhor que mostrar um prefixo que termina antes
// dela. O valor completo continua no `title`.
const REALCE_JANELA = 16;

// Prefixo e sufixo comuns, por CARACTERE Unicode (`[...s]`, não `s[i]`): com
// índice de UTF-16 um emoji ou um acento composto se parte no meio e o realce
// sairia cortando o próprio caractere.
//
// Prefixo/sufixo em vez de distância de edição completa porque é isso que o
// olho faz — e nos casos reais dá a mesma resposta com uma fração do custo.
// Devolve `null` quando a regra não se aplica: quem chama não decide nada.
function realceDoMiolo(de, para) {
    if (typeof de !== 'string' || typeof para !== 'string' || de === para) return null;
    const A = [...de], B = [...para];
    if (Math.abs(A.length - B.length) > REALCE_DELTA_MAX) return null;
    let p = 0;
    while (p < A.length && p < B.length && A[p] === B[p]) p++;
    let s = 0;
    while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
    const mA = A.length - p - s, mB = B.length - p - s;
    if (p + s < REALCE_CONTEXTO_MIN) return null;
    if (Math.max(mA, mB) > REALCE_MIOLO_MAX) return null;
    // Janela: o prefixo e o sufixo comuns entram no máximo `REALCE_JANELA`
    // caracteres. O que sobrar vira reticência — e ela é do mesmo lado nos dois
    // valores, senão as duas linhas deixariam de se alinhar na leitura.
    const cortaIni = p > REALCE_JANELA, cortaFim = s > REALCE_JANELA;
    const ini = cortaIni ? p - REALCE_JANELA : 0;
    const fimA = cortaFim ? p + mA + REALCE_JANELA : A.length;
    const fimB = cortaFim ? p + mB + REALCE_JANELA : B.length;
    return {
      de: [A.slice(ini, p), A.slice(p, p + mA), A.slice(p + mA, fimA)].map((x) => x.join('')),
      para: [B.slice(ini, p), B.slice(p, p + mB), B.slice(p + mB, fimB)].map((x) => x.join('')),
      cortaIni, cortaFim,
    };
}

function ladoRealcado(realce, lado, classe) {
    const [antes, meio, depois] = realce[lado];
    return (realce.cortaIni ? '…' : '')
        + escapeHtml(antes)
        + (meio ? `<mark class="${classe}">${escapeHtml(meio)}</mark>` : '')
        + escapeHtml(depois)
        + (realce.cortaFim ? '…' : '');
}

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

// ── ATRIBUTOS DE CATEGORIA (estacionamento, eletroposto) ────────────────────
//
// O diff de `categoryAttributes` mostrava CÓDIGO: `PARKING_LOT.parkingType`
// com `PUBLIC → PRIVATE`, `R_61_TO_100 → R_1_TO_10`. Não era regressão — o
// caminho da folha nunca traduziu —, só ficou visível quando apareceu um
// pedido que altera atributo, que é raro: 22 de 4.898 pedidos (0,45%) medidos
// nos 13 países de validação.
//
// As strings são as OFICIAIS do WME, colhidas da página do editor em cada
// idioma (gotcha #47: nunca a tradução da minha língua). Só existem duas
// categorias com atributo — `PARKING_LOT` e `CHARGING_STATION` —, e isso se
// manteve nos 13 países.
//
// A chave é `categoria.campo[.VALOR]`, nunca `campo.VALOR`: `costType` existe
// nas duas com conjuntos DIFERENTES, e `PUBLIC`/`RESTRICTED` aparecem tanto em
// `parkingType` quanto em `accessType`. Achatar por campo traduziria errado.
const ATTR_PREFIXO = 'card.attr.';

// `PARKING_LOT.parkingType` → "Tipo principal". Sem string oficial, devolve o
// caminho CRU — que é o identificador que casa com o WME, como antes.
function rotuloDeAtributo(caminho) {
    const chave = ATTR_PREFIXO + caminho;
    const s = t(chave);
    return s === chave ? null : s;   // null = sem string oficial, usa o caminho cru
}

// `PARKING_LOT.parkingType` + `PUBLIC` → "Público".
//
// Valor sem string oficial cai no `humanizarEnum` — "Membership card" em vez
// de `MEMBERSHIP_CARD`. São 7 dos 46 valores observados, e eles existem no dado
// mas não na tabela do WME.
//
// **Texto livre não passa por aqui**: `network` traz nome de rede (`Belib'`,
// `ChargeGuru`) e `locationInVenue` traz frase inteira. Eles têm rótulo na
// tabela e NÃO têm valores, então o `t()` devolve a chave e o valor sai cru —
// que é o certo. Humanizar ali corromperia marca própria, exatamente como já
// corrompeu apelido e ID do Google (gotcha #39).
// Campos cujo VALOR é texto livre, e que por isso nunca passam pela tabela nem
// pelo `humanizarEnum`. A lista é por CAMPO, não pela forma do valor — e essa
// é a lição, porque a forma engana: `network` traz marca em CAIXA ALTA
// (`DRIVECO`, `ESB`, `JOINON`, `ZSE`, `ETECNIC`, medidos em 13 países), que
// passa por qualquer regex de enum e sai humanizada como "Driveco", "Esb",
// "Zse". `ESB` e `ZSE` são siglas: humanizar não é feio, é ERRADO.
//
// Terceira vez que este projeto tropeça no mesmo lugar (gotcha #39): já
// corrompeu apelido e ID do Google. A regra que sobrevive é "o campo diz se o
// valor é enumerável", nunca "o valor parece um enum".
const ATTR_TEXTO_LIVRE = new Set([
    'CHARGING_STATION.network',
    'CHARGING_STATION.locationInVenue',
    'CHARGING_STATION.chargingPorts',
]);

function valorDeAtributo(caminho, valor) {
    if (valor === null || valor === undefined || typeof valor === 'object') return null;
    if (ATTR_TEXTO_LIVRE.has(caminho)) return null;
    const bruto = String(valor);
    // SÓ CAIXA ALTA passa. Isto faz dois trabalhos: barra o texto livre e barra
    // o booleano (`"true"` é minúsculo), que já sai como Sim/Não pelo
    // `valorDoDiff`. Havia um `typeof valor === 'boolean'` explícito aqui e ele
    // era código morto — a sabotagem que o removia passava limpa, porque a
    // regex já cobria o caso.
    if (!/^[A-Z][A-Z0-9_]*$/.test(bruto)) return null;
    const chave = ATTR_PREFIXO + caminho + '.' + bruto;
    const s = t(chave);
    return s === chave ? humanizarEnum(bruto) : s;
}

// Traduz enum do Waze por prefixo de chave, humanizando o que não conhecemos.
function rotuloDeEnum(prefixo, valor) {
    if (!valor) return '';
    const chave = prefixo + valor;
    const traduzido = t(chave);
    return traduzido === chave ? humanizarEnum(valor) : traduzido;
}

// Pré-carrega a imagem do próximo place da fila — mata o flash branco no swipe.
// O que este card mostra PRIMEIRO: o mapa ou a foto?
//
// FONTE ÚNICA da decisão. Ela vale em dois lugares — o carrossel, que monta os
// slides, e o prefetch, que aquece o próximo. Duplicada, elas divergem e o
// prefetch passa a aquecer o ativo errado sem ninguém notar, que é exatamente
// o defeito que esta função veio consertar.
//
// O mapa vem primeiro quando é a evidência principal: não há foto pra olhar, ou
// o pedido mexe em POSIÇÃO (e aí a coordenada crua não se julga — foi por isso
// que o mapa existe).
function mapaVemPrimeiro(place) {
    if (!place || !place.mapa) return false;
    const nFotos = (place.imageUrls && place.imageUrls.length)
        || (place.imageUrl ? 1 : 0);
    const eEspacial = (place.changes || [])
        .some((c) => c.field === 'geometry' || c.field === 'entryExitPoints');
    return nFotos === 0 || eEspacial;
}

// QUAL FOTO o card mostra — FONTE ÚNICA, pelo mesmo motivo do `mapaVemPrimeiro`
// logo acima. Num pedido de FOTO o carrossel não abre na primeira da lista: abre
// na que está EM DECISÃO — a denunciada (`flagEntityID`, que bate exatamente com
// `venue.images[].id`, confirmado no HAR do "Ponto de Mergulho") ou a proposta
// (`updateRequestID`). Sem esse vínculo o editor via 4 fotos e nenhuma pista de
// qual era o pedido.
//
// Vale em TRÊS lugares: o carrossel, o aquecimento do próximo card e a varredura
// do offline. Até v2026.09.22-01 os dois últimos pegavam `imageUrls[0]` por
// conta própria, e MEDIDO na fila do owner a foto em decisão NÃO é a primeira em
// 13 de 76 pedidos de foto: a varredura guardava a foto errada, e sem rede o card
// abria justamente na que ninguém guardou — "a foto precisa de sinal", com ✕ e ✓
// travados, num pedido que o recurso tinha prometido resolver.
function fotosDoCard(place) {
    const urls = place.imageUrls && place.imageUrls.length > 0
        ? place.imageUrls
        : (place.imageUrl ? [place.imageUrl] : []);
    const idxPorId = (id) => (id ? urls.findIndex((u) => u.indexOf(id) !== -1) : -1);
    const denunciadaIdx = idxPorId(place.flagEntityID);
    const eDenuncia = denunciadaIdx >= 0;
    const emDecisao = eDenuncia ? denunciadaIdx : idxPorId(place.updateRequestID);
    return { urls, eDenuncia, emDecisao, inicial: emDecisao >= 0 ? emDecisao : 0 };
}

// Aquece o que o PRÓXIMO card vai mostrar primeiro — não "a foto dele".
//
// Antes isto era `imageUrls[0]`, sempre. Medido em 4188 cards reais de 12
// países: em 23% o primeiro slide é o MAPA, e em 20% não há foto nenhuma —
// nesses o prefetch não aquecia NADA e o editor via a caixa cinza esperando o
// tile. Nos outros ~3%, ele baixava 56 KB de uma foto que não aparece primeiro.
//
// Não é gastar mais rede: é gastar no que a pessoa vai ver. Os tiles do próximo
// card seriam baixados de qualquer forma quando ele chegasse — a fila é
// sequencial, então o "próximo" é literalmente o próximo que ela vê.

// Rede em que aquecer mais ATRAPALHA. Prefetch disputa banda com o card que
// está na tela: numa 2G ou com economia de dados ligada, encher o cano com o
// que talvez nem seja visto deixa mais lento justamente o que a pessoa está
// olhando agora. `navigator.connection` não existe no Safari — sem ele a
// resposta é "não é econômica", que é o comportamento de antes.
function redeEconomica() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    return /(^|-)2g$/i.test(c.effectiveType || '');
}

// Uma imagem aquecida NUNCA compete com o card na tela: `fetchPriority: low`
// põe o pedido atrás do que está sendo pintado. Onde o navegador não suporta,
// atribuir a propriedade é inócuo — degrada pro comportamento de antes.
function aquecer(url) {
    if (!url) return;
    const im = new Image();
    im.fetchPriority = 'low';
    im.decoding = 'async';
    im.src = url;
}

// Os tiles que o mini-mapa DESTE card vai pedir. Usa a caixa do card atual: o
// próximo ainda não existe e o layout é o mesmo. Errar por alguns pixels só
// muda o zoom em casos de fronteira, e aí o tile aquecido é vizinho do certo.
function tilesDoCard(place, w, h) {
    if (!place || !place.mapa || !window.mapaMontar) return [];
    const r = mapaMontar(pontosDoMapa(place).map((p) => p.ll), w, h, API.getRegion());
    return r ? r.tiles.map((t) => t.url) : [];
}

// Aquece o que o próximo card mostra PRIMEIRO — não "a foto dele".
//
// Antes isto era `imageUrls[0]`, sempre. Medido em 4188 cards reais de 12
// países: em 23% o primeiro slide é o MAPA, e em 20% não há foto nenhuma —
// nesses o prefetch não aquecia NADA e o editor via a caixa cinza esperando o
// tile. Nos outros ~3%, baixava uma foto que não aparece primeiro.
function aquecerPrimeiroSlide(place, w, h) {
    if (!place) return;
    if (mapaVemPrimeiro(place)) { for (const u of tilesDoCard(place, w, h)) aquecer(u); return; }
    // A foto em que o carrossel ABRE — num pedido de foto, a que está em decisão.
    const f = fotosDoCard(place);
    aquecer(urlDaFoto(f.urls[f.inicial]));
}

// O RESTO do card: as outras fotos e, se o mapa não era o primeiro slide, os
// tiles dele. Serve quem PAROU e começou a explorar o carrossel — por isso vai
// só pro card seguinte, e com teto.
//
// Também passa pelo `urlDaFoto`: com o offline ligado o carrossel pede a foto
// COM o sufixo, e aquecer a URL crua era baixar uma cópia que ninguém ia pedir.
function aquecerRestoDoCard(place, w, h) {
    if (!place) return;
    const f = fotosDoCard(place);
    const mapaPrimeiro = mapaVemPrimeiro(place);
    // Com a foto no 1º slide, a INICIAL já foi aquecida — e o teto conta com ela.
    const resto = mapaPrimeiro ? f.urls : f.urls.filter((_, i) => i !== f.inicial);
    const teto = mapaPrimeiro ? PREFETCH_TETO_FOTOS : PREFETCH_TETO_FOTOS - 1;
    for (const u of resto.slice(0, teto)) aquecer(urlDaFoto(u));
    if (!mapaPrimeiro) for (const u of tilesDoCard(place, w, h)) aquecer(u);
}

function prefetchNextImage() {
    if (!AppState.queue[1]) return;
    const cx = cardDaFrente() && cardDaFrente().querySelector('.card-photo');
    const w = (cx && cx.clientWidth) || 400;
    const h = (cx && cx.clientHeight) || 240;
    const economica = redeEconomica();

    // PROFUNDIDADE: o 1º slide dos próximos N (hoje 1, ver a constante).
    const fundo = economica ? 1 : PREFETCH_PROFUNDIDADE;
    for (let i = 1; i <= fundo; i++) {
        if (!AppState.queue[i]) break;
        aquecerPrimeiroSlide(AppState.queue[i], w, h);
    }
    // LARGURA: só o card seguinte, e nunca em rede econômica.
    if (!economica) aquecerRestoDoCard(AppState.queue[1], w, h);
}

function showNoPlaces() {
    // O painel de fila vazia tem DOIS significados e a distinção é a flag —
    // foi ela que faltou e fez a app dizer "Tudo limpo!" sobre 217 pedidos.
    dfato('tela.vazia', { loadError: AppState.loadError, hasMore: AppState.hasMore,
                          serverTotal: AppState.serverTotal });
    if (AppState.loadError) dlogCapturarAuto('falhaAoCarregar');
    marcarTelaPronta();   // fila vazia ou erro: não vem card, mas a tela está pronta
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
        // SEM CONEXÃO é coisa que a app SABE — `onLine === false` é confiável
        // nessa direção (o inverso não é: portal cativo diz true e mente). Então
        // ali ela AFIRMA em vez de aconselhar "verifique sua conexão", e promete
        // o que o gatilho do `online` cumpre. O botão FICA, decisão do owner
        // olhando os mockups: o evento `online` às vezes não dispara, e aí ele é
        // a única saída manual — mesma razão pela qual o `callWithRetry` não
        // confia no `true`.
        const semRede = navigator.onLine === false;
        const h3 = errEl.querySelector('h3');
        const p = errEl.querySelector('p');
        if (h3) h3.textContent = t(semRede ? 'states.error.titleOffline' : 'states.error.title');
        if (p) p.textContent = t(semRede ? 'states.error.bodyOffline' : 'states.error.body');
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
            // "Tudo limpo" usa o MESMO critério do confete: abrir a app numa
            // fila já vazia não é conquista.
            checarConquistas({ filaZerada: true });
        }
    }
}

// A abreviação OFICIAL do idioma — quando ela for inequívoca.
//
// Pedido do owner: "não prefere usar as abreviações oficiais de cada idioma?".
// Prefiro, e o CLDR as tem (`style: 'short'`). MEDIDO na fila real dele, onde
// 78% dos cards são horas e 22% dias, a média ponderada da largura do rótulo
// cai 31% em português (83 → 57px), 19% em inglês, 30% em espanhol e 37% em
// francês. Num card em que cada pixel acima da foto é pixel a menos de foto,
// isso não é enfeite.
//
// MAS o "short" oficial do ESPANHOL reproduz exatamente o defeito que este
// arquivo acabou de consertar: `hace 9 m` (meses) é prefixo de `hace 9 min`
// (minutos). O guard de `test/idade.test.mjs` pega isso sozinho, com a
// mensagem certa — foi assim que eu descobri, tentando ligar o `short` pra
// todo mundo de uma vez.
//
// Então a escolha é POR IDIOMA e por MEDIÇÃO, não por gosto: usa a abreviação
// oficial se ela passar na mesma invariante que o teste cobra (nenhuma unidade
// pode ser PREFIXO de outra), e cai pro extenso quando não passar. Duas
// consequências boas: o espanhol volta pro curto sozinho no dia em que o CLDR
// consertar, e a regra que decide aqui é a MESMA que o teste enforca — não há
// duas versões dela pra divergirem.
//
// Curiosidade que confirma a régua: em português o próprio "short" do CLDR já
// escreve "dias" e "meses" por extenso, e só abrevia `h` e `min.` — não existe
// forma curta segura pra mês em pt. O CLDR chegou à mesma conclusão sozinho.
const ESTILO_DA_IDADE = new Map();
const UNIDADES_DA_IDADE = ['minute', 'hour', 'day', 'month', 'year'];

// A TIPOGRAFIA da unidade é NORMA DE CADA IDIOMA, e elas DIVERGEM entre si —
// não é gosto, e não dá pra escolher uma e aplicar em todas. Pesquisado nas
// fontes normativas depois de o owner apontar que "há 12 h" está errado em
// português (e ele está):
//
//   pt-BR  ABNT NBR 5892: `15h`, `12h30min`, `20h45min20s` — o símbolo COLA no
//          número, sem espaço e sem ponto. E minuto é `min`, nunca `m` (que é
//          metro). O CLDR emite "há 12 h" e "há 12 min.": erra os DOIS.
//   es     RAE: "12 h" com espaço OBRIGATÓRIO, e ela diz explicitamente que
//          "12h" está errado. O CLDR acerta.
//   fr     Imprimerie nationale: "12 h", com espaço INSECÁVEL — e o CLDR emite
//          U+00A0 aqui (espaço comum nos outros), ou seja ele conhece a
//          diferença; o dado do pt-BR é que não segue a ABNT.
//   en     AP/Chicago: "12 hr". O CLDR acerta.
//
// Só o PORTUGUÊS precisa de conserto, e ele é aplicado sobre as PARTES
// (`formatToParts`), nunca por regex no texto pronto: mexer com regex em saída
// localizada é como se corrompe acento e plural de idioma que ninguém no time
// lê (o mesmo motivo do gotcha #39 — quem diz o que o valor é é a ESTRUTURA,
// não a aparência dele).
//
// E cola só o que é SÍMBOLO, nunca palavra: `12h` e `12min` sim, `12 dias` e
// `12 meses` não — ninguém escreve "12dias". A distinção não é uma lista de
// unidades cravada aqui (isso envelhece quando o CLDR mudar): símbolo é o
// token curto que é PREFIXO ESTRITO da forma por extenso — `h` ⊂ `horas`,
// `min` ⊂ `minutos`, enquanto `dias` == `dias` e `meses` == `meses` não são.
const COLA_O_SIMBOLO = new Set(['pt']);   // ABNT NBR 5892

function idadeComNormaLocal(loc, estilo, n, unidade) {
    const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto', style: estilo });
    const idioma = String(loc || '').slice(0, 2).toLowerCase();
    if (estilo !== 'short' || !COLA_O_SIMBOLO.has(idioma)) return rtf.format(n, unidade);
    try {
        const partes = rtf.formatToParts(n, unidade);
        const i = partes.findIndex((p) => p.type === 'integer');
        if (i < 0 || !partes[i + 1] || partes[i + 1].type !== 'literal') return rtf.format(n, unidade);
        const depois = partes[i + 1].value;
        const token = depois.trim().replace(/\.$/, '');
        // É símbolo? Compara com a forma POR EXTENSO da MESMA unidade — e o
        // token é o literal que vem DEPOIS do número, não o primeiro da lista.
        // (Primeira versão pegava o primeiro literal com conteúdo, que é o
        // prefixo "há " — comparava `min` com `há`, nunca casava, e o `min.`
        // ficava intocado. Só apareceu porque eu OLHEI a saída em vez de
        // conferir o código.)
        const pLongas = new Intl.RelativeTimeFormat(loc, { numeric: 'auto', style: 'long' })
            .formatToParts(n, unidade);
        const j = pLongas.findIndex((p) => p.type === 'integer');
        const palavra = j >= 0 && pLongas[j + 1] ? pLongas[j + 1].value.trim() : '';
        const ehSimbolo = token.length > 0 && token.length < palavra.length && palavra.startsWith(token);
        if (!ehSimbolo) return rtf.format(n, unidade);
        // Cola: tira o espaço à esquerda do token e o ponto de abreviatura
        // (símbolo do SI não leva ponto — `min`, não `min.`).
        partes[i + 1] = { ...partes[i + 1], value: depois.replace(/^\s+/, '').replace(/\.(\s|$)/, '$1') };
        return partes.map((x) => x.value).join('');
    } catch (e) {
        return rtf.format(n, unidade);
    }
}

function estiloDaIdade(loc) {
    if (ESTILO_DA_IDADE.has(loc)) return ESTILO_DA_IDADE.get(loc);
    let estilo = 'long';
    try {
        const curto = new Intl.RelativeTimeFormat(loc, { numeric: 'auto', style: 'short' });
        // n = 9: qualquer n >= 2 serve (em n = 1 vários idiomas usam palavra
        // própria — "ontem", "mês passado" — e a comparação perde o sentido).
        const saidas = UNIDADES_DA_IDADE.map((u) => curto.format(-9, u));
        const ambiguo = saidas.some((a) => saidas.some((b) => a !== b && b.startsWith(a)));
        if (!ambiguo) estilo = 'short';
    } catch (e) { /* sem Intl ou locale estranho: o extenso nunca é ambíguo */ }
    ESTILO_DA_IDADE.set(loc, estilo);
    return estilo;
}

// A IDADE DO PEDIDO, e ela já MENTIU pro owner — três vezes, com relato.
//
// Isto usava chaves abreviadas do dicionário, e em português `time.months` era
// `há {n}m` enquanto `time.minutes` é `há {n}min`. Um pedido de NOVE MESES
// renderizava **"há 9m"**, que todo falante de português lê como nove MINUTOS.
// Ao lado, na mesma linha, o rótulo de tipo diz "Novo local". A tela inteira
// afirmava "local novo, de 9 minutos atrás" sobre um pedido de 2025-11-27 — e
// foi exatamente assim que o owner relatou: a mesma solicitação "nova"
// entrando toda vez que ele abre a app. Ele leu certo o que a app escreveu.
// A mesma colisão existia em espanhol (`hace {n}m` × `hace {n}min`); inglês
// (`mo`) e francês (` mois`) escapavam — o defeito era de DUAS línguas em
// quatro, e o owner usa uma delas.
//
// E a ordenação faz dos dois um par: MEDIDO na fila real dele, o rótulo de
// meses cabe a 1 card em 370 (0,3% — 78% são horas, 22% dias). Mas com "mais
// antigos primeiro" o card mais velho é POR DEFINIÇÃO o mais provável de cair
// na faixa de meses, então o único rótulo ambíguo da fila era garantidamente o
// PRIMEIRO da tela, toda vez que ele abria a app. Cada recurso certo sozinho.
//
// Havia um segundo buraco, este aritmético e nas QUATRO línguas: entre 360 e
// 364 dias, `months` dava 12 (fora da faixa) e `years` dava `floor(360/365)` =
// 0 — a tela mostrava **"há 0a"**. Janela de 5 dias, ninguém relatou porque é
// rara, mesmo defeito de fundo: conta à mão que produz rótulo falso.
//
// O conserto NÃO é escolher abreviatura melhor: é usar o mecanismo que esta
// app JÁ usa pra idade de FOTO (`idadeDaFoto`), com o motivo já escrito lá —
// `Intl.RelativeTimeFormat` resolve plural por idioma sozinho, e o projeto não
// tem ICU. Duas mecânicas para o mesmo conceito é como elas divergem: o MESMO
// card mostrava "há 9 meses" na foto e "há 9m" no pedido. Some com as 6 chaves
// `time.*` × 4 línguas, e o ano acima de 365 dias espelha o `idadeDaFoto` —
// "2025" decide melhor que "ano passado" num pedido que se vai julgar.
//
// MEDIDO antes de trocar, porque a string mais larga quase nunca está no
// idioma em que se desenvolve (gotcha #25): 3 aparelhos × 4 idiomas × 5 faixas
// = 60 combinações, ZERO estouro e ZERO quebra de linha; o pior caso (francês
// no Galaxy Fold, "il y a 28 minutes") ainda deixa 88px de folga.
function formatRelativeTime(ts) {
    if (!ts || typeof ts !== 'number' || ts <= 0) return null;
    const diff = Date.now() - ts;
    // Relógio torto ou data no futuro: "agora" é o menos errado — não se
    // inventa idade negativa nem se esconde o pedido.
    const loc = i18nLocale();
    try {
        const estilo = estiloDaIdade(loc);
        const f = (n, u) => idadeComNormaLocal(loc, estilo, n, u);
        if (diff < 0) return f(0, 'second');
        const sec = Math.floor(diff / 1000);
        if (sec < 60) return f(0, 'second');
        const min = Math.floor(sec / 60);
        if (min < 60) return f(-min, 'minute');
        const hr = Math.floor(min / 60);
        if (hr < 24) return f(-hr, 'hour');
        const days = Math.floor(hr / 24);
        if (days < 30) return f(-days, 'day');
        // `< 365` e não `meses < 12`: era daqui que saía o "há 0a".
        if (days < 365) return f(-Math.round(days / 30), 'month');
        return new Date(ts).toLocaleDateString(loc, { year: 'numeric' });
    } catch (e) {
        // Sem Intl (não deve acontecer no piso da app), a data crua ainda
        // responde a pergunta — e nunca é ambígua.
        try { return new Date(ts).toLocaleDateString(loc); } catch (e2) { return null; }
    }
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

// CONTAGEM SAI CRUA — decisão do owner (2026-09-15): "não vamos entrar nessa
// brincadeira de ponto e vírgula; número cru é super portável para qualquer
// idioma". Vale pro placar, pras linhas do Histórico, pro cartão da patente,
// pras estatísticas do perfil e pra imagem do Resumo do mês.
//
// O caso que originou a decisão: o cartão da patente nasceu formatado
// (`3.040`) quatro linhas acima de números que sempre foram crus (`1430`), e a
// app se contradizia na mesma tela. Havia dois consertos possíveis — formatar
// tudo ou não formatar nada — e o owner escolheu o segundo, com o argumento de
// que `1430` se lê igual em qualquer língua e `1.430` não.
//
// O QUE NÃO ENTRA NESSA REGRA, e a diferença não é detalhe:
//   • DATA (`toLocaleDateString`) — não é número.
//   • MEDIDA COM DECIMAL (`1,2 km`, `84,5 m`) — ali o separador é ARITMÉTICA:
//     `1.2` lido por um brasileiro é mil e duzentos. Segue no locale.
// `test/layout.test.mjs` cobra as duas pontas: contagem crua, decimal no locale.

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
    // SEM REDE não se retenta: as duas tentativas extras são 2 requisições e
    // ~5s de espera (1,5 + 3,5) que já nascem condenadas. Com a fila de saída
    // atrás, a ação não se perde por não insistir — ela sai quando a rede
    // voltar. MEDIDO: ~509 bytes por tentativa, e offline a app fazia 3.
    //
    // O teste é de UMA MÃO só, de propósito: `onLine === false` é confiável
    // pra "não tem rede"; `true` NÃO prova que tem (portal cativo de hotel diz
    // true e mente). Então só o `false` muda o comportamento.
    const semRede = () => navigator.onLine === false;
    while (result && !result.success && result.errorCategory === 'transient'
           && !semRede() && attempt < TRANSIENT_RETRY_ATTEMPTS) {
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
    // Acumulador que sobrevive à poda dos baldes diários. Só inicializa — a
    // soma retroativa do formato antigo saiu junto com os outros resíduos.
    if (!h._total) h._total = { read: 0, rejected: 0 };
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
// `dia`/`onde` explícitos existem por causa da FILA DE SAÍDA: uma ação feita
// offline pousa quando a rede volta, e sem eles ela cairia no balde do dia do
// POUSO e na região do filtro de AGORA. O trabalho foi feito no dia e no lugar
// do gesto — é isso que o editor reconhece no Histórico e no Resumo do mês.
// Omitidos (todo caminho online), valem hoje e o filtro atual, como sempre.
function recordHistory(type, delta, dia, onde) {
    if (type !== 'read' && type !== 'reject') return;
    const h = loadHistory();
    const k = dia || historyTodayKey();
    if (!h[k]) h[k] = { read: 0, rejected: 0 };
    const field = type === 'read' ? 'read' : 'rejected';
    h[k][field] = Math.max(0, (h[k][field] || 0) + (delta || 0));
    h._total[field] = Math.max(0, (h._total[field] || 0) + (delta || 0));
    // ONDE o trabalho foi feito. É o dado que faltava pra "Andarilho"/"Viajante"
    // — e o MESMO que tirou o "onde" do Resumo do mês, que agora pode voltar.
    // É dado SEU (onde você trabalhou), não de terceiro: pode persistir, e sai
    // no logout junto com o resto do histórico.
    const lugar = onde || ondeAgora();
    if (lugar && (delta || 0) > 0) {
        if (!h[k].onde) h[k].onde = {};
        h[k].onde[lugar] = Math.max(0, (h[k].onde[lugar] || 0) + delta);
    }
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
// ═══════════════════════════════════════════════════════════════════════════
//  Patentes e Conquistas — celebra, nunca cobra
// ═══════════════════════════════════════════════════════════════════════════
//
// Tudo no aparelho, zero requisição, sai no "Sair" como o resto. A régua que
// decidiu cada peça: **isto celebra o que a pessoa fez, ou cobra o que ela não
// fez?** Por isso não há sequência viva, não há "você vai perder", não há
// ranking e não há contador de progresso nas trancadas ("3 de 10" é o
// mecanismo de pressão, não a informação).
//
// TRÊS decisões de tela que saíram de MEDIÇÃO, não de gosto (mockups em
// 2026-09-14, app real nos dois aparelhos, dois temas, pt e fr):
//
//  1. GRADE LARGA — 3 colunas no normal, 2 no estreito. Em 4, MEDIDO: as
//     colunas saem 70/70/78/70, porque o nome mais longo força `min-width:auto`
//     e uma delas estica — a vitrine deixa de ser uma grade. Em 3 dá 98/98/98.
//     Custa 98px a mais de rolagem e paga. O smoke compara as larguras entre
//     si, que é o que uma tradução longa quebra primeiro (gotcha #25).
//  2. TRANCADA MOSTRA NOME E ÍCONE, em cinza. A versão "misteriosa" (🔒 + ?)
//     deixa nove células IDÊNTICAS: não lê como descoberta, lê como tela
//     quebrada — e pro editor novo, que tem 16 delas, é uma parede.
//  3. A CONDIÇÃO MORA FORA DA CÉLULA, numa linha ao toque. Dentro, na largura
//     que a grade tem, ela parte palavra pelo mesmo motivo do item 1.
//
const CONQUISTAS_KEY = 'waze_places_conquistas';

// A ESCADA, por total tratado (lidos + rejeitados). Seis degraus.
//
// O degrau 5 era "Síndico" e mudou: é conceito de prédio brasileiro que não
// existe nas outras três línguas sem virar frase ("gestionnaire d'immeuble" é
// descrição, não patente). "Inspetor" vira Inspector/Inspecteur/Inspector
// palavra por palavra. Os outros cinco atravessam — e a piada da limpeza fica,
// porque "Lixeiro" no meio da escada É a identidade da app.
const PATENTES = [
    { id: 'aprendiz', emoji: '🧤', min: 0 },
    { id: 'gari',     emoji: '🧹', min: 100 },
    { id: 'lixeiro',  emoji: '🗑️', min: 500 },
    { id: 'zelador',  emoji: '🔑', min: 1500 },
    { id: 'inspetor', emoji: '🏢', min: 4000 },
    { id: 'prefeito', emoji: '🏛️', min: 10000 },
];

// ORDEM FIXA, e ela NÃO se reordena por "ganhas primeiro". Vitrine que se
// reorganiza a cada desbloqueio destrói o reconhecimento — você aprende que a
// sua é o elefante do meio e no dia seguinte ela mudou de lugar. A ordem é
// aproximadamente a de dificuldade, então na prática preenche de cima pra
// baixo sozinha.
//
// `l6` marca as que dependem do portão destrutivo (aprovar foto, renomear).
// Elas ficam no FIM de propósito: escondidas de quem não passa no portão, não
// deixam buraco na grade. Cadeado que NUNCA abre é beco sem saída — a mesma
// régua que tirou a extensão de Chrome da frente no celular.
const CONQUISTAS = [
    { id: 'primeiraFaxina', emoji: '🧹' },
    { id: 'centuriao',      emoji: '💯' },
    { id: 'maoFirme',       emoji: '🎯' },
    { id: 'detetive',       emoji: '🕵️' },
    { id: 'elefante',       emoji: '🐘' },
    { id: 'tudoLimpo',      emoji: '🧼' },
    { id: 'colecionador',   emoji: '⭐' },
    { id: 'coruja',         emoji: '🌙' },
    { id: 'segundaChance',  emoji: '↩️' },
    { id: 'primeiroResumo', emoji: '🎉' },
    { id: 'andarilho',      emoji: '🗺️' },
    { id: 'viajante',       emoji: '🌍' },
    { id: 'poliglota',      emoji: '🗣️' },
    { id: 'semanaCheia',    emoji: '📅' },
    { id: 'curador',        emoji: '📸', l6: true },
    { id: 'corretor',       emoji: '✏️', l6: true },
];

// PURAS — é o que o teste exercita sem browser.
function patenteDe(tratados) {
    const n = Number.isFinite(tratados) ? tratados : 0;
    let i = 0;
    while (i + 1 < PATENTES.length && n >= PATENTES[i + 1].min) i++;
    return i;
}
// Avalia TODAS e devolve só as que viraram de trancada pra ganha agora.
// Sem DOM, sem relógio, sem armazenamento: recebe o contexto pronto.
function avaliarConquistas(ctx, jaTem) {
    const c = ctx || {}, tem = jaTem || {};
    const cond = {
        primeiraFaxina: (c.tratados || 0) >= 10,
        centuriao:      (c.hoje || 0) >= 100,
        maoFirme:       (c.seq || 0) >= 100,
        detetive:       !!c.duplicado,
        elefante:       !!c.reincidente,
        tudoLimpo:      !!c.filaZerada,
        colecionador:   (c.guardados || 0) >= 10,
        coruja:         !!c.madrugada,
        segundaChance:  !!c.desfez,
        primeiroResumo: !!c.resumo,
        andarilho:      (c.estados || 0) >= 3,
        viajante:       (c.paises || 0) >= 2,
        poliglota:      (c.idiomas || 0) >= 2,
        semanaCheia:    (c.diasSeguidos || 0) >= 7,
        curador:        (c.fotos || 0) >= 10,
        corretor:       (c.nomes || 0) >= 5,
    };
    // Na ORDEM da lista: é ela que decide qual anunciar quando duas caem juntas.
    return CONQUISTAS
        .filter((x) => (!x.l6 || c.gateL6) && cond[x.id] && !tem[x.id])
        .map((x) => x.id);
}

function carregarConquistas() {
    if (AppState.conquistas) return AppState.conquistas;
    let g = null;
    try { g = JSON.parse(localStorage.getItem(CONQUISTAS_KEY) || 'null'); } catch (e) { g = null; }
    if (!g || typeof g !== 'object') g = {};
    AppState.conquistas = {
        c: (g.c && typeof g.c === 'object') ? g.c : {},   // id → 'YYYY-MM-DD'
        // Seguidas sem desfazer. Contador PRÓPRIO, e não o `semUndoSeguidas` das
        // preferências: aquele só conta janela do Desfazer que expirou
        // NATURALMENTE, ou seja só com o Desfazer LIGADO — quem o desligou
        // (justamente o editor rápido, pra quem "Mão firme" faria sentido)
        // nunca acumularia um. Este sobe na confirmação e zera no desfazer,
        // funcionando dos dois jeitos.
        seq: Number.isFinite(g.seq) ? g.seq : 0,
        patente: Number.isFinite(g.patente) ? g.patente : null,
        n: (g.n && typeof g.n === 'object') ? g.n : {},   // contadores acumulados
        langs: Array.isArray(g.langs) ? g.langs.slice(0, 8) : [],
        base: g.base === true,
        // O que destravou e a pessoa ainda NÃO viu. É isto que acende o selo no
        // botão de Filtros e desenha o anel na vitrine — some ao abrir a aba.
        novas: Array.isArray(g.novas) ? g.novas.slice(0, 32) : [],
        patenteNova: g.patenteNova === true,
    };
    return AppState.conquistas;
}
function salvarConquistas() {
    try { localStorage.setItem(CONQUISTAS_KEY, JSON.stringify(AppState.conquistas)); } catch (e) {}
}
// Uma ação CONFIRMADA pelo Waze. Daqui saem a sequência sem desfazer, os
// gatilhos de evento e a reavaliação.
//
// ELA E A `registrarDesfazer` FORAM REMOVIDAS POR ENGANO em v2026.09.16-xx
// (#215, o PR que trocou o banner de conquista por um ponto): a que precisava
// sair era só a `anunciarConquista`, e estas duas foram junto — com os DOIS
// call sites de cada uma ficando pra trás. O resultado estava em produção e não
// era sutil: `handleActionResult` lançava `ReferenceError` em TODA ação
// confirmada, e `desfazerAcaoPendente` lançava antes de tirar o banner e
// destravar os botões — ou seja, desfazer devolvia o pedido e deixava o card
// MORTO (banner preso, ✕ ↑ ✓ desabilitados), com o gesto ainda funcionando, que
// é exatamente o que escondia o problema (a mesma assinatura do gotcha #63).
// Nenhum teste enxergava porque nenhum deles CHAMA o código — os de unidade
// fatiam a fonte e o smoke não exercitava o Desfazer até o fim.
function registrarAcaoConfirmada(actionType, place) {
    if (typeof Treino !== 'undefined' && Treino && Treino.ativo) return;
    const g = carregarConquistas();
    g.seq = (g.seq || 0) + 1;
    salvarConquistas();
    // O idioma entra no gesto, não na carga: "usou a app em 2 idiomas" é sobre
    // TRABALHAR em dois, não sobre abrir o seletor e voltar.
    registrarIdiomaUsado(typeof getLang === 'function' ? getLang() : '');
    const hora = new Date().getHours();
    checarConquistas({
        duplicado: actionType === 'reject' && !!(place && place.duplicado),
        // `contagemDoAutor` já inclui ESTA rejeição (o registro veio antes), então
        // > 1 significa que havia rejeição anterior — é isso que faz reincidente.
        reincidente: actionType === 'reject' && !!place && place.creatorId != null
                     && contagemDoAutor(place) > 1,
        // "Depois da meia-noite" é a MADRUGADA (0h–4h59), não a noite: às 23h a
        // pessoa ainda está acordada no mesmo dia, e a graça da coruja é a virada.
        madrugada: hora >= 0 && hora < 5,
    });
}

// Desfazer zera a sequência de "Mão firme" e destrava "Segunda chance" — que é
// de propósito o contrapeso da lista: a única que celebra CUIDADO, não volume.
function registrarDesfazer() {
    if (typeof Treino !== 'undefined' && Treino && Treino.ativo) return;
    const g = carregarConquistas();
    g.seq = 0;
    salvarConquistas();
    checarConquistas({ desfez: true });
}

// Contador acumulado (guardados, fotos aprovadas, nomes corrigidos).
function contarConquista(chave, delta) {
    const g = carregarConquistas();
    g.n[chave] = Math.max(0, (g.n[chave] || 0) + (delta || 1));
    salvarConquistas();
    checarConquistas();
}
// O idioma entra num conjunto pequeno — é o dado de "Poliglota", e é seu.
function registrarIdiomaUsado(lang) {
    const l = String(lang || '').slice(0, 2);
    if (!l) return;
    const g = carregarConquistas();
    if (g.langs.includes(l)) return;
    g.langs.push(l);
    salvarConquistas();
    checarConquistas();
}

// ── geografia: de onde sai "Andarilho" e "Viajante" ────────────────────────
// O `place` NÃO carrega país/estado (o core não propaga), então a fonte é o
// FILTRO — que é onde o editor escolheu trabalhar, e é a mesma fonte que já
// nomeia a sala da presença.
function ondeAgora() {
    const pais = (typeof API !== 'undefined' && API.getCountry) ? parseInt(API.getCountry(), 10) : NaN;
    if (!Number.isFinite(pais) || pais <= 0) return null;
    const estado = parseInt(AppState.filters && AppState.filters.stateId, 10);
    return Number.isFinite(estado) && estado > 0 ? pais + ':' + estado : String(pais);
}
// Estado é chaveado por `pais:estado`, nunca pelo id do estado sozinho: o
// mesmo número existe em países diferentes e juntaria dois lugares num só.
function geografiaDoHistorico(h) {
    const paises = new Set(), estados = new Set();
    for (const [k, v] of Object.entries(h || {})) {
        if (k === '_total' || !v) continue;
        // MIGRACAO: historico-onde
        // Balde gravado antes de v2026.09.14-01 não tem `onde`, e não há como
        // saber onde aquele trabalho foi feito — ele simplesmente não conta.
        for (const chave of Object.keys(v.onde || {})) {
            const pais = String(chave).split(':')[0];
            if (pais) paises.add(pais);
            if (String(chave).includes(':')) estados.add(chave);
        }
    }
    return { paises, estados };
}

const DIA_MS = 86400000;
const diaISO = (t) => {
    const d = new Date(t), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
// A MAIOR sequência de dias com trabalho. Só varre a partir de um dia cujo
// anterior está ausente, então cada dia é visitado no máximo duas vezes.
function maiorSequenciaDeDias(h) {
    const dias = new Set(Object.keys(h || {})
        .filter((k) => k !== '_total' && h[k] && ((h[k].read || 0) + (h[k].rejected || 0)) > 0));
    let melhor = 0;
    for (const d of dias) {
        const t = new Date(d + 'T00:00:00').getTime();
        if (!Number.isFinite(t) || dias.has(diaISO(t - DIA_MS))) continue;
        let n = 1, cur = t;
        while (dias.has(diaISO(cur + DIA_MS))) { cur += DIA_MS; n++; }
        if (n > melhor) melhor = n;
    }
    return melhor;
}

// ── o portão, e a checagem ─────────────────────────────────────────────────
// Função PRÓPRIA que delega à base, como manda o padrão dos outros destrutivos
// (`podeExcluirFotoAqui`, `podeRenomearAqui`): nunca chamar a base direto nem
// copiar `rank >= 5`.
function conquistasComPortaoAqui() { return podeAgirComoL6Aqui(); }
// O que a pessoa VÊ. Sem portão, as duas últimas não existem — nem na grade
// nem no "de 16", que vira "de 14".
function conquistasVisiveis() {
    return CONQUISTAS.filter((x) => !x.l6 || conquistasComPortaoAqui());
}

function checarConquistas(extra) {
    if (!AppState.authenticated) return;
    if (typeof Treino !== 'undefined' && Treino && Treino.ativo) return;
    const g = carregarConquistas();
    const h = loadHistory();
    const s = getHistoryStats();
    const geo = geografiaDoHistorico(h);
    const tratados = s.total.read + s.total.rejected;
    const ctx = Object.assign({
        tratados,
        hoje: s.today.read + s.today.rejected,
        seq: g.seq || 0,
        guardados: g.n.guardados || 0,
        fotos: g.n.fotos || 0,
        nomes: g.n.nomes || 0,
        idiomas: g.langs.length,
        estados: geo.estados.size,
        paises: geo.paises.size,
        diasSeguidos: maiorSequenciaDeDias(h),
        gateL6: conquistasComPortaoAqui(),
    }, extra || {});

    const novas = avaliarConquistas(ctx, g.c);
    const hoje = historyTodayKey();
    for (const id of novas) g.c[id] = hoje;

    // LINHA DE BASE. Na primeira passada deste aparelho nada é anunciado: quem
    // já tem 3.000 pedidos nas costas destrava oito de uma vez, e oito banners
    // seguidos não é festa, é enxurrada. Mesmo raciocínio do `initUndoGateSeen`
    // — e, como lá, isto NÃO é migração: todo aparelho novo também passa por
    // aqui (e não destrava nada).
    const iP = patenteDe(tratados);
    if (!g.base) {
        g.base = true;
        g.patente = iP;
        salvarConquistas();
        return;
    }

    // O AVISO NÃO INTERROMPE — decisão do owner (2026-09-16), depois de ver o
    // banner na tela: "ficou parecendo com o desbloquear o Desfazer; prefiro
    // algo mais simples, discreto e que não atrapalhe".
    //
    // Ele tinha razão de um jeito literal: conquista e desbloqueio do Desfazer
    // eram o MESMO código — `dispararConfeteNaFila()` + banner dourado de 20s.
    //
    // MEDIDO nas quatro opções, com a app rodando. A coluna que decidiu não é
    // estética: é quanto do PLACAR some, e o projeto marca o placar com
    // `.nao-cobrir` porque cobrir número MENTE ("311" lê como "31").
    //   banner dourado (o de antes) → placar coberto 13 de 13 + confete na foto
    //   banner discreto no topo     → placar coberto 13 de 13 (7/13 no Fold)
    //   snackbar no rodapé          → TAPA o ✕ no Galaxy Fold (gotcha #26)
    //   selo no botão de Filtros    → 0 de 13, e nada com prazo pra sumir
    // O banner "discreto" é a descoberta que fechou a questão: o que atrapalha
    // é a POSIÇÃO, não a cor nem o confete.
    //
    // E pelo M3 conquista nunca foi candidata a banner: "banner é proeminente,
    // TEM AÇÃO e fica mais tempo". O desbloqueio do Desfazer tem ação de
    // verdade (abre as Preferências pra desligá-lo); tocar numa conquista só
    // leva a OLHAR, que é navegação. Somando a frequência — Desfazer 1× na
    // vida, conquista 16× —, o mesmo banner nos dois gastava o momento do
    // Desfazer. Hoje o dourado com confete é exclusivo dele.
    //
    // A PATENTE entra na mesma regra, e não é descuido: se ela continuasse com
    // banner, o dourado voltaria a significar duas coisas — que é o defeito
    // que este bloco existe pra corrigir.
    const subiu = Number.isFinite(g.patente) && iP > g.patente;
    g.patente = iP;
    if (subiu) g.patenteNova = true;
    for (const id of novas) if (!g.novas.includes(id)) g.novas.push(id);
    salvarConquistas();
    if (subiu || novas.length) atualizarSeloDeConquista();
}

// Um PONTO, nunca um número (decisão do owner). Número convida a "zerar", e a
// app já tem a regra de não mostrar contador que a pessoa não consegue zerar —
// conquista não é caixa de entrada. Mesmo desenho da pílula da presença
// ("badged icon button" do M3), que já mede 44px e não custa layout: ele mora
// SOBRE o ícone.
// Há algo destravado que a pessoa ainda não viu? FONTE ÚNICA da pergunta:
// quem ACENDE o ponto e quem decide PRA ONDE o botão leva precisam concordar
// sempre — duas cópias da condição é como elas passam a discordar, e aí o
// ponto aparece levando pra lugar nenhum (ou some levando pra algum).
//
// Lê do ARMAZENAMENTO, não do que estiver em memória: quem destravou ontem e
// fechou a app voltaria sem nada até o primeiro swipe. Deslogado não carrega
// nada — isto é estado de quem entrou.
function temConquistaNova() {
    if (!AppState.authenticated) return false;
    const g = carregarConquistas();
    return !!g && (g.novas.length > 0 || g.patenteNova);
}

function atualizarSeloDeConquista() {
    const btn = document.getElementById('filtersBtn');
    const selo = document.getElementById('conqSelo');
    if (!btn || !selo) return;
    const tem = temConquistaNova();
    selo.classList.toggle('hidden', !tem);
    // O ponto é `aria-hidden`: quem não enxerga precisa da informação no NOME
    // do botão, senão o selo não existe pra leitor de tela nenhum.
    btn.setAttribute('aria-label', t('header.filters.aria') + (tem ? ' — ' + t('conq.selo.aria') : ''));
}

// Abrir a aba É ter visto. Some o selo e, na PRÓXIMA abertura, somem os anéis —
// nesta a pessoa ainda precisa ver o que destravou, então não re-renderiza.
function marcarConquistasVistas() {
    const g = AppState.conquistas;
    if (!g || (!g.novas.length && !g.patenteNova)) return;
    g.novas = [];
    g.patenteNova = false;
    salvarConquistas();
    atualizarSeloDeConquista();
}

// ── a tela ─────────────────────────────────────────────────────────────────
// Estado só de VISUALIZAÇÃO (escada aberta, conquista tocada): não persiste,
// não sai no diagnóstico, morre quando o modal fecha.
let escadaAberta = false;
let conquistaTocada = null;

function htmlPatente() {
    const g = carregarConquistas();
    const s = getHistoryStats();
    const tratados = s.total.read + s.total.rejected;
    const i = patenteDe(tratados);
    const atual = PATENTES[i], prox = PATENTES[i + 1] || null;
    const pct = prox ? Math.max(0, Math.min(100,
        Math.round(((tratados - atual.min) / (prox.min - atual.min)) * 100))) : 100;
    const nome = (r) => escapeHtml(t('conq.rank.' + r.id));

    const degraus = escadaAberta ? PATENTES.map((r, k) => `
        <div class="conq-deg${k === i ? ' aqui' : ''}">
            <span class="e">${r.emoji}</span><span class="n">${nome(r)}</span>
            <span class="a tnum">${r.min}</span>
            <span class="m" aria-hidden="true">${k < i ? '✓' : k === i ? '●' : ''}</span>
        </div>`).join('') : '';

    return `<div class="conq-card${g.patenteNova ? ' nova' : ''}">
        <div class="conq-topo">
            <span class="conq-emoji" aria-hidden="true">${atual.emoji}</span>
            <div class="conq-id">
                <div class="conq-eyebrow">${escapeHtml(t('conq.patente.titulo'))}</div>
                <div class="conq-nome">${nome(atual)}</div>
            </div>
            <div class="conq-tot tnum"><span class="conq-num">${tratados}</span><br>
                <span class="conq-sub">${escapeHtml(t('conq.patente.tratados'))}</span></div>
        </div>
        <div class="conq-barra"><i style="width:${pct}%"></i></div>
        <div class="conq-rodape conq-sub tnum">
            <span>${prox ? escapeHtml(t('conq.patente.faltam',
                { n: prox.min - tratados, p: prox.emoji + ' ' + t('conq.rank.' + prox.id) }))
                : escapeHtml(t('conq.patente.topo'))}</span>
            <button type="button" id="conqEscadaBtn" class="conq-link" aria-expanded="${escadaAberta}">${
                escapeHtml(t(escadaAberta ? 'conq.patente.verMenos' : 'conq.patente.ver'))}</button>
        </div>
        ${escadaAberta ? `<div class="conq-escada">${degraus}</div>` : ''}
    </div>`;
}

function htmlConquistas() {
    const g = carregarConquistas();
    const lista = conquistasVisiveis();
    const ganhas = lista.filter((x) => g.c[x.id]).length;
    // 3 colunas; o CSS cai pra 2 abaixo de 400px. Em 4 a célula fica estreita
    // demais e uma coluna estica pra caber o nome mais longo — medido.
    const grade = lista.map((x, k) => {
        const on = !!g.c[x.id];
        const sel = conquistaTocada === x.id;
        const nova = g.novas.includes(x.id);
        return `<button type="button" class="conq-cel ${on ? 'on' : 'off'}${sel ? ' sel' : ''}${nova ? ' nova' : ''}"
            data-conq="${escapeHtml(x.id)}" aria-pressed="${sel}">
            <span class="e" aria-hidden="true">${x.emoji}</span>
            <span class="n">${escapeHtml(t('conq.' + x.id + '.nome'))}</span>` +
            (nova ? `<span class="conq-tag">${escapeHtml(t('conq.nova'))}</span>` : '') +
            `</button>`;
    }).join('');
    const tocada = conquistaTocada && lista.find((x) => x.id === conquistaTocada);
    // A condição mora AQUI e não dentro da célula: na largura da grade ela
    // esticaria a coluna pelo mesmo motivo acima, e a frase é bem mais longa
    // que o nome.
    const dica = tocada
        ? `<p class="conq-dica" id="conqDica"><span><b>${tocada.emoji} ${escapeHtml(t('conq.' + tocada.id + '.nome'))}</b>`
          + ` — ${g.c[tocada.id] ? '✓ ' : ''}${escapeHtml(t('conq.' + tocada.id + '.como'))}</span></p>`
        : '';
    return `<div class="conq-h"><h4>${escapeHtml(t('conq.titulo'))}</h4>`
         + `<span class="tnum">${escapeHtml(t('conq.de', { a: ganhas, b: lista.length }))}</span></div>`
         + `<div class="conq-grade">${grade}</div>${dica}`;
}

// Liga os toques DEPOIS da inserção no DOM. Delegado ao container: o innerHTML
// é reescrito a cada render e listener em filho morre junto.
function ligarConquistas(el) {
    el.addEventListener('click', (ev) => {
        const b = ev.target.closest('#conqEscadaBtn');
        if (b) { escadaAberta = !escadaAberta; renderHistory(); return; }
        const c = ev.target.closest('[data-conq]');
        if (!c) return;
        const id = c.getAttribute('data-conq');
        conquistaTocada = conquistaTocada === id ? null : id;
        renderHistory();
        // A linha nasce ABAIXO da grade e, tocando uma célula de cima, ela cai
        // fora da tela — a explicação apareceria onde ninguém vê. `nearest` rola
        // o mínimo, então quando já está visível nada se mexe sob o dedo.
        if (conquistaTocada) {
            document.getElementById('conqDica')?.scrollIntoView({ block: 'nearest' });
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Resumo do mês — a imagem que a pessoa manda no grupo
// ═══════════════════════════════════════════════════════════════════════════
//
// Uma imagem 4:5 (1080×1350 — o formato que WhatsApp e Instagram não cortam)
// gerada NO APARELHO, com canvas e zero dependência, a partir do histórico por
// dia que a app já guarda. Celebra uma vez, quando a pessoa pede, e não
// pressiona ninguém: não há sequência, meta nem ranking aqui — só o mês.
//
// Escura de propósito, e só escura: é pra saltar no fundo claro do WhatsApp.
//
// O que ela NÃO mostra ainda, e por quê: "pulados" e "onde" (estados) exigem
// que o histórico passe a gravar dado que hoje não grava. É formato novo com
// migração — fica como etapa própria, decidida à parte.
//
// A fonte é a Inter auto-hospedada, que vai só até o peso 700 (ver
// css/styles.css). Pedir 800/900 aqui não dá erro: o browser SINTETIZA o
// negrito ou cai no fallback, em silêncio. `test/resumo.test.mjs` reprova
// qualquer peso acima de 700 nesta seção.
const RESUMO_LARGURA = 1080;
const RESUMO_ALTURA = 1350;

// Dados PUROS do mês-calendário, a partir do histórico por dia. Sem DOM, sem
// i18n, sem relógio — é o que o teste fatia e exercita sem browser.
//
// Note a diferença pro "Este mês" da aba Histórico, que é uma JANELA de 30
// dias: aqui é o mês do calendário, porque é assim que a pessoa fala do mês
// ("meu setembro") e é isso que o título da imagem promete.
function dadosDoResumo(h, ano, mesIdx) {
    const prefixo = `${ano}-${String(mesIdx + 1).padStart(2, '0')}-`;
    const diasNoMes = new Date(ano, mesIdx + 1, 0).getDate();
    const serie = new Array(diasNoMes).fill(0);
    let lidos = 0, rejeitados = 0, diasAtivos = 0;
    let forte = { dia: 0, n: 0 };
    for (const [k, v] of Object.entries(h || {})) {
        if (k === '_total' || !v || typeof v !== 'object' || !k.startsWith(prefixo)) continue;
        const dia = parseInt(k.slice(prefixo.length), 10);
        if (!(dia >= 1 && dia <= diasNoMes)) continue;
        const r = v.read || 0, j = v.rejected || 0, n = r + j;
        lidos += r; rejeitados += j;
        serie[dia - 1] = n;
        if (n > 0) diasAtivos++;
        // Empate: o dia mais CEDO vence — regra explícita, e não a ordem em que
        // as chaves estão no objeto, que ninguém garante.
        if (n > forte.n || (n > 0 && n === forte.n && dia < forte.dia)) forte = { dia, n };
    }
    return { ano, mesIdx, diasNoMes, lidos, rejeitados, total: lidos + rejeitados, diasAtivos, forte, serie };
}

// Desenho puro: recebe o contexto, os dados e os TEXTOS já traduzidos. Nada
// de `t()` aqui dentro — quem chama escolhe a palavra, e este código só
// posiciona. Pesos de fonte: só 400/500/600/700.
function desenharResumo(ctx, d, tx, { qr = null, logo = null, hoje = null } = {}) {
    const W = RESUMO_LARGURA, H = RESUMO_ALTURA, PAD = 80;
    const fonte = (peso, tam) => `${peso} ${tam}px Inter, system-ui, -apple-system, sans-serif`;
    const rr = (x, y, w, h, r) => {
        ctx.beginPath(); ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    };
    const texto = (s, x, y, peso, tam, cor, alinhar = 'left', espaco = 0) => {
        ctx.font = fonte(peso, tam); ctx.fillStyle = cor; ctx.textAlign = alinhar; ctx.textBaseline = 'alphabetic';
        if ('letterSpacing' in ctx) ctx.letterSpacing = espaco + 'px';
        ctx.fillText(s, x, y);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        return ctx.measureText(s).width;
    };
    const cartao = (x, y, w, h) => {
        rr(x, y, w, h, 22);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
    };

    // Fundo
    const g = ctx.createRadialGradient(W * 0.8, -H * 0.1, 0, W * 0.8, -H * 0.1, 1300);
    g.addColorStop(0, '#164e63'); g.addColorStop(0.55, '#0f172a'); g.addColorStop(1, '#020617');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Cabeçalho: marca à esquerda, período à direita
    if (logo) {
        ctx.save(); rr(PAD, 72, 46, 46, 12); ctx.clip(); ctx.drawImage(logo, PAD, 72, 46, 46); ctx.restore();
    } else {
        rr(PAD, 72, 46, 46, 12); ctx.fillStyle = '#0891b2'; ctx.fill();
    }
    texto(tx.marca, PAD + 60, 104, 700, 26, '#ffffff');
    texto(tx.periodo, W - PAD, 104, 600, 22, '#67e8f9', 'right', 2);

    // O número
    texto(tx.limpou, PAD, 232, 500, 28, '#a5f3fc');
    texto(tx.total, PAD, 380, 700, 168, '#ffffff', 'left', -6);
    texto(tx.pedidos, PAD, 445, 600, 34, '#e2e8f0');

    // Duas caixas grandes: rejeitados · lidos
    const gap = 18, wCol = (W - PAD * 2 - gap) / 2;
    tx.tiles.forEach(([n, rotulo, cor], i) => {
        const x = PAD + i * (wCol + gap), y = 520;
        cartao(x, y, wCol, 138);
        texto(n, x + 24, y + 70, 700, 52, cor);
        texto(rotulo, x + 24, y + 108, 400, 21, '#cbd5e1');
    });

    // Duas caixas pequenas: dia mais forte · dias ativos
    {
        const y = 676;
        cartao(PAD, y, wCol, 122);
        texto(tx.forteRotulo, PAD + 24, y + 40, 400, 18, '#94a3b8', 'left', 1.2);
        const w1 = texto(tx.forteValor + ' · ', PAD + 24, y + 88, 700, 30, '#ffffff');
        texto(tx.forteN, PAD + 24 + w1, y + 88, 700, 30, '#67e8f9');
        const x2 = PAD + wCol + gap;
        cartao(x2, y, wCol, 122);
        texto(tx.ativosRotulo, x2 + 24, y + 40, 400, 18, '#94a3b8', 'left', 1.2);
        texto(tx.ativosValor, x2 + 24, y + 88, 700, 30, '#ffffff');
    }

    // O mês dia a dia: uma barra por dia. Dia futuro sai apagado; o mais forte
    // acende. É o que dá a esta imagem a forma DAQUELE mês, e não de um modelo.
    {
        const y = 822, h = 230, x0 = PAD + 24, x1 = W - PAD - 24;
        cartao(PAD, y, W - PAD * 2, h);
        texto(tx.serieRotulo, x0, y + 40, 400, 18, '#94a3b8', 'left', 1.2);
        const n = d.serie.length, gapB = 6, wB = (x1 - x0 - gapB * (n - 1)) / n;
        const topo = y + 68, alt = 120, max = Math.max(1, ...d.serie);
        for (let i = 0; i < n; i++) {
            const v = d.serie[i];
            const futuro = hoje !== null && i + 1 > hoje;
            const hb = futuro ? 4 : (v > 0 ? Math.max(4, Math.round((v / max) * alt)) : 4);
            const bx = x0 + i * (wB + gapB), by = topo + alt - hb;
            rr(bx, by, wB, hb, Math.min(4, wB / 2));
            ctx.fillStyle = futuro ? 'rgba(255,255,255,0.08)'
                : (i + 1 === d.forte.dia && v > 0 ? '#67e8f9' : (v > 0 ? 'rgba(103,232,249,0.45)' : 'rgba(255,255,255,0.12)'));
            ctx.fill();
        }
        // Marcas de dia embaixo — só as que cabem: 1, 10, 20 e o último.
        const marcas = [1, 10, 20, n].filter((m, i, a) => a.indexOf(m) === i && m <= n);
        for (const m of marcas) {
            const cx = x0 + (m - 1) * (wB + gapB) + wB / 2;
            texto(String(m), cx, topo + alt + 26, 400, 14, '#64748b', 'center');
        }
    }

    // Rodapé: quem é, a frase, e o QR pra app
    texto(tx.editor, PAD, 1218, 400, 24, '#94a3b8');
    // A frase pode não caber ao lado do QR em idioma mais longo: encolhe até caber.
    for (let tam = 24; tam >= 18; tam -= 2) {
        ctx.font = fonte(600, tam);
        if (ctx.measureText(tx.tagline).width <= 700) { texto(tx.tagline, PAD, 1258, 600, tam, '#67e8f9'); break; }
        if (tam === 18) texto(tx.tagline, PAD, 1258, 600, 18, '#67e8f9');
    }
    if (qr && qr.modulos) {
        const QUIET = 2, lado = qr.tamanho + QUIET * 2, esc = Math.floor(150 / lado), px = lado * esc;
        const bx = W - PAD - px - 12, by = H - PAD - px - 12;
        rr(bx - 12, by - 12, px + 24, px + 24, 14); ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.fillStyle = '#0f172a';
        for (let l = 0; l < qr.tamanho; l++) {
            for (let c = 0; c < qr.tamanho; c++) {
                if (qr.modulos[l][c]) ctx.fillRect(bx + (c + QUIET) * esc, by + (l + QUIET) * esc, esc, esc);
            }
        }
    }
}

// Monta os textos (é aqui que o i18n entra), espera a fonte e o QR, e desenha.
// Devolve null quando o mês está vazio — o botão nem aparece nesse caso, mas a
// função se defende sozinha.
async function gerarResumoDoMes() {
    const agora = new Date();
    const d = dadosDoResumo(loadHistory(), agora.getFullYear(), agora.getMonth());
    if (d.total === 0) return null;
    const loc = i18nLocale();
    const p = AppState.profile || {};
    const selos = ['L' + ((Number.isInteger(p.rank) ? p.rank : 0) + 1)];
    if (p.isStaff) selos.push(t('profile.tag.staff'));
    else if (p.isAreaManager) selos.push(t('profile.tag.am'));
    const mesNome = new Date(d.ano, d.mesIdx, 1).toLocaleDateString(loc, { month: 'long' });
    const forteData = d.forte.dia
        ? new Date(d.ano, d.mesIdx, d.forte.dia).toLocaleDateString(loc, { weekday: 'long', day: 'numeric' })
        : '—';
    const tx = {
        marca: 'WazePlaces',
        periodo: (mesNome + ' · ' + d.ano).toLocaleUpperCase(loc),
        limpou: t('resumo.img.limpou', { nome: p.userName || '' }),
        total: String(d.total),
        pedidos: t('resumo.img.pedidos'),
        tiles: [
            [String(d.rejeitados), t('resumo.img.rejeitados'), '#fb7185'],
            [String(d.lidos), t('resumo.img.lidos'), '#34d399'],
        ],
        forteRotulo: t('resumo.img.diaForte'), forteValor: forteData, forteN: String(d.forte.n),
        ativosRotulo: t('resumo.img.diasAtivos'),
        ativosValor: t('resumo.img.diasDe', { n: d.diasAtivos, de: d.diasNoMes }),
        serieRotulo: t('resumo.img.diaADia', { mes: mesNome }),
        editor: t('resumo.img.editor', { selos: selos.join(' · ') }),
        tagline: t('resumo.img.tagline'),
    };
    // A fonte precisa estar CARREGADA antes do fillText, senão o canvas desenha
    // com a fonte do sistema e o texto some do lugar. Falhar aqui não impede a
    // imagem — só a deixa na fonte do sistema.
    try {
        if (document.fonts && document.fonts.load) {
            await Promise.all([400, 500, 600, 700].map((w) => document.fonts.load(`${w} 24px Inter`)));
        }
    } catch (e) {}
    let qr = null;
    try { if (await carregarQr()) qr = gerarQR(location.origin); } catch (e) { qr = null; }
    let logo = null;
    try {
        const img = new Image();
        img.src = 'icons/icon-192.svg';
        await img.decode();
        logo = img;
    } catch (e) { logo = null; }
    const canvas = document.createElement('canvas');
    canvas.width = RESUMO_LARGURA; canvas.height = RESUMO_ALTURA;
    const hoje = (agora.getFullYear() === d.ano && agora.getMonth() === d.mesIdx) ? agora.getDate() : null;
    desenharResumo(canvas.getContext('2d'), d, tx, { qr, logo, hoje });
    return { canvas, mesNome, nomeArquivo: `wazeplaces-${d.ano}-${String(d.mesIdx + 1).padStart(2, '0')}.png` };
}

// O que está na folha agora: o blob e o nome. Limpo em LIMPEZA_AO_FECHAR —
// modal fecha por três caminhos, e amarrar a limpeza a um deixa os outros vazando.
let resumoAtual = null;

async function abrirResumoDoMes() {
    let r = null;
    try { r = await gerarResumoDoMes(); } catch (e) { r = null; }
    const blob = r ? await new Promise((res) => { try { r.canvas.toBlob(res, 'image/png'); } catch (e) { res(null); } }) : null;
    if (!blob) { showToast(t('toast.resumoFalhou'), 'error'); return; }
    resumoAtual = { blob, nome: r.nomeArquivo, mesNome: r.mesNome };
    const img = document.getElementById('resumoImg');
    if (img.src) { try { URL.revokeObjectURL(img.src); } catch (e) {} }
    img.src = URL.createObjectURL(blob);
    img.alt = t('resumo.img.alt');
    document.getElementById('resumoTitle').textContent = t('resumo.modal.title', { mes: r.mesNome });
    // Compartilhar só onde o aparelho compartilha ARQUIVO (Android, iOS 15+).
    // No desktop o botão some e fica o Baixar — nunca um botão que não faz nada.
    let podeCompartilhar = false;
    try {
        const arquivo = new File([blob], r.nomeArquivo, { type: 'image/png' });
        podeCompartilhar = !!(navigator.canShare && navigator.canShare({ files: [arquivo] }));
    } catch (e) { podeCompartilhar = false; }
    document.getElementById('resumoCompartilhar').classList.toggle('hidden', !podeCompartilhar);
    openModal('resumoModal');
}

async function compartilharResumo() {
    if (!resumoAtual) return;
    try {
        const arquivo = new File([resumoAtual.blob], resumoAtual.nome, { type: 'image/png' });
        await navigator.share({ files: [arquivo], title: 'WazePlaces', text: t('resumo.share.text', { mes: resumoAtual.mesNome }) });
        checarConquistas({ resumo: true });
    } catch (e) {
        // Cancelar a folha de compartilhar é escolha, não erro.
    }
}

function baixarResumo() {
    if (!resumoAtual) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resumoAtual.blob);
    a.download = resumoAtual.nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    checarConquistas({ resumo: true });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Recusa automática: os pedidos que chegam de um autor marcado
// ═══════════════════════════════════════════════════════════════════════════
//
// É o único recurso da app que decide sobre pedido que ainda não existia quando
// o editor escolheu. Duas coisas foram desenhadas contra o instinto:
//
// 1. PORTÃO. Só L6+AM ou staff — champs e staff do Waze, não qualquer editor.
//    Foi a condição do owner pra o recurso existir, e é ela que sustenta o
//    resto: quem marca alguém aqui está fazendo julgamento informado sobre um
//    spammer persistente, não um toque apressado.
//
// 2. O PLACAR ANDA COM O ENVIO, não antes dele (`contarAoLandar`). Em todo o
//    resto da app o placar é otimista, porque existe uma janela de Desfazer que
//    devolve o número. Aqui não há janela: os pedidos vão direto, um a um. Se
//    a página morresse no meio de um laço já contado, o placar ficaria com
//    números que nunca saíram — e não haveria quando reconciliar. Contando ao
//    landar, o número na tela é sempre o que de fato foi enviado.
//
// Houve uma janela de 20s aqui, com aviso no futuro ("serão rejeitados") e
// oferta de cancelar. Saiu por decisão do owner, e o motivo é o que a linha do
// tempo mostrou: a janela começa quando o APP BUSCA a fila, não quando o editor
// escolhe — ou seja, sempre no meio de outro card. Vinte segundos parados sobre
// algo que ninguém está olhando não protegem; só atrasam. O que ficou no lugar
// é honesto sobre o mesmo fato: o aviso conta enquanto acontece.

function podeRecusarAutomaticoAqui() {
    // Função própria que delega, como os outros destrutivos: são decisões de
    // produto que hoje coincidem, e se o owner separar uma o call site não muda.
    return podeAgirComoL6Aqui();
}

// O interruptor mora no MESMO registro da contagem: a poda de 30 dias vale pros
// dois, e isso é o certo — autor que parou de mandar por um mês não precisa
// seguir com recusa automática armada.
function autoLigado(chave) {
    const e = loadAutores().r[String(chave)];
    return Array.isArray(e) && e[3] === 1;
}

function alternarAutoDoAutor(chave) {
    if (!podeRecusarAutomaticoAqui()) return;
    const a = loadAutores();
    const e = a.r[String(chave)];
    if (!Array.isArray(e)) return;
    e[3] = e[3] === 1 ? 0 : 1;
    salvarAutores(a);
    renderHistory();
}

// Uma execução por vez: a fila pode crescer de novo enquanto o laço corre, e
// duas passagens simultâneas mandariam o mesmo pedido duas vezes.
let recusaAutomaticaRodando = false;

// Chamado depois de a fila crescer. Tira os pedidos dos autores marcados e
// rejeita na hora, um a um, com o aviso contando quantos faltam.
async function aplicarRecusaAutomatica() {
    if (!podeRecusarAutomaticoAqui()) return;
    if (Treino.ativo) return;               // no treino a fila é de exemplos
    if (recusaAutomaticaRodando) return;
    const alvos = (AppState.queue || []).filter(
        (x) => x && x.creatorId !== undefined && x.creatorId !== null && autoLigado(x.creatorId));
    if (alvos.length === 0) return;

    recusaAutomaticaRodando = true;
    const n = alvos.length;
    const autor = alvos[0].createdBy || String(alvos[0].creatorId);
    // Saem da fila ANTES de enviar: senão o editor veria como card o pedido que
    // a app já está rejeitando, e poderia agir nele — dois envios pro mesmo.
    const fora = new Set(alvos);
    const eraOAtual = AppState.currentPlace && fora.has(AppState.currentPlace);
    AppState.queue = AppState.queue.filter((x) => !fora.has(x));
    updatePendingCount();
    if (eraOAtual) {
        AppState.currentPlace = null;
        removeCurrentCardEl();
        if (AppState.queue.length > 0) showCurrentPlace();
        else if (AppState.hasMore) startFetching();
        else showNoPlaces();
    }

    // O aviso é só ACOMPANHAMENTO: conta enquanto acontece e some quando acaba.
    // Decisão do owner — "a ideia do toast é só informar". Não sobra banner
    // depois, porque depois não há nada a informar: o trabalho terminou.
    //
    // O prazo é folgado (10 min) de propósito: quem dispensa é o `finally`, não
    // o relógio. Ele existe só pra que uma falha exótica no laço não deixe o
    // aviso preso na tela pra sempre.
    //
    // Quem falhou VOLTA PRA FILA (ver `enviarLote`) e reaparece como card —
    // é esse o retorno em caso de erro. O aviso de fim que existia aqui dizia
    // "N rejeitados" com o N ORIGINAL, então mentia justamente quando algo
    // dava errado.
    const andando = (q) => t(q === 1 ? 'auto.andando' : 'auto.andandoPlural', { n: q, autor });
    const aviso = showToast(andando(n), 'hint', 600000);
    try {
        await enviarLote(alvos, {
            silencioso: true,
            contarAoLandar: true,
            aoProgredir: (faltam) => {
                if (faltam > 0) aviso.texto(andando(faltam));
            },
        });
    } finally {
        recusaAutomaticaRodando = false;
        // Acabou: o aviso sai. Desligar o automático de alguém continua onde
        // sempre esteve — o interruptor da lista, na aba Histórico.
        aviso.dispensar();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  A série de um autor: ver primeiro, ou rejeitar os que estão na fila
// ═══════════════════════════════════════════════════════════════════════════
//
// Abre pelo selo `✕ N`. NÃO há tela de confirmação depois: o número vai no
// próprio botão e o aviso diz que começa ao tocar — que é exatamente o que uma
// segunda pergunta carregaria. Confirmação que só repete o número treina todo
// mundo a tocar sem ler.
//
// O lote vai UM A UM, e isso não é preguiça: o lote atômico do WME falha
// INTEIRO quando outro editor já tratou um dos itens (o mesmo caso que a app
// já sabe tratar como `already_processed`). N requisições que sempre terminam
// valem mais que uma que às vezes morre inteira.
const ICONE_OLHO = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5'
    + 'c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
const ICONE_X = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>';
// A lixeira é a MESMA da lista do Histórico — mesmo conceito, mesmo ícone em
// toda a app. Era um `const lixo` local do `renderAutores`; virou módulo quando
// a folha do autor passou a oferecer o mesmo esquecer.
const ICONE_LIXO = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"'
    + ' d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0'
    + ' 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
// Raio = "acontece sozinho", que é exatamente o que a recusa automática faz.
const ICONE_RAIO = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>';

// Os pedidos DESTE autor que estão na fila carregada agora.
function pedidosDoAutorNaFila(place) {
    const id = place && place.creatorId;
    if (id === null || id === undefined || id === '') return [];
    return (AppState.queue || []).filter((x) => x && x.creatorId === id);
}

// A folha se adapta ao TAMANHO da fila, e é essa adaptação que justifica o selo
// vermelho ser sempre tocável.
//
// Com MAIS DE UM pedido na fila há trabalho em lote de verdade: ver todos na
// frente, rejeitar todos de uma vez (destrutivo, sem Desfazer depois de enviado).
//
// Com UM SÓ — o caso de ~3 em cada 4 cards — essas duas linhas seriam o card que
// já está na tela, com os três botões logo abaixo, e a de rejeitar seria ESTRITAMENTE
// PIOR que o ✕: o lote não tem a janela de Desfazer que o card único tem. Então
// elas somem, e o que fica é o que o card NÃO consegue mostrar:
//   · o que "✕ N" quer dizer — o `title` do selo não existe no toque, e este é o
//     único jeito de descobrir num celular o que aquele número conta;
//   · a recusa automática deste autor, que hoje só se alcança por Filtros →
//     Histórico, rolando até achar a pessoa;
//   · o esquecer, pra quando você discorda da contagem.
// Esses três valem nos DOIS tamanhos, então ficam sempre.
function abrirFolhaDoAutor(place) {
    if (!place) return;
    const corpo = document.getElementById('autorCorpo');
    const titulo = document.getElementById('autorTitle');
    if (!corpo || !titulo) return;
    const naFila = pedidosDoAutorNaFila(place);
    const emLote = naFila.length > 1;
    const chave = String(place.creatorId);
    const nome = place.createdBy || chave;
    titulo.textContent = nome;
    const linha = (ic, cor, t1, t2, id) =>
        `<button type="button" id="${id}" class="flex items-center gap-3 w-full min-h-[56px] py-2 text-left`
        + ` border-b border-slate-100 dark:border-slate-700 last:border-0">`
        + `<span class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${cor}">${ic}</span>`
        + `<span class="flex-1 min-w-0"><span class="block text-[0.9375rem] font-semibold text-slate-800 dark:text-slate-100 leading-tight">`
        + `${escapeHtml(t1)}</span><span class="block text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">`
        + `${escapeHtml(t2)}</span></span></button>`;
    // O interruptor é uma LINHA-label, não um botão: o alvo de 44px é a linha
    // inteira (aqui dá, ao contrário da lista do Histórico, que também tem a
    // lixeira na mesma linha e um toque perto dela alternaria sem querer).
    const linhaAuto = () =>
        `<label class="flex items-center gap-3 w-full min-h-[56px] py-2 text-left cursor-pointer`
        + ` border-b border-slate-100 dark:border-slate-700 last:border-0">`
        + `<span class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0`
        + ` bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">${ICONE_RAIO}</span>`
        + `<span class="flex-1 min-w-0"><span class="block text-[0.9375rem] font-semibold text-slate-800 dark:text-slate-100 leading-tight">`
        + `${escapeHtml(t('stats.autores.auto'))}</span><span class="block text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">`
        + `${escapeHtml(t('stats.autores.autoDesc'))}</span></span>`
        + `<input type="checkbox" id="autorAuto" class="ui-switch flex-shrink-0"${autoLigado(chave) ? ' checked' : ''}></label>`;
    corpo.innerHTML =
        `<p class="text-[0.8125rem] text-slate-500 dark:text-slate-400 mb-4 leading-snug">`
        + `${escapeHtml(t(emLote ? 'autor.sheet.sub' : 'autor.sheet.subUm',
                          { n: contagemDoAutor(place), fila: naFila.length, dias: AUTORES_MAX_DIAS }))}</p>`
        + (emLote
            ? linha(ICONE_OLHO, 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                    t('autor.sheet.ver', { n: naFila.length }), t('autor.sheet.ver.desc'), 'autorVer')
              + linha(ICONE_X, 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
                      t('autor.sheet.rejeitar', { n: naFila.length }), t('autor.sheet.rejeitar.desc'), 'autorRejeitar')
            : '')
        // Mesmo portão da lista do Histórico: mostrar o interruptor desabilitado
        // anunciaria um recurso que a pessoa não pode usar, e a app não faz isso.
        + (podeRecusarAutomaticoAqui() ? linhaAuto() : '')
        + linha(ICONE_LIXO, 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                t('stats.autores.esquecer'), t('autor.sheet.esquecer.desc'), 'autorEsquecer')
        // O aviso é da rejeição em LOTE, então acompanha a linha que ele descreve.
        // Sem ela na tela, um aviso vermelho sobre "não há segunda pergunta"
        // descreveria o interruptor errado — e o interruptor tem a própria frase.
        + (emLote
            ? `<p class="mt-4 text-xs leading-relaxed text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-500/10`
              + ` border border-rose-100 dark:border-rose-500/30 rounded-xl px-3 py-2.5">${t('autor.sheet.aviso')}</p>`
            : '');
    if (emLote) {
        document.getElementById('autorVer').addEventListener('click', () => {
            closeModal('autorModal');
            focarAutor(place.creatorId);
        });
        document.getElementById('autorRejeitar').addEventListener('click', () => {
            closeModal('autorModal');
            rejeitarLoteDoAutor(place);
        });
    }
    const auto = document.getElementById('autorAuto');
    // Relê o estado depois de alternar em vez de confiar no `.checked`: se o
    // `alternarAutoDoAutor` recusar (registro sumiu por poda entre o render e o
    // toque), o interruptor volta sozinho em vez de mentir que ligou.
    if (auto) auto.addEventListener('change', () => {
        alternarAutoDoAutor(chave);
        auto.checked = autoLigado(chave);
    });
    document.getElementById('autorEsquecer').addEventListener('click', () => {
        closeModal('autorModal');
        esquecerAutor(chave);
        // O selo que abriu esta folha some agora: fechar deixando o `✕ N` na tela
        // faria a app afirmar uma contagem que ela acabou de apagar.
        removeCurrentCardEl();
        showCurrentPlace();
    });
    openModal('autorModal');
}

// O lote, com a MESMA janela de Desfazer de um card só — a trava dos botões, o
// banner com a contagem, o `resetQueue`. A diferença é `aoSair: 'cancel'`.
function rejeitarLoteDoAutor(place) {
    if (acoesTravadas()) return;
    if (Treino.ativo) { showToast(t('treino.semLote'), 'info'); return; }
    const places = pedidosDoAutorNaFila(place);
    if (places.length === 0) { showToast(t('toast.batchEmpty'), 'info'); return; }
    const n = places.length;
    // Otimista, como o card único: o placar anda agora e volta no Desfazer.
    AppState.stats.rejected += n;
    AppState.serverTotal = Math.max(0, AppState.serverTotal - n);
    updateStats();
    saveStats();
    const ids = new Set(places);
    AppState.queue = (AppState.queue || []).filter((x) => !ids.has(x));
    AppState.currentPlace = null;
    updatePendingCount();
    if (AppState.queue.length > 0) { removeCurrentCardEl(); showCurrentPlace(); maybePrefetch(); }
    else if (AppState.hasMore) { removeCurrentCardEl(); startFetching(); }
    else { removeCurrentCardEl(); showNoPlaces(); }
    scheduleAction('reject', places, () => enviarLote(places), { aoSair: 'cancel' });
}

// Um a um, e o resultado NÃO é um número só: cada pedido tem destino próprio.
// "Já tratado por outro editor" conta como cumprido — é a mesma regra que a app
// usa no card único, e chamá-lo de falha aqui daria dois nomes à mesma coisa.
// `silencioso` existe pra recusa automática: lá quem presta contas é o banner
// (que já diz o número e oferece desligar), e abrir a folha por cima do card
// seria a app interrompendo por algo que o editor não pediu.
// `contarAoLandar` troca o placar OTIMISTA pelo placar que anda junto com o
// envio. O lote manual (que tem janela de Desfazer) precisa do otimista: ele
// mostra o resultado antes de mandar, e o Desfazer devolve. A recusa automática
// não tem janela nenhuma — contar antes ali criaria uma divergência que ninguém
// pode reconciliar se a página morrer no meio do laço.
// `aoProgredir` recebe quantos AINDA FALTAM, pra quem quiser mostrar.
async function enviarLote(places, opts = {}) {
    const conta = { ok: 0, ja: 0, erro: 0 };
    const aoLandar = !!opts.contarAoLandar;
    const progresso = () => {
        if (aoLandar) { updateStats(); saveStats(); updatePendingCount(); }
        if (opts.aoProgredir) opts.aoProgredir(places.length - conta.ok - conta.ja - conta.erro, conta);
    };
    // Em andamento até cada um resolver: uma busca que chegue no meio não os
    // traz de volta como card (ver `semOsJaDecididos`). A marca mora AQUI e não
    // só no `scheduleAction` porque a recusa automática chega sem passar por
    // ele — ela tira os pedidos da fila e manda direto.
    marcarEmAndamento(places, true);
    AppState.inFlightActions++;
    updateInFlightIndicator();
    try {
        for (const p of places) {
            const r = await callWithRetry(() => API.rejectPlace(p.venueID, p.updateRequestID));
            if (r && r.success) {
                conta.ok++;
                registrarPouso(p);
                recordHistory('reject', 1);
                registrarRejeicaoDeAutor(p);
                if (aoLandar) {
                    AppState.stats.rejected++;
                    AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
                }
            } else if (r && (r.errorCategory === 'already_processed' || r.errorCategory === 'not_found')) {
                conta.ja++;
                registrarPouso(p);
                if (aoLandar) AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
            } else if (r && r.errorCategory === 'unauthorized') {
                handleUnauthorized();
                return;
            } else if (r && r.errorCategory === 'transient' && !aoLandar && enfileirarSaida('reject', p)) {
                // Rede, não recusa: o lote também entra na fila de saída, senão
                // a promessa ("nada do que você fez se perde") valeria só pro
                // swipe e não pro botão de rejeitar em lote. Conta como OK
                // porque o placar otimista já subiu e o trabalho foi feito.
                //
                // `!aoLandar` NÃO é cinto e suspensório. Nesse modo (a recusa
                // automática) o placar só anda no `r.success`, e o pouso da fila
                // de propósito não soma nada — então enfileirar ali faria a ação
                // não contar em lugar NENHUM. E não há nada a salvar: o ramo de
                // erro já devolve o pedido pra `AppState.queue`, onde ele volta
                // a ser um card. O contrato daquele modo ("o número na tela é
                // sempre o que de fato foi enviado") continua valendo.
                conta.ok++;
            } else {
                conta.erro++;
                // O que não saiu volta pra fila. Com o placar otimista é preciso
                // devolver o número junto; contando ao landar não há o que devolver,
                // porque o número nunca foi somado.
                if (!aoLandar) {
                    AppState.stats.rejected = Math.max(0, AppState.stats.rejected - 1);
                    AppState.serverTotal++;
                }
                AppState.queue.push(p);
            }
            // Resolvido: pousou, está na fila de saída, ou voltou pra fila.
            marcarEmAndamento(p, false);
            progresso();
        }
    } finally {
        // Todos, inclusive os que não chegaram a sair (sessão morta no meio).
        marcarEmAndamento(places, false);
        AppState.inFlightActions = Math.max(0, AppState.inFlightActions - 1);
        updateInFlightIndicator();
        updateStats();
        saveStats();
        updatePendingCount();
    }
    if (!opts.silencioso) mostrarResultadoDoLote(conta);
}

function mostrarResultadoDoLote(conta) {
    const corpo = document.getElementById('autorCorpo');
    const titulo = document.getElementById('autorTitle');
    if (!corpo || !titulo) return;
    const total = conta.ok + conta.ja + conta.erro;
    titulo.textContent = t('autor.lote.titulo', { n: total });
    const linha = (emoji, cor, t1, t2) =>
        `<div class="flex items-start gap-3 py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-0">`
        + `<span class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-base font-extrabold ${cor}"`
        + ` aria-hidden="true">${emoji}</span>`
        + `<span class="flex-1 min-w-0"><span class="block text-[0.9375rem] font-semibold text-slate-800 dark:text-slate-100 leading-tight">`
        + `${escapeHtml(t1)}</span><span class="block text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">`
        + `${escapeHtml(t2)}</span></span></div>`;
    let html = '';
    if (conta.ok) html += linha('✓', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-300',
        t('autor.lote.rejeitados', { n: conta.ok }), t('autor.lote.rejeitados.desc'));
    if (conta.ja) html += linha('👍', 'bg-sky-100 text-sky-800 dark:bg-sky-400/20 dark:text-sky-200',
        t('autor.lote.jaTratados', { n: conta.ja }), t('autor.lote.jaTratados.desc'));
    if (conta.erro) html += linha('!', 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
        t('autor.lote.falharam', { n: conta.erro }), t('autor.lote.falharam.desc'));
    corpo.innerHTML = html;
    openModal('autorModal');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Reincidência de autor — quantos pedidos DESTA pessoa você já rejeitou
// ═══════════════════════════════════════════════════════════════════════════
//
// O caso que originou: um entregador fotografa o PACOTE em cada parada, e o
// rótulo costuma trazer nome, endereço e telefone do destinatário. Não é foto
// ruim — é dado pessoal de terceiro indo pro mapa público, e o mesmo autor
// repete por semanas.
//
// O que a app NÃO consegue: distinguir esse autor do melhor contribuinte da
// fila pelos metadados. Medido — os dois são 100% foto, 1 foto por local, e o
// ritmo se sobrepõe. O único sinal que separa é a SUA rejeição repetida, e
// esse a app jogava fora: o histórico só guardava números por dia.
//
// ── POR QUE DUAS LISTAS, e não um mapa só ────────────────────────────────
// Medido na fila real (4.008 pedidos, 12 países, varredura só-leitura):
// 87% dos autores mandam UM pedido só (81–91% conforme o país), e a fila do
// owner recebe ~360 autores distintos por dia. Guardar todo autor rejeitado
// num mapa com nome e datas estouraria 2.000 registros em menos de uma semana
// e chegaria a 88 ms de gravação POR SWIPE — atacando exatamente o ritmo que
// o recurso existe pra devolver.
//
// Então quem foi rejeitado UMA vez mora num anel de ids (sem nome, sem data) e
// só é promovido ao mapa caro na SEGUNDA rejeição. Medido: 41 KB e 0,87 ms.
const AUTORES_KEY = 'waze_places_autores';
// Teto do mapa dos que repetiram. Ao encher, sai quem tem a rejeição mais
// antiga — é o que torna o custo CONSTANTE, não importa quantos anos de uso.
const AUTORES_MAX_REINCIDENTES = 500;
// Teto do anel dos vistos-uma-vez. Só ids, sem nome e sem data.
//
// O número sai dos 30 DIAS logo abaixo, não de performance — e essa é a parte
// que engana. O mapa expira por IDADE; o anel expira por CAPACIDADE. Se ele não
// segurar 30 dias de rejeições, a app deixa de promover quem foi rejeitado no
// dia 1 e no dia 25, porque o id do dia 1 já saiu por lotação. A promessa que o
// próprio card faz ("entra quem você rejeitou 2 vezes") quebra EM SILÊNCIO, e o
// editor não tem como perceber.
//
// Era 2.000, e a fila real do owner mostrou o buraco: 856 rejeições numa semana
// (~120/dia, ~100 delas entrando no anel) davam **19 dias** de memória contra os
// 30 prometidos. 4.000 deu ~38; hoje são 6.000, ~60.
//
// Performance NÃO é o limite aqui, e a tabela do mapa (mais acima, no
// CLAUDE.md) não vale pra este anel: ela mede `nome → [contagem, datas]`, que é
// muito mais pesado por entrada. MEDIDO no ciclo completo de uma rejeição
// (ler + procurar + gravar), num Chromium com a CPU 6× lenta:
//   anel 2.000 → 4,04 ms · 4.000 → 4,32 ms · 8.000 → 4,72 ms
// 6.000 não foi medido: cai ENTRE os dois últimos, abaixo de 4,72 ms. Um quadro
// a 60fps são 8,3 ms, então a faixa inteira é ruído. Tamanho no aparelho: 39,6
// KB a 2.000 e 63,0 KB a 4.000 — o de 6.000 também não foi medido.
//
// A folga extra compra o editor que rejeita MUITO mais que ~130 por dia, que
// era exatamente o caso que tornava 4.000 errado: com 6.000 a conta só volta a
// apertar acima de ~200/dia. O conserto definitivo continua sendo guardar o DIA
// junto do id e podar por idade, como o mapa faz — aí o teto deixa de ser
// palpite sobre o ritmo de quem usa. Fica como decisão separada: muda o formato
// gravado e exige migração.
const AUTORES_MAX_VISTOS = 6000;
// ANISTIA, e não só arrumação — a razão é do owner: "30 dias é para tirar a
// pessoa do castigo caso o editor esqueça de desmarcar do automático e/ou o
// editor use muito pouco o app". Ou seja, o prazo protege o AUTOR de um
// esquecimento nosso, não o arquivo do tamanho. Quem continua mandando tem a
// data renovada a cada rejeição (inclusive as automáticas), então o prazo só
// corre pra quem de fato parou.
const AUTORES_MAX_DIAS = 30;
// Quantas linhas a lista mostra antes do "Ver mais N". NÃO é gosto: medido na
// fila real do owner, 232 pedidos deram 174 autores distintos e 23 com 2+
// rejeições — e os 10 primeiros são os que repetem de verdade (o resto tem
// contagem 2–3). Cortar em 5 esconderia 8 de 13 num caso comum, o que faz do
// botão parada obrigatória em vez de atalho; cortar em 15 quase não cortaria.
//
// O ganho é a altura ficar CONSTANTE: medido a 390×844, a lista inteira custa
// 2,4 telas com 23 autores, 7,1 com 100 e 34,9 com 500 (59px por linha, sempre);
// com o teto são 1,2 tela em qualquer tamanho. Render nunca foi o problema
// (22ms com 500) — o custo é o polegar.
const AUTORES_VISIVEIS = 10;
// Acima disto o selo passa de cinza (a app CONTA) a rosa (a app DESTACA).
//
// Era 10, e a justificativa escrita aqui dizia que "o maior lote de um mesmo
// autor num único instantâneo foi 7", logo 10 exigiria repetição ENTRE buscas.
// REMEDIDO em 2026-09-01 nos 6 países obrigatórios, 1.967 autores: essa frase
// não vale mais. O maior lote num instantâneo é 30 (Espanha), com 25 em
// Portugal, 24 na França e 17 no Brasil — o 10 já era ultrapassado por uma
// única busca, então ele não garantia mais o que prometia.
//
// Baixar pra 6 é decisão do owner. O efeito medido: num instantâneo dos 6
// países, o rosa passaria de 6 para 17 autores — de 1.967, ou seja menos de 1%
// nos dois casos. Não é a diferença entre "discreto" e "gritante".
//
// Se um dia alguém quiser um limiar que signifique de novo "voltou em outro
// dia", o caminho não é o número: é comparar a DATA da primeira rejeição com a
// da última, que o registro já guarda.
const AUTOR_LIMIAR_DESTAQUE = 6;

const diaDeHoje = () => Math.floor(Date.now() / 86400000);

function loadAutores() {
    if (AppState.autores) return AppState.autores;
    let a = null;
    try { a = JSON.parse(localStorage.getItem(AUTORES_KEY) || 'null'); } catch (e) { a = null; }
    if (!a || typeof a !== 'object') a = {};
    if (!Array.isArray(a.v)) a.v = [];
    if (!a.r || typeof a.r !== 'object') a.r = {};
    AppState.autores = a;
    if (podarAutores(a)) salvarAutores(a);
    return a;
}

function salvarAutores(a) {
    try { localStorage.setItem(AUTORES_KEY, JSON.stringify(a)); } catch (e) {}
}

// Poda por TEMPO e por TETO, nessa ordem: o tempo tira o que não informa mais,
// o teto garante que o custo pare de crescer mesmo se o tempo não bastar.
function podarAutores(a) {
    let mudou = false;
    const limite = diaDeHoje() - AUTORES_MAX_DIAS;
    for (const id of Object.keys(a.r)) {
        const e = a.r[id];
        if (!Array.isArray(e) || !Number.isFinite(e[2]) || e[2] < limite) { delete a.r[id]; mudou = true; }
    }
    const ids = Object.keys(a.r);
    if (ids.length > AUTORES_MAX_REINCIDENTES) {
        // Sai quem tem a rejeição mais ANTIGA — não quem tem a menor contagem:
        // contagem alta e parada há um mês informa menos que contagem 2 de hoje.
        ids.sort((x, y) => (a.r[x][2] || 0) - (a.r[y][2] || 0));
        for (const id of ids.slice(0, ids.length - AUTORES_MAX_REINCIDENTES)) delete a.r[id];
        mudou = true;
    }
    if (a.v.length > AUTORES_MAX_VISTOS) { a.v = a.v.slice(-AUTORES_MAX_VISTOS); mudou = true; }
    return mudou;
}

// Chaveado pelo ID, nunca pelo nome. 69% dos autores da fila real são anônimos
// `world_xxxxx` — nome GERADO pra quem nunca escolheu um, e que muda no dia em
// que a pessoa escolhe. Pelo nome, o histórico sumiria justamente aí.
function registrarRejeicaoDeAutor(place) {
    const id = place && place.creatorId;
    if (id === null || id === undefined || id === '') return;
    const chave = String(id);
    const a = loadAutores();
    const nome = (place.createdBy && String(place.createdBy)) || chave;
    const hoje = diaDeHoje();
    if (a.r[chave]) {
        const e = a.r[chave];
        e[0] = (e[0] || 1) + 1;
        e[1] = nome;   // o nome de EXIBIÇÃO acompanha: se a pessoa escolheu um, mostra o novo
        e[2] = hoje;
    } else {
        const i = a.v.indexOf(chave);
        if (i === -1) {
            a.v.push(chave);
            if (a.v.length > AUTORES_MAX_VISTOS) a.v.shift();
        } else {
            a.v.splice(i, 1);
            a.r[chave] = [2, nome, hoje];
            podarAutores(a);
        }
    }
    salvarAutores(a);
}

// Quantas rejeições SUAS este autor acumulou. 0 ou 1 devolve 0: o anel não
// guarda contagem, e "1" não é reincidência — é uma rejeição.
function contagemDoAutor(place) {
    const id = place && place.creatorId;
    if (id === null || id === undefined || id === '') return 0;
    const e = loadAutores().r[String(id)];
    return Array.isArray(e) ? (e[0] || 0) : 0;
}

function esquecerAutor(chave) {
    const a = loadAutores();
    if (!a.r[chave]) return;
    delete a.r[chave];
    salvarAutores(a);
    renderHistory();
}

// Ordena por contagem, depois pelo mais recente — quem mais repetiu primeiro.
function listaDeAutores() {
    const a = loadAutores();
    return Object.entries(a.r)
        .map(([id, e]) => ({ id, n: e[0] || 0, nome: e[1] || id, dia: e[2] || 0 }))
        .sort((x, y) => (y.n - x.n) || (y.dia - x.dia));
}

function esquecerAutores() {
    AppState.autores = null;
    safeLS.remove(AUTORES_KEY);
}

// O registro guarda o DIA, não o instante — então a frase é em dias. Usar o
// `formatRelativeTime` do app (que desce a horas e minutos) fazia algo de hoje
// de manhã aparecer como "há 12h": precisão que o dado não tem.
//
// É o MESMO dia que a poda usa (`e[2]`), então esta linha é o relógio da
// anistia à vista: 30 dias depois do que ela mostra, o autor sai da lista.
function rejeitadoQuando(dia) {
    const n = diaDeHoje() - dia;
    if (!Number.isFinite(n) || n <= 0) return t('stats.autores.rejeitadoHoje');
    return t(n === 1 ? 'stats.autores.rejeitadoDias' : 'stats.autores.rejeitadoDiasPlural', { n });
}

// Expandido é estado de SESSÃO da lista, não preferência: o padrão é a lista
// curta, e reabrir o painel volta a ele (limpo em LIMPEZA_AO_FECHAR). Precisa
// sobreviver ao re-render, porém — o painel é redesenhado inteiro a cada
// esquecimento e a cada troca de interruptor, e perder a expansão ali jogaria
// o editor de volta pro topo no meio de uma faxina.
let autoresExpandido = false;

// A lista fica ABAIXO do placar do editor, nunca no lugar dele. E some inteira
// quando ninguém repetiu — seção vazia num painel curto é ruído, não informação.
function renderAutores() {
    const el = document.getElementById('autoresBody');
    if (!el) return;
    const todas = listaDeAutores();
    if (todas.length === 0) { el.innerHTML = ''; return; }
    // Só corta se SOBRA alguém: com 10 autores exatos nada é escondido e o botão
    // não existe. Botão dizendo "ver mais 0" — ou sumindo sem explicação — é pior
    // que não ter teto nenhum.
    const escondidas = autoresExpandido ? 0 : Math.max(0, todas.length - AUTORES_VISIVEIS);
    const linhas = escondidas > 0 ? todas.slice(0, AUTORES_VISIVEIS) : todas;
    const lixo = ICONE_LIXO;
    el.innerHTML =
        `<p class="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">${escapeHtml(t('stats.autores.title'))}</p>`
        + `<p class="text-xs text-slate-500 dark:text-slate-400 mb-2 leading-snug">`
        + `${escapeHtml(t('stats.autores.desc', { dias: AUTORES_MAX_DIAS }))}`
        + (podeRecusarAutomaticoAqui() ? ' ' + escapeHtml(t('stats.autores.autoDesc')) : '')
        + `</p>`
        + linhas.map((a) =>
            // `flex-wrap` + `basis-full` na data: ela vai pra uma SEGUNDA linha,
            // com a largura inteira da lista. Dentro da coluna do nome ela não
            // cabia — o selo, o interruptor e a lixeira apertam essa coluna a
            // ~55px num Fold, e "rejeté il y a 22 jours" quebrava em TRÊS
            // pedaços. Medido: a largura do nome é a MESMA nos dois arranjos,
            // então isto não tira nada dele.
            `<div class="autor-lin flex flex-wrap items-center gap-x-2 min-h-[44px] border-b border-slate-100 dark:border-slate-700 last:border-0">`
            + `<span class="flex-1 min-w-0 text-sm font-medium text-slate-700 truncate dark:text-slate-200">${escapeHtml(a.nome)}</span>`
            + `<span class="selo-proc ${a.n >= AUTOR_LIMIAR_DESTAQUE ? 'selo-reinc' : 'selo-src'} flex-shrink-0">`
            + `✕ ${a.n}</span>`
            // O interruptor da recusa automática só EXISTE pra quem passa no
            // portão: mostrá-lo desabilitado anunciaria um recurso que a pessoa
            // não pode usar, e a app não faz isso em nenhum outro lugar.
            + (podeRecusarAutomaticoAqui()
                // O <label> de 44px é o ALVO; o interruptor em si tem 26px de
                // altura (componente padrão da app). Nas Preferências o alvo vem
                // da linha inteira ser um label — aqui não dá, porque a linha
                // também tem a lixeira, e um toque perto dela alternaria o
                // automático sem querer.
                ? `<label class="flex items-center min-h-[44px] flex-shrink-0 cursor-pointer">`
                  + `<input type="checkbox" class="ui-switch autor-auto"`
                  + ` data-autor="${escapeHtml(a.id)}"${autoLigado(a.id) ? ' checked' : ''}`
                  + ` title="${escapeHtml(t('stats.autores.auto'))}"`
                  + ` aria-label="${escapeHtml(t('stats.autores.auto'))}"></label>`
                : '')
            + `<button type="button" class="autor-esquecer min-w-[44px] min-h-[44px] flex items-center justify-center`
            + ` text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded-full flex-shrink-0"`
            + ` data-autor="${escapeHtml(a.id)}" title="${escapeHtml(t('stats.autores.esquecer'))}"`
            + ` aria-label="${escapeHtml(t('stats.autores.esquecer'))}">${lixo}</button>`
            // `-mt-1.5` recolhe a folga que o min-h-[44px] da linha de cima já
            // deixou: sem isso a data flutua longe do nome que ela descreve.
            + `<span class="basis-full text-[0.6875rem] text-slate-500 dark:text-slate-400 leading-tight -mt-1.5 pb-1.5">`
            + `${escapeHtml(rejeitadoQuando(a.dia))}</span>`
            + `</div>`).join('')
        // Largura cheia e 44px de alvo, como todo botão da app. O número vai NO
        // rótulo porque "Ver mais" sozinho não diz se são 3 ou 300 — e é isso que
        // decide se vale o toque. O "Ver menos" existe porque sem ele expandir é
        // irreversível sem fechar o modal.
        + (escondidas > 0 || autoresExpandido
            ? `<button type="button" id="autoresVerMais" class="w-full min-h-[44px] mt-2 mb-4`
              + ` border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-semibold`
              + ` text-cyan-700 dark:text-cyan-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition">`
              + `${escapeHtml(autoresExpandido
                    ? t('stats.autores.verMenos')
                    : t(escondidas === 1 ? 'stats.autores.verMais' : 'stats.autores.verMaisPlural',
                        { n: escondidas }))}</button>`
            : '');
    const verMais = document.getElementById('autoresVerMais');
    if (verMais) verMais.addEventListener('click', () => {
        autoresExpandido = !autoresExpandido;
        renderAutores();
        // Ao recolher, o botão sobe junto com a lista e o dedo fica sobre outra
        // coisa. Devolver a lista ao campo de visão é o mínimo pra não parecer
        // que a app pulou pra outro lugar.
        if (!autoresExpandido) el.scrollIntoView({ block: 'nearest' });
    });
    // Delegação seria mais curta, mas o painel é re-renderizado inteiro a cada
    // esquecimento — o listener por linha morre junto com a linha.
    for (const b of el.querySelectorAll('.autor-esquecer')) {
        b.addEventListener('click', () => esquecerAutor(b.dataset.autor));
    }
    for (const c of el.querySelectorAll('.autor-auto')) {
        c.addEventListener('change', () => alternarAutoDoAutor(c.dataset.autor));
    }
}

function renderHistory() {
    const el = document.getElementById('historyBody');
    if (!el) return;
    const s = getHistoryStats();
    renderAutores();
    const vazio = s.total.read + s.total.rejected === 0;
    const rows = [['today', s.today], ['week', s.week], ['month', s.month], ['total', s.total]];
    // A patente e a vitrine aparecem mesmo com histórico VAZIO — e é de propósito.
    // Medido no mockup: como as trancadas mostram nome e ícone, "0 de 16" lê como
    // "eis o que dá pra ganhar", não como parede de cadeados. É a tela que um
    // editor novo vê no primeiro minuto, e ela não pode ser um vazio.
    el.innerHTML = htmlPatente() + (vazio
        ? `<p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t('stats.history.empty'))}</p>`
        : rows.map(([k, v]) =>
            `<div class="flex justify-between items-baseline text-sm py-0.5">` +
            `<span class="text-slate-600 dark:text-slate-300">${escapeHtml(t('stats.history.' + k))}</span>` +
            `<span class="tnum font-medium"><span class="text-emerald-700 dark:text-emerald-400">${v.read}</span>` +
            ` · <span class="text-rose-600 dark:text-rose-400">${v.rejected}</span></span></div>`
        ).join(''));
    // O Resumo do mês só se oferece quando há mês: botão pra um mês vazio é
    // convite pra uma imagem em branco.
    const agora = new Date();
    const mes = dadosDoResumo(loadHistory(), agora.getFullYear(), agora.getMonth());
    if (mes.total > 0) {
        const mesNome = new Date(mes.ano, mes.mesIdx, 1).toLocaleDateString(i18nLocale(), { month: 'long' });
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'resumoBotao';
        btn.className = 'mt-3 w-full min-h-[44px] rounded-xl bg-cyan-700 hover:bg-cyan-800 dark:bg-cyan-400 dark:hover:bg-cyan-300 text-white dark:text-slate-900 font-semibold text-sm px-4 transition';
        btn.textContent = t('resumo.botao', { mes: mesNome });
        btn.addEventListener('click', abrirResumoDoMes);
        el.appendChild(btn);
    }
    el.insertAdjacentHTML('beforeend', htmlConquistas());
    if (!el.dataset.conqLigado) { ligarConquistas(el); el.dataset.conqLigado = '1'; }
}

// Na PRIMEIRA vez que cada ação é confirmada pelo Waze, diz o que ela fez lá —
// não o que ela quis dizer aqui. A app explicava a INTENÇÃO ("o pedido não deve
// entrar no mapa") e nunca a CONSEQUÊNCIA, e as duas divergem no caso que mais
// importa: marcar como lido NÃO aprova nada, mas o ✓ verde diz o contrário pra
// quem chegou agora.
//
// Dispara na CONFIRMAÇÃO, não no gesto: durante a janela de Desfazer nada foi
// enviado ainda, e "rejeição enviada" ali seria mentira — além de disputar a
// tela com o banner do Desfazer.
function avisarConsequencia(actionType) {
    if (!CONSEQUENCIA_AVISADA[actionType]) return;
    const vistas = AppState.preferences.consequenciaVista || {};
    if (vistas[actionType]) return;
    vistas[actionType] = true;
    AppState.preferences.consequenciaVista = vistas;
    savePreferences();
    showToast(t('consequencia.' + actionType), 'hint', 7000);
}
// Só as que ESCREVEM no Waze. Pular é local — o pedido volta na próxima busca,
// e isso o treino e o "Como funciona" já dizem.
const CONSEQUENCIA_AVISADA = { reject: true, read: true };

// ── FILA DE SAÍDA: o que você fez não se perde quando a rede some ─────────
//
// O defeito que isto conserta existe HOJE, pra todo editor, e não precisa de
// viagem nenhuma: basta o sinal oscilar. Medido no código de antes, o caminho
// era — placar sobe e é GRAVADO, card sai da tela, 3s de janela, envia, falha,
// duas retentativas (1,5s e 3,5s), e aí o último ramo do `handleActionResult`
// **reverte o placar e descarta a ação**. O pedido continua no Waze e o editor
// vê o número voltar atrás uns 5 segundos depois de já ter seguido em frente.
//
// A app não tinha NENHUMA noção de estar offline — nem uma chave no dicionário.
//
// Só `transient` entra aqui, e a distinção não é detalhe:
//   · `already_processed`/`not_found` → já é sucesso (outro editor chegou antes)
//   · `unauthorized` ................. → a sessão morreu; enfileirar adiaria o
//                                        relogin sem resolver nada
//   · `unknown` ...................... → segue revertendo. Enfileirar o que não
//                                        se entende é retentar pra sempre.
const SAIDA_KEY = 'waze_places_saida';
// Teto POR CONSTRUÇÃO (regra da casa pra estrutura que cresce por item). A fila
// real do Brasil tem 442 pedidos e o Waze guarda ~3 dias, então 1000 é o dobro
// do que existe pra fazer. Estourar NÃO descarta em silêncio: volta ao
// comportamento antigo (reverte e avisa), porque perda calada é o que este
// trecho existe pra acabar.
const SAIDA_MAX = 1000;
// Pausa entre os envios ao esvaziar. NÃO é número escolhido a dedo: o piso
// MEDIDO da app sem Desfazer é 377 ms por pedido (40 pedidos reais, esperando o
// card trocar de verdade). Esvaziar mais rápido que isso seria a app fazendo o
// que nenhum humano faz — e rajada é o padrão que faz um WAF marcar cliente.
const SAIDA_RITMO_MS = 400;

// Trava: `online` e a abertura podem coincidir. O gatilho que bate nela é
// DESCARTADO, e isso é deliberado — eu cheguei a escrever uma recoleta
// ("rodar de novo no fim") e ela NÃO SOBREVIVEU à sabotagem: tirando-a, os dois
// cenários que montei continuaram drenando. O motivo é que a janela em que ela
// importaria é desprezível: se o esvaziamento está dando certo, ele drena de
// qualquer jeito; se está falhando por rede, a rede voltando faz a PRÓPRIA
// retentativa em voo (1,5s e 3,5s) ter sucesso e o laço segue. Só o instante
// entre a última tentativa falhar e o laço sair ficaria descoberto — e aí a
// abertura da app, que é o outro gatilho, resolve. Guard que não distingue as
// duas versões é decoração (a régua do #67), então a recoleta saiu em vez de
// ser remendada até passar.
let esvaziandoSaida = false;
// O gatilho que chegou COM o esvaziamento no ar. Sem ele a guarda de reentrada
// vira uma PERDA: o `online` do navegador não é promessa de rede boa (o próprio
// `callWithRetry` só confia no `false`), então a rede que volta em dois tempos —
// túnel, elevador, 4G firmando — manda um `online` com a rede ainda ruim e outro
// logo depois já firme. O primeiro entra, quebra no `transient` e SAI; o segundo
// cai na guarda e some. Aí a fila fica presa com a rede ótima, e o próximo
// gatilho é só na abertura seguinte da app — podem ser horas.
// MEDIDO: com o abort atrasado em 900ms pra alargar a janela, a fila ficava em 2
// com `esvaziando:false` e `onLine:true` por toda a medição. É também o que o
// runner do CI produz sozinho, por lentidão — aqui a janela é de ~30ms.
let saidaPedidaDeNovo = false;

function carregarFilaDeSaida() {
    try {
        const v = JSON.parse(safeLS.get(SAIDA_KEY) || '[]');
        return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
}

function salvarFilaDeSaida(f) {
    try { safeLS.set(SAIDA_KEY, JSON.stringify(f)); } catch (e) {}
}

// Guarda o MÍNIMO que permite reenviar E prestar contas direito no pouso:
// `creatorId` alimenta a reincidência e a conquista do elefante, `dup` a do
// detetive. Sem eles a ação sairia, mas o trabalho feito offline não contaria
// pras conquistas — divergência silenciosa entre o placar e o Histórico.
//
// O `nome` vai junto porque a reincidência CHAVEIA por id mas EXIBE por nome, e
// o `registrarRejeicaoDeAutor` reescreve o nome a cada rejeição: sem ele, um
// autor que já tinha nome na lista voltaria a aparecer como NÚMERO depois de
// uma rejeição feita offline.
function enfileirarSaida(tipo, place) {
    if (!place || place.venueID === undefined || place.updateRequestID === undefined) return false;
    const f = carregarFilaDeSaida();
    // O MESMO pedido duas vezes na fila é a mesma decisão mandada duas vezes —
    // e, se o tipo mudou, duas decisões diferentes executadas no Waze (ler não
    // resolve o pedido, então um "rejeitar" depois dele vale). Com o filtro de
    // entrada (`semOsJaDecididos`) um pedido que está aqui não volta a ser card,
    // então isto não deveria acontecer: se acontecer, é um caminho novo que
    // escapou do filtro, e o diário diz. Vale a PRIMEIRA decisão, e quem chama
    // desfaz a contagem do gesto repetido.
    const chave = chaveDoPedido(place);
    if (chave && f.some((it) => chaveDoPedido(it) === chave)) {
        dfato('saida.repetida', { tipo });
        return 'repetida';
    }
    if (f.length >= SAIDA_MAX) return false;
    f.push({ tipo, venueID: place.venueID, updateRequestID: place.updateRequestID,
             creatorId: place.creatorId != null ? place.creatorId : null,
             nome: place.createdBy ? String(place.createdBy) : null,
             dup: !!place.duplicado,
             // `t` não é lido em runtime por ninguém: existe pro DIAGNÓSTICO,
             // que despeja o localStorage inteiro — é o que responde "há quanto
             // tempo isto está preso aqui" sem custar uma linha de diário.
             t: Date.now(),
             // Carimbados AQUI, no gesto: é o dia e a região em que o trabalho
             // foi feito. Lidos no pouso, seriam os do momento em que a rede
             // voltou — que pode ser outro dia e outro filtro.
             dia: historyTodayKey(), onde: ondeAgora() });
    salvarFilaDeSaida(f);
    updateInFlightIndicator();
    // Só a ABERTURA da fila entra no diário, nunca cada item: `dfato` é anel de
    // 120 e a regra da casa é "nada por swipe" — 200 pedidos numa sombra de
    // conectividade despejariam todo o resto do diário, que é justamente o que
    // se quer ler junto. O evento é ficar sem rede; quantos couberam sai no
    // `saida.saiu`, e a fila inteira já está no localStorage do diagnóstico.
    if (f.length === 1) dfato('saida.abriu', { tipo });
    return true;
}

// Esvazia COM RITMO, um por vez. O pouso NÃO passa pelo `handleActionResult`
// (ele somaria o placar de novo, e o número já subiu no gesto): passa pelo
// `registrarPousoDeSaida`, que é o mesmo conjunto de regras sem essa parte.
// A ÚNICA exceção é `unauthorized`, que precisa do `handleUnauthorized` de lá.
async function esvaziarFilaDeSaida() {
    // Já tem um esvaziamento no ar: ANOTA o pedido em vez de descartá-lo. Duas
    // chamadas simultâneas não podem drenar a mesma fila (é o que a trava
    // impede), mas o gatilho não pode evaporar — ver `saidaPedidaDeNovo`.
    if (esvaziandoSaida) { saidaPedidaDeNovo = true; return; }
    if (!AppState.authenticated) return;
    if (navigator.onLine === false) return;
    let f = carregarFilaDeSaida();
    if (!f.length) return;
    esvaziandoSaida = true;
    // Zera ao ENTRAR, não ao sair: o que interessa é o gatilho que chegar DAQUI
    // pra frente. Zerar no fim apagaria justamente o pedido que esta passada
    // ainda não pôde atender.
    saidaPedidaDeNovo = false;
    let enviados = 0;
    try {
        while (f.length) {
            // Sair no meio do esvaziamento: PARA. Sem isto o item já em voo
            // pousaria depois do logout e o `recordHistory` recriaria o
            // histórico que o "Sair" acabou de apagar.
            if (!AppState.authenticated) break;
            const item = f[0];
            const place = { venueID: item.venueID, updateRequestID: item.updateRequestID,
                            creatorId: item.creatorId, createdBy: item.nome || undefined,
                            duplicado: item.dup ? {} : undefined };
            const r = item.tipo === 'read'
                ? await API.markAsRead(item.venueID, item.updateRequestID)
                : await API.rejectPlace(item.venueID, item.updateRequestID);
            // Rede fora de novo: PARA e deixa o resto pra próxima. Insistir aqui
            // seria gastar requisição do free tier pra falhar em série.
            if (r && r.errorCategory === 'transient') break;
            // Sessão morta: para e mantém a fila. Quem decide o relogin é o
            // `handleActionResult`, e o que foi feito não pode evaporar por isso.
            if (r && r.errorCategory === 'unauthorized') { handleActionResult(item.tipo, place, r); break; }
            // O placar JÁ foi contado quando a pessoa deslizou — este ramo não
            // pode somar de novo. Por isso o resultado entra por um caminho que
            // só registra histórico/conquistas e trata o "já tratado".
            // O pouso mexe em histórico, reincidência, conquistas e DOM. Uma
            // exceção ali NÃO pode levar o resto da fila junto: antes ela caía
            // no catch do laço e o esvaziamento morria no meio, deixando o
            // resto encalhado em silêncio (só um `dfato`). O item já saiu do
            // Waze — o que falhou foi a CONTABILIDADE dele, e contabilidade de
            // um item não é motivo pra não mandar os outros sete.
            try { registrarPousoDeSaida(item.tipo, place, r, item); }
            catch (e) { dfato('saida.pouso.erro', { tipo: item.tipo }); }
            // RELÊ antes de gravar, e o motivo é PERDA DE DADO na feature que
            // existe pra não perder dado: `f` foi lido antes do `await`, e nesse
            // meio-tempo o editor pode ter deslizado um pedido que também falhou
            // por rede — `enfileirarSaida` gravou `[A,B,C]` e um `salvarFilaDeSaida(f)`
            // com o `f` velho gravaria `[B]` por cima, sumindo com o C em silêncio.
            // O item que acabou de sair é sempre o `[0]` (quem entra é empurrado
            // pro fim), então reler e tirar o primeiro preserva o que chegou.
            f = carregarFilaDeSaida();
            f.shift();
            salvarFilaDeSaida(f);
            updateInFlightIndicator();
            enviados++;
            if (f.length) await new Promise((ok) => setTimeout(ok, SAIDA_RITMO_MS));
        }
    } catch (e) {
        dfato('saida.erro', { restam: f.length });
    } finally {
        esvaziandoSaida = false;
    }
    if (enviados) {
        dfato('saida.saiu', { enviados, restam: f.length });
        // Plural por chave, que é o que o projeto tem (sem ICU): `{n} enviados`
        // com n=1 daria "1 enviados" em pt/es/fr, e UM é o caso mais comum —
        // uma ação só falhando numa oscilação de sinal.
        showToast(t(enviados === 1 ? 'toast.saidaEnviada' : 'toast.saidaEnviadaPlural',
                    { n: enviados }), 'success');
    }
    // O gatilho que chegou no meio é atendido AGORA. Não vira laço: a passada
    // seguinte só existe se alguém pedir de novo DURANTE ela, e quem pede é o
    // evento `online` do navegador ou a abertura da app — nenhum dos dois é
    // nosso, nenhum é polling. As guardas do topo (deslogado, `onLine === false`,
    // fila vazia) seguem valendo e param na primeira linha.
    if (saidaPedidaDeNovo) {
        saidaPedidaDeNovo = false;
        return esvaziarFilaDeSaida();
    }
}

// O pouso de um item da fila de saída. É o `handleActionResult` SEM a parte do
// placar: o número já subiu quando a pessoa deslizou, e somar de novo aqui
// contaria o mesmo trabalho duas vezes.
function registrarPousoDeSaida(actionType, place, result, item) {
    if (!result) return;
    item = item || {};
    const cat = result.errorCategory || (result.success ? null : 'unknown');
    if (result.success || cat === 'already_processed' || cat === 'not_found') {
        registrarPouso(place);
        recordHistory(actionType, 1, item.dia, item.onde);
        if (actionType === 'reject' && result.success) registrarRejeicaoDeAutor(place);
        registrarAcaoConfirmada(actionType, place);
        return;
    }
    // Não deu, e não é rede nem sessão: a ação falhou DE VERDADE, então o número
    // que subiu no gesto tem que descer agora. Isto não é simetria estética — o
    // placar é PERSISTIDO (`waze_places_stats`), então deixar só o `serverTotal`
    // voltar deixaria "Rejeitados" inflado para sempre por algo que nunca saiu.
    const statKey = actionType === 'read' ? 'read' : 'rejected';
    AppState.stats[statKey] = Math.max(0, AppState.stats[statKey] - 1);
    AppState.serverTotal++;
    updateStats();
    saveStats();
    const verb = actionType === 'read' ? t('action.verb.read') : t('action.verb.reject');
    showToast(msgDoServidor(result, t('toast.actionError', { verb })), 'error');
}

// ── PEDIDO JÁ DECIDIDO NÃO VOLTA COMO CARD ────────────────────────────────
//
// Relato de 2026-09-22, no modo avião: o owner tratou pedidos, eles foram pra
// fila de saída, a app foi fechada e reaberta — e os MESMOS pedidos voltaram
// como card, com a fila de saída ainda segurando as decisões deles. Dava pra
// decidir de novo: o segundo gesto contava outra vez no placar e mandava uma
// SEGUNDA decisão pro Waze, que pode ser outra ("lido" na primeira, "rejeitado"
// na segunda — e as duas são executadas, porque ler não resolve o pedido).
//
// A causa: a fila guardada do offline só é regravada COM rede (na busca e no
// começo da varredura), e a reabertura sem rede a restaurava INTEIRA. Nada
// perguntava o que este aparelho tinha decidido depois de ela ser tirada.
//
// O mesmo buraco existia com rede, só que estreito: a busca da abertura corre
// junto com o esvaziamento da fila de saída, e o Waze só esquece um pedido
// quando a decisão CHEGA. O que ainda estava na fila de saída — ou pousou
// depois de o Waze montar a lista — voltava como card.
//
// A regra é UMA pros dois caminhos (`semOsJaDecididos`): um pedido só entra na
// fila se este aparelho não o decidiu DEPOIS de a lista ter sido tirada.
// "Decidiu" é: está na fila de saída, está na janela do Desfazer ou em voo, ou
// POUSOU no Waze depois do instante em que a lista foi tirada (`desde`). O que
// pousou ANTES a própria lista já reflete, e aí quem manda é o Waze — um pedido
// LIDO volta com o filtro "só não lidos" desligado, e isso é o de sempre.

// A chave de um pedido é o par que a fila de saída guarda e que o Waze usa pra
// decidir. `String` nos dois lados: o JSON da fila de saída e o da busca não
// prometem o mesmo tipo pro mesmo id, e `12 !== '12'` faria o filtro passar
// calado — que é o defeito inteiro de volta, sem erro nenhum.
function chaveDoPedido(p) {
    if (!p || p.venueID == null || p.updateRequestID == null) return null;
    return String(p.venueID) + '|' + String(p.updateRequestID);
}

// Janela do Desfazer e envio em andamento. Só em memória: morre com a página,
// e o que sobrevive a ela (fila de saída e pousos gravados) mora no aparelho.
// Entra no GESTO, porque é ali que o card sai da fila: uma busca que chegue
// durante a janela traria o pedido de volta, e o Desfazer o devolveria DE NOVO
// — o mesmo pedido duas vezes na fila.
const pedidosEmAndamento = new Set();
// Chave → quando a decisão pousou no Waze, NESTA página. É o que cobre a
// corrida da busca com o esvaziamento. Todo mundo tem, com ou sem offline, e
// não custa armazenamento: morre com a página.
const pousosDaPagina = new Map();
// Mais velho que isto, qualquer busca nova já o reflete — a poda só impede que
// o mapa cresça numa sessão longa.
const POUSO_NA_MEMORIA_MS = 10 * 60 * 1000;

function marcarEmAndamento(places, sim) {
    for (const p of (Array.isArray(places) ? places : [places])) {
        const k = chaveDoPedido(p);
        if (!k) continue;
        if (sim) pedidosEmAndamento.add(k);
        else pedidosEmAndamento.delete(k);
    }
}

function offlineLerPousos() {
    try {
        const v = JSON.parse(safeLS.get(OFFLINE_POUSOS_KEY) || '[]');
        return Array.isArray(v) ? v.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(e[1])) : [];
    } catch (e) { return []; }
}

// FONTE ÚNICA do "a decisão chegou no Waze". Todo pouso passa por aqui — o do
// card, o da fila de saída, o do lote e o da aprovação de foto —, e um caminho
// que não passar deixa o pedido voltar como card depois de reabrir sem rede,
// sem erro nenhum na tela. Aceita um pedido ou uma lista (o lote grava UMA vez).
//
// A cópia GRAVADA só existe com o offline ligado: é ela que a reabertura sem
// rede consulta, e quem não ligou o offline não reabre sem rede. "Quem não
// marca não paga nada."
function registrarPouso(places) {
    const agora = Date.now();
    const chaves = [];
    for (const p of (Array.isArray(places) ? places : [places])) {
        const k = chaveDoPedido(p);
        if (k) { chaves.push(k); pousosDaPagina.set(k, agora); }
    }
    if (!chaves.length) return;
    if (pousosDaPagina.size > 500) {
        for (const [k, t] of pousosDaPagina) if (agora - t > POUSO_NA_MEMORIA_MS) pousosDaPagina.delete(k);
    }
    if (!offlineLigado()) return;
    const lista = offlineLerPousos();
    for (const k of chaves) lista.push([k, agora]);
    while (lista.length > OFFLINE_POUSOS_MAX) lista.shift();
    try { safeLS.set(OFFLINE_POUSOS_KEY, JSON.stringify(lista)); } catch (e) {}
}

// A fila guardada foi regravada: o que pousou ANTES de ela ser tirada já está
// refletido nela e sai da lista. Chamada só DEPOIS de a gravação fechar — se
// ela falhar, a lista tem que continuar valendo contra a foto velha.
function offlinePodarPousos(desde) {
    const lista = offlineLerPousos();
    const ficam = lista.filter((e) => e[1] >= desde);
    if (ficam.length === lista.length) return;
    try {
        if (ficam.length) safeLS.set(OFFLINE_POUSOS_KEY, JSON.stringify(ficam));
        else safeLS.remove(OFFLINE_POUSOS_KEY);
    } catch (e) {}
}

// O filtro, usado pelos DOIS caminhos por onde pedido entra na fila: a busca
// (`fetchNextPage`) e a reabertura sem rede (`offlineTentarAbrirSemRede`).
// `desde` é o instante em que a LISTA foi tirada — o começo da busca, ou o
// `desde` gravado junto da fila guardada. Devolve os que ficam e QUANTOS saíram,
// porque o número vai pro diário: é a prova de que o filtro agiu.
function semOsJaDecididos(places, desde) {
    const lista = Array.isArray(places) ? places : [];
    const naSaida = new Set();
    for (const it of carregarFilaDeSaida()) {
        const k = chaveDoPedido(it);
        if (k) naSaida.add(k);
    }
    const pousoEm = new Map(pousosDaPagina);
    if (offlineLigado()) {
        for (const [k, t] of offlineLerPousos()) if (!(pousoEm.get(k) >= t)) pousoEm.set(k, t);
    }
    const limite = Number.isFinite(desde) ? desde : 0;
    const ficam = [];
    let excluidos = 0;
    for (const p of lista) {
        const k = chaveDoPedido(p);
        const pousou = k ? pousoEm.get(k) : undefined;
        if (k && (naSaida.has(k) || pedidosEmAndamento.has(k) || (pousou !== undefined && pousou >= limite))) {
            excluidos++;
            continue;
        }
        ficam.push(p);
    }
    return { places: ficam, excluidos };
}

// Os DOIS gatilhos, e nenhum deles é polling (o free tier proíbe): o navegador
// avisando que voltou, e a abertura da app. Quem ficou offline e fechou tudo
// encontra a fila esperando na próxima vez que abrir.
window.addEventListener('online', async () => {
    // EM ORDEM, nunca em paralelo — e a ordem é "trabalho do editor primeiro".
    //
    // O motivo é o free tier: a rede acabou de voltar, muitas vezes em dados
    // móveis, e disparar duas correntes de requisição no mesmo instante é
    // competir justamente no pior momento. Esperar não trava nada — o
    // esvaziamento tem fim garantido (para no primeiro `transient`).
    //
    // Além disso o `resetQueue()` roda SÍNCRONO e mexe em `pendingAction`, na
    // fila e no `serverTotal`; rodá-lo no meio de um `await` do esvaziamento é
    // corrida por construção, mesmo que nenhuma medição a tenha pego.
    //
    // NÃO foi isto que reprovou o bloco da fila de saída no CI — eu afirmei que
    // era e estava errado. A causa, reproduzida depois e determinística, era o
    // gatilho ENGOLIDO pela guarda de reentrada (ver `saidaPedidaDeNovo`).
    await esvaziarFilaDeSaida();
    // A rede voltou: é a janela pra repor o que venceu na sombra. Sai calado
    // com o toggle desligado, e só baixa o que de fato faltava.
    offlineTalvezVarrer();
    // E refaz a BUSCA se ela tinha falhado. Sem isto o editor ficava olhando
    // "Falha ao carregar" com 4g funcionando até tocar no botão — a fila de
    // saída se resolvia sozinha e a de PEDIDOS não, o que é incoerente. O
    // `loadError` é o portão: sem ele isto viraria uma requisição a cada
    // oscilação de rede, e o free tier é restrição de projeto.
    // `resetQueue()` ANTES, e não é zelo: a falha deixou `hasMore = false`, e o
    // `fetchNextPage` sai na PRIMEIRA linha com isso (`if (!AppState.hasMore)
    // return`). MEDIDO — sem o reset a app trocava "Falha ao carregar" por
    // **"Tudo limpo!"** com a fila vazia, que é pior que o erro original. É
    // também o mesmo par que o botão "Tentar novamente" já usa: o caminho
    // automático e o manual têm que fazer a mesma coisa.
    if (AppState.authenticated && AppState.loadError && !AppState.fetching) {
        resetQueue();
        startFetching();
    }
});

// O TERCEIRO gatilho, e o único que não depende do navegador avisar nada: uma
// resposta NOSSA que chegou prova que a rede existe.
//
// RELATADO pelo owner, no iPhone: modo avião, trata 3, sai do modo avião — e o
// "3 esperando envio" fica parado. Ele então trata mais 2, que saem NA HORA, e
// os 3 continuam lá. A app tinha a prova de rede na mão (duas requisições
// bem-sucedidas) e não a usava.
//
// REPRODUZIDO com sonda, e a causa não é o evento faltar: ele CHEGA quando o
// rádio liga, e nesse instante a rede ainda não passa tráfego. O esvaziamento
// entra, quebra no `transient` e sai — e nenhum gatilho novo vem depois, porque
// os dois que existiam eram o `online` (já gasto) e a ABERTURA da app (e ela
// nunca foi fechada). Consertar isso pelo evento é impossível: `onLine === true`
// não prova rede, e o projeto não confia nele em lugar nenhum.
//
// Não é polling e não custa requisição (o free tier é restrição de projeto):
// isto só REAGE ao que já saiu. Com a fila vazia sai na segunda linha do
// `esvaziarFilaDeSaida`.
//
// SAI CEDO durante o esvaziamento, e não é zelo: cada item que ele manda com
// sucesso passaria por aqui e marcaria `saidaPedidaDeNovo`, fazendo a passada
// re-executar no fim. Isso contraria o "para no primeiro `transient`" — o laço
// que quebrou por rede ruim tentaria de novo NA HORA, gastando requisição
// justamente quando ela falha. Quem está no ar já vai processar a fila inteira,
// então não há nada a anotar.
API.aoProvarRede = () => {
    // SAI CEDO durante o esvaziamento, e agora por DOIS motivos. O primeiro já
    // estava escrito abaixo (retentar na hora contraria a política de rede). O
    // segundo é novo: varrer o offline no meio do esvaziamento é competir por
    // banda exatamente no pior momento — a rede acabou de voltar, muitas vezes
    // em dados móveis. O guard de `test/fila-saida.test.mjs` cobra isto, e
    // estava certo quando eu tentei tirar.
    if (esvaziandoSaida) return;
    esvaziarFilaDeSaida();
    // Resposta que CHEGA prova rede, e as duas pontas do offline pegam carona
    // nela: o que estava preso pra SAIR e o que falta ENTRAR.
    offlineTalvezVarrer();
};

// ═══════════════════════════════════════════════════════════════════════════
// DISPONÍVEL OFFLINE — o TRABALHO sobrevive à sombra de sinal
// ═══════════════════════════════════════════════════════════════════════════
//
// O Degrau 1 (fila de saída) fez a AÇÃO sobreviver: você desliza sem rede e o
// envio sai sozinho depois. Isto faz o TRABALHO sobreviver: os pedidos, o mapa
// e as fotos ficam no aparelho, e a app se vira sozinha no vai-e-volta de sinal
// de uma estrada.
//
// OPT-IN ESTRITO, e isso é o contrato: quem não marcou não paga NADA. Nem um
// byte, nem uma requisição, nem sequer uma URL diferente (ver `urlDaFoto`).
//
// ── OS TRÊS ITENS TÊM PRAZOS DIFERENTES, e isso decide o desenho ───────────
//   texto   →  IndexedDB nosso        →  permanente
//   mapa    →  Cache API nosso        →  permanente (o tile TEM CORS: guardável)
//   foto    →  cache do navegador     →  60 min, e NÃO dá pra guardar
//
// A foto não é guardável porque `venue-image.waze.com` não manda CORS (medido:
// `access-control-allow-origin` ausente em toda variante e toda origem). Sem
// CORS a resposta é OPACA, e o Chrome cobra ~7,8 MB de orçamento por resposta
// opaca — medido com controle: os mesmos bytes custam 1,01× com CORS e 132×
// sem. As 226 fotos de uma fila custariam 1,76 GB contra ~1 GB de orçamento.
//
// ── O RELÓGIO ROLANTE ─────────────────────────────────────────────────────
// A foto vale 60 min A PARTIR DO DOWNLOAD, e a app não estica isso: reaquecer
// uma foto viva sai do cache, custa zero e NÃO renova o prazo (medido). O que
// renova é baixar de novo — e pra forçar isso a app troca o SUFIXO da URL
// (`?w=<janela>`), que o CDN do Waze aceita devolvendo bytes idênticos (medido
// em 5 variantes) e que o navegador trata como entrada separada, com relógio
// próprio (medido, com controle: a URL velha morre no prazo dela).
//
// Ciclo de 20 min = toda foto tem SEMPRE ao menos 40 min de vida quando o sinal
// cai. Custa uma varredura completa a cada 20 min: ~41 MB/h no Brasil. A conta
// só corre com a app ABERTA e COM SINAL — na sombra não há o que gastar.
const OFFLINE_CICLO_MS = 20 * 60 * 1000;
const OFFLINE_DB = 'waze_places_offline';
const OFFLINE_STORE = 'fila';
// O cache dos tiles é SEPARADO do da versão de propósito: o `activate` do
// service worker apaga todo cache que não seja o `CACHE_NAME`, então guardar
// tile lá dentro faria cada deploy apagar o que você provisionou — e você
// descobriria no meio da estrada. O SW isenta este nome explicitamente.
const OFFLINE_TILES_CACHE = 'waze-places-tiles';
// Os pedidos que POUSARAM no Waze depois de a fila guardada ser tirada (ver
// `registrarPouso`). É o que falta pra reabertura sem rede não devolver como
// card o que o editor já tratou COM rede. localStorage e não a base: a
// gravação é pequena e tem que valer mesmo se a app morrer logo depois do
// pouso — transação de IndexedDB pode não fechar a tempo.
const OFFLINE_POUSOS_KEY = 'waze_places_offline_pousos';
// Teto POR CONSTRUÇÃO. A lista é podada toda vez que a fila guardada é
// regravada (a cada busca e a cada varredura, no máximo 20 min de uso), então
// na prática ela guarda uns minutos de trabalho — o teto é só pra que um
// defeito na poda não a faça crescer sem fim.
const OFFLINE_POUSOS_MAX = 1000;
// Quantas imagens em voo ao mesmo tempo. Baixo de propósito: a varredura não
// pode atropelar a foto do card que o editor está olhando AGORA — é o defeito
// que o `agendarAquecimento` já existe pra evitar.
const OFFLINE_CONCORRENCIA = 3;
// Sem gesto na tela por este tempo, a varredura dorme. Sem isto a app cobraria
// dados de quem a deixou aberta no bolso.
const OFFLINE_OCIOSO_MS = 3 * 60 * 1000;

let offlineVarrendo = false;
let offlinePedidaDeNovo = false;
let offlineUltimoGesto = Date.now();
// A janela que a app SERVE — e ela NÃO é a hora atual. Só avança quando uma
// varredura termina de aquecer tudo sob o sufixo novo. Sem isso, virar a janela
// OFFLINE faria o card pedir uma URL que ninguém aqueceu e a foto sumiria com
// a cópia boa parada no cache, a um sufixo de distância.
let offlineJanelaServida = null;
// Quando a varredura avisou o service worker pela última vez (`offlineAnunciarTiles`).
// O aviso é assíncrono: tile guardado há menos de um instante pode ainda não
// estar na lista do worker — `registrarFalhaDeTile` respeita essa janela.
let offlineUltimoAnuncio = 0;

// ── Pedaço de mapa GUARDADO que falhou na tela ────────────────────────────
// A app tira da tela o tile que falha (ícone quebrado no meio do mapa não
// informa nada) — e com ele sumia também a PROVA: nas 6 capturas do relato de
// 2026-09-22 não há tile quebrado nenhum, e nem poderia haver. Agora o mapa
// conta quantos pediu e quantos falharam (`data-tiles-*`, lidos pela geometria
// do diagnóstico) antes de apagar, e o tile que falhou ESTANDO GUARDADO entra
// no anel abaixo, que a sentinela `tileGuardadoFalhou` lê.
//
// "Guardado que falhou" só é anomalia com as três condições — é isso que faz
// dele INVARIANTE e não palpite:
//   · há service worker no comando (sem ele o cache não serve ninguém);
//   · nenhuma varredura em andamento e o último aviso ao worker tem mais de 2s
//     — tile guardado DURANTE a varredura só é servido depois do aviso, e o
//     aviso é assíncrono;
//   · o tile ESTÁ no cache de tiles na hora da falha. `caches.match` com
//     `cacheName` não CRIA o cache (o `caches.open` criaria), então quem nunca
//     ligou o offline não ganha um cache vazio por um tile falhar na rede.
const DIAG_TILES_FALHOS_TETO = 20;
let diagTilesGuardadosQueFalharam = [];
function registrarFalhaDeTile(box, url) {
    try {
        if (box && box.dataset) {
            box.dataset.tilesFalharam = String((parseInt(box.dataset.tilesFalharam, 10) || 0) + 1);
        }
        if (!url || !window.caches) return;
        if (!(navigator.serviceWorker && navigator.serviceWorker.controller)) return;
        if (offlineVarrendo || Date.now() - offlineUltimoAnuncio < 2000) return;
        caches.match(url, { cacheName: OFFLINE_TILES_CACHE }).then((hit) => {
            if (!hit) return;
            diagTilesGuardadosQueFalharam.push({ t: Date.now(), url: String(url).slice(0, 200) });
            if (diagTilesGuardadosQueFalharam.length > DIAG_TILES_FALHOS_TETO) diagTilesGuardadosQueFalharam.shift();
            dfato('mapa.guardadoFalhou');
        }).catch(() => {});
    } catch (e) { /* o diagnóstico nunca derruba o mapa */ }
}

// Como a ÚLTIMA varredura terminou: 'pronto' | 'parcial' | null (nunca correu).
// Sem isto a linha congelava em "Preparando… 197 de 530" PARA SEMPRE quando a
// varredura desistia — o relato do owner. A varredura tinha ACABADO; quem
// mentia era a tela, porque o único redesenho acontecia com `offlineVarrendo`
// ainda true e nada redesenhava depois que ele virava false.
let offlineUltimoResultado = null;
// ÉPOCA do offline, no mesmo espírito do `fetchEpoch` da fila. `offlineEsquecer`
// a incrementa, e a varredura desiste se ela mudou DURANTE um `await`.
//
// Sem isto existe uma corrida REAL e com consequência de privacidade: o
// worker checa a preferência no topo do laço, mas o download já a caminho
// pousa DEPOIS do apagamento e faz `cache.put` num cache que acabou de ser
// deletado — recriando-o. O editor pediu pra esquecer e dado de mapa de
// terceiro volta a ser gravado. MEDIDO: `offlineEsquecer()` deixava 1 entrada
// no cache e a janela servida com valor.
//
// É a mesma regra que a fila de saída já tinha escrita: "sair no meio também
// PARA o laço".
let offlineEpoca = 0;

function offlineLigado() {
    return AppState.preferences.offlineDisponivel === true;
}

// FONTE ÚNICA da URL da foto. Card, lightbox e aquecimento passam TODOS por
// aqui — se um deles usar a URL crua, ele pede um endereço que ninguém aqueceu
// e a foto some offline, sem erro nenhum na tela. `test/offline.test.mjs`
// reprova quem atribuir `.src` a partir de `imageUrls` sem passar por aqui.
function urlDaFoto(u) {
    if (!u || !offlineLigado() || offlineJanelaServida === null) return u;
    return u + (u.indexOf('?') === -1 ? '?' : '&') + 'w=' + offlineJanelaServida;
}

// ── IndexedDB, o mínimo ───────────────────────────────────────────────────
// `localStorage` está fora: é SÍNCRONO e travaria a thread do swipe, que é o
// valor central da app (medido no projeto: 16,5 ms por gravação com 10 mil
// registros). Aqui são 357 KB de uma vez.
function offlineDB() {
    return new Promise((ok, erro) => {
        let req;
        try { req = indexedDB.open(OFFLINE_DB, 1); } catch (e) { return erro(e); }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(OFFLINE_STORE)) db.createObjectStore(OFFLINE_STORE);
        };
        req.onsuccess = () => ok(req.result);
        req.onerror = () => erro(req.error);
    });
}

// `desde` é o instante a partir do qual a lista gravada vale: o começo da busca
// que a trouxe, ou AGORA quando quem grava é a varredura (aí a lista é a fila
// viva, que já não tem nada do que foi decidido nesta página). Vai gravado junto
// porque é contra ele que a reabertura sem rede filtra os pousos.
async function offlineGravarFila(desde) {
    if (!offlineLigado() || !AppState.queue.length) return false;
    const valeDesde = Number.isFinite(desde) ? desde : Date.now();
    try {
        const db = await offlineDB();
        await new Promise((ok, erro) => {
            const tx = db.transaction(OFFLINE_STORE, 'readwrite');
            tx.objectStore(OFFLINE_STORE).put({
                t: Date.now(),
                desde: valeDesde,
                filtros: JSON.parse(JSON.stringify(AppState.filters || {})),
                places: AppState.queue,
            }, 'fila');
            tx.oncomplete = ok; tx.onerror = () => erro(tx.error);
        });
        db.close();
        // Só DEPOIS de a gravação fechar: se ela falhar, os pousos continuam
        // valendo contra a fila velha, que é a que a reabertura vai ler.
        offlinePodarPousos(valeDesde);
        dfato('offline.gravou', { n: AppState.queue.length });
        return true;
    } catch (e) { return false; }
}

// A JANELA SERVIDA também fica guardada, na mesma base e com a mesma vida (o
// `offlineEsquecer` apaga as duas). É ela que monta a URL que a varredura
// aqueceu (`urlDaFoto`), e ela morava só em memória: a app REABERTA sem rede
// nascia com a janela nula, pedia a foto CRUA — que ninguém aqueceu — e TODO
// card de foto abria com "a foto precisa de sinal". É o caso do Android, que
// encerra o app em segundo plano e o faz renascer justamente na sombra.
// Gravada só quando a varredura TERMINA, igual à janela em memória: sufixo de
// varredura pela metade é foto que não está no cache.
async function offlineGravarJanela(janela) {
    try {
        const db = await offlineDB();
        await new Promise((ok, erro) => {
            const tx = db.transaction(OFFLINE_STORE, 'readwrite');
            tx.objectStore(OFFLINE_STORE).put({ janela, t: Date.now() }, 'janela');
            tx.oncomplete = ok; tx.onerror = () => erro(tx.error);
        });
        db.close();
    } catch (e) {}
}

async function offlineLerJanela() {
    try {
        const db = await offlineDB();
        const v = await new Promise((ok, erro) => {
            const tx = db.transaction(OFFLINE_STORE, 'readonly');
            const r = tx.objectStore(OFFLINE_STORE).get('janela');
            r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
        });
        db.close();
        return v && Number.isFinite(v.janela) ? v.janela : null;
    } catch (e) { return null; }
}

async function offlineLerFila() {
    try {
        const db = await offlineDB();
        const v = await new Promise((ok, erro) => {
            const tx = db.transaction(OFFLINE_STORE, 'readonly');
            const r = tx.objectStore(OFFLINE_STORE).get('fila');
            r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
        });
        db.close();
        return v && Array.isArray(v.places) && v.places.length ? v : null;
    } catch (e) { return null; }
}

async function offlineEsquecer() {
    offlineEpoca++;                 // invalida qualquer varredura em voo
    offlineJanelaServida = null;
    offlineUltimoResultado = null;
    // As URLs de tile dizem ONDE ficam pedidos de terceiros: vão junto com o
    // resto do que o offline guardou.
    diagTilesGuardadosQueFalharam = [];
    // Os pousos só existem pra filtrar a fila guardada, que sai na linha de
    // baixo: sem ela não há o que filtrar, e são ids de pedidos de terceiros.
    safeLS.remove(OFFLINE_POUSOS_KEY);
    try { indexedDB.deleteDatabase(OFFLINE_DB); } catch (e) {}
    try { if (window.caches) await caches.delete(OFFLINE_TILES_CACHE); } catch (e) {}
    // E o worker esquece a LISTA dele, que é o mesmo dado em memória: sem o
    // aviso, ela seguiria com centenas de endereços até ele adormecer — e o
    // relatório o mostraria "conhecendo" tiles que já não existem. Relida com
    // o cache apagado, ela sai vazia.
    offlineAnunciarTiles();
}

// ── A VARREDURA ───────────────────────────────────────────────────────────
// Ordem de FILA (o card 1 primeiro), e o que FALHA volta pro fim. A retomada
// não é zelo: MEDIDO numa estrada simulada de 20s de sinal / 40s de buraco, com
// retomada saem 160 cards prontos e ZERO perdidos; sem ela, 77 cards e 404
// pedaços perdidos PARA SEMPRE. É metade do recurso numa linha.
// A caixa do mapa NÃO é a mesma em todo card. Ela é o que sobra depois do
// texto, e encolhe quando o card tem comentário de reporte ou diff: MEDIDO no
// aparelho do owner, 378×337 num card de foto e 378×189 no reporte com
// comentário. Caixa diferente pode escolher OUTRO ZOOM — logo outros tiles. A
// varredura usava a caixa do card que estivesse na frente pra TODOS, e na fila
// real dele isso deixava 7 de 172 cards com buraco no mapa numa caixa de 189px
// e 12 numa de 144 (e 37 numa de 88, o piso). Por isso os tiles saem da FAIXA
// de alturas que um card pode ter, não de uma altura só.
//
// O PISO é o menor `min-height` do `.card-photo` no styles.css (o card com
// comentário, 5.5rem), convertido pela fonte da raiz na hora — rem acompanha a
// fonte do sistema. `test/offline.test.mjs` cobra que o CSS não desça abaixo.
//
// O TETO é a pilha, limitado a MAPA_TILE − 8: MEDIDO, até 504px o custo é o
// mesmo (313 tiles na fila do owner), e em 512 salta pra 470 — é onde a caixa
// deixa de caber numa fileira de tiles. Foto de card de celular nunca chega
// perto disso: o texto ocupa ~190px.
//
// O PASSO de 16px é exato: na fila real, toda altura inteira de 88 a 504 dá os
// MESMOS 313 tiles que passos de 4, 8, 16, 32 e até 64px. 16 fica com folga.
const OFFLINE_CAIXA_MIN_REM = 5.5;
const OFFLINE_CAIXA_PASSO_PX = 16;

function offlineFaixaDeCaixas() {
    const frente = cardDaFrente();
    const cx = frente && frente.querySelector('.card-photo');
    const w = (cx && cx.clientWidth) || 400;
    const hFrente = (cx && cx.clientHeight) || 240;
    const pilha = document.getElementById('cardStack');
    const hPilha = (pilha && pilha.clientHeight) || hFrente;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const hMin = Math.round(OFFLINE_CAIXA_MIN_REM * rem);
    const hMax = Math.max(hFrente, Math.min(hPilha, MAPA_TILE - 8));
    return { w, hMin: Math.min(hMin, hMax), hMax };
}

// Os tiles de TODAS as alturas da faixa. Mesmo zoom em caixa menor pede um
// subconjunto; o que a faixa acrescenta é o zoom que muda quando a caixa encolhe.
function tilesDaFaixa(place, faixa) {
    const s = new Set();
    for (let h = faixa.hMax; h >= faixa.hMin; h -= OFFLINE_CAIXA_PASSO_PX) {
        for (const u of tilesDoCard(place, faixa.w, h)) s.add(u);
    }
    for (const u of tilesDoCard(place, faixa.w, faixa.hMin)) s.add(u);
    return s;
}

async function offlineItensDaFila(janela) {
    const itens = [];
    const vistos = new Set();   // pedido vizinho divide tile: baixa uma vez só
    const faixa = offlineFaixaDeCaixas();
    // CÓPIA da fila: o laço cede a thread, e quem tria desliza no meio — o
    // `shift()` do avanço deslocaria o iterador e pularia um pedido calado.
    const fila = AppState.queue.slice();
    let i = 0;
    for (const p of fila) {
        for (const u of tilesDaFaixa(p, faixa)) {
            if (vistos.has(u)) continue;
            vistos.add(u);
            itens.push({ u, tile: true });
        }
        // A foto em que o card ABRE, pela mesma regra do carrossel: num pedido de
        // foto é a EM DECISÃO, que em 13 de 76 da fila do owner não é a primeira.
        const fotos = fotosDoCard(p);
        const f = fotos.urls[fotos.inicial];
        if (f) itens.push({ u: f + (f.indexOf('?') === -1 ? '?' : '&') + 'w=' + janela, tile: false });
        // ~16 ms num desktop pra fila inteira, e 4–6× isso num celular: sem
        // ceder a thread vira tarefa longa no meio do arraste de quem tria.
        if (++i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return itens;
}

function offlineBaixar(u, tile) {
    // Tile vai pro NOSSO cache (tem CORS, então a resposta é transparente e
    // custa 1,01× de orçamento). Foto vai pro cache do navegador via <img>, que
    // é o MESMO caminho que o card usa — `fetch` popula outra entrada, e a
    // <img> não a enxerga (medido: aquecido por fetch, o card quebra offline).
    if (!tile) {
        return new Promise((r) => {
            const i = new Image();
            i.fetchPriority = 'low'; i.decoding = 'async';
            i.onload = () => r(true); i.onerror = () => r(false);
            i.src = u;
        });
    }
    const epoca = offlineEpoca;
    return (async () => {
        try {
            const resp = await fetch(u, { mode: 'cors' });
            if (!resp.ok) return false;
            // Última trava antes de ESCREVER: se esqueceram durante o download,
            // gravar aqui recria o cache que o "Sair" acabou de apagar.
            if (epoca !== offlineEpoca) return false;
            const c = await caches.open(OFFLINE_TILES_CACHE);
            await c.put(u, resp);
            return true;
        } catch (e) { return false; }
    })();
}

// Avisa o service worker que há tile novo no cache. Ele só responde pelo que
// CONHECE (lista síncrona), e sem o aviso só saberia na próxima partida — a
// sombra de sinal chegaria antes. Sai a cada `OFFLINE_ANUNCIAR_A_CADA` tiles
// guardados e em todo fim de varredura; reler a lista custa um `keys()` de
// algumas centenas de entradas.
const OFFLINE_ANUNCIAR_A_CADA = 50;
function offlineAnunciarTiles() {
    offlineUltimoAnuncio = Date.now();
    try { navigator.serviceWorker?.controller?.postMessage({ type: 'TILES_GUARDADOS' }); } catch (e) {}
}

async function offlineVarrer() {
    if (!offlineLigado()) return;
    if (offlineVarrendo) { offlinePedidaDeNovo = true; return; }
    if (!AppState.authenticated || !AppState.queue.length) return;
    // `onLine === false` é confiável pra "não tem rede"; `true` não prova nada
    // (portal cativo diz true e mente). Só o false muda comportamento — a mesma
    // regra de uma mão só da fila de saída.
    if (navigator.onLine === false) return;
    if (Date.now() - offlineUltimoGesto > OFFLINE_OCIOSO_MS) return;

    offlineVarrendo = true;
    offlinePedidaDeNovo = false;
    const janela = Math.floor(Date.now() / OFFLINE_CICLO_MS);
    const epoca = offlineEpoca;
    let tilesNovos = 0;
    try {
        await offlineGravarFila();
        const pend = await offlineItensDaFila(janela);
        const total = pend.length;
        let falhas = 0;
        const trabalhar = async () => {
            while (pend.length) {
                if (epoca !== offlineEpoca) return;   // esqueceram no meio
                if (!offlineLigado() || navigator.onLine === false) return;
                const it = pend.shift();
                const ok = await offlineBaixar(it.u, it.tile);
                // DEPOIS do await também: é aqui que a corrida mora — o
                // download pousa e o `cache.put` recriaria o que foi apagado.
                if (epoca !== offlineEpoca) return;
                // O worker só serve o tile que ele CONHECE, e ele só fica
                // sabendo pelo aviso. Avisar só no fim deixava o que já foi
                // guardado invisível pra ele a varredura inteira — e numa rede
                // ruim, que é quando ela demora, é justamente quando o mapa
                // precisa do cache.
                if (ok && it.tile && ++tilesNovos % OFFLINE_ANUNCIAR_A_CADA === 0) offlineAnunciarTiles();
                if (!ok) {
                    // volta pro FIM: buraco de sinal não pode perder o item
                    falhas++;
                    if (falhas > total * 2) return;   // teto: rede morta, para
                    pend.push(it);
                    await new Promise((r) => setTimeout(r, 400));
                }
                atualizarLinhaDoOffline(total - pend.length, total);
            }
        };
        await Promise.all(Array.from({ length: OFFLINE_CONCORRENCIA }, trabalhar));
        // Só AGORA a janela vira: enquanto a varredura não terminou, o card
        // segue pedindo o sufixo anterior, cuja cópia está viva no cache.
        if (epoca !== offlineEpoca) return;   // esqueceram: não grava resultado
        if (!pend.length) {
            offlineJanelaServida = janela;
            // SEM `await` antes, e isso importa: o `open` sai neste mesmo tique,
            // logo depois da checagem de época acima — um "Sair" que venha em
            // seguida entra na fila do IndexedDB DEPOIS dele e apaga tudo.
            offlineGravarJanela(janela);
            offlineUltimoResultado = 'pronto';
            dfato('offline.pronto', { n: AppState.queue.length, itens: total });
        } else {
            offlineUltimoResultado = 'parcial';
            dfato('offline.parcial', { feitos: total - pend.length, total, falhas });
        }
    } catch (e) {
        offlineUltimoResultado = 'parcial';
        dfato('offline.erro', { e: String((e && e.message) || e).slice(0, 60) });
    } finally {
        // O aviso ao worker sai em TODO fim — pronto, parcial ou erro —, e não
        // só no "pronto", como era. A varredura interrompida (o sinal caindo no
        // meio da preparação, que é o caso comum de quem sai de casa) guardava
        // tiles que o worker não servia até a próxima partida dele: o mapa
        // estava no aparelho e sumia do card. Achado desenhando a sentinela
        // `tileGuardadoFalhou`, que acusaria exatamente isso. Não avisa se
        // esqueceram no meio: aí o cache foi apagado.
        if (epoca === offlineEpoca && tilesNovos) offlineAnunciarTiles();
        offlineVarrendo = false;
        // DEPOIS de baixar a bandeira, senão a linha fica no "Preparando…" de
        // uma varredura que já acabou.
        atualizarLinhaDoOffline(0, 0);
        if (offlinePedidaDeNovo) { offlinePedidaDeNovo = false; return offlineVarrer(); }
    }
}

// ── A LINHA DA PREFERÊNCIA ────────────────────────────────────────────────
// Cinco estados, e nenhum deles é uma barra de status ambiente: isto é
// RESPOSTA A UM GESTO que a pessoa acabou de fazer. Aviso permanente de
// "offline parcial" seria ansiedade sem ação — ninguém faz sinal aparecer.
function atualizarLinhaDoOffline(feitos, total) {
    const el = document.getElementById('prefOfflineDesc');
    if (!el) return;
    if (!offlineLigado()) { el.textContent = t('prefs.offline.desc'); return; }
    const semRede = navigator.onLine === false;
    if (semRede) {
        const n = AppState.queue.length;
        el.innerHTML = n
            ? `<span class="text-amber-800 dark:text-amber-300 font-semibold">${escapeHtml(
                t(n === 1 ? 'prefs.offline.esperaA' : 'prefs.offline.esperaAPlural', { n }))}</span> `
              + escapeHtml(t('prefs.offline.esperaB'))
            : `<span class="text-amber-800 dark:text-amber-300 font-semibold">${escapeHtml(
                t('prefs.offline.vazioA'))}</span> ` + escapeHtml(t('prefs.offline.vazioB'));
        return;
    }
    if (offlineVarrendo && total) {
        el.innerHTML = `<span class="text-cyan-800 dark:text-cyan-300">${escapeHtml(
            t('prefs.offline.enchendo', { feitos, total }))}</span>`;
        return;
    }
    if (offlineUltimoResultado === 'parcial') {
        // Nem "Pronto" (seria mentira) nem "Preparando…" (já acabou). O próximo
        // gatilho retoma sozinho — a janela servida não avançou.
        el.innerHTML = `<span class="text-amber-800 dark:text-amber-300 font-semibold">${escapeHtml(
            t('prefs.offline.parcialA'))}</span> ` + escapeHtml(t('prefs.offline.parcialB'));
        return;
    }
    const n = AppState.queue.length;
    el.innerHTML = `<span class="text-emerald-700 dark:text-emerald-400 font-semibold">${escapeHtml(
        t(n === 1 ? 'prefs.offline.prontoA' : 'prefs.offline.prontoAPlural', { n }))}</span> `
        + escapeHtml(t('prefs.offline.prontoB'));
}

// ── OS GATILHOS: quatro, e NENHUM deles é polling ─────────────────────────
// O free tier é restrição de projeto, então nada aqui "atualiza a cada N
// minutos" por conta própria. Todos pegam carona no que já ia acontecer:
//   1. a prova de rede (resposta que CHEGA — o mesmo gancho da fila de saída)
//   2. o evento `online` do navegador
//   3. a abertura da app
//   4. o card que troca (o gesto de quem está trabalhando)
// O relógio de 20 min NÃO é um timer: é a comparação de `offlineJanelaServida`
// com a janela atual, feita quando um dos quatro acima acontece de qualquer
// jeito. Sem rede, nenhum deles dispara nada.
function offlinePrecisaVarrer() {
    if (!offlineLigado()) return false;
    if (offlineJanelaServida === null) return true;          // nunca encheu
    return Math.floor(Date.now() / OFFLINE_CICLO_MS) !== offlineJanelaServida;
}

function offlineTalvezVarrer() {
    if (!offlinePrecisaVarrer()) return;
    offlineVarrer();
}

function offlineMarcarGesto() { offlineUltimoGesto = Date.now(); }

// Abre a app sem rede: em vez da tela de falha, a fila que ficou guardada.
// Todos os pedidos entram — inclusive os de FOTO, cuja foto a varredura
// guardou no cache do navegador. O que não abrir de lá trava ✕/✓ no próprio
// card (`marcarCardSemFoto`, pelo `onerror`), em vez de sair do baralho por
// suposição. (Este comentário dizia que os de foto "saíam do baralho"; o
// código nunca fez isso.)
async function offlineTentarAbrirSemRede() {
    if (!offlineLigado() || navigator.onLine !== false) return false;
    const guardada = await offlineLerFila();
    if (!guardada) return false;
    // A janela da última varredura COMPLETA, antes de qualquer card nascer: sem
    // ela o card pede a foto crua, que ninguém guardou. Só quando a memória não
    // tem uma — com a app viva, a de memória é a mais nova.
    const janelaGuardada = await offlineLerJanela();
    if (offlineJanelaServida === null) offlineJanelaServida = janelaGuardada;
    // A fila guardada é uma FOTO: não sabe do que foi decidido depois dela — na
    // sombra (está na fila de saída) nem com rede (pousou depois da foto). Sem
    // este filtro, tudo isso voltava como card (relato de 2026-09-22). Fila
    // guardada por versão anterior não tem `desde`: vale a hora em que foi
    // gravada, que é o mais perto que se sabe.
    // MIGRACAO: fila-guardada-desde
    const desde = Number.isFinite(guardada.desde) ? guardada.desde : guardada.t;
    const filtrada = semOsJaDecididos(guardada.places, desde);
    // Tudo decidido: não há o que mostrar, e a tela certa é a de sempre (a
    // falha de rede), não uma fila vazia que se passaria por "Tudo limpo!".
    if (!filtrada.places.length) {
        dfato('offline.abriu', { n: 0, excluidos: filtrada.excluidos,
                                 idade: Math.round((Date.now() - guardada.t) / 60000) });
        return false;
    }
    AppState.queue = filtrada.places;
    AppState.serverTotal = AppState.queue.length;
    AppState.hasMore = false;
    AppState.loadError = false;
    updatePendingCount();
    sortQueue();
    showCurrentPlace();
    dfato('offline.abriu', { n: AppState.queue.length, excluidos: filtrada.excluidos,
                             idade: Math.round((Date.now() - guardada.t) / 60000) });
    return true;
}

// O card de FOTO sem a foto: diz na PRÓPRIA CAIXA da imagem, e trava ✕ e ✓
// deixando o ↑ vivo. Botão morto com cara de vivo lê como app quebrada, e
// decidir foto sem ver a foto é decidir no escuro.
//
// Chamada SÓ pelo `onerror` da foto em decisão — ou seja, depois de a imagem
// falhar de verdade. "Sem rede" não é "sem foto": a varredura do offline
// guarda a foto no cache do navegador exatamente pra ela abrir sem sinal.
// `test/offline.test.mjs` reprova quem voltar a chamá-la no render.
function marcarCardSemFoto(card, place) {
    if (!card || !place) return false;
    const tipoDeFoto = place.purType === 'NEW_PHOTO' || place.purType === 'FLAGGED_PHOTO';
    if (!tipoDeFoto || navigator.onLine !== false) return false;
    const caixa = card.querySelector('.card-photo');
    if (!caixa || caixa.querySelector('.card-sem-foto')) return false;
    for (const f of Array.from(caixa.children)) f.classList.add('hidden');
    const av = document.createElement('div');
    av.className = 'card-sem-foto';
    av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">'
        + '<path d="M3 3l18 18M10.6 5.2A9 9 0 0 1 21 12M2 12a9 9 0 0 1 4-7.4M8.5 16.5a5 5 0 0 1 7 0"/>'
        + '<circle cx="12" cy="20" r="1"/></svg>'
        + `<strong>${escapeHtml(t('card.semFoto.titulo'))}</strong>`
        + `<span>${escapeHtml(t('card.semFoto.desc'))}</span>`;
    caixa.appendChild(av);
    for (const sel of ['.card-btn-reject', '.card-btn-read']) {
        const b = card.querySelector(sel);
        if (b) { b.disabled = true; b.classList.add('acoes-travadas'); }
    }
    return true;
}

function handleActionResult(actionType, place, result) {
    dlog('acao.fim', { tipo: actionType, ok: !!(result && result.success),
                       cat: (result && result.errorCategory) || null,
                       key: (result && result.errorKey) || null });
    if (!result) return;
    if (result.success) {
        registrarPouso(place);
        recordHistory(actionType, 1);
        // Só REJEIÇÃO conta reincidência. Marcar como lido não é juízo
        // sobre o pedido — é "eu vi" —, e contá-lo transformaria quem
        // manda muita coisa BOA em reincidente.
        if (actionType === 'reject') registrarRejeicaoDeAutor(place);
        avisarConsequencia(actionType);
        registrarAcaoConfirmada(actionType, place);
        return;
    }

    const cat = result.errorCategory || 'unknown';

    if (cat === 'already_processed' || cat === 'not_found') {
        registrarPouso(place);
        recordHistory(actionType, 1);
        // Conta como tratada pelos mesmos motivos que ela conta no placar: o
        // objetivo de quem agiu foi cumprido, tenha sido por você ou não.
        registrarAcaoConfirmada(actionType, place);
        showToast(t('toast.alreadyProcessed'), 'info');
        return;
    }

    if (cat === 'unauthorized') {
        handleUnauthorized();
        return;
    }

    // REDE, não recusa: a ação vai pra fila de saída em vez de sumir. O placar
    // NÃO reverte, porque o trabalho foi feito — só não saiu ainda.
    //
    // Sem toast por ação: 150 pedidos numa sombra de conectividade dariam 150
    // interrupções. Quem presta contas é o indicador ("N esperando envio"), que
    // some sozinho quando a fila esvazia.
    if (cat === 'transient') {
        const naFila = enfileirarSaida(actionType, place);
        // A decisão deste pedido JÁ estava esperando: a primeira vale, e este
        // gesto não pode contar de novo no placar. O `serverTotal` fica: o card
        // repetido também tinha sido contado nele, então o desconto do gesto
        // acertou a conta.
        if (naFila === 'repetida') {
            const k = actionType === 'read' ? 'read' : 'rejected';
            AppState.stats[k] = Math.max(0, AppState.stats[k] - 1);
            updateStats();
            saveStats();
            return;
        }
        if (naFila) return;
    }

    const statKey = actionType === 'read' ? 'read' : 'rejected';
    AppState.stats[statKey] = Math.max(0, AppState.stats[statKey] - 1);
    AppState.serverTotal++;
    updateStats();
    saveStats();
    const verb = actionType === 'read' ? t('action.verb.read') : t('action.verb.reject');
    showToast(msgDoServidor(result, t('toast.actionError', { verb })), 'error');
}


// ── Modo treino: errar sem consequência ───────────────────────────────────
// Duas das três ações ESCREVEM no Waze em nome da pessoa, e a rejeição não tem
// volta depois dos 3s. Numa app assim, poder errar de mentira vale mais que
// qualquer texto explicativo — e é a única forma de "pegar na mão" que não cobra
// nada de quem já sabe, porque só entra quem pede.
//
// O owner apontou o que decide o desenho: "os testadores atuais não enxergam
// problemas de UX/UI pois já estão acostumados, só os novos que ficam
// perguntando". Ajuda que interrompe todo mundo pra atender o novato cobra o
// preço da fila inteira — daí sob demanda, e não automático.
//
// A TRAVA É ESTRUTURAL, não uma promessa: o guard está no TOPO de
// handleReject/handleMarkAsRead/handleSkip, antes de mexer em stat, em fila ou
// em `scheduleAction`. Não existe caminho em que um card de treino chegue ao
// `API.rejectPlace`. O smoke mede isso pela REDE, não lendo o código.
// Fecha as camadas presas ao pedido atual. Usada nas duas pontas da troca de
// modo (entrar/sair do treino): o que está aberto pertence ao pedido do outro
// lado, e reaproveitar a camada exigiria manter cada controle dela coerente com
// o modo novo — uma regra por controle, todas dependentes de ordem.
function fecharCamadasDeFoto() {
    if (typeof Lightbox !== 'undefined' && Lightbox.isOpen()) Lightbox.close();
    if (typeof MapaLightbox !== 'undefined' && MapaLightbox.isOpen()) MapaLightbox.close();
}

const Treino = {
    ativo: false,
    _salvo: null,
    passo: 0,

    // O `updateRequestID` que substitui o real. As duas escritas do card
    // (`validar-place` e `marcar-lido`) precisam de venueID E updateRequestID,
    // então um pedido de treino não endereça pedido nenhum: se algum dia
    // vazasse, o Waze responderia 702 "not found on venue" — que a app já trata
    // como "já tratado por outro editor". É a segunda camada; a primeira é o
    // guard no topo dos handlers.
    //
    // O `venueID` fica REAL de propósito: é ele que o ↗ usa pra abrir o lugar
    // certo no WME, e um treino que leva a um editor vazio ensinaria errado.
    // Quem protege as escritas que usam só o venueID (foto) é o guard delas.
    UR_INERTE: 'treino-inerte',

    // Clona fundo: o objeto real continua intocado na fila salva, e nada do que
    // acontecer no treino pode alcançá-lo por referência.
    neutralizar(p) {
        const c = JSON.parse(JSON.stringify(p));
        c.updateRequestID = this.UR_INERTE;
        c._treino = true;
        return c;
    },

    // Quantos pedidos reais o treino usa. 30 é o tamanho de UMA PÁGINA do WME
    // (ele pagina a lista em blocos de 30), então é a unidade mental que o
    // editor já tem — pedido do owner.
    MAX_REAIS: 30,
    // Piso: abaixo disto o treino completa com sintéticos. Fila vazia não pode
    // deixar ninguém sem treino, e é justamente no primeiro minuto — logo depois
    // do "Como funciona" — que a fila tem menos chance de já ter carregado.
    MIN_CARDS: 3,

    // O que faz um card ENSINAR algo que o anterior não ensinou. `updateTypeKey`
    // é o rótulo do card (separa UPDATE com e sem diff), e ter foto muda a tela
    // inteira: é o carrossel, o lightbox, a lixeira e o aprovar.
    chaveDeVariedade(p) {
        return (p.updateTypeKey || '—') + '|' + ((p.imageUrls || []).length ? 'foto' : 'sem');
    },

    // Reais em ordem de VARIEDADE, não a ordem da fila — e a diferença é enorme,
    // não cosmética. MEDIDO na fila real do owner (170 pedidos, 10 tipos
    // distintos): os 3 PRIMEIROS da fila são todos do MESMO tipo, então o treino
    // que pegava `slice(0, 3)` mostrava UM tipo de pedido e chamava isso de
    // treino. Pegando 30 em ordem, ainda seriam 7 dos 10.
    //
    // Rodízio (um de cada tipo, depois o segundo de cada…) porque a pessoa PODE
    // sair no meio: assim quem parar no 5º card viu 5 tipos diferentes, e não 5
    // vezes o mesmo. Com 10 grupos, os 10 primeiros cobrem os 10 tipos.
    porVariedade(fila) {
        const grupos = new Map();
        for (const p of fila) {
            const k = this.chaveDeVariedade(p);
            if (!grupos.has(k)) grupos.set(k, []);
            grupos.get(k).push(p);
        }
        const baldes = [...grupos.values()];
        const out = [];
        for (let i = 0; baldes.some((b) => i < b.length); i++) {
            for (const b of baldes) if (i < b.length) out.push(b[i]);
        }
        return out;
    },

    // Reais quando existem, sintéticos só como piso. O exemplo inventado ensina
    // o gesto; o julgamento — foto borrada, nome ruim, endereço errado — só vem
    // no pedido de verdade, e é ele que o treino precisa treinar.
    cards() {
        const fila = (this._salvo && this._salvo.queue) ? this._salvo.queue : [];
        const reais = this.porVariedade(fila).slice(0, this.MAX_REAIS).map((p) => this.neutralizar(p));
        if (reais.length >= this.MIN_CARDS) return reais;
        return [...reais, ...this.sinteticos()].slice(0, this.MIN_CARDS);
    },

    // Exemplos sintéticos: sem foto de propósito (não dependem de rede, e
    // "pedido sem foto" é caso real — 20% da fila medida). Os três cobrem os
    // três desfechos que a pessoa vai encontrar de verdade.
    sinteticos() {
        const base = {
            updateRequestID: 'treino', reqSubType: '', isDelete: false,
            createdBy: t('treino.autor'), creatorRank: 0, source: null,
            flagType: null, flagSubjectType: null, flagEntityID: null, flagComment: '',
            brand: null, brandKnown: null, camposSemMudanca: 0, imageUrls: [],
            mapa: null, isStarred: false, lat: null, lon: null,
            dateAdded: Date.now() - 3600000,
        };
        return [
            { ...base, venueID: 'treino1', name: t('treino.c1.nome'),
              categories: ['RESTAURANT'], address: t('treino.c1.endereco'),
              updateType: 'Novo Local', updateTypeKey: 'VENUE', purType: 'NEW_PLACE',
              reqType: 'VENUE', changes: [] },
            { ...base, venueID: 'treino2', name: t('treino.c2.nome'),
              categories: ['PHARMACY'], address: t('treino.c2.endereco'),
              updateType: 'Atualização', updateTypeKey: 'UPDATE_DETAILS', purType: 'DETAILS_UPDATE',
              reqType: 'REQUEST',
              changes: [{ field: 'phone', label: 'phone', from: '(11) 3333-0000', to: '(11) 4444-1111' }] },
            { ...base, venueID: 'treino3', name: t('treino.c3.nome'),
              categories: ['GAS_STATION'], address: t('treino.c3.endereco'),
              updateType: 'Novo Local', updateTypeKey: 'VENUE', purType: 'NEW_PLACE',
              reqType: 'VENUE', changes: [] },
        ];
    },

    entrar() {
        if (this.ativo) return;
        // Uma janela de Desfazer pendente é de um pedido REAL: despacha antes de
        // trocar a fila debaixo dela, senão ela executaria sobre outro estado.
        if (AppState.pendingAction) { AppState.pendingAction.execute(); AppState.pendingAction = null; }
        removeUndoBanner();
        this._salvo = {
            queue: AppState.queue, currentPlace: AppState.currentPlace,
            stats: AppState.stats, serverTotal: AppState.serverTotal,
            hasMore: AppState.hasMore, fetching: AppState.fetching,
        };
        this.ativo = true;
        this.passo = 0;
        AppState.fetching = false;
        AppState.hasMore = false;
        AppState.stats = { read: 0, rejected: 0, skipped: 0 };
        AppState.queue = this.cards();
        // Do TAMANHO da fila de treino, nunca de um número cravado. Estava em 3
        // enquanto o treino montava 4 cards (1 sintético + 3 reais): o "Restam"
        // zerava com um card ainda na tela — o que a app MOSTRA divergindo do
        // que ela ACEITA, que é a regra de ouro de consistência do projeto.
        AppState.serverTotal = AppState.queue.length;
        AppState.currentPlace = AppState.queue[0];
        document.getElementById('treinoBanner')?.classList.replace('hidden', 'flex');
        document.getElementById('noMoreCards')?.classList.add('hidden');
        showLoading(false);
        updateStats(true);   // troca de contexto: pula, não conta
        updatePendingCount(true);
        showCurrentPlace();
        // Trocar de modo ZERA as camadas: o lightbox (e a renomeação dentro
        // dele) pertencem ao pedido do OUTRO lado, e mantê-los abertos deixaria
        // na tela o confirmar/cancelar de um nome que este modo não vai gravar.
        //
        // Fechar é melhor do que manter cada controle coerente com o modo novo:
        // uma linha em vez de uma regra por controle, e sem depender de ORDEM —
        // que é a forma exata dos dois defeitos que o owner relatou hoje.
        fecharCamadasDeFoto();
    },

    sair() {
        if (!this.ativo) return;
        this.ativo = false;
        const s = this._salvo || {};
        AppState.queue = s.queue || [];
        AppState.currentPlace = s.currentPlace || null;
        AppState.stats = s.stats || { read: 0, rejected: 0, skipped: 0 };
        AppState.serverTotal = s.serverTotal || 0;
        AppState.hasMore = !!s.hasMore;
        AppState.fetching = !!s.fetching;
        this._salvo = null;
        document.getElementById('treinoBanner')?.classList.replace('flex', 'hidden');
        removeCurrentCardEl();
        updateStats(true);
        updatePendingCount(true);
        if (AppState.queue.length) { AppState.currentPlace = AppState.queue[0]; showCurrentPlace(); }
        else if (AppState.hasMore) startFetching();
        else showNoPlaces();
    },

    // Chamado do TOPO dos handlers reais. Explica o que TERIA acontecido e
    // avança — sem stat, sem fila real, sem rede.
    // Um aviso por vez, e o modal final só entra depois que o último foi lido.
    // Sem isso os três se empilham e TAPAM o "Ir para a fila": medido, o botão
    // ficava inalcançável no Galaxy Fold, no iPhone SE e no celular deitado —
    // 3 de 4 aparelhos. É o gotcha #26 de novo (feedback transitório cobrindo o
    // alvo que ainda precisa ser tocado), agora numa tela de aprender a usar.
    limparAvisos() {
        // , não : o segundo é o POSICIONADOR fixo, e
        // limpá-lo apagaria o container. Errei nisso e o throw abortava a ação
        // inteira — o card nem avançava.
        const pilha = document.getElementById('toastContainer');
        if (pilha) [...pilha.children].forEach((n) => n.remove());
        // Simétrico ao entrar(): sair com uma foto de TREINO aberta deixaria o
        // lightbox do modo real em cima de um pedido inerte.
        fecharCamadasDeFoto();
    },

    agir(tipo) {
        if (!this.ativo) return;
        const ultimo = AppState.queue.length <= 1;
        this.limparAvisos();
        // No último, o efeito vai DENTRO do modal final: fora dele viraria um
        // aviso flutuante sobre a área do card já vazia (o swipe animou o card
        // pra fora), e esperar pra ler deixava 2,2s de tela em branco.
        if (!ultimo) showToast(t('treino.efeito.' + tipo), tipo === 'reject' ? 'error' : 'info', 5000);
        AppState.stats[tipo === 'reject' ? 'rejected' : tipo === 'read' ? 'read' : 'skipped']++;
        AppState.serverTotal = Math.max(0, AppState.serverTotal - (tipo === 'skip' ? 0 : 1));
        updateStats();
        AppState.queue.shift();
        AppState.currentPlace = AppState.queue[0] || null;
        this.passo++;
        updatePendingCount();
        // No ÚLTIMO, o card fica na tela enquanto o aviso é lido: tirá-lo deixava
        // 2,2s de área em branco antes do modal final, o que lê como app quebrada.
        // Quem limpa é o `sair()`.
        if (AppState.currentPlace) { removeCurrentCardEl(); showCurrentPlace(); return; }
        const efeito = document.getElementById('treinoFimEfeito');
        if (efeito) {
            efeito.textContent = t('treino.efeito.' + tipo);
            efeito.classList.remove('hidden');
        }
        openModal('treinoFimModal');
    },
};
window.Treino = Treino;

// ── Presença no WME, de carona nas ações (fase 2) ─────────────────────────
//
// Quem usa a app aparece no mapa do WME, no lugar do card que está olhando. A
// posição vai DENTRO da ação que a app já manda (rejeitar, marcar como lido) e
// o servidor a escreve no WME com a marca de quem está na app
// (`server/marca-app.mjs`). Zero requisição nova: a app roda no free tier do
// Cloudflare, e uma chamada por card seria a conveniência pagando com o recurso
// contado (decisão do owner, 2026-09-23).
//
// Decisões que não são gosto:
//   · só o envio AO VIVO leva posição. A fila de saída manda depois, quando a
//     posição já é velha; o lote e a recusa automática não são alguém olhando
//     um card. Por isso a posição é montada DENTRO do executor, na hora do
//     envio, e nunca guardada em item nenhum;
//   · FREIO de 30 s entre escritas. Quem olha pelo WME não percebe: o WME não
//     redesenha sozinho (MEDIDO, fase 1). E dobrar as chamadas ao Waze em nome
//     de cada editor, no ritmo do swipe, é a assinatura que faz um WAF marcar a
//     conta de quem está triando;
//   · a posição é a do card NA TELA quando a ação sai (o próximo, depois do
//     gesto): é onde a pessoa está olhando. Sem card na tela, a do pedido;
//   · a VISIBILIDADE liga sozinha e em silêncio (decisão do owner). O perfil diz
//     como ela está (`visivelNoWme`, de graça no `/Session`) e, se estiver
//     desligada, a próxima ação a liga de carona. Se ela aparece desligada
//     DEPOIS de a app já a ter visto ligada, foi a pessoa, fora da app (no WME
//     ou noutro aparelho): conta como desligar, a mesma regra do "Ver quem está
//     na fila" — só volta sozinha depois de 9 dias, em silêncio;
//   · nada disso pode derrubar a ação: qualquer erro aqui vira "sem posição".
const PRESENCA_WME_FREIO_MS = 30000;
const presencaWme = {
    ligarNaProxima: false,
    ultimaEm: 0,
    enviadas: 0,
    falhas: 0,
    ultimaFalha: null,
    marcaPerdida: false,
};

function presencaWmeDaAcao(placeDaAcao) {
    try {
        if (Treino.ativo) return null;
        const ligada = typeof presencaLigada === 'function'
            ? presencaLigada() : AppState.preferences.presenca !== false;
        if (!ligada || !AppState.authenticated) return null;
        if (navigator.onLine === false) return null;
        const id = AppState.profile && AppState.profile.id;
        if (id === null || id === undefined || !/^\d{1,19}$/.test(String(id))) return null;
        const place = AppState.currentPlace || placeDaAcao;
        // `mapa.centro` é [lat, lon] — o core inverte o GeoJSON. Ler ao contrário
        // põe a pessoa num lugar plausível e ERRADO, sem erro nenhum.
        const centro = place && place.mapa && place.mapa.centro;
        if (!Array.isArray(centro) || !Number.isFinite(centro[0]) || !Number.isFinite(centro[1])) return null;
        const agora = Date.now();
        if (agora - presencaWme.ultimaEm < PRESENCA_WME_FREIO_MS) return null;
        presencaWme.ultimaEm = agora;
        const presenca = { userId: String(id), lat: centro[0], lon: centro[1], pais: API.getCountry() };
        if (presencaWme.ligarNaProxima) presenca.visivel = true;
        return presenca;
    } catch (e) {
        return null;
    }
}

function presencaWmeAoResponder(presenca, result) {
    try {
        const r = presenca && result && result.presenca;
        if (!r) return;
        if (r.ok) {
            presencaWme.enviadas++;
            if (presenca.visivel === true) {
                presencaWme.ligarNaProxima = false;
                if (AppState.preferences.presencaWmeVisto !== true) {
                    AppState.preferences.presencaWmeVisto = true;
                    savePreferences();
                }
            }
            // O Waze devolve a posição gravada: se os dígitos voltarem diferentes,
            // a marca de quem está na app se perdeu (o dia em que ele arredondar).
            if (r.marca === false && !presencaWme.marcaPerdida) {
                presencaWme.marcaPerdida = true;
                dfato('presencaWme.marcaPerdida', {});
            }
        } else {
            presencaWme.falhas++;
            presencaWme.ultimaFalha = r.categoria || 'erro';
        }
    } catch (e) { /* diagnóstico nunca derruba a ação */ }
}

function presencaWmeAoCarregarPerfil(visivel) {
    if (typeof visivel !== 'boolean') return;   // servidor antigo: não decide nada
    const p = AppState.preferences;
    if (p.presenca === false) return;           // desligado: a app não mexe no WME
    if (visivel) {
        presencaWme.ligarNaProxima = false;
        if (p.presencaWmeVisto !== true) {
            p.presencaWmeVisto = true;
            savePreferences();
        }
        return;
    }
    if (p.presencaWmeVisto === true) {
        p.presenca = false;
        p.presencaOffEm = Date.now();
        delete p.presencaWmeVisto;
        savePreferences();
        presencaWme.ligarNaProxima = false;
        dfato('presencaWme.desligadaFora', {});
        const chk = document.getElementById('prefPresenca');
        if (chk) chk.checked = false;
        window.Presenca?.sincronizar?.();
        return;
    }
    presencaWme.ligarNaProxima = true;
}

// A pessoa desligou o "Ver quem está na fila": some do WME na hora. É a única
// requisição própria da fase 2, e só acontece no GESTO.
function presencaWmeDesligar() {
    presencaWme.ligarNaProxima = false;
    delete AppState.preferences.presencaWmeVisto;
    const id = AppState.profile && AppState.profile.id;
    if (id === null || id === undefined || !API.getSession()) return;
    API.presencaWaze({ userId: String(id), visivel: false }).catch(() => {});
}

// Religou à mão: a próxima ação liga a visibilidade de carona, sem esperar o
// freio (quem acabou de pedir pra aparecer não espera 30 s pra aparecer).
function presencaWmeReligar() {
    presencaWme.ligarNaProxima = true;
    presencaWme.ultimaEm = 0;
}

function presencaWmeZerar() {
    presencaWme.ligarNaProxima = false;
    presencaWme.ultimaEm = 0;
    presencaWme.enviadas = 0;
    presencaWme.falhas = 0;
    presencaWme.ultimaFalha = null;
    presencaWme.marcaPerdida = false;
}

function presencaWmeDiag() {
    const ligada = typeof presencaLigada === 'function' ? presencaLigada() : AppState.preferences.presenca !== false;
    return {
        ligada,
        visto: AppState.preferences.presencaWmeVisto === true,
        ligarNaProxima: presencaWme.ligarNaProxima,
        enviadas: presencaWme.enviadas,
        falhas: presencaWme.falhas,
        ultimaFalha: presencaWme.ultimaFalha,
        marcaPerdida: presencaWme.marcaPerdida,
        ultimaHaS: presencaWme.ultimaEm ? Math.round((Date.now() - presencaWme.ultimaEm) / 1000) : null,
    };
}

function handleMarkAsRead() {
    if (!AppState.currentPlace) return;
    if (acoesTravadas()) return;   // janela do Desfazer correndo
    // Treino ANTES de tudo: nem stat, nem fila, nem rede.
    if (Treino.ativo) return Treino.agir('read');
    const place = AppState.currentPlace;
    AppState.stats.read++;
    AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
    updateStats();
    saveStats();
    advanceQueue();
    scheduleAction('read', place, async () => {
        const presenca = presencaWmeDaAcao(place);
        const result = await callWithRetry(() => API.markAsRead(place.venueID, place.updateRequestID, presenca));
        presencaWmeAoResponder(presenca, result);
        handleActionResult('read', place, result);
    });
}

function handleReject() {
    if (!AppState.currentPlace) return;
    if (acoesTravadas()) return;   // janela do Desfazer correndo
    // Treino ANTES de tudo: nem stat, nem fila, nem rede.
    if (Treino.ativo) return Treino.agir('reject');
    const place = AppState.currentPlace;
    AppState.stats.rejected++;
    AppState.serverTotal = Math.max(0, AppState.serverTotal - 1);
    updateStats();
    saveStats();
    advanceQueue();
    scheduleAction('reject', place, async () => {
        const presenca = presencaWmeDaAcao(place);
        const result = await callWithRetry(() => API.rejectPlace(place.venueID, place.updateRequestID, presenca));
        presencaWmeAoResponder(presenca, result);
        handleActionResult('reject', place, result);
    });
}

function handleSkip() {
    if (!AppState.currentPlace) return;
    if (acoesTravadas()) return;   // janela do Desfazer correndo
    // Treino ANTES de tudo: nem stat, nem fila, nem rede.
    if (Treino.ativo) return Treino.agir('skip');
    const place = AppState.currentPlace;
    AppState.stats.skipped++;
    updateStats();
    saveStats();
    advanceQueue();
    // A decisão é do MOMENTO DO GESTO, não do despacho: o executor roda até
    // UNDO_WINDOW_MS depois, e nesse intervalo dá pra abrir Filtros e mexer no
    // interruptor. Quem pulou com a preferência ligada quis guardar aquele
    // pedido; mudar de ideia sobre o recurso não reescreve o que já foi feito.
    const guardar = AppState.preferences.pularGuarda === true;
    // Sem a preferência, o Pular continua sendo o que sempre foi: REDE ZERO.
    // O place segue pendente no Waze e o executor é no-op — o scheduleAction
    // está aqui só pela janela do Desfazer. Com a preferência, o mesmo executor
    // passa a guardar o pedido na estrela do editor, e o Desfazer segue valendo
    // de graça: desfazer é não rodar o executor.
    scheduleAction('skip', place, async () => {
        if (!guardar) return;
        if (!place || !place.venueID || !place.updateRequestID) return;
        const r = await callWithRetry(() => API.guardarPedido(place.venueID, place.updateRequestID, true));
        // Falhar aqui não corrompe contador nenhum — o Pular não mexe em
        // `serverTotal` e o `skipped` já subiu —, então não há o que reverter.
        // O que não pode é falhar CALADO: a app prometeu guardar.
        if (!r || r.success !== true) {
            showToast(msgDoServidor(r, t('toast.guardarFalhou')), 'error');
            return;
        }
        contarConquista('guardados');
    });
}

// ── Marcar em lote (o backend já aceita items[]; feature de UI) ────────────
// Marca como lido TODOS os places atualmente na fila local. Como o Waze devolve
// tudo de uma vez (hasMore geralmente false), a fila local ≈ tudo que resta.
function openBatchReadConfirm() {
    // Marcar o LOTE também escreve. No treino a fila é de exemplos: deixar o
    // botão vivo mandaria um lote de ids inertes ao Waze — sem efeito, mas é
    // requisição que ninguém pediu, e o aviso mente sobre o que aconteceu.
    if (Treino.ativo) { showToast(t('treino.semLote'), 'info'); return; }
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
            registrarPouso(items);
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
    // A ordem que a página nova pediu é aplicada AQUI, com o card já fora da
    // tela: é o único instante em que reordenar não troca nada por baixo de
    // ninguém. O `showCurrentPlace()` logo abaixo mostra o novo topo e agenda o
    // aquecimento em cima dele, então a foto pré-carregada volta a ser a do
    // card que vem — sem gatilho novo.
    if (AppState.ordemPendente) {
        AppState.ordemPendente = false;
        sortQueue();
    }
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
        const hasCard = !!cardDaFrente();
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

// `place` aceita UM place ou um ARRAY deles (o lote). Um mecanismo só, de
// propósito: o Desfazer do lote tem que seguir exatamente as mesmas regras do
// Desfazer de um card — a trava dos botões, o banner com a contagem regressiva,
// o descarregamento ao sair, o `resetQueue`. Dois mecanismos seriam duas
// listas de regras pra manter em sincronia, e a segunda envelheceria.
//
// `opts.aoSair` diz o que fazer quando a página morre no meio da janela:
//   'execute' (padrão) — despacha com keepalive. Uma requisição: ou vai ou não.
//   'cancel'           — descarta sem enviar. É o certo pro LOTE, e o motivo é
//                        que N requisições disparadas no `pagehide` completam
//                        PARCIALMENTE: sete vão, sete não, e o placar já contou
//                        as catorze. Meio-lote enviado é a única falha aqui sem
//                        sintoma nenhum — perder o lote se refaz em dois toques.
function scheduleAction(type, place, executor, opts = {}) {
    dlog('acao', { tipo: type, place: dlogPlace(place),
                   undo: AppState.preferences.undoEnabled !== false });
    const places = Array.isArray(place) ? place : [place];
    const n = places.length;
    const aoSair = opts.aoSair === 'cancel' ? 'cancel' : 'execute';
    // Reverte o placar otimista. `salvar` existe porque o `cancel` do logout
    // não precisa gravar (tudo é apagado depois) mas o do `pagehide` precisa:
    // o número inflado JÁ foi pro armazenamento quando a ação foi agendada.
    const reverterPlacar = (salvar) => {
        if (type === 'read') AppState.stats.read = Math.max(0, AppState.stats.read - n);
        else if (type === 'reject') AppState.stats.rejected = Math.max(0, AppState.stats.rejected - n);
        else if (type === 'skip') AppState.stats.skipped = Math.max(0, AppState.stats.skipped - n);
        if (salvar) { updateStats(); saveStats(); }
    };
    if (AppState.pendingAction) {
        AppState.pendingAction.execute();
        AppState.pendingAction = null;
    }
    removeUndoBanner();
    // Do gesto até o fim do envio o pedido está "em andamento": uma busca que
    // chegar nesse meio não o traz de volta (ver `semOsJaDecididos`). Sai no fim
    // do envio — quando ele já está no pouso ou na fila de saída — e no
    // Desfazer/cancelar, quando ele volta a ser só um pedido da fila.
    marcarEmAndamento(places, true);

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
            marcarEmAndamento(places, false);
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
        cancel: (salvarPlacar) => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                marcarEmAndamento(places, false);
                reverterPlacar(!!salvarPlacar);
            }
        },
        // O que fazer quando a página está morrendo. Ver o comentário da
        // assinatura: o lote CANCELA porque meio-lote enviado não tem sintoma.
        aoSair,
        // Página morrendo SEM REDE: a decisão vai direto pra fila de saída, na
        // hora e sem tentar a rede. O caminho normal chegaria lá do mesmo jeito
        // — tenta, falha por rede, enfileira —, mas por uma cadeia ASSÍNCRONA
        // que precisa de mais uma volta do laço de eventos, e a página que está
        // sendo encerrada pode não ter essa volta. Aí a decisão sumia com o
        // placar já contado, e o pedido voltava como card na reabertura. Só pra
        // um pedido de ✕ ou ✓: o lote tem regra própria (`aoSair: 'cancel'`) e o
        // Pular não escreve nada no Waze.
        enfileirarSemRede: () => {
            if (executed || n !== 1 || (type !== 'read' && type !== 'reject')) return false;
            const r = enfileirarSaida(type, places[0]);
            if (!r) return false;          // fila cheia: segue o caminho de sempre
            executed = true;
            clearTimeout(timerId);
            AppState.pendingAction = null;
            marcarEmAndamento(places, false);
            // Já estava na fila de saída: o placar contou este gesto em cima de
            // uma decisão que já tinha sido contada.
            if (r === 'repetida') reverterPlacar(true);
            removeUndoBanner();
            aplicarTravaDeAcao();
            return true;
        },
        undo: () => {
            if (!executed) {
                executed = true;
                clearTimeout(timerId);
                // Volta a ser um pedido da fila como qualquer outro.
                marcarEmAndamento(places, false);
                // Usou: a evidência de "nunca desfaz" morre aqui e recomeça do
                // zero. Quem desfaz de vez em quando não deve receber a dica.
                zerarJanelasSemUndo();
                reverterPlacar(false);
                if (type !== 'skip') AppState.serverTotal += n; // skip nunca decrementou o total
                updateStats();
                saveStats();
                // `unshift(...places)` e NÃO um laço: um laço de unshift inverte
                // a ordem, e a fila voltaria embaralhada — sem erro visível, só
                // discordando do WME na hora de conferir.
                AppState.queue.unshift(...places);
                updatePendingCount();
                // Volta pro PRIMEIRO dos restaurados. Sem isto, desfazer um lote
                // mostraria o card de outro autor, e leria como se o Desfazer
                // tivesse feito outra coisa.
                showCurrentPlace();
            }
        }
    };

    const undoMsg = n > 1
        ? t('undo.lote', { n })
        : type === 'reject' ? t('undo.reject') : type === 'skip' ? t('undo.skip') : t('undo.read');
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
    document.getElementById('undoBtn').addEventListener('click', desfazerAcaoPendente);
}

// Desfazer, pelos DOIS caminhos (o botão do banner e a tecla z).
//
// O `aplicarTravaDeAcao()` no fim é o que conserta um defeito que existia desde
// antes do lote e que ninguém tinha visto: os dois caminhos limpavam o
// `pendingAction` e o banner, mas nunca reabilitavam os botões do card. E não
// dava pra perceber pela ordem certa — o `undo()` chama `showCurrentPlace()`
// ANTES de o chamador zerar o `pendingAction`, então o card novo nascia travado
// e nada voltava a olhar pra ele. O gesto seguia funcionando (o `acoesTravadas`
// já era falso), o que escondia o problema: só o caminho canônico e acessível,
// os três botões, é que ficava morto — inclusive pra quem usa leitor de tela,
// porque `disabled` também tira da ordem do Tab.
function desfazerAcaoPendente() {
    if (AppState.pendingAction) {
        AppState.pendingAction.undo();
        AppState.pendingAction = null;
        registrarDesfazer();
    }
    removeUndoBanner();
    aplicarTravaDeAcao();
}

function removeUndoBanner() {
    const container = document.getElementById('undoContainer');
    if (container) container.innerHTML = '';
}

// UM indicador para os dois estados, e não dois: eles disputam o mesmo canto e
// nunca dizem coisas independentes — "enviando" é o que está saindo AGORA,
// "esperando" é o que ficou pra depois. Enviando ganha, porque é o estado que
// está mudando.
function updateInFlightIndicator() {
    let el = document.getElementById('inFlightIndicator');
    const esperando = AppState.authenticated ? carregarFilaDeSaida().length : 0;
    if (AppState.inFlightActions <= 0 && esperando <= 0) {
        if (el) el.remove();
        return;
    }
    if (!el) {
        el = document.createElement('div');
        el.id = 'inFlightIndicator';
        document.body.appendChild(el);
    }
    // Girando só quando está MESMO saindo. "Esperando" com giro seria a app
    // fingindo trabalho que não está acontecendo — e é justamente o estado em
    // que não há rede pra trabalhar.
    const enviando = AppState.inFlightActions > 0;
    const n = enviando ? AppState.inFlightActions : esperando;
    const texto = enviando
        ? t('indicator.sending', { n: AppState.inFlightActions })
        : t('indicator.waiting', { n: esperando });

    // ÍCONE + NÚMERO, sem pílula (decisão do owner, 2026-09-21, olhando mockups
    // na tela real: *"o texto não poderia ser mais discreto?"*).
    //
    // MEDIDO nas cinco variantes, no iPhone dele e no Fold: a frase inteira
    // custava 128px e tapava **100% da tinta do RESTAM**; isto custa 23px e
    // **zero**. Ou seja, encolher resolveu de graça o que tinha sido avaliado e
    // mantido a contragosto uma hora antes — foi o dado novo que a régua de
    // "não re-proponha sem dado novo" pedia.
    //
    // O ÍCONE é que carrega o estado, nunca a cor sozinha (WCAG 1.4.1, a mesma
    // régua que fez a pílula da presença trocar de ícone): spinner girando =
    // saindo agora, relógio = parado esperando rede. A cor só reforça.
    //
    // SÓ NÚMERO foi medido e RECUSADO: "2" e "3" ficam visualmente idênticos, e
    // aí se perde exatamente a distinção que importa quando não há sinal —
    // entre o trabalho estar saindo e estar encalhado.
    const icone = enviando ? `
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>` : `
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>
        </svg>`;
    // As shades do CLARO são -800 e não -700: sem pílula o contraste é contra o
    // cartão do placar, e -700 media 4,8:1 contra um mínimo de 4,5 — passa, mas
    // com 0,3 de folga. O `.valor-ausente` já nasceu numa margem dessas e teve
    // que ser corrigido depois (gotcha #40: constante de contraste tem ESCOPO).
    el.className = 'fixed top-20 right-4 z-40 flex items-center gap-1 text-[0.6875rem] font-semibold '
        + (enviando ? 'text-cyan-800 dark:text-cyan-300'
                    : 'text-amber-800 dark:text-amber-300');
    el.title = texto;
    // A FRASE INTEIRA continua existindo pra quem usa leitor de tela: o que
    // encolheu foi o pixel, não a informação. Sem o `sr-only` ele ouviria "3" e
    // mais nada — e "3" sozinho não diz nem o que são, nem em que estado estão.
    el.innerHTML = icone + `<span class="tnum" aria-hidden="true">${escapeHtml(String(n))}</span>`
        + `<span class="sr-only">${escapeHtml(texto)}</span>`;
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

// `semAnimar` existe pra UMA situação: a troca de CONTEXTO do placar (entrar e
// sair do treino). Contar de 7 pra 0 sugere que o trabalho da pessoa mudou —
// quando o que mudou foi o placar que ela está olhando. É o mesmo raciocínio do
// "contador que muda de 1 PULA, não conta", visto do outro lado: animação aqui
// conta uma história falsa. Medido: 7/2/1/99 contando até 0/0/0/3 levava ~1s.
function setCount(el, valor, sufixo = '', semAnimar = false) {
    if (!el) return;
    // Os QUATRO pontos de escrita passam pelo mesmo lugar — inclusive os
    // quadros da animação. Hoje ele só concatena o sufixo, mas é o que garante
    // que o '+' do "Restam" não fique de fora de um deles.
    const esc = (n) => String(n) + sufixo;
    if (semAnimar) {
        if (el._countRaf) cancelAnimationFrame(el._countRaf);
        el.textContent = esc(valor);
        return;
    }
    const anterior = parseInt(String(el.textContent).replace(/\D/g, ''), 10);
    const alvo = Number(valor);
    const mudou = !Number.isFinite(anterior) || anterior !== alvo;

    if (!Number.isFinite(alvo) || prefersReducedMotion()) {
        el.textContent = esc(valor);
        return;
    }
    // Sem valor anterior legível ('—', '…'): escreve direto, mas ainda pula.
    if (!Number.isFinite(anterior) || Math.abs(alvo - anterior) < 2) {
        el.textContent = esc(alvo);
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
        el.textContent = esc(Math.round(anterior + (alvo - anterior) * eased));
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

function updateStats(semAnimar = false) {
    // Todo caminho que mexe em Lidos/Rejeitados passa por aqui (swipe, botão,
    // lote, undo revertendo) — é o único ponto que pega todos sem espalhar
    // chamadas por seis handlers.
    checkUndoGateUnlock();
    setCount(document.getElementById('readCount'), AppState.stats.read, '', semAnimar);
    setCount(document.getElementById('rejectedCount'), AppState.stats.rejected, '', semAnimar);
    setCount(document.getElementById('skippedCount'), AppState.stats.skipped, '', semAnimar);
    updatePendingCount(semAnimar);
}

// ── Ponto no ícone da app instalada ──────────────────────────────────────
// PONTO, não número, e a razão é honestidade: o badge só é escrito quando a app
// RODA, então um número fica velho no instante em que a pessoa fecha. "118" no
// ícone dois dias depois é uma afirmação falsa; o ponto diz "há trabalho", que
// continua verdadeiro enquanto a fila não zera — e a fila medida do owner nunca
// zerou (211, 196, 108 em três dias).
//
// Nunca PEDE permissão. No iOS o badge exige notificação autorizada, e um
// prompt não solicitado é exatamente a interrupção que a régua do projeto
// proíbe. Sem autorização a promessa rejeita, e aqui isso é silêncio: o recurso
// simplesmente não existe naquele aparelho.
function atualizarPontoNoIcone() {
    try {
        if (!('setAppBadge' in navigator)) return;
        const temTrabalho = AppState.authenticated && AppState.serverTotal > 0;
        // `setAppBadge()` sem argumento é o PONTO; com número seria a contagem.
        const p = temTrabalho ? navigator.setAppBadge() : navigator.clearAppBadge();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* aparelho sem suporte não pode derrubar o placar */ }
}

// ── Aviso de sessão vencendo ─────────────────────────────────────────────
// Existe porque o fim da sessão chega como surpresa no pior lugar possível: no
// celular, onde não há como renovar. Quem entrou pelo QR precisa de um
// computador, e descobrir isso no meio da fila custa a sessão inteira de
// triagem.
//
// O prazo é o do WAZE, não o da app, e a diferença é o que torna a conta
// honesta. O `SESSION_TTL` da app (21 dias) é DESLIZANTE — o `loadSession`
// renova a cada uso, então quem usa nunca chega perto dele e contar a partir
// dali seria inventar um prazo que não vence. Já o cookie do Waze tem prazo
// FIXO: MEDIDO com 3 chamadas de leitura seguidas, o valor do `_web_session`
// mudou nas três (o Waze rotaciona a cada resposta, gotcha #43) e o `Expires`
// ficou parado, com o `Max-Age` só decrescendo. O servidor lê esse prazo do
// `Set-Cookie` que já recebe e manda junto (`sessaoExpiraEm`).
//
// Não guarda nada a mais no servidor e não encosta na criptografia: o prazo
// vem de um cabeçalho que a resposta já trazia, e mora no aparelho.
const AVISO_SESSAO_DIAS = 5;

function carregarPrazoDaSessao() {
    const bruto = Number(safeLS.get(SESSAO_KEY));
    AppState.sessaoExpiraEm = Number.isFinite(bruto) && bruto > 0 ? bruto : null;
}

// Ausente NÃO é "não vence": o Waze só manda `Set-Cookie` quando rotaciona, e
// uma resposta sem ele não desmente a anterior. Por isso só grava valor válido
// — apagar aqui faria o aviso piscar a cada chamada que não trouxe o cabeçalho.
function guardarPrazoDaSessao(body) {
    if (!body || typeof body !== 'object') return;
    const prazo = Number(body.sessaoExpiraEm);
    if (!Number.isFinite(prazo) || prazo <= 0) return;
    // Só registra quando MUDA: o Waze manda o cabeçalho ao rotacionar, e sem
    // esta condição o diário viraria uma linha por resposta — o custo de
    // escrita que a regra de entrada existe pra evitar.
    const mudou = AppState.sessaoExpiraEm !== prazo;
    AppState.sessaoExpiraEm = prazo;
    safeLS.set(SESSAO_KEY, String(prazo));
    if (mudou) registrarEventoDeSessao('prazo', { prazo, emDias: Math.round((prazo - Date.now() / 1000) / 8640) / 10 });
    atualizarAvisoDeSessao();
}

function esquecerPrazoDaSessao() {
    AppState.sessaoExpiraEm = null;
    safeLS.remove(SESSAO_KEY);
    atualizarAvisoDeSessao();
}

function atualizarAvisoDeSessao() {
    const el = document.getElementById('avisoSessao');
    if (!el) return;
    const prazo = AppState.sessaoExpiraEm;
    const esconder = () => { el.classList.add('hidden'); el.textContent = ''; };
    if (!AppState.authenticated || !prazo) return esconder();
    const faltaMs = prazo * 1000 - Date.now();
    // Já venceu: quem avisa é o 401, que leva pra tela de entrar. Repetir aqui
    // seria dizer "vence em -1 dia" atrás de uma tela que nem está mais visível.
    if (faltaMs <= 0) return esconder();
    // `floor`, nunca `round`: com 4,9 dias o certo é dizer 4. Arredondar pra cima
    // daria mais prazo do que existe, que é o único erro que custa caro aqui.
    const dias = Math.floor(faltaMs / 86400000);
    if (dias > AVISO_SESSAO_DIAS) return esconder();
    el.textContent = dias === 0
        ? t('sessao.vence.hoje')
        : t(dias === 1 ? 'sessao.vence.dias' : 'sessao.vence.diasPlural', { n: dias });
    el.classList.remove('hidden');
}

function updatePendingCount(semAnimar = false) {
    const el = document.getElementById('pendingCount');
    atualizarPontoNoIcone();
    atualizarAvisoDeSessao();
    if (!el) return;
    if (!AppState.authenticated) {
        el.textContent = '—';
        return;
    }
    if (AppState.fetching && AppState.serverTotal === 0) {
        el.textContent = '…';
        return;
    }
    // FALHOU: a app NÃO SABE quantos restam, e zero não é "não sei" — zero é
    // "tudo limpo", que é o oposto. Medido no relato do owner: a tela dizia
    // RESTAM 0 com 426 pedidos esperando do outro lado. O traço é o mesmo
    // símbolo que o deslogado já usa, então o editor não precisa aprender nada.
    if (AppState.loadError) {
        el.textContent = '—';
        return;
    }
    setCount(el, AppState.serverTotal, AppState.hasMore ? '+' : '', semAnimar);
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
            AppState.filters.types = sanearTiposSalvos(parsed.types);
            AppState.filters.residential = parsed.residential || '';
            AppState.filters.stateId = parsed.stateId || '';
            AppState.filters.managedAreaId = parsed.managedAreaId || '';
            AppState.filters.myArea = !!parsed.myArea;
            AppState.filters.unreadOnly = parsed.unreadOnly !== false;
            AppState.filters.categories = Array.isArray(parsed.categories) ? parsed.categories : [];
            // O GPS NUNCA volta de uma sessão anterior: posição é um momento e
            // amanhã a pessoa está em outro lugar — restaurá-la ordenaria a fila
            // por onde ela esteve ontem. Casa e trabalho voltam (saem do perfil
            // a cada sessão), e o `ordemValida` confere se ainda existem.
            AppState.filters.sortOrder = ['oldest', 'casa', 'trabalho'].includes(parsed.sortOrder)
                ? parsed.sortOrder : ORDEM_PADRAO;
        }
    } catch (e) {}
}

// Gravar preferência ANTES de tê-las lido apaga a escolha da pessoa com o
// padrão. E não é hipotético: com o `/api/perfil` falhando, o
// `checkUndoGateUnlock` chega a `savePreferences()` num momento em que a
// memória ainda é o literal de origem — medido, com o `undoEnabled: false` do
// editor virando `true` no armazenamento, de forma PERMANENTE.
//
// ── ANISTIA DA PRESENÇA ─────────────────────────────────────────────────────
// Desligar "Ver quem está na fila" é decisão de um dia; ficar invisível pra
// sempre por causa dela raramente é a intenção. Quem experimentou o desligar
// no primeiro contato e esqueceu nunca mais vê o recurso — e não tem como
// descobrir que ele existe, porque a pílula (que é a única coisa que o anuncia)
// é justamente o que ele desligou.
//
// Depois de 9 dias desligado, volta sozinho e EM SILÊNCIO: sem toast, sem
// banner. Anunciar seria transformar uma reativação discreta numa interrupção,
// que é o oposto do que ela existe pra consertar.
//
// Quem quiser desligar de novo desliga, e ganha outros 9 dias. Quem religa à
// mão zera o carimbo — a contagem é do DESLIGAR, não do calendário.
const PRESENCA_ANISTIA_DIAS = 9;
const PRESENCA_ANISTIA_MS = PRESENCA_ANISTIA_DIAS * 24 * 60 * 60 * 1000;

// A ordem certa é garantida por invariante, não por sorte de quem chama antes:
// enquanto não se leu, não se escreve.
let preferenciasCarregadas = false;

function savePreferences() {
    if (!preferenciasCarregadas) return;
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
            // Opt-out: só desliga quem DISSE que quer desligado. `undefined`
            // (quem nunca abriu as Preferências) fica ligado, que é o padrão.
            if (typeof parsed.presenca === 'boolean') AppState.preferences.presenca = parsed.presenca;
            // Opt-IN, ao contrário da presença logo acima: só liga quem DISSE
            // que quer. `undefined` fica desligado, que é o padrão.
            AppState.preferences.pularGuarda = parsed.pularGuarda === true;
            // Opt-IN estrito tambem: quem nunca marcou nao paga byte nenhum.
            AppState.preferences.offlineDisponivel = parsed.offlineDisponivel === true;
            // undefined = nunca decidido (user antigo ou primeira visita).
            // Só copia se for boolean, pra initUndoGateSeen poder decidir depois.
            if (typeof parsed.undoGateSeen === 'boolean') {
                AppState.preferences.undoGateSeen = parsed.undoGateSeen;
            }
            if (typeof parsed.dicaDesfazerVista === 'boolean') {
                AppState.preferences.dicaDesfazerVista = parsed.dicaDesfazerVista;
            }
            if (typeof parsed.comoFuncionaVisto === 'boolean') {
                AppState.preferences.comoFuncionaVisto = parsed.comoFuncionaVisto;
            }
            if (parsed.consequenciaVista && typeof parsed.consequenciaVista === 'object') {
                AppState.preferences.consequenciaVista = parsed.consequenciaVista;
            }
            if (typeof parsed.semUndoSeguidas === 'number' && parsed.semUndoSeguidas >= 0) {
                AppState.preferences.semUndoSeguidas = parsed.semUndoSeguidas;
            }
            if (Number.isFinite(parsed.presencaOffEm) && parsed.presencaOffEm > 0) {
                AppState.preferences.presencaOffEm = parsed.presencaOffEm;
            }
            // A app já viu a visibilidade do WME LIGADA (fase 2). É o que separa
            // "nunca esteve ligada" (a app liga) de "a pessoa desligou fora da
            // app" (conta como desligar). Estrito: só `true` conta.
            if (parsed.presencaWmeVisto === true) AppState.preferences.presencaWmeVisto = true;
        }
    } catch (e) {}
    preferenciasCarregadas = true;
    if (aplicarAnistiaDaPresenca()) savePreferences();
}

// Devolve true quando MUDOU alguma coisa (pra quem chama saber se grava).
//
// Roda depois do `preferenciasCarregadas = true` de propósito: o
// `savePreferences` sai calado antes disso, e a anistia precisa PERSISTIR —
// senão ela reavalia a cada carga e o carimbo velho fica pra sempre no
// aparelho.
function aplicarAnistiaDaPresenca() {
    const p = AppState.preferences;
    if (p.presenca !== false) {
        // Ligado não tem contagem correndo. Carimbo sobrando é resíduo de uma
        // versão anterior ou de armazenamento editado à mão.
        if (p.presencaOffEm === undefined) return false;
        delete p.presencaOffEm;
        return true;
    }
    // Desligado SEM carimbo: não há de quando contar, então NÃO se conta.
    //
    // Isto já foi migração (carimbava a hora, pra quem desligou antes de a
    // anistia existir) e virou DEFESA quando o legado saiu, em 2026-09-10.
    // A diferença importa: a migração ESCREVIA, esta linha não faz nada.
    //
    // E ela não é opcional. Sem este `return`, `Date.now() - undefined` dá NaN,
    // `NaN < PRESENCA_ANISTIA_MS` é **false**, e o fluxo cai direto no religar
    // lá embaixo — ou seja, todo mundo que estava com a presença desligada
    // seria RELIGADO de uma vez, que é exatamente a mudança em massa que a
    // anistia de 9 dias existe pra evitar. MEDIDO antes de remover o ramo.
    // Vale pra qualquer origem do estado torto: armazenamento editado à mão,
    // gravação truncada, relógio maluco — não só pro legado que saiu.
    if (!Number.isFinite(p.presencaOffEm) || p.presencaOffEm <= 0) return false;
    // Relógio que andou pra trás dá diferença negativa: isso não é 9 dias.
    const decorrido = Date.now() - p.presencaOffEm;
    if (decorrido < PRESENCA_ANISTIA_MS) return false;
    p.presenca = true;
    delete p.presencaOffEm;
    return true;
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
            // O boot também precisa mostrar o FAB: quem já estava com o dev
            // ligado não vai desligar e religar só pra ele aparecer.
            setTimeout(atualizarFabDev, 0);
            diagAjustarRecursos();
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
    // As três escritas do lightbox têm a mesma janela e o mesmo risco: sair da
    // página com uma pendente a faria sumir depois de a tela já ter mudado.
    for (const p of [renomeacaoPendente, aprovacaoPendente, exclusaoPendente]) {
        if (!p) continue;
        if (typeof API !== 'undefined' && API.setSaindo) API.setSaindo(true);
        try { p.enviar(); } catch (e) { console.error('Falha ao descarregar:', e); }
    }
    if (!AppState.pendingAction) return;
    // Sem rede não há o que tentar: a decisão vai pra fila de saída de forma
    // SÍNCRONA, antes de a página morrer (ver `enfileirarSemRede`). Só o `false`
    // decide — `onLine === true` não prova rede, e aí vale o caminho de sempre.
    try {
        if (navigator.onLine === false && AppState.pendingAction.enfileirarSemRede
            && AppState.pendingAction.enfileirarSemRede()) return;
    } catch (e) {
        console.error('Falha ao enfileirar a ação pendente:', e);
    }
    // Fetch normal é cancelado no unload; keepalive sobrevive.
    if (typeof API !== 'undefined' && API.setSaindo) API.setSaindo(true);
    try {
        // O LOTE cancela em vez de despachar (ver `aoSair` no scheduleAction).
        // `true` grava o placar revertido: o número inflado já foi pro
        // armazenamento quando o lote foi agendado, e sem isto ele sobreviveria
        // ao recarregamento contando pedidos que nunca saíram.
        if (AppState.pendingAction.aoSair === 'cancel') AppState.pendingAction.cancel(true);
        else AppState.pendingAction.execute();
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

// Só estes abrem teclado ou seletor do sistema. É ALLOWLIST, não denylist, e a
// direção importa: errar pra menos deixa um campo novo atrás do teclado (chato);
// errar pra mais devolve o bug que motivou esta função — a app tem 12 checkboxes
// e 70 botões, e `openModal` foca o primeiro focável do modal, então um seletor
// frouxo daria "campo focado" em quase toda abertura.
const CAMPOS_COM_TECLADO = 'textarea, select, [contenteditable=""], [contenteditable="true"], '
    + 'input[type="text"], input[type="search"], input[type="url"], input[type="tel"], '
    + 'input[type="email"], input[type="password"], input[type="number"], input[type="date"], '
    + 'input[type="time"], input[type="datetime-local"], input[type="month"], input[type="week"]';

function campoDeTextoFocado() {
    const a = document.activeElement;
    if (!a || typeof a.matches !== 'function') return false;
    try { return a.matches(CAMPOS_COM_TECLADO); } catch (e) { return false; }
}

// Quanto o teclado está cobrindo, em px — a decisão isolada pra poder ser testada.
// Três defesas, uma por modo de falha, e só a primeira conserta o bug relatado:
//
// 1. PORTÃO NO FOCO. O inset existe pra sair da frente do TECLADO, e não há
//    teclado sem campo focado. Sem o portão a app acreditava em qualquer leitura
//    do `visualViewport`: no PWA do iOS de um editor ela ficou cravada em 388px
//    com nada focado, e como o valor só é recalculado em `resize`/`scroll` do
//    visualViewport — que o scroll-lock do modal (`body{overflow:hidden}`)
//    impede de disparar — durou a sessão inteira. Medido no vídeo dele: o modal
//    de Filtros com 305pt de altura onde deviam ser 690pt.
// 2. TETO. Teclado nenhum ocupa 75% da janela (medido: iPhone SE 53%, paisagem
//    ~55%). Não é o conserto — é o limite do estrago se a leitura mentir COM um
//    campo focado. Folgado de propósito: teto apertado devolveria o defeito
//    original, com o campo atrás do teclado.
// 3. PISO de 80px: barra do navegador entrando/saindo não é teclado — reagir a
//    isso faria o modal pular a cada rolagem.
function insetDoTeclado(coberto, alturaJanela, temCampoFocado) {
    if (!temCampoFocado) return 0;
    if (!(coberto > 80)) return 0;
    const teto = Math.round((Number(alturaJanela) || 0) * 0.75);
    return Math.max(0, Math.min(coberto, teto));
}

function setupKeyboardInset() {
    const vv = window.visualViewport;
    if (!vv) return;
    let ultimoInset = null;
    const aplicar = () => {
        const coberto = Math.round(window.innerHeight - vv.height - vv.offsetTop);
        const foco = campoDeTextoFocado();
        const inset = insetDoTeclado(coberto, window.innerHeight, foco);
        document.documentElement.style.setProperty('--kb-inset', inset + 'px');
        // Só quando MUDA: `resize`/`scroll` do visualViewport disparam em rajada
        // enquanto o teclado sobe, e anel de 120 não sobrevive a isso. Este é o
        // fato que teria respondido em minutos o caso dos 11 modais achatados no
        // iOS — lá o inset ficou cravado em 388px SEM campo focado, e o arquivo
        // não trouxe uma linha do que levou até ali. Vai o `coberto` cru junto
        // do que foi APLICADO: a diferença entre os dois é a resposta.
        if (inset !== ultimoInset) {
            dfato('kb', { inset, coberto, foco, jan: window.innerHeight });
            ultimoInset = inset;
        }
    };
    vv.addEventListener('resize', aplicar);
    vv.addEventListener('scroll', aplicar);
    // O foco entra e sai sem que o visualViewport mexa (trocar de campo pra
    // botão, fechar o modal pelo scrim). Sem estes dois o portão acima só
    // valeria até a próxima vez que o teclado se mexesse — e era justamente
    // "nunca mais" que criava o bug. Adiados um tick porque no `focusout` o
    // `activeElement` ainda é o campo que está SAINDO.
    const aplicarDepois = () => setTimeout(aplicar, 0);
    document.addEventListener('focusin', aplicarDepois);
    document.addEventListener('focusout', aplicarDepois);
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

// A linha REQUEST do filtro (e a função que a mostrava) MORREU: ela virou as
// quatro do WME — atualização de detalhes, local marcado, excluir local e foto
// sinalizada. Fica o registro do que ela custou enquanto esteve fechada atrás
// do modo dev, porque a lição vale pro próximo gate: numa fila real de 137
// pedidos, 135 eram REQUEST — o editor abria a app e via DOIS. Meça quanto da
// fila um gate esconde antes de deixá-lo fechado mais um mês.
//
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
//   rank 5 (L6) → 10 PURs, rank 4 (L5) → 12, rank 3 (L4) → 15, rank 2 (L3) → 20,
//   rank 1 (L2) → 30, rank 0 (L1) → 60.
// A linha do L1 é inalcançável desde que a entrada virou L2+AM — fica na tabela
// porque a fórmula a produz, não porque alguém a atinge.
// "PURs tratados" = read + rejected (skipped não treina o ritmo de ação destrutiva).
// Staff são isentos. Esta NÃO é proteção de segurança — é UX/educação. localStorage
// pode ser editado pelo user esperto; o objetivo é proteger quem é genuinamente novato.
//
// Histórico da base, porque o parágrafo que estava aqui ficou MENTINDO: ele
// argumentava contra "baixar mais (30/60)" com os números `L5=6 vs L6=5`, que
// são de base 30 — e foi escrito quando a base era 300. A base já era 120 e o
// texto seguia decidindo por uma tabela que não existia mais. 3000 → 300 → 120
// → 60; quem for mexer de novo, refaça a conta em vez de herdar a frase.
//
// 60 é decisão do owner (2026-09-09), tomada junto com baixar a entrada pra
// L2+AM, e com o custo na mesa: o gate inteiro vale ~2,4s de espera por pedido
// tratado (2431ms travado contra 33ms sem trava), então ele custa 1 a 2 minutos
// UMA vez na vida — a 120 eram ~144s pro L2 e ~48s pro L6; a 60 são ~72s e
// ~24s. O que se perde no topo: o L6 desbloqueia em 10 pedidos, ~25 segundos de
// trabalho, o que é quase nenhum gate. Se um dia isso incomodar, o caminho não
// é mexer na base (ela move todo mundo junto) — é achatar a curva por baixo,
// tipo um piso, que baixa as cotas altas sem isentar quem tem rank.
const UNDO_GATE_BASE = 60;

function getUndoTreatedCount() {
    return (AppState.stats.read || 0) + (AppState.stats.rejected || 0);
}

function guardarPerfilDoPortao(p) {
    if (!p || typeof p.rank !== 'number') return;
    safeLS.set(PERFIL_GATE_KEY, JSON.stringify({ rank: p.rank, isStaff: !!p.isStaff }));
    // O perfil ACABOU de ficar conhecido, e era a única peça que faltava pra
    // estabelecer a linha de base da conquista. Aqui e não no `initApp` porque
    // é este o momento em que a cota deixa de ser Infinity — nas DUAS entradas
    // de perfil, sem depender de quem lembra de chamar.
    initUndoGateSeen();
}

// O perfil que a COTA usa: o vivo, se houver; senão o último que carregou.
// A cota mede a EXPERIÊNCIA da pessoa, que não muda porque a rede caiu.
function perfilDoPortao() {
    if (AppState.profile && typeof AppState.profile.rank === 'number') return AppState.profile;
    try {
        const c = JSON.parse(safeLS.get(PERFIL_GATE_KEY) || 'null');
        return c && typeof c.rank === 'number' ? c : null;
    } catch (e) { return null; }
}

function getUndoUnlockThreshold() {
    const p = perfilDoPortao();
    if (p && p.isStaff) return 0;
    const rank = p && p.rank;
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
    // Mesma invariante do savePreferences: sem ter lido, não se decide.
    if (!preferenciasCarregadas) return;
    if (typeof AppState.preferences.undoGateSeen === 'boolean') return;
    // Sem cota conhecida NÃO HÁ decisão a tomar — adiar é o certo. Cota Infinity
    // responderia "não atingiu" pra quem tem 200 tratados, e o pedido seguinte
    // viraria uma falsa conquista pelo acumulado de meses.
    if (!isFinite(getUndoUnlockThreshold())) return;
    AppState.preferences.undoGateSeen = undoGateAtingido();
    savePreferences();
}

function checkUndoGateUnlock() {
    // `undefined` = a LINHA DE BASE ainda não foi estabelecida: `initUndoGateSeen`
    // não pôde decidir se este acumulado é trabalho de ANTES. Celebrar aqui
    // parabeniza pelo histórico, e é o que fazia o aviso sair a cada recarga.
    // Só `false` — decisão tomada, ainda não atingiu — libera a comemoração.
    if (typeof AppState.preferences.undoGateSeen !== 'boolean') return;
    if (AppState.preferences.undoGateSeen) return;
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

// Abre o modal JÁ na aba pedida, sem esperar a rede.
//
// `openFiltersModal` termina com `await popularPaisEstado()`, que vai ao Waze.
// Esperar a promise INTEIRA antes de trocar de aba deixava o editor olhando a
// aba Filtros por 480ms em rede boa e 1337ms em rede ruim (os números estão
// medidos no comentário de lá) — e só então a tela saltava pra outra aba. Era
// o que o caminho do Desfazer fazia; hoje os dois passam por aqui.
//
// Não esperar é seguro por razão ESTRUTURAL, não por sorte: tudo que importa
// pra este desvio — `renderHistory()` e o `openModal()` — é SÍNCRONO e roda
// ANTES do primeiro `await` da função. Chamar sem `await` executa esse trecho
// inteiro no mesmo tick, então a troca de aba acontece antes de qualquer
// pintura e ninguém vê a aba errada.
//
// `test/patentes.test.mjs` cobra essa ordem. Um `await` novo enfiado antes do
// `renderHistory()` quebraria isto EM SILÊNCIO — e de um jeito pior que a
// piscada: a aba Histórico apaga as marcas ao abrir (`marcarConquistasVistas`),
// então o painel renderizaria DEPOIS, já sem nada marcado.
function abrirModalNaAba(aba) {
    const pendente = openFiltersModal();
    switchFilterTab(aba);
    return pendente;
}

// Leva direto ao interruptor em vez de mandar procurar em Filtros → Preferências.
async function abrirPreferenciaDoUndo() {
    const pendente = abrirModalNaAba('filtersTabPrefs');
    const linha = document.getElementById('prefUndoRow');
    if (linha && !prefersReducedMotion()) {
        linha.classList.remove('pref-highlight');
        void linha.offsetWidth;   // reflow: sem isso a animação não reinicia
        linha.classList.add('pref-highlight');
        linha.addEventListener('animationend', () => linha.classList.remove('pref-highlight'), { once: true });
    }
    await pendente;
}

// O MESMO desvio, para o ponto no botão de Filtros: leva direto ao que
// destravou, em vez de largar a pessoa na aba Filtros pra procurar entre 16
// células. É o irmão do aviso do Desfazer — mudou o jeito de ANUNCIAR (ponto
// discreto em vez de banner, decisão do owner em 2026-09-16), não o que
// acontece quando a pessoa aceita o convite.
async function abrirConquistaNova() {
    const pendente = abrirModalNaAba('filtersTabHistory');
    destacarConquistaNova();
    await pendente;
}

// Rola até o que destravou e pisca uma vez.
//
// O ALVO pode ser uma célula da vitrine OU o cartão da patente: patente NÃO
// tem célula, então mirar só na grade deixaria sem alvo justamente quem subiu
// de patente — e o ponto teria aceso mesmo assim.
//
// A classe não precisa de limpeza no fechamento do modal (a regra do
// `LIMPEZA_AO_FECHAR`): o `renderHistory()` reescreve o innerHTML do painel a
// cada abertura, então ela não sobrevive nem ao próximo `openFiltersModal`.
function destacarConquistaNova() {
    const painel = document.getElementById('filtersPanelHistory');
    if (!painel) return;
    const novos = painel.querySelectorAll('.conq-card.nova, .conq-cel.nova');
    if (!novos.length) return;
    // O primeiro em ordem de DOM. O cartão da patente fica ACIMA da grade,
    // então quem subiu de patente e ganhou conquista na mesma ação vê a
    // patente primeiro — a mesma ordem em que as duas coisas estão na tela.
    //
    // `center` e não `nearest` (que é o que a dica da conquista usa): ali o
    // gesto é da pessoa e rolar o mínimo evita mexer a tela sob o dedo; aqui
    // NINGUÉM rolou nada, a app é que está apontando, e deixar o alvo colado
    // na borda inferior seria apontar pra beira da tela.
    novos[0].scrollIntoView({ block: 'center' });
    // O pulso é ENFEITE, e sai inteiro em reduced-motion: sem ele a pessoa
    // continua caindo na aba certa, com o alvo na tela e o contorno âmbar que
    // já existia. O que aponta é a ROLAGEM, não a animação.
    if (prefersReducedMotion()) return;
    novos.forEach((el) => {
        el.classList.remove('conq-alvo');
        void el.offsetWidth;   // reflow: sem isso a animação não reinicia
        el.classList.add('conq-alvo');
        el.addEventListener('animationend', () => el.classList.remove('conq-alvo'), { once: true });
    });
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

function renderPularGuardaPref() {
    const cb = document.getElementById('prefPularGuarda');
    if (cb) cb.checked = AppState.preferences.pularGuarda === true;
    // A linha do offline se redesenha junto: ela tem cinco estados e o modal é
    // por onde a pessoa vem olhar. Abrir o modal também é gesto — sem isto,
    // abrir pra conferir encontraria a varredura dormindo.
    const off = document.getElementById('prefOfflineDisponivel');
    if (off) off.checked = AppState.preferences.offlineDisponivel === true;
    offlineMarcarGesto();
    atualizarLinhaDoOffline(0, 0);
}

// O texto do selo de arrastar-pra-cima. Fonte única porque são DOIS chamadores
// (o card que nasce e a preferência que muda com o card já na tela), e a regra
// de consistência do projeto cobra que o que a app FAZ e o que ela DIZ sejam a
// mesma coisa: com a preferência ligada, o ↑ guarda — então ele tem que dizer.
//
// Escreve o ATRIBUTO e deixa o applyI18n traduzir, em vez de cravar o texto:
// assim trocar de idioma com o card na tela reescreve o selo certo (o card vive
// no documento, então o applyI18n global o alcança).
function atualizarSeloDePular(card) {
    const alvo = card || cardDaFrente();
    const el = alvo && alvo.querySelector('.swipe-stamp-up span[data-i18n]');
    if (!el) return;
    el.setAttribute('data-i18n', AppState.preferences.pularGuarda === true
        ? 'card.stamp.skipGuarda' : 'card.stamp.skip');
    if (typeof applyI18n === 'function') applyI18n(alvo);
}

function renderPresencaPref() {
    const cb = document.getElementById('prefPresenca');
    if (cb) cb.checked = AppState.preferences.presenca !== false;
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
    // FUNIL do diário: todo aviso que a pessoa vê passa por aqui, e é isto que
    // reconstrói "o que estava na tela". O toast dura 4s — sem registrar, ele
    // some antes de qualquer captura, que foi exatamente o que aconteceu no
    // diagnóstico do owner (tela com erro, zero toast no DOM).
    dlog('toast', { tipo: type, txt: String(message).replace(/<[^>]+>/g, '').slice(0, 140) });
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
    const relogio = setTimeout(dismiss, durationMs);
    // Punho pra quem precisa ACOMPANHAR algo: trocar o texto no lugar em vez de
    // empilhar um toast por passo. Call site que não precisa simplesmente ignora.
    return {
        texto(novo) {
            const alvo = toast.querySelector('span.flex-1');
            if (alvo) alvo.textContent = novo;
        },
        dispensar() { clearTimeout(relogio); dismiss(); },
    };
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
window.cardDaFrente = cardDaFrente;

// Usados pelo presenca.js, que carrega DEPOIS deste arquivo.
window.cardParaConversa = cardParaConversa;
window.abrirPedidoRecebido = abrirPedidoRecebido;
