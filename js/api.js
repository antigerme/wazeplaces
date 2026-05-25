const API = {
    baseUrl: '/api',
    sessionToken: null,
    region: 'row',
    countryId: 30,

    setSession(token) {
        this.sessionToken = token;
        if (token) {
            sessionStorage.setItem('waze_session_token', token);
        } else {
            sessionStorage.removeItem('waze_session_token');
        }
    },

    getSession() {
        if (!this.sessionToken) {
            this.sessionToken = sessionStorage.getItem('waze_session_token');
        }
        return this.sessionToken;
    },

    setRegion(region) {
        this.region = region || 'row';
        localStorage.setItem('waze_region', this.region);
    },

    getRegion() {
        const stored = localStorage.getItem('waze_region');
        if (stored) this.region = stored;
        return this.region;
    },

    setCountry(id) {
        this.countryId = parseInt(id, 10) || 30;
        localStorage.setItem('waze_country', this.countryId);
    },

    getCountry() {
        const stored = localStorage.getItem('waze_country');
        if (stored) this.countryId = parseInt(stored, 10) || 30;
        return this.countryId;
    },

    _workersChecked: false,

    _checkWorkers(response) {
        if (this._workersChecked) return;
        const workers = response.headers.get('X-Server-Workers');
        if (workers === null) return;
        this._workersChecked = true;
        if (parseInt(workers, 10) <= 1 && window.showWorkerWarning) {
            window.showWorkerWarning();
        }
    },

    async _post(endpoint, body) {
        try {
            const response = await fetch(`${this.baseUrl}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            this._checkWorkers(response);
            const data = await response.json();
            if (response.status === 401) {
                this.setSession(null);
            }
            return data;
        } catch (error) {
            console.error(`Erro em ${endpoint}:`, error);
            return { success: false, error: 'Erro de conexão' };
        }
    },

    async testCookies(cookies, region, countryId) {
        const result = await this._post('testar-cookies.php', {
            cookies,
            region: region || this.getRegion(),
            countryId: countryId || this.getCountry()
        });
        if (result.success && result.sessionToken) {
            this.setSession(result.sessionToken);
        }
        return result;
    },

    async fetchPlaces(page = 1, filters = {}) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: 'Sessão expirada' };
        }
        return this._post('buscar-places.php', {
            sessionToken,
            region: this.getRegion(),
            countryId: this.getCountry(),
            page,
            ...filters
        });
    },

    async markAsRead(venueID, updateRequestID) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: 'Sessão expirada' };
        }
        return this._post('marcar-lido.php', {
            sessionToken,
            region: this.getRegion(),
            venueID,
            updateRequestID
        });
    },

    async markAsReadBatch(items) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: 'Sessão expirada' };
        }
        return this._post('marcar-lido.php', {
            sessionToken,
            region: this.getRegion(),
            items
        });
    },

    async rejectPlace(venueID, updateRequestID) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: 'Sessão expirada' };
        }
        return this._post('validar-place.php', {
            sessionToken,
            region: this.getRegion(),
            venueID,
            updateRequestID
        });
    },

    async getProfile() {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: 'Sessão expirada' };
        }
        return this._post('perfil.php', {
            sessionToken,
            region: this.getRegion()
        });
    },

    async listCountries() {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: 'Sessão expirada' };
        }
        return this._post('lista-paises.php', {
            sessionToken,
            region: this.getRegion()
        });
    },

    async listStates(countryId) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: 'Sessão expirada' };
        }
        return this._post('lista-estados.php', {
            sessionToken,
            region: this.getRegion(),
            countryId: parseInt(countryId, 10)
        });
    },

    async destroySession() {
        const sessionToken = this.getSession();
        if (!sessionToken) return { success: true };
        const result = await this._post('sessao.php', {
            action: 'destroy',
            sessionToken
        });
        this.setSession(null);
        return result;
    }
};
