// Connection to the ACE Games live server (server/server.py), shared by every game.
// On games.aceclan.lol it talks to https://play.aceclan.lol (the tunnel to the host's PC).
// When the page is opened from the server itself (http://localhost:5050) it uses that.
window.AceLive = (() => {
  const onServer = ["localhost", "127.0.0.1"].includes(location.hostname);
  const SERVER = onServer ? location.origin : "https://play.aceclan.lol";

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked storage: keep going */ } },
  };

  // A random id for this browser, so a refresh puts you back in your seat.
  let memId = "";
  function playerId() {
    let id = store.get("ace-player") || memId;
    if (!/^[A-Za-z0-9]{8,40}$/.test(id)) {
      const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => abc[b % abc.length]).join("");
      store.set("ace-player", id);
      memId = id;
    }
    return id;
  }

  // Is the server running? Resolves to true or false within about 4 seconds.
  async function isOnline() {
    if (!window.io) return false;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(SERVER + "/health", { signal: ctl.signal, cache: "no-store" });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }

  function connect() {
    return window.io(SERVER, { transports: ["websocket", "polling"], reconnectionDelayMax: 4000 });
  }

  return {
    SERVER, store, playerId, isOnline, connect,
    name: () => (store.get("ace-name") || "").slice(0, 20),
    setName: n => store.set("ace-name", n.trim().slice(0, 20)),
  };
})();
