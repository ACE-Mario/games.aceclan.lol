// Online rooms for the seated games (poker, trivia, canasta, snakes & ladders).
// Builds the start screen, the lobby bar and the side panel (room, players, leader, admin, log,
// rules), talks to the live server, and hands every state update to the game's own render().
//
//   AceRoom.start({
//     game: "snakes", title: "Snakes & Ladders", blurb: "...",
//     options: [{ key, label, choices: [[value, label], ...], multi }],   // start screen; the server checks them
//                                          // multi: true shows tick boxes and sends "a,b" (first ticked by default)
//     rules: "<ol>...</ol>",                // trusted HTML written in the game's own file
//     canSkip: true,                        // show the leader's Skip turn button
//     seatTag: (seat, s) => "120 pts",      // optional extra text after each player's name
//     myTurn: s => bool,                    // optional: is it my move? (default: s.turn === s.mySeat)
//     iWon: s => bool,                      // optional: did I win? (default: s.winner === s.mySeat)
//     render: (s, api) => { ... },          // draw the game; api.send(type, extra) makes a move
//   });
//
// The page needs <main id="startView">, and <main id="gameView"> with a .board-col section
// (the game's board goes in it) and an <aside id="panel">. It also needs shared/fx.js, which
// plays a ding when your turn comes round and shows the banner (and confetti) at the end.
window.AceRoom = (() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const cleanRoom = v => String(v || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const FX = window.AceFX;            // shared/fx.js (live.js stands in with no-ops if it's missing)

  function start(cfg) {
    FX.soundButton();
    const params = new URLSearchParams(location.search);
    const room = cleanRoom(params.get("room"));
    if (room && AceLive.name() && window.io) play(cfg, { room });
    else showStart(cfg, room);
  }

  // ---- Start screen -----------------------------------------------------------------------
  // One option on the start screen or in the leader box: a drop-down, or tick boxes when multi.
  function optField(key, label, choices, multi) {
    if (!multi) {
      return `<label class="field">${esc(label)}
          <select data-opt="${esc(key)}">${choices.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>
        </label>`;
    }
    return `<fieldset class="field multi" data-opt="${esc(key)}" data-multi="1"><legend>${esc(label)}</legend>
        ${choices.map(([v, l], i) => `<label class="tick"><input type="checkbox" value="${esc(v)}"${i ? "" : " checked"}> ${esc(l)}</label>`).join("")}
      </fieldset>`;
  }
  function optValue(el) {
    if (!el.dataset.multi) return el.value;
    return [...el.querySelectorAll("input:checked")].map(b => b.value).join(",");
  }
  function setOptValue(el, value) {
    if (!el.dataset.multi) { el.value = value; return; }
    const on = String(value || "").split(",");
    el.querySelectorAll("input").forEach(b => { b.checked = on.includes(b.value); });
  }

  let startBuilt = false;
  function showStart(cfg, room, error) {
    $("gameView").hidden = true;
    $("startView").hidden = false;
    history.replaceState(null, "", room ? "?room=" + room : location.pathname);
    if (!startBuilt) {
      startBuilt = true;
      const opts = (cfg.options || []).map(o => optField(o.key, o.label, o.choices, o.multi)).join("");
      $("startView").innerHTML = `
        <section class="start-hero">
          <h1>${esc(cfg.title)}</h1>
          <p class="muted">${esc(cfg.blurb)}</p>
        </section>
        <div class="start-grid">
          <form id="onlineForm" class="box mode" autocomplete="off">
            <h2>Play online</h2>
            <p class="muted small">Everyone joins from their own phone or PC. ${esc(cfg.players || "")}</p>
            <p id="serverStatus" class="server-status">Checking the game server…</p>
            <label class="field" for="playerName">Your name
              <input id="playerName" maxlength="20" placeholder="Name the others will see">
            </label>
            ${opts ? `<div class="opt-grid">${opts}</div>` : ""}
            <button id="createBtn" class="btn primary" type="submit">Create room</button>
            <div class="divider"><span>or join a room</span></div>
            <div class="row">
              <label class="sr" for="roomInput">Room code</label>
              <input id="roomInput" maxlength="4" placeholder="Room code, e.g. KQTZ" autocapitalize="characters">
              <button id="joinBtn" class="btn" type="button">Join</button>
            </div>
            <p id="startError" class="error" hidden></p>
          </form>
          <details class="box rules" open>
            <summary><h2>How to play</h2></summary>
            ${cfg.rules || ""}
          </details>
        </div>`;
      const status = $("serverStatus");
      AceLive.isOnline().then(up => {
        status.className = "server-status " + (up ? "up" : "down");
        status.textContent = up ? "Game server is online."
          : "Game server is offline right now. Online rooms work while it's running on the ACE host's PC.";
        $("createBtn").disabled = !up;
        $("joinBtn").disabled = !up;
      });
      const needName = () => {
        const n = $("playerName").value.trim();
        if (!n) {
          startError("Type your name first, so everyone knows who you are.");
          $("playerName").focus();
          return null;
        }
        AceLive.setName(n);
        return n;
      };
      $("onlineForm").addEventListener("submit", e => {
        e.preventDefault();
        if (!needName()) return;
        const options = {};
        document.querySelectorAll("#startView [data-opt]").forEach(s => { options[s.dataset.opt] = optValue(s); });
        play(cfg, { create: options });
      });
      $("joinBtn").addEventListener("click", () => {
        const code = cleanRoom($("roomInput").value);
        if (code.length !== 4) return startError("Room codes are 4 letters, like KQTZ.");
        if (!needName()) return;
        history.replaceState(null, "", "?room=" + code);
        play(cfg, { room: code });
      });
      $("roomInput").addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); $("joinBtn").click(); }
      });
    }
    $("roomInput").value = room || "";
    $("playerName").value = AceLive.name();
    startError(error);
    (room && !AceLive.name() ? $("playerName") : $("createBtn")).focus();
  }

  function startError(msg) {
    $("startError").textContent = msg || "";
    $("startError").hidden = !msg;
  }

  // ---- Online room ------------------------------------------------------------------------
  let playing = false;
  function play(cfg, opts) {
    if (playing) return;
    playing = true;
    $("startView").hidden = true;
    $("gameView").hidden = false;

    let room = opts.room || null;
    let pendingCreate = opts.create || null;
    let state = null;
    let errTimer = 0;
    let wasMyTurn = null, wasOver = null;
    const socket = AceLive.connect();

    // Top of the board column: status banner, your hint, connection note, lobby bar.
    const col = document.querySelector("#gameView .board-col");
    const top = el("div", "room-top");
    top.innerHTML = `
      <div id="status" class="status"><div id="statusMain" class="status-main"></div><div id="statusSub" class="status-sub"></div></div>
      <p id="youText" class="you-text"></p>
      <p id="connNote" class="conn-note" hidden></p>
      <div id="lobbyBar" class="lobby-bar" hidden>
        <p id="lobbyText" class="small"></p>
        <div class="actions">
          <button id="addBot" class="btn" type="button" hidden>Add bot</button>
          <button id="startGame" class="btn primary start-btn" type="button" hidden>Start game</button>
        </div>
      </div>
      <p id="actionError" class="error" role="alert" hidden></p>`;
    col.prepend(top);

    $("panel").innerHTML = `
      <div class="box">
        <h2>Room</h2>
        <div class="code-row"><span class="muted small">Room code</span><b id="roomCode" class="code"></b></div>
        <button id="copyInvite" class="btn primary" type="button">Copy invite link</button>
        <span id="inviteNote" class="muted small invite-note" aria-live="polite"></span>
        <div class="row me-row">
          <span class="small muted">You're playing as <b id="myName"></b></span>
          <button id="renameBtn" class="link-btn" type="button">Change name</button>
        </div>
        <form id="renameForm" class="row" hidden>
          <label class="sr" for="renameInput">New name</label>
          <input id="renameInput" maxlength="20">
          <button class="btn" type="submit">Save</button>
        </form>
      </div>
      <div class="box">
        <h2>Players <small id="seatCount" class="muted"></small></h2>
        <div id="seatList"></div>
        <div id="seatBtns" class="row"></div>
        <p id="lockNote" class="lock-note small" hidden></p>
        <div class="watching">
          <span class="small muted">Watching</span>
          <ul id="watchers" class="players inline"></ul>
        </div>
      </div>
      <div id="hostBox" class="box" hidden>
        <h2>Leader</h2>
        <div id="hostOpts" class="opt-grid"></div>
        <button id="newGame" class="btn" type="button">New game with these settings</button>
        <p class="muted small">New game goes back to the lobby and keeps everyone's seats. Press Start game when you're ready.</p>
      </div>
      <div id="adminBox" class="box admin-box" hidden>
        <h2>Admin panel</h2>
        <p class="muted small">Move players, hand a seat to someone watching, or hand over leader. Everything you do here shows in the log for everyone.</p>
        <label class="field" for="adminPlayer">Player <select id="adminPlayer"></select></label>
        <div class="row" id="adminLobbyRow">
          <button id="adminSeatIn" class="btn" type="button">Give a seat</button>
          <button id="adminSeatOut" class="btn" type="button" title="A bot moved to watching leaves the room">Move to watching</button>
        </div>
        <div id="adminTeamRow" class="row" hidden></div>
        <div class="row" id="adminGameRow">
          <label class="sr" for="adminSeatPick">Seat</label>
          <select id="adminSeatPick"></select>
          <button id="adminGive" class="btn" type="button">Take this seat</button>
          <button id="adminBot" class="btn" type="button" hidden>Give it to a bot</button>
        </div>
        <div class="row">
          <button id="adminSkip" class="btn" type="button" hidden>Skip turn</button>
          <button id="adminEnd" class="btn danger" type="button">End game</button>
          <button id="adminLeader" class="btn" type="button">Make leader</button>
        </div>
      </div>
      <div class="box"><h2>Log</h2><ol id="log" class="log"></ol></div>
      <details class="box rules"><summary><h2>How to play</h2></summary>${cfg.rules || ""}</details>`;

    function showError(msg) {
      const e = $("actionError");
      e.textContent = msg;
      e.hidden = false;
      clearTimeout(errTimer);
      errTimer = setTimeout(() => { e.hidden = true; }, 6000);
    }
    function send(type, extra = {}) {
      return new Promise(resolve => {
        socket.timeout(6000).emit("action", { type, ...extra }, (err, res) => {
          if (err) showError("The server didn't answer. Check your connection and try again.");
          else if (res && res.error) showError(res.error);
          else $("actionError").hidden = true;
          resolve(!err && !(res && res.error));
        });
      });
    }
    function fail(msg) {
      socket.disconnect();
      playing = false;
      top.remove();
      showStart(cfg, room, msg);
    }
    function setConn(msg) {
      $("connNote").textContent = msg || "";
      $("connNote").hidden = !msg;
    }
    function enter() {
      const base = { playerId: AceLive.playerId(), name: AceLive.name() };
      if (pendingCreate) {
        socket.timeout(8000).emit("create", { ...base, game: cfg.game, options: pendingCreate }, (err, res) => {
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
          if (res.game && res.game !== cfg.game) {
            socket.disconnect();
            location.href = `../${res.game}/?room=${res.room}`;     // that code belongs to another game
          }
        });
      }
    }
    socket.on("connect", () => { setConn(""); enter(); });
    socket.on("disconnect", () => setConn("Connection lost. Reconnecting…"));
    socket.on("connect_error", () => setConn(state ? "Connection lost. Reconnecting…"
      : "Can't reach the game server. It may be switched off. Retrying…"));
    socket.on("state", s => { state = s; render(); });

    // ---- Panel controls ----
    $("startGame").addEventListener("click", () => send("start", { options: hostOptions() }));
    $("addBot").addEventListener("click", () => send("add_bot"));
    $("adminBot").addEventListener("click", () => send("add_bot", { seat: $("adminSeatPick").value }));
    $("newGame").addEventListener("click", () => send("new_game", { options: hostOptions() }));
    const adminTarget = () => $("adminPlayer").value;
    $("adminSeatIn").addEventListener("click", () => adminTarget() && send("admin_seat", { player: adminTarget(), play: true }));
    $("adminSeatOut").addEventListener("click", () => adminTarget() && send("admin_seat", { player: adminTarget(), play: false }));
    $("adminGive").addEventListener("click", () => adminTarget() && send("admin_give_seat", { player: adminTarget(), seat: $("adminSeatPick").value }));
    $("adminSkip").addEventListener("click", () => send("admin_skip"));
    $("adminEnd").addEventListener("click", () => {
      if (confirm("End this game for everyone?")) send("admin_end");
    });
    $("adminLeader").addEventListener("click", () => adminTarget() && send("make_leader", { player: adminTarget() }));
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
      const u = new URL(location.href);
      u.search = "?room=" + (room || "");
      u.hash = "";
      try {
        await navigator.clipboard.writeText(u.toString());
        $("inviteNote").textContent = "Invite link copied. Paste it in Discord.";
      } catch {
        $("inviteNote").textContent = u.toString();
      }
    });

    function hostOptions() {
      const out = {};
      document.querySelectorAll("#hostOpts [data-opt]").forEach(s => { out[s.dataset.opt] = optValue(s); });
      return out;
    }

    const api = {
      send, error: showError, esc, el, socket,      // socket: for games with their own live messages (sketch)
      status(main, sub, cls) {
        $("statusMain").textContent = main || "";
        const subEl = $("statusSub");
        if (sub instanceof Node) { subEl.replaceChildren(sub); } else { subEl.textContent = sub || ""; }
        $("status").className = "status " + (cls || "");
      },
      hint(text, cls) {
        $("youText").textContent = text || "";
        $("youText").hidden = !text;
        $("youText").className = "you-text " + (cls || "");
      },
      seatName: i => (state && state.seats[i] ? state.seats[i].name : "Someone"),
      get state() { return state; },
    };

    // ---- Rendering ----
    function render() {
      const s = state;
      const me = s.players.find(p => p.id === s.you) || {};
      const inGame = s.started && !s.over;
      api.me = me;
      api.inGame = inGame;

      // Lobby bar (before a game, and after one ends)
      const hostName = (s.players.find(p => p.id === s.host) || {}).name || "the leader";
      const seated = s.players.filter(p => p.role === "player");
      $("lobbyBar").hidden = inGame;
      $("startGame").hidden = !s.isHost;
      $("addBot").hidden = !(s.isHost && s.botsAllowed && seated.length < s.maxPlayers);
      $("startGame").textContent = s.over ? "Play again" : "Start game";
      if (!inGame) {
        const need = s.minPlayers - seated.length;
        let text = need > 0 ? `Waiting for ${need} more player${need === 1 ? "" : "s"} to take a seat (${s.minPlayers}–${s.maxPlayers} players).`
          : s.isHost ? `${seated.length} player${seated.length === 1 ? "" : "s"} ready. Press ${s.over ? "Play again" : "Start game"} when everyone's in.`
          : `${seated.length} players ready. Waiting for ${hostName} to start.`;
        if (cfg.lobbyText) text = cfg.lobbyText(s, text) || text;
        $("lobbyText").textContent = text;
      }

      // Room box
      $("roomCode").textContent = s.room;
      $("myName").textContent = me.name || "";

      // Players
      const list = $("seatList");
      list.innerHTML = "";
      const locked = inGame && !s.lateJoin;
      const seatedIds = new Set(inGame ? s.seats.map(x => x.id) : seated.map(p => p.id));
      if (s.teams && !inGame) {
        const wrap = el("div", "teams");
        for (const [t, label] of Object.entries(s.teams)) {
          const box = el("div", "team team-" + t);
          box.appendChild(el("h3", "", label));
          const ul = el("ul", "players");
          const members = seated.filter(p => p.team === t);
          if (!members.length) ul.appendChild(el("li", "muted", "Nobody yet"));
          members.forEach(p => ul.appendChild(playerItem(p, s)));
          box.appendChild(ul);
          const b = el("button", "seat" + (me.role === "player" && me.team === t ? " on" : ""), "Join " + label);
          b.type = "button";
          b.addEventListener("click", () => send("seat", { play: true, team: t }));
          box.appendChild(b);
          wrap.appendChild(box);
        }
        list.appendChild(wrap);
      } else {
        const ul = el("ol", "players seats");
        const rows = inGame || s.over && s.seats.length ? s.seats.map((x, i) => ({ ...(s.players.find(p => p.id === x.id) || { id: x.id, name: x.name }), seat: i, team: x.team }))
          : seated;
        if (!rows.length) ul.appendChild(el("li", "muted", "Nobody has a seat yet"));
        rows.forEach(p => ul.appendChild(playerItem(p, s, p.seat)));
        list.appendChild(ul);
      }
      $("seatCount").textContent = inGame ? "" : `${seated.length}/${s.maxPlayers}`;
      const btns = $("seatBtns");
      btns.innerHTML = "";
      if (!locked) {
        if (!s.teams && me.role !== "player") {
          const b = el("button", "seat", "Take a seat");
          b.type = "button";
          b.addEventListener("click", () => send("seat", { play: true }));
          btns.appendChild(b);
        }
        if (me.role === "player") {
          const b = el("button", "seat", "Just watch");
          b.type = "button";
          b.addEventListener("click", () => send("seat", { play: false }));
          btns.appendChild(b);
        }
      }
      $("lockNote").hidden = !locked;
      $("lockNote").textContent = "Seats are locked while the game is on. The leader can hand a seat to someone watching from the admin panel.";
      const watchers = s.players.filter(p => !seatedIds.has(p.id) && (inGame || p.role !== "player"));
      const wl = $("watchers");
      wl.innerHTML = "";
      if (!watchers.length) wl.appendChild(el("li", "muted", "Nobody"));
      watchers.forEach(p => wl.appendChild(playerItem(p, s)));

      // Leader box: options from the server
      $("hostBox").hidden = !s.isHost;
      $("adminBox").hidden = !s.isHost;
      if (s.isHost) {
        const ho = $("hostOpts");
        const keys = Object.keys(s.choices);
        if (ho.dataset.built !== keys.join(",")) {
          ho.dataset.built = keys.join(",");
          ho.innerHTML = keys.map(k => {
            const label = ((cfg.options || []).find(o => o.key === k) || {}).label || k;
            return optField(k, label, s.choices[k], (s.multi || []).includes(k));
          }).join("");
        }
        ho.querySelectorAll("[data-opt]").forEach(sel => {
          if (!sel.contains(document.activeElement) && !sel.dataset.touched) setOptValue(sel, s.options[sel.dataset.opt]);
          sel.onchange = () => { sel.dataset.touched = "1"; };
        });
        $("newGame").hidden = inGame;

        const adminSel = $("adminPlayer");
        const keep = adminSel.value;
        adminSel.innerHTML = "";
        for (const p of s.players) {
          const seatIdx = s.seats.findIndex(x => x.id === p.id);
          const where = inGame ? (seatIdx >= 0 ? `seat ${seatIdx + 1}` : "watching")
            : p.role === "player" ? (s.teams && p.team ? s.teams[p.team] : "seated") : "watching";
          adminSel.add(new Option(`${p.name}${p.id === s.you ? " (you)" : ""} · ${where}`, p.id));
        }
        if ([...adminSel.options].some(o => o.value === keep)) adminSel.value = keep;
        $("adminLobbyRow").hidden = locked;
        $("adminGameRow").hidden = !locked;
        const teamRow = $("adminTeamRow");
        teamRow.hidden = !(s.teams && !locked);
        if (s.teams && !teamRow.childElementCount) {
          for (const [t, label] of Object.entries(s.teams)) {
            const b = el("button", "btn", "Put in " + label);
            b.type = "button";
            b.addEventListener("click", () => adminTarget() && send("admin_seat", { player: adminTarget(), play: true, team: t }));
            teamRow.appendChild(b);
          }
        }
        const pick = $("adminSeatPick");
        const keepSeat = pick.value;
        pick.innerHTML = "";
        s.seats.forEach((x, i) => pick.add(new Option(`Seat ${i + 1}: ${x.name}${x.bot ? " (bot)" : x.online ? "" : " (away)"}`, i)));
        $("adminBot").hidden = !s.botsAllowed;
        if ([...pick.options].some(o => o.value === keepSeat)) pick.value = keepSeat;
        $("adminSkip").hidden = !(cfg.canSkip && inGame);
        $("adminEnd").hidden = !inGame;
      }

      // Log
      const log = $("log");
      log.innerHTML = "";
      for (const e of [...s.log].reverse()) log.appendChild(el("li", e.kind || "", e.text));

      cfg.render(s, api);
      cheer(s, inGame);
    }

    // A ding when it becomes your move, and a banner when a game you watched finish ends.
    function cheer(s, inGame) {
      const mine = inGame && s.mySeat != null && (cfg.myTurn ? !!cfg.myTurn(s) : s.turn != null && s.turn === s.mySeat);
      if (wasMyTurn === false && mine) FX.sound("ding");
      wasMyTurn = mine;
      if (wasOver === false && s.over && s.started) {
        const played = s.mySeat != null;
        const won = played && (cfg.iWon ? !!cfg.iWon(s) : s.winner === s.mySeat);
        if (won) {
          FX.confetti();
          FX.sound("win");
          FX.banner("You win!", s.result, true);
        } else {
          FX.sound(played ? "lose" : "chime");
          FX.banner("Game over", s.result, false);
        }
      }
      wasOver = !!s.over;
    }

    function playerItem(p, s, seat) {
      const li = el("li", "player" + (p.online === false ? " away" : ""));
      if (p.team && s.teams) li.classList.add("team-" + p.team);
      const turn = seat != null && s.started && !s.over && s.turn === seat;
      li.appendChild(FX.avatar(p.name, seat != null ? seat : 8, "sm" + (turn ? " turn" : "")));
      li.appendChild(el("span", "", p.name));
      const tags = [];
      if (seat != null && s.teams && p.team) tags.push([s.teams[p.team], "teamtag"]);
      if (p.id === s.host) tags.push(["leader", "leader"]);
      if (p.id === s.you) tags.push(["you", "you"]);
      if (p.bot) tags.push(["bot", "bot"]);
      else if (p.online === false) tags.push(["away", "away"]);
      for (const [t, c] of tags) li.appendChild(el("small", "tag " + c, t));
      if (seat != null && cfg.seatTag) {
        const extra = cfg.seatTag(seat, s);
        if (extra) li.appendChild(el("small", "seat-extra", extra));
      }
      if (s.isHost && p.id !== s.you && p.id !== s.host && !p.bot) {
        const b = el("button", "promote", "Make leader");
        b.type = "button";
        b.title = `Make ${p.name} the leader`;
        b.addEventListener("click", () => send("make_leader", { player: p.id }));
        li.appendChild(b);
      }
      return li;
    }
  }

  return { start, esc, el };
})();
