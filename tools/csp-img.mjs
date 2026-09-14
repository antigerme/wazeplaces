// FONTE ÚNICA de "este host pode carregar imagem na app?".
//
// DUAS pontas fazem essa pergunta e elas têm que responder IGUAL: o
// `test/avatar.test.mjs`, que trava a CSP no CI, e o `tools/waze-probe.mjs`,
// que avisa o owner no dia em que o Waze mudar o host da foto de perfil (foi
// o que aconteceu em 2026-09-14 e chegou como ícone de imagem quebrada no
// iPhone dele). Copiar a regra nos dois é como elas deixam de concordar sem
// ninguém perceber — mesmo motivo do `waze-jitter.mjs` e do
// `paises-validacao.mjs`.
//
// E a semântica do CSP tem uma pegadinha que `includes()` erra: o curinga
// `https://*.waze.com` casa `venue-image.waze.com` e `a.b.waze.com`, mas NÃO
// casa `waze.com` PELADO. Uma comparação ingênua acerta o caso comum e erra
// justamente o dia em que o Waze servir de um domínio de raiz — que é o único
// dia em que esta função importa.
import { readFileSync } from 'node:fs';

// Onde cada cópia da CSP mora, e como se extrai. Pela ESTRUTURA do arquivo,
// nunca por `img-src` solto: os comentários acima da meta e do `const CSP`
// CITAM a diretiva, e grep frouxo casa com o comentário (gotcha #14).
export const CSP_COPIAS = {
  'index.html': (t) => (t.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1],
  '_headers': (t) => (t.match(/^\s*Content-Security-Policy:\s*(.+)$/m) || [])[1],
  'server/node.mjs': (t) => (t.match(/^const CSP = "([^"]*)"/m) || [])[1],
};

// Lê a CSP de UMA das três cópias. `base` é a URL do diretório do repo.
export function lerCsp(arquivo, base) {
  const extrai = CSP_COPIAS[arquivo];
  if (!extrai) throw new Error(`cópia de CSP desconhecida: ${arquivo}`);
  return extrai(readFileSync(new URL(arquivo, base), 'utf8')) || '';
}

// O valor de uma diretiva (sem o nome dela).
export function diretiva(csp, nome) {
  const m = String(csp || '').match(new RegExp(nome + '([^;]*)'));
  return m ? m[1].trim() : '';
}

// O host pode carregar imagem? Recebe o VALOR da diretiva (ex.: a `img-src`).
export function hostLiberado(host, valorDaDiretiva) {
  const alvo = String(host || '').toLowerCase();
  if (!alvo) return false;
  for (const fonte of String(valorDaDiretiva || '').trim().split(/\s+/).filter(Boolean)) {
    const m = fonte.match(/^https:\/\/(\*\.)?([^/]+)/i);
    if (!m) continue;                       // 'self', data:, blob: — não são host
    const dominio = m[2].toLowerCase();
    if (m[1]) {
      // Curinga: casa SUBDOMÍNIO (um ou mais rótulos), nunca o domínio pelado.
      if (alvo.endsWith('.' + dominio) && alvo.length > dominio.length + 1) return true;
    } else if (alvo === dominio) {
      return true;
    }
  }
  return false;
}
