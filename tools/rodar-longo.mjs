#!/usr/bin/env node
// RODAR comando LONGO em segundo plano sem deixar VIGIA ZUMBI.
//
// O defeito que isto conserta já aconteceu e ficou 34 minutos rodando sem
// ninguém ver: eu lançava o smoke em background escrevendo num log, e ao lado
// um vigia `until grep -q "EXIT=" log; do sleep 15; done`. Quando eu MATAVA o
// smoke (pra regerar `js/min/` e rodar de novo), o `EXIT=` nunca era escrito e
// o vigia ficava polindo pra sempre um arquivo que nunca mais mudaria. Três
// deles vivos ao mesmo tempo, e o owner é que percebeu.
//
// São DOIS erros, e os dois já têm gotcha neste repo:
//
//  · #62 — o vigia inferia "ainda está rodando" da AUSÊNCIA do sentinela. Mas
//    ausência é ambígua: significa "não terminou" E "terminou de um jeito que
//    não escreve". Sinal negativo não distingue os dois.
//  · #28 — `ps aux | grep "[s]moke-browser" | wc -l` devolvia 2 e eu lia
//    "rodando": um era o processo, o outro o `sh -c` que CARREGA O TEXTO DO
//    COMANDO. Estado de processo se lê pelo artefato, não por um padrão que
//    casa com a própria linha de comando.
//
// O conserto tem TRÊS saídas independentes, e nenhuma depende das outras:
//
//   1. SENTINELA SEMPRE ESCRITO. O estado vai num arquivo IRMÃO (`<log>.estado`)
//      e é gravado no fim NORMAL, no fim com ERRO e também ao ser MORTO — o
//      trap de SIGTERM/SIGINT/SIGHUP fecha o ciclo. O log fica limpo (só a
//      saída do comando), então ninguém precisa grepar texto de comando.
//   2. PROVA DE VIDA POSITIVA. Mesmo que o estado diga "rodando", o vigia
//      confere se o PID EXISTE. Estado "rodando" com PID morto é exatamente o
//      caso zumbi — e aí ele sai na hora, em vez de esperar pra sempre. Isto
//      cobre o `kill -9`, em que nenhum trap roda.
//   3. TETO. Mesmo que as duas acima falhem, o vigia desiste em `--teto-min`.
//      Espera sem teto é como um erro de minutos vira um erro de horas.
//
// Uso:
//   node tools/rodar-longo.mjs <log> -- <comando> [args...]
//   node tools/rodar-longo.mjs --esperar <log> [--teto-min N] [--intervalo-ms N]
//
// Zero dependência, Node 22 (o piso de `tools/`).

import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { setTimeout as dormir } from 'node:timers/promises';

const TETO_MIN_PADRAO = 30;
const INTERVALO_MS_PADRAO = 10000;
// Carência entre o SIGTERM educado e o SIGKILL no GRUPO. Medido: o comando
// real é `npm run test:browser`, então o que interessa é NETO — o `npm` morre
// e o `node tools/smoke-browser.mjs` fica. 1,5s é folga pra um encerramento
// limpo sem transformar "matei" numa espera perceptível.
const CARENCIA_MS = 1500;

export const estadoDe = (log) => log + '.estado';

// Leitura TOLERANTE: o arquivo pode ser lido no meio de uma escrita, e um
// vigia que explode por JSON truncado é um vigia que some sem dizer por quê.
export function lerEstado(log) {
    try { return JSON.parse(readFileSync(estadoDe(log), 'utf8')); } catch (e) { return null; }
}

function gravarEstado(log, obj) {
    // Escrita ATÔMICA por rename: sem isto o vigia pode ler um arquivo pela
    // metade justamente no instante que importa (a transição pra 'fim').
    const alvo = estadoDe(log);
    const tmp = alvo + '.tmp';
    writeFileSync(tmp, JSON.stringify(obj));
    try { renameSync(tmp, alvo); } catch (e) { writeFileSync(alvo, JSON.stringify(obj)); }
}

// A ÚNICA pergunta que não mente: o processo existe? `kill(pid, 0)` não manda
// sinal nenhum — só testa. `ESRCH` = não existe; `EPERM` = existe e é de outro
// dono (aqui não acontece, mas tratar como VIVO é o lado seguro do erro).
export function pidVivo(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; }
    catch (e) { return e && e.code === 'EPERM'; }
}

// Classifica o que o vigia deve fazer. Separada da espera de propósito: é a
// regra inteira, e dá pra testá-la sem esperar um segundo sequer.
export function veredito(est, { agoraMs, tetoMs } = {}) {
    if (!est) return { fim: false, motivo: 'sem-estado' };
    if (est.estado !== 'rodando') {
        return { fim: true, motivo: est.estado, codigo: est.codigo, sinal: est.sinal };
    }
    // ESTADO diz rodando, mas o PID não existe: o processo morreu sem escrever
    // (kill -9, OOM, container reciclado). É o zumbi — e ele acaba AQUI.
    if (!pidVivo(est.pid)) return { fim: true, motivo: 'orfao', codigo: null };
    if (tetoMs && agoraMs - (est.inicioMs || 0) > tetoMs) {
        return { fim: true, motivo: 'teto', codigo: null };
    }
    return { fim: false, motivo: 'rodando' };
}

async function rodar(log, argv) {
    const fluxo = createWriteStream(log, { flags: 'w' });
    await new Promise((ok) => fluxo.on('open', ok));
    // `detached` faz o filho virar LÍDER DE GRUPO, e é isso que dá pra matar a
    // árvore inteira com um sinal só. Sem ele, matar o `npm` deixa o neto vivo
    // — MEDIDO: o `node tools/smoke-browser.mjs` seguiu rodando depois de o
    // wrapper morrer. Meia correção é o gotcha #14.
    const filho = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    filho.stdout.pipe(fluxo, { end: false });
    filho.stderr.pipe(fluxo, { end: false });

    const base = { pid: process.pid, filho: filho.pid, cmd: argv.join(' '),
                   inicioMs: Date.now(), inicio: new Date().toISOString() };
    gravarEstado(log, { ...base, estado: 'rodando' });

    let fechado = false;
    const fechar = (estado, extra) => {
        if (fechado) return;                 // morrer duas vezes não reescreve o motivo
        fechado = true;
        gravarEstado(log, { ...base, estado, fimMs: Date.now(), ...extra });
    };

    // MORRER TAMBÉM ESCREVE. É esta linha que impede o zumbi: quem me matar
    // deixa o vigia livre, em vez de deixá-lo esperando um sentinela que só o
    // caminho feliz escreveria.
    // Negativo = GRUPO. O fallback no PID sozinho cobre o caso de o `detached`
    // não ter pegado (e aí pelo menos o filho morre, em vez de ninguém morrer).
    const matarGrupo = (sig) => {
        try { process.kill(-filho.pid, sig); }
        catch (e) { try { process.kill(filho.pid, sig); } catch (e2) {} }
    };
    // Só RE-ENTRÂNCIA: dois sinais seguidos não podem agendar duas carências.
    //
    // Eu escrevi este flag também pra guardar o `close` do filho, supondo que
    // ele dispararia quando o `sh` morresse e faria o wrapper sair antes do
    // SIGKILL. MEDIDO com a guarda removida de propósito: o wrapper seguiu
    // vivo em 1,0s e o neto morreu na carência. O `close` do Node espera os
    // PIPES fecharem, e o neto HERDA os pipes do filho — então ele não dispara
    // enquanto houver neto vivo, que é exatamente o caso que me preocupava. A
    // guarda saiu do `close`: guard que não distingue as duas versões é
    // decoração, e remendá-lo até passar teria travado uma corrida inexistente.
    let matando = false;
    for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
        process.on(s, () => {
            if (matando) return;
            matando = true;
            matarGrupo('SIGTERM');
            fechar('morto', { sinal: s });   // carimba ANTES da carência: o vigia sai já
            // `npm` repassa o TERM de má vontade. Sem este SIGKILL o neto
            // sobrevive — e um smoke órfão é o zumbi de novo, só que caro.
            setTimeout(() => { matarGrupo('SIGKILL'); process.exit(143); }, CARENCIA_MS);
        });
    }
    // Última rede: qualquer saída não prevista ainda carimba o arquivo.
    process.on('exit', () => fechar('morto', { sinal: 'exit' }));

    const codigo = await new Promise((ok) => {
        // `fechar` já é idempotente, então um `close` que chegue depois de uma
        // morte não reescreve o motivo — não é preciso guardá-lo aqui.
        filho.on('close', (c, sinal) => { fechar('fim', { codigo: c, sinal }); ok(c); });
        filho.on('error', (err) => {
            fechar('erro', { codigo: null, erro: String(err && err.message) });
            ok(1);
        });
    });
    fluxo.end();
    process.exit(codigo == null ? 1 : codigo);
}

async function esperar(log, { tetoMin, intervaloMs }) {
    const tetoMs = tetoMin * 60000;
    const comecou = Date.now();
    for (;;) {
        const est = lerEstado(log);
        const v = veredito(est, { agoraMs: Date.now(), tetoMs });
        if (v.fim) {
            const seg = Math.round((Date.now() - (est?.inicioMs || comecou)) / 1000);
            if (v.motivo === 'fim') {
                console.log(`FIM codigo=${v.codigo} em ${seg}s · ${log}`);
                process.exit(v.codigo || 0);
            }
            // Os três desfechos que ANTES viravam espera infinita. Cada um sai
            // com código próprio pra não se passar por sucesso.
            console.log(`${v.motivo.toUpperCase()} após ${seg}s · ${log}`
                + (v.sinal ? ` (${v.sinal})` : ''));
            process.exit(v.motivo === 'orfao' ? 4 : v.motivo === 'teto' ? 5 : 6);
        }
        if (!est && Date.now() - comecou > 30000) {
            console.log(`SEM-ESTADO após 30s · ${log} — o comando foi lançado por rodar-longo?`);
            process.exit(7);
        }
        await dormir(intervaloMs);
    }
}

function principal(args) {
    if (args[0] === '--esperar') {
        const log = args[1];
        if (!log) { console.error('uso: --esperar <log> [--teto-min N] [--intervalo-ms N]'); process.exit(2); }
        const num = (flag, padrao) => {
            const i = args.indexOf(flag);
            return i >= 0 ? Number(args[i + 1]) : padrao;
        };
        return esperar(log, { tetoMin: num('--teto-min', TETO_MIN_PADRAO),
                              intervaloMs: num('--intervalo-ms', INTERVALO_MS_PADRAO) });
    }
    const corte = args.indexOf('--');
    if (corte <= 0 || corte === args.length - 1) {
        console.error('uso: node tools/rodar-longo.mjs <log> -- <comando> [args...]');
        process.exit(2);
    }
    return rodar(args[0], args.slice(corte + 1));
}

// `import` pra teste não executa nada — só a chamada direta roda.
if (process.argv[1] && process.argv[1].endsWith('rodar-longo.mjs')) {
    principal(process.argv.slice(2));
}
