// Sobe o adaptador da VM (`server/node.mjs`) numa porta LIVRE e diz qual.
//
// As portas eram fixas (8218, 8351…8354, 8471…8474). Com duas suítes rodando
// ao mesmo tempo na mesma máquina, um teste falava com o servidor do OUTRO, ou
// não achava o seu, e reprovava com ECONNREFUSED: quatro agentes da auditoria
// de 2026-09-26 toparam com isso, cada um achando que era o seu código. Com a
// porta 0 o sistema escolhe uma livre, e o servidor a imprime quando já está
// escutando — então não há mais laço de "espera subir" adivinhando o momento.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function subirVM(env = {}) {
  const p = spawn(process.execPath, [join(RAIZ, 'server', 'node.mjs')], {
    env: {
      ...process.env, HOST: '127.0.0.1',
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      ...env, PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let log = '';
  const porta = await new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error('a VM não disse em que porta subiu em 15 s')), 15000);
    p.stdout.on('data', (b) => {
      log += b;
      const m = /rodando em http:\/\/[^\s]+:(\d+)/.exec(log);
      if (m && Number(m[1]) > 0) { clearTimeout(prazo); resolve(Number(m[1])); }
    });
    p.once('exit', (c) => { clearTimeout(prazo); reject(new Error(`a VM saiu antes de subir (código ${c})`)); });
  });
  return { porta, url: (c) => `http://127.0.0.1:${porta}${c}`, parar: () => p.kill() };
}
