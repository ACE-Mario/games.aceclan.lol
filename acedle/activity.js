// ACEdle as a Discord Activity: the same daily run, played inside a voice call.
// index.html only loads this file (with vendor/discord-sdk.js and vendor/socket.io.min.js) when the
// page is opened by Discord. Then:
//  - Requests go through Discord's proxy (<app id>.discordsays.com), because inside Discord a page may
//    only talk to its own address. Each outside site has a prefix, set up as URL Mappings in the
//    Discord Developer Portal (see MAP below; the README lists them).
//  - You sign in with Discord (the games server swaps the code for a token, server/discord_auth.py),
//    so your name is your Discord name.
//  - Everyone in the call joins one live room on the games server (server/games/acedle.py) and sees
//    each other's progress: stages done, guesses and points. Never the answers.
window.AceActivity = (() => {
  const params = new URLSearchParams(location.search);
  const PROXIED = /\.discordsays\.com$/.test(location.hostname);
  // Outside site -> prefix on the proxy. Most specific first (the SDK matches the end of the host name).
  const MAP = [
    ["media.valorant-api.com", "/valmedia"],
    ["valorant-api.com", "/valapi"],
    ["universe-meeps.leagueoflegends.com", "/meeps"],
    ["ddragon.leagueoflegends.com", "/ddragon"],
    ["cdn.discordapp.com", "/dcdn"],
    ["riot.aceclan.lol", "/riot"],
    ["play.aceclan.lol", "/play"],
    ["aceclan.lol", "/clan"],
  ];
  const PLAY = PROXIED ? "/play" : (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "" : "https://play.aceclan.lol");

  // An outside address as the page must ask for it (unchanged outside Discord's proxy).
  function url(u) {
    if (!PROXIED || !u) return u;
    try {
      const x = new URL(u, location.href);
      const hit = MAP.find(([host]) => x.hostname === host);
      const path = /^https?:\/\/[^/]+$/i.test(u) ? "" : x.pathname;     // a bare host stays bare, so `${DD}/cdn` works
      return hit ? location.origin + hit[1] + path + x.search : u;
    } catch { return u; }
  }
  // The same for links inside downloaded data (VALORANT's pictures are on media.valorant-api.com).
  function rewrite(text) {
    if (!PROXIED) return text;
    for (const [host, prefix] of MAP) text = text.split("https://" + host + "/").join(location.origin + prefix + "/");
    return text;
  }
  if (PROXIED && window.DiscordSDKLib) {
    // Catch anything not passed through url(): fetches, and <img src> added to the page.
    DiscordSDKLib.patchUrlMappings(MAP.map(([target, prefix]) => ({ prefix, target })), { patchSrcAttributes: true });
  }
  document.documentElement.classList.add("in-discord");

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const api = {
    url, rewrite, user: null, ready: null,
    progress(p) { last = p; if (p.all) stages = p.all; draw(); send(); },
  };
  let last = null, sock = null, hello = false, ticket = null, stages = [], view = null, seen = 0;

  // ---- The "In this call" panel ---------------------------------------------------------------
  const panel = document.createElement("section");
  panel.className = "call";
  panel.innerHTML = `<h3>In this call <span class="call-state" id="callState">Signing in with Discord…</span></h3><ul class="call-people" id="callPeople"></ul><ul class="call-feed" id="callFeed"></ul>`;
  const place = () => { const top = document.querySelector(".acedle .top"); if (top && !panel.isConnected) top.after(panel); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place); else place();
  // A profile picture that won't load (no /dcdn mapping) becomes the person's initial.
  panel.addEventListener("error", e => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    const s = document.createElement("span");
    s.className = "initial";
    s.textContent = (img.dataset.name || "?").trim().charAt(0).toUpperCase() || "?";
    img.replaceWith(s);
  }, true);
  const setState = t => { const el = document.getElementById("callState"); if (el) el.textContent = t; };

  function avatar(p) {
    if (p.avatar) return url(`https://cdn.discordapp.com/avatars/${p.uid}/${p.avatar}.png?size=64`);
    const n = Number(BigInt(p.uid || "0") >> 22n) % 6;
    return url(`https://cdn.discordapp.com/embed/avatars/${n}.png`);
  }

  function draw() {
    if (!view) return;
    const me = api.user && "d" + api.user.id;
    document.getElementById("callPeople").innerHTML = view.people.map((p, i) => {
      const strip = stages.map(st => {
        const r = p.stages[st.key];
        const cls = r ? (r.solved ? "won" : "lost") : st.key === p.current ? "now" : "";
        const tip = `${st.name}: ${r ? (r.skipped ? "skipped" : r.solved ? `${r.guesses} guesses, +${r.points}` : "missed") : st.key === p.current ? "playing now" : "not yet"}`;
        return `<i class="${cls}" title="${esc(tip)}">${st.icon}</i>`;
      }).join("");
      return `<li class="${p.id === me ? "me" : ""}${p.online ? "" : " away"}">
        <span class="rank">${i + 1}</span><img src="${esc(avatar(p))}" alt="" data-name="${esc(p.name)}">
        <span class="who"><b>${esc(p.name)}</b>${p.done ? `<small>finished</small>` : p.online ? "" : `<small>left</small>`}</span>
        <span class="strip">${strip}</span><span class="pts">${p.total}</span></li>`;
    }).join("") || `<li class="muted">Nobody else yet. Others in the call can join from the rocket button.</li>`;
    document.getElementById("callFeed").innerHTML = view.feed.slice(-4).reverse().map(f => `<li>${esc(f.text)}</li>`).join("");
    const fresh = view.feed.filter(f => f.t > seen && !(api.user && f.text.startsWith(api.user.name + " ")));
    if (seen && fresh.length) window.AceFX?.sound?.("tick");
    seen = Math.max(seen, ...view.feed.map(f => f.t), seen);
  }

  // ---- Live room ------------------------------------------------------------------------------
  function send() {
    if (!sock || !hello || !last) return;
    stages = last.all || stages;
    sock.emit("action", { type: "progress", day: last.day, current: last.current, done: last.done, stages: last.stages });
  }

  function connect(instance) {
    const pid = "d" + api.user.id, name = api.user.name.slice(0, 20);
    sock = window.io(PROXIED ? location.origin : (PLAY || location.origin),
      { path: (PROXIED ? "/play" : "") + "/socket.io", transports: ["websocket", "polling"], reconnectionDelayMax: 4000 });
    const greet = () => sock.emit("action", { type: "hello", ticket }, r => {
      if (r?.error) { setState(r.error); return; }
      hello = true;
      setState("");
      send();
    });
    const join = (tries = 0) => sock.emit("join", { playerId: pid, room: "dc:" + instance, name }, r => {
      if (!r?.error) return greet();
      if (tries > 2) return setState("Couldn't join the call's room. Close ACEdle and open it again.");
      sock.emit("create", { game: "acedle", playerId: pid, name, options: { instance } }, c => {
        if (c?.error) join(tries + 1);              // someone else made it first: join theirs
        else greet();
      });
    });
    sock.on("connect", () => { hello = false; setState("Joining…"); join(); });
    sock.on("disconnect", () => { hello = false; setState("Reconnecting to the games server…"); });
    sock.on("connect_error", () => setState("The games server is offline, so you can play but won't see the others."));
    sock.on("state", s => { view = s; draw(); });
  }

  async function start() {
    const app = await (await fetch(PLAY + "/api/discord/app")).json();
    if (!app.client_id) throw new Error("Discord sign-in isn't set up on the games server yet.");
    const sdk = new DiscordSDKLib.DiscordSDK(app.client_id);
    await sdk.ready();
    const { code } = await sdk.commands.authorize({
      client_id: app.client_id, response_type: "code", state: "", prompt: "none", scope: ["identify"],
    });
    const r = await fetch(PLAY + "/api/discord/token", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Discord sign-in failed.");
    await sdk.commands.authenticate({ access_token: d.access_token });
    api.user = d.user;
    ticket = d.ticket;
    setState("Joining…");
    const nameBox = document.getElementById("name");
    if (nameBox && !nameBox.value) nameBox.value = d.user.name.slice(0, 20);
    connect(sdk.instanceId);
    return d.user;
  }

  api.ready = start().catch(e => {
    console.warn("ACEdle activity:", e);
    setState(e.message === "Failed to fetch" ? "The games server is offline, so you can play but won't see the others." : e.message);
    return null;
  });
  return api;
})();
