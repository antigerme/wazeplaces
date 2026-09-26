# Auditoria completa de 2026-09 — estado e como retomar

Arquivo de TRABALHO da auditoria pedida pelo owner em 2026-09-25. Ele existe pra
que a auditoria sobreviva a uma parada (limite da assinatura, contêiner
recolhido): uma sessão nova lê isto e continua de onde parou. Quando a auditoria
terminar, este arquivo vira o registro final dela (o que foi auditado, o que
mudou, o que ficou pra decisão) — ou sai, se o owner preferir.

**Retomada automática:** existe uma Routine ("Retomar auditoria do Waze
Places", `trig_01VAJ9pzh87pVxN4RvmZGCky`) que manda, de hora em hora (minuto
:33 UTC), uma mensagem de retomada pra MESMA sessão. Ela aponta pra este
arquivo. **Apague-a com `delete_trigger` quando tudo estiver pronto.** (O
lembrete único de 2026-09-26 00:23 UTC já disparou.) A primeira parada de
verdade foi em 2026-09-25 ~23:40 UTC, com o limite voltando à 01:20 — a sessão
retomou sozinha, com os agentes continuados por `SendMessage`.

---

## 1. O pedido (o que "pronto" quer dizer)

- Auditar, testar e verificar o app INTEIRO — todo recurso, endpoint, a conversa
  com o Waze: offline, modo dev, FAB, diagnóstico, presença, chat, tratamento
  dos pedidos, o lightbox inteiro, renomear/aprovar, acessos, Ajuda, Histórico,
  recusa automática, i18n, manuais/docs — "e tudo que eu possa ter esquecido".
  A régua do owner: "120% funcional e com 0 erros".
- Ciclo: PR → CI verde → **squash merge (autorizado pelo owner)** → ~5 min →
  verificação em PRODUÇÃO com as duas contas de teste → REPETIR, levando os
  erros e sugestões de cada volta pra seguinte.
- Autorizado a agir no Waze com as contas de teste, com o MENOR impacto em
  terceiros (ver §6).
- **Só chamar o owner quando estiver tudo pronto**, pra ele anunciar aos Global
  Champs. A resposta final é em português ("app" é masculino).

## 2. Onde está cada coisa

| o quê | onde |
|---|---|
| Código mergeado | `main` (PRs #248, #249, #250, #251) |
| Lote 5 (ainda sem PR) | branch `claude/peaceful-heisenberg-HaUuC`, sobre a main do #251 — ver §4 |
| Este arquivo | `docs/auditoria-2026-09.md` no mesmo branch |
| Scripts de auditoria (produção, sabotagem, medições) | artefato privado https://claude.ai/artifact/5YRYw1MCA8zXAjbQEBd9Qf — ver §7 |
| Cookies das duas contas de teste | mandados pelo owner NESTA sessão (`/root/.claude/uploads/<sessão>/`). Contêiner novo pode não tê-los: **peça de novo** (CLAUDE.md, seção 🔑) |

## 3. O que já foi feito (e verificado em produção)

| PR | versão | o que trouxe | produção |
|---|---|---|---|
| #248 | 2026092502 | a busca relê a partir da página 1 (a "página 2" vinha vazia) | 46 ✓ · 3 ✗ (2 do instrumento, 1 real → rodada 1) |
| #249 | 2026092503 | rodada 1: região NA (`/Descartes/`), país do perfil, portão sem porta lateral, estado do cliente (época da sessão, treino, 401 → fila de saída, região no gesto), lightbox, offline, presença, textos | 56 ✓ · 2 ✗ (1 do instrumento, 1 REGRESSÃO real: a volta da rede com a fila vazia → rodada 2) |
| #250 | 2026092504 | rodada 2: a regressão, KV com 1 leitura por ação, `nosniff`, `?diag-rede`, FAB, zoom da foto, botão direito, Tab nos lightboxes, horário de verão, textos | **58 ✓ · 0 ✗** — e um achado novo no diagnóstico (abaixo) |
| #251 | 2026092505 | rodada 3: o diagnóstico sem o script do Cloudflare, fim da fila com pulados, retentativa de foto, irmãos na fila, pilha/foco no autor, Street View no zoom, presença (país no meio, relógio, leitor de tela, lista fechada, ids com teto), cookies colados limpos em todo fechamento, IndexedDB com teto, segredo do pareamento fora do relatório | mergeado em 2026-09-25 23:38 UTC (CI verde nos dois jobs); produção serve a 2026092505; auditoria em produção rodando em 2026-09-26 01:25 |

Achado da produção que virou regra: o Cloudflare injeta no HTML, a cada
resposta, o script do Bot Fight Mode com token e hora próprios — o `/` difere
SEMPRE entre duas respostas (mesmo tamanho, 180 posições). O diagnóstico v9
desconta (`diagSemInjecaoDaBorda`).

## 4. Lote 5 — feito, falta validar e subir

Commits (sobre a main do #251), no branch `claude/peaceful-heisenberg-HaUuC`. **Cópia
de segurança**: o artefato (§7) guarda os seis como `lote5.patch` (sem os
arquivos gerados). Se o branch não tiver o lote 5, aplique sobre a main que já
tem a rodada 3: `git am lote5.patch`, depois `npm run js && npm run html`.

1. **VM igual ao Worker**: `server/node.mjs` compara o ETag FRACO (atrás do
   Cloudflare a borda rebaixa pra `W/"…"` e a VM nunca respondia 304) e roteia a
   API pelo caminho NORMALIZADO (`/api/./sessao` é `sessao` nos dois).
2. Comentários com o portão de entrada certo (L2+AM) e o adaptador do Cloudflare.
3. **Os dados do aparelho têm dono** (`contaAgora`, `aoConhecerConta`,
   `esquecerOutraConta`, `CONTA_KEY`): depois de uma queda de sessão, outra
   conta que entre no mesmo aparelho não herda a fila de saída (as decisões da
   anterior iam pro Waze no nome de quem entrou), a recusa automática, o placar,
   o Histórico, as conquistas nem as conversas. Cada item da fila de saída leva
   a conta do gesto; o esvaziamento espera conta desconhecida e descarta a de
   outra (o placar desce). `test/conta.test.mjs`, 8 sabotagens.
4. **A extensão só é oferecida onde instala** (Chromium de computador): Firefox,
   Safari e o iPad (que se diz Mac) viam um beco sem saída.
5. **Trocar de idioma redesenha** o aviso do Desfazer, a linha do offline, a
   pílula e o botão de Filtros (MEDIDO: três textos ficavam em português).

Validação feita: `npm test` 1071/1071 no commit 3; testes dos commits 4–5 e as
sabotagens de todos. **Falta**: `npm test` inteiro de novo, `npm run js/css/html`,
os 4 smokes, bump da versão (**2026092601** — dia novo), CHANGELOG (rascunho em
§8), notas no CLAUDE.md, PR, CI, merge, produção.

**Rodada 2 de auditoria**: 6 agentes só-leitura foram disparados em
2026-09-25 ~23:25 sobre o lote 5, na cópia `/home/user/wp-lote5` (que por isso
NÃO se edita enquanto eles rodam). Áreas: Histórico/Resumo/conquistas; entrada,
Ajuda, pareamento, treino; card/diff/mapa/lightbox/gestos; servidor e
adaptadores; offline/SW/fila de saída/diagnóstico; presença e chat. O limite os
parou no meio e eles foram CONTINUADOS em 2026-09-26 01:23 (`SendMessage` com o
id de cada um, o contexto fica). Os resultados chegam NESTA sessão. **Se a
sessão caiu e eles se perderam,
re-dispare** com a mesma divisão e a lista "já corrigido/decidido" de cada área
(este arquivo + o CHANGELOG), pedindo só achados VERIFICADOS, com como
reproduzir.

## 5. Como validar (contêiner novo)

```bash
# Playwright do CI (o mais novo) e os navegadores
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright@latest
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-latest npx playwright install chromium
# pra falar com o Waze/produção pelo navegador: confiar na CA do proxy do ambiente
apt-get install -y libnss3-tools && certutil -A -d sql:$HOME/.pki/nssdb -n ccr-agent-proxy -t "C,," -i /root/.ccr/agent-proxy-ca.crt

npm run check && npm test
npm run js && npm run css && npm run html     # e commitar o que mudar
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-latest npm run test:browser   # ~12 min
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-latest npm run test:fluxo
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-latest npm run test:presenca
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-latest npm run test:offline
```

- **Não edite arquivo servido (`service-worker.js`, `js/min/`, `index.html`)
  com smoke rodando no mesmo diretório**: o SW vê versão nova e recarrega a
  página no meio (aconteceu).
- **Versão**: `date -u +%Y%m%d`; o serial `YYYYMMDDnn` em `js/version.js` e no
  `CACHE_NAME` tem que ter a data do commit HEAD do PR (o CI confere; em dia
  novo, revisão 01).
- **Sabotagem** (a régua do CLAUDE.md): cada conserto tem teste que REPROVA com
  ele desfeito. O jeito usado: um JSON `[{nome, arquivo, de, para, testes,
  espera}]` e um script que troca o trecho, roda `node --test <testes>`,
  exige `not ok` com `espera` no nome e restaura.
- **Harness que fatia função**: helper novo chamado de dentro de uma função
  fatiada pelos testes quebra os harnesses que não o conhecem (aconteceu 3×
  neste lote) — rode o `npm test` inteiro, não só o arquivo novo.
- **Produção**: depois do merge, esperar o `js/min/version.js` servir a versão
  nova (`curl` com User-Agent de navegador — POST/GET cru leva 403 do Bot Fight
  Mode) e rodar a auditoria (`VERSAO=<serial> node prod-auditoria.mjs`, §7).

## 6. Regras de segurança (resumo do CLAUDE.md, seção 🔑)

- Nunca imprimir valor de cookie; conteúdo sensível entra na página por
  `page.evaluate`, nunca `page.fill`.
- Jitter entre chamadas ao Waze: `tools/waze-jitter.mjs` (`pausaComJitter`).
- Escrita no Waze só a autorizada: rejeitar só pedido de id INEXISTENTE (o Waze
  responde "já tratado"); marcar como lido só pra devolver a "não lido" em
  seguida, conferindo; mensagens de chat só entre as duas contas de teste, com
  o prefixo `WP-TESTE`.
- URL do WME sempre `https://www.waze.com/editor`.

## 7. Scripts (fora do repo, de propósito)

Eles usam as contas de teste do owner, então ficam FORA do repo (a mesma decisão
dos scripts da fase 2 da presença). Estão guardados como arquivos de um artefato
privado no claude.ai, **"Auditoria do Waze Places"**:
https://claude.ai/artifact/5YRYw1MCA8zXAjbQEBd9Qf (a página também mostra este
estado de forma legível pro owner). Pra recuperar um arquivo: `Artifact` com
`action: "read"`, `url` acima e `path` = nome do arquivo.

- `prod-auditoria.mjs` — a auditoria em PRODUÇÃO pelo app de verdade, com as
  duas contas (seções 1–10: entrar, ações, lido e devolver, lightbox e portões,
  mapa, presença e conversa, filtros/Histórico/Ajuda/idiomas, modo dev/FAB/
  diagnóstico, recusa automática com id inexistente, offline, portão sem
  sessão, região NA e país do perfil, erros e CSP, Sair). Ajuste as constantes
  `UP`/`CONTAS` pros caminhos dos cookies.
- `sabotar.py` — o executor de sabotagem (troca o diretório na linha do
  `os.chdir`).
- `fim-fila.mjs`, `idioma-troca.mjs`, `i4-flash.mjs` — as medições deste lote
  (tela do "Fim da fila" nos aparelhos apertados; o que fica sem traduzir ao
  trocar de idioma; o português antes da tradução).

## 8. Pendências

**Esperam decisão do owner (não implementar sem ele; mudam tela):**
- **O português aparece antes da tradução** pra quem usa en/es/fr: MEDIDO, 2,75 s
  na primeira visita num 3G rápido (FCP 1,47 s, inglês aos 4,22 s), ~60 ms a
  partir da segunda. Conserto possível: esconder só o texto traduzível até
  traduzir (classe no `<html>` pelo script inline do tema — muda o hash da CSP)
  com teto de segurança. Pede mockup.
- **Abrir a foto e o mapa pelo teclado** (acessibilidade): atalho novo (muda a
  Ajuda) ou parada de foco na foto (muda o foco visível).
- **Aviso de carregamento lento** quando o aparelho diz que tem rede e ela não
  anda (o esqueleto fica até 45 s — o prazo é certo: fila de 2 MB num 3G lento
  leva 10–20 s). Texto novo na tela, pede mockup.

**Técnicas, na ordem:**
1. ~~Mergear o #251~~ (feito); auditoria em produção da 2026092505 (a versão
   nova do roteiro confere também o "código confere com o servidor" e o desvio
   do relógio da presença).
2. Validar e subir o lote 5 (§4 e §5).
3. Tratar os achados da rodada 2 de auditoria (conferir cada um antes de
   corrigir; muitos agentes erram o instrumento — ver gotcha #28).
4. Repetir o ciclo até uma volta sem achado novo; aí o relatório final ao owner
   e apagar a Routine.

**Rascunho do CHANGELOG do lote 5:**
- Outra conta entrando no mesmo aparelho não herda mais os dados da anterior
  (fila de saída, recusa automática, placar, Histórico, conquistas, conversas),
  com aviso.
- Na VM, o navegador volta a receber "não mudou" (304) com o Cloudflare na
  frente; a VM responde a API pelo mesmo caminho que o Cloudflare.
- A extensão só aparece onde instala (Chromium de computador).
- Trocar de idioma traduz na hora o aviso do Desfazer, a linha do offline, a
  pílula e o botão de Filtros.
