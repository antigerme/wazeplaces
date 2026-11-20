window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.action === 'AG_WAZE_DATA') {
        // Verifica se a aba já foi criada para evitar duplicidade
        if (!document.getElementById('sidepanel-ag-tool')) {
            createAGInterface(event.data.userName, event.data.level, event.data.isAM, event.data.language,
                event.data.rank, event.data.isStaff);
        }
    }
});

// O portão do painel é o MESMO do servidor (`isUserAllowed`, em server/core.mjs):
// Staff, ou Area Manager de nível 2+. O Waze conta o nível do ZERO (`rank`), e a
// tela mostra rank + 1 — o nível 2 é o rank 1. Quem decide de verdade é o
// servidor; o painel só não pode dizer "não" a quem ele deixa entrar. Exigia
// L3+AM ("Requer Nível 3+", e no title "maior que 3"), sem staff, e o mesmo L2+AM
// que via o botão travado entrava pela ponte (auditoria da rodada 6, R66-1).
const RANK_MINIMO = 1;                 // o `MIN_RANK_WAZE` do servidor
const NIVEL_MINIMO = RANK_MINIMO + 1;  // o que a tela mostra
function podeEntrarNoApp(rank, isAM, isStaff) {
    if (isStaff) return true;
    const r = Number.isInteger(rank) ? rank : (rank != null ? parseInt(rank, 10) : -1);
    return r >= RANK_MINIMO && !!isAM;
}

// O painel roda DENTRO do www.waze.com — `location.origin` aqui não é o do
// app. Duplicado do `API_BASE` do background.js de propósito (são scripts
// isolados; mudou lá, muda aqui também).
const APP_BASE = 'https://places.wazebrasil.com';

// O nível mínimo vem da constante do portão, nunca escrito à mão em 4 línguas.
function comNivel(frase, nivel = NIVEL_MINIMO) {
    return String(frase).replace(/\{nivel\}/g, String(nivel));
}

// A frase do alerta sai do dicionário DESTE painel, na língua do WME (`t`,
// passado pelo chamador). Ia o `error` cru — a frase do servidor, sempre em
// português, ou a do próprio background —, e no cookie vencido ela mandava
// "exportar os cookies", que não é o caminho de quem entra pela extensão
// (auditoria da rodada 6, R66-2). O background repassa a CHAVE e a categoria
// que o servidor mandou; a frase crua fica no FIM da cadeia, pra resposta que
// não traz nenhuma das duas.
function fraseDoErro(r, t) {
    if (r.semLogin) return t.erroSemLogin;
    if (r.negado || r.errorCategory === 'access_denied') {
        const n = r.errorVars && Number.isInteger(r.errorVars.minLevel) && r.errorVars.minLevel > 0
            ? r.errorVars.minLevel : NIVEL_MINIMO;
        return comNivel(t.erroNegado, n);
    }
    if (r.errorKey === 'ext.conexao') return t.erroConexao;
    if (r.errorCategory === 'transient' || r.errorCategory === 'unknown') return t.erroWaze;
    if (r.errorKey) return t.erroGenerico;
    return r.error || t.erroGenerico;
}

// O ACESSAR fica TRAVADO enquanto loga (auditoria da rodada 7, R7-1-06). Cada
// toque é um `abrirPlaces`: uma ida ao /Session do Waze no nome da pessoa, uma
// sessão nova no servidor e uma aba nova do app — e o toque duplo abria duas
// abas, com duas sessões da mesma conta (MEDIDO com a extensão de verdade). Ele
// volta em QUALQUER desfecho: a resposta do background (deu certo ou não), o
// `lastError` (o service worker não respondeu), o `sendMessage` que lança (a
// extensão se atualizou com o WME aberto) e este TETO, pra resposta que nunca
// chega — MEDIDO com o servidor pendurado: o Chrome não derruba o service
// worker, e o botão ficava em "LOGANDO..." pra sempre, sem aviso. O teto é o
// mesmo que o app espera por uma resposta do servidor.
//
// O teto se compara com o PIOR caso do login INTEIRO, e não com uma ida só
// (auditoria da rodada 8, R8-6-01 = R8-1-02). Esta conta dizia "maior que os
// 30 s do servidor pro Waze", mas o background repete o login em toda falha
// passageira: até 4 idas e 4,6 s de espera entre elas, 124,6 s sem prazo. O
// login lento abria a aba DEPOIS do aviso de que a extensão não respondeu, e o
// "tente de novo" abria a segunda. Hoje o login do botão tem um prazo TOTAL,
// contado deste toque (`PRAZO_DO_BOTAO_MS`, 40 s, no background.js): nenhuma ida
// começa depois dele, a que está no ar é cancelada e a resposta atrasada não
// abre aba. O background responde até lá, e o botão volta com o aviso do que
// aconteceu; este teto, acima do prazo, só pega a extensão que não responde
// nada — e aí não há login no ar pra abrir aba depois do "tente de novo".
const ESPERA_DO_BOTAO_MS = 45000;

const s = document.createElement('script');
s.src = chrome.runtime.getURL('inject.js');
s.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(s);

function createAGInterface(userName, level, isAM, language = 'en', rank, isStaff) {
    if (document.getElementById('sidepanel-ag-tool')) return;

//----------- monta a aba
    function initCustomTab() {
        const tabList = document.querySelector('#sidebar ul.nav-tabs');
        const tabContent = document.querySelector('#sidebar .tab-content');

        if (!tabList || !tabContent) return null;

        const newTabHead = document.createElement('li');
        newTabHead.id = 'tab-ag-tool';
        
        //----------- inicia o icone
        const iconUrl = chrome.runtime.getURL('icone48.png');
        
        newTabHead.innerHTML = `
            <a href="#sidepanel-ag-tool" data-toggle="tab" title="WME AG Tool" style="padding: 10px 12px; display: flex; align-items: center; justify-content: center;">
                <img src="${iconUrl}" alt="Waze Places" style="width: 20px; height: 20px; object-fit: contain;">
            </a>`;

        const newTabPane = document.createElement('div');
        newTabPane.id = 'sidepanel-ag-tool';
        newTabPane.className = 'tab-pane'; //-------------- bootstrap do WME
        newTabPane.style.cssText = `
            padding: 15px 10px;
            font-family: sans-serif;
        `;

        tabList.appendChild(newTabHead);
        tabContent.appendChild(newTabPane);

        return newTabPane;
    }

    const container = document.createElement('div');
    container.style.cssText = `
        background: #f8f9fa;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 15px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    `;

//----------- i18n
    const translations = {
        'pt-BR': {
            title: 'ACESSO RÁPIDO AO WAZE PLACES',
            user: 'Usuário:',
            level: 'Nível:',
            am: 'AM:',
            accessBtn: 'ACESSAR',
            loggingBtn: 'LOGANDO...',
            errorLogin: 'Falha no login automático:\n',
            erroSemLogin: 'O seu login no WME não foi encontrado. Recarregue esta página (ou entre de novo no WME) e tente outra vez.',
            erroNegado: 'O Waze Places é restrito a editores Area Manager de Nível {nivel}+ ou Staff.',
            erroWaze: 'O Waze não respondeu como esperado. Tente de novo em instantes.',
            erroConexao: 'Não foi possível falar com o Waze Places. Confira a conexão e tente de novo.',
            erroExtensao: 'A extensão não respondeu. Recarregue esta página e tente de novo.',
            erroGenerico: 'Algo deu errado. Tente de novo em instantes.',
            reqLevel: 'Requer Nível {nivel}+ e ser Area Manager (AM), ou ser Staff.',
            reqLevelShort: 'Requer Nível {nivel}+ e AM, ou Staff',
            info1: "Se o login automático falhar (por exemplo, com o seu login no WME expirado), um aviso diz o que fazer.",
            info2: "Após acessar o Waze Places, clique no filtro (ícone de funil) para configurar o seu Estado e Área",
            infoBox: "No momento, esta função está disponível apenas para usuários Nível {nivel}+ com Area Manager, ou Staff.\nA extensão fará o login automático no WAZE PLACES utilizando o seu cookie (sem a necessidade de extensões adicionais ou de copiar/colar o cookie).",
            version: "Versão",
            by: "by",
            mostrarQrBtn: 'Mostrar QR para o celular',
            gerando: 'Gerando o código…',
            valePor: 'Vale por mais {time}',
            vencido: 'Código expirado',
            gerarOutro: 'Gerar outro código',
            passo1: 'Abra a câmera do celular e aponte para o código.',
            passo2: 'Toque no link que aparecer: você já entra conectado.',
            passo3: 'Adicione o app à tela inicial para abri-lo como um app.',
            semCamera: 'Sem câmera? Mostrar um código',
            digiteCodigo: 'Digite este código no celular:',
            continuarComputador: 'Continuar neste computador',
            yes: "Sim",
            no: "Não"
        },
        'en': {
            title: 'RAPID ACCESS TO WAZE PLACES',
            user: 'User:',
            level: 'Level:',
            am: 'AM:',
            accessBtn: 'ACCESS',
            loggingBtn: 'LOGGING IN...',
            errorLogin: 'Auto login failed:\n',
            erroSemLogin: "Couldn't find your WME login. Reload this page (or sign in to WME again) and try once more.",
            erroNegado: 'Waze Places is restricted to Area Manager editors at Level {nivel}+ or Staff.',
            erroWaze: "Waze didn't answer as expected. Try again in a moment.",
            erroConexao: "Couldn't reach Waze Places. Check your connection and try again.",
            erroExtensao: "The extension didn't respond. Reload this page and try again.",
            erroGenerico: 'Something went wrong. Try again in a moment.',
            reqLevel: 'Requires Level {nivel}+ and Area Manager (AM), or Staff.',
            reqLevelShort: 'Requires Level {nivel}+ and AM, or Staff',
            info1: "If the auto login fails (for example, when your WME login has expired), a message tells you what to do.",
            info2: "After accessing Waze Places, click on the filter (funnel icon) to set up your State and Area",
            infoBox: "Currently, this function is only available to Level {nivel}+ users with Area Manager, or Staff.\nThe extension will automatically log in to WAZE PLACES using your cookie (without the need for extra extensions or copying/pasting the cookie).",
            version: "Version",
            by: "by",
            mostrarQrBtn: 'Show QR code for my phone',
            gerando: 'Generating the code…',
            valePor: 'Valid for {time} more',
            vencido: 'Code expired',
            gerarOutro: 'Generate another code',
            passo1: 'Open your phone’s camera and point it at the code.',
            passo2: 'Tap the link that appears: you get in already signed in.',
            passo3: 'Add the app to your home screen to open it like an app.',
            semCamera: 'No camera? Show a code',
            digiteCodigo: 'Enter this code on your phone:',
            continuarComputador: 'Continue on this computer',
            yes: "Yes",
            no: "No"
        },
        'es': {
            title: 'ACCESO RÁPIDO A WAZE PLACES',
            user: 'Usuario:',
            level: 'Nivel:',
            am: 'AM:',
            accessBtn: 'ACCEDER',
            loggingBtn: 'INICIANDO SESIÓN...',
            errorLogin: 'Fallo en el inicio de sesión automático:\n',
            erroSemLogin: 'No se encontró su inicio de sesión en el WME. Recargue esta página (o vuelva a entrar en el WME) e inténtelo de nuevo.',
            erroNegado: 'Waze Places está restringido a editores Area Manager de Nivel {nivel}+ o Staff.',
            erroWaze: 'Waze no respondió como se esperaba. Inténtelo de nuevo en unos instantes.',
            erroConexao: 'No se pudo conectar con Waze Places. Revise la conexión e inténtelo de nuevo.',
            erroExtensao: 'La extensión no respondió. Recargue esta página e inténtelo de nuevo.',
            erroGenerico: 'Algo salió mal. Inténtelo de nuevo en unos instantes.',
            reqLevel: 'Requiere Nivel {nivel}+ y ser Area Manager (AM), o ser Staff.',
            reqLevelShort: 'Requiere Nivel {nivel}+ y AM, o Staff',
            info1: "Si falla el inicio de sesión automático (por ejemplo, si su sesión del WME expiró), un aviso le indica qué hacer.",
            info2: "Después de acceder a Waze Places, haga clic en el filtro (icono de embudo) para configurar su Estado y Área",
            infoBox: "Actualmente, esta función solo está disponible para usuarios Nivel {nivel}+ con Area Manager, o Staff.\nLa extensión iniciará sesión automáticamente en WAZE PLACES utilizando su cookie (sin necesidad de extensiones adicionales ni de copiar/pegar la cookie).",
            version: "Versión",
            by: "por",
            mostrarQrBtn: 'Mostrar QR para el teléfono',
            gerando: 'Generando el código…',
            valePor: 'Vale por {time} más',
            vencido: 'Código vencido',
            gerarOutro: 'Generar otro código',
            passo1: 'Abre la cámara del teléfono y apunta al código.',
            passo2: 'Toca el enlace que aparezca: entras ya conectado.',
            passo3: 'Añade la app a la pantalla de inicio para abrirla como una app.',
            semCamera: '¿Sin cámara? Mostrar un código',
            digiteCodigo: 'Escribe este código en el teléfono:',
            continuarComputador: 'Continuar en esta computadora',
            yes: "Sí",
            no: "No"
        },
        'fr': {
            title: 'ACCÈS RAPIDE À WAZE PLACES',
            user: 'Utilisateur:',
            level: 'Niveau:',
            am: 'AM:',
            accessBtn: 'ACCÉDER',
            loggingBtn: 'CONNEXION...',
            errorLogin: 'Échec de la connexion automatique :\n',
            erroSemLogin: 'Impossible de trouver votre connexion au WME. Rechargez cette page (ou reconnectez-vous au WME) et réessayez.',
            erroNegado: 'Waze Places est réservé aux éditeurs Area Manager de niveau {nivel}+ ou Staff.',
            erroWaze: "Waze n'a pas répondu comme prévu. Réessayez dans un instant.",
            erroConexao: 'Impossible de joindre Waze Places. Vérifiez votre connexion et réessayez.',
            erroExtensao: "L'extension n'a pas répondu. Rechargez cette page et réessayez.",
            erroGenerico: "Une erreur s'est produite. Réessayez dans un instant.",
            reqLevel: 'Nécessite le niveau {nivel}+ et d\'être Area Manager (AM), ou d\'être Staff.',
            reqLevelShort: 'Nécessite Niveau {nivel}+ et AM, ou Staff',
            info1: "Si la connexion automatique échoue (par exemple, si votre connexion au WME a expiré), un message vous indique quoi faire.",
            info2: "Après avoir accédé à Waze Places, cliquez sur le filtre (icône en entonnoir) pour configurer votre État et votre Zone",
            infoBox: "Pour le moment, cette fonction n'est disponible que pour les utilisateurs de niveau {nivel}+ avec Area Manager, ou Staff.\nL'extension se connectera automatiquement à WAZE PLACES en utilisant votre cookie (sans avoir besoin d'extensions supplémentaires ou de copier/coller le cookie).",
            version: "Version",
            by: "par",
            mostrarQrBtn: 'Afficher le QR pour le téléphone',
            gerando: 'Génération du code…',
            valePor: 'Valable encore {time}',
            vencido: 'Code expiré',
            gerarOutro: 'Générer un autre code',
            passo1: 'Ouvrez l’appareil photo du téléphone et pointez-le vers le code.',
            passo2: 'Touchez le lien qui s’affiche : vous arrivez déjà connecté.',
            passo3: 'Ajoutez l’appli à l’écran d’accueil pour l’ouvrir comme une appli.',
            semCamera: 'Pas de caméra ? Afficher un code',
            digiteCodigo: 'Saisissez ce code sur le téléphone :',
            continuarComputador: 'Continuer sur cet ordinateur',
            yes: "Oui",
            no: "Non"
        }
    };
    
    // Fallback robusto para garantir o idioma inglês como padrão
    let langKey = 'en';
    if (language) {
        if (translations[language]) {
            langKey = language;
        } else if (language.startsWith('pt')) {
            langKey = 'pt-BR';
        } else {
            const baseLang = language.split('-')[0];
            if (translations[baseLang]) {
                langKey = baseLang;
            }
        }
    }
    
    const t = translations[langKey];

//----------- titulo aba
    const title = document.createElement('h4');
    title.innerText = t.title;
    title.style.cssText = 'margin: 0; font-size: 15px; font-weight: bold; color: #222; text-align: center;';
    container.appendChild(title);

    // `isAM` já chega BOOLEANO: o `inject.js` normaliza antes de mandar pro painel
    // (`Boolean(isAM && isAM !== 'Não' && ...)`). O `=== 'true'` fica como reserva pra
    // string (nunca viu um caso real); `=== 'Sim'` era resíduo do daflash v0.0.3, de
    // antes de o `inject.js` normalizar — código morto: nunca pôde ser verdadeiro.
    const isAMBoolean = (isAM === true || isAM === 'true');
    const amText = isAMBoolean ? t.yes : t.no;

    const info = document.createElement('span');
    info.style.fontSize = '13px';
    info.style.textAlign = 'center';
    info.style.color = '#555';
    info.style.lineHeight = '1.4';
    info.innerHTML = `${t.user} <b style="color: #007bff;">${userName}</b><br>${t.level} <b>${level}</b> | ${t.am} <b>${amText}</b>`;
    container.appendChild(info);

//------------- regra de acesso: a do servidor (ver `podeEntrarNoApp`)
    const canAccess = podeEntrarNoApp(rank, isAMBoolean, isStaff === true || isStaff === 'true');

    if (canAccess) {
        container.appendChild(montarAreaDePareamento(t, comNivel));
    } else {
// -------------- botao NO
        const btn = document.createElement('button');
        btn.innerText = t.accessBtn;
        btn.style.cssText = `
            background: #cccccc; border: none; color: #666666; font-weight: bold;
            padding: 10px 15px; border-radius: 20px; cursor: not-allowed;
            font-size: 13px; width: 100%; font-family: sans-serif;
            display: flex; justify-content: center; align-items: center; text-align: center; box-sizing: border-box;
        `;
        btn.disabled = true;
        btn.title = comNivel(t.reqLevel);

// -------------- botao erro
        const aviso = document.createElement('span');
        aviso.style.fontSize = '11px';
        aviso.style.color = '#d93025';
        aviso.style.textAlign = 'center';
        aviso.style.fontWeight = 'bold';
        aviso.innerText = comNivel(t.reqLevelShort);
        container.appendChild(aviso);
        container.appendChild(btn);
    }

    const infoBox = document.createElement('div');
    infoBox.style.cssText = `
        background: #e9ecef;
        border: 1px solid #ced4da;
        border-radius: 6px;
        padding: 10px;
        font-size: 13px;
        color: #495057;
        text-align: left;
        width: 100%;
        box-sizing: border-box;
        margin-top: 5px;
        line-height: 1.3;
    `;
    const infoNews = document.createElement('div');
    infoNews.style.cssText = `
        background: #e9ecef;
        border: 1px solid #ced4da;
        border-radius: 6px;
        padding: 10px;
        font-size: 12px;
        color: #ba1b1b;
        text-align: left;
        width: 100%;
        box-sizing: border-box;
        margin-top: 5px;
        line-height: 1.3;
    `;
    
    const funilIcon = chrome.runtime.getURL('filtro.png');
    const nullIcon = chrome.runtime.getURL('null.png');
    
    infoNews.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 8px;">
            <img src="${nullIcon}" alt="dot" style="width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px;">
            <span>${t.info1}</span>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 8px;">
            <img src="${funilIcon}" alt="Filtro" style="width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px;">
            <span>${t.info2}</span>
        </div>
    `;
    container.appendChild(infoNews);
    
    infoBox.innerText = comNivel(t.infoBox);
    container.appendChild(infoBox);

// -------------- VERSÃO DA EXTENSÃO (NOVO)
    const versionBox = document.createElement('div');
    versionBox.style.cssText = `
        font-size: 11px;
        color: #888;
        text-align: center;
        width: 100%;
        margin-top: 4px;
        font-family: sans-serif;
    `;
    // Puxa a versão de forma dinâmica do manifest.json
    const extVersion = chrome.runtime.getManifest().version;
    versionBox.innerText = `${t.version} ${extVersion} | ${t.by} daflash`;
    container.appendChild(versionBox);

//----------- Executa a injeção aguardando o carregamento dinâmico da interface do WME
    function tryInject() {
        const targetPane = initCustomTab();
        if (targetPane) {
            targetPane.appendChild(container);
            return true;
        }
        return false;
    }

    function injectFloatingFallback() {
        if (document.getElementById('sidepanel-ag-tool-floating')) return;
        const floatingPane = document.createElement('div');
        floatingPane.id = 'sidepanel-ag-tool-floating';
        floatingPane.style.cssText = `
            position: absolute;
            top: 70px;
            right: 20px;
            z-index: 9999;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            padding: 5px;
            width: 320px;
            max-height: calc(100vh - 100px);
            overflow-y: auto;
        `;
        
        const closeBtn = document.createElement('button');
        closeBtn.innerText = 'X';
        closeBtn.style.cssText = `
            position: absolute; right: 5px; top: 5px; background: none; border: none; font-weight: bold; cursor: pointer; color: #888;
        `;
        closeBtn.onclick = () => floatingPane.style.display = 'none';
        
        floatingPane.appendChild(closeBtn);
        floatingPane.appendChild(container);
        document.body.appendChild(floatingPane);
    }

    // Se o painel de abas ainda não existir na tela, monitora o DOM até ele carregar
    if (!tryInject()) {
        const observer = new MutationObserver((mutations, obs) => {
            if (tryInject()) {
                obs.disconnect(); // Interrompe o monitoramento assim que injeta com sucesso
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Timeout de 5s: se as abas não aparecerem (WME novo), usa o painel flutuante
        setTimeout(() => {
            if (!document.getElementById('sidepanel-ag-tool')) {
                observer.disconnect();
                injectFloatingFallback();
            }
        }, 5000);
    }
}

// Injeta a `@keyframes` do spinner UMA vez (CSS inline não define keyframe;
// a propriedade `animation` pode ficar inline, mas a regra tem que existir
// nalguma folha de estilo do documento).
function injetarEstiloSpinner() {
    if (document.getElementById('ag-estilo-spinner')) return;
    const style = document.createElement('style');
    style.id = 'ag-estilo-spinner';
    style.textContent = '@keyframes ag-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
}

// Desenha o QR de verdade (mesmo algoritmo do app, `qr.js` — ver o comentário
// no topo do arquivo). QUIET=4 é a margem exigida pela norma; a escala é a
// maior que cabe em ~180px de lado.
function desenharQrNoPainel(canvas, url) {
    const qr = window.gerarQR(url);
    if (!qr) return false;
    const QUIET = 4;
    const lado = qr.tamanho + QUIET * 2;
    const escala = Math.max(2, Math.floor(180 / lado));
    const px = lado * escala;
    canvas.width = px; canvas.height = px;
    canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#0f172a';
    for (let l = 0; l < qr.tamanho; l++) {
        for (let c = 0; c < qr.tamanho; c++) {
            if (qr.modulos[l][c]) ctx.fillRect((c + QUIET) * escala, (l + QUIET) * escala, escala, escala);
        }
    }
    return true;
}

// A área de pareamento: no lugar do ACESSAR, pede e desenha o QR direto no
// painel do WME, sem abrir aba — a extensão só existe no WME porque é lá que
// o cookie do Waze vive, não porque a pessoa quer triar no computador (decisão
// do dono). "Continuar neste computador" é o único caminho que ainda abre a
// aba de hoje, pra quem (dev/teste) quer usar ali mesmo.
//
// Nenhuma chamada sai sozinha: o primeiro pedido só vai ao toque em "Mostrar
// QR" (mesmo princípio do app — nada de chamada sem gesto explícito).
function montarAreaDePareamento(t, comNivel) {
    injetarEstiloSpinner();
    const area = document.createElement('div');
    area.style.cssText = 'width:100%; display:flex; flex-direction:column; align-items:center; gap:10px;';

    let tickerQr = null;
    let tickerCodigo = null;
    let codigoAtual = null;   // o código do QR atual — "Continuar" cancela, se ainda valer
    let pedindo = false;

    function pararTickers() {
        if (tickerQr) { clearInterval(tickerQr); tickerQr = null; }
        if (tickerCodigo) { clearInterval(tickerCodigo); tickerCodigo = null; }
    }

    // Um ticker por elemento (o QR e o código de 6 correm juntos, com prazos
    // próprios — são registros DIFERENTES no servidor, ver `server/core.mjs`).
    function iniciarTicker(elemento, segundos, aoVencer) {
        const venceEm = Date.now() + segundos * 1000;
        let id = null;
        const tick = () => {
            const restante = Math.ceil((venceEm - Date.now()) / 1000);
            if (restante <= 0) {
                elemento.textContent = t.vencido;
                clearInterval(id);
                if (aoVencer) aoVencer();
                return;
            }
            const m = Math.floor(restante / 60);
            const seg = String(restante % 60).padStart(2, '0');
            elemento.textContent = t.valePor.replace('{time}', m + ':' + seg);
        };
        tick();
        id = setInterval(tick, 1000);
        return id;
    }

    function botaoPrimario(texto) {
        const btn = document.createElement('button');
        btn.innerText = texto;
        btn.style.cssText = `
            background: #33ccff; border: none; color: black; font-weight: bold;
            padding: 10px 15px; border-radius: 5px; cursor: pointer;
            font-size: 13px; width: 100%; transition: 0.3s; font-family: sans-serif;
            display: flex; justify-content: center; align-items: center; text-align: center; box-sizing: border-box;
        `;
        return btn;
    }

    function linkContinuar() {
        const rodape = document.createElement('div');
        rodape.style.cssText = 'width:100%; border-top:1px solid #e3e3e3; margin-top:4px; padding-top:8px; text-align:center;';
        const btn = document.createElement('button');
        btn.innerText = t.continuarComputador;
        btn.style.cssText = 'font-size:11.5px; color:#888; text-decoration:underline; background:none; border:none; cursor:pointer; padding:2px; font-family:sans-serif;';
        btn.addEventListener('click', () => abrirNesteComputador(btn));
        rodape.appendChild(btn);
        return rodape;
    }

    // O caminho de hoje (abre a aba), agora no rodapé — pra quem (dev/teste)
    // quer usar o app ali mesmo. Mesma lógica de sempre: um login por vez, com
    // teto, devolvendo o botão em qualquer desfecho.
    function abrirNesteComputador(btn) {
        if (btn.disabled) return;
        btn.disabled = true;
        const original = btn.innerText;
        btn.innerText = t.loggingBtn;

        // O código ainda na tela não serve mais pra ninguém: fecha a janela da
        // credencial em vez de deixar vencer sozinho (melhor esforço — sem
        // resposta, vence em 5 min do mesmo jeito).
        if (codigoAtual) {
            try { chrome.runtime.sendMessage({ action: 'cancelarPareamento', code: codigoAtual }); } catch (e) { /* ok */ }
        }

        let terminou = false;
        let teto = null;
        const terminar = () => {
            if (terminou) return false;
            terminou = true;
            clearTimeout(teto);
            btn.disabled = false;
            btn.innerText = original;
            return true;
        };
        teto = setTimeout(() => {
            if (terminar()) alert(t.errorLogin + t.erroExtensao);
        }, ESPERA_DO_BOTAO_MS);

        try {
            chrome.runtime.sendMessage({ action: 'abrirPlaces', desde: Date.now() }, (response) => {
                const semResposta = chrome.runtime.lastError;
                if (!terminar()) return;
                if (semResposta) alert(t.errorLogin + t.erroExtensao);
                else if (response && response.success !== true) alert(t.errorLogin + fraseDoErro(response, t));
            });
        } catch (e) {
            if (terminar()) alert(t.errorLogin + t.erroExtensao);
        }
    }

    function passosEl() {
        const passos = document.createElement('ol');
        passos.style.cssText = 'list-style:none; margin:4px 0 0; padding:0; width:100%; display:flex; flex-direction:column; gap:7px;';
        [t.passo1, t.passo2, t.passo3].forEach((txt, i) => {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex; gap:8px; font-size:12.5px; color:#333; line-height:1.35;';
            const n = document.createElement('span');
            n.style.cssText = 'flex-shrink:0; width:18px; height:18px; border-radius:50%; background:#33ccff; color:#003a4d; font-size:11px; font-weight:bold; display:flex; align-items:center; justify-content:center;';
            n.textContent = String(i + 1);
            const span = document.createElement('span');
            span.textContent = txt;
            li.append(n, span);
            passos.appendChild(li);
        });
        return passos;
    }

    function mostrarBotaoInicial() {
        pararTickers();
        codigoAtual = null;
        area.innerHTML = '';
        const btn = botaoPrimario(t.mostrarQrBtn);
        btn.addEventListener('click', () => { if (!btn.disabled) pedirQr(); });
        area.appendChild(btn);
    }

    function mostrarCarregando() {
        pararTickers();
        area.innerHTML = '';
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 0;width:100%;';
        const sp = document.createElement('div');
        sp.style.cssText = 'width:28px;height:28px;border-radius:50%;border:3px solid #e0e0e0;border-top-color:#33ccff;animation:ag-spin 0.8s linear infinite;';
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:12px;color:#888;';
        lbl.textContent = t.gerando;
        box.append(sp, lbl);
        area.appendChild(box);
    }

    function mostrarErro(mensagem) {
        pararTickers();
        codigoAtual = null;
        area.innerHTML = '';
        const msg = document.createElement('div');
        msg.style.cssText = 'font-size:12px; color:#d93025; text-align:center; font-weight:bold;';
        msg.textContent = mensagem;
        area.appendChild(msg);
        const btn = botaoPrimario(t.gerarOutro);
        btn.addEventListener('click', pedirQr);
        area.appendChild(btn);
        area.appendChild(linkContinuar());
    }

    function mostrarVencido() {
        pararTickers();
        codigoAtual = null;
        area.innerHTML = '';
        const msg = document.createElement('div');
        msg.style.cssText = 'font-size:13px; color:#d93025; font-weight:bold; text-align:center; padding:4px 0;';
        msg.textContent = t.vencido;
        area.appendChild(msg);
        const btn = botaoPrimario(t.gerarOutro);
        btn.addEventListener('click', pedirQr);
        area.appendChild(btn);
        area.appendChild(linkContinuar());
    }

    // "Sem câmera?" — o código CURTO é um registro SEPARADO e mais fraco (6
    // chars, ~30 bits), criado só quando pedido: se existisse sempre, um
    // vazamento traria a cópia fraca ao lado da forte (ver `server/core.mjs`,
    // PAIR_SECRET_LEN × PAIR_CODE_LEN). Por isso é uma SEGUNDA chamada, nunca
    // parte da mesma resposta do QR.
    function pedirCodigoCurto(btn, qrCard) {
        if (btn.disabled) return;
        btn.disabled = true;
        try {
            chrome.runtime.sendMessage({ action: 'parear', comCodigo: true, desde: Date.now() }, (r) => {
                const semResposta = chrome.runtime.lastError;
                if (semResposta || !r || !r.success || !r.code) {
                    btn.disabled = false;
                    alert(t.errorLogin + (semResposta ? t.erroExtensao : fraseDoErro(r || {}, t)));
                    return;
                }
                btn.remove();   // não dá pra pedir de novo até este vencer (como no app)
                const codeBox = document.createElement('div');
                codeBox.style.cssText = 'width:100%; box-sizing:border-box; background:#f8fbfc; border:2px dashed #7fd6ee; border-radius:14px; padding:14px 0; text-align:center;';
                const label = document.createElement('div');
                label.style.cssText = 'font-size:11px; color:#888; margin-bottom:6px;';
                label.textContent = t.digiteCodigo;
                const codigo = document.createElement('div');
                codigo.style.cssText = 'font-size:26px; font-weight:900; letter-spacing:0.22em; color:#0891b2; font-variant-numeric:tabular-nums;';
                codigo.textContent = r.code;
                const expiryEl = document.createElement('div');
                expiryEl.style.cssText = 'font-size:11px; color:#888; margin-top:6px;';
                codeBox.append(label, codigo, expiryEl);
                qrCard.insertAdjacentElement('afterend', codeBox);
                tickerCodigo = iniciarTicker(expiryEl, r.expiresIn, () => { codeBox.remove(); tickerCodigo = null; });
            });
        } catch (e) {
            btn.disabled = false;
            alert(t.errorLogin + t.erroExtensao);
        }
    }

    function mostrarQr(r) {
        pararTickers();
        area.innerHTML = '';
        codigoAtual = r.code;

        const qrCard = document.createElement('div');
        qrCard.style.cssText = 'background:#fff; border:1px solid #ddd; border-radius:10px; padding:10px; display:flex; flex-direction:column; align-items:center; gap:6px; width:100%; box-sizing:border-box;';
        const canvas = document.createElement('canvas');
        canvas.setAttribute('role', 'img');
        qrCard.appendChild(canvas);
        const expiry = document.createElement('div');
        expiry.style.cssText = 'font-size:11px; color:#888;';
        qrCard.appendChild(expiry);
        area.appendChild(qrCard);

        if (!desenharQrNoPainel(canvas, APP_BASE + '/#pair=' + r.code)) {
            mostrarErro(t.erroGenerico);
            return;
        }

        area.appendChild(passosEl());

        const semCameraBtn = document.createElement('button');
        semCameraBtn.innerText = t.semCamera;
        semCameraBtn.style.cssText = 'font-size:12px; color:#007bff; text-decoration:underline; background:none; border:none; cursor:pointer; padding:2px; font-family:sans-serif;';
        semCameraBtn.addEventListener('click', () => pedirCodigoCurto(semCameraBtn, qrCard));
        area.appendChild(semCameraBtn);

        area.appendChild(linkContinuar());

        tickerQr = iniciarTicker(expiry, r.expiresIn, mostrarVencido);
    }

    // Pede um QR novo (o botão inicial, ou "Gerar outro código" depois de
    // vencido ou de uma falha). Não renova sozinho — nada de polling.
    function pedirQr() {
        if (pedindo) return;
        pedindo = true;
        mostrarCarregando();
        try {
            chrome.runtime.sendMessage({ action: 'parear', desde: Date.now() }, (r) => {
                pedindo = false;
                const semResposta = chrome.runtime.lastError;
                if (semResposta) { mostrarErro(t.erroExtensao); return; }
                if (!r || !r.success || !r.code) { mostrarErro(fraseDoErro(r || {}, t)); return; }
                mostrarQr(r);
            });
        } catch (e) {
            pedindo = false;
            mostrarErro(t.erroExtensao);
        }
    }

    mostrarBotaoInicial();
    return area;
}