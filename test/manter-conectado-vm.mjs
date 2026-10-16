// Pré-carregado (NODE_OPTIONS=--import) na VM dos testes do «Manter conectado»:
// troca o `fetch` por um Waze de mentira. Só existe no TESTE — a VM de produção
// não tem nenhum gancho assim. Rotaciona o `_web_session` em cada resposta e
// anota (em WAZE_STUB_LOG) o cookie que recebeu em cada ida.
import { appendFileSync, existsSync } from 'node:fs';
// O relógio da VM dá um SALTO de 6 h quando o teste cria o arquivo-marcador: é o
// "o editor sumiu por 6 h" sem esperar nada, e vale pra memória e pro disco do
// mesmo jeito (editar só o carimbo do arquivo deixaria a memória do processo
// achando que a sessão é recente, o que nunca acontece de verdade).
const dateNow = Date.now.bind(Date);
Date.now = () => dateNow() + (process.env.WAZE_STUB_SALTO && existsSync(process.env.WAZE_STUB_SALTO) ? 6 * 3600 * 1000 : 0);
const PERFIL = { id: 12444348, userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false, areas: [], managedAreas: [] };
let n = 0;
const original = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('https://www.waze.com/')) return original(url, init);
  const m = /_web_session=([^;]+)/.exec((init.headers && init.headers.Cookie) || '');
  const id = ++n;
  appendFileSync(process.env.WAZE_STUB_LOG, `${m && m[1]}\n`);
  return new Response(JSON.stringify(PERFIL), {
    status: 200, headers: { 'content-type': 'application/json', 'set-cookie': `_web_session=VM${id}; path=/; Max-Age=2000000` },
  });
};
