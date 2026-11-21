// Sound Check: the daily League sound quiz. Ten champions a day, each with one of three sounds:
// the pick voice line, the ban voice line or the champion select sound effect. Champions (names,
// pictures, classes) come from Riot's Data Dragon; the sounds from CommunityDragon, a public mirror
// of the League client's files. Everyone gets the same ten (picked with the day's random numbers).
(async () => {
  "use strict";
  const $ = id => document.getElementById(id);
  const FX = window.AceFX || { sound() {}, confetti() {}, soundButton() {} };
  const DD = "https://ddragon.leagueoflegends.com";
  const CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1";
  const ROUNDS = 10, POINTS = [100, 60, 30];
  const KINDS = {
    pick: { label: "Pick voice line", what: "what they say when you lock them in", path: "champion-choose-vo" },
    ban: { label: "Ban voice line", what: "what they say when they're banned", path: "champion-ban-vo" },
    sfx: { label: "Select sound", what: "the sound effect when you pick them", path: "champion-sfx-audios" },
  };
  document.querySelector(".top")?.append(FX.soundButton?.() || "");

  const DAY = await AceDay.today();
  $("dayNo").textContent = "#" + DAY;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

  let champs, rounds;
  try {
    const ver = (await (await fetch(`${DD}/api/versions.json`)).json())[0];
    const data = (await (await fetch(`${DD}/cdn/${ver}/data/en_US/champion.json`)).json()).data;
    champs = Object.values(data).sort((a, b) => a.id.localeCompare(b.id)).map(c => ({
      id: c.id, key: c.key, name: c.name, title: c.title, cls: c.tags[0] || "", img: `${DD}/cdn/${ver}/img/champion/${c.id}.png`,
    }));
    // Today's ten: different champions, four pick lines, three ban lines and three select sounds, mixed up.
    const r = AceDay.rng(DAY, 51);
    const kinds = AceDay.shuffle(["pick", "pick", "pick", "pick", "ban", "ban", "ban", "sfx", "sfx", "sfx"], r);
    rounds = AceDay.shuffle(champs, r).slice(0, ROUNDS).map((c, i) => ({ champ: c, kind: kinds[i], src: `${CD}/${KINDS[kinds[i]].path}/${c.key}.ogg` }));
  } catch {
    $("play").innerHTML = `<p class="muted">Couldn't load the champions. Refresh to try again.</p>`;
    return;
  }
  if (AceDay.LOCAL) window.voicesAnswer = rounds;                // for testing on this PC

  const KEY = `voices-day-${DAY}`;
  const save = AceDay.store.get(KEY, null) || { guesses: rounds.map(() => []), done: rounds.map(() => false) };
  const persist = () => AceDay.store.set(KEY, save);
  const pointsFor = i => { const g = save.guesses[i], k = g.indexOf(rounds[i].champ.name); return k >= 0 ? POINTS[k] : 0; };
  const total = () => rounds.reduce((a, _, i) => a + (save.done[i] ? pointsFor(i) : 0), 0);

  const audio = new Audio();
  audio.preload = "auto";
  audio.volume = 0.8;
  function play(src, btn) {
    if (!audio.paused && audio.dataset.src === src) { audio.pause(); audio.currentTime = 0; return; }
    audio.src = src;
    audio.dataset.src = src;
    document.querySelectorAll(".play-btn.on").forEach(b => b.classList.remove("on"));
    btn?.classList.add("on");
    audio.play().catch(() => {});
  }
  audio.addEventListener("ended", () => document.querySelectorAll(".play-btn.on").forEach(b => b.classList.remove("on")));

  function show() {
    const i = save.done.indexOf(false);
    if (i < 0) return finish();
    const rd = rounds[i], g = save.guesses[i];
    const hints = [g.length >= 1 ? `Class: <b>${esc(rd.champ.cls)}</b>` : "", g.length >= 2 ? `Starts with <b>${esc(rd.champ.name[0])}</b>` : ""].filter(Boolean);
    $("play").innerHTML = `
      <div class="round-head"><span class="muted">Sound ${i + 1} of ${ROUNDS}</span><b>${total()} pts</b></div>
      <div class="listen">
        <button class="play-btn" type="button" id="playBtn" aria-label="Play the sound">▶</button>
        <div><b>${KINDS[rd.kind].label}</b><span class="muted">${KINDS[rd.kind].what}</span></div>
      </div>
      <p class="audio-err muted small" id="audioErr" hidden>This sound didn't load. <button class="link" type="button" id="skip">Skip it</button> (no points).</p>
      ${hints.length ? `<div class="hints">${hints.map(h => `<span>${h}</span>`).join("")}</div>` : ""}
      <div class="pick"><input type="text" id="guess" placeholder="Type a champion…" aria-label="Type a champion" autocomplete="off" spellcheck="false"><ul id="sugg" role="listbox" hidden></ul></div>
      <div class="tries">${[0, 1, 2].map(k => `<span class="${g[k] ? "miss" : ""}">${g[k] ? esc(g[k]) : `${POINTS[k]}`}</span>`).join("")}</div>
      <div class="pips">${rounds.map((_, k) => `<i class="${save.done[k] ? (pointsFor(k) ? "won" : "lost") : k === i ? "now" : ""}"></i>`).join("")}</div>`;
    $("playBtn").onclick = () => play(rd.src, $("playBtn"));
    const err = () => { if (audio.dataset.src === rd.src) $("audioErr").hidden = false; };
    audio.onerror = err;
    $("skip").onclick = () => { save.done[i] = true; persist(); show(); };
    picker(i);
  }

  // Search box with suggestions.
  function picker(i) {
    const input = $("guess"), ul = $("sugg"), used = new Set(save.guesses[i]);
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
      else if (e.key === "Enter" && shown[on]) { guess(i, shown[on]); e.preventDefault(); }
      else if (e.key === "Escape") { shown = []; draw(); }
    });
    ul.addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li) { e.preventDefault(); guess(i, shown[+li.dataset.k]); } });
    input.focus({ preventScroll: true });
  }

  function guess(i, c) {
    const rd = rounds[i], g = save.guesses[i];
    g.push(c.name);
    const right = c.name === rd.champ.name;
    if (right || g.length >= POINTS.length) save.done[i] = true;
    persist();
    if (!save.done[i]) { FX.sound("buzz"); return show(); }
    FX.sound(right ? "chime" : "lose");
    reveal(i, right);
  }

  function reveal(i, right) {
    const rd = rounds[i], last = save.done.every(Boolean);
    $("play").innerHTML = `
      <div class="round-head"><span class="muted">Sound ${i + 1} of ${ROUNDS}</span><b>${total()} pts</b></div>
      <div class="answer ${right ? "won" : "lost"}">
        <img src="${esc(rd.champ.img)}" alt="">
        <div><b>${esc(rd.champ.name)}</b><span class="muted">${esc(rd.champ.title)}</span>
          <span>${right ? `Got it! +${pointsFor(i)}` : "Out of guesses"}</span></div>
        <button class="play-btn small" type="button" id="again" aria-label="Hear it again">▶</button>
      </div>
      <div class="actions"><button class="btn primary" type="button" id="next">${last ? "See your score" : "Next sound →"}</button></div>
      <div class="pips">${rounds.map((_, k) => `<i class="${save.done[k] ? (pointsFor(k) ? "won" : "lost") : ""}"></i>`).join("")}</div>`;
    $("again").onclick = () => play(rd.src, $("again"));
    $("next").onclick = () => { audio.pause(); show(); };
    $("next").focus({ preventScroll: true });
  }

  function shareText() {
    const marks = rounds.map((_, i) => ({ 100: "🟩", 60: "🟨", 30: "🟧", 0: "⬛" })[pointsFor(i)]).join("");
    return `Sound Check #${DAY}: ${total()}/${ROUNDS * 100}\n${marks}\nhttps://games.aceclan.lol/voices/`;
  }

  function finish() {
    if (!save.counted) { save.counted = true; persist(); FX.sound("win"); if (total() >= 700) FX.confetti(); }
    $("play").innerHTML = `
      <div class="end">
        <h2>${total()} <small>/ ${ROUNDS * 100}</small></h2>
        <ol class="results">${rounds.map((rd, i) => `<li>
          <button class="play-btn small" type="button" data-i="${i}" aria-label="Play ${esc(rd.champ.name)}'s sound">▶</button>
          <img src="${esc(rd.champ.img)}" alt=""><span><b>${esc(rd.champ.name)}</b> <span class="muted">${KINDS[rd.kind].label.toLowerCase()}</span></span>
          <b class="pts">${pointsFor(i)}</b></li>`).join("")}</ol>
        <div class="row"><button id="share" class="btn primary" type="button">Copy result</button></div>
        <p id="shareNote" class="muted small" aria-live="polite"></p>
        <p class="muted small">New sounds in <b>${AceDay.untilNext()}</b>. Try <a href="../acedle/">ACEdle</a> or <a href="../crossword/">ACE Mini</a> too.</p>
      </div>`;
    $("play").querySelectorAll(".results .play-btn").forEach(b => b.addEventListener("click", () => play(rounds[+b.dataset.i].src, b)));
    $("share").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(shareText()); $("shareNote").textContent = "Copied. Paste it in Discord."; }
      catch { $("shareNote").textContent = shareText(); }
    });
  }

  show();
})();
