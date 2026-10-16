// FONTE ÚNICA de subir o `server/node.mjs` numa ferramenta: os smokes, o
// diag-replay e o gerar-splash. Um script novo que precise do app servido
// IMPORTA daqui — `test/servidor-local.test.mjs` reprova quem subir por conta
// própria.
//
// Existe porque a guarda estava COPIADA em três scripts e faltava em quatro, e
// sem ela a medição é sequestrada em silêncio: com a porta ocupada (um processo
// esquecido, ou o smoke de OUTRO agente rodando ao mesmo tempo) o `spawn` morre
// com EADDRINUSE, a sonda de saúde passa com o servidor ALHEIO, e o smoke mede
// outro código. Aconteceu na auditoria de 2026-09-26, com dois agentes rodando
// o smoke de layout: um mediu o código do outro até alguém matar o processo.
//
// Duas guardas, e a segunda é a que decide:
// 1. a porta tem que estar LIVRE antes do `spawn` — senão, erro claro, com a
//    saída (a variável de ambiente que troca a porta);
// 2. "pronto" é o PRÓPRIO processo dizer que ocupou a porta: a linha
//    "rodando em http://…:<porta>" que o node.mjs imprime ao escutar. Sinal
//    POSITIVO (gotcha #62): uma sonda HTTP que responde não diz QUEM respondeu,
//    e a porta pode ser tomada entre a guarda 1 e o `spawn`.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// `variavel`: o que troca a porta, pra mensagem de erro dizer o caminho — o
// nome de uma variável de ambiente (`SMOKE_PORT`) ou uma FLAG da linha de
// comando (`--porta`, a do diag-replay). `stderr`: 'inherit' (padrão) ou 'ignore'.
export async function subirServidorLocal({ porta, env = {}, variavel = 'SMOKE_PORT', tetoMs = 15000, stderr = 'inherit' } = {}) {
  const base = `http://127.0.0.1:${porta}`;
  // O caminho no formato que quem LÊ aceita: variável é `NOME=valor`, flag é
  // `--nome valor`. Com `=` pra todos, o diag-replay sugeria `--porta=<outra
  // porta>`, que o parser dele não lê — a porta sugerida era ignorada e ele
  // tentava a mesma de novo (auditoria de 2026-09-29, V8).
  const comoTrocar = variavel.startsWith('--') ? `${variavel} <outra porta>` : `${variavel}=<outra porta>`;
  const sair = (msg) => {
    console.error(`\n✗ ${msg}`);
    console.error('  Confira com: ps -eo pid,args | grep "[s]erver/node.mjs"');
    console.error(`  Ou rode noutra porta: ${comoTrocar}`);
    process.exit(1);
  };
  let ocupada = false;
  try {
    await fetch(base + '/', { signal: AbortSignal.timeout(1500) });
    ocupada = true;
  } catch (e) { /* ninguém atendeu: a porta está livre, que é o que se quer */ }
  if (ocupada) sair(`a porta ${porta} já está ocupada por outro processo: o teste mediria o servidor ERRADO.`);

  const servidor = spawn(process.execPath, [join(RAIZ, 'server', 'node.mjs')], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(porta), HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', stderr],
  });
  process.on('exit', () => { try { servidor.kill(); } catch (e) { /* já saiu */ } });

  const pronto = await new Promise((ok) => {
    let texto = '';
    const teto = setTimeout(() => ok({ motivo: 'teto' }), tetoMs);
    // O `data` deixa o stdout FLUINDO até o fim: sem ninguém lendo, o buffer
    // do pipe enche e o servidor trava no próximo `console.log`.
    servidor.stdout.on('data', (b) => {
      texto += b;
      const m = /rodando em http:\/\/\S+:(\d+)/.exec(texto);
      if (m && Number(m[1]) === Number(porta)) { clearTimeout(teto); ok({ ok: true }); }
    });
    servidor.on('exit', (code) => { clearTimeout(teto); ok({ motivo: 'morreu', code }); });
  });
  if (!pronto.ok) {
    if (pronto.motivo === 'morreu') sair(`o servidor do teste morreu ao subir (código ${pronto.code}) — quase sempre a porta ${porta} ocupada.`);
    sair(`o servidor não disse que subiu em ${base} depois de ${tetoMs / 1000} s.`);
  }
  return { servidor, base };
}
