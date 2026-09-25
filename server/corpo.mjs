// Corpo da requisição no adaptador da VM (`server/node.mjs`). O Worker não
// precisa disto: lá o corpo chega inteiro pelo `request.json()`.
//
// Mora num módulo PRÓPRIO pra poder ser testado sem subir o servidor — o
// `node.mjs` abre a porta ao ser importado.
export const MAX_BODY_BYTES = 5_000_000;
// Junta BYTES e decodifica UMA vez no fim. `data += chunk` decodificava cada
// pedaço sozinho, e um caractere de vários bytes (acento, emoji) cortado na
// divisa entre dois pedaços virava `\uFFFD` — na VM, renomear "São João" ou
// mandar mensagem com acento podia gravar o texto corrompido. O Worker não tem
// o problema (lê o corpo inteiro com `request.json()`).
export function readBody(req, res) {
  return new Promise((resolve) => {
    const pedacos = [];
    let bytes = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;
      pedacos.push(c);
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        // Responde 413 limpo antes de cortar a conexão (em vez de só req.destroy()).
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(JSON.stringify({ success: false, error: 'Corpo da requisição muito grande' }));
        }
        req.destroy();
        resolve(null); // sinaliza pro chamador que a resposta já foi enviada
      }
    });
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(pedacos).toString('utf8')); });
    req.on('error', () => { if (!tooLarge) resolve(''); });
  });
}
