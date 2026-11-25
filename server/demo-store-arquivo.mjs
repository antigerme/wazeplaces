// ═══════════════════════════════════════════════════════════════════════════
//  O store da DEMO na VM: um arquivo por demo
// ═══════════════════════════════════════════════════════════════════════════
//
// A interface (o core só fala com ela; o Worker terá a sua):
//
//   criar(registro)                      → boolean   false se o id já existe
//   ler(id, agora)                       → registro | null   (null: não existe ou venceu)
//   votar(id, partId, voto, {agora,max}) → { ok: true, novo } | { ok: false, motivo }
//        motivos: 'inexistente' | 'encerrada' | 'prazo' | 'cheia'
//   participantes(id, agora)             → [{ partId, nome, pais, votos, seg, ref, em }]
//   encerrar(id, agora)                  → boolean   false se não existe
//   definirCodigo(hash, id, codigo, ateMs, agora) → boolean   false se o código vale pra OUTRA demo
//   resolverCodigo(hash, agora)          → id | null
//   apagar(id)
//
// O que importa nela é que cada operação é ATÔMICA: `votar` confere "aberta,
// no prazo, com vaga" e grava no mesmo passo. O KV do Cloudflare não faz isso
// (sem compare-and-set), e é por isso que o teto de pessoas e a janela de votos
// não podem ser garantidos nele sem outra peça. Aqui o processo é um só, então
// uma fila de promessas por demo basta.
//
// Nada aqui lê um relógio: `agora` vem de quem chama (o teste anda o tempo).
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function criarStoreDeArquivo(dir) {
  const filas = new Map(); // id → cauda da fila de promessas
  const comFila = (id, fn) => {
    const anterior = filas.get(id) || Promise.resolve();
    const atual = anterior.then(fn, fn);
    filas.set(id, atual.catch(() => {}));
    return atual;
  };
  const arquivo = (id) => join(dir, `demo_${id}.json`);
  const ehId = (id) => typeof id === 'string' && /^[0-9a-f]{40}$/.test(id);

  async function lerArquivo(id) {
    if (!ehId(id)) return null;
    try {
      return JSON.parse(await readFile(arquivo(id), 'utf8'));
    } catch {
      return null;
    }
  }
  // ATÔMICO, como o das sessões: um processo derrubado no meio da escrita não
  // deixa a demo truncada.
  async function gravar(id, doc) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.tmp_${id}_${process.pid}_${randomBytes(4).toString('hex')}`);
    await writeFile(temp, JSON.stringify(doc), { mode: 0o600 });
    try {
      await rename(temp, arquivo(id));
    } catch (e) {
      await unlink(temp).catch(() => {});
      throw e;
    }
  }
  async function vivo(id, agora) {
    const doc = await lerArquivo(id);
    if (!doc) return null;
    if (doc.registro.expiraEm <= agora) {
      await unlink(arquivo(id)).catch(() => {});
      return null;
    }
    return doc;
  }
  const arquivoDosCodigos = () => join(dir, 'demo_codigos.json');
  async function lerCodigos() {
    try { return JSON.parse(await readFile(arquivoDosCodigos(), 'utf8')); } catch { return {}; }
  }

  return {
    criar: (registro) => comFila(registro.id, async () => {
      if (!ehId(registro.id) || (await lerArquivo(registro.id))) return false;
      await gravar(registro.id, { registro, participantes: {} });
      return true;
    }),

    ler: (id, agora) => comFila(id, async () => (await vivo(id, agora))?.registro ?? null),

    votar: (id, partId, voto, { agora, max }) => comFila(id, async () => {
      const doc = await vivo(id, agora);
      if (!doc) return { ok: false, motivo: 'inexistente' };
      if (doc.registro.encerradoEm) return { ok: false, motivo: 'encerrada' };
      if (agora >= doc.registro.votosAte) return { ok: false, motivo: 'prazo' };
      const jaTem = Object.hasOwn(doc.participantes, partId);
      const pessoas = Object.values(doc.participantes).filter((p) => !p.ref).length;
      // A referência do apresentador não gasta vaga da sala.
      if (!jaTem && !voto.ref && pessoas >= max) return { ok: false, motivo: 'cheia' };
      doc.participantes[partId] = { nome: voto.nome, pais: voto.pais ?? null, votos: voto.votos, seg: voto.seg, ref: voto.ref === true, em: agora };
      await gravar(id, doc);
      return { ok: true, novo: !jaTem };
    }),

    participantes: (id, agora) => comFila(id, async () => {
      const doc = await vivo(id, agora);
      if (!doc) return [];
      return Object.entries(doc.participantes).map(([partId, p]) => ({ partId, ...p })).sort((a, b) => a.em - b.em);
    }),

    encerrar: (id, agora) => comFila(id, async () => {
      const doc = await vivo(id, agora);
      if (!doc) return false;
      if (!doc.registro.encerradoEm) {
        doc.registro.encerradoEm = agora;
        await gravar(id, doc);
      }
      return true;
    }),

    definirCodigo: (hash, id, codigo, ateMs, agora) => comFila('codigos', async () => {
      const mapa = await lerCodigos();
      const atual = mapa[hash];
      if (atual && atual.ate > agora && atual.id !== id) return false;
      mapa[hash] = { id, ate: ateMs };
      for (const [h, v] of Object.entries(mapa)) if (v.ate <= agora) delete mapa[h];
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(arquivoDosCodigos(), JSON.stringify(mapa), { mode: 0o600 });
      // O registro guarda o código pra o apresentador revê-lo depois de recarregar.
      await comFila(id, async () => {
        const doc = await vivo(id, agora);
        if (doc) { doc.registro.codigo = codigo; doc.registro.codigoAte = ateMs; await gravar(id, doc); }
      });
      return true;
    }),

    resolverCodigo: (hash, agora) => comFila('codigos', async () => {
      const v = (await lerCodigos())[hash];
      return v && v.ate > agora ? v.id : null;
    }),

    apagar: (id) => comFila(id, async () => { if (ehId(id)) await unlink(arquivo(id)).catch(() => {}); }),

    // A varredura do boot e a periódica: o arquivo vencido sai (o `ler` também o
    // apaga, mas uma demo que ninguém abre mais ficaria pra sempre).
    async varrer(agora) {
      let nomes = [];
      try { nomes = await readdir(dir); } catch { return 0; }
      let apagadas = 0;
      for (const n of nomes) {
        const m = /^demo_([0-9a-f]{40})\.json$/.exec(n);
        if (m && !(await this.ler(m[1], agora))) apagadas++;
      }
      return apagadas;
    },
  };
}
