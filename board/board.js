// ACE Board: a shared live whiteboard with no edges. The server (server/games/board.py) keeps every item
// on the board (text boxes, pen lines and pictures) and checks that people only change their own. Changes
// travel as small "live" messages, the same way Sketch & Guess sends lines, so typing and drawing show up
// straight away. The full room update carries the whole board only when this tab doesn't have it yet;
// otherwise it lists the item ids, so we can drop anything stale and ask again if we missed something.
//
// Each item is its own element (text: a div, picture: a div with an img, line: an svg) inside one "world"
// element that is moved and scaled to pan and zoom. Hiding a player's writing (the eye) just hides their
// elements, on this screen only. Undo (Ctrl+Z) keeps a list of your own changes and sends the reverse.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const FX = window.AceFX;
  const LIM = { items: 1500, text: 3000, images: 60, image: 700000, imageTotal: 15000000, stroke: 6000, chunk: 400 };
  const COLOURS = ["#1f2328", "#e5484d", "#f76b15", "#d6a100", "#2f9e44", "#12a594", "#3e63dd", "#8e4ec6", "#d6409f", "#ffffff"];
  const PEN_SIZES = [3, 6, 12, 24];
  const TEXT_SIZES = [18, 24, 36, 56];
  const ZMIN = 0.1, ZMAX = 4;
  const IMG_MAX_SIDE = 1600;        // pictures are shrunk to this before sending
  const HISTORY = 100;              // how many of your changes Ctrl+Z remembers
  const cleanRoom = v => String(v || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const newId = () => {
    const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), b => abc[b % abc.length]).join("");
  };
  const SVGNS = "http://www.w3.org/2000/svg";

  let socket = null, state = null, me = "", room = null;
  const items = new Map();          // id -> { d: item data, el }
  const pending = new Set();        // ids we added that the server hasn't confirmed yet
  const gone = new Map();           // id -> when we deleted it (so an older room update doesn't bring it back)
  const busy = new Set();           // ids being dragged, drawn or typed in right now
  const hidden = new Set();         // players whose writing is hidden on this screen
  let tool = "select", colour = COLOURS[0], penSize = 6, textSize = 24;
  let selected = null, editing = null, editStart = null, lastResync = 0, noteTimer = 0;
  const cam = { x: -60, y: -60, z: 1 };    // board point at the top-left of the screen, and the zoom

  const world = $("world"), viewport = $("viewport");

  // ---- Start screen --------------------------------------------------------------------------
  function startError(msg) {
    $("startError").textContent = msg || "";
    $("startError").hidden = !msg;
  }
  function showStart(code, error) {
    $("gameView").hidden = true;
    $("startView").hidden = false;
    document.body.classList.remove("on-board");
    history.replaceState(null, "", code ? "?room=" + code : location.pathname);
    $("roomInput").value = code || "";
    $("playerName").value = AceLive.name();
    startError(error);
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
  function initStart() {
    FX.soundButton();
    AceLive.isOnline().then(up => {
      const st = $("serverStatus");
      st.className = "server-status " + (up ? "up" : "down");
      st.textContent = up ? "Game server is online."
        : "Game server is offline right now. Boards work while it's running on the ACE host's PC.";
      $("createBtn").disabled = !up;
      $("joinBtn").disabled = !up;
    });
    $("onlineForm").addEventListener("submit", e => {
      e.preventDefault();
      if (needName()) play({ create: true });
    });
    $("joinBtn").addEventListener("click", () => {
      const code = cleanRoom($("roomInput").value);
      if (code.length !== 4) return startError("Room codes are 4 letters, like KQTZ.");
      if (!needName()) return;
      play({ room: code });
    });
    $("roomInput").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); $("joinBtn").click(); }
    });
    const code = cleanRoom(new URLSearchParams(location.search).get("room"));
    if (code && AceLive.name() && window.io) play({ room: code });
    else showStart(code);
  }

  // ---- Connection ----------------------------------------------------------------------------
  let playing = false;
  function play(opts) {
    if (playing) return;
    playing = true;
    room = opts.room || null;
    let create = !!opts.create;
    $("startView").hidden = true;
    $("gameView").hidden = false;
    document.body.classList.add("on-board");
    setPanel(innerWidth > 900);
    applyCam();
    socket = AceLive.connect();
    const setConn = msg => { $("connNote").textContent = msg || ""; $("connNote").hidden = !msg; };
    const fail = msg => {
      socket.disconnect();
      playing = false;
      clearBoard();
      showStart(room, msg);
    };
    function enter() {
      const base = { playerId: AceLive.playerId(), name: AceLive.name() };
      if (create) {
        socket.timeout(8000).emit("create", { ...base, game: "board", options: {} }, (err, res) => {
          if (err) return fail("The game server didn't answer. Try again in a moment.");
          if (res.error) return fail(res.error);
          create = false;
          room = res.room;
          history.replaceState(null, "", "?room=" + room);
        });
      } else {
        history.replaceState(null, "", "?room=" + room);
        socket.timeout(8000).emit("join", { ...base, room }, (err, res) => {
          if (err) return setConn("Can't reach the game server. Retrying…");
          if (res.error) return fail(res.error);
          if (res.game && res.game !== "board") {
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
    state = s;
    me = s.you;
    room = s.room;
    if (s.limits) Object.assign(LIM, s.limits);
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
    renderPanel();
  }

  function onLive(m) {
    if (m.k === "cur") return showCursor(m);
    if (m.k === "add") { if (!gone.has(m.item.id)) applyItem(m.item); renderPanel(); return; }
    const it = items.get(m.id);
    if (!it) return;
    const d = it.d;
    if (m.k === "pts") d.p.push(...m.p);
    else if (m.k === "move") { d.x = m.x; d.y = m.y; if (m.w) { d.w = m.w; d.h = m.h; } }
    else if (m.k === "edit") { for (const k of ["text", "c", "s"]) if (k in m) d[k] = m[k]; }
    else if (m.k === "del") { removeItem(m.id); renderPanel(); return; }
    draw(it);
  }

  // ---- Drawing items -------------------------------------------------------------------------
  function playerName(pid) {
    const p = state && state.players.find(x => x.id === pid);
    return p ? p.name : "Someone";
  }
  function playerColour(pid) {
    const n = state && state.colours ? state.colours[pid] : 0;
    return FX.color(n ?? 0);
  }

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
        el = document.createElementNS(SVGNS, "svg");
        const hit = document.createElementNS(SVGNS, "path"), line = document.createElementNS(SVGNS, "path");
        hit.setAttribute("class", "hit");
        el.append(hit, line);
      }
      el.dataset.id = d.id;
      el.classList.add("bd-item", "bd-" + d.kind);
      it = { d: { ...d, p: d.p ? [...d.p] : undefined }, el };
      items.set(d.id, it);
      world.append(el);
    } else {
      Object.assign(it.d, d, d.p ? { p: [...d.p] } : {});
    }
    draw(it);
    return it;
  }

  function draw(it) {
    const d = it.d, el = it.el;
    const mine = d.by === me;
    el.classList.toggle("mine", mine);
    el.classList.toggle("sel", selected === d.id);
    el.style.setProperty("--pc", playerColour(d.by));
    if (d.kind === "pen") el.setAttribute("aria-label", "Drawing by " + playerName(d.by));
    else el.title = (d.kind === "image" ? "Picture" : "Text") + " by " + playerName(d.by) + (mine ? " (you)" : "");
    el.style.display = hidden.has(d.by) ? "none" : "";
    if (d.kind === "text") {
      el.style.left = d.x + "px";
      el.style.top = d.y + "px";
      el.style.color = d.c;
      el.style.fontSize = d.s + "px";
      el.classList.toggle("light", isLight(d.c));
      if (editing !== d.id && el.textContent !== d.text) el.textContent = d.text;
    } else if (d.kind === "image") {
      Object.assign(el.style, { left: d.x + "px", top: d.y + "px", width: d.w + "px", height: d.h + "px" });
      const img = el.firstChild;
      if (img.getAttribute("src") !== d.src) img.src = d.src;
      let handle = el.querySelector(".bd-handle");
      if (mine && selected === d.id && !handle) {
        handle = document.createElement("span");
        handle.className = "bd-handle";
        el.append(handle);
      } else if (handle && !(mine && selected === d.id)) handle.remove();
    } else {
      const p = d.p, pad = d.w / 2 + 8;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
        y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
      }
      const bw = x1 - x0 + pad * 2, bh = y1 - y0 + pad * 2;
      el.setAttribute("viewBox", `${x0 - pad} ${y0 - pad} ${bw} ${bh}`);
      el.setAttribute("width", bw);
      el.setAttribute("height", bh);
      el.style.left = (x0 - pad + d.x) + "px";
      el.style.top = (y0 - pad + d.y) + "px";
      let path = `M${p[0]} ${p[1]}`;
      if (p.length === 2) path += `l0.01 0`;                      // a single tap: a dot
      for (let i = 2; i < p.length; i += 2) path += `L${p[i]} ${p[i + 1]}`;
      const [hit, line] = el.children;
      hit.setAttribute("d", path);
      hit.setAttribute("stroke-width", Math.max(d.w, 16));
      line.setAttribute("d", path);
      line.setAttribute("stroke", d.c);
      line.setAttribute("stroke-width", d.w);
    }
  }
  const isLight = c => {
    const n = parseInt(c.slice(1), 16);
    return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 200;
  };

  function removeItem(id) {
    const it = items.get(id);
    if (!it) return;
    it.el.remove();
    items.delete(id);
    if (selected === id) { selected = null; syncToolbar(); }
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
  function deleteItem(id) {
    const it = items.get(id);
    if (!it || it.d.by !== me) return null;
    const snap = snapshot(it);
    if (!it.draft) live({ k: "del", id });
    gone.set(id, Date.now());
    removeItem(id);
    renderPanel();
    return it.draft ? null : snap;
  }
  function moveItem(id, to) {
    const it = items.get(id);
    if (!it) return;
    Object.assign(it.d, to);
    draw(it);
    live(it.d.kind === "image" ? { k: "move", id, x: it.d.x, y: it.d.y, w: it.d.w, h: it.d.h } : { k: "move", id, x: it.d.x, y: it.d.y });
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
  function select(id) {
    const before = selected;
    selected = id;
    for (const x of [before, id]) if (x && items.has(x)) draw(items.get(x));
    syncToolbar();
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
    select(null);
    run(e, true);
    redoList.push(e);
    syncUndo();
  }
  function redo() {
    if (editing) finishEdit();
    const e = redoList.pop();
    if (!e) return;
    select(null);
    run(e, false);
    undoList.push(e);
    syncUndo();
  }
  $("undoBtn").addEventListener("click", undo);
  $("redoBtn").addEventListener("click", redo);

  // ---- Limits (the server checks them too; checking here gives a clear message) -------------
  function roomFor(kind, chars = 0) {
    if (items.size >= LIM.items) { note("The board is full. Clear some things first."); return false; }
    if (kind === "image") {
      const pics = [...items.values()].filter(i => i.d.kind === "image");
      if (pics.length >= LIM.images) { note(`The board holds ${LIM.images} pictures at most. Delete some first.`); return false; }
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
  function fitAll() {
    // Show everything that's on the board (or go back to the start if it's empty).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items.values()) {
      if (it.el.style.display === "none") continue;
      const r = { x: parseFloat(it.el.style.left), y: parseFloat(it.el.style.top),
                  w: it.el.offsetWidth || +it.el.getAttribute("width") || 0, h: it.el.offsetHeight || +it.el.getAttribute("height") || 0 };
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    if (!isFinite(x0)) { cam.z = 1; cam.x = -60; cam.y = -60; applyCam(); return; }
    const pad = 80;
    cam.z = Math.max(ZMIN, Math.min(1, Math.min(vw / (x1 - x0 + pad * 2), vh / (y1 - y0 + pad * 2))));
    cam.x = (x0 + x1) / 2 - vw / 2 / cam.z;
    cam.y = (y0 + y1) / 2 - vh / 2 / cam.z;
    applyCam();
  }
  viewport.addEventListener("wheel", e => {
    e.preventDefault();
    const { sx, sy } = screenPt(e);
    if (e.ctrlKey || e.metaKey) zoomAt(cam.z * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), sx, sy);
    else {
      const k = e.deltaMode ? 30 : 1;
      cam.x += (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k / cam.z;
      cam.y += (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k / cam.z;
      applyCam();
    }
  }, { passive: false });
  $("zoomIn").addEventListener("click", () => zoomAt(cam.z * 1.25));
  $("zoomOut").addEventListener("click", () => zoomAt(cam.z / 1.25));
  $("zoomLabel").addEventListener("click", fitAll);

  // ---- Pointer: select/move, text, pen, eraser, pan, pinch -----------------------------------
  let drag = null;           // what the pointer is doing right now
  let sendTimer = 0, spaceDown = false;
  const touches = new Map(); // pointer id -> last position, for two-finger pan and pinch
  let pinch = null;

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
    viewport.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown)) { e.preventDefault(); startPan(e); return; }
    if (e.button > 0) return;
    const pt = toBoard(e);
    const it = itemAt(target);

    if (tool === "pen") {
      e.preventDefault();
      if (!roomFor("pen")) return;
      const d = { id: newId(), kind: "pen", x: 0, y: 0, c: colour, w: penSize, p: [pt.x, pt.y] };
      addItem(d);
      busy.add(d.id);
      drag = { type: "pen", id: d.id, queue: [], last: pt };
    } else if (tool === "eraser") {
      e.preventDefault();
      drag = { type: "erase", erased: [] };
      if (it) erase(it);
    } else if (tool === "text") {
      e.preventDefault();
      if (it && it.d.by === me && it.d.kind === "text") startEdit(it.d.id);
      else newText(pt);
    } else {                                    // select
      if (it && it.d.by === me) {
        e.preventDefault();
        select(it.d.id);
        busy.add(it.d.id);
        const resize = target.classList.contains("bd-handle");
        drag = { type: resize ? "resize" : "move", id: it.d.id, from: pt, start: { x: it.d.x, y: it.d.y, w: it.d.w, h: it.d.h }, moved: false };
      } else {
        select(null);
        startPan(e);
      }
    }
  });

  function erase(it) {
    if (!it || it.d.by !== me) return;
    const snap = deleteItem(it.d.id);
    if (snap && drag && drag.erased) drag.erased.push({ t: "del", d: snap });
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
    const pt = toBoard(e);
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
    } else if (drag.type === "move") {
      const dx = pt.x - drag.from.x, dy = pt.y - drag.from.y;
      if (!drag.moved && Math.hypot(dx, dy) * cam.z < 3) return;
      drag.moved = true;
      it.d.x = drag.start.x + dx;
      it.d.y = drag.start.y + dy;
      draw(it);
      if (!sendTimer) sendTimer = setTimeout(flushMove, 50);
    } else if (drag.type === "resize") {
      const ratio = drag.start.h / drag.start.w;
      const w = Math.max(40, Math.min(8000, drag.start.w + (pt.x - drag.from.x)));
      it.d.w = Math.round(w);
      it.d.h = Math.max(16, Math.round(w * ratio));
      drag.moved = true;
      draw(it);
      if (!sendTimer) sendTimer = setTimeout(flushMove, 50);
    }
  });

  function flushPen() {
    sendTimer = 0;
    if (!drag || drag.type !== "pen" || !drag.queue.length) return;
    while (drag.queue.length) live({ k: "pts", id: drag.id, p: drag.queue.splice(0, LIM.chunk) });
  }
  function flushMove() {
    sendTimer = 0;
    if (!drag || !drag.moved) return;
    const d = items.get(drag.id)?.d;
    if (!d) return;
    live(d.kind === "image" ? { k: "move", id: d.id, x: d.x, y: d.y, w: d.w, h: d.h } : { k: "move", id: d.id, x: d.x, y: d.y });
  }
  function endDrag() {
    if (!drag) return;
    clearTimeout(sendTimer);
    const it = drag.id ? items.get(drag.id) : null;
    if (drag.type === "pen") {
      flushPen();
      if (it) record({ t: "add", d: snapshot(it) });
    } else if (drag.type === "move" || drag.type === "resize") {
      flushMove();
      if (it && drag.moved) {
        const keys = it.d.kind === "image" ? ["x", "y", "w", "h"] : ["x", "y"];
        const pick = o => Object.fromEntries(keys.map(k => [k, o[k]]));
        record({ t: "move", id: it.d.id, from: pick(drag.start), to: pick(it.d) });
      }
    } else if (drag.type === "erase" && drag.erased.length) {
      record(drag.erased.length === 1 ? drag.erased[0] : { t: "many", list: drag.erased });
    }
    sendTimer = 0;
    if (drag.id) busy.delete(drag.id);
    viewport.classList.remove("panning");
    drag = null;
  }
  function cancelDrag() {
    if (!drag) return;
    if (drag.type === "pen" && items.get(drag.id)?.d.p.length <= 4) {     // a stroke just begun by the first finger
      busy.delete(drag.id);
      deleteItem(drag.id);
      drag = null;
      return;
    }
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
    else if (!it && tool === "select") newText(toBoard(e));
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

  // ---- Text ----------------------------------------------------------------------------------
  let editTimer = 0;
  function newText(pt) {
    if (!roomFor("text")) return;
    const id = newId();
    const it = applyItem({ id, by: me, kind: "text", x: pt.x, y: Math.round(pt.y - textSize / 2), text: "", c: colour, s: textSize });
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
    select(id);
    const el = it.el;
    el.contentEditable = "true";
    el.spellcheck = true;
    el.classList.add("editing");
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
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
      const snap = deleteItem(id);                    // an emptied text box goes away
      if (snap && start && !start.isNew) record({ t: "del", d: { ...snap, text: start.text } });
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
  function encode(img, scale) {
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const webp = c.toDataURL("image/webp", 0.8).startsWith("data:image/webp");
    if (!webp) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); }        // jpeg has no see-through
    g.drawImage(img, 0, 0, w, h);
    return webp ? c.toDataURL("image/webp", 0.82) : c.toDataURL("image/jpeg", 0.82);
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
    select(d.id);
  }

  document.addEventListener("paste", e => {
    if (!state || $("gameView").hidden) return;
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
    if (editing) {
      e.preventDefault();               // paste into a text box as plain text
      const text = e.clipboardData.getData("text/plain");
      if (text) document.execCommand("insertText", false, text);
      return;
    }
    if (e.target.closest && e.target.closest("input, textarea")) return;
    if (files.length) {
      e.preventDefault();
      const c = viewCentre();
      files.forEach((f, i) => addImageFile(f, { x: c.x + i * 40, y: c.y + i * 40 }));
      return;
    }
    const text = e.clipboardData.getData("text/plain");
    if (text && text.trim() && roomFor("text")) {
      e.preventDefault();
      const c = viewCentre();
      const d = { id: newId(), kind: "text", x: Math.round(c.x - 100 / cam.z), y: c.y, text: text.slice(0, LIM.text), c: colour, s: textSize };
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
    [...e.dataTransfer.files].filter(f => f.type.startsWith("image/"))
      .forEach((f, i) => addImageFile(f, { x: at.x + i * 40, y: at.y + i * 40 }));
  });
  $("addImage").addEventListener("click", () => $("imageFile").click());
  $("imageFile").addEventListener("change", () => {
    const f = $("imageFile").files[0];
    $("imageFile").value = "";
    if (f) addImageFile(f, viewCentre());
  });

  // ---- Toolbar -------------------------------------------------------------------------------
  function setTool(t) {
    if (editing) finishEdit();
    tool = t;
    viewport.dataset.tool = t;
    document.querySelectorAll("#tools .tb").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
    if (t !== "select" && t !== "text" && selected) select(null);
    syncToolbar();
  }
  function selectedOwn() {
    const it = selected && items.get(selected);
    return it && it.d.by === me && (it.d.kind === "text" || it.d.kind === "pen") ? it : null;
  }
  function syncToolbar() {
    const sel = selectedOwn();
    const textMode = tool === "text" || (sel && sel.d.kind === "text");
    const showSizes = tool === "pen" || textMode;
    const pen = tool === "pen";
    const sizes = pen ? PEN_SIZES : TEXT_SIZES;
    const current = pen ? penSize : (sel && sel.d.kind === "text" ? sel.d.s : textSize);
    const curColour = sel ? sel.d.c : colour;
    $("sizes").hidden = !showSizes;
    $("sizes").innerHTML = "";
    sizes.forEach(v => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tb sz" + (v === current ? " on" : "");
      b.title = (pen ? "Pen size " : "Text size ") + v;
      b.setAttribute("aria-label", b.title);
      const dot = document.createElement("i");
      if (pen) {
        dot.style.width = dot.style.height = Math.min(22, v + 2) + "px";
      } else {
        dot.className = "t";
        dot.textContent = "A";
        dot.style.fontSize = Math.round(11 + (v - 18) / 3) + "px";
      }
      b.append(dot);
      b.addEventListener("click", () => {
        if (pen) penSize = v;
        else {
          textSize = v;
          const s = selectedOwn();
          if (s && s.d.kind === "text" && s.d.s !== v) {
            if (!s.draft) record({ t: "edit", id: s.d.id, from: { s: s.d.s }, to: { s: v } });
            editItem(s.d.id, { s: v });
          }
        }
        syncToolbar();
      });
      $("sizes").append(b);
    });
    document.querySelectorAll("#swatches .sw").forEach(b => b.classList.toggle("on", b.dataset.c === curColour));
  }
  function buildToolbar() {
    COLOURS.forEach(c => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sw";
      b.dataset.c = c;
      b.style.setProperty("--c", c);
      b.title = "Colour " + c;
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", () => {
        colour = c;
        const s = selectedOwn();
        if (s && s.d.c !== c) {
          if (!s.draft) record({ t: "edit", id: s.d.id, from: { c: s.d.c }, to: { c } });
          editItem(s.d.id, { c });
        }
        syncToolbar();
        if (editing) items.get(editing)?.el.focus({ preventScroll: true });
      });
      $("swatches").append(b);
    });
    document.querySelectorAll("#tools .tb").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
    setTool("select");
    syncUndo();
  }
  // Colour and size buttons shouldn't take focus away from a text box being typed in.
  document.querySelector(".bd-bar").addEventListener("pointerdown", e => {
    if (editing && e.target.closest(".sw, .sz")) e.preventDefault();
  });

  document.addEventListener("keydown", e => {
    if (!state || $("gameView").hidden || editing) return;
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === "=" || k === "+") { e.preventDefault(); zoomAt(cam.z * 1.25); }
      else if (k === "-") { e.preventDefault(); zoomAt(cam.z / 1.25); }
      else if (k === "0") { e.preventDefault(); fitAll(); }
      return;
    }
    if (e.altKey) return;
    if (e.key === " ") { spaceDown = true; viewport.classList.add("can-pan"); e.preventDefault(); return; }
    const keys = { v: "select", t: "text", p: "pen", e: "eraser" };
    if (keys[k]) { setTool(keys[k]); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      const snap = deleteItem(selected);
      if (snap) record({ t: "del", d: snap });
    } else if (e.key === "Escape") select(null);
    else if (e.key === "Enter" && selectedOwn()?.d.kind === "text") { e.preventDefault(); startEdit(selected); }
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
    $("roomCode").textContent = state.room;
    const mine = state.players.find(p => p.id === me);
    $("myName").textContent = mine ? mine.name : AceLive.name();
    const counts = {};
    for (const it of items.values()) if (!it.draft) counts[it.d.by] = (counts[it.d.by] || 0) + 1;
    const list = $("players");
    list.innerHTML = "";
    const people = [...state.players].sort((a, b) => (b.id === me) - (a.id === me) || b.online - a.online);
    for (const p of people) {
      const li = document.createElement("li");
      li.className = "bd-player" + (p.online ? "" : " away") + (hidden.has(p.id) ? " off" : "");
      li.append(FX.avatar(p.name, state.colours[p.id] ?? 0, "sm"));
      const name = document.createElement("span");
      name.className = "bd-pname";
      name.textContent = p.name + (p.id === me ? " (you)" : "") + (p.online ? "" : " · away");
      const n = document.createElement("span");
      n.className = "muted small";
      n.textContent = counts[p.id] ? String(counts[p.id]) : "";
      n.title = "Things on the board";
      const eye = document.createElement("button");
      eye.type = "button";
      eye.className = "eye";
      const off = hidden.has(p.id);
      eye.innerHTML = off ? EYE_SHUT : EYE_OPEN;
      eye.setAttribute("aria-pressed", String(!off));
      eye.title = (off ? "Show " : "Hide ") + (p.id === me ? "your" : p.name + "'s") + " writing";
      eye.setAttribute("aria-label", eye.title);
      eye.addEventListener("click", () => {
        if (hidden.has(p.id)) hidden.delete(p.id); else hidden.add(p.id);
        if (selected && items.get(selected)?.d.by === p.id) select(null);
        for (const it of items.values()) if (it.d.by === p.id) draw(it);
        renderPanel();
      });
      li.append(name, n, eye);
      list.append(li);
    }
    const here = state.players.filter(p => p.online).length;
    $("playerCount").textContent = `${here} here` + (hidden.size ? ` · ${hidden.size} hidden` : "");
    $("showAll").hidden = !hidden.size;
    $("clearAll").hidden = !state.isHost;
    syncCursors();
    const pics = [...items.values()].filter(i => i.d.kind === "image").length;
    $("boardInfo").textContent = `${items.size} thing${items.size === 1 ? "" : "s"} on the board, ${pics} picture${pics === 1 ? "" : "s"}.`;
  }

  function initPanel() {
    $("showAll").addEventListener("click", () => {
      hidden.clear();
      for (const it of items.values()) draw(it);
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
  }

  buildToolbar();
  initPanel();
  initStart();
})();
