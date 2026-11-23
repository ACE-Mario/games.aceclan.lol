"""ACE Board rules for live rooms: a shared whiteboard for ideas and studying.

Anyone in the room can write text, draw with the pen and paste or drop pictures anywhere on the
board, and everyone sees it as it happens. You can move, change and delete your own things; the
leader can clear the whole board. Hiding someone's writing (the eye button) happens in each
viewer's browser, so the server doesn't need to know about it.

Changes travel as small "live" messages (see relay below), not the full room update, so a line
being drawn or a word being typed shows up straight away. Everything is also kept here, so anyone
who joins or reconnects gets the whole board. Pictures can be big, so the full board is only sent
to a browser that doesn't have it yet (see view); other room updates just list the item ids, which
lets each browser drop anything it shouldn't have and ask for the board again if it missed something.

There are no points: only the daily games have those.
"""
import re

FAR = 1_000_000                   # the board has no edges; this only keeps numbers sensible
BIG = 8000                        # widest or tallest a picture can be made
MAX_ITEMS = 1500
MAX_TEXT = 3000                   # characters in one text box
MAX_IMAGES = 60
MAX_IMAGE_CHARS = 700_000         # one picture, as a data: URL (the page shrinks pictures before sending)
MAX_IMAGE_TOTAL = 15_000_000      # all the pictures on one board together
MAX_STROKE = 6000                 # numbers in one pen line (x, y, x, y, ...)
MAX_INK = 400_000                 # numbers in every pen line on the board together
MAX_CHUNK = 400                   # numbers in one live piece of a line
TEXT_SIZES = (14, 18, 24, 36, 56, 80)

ITEM_ID = re.compile(r"^[A-Za-z0-9]{6,24}$")
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


class Board:
    id = "board"
    name = "ACE Board"

    def new_state(self, options=None, old=None):
        return {"items": {}, "synced": {}, "ink": 0, "log": []}

    def default_seat(self, room):
        return {}

    def _log(self, s, text, kind=""):
        s["log"].append({"text": text, "kind": kind})
        del s["log"][:-30]

    def _image_chars(self, s):
        return sum(len(i["src"]) for i in s["items"].values() if i["kind"] == "image")

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
            return None
        if action == "clear_all":
            if not room.is_host(pid):
                return "Only the leader can clear the whole board."
            s["items"].clear()
            s["ink"] = 0
            self._log(s, f"{name} cleared the board.", "admin")
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
        if kind == "text":
            text = clean_text(d.get("text"))
            size = num(d.get("s"), 10, 120)
            if not text or size is None:
                return None
            size = min(TEXT_SIZES, key=lambda v: abs(v - size))
            return {"id": iid, "by": pid, "kind": "text", "x": x, "y": y,
                    "text": text, "c": colour(d.get("c")), "s": size}
        if kind == "image":
            src = str(d.get("src", ""))
            w, h = num(d.get("w"), 16, BIG), num(d.get("h"), 16, BIG)
            if w is None or h is None or len(src) > MAX_IMAGE_CHARS or not IMAGE.match(src):
                return None
            if sum(1 for i in s["items"].values() if i["kind"] == "image") >= MAX_IMAGES:
                return None
            if self._image_chars(s) + len(src) > MAX_IMAGE_TOTAL:
                return None
            return {"id": iid, "by": pid, "kind": "image", "x": x, "y": y,
                    "w": w, "h": h, "src": src}
        if kind == "pen":
            p = points(d.get("p"))
            w = num(d.get("w"), 1, 60)
            if not p or w is None or s["ink"] + len(p) > MAX_INK:
                return None
            s["ink"] += len(p)
            return {"id": iid, "by": pid, "kind": "pen", "x": x, "y": y, "c": colour(d.get("c")), "w": w, "p": p}
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
            return {"k": "add", "item": item}

        it = s["items"].get(str(data.get("id", "")))
        if not it or it["by"] != pid:                 # you can only change your own things
            return None
        if kind == "pts":
            p = points(data.get("p"))
            if it["kind"] != "pen" or not p or len(it["p"]) + len(p) > MAX_STROKE or s["ink"] + len(p) > MAX_INK:
                return None
            it["p"] += p
            s["ink"] += len(p)
            return {"k": "pts", "id": it["id"], "p": p}
        if kind == "move":
            x, y = num(data.get("x"), -FAR, FAR), num(data.get("y"), -FAR, FAR)    # a line's x, y is how far it was moved
            if x is None or y is None:
                return None
            it["x"], it["y"] = x, y
            out = {"k": "move", "id": it["id"], "x": x, "y": y}
            if it["kind"] == "image" and "w" in data:
                w, h = num(data.get("w"), 16, BIG), num(data.get("h"), 16, BIG)
                if w is not None and h is not None:
                    it["w"], it["h"] = w, h
                    out.update(w=w, h=h)
            return out
        if kind == "edit":
            if it["kind"] not in ("text", "pen"):
                return None
            if it["kind"] == "text" and "text" in data:
                text = clean_text(data.get("text"))
                if not text:
                    return None
                it["text"] = text
            if "c" in data:
                it["c"] = colour(data.get("c"), it["c"])
            if it["kind"] == "text" and "s" in data:
                size = num(data.get("s"), 10, 120)
                if size is not None:
                    it["s"] = min(TEXT_SIZES, key=lambda v: abs(v - size))
            out = {"k": "edit", "id": it["id"], "c": it["c"]}
            if it["kind"] == "text":
                out.update(text=it["text"], s=it["s"])
            return out
        if kind == "del":
            self._drop(s, it["id"])
            return {"k": "del", "id": it["id"]}
        return None

    # ---- View ------------------------------------------------------------------------------
    def view(self, room, pid):
        s = room.state
        player = room.players.get(pid) or {}
        sids = set(player.get("sids") or ())
        had = s["synced"].get(pid)
        full = had is None or not sids <= had        # a new tab or a reconnect: it needs the whole board
        if full:
            s["synced"][pid] = sids
        counts = {}
        for it in s["items"].values():
            counts[it["by"]] = counts.get(it["by"], 0) + 1
        out = {
            "ids": list(s["items"]),
            "colours": {p: n for n, p in enumerate(room.players)},     # player colour = order they arrived
            "counts": counts,
            "log": s["log"][-12:],
            "limits": {"items": MAX_ITEMS, "text": MAX_TEXT, "images": MAX_IMAGES, "image": MAX_IMAGE_CHARS,
                       "imageTotal": MAX_IMAGE_TOTAL, "stroke": MAX_STROKE, "chunk": MAX_CHUNK},
        }
        if full:
            out["items"] = list(s["items"].values())
        return out
