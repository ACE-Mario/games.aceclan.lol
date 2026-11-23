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

Every board has a name its maker picks ("Biology revision"), which is also its room name ("b:biology-revision")
and its link (board/?b=biology-revision). Boards are kept for good: each is saved to
server/saved/boards/<slug>.json a few seconds after each change, so restarting the server or a room closing
when idle doesn't lose it, and opening the link brings it back (server.py asks restore()). The board page
lists them all (listing(), served at /api/board/list). Only the person who made a board can delete it.

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
MAX_IMAGES = 150                  # pictures, counting each page of an added document
MAX_IMAGE_CHARS = 700_000         # one picture, as a data: URL (the page shrinks pictures before sending)
MAX_IMAGE_TOTAL = 30_000_000      # all the pictures on one board together
MAX_STROKE = 6000                 # numbers in one pen line (x, y, x, y, ...)
MAX_INK = 400_000                 # numbers in every pen line on the board together
MAX_CHUNK = 400                   # numbers in one live piece of a line
TEXT_SIZES = (14, 18, 20, 24, 36, 56, 80)
SHAPES = ("rect", "ellipse", "line", "arrow")

SAVE_DIR = os.environ.get("ACE_BOARD_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "saved", "boards")
SAVE_AFTER = 3                    # seconds after a change before the board is written to disk
MAX_BOARDS = 300                  # boards kept on disk at most (new ones are refused past this)
MAX_NAME = 40

ITEM_ID = re.compile(r"^[A-Za-z0-9]{6,24}$")
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
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


def clean_name(value):
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", "", str(value or ""))).strip()[:MAX_NAME].strip()


def slug_of(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:MAX_NAME].strip("-")


def slug_from_key(code):
    """"b:biology-revision" -> "biology-revision" (or None if it isn't a board's room name)."""
    if not isinstance(code, str) or not code.startswith("b:"):
        return None
    slug = code[2:]
    return slug if SLUG.match(slug) and len(slug) <= MAX_NAME else None


# ---- Saving boards to disk -----------------------------------------------------------------
# Each file is two lines: a short summary (name, maker, dates, how many things) and then the board
# itself, so the list of boards only has to read the first line of each file.
# Writing happens on one background thread, so a big board never holds up the live server.
_writes = {}                      # slug -> text to write (None: delete the file)
_wake = threading.Condition()
_writer = None
_index = None                     # slug -> summary, for the list of boards (read from the files once)


def _path(slug):
    return os.path.join(SAVE_DIR, slug + ".json")


def _write_loop():
    while True:
        with _wake:
            while not _writes:
                _wake.wait()
            slug, text = _writes.popitem()
        try:
            os.makedirs(SAVE_DIR, exist_ok=True)
            if text is None:
                if os.path.exists(_path(slug)):
                    os.remove(_path(slug))
            else:
                tmp = _path(slug) + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(text)
                os.replace(tmp, _path(slug))
        except OSError as e:
            print(time.strftime("%H:%M:%S"), f"board {slug} not saved: {e!r}", flush=True)


def _queue_write(slug, text):
    global _writer
    with _wake:
        _writes[slug] = text
        if _writer is None:
            _writer = threading.Thread(target=_write_loop, name="board-saver", daemon=True)
            _writer.start()
        _wake.notify()


def _convert_old(fname):
    """Boards saved before they had names (server/saved/boards/ABCD.json, one line) become "Board ABCD"."""
    path = os.path.join(SAVE_DIR, fname)
    with open(path, encoding="utf-8") as fh:
        old = json.loads(fh.read())
    if not isinstance(old, dict) or "code" not in old or not isinstance(old.get("items"), list):
        return
    items = [i for i in old["items"] if isinstance(i, dict) and "by" in i]
    slug = "board-" + slug_of(str(old["code"]))     # not just "blla": Windows sees blla.json as BLLA.json
    if len(slug) < 2 or os.path.exists(_path(slug)):
        return
    authors = [i["by"] for i in items]
    owner = max(set(authors), key=authors.count) if authors else None   # whoever made the most of it
    when = int(old.get("saved") or time.time())
    meta = {"name": "Board " + str(old["code"]).upper(), "slug": slug, "owner": owner, "created": when,
            "updated": when, "items": len(items)}
    body = {"items": items, "names": old.get("names") if isinstance(old.get("names"), dict) else {}}
    with open(_path(slug), "w", encoding="utf-8") as fh:
        fh.write(json.dumps(meta) + "\n" + json.dumps(body, separators=(",", ":")))
    os.remove(path)


def _boards():
    """The summaries of every saved board, read from the first line of each file the first time."""
    global _index
    if _index is None:
        _index = {}
        try:
            for f in os.listdir(SAVE_DIR):
                if re.fullmatch(r"[A-Z]{4}\.json", f):
                    try:
                        _convert_old(f)
                    except (OSError, ValueError) as e:
                        print(time.strftime("%H:%M:%S"), f"old board {f} not converted: {e!r}", flush=True)
        except OSError:
            pass
        try:
            files = [f for f in os.listdir(SAVE_DIR) if f.endswith(".json")]
        except OSError:
            files = []
        for f in files:
            try:
                with open(os.path.join(SAVE_DIR, f), encoding="utf-8") as fh:
                    meta = json.loads(fh.readline())
                if isinstance(meta, dict) and meta.get("slug") == f[:-5]:
                    _index[meta["slug"]] = meta
            except (OSError, ValueError):
                pass
    return _index


class Board:
    id = "board"
    name = "ACE Board"

    def new_state(self, options=None, old=None):
        name = clean_name((options or {}).get("name"))
        return {"items": {}, "names": {}, "synced": {}, "ink": 0, "log": [], "board": name, "slug": slug_of(name),
                "owner": None, "created": int(time.time()), "deleted": False,
                "dirty": True, "changed": 0.0}               # a new board is saved straight away, so it shows in the list

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

    # ---- Naming, saving, listing and bringing boards back (server.py calls these) -----------
    def room_key(self, options):
        """The room name for a new board, from the name its maker typed: (key, None) or (None, error)."""
        name = clean_name(options.get("name"))
        slug = slug_of(name)
        if len(slug) < 2:
            return None, 'Give the board a name, using letters or numbers (like "Biology revision").'
        if slug in _boards():
            return None, f'There\'s already a board called "{_boards()[slug]["name"]}". Open it from the list, or pick another name.'
        if len(_boards()) >= MAX_BOARDS:
            return None, f"There are {MAX_BOARDS} boards already, which is the most the server keeps. Delete an old one first."
        return "b:" + slug, None

    def reserved(self, code):
        slug = slug_from_key(code)
        return bool(slug) and slug in _boards()

    def closed(self, room):
        return room.state.get("deleted")

    def tick(self, room, now):
        s = room.state
        told = False
        if not s.get("owner") and room.host:
            s["owner"] = room.host                    # whoever made the board (one brought back keeps its maker)
            told = True                               # so their page shows the Delete board button
        if s.get("dirty") and not s.get("deleted") and now - s["changed"] >= SAVE_AFTER:
            s["dirty"] = False
            items = list(s["items"].values())
            meta = {"name": s["board"], "slug": s["slug"], "owner": s["owner"], "created": s["created"],
                    "updated": int(now), "items": len(items)}
            body = {"items": items, "names": {p: s["names"].get(p, "") for p in {i["by"] for i in items}}}
            _boards()[s["slug"]] = meta
            _queue_write(s["slug"], json.dumps(meta) + "\n" + json.dumps(body, separators=(",", ":")))
        return told

    def restore(self, code):
        """The saved board for this room name, as a fresh room state (or None if there isn't one)."""
        slug = slug_from_key(code)
        if not slug or slug not in _boards():
            return None
        try:
            with open(_path(slug), encoding="utf-8") as f:
                meta = json.loads(f.readline())
                body = json.loads(f.readline() or "{}")
        except (OSError, ValueError):
            return None
        s = self.new_state({"name": meta.get("name") or slug})
        s.update(slug=slug, owner=meta.get("owner"), created=meta.get("created") or int(time.time()), dirty=False)
        for it in body.get("items", []):
            if isinstance(it, dict) and ITEM_ID.match(str(it.get("id", ""))) and it.get("kind") in ("text", "image", "pen", "shape"):
                s["items"][it["id"]] = it
        s["ink"] = sum(len(i.get("p", [])) for i in s["items"].values() if i["kind"] == "pen")
        names = body.get("names")
        if isinstance(names, dict):
            s["names"] = {str(k): str(v)[:20] for k, v in names.items()}
        return s

    def listing(self, online):
        """Every board, for the board page: people in it now first, then the most recently changed."""
        boards = [{"name": m.get("name") or slug, "slug": slug, "items": m.get("items", 0),
                   "updated": m.get("updated", 0), "created": m.get("created", 0), "online": online.get("b:" + slug, 0)}
                  for slug, m in _boards().items()]
        boards.sort(key=lambda b: (-b["online"], -b["updated"]))
        return {"boards": boards, "max": MAX_BOARDS}

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
        if action == "delete_board":
            if pid != s.get("owner"):
                return "Only the person who made this board can delete it."
            s["deleted"] = True
            s["items"].clear()
            _boards().pop(s["slug"], None)
            _queue_write(s["slug"], None)
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
            "board": {"name": s["board"], "slug": s["slug"]}, "isOwner": pid == s.get("owner"),
            "deleted": bool(s.get("deleted")),
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
