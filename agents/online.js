// Ace Agents, online mode. Everyone plays from their own device; the live server
// (server/games/agents.py) keeps the game and only sends the key to spymasters.
// Started by main.js with either { room: "KQTZ" } to join or { create: { pack } } to make a room.
window.startOnlineGame = function (opts, onFail) {
  "use strict";
  const $ = id => document.getElementById(id);
  const TEAMS = { red: "Red", purple: "Purple" };
  const ROWS = "ABCDE";
  const coord = i => ROWS[Math.floor(i / 5)] + (i % 5 + 1);

  let room = opts.room || null;
  let pendingCreate = opts.create || null;
  let state = null;
  let lastAnimated = null;
  let errTimer = 0;

  // ---- Board cards (built once, updated on every state) ----
  const grid = $("grid");
  grid.innerHTML = "";
  const cards = Array.from({ length: 25 }, (_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "card";
    b.innerHTML = `<span class="coord">${coord(i)}</span><span class="word"></span>`;
    b.addEventListener("click", () => send("reveal", { index: i }));
    grid.appendChild(b);
    return b;
  });

  // ---- Talking to the server ----
  const socket = AceLive.connect();

  function showError(msg) {
    const el = $("actionError");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(errTimer);
    errTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function send(type, extra = {}) {
    socket.timeout(6000).emit("action", { type, ...extra }, (err, res) => {
      if (err) showError("The server didn't answer. Check your connection and try again.");
      else if (res && res.error) showError(res.error);
    });
  }

  function fail(msg) {
    socket.disconnect();
    onFail(msg, room);
  }

  function enter() {
    const base = { playerId: AceLive.playerId(), name: AceLive.name() };
    if (pendingCreate) {
      socket.timeout(8000).emit("create", { ...base, game: "agents", options: pendingCreate }, (err, res) => {
        if (err) return fail("The game server didn't answer. Try again in a moment.");
        if (res.error) return fail(res.error);
        pendingCreate = null;
        room = res.room;
        history.replaceState(null, "", "?room=" + room);
      });
    } else {
      socket.timeout(8000).emit("join", { ...base, room }, (err, res) => {
        if (err) return setConn("Can't reach the game server. Retrying…");
        if (res.error) return fail(res.error);
      });
    }
  }

  function setConn(msg) {
    $("connNote").textContent = msg || "";
    $("connNote").hidden = !msg;
  }

  socket.on("connect", () => { setConn(""); enter(); });     // also rejoins after a dropout
  socket.on("disconnect", () => setConn("Connection lost. Reconnecting…"));
  socket.on("connect_error", () => setConn(state
    ? "Connection lost. Reconnecting…"
    : "Can't reach the game server. It may be switched off. Retrying…"));
  socket.on("state", s => { state = s; render(); });

  // ---- Controls ----
  $("clueForm").addEventListener("submit", e => {
    e.preventDefault();
    const word = $("clueWord").value.trim();
    if (!word) return showError("Type a clue word first.");
    send("clue", { word, num: $("clueNum").value });
    $("clueWord").value = "";
  });
  $("endTurn").addEventListener("click", () => send("end_turn"));
  $("undo").addEventListener("click", () => send("undo"));
  $("newGame").addEventListener("click", () => send("new_game", { pack: $("roomPack").value }));
  $("shuffleTeams").addEventListener("click", () => send("shuffle"));
  document.querySelectorAll("[data-seat]").forEach(b => b.addEventListener("click", () => {
    const [team, role] = b.dataset.seat.split(":");
    send("seat", team === "watch" ? { team: null } : { team, role });
  }));
  $("renameForm").addEventListener("submit", e => {
    e.preventDefault();
    const n = $("renameInput").value.trim();
    if (!n) return;
    AceLive.setName(n);
    send("rename", { name: n });
    $("renameForm").hidden = true;
  });
  $("renameBtn").addEventListener("click", () => {
    $("renameForm").hidden = !$("renameForm").hidden;
    $("renameInput").value = AceLive.name();
    if (!$("renameForm").hidden) $("renameInput").focus();
  });
  $("copyInvite").addEventListener("click", async () => {
    const link = inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      $("inviteNote").textContent = "Invite link copied. Paste it in Discord.";
    } catch {
      $("inviteNote").textContent = link;
    }
  });

  function inviteLink() {
    const u = new URL(location.href);
    u.search = "?room=" + (room || "");
    u.hash = "";
    return u.toString();
  }

  // ---- Rendering ----
  function render() {
    const s = state;
    const me = s.players.find(p => p.id === s.you) || {};
    const over = !!s.winner;
    const myTurn = !over && me.team === s.turn;
    const canReveal = myTurn && me.role === "operative" && !!s.clue;
    const spy = team => s.players.find(p => p.team === team && p.role === "spymaster");

    grid.classList.toggle("show-key", !!s.showKey);
    grid.classList.toggle("can-pick", canReveal);
    s.cards.forEach((c, i) => {
      const b = cards[i];
      b.querySelector(".word").textContent = c.word;
      const animate = i === s.lastRevealed && s.lastRevealed !== lastAnimated;
      b.className = "card" + (c.role ? " " + c.role : "") + (c.revealed ? " revealed" : "") + (animate ? " just" : "");
      b.disabled = c.revealed || !canReveal;
      b.setAttribute("aria-label", `${coord(i)} ${c.word}${c.role ? ", " + c.role : ""}${c.revealed ? ", revealed" : ""}`);
    });
    lastAnimated = s.lastRevealed;

    // Turn banner
    $("status").className = "status " + (over ? s.winner : s.turn);
    $("turnText").textContent = over ? `${TEAMS[s.winner]} wins` : `${TEAMS[s.turn]}'s turn`;
    const clue = $("clueText");
    clue.textContent = "";
    if (over) {
      clue.innerHTML = '<span class="muted"></span>';
      clue.firstChild.textContent = s.reason + (s.isHost ? " Start a new game from the panel." : " Waiting for the host to start a new game.");
    } else if (s.clue) {
      clue.innerHTML = 'Clue: <b></b> <span></span> <span class="muted"></span>';
      clue.children[0].textContent = s.clue.word;
      clue.children[1].textContent = s.clue.num;
      clue.children[2].textContent = s.left == null ? "· guess as many as you like" : `· ${s.left} guess${s.left === 1 ? "" : "es"} left`;
    } else {
      const sm = spy(s.turn);
      clue.innerHTML = '<span class="muted"></span>';
      clue.firstChild.textContent = sm ? `Waiting for ${sm.name} to give a clue` : `${TEAMS[s.turn]} needs a spymaster`;
    }

    // What should I do?
    let hint;
    if (!me.team) hint = "You're watching. Join a team in the panel to play.";
    else if (over) hint = `You're ${me.role === "spymaster" ? "the spymaster" : "an operative"} on ${TEAMS[me.team]}.`;
    else if (me.role === "spymaster") hint = myTurn && !s.clue ? "Your turn: give your team a clue below." : `You're ${TEAMS[me.team]}'s spymaster. You can see the key.`;
    else if (canReveal) hint = "Your turn: pick a card your spymaster is hinting at.";
    else if (myTurn) hint = "Your turn. Waiting for your spymaster's clue.";
    else hint = `You're a ${TEAMS[me.team]} operative. Waiting for ${TEAMS[s.turn]}.`;
    $("youText").textContent = hint;
    $("youText").className = "you-text " + (me.team || "");

    $("redLeft").textContent = s.remaining.red;
    $("purpleLeft").textContent = s.remaining.purple;
    $("endTurn").disabled = !(myTurn && s.clue);
    $("undo").hidden = !s.isHost;
    $("undo").disabled = !s.canUndo;
    $("clueForm").hidden = !(myTurn && me.role === "spymaster" && !s.clue);

    // Room box
    $("roomCode").textContent = s.room;
    $("myName").textContent = me.name || "";
    $("hostBox").hidden = !s.isHost;
    const packSel = $("roomPack");
    if (packSel.options.length !== Object.keys(s.packs).length) {
      packSel.innerHTML = "";
      for (const [id, name] of Object.entries(s.packs)) packSel.add(new Option(name, id));
    }
    if (document.activeElement !== packSel) packSel.value = s.pack;

    // Teams
    for (const team of Object.keys(TEAMS)) {
      const ul = $("team-" + team);
      ul.innerHTML = "";
      const members = s.players.filter(p => p.team === team)
        .sort((a, b) => (a.role === "spymaster" ? -1 : 0) - (b.role === "spymaster" ? -1 : 0));
      if (!members.length) ul.innerHTML = '<li class="muted">Nobody yet</li>';
      for (const p of members) ul.appendChild(playerItem(p, s));
      const sm = spy(team);
      const smBtn = document.querySelector(`[data-seat="${team}:spymaster"]`);
      smBtn.disabled = !!sm && sm.id !== s.you;
      smBtn.classList.toggle("on", me.team === team && me.role === "spymaster");
      document.querySelector(`[data-seat="${team}:operative"]`).classList.toggle("on", me.team === team && me.role === "operative");
    }
    const watchers = s.players.filter(p => !p.team);
    const wl = $("watchers");
    wl.innerHTML = "";
    if (!watchers.length) wl.innerHTML = '<li class="muted">Nobody</li>';
    for (const p of watchers) wl.appendChild(playerItem(p, s));
    document.querySelector('[data-seat="watch"]').classList.toggle("on", !me.team);

    // Log
    const log = $("log");
    log.innerHTML = "";
    for (const e of [...s.log].reverse()) {
      const li = document.createElement("li");
      li.className = e.kind || "";
      li.textContent = e.text;
      log.appendChild(li);
    }
  }

  function playerItem(p, s) {
    const li = document.createElement("li");
    li.className = "player" + (p.online ? "" : " away");
    const name = document.createElement("span");
    name.textContent = p.name;
    li.appendChild(name);
    const tags = [];
    if (p.role === "spymaster") tags.push("spymaster");
    if (p.id === s.host) tags.push("host");
    if (p.id === s.you) tags.push("you");
    if (!p.online) tags.push("away");
    for (const t of tags) {
      const tag = document.createElement("small");
      tag.className = "tag " + t;
      tag.textContent = t;
      li.appendChild(tag);
    }
    return li;
  }
};
