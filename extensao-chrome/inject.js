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

            if (userName && rank !== undefined && rank !== null) {
                console.log("AG Tool: Dados do Waze encontrados! Enviando para a extensão...");
                
                // Envia os dados
                window.postMessage({
                    action: 'AG_WAZE_DATA',
                    userName: userName,
                    level: rank + 1,
                    isAM: Boolean(isAM && isAM !== 'Não' && isAM !== 'false' && isAM !== false),
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