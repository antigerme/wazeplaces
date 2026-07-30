#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  waze-probe — fala com o Waze de verdade, SÓ LEITURA
// ═══════════════════════════════════════════════════════════════════════════
//
// Existe por instrução permanente do owner: quando um agente precisar conferir
// algo contra o Waze Map Editor, ele PEDE o cookies.txt em vez de pedir HAR e
// esperar. Ver a seção 🔑 do CLAUDE.md. HAR é foto do passado e custa uma rodada
// de ida e volta por pergunta; com cookies a resposta é imediata e é sobre o que
// o Waze faz HOJE.
//
// USO
//   node tools/waze-probe.mjs <cookies.txt>                    → valida a sessão
//   node tools/waze-probe.mjs <cookies.txt> --paises           → lista de países
//   node tools/waze-probe.mjs <cookies.txt> --estados 30       → estados do país
//   node tools/waze-probe.mjs <cookies.txt> --idioma           → o Waze honra Accept-Language?
//   node tools/waze-probe.mjs <cookies.txt> --get '<path>'     → GET num path arbitrário
//   ...qualquer um aceita  --regiao row|na|il|world  (padrão: row)
//
// SEGURANÇA — o cookies.txt do WME não tem versão "só leitura": vem com
// _web_session + _csrf_token e permissions: -1 (todos os bits). É credencial de
// ESCRITA na conta do owner. Por isso este script:
//   · recusa /Features e /Issues/Read, os dois caminhos que alteram dado real;
//   · só faz GET (nunca manda corpo);
//   · nunca imprime valor de cookie — só o nome e a contagem.
// A recusa é mecânica de propósito: regra que depende de alguém lembrar não é
// regra. Se algum dia precisar MESMO escrever, faça pela app com o owner
// acompanhando, não por aqui.

import { readFileSync } from 'node:fs';

const BASES = {
  row: 'https://www.waze.com/row-Descartes/app',
  na: 'https://www.waze.com/na-Descartes/app',
  il: 'https://www.waze.com/il-Descartes/app',
  world: 'https://www.waze.com/Descartes/app',
};
// Mesma tabela do wazeRefererEnv em server/core.mjs.
const ENV = { row: 'row', na: 'usa', il: 'il', world: 'row' };
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

// Paths que ALTERAM dado no Waze. Bloqueados, sem flag pra destravar.
const ESCRITA = [/\/Features\b/i, /\/Issues\/Read\b/i, /\/Issues\/Resolve\b/i];

const args = process.argv.slice(2);
const arq = args[0];
if (!arq || arq.startsWith('--')) {
  console.error('uso: node tools/waze-probe.mjs <cookies.txt> [--paises|--estados N|--idioma|--get <path>] [--regiao row]');
  process.exit(2);
}
const flag = (nome) => {
  const i = args.indexOf('--' + nome);
  return i === -1 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};
const regiao = String(flag('regiao') || 'row').toLowerCase();
const base = BASES[regiao] || BASES.row;

// ── Cookies: mesma leitura do server/core.mjs (Netscape, só waze.com) ──────
const pares = [];
for (const linha of readFileSync(arq, 'utf8').split('\n')) {
  const t = linha.trim();
  if (!t || t[0] === '#') continue;
  const p = t.split(/\s+/);
  if (p.length >= 7 && /(^\.?|\.)waze\.com$/i.test(p[0])) pares.push([p[5], p[6]]);
}
if (!pares.length) {
  console.error('✗ nenhum cookie de waze.com no arquivo. Exportou logado no WME (formato Netscape)?');
  process.exit(1);
}
const cookieHeader = pares.map(([k, v]) => `${k}=${v}`).join('; ');
const csrf = (pares.find(([k]) => k === '_csrf_token') || [])[1] || '';
// Nome sim, valor NUNCA.
console.log(`cookies: ${pares.length} (${pares.map(([k]) => k).join(', ')})`);
console.log(`csrf: ${csrf ? 'presente' : 'AUSENTE — chamadas podem dar 403'} · região: ${regiao}\n`);

async function get(path, acceptLanguage = 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7', refLocale = 'pt-BR') {
  const url = path.startsWith('http') ? path : base + path;
  if (ESCRITA.some((re) => re.test(url))) {
    console.error(`✗ RECUSADO: ${url}\n  Este path ALTERA dado real na conta do owner. O probe é só leitura`
      + ' (ver o cabeçalho do arquivo e a seção 🔑 do CLAUDE.md).');
    process.exit(3);
  }
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: '*/*',
      'Accept-Language': acceptLanguage,
      'Content-Type': 'application/json; charset=utf-8',
      Origin: 'https://www.waze.com',
      Referer: `https://www.waze.com/${refLocale}/editor?env=${ENV[regiao] || 'row'}&tab=issue_tracker`,
      'X-CSRF-Token': csrf,
      Cookie: cookieHeader,
      'User-Agent': UA,
    },
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* nem tudo é JSON */ }
  return { status: r.status, json, txt };
}

// ── Sessão: sempre roda, é o que diz se os cookies ainda valem ─────────────
const ses = await get('/Session?language=pt-BR');
if (ses.status !== 200) {
  const code = ses.json?.errorList?.[0]?.code;
  console.log(`✗ sessão INVÁLIDA — HTTP ${ses.status}${code ? ` · code ${code}` : ''}`);
  console.log(`  ${String(ses.json?.errorList?.[0]?.details || ses.txt).slice(0, 110)}`);
  console.log('\n→ Cookies expirados ou revogados. PEÇA um cookies.txt novo ao owner'
    + ' (instrução permanente dele; ver 🔑 no CLAUDE.md) em vez de voltar pro HAR.');
  process.exit(1);
}
const u = ses.json || {};
console.log(`✓ sessão válida · ${u.userName || '?'} · rank cru ${u.rank} (exibe L${Number(u.rank) + 1})`
  + ` · AM=${!!u.isAreaManager} · Staff=${!!u.isStaff} · ${(u.areas || []).length} área(s)`);
if (u.permissions !== undefined) {
  console.log(`  permissions: ${u.permissions}` + (Number(u.permissions) < 0 ? '  (negativo = todos os bits = ESCRITA)' : ''));
}

// ── Sondas opcionais ──────────────────────────────────────────────────────
if (flag('paises')) {
  const r = await get('/LocationSearch/Countries');
  const nomes = (r.json?.countries || []).map((c) => c.name);
  console.log(`\npaíses: ${nomes.length} · primeiros: ${nomes.slice(0, 6).join(', ')}`);
  const acento = nomes.filter((n) => /[^\x00-\x7F]/.test(n));
  console.log(`  com caractere não-ASCII (onde a colação importa): ${acento.join(' · ') || '(nenhum)'}`);
}

const estados = flag('estados');
if (estados && estados !== true) {
  const r = await get(`/LocationSearch/States?countryId=${parseInt(estados, 10) || 0}`);
  const nomes = (r.json?.states || []).map((st) => st.name);
  console.log(`\nestados do país ${estados}: ${nomes.length} · ${nomes.slice(0, 8).join(' · ')}`);
}

if (flag('idioma')) {
  // A pergunta que motivou tudo: o Waze honra Accept-Language nesses endpoints?
  // Resposta medida em 2026-07-29: NÃO. Nomes de país vêm sempre em inglês.
  // Repare que isto NÃO dá pra testar no console do navegador: Accept-Language é
  // forbidden header name no Fetch, o browser ignora e manda o dele.
  console.log('\nAccept-Language muda os nomes? (variando só o header e o Referer)');
  const vars = [
    ['pt-BR (o que a app manda)', 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7', 'pt-BR'],
    ['fr-FR', 'fr-FR,fr;q=0.9,en;q=0.8', 'pt-BR'],
    ['en-US', 'en-US,en;q=0.9', 'pt-BR'],
    ['fr-FR + Referer /fr/', 'fr-FR,fr;q=0.9,en;q=0.8', 'fr'],
  ];
  const assinaturas = new Map();
  for (const [rot, al, ref] of vars) {
    const r = await get('/LocationSearch/Countries', al, ref);
    if (r.status !== 200) { console.log(`  ✗ ${rot.padEnd(28)} HTTP ${r.status}`); continue; }
    const nomes = (r.json?.countries || []).map((c) => c.name);
    assinaturas.set(rot, nomes.join('|'));
    const alvo = nomes.filter((n) => /^(Germany|Allemagne|Alemanha|Alemania|France|França|Francia|Spain|Espagne|Espanha|España)$/i.test(n));
    console.log(`  ✓ ${rot.padEnd(28)} ${nomes.length} países · ${alvo.slice(0, 3).join(', ')}`);
  }
  const unicas = new Set(assinaturas.values());
  console.log(unicas.size <= 1
    ? '  → IDÊNTICOS: o Waze ignora o header aqui. Não existe conserto pelo Accept-Language.'
    : '  → MUDARAM: o header é honrado; passar o idioma do editor resolveria de verdade.');
}

const path = flag('get');
if (path && path !== true) {
  const r = await get(path);
  console.log(`\nGET ${path} → HTTP ${r.status}`);
  console.log(r.json ? JSON.stringify(r.json, null, 2).slice(0, 2000) : r.txt.slice(0, 2000));
}
