// ACE Punchline, online. The server (server/games/punchline.py) hands out prompts, runs the clock,
// keeps who wrote what secret until each reveal, and scores the votes. This page shows whatever the
// current phase needs: your prompts to answer, two answers to vote between, or the reveal.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX = 80;
  let send = null, api = null, state = null, deadline = 0, timer = 0, lastSecond = null;
  let built = "", prevPhase = null, prevKey = "", shownScores = {};

  // ---- Clock ---------------------------------------------------------------------------------
  function tickClock() {
    const s = state, clock = $("stClock");
    if (!s || !s.started || s.over) { clock.textContent = ""; return; }
    const left = Math.max(0, (deadline - Date.now()) / 1000), sec = Math.ceil(left);
    const timed = ["write", "final_write", "vote", "final_vote"].includes(s.phase);
    clock.textContent = timed || s.phase === "ready" ? String(sec) : "";
    const low = timed && left < 10 && left > 0;
    clock.classList.toggle("low", low);
    if (low && sec !== lastSecond) AceFX.sound("tick");
    lastSecond = sec;
  }

  // ---- Lobby: players' own prompts --------------------------------------------------------------
  function lobby(s) {
    const body = $("stBody");
    if (built !== "lobby") {
      built = "lobby";
      body.innerHTML = `
        <div class="intro">
          <p class="big">Write the funniest answer. Win the vote.</p>
          <p class="muted">Each prompt goes to two players, and everyone else votes for the answer they like best without knowing who wrote it.</p>
        </div>
        <form id="addForm" class="add-row" autocomplete="off">
          <label class="sr" for="addText">Add your own prompt</label>
          <input id="addText" maxlength="160" placeholder="Add your own prompt, e.g. {player}'s worst ever purchase">
          <button class="btn" type="submit">Add</button>
        </form>
        <p class="muted small">Tip: write <code>{player}</code> and it becomes someone's name in the game.</p>
        <ul id="customList" class="custom-list"></ul>`;
      $("addForm").addEventListener("submit", e => {
        e.preventDefault();
        const text = $("addText").value.trim();
        if (!text) return;
        send("add_prompt", { text });
        $("addText").value = "";
      });
    }
    const list = $("customList");
    list.innerHTML = "";
    const on = (s.options || {}).custom !== "off";
    if (!s.custom.length) list.innerHTML = `<li class="muted">No player prompts yet.${on ? "" : " (The leader has them switched off.)"}</li>`;
    s.custom.forEach(c => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="ct"></span><small class="muted"></small>`;
      li.querySelector(".ct").textContent = c.text;
      li.querySelector("small").textContent = "by " + c.by;
      if (c.mine || s.isHost) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "link-btn";
        b.textContent = "Remove";
        b.addEventListener("click", () => send("remove_prompt", { id: c.id }));
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    if (s.custom.length && !on) list.insertAdjacentHTML("afterbegin", '<li class="muted">The leader has player prompts switched off for this game.</li>');
  }

  // ---- Writing ---------------------------------------------------------------------------------
  // Built once per round, so typing isn't wiped by other people's updates; later updates only
  // change each card's "sent" line.
  function writing(s) {
    const body = $("stBody");
    const key = `w/${s.round}/${s.phase}/${s.mine ? s.mine.length : 0}`;
    if (built !== key) {
      built = key;
      body.innerHTML = "";
      if (!s.mine || !s.mine.length) {
        body.innerHTML = `<div class="wait"><p class="big">Everyone's writing…</p><p class="muted" id="waitNote"></p></div>`;
      }
      (s.mine || []).forEach((m, i) => {
        const card = document.createElement("form");
        card.className = "prompt-card pop-in";
        card.style.setProperty("--d", i * 90 + "ms");
        card.autocomplete = "off";
        card.innerHTML = `
          <p class="prompt"></p>
          <div class="write-row">
            <label class="sr" for="ans${i}">Your answer</label>
            <input id="ans${i}" maxlength="${MAX}" placeholder="Your answer…" enterkeyhint="send">
            <button class="btn primary" type="submit">Send</button>
          </div>
          <div class="card-foot">
            <span class="sent"></span>
            <span class="count muted small"></span>
            <button class="link-btn pick" type="button" title="A stock answer for half points">Pick for me</button>
          </div>`;
        card.querySelector(".prompt").textContent = m.prompt;
        const input = card.querySelector("input");
        input.value = m.answer && !m.safe ? m.answer : "";
        const count = () => { card.querySelector(".count").textContent = `${input.value.length}/${MAX}`; };
        input.addEventListener("input", count);
        count();
        card.addEventListener("submit", e => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) { input.focus(); return; }
          send("answer", { prompt: i, text });
          AceFX.sound("chip");
          const next = body.querySelectorAll("input")[i + 1];
          if (next && !next.value) next.focus();
          else input.blur();
        });
        card.querySelector(".pick").addEventListener("click", () => send("pick_for_me", { prompt: i }));
        body.appendChild(card);
      });
      if (s.mine && s.mine.length && !matchMedia("(pointer: coarse)").matches) body.querySelector("input").focus();
    }
    (s.mine || []).forEach((m, i) => {
      const card = body.querySelectorAll(".prompt-card")[i];
      if (!card) return;
      card.classList.toggle("done", !!m.answer);
      card.querySelector(".sent").innerHTML = m.answer
        ? `✔ Sent: <b></b>${m.safe ? ' <span class="tag">Picked for you, half points</span>' : ""}` : "";
      if (m.answer) card.querySelector(".sent b").textContent = m.answer;
    });
    const note = $("waitNote");
    if (note) note.textContent = s.writing ? `${s.writing} player${s.writing === 1 ? " is" : "s are"} still writing.` : "";
  }

  // ---- Voting and reveals ---------------------------------------------------------------------
  function answerButton(a, i, opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `ans a${i % 2}` + (opts.mine ? " mine" : "") + (opts.win ? " win" : "") + (opts.show ? " shown" : "") + (opts.pop ? " pop-in" : "");
    b.style.setProperty("--d", i * 110 + "ms");
    b.disabled = !opts.can;
    b.innerHTML = `<span class="text"></span>`;
    b.querySelector(".text").textContent = a.text || "(no answer)";
    if (opts.show) {
      const who = document.createElement("span");
      who.className = "by";
      who.innerHTML = `<b></b><em></em>`;
      who.querySelector("b").textContent = a.name;
      who.querySelector("em").textContent = `+${a.pts}`;
      if (a.safe) who.insertAdjacentHTML("beforeend", '<span class="tag">Picked for them</span>');
      b.appendChild(who);
      const v = document.createElement("span");
      v.className = "voters muted small";
      v.textContent = a.voters.length ? `${a.voters.length} vote${a.voters.length === 1 ? "" : "s"}: ${a.voters.join(", ")}` : "No votes";
      b.appendChild(v);
    }
    const choice = opts.choice ?? i;
    if (opts.can) b.addEventListener("click", () => { send("vote", { choice }); AceFX.sound("chip"); });
    return b;
  }

  function match(s) {
    const m = s.match, show = s.phase === "reveal";
    const key = `m/${s.round}/${m.num}/${s.phase}`;
    const fresh = key !== prevKey;
    const body = $("stBody");
    built = key;
    body.innerHTML = `<p class="prompt big-prompt"></p><div class="versus"></div><p class="vote-note muted"></p>`;
    body.querySelector(".prompt").textContent = m.prompt;
    const vs = body.querySelector(".versus");
    const top = show ? Math.max(...m.answers.map(a => a.voters.length)) : -1;
    m.answers.forEach((a, i) => {
      if (i === 1) vs.insertAdjacentHTML("beforeend", '<span class="vs" aria-hidden="true">VS</span>');
      vs.appendChild(answerButton(a, i, {
        can: s.phase === "vote" && !m.iWrote && !s.over, mine: m.myVote === i, show, pop: fresh,
        win: show && top > 0 && a.voters.length === top && m.answers.filter(x => x.voters.length === top).length === 1,
      }));
    });
    let note = "";
    if (m.note === "jinx") note = "Jinx! You both wrote the same thing. No points.";
    else if (m.note === "walkover") note = "Only one answer came in, so it wins by walkover.";
    else if (s.phase === "vote") note = m.iWrote ? "You wrote one of these. Sit back and hope." : m.myVote != null ? "Vote in. You can change it until time's up." : "Tap the answer you like best.";
    else if (show && m.answers.some(a => a.voters.length && a.voters.length === m.voted && m.voted > 1)) note = "Clean sweep! Every vote went one way.";
    if (s.phase === "vote") note += `  ${m.voted} of ${m.voters} voted.`;
    body.querySelector(".vote-note").textContent = note.trim();
    if (fresh && show) AceFX.sound(m.note === "jinx" ? "buzz" : "chime");
    if (fresh && !show) AceFX.sound("flip");
    prevKey = key;
  }

  function final(s) {
    const f = s.final, show = s.phase !== "final_vote";
    const key = `f/${s.phase}`;
    const fresh = key !== prevKey;
    const body = $("stBody");
    built = key;
    body.innerHTML = `<p class="kicker">The Last Laugh</p><p class="prompt big-prompt"></p><div class="final-grid"></div><p class="vote-note muted"></p>`;
    body.querySelector(".prompt").textContent = f.prompt;
    const grid = body.querySelector(".final-grid");
    let rows = f.answers.map((a, i) => ({ a, i }));
    if (show) rows = rows.sort((x, y) => y.a.voters.length - x.a.voters.length);
    const top = show && rows.length ? rows[0].a.voters.length : -1;
    rows.forEach(({ a, i }, k) => {
      const b = answerButton(a, k, {
        choice: i, can: s.phase === "final_vote" && !a.own, mine: f.myVote === i, show, pop: fresh,
        win: show && top > 0 && a.voters.length === top,
      });
      if (a.own && !show) b.classList.add("own");
      grid.appendChild(b);
    });
    body.querySelector(".vote-note").textContent = s.phase === "final_vote"
      ? `${f.myVote != null ? "Vote in. " : "Vote for your favourite (not your own). "}${f.voted} of ${f.voters} voted.`
      : `Each vote was worth 300 points.`;
    if (fresh) AceFX.sound(show ? "chime" : "flip");
    prevKey = key;
  }

  function between(s) {
    const body = $("stBody");
    const key = `b/${s.phase}/${s.round}`;
    if (built === key) return;
    built = key;
    if (s.phase === "ready") {
      body.innerHTML = `<div class="wait"><p class="big">Get ready…</p><p class="muted">Prompts are on their way.</p></div>`;
      return;
    }
    const best = s.board.filter(r => r.gained).sort((a, b) => b.gained - a.gained)[0];
    body.innerHTML = `<div class="wait"><p class="big"></p><p class="muted"></p></div>`;
    body.querySelector(".big").textContent = `Round ${s.round} done`;
    body.querySelector(".muted").textContent = (best ? `Best round: ${best.name} with +${best.gained}. ` : "") +
      (s.round >= s.rounds ? "Next up: the Last Laugh." : `Round ${s.round + 1} is worth ${s.round + 1}x points.`);
  }

  // ---- Scores ------------------------------------------------------------------------------------
  function board(s) {
    const box = $("board");
    const before = AceFX.snap(box);
    box.innerHTML = "";
    const rows = s.started ? s.board : s.players.filter(p => p.role === "player").map(p => ({ id: p.id, name: p.name, score: 0, online: p.online }));
    if (!rows.length) box.innerHTML = '<li class="muted">Nobody has a seat yet.</li>';
    const writing = s.phase === "write" || s.phase === "final_write";
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = (r.id === s.you ? "me " : "") + (r.online === false ? "away " : "") +
        ((s.winners || []).includes(r.id) ? "winner " : "") + (writing && !r.todo && r.playing ? "answered " : "");
      li.dataset.key = r.id;
      li.innerHTML = `<span class="rank">${i + 1}</span><span class="who"></span><small class="gain"></small><span class="pts"></span>`;
      const seat = s.seats.findIndex(x => x.id === r.id);
      li.insertBefore(AceFX.avatar(r.name, seat >= 0 ? seat : 8, "sm"), li.querySelector(".who"));
      li.querySelector(".who").textContent = r.name + (writing && r.todo ? "  ✍️" : "");
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

  // ---- Page ----------------------------------------------------------------------------------------
  function render(s) {
    state = s;
    deadline = Date.now() + (s.remaining || 0) * 1000;
    clearInterval(timer);
    timer = setInterval(tickClock, 250);
    const seated = api.me.role === "player";
    const ph = s.phase;

    $("stRound").textContent = !s.started ? "Lobby" : s.over ? "Final scores"
      : ph && ph.startsWith("final") ? "The Last Laugh"
      : ph === "vote" || ph === "reveal" ? `Round ${s.round} · Matchup ${s.match.num} of ${s.match.of}`
      : ph === "ready" ? `${s.rounds} round${s.rounds > 1 ? "s" : ""} + the Last Laugh` : `Round ${s.round} of ${s.rounds}`;

    if (!s.started) lobby(s);
    else if (ph === "write" || ph === "final_write") writing(s);
    else if (ph === "vote" || ph === "reveal") match(s);
    else if ((ph === "final_vote" || ph === "final_reveal" || ph === "done") && s.final) final(s);
    else between(s);
    if (prevPhase !== ph && (ph === "write" || ph === "final_write")) AceFX.sound("ding");

    board(s);
    podium(s);
    prevPhase = ph;

    const todo = (s.mine || []).filter(m => !m.answer).length;
    if (!s.started) {
      api.status("Lobby", "Write funny answers, vote for the best. 3 to 12 players.");
      api.hint(seated ? "You've got a seat. Add some prompts of your own while you wait." : "Take a seat in the Players panel to play, or just watch and vote.");
    } else if (s.over) {
      api.status("Final scores", s.result, "win");
      api.hint(s.isHost ? "Press Play again for another game. Player prompts are kept." : "Waiting for the leader to start another game.");
    } else if (ph === "write" || ph === "final_write") {
      api.status(ph === "final_write" ? "The Last Laugh" : `Round ${s.round}: write`, `${s.limit} seconds`, "go");
      api.hint(!(s.mine || []).length ? (seated ? "You'll get prompts from the next round." : "You're watching. You can still vote.")
        : todo ? `Answer ${todo === 1 ? "your last prompt" : `your ${todo} prompts`} before time runs out.` : "All sent. You can still change an answer until time's up.", todo ? "go" : "");
    } else if (ph === "vote" || ph === "final_vote") {
      const iWrote = ph === "vote" && s.match.iWrote;
      api.status("Vote", ph === "final_vote" ? "Pick your favourite" : "Which answer is funnier?", "go");
      api.hint(iWrote ? "One of these is yours. No voting for yourself." : "Tap the answer you like best.", iWrote ? "" : "go");
    } else {
      api.status(ph === "ready" ? "Get ready" : ph === "scores" ? "Scores" : "Results", "");
      api.hint("");
    }
    tickClock();
  }

  function start(packChoices) {
    AceRoom.start({
      game: "punchline",
      title: "ACE Punchline",
      blurb: "Write the funniest answer to a prompt, then vote for your favourites. The crowd decides who's funny.",
      players: "3 to 12 players; anyone watching can vote too.",
      canSkip: true,
      options: [
        { key: "pack", label: "Prompts (tick as many as you like)", choices: packChoices, multi: true },
        { key: "rounds", label: "Length", choices: [["2", "2 rounds + Last Laugh"], ["1", "1 round + Last Laugh"], ["3", "3 rounds + Last Laugh"]] },
        { key: "time", label: "Writing time", choices: [["90", "90 seconds to write"], ["60", "60 seconds"], ["120", "120 seconds"], ["150", "150 seconds"]] },
        { key: "custom", label: "Player prompts", choices: [["on", "Use prompts players add"], ["off", "Only the built-in prompts"]] },
      ],
      myTurn: s => (s.mine || []).some(m => !m.answer) || (s.phase === "vote" && s.match && !s.match.iWrote && s.match.myVote == null),
      iWon: s => (s.winners || []).includes(s.you),
      seatTag: (i, s) => {
        const id = s.seats[i] && s.seats[i].id, r = (s.board || []).find(x => x.id === id);
        return r ? `${r.score} pts` : "";
      },
      rules: `<ol>
        <li>Each round, everyone gets two prompts and writes the funniest answer they can before time runs out.</li>
        <li>Every prompt went to two players. Their answers go head to head, and everyone else votes for the one they like best, without knowing who wrote which.</li>
        <li>Each matchup shares 1,000 points by votes, plus 250 for a clean sweep. Round 2 is worth double, round 3 triple.</li>
        <li>Stuck? <b>Pick for me</b> fills in a stock answer, but it only scores half.</li>
        <li>Write the same thing as your opponent and it's a jinx: no points for either of you.</li>
        <li>The Last Laugh: one prompt for everybody. Vote for your favourite; each vote is 300 points. Most points wins.</li>
      </ol>
      <p class="muted small">In the lobby anyone can add their own prompts; <code>{player}</code> in a prompt becomes someone's name. Built-in prompts live in <code>punchline/prompts.txt</code>.</p>`,
      render(s, a) {
        api = a;
        send = a.send;
        render(s);
      },
    });
  }

  // The prompt packs for the start screen come from the same file the server reads.
  fetch("prompts.txt", { cache: "no-store" }).then(r => r.ok ? r.text() : "").catch(() => "").then(text => {
    const packs = [];
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^\[(\w+)\]\s*(.*)$/);
      if (m) { cur = { key: m[1], name: m[2] || m[1], n: 0 }; packs.push(cur); }
      else if (cur) cur.n++;
    }
    const choices = packs.filter(p => p.n).map(p => [p.key, `${p.name} (${p.n})`]);
    start(choices.length ? choices : [["league", "League of Legends"], ["valorant", "VALORANT"], ["clan", "Clan life"], ["everyday", "Everyday stuff"]]);
  });
})();
