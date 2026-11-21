// ACE Mini: the daily 5x5 crossword. The grid is built from words.txt by build.js, using the day's
// random numbers, so everyone gets the same one. Progress and time are saved in this browser.
(async () => {
  "use strict";
  const $ = id => document.getElementById(id);
  const FX = window.AceFX || { sound() {}, confetti() {}, soundButton() {} };
  document.querySelector(".top")?.append(FX.soundButton?.() || "");

  const DAY = await AceDay.today();
  $("dayNo").textContent = "#" + DAY;
  let puzzle;
  try {
    const text = await (await fetch("words.txt", { cache: "no-cache" })).text();
    puzzle = AceMini.build(AceMini.parse(text), AceDay.rng(DAY, 41));
  } catch {
    $("play").innerHTML = `<p class="muted">Couldn't load today's puzzle. Refresh to try again.</p>`;
    return;
  }
  const N = puzzle.size, answer = puzzle.cells;
  if (AceDay.LOCAL) window.miniAnswer = puzzle;                   // for testing on this PC

  const KEY = `mini-day-${DAY}`;
  const save = AceDay.store.get(KEY, null) || { letters: answer.map(r => r.map(() => "")), secs: 0, checks: 0, reveals: 0, done: false, revealed: [] };
  const persist = () => AceDay.store.set(KEY, save);
  const isCell = (r, c) => r >= 0 && c >= 0 && r < N && c < N && !!answer[r][c];
  const solved = () => answer.every((row, r) => row.every((ch, c) => !ch || save.letters[r][c] === ch));

  // Which entry a square belongs to in each direction.
  const entryAt = (r, c, dir) => puzzle.entries.find(e => e.dir === dir &&
    (dir === "a" ? e.row === r && c >= e.col && c < e.col + e.word.length : e.col === c && r >= e.row && r < e.row + e.word.length));
  const cellsOf = e => [...e.word].map((_, i) => e.dir === "a" ? [e.row, e.col + i] : [e.row + i, e.col]);

  let cur = { r: puzzle.entries[0].row, c: puzzle.entries[0].col, dir: puzzle.entries[0].dir };
  let wrong = new Set();

  // ---- Timer: counts while the page is open and the puzzle isn't finished ------------------------
  let started = 0;
  const elapsed = () => save.secs + (started ? Math.floor((Date.now() - started) / 1000) : 0);
  const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function startClock() { if (!started && !save.done) started = Date.now(); }
  function stopClock() { if (started) { save.secs = elapsed(); started = 0; persist(); } }
  document.addEventListener("visibilitychange", () => document.hidden ? stopClock() : null);
  setInterval(() => { const t = $("time"); if (t) t.textContent = clock(elapsed()); }, 500);

  // ---- Drawing -------------------------------------------------------------------------------------
  const nums = {};
  for (const e of puzzle.entries) nums[`${e.row},${e.col}`] = e.num;

  function draw() {
    if (save.done) return finish();
    $("play").innerHTML = `
      <div class="bar"><span class="muted">${puzzle.entries.length} words</span><b id="time">${clock(elapsed())}</b></div>
      <div class="clue-now" id="clueNow"></div>
      <div class="grid" id="grid" style="--n:${N}">${answer.map((row, r) => row.map((ch, c) => ch
        ? `<label class="sq" data-r="${r}" data-c="${c}">${nums[`${r},${c}`] ? `<small>${nums[`${r},${c}`]}</small>` : ""}<input autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Row ${r + 1}, column ${c + 1}"></label>`
        : `<span class="sq block"></span>`).join("")).join("")}</div>
      <div class="actions"><button class="btn" type="button" id="check">Check</button><button class="btn" type="button" id="reveal">Reveal square</button></div>
      <div class="clues">${[["a", "Across"], ["d", "Down"]].map(([d, label]) => `<div><h3>${label}</h3><ol>${puzzle.entries.filter(e => e.dir === d)
        .map(e => `<li data-num="${e.num}" data-dir="${e.dir}"><b>${e.num}</b><span></span></li>`).join("")}</ol></div>`).join("")}</div>`;
    // Clue text goes in as text, not HTML (words.txt is edited by hand).
    $("play").querySelectorAll(".clues li").forEach(li => {
      li.querySelector("span").textContent = puzzle.entries.find(e => e.num === +li.dataset.num && e.dir === li.dataset.dir).clue;
      li.addEventListener("click", () => {
        const e = puzzle.entries.find(x => x.num === +li.dataset.num && x.dir === li.dataset.dir);
        const empty = cellsOf(e).find(([r, c]) => !save.letters[r][c]) || [e.row, e.col];
        cur = { r: empty[0], c: empty[1], dir: e.dir };
        focus();
      });
    });
    const grid = $("grid");
    grid.querySelectorAll("input").forEach(inp => {
      const sq = inp.parentElement, r = +sq.dataset.r, c = +sq.dataset.c;
      inp.value = save.letters[r][c];
      inp.addEventListener("pointerdown", e => {
        e.preventDefault();
        // A second tap on the square you're already on switches between across and down.
        if (cur.r === r && cur.c === c && document.activeElement === inp) toggle();
        else { cur.r = r; cur.c = c; if (!entryAt(r, c, cur.dir)) toggle(); }
        focus();
      });
      inp.addEventListener("focus", () => { if (cur.r !== r || cur.c !== c) { cur.r = r; cur.c = c; if (!entryAt(r, c, cur.dir)) toggle(); } paint(); });
      inp.addEventListener("keydown", onKey);
      // Phone keyboards (and pasting) arrive here instead of as key presses.
      inp.addEventListener("input", () => {
        const typed = inp.value.toUpperCase().replace(/[^A-Z]/g, "");
        const had = save.letters[r][c];
        const fresh = typed.startsWith(had) && typed.length > had.length ? typed.slice(had.length) : typed;
        if (!fresh) return type("");
        for (const ch of fresh) type(ch);
      });
    });
    $("check").onclick = check;
    $("reveal").onclick = reveal;
    paint();
  }

  function toggle() {
    const other = cur.dir === "a" ? "d" : "a";
    if (entryAt(cur.r, cur.c, other)) cur.dir = other;
  }
  function inputAt(r, c) { return $("grid")?.querySelector(`.sq[data-r="${r}"][data-c="${c}"] input`); }
  function focus() { inputAt(cur.r, cur.c)?.focus({ preventScroll: true }); paint(); }

  function paint() {
    const e = entryAt(cur.r, cur.c, cur.dir) || entryAt(cur.r, cur.c, cur.dir === "a" ? "d" : "a");
    if (e) cur.dir = e.dir;
    const inWord = new Set(e ? cellsOf(e).map(([r, c]) => `${r},${c}`) : []);
    $("grid").querySelectorAll("label.sq").forEach(sq => {
      const k = `${sq.dataset.r},${sq.dataset.c}`;
      sq.classList.toggle("word", inWord.has(k));
      sq.classList.toggle("here", +sq.dataset.r === cur.r && +sq.dataset.c === cur.c);
      sq.classList.toggle("wrong", wrong.has(k));
      sq.classList.toggle("given", save.revealed.includes(k));
    });
    $("play").querySelectorAll(".clues li").forEach(li => li.classList.toggle("on", !!e && +li.dataset.num === e.num && li.dataset.dir === e.dir));
    if (e) $("clueNow").innerHTML = `<b>${e.num} ${e.dir === "a" ? "Across" : "Down"}</b> <span></span>`, $("clueNow").querySelector("span").textContent = e.clue;
  }

  function step(dr, dc) {
    let r = cur.r + dr, c = cur.c + dc;
    while (r >= 0 && c >= 0 && r < N && c < N) {
      if (isCell(r, c)) { cur.r = r; cur.c = c; return true; }
      r += dr; c += dc;
    }
    return false;
  }

  function type(ch) {
    startClock();
    const k = `${cur.r},${cur.c}`;
    if (save.revealed.includes(k)) ch = answer[cur.r][cur.c];      // revealed squares stay right
    save.letters[cur.r][cur.c] = ch;
    wrong.delete(k);
    const inp = inputAt(cur.r, cur.c);
    if (inp) inp.value = ch;
    persist();
    if (ch) {
      FX.sound("flick");
      // Move on within the word, skipping squares already filled.
      const e = entryAt(cur.r, cur.c, cur.dir);
      if (e) {
        const cells = cellsOf(e), i = cells.findIndex(([r, c]) => r === cur.r && c === cur.c);
        const next = cells.slice(i + 1).find(([r, c]) => !save.letters[r][c]) || cells[i + 1];
        if (next) { cur.r = next[0]; cur.c = next[1]; }
      }
    }
    if (solved()) return win();
    focus();
  }

  function onKey(e) {
    const moves = { ArrowLeft: [0, -1, "a"], ArrowRight: [0, 1, "a"], ArrowUp: [-1, 0, "d"], ArrowDown: [1, 0, "d"] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc, dir] = moves[e.key];
      if (cur.dir !== dir && entryAt(cur.r, cur.c, dir)) cur.dir = dir; else step(dr, dc);
      return focus();
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (save.letters[cur.r][cur.c] && !save.revealed.includes(`${cur.r},${cur.c}`)) { type(""); return; }
      const back = cur.dir === "a" ? [0, -1] : [-1, 0];
      if (step(...back) && !save.revealed.includes(`${cur.r},${cur.c}`)) { save.letters[cur.r][cur.c] = ""; inputAt(cur.r, cur.c).value = ""; persist(); }
      return focus();
    }
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); return focus(); }
    if (/^[a-z]$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); type(e.key.toUpperCase()); }
  }

  function check() {
    startClock();
    save.checks++;
    wrong = new Set();
    answer.forEach((row, r) => row.forEach((ch, c) => { if (ch && save.letters[r][c] && save.letters[r][c] !== ch) wrong.add(`${r},${c}`); }));
    persist();
    FX.sound(wrong.size ? "buzz" : "ding");
    focus();
  }

  function reveal() {
    startClock();
    const k = `${cur.r},${cur.c}`;
    if (save.letters[cur.r][cur.c] === answer[cur.r][cur.c] && save.revealed.includes(k)) return focus();
    save.reveals++;
    save.revealed.push(k);
    type(answer[cur.r][cur.c]);
  }

  function win() {
    stopClock();
    save.done = true;
    persist();
    FX.sound("win");
    if (!save.checks && !save.reveals) FX.confetti();
    finish();
  }

  function shareText() {
    const extras = [save.checks ? `${save.checks} check${save.checks > 1 ? "s" : ""}` : "", save.reveals ? `${save.reveals} reveal${save.reveals > 1 ? "s" : ""}` : ""].filter(Boolean);
    return `ACE Mini #${DAY}: solved in ${clock(save.secs)}${extras.length ? ` (${extras.join(", ")})` : " with no help ✨"}\nhttps://games.aceclan.lol/crossword/`;
  }

  function finish() {
    $("play").innerHTML = `
      <div class="end">
        <h2>${clock(save.secs)}</h2>
        <p class="muted">${save.checks || save.reveals ? `${save.checks} check${save.checks === 1 ? "" : "s"}, ${save.reveals} reveal${save.reveals === 1 ? "" : "s"}` : "Solved with no help ✨"}</p>
        <div class="grid done" style="--n:${N}">${answer.map(row => row.map(ch => ch ? `<span class="sq">${ch}</span>` : `<span class="sq block"></span>`).join("")).join("")}</div>
        <ol class="answers">${puzzle.entries.map(e => `<li><b>${e.num}${e.dir === "a" ? "A" : "D"} ${e.word}</b> <span></span></li>`).join("")}</ol>
        <div class="row"><button id="share" class="btn primary" type="button">Copy result</button></div>
        <p id="shareNote" class="muted small" aria-live="polite"></p>
        <p class="muted small">Next puzzle in <b>${AceDay.untilNext()}</b>. Try <a href="../acedle/">ACEdle</a> or <a href="../voices/">Sound Check</a> too.</p>
      </div>`;
    $("play").querySelectorAll(".answers span").forEach((s, i) => { s.textContent = puzzle.entries[i].clue; });
    $("share").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(shareText()); $("shareNote").textContent = "Copied. Paste it in Discord."; }
      catch { $("shareNote").textContent = shareText(); }
    });
  }

  draw();
})();
