// Snakes & Ladders, online. The server (server/games/snakes.py) rolls the die and moves the
// counters; this page draws the board and animates each move.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const COLORS = ["#ff4655", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899"];
  const COLOR_NAMES = ["Red", "Blue", "Green", "Orange", "Purple", "Pink"];
  const FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

  // Square n (1-100) -> centre in board percent. Row 1 runs left to right along the bottom.
  function xy(n) {
    if (n <= 0) return { x: 4, y: 97 };       // not on the board yet: wait in the corner by square 1
    const row = Math.floor((n - 1) / 10), col = (n - 1) % 10;
    const c = row % 2 ? 9 - col : col;
    return { x: c * 10 + 5, y: 100 - (row * 10 + 5) };
  }

  let built = false, tokens = [], lastRoll = null, shown = [];

  function build(s) {
    const board = $("board");
    board.innerHTML = "";
    const sq = document.createElement("div");
    sq.className = "squares";
    for (let r = 9; r >= 0; r--) {
      for (let c = 0; c < 10; c++) {
        const n = r * 10 + (r % 2 ? 9 - c : c) + 1;
        const d = document.createElement("div");
        d.className = "sq" + (n === 100 ? " end" : (n % 7 === 0 ? " c" + (n % 4 + 1) : ""));
        d.textContent = n;
        sq.appendChild(d);
      }
    }
    board.appendChild(sq);
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("class", "art");
    svg.setAttribute("aria-hidden", "true");
    const add = (tag, attrs, parent = svg) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent.appendChild(e);
      return e;
    };
    // Ladders: two rails and rungs every few units.
    for (const [a, b] of Object.entries(s.ladders)) {
      const p = xy(+a), q = xy(b);
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
      const nx = -dy / len * 1.8, ny = dx / len * 1.8;
      add("line", { x1: p.x + nx, y1: p.y + ny, x2: q.x + nx, y2: q.y + ny, class: "rail" });
      add("line", { x1: p.x - nx, y1: p.y - ny, x2: q.x - nx, y2: q.y - ny, class: "rail" });
      for (let t = 0.08; t < 1; t += 3.2 / len) {
        const x = p.x + dx * t, y = p.y + dy * t;
        add("line", { x1: x + nx, y1: y + ny, x2: x - nx, y2: y - ny, class: "rung" });
      }
    }
    // Snakes: a wiggly curve from head to tail, with a head and eyes.
    const hues = ["#2f9e44", "#d9480f", "#7048e8", "#c2255c", "#0c8599", "#e67700", "#5c940d", "#862e9c"];
    Object.entries(s.snakes).forEach(([a, b], i) => {
      const h = xy(+a), t = xy(b);
      const dx = t.x - h.x, dy = t.y - h.y, len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len, w = Math.min(7, len / 4);
      const c1 = { x: h.x + dx * .3 + nx * w, y: h.y + dy * .3 + ny * w };
      const c2 = { x: h.x + dx * .7 - nx * w, y: h.y + dy * .7 - ny * w };
      const d = `M${h.x},${h.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`;
      add("path", { d, class: "snake", stroke: "#1b1b1b", "stroke-width": 3.4, opacity: .35 });
      add("path", { d, class: "snake", stroke: hues[i % hues.length], "stroke-width": 2.6 });
      add("path", { d, class: "snake", stroke: "rgba(255,255,255,.35)", "stroke-width": .6, "stroke-dasharray": "1.2 1.6" });
      add("circle", { cx: h.x, cy: h.y, r: 2.4, fill: hues[i % hues.length], stroke: "#1b1b1b", "stroke-width": .4 });
      add("circle", { cx: h.x - .8, cy: h.y - .6, r: .5, class: "snake-eye" });
      add("circle", { cx: h.x + .8, cy: h.y - .6, r: .5, class: "snake-eye" });
    });
    board.appendChild(svg);
    built = true;
  }

  function place(tok, n, i, sameCount, idx) {
    const p = xy(n);
    const off = sameCount > 1 ? (idx - (sameCount - 1) / 2) * 2.2 : 0;
    tok.style.left = (p.x + off) + "%";
    tok.style.top = (p.y + (sameCount > 1 ? (idx % 2 ? 1.4 : -1.4) : 0)) + "%";
  }

  function layout(posList) {
    posList.forEach((n, i) => {
      const same = posList.map((m, j) => [m, j]).filter(([m]) => m === n);
      place(tokens[i], n, i, same.length, same.findIndex(([, j]) => j === i));
    });
  }

  function render(s, api) {
    if (!built) build(s);
    const board = $("board");
    const n = s.seats.length;
    if (tokens.length !== n || !s.started) {
      tokens.forEach(t => t.remove());
      tokens = s.seats.map((x, i) => {
        const t = document.createElement("div");
        t.className = "token";
        t.style.background = COLORS[i];
        t.title = x.name;
        board.appendChild(t);
        return t;
      });
      shown = (s.pos || []).slice();
      layout(shown);
    }
    const pos = s.pos || [];
    tokens.forEach((t, i) => {
      t.classList.toggle("mine", i === s.mySeat);
      t.classList.toggle("turn", api.inGame && i === s.turn);
      t.title = s.seats[i].name;
    });

    // Animate the latest roll: step to the square it landed on, then up the ladder / down the snake.
    const last = s.last;
    if (last && lastRoll !== null && last.n !== lastRoll) {
      $("die").textContent = FACES[last.die];
      $("die").classList.remove("spin");
      void $("die").offsetWidth;
      $("die").classList.add("spin");
      const mid = shown.slice();
      mid[last.seat] = last.land;
      layout(mid);
      shown = pos.slice();
      setTimeout(() => layout(shown), last.via ? 700 : 0);
    } else {
      shown = pos.slice();
      layout(shown);
      if (last) $("die").textContent = FACES[last.die];
    }
    lastRoll = last ? last.n : 0;

    // Who's where
    const racers = $("racers");
    racers.innerHTML = "";
    s.seats.forEach((x, i) => {
      const li = document.createElement("li");
      li.className = api.inGame && i === s.turn ? "turn" : "";
      li.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span>`;
      li.append(`${x.name}: ${pos[i] ? pos[i] : "start"}`);
      racers.appendChild(li);
    });

    const myTurn = api.inGame && s.mySeat === s.turn;
    $("rollBtn").hidden = !api.inGame;
    $("rollBtn").disabled = !myTurn;
    $("rollBtn").textContent = myTurn ? "Roll the die" : `${api.seatName(s.turn)} is rolling`;

    if (!s.started) {
      api.status("Lobby", "Everyone starts off the board. First to square 100 wins.");
      api.hint(s.players.find(p => p.id === s.you)?.role === "player"
        ? "You've got a seat. Waiting for the game to start." : "Take a seat in the Players panel to play.");
    } else if (s.over) {
      api.status(s.winner != null ? `${api.seatName(s.winner)} wins` : "Game over", s.result, "win");
      api.hint(s.isHost ? "Press Play again for a rematch." : "Waiting for the leader to start a rematch.");
    } else {
      api.status(`${api.seatName(s.turn)}'s turn`, `${COLOR_NAMES[s.turn]} counter`, myTurn ? "go" : "");
      api.hint(s.mySeat == null ? "You're watching this game."
        : myTurn ? "Your turn: roll the die." : `You're ${COLOR_NAMES[s.mySeat]}. Waiting for ${api.seatName(s.turn)}.`,
      myTurn ? "go" : "");
    }
  }

  let send = null;
  $("rollBtn").addEventListener("click", () => send && send("roll"));

  AceRoom.start({
    game: "snakes",
    title: "Snakes & Ladders",
    blurb: "The classic race to square 100. Climb the ladders, dodge the snakes. 2 to 6 players.",
    players: "2 to 6 players.",
    canSkip: true,
    options: [
      { key: "finish", label: "Finishing", choices: [["bounce", "Exact roll, bounce back"], ["exact", "Exact roll, or stay put"], ["any", "Any roll reaches 100"]] },
      { key: "six", label: "Rolling a 6", choices: [["again", "Roll a 6, roll again"], ["no", "No extra turns"]] },
    ],
    seatTag: (i, s) => s.started ? (s.pos[i] ? "square " + s.pos[i] : "start") : "",
    rules: `<ol>
      <li>Everyone starts off the board. On your turn press <b>Roll the die</b> and move your counter that many squares.</li>
      <li>Land at the foot of a ladder and you climb to the top. Land on a snake's head and you slide down to its tail.</li>
      <li>The first player to reach square 100 wins.</li>
      <li>The leader picks the house rules: whether you need an exact roll to finish, and whether a 6 gives another roll.</li>
    </ol>`,
    render(s, api) {
      send = api.send;
      render(s, api);
    },
  });
})();
