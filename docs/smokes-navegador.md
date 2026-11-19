# Os smokes de navegador

Referência de dev: como os smokes de `tools/` (Playwright) funcionam, por que o
motor é pinado, e o que é particular do sandbox. O `CLAUDE.md` guarda só os
comandos de uso e as duas instruções permanentes (países, cookies do dono);
aqui mora o resto, pra consultar quando for mexer num smoke ou reproduzir o
CI localmente.

**`tools/smoke-browser.mjs`** (`npm run test:browser`, no CI) renderiza o card em vários aparelhos × 4 idiomas × os tipos de pedido e MEDE: rolagem dupla, alvo de toque < 44px, estouro horizontal, área rolável sem nome, caixa longa com teto, português vazando fora do pt. Os smokes moram em `tools/` e não em `test/` de propósito: o `node --test` varre `test/` inteiro, e com navegador ali a suíte deixaria de ter zero dependência.

- **O Playwright do CI é o `latest`** (decisão do dono, 2026-09-23: *"uma coisa boa seria sempre testarmos com a última versão de navegador disponível"*), instalado com `npm i --no-save "playwright@$PLAYWRIGHT_VERSAO"` (`latest`) e `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, e o navegador depois, do próprio Playwright. Uma versão nova pode reprovar um PR que não mexeu em nada: é informação (o navegador que vai chegar no celular, ou o teste a ajustar). Se um Playwright vier quebrado, fixe a versão no workflow com o motivo e a data; `test/navegador.test.mjs` cobra o `latest` pra o pino ser ato deliberado. O Playwright mais novo anda ~1 versão atrás do Chrome estável, e não se usa Chrome de fora dele (nem o `channel: 'chrome'` do runner: o caminho da imagem não é contrato).
- **Todo script que SOBE o app passa por `tools/servidor-local.mjs`** (porta livre antes; "pronto" é o próprio processo dizer em que porta subiu). As portas trocam por variável (`SMOKE_PORT`, `PORTA_FLUXO`, `PORTA_OFFLINE`, `SMOKE_DIAG_PORT`, `SPLASH_PORT`, `--porta`): smokes em paralelo pedem uma cada. `test/servidor-local.test.mjs` cobra os scripts.
- **Todo script que abre navegador passa por `tools/navegador.mjs`**: exige o Playwright do REPO (o global do sandbox, em `/opt/pw-browsers`, só com `PLAYWRIGHT_GLOBAL=1`, avisando), imprime `navegador: Chromium X · Playwright Y (origem)`, não tem plano B de navegador e avisa quando o npm tem versão mais nova. `test/navegador.test.mjs` reprova script que carregue ou abra navegador por conta própria. **Reproduzir o CI aqui é instalar a versão que o log dele imprimiu:**

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright@latest
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-latest npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-latest npm run test:offline
```

**O WebKit roda num job PARALELO** (pedido do dono): o motor do Safari e de todo navegador do iPhone. `MOTOR=webkit` troca o motor; o job roda layout, fluxo, presença e offline (só as seções que bloqueiam o worker). O que é dele, medido:
- Precisa das bibliotecas do SISTEMA (`--with-deps`, só nesse job) e não abre com chave de linha de comando do Chromium (`abrirNavegador` tira o `args`).
- Avisa no console com nível de erro coisas que não são defeito do app (o `interactive-widget` do viewport; o "access control checks" do pedido que o smoke aborta): a lista FECHADA é o `ruidoDoMotor()`, frase exata, ancorada e com o motivo.
- Um "negado" de localização vale pra PÁGINA inteira: o passo do "concedido" roda numa página recarregada. É o Safari de verdade: quem libera depois precisa reabrir o app, e a dica `filters.sort.hint.negado` diz isso.
- Com o service worker no comando, a rota do Playwright não vê os pedidos da página: as seções que ligam o worker ficam só no Chromium (pulo pelo nome; `test/navegador.test.mjs` reprova contexto que ligue o worker fora delas).
- Fechar a página no meio da instalação do worker deixa o registro preso em `installing`: espere o worker ASSUMIR antes de fechar a página que o registrou.
- As abas do mesmo contexto ficam em processos diferentes (o `localStorage` chega atrasado): a seção 9i do offline (sem `navigator.locks`) fica fora do WebKit; o defeito no iOS < 15.4 está pra decisão do dono.
- O processo da página às vezes CAI sob carga ("Target crashed"): a espera para e diz `PAGINA_MORTA` (`tools/esperar-saida.mjs`; erro de navegação segue sendo "ainda não"). Queda de página é falha do motor a registrar, não do app.
- **"Parado" é estar NO LUGAR** (o retângulo bate com o `left`/`top` escrito e nenhuma animação anda), nunca amostras iguais: a transição do FAB fica no ponto de partida por mais de 300 ms.
- **Antes de pôr uma falha na conta do motor, rode o mesmo cenário no outro** (uma "do WebKit" era do app, 1 em 8 nos dois).

O que só o Chromium mede é pulado pelo nome (`pularForaDoChromium`), com a lista e o motivo em `test/navegador.test.mjs` (pulo novo entra lá ou reprova). O job não é o Safari do iPhone: não pega teclado de verdade, PWA instalado nem o apagamento de armazenamento do iOS. Reproduzir: `npx playwright install-deps webkit` (uma vez), `PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-latest npx playwright install webkit`, `MOTOR=webkit PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-latest npm run test:presenca`.

**Fechar como o usuário fecha:** no Chromium, `close({ runBeforeUnload: true })` (dispara `pagehide` e `visibilitychange`); no WebKit ele não fecha, e o certo é `close()`. No smoke do offline, pela porta única `fecharComoOUsuario`.

## Navegador de verdade no sandbox

- **O Chromium do sandbox chega à internet; falta confiar na CA da saída de rede** (o proxy re-termina o TLS e o banco NSS vem vazio). Sessão nova: `apt-get install -y libnss3-tools && certutil -A -d sql:$HOME/.pki/nssdb -n ccr-agent-proxy -t "C,," -i /root/.ccr/agent-proxy-ca.crt`. Sem isso o `npm run test:fluxo` reprova com `ERR_CERT_AUTHORITY_INVALID` nos tiles: nunca "conserte" o smoke por isso.
- **O WME recém-aberto cai no servidor da América do Norte**: ponha `localStorage.editorLocation = {"code":"row","locale":"pt-BR"}` antes de carregar (`addInitScript`).
- **Pra provar mudança visual**, suba o `server/node.mjs`, abra o app pelo `tools/navegador.mjs`, injete estado (`AppState.queue`, `showCurrentPlace()`) e compare capturas antes/depois pixel a pixel (PIL disponível). No `page.evaluate`, nada de `eval(string)` (a CSP barra), e função como argumento não serializa: a medição vai inline no callback. O "antes" vem de um worktree (`git worktree add --detach <dir> origin/main`), não de `git stash`.
- **Pra valer pro que está no ar**, baixe os arquivos publicados e compare com a main: a única diferença esperada é o script do Bot Fight Mode que o Cloudflare injeta no `index.html`.
