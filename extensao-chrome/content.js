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
            accessWazePlacesBtn: 'Acessar o Waze Places',
            errorLogin: 'Falha no login automático:\n',
            erroSemLogin: 'O seu login no WME não foi encontrado. Recarregue esta página (ou entre de novo no WME) e tente outra vez.',
            erroNegado: 'O Waze Places é restrito a editores Area Manager de Nível {nivel}+ ou Staff.',
            erroWaze: 'O Waze não respondeu como esperado. Tente de novo em instantes.',
            erroConexao: 'Não foi possível falar com o Waze Places. Confira a conexão e tente de novo.',
            erroExtensao: 'A extensão não respondeu. Recarregue esta página e tente de novo.',
            erroGenerico: 'Algo deu errado. Tente de novo em instantes.',
            reqLevel: 'Requer Nível {nivel}+ e ser Area Manager (AM), ou ser Staff.',
            reqLevelShort: 'Requer Nível {nivel}+ e AM, ou Staff',
            info1: "Ao tentar acessar o Waze Places, o seu cookie pode estar expirado. Nesse caso, o botão ficará travado com o texto 'logando...'. Se isso ocorrer, recarregue a página e tente novamente.\n\n",
            info2: "Apos acessar o Waze Places clique no filtro ( icone de funil ) para configurar o seu Estado e Area",
            infoBox: "No momento, esta função está disponível apenas para usuários Nível {nivel}+ com Area Manager, ou Staff.\nA extensão fará o login automático no WAZE PLACES utilizando o seu cookie (sem a necessidade de extensões adicionais ou de copiar/colar o cookie).",
            version: "Versão",
            by: "by",
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
            accessWazePlacesBtn: 'Access Waze Places',
            errorLogin: 'Auto login failed:\n',
            erroSemLogin: "Couldn't find your WME login. Reload this page (or sign in to WME again) and try once more.",
            erroNegado: 'Waze Places is restricted to Area Manager editors at Level {nivel}+ or Staff.',
            erroWaze: "Waze didn't answer as expected. Try again in a moment.",
            erroConexao: "Couldn't reach Waze Places. Check your connection and try again.",
            erroExtensao: "The extension didn't respond. Reload this page and try again.",
            erroGenerico: 'Something went wrong. Try again in a moment.',
            reqLevel: 'Requires Level {nivel}+ and Area Manager (AM), or Staff.',
            reqLevelShort: 'Requires Level {nivel}+ and AM, or Staff',
            info1: "When trying to access Waze Places, your cookie might be expired. In this case, the button will get stuck with the text 'logging in...'. If this happens, reload the page and try again.\n\n",
            info2: "After accessing Waze Places, click on the filter (funnel icon) to set up your State and Area",
            infoBox: "Currently, this function is only available to Level {nivel}+ users with Area Manager, or Staff.\nThe extension will automatically log in to WAZE PLACES using your cookie (without the need for extra extensions or copying/pasting the cookie).",
            version: "Version",
            by: "by",
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
            accessWazePlacesBtn: 'Acceder a Waze Places',
            errorLogin: 'Fallo en el inicio de sesión automático:\n',
            erroSemLogin: 'No se encontró su inicio de sesión en el WME. Recargue esta página (o vuelva a entrar en el WME) e inténtelo de nuevo.',
            erroNegado: 'Waze Places está restringido a editores Area Manager de Nivel {nivel}+ o Staff.',
            erroWaze: 'Waze no respondió como se esperaba. Inténtelo de nuevo en unos instantes.',
            erroConexao: 'No se pudo conectar con Waze Places. Revise la conexión e inténtelo de nuevo.',
            erroExtensao: 'La extensión no respondió. Recargue esta página e inténtelo de nuevo.',
            erroGenerico: 'Algo salió mal. Inténtelo de nuevo en unos instantes.',
            reqLevel: 'Requiere Nivel {nivel}+ y ser Area Manager (AM), o ser Staff.',
            reqLevelShort: 'Requiere Nivel {nivel}+ y AM, o Staff',
            info1: "Al intentar acceder a Waze Places, su cookie puede haber expirado. En este caso, el botón se quedará atascado con el texto 'iniciando sesión...'. Si esto ocurre, recargue la página e inténtelo de nuevo.\n\n",
            info2: "Después de acceder a Waze Places, haga clic en el filtro (icono de embudo) para configurar su Estado y Área",
            infoBox: "Actualmente, esta función solo está disponible para usuarios Nivel {nivel}+ con Area Manager, o Staff.\nLa extensión iniciará sesión automáticamente en WAZE PLACES utilizando su cookie (sin necesidad de extensiones adicionales ni de copiar/pegar la cookie).",
            version: "Versión",
            by: "por",
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
            accessWazePlacesBtn: 'Accéder à Waze Places',
            errorLogin: 'Échec de la connexion automatique :\n',
            erroSemLogin: 'Impossible de trouver votre connexion au WME. Rechargez cette page (ou reconnectez-vous au WME) et réessayez.',
            erroNegado: 'Waze Places est réservé aux éditeurs Area Manager de niveau {nivel}+ ou Staff.',
            erroWaze: "Waze n'a pas répondu comme prévu. Réessayez dans un instant.",
            erroConexao: 'Impossible de joindre Waze Places. Vérifiez votre connexion et réessayez.',
            erroExtensao: "L'extension n'a pas répondu. Rechargez cette page et réessayez.",
            erroGenerico: "Une erreur s'est produite. Réessayez dans un instant.",
            reqLevel: 'Nécessite le niveau {nivel}+ et d\'être Area Manager (AM), ou d\'être Staff.',
            reqLevelShort: 'Nécessite Niveau {nivel}+ et AM, ou Staff',
            info1: "Lors de la tentative d'accès à Waze Places, votre cookie peut avoir expiré. Dans ce cas, le bouton restera bloqué avec le texte 'connexion...'. Si cela se produit, rechargez la page et réessayez.\n\n",
            info2: "Après avoir accédé à Waze Places, cliquez sur le filtre (icône en entonnoir) pour configurer votre État et votre Zone",
            infoBox: "Pour le moment, cette fonction n'est disponible que pour les utilisateurs de niveau {nivel}+ avec Area Manager, ou Staff.\nL'extension se connectera automatiquement à WAZE PLACES en utilisant votre cookie (sans avoir besoin d'extensions supplémentaires ou de copier/coller le cookie).",
            version: "Version",
            by: "par",
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
    // O nível mínimo vem da constante do portão, nunca escrito à mão em 4 línguas.
    const comNivel = (frase, nivel = NIVEL_MINIMO) => String(frase).replace(/\{nivel\}/g, String(nivel));

    // A frase do alerta sai do dicionário DESTE painel, na língua do WME. Ia o
    // `error` cru — a frase do servidor, sempre em português, ou a do próprio
    // background —, e no cookie vencido ela mandava "exportar os cookies", que não
    // é o caminho de quem entra pela extensão (auditoria da rodada 6, R66-2). O
    // background repassa a CHAVE e a categoria que o servidor mandou; a frase
    // crua fica no FIM da cadeia, pra resposta que não traz nenhuma das duas.
    function fraseDoErro(r) {
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

//----------- titulo aba
    const title = document.createElement('h4');
    title.innerText = t.title;
    title.style.cssText = 'margin: 0; font-size: 15px; font-weight: bold; color: #222; text-align: center;';
    container.appendChild(title);

    const isAMBoolean = (isAM === true || isAM === 'true' || isAM === 'Sim');
    const amText = isAMBoolean ? t.yes : t.no;

    const info = document.createElement('span');
    info.style.fontSize = '13px';
    info.style.textAlign = 'center';
    info.style.color = '#555';
    info.style.lineHeight = '1.4';
    info.innerHTML = `${t.user} <b style="color: #007bff;">${userName}</b><br>${t.level} <b>${level}</b> | ${t.am} <b>${amText}</b>`;
    container.appendChild(info);

    const btn = document.createElement('button');
    btn.innerText = t.accessBtn;
    
//------------- regra de acesso: a do servidor (ver `podeEntrarNoApp`)
    const canAccess = podeEntrarNoApp(rank, isAMBoolean, isStaff === true || isStaff === 'true');

    if (canAccess) {
//------------- botao OK
        btn.style.cssText = `
            background: #33ccff; border: none; color: black; font-weight: bold;
            padding: 10px 15px; border-radius: 5px; cursor: pointer;
            font-size: 13px; width: 100%; transition: 0.3s; font-family: sans-serif;
            display: flex; justify-content: center; align-items: center; text-align: center; box-sizing: border-box;
        `;
        
        btn.addEventListener('click', () => {
            btn.innerText = t.loggingBtn;
            btn.style.background = '#ffcc00';

            // "abrirPlaces" (era "getCookies"): o nome agora diz o que o botão
            // FAZ, e o background tem uma segunda ação ("autenticar") que a
            // ponte usa sem abrir aba. Dois nomes porque são dois fluxos.
            chrome.runtime.sendMessage({ action: "abrirPlaces" }, (response) => {
                btn.innerText = t.accessWazePlacesBtn;
                btn.style.background = '#33ccff';

                if (chrome.runtime.lastError) {
                    alert(t.errorLogin + t.erroExtensao);
                } else if (response && response.success !== true) {
                    alert(t.errorLogin + fraseDoErro(response));
                }
            });
        });
    } else {
// -------------- botao NO
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
    }

    container.appendChild(btn);

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