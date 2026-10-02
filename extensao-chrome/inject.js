// inject.js
(function() {
    console.log("AG Tool: Script de injeção iniciado, aguardando WME...");

    function checkWazeData() {
        //---------------------------verifica se ta logado
        if (typeof W !== 'undefined' && W.loginManager && W.loginManager.user) {
            
            const user = W.loginManager.user;
            // WME updates sometimes change Backbone models to standard objects
            const userName = user.userName || (user.getAttribute && user.getAttribute('userName'));
            const rank = user.rank !== undefined ? user.rank : (user.getAttribute && user.getAttribute('rank'));
            const isAM = user.isAreaManager !== undefined ? user.isAreaManager : (user.getAttribute && user.getAttribute('isAreaManager'));
            // O staff entra no app mesmo sem AM (o portão do servidor, `isUserAllowed`),
            // e o painel não sabia quem era staff: travava o botão dele (R66-1).
            const isStaff = user.isStaff !== undefined ? user.isStaff : (user.getAttribute && user.getAttribute('isStaff'));

            if (userName && rank !== undefined && rank !== null) {
                console.log("AG Tool: Dados do Waze encontrados! Enviando para a extensão...");
                
                // Envia os dados
                window.postMessage({
                    action: 'AG_WAZE_DATA',
                    userName: userName,
                    level: rank + 1,
                    // O rank CRU (o Waze conta do zero): é com ele que o servidor decide.
                    rank: rank,
                    isAM: Boolean(isAM && isAM !== 'Não' && isAM !== 'false' && isAM !== false),
                    isStaff: isStaff === true || isStaff === 'true',
                    language: (typeof I18n !== 'undefined' && I18n.locale) ? I18n.locale : navigator.language
                }, '*');
                
                //--------- wow deu certo
                return; 
            }
        }
        
        //--------- retry
        setTimeout(checkWazeData, 1000);
    }

    //--------- inicia verificação
    checkWazeData();
})();