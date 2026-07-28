// localStorage pode lançar (modo privado, "bloquear todos os cookies") — nunca
// deixar isso derrubar o initApp. Wrapper tolerante a falha.
const safeLS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    remove(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

const API = {
    baseUrl: '/api',
    sessionToken: null,
    region: 'row',
    countryId: 30,

    setSession(token) {
        this.sessionToken = token;
        if (token) safeLS.set('waze_session_token', token);
        else safeLS.remove('waze_session_token');
    },

    getSession() {
        if (!this.sessionToken) {
            this.sessionToken = safeLS.get('waze_session_token');
            // Migração de versões anteriores que usavam sessionStorage (some ao fechar aba).
            if (!this.sessionToken) {
                try {
                    const legacy = sessionStorage.getItem('waze_session_token');
                    if (legacy) {
                        safeLS.set('waze_session_token', legacy);
                        sessionStorage.removeItem('waze_session_token');
                        this.sessionToken = legacy;
                    }
                } catch (e) {}
            }
        }
        return this.sessionToken;
    },

    setRegion(region) {
        this.region = region || 'row';
        safeLS.set('waze_region', this.region);
    },

    getRegion() {
        const stored = safeLS.get('waze_region');
        if (stored) this.region = stored;
        return this.region;
    },

    setCountry(id) {
        this.countryId = parseInt(id, 10) || 30;
        safeLS.set('waze_country', this.countryId);
    },

    getCountry() {
        const stored = safeLS.get('waze_country');
        if (stored) this.countryId = parseInt(stored, 10) || 30;
        return this.countryId;
    },

    // Ligado quando a página está saindo (pagehide / aba escondida). Fetch normal
    // é CANCELADO no unload — a ação sumia e o contador, já salvo, ficava mentindo.
    // Com `keepalive` o browser entrega a requisição mesmo depois de a página
    // morrer (limite de 64KB no corpo; os nossos são de ~100 bytes).
    saindo: false,
    setSaindo(v) { this.saindo = !!v; },

    async _post(endpoint, body) {
        // Timeout no lado browser→backend: sem isso um fetch pendurado deixava
        // AppState.fetching preso e o botão de refresh (com guard) mudo.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
        try {
            const response = await fetch(`${this.baseUrl}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                // AbortController + keepalive não combinam: um sinal que dispara
                // durante o unload mataria justamente o envio que queremos salvar.
                ...(this.saindo ? { keepalive: true } : { signal: controller.signal })
            });
            const data = await response.json();
            if (response.status === 401) {
                this.setSession(null);
            }
            return data;
        } catch (error) {
            console.error(`Erro em ${endpoint}:`, error);
            // Rede caiu / abortou por timeout / 5xx sem JSON → transient, pra a
            // política de retry (callWithRetry) atuar. Era o caso mais comum e
            // ficava sem categoria, então nunca era retentado.
            return { success: false, error: t('api.error.connection'), errorCategory: 'transient' };
        } finally {
            clearTimeout(timer);
        }
    },

    async testCookies(cookies, region, countryId) {
        const result = await this._post('testar-cookies', {
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
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('buscar-places', {
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
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('marcar-lido', {
            sessionToken,
            region: this.getRegion(),
            venueID,
            updateRequestID
        });
    },

    async markAsReadBatch(items) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('marcar-lido', {
            sessionToken,
            region: this.getRegion(),
            items
        });
    },

    async rejectPlace(venueID, updateRequestID) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('validar-place', {
            sessionToken,
            region: this.getRegion(),
            venueID,
            updateRequestID
        });
    },

    async getProfile() {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('perfil', {
            sessionToken,
            region: this.getRegion()
        });
    },

    async listCountries() {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('lista-paises', {
            sessionToken,
            region: this.getRegion()
        });
    },

    async listStates(countryId) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('lista-estados', {
            sessionToken,
            region: this.getRegion(),
            countryId: parseInt(countryId, 10)
        });
    },

    async destroySession() {
        const sessionToken = this.getSession();
        if (!sessionToken) return { success: true };
        const result = await this._post('sessao', {
            action: 'destroy',
            sessionToken
        });
        this.setSession(null);
        return result;
    },

    // Pareamento computador → celular. `criarPareamento` roda no aparelho que
    // JÁ está logado; `resgatarPareamento` no que quer entrar.
    async criarPareamento() {
        const sessionToken = this.getSession();
        if (!sessionToken) return { success: false, error: t('api.error.noSession') };
        return this._post('parear', { action: 'create', sessionToken });
    },

    async resgatarPareamento(code) {
        const result = await this._post('parear', { action: 'claim', code });
        // Sucesso = este aparelho passa a ter sessão própria (a do computador
        // segue viva; não é transferência, é uma segunda sessão).
        if (result.success && result.sessionToken) this.setSession(result.sessionToken);
        return result;
    }
};
