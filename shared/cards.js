// Draws playing cards for poker and canasta. A card code is rank + suit, like "As" (ace of
// spades) or "Td" (ten of diamonds); "JK" is a joker and "??" a face-down card. Canasta adds
// ":n" to tell the two decks apart ("As:1"); that part is ignored here.
// Cards 40px wide or more get corner indices and face-card art; smaller ones just rank and suit.
window.AceCards = (() => {
  "use strict";
  const SUIT = { s: "♠︎", h: "♥︎", d: "♦︎", c: "♣︎" };   // text style, never emoji
  const SUIT_NAME = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
  const RANK_NAME = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "10" };
  const FACE = { K: "♚︎", Q: "♛︎", J: "♞︎" };   // text-style chess figures, not emoji

  function label(code) {
    const c = String(code).split(":")[0];
    if (c === "JK") return "Joker";
    if (c === "??") return "Face-down card";
    return `${RANK_NAME[c[0]] || c[0]} of ${SUIT_NAME[c[1]]}`;
  }

  // make("As") -> a <div> card; make("As", { button: true, w: 60 }) -> a <button>.
  function make(code, opts = {}) {
    const c = String(code).split(":")[0];
    const e = document.createElement(opts.button ? "button" : "div");
    if (opts.button) e.type = "button";
    const w = opts.w || 54;
    e.className = "pcard" + (w < 40 ? " mini" : "");
    if (opts.w) e.style.setProperty("--w", opts.w + "px");
    e.setAttribute("aria-label", label(code));
    e.title = label(code);
    e.dataset.card = String(code);
    if (c === "??") {
      e.classList.add("back");
      return e;
    }
    if (c === "JK") {
      e.classList.add("joker");
      e.innerHTML = w < 40 ? '<span>JKR</span><span class="s">★</span>'
        : '<span class="ci tl"><b>★</b></span><span class="mid"><span class="jk">JOKER</span></span><span class="ci br"><b>★</b></span>';
      return e;
    }
    const r = c[0] === "T" ? "10" : c[0], s = SUIT[c[1]];
    if (c[1] === "h" || c[1] === "d") e.classList.add("red");
    if (w < 40) {
      e.innerHTML = `<span>${r}</span><span class="s">${s}</span>`;
      return e;
    }
    let mid = `<span class="pip">${s}</span>`;
    if (FACE[c[0]]) mid = `<span class="face"><i>${FACE[c[0]]}</i><b>${s}</b></span>`;
    else if (c[0] === "A") mid = `<span class="pip big">${s}</span>`;
    const idx = `<b>${r}</b><i>${s}</i>`;
    e.innerHTML = `<span class="ci tl">${idx}</span><span class="mid">${mid}</span><span class="ci br">${idx}</span>`;
    return e;
  }

  const pretty = code => {
    const c = String(code).split(":")[0];
    return c === "JK" ? "Joker" : (c[0] === "T" ? "10" : c[0]) + SUIT[c[1]];
  };

  return { make, label, pretty };
})();
