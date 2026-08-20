#!/usr/bin/env node
// O que o Cloudflare INJETA no HTML da produção — medido, não suposto.
//
// Existe porque este projeto já concluiu o contrário do que é verdade, e a
// causa foi o instrumento: um `grep 'script[^>]*cloudflareinsights'` SEM o `<`
// do `<script`. O `[^>]*` casava com o próprio COMENTÁRIO do index.html, que
// cita o host ao explicar a CSP. Nos dois sentidos o erro é silencioso — ou o
// comentário vira "prova" de que a tag existe, ou uma resposta sem injeção
// vira "prova" de que ela nunca acontece.
//
// Uso:  node tools/cf-injecao.mjs [url] [n]
//       node tools/cf-injecao.mjs https://places.wazebrasil.com/ 10
//
// NÃO roda no CI de propósito: depende da produção estar no ar e da conta do
// Cloudflare, então falharia por motivo que não é o código. É ferramenta de
// diagnóstico — rode quando mexer na CSP ou quando o console acusar violação.

const URL_BASE = process.argv[2] || 'https://places.wazebrasil.com/';
const N = Number(process.argv[3] || 10);

// UA de navegador: o Cloudflare já variou a injeção por isso, e medir com
// `curl` pelado é como o projeto errou da primeira vez.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Cada padrão exige `<script`, então texto solto (comentário, documentação)
// não conta. O controle abaixo prova isso a cada execução.
const PADROES = {
  'beacon do Web Analytics': /<script[^>]*src="https:\/\/static\.cloudflareinsights\.com/,
  'bootstrap do Bot Fight Mode': /<script>\(function\(\)\{function c\(\)/,
  'challenge-platform (jsd)': /<script[^>]*\/cdn-cgi\/challenge-platform\//,
  'Rocket Loader': /<script[^>]*\/cdn-cgi\/scripts\/[^"]*rocket-loader/,
  'ofuscador de e-mail': /<script[^>]*\/cdn-cgi\/scripts\/[^"]*email-decode/,
};

// CONTROLE: o instrumento distingue uma TAG de uma MENÇÃO em texto? Sem isto
// o relatório inteiro pode estar medindo comentário. Roda antes de tudo, e
// aborta se falhar — instrumento que não distingue não mede nada.
const MENCAO = '(script-src para static.cloudflareinsights.com e connect-src para cloudflareinsights.com)';
const TAG = '<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v1"></script>';
const re = PADROES['beacon do Web Analytics'];
if (re.test(MENCAO) || !re.test(TAG)) {
  console.error('✗ controle do instrumento FALHOU: o padrão não distingue menção de tag.');
  process.exit(2);
}
console.log('✓ controle: menção em texto → não conta · tag de verdade → conta\n');

const achados = Object.fromEntries(Object.keys(PADROES).map((k) => [k, 0]));
let ok = 0;
for (let i = 0; i < N; i++) {
  // Cache-buster: sem ele a borda pode devolver sempre a mesma cópia e N
  // medições viram uma só.
  const u = URL_BASE + (URL_BASE.includes('?') ? '&' : '?') + 'cf_probe=' + i + '_' + Date.now();
  let html;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } });
    html = await r.text();
  } catch (e) {
    console.error(`  pedido ${i + 1}: ${e.message}`);
    continue;
  }
  ok++;
  for (const [nome, padrao] of Object.entries(PADROES)) if (padrao.test(html)) achados[nome]++;
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`${URL_BASE} — ${ok} de ${N} respostas lidas\n`);
for (const [nome, n] of Object.entries(achados)) {
  const marca = n === 0 ? '—' : n === ok ? '■' : '▨';
  console.log(`  ${marca} ${String(n).padStart(3)}/${ok}  ${nome}`);
}
console.log('\n  ■ = em toda resposta · ▨ = em algumas (a CSP precisa cobrir mesmo assim) · — = nenhuma');
console.log('  Injeção que aparece aqui e não está na CSP vira erro de console a cada carregamento.');
