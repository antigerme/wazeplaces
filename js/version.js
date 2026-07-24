// Versão do Waze Places — serial no padrão de zona DNS (RFC 1912): YYYYMMDDnn.
// AAAA-MM-DD de quando saiu + nn = revisão do dia (01, 02…). Cresce sempre, compara
// como número e, diferente de um "v37", diz DE QUANDO é a versão só de olhar.
// FONTE ÚNICA: o CACHE_NAME do service-worker.js usa ESTE serial ('waze-places-' +
// APP_VERSION) e a auditoria (test/version.test.mjs) trava a paridade/formato —
// bump de versão = mexer AQUI e no service-worker.js juntos.
const APP_VERSION = '2026072401';

// '2026071801' → '2026.07.18-01' (pra gente ler; o serial cru fica pras máquinas)
function verLabel(v) {
  const s = String(v);
  return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}-${s.slice(8, 10)}`;
}

// Este arquivo é carregado como <script> clássico ANTES do app.js — APP_VERSION e
// verLabel ficam no escopo global compartilhado (como o `API` do api.js). Os window.*
// são só conveniência pra acesso explícito.
if (typeof window !== 'undefined') {
  window.APP_VERSION = APP_VERSION;
  window.verLabel = verLabel;
}
