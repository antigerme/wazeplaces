// Pergunta à API de PRODUÇÃO usando o token que já vem dentro do diagnóstico.
//
//   node tools/diag-api.mjs <arquivo.json> perfil
//   node tools/diag-api.mjs <arquivo.json> buscar-places '{"page":2}'
//   node tools/diag-api.mjs <arquivo.json> lista-estados '{"countryId":73}'
//
// POR QUE ISTO EXISTE — e a ideia é do owner. O diagnóstico é uma GRAVAÇÃO:
// responde tudo que a app perguntou, e nada do que ela não perguntou. Quando a
// dúvida vira "e se pedisse a página 2? e com outro filtro?", antes disso só
// havia um caminho: pedir o `cookies.txt` dele. Mas o arquivo já traz o
// `waze_session_token`, e ele é a chave da NOSSA API — que por sua vez tem os
// cookies do Waze cifrados no servidor. Então dá pra perguntar sem nunca segurar
// a credencial do WME.
//
// AS TRÊS REGRAS, e nenhuma depende de eu lembrar delas:
//
//  1. SÓ LEITURA, POR CONSTRUÇÃO. As rotas que ESCREVEM estão numa lista de
//     recusa e o script sai com erro se alguém as pedir. `validar-place`,
//     `marcar-lido`, `excluir-foto` e `renomear-local` alteram dado real NO NOME
//     DELE; `sessao` com `action:destroy` DESLOGA ele. É a mesma defesa que o
//     `waze-probe.mjs` tem contra `/Features` e `/Issues/Read`.
//  2. JITTER da fonte única (`waze-jitter.mjs`), como toda varredura deste repo.
//  3. O TOKEN NUNCA É IMPRESSO nem passa por linha de comando — ele vai no CORPO
//     do POST, que é onde a criptografia da app pressupõe que ele viva
//     (gotcha #60). O corpo sai por stdin do curl... aqui, por `fetch` direto.
//
// E UM CUSTO QUE NÃO É ÓBVIO: cada chamada aqui é uma requisição REAL no free
// tier do Cloudflare, que é restrição de projeto. Isto é ferramenta de medição
// pontual, não de varredura.
//
// Nota de campo: um POST cru leva 403 do Bot Fight Mode. Precisa de
// `User-Agent` de navegador — medido, não suposto.
import { readFileSync } from 'node:fs';
import { lerDiagnostico } from './diag-ler.mjs';
import { pausaComJitter } from './waze-jitter.mjs';

const ESCRITA = new Set(['validar-place', 'marcar-lido', 'excluir-foto', 'renomear-local', 'guardar-pedido', 'sessao', 'parear']);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const [ARQ, ROTA, EXTRA] = process.argv.slice(2);
if (!ARQ || !ROTA) {
  console.error('uso: node tools/diag-api.mjs <arquivo.json> <rota> [json-extra]');
  console.error(`rotas de LEITURA: perfil, buscar-places, lista-paises, lista-estados, presenca`);
  console.error(`RECUSADAS por construção: ${[...ESCRITA].join(', ')}`);
  process.exit(2);
}
if (ESCRITA.has(ROTA)) {
  console.error(`RECUSADO: "${ROTA}" escreve (ou desloga) na conta de quem gerou o diagnóstico.`);
  console.error('Esta ferramenta é só de leitura, e a recusa é por construção — não por lembrança.');
  process.exit(3);
}

// Aceita `.zip` (o formato de hoje) e `.json` cru (relato antigo, ou
// navegador sem CompressionStream). Farejado pelos bytes, não pela extensão.
const { dados: d, origem: _origemDoDiag } = lerDiagnostico(ARQ);
const token = (d.localStorage || {}).waze_session_token;
if (!token) { console.error('o diagnóstico não traz waze_session_token'); process.exit(1); }
const base = String((d.app && d.app.url) || '').replace(/\/+$/, '');
if (!/^https:\/\//.test(base)) { console.error('URL da app ausente ou não-https no diagnóstico'); process.exit(1); }

const corpo = { sessionToken: token, region: 'row', ...(EXTRA ? JSON.parse(EXTRA) : {}) };
const semSegredo = { ...corpo, sessionToken: '<TOKEN>' };
console.log(`de:    ${ARQ.split('/').pop()}   (${_origemDoDiag})`);
console.log(`POST ${base}/api/${ROTA}`);
console.log(`corpo: ${JSON.stringify(semSegredo)}`);

await pausaComJitter();
const r = await fetch(`${base}/api/${ROTA}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    Accept: 'application/json',
    Origin: base,
    Referer: base + '/',
  },
  body: JSON.stringify(corpo),
});
const txt = await r.text();
console.log(`HTTP ${r.status}`);
let j = null;
try { j = JSON.parse(txt); } catch (e) { console.log(txt.slice(0, 400)); process.exit(r.ok ? 0 : 1); }

// Resumo útil pras rotas grandes; o JSON inteiro sai com --cru.
if (Array.isArray(j.places)) {
  const dia = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
  const datas = j.places.map((p) => p.dateAdded).filter(Boolean).sort((a, b) => a - b);
  const hist = {};
  for (const x of datas) hist[dia(x)] = (hist[dia(x)] || 0) + 1;
  console.log(`places=${j.places.length} hasMore=${j.hasMore} total=${j.total} blocked=${j.blocked ?? '—'}`);
  console.log(`datas: ${Object.entries(hist).sort().map(([k, v]) => `${k}:${v}`).join('  ') || '—'}`);
} else {
  console.log(JSON.stringify(j, (k, v) => (k === 'sessionToken' ? '<TOKEN>' : v)).slice(0, 900));
}
