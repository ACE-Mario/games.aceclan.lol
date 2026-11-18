// Ace Agents, one-screen mode.
// The board comes from the game code + word pack, so everyone who opens the same link
// (?code=FALCON-42&pack=classic) gets the same words and the same key. Only the board host's
// browser tracks which cards are revealed; that state is saved in localStorage per game.
// Started by main.js when the link has ?code= (or ?view=key for the spymaster key).
window.startLocalGame = function () {
  "use strict";

  const TEAMS = { red: "Red", purple: "Purple" };
  const other = t => (t === "red" ? "purple" : "red");
  const ROWS = "ABCDE";
  const coord = i => ROWS[Math.floor(i / 5)] + (i % 5 + 1);
  const $ = id => document.getElementById(id);

  // ---- Seeded random numbers (same code -> same board on every device) ----
  function seedFrom(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function packWords(pack) {
    const raw = window.WORD_PACKS[pack].words;
    return [...new Set(raw.trim().toLowerCase().split(/\s+/))];
  }

  function makeBoard(code, pack) {
    const rng = mulberry32(seedFrom(pack + "|" + code));
    const words = shuffle(packWords(pack), rng).slice(0, 25);
    const first = rng() < 0.5 ? "red" : "purple";
    const roles = shuffle([
      ...Array(9).fill(first), ...Array(8).fill(other(first)),
      ...Array(7).fill("neutral"), "bomb",
    ], rng);
    return { words, roles, first };
  }

  // ---- Codes and URLs ----
  const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
  function randomCode() {
    const w = window.CODE_WORDS[Math.floor(Math.random() * window.CODE_WORDS.length)];
    return w.toUpperCase() + "-" + String(Math.floor(Math.random() * 90) + 10);
  }
  function linkFor(code, pack, view) {
    const u = new URL(location.href);
    u.search = "";
    u.hash = "";
    u.searchParams.set("code", code);
    u.searchParams.set("pack", pack);
    if (view) u.searchParams.set("view", view);
    return u.toString();
  }

  const params = new URLSearchParams(location.search);
  const pack = window.WORD_PACKS[params.get("pack")] ? params.get("pack") : "classic";
  let code = cleanCode(params.get("code"));
  if (!code) {
    code = randomCode();
    history.replaceState(null, "", linkFor(code, pack));
  }
  const view = params.get("view") === "key" ? "key" : "board";
  const board = makeBoard(code, pack);

  if (view === "key") return renderKey();

  // ---- Game state (board host only) ----
  const storeKey = `aceagents:${pack}:${code}`;
  const fresh = () => ({ revealed: [], turn: board.first, clue: null, left: null, log: [], winner: null, reason: "" });
  let state = load() || fresh();
  let undoStack = [];
  let showKey = false;
  let lastRevealed = -1;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(storeKey));
      return s && Array.isArray(s.revealed) ? s : null;
    } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch { /* storage blocked: game still works */ }
  }
  function remember() {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 60) undoStack.shift();
  }
  const left = team => board.roles.filter((r, i) => r === team && !state.revealed.includes(i)).length;
  const addLog = (text, kind) => state.log.push({ text, kind });

  function reveal(i) {
    if (state.winner || state.revealed.includes(i)) return;
    remember();
    const team = state.turn;
    const role = board.roles[i];
    state.revealed.push(i);
    lastRevealed = i;
    const word = board.words[i].toUpperCase();
    const what = role === "neutral" ? "a bystander" : role === "bomb" ? "the BOMB" : TEAMS[role] + "'s card";
    addLog(`${TEAMS[team]} picked ${word} (${coord(i)}): ${what}`, role);

    if (role === "bomb") {
      finish(other(team), `${TEAMS[team]} hit the bomb.`);
    } else if (left(role) === 0) {
      finish(role, role === team ? `${TEAMS[role]} found all their agents.` : `${TEAMS[team]} uncovered ${TEAMS[role]}'s last agent.`);
    } else if (role !== team) {
      passTurn();
    } else if (state.left !== null) {
      state.left -= 1;
      if (state.left <= 0) passTurn("Out of guesses.");
    }
    save();
    render();
  }

  function finish(winner, reason) {
    state.winner = winner;
    AceFX.confetti();
    AceFX.sound("win");
    state.reason = reason;
    state.clue = null;
    state.left = null;
    addLog(`${TEAMS[winner]} wins. ${reason}`, winner);
  }

  function passTurn(note) {
    state.turn = other(state.turn);
    state.clue = null;
    state.left = null;
    addLog(`${note ? note + " " : ""}${TEAMS[state.turn]}'s turn.`, state.turn);
  }

  function giveClue(word, num) {
    const w = word.trim().toLowerCase();
    if (!w) return "Type a clue word first.";
    if (/\s/.test(w)) return "Clues are one word.";
    const hit = board.words.find((bw, i) => !state.revealed.includes(i) && (bw.includes(w) || w.includes(bw)));
    if (hit) return `"${w.toUpperCase()}" is too close to ${hit.toUpperCase()} on the board.`;
    remember();
    const n = num === "inf" ? Infinity : Number(num);
    state.clue = { word: w, num: num === "inf" ? "∞" : String(n) };
    state.left = n === 0 || n === Infinity ? null : n + 1;
    addLog(`${TEAMS[state.turn]} clue: ${w.toUpperCase()} ${state.clue.num}`, state.turn);
    save();
    render();
    return "";
  }

  // ---- Rendering ----
  const grid = $("grid");
  const cards = board.words.map((w, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "card";
    b.innerHTML = `<span class="coord">${coord(i)}</span><span class="word"></span>`;
    b.querySelector(".word").textContent = w;
    b.addEventListener("click", () => reveal(i));
    grid.appendChild(b);
    return b;
  });

  function render() {
    const over = !!state.winner;
    const keyOn = showKey || over;
    grid.classList.toggle("show-key", keyOn);
    cards.forEach((b, i) => {
      const revealed = state.revealed.includes(i);
      const role = board.roles[i];
      b.className = "card" + (revealed || keyOn ? " " + role : "") + (revealed ? " revealed" : "") + (i === lastRevealed ? " just" : "");
      b.dataset.word = board.words[i];
      if (i === lastRevealed) AceFX.sound(role === "bomb" ? "buzz" : "flip");
      b.disabled = revealed || over;
      b.setAttribute("aria-label", `${coord(i)} ${board.words[i]}${revealed ? ", " + role : ""}`);
    });
    lastRevealed = -1;

    const status = $("status");
    status.className = "status " + (over ? state.winner : state.turn);
    $("turnText").textContent = over ? `${TEAMS[state.winner]} wins` : `${TEAMS[state.turn]}'s turn`;
    const clue = $("clueText");
    if (over) {
      clue.innerHTML = `<span class="muted"></span>`;
      clue.firstChild.textContent = state.reason + " Start a new game from the panel.";
    } else if (state.clue) {
      clue.innerHTML = `Clue: <b></b> <span></span> <span class="muted"></span>`;
      clue.children[0].textContent = state.clue.word;
      clue.children[1].textContent = state.clue.num;
      clue.children[2].textContent = state.left === null ? "· guess as many as you like" : `· ${state.left} guess${state.left === 1 ? "" : "es"} left`;
    } else {
      clue.innerHTML = `<span class="muted">Waiting for the ${TEAMS[state.turn]} spymaster's clue</span>`;
    }

    $("redLeft").textContent = left("red");
    $("purpleLeft").textContent = left("purple");
    $("endTurn").disabled = over;
    $("undo").disabled = undoStack.length === 0;
    $("clueForm").hidden = over;
    const spy = $("spyToggle");
    spy.setAttribute("aria-pressed", String(showKey));
    spy.textContent = showKey ? "Hide key" : "Show key here";
    spy.disabled = over;

    const log = $("log");
    log.innerHTML = "";
    const entries = state.log.length ? [...state.log].reverse() : [{ text: `${TEAMS[board.first]} goes first and has 9 agents to find.`, kind: board.first }];
    for (const e of entries) {
      const li = document.createElement("li");
      li.className = e.kind || "";
      li.textContent = e.text;
      log.appendChild(li);
    }
  }

  // ---- Controls ----
  $("gameCode").textContent = code;
  const packSel = $("pack");
  for (const [id, p] of Object.entries(window.WORD_PACKS)) {
    const o = new Option(p.name, id);
    o.selected = id === pack;
    packSel.add(o);
  }

  $("endTurn").addEventListener("click", () => {
    if (state.winner) return;
    remember();
    passTurn(`${TEAMS[state.turn]} ended their turn.`);
    save();
    render();
  });
  $("undo").addEventListener("click", () => {
    if (!undoStack.length) return;
    state = JSON.parse(undoStack.pop());
    save();
    render();
  });

  $("spyToggle").addEventListener("click", () => {
    if (showKey) { showKey = false; render(); return; }
    $("spyConfirm").hidden = false;
    $("spyYes").focus();
  });
  $("spyYes").addEventListener("click", () => { showKey = true; $("spyConfirm").hidden = true; render(); });
  $("spyNo").addEventListener("click", () => { $("spyConfirm").hidden = true; });

  $("clueForm").addEventListener("submit", e => {
    e.preventDefault();
    const err = giveClue($("clueWord").value, $("clueNum").value);
    $("clueError").hidden = !err;
    $("clueError").textContent = err;
    if (!err) $("clueWord").value = "";
  });

  $("newForm").addEventListener("submit", e => {
    e.preventDefault();
    location.href = linkFor(randomCode(), packSel.value);
  });
  $("joinForm").addEventListener("submit", e => {
    e.preventDefault();
    const c = cleanCode($("joinCode").value);
    if (c) location.href = linkFor(c, packSel.value);
  });

  async function copy(text, label) {
    const note = $("copyNote");
    const fb = $("copyFallback");
    try {
      await navigator.clipboard.writeText(text);
      fb.hidden = true;
      note.textContent = `${label} copied. Paste it in Discord.`;
    } catch {
      fb.hidden = false;
      fb.value = text;
      fb.select();
      note.textContent = "Couldn't copy automatically. Copy the link below.";
    }
  }
  $("copySpy").addEventListener("click", () => copy(linkFor(code, pack, "key"), "Spymaster link"));
  $("copyBoard").addEventListener("click", () => copy(linkFor(code, pack), "Board link"));

  render();

  // ---- Key view ----
  function renderKey() {
    document.title = "Ace Agents key";
    $("boardView").hidden = true;
    $("keyView").hidden = false;
    $("keyCode").textContent = code;
    const first = $("keyFirst");
    first.textContent = `${TEAMS[board.first]} goes first (9 agents)`;
    first.className = "key-first t-" + board.first;
    const kg = $("keyGrid");
    board.words.forEach((w, i) => {
      const d = document.createElement("div");
      d.className = "key-cell " + board.roles[i];
      d.innerHTML = `<small>${coord(i)}</small><span></span>`;
      d.querySelector("span").textContent = w;
      kg.appendChild(d);
    });
    $("toBoard").href = linkFor(code, pack);
  }
};
