// ACE Tabletop: an online table for roleplaying campaigns. The server (server/games/tabletop.py) keeps the
// campaign (scenes, tokens, fog, drawings, characters, notes, chat and the turn order), rolls every die, and only
// sends players what they may see: no hidden tokens, no monsters under the fog, no DM notes.
//
// The map is one canvas. World units are squares of the grid; cam.z is how many screen pixels a square is.
// Room updates carry the whole campaign view (pictures are just names; the files come from
// /api/dnd/asset/...). Quick things travel as "live" messages: a token being dragged, the ruler, pings.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const FX = window.AceFX;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const TOKEN_COLOURS = ["#e5484d", "#f76b15", "#d6a100", "#2f9e44", "#12a594", "#3e63dd", "#8e4ec6", "#d6409f", "#6b7280", "#f4f1ea"];
  const INK = ["#ffd43b", "#ff6b6b", "#69db7c", "#4dabf7", "#da77f2", "#ffffff", "#111111"];
  const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
  const ABIL_NAME = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
  const ZMIN = 6, ZMAX = 220;
  const LIM = { image: 900000, grid: 120, linePts: 4000 };

  let socket = null, S = null, me = "", slug = null, viewSc = null, firstState = true;
  const cam = { x: -1, y: -1, z: 48 };
  let tool = "select", sel = null;
  let drawShape = "free", ink = INK[0], inkW = 3;
  let fogShow = true, fogBrush = 1, fogBox = false;
  let rollMode = "";
  const images = new Map();                 // asset name -> Image
  const rulers = new Map();                 // player id -> { p, t } (other people's rulers)
  const drags = new Map();                  // token id -> { x, y, t } (other people dragging)
  const pings = [];                         // { x, y, t, c }
  const fogLocal = new Map();               // cell index -> "0"/"1", painted but not confirmed yet
  let act = null;                           // what the pointer is doing right now
  let noteTimer = 0, spaceDown = false;

  const viewport = $("viewport"), canvas = $("map"), ctx = canvas.getContext("2d");

  // ---- Little helpers ------------------------------------------------------------------------
  const isDm = () => !!(S && S.dm);
  const scene = () => S && (S.scenes.find(s => s.id === viewSc) || S.scenes[0]);
  const assetUrl = name => `${AceLive.SERVER}/api/dnd/asset/${slug}/${name}`;
  const nameOf = pid => (S && S.names[pid]) || "Someone";
  const colourOf = pid => FX.color(S ? Math.max(0, Object.keys(S.names).indexOf(pid)) : 0);
  const mod = v => Math.floor((v - 10) / 2);
  const sign = n => (n >= 0 ? "+" : "") + n;
  const per = () => (S ? S.settings.per : 5);
  const unit = () => (S ? S.settings.unit : "ft");
  const squares = (a, b) => Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const distText = n => `${Math.round(n * 10) / 10} sq · ${Math.round(n * per() * 10) / 10} ${unit()}`;
  const ownsChar = ch => ch && (ch.owner === me || isDm());
  const controls = t => !!t && (isDm() || t.owner === me || (charById(t.char) || {}).owner === me);
  const charById = id => S && id ? S.chars.find(c => c.id === id) : null;
  const tokenById = id => { const sc = scene(); return sc ? sc.tokens.find(t => t.id === id) : null; };
  const pb = ch => ch.pb ?? (2 + Math.floor((ch.level - 1) / 4));
  const skillBonus = (ch, sk) => mod(ch.abil[S.skills[sk]]) + (ch.skills.includes(sk) ? pb(ch) : 0) + (ch.expert.includes(sk) ? pb(ch) : 0);
  const saveBonus = (ch, a) => mod(ch.abil[a]) + (ch.saves.includes(a) ? pb(ch) : 0);
  const initBonus = ch => mod(ch.abil.dex) + (ch.initb || 0);
  function picture(name) {
    if (!name) return null;
    let img = images.get(name);
    if (!img) {
      img = new Image();
      img.onload = () => { redraw(); if (act === null) refreshSceneEdit(); };
      img.src = assetUrl(name);
      images.set(name, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }
  function note(msg) {
    const n = $("note");
    n.textContent = msg || "";
    n.hidden = !msg;
    clearTimeout(noteTimer);
    if (msg) noteTimer = setTimeout(() => { n.hidden = true; }, 5000);
  }
  function action(type, extra = {}) {
    if (!socket) return;
    socket.timeout(15000).emit("action", { type, ...extra }, (err, res) => {
      if (err) note("The server didn't answer. Check your connection and try again.");
      else if (res && res.error) note(res.error);
    });
  }
  const live = msg => socket && socket.emit("live", msg);
  function throttle(fn, ms) {
    let last = 0, timer = 0, args = null;
    return (...a) => {
      args = a;
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...args); }
      else if (!timer) timer = setTimeout(() => { timer = 0; last = Date.now(); fn(...args); }, ms - (now - last));
    };
  }

  // Shrink a picture to fit what the server takes. Square: crop to a square (tokens and portraits).
  function loadFile(file) {
    return new Promise((ok, bad) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(url); bad(new Error("not a picture")); };
      img.src = url;
    });
  }
  async function shrink(file, maxSide, square) {
    const img = await loadFile(file);
    let w = img.naturalWidth, h = img.naturalHeight, sx = 0, sy = 0, sw = w, sh = h;
    if (square) { const m = Math.min(w, h); sx = (w - m) / 2; sy = (h - m) / 2; sw = sh = m; w = h = m; }
    let scale = Math.min(1, maxSide / Math.max(w, h));
    for (let tries = 0; tries < 12; tries++) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      for (const q of [0.85, 0.72, 0.6]) {
        let url = c.toDataURL("image/webp", q);
        if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/jpeg", q);
        if (url.length < LIM.image - 2000) return { url, w: img.naturalWidth, h: img.naturalHeight };
      }
      scale *= 0.8;
    }
    throw new Error("too big");
  }
  function pickFile() {
    return new Promise(ok => {
      const f = $("fileIn");
      f.value = "";
      f.onchange = () => ok(f.files[0] || null);
      f.click();
    });
  }

  // ---- Start screen --------------------------------------------------------------------------
  const cleanSlug = v => String(v || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  const campLink = s => location.origin + location.pathname + "?c=" + s;
  let pendingSlug = "", camps = [], listTimer = 0, serverUp = false;
  function startError(msg) { $("startError").textContent = msg || ""; $("startError").hidden = !msg; }
  function showStart(s, error) {
    $("gameView").hidden = true;
    $("startView").hidden = false;
    document.body.classList.remove("on-table", "is-dm");
    pendingSlug = s || "";
    history.replaceState(null, "", location.pathname);
    document.title = "ACE Tabletop";
    $("playerName").value = AceLive.name();
    startError(error);
    loadList();
  }
  function needName() {
    const n = $("playerName").value.trim();
    if (!n) { startError("Type your name first, so the party knows who's who."); $("playerName").focus(); return null; }
    AceLive.setName(n);
    return n;
  }
  function openCamp(s) {
    if (!serverUp) return startError("The game server is offline right now, so campaigns can't be opened.");
    if (!needName()) { pendingSlug = s; return; }
    play({ slug: s });
  }
  function ago(t) {
    const s = Math.max(0, Date.now() / 1000 - t);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400 * 2) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
  }
  async function copyText(text, say) {
    try { await navigator.clipboard.writeText(text); say("Link copied. Paste it to the party, like in Discord."); }
    catch { say("Copy this link: " + text); }
  }
  function renderList() {
    const q = $("campSearch").value.trim().toLowerCase();
    const list = $("campList");
    list.innerHTML = "";
    const shown = camps.filter(c => !q || c.name.toLowerCase().includes(q));
    for (const c of shown) {
      const li = document.createElement("li");
      li.className = "camp-row" + (c.slug === pendingSlug ? " wanted" : "") + (c.online ? " live" : "");
      li.innerHTML = `<div class="camp-info"><a href="?c=${esc(c.slug)}">${esc(c.name)}</a>
        <span class="muted small">${c.scenes} scene${c.scenes === 1 ? "" : "s"} · ${c.chars} character${c.chars === 1 ? "" : "s"} · changed ${ago(c.updated)}${c.online ? ` · ${c.online} here now` : ""}</span></div>
        <button type="button" class="btn small-btn" data-copy>Copy link</button><button type="button" class="btn primary small-btn" data-open>Open</button>`;
      li.querySelector("a").addEventListener("click", e => { e.preventDefault(); openCamp(c.slug); });
      li.querySelector("[data-open]").addEventListener("click", () => openCamp(c.slug));
      li.querySelector("[data-copy]").addEventListener("click", () => copyText(campLink(c.slug), m => { $("listNote").textContent = m; }));
      list.append(li);
    }
    $("campCount").textContent = camps.length ? `(${camps.length})` : "";
    if (!serverUp) $("listNote").textContent = "The list shows while the game server is running.";
    else if (!camps.length) $("listNote").textContent = "No campaigns yet. Start the first one!";
    else if (!shown.length) $("listNote").textContent = "No campaigns match that search.";
  }
  async function loadList() {
    clearTimeout(listTimer);
    serverUp = await AceLive.isOnline();
    const st = $("serverStatus");
    st.className = "server-status " + (serverUp ? "up" : "down");
    st.textContent = serverUp ? "The game server is on." : "The game server is off right now. Campaigns open when it's back.";
    $("createBtn").disabled = !serverUp;
    if (serverUp) {
      try {
        const r = await fetch(AceLive.SERVER + "/api/dnd/list", { cache: "no-store" });
        camps = (await r.json()).campaigns || [];
      } catch { camps = []; }
    }
    renderList();
    listTimer = setTimeout(loadList, 20000);
  }
  function initStart() {
    FX.soundButton();
    $("startForm").addEventListener("submit", e => {
      e.preventDefault();
      if (!needName()) return;
      const name = $("campName").value.trim();
      if (!name && pendingSlug) return openCamp(pendingSlug);
      if (!name) { startError("Give the campaign a name, like \"The Sunken Keep\"."); $("campName").focus(); return; }
      play({ create: name });
    });
    $("campSearch").addEventListener("input", renderList);
    const s = cleanSlug(new URLSearchParams(location.search).get("c"));
    if (s && AceLive.name() && window.io) play({ slug: s });
    else {
      showStart(s);
      if (s) startError("Type your name, then press Open on the campaign (it's highlighted in the list).");
    }
  }

  // ---- Connection ----------------------------------------------------------------------------
  let playing = false, leave = null;
  function play(opts) {
    if (playing) return;
    playing = true;
    clearTimeout(listTimer);
    slug = opts.slug || null;
    let create = opts.create || "";
    $("startView").hidden = true;
    $("gameView").hidden = false;
    document.body.classList.add("on-table");
    setPanel(innerWidth > 860);
    resize();
    socket = AceLive.connect();
    const setConn = msg => { $("connNote").textContent = msg || ""; $("connNote").hidden = !msg; };
    const fail = msg => {
      socket.disconnect();
      socket = null;
      playing = false;
      S = null;
      firstState = true;
      sel = null;
      closeModal("sheet");
      closeModal("tokenForm");
      showStart(slug, msg);
    };
    leave = fail;
    function enter() {
      const base = { playerId: AceLive.playerId(), name: AceLive.name() };
      if (create) {
        socket.timeout(8000).emit("create", { ...base, game: "dnd", options: { name: create } }, (err, res) => {
          if (err) return fail("The game server didn't answer. Try again in a moment.");
          if (res.error) { slug = null; return fail(res.error); }
          create = "";
          slug = res.room.slice(2);
          history.replaceState(null, "", "?c=" + slug);
        });
      } else {
        history.replaceState(null, "", "?c=" + slug);
        socket.timeout(8000).emit("join", { ...base, room: "c:" + slug }, (err, res) => {
          if (err) return setConn("Can't reach the game server. Retrying…");
          if (res.error) return fail("There's no campaign at that link. It may have been deleted.");
        });
      }
    }
    socket.on("connect", () => { setConn(""); enter(); });
    socket.on("disconnect", () => setConn("Connection lost. Reconnecting…"));
    socket.on("connect_error", () => setConn(S ? "Connection lost. Reconnecting…" : "Can't reach the game server. It may be switched off. Retrying…"));
    socket.on("state", onState);
    socket.on("live", onLive);
  }

  // ---- Room updates --------------------------------------------------------------------------
  let lastActive = null, lastLog = 0, myTurnSeen = null;
  function onState(s) {
    const old = S;
    S = s;
    me = s.you;
    if (s.camp) slug = s.camp.slug;
    if (s.deleted) { leave && leave("That campaign was deleted."); return; }
    Object.assign(LIM, s.limits || {});
    document.body.classList.toggle("is-dm", !!s.dm);
    document.title = `${s.camp.name} · ACE Tabletop`;
    // Which scene to look at: players always see the active one; a DM follows it unless they're looking elsewhere.
    if (!s.dm || !viewSc || !s.scenes.some(x => x.id === viewSc) || viewSc === lastActive) viewSc = s.active;
    const moved = lastActive !== null && lastActive !== s.active;
    lastActive = s.active;
    fogLocal.clear();
    drags.clear();
    if (sel && !tokenById(sel)) sel = null;
    if (firstState || (moved && viewSc === s.active)) { fitView(); firstState = false; }
    renderAll(old);
  }
  function renderAll(old) {
    $("campTitle").textContent = S.camp.name;
    const sc = scene();
    $("sceneTitle").textContent = sc ? sc.name + (isDm() && sc.id !== S.active ? " (players can't see this)" : "") : "";
    const pick = $("scenePick");
    pick.hidden = !isDm();
    if (isDm()) {
      pick.innerHTML = S.scenes.map(x => `<option value="${x.id}"${x.id === viewSc ? " selected" : ""}>${esc(x.name)}${x.id === S.active ? " ★" : ""}</option>`).join("");
    }
    $("showScene").hidden = !isDm() || viewSc === S.active;
    renderTurnBanner();
    renderLog(old);
    renderTurns();
    renderParty();
    renderNotes();
    renderScenes();
    renderRoom();
    renderCard();
    refreshSheet();
    redraw();
  }

  function onLive(m) {
    if (!S) return;
    const now = Date.now();
    if (m.k === "ping") { pings.push({ x: m.x, y: m.y, t: now, c: colourOf(m.by), sc: m.sc }); FX.sound("tick"); }
    else if (m.k === "ruler") { if (m.off) rulers.delete(m.by); else rulers.set(m.by, { p: m.p, t: now, sc: m.sc }); }
    else if (m.k === "drag") drags.set(m.id, { x: m.x, y: m.y, t: now, sc: m.sc });
    redraw();
  }

  // ---- Camera --------------------------------------------------------------------------------
  let dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.clientWidth * dpr);
    canvas.height = Math.round(viewport.clientHeight * dpr);
    redraw();
  }
  const panelW = () => (innerWidth > 860 && !$("panel").classList.contains("closed") ? $("panel").offsetWidth + 20 : 0);
  function fitView() {
    const sc = scene();
    if (!sc) return;
    const w = viewport.clientWidth - panelW() - 80, h = viewport.clientHeight - 100;
    cam.z = Math.max(ZMIN, Math.min(80, Math.min(w / sc.cols, h / sc.rows)));
    cam.x = sc.cols / 2 - (w / 2 + 70) / cam.z;
    cam.y = sc.rows / 2 - (h / 2 + 60) / cam.z;
    redraw();
  }
  function zoomAt(z, sx = viewport.clientWidth / 2, sy = viewport.clientHeight / 2) {
    z = Math.max(ZMIN, Math.min(ZMAX, z));
    const wx = cam.x + sx / cam.z, wy = cam.y + sy / cam.z;
    cam.z = z;
    cam.x = wx - sx / z;
    cam.y = wy - sy / z;
    redraw();
  }
  function screenPt(e) {
    const r = viewport.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  function worldPt(e) {
    const { sx, sy } = screenPt(e);
    return { x: cam.x + sx / cam.z, y: cam.y + sy / cam.z };
  }
  function centreOn(x, y) {
    cam.x = x - (viewport.clientWidth - panelW()) / 2 / cam.z;
    cam.y = y - viewport.clientHeight / 2 / cam.z;
    redraw();
  }

  // ---- Drawing the map -----------------------------------------------------------------------
  let frame = 0;
  function redraw() { if (!frame) frame = requestAnimationFrame(paint); }
  function tokenPos(t) {
    if (act && act.kind === "token" && act.id === t.id) return { x: act.x, y: act.y };
    const d = drags.get(t.id);
    if (d && Date.now() - d.t < 3000) return d;
    return t;
  }
  function paint() {
    frame = 0;
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0a0b0f";
    ctx.fillRect(0, 0, W, H);
    const sc = scene();
    if (!sc) return;
    const z = cam.z * dpr, px = n => n / cam.z;
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);

    // the map
    ctx.fillStyle = "#23262f";
    ctx.fillRect(0, 0, sc.cols, sc.rows);
    const img = picture(sc.img);
    if (img) {
      const iw = sc.cols, ih = sc.cols * img.naturalHeight / img.naturalWidth;
      ctx.drawImage(img, sc.ox, sc.oy, iw, ih);
    }
    if (sc.grid && cam.z >= 7) {
      ctx.beginPath();
      for (let x = 0; x <= sc.cols; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, sc.rows); }
      for (let y = 0; y <= sc.rows; y++) { ctx.moveTo(0, y); ctx.lineTo(sc.cols, y); }
      ctx.strokeStyle = sc.gc;
      ctx.globalAlpha = img ? 0.35 : 0.5;
      ctx.lineWidth = px(1);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (!img) {
      ctx.strokeStyle = "#3a3f4d";
      ctx.lineWidth = px(2);
      ctx.strokeRect(0, 0, sc.cols, sc.rows);
    }

    // drawings and spell areas
    for (const ln of sc.lines) paintLine(ln, px);
    if (act && act.kind === "draw") paintLine(act.line, px, true);

    // fog of war
    if (sc.fog) paintFog(sc, px);

    // tokens
    const cur = S.init.cur && S.init.list.find(e => e.id === S.init.cur);
    for (const t of sc.tokens) paintToken(t, px, cur && cur.tok === t.id);

    // a token being dragged: the path and how far
    if (act && act.kind === "token" && act.moved) {
      const t = tokenById(act.id);
      if (t) {
        const r = t.size / 2;
        const a = { x: act.ox + r, y: act.oy + r }, b = { x: act.x + r, y: act.y + r };
        paintRuler([a.x, a.y, b.x, b.y], "#ffffff", px, squares({ x: act.ox, y: act.oy }, act));
      }
    }
    // rulers
    for (const [pid, r] of rulers) {
      if (Date.now() - r.t > 8000) { rulers.delete(pid); continue; }
      if (r.sc === sc.id) paintRuler(r.p, colourOf(pid), px, null, nameOf(pid));
    }
    if (act && act.kind === "ruler") paintRuler(act.p, colourOf(me), px);

    // fog box being dragged
    if (act && act.kind === "fogbox") {
      const [x0, y0, x1, y1] = boxCells(act.a, act.b);
      ctx.strokeStyle = fogShow ? "#69db7c" : "#ff6b6b";
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(6), px(4)]);
      ctx.strokeRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      ctx.setLineDash([]);
    }
    if (tool === "fog" && hover && !act) {
      const c = cellAt(hover), n = fogBox ? 1 : fogBrush, o = Math.floor(n / 2);
      ctx.strokeStyle = fogShow ? "#69db7c" : "#ff6b6b";
      ctx.lineWidth = px(2);
      ctx.strokeRect(c.x - o, c.y - o, n, n);
    }

    // pings
    const now = Date.now();
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i], age = (now - p.t) / 1000;
      if (age > 2.2) { pings.splice(i, 1); continue; }
      if (p.sc !== sc.id) continue;
      for (let k = 0; k < 3; k++) {
        const a = age - k * 0.25;
        if (a < 0 || a > 1.4) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.2 + a * 1.6, 0, Math.PI * 2);
        ctx.strokeStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - a / 1.4);
        ctx.lineWidth = px(4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (pings.length) redraw();
  }

  function paintFog(sc, px) {
    const dm = isDm();
    ctx.fillStyle = dm ? "rgba(8, 10, 16, 0.55)" : "#07080b";
    ctx.beginPath();
    for (let y = 0; y < sc.rows; y++) {
      let run = -1;
      for (let x = 0; x <= sc.cols; x++) {
        const i = y * sc.cols + x;
        const v = x < sc.cols ? (fogLocal.has(i) ? fogLocal.get(i) : sc.seen[i]) : "1";
        if (v !== "1" && run < 0) run = x;
        if (v === "1" && run >= 0) { ctx.rect(run, y, x - run, 1); run = -1; }
      }
    }
    ctx.fill();
    if (dm) {
      ctx.strokeStyle = "rgba(167, 139, 250, 0.6)";
      ctx.lineWidth = px(2);
      ctx.strokeRect(0, 0, sc.cols, sc.rows);
    }
  }

  function paintLine(ln, px, live) {
    const p = ln.p;
    if (!p || p.length < 4) return;
    ctx.strokeStyle = ln.c;
    ctx.fillStyle = ln.c;
    ctx.lineWidth = px(ln.w);
    ctx.lineCap = ctx.lineJoin = "round";
    const a = { x: p[0], y: p[1] }, b = { x: p[p.length - 2], y: p[p.length - 1] };
    ctx.beginPath();
    let label = null;
    if (!ln.shape) {
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
      return;
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (ln.shape === "line") {
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      label = { at: b, n: len };
    } else if (ln.shape === "rect") {
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      label = { at: b, n: Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) };
    } else if (ln.shape === "circle") {
      ctx.arc(a.x, a.y, len, 0, Math.PI * 2);
      label = { at: b, n: len, r: true };
    } else if (ln.shape === "cone") {
      const ang = Math.atan2(b.y - a.y, b.x - a.x), half = Math.atan(0.5);
      const reach = len / Math.cos(half);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + Math.cos(ang - half) * reach, a.y + Math.sin(ang - half) * reach);
      ctx.lineTo(a.x + Math.cos(ang + half) * reach, a.y + Math.sin(ang + half) * reach);
      ctx.closePath();
      label = { at: b, n: len };
    }
    ctx.globalAlpha = 0.18;
    if (ln.shape !== "line") ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    if (label && (live || cam.z > 20)) {
      const n = Math.round(label.n * 2) / 2;
      tag(`${label.r ? "r " : ""}${Math.round(n * per())} ${unit()}`, label.at.x, label.at.y - px(14), ln.c, px);
    }
  }

  function tag(text, x, y, c, px, size = 12) {
    ctx.font = `600 ${px(size)}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + px(10), h = px(size + 6);
    ctx.fillStyle = "rgba(10, 11, 15, 0.85)";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x - w / 2, y - h / 2, w, h, px(4)) : ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = c || "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + px(0.5));
  }

  function paintRuler(p, c, px, n, who) {
    ctx.strokeStyle = c;
    ctx.lineWidth = px(3);
    ctx.setLineDash([px(8), px(5)]);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
    ctx.setLineDash([]);
    let total = n;
    if (total == null) {
      total = 0;
      for (let i = 2; i < p.length; i += 2) total += squares({ x: Math.floor(p[i - 2]), y: Math.floor(p[i - 1]) }, { x: Math.floor(p[i]), y: Math.floor(p[i + 1]) });
    }
    const e = { x: p[p.length - 2], y: p[p.length - 1] };
    ctx.beginPath();
    ctx.arc(e.x, e.y, px(5), 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    tag((who ? who + ": " : "") + distText(total), e.x, e.y - px(20), c, px, 13);
  }

  const COND_COLOUR = { dead: "#111", unconscious: "#6b7280", prone: "#b45309", poisoned: "#2f9e44", concentrating: "#3e63dd",
    blessed: "#d6a100", hasted: "#12a594", invisible: "#a78bfa", stunned: "#d6409f", restrained: "#f76b15" };
  function paintToken(t, px, isTurn) {
    const pos = tokenPos(t), r = t.size / 2, cx = pos.x + r, cy = pos.y + r;
    const rad = Math.max(r * 0.9, r - px(2));
    const img = picture(t.img);
    const sc = scene();
    const fogged = isDm() && sc.fog && !t.owner && !t.char && covered(sc, pos, t.size);
    ctx.globalAlpha = t.hidden ? 0.45 : 1;
    if (isTurn) {
      ctx.beginPath();
      ctx.arc(cx, cy, rad + px(7), 0, Math.PI * 2);
      ctx.strokeStyle = "#c89b3c";
      ctx.lineWidth = px(4);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = t.c;
    ctx.fill();
    if (img) {
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, cx - rad, cy - rad, rad * 2, rad * 2);
      ctx.restore();
    } else if (cam.z * t.size > 22) {
      ctx.fillStyle = t.c === "#f4f1ea" ? "#15171d" : "#fff";
      ctx.font = `700 ${rad * 0.95}px Rajdhani, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(t.name), cx, cy + rad * 0.05);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = t.conds.includes("dead") ? "#111" : t.c;
    ctx.lineWidth = px(3);
    if (fogged || t.hidden) ctx.setLineDash([px(5), px(4)]);
    if (fogged) ctx.strokeStyle = "#a78bfa";
    ctx.stroke();
    ctx.setLineDash([]);
    if (t.conds.includes("dead") || (t.hp != null && t.hp <= 0 && t.mhp) || t.look === "down") {
      ctx.strokeStyle = "rgba(0,0,0,.75)";
      ctx.lineWidth = px(5);
      ctx.beginPath();
      ctx.moveTo(cx - rad * 0.6, cy - rad * 0.6); ctx.lineTo(cx + rad * 0.6, cy + rad * 0.6);
      ctx.moveTo(cx + rad * 0.6, cy - rad * 0.6); ctx.lineTo(cx - rad * 0.6, cy + rad * 0.6);
      ctx.stroke();
    }
    if (sel === t.id) {
      ctx.beginPath();
      ctx.arc(cx, cy, rad + px(4), 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(5), px(3)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // condition dots round the top
    t.conds.filter(c => c !== "dead").slice(0, 6).forEach((c, i) => {
      const a = -Math.PI / 2 + (i - 1) * 0.55;
      const dx = cx + Math.cos(a) * rad, dy = cy + Math.sin(a) * rad, cr = Math.max(px(5), rad * 0.18);
      ctx.beginPath();
      ctx.arc(dx, dy, cr, 0, Math.PI * 2);
      ctx.fillStyle = COND_COLOUR[c] || "#8e4ec6";
      ctx.fill();
      ctx.lineWidth = px(1.5);
      ctx.strokeStyle = "#000";
      ctx.stroke();
      if (cr * cam.z > 6) {
        ctx.fillStyle = "#fff";
        ctx.font = `700 ${cr * 1.2}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(c[0].toUpperCase(), dx, dy + cr * 0.05);
      }
    });
    // HP bar
    if (t.hp != null && t.mhp) {
      const w = t.size * 0.86, h = Math.max(px(5), 0.09), x = cx - w / 2, y = pos.y + t.size - h * 0.6;
      ctx.fillStyle = "#3b1720";
      ctx.fillRect(x, y, w, h);
      const f = Math.max(0, Math.min(1, t.hp / t.mhp));
      ctx.fillStyle = f > 0.5 ? "#2f9e44" : f > 0.25 ? "#f59e0b" : "#e5484d";
      ctx.fillRect(x, y, w * f, h);
    }
    ctx.globalAlpha = 1;
    if (cam.z * Math.max(1, t.size) >= 30) {
      const look = t.look && t.look !== "fine" ? ` · ${t.look}` : "";
      tag(t.name + look, cx, pos.y + t.size + px(9), t.look === "bloodied" ? "#ff8787" : "#fff", px, 11);
    }
  }
  const initials = n => (String(n).trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2) || "?").toUpperCase();
  function covered(sc, pos, size) {
    const n = Math.max(1, Math.floor(size)), x0 = Math.floor(pos.x + 0.001), y0 = Math.floor(pos.y + 0.001);
    for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) {
      if (x >= 0 && y >= 0 && x < sc.cols && y < sc.rows && sc.seen[y * sc.cols + x] === "1") return false;
    }
    return true;
  }

  // ---- Pointer: tokens, panning, tools ----------------------------------------------------------
  const pointers = new Map();
  let pinch = null, hover = null;
  const cellAt = p => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
  function tokenAt(p) {
    const sc = scene();
    if (!sc) return null;
    for (let i = sc.tokens.length - 1; i >= 0; i--) {
      const t = sc.tokens[i], pos = tokenPos(t), r = t.size / 2;
      if (Math.hypot(p.x - pos.x - r, p.y - pos.y - r) <= Math.max(r, 0.3)) return t;
    }
    return null;
  }
  function snap(t, x, y) {
    const step = t.size < 1 ? 0.5 : 1;
    return { x: Math.round(x / step) * step, y: Math.round(y / step) * step };
  }
  const sendDrag = throttle((id, x, y) => live({ k: "drag", sc: viewSc, id, x: +x.toFixed(2), y: +y.toFixed(2) }), 60);
  const sendRuler = throttle(p => live({ k: "ruler", sc: viewSc, p }), 70);
  function boxCells(a, b) {
    const sc = scene();
    const c1 = cellAt(a), c2 = cellAt(b);
    return [Math.max(0, Math.min(c1.x, c2.x)), Math.max(0, Math.min(c1.y, c2.y)),
      Math.min(sc.cols - 1, Math.max(c1.x, c2.x)), Math.min(sc.rows - 1, Math.max(c1.y, c2.y))];
  }
  function paintFogAt(p) {
    const sc = scene(), c = cellAt(p), o = Math.floor(fogBrush / 2);
    for (let y = c.y - o; y < c.y - o + fogBrush; y++) for (let x = c.x - o; x < c.x - o + fogBrush; x++) {
      if (x >= 0 && y >= 0 && x < sc.cols && y < sc.rows) { fogLocal.set(y * sc.cols + x, fogShow ? "1" : "0"); act.cells.add(y * sc.cols + x); }
    }
    redraw();
  }
  function sendFog(cells) {
    const sc = scene(), list = [];
    for (const i of cells) list.push(i % sc.cols, Math.floor(i / sc.cols));
    if (list.length) action("fog", { sc: sc.id, cells: list, show: fogShow });
  }
  function eraseAt(p) {
    const sc = scene();
    for (const ln of sc.lines) {
      if (ln.by !== me && !isDm()) continue;
      if (lineHit(ln, p) && !act.gone.has(ln.id)) {
        act.gone.add(ln.id);
        sc.lines = sc.lines.filter(x => x.id !== ln.id);
        action("line_del", { sc: sc.id, id: ln.id });
        redraw();
      }
    }
  }
  function lineHit(ln, p) {
    const q = ln.p, near = 0.35;
    const a = { x: q[0], y: q[1] }, b = { x: q[q.length - 2], y: q[q.length - 1] };
    if (ln.shape === "circle") return Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(b.x - a.x, b.y - a.y) + near;
    if (ln.shape === "rect" || ln.shape === "cone") {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (ln.shape === "cone") return Math.hypot(p.x - a.x, p.y - a.y) <= len * 1.12 && Math.hypot(p.x - (a.x + b.x) / 2, p.y - (a.y + b.y) / 2) <= len * 0.75;
      return p.x >= Math.min(a.x, b.x) - near && p.x <= Math.max(a.x, b.x) + near && p.y >= Math.min(a.y, b.y) - near && p.y <= Math.max(a.y, b.y) + near;
    }
    for (let i = 2; i < q.length; i += 2) {
      const x1 = q[i - 2], y1 = q[i - 1], x2 = q[i], y2 = q[i + 1];
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
      const k = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / l2));
      if (Math.hypot(p.x - x1 - k * dx, p.y - y1 - k * dy) <= near) return true;
    }
    return false;
  }
  function ping(p) {
    pings.push({ x: p.x, y: p.y, t: Date.now(), c: colourOf(me), sc: viewSc });
    live({ k: "ping", sc: viewSc, x: +p.x.toFixed(2), y: +p.y.toFixed(2) });
    FX.sound("tick");
    redraw();
  }

  viewport.addEventListener("pointerdown", e => {
    if (!S) return;
    viewport.focus({ preventScroll: true });
    try { viewport.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ }
    pointers.set(e.pointerId, screenPt(e));
    if (pointers.size === 2) {                      // two fingers: pinch to zoom, drag to move
      cancelAct();
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), z: cam.z, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
      return;
    }
    if (pointers.size > 2) return;
    const p = worldPt(e), { sx, sy } = screenPt(e);
    if (e.button === 1 || e.button === 2 || spaceDown) { act = { kind: "pan", sx, sy, cx: cam.x, cy: cam.y }; viewport.classList.add("panning"); e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (e.altKey || tool === "ping") { ping(p); return; }
    if (tool === "ruler") {
      const c = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
      act = { kind: "ruler", p: [c.x, c.y, c.x, c.y] };
      return;
    }
    if (tool === "draw") {
      const snapped = drawShape === "free" ? p : { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 };
      act = { kind: "draw", line: { c: ink, w: inkW, shape: drawShape === "free" ? null : drawShape, p: [+snapped.x.toFixed(2), +snapped.y.toFixed(2), +snapped.x.toFixed(2), +snapped.y.toFixed(2)] } };
      return;
    }
    if (tool === "erase") { act = { kind: "erase", gone: new Set() }; eraseAt(p); return; }
    if (tool === "fog" && isDm()) {
      if (fogBox) act = { kind: "fogbox", a: p, b: p };
      else { act = { kind: "fog", cells: new Set() }; paintFogAt(p); }
      return;
    }
    const t = tokenAt(p);
    if (t) {
      selectToken(t.id);
      if (controls(t)) { act = { kind: "token", id: t.id, ox: t.x, oy: t.y, x: t.x, y: t.y, dx: p.x - t.x, dy: p.y - t.y, moved: false, sx, sy }; return; }
    } else if (sel) selectToken(null);
    act = { kind: "pan", sx, sy, cx: cam.x, cy: cam.y, click: true };
  });
  viewport.addEventListener("pointermove", e => {
    if (!S) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, screenPt(e));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy), mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
      const wx = cam.x + pinch.mx / cam.z, wy = cam.y + pinch.my / cam.z;
      cam.z = Math.max(ZMIN, Math.min(ZMAX, pinch.z * d / pinch.d));
      cam.x = wx - mx / cam.z;
      cam.y = wy - my / cam.z;
      pinch.mx = mx; pinch.my = my;
      redraw();
      return;
    }
    const p = worldPt(e), { sx, sy } = screenPt(e);
    hover = p;
    if (!act) {
      if (tool === "select") { const t = tokenAt(p); viewport.classList.toggle("on-token", !!(t && controls(t))); }
      if (tool === "fog") redraw();
      return;
    }
    if (act.kind === "pan") {
      cam.x = act.cx - (sx - act.sx) / cam.z;
      cam.y = act.cy - (sy - act.sy) / cam.z;
      if (Math.abs(sx - act.sx) + Math.abs(sy - act.sy) > 4) { act.click = false; viewport.classList.add("panning"); }
      redraw();
    } else if (act.kind === "token") {
      if (!act.moved && Math.abs(sx - act.sx) + Math.abs(sy - act.sy) < 4) return;
      act.moved = true;
      act.x = p.x - act.dx;
      act.y = p.y - act.dy;
      sendDrag(act.id, act.x, act.y);
      const t = tokenById(act.id), s = snap(t, act.x, act.y);
      act.sx2 = s;
      redraw();
    } else if (act.kind === "ruler") {
      const c = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
      act.p[act.p.length - 2] = c.x;
      act.p[act.p.length - 1] = c.y;
      sendRuler(act.p);
      redraw();
    } else if (act.kind === "draw") {
      const q = act.line.p;
      if (!act.line.shape) {
        const lx = q[q.length - 2], ly = q[q.length - 1];
        if (Math.hypot(p.x - lx, p.y - ly) > 0.08 && q.length < LIM.linePts - 2) q.push(+p.x.toFixed(2), +p.y.toFixed(2));
      } else {
        const s = { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 };
        q[2] = s.x; q[3] = s.y;
      }
      redraw();
    } else if (act.kind === "erase") eraseAt(p);
    else if (act.kind === "fog") paintFogAt(p);
    else if (act.kind === "fogbox") { act.b = p; redraw(); }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (!act) return;
    const a = act;
    act = null;
    viewport.classList.remove("panning");
    if (a.kind === "token") {
      if (a.moved) {
        const t = tokenById(a.id), s = snap(t, a.x, a.y);
        t.x = s.x; t.y = s.y;
        action("tok_move", { sc: viewSc, id: a.id, x: s.x, y: s.y });
      }
    } else if (a.kind === "ruler") {
      live({ k: "ruler", sc: viewSc, off: true });
    } else if (a.kind === "draw") {
      const q = a.line.p;
      const big = a.line.shape ? Math.hypot(q[2] - q[0], q[3] - q[1]) > 0.2 : q.length > 4 || Math.hypot(q[2] - q[0], q[3] - q[1]) > 0.05;
      if (big) {
        scene().lines.push({ ...a.line, id: "tmp", by: me });
        action("line_add", { sc: viewSc, line: a.line });
      }
    } else if (a.kind === "fog") sendFog(a.cells);
    else if (a.kind === "fogbox") {
      const sc = scene(), [x0, y0, x1, y1] = boxCells(a.a, a.b), cells = new Set();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { cells.add(y * sc.cols + x); fogLocal.set(y * sc.cols + x, fogShow ? "1" : "0"); }
      sendFog(cells);
    }
    redraw();
  }
  function cancelAct() {
    if (act && act.kind === "ruler") live({ k: "ruler", sc: viewSc, off: true });
    act = null;
    viewport.classList.remove("panning");
    redraw();
  }
  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); pinch = null; cancelAct(); });
  viewport.addEventListener("pointerleave", () => { hover = null; if (tool === "fog") redraw(); });
  viewport.addEventListener("contextmenu", e => e.preventDefault());
  viewport.addEventListener("dblclick", e => {
    const t = tokenAt(worldPt(e));
    if (t && t.char) openSheet(t.char);
  });
  viewport.addEventListener("wheel", e => {
    e.preventDefault();
    const { sx, sy } = screenPt(e);
    zoomAt(cam.z * Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 30 : 1)), sx, sy);
  }, { passive: false });
  addEventListener("resize", resize);

  const typing = () => { const a = document.activeElement; return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable); };
  addEventListener("keydown", e => {
    if (!S || $("gameView").hidden) return;
    if (e.key === "Escape") {
      if (!$("sheet").hidden) return closeModal("sheet");
      if (!$("tokenForm").hidden) return closeModal("tokenForm");
      if (act) return cancelAct();
      selectToken(null);
      return;
    }
    if (typing() || !$("sheet").hidden || !$("tokenForm").hidden) return;
    if (e.key === " ") { spaceDown = true; e.preventDefault(); return; }
    const keys = { v: "select", r: "ruler", d: "draw", e: "erase", g: "ping", f: "fog" };
    const k = e.key.toLowerCase();
    if (keys[k] && !e.ctrlKey && !e.metaKey && (k !== "f" || isDm())) { setTool(keys[k]); return; }
    const t = sel && tokenById(sel);
    if (t && controls(t)) {
      const step = t.size < 1 ? 0.5 : 1;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault();
        t.x += mv[0]; t.y += mv[1];
        action("tok_move", { sc: viewSc, id: t.id, x: t.x, y: t.y });
        redraw();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        action("tok_del", { sc: viewSc, id: t.id });
        selectToken(null);
      }
    }
  });
  addEventListener("keyup", e => { if (e.key === " ") spaceDown = false; });

  // ---- Tools ---------------------------------------------------------------------------------
  function setTool(t) {
    tool = t;
    viewport.dataset.tool = t;
    document.querySelectorAll(".tt-tools [data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
    renderToolOpts();
    redraw();
  }
  function seg(items, on, pick) {
    const d = document.createElement("div");
    d.className = "seg";
    for (const [v, label] of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.classList.toggle("on", v === on);
      b.addEventListener("click", () => { pick(v); renderToolOpts(); });
      d.append(b);
    }
    return d;
  }
  function renderToolOpts() {
    const box = $("toolOpts");
    box.innerHTML = "";
    box.hidden = !["draw", "fog", "ruler", "erase", "ping"].includes(tool);
    const p = html => { const el = document.createElement("p"); el.className = "muted small"; el.style.margin = 0; el.innerHTML = html; return el; };
    if (tool === "draw") {
      box.append(seg([["free", "Pen"], ["line", "Line"], ["rect", "Square"], ["circle", "Circle"], ["cone", "Cone"]], drawShape, v => { drawShape = v; }));
      const sw = document.createElement("div");
      sw.className = "row";
      for (const c of INK) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sw" + (c === ink ? " on" : "");
        b.style.setProperty("--c", c);
        b.setAttribute("aria-label", "Colour " + c);
        b.addEventListener("click", () => { ink = c; renderToolOpts(); });
        sw.append(b);
      }
      box.append(sw, seg([[2, "Thin"], [4, "Medium"], [8, "Thick"]], inkW, v => { inkW = v; }));
      box.append(p(drawShape === "free" ? "Draw on the map. Everyone sees it." : "Drag out a spell area. It shows its size as you go."));
    } else if (tool === "fog") {
      box.append(seg([[true, "Reveal"], [false, "Hide"]], fogShow, v => { fogShow = v; }));
      box.append(seg([[false, "Brush"], [true, "Box"]], fogBox, v => { fogBox = v; }));
      if (!fogBox) box.append(seg([[1, "1 sq"], [3, "3 sq"], [5, "5 sq"]], fogBrush, v => { fogBrush = v; }));
      const sc = scene();
      if (sc && !sc.fog) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn primary small-btn";
        b.textContent = "Turn fog on for this scene";
        b.addEventListener("click", () => action("scene_edit", { sc: sc.id, fog: true }));
        box.append(p("Fog is off on this scene, so players see the whole map."), b);
      } else box.append(p("Paint squares to reveal or hide them. Players see hidden squares as black, and monsters there aren't shown to them."));
    } else if (tool === "ruler") box.append(p(`Drag to measure. Everyone sees your ruler. Each square is ${per()} ${esc(unit())}.`));
    else if (tool === "erase") box.append(p(isDm() ? "Drag over drawings to rub them out." : "Drag over your drawings to rub them out."));
    else if (tool === "ping") box.append(p("Click to make everyone look at a spot. Alt+click pings with any tool."));
  }

  // ---- Selected token ------------------------------------------------------------------------
  function selectToken(id) {
    sel = id;
    renderCard(true);
    redraw();
  }
  function renderCard(force) {
    const card = $("tokenCard");
    const t = sel && tokenById(sel);
    if (!t) { card.hidden = true; card.dataset.id = ""; return; }
    if (!force && card.dataset.id === t.id && card.contains(document.activeElement)) return;
    card.dataset.id = t.id;
    card.hidden = false;
    const can = controls(t), dm = isDm(), ch = charById(t.char);
    const hpKnown = t.hp != null || t.mhp != null;
    let h = `<div class="row between">${can ? `<input class="name" data-k="name" value="${esc(t.name)}" maxlength="40" aria-label="Token name">` : `<h3>${esc(t.name)}</h3>`}
      <button type="button" class="x" data-close aria-label="Close">✕</button></div>`;
    if (ch) h += `<button type="button" class="link-btn" data-sheet>${esc(ch.name)}'s sheet</button>`;
    if (hpKnown) {
      const f = t.mhp ? Math.max(0, Math.min(1, t.hp / t.mhp)) : 0;
      h += `<div class="hpbar"><i style="width:${f * 100}%"></i><b>${t.hp ?? "?"} / ${t.mhp ?? "?"} HP</b></div>`;
    } else if (t.look) h += `<p class="small">Looks <span class="look ${t.look}">${t.look === "down" ? "down" : t.look}</span></p>`;
    if (can) {
      h += `<div class="row"><label class="small muted">HP <input type="number" class="num" data-k="hp" value="${t.hp ?? ""}"></label>
        <label class="small muted">Max <input type="number" class="num" data-k="mhp" value="${t.mhp ?? ""}"></label>
        <label class="small muted">AC <input type="number" class="num" data-k="ac" value="${t.ac ?? ""}"></label></div>
        <div class="row"><input type="number" class="num" id="hpDelta" min="0" placeholder="Amount" aria-label="Damage or healing">
        <button type="button" class="btn danger small-btn" data-hp="-1">Damage</button><button type="button" class="btn small-btn" data-hp="1">Heal</button></div>`;
    } else if (t.ac != null) h += `<p class="small">AC ${t.ac}</p>`;
    h += `<div class="conds">${(can ? S.conditions : t.conds).map(c => `<button type="button" class="chip${t.conds.includes(c) ? " on" : ""}" data-cond="${c}"${can ? "" : " disabled"}>${c}</button>`).join("")}</div>`;
    if (can) {
      h += `<div class="row">${TOKEN_COLOURS.map(c => `<button type="button" class="sw${c === t.c ? " on" : ""}" style="--c:${c}" data-colour="${c}" aria-label="Colour"></button>`).join("")}</div>
        <div class="row"><label class="small muted">Size <select data-k="size">${[[0.5, "Tiny"], [1, "Medium (1 sq)"], [2, "Large (2)"], [3, "Huge (3)"], [4, "Gargantuan (4)"], [6, "Colossal (6)"]].map(([v, l]) => `<option value="${v}"${v === t.size ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        ${ch ? "" : `<label class="small muted">Init bonus <input type="number" class="num" data-k="init" value="${t.init ?? ""}"></label>`}</div>`;
      if (dm) {
        const people = Object.entries(S.names).filter(([q]) => !S.dms.includes(q));
        h += `<div class="row"><label class="check"><input type="checkbox" data-k="hidden"${t.hidden ? " checked" : ""}> Hidden from players</label>
          <label class="check"><input type="checkbox" data-k="showhp"${t.showhp ? " checked" : ""}> Players see HP</label></div>
          <div class="row"><label class="small muted">Moved by <select data-k="owner"><option value="">DM only</option>${people.map(([q, n]) => `<option value="${q}"${t.owner === q ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
          <label class="small muted">Sheet <select data-k="char"><option value="">None</option>${S.chars.map(c => `<option value="${c.id}"${t.char === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label></div>`;
      }
      h += `<label class="small muted">Note<textarea data-k="note" rows="2" maxlength="500" placeholder="${dm ? "Only DMs and whoever moves it see this" : "A note"}">${esc(t.note || "")}</textarea></label>`;
      h += `<div class="row"><button type="button" class="btn small-btn" data-init>Roll initiative</button>
        <button type="button" class="btn small-btn" data-pic>Picture</button><button type="button" class="btn small-btn" data-front>To front</button>
        <button type="button" class="btn danger small-btn" data-del>Delete</button></div>`;
    } else if (t.note) h += `<p class="small">${esc(t.note)}</p>`;
    card.innerHTML = h;
  }
  function editToken(t, set) {
    Object.assign(t, set);
    action("tok_edit", { sc: viewSc, id: t.id, set });
    redraw();
  }
  function initCard() {
    const card = $("tokenCard");
    card.addEventListener("click", async e => {
      const t = sel && tokenById(sel);
      if (!t) return;
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.close != null) return selectToken(null);
      if (b.dataset.sheet != null) return openSheet(t.char);
      if (b.dataset.cond) {
        const conds = t.conds.includes(b.dataset.cond) ? t.conds.filter(c => c !== b.dataset.cond) : [...t.conds, b.dataset.cond];
        editToken(t, { conds });
        return renderCard(true);
      }
      if (b.dataset.colour) { editToken(t, { c: b.dataset.colour }); return renderCard(true); }
      if (b.dataset.hp) {
        const n = Math.abs(parseInt($("hpDelta").value, 10));
        if (!n) { $("hpDelta").focus(); return note("Type how much damage or healing first."); }
        let hp = (t.hp ?? t.mhp ?? 0) + n * Number(b.dataset.hp);
        const ch = charById(t.char);
        if (Number(b.dataset.hp) < 0 && ch && ch.thp) {           // temporary HP goes first
          const soak = Math.min(ch.thp, n);
          action("char_edit", { id: ch.id, set: { thp: ch.thp - soak } });
          hp = (t.hp ?? 0) - (n - soak);
        }
        if (t.mhp && hp > t.mhp) hp = t.mhp;
        editToken(t, { hp });
        return renderCard(true);
      }
      if (b.dataset.init != null) return action("init_add", { sc: viewSc, ids: [t.id], roll: true });
      if (b.dataset.front != null) return action("tok_front", { sc: viewSc, id: t.id });
      if (b.dataset.del != null) { action("tok_del", { sc: viewSc, id: t.id }); return selectToken(null); }
      if (b.dataset.pic != null) {
        const f = await pickFile();
        if (!f) return;
        try { action("tok_img", { sc: viewSc, id: t.id, src: (await shrink(f, 256, true)).url }); }
        catch { note("That picture couldn't be used. Try a PNG or JPG."); }
      }
    });
    card.addEventListener("change", e => {
      const t = sel && tokenById(sel), k = e.target.dataset.k;
      if (!t || !k) return;
      let v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (["hp", "mhp", "ac", "init"].includes(k)) v = v === "" ? null : Number(v);
      if (k === "size") v = Number(v);
      editToken(t, { [k]: v });
      if (k !== "name" && k !== "note") renderCard(true);
    });
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target.id === "hpDelta") { e.preventDefault(); card.querySelector('[data-hp="-1"]').click(); }
    });
  }

  // ---- Adding tokens -------------------------------------------------------------------------
  let newTokPic = null;
  function openTokenForm(prefill = {}) {
    const box = $("tokenForm"), dm = isDm();
    newTokPic = null;
    const mine = S.chars.filter(c => dm || c.owner === me);
    box.innerHTML = `<form class="win narrow" autocomplete="off">
      <div class="row between"><h2 style="margin:0">Add a token</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>
      ${mine.length ? `<label class="field">From a character<select name="char"><option value="">None, a new token</option>${mine.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>` : ""}
      <div class="form-grid">
        <label class="field full">Name<input name="name" maxlength="40" value="${esc(prefill.name || "")}" placeholder="${dm ? "Goblin, Guard captain…" : "Your character"}"></label>
        <label class="field">HP<input name="hp" type="number" min="0"></label>
        <label class="field">AC<input name="ac" type="number" min="0"></label>
        <label class="field">Initiative bonus<input name="init" type="number"></label>
        <label class="field">Size<select name="size"><option value="0.5">Tiny</option><option value="1" selected>Medium (1 square)</option><option value="2">Large (2)</option><option value="3">Huge (3)</option><option value="4">Gargantuan (4)</option></select></label>
        ${dm ? `<label class="field">How many<input name="count" type="number" min="1" max="20" value="1"></label>
        <label class="check full"><input name="hidden" type="checkbox"> Hidden from players for now</label>` : ""}
      </div>
      <div class="row">${TOKEN_COLOURS.map((c, i) => `<button type="button" class="sw${i === (dm ? 0 : 5) ? " on" : ""}" style="--c:${c}" data-colour="${c}" aria-label="Colour"></button>`).join("")}</div>
      <div class="row"><button type="button" class="btn small-btn" data-pic>Add a picture</button><span class="muted small" data-picnote></span></div>
      <button class="btn primary" type="submit">Put it on the map</button>
    </form>`;
    let c = TOKEN_COLOURS[dm ? 0 : 5];
    const form = box.querySelector("form");
    box.hidden = false;
    form.elements.name.focus();
    form.addEventListener("click", async e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.close != null) closeModal("tokenForm");
      else if (b.dataset.colour) { c = b.dataset.colour; form.querySelectorAll(".sw").forEach(x => x.classList.toggle("on", x === b)); }
      else if (b.dataset.pic != null) {
        const f = await pickFile();
        if (!f) return;
        try { newTokPic = (await shrink(f, 256, true)).url; form.querySelector("[data-picnote]").textContent = f.name; }
        catch { note("That picture couldn't be used. Try a PNG or JPG."); }
      }
    });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const F = form.elements, sc = scene();
      const chId = F.char ? F.char.value : "";
      const ch = charById(chId);
      const vx = cam.x + (viewport.clientWidth - panelW()) / 2 / cam.z, vy = cam.y + viewport.clientHeight / 2 / cam.z;
      const size = Number(F.size.value);
      const tok = {
        name: F.name.value.trim() || (ch ? ch.name : "Token"), c: ch ? ch.c : c, size,
        x: Math.max(0, Math.min(sc.cols - size, Math.floor(vx))), y: Math.max(0, Math.min(sc.rows - size, Math.floor(vy))),
        hp: F.hp.value === "" ? null : Number(F.hp.value), mhp: F.hp.value === "" ? null : Number(F.hp.value),
        ac: F.ac.value === "" ? null : Number(F.ac.value), init: F.init.value === "" ? null : Number(F.init.value),
      };
      if (ch) tok.char = ch.id;
      if (dm && F.hidden.checked) tok.hidden = true;
      if (newTokPic) tok.src = newTokPic;
      action("tok_add", { sc: sc.id, tok, count: dm ? Number(F.count.value) || 1 : 1 });
      closeModal("tokenForm");
    });
  }
  function closeModal(id) {
    const m = $(id);
    m.hidden = true;
    m.innerHTML = "";
    if (id === "sheet") sheetId = null;
  }

  // ---- Chat and dice -------------------------------------------------------------------------
  function rollHtml(r) {
    const parts = r.parts.map(p => {
      if (p.n != null) return p.n < 0 ? `− ${-p.n}` : `+ ${p.n}`;
      const sides = Number(p.d.replace(/^-/, "").split("d")[1].replace(/\D.*$/, ""));
      const dice = p.r.map((v, i) => {
        const cls = sides > 2 && v === sides ? "max" : sides > 2 && v === 1 ? "min" : "";
        const txt = `<span class="${cls}">${v}</span>`;
        return p.k.includes(i) ? txt : `<s>${txt}</s>`;
      }).join(", ");
      return `${p.d.startsWith("-") ? "− " : "+ "}${p.d.replace(/^-/, "")} [${dice}]`;
    }).join(" ").replace(/^\+ /, "");
    return parts;
  }
  function logItem(e) {
    const li = document.createElement("li");
    if (e.to) li.classList.add("priv");
    const time = new Date(e.at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const priv = e.to ? `<span class="priv-tag">to DM</span>` : "";
    if (e.kind === "sys") li.innerHTML = `<span class="sys">${esc(e.text)}</span>`;
    else if (e.kind === "chat") li.innerHTML = `<span class="who" style="color:${colourOf(e.by)}">${esc(e.who)}</span>${priv}<span class="time">${time}</span><br>${esc(e.text)}`;
    else {
      const r = e.roll;
      li.innerHTML = `<div class="roll${r.crit ? " crit-" + r.crit : ""}"><div class="top"><span><span class="who" style="color:${colourOf(e.by)}">${esc(e.who)}</span>${esc(e.text || "rolled")}${priv}</span>
        <span class="total">${r.total}</span></div><span class="how">${esc(r.expr)}: ${rollHtml(r)}${r.crit === "hit" ? " · natural 20!" : r.crit === "miss" ? " · natural 1" : ""}</span></div>`;
    }
    return li;
  }
  function renderLog(old) {
    const ol = $("log");
    const list = S.log;
    const lastId = list.length ? list[list.length - 1].id : 0;
    const near = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 60;
    const fresh = !old || !list.length || !ol.children.length || list[0].id > lastLog || lastId < lastLog;
    if (fresh) {
      ol.innerHTML = "";
      for (const e of list) ol.append(logItem(e));
    } else {
      const added = list.filter(e => e.id > lastLog);
      for (const e of added) ol.append(logItem(e));
      while (ol.children.length > list.length) ol.firstChild.remove();
      if (added.length) {
        if (added.some(e => e.kind === "roll")) FX.sound("roll");
        else if (added.some(e => e.kind === "chat" && e.by !== me)) FX.sound("tick");
        if (tab !== "chat") $$tab("chat").classList.add("ping");
      }
    }
    lastLog = lastId;
    if (near || fresh) ol.scrollTop = ol.scrollHeight;
  }
  function roll(expr, label, as) {
    action("roll", { expr, label: label || "", as: as || "", mode: rollMode, to: $("toDm").checked ? "dm" : "" });
  }
  function initChat() {
    const db = $("diceBtns");
    for (const n of [4, 6, 8, 10, 12, 20, 100]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "die";
      b.textContent = "d" + n;
      b.addEventListener("click", () => roll("1d" + n, n === 20 && rollMode ? (rollMode === "adv" ? "with advantage" : "with disadvantage") : ""));
      db.append(b);
    }
    $("rollMode").addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      rollMode = b.dataset.mode;
      $("rollMode").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    });
    $("chatForm").addEventListener("submit", e => {
      e.preventDefault();
      const v = $("chatInput").value.trim();
      if (!v) return;
      const m = v.match(/^\/(?:r|roll)\s+(.+)$/i);
      if (m) roll(m[1]);
      else if (/^\d*d(\d+|%)([\s+\-\dkhld%]|adv|dis)*$/i.test(v)) roll(v);
      else action("chat", { text: v, to: $("toDm").checked ? "dm" : "" });
      $("chatInput").value = "";
    });
  }

  // ---- Turn order ----------------------------------------------------------------------------
  function renderTurnBanner() {
    const b = $("turnBanner"), init = S.init;
    if (!init.cur) { b.hidden = true; return; }
    const cur = init.list.find(e => e.id === init.cur);
    b.hidden = false;
    b.textContent = `Round ${init.round} · ${cur ? cur.name + "'s turn" : "the DM's turn"}`;
    const mine = cur && cur.tok && (() => { for (const sc of S.scenes) { const t = sc.tokens.find(x => x.id === cur.tok); if (t) return t.owner === me || (charById(t.char) || {}).owner === me; } return false; })();
    if (mine && myTurnSeen !== init.cur + ":" + init.round) { FX.sound("ding"); note("It's your turn!"); }
    myTurnSeen = init.cur + ":" + init.round;
  }
  function renderTurns() {
    const init = S.init, ol = $("initList");
    $("roundLabel").textContent = init.round ? `Round ${init.round}` : "Turn order";
    $("initEmpty").hidden = init.list.length > 0;
    if (ol.contains(document.activeElement)) return;
    ol.innerHTML = init.list.map(e => {
      const can = isDm() || e.by === me;
      return `<li class="${e.id === init.cur ? "cur" : ""}${e.hidden ? " hid" : ""}" data-id="${e.id}">
        ${can ? `<input type="number" value="${e.val ?? ""}" data-val aria-label="Initiative for ${esc(e.name)}">` : `<span class="val">${e.val ?? "–"}</span>`}
        <span class="nm" data-go>${esc(e.name)}${e.hidden ? "<small>hidden</small>" : ""}${e.pc ? "" : ""}</span>
        ${can ? `<button type="button" class="tb" data-roll title="Roll initiative" aria-label="Roll initiative" style="width:30px;height:30px">🎲</button><button type="button" class="x" data-del aria-label="Remove">✕</button>` : ""}</li>`;
    }).join("");
    $("nextTurn").textContent = init.cur ? "Next turn" : "Start fight";
  }
  function initTurns() {
    const ol = $("initList");
    ol.addEventListener("change", e => {
      const li = e.target.closest("li");
      if (li && e.target.dataset.val != null) action("init_set", { id: li.dataset.id, val: e.target.value === "" ? null : Number(e.target.value) });
    });
    ol.addEventListener("click", e => {
      const li = e.target.closest("li");
      if (!li) return;
      const en = S.init.list.find(x => x.id === li.dataset.id);
      if (e.target.closest("[data-roll]")) action("init_roll", { id: li.dataset.id });
      else if (e.target.closest("[data-del]")) action("init_del", { id: li.dataset.id });
      else if (e.target.closest("[data-go]") && en && en.tok) {
        if (isDm() && en.sc && en.sc !== viewSc) { viewSc = en.sc; renderAll(); }
        const t = tokenById(en.tok);
        if (t) { centreOn(t.x + t.size / 2, t.y + t.size / 2); selectToken(t.id); }
      }
    });
    $("nextTurn").addEventListener("click", () => action("init_next"));
    $("prevTurn").addEventListener("click", () => action("init_prev"));
    $("initEnd").addEventListener("click", () => { if (confirm("End the fight and clear the turn order?")) action("init_clear"); });
    $("initSel").addEventListener("click", () => {
      if (!sel) return note("Click a token on the map first.");
      action("init_add", { sc: viewSc, ids: [sel], roll: true });
    });
    $("initAll").addEventListener("click", () => {
      const sc = scene();
      if (!sc.tokens.length) return note("There are no tokens on this map.");
      action("init_add", { sc: sc.id, ids: sc.tokens.map(t => t.id), roll: true });
    });
    $("initForm").addEventListener("submit", e => {
      e.preventDefault();
      const name = $("initName").value.trim();
      if (!name) return $("initName").focus();
      action("init_add", { name, val: $("initVal").value === "" ? null : Number($("initVal").value) });
      $("initName").value = $("initVal").value = "";
    });
  }

  // ---- Party (character list) ----------------------------------------------------------------
  function face(ch, big) {
    const img = ch.img ? `background-image:url('${assetUrl(ch.img)}');` : "";
    return `<span class="face"${big ? " data-portrait" : ""} style="--c:${ch.c};${img}">${ch.img ? "" : esc(initials(ch.name))}</span>`;
  }
  function renderParty() {
    const ul = $("charList");
    $("charEmpty").hidden = S.chars.length > 0;
    ul.innerHTML = S.chars.map(ch => {
      const f = ch.mhp ? Math.max(0, Math.min(1, ch.hp / ch.mhp)) : 0;
      const can = ownsChar(ch);
      return `<li data-id="${ch.id}">${face(ch)}<div class="info"><b>${esc(ch.name)}</b>
        <span class="muted small">${esc(ch.kind || "Level " + ch.level)} · ${esc(nameOf(ch.owner))}</span>
        <div class="hpbar"><i style="width:${f * 100}%"></i><b>${ch.hp}/${ch.mhp} HP${ch.thp ? ` +${ch.thp}` : ""} · AC ${ch.ac}</b></div></div>
        <div class="btns"><button type="button" class="btn small-btn" data-open>Sheet</button>${can ? `<button type="button" class="btn small-btn" data-place>On map</button>` : ""}</div></li>`;
    }).join("");
  }
  function placeChar(ch) {
    const sc = scene();
    if (sc.tokens.some(t => t.char === ch.id)) {
      const t = sc.tokens.find(x => x.char === ch.id);
      centreOn(t.x + 0.5, t.y + 0.5);
      selectToken(t.id);
      return note(`${ch.name} is already on this map.`);
    }
    const vx = cam.x + (viewport.clientWidth - panelW()) / 2 / cam.z, vy = cam.y + viewport.clientHeight / 2 / cam.z;
    action("tok_add", { sc: sc.id, tok: { name: ch.name, char: ch.id, c: ch.c, x: Math.max(0, Math.min(sc.cols - 1, Math.floor(vx))), y: Math.max(0, Math.min(sc.rows - 1, Math.floor(vy))) } });
  }
  function initParty() {
    $("newChar").addEventListener("click", () => action("char_add", { name: AceLive.name() + "'s character" }));
    $("charList").addEventListener("click", e => {
      const li = e.target.closest("li");
      const ch = li && charById(li.dataset.id);
      if (!ch) return;
      if (e.target.closest("[data-place]")) placeChar(ch);
      else openSheet(ch.id);
    });
  }

  // ---- Character sheet -----------------------------------------------------------------------
  let sheetId = null, sheetStale = false;
  function openSheet(id) {
    sheetId = id;
    $("sheet").hidden = false;
    renderSheet();
  }
  function refreshSheet() {
    if (!sheetId) return;
    if (!charById(sheetId)) { closeModal("sheet"); return; }
    if ($("sheet").contains(document.activeElement) && document.activeElement.matches("input:not([type=checkbox]), textarea")) { sheetStale = true; return; }
    renderSheet();
  }
  function renderSheet() {
    const ch = charById(sheetId);
    if (!ch) return;
    sheetStale = false;
    const can = ownsChar(ch), dis = can ? "" : " disabled";
    const scrollTop = $("sheet").firstElementChild ? $("sheet").firstElementChild.scrollTop : 0;
    const P = pb(ch);
    const inp = (f, v, extra = "") => `<input data-f="${f}" value="${esc(v)}"${dis}${extra}>`;
    const R = (expr, label, txt) => can ? `<span class="rollable" data-roll="${esc(expr)}" data-label="${esc(label)}" title="Roll ${esc(expr)}">${txt}</span>` : txt;
    const abil = ABIL.map(a => {
      const m = mod(ch.abil[a]), sv = saveBonus(ch, a);
      return `<div class="stat abil"><span class="lbl">${R("1d20" + sign(m), ABIL_NAME[a] + " check", ABIL_NAME[a])}</span>
        <span class="mod">${R("1d20" + sign(m), ABIL_NAME[a] + " check", sign(m))}</span>
        <input type="number" data-f="abil.${a}" value="${ch.abil[a]}" min="1" max="30"${dis} aria-label="${ABIL_NAME[a]} score">
        <label class="save"><input type="checkbox" data-f="saves:${a}"${ch.saves.includes(a) ? " checked" : ""}${dis}>${R("1d20" + sign(sv), ABIL_NAME[a] + " save", "Save " + sign(sv))}</label></div>`;
    }).join("");
    const skills = Object.keys(S.skills).map(sk => {
      const b = skillBonus(ch, sk);
      return `<li><input type="checkbox" data-f="skills:${sk}"${ch.skills.includes(sk) ? " checked" : ""}${dis} title="Proficient" aria-label="Proficient in ${sk}">
        <input type="checkbox" class="ex" data-f="expert:${sk}"${ch.expert.includes(sk) ? " checked" : ""}${dis} title="Expertise (double)" aria-label="Expertise in ${sk}">
        <span class="b">${sign(b)}</span>${R("1d20" + sign(b), sk[0].toUpperCase() + sk.slice(1), `<span style="text-transform:capitalize">${sk}</span>`)} <span class="ab">${S.skills[sk]}</span></li>`;
    }).join("");
    const atks = ch.attacks.map((a, i) => {
      const hit = parseInt(String(a.hit).replace(/\s/g, ""), 10);
      const dmg = (String(a.dmg).match(/^[\dd+\-\s%khl]+/i) || [""])[0].trim();
      return `<div class="atk"><input data-f="atk.${i}.n" value="${esc(a.n)}" placeholder="Longsword"${dis} aria-label="Attack name">
        <input data-f="atk.${i}.hit" value="${esc(a.hit)}" placeholder="+5"${dis} aria-label="To hit">
        <input data-f="atk.${i}.dmg" value="${esc(a.dmg)}" placeholder="1d8+3 slashing"${dis} aria-label="Damage">
        ${can ? `<button type="button" class="btn small-btn" data-roll="1d20${isNaN(hit) ? "" : sign(hit)}" data-label="${esc(a.n || "Attack")}: attack">Hit</button>
        <button type="button" class="btn small-btn" data-dmg="${esc(dmg)}" data-label="${esc(a.n || "Attack")}: damage" title="Shift+click for a critical hit (double dice)"${dmg ? "" : " disabled"}>Dmg</button>
        <button type="button" class="x" data-atkdel="${i}" aria-label="Remove attack">✕</button>` : ""}</div>`;
    }).join("");
    const ds = (k, cls) => [0, 1, 2].map(j => `<input type="checkbox" class="${cls}" data-f="ds.${k}.${j}"${ch.ds[k] > j ? " checked" : ""}${dis}>`).join("");
    const people = Object.entries(S.names);
    $("sheet").innerHTML = `<div class="win${can ? "" : " sheet-ro"}">
      <div class="win-head">${face(ch, can)}
        <div class="grow"><input class="big" id="sheetName" data-f="name" value="${esc(ch.name)}" maxlength="40"${dis} aria-label="Character name">
          <div class="row"><input data-f="kind" value="${esc(ch.kind)}" placeholder="Ancestry, class and background" maxlength="60"${dis} style="flex:1">
          <label class="small muted">Level <input type="number" class="num" data-f="level" value="${ch.level}" min="1" max="30"${dis}></label></div></div>
        <button type="button" class="x" data-close aria-label="Close" style="align-self:flex-start">✕</button></div>
      <div class="row between"><span class="muted small">Played by ${esc(nameOf(ch.owner))}${can ? " · click a name or bonus to roll it" : ""}</span>
        <span class="row">${can ? `<label class="check"><input type="checkbox" data-f="insp"${ch.insp ? " checked" : ""}> Inspiration</label>` : ""}
        ${isDm() ? `<select data-f="owner" aria-label="Played by">${people.map(([q, n]) => `<option value="${q}"${q === ch.owner ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
        ${can ? `<span class="row">${TOKEN_COLOURS.slice(0, 8).map(c => `<button type="button" class="sw${c === ch.c ? " on" : ""}" style="--c:${c};width:18px;height:18px" data-colour="${c}" aria-label="Colour"></button>`).join("")}</span>` : ""}</span></div>
      <div class="stats">
        <div class="stat"><label>AC</label><input type="number" data-f="ac" value="${ch.ac}"${dis}></div>
        <div class="stat"><label>HP</label><input type="number" data-f="hp" value="${ch.hp}"${dis}></div>
        <div class="stat"><label>Max HP</label><input type="number" data-f="mhp" value="${ch.mhp}"${dis}></div>
        <div class="stat"><label>Temp HP</label><input type="number" data-f="thp" value="${ch.thp}"${dis}></div>
        <div class="stat"><span class="lbl">${R("1d20" + sign(initBonus(ch)), "Initiative", "Initiative")}</span><span class="big">${R("1d20" + sign(initBonus(ch)), "Initiative", sign(initBonus(ch)))}</span></div>
        <div class="stat"><label>Init extra</label><input type="number" data-f="initb" value="${ch.initb}"${dis} title="Added to Dexterity for initiative"></div>
        <div class="stat"><label>Speed</label><input type="number" data-f="speed" value="${ch.speed}"${dis}></div>
        <div class="stat"><label>Proficiency</label><input type="number" data-f="pb" value="${ch.pb ?? ""}" placeholder="${sign(P)}"${dis} title="Leave empty to work it out from the level"></div>
        <div class="stat"><span class="lbl">Passive Perception</span><span class="big">${10 + skillBonus(ch, "perception")}</span></div>
      </div>
      <div class="sheet-grid">
        <div class="sec"><h4>Abilities</h4><div class="abils">${abil}</div>
          <h4>Death saves</h4><div class="ds"><span>Saves ${ds(0, "ok")}</span><span>Fails ${ds(1, "bad")}</span>
          ${can ? `<button type="button" class="btn small-btn" data-roll="1d20" data-label="Death save">Roll</button>` : ""}</div></div>
        <div class="sec"><h4>Skills <small class="muted" style="text-transform:none;letter-spacing:0">tick: proficient · gold: expertise</small></h4><ul class="skill-list">${skills}</ul></div>
      </div>
      <div class="sec"><h4>Attacks</h4>${atks || `<p class="muted small" style="margin:0">No attacks yet.</p>`}
        ${can ? `<button type="button" class="btn small-btn" data-atkadd style="align-self:flex-start">Add attack</button>` : ""}</div>
      <div class="form-grid">
        <label class="field">Features and traits<textarea data-f="feats" rows="5"${dis}>${esc(ch.feats)}</textarea></label>
        <label class="field">Spells and slots<textarea data-f="spells" rows="5"${dis}>${esc(ch.spells)}</textarea></label>
        <label class="field">Gear and money<textarea data-f="gear" rows="5"${dis}>${esc(ch.gear)}</textarea></label>
        <label class="field">Notes and backstory<textarea data-f="notes" rows="5"${dis}>${esc(ch.notes)}</textarea></label>
      </div>
      ${can ? `<div class="row between"><button type="button" class="btn small-btn" data-place>Put on the map</button><button type="button" class="btn danger small-btn" data-chardel>Delete character</button></div>` : ""}
    </div>`;
    $("sheet").firstElementChild.scrollTop = scrollTop;
  }
  function sheetSet(ch, set) {
    for (const [k, v] of Object.entries(set)) {
      if (k === "abil") Object.assign(ch.abil, v);
      else ch[k] = v;
    }
    action("char_edit", { id: ch.id, set });
  }
  function initSheet() {
    const box = $("sheet");
    box.addEventListener("click", async e => {
      if (e.target === box) return closeModal("sheet");
      const ch = charById(sheetId);
      if (!ch) return;
      const b = e.target.closest("button, .rollable, [data-portrait]");
      if (!b) return;
      if (b.dataset.close != null) return closeModal("sheet");
      if (b.dataset.roll) return roll(b.dataset.roll, b.dataset.label, ch.name);
      if (b.dataset.dmg) {
        let expr = b.dataset.dmg;
        if (e.shiftKey) expr = expr.replace(/(\d*)d(\d+)/gi, (_, n, s) => `${2 * (Number(n) || 1)}d${s}`);
        return roll(expr, b.dataset.label + (e.shiftKey ? " (critical)" : ""), ch.name);
      }
      if (!ownsChar(ch)) return;
      if (b.dataset.colour) { sheetSet(ch, { c: b.dataset.colour }); return renderSheet(); }
      if (b.dataset.atkadd != null) { sheetSet(ch, { attacks: [...ch.attacks, { n: "", hit: "", dmg: "" }] }); return renderSheet(); }
      if (b.dataset.atkdel != null) { sheetSet(ch, { attacks: ch.attacks.filter((_, i) => i !== Number(b.dataset.atkdel)) }); return renderSheet(); }
      if (b.dataset.place != null) { placeChar(ch); return closeModal("sheet"); }
      if (b.dataset.chardel != null) {
        if (confirm(`Delete ${ch.name}? This can't be undone.`)) { action("char_del", { id: ch.id }); closeModal("sheet"); }
        return;
      }
      if (b.dataset.portrait != null) {
        const f = await pickFile();
        if (!f) return;
        try { action("char_img", { id: ch.id, src: (await shrink(f, 256, true)).url }); }
        catch { note("That picture couldn't be used. Try a PNG or JPG."); }
      }
    });
    box.addEventListener("change", e => {
      const ch = charById(sheetId), f = e.target.dataset.f;
      if (!ch || !f || !ownsChar(ch)) return;
      const el = e.target, v = el.type === "checkbox" ? el.checked : el.value;
      if (f.startsWith("abil.")) sheetSet(ch, { abil: { [f.slice(5)]: Number(v) } });
      else if (f.includes(":")) {
        const [list, key] = f.split(":");
        sheetSet(ch, { [list]: v ? [...new Set([...ch[list], key])] : ch[list].filter(x => x !== key) });
      } else if (f.startsWith("ds.")) {
        const [, k, j] = f.split(".").map(Number);
        const ds = [...ch.ds];
        ds[k] = v ? j + 1 : j;
        sheetSet(ch, { ds });
      } else if (f.startsWith("atk.")) {
        const [, i, key] = f.split(".");
        const attacks = ch.attacks.map(a => ({ ...a }));
        attacks[Number(i)][key] = v;
        sheetSet(ch, { attacks });
      } else if (["level", "hp", "mhp", "thp", "ac", "speed", "initb"].includes(f)) sheetSet(ch, { [f]: Number(v) || 0 });
      else if (f === "pb") sheetSet(ch, { pb: v === "" ? null : Number(v) });
      else sheetSet(ch, { [f]: v });
      if (el.type === "checkbox" || el.type === "number" || el.tagName === "SELECT") renderSheet();
    });
    box.addEventListener("focusout", () => setTimeout(() => {
      if (sheetStale && !box.contains(document.activeElement)) renderSheet();
    }, 0));
  }

  // ---- Notes ---------------------------------------------------------------------------------
  const noteTimers = new Map();
  function renderNotes() {
    const ul = $("noteList");
    if (!ul.contains(document.activeElement)) {
      ul.innerHTML = S.notes.map(n => isDm()
        ? `<li data-id="${n.id}" class="${n.shared ? "shared" : ""}"><div class="row"><input class="title" value="${esc(n.title)}" data-k="title" maxlength="60" aria-label="Note title">
            <label class="check"><input type="checkbox" data-k="shared"${n.shared ? " checked" : ""}> Shared</label><button type="button" class="x" data-del aria-label="Delete note">✕</button></div>
            <textarea data-k="text" rows="4" aria-label="Note">${esc(n.text)}</textarea></li>`
        : `<li class="shared"><b>${esc(n.title)}</b><div class="note-text">${esc(n.text)}</div></li>`).join("");
    }
    $("noteEmpty").hidden = S.notes.length > 0;
    if (document.activeElement !== $("myNotes")) $("myNotes").value = S.mine || "";
  }
  function initNotes() {
    $("newNote").addEventListener("click", () => action("note_add", { title: "New note" }));
    const ul = $("noteList");
    ul.addEventListener("input", e => {
      const li = e.target.closest("li"), k = e.target.dataset.k;
      if (!li || !k || k === "shared") return;
      clearTimeout(noteTimers.get(li.dataset.id + k));
      noteTimers.set(li.dataset.id + k, setTimeout(() => action("note_edit", { id: li.dataset.id, [k]: e.target.value }), 700));
    });
    ul.addEventListener("change", e => {
      const li = e.target.closest("li");
      if (li && e.target.dataset.k === "shared") action("note_edit", { id: li.dataset.id, shared: e.target.checked });
    });
    ul.addEventListener("click", e => {
      const li = e.target.closest("li");
      if (li && e.target.closest("[data-del]") && confirm("Delete this note?")) action("note_del", { id: li.dataset.id });
    });
    let t = 0;
    $("myNotes").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => action("my_notes", { text: $("myNotes").value }), 700); });
  }

  // ---- Scenes (DM) ---------------------------------------------------------------------------
  function renderScenes() {
    if (!isDm()) return;
    const ul = $("sceneList");
    ul.innerHTML = S.scenes.map((sc, i) => `<li data-id="${sc.id}" class="${sc.id === viewSc ? "viewing" : ""}">
      <span class="nm">${esc(sc.name)}</span>${sc.id === S.active ? `<span class="badge dm">Players here</span>` : ""}
      <button type="button" class="mini" data-up${i === 0 ? " disabled" : ""} aria-label="Move up">↑</button>
      <button type="button" class="mini" data-down${i === S.scenes.length - 1 ? " disabled" : ""} aria-label="Move down">↓</button></li>`).join("");
    refreshSceneEdit();
  }
  function refreshSceneEdit() {
    if (!isDm()) return;
    const box = $("sceneEdit"), sc = scene();
    if (!sc || box.contains(document.activeElement)) return;
    const img = picture(sc.img);
    box.innerHTML = `<label class="field">Scene name<input data-k="name" value="${esc(sc.name)}" maxlength="40"></label>
      <div class="row"><button type="button" class="btn small-btn" data-map>${sc.img ? "Change map picture" : "Add a map picture"}</button>
        ${sc.img ? `<button type="button" class="btn small-btn" data-nomap>Remove picture</button>` : ""}</div>
      <p class="muted small" style="margin:0">${sc.img ? "Line the grid up with the map: set how many squares wide the map is, then nudge it." : "No picture: a blank grid. Draw on it, or add a map picture."}</p>
      <div class="row"><label class="small muted">Squares across <input type="number" class="num" data-k="cols" value="${sc.cols}" min="1" max="${LIM.grid}"></label>
        <label class="small muted">Down <input type="number" class="num" data-k="rows" value="${sc.rows}" min="1" max="${LIM.grid}"${img ? " title=\"Worked out from the picture\"" : ""}></label></div>
      ${sc.img ? `<label class="small muted">Nudge map left / right<input type="range" min="-1" max="1" step="0.01" data-k="ox" value="${sc.ox}"></label>
        <label class="small muted">Nudge map up / down<input type="range" min="-1" max="1" step="0.01" data-k="oy" value="${sc.oy}"></label>` : ""}
      <div class="row"><label class="check"><input type="checkbox" data-k="grid"${sc.grid ? " checked" : ""}> Show grid</label>
        ${["#000000", "#ffffff", "#7c3aed"].map(c => `<button type="button" class="sw${sc.gc === c ? " on" : ""}" style="--c:${c}" data-gc="${c}" aria-label="Grid colour"></button>`).join("")}</div>
      <div class="row"><label class="check"><input type="checkbox" data-k="fog"${sc.fog ? " checked" : ""}> Fog of war</label>
        ${sc.fog ? `<button type="button" class="btn small-btn" data-fogall="1">Reveal all</button><button type="button" class="btn small-btn" data-fogall="0">Hide all</button>` : ""}</div>
      <div class="row">${sc.id !== S.active ? `<button type="button" class="btn primary small-btn" data-show>Show to players</button>` : ""}
        <button type="button" class="btn small-btn" data-copy>Copy scene</button><button type="button" class="btn danger small-btn" data-del>Delete scene</button></div>`;
  }
  function rowsFor(sc, cols) {
    const img = picture(sc.img);
    return img ? Math.max(1, Math.min(LIM.grid, Math.round(cols * img.naturalHeight / img.naturalWidth))) : sc.rows;
  }
  function initScenes() {
    $("newScene").addEventListener("click", () => {
      const name = prompt("Name the new scene:", "Scene " + (S.scenes.length + 1));
      if (name !== null) action("scene_add", { name: name.trim() || "New scene", cols: 24, rows: 16 });
    });
    $("sceneList").addEventListener("click", e => {
      const li = e.target.closest("li");
      if (!li) return;
      if (e.target.closest("[data-up]")) return action("scene_move", { sc: li.dataset.id });
      if (e.target.closest("[data-down]")) return action("scene_move", { sc: li.dataset.id, down: true });
      viewSc = li.dataset.id;
      selectToken(null);
      fitView();
      renderAll();
    });
    const box = $("sceneEdit");
    box.addEventListener("input", e => {
      const sc = scene(), k = e.target.dataset.k;
      if ((k === "ox" || k === "oy") && sc) { sc[k] = Number(e.target.value); redraw(); }
    });
    box.addEventListener("change", e => {
      const sc = scene(), k = e.target.dataset.k;
      if (!sc || !k) return;
      if (k === "grid" || k === "fog") action("scene_edit", { sc: sc.id, [k]: e.target.checked });
      else if (k === "name") action("scene_edit", { sc: sc.id, name: e.target.value });
      else if (k === "cols") { const cols = Number(e.target.value) || sc.cols; action("scene_edit", { sc: sc.id, cols, rows: rowsFor(sc, cols) }); }
      else if (k === "rows") action("scene_edit", { sc: sc.id, rows: Number(e.target.value) || sc.rows });
      else action("scene_edit", { sc: sc.id, [k]: Number(e.target.value) });
      e.target.blur();
    });
    box.addEventListener("click", async e => {
      const sc = scene(), b = e.target.closest("button");
      if (!sc || !b) return;
      if (b.dataset.gc) action("scene_edit", { sc: sc.id, gc: b.dataset.gc });
      else if (b.dataset.fogall) action("fog_all", { sc: sc.id, show: b.dataset.fogall === "1" });
      else if (b.dataset.show != null) action("scene_show", { sc: sc.id });
      else if (b.dataset.copy != null) action("scene_copy", { sc: sc.id });
      else if (b.dataset.nomap != null) action("scene_img", { sc: sc.id, src: "" });
      else if (b.dataset.del != null) { if (confirm(`Delete the scene "${sc.name}", with its tokens and drawings?`)) action("scene_del", { sc: sc.id }); }
      else if (b.dataset.map != null) {
        const f = await pickFile();
        if (!f) return;
        note("Getting the map ready…");
        try {
          const r = await shrink(f, 3200, false);
          // a first guess at the grid: most battle maps are 70 or 100 pixels a square
          const ppsq = [70, 100, 140, 50, 128, 256, 200].find(n => r.w % n === 0 && r.h % n === 0 && r.w / n <= LIM.grid) || 70;
          let cols = Math.max(1, Math.min(LIM.grid, Math.round(r.w / ppsq)));
          const rows = Math.max(1, Math.min(LIM.grid, Math.round(cols * r.h / r.w)));
          action("scene_img", { sc: sc.id, src: r.url, cols, rows });
          note(`Map added as ${cols} × ${rows} squares. Change Squares across if the grid doesn't match.`);
        } catch { note("That picture couldn't be used. Try a PNG or JPG."); }
      }
    });
    $("scenePick").addEventListener("change", e => { viewSc = e.target.value; selectToken(null); fitView(); renderAll(); });
    $("showScene").addEventListener("click", () => action("scene_show", { sc: viewSc }));
  }

  // ---- Room ----------------------------------------------------------------------------------
  function renderRoom() {
    $("campLink").value = campLink(slug);
    $("myName").textContent = nameOf(me);
    $("myRole").textContent = isDm() ? "DM" : "Player";
    $("myRole").className = "badge" + (isDm() ? " dm" : "");
    const online = new Set(S.players.filter(p => p.online).map(p => p.id));
    const ids = Object.keys(S.names).sort((a, b) => online.has(b) - online.has(a));
    $("people").innerHTML = ids.map(q => {
      const dm = S.dms.includes(q), owner = q === S.owner;
      return `<li><span class="dot${online.has(q) ? "" : " off"}"></span><span class="nm" style="color:${colourOf(q)}">${esc(S.names[q])}${q === me ? " (you)" : ""}</span>
        ${dm ? `<span class="badge dm">${owner ? "DM, maker" : "DM"}</span>` : ""}
        ${S.isOwner && !owner ? `<button type="button" class="link-btn" data-dm="${q}" data-on="${dm ? "" : "1"}">${dm ? "Make player" : "Make DM"}</button>` : ""}</li>`;
    }).join("");
    $("dmCode").textContent = S.dmcode || "";
    $("newCode").hidden = !S.isOwner;
    if (document.activeElement !== $("perSq")) $("perSq").value = S.settings.per;
    if (document.activeElement !== $("unit")) $("unit").value = S.settings.unit;
    $("deleteCamp").hidden = !S.isOwner;
  }
  function initRoom() {
    $("copyLink").addEventListener("click", () => copyText(campLink(slug), m => { $("linkNote").textContent = m; }));
    $("renameBtn").addEventListener("click", () => { $("renameForm").hidden = false; $("renameInput").value = AceLive.name(); $("renameInput").focus(); });
    $("renameForm").addEventListener("submit", e => {
      e.preventDefault();
      const n = $("renameInput").value.trim();
      if (!n) return;
      AceLive.setName(n);
      action("rename", { name: n });
      $("renameForm").hidden = true;
    });
    $("people").addEventListener("click", e => {
      const b = e.target.closest("[data-dm]");
      if (b) action("set_dm", { player: b.dataset.dm, on: !!b.dataset.on });
    });
    $("newCode").addEventListener("click", () => action("new_dm_code"));
    $("claimForm").addEventListener("submit", e => { e.preventDefault(); action("claim_dm", { code: $("claimCode").value }); $("claimCode").value = ""; });
    $("perSq").addEventListener("change", () => action("settings", { per: Number($("perSq").value) || 5 }));
    $("unit").addEventListener("change", () => action("settings", { unit: $("unit").value }));
    $("clearChat").addEventListener("click", () => { if (confirm("Clear the whole chat and roll history?")) action("clear_chat"); });
    $("deleteCamp").addEventListener("click", () => {
      if (confirm(`Delete "${S.camp.name}" for everyone, with all its maps, characters and notes? This can't be undone.`)) action("delete_campaign");
    });
  }

  // ---- Panel and tabs ------------------------------------------------------------------------
  let tab = "chat";
  const $$tab = name => document.querySelector(`.tt-tabs [data-tab="${name}"]`);
  function setTab(name) {
    tab = name;
    document.querySelectorAll(".tt-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
    document.querySelectorAll(".tt-pane").forEach(p => { p.hidden = p.dataset.pane !== name; });
    $$tab(name).classList.remove("ping");
    if (name === "chat") $("log").scrollTop = $("log").scrollHeight;
  }
  function setPanel(open) {
    $("panel").classList.toggle("closed", !open);
    $("panelBtn").setAttribute("aria-expanded", String(open));
    $("panelBtn").textContent = open ? "Close" : "Panel";
  }

  // ---- Start ---------------------------------------------------------------------------------
  function init() {
    document.querySelectorAll(".tt-tools [data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
    $("addTokenBtn").addEventListener("click", () => openTokenForm());
    $("tokenForm").addEventListener("click", e => { if (e.target === $("tokenForm")) closeModal("tokenForm"); });
    $("zoomIn").addEventListener("click", () => zoomAt(cam.z * 1.25));
    $("zoomOut").addEventListener("click", () => zoomAt(cam.z / 1.25));
    $("fitBtn").addEventListener("click", fitView);
    document.querySelectorAll(".tt-tabs button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("panelBtn").addEventListener("click", () => setPanel($("panel").classList.contains("closed")));
    initCard();
    initChat();
    initTurns();
    initParty();
    initSheet();
    initNotes();
    initScenes();
    initRoom();
    setTool("select");
    initStart();
  }
  init();
})();
