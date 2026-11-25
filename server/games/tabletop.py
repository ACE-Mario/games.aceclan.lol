"""ACE Tabletop rules for live rooms: an online table for tabletop roleplaying games (games.aceclan.lol/dnd).

A campaign is a named, saved room ("c:<slug>", link dnd/?c=<slug>). Whoever makes it is its DM (game master);
they can make other people DMs too, and anyone who knows the campaign's DM code can claim DM on another device.
Everyone else is a player.

What a campaign holds:
    scenes      maps on a square grid: a picture (or a blank grid), tokens, drawings and fog of war. The DM
                picks which scene the players see; DMs can look at and prepare the others.
    tokens      on a scene: name, colour or picture, size in squares, HP, AC, conditions. Players move their
                own tokens (ones they made, or linked to their character); the DM moves everything. Hidden
                tokens and monsters under the fog aren't sent to players at all.
    characters  a sheet per character: abilities, skills, saves, HP, attacks, spells, gear and notes.
                The owner and the DMs can change it; everyone can read it and roll from it.
    dice        rolled here on the server, so nobody can fake one: "2d6+3", "1d20 adv", "4d6kh3".
                A roll or a message can go to the DMs only.
    initiative  the turn order, with rounds.
    notes       the DM's notes; ones marked shared are handouts every player can read. Each person also has
                their own private notes.

Pictures (maps, token and character pictures) are kept as files next to the campaign
(server/saved/dnd/<slug>/<id>.<ext>) and served by server.py at /api/dnd/asset/<slug>/<id>.<ext>, so room
updates only carry their names. Campaigns are saved a few seconds after each change and listed for everyone
(/api/dnd/list). Quick things that don't need saving (a token being dragged, the ruler, pings) travel as
"live" messages (see relay).

There are no points: only the daily games have those.
"""
import base64
import json
import os
import random
import re
import secrets
import shutil
import threading
import time

SAVE_DIR = os.environ.get("ACE_DND_DIR") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "saved", "dnd")
SAVE_AFTER = 3
MAX_CAMPAIGNS = 200
MAX_NAME = 40
MAX_SCENES = 40
MAX_TOKENS = 300                  # on one scene
MAX_LINES = 600                   # drawings on one scene
MAX_LINE_PTS = 4000               # numbers in one drawn line
MAX_CHARS = 60                    # character sheets in one campaign
MAX_NOTES = 120
MAX_GRID = 120                    # squares across or down
MAX_IMAGE_CHARS = 900_000         # one picture as a data: URL (socket.io takes about 1 MB a message)
MAX_ASSET_BYTES = 120_000_000     # all of one campaign's pictures
MAX_LOG = 300
MAX_TEXT = 6000
CONDITIONS = ("blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible",
              "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
              "concentrating", "exhausted", "blessed", "hasted", "marked", "dead")
ABILITIES = ("str", "dex", "con", "int", "wis", "cha")
SKILLS = {"acrobatics": "dex", "animal handling": "wis", "arcana": "int", "athletics": "str",
          "deception": "cha", "history": "int", "insight": "wis", "intimidation": "cha",
          "investigation": "int", "medicine": "wis", "nature": "int", "perception": "wis",
          "performance": "cha", "persuasion": "cha", "religion": "int", "sleight of hand": "dex",
          "stealth": "dex", "survival": "wis"}
SIZES = (0.5, 1, 2, 3, 4, 6)

ID = re.compile(r"^[A-Za-z0-9]{6,24}$")
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
COLOUR = re.compile(r"^#[0-9a-f]{6}$")
IMAGE = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+=*)$")
ASSET = re.compile(r"^([a-z0-9-]{2,40})/([A-Za-z0-9]{16})\.(png|jpg|webp|gif)$")
EXT = {"png": "png", "jpeg": "jpg", "webp": "webp", "gif": "gif"}
MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}


def new_id(n=12):
    abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "".join(secrets.choice(abc) for _ in range(n))


def num(value, lo, hi, digits=0):
    try:
        v = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if v != v:                                    # NaN
        return None
    v = max(lo, min(hi, v))
    return int(round(v)) if digits == 0 else round(v, digits)


def colour(value, default="#a78bfa"):
    c = str(value or "").lower()
    return c if COLOUR.match(c) else default


def line(value, n=60):
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", "", str(value or ""))).strip()[:n].strip()


def text(value, n=MAX_TEXT):
    t = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", t)[:n]


def slug_of(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:MAX_NAME].strip("-")


def slug_from_key(code):
    if not isinstance(code, str) or not code.startswith("c:"):
        return None
    slug = code[2:]
    return slug if SLUG.match(slug) and len(slug) <= MAX_NAME else None


# ---- Dice --------------------------------------------------------------------------------------
TERM = re.compile(r"([+-])?\s*(?:(\d*)d(\d+|%)(?:(kh|kl|k|dh|dl)(\d+))?|(\d+))", re.I)


def roll_dice(expr, mode=""):
    """Roll something like "2d6+3", "1d20+5 adv", "4d6kh3", "d%". mode "adv"/"dis" turns the first d20
    into two d20s keeping the higher or lower. Returns (result, None) or (None, error)."""
    src = str(expr or "").strip().lower()[:80]
    words = src.split()
    if words and words[-1] in ("adv", "advantage", "dis", "disadvantage"):
        mode = "adv" if words[-1].startswith("adv") else "dis"
        src = " ".join(words[:-1])
    src = src.replace(" ", "") or "1d20"
    pos, parts, total, dice, first_d20, nat = 0, [], 0, 0, True, None
    while pos < len(src):
        m = TERM.match(src, pos)
        if not m or m.end() == pos or (pos and not m.group(1)):
            return None, f'Couldn\'t read "{expr}". Try something like 1d20+5 or 2d6+3.'
        pos = m.end()
        sign = -1 if m.group(1) == "-" else 1
        if m.group(6) is not None:
            n = int(m.group(6))
            if n > 10000:
                return None, "That number is too big."
            total += sign * n
            parts.append({"n": sign * n})
            continue
        count = int(m.group(2) or 1)
        sides = 100 if m.group(3) == "%" else int(m.group(3))
        keep, kn = (m.group(4) or "").lower(), int(m.group(5) or 0)
        if not 1 <= count <= 100 or not 2 <= sides <= 1000:
            return None, "Use 1 to 100 dice with 2 to 1000 sides."
        if sides == 20 and count == 1 and not keep and first_d20 and mode in ("adv", "dis"):
            count, keep, kn = 2, ("kh" if mode == "adv" else "kl"), 1
        dice += count
        if dice > 100:
            return None, "That's too many dice at once (100 at most)."
        rolls = [random.randint(1, sides) for _ in range(count)]
        order = sorted(range(count), key=lambda i: rolls[i])
        if keep in ("kh", "k"):
            kept = set(order[-kn:]) if kn else set()
        elif keep == "kl":
            kept = set(order[:kn])
        elif keep == "dh":
            kept = set(order[:max(0, count - kn)])
        elif keep == "dl":
            kept = set(order[kn:])
        else:
            kept = set(range(count))
        value = sum(rolls[i] for i in kept)
        total += sign * value
        label = f"{count}d{sides}" + (f"{keep}{kn}" if keep else "")
        parts.append({"d": ("-" if sign < 0 else "") + label, "r": rolls, "k": sorted(kept)})
        if sides == 20 and first_d20 and len(kept) == 1:
            nat = rolls[next(iter(kept))]
        if sides == 20:
            first_d20 = False
    if not parts:
        return None, "Nothing to roll."
    out = {"expr": src + (f" {mode}" if mode else ""), "total": total, "parts": parts}
    if nat == 20:
        out["crit"] = "hit"
    elif nat == 1:
        out["crit"] = "miss"
    return out, None


# ---- Saving -----------------------------------------------------------------------------------
_writes = {}
_wake = threading.Condition()
_writer = None
_index = None


def _path(slug):
    return os.path.join(SAVE_DIR, slug + ".json")


def _asset_dir(slug):
    return os.path.join(SAVE_DIR, slug)


def _write_loop():
    while True:
        with _wake:
            while not _writes:
                _wake.wait()
            slug, body = _writes.popitem()
        try:
            os.makedirs(SAVE_DIR, exist_ok=True)
            if body is None:
                if os.path.exists(_path(slug)):
                    os.remove(_path(slug))
                shutil.rmtree(_asset_dir(slug), ignore_errors=True)
            else:
                tmp = _path(slug) + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(body)
                os.replace(tmp, _path(slug))
        except OSError as e:
            print(time.strftime("%H:%M:%S"), f"campaign {slug} not saved: {e!r}", flush=True)


def _queue_write(slug, body):
    global _writer
    with _wake:
        _writes[slug] = body
        if _writer is None:
            _writer = threading.Thread(target=_write_loop, name="dnd-saver", daemon=True)
            _writer.start()
        _wake.notify()


def _campaigns():
    global _index
    if _index is None:
        _index = {}
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


SAVED_KEYS = ("name", "slug", "owner", "created", "dms", "dmcode", "names", "scenes", "order", "active",
              "chars", "notes", "mine", "log", "init", "settings", "assets", "logn")


class Tabletop:
    id = "dnd"
    name = "ACE Tabletop"

    # ---- State -----------------------------------------------------------------------------
    def new_state(self, options=None, old=None):
        name = line((options or {}).get("name"), MAX_NAME)
        s = {"name": name, "slug": slug_of(name), "owner": None, "created": int(time.time()), "dms": [],
             "dmcode": new_id(6).upper(), "names": {}, "scenes": {}, "order": [], "active": None,
             "chars": {}, "notes": {}, "mine": {}, "log": [], "logn": 0,
             "init": {"list": [], "cur": None, "round": 0},
             "settings": {"per": 5, "unit": "ft"}, "assets": {},
             "deleted": False, "dirty": True, "changed": 0.0}
        sc = self._scene("The first map", 24, 16)
        s["scenes"][sc["id"]] = sc
        s["order"].append(sc["id"])
        s["active"] = sc["id"]
        self._sys(s, f'Welcome to {name or "the campaign"}. The DM can add a map from the Scenes tab.')
        return s

    def _scene(self, name, cols, rows):
        return {"id": new_id(), "name": name, "img": None, "cols": cols, "rows": rows, "ox": 0.0, "oy": 0.0,
                "grid": True, "gc": "#000000", "fog": False, "seen": "0" * (cols * rows),
                "tokens": {}, "lines": {}}

    def default_seat(self, room):
        return {}

    def _changed(self, s):
        s["dirty"] = True
        s["changed"] = time.time()

    def is_dm(self, s, pid):
        return pid == s.get("owner") or pid in s["dms"]

    def _log(self, s, entry):
        s["logn"] += 1
        entry.update(id=s["logn"], at=int(time.time()))
        s["log"].append(entry)
        del s["log"][:-MAX_LOG]

    def _sys(self, s, msg, to=None):
        self._log(s, {"kind": "sys", "text": msg, "to": to})

    # ---- Naming, saving, listing (server.py calls these) -------------------------------------
    def room_key(self, options):
        name = line(options.get("name"), MAX_NAME)
        slug = slug_of(name)
        if len(slug) < 2:
            return None, 'Give the campaign a name, using letters or numbers (like "Curse of the Marsh").'
        if slug in _campaigns():
            return None, f'There\'s already a campaign called "{_campaigns()[slug]["name"]}". Open it from the list, or pick another name.'
        if len(_campaigns()) >= MAX_CAMPAIGNS:
            return None, "The server is keeping as many campaigns as it can. Delete an old one first."
        return "c:" + slug, None

    def reserved(self, code):
        slug = slug_from_key(code)
        return bool(slug) and slug in _campaigns()

    def closed(self, room):
        return room.state.get("deleted")

    def _meta(self, s, now):
        return {"name": s["name"], "slug": s["slug"], "owner": s["owner"], "created": s["created"],
                "updated": int(now), "scenes": len(s["scenes"]), "chars": len(s["chars"])}

    def tick(self, room, now):
        s = room.state
        told = False
        if not s.get("owner") and room.host:
            s["owner"] = room.host
            told = True
        if s.get("dirty") and not s.get("deleted") and now - s["changed"] >= SAVE_AFTER:
            s["dirty"] = False
            meta = self._meta(s, now)
            _campaigns()[s["slug"]] = meta
            body = {k: s[k] for k in SAVED_KEYS}
            _queue_write(s["slug"], json.dumps(meta) + "\n" + json.dumps(body, separators=(",", ":")))
        return told

    def restore(self, code):
        slug = slug_from_key(code)
        if not slug or slug not in _campaigns():
            return None
        try:
            with open(_path(slug), encoding="utf-8") as f:
                f.readline()
                body = json.loads(f.readline() or "{}")
        except (OSError, ValueError):
            return None
        s = self.new_state({"name": body.get("name") or slug})
        for k in SAVED_KEYS:
            if k in body:
                s[k] = body[k]
        s["slug"] = slug
        s["dirty"] = False
        if not s["order"]:
            sc = self._scene("The first map", 24, 16)
            s["scenes"][sc["id"]] = sc
            s["order"] = [sc["id"]]
        if s["active"] not in s["scenes"]:
            s["active"] = s["order"][0]
        return s

    def listing(self, online):
        out = [{"name": m.get("name") or slug, "slug": slug, "scenes": m.get("scenes", 0), "chars": m.get("chars", 0),
                "updated": m.get("updated", 0), "online": online.get("c:" + slug, 0)}
               for slug, m in _campaigns().items()]
        out.sort(key=lambda c: (-c["online"], -c["updated"]))
        return {"campaigns": out, "max": MAX_CAMPAIGNS}

    def asset(self, key):
        """(file path, mime type) for /api/dnd/asset/<slug>/<id>.<ext>, or None."""
        m = ASSET.match(str(key or ""))
        if not m:
            return None
        path = os.path.join(_asset_dir(m.group(1)), f"{m.group(2)}.{m.group(3)}")
        return (path, MIME[m.group(3)]) if os.path.isfile(path) else None

    # ---- Pictures ----------------------------------------------------------------------------
    def _store_image(self, s, src):
        """Save a data: URL picture next to the campaign. Returns (asset name, None) or (None, error)."""
        src = str(src or "")
        m = IMAGE.match(src) if len(src) <= MAX_IMAGE_CHARS else None
        if not m:
            return None, "That picture is too big or isn't a picture the server can keep."
        try:
            data = base64.b64decode(m.group(2), validate=True)
        except (ValueError, TypeError):
            return None, "That picture couldn't be read."
        if sum(a for a in s["assets"].values()) + len(data) > MAX_ASSET_BYTES:
            return None, "This campaign has as many pictures as it can hold. Delete some old maps first."
        aid = new_id(16)
        name = f"{aid}.{EXT[m.group(1)]}"
        try:
            os.makedirs(_asset_dir(s["slug"]), exist_ok=True)
            with open(os.path.join(_asset_dir(s["slug"]), name), "wb") as f:
                f.write(data)
        except OSError:
            return None, "The server couldn't save that picture."
        s["assets"][name] = len(data)
        return name, None

    def _tidy_assets(self, s):
        """Delete pictures nothing uses any more."""
        used = set()
        for sc in s["scenes"].values():
            used.add(sc.get("img"))
            used.update(t.get("img") for t in sc["tokens"].values())
        used.update(c.get("img") for c in s["chars"].values())
        for name in [a for a in s["assets"] if a not in used]:
            s["assets"].pop(name, None)
            try:
                os.remove(os.path.join(_asset_dir(s["slug"]), name))
            except OSError:
                pass

    # ---- Scenes and fog ----------------------------------------------------------------------
    def _resize(self, sc, cols, rows):
        old = sc["seen"]
        seen = ["0"] * (cols * rows)
        for y in range(min(rows, sc["rows"])):
            for x in range(min(cols, sc["cols"])):
                seen[y * cols + x] = old[y * sc["cols"] + x]
        sc["cols"], sc["rows"], sc["seen"] = cols, rows, "".join(seen)

    def _covered(self, sc, t):
        """Is this token fully under fog (so players can't see it)?"""
        if not sc["fog"]:
            return False
        size = max(1, int(t["size"]))
        x0, y0 = int(t["x"]), int(t["y"])
        for y in range(y0, y0 + size):
            for x in range(x0, x0 + size):
                if 0 <= x < sc["cols"] and 0 <= y < sc["rows"] and sc["seen"][y * sc["cols"] + x] == "1":
                    return False
        return True

    def _pc(self, t):
        return bool(t.get("owner") or t.get("char"))

    def _seen_by_players(self, sc, t):
        return not t.get("hidden") and (self._pc(t) or not self._covered(sc, t))

    def _controls(self, s, pid, t):
        if self.is_dm(s, pid):
            return True
        if t.get("owner") == pid:
            return True
        ch = s["chars"].get(t.get("char"))
        return bool(ch and ch["owner"] == pid)

    # ---- Tokens ------------------------------------------------------------------------------
    def _token_fields(self, s, t, d, dm):
        if "name" in d:
            t["name"] = line(d["name"], 40) or t.get("name") or "Token"
        if "c" in d:
            t["c"] = colour(d["c"], t.get("c", "#e5484d"))
        if "size" in d:
            size = num(d["size"], 0.5, 6, 1)
            if size is not None:
                t["size"] = min(SIZES, key=lambda v: abs(v - size))
        for key, lo, hi in (("hp", -999, 9999), ("mhp", 0, 9999), ("ac", 0, 99), ("init", -20, 30)):
            if key in d:
                v = d[key]
                t[key] = None if v in (None, "") else num(v, lo, hi)
        if "conds" in d and isinstance(d["conds"], list):
            t["conds"] = [c for c in CONDITIONS if c in {str(x) for x in d["conds"]}]
        if "note" in d:
            t["note"] = text(d["note"], 500)
        if dm:
            if "hidden" in d:
                t["hidden"] = bool(d["hidden"])
            if "showhp" in d:
                t["showhp"] = bool(d["showhp"])
            if "owner" in d:
                t["owner"] = str(d["owner"]) if d["owner"] and str(d["owner"]) in s["names"] else None
            if "char" in d:
                t["char"] = str(d["char"]) if d["char"] in s["chars"] else None
        if "x" in d or "y" in d:
            x, y = num(d.get("x", t.get("x")), -50, MAX_GRID + 50, 2), num(d.get("y", t.get("y")), -50, MAX_GRID + 50, 2)
            if x is not None and y is not None:
                t["x"], t["y"] = x, y

    def _hp_of(self, s, t):
        """A token linked to a character shows the sheet's HP and AC."""
        ch = s["chars"].get(t.get("char"))
        if ch:
            return ch["hp"], ch["mhp"], ch["ac"]
        return t.get("hp"), t.get("mhp"), t.get("ac")

    # ---- Characters --------------------------------------------------------------------------
    def _new_char(self, pid, name):
        return {"id": new_id(), "owner": pid, "name": name or "New character", "kind": "", "level": 1,
                "abil": {a: 10 for a in ABILITIES}, "saves": [], "skills": [], "expert": [],
                "hp": 10, "mhp": 10, "thp": 0, "ac": 10, "speed": 30, "initb": 0, "pb": None,
                "attacks": [], "spells": "", "gear": "", "notes": "", "feats": "", "img": None,
                "ds": [0, 0], "insp": False, "c": "#3e63dd"}

    def _char_fields(self, s, ch, d, dm):
        for key, n in (("name", 40), ("kind", 60)):
            if key in d:
                ch[key] = line(d[key], n) or (ch[key] if key == "name" else "")
        for key, lo, hi in (("level", 1, 30), ("hp", -999, 9999), ("mhp", 0, 9999), ("thp", 0, 999),
                            ("ac", 0, 99), ("speed", 0, 999), ("initb", -20, 30)):
            if key in d:
                v = num(d[key], lo, hi)
                if v is not None:
                    ch[key] = v
        if "pb" in d:
            ch["pb"] = None if d["pb"] in (None, "") else num(d["pb"], 0, 12)
        if isinstance(d.get("abil"), dict):
            for a in ABILITIES:
                if a in d["abil"]:
                    v = num(d["abil"][a], 1, 30)
                    if v is not None:
                        ch["abil"][a] = v
        if isinstance(d.get("saves"), list):
            ch["saves"] = [a for a in ABILITIES if a in d["saves"]]
        for key in ("skills", "expert"):
            if isinstance(d.get(key), list):
                ch[key] = [k for k in SKILLS if k in d[key]]
        if isinstance(d.get("attacks"), list):
            ch["attacks"] = [{"n": line(a.get("n"), 40), "hit": line(a.get("hit"), 20), "dmg": line(a.get("dmg"), 40)}
                             for a in d["attacks"][:20] if isinstance(a, dict)]
        for key in ("spells", "gear", "notes", "feats"):
            if key in d:
                ch[key] = text(d[key])
        if isinstance(d.get("ds"), list) and len(d["ds"]) == 2:
            ch["ds"] = [num(d["ds"][0], 0, 3) or 0, num(d["ds"][1], 0, 3) or 0]
        if "insp" in d:
            ch["insp"] = bool(d["insp"])
        if "c" in d:
            ch["c"] = colour(d["c"], ch["c"])
        if dm and "owner" in d and str(d["owner"]) in s["names"]:
            ch["owner"] = str(d["owner"])

    # ---- Initiative --------------------------------------------------------------------------
    def _sort_init(self, s):
        s["init"]["list"].sort(key=lambda e: (-(e["val"] if e["val"] is not None else -999), -e.get("dex", 0), e["name"]))

    def _init_bonus(self, s, t):
        ch = s["chars"].get(t.get("char"))
        if ch:
            return ch["initb"] + (ch["abil"]["dex"] - 10) // 2
        return t.get("init") or 0

    # ---- Room actions ------------------------------------------------------------------------
    def handle(self, room, pid, action, data):
        s = room.state
        me = room.players[pid]["name"]
        for q, p in room.players.items():           # names are kept, for people who aren't here right now
            s["names"][q] = p["name"]
        dm = self.is_dm(s, pid)
        err = self._act(room, s, pid, me, dm, action, data)
        if err is None:
            self._changed(s)
        return err

    def _scene_of(self, s, data, dm):
        sc = s["scenes"].get(str(data.get("sc", "")))
        if not sc or (not dm and sc["id"] != s["active"]):
            return None
        return sc

    def _act(self, room, s, pid, me, dm, action, data):
        need_dm = "Only the DM can do that."

        # -- Talking and dice --
        if action == "chat":
            msg = text(data.get("text"), 1000).strip()
            if not msg:
                return "Type a message first."
            self._log(s, {"kind": "chat", "by": pid, "who": me, "text": msg, "to": "dm" if data.get("to") == "dm" else None})
            return None
        if action == "roll":
            mode = data.get("mode") if data.get("mode") in ("adv", "dis") else ""
            res, err = roll_dice(data.get("expr"), mode)
            if err:
                return err
            self._log(s, {"kind": "roll", "by": pid, "who": line(data.get("as"), 40) or me,
                          "text": line(data.get("label"), 60), "roll": res,
                          "to": "dm" if data.get("to") == "dm" else None})
            return None
        if action == "my_notes":
            s["mine"][pid] = text(data.get("text"), 20000)
            return None

        # -- DMs --
        if action == "claim_dm":
            if str(data.get("code", "")).strip().upper() != s["dmcode"]:
                return "That isn't this campaign's DM code."
            if not dm:
                s["dms"].append(pid)
                self._sys(s, f"{me} is now a DM.")
            return None
        if action == "set_dm":
            if pid != s["owner"]:
                return "Only the person who made the campaign can choose the DMs."
            target = str(data.get("player", ""))
            if target not in s["names"] or target == s["owner"]:
                return "Pick someone else."
            on = bool(data.get("on"))
            if on and target not in s["dms"]:
                s["dms"].append(target)
                self._sys(s, f"{s['names'][target]} is now a DM.")
            elif not on and target in s["dms"]:
                s["dms"].remove(target)
                self._sys(s, f"{s['names'][target]} is a player again.")
            return None
        if action == "new_dm_code":
            if pid != s["owner"]:
                return "Only the person who made the campaign can change the DM code."
            s["dmcode"] = new_id(6).upper()
            return None
        if action == "delete_campaign":
            if pid != s["owner"]:
                return "Only the person who made the campaign can delete it."
            s["deleted"] = True
            _campaigns().pop(s["slug"], None)
            _queue_write(s["slug"], None)
            return None
        if action == "settings":
            if not dm:
                return need_dm
            per = num(data.get("per"), 1, 1000)
            if per is not None:
                s["settings"]["per"] = per
            if "unit" in data:
                s["settings"]["unit"] = line(data.get("unit"), 8) or "ft"
            return None
        if action == "clear_chat":
            if not dm:
                return need_dm
            s["log"].clear()
            self._sys(s, f"{me} cleared the chat.")
            return None

        # -- Scenes --
        if action == "scene_add":
            if not dm:
                return need_dm
            if len(s["scenes"]) >= MAX_SCENES:
                return f"A campaign can have {MAX_SCENES} scenes."
            cols = num(data.get("cols"), 1, MAX_GRID) or 24
            rows = num(data.get("rows"), 1, MAX_GRID) or 16
            sc = self._scene(line(data.get("name"), 40) or f"Scene {len(s['scenes']) + 1}", cols, rows)
            s["scenes"][sc["id"]] = sc
            s["order"].append(sc["id"])
            return None
        if action in ("scene_edit", "scene_img", "scene_del", "scene_show", "scene_move", "scene_copy", "fog", "fog_all"):
            if not dm:
                return need_dm
            sc = s["scenes"].get(str(data.get("sc", "")))
            if not sc:
                return "That scene isn't there any more."
            if action == "scene_edit":
                if "name" in data:
                    sc["name"] = line(data["name"], 40) or sc["name"]
                cols = num(data.get("cols", sc["cols"]), 1, MAX_GRID)
                rows = num(data.get("rows", sc["rows"]), 1, MAX_GRID)
                if cols and rows and (cols, rows) != (sc["cols"], sc["rows"]):
                    self._resize(sc, cols, rows)
                for key in ("ox", "oy"):
                    if key in data:
                        v = num(data[key], -1, 1, 3)
                        if v is not None:
                            sc[key] = v
                for key in ("grid", "fog"):
                    if key in data:
                        sc[key] = bool(data[key])
                if "gc" in data:
                    sc["gc"] = colour(data["gc"], sc["gc"])
                return None
            if action == "scene_img":
                if data.get("src"):
                    name, err = self._store_image(s, data.get("src"))
                    if err:
                        return err
                    sc["img"] = name
                    cols, rows = num(data.get("cols"), 1, MAX_GRID), num(data.get("rows"), 1, MAX_GRID)
                    if cols and rows:
                        self._resize(sc, cols, rows)
                        sc["ox"] = sc["oy"] = 0.0
                else:
                    sc["img"] = None
                self._tidy_assets(s)
                return None
            if action == "scene_del":
                if len(s["scenes"]) <= 1:
                    return "A campaign needs at least one scene."
                del s["scenes"][sc["id"]]
                s["order"].remove(sc["id"])
                s["init"]["list"] = [e for e in s["init"]["list"] if e.get("sc") != sc["id"]]
                if s["active"] == sc["id"]:
                    s["active"] = s["order"][0]
                self._tidy_assets(s)
                return None
            if action == "scene_show":
                s["active"] = sc["id"]
                self._sys(s, f"The party moves to {sc['name']}.")
                return None
            if action == "scene_move":
                i = s["order"].index(sc["id"])
                j = max(0, min(len(s["order"]) - 1, i + (1 if data.get("down") else -1)))
                s["order"][i], s["order"][j] = s["order"][j], s["order"][i]
                return None
            if action == "scene_copy":
                if len(s["scenes"]) >= MAX_SCENES:
                    return f"A campaign can have {MAX_SCENES} scenes."
                copy = json.loads(json.dumps(sc))
                copy["id"] = new_id()
                copy["name"] = (sc["name"] + " (copy)")[:40]
                copy["tokens"] = {(n := new_id()): {**t, "id": n} for t in copy["tokens"].values()}
                copy["lines"] = {(n := new_id()): {**ln, "id": n} for ln in copy["lines"].values()}
                s["scenes"][copy["id"]] = copy
                s["order"].insert(s["order"].index(sc["id"]) + 1, copy["id"])
                return None
            if action == "fog_all":
                sc["seen"] = ("1" if data.get("show") else "0") * (sc["cols"] * sc["rows"])
                return None
            # fog: a list of cells x, y, x, y ... to reveal (show) or cover
            cells = data.get("cells")
            if not isinstance(cells, list) or len(cells) % 2 or len(cells) > 2 * MAX_GRID * MAX_GRID:
                return "Couldn't read that."
            seen = list(sc["seen"])
            mark = "1" if data.get("show") else "0"
            for i in range(0, len(cells), 2):
                x, y = num(cells[i], -1, MAX_GRID), num(cells[i + 1], -1, MAX_GRID)
                if x is not None and y is not None and 0 <= x < sc["cols"] and 0 <= y < sc["rows"]:
                    seen[y * sc["cols"] + x] = mark
            sc["seen"] = "".join(seen)
            return None

        # -- Tokens --
        if action == "tok_add":
            sc = self._scene_of(s, data, dm)
            if not sc:
                return "That scene isn't there any more."
            if len(sc["tokens"]) >= MAX_TOKENS:
                return f"A scene can have {MAX_TOKENS} tokens."
            d = data.get("tok") if isinstance(data.get("tok"), dict) else {}
            count = num(data.get("count"), 1, 20) if dm else 1
            base = line(d.get("name"), 40) or "Token"
            pic = None
            if d.get("src"):                              # a picture for the new token(s)
                pic, err = self._store_image(s, d["src"])
                if err:
                    return err
            for i in range(count or 1):
                t = {"id": new_id(), "name": base if (count or 1) == 1 else f"{base} {i + 1}", "x": 0, "y": 0,
                     "size": 1, "c": "#e5484d", "img": None, "hp": None, "mhp": None, "ac": None, "init": None,
                     "conds": [], "hidden": False, "showhp": False, "owner": None if dm else pid, "char": None, "note": ""}
                self._token_fields(s, t, {k: v for k, v in d.items() if k != "name"}, dm)
                if i:
                    t["x"] = min(sc["cols"] - 1, t["x"] + i * max(1, int(t["size"])))
                if pic or d.get("img") in s["assets"]:
                    t["img"] = pic or d["img"]
                ch = s["chars"].get(str(d.get("char", "")))
                if ch and (dm or ch["owner"] == pid):
                    t["char"], t["img"] = ch["id"], ch.get("img") or t["img"]
                    t["owner"] = ch["owner"]
                sc["tokens"][t["id"]] = t
            return None
        if action in ("tok_edit", "tok_move", "tok_del", "tok_img", "tok_front"):
            sc = self._scene_of(s, data, dm)
            t = sc["tokens"].get(str(data.get("id", ""))) if sc else None
            if not t:
                return "That token isn't there any more."
            if not self._controls(s, pid, t):
                return "That isn't your token. Ask the DM."
            if action == "tok_move":
                self._token_fields(s, t, {"x": data.get("x"), "y": data.get("y")}, dm)
                return None
            if action == "tok_edit":
                d = data.get("set") if isinstance(data.get("set"), dict) else {}
                ch = s["chars"].get(t.get("char"))
                if ch and any(k in d for k in ("hp", "mhp", "ac")):        # a character's token changes its sheet
                    self._char_fields(s, ch, {k: d[k] for k in ("hp", "mhp", "ac") if k in d}, dm)
                    d = {k: v for k, v in d.items() if k not in ("hp", "mhp", "ac")}
                self._token_fields(s, t, d, dm)
                return None
            if action == "tok_front":
                sc["tokens"][t["id"]] = sc["tokens"].pop(t["id"])       # drawn last = on top
                return None
            if action == "tok_img":
                if data.get("src"):
                    name, err = self._store_image(s, data.get("src"))
                    if err:
                        return err
                    t["img"] = name
                else:
                    t["img"] = None
                self._tidy_assets(s)
                return None
            del sc["tokens"][t["id"]]
            s["init"]["list"] = [e for e in s["init"]["list"] if e.get("tok") != t["id"]]
            self._tidy_assets(s)
            return None

        # -- Drawings on the map --
        if action == "line_add":
            sc = self._scene_of(s, data, dm)
            d = data.get("line") if isinstance(data.get("line"), dict) else {}
            p = d.get("p")
            if not sc or not isinstance(p, list) or len(p) < 4 or len(p) % 2 or len(p) > MAX_LINE_PTS:
                return "Couldn't draw that."
            if len(sc["lines"]) >= MAX_LINES:
                return "This map has as many drawings as it can hold. Clear some first."
            pts = [num(v, -50, MAX_GRID + 50, 2) for v in p]
            if any(v is None for v in pts):
                return "Couldn't draw that."
            lid = new_id()
            shape = d.get("shape") if d.get("shape") in ("line", "rect", "circle", "cone") else None
            sc["lines"][lid] = {"id": lid, "by": pid, "c": colour(d.get("c"), "#ffd43b"),
                                "w": num(d.get("w"), 1, 20) or 3, "p": pts, "shape": shape}
            return None
        if action == "line_del":
            sc = self._scene_of(s, data, dm)
            ln = sc["lines"].get(str(data.get("id", ""))) if sc else None
            if not ln:
                return None
            if ln["by"] != pid and not dm:
                return "You can only rub out your own drawings."
            del sc["lines"][ln["id"]]
            return None
        if action == "lines_clear":
            sc = self._scene_of(s, data, dm)
            if not sc:
                return None
            if data.get("all"):
                if not dm:
                    return need_dm
                sc["lines"].clear()
            else:
                sc["lines"] = {k: v for k, v in sc["lines"].items() if v["by"] != pid}
            return None

        # -- Characters --
        if action == "char_add":
            if len(s["chars"]) >= MAX_CHARS:
                return f"A campaign can have {MAX_CHARS} characters."
            ch = self._new_char(pid, line(data.get("name"), 40))
            s["chars"][ch["id"]] = ch
            self._sys(s, f"{me} made a character: {ch['name']}.")
            return None
        if action in ("char_edit", "char_del", "char_img"):
            ch = s["chars"].get(str(data.get("id", "")))
            if not ch:
                return "That character isn't there any more."
            if ch["owner"] != pid and not dm:
                return "That's someone else's character."
            if action == "char_edit":
                self._char_fields(s, ch, data.get("set") if isinstance(data.get("set"), dict) else {}, dm)
                return None
            if action == "char_img":
                if data.get("src"):
                    name, err = self._store_image(s, data.get("src"))
                    if err:
                        return err
                    ch["img"] = name
                else:
                    ch["img"] = None
                for sc in s["scenes"].values():               # their tokens show the new picture too
                    for t in sc["tokens"].values():
                        if t.get("char") == ch["id"]:
                            t["img"] = ch["img"]
                self._tidy_assets(s)
                return None
            del s["chars"][ch["id"]]
            for sc in s["scenes"].values():
                for t in sc["tokens"].values():
                    if t.get("char") == ch["id"]:
                        t["char"] = None
            self._tidy_assets(s)
            return None

        # -- Initiative --
        if action.startswith("init_"):
            init = s["init"]
            if action == "init_add":
                sc = self._scene_of(s, data, dm)
                ids = data.get("ids") if isinstance(data.get("ids"), list) else []
                have = {e.get("tok") for e in init["list"]}
                added = 0
                for tid in ids[:60]:
                    t = sc["tokens"].get(str(tid)) if sc else None
                    if not t or t["id"] in have or not self._controls(s, pid, t):
                        continue
                    val = None
                    if data.get("roll"):
                        res, _ = roll_dice(f"1d20{self._init_bonus(s, t):+d}")
                        val = res["total"]
                    init["list"].append({"id": new_id(), "name": t["name"], "val": val, "tok": t["id"], "sc": sc["id"],
                                         "hidden": bool(t.get("hidden")), "by": pid,
                                         "pc": self._pc(t), "dex": self._init_bonus(s, t)})
                    added += 1
                if not ids:
                    name = line(data.get("name"), 40)
                    if not name:
                        return "Give it a name."
                    if not dm:
                        return need_dm
                    val = num(data.get("val"), -50, 100)
                    init["list"].append({"id": new_id(), "name": name, "val": val, "tok": None, "sc": None,
                                         "hidden": bool(data.get("hidden")), "by": pid, "pc": False, "dex": 0})
                    added = 1
                if not added:
                    return "Those are already in the turn order."
                self._sort_init(s)
                return None
            e = next((x for x in init["list"] if x["id"] == str(data.get("id", ""))), None)
            if action in ("init_set", "init_del", "init_roll"):
                if not e:
                    return "That isn't in the turn order any more."
                if not dm and e["by"] != pid:
                    return need_dm
                if action == "init_del":
                    init["list"].remove(e)
                    if init["cur"] == e["id"]:
                        init["cur"] = None
                    return None
                if action == "init_roll":
                    t = None
                    if e.get("tok"):
                        t = s["scenes"].get(e.get("sc"), {}).get("tokens", {}).get(e["tok"])
                    bonus = self._init_bonus(s, t) if t else 0
                    res, _ = roll_dice(f"1d20{bonus:+d}")
                    e["val"] = res["total"]
                    seen = bool(t) and self._seen_by_players(s["scenes"][e["sc"]], t) if e.get("tok") else not e["hidden"]
                    self._log(s, {"kind": "roll", "by": pid, "who": e["name"], "text": "Initiative", "roll": res,
                                  "to": None if seen else "dm"})
                else:
                    e["val"] = num(data.get("val"), -50, 100)
                    if "name" in data and dm:
                        e["name"] = line(data["name"], 40) or e["name"]
                    if "hidden" in data and dm:
                        e["hidden"] = bool(data["hidden"])
                self._sort_init(s)
                return None
            if not dm:
                return need_dm
            if action == "init_clear":
                s["init"] = {"list": [], "cur": None, "round": 0}
                self._sys(s, "The fight is over.")
                return None
            if action in ("init_next", "init_prev"):
                order = init["list"]
                if not order:
                    return "Add someone to the turn order first."
                ids = [x["id"] for x in order]
                if init["cur"] not in ids:
                    init["cur"], init["round"] = ids[0], max(1, init["round"])
                    if init["round"] == 1:
                        self._sys(s, "Roll for it: the fight begins. Round 1.")
                else:
                    i = ids.index(init["cur"]) + (1 if action == "init_next" else -1)
                    if i >= len(ids):
                        i, init["round"] = 0, init["round"] + 1
                        self._sys(s, f"Round {init['round']}.")
                    elif i < 0:
                        i, init["round"] = len(ids) - 1, max(1, init["round"] - 1)
                    init["cur"] = ids[i]
                return None
            return "Unknown action."

        # -- DM notes and handouts --
        if action == "note_add":
            if not dm:
                return need_dm
            if len(s["notes"]) >= MAX_NOTES:
                return f"A campaign can have {MAX_NOTES} notes."
            n = {"id": new_id(), "title": line(data.get("title"), 60) or "New note", "text": "", "shared": False}
            s["notes"][n["id"]] = n
            return None
        if action in ("note_edit", "note_del"):
            if not dm:
                return need_dm
            n = s["notes"].get(str(data.get("id", "")))
            if not n:
                return "That note isn't there any more."
            if action == "note_del":
                del s["notes"][n["id"]]
                return None
            if "title" in data:
                n["title"] = line(data["title"], 60) or n["title"]
            if "text" in data:
                n["text"] = text(data["text"], 20000)
            if "shared" in data:
                was, n["shared"] = n["shared"], bool(data["shared"])
                if n["shared"] and not was:
                    self._sys(s, f"The DM shared a handout: {n['title']}.")
            return None

        return "Unknown action."

    # ---- Live messages: dragging, the ruler, pings ------------------------------------------
    def relay(self, room, pid, data):
        s = room.state
        k = data.get("k")
        sc = s["scenes"].get(str(data.get("sc", "")))
        if not sc:
            return None
        dm = self.is_dm(s, pid)
        if not dm and sc["id"] != s["active"]:
            return None
        if k == "ping":
            x, y = num(data.get("x"), -50, MAX_GRID + 50, 2), num(data.get("y"), -50, MAX_GRID + 50, 2)
            if x is None or y is None:
                return None
            return {"k": "ping", "sc": sc["id"], "x": x, "y": y, "by": pid}
        if k == "ruler":
            if data.get("off"):
                return {"k": "ruler", "sc": sc["id"], "by": pid, "off": True}
            p = data.get("p")
            if not isinstance(p, list) or len(p) < 4 or len(p) > 40 or len(p) % 2:
                return None
            pts = [num(v, -50, MAX_GRID + 50, 2) for v in p]
            if any(v is None for v in pts):
                return None
            return {"k": "ruler", "sc": sc["id"], "by": pid, "p": pts, "shape": data.get("shape") if data.get("shape") in ("circle", "cone", "square") else None}
        if k == "drag":
            t = sc["tokens"].get(str(data.get("id", "")))
            if not t or not self._controls(s, pid, t) or not self._seen_by_players(sc, t):
                return None
            x, y = num(data.get("x"), -50, MAX_GRID + 50, 2), num(data.get("y"), -50, MAX_GRID + 50, 2)
            if x is None or y is None:
                return None
            return {"k": "drag", "sc": sc["id"], "id": t["id"], "x": x, "y": y, "by": pid}
        return None

    # ---- View --------------------------------------------------------------------------------
    def _scene_view(self, s, sc, dm):
        out = {k: sc[k] for k in ("id", "name", "img", "cols", "rows", "ox", "oy", "grid", "gc", "fog")}
        out["seen"] = sc["seen"] if sc["fog"] else ""
        toks = []
        for t in sc["tokens"].values():
            if not dm and not self._seen_by_players(sc, t):
                continue
            hp, mhp, ac = self._hp_of(s, t)
            v = {**t, "hp": hp, "mhp": mhp, "ac": ac}
            if not dm and not self._pc(t) and not t.get("showhp"):
                # players see how hurt a monster looks, not its numbers
                v["hp"] = v["mhp"] = v["ac"] = v["init"] = None
                v["note"] = ""
                if hp is not None and mhp:
                    v["look"] = "down" if hp <= 0 else "bloodied" if hp <= mhp / 2 else "hurt" if hp < mhp else "fine"
            toks.append(v)
        out["tokens"] = toks
        out["lines"] = list(sc["lines"].values())
        return out

    def view(self, room, pid):
        s = room.state
        dm = self.is_dm(s, pid)
        names = dict(s["names"])
        for q, p in room.players.items():
            names[q] = p["name"]
        if dm:
            scenes = [self._scene_view(s, s["scenes"][i], True) for i in s["order"]]
        else:
            scenes = [self._scene_view(s, s["scenes"][s["active"]], False)]
        log = [e for e in s["log"] if not e.get("to") or dm or e.get("by") == pid][-150:]
        init = s["init"]

        def unseen(e):
            """Turn order entries players don't get: hidden ones, and tokens they can't see on the map."""
            if e["hidden"]:
                return True
            sc = s["scenes"].get(e.get("sc"))
            t = sc["tokens"].get(e.get("tok")) if sc else None
            return bool(t) and not self._seen_by_players(sc, t)
        order = [e for e in init["list"] if dm or not unseen(e)]
        cur = init["cur"]
        if not dm and cur and not any(e["id"] == cur for e in order):
            cur = "hidden"
        return {
            "camp": {"name": s["name"], "slug": s["slug"]}, "deleted": bool(s.get("deleted")),
            "dm": dm, "owner": s["owner"], "isOwner": pid == s["owner"], "dms": [s["owner"], *s["dms"]],
            "dmcode": s["dmcode"] if dm else None,
            "names": names,
            "scenes": scenes, "active": s["active"],
            "chars": list(s["chars"].values()),
            "notes": [n for n in s["notes"].values() if dm or n["shared"]],
            "mine": s["mine"].get(pid, ""),
            "log": log,
            "init": {"list": [{**{k: e[k] for k in ("id", "name", "val", "tok", "sc", "by", "pc")}, "hidden": unseen(e)} for e in order],
                     "cur": cur, "round": init["round"]},
            "settings": s["settings"],
            "conditions": list(CONDITIONS), "skills": SKILLS,
            "limits": {"image": MAX_IMAGE_CHARS, "grid": MAX_GRID, "linePts": MAX_LINE_PTS},
        }
