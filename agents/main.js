// Ace Agents: picks the mode from the link.
//   ?room=KQTZ           online room (live server)
//   ?code=FALCON-42      one-screen game
//   ?code=...&view=key   spymaster key for a one-screen game
//   nothing              start screen
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const cleanRoom = s => String(s || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);

  function setMode(mode) {
    $("startView").hidden = mode !== "start";
    $("boardView").hidden = mode === "start";
    document.querySelectorAll(".only-online").forEach(el => { el.hidden = mode !== "online"; });
    document.querySelectorAll(".only-local").forEach(el => { el.hidden = mode !== "local"; });
  }

  function randomCode() {
    const w = window.CODE_WORDS[Math.floor(Math.random() * window.CODE_WORDS.length)];
    return w.toUpperCase() + "-" + (Math.floor(Math.random() * 90) + 10);
  }

  function goOnline(opts) {
    setMode("online");
    window.startOnlineGame(opts, (msg, room) => showStart(room, msg));
  }

  let startReady = false;
  function showStart(room, error) {
    setMode("start");
    history.replaceState(null, "", room ? "?room=" + room : location.pathname);
    $("roomInput").value = room || "";
    $("playerName").value = AceLive.name();
    $("startError").hidden = !error;
    $("startError").textContent = error || "";
    $("localBtn").href = "?code=" + randomCode() + "&pack=" + ($("startPack").value || "classic");
    (room && !AceLive.name() ? $("playerName") : $("createBtn")).focus();
    if (startReady) return;
    startReady = true;

    const packSel = $("startPack");
    for (const [id, p] of Object.entries(window.WORD_PACKS)) packSel.add(new Option(p.name, id));
    packSel.addEventListener("change", () => {
      $("localBtn").href = "?code=" + randomCode() + "&pack=" + packSel.value;
    });

    const status = $("serverStatus");
    AceLive.isOnline().then(up => {
      status.className = "server-status " + (up ? "up" : "down");
      status.textContent = up
        ? "Game server is online."
        : "Game server is offline right now. Online rooms work while it's running on the ACE host's PC. You can still play on one screen.";
      $("createBtn").disabled = !up;
      $("joinBtn").disabled = !up;
    });

    function needName() {
      const n = $("playerName").value.trim();
      if (!n) {
        $("startError").textContent = "Type your name first, so your team knows who you are.";
        $("startError").hidden = false;
        $("playerName").focus();
        return null;
      }
      AceLive.setName(n);
      return n;
    }
    $("onlineForm").addEventListener("submit", e => {
      e.preventDefault();
      if (!needName()) return;
      goOnline({ create: { pack: packSel.value } });
    });
    $("joinBtn").addEventListener("click", () => {
      const code = cleanRoom($("roomInput").value);
      if (!code || code.length !== 4) {
        $("startError").textContent = "Room codes are 4 letters, like KQTZ.";
        $("startError").hidden = false;
        return;
      }
      if (!needName()) return;
      history.replaceState(null, "", "?room=" + code);
      goOnline({ room: code });
    });
    $("roomInput").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); $("joinBtn").click(); }
    });
  }

  const room = cleanRoom(params.get("room"));
  if (params.get("code") || params.get("view") === "key") {
    setMode("local");
    window.startLocalGame();
  } else if (room && AceLive.name() && window.io) {
    goOnline({ room });
  } else {
    showStart(room);
  }
})();
