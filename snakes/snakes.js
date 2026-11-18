// Snakes & Ladders, online. The server (server/games/snakes.py) rolls the die and moves the
// counters; this page draws the board, spins the die and hops each counter square by square.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const COLOR_NAMES = ["Red", "Blue", "Green", "Orange", "Purple", "Pink"];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Square n (1-100) -> centre in board percent. Row 1 runs left to right along the bottom.
  function xy(n) {
    if (n <= 0) return { x: 4, y: 97 };       // not on the board yet: wait in the corner by square 1
    const row = Math.floor((n - 1) / 10), col = (n - 1) % 10;
    const c = row % 2 ? 9 - col : col;
    return { x: c * 10 + 5, y: 100 - (row * 10 + 5) };
  }

  let built = false, tokens = [], lastRoll = null, shown = [];
  let queue = Promise.resolve(), pending = 0, latest = [];

  // ---- The board ----------------------------------------------------------------------------
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
    const defs = add("defs", {});
    const wood = add("linearGradient", { id: "wood", x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    add("stop", { offset: "0", "stop-color": "#c98a4b" }, wood);
    add("stop", { offset: ".5", "stop-color": "#9a5f2a" }, wood);
    add("stop", { offset: "1", "stop-color": "#7a4518" }, wood);

    // Ladders: a shadow, two wooden rails and rungs.
    for (const [a, b] of Object.entries(s.ladders)) {
      const p = xy(+a), q = xy(b);
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
      const nx = -dy / len * 2, ny = dx / len * 2;
      const g = add("g", { class: "ladder" });
      for (const sgn of [1, -1]) {
        add("line", { x1: p.x + nx * sgn + .6, y1: p.y + ny * sgn + .8, x2: q.x + nx * sgn + .6, y2: q.y + ny * sgn + .8, class: "shadow" }, g);
      }
      for (let t = 0.07; t < 0.97; t += 3 / len) {
        const x = p.x + dx * t, y = p.y + dy * t;
        add("line", { x1: x + nx, y1: y + ny, x2: x - nx, y2: y - ny, class: "rung" }, g);
      }
      for (const sgn of [1, -1]) {
        add("line", { x1: p.x + nx * sgn, y1: p.y + ny * sgn, x2: q.x + nx * sgn, y2: q.y + ny * sgn, class: "rail" }, g);
        add("line", { x1: p.x + nx * sgn, y1: p.y + ny * sgn, x2: q.x + nx * sgn, y2: q.y + ny * sgn, class: "rail-hi" }, g);
      }
    }
    // Snakes: a fat, wiggly, tapering body with stripes, then a head with eyes and a tongue.
    const hues = [["#3fa34d", "#1f6f2c"], ["#e8590c", "#a83c00"], ["#7950f2", "#4c2bb0"], ["#d6336c", "#931e48"],
      ["#1098ad", "#0b6575"], ["#f59f00", "#b07000"], ["#74b816", "#4b7a0b"], ["#ae3ec9", "#76248c"]];
    Object.entries(s.snakes).forEach(([a, b], i) => {
      const h = xy(+a), t = xy(b);
      const dx = t.x - h.x, dy = t.y - h.y, len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len, w = Math.min(7, len / 4);
      const [light, dark] = hues[i % hues.length];
      const pts = [];
      for (let k = 0; k <= 40; k++) {
        const u = k / 40, wig = Math.sin(u * Math.PI * 3) * w * (1 - u * .4);
        pts.push({ x: h.x + dx * u + nx * wig, y: h.y + dy * u + ny * wig, u });
      }
      const g = add("g", { class: "snake" });
      // Body as short segments that get thinner towards the tail.
      for (const [cls, extra] of [["snake-shadow", 1.1], ["snake-edge", 0.7], ["", 0]]) {
        for (let k = 0; k < pts.length - 1; k++) {
          const p0 = pts[k], p1 = pts[k + 1];
          add("line", {
            x1: p0.x + (cls === "snake-shadow" ? .5 : 0), y1: p0.y + (cls === "snake-shadow" ? .7 : 0), x2: p1.x + (cls === "snake-shadow" ? .5 : 0), y2: p1.y + (cls === "snake-shadow" ? .7 : 0),
            stroke: cls === "snake-edge" ? dark : cls ? "rgba(0,0,0,.28)" : (k % 4 < 2 ? light : dark),
            "stroke-width": (3.1 - p0.u * 2.2) + extra, "stroke-linecap": "round",
          }, g);
        }
      }
      // Belly shine down the middle.
      add("path", { d: "M" + pts.map(p => `${p.x},${p.y}`).join(" L"), class: "snake-shine" }, g);
      const ang = Math.atan2(pts[0].y - pts[2].y, pts[0].x - pts[2].x);
      const hx = h.x + Math.cos(ang) * .6, hy = h.y + Math.sin(ang) * .6;
      const tx = hx + Math.cos(ang) * 3.4, ty = hy + Math.sin(ang) * 3.4;
      add("path", {
        d: `M${hx + Math.cos(ang) * 2},${hy + Math.sin(ang) * 2} L${tx},${ty} M${tx},${ty} l${Math.cos(ang + .5) * .9},${Math.sin(ang + .5) * .9} M${tx},${ty} l${Math.cos(ang - .5) * .9},${Math.sin(ang - .5) * .9}`,
        class: "tongue",
      }, g);
      add("ellipse", { cx: hx, cy: hy, rx: 2.9, ry: 2.3, fill: light, stroke: dark, "stroke-width": .5, transform: `rotate(${ang * 180 / Math.PI} ${hx} ${hy})` }, g);
      for (const side of [1, -1]) {
        const ex = hx + Math.cos(ang) * .8 + Math.cos(ang + Math.PI / 2) * side * 1.1;
        const ey = hy + Math.sin(ang) * .8 + Math.sin(ang + Math.PI / 2) * side * 1.1;
        add("circle", { cx: ex, cy: ey, r: .7, class: "snake-eye" }, g);
        add("circle", { cx: ex + Math.cos(ang) * .2, cy: ey + Math.sin(ang) * .2, r: .35, class: "snake-pupil" }, g);
      }
    });
    board.appendChild(svg);
    built = true;
  }

  // ---- The die: a 3D cube that tumbles to the rolled face ----------------------------------
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const SHOW = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  let spins = 0;
  (function buildDie() {
    const cube = document.createElement("div");
    cube.className = "cube";
    for (let v = 1; v <= 6; v++) {
      const f = document.createElement("div");
      f.className = "face f" + v;
      for (let k = 1; k <= 9; k++) {
        const p = document.createElement("i");
        if (PIPS[v].includes(k)) p.className = "on";
        f.appendChild(p);
      }
      cube.appendChild(f);
    }
    $("die").appendChild(cube);
  })();
  function showDie(v, spin) {
    const cube = $("die").querySelector(".cube");
    const [x, y] = SHOW[v] || [0, 0];
    if (spin) spins += 1;
    cube.style.transform = `rotateX(${x + spins * 360}deg) rotateY(${y + spins * 720}deg)`;
    cube.classList.toggle("rolling", !!spin);
    $("die").setAttribute("aria-label", v ? `The die shows ${v}` : "");
  }

  // ---- Counters ---------------------------------------------------------------------------
  function place(tok, n, sameCount, idx) {
    const p = xy(n);
    const off = sameCount > 1 ? (idx - (sameCount - 1) / 2) * 2.2 : 0;
    tok.style.left = (p.x + off) + "%";
    tok.style.top = (p.y + (sameCount > 1 ? (idx % 2 ? 1.4 : -1.4) : 0)) + "%";
  }
  function layout(posList) {
    posList.forEach((n, i) => {
      if (!tokens[i]) return;
      const same = posList.map((m, j) => [m, j]).filter(([m]) => m === n);
      place(tokens[i], n, same.length, same.findIndex(([, j]) => j === i));
    });
  }

  // The squares a roll passes through: forward, and back again after bouncing off 100.
  function path(last) {
    const out = [];
    const end = Math.min(100, last.from + last.die);
    if (last.land === last.from) return out;                 // needed an exact roll: stays put
    for (let n = last.from + 1; n <= end; n++) out.push(n);
    if (last.land < end) for (let n = end - 1; n >= last.land; n--) out.push(n);
    return out;
  }

  async function animateRoll(last) {
    const fast = pending > 1;
    showDie(last.die, true);
    AceFX.sound("roll");
    await sleep(fast ? 250 : 650);
    const tok = tokens[last.seat];
    if (tok) tok.classList.add("moving");
    for (const n of path(last)) {
      shown[last.seat] = n;
      layout(shown);
      if (tok) AceFX.pulse(tok, "hop");
      AceFX.sound("hop");
      await sleep(fast ? 90 : 170);
    }
    if (tok) tok.classList.remove("moving");
    if (last.via) {
      await sleep(fast ? 120 : 260);
      if (tok) tok.classList.add(last.via === "ladder" ? "climbing" : "sliding");
      AceFX.sound(last.via === "ladder" ? "climb" : "slide");
      shown[last.seat] = last.to;
      layout(shown);
      await sleep(fast ? 400 : 750);
      if (tok) tok.classList.remove("climbing", "sliding");
    }
    shown = latest.slice();                       // wherever everyone is now
    layout(shown);
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
        t.style.setProperty("--av", AceFX.color(i));
        t.textContent = (x.name.trim()[0] || "?").toUpperCase();
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

    // Animate the latest roll; rolls that arrive mid-animation wait their turn (and go faster).
    const last = s.last;
    latest = pos.slice();
    if (last && lastRoll !== null && last.n !== lastRoll && pending < 2) {
      pending++;
      queue = queue.then(() => animateRoll(last)).catch(() => {}).then(() => { pending--; });
    } else if (!pending) {
      shown = pos.slice();
      layout(shown);
      showDie(last ? last.die : 1, false);
    }
    lastRoll = last ? last.n : 0;

    // Who's where: an avatar per player, glowing on their turn.
    const racers = $("racers");
    racers.innerHTML = "";
    s.seats.forEach((x, i) => {
      const li = document.createElement("li");
      li.className = api.inGame && i === s.turn ? "turn" : "";
      li.appendChild(AceFX.avatar(x.name, i, api.inGame && i === s.turn ? "turn" : ""));
      const t = document.createElement("span");
      t.innerHTML = "<b></b><small></small>";
      t.querySelector("b").textContent = x.name + (i === s.mySeat ? " (you)" : "");
      t.querySelector("small").textContent = !s.started ? COLOR_NAMES[i] : pos[i] ? `square ${pos[i]}` : "at the start";
      li.appendChild(t);
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
