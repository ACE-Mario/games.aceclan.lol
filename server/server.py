"""ACE Games live server.

Runs the online rooms for games.aceclan.lol. The website itself stays on GitHub Pages; this
server only relays moves between players. It is reached at https://play.aceclan.lol through a
Cloudflare Tunnel, which this script starts and stops by itself (see cloudflared.yml).

Start it with "Games server.bat" in G:\\AceClan, or:
    python server.py            # server + tunnel (players can join from the internet)
    python server.py --local    # server only, for testing at http://localhost:5050
"""
import atexit
import logging
import os
import random
import re
import subprocess
import sys
import threading
import time

from flask import Flask, abort, jsonify, request, send_from_directory
from flask_socketio import SocketIO, join_room

from games import GAMES

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)                      # the games.aceclan.lol folder
PORT = int(os.environ.get("ACE_GAMES_PORT", "5050"))
CLOUDFLARED = r"C:\Program Files (x86)\cloudflared\cloudflared.exe"
TUNNEL_CONFIG = os.path.join(HERE, "cloudflared.yml")

ALLOWED_ORIGINS = [
    "https://games.aceclan.lol", "http://games.aceclan.lol", "https://play.aceclan.lol",
    f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}",
]
MAX_ROOMS = 60
MAX_PLAYERS = 30
ROOM_IDLE_SECONDS = 6 * 60 * 60                   # rooms nobody has touched for 6 hours are removed
CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"         # no I or O, so codes are easy to read out
PLAYER_ID = re.compile(r"^[A-Za-z0-9]{8,40}$")

app = Flask(__name__, static_folder=None)
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins=ALLOWED_ORIGINS)
lock = threading.RLock()


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ---- Rooms ---------------------------------------------------------------------------------
class Room:
    def __init__(self, code, game, options):
        self.code = code
        self.game = game
        self.state = game.new_state(options)
        self.players = {}          # player id -> {"name", "team", "role", "sids": set()}
        self.host = None
        self.touched = time.time()

    def is_host(self, pid):
        """The leader (host) runs the room. If they have left, anyone still here can act as leader."""
        host = self.players.get(self.host)
        if self.players.get(pid, {}).get("bot"):
            return False
        return pid == self.host or not host or not host["sids"]

    def public_players(self):
        return [{"id": pid, "name": p["name"], "team": p.get("team"), "role": p.get("role"),
                 "online": bool(p["sids"]) or bool(p.get("bot")), "bot": bool(p.get("bot"))}
                for pid, p in self.players.items()]


rooms = {}
sid_index = {}                     # socket id -> (room code, player id)


def new_code():
    while True:
        code = "".join(random.choice(CODE_LETTERS) for _ in range(4))
        if code not in rooms and not any(getattr(g, "reserved", lambda c: False)(code) for g in GAMES.values()):
            return code


def restore_room(code):
    """A game that saves its rooms (ACE Board) can bring one back after a restart or once it closed
    when idle: its restore(code) returns the saved state, or None."""
    if len(rooms) >= MAX_ROOMS:
        return None
    for game in GAMES.values():
        restore = getattr(game, "restore", None)
        state = restore(code) if restore else None
        if state:
            room = Room(code, game, {})
            room.state = state
            rooms[code] = room
            log(f"room {code} brought back from disk ({game.name})")
            return room
    return None


def clean_name(value):
    name = re.sub(r"\s+", " ", str(value or "")).strip()[:20]
    return name or "Agent"


def broadcast(room):
    """Send every connected player their own view (spymasters see the key, others don't)."""
    shared = {"room": room.code, "game": room.game.id, "host": room.host,
              "players": room.public_players()}
    for pid, p in room.players.items():
        view = room.game.view(room, pid)
        payload = {**shared, **view, "you": pid, "isHost": room.is_host(pid)}
        for sid in list(p["sids"]):
            socketio.emit("state", payload, to=sid)


def seat_player(room, pid, name, sid):
    p = room.players.get(pid)
    if p is None:
        if len(room.players) >= MAX_PLAYERS:
            return "This room is full."
        p = {"name": name, "sids": set()}
        p.update(room.game.default_seat(room))
        room.players[pid] = p
    else:
        p["name"] = name
    p["sids"].add(sid)
    if room.host is None or room.host not in room.players:
        room.host = pid
    sid_index[sid] = (room.code, pid)
    join_room(room.code)
    room.touched = time.time()
    return None


def tick_loop():
    """Games with a clock (trivia timers, the pause between poker hands) get a tick a few
    times a second. A game's tick returns True when something changed and everyone needs
    a fresh view."""
    while True:
        socketio.sleep(0.25)
        with lock:
            now = time.time()
            for room in list(rooms.values()):
                tick = getattr(room.game, "tick", None)
                if tick:
                    try:
                        changed = tick(room, now)
                    except Exception as e:                   # a bug in one game must not stop the clock
                        log(f"room {room.code} tick error: {e!r}")
                        changed = False
                    if changed:
                        broadcast(room)


def cleanup_loop():
    while True:
        socketio.sleep(600)
        with lock:
            now = time.time()
            for code in [c for c, r in rooms.items() if now - r.touched > ROOM_IDLE_SECONDS]:
                log(f"room {code} closed (idle)")
                del rooms[code]


# ---- Socket events -------------------------------------------------------------------------
@socketio.on("create")
def on_create(data):
    data = data or {}
    pid = str(data.get("playerId", ""))
    game = GAMES.get(data.get("game"))
    if not PLAYER_ID.match(pid) or not game:
        return {"error": "Couldn't create a room. Reload the page and try again."}
    with lock:
        if len(rooms) >= MAX_ROOMS:
            return {"error": "The server has too many rooms open right now."}
        room = Room(new_code(), game, data.get("options") or {})
        rooms[room.code] = room
        room.host = pid
        seat_player(room, pid, clean_name(data.get("name")), request.sid)
        log(f"room {room.code} created ({game.name}) by {room.players[pid]['name']}")
        broadcast(room)
        return {"room": room.code}


@socketio.on("join")
def on_join(data):
    data = data or {}
    pid = str(data.get("playerId", ""))
    code = str(data.get("room", "")).upper().strip()
    if not PLAYER_ID.match(pid):
        return {"error": "Couldn't join. Reload the page and try again."}
    with lock:
        room = rooms.get(code) or restore_room(code)
        if not room:
            return {"error": f"There's no room {code}. Check the code, or create a new room."}
        err = seat_player(room, pid, clean_name(data.get("name")), request.sid)
        if err:
            return {"error": err}
        broadcast(room)
        return {"room": room.code, "game": room.game.id}


@socketio.on("action")
def on_action(data):
    data = data or {}
    with lock:
        where = sid_index.get(request.sid)
        room = rooms.get(where[0]) if where else None
        if not room:
            return {"error": "You're not in a room. Reload the page to rejoin."}
        pid = where[1]
        if data.get("type") == "rename":
            room.players[pid]["name"] = clean_name(data.get("name"))
            err = None
        elif data.get("type") == "make_leader":
            target = str(data.get("player", ""))
            if not room.is_host(pid):
                err = "Only the leader can hand over leader."
            elif target not in room.players:
                err = "That player isn't in this room any more."
            elif room.players[target].get("bot"):
                err = "A bot can't be the leader."
            else:
                room.host = target
                err = None
                room.game._log(room.state, f"[Admin] {room.players[pid]['name']} made "
                                           f"{room.players[target]['name']} the leader.", "admin")
        else:
            err = room.game.handle(room, pid, str(data.get("type", "")), data)
        room.touched = time.time()
        if not err:
            broadcast(room)
        return {"error": err} if err else {"ok": True}


@socketio.on("live")
def on_live(data):
    """Quick messages that don't change the whole room (lines being drawn in Sketch & Guess). The game's
    relay() checks them and says what to pass on; it goes to everyone else in the room, without the
    full update every player gets for a move."""
    with lock:
        where = sid_index.get(request.sid)
        room = rooms.get(where[0]) if where else None
        relay = getattr(room.game, "relay", None) if room else None
        if not relay or not isinstance(data, dict):
            return
        out = relay(room, where[1], data)
        if out is not None:
            room.touched = time.time()
            socketio.emit("live", out, to=room.code, skip_sid=request.sid)


@socketio.on("disconnect")
def on_disconnect(*_):
    with lock:
        where = sid_index.pop(request.sid, None)
        room = rooms.get(where[0]) if where else None
        if room and where[1] in room.players:
            room.players[where[1]]["sids"].discard(request.sid)
            broadcast(room)


# ---- HTTP: health check and (for local testing) the website files --------------------------
@app.after_request
def cors(resp):
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS and request.path == "/health":
        resp.headers["Access-Control-Allow-Origin"] = origin
    return resp


@app.route("/health")
def health():
    return jsonify(ok=True, games=list(GAMES), rooms=len(rooms))


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def site(path):
    parts = path.split("/")
    if parts[0] == "server" or any(p.startswith(".") for p in parts):
        abort(404)
    full = os.path.join(SITE, path)
    if os.path.isdir(full):
        if path and not path.endswith("/"):
            return app.redirect("/" + path + "/")
        path = path + "index.html"
    return send_from_directory(SITE, path)


# ---- Tunnel --------------------------------------------------------------------------------
def close_with_us(proc):
    """Put the tunnel in a Windows job object, so closing this window also closes the tunnel."""
    if os.name != "nt":
        return
    import ctypes
    from ctypes import wintypes

    class IoCounters(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]

    class Basic(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                    ("SchedulingClass", wintypes.DWORD)]

    class Extended(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", IoCounters),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    k32 = ctypes.windll.kernel32
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    job = k32.CreateJobObjectW(None, None)
    info = Extended()
    info.BasicLimitInformation.LimitFlags = 0x2000          # kill the tunnel when this process ends
    k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))
    k32.AssignProcessToJobObject(job, int(proc._handle))
    globals()["_tunnel_job"] = job                          # keep the handle open while we run


def start_tunnel():
    if not os.path.exists(TUNNEL_CONFIG) or not os.path.exists(CLOUDFLARED):
        log("tunnel not started: cloudflared or cloudflared.yml is missing")
        return
    proc = subprocess.Popen([CLOUDFLARED, "tunnel", "--config", TUNNEL_CONFIG, "run"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    close_with_us(proc)
    atexit.register(proc.terminate)
    log("tunnel started: https://play.aceclan.lol")


class QuietHealth(logging.Filter):
    """ACE Status checks /health every 20 seconds; leave those out of the log."""
    def filter(self, record):
        return "/health" not in record.getMessage()


if __name__ == "__main__":
    local = "--local" in sys.argv
    logging.getLogger("werkzeug").addFilter(QuietHealth())
    if not local:
        start_tunnel()
    socketio.start_background_task(cleanup_loop)
    socketio.start_background_task(tick_loop)
    log(f"ACE Games server on http://localhost:{PORT}  (games: {', '.join(g.name for g in GAMES.values())})")
    log("Close this window to stop the server" + ("" if local else " and the tunnel") + ".")
    socketio.run(app, host="127.0.0.1", port=PORT, debug=False, use_reloader=False,
                 allow_unsafe_werkzeug=True)
