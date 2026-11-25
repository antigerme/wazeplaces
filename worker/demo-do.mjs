// ═══════════════════════════════════════════════════════════════════════════
//  O Durable Object da DEMO: uma instância por sala (e uma por código curto)
// ═══════════════════════════════════════════════════════════════════════════
//
// É a MESMA `SalaViva` da VM, com o `storage` do DO no lugar do arquivo e o
// alarme do DO no lugar do `setTimeout`. A regra do jogo não está aqui
// (`server/demo-sala.mjs`), nem a difusão (`server/demo-sala-viva.mjs`): este
// arquivo é só a cola, e por isso é pequeno.
//
// Por que um DO e não o KV: o voto é anônimo e o KV é o mesmo das sessões (1.000
// escritas por dia); um link vazado esgotaria a cota e derrubaria a renovação de
// sessão de todo editor. No DO a contagem é atômica (o teto de pessoas é de
// verdade), o resultado é consistente (sem a defasagem de ~60 s do `list`) e as
// escritas são do próprio DO (100 mil linhas por dia no plano grátis), não do KV.
//
// A classe NÃO importa `cloudflare:workers` (o formato clássico de DO, com
// `constructor(state, env)`, dispensa): o teste a carrega no Node com um `state`
// de mentira.
import { SalaViva } from '../server/demo-sala-viva.mjs';

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export class DemoSalaDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sala = new SalaViva({
      salvar: (snap) => state.storage.put('sala', snap),
      // O alarme precisa ser FUTURO; o `agendar` da sala já manda o próximo prazo.
      agendar: (ts) => { Promise.resolve(state.storage.setAlarm(Math.max(ts, Date.now() + 1))).catch(() => {}); },
      apagar: async () => { await state.storage.deleteAlarm(); await state.storage.deleteAll(); },
    });
    // Ninguém atende antes de o retrato ser lido: uma ação no meio do despertar
    // veria a sala "inexistente".
    this.pronta = state.blockConcurrencyWhile(async () => {
      const snap = await state.storage.get('sala');
      if (snap) this.sala.carregar(snap);
    });
  }

  async fetch(request) {
    await this.pronta;
    let corpo = {};
    try { corpo = await request.json(); } catch { corpo = {}; }
    switch (new URL(request.url).pathname) {
      case '/criar': {
        const r = this.sala.criar(corpo);
        return json(r.ok ? { ok: true } : { ok: false, motivo: r.motivo });
      }
      case '/acao': {
        const { status, body } = await this.sala.acao(corpo);
        return json(body, status);
      }
      case '/fluxo': {
        const r = this.sala.fluxo(corpo);
        return r instanceof Response ? r : json(r.body, r.status);
      }
      case '/codigo-definir': {
        const atual = await this.state.storage.get('codigo');
        if (atual && atual.ate > Date.now() && atual.id !== corpo.id) return json({ ok: false });
        await this.state.storage.put('codigo', { id: corpo.id, ate: corpo.ate });
        Promise.resolve(this.state.storage.setAlarm(Math.max(corpo.ate, Date.now() + 1))).catch(() => {});
        return json({ ok: true });
      }
      case '/codigo-resolver': {
        const c = await this.state.storage.get('codigo');
        return json({ id: c && c.ate > Date.now() ? c.id : null });
      }
      default:
        return json({ success: false, error: 'Não encontrado' }, 404);
    }
  }

  // O alarme: o tempo da sala andou (contagem, relógio do pedido, recado, fim) ou
  // o código curto venceu.
  async alarm() {
    await this.pronta;
    if (this.sala.existe()) { await this.sala.tick(); return; }
    const c = await this.state.storage.get('codigo');
    if (c && c.ate <= Date.now()) await this.state.storage.deleteAll();
  }
}
