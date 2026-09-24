# A API do Waze que o WME usa — superfície MEDIDA

Levantado em 2026-09-11 a partir de um HAR de sessão real do owner (31,5 MB,
357 requisições, WME `v2.367-2-g5ef3c024df`), do bundle de produção do editor
(`app-*.js` + `third_party-*.js`, 7,4 MB) e de uma chamada ao vivo ao endpoint
público de configuração.

**Este documento não é runtime.** É referência de dev, no mesmo espírito do
`wme-sdk-typings.d.ts`: consulte antes de inventar payload ou de concluir que
alguma coisa "não existe".

**Procedência de cada linha está marcada.** `[HAR]` = observado no fio numa
sessão real. `[bundle]` = lido do código do editor, ainda não exercitado.
`[vivo]` = chamada feita daqui, com resposta conferida. A distinção importa:
o que saiu do bundle é o que o WME *sabe* chamar, não necessariamente o que o
servidor aceita hoje.

---

## 1. Prefixo e regiões

Tudo abaixo pende de `https://www.waze.com/<região>-Descartes/app/`, com a
tabela de região que o `core.mjs` já usa (`row` → `row`, `na` → `usa`,
`il` → `il`, `world` → `row`). O gRPC pende de
`https://www.waze.com/<região>-Descartes/grpc/`.

---

## 2. REST — a tabela `paths` COMPLETA do WME

São **42 caminhos**, extraídos da constante `Config.paths` do bundle. A app
usa **6**. Os outros 36 não são segredo nem novidade: são simplesmente o resto
do editor (segmentos, fechamentos, eventos de trânsito, camadas de imagem).

| caminho | nome interno no WME | nós |
|---|---|---|
| `Session` | `auth` | **usamos** (perfil + gate) |
| `v1/Issues/Search/List` | `issueTrackerSearchList` | **usamos** (a fila) |
| `v1/Issues/Read` | `issueTrackerReadIssue` | **usamos** (marcar lido) |
| `Features` | `features` | **usamos** (rejeitar, excluir foto, renomear, duplicado) |
| `LocationSearch/Countries` | `locationSearchCountries` | **usamos** |
| `LocationSearch/States` | `locationSearchStates` | **usamos** |
| `v1/Issues` | `issueTrackerIssues` | — GET de um pedido específico |
| `v1/Issues/Star` | `issueTrackerStarIssue` | — ver §5 |
| `v1/Issues/Search/Map` | `issueTrackerSearchMap` | — pinos do mapa (sem página, sem ordenação) |
| `v1/Issues/Search/Save` | `issueTrackerSearchSave` | — POST cria, DELETE apaga |
| `v1/Issues/Search/Save/Update` | `issueTrackerSearchSaveUpdate` | — |
| `v1/Issues/Search/Save/Share` | `issueTrackerSearchSaveShare` | — POST compartilha, GET resolve |
| `LocationSearch/Cities` | `locationSearchCities` | — `?countryId&stateId&q` |
| `LocationSearch/Cities/ById` | `locationSearchCityById` | — `{cityId}` |
| `CityExistence` | `cityExists` | — |
| `UserProfile/Profile` | `userProfile` | — GET `?username=` |
| `info/config` | `configurationInfo` | — ver §3 |
| `info/version` | `version` | — |
| `Feed/Notifications` | `notifications` | — removido do produto (gotcha #2) |
| `Features/bulk` | `featuresBulk` | — gravação em lote |
| `Features/Proposal` | `createProposal` | — |
| `UploadImage/Venue` | `uploadVenueImage` | — `octet-stream` |
| `ImageryRequests` | `imageryRequest` | — |
| `ImageryLayers/CreateMapId` | `imageryLayersCreateMapId` | — |
| `HouseNumbers` | `houseNumbers` | — |
| `ElementHistory` | `elementHistory` | — |
| `Archive/List` · `Archive/SessionGPS` | `archive` · `archiveSessions` | — |
| `MapComments/Comment` · `MapComments/Notification` | — | — comentário de MapComment |
| `MapProblems/Details` · `MapProblems/UpdateRequests` · `MapProblems/UpdateRequests/Comment` | — | — URs de SEGMENTO, não nossos |
| `MajorTrafficEvents/Publish` · `/Ready` · `v1/Features/MajorTrafficEvents` · `v1/Features/Closures` · `v1/Features/Schedules` · `/v1/Proposals` | — | — MTE/fechamentos |
| `Partners` | `partnersByGeometry` | — |
| `TermsOfService/Agree` | `agreeToTermsOfService` | — |
| `ErrorReport` | `logger` | — |
| `Waze/Feature/Vector/Segment` · `/SearchServer/mozi` | — | — fora do prefixo Descartes |

`[bundle]` para a tabela; `[HAR]` para `Session`, `v1/Issues/Search/List`,
`v1/Issues/Search/Map`, `Features`, `info/config` e `Feed/Notifications`.

---

## 3. `info/config` — configuração PÚBLICA, e é ela que valida nosso portão

`GET /row-Descartes/app/info/config` responde **200 sem credencial nenhuma**
`[vivo, 2026-09-11]`. Nada sensível: são limites e feature flags do editor.

### A armadilha do `minRankForEditingUpdateRequest`

O config publica `minRankForEditingUpdateRequest: 1`, e é tentador ler isso
como "o piso do próprio Waze pro nosso pedido é L2" — **e está errado**. Eu
escrevi essa frase e a medição a derrubou.

Rastreado até o consumidor no bundle: `minRankForEdit()` tem DUAS
implementações, as duas em adaptadores cujo `this.problem` é
**MapProblem / UpdateRequest de SEGMENTO** (trazem `driveDate`,
`localDriveTime`, `driveGeometry`, e o `getIssueType()` devolve
`UPDATE_REQUEST | MAP_PROBLEM`). A base devolve `0`; só o `UpdateRequestAdapter`
devolve o `minRankForEditingUpdateRequest`. **Nenhum adaptador de pedido de
LOCAL usa isso.** É o mesmo homônimo do §4: no vocabulário do Waze,
"UpdateRequest" sozinho é o reporte de trânsito, e o nosso é
`VenueUpdateRequest`.

**O achado real é a AUSÊNCIA, e ela vale mais que a confirmação que eu quis
ver:** não existe piso de rank publicado pro pedido de local. O WME não gateia
PUR por rank — gateia por `permissions`/`lockRank`, POR VENUE. Isso confirma
por um segundo caminho o que o CLAUDE.md já registra a partir da medição da
conta L1 não-AM (498 pedidos contra 188 do L6+AM): **quem sustenta o nosso
portão é o AM, não o rank.** Se um dia alguém propuser alinhar
`MIN_RANK_WAZE` "ao número do Waze", não há número do Waze pra alinhar.

Outros limites publicados (`[vivo]`, confere com o `[HAR]`):

| chave | valor | leitura |
|---|---|---|
| `venueImageUploadMinRank` | 3 | L4 pra subir foto |
| `minRankToViewGooglePlaces` | 2 | L3 |
| `minRankToEditGooglePlaces` | 4 | L5 |
| `venueImageUploadMaxFileSize` | 2 097 152 | 2 MB |
| `venueImageUploadAllowedFileTypes` | gif png jpg jpeg bmp wbmp | |
| `venueImageUploadMaxFilesBatchSize` | 5 | |
| `issuesTrackerPageSize` | **500** | página do SERVIDOR |
| `issuesTrackerMaxPageNumber` | 50 | teto de 25 000 pedidos |
| `frontendConfig.issueTrackerPageSize` | 240 | o que o WME pede por vez |
| `maxVenueNavigationPoints` | 20 | |
| `readOnlyMode` | false | **o Waze pode entrar em só-leitura, e avisa aqui** |
| `enforceEmailVerification` | true | |

**`issuesTrackerPageSize: 500` pede uma reconferida num número deste repo.**
O CLAUDE.md registra "mediana 497 pedidos" nos países de validação. 497 está
três abaixo do teto de página que o servidor publica, e isso pode ser
coincidência (o país tem 497 mesmo) ou pode ser a medição tendo visto uma
página só. Os dois desfechos são possíveis com o que está medido hoje: a app
pagina, e as filas maiores (França 583, máximo 655) passam dos 500 justamente
por isso. **O que decide é o `hasMore` daquela chamada**, e ele não foi
registrado por país. Antes de citar a mediana como propriedade das filas,
remeça olhando `hasMore` — se vier `true` num país que devolveu ~500, a
mediana é do instrumento e não do país.

### Feature flags que nos dizem respeito

| flag | valor | por que importa |
|---|---|---|
| `grpcVenueUpdateRequestIssuesApi` | **false** | o pedido de LOCAL (o nosso) **ainda não** migrou pra gRPC |
| `grpcMapUpdateRequestIssuesApi` | true | o UR de SEGMENTO já migrou |
| `grpcMapProblemIssuesApi` · `grpcMapSuggestionIssuesApi` | true | idem |
| `getListOnlineEditorsGrpc` · `postOnlineEditorVisibilityGrpc` · `postOnlineEditorLocationGrpc` | true | presença nativa do WME, já em gRPC |
| `GetFeaturesV2` / `GetFeaturesV2FE` / `GetFeaturesV2AutoRedirect` | true | `/Features` tem V2 com redirect automático LIGADO |
| `AllowSaveFeaturesV2` | false | a GRAVAÇÃO em V2 ainda não |
| `PermissionsV2` · `PermissionsV2ShadowMode` | false | modelo de permissão novo, desligado |
| `UserBasedPermissions` | true | |
| `VenueImageFiltering` | true | |
| `IssueTrackerShareSavedSearch` | true | ver §5 |

**O risco datado**: `grpcVenueUpdateRequestIssuesApi` existe e está **false**.
A flag não nasceu à toa — quando ela virar `true`, o `/v1/Issues/Search/List`
que sustenta a nossa fila vira caminho legado. Não há nada a fazer hoje além
de saber que a checagem é barata: **um GET público, sem cookie**. Se um dia a
fila secar sem explicação, este é o primeiro lugar a olhar.

---

## 4. gRPC-web — o que existe e como o fio é

Serviço `com.waze.mapeditor.web.api.MapEditorWebServer`, **44 métodos**
`[bundle]`:

```
getServerVersionInfo · searchLocations · listOnlineEditors · updateOnlineEditor
getMapUpdateRequest · batchGetMapUpdateRequests · searchMapUpdateRequests
setStarMapUpdateRequest · setReadMapUpdateRequest
getMapProblem · batchGetMapProblems · searchMapProblems
setStarMapProblem · setReadMapProblem · getTask
getMapSuggestion · batchGetMapSuggestions · searchMapSuggestions
setStarMapSuggestion · setReadMapSuggestion
getGooglePlace · batchGetGooglePlaces · searchGooglePlaces · searchGoogleAddresses
searchGoogleCategories · listGoogleCategories
addGoogleAuthorization · removeGoogleAuthorization
getSegment · getTileFeatures · getTileAreas · getTileEvents · batchGetMapFeatures
batchGetStates · batchGetCountries · reportTooltipProgress
getGraduationEligibility · listFeaturePermissions · listSupportedFeatures
listFeaturePermissionsWeblinks · getUserPermissionCountries
convertTextToVoice · getImpactProfile · getAiHelperToken
```

**Atenção ao nome**: `MapUpdateRequest` aqui é o UR de SEGMENTO (o "reporte de
trânsito"), **não** o nosso pedido de local. O enum
`com.waze.mapeditor.entity.MapIssueType` separa os dois:

```
0 MAP_ISSUE_TYPE_UNSPECIFIED · 1 MAP_UPDATE_REQUEST
2 PLACE_UPDATE_REQUEST  ← o nosso · 3 MAP_PROBLEM · 4 SUGGESTED_EDIT
```

`PLACE_UPDATE_REQUEST` **já tem número reservado no enum gRPC**, e nenhum
método gRPC o serve ainda. Casa com a flag desligada do §3.

### O fio, medido

```
POST /row-Descartes/grpc/<serviço>/<método>
content-type: application/grpc-web-text      accept: application/grpc-web-text
x-grpc-web: 1                                sem x-csrf-token  ← só cookie + origem
corpo = base64( quadro )
quadro = [1 byte flag][4 bytes BE tamanho][protobuf]
         flag 0x00 = mensagem · 0x80 = trailer ("grpc-status:0")
resposta: application/grpc-web-text+proto, mesmo enquadramento
```

`[HAR]` — 13 chamadas gRPC observadas, todas decodificadas.

Exemplo real, `listOnlineEditors` (bbox de dois cantos; `101` é longitude e
`102` latitude, ambos int64 em micrograus):

```
1 { 1 { 101:-38319567  102:-12892337 }     // canto A
    2 { 101:-38318827  102:-12891999 } }   // canto B
```

O cliente gRPC-web existe desde 2026-09-23: `server/wme-grpc.mjs`, sem
dependência, para a presença e o chat do WME (§4.1). Os pedidos que ele monta
saem **byte a byte iguais** aos do WME — travado em `test/wme-grpc.test.mjs`
contra quadros reais das gravações do owner.

### 4.1 Presença e chat do WME — medidos em 2026-09-23

WME `v2.370`, quatro HARs do owner, o código do editor e do chat
(`chat-web/prod/*`), chamadas ao vivo com as contas antigerme (L6+AM) e cafanha
(L1), e o WME de verdade aberto com as duas contas ao mesmo tempo. Tudo `[vivo]`
salvo onde marcado.

**Presença** — `MapEditorWebServer/{listOnlineEditors,updateOnlineEditor}`,
em `/<região>-Descartes/grpc/`:

| O quê | Medido |
|---|---|
| Registro `OnlineEditor` | `1 user_id · 2 location{101 lon×1e6, 102 lat×1e6} · 3 visible · 4 user_name · 5 rank` (só esses 5, `[bundle]`) |
| Visibilidade | chave do PERFIL (`/Session` → `onlineEditorDetails.visible`), persiste entre sessões e vale no WME também |
| O WME e a visibilidade | abrir o WME e arrastar o mapa NÃO mexem nela: carregar não escreve nada, e a escrita do `moveend` leva a máscara só em `location` (a conta estava visível e seguiu visível) `[vivo, 2026-09-24]` |
| Expira | **~15 min depois da última atualização de qualquer tipo** (posição ou só visibilidade): presente aos 14,75 → fora aos 15,0; e presente a 14,0 → fora a 15,5 depois de um `visible=true` sozinho. A visibilidade continua ligada — só sai da lista |
| WME aberto e parado | **some igual**: 14,5 min presente → 16,6 min fora. O WME só escreve a posição no `moveend` do mapa; não há pulso (código + 14 min de HAR + o inventário completo do WME parado) |
| Separada por servidor | um WME no servidor NA não vê ninguém do ROW. WME recém-instalado cai no NA até alguém trocar (`localStorage.editorLocation`) |
| Lista | **pública**: responde sem cookie. Exclui quem pede. Mundo inteiro = 48 editores, 2,9 KB, ~0,5 s |
| Escrita | exige o cookie e o id da PRÓPRIA pessoa: sem id → 3 `Missing parameter value for 'user_id'`; id de outra → 7 `cannot modify another user's data`. Posição e visibilidade vão numa chamada só (máscara com os dois caminhos) |
| O WME não redesenha | guarda a caixa já buscada e não tem relógio: o avatar de quem se move só anda quando o mapa de quem OLHA sai da caixa, ou no botão de recarregar. E deixa avatar fantasma: a resposta nova vem sem a pessoa e o WME junta com a antiga sem apagar |
| Posição volta EXATA | os inteiros ×1e6 que a pessoa escreve voltam idênticos na lista de quem lê (cafanha escreveu, antigerme leu: 3 de 3, duas posições com os últimos dígitos marcados e uma de controle redonda). É o que sustenta a marca de quem usa a app (`server/marca-app.mjs`) |
| Eco da escrita | o `updateOnlineEditor` devolve o registro da pessoa, com a posição quando ela foi escrita (sem posição quando só a visibilidade mudou) — dá pra conferir a marca a cada escrita sem chamada a mais |
| Lista × CORS | a lista é pública, mas o `www.waze.com` não libera leitura por outro site: o preflight responde **415** e nenhuma resposta traz `Access-Control-Allow-Origin` (a mesma chamada, feita do servidor, devolveu 13 editores). O navegador não lê a lista direto: ela passa pelo nosso `/api` |

**Chat** — `com.waze.wmp.{Messaging,MessagingHistory}`, em `/<geoEnv>-wmp/`:

| O quê | Medido |
|---|---|
| Prefixo | backend GLOBAL: `row-wmp`, `na-wmp`, `il-wmp` devolvem o mesmo; `usa-wmp` = 404. O WME usa o `geoEnv` da conta (vem no HTML de `/chat/embed`) |
| Cabeçalho | `1 requisição · 2 aparelho (100 = WEB) · 4 instalação · 6 app (2 = WAZE_MAP_EDITOR)` |
| Mensagem | `1 hora ms · 2 id (do cliente) · 3 destino · 4 remetente · 5 contexto · 6 classe (1 texto, 2 recibo) · 101 conteúdo{1 tipo, 101 Texto{1}} · 102 recibo{1 tipo (1 entregue, 2 lida), 2 [{1 id}]}` |
| Remetente | **ignorado**: mandado trocado ou omitido, o Waze grava o dono do cookie |
| Contexto | pares chave/valor que o chat do WME não mostra; um resumo de card de 2 KB voltou byte a byte. Link no texto vira link de verdade no chat do WME |
| Recibos | são mensagens (classe 2) mandadas pelo cliente; `MarkConversationRead` gera os dois (entregue e lida) no servidor e devolve os ids |
| Não lidas | `GetUnreadMessagesCount` → `{1{1 total}, 2 marca de leitura}`; a 1ª página de `ListConversations` leva a marca no campo 6 |
| Páginas | `ListConversations`: seguinte com o campo 2 = a atividade (campo 8) da última conversa da anterior, como o WME. `ListMessages`: `2 destino · 3 antes de · 5 tamanho · 7:1` |
| Conversa inexistente | `MarkConversationRead` → 7 `NO_EXISTING_CONVERSATION` |
| Ordem do histórico | `ListMessages` devolve da mais NOVA pra mais antiga, e só texto: nenhum recibo vem no histórico `[vivo, fase 3]`. O "Lida" de uma conversa antiga só existe se o aparelho guardou o recibo que o fluxo contou |
| Prévia da lista | a `ultima` de cada conversa do `ListConversations` é a última mensagem de TEXTO (50 de 50 medidas), com o contexto — é onde a marca da app aparece |
| Link no texto | o link LONGO do ↗ (`env`, `lat`, `lon`, `zoomLevel=22`, `venues`, `venueUpdateRequest`, `tab`) abre o local selecionado; o CURTO (só `env` e `venues`) abre o WME a 7.755 km e não seleciona nada `[vivo, fase 3]` |
| `PullMessages` | é a fila do APARELHO, não histórico: trouxe 2 mensagens e, na chamada seguinte, 0 |

**Tempo real** — `GetMessagingProvider` devolve `{1 token (bytes), 2 validade
µs ≈ 24 h, 3 endereço, 4 chave de API}`. O fluxo é um POST JSON longo em
`instantmessaging-pa.googleapis.com/v1/messages:receive` com o token em
`auth_token_payload` e a chave em `X-Goog-Api-Key`:

- **CORS aberto a qualquer origem** (preflight e resposta ecoam a origem que
  pediu; testado com a nossa e num Chromium de verdade em outra origem).
  Controles: sem chave → 403; token falso → 401. A chave aceita nosso Referer.
- Um token por **instalação**; a mesma instalação recebe sempre o mesmo. Várias
  conexões da mesma pessoa recebem a mesma mensagem, e nenhuma derruba a outra.
- Sinal de vida (`pong`) a cada 10 s; a conexão cai sozinha a cada **6,2 min**
  (5 vezes seguidas, 6,20–6,24), com dado 2–4 s antes: é tempo máximo, não
  inatividade. Daqui não dá para separar Google de saída de rede do ambiente.
- **A MESMA instalação recebe de volta, ao reconectar, tudo o que não
  confirmou** `[vivo, fase 3]`: as mensagens que chegaram com o fluxo fechado,
  o eco das próprias e os recibos — num lote inicial (`startOfBatch` …
  `endOfBatch`). `AckMessages` tira da fila; confirmado, o lote seguinte vem
  sem aquilo. Os recibos às vezes só aparecem na reconexão SEGUINTE (chegam
  segundos depois). Uma instalação NOVA não recebe nada — e é por isso que a
  fase 1 escreveu aqui "reconectar não reentrega nada": ela media sorteando uma
  instalação por vez. A app usa uma instalação estável por aparelho e confirma
  de carona nos pedidos que já faz.
- Latência do envio à chegada no outro aparelho: 0,52–0,60 s (5 medidas).

**Erros** — HTTP 200 com o status no trailer. O **7 é ambíguo** e se decide
pela mensagem: `guest user` (cookie que não vale), `Empty CSRF token` (sem
cookie) e 7 **sem** mensagem (chat com cookie que não vale) são sessão morta;
`another user` e `NO_EXISTING_CONVERSATION`, não. `categorizeGrpcError` no core.

---

## 5. As DUAS lacunas reais da app, medidas

### 5.1 `isStarred` — a app MOSTRA e não deixa MARCAR

O pedido já chega com a estrelinha: `mapIssues.venueUpdateRequests.objects[]`
traz `isStarred` `[HAR]`, o `core.mjs` já o repassa (`isStarred: !!ur.isStarred`)
e o card já o desenha (`.card-starred`). O que falta são as duas pontas:

- **marcar**: `POST v1/Issues/Star` com
  `{ value: <bool>, venueUpdateRequestIds: [{ id: <updateRequestID>, venueId: "<venueID>" }] }`
  `[bundle]` — payload idêntico ao do `Read`, com `value` no lugar.
- **filtrar**: `userPropertiesFilter` aceita **exatamente dois** booleanos,
  `isRead` e `isStarred` `[bundle]`. A app manda só o primeiro.

Isto é **estado compartilhado com o WME**: estrela posta aqui aparece lá, e
vice-versa. Seria a primeira coisa da app que grava sem ser destrutiva — mas
**é gravação**, então entra pela mesma régua das outras (portão, teste contra o
payload do HAR, nunca exercitar `/Features` com os cookies do owner).

### 5.2 Buscas salvas — existem, são compartilháveis, e a app não as vê

O `/Session` do owner traz `savedIssueTrackerSearches: []` `[HAR]` e a flag
`IssueTrackerShareSavedSearch` está ligada. Os quatro caminhos
(`Search/Save`, `/Update`, `/Share`, mais DELETE no `/Save`) são o mecanismo
de salvar e **compartilhar um conjunto de filtros por link** `[bundle]`.

Hoje os filtros da app moram só no `localStorage` do aparelho. Nada a decidir
agora; fica registrado que o servidor guarda isso de graça.

---

## 6. Country Manager — onde ele está e onde ele NÃO está

Dois sistemas distintos usam a palavra "manager", e confundi-los custou uma
resposta errada ao owner:

**(a) Permissão de edição** — `/app/Session`. O campo é
`editableCountryIDs: [30]`. **Não existe** campo `isCountryManager`: o WME
o CALCULA (`this.attributes.editableCountryIDs && !isEmpty(...)`) `[bundle]`.
Ausência do campo não é ausência do status — foi exatamente esse o erro.

A app **já recebe e já usa** `editableCountryIDs`: o `populateCountrySelect`
restringe o seletor de país a ele. Ou seja, a restrição de Country Manager já
está implementada — sem nunca ter sido chamada assim.

**(b) Crachás de comunidade** — painel "Seu mapa", alimentado por
`profileInfo.communityRoles` do gRPC `getImpactProfile`. O filtro é
`Bne.filter(b => communityRoles.includes(b.role))` `[bundle]`, sobre uma lista
de **16 crachás**, nesta ordem:

```
LOCAL_CHAMP · GLOBAL_CHAMP · COUNTRY_MANAGER · STATE_MANAGER · COORDINATOR
MENTORING_COORDINATOR · PARTNER_COORDINATOR · MENTOR · LOCALIZER · MEGA_MAPPER
COMMUNITY_BOOSTER · MTE_MARSHAL · WAZE_CULTURE_CHAIR · WME_BETA_TESTER
WME_SCRIPTER · AREA_MANAGER
```

**Cuidado, e esta parte é uma inconsistência que eu não resolvi:** o proto
carregado nesta versão declara `ProfileInfo.CommunityRole` com **cinco** valores
numéricos (`COMMUNITY_ROLE_UNSPECIFIED · EDITOR · MENTOR · CHAMPION ·
COORDINATOR`), que não são os 16 nomes acima. A lista de 16 é montada com
`{...módulo_91111.GM, ...}` e o módulo 91111 **não está neste HAR** (é um chunk
que só carrega ao abrir o painel, que não foi aberto). Então: a lista de 16 é
certa como *inventário de crachás*; qual é o enum que o servidor devolve hoje
**não foi medido**. Para medir, abra o painel "Seu mapa" e capture o
`getImpactProfile`.

De qualquer modo, **nada disso entra no nosso gate**: o portão é rank + AM +
staff, e os crachás são reconhecimento de comunidade, não permissão.

---

## 7. O que foi conferido de quebra

- **`lockRanks: [0,1,2,3,4,5]`** — o WME manda exatamente o que a gente manda.
  Não é gap `[HAR]`.
- **`/v1/Issues/Search/Map`** é irmão do `List` sem `page` e sem `orderBy`:
  serve pinos, não lista. Não nos serve `[HAR]`.
- **Tiles**: o WME usa `row-tiles/editor/roads/`; nosso mini-mapa usa
  `live/base` de propósito (gotcha #51) `[HAR]`.
- **Telemetria**: o WME reporta em `/Descartes/otlp-traces` (OpenTelemetry) e
  `/web-events`. 37 requisições de telemetria numa sessão curta — contexto útil
  pra lembrar que o nosso free tier não tem essa folga `[HAR]`.
