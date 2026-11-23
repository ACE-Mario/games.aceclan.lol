"""ACE Board rules for live rooms: a shared whiteboard for ideas and studying.

Anyone in the room can write text and sticky notes, draw with the pen or highlighter, add boxes,
circles and arrows, and paste or drop pictures anywhere on the board, and everyone sees it as it
happens. You can move, change and delete your own things; the leader can also delete anyone's and
clear the whole board. Hiding someone's writing (the eye button) happens in each viewer's browser,
so the server doesn't need to know about it.

Changes travel as small "live" messages (see relay below), not the full room update, so a line
being drawn or a word being typed shows up straight away. Everything is also kept here, so anyone
who joins or reconnects gets the whole board. Pictures can be big, so the full board is only sent
to a browser that doesn't have it yet (see view); other room updates just list the item ids, which
lets each browser drop anything it shouldn't have and ask for the board again if it missed something.

Boards are saved to server/saved/boards/<CODE>.json a few seconds after each change, so restarting
the server or a room closing when idle doesn't lose them: joining with the code brings the board
back (server.py asks restore()). A saved board is deleted after SAVE_DAYS without being used, and
a code with a saved board is never given to a new room (reserved()).

There are no points: only the daily games have those.
"""
import json
import os
import re
import threading
import time

FAR = 1_000_000                   # the board has no edges; this only keeps numbers sensible
BIG = 8000                        # widest or tallest a picture or shape can be made
MAX_ITEMS = 1500
MAX_TEXT = 3000                   # characters in one text box or sticky note
MAX_IMAGES = 60
MAX_IMAGE_CHARS = 700_000         # one picture, as a data: URL (the page shrinks pictures before sending)
MAX_IMAGE_TOTAL = 15_000_000      # all the pictures on one board together
MAX_STROKE = 6000                 # numbers in one pen line (x, y, x, y, ...)
MAX_INK = 400_000                 # numbers in every pen line on the board together
MAX_CHUNK = 400                   # numbers in one live piece of a line
TEXT_SIZES = (14, 18, 20, 24, 36, 56, 80)
SHAPES = ("rect", "ellipse", "line", "arrow")

SAVE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "saved", "boards")
SAVE_AFTER = 3                    # seconds after a change before the board is written to disk
SAVE_DAYS = 30                    # saved boards nobody has opened for this long are deleted
MAX_SAVED = 400                   # and only the newest this many are kept

ITEM_ID = re.compile(r"^[A-Za-z0-9]{6,24}$")
ROOM_CODE = re.compile(r"^[A-Z]{4}$")
COLOUR = re.compile(r"^#[0-9a-f]{6}$")
IMAGE = re.compile(r"^data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$")


def num(value, lo, hi):
    try:
        return max(lo, min(hi, int(round(float(value)))))
    except (TypeError, ValueError, OverflowError):
        return None


def colour(value, default="#1f2328"):
    c = str(value or "").lower()
    return c if COLOUR.match(c) else default


def clean_text(value):
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", text)[:MAX_TEXT]
    return text if text.strip() else ""


def text_size(value):
    size = num(value, 10, 120)
    return None if size is None else min(TEXT_SIZES, key=lambda v: abs(v - size))


def points(value):
    if not isinstance(value, list) or len(value) % 2 or len(value) > MAX_CHUNK:
        return None
    out = []
    for v in value:
        n = num(v, -FAR, FAR)
        if n is None:
            return None
        out.append(n)
    return out


# ---- Saving boards to disk -----------------------------------------------------------------
# Writing happens on one background thread, so a big board never holds up the live server.
_writes = {}                      # room code -> json text to write (None: delete the file)
_wake = threading.Condition()
_writer = None


def _path(code):
    return os.path.join(SAVE_DIR, code + ".json")


def _write_loop():
    _prune()
    while True:
        with _wake:
            while not _writes:
                _wake.wait()
            code, text = _writes.popitem()
        try:
            os.makedirs(SAVE_DIR, exist_ok=True)
            if text is None:
                if os.path.exists(_path(code)):
                    os.remove(_path(code))
            else:
                tmp = _path(code) + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(text)
                os.replace(tmp, _path(code))
        except OSError as e:
            print(time.strftime("%H:%M:%S"), f"board {code} not saved: {e!r}", flush=True)


def _queue_write(code, text):
    global _writer
    with _wake:
        _writes[code] = text
        if _writer is None:
            _writer = threading.Thread(target=_write_loop, name="board-saver", daemon=True)
            _writer.start()
        _wake.notify()


def _prune():
    """Delete saved boards nobody has opened for SAVE_DAYS, and the oldest past MAX_SAVED."""
    try:
        files = [os.path.join(SAVE_DIR, f) for f in os.listdir(SAVE_DIR) if f.endswith(".json")]
    except OSError:
        return
    files.sort(key=os.path.getmtime, reverse=True)
    cutoff = time.time() - SAVE_DAYS * 86400
    for n, f in enumerate(files):
        if n >= MAX_SAVED or os.path.getmtime(f) < cutoff:
            try:
                os.remove(f)
            except OSError:
                pass


class Board:
    id = "board"
    name = "ACE Board"
    _last_prune = 0.0

    def new_state(self, options=None, old=None):
        return {"items": {}, "names": {}, "synced": {}, "ink": 0, "log": [], "dirty": False, "changed": 0.0}

    def default_seat(self, room):
        return {}

    def _log(self, s, text, kind=""):
        s["log"].append({"text": text, "kind": kind})
        del s["log"][:-30]

    def _changed(self, s):
        s["dirty"] = True
        s["changed"] = time.time()

    def _image_chars(self, s):
        return sum(len(i["src"]) for i in s["items"].values() if i["kind"] == "image")

    # ---- Saving and bringing boards back (server.py calls restore and reserved) -------------
    def tick(self, room, now):
        s = room.state
        if s.get("dirty") and now - s["changed"] >= SAVE_AFTER:
            s["dirty"] = False
            items = list(s["items"].values())
            names = {p: s["names"].get(p, "") for p in {i["by"] for i in items}}
            _queue_write(room.code, json.dumps({"code": room.code, "saved": int(now), "items": items, "names": names},
                                               separators=(",", ":")) if items else None)
        if now - Board._last_prune > 86400:
            Board._last_prune = now
            threading.Thread(target=_prune, daemon=True).start()
        return False

    def restore(self, code):
        """The saved board for this room code, as a fresh room state (or None if there isn't one)."""
        if not ROOM_CODE.match(code) or not os.path.exists(_path(code)):
            return None
        try:
            with open(_path(code), encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return None
        s = self.new_state()
        for it in data.get("items", []):
            if isinstance(it, dict) and ITEM_ID.match(str(it.get("id", ""))) and it.get("kind") in ("text", "image", "pen", "shape"):
                s["items"][it["id"]] = it
        s["ink"] = sum(len(i.get("p", [])) for i in s["items"].values() if i["kind"] == "pen")
        names = data.get("names")
        if isinstance(names, dict):
            s["names"] = {str(k): str(v)[:20] for k, v in names.items()}
        try:
            os.utime(_path(code))                    # opened again: keep it another SAVE_DAYS
        except OSError:
            pass
        return s

    def reserved(self, code):
        return os.path.exists(_path(code))

    # ---- Room actions (these send everyone a fresh room update) ----------------------------
    def handle(self, room, pid, action, data):
        s = room.state
        name = room.players[pid]["name"]
        if action == "resync":                        # "I've missed something: send me the whole board"
            s["synced"].pop(pid, None)
            return None
        if action == "clear_mine":
            mine = [i for i, it in s["items"].items() if it["by"] == pid]
            for i in mine:
                self._drop(s, i)
            if mine:
                self._log(s, f"{name} cleared their things.")
                self._changed(s)
            return None
        if action == "clear_all":
            if not room.is_host(pid):
                return "Only the leader can clear the whole board."
            s["items"].clear()
            s["ink"] = 0
            self._log(s, f"{name} cleared the board.", "admin")
            self._changed(s)
            return None
        return "Unknown action."

    def _drop(self, s, iid):
        it = s["items"].pop(iid, None)
        if it and it["kind"] == "pen":
            s["ink"] -= len(it["p"])

    # ---- Live changes ----------------------------------------------------------------------
    def _new_item(self, s, pid, d):
        if not isinstance(d, dict):
            return None
        iid = str(d.get("id", ""))
        if not ITEM_ID.match(iid) or iid in s["items"] or len(s["items"]) >= MAX_ITEMS:
            return None
        kind = d.get("kind")
        x, y = num(d.get("x"), -FAR, FAR), num(d.get("y"), -FAR, FAR)
        if x is None or y is None:
            return None
        base = {"id": iid, "by": pid, "kind": kind, "x": x, "y": y}
        if kind == "text":                            # a text box, or a sticky note when it has a bg colour
            text = clean_text(d.get("text"))
            size = text_size(d.get("s"))
            if not text or size is None:
                return None
            item = {**base, "text": text, "c": colour(d.get("c")), "s": size}
            if d.get("bg"):
                item["bg"] = colour(d.get("bg"), "#fff3a3")
            return item
        if kind == "image":
            src = str(d.get("src", ""))
            w, h = num(d.get("w"), 16, BIG), num(d.get("h"), 16, BIG)
            if w is None or h is None or len(src) > MAX_IMAGE_CHARS or not IMAGE.match(src):
                return None
            if sum(1 for i in s["items"].values() if i["kind"] == "image") >= MAX_IMAGES:
                return None
            if self._image_chars(s) + len(src) > MAX_IMAGE_TOTAL:
                return None
            return {**base, "w": w, "h": h, "src": src}
        if kind == "pen":                             # x, y is how far the line has been moved
            p = points(d.get("p"))
            w = num(d.get("w"), 1, 80)
            if not p or w is None or s["ink"] + len(p) > MAX_INK:
                return None
            s["ink"] += len(p)
            item = {**base, "c": colour(d.get("c")), "w": w, "p": p}
            if d.get("hl"):
                item["hl"] = True                     # highlighter: wide and see-through
            return item
        if kind == "shape":
            shape = d.get("shape")
            w, h = num(d.get("w"), -BIG, BIG), num(d.get("h"), -BIG, BIG)
            sw = num(d.get("sw"), 1, 40)
            if shape not in SHAPES or w is None or h is None or sw is None:
                return None
            return {**base, "shape": shape, "w": w, "h": h, "c": colour(d.get("c")), "sw": sw,
                    "fill": bool(d.get("fill")) and shape in ("rect", "ellipse")}
        return None

    def relay(self, room, pid, data):
        """One change from a player: check it, keep it, and return what to pass on to everyone else."""
        s = room.state
        kind = data.get("k")
        if kind == "cur":                             # where someone's pointer is: passed on, never kept
            if data.get("off"):
                return {"k": "cur", "by": pid, "off": True}
            x, y = num(data.get("x"), -FAR, FAR), num(data.get("y"), -FAR, FAR)
            return None if x is None or y is None else {"k": "cur", "by": pid, "x": x, "y": y}
        if kind == "add":
            item = self._new_item(s, pid, data.get("item"))
            if not item:
                return None
            s["items"][item["id"]] = item
            s["names"][pid] = room.players[pid]["name"]           # kept with the board, for saved boards
            self._changed(s)
            return {"k": "add", "item": item}

        it = s["items"].get(str(data.get("id", "")))
        if not it:
            return None
        if kind == "del" and (it["by"] == pid or room.is_host(pid)):     # the leader can delete anyone's
            self._drop(s, it["id"])
            self._changed(s)
            return {"k": "del", "id": it["id"]}
        if it["by"] != pid:                           # otherwise you can only change your own things
            return None
        out = None
        if kind == "pts":
            p = points(data.get("p"))
            if it["kind"] != "pen" or not p or len(it["p"]) + len(p) > MAX_STROKE or s["ink"] + len(p) > MAX_INK:
                return None
            it["p"] += p
            s["ink"] += len(p)
            out = {"k": "pts", "id": it["id"], "p": p}
        elif kind == "move":
            x, y = num(data.get("x"), -FAR, FAR), num(data.get("y"), -FAR, FAR)
            if x is None or y is None:
                return None
            it["x"], it["y"] = x, y
            out = {"k": "move", "id": it["id"], "x": x, "y": y}
            if it["kind"] in ("image", "shape") and "w" in data:
                lo = 16 if it["kind"] == "image" else -BIG
                w, h = num(data.get("w"), lo, BIG), num(data.get("h"), lo, BIG)
                if w is not None and h is not None:
                    it["w"], it["h"] = w, h
                    out.update(w=w, h=h)
        elif kind == "edit":
            if it["kind"] == "image":
                return None
            if it["kind"] == "text" and "text" in data:
                text = clean_text(data.get("text"))
                if not text:
                    return None
                it["text"] = text
            if "c" in data:
                it["c"] = colour(data.get("c"), it["c"])
            if it["kind"] == "text" and "bg" in it and "bg" in data:
                it["bg"] = colour(data.get("bg"), it["bg"])
            if it["kind"] == "text" and "s" in data:
                it["s"] = text_size(data.get("s")) or it["s"]
            out = {"k": "edit", "id": it["id"], "c": it["c"]}
            if it["kind"] == "text":
                out.update(text=it["text"], s=it["s"])
                if "bg" in it:
                    out["bg"] = it["bg"]
        if out:
            self._changed(s)
        return out

    # ---- View ------------------------------------------------------------------------------
    def view(self, room, pid):
        s = room.state
        player = room.players.get(pid) or {}
        sids = set(player.get("sids") or ())
        had = s["synced"].get(pid)
        full = had is None or not sids <= had        # a new tab or a reconnect: it needs the whole board
        if full:
            s["synced"][pid] = sids
        out = {
            "ids": list(s["items"]),
            "colours": {p: n for n, p in enumerate(room.players)},     # player colour = order they arrived
            # People whose things are on the board but who aren't in the room (a board brought back from disk).
            "authors": {p: s["names"].get(p) or "Someone" for p in {i["by"] for i in s["items"].values()}
                        if p not in room.players},
            "log": s["log"][-12:],
            "limits": {"items": MAX_ITEMS, "text": MAX_TEXT, "images": MAX_IMAGES, "image": MAX_IMAGE_CHARS,
                       "imageTotal": MAX_IMAGE_TOTAL, "stroke": MAX_STROKE, "chunk": MAX_CHUNK},
        }
        if full:
            out["items"] = list(s["items"].values())
        return out
