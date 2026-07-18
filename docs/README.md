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

Esta tipagem é **apenas referência humana e de agentes**. A app é vanilla JS sem TypeScript — não há nenhum import dela em código de produção. Não fica no service worker, não é servida via PWA.

### Como atualizar

Quando o Waze publicar nova versão das tipagens:

```bash
curl -sSL -o /tmp/wme-sdk.tgz https://web-assets.waze.com/wme_sdk_docs/production/latest/wme-sdk-typings.tgz
mkdir -p /tmp/pkg && tar -xf /tmp/wme-sdk.tgz -C /tmp/pkg
cp /tmp/pkg/package/index.d.ts docs/wme-sdk-typings.d.ts
```

E atualizar este README com a nova versão (campo `version` no `package.json` extraído).

---

## `native-android-analysis.md` + `.pdf`

Análise técnica completa do que mudaria se reescrevêssemos a app como Android nativo (Kotlin) ou cross-platform (Flutter, KMM). Cobre:

- Por que o backend PHP existe hoje (CORS + segurança de cookies)
- Por que sumiria num nativo de verdade (sem CORS, Android Keystore mais seguro)
- 3 opções de fluxo de auth no nativo (WebView login é a recomendada)
- Ganhos (UX, push, performance, segurança, infraestrutura, distribuição)
- Perdas (iOS, desktop, velocidade de iteração, curva de aprendizado)
- Arquitetura comparada com diagramas
- Esboço de implementação Kotlin (~150 linhas pra MVP)
- Custo realista em horas
- Caminhos intermediários (TWA, Capacitor, Flutter, coexistência)
- Recomendação por horizonte de tempo

**Gerado em**: junho 2026, em resposta a colegas pedindo versão mobile nativa.

**Pra que serve aqui**: documento de discussão pra evitar repetir essa conversa com cada novo colaborador que sugerir "vamos fazer um app nativo". O `.md` é a fonte; o `.pdf` é o entregável formatado pra compartilhar fora do GitHub (WhatsApp, e-mail, etc).

### Regenerar o PDF

Se atualizar o `.md`, regere o PDF:

```bash
pip install weasyprint markdown pygments
python3 docs/scripts/md2pdf.py docs/native-android-analysis.md docs/native-android-analysis.pdf
```

(Ver `docs/scripts/md2pdf.py` — script de ~30 linhas com CSS pra A4 + paleta cyan que combina com a app.)

---

## `cloudflare-migration.md` + `.pdf`

Planejamento técnico de migração do stack atual (PHP + Apache) para Cloudflare
Pages + Workers, mantendo fallback pra VM RedHat. Cobre:

- Padrão **core compartilhado + adaptadores** (aprendido do projeto `botequei`):
  uma lógica só, cascas finas por plataforma — resolve o "dois backends dobram
  manutenção"
- Mapa de conversão função-a-função PHP → JS (`config.php` + 9 endpoints)
- Sessões: `/tmp` → Workers KV (CF) / filesystem (VM), com ajuste de TTL pro
  limite de escrita do KV
- Cripto: `openssl` → Web Crypto (roda igual em Worker e Node), sugestão de subir
  pra AES-GCM
- Estrutura de arquivos, `_headers`, `wrangler.jsonc`, Secrets
- Fallback VM RedHat com systemd + nginx (espelhando o README do botequei)
- Passo a passo, esforço (~3-4 dias) e limites do free tier

**Gerado em**: junho 2026, em resposta ao interesse em migrar pra Cloudflare
(precedente: o `botequei` fez essa migração com sucesso).

**Pra que serve aqui**: base de decisão e roteiro de implementação. Como os
outros docs, o `.md` é a fonte e o `.pdf` é o entregável pra compartilhar.
Regenerar o PDF: `python3 docs/scripts/md2pdf.py docs/cloudflare-migration.md docs/cloudflare-migration.pdf`.

