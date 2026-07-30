// ═══════════════════════════════════════════════════════════════════════════
//  Ritmo das chamadas ao Waze — FONTE ÚNICA
// ═══════════════════════════════════════════════════════════════════════════
//
// Instrução permanente do owner, repetida duas vezes: "vá devagar nas consultas
// diretas ao WME, sempre use um jitter". Mora num módulo próprio porque o modo
// errado de cumprir isso é cada script inventar seu `setTimeout` — foi o que eu
// fiz nos primeiros e é frágil: script novo nasce sem, e ninguém percebe até o
// bloqueio chegar.
//
// A conta que levaria o bloqueio é a DO OWNER, não a minha. Isso muda o cálculo:
// o lado seguro do erro é esperar demais, nunca de menos.
//
// USO
//   import { pausaComJitter } from './waze-jitter.mjs';
//   await pausaComJitter();          // antes de CADA request ao waze.com
//
// Por que ALEATÓRIO e não um sleep fixo: intervalo constante é por si só
// assinatura de automação. Cinco chamadas separadas por 2000ms exatos não
// parecem ninguém usando um navegador; separadas por 1,7s / 3,4s / 2,2s / 3,9s,
// parecem. O jitter serve pra não ter padrão, não só pra ser lento.
//
// NÃO use isto no `callWaze` do server/core.mjs: lá é UMA chamada por ação de um
// editor de verdade, e atrasar de propósito quem está triando 200 pedidos é
// pagar o custo no lugar errado. Jitter é pra script que varre, não pra app que
// atende.

// Faixa deliberadamente folgada. Começou em 700–2200ms e subiu depois do owner
// pedir "vá devagar" pela segunda vez — na dúvida entre rápido e seguro, o
// projeto escolhe seguro, porque o custo do excesso é meu tempo e o custo da
// falta é o acesso dele ao WME.
export const JITTER_MIN_MS = 1500;
export const JITTER_MAX_MS = 4000;

let primeira = true;

// Espera antes do próximo request. A PRIMEIRA chamada não espera — não há rajada
// com uma requisição só, e fazer o script parecer travado no início convida
// alguém a "otimizar" o jitter pra fora.
export async function pausaComJitter({ silencioso = false } = {}) {
  if (primeira) { primeira = false; return 0; }
  const ms = Math.round(JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
  // Indicador só em terminal: com \r num arquivo ou pipe o contador não é
  // apagado e vaza pra dentro da linha seguinte, sujando justamente a saída que
  // alguém vai colar num relatório. Já aconteceu.
  const tty = process.stdout.isTTY && !silencioso;
  if (tty) process.stdout.write(`  … aguardando ${ms}ms\r`);
  await new Promise((r) => setTimeout(r, ms));
  if (tty) process.stdout.write(' '.repeat(26) + '\r');
  return ms;
}

// Pra script que faz várias sondas e quer avisar quanto vai demorar antes de
// começar — "parece travado" é o que faz alguém tirar o jitter.
export function estimativaMs(nChamadas) {
  const medio = (JITTER_MIN_MS + JITTER_MAX_MS) / 2;
  return Math.max(0, nChamadas - 1) * medio;
}

// Reset só pra teste: o estado de "primeira chamada" é do processo.
export function _resetJitter() { primeira = true; }
