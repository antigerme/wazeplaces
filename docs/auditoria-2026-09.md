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
| #251 | 2026092505 | rodada 3: o diagnóstico sem o script do Cloudflare, fim da fila com pulados, retentativa de foto, irmãos na fila, pilha/foco no autor, Street View no zoom, presença (país no meio, relógio, leitor de tela, lista fechada, ids com teto), cookies colados limpos em todo fechamento, IndexedDB com teto, segredo do pareamento fora do relatório | mergeado em 2026-09-25 23:38 UTC (CI verde nos dois jobs); **60 ✓ · 0 ✗** em produção (2026-09-26 01:25), com o diagnóstico conferindo 13 arquivos com o servidor ("diferentes: 0") e o desvio do relógio medido (-8 ms) |

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

Validação feita: `npm test` **1072/1072** sobre a main nova, arquivos gerados sem
diferença, versão **2026092601** (dia novo), CHANGELOG e notas no CLAUDE.md
(commit "Versão 2026092601"). **Falta**: os 4 smokes (rodando em 2026-09-26
~01:35), PR, CI, merge, produção.

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

## 4b. Rodada 2 — os achados e pra onde cada um foi (2026-09-26)

Os seis auditores terminaram (sobre o lote 5, `wp-lote5` @ bb27dca). **Decisão:
o lote 5 NÃO sobe sozinho** — o smoke de layout reprovou nele (bloco
`fila-saida`, "ABERTURA": o esvaziamento espera a conta e o `montar()` do smoke
injeta o perfil sem o caminho real; ver O2/O3) —, e sobe junto com os
consertos desta rodada, num PR só. Os consertos estão sendo feitos por seis
agentes, cada um num worktree próprio a partir de `lote6-trabalho`
(= lote 5 + "Diagnóstico v10: o 'já tratado' não é falha"), com teste que
reprova sem o conserto e sabotagem; depois eu junto (cherry-pick), regenero os
gerados, rodo tudo e subo. Se a sessão cair antes: os branches locais
`fix-serv`, `fix-hist`, `fix-pres`, `fix-auth`, `fix-off`, `fix-card` somem com
o contêiner — refaça a partir desta lista.

**Servidor** (`fix-serv`): S1 `parear cancel` apaga sem ler (cota do KV) · S2
`testar-cookies` regrava a sessão do token do corpo com cookies de OUTRA conta,
mesmo recusada · S3 cache da releitura recarimbado na escrita (exclusões em
série apagam foto subida depois) + aprovar não invalida · S5 cookies em formato
de cabeçalho nunca rotacionam · S6 releitura do duplicado sem teto (passa dos
45 s do cliente) · S8 `idValido` só no lote · S9 erro de login passageiro sem
chave (português cru) · S10 quadro gRPC truncado vira sucesso · S11 VM: MIME de
.jpg/.txt, `extensao-chrome/`+`LICENSE` 404, rota desconhecida (medir o CF) ·
S12 413 com RST · S13 bbox do perfil (MultiPolygon, pilha). **Sem mudança**: S4
(`claim` não atômico: só comentário — quem tem o código já entra) e S7
(cabeçalhos a mais na /api da VM, inofensivo).

**Histórico** (`fix-hist`): o `openModal` rodar a limpeza dos modais que
esconde (raiz de H15, P3, A1) · H1 painel não redesenha (idioma/pouso) · H2
trocar idioma destrava Poliglota e recria conquistas depois do Sair · H3 duas
abas apagam histórico/conquistas/autores · H4 foco no body · H5 Resumo sem
perfil ("Editor L1") · H6 dia UTC nos autores · H7 "nos últimos 30 dias" falso
· H8 esquecer autor deixa o "✕ N" no card · H9 "Fim da fila" com confete e
"Tudo limpo" · C13 "Tudo limpo" dentro da janela do Desfazer · H11 conquistas
do pouso na hora do pouso · H12 1ª passada engole conquista de evento · H13/C9
renomear sem `epocaDaSessao` · H14 aviso da recusa automática com 2+ autores ·
H15 foco ao fechar o Resumo · H16 plural e data da imagem do Resumo · H19
acessibilidade da aba · H20 francês · H21 Desfazer do lightbox não conta.

**Presença** (`fix-pres`): P1 selo de mensagem nova com a conversa aberta e
lida · P2 tempo real parado depois de uma falha do token · P3 anexo/conversa
vazando (parte da presença) · P4 erro do `abrir` some com mensagem nova · P5
"lida" do `abrir` dado por enviado quando falhou · P6 conversa por cima da tela
de entrada na queda · P7/P8/P9 leitor de tela · P10 lista da carona no país
errado · P12 "Ver mensagens anteriores" sem sinal · P13 prazo cru no diário.

**Entrada e Ajuda** (`fix-auth`): A1 login pela extensão com modal de entrada
aberto · A3 avatar de quem saiu · A4 `autorEmFoco` sobrevive ao Sair · A5
extensão com conta recusada (4 tentativas, sem motivo) · A6 link de pareamento
vencido num aparelho logado · A8 camadas abertas por cima da entrada na queda ·
A9 tela antes do JS ("nível 3+", extensão recomendada no celular) · A10 treino
deslogado · A12 divisor solto sem a extensão · A13 texto de privacidade × cache
da releitura · A15 "Entendi" invisível no escuro · A16 termos · A17
`maxlength` cortando o código colado · A18 link manual some · A19 `?action=` sem
sessão · A20 mensagens de sessão que afirmam o que o app não sabe · A21 sobras
depois do Sair · A22 foco · A23 "By AG" · A24 `saiuNestaPagina` · A25 Ajuda no
celular · A26 iPhone instalado + QR (hipótese de plataforma).

**Offline e fila** (`fix-off`): O1 **ALTA** laço sem teto com 401/403
persistente na escrita (~2,2 req/s) · O2 **ALTA** perfil pelo alarme falso pula
o `aoConhecerConta` (a conta anterior age no nome de quem entrou) · O3 item sem
conta sai no nome de qualquer conta · O4 fila guardada sem região · O5 descarga
com "lie-fi" perde a decisão · O6 401 passageiro na reposição para a fila · O7
tile guardado nunca revalida · O8 item transient na cabeça segura a fila · O9
varredura sem teto de tempo · O10 base do diagnóstico sem teto · O11 geração da
lista de tiles no worker · + o `montar()` do smoke de layout passar pelo
caminho real. (Hipótese do auditor derrubada: `na-tiles` EXISTE — 200, PNG
512×512.)

**Card, mapa e lightbox** (`fix-card`): C1 **ALTA** pinça de zoom na foto
comete a ação · C2 **ALTA** arrastar com o mouse pela foto/mapa (drag nativo)
deixa o card colado no cursor e o clique seguinte comete · C3 ação cai num
pedido que ninguém viu depois de aprovar foto · C4 mapa ampliado vazio com
ponto a 82 km · C5 mini-mapa não refaz quando a caixa encolhe · C6 arraste pra
baixo com desvio comete · C7 setas na lista do diff · C8 Desfazer de foto pelo
teclado · C10 ✨ na foto errada depois de desfazer · C11 aviso "fora deste
mapa" do ponto errado · C12 pílula estourando no modo de edição · diff do
`lockRank` 0-indexado.

**Pro owner (mudam tela ou produto — não implementar sem ele):** H10 resumo de
mês fechado · H17 três contrastes abaixo do mínimo (etiqueta "nova", número de
rejeitados, ✕ do Resumo) · H18 posição do cabeçalho LIDOS/REJEITADOS · H22
recusa automática contando pra patente · H23 "Dias ativos N de 30" · P11 "Fora
do app agora" pra quem está no app noutro país · A14 contraste do "Instalar na
tela inicial"/"Tentar novamente" — além dos três de antes (§8).

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
1. ~~Mergear o #251 e auditar a produção da 2026092505~~ (60 ✓ · 0 ✗). Melhoria
   pequena anotada pro próximo lote: o diagnóstico conta um "já tratado"
   (`already_processed`, que pro app é sucesso) como "falha" nas chamadas.
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
