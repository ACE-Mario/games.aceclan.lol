// Ace Poker Night, online. Texas hold'em for points (no real money). The server
// (server/games/poker.py) deals, runs the betting and side pots, and only sends you your own
// hole cards until a showdown. This page draws the table and the betting buttons.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const fmt = n => Number(n || 0).toLocaleString("en-GB");
  let send = null, state = null, nextTimer = 0;

  // ---- Betting controls ----
  $("foldBtn").addEventListener("click", () => send("fold"));
  $("checkBtn").addEventListener("click", () => {
    const me = state.me || {};
    send(me.canCheck ? "check" : "call");
  });
  $("allinBtn").addEventListener("click", () => {
    if (confirm("Go all in?")) send("allin");
  });
  $("raiseRange").addEventListener("input", () => { $("raiseInput").value = $("raiseRange").value; syncRaise(); });
  $("raiseInput").addEventListener("input", syncRaise);
  $("raiseBtn").addEventListener("click", () => send("raise", { to: Number($("raiseInput").value) }));
  $("showBtn").addEventListener("click", () => send("show"));
  $("nextBtn").addEventListener("click", () => send("next_hand"));

  function syncRaise() {
    const me = state && state.me || {};
    const v = Number($("raiseInput").value);
    $("raiseRange").value = v;
    $("raiseBtn").textContent = (state.toCall ? "Raise to " : "Bet ") + fmt(v);
    $("raiseBtn").disabled = !(v >= me.minTo && v <= me.maxTo);
  }

  // Seats sit round an oval, with you at the bottom.
  function seatPos(i, n, mine) {
    const k = ((i - (mine ?? 0)) % n + n) % n;
    const a = Math.PI / 2 + (k / n) * Math.PI * 2;
    return { x: 50 + Math.cos(a) * 43, y: 50 + Math.sin(a) * 40 };
  }

  function render(s, api) {
    state = s;
    const ring = $("seatsRing");
    const felt = $("boardCards");
    ring.innerHTML = "";
    felt.innerHTML = "";
    const table = s.table || [];
    const n = s.seats.length;
    const playing = s.started && table.length;

    // Seats
    s.seats.forEach((x, i) => {
      const t = table[i] || {};
      const p = seatPos(i, n, s.mySeat);
      const d = document.createElement("div");
      d.className = "pseat";
      if (playing && i === s.turn && !s.over) d.classList.add("turn");
      if (t.folded) d.classList.add("folded");
      if (t.out) d.classList.add("out");
      if (i === s.mySeat) d.classList.add("mine");
      if (s.results && s.results.pots.some(pt => pt.winners.includes(i))) d.classList.add("won");
      d.style.left = p.x + "%";
      d.style.top = p.y + "%";
      const cards = document.createElement("div");
      cards.className = "pseat-cards";
      if (t.cards && i !== s.mySeat) t.cards.forEach(c => cards.appendChild(AceCards.make(c, { w: 30 })));
      d.appendChild(cards);
      const plate = document.createElement("div");
      plate.className = "plate";
      plate.innerHTML = `<b></b><span class="chips"></span><small class="act"></small>`;
      plate.querySelector("b").textContent = x.name + (x.online ? "" : " (away)");
      plate.querySelector(".chips").textContent = playing ? (t.out ? "out" : fmt(t.chips) + " pts") : "";
      const hand = s.results && s.results.hands && s.results.hands[String(i)];
      plate.querySelector(".act").textContent = hand || (t.allin ? "All in" : t.action || "");
      d.appendChild(plate);
      if (playing && !s.over) {
        const tags = [];
        if (i === s.dealer) tags.push(["D", "dealer"]);
        if (s.phase === "betting" && i === s.sb && n > 2) tags.push(["SB", "blind"]);
        if (s.phase === "betting" && i === s.bb) tags.push(["BB", "blind"]);
        for (const [txt, cls] of tags) {
          const b = document.createElement("span");
          b.className = "chip-tag " + cls;
          b.textContent = txt;
          d.appendChild(b);
        }
        if (t.bet) {
          const b = document.createElement("span");
          b.className = "bet";
          b.textContent = fmt(t.bet);
          d.appendChild(b);
        }
      }
      ring.appendChild(d);
    });

    // Board and pot
    if (playing) {
      for (let k = 0; k < 5; k++) {
        const c = s.board[k];
        felt.appendChild(c ? AceCards.make(c, { w: 50 }) : Object.assign(document.createElement("div"), { className: "pcard blank" }));
      }
      const side = (s.pots || []).length > 1 ? ` (main ${fmt(s.pots[0])}, side ${s.pots.slice(1).map(fmt).join(", ")})` : "";
      $("potText").textContent = s.pot ? `Pot ${fmt(s.pot)}${side}` : (s.results ? "" : "");
      if (s.results && s.phase === "between") {
        $("potText").textContent = s.results.pots.map(pt => `${pt.winners.map(api.seatName).join(" & ")} won ${fmt(pt.amount)}${pt.hand ? " · " + pt.hand : ""}`).join(" | ");
      }
    } else {
      $("potText").textContent = "Points only · no real money";
    }

    // My hand, with the best five highlighted after a showdown
    const mine = s.mySeat != null && table[s.mySeat];
    $("myHand").hidden = !(mine && mine.cards);
    $("myHand").innerHTML = "";
    if (mine && mine.cards) {
      mine.cards.forEach(c => $("myHand").appendChild(AceCards.make(c, { w: 70 })));
      const label = document.createElement("span");
      label.className = "my-label";
      label.textContent = mine.folded ? "Folded" : (s.results && s.results.hands && s.results.hands[String(s.mySeat)]) || "Your cards";
      $("myHand").appendChild(label);
    }

    // Betting bar
    const me = s.me || {};
    const myTurn = api.inGame && s.phase === "betting" && s.turn === s.mySeat && s.mySeat != null;
    $("actionBar").hidden = !myTurn;
    if (myTurn) {
      $("checkBtn").textContent = me.canCheck ? "Check" : `Call ${fmt(me.callAmount)}`;
      $("raiseBox").hidden = !me.canRaise || me.minTo >= me.maxTo;
      $("allinBtn").hidden = !me.canRaise && me.canCheck;
      $("allinBtn").textContent = `All in (${fmt(mine.chips)})`;
      const r = $("raiseRange");
      r.min = me.minTo; r.max = me.maxTo; r.step = Math.max(1, Math.floor(s.big / 2));
      if (!(Number($("raiseInput").value) >= me.minTo && Number($("raiseInput").value) <= me.maxTo) || $("raiseInput").dataset.hand !== String(s.handNo) + s.street) {
        $("raiseInput").value = me.minTo;
        $("raiseInput").dataset.hand = String(s.handNo) + s.street;
      }
      $("raiseInput").min = me.minTo; $("raiseInput").max = me.maxTo;
      syncRaise();
    }

    // Between hands
    const between = api.inGame && s.phase === "between";
    $("afterBar").hidden = !between;
    if (between) {
      $("showBtn").hidden = !(mine && mine.cards && !(s.results && s.results.showdown && !mine.folded) && !mine.out);
      $("nextBtn").hidden = !s.isHost;
      const until = Date.now() + (s.nextIn || 0) * 1000;
      clearInterval(nextTimer);
      const tick = () => { $("nextNote").textContent = `Next hand in ${Math.max(0, Math.ceil((until - Date.now()) / 1000))}s`; };
      tick();
      nextTimer = setInterval(tick, 500);
    } else clearInterval(nextTimer);

    // Status
    if (!s.started) {
      api.status("Lobby", "Texas hold'em for points. Last player with points wins.");
      api.hint(api.me.role === "player" ? "You've got a seat. Waiting for the leader to deal." : "Take a seat in the Players panel to play.");
    } else if (s.over) {
      api.status(s.winner != null ? `${api.seatName(s.winner)} wins` : "Game over", s.result, "win");
      api.hint(s.isHost ? "Press Play again for a new game." : "Waiting for the leader to start a new game.");
    } else if (s.phase === "between") {
      api.status(`Hand ${s.handNo} over`, `Blinds ${fmt(s.big / 2)} / ${fmt(s.big)}`, "win");
      api.hint(s.mySeat == null ? "You're watching." : mine.out ? "You're out of points. Watch the rest, or wait for the next game." : "");
    } else {
      const streetName = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" }[s.street];
      api.status(`Hand ${s.handNo} · ${streetName}`, `Blinds ${fmt(s.big / 2)} / ${fmt(s.big)} · ${api.seatName(s.turn)} to act`, myTurn ? "go" : "");
      api.hint(s.mySeat == null ? "You're watching. Hole cards stay hidden until a showdown."
        : mine.out ? "You're out of points." : mine.folded ? "You folded this hand."
        : myTurn ? (me.canCheck ? "Your turn: check, bet or fold." : `Your turn: ${fmt(me.callAmount)} to call.`)
        : `Waiting for ${api.seatName(s.turn)}.`, myTurn ? "go" : "");
    }
  }

  AceRoom.start({
    game: "poker",
    title: "Ace Poker Night",
    blurb: "Texas hold'em for the clan. Everyone starts with the same points; last one with points wins. Points only, no real money.",
    players: "2 to 9 players.",
    canSkip: true,
    options: [
      { key: "stack", label: "Starting points", choices: [["1000", "1,000 points each"], ["500", "500 points each"], ["2000", "2,000 points each"], ["5000", "5,000 points each"]] },
      { key: "blinds", label: "Blinds", choices: [["10", "Blinds 5 / 10"], ["20", "Blinds 10 / 20"], ["50", "Blinds 25 / 50"], ["100", "Blinds 50 / 100"]] },
      { key: "rise", label: "Blinds go up", choices: [["10", "Blinds double every 10 hands"], ["5", "Blinds double every 5 hands"], ["0", "Blinds never go up"]] },
    ],
    seatTag: (i, s) => (s.table && s.table[i] ? (s.table[i].out ? "out" : fmt(s.table[i].chips)) : ""),
    rules: `<ol>
      <li>Everyone gets two private cards. Five shared cards come face up in the middle: three (the flop), then one (the turn), then one more (the river).</li>
      <li>Make the best five-card hand from your two cards and the five shared ones.</li>
      <li>The two players left of the dealer button post the small and big blinds. Then each round of betting goes round the table: <b>fold</b> (give up the hand), <b>check</b> (pass, if nobody has bet), <b>call</b> (match the bet), <b>raise</b> (bet more) or go <b>all in</b>.</li>
      <li>A raise must be at least as big as the last bet or raise. If you go all in for less than you'd need to call, a side pot is made for the others and you can only win the part you matched.</li>
      <li>If everyone else folds, you win the pot. Otherwise the best hand at the showdown wins (ties split it).</li>
      <li>Hands from best to worst: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, high card.</li>
    </ol>
    <p class="muted small">Points only, no real money. The leader can skip someone who's away (they check or fold).</p>`,
    render(s, api) {
      send = api.send;
      render(s, api);
    },
  });
})();
