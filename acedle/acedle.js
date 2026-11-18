// ACEdle: the daily ACE Clan puzzle run.
// Everyone gets the same six puzzles each day (picked from the date). Stages unlock one after another,
// each is worth up to 100 points (fewer guesses = more), and finished runs go on a clan leaderboard
// kept by RIOT API (riot.aceclan.lol), which works the points out again itself from the guess counts.
// Progress is saved in this browser, so a refresh carries on where you were.
(() => {
  "use strict";
  const FX = window.AceFX || { sound() {}, confetti() {}, soundButton() {} };
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const RIOT = LOCAL ? "http://localhost:5080" : "https://riot.aceclan.lol";
  const DD = "https://ddragon.leagueoflegends.com";

  // The clan's day: midnight in Adelaide (UTC+10:30), the same as the leaderboard uses.
  const START = Date.UTC(2026, 10, 18), OFFSET = 10.5 * 3600e3, DAY_MS = 86400e3;
  const DAY = Math.floor((Date.now() + OFFSET - START) / DAY_MS) + 1;
  const NEXT = START + DAY * DAY_MS - OFFSET;

  const STAGES = [
    { key: "word", name: "Word", icon: "🔤", max: 6 },
    { key: "champion", name: "Champion", icon: "🛡️", max: 8 },
    { key: "lore", name: "Lore", icon: "📜", max: 6 },
    { key: "ability", name: "Ability", icon: "✨", max: 5 },
    { key: "emoji", name: "Emoji", icon: "😀", max: 6 },
    { key: "splash", name: "Splash", icon: "🖼️", max: 6 },
    { key: "agent", name: "Agent", icon: "🎯", max: 5 },
    { key: "ace", name: "Who's the ACE?", icon: "♠️", max: 4 },
  ];
  const points = (st, r) => r && r.solved && r.guesses >= 1 && r.guesses <= st.max ? Math.round(100 * (st.max - r.guesses + 1) / st.max) : 0;

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
  const getJSON = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); };
  const data = {};
  const ready = {
    league: (async () => {
      // Lore regions come from Riot's Universe site (Data Dragon doesn't have them). If it's down, the
      // Champion stage just leaves the Region column out.
      const universe = getJSON("https://universe-meeps.leagueoflegends.com/v1/en_us/search/index.json").catch(() => null);
      const ver = (await getJSON(`${DD}/api/versions.json`))[0];
      const champs = (await getJSON(`${DD}/cdn/${ver}/data/en_US/champion.json`)).data;
      const uni = await universe;
      const squash = s => String(s).toLowerCase().replace(/[^a-z]/g, "");
      const regionName = Object.fromEntries((uni?.factions || []).map(f => [f.slug, f.name.replace(/^The /, "")]));
      const regionOf = Object.fromEntries((uni?.champions || []).map(c => [squash(c.slug), regionName[c["associated-faction-slug"]] || "Runeterra"]));
      data.dd = ver;
      data.champs = Object.values(champs).sort((a, b) => a.id.localeCompare(b.id)).map(c => ({
        id: c.id, name: c.name, img: `${DD}/cdn/${ver}/img/champion/${c.id}.png`,
        cls: c.tags[0] || "None", cls2: c.tags[1] || "None", resource: c.partype || "None",
        melee: c.stats.attackrange < 300, range: c.stats.attackrange,
        region: regionOf[squash(c.name)] || regionOf[squash(c.id)] || null,
        title: c.title, blurb: c.blurb,
      }));
      data.regions = data.champs.filter(c => c.region).length > data.champs.length / 2;
      // A different champion for each League stage. Emoji goes first: only some champions have emoji clues.
      const used = new Set();
      const distinct = (salt, from = data.champs) => { const r = rng(salt); let c; do { c = pick(from, r); } while (used.has(c.id)); used.add(c.id); return c; };
      const emojiChamps = data.champs.filter(c => EMOJI[c.name]);
      data.answer = {};
      data.answer.emoji = distinct(9, emojiChamps);
      for (const [k, salt] of [["champion", 2], ["lore", 10], ["ability", 3], ["splash", 5]]) data.answer[k] = distinct(salt);
    })(),
    valorant: (async () => {
      const list = (await getJSON("https://valorant-api.com/v1/agents?isPlayableCharacter=true")).data;
      const seen = new Set();
      data.agents = list.filter(a => !seen.has(a.displayName) && seen.add(a.displayName))
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map(a => ({ name: a.displayName, img: a.displayIcon, role: a.role?.displayName || "?",
                     abilities: a.abilities.filter(x => x.displayIcon && x.slot !== "Passive") }));
    })(),
    clan: (async () => {
      try {
        data.clan = (await getJSON(RIOT + "/clan")).members;
      } catch {
        // Live stats are off: read the players list straight from the clan site instead.
        const html = await (await fetch("https://aceclan.lol/")).text();
        const block = html.match(/const players = \[([\s\S]*?)\n\s*\];/)[1];
        data.clan = new Function(`"use strict"; return [${block}];`)().map(p => ({ ...p, roles: p.roles || [], topChamp: null }));
      }
      data.clan.sort((a, b) => a.name.localeCompare(b.name));
    })(),
  };

  // ---- Stage strip and flow -------------------------------------------------------------------
  let stageAbort = null;
  const current = () => STAGES.find(st => !save.results[st.key]);

  function drawStrip() {
    const cur = current();
    $("stages").innerHTML = STAGES.map(st => {
      const r = save.results[st.key];
      const cls = r ? (r.solved ? "won" : "lost") : st === cur ? "current" : "locked";
      const pt = r ? (r.skipped ? "skipped" : r.solved ? `+${points(st, r)}` : "0") : st === cur ? "now" : "🔒";
      return `<li class="${cls}" title="${esc(st.name)}"><span class="ic">${st.icon}</span><span class="nm">${esc(st.name)}</span><span class="pt">${pt}</span></li>`;
    }).join("");
    $("total").textContent = STAGES.reduce((a, st) => a + points(st, save.results[st.key]), 0);
  }

  function show() {
    if (stageAbort) stageAbort.abort();
    stageAbort = new AbortController();
    drawStrip();
    const st = current();
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
  function complete(st, el, guesses, solved, answerHtml) {
    if (!save.results[st.key]) {
      save.results[st.key] = { guesses, solved };
      persist();
      FX.sound(solved ? "chime" : "lose");
    }
    drawStrip();
    const pts = points(st, save.results[st.key]);
    const box = document.createElement("div");
    box.className = "result " + (solved ? "won" : "lost");
    const last = !current();
    box.innerHTML = `<span>${solved ? `<b>Got it in ${guesses}!</b> +${pts} points` : `<b>Out of guesses.</b> It was ${answerHtml}.`}</span>
      <button class="btn primary" type="button">${last ? "See your score" : "Next stage →"}</button>`;
    box.querySelector("button").onclick = () => { show(); scrollTo({ top: 0, behavior: "smooth" }); };
    el.append(box);
    box.querySelector("button").focus({ preventScroll: true });
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
    const answer = pick(window.ACEDLE_WORDS, rng(1));
    const rows = save.guesses.word = save.guesses.word || [];
    let cur = "", over = false, flipRow = -1;
    el.innerHTML = header(st, "Guess the five-letter word. <b style=\"color:#3fbf7f\">Green</b>: right letter, right spot. <b style=\"color:#c89b3c\">Gold</b>: in the word, wrong spot. Grey: not in it.")
      + `<div class="wgrid" id="wgrid"></div><div class="keys" id="keys"></div>`;
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
        if (cur.length < 5) {
          const row = $("wgrid").children[rows.length];
          row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake");
          FX.sound("buzz");
          return;
        }
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
      + `<div id="pickHolder"></div><div class="clues"><table><thead><tr><th>Champion</th><th>Class</th><th>Also</th><th>Resource</th><th>Range</th><th>Attack range</th>${data.regions ? "<th>Region</th>" : ""}</tr></thead><tbody id="rows"></tbody></table></div>
      <div class="key-legend"><span><i style="background:#2f9e44"></i>Match</span><span><i style="background:#c89b3c"></i>Partly (one of their classes)</span><span><i style="background:#3a3f4d"></i>No match</span><span>↑ ↓ the answer is higher or lower</span></div>
      <div id="tries"></div>`;
    const options = data.champs.map(c => ({ ...c, used: names.includes(c.id) }));
    const num = (g, a) => g === a ? `<td class="g">${g}</td>` : `<td class="x">${g}<span class="ar">${a > g ? "↑" : "↓"}</span></td>`;
    const cls = (g, a1, a2, exact) => g === exact ? "g" : g !== "None" && (g === a1 || g === a2) ? "y" : "x";
    const row = (c, isNew) => `<tr class="${isNew ? "new" : ""}"><td class="who" title="${esc(c.name)}"><img src="${esc(c.img)}" alt="${esc(c.name)}"></td>
      <td class="${cls(c.cls, answer.cls, answer.cls2, answer.cls)}">${esc(c.cls)}</td>
      <td class="${cls(c.cls2, answer.cls, answer.cls2, answer.cls2)}">${esc(c.cls2)}</td>
      <td class="${c.resource === answer.resource ? "g" : "x"}">${esc(c.resource)}</td>
      <td class="${c.melee === answer.melee ? "g" : "x"}">${c.melee ? "Melee" : "Ranged"}</td>
      ${num(c.range, answer.range)}${data.regions ? `<td class="${c.region && c.region === answer.region ? "g" : "x"}">${esc(c.region || "Unknown")}</td>` : ""}</tr>`;
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
  function pictureStage(el, st, { how, picture, update, hints, options, answerName, answerHtml, placeholder, key }) {
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
      if (solved() || names.length >= st.max) { p.done(); complete(st, el, names.length, solved(), answerHtml); }
    }, placeholder);
    draw();
    if (solved() || names.length >= st.max) { p.done(); complete(st, el, names.length, solved(), answerHtml); }
    else p.input.focus({ preventScroll: true });
  }

  async function stageAbility(el, st) {
    await ready.league;
    const answer = data.answer.ability;
    const full = (await getJSON(`${DD}/cdn/${data.dd}/data/en_US/champion/${answer.id}.json`)).data[answer.id];
    const slot = Math.floor(rng(4)() * 5);                    // 0 = passive, 1-4 = Q W E R
    const ab = slot ? full.spells[slot - 1] : full.passive;
    const src = `${DD}/cdn/${data.dd}/img/${slot ? "spell" : "passive"}/${ab.image.full}`;
    const blur = [9, 6, 3.5, 1.5, 0.5], grey = [1, 0.85, 0.6, 0.3, 0.1];
    pictureStage(el, st, {
      key: "ability", placeholder: "Type a champion…",
      how: "Whose ability is this? It gets clearer, and you get hints, with every wrong guess.",
      picture: `<div class="frame"><img id="pic" src="${esc(src)}" alt="A League ability icon"></div>`,
      update: m => { const img = $("pic"); img.style.filter = m >= 99 ? "none" : `blur(${blur[m] ?? 0}px) grayscale(${grey[m] ?? 0})`; },
      hints: [`Key: <b>${["Passive", "Q", "W", "E", "R"][slot]}</b>`, `Class: <b>${esc(answer.cls)}</b>`, `Ability: <b>${esc(ab.name)}</b>`],
      options: data.champs.map(c => ({ name: c.name, img: c.img })), answerName: answer.name,
      answerHtml: `<b>${esc(answer.name)}</b> (${esc(ab.name)})`,
    });
  }

  async function stageAgent(el, st) {
    await ready.valorant;
    const r = rng(6);
    const agent = pick(data.agents, r);
    const ab = pick(agent.abilities, r);
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
      hints: [`Class: <b>${esc(answer.cls)}</b>`, `<b>${answer.melee ? "Melee" : "Ranged"}</b>`, `Title: <b>${esc(answer.title)}</b>`],
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
      hints: [`Class: <b>${esc(answer.cls)}</b>`, `<b>${answer.melee ? "Melee" : "Ranged"}</b>`, `Resource: <b>${esc(answer.resource)}</b>`],
      options: data.champs.map(c => ({ name: c.name, img: c.img })), answerName: answer.name,
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
    const answer = pick(data.clan, rng(8));
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

  const STAGE_FN = { word: stageWord, champion: stageChampion, lore: stageLore, ability: stageAbility, emoji: stageEmoji, agent: stageAgent, splash: stageSplash, ace: stageAce };

  // ---- Finish: score, streak, share, leaderboard -----------------------------------------------
  function shareText(total) {
    const lines = STAGES.map(st => {
      const r = save.results[st.key];
      const bar = r.solved ? "🟩".repeat(Math.max(1, Math.round(points(st, r) / 20))) : "🟥";
      return `${st.icon} ${r.solved ? `${r.guesses}/${st.max}` : "X/" + st.max} ${bar}`;
    });
    return `ACEdle #${DAY}: ${total}/800\n${lines.join("\n")}\nhttps://games.aceclan.lol/acedle/`;
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
    const name = save.name || store.get("acedle-name", "");
    el.innerHTML = `<h2>Run complete</h2>
      <div class="big">${total} <small style="font-size:1.1rem;color:var(--muted)">/ 800</small></div>
      <ul class="breakdown">${STAGES.map(st => { const r = save.results[st.key];
        return `<li><span>${st.icon} ${esc(st.name)} <span class="muted">${r.skipped ? "skipped" : r.solved ? `${r.guesses} of ${st.max} guesses` : "missed"}</span></span><b>${points(st, r)}</b></li>`; }).join("")}</ul>
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

  $("dayNo").textContent = "#" + DAY;
  document.querySelector(".top")?.append(FX.soundButton() || "");
  show();
})();
