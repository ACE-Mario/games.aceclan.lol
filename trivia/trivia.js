// Clan Trivia, online. The server (server/games/trivia.py) runs the clock, keeps the right
// answer secret until time is up, and scores everyone. This page shows the question, a timer
// and the leaderboard.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const LETTERS = "ABCD";
  let send = null, state = null, deadline = 0, timer = 0;
  let lastSecond = null, prevPhase = null, prevIndex = null, shownScores = {};

  const packChoices = Object.entries(window.TRIVIA_PACKS || {}).map(([k, p]) => {
    const n = p.questions.split("\n").filter(l => l.includes("|") && !l.trim().startsWith("#")).length;
    return [k, `${p.name} (${n})`];
  });

  function tickClock() {
    const s = state;
    const clock = $("qClock");
    if (!s || !s.started || s.over) { setClock("", null); return; }
    const left = Math.max(0, (deadline - Date.now()) / 1000);
    if (s.phase === "question") {
      const sec = Math.ceil(left);
      setClock(String(sec), left / s.limit);
      $("timerBar").style.width = (100 * left / s.limit) + "%";
      $("timerBar").className = left < 5 ? "low" : "";
      clock.classList.toggle("low", left < 5 && left > 0);
      if (left < 5 && left > 0 && sec !== lastSecond) {
        AceFX.sound("tick");
        AceFX.pulse(clock, "beat");
      }
      lastSecond = sec;
    } else if (s.phase === "ready") {
      setClock("", null);
      $("qText").textContent = `Get ready… ${Math.ceil(left)}`;
    } else if (s.phase === "reveal") {
      setClock(left > 0.3 ? `Next in ${Math.ceil(left)}` : "", null);
    }
  }

  // The clock: a number inside a ring that empties as time runs out (text only between questions).
  function setClock(text, frac) {
    const clock = $("qClock");
    if (!clock.querySelector("svg")) {
      clock.innerHTML = '<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="ring-bg" cx="22" cy="22" r="19"/><circle class="ring-fg" cx="22" cy="22" r="19"/></svg><span></span>';
    }
    clock.querySelector("span").textContent = text;
    clock.classList.toggle("ringed", frac != null);
    if (frac == null) clock.classList.remove("low");
    const c = 2 * Math.PI * 19;
    const fg = clock.querySelector(".ring-fg");
    fg.style.strokeDasharray = c;
    fg.style.strokeDashoffset = String(c * (1 - Math.max(0, Math.min(1, frac || 0))));
  }

  // The top three on steps, shown when the quiz ends.
  function podium(s) {
    const box = $("podium");
    box.hidden = !s.over;
    if (!s.over) return;
    box.innerHTML = "";
    const top = s.board.slice(0, 3);
    [1, 0, 2].forEach(k => {
      const r = top[k];
      if (!r) return;
      const d = document.createElement("div");
      d.className = "step p" + (k + 1);
      const seat = s.seats.findIndex(x => x.id === r.id);
      d.appendChild(AceFX.avatar(r.name, seat, "lg"));
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

  function render(s, api) {
    state = s;
    const phaseChanged = s.phase !== prevPhase || s.index !== prevIndex;
    deadline = Date.now() + (s.remaining || 0) * 1000;
    clearInterval(timer);
    timer = setInterval(tickClock, 200);
    const me = api.me;
    const seated = me.role === "player";

    $("quiz").hidden = !s.started || s.over;            // the podium takes its place at the end
    const ans = $("answers");
    if (s.started) {
      const q = s.question;
      $("qNum").textContent = s.phase === "ready" ? `${s.total} questions` : `Question ${s.index + 1} of ${s.total}`;
      $("qText").textContent = q ? q.q : "Get ready…";
      $("timerBar").parentElement.hidden = s.phase !== "question";
      ans.innerHTML = "";
      if (q) {
        q.answers.forEach((a, i) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `answer a${i}` + (phaseChanged && s.phase === "question" ? " pop-in" : "");
          b.style.setProperty("--d", i * 70 + "ms");
          if (s.myChoice === i) b.classList.add("mine");
          if (s.right != null) b.classList.add(i === s.right ? "right" : "wrong");
          b.disabled = !(s.phase === "question" && seated && s.myChoice == null && !s.over);
          b.innerHTML = `<b>${LETTERS[i]}</b><span></span>${s.counts ? `<small>${s.counts[i]}</small>` : ""}`;
          b.querySelector("span").textContent = a;
          b.addEventListener("click", () => send("answer", { choice: i }));
          ans.appendChild(b);
        });
      }
      const answered = s.board.filter(r => r.answered).length;
      const playing = s.board.filter(r => r.playing && r.online).length;
      let note = "";
      if (s.phase === "question") {
        note = s.myChoice != null ? `Locked in ${LETTERS[s.myChoice]}. ` : "";
        note += `${answered} of ${playing} answered.`;
      } else if (s.phase === "reveal" || s.over) {
        if (s.myChoice == null) note = seated ? "You didn't answer that one." : "";
        else if (s.myChoice === s.right) note = `Right! +${s.myGained} points.`;
        else note = "Not this time.";
      }
      $("qNote").textContent = note;
      $("qNote").className = "q-note" + (s.right != null && s.myChoice === s.right ? " good" : "");
      if (phaseChanged && s.phase === "reveal" && prevPhase === "question") {
        if (s.myChoice === s.right) AceFX.sound("chime");
        else if (s.myChoice != null) AceFX.sound("buzz");
        else AceFX.sound("flip");
      }
      if (phaseChanged && s.phase === "question") AceFX.sound("flip");
    }

    // Leaderboard
    const board = $("board");
    const before = AceFX.snap(board);
    board.innerHTML = "";
    const rows = s.started ? s.board : s.players.filter(p => p.role === "player").map(p => ({ id: p.id, name: p.name, score: 0, online: p.online }));
    if (!rows.length) board.innerHTML = '<li class="muted">Nobody has a seat yet.</li>';
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = (r.id === s.you ? "me " : "") + (r.online === false ? "away " : "") + ((s.winners || []).includes(r.id) ? "winner" : "");
      li.dataset.key = r.id;
      li.innerHTML = `<span class="rank">${i + 1}</span><span class="who"></span><small class="gain"></small><span class="pts"></span>`;
      const seat = s.seats.findIndex(x => x.id === r.id);
      li.insertBefore(AceFX.avatar(r.name, seat >= 0 ? seat : 8, "sm"), li.querySelector(".who"));
      li.querySelector(".who").textContent = r.name + (r.streak >= 3 ? `  🔥${r.streak}` : "");
      li.querySelector(".gain").textContent = r.gained ? `+${r.gained}` : "";
      const was = shownScores[r.id] ?? r.score;
      if (was !== r.score) AceFX.countUp(li.querySelector(".pts"), was, r.score);
      else li.querySelector(".pts").textContent = r.score;
      shownScores[r.id] = r.score;
      if (s.phase === "question" && r.answered) li.classList.add("answered");
      board.appendChild(li);
    });
    AceFX.slide(board, before);
    if (!s.started) shownScores = {};
    podium(s);
    prevPhase = s.phase;
    prevIndex = s.index;

    if (!s.started) {
      api.status("Lobby", "Answer fast: 500 points for a right answer, up to 500 more for speed.");
      api.hint(seated ? "You've got a seat. Waiting for the quiz to start." : "Take a seat in the Players panel to play.");
    } else if (s.over) {
      api.status("Final scores", s.result, "win");
      api.hint(s.isHost ? "Press Play again for another round." : "Waiting for the leader to start another round.");
    } else if (s.phase === "question") {
      api.status(`Question ${s.index + 1}`, `${s.limit} seconds`, "go");
      api.hint(!seated ? "You're watching. Take a seat to join in; you'll start on 0 points."
        : s.myChoice == null ? "Pick an answer before time runs out." : "Answer locked in. Waiting for the others…", s.myChoice == null && seated ? "go" : "");
    } else {
      api.status(s.phase === "ready" ? "Get ready" : `Answer: ${LETTERS[s.right] ?? ""}`, s.phase === "ready" ? "First question coming up." : "");
      api.hint(seated ? "" : "You're watching. Take a seat to join in.");
    }
    tickClock();
  }

  AceRoom.start({
    game: "trivia",
    title: "Clan Trivia",
    blurb: "Quick-fire multiple-choice questions. Be right, be fast, top the leaderboard.",
    players: "Any number of players; late arrivals can jump in mid-quiz.",
    canSkip: true,
    options: [
      { key: "pack", label: "Question categories (tick as many as you like)", choices: packChoices, multi: true },
      { key: "count", label: "How many", choices: [["10", "10 questions"], ["5", "5 questions"], ["15", "15 questions"], ["20", "20 questions"], ["30", "30 questions"]] },
      { key: "time", label: "Time limit", choices: [["20", "20 seconds each"], ["10", "10 seconds each"], ["15", "15 seconds each"], ["30", "30 seconds each"]] },
    ],
    iWon: s => (s.winners || []).includes(s.you),
    seatTag: (i, s) => {
      if (!s.board) return "";
      const id = s.seats[i] && s.seats[i].id;
      const r = s.board.find(x => x.id === id);
      return r ? `${r.score} pts` : "";
    },
    rules: `<ol>
      <li>Each question has up to four answers and a timer. Tap the one you think is right; you can't change it.</li>
      <li>A right answer scores 500 points, plus up to 500 more the faster you answer. Wrong or no answer scores 0.</li>
      <li>When time runs out, or everyone has answered, the right answer is shown and the next question follows.</li>
      <li>Most points after the last question wins. You can join mid-quiz from the Players panel.</li>
    </ol>
    <p class="muted small">The leader picks the categories (any mix), the number of questions and the time limit. Add your own clan questions to <code>trivia/questions.js</code>.</p>`,
    render(s, api) {
      send = api.send;
      render(s, api);
    },
  });
})();
