import "@testing-library/jest-dom/vitest";

// jsdom não implementa reprodução de mídia — sem esses stubs, qualquer
// `<audio>.play()`/`.pause()` real (usado nos runners de Fase 1/Fase 2) lança
// "not implemented" e quebra os testes antes de chegar na lógica que importa.
window.HTMLMediaElement.prototype.play = function play() {
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function pause() {};
