// Map Pin: the daily "where is it?" game. Two runs a day, VALORANT and League, five rounds each.
// You're given a place (a VALORANT callout like "A Main" on Ascent, or a Summoner's Rift landmark like
// "Red side Gromp"), tap where you think it is on the minimap, and score up to 1000 points by how close you are.
// VALORANT maps and callouts (with their positions) come from valorant-api.com. Summoner's Rift is the
// current minimap from Riot's Data Dragon, with landmark positions worked out from in-game coordinates below.
(async () => {
  "use strict";
  const $ = id => document.getElementById(id);
  const FX = window.AceFX || { sound() {}, confetti() {}, soundButton() {} };
  const DD = "https://ddragon.leagueoflegends.com";
  const ROUNDS = 5;
  FX.soundButton?.();

  const DAY = await AceDay.today();
  $("dayNo").textContent = "#" + DAY;
  const getJSON = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); };

  // ---- Summoner's Rift ------------------------------------------------------------------------
  // In-game coordinates (blue side is the bottom-left team). The minimap is drawn a little simpler than
  // the real map, so turrets are moved onto its lane lines.
  const toMap = (x, y) => [7.0e-5 * x - 0.02, 1.02 - 7.0e-5 * y];
  const lane = (side, which, [u, v]) => {
    if (which === "mid") { const d = (u + v - 1) / 2; return [u - d, v - d]; }
    if (which === "top") return side === "Blue" ? [0.084, v] : [u, 0.071];
    return side === "Blue" ? [u, 0.925] : [0.92, v];
  };
  function riftPlaces() {
    const out = [
      { name: "the Baron pit", at: toMap(5007, 10471) },
      { name: "the Dragon pit", at: toMap(9866, 4414) },
      { name: "the top-side Scuttle Crab", at: toMap(4400, 9600) },
      { name: "the bot-side Scuttle Crab", at: toMap(10500, 5170) },
      { name: "Blue side's fountain", at: [0.044, 0.953] },
      { name: "Red side's fountain", at: [0.953, 0.04] },
      { name: "Blue side's Nexus", at: toMap(1551, 1659) },
      { name: "Red side's Nexus", at: toMap(13204, 13230) },
    ];
    const camps = {
      Blue: { "Blue Sentinel (blue buff)": [3821, 8101], Gromp: [2288, 8448], "Murk Wolves": [3780, 6443], Raptors: [6943, 5422],
              "Red Brambleback (red buff)": [7765, 4020], Krugs: [8482, 2705] },
      Red: { "Blue Sentinel (blue buff)": [11032, 6990], Gromp: [12703, 6443], "Murk Wolves": [11008, 8387], Raptors: [7852, 9471],
             "Red Brambleback (red buff)": [7101, 10900], Krugs: [6317, 12146] },
    };
    const turrets = {
      Blue: { top: [[981, 10441], [1512, 6699], [1169, 4287]], mid: [[5846, 6396], [5048, 4812], [3651, 3696]], bot: [[10504, 1029], [6919, 1483], [4281, 1253]] },
      Red: { top: [[4318, 13875], [7943, 13411], [10481, 13650]], mid: [[8955, 8510], [9767, 10113], [11134, 11207]], bot: [[13866, 4505], [13327, 8226], [13624, 10572]] },
    };
    for (const side of ["Blue", "Red"]) {
      for (const [camp, xy] of Object.entries(camps[side])) out.push({ name: `${side} side's ${camp}`, at: toMap(...xy) });
      for (const [which, list] of Object.entries(turrets[side])) {
        ["outer", "inner", "inhibitor"].forEach((tier, i) =>
          out.push({ name: `${side} side's ${which} lane ${tier} turret`, at: lane(side, which, toMap(...list[i])) }));
      }
    }
    return out;
  }

  // ---- Rounds for today ------------------------------------------------------------------------
  async function valorantRounds() {
    const maps = (await getJSON("https://valorant-api.com/v1/maps")).data
      .filter(m => m.tacticalDescription && m.displayIcon && m.callouts?.length >= 8 && m.xMultiplier)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    const r = AceDay.rng(DAY, 31);
    const order = AceDay.shuffle(maps, r);
    const rounds = [];
    for (let i = 0; i < ROUNDS; i++) {
      const m = order[i % order.length];
      const seen = new Set();
      const callouts = m.callouts.filter(c => { const k = c.superRegionName + c.regionName; return !seen.has(k) && seen.add(k); });
      const c = callouts[Math.floor(r() * callouts.length)];
      const where = ["A", "B", "C", "Mid"].includes(c.superRegionName) ? `${c.superRegionName} ${c.regionName}` : `${c.regionName} (${c.superRegionName})`;
      rounds.push({ place: where, map: m.displayName, img: m.displayIcon,
                    at: [c.location.y * m.xMultiplier + m.xScalarToAdd, c.location.x * m.yMultiplier + m.yScalarToAdd] });
    }
    return rounds;
  }
  async function leagueRounds() {
    const ver = (await getJSON(`${DD}/api/versions.json`))[0];
    const r = AceDay.rng(DAY, 32);
    return AceDay.shuffle(riftPlaces(), r).slice(0, ROUNDS)
      .map(p => ({ place: p.name, map: "Summoner's Rift", img: `${DD}/cdn/${ver}/img/map/map11.png`, at: p.at }));
  }

  // Up to 1000 points: full marks within about 1% of the map, nothing past 35%.
  const points = d => d <= 0.012 ? 1000 : Math.round(1000 * Math.max(0, 1 - d / 0.35) ** 2);

  // ---- Playing ------------------------------------------------------------------------------------
  const TRACKS = {
    valorant: { label: "VALORANT", load: valorantRounds },
    league: { label: "League", load: leagueRounds },
  };
  const saves = {};
  for (const k of Object.keys(TRACKS)) saves[k] = AceDay.store.get(`mappin-${k}-day-${DAY}`, { pins: [] });
  const persist = k => AceDay.store.set(`mappin-${k}-day-${DAY}`, saves[k]);
  let track = AceDay.store.get("mappin-track", "valorant");
  if (!TRACKS[track]) track = "valorant";
  const rounds = {};
  let pin = null;                       // where you've tapped this round, before locking in

  const total = k => saves[k].pins.reduce((a, p) => a + p.points, 0);
  const done = k => rounds[k] && saves[k].pins.length >= rounds[k].length;

  function tabs() {
    $("tabs").innerHTML = Object.entries(TRACKS).map(([k, t]) =>
      `<button type="button" role="tab" data-k="${k}" aria-selected="${k === track}" class="${k === track ? "on" : ""}">${t.label}<small>${saves[k].pins.length ? `${total(k)} pts` : ""}${done(k) ? " ✓" : ""}</small></button>`).join("");
    $("tabs").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      track = b.dataset.k;
      AceDay.store.set("mappin-track", track);
      pin = null;
      show();
    }));
  }

  async function show() {
    tabs();
    if (!rounds[track]) {
      $("play").innerHTML = `<p class="muted">Loading the maps…</p>`;
      try { rounds[track] = await TRACKS[track].load(); }
      catch { $("play").innerHTML = `<p class="muted">Couldn't load the maps. Try again in a minute.</p>`; return; }
      if (AceDay.LOCAL) window.mappinAnswer = rounds;             // for testing on this PC
      tabs();
    }
    const list = rounds[track], save = saves[track];
    if (done(track)) return finish();
    const i = save.pins.length, rd = list[i];
    $("play").innerHTML = `
      <div class="round-head"><span class="muted">Round ${i + 1} of ${list.length}</span><b>${total(track)} pts</b></div>
      <h2 class="ask">Where's <span class="place"></span>${rd.map === "Summoner's Rift" ? "" : ` on <span class="mapname"></span>`}?</h2>
      <div class="map" id="map"><img alt="" draggable="false"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"></svg></div>
      <div class="actions"><button id="lock" class="btn primary" type="button" disabled>Lock in</button><span id="note" class="muted small" aria-live="polite">Tap the map to drop your pin.</span></div>`;
    $("play").querySelector(".place").textContent = rd.place;
    $("play").querySelector(".mapname")?.replaceChildren(rd.map);
    const map = $("map"), img = map.querySelector("img"), svg = map.querySelector("svg");
    img.src = rd.img;
    map.classList.toggle("rift", rd.map === "Summoner's Rift");
    const drawPin = () => {
      svg.innerHTML = pin ? `<circle cx="${pin[0] * 1000}" cy="${pin[1] * 1000}" r="17" class="mine"/>` : "";
      $("lock").disabled = !pin;
    };
    map.addEventListener("pointerdown", e => {
      if (map.dataset.locked) return;
      const r = map.getBoundingClientRect();
      pin = [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
      FX.sound("flick");
      drawPin();
    });
    $("lock").addEventListener("click", () => {
      if (!pin || map.dataset.locked) return;
      map.dataset.locked = "1";
      const d = Math.hypot(pin[0] - rd.at[0], pin[1] - rd.at[1]), pts = points(d);
      save.pins.push({ at: pin, points: pts });
      persist(track);
      svg.innerHTML = `<line x1="${pin[0] * 1000}" y1="${pin[1] * 1000}" x2="${rd.at[0] * 1000}" y2="${rd.at[1] * 1000}" class="gap"/>
        <circle cx="${pin[0] * 1000}" cy="${pin[1] * 1000}" r="17" class="mine"/>
        <circle cx="${rd.at[0] * 1000}" cy="${rd.at[1] * 1000}" r="22" class="answer"/>`;
      FX.sound(pts >= 700 ? "chime" : pts >= 300 ? "ding" : "buzz");
      $("note").textContent = pts === 1000 ? "Bang on! +1000" : pts ? `+${pts} (${Math.round(d * 100)}% of the map away)` : "Too far away for points.";
      $("note").className = "small " + (pts >= 700 ? "good" : pts ? "" : "bad");
      $("lock").textContent = save.pins.length >= list.length ? "See results" : "Next";
      $("lock").disabled = false;
      $("lock").onclick = () => { pin = null; show(); };
      $("play").querySelector(".round-head b").textContent = `${total(track)} pts`;
      tabs();
    }, { once: true });
    drawPin();
  }

  const pinMark = pts => pts >= 900 ? "🎯" : pts >= 500 ? "🟢" : pts ? "🟡" : "⚫";
  function shareText() {
    const line = k => saves[k].pins.length ? `${TRACKS[k].label} ${total(k)}/${ROUNDS * 1000} ${saves[k].pins.map(p => pinMark(p.points)).join("")}` : null;
    return [`ACE Map Pin #${DAY}`, ...Object.keys(TRACKS).map(line).filter(Boolean), "https://games.aceclan.lol/mappin/"].join("\n");
  }

  function finish() {
    const list = rounds[track], save = saves[track], other = Object.keys(TRACKS).find(k => k !== track);
    $("play").innerHTML = `
      <div class="end">
        <h2>${total(track)} <small>/ ${list.length * 1000}</small></h2>
        <ol class="results">${list.map((rd, i) => `<li><span></span><b>${save.pins[i].points}</b></li>`).join("")}</ol>
        <div class="row">
          ${done(other) ? "" : `<button id="other" class="btn primary" type="button">Play ${TRACKS[other].label}</button>`}
          <button id="share" class="btn${done(other) ? " primary" : ""}" type="button">Copy result</button>
        </div>
        <p id="shareNote" class="muted small" aria-live="polite"></p>
        <div id="board"></div>
        <p class="muted small">New maps in <b>${AceDay.untilNext()}</b>. Try <a href="../acedle/">ACEdle</a> or <a href="../squads/">Squads</a> too.</p>
      </div>`;
    $("play").querySelectorAll(".results span").forEach((s, i) => { s.textContent = list[i].map === "Summoner's Rift" ? list[i].place : `${list[i].place} · ${list[i].map}`; });
    // Clan leaderboard: VALORANT and League each have their own.
    window.AceBoard?.mount($("board"), {
      game: `mappin-${track}`, day: DAY, title: `${TRACKS[track].label} leaderboard`,
      run: { pins: save.pins.map(p => p.points) },
      today: [{ head: "Pins", cls: "dots", cell: r => r.detail.pins.map(pinMark).join("") }, { head: "Points", cls: "p", cell: r => r.points }],
      how: `All time adds up your ${TRACKS[track].label} points from every day.`,
    });
    $("other")?.addEventListener("click", () => { track = other; AceDay.store.set("mappin-track", track); show(); });
    $("share").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(shareText()); $("shareNote").textContent = "Copied. Paste it in Discord."; }
      catch { $("shareNote").textContent = shareText(); }
    });
  }

  show();
})();
