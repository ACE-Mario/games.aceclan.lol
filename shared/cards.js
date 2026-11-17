// Draws playing cards for poker and canasta. A card code is rank + suit, like "As" (ace of
// spades) or "Td" (ten of diamonds); "JK" is a joker and "??" a face-down card. Canasta adds
// ":n" to tell the two decks apart ("As:1"); that part is ignored here.
window.AceCards = (() => {
  "use strict";
  const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const SUIT_NAME = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
  const RANK_NAME = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "10" };

  function label(code) {
    const c = String(code).split(":")[0];
    if (c === "JK") return "Joker";
    if (c === "??") return "Face-down card";
    return `${RANK_NAME[c[0]] || c[0]} of ${SUIT_NAME[c[1]]}`;
  }

  // make("As") -> a <div> card; make("As", { button: true }) -> a <button>.
  function make(code, opts = {}) {
    const c = String(code).split(":")[0];
    const e = document.createElement(opts.button ? "button" : "div");
    if (opts.button) e.type = "button";
    e.className = "pcard";
    if (opts.w) e.style.setProperty("--w", opts.w + "px");
    e.setAttribute("aria-label", label(code));
    e.title = label(code);
    if (c === "??") {
      e.classList.add("back");
    } else if (c === "JK") {
      e.classList.add("joker");
      e.innerHTML = '<span>JOKER</span><span class="s">★</span>';
    } else {
      if (c[1] === "h" || c[1] === "d") e.classList.add("red");
      e.innerHTML = `<span>${c[0] === "T" ? "10" : c[0]}</span><span class="s">${SUIT[c[1]]}</span>`;
    }
    return e;
  }

  const pretty = code => {
    const c = String(code).split(":")[0];
    return c === "JK" ? "Joker" : (c[0] === "T" ? "10" : c[0]) + SUIT[c[1]];
  };

  return { make, label, pretty };
})();
