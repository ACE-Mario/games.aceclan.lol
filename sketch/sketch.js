// Sketch & Guess, online. The server (server/games/sketch.py) keeps the word secret, runs the clock
// and scores guesses. Lines travel as small "live" messages while they're drawn; the full room update
// also carries every stroke, so anyone joining mid-drawing sees the whole picture.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const W = 1000, H = 750;
  const COLOURS = ["#000000", "#ffffff", "#7f7f7f", "#c4c4c4", "#e5484d", "#f76b15", "#ffc53d", "#46a758",
                   "#12a594", "#3e63dd", "#8e4ec6", "#d6409f", "#8d5a3b", "#f5d0b5"];
  const SIZES = [4, 10, 22, 40];

  let send = null, socket = null, state = null, api = null;
  let strokes = [], ink = -1, drawingKey = "";
  let tool = "pen", colour = "#000000", size = 10;
  let deadline = 0, timer = 0, lastSecond = null, prevPhase = null, shownScores = {}, chatKey = "";
  const pad = $("pad"), ctx = pad.getContext("2d");

  // ---- Drawing the strokes -----------------------------------------------------------------
  function paper() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
  }
  function line(st, from) {
    const p = st.p;
    ctx.strokeStyle = st.c;
    ctx.fillStyle = st.c;
    ctx.lineWidth = st.w;
    ctx.lineCap = ctx.lineJoin = "round";
    if (p.length === 2) {                                 // a single tap: a dot
      ctx.beginPath();
      ctx.arc(p[0], p[1], st.w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    const start = Math.max(0, from - 2);
    ctx.moveTo(p[start], p[start + 1]);
    for (let i = start + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }
  // Paint bucket: fill the area of (about) the same colour around the point.
  function fill(x, y, hex) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const at = (Math.min(H - 1, y) * W + Math.min(W - 1, x)) * 4;
    const t = [d[at], d[at + 1], d[at + 2]];
    const c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    if (Math.abs(t[0] - c[0]) + Math.abs(t[1] - c[1]) + Math.abs(t[2] - c[2]) < 8) return;
    const same = i => Math.abs(d[i] - t[0]) + Math.abs(d[i + 1] - t[1]) + Math.abs(d[i + 2] - t[2]) < 90;
    const seen = new Uint8Array(W * H), stack = [Math.min(H - 1, y) * W + Math.min(W - 1, x)];
    while (stack.length) {
      const n = stack.pop();
      if (seen[n]) continue;
      seen[n] = 1;
      const i = n * 4;
      if (!same(i)) continue;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      const px = n % W;
      if (px > 0) stack.push(n - 1);
      if (px < W - 1) stack.push(n + 1);
      if (n >= W) stack.push(n - W);
      if (n < W * (H - 1)) stack.push(n + W);
    }
    ctx.putImageData(img, 0, 0);
  }
  function drawOne(st) {
    if (st.fill) fill(st.p[0], st.p[1], st.c);
    else line(st, 0);
  }
  function redraw() {
    paper();
    strokes.forEach(drawOne);
  }
  // A message from the drawer, passed on by the server.
  function apply(m) {
    if (m.k === "start") { strokes.push({ c: m.c, w: m.w, p: [m.x, m.y] }); line(strokes[strokes.length - 1], 0); }
    else if (m.k === "pts" && strokes.length) {
      const st = strokes[strokes.length - 1], from = st.p.length;
      st.p.push(...m.p);
      line(st, from);
    } else if (m.k === "fill") { const st = { c: m.c, fill: true, p: [m.x, m.y] }; strokes.push(st); drawOne(st); }
    else if (m.k === "undo") { strokes.pop(); redraw(); }
    else if (m.k === "clear") { strokes = []; redraw(); }
  }

  // ---- The drawer's pen ---------------------------------------------------------------------
  const iDraw = () => state && state.phase === "draw" && state.drawer === state.you && !state.over;
  let down = false, queue = [], flushTimer = 0;
  const live = m => socket && socket.emit("live", m);
  function point(e) {
    const r = pad.getBoundingClientRect();
    return [Math.round(Math.max(0, Math.min(W, (e.clientX - r.left) * W / r.width))),
            Math.round(Math.max(0, Math.min(H, (e.clientY - r.top) * H / r.height)))];
  }
  function flush() {
    flushTimer = 0;
    if (queue.length) { live({ k: "pts", p: queue }); queue = []; }
  }
  pad.addEventListener("pointerdown", e => {
    if (!iDraw()) return;
    e.preventDefault();
    const [x, y] = point(e);
    if (tool === "fill") {
      const st = { c: colour, fill: true, p: [x, y] };
      strokes.push(st);
      drawOne(st);
      live({ k: "fill", c: colour, x, y });
      return;
    }
    down = true;
    pad.setPointerCapture(e.pointerId);
    const st = { c: tool === "eraser" ? "#ffffff" : colour, w: size, p: [x, y] };
    strokes.push(st);
    line(st, 0);
    live({ k: "start", c: st.c, w: st.w, x, y });
  });
  pad.addEventListener("pointermove", e => {
    if (!down || !iDraw()) return;
    const st = strokes[strokes.length - 1];
    const [x, y] = point(e);
    const n = st.p.length;
    if (Math.abs(st.p[n - 2] - x) + Math.abs(st.p[n - 1] - y) < 3) return;
    st.p.push(x, y);
    line(st, n);
    queue.push(x, y);
    if (queue.length >= 300) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 40);
  });
  const lift = () => { if (down) { down = false; flush(); } };
  pad.addEventListener("pointerup", lift);
  pad.addEventListener("pointercancel", lift);

  function buildTools() {
    const box = $("tools");
    box.innerHTML = `
      <div class="swatches">${COLOURS.map(c => `<button type="button" class="sw" data-c="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join("")}</div>
      <div class="sizes">${SIZES.map(w => `<button type="button" class="sz" data-w="${w}" aria-label="Size ${w}"><i style="--w:${Math.min(28, w)}px"></i></button>`).join("")}</div>
      <div class="tool-btns">
        <button type="button" class="tb" data-t="pen" title="Pen">✏️</button>
        <button type="button" class="tb" data-t="eraser" title="Eraser">🧽</button>
        <button type="button" class="tb" data-t="fill" title="Paint bucket">🪣</button>
        <button type="button" class="tb" id="undoBtn" title="Undo">↶</button>
        <button type="button" class="tb" id="clearBtn" title="Clear">🗑️</button>
      </div>`;
    box.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b || !iDraw()) return;
      if (b.dataset.c) { colour = b.dataset.c; if (tool === "eraser") tool = "pen"; }
      else if (b.dataset.w) size = +b.dataset.w;
      else if (b.dataset.t) tool = b.dataset.t;
      else if (b.id === "undoBtn" && strokes.length) { strokes.pop(); redraw(); live({ k: "undo" }); }
      else if (b.id === "clearBtn" && strokes.length) { strokes = []; redraw(); live({ k: "clear" }); }
      paintTools();
    });
    paintTools();
  }
  function paintTools() {
    document.querySelectorAll(".sw").forEach(b => b.classList.toggle("on", b.dataset.c === colour && tool !== "eraser"));
    document.querySelectorAll(".sz").forEach(b => b.classList.toggle("on", +b.dataset.w === size));
    document.querySelectorAll(".tb[data-t]").forEach(b => b.classList.toggle("on", b.dataset.t === tool));
    pad.style.cursor = iDraw() ? (tool === "fill" ? "cell" : "crosshair") : "default";
  }

  // ---- Clock --------------------------------------------------------------------------------
  function tickClock() {
    const s = state;
    if (!s || !s.started || s.over) { $("skClock").textContent = ""; return; }
    const left = Math.max(0, (deadline - Date.now()) / 1000), sec = Math.ceil(left);
    $("skClock").textContent = s.phase === "reveal" ? "" : String(sec);
    $("skClock").classList.toggle("low", s.phase === "draw" && left < 10);
    if (s.phase === "draw" && left < 10 && left > 0 && sec !== lastSecond) AceFX.sound("tick");
    lastSecond = sec;
  }

  // ---- Page ---------------------------------------------------------------------------------
  function render(s) {
    state = s;
    deadline = Date.now() + (s.remaining || 0) * 1000;
    clearInterval(timer);
    timer = setInterval(tickClock, 250);
    const seated = api.me.role === "player";
    $("sketch").hidden = !s.started || s.over;

    if (s.started && !s.over) {
      // The picture: take the server's copy for a new drawing, a reconnect, or anything we missed.
      // The drawer keeps their own copy while drawing (theirs is ahead of the server's).
      const key = `${s.round}/${s.drawer}/${s.phase === "choose" ? "c" : "d"}`;
      if (key !== drawingKey || (!iDraw() && s.ink !== ink) || (iDraw() && !strokes.length && s.strokes.length)) {
        strokes = s.strokes.map(st => ({ ...st, p: st.p.slice() }));
        redraw();
      }
      drawingKey = key;
      ink = s.ink;

      $("skRound").textContent = `Round ${s.round} of ${s.rounds}`;
      const word = $("skWord");
      if (s.word) { word.textContent = s.word; word.className = "sk-word known"; }
      else if (s.mask) { word.textContent = s.mask.replace(/ /g, "  "); word.className = "sk-word"; }
      else { word.textContent = ""; word.className = "sk-word"; }

      // Overlay: picking a word, or the answer between drawings.
      const ov = $("overlay");
      ov.hidden = s.phase === "draw";
      if (s.phase === "choose") {
        if (s.picks.length) {
          ov.innerHTML = `<p>Pick a word to draw</p><div class="picks">${s.picks.map((w, i) => `<button type="button" class="btn primary" data-i="${i}"></button>`).join("")}</div>`;
          ov.querySelectorAll("button").forEach(b => {
            b.textContent = s.picks[+b.dataset.i];
            b.addEventListener("click", () => send("choose", { choice: +b.dataset.i }));
          });
        } else {
          ov.innerHTML = `<p></p>`;
          ov.querySelector("p").textContent = `${s.drawerName} is picking a word…`;
        }
      } else if (s.phase === "reveal") {
        ov.innerHTML = `<p class="small muted">The word was</p><p class="answer-word"></p>`;
        ov.querySelector(".answer-word").textContent = s.word;
      }
      $("tools").hidden = !iDraw();
      paintTools();
      const guessing = s.phase === "draw" && !s.iGuessed && s.drawer !== s.you;
      $("guess").placeholder = guessing ? "Type your guess…" : "Chat…";
      $("guess").disabled = !seated;

      if (prevPhase !== s.phase) {
        if (s.phase === "draw") AceFX.sound("flip");
        if (s.phase === "reveal") AceFX.sound(s.iGuessed || s.drawer === s.you ? "chime" : "flip");
      }
    }
    chat(s);
    board(s);
    podium(s);
    prevPhase = s.phase;

    if (!s.started) {
      api.status("Lobby", "Take turns drawing. Guess fast for more points.");
      api.hint(seated ? "You've got a seat. Waiting for the leader to start." : "Take a seat in the Players panel to play.");
    } else if (s.over) {
      api.status("Final scores", s.result, "win");
      api.hint(s.isHost ? "Press Start game for another round." : "Waiting for the leader to start another game.");
    } else if (s.phase === "choose") {
      api.status(s.drawer === s.you ? "Your turn to draw" : `${s.drawerName} is up`, "Picking a word…", s.drawer === s.you ? "go" : "");
      api.hint(s.drawer === s.you ? "Pick one of the three words." : "");
    } else if (s.phase === "draw") {
      if (s.drawer === s.you) {
        api.status("Draw it!", "No letters or numbers. Let the picture do the talking.", "go");
        api.hint("");
      } else {
        api.status(`${s.drawerName} is drawing`, s.iGuessed ? "You got it! Chat stays between people who know the word." : "Type your guess below.", s.iGuessed ? "win" : "");
        api.hint(seated ? "" : "You're watching. Take a seat to join in.");
      }
    } else {
      api.status(`It was: ${s.word}`, "");
      api.hint("");
    }
    tickClock();
  }

  function chat(s) {
    const list = $("chat");
    const msgs = s.chat || [];
    const key = msgs.length + "|" + (msgs.length ? msgs[msgs.length - 1].text : "");
    if (key === chatKey) return;
    const fresh = chatKey !== "";
    chatKey = key;
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = "";
    msgs.forEach(m => {
      const li = document.createElement("li");
      li.className = "m-" + m.kind;
      if (m.name) { const b = document.createElement("b"); b.textContent = m.name + ": "; li.appendChild(b); }
      li.appendChild(document.createTextNode(m.text));
      list.appendChild(li);
    });
    if (atEnd || !fresh) list.scrollTop = list.scrollHeight;
    const last = msgs[msgs.length - 1];
    if (fresh && last && last.kind === "right") AceFX.sound("ding");
    if (fresh && last && last.kind === "close") AceFX.sound("flick");
  }

  function board(s) {
    const box = $("board");
    const before = AceFX.snap(box);
    box.innerHTML = "";
    const rows = s.started ? s.board : s.players.filter(p => p.role === "player").map(p => ({ id: p.id, name: p.name, score: 0, online: p.online }));
    if (!rows.length) box.innerHTML = '<li class="muted">Nobody has a seat yet.</li>';
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = (r.id === s.you ? "me " : "") + (r.online === false ? "away " : "") +
        ((s.winners || []).includes(r.id) ? "winner " : "") + (r.guessed ? "answered " : "");
      li.dataset.key = r.id;
      li.innerHTML = `<span class="rank">${i + 1}</span><span class="who"></span><small class="gain"></small><span class="pts"></span>`;
      const seat = s.seats.findIndex(x => x.id === r.id);
      li.insertBefore(AceFX.avatar(r.name, seat >= 0 ? seat : 8, "sm"), li.querySelector(".who"));
      li.querySelector(".who").textContent = r.name + (r.drawing ? "  ✏️" : "");
      li.querySelector(".gain").textContent = r.gained ? `+${r.gained}` : "";
      const was = shownScores[r.id] ?? r.score;
      if (was !== r.score) AceFX.countUp(li.querySelector(".pts"), was, r.score);
      else li.querySelector(".pts").textContent = r.score;
      shownScores[r.id] = r.score;
      box.appendChild(li);
    });
    AceFX.slide(box, before);
    if (!s.started) shownScores = {};
  }

  function podium(s) {
    const box = $("podium");
    box.hidden = !s.over || !s.board;
    if (box.hidden) return;
    box.innerHTML = "";
    const top = s.board.slice(0, 3);
    [1, 0, 2].forEach(k => {
      const r = top[k];
      if (!r) return;
      const d = document.createElement("div");
      d.className = "step p" + (k + 1);
      d.appendChild(AceFX.avatar(r.name, s.seats.findIndex(x => x.id === r.id), "lg"));
      const name = document.createElement("b");
      name.textContent = r.name;
      const pts = document.createElement("span");
      pts.textContent = `${r.score} pts`;
      const block = document.createElement("div");
      block.className = "block";
      block.textContent = k + 1;
      d.append(name, pts, block);
      box.appendChild(d);
    });
  }

  $("guessForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("guess").value.trim();
    if (!text || !send) return;
    send("guess", { text });
    $("guess").value = "";
  });

  paper();
  buildTools();
  AceRoom.start({
    game: "sketch",
    title: "Sketch & Guess",
    blurb: "Take turns drawing a secret word while everyone else races to guess it.",
    players: "2 to 16 players; late arrivals can jump in.",
    canSkip: true,
    options: [
      { key: "words", label: "Words (tick as many as you like)", multi: true,
        choices: [["everyday", "Everyday things"], ["gaming", "Gaming things"], ["champions", "League champions"], ["agents", "VALORANT agents"]] },
      { key: "rounds", label: "Rounds", choices: [["2", "2 rounds"], ["1", "1 round"], ["3", "3 rounds"], ["4", "4 rounds"]] },
      { key: "time", label: "Drawing time", choices: [["80", "80 seconds to draw"], ["60", "60 seconds"], ["100", "100 seconds"], ["120", "120 seconds"]] },
    ],
    myTurn: s => s.phase === "choose" && s.drawer === s.you,
    iWon: s => (s.winners || []).includes(s.you),
    seatTag: (i, s) => {
      const id = s.seats[i] && s.seats[i].id, r = (s.board || []).find(x => x.id === id);
      return r ? `${r.score} pts` : "";
    },
    rules: `<ol>
      <li>Everyone takes a turn to draw. The drawer picks one of three words and has a time limit to draw it.</li>
      <li>Everyone else types guesses in the chat. A right guess isn't shown to the others; it scores up to 500 points, more the faster you are (and a bonus for being first).</li>
      <li>The drawer scores for every person who gets it.</li>
      <li>Blanks show how long the word is, and a letter or two appears as time runs down. "Really close!" means you're one letter off.</li>
      <li>Once you've guessed it, your chat only goes to the drawer and others who know the word. No letters or numbers in drawings!</li>
    </ol>
    <p class="muted small">Drawing tools: colours, four sizes, eraser, paint bucket, undo and clear.</p>`,
    render(s, a) {
      api = a;
      send = a.send;
      if (!socket && a.socket) { socket = a.socket; socket.on("live", m => { if (!iDraw()) { apply(m); ink = m.v; } }); }
      render(s);
    },
  });
})();
