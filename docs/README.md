# docs/

Referência pra desenvolvimento. **Nada aqui é servido pra usuário final** — são arquivos pra agentes/devs consultarem ao escrever código.

## `wme-sdk-typings.d.ts`

Tipagens oficiais do Waze Map Editor SDK (TypeScript declaration file).

| Campo | Valor |
|---|---|
| Origem | https://web-assets.waze.com/wme_sdk_docs/production/latest/wme-sdk-typings.tgz |
| Pacote npm | `wme-sdk-typings` (privado, `UNLICENSED`) |
| Versão capturada | `v2.354-12-gb93d6042ba` |
| Capturado em | 2026-06-13 |
| Tamanho | 5.216 linhas |

### Pra que serve aqui

Nossa app fala com a API interna do Waze (`Issues/Search/List`, `Features`, `Session`, etc.) raspando cookies. O SDK oficial cobre uma superfície parcialmente sobreposta — usar a tipagem como **referência canônica** ajuda quando:

- Surge dúvida sobre o que é um campo do `Venue` (tipo `lockRank`, `isAdLocked`, formato de `openingHours`)
- Vamos adicionar parsing de novo campo no `buscar-places.php`
- Precisamos confirmar valores válidos de enums (categorias, tipos de PUR, payment types, etc.)
- Queremos comparar o modelo do Waze com o que extraímos

Especialmente útil:

- `Venue` (linha 677) — schema completo do venue
- `VenueUpdateRequest` (linha 428) — modelo do PUR (com `subject` IMAGE|VENUE + `updateType` ADD/DELETE/UPDATE/flag)
- `VENUE_MAIN_CATEGORY` / `VenuePermission` / `PaymentType` / `GENERAL_SERVICE_TYPE` — enums
- `Venues.updateVenueUpdateRequest({ isApproved, venueId, venueUpdateRequestId })` (linha 2898) — o endpoint canônico de aprovar/rejeitar PUR
- `OpeningHour` (linha 481), `NavigationPoint` (linha 454), `VenueImage` (linha 497)

### Não é runtime

Esta tipagem é **apenas referência humana e de agentes**. A app é vanilla JS sem TypeScript — não há nenhum import dela em código de produção. Não fica no service worker, não é servida via PWA.

### Como atualizar

Quando o Waze publicar nova versão das tipagens:

```bash
curl -sSL -o /tmp/wme-sdk.tgz https://web-assets.waze.com/wme_sdk_docs/production/latest/wme-sdk-typings.tgz
mkdir -p /tmp/pkg && tar -xf /tmp/wme-sdk.tgz -C /tmp/pkg
cp /tmp/pkg/package/index.d.ts docs/wme-sdk-typings.d.ts
```

E atualizar este README com a nova versão (campo `version` no `package.json` extraído).
