#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════
//  O número de instalações da extensão, lido da LOJA a cada `npm run js`
// ═════════════════════════════════════════════════════════════════════════════
//
//   node tools/extensao-instalacoes.mjs      (é o primeiro passo do `npm run js`)
//
// A página /status mostra «N instalações no Chrome Web Store». Não existe API pública pra isso (a loja só
// mostra o número na página), então o build LÊ a página da loja e reescreve duas linhas do `js/status.js`
// (a data e o número). Regras, cada uma com o seu motivo:
//
//   · NO CI NÃO BUSCA (`CI=true`): o CI roda `npm run js` e exige que não sobre diferença; um número buscado
//     na internet mudaria entre o commit e o CI e reprovaria o PR por algo que ninguém editou.
//   · NUNCA derruba o build: sem rede, loja fora do ar, página que mudou de forma — avisa e segue com o número
//     que já está no arquivo (exit 0 sempre). Número ruim é pior que número velho.
//   · SÓ REESCREVE QUANDO O NÚMERO MUDA (a data não vira ruído de commit).
//   · Mudou? É mudança de código: quem commitar sobe o serial (`js/version.js` + `CACHE_NAME`), como em toda
//     mudança em `js/`.
//
// A leitura (`lerInstalacoes`) e a reescrita (`reescreverFonte`) são puras e têm teste; só o `main` toca na rede.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ID_DA_EXTENSAO = 'dpinfpcoggnilplfgkpnkhbmfokhnhnn';
// `?hl=en` fixa o idioma da página (o texto do número muda com ele: «105 users», «105 usuários»).
export const URL_DA_LOJA = `https://chromewebstore.google.com/detail/${ID_DA_EXTENSAO}?hl=en`;
const ARQUIVO = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'status.js');
const MAX_RAZOAVEL = 10_000_000;

// O número que a loja mostra, ou `null` se a página não o tem do jeito conhecido. Ancorado em `>NÚMERO users<`:
// um «users» solto no meio de uma avaliação ou de um texto não conta. Vírgula e ponto são separador de milhar.
export function lerInstalacoes(html) {
  if (typeof html !== 'string') return null;
  const m = />\s*(\d[\d.,]*)\+?\s+users\s*</i.exec(html);
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ''));
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_RAZOAVEL ? n : null;
}

const LINHA_DA_DATA = /^\/\/ Chrome Web Store, lido em \d{4}-\d{2}-\d{2}\b.*$/m;
const LINHA_DO_NUMERO = /^const EXTENSAO_INSTALACOES_CHROME = \d+;$/m;

// O número que o arquivo tem hoje, ou `null` se a linha sumiu.
export function numeroDoArquivo(fonte) {
  const m = /^const EXTENSAO_INSTALACOES_CHROME = (\d+);$/m.exec(fonte);
  return m ? Number(m[1]) : null;
}

// Reescreve as DUAS linhas (data e número). Devolve `null` se alguma não está lá: melhor não tocar no arquivo
// do que gravar só metade.
export function reescreverFonte(fonte, n, dia) {
  if (!LINHA_DA_DATA.test(fonte) || !LINHA_DO_NUMERO.test(fonte)) return null;
  return fonte
    .replace(LINHA_DA_DATA, `// Chrome Web Store, lido em ${dia} na página pública da loja (reescrito por tools/extensao-instalacoes.mjs).`)
    .replace(LINHA_DO_NUMERO, `const EXTENSAO_INSTALACOES_CHROME = ${n};`);
}

async function paginaDaLoja(buscar, tetoMs = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), tetoMs);
  try {
    const r = await buscar(URL_DA_LOJA, {
      signal: ctl.signal,
      headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

// `ambiente`/`buscar`/`ler`/`gravar`/`hoje` entram por parâmetro só pro teste; o uso normal é `node tools/extensao-instalacoes.mjs`.
export async function main({ ambiente = process.env, buscar = globalThis.fetch, ler = (p) => readFileSync(p, 'utf8'), gravar = (p, t) => writeFileSync(p, t), hoje = () => new Date().toISOString().slice(0, 10), arquivo = ARQUIVO, log = console.log } = {}) {
  if (ambiente.CI) { log('extensão: pulado no CI (o número da loja não entra na conferência dos arquivos gerados)'); return { acao: 'pulado' }; }
  try {
    const fonte = ler(arquivo);
    const atual = numeroDoArquivo(fonte);
    // Duas tentativas: a loja às vezes devolve uma variante da página sem o número (medido: 1 em 5 leituras).
    let n = null;
    for (let tentativa = 1; tentativa <= 2 && n === null; tentativa++) n = lerInstalacoes(await paginaDaLoja(buscar));
    if (n === null) { log(`extensão: a página da loja não trouxe o número no formato conhecido; segue com ${atual}`); return { acao: 'sem-numero' }; }
    if (n === atual) { log(`extensão: ${n} instalações (igual ao arquivo)`); return { acao: 'igual', n }; }
    const nova = reescreverFonte(fonte, n, hoje());
    if (nova === null) { log('extensão: as linhas do js/status.js mudaram de forma; nada foi gravado'); return { acao: 'sem-linhas' }; }
    gravar(arquivo, nova);
    log(`extensão: ${n} instalações (era ${atual}) — js/status.js atualizado; suba o serial ao commitar`);
    return { acao: 'gravado', n, era: atual };
  } catch (e) {
    log(`extensão: não consegui ler a loja (${String(e && e.message || e).slice(0, 80)}); segue com o número do arquivo`);
    return { acao: 'falhou' };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
  process.exit(0);
}
