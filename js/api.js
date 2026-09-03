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

    // Registro das últimas chamadas, SÓ NA MEMÓRIA. Existe porque a pergunta que
    // mais custou tempo neste projeto foi "o que exatamente falhou no aparelho
    // dele?", e ela não tinha resposta: o toast conta o desfecho, não a
    // sequência. Sem isto, "conexão instável" e "falha ao carregar" na mesma
    // tela são dois fatos soltos, e eu passei horas encaixando hipótese.
    //
    // Guarda SEMPRE, não só com o modo dev ligado: o defeito acontece ANTES de
    // alguém abrir o diagnóstico, e anel que começa a gravar na hora do socorro
    // nasce vazio justo quando importa. Custo: 60 objetos pequenos em memória,
    // zero requisição, zero gravação no aparelho, e some ao fechar a app.
    //
    // NUNCA guarda o corpo enviado nem o recebido: o corpo leva o sessionToken
    // em toda chamada, e o recebido leva dado de terceiro (nome de quem mandou
    // o pedido). O que interessa pra depurar é a FORMA da falha.
    chamadas: [],

    // Cabeçalhos que interessam pra depurar, e SÓ eles. `cf-ray` diz qual
    // datacenter e qual execução respondeu; `cf-cache-status` diz se a BORDA
    // serviu cache (o modo de falha que atinge um aparelho e não o outro, e que
    // é invisível de qualquer outro jeito); `date` do servidor contra o relógio
    // do aparelho revela desvio de hora, que faz prazo e comparação de data
    // mentirem; `etag`/`age` fecham a conta de frescor.
    _CABECALHOS: ['cf-ray', 'cf-cache-status', 'date', 'age', 'etag', 'content-type', 'server'],

    // Teto do que os CORPOS ocupam no anel, somados. Sem ele, uma resposta de
    // `buscar-places` (326 KB medidos na produção) × várias chamadas vira
    // dezenas de MB na memória de um celular e um arquivo que ninguém manda.
    // Estoura → os corpos MAIS ANTIGOS saem; o registro deles fica.
    _TETO_CORPOS: 3 * 1024 * 1024,

    // O token vai no corpo de TODA chamada. Ele já está no arquivo uma vez (no
    // localStorage) e é lá que ele deve estar: repetir 60 vezes não acrescenta
    // segredo, só multiplica a chance de escapar num recorte de tela ou num
    // trecho colado. Redigido, o corpo continua 100% útil pra depurar (é ele que
    // diz QUAIS filtros foram enviados naquela chamada, e não no momento do
    // diagnóstico).
    _semSegredo(body) {
        try {
            const c = JSON.parse(JSON.stringify(body || {}));
            if (c.sessionToken) c.sessionToken = '[token — ver localStorage]';
            if (c.cookies) c.cookies = '[cookies do login — nunca guardados]';
            if (c.code) c.code = '[código de pareamento]';
            return c;
        } catch (e) { return '[não serializável]'; }
    },

    // Corpo de resposta só entra com o modo dev ATIVO — que é exatamente quem
    // está com problema e ligou pra reproduzir. Guardar sempre poria a fila
    // inteira (300 lugares, com o nome de quem enviou cada pedido) na memória de
    // todo mundo, o tempo todo, por um benefício que só o socorro usa.
    _guardaCorpo() {
        // `typeof AppState` e NÃO `window.AppState`: o `AppState` é `const` no
        // escopo global de um script clássico, o que cria binding LÉXICO e não
        // propriedade de `window` (gotcha #64, que já custou um "is not a
        // function" na cara do editor). Com `window.` isto devolvia `false`
        // SEMPRE, e o corpo nunca era guardado — falha silenciosa, encontrada
        // porque o teste exigia o corpo presente, não só ausente.
        try { return typeof AppState !== 'undefined' && !!(AppState.devMode && AppState.devMode.active); }
        catch (e) { return false; }
    },

    _registrar(endpoint, inicio, http, data, extra) {
        try {
            const reg = {
                t: new Date().toISOString(),
                rota: endpoint,
                ms: Math.round(performance.now() - inicio),
                http: http,
                ok: !!(data && data.success),
                errorKey: (data && data.errorKey) || null,
                errorCategory: (data && data.errorCategory) || null,
                // Quantos itens vieram, quando vierem: distingue "respondeu
                // vazio" de "respondeu com fila", que é a diferença entre
                // "Tudo limpo!" legítimo e falha.
                n: data && Array.isArray(data.places) ? data.places.length : undefined,
                ...(extra || {}),
            };
            this.chamadas.push(reg);
            if (this.chamadas.length > 60) this.chamadas.shift();
            this._podarCorpos();
        } catch (e) {}
    },

    // Solta os corpos mais antigos até caber no teto. Tira SÓ o corpo: o
    // registro (rota, http, erro, tempo) é barato e é o que conta a sequência —
    // perder a sequência pra caber o conteúdo seria trocar o essencial pelo
    // detalhe.
    _podarCorpos() {
        let total = 0;
        for (let i = this.chamadas.length - 1; i >= 0; i--) {
            const c = this.chamadas[i];
            if (c._bytes === undefined) continue;
            total += c._bytes;
            if (total > this._TETO_CORPOS) {
                delete c.corpoResposta;
                delete c._bytes;
                c.corpoPodado = true;
            }
        }
    },

    async _post(endpoint, body) {
        const _t0 = performance.now();
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
            // O STATUS e os CABEÇALHOS são lidos ANTES do `.json()`, e essa
            // ordem é o conserto de um buraco que custaria horas: corpo que não
            // é JSON (desafio do WAF da Cloudflare, 502 da borda, página de erro
            // do gateway) faz o `.json()` LANÇAR, e no `catch` a única coisa que
            // sobrava era `http: 0` — indistinguível de "o celular ficou sem
            // rede". A app roda atrás do Bot Fight Mode, então esse caso não é
            // hipotético: "a Cloudflare barrou o aparelho" e "o wifi piscou"
            // ficavam idênticos no diagnóstico.
            const http = response.status;
            const cab = {};
            for (const h of this._CABECALHOS) {
                const v = response.headers.get(h);
                if (v) cab[h] = v;
            }
            const bruto = await response.text();
            let data, naoEraJson = null;
            try {
                data = JSON.parse(bruto);
            } catch (e) {
                // Guarda o COMEÇO do corpo: é o que identifica um desafio do
                // WAF ou uma página de erro, e o que faria a diferença entre
                // investigar a infraestrutura e investigar o código.
                naoEraJson = bruto.slice(0, 600);
                throw new Error('resposta não é JSON (HTTP ' + http + ')');
            } finally {
                const guarda = this._guardaCorpo();
                const corpo = guarda ? bruto : null;
                this._registrar(endpoint, _t0, http, data, {
                    cab,
                    naoEraJson,
                    corpoReq: this._semSegredo(body),
                    ...(corpo !== null
                        ? { corpoResposta: corpo, _bytes: corpo.length }
                        : { corpoResposta: undefined }),
                });
            }
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
            // `http: 0` é a marca de "nem chegou a responder" — aborto por
            // timeout, rede caída, DNS. Sem distinguir isso de um 500, todo
            // problema de rede vira "erro do servidor" na análise.
            const falha = { success: false, error: t('api.error.connection'), errorCategory: 'transient',
                            _motivo: String((error && error.name) || error).slice(0, 60) };
            // Só registra aqui o que NÃO passou pelo `finally` do try — ou seja,
            // falha antes da resposta existir (rede, DNS, timeout). Corpo não
            // JSON já foi registrado lá com o status REAL; registrar de novo
            // sobrescreveria o status por 0 e desfaria o conserto.
            if (!/resposta não é JSON/.test(String(error && error.message))) {
                this._registrar(endpoint, _t0, 0, falha, { corpoReq: this._semSegredo(body) });
            }
            return falha;
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

    // Porta de entrada da presença: devolve o CRACHÁ assinado (nome/rank/AM do
    // /Session do Waze, mais a sala já resolvida) e os servidores de rede.
    // O nome não vai daqui pro servidor — vem de lá, assinado, justamente pra
    // ninguém poder se apresentar como outra pessoa na lista.
    async presenca(peer, stateId) {
        const sessionToken = this.getSession();
        if (!sessionToken) return { success: false, error: t('api.error.noSession') };
        return this._post('presenca', {
            sessionToken,
            region: this.getRegion(),
            countryId: this.getCountry(),
            stateId: stateId || null,
            peer
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
