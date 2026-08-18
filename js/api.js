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
        if (!this.sessionToken) this.sessionToken = safeLS.get('waze_session_token');
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
            // NÃO apagar a sessão aqui. Um 401 chega por motivos que não são
            // "o editor precisa entrar de novo": o Waze devolve 403 em rajada
            // (WAF/limite) e o KV pode devolver vazio num blip. Apagar dentro
            // do transporte tomava a decisão ANTES de qualquer verificação e
            // sem chance de retry — era o caminho mais curto pro editor cair na
            // tela de login sem ter pedido pra sair. Quem decide é o
            // `handleUnauthorized`, que confirma antes de derrubar.
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

    // Aprova o pedido — a foto pendente passa a valer no mapa. É a MESMA chamada
    // do rejeitar com a flag invertida (confirmado num HAR do owner aprovando
    // no WME). Só é oferecido pra pedido de FOTO: ali não há campo pra ajustar,
    // então a decisão cabe inteira na tela, que é o que a regra de "nunca
    // aprova" existia pra proteger.
    async aprovarPedido(venueID, updateRequestID) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('validar-place', {
            sessionToken,
            region: this.getRegion(),
            venueID,
            updateRequestID,
            approve: true,
        });
    },

    // Exclui UMA foto do local. `lat`/`lon` não são enfeite: o servidor relê o
    // local antes de gravar e o Waze só lê por bbox — sem as coordenadas ele
    // não tem como buscar o venue de novo.
    // Aquece a releitura do local no servidor, pra ela não custar tempo depois
    // do "Excluir". Disparada quando o editor TOCA na lixeira: os ~700ms dela
    // correm enquanto ele lê a pergunta do diálogo.
    //
    // Melhor-esforço de propósito — se falhar, o `excluirFoto` relê na hora e a
    // pessoa só espera mais. Por isso nem espera resposta nem trata erro.
    prepararExclusao(venueID, lat, lon) {
        const sessionToken = this.getSession();
        if (!sessionToken) return;
        this._post('excluir-foto', {
            sessionToken, region: this.getRegion(), action: 'preparar',
            venueID, imageID: 'preparar', lat, lon,
        }).catch(() => {});
    },

    // Renomear o local. Escrita de dado de LOCAL — a única da app — e por isso
    // o `nome` vai CRU: quem apara é o servidor (`trim`, teto) e quem recusa de
    // verdade é o Waze, que valida permissão e lockRank na gravação.
    async renomearLocal(venueID, nome) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('renomear-local', {
            sessionToken, region: this.getRegion(), venueID, nome,
        });
    },

    async excluirFoto(venueID, imageID, lat, lon) {
        const sessionToken = this.getSession();
        if (!sessionToken) {
            return { success: false, error: t('api.error.noSession') };
        }
        return this._post('excluir-foto', {
            sessionToken,
            region: this.getRegion(),
            venueID,
            imageID,
            lat,
            lon
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

    // Aceita o token explicitamente porque o logout apaga o armazenamento local
    // ANTES de esperar a rede: a limpeza daqui é instantânea (é o que o editor
    // sente ao pedir pra sair) e a remota vira melhor-esforço com retentativa.
    // Sem o parâmetro, usa o token guardado e limpa como antes.
    async destroySession(tokenExplicito) {
        const sessionToken = tokenExplicito || this.getSession();
        if (!sessionToken) return { success: true };
        const result = await this._post('sessao', {
            action: 'destroy',
            sessionToken
        });
        if (!tokenExplicito) this.setSession(null);
        return result;
    },

    // Pareamento computador → celular. `criarPareamento` roda no aparelho que
    // JÁ está logado; `resgatarPareamento` no que quer entrar.
    // `comCodigo` pede o registro CURTO (6 chars, digitável) em vez do longo do
    // QR. São registros diferentes no servidor, com forças diferentes — ver
    // `derivarChave` no core. O padrão é o forte, de propósito.
    async criarPareamento({ comCodigo = false } = {}) {
        const sessionToken = this.getSession();
        if (!sessionToken) return { success: false, error: t('api.error.noSession') };
        return this._post('parear', { action: 'create', sessionToken, comCodigo });
    },

    async resgatarPareamento(code) {
        const result = await this._post('parear', { action: 'claim', code });
        // Sucesso = este aparelho passa a ter sessão própria (a do computador
        // segue viva; não é transferência, é uma segunda sessão).
        if (result.success && result.sessionToken) this.setSession(result.sessionToken);
        return result;
    }
};
