// Canasta, online. The server (server/games/canasta.py) deals, keeps each hand private and checks
// every meld. Here you pick cards: select some, press "Make a meld group" (or tap one of your
// side's melds to add to it), then Meld; or include the pile's top card and Take the pile.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const RANK_NAME = { A: "Aces", K: "Kings", Q: "Queens", J: "Jacks", T: "10s", 3: "Black 3s" };
  const rankOf = c => (c.startsWith("JK") ? "JK" : c[0]);
  const isWild = c => ["JK", "2"].includes(rankOf(c));
  const rankName = r => RANK_NAME[r] || r + "s";
  const fmt = n => Number(n || 0).toLocaleString("en-GB");

  let send = null, state = null;
  let picked = new Set();          // selected hand cards
  let pilePicked = false;          // the pile's top card is selected
  let groups = [];                 // staged meld groups: { cards: [...], rank? }
  let handKey = "";

  const stagedCards = () => new Set(groups.flatMap(g => g.cards));
  function clearPicks() { picked = new Set(); pilePicked = false; groups = []; }

  // ---- Buttons ----
  $("drawBtn").addEventListener("click", () => send("draw"));
  $("stageBtn").addEventListener("click", () => stage());
  $("clearBtn").addEventListener("click", () => { clearPicks(); draw(); });
  $("meldBtn").addEventListener("click", async () => {
    if (picked.size) stage();
    if (!groups.length) return;
    if (await send("meld", { groups })) { clearPicks(); }
    draw();
  });
  $("takeBtn").addEventListener("click", async () => {
    if (picked.size || pilePicked) stage();
    if (await send("take", { groups })) clearPicks();
    draw();
  });
  $("discardBtn").addEventListener("click", async () => {
    if (picked.size !== 1) return;
    const [card] = picked;
    if (await send("discard", { card })) clearPicks();
    draw();
  });

  function stage(rank) {
    const cards = [...picked];
    if (pilePicked && state.pileTop) cards.push(state.pileTop);
    if (!cards.length) return;
    const g = { cards };
    if (rank) g.rank = rank;
    groups.push(g);
    picked = new Set();
    pilePicked = false;
    draw();
  }

  function cardsRow(cards, w, cls) {
    const d = document.createElement("div");
    d.className = cls || "fan";
    cards.forEach(c => d.appendChild(AceCards.make(c, { w })));
    return d;
  }

  function draw() {
    const s = state;
    if (!s) return;
    const api = draw.api;
    const n = s.seats.length;
    const playing = s.started && s.hand !== undefined;
    const myTurn = api.inGame && s.mySeat != null && s.turn === s.mySeat && s.phase !== "between";

    // Reset picks when a new hand is dealt or the hand changes under us.
    const key = s.handNo + ":" + (s.hand || []).join(",");
    if (key !== handKey) {
      const hand = new Set(s.hand || []);
      picked = new Set([...picked].filter(c => hand.has(c)));
      groups = groups.filter(g => g.cards.every(c => hand.has(c) || c === s.pileTop));
      handKey = key;
    }

    // Other players
    const others = $("others");
    others.innerHTML = "";
    if (playing) {
      s.seats.forEach((x, i) => {
        if (i === s.mySeat) return;
        const d = document.createElement("div");
        d.className = "other" + (i === s.turn && s.phase !== "between" ? " turn" : "") + (n === 4 && s.mySide != null && i % 2 === s.mySide ? " partner" : "");
        d.innerHTML = `<b></b><span class="muted small"></span>`;
        d.querySelector("b").textContent = x.name + (x.online ? "" : " (away)");
        d.querySelector("span").textContent = `${s.counts[i]} card${s.counts[i] === 1 ? "" : "s"}` + (n === 4 && s.mySide != null ? (i % 2 === s.mySide ? " · partner" : " · opponent") : "");
        if (s.hands) d.appendChild(cardsRow(s.hands[i], 26, "fan tight"));
        others.appendChild(d);
      });
    }

    // Melds per side
    const sides = $("sides");
    sides.innerHTML = "";
    if (playing) {
      const order = s.sides.map((_, k) => k);
      if (s.mySide != null) order.sort((a, b) => (a === s.mySide ? -1 : b === s.mySide ? 1 : 0));
      for (const sd of order) {
        const box = document.createElement("div");
        box.className = "side" + (sd === s.mySide ? " mine" : "");
        const names = s.sides[sd].map(i => s.seats[i].name).join(" & ");
        const head = document.createElement("div");
        head.className = "side-head";
        head.innerHTML = `<b></b><span class="side-score"></span>`;
        head.querySelector("b").textContent = sd === s.mySide ? (n === 4 ? `Your team (${names})` : "Your melds") : names;
        head.querySelector(".side-score").textContent = `${fmt(s.scores[sd])} pts · ${s.canastas[sd]} canasta${s.canastas[sd] === 1 ? "" : "s"}`;
        box.appendChild(head);
        const melds = document.createElement("div");
        melds.className = "melds";
        if (s.red3[sd].length) {
          const m = document.createElement("div");
          m.className = "meld red3";
          m.appendChild(cardsRow(s.red3[sd], 34));
          m.appendChild(Object.assign(document.createElement("small"), { textContent: "Red 3s" }));
          melds.appendChild(m);
        }
        if (!s.melds[sd].length) {
          const p = document.createElement("p");
          p.className = "muted small";
          p.textContent = s.minMeld[sd] ? `No melds yet. First meld needs ${s.minMeld[sd]} points.` : "No melds yet.";
          melds.appendChild(p);
        }
        for (const m of s.melds[sd]) {
          const el = document.createElement(sd === s.mySide && myTurn ? "button" : "div");
          if (el.tagName === "BUTTON") {
            el.type = "button";
            el.title = `Add the selected cards to your ${rankName(m.rank)}`;
            el.addEventListener("click", () => {
              if (picked.size || pilePicked) stage(m.rank);
            });
          }
          const canasta = m.cards.length >= 7;
          const natural = !m.cards.some(isWild);
          el.className = "meld" + (canasta ? (natural ? " canasta natural" : " canasta mixed") : "");
          el.appendChild(cardsRow(m.cards, 34));
          el.appendChild(Object.assign(document.createElement("small"), {
            textContent: `${rankName(m.rank)} · ${m.cards.length}` + (canasta ? (natural ? " · natural canasta" : " · mixed canasta") : ""),
          }));
          melds.appendChild(el);
        }
        box.appendChild(melds);
        sides.appendChild(box);
      }
    }

    // Stock, pile and staged groups
    $("middle").hidden = !playing;
    $("stock").innerHTML = "";
    $("pile").innerHTML = "";
    if (playing) {
      $("stock").appendChild(AceCards.make("??", { w: 58 }));
      $("stockText").textContent = `Stock: ${s.stock}`;
      if (s.pileTop) {
        const top = AceCards.make(s.pileTop, { w: 58, button: true });
        top.classList.toggle("picked", pilePicked);
        top.disabled = !(myTurn && s.phase === "draw");
        top.title = "Select the top card to meld it and take the pile";
        top.addEventListener("click", () => { pilePicked = !pilePicked; draw(); });
        $("pile").appendChild(top);
        if (s.frozen) $("pile").classList.add("frozen"); else $("pile").classList.remove("frozen");
      } else {
        $("pile").appendChild(Object.assign(document.createElement("div"), { className: "pcard blank" }));
        $("pile").classList.remove("frozen");
      }
      $("pileText").textContent = s.pileSize ? `Pile: ${s.pileSize}${s.frozen ? " · frozen" : ""}` : "Pile: empty";
    }
    const staged = $("staged");
    staged.innerHTML = "";
    groups.forEach((g, k) => {
      const d = document.createElement("div");
      d.className = "group";
      d.appendChild(cardsRow(g.cards, 30));
      const x = document.createElement("button");
      x.type = "button";
      x.className = "link-btn";
      x.textContent = g.rank ? `on ${rankName(g.rank)} ✕` : "✕";
      x.title = "Put these cards back";
      x.addEventListener("click", () => { groups.splice(k, 1); draw(); });
      d.appendChild(x);
      staged.appendChild(d);
    });
    if (groups.length) {
      const total = groups.flatMap(g => g.cards).reduce((t, c) => t + ({ JK: 50, 2: 20, A: 20, K: 10, Q: 10, J: 10, T: 10, 9: 10, 8: 10 }[rankOf(c)] || 5), 0);
      staged.appendChild(Object.assign(document.createElement("span"), { className: "muted small", textContent: `Staged: ${total} points` }));
    }

    // My hand
    const handEl = $("hand");
    handEl.innerHTML = "";
    const inGroups = stagedCards();
    (s.hand || []).forEach(c => {
      if (inGroups.has(c)) return;
      const b = AceCards.make(c, { w: 52, button: true });
      b.classList.toggle("picked", picked.has(c));
      b.disabled = !myTurn;
      b.addEventListener("click", () => { picked.has(c) ? picked.delete(c) : picked.add(c); draw(); });
      handEl.appendChild(b);
    });

    // Controls
    $("controls").hidden = !myTurn;
    if (myTurn) {
      const drawPhase = s.phase === "draw";
      $("drawBtn").hidden = !drawPhase;
      $("takeBtn").hidden = !drawPhase || !s.pileTop;
      $("takeBtn").disabled = !(groups.length || picked.size || pilePicked);
      $("meldBtn").hidden = drawPhase;
      $("meldBtn").disabled = !(groups.length || picked.size);
      $("discardBtn").hidden = drawPhase;
      $("discardBtn").disabled = picked.size !== 1 || groups.length > 0;
      $("stageBtn").disabled = !(picked.size || pilePicked);
    }
    let help = "";
    if (myTurn && s.phase === "draw") {
      help = s.stock ? "Draw from the stock, or take the pile: select its top card with matching cards from your hand, then press Take the pile." : "The stock is empty. Take the pile if you can, or press Draw to end the hand.";
    } else if (myTurn) {
      help = "Select cards and press Make a meld group (tap one of your melds to add to it), then Meld. Finish your turn by selecting one card and pressing Discard.";
      if (s.mySide != null && s.minMeld[s.mySide]) help += ` Your first meld must be worth ${s.minMeld[s.mySide]} points.`;
    }
    $("helpText").textContent = help;

    // Scores (after each hand)
    $("scoreBox").hidden = !(playing && s.last);
    if (s.last) {
      const rows = s.last.map(r => `<tr><td>${api.esc(r.name)}</td><td>${fmt(r.melds)}</td><td>${fmt(r.canastas)}</td><td>${fmt(r.red3)}</td><td>${fmt(r.out)}</td><td>${fmt(r.hand)}</td><td><b>${r.total >= 0 ? "+" : ""}${fmt(r.total)}</b></td><td><b>${fmt(r.score)}</b></td></tr>`).join("");
      $("scores").innerHTML = `<div class="score-wrap"><table class="score-table"><thead><tr><th></th><th>Melds</th><th>Canastas</th><th>Red 3s</th><th>Going out</th><th>Left in hand</th><th>Hand</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted small">First to ${fmt(s.target)} wins.</p>`;
      if (api.inGame && s.phase === "between" && s.mySeat != null) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn primary";
        b.textContent = "Deal the next hand";
        b.addEventListener("click", () => send("next_hand"));
        $("scores").appendChild(b);
      }
    }

    // Status
    if (!s.started) {
      api.status("Lobby", "4 players: two teams of 2, partners sit opposite. 2 or 3 players: everyone for themselves.");
      api.hint(api.me.role === "player" ? "You've got a seat. Waiting for the leader to deal." : "Take a seat in the Players panel to play.");
    } else if (s.over) {
      api.status("Game over", s.result, "win");
      api.hint(s.isHost ? "Press Play again for a new game." : "Waiting for the leader to start a new game.");
    } else if (s.phase === "between") {
      api.status(`Hand ${s.handNo} over`, s.wentOut != null ? `${api.seatName(s.wentOut)} went out.` : "The stock ran out.", "win");
      api.hint("Scores are below. Anyone playing can deal the next hand.");
    } else {
      api.status(`${api.seatName(s.turn)}'s turn`, `Hand ${s.handNo} · ${s.phase === "draw" ? "drawing" : "melding and discarding"}`, myTurn ? "go" : "");
      api.hint(s.mySeat == null ? "You're watching. Hands stay hidden." : myTurn ? (s.phase === "draw" ? "Your turn: draw, or take the pile." : "Meld if you can, then discard one card.") : `Waiting for ${api.seatName(s.turn)}.`, myTurn ? "go" : "");
    }
  }

  AceRoom.start({
    game: "canasta",
    title: "Canasta",
    blurb: "The classic rummy card game. Meld sets of the same rank, build canastas of seven, and go out first. Two decks plus jokers.",
    players: "2 to 4 players. With 4, you play in two teams of 2.",
    canSkip: true,
    options: [
      { key: "target", label: "Game length", choices: [["5000", "First to 5,000"], ["2500", "First to 2,500"], ["1500", "First to 1,500"]] },
    ],
    seatTag: (i, s) => (s.counts ? `${s.counts[i]} cards` : ""),
    lobbyText: (s, text) => {
      const seated = s.players.filter(p => p.role === "player");
      if (seated.length === 4) {
        const a = seated.filter(p => p.team === "A").length;
        if (a !== 2) return "With 4 players, each team needs 2 people. Pick Team A or Team B in the Players panel.";
      }
      return text;
    },
    rules: `<ol>
      <li><b>Your turn:</b> draw from the stock (2 cards in a 2-player game), or take the whole discard pile. Then meld if you like, and discard one card.</li>
      <li><b>Melds</b> are 3 or more cards of the same rank (4s up to Aces). 2s and jokers are wild: a meld needs at least two natural cards, and at most 3 wild cards (never more wild than natural).</li>
      <li><b>Canasta:</b> a meld of 7 or more cards. Natural (no wilds) is worth 500 bonus points, mixed 300. You need one canasta to go out (two in a 2-player game).</li>
      <li><b>First meld:</b> your side's first meld of the hand must be worth at least 50 points (15 if your score is below 0, 90 from 1,500, 120 from 3,000).</li>
      <li><b>Taking the pile:</b> you must meld its top card straight away, with two matching cards from your hand, or a matching card and a wild, or by adding it to one of your melds. You can't take it with a wild card or a 3 on top.</li>
      <li><b>Frozen pile:</b> discarding a wild card freezes the pile. While it's frozen (and always until your side has melded), you need two natural matching cards from your hand to take it.</li>
      <li><b>Black 3s</b> block the pile for the next player. You can only meld them (3 or 4, no wilds) when going out. <b>Red 3s</b> go face up at once for 100 points each (800 for all four), and you draw a replacement.</li>
      <li><b>Card points:</b> jokers 50, 2s and Aces 20, King to 8 10, 7 to 4 and black 3s 5. When someone goes out (100 bonus, 200 if they hadn't melded before that turn), each side scores its melds and bonuses, minus the cards left in its hands.</li>
    </ol>
    <p class="muted small">If the stock runs out, the hand ends with no going-out bonus.</p>`,
    render(s, api) {
      send = api.send;
      state = s;
      draw.api = api;
      draw();
    },
  });
})();
