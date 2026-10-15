// O VIGIA NÃO PODE VIRAR ZUMBI.
//
// Isto nasceu de três vigias vivos ao mesmo tempo, o mais velho com 34 minutos,
// polindo logs de smokes que eu tinha MATADO pra regerar `js/min/`. O sentinela
// que eles esperavam (`EXIT=` no log) só era escrito pelo caminho feliz, então
// matar o comando condenava o vigia a esperar pra sempre. Quem percebeu foi o
// owner, perguntando "realmente ainda estão executando?".
//
// O que estes testes cobram é que NENHUM desfecho deixe o vigia esperando:
// fim normal, fim com erro, morto com SIGTERM (o trap escreve) e morto com
// SIGKILL (o trap NÃO roda — quem salva é a prova de vida pelo PID).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as dormir } from 'node:timers/promises';
import { lerEstado, veredito, pidVivo, estadoDe } from '../tools/rodar-longo.mjs';

const FERRAMENTA = fileURLToPath(new URL('../tools/rodar-longo.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'rodar-'));
const logNovo = (nome) => join(dir, nome + '.log');

function lancar(log, cmd) {
  return spawn(process.execPath, [FERRAMENTA, log, '--', ...cmd], { stdio: 'ignore' });
}
// O vigia, do jeito que eu de fato o uso: intervalo curto pro teste não demorar.
function vigiar(log, extra = []) {
  const p = spawn(process.execPath, [FERRAMENTA, '--esperar', log, '--intervalo-ms', '150', ...extra],
                  { stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  p.stdout.on('data', (b) => { saida += b; });
  return new Promise((ok) => p.on('close', (c) => ok({ codigo: c, saida })));
}
async function ateRodando(log, teto = 5000) {
  const lim = Date.now() + teto;
  while (Date.now() < lim) {
    const e = lerEstado(log);
    if (e && e.estado === 'rodando') return e;
    await dormir(30);
  }
  throw new Error('o estado nunca virou "rodando" — a ferramenta não subiu');
}

test('fim NORMAL: o log tem a saída e o vigia sai com o código do comando', async () => {
  const log = logNovo('ok');
  lancar(log, [process.execPath, '-e', "console.log('oi')"]);
  const r = await vigiar(log);
  assert.equal(r.codigo, 0, 'o vigia não devolveu o código 0 do comando');
  assert.match(r.saida, /FIM codigo=0/);
  assert.match(readFileSync(log, 'utf8'), /oi/, 'a saída do comando não foi parar no log');
  assert.equal(lerEstado(log).estado, 'fim');
});

test('fim com ERRO: o vigia propaga o código, não finge sucesso', async () => {
  const log = logNovo('erro');
  lancar(log, [process.execPath, '-e', 'process.exit(3)']);
  const r = await vigiar(log);
  assert.equal(r.codigo, 3, `vigia saiu ${r.codigo} para um comando que saiu 3`);
});

test('MORTO com SIGTERM: o trap escreve e o vigia é LIBERADO', async () => {
  // Este é o caso do dia a dia: eu mato o smoke pra regerar `js/min/`. Antes,
  // aqui é que o vigia ficava órfão.
  const log = logNovo('term');
  const p = lancar(log, [process.execPath, '-e', 'setTimeout(()=>{}, 60000)']);
  await ateRodando(log);
  const espera = vigiar(log);
  p.kill('SIGTERM');
  const r = await espera;
  assert.notEqual(r.codigo, 0, 'morrer não pode ser reportado como sucesso');
  assert.match(r.saida, /MORTO/, `o vigia não reconheceu a morte: ${r.saida}`);
  assert.equal(lerEstado(log).estado, 'morto', 'o trap não carimbou o estado');
});

test('MORTO com SIGKILL: sem trap, quem salva é a prova de vida pelo PID', async () => {
  // `kill -9` não deixa NENHUM trap rodar: o estado fica em "rodando" para
  // sempre. É o zumbi na forma mais pura, e é por isso que o vigia não pode
  // confiar só no que está escrito no arquivo.
  const log = logNovo('kill');
  const p = lancar(log, [process.execPath, '-e', 'setTimeout(()=>{}, 60000)']);
  const est = await ateRodando(log);
  p.kill('SIGKILL');
  await dormir(300);
  assert.equal(lerEstado(log).estado, 'rodando',
    'premissa do teste quebrou: com SIGKILL o estado TEM que ficar "rodando"');
  assert.equal(pidVivo(est.pid), false, 'o PID deveria estar morto');
  const t0 = Date.now();
  // TETO curto de propósito: ele é a rede que faz a SABOTAGEM deste guard
  // reprovar em 3s em vez de travar a suíte por 30 minutos. Com a correção no
  // lugar o órfão é pego na 1ª sondagem (150ms) e o teto nem é alcançado —
  // ou seja, ele não mascara nada; só troca "trava" por "reprova".
  const r = await vigiar(log, ['--teto-min', '0.05']);
  const seg = (Date.now() - t0) / 1000;
  assert.equal(r.codigo, 4, `órfão devia sair 4, saiu ${r.codigo}: ${r.saida}`);
  assert.match(r.saida, /ORFAO/);
  assert.ok(seg < 10, `o vigia levou ${seg}s pra detectar o órfão — era pra ser na 1ª sondagem`);
});

test('matar leva o NETO junto — não basta matar o filho', async () => {
  // O comando real é `npm run test:browser`: o `npm` é o filho e o
  // `node tools/smoke-browser.mjs` é o NETO. MEDIDO antes da correção, matando
  // o wrapper: o npm morria e o neto seguia rodando com o Chromium junto — o
  // vigia era liberado (o estado ia pra "morto") e mesmo assim sobrava
  // trabalho órfão queimando CPU. Zumbi de novo, só que caro. Meia correção é
  // o gotcha #14, e aqui ela passaria nos outros cinco testes deste arquivo.
  const marca = 'neto-' + process.pid + '-' + Date.now();
  const log = logNovo('neto');
  // `; true` impede o `sh` de dar exec e sumir: é o que GARANTE um neto de
  // verdade. Sem isso o teste mediria de novo só o filho.
  const p = lancar(log, ['sh', '-c', `node -e "setTimeout(()=>{}, 60000)" ${marca}; true`]);
  // CONTAR SEM CONTAR A SI MESMO. `grep -c -- <marca>` casa com TRÊS coisas que
  // não são o neto: a linha do próprio `grep`, o `sh -c` que o `execSync`
  // cria pra rodá-lo, e os args do WRAPPER (que carregam o comando inteiro,
  // marca junto). É o gotcha #28 dentro do teste feito pra evitar o zumbi —
  // a primeira versão deste guard reprovou com o neto já morto, sobrando só
  // o instrumento se contando. Filtra-se em JS, com os dois excluídos por nome.
  const vivos = () => execSync('ps -eo args --no-headers').toString().split('\n')
    .filter((l) => l.includes(marca) && !l.includes('grep') && !l.includes('rodar-longo'))
    .length;
  const lim = Date.now() + 8000;
  while (vivos() < 1 && Date.now() < lim) await dormir(50);
  // CONTROLE: sem neto vivo aqui, o resto do teste não mede nada.
  assert.ok(vivos() >= 1, 'o neto nem chegou a nascer — o teste não mediria nada');
  p.kill('SIGTERM');
  const ate = Date.now() + 8000;
  while (vivos() > 0 && Date.now() < ate) await dormir(100);
  assert.equal(vivos(), 0, 'o NETO sobreviveu ao kill: sobra trabalho órfão, com Chromium junto');
});

test('neto que IGNORA o SIGTERM morre na carência, e o wrapper espera por ela', async () => {
  // O teste anterior passa só com `detached` + SIGTERM no grupo: quem obedece
  // ao TERM morre e pronto. Quem NÃO obedece é o caso que sobra — e sem ele o
  // `matando` e o SIGKILL da carência ficam sendo código nunca exercitado
  // (sabotei os dois e nada reprovou, que é a definição de decoração).
  //
  // São DUAS coisas ao mesmo tempo: o SIGKILL precisa existir, e o wrapper
  // precisa CONTINUAR VIVO até ele. Sem o `matando`, o `close` do filho — que
  // morre primeiro, porque foi ele que levou o sinal — faz o wrapper sair
  // antes da carência e abandonar o neto.
  const marca = 'teimoso-' + process.pid + '-' + Date.now();
  const log = logNovo('teimoso');
  // PRONTIDÃO POSITIVA, e não "apareceu no ps". O `ps` mostra o processo assim
  // que o `exec` acontece, ANTES de o JS rodar — então matar nesse instante
  // pega o neto sem o handler registrado e ele morre no TERM como qualquer um.
  // Foi assim que este teste reprovou duas vezes com o código certo. O neto
  // avisa que está pronto escrevendo um arquivo (gotcha #62: decida por sinal
  // positivo, nunca pela ausência de outro).
  const pronto = join(dir, marca + '.pronto');
  const p = lancar(log, ['sh', '-c',
    `node -e "process.on('SIGTERM',()=>{}); require('fs').writeFileSync('${pronto}','1');`
    + ` setTimeout(()=>{}, 60000)" ${marca}; true`]);
  const vivos = () => execSync('ps -eo args --no-headers').toString().split('\n')
    .filter((l) => l.includes(marca) && !l.includes('grep') && !l.includes('rodar-longo'))
    .length;
  const lim = Date.now() + 10000;
  while (!existsSync(pronto) && Date.now() < lim) await dormir(50);
  assert.ok(existsSync(pronto), 'o neto teimoso nunca ficou pronto — o teste não mediria nada');
  p.kill('SIGTERM');
  // CONTROLE do próprio cenário: logo depois do TERM ele TEM que seguir vivo,
  // senão o "teimoso" não é teimoso e o teste voltou a medir o caso fácil.
  await dormir(400);
  assert.ok(vivos() >= 1, 'o neto morreu no SIGTERM: o cenário não exercita a carência');
  const ate = Date.now() + 10000;
  while (vivos() > 0 && Date.now() < ate) await dormir(100);
  assert.equal(vivos(), 0, 'o neto que ignora SIGTERM sobreviveu: falta o SIGKILL da carência');
});

test('o veredito é PURO e decide os quatro desfechos sem esperar nada', () => {
  const vivo = { estado: 'rodando', pid: process.pid, inicioMs: Date.now() };
  assert.equal(veredito(vivo, { agoraMs: Date.now(), tetoMs: 60000 }).fim, false);
  // PID morto com estado "rodando" = órfão. 2**22 é acima do pid_max usual.
  const orfao = { estado: 'rodando', pid: 4194303, inicioMs: Date.now() };
  assert.equal(veredito(orfao, { agoraMs: Date.now(), tetoMs: 60000 }).motivo, 'orfao');
  // TETO: mesmo VIVO, espera sem fim é como um erro de minutos vira um de horas.
  assert.equal(veredito({ ...vivo, inicioMs: Date.now() - 99999 },
    { agoraMs: Date.now(), tetoMs: 1000 }).motivo, 'teto');
  assert.equal(veredito(null, { agoraMs: Date.now(), tetoMs: 1000 }).fim, false);
});

test('o ESTADO mora num arquivo irmão — o log fica só com a saída', () => {
  // O vigia antigo grepava o LOG atrás de `EXIT=`, e foi assim que `ps | grep`
  // passou a casar com o próprio texto do comando (gotcha #28). Separando, não
  // há texto de comando pra casar por acidente.
  assert.equal(estadoDe('/x/y.log'), '/x/y.log.estado');
  const fonte = readFileSync(FERRAMENTA, 'utf8');
  const codigo = fonte.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.ok(!/grep/.test(codigo), 'a ferramenta voltou a depender de grep no log');
});
