// API para comunicação com backend PHP
const API = {
    baseUrl: '/api',
    cookies: null,

    // Define cookies para todas as requisições
    setCookies(cookies) {
        this.cookies = cookies;
        sessionStorage.setItem('waze_cookies', cookies);
    },

    // Recupera cookies do sessionStorage
    getCookies() {
        if (!this.cookies) {
            this.cookies = sessionStorage.getItem('waze_cookies');
        }
        return this.cookies;
    },

    // Testa se os cookies são válidos
    async testCookies(cookies) {
        try {
            const response = await fetch(`${this.baseUrl}/testar-cookies.php`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ cookies })
            });

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Erro ao testar cookies:', error);
            return { success: false, error: 'Erro de conexão' };
        }
    },

    // Busca places pendentes
    async fetchPlaces(page = 1) {
        try {
            const cookies = this.getCookies();
            if (!cookies) {
                throw new Error('Cookies não encontrados');
            }

            const response = await fetch(`${this.baseUrl}/buscar-places.php`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ cookies, page })
            });

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Erro ao buscar places:', error);
            return { success: false, error: 'Erro de conexão' };
        }
    },

    // Marca place como lido
    async markAsRead(venueID, updateRequestID) {
        try {
            const cookies = this.getCookies();
            if (!cookies) {
                throw new Error('Cookies não encontrados');
            }

            const response = await fetch(`${this.baseUrl}/marcar-lido.php`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cookies,
                    venueID,
                    updateRequestID
                })
            });

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Erro ao marcar como lido:', error);
            return { success: false, error: 'Erro de conexão' };
        }
    },

    // Valida place (aprovar/rejeitar)
    async validatePlace(venueID, updateRequestID, approve) {
        try {
            const cookies = this.getCookies();
            if (!cookies) {
                throw new Error('Cookies não encontrados');
            }

            const response = await fetch(`${this.baseUrl}/validar-place.php`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cookies,
                    venueID,
                    updateRequestID,
                    approve
                })
            });

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Erro ao validar place:', error);
            return { success: false, error: 'Erro de conexão' };
        }
    }
};