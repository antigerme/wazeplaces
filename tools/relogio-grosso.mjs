// Relógio de parede GROSSO pra rodar a suíte: `node --import ./tools/relogio-grosso.mjs --test`
// (o test runner repassa o `--import` aos processos de cada arquivo).
//
// O `Date.now` passa a andar em degraus de 20 ms. O tempo segue correndo, mas duas horas
// tiradas perto uma da outra EMPATAM com frequência — o empate de milissegundo que uma
// máquina rápida produz só de vez em quando. Foi assim que a reprovação do CI do #258
// (2026-10-06) virou reprodução: a sonda falsa respondia no MESMO milissegundo do 401, a
// confirmação de sessão viva empatava com a hora do 401, e a comparação estrita do
// `sessaoVivaDepoisDe` (certa) não reenviava. Uma vez em ~30 rodadas no CI, nenhuma em 27
// aqui, e três testes do mesmo harness reprovando SEMPRE com este relógio.
//
// Use quando um teste reprovar no CI e não reproduzir aqui: teste que depende de o relógio
// andar entre duas chamadas aparece nesta rodada. Não é pra rodar no CI: degrau de 20 ms
// é mais grosso que qualquer relógio de verdade, e teste que mede duração pode reprovar
// por ele sem defeito nenhum.
const real = Date.now.bind(Date);
Date.now = () => Math.floor(real() / 20) * 20;
