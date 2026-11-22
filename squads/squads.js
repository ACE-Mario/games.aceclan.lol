// Squads: the daily sorting puzzle. 16 tiles, 4 hidden groups of 4. Pick four you think belong
// together; four mistakes and it's over. Everyone gets the same puzzle each day.
// Puzzles come from squads/puzzles.txt when that day has one, otherwise they're built from
// League (Data Dragon, acedle/champions.txt) and VALORANT (valorant-api.com, acedle/agents.txt) data,
// using only tiles that fit just one of that day's groups.
(async () => {
  "use strict";
  const $ = id => document.getElementById(id);
  const FX = window.AceFX || { sound() {}, confetti() {}, soundButton() {} };
  const DD = "https://ddragon.leagueoflegends.com";
  const COLOURS = ["gold", "teal", "purple", "red"];          // easiest to hardest
  const SQUARES = { gold: "🟨", teal: "🟩", purple: "🟪", red: "🟥" };
  const MISTAKES = 4;
  FX.soundButton?.();

  const DAY = await AceDay.today();
  $("dayNo").textContent = "#" + DAY;
  const getJSON = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); };
  const text = u => fetch(u, { cache: "no-cache" }).then(r => r.ok ? r.text() : "").catch(() => "");
  const rows = t => t.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith("#")).map(l => l.split("|").map(s => s.trim()));

  // ---- Groups from the game data ---------------------------------------------------------
  // Each group: name, tier (1 easy .. 4 hard), family (no two groups from the same family in one
  // puzzle unless the family allows it), and members.
  async function dataGroups() {
    const out = [];
    const add = (name, tier, family, members) => { members = [...new Set(members)]; if (members.length >= 4) out.push({ name, tier, family, members }); };
    const jobs = [
      (async () => {
        const ver = (await getJSON(`${DD}/api/versions.json`))[0];
        const [champs, items, list] = await Promise.all([
          getJSON(`${DD}/cdn/${ver}/data/en_US/champion.json`).then(d => Object.values(d.data)),
          getJSON(`${DD}/cdn/${ver}/data/en_US/item.json`).then(d => d.data),
          text("../acedle/champions.txt")]);
        const own = {};
        for (const [name, regions = "", reach = ""] of rows(list)) own[name.toLowerCase()] = { regions: regions.split(",").map(s => s.trim()).filter(Boolean), reach: reach.toLowerCase() };
        const byRegion = {}, byClass = {}, both = [], energy = [], manaless = [];
        for (const c of champs) {
          const o = own[c.name.toLowerCase()] || {};
          for (const r of o.regions || []) (byRegion[r] ||= []).push(c.name);
          (byClass[c.tags[0]] ||= []).push(c.name);
          if (o.reach === "both") both.push(c.name);
          if (c.partype === "Energy") energy.push(c.name);
          if (!c.partype || c.partype === "None") manaless.push(c.name);
        }
        for (const [r, m] of Object.entries(byRegion)) add(`Champions from ${r}`, 2, "region", m);
        const CLASS = { Assassin: "Assassins", Mage: "Mages", Tank: "Tanks", Support: "Supports", Marksman: "Marksmen", Fighter: "Fighters" };
        for (const [k, m] of Object.entries(byClass)) if (CLASS[k]) add(`League ${CLASS[k]} (main class)`, 3, "class", m);
        add("Champions that are melee and ranged", 3, "reach", both);
        add("Champions that use Energy", 3, "resource", energy);
        add("Champions with no mana or resource", 4, "resource", manaless);

        // Finished Summoner's Rift items.
        const finished = Object.entries(items).filter(([id, x]) => +id < 10000 && x.maps?.["11"] && x.gold?.purchasable && !x.into?.length
          && !x.requiredChampion && !x.requiredAlly && x.inStore !== false && !x.hideFromAll && x.gold.total >= 900 && !/^Guardian's /.test(x.name)).map(([, x]) => x);
        const TAGS = { CriticalStrike: ["Items with critical strike", 2], LifeSteal: ["Items with life steal", 3], SpellBlock: ["Items with magic resist", 3],
                       Armor: ["Items with armour", 3], Boots: ["Boots", 1], Mana: ["Items with mana", 3], AttackSpeed: ["Items with attack speed", 2] };
        for (const [tag, [name, tier]] of Object.entries(TAGS)) add(name, tier, "itemtag", finished.filter(x => x.tags?.includes(tag)).map(x => x.name));
      })(),
      (async () => {
        const [agents, list, weapons, maps] = await Promise.all([
          getJSON("https://valorant-api.com/v1/agents?isPlayableCharacter=true").then(d => d.data),
          text("../acedle/agents.txt"),
          getJSON("https://valorant-api.com/v1/weapons").then(d => d.data),
          getJSON("https://valorant-api.com/v1/maps").then(d => d.data)]);
        const byRole = {};
        for (const a of agents) if (a.role) (byRole[a.role.displayName] ||= []).push(a.displayName);
        for (const [r, m] of Object.entries(byRole)) add(`VALORANT ${r}s`, 1, "role", m);
        const byYear = {}, byOrigin = {};
        for (const [name, origin, year] of rows(list)) {
          if (/^\d{4}$/.test(year || "")) (byYear[year] ||= []).push(name);
          if (origin && origin !== "?" && origin !== "Unknown") (byOrigin[origin] ||= []).push(name);
        }
        for (const [y, m] of Object.entries(byYear)) add(`Agents released in ${y}`, 4, "year", m);
        for (const [o, m] of Object.entries(byOrigin)) add(`Agents from ${o}`, 4, "origin", m);
        const TYPE = { Rifle: "Rifles", SMG: "SMGs", Sniper: "Snipers", Shotgun: "Shotguns", Heavy: "Machine guns", Sidearm: "Sidearms" };
        const byType = {};
        for (const w of weapons) if (w.shopData) (byType[w.category.split("::").pop()] ||= []).push(w.displayName);
        for (const [k, m] of Object.entries(byType)) if (TYPE[k]) add(`VALORANT ${TYPE[k]}`, 1, "weapon", m);
        add("VALORANT maps", 1, "map", maps.filter(m => m.tacticalDescription).map(m => m.displayName));
      })(),
    ];
    await Promise.allSettled(jobs);
    return out.sort((a, b) => a.name.localeCompare(b.name));     // the data loads in any order; everyone must start the same
  }

  // Four groups whose chosen tiles each fit only their own group.
  function build(groups) {
    const r = AceDay.rng(DAY, 21);
    const TWICE = new Set(["region", "role", "weapon", "itemtag", "class"]);   // families that can give two groups (good red herrings)
    for (let attempt = 0; attempt < 400; attempt++) {
      const picked = [];
      for (const g of AceDay.shuffle(groups, r)) {
        if (picked.length === 4) break;
        const same = picked.filter(p => p.family === g.family).length;
        if (same >= (TWICE.has(g.family) ? 2 : 1)) continue;
        picked.push(g);
      }
      if (picked.length < 4 || new Set(picked.map(p => p.tier)).size < 2) continue;
      const all = picked.map(g => new Set(g.members));
      const tiles = picked.map((g, i) => g.members.filter(m => all.every((s, j) => j === i || !s.has(m))));
      if (tiles.some(t => t.length < 4)) continue;
      const chosen = tiles.map(t => AceDay.shuffle(t, r).slice(0, 4));
      if (new Set(chosen.flat()).size !== 16) continue;
      return picked.map((g, i) => ({ name: g.name, tier: g.tier, tiles: chosen[i] }))
        .sort((a, b) => a.tier - b.tier).map((g, i) => ({ ...g, colour: COLOURS[i] }));
    }
    return null;
  }

  async function puzzle() {
    // A hand-made one for today?
    const lines = (await text("puzzles.txt")).split(/\r?\n/);
    let on = false;
    const own = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("@")) { on = +line.slice(1) === DAY; continue; }
      if (on) {
        const [name, tiles = ""] = line.split("|").map(s => s.trim());
        const t = tiles.split(",").map(s => s.trim()).filter(Boolean);
        if (name && t.length === 4) own.push({ name, tiles: t });
      }
    }
    if (own.length === 4 && new Set(own.flatMap(g => g.tiles)).size === 16) return own.map((g, i) => ({ ...g, colour: COLOURS[i] }));
    return build(await dataGroups());
  }

  const groups = await puzzle();
  if (AceDay.LOCAL) window.squadsAnswer = groups;                // for testing on this PC
  if (!groups) {
    $("game").innerHTML = `<p class="muted">Couldn't build today's puzzle (the game data didn't load). Try again in a minute.</p>`;
    return;
  }

  // ---- Playing ----------------------------------------------------------------------------
  const SAVE_KEY = "squads-day-" + DAY;
  const save = AceDay.store.get(SAVE_KEY, { solved: [], guesses: [], mistakes: 0, order: null });
  const persist = () => AceDay.store.set(SAVE_KEY, save);
  const groupOf = t => groups.find(g => g.tiles.includes(t));
  const tiles = groups.flatMap(g => g.tiles);
  if (!save.order || save.order.length !== 16 || !save.order.every(t => tiles.includes(t))) {
    Object.assign(save, { solved: [], guesses: [], mistakes: 0, order: AceDay.shuffle(tiles, Math.random) });   // saved from a different puzzle
  }
  let picked = new Set();
  const over = () => save.solved.length === 4 || save.mistakes >= MISTAKES;

  function say(msg, cls = "") {
    $("msg").textContent = msg;
    $("msg").className = "msg " + cls;
  }

  function draw() {
    const solvedBox = $("solved");
    // When the game is lost, show the groups that weren't found too.
    const show = over() ? [...save.solved, ...groups.map(g => g.name).filter(n => !save.solved.includes(n))] : save.solved;
    solvedBox.innerHTML = "";
    for (const name of show) {
      const g = groups.find(x => x.name === name);
      const div = document.createElement("div");
      div.className = `group ${g.colour}` + (save.solved.includes(name) ? "" : " missed");
      div.innerHTML = `<b></b><span></span>`;
      div.querySelector("b").textContent = g.name;
      div.querySelector("span").textContent = g.tiles.join(", ");
      solvedBox.appendChild(div);
    }
    const grid = $("grid");
    grid.innerHTML = "";
    const left = save.order.filter(t => !save.solved.includes(groupOf(t).name));
    if (!over()) {
      for (const t of left) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tile" + (picked.has(t) ? " on" : "") + (t.length > 11 ? " long" : "");
        b.textContent = t;
        b.addEventListener("click", () => {
          if (picked.has(t)) picked.delete(t);
          else if (picked.size < 4) picked.add(t);
          FX.sound("flick");
          draw();
        });
        grid.appendChild(b);
      }
    }
    $("lives").innerHTML = Array.from({ length: MISTAKES }, (_, i) => `<i class="${i < MISTAKES - save.mistakes ? "" : "used"}"></i>`).join("");
    $("controls").hidden = over();
    $("submit").disabled = picked.size !== 4;
    $("clearSel").disabled = !picked.size;
    $("end").hidden = !over();
    if (over()) finish();
  }

  function submit() {
    if (picked.size !== 4) return;
    const guess = [...picked].sort();
    const key = guess.join("|");
    if (save.guesses.some(g => g.tiles.slice().sort().join("|") === key)) { say("You've already tried those four."); return; }
    const counts = {};
    for (const t of guess) { const g = groupOf(t); counts[g.name] = (counts[g.name] || 0) + 1; }
    save.guesses.push({ tiles: guess, colours: guess.map(t => groupOf(t).colour) });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best[1] === 4) {
      save.solved.push(best[0]);
      picked = new Set();
      say(save.solved.length === 4 ? "" : "Nice one!", "good");
      FX.sound("chime");
      if (save.solved.length === 4) FX.confetti?.(120);
    } else {
      save.mistakes++;
      say(best[1] === 3 ? "One away…" : "Not a squad.", "bad");
      FX.sound("buzz");
      document.querySelectorAll(".tile.on").forEach(b => { b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); });
    }
    persist();
    setTimeout(draw, best[1] === 4 ? 0 : 450);
  }

  function shareText() {
    const lines = save.guesses.map(g => g.colours.map(c => SQUARES[c]).join(""));
    return `ACE Squads #${DAY}: ${save.solved.length === 4 ? `solved with ${save.mistakes} mistake${save.mistakes === 1 ? "" : "s"}` : `${save.solved.length}/4 squads`}\n${lines.join("\n")}\nhttps://games.aceclan.lol/squads/`;
  }

  function finish() {
    const won = save.solved.length === 4;
    $("endTitle").textContent = won ? (save.mistakes === 0 ? "Perfect!" : "Solved!") : "Out of tries";
    $("endText").textContent = won ? `All four squads with ${save.mistakes} mistake${save.mistakes === 1 ? "" : "s"}.` : `You found ${save.solved.length} of 4. The rest are shown above.`;
    $("nextIn").textContent = AceDay.untilNext();
    say("");
    // Clan leaderboard (once: finish runs on every redraw after the game ends).
    if (boardShown) return;
    boardShown = true;
    window.AceBoard?.mount($("board"), {
      game: "squads", day: DAY,
      run: { solved: save.solved.length, mistakes: save.mistakes },
      today: [{ head: "Result", cls: "x", cell: r => r.detail.solved === 4
                  ? (r.detail.mistakes ? `${r.detail.mistakes} mistake${r.detail.mistakes === 1 ? "" : "s"}` : "Perfect") : `${r.detail.solved}/4 squads` },
              { head: "Points", cls: "p", cell: r => r.points }],
      how: "Points: 100 for solving it, minus 20 for each mistake. Out of tries: 10 for each squad you found. All time adds them up.",
    });
  }
  let boardShown = false;

  $("submit").addEventListener("click", submit);
  $("shuffle").addEventListener("click", () => {
    save.order = AceDay.shuffle(save.order, Math.random);
    persist();
    FX.sound("flip");
    draw();
  });
  $("clearSel").addEventListener("click", () => { picked = new Set(); draw(); });
  $("share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(shareText()); $("shareNote").textContent = "Copied. Paste it in Discord."; }
    catch { $("shareNote").textContent = shareText(); }
  });
  $("loading").remove();
  draw();
})();
