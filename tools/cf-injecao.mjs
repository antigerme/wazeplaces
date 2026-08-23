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
// `exige` é o que a CSP precisa ter pra aquilo NÃO ser bloqueado:
//   - host  → uma entrada de host em script-src
//   - self  → mesma origem, já coberto por 'self' (nada a fazer)
//   - inline→ código inline: host NENHUM resolve (só 'unsafe-inline'/hash/nonce)
const PADROES = {
  'beacon do Web Analytics': {
    re: /<script[^>]*src="https:\/\/static\.cloudflareinsights\.com/,
    exige: { tipo: 'host', host: 'https://static.cloudflareinsights.com', tambem: { diretiva: 'connect-src', host: 'https://cloudflareinsights.com' } },
  },
  'bootstrap do Bot Fight Mode': {
    re: /<script>\(function\(\)\{function c\(\)/,
    exige: { tipo: 'inline' },
  },
  'challenge-platform (jsd)': { re: /<script[^>]*\/cdn-cgi\/challenge-platform\//, exige: { tipo: 'self' } },
  'Rocket Loader': { re: /<script[^>]*\/cdn-cgi\/scripts\/[^"]*rocket-loader/, exige: { tipo: 'self' } },
  'ofuscador de e-mail': { re: /<script[^>]*\/cdn-cgi\/scripts\/[^"]*email-decode/, exige: { tipo: 'self' } },
};

// A CSP que a app publica, lida do arquivo — a pergunta é "o que está injetado
// está coberto por ela?", e responder isso à mão é como a permissão sumiu.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as dormir } from 'node:timers/promises';
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSP = Object.fromEntries(
  readFileSync(join(RAIZ, '_headers'), 'utf8')
    .match(/^\s*Content-Security-Policy:\s*(.+)$/m)[1]
    .split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v.join(' ')]; }));

function cobertura(exige) {
  if (exige.tipo === 'self') return ['coberto', "mesma origem ('self')"];
  if (exige.tipo === 'inline') {
    const s = CSP['script-src'] || '';
    if (s.includes("'unsafe-inline'")) return ['coberto', "'unsafe-inline' (e isso é problema à parte)"];
    return ['inline', 'host NENHUM resolve — só hash, nonce ou unsafe-inline'];
  }
  const faltando = [];
  if (!(CSP['script-src'] || '').includes(exige.host)) faltando.push(`script-src ${exige.host}`);
  if (exige.tambem && !(CSP[exige.tambem.diretiva] || '').includes(exige.tambem.host)) {
    faltando.push(`${exige.tambem.diretiva} ${exige.tambem.host}`);
  }
  return faltando.length ? ['FALTA', faltando.join(' + ')] : ['coberto', exige.host];
}

// CONTROLE: o instrumento distingue uma TAG de uma MENÇÃO em texto? Sem isto
// o relatório inteiro pode estar medindo comentário. Roda antes de tudo, e
// aborta se falhar — instrumento que não distingue não mede nada.
const MENCAO = '(script-src para static.cloudflareinsights.com e connect-src para cloudflareinsights.com)';
const TAG = '<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v1"></script>';
const re = PADROES['beacon do Web Analytics'].re;
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
  for (const [nome, p] of Object.entries(PADROES)) if (p.re.test(html)) achados[nome]++;
  await dormir(300);
}

console.log(`${URL_BASE} — ${ok} de ${N} respostas lidas\n`);
let descoberto = 0;
for (const [nome, n] of Object.entries(achados)) {
  const marca = n === 0 ? '—' : n === ok ? '■' : '▨';
  const [estado, razao] = n === 0 ? ['—', ''] : cobertura(PADROES[nome].exige);
  if (estado === 'FALTA') descoberto++;
  const selo = { coberto: 'coberto  ', FALTA: 'NÃO COBERTO', inline: 'inline   ', '—': '         ' }[estado];
  console.log(`  ${marca} ${String(n).padStart(3)}/${ok}  ${nome.padEnd(30)} ${selo}${razao ? '  ' + razao : ''}`);
}
console.log('\n  ■ = em toda resposta · ▨ = em algumas (a CSP precisa cobrir mesmo assim) · — = nenhuma');
if (descoberto) {
  console.log(`\n  ✗ ${descoberto} injeção(ões) NÃO COBERTA(S): erro de CSP a cada carregamento, e o recurso não funciona.`);
  console.log('    Libere o host EXATO nas três cópias da CSP (index.html, _headers, server/node.mjs).');
  process.exit(1);
}
console.log('\n  ✓ tudo que é injetado está coberto pela CSP (ou é inline, que host nenhum resolve).');
