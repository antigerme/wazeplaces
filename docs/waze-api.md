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

Escrever um cliente gRPC-web aqui é viável sem dependência (o enquadramento é
trivial e o protobuf a gente já sabe montar à mão), mas **hoje não há motivo**:
nada do que o nosso produto faz está do lado gRPC.

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
