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

Nosso app fala com a API interna do Waze (`Issues/Search/List`, `Features`, `Session`, etc.) raspando cookies. O SDK oficial cobre uma superfície parcialmente sobreposta — usar a tipagem como **referência canônica** ajuda quando:

- Surge dúvida sobre o que é um campo do `Venue` (tipo `lockRank`, `isAdLocked`, formato de `openingHours`)
- Vamos adicionar parsing de novo campo no `handleBuscarPlaces` (server/core.mjs)
- Precisamos confirmar valores válidos de enums (categorias, tipos de PUR, payment types, etc.)
- Queremos comparar o modelo do Waze com o que extraímos

Especialmente útil:

- `Venue` (linha 677) — schema completo do venue
- `VenueUpdateRequest` (linha 428) — modelo do PUR (com `subject` IMAGE|VENUE + `updateType` ADD/DELETE/UPDATE/flag)
- `VENUE_MAIN_CATEGORY` / `VenuePermission` / `PaymentType` / `GENERAL_SERVICE_TYPE` — enums
- `Venues.updateVenueUpdateRequest({ isApproved, venueId, venueUpdateRequestId })` (linha 2898) — o endpoint canônico de aprovar/rejeitar PUR
- `OpeningHour` (linha 481), `NavigationPoint` (linha 454), `VenueImage` (linha 497)

### Não é runtime

Esta tipagem é **apenas referência humana e de agentes**. O app é vanilla JS sem TypeScript — não há nenhum import dela em código de produção. Não fica no service worker, não é servida via PWA.

### Como atualizar

Quando o Waze publicar nova versão das tipagens:

```bash
curl -sSL -o /tmp/wme-sdk.tgz https://web-assets.waze.com/wme_sdk_docs/production/latest/wme-sdk-typings.tgz
mkdir -p /tmp/pkg && tar -xf /tmp/wme-sdk.tgz -C /tmp/pkg
cp /tmp/pkg/package/index.d.ts docs/wme-sdk-typings.d.ts
```

E atualizar este README com a nova versão (campo `version` no `package.json` extraído).

---

## `waze-api.md`

Superfície **medida** da API que o WME usa: a tabela `paths` completa (44
caminhos REST), os 44 métodos gRPC-web, os limites e feature flags publicados
em `info/config`, e o enquadramento do fio gRPC.

**Gerado em**: 2026-09-11, a partir de um HAR de sessão real do owner (WME
`v2.367`), do bundle de produção do editor e de uma chamada ao vivo ao
`info/config` — que responde **200 sem credencial**.

**Pra que serve aqui**: responder "isto existe?" sem chutar e sem gastar
requisição. Cada linha vem marcada com a procedência (`[HAR]` observado no
fio · `[bundle]` lido do código do editor · `[vivo]` chamado daqui), porque
"o WME sabe chamar" e "o servidor aceita hoje" não são a mesma coisa.

Três coisas que ele registra e que mudam decisão:

- **Não existe** piso de rank publicado pro pedido de LOCAL. O
  `minRankForEditingUpdateRequest: 1` que parece ser isso é do UR de
  SEGMENTO — rastreado até o consumidor. Confirma por outro caminho que quem
  sustenta o nosso portão é o AM, não o rank.
- `grpcVenueUpdateRequestIssuesApi: false` — o endpoint que sustenta a nossa
  fila ainda não migrou pra gRPC, mas a flag já existe.
- `isStarred` e as buscas salvas existem no servidor. A estrela o app já MARCA
  (o "Pular guarda o pedido", rota `guardar-pedido`); filtrar por ela e as
  buscas salvas ainda não.

Não tem PDF: é referência de consulta, não documento pra compartilhar.

---

## `gotchas.md`

A **história** de cada gotcha do CLAUDE.md, com a mesma numeração: sintoma,
hipótese errada, a medição que a derrubou, o conserto e a armadilha do
instrumento. O CLAUDE.md guarda só a regra curta, que é o que precisa estar
sempre carregado; aqui mora o inteiro teor, pra ler quando o assunto aparece.

---

## O que saiu na limpeza de 2026-10-26

O arquivo de trabalho da auditoria de 2026-09, a história dos lotes de correção
(`lotes.md`), a análise do Android nativo e o plano da migração pro Cloudflare
(com os PDFs e o `scripts/md2pdf.py` que os gerava) saíram do repositório: o
trabalho deles terminou. O apêndice da sala própria saiu do `gotchas.md` pelo
mesmo motivo. Estão todos no git, no último commit que os tinha:

```bash
git show e1937b8:docs/lotes.md
```

O passo a passo da VM, que o plano da migração também tinha, está no README
(«Opção B»).
