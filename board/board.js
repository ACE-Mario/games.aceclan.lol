// ACE Board: a shared live whiteboard with no edges. The server (server/games/board.py) keeps every item
// on the board (text boxes, sticky notes, pen and highlighter lines, shapes and pictures), saves the board to
// disk, and checks that people only change their own things (the leader can delete anyone's). Changes travel
// as small "live" messages, the same way Sketch & Guess sends lines, so typing and drawing show up straight
// away. The full room update carries the whole board only when this tab doesn't have it yet; otherwise it
// lists the item ids, so we can drop anything stale and ask again if we missed something.
//
// Each item is its own element (text and notes: a div, picture: a div with an img, lines and shapes: an svg)
// inside one "world" element that is moved and scaled to pan and zoom. Hiding a player's writing (the eye)
// just hides their elements, on this screen only. Undo (Ctrl+Z) keeps a list of your own changes and sends
// the reverse.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const FX = window.AceFX;
  const LIM = { text: 3000, image: 700000, imageTotal: 30000000, stroke: 6000, chunk: 400 };
  const INK = ["#1f2328", "#e5484d", "#f76b15", "#d6a100", "#2f9e44", "#12a594", "#3e63dd", "#8e4ec6", "#d6409f", "#ffffff"];
  const HL = ["#ffe14d", "#7ee787", "#ff8ccf", "#79c0ff", "#ffa657"];
  const NOTES = ["#fff3a3", "#ffd6a5", "#ffc6d9", "#d7c6ff", "#bde0fe", "#c8f7c5", "#ffffff"];
  const PEN_SIZES = [3, 6, 12, 24];
  const HL_SIZES = [14, 24, 40];
  const SHAPE_SIZES = [2, 4, 8];
  const TEXT_SIZES = [18, 24, 36, 56];
  const NOTE_SIZE = 20;
  const ZMIN = 0.1, ZMAX = 4;
  const IMG_MAX_SIDE = 1600;        // pictures are shrunk to this before sending
  const HISTORY = 100;              // how many of your changes Ctrl+Z remembers
  const CLIP_MARK = "[ACE Board items] ";
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const newId = () => {
    const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), b => abc[b % abc.length]).join("");
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, cls) => { const e = document.createElementNS(SVGNS, tag); if (cls) e.setAttribute("class", cls); return e; };

  let socket = null, state = null, me = "", room = null;
  const items = new Map();          // id -> { d: item data, el }
  const pending = new Set();        // ids we added that the server hasn't confirmed yet
  const gone = new Map();           // id -> when we deleted it (so an older room update doesn't bring it back)
  const busy = new Set();           // ids being dragged, drawn or typed in right now
  const hidden = new Set();         // players whose writing is hidden on this screen
  const sel = new Set();            // selected item ids
  let tool = "select", ink = INK[0], hlColour = HL[0], noteColour = NOTES[0];
  let penSize = 6, hlSize = 24, shapeSize = 4, textSize = 24, shapeKind = "rect", shapeFill = false;
  let editing = null, editStart = null, lastResync = 0, noteTimer = 0, leaveBoard = null;
  const cam = { x: 0, y: 0, z: 1 };        // board point at the top-left of the screen, and the zoom

  const world = $("world"), viewport = $("viewport");
  const handle = document.createElement("div");       // the resize handle for one selected picture or shape
  handle.className = "bd-handle";
  handle.hidden = true;
  world.append(handle);

  // ---- Start screen: make a board, or open one from the list -------------------------------
  // Boards are named, and their link is board/?b=<slug>; the server's room name for one is "b:<slug>".
  const cleanSlug = v => String(v || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  const boardLink = slug => location.origin + location.pathname + "?b=" + slug;
  let pendingSlug = "", boards = [], listTimer = 0, serverUp = false;

  function startError(msg) {
    $("startError").textContent = msg || "";
    $("startError").hidden = !msg;
  }
  function showStart(slug, error) {
    $("gameView").hidden = true;
    $("startView").hidden = false;
    document.body.classList.remove("on-board");
    pendingSlug = slug || "";
    history.replaceState(null, "", location.pathname);
    document.title = "ACE Board";
    $("playerName").value = AceLive.name();
    startError(error);
    loadList();
  }
  function needName() {
    const n = $("playerName").value.trim();
    if (!n) {
      startError("Type your name first, so everyone knows whose writing is whose.");
      $("playerName").focus();
      return null;
    }
    AceLive.setName(n);
    return n;
  }
  function openBoard(slug) {
    if (!serverUp) return startError("The game server is offline right now, so boards can't be opened.");
    if (!needName()) { pendingSlug = slug; return; }
    play({ slug });
  }
  function ago(t) {
    const s = Math.max(0, Date.now() / 1000 - t);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400 * 2) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
  }
  async function copyText(text, note) {
    try { await navigator.clipboard.writeText(text); note("Link copied. Paste it anywhere, like Discord."); }
    catch { note("Copy this link: " + text); }
  }
  function renderList() {
    const q = $("boardSearch").value.trim().toLowerCase();
    const list = $("boardList");
    list.innerHTML = "";
    const shown = boards.filter(b => !q || b.name.toLowerCase().includes(q));
    for (const b of shown) {
      const li = document.createElement("li");
      li.className = "board-row" + (b.slug === pendingSlug ? " wanted" : "");
      const info = document.createElement("div");
      info.className = "board-info";
      const a = document.createElement("a");
      a.href = "?b=" + b.slug;
      a.textContent = b.name;
      a.addEventListener("click", e => { e.preventDefault(); openBoard(b.slug); });
      const meta = document.createElement("span");
      meta.className = "muted small";
      meta.textContent = `${b.items} thing${b.items === 1 ? "" : "s"} · changed ${ago(b.updated)}` + (b.online ? ` · ${b.online} here now` : "");
      if (b.online) li.classList.add("live");
      info.append(a, meta);
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "btn small-btn";
      copy.textContent = "Copy link";
      copy.addEventListener("click", () => copyText(boardLink(b.slug), msg => { $("listNote").textContent = msg; }));
      const open = document.createElement("button");
      open.type = "button";
      open.className = "btn primary small-btn";
      open.textContent = "Open";
      open.addEventListener("click", () => openBoard(b.slug));
      li.append(info, copy, open);
      list.append(li);
    }
    $("boardCount").textContent = boards.length ? `(${boards.length})` : "";
    if (!serverUp) $("listNote").textContent = "The list shows while the game server is running.";
    else if (!boards.length) $("listNote").textContent = "No boards yet. Make the first one!";
    else if (!shown.length) $("listNote").textContent = "No boards match that search.";
    else if (!$("listNote").textContent.startsWith("Link") && !$("listNote").textContent.startsWith("Copy")) $("listNote").textContent = "";
  }
  async function loadList() {
    clearTimeout(listTimer);
    if ($("startView").hidden) return;
    try {
      const r = await fetch(AceLive.SERVER + "/api/board/list", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      boards = (await r.json()).boards || [];
      serverUp = true;
    } catch {
      serverUp = false;
    }
    const st = $("serverStatus");
    st.className = "server-status " + (serverUp ? "up" : "down");
    st.textContent = serverUp ? "Game server is online."
      : "Game server is offline right now. Boards open while it's running on the ACE host's PC.";
    $("createBtn").disabled = !serverUp;
    if (pendingSlug && serverUp && !boards.some(b => b.slug === pendingSlug) && !$("startError").textContent) {
      startError(`There's no board at that link any more. It may have been deleted.`);
      pendingSlug = "";
    }
    renderList();
    listTimer = setTimeout(loadList, 20000);
  }
  function initStart() {
    FX.soundButton();
    $("onlineForm").addEventListener("submit", e => {
      e.preventDefault();
      if (!needName()) return;
      const name = $("boardName").value.trim();
      if (!name && pendingSlug) return openBoard(pendingSlug);
      if (!name) { startError("Give the board a name, like \"Biology revision\"."); $("boardName").focus(); return; }
      play({ create: name });
    });
    $("boardSearch").addEventListener("input", renderList);
    const slug = cleanSlug(new URLSearchParams(location.search).get("b"));
    if (slug && AceLive.name() && window.io) play({ slug });
    else {
      showStart(slug);
      if (slug) startError("Type your name, then press Open on the board (it's highlighted in the list).");
    }
  }

  // ---- Connection ----------------------------------------------------------------------------
  let playing = false;
  function play(opts) {
    if (playing) return;
    playing = true;
    clearTimeout(listTimer);
    room = opts.slug || null;                   // the board's slug
    let create = opts.create || "";
    $("startView").hidden = true;
    $("gameView").hidden = false;
    document.body.classList.add("on-board");
    setPanel(innerWidth > 900);
    recentre();
    socket = AceLive.connect();
    const setConn = msg => { $("connNote").textContent = msg || ""; $("connNote").hidden = !msg; };
    const fail = msg => {
      socket.disconnect();
      socket = null;
      playing = false;
      state = null;
      firstState = true;
      clearBoard();
      undoList.length = redoList.length = 0;     // a different board next time: start afresh
      syncUndo();
      hidden.clear();
      showStart(room, msg);
    };
    leaveBoard = fail;
    function enter() {
      const base = { playerId: AceLive.playerId(), name: AceLive.name() };
      if (create) {
        socket.timeout(8000).emit("create", { ...base, game: "board", options: { name: create } }, (err, res) => {
          if (err) return fail("The game server didn't answer. Try again in a moment.");
          if (res.error) { room = null; return fail(res.error); }
          create = "";
          room = res.room.slice(2);
          history.replaceState(null, "", "?b=" + room);
        });
      } else {
        history.replaceState(null, "", "?b=" + room);
        socket.timeout(8000).emit("join", { ...base, room: "b:" + room }, (err, res) => {
          if (err) return setConn("Can't reach the game server. Retrying…");
          if (res.error) return fail("There's no board at that link. It may have been deleted.");
        });
      }
    }
    socket.on("connect", () => { setConn(""); enter(); });
    socket.on("disconnect", () => setConn("Connection lost. Reconnecting…"));
    socket.on("connect_error", () => setConn(state ? "Connection lost. Reconnecting…"
      : "Can't reach the game server. It may be switched off. Retrying…"));
    socket.on("state", onState);
    socket.on("live", onLive);
  }

  function action(type, extra = {}) {
    socket.timeout(6000).emit("action", { type, ...extra }, (err, res) => {
      if (err) note("The server didn't answer. Check your connection and try again.");
      else if (res && res.error) note(res.error);
    });
  }
  // The server may handle two quick messages at the same moment, so changes to something we've just
  // added wait until the server has said it got the add (otherwise it might not know the item yet).
  const waiting = new Map();          // id -> messages held back until its add is confirmed
  function live(msg) {
    if (msg.id && pending.has(msg.id)) {
      if (!waiting.has(msg.id)) waiting.set(msg.id, []);
      waiting.get(msg.id).push(msg);
      return;
    }
    if (socket) socket.emit("live", msg);
  }
  function note(msg) {
    const n = $("note");
    n.textContent = msg;
    n.hidden = !msg;
    clearTimeout(noteTimer);
    if (msg) noteTimer = setTimeout(() => { n.hidden = true; }, 5000);
  }

  // ---- Room updates --------------------------------------------------------------------------
  let firstState = true;
  function onState(s) {
    const wasHost = state && state.isHost;
    state = s;
    me = s.you;
    if (s.board) room = s.board.slug;
    if (s.deleted) { leaveBoard && leaveBoard("That board was deleted."); return; }
    if (s.limits) Object.assign(LIM, s.limits);
    viewport.classList.toggle("host", !!s.isHost);
    const now = Date.now();
    for (const [id, t] of gone) if (now - t > 8000) gone.delete(id);
    const keep = new Set(s.ids);
    for (const id of [...items.keys()]) {
      const it = items.get(id);
      if (!keep.has(id) && !pending.has(id) && !it.draft && !busy.has(id)) removeItem(id);
    }
    if (s.items) {
      for (const d of s.items) if (!busy.has(d.id) && !gone.has(d.id)) applyItem(d);
      if (firstState && s.items.length) fitAll();
      firstState = false;
    } else if (s.ids.some(id => !items.has(id) && !gone.has(id)) && now - lastResync > 3000) {
      lastResync = now;                                   // we missed something: ask for the whole board
      action("resync");
    }
    if (wasHost !== s.isHost) for (const it of items.values()) draw(it);
    renderPanel();
  }

  function onLive(m) {
    if (m.k === "cur") return showCursor(m);
    if (m.k === "add") { if (!gone.has(m.item.id)) applyItem(m.item); renderPanel(); return; }
    const it = items.get(m.id);
    if (!it) return;
    const d = it.d;
    if (m.k === "pts") d.p.push(...m.p);
    else if (m.k === "move") { d.x = m.x; d.y = m.y; if ("w" in m) { d.w = m.w; d.h = m.h; } }
    else if (m.k === "edit") { for (const k of ["text", "c", "s", "bg"]) if (k in m) d[k] = m[k]; }
    else if (m.k === "del") { removeItem(m.id); renderPanel(); return; }
    draw(it);
  }

  // ---- People --------------------------------------------------------------------------------
  function playerName(pid) {
    const p = state && state.players.find(x => x.id === pid);
    return p ? p.name : (state && state.authors && state.authors[pid]) || "Someone";
  }
  function colourIndex(pid) {
    if (!state) return 0;
    if (pid in state.colours) return state.colours[pid];
    const away = Object.keys(state.authors || {});
    return state.players.length + Math.max(0, away.indexOf(pid));
  }
  const playerColour = pid => FX.color(colourIndex(pid));
  const canDelete = it => it && (it.d.by === me || (state && state.isHost));

  // ---- Drawing items -------------------------------------------------------------------------
  function applyItem(d) {
    let it = items.get(d.id);
    if (!it) {
      let el;
      if (d.kind === "text") el = document.createElement("div");
      else if (d.kind === "image") {
        el = document.createElement("div");
        const img = document.createElement("img");
        img.alt = "Picture";
        img.draggable = false;
        el.append(img);
      } else {
        el = svgEl("svg");
        el.append(svgEl("path", "hit"), svgEl("path", "line"));
      }
      el.dataset.id = d.id;
      el.classList.add("bd-item", "bd-" + d.kind);
      it = { d: { ...d, p: d.p ? [...d.p] : undefined }, el };
      items.set(d.id, it);
      world.insertBefore(el, handle);
    } else {
      Object.assign(it.d, d, d.p ? { p: [...d.p] } : {});
    }
    draw(it);
    return it;
  }

  // A shape's box with left/top first (w and h can be negative while it's drawn or resized).
  function shapeBox(d) {
    return { x: Math.min(d.x, d.x + d.w), y: Math.min(d.y, d.y + d.h), w: Math.abs(d.w), h: Math.abs(d.h) };
  }
  function arrowHead(d) {
    const x2 = d.x + d.w, y2 = d.y + d.h, a = Math.atan2(d.h, d.w), len = Math.max(14, d.sw * 4);
    return [[x2 - len * Math.cos(a - 0.45), y2 - len * Math.sin(a - 0.45)], [x2, y2],
            [x2 - len * Math.cos(a + 0.45), y2 - len * Math.sin(a + 0.45)]];
  }
  function shapePath(d) {
    const b = shapeBox(d);
    if (d.shape === "rect") return `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`;
    if (d.shape === "ellipse") {
      const rx = b.w / 2, ry = b.h / 2, cx = b.x + rx, cy = b.y + ry;
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${b.w} 0a${rx} ${ry} 0 1 0 ${-b.w} 0Z`;
    }
    let path = `M${d.x} ${d.y}L${d.x + d.w} ${d.y + d.h}`;
    if (d.shape === "arrow" && (d.w || d.h)) {
      const [a, tip, c] = arrowHead(d);
      path += `M${a[0]} ${a[1]}L${tip[0]} ${tip[1]}L${c[0]} ${c[1]}`;
    }
    return path;
  }

  function draw(it) {
    const d = it.d, el = it.el;
    const mine = d.by === me;
    el.classList.toggle("mine", mine);
    el.classList.toggle("can-del", canDelete(it));
    el.classList.toggle("sel", sel.has(d.id));
    el.style.setProperty("--pc", playerColour(d.by));
    const what = { text: d.bg ? "Sticky note" : "Text", image: "Picture", pen: d.hl ? "Highlight" : "Drawing", shape: "Shape" }[d.kind];
    const label = what + " by " + playerName(d.by) + (mine ? " (you)" : "");
    if (d.kind === "pen" || d.kind === "shape") el.setAttribute("aria-label", label);
    else el.title = label;
    el.style.display = hidden.has(d.by) ? "none" : "";
    if (d.kind === "text") {
      el.style.left = d.x + "px";
      el.style.top = d.y + "px";
      el.style.color = d.c;
      el.style.fontSize = d.s + "px";
      el.classList.toggle("note", !!d.bg);
      el.style.background = d.bg || "";
      el.classList.toggle("light", !d.bg && isLight(d.c));
      if (editing !== d.id && el.textContent !== d.text) el.textContent = d.text;
    } else if (d.kind === "image") {
      Object.assign(el.style, { left: d.x + "px", top: d.y + "px", width: d.w + "px", height: d.h + "px" });
      const img = el.firstChild;
      if (img.getAttribute("src") !== d.src) img.src = d.src;
    } else {
      let x0, y0, x1, y1, path, pad, sw;
      if (d.kind === "pen") {
        const p = d.p;
        x0 = y0 = Infinity; x1 = y1 = -Infinity;
        for (let i = 0; i < p.length; i += 2) {
          x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
          y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
        }
        path = `M${p[0]} ${p[1]}` + (p.length === 2 ? "l0.01 0" : "");     // a single tap: a dot
        for (let i = 2; i < p.length; i += 2) path += `L${p[i]} ${p[i + 1]}`;
        sw = d.w;
        x0 += d.x; x1 += d.x; y0 += d.y; y1 += d.y;          // a line's x, y is how far it was moved
      } else {
        const b = shapeBox(d);
        x0 = b.x; y0 = b.y; x1 = b.x + b.w; y1 = b.y + b.h;
        path = shapePath(d);
        sw = d.sw;
        if (d.shape === "arrow") for (const [hx, hy] of arrowHead(d)) { x0 = Math.min(x0, hx); x1 = Math.max(x1, hx); y0 = Math.min(y0, hy); y1 = Math.max(y1, hy); }
      }
      pad = sw / 2 + 10;
      const bw = x1 - x0 + pad * 2, bh = y1 - y0 + pad * 2;
      const ox = d.kind === "pen" ? d.x : 0, oy = d.kind === "pen" ? d.y : 0;
      el.setAttribute("viewBox", `${x0 - pad - ox} ${y0 - pad - oy} ${bw} ${bh}`);
      el.setAttribute("width", bw);
      el.setAttribute("height", bh);
      el.style.left = (x0 - pad) + "px";
      el.style.top = (y0 - pad) + "px";
      el.classList.toggle("hl", !!d.hl);
      const [hit, line] = el.children;
      hit.setAttribute("d", path);
      hit.setAttribute("stroke-width", Math.max(sw, 16));
      line.setAttribute("d", path);
      line.setAttribute("stroke", d.c);
      line.setAttribute("stroke-width", sw);
      line.setAttribute("fill", d.fill ? d.c : "none");
      hit.classList.toggle("filled", !!d.fill);
    }
    if (sel.size === 1 && sel.has(d.id)) placeHandle();
  }
  const isLight = c => {
    const n = parseInt(c.slice(1), 16);
    return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 200;
  };

  // Where an item sits on the board (for selecting with a box, fitting the view and downloading).
  function itemBox(it) {
    const d = it.d, el = it.el;
    if (d.kind === "text" || d.kind === "image") return { x: d.x, y: d.y, w: el.offsetWidth || d.w || 0, h: el.offsetHeight || d.h || 0 };
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: +el.getAttribute("width"), h: +el.getAttribute("height") };
  }

  function removeItem(id) {
    const it = items.get(id);
    if (!it) return;
    it.el.remove();
    items.delete(id);
    if (sel.delete(id)) selChanged();
    if (editing === id) { editing = null; editStart = null; }
  }
  function clearBoard() {
    for (const id of [...items.keys()]) removeItem(id);
  }

  // Put one of our own items on the board and send it. Long pen lines go in pieces.
  function addItem(d) {
    const { by, ...data } = d;
    applyItem({ ...data, by: me });
    pending.add(data.id);
    let rest = [];
    if (data.kind === "pen" && data.p.length > LIM.chunk) {
      rest = data.p.slice(LIM.chunk);
      data.p = data.p.slice(0, LIM.chunk);
    }
    socket.emit("live", { k: "add", item: data }, () => {
      pending.delete(data.id);
      const held = waiting.get(data.id) || [];
      waiting.delete(data.id);
      held.forEach(live);
    });
    for (let i = 0; i < rest.length; i += LIM.chunk) live({ k: "pts", id: data.id, p: rest.slice(i, i + LIM.chunk) });
    renderPanel();
  }
  // Deletes one item. Returns an undo entry when it was ours (the leader can't undo deleting someone else's).
  function deleteItem(id) {
    const it = items.get(id);
    if (!canDelete(it)) return null;
    const snap = it.d.by === me && !it.draft ? { t: "del", d: snapshot(it) } : null;
    if (!it.draft) live({ k: "del", id });
    gone.set(id, Date.now());
    removeItem(id);
    renderPanel();
    return snap;
  }
  function moveItem(id, to) {
    const it = items.get(id);
    if (!it) return;
    Object.assign(it.d, to);
    draw(it);
    sendMove(it.d);
  }
  function sendMove(d) {
    live(d.kind === "image" || d.kind === "shape" ? { k: "move", id: d.id, x: d.x, y: d.y, w: d.w, h: d.h } : { k: "move", id: d.id, x: d.x, y: d.y });
  }
  function editItem(id, vals) {
    const it = items.get(id);
    if (!it) return;
    Object.assign(it.d, vals);
    draw(it);
    if (!it.draft) live({ k: "edit", id, ...vals });
  }
  const snapshot = it => {
    const { by, ...d } = it.d;
    return { ...d, p: d.p ? [...d.p] : undefined };
  };

  // ---- Selection -----------------------------------------------------------------------------
  function setSel(ids) {
    const before = [...sel];
    sel.clear();
    for (const id of ids) if (items.has(id)) sel.add(id);
    for (const id of new Set([...before, ...sel])) if (items.has(id)) draw(items.get(id));
    selChanged();
  }
  const selItems = () => [...sel].map(id => items.get(id)).filter(Boolean);
  const ownSel = () => selItems().filter(it => it.d.by === me);
  function selChanged() {
    placeHandle();
    $("selBtns").hidden = !sel.size;
    $("dupBtn").hidden = !ownSel().length;
    syncToolbar();
  }
  function placeHandle() {
    const [it] = sel.size === 1 ? selItems() : [];
    const ok = it && it.d.by === me && (it.d.kind === "image" || it.d.kind === "shape") && it.el.style.display !== "none";
    handle.hidden = !ok;
    if (!ok) return;
    const d = it.d;
    handle.style.left = d.x + d.w + "px";
    handle.style.top = d.y + d.h + "px";
  }
  function deleteSelected() {
    const undo = selItems().map(it => deleteItem(it.d.id)).filter(Boolean);
    if (undo.length) record(undo.length === 1 ? undo[0] : { t: "many", list: undo });
    setSel([]);
  }

  // Copies of your own things: Ctrl+C / Ctrl+V, Ctrl+X, Ctrl+D.
  let clip = null, clipToken = "", pasteCount = 0;
  function copySelected() {
    const own = ownSel();
    if (!own.length) return false;
    clip = own.map(snapshot);
    clipToken = newId();
    pasteCount = 0;
    return true;
  }
  function placeCopies(list, dx, dy) {
    const added = [], ids = [];
    for (const src of list) {
      if (!roomFor(src.kind, src.src ? src.src.length : 0)) break;
      const d = { ...src, id: newId(), x: src.x + dx, y: src.y + dy, p: src.p ? [...src.p] : undefined };
      addItem(d);
      added.push({ t: "add", d: { ...d, p: d.p ? [...d.p] : undefined } });
      ids.push(d.id);
    }
    if (added.length) record(added.length === 1 ? added[0] : { t: "many", list: added });
    setTool("select");
    setSel(ids);
  }
  function duplicateSelected() {
    const own = ownSel();
    if (own.length) placeCopies(own.map(snapshot), 30, 30);
  }

  // ---- Undo and redo (your own changes only) -------------------------------------------------
  // Entries: {t:"add", d}, {t:"del", d}, {t:"move", id, from, to}, {t:"edit", id, from, to}, {t:"many", list}.
  // Something brought back by undo gets a new id (the old one may still be remembered as deleted), so
  // later entries that point at the old id are moved over to the new one.
  const undoList = [], redoList = [];
  function record(entry) {
    undoList.push(entry);
    if (undoList.length > HISTORY) undoList.shift();
    redoList.length = 0;
    syncUndo();
  }
  function syncUndo() {
    $("undoBtn").disabled = !undoList.length;
    $("redoBtn").disabled = !redoList.length;
  }
  function renameInHistory(old, now) {
    const fix = e => {
      if (e.t === "many") e.list.forEach(fix);
      if (e.id === old) e.id = now;
      if (e.d && e.d.id === old) e.d.id = now;
    };
    undoList.forEach(fix);
    redoList.forEach(fix);
  }
  function bringBack(d) {
    if (!roomFor(d.kind, d.src ? d.src.length : 0)) return false;
    const id = newId();
    renameInHistory(d.id, id);
    addItem({ ...d, id, p: d.p ? [...d.p] : undefined });
    return true;
  }
  function run(e, back) {
    // back = true to undo the entry, false to do it again
    if (e.t === "many") return (back ? [...e.list].reverse() : e.list).every(x => run(x, back));
    if (e.t === "add" || e.t === "del") {
      const remove = (e.t === "add") === back;
      if (remove) { deleteItem(e.d.id); return true; }
      return bringBack(e.d);
    }
    if (!items.has(e.id)) return true;                // it's gone (the board was cleared): nothing to do
    if (e.t === "move") moveItem(e.id, back ? e.from : e.to);
    if (e.t === "edit") editItem(e.id, back ? e.from : e.to);
    return true;
  }
  function undo() {
    if (editing) finishEdit();
    const e = undoList.pop();
    if (!e) return;
    setSel([]);
    run(e, true);
    redoList.push(e);
    syncUndo();
  }
  function redo() {
    if (editing) finishEdit();
    const e = redoList.pop();
    if (!e) return;
    setSel([]);
    run(e, false);
    undoList.push(e);
    syncUndo();
  }
  $("undoBtn").addEventListener("click", undo);
  $("redoBtn").addEventListener("click", redo);

  // ---- Limits (the server checks them too; checking here gives a clear message) -------------
  function roomFor(kind, chars = 0) {
    if (kind === "image") {
      const pics = [...items.values()].filter(i => i.d.kind === "image");
      const total = pics.reduce((n, i) => n + i.d.src.length, 0);
      if (total + chars > LIM.imageTotal) { note("There are too many big pictures on this board. Delete some first."); return false; }
    }
    return true;
  }

  // ---- Camera: pan and zoom over a board with no edges ---------------------------------------
  function applyCam() {
    world.style.transform = `translate(${-cam.x * cam.z}px, ${-cam.y * cam.z}px) scale(${cam.z})`;
    world.style.setProperty("--iz", 1 / cam.z);          // cursors and handles stay the same size on screen
    let g = 40 * cam.z;
    while (g < 14) g *= 5;                               // keep the dots from getting too crowded
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${-cam.x * cam.z}px ${-cam.y * cam.z}px`;
    $("zoomLabel").textContent = Math.round(cam.z * 100) + "%";
  }
  function screenPt(e) {
    const r = viewport.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  function toBoard(e) {
    const { sx, sy } = screenPt(e);
    return { x: Math.round(cam.x + sx / cam.z), y: Math.round(cam.y + sy / cam.z) };
  }
  function viewCentre() {
    return { x: Math.round(cam.x + viewport.clientWidth / 2 / cam.z), y: Math.round(cam.y + viewport.clientHeight / 2 / cam.z) };
  }
  function zoomAt(z, sx = viewport.clientWidth / 2, sy = viewport.clientHeight / 2) {
    z = Math.max(ZMIN, Math.min(ZMAX, z));
    const wx = cam.x + sx / cam.z, wy = cam.y + sy / cam.z;
    cam.z = z;
    cam.x = wx - sx / z;
    cam.y = wy - sy / z;
    applyCam();
  }
  function visibleBounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items.values()) {
      if (it.el.style.display === "none") continue;
      const b = itemBox(it);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    return isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }
  function fitAll() {
    // Show everything that's on the board (or go back to the middle if it's empty).
    const b = visibleBounds();
    if (!b) { recentre(); return; }
    const vw = viewport.clientWidth, vh = viewport.clientHeight, pad = 80;
    cam.z = Math.max(ZMIN, Math.min(1, Math.min(vw / (b.x1 - b.x0 + pad * 2), vh / (b.y1 - b.y0 + pad * 2))));
    cam.x = (b.x0 + b.x1) / 2 - vw / 2 / cam.z;
    cam.y = (b.y0 + b.y1) / 2 - vh / 2 / cam.z;
    applyCam();
  }
  function recentre() {
    // Back to the middle of the board (0, 0) at 100%.
    cam.z = 1;
    cam.x = -viewport.clientWidth / 2;
    cam.y = -viewport.clientHeight / 2;
    applyCam();
  }
  viewport.addEventListener("wheel", e => {
    // The scroll wheel zooms in and out around the pointer (middle-click drag or Space+drag to move around).
    e.preventDefault();
    const { sx, sy } = screenPt(e);
    const dy = Math.max(-120, Math.min(120, e.deltaY * (e.deltaMode ? 33 : 1)));
    zoomAt(cam.z * Math.exp(-dy * 0.0022), sx, sy);
  }, { passive: false });
  $("zoomIn").addEventListener("click", () => zoomAt(cam.z * 1.25));
  $("zoomOut").addEventListener("click", () => zoomAt(cam.z / 1.25));
  $("zoomLabel").addEventListener("click", fitAll);
  $("homeBtn").addEventListener("click", recentre);

  // ---- Pointer: select/move, text, notes, pen, highlighter, shapes, eraser, pan, pinch -------
  let drag = null;           // what the pointer is doing right now
  let sendTimer = 0, spaceDown = false;
  const touches = new Map(); // pointer id -> last position, for two-finger pan and pinch
  let pinch = null;
  const marquee = document.createElement("div");
  marquee.className = "bd-marquee";
  marquee.hidden = true;
  viewport.append(marquee);

  function itemAt(target) {
    const el = target && target.closest ? target.closest(".bd-item") : null;
    return el ? items.get(el.dataset.id) : null;
  }
  function startPan(e) {
    drag = { type: "pan", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
    viewport.classList.add("panning");
  }

  viewport.addEventListener("pointerdown", e => {
    if (!state) return;
    if (e.target.closest(".bd-drop")) return;
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {                         // second finger: stop what the first was doing and pinch
        cancelDrag();
        const [a, b] = [...touches.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        return;
      }
      if (touches.size > 2) return;
    }
    const target = e.target;
    if (editing && target.closest(".bd-item")?.dataset.id === editing) return;     // clicking inside the text you're typing
    if (editing) finishEdit();
    viewport.focus({ preventScroll: true });
    try { viewport.setPointerCapture(e.pointerId); } catch { /* a pointer that's already gone */ }
    if (e.button === 1 || (e.button === 0 && spaceDown)) { e.preventDefault(); startPan(e); return; }
    if (e.button > 0) return;
    const pt = toBoard(e);
    const it = itemAt(target);

    if (target === handle) {                            // resize the one selected picture or shape
      e.preventDefault();
      const [s] = selItems();
      busy.add(s.d.id);
      drag = { type: "resize", id: s.d.id, from: pt, start: { x: s.d.x, y: s.d.y, w: s.d.w, h: s.d.h }, moved: false };
    } else if (tool === "pen" || tool === "hl") {
      e.preventDefault();
      if (!roomFor("pen")) return;
      const hl = tool === "hl";
      const d = { id: newId(), kind: "pen", x: 0, y: 0, c: hl ? hlColour : ink, w: hl ? hlSize : penSize, p: [pt.x, pt.y] };
      if (hl) d.hl = true;
      addItem(d);
      busy.add(d.id);
      drag = { type: "pen", id: d.id, queue: [], last: pt };
    } else if (tool === "shape") {
      e.preventDefault();
      if (!roomFor("shape")) return;
      const d = { id: newId(), kind: "shape", shape: shapeKind, x: pt.x, y: pt.y, w: 0, h: 0, c: ink, sw: shapeSize, fill: shapeFill && (shapeKind === "rect" || shapeKind === "ellipse") };
      addItem(d);
      busy.add(d.id);
      drag = { type: "shape", id: d.id, from: pt };
    } else if (tool === "eraser") {
      e.preventDefault();
      drag = { type: "erase", erased: [] };
      if (it) erase(it);
    } else if (tool === "text" || tool === "note") {
      e.preventDefault();
      if (it && it.d.by === me && it.d.kind === "text") startEdit(it.d.id);
      else newText(pt, tool === "note");
    } else {                                    // select
      if (it && (it.d.by === me || state.isHost)) {
        e.preventDefault();
        const id = it.d.id;
        if (e.shiftKey) {
          setSel(sel.has(id) ? [...sel].filter(x => x !== id) : [...sel, id]);
          if (!sel.has(id)) return;
        } else if (!sel.has(id)) setSel([id]);
        const moving = ownSel();
        if (!moving.length) return;                    // the leader picked someone else's thing: select only
        moving.forEach(m => busy.add(m.d.id));
        drag = { type: "move", from: pt, moved: false, starts: new Map(moving.map(m => [m.d.id, { x: m.d.x, y: m.d.y }])) };
      } else if (e.pointerType === "touch") {
        if (!e.shiftKey) setSel([]);
        startPan(e);                            // one finger on empty space moves the board
      } else {
        const { sx, sy } = screenPt(e);
        drag = { type: "box", sx, sy, add: e.shiftKey ? [...sel] : [] };
        if (!e.shiftKey) setSel([]);
      }
    }
  });

  function erase(it) {
    if (!canDelete(it)) return;
    const entry = deleteItem(it.d.id);
    if (entry && drag && drag.erased) drag.erased.push(entry);
  }

  viewport.addEventListener("pointermove", e => {
    if (e.pointerType === "touch" && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        cam.x -= (mx - pinch.mx) / cam.z;
        cam.y -= (my - pinch.my) / cam.z;
        const r = viewport.getBoundingClientRect();
        zoomAt(cam.z * d / (pinch.d || d), mx - r.left, my - r.top);
        pinch = { d, mx, my };
        return;
      }
    }
    if (!drag) return;
    if (drag.type === "pan") {
      cam.x = drag.cx - (e.clientX - drag.sx) / cam.z;
      cam.y = drag.cy - (e.clientY - drag.sy) / cam.z;
      applyCam();
      return;
    }
    if (drag.type === "erase") {
      erase(itemAt(document.elementFromPoint(e.clientX, e.clientY)));
      return;
    }
    if (drag.type === "box") {
      const { sx, sy } = screenPt(e);
      const x = Math.min(sx, drag.sx), y = Math.min(sy, drag.sy), w = Math.abs(sx - drag.sx), h = Math.abs(sy - drag.sy);
      Object.assign(marquee.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
      marquee.hidden = w < 3 && h < 3;
      drag.rect = { x0: cam.x + x / cam.z, y0: cam.y + y / cam.z, x1: cam.x + (x + w) / cam.z, y1: cam.y + (y + h) / cam.z };
      return;
    }
    const pt = toBoard(e);
    if (drag.type === "move") {
      const dx = pt.x - drag.from.x, dy = pt.y - drag.from.y;
      if (!drag.moved && Math.hypot(dx, dy) * cam.z < 3) return;
      drag.moved = true;
      for (const [id, st] of drag.starts) {
        const it = items.get(id);
        if (!it) continue;
        it.d.x = st.x + dx;
        it.d.y = st.y + dy;
        draw(it);
      }
      if (!sendTimer) sendTimer = setTimeout(flushMove, 50);
      return;
    }
    const it = items.get(drag.id);
    if (!it) { drag = null; return; }
    if (drag.type === "pen") {
      const pts = (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]).map(toBoard);
      for (const q of pts) {
        if (Math.hypot(q.x - drag.last.x, q.y - drag.last.y) < 2 / cam.z) continue;
        if (it.d.p.length >= LIM.stroke) break;
        drag.queue.push(q.x, q.y);
        it.d.p.push(q.x, q.y);
        drag.last = q;
      }
      draw(it);
      if (!sendTimer) sendTimer = setTimeout(flushPen, 40);
    } else if (drag.type === "shape") {
      let w = pt.x - drag.from.x, h = pt.y - drag.from.y;
      if (e.shiftKey) {                         // Shift: a square or circle, or a line at 45° steps
        if (it.d.shape === "line" || it.d.shape === "arrow") {
          const a = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(w, h);
          w = Math.round(Math.cos(a) * len); h = Math.round(Math.sin(a) * len);
        } else {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m;
        }
      }
      it.d.w = w;
      it.d.h = h;
      draw(it);
      if (!sendTimer) sendTimer = setTimeout(() => { sendTimer = 0; sendMove(it.d); }, 50);
    } else if (drag.type === "resize") {
      drag.moved = true;
      if (it.d.kind === "image") {
        const ratio = drag.start.h / drag.start.w;
        const w = Math.max(40, Math.min(8000, drag.start.w + (pt.x - drag.from.x)));
        it.d.w = Math.round(w);
        it.d.h = Math.max(16, Math.round(w * ratio));
      } else {
        it.d.w = drag.start.w + (pt.x - drag.from.x);
        it.d.h = drag.start.h + (pt.y - drag.from.y);
      }
      draw(it);
      if (!sendTimer) sendTimer = setTimeout(() => { sendTimer = 0; sendMove(it.d); }, 50);
    }
  });

  function flushPen() {
    sendTimer = 0;
    if (!drag || drag.type !== "pen" || !drag.queue.length) return;
    while (drag.queue.length) live({ k: "pts", id: drag.id, p: drag.queue.splice(0, LIM.chunk) });
  }
  function flushMove() {
    sendTimer = 0;
    if (!drag || drag.type !== "move" || !drag.moved) return;
    for (const id of drag.starts.keys()) { const it = items.get(id); if (it) sendMove(it.d); }
  }
  // Rectangles and circles are kept with left/top first once they're finished.
  function tidyShape(d) {
    if (d.shape !== "rect" && d.shape !== "ellipse") return;
    const b = shapeBox(d);
    Object.assign(d, b);
  }
  function endDrag() {
    if (!drag) return;
    clearTimeout(sendTimer);
    sendTimer = 0;
    const it = drag.id ? items.get(drag.id) : null;
    if (drag.type === "pen") {
      flushPen();
      if (it) record({ t: "add", d: snapshot(it) });
    } else if (drag.type === "shape" && it) {
      if (Math.abs(it.d.w) < 4 && Math.abs(it.d.h) < 4) {              // a click, not a drag: make a default size
        const def = { rect: [160, 100], ellipse: [140, 100], line: [160, 0], arrow: [160, 0] }[it.d.shape];
        it.d.w = def[0]; it.d.h = def[1];
      }
      tidyShape(it.d);
      draw(it);
      sendMove(it.d);
      record({ t: "add", d: snapshot(it) });
    } else if (drag.type === "move") {
      flushMove();
      if (drag.moved) {
        const list = [];
        for (const [id, st] of drag.starts) {
          const m = items.get(id);
          if (m) list.push({ t: "move", id, from: st, to: { x: m.d.x, y: m.d.y } });
        }
        if (list.length) record(list.length === 1 ? list[0] : { t: "many", list });
      }
      for (const id of drag.starts.keys()) busy.delete(id);
    } else if (drag.type === "resize" && it) {
      if (it.d.kind === "shape") tidyShape(it.d);
      draw(it);
      sendMove(it.d);
      if (drag.moved) {
        const pick = o => ({ x: o.x, y: o.y, w: o.w, h: o.h });
        record({ t: "move", id: it.d.id, from: pick(drag.start), to: pick(it.d) });
      }
    } else if (drag.type === "erase" && drag.erased.length) {
      record(drag.erased.length === 1 ? drag.erased[0] : { t: "many", list: drag.erased });
    } else if (drag.type === "box") {
      marquee.hidden = true;
      if (drag.rect) {
        const r = drag.rect, picked = [];
        for (const m of items.values()) {
          if (m.el.style.display === "none" || !(m.d.by === me || state.isHost) || m.draft) continue;
          const b = itemBox(m);
          if (b.x < r.x1 && b.x + b.w > r.x0 && b.y < r.y1 && b.y + b.h > r.y0) picked.push(m.d.id);
        }
        setSel([...new Set([...drag.add, ...picked])]);
      }
    }
    if (drag.id) busy.delete(drag.id);
    viewport.classList.remove("panning");
    drag = null;
  }
  function cancelDrag() {
    if (!drag) return;
    if ((drag.type === "pen" && items.get(drag.id)?.d.p.length <= 4) || drag.type === "shape") {
      busy.delete(drag.id);                             // a stroke or shape just begun by the first finger
      deleteItem(drag.id);
      drag = null;
      return;
    }
    if (drag.type === "box") { marquee.hidden = true; drag = null; return; }
    endDrag();
  }
  const pointerUp = e => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    endDrag();
  };
  viewport.addEventListener("pointerup", pointerUp);
  viewport.addEventListener("pointercancel", pointerUp);
  viewport.addEventListener("dblclick", e => {
    const it = itemAt(e.target);
    if (it && it.d.by === me && it.d.kind === "text") startEdit(it.d.id);
    else if (!it && tool === "select") newText(toBoard(e), false);
  });

  // ---- Live cursors --------------------------------------------------------------------------
  // Everyone's pointer, as an arrow with their name. Sent about 15 times a second, never stored.
  const cursors = new Map();          // player id -> { el, timer }
  let curTimer = 0, curLast = null, curSent = "";
  function sendCursor() {
    curTimer = 0;
    if (!curLast) return;
    const key = curLast.off ? "off" : curLast.x + "," + curLast.y;
    if (key === curSent) return;
    curSent = key;
    live(curLast.off ? { k: "cur", off: true } : { k: "cur", x: curLast.x, y: curLast.y });
  }
  function trackCursor(e, off) {
    if (!state) return;
    curLast = off ? { off: true } : toBoard(e);
    if (!curTimer) curTimer = setTimeout(sendCursor, 66);
  }
  viewport.addEventListener("pointermove", e => { if (e.pointerType !== "touch" || drag) trackCursor(e); });
  viewport.addEventListener("pointerleave", e => trackCursor(e, true));
  function showCursor(m) {
    let c = cursors.get(m.by);
    if (m.off) { if (c) c.el.classList.add("idle"); return; }
    if (!c) {
      const el = document.createElement("div");
      el.className = "bd-cursor";
      el.innerHTML = '<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M1 1l13 9-6 1.2L5 18z"/></svg><span></span>';
      world.append(el);
      c = { el, timer: 0 };
      cursors.set(m.by, c);
    }
    c.el.style.setProperty("--pc", playerColour(m.by));
    c.el.querySelector("span").textContent = playerName(m.by);
    c.el.style.left = m.x + "px";
    c.el.style.top = m.y + "px";
    c.el.style.display = hidden.has(m.by) ? "none" : "";
    c.el.classList.remove("idle");
    clearTimeout(c.timer);
    c.timer = setTimeout(() => c.el.classList.add("idle"), 4000);
  }
  function syncCursors() {
    // Called after each room update: drop people who left, hide the ones hidden with the eye.
    for (const [pid, c] of cursors) {
      const p = state.players.find(x => x.id === pid);
      if (!p || !p.online) { c.el.remove(); clearTimeout(c.timer); cursors.delete(pid); continue; }
      c.el.style.display = hidden.has(pid) ? "none" : "";
      c.el.querySelector("span").textContent = p.name;
    }
  }

  // ---- Text and sticky notes -----------------------------------------------------------------
  let editTimer = 0;
  function newText(pt, isNote) {
    if (!roomFor("text")) return;
    const id = newId();
    const d = isNote
      ? { id, by: me, kind: "text", x: pt.x - 110, y: pt.y - 30, text: "", c: "#1f2328", s: NOTE_SIZE, bg: noteColour }
      : { id, by: me, kind: "text", x: pt.x, y: Math.round(pt.y - textSize / 2), text: "", c: ink, s: textSize };
    const it = applyItem(d);
    it.draft = true;                    // not sent until there's something in it
    startEdit(id);
  }
  function readText(el) {
    return el.innerText.replace(/\n$/, "").slice(0, LIM.text);
  }
  function startEdit(id) {
    const it = items.get(id);
    if (!it) return;
    if (editing && editing !== id) finishEdit();
    editing = id;
    editStart = { id, text: it.d.text, isNew: !!it.draft };
    busy.add(id);
    setSel([id]);
    const el = it.el;
    el.contentEditable = "true";
    el.spellcheck = true;
    el.classList.add("editing");
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }
  function sendText(it) {
    clearTimeout(editTimer);
    editTimer = 0;
    const text = readText(it.el);
    if (!text.trim() || text === it.d.text) return;
    it.d.text = text;
    if (it.draft) {
      it.draft = false;
      addItem(snapshot(it));
    } else live({ k: "edit", id: it.d.id, text });
  }
  function finishEdit() {
    const id = editing;
    const it = items.get(id);
    const start = editStart;
    editing = null;
    editStart = null;
    if (!it) return;
    busy.delete(id);
    it.el.contentEditable = "false";
    it.el.classList.remove("editing");
    const text = readText(it.el);
    if (!text.trim()) {
      const entry = deleteItem(id);                   // an emptied text box goes away
      if (entry && start && !start.isNew) record({ t: "del", d: { ...entry.d, text: start.text } });
      return;
    }
    sendText(it);
    draw(it);
    if (start && start.id === id) {
      if (start.isNew) record({ t: "add", d: snapshot(it) });
      else if (start.text !== it.d.text) record({ t: "edit", id, from: { text: start.text }, to: { text: it.d.text } });
    }
  }
  viewport.addEventListener("input", e => {
    const it = itemAt(e.target);
    if (!it || it.d.id !== editing) return;
    if (it.el.innerText.length > LIM.text) note(`A text box holds ${LIM.text} characters at most.`);
    clearTimeout(editTimer);
    editTimer = setTimeout(() => sendText(it), it.draft ? 0 : 180);    // everyone sees it as you type
  });
  viewport.addEventListener("keydown", e => {
    if (!editing) return;
    if (e.key === "Escape") { e.preventDefault(); finishEdit(); viewport.focus({ preventScroll: true }); }
    e.stopPropagation();                // typing in a text box: no tool shortcuts (Ctrl+Z undoes the typing)
  });
  document.addEventListener("pointerdown", e => {
    if (editing && !viewport.contains(e.target) && !e.target.closest(".bd-bar")) finishEdit();
  });

  // ---- Pictures ------------------------------------------------------------------------------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }
  function encode(img, scale, q = 0.82) {            // img: a picture or a canvas
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const webp = c.toDataURL("image/webp", 0.8).startsWith("data:image/webp");
    if (!webp) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); }        // jpeg has no see-through
    g.drawImage(img, 0, 0, w, h);
    return webp ? c.toDataURL("image/webp", q) : c.toDataURL("image/jpeg", q);
  }
  async function addImageFile(file, at) {
    if (!file || !/^image\//.test(file.type)) return;
    if (!roomFor("image")) return;
    if (file.size > 40e6) return note("That picture is too big to add.");
    note("Adding the picture…");
    let img;
    try { img = await loadImage(file); } catch { return note("That file couldn't be read as a picture."); }
    let scale = Math.min(1, IMG_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    let src = encode(img, scale);
    while (src.length > LIM.image - 1000 && scale > 0.05) {          // shrink until it fits the server's limit
      scale *= 0.75;
      src = encode(img, scale);
    }
    if (src.length > LIM.image) return note("That picture is too big to add.");
    if (!roomFor("image", src.length)) return;
    // First shown at up to about half the screen, at the current zoom.
    const show = Math.min(viewport.clientWidth, viewport.clientHeight) * 0.55 / cam.z;
    const fit = Math.min(1 / cam.z, show / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(40, Math.round(img.naturalWidth * fit)), h = Math.max(40, Math.round(img.naturalHeight * fit));
    const d = { id: newId(), kind: "image", x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h, src };
    addItem(d);
    record({ t: "add", d: { ...d } });
    note("");
    setTool("select");
    setSel([d.id]);
  }

  // ---- Documents: each page of a PDF or Word file becomes a picture everyone can write on ------
  // Done in the browser, so the server only ever sees pictures. The libraries load the first time.
  const DOC_MAX_PAGES = 30;
  const DOC_PAGE_PX = 1100;          // pages are drawn this many pixels wide (sharp enough to read when zoomed in)
  const DOC_SHOW_W = 600;            // how wide a page is on the board at 100% zoom
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const LIBS = {
    pdf: [PDFJS + "pdf.min.js"],
    docx: ["https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
           "https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js",
           "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"],
  };
  const scripts = {};
  function loadScript(src) {
    return scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; s.remove(); reject(new Error("couldn't load " + src)); };
      document.head.append(s);
    }));
  }
  async function loadLibs(kind) { for (const src of LIBS[kind]) await loadScript(src); }
  function docKind(f) {
    if (!f) return null;
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "pdf";
    if (/officedocument\.wordprocessingml/.test(f.type) || /\.docx$/i.test(f.name)) return "docx";
    if (f.type === "application/msword" || /\.doc$/i.test(f.name)) return "doc";
    return null;
  }
  const isAddable = f => f && (/^image\//.test(f.type) || docKind(f));
  function addFile(file, at) {
    if (docKind(file)) addDocFile(file, at);
    else addImageFile(file, at);
  }

  async function pdfPages(file, onPage) {
    await loadLibs("pdf");
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    try {
      const n = Math.min(pdf.numPages, DOC_MAX_PAGES);
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: DOC_PAGE_PX / page.getViewport({ scale: 1 }).width });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        const g = c.getContext("2d");
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp, intent: "print" }).promise;   // "print": keeps going in a background tab
        page.cleanup();
        if (!await onPage(c, i, n)) break;
      }
      return pdf.numPages;
    } finally {
      pdf.destroy();
    }
  }

  function blankPage(c) {                              // nothing but white (a page break can leave one)
    const s = document.createElement("canvas");
    s.width = 60; s.height = 85;
    const g = s.getContext("2d");
    g.drawImage(c, 0, 0, s.width, s.height);
    const px = g.getImageData(0, 0, s.width, s.height).data;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) return false;
    return true;
  }
  async function docxPages(file, onPage) {
    await loadLibs("docx");
    const box = document.createElement("div");
    box.className = "bd-docx-render";
    document.body.append(box);
    try {
      await docx.renderAsync(await file.arrayBuffer(), box, null,
        { inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: true });
      await document.fonts.ready;
      const sections = [...box.querySelectorAll("section.docx")];
      let made = 0, total = 0;
      const shots = [];
      for (const sec of sections) {
        const c = await html2canvas(sec, { backgroundColor: "#ffffff", scale: DOC_PAGE_PX / Math.max(1, sec.offsetWidth),
                                          logging: false, windowWidth: sec.scrollWidth + 40 });
        // A part of the document with no page breaks in it can be very long: cut it into A4-shaped pages.
        const pageH = Math.round(c.width * 1.414);
        for (let y = 0; y < c.height; y += pageH) {
          const h = Math.min(pageH, c.height - y);
          if (y && h < 60) break;
          shots.push([c, y, h]);
        }
        total = shots.length;
        if (total >= DOC_MAX_PAGES) break;
      }
      const n = Math.min(total, DOC_MAX_PAGES);
      const pages = [];
      for (const [c, y, h] of shots.slice(0, n)) {
        const p = document.createElement("canvas");
        p.width = c.width;
        p.height = h;
        p.getContext("2d").drawImage(c, 0, y, c.width, h, 0, 0, c.width, h);
        if (!blankPage(p)) pages.push(p);
      }
      total -= n - pages.length;
      for (const p of pages) if (!await onPage(p, ++made, pages.length)) break;
      return total;
    } finally {
      box.remove();
    }
  }

  let docBusy = false;
  async function addDocFile(file, at) {
    const kind = docKind(file);
    if (kind === "doc") return note("Old .doc files can't be read. Open it in Word and save it as .docx or PDF, then add that.");
    if (docBusy) return note("Still adding the last document. Try again when it's done.");
    if (file.size > 60e6) return note("That document is too big to add.");
    if (!roomFor("image")) return;
    docBusy = true;
    note("Opening the document…");
    // Pages show about 600 px wide on screen (less on a phone), whatever the zoom.
    const w = Math.round(Math.max(100, Math.min(4000, Math.min(DOC_SHOW_W, viewport.clientWidth * 0.85) / cam.z)));
    const x = Math.round(at.x - w / 2);
    let y = Math.round(at.y - viewport.clientHeight * 0.35 / cam.z);
    const added = [], ids = [];
    // The file name goes above the first page, so everyone knows what it is.
    if (roomFor("text")) {
      const label = { id: newId(), kind: "text", x, y, text: file.name.slice(0, 120), c: ink, s: 24 };
      addItem(label);
      added.push({ t: "add", d: { ...label } });
      ids.push(label.id);
      y += 44;
    }
    let total = 0, full = false;
    const onPage = (c, i, n) => {
      note(`Adding page ${i} of ${n}…`);
      let scale = 1, src = encode(c, scale, 0.75);
      while (src.length > LIM.image - 1000 && scale > 0.2) {
        scale *= 0.8;
        src = encode(c, scale, 0.75);
      }
      if (src.length > LIM.image || !roomFor("image", src.length)) { full = true; return false; }
      const h = Math.round(w * c.height / c.width);
      const d = { id: newId(), kind: "image", x, y, w, h, src };
      addItem(d);
      added.push({ t: "add", d: { ...d } });
      ids.push(d.id);
      y += h + 24;
      return new Promise(r => setTimeout(() => r(true), 30));      // let the page breathe between pages
    };
    try {
      total = kind === "pdf" ? await pdfPages(file, onPage) : await docxPages(file, onPage);
      const pages = added.filter(a => a.d.kind === "image").length;
      if (!pages) note(full ? "There's no room left for pictures on this board. Delete some first." : "That document has no pages to show.");
      else if (full) note(`Added ${pages} page${pages === 1 ? "" : "s"}, then the board ran out of room for pictures.`);
      else if (total > pages) note(`Added the first ${pages} pages (of ${total}). A board takes ${DOC_MAX_PAGES} pages of one document at a time.`);
      else note(`Added ${pages} page${pages === 1 ? "" : "s"}. Everyone can write and draw on ${pages === 1 ? "it" : "them"}.`);
    } catch (e) {
      console.warn(e);
      note(/couldn't load/.test(e.message) ? "Couldn't load the document reader. Check your internet and try again."
        : /password/i.test(e.message || e.name) ? "That PDF has a password, so it can't be added."
        : "That document couldn't be read.");
    } finally {
      docBusy = false;
    }
    if (added.length) {
      record(added.length === 1 ? added[0] : { t: "many", list: added });
      setTool("select");
      setSel(ids);
    }
  }

  const typing = e => e.target.closest && e.target.closest("input, textarea, select, [contenteditable='true']");
  document.addEventListener("copy", e => {
    if (!state || $("gameView").hidden || editing || typing(e) || getSelection().toString()) return;
    if (!copySelected()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", CLIP_MARK + clipToken);
  });
  document.addEventListener("cut", e => {
    if (!state || $("gameView").hidden || editing || typing(e) || getSelection().toString()) return;
    if (!copySelected()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", CLIP_MARK + clipToken);
    const own = new Set(ownSel().map(it => it.d.id));
    setSel([...own]);
    deleteSelected();
  });
  document.addEventListener("paste", e => {
    if (!state || $("gameView").hidden) return;
    const files = [...(e.clipboardData?.files || [])].filter(isAddable);
    if (editing) {
      e.preventDefault();               // paste into a text box as plain text
      const text = e.clipboardData.getData("text/plain");
      if (text) document.execCommand("insertText", false, text);
      return;
    }
    if (e.target.closest && e.target.closest("input, textarea")) return;
    const text = e.clipboardData.getData("text/plain");
    if (clip && text === CLIP_MARK + clipToken) {      // our own copied things
      e.preventDefault();
      pasteCount++;
      placeCopies(clip, 30 * pasteCount, 30 * pasteCount);
      return;
    }
    if (files.length) {
      e.preventDefault();
      const c = viewCentre();
      files.forEach((f, i) => addFile(f, { x: c.x + i * 40, y: c.y + i * 40 }));
      return;
    }
    if (text && text.trim() && !text.startsWith(CLIP_MARK) && roomFor("text")) {
      e.preventDefault();
      const c = viewCentre();
      const d = { id: newId(), kind: "text", x: Math.round(c.x - 100 / cam.z), y: c.y, text: text.slice(0, LIM.text), c: ink, s: textSize };
      addItem(d);
      record({ t: "add", d: { ...d } });
    }
  });

  let dragDepth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
  viewport.addEventListener("dragenter", e => {
    if (!hasFiles(e)) return;
    dragDepth++;
    $("dropHint").hidden = false;
  });
  viewport.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("dropHint").hidden = true; } });
  viewport.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  viewport.addEventListener("drop", e => {
    e.preventDefault();
    dragDepth = 0;
    $("dropHint").hidden = true;
    const at = toBoard(e);
    [...e.dataTransfer.files].filter(isAddable)
      .forEach((f, i) => addFile(f, { x: at.x + i * 40, y: at.y + i * 40 }));
  });
  $("addImage").addEventListener("click", () => $("imageFile").click());
  $("imageFile").addEventListener("change", () => {
    const f = $("imageFile").files[0];
    $("imageFile").value = "";
    if (f) addFile(f, viewCentre());
  });

  // ---- Download the board as a picture -------------------------------------------------------
  // Drawn again on a canvas from the items themselves (what you can see: hidden players are left out).
  function wrapLines(g, text, maxW) {
    const out = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        if (g.measureText(line + word).width <= maxW || !line.trim()) {
          line += word;
          while (g.measureText(line).width > maxW && line.length > 1) {      // one very long word
            let cut = line.length - 1;
            while (cut > 1 && g.measureText(line.slice(0, cut)).width > maxW) cut--;
            out.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        } else {
          out.push(line.trimEnd());
          line = word.trimStart();
        }
      }
      out.push(line);
    }
    return out;
  }
  function downloadPicture() {
    const b = visibleBounds();
    if (!b) return note("There's nothing on the board to download yet.");
    const pad = 40, w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2;
    const scale = Math.min(2, 8000 / Math.max(w, h), Math.sqrt(40e6 / (w * h)));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const g = c.getContext("2d");
    g.fillStyle = "#fbfaf7";
    g.fillRect(0, 0, c.width, c.height);
    g.setTransform(scale, 0, 0, scale, (pad - b.x0) * scale, (pad - b.y0) * scale);
    for (const el of world.querySelectorAll(".bd-item")) {
      const it = items.get(el.dataset.id);
      if (!it || el.style.display === "none") continue;
      const d = it.d;
      g.save();
      if (d.kind === "image") {
        g.drawImage(el.firstChild, d.x, d.y, d.w, d.h);
      } else if (d.kind === "text") {
        const box = itemBox(it), note = !!d.bg, inset = note ? 16 : 4;
        if (note) {
          g.shadowColor = "rgba(0,0,0,.18)"; g.shadowBlur = 10; g.shadowOffsetY = 3;
          g.fillStyle = d.bg;
          g.fillRect(d.x, d.y, box.w, box.h);
          g.shadowColor = "transparent";
        }
        g.font = `500 ${d.s}px ${FONT}`;
        g.fillStyle = d.c;
        g.textBaseline = "top";
        const lh = d.s * 1.25;
        wrapLines(g, d.text, box.w - inset * 2).forEach((line, i) => g.fillText(line, d.x + inset, d.y + (note ? inset : 2) + i * lh + (lh - d.s) / 2));
      } else {
        const path = new Path2D(el.children[1].getAttribute("d"));
        g.lineCap = g.lineJoin = "round";
        g.strokeStyle = d.c;
        if (d.kind === "pen") {
          g.translate(d.x, d.y);
          g.lineWidth = d.w;
          if (d.hl) { g.globalAlpha = 0.4; g.globalCompositeOperation = "multiply"; g.lineCap = "butt"; }
        } else {
          g.lineWidth = d.sw;
          if (d.fill) { g.globalAlpha = 0.18; g.fillStyle = d.c; g.fill(path); g.globalAlpha = 1; }
        }
        g.stroke(path);
      }
      g.restore();
    }
    c.toBlob(blob => {
      if (!blob) return note("The picture couldn't be made. Try zooming in on part of the board.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ace-board-${room || "board"}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, "image/png");
  }
  $("downloadBtn").addEventListener("click", downloadPicture);

  // ---- Toolbar -------------------------------------------------------------------------------
  function setTool(t) {
    if (editing) finishEdit();
    tool = t;
    viewport.dataset.tool = t;
    document.querySelectorAll("#tools .tb").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
    if (t !== "select" && sel.size) setSel([]);
    syncToolbar();
  }
  // What the colour buttons change: sticky notes' paper, highlighter, or ink (text, pen, shapes).
  function paletteMode() {
    const own = ownSel();
    if (tool === "note" || (own.length && own.every(it => it.d.bg))) return "note";
    if (tool === "hl" || (own.length && own.every(it => it.d.hl))) return "hl";
    return "ink";
  }
  function button(cls, title, inner, on, click) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls + (on ? " on" : "");
    b.title = title;
    b.setAttribute("aria-label", title);
    if (inner instanceof Node) b.append(inner); else b.innerHTML = inner;
    b.addEventListener("click", click);
    return b;
  }
  const SHAPE_ICONS = {
    rect: ['Box', '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>'],
    ellipse: ['Circle', '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8" ry="6"/></svg>'],
    line: ['Line', '<svg viewBox="0 0 24 24"><path d="M5 19L19 5"/></svg>'],
    arrow: ['Arrow', '<svg viewBox="0 0 24 24"><path d="M5 19L19 5M10 5h9v9"/></svg>'],
  };
  function syncToolbar() {
    const own = ownSel();
    const one = own.length === 1 ? own[0] : null;
    const mode = paletteMode();
    // Colours
    const palette = mode === "note" ? NOTES : mode === "hl" ? HL : INK;
    const current = one ? (one.d.bg || one.d.c) : mode === "note" ? noteColour : mode === "hl" ? hlColour : ink;
    const sw = $("swatches");
    sw.innerHTML = "";
    sw.hidden = tool === "eraser" || (tool === "select" && sel.size && !own.some(it => it.d.kind !== "image"));
    for (const c of palette) {
      const b = button("sw", (mode === "note" ? "Note colour " : "Colour ") + c, "", c === current, () => pickColour(c));
      b.style.setProperty("--c", c);
      sw.append(b);
    }
    // Sizes and shape options
    const box = $("sizes");
    box.innerHTML = "";
    const sizeButtons = (list, cur, label, dot, set) => list.forEach(v => {
      const i = document.createElement("i");
      dot(i, v);
      box.append(button("tb sz", `${label} ${v}`, i, v === cur, () => { set(v); syncToolbar(); }));
    });
    const textItem = one && one.d.kind === "text" ? one : null;
    if (tool === "pen") sizeButtons(PEN_SIZES, penSize, "Pen size", (i, v) => { i.style.width = i.style.height = Math.min(22, v + 2) + "px"; }, v => { penSize = v; });
    else if (tool === "hl") sizeButtons(HL_SIZES, hlSize, "Highlighter size", (i, v) => { i.className = "bar"; i.style.height = Math.round(v / 2.2) + "px"; }, v => { hlSize = v; });
    else if (tool === "shape") {
      for (const [k, [name, icon]] of Object.entries(SHAPE_ICONS)) box.append(button("tb", name, icon, k === shapeKind, () => { shapeKind = k; syncToolbar(); }));
      if (shapeKind === "rect" || shapeKind === "ellipse") {
        box.append(button("tb", shapeFill ? "Filled (click for outline only)" : "Outline only (click to fill)",
          `<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" ${shapeFill ? 'fill="currentColor" fill-opacity=".35"' : ""}/></svg>`,
          shapeFill, () => { shapeFill = !shapeFill; syncToolbar(); }));
      }
      sizeButtons(SHAPE_SIZES, shapeSize, "Line thickness", (i, v) => { i.className = "bar"; i.style.height = v + 1 + "px"; }, v => { shapeSize = v; });
    } else if (tool === "text" || textItem) {
      const cur = textItem ? textItem.d.s : textSize;
      sizeButtons(TEXT_SIZES.concat(textItem && textItem.d.bg && !TEXT_SIZES.includes(cur) ? [cur] : []).sort((a, b) => a - b), cur, "Text size",
        (i, v) => { i.className = "t"; i.textContent = "A"; i.style.fontSize = Math.round(11 + (v - 18) / 3) + "px"; },
        v => {
          if (!textItem) { textSize = v; return; }
          if (textItem.d.s === v) return;
          if (!textItem.draft) record({ t: "edit", id: textItem.d.id, from: { s: textItem.d.s }, to: { s: v } });
          editItem(textItem.d.id, { s: v });
        });
    }
    box.hidden = !box.children.length;
  }
  function pickColour(c) {
    const mode = paletteMode();
    if (mode === "note") noteColour = c; else if (mode === "hl") hlColour = c; else ink = c;
    // Change your selected things too (pictures have no colour).
    const changes = [];
    for (const it of ownSel()) {
      if (it.d.kind === "image") continue;
      const key = it.d.bg ? "bg" : "c";
      if ((mode === "note") !== !!it.d.bg || it.d[key] === c) continue;
      if ((mode === "hl") !== !!it.d.hl && it.d.kind === "pen") continue;
      if (!it.draft) changes.push({ t: "edit", id: it.d.id, from: { [key]: it.d[key] }, to: { [key]: c } });
      editItem(it.d.id, { [key]: c });
    }
    if (changes.length) record(changes.length === 1 ? changes[0] : { t: "many", list: changes });
    syncToolbar();
    if (editing) items.get(editing)?.el.focus({ preventScroll: true });
  }
  document.querySelectorAll("#tools .tb").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  $("dupBtn").addEventListener("click", duplicateSelected);
  $("delBtn").addEventListener("click", deleteSelected);
  // Colour and size buttons shouldn't take focus away from a text box being typed in.
  document.querySelector(".bd-bar").addEventListener("pointerdown", e => {
    if (editing && e.target.closest(".sw, .sz")) e.preventDefault();
  });

  document.addEventListener("keydown", e => {
    if (!state || $("gameView").hidden || editing) return;
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === "d") { e.preventDefault(); duplicateSelected(); }
      else if (k === "a") { e.preventDefault(); setTool("select"); setSel([...items.values()].filter(it => it.d.by === me && it.el.style.display !== "none").map(it => it.d.id)); }
      else if (k === "=" || k === "+") { e.preventDefault(); zoomAt(cam.z * 1.25); }
      else if (k === "-") { e.preventDefault(); zoomAt(cam.z / 1.25); }
      else if (k === "0") { e.preventDefault(); fitAll(); }
      return;
    }
    if (e.altKey) return;
    if (e.key === " ") { spaceDown = true; viewport.classList.add("can-pan"); e.preventDefault(); return; }
    const keys = { v: "select", t: "text", n: "note", p: "pen", h: "hl", s: "shape", e: "eraser" };
    if (keys[k]) { setTool(keys[k]); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && sel.size) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === "Escape") setSel([]);
    else if (e.key === "Home") recentre();
    else if (e.key === "Enter" && sel.size === 1) {
      const [it] = selItems();
      if (it.d.by === me && it.d.kind === "text") { e.preventDefault(); startEdit(it.d.id); }
    }
  });
  document.addEventListener("keyup", e => {
    if (e.key === " ") { spaceDown = false; viewport.classList.remove("can-pan"); }
  });

  // ---- Floating panel, full screen -----------------------------------------------------------
  function setPanel(open) {
    $("panel").hidden = !open;
    $("panelBtn").setAttribute("aria-expanded", String(open));
    $("panelBtn").title = open ? "Hide the players panel" : "Show the players panel";
  }
  $("panelBtn").addEventListener("click", () => setPanel($("panel").hidden));
  $("fullBtn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => note("Your browser didn't allow full screen."));
  });
  document.addEventListener("fullscreenchange", () => {
    $("fullBtn").classList.toggle("on", !!document.fullscreenElement);
    $("fullBtn").title = document.fullscreenElement ? "Leave full screen" : "Full screen";
  });
  if (!document.documentElement.requestFullscreen) $("fullBtn").hidden = true;    // e.g. iPhone Safari

  const EYE_OPEN = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_SHUT = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  function renderPanel() {
    if (!state) return;
    if (state.board) {
      $("roomCode").textContent = state.board.name;
      $("boardTitle").textContent = state.board.name;
      $("boardLink").value = boardLink(state.board.slug);
      document.title = state.board.name + " · ACE Board";
    }
    $("deleteBoard").hidden = !state.isOwner;
    const mine = state.players.find(p => p.id === me);
    $("myName").textContent = mine ? mine.name : AceLive.name();
    const counts = {};
    for (const it of items.values()) if (!it.draft) counts[it.d.by] = (counts[it.d.by] || 0) + 1;
    const list = $("players");
    list.innerHTML = "";
    // People in the room, then anyone whose things are on a saved board but who isn't here.
    const people = [...state.players].sort((a, b) => (b.id === me) - (a.id === me) || b.online - a.online)
      .concat(Object.entries(state.authors || {}).map(([id, name]) => ({ id, name, online: false, absent: true })));
    for (const p of people) {
      const li = document.createElement("li");
      li.className = "bd-player" + (p.online ? "" : " away") + (hidden.has(p.id) ? " off" : "");
      li.append(FX.avatar(p.name, colourIndex(p.id), "sm"));
      const name = document.createElement("span");
      name.className = "bd-pname";
      name.textContent = p.name + (p.id === me ? " (you)" : "") + (p.absent ? " · not here" : p.online ? "" : " · away");
      const n = document.createElement("span");
      n.className = "muted small";
      n.textContent = counts[p.id] ? String(counts[p.id]) : "";
      n.title = "Things on the board";
      const off = hidden.has(p.id);
      const eye = button("eye", (off ? "Show " : "Hide ") + (p.id === me ? "your" : p.name + "'s") + " writing", off ? EYE_SHUT : EYE_OPEN, false, () => {
        if (hidden.has(p.id)) hidden.delete(p.id); else hidden.add(p.id);
        setSel([...sel].filter(id => items.get(id)?.d.by !== p.id));
        for (const it of items.values()) if (it.d.by === p.id) draw(it);
        syncCursors();
        renderPanel();
      });
      eye.setAttribute("aria-pressed", String(!off));
      li.append(name, n, eye);
      list.append(li);
    }
    const here = state.players.filter(p => p.online).length;
    $("playerCount").textContent = `${here} here` + (hidden.size ? ` · ${hidden.size} hidden` : "");
    $("showAll").hidden = !hidden.size;
    $("clearAll").hidden = !state.isHost;
    syncCursors();
    const pics = [...items.values()].filter(i => i.d.kind === "image").length;
    $("boardInfo").textContent = `${items.size} thing${items.size === 1 ? "" : "s"} on the board, ${pics} picture${pics === 1 ? "" : "s"}.`
      + (state.isHost ? " As leader you can also select and delete anyone's things." : "");
  }

  function initPanel() {
    $("showAll").addEventListener("click", () => {
      hidden.clear();
      for (const it of items.values()) draw(it);
      syncCursors();
      renderPanel();
    });
    $("clearMine").addEventListener("click", () => {
      if (!confirm("Delete everything you've put on this board? You can undo it with Ctrl+Z.")) return;
      const list = [];
      for (const it of [...items.values()]) {
        if (it.d.by !== me || it.draft) continue;
        list.push({ t: "del", d: snapshot(it) });
        gone.set(it.d.id, Date.now());
        removeItem(it.d.id);
      }
      if (list.length) record({ t: "many", list });
      action("clear_mine");
      renderPanel();
    });
    $("clearAll").addEventListener("click", () => {
      if (confirm("Clear the whole board for everyone? This can't be undone.")) action("clear_all");
    });
    $("renameForm").addEventListener("submit", e => {
      e.preventDefault();
      const n = $("renameInput").value.trim();
      if (!n) return;
      AceLive.setName(n);
      action("rename", { name: n });
      $("renameForm").hidden = true;
    });
    $("renameBtn").addEventListener("click", () => {
      $("renameForm").hidden = !$("renameForm").hidden;
      $("renameInput").value = AceLive.name();
      if (!$("renameForm").hidden) $("renameInput").focus();
    });
    $("copyInvite").addEventListener("click", () => {
      $("boardLink").select();
      copyText($("boardLink").value, msg => { $("inviteNote").textContent = msg; });
    });
    $("boardLink").addEventListener("focus", () => $("boardLink").select());
    $("deleteBoard").addEventListener("click", () => {
      const name = state && state.board ? state.board.name : "this board";
      if (confirm(`Delete "${name}" for everyone? Everything on it is gone for good, and it leaves the list.`)) action("delete_board");
    });
  }

  setTool("select");
  syncUndo();
  initPanel();
  initStart();
})();
