// Town of ACE, online. The server (server/games/town.py) deals the secret roles, runs the night and the
// trials, and sends each player only what they're allowed to know: their own role and notebook, the
// other wolves (if they're a wolf), and the public story of the town.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const TEAM_NAMES = { town: "Town", wolves: "Wolves", neutral: "On their own" };
  const PHASES = {
    night: ["Night", "The town sleeps. Night powers are being used."],
    dawn: ["Dawn", "The sun comes up on the town."],
    day: ["Day", "Talk it out, then vote someone onto trial."],
    defence: ["Trial", "The accused has a moment to defend themselves."],
    judgement: ["Judgement", "Guilty or innocent?"],
    verdict: ["Verdict", ""],
    hunter: ["Last shot", "A Hunter has fallen and raises their bow."],
    done: ["Game over", ""],
  };
  const ING = { Check: "Checking", Protect: "Protecting", Watch: "Watching", Stun: "Stunning", Kill: "Killing" };
  const MOON = `<svg viewBox="0 0 40 40"><path d="M27 6a15 15 0 1 0 7 22A13 13 0 0 1 27 6z" fill="#c9d4ff"/><circle cx="31" cy="9" r="1.4" fill="#fff"/><circle cx="36" cy="17" r="1" fill="#fff"/></svg>`;
  const SUN = `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="8" fill="#ffc53d"/><g stroke="#ffc53d" stroke-width="3" stroke-linecap="round"><path d="M20 3v5M20 32v5M3 20h5M32 20h5M8 8l3.5 3.5M28.5 28.5L32 32M8 32l3.5-3.5M28.5 11.5L32 8"/></g></svg>`;
  const SCALES = `<svg viewBox="0 0 40 40"><g fill="none" stroke="#ff4655" stroke-width="2.6" stroke-linecap="round"><path d="M20 5v29M10 34h20M7 11h26"/><path d="M7 11l-5 11h10zM33 11l-5 11h10z"/></g></svg>`;

  let send = null, state = null, api = null;
  let deadline = 0, timer = 0, lastSecond = null, prevPhase = null, chatKey = "", tab = null, hideRole = false;
  let willDirty = false, willTimer = 0, notesKey = "";

  const name = (s, seat) => (s.people[seat] || {}).name || "Someone";
  const roleName = (s, id) => (id && s.roleNames[id]) || "";
  const mySeat = s => s.mySeat;

  // ---- Clock --------------------------------------------------------------------------------
  function tickClock() {
    const s = state;
    if (!s || !s.started || s.over) { $("twClock").textContent = ""; return; }
    const left = Math.max(0, (deadline - Date.now()) / 1000), sec = Math.ceil(left);
    const m = Math.floor(sec / 60), r = sec % 60;
    $("twClock").textContent = m ? `${m}:${String(r).padStart(2, "0")}` : String(sec);
    $("twClock").classList.toggle("low", left < 10);
    if (left < 6 && left > 0 && sec !== lastSecond && ["night", "judgement", "hunter"].includes(s.phase)) AceFX.sound("tick");
    lastSecond = sec;
  }

  // ---- Page ---------------------------------------------------------------------------------
  function render(s) {
    state = s;
    deadline = Date.now() + (s.remaining || 0) * 1000;
    clearInterval(timer);
    timer = setInterval(tickClock, 250);
    const on = s.started && s.phase && s.phase !== "";
    $("town").hidden = !on;
    document.body.classList.toggle("is-night", on && !s.over && s.phase === "night");
    document.body.classList.toggle("tw-live", on && !s.over);
    document.body.classList.toggle("is-trial", on && !s.over && ["defence", "judgement", "verdict"].includes(s.phase));
    $("twEnd").hidden = !(s.over && s.people);
    $("twSetup").hidden = !(on && s.setup && s.setup.length);
    if (s.setup) $("twSetupText").textContent = s.setup.map(([n, c]) => c > 1 ? `${c} × ${n}` : n).join(", ");

    if (!on) {
      api.status("Lobby", "Secret roles, night kills and day trials.");
      api.hint(api.me.role === "player" ? "You've got a seat. Waiting for the leader to start (4 to 16 players)." : "Take a seat in the Players panel to play.");
      prevPhase = null;
      return;
    }
    head(s);
    roleCard(s);
    trial(s);
    actions(s);
    grid(s);
    chat(s);
    notes(s);
    will(s);
    if (s.over) endList(s);
    sounds(s);
    status(s);
    prevPhase = s.phase;
    tickClock();
  }

  function head(s) {
    const [title, sub] = PHASES[s.over ? "done" : s.phase] || ["", ""];
    const n = ["night", "dawn", "day", "defence", "judgement", "verdict"].includes(s.phase) ? ` ${s.day}` : "";
    $("town").querySelector(".tw-head").hidden = !!s.over;
    $("twPhase").textContent = title + (s.over ? "" : n);
    let text = s.over ? s.result : sub;
    if (s.phase === "night" && !s.nightKill) text = "First night: no kills tonight, but powers still work.";
    if (s.phase === "day") text = `${s.need} vote${s.need === 1 ? "" : "s"} put someone on trial. Trial ${Math.min(s.trials + 1, s.maxTrials)} of ${s.maxTrials} today.`;
    if (s.phase === "defence" || s.phase === "judgement") text = `${name(s, s.accused)} is on trial. ` + sub;
    if (s.phase === "hunter" && s.hunter != null) text = `${name(s, s.hunter)} was the Hunter and gets one last shot.`;
    $("twSub").textContent = text;
    const nightish = s.phase === "night";
    const trialish = ["defence", "judgement", "verdict"].includes(s.phase);
    $("twIcon").innerHTML = trialish ? SCALES : nightish ? MOON : SUN;
    $("town").className = "town ph-" + (s.over ? "done" : s.phase);
  }

  function roleCard(s) {
    const r = s.role, box = $("twRole");
    box.hidden = !r;
    if (!r) return;
    box.className = "tw-role team-" + r.team + (hideRole ? " hidden-role" : "") + (s.alive ? "" : " dead");
    $("twRoleName").textContent = r.name + (s.alive || s.over ? "" : " (dead)");
    $("twTeam").textContent = TEAM_NAMES[r.team];
    $("twAbout").textContent = r.about;
    $("twGoal").textContent = "Goal: " + r.goal;
    $("twRoleToggle").textContent = hideRole ? "Show my role" : "Hide my role";
    const pack = (s.pack || []).filter(p => p.seat !== mySeat(s));
    $("twPack").hidden = !pack.length;
    $("twPack").textContent = pack.length ? "Your pack: " + pack.map(p => name(s, p.seat) + (s.people[p.seat].alive ? "" : " (dead)")).join(", ") : "";
  }
  $("twRoleToggle").addEventListener("click", () => { hideRole = !hideRole; if (state) roleCard(state); });

  function trial(s) {
    const box = $("twTrial");
    const show = ["defence", "judgement", "verdict"].includes(s.phase) && s.accused != null && !s.over;
    box.hidden = !show;
    if (!show) return;
    box.innerHTML = "";
    const who = document.createElement("div");
    who.className = "tw-accused";
    who.appendChild(AceFX.avatar(name(s, s.accused), s.accused, "lg"));
    const t = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = name(s, s.accused);
    const sm = document.createElement("small");
    sm.textContent = s.phase === "defence" ? "is making their defence" : s.phase === "judgement" ? "is waiting on your verdict" : "";
    t.append(b, sm);
    who.appendChild(t);
    box.appendChild(who);
    if (s.phase === "judgement") {
      const meAccused = mySeat(s) === s.accused;
      const row = document.createElement("div");
      row.className = "tw-judge";
      if (s.alive && !meAccused) {
        [["guilty", "Guilty"], ["innocent", "Innocent"]].forEach(([v, label]) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn " + v + (s.myJudge === v ? " on" : "");
          btn.textContent = label;
          btn.addEventListener("click", () => send("judge", { vote: s.myJudge === v ? null : v }));
          row.appendChild(btn);
        });
      } else {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = meAccused ? "The town is deciding your fate…" : "The living are voting.";
        row.appendChild(p);
      }
      const c = document.createElement("small");
      c.className = "muted";
      c.textContent = `${s.judged} voted so far. Votes are shown after the verdict.`;
      row.appendChild(c);
      box.appendChild(row);
    }
    if (s.phase === "verdict" && s.lastJudge) {
      const j = s.lastJudge;
      const v = document.createElement("div");
      v.className = "tw-verdict " + (j.dead ? "guilty" : "innocent");
      const big = document.createElement("b");
      big.textContent = j.dead ? `Guilty, ${j.guilty} to ${j.innocent}` : `Innocent, ${j.innocent} to ${j.guilty}`;
      const g = document.createElement("small");
      g.textContent = `Guilty: ${j.g.join(", ") || "nobody"} · Innocent: ${j.i.join(", ") || "nobody"}`;
      v.append(big, g);
      box.appendChild(v);
    }
  }

  function actions(s) {
    const box = $("twActions");
    box.innerHTML = "";
    const add = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + cls;
      b.textContent = label;
      b.addEventListener("click", fn);
      box.appendChild(b);
    };
    if (!s.over && s.alive && s.phase === "day") {
      add(s.myVote === "skip" ? `Voted to skip (${s.skipVotes})` : `Skip the day (${s.skipVotes})`, s.myVote === "skip" ? "on" : "",
          () => send("vote", { target: s.myVote === "skip" ? null : "skip" }));
    }
    if (!s.over && s.alive && s.role && s.role.id === "mayor" && s.mayorSeat !== mySeat(s) && ["day", "defence", "judgement"].includes(s.phase)) {
      add("Reveal I'm the Mayor", "gold", () => send("reveal"));
    }
    box.hidden = !box.childElementCount;
  }

  function grid(s) {
    const box = $("twGrid");
    const before = AceFX.snap(box);
    box.innerHTML = "";
    const me = mySeat(s);
    const wolfPicks = {};
    (s.pack || []).forEach(p => { if (p.pick != null) (wolfPicks[p.pick] = wolfPicks[p.pick] || []).push(p.seat); });
    s.people.forEach(p => {
      const li = document.createElement("li");
      const team = p.role ? s.roleTeams[p.role] : "";
      li.className = "tw-card" + (p.alive ? "" : " dead") + (p.seat === me ? " me" : "") + (p.online ? "" : " away") +
        (team ? " team-" + team : "") + (s.accused === p.seat && !s.over ? " accused" : "") +
        (s.lastNight.includes(p.seat) ? " fresh" : "");
      li.dataset.key = p.seat;
      li.appendChild(AceFX.avatar(p.name, p.seat, "md"));
      const info = document.createElement("div");
      info.className = "tw-info";
      const nm = document.createElement("b");
      nm.textContent = p.name;
      info.appendChild(nm);
      const tags = document.createElement("small");
      const bits = [];
      if (p.seat === me) bits.push("You");
      if (p.mayor) bits.push("👑 Mayor");
      if (p.role && !(p.mayor && p.role === "mayor")) bits.push(roleName(s, p.role));
      if (!p.alive) bits.push(p.death ? `☠ ${p.death.how}, day ${p.death.day}` : "☠ dead");
      if (p.bot) bits.push("bot");
      if (!p.online) bits.push("away");
      tags.textContent = bits.join(" · ");
      info.appendChild(tags);
      if (s.phase === "day" && p.voteFor != null && p.alive) {
        const v = document.createElement("small");
        v.className = "tw-votefor";
        v.textContent = p.voteFor === "skip" ? "→ skip" : "→ " + name(s, p.voteFor);
        info.appendChild(v);
      }
      if (wolfPicks[p.seat]) {
        const w = document.createElement("small");
        w.className = "tw-wolfpick";
        w.textContent = "🐺 " + wolfPicks[p.seat].map(x => name(s, x)).join(", ");
        info.appendChild(w);
      }
      li.appendChild(info);
      if (s.phase === "day" && p.votes) {
        const c = document.createElement("span");
        c.className = "tw-count";
        c.textContent = p.votes;
        c.title = `${p.votes} of ${s.need} votes`;
        li.appendChild(c);
      }
      const btn = cardButton(s, p);
      if (btn) li.appendChild(btn);
      if (!p.alive && p.will) {
        const d = document.createElement("details");
        d.className = "tw-will";
        const sum = document.createElement("summary");
        sum.textContent = "Last will";
        const q = document.createElement("p");
        q.textContent = p.will;
        d.append(sum, q);
        li.appendChild(d);
      }
      box.appendChild(li);
    });
    AceFX.slide(box, before);
  }

  function cardButton(s, p) {
    if (s.over) return null;
    const me = mySeat(s);
    const mk = (label, on, fn, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn tw-act " + cls + (on ? " on" : "");
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    if (s.phase === "night" && s.canAct && s.targets.includes(p.seat)) {
      const on = s.myTarget === p.seat;
      return mk(on ? "✓ " + (ING[s.role.verb] || s.role.verb) : s.role.verb, on,
        () => send("act", { target: on ? null : p.seat }), s.role.act === "kill" ? "kill" : "");
    }
    if (s.phase === "day" && s.alive && p.alive && p.seat !== me) {
      const on = s.myVote === p.seat;
      return mk(on ? "Voted" : "Vote", on, () => send("vote", { target: on ? null : p.seat }));
    }
    if (s.phase === "hunter" && s.hunter === me && p.alive) {
      return mk("Shoot", false, () => send("hunt", { target: p.seat }), "kill");
    }
    return null;
  }

  // ---- Chat ---------------------------------------------------------------------------------
  const CHAN_LABEL = { town: "Town", wolves: "🐺 Pack", dead: "☠ Graveyard" };
  function defaultTab(s) {
    if (!s.alive && s.chans.includes("dead") && s.mySeat != null) return "dead";
    if (s.phase === "night" && s.myTeam === "wolves" && s.alive) return "wolves";
    return "town";
  }
  function chat(s) {
    const want = defaultTab(s);
    if (!tab || !s.chans.includes(tab) || prevPhase !== s.phase) tab = want;
    const tabs = $("twTabs");
    tabs.innerHTML = "";
    if (s.chans.length > 1) {
      s.chans.forEach(c => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tw-tab" + (c === tab ? " on" : "");
        b.setAttribute("role", "tab");
        b.textContent = CHAN_LABEL[c];
        b.addEventListener("click", () => { tab = c; chatKey = ""; chat(state); });
        tabs.appendChild(b);
      });
    }
    const msgs = s.chat.filter(m => m.ch === tab);
    const key = tab + msgs.length + "|" + (msgs.length ? msgs[msgs.length - 1].text : "");
    if (key !== chatKey) {
      const list = $("twChat");
      const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      const fresh = chatKey !== "" && chatKey.startsWith(tab);
      chatKey = key;
      list.innerHTML = "";
      msgs.forEach(m => {
        const li = document.createElement("li");
        li.className = "m-" + m.kind;
        if (m.name) { const b = document.createElement("b"); b.textContent = m.name + ": "; li.appendChild(b); }
        li.appendChild(document.createTextNode(m.text));
        list.appendChild(li);
      });
      if (atEnd || !fresh) list.scrollTop = list.scrollHeight;
    }
    // Who can talk where right now
    const input = $("twText");
    let can = false, ph = "Say something…";
    if (s.mySeat == null) ph = "You're watching.";
    else if (s.over) { can = true; ph = "Good game…"; }
    else if (!s.alive) { can = tab === "dead"; ph = can ? "Talk to the other dead…" : "The dead can only talk in the Graveyard."; }
    else if (tab === "wolves") { can = s.phase === "night"; ph = can ? "Whisper to your pack…" : "The pack only talks at night."; }
    else if (tab === "town") { can = s.phase !== "night"; ph = can ? "Say something to the town…" : "Shh, the town is asleep."; }
    input.disabled = !can;
    input.placeholder = ph;
  }
  $("twForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("twText").value.trim();
    if (!text || !send) return;
    send("chat", { text, ch: tab });
    $("twText").value = "";
  });

  function notes(s) {
    const list = $("twNotes");
    const key = s.notes.length + "|" + (s.notes.length ? s.notes[s.notes.length - 1].text : "");
    if (key === notesKey) return;
    notesKey = key;
    list.innerHTML = "";
    if (!s.notes.length) list.innerHTML = '<li class="muted">Nothing yet.</li>';
    [...s.notes].reverse().forEach(n => {
      const li = document.createElement("li");
      li.className = "n-" + (n.kind || "plain");
      const d = document.createElement("small");
      d.textContent = `Day ${n.day}`;
      li.append(d, document.createTextNode(" " + n.text));
      list.appendChild(li);
    });
  }

  function will(s) {
    const box = $("twWill");
    const can = s.mySeat != null && s.alive && !s.over;
    box.disabled = !can;
    if (!willDirty && document.activeElement !== box) box.value = s.will || "";
    $("twWillNote").textContent = s.mySeat == null ? "" : !s.alive ? "Your will has been read." :
      "Write down what you found out. If you die, everyone gets to read it.";
  }
  $("twWill").addEventListener("input", () => {
    willDirty = true;
    clearTimeout(willTimer);
    willTimer = setTimeout(() => { send && send("will", { text: $("twWill").value }); willDirty = false; }, 700);
  });

  function endList(s) {
    const list = $("twEndList");
    list.innerHTML = "";
    s.people.forEach(p => {
      const li = document.createElement("li");
      const team = s.roleTeams[p.role] || "";
      li.className = "team-" + team + (p.alive ? "" : " dead");
      li.appendChild(AceFX.avatar(p.name, p.seat, "sm"));
      const b = document.createElement("b");
      b.textContent = p.name;
      const r = document.createElement("span");
      r.textContent = roleName(s, p.role) + (p.alive ? "" : " ☠");
      li.append(b, r);
      list.appendChild(li);
    });
  }

  function sounds(s) {
    if (prevPhase === s.phase || prevPhase === null) return;
    if (s.over) return;
    if (s.phase === "night") AceFX.sound("slide");
    else if (s.phase === "dawn") AceFX.sound(s.lastNight.length ? "lose" : "chime");
    else if (s.phase === "defence") AceFX.sound("buzz");
    else if (s.phase === "verdict") AceFX.sound(s.lastJudge && s.lastJudge.dead ? "lose" : "chime");
    else if (s.phase === "day") AceFX.sound("flip");
  }

  function status(s) {
    const me = mySeat(s);
    if (s.over) {
      api.status("Game over", s.result, "win");
      api.hint(s.isHost ? "Press Play again for a new game with new roles." : "Waiting for the leader to start another game.");
      return;
    }
    const [title] = PHASES[s.phase] || [""];
    const cls = s.phase === "night" ? "go" : ["defence", "judgement", "hunter"].includes(s.phase) ? "bad" : "";
    api.status(`${title}${["hunter"].includes(s.phase) ? "" : " " + s.day}`, $("twSub").textContent, cls);
    let hint = "";
    if (me == null) hint = "You're watching. Roles stay secret until the end.";
    else if (!s.alive && s.phase !== "hunter") hint = "You're dead. Chat with the others in the Graveyard.";
    else if (s.phase === "night") {
      if (s.canAct) hint = s.myTarget == null ? `Pick someone to ${s.role.verb.toLowerCase()} tonight.` : `You picked ${name(s, s.myTarget)}. You can change your mind until morning.`;
      else hint = "You've got nothing to do at night. Sleep tight…";
    } else if (s.phase === "day") hint = s.myVote == null ? "Vote for someone to put them on trial, or vote to skip the day." : "You can change your vote any time.";
    else if (s.phase === "defence") hint = me === s.accused ? "You're on trial! Make your case in the chat." : "Listen to their defence.";
    else if (s.phase === "judgement") hint = me === s.accused ? "The town is voting on you." : s.myJudge ? `You voted ${s.myJudge}.` : "Vote guilty or innocent.";
    else if (s.phase === "hunter") hint = s.hunter === me ? "Pick someone to shoot, or let the clock run out to hold your fire." : "";
    api.hint(hint, (s.canAct && s.myTarget == null) || s.hunter === me ? "go" : "");
  }

  AceRoom.start({
    game: "town",
    title: "Town of ACE",
    blurb: "Secret roles, night kills and day trials. Find the wolves hiding in the town before they take it over.",
    players: "4 to 16 players. Bots can fill seats.",
    canSkip: true,
    options: [
      { key: "extras", label: "Extra roles (tick the ones you want; they're added when there are enough players)", multi: true,
        choices: [["hunter", "Hunter"], ["jester", "Jester"], ["lookout", "Lookout"], ["stunner", "Stunner"], ["mayor", "Mayor"], ["alpha", "Alpha Wolf"]] },
      { key: "wolves", label: "Wolves", choices: [["auto", "Wolves: about 1 in 4"], ["1", "1 wolf"], ["2", "2 wolves"], ["3", "3 wolves"], ["4", "4 wolves"]] },
      { key: "day", label: "Day length", choices: [["120", "2 minute days"], ["90", "90 second days"], ["180", "3 minute days"], ["300", "5 minute days"], ["60", "1 minute days"]] },
      { key: "night", label: "Night length", choices: [["40", "40 second nights"], ["30", "30 second nights"], ["60", "1 minute nights"]] },
      { key: "reveal", label: "When someone dies", choices: [["yes", "Show roles when people die"], ["no", "Keep roles hidden until the end"]] },
      { key: "deadsee", label: "The dead", choices: [["no", "The dead see nothing extra"], ["yes", "The dead see everyone's role"]] },
      { key: "firstkill", label: "First night", choices: [["yes", "Wolves kill on night 1"], ["no", "No kill on night 1"]] },
    ],
    myTurn: s => !!(s.started && !s.over && ((s.canAct && s.myTarget == null) || (s.phase === "hunter" && s.hunter === s.mySeat))),
    iWon: s => s.winner === "jester" ? !!(s.role && s.role.id === "jester") : !!(s.myTeam && s.myTeam === s.winner),
    seatTag: (i, s) => {
      const p = (s.people || [])[i];
      return p && !p.alive ? "☠" : "";
    },
    rules: `<ol>
      <li>Everyone gets a secret role. Most are the <b>town</b>; a few are <b>wolves</b>, who know each other.</li>
      <li><b>Night:</b> the wolves pick someone to kill. Town roles with a power use it: the Seer checks someone, the Healer protects someone, and so on. Your results land in your notebook.</li>
      <li><b>Day:</b> everyone talks. Vote for someone to put them on trial (a majority of the living is needed), or vote to skip the day.</li>
      <li><b>Trial:</b> the accused gets a defence, then the living vote guilty or innocent. Guilty wins: they're executed. Up to 3 trials a day.</li>
      <li>The town wins when every wolf is dead. The wolves win when they match the rest in number. The Jester wins by getting executed.</li>
    </ol>
    <p class="small"><b>Roles:</b> Villager (no power) · Seer (check if someone's a wolf) · Healer (protect someone each night) · Hunter (shoots someone when they die) · Lookout (sees who visits a player) · Stunner (blocks someone's night power) · Mayor (reveal by day for a triple vote) · Werewolf · Alpha Wolf (looks innocent to the Seer) · Jester (wants to be executed).</p>
    <p class="muted small">Write a last will as you go: it's shown to everyone when you die. Dead players chat in the Graveyard.</p>`,
    render(s, a) {
      api = a;
      send = a.send;
      render(s);
    },
  });
})();
