// ACEdle: the daily ACE Clan puzzle run.
// Everyone gets the same puzzles each day (picked from the date). Stages unlock one after another,
// each is worth up to 100 points (fewer guesses = more), and finished runs go on a clan leaderboard
// kept by RIOT API (riot.aceclan.lol), which works the points out again itself from the guess counts.
// Progress is saved in this browser, so a refresh carries on where you were.
(async () => {
  "use strict";
  // Jerry's control panel loads this file with window.ACEDLE_REVEAL = { day, ace, done(answers) } to list
  // today's answers: the same picks as the game, with no page drawn.
  const REVEAL = window.ACEDLE_REVEAL || null;
  const HERE = document.currentScript?.src || location.href;     // champions.txt and agents.txt sit beside this file
  const FX = window.AceFX || { sound() {}, confetti() {}, soundButton() {} };
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // Inside Discord (activity.js) every outside address goes through Discord's proxy; elsewhere these do nothing.
  const ACT = window.AceActivity || null;
  const PX = ACT ? ACT.url : u => u;
  const RIOT = LOCAL ? "http://localhost:5080" : PX("https://riot.aceclan.lol");
  const DD = PX("https://ddragon.leagueoflegends.com");

  // The clan's day: midnight in Adelaide (UTC+10:30), the same as the leaderboard uses.
  const START = Date.UTC(2026, 10, 18), OFFSET = 10.5 * 3600e3, DAY_MS = 86400e3;
  const CALENDAR_DAY = Math.floor((Date.now() + OFFSET - START) / DAY_MS) + 1;
  const NEXT = START + CALENDAR_DAY * DAY_MS - OFFSET;          // next midnight
  // The puzzle number comes from RIOT API, because a new day can be started early from Jerry's control
  // panel. If it can't be reached, use the date plus the last early start this browser heard about.
  let serverAce = null;              // today's "Who's the ACE?" answer, picked and saved by RIOT API
  async function puzzleDay() {
    const remembered = () => { try { return +localStorage.getItem("acedle-skipped") || 0; } catch { return 0; } };
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(RIOT + "/acedle/today", { signal: ctl.signal, cache: "no-store" });
      clearTimeout(timer);
      const d = await r.json();
      try { localStorage.setItem("acedle-skipped", String(d.skipped || 0)); } catch { /* fine */ }
      serverAce = d.ace || null;
      return d.day;
    } catch {
      return CALENDAR_DAY + remembered();
    }
  }
  // On this PC (localhost) ?day=N shows puzzle N, for testing. The real site always uses today's puzzle.
  const TEST_DAY = LOCAL && +new URLSearchParams(location.search).get("day");
  if (REVEAL) serverAce = REVEAL.ace || null;
  const DAY = REVEAL ? +REVEAL.day : TEST_DAY || await puzzleDay();

  const STAGES = [
    { key: "word", name: "Word", icon: "🔤", max: 6, until: 5 },
    { key: "champion", name: "Champion", icon: "🛡️", max: 8 },
    { key: "lore", name: "Lore", icon: "📜", max: 6 },
    { key: "ability", name: "Ability", icon: "✨", max: 5 },
    { key: "emoji", name: "Emoji", icon: "😀", max: 6 },
    { key: "splash", name: "Splash", icon: "🖼️", max: 6 },
    { key: "item", name: "Item", icon: "💰", max: 5, from: 2 },
    { key: "valagent", name: "Agent", icon: "🕵️", max: 6, from: 2 },
    { key: "agent", name: "Agent ability", icon: "🎯", max: 5 },
    { key: "gear", name: "Weapon or map", icon: "🗺️", max: 6, from: 2 },
    { key: "ace", name: "Who's the ACE?", icon: "♠️", max: 4 },
  ].filter(st => DAY >= (st.from || 1) && DAY < (st.until || Infinity));
  // Stages added later start on puzzle `from`; dropped ones stop before puzzle `until` (RIOT API uses the same rule).
  const CHAMP_MORE = DAY >= 5;          // the Champion stage's Released and Gender columns start on puzzle #5
  // From puzzle #6 the Ability stage no longer hints at the key. Once you've named the champion you can guess
  // the key instead: get it right and one wrong guess is forgiven (so never more than 100). RIOT API agrees.
  const KEY_BONUS = DAY >= 6;
  const KEYS = ["Passive", "Q", "W", "E", "R"];
  const MAX_POINTS = STAGES.length * 100;
  const points = (st, r) => {
    if (!r || !r.solved || !(r.guesses >= 1 && r.guesses <= st.max)) return 0;
    const counted = r.guesses - (KEY_BONUS && st.key === "ability" && r.bonus && r.guesses > 1 ? 1 : 0);
    return Math.round(100 * (st.max - counted + 1) / st.max);
  };

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: fine, just not saved */ } },
  };
  const SAVE_KEY = "acedle-day-" + DAY;
  const save = store.get(SAVE_KEY, { results: {}, guesses: {} });
  const persist = () => store.set(SAVE_KEY, save);

  // Same random numbers for everyone today (one stream per stage).
  function rng(salt) {
    let a = (Math.imul(DAY, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (list, r) => list[Math.floor(r() * list.length)];

  // ---- Data ------------------------------------------------------------------------------
  const getJSON = async u => {
    const r = await fetch(PX(u));
    if (!r.ok) throw new Error(r.status);
    return ACT ? JSON.parse(ACT.rewrite(await r.text())) : r.json();     // picture links inside the data too
  };
  const data = {};
  const ready = {
    league: (async () => {
      // Regions and melee/ranged come from champions.txt (edit it in Notepad). Champions missing from it fall
      // back to Riot's Universe site for their main region and Data Dragon's attack range. If neither has
      // regions, the Champion stage just leaves the Region column out.
      const listFile = fetch(new URL("champions.txt", HERE), { cache: "no-cache" }).then(r => r.ok ? r.text() : "").catch(() => "");
      const universe = getJSON("https://universe-meeps.leagueoflegends.com/v1/en_us/search/index.json").catch(() => null);
      const ver = (await getJSON(`${DD}/api/versions.json`))[0];
      const champs = (await getJSON(`${DD}/cdn/${ver}/data/en_US/champion.json`)).data;
      const [list, uni] = await Promise.all([listFile, universe]);
      const squash = s => String(s).toLowerCase().replace(/[^a-z]/g, "");
      const tidyRegion = r => r.trim().replace(/^the\s+/i, "").replace(/\b\w/g, ch => ch.toUpperCase());
      const listed = {};
      for (const line of list.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const [name, regions = "", reach = "", gender = ""] = line.split("|").map(s => s.trim());
        listed[squash(name)] = { regions: regions.split(",").map(tidyRegion).filter(Boolean), reach: reach.toLowerCase(),
                                 gender: gender ? gender[0].toUpperCase() + gender.slice(1).toLowerCase() : "" };
      }
      const regionName = Object.fromEntries((uni?.factions || []).map(f => [f.slug, f.name.replace(/^The /, "")]));
      const regionOf = Object.fromEntries((uni?.champions || []).map(c => [squash(c.slug), regionName[c["associated-faction-slug"]] || "Runeterra"]));
      const yearOf = {};
      for (const c of uni?.champions || []) {
        const y = +String(c["release-date"] || "").slice(0, 4);
        if (y) yearOf[squash(c.slug)] = yearOf[squash(c.name)] = y;
      }
      data.dd = ver;
      data.champs = Object.values(champs).sort((a, b) => a.id.localeCompare(b.id)).map(c => {
        const own = listed[squash(c.name)] || listed[squash(c.id)] || {};
        const main = regionOf[squash(c.name)] || regionOf[squash(c.id)];
        const reach = own.reach === "both" ? ["Melee", "Ranged"] : own.reach === "melee" ? ["Melee"] : own.reach === "ranged" ? ["Ranged"]
          : [c.stats.attackrange < 300 ? "Melee" : "Ranged"];
        return {
          id: c.id, name: c.name, img: `${DD}/cdn/${ver}/img/champion/${c.id}.png`,
          cls: c.tags[0] || "None", cls2: c.tags[1] || "None", resource: c.partype || "None",
          reach, reachLabel: reach.length > 1 ? "Both" : reach[0], range: c.stats.attackrange,
          regions: own.regions?.length ? own.regions : main ? [main] : [],
          year: yearOf[squash(c.name)] || yearOf[squash(c.id)] || null, gender: own.gender || "?",
          title: c.title, blurb: c.blurb,
        };
      });
      data.regions = data.champs.filter(c => c.regions.length).length > data.champs.length / 2;
      // A different champion for each League stage. Emoji goes first: only some champions have emoji clues.
      const used = new Set();
      const distinct = (salt, from = data.champs) => { const r = rng(salt); let c; do { c = pick(from, r); } while (used.has(c.id)); used.add(c.id); return c; };
      const emojiChamps = data.champs.filter(c => EMOJI[c.name]);
      data.answer = {};
      data.answer.emoji = distinct(9, emojiChamps);
      for (const [k, salt] of [["champion", 2], ["lore", 10], ["ability", 3], ["splash", 5]]) data.answer[k] = distinct(salt);
    })(),
    items: (async () => {
      // Finished Summoner's Rift items you can buy (nothing builds out of them), one per name.
      const ver = (await getJSON(`${DD}/api/versions.json`))[0];
      const all = (await getJSON(`${DD}/cdn/${ver}/data/en_US/item.json`)).data;
      const byName = new Map();
      for (const [id, x] of Object.entries(all).sort((a, b) => a[0] - b[0])) {
        if (+id >= 10000 || !x.maps?.["11"] || !x.gold?.purchasable || x.requiredChampion || x.requiredAlly
            || x.inStore === false || x.hideFromAll || x.into?.length || x.gold.total < 900 || /^Guardian's /.test(x.name)) continue;
        if (byName.has(x.name)) continue;
        const stats = (x.description.match(/<stats>([\s\S]*?)<\/stats>/)?.[1] || "").split(/<br\s*\/?>/i)
          .map(s => s.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
        byName.set(x.name, { name: x.name, img: `${DD}/cdn/${ver}/img/item/${x.image.full}`, cost: x.gold.total, stats, tags: x.tags || [] });
      }
      data.items = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    })(),
    valorant: (async () => {
      // Origin, release year and utility come from agents.txt (edit it in Notepad); role from the VALORANT data.
      const listFile = fetch(new URL("agents.txt", HERE), { cache: "no-cache" }).then(r => r.ok ? r.text() : "").catch(() => "");
      const list = (await getJSON("https://valorant-api.com/v1/agents?isPlayableCharacter=true")).data;
      const known = s => s && s !== "?" ? s : null;
      const listed = {};
      for (const line of (await listFile).split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const [name, origin, year, utility = ""] = line.split("|").map(s => s.trim());
        listed[norm(name)] = { origin: known(origin), year: known(year) ? +year : null,
                               utility: utility.split(",").map(s => s.trim()).filter(s => s && s !== "?").map(s => s[0].toUpperCase() + s.slice(1).toLowerCase()) };
      }
      const seen = new Set();
      data.agents = list.filter(a => !seen.has(a.displayName) && seen.add(a.displayName))
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map(a => ({ name: a.displayName, img: a.displayIcon, role: a.role?.displayName || "?",
                     abilities: a.abilities.filter(x => x.displayIcon && x.slot !== "Passive"),
                     origin: null, year: null, utility: [], ...listed[norm(a.displayName)] }));
    })(),
    gear: (async () => {
      const [weapons, maps] = await Promise.all([getJSON("https://valorant-api.com/v1/weapons"), getJSON("https://valorant-api.com/v1/maps")]);
      data.weapons = weapons.data.filter(w => w.shopData && w.displayIcon).map(w => ({
        name: w.displayName, img: w.displayIcon, type: w.category.split("::").pop(),
        cost: w.shopData.cost, rate: w.weaponStats?.fireRate,
      })).sort((a, b) => a.name.localeCompare(b.name));
      // Competitive maps only: they're the ones with A/B(/C) sites.
      const seenMap = new Set();
      data.maps = maps.data.filter(m => m.tacticalDescription && m.splash && !seenMap.has(m.displayName) && seenMap.add(m.displayName))
        .map(m => ({ name: m.displayName, img: m.listViewIcon || m.displayIcon, splash: m.splash, sites: m.tacticalDescription }))
        .sort((a, b) => a.name.localeCompare(b.name));
    })(),
    clan: REVEAL ? Promise.resolve() : (async () => {
      try {
        data.clan = (await getJSON(RIOT + "/clan")).members;
      } catch {
        // Live stats are off: read the players list straight from the clan site instead.
        const html = await (await fetch(PX("https://aceclan.lol/"))).text();
        const block = html.match(/const players = \[([\s\S]*?)\n\s*\];/)[1];
        data.clan = new Function(`"use strict"; return [${block}];`)().map(p => ({ ...p, roles: p.roles || [], topChamp: null }));
      }
      data.clan.sort((a, b) => a.name.localeCompare(b.name));
    })(),
  };

  // ---- Today's answers (the stages and Jerry's reveal both use these) ---------------------------------
  const wordAnswer = () => pick(window.ACEDLE_WORDS, rng(1));
  async function abilityAnswer() {
    await ready.league;
    const answer = data.answer.ability;
    const full = (await getJSON(`${DD}/cdn/${data.dd}/data/en_US/champion/${answer.id}.json`)).data[answer.id];
    const slot = Math.floor(rng(4)() * 5);                    // 0 = passive, 1-4 = Q W E R
    return { answer, slot, ab: slot ? full.spells[slot - 1] : full.passive };
  }
  function agentAnswer() {
    const r = rng(6);
    const agent = pick(data.agents, r);
    return { agent, ab: pick(agent.abilities, r) };
  }
  function valAgentAnswer() {
    const abilityAgent = pick(data.agents, rng(6));            // not the same agent as the Agent ability stage
    const r = rng(11);
    let answer;
    do { answer = pick(data.agents, r); } while (answer === abilityAgent && data.agents.length > 1);
    return answer;
  }
  function gearAnswer() {
    const r = rng(13);
    const maps = DAY % 2 === 0 && data.maps.length;
    return { r, maps, answer: pick(maps ? data.maps : data.weapons, r) };
  }
  const aceAnswer = () => (!TEST_DAY && data.clan.find(m => m.name === serverAce)) || pick(data.clan, rng(8));

  async function revealAll() {
    const out = [];
    for (const st of STAGES) {
      let answer = "", detail = "";
      if (st.key === "word") answer = wordAnswer();
      else if (["champion", "lore", "emoji", "splash"].includes(st.key)) { await ready.league; answer = data.answer[st.key].name; }
      else if (st.key === "ability") { const a = await abilityAnswer(); answer = a.answer.name; detail = `${KEYS[a.slot]}: ${a.ab.name}`; }
      else if (st.key === "item") { await ready.items; answer = pick(data.items, rng(12)).name; }
      else if (st.key === "valagent") { await ready.valorant; answer = valAgentAnswer().name; }
      else if (st.key === "agent") { await ready.valorant; const a = agentAnswer(); answer = a.agent.name; detail = a.ab.displayName; }
      else if (st.key === "gear") { await ready.gear; const g = gearAnswer(); answer = g.answer.name; detail = g.maps ? "Map" : "Weapon"; }
      else if (st.key === "ace") answer = serverAce || "Not picked yet";
      out.push({ key: st.key, name: st.name, icon: st.icon, answer, detail });
    }
    return out;
  }

  // ---- Stage strip and flow -------------------------------------------------------------------
  let stageAbort = null;
  let viewing = null;                 // a finished stage reopened from the strip to look back at
  const current = () => STAGES.find(st => !save.results[st.key]);
  const canView = st => save.results[st.key] && !save.results[st.key].skipped;

  function drawStrip() {
    const cur = current();
    $("stages").innerHTML = STAGES.map(st => {
      const r = save.results[st.key];
      const cls = (r ? (r.solved ? "won" : "lost") : st === cur ? "current" : "locked") + (st.key === viewing ? " viewing" : "");
      const pt = r ? (r.skipped ? "skipped" : r.solved ? `+${points(st, r)}` : "0") : st === cur ? "now" : "🔒";
      const open = canView(st) ? ` data-key="${st.key}" tabindex="0" role="button" title="${esc(st.name)}: look back at it"` : ` title="${esc(st.name)}"`;
      return `<li class="${cls}"${open}><span class="ic">${st.icon}</span><span class="nm">${esc(st.name)}</span><span class="pt">${pt}</span></li>`;
    }).join("");
    $("total").textContent = STAGES.reduce((a, st) => a + points(st, save.results[st.key]), 0);
    ACT?.progress({                                  // the Discord call sees how far you've got (never the answers)
      day: DAY, current: cur?.key || "", done: !cur,
      all: STAGES.map(st => ({ key: st.key, name: st.name, icon: st.icon })),
      stages: STAGES.filter(st => save.results[st.key]).map(st => {
        const r = save.results[st.key];
        return { key: st.key, name: st.name, solved: !!r.solved, skipped: !!r.skipped, guesses: r.guesses || 0, points: points(st, r) };
      }),
    });
  }

  // Tap a finished stage (in the strip or the score breakdown) to see its guesses and answer again.
  function lookBack(e) {
    const li = e.target.closest("[data-key]");
    if (!li || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    show(li.dataset.key);
    $("stage").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function show(key) {
    if (stageAbort) stageAbort.abort();
    stageAbort = new AbortController();
    viewing = key && canView(STAGES.find(st => st.key === key) || {}) ? key : null;
    drawStrip();
    const st = viewing ? STAGES.find(s => s.key === viewing) : current();
    if (!st) { $("stage").hidden = true; finish(); return; }
    $("stage").hidden = false;
    $("finish").hidden = true;
    const el = $("stage");
    el.className = "stage";
    el.innerHTML = `<p class="muted loading">Loading…</p>`;
    STAGE_FN[st.key](el, st, stageAbort.signal).catch(() => {
      el.innerHTML = `<h2>${st.icon} ${esc(st.name)}</h2>
        <p class="how">Couldn't load this puzzle (the game data didn't download). Check your connection and refresh, or skip it.</p>
        <button class="btn" type="button" id="skip">Skip this stage (0 points)</button>`;
      $("skip").onclick = () => { save.results[st.key] = { guesses: 0, solved: false, skipped: true }; persist(); show(); };
    });
  }

  // A stage is over: save it, say how it went, offer the next one.
  function complete(st, el, guesses, solved, answerHtml, keyBonus) {
    if (!save.results[st.key]) {
      save.results[st.key] = { guesses, solved };
      persist();
      FX.sound(solved ? "chime" : "lose");
    }
    drawStrip();
    const r = save.results[st.key], pts = points(st, r);
    el.querySelectorAll(".result, .key-bonus").forEach(b => b.remove());
    // The Ability stage's key question (see KEY_BONUS): asked once you've got the champion.
    if (keyBonus && solved) {
      const q = document.createElement("div");
      q.className = "key-bonus";
      if (r.keyGuess) {
        q.innerHTML = r.keyGuess === keyBonus
          ? `🎯 <b>${esc(keyBonus)}</b> was right!${guesses > 1 ? " One wrong guess forgiven." : ""}`
          : `It was on <b>${esc(keyBonus)}</b>, not ${esc(r.keyGuess)}.`;
        q.classList.add(r.keyGuess === keyBonus ? "won" : "lost");
      } else {
        q.innerHTML = `<span><b>Bonus:</b> which key is it?${guesses > 1 ? " Get it right and one wrong guess is forgiven." : " (You've got full marks already: just for fun.)"}</span>
          <div class="keys">${KEYS.map(k => `<button class="btn" type="button" data-k="${k}">${k}</button>`).join("")}</div>`;
        q.querySelectorAll("button").forEach(b => b.onclick = () => {
          r.keyGuess = b.dataset.k;
          r.bonus = r.keyGuess === keyBonus;
          persist();
          FX.sound(r.bonus ? "chime" : "buzz");
          complete(st, el, guesses, solved, answerHtml, keyBonus);
        });
      }
      el.append(q);
    }
    const box = document.createElement("div");
    box.className = "result " + (solved ? "won" : "lost");
    const last = !current();
    const label = viewing ? (last ? "Back to your score" : `Back to ${esc(current().name)} →`) : last ? "See your score" : "Next stage →";
    const onKey = keyBonus ? `, on ${esc(keyBonus)}` : "";
    box.innerHTML = `<span>${solved ? `<b>Got it in ${guesses}!</b> It was ${answerHtml}. +${pts} points` : `<b>Out of guesses.</b> It was ${answerHtml}${onKey}.`}</span>
      <button class="btn primary" type="button">${label}</button>`;
    box.querySelector("button").onclick = () => { show(); scrollTo({ top: 0, behavior: "smooth" }); };
    el.append(box);
    (el.querySelector(".key-bonus .keys button") || box.querySelector("button")).focus({ preventScroll: true });
  }

  const header = (st, how) => `<h2>${st.icon} ${esc(st.name)}</h2><p class="how">${how}</p>`;
  const triesLeft = (st, n) => `<p class="tries">${n} of ${st.max} guesses used</p>`;

  // Search box with suggestions, for champions, agents and clan members.
  function picker(holder, options, onPick, placeholder) {
    holder.innerHTML = `<div class="pick"><input type="text" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off" spellcheck="false"><ul role="listbox" hidden></ul></div>`;
    const input = holder.querySelector("input"), ul = holder.querySelector("ul");
    let shown = [], on = 0;
    const draw = () => {
      ul.hidden = !shown.length;
      ul.innerHTML = shown.map((o, i) => `<li role="option" data-i="${i}" class="${i === on ? "on" : ""}">${o.img ? `<img src="${esc(o.img)}" alt="" loading="lazy">` : ""}${esc(o.name)}</li>`).join("");
    };
    const update = () => {
      const q = norm(input.value);
      const free = options.filter(o => !o.used);
      shown = q ? [...free.filter(o => norm(o.name).startsWith(q)), ...free.filter(o => !norm(o.name).startsWith(q) && norm(o.name).includes(q))].slice(0, 8) : [];
      on = 0;
      draw();
    };
    const choose = o => { if (!o) return; input.value = ""; shown = []; draw(); onPick(o); };
    input.addEventListener("input", update);
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { on = Math.min(on + 1, shown.length - 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { on = Math.max(on - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === "Enter") { choose(shown[on]); e.preventDefault(); }
      else if (e.key === "Escape") { shown = []; draw(); }
    });
    ul.addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li) { e.preventDefault(); choose(shown[+li.dataset.i]); } });
    input.addEventListener("blur", () => setTimeout(() => { shown = []; draw(); }, 150));
    return { input, done() { input.disabled = true; input.placeholder = "Done"; } };
  }

  // ---- 1. Word -------------------------------------------------------------------------------
  function wordColours(guess, answer) {
    const out = Array(5).fill("x"), left = {};
    for (let i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) out[i] = "g";
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
      if (out[i] !== "g" && left[guess[i]]) { out[i] = "y"; left[guess[i]]--; }
    }
    return out;
  }

  async function stageWord(el, st, signal) {
    const answer = wordAnswer();
    const rows = save.guesses.word = save.guesses.word || [];
    let cur = "", over = false, flipRow = -1;
    el.innerHTML = header(st, "Guess the five-letter word. <b style=\"color:#3fbf7f\">Green</b>: right letter, right spot. <b style=\"color:#c89b3c\">Gold</b>: in the word, wrong spot. Grey: not in it.")
      + `<div class="wgrid" id="wgrid"></div><p class="wmsg" id="wmsg" aria-live="polite"></p><div class="keys" id="keys"></div>`;
    // Guesses must be real words (guesses.js), or one of the answers. If the list didn't load, allow anything.
    const isWord = w => !window.ACEDLE_VALID || window.ACEDLE_VALID.has(w) || window.ACEDLE_WORDS.includes(w);
    let msgTimer = 0;
    const say = text => { $("wmsg").textContent = text; clearTimeout(msgTimer); msgTimer = setTimeout(() => { $("wmsg").textContent = ""; }, 1800); };
    const shake = () => {
      const row = $("wgrid").children[rows.length];
      row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake");
      FX.sound("buzz");
    };
    const keyRows = ["QWERTYUIOP", "ASDFGHJKL", "+ZXCVBNM-"];
    const draw = () => {
      const best = {};
      const grid = [];
      for (let r = 0; r < st.max; r++) {
        const word = rows[r] || (r === rows.length ? cur : "");
        const cols = rows[r] ? wordColours(rows[r], answer) : null;
        if (cols) cols.forEach((c, i) => { const k = rows[r][i]; if (!best[k] || c === "g" || (c === "y" && best[k] === "x")) best[k] = c; });
        grid.push(`<div class="wrow" data-r="${r}">${[0, 1, 2, 3, 4].map(i => `<div class="tile${word[i] ? " filled" : ""}${cols ? " " + cols[i] : ""}${r === flipRow ? " flip" : ""}" style="${r === flipRow ? `animation-delay:${i * 0.12}s` : ""}">${esc(word[i] || "")}</div>`).join("")}</div>`);
      }
      $("wgrid").innerHTML = grid.join("");
      $("keys").innerHTML = keyRows.map(row => `<div class="krow">${[...row].map(k =>
        k === "+" ? `<button class="key wide" type="button" data-k="Enter">ENTER</button>`
        : k === "-" ? `<button class="key wide" type="button" data-k="Backspace" aria-label="Delete">⌫</button>`
        : `<button class="key ${best[k] || ""}" type="button" data-k="${k}">${k}</button>`).join("")}</div>`).join("");
      flipRow = -1;
    };
    const press = k => {
      if (over) return;
      if (k === "Enter") {
        if (cur.length < 5) { shake(); say("Not enough letters"); return; }
        if (!isWord(cur)) { shake(); say("Not in the word list"); return; }   // doesn't use up a guess
        rows.push(cur);
        persist();
        flipRow = rows.length - 1;
        FX.sound("flip");
        const won = cur === answer;
        cur = "";
        draw();
        if (won || rows.length >= st.max) { over = true; setTimeout(() => complete(st, el, rows.length, won, `<b>${answer}</b>`), 700); }
      } else if (k === "Backspace") { cur = cur.slice(0, -1); draw(); }
      else if (/^[A-Z]$/.test(k) && cur.length < 5) { cur += k; FX.sound("tick"); draw(); }
    };
    $("keys").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (b) press(b.dataset.k); }, { signal });
    document.addEventListener("keydown", e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea")) return;
      const k = e.key === "Enter" || e.key === "Backspace" ? e.key : e.key.length === 1 ? e.key.toUpperCase() : "";
      if (k) { press(k); if (k === "Enter" || k === "Backspace") e.preventDefault(); }
    }, { signal });
    draw();
    const done = rows.includes(answer) || rows.length >= st.max;
    if (done) { over = true; complete(st, el, rows.length, rows.includes(answer), `<b>${answer}</b>`); }
  }

  // ---- 2. Champion ---------------------------------------------------------------------------
  async function stageChampion(el, st) {
    await ready.league;
    const answer = data.answer.champion;
    const names = save.guesses.champion = save.guesses.champion || [];
    el.innerHTML = header(st, "Guess today's League champion. Each guess shows how close it is.")
      + `<div id="pickHolder"></div><div class="clues"><table><thead><tr><th>Champion</th><th>Class</th><th>Also</th><th>Resource</th><th>Range</th><th>Attack range</th>${data.regions ? "<th>Region</th>" : ""}${CHAMP_MORE ? "<th>Gender</th><th>Released</th>" : ""}</tr></thead><tbody id="rows"></tbody></table></div>
      <div class="key-legend"><span><i style="background:#2f9e44"></i>Match</span><span><i style="background:#c89b3c"></i>Partly (something in common)</span><span><i style="background:#3a3f4d"></i>No match</span><span>↑ ↓ the answer is higher or lower</span></div>
      <div id="tries"></div>`;
    const options = data.champs.map(c => ({ ...c, used: names.includes(c.id) }));
    const num = (g, a) => g === a ? `<td class="g">${g}</td>` : `<td class="x">${g}<span class="ar">${a > g ? "↑" : "↓"}</span></td>`;
    // Lists (regions, melee/ranged): exactly the same = green, anything shared = gold.
    const overlap = (g, a) => {
      const A = new Set(a.map(x => x.toLowerCase())), G = g.map(x => x.toLowerCase());
      if (!G.length || !A.size) return "x";
      return G.length === A.size && G.every(x => A.has(x)) ? "g" : G.some(x => A.has(x)) ? "y" : "x";
    };
    const cls = (g, a1, a2, exact) => g === exact ? "g" : g !== "None" && (g === a1 || g === a2) ? "y" : "x";
    const row = (c, isNew) => `<tr class="${isNew ? "new" : ""}"><td class="who" title="${esc(c.name)}"><img src="${esc(c.img)}" alt="${esc(c.name)}"></td>
      <td class="${cls(c.cls, answer.cls, answer.cls2, answer.cls)}">${esc(c.cls)}</td>
      <td class="${cls(c.cls2, answer.cls, answer.cls2, answer.cls2)}">${esc(c.cls2)}</td>
      <td class="${c.resource === answer.resource ? "g" : "x"}">${esc(c.resource)}</td>
      <td class="${overlap(c.reach, answer.reach)}">${c.reachLabel}</td>
      ${num(c.range, answer.range)}${data.regions ? `<td class="${overlap(c.regions, answer.regions)}">${esc(c.regions.join(", ") || "Unknown")}</td>` : ""}${CHAMP_MORE
        ? `<td class="${c.gender !== "?" && c.gender === answer.gender ? "g" : "x"}">${esc(c.gender)}</td>${c.year && answer.year ? num(c.year, answer.year) : `<td class="x">${c.year || "?"}</td>`}` : ""}</tr>`;
    const byId = id => data.champs.find(c => c.id === id);
    const draw = isNew => {
      $("rows").innerHTML = names.slice().reverse().map((id, i) => row(byId(id), isNew && i === 0)).join("");
      $("tries").innerHTML = triesLeft(st, names.length);
    };
    const p = picker($("pickHolder"), options, o => {
      o.used = true;
      names.push(o.id);
      persist();
      FX.sound("flip");
      draw(true);
      if (o.id === answer.id || names.length >= st.max) { p.done(); setTimeout(() => complete(st, el, names.length, o.id === answer.id, `<b>${esc(answer.name)}</b>`), 600); }
    }, "Type a champion…");
    draw(false);
    if (names.includes(answer.id) || names.length >= st.max) { p.done(); complete(st, el, names.length, names.includes(answer.id), `<b>${esc(answer.name)}</b>`); }
    else p.input.focus();
  }

  // ---- Picture stages: ability, agent, splash -------------------------------------------------
  // Shared: a picture that gets clearer with every miss, hints that appear, and a search box.
  function pictureStage(el, st, { how, picture, update, hints, options, answerName, answerHtml, placeholder, key, keyBonus }) {
    const names = save.guesses[key] = save.guesses[key] || [];
    el.innerHTML = header(st, how) + `<div class="picture-stage"><div class="picture">${picture}</div><ul class="hints" id="hints"></ul>
      <div id="pickHolder"></div><div class="guessed" id="guessed"></div><div id="tries" style="text-align:center"></div></div>`;
    const solved = () => names.includes(answerName);
    const draw = () => {
      const misses = names.filter(n => n !== answerName).length;
      update(solved() || names.length >= st.max ? 99 : misses);
      $("hints").innerHTML = hints.filter((h, i) => misses > i || solved() || names.length >= st.max).map(h => `<li>${h}</li>`).join("");
      $("guessed").innerHTML = names.map(n => { const o = options.find(x => x.name === n); return `<span class="g${n === answerName ? " ok" : ""}">${o?.img ? `<img src="${esc(o.img)}" alt="">` : ""}${esc(n)}</span>`; }).join("");
      $("tries").innerHTML = triesLeft(st, names.length);
    };
    options.forEach(o => { o.used = names.includes(o.name); });
    const p = picker($("pickHolder"), options, o => {
      o.used = true;
      names.push(o.name);
      persist();
      FX.sound(o.name === answerName ? "ding" : "buzz");
      draw();
      if (solved() || names.length >= st.max) { p.done(); complete(st, el, names.length, solved(), answerHtml, keyBonus); }
    }, placeholder);
    draw();
    if (solved() || names.length >= st.max) { p.done(); complete(st, el, names.length, solved(), answerHtml, keyBonus); }
    else p.input.focus({ preventScroll: true });
  }

  async function stageAbility(el, st) {
    const { answer, slot, ab } = await abilityAnswer();
    const src = `${DD}/cdn/${data.dd}/img/${slot ? "spell" : "passive"}/${ab.image.full}`;
    const blur = [9, 6, 3.5, 1.5, 0.5], grey = [1, 0.85, 0.6, 0.3, 0.1];
    pictureStage(el, st, {
      key: "ability", placeholder: "Type a champion…",
      how: "Whose ability is this? It gets clearer, and you get hints, with every wrong guess.",
      picture: `<div class="frame"><img id="pic" src="${esc(src)}" alt="A League ability icon"></div>`,
      update: m => { const img = $("pic"); img.style.filter = m >= 99 ? "none" : `blur(${blur[m] ?? 0}px) grayscale(${grey[m] ?? 0})`; },
      hints: KEY_BONUS
        ? [`Class: <b>${esc(answer.cls)}</b>`, `<b>${answer.reachLabel === "Both" ? "Melee and ranged" : answer.reachLabel}</b>`, `Ability: <b>${esc(ab.name)}</b>`]
        : [`Key: <b>${KEYS[slot]}</b>`, `Class: <b>${esc(answer.cls)}</b>`, `Ability: <b>${esc(ab.name)}</b>`],
      options: data.champs.map(c => ({ name: c.name, img: c.img })), answerName: answer.name,
      answerHtml: `<b>${esc(answer.name)}</b> (${esc(ab.name)})`,
      keyBonus: KEY_BONUS ? KEYS[slot] : null,
    });
  }

  async function stageAgent(el, st) {
    await ready.valorant;
    const { agent, ab } = agentAnswer();
    const keyName = { Ability1: "Q", Ability2: "E", Grenade: "C", Ultimate: "X" }[ab.slot] || ab.slot;
    const blur = [7, 4.5, 2.5, 1, 0.4];
    pictureStage(el, st, {
      key: "agent", placeholder: "Type an agent…",
      how: "Which VALORANT agent has this ability? It gets clearer, and you get hints, with every wrong guess.",
      picture: `<div class="frame agent"><img id="pic" src="${esc(ab.displayIcon)}" alt="A VALORANT ability icon"></div>`,
      update: m => { $("pic").style.filter = m >= 99 ? "none" : `blur(${blur[m] ?? 0}px)`; },
      hints: [`Key: <b>${esc(keyName)}</b>`, `Role: <b>${esc(agent.role)}</b>`, `Ability: <b>${esc(ab.displayName)}</b>`],
      options: data.agents.map(a => ({ name: a.name, img: a.img })), answerName: agent.name,
      answerHtml: `<b>${esc(agent.name)}</b> (${esc(ab.displayName)})`,
    });
  }

  // ---- Lore: the champion's story with their name blacked out ---------------------------------------
  async function stageLore(el, st) {
    await ready.league;
    const answer = data.answer.lore;
    // Hide the full name and each longer word of it ("Lee Sin" also hides "Lee").
    // Names are only letters plus spaces, dots, apostrophes and "&", so the letter runs need no escaping.
    const words = answer.name.split(/[^A-Za-z]+/).filter(w => w.length > 2);
    const hidden = words.length
      ? esc(answer.blurb).replace(new RegExp(String.raw`\b(${words.join("|")})\b`, "gi"), `<span class="redact">█████</span>`)
      : esc(answer.blurb);
    pictureStage(el, st, {
      key: "lore", placeholder: "Type a champion…",
      how: "Whose story is this? You get hints with every wrong guess.",
      picture: `<blockquote class="lore">${hidden}</blockquote>`,
      update: () => {},
      hints: [`Class: <b>${esc(answer.cls)}</b>`, `<b>${answer.reachLabel === "Both" ? "Melee and ranged" : answer.reachLabel}</b>`, `Title: <b>${esc(answer.title)}</b>`],
      options: data.champs.map(c => ({ name: c.name, img: c.img })), answerName: answer.name,
      answerHtml: `<b>${esc(answer.name)}</b>, ${esc(answer.title)}`,
    });
  }

  // ---- Emoji: one emoji to start, another with every wrong guess -------------------------------------
  // Hand-made clues. Add more freely: the champion's name exactly as League writes it, then four emojis.
  const EMOJI = {
    "Ahri": "🦊 💋 ❤️ ✨", "Annie": "👧 🧸 🔥 💥", "Ashe": "🏹 ❄️ 👑 🦅", "Blitzcrank": "🤖 🦾 🪝 ⚡",
    "Braum": "🚪 🛡️ 🥛 💪", "Caitlyn": "🕵️‍♀️ 🎯 🧁 🔫", "Cho'Gath": "👾 🍽️ 📈 🦖", "Darius": "🪓 🩸 🏰 👊",
    "Draven": "🪓 😎 💰 🪓", "Ekko": "🛹 ⏰ ⏪ 🧒", "Ezreal": "🧭 💎 ✨ 🏃‍♂️", "Fiddlesticks": "🌾 🐦‍⬛ 😱 🎃",
    "Fizz": "🐟 🔱 🦈 🌊", "Garen": "🌀 🗡️ 🛡️ 👑", "Gragas": "🍺 🛢️ 🤢 💥", "Graves": "🧔 🔫 🚬 💥",
    "Heimerdinger": "🔧 🗼 🧑‍🔬 🐹", "Janna": "🌬️ 🌪️ ☁️ 🛡️", "Jax": "🏮 🥷 💪 🌀", "Jinx": "🦈 🚀 💣 🔫",
    "Karthus": "💀 🎶 🌑 ☠️", "Katarina": "🗡️ 🌀 🔴 🗡️", "Kennen": "⚡ 🥷 🌩️ 🐿️", "Kog'Maw": "🐛 👄 🧪 🤮",
    "Lee Sin": "🙈 🥋 🦵 🐉", "Leona": "☀️ 🛡️ 🌅 ⚔️", "Lulu": "🧚‍♀️ 🪄 🐿️ 🌈", "Lux": "💡 🌈 ⭐ ✨",
    "Malphite": "🪨 ⛰️ 🗿 💥", "Master Yi": "🥽 🗡️ 🧘‍♂️ ⚡", "Miss Fortune": "🏴‍☠️ 🔫 🔫 💋", "Morgana": "⛓️ 🖤 🪽 🔮",
    "Nami": "🧜‍♀️ 🌊 🫧 🐚", "Nasus": "🐶 📈 🏜️ 🦴", "Nautilus": "⚓ 🤿 🌊 🪝", "Nunu & Willump": "⛄ 🧒 ❄️ 🎯",
    "Orianna": "⚙️ 💃 🔵 🤖", "Pantheon": "🛡️ 🔱 ⭐ 🪂", "Pyke": "⚓ 🌊 🗡️ 💰", "Rammus": "🐢 🌀 🦔 👌",
    "Rengar": "🦁 🌿 🦴 🏹", "Riven": "🗡️ 💔 🌬️ 🐇", "Rumble": "🐹 🤖 🔥 🚀", "Shaco": "🃏 📦 🎭 🔪",
    "Singed": "🧪 ☠️ 💨 🏃‍♂️", "Sion": "🧟 🪓 🐂 💀", "Sona": "🎻 🎶 🤫 💙", "Soraka": "🦄 🌟 💚 🍌",
    "Taric": "💎 ✨ 🛡️ 🌈", "Teemo": "🍄 🐿️ 🎯 💨", "Thresh": "🪝 🏮 👻 ⛓️", "Tryndamere": "😡 🗡️ ⏳ 💀",
    "Twisted Fate": "🃏 🎩 🎲 🌊", "Twitch": "🐀 🧀 ☣️ 🏹", "Veigar": "🧙‍♂️ 🎩 ⭐ 📈", "Vi": "🥊 🥊 🚓 💥",
    "Volibear": "🐻 ⚡ 🌩️ 🏔️", "Warwick": "🐺 🩸 👃 🧪", "Wukong": "🐒 ☁️ 🌀 🪄", "Yasuo": "🌪️ 🗡️ 💨 🎋",
    "Yuumi": "🐱 📖 💖 ✨", "Zed": "🥷 🌑 👤 🗡️", "Ziggs": "🐹 💣 🧨 💥", "Zilean": "⏳ 🕰️ 👴 💣",
    "Zoe": "🌟 🦋 😴 💫",
  };

  async function stageEmoji(el, st) {
    await ready.league;
    const answer = data.answer.emoji;
    const icons = EMOJI[answer.name].split(" ");
    pictureStage(el, st, {
      key: "emoji", placeholder: "Type a champion…",
      how: "Which champion do these emojis describe? A new one shows with every wrong guess.",
      picture: `<div class="emoji" id="pic" aria-label="Emoji clues"></div>`,
      update: m => { $("pic").innerHTML = icons.map((e, i) => `<span class="${i <= m ? "" : "hide"}">${i <= m ? e : "?"}</span>`).join(""); },
      hints: [],
      options: data.champs.map(c => ({ name: c.name, img: c.img })), answerName: answer.name,
      answerHtml: `<b>${esc(answer.name)}</b>`,
    });
  }

  async function stageSplash(el, st) {
    await ready.league;
    const answer = data.answer.splash;
    const r = rng(7);
    const x = Math.round(20 + r() * 60), y = Math.round(15 + r() * 50);
    const zoom = [720, 520, 380, 270, 190, 140];
    pictureStage(el, st, {
      key: "splash", placeholder: "Type a champion…",
      how: "Whose splash art is this? It zooms out with every wrong guess.",
      picture: `<div class="splash" id="pic" role="img" aria-label="A zoomed-in piece of splash art" style="background-image:url('${DD}/cdn/img/champion/splash/${answer.id}_0.jpg')"></div>`,
      update: m => { const p = $("pic"); p.style.backgroundSize = m >= 99 ? "100%" : `${zoom[m] ?? 100}%`; p.style.backgroundPosition = m >= 99 ? "50% 50%" : `${x}% ${y}%`; },
      hints: [`Class: <b>${esc(answer.cls)}</b>`, `<b>${answer.reachLabel === "Both" ? "Melee and ranged" : answer.reachLabel}</b>`, `Resource: <b>${esc(answer.resource)}</b>`],
      options: data.champs.map(c => ({ name: c.name, img: c.img })), answerName: answer.name,
      answerHtml: `<b>${esc(answer.name)}</b>`,
    });
  }

  // ---- Item: a League item icon that gets clearer ---------------------------------------------------
  async function stageItem(el, st) {
    await ready.items;
    const answer = pick(data.items, rng(12));
    const pretty = t => t.replace(/([a-z])([A-Z])/g, "$1 $2");
    const blur = [8, 5.5, 3, 1.5, 0.5], grey = [1, 0.8, 0.5, 0.25, 0];
    pictureStage(el, st, {
      key: "item", placeholder: "Type an item…",
      how: "Which League item is this? It gets clearer, and you get hints, with every wrong guess.",
      picture: `<div class="frame"><img id="pic" src="${esc(answer.img)}" alt="A League item icon"></div>`,
      update: m => { $("pic").style.filter = m >= 99 ? "none" : `blur(${blur[m] ?? 0}px) grayscale(${grey[m] ?? 0})`; },
      hints: [`Costs <b>${answer.cost}</b> gold`, answer.stats[0] ? `Gives <b>${esc(answer.stats[0])}</b>` : `Type: <b>${esc(answer.tags.map(pretty).join(", ") || "None")}</b>`,
              answer.stats.length > 1 ? `Also <b>${esc(answer.stats.slice(1).join(", "))}</b>` : `Type: <b>${esc(answer.tags.map(pretty).join(", ") || "None")}</b>`],
      options: data.items.map(i => ({ name: i.name, img: i.img })), answerName: answer.name,
      answerHtml: `<b>${esc(answer.name)}</b>`,
    });
  }

  // ---- Agent: clues like the Champion stage, for VALORANT agents --------------------------------------
  async function stageValAgent(el, st) {
    await ready.valorant;
    const answer = valAgentAnswer();
    const names = save.guesses.valagent = save.guesses.valagent || [];
    el.innerHTML = header(st, "Guess today's VALORANT agent. Each guess shows how close it is.")
      + `<div id="pickHolder"></div><div class="clues"><table><thead><tr><th>Agent</th><th>Role</th><th>Origin</th><th>Released</th><th>Utility</th></tr></thead><tbody id="rows"></tbody></table></div>
      <div class="key-legend"><span><i style="background:#2f9e44"></i>Match</span><span><i style="background:#c89b3c"></i>Partly (some utility in common)</span><span><i style="background:#3a3f4d"></i>No match</span><span>↑ ↓ the answer came out later or earlier</span></div>
      <div id="tries"></div>`;
    const same = (g, a) => g != null && a != null && String(g).toLowerCase() === String(a).toLowerCase();
    const util = (g, a) => {
      const A = new Set(a.map(x => x.toLowerCase())), G = g.map(x => x.toLowerCase());
      if (!G.length || !A.size) return "x";
      return G.length === A.size && G.every(x => A.has(x)) ? "g" : G.some(x => A.has(x)) ? "y" : "x";
    };
    const year = (g, a) => g == null ? `<td class="x">?</td>` : same(g, a) ? `<td class="g">${g}</td>`
      : `<td class="x">${g}${a == null ? "" : `<span class="ar">${a > g ? "↑" : "↓"}</span>`}</td>`;
    const row = (g, isNew) => `<tr class="${isNew ? "new" : ""}"><td class="who" title="${esc(g.name)}"><img src="${esc(g.img)}" alt="${esc(g.name)}"></td>
      <td class="${same(g.role, answer.role) ? "g" : "x"}">${esc(g.role)}</td>
      <td class="${same(g.origin, answer.origin) ? "g" : "x"}">${esc(g.origin || "?")}</td>
      ${year(g.year, answer.year)}
      <td class="${util(g.utility, answer.utility)}">${esc(g.utility.join(", ") || "?")}</td></tr>`;
    const byName = n => data.agents.find(a => a.name === n);
    const draw = isNew => {
      $("rows").innerHTML = names.slice().reverse().map((n, i) => byName(n) ? row(byName(n), isNew && i === 0) : "").join("");
      $("tries").innerHTML = triesLeft(st, names.length);
    };
    const options = data.agents.map(a => ({ name: a.name, img: a.img, used: names.includes(a.name) }));
    const p = picker($("pickHolder"), options, o => {
      o.used = true;
      names.push(o.name);
      persist();
      FX.sound("flip");
      draw(true);
      if (o.name === answer.name || names.length >= st.max) { p.done(); setTimeout(() => complete(st, el, names.length, o.name === answer.name, `<b>${esc(answer.name)}</b>`), 600); }
    }, "Type an agent…");
    draw(false);
    if (names.includes(answer.name) || names.length >= st.max) { p.done(); complete(st, el, names.length, names.includes(answer.name), `<b>${esc(answer.name)}</b>`); }
    else p.input.focus();
  }

  // ---- Weapon or map: a zoomed-in picture, weapons one day and maps the next ----------------------------
  async function stageGear(el, st) {
    await ready.gear;
    const { r, maps, answer } = gearAnswer();
    const x = Math.round((maps ? 20 : 30) + r() * (maps ? 60 : 40)), y = Math.round((maps ? 20 : 40) + r() * (maps ? 60 : 20));
    // Maps zoom out. Weapon pictures are too small to zoom into, so the whole gun starts blurred instead.
    const zoom = [650, 470, 340, 240, 170, 125], blur = [12, 8, 5, 3, 1.5, 0.5];
    const hints = maps
      ? [`<b>${esc(answer.sites)}</b>`, `Starts with <b>${esc(answer.name[0])}</b>`]
      : [`Type: <b>${esc(answer.type)}</b>`, `Costs <b>${answer.cost}</b> credits`, answer.rate ? `Fires <b>${answer.rate}</b> shots a second` : `Starts with <b>${esc(answer.name[0])}</b>`];
    pictureStage(el, st, {
      key: "gear", placeholder: maps ? "Type a map…" : "Type a weapon…",
      how: maps ? "Today it's a VALORANT <b>map</b>. Which one is this? It zooms out with every wrong guess."
                : "Today it's a VALORANT <b>weapon</b>. Which one is this? It gets clearer with every wrong guess.",
      picture: maps
        ? `<div class="splash" id="pic" role="img" aria-label="A zoomed-in VALORANT map" style="background-image:url('${esc(answer.splash)}')"></div>`
        : `<div class="splash weapon"><div class="gun" id="pic" role="img" aria-label="A blurred VALORANT weapon" style="background-image:url('${esc(answer.img)}')"></div></div>`,
      update: m => {
        const p = $("pic");
        if (maps) { p.style.backgroundSize = m >= 99 ? "100%" : `${zoom[m] ?? 100}%`; p.style.backgroundPosition = m >= 99 ? "50% 50%" : `${x}% ${y}%`; }
        else p.style.filter = m >= 99 ? "none" : `blur(${blur[m] ?? 0}px) ${m >= 3 ? "" : " brightness(0) invert(1)"}`;   // first misses: just a white silhouette
      },
      hints,
      options: (maps ? data.maps : data.weapons).map(o => ({ name: o.name, img: o.img })), answerName: answer.name,
      answerHtml: `<b>${esc(answer.name)}</b>`,
    });
  }

  // ---- 6. Who's the ACE? -----------------------------------------------------------------------
  const TIERS = ["iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"];
  const tierOf = m => TIERS.indexOf(String(m.rank || "").split(" ")[0].toLowerCase());
  const short = n => String(n).replace(/^ACE\s+/i, "");
  const plays = m => m.games.includes("league") && m.games.includes("valorant") ? "Both" : m.games.includes("league") ? "League" : "Valorant";

  async function stageAce(el, st) {
    await ready.clan;
    // RIOT API picks the member (everyone gets a turn before anyone repeats). If it can't be reached, or
    // when testing another day with ?day=, fall back to a pick from the date.
    const answer = aceAnswer();
    const names = save.guesses.ace = save.guesses.ace || [];
    el.innerHTML = header(st, "Which clan member is it today? Each guess shows what you have in common.")
      + `<div id="pickHolder"></div><div class="clues"><table><thead><tr><th>Member</th><th>Plays</th><th>Region</th><th>League rank</th><th>Main role</th><th>Top champ</th><th>Main agent</th></tr></thead><tbody id="rows"></tbody></table></div>
      <div class="key-legend"><span><i style="background:#2f9e44"></i>Same</span><span><i style="background:#c89b3c"></i>Close (one of their roles, or one game in common)</span><span>↑ ↓ the answer's rank is higher or lower</span></div><div id="tries"></div>`;
    const cell = (cls, text, extra = "") => `<td class="${cls}">${esc(text || "None")}${extra}</td>`;
    const row = (m, isNew) => {
      const tg = tierOf(m), ta = tierOf(answer);
      const pg = plays(m), pa = plays(answer);
      const role = m.roles[0] || "None", roleA = answer.roles[0] || "None";
      return `<tr class="${isNew ? "new" : ""}"><td class="who"><div class="nm">${esc(short(m.name))}</div></td>
        ${cell(pg === pa ? "g" : pg === "Both" || pa === "Both" ? "y" : "x", pg)}
        ${cell(m.region === answer.region ? "g" : "x", String(m.region || "").toUpperCase())}
        ${cell(tg === ta ? "g" : "x", tg < 0 ? "Unranked" : m.rank, tg === ta ? "" : `<span class="ar">${ta > tg ? "↑" : "↓"}</span>`)}
        ${cell(role === roleA ? "g" : role !== "None" && answer.roles.includes(role) ? "y" : "x", role)}
        ${cell((m.topChamp || "") === (answer.topChamp || "") ? "g" : "x", m.topChamp)}
        ${cell((m.agent || "") === (answer.agent || "") ? "g" : "x", m.agent)}</tr>`;
    };
    const byName = n => data.clan.find(m => m.name === n);
    const draw = isNew => {
      $("rows").innerHTML = names.slice().reverse().map((n, i) => byName(n) ? row(byName(n), isNew && i === 0) : "").join("");
      $("tries").innerHTML = triesLeft(st, names.length);
    };
    const options = data.clan.map(m => ({ name: m.name, used: names.includes(m.name) }));
    const p = picker($("pickHolder"), options, o => {
      o.used = true;
      names.push(o.name);
      persist();
      FX.sound("flip");
      draw(true);
      if (o.name === answer.name || names.length >= st.max) { p.done(); setTimeout(() => complete(st, el, names.length, o.name === answer.name, `<b>${esc(answer.name)}</b>`), 600); }
    }, "Type a clan member…");
    draw(false);
    if (names.includes(answer.name) || names.length >= st.max) { p.done(); complete(st, el, names.length, names.includes(answer.name), `<b>${esc(answer.name)}</b>`); }
    else p.input.focus();
  }

  const STAGE_FN = { word: stageWord, champion: stageChampion, lore: stageLore, ability: stageAbility, emoji: stageEmoji, splash: stageSplash, item: stageItem, valagent: stageValAgent, agent: stageAgent, gear: stageGear, ace: stageAce };

  // ---- Finish: score, streak, share, leaderboard -----------------------------------------------
  function shareText(total) {
    const lines = STAGES.map(st => {
      const r = save.results[st.key];
      const bar = r.solved ? "🟩".repeat(Math.max(1, Math.round(points(st, r) / 20))) : "🟥";
      return `${st.icon} ${r.solved ? `${r.guesses}/${st.max}` : "X/" + st.max} ${bar}`;
    });
    return `ACEdle #${DAY}: ${total}/${MAX_POINTS}\n${lines.join("\n")}\nhttps://games.aceclan.lol/acedle/`;
  }

  function finish() {
    const el = $("finish");
    el.hidden = false;
    const total = STAGES.reduce((a, st) => a + points(st, save.results[st.key]), 0);
    // Streaks: counted once per day.
    const stats = store.get("acedle-stats", { played: 0, streak: 0, best: 0, last: 0, totalPoints: 0 });
    if (!save.counted) {
      stats.streak = stats.last === DAY - 1 ? stats.streak + 1 : 1;
      stats.best = Math.max(stats.best, stats.streak);
      stats.played++;
      stats.totalPoints += total;
      stats.last = DAY;
      store.set("acedle-stats", stats);
      save.counted = true;
      persist();
      FX.sound("win");
      if (total >= 300) FX.confetti();
    }
    const name = save.name || ACT?.user?.name.slice(0, 20) || store.get("acedle-name", "");
    el.innerHTML = `<h2>Run complete</h2>
      <div class="big">${total} <small style="font-size:1.1rem;color:var(--muted)">/ ${MAX_POINTS}</small></div>
      <ul class="breakdown">${STAGES.map(st => { const r = save.results[st.key];
        return `<li${canView(st) ? ` data-key="${st.key}" tabindex="0" role="button" title="Look back at it"` : ""}><span>${st.icon} ${esc(st.name)} <span class="muted">${r.skipped ? "skipped" : r.solved ? `${r.guesses} of ${st.max} guesses${r.bonus && KEY_BONUS && st.key === "ability" ? ", key bonus" : ""}` : "missed"}</span></span><b>${points(st, r)}</b></li>`; }).join("")}</ul>
      <div class="streak"><span><b>${stats.streak}</b>day streak</span><span><b>${stats.best}</b>best streak</span><span><b>${stats.played}</b>runs played</span></div>
      <div class="row"><button class="btn" type="button" id="share">Copy result</button><span class="note" id="shareNote"></span></div>
      <div class="board">
        <h3>Leaderboard <span class="tabs"><button type="button" data-t="today" class="on">Today</button><button type="button" data-t="all">All time</button></span></h3>
        <div class="row" id="submitRow" ${save.submitted ? "hidden" : ""}>
          <input id="name" maxlength="20" placeholder="Your name" value="${esc(name)}" aria-label="Your name for the leaderboard">
          <button class="btn primary" type="button" id="submit">Add my score</button>
        </div>
        <p class="note" id="submitNote">${save.submitted ? `Your score is on the board as <b>${esc(save.name)}</b>.` : "Add your score to see where you rank."}</p>
        <div id="board"></div>
      </div>
      <p class="countdown" id="countdown"></p>`;

    $("share").onclick = async () => {
      const text = shareText(total);
      try { await navigator.clipboard.writeText(text); $("shareNote").textContent = "Copied. Paste it in Discord!"; }
      catch { $("shareNote").textContent = text; }
    };

    let tab = "today", board = null;
    const drawBoard = () => {
      if (!board) return;
      const me = (save.name || "").toLowerCase();
      const rows = tab === "today" ? board.scores : board.allTime;
      $("board").innerHTML = rows.length ? `<table class="lb"><thead><tr><th>#</th><th>Name</th><th>${tab === "today" ? "Stages" : "Runs"}</th><th style="text-align:right">Points</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr class="${r.name.toLowerCase() === me ? "me" : ""}"><td class="n">${i + 1}</td><td>${esc(r.name)}</td>
          <td class="dots">${tab === "today" ? STAGES.map(st => r.stages[st.key]?.solved ? "🟩" : "🟥").join("") : r.days}</td><td class="p">${r.points}</td></tr>`).join("")}
        </tbody></table>` : `<p class="muted">Nobody yet${tab === "today" ? " today. Be the first!" : "."}</p>`;
    };
    const loadBoard = async () => {
      try { board = await getJSON(`${RIOT}/acedle/leaderboard?day=${DAY}`); drawBoard(); }
      catch { $("board").innerHTML = `<p class="muted">The leaderboard is offline right now (it runs on the clan PC). Your score is saved here; add it later.</p>`; }
    };
    el.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
      tab = b.dataset.t;
      el.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
      drawBoard();
    });
    const submit = async () => {
      const n = $("name").value.trim();
      if (!n) { $("name").focus(); return; }
      $("submit").disabled = true;
      $("submitNote").className = "note";
      $("submitNote").textContent = "Sending…";
      try {
        const r = await fetch(`${RIOT}/acedle/score`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ day: DAY, name: n, stages: STAGES.map(st => ({ stage: st.key, ...save.results[st.key] })) }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't add your score.");
        save.submitted = true;
        save.name = n;
        persist();
        store.set("acedle-name", n);
        $("submitRow").hidden = true;
        $("submitNote").innerHTML = `Your score is on the board as <b>${esc(n)}</b>.`;
        FX.sound("chime");
        loadBoard();
      } catch (e) {
        $("submitNote").className = "note bad";
        $("submitNote").textContent = e.message === "Failed to fetch" ? "The leaderboard is offline right now. Try again later." : e.message;
        $("submit").disabled = false;
      }
    };
    $("submit") && ($("submit").onclick = submit);
    // In Discord: no name to type. Your score goes on the board under your Discord name when you finish.
    if (ACT && !save.submitted) {
      $("submitRow").hidden = true;
      $("submitNote").textContent = "Adding your score as your Discord name…";
      ACT.ready.then(u => {
        if (u) { $("name").value = u.name.slice(0, 20); submit().then(() => { if (!save.submitted) $("submitRow").hidden = false; }); }
        else { $("submitRow").hidden = false; $("submitNote").textContent = "Add your score to see where you rank."; }
      });
    }
    $("name")?.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    loadBoard();

    const tick = () => {
      const s = Math.max(0, Math.round((NEXT - Date.now()) / 1000));
      if (!s) { $("countdown").innerHTML = `A new ACEdle is out! <a href="">Play it</a>`; return; }
      $("countdown").textContent = `Next ACEdle in ${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
      setTimeout(tick, 1000);
    };
    tick();
  }

  if (REVEAL) {
    try { REVEAL.done(await revealAll()); } catch (e) { REVEAL.done(null, e); }
    return;
  }

  for (const id of ["stages", "finish"]) { $(id).addEventListener("click", lookBack); $(id).addEventListener("keydown", lookBack); }
  $("dayNo").textContent = "#" + DAY;
  $("maxPts").textContent = MAX_POINTS;
  $("stageCount").textContent = STAGES.length;
  document.querySelector(".top")?.append(FX.soundButton() || "");
  show();
})();
