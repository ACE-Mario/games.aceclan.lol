// Haunted Mansion, online. An original ACE Clan game. The server (server/games/mansion.py) keeps
// the room deck, the dice and the traitor's identity; your page only learns whether *you* are
// the traitor. This file draws the house, the explorers and the buttons for your turn.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const COLORS = ["#ff4655", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899"];
  const DIRS = { N: [1, 0, -1], E: [2, 1, 0], S: [4, 0, 1], W: [8, -1, 0] };
  const OPP = { 1: 4, 4: 1, 2: 8, 8: 2 };
  const SYMBOL = { item: "✦", relic: "☥", event: "?", chapel: "✝" };
  const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  let send = null, state = null, api = null;

  document.querySelectorAll(".dir").forEach(b => b.addEventListener("click", () => send("move", { dir: b.dataset.dir })));
  $("endTurn").addEventListener("click", () => send("end_turn"));

  const tileAt = (s, x, y) => s.tiles.find(t => t.x === x && t.y === y);
  const pip = (n, max = 8) => "●".repeat(n) + "○".repeat(Math.max(0, max - n));

  function canMove(s, me, d) {
    const [bit, dx, dy] = DIRS[d];
    const [x, y] = s.pos[me];
    const here = tileAt(s, x, y);
    const nx = x + dx, ny = y + dy;
    if (!(here.doors & bit) || nx < 0 || ny < 0 || nx >= s.w || ny >= s.h || s.moves <= 0) return false;
    const next = tileAt(s, nx, ny);
    if (next) return !!(next.doors & OPP[bit]);
    return s.roomsLeft > 0 && !s.used.explore;
  }

  function button(text, cls, onClick, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn " + (cls || "");
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  function render() {
    const s = state;
    const n = s.seats.length;
    const playing = s.started && s.tiles;
    const me = s.mySeat;
    const myTurn = api.inGame && me != null && s.turn === me && !s.fallen[me];

    // Map
    const map = $("map");
    map.innerHTML = "";
    if (playing) {
      // Only draw the explored part of the house, plus one square of darkness round it.
      const xs = s.tiles.map(t => t.x), ys = s.tiles.map(t => t.y);
      const x0 = Math.max(0, Math.min(...xs) - 1), x1 = Math.min(s.w - 1, Math.max(...xs) + 1);
      const y0 = Math.max(0, Math.min(...ys) - 1), y1 = Math.min(s.h - 1, Math.max(...ys) + 1);
      map.style.setProperty("--w", x1 - x0 + 1);
      map.parentElement.style.setProperty("--cols", Math.max(5, x1 - x0 + 1));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = tileAt(s, x, y);
          const cell = document.createElement("div");
          cell.className = "cell";
          if (t) {
            cell.classList.add("room");
            if (t.name === "Chapel") cell.classList.add("chapel");
            if (t.name === "Entrance Hall") cell.classList.add("entrance");
            for (const [d, [bit]] of Object.entries(DIRS)) {
              if (t.doors & bit) cell.appendChild(Object.assign(document.createElement("i"), { className: "door " + d }));
            }
            const name = document.createElement("span");
            name.className = "rname";
            name.textContent = t.name;
            cell.appendChild(name);
            if (t.symbol && t.symbol !== "chapel") {
              const sym = document.createElement("span");
              sym.className = "sym " + t.symbol + (t.done ? " done" : "");
              sym.textContent = SYMBOL[t.symbol];
              sym.title = t.symbol;
              cell.appendChild(sym);
            }
            const toks = document.createElement("div");
            toks.className = "toks";
            s.pos.forEach((p, i) => {
              if (p[0] !== x || p[1] !== y) return;
              const k = document.createElement("span");
              k.className = "tok" + (i === s.turn && api.inGame ? " turn" : "") + (s.fallen[i] ? " fallen" : "") + (i === me ? " mine" : "");
              k.style.background = COLORS[i];
              k.textContent = (s.seats[i].name || "?")[0].toUpperCase();
              k.title = s.seats[i].name;
              toks.appendChild(k);
            });
            cell.appendChild(toks);
          }
          map.appendChild(cell);
        }
      }
    }

    // Haunting bar
    $("hauntBar").hidden = !(playing && s.haunt);
    if (playing && s.haunt) {
      const rites = Array.from({ length: s.ritesNeeded }, (_, k) => `<i class="${k < s.rites ? "on" : ""}"></i>`).join("");
      const doom = Array.from({ length: s.doomLimit }, (_, k) => `<i class="${k < s.doom ? "on" : ""}"></i>`).join("");
      $("hauntBar").innerHTML = `<div><b>Rites</b><span class="track rites">${rites}</span></div>
        <div><b>Doom</b><span class="track doom">${doom}</span></div>
        <div class="muted small">${s.revealed && s.traitor != null ? "The traitor is <b class='t-name'></b>." : "Someone among you is the traitor."}</div>`;
      const tn = $("hauntBar").querySelector(".t-name");
      if (tn) tn.textContent = api.seatName(s.traitor);
    }

    // Secret card for the traitor
    $("secret").hidden = !(playing && s.youAreTraitor);
    if (s.youAreTraitor) {
      const curses = s.myCurses.map(c => `${api.esc(api.seatName(c.target))} (${c.stat})`).join(", ");
      $("secret").innerHTML = `<h2>You are the traitor</h2>
        <p>The house has claimed you. <b>You win</b> if the Doom track fills up or every other explorer falls. Nobody else knows${s.revealed ? " (well, they do now)" : ""}.</p>
        <ul>
          <li><b>Curse</b> an explorer in your room once a turn. ${s.revealed ? "It hits at once." : "It lands at the end of the round, looking just like the house's own attacks."}</li>
          <li>Your <b>rites</b> always fail, but they look like bad luck. Hold on to relics so the others can't use them.</li>
          <li>${s.revealed ? "You're unmasked: you can <b>attack</b> explorers in your room." : "Play along. If someone accuses you, you're unmasked."}</li>
        </ul>
        ${curses ? `<p class="small">Curses waiting for the end of the round: ${curses}</p>` : ""}`;
    }

    // Controls for my turn
    $("controls").hidden = !myTurn;
    if (myTurn) {
      document.querySelectorAll(".dir").forEach(b => { b.disabled = !canMove(s, me, b.dataset.dir); });
      $("movesLeft").textContent = `${s.moves} move${s.moves === 1 ? "" : "s"}`;
      const here = tileAt(s, ...s.pos[me]);
      const row = $("actRow");
      row.innerHTML = "";
      for (const item of s.gear[me]) {
        if (item === "Bandages" || item === "Smelling Salts") row.appendChild(button(`Use ${item}`, "", () => send("use", { item }), s.items[item]));
      }
      if (s.haunt && here.name === "Chapel" && s.carried[me].length && !s.used.rite) {
        row.appendChild(button(`Perform a rite (${s.carried[me][0]})`, "primary", () => send("rite")));
      }
      const tr = $("targetRow");
      tr.innerHTML = "";
      const others = s.seats.map((_, i) => i).filter(i => i !== me && !s.fallen[i]);
      const sameRoom = others.filter(i => s.pos[i][0] === s.pos[me][0] && s.pos[i][1] === s.pos[me][1]);
      const things = [...s.gear[me], ...s.carried[me]];
      if (sameRoom.length && things.length) {
        const who = select(sameRoom.map(i => [i, api.seatName(i)]));
        const what = select(things.map(t => [t, t]));
        tr.append(label("Give", who, what), button("Give", "", () => send("give", { target: who.value, item: what.value })));
      }
      if (s.haunt && !s.revealed && !s.accused[me] && others.length) {
        const who = select(others.map(i => [i, api.seatName(i)]));
        tr.append(label("Accuse", who), button("Accuse", "danger", () => {
          if (confirm(`Accuse ${api.seatName(+who.value)} of being the traitor? You only get one accusation, and a wrong one costs you 2 Mind.`)) send("accuse", { target: who.value });
        }));
      }
      if (s.youAreTraitor && !s.used.curse && sameRoom.length) {
        const who = select(sameRoom.map(i => [i, api.seatName(i)]));
        const stat = select([["mind", "Mind"], ["body", "Body"]]);
        tr.append(label("Curse", who, stat), button("Curse", "danger", () => send("curse", { target: who.value, stat: stat.value })));
      }
      if (s.revealed && !s.used.attack) {
        const foes = sameRoom.filter(i => s.youAreTraitor || i === s.traitor);
        if (foes.length) {
          const who = select(foes.map(i => [i, api.seatName(i)]));
          tr.append(label("Fight", who), button("Attack", "danger", () => send("attack", { target: who.value })));
        }
      }
    }

    // Last dice roll
    const lr = s.lastRoll;
    $("rollBox").hidden = !(playing && lr);
    if (lr) {
      $("rollBox").innerHTML = `<span class="dice">${DICE[lr.dice[0]]}${DICE[lr.dice[1]]}</span><span></span>`;
      $("rollBox").lastChild.textContent = `${api.seatName(lr.seat)} · ${lr.label}: ${lr.total} vs ${lr.target}`;
      $("rollBox").className = "roll-box " + (lr.ok ? "ok" : "fail");
    }

    // Explorer cards
    const ex = $("explorers");
    ex.innerHTML = "";
    if (playing) {
      s.seats.forEach((x, i) => {
        const d = document.createElement("div");
        d.className = "explorer" + (i === s.turn && api.inGame ? " turn" : "") + (s.fallen[i] ? " fallen" : "") + (s.traitor === i ? " traitor" : "");
        d.style.setProperty("--c", COLORS[i]);
        const here = tileAt(s, ...s.pos[i]);
        d.innerHTML = `<div class="ex-head"><b></b><small class="muted"></small></div>
          <div class="stat"><span>Body</span><span class="pips body"></span></div>
          <div class="stat"><span>Mind</span><span class="pips mind"></span></div>
          <div class="kit small"></div>`;
        d.querySelector("b").textContent = x.name + (i === me ? " (you)" : "") + (s.traitor === i ? " · TRAITOR" : "") + (s.fallen[i] ? " · fallen" : "");
        d.querySelector("small").textContent = here ? here.name : "";
        d.querySelector(".body").textContent = pip(s.body[i]);
        d.querySelector(".mind").textContent = pip(s.mind[i]);
        const kit = [...s.gear[i].map(g => `✦ ${g}`), ...s.carried[i].map(r => `☥ ${r}`)];
        d.querySelector(".kit").textContent = kit.length ? kit.join(" · ") : "Empty-handed";
        d.querySelector(".kit").title = s.gear[i].map(g => `${g}: ${s.items[g]}`).join("\n");
        ex.appendChild(d);
      });
    }

    // Status
    if (!s.started) {
      api.status("Lobby", "Explore together. When the Haunting starts, one of you turns traitor in secret.");
      api.hint(api.me.role === "player" ? "You've got a seat. Waiting for the leader to open the front door." : "Take a seat in the Players panel to play.");
    } else if (s.over) {
      api.status(s.winner === "heroes" ? "The explorers win" : s.winner === "traitor" ? "The traitor wins" : "The house wins", s.result, "win");
      api.hint(s.isHost ? "Press Play again for a new house." : "Waiting for the leader to start a new game.");
    } else {
      const who = api.seatName(s.turn);
      api.status(s.haunt ? "The Haunting" : "Exploring", `Round ${s.round} · ${who}'s turn · ${s.roomsLeft} rooms unexplored`, s.haunt ? "bad" : myTurn ? "go" : "");
      let hint;
      if (me == null) hint = "You're watching. The traitor's identity is hidden from you too.";
      else if (s.fallen[me]) hint = "You've fallen. Your turns are skipped.";
      else if (myTurn) hint = s.haunt
        ? (s.youAreTraitor ? "Your turn. Stall the others, curse them, keep the relics away from the Chapel." : "Your turn. Get relics to the Chapel and perform rites. Watch the others.")
        : "Your turn: move with the arrows. Opening a door into a new room ends your movement.";
      else hint = `Waiting for ${who}.`;
      api.hint(hint, myTurn ? "go" : "");
    }
  }

  function select(opts) {
    const sel = document.createElement("select");
    for (const [v, l] of opts) sel.add(new Option(l, v));
    return sel;
  }
  function label(text, ...els) {
    const l = document.createElement("span");
    l.className = "tgt";
    l.append(text, ...els);
    return l;
  }

  AceRoom.start({
    game: "mansion",
    title: "Haunted Mansion",
    blurb: "Explore an old house room by room. When the Haunting starts, one of you secretly turns traitor. An original ACE Clan game.",
    players: "3 to 6 players.",
    canSkip: true,
    options: [
      { key: "doom", label: "Doom track", choices: [["10", "Doom track: 10 rounds"], ["14", "Doom track: 14 rounds (easier)"], ["8", "Doom track: 8 rounds (harder)"]] },
    ],
    seatTag: (i, s) => (s.body ? `♥${s.body[i]} ✧${s.mind[i]}` : ""),
    rules: `<ol>
      <li><b>Explore.</b> On your turn you have 3 moves. Walk through doors with the arrows. Opening a door onto unexplored space reveals a new room and ends your movement.</li>
      <li><b>Rooms</b> can hold an item ✦, an event ? (a test: roll two dice plus your Body or Mind), or a relic ☥.</li>
      <li><b>Body and Mind</b> start at 4. If either drops to 0, you fall and your turns are skipped.</li>
      <li><b>The Haunting</b> can start each time a relic is found, and always starts once half the house is explored. Then one player is secretly made the traitor. Only they are told.</li>
      <li><b>Explorers</b> win by carrying relics to the Chapel and performing 3 rites (two dice + Mind, 11 or more). Each successful rite uses up the relic. You can give items and relics to someone in your room.</li>
      <li><b>The traitor</b> wins if the Doom track fills (it moves up every round) or every explorer falls. Their curses land at the end of the round, hidden among the house's own attacks, and their rites always fail.</li>
      <li><b>Accuse</b> someone once per game. If you're right, the traitor is unmasked and can be fought. If you're wrong, you lose 2 Mind.</li>
    </ol>`,
    render(s, a) {
      send = a.send;
      state = s;
      api = a;
      render();
    },
  });
})();
