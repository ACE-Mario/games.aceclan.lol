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
  // For now the table is just the battle map: tokens, health and fog of war. The chat and dice, turn order,
  // character sheets and notes are all still here (and on the server); set this to true to bring them back.
  const EXTRAS = false;
  const MONSTERS = [
    ["Commoner", 4, 10, 0, 1], ["Kobold", 5, 12, 2, 1], ["Goblin", 7, 15, 2, 1], ["Giant rat", 7, 12, 2, 1],
    ["Cultist", 9, 12, 1, 1], ["Bandit", 11, 12, 1, 1], ["Guard", 11, 16, 1, 1], ["Wolf", 11, 13, 2, 1],
    ["Hobgoblin", 11, 18, 1, 1], ["Skeleton", 13, 13, 2, 1], ["Orc", 15, 13, 1, 1], ["Zombie", 22, 8, -2, 1],
    ["Ghoul", 22, 12, 2, 1], ["Gnoll", 22, 15, 1, 1], ["Giant spider", 26, 14, 3, 2], ["Priest", 27, 13, 0, 1],
    ["Bugbear", 27, 16, 2, 1], ["Brown bear", 34, 11, 0, 2], ["Dire wolf", 37, 14, 2, 2], ["Mage", 40, 12, 2, 1],
    ["Wight", 45, 14, 1, 1], ["Ghost", 45, 11, 1, 1], ["Knight", 52, 18, 0, 1], ["Ogre", 59, 11, -1, 2],
    ["Owlbear", 59, 13, 1, 2], ["Bandit captain", 65, 15, 3, 1], ["Troll", 84, 15, 1, 2], ["Young dragon", 133, 18, 0, 2],
  ];

  // Stat blocks for the ready-made monsters: speed | STR DEX CON INT WIS CHA | skills | saves | senses |
  // languages | challenge | traits (";" between) | actions (";" between, "Name +hit dice type").
  const STAT_DATA = {
    "Commoner": "30 ft|10 10 10 10 10 10|||passive Perception 10|any one language|0||Club +2 1d4 bludgeoning",
    "Kobold": "30 ft|7 15 9 8 7 8|||darkvision 60 ft, passive Perception 8|Common, Draconic|1/8|Sunlight Sensitivity: disadvantage on attacks and sight-based Perception in sunlight.;Pack Tactics: advantage on an attack if an ally is next to the target.|Dagger +4 1d4+2 piercing;Sling +4 1d4+2 bludgeoning (range 30/120)",
    "Goblin": "30 ft|8 14 10 10 8 8|Stealth +6||darkvision 60 ft, passive Perception 9|Common, Goblin|1/4|Nimble Escape: can Disengage or Hide as a bonus action.|Scimitar +4 1d6+2 slashing;Shortbow +4 1d6+2 piercing (range 80/320)",
    "Giant rat": "30 ft|7 15 11 2 10 4|||darkvision 60 ft, passive Perception 10||1/8|Keen Smell: advantage on smell-based Perception.;Pack Tactics: advantage on an attack if an ally is next to the target.|Bite +4 1d4+2 piercing",
    "Cultist": "30 ft|11 12 10 10 11 10|Deception +2, Religion +2||passive Perception 10|any one language|1/8|Dark Devotion: advantage on saves against being charmed or frightened.|Scimitar +3 1d6+1 slashing",
    "Bandit": "30 ft|11 12 12 10 10 10|||passive Perception 10|any one language|1/8||Scimitar +3 1d6+1 slashing;Light crossbow +3 1d8+1 piercing (range 80/320)",
    "Guard": "30 ft|13 12 12 10 11 10|Perception +2||passive Perception 12|any one language|1/8||Spear +3 1d6+1 piercing",
    "Wolf": "40 ft|12 15 12 3 12 6|Perception +3, Stealth +4||passive Perception 13||1/4|Keen Hearing and Smell: advantage on Perception that relies on hearing or smell.;Pack Tactics: advantage on an attack if an ally is next to the target.|Bite +4 2d4+2 piercing (DC 11 Strength save or knocked prone)",
    "Hobgoblin": "30 ft|13 12 12 10 10 9|||darkvision 60 ft, passive Perception 10|Common, Goblin|1/2|Martial Advantage: once a turn, 2d6 extra damage if an ally is next to the target.|Longsword +3 1d8+1 slashing;Longbow +3 1d8+1 piercing (range 150/600)",
    "Skeleton": "30 ft|10 14 15 6 8 5|||darkvision 60 ft, passive Perception 9|understands the languages it knew in life|1/4|Vulnerable to bludgeoning. Immune to poison, exhaustion and being poisoned.|Shortsword +4 1d6+2 piercing;Shortbow +4 1d6+2 piercing (range 80/320)",
    "Orc": "30 ft|16 12 16 7 11 10|Intimidation +2||darkvision 60 ft, passive Perception 10|Common, Orc|1/2|Aggressive: as a bonus action, moves up to its speed toward an enemy it can see.|Greataxe +5 1d12+3 slashing;Javelin +5 1d6+3 piercing (range 30/120)",
    "Zombie": "20 ft|13 6 16 3 6 5||Wis +0|darkvision 60 ft, passive Perception 8|understands the languages it knew in life|1/4|Undead Fortitude: dropped to 0 HP by anything but radiant damage or a crit, it makes a Con save (DC 5 + the damage) to drop to 1 HP instead. Immune to poison.|Slam +3 1d6+1 bludgeoning",
    "Ghoul": "30 ft|13 15 10 7 10 6|||darkvision 60 ft, passive Perception 10|Common|1|Immune to poison, being charmed, exhaustion and being poisoned.|Bite +2 2d6+2 piercing;Claws +4 2d4+2 slashing (DC 10 Constitution save or paralysed for 1 minute, save again each turn; elves are immune)",
    "Gnoll": "30 ft|14 12 11 6 10 7|||darkvision 60 ft, passive Perception 10|Gnoll|1/2|Rampage: when it drops a creature to 0 HP, it can move half its speed and bite as a bonus action.|Bite +4 1d4+2 piercing;Spear +4 1d6+2 piercing;Longbow +3 1d8+1 piercing (range 150/600)",
    "Giant spider": "30 ft, climb 30 ft|14 16 12 2 11 4|Stealth +7||blindsight 10 ft, darkvision 60 ft, passive Perception 10||1|Spider Climb: climbs walls and ceilings.;Web Sense and Web Walker: knows where anything touching its web is, and moves through webs freely.|Bite +5 1d8+3 piercing (plus 2d8 poison, DC 11 Constitution save for half);Web +5 0d1 restrained (recharge 5-6, range 30/60, escape DC 12)",
    "Priest": "30 ft|10 10 12 13 16 13|Medicine +7, Persuasion +3, Religion +4||passive Perception 13|any two languages|2|Divine Eminence: as a bonus action, a melee hit deals 3d6 extra radiant damage (uses a spell slot).;Spellcasting: Wisdom, save DC 13, +5 to hit with spells.|Mace +2 1d6 bludgeoning",
    "Bugbear": "30 ft|15 14 13 8 11 9|Stealth +6, Survival +2||darkvision 60 ft, passive Perception 10|Common, Goblin|1|Brute: melee weapons deal one extra die (included).;Surprise Attack: 2d6 extra damage against a surprised creature in the first round.|Morningstar +4 2d8+2 piercing;Javelin +4 2d6+2 piercing",
    "Brown bear": "40 ft, climb 30 ft|19 10 16 2 13 7|Perception +3||passive Perception 13||1|Keen Smell: advantage on smell-based Perception.;Multiattack: one bite and one claws attack.|Bite +6 1d8+4 piercing;Claws +6 2d6+4 slashing",
    "Dire wolf": "50 ft|17 15 15 3 12 7|Perception +3, Stealth +4||passive Perception 13||1|Keen Hearing and Smell.;Pack Tactics: advantage on an attack if an ally is next to the target.|Bite +5 2d6+3 piercing (DC 13 Strength save or knocked prone)",
    "Mage": "30 ft|9 14 11 17 12 11|Arcana +6, History +6|Int +6, Wis +4|passive Perception 11|any four languages|6|Spellcasting: Intelligence, save DC 14, +6 to hit with spells (fireball, counterspell, misty step, shield...).|Dagger +5 1d4+2 piercing;Fire bolt +6 2d10 fire (range 120)",
    "Wight": "30 ft|15 14 16 10 13 15|Perception +3, Stealth +4||darkvision 60 ft, passive Perception 13|the languages it knew in life|3|Sunlight Sensitivity. Resists necrotic; immune to poison.;Multiattack: two longsword attacks, or two longbow attacks; it can use Life Drain in place of one longsword attack.|Longsword +4 1d8+2 slashing;Life Drain +4 1d6+2 necrotic (DC 13 Constitution save or max HP drops by the damage);Longbow +4 1d8+2 piercing (range 150/600)",
    "Ghost": "0 ft, fly 40 ft (hover)|7 13 10 10 12 17|||darkvision 60 ft, passive Perception 11|the languages it knew in life|4|Incorporeal Movement: moves through creatures and objects.;Etherealness and Horrifying Visage (DC 13 Wisdom save or frightened).|Withering Touch +5 4d6+3 necrotic",
    "Knight": "30 ft|16 11 14 11 11 15||Con +4, Wis +2|passive Perception 10|any one language|3|Brave: advantage on saves against being frightened.;Multiattack: two melee attacks.;Parry: +2 AC against one melee hit (reaction).|Greatsword +5 2d6+3 slashing;Heavy crossbow +2 1d10 piercing (range 100/400)",
    "Ogre": "40 ft|19 8 16 5 7 7|||darkvision 60 ft, passive Perception 8|Common, Giant|2||Greatclub +6 2d8+4 bludgeoning;Javelin +6 2d6+4 piercing (range 30/120)",
    "Owlbear": "40 ft|20 12 17 3 12 7|Perception +3||darkvision 60 ft, passive Perception 13||3|Keen Sight and Smell.;Multiattack: one beak and one claws attack.|Beak +7 1d10+5 piercing;Claws +7 2d8+5 slashing",
    "Bandit captain": "30 ft|15 16 14 14 11 14|Athletics +4, Deception +4|Str +4, Dex +5, Wis +2|passive Perception 10|any two languages|2|Multiattack: two scimitar attacks and one dagger attack.;Parry: +2 AC against one melee hit (reaction).|Scimitar +5 1d6+3 slashing;Dagger +5 1d4+3 piercing",
    "Troll": "30 ft|18 13 20 7 9 7|Perception +2||darkvision 60 ft, passive Perception 12|Giant|5|Regeneration: regains 10 HP at the start of its turn unless it took acid or fire damage.;Multiattack: one bite and two claw attacks.|Bite +7 1d6+4 piercing;Claw +7 2d6+4 slashing",
    "Young dragon": "40 ft, climb 40 ft, fly 80 ft|23 10 21 14 11 19|Perception +8, Stealth +4|Dex +4, Con +9, Wis +4, Cha +8|blindsight 30 ft, darkvision 120 ft, passive Perception 18|Common, Draconic|10|Multiattack: one bite and two claw attacks.;Breath Weapon (recharge 5-6): 30 ft cone, DC 17 Dexterity save, 16d6 damage, half on a success.|Bite +10 2d10+6 piercing;Claw +10 2d6+6 slashing;Breath weapon +0 16d6 damage (DC 17 Dexterity save for half)",
  };
  function statsOf(name) {
    const d = STAT_DATA[name];
    if (!d) return null;
    const [speed, ab, skills, saves, senses, langs, cr, traits, actions] = d.split("|");
    return { speed, abil: ab.split(" ").map(Number), skills, saves, senses, langs, cr,
      traits: traits.split(";").filter(Boolean).join("\n"), actions: actions.split(";").filter(Boolean).join("\n") };
  }
  const LIM = { image: 900000, grid: 120, linePts: 4000 };

  let socket = null, S = null, me = "", slug = null, viewSc = null, firstState = true;
  const cam = { x: -1, y: -1, z: 48 };
  let tool = "select", sel = null;
  // The DM's main tabs: each shows its own tools. Players only ever have Play.
  const MODES = [["play", "Play"], ["map", "Map making"], ["tokens", "Tokens"]];
  const MODE_TOOL = { play: "select", map: "build", tokens: "lib" };             // what a tab starts on
  const TOOL_MODE = { fog: "map", walls: "map", build: "map", lib: "tokens" };   // select is in every tab, the rest are Play
  // The Tokens tab: ready tokens by kind, to drag (or click, then click the map) onto the map.
  const LIB_TABS = [["players", "Players"], ["enemy", "Enemies"], ["boss", "Bosses"], ["npc", "NPCs"]];
  let libCat = "enemy", libArm = null, libHidden = false, libKey = "";
  const libSent = new Map();
  let mode = "play";
  const picked = new Set();                 // selected tokens (sel is the one clicked last)
  let wallMode = "wall", wallPts = null;    // the wall being drawn (grid corners x, y, x, y ...)
  let drawShape = "free", ink = INK[0], inkW = 3;
  let fogShow = true, fogBrush = 1, fogBox = false;
  let rollMode = "";
  const images = new Map();                 // asset name -> Image
  const rulers = new Map();                 // player id -> { p, t } (other people's rulers)
  const drags = new Map();                  // token id -> { x, y, t } (other people dragging)
  const pings = [];                         // { x, y, t, c }
  const fogLocal = new Map();               // cell index -> "0"/"1", painted but not confirmed yet
  const tilesLocal = new Map();             // cell index -> square + "1"/"0" (walls round it), painted but not confirmed yet
  let tilesLocalSc = null;
  const build = { mode: "room", tile: "f", brush: 1, prop: "barrel", rot: 0, dmLabel: false, size: "", kind: "dungeon", secret: false, walls: true,
    gen: { rooms: 2, traps: 1, locked: 1, secret: 1, treasure: 1, water: 2, clutter: 2, trees: 2 } };   // random map sliders, 0 to 3
  let act = null;                           // what the pointer is doing right now
  let noteTimer = 0, spaceDown = false;

  const viewport = $("viewport"), canvas = $("map"), ctx = canvas.getContext("2d");

  // ---- Little helpers ------------------------------------------------------------------------
  let asPlayer = false;                     // a DM looking at the map the way players see it
  const isDm = () => !!(S && S.dm) && !asPlayer;
  const rawScene = () => S && (S.scenes.find(s => s.id === viewSc) || S.scenes[0]);
  const scene = () => { const sc = rawScene(); return sc && asPlayer ? playerScene(sc) : sc; };
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
  function trapCheck(old, s) {
    if (!old || !s.dm) return;
    const was = new Map();
    for (const sc of old.scenes) for (const t of sc.tokens) was.set(t.id, `${sc.id}:${Math.floor(t.x)},${Math.floor(t.y)}`);
    for (const sc of s.scenes) {
      const traps = (sc.props || []).filter(pr => pr.k === "trap");
      if (!traps.length) continue;
      for (const t of sc.tokens) {
        if (!(t.owner || t.char) || was.get(t.id) === `${sc.id}:${Math.floor(t.x)},${Math.floor(t.y)}`) continue;
        const n = Math.max(1, Math.floor(t.size));
        const hit = traps.find(pr => pr.x >= Math.floor(t.x) && pr.x < Math.floor(t.x) + n && pr.y >= Math.floor(t.y) && pr.y < Math.floor(t.y) + n);
        if (hit) {
          note(`⚠ ${t.name} stepped on a trap${sc.id === viewSc ? "" : ` in ${sc.name}`}!`);
          pings.push({ x: hit.x + 0.5, y: hit.y + 0.5, t: Date.now(), c: "#ff6b6b", sc: sc.id });
          FX.sound("buzz");
          redraw();
        }
      }
    }
  }
  function onState(s) {
    const old = S;
    if (!asPlayer) trapCheck(old, s);
    S = s;
    me = s.you;
    if (s.camp) slug = s.camp.slug;
    if (s.deleted) { leave && leave("That campaign was deleted."); return; }
    Object.assign(LIM, s.limits || {});
    if (!s.dm) asPlayer = false;
    document.body.classList.toggle("is-dm", isDm());
    document.body.classList.toggle("real-dm", !!s.dm);
    showMode();
    if (!isDm() && TOOL_MODE[tool]) setTool("select");
    document.title = `${s.camp.name} · ACE Tabletop`;
    // Which scene to look at: players always see the active one; a DM follows it unless they're looking elsewhere.
    if (!isDm() || !viewSc || !s.scenes.some(x => x.id === viewSc) || viewSc === lastActive) viewSc = s.active;
    const moved = lastActive !== null && lastActive !== s.active;
    lastActive = s.active;
    fogLocal.clear();
    tilesLocal.clear();
    drags.clear();
    for (const id of [...picked]) if (!tokenById(id)) picked.delete(id);
    if (sel && !picked.has(sel)) sel = [...picked].pop() || null;
    if (firstState && !EXTRAS) { setTab(s.dm ? "scenes" : "room"); if (!s.dm) setPanel(false); }
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
    renderStats();
    renderCard();
    refreshSheet();
    if (tool === "lib") {
      const k = libSignature();
      if (k !== libKey) { libKey = k; if (libArm) libArm = libFind(libArm.id) || null; renderToolOpts(); }
    }
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
    if (act && act.kind === "token" && act.moved) {
      const g = act.group.find(x => x.id === t.id);
      if (g) return { x: g.ox + act.x - act.ox, y: g.oy + act.y - act.oy };
    }
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
    const T = tilesOf(sc), drawn = /[^.?]/.test(T);
    if (drawn) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(tileLayer(sc, T, wallsOf(sc), !!img), 0, 0, sc.cols, sc.rows);
      for (const pr of sc.props || []) paintProp(ctx, pr);
    }
    if (cam.z > 12) for (const pr of sc.props || []) {          // where stairs lead
      const to = isDm() ? pr.to && (S.scenes.find(x => x.id === pr.to) || {}).name : pr.go;
      if (to) tag(`→ ${to}`, pr.x + 0.5, pr.y + 1 + px(8), isDm() && !pr.open ? "#adb5bd" : "#ffd43b", px, 10);
    }
    // auras and reach
    for (const t of sc.tokens) if (t.aura) {
      const pos = tokenPos(t), r = t.size / 2 + t.aura / per();
      ctx.beginPath();
      ctx.arc(pos.x + t.size / 2, pos.y + t.size / 2, r, 0, Math.PI * 2);
      ctx.fillStyle = (t.ac2 || t.c) + "1f";
      ctx.fill();
      ctx.strokeStyle = (t.ac2 || t.c) + "aa";
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(6), px(4)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (sc.grid && cam.z >= 7 && !(drawn && !img)) {
      ctx.beginPath();
      for (let x = 0; x <= sc.cols; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, sc.rows); }
      for (let y = 0; y <= sc.rows; y++) { ctx.moveTo(0, y); ctx.lineTo(sc.cols, y); }
      ctx.strokeStyle = sc.gc;
      ctx.globalAlpha = img ? 0.35 : 0.5;
      ctx.lineWidth = px(1);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (!img && !drawn) {
      ctx.strokeStyle = "#3a3f4d";
      ctx.lineWidth = px(2);
      ctx.strokeRect(0, 0, sc.cols, sc.rows);
    }

    // drawings and spell areas
    for (const ln of sc.lines) paintLine(ln, px);
    if (act && act.kind === "draw") paintLine(act.line, px, true);

    // fog of war, then walls and doors on top
    if (sc.fog) paintFog(sc, px);
    paintWalls(sc, px);
    for (const lb of sc.labels || []) paintLabel(lb, px);

    // tokens
    const cur = EXTRAS && S.init.cur && S.init.list.find(e => e.id === S.init.cur);
    for (const t of sc.tokens) paintToken(t, px, cur && cur.tok === t.id);
    for (const t of sc.tokens) if (t.elev) {
      const pos = tokenPos(t);
      tag(`${t.elev > 0 ? "▲" : "▼"} ${Math.abs(t.elev)} ${unit()}`, pos.x + t.size * 0.85, pos.y + px(2), t.elev > 0 ? "#74c0fc" : "#e8b86d", px, 10);
    }

    // a token being dragged: the path and how far
    if (act && act.kind === "token" && act.moved) {
      const t = tokenById(act.id);
      if (t) {
        const r = t.size / 2;
        const a = { x: act.ox + r, y: act.oy + r }, b = { x: act.x + r, y: act.y + r };
        paintRuler([a.x, a.y, b.x, b.y], "#ffffff", px, squares({ x: act.ox, y: act.oy }, act), null, t.speed);
      }
    }
    // rulers
    for (const [pid, r] of rulers) {
      if (Date.now() - r.t > 8000) { rulers.delete(pid); continue; }
      if (r.sc === sc.id) paintRuler(r.p, colourOf(pid), px, null, nameOf(pid));
    }
    if (act && act.kind === "ruler") paintRuler(act.p, colourOf(me), px);

    // a box being dragged to select tokens
    if (act && act.kind === "box") {
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = "rgba(167, 139, 250, 0.12)";
      ctx.lineWidth = px(1.5);
      ctx.setLineDash([px(5), px(4)]);
      const x = Math.min(act.a.x, act.b.x), y = Math.min(act.a.y, act.b.y), w = Math.abs(act.b.x - act.a.x), h = Math.abs(act.b.y - act.a.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
    // the wall being drawn
    if (tool === "walls" && wallPts && wallPts.length) {
      const q = [...wallPts];
      if (hover) { const v = vertex(hover); q.push(v.x, v.y); }
      ctx.strokeStyle = wallMode === "door" ? "#f59f00" : "#c4b5fd";
      ctx.lineWidth = px(wallMode === "door" ? 7 : 4);
      ctx.beginPath();
      ctx.moveTo(q[0], q[1]);
      for (let i = 2; i < q.length; i += 2) ctx.lineTo(q[i], q[i + 1]);
      ctx.stroke();
    }
    if (tool === "walls" && hover && (wallMode === "wall" || wallMode === "door")) {
      const v = vertex(hover);
      ctx.beginPath();
      ctx.arc(v.x, v.y, px(5), 0, Math.PI * 2);
      ctx.fillStyle = "#c4b5fd";
      ctx.fill();
    }
    // fog box being dragged
    if (act && act.kind === "fogbox") {
      const [x0, y0, x1, y1] = boxCells(act.a, act.b);
      ctx.strokeStyle = fogShow ? "#69db7c" : "#ff6b6b";
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(6), px(4)]);
      ctx.strokeRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      ctx.setLineDash([]);
    }
    if (tool === "build" && isDm()) paintBuildPreview(sc, px);
    if (tool === "lib" && libArm && hover && isDm()) {
      const n = libArm.size || 1, at = libSpot(sc, libArm, hover);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = libArm.c || "#e5484d";
      ctx.beginPath(); ctx.arc(at.x + n / 2, at.y + n / 2, n * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
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

  function paintWalls(sc, px) {
    const dm = isDm(), strong = tool === "walls";
    ctx.lineCap = "round";
    for (const w of sc.walls || []) {
      const [x1, y1, x2, y2] = w.p;
      if (!w.door && (!dm || (w.auto && !strong))) continue;
      if (w.door) { paintDoor(w, dm, px); continue; }
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      {
        ctx.strokeStyle = strong ? "rgba(196, 181, 253, 0.95)" : "rgba(167, 139, 250, 0.45)";
        ctx.lineWidth = px(strong ? 4 : 3);
        ctx.stroke();
      }
    }
  }

  // ---- View as player: the DM sees exactly what the players get ---------------------------------
  let pvMemo = { src: null, seen: null, out: null };
  function playerScene(sc) {
    if (pvMemo.src === sc && pvMemo.seen === sc.seen) return pvMemo.out;
    const fog = sc.fog, cols = sc.cols, rows = sc.rows, seen = sc.seen || "";
    const at = (x, y) => seen[Math.min(rows - 1, Math.max(0, Math.floor(y))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x)))];
    const clear = (x, y) => !fog || at(x, y) === "1";
    const pc = t => !!(t.owner || t.char);
    const tokens = sc.tokens.filter(t => !t.hidden && (pc(t) || !fog || !covered(sc, t, t.size))).map(t => {
      if (t.stats) t = { ...t, stats: null };
      if (pc(t) || t.showhp) return t;
      const v = { ...t, hp: null, mhp: null, ac: null, init: null, note: "" };   // players see how hurt it looks
      if (t.hp != null && t.mhp) v.look = t.hp <= 0 ? "down" : t.hp <= t.mhp / 2 ? "bloodied" : t.hp < t.mhp ? "hurt" : "fine";
      return v;
    });
    let tiles = (sc.tiles || "").replace(/S/g, ".");
    if (fog && /[^.]/.test(tiles)) tiles = Array.from(tiles, (t, i) => (seen[i] === "1" ? t : "?")).join("");
    const doorSeen = w => {
      if (!fog) return true;
      const mx = (w.p[0] + w.p[2]) / 2, my = (w.p[1] + w.p[3]) / 2;
      return [[-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]].some(([dx, dy]) => {
        const x = Math.floor(mx + dx), y = Math.floor(my + dy);
        return x >= 0 && y >= 0 && x < cols && y < rows && seen[y * cols + x] === "1";
      });
    };
    const out = {
      ...sc, tokens, tiles,
      props: (sc.props || []).filter(pr => clear(pr.x, pr.y) && pr.k !== "trap").map(pr => {
        const go = pr.open && S.scenes.find(x => x.id === pr.to);
        return { id: pr.id, k: pr.k, x: pr.x, y: pr.y, r: pr.r, ...(go ? { go: go.name } : {}) };
      }),
      labels: (sc.labels || []).filter(lb => !lb.dm && clear(lb.x, lb.y)),
      walls: (sc.walls || []).filter(w => w.door && !w.secret && doorSeen(w)).map(w => ({ id: w.id, p: w.p, door: true, open: !!w.open })),
    };
    pvMemo = { src: sc, seen: sc.seen, out };
    return out;
  }
  function setAsPlayer(on) {
    if (on && !(S && S.dm)) return;
    asPlayer = on;
    document.body.classList.toggle("is-dm", isDm());
    document.body.classList.toggle("as-player", on);
    if (act) cancelAct();
    wallPts = null;
    if (on) {
      viewSc = S.active;
      setMode("play");
      selectToken(null);
      setTab("room");
      fitView();
      note("This is what your players see. Click Back to DM view when you're done.");
    } else setTab("scenes");
    showMode();
    $("asPlayerBtn").textContent = on ? "Back to DM view" : "View as player";
    $("asPlayerBtn").classList.toggle("primary", on);
    renderAll();
    renderToolOpts();
    redraw();
  }

  function paintDoor(w, dm, px) {
    const [x1, y1, x2, y2] = w.p, L = Math.hypot(x2 - x1, y2 - y1);
    if (!L) return;
    const th = Math.min(0.28, L * 0.3), lw = Math.max(px(1.5), 0.045);
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(Math.atan2(y2 - y1, x2 - x1));
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    const edge = w.locked && dm ? "#e03131" : w.secret && dm ? "#7048e8" : "#1c1a18";
    if (w.secret && dm) ctx.setLineDash([0.1, 0.07]);
    if (!w.open) {
      ctx.beginPath();
      ctx.rect(0.04, -th / 2, L - 0.08, th);
      ctx.fillStyle = "#e9cf9f";
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.setLineDash([]);
      if (w.secret && dm && L > 0.5) {             // an S, so the DM knows players see wall here
        ctx.fillStyle = "#7048e8";
        ctx.font = `700 ${th * 0.9}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("S", L / 2, th * 0.05);
      }
      if (w.locked && dm) {                       // a little padlock for the DM
        ctx.beginPath();
        ctx.arc(L / 2, 0, th * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = "#e03131";
        ctx.fill();
      }
    } else {
      // swung open on its hinge, with the path it swings along
      ctx.beginPath();
      ctx.arc(0, 0, L * 0.9, 0, Math.PI / 2);
      ctx.strokeStyle = "rgba(28, 26, 24, 0.35)";
      ctx.setLineDash([0.08, 0.08]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(Math.PI / 2);
      if (w.secret && dm) ctx.setLineDash([0.1, 0.07]);
      ctx.beginPath();
      ctx.rect(0, -th * 0.3, L * 0.9, th * 0.6);
      ctx.fillStyle = "#e9cf9f";
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ---- The map maker's drawing: paper, ink walls, hatching round the rock ----------------------
  const PAPER = "#f2ede1", INKC = "#1c1a18";
  const OPEN = "fogdslpDS";
  const solidT = t => t === "." || t === "w";
  const TILE_INFO = [["f", "Stone", "#f7f4ec"], ["o", "Wood", "#d9b483"], ["g", "Grass", "#c9dea0"], ["d", "Dirt", "#dcc59a"],
    ["s", "Water", "#94c2e4"], ["l", "Lava", "#f08a3c"], ["p", "Pit", "#34302c"], ["w", "Wall", "#5c554d"]];
  const PROP_INFO = [["table", "Table"], ["chair", "Chair"], ["bed", "Bed"], ["shelf", "Shelf"], ["rug", "Rug"], ["chest", "Chest"],
    ["barrel", "Barrel"], ["crate", "Crate"], ["stairs", "Stairs"], ["pillar", "Pillar"], ["statue", "Statue"], ["altar", "Altar"],
    ["torch", "Torch"], ["campfire", "Fire"], ["well", "Well"], ["tree", "Tree"], ["bush", "Bush"], ["rock", "Rock"],
    ["rubble", "Rubble"], ["web", "Web"], ["trap", "Trap (DM)"]];
  const tileColour = t => (TILE_INFO.find(x => x[0] === t) || TILE_INFO[0])[2];
  let tileCache = { key: "", canvas: null };
  function rnd(x, y, k = 0) {
    let h = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(k + 1, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // The squares (k = 0) or whether each gets walls (k = 1), with what's been painted but not confirmed yet.
  function layerOf(sc, k) {
    const n = sc.cols * sc.rows;
    let T = k ? sc.wl || "" : sc.tiles || "";
    if (T.length !== n) T = (k ? "1" : ".").repeat(n);
    const live = act && act.kind === "paint" ? act.cells : null;
    const mine = tilesLocalSc === sc.id && tilesLocal.size;
    if (!mine && !(live && live.size)) return T;
    const a = T.split("");
    if (mine) for (const [i, v] of tilesLocal) a[i] = v[k];
    if (live) for (const [i, v] of live) a[i] = v[k];
    return a.join("");
  }
  const tilesOf = sc => layerOf(sc, 0), wallsOf = sc => layerOf(sc, 1);
  function tileLayer(sc, T, W, hasImg) {
    const key = `${sc.id}|${sc.cols}|${hasImg ? 1 : 0}|${sc.grid ? 1 : 0}|${T}|${W}`;
    if (tileCache.key === key) return tileCache.canvas;
    const cols = sc.cols, rows = sc.rows;
    const R = Math.max(8, Math.min(64, Math.floor(4096 / Math.max(cols, rows)), Math.floor(Math.sqrt(14e6 / (cols * rows)))));
    const cv = tileCache.canvas || document.createElement("canvas");
    cv.width = cols * R;
    cv.height = rows * R;
    const g = cv.getContext("2d");
    g.setTransform(R, 0, 0, R, 0, 0);
    const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? "." : T[y * cols + x]);
    const isOpen = t => OPEN.includes(t);
    const walled = (x, y) => { const t = at(x, y); return isOpen(t) && (t === "D" || t === "S" || W[y * cols + x] === "1"); };
    const wallEdge = (x1, y1, x2, y2) => {             // the same rule the server uses for sight
      const a = at(x1, y1), b = at(x2, y2);
      if (a === "?" || b === "?") return false;
      return (walled(x1, y1) && solidT(b)) || (walled(x2, y2) && solidT(a)) || (a === "w" && isOpen(b)) || (b === "w" && isOpen(a));
    };
    if (!hasImg) { g.fillStyle = PAPER; g.fillRect(0, 0, cols, rows); }

    // hatching on the rock round the rooms (it fades out two squares away)
    g.lineCap = "round";
    g.strokeStyle = "#3b3631";
    g.lineWidth = 0.032;
    g.beginPath();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (at(x, y) !== ".") continue;
      let d = 9;
      for (let dy = -2; dy <= 2 && d > 1; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (isOpen(at(x + dx, y + dy))) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
      }
      if (d > 2 || (d === 2 && rnd(x, y, 9) < 0.45)) continue;
      for (let k = 0; k < (d === 1 ? 3 : 2); k++) {
        const a = rnd(x, y, k) * Math.PI, cx = x + rnd(x, y, k + 3), cy = y + rnd(x, y, k + 6);
        const ux = Math.cos(a), uy = Math.sin(a), len = 0.32 + rnd(x, y, k + 11) * 0.18;
        for (let j = -1.5; j <= 1.5; j++) {
          const ox = cx - uy * j * 0.12, oy = cy + ux * j * 0.12;
          g.moveTo(ox - ux * len, oy - uy * len);
          g.lineTo(ox + ux * len, oy + uy * len);
        }
      }
    }
    g.stroke();

    // a soft shadow down and right of everything you can stand on
    g.fillStyle = "rgba(40, 30, 20, 0.22)";
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (isOpen(at(x, y))) g.fillRect(x + 0.12, y + 0.14, 1, 1);

    // the squares themselves
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let t = at(x, y);
      if (t === "D" || t === "S") t = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].includes("o") ? "o" : "f";
      if (t === "." || t === "?") continue;
      g.fillStyle = tileColour(t);
      g.fillRect(x, y, 1.02, 1.02);
      tileDetail(g, t, x, y);
    }

    // the grid, on the floor only
    if (sc.grid) {
      g.strokeStyle = "rgba(60, 50, 40, 0.2)";
      g.lineWidth = 1 / R;
      g.beginPath();
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (isOpen(at(x, y))) g.rect(x, y, 1, 1);
      g.stroke();
    }

    // thick ink walls wherever a room meets rock
    g.beginPath();
    for (let y = 0; y <= rows; y++) for (let x = 0; x < cols; x++) {
      if (wallEdge(x, y - 1, x, y)) { g.moveTo(x, y); g.lineTo(x + 1, y); }
    }
    for (let x = 0; x <= cols; x++) for (let y = 0; y < rows; y++) {
      if (wallEdge(x - 1, y, x, y)) { g.moveTo(x, y); g.lineTo(x, y + 1); }
    }
    g.strokeStyle = INKC;
    g.lineWidth = 0.16;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke();
    tileCache = { key, canvas: cv };
    return cv;
  }
  function tileDetail(g, t, x, y) {
    const r = k => rnd(x, y, k);
    g.lineWidth = 0.03;
    g.lineCap = "round";
    if (t === "f") {                             // the odd flagstone or crack
      if (r(1) < 0.3) {
        g.strokeStyle = "rgba(60, 50, 40, 0.22)";
        const cx = x + 0.25 + r(2) * 0.5, cy = y + 0.25 + r(3) * 0.5, s = 0.1 + r(4) * 0.12;
        g.beginPath();
        g.moveTo(cx - s, cy - s * 0.6); g.lineTo(cx + s * 0.7, cy - s); g.lineTo(cx + s, cy + s * 0.5); g.lineTo(cx - s * 0.4, cy + s);
        g.closePath();
        g.stroke();
      }
    } else if (t === "o") {                      // floorboards
      g.strokeStyle = "rgba(90, 60, 30, 0.38)";
      g.beginPath();
      for (const yy of [0.33, 0.66]) { g.moveTo(x, y + yy); g.lineTo(x + 1, y + yy); }
      for (let k = 0; k < 3; k++) if (r(k + 20) < 0.4) { const sx = x + 0.1 + r(k) * 0.8, sy = y + k * 0.33; g.moveTo(sx, sy); g.lineTo(sx, sy + 0.33); }
      g.stroke();
    } else if (t === "g") {                      // tufts of grass
      g.strokeStyle = "rgba(85, 120, 50, 0.7)";
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const cx = x + 0.15 + r(k) * 0.7, cy = y + 0.2 + r(k + 5) * 0.65;
        g.moveTo(cx - 0.07, cy - 0.1); g.lineTo(cx, cy); g.lineTo(cx + 0.07, cy - 0.11);
      }
      g.stroke();
    } else if (t === "d") {                      // pebbles
      g.fillStyle = "rgba(120, 90, 50, 0.35)";
      for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + 0.1 + r(k) * 0.8, y + 0.1 + r(k + 4) * 0.8, 0.03 + r(k + 8) * 0.03, 0, 7); g.fill(); }
    } else if (t === "s") {                      // little waves
      g.strokeStyle = "rgba(255, 255, 255, 0.7)";
      g.beginPath();
      for (let k = 0; k < 2; k++) {
        const cx = x + 0.2 + r(k) * 0.5, cy = y + 0.25 + k * 0.45;
        g.moveTo(cx, cy); g.quadraticCurveTo(cx + 0.08, cy - 0.08, cx + 0.16, cy); g.quadraticCurveTo(cx + 0.24, cy + 0.08, cx + 0.32, cy);
      }
      g.stroke();
    } else if (t === "l") {                      // dark crust floating on glowing rock
      g.fillStyle = "#ff8a1e";
      g.fillRect(x, y, 1.02, 1.02);
      const hot = g.createRadialGradient(x + r(40), y + r(41), 0, x + r(40), y + r(41), 0.6);
      hot.addColorStop(0, "rgba(255, 230, 110, 0.9)"); hot.addColorStop(1, "rgba(255, 230, 110, 0)");
      g.fillStyle = hot;
      g.fillRect(x, y, 1.02, 1.02);
      if (r(30) > 0.2) {                          // most squares have a cooling crust plate on them
        const cx = x + 0.5 + (r(31) - 0.5) * 0.3, cy = y + 0.5 + (r(32) - 0.5) * 0.3, size = 0.28 + r(33) * 0.16;
        g.beginPath();
        for (let k = 0; k < 7; k++) {
          const a = k / 7 * Math.PI * 2 + r(34), d = size * (0.7 + r(k + 50) * 0.5);
          g[k ? "lineTo" : "moveTo"](cx + Math.cos(a) * d, cy + Math.sin(a) * d);
        }
        g.closePath();
        g.fillStyle = "#4a1a0c";
        g.fill();
        g.strokeStyle = "#ff5a1a";
        g.lineWidth = 0.045;
        g.stroke();
      } else {                                    // or a bubble
        g.strokeStyle = "rgba(255, 245, 180, 0.9)";
        g.lineWidth = 0.035;
        g.beginPath(); g.arc(x + 0.3 + r(35) * 0.4, y + 0.3 + r(36) * 0.4, 0.08, 0, 7); g.stroke();
      }
    } else if (t === "p") {                      // a pit, darker in the middle
      g.fillStyle = "#16130f";
      g.fillRect(x + 0.12, y + 0.12, 0.76, 0.76);
    } else if (t === "w") {                      // stonework
      g.strokeStyle = "rgba(255, 255, 255, 0.12)";
      g.beginPath();
      g.moveTo(x, y + 0.5); g.lineTo(x + 1, y + 0.5);
      const o = (y % 2) * 0.5;
      g.moveTo(x + 0.25 + o * 0.5, y); g.lineTo(x + 0.25 + o * 0.5, y + 0.5);
      g.moveTo(x + 0.75 - o * 0.5, y + 0.5); g.lineTo(x + 0.75 - o * 0.5, y + 1);
      g.stroke();
    }
  }

  // props are drawn in ink too, a square each
  function paintProp(g, pr, alpha) {
    g.save();
    g.translate(pr.x + 0.5, pr.y + 0.5);
    g.rotate((pr.r || 0) * Math.PI / 2);
    if (alpha) g.globalAlpha = alpha;
    g.lineWidth = 0.045;
    g.strokeStyle = INKC;
    g.lineJoin = "round";
    g.lineCap = "round";
    const fs = fill => { g.fillStyle = fill; g.fill(); g.stroke(); };
    const box = (x, y, w, h, fill) => { g.beginPath(); g.rect(x, y, w, h); fs(fill); };
    const disc = (r, fill, x = 0, y = 0) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fs(fill); };
    const ln = (...q) => { g.beginPath(); g.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) g.lineTo(q[i], q[i + 1]); g.stroke(); };
    const poly = (q, fill) => { g.beginPath(); g.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) g.lineTo(q[i], q[i + 1]); g.closePath(); fs(fill); };
    const glow = (r, c) => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
      gr.addColorStop(0, c); gr.addColorStop(1, "rgba(255, 170, 60, 0)");
      g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2);
    };
    switch (pr.k) {
      case "table": box(-0.42, -0.3, 0.84, 0.6, "#c8a272"); g.lineWidth = 0.02; ln(-0.42, 0, 0.42, 0); break;
      case "chair": box(-0.18, -0.12, 0.36, 0.32, "#c8a272"); box(-0.2, -0.24, 0.4, 0.1, "#9c7647"); break;
      case "barrel": disc(0.32, "#b9824a"); disc(0.2, "#c99560"); break;
      case "crate": box(-0.33, -0.33, 0.66, 0.66, "#c9a06a"); ln(-0.33, -0.33, 0.33, 0.33); ln(0.33, -0.33, -0.33, 0.33); break;
      case "chest": box(-0.34, -0.22, 0.68, 0.44, "#a8692f"); ln(-0.34, -0.06, 0.34, -0.06); disc(0.06, "#f2c94c", 0, 0.02); break;
      case "bed": box(-0.32, -0.45, 0.64, 0.9, "#f4f1ea"); box(-0.25, -0.4, 0.5, 0.18, "#ffffff"); box(-0.32, -0.12, 0.64, 0.57, "#7f9ccf"); break;
      case "shelf": box(-0.45, -0.17, 0.9, 0.34, "#9b6b3d"); ln(-0.15, -0.17, -0.15, 0.17); ln(0.15, -0.17, 0.15, 0.17); break;
      case "rug": box(-0.45, -0.45, 0.9, 0.9, "#b5523b"); g.strokeStyle = "#f0c36d"; g.lineWidth = 0.035; g.strokeRect(-0.34, -0.34, 0.68, 0.68); break;
      case "pillar": disc(0.38, "#d6d1c8"); disc(0.25, "#ece8e0"); break;
      case "statue": box(-0.36, -0.36, 0.72, 0.72, "#d6d1c8"); disc(0.13, "#f3f0ea", 0, -0.12); ln(0, 0.02, 0, 0.24); ln(-0.15, 0.1, 0.15, 0.1); break;
      case "altar": box(-0.42, -0.28, 0.84, 0.56, "#cfc7b8"); ln(0, -0.18, 0, 0.18); ln(-0.11, -0.07, 0.11, -0.07); break;
      case "stairs":
        box(-0.45, -0.45, 0.9, 0.9, "#ece8e0");
        g.lineWidth = 0.03;
        for (let i = 1; i < 6; i++) { const y = -0.45 + i * 0.15; ln(-0.45 + i * 0.04, y, 0.45 - i * 0.04, y); }
        break;
      case "torch": glow(0.75, "rgba(255, 170, 60, 0.5)"); disc(0.09, "#ffb347"); break;
      case "campfire":
        glow(0.9, "rgba(255, 150, 50, 0.45)");
        for (let k = 0; k < 7; k++) disc(0.075, "#9a948a", Math.cos(k * 0.9) * 0.3, Math.sin(k * 0.9) * 0.3);
        disc(0.17, "#ff8a3d"); g.lineWidth = 0; disc(0.08, "#ffd35a");
        break;
      case "well": disc(0.42, "#a59f94"); disc(0.27, "#3f6e8f"); break;
      case "tree":
        g.fillStyle = "rgba(30, 40, 20, 0.25)"; g.beginPath(); g.arc(0.08, 0.1, 0.5, 0, 7); g.fill();
        disc(0.5, "#6f9a4a");
        g.lineWidth = 0.025;
        for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(Math.cos(k * 1.3) * 0.22, Math.sin(k * 1.3) * 0.22, 0.12, 0, 7); g.fillStyle = "#86b25c"; g.fill(); g.stroke(); }
        break;
      case "bush": disc(0.3, "#7fa955"); g.lineWidth = 0.025; disc(0.14, "#98c46a", 0.05, -0.05); break;
      case "rock": poly([-0.32, -0.08, -0.1, -0.33, 0.24, -0.24, 0.35, 0.1, 0.06, 0.32, -0.28, 0.22], "#b9b3a8"); break;
      case "rubble":
        poly([-0.35, -0.2, -0.18, -0.32, -0.08, -0.15, -0.25, -0.05], "#b9b3a8");
        poly([0.05, 0.05, 0.25, -0.05, 0.33, 0.18, 0.12, 0.28], "#a9a398");
        poly([-0.2, 0.15, -0.05, 0.12, -0.08, 0.3], "#c4beb3");
        break;
      case "trap":                               // only the DM ever gets these
        g.strokeStyle = "#e03131"; g.lineWidth = 0.05;
        g.setLineDash([0.09, 0.06]); g.strokeRect(-0.42, -0.42, 0.84, 0.84); g.setLineDash([]);
        g.fillStyle = "rgba(224, 49, 49, 0.15)"; g.fillRect(-0.42, -0.42, 0.84, 0.84);
        for (const [x, y] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) poly([x - 0.09, y + 0.08, x, y - 0.1, x + 0.09, y + 0.08], "#c9c4bb");
        break;
      case "web":
        g.strokeStyle = "rgba(70, 70, 70, 0.75)"; g.lineWidth = 0.02;
        for (let k = 0; k <= 4; k++) { const a = k * Math.PI / 8; ln(-0.5, -0.5, -0.5 + Math.cos(a) * 0.95, -0.5 + Math.sin(a) * 0.95); }
        for (const r of [0.3, 0.55, 0.8]) { g.beginPath(); g.arc(-0.5, -0.5, r, 0, Math.PI / 2); g.stroke(); }
        break;
    }
    g.restore();
  }
  function paintLabel(lb, px) {
    const size = Math.max(0.5, px(14));
    ctx.font = `italic 700 ${size}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = size * 0.25;
    ctx.strokeStyle = "rgba(242, 237, 225, 0.92)";
    ctx.strokeText(lb.text, lb.x, lb.y);
    ctx.fillStyle = lb.dm ? "#7048e8" : INKC;
    ctx.fillText(lb.text, lb.x, lb.y);
  }
  function paintBuildPreview(sc, px) {
    if (act && act.kind === "room") {
      const [x0, y0, x1, y1] = boxCells(act.a, act.b);
      ctx.fillStyle = act.code === "." ? "rgba(255, 107, 107, 0.18)" : "rgba(255, 255, 255, 0.35)";
      ctx.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      ctx.strokeStyle = act.code === "." ? "#ff6b6b" : INKC;
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(6), px(4)]);
      ctx.strokeRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      ctx.setLineDash([]);
      tag(`${x1 - x0 + 1} × ${y1 - y0 + 1}`, (x0 + x1 + 1) / 2, y0 - px(14), "#fff", px);
      return;
    }
    if (!hover || act) return;
    const c = cellAt(hover);
    if (build.mode === "prop") return paintProp(ctx, { k: build.prop, x: c.x, y: c.y, r: build.rot }, 0.55);
    if (build.mode === "label") return;
    const n = build.mode === "brush" || build.mode === "erase" ? build.brush : 1, o = Math.floor(n / 2);
    ctx.strokeStyle = build.mode === "erase" ? "#ff6b6b" : "#7048e8";
    ctx.lineWidth = px(2);
    ctx.strokeRect(c.x - o, c.y - o, n, n);
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

  function paintRuler(p, c, px, n, who, speed) {
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
    const over = speed && total * per() > speed;
    tag((who ? who + ": " : "") + distText(total) + (speed ? ` / ${speed} ${unit()}` : ""), e.x, e.y - px(20), over ? "#ff6b6b" : c, px, 13);
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
    if (picked.has(t.id)) {
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
  const sendDrags = throttle(list => { for (const m of list) live({ k: "drag", sc: viewSc, id: m.id, x: +m.x.toFixed(2), y: +m.y.toFixed(2) }); }, 60);
  const vertex = p => ({ x: Math.round(p.x), y: Math.round(p.y) });
  function segDist(p, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / l2));
    return Math.hypot(p.x - x1 - k * dx, p.y - y1 - k * dy);
  }
  function wallAt(p, doorsOnly, near = 0.3) {
    const sc = scene();
    let best = null, bd = near;
    for (const w of sc.walls || []) {
      if ((doorsOnly && !w.door) || (w.auto && !w.door)) continue;
      const d = segDist(p, ...w.p);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
  const inScene = (sc, x, y) => x >= 0 && y >= 0 && x < sc.cols && y < sc.rows;
  // ---- Undo and redo (Ctrl+Z, Ctrl+Y) for the map maker -------------------------------------------
  // Each step knows how to undo and redo itself. Props and labels get new ids from the server, so
  // undoing an added one looks it up again by where it is.
  const undoStack = [], redoStack = [];
  function remember(step) {
    setTimeout(() => { if (tool === "build") renderToolOpts(); });
    step.sc = viewSc;
    undoStack.push(step);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  function undoRedo(redo) {
    const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
    let step = from.pop();
    while (step && !S.scenes.some(x => x.id === step.sc)) step = from.pop();     // its scene was deleted
    if (!step) return note(redo ? "Nothing to redo." : "Nothing to undo.");
    if (viewSc !== step.sc) { viewSc = step.sc; renderAll(); fitView(); }
    (redo ? step.redo : step.undo)();
    to.push(step);
    if (tool === "build") renderToolOpts();
    note((redo ? "Redone: " : "Undone: ") + step.what);
  }
  const propSnap = pr => ({ k: pr.k, x: pr.x, y: pr.y, r: pr.r || 0 });
  function addProp(pr) { action("prop_add", { sc: viewSc, ...propSnap(pr) }); }
  function delPropAt(pr) { const q = (scene().props || []).find(x => x.x === pr.x && x.y === pr.y && x.k === pr.k); if (q) action("prop_del", { sc: viewSc, id: q.id }); }
  function addLabel(lb) { action("label_add", { sc: viewSc, x: lb.x, y: lb.y, text: lb.text, dm: lb.dm }); }
  function delLabelAt(lb) { const q = (scene().labels || []).find(x => x.x === lb.x && x.y === lb.y && x.text === lb.text); if (q) action("label_del", { sc: viewSc, id: q.id }); }
  function setMap(sc, payload, what) {
    const before = {
      sc: sc.id, tiles: (sc.tiles || "").length === sc.cols * sc.rows ? sc.tiles : ".".repeat(sc.cols * sc.rows), wl: sc.wl,
      props: (sc.props || []).map(propSnap), labels: true, cols: sc.cols, rows: sc.rows,
      locked: (sc.walls || []).filter(w => w.door && w.locked && w.tile).map(w => w.tile),
    };
    const oldLabels = (sc.labels || []).map(lb => ({ x: lb.x, y: lb.y, text: lb.text, dm: lb.dm }));
    remember({
      what,
      undo: () => { action("map_set", { ...before, sc: viewSc }); oldLabels.forEach(addLabel); },
      redo: () => action("map_set", { ...payload, sc: viewSc }),
    });
    action("map_set", payload);
  }

  function sendTiles(edits, record = true) {
    const sc = scene();
    if (!sc || !edits.length) return;
    if (record) {
      const T = tilesOf(sc), W = wallsOf(sc), prev = [], now = [];
      for (const [x, y, t, w = 1] of edits) {
        const i = y * sc.cols + x, old = T[i], oldW = +W[i];
        if (old !== t || oldW !== +w) { prev.push([x, y, old, oldW]); now.push([x, y, t, +w]); }
      }
      if (!now.length) return;
      edits = now;
      remember({ what: "drawing", undo: () => sendTiles(prev, false), redo: () => sendTiles(now, false) });
    }
    if (tilesLocalSc !== sc.id) { tilesLocal.clear(); tilesLocalSc = sc.id; }
    for (const [x, y, t, w = 1] of edits) tilesLocal.set(y * sc.cols + x, t + (w ? "1" : "0"));
    action("tiles", { sc: sc.id, edits });
    redraw();
  }
  function paintTileAt(p) {
    const sc = scene(), c = cellAt(p), o = Math.floor(build.brush / 2);
    for (let y = c.y - o; y < c.y - o + build.brush; y++) for (let x = c.x - o; x < c.x - o + build.brush; x++) {
      if (inScene(sc, x, y)) act.cells.set(y * sc.cols + x, act.code + act.w);
    }
    redraw();
  }
  const propAt = c => (scene().props || []).find(pr => pr.x === c.x && pr.y === c.y);
  function labelAt(p) {
    let best = null, bd = 0.8;
    for (const lb of scene().labels || []) {
      const d = Math.hypot((lb.x - p.x) / Math.max(1, lb.text.length * 0.16), lb.y - p.y);
      if (d < bd) { bd = d; best = lb; }
    }
    return best;
  }
  function doorFloor(sc, T, c) {
    const near = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => inScene(sc, c.x + dx, c.y + dy) ? T[(c.y + dy) * sc.cols + c.x + dx] : ".");
    return near.includes("o") ? "o" : "f";
  }
  // Alt+middle-click: pick what's there to draw more of it (a floor, a prop, a door), or copy a token
  function pickAt(p) {
    const tok = tokenAt(p);
    if (tok) return openTokenForm({ copy: tok });
    const sc = scene(), c = cellAt(p);
    if (!inScene(sc, c.x, c.y)) return;
    const pr = propAt(c);
    let what;
    if (pr) {
      build.mode = "prop"; build.prop = pr.k; build.rot = pr.r || 0;
      what = (PROP_INFO.find(x => x[0] === pr.k) || [0, pr.k])[1];
    } else {
      const t = tilesOf(sc)[c.y * sc.cols + c.x];
      if (t === "D" || t === "S") { build.mode = "door"; build.secret = t === "S"; what = t === "S" ? "Secret door" : "Door"; }
      else if (t === "." || t === "?") { build.mode = "erase"; what = "Erase"; }
      else {
        build.tile = t;
        build.walls = wallsOf(sc)[c.y * sc.cols + c.x] === "1";
        if (build.mode !== "room" && build.mode !== "brush") build.mode = "brush";
        what = (TILE_INFO.find(x => x[0] === t) || [0, t])[1];
      }
    }
    if (tool !== "build") setTool("build"); else renderToolOpts();
    redraw();
    note(`Picked: ${what}`);
  }
  function buildDown(e, p) {
    const sc = scene(), c = cellAt(p), rub = e.button === 2;
    const w = rub || build.mode === "erase" || build.walls ? "1" : "0";
    if (build.mode === "room") { act = { kind: "room", a: p, b: p, code: rub ? "." : build.tile, w }; redraw(); return; }
    if (build.mode === "brush" || build.mode === "erase") {
      act = { kind: "paint", code: rub || build.mode === "erase" ? "." : build.tile, w, cells: new Map() };
      paintTileAt(p);
      return;
    }
    if (!inScene(sc, c.x, c.y)) return;
    if (build.mode === "door") {
      const T = tilesOf(sc), t = T[c.y * sc.cols + c.x];
      if (rub) { if (t === "D" || t === "S") sendTiles([[c.x, c.y, doorFloor(sc, T, c)]]); return; }
      if (t === "S" && !build.secret) { sendTiles([[c.x, c.y, "D"]]); note("Revealed: players can see that door now."); }
      else if (t === "D" && build.secret) sendTiles([[c.x, c.y, "S"]]);
      else if (t === "D" || t === "S") sendTiles([[c.x, c.y, doorFloor(sc, T, c)]]);
      else sendTiles([[c.x, c.y, build.secret ? "S" : "D"]]);
      return;
    }
    if (build.mode === "link") {
      const pr = propAt(c);
      if (pr) openLinkForm(pr);
      else note("Click stairs (or any prop) to choose where it leads.");
      return;
    }
    if (build.mode === "prop") {
      const pr = propAt(c);
      if (pr) {
        const was = propSnap(pr);
        remember({ what: "taking a prop away", undo: () => addProp(was), redo: () => delPropAt(was) });
        action("prop_del", { sc: sc.id, id: pr.id });
      } else if (!rub) {
        const now = { k: build.prop, x: c.x, y: c.y, r: build.rot };
        remember({ what: "adding a prop", undo: () => delPropAt(now), redo: () => addProp(now) });
        addProp(now);
      }
      return;
    }
    if (build.mode === "label") {
      const lb = labelAt(p);
      if (lb) {
        const was = { x: lb.x, y: lb.y, text: lb.text, dm: lb.dm };
        const t = rub ? "" : prompt("Change the label (leave it empty to take it away):", lb.text);
        if (t === null) return;
        if (!t.trim()) {
          remember({ what: "taking a label away", undo: () => addLabel(was), redo: () => delLabelAt(was) });
          action("label_del", { sc: sc.id, id: lb.id });
        } else {
          const id = lb.id, text = t.trim();
          remember({ what: "changing a label", undo: () => action("label_edit", { sc: viewSc, id, text: was.text }), redo: () => action("label_edit", { sc: viewSc, id, text }) });
          action("label_edit", { sc: sc.id, id, text });
        }
        return;
      }
      if (rub) return;
      const t = prompt(build.dmLabel ? "A label only you can see:" : "A label everyone can see:");
      if (t && t.trim()) {
        const now = { x: +p.x.toFixed(2), y: +p.y.toFixed(2), text: t.trim().replace(/\s+/g, " ").slice(0, 40), dm: build.dmLabel };
        remember({ what: "adding a label", undo: () => delLabelAt(now), redo: () => addLabel(now) });
        addLabel(now);
      }
    }
  }
  function buildUp(a) {
    const sc = scene();
    if (a.kind === "paint") sendTiles([...a.cells].map(([i, v]) => [i % sc.cols, Math.floor(i / sc.cols), v[0], +v[1]]));
    else if (a.kind === "room") {
      const [x0, y0, x1, y1] = boxCells(a.a, a.b), edits = [];
      for (let y = Math.max(0, y0); y <= Math.min(sc.rows - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(sc.cols - 1, x1); x++) edits.push([x, y, a.code, +a.w]);
      sendTiles(edits);
    }
  }

  // ---- Random maps: a dungeon, a forest or a house ----------------------------------------------
  // o holds the sliders, each 0 (none) to 3 (lots).
  function makeMap(kind, cols, rows, o = build.gen) {
    const T = Array(cols * rows).fill(kind === "dungeon" ? "." : "g"), props = [], taken = new Set(), locked = [];
    const R = Math.random, ri = (a, b) => a + Math.floor(R() * (b - a + 1));
    const lv = (k, a) => a[Math.max(0, Math.min(3, o[k] | 0))];
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = ri(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const lockSome = (doors, chance) => { for (const [x, y] of doors) if (R() < chance) locked.push(`${x},${y}`); };
    const spread = (k, n, cells, r = () => 0) => {          // n of a prop on random free squares from cells
      for (const [x, y] of shuffle(cells.slice())) { if (n <= 0) break; if (put(k, x, y, r())) n--; }
    };
    const ok = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
    const get = (x, y) => (ok(x, y) ? T[y * cols + x] : ".");
    const set = (x, y, t) => { if (ok(x, y)) T[y * cols + x] = t; };
    const put = (k, x, y, r = 0) => {
      if (!ok(x, y) || taken.has(y * cols + x)) return false;
      taken.add(y * cols + x);
      props.push({ k, x, y, r });
      return true;
    };
    const near = (x, y, f) => [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => f(get(x + dx, y + dy)));
    const overlaps = (list, x, y, w, h, gap) => list.some(r => x < r.x + r.w + gap && x + w + gap > r.x && y < r.y + r.h + gap && y + h + gap > r.y);

    if (kind === "forest") {
      // a winding dirt path, a pond, a clearing with a campfire, then trees everywhere else
      let y = ri(Math.floor(rows / 3), Math.floor(rows * 2 / 3));
      for (let x = 0; x < cols; x++) {
        set(x, y, "d"); set(x, y + 1, "d");
        if (R() < 0.35) y = Math.max(1, Math.min(rows - 3, y + (R() < 0.5 ? -1 : 1)));
        set(x, y, "d"); set(x, y + 1, "d");
      }
      const ponds = lv("water", [0, 1, 1, 2]), big = lv("water", [0, 0.7, 1, 1.3]);
      for (let k = 0; k < ponds; k++) {
        const pw = Math.min(cols - 4, Math.round(ri(4, 7) * big)), ph = Math.min(rows - 4, Math.round(ri(3, 5) * big));
        const pond = { x: ri(2, Math.max(2, cols - pw - 2)), y: (k ? R() < 0.5 : R() >= 0.5) ? ri(1, 3) : Math.max(1, rows - ph - 2), w: pw, h: ph };
        const pcx = pond.x + pond.w / 2, pcy = pond.y + pond.h / 2;
        for (let yy = pond.y; yy < pond.y + pond.h; yy++) for (let xx = pond.x; xx < pond.x + pond.w; xx++) {
          const d = ((xx + 0.5 - pcx) / (pond.w / 2)) ** 2 + ((yy + 0.5 - pcy) / (pond.h / 2)) ** 2;
          if (d < 1 - R() * 0.25 && get(xx, yy) === "g") set(xx, yy, "s");
        }
      }
      const cx = ri(Math.floor(cols / 3), Math.floor(cols * 2 / 3)), cy = ri(3, rows - 4);
      const clear = (x, y) => Math.hypot(x - cx, y - cy) < 3.2;
      put("campfire", cx, cy);
      for (let yy = 0; yy < rows; yy++) for (let xx = 0; xx < cols; xx++) {
        if (get(xx, yy) !== "g" || clear(xx, yy) || near(xx, yy, t => t === "d")) continue;
        const r = R(), tr = lv("trees", [0.06, 0.12, 0.2, 0.32]), rk = lv("clutter", [0, 0.015, 0.03, 0.06]);
        if (r < tr) put("tree", xx, yy, ri(0, 3));
        else if (r < tr * 1.3) put("bush", xx, yy);
        else if (r < tr * 1.3 + rk) put("rock", xx, yy, ri(0, 3));
      }
      for (let k = 0; k < lv("clutter", [0, 2, 3, 5]); k++) put("rock", cx + ri(-2, 2), cy + (R() < 0.5 ? -2 : 2), ri(0, 3));
      // snares and pits on the path, and something worth finding off it
      const path = [], wild = [];
      for (let yy = 0; yy < rows; yy++) for (let xx = 0; xx < cols; xx++) {
        if (get(xx, yy) === "d") path.push([xx, yy]);
        else if (get(xx, yy) === "g" && !clear(xx, yy) && !near(xx, yy, t => t === "d")) wild.push([xx, yy]);
      }
      spread("trap", lv("traps", [0, 2, 4, 8]), path);
      spread("chest", lv("treasure", [0, 1, 2, 4]), wild);
      return { tiles: T.join(""), wl: T.map(t => (t === "g" || t === "d" || t === "s" ? "0" : "1")).join(""), props, locked };
    }

    if (kind === "house") {
      // a stone-walled house with wooden floors, split into rooms, in a garden with a path to the door
      const w = Math.min(cols - 4, ri(12, 18)), h = Math.min(rows - 5, ri(9, 13));
      const hx = Math.floor((cols - w) / 2), hy = Math.max(1, Math.floor((rows - h) / 2) - 1);
      for (let y = hy; y < hy + h; y++) for (let x = hx; x < hx + w; x++) {
        set(x, y, x === hx || y === hy || x === hx + w - 1 || y === hy + h - 1 ? "w" : "o");
      }
      // split the inside into rooms with walls one square thick, each with a door
      const inner = [];
      const rooms = [], split = (x, y, rw, rh, depth) => {
        const across = rw >= rh;
        if (depth > 2 || (across ? rw : rh) < 7) { rooms.push({ x, y, w: rw, h: rh }); return; }
        const at = (across ? x : y) + ri(3, (across ? rw : rh) - 4);
        if (across) {
          for (let yy = y; yy < y + rh; yy++) set(at, yy, "w");
          const dy = ri(y + 1, y + rh - 2); set(at, dy, "D"); inner.push([at, dy]);
          split(x, y, at - x, rh, depth + 1); split(at + 1, y, x + rw - at - 1, rh, depth + 1);
        } else {
          for (let xx = x; xx < x + rw; xx++) set(xx, at, "w");
          const dx = ri(x + 1, x + rw - 2); set(dx, at, "D"); inner.push([dx, at]);
          split(x, y, rw, at - y, depth + 1); split(x, at + 1, rw, y + rh - at - 1, depth + 1);
        }
      };
      split(hx + 1, hy + 1, w - 2, h - 2, 0);
      const fx = ri(hx + 2, hx + w - 3), fy = hy + h - 1;               // the front door and the garden path
      set(fx, fy, "D");
      for (let y = fy + 1; y < rows; y++) set(fx, y, "d");
      lockSome([[fx, fy]], lv("locked", [0, 0.25, 0.5, 1]));
      const sec = lv("secret", [0, 0.15, 0.3, 0.6]);
      for (const [x, y] of inner) if (R() < sec) set(x, y, "S");
      lockSome(inner.filter(([x, y]) => get(x, y) === "D"), lv("locked", [0, 0.2, 0.4, 0.8]));
      // furniture by room: the first is the hall, the biggest the main room
      rooms.sort((a, b) => b.w * b.h - a.w * a.h);
      const free = (x, y) => get(x, y) === "o" && !taken.has(y * cols + x) && !near(x, y, t => t === "D");
      const kinds = ["main", "bed", "kitchen", "store", "bed", "study"];
      rooms.forEach((r, i) => {
        const k = kinds[i % kinds.length], X = r.x, Y = r.y, mx = X + Math.floor(r.w / 2), my = Y + Math.floor(r.h / 2);
        const keep = lv("clutter", [0.25, 0.6, 1, 1]);
        const try_ = (p, x, y, rot) => (p === "bed" || R() < keep) && free(x, y) && put(p, x, y, rot);
        if (k === "main") {
          if (r.w >= 4 && r.h >= 4) { try_("rug", mx, my); try_("rug", mx - 1, my); try_("rug", mx, my - 1); try_("rug", mx - 1, my - 1); }
          try_("shelf", X + 1, Y, 0); try_("campfire", X + r.w - 1, Y);
          try_("chair", mx + 1, my + 1, 2);
        } else if (k === "bed") {
          try_("bed", X, Y); if (r.w > 2) try_("bed", X + 2, Y); try_("chest", X, Y + r.h - 1);
        } else if (k === "kitchen") {
          try_("table", mx, my); try_("chair", mx - 1, my, 3); try_("chair", mx + 1, my, 1); try_("chair", mx, my + 1, 2);
          try_("barrel", X, Y); try_("barrel", X + 1, Y); try_("shelf", X + r.w - 1, Y, 1);
        } else if (k === "store") {
          try_("crate", X, Y); try_("crate", X + 1, Y); try_("barrel", X, Y + 1); try_("barrel", X + r.w - 1, Y + r.h - 1); try_("web", X, Y);
        } else {
          try_("table", mx, my); try_("chair", mx, my + 1, 2); try_("shelf", X, Y, 0); try_("shelf", X + 1, Y, 0);
        }
      });
      const floor = [];
      for (let y = hy; y < hy + h; y++) for (let x = hx; x < hx + w; x++) if (free(x, y)) floor.push([x, y]);
      if (o.clutter >= 3) spread("crate", 3, floor);
      spread("chest", lv("treasure", [0, 1, 2, 4]), floor);
      // traps just inside doors and in the rooms
      const byDoor = [];
      for (let y = hy; y < hy + h; y++) for (let x = hx; x < hx + w; x++) {
        if (get(x, y) === "o" && !taken.has(y * cols + x) && near(x, y, t => t === "D" || t === "S")) byDoor.push([x, y]);
      }
      const nTraps = lv("traps", [0, 1, 2, 4]);
      spread("trap", Math.ceil(nTraps / 2), byDoor);
      spread("trap", Math.floor(nTraps / 2), floor);
      // the garden
      const tr = lv("trees", [0.03, 0.06, 0.09, 0.15]);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (get(x, y) !== "g" || near(x, y, t => t === "w" || t === "d" || t === "D") || Math.abs(x - fx) < 2) continue;
        const r = R();
        if (r < tr) put("tree", x, y, ri(0, 3));
        else if (r < tr * 1.55) put("bush", x, y);
      }
      put("well", Math.max(0, hx - 3), Math.min(rows - 2, hy + h + 1));
      if (o.water >= 3) {                                // a garden pond
        const px = hx + w + 2 < cols - 2 ? hx + w + 1 : 1, py = ri(1, Math.max(1, rows - 4));
        for (let y = py; y < py + 3; y++) for (let x = px; x < px + 3; x++) if (get(x, y) === "g" && !taken.has(y * cols + x)) set(x, y, "s");
      }
      return { tiles: T.join(""), wl: T.map(t => (t === "g" || t === "d" || t === "s" ? "0" : "1")).join(""), props, locked };
    }

    // a dungeon: rooms, then corridors joining each to the nearest one already joined, then doors
    const rooms = [], want = Math.max(2, Math.min(18, Math.round(cols * rows / 110 * lv("rooms", [0.5, 0.75, 1, 1.35]))));
    for (let tries = 0; tries < 500 && rooms.length < want; tries++) {
      const w = ri(3, Math.min(9, cols - 4)), h = ri(3, Math.min(7, rows - 4));
      const x = ri(1, cols - w - 1), y = ri(1, rows - h - 1);
      if (overlaps(rooms, x, y, w, h, 2)) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
    }
    const inRoom = new Set();
    for (const r of rooms) {
      r.t = R() < 0.22 ? "o" : "f";
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { set(x, y, r.t); inRoom.add(y * cols + x); }
    }
    const corr = new Set();
    const dig = (a, b) => {
      const path = [], hFirst = R() < 0.5;
      const run = (x1, y1, x2, y2) => {
        for (let x = x1; x !== x2 + Math.sign(x2 - x1 || 1); x += Math.sign(x2 - x1 || 1)) path.push([x, y1]);
        for (let y = y1; y !== y2 + Math.sign(y2 - y1 || 1); y += Math.sign(y2 - y1 || 1)) path.push([x2, y]);
      };
      if (hFirst) run(a.cx, a.cy, b.cx, b.cy);
      else { for (let y = a.cy; y !== b.cy + Math.sign(b.cy - a.cy || 1); y += Math.sign(b.cy - a.cy || 1)) path.push([a.cx, y]); run(a.cx, b.cy, b.cx, b.cy); }
      for (const [x, y] of path) if (get(x, y) === ".") { set(x, y, "f"); corr.add(y * cols + x); }
    };
    const joined = rooms.slice(0, 1);
    for (const r of rooms.slice(1)) {
      const o = joined.reduce((best, q) => Math.hypot(q.cx - r.cx, q.cy - r.cy) < Math.hypot(best.cx - r.cx, best.cy - r.cy) ? q : best);
      dig(r, o);
      joined.push(r);
    }
    if (rooms.length > 4) for (let k = 0; k < 2; k++) dig(rooms[ri(0, rooms.length - 1)], rooms[ri(0, rooms.length - 1)]);
    // doors where a narrow corridor meets a room
    for (const i of corr) {
      const x = i % cols, y = Math.floor(i / cols);
      if (get(x, y) !== "f") continue;
      const lr = solidT(get(x - 1, y)) && solidT(get(x + 1, y)), ud = solidT(get(x, y - 1)) && solidT(get(x, y + 1));
      const meets = (lr && (inRoom.has((y - 1) * cols + x) || inRoom.has((y + 1) * cols + x))) ||
        (ud && (inRoom.has(y * cols + x - 1) || inRoom.has(y * cols + x + 1)));
      let doorNear = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ("DS".includes(get(x + dx, y + dy))) doorNear = true;
      if (meets && !doorNear && R() < 0.6) set(x, y, R() < lv("secret", [0, 0.06, 0.12, 0.3]) ? "S" : "D");
    }
    const doors = [];
    for (let i = 0; i < T.length; i++) if (T[i] === "D") doors.push([i % cols, Math.floor(i / cols)]);
    lockSome(doors, lv("locked", [0, 0.15, 0.3, 0.6]));
    // a pool or a pit in some big rooms
    for (const r of rooms) {
      if (r.w >= 6 && r.h >= 5 && R() < lv("water", [0, 0.15, 0.3, 0.6])) {
        const t = R() < 0.7 ? "s" : "p";
        for (let y = r.y + 2; y < r.y + r.h - 2; y++) for (let x = r.x + 2; x < r.x + r.w - 2; x++) set(x, y, t);
      }
    }
    // furniture: stairs in the first room, treasure in the one furthest from it, the rest dressed at random
    const free = (x, y) => "fo".includes(get(x, y)) && !taken.has(y * cols + x) && inRoom.has(y * cols + x)
      && !near(x, y, t => t === "D") && !near(x, y, t => t === "s" || t === "p") &&
      ![[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => corr.has((y + dy) * cols + x + dx));
    const corners = r => [[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1]];
    if (rooms.length) {
      const first = rooms[0];
      const far = rooms.reduce((b, q) => Math.hypot(q.cx - first.cx, q.cy - first.cy) > Math.hypot(b.cx - first.cx, b.cy - first.cy) ? q : b);
      for (const [x, y] of corners(first)) if (free(x, y)) { put("stairs", x, y, ri(0, 3)); break; }
      if (o.treasure > 0) {
        if (free(far.cx, far.cy)) put(R() < 0.5 ? "chest" : "altar", far.cx, far.cy); else for (const [x, y] of corners(far)) if (free(x, y)) { put("chest", x, y); break; }
      }
      let extra = lv("treasure", [0, 0, 1, 3]);
      for (const r of shuffle(rooms.filter(q => q !== first && q !== far))) {
        if (extra <= 0) break;
        for (const [x, y] of corners(r)) if (free(x, y)) { put("chest", x, y); extra--; break; }
      }
      const dress = lv("clutter", [0, 0.45, 1, 1]);
      for (const r of rooms) {
        if (r === first || r === far || R() >= dress) continue;
        const theme = ri(0, 4);
        if (theme === 0) for (const [x, y] of corners(r)) { if (free(x, y) && R() < 0.7) put(R() < 0.5 ? "barrel" : "crate", x, y); }
        else if (theme === 1 && r.w >= 5 && r.h >= 5) for (const [x, y] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) { if (free(x, y)) put("pillar", x, y); }
        else if (theme === 2 && free(r.cx, r.cy)) { put("table", r.cx, r.cy); if (free(r.cx - 1, r.cy)) put("chair", r.cx - 1, r.cy, 3); if (free(r.cx + 1, r.cy)) put("chair", r.cx + 1, r.cy, 1); }
        else if (theme === 3) { if (free(r.cx, r.cy)) put("statue", r.cx, r.cy); for (const [x, y] of corners(r).slice(0, 2)) if (free(x, y)) put("torch", x, y); }
        else { for (const [x, y] of corners(r)) if (free(x, y) && R() < 0.5) put(R() < 0.6 ? "rubble" : "web", x, y, ri(0, 3)); }
      }
    }
    for (const i of corr) if (R() < lv("clutter", [0, 0.02, 0.04, 0.1])) put(R() < 0.5 ? "rubble" : "web", i % cols, Math.floor(i / cols), ri(0, 3));
    // traps: most in corridors and just inside doors, the rest in rooms
    const nTraps = Math.round(rooms.length * lv("traps", [0, 0.35, 0.7, 1.4]));
    const halls = [...corr].map(i => [i % cols, Math.floor(i / cols)]).filter(([x, y]) => get(x, y) === "f");
    const inside = [...inRoom].map(i => [i % cols, Math.floor(i / cols)]).filter(([x, y]) => "fo".includes(get(x, y)));
    spread("trap", Math.ceil(nTraps * 0.6), halls);
    spread("trap", Math.floor(nTraps * 0.4), inside);
    return { tiles: T.join(""), wl: "1".repeat(T.length), props, locked };
  }

  function openLinkForm(pr) {
    const box = $("linkForm"), sc = scene();
    const others = S.scenes.filter(x => x.id !== sc.id);
    box.innerHTML = `<form class="win narrow" autocomplete="off">
      <div class="row between"><h2 style="margin:0">Where does it lead?</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>
      ${others.length ? `<label class="field">Goes to<select name="to"><option value="">Nowhere</option>${others.map(x => `<option value="${x.id}"${pr.to === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      <label class="check"><input type="checkbox" name="open"${pr.open ? " checked" : ""}> Players can walk onto it to go there by themselves</label>
      <p class="muted small">Then players can split up across scenes. You click it with the select tool to take the whole party. Tokens arrive next to whatever leads back.</p>`
      : `<p class="muted">Make another scene first (Scenes tab), then come back and link it.</p>`}
      <div class="row"><button class="btn primary" type="submit">Save</button></div>
    </form>`;
    box.hidden = false;
    const form = box.querySelector("form");
    form.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeModal("linkForm"); });
    form.addEventListener("submit", e => {
      e.preventDefault();
      if (form.elements.to) action("prop_link", { sc: sc.id, id: pr.id, to: form.elements.to.value, open: form.elements.open.checked });
      closeModal("linkForm");
    });
  }

  async function importMap(sc) {
    const f = await pickFile();
    if (!f) return;
    note("Getting the map ready…");
    try {
      const r = await shrink(f, 3200, false);
      // a first guess at the grid: most battle maps are 70 or 100 pixels a square
      const ppsq = [70, 100, 140, 50, 128, 256, 200].find(n => r.w % n === 0 && r.h % n === 0 && r.w / n <= LIM.grid) || 70;
      const cols = Math.max(1, Math.min(LIM.grid, Math.round(r.w / ppsq)));
      const rows = Math.max(1, Math.min(LIM.grid, Math.round(cols * r.h / r.w)));
      action("scene_img", { sc: sc.id, src: r.url, cols, rows });
      note(`Map added as ${cols} × ${rows} squares. Change Squares across (Scenes tab) if the grid doesn't match.`);
    } catch { note("That picture couldn't be used. Try a PNG or JPG."); }
  }

  function finishWall() {
    if (wallPts && wallPts.length >= 4) action("wall_add", { sc: viewSc, p: wallPts, door: wallMode === "door" });
    wallPts = null;
    redraw();
  }
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
    if (tool === "walls" && isDm() && e.button === 2) { finishWall(); return; }
    if (tool === "build" && isDm() && !spaceDown && !e.altKey && (e.button === 0 || e.button === 2)) { buildDown(e, p); return; }
    if (e.button === 1 && e.altKey && isDm()) { e.preventDefault(); pickAt(p); return; }     // like pick block
    if (tool === "lib" && libArm && isDm() && !spaceDown && !e.altKey) {
      if (e.button === 0) { placeFromLib(libArm, p); return; }
      if (e.button === 2) { libArm = null; renderToolOpts(); redraw(); return; }
    }
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
    if (tool === "walls" && isDm()) {
      if (wallMode === "lock" || wallMode === "remove") {
        const w = wallAt(p, wallMode === "lock");
        if (w) action(wallMode === "lock" ? "door_lock" : "wall_del", { sc: viewSc, id: w.id });
        return;
      }
      const v = vertex(p);
      if (!wallPts) wallPts = [v.x, v.y];
      else if (wallPts[wallPts.length - 2] === v.x && wallPts[wallPts.length - 1] === v.y) finishWall();   // same corner twice: done
      else {
        wallPts.push(v.x, v.y);
        if (wallMode === "door") finishWall();
      }
      redraw();
      return;
    }
    if (tool === "fog" && isDm()) {
      if (fogBox) act = { kind: "fogbox", a: p, b: p };
      else { act = { kind: "fog", cells: new Set() }; paintFogAt(p); }
      return;
    }
    const door = wallAt(p, true, 0.22);
    if (door) { action("door", { sc: viewSc, id: door.id }); FX.sound("flip"); return; }
    const t = tokenAt(p);
    if (t) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { selectToken(t.id, true); return; }
      if (!picked.has(t.id)) selectToken(t.id);
      else { sel = t.id; renderCard(true); }
      if (controls(t)) {
        const group = [...picked].map(tokenById).filter(x => x && controls(x)).map(x => ({ id: x.id, ox: x.x, oy: x.y }));
        act = { kind: "token", id: t.id, ox: t.x, oy: t.y, x: t.x, y: t.y, dx: p.x - t.x, dy: p.y - t.y, group, moved: false, sx, sy };
        return;
      }
      return;
    }
    const link = (scene().props || []).find(pr => pr.x === Math.floor(p.x) && pr.y === Math.floor(p.y) && (isDm() ? pr.to : pr.go));
    if (link && !e.shiftKey) {
      if (isDm()) {
        const to = S.scenes.find(x => x.id === link.to);
        if (to && confirm(`Take the party to "${to.name}"? Everyone's tokens on this map go with them.`)) action("link_go", { sc: viewSc, id: link.id });
      } else note(`Drag your token onto it to go to ${link.go}.`);
      return;
    }
    if (e.shiftKey) { act = { kind: "box", a: p, b: p }; return; }
    if (picked.size) selectToken(null);
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
      if (tool === "fog" || tool === "walls" || tool === "build" || (tool === "lib" && libArm)) redraw();
      if (tool === "select") viewport.classList.toggle("on-door", !!wallAt(p, true, 0.22));
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
      sendDrags(act.group.map(g => ({ id: g.id, x: g.ox + act.x - act.ox, y: g.oy + act.y - act.oy })));
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
    else if (act.kind === "paint") paintTileAt(p);
    else if (act.kind === "fogbox" || act.kind === "box" || act.kind === "room") { act.b = p; redraw(); }
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
        // snap the token that was grabbed; the others keep their places around it
        const t = tokenById(a.id), s = snap(t, a.x, a.y), dx = s.x - a.ox, dy = s.y - a.oy;
        const moves = a.group.map(g => ({ id: g.id, x: g.ox + dx, y: g.oy + dy }));
        for (const m of moves) { const x = tokenById(m.id); if (x) { x.x = m.x; x.y = m.y; } }
        if (moves.length === 1) action("tok_move", { sc: viewSc, id: a.id, x: s.x, y: s.y });
        else action("tok_group", { sc: viewSc, op: "move", moves });
      }
    } else if (a.kind === "box") {
      const x0 = Math.min(a.a.x, a.b.x), x1 = Math.max(a.a.x, a.b.x), y0 = Math.min(a.a.y, a.b.y), y1 = Math.max(a.a.y, a.b.y);
      for (const t of scene().tokens) {
        const cx = t.x + t.size / 2, cy = t.y + t.size / 2;
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) picked.add(t.id);
      }
      sel = [...picked].pop() || null;
      renderCard(true);
    } else if (a.kind === "ruler") {
      live({ k: "ruler", sc: viewSc, off: true });
    } else if (a.kind === "draw") {
      const q = a.line.p;
      const big = a.line.shape ? Math.hypot(q[2] - q[0], q[3] - q[1]) > 0.2 : q.length > 4 || Math.hypot(q[2] - q[0], q[3] - q[1]) > 0.05;
      if (big) {
        scene().lines.push({ ...a.line, id: "tmp", by: me });
        action("line_add", { sc: viewSc, line: a.line });
      }
    } else if (a.kind === "paint" || a.kind === "room") buildUp(a);
    else if (a.kind === "fog") sendFog(a.cells);
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
  viewport.addEventListener("pointerleave", () => { hover = null; if (tool === "fog" || tool === "build") redraw(); });
  viewport.addEventListener("contextmenu", e => e.preventDefault());
  viewport.addEventListener("dblclick", e => {
    const t = tokenAt(worldPt(e));
    if (t && t.char && EXTRAS) openSheet(t.char);
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
      if (!$("handout").hidden) return closeModal("handout");
      if (!$("statBlock").hidden) return closeModal("statBlock");
      if (!$("linkForm").hidden) return closeModal("linkForm");
      if (libArm) { libArm = null; renderToolOpts(); return redraw(); }
      if (act) return cancelAct();
      if (wallPts) { wallPts = null; return redraw(); }
      selectToken(null);
      return;
    }
    if (e.key === "Enter" && wallPts && !typing()) { finishWall(); return; }
    if (typing() || !$("sheet").hidden || !$("tokenForm").hidden || !$("handout").hidden) return;
    if ((e.ctrlKey || e.metaKey) && isDm() && !act && /^[zy]$/i.test(e.key)) {
      e.preventDefault();
      undoRedo(e.key.toLowerCase() === "y" || e.shiftKey);
      return;
    }
    if (e.key === " ") { spaceDown = true; e.preventDefault(); return; }
    const keys = { v: "select", r: "ruler", d: "draw", e: "erase", g: "ping", f: "fog", w: "walls", b: "build", l: "lib" };
    const k = e.key.toLowerCase();
    if (keys[k] && !e.ctrlKey && !e.metaKey && (!"fwbl".includes(k) || isDm())) { setTool(keys[k]); return; }
    if (k === "t" && tool === "build" && build.mode === "prop") { build.rot = (build.rot + 1) % 4; renderToolOpts(); return redraw(); }
    if (k === "a" && (e.ctrlKey || e.metaKey)) {             // select every token you can move
      e.preventDefault();
      picked.clear();
      for (const t of scene().tokens) if (controls(t)) picked.add(t.id);
      sel = [...picked].pop() || null;
      renderCard(true);
      return redraw();
    }
    const mine = [...picked].map(tokenById).filter(t => t && controls(t));
    if (mine.length) {
      const step = mine.every(t => t.size < 1) ? 0.5 : 1;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault();
        for (const t of mine) { t.x += mv[0]; t.y += mv[1]; }
        if (mine.length === 1) action("tok_move", { sc: viewSc, id: mine[0].id, x: mine[0].x, y: mine[0].y });
        else action("tok_group", { sc: viewSc, op: "move", moves: mine.map(t => ({ id: t.id, x: t.x, y: t.y })) });
        redraw();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (mine.length > 1 && !confirm(`Delete ${mine.length} tokens?`)) return;
        action("tok_group", { sc: viewSc, op: "del", ids: mine.map(t => t.id) });
        selectToken(null);
      }
    }
  });
  addEventListener("keyup", e => { if (e.key === " ") spaceDown = false; });

  // ---- Tools ---------------------------------------------------------------------------------
  function showMode() {
    if (!isDm()) mode = "play";
    document.querySelectorAll("#modeBar button").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
    document.querySelectorAll(".tt-tools [data-modes]").forEach(b => { b.hidden = !b.dataset.modes.split(" ").includes(mode); });
  }
  function setMode(m) {
    if (!isDm()) m = "play";
    if (act) cancelAct();
    mode = m;
    setTool(MODE_TOOL[m] || "select");
  }
  function setTool(t) {
    if (t !== "walls") wallPts = null;
    if (t !== "select") mode = TOOL_MODE[t] || "play";
    showMode();
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
    box.hidden = !["draw", "fog", "ruler", "erase", "ping", "walls", "build", "lib"].includes(tool);
    box.classList.toggle("build", tool === "build");
    box.classList.toggle("lib", tool === "lib");
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
    } else if (tool === "walls") {
      box.append(seg([["wall", "Wall"], ["door", "Door"], ["lock", "Lock"], ["remove", "Remove"]], wallMode, v => { wallMode = v; wallPts = null; }));
      box.append(p({
        wall: "Click grid corners along a wall. Click the last corner again, press Enter or right-click to finish.",
        door: "Click the two ends of a door. Anyone can click a door to open or shut it.",
        lock: "Click a door to lock or unlock it. Players can't open locked doors (they show red to you).",
        remove: "Click a wall or door to take it away.",
      }[wallMode]));
      const sc = scene();
      if (sc && !sc.auto) box.append(p("Walls and doors stop the party's sight when <b>Reveal as the party explores</b> is on (Scenes tab)."));
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "btn danger small-btn";
      clear.textContent = "Remove every wall";
      clear.addEventListener("click", () => { if (confirm("Remove every wall and door on this scene?")) action("walls_clear", { sc: viewSc }); });
      box.append(clear);
    } else if (tool === "build") renderBuildOpts(box, p);
    else if (tool === "lib") renderLib(box, p);
    else if (tool === "ruler") box.append(p(`Drag to measure. Everyone sees your ruler. Each square is ${per()} ${esc(unit())}.`));
    else if (tool === "erase") box.append(p(isDm() ? "Drag over drawings to rub them out." : "Drag over your drawings to rub them out."));
    else if (tool === "ping") box.append(p("Click to make everyone look at a spot. Alt+click pings with any tool."));
  }

  // ---- The Tokens tab ---------------------------------------------------------------------------
  function libEntries(cat) {
    if (cat !== "players") return (S.lib || []).filter(e => e.cat === cat).sort((a, b) => a.name.localeCompare(b.name));
    return Object.entries(S.names).filter(([q]) => !S.dms.includes(q))
      .map(([q, n]) => ({ id: "p:" + q, pid: q, name: n, c: colourOf(q), size: 1 }));
  }
  const libFind = id => libEntries(id.startsWith("p:") ? "players" : (S.lib.find(e => e.id === id) || {}).cat || "").find(e => e.id === id);
  function libSpot(sc, e, p) {
    const n = Math.max(1, e.size || 1), half = n > 1 ? (n - 1) / 2 : 0;
    return { x: Math.max(0, Math.min(sc.cols - n, Math.floor(p.x - half))), y: Math.max(0, Math.min(sc.rows - n, Math.floor(p.y - half))) };
  }
  function placeFromLib(e, p) {
    const sc = scene();
    if (!sc || !e) return;
    const { x, y } = libSpot(sc, e, p);
    if (e.pid) {                                   // a player's token: move theirs here, or make one
      const t = sc.tokens.find(t => t.owner === e.pid || (charById(t.char) || {}).owner === e.pid);
      if (t) { action("tok_move", { sc: sc.id, id: t.id, x, y }); t.x = x; t.y = y; }
      else action("tok_add", { sc: sc.id, tok: { name: e.name, owner: e.pid, c: e.c, size: 1, x, y } });
      redraw();
      return;
    }
    // number them: Bandit, Bandit 2... counting ones still on their way to the server
    const k = sc.id + "|" + e.name, sent = libSent.get(k);
    const same = Math.max(sc.tokens.filter(t => t.name.replace(/\s+\d+$/, "") === e.name).length, sent && Date.now() - sent.t < 3000 ? sent.n : 0);
    libSent.set(k, { n: same + 1, t: Date.now() });
    const tok = { name: same ? `${e.name} ${same + 1}` : e.name, c: e.c, size: e.size || 1, x, y, hp: e.mhp ?? null, mhp: e.mhp ?? null, ac: e.ac ?? null, init: e.init ?? null };
    for (const k of ["sight", "aura", "speed", "elev", "ac2", "img"]) if (e[k] != null) tok[k] = e[k];
    tok.stats = e.stats || statsOf(e.name);
    if (!tok.stats) delete tok.stats;
    else if (tok.speed == null) tok.speed = parseInt(tok.stats.speed, 10) || null;
    if (libHidden) tok.hidden = true;
    action("tok_add", { sc: sc.id, tok });
  }
  function renderLib(box, p) {
    const sc = scene();
    if (!sc) return;
    const keep = box.scrollTop;
    box.append(seg(LIB_TABS, libCat, v => { libCat = v; libArm = null; }));
    const list = libEntries(libCat);
    const grid = document.createElement("div");
    grid.className = "tt-lib";
    for (const e of list) {
      const b = document.createElement("div");
      b.className = "lt" + (libArm && libArm.id === e.id ? " on" : "");
      b.draggable = true;
      b.tabIndex = 0;
      b.dataset.id = e.id;
      const onMap = e.pid && sc.tokens.some(t => t.owner === e.pid || (charById(t.char) || {}).owner === e.pid);
      const pic = e.img ? `background-image:url('${assetUrl(e.img)}');` : "";
      const sub = e.pid ? (onMap ? "On this map" : "Not on this map") : [e.mhp != null ? `HP ${e.mhp}` : "", e.ac != null ? `AC ${e.ac}` : "", e.size > 1 ? `${e.size}×${e.size}` : ""].filter(Boolean).join(" · ");
      b.innerHTML = `<span class="face" style="background-color:${esc(e.c || "#6b7280")};${pic}">${e.img ? "" : esc(e.name.slice(0, 1).toUpperCase())}</span>
        <span class="nm">${esc(e.name)}</span><span class="sub">${esc(sub)}</span>
        ${e.pid ? "" : `<button type="button" class="del" title="Take it off the list" aria-label="Take ${esc(e.name)} off the list">✕</button>`}`;
      grid.append(b);
    }
    box.append(grid);
    if (!list.length) box.append(p(libCat === "players" ? "Players show up here once they've opened the campaign link." : "Nothing here yet. Put a token on the map, select it, then save it here."));
    if (libCat !== "players") {
      const l = document.createElement("label");
      l.className = "check small";
      l.innerHTML = `<input type="checkbox" ${libHidden ? "checked" : ""}> Put them down hidden from players`;
      l.querySelector("input").addEventListener("change", ev => { libHidden = ev.target.checked; });
      box.append(l);
      const r = document.createElement("div");
      r.className = "row";
      const t = sel && tokenById(sel);
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn small-btn";
      save.disabled = !t || !!(t.owner || t.char);
      save.textContent = t && !save.disabled ? `Save ${t.name} here` : "Save the selected token here";
      save.title = "Select a monster or NPC on the map, then save it to this list to use again";
      save.addEventListener("click", () => { if (t) action("lib_add", { sc: sc.id, id: t.id, cat: libCat }); });
      const make = document.createElement("button");
      make.type = "button";
      make.className = "btn small-btn";
      make.textContent = "Make a new token";
      make.addEventListener("click", () => openTokenForm());
      r.append(save, make);
      box.append(r);
    }
    box.append(p(libArm ? `Click the map to put down ${esc(libArm.name)}. Right-click or Esc when you're done.`
      : libCat === "players" ? "Drag a player onto the map. If they already have a token here, it moves there."
      : "Drag one onto the map, or click it and then click the map (as many times as you like)."));
    box.scrollTop = keep;
  }
  function libSignature() {
    const sc = scene();
    return JSON.stringify([S.lib, S.names, S.dms, sel, sc && sc.id, sc && sc.tokens.map(t => t.owner || "")]);
  }
  function initLib() {
    const box = $("toolOpts");
    box.addEventListener("click", e => {
      const card = e.target.closest(".tt-lib .lt");
      if (!card) return;
      const en = libFind(card.dataset.id);
      if (!en) return;
      if (e.target.closest(".del")) {
        if (confirm(`Take ${en.name} off the list? Tokens already on the map stay.`)) action("lib_del", { id: en.id });
        return;
      }
      libArm = libArm && libArm.id === en.id ? null : en;
      renderToolOpts();
      redraw();
    });
    box.addEventListener("keydown", e => {
      const card = e.target.closest && e.target.closest(".tt-lib .lt");
      if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); card.click(); }
    });
    box.addEventListener("dragstart", e => {
      const card = e.target.closest && e.target.closest(".tt-lib .lt");
      if (!card) return;
      e.dataTransfer.setData("text/x-ace-lib", card.dataset.id);
      e.dataTransfer.effectAllowed = "copy";
    });
    viewport.addEventListener("dragover", e => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes("text/x-ace-lib")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
    });
    viewport.addEventListener("drop", e => {
      const id = e.dataTransfer && e.dataTransfer.getData("text/x-ace-lib");
      if (!id || !isDm()) return;
      e.preventDefault();
      placeFromLib(libFind(id), worldPt(e));
    });
  }

  // ---- Selected token(s) ----------------------------------------------------------------------
  function renderBuildOpts(box, p) {
    const sc = scene();
    if (!sc) return;
    const btn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.innerHTML = label;
      b.addEventListener("click", fn);
      return b;
    };
    const row = () => { const r = document.createElement("div"); r.className = "row"; return r; };
    const ur = row();
    const ub = btn("↶ Undo", "btn small-btn", () => undoRedo(false)), rb = btn("↷ Redo", "btn small-btn", () => undoRedo(true));
    ub.title = "Undo (Ctrl+Z)";
    rb.title = "Redo (Ctrl+Y)";
    ub.disabled = !undoStack.length;
    rb.disabled = !redoStack.length;
    ur.append(ub, rb);
    box.append(ur);
    const modes = seg([["room", "Room"], ["brush", "Brush"], ["erase", "Erase"], ["door", "Door"], ["prop", "Props"], ["link", "Stairs"], ["label", "Label"]],
      build.mode, v => { build.mode = v; });
    modes.classList.add("tt-modes");                    // two rows, so none get cut off
    box.append(modes);
    if (build.mode === "room" || build.mode === "brush") {
      const r = row();
      r.classList.add("tt-swatches");
      for (const [t, name, c] of TILE_INFO) {
        const b = btn(`<i style="background:${c}"></i>${name}`, "tt-swatch" + (build.tile === t ? " on" : ""), () => { build.tile = t; renderToolOpts(); });
        r.append(b);
      }
      box.append(r);
      const l = document.createElement("label");
      l.className = "check small";
      l.title = "Walls go where what you paint meets rock. Turn this off for open ground: fields, a pond, a forest";
      l.innerHTML = `<input type="checkbox" ${build.walls ? "checked" : ""}> Walls round it`;
      l.querySelector("input").addEventListener("change", e => { build.walls = e.target.checked; });
      box.append(l);
    }
    if (build.mode === "brush" || build.mode === "erase") {
      const r = row();
      r.append(Object.assign(document.createElement("span"), { className: "muted small", textContent: "Size" }),
        seg([[1, "1"], [2, "2"], [3, "3"], [5, "5"]], build.brush, v => { build.brush = v; }));
      box.append(r);
    }
    if (build.mode === "prop") {
      const grid = document.createElement("div");
      grid.className = "tt-props";
      for (const [k, name] of PROP_INFO) {
        const b = document.createElement("button");
        b.type = "button";
        b.title = name;
        b.className = build.prop === k ? "on" : "";
        const cv = document.createElement("canvas");
        cv.width = cv.height = 64;
        const g = cv.getContext("2d");
        g.fillStyle = PAPER; g.fillRect(0, 0, 64, 64);
        g.setTransform(64, 0, 0, 64, 0, 0);
        paintProp(g, { k, x: 0, y: 0, r: 0 });
        b.append(cv, Object.assign(document.createElement("span"), { textContent: name }));
        b.addEventListener("click", () => { build.prop = k; renderToolOpts(); });
        grid.append(b);
      }
      box.append(grid);
      const r = row();
      r.append(btn("Turn (T)", "btn small-btn", () => { build.rot = (build.rot + 1) % 4; redraw(); }));
      box.append(r);
    }
    if (build.mode === "door") box.append(seg([[false, "Door"], [true, "Secret door"]], build.secret, v => { build.secret = v; }));
    if (build.mode === "label") {
      const l = document.createElement("label");
      l.className = "check small";
      l.innerHTML = `<input type="checkbox" ${build.dmLabel ? "checked" : ""}> Only I can see it`;
      l.querySelector("input").addEventListener("change", e => { build.dmLabel = e.target.checked; });
      box.append(l);
    }
    box.append(p({
      room: "Drag out a room. Walls go round it by themselves (untick Walls round it for open ground), and rooms that touch join up. Right-drag to dig it back out.",
      brush: "Paint corridors, pools or a river. Turn off Walls round it for open ground like fields and ponds. Right-drag rubs out.",
      erase: "Drag to rub squares back out to solid rock.",
      door: build.secret ? "Players see plain wall where a secret door is, until you click it with Door picked to reveal it."
        : "Click a square in a gap between walls to put a door there, and click it again to take it away. Click a secret door to reveal it.",
      link: "Click stairs (or any prop) to choose which scene it leads to. Click it with the select tool to take the party there.",
      prop: "Click a square to put it there. Click a prop to take it away. T turns it.",
      label: "Click to add a label. Click a label to change it, or right-click to take it away.",
    }[build.mode] + " Alt+middle-click picks what's on a square."));
    // random maps and pictures
    const r = row();
    const kind = document.createElement("select");
    kind.innerHTML = [["dungeon", "Dungeon"], ["forest", "Forest"], ["house", "House"]]
      .map(([v, n]) => `<option value="${v}" ${build.kind === v ? "selected" : ""}>${n}</option>`).join("");
    kind.addEventListener("change", () => { build.kind = kind.value; renderToolOpts(); });
    const size = document.createElement("select");
    size.innerHTML = [["", `This size (${sc.cols} × ${sc.rows})`], ["24x16", "Small (24 × 16)"], ["36x24", "Medium (36 × 24)"], ["50x34", "Large (50 × 34)"]]
      .map(([v, n]) => `<option value="${v}" ${build.size === v ? "selected" : ""}>${n}</option>`).join("");
    size.addEventListener("change", () => { build.size = size.value; });
    r.append(kind, size);
    box.append(r);
    const make = btn("Make a random map", "btn small-btn", () => {
      const sc = scene();
      const [cols, rows] = build.size ? build.size.split("x").map(Number) : [sc.cols, sc.rows];
      if (cols < 12 || rows < 10) return note("Make the scene at least 12 × 10 squares first.");
      if ((/[^.]/.test(sc.tiles || "") || (sc.props || []).length) && !confirm("Swap the map you've drawn for a new one?")) return;
      const m = makeMap(build.kind, cols, rows);
      setMap(sc, { sc: sc.id, tiles: m.tiles, wl: m.wl, props: m.props, locked: m.locked, labels: true, cols, rows }, "the random map");
    });
    const gen = document.createElement("div");
    gen.className = "tt-gen";
    const SLIDERS = {
      dungeon: [["rooms", "Rooms"], ["traps", "Traps"], ["locked", "Locked doors"], ["secret", "Secret doors"], ["treasure", "Treasure"], ["water", "Pools and pits"], ["clutter", "Clutter"]],
      forest: [["trees", "Trees"], ["water", "Ponds"], ["traps", "Traps"], ["treasure", "Treasure"], ["clutter", "Rocks"]],
      house: [["locked", "Locked doors"], ["secret", "Secret doors"], ["traps", "Traps"], ["treasure", "Treasure"], ["clutter", "Furniture"], ["trees", "Garden"]],
    }[build.kind] || [];
    const AMOUNT = ["None", "A few", "Some", "Lots"];
    for (const [k, name] of SLIDERS) {
      const l = document.createElement("label");
      const low = k === "rooms" ? ["Fewest", "Fewer", "Normal", "Lots"] : k === "trees" ? ["Sparse", "Light", "Normal", "Dense"] : AMOUNT;
      l.innerHTML = `<span>${name}</span><input type="range" min="0" max="3" step="1" value="${build.gen[k]}"><b>${low[build.gen[k]]}</b>`;
      const inp = l.querySelector("input"), out = l.querySelector("b");
      inp.addEventListener("input", () => { build.gen[k] = +inp.value; out.textContent = low[+inp.value]; });
      gen.append(l);
    }
    box.append(gen, make, p("Only you can see the traps and which doors are locked. Players find out the hard way."));
    const r2 = row();
    r2.append(btn("Import a map picture", "btn small-btn", () => importMap(sc)));
    if (sc.img) r2.append(btn("Take the picture off", "btn small-btn", () => action("scene_img", { sc: sc.id, src: "" })));
    r2.append(btn("Clear what I've drawn", "btn danger small-btn", () => {
      const sc = scene();
      if (confirm("Clear the floors, props and labels you've drawn on this scene? (Ctrl+Z brings them back.)")) setMap(sc, { sc: sc.id, tiles: ".".repeat(sc.cols * sc.rows), wl: "1".repeat(sc.cols * sc.rows), props: [], locked: [], labels: true }, "clearing the map");
    }));
    box.append(r2);
    if (!sc.fog || !sc.auto) {
      box.append(p("Turn on fog to have the walls you draw hide the rest of the map until the party explores it."),
        btn("Turn on fog and exploring", "btn small-btn", () => action("scene_edit", { sc: sc.id, fog: true, auto: true })));
    }
  }

  function selectToken(id, add) {
    if (tool === "lib") setTimeout(renderToolOpts);          // the Save button names the selected token
    if (!id) picked.clear();
    else if (add) { if (picked.has(id)) picked.delete(id); else picked.add(id); }
    else { picked.clear(); picked.add(id); }
    sel = id && picked.has(id) ? id : ([...picked].pop() || null);
    renderCard(true);
    redraw();
  }
  const SIZES = [[0.5, "Tiny"], [1, "Medium (1 sq)"], [2, "Large (2)"], [3, "Huge (3)"], [4, "Gargantuan (4)"], [6, "Colossal (6)"]];
  function renderCard(force) {
    const card = $("tokenCard");
    const list = [...picked].map(tokenById).filter(Boolean);
    if (!list.length) { card.hidden = true; card.dataset.id = ""; return; }
    const key = list.length > 1 ? "group:" + list.map(t => t.id).join(",") : list[0].id;
    if (!force && card.dataset.id === key && card.contains(document.activeElement)) return;
    const open = new Set([...card.querySelectorAll("details[open]")].map(d => d.dataset.sec));
    card.dataset.id = key;
    card.hidden = false;
    card.innerHTML = list.length > 1 ? groupCard(list) : tokenCard(tokenById(sel) || list[0]);
    card.querySelectorAll("details").forEach(d => { if (open.has(d.dataset.sec)) d.open = true; });
  }
  function hpRow() {
    return `<div class="row hp-row"><input type="number" class="num" id="hpDelta" min="0" placeholder="Amount" aria-label="Damage or healing">
      <button type="button" class="btn danger small-btn" data-hp="-1">Damage</button><button type="button" class="btn small-btn" data-hp="1">Heal</button></div>`;
  }
  function tokenCard(t) {
    const can = controls(t), dm = isDm(), ch = charById(t.char);
    const hpKnown = t.hp != null || t.mhp != null;
    let h = `<div class="row between card-head">${can ? `<input class="name" data-k="name" value="${esc(t.name)}" maxlength="40" aria-label="Token name">` : `<h3>${esc(t.name)}</h3>`}
      ${t.ac != null ? `<span class="badge" title="Armour class">AC ${t.ac}</span>` : ""}<button type="button" class="x" data-close aria-label="Close">✕</button></div>`;
    if (ch && EXTRAS) h += `<button type="button" class="link-btn" data-sheet>Open ${esc(ch.name)}'s sheet</button>`;
    if (dm) h += `<button type="button" class="btn small-btn more-btn" data-more>${t.stats ? "More info: stats, skills, attacks" : "More info"}</button>`;
    if (hpKnown) {
      const f = t.mhp ? Math.max(0, Math.min(1, t.hp / t.mhp)) : 0;
      h += `<div class="hpbar"><i style="width:${f * 100}%"></i><b>${t.hp ?? "?"} / ${t.mhp ?? "?"} HP</b></div>`;
    } else if (t.look) h += `<p class="small">Looks <span class="look ${t.look}">${t.look}</span></p>`;
    if (can) h += hpRow();
    if (t.conds.length) h += `<div class="conds">${t.conds.map(c => `<button type="button" class="chip on" data-cond="${c}"${can ? ` title="Click to remove"` : " disabled"}>${c}</button>`).join("")}</div>`;
    if (can) {
      h += `<details data-sec="conds"><summary>Conditions</summary><div class="conds">${S.conditions.map(c => `<button type="button" class="chip${t.conds.includes(c) ? " on" : ""}" data-cond="${c}">${c}</button>`).join("")}</div></details>
        <details data-sec="stats"><summary>Stats, size and look</summary>
          <div class="row"><label class="small muted">HP <input type="number" class="num" data-k="hp" value="${t.hp ?? ""}"></label>
            <label class="small muted">Max <input type="number" class="num" data-k="mhp" value="${t.mhp ?? ""}"></label>
            <label class="small muted">AC <input type="number" class="num" data-k="ac" value="${t.ac ?? ""}"></label></div>
          <div class="row"><label class="small muted">Size <select data-k="size">${SIZES.map(([v, l]) => `<option value="${v}"${v === t.size ? " selected" : ""}>${l}</option>`).join("")}</select></label>
            ${ch ? "" : `<label class="small muted">Init <input type="number" class="num" data-k="init" value="${t.init ?? ""}"></label>`}
            <label class="small muted" title="How far it sees, in squares, when the fog clears as the party explores">Sight <input type="number" class="num" data-k="sight" min="0" max="60" value="${t.sight ?? (t.owner || t.char ? 12 : 0)}"></label></div>
          <div class="row"><label class="small muted" title="How far it can move in a turn">Speed <input type="number" class="num" data-k="speed" min="0" value="${t.speed ?? ""}"></label>
            <label class="small muted" title="Flying (more than 0) or burrowing (less than 0), in ${esc(unit())}">Height <input type="number" class="num" data-k="elev" value="${t.elev ?? ""}"></label>
            <label class="small muted" title="A ring round it, in ${esc(unit())}: its reach, an aura, the light of a torch">Aura <input type="number" class="num" data-k="aura" min="0" value="${t.aura ?? ""}"></label></div>
          <div class="row">${TOKEN_COLOURS.map(c => `<button type="button" class="sw${c === t.c ? " on" : ""}" style="--c:${c}" data-colour="${c}" aria-label="Colour"></button>`).join("")}</div>
          <button type="button" class="btn small-btn" data-pic>${t.img ? "Change picture" : "Add a picture"}</button>
        </details>`;
      if (dm) {
        const people = Object.entries(S.names).filter(([q]) => !S.dms.includes(q));
        h += `<details data-sec="dm"><summary>DM</summary>
          <div class="row"><label class="check"><input type="checkbox" data-k="hidden"${t.hidden ? " checked" : ""}> Hidden from players</label>
            <label class="check"><input type="checkbox" data-k="showhp"${t.showhp ? " checked" : ""}> Players see its HP</label></div>
          <div class="row"><label class="small muted">Moved by <select data-k="owner"><option value="">DM only</option>${people.map(([q, n]) => `<option value="${q}"${t.owner === q ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
            <label class="small muted extra">Sheet <select data-k="char"><option value="">None</option>${S.chars.map(c => `<option value="${c.id}"${t.char === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label></div>
          <label class="small muted">Note<textarea data-k="note" rows="2" maxlength="500" placeholder="Only DMs and whoever moves it see this">${esc(t.note || "")}</textarea></label>
        </details>`;
      } else h += `<label class="small muted">Note<textarea data-k="note" rows="2" maxlength="500">${esc(t.note || "")}</textarea></label>`;
      h += `<div class="row card-btns"><button type="button" class="btn small-btn extra" data-init>Initiative</button>
        <button type="button" class="btn small-btn" data-front>To front</button><button type="button" class="btn danger small-btn" data-del>Delete</button></div>`;
    } else if (t.note) h += `<p class="small">${esc(t.note)}</p>`;
    return h;
  }
  function groupCard(list) {
    const mine = list.filter(controls);
    let h = `<div class="row between card-head"><h3>${list.length} tokens</h3><button type="button" class="x" data-close aria-label="Close">✕</button></div>
      <p class="muted small" style="margin:0">${esc(list.map(t => t.name).join(", "))}</p>`;
    if (!mine.length) return h + `<p class="small">None of these are yours to change.</p>`;
    if (mine.length < list.length) h += `<p class="small muted" style="margin:0">Changes only reach the ${mine.length} that are yours.</p>`;
    h += hpRow();
    h += `<details data-sec="gconds" open><summary>Conditions (on all of them)</summary><div class="conds">${S.conditions.map(c => {
      const all = mine.every(t => t.conds.includes(c));
      return `<button type="button" class="chip${all ? " on" : ""}" data-gcond="${c}" data-on="${all ? "" : "1"}">${c}</button>`;
    }).join("")}</div></details>
      <div class="row card-btns"><button type="button" class="btn small-btn extra" data-init>Initiative for all</button>
      ${isDm() ? `<button type="button" class="btn small-btn" data-ghide="${mine.every(t => t.hidden) ? "" : "1"}">${mine.every(t => t.hidden) ? "Show all" : "Hide all"}</button>` : ""}
      <button type="button" class="btn danger small-btn" data-del>Delete all</button></div>
      <p class="muted small" style="margin:0">Shift+click a token to add it or take it out. Drag one to move them all.</p>`;
    return h;
  }
  function editToken(t, set) {
    Object.assign(t, set);
    action("tok_edit", { sc: viewSc, id: t.id, set });
    redraw();
  }
  function initCard() {
    const card = $("tokenCard");
    card.addEventListener("click", async e => {
      const list = [...picked].map(tokenById).filter(Boolean);
      const group = list.length > 1;
      const t = group ? null : tokenById(sel) || list[0];
      if (!list.length) return;
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.close != null) return selectToken(null);
      const ids = list.filter(controls).map(x => x.id);
      if (b.dataset.hp) {
        const n = Math.abs(parseInt($("hpDelta").value, 10));
        if (!n) { $("hpDelta").focus(); return note("Type how much damage or healing first."); }
        const delta = n * Number(b.dataset.hp);
        if (group) action("tok_group", { sc: viewSc, op: "hp", ids, delta });
        else action("tok_edit", { sc: viewSc, id: t.id, set: { hpd: delta } });
        $("hpDelta").value = "";
        return;
      }
      if (b.dataset.init != null) return action("init_add", { sc: viewSc, ids, roll: true });
      if (b.dataset.del != null) {
        if (group) { if (!confirm(`Delete ${ids.length} tokens?`)) return; action("tok_group", { sc: viewSc, op: "del", ids }); }
        else action("tok_del", { sc: viewSc, id: t.id });
        return selectToken(null);
      }
      if (b.dataset.gcond) return action("tok_group", { sc: viewSc, op: "cond", ids, cond: b.dataset.gcond, on: !!b.dataset.on });
      if (b.dataset.ghide != null) { for (const id of ids) action("tok_edit", { sc: viewSc, id, set: { hidden: !!b.dataset.ghide } }); return; }
      if (!t) return;
      if (b.dataset.sheet != null) return openSheet(t.char);
      if (b.dataset.more != null) return openStats(t.id);
      if (b.dataset.cond) {
        const conds = t.conds.includes(b.dataset.cond) ? t.conds.filter(c => c !== b.dataset.cond) : [...t.conds, b.dataset.cond];
        editToken(t, { conds });
        return renderCard(true);
      }
      if (b.dataset.colour) { editToken(t, { c: b.dataset.colour }); return renderCard(true); }
      if (b.dataset.front != null) return action("tok_front", { sc: viewSc, id: t.id });
      if (b.dataset.pic != null) {
        const f = await pickFile();
        if (!f) return;
        try { action("tok_img", { sc: viewSc, id: t.id, src: (await shrink(f, 256, true)).url }); }
        catch { note("That picture couldn't be used. Try a PNG or JPG."); }
      }
    });
    card.addEventListener("change", e => {
      const t = picked.size === 1 && tokenById(sel), k = e.target.dataset.k;
      if (!t || !k) return;
      let v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (["hp", "mhp", "ac", "init", "sight", "speed", "elev", "aura"].includes(k)) v = v === "" ? null : Number(v);
      if (k === "size") v = Number(v);
      editToken(t, { [k]: v });
      if (k !== "name" && k !== "note") renderCard(true);
    });
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target.id === "hpDelta") { e.preventDefault(); card.querySelector('[data-hp="-1"]').click(); }
    });
  }

  // ---- Stat blocks (DM only): click anything to roll it -----------------------------------------
  let statTok = null, statEdit = false, statMode = "", statRolls = [];
  const ABBR = ["STR", "DEX", "CON", "INT", "WIS", "CHA"], ABNAME = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
  function rollExpr(expr) {
    let total = 0, parts = [];
    for (const m of expr.replace(/\s+/g, "").matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/g)) {
      const sgn = m[1] === "-" ? -1 : 1;
      if (m[3]) {
        const n = Math.min(100, Number(m[2] || 1)), d = Number(m[3]), rolls = [];
        for (let i = 0; i < n; i++) rolls.push(d ? 1 + Math.floor(Math.random() * d) : 0);
        total += sgn * rolls.reduce((a, b) => a + b, 0);
        parts.push(`${sgn < 0 ? "−" : parts.length ? "+" : ""}[${rolls.join(", ")}]`);
      } else if (m[4]) { total += sgn * Number(m[4]); parts.push(`${sgn < 0 ? "−" : "+"}${m[4]}`); }
    }
    return { total, detail: parts.join(" ") };
  }
  function d20(label, bonus) {
    const a = 1 + Math.floor(Math.random() * 20), b = 1 + Math.floor(Math.random() * 20);
    const die = statMode === "adv" ? Math.max(a, b) : statMode === "dis" ? Math.min(a, b) : a;
    const both = statMode ? ` (${a}, ${b} ${statMode === "adv" ? "advantage" : "disadvantage"})` : "";
    statRolls.unshift({ label, total: die + bonus, detail: `${die}${both} ${sign(bonus)}`, crit: die === 20 ? "crit" : die === 1 ? "fail" : "" });
    statRolls = statRolls.slice(0, 6);
    renderStats();
  }
  function dmgRoll(label, expr) {
    const r = rollExpr(expr);
    statRolls.unshift({ label, total: r.total, detail: `${expr}: ${r.detail}`, crit: "" });
    statRolls = statRolls.slice(0, 6);
    renderStats();
  }
  function openStats(id) {
    statTok = id;
    statEdit = !(tokenById(id) || {}).stats;
    statRolls = [];
    $("statBlock").hidden = false;
    renderStats();
  }
  function renderStats() {
    const box = $("statBlock");
    if (box.hidden || !statTok) return;
    const t = tokenById(statTok);
    if (!t || !isDm()) return closeModal("statBlock");
    const st = t.stats;
    const head = `<div class="row between"><h2 style="margin:0">${esc(t.name)}</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>`;
    if (statEdit || !st) {
      const s0 = st || { speed: t.speed ? t.speed + " " + unit() : "30 ft", abil: [10, 10, 10, 10, 10, 10], skills: "", saves: "", senses: "", langs: "", cr: "", traits: "", actions: "" };
      box.innerHTML = `<form class="win stat" autocomplete="off">${head}
        <label class="field">Start from a ready-made monster<select name="ready"><option value="">Pick one to fill it in…</option>${MONSTERS.map(m => `<option value="${esc(m[0])}">${esc(m[0])}</option>`).join("")}</select></label>
        <div class="stat-abil">${ABBR.map((a, i) => `<label>${a}<input type="number" name="a${i}" min="1" max="30" value="${s0.abil[i]}"></label>`).join("")}</div>
        <div class="form-grid">
          <label class="field">Speed<input name="speed" value="${esc(s0.speed)}" placeholder="30 ft, fly 60 ft"></label>
          <label class="field">Challenge<input name="cr" value="${esc(s0.cr)}" placeholder="1/2"></label>
          <label class="field full">Skills<input name="skills" value="${esc(s0.skills)}" placeholder="Intimidation +2, Stealth +4"></label>
          <label class="field full">Saving throws<input name="saves" value="${esc(s0.saves)}" placeholder="Dex +5, Wis +2 (the rest use the ability)"></label>
          <label class="field full">Senses<input name="senses" value="${esc(s0.senses)}" placeholder="darkvision 60 ft, passive Perception 10"></label>
          <label class="field full">Languages<input name="langs" value="${esc(s0.langs)}"></label>
          <label class="field full">Traits (one a line)<textarea name="traits" rows="3" placeholder="Pack Tactics: advantage when an ally is next to the target.">${esc(s0.traits)}</textarea></label>
          <label class="field full">Actions (one a line: name, to hit, damage)<textarea name="actions" rows="3" placeholder="Greataxe +5 1d12+3 slashing">${esc(s0.actions)}</textarea></label>
        </div>
        <div class="row"><button class="btn primary" type="submit">Save</button>${st ? `<button type="button" class="btn" data-cancel>Cancel</button>` : ""}</div>
      </form>`;
      return;
    }
    const mods = st.abil.map(mod);
    const listed = (txt, what) => (txt || "").split(",").map(x => x.trim()).filter(Boolean).map(x => {
      const m = x.match(/^(.+?)\s*([+-]\d+)$/);
      return m ? `<button type="button" class="chip roll" data-d20="${m[2]}" data-label="${esc(m[1])} ${what}">${esc(m[1])} ${esc(m[2])}</button>` : `<span class="chip">${esc(x)}</span>`;
    }).join("");
    const saveTxt = ABBR.map((a, i) => {
      const m = (st.saves || "").match(new RegExp(a.slice(0, 1) + a.slice(1).toLowerCase() + "\\s*([+-]\\d+)"));
      const b = m ? Number(m[1]) : mods[i];
      return `<button type="button" class="chip roll${m ? " on" : ""}" data-d20="${b}" data-label="${ABNAME[i]} save">${a} ${sign(b)}</button>`;
    }).join("");
    const actions = (st.actions || "").split("\n").filter(Boolean).map(l => {
      const m = l.match(/^(.*?)\s+([+-]\d+)\s+(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*(.*)$/);
      if (!m) return `<li>${esc(l)}</li>`;
      return `<li><b>${esc(m[1])}</b> <button type="button" class="chip roll" data-d20="${m[2]}" data-label="${esc(m[1])} attack">${esc(m[2])} to hit</button>
        <button type="button" class="chip roll" data-dmg="${esc(m[3].replace(/\s+/g, ""))}" data-label="${esc(m[1])} damage">${esc(m[3])}</button> <span class="muted">${esc(m[4])}</span></li>`;
    }).join("");
    const traits = (st.traits || "").split("\n").filter(Boolean).map(l => {
      const i = l.indexOf(":");
      return `<p>${i > 0 && i < 40 ? `<b>${esc(l.slice(0, i))}.</b>${esc(l.slice(i + 1))}` : esc(l)}</p>`;
    }).join("");
    box.innerHTML = `<div class="win stat">${head}
      <p class="muted small">${t.ac != null ? `AC ${t.ac} · ` : ""}${t.mhp != null ? `HP ${t.hp ?? "?"} / ${t.mhp} · ` : ""}Speed ${esc(st.speed || "?")}${st.cr ? ` · Challenge ${esc(st.cr)}` : ""}</p>
      <div class="row">${seg([["", "Normal"], ["adv", "Advantage"], ["dis", "Disadvantage"]], statMode, v => { statMode = v; renderStats(); }).outerHTML}</div>
      ${statRolls.length ? `<ul class="stat-rolls">${statRolls.map((r, i) => `<li class="${i ? "" : "new "}${r.crit}"><b>${r.total}</b> ${esc(r.label)} <span class="muted small">${esc(r.detail)}</span></li>`).join("")}</ul>` : `<p class="muted small">Click any number to roll it. Only you see these rolls.</p>`}
      <div class="stat-abil">${ABBR.map((a, i) => `<button type="button" class="roll" data-d20="${mods[i]}" data-label="${ABNAME[i]} check">${a}<b>${st.abil[i]}</b><span>${sign(mods[i])}</span></button>`).join("")}</div>
      <h4>Saving throws</h4><div class="conds">${saveTxt}</div>
      ${st.skills ? `<h4>Skills</h4><div class="conds">${listed(st.skills, "check")}</div>` : ""}
      ${st.senses ? `<p class="small"><b>Senses</b> ${esc(st.senses)}</p>` : ""}
      ${st.langs ? `<p class="small"><b>Languages</b> ${esc(st.langs)}</p>` : ""}
      ${traits ? `<div class="stat-traits small">${traits}</div>` : ""}
      ${actions ? `<h4>Actions</h4><ul class="stat-actions small">${actions}</ul>` : ""}
      <div class="row"><button type="button" class="btn small-btn" data-edit>Edit</button><button type="button" class="btn small-btn" data-roll-init>Roll initiative</button></div>
    </div>`;
    // the seg's buttons were copied as HTML, so wire them up again
    box.querySelectorAll(".seg button").forEach((b, i) => b.addEventListener("click", () => { statMode = ["", "adv", "dis"][i]; renderStats(); }));
  }
  function initStats() {
    const box = $("statBlock");
    box.addEventListener("click", e => {
      if (e.target === box) return closeModal("statBlock");
      const b = e.target.closest("button");
      if (!b) return;
      const t = tokenById(statTok);
      if (b.dataset.close != null) return closeModal("statBlock");
      if (b.dataset.edit != null) { statEdit = true; return renderStats(); }
      if (b.dataset.cancel != null) { statEdit = false; return renderStats(); }
      if (b.dataset.rollInit != null && t) return d20("Initiative", t.init ?? mod(t.stats.abil[1]));
      if (b.dataset.d20 != null) return d20(b.dataset.label, Number(b.dataset.d20));
      if (b.dataset.dmg) return dmgRoll(b.dataset.label, b.dataset.dmg);
    });
    box.addEventListener("change", e => {
      if (e.target.name !== "ready" || !e.target.value) return;
      const st = statsOf(e.target.value), F = e.target.form.elements;
      if (!st) return;
      st.abil.forEach((v, i) => { F["a" + i].value = v; });
      for (const k of ["speed", "cr", "skills", "saves", "senses", "langs", "traits", "actions"]) F[k].value = st[k];
    });
    box.addEventListener("submit", e => {
      e.preventDefault();
      const t = tokenById(statTok), F = e.target.elements;
      if (!t) return;
      const stats = { abil: ABBR.map((_, i) => Number(F["a" + i].value) || 10) };
      for (const k of ["speed", "cr", "skills", "saves", "senses", "langs", "traits", "actions"]) stats[k] = F[k].value.trim();
      const set = { stats };
      if (t.speed == null && parseInt(stats.speed, 10)) set.speed = parseInt(stats.speed, 10);
      editToken(t, set);
      t.stats = stats;
      statEdit = false;
      renderStats();
    });
  }

  // ---- Adding tokens -------------------------------------------------------------------------
  let newTokPic = null;
  function openTokenForm(prefill = {}) {
    const box = $("tokenForm"), dm = isDm();
    newTokPic = null;
    const mine = S.chars.filter(c => dm || c.owner === me);
    const players = Object.entries(S.names).filter(([q]) => !S.dms.includes(q));
    box.innerHTML = `<form class="win narrow" autocomplete="off">
      <div class="row between"><h2 style="margin:0">Add a token</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>
      ${mine.length && EXTRAS ? `<label class="field">From a character<select name="char"><option value="">None, a new token</option>${mine.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>` : ""}
      ${dm ? `<label class="field">Ready-made<select name="monster"><option value="">Pick one to fill in the numbers…</option>${MONSTERS.map(([n, hp, ac], i) => `<option value="${i}">${n} (HP ${hp}, AC ${ac})</option>`).join("")}</select></label>` : ""}
      <div class="form-grid">
        <label class="field full">Name<input name="name" maxlength="40" value="${esc(prefill.name || "")}" placeholder="${dm ? "Goblin, Guard captain…" : "Your character"}"></label>
        <label class="field">HP<input name="hp" type="number" min="0"></label>
        <label class="field">AC<input name="ac" type="number" min="0"></label>
        <label class="field">Initiative bonus<input name="init" type="number"></label>
        <label class="field">Size<select name="size"><option value="0.5">Tiny</option><option value="1" selected>Medium (1 square)</option><option value="2">Large (2)</option><option value="3">Huge (3)</option><option value="4">Gargantuan (4)</option></select></label>
        ${dm ? `<label class="field full">For player<select name="owner"><option value="">No one, it's the DM's</option>${players.map(([q, n]) => `<option value="${q}">${esc(n)}</option>`).join("")}</select>
          <span class="muted small">${players.length ? "Only that player (and you) can move it, and the fog clears round it." : "Players show up here once they've opened the campaign link."}</span></label>
        <label class="field">How many<input name="count" type="number" min="1" max="20" value="1"></label>
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
    const copy = prefill.copy;
    if (copy) {                                   // a copy of a token (Alt+middle-click)
      const F = form.elements, v = x => (x == null ? "" : x);
      F.name.value = copy.name;
      F.hp.value = v(copy.mhp ?? copy.hp);
      F.ac.value = v(copy.ac);
      F.init.value = v(copy.init);
      F.size.value = String(copy.size);
      if (dm && copy.hidden) F.hidden.checked = true;
      c = copy.c || c;
      form.querySelectorAll(".sw").forEach(x => x.classList.toggle("on", x.dataset.colour === c));
      if (copy.img) form.querySelector("[data-picnote]").textContent = "Same picture as " + copy.name;
      F.name.select();
    }
    if (form.elements.monster) form.elements.monster.addEventListener("change", () => {
      const m = MONSTERS[form.elements.monster.value];
      if (!m) return;
      const F = form.elements;
      [F.name.value, F.hp.value, F.ac.value, F.init.value, F.size.value] = [m[0], m[1], m[2], m[3], String(m[4])];
    });
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
      const ready = F.monster && MONSTERS[F.monster.value];
      if (ready && F.name.value.trim().startsWith(ready[0])) {
        tok.stats = statsOf(ready[0]);
        if (tok.stats) tok.speed = parseInt(tok.stats.speed, 10) || null;
      }
      if (copy) for (const k of ["stats", "speed", "aura", "elev", "ac2", "sight"]) if (copy[k] != null && tok[k] == null) tok[k] = copy[k];
      if (dm && F.owner && F.owner.value) {
        tok.owner = F.owner.value;
        if (!F.name.value.trim() && !ch) tok.name = nameOf(F.owner.value);
      }
      if (newTokPic) tok.src = newTokPic;
      else if (copy && copy.img) tok.img = copy.img;
      action("tok_add", { sc: sc.id, tok, count: dm ? Number(F.count.value) || 1 : 1 });
      closeModal("tokenForm");
    });
  }
  function closeModal(id) {
    const m = $(id);
    m.hidden = true;
    m.innerHTML = "";
    if (id === "sheet") sheetId = null;
    if (id === "statBlock") statTok = null;
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
    else if (e.kind === "show") li.innerHTML = `<span class="sys">The DM showed everyone <button type="button" class="link-btn" data-note="${esc(e.note)}">${esc(e.text)}</button></span>`;
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
        const r = [...added].reverse().find(e => e.kind === "roll");
        if (r && EXTRAS) popRoll(r);
        const shown = [...added].reverse().find(e => e.kind === "show");
        if (shown && EXTRAS) openHandout(shown.note);
        if (added.some(e => e.kind === "roll")) FX.sound("roll");
        else if (added.some(e => e.kind === "chat" && e.by !== me)) FX.sound("tick");
        if (tab !== "chat") $$tab("chat").classList.add("ping");
      }
    }
    lastLog = lastId;
    if (near || fresh) ol.scrollTop = ol.scrollHeight;
  }
  let popTimer = 0;
  function popRoll(e) {
    const r = e.roll, pop = $("rollPop");
    pop.className = "tt-pop" + (r.crit ? " crit-" + r.crit : "") + (e.to ? " priv" : "");
    pop.innerHTML = `<span class="who" style="color:${colourOf(e.by)}">${esc(e.who)}</span><span class="what">${esc(e.text || r.expr)}${e.to ? " · to DM" : ""}</span>
      <b>${r.total}</b>${r.crit === "hit" ? "<span>Natural 20!</span>" : r.crit === "miss" ? "<span>Natural 1</span>" : ""}`;
    pop.hidden = false;
    pop.style.animation = "none";
    void pop.offsetWidth;
    pop.style.animation = "";
    clearTimeout(popTimer);
    popTimer = setTimeout(() => { pop.hidden = true; }, 2600);
  }
  function openHandout(id) {
    const n = S.notes.find(x => x.id === id);
    if (!n) return;
    const box = $("handout");
    box.innerHTML = `<div class="win"><div class="row between"><h2 style="margin:0">${esc(n.title)}</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>
      ${n.img ? `<img class="handout-img" src="${assetUrl(n.img)}" alt="">` : ""}${n.text ? `<div class="note-text">${esc(n.text)}</div>` : ""}</div>`;
    box.hidden = false;
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
    $("log").addEventListener("click", e => { const b = e.target.closest("[data-note]"); if (b) openHandout(b.dataset.note); });
    $("handout").addEventListener("click", e => { if (e.target === $("handout") || e.target.closest("[data-close]")) closeModal("handout"); });
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
    if (!EXTRAS) return;
    const b = $("turnBanner"), init = S.init;
    if (!init.cur) { b.hidden = true; return; }
    const cur = init.list.find(e => e.id === init.cur);
    b.hidden = false;
    const mine = cur && cur.tok && (() => { for (const sc of S.scenes) { const t = sc.tokens.find(x => x.id === cur.tok); if (t) return t.owner === me || (charById(t.char) || {}).owner === me; } return false; })();
    b.innerHTML = `<span>Round ${init.round} · ${cur ? esc(cur.name) + "'s turn" : "the DM's turn"}</span>` +
      (isDm() ? `<button type="button" class="btn small-btn" data-next>Next ▸</button>` : mine ? `<button type="button" class="btn primary small-btn" data-next>End my turn</button>` : "");
    b.classList.toggle("mine", !!mine);
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
    $("turnBanner").addEventListener("click", e => { if (e.target.closest("[data-next]")) action("init_next"); });
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
      <div class="sec"><h4>Spell slots <small class="muted" style="text-transform:none;letter-spacing:0">how many of each level, and tick the ones used</small></h4>
        <div class="slots">${(ch.slots || []).map(([mx, used], i) => `<div class="slot"><span class="lbl">${["1st", "2nd", "3rd"][i] || i + 1 + "th"}</span>
          <input type="number" min="0" max="9" data-f="slotmax.${i}" value="${mx}"${dis} aria-label="Level ${i + 1} slots">
          <span class="pips">${Array.from({ length: mx }, (_, j) => `<input type="checkbox" data-f="slotuse.${i}.${j}"${used > j ? " checked" : ""}${dis} aria-label="Level ${i + 1} slot ${j + 1} used">`).join("")}</span></div>`).join("")}</div></div>
      <div class="row"><label class="small muted">Hit dice <input data-f="hd" value="${esc(ch.hd || "")}" placeholder="3d10" maxlength="30" style="width:110px"${dis}></label>
        ${can ? `<button type="button" class="btn small-btn" data-rest="short">Short rest</button><button type="button" class="btn small-btn" data-rest="long">Long rest</button>` : ""}</div>
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
      if (b.dataset.rest === "long") { if (confirm(`Long rest for ${ch.name}? HP, temporary HP, death saves and spell slots go back to normal.`)) action("char_rest", { id: ch.id, long: true }); return; }
      if (b.dataset.rest === "short") {
        const die = ((ch.hd || "").match(/d\d+/) || ["d8"])[0], c = mod(ch.abil.con);
        const expr = prompt("Spend hit dice to heal? Type the dice to roll, or leave it empty for none.", `1${die}${c ? sign(c) : ""}`);
        if (expr !== null) action("char_rest", { id: ch.id, expr: expr.trim() });
        return;
      }
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
      } else if (f.startsWith("slotmax.") || f.startsWith("slotuse.")) {
        const parts = f.split(".");
        const slots = (ch.slots || []).map(x => [...x]), i = Number(parts[1]);
        if (parts[0] === "slotmax") { slots[i][0] = Math.max(0, Math.min(9, Number(v) || 0)); slots[i][1] = Math.min(slots[i][1], slots[i][0]); }
        else slots[i][1] = v ? Number(parts[2]) + 1 : Number(parts[2]);
        sheetSet(ch, { slots });
        renderSheet();
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
            ${n.img ? `<img class="note-img" src="${assetUrl(n.img)}" alt="" data-open>` : ""}
            <textarea data-k="text" rows="4" aria-label="Note">${esc(n.text)}</textarea>
            <div class="row"><button type="button" class="btn small-btn" data-img>${n.img ? "Change picture" : "Add picture"}</button>${n.img ? `<button type="button" class="link-btn" data-noimg>Remove picture</button>` : ""}
            <button type="button" class="btn primary small-btn" data-show>Show everyone</button></div></li>`
        : `<li class="shared" data-id="${n.id}"><b>${esc(n.title)}</b>${n.img ? `<img class="note-img" src="${assetUrl(n.img)}" alt="" data-open>` : ""}<div class="note-text">${esc(n.text)}</div></li>`).join("");
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
    ul.addEventListener("click", async e => {
      const li = e.target.closest("li");
      if (!li) return;
      const id = li.dataset.id;
      if (e.target.closest("[data-del]")) { if (confirm("Delete this note?")) action("note_del", { id }); }
      else if (e.target.closest("[data-open]")) openHandout(id);
      else if (e.target.closest("[data-show]")) action("note_show", { id });
      else if (e.target.closest("[data-noimg]")) action("note_img", { id, src: "" });
      else if (e.target.closest("[data-img]")) {
        const f = await pickFile();
        if (!f) return;
        note("Getting the picture ready…");
        try { action("note_img", { id, src: (await shrink(f, 2000, false)).url }); }
        catch { note("That picture couldn't be used. Try a PNG or JPG."); }
      }
    });
    let t = 0;
    $("myNotes").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => action("my_notes", { text: $("myNotes").value }), 700); });
  }

  // ---- Scenes (DM) ---------------------------------------------------------------------------
  function renderScenes() {
    if (!isDm()) return;
    const ul = $("sceneList");
    ul.innerHTML = S.scenes.map((sc, i) => `<li data-id="${sc.id}" class="${sc.id === viewSc ? "viewing" : ""}">
      <span class="nm">${esc(sc.name)}</span>${(() => {
        const here = Object.entries(S.at || {}).filter(([, id]) => id === sc.id).map(([q]) => nameOf(q));
        if (sc.id === S.active && here.length === Object.keys(S.at || {}).length) return `<span class="badge dm">Players here</span>`;
        return here.length ? `<span class="badge dm" title="${esc(here.join(", "))}">${esc(here.length > 2 ? here.length + " players" : here.join(", "))}</span>` : "";
      })()}
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
      ${sc.fog ? `<label class="check"><input type="checkbox" data-k="auto"${sc.auto ? " checked" : ""}> Reveal as the party explores</label>
        <p class="muted small" style="margin:0">The fog clears around the players' tokens as they move, as far as each one sees (Sight on its card) and not through walls or shut doors. Draw walls with the wall tool (W).</p>` : ""}
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
      if (k === "grid" || k === "fog" || k === "auto") action("scene_edit", { sc: sc.id, [k]: e.target.checked });
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
      else if (b.dataset.map != null) importMap(sc);
    });
    $("scenePick").addEventListener("change", e => { viewSc = e.target.value; wallPts = null; selectToken(null); fitView(); renderAll(); });
    $("showScene").addEventListener("click", () => action("scene_show", { sc: viewSc }));
    $("asPlayerBtn").addEventListener("click", () => setAsPlayer(!asPlayer));
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
    document.body.classList.toggle("extras", EXTRAS);
    initStats();
    document.querySelectorAll(".tt-tools [data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
    $("modeBar").innerHTML = MODES.map(([m, label]) => `<button type="button" data-mode="${m}">${label}</button>`).join("");
    $("modeBar").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setMode(b.dataset.mode); });
    $("addTokenBtn").addEventListener("click", () => openTokenForm());
    $("tokenForm").addEventListener("click", e => { if (e.target === $("tokenForm")) closeModal("tokenForm"); });
    $("zoomIn").addEventListener("click", () => zoomAt(cam.z * 1.25));
    $("zoomOut").addEventListener("click", () => zoomAt(cam.z / 1.25));
    $("fitBtn").addEventListener("click", fitView);
    document.querySelectorAll(".tt-tabs button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("panelBtn").addEventListener("click", () => setPanel($("panel").classList.contains("closed")));
    initCard();
    initLib();
    initChat();
    initTurns();
    initParty();
    initSheet();
    initNotes();
    initScenes();
    initRoom();
    setTool("select");
    if (!EXTRAS) setTab("room");
    initStart();
  }
  init();
})();
