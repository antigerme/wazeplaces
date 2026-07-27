// Gerador de QR code em JS puro — zero dependência, como todo o resto do projeto.
//
// Por que existe: o pareamento computador→celular pedia pra pessoa memorizar um
// caminho de menu no OUTRO aparelho, trocar de aparelho e transcrever 6
// caracteres. Cada tela virava um manual do aparelho que não está na sua frente.
// Ninguém precisa ser ensinado a apontar a câmera pra um QR.
//
// O link `?pair=CÓDIGO` já existia e já entra direto — isto aqui é só a camada
// de apresentação dele.
//
// Escopo deliberadamente estreito, porque o conteúdo é sempre a MESMA forma de
// URL curta (~50 bytes): modo BYTE, correção nível M, versões 1 a 6. Parar na 6
// evita os blocos de "version information" (obrigatórios a partir da 7) e, de
// quebra, todas as versões nesse intervalo têm um único grupo de blocos — o que
// simplifica a intercalação. Capacidade na v6/M: 106 bytes, folga de sobra.
//
// Não dá pra usar gerador externo: a CSP proíbe host de fora, e o código de
// pareamento é CREDENCIAL — mandar pra um serviço de terceiro seria vazar sessão.

(function () {
  'use strict';

  // [total de codewords, codewords de correção por bloco, número de blocos]
  const VERSOES = {
    1: [26, 10, 1], 2: [44, 16, 1], 3: [70, 26, 1],
    4: [100, 18, 2], 5: [134, 24, 2], 6: [172, 16, 4],
  };
  // Centro do único padrão de alinhamento (a v1 não tem nenhum).
  const ALINHAMENTO = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 };

  // ── Aritmética em GF(256), polinômio primitivo 0x11d ──────────────────────
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function tabelas() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  // Polinômio gerador de grau `grau` para Reed-Solomon.
  function gerador(grau) {
    let p = [1];
    for (let i = 0; i < grau; i++) {
      const novo = new Array(p.length + 1).fill(0);
      // Coeficientes do maior grau pro menor. Multiplicar por (x + α^i): o
      // termo em `x` sobe o coeficiente uma casa (mesmo índice no array novo,
      // que é uma posição maior) e o termo constante desce uma casa. Inverter
      // os dois monta um polinômio gerador diferente — e a correção de erro sai
      // inteira errada, sem nada acusar até tentar ler o código.
      for (let j = 0; j < p.length; j++) {
        novo[j] ^= p[j];
        novo[j + 1] ^= mul(p[j], EXP[i]);
      }
      p = novo;
    }
    return p;
  }

  // Resto da divisão — são os codewords de correção de erro.
  function correcao(dados, grau) {
    const g = gerador(grau);
    const resto = new Array(grau).fill(0);
    for (const byte of dados) {
      const fator = byte ^ resto.shift();
      resto.push(0);
      for (let i = 0; i < grau; i++) resto[i] ^= mul(g[i + 1], fator);
    }
    return resto;
  }

  // ── Bitstream ─────────────────────────────────────────────────────────────
  function bytesDeTexto(texto) {
    const out = [];
    for (const b of new TextEncoder().encode(texto)) out.push(b);
    return out;
  }

  function menorVersao(nBytes) {
    for (let v = 1; v <= 6; v++) {
      const [total, ecPorBloco, blocos] = VERSOES[v];
      const dados = total - ecPorBloco * blocos;
      // 4 bits de modo + 8 bits de tamanho = 12 bits antes dos dados.
      if (nBytes + 2 <= dados) return v;
    }
    return null;
  }

  function montarCodewords(bytes, versao) {
    const [total, ecPorBloco, blocos] = VERSOES[versao];
    const nDados = total - ecPorBloco * blocos;

    const bits = [];
    const push = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >> i) & 1); };
    push(0b0100, 4);          // modo byte
    push(bytes.length, 8);    // tamanho (8 bits basta até a v9)
    for (const b of bytes) push(b, 8);
    // Terminador de até 4 bits, depois completa o byte.
    for (let i = 0; i < 4 && bits.length < nDados * 8; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const dados = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dados.push(b);
    }
    // Preenchimento alternado definido pela norma.
    const PAD = [0xec, 0x11];
    for (let i = 0; dados.length < nDados; i++) dados.push(PAD[i % 2]);

    // Um único grupo em todas as versões 1–6 com nível M.
    const porBloco = nDados / blocos;
    const blocosDados = [];
    const blocosEc = [];
    for (let i = 0; i < blocos; i++) {
      const parte = dados.slice(i * porBloco, (i + 1) * porBloco);
      blocosDados.push(parte);
      blocosEc.push(correcao(parte, ecPorBloco));
    }
    // Intercalação: uma coluna de cada bloco por vez.
    const saida = [];
    for (let i = 0; i < porBloco; i++) for (const b of blocosDados) saida.push(b[i]);
    for (let i = 0; i < ecPorBloco; i++) for (const b of blocosEc) saida.push(b[i]);
    return saida;
  }

  // ── Matriz ────────────────────────────────────────────────────────────────
  function novaMatriz(tamanho) {
    const m = [];
    for (let i = 0; i < tamanho; i++) m.push(new Int8Array(tamanho).fill(-1));
    return m;
  }

  function desenharFixos(m, versao) {
    const n = m.length;
    const set = (linha, col, v) => { if (linha >= 0 && col >= 0 && linha < n && col < n) m[linha][col] = v; };

    // Localizadores (3 cantos) + separadores.
    for (const [l0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let l = -1; l <= 7; l++) {
        for (let c = -1; c <= 7; c++) {
          const borda = l === -1 || l === 7 || c === -1 || c === 7;
          const anel = (l === 0 || l === 6 || c === 0 || c === 6) && !borda;
          const miolo = l >= 2 && l <= 4 && c >= 2 && c <= 4;
          set(l0 + l, c0 + c, borda ? 0 : (anel || miolo) ? 1 : 0);
        }
      }
    }
    // Temporização.
    for (let i = 8; i < n - 8; i++) {
      m[6][i] = i % 2 === 0 ? 1 : 0;
      m[i][6] = i % 2 === 0 ? 1 : 0;
    }
    // Alinhamento (um só, da v2 à v6).
    const a = ALINHAMENTO[versao];
    if (a !== undefined) {
      for (let l = -2; l <= 2; l++) {
        for (let c = -2; c <= 2; c++) {
          const borda = Math.max(Math.abs(l), Math.abs(c));
          m[a + l][a + c] = borda === 1 ? 0 : 1;
        }
      }
    }
    // Módulo escuro fixo.
    m[n - 8][8] = 1;
    // Reserva das áreas de formato (preenchidas depois da escolha da máscara).
    for (let i = 0; i < 9; i++) {
      if (m[8][i] === -1) m[8][i] = 0;
      if (m[i][8] === -1) m[i][8] = 0;
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][n - 1 - i] === -1) m[8][n - 1 - i] = 0;
      if (m[n - 1 - i][8] === -1) m[n - 1 - i][8] = 0;
    }
  }

  // Marca quais módulos são de função (não recebem dados nem máscara).
  function mapaFuncao(versao, tamanho) {
    const f = novaMatriz(tamanho);
    desenharFixos(f, versao);
    const mapa = [];
    for (let l = 0; l < tamanho; l++) {
      mapa.push(new Uint8Array(tamanho));
      for (let c = 0; c < tamanho; c++) mapa[l][c] = f[l][c] === -1 ? 0 : 1;
    }
    return mapa;
  }

  function colocarDados(m, funcao, codewords) {
    const n = m.length;
    let bit = 0;
    const total = codewords.length * 8;
    // A coluna 6 é de temporização: ao chegar nela, o par de colunas desliza
    // para 5/4 e a contagem SEGUE a partir dali (5 → 3 → 1). Derivar a coluna
    // sem mexer no contador faz o laço revisitar uma coluna e nunca chegar na 0.
    for (let col = n - 1; col >= 1; col -= 2) {
      if (col === 6) col = 5;
      for (let v = 0; v < n; v++) {
        for (let j = 0; j < 2; j++) {
          const c = col - j;
          const subindo = ((col + 1) & 2) === 0;
          const l = subindo ? n - 1 - v : v;
          if (funcao[l][c]) continue;
          m[l][c] = bit < total ? (codewords[bit >> 3] >> (7 - (bit & 7))) & 1 : 0;
          bit++;
        }
      }
    }
  }

  const MASCARAS = [
    (l, c) => (l + c) % 2 === 0,
    (l) => l % 2 === 0,
    (l, c) => c % 3 === 0,
    (l, c) => (l + c) % 3 === 0,
    (l, c) => (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0,
    (l, c) => ((l * c) % 2) + ((l * c) % 3) === 0,
    (l, c) => (((l * c) % 2) + ((l * c) % 3)) % 2 === 0,
    (l, c) => (((l + c) % 2) + ((l * c) % 3)) % 2 === 0,
  ];

  // Formato: 5 bits (nível + máscara) + BCH(15,5), com XOR final da norma.
  function bitsDeFormato(mascara) {
    const dados = (0b00 << 3) | mascara;   // 00 = nível M
    let resto = dados;
    for (let i = 0; i < 10; i++) {
      resto = (resto << 1) ^ (((resto >> 9) & 1) * 0b10100110111);
    }
    return (((dados << 10) | resto) ^ 0b101010000010010) & 0x7fff;
  }

  function gravarFormato(m, mascara) {
    const n = m.length;
    const bits = bitsDeFormato(mascara);
    const bit = (i) => (bits >> i) & 1;
    for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
    m[7][8] = bit(6);
    m[8][8] = bit(7);
    m[8][7] = bit(8);
    for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i);
    m[n - 8][8] = 1;
  }

  // Penalidades da norma — decidem qual máscara deixa o código mais legível.
  function penalidade(m) {
    const n = m.length;
    let p = 0;
    // Regra 1: sequências de 5+ iguais, em linha e coluna.
    for (let i = 0; i < n; i++) {
      for (const pegar of [(k) => m[i][k], (k) => m[k][i]]) {
        let cor = pegar(0), corrida = 1;
        for (let k = 1; k < n; k++) {
          const v = pegar(k);
          if (v === cor) { corrida++; } else { if (corrida >= 5) p += corrida - 2; cor = v; corrida = 1; }
        }
        if (corrida >= 5) p += corrida - 2;
      }
    }
    // Regra 2: blocos 2×2 da mesma cor.
    for (let l = 0; l < n - 1; l++) {
      for (let c = 0; c < n - 1; c++) {
        const v = m[l][c];
        if (v === m[l][c + 1] && v === m[l + 1][c] && v === m[l + 1][c + 1]) p += 3;
      }
    }
    // Regra 3: padrão 1:1:3:1:1 (confunde com localizador).
    const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const casa = (pegar, k, alvo) => alvo.every((v, i) => pegar(k + i) === v);
    for (let i = 0; i < n; i++) {
      for (const pegar of [(k) => (k < 0 || k >= n ? -1 : m[i][k]), (k) => (k < 0 || k >= n ? -1 : m[k][i])]) {
        for (let k = 0; k <= n - 11; k++) {
          if (casa(pegar, k, A)) p += 40;
          if (casa(pegar, k, B)) p += 40;
        }
      }
    }
    // Regra 4: desvio da proporção 50% de módulos escuros.
    let escuros = 0;
    for (let l = 0; l < n; l++) for (let c = 0; c < n; c++) escuros += m[l][c];
    const pct = (escuros * 100) / (n * n);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  // ── API ───────────────────────────────────────────────────────────────────
  // Devolve { tamanho, modulos } — `modulos[linha][coluna]` é 0 ou 1.
  function gerarQR(texto) {
    const bytes = bytesDeTexto(String(texto));
    const versao = menorVersao(bytes.length);
    if (!versao) return null;   // além da v6: quem chamou decide o fallback
    const tamanho = 17 + 4 * versao;
    const codewords = montarCodewords(bytes, versao);
    const funcao = mapaFuncao(versao, tamanho);

    let melhor = null;
    for (let mascara = 0; mascara < 8; mascara++) {
      const m = novaMatriz(tamanho);
      desenharFixos(m, versao);
      colocarDados(m, funcao, codewords);
      for (let l = 0; l < tamanho; l++) {
        for (let c = 0; c < tamanho; c++) {
          if (!funcao[l][c] && MASCARAS[mascara](l, c)) m[l][c] ^= 1;
        }
      }
      gravarFormato(m, mascara);
      const p = penalidade(m);
      if (!melhor || p < melhor.p) melhor = { p, m };
    }
    return { tamanho, modulos: melhor.m };
  }

  if (typeof window !== 'undefined') window.gerarQR = gerarQR;
  if (typeof globalThis !== 'undefined') globalThis.gerarQR = gerarQR;
})();
