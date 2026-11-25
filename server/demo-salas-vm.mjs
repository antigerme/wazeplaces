// ═══════════════════════════════════════════════════════════════════════════
//  As salas da demo na VM: memória + um arquivo por sala
// ═══════════════════════════════════════════════════════════════════════════
//
// Implementa o contrato que o core espera em `ctx.salas` (o Worker o implementa
// com um Durable Object por sala):
//
//   criar(id, { cfg, deck })    → { ok }
//   acao(id, req)               → { status, body }
//   fluxo(id, req)              → Response (SSE) | { status, body }
//   definirCodigo(hash, id, ate) → boolean   (false: o código vale pra OUTRA demo)
//   resolverCodigo(hash)        → id | null
//
// A sala viva (`SalaViva`) é a MESMA do Durable Object. O que muda aqui é só
// onde ela guarda o retrato (um arquivo, gravado de forma atômica como o das
// sessões) e quem a acorda (um `setTimeout`, com `unref` pra não segurar o
// processo). Uma VM é UM processo, então não há corrida entre duas instâncias da
// mesma sala; é isso que dispensa o compare-and-set que o KV não tem.
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SalaViva } from './demo-sala-viva.mjs';

const ID_OK = /^[0-9a-f]{40}$/;
const MAX_ESPERA_MS = 2 ** 31 - 1; // o teto do setTimeout

export function criarSalasVm({ dir = null, agora = Date.now } = {}) {
  const salas = new Map(); // id → { sala, alarme }
  let codigos = null;      // hash → { id, ate } (carregado do arquivo na primeira vez)
  const arquivo = (id) => join(dir, `demo_sala_${id}.json`);
  const arquivoDosCodigos = () => join(dir, 'demo_codigos.json');

  async function gravarAtomico(destino, texto) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.tmp_${randomBytes(6).toString('hex')}`);
    await writeFile(temp, texto, { mode: 0o600 });
    try { await rename(temp, destino); } catch (e) { await unlink(temp).catch(() => {}); throw e; }
  }

  function montar(id) {
    const reg = { sala: null, alarme: null };
    reg.sala = new SalaViva({
      agora,
      salvar: async (snap) => { if (dir) await gravarAtomico(arquivo(id), JSON.stringify(snap)); },
      agendar: (ts) => {
        if (reg.alarme) clearTimeout(reg.alarme);
        reg.alarme = setTimeout(() => { reg.alarme = null; void reg.sala.tick(); }, Math.min(MAX_ESPERA_MS, Math.max(0, ts - agora())));
        if (typeof reg.alarme.unref === 'function') reg.alarme.unref();
      },
      apagar: async () => {
        if (reg.alarme) clearTimeout(reg.alarme);
        salas.delete(id);
        if (dir) await unlink(arquivo(id)).catch(() => {});
      },
    });
    return reg;
  }

  // A sala em memória, ou carregada do arquivo (a VM reiniciou), ou nenhuma.
  async function obter(id) {
    if (!ID_OK.test(id)) return null;
    const viva = salas.get(id);
    if (viva) return viva.sala;
    if (!dir) return null;
    let snap;
    try { snap = JSON.parse(await readFile(arquivo(id), 'utf8')); } catch { return null; }
    const reg = montar(id);
    if (!reg.sala.carregar(snap)) return null;
    salas.set(id, reg);
    await reg.sala.tick(); // o prazo pode ter vencido com a VM fora do ar
    return salas.get(id) ? reg.sala : null;
  }

  async function lerCodigos() {
    if (codigos) return codigos;
    codigos = new Map();
    if (dir) {
      try { for (const [h, v] of Object.entries(JSON.parse(await readFile(arquivoDosCodigos(), 'utf8')))) codigos.set(h, v); } catch { /* ainda não há */ }
    }
    return codigos;
  }
  async function gravarCodigos() {
    if (dir) await gravarAtomico(arquivoDosCodigos(), JSON.stringify(Object.fromEntries(codigos)));
  }

  return {
    async criar(id, payload) {
      if (!ID_OK.test(id) || (await obter(id))) return { ok: false, motivo: 'existe' };
      const reg = montar(id);
      const r = reg.sala.criar(payload);
      if (!r.ok) return r;
      salas.set(id, reg);
      return { ok: true };
    },
    async acao(id, req) {
      const sala = await obter(id);
      if (!sala) return { status: 404, body: { success: false, error: 'Demo não encontrada', errorKey: 'srv.err.demoNaoEncontrada' } };
      return sala.acao(req);
    },
    async fluxo(id, req) {
      const sala = await obter(id);
      if (!sala) return { status: 404, body: { success: false, error: 'Demo não encontrada', errorKey: 'srv.err.demoNaoEncontrada' } };
      return sala.fluxo(req);
    },
    async definirCodigo(hash, id, ate) {
      const mapa = await lerCodigos();
      const atual = mapa.get(hash);
      if (atual && atual.ate > agora() && atual.id !== id) return false;
      mapa.set(hash, { id, ate });
      for (const [h, v] of mapa) if (v.ate <= agora()) mapa.delete(h);
      await gravarCodigos();
      return true;
    },
    async resolverCodigo(hash) {
      const v = (await lerCodigos()).get(hash);
      return v && v.ate > agora() ? v.id : null;
    },

    // O boot e a varredura periódica: sala vencida sai do disco.
    async varrer() {
      if (!dir) return 0;
      let nomes = [];
      try { nomes = await readdir(dir); } catch { return 0; }
      let apagadas = 0;
      for (const n of nomes) {
        const m = /^demo_sala_([0-9a-f]{40})\.json$/.exec(n);
        if (!m) continue;
        let exp = 0;
        try { exp = JSON.parse(await readFile(join(dir, n), 'utf8')).est.cfg.expiraEm; } catch { /* arquivo ilegível: apaga */ }
        if (exp <= agora()) { await unlink(join(dir, n)).catch(() => {}); salas.delete(m[1]); apagadas++; }
      }
      return apagadas;
    },
    // Antes de o processo sair: grava o que estiver pendente.
    async fechar() { for (const { sala } of salas.values()) await sala.fechar(); },
    _salas: salas, // só pros testes
  };
}
