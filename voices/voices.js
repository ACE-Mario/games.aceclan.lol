// Sound Check: an endless League sound quiz, just for fun (no points: ACEdle is the competitive one).
// Each round is a random champion and one of their sounds: the pick voice line, the ban voice line or
// the champion select sound effect. Champions (names, pictures, classes) come from Riot's Data Dragon;
// the sounds from CommunityDragon, a public mirror of the League client's files.
(async () => {
  "use strict";
  const $ = id => document.getElementById(id);
  const FX = window.AceFX || { sound() {}, confetti() {}, soundButton() {} };
  const DD = "https://ddragon.leagueoflegends.com";
  const CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1";
  const TRIES = 3, RECENT = 40;                 // don't repeat any of the last 40 champions
  const KINDS = {
    pick: { label: "Pick voice line", what: "what they say when you lock them in", path: "champion-choose-vo" },
    ban: { label: "Ban voice line", what: "what they say when they're banned", path: "champion-ban-vo" },
    sfx: { label: "Select sound", what: "the sound effect when you pick them", path: "champion-sfx-audios" },
  };
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: fine */ } },
  };
  document.querySelector(".top")?.append(FX.soundButton?.() || "");

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

  let champs;
  try {
    const ver = (await (await fetch(`${DD}/api/versions.json`)).json())[0];
    const data = (await (await fetch(`${DD}/cdn/${ver}/data/en_US/champion.json`)).json()).data;
    champs = Object.values(data).sort((a, b) => a.id.localeCompare(b.id)).map(c => ({
      id: c.id, key: c.key, name: c.name, title: c.title, cls: c.tags[0] || "", img: `${DD}/cdn/${ver}/img/champion/${c.id}.png`,
    }));
  } catch {
    $("play").innerHTML = `<p class="muted">Couldn't load the champions. Refresh to try again.</p>`;
    return;
  }

  // Which kinds of sound to play (remembered in this browser), and the champions heard lately.
  let kinds = store.get("voices-kinds", Object.keys(KINDS)).filter(k => KINDS[k]);
  if (!kinds.length) kinds = Object.keys(KINDS);
  const recent = store.get("voices-recent", []);

  function newRound() {
    const pool = champs.filter(c => !recent.includes(c.id));
    const champ = pool[Math.floor(Math.random() * pool.length)];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    recent.push(champ.id);
    while (recent.length > Math.min(RECENT, champs.length - 1)) recent.shift();
    store.set("voices-recent", recent);
    return { champ, kind, src: `${CD}/${KINDS[kind].path}/${champ.key}.ogg`, guesses: [] };
  }
  let round = newRound();
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.voicesRound = () => round;   // for testing on this PC

  const audio = new Audio();
  audio.preload = "auto";
  audio.volume = 0.8;
  function play(src, btn) {
    if (!audio.paused && audio.dataset.src === src) { audio.pause(); audio.currentTime = 0; btn?.classList.remove("on"); return; }
    audio.src = src;
    audio.dataset.src = src;
    document.querySelectorAll(".play-btn.on").forEach(b => b.classList.remove("on"));
    btn?.classList.add("on");
    audio.play().catch(() => {});
  }
  audio.addEventListener("ended", () => document.querySelectorAll(".play-btn.on").forEach(b => b.classList.remove("on")));

  function kindToggles() {
    return `<div class="kinds" role="group" aria-label="Sounds to play">${Object.entries(KINDS).map(([k, v]) =>
      `<label><input type="checkbox" value="${k}" ${kinds.includes(k) ? "checked" : ""}> ${v.label}s</label>`).join("")}</div>`;
  }
  function wireToggles() {
    $("play").querySelectorAll(".kinds input").forEach(box => box.addEventListener("change", () => {
      const on = [...$("play").querySelectorAll(".kinds input:checked")].map(b => b.value);
      if (!on.length) { box.checked = true; return; }             // keep at least one
      kinds = on;
      store.set("voices-kinds", kinds);
    }));
  }

  function show() {
    const rd = round, g = rd.guesses;
    const hints = [g.length >= 1 ? `Class: <b>${esc(rd.champ.cls)}</b>` : "", g.length >= 2 ? `Starts with <b>${esc(rd.champ.name[0])}</b>` : ""].filter(Boolean);
    $("play").innerHTML = `
      <div class="listen">
        <button class="play-btn" type="button" id="playBtn" aria-label="Play the sound">▶</button>
        <div><b>${KINDS[rd.kind].label}</b><span class="muted">${KINDS[rd.kind].what}</span></div>
      </div>
      <p class="audio-err muted small" id="audioErr" hidden>This sound didn't load.</p>
      ${hints.length ? `<div class="hints">${hints.map(h => `<span>${h}</span>`).join("")}</div>` : ""}
      <div class="pick"><input type="text" id="guess" placeholder="Type a champion…" aria-label="Type a champion" autocomplete="off" spellcheck="false"><ul id="sugg" role="listbox" hidden></ul></div>
      <div class="tries">${Array.from({ length: TRIES }, (_, k) => `<span class="${g[k] ? "miss" : ""}">${g[k] ? esc(g[k]) : `Guess ${k + 1}`}</span>`).join("")}</div>
      <div class="actions"><button class="btn" type="button" id="giveUp">Show me</button></div>
      ${kindToggles()}`;
    $("playBtn").onclick = () => play(rd.src, $("playBtn"));
    audio.onerror = () => { if (audio.dataset.src === rd.src && $("audioErr")) $("audioErr").hidden = false; };
    $("giveUp").onclick = () => reveal(false);
    wireToggles();
    picker();
  }

  // Search box with suggestions.
  function picker() {
    const input = $("guess"), ul = $("sugg"), used = new Set(round.guesses);
    let shown = [], on = 0;
    const draw = () => {
      ul.hidden = !shown.length;
      ul.innerHTML = shown.map((c, k) => `<li role="option" data-k="${k}" class="${k === on ? "on" : ""}"><img src="${esc(c.img)}" alt="" loading="lazy">${esc(c.name)}</li>`).join("");
    };
    input.addEventListener("input", () => {
      const q = norm(input.value);
      const free = champs.filter(c => !used.has(c.name));
      shown = q ? [...free.filter(c => norm(c.name).startsWith(q)), ...free.filter(c => !norm(c.name).startsWith(q) && norm(c.name).includes(q))].slice(0, 7) : [];
      on = 0;
      draw();
    });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { on = Math.min(on + 1, shown.length - 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { on = Math.max(on - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === "Enter" && shown[on]) { guess(shown[on]); e.preventDefault(); }
      else if (e.key === "Escape") { shown = []; draw(); }
    });
    ul.addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li) { e.preventDefault(); guess(shown[+li.dataset.k]); } });
    input.focus({ preventScroll: true });
  }

  function guess(c) {
    round.guesses.push(c.name);
    const right = c.name === round.champ.name;
    if (right || round.guesses.length >= TRIES) return reveal(right);
    FX.sound("buzz");
    show();
  }

  function reveal(right) {
    const rd = round;
    FX.sound(right ? "chime" : "lose");
    $("play").innerHTML = `
      <div class="answer ${right ? "won" : "lost"}">
        <img src="${esc(rd.champ.img)}" alt="">
        <div><b>${esc(rd.champ.name)}</b><span class="muted">${esc(rd.champ.title)}</span>
          <span>${right ? (rd.guesses.length === 1 ? "First try!" : "Got it!") : `It was ${esc(rd.champ.name)}`}</span></div>
        <button class="play-btn small" type="button" id="again" aria-label="Hear it again">▶</button>
      </div>
      <div class="actions"><button class="btn primary" type="button" id="next">Next sound →</button></div>
      ${kindToggles()}`;
    $("again").onclick = () => play(rd.src, $("again"));
    $("next").onclick = () => { audio.pause(); round = newRound(); show(); play(round.src, $("playBtn")); };
    wireToggles();
    $("next").focus({ preventScroll: true });
  }

  show();
})();
