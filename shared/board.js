// Clan leaderboards for the daily games (ACE Mini, Squads, Map Pin), shown on each game's results.
// Scores are kept by RIOT API (riot.aceclan.lol, on the clan PC), the program that also keeps ACEdle's
// leaderboard; it works the points out again itself. The name you add a score with is remembered and shared
// with ACEdle, so you're the same person on every board. Each board has Today and All time (points added up).
//
//   AceBoard.mount(el, {
//     game: "squads", day: DAY, title: "Leaderboard",
//     run: { solved: 4, mistakes: 1 },                       // what happened, sent along with the name
//     today: [{ head: "Result", cell: r => "...", cls: "x" }, ...],  // columns after the name (default: points)
//     all: [...],                                            // the same for All time (default: days, points)
//     how: "How the points work.",
//   });
// Each row's `cell` gets { name, points, detail } for Today, { name, points, days, best } for All time,
// and returns HTML (only numbers and fixed words: names are escaped here).
window.AceBoard = (() => {
  "use strict";
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const RIOT = LOCAL ? "http://localhost:5080" : "https://riot.aceclan.lol";
  const FX = window.AceFX || { sound() {} };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: just not saved */ } },
  };
  const POINTS = { head: "Points", cell: r => r.points, cls: "p" };
  const DAYS = { head: "Days", cell: r => r.days };

  function mount(el, o) {
    const KEY = `board-${o.game}-day-${o.day}`;          // { name } once this run is on today's board
    let mine = store.get(KEY, null);
    const cols = { today: o.today || [POINTS], all: o.all || [DAYS, POINTS] };
    el.classList.add("aceboard");
    el.innerHTML = `
      <h3><span></span><span class="aceboard-tabs"><button type="button" data-t="today" class="on" aria-pressed="true">Today</button><button type="button" data-t="all" aria-pressed="false">All time</button></span></h3>
      <div class="aceboard-send"${mine ? " hidden" : ""}>
        <input maxlength="20" placeholder="Your name" aria-label="Your name for the leaderboard" autocomplete="nickname">
        <button class="btn primary" type="button">Add my score</button>
      </div>
      <p class="aceboard-note" aria-live="polite"></p>
      <div class="aceboard-list"><p class="muted">Loading the leaderboard…</p></div>
      ${o.how ? `<p class="aceboard-how"></p>` : ""}`;
    const q = s => el.querySelector(s);
    q("h3 span").textContent = o.title || "Leaderboard";
    if (o.how) q(".aceboard-how").textContent = o.how;
    const input = q(".aceboard-send input"), send = q(".aceboard-send button"), note = q(".aceboard-note");
    input.value = mine?.name || store.get("acedle-name", "");
    const sayMine = () => { note.className = "aceboard-note"; note.innerHTML = `Your score is on the board as <b>${esc(mine.name)}</b>.`; };
    if (mine) sayMine(); else note.textContent = "Add your score to see where you rank.";

    let tab = "today", board = null;
    function draw() {
      if (!board) return;
      const me = (mine?.name || input.value || "").trim().toLowerCase();
      const rows = tab === "today" ? board.scores : board.allTime, list = cols[tab];
      q(".aceboard-list").innerHTML = rows.length
        ? `<table><thead><tr><th>#</th><th>Name</th>${list.map(c => `<th class="${c.cls || ""}">${esc(c.head)}</th>`).join("")}</tr></thead><tbody>
          ${rows.map((r, i) => `<tr class="${me && r.name.toLowerCase() === me ? "me" : ""}"><td class="n">${i + 1}</td><td class="who">${esc(r.name)}</td>
            ${list.map(c => `<td class="${c.cls || ""}">${c.cell(r)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
        : `<p class="muted">Nobody yet${tab === "today" ? " today. Be the first!" : "."}</p>`;
    }
    async function load() {
      try {
        const r = await fetch(`${RIOT}/daily/${o.game}/leaderboard?day=${o.day}`, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status);
        board = await r.json();
        draw();
      } catch {
        q(".aceboard-list").innerHTML = `<p class="muted">The leaderboard is offline right now (it runs on the clan PC).${mine ? "" : " Your result is saved here; add it later."}</p>`;
      }
    }
    el.querySelectorAll(".aceboard-tabs button").forEach(b => b.addEventListener("click", () => {
      tab = b.dataset.t;
      el.querySelectorAll(".aceboard-tabs button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
      draw();
    }));

    async function submit() {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      send.disabled = true;
      note.className = "aceboard-note";
      note.textContent = "Sending…";
      try {
        const r = await fetch(`${RIOT}/daily/${o.game}/score`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...o.run, day: o.day, name }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't add your score.");
        mine = { name };
        store.set(KEY, mine);
        store.set("acedle-name", name);
        q(".aceboard-send").hidden = true;
        sayMine();
        FX.sound("chime");
        load();
      } catch (e) {
        note.className = "aceboard-note bad";
        note.textContent = e.message === "Failed to fetch" ? "The leaderboard is offline right now. Try again later." : e.message;
        send.disabled = false;
      }
    }
    send.addEventListener("click", submit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    load();
  }

  return { mount };
})();
