// Corpo da requisição no adaptador da VM (`server/node.mjs`). O Worker tem o
// dele (`lerCorpo`, em `worker/index.mjs`), com o MESMO teto e a MESMA resposta,
// que moram no core — o Worker não importa este módulo, que fala a língua dos
// streams do Node.
//
// Mora num módulo PRÓPRIO pra poder ser testado sem subir o servidor — o
// `node.mjs` abre a porta ao ser importado.
import { MAX_BODY_BYTES, RESPOSTA_CORPO_GRANDE } from './core.mjs';
export { MAX_BODY_BYTES };
// Depois do 413, o fechamento é em DUAS etapas (o "lingering close" do RFC 9112
// §9.6): o FIN sai junto com a resposta, e o servidor segue LENDO — e jogando
// fora — o resto do corpo antes de fechar de vez. Fechar com corpo ainda
// chegando é RST, e o RST apaga no cliente a resposta que ele ainda não leu.
// MEDIDO com o servidor em processo próprio, como a VM (8 MB, 200 pedidos por
// cliente; auditoria de 2026-09-26):
//   `req.destroy()` logo depois do `res.end` (o que havia) → 11% a 46% sem 413
//   `Connection: close` + `destroy()` no callback do `res.end` → 1,5% a 21%
//   `Connection: close` e o Node fechando sozinho (FIN e já o socket) → até 8,5%
//   as duas etapas                                 → 0 em 3.700, com e sem a CPU ocupada
// O dreno tem TETO nos dois eixos, porque quem manda pode não parar nunca:
// até 16 MB (com 5 MB, 3 de 180 corpos de 64 MB ainda perdiam o 413; com 16,
// nenhum) e até 5 s (o `lingering_timeout` do nginx) — daí, fecha de vez.
const DRENO_MAX_BYTES = 16_000_000;
const DRENO_MAX_MS = 5000;
// Junta BYTES e decodifica UMA vez no fim. `data += chunk` decodificava cada
// pedaço sozinho, e um caractere de vários bytes (acento, emoji) cortado na
// divisa entre dois pedaços virava `\uFFFD` — na VM, renomear "São João" ou
// mandar mensagem com acento podia gravar o texto corrompido. O Worker não tem
// o problema (lê o corpo inteiro antes de decodificar).
//
// Pelo `TextDecoder`, como o Worker, e não pelo `Buffer#toString`: o decoder
// tira o BOM do começo, o `toString` o deixava — e aí o `JSON.parse` falhava,
// o corpo virava {} e o mesmo POST dava 200 no Worker e 400 aqui (o
// comparador VM × Worker da auditoria de 2026-09-29).
export function readBody(req, res) {
  return new Promise((resolve) => {
    const pedacos = [];
    let bytes = 0;
    let tooLarge = false;
    let drenado = 0;
    let prazo = null;
    // O SOCKET, e não o `req`: com o corpo já inteiro o `req.destroy()` não
    // fecha a conexão (só a mensagem incompleta derruba o socket).
    const fecharDeVez = () => { clearTimeout(prazo); (req.socket || req).destroy(); };
    req.on('data', (c) => {
      if (tooLarge) {
        drenado += c.length;
        if (drenado > DRENO_MAX_BYTES) fecharDeVez();
        return;
      }
      pedacos.push(c);
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        pedacos.length = 0;   // o que já veio não serve mais; o dreno não guarda nada
        if (!res.headersSent) {
          // Com `Connection: close` o Node encerra o socket assim que a resposta
          // sai (`destroySoon`: FIN e, logo em seguida, o fechamento) — é a
          // 3ª linha da tabela. Nesta conexão ele só manda o FIN; o fechamento
          // de vez é do `fecharDeVez`, quando o corpo termina ou um teto chega.
          if (req.socket) req.socket.destroySoon = function () { this.end(); };
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
          res.end(JSON.stringify(RESPOSTA_CORPO_GRANDE));
          prazo = setTimeout(fecharDeVez, DRENO_MAX_MS);
          prazo.unref();   // o prazo sozinho não segura o processo aberto
          req.once('end', fecharDeVez);   // corpo inteiro lido: fecha sem RST
        } else {
          req.destroy();   // sem como responder: só parar de ler
        }
        resolve(null); // sinaliza pro chamador que a resposta já foi enviada
      }
    });
    req.on('end', () => { if (!tooLarge) resolve(new TextDecoder().decode(Buffer.concat(pedacos))); });
    req.on('error', () => { if (!tooLarge) resolve(''); });
  });
}
