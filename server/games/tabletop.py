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
    map maker   the DM can also paint the map itself on the grid: floors, walls, water and so on (one letter a
                square in "tiles", see TILES), props (tables, barrels, trees...) and labels (some for DMs only).
                Painted walls and doors become walls for sight by themselves (_auto_walls).
    walls       lines the DM draws along the map's walls, and doors (open or shut, maybe locked: players aren't
                told a door is locked, just that it won't open, unless the DM shows them its padlock). With "Reveal as the party
                explores" on, the fog clears by itself around the players' tokens as they move, as far as each
                token can see (its sight, in squares) and not through walls or shut doors. Players can't move
                their tokens through walls or shut doors either, unless the DM turns "Walls stop players" off.
    pretend     players the DM makes up ("Make fake player") to try the table out alone: each gets a token, and
    players     the DM can play as one, seeing and doing exactly what a real player would (walls, fog, triggers,
                hidden stairs). The DM's actions carry "as": <pretend player id> while they do.
    spawn       each scene's player spawn: the area (x, y, w, h) the DM marks in the map maker. When the party is sent
                to a scene (Show to players, a link, a trigger), their tokens land there. Stairs players walk
                onto still put them next to the stairs that lead back.
    notes       the DM's notes; ones marked shared are handouts every player can read, and the DM can show one
                (with its picture) on everyone's screen. Each person also has their own private notes.

Pictures (maps, token and character pictures) are kept as files next to the campaign
(server/saved/dnd/<slug>/<id>.<ext>) and served by server.py at /api/dnd/asset/<slug>/<id>.<ext>, so room
updates only carry their names. Campaigns are saved a few seconds after each change and listed for everyone
(/api/dnd/list). Quick things that don't need saving (a token being dragged, the ruler, pings) travel as
"live" messages (see relay).

There are no points: only the daily games have those.
"""
import base64
import copy
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
MAX_WALLS = 1000                  # wall and door pieces the DM draws on one scene
MAX_AUTO_WALLS = 6000             # pieces made from painted walls (long runs are joined into one)
MAX_PROPS = 1500
MAX_LABELS = 200
# Map maker squares: . nothing (solid rock on a drawn map; the picture or blank grid shows through), f stone floor,
# o wooden floor, g grass, d dirt, s water, l lava, p pit, w solid wall, D door (it sits across a gap in the walls).
# Indoor floors (and doors) get walls round them by themselves wherever they meet nothing or solid wall, so the DM
# just draws rooms and corridors ("Walls round it" can be turned off for open ground).
# S is a secret door: players see plain wall there (and get no door) until the DM turns it into a D.
# h is a hidden wall: a wall for sight and moving, joined up with the walls round it, but players see floor there
# until the DM (or a trigger) shows it; then it's H, a wall they can see. Showing or hiding takes the whole
# connected stretch of it.
TILES = ".fogdslpwDShH"
OPEN_TILES = "fogdslpDS"
SOLID_TILES = ".whH"
WALL_TILES = "whH"
# Whether a painted square gets walls where it meets rock is up to the DM ("Walls round it" in the map maker):
# one "1" or "0" a square in "wl". Doors always do. Maps from before "wl" walled stone and wood only.
OLD_WALLED = "foDS"
PROPS = ("table", "chair", "barrel", "crate", "chest", "bed", "shelf", "pillar", "statue", "stairs", "torch",
         "campfire", "altar", "well", "tree", "bush", "rock", "rubble", "rug", "web", "trap", "lever", "plate")
DM_PROPS = ("trap",)                                # players never get these, until the DM shows them ("found")
# Any prop can also be hidden (players don't get it, and hidden stairs don't take anyone anywhere) until the DM
# or a trigger reveals it. A hidden prop can sit under another one (stairs under a rug): when it's revealed, the
# prop on top is pushed aside onto a free square next to it.
# The DM's list of ready tokens to drag onto the map, by kind. A campaign starts with a few of each.
LIB_CATS = ("enemy", "boss", "npc")
LIB_COLOUR = {"enemy": "#e5484d", "boss": "#8e4ec6", "npc": "#2f9e44"}
LIB_KEEP = ("name", "c", "size", "mhp", "ac", "init", "sight", "aura", "speed", "elev", "ac2", "stats", "img")
MAX_LIB = 200
STARTER_LIB = (                   # name, kind, HP, AC, initiative bonus, size
    ("Bandit", "enemy", 11, 12, 1, 1), ("Goblin", "enemy", 7, 15, 2, 1), ("Skeleton", "enemy", 13, 13, 2, 1),
    ("Zombie", "enemy", 22, 8, -2, 1), ("Wolf", "enemy", 11, 13, 2, 1), ("Giant rat", "enemy", 7, 12, 2, 1),
    ("Cultist", "enemy", 9, 12, 1, 1), ("Orc", "enemy", 15, 13, 1, 1), ("Giant spider", "enemy", 26, 14, 3, 2),
    ("Bandit captain", "boss", 65, 15, 3, 1), ("Mage", "boss", 40, 12, 2, 1), ("Wight", "boss", 45, 14, 1, 1),
    ("Ogre", "boss", 59, 11, -1, 2), ("Troll", "boss", 84, 15, 1, 2), ("Young dragon", "boss", 133, 18, 0, 2),
    ("Commoner", "npc", 4, 10, 0, 1), ("Guard", "npc", 11, 16, 1, 1), ("Priest", "npc", 27, 13, 0, 1),
    ("Knight", "npc", 52, 18, 0, 1),
)
# Triggers (the DM's Scripting tab): an area of squares, or a token, and what happens when a player's token
# steps into it ("enter"), can see it ("see": any distance, walls and shut doors block, hidden tokens can't be seen),
# or clicks it while standing on it or right next to it ("use": a chest, a lever, a door, an NPC).
TRIG_WHEN = ("enter", "see", "use")
TRIG_DO = ("tell", "text", "scene", "reveal", "open", "give")   # give: a loot chest, its items go to the party   # tell the DM, show a message, move them, unhide things, open things
# "reveal" and "open" work on the trigger's own squares, or on another area of the map ("tgt": a lever across the room).
# "open" opens doors (unlocking them), turns secret doors into doors and takes hidden walls away: a secret passage.
# "ask": the trigger doesn't do anything by itself; the DM is told, has the player roll (off the site), then sets it
# off or skips it from the right-click menu ("pending" until then).
MAX_ITEMS = 100
EXPORT_KEYS = ("name", "scenes", "order", "active", "chars", "notes", "init", "settings", "lib", "items", "enc", "world", "board")
EXPORT_ASSET = re.compile(r"^[A-Za-z0-9]{16}\.(png|jpg|webp|gif)$")
MAX_IMPORT_CHARS = 180_000_000    # a whole campaign file, pictures and all
MAX_IMPORT_PART = 600_000         # one piece of it (socket.io takes about 1 MB a message)
MAX_MARKS = 80                    # places on the world map
MAX_BOARD = 80                    # notes pinned on the handout board
MAX_HP = 9999
ITEM_KINDS = ("item", "key", "handout")
ENC_DIFFS = ("easy", "medium", "hard", "deadly")       # the party's things; a key the party holds opens doors set to need it
MAX_TRIGS = 100
MAX_POPS = 30
MAX_FAKES = 8
PC_SIGHT = 12                     # how far a player's token sees when it's made, in squares (60 ft)
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


# ---- Line of sight ------------------------------------------------------------------------------
def crosses(ax, ay, bx, by, w):
    """Does the sight line a-b go through wall w (x1, y1, x2, y2)? Touching a wall's end counts, so sight
    can't slip through the corner where two walls meet."""
    cx, cy, dx, dy = w
    d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
    d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
    if d1 * d2 >= 0:
        return False
    d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
    return d3 * d4 <= 0


INSIDE = ((0.12, 0.12), (0.88, 0.12), (0.12, 0.88), (0.88, 0.88))


def meets(ax, ay, bx, by, w):
    """Does the step a-b cross or touch wall w? For moving, not sight: a shut door runs through the middle of its
    square, so a step that ends on it counts, and you can't stand in a shut doorway or walk on through it."""
    cx, cy, dx, dy = w
    d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
    d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
    if d1 * d2 > 0:
        return False
    d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
    if d3 * d4 > 0:
        return False
    if d1 == 0 and d2 == 0:                       # in line with the wall: only if they overlap
        return (max(min(ax, bx), min(cx, dx)) <= min(max(ax, bx), max(cx, dx))
                and max(min(ay, by), min(cy, dy)) <= min(max(ay, by), max(cy, dy)))
    return True


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


SAVED_KEYS = ("name", "slug", "owner", "created", "dms", "dmcode", "names", "scenes", "order", "active", "at",
              "chars", "notes", "mine", "log", "init", "settings", "assets", "logn", "lib", "pops", "popn", "fakes", "items", "enc", "world", "board")


class Tabletop:
    id = "dnd"
    name = "ACE Tabletop"

    # ---- State -----------------------------------------------------------------------------
    def new_state(self, options=None, old=None):
        name = line((options or {}).get("name"), MAX_NAME)
        s = {"name": name, "slug": slug_of(name), "owner": None, "created": int(time.time()), "dms": [],
             "dmcode": new_id(6).upper(), "names": {}, "scenes": {}, "order": [], "active": None, "at": {},
             "chars": {}, "notes": {}, "mine": {}, "log": [], "logn": 0,
             "init": {"list": [], "cur": None, "round": 0},
             "settings": {"per": 5, "unit": "ft"}, "assets": {}, "lib": self._starter_lib(), "pops": [], "popn": 0,
             "fakes": {}, "playas": {}, "items": {}, "enc": {"lvl": 1, "diff": "medium"},
             "world": {"img": None, "marks": {}, "open": False}, "board": {},
             "deleted": False, "dirty": True, "changed": 0.0}
        sc = self._scene("The first map", 24, 16)
        s["scenes"][sc["id"]] = sc
        s["order"].append(sc["id"])
        s["active"] = sc["id"]
        self._sys(s, f'Welcome to {name or "the campaign"}. The DM can add a map from the Scenes tab.')
        return s

    def _starter_lib(self):
        lib = {}
        for name, cat, hp, ac, ini, size in STARTER_LIB:
            e = {"id": new_id(), "cat": cat, "name": name, "c": LIB_COLOUR[cat], "size": size, "mhp": hp, "ac": ac,
                 "init": ini, "img": None}
            lib[e["id"]] = e
        return lib

    def _scene(self, name, cols, rows):
        return {"id": new_id(), "name": name, "img": None, "cols": cols, "rows": rows, "ox": 0.0, "oy": 0.0,
                "grid": True, "gc": "#000000", "fog": False, "auto": False, "seen": "0" * (cols * rows),
                "tokens": {}, "lines": {}, "walls": {}, "tiles": "." * (cols * rows), "wl": "1" * (cols * rows),
                "props": {}, "labels": {}, "trig": {}, "block": True, "spawn": None}

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
        self._fix(s)
        return s

    def _export(self, s):
        """Everything a DM made, to save as a file: scenes and maps with hidden things, triggers, items, the
        world map, the board. The pictures go in by name; the page fetches them and puts them in the file."""
        camp = copy.deepcopy({k: s[k] for k in EXPORT_KEYS if k in s})
        return {"ace_tabletop": 1, "exported": int(time.time()), "campaign": camp, "assets": sorted(s["assets"])}

    def _import(self, room, s, pid, blob):
        """Swap this campaign's insides for a file's. If anything in it doesn't work, nothing changes."""
        try:
            f = json.loads(blob)
        except ValueError:
            return "That file isn't an ACE Tabletop campaign."
        if not isinstance(f, dict) or f.get("ace_tabletop") != 1 or not isinstance(f.get("campaign"), dict):
            return "That file isn't an ACE Tabletop campaign."
        camp, pics = f["campaign"], f.get("assets") if isinstance(f.get("assets"), dict) else {}
        if not isinstance(camp.get("scenes"), dict) or not camp["scenes"]:
            return "That file has no scenes in it."
        old = copy.deepcopy({k: s[k] for k in (*SAVED_KEYS, "playas")})
        rename = {}
        try:
            for name, src in pics.items():
                if EXPORT_ASSET.match(str(name)) and isinstance(src, str):
                    new, err = self._store_image(s, src)
                    if err:
                        raise ValueError(err)
                    rename[name] = new

            def swap(v):
                if isinstance(v, str):
                    return rename.get(v, v)
                if isinstance(v, list):
                    return [swap(x) for x in v]
                if isinstance(v, dict):
                    return {k: swap(x) for k, x in v.items()}
                return v
            camp = swap(camp)
            self._fill_in(camp)
            for k in EXPORT_KEYS:
                if k == "name":
                    continue
                if k in camp:
                    s[k] = camp[k]
            s["order"] = [i for i in s["order"] if i in s["scenes"]] or list(s["scenes"])
            s["at"], s["playas"], s["pops"] = {}, {}, []
            self._fix(s)
            for sc in s["scenes"].values():
                for k in ("tokens", "lines", "walls", "props", "labels", "trig"):
                    if not isinstance(sc.get(k), dict):
                        raise ValueError(k)
                n = sc["cols"] * sc["rows"]
                if len(sc["tiles"]) != n or len(sc.get("seen") or "") != n:
                    raise ValueError("size")
                self._auto_walls(sc)
                self._scene_view(s, sc, True)
                self._scene_view(s, sc, False)
            self._view(room, pid)
            self._tidy_assets(s)
        except Exception as e:                         # a broken file: put everything back as it was
            for k, v in old.items():
                s[k] = v
            for name in rename.values():
                if name not in s["assets"]:
                    try:
                        os.remove(os.path.join(_asset_dir(s["slug"]), name))
                    except OSError:
                        pass
            return str(e) if isinstance(e, ValueError) and " " in str(e) else "Something in that file is broken, so nothing was changed."
        self._sys(s, f"{s['names'].get(pid, 'The DM')} loaded a campaign file.")
        return None

    def _fill_in(self, camp):
        """A hand-written file can leave most things out: give every scene, token, prop, trigger and item what it
        needs, with ids from their keys. Walls are rebuilt from the tiles afterwards."""
        def each(d):
            return [(k, v) for k, v in list(d.items()) if isinstance(v, dict)] if isinstance(d, dict) else []
        for k, sc in each(camp.get("scenes")):
            cols, rows = int(sc.get("cols") or 24), int(sc.get("rows") or 16)
            base = self._scene(sc.get("name") or "Scene", cols, rows)
            sc.update({**base, **sc, "id": k, "cols": cols, "rows": rows})
            n = cols * rows
            if len(sc["tiles"]) < n:
                sc["tiles"] = (sc["tiles"] + "." * n)[:n]
            if len(sc.get("seen") or "") != n:
                sc["seen"] = "0" * n
            if len(sc.get("wl") or "") != n:
                sc["wl"] = "1" * n
            for tk, t in each(sc["tokens"]):
                t.update({**{"id": tk, "name": "Token", "x": 0, "y": 0, "size": 1, "c": "#e5484d", "img": None, "hp": None,
                             "mhp": None, "ac": None, "init": None, "conds": [], "hidden": False, "showhp": False,
                             "owner": None, "char": None, "note": ""}, **t, "id": tk})
                if t["hp"] is None and t["mhp"] is not None:
                    t["hp"] = t["mhp"]
            for pk, pr in each(sc["props"]):
                pr.update({**{"r": 0}, **pr, "id": pk})
            for lk, lb in each(sc["labels"]):
                lb.update({**{"dm": False, "text": ""}, **lb, "id": lk})
            for rk, tr in each(sc["trig"]):
                tr.update({**{"name": "Trigger", "when": "enter", "do": "tell", "who": "them", "once": True, "used": False,
                              "text": "", "to": None, "tok": None, "x": 0, "y": 0, "w": 1, "h": 1}, **tr, "id": rk})
            sc["walls"] = {wk: {**w, "id": wk} for wk, w in each(sc["walls"]) if not w.get("auto") or w.get("door")}
        for ik, it in each(camp.get("items")):
            it.update({**{"name": "Something", "text": "", "kind": "item", "img": None, "given": False}, **it, "id": ik})
        for mk, m in each((camp.get("world") or {}).get("marks")):
            m.update({**{"name": "Somewhere", "x": 0.5, "y": 0.5, "sc": None, "shown": True}, **m, "id": mk})
        if isinstance(camp.get("scenes"), dict) and not isinstance(camp.get("order"), list):
            camp["order"] = list(camp["scenes"])

    def _fix(self, s):
        """Fill in anything an older save (or an imported file) is missing."""
        if not s["order"]:
            sc = self._scene("The first map", 24, 16)
            s["scenes"][sc["id"]] = sc
            s["order"] = [sc["id"]]
        if s["active"] not in s["scenes"]:
            s["active"] = s["order"][0]
        if not isinstance(s.get("at"), dict):
            s["at"] = {}
        if not isinstance(s.get("lib"), dict):
            s["lib"] = self._starter_lib()
        if not isinstance(s.get("enc"), dict) or "lvl" not in s["enc"]:
            s["enc"] = {"lvl": 1, "diff": "medium"}
        if not isinstance(s.get("items"), dict):
            s["items"] = {}
        if not isinstance(s.get("world"), dict):
            s["world"] = {"img": None, "marks": {}, "open": False}
        s["world"].setdefault("marks", {})
        if not isinstance(s.get("board"), dict):
            s["board"] = {}
        if not isinstance(s.get("fakes"), dict):
            s["fakes"] = {}
        s["names"].update(s["fakes"])
        if not isinstance(s.get("pops"), list):
            s["pops"] = []
        s["popn"] = max([s.get("popn") or 0] + [p.get("n", 0) for p in s["pops"]])
        for sc in s["scenes"].values():
            sc.setdefault("walls", {})
            sc.setdefault("auto", False)
            sc.setdefault("tiles", "." * (sc["cols"] * sc["rows"]))
            sc.setdefault("props", {})
            sc.setdefault("labels", {})
            sc.setdefault("trig", {})
            sc.setdefault("block", True)
            sc.setdefault("spawn", None)
            if len(sc.get("wl") or "") != len(sc["tiles"]):
                sc["wl"] = "".join("1" if t in OLD_WALLED or t == "." else "0" for t in sc["tiles"])
        for ch in s["chars"].values():
            ch.setdefault("slots", [[0, 0] for _ in range(9)])
            ch.setdefault("hd", "")

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
        used.update(n.get("img") for n in s["notes"].values())
        used.update(e.get("img") for e in s.get("lib", {}).values())
        used.update(i.get("img") for i in s.get("items", {}).values())
        used.add(s.get("world", {}).get("img"))
        for name in [a for a in s["assets"] if a not in used]:
            s["assets"].pop(name, None)
            try:
                os.remove(os.path.join(_asset_dir(s["slug"]), name))
            except OSError:
                pass

    # ---- Scenes and fog ----------------------------------------------------------------------
    def _resize(self, sc, cols, rows):
        n = sc["cols"] * sc["rows"]
        old, oldt, oldw = sc["seen"], sc.get("tiles") or "." * n, sc.get("wl") or "1" * n
        seen, tiles, wl = ["0"] * (cols * rows), ["."] * (cols * rows), ["1"] * (cols * rows)
        for y in range(min(rows, sc["rows"])):
            for x in range(min(cols, sc["cols"])):
                seen[y * cols + x] = old[y * sc["cols"] + x]
                tiles[y * cols + x] = oldt[y * sc["cols"] + x]
                wl[y * cols + x] = oldw[y * sc["cols"] + x]
        sc["cols"], sc["rows"], sc["seen"], sc["tiles"], sc["wl"] = cols, rows, "".join(seen), "".join(tiles), "".join(wl)
        sc["props"] = {k: v for k, v in sc.get("props", {}).items() if v["x"] < cols and v["y"] < rows}
        sp = sc.get("spawn")
        if sp:                                          # keep the spawn on the map
            sc["spawn"] = None if sp["x"] >= cols or sp["y"] >= rows else {
                "x": sp["x"], "y": sp["y"], "w": min(sp["w"], cols - sp["x"]), "h": min(sp["h"], rows - sp["y"])}
        self._auto_walls(sc)

    def _auto_walls(self, sc):
        """Turn painted walls and doors into walls for sight. Every edge between a wall square and a square you can
        stand on is a wall; edges in a straight line are joined. A door goes across its square, along the wall it's
        in, and keeps whether it was open or locked."""
        doors = {w.get("tile"): w for w in sc["walls"].values() if w.get("auto") and w.get("door")}
        sc["walls"] = {k: w for k, w in sc["walls"].items() if not w.get("auto")}
        T, cols, rows = sc.get("tiles", ""), sc["cols"], sc["rows"]
        if not T.strip("."):
            return
        W = sc.get("wl") or "1" * len(T)

        def tile(x, y):
            return T[y * cols + x] if 0 <= x < cols and 0 <= y < rows else "."

        def walled(x, y):
            t = tile(x, y)
            return t in OPEN_TILES and (t in "DS" or W[y * cols + x] == "1")

        def wall_between(x1, y1, x2, y2):
            a, b = tile(x1, y1), tile(x2, y2)
            return ((walled(x1, y1) and b in SOLID_TILES) or (walled(x2, y2) and a in SOLID_TILES)
                    or (a in WALL_TILES and b in OPEN_TILES) or (b in WALL_TILES and a in OPEN_TILES))

        made = 0

        def add(p, **extra):
            nonlocal made
            if made >= MAX_AUTO_WALLS:
                return
            made += 1
            wid = new_id()
            sc["walls"][wid] = {"id": wid, "p": p, "door": False, "open": False, "auto": True, **extra}

        for y in range(rows + 1):                       # edges along the top of row y
            start = None
            for x in range(cols + 1):
                on = x < cols and wall_between(x, y - 1, x, y)
                if on and start is None:
                    start = x
                elif not on and start is not None:
                    add([start, y, x, y])
                    start = None
        for x in range(cols + 1):                       # edges along the left of column x
            start = None
            for y in range(rows + 1):
                on = y < rows and wall_between(x - 1, y, x, y)
                if on and start is None:
                    start = y
                elif not on and start is not None:
                    add([x, start, x, y])
                    start = None
        for i, t in enumerate(T):
            if t not in "DS":
                continue
            x, y = i % cols, i // cols
            across = tile(x - 1, y) in SOLID_TILES or tile(x + 1, y) in SOLID_TILES
            p = [x, y + 0.5, x + 1, y + 0.5] if across else [x + 0.5, y, x + 0.5, y + 1]
            old = doors.get(f"{x},{y}") or {}
            add(p, door=True, open=bool(old.get("open")), locked=bool(old.get("locked")), tile=f"{x},{y}",
                secret=t == "S", showlock=bool(old.get("showlock")), key=old.get("key"))

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

    # ---- Vision: the fog clears around the party as they explore ------------------------------
    def _reveal(self, sc, only=None):
        """Clear the fog the players' tokens can see (all of them, or just token `only`)."""
        if not sc["fog"] or not sc.get("auto"):
            return
        walls = [w["p"] for w in sc["walls"].values() if not (w.get("door") and w.get("open"))]
        seen = list(sc["seen"])
        cols, rows = sc["cols"], sc["rows"]
        for t in sc["tokens"].values():
            sight = PC_SIGHT if t.get("sight") is None else t["sight"]      # tokens from before sight existed see 60 ft
            if (only and t["id"] != only) or not self._pc(t) or t.get("hidden") or not sight:
                continue
            half = t["size"] / 2
            cx, cy = t["x"] + half, t["y"] + half
            reach = sight + half
            near = [w for w in walls
                    if min(w[0], w[2]) <= cx + reach and max(w[0], w[2]) >= cx - reach
                    and min(w[1], w[3]) <= cy + reach and max(w[1], w[3]) >= cy - reach]
            for y in range(max(0, int(cy - reach)), min(rows, int(cy + reach) + 1)):
                for x in range(max(0, int(cx - reach)), min(cols, int(cx + reach) + 1)):
                    i = y * cols + x
                    if seen[i] == "1" or (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > reach * reach + 0.25:
                        continue
                    pts = ((x + 0.5, y + 0.5),) + tuple((x + a, y + b) for a, b in INSIDE)
                    if any(not any(crosses(cx, cy, px, py, w) for w in near) for px, py in pts):
                        seen[i] = "1"
        T = sc.get("tiles", "")
        W = sc.get("wl") or "1" * len(T)
        if T.strip("."):                       # on a drawn map, the rock just outside walled rooms they see shows too
            for i, t in enumerate(T):
                if seen[i] == "1" and t in OPEN_TILES and (t in "DS" or W[i] == "1"):
                    x, y = i % cols, i // cols
                    for yy in range(max(0, y - 1), min(rows, y + 2)):
                        for xx in range(max(0, x - 1), min(cols, x + 2)):
                            if T[yy * cols + xx] in SOLID_TILES:
                                seen[yy * cols + xx] = "1"
        sc["seen"] = "".join(seen)

    # ---- Triggers ---------------------------------------------------------------------------
    def _pop(self, s, title, text_, to=None, dm=False, sc=None, at=None):
        """A message that pops up: for the DM (dm=True) or for the players in `to`."""
        s["popn"] = s.get("popn", 0) + 1
        s.setdefault("pops", []).append({"n": s["popn"], "title": title, "text": text_, "to": list(to or []), "dm": dm,
                                         "sc": sc, "at": at})
        del s["pops"][:-MAX_POPS]

    def _trig_cells(self, sc, tr):
        """The squares a trigger covers, or None if it's on a token that's gone or hidden."""
        if tr.get("tok"):
            t = sc["tokens"].get(tr["tok"])
            if not t or t.get("hidden"):
                return None
            n = max(1, int(t["size"]))
            return [(x, y) for y in range(int(t["y"]), int(t["y"]) + n) for x in range(int(t["x"]), int(t["x"]) + n)]
        return [(x, y) for y in range(tr["y"], tr["y"] + tr["h"]) for x in range(tr["x"], tr["x"] + tr["w"])]

    def _touches(self, t, cells):
        n = max(1, int(t["size"]))
        x0, y0 = int(t["x"] + 0.001), int(t["y"] + 0.001)
        mine = {(x, y) for y in range(y0, y0 + n) for x in range(x0, x0 + n)}
        return any(c in mine for c in cells)

    def _sees(self, sc, t, cells, walls):
        """Can token t see any of these squares, from any distance? Walls and shut doors block."""
        if self._touches(t, cells):
            return True
        half = t["size"] / 2
        cx, cy = t["x"] + half, t["y"] + half
        cs = set(cells)                    # only the edge of an area needs checking: sight into it crosses the edge
        edge = [c for c in cells if not all((c[0] + dx, c[1] + dy) in cs for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
        xs, ys = [c[0] for c in edge] + [cx], [c[1] for c in edge] + [cy]
        x0, x1, y0, y1 = min(xs) - 1, max(xs) + 2, min(ys) - 1, max(ys) + 2
        near = [w for w in walls if max(w[0], w[2]) >= x0 and min(w[0], w[2]) <= x1 and max(w[1], w[3]) >= y0 and min(w[1], w[3]) <= y1]
        for x, y in sorted(edge, key=lambda c: (c[0] + 0.5 - cx) ** 2 + (c[1] + 0.5 - cy) ** 2):
            for px, py in ((x + 0.5, y + 0.5),) + tuple((x + a, y + b) for a, b in INSIDE):
                if not any(crosses(cx, cy, px, py, w) for w in near):
                    return True
        return False

    def _players_on(self, s, sc):
        """Everyone (not DMs) who's on this scene."""
        return [q for q in s["names"] if not self.is_dm(s, q) and self._where(s, q) == sc["id"]]

    def _fire(self, s, sc, tr, t, how, force=False):
        if tr.get("ask") and not force:            # the DM decides (after a roll): it waits till then
            tr["used"] = True
            tr["pending"] = {"tok": t["id"], "how": how, "name": t["name"]}
            cells = self._trig_cells(sc, tr) or [(tr.get("x", 0), tr.get("y", 0))]
            at = [sum(c[0] for c in cells) / len(cells) + 0.5, sum(c[1] for c in cells) / len(cells) + 0.5]
            verb = {"enter": "stepped into", "use": "used"}.get(how, "can see")
            self._pop(s, f'{tr["name"]}: your call', f'{t["name"]} {verb} it. Have them roll, then right-click it to set it off or skip it.',
                      dm=True, sc=sc["id"], at=at)
            return
        tr["pending"] = None
        tr["used"] = bool(tr.get("once"))
        who = self._owner_of(s, t)
        everyone = tr.get("who") == "all"
        to = self._players_on(s, sc) if everyone else [q for q in [who] if q and not self.is_dm(s, q)]
        cells = self._trig_cells(sc, tr) or [(tr.get("x", 0), tr.get("y", 0))]
        at = [sum(c[0] for c in cells) / len(cells) + 0.5, sum(c[1] for c in cells) / len(cells) + 0.5]
        did = ""
        if tr["do"] == "text":
            if to:
                self._pop(s, tr["name"], tr.get("text") or "", to=to)
            did = f' Showed {"everyone" if everyone else "them"} the message.'
        elif tr["do"] == "scene":
            target = s["scenes"].get(tr.get("to") or "")
            if target and target is not sc:
                toks = [o for o in sc["tokens"].values() if self._pc(o)] if everyone else [t]
                for o in toks:
                    self._arrive(s, sc, o, target)
                    q = self._owner_of(s, o)
                    if q and not self.is_dm(s, q):
                        s["at"][q] = target["id"]
                for q in to:
                    s["at"][q] = target["id"]
                did = f' Sent {"the party" if everyone else "them"} to {target["name"]}.'
        elif tr["do"] == "give":                   # loot: these items go straight to the party
            got = [i for i in (s["items"].get(k) for k in tr.get("items") or []) if i and not i["given"]]
            for i in got:
                i["given"] = True
            if got:
                names = ", ".join(i["name"] for i in got)
                self._pop(s, tr["name"], (tr.get("text") + "\n\n" if tr.get("text") else "") + f"The party got: {names}. It's in the Items tab.",
                          to=[q for q in s["names"] if not self.is_dm(s, q)])
                did = f" The party got {names}."
            else:
                did = " There was nothing left to give."
        elif tr["do"] == "open":
            got = self._open_area(sc, self._tgt_cells(sc, tr) or cells)
            did = f" Opened {got}." if got else ""
        elif tr["do"] == "reveal":
            cells = self._tgt_cells(sc, tr) or cells
            n = 0
            for o in sc["tokens"].values():
                if o.get("hidden") and self._touches(o, cells):
                    o["hidden"] = False
                    n += 1
            if n:
                self._reveal(sc)
            area = set(cells)
            m = 0
            for pr in list(sc.get("props", {}).values()):
                if pr.get("hidden") and (pr["x"], pr["y"]) in area:
                    self._set_hidden(sc, pr, False)
                    m += 1
            w = self._show_hwall(sc, cells, True)
            got = ([f"{n} hidden token{'s' if n != 1 else ''}"] * bool(n) + [f"{m} hidden prop{'s' if m != 1 else ''}"] * bool(m)
                   + ["a hidden wall"] * bool(w))
            did = f" Revealed {' and '.join(got)}." if got else ""
        verb = {"enter": "stepped into", "use": "used"}.get(how, "can see")
        self._pop(s, tr["name"], f'{t["name"]} {verb} it.{did}', dm=True, sc=sc["id"], at=at)

    def _tgt_cells(self, sc, tr):
        g = tr.get("tgt")
        if not g:
            return None
        return [(x, y) for y in range(g["y"], min(sc["rows"], g["y"] + g["h"])) for x in range(g["x"], min(sc["cols"], g["x"] + g["w"]))]

    def _open_area(self, sc, cells):
        """A lever (or such) opens what's in these squares: doors (unlocked and opened), secret doors (they become
        doors) and hidden walls (they're gone: a passage). Hidden tokens and props there show too. Says what it did."""
        cols, rows = sc["cols"], sc["rows"]
        area = set(cells)
        T = list(sc.get("tiles", ""))
        secret = 0
        for x, y in cells:
            if T and T[y * cols + x] == "S":
                T[y * cols + x] = "D"
                secret += 1
        gone = set()                                  # hidden walls touching the area, the whole stretch
        todo = [(x, y) for x, y in cells if T and T[y * cols + x] in "hH"]
        while todo:
            c = todo.pop()
            if c in gone:
                continue
            gone.add(c)
            x, y = c
            for xx, yy in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= xx < cols and 0 <= yy < rows and T[yy * cols + xx] in "hH" and (xx, yy) not in gone:
                    todo.append((xx, yy))
        for x, y in gone:
            near = [T[yy * cols + xx] for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                    if 0 <= xx < cols and 0 <= yy < rows and (xx, yy) not in gone]
            T[y * cols + x] = next((n for n in near if n in "fogd"), "f")
        if secret or gone:
            sc["tiles"] = "".join(T)
            self._auto_walls(sc)
        doors = 0
        for w in sc["walls"].values():
            if not w.get("door"):
                continue
            if w.get("tile"):
                x, y = map(int, w["tile"].split(","))
            else:
                x, y = int((w["p"][0] + w["p"][2]) / 2), int((w["p"][1] + w["p"][3]) / 2)
            if (x, y) in area and (not w.get("open") or w.get("locked") or w.get("secret")):
                w["open"], w["locked"], w["secret"] = True, False, False
                doors += 1
        shown = 0
        for o in sc["tokens"].values():
            if o.get("hidden") and self._touches(o, cells):
                o["hidden"] = False
                shown += 1
        for pr in list(sc.get("props", {}).values()):
            if pr.get("hidden") and (pr["x"], pr["y"]) in area:
                self._set_hidden(sc, pr, False)
                shown += 1
        self._reveal(sc)
        got = ([f"{doors} door{'s' if doors != 1 else ''}"] * bool(doors) + ["a hidden wall"] * bool(gone)
               + [f"{shown} hidden thing{'s' if shown != 1 else ''}"] * bool(shown))
        return " and ".join(got)

    def _triggers(self, s, sc, moved=(), by_player=False):
        """Check this scene's triggers after something changed. moved: tokens that just moved."""
        trigs = [tr for tr in sc.get("trig", {}).values() if not tr.get("used")]
        if not trigs:
            return
        pcs = [t for t in sc["tokens"].values() if self._pc(t) and not t.get("hidden")]
        walls = None
        for tr in trigs:
            if tr.get("used") or sc["id"] not in s["scenes"]:
                continue
            cells = self._trig_cells(sc, tr)
            if tr["when"] == "enter":
                inside = set(tr.get("inside") or [])
                now = {t["id"] for t in pcs if cells and self._touches(t, cells)}
                for t in pcs:                          # only a player moving their own token sets it off
                    if t["id"] in now and t["id"] not in inside and by_player and any(m["id"] == t["id"] for m in moved):
                        self._fire(s, sc, tr, t, "enter")
                        break
                tr["inside"] = sorted(now)
            elif tr["when"] == "see":
                if walls is None:
                    walls = [w["p"] for w in sc["walls"].values() if not (w.get("door") and w.get("open"))]
                seer = next((t for t in pcs if cells and self._sees(sc, t, cells, walls)), None)
                if seer and not tr.get("seen"):
                    self._fire(s, sc, tr, seer, "see")
                tr["seen"] = bool(seer)

    def _door_seen(self, sc, w):
        """Can players see this door (so they can open it)? Yes if fog is off or a square beside it is clear."""
        if not sc["fog"]:
            return True
        x1, y1, x2, y2 = w["p"]
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        for dx, dy in ((-0.5, 0), (0.5, 0), (0, -0.5), (0, 0.5)):
            x, y = int(mx + dx), int(my + dy)
            if 0 <= x < sc["cols"] and 0 <= y < sc["rows"] and sc["seen"][y * sc["cols"] + x] == "1":
                return True
        return False

    def _hurt(self, s, t, delta, dm):
        """Damage (delta < 0) or heal a token: a character's temporary HP goes first, and healing stops at max."""
        ch = s["chars"].get(t.get("char"))
        hp, mhp = (ch["hp"], ch["mhp"]) if ch else (t.get("hp"), t.get("mhp"))
        if hp is None:
            hp = mhp or 0
        if delta < 0 and ch and ch["thp"]:
            soak = min(ch["thp"], -delta)
            ch["thp"] -= soak
            delta += soak
        hp += delta
        if mhp and hp > mhp:
            hp = mhp
        if ch:
            ch["hp"] = max(-999, hp)
        else:
            t["hp"] = max(-999, hp)

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
        for key, lo, hi in (("hp", -999, 9999), ("mhp", 0, 9999), ("ac", 0, 99), ("init", -20, 30), ("sight", 0, 60),
                            ("aura", 0, 60), ("elev", -999, 9999), ("speed", 0, 999)):
            if key == "sight" and not dm:               # how far the fog clears for it is the DM's call
                continue
            if key in d:
                v = d[key]
                t[key] = None if v in (None, "") else num(v, lo, hi)
        if "conds" in d and isinstance(d["conds"], list):
            t["conds"] = [c for c in CONDITIONS if c in {str(x) for x in d["conds"]}]
        if "note" in d:
            t["note"] = text(d["note"], 500)
        if "ac2" in d:                                  # the aura's colour
            t["ac2"] = colour(d["ac2"], "#ffd43b")
        if dm and "stats" in d:                         # a monster's stat block (only the DM gets it)
            st = d["stats"] if isinstance(d["stats"], dict) else None
            if not st:
                t["stats"] = None
            else:
                abil = st.get("abil") if isinstance(st.get("abil"), list) else []
                abil = [num(v, 1, 30) for v in abil[:6]]
                t["stats"] = {"abil": [10 if v is None else v for v in abil] + [10] * (6 - len(abil)),
                              **{k: text(st.get(k), n) for k, n in (("speed", 80), ("skills", 300), ("saves", 200),
                                 ("senses", 300), ("langs", 200), ("cr", 10), ("traits", 3000), ("actions", 3000))}}
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
                "ds": [0, 0], "insp": False, "c": "#3e63dd", "slots": [[0, 0] for _ in range(9)], "hd": ""}

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
        if isinstance(d.get("slots"), list) and len(d["slots"]) == 9:
            slots = []
            for pair in d["slots"]:
                mx = num(pair[0], 0, 9) if isinstance(pair, list) and len(pair) == 2 else 0
                used = num(pair[1], 0, 9) if isinstance(pair, list) and len(pair) == 2 else 0
                slots.append([mx or 0, min(mx or 0, used or 0)])
            ch["slots"] = slots
        if "hd" in d:
            ch["hd"] = line(d["hd"], 30)
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
        fake = data.get("as")
        if fake is not None and action not in ("fake_add", "fake_del", "play_as"):
            if not dm or not isinstance(fake, str) or fake not in s["fakes"]:   # only a DM can play as a pretend player
                return "That pretend player isn't there any more."
            if action == "claim_dm":
                return "A pretend player can't be a DM."
            err = self._act(room, s, fake, s["fakes"][fake], False, action, data)
        else:
            err = self._act(room, s, pid, me, dm, action, data)
        if err is None:
            self._changed(s)
        return err

    def _where(self, s, pid):
        """The scene a player is on: the one the DM showed everyone, unless they took the stairs elsewhere."""
        at = s.get("at", {}).get(pid)
        return at if at in s["scenes"] else s["active"]

    def _scene_of(self, s, data, dm, pid=None):
        sc = s["scenes"].get(str(data.get("sc", "")))
        if not sc or (not dm and sc["id"] != self._where(s, pid)):
            return None
        return sc

    def _owner_of(self, s, t):
        ch = s["chars"].get(t.get("char"))
        return ch["owner"] if ch else t.get("owner")

    def _uncover(self, sc, pr):
        """Hidden prop pr was just revealed: push whatever prop was on top of it onto a free square beside it."""
        T, cols, rows = sc.get("tiles", ""), sc["cols"], sc["rows"]
        drawn = bool(T.strip("."))
        taken = {(o["x"], o["y"]) for o in sc["props"].values()}
        for o in [o for o in sc["props"].values() if o is not pr and not o.get("hidden") and (o["x"], o["y"]) == (pr["x"], pr["y"])]:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1)):
                x, y = pr["x"] + dx, pr["y"] + dy
                if 0 <= x < cols and 0 <= y < rows and (x, y) not in taken and (not drawn or T[y * cols + x] in "fogd"):
                    o["x"], o["y"] = x, y
                    taken.add((x, y))
                    break

    def _set_hidden(self, sc, pr, hidden):
        was, pr["hidden"] = bool(pr.get("hidden")), bool(hidden)
        if was and not pr["hidden"]:
            self._uncover(sc, pr)

    def _show_hwall(self, sc, cells, show):
        """Show (h -> H) or hide (H -> h) the hidden walls touching these squares, the whole joined-up stretch."""
        T, cols, rows = list(sc.get("tiles", "")), sc["cols"], sc["rows"]
        src, dst = ("h", "H") if show else ("H", "h")
        todo = [(x, y) for x, y in cells if 0 <= x < cols and 0 <= y < rows and T[y * cols + x] == src]
        n = 0
        while todo:
            x, y = todo.pop()
            if T[y * cols + x] != src:
                continue
            T[y * cols + x] = dst
            n += 1
            for xx, yy in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= xx < cols and 0 <= yy < rows and T[yy * cols + xx] == src:
                    todo.append((xx, yy))
        if n:
            sc["tiles"] = "".join(T)
        return n

    def _free_spot(self, sc, t, near):
        """A square near (x, y) where token t fits: on the map, not in rock or wall, not on another token."""
        cols, rows, T = sc["cols"], sc["rows"], sc.get("tiles", "")
        drawn = bool(T.strip("."))
        n = max(1, int(t["size"]))
        taken = set()
        for o in sc["tokens"].values():
            if o["id"] != t["id"]:
                for yy in range(int(o["y"]), int(o["y"]) + max(1, int(o["size"]))):
                    for xx in range(int(o["x"]), int(o["x"]) + max(1, int(o["size"]))):
                        taken.add((xx, yy))
        props = {(pr["x"], pr["y"]) for pr in sc.get("props", {}).values() if pr.get("to")}
        nx, ny = near
        for r in range(0, max(cols, rows)):
            ring = [(nx + dx, ny + dy) for dy in range(-r, r + 1) for dx in range(-r, r + 1) if max(abs(dx), abs(dy)) == r]
            for x, y in ring:
                if x < 0 or y < 0 or x + n > cols or y + n > rows:
                    continue
                cells = [(xx, yy) for yy in range(y, y + n) for xx in range(x, x + n)]
                if any(c in taken or c in props for c in cells):
                    continue
                if drawn and any(T[yy * cols + xx] not in "fogdD" for xx, yy in cells):
                    continue
                return x, y
        return max(0, min(cols - n, nx)), max(0, min(rows - n, ny))

    def _arrive(self, s, sc, t, target, stairs=False):
        """Move token t from scene sc to scene target: into its player spawn, or (walking stairs, or no spawn)
        next to the stairs (or door...) that lead back."""
        back = next((pr for pr in target.get("props", {}).values() if pr.get("to") == sc["id"]), None)
        near = (back["x"], back["y"]) if back else (target["cols"] // 2, target["rows"] // 2)
        del sc["tokens"][t["id"]]
        spot = None if stairs and back else self._spawn_spot(target, t)
        t["x"], t["y"] = spot or self._free_spot(target, t, near)
        target["tokens"][t["id"]] = t
        for e in s["init"]["list"]:
            if e.get("tok") == t["id"]:
                e["sc"] = target["id"]
        self._reveal(target, t["id"])

    def _blocked(self, sc, t, nx, ny):
        """Would a player's token have to go through a wall or a shut door to get from where it is to (nx, ny)?
        It may go round: any way there, one square at a time (not diagonally), counts."""
        if not sc.get("block", True):
            return False
        walls = [w["p"] for w in sc["walls"].values() if not (w.get("door") and w.get("open"))]
        if not walls:
            return False
        cols, rows = sc["cols"], sc["rows"]

        def cell(x, y):
            return max(0, min(cols - 1, int(x + 0.001))), max(0, min(rows - 1, int(y + 0.001)))
        start, goal = cell(t["x"], t["y"]), cell(nx, ny)
        if start == goal:
            return False
        near = {}                                     # the walls that pass through each square
        for p in walls:
            steps = max(1, int(max(abs(p[2] - p[0]), abs(p[3] - p[1])) * 4))
            got = set()
            for i in range(steps + 1):
                f = i / steps
                got.add(cell(p[0] + (p[2] - p[0]) * f, p[1] + (p[3] - p[1]) * f))
            for c in got:
                near.setdefault(c, []).append(p)

        def step_ok(a, b):
            ax, ay, bx, by = a[0] + 0.5, a[1] + 0.5, b[0] + 0.5, b[1] + 0.5
            return not any(meets(ax, ay, bx, by, w) for w in near.get(a, []) + near.get(b, []))
        seen, todo = {start}, [start]
        while todo:
            a = todo.pop()
            for b in ((a[0] + 1, a[1]), (a[0] - 1, a[1]), (a[0], a[1] + 1), (a[0], a[1] - 1)):
                if 0 <= b[0] < cols and 0 <= b[1] < rows and b not in seen and step_ok(a, b):
                    if b == goal:
                        return False
                    seen.add(b)
                    todo.append(b)
        return True

    def _spawn_spot(self, sc, t):
        """A free square for token t inside the scene's player spawn (or as close to it as it gets), or None."""
        sp = sc.get("spawn")
        if not sp:
            return None
        cx, cy = sp["x"] + sp["w"] // 2, sp["y"] + sp["h"] // 2
        x, y = self._free_spot(sc, t, (cx, cy))
        return x, y

    def _take_stairs(self, s, sc, t, pid, dm):
        """A player's token moved onto a link players may use: it goes to the linked scene, and so do they."""
        if dm:
            return
        x0, y0, n = int(t["x"] + 0.001), int(t["y"] + 0.001), max(1, int(t["size"]))
        for pr in sc.get("props", {}).values():
            target = s["scenes"].get(pr.get("to") or "")
            if pr.get("open") and not pr.get("hidden") and target and target is not sc and x0 <= pr["x"] < x0 + n and y0 <= pr["y"] < y0 + n:
                if not s["settings"].get("split"):  # the party stays together: the DM decides when it moves on
                    asked = self.__dict__.setdefault("_asked", {})
                    key = (s["slug"], pid, pr["id"])
                    if time.time() - asked.get(key, 0) > 20:
                        asked[key] = time.time()
                        self._pop(s, "The party stays together", f"The way to {target['name']} is here. The DM moves the whole party on when it's time.", to=[pid])
                        self._pop(s, f"{t['name']} wants to go to {target['name']}",
                                  "Right-click the stairs and choose \"Take the party to\" when everyone's ready.", dm=True, sc=sc["id"], at=[pr["x"], pr["y"]])
                    return
                self._arrive(s, sc, t, target, stairs=True)
                for who in {pid, self._owner_of(s, t)}:
                    if who and not self.is_dm(s, who):
                        s["at"][who] = target["id"]
                return

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
        if action == "fake_add":                      # a pretend player, to try the table out alone
            if not dm:
                return need_dm
            if len(s["fakes"]) >= MAX_FAKES:
                return f"You can have {MAX_FAKES} pretend players. Delete one first."
            fid = "fake" + new_id(8)
            name = line(data.get("name"), 20) or f"Pretend player {len(s['fakes']) + 1}"
            s["fakes"][fid] = s["names"][fid] = name
            sc = s["scenes"][s["active"]]
            if len(sc["tokens"]) < MAX_TOKENS:
                t = {"id": new_id(), "name": name, "x": 0, "y": 0, "size": 1, "c": "#12a594", "img": None, "hp": 10,
                     "mhp": 10, "ac": 10, "init": None, "conds": [], "hidden": False, "showhp": False, "owner": fid,
                     "char": None, "note": "", "sight": PC_SIGHT}
                t["x"], t["y"] = self._free_spot(sc, t, (sc["cols"] // 2, sc["rows"] // 2))
                sc["tokens"][t["id"]] = t
                self._reveal(sc, t["id"])
                self._triggers(s, sc)
            s["playas"][pid] = fid
            return None
        if action == "fake_del":
            if not dm:
                return need_dm
            fid = str(data.get("id", ""))
            if s["fakes"].pop(fid, None) is None:
                return "That pretend player isn't there any more."
            s["names"].pop(fid, None)
            s["at"].pop(fid, None)
            s["mine"].pop(fid, None)
            for sc in s["scenes"].values():
                for t in [t for t in sc["tokens"].values() if t.get("owner") == fid]:
                    del sc["tokens"][t["id"]]
                    s["init"]["list"] = [e for e in s["init"]["list"] if e.get("tok") != t["id"]]
            for ch in s["chars"].values():
                if ch["owner"] == fid:
                    ch["owner"] = pid
            s["playas"] = {q: f for q, f in s["playas"].items() if f != fid}
            return None
        if action == "play_as":
            if not dm:
                return need_dm
            fid = data.get("id")                      # a pretend player to play as, or a real one to look as
            if fid and (not isinstance(fid, str) or fid not in self._viewable(room)):
                return "That player isn't here any more."
            if fid:
                s["playas"][pid] = fid
            else:
                s["playas"].pop(pid, None)
            return None
        if action == "set_dm":
            if pid != s["owner"]:
                return "Only the person who made the campaign can choose the DMs."
            target = str(data.get("player", ""))
            if target in s["fakes"]:
                return "That's a pretend player."
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
            if "split" in data:                       # may players take stairs off on their own?
                s["settings"]["split"] = bool(data["split"])
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
                for key in ("grid", "fog", "auto", "block"):
                    if key in data:
                        sc[key] = bool(data[key])
                self._reveal(sc)
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
                self._show_scene(s, sc)
                return None
            if action == "scene_move":
                i = s["order"].index(sc["id"])
                j = max(0, min(len(s["order"]) - 1, i + (1 if data.get("down") else -1)))
                s["order"][i], s["order"][j] = s["order"][j], s["order"][i]
                return None
            if action == "scene_copy":
                sc.setdefault("walls", {})
                if len(s["scenes"]) >= MAX_SCENES:
                    return f"A campaign can have {MAX_SCENES} scenes."
                copy = json.loads(json.dumps(sc))
                copy["id"] = new_id()
                copy["name"] = (sc["name"] + " (copy)")[:40]
                copy["tokens"] = {(n := new_id()): {**t, "id": n} for t in copy["tokens"].values()}
                copy["lines"] = {(n := new_id()): {**ln, "id": n} for ln in copy["lines"].values()}
                copy["walls"] = {(n := new_id()): {**w, "id": n} for w in copy.get("walls", {}).values()}
                copy["props"] = {(n := new_id()): {**pr, "id": n} for pr in copy.get("props", {}).values()}
                copy["labels"] = {(n := new_id()): {**lb, "id": n} for lb in copy.get("labels", {}).values()}
                new_tok = {t["id"]: n for n, t in zip(copy["tokens"], sc["tokens"].values())}
                trigs = {}
                for tr in copy.get("trig", {}).values():     # token triggers follow their token's new id
                    if tr.get("tok") and tr["tok"] not in new_tok:
                        continue
                    n = new_id()
                    trigs[n] = {**tr, "id": n, "tok": new_tok.get(tr.get("tok")), "used": False, "seen": False,
                                "inside": [new_tok[i] for i in tr.get("inside") or [] if i in new_tok]}
                copy["trig"] = trigs
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

        # -- The DM's token list --
        if action == "lib_add":                       # save a token on the map to the list
            if not dm:
                return need_dm
            lib = s.setdefault("lib", {})
            if len(lib) >= MAX_LIB:
                return f"The list can hold {MAX_LIB} tokens. Take some off first."
            sc = s["scenes"].get(str(data.get("sc", "")))
            t = sc["tokens"].get(str(data.get("id", ""))) if sc else None
            if not t:
                return "That token isn't there any more."
            hp, mhp, ac = self._hp_of(s, t)
            e = {k: t.get(k) for k in LIB_KEEP}
            e.update(id=new_id(), cat=data.get("cat") if data.get("cat") in LIB_CATS else "enemy",
                     name=re.sub(r"\s+\d+$", "", t["name"]) or t["name"], mhp=mhp if mhp is not None else hp, ac=ac)
            lib[e["id"]] = e
            return None
        if action == "enc_set":                       # random encounters: the party's level and how hard a fight
            if not dm:
                return need_dm
            lvl = num(data.get("lvl"), 1, 20)
            diff = data.get("diff") if data.get("diff") in ENC_DIFFS else s["enc"].get("diff", "medium")
            size = num(data.get("size"), 0, 12) if "size" in data else s["enc"].get("size", 0)
            s["enc"] = {"lvl": lvl or s["enc"].get("lvl", 1), "diff": diff, "size": size or 0}
            return None
        if action == "lib_del":
            if not dm:
                return need_dm
            if s.setdefault("lib", {}).pop(str(data.get("id", "")), None):
                self._tidy_assets(s)
            return None

        # -- Tokens --
        if action == "tok_add":
            sc = self._scene_of(s, data, dm, pid)
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
                if self._pc(t) and t.get("sight") is None:
                    t["sight"] = PC_SIGHT
                sc["tokens"][t["id"]] = t
                self._reveal(sc, t["id"])
            self._triggers(s, sc)
            return None
        if action == "tok_group":                     # several selected tokens at once
            sc = self._scene_of(s, data, dm, pid)
            if not sc:
                return "That scene isn't there any more."
            op = data.get("op")
            if op == "move":
                moved, stopped = [], 0
                moves = data.get("moves") if isinstance(data.get("moves"), list) else []
                for m in moves[:MAX_TOKENS]:
                    t = sc["tokens"].get(str(m.get("id", ""))) if isinstance(m, dict) else None
                    if t and self._controls(s, pid, t):
                        x, y = num(m.get("x"), -50, MAX_GRID + 50, 2), num(m.get("y"), -50, MAX_GRID + 50, 2)
                        if not dm and x is not None and y is not None and self._blocked(sc, t, x, y):
                            stopped += 1
                            continue
                        self._token_fields(s, t, {"x": m.get("x"), "y": m.get("y")}, dm)
                        self._reveal(sc, t["id"])
                        self._take_stairs(s, sc, t, pid, dm)
                        if t["id"] in sc["tokens"]:
                            moved.append(t)
                if stopped and not moved:
                    return "There's a wall in the way."
                self._triggers(s, sc, moved, not dm)
                return None
            ids = data.get("ids") if isinstance(data.get("ids"), list) else []
            toks = [sc["tokens"][i] for i in map(str, ids[:MAX_TOKENS]) if i in sc["tokens"]]
            toks = [t for t in toks if self._controls(s, pid, t)]
            if not toks:
                return "None of those are yours to change."
            if op == "hp":
                delta = num(data.get("delta"), -9999, 9999)
                if not delta:
                    return "Type how much damage or healing first."
                for t in toks:
                    self._hurt(s, t, delta, dm)
                return None
            if op == "cond":
                cond = str(data.get("cond", ""))
                if cond not in CONDITIONS:
                    return "Unknown condition."
                for t in toks:
                    on = bool(data.get("on"))
                    t["conds"] = [c for c in CONDITIONS if (c == cond and on) or (c != cond and c in t["conds"])]
                return None
            if op == "del":
                for t in toks:
                    del sc["tokens"][t["id"]]
                    s["init"]["list"] = [e for e in s["init"]["list"] if e.get("tok") != t["id"]]
                self._tidy_assets(s)
                return None
            return "Unknown action."
        if action in ("tok_edit", "tok_move", "tok_del", "tok_img", "tok_front"):
            sc = self._scene_of(s, data, dm, pid)
            t = sc["tokens"].get(str(data.get("id", ""))) if sc else None
            if not t:
                return "That token isn't there any more."
            if not self._controls(s, pid, t):
                return "That isn't your token. Ask the DM."
            if action == "tok_move":
                x, y = num(data.get("x"), -50, MAX_GRID + 50, 2), num(data.get("y"), -50, MAX_GRID + 50, 2)
                if not dm and x is not None and y is not None and self._blocked(sc, t, x, y):
                    return "There's a wall in the way."
                self._token_fields(s, t, {"x": data.get("x"), "y": data.get("y")}, dm)
                self._reveal(sc, t["id"])
                self._take_stairs(s, sc, t, pid, dm)
                if t["id"] in sc["tokens"]:
                    self._triggers(s, sc, [t], not dm)
                return None
            if action == "tok_edit":
                d = data.get("set") if isinstance(data.get("set"), dict) else {}
                ch = s["chars"].get(t.get("char"))
                if ch and any(k in d for k in ("hp", "mhp", "ac")):        # a character's token changes its sheet
                    self._char_fields(s, ch, {k: d[k] for k in ("hp", "mhp", "ac") if k in d}, dm)
                    d = {k: v for k, v in d.items() if k not in ("hp", "mhp", "ac")}
                if not dm and ("x" in d or "y" in d):
                    x = num(d.get("x", t["x"]), -50, MAX_GRID + 50, 2)
                    y = num(d.get("y", t["y"]), -50, MAX_GRID + 50, 2)
                    if x is not None and y is not None and self._blocked(sc, t, x, y):
                        return "There's a wall in the way."
                if "hpd" in d:                                          # damage or healing
                    delta = num(d.pop("hpd"), -9999, 9999)
                    if delta:
                        self._hurt(s, t, delta, dm)
                self._token_fields(s, t, d, dm)
                self._reveal(sc, t["id"])
                self._triggers(s, sc)
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

        # -- Map maker --
        if action == "export":                        # DMs only: the whole campaign, hidden things and all
            if not dm:
                return need_dm
            return {"camp": self._export(s)}
        if action == "import_part":                   # a campaign file, sent in pieces; the last one loads it
            if not dm:
                return need_dm
            up, i, n = str(data.get("up", ""))[:20], num(data.get("i"), 0, 10_000), num(data.get("n"), 1, 10_000)
            part = data.get("part")
            if not up or i is None or not n or i >= n or not isinstance(part, str) or len(part) > MAX_IMPORT_PART:
                return "Couldn't read that file."
            if n * MAX_IMPORT_PART > MAX_IMPORT_CHARS + MAX_IMPORT_PART:
                return "That file is too big."
            ups = self.__dict__.setdefault("_uploads", {})
            key = (s["slug"], pid)
            u = ups.get(key)
            if not u or u["up"] != up:
                u = ups[key] = {"up": up, "n": n, "parts": {}}
            u["parts"][i] = part
            if len(u["parts"]) < u["n"]:
                return {"got": len(u["parts"])}
            del ups[key]
            return self._import(room, s, pid, "".join(u["parts"][k] for k in range(u["n"])))
        if action in ("break_set", "break_hit"):     # breakable walls and doors: HP the DM sets and knocks off
            if not dm:
                return need_dm
            sc = s["scenes"].get(str(data.get("sc", "")))
            if not sc:
                return "That scene isn't there any more."
            cols, rows = sc["cols"], sc["rows"]
            x, y = num(data.get("x"), 0, cols - 1), num(data.get("y"), 0, rows - 1)
            if x is None or y is None:
                return "Couldn't find that square."
            if sc["tiles"][y * cols + x] not in WALL_TILES + "DS":
                return "Only walls and doors can be broken."
            hp = sc.setdefault("hp", {})
            k = f"{x},{y}"
            if action == "break_set":
                n = num(data.get("hp"), 0, MAX_HP) or 0
                if n:
                    hp[k] = [n, n]
                else:
                    hp.pop(k, None)
                return None
            if k not in hp:
                return "That isn't breakable. Give it HP first."
            n = num(data.get("dmg"), -MAX_HP, MAX_HP) or 0
            hp[k][0] = max(0, min(hp[k][1], hp[k][0] - n))
            if hp[k][0] == 0:
                self._break(s, sc, x, y)
            return None
        if action in ("world_img", "world_open", "mark_add", "mark_edit", "mark_del", "mark_go"):   # the world map
            if not dm:
                return need_dm
            w = s["world"]
            if action == "world_img":
                if data.get("src"):
                    name, err = self._store_image(s, data["src"])
                    if err:
                        return err
                    w["img"] = name
                else:
                    w["img"] = None
                self._tidy_assets(s)
                return None
            if action == "world_open":
                w["open"] = bool(data.get("open"))
                return None
            if action == "mark_add":
                if len(w["marks"]) >= MAX_MARKS:
                    return f"The world map can have {MAX_MARKS} places."
                mx, my = num(data.get("x"), 0, 1, 4), num(data.get("y"), 0, 1, 4)
                if mx is None or my is None:
                    return "Couldn't put a place there."
                sid = str(data.get("sc") or "")
                m = {"id": new_id(), "x": mx, "y": my, "name": line(data.get("name"), 40) or "Somewhere",
                     "sc": sid if sid in s["scenes"] else None, "shown": bool(data.get("shown", True))}
                w["marks"][m["id"]] = m
                return None
            m = w["marks"].get(str(data.get("id", "")))
            if not m:
                return "That place isn't there any more."
            if action == "mark_del":
                del w["marks"][m["id"]]
                return None
            if action == "mark_go":
                sc = s["scenes"].get(m.get("sc") or "")
                if not sc:
                    return "That place doesn't lead to a scene yet."
                self._show_scene(s, sc)
                return None
            d = data.get("set") if isinstance(data.get("set"), dict) else {}
            if "name" in d:
                m["name"] = line(d["name"], 40) or m["name"]
            if "sc" in d:
                m["sc"] = str(d["sc"]) if str(d["sc"] or "") in s["scenes"] else None
            if "shown" in d:
                m["shown"] = bool(d["shown"])
            if "x" in d and "y" in d:
                mx, my = num(d["x"], 0, 1, 4), num(d["y"], 0, 1, 4)
                if mx is not None and my is not None:
                    m["x"], m["y"] = mx, my
            return None
        if action in ("board_add", "board_edit", "board_del", "board_move"):   # the handout board: anyone can use it
            board = s["board"]
            if action == "board_move":
                bx, by = num(data.get("x"), 0, 1, 4), num(data.get("y"), 0, 1, 4)
                if bx is None or by is None:
                    return None
                if data.get("item"):
                    it = s["items"].get(str(data["item"]))
                    if not it or not (dm or (it["given"] and it.get("pin"))):
                        return "That isn't on the board."
                    it["bx"], it["by"] = bx, by
                    return None
                n = board.get(str(data.get("id", "")))
                if not n:
                    return "That note isn't there any more."
                n["x"], n["y"] = bx, by
                return None
            if action == "board_add":
                if len(board) >= MAX_BOARD:
                    return f"The board holds {MAX_BOARD} notes. Take some down first."
                t = text(data.get("text"), 600).strip()
                if not t:
                    return "Write something first."
                n = {"id": new_id(), "text": t, "by": pid, "name": me,
                     "x": num(data.get("x"), 0, 1, 4) or 0.05, "y": num(data.get("y"), 0, 1, 4) or 0.05}
                board[n["id"]] = n
                return None
            n = board.get(str(data.get("id", "")))
            if not n:
                return "That note isn't there any more."
            if not dm and n["by"] != pid:
                return "Only whoever wrote it (or the DM) can change that."
            if action == "board_del":
                del board[n["id"]]
                return None
            t = text(data.get("text"), 600).strip()
            if t:
                n["text"] = t
            return None
        if action in ("tiles", "map_set", "spawn_set", "hwall", "prop_add", "prop_del", "prop_edit", "trap_fire", "prop_link", "link_go", "label_add", "label_edit",
                      "label_del"):
            if not dm:
                return need_dm
            sc = s["scenes"].get(str(data.get("sc", "")))
            if not sc:
                return "That scene isn't there any more."
            cols, rows = sc["cols"], sc["rows"]
            if action == "tiles":                     # [[x, y, tile, walls], ...]
                edits = data.get("edits")
                if not isinstance(edits, list) or len(edits) > cols * rows:
                    return "Couldn't read that."
                tiles, wl = list(sc["tiles"]), list(sc.get("wl") or "1" * (cols * rows))
                for e in edits:
                    if not isinstance(e, list) or len(e) not in (3, 4) or len(str(e[2])) != 1 or str(e[2]) not in TILES:
                        continue
                    x, y = num(e[0], -1, MAX_GRID), num(e[1], -1, MAX_GRID)
                    if x is not None and y is not None and 0 <= x < cols and 0 <= y < rows:
                        tiles[y * cols + x] = str(e[2])
                        wl[y * cols + x] = "0" if len(e) == 4 and not e[3] else "1"
                sc["tiles"], sc["wl"] = "".join(tiles), "".join(wl)
                self._auto_walls(sc)
                self._reveal(sc)
                return None
            if action == "map_set":                   # a whole new map (a random one, or Clear)
                if data.get("cols") is not None and data.get("rows") is not None:
                    nc, nr = num(data.get("cols"), 1, MAX_GRID), num(data.get("rows"), 1, MAX_GRID)
                    if nc is None or nr is None:
                        return "Couldn't read that map."
                    if (nc, nr) != (cols, rows):
                        self._resize(sc, nc, nr)
                        cols, rows = nc, nr
                tiles, wl = str(data.get("tiles", "")), str(data.get("wl") or "")
                if len(tiles) != cols * rows or any(c not in TILES for c in set(tiles)):
                    return "Couldn't read that map."
                if len(wl) != len(tiles) or set(wl) - {"0", "1"}:
                    wl = "1" * len(tiles)
                sc["tiles"], sc["wl"] = tiles, wl
                sc["props"] = {}
                props = data.get("props")
                for pr in (props if isinstance(props, list) else [])[:MAX_PROPS]:
                    if isinstance(pr, dict) and pr.get("k") in PROPS:
                        x, y = num(pr.get("x"), 0, cols - 1), num(pr.get("y"), 0, rows - 1)
                        if x is not None and y is not None:
                            pid_ = new_id()
                            sc["props"][pid_] = {"id": pid_, "k": pr["k"], "x": x, "y": y,
                                                 "r": num(pr.get("r"), 0, 3) or 0}
                if data.get("labels") is not None:
                    sc["labels"] = {}
                if sc["fog"]:                           # a new map starts with the fog back
                    sc["seen"] = "0" * (cols * rows)
                self._auto_walls(sc)
                if isinstance(data.get("locked"), list):     # a new map says which of its doors start locked
                    shut = {str(t) for t in data["locked"][:MAX_AUTO_WALLS]}
                    for w in sc["walls"].values():
                        if w.get("auto") and w.get("door"):
                            w["open"], w["locked"] = False, w.get("tile") in shut
                self._reveal(sc)
                return None
            if action == "hwall":                     # show or hide a stretch of hidden wall
                x, y = num(data.get("x"), 0, cols - 1), num(data.get("y"), 0, rows - 1)
                if x is None or y is None or not self._show_hwall(sc, [(x, y)], bool(data.get("show"))):
                    return "There's no hidden wall there."
                return None
            if action == "spawn_set":                 # the player spawn: an area, or none
                if data.get("clear"):
                    sc["spawn"] = None
                    return None
                x, y = num(data.get("x"), 0, cols - 1), num(data.get("y"), 0, rows - 1)
                if x is None or y is None:
                    return "Couldn't put the spawn there."
                w, h = num(data.get("w"), 1, cols - x) or 1, num(data.get("h"), 1, rows - y) or 1
                sc["spawn"] = {"x": x, "y": y, "w": w, "h": h}
                return None
            if action == "prop_add":
                k = data.get("k")
                x, y = num(data.get("x"), -1, MAX_GRID), num(data.get("y"), -1, MAX_GRID)
                if k not in PROPS or x is None or y is None or not (0 <= x < cols and 0 <= y < rows):
                    return "Couldn't put that there."
                if len(sc["props"]) >= MAX_PROPS:
                    return "This map has as many props as it can hold."
                pid_ = new_id()
                sc["props"][pid_] = {"id": pid_, "k": k, "x": x, "y": y, "r": num(data.get("r"), 0, 3) or 0,
                                     "hidden": bool(data.get("hidden"))}
                return None
            if action == "prop_edit":                 # turn it, hide or reveal it (the right-click menu)
                pr = sc["props"].get(str(data.get("id", "")))
                if not pr:
                    return "That isn't there any more."
                if "r" in data:
                    pr["r"] = num(data.get("r"), 0, 3) or 0
                for key in ("off", "found"):           # a trap disarmed, or found (players see it)
                    if key in data:
                        pr[key] = bool(data.get(key))
                if "hidden" in data:
                    self._set_hidden(sc, pr, data.get("hidden"))
                    self._triggers(s, sc)
                return None
            if action == "trap_fire":                 # the DM springs a trap: whoever is on it is told
                pr = sc["props"].get(str(data.get("id", "")))
                if not pr or pr["k"] != "trap":
                    return "That trap isn't there any more."
                on = [t for t in sc["tokens"].values() if self._pc(t) and self._touches(t, [(pr["x"], pr["y"])])]
                to = {self._owner_of(s, t) for t in on} - {None}
                to = [q for q in to if not self.is_dm(s, q)] or self._players_on(s, sc)
                msg = text(data.get("text"), 1000).strip() or "Click! You set off a trap."
                self._pop(s, "Trap!", msg, to=to)
                who = ", ".join(t["name"] for t in on) or "nobody on it"
                self._pop(s, "Trap sprung", f"{who}. {msg}", dm=True, sc=sc["id"], at=[pr["x"] + 0.5, pr["y"] + 0.5])
                pr["found"] = True
                return None
            if action == "prop_del":
                sc["props"].pop(str(data.get("id", "")), None)
                return None
            if action in ("prop_link", "link_go"):
                pr = sc["props"].get(str(data.get("id", "")))
                if not pr:
                    return "That isn't there any more."
                if action == "prop_link":              # where it leads, and whether players can walk onto it
                    to = str(data.get("to") or "")
                    pr["to"] = to if to in s["scenes"] and to != sc["id"] else None
                    pr["open"] = bool(data.get("open")) and bool(pr["to"])
                    return None
                target = s["scenes"].get(pr.get("to") or "")
                if not target:
                    return "That doesn't lead anywhere yet."
                for t in [t for t in sc["tokens"].values() if self._pc(t)]:
                    self._arrive(s, sc, t, target)
                s["active"] = target["id"]
                s["at"] = {}
                self._sys(s, f"The party moves to {target['name']}.")
                return None
            if action == "label_add":
                txt = line(data.get("text"), 40)
                x, y = num(data.get("x"), 0, MAX_GRID, 2), num(data.get("y"), 0, MAX_GRID, 2)
                if not txt or x is None or y is None:
                    return "Type the label first."
                if len(sc["labels"]) >= MAX_LABELS:
                    return "This map has as many labels as it can hold."
                lid = new_id()
                sc["labels"][lid] = {"id": lid, "text": txt, "x": x, "y": y, "dm": bool(data.get("dm"))}
                return None
            lb = sc["labels"].get(str(data.get("id", "")))
            if not lb:
                return None
            if action == "label_del":
                del sc["labels"][lb["id"]]
                return None
            if "text" in data:
                lb["text"] = line(data.get("text"), 40) or lb["text"]
            if "dm" in data:
                lb["dm"] = bool(data.get("dm"))
            return None

        # -- Walls and doors --
        if action in ("trig_add", "trig_edit", "trig_del", "trig_go"):
            if not dm:
                return need_dm
            sc = s["scenes"].get(str(data.get("sc", "")))
            if not sc:
                return "That scene isn't there any more."
            trigs = sc.setdefault("trig", {})
            if action == "trig_go":                   # the DM's call on an "ask me first" trigger
                tr = trigs.get(str(data.get("id", "")))
                if not tr or not tr.get("pending"):
                    return "That trigger isn't waiting on you."
                pend = tr["pending"]
                if data.get("skip"):
                    tr["pending"], tr["used"] = None, False
                    return None
                t = sc["tokens"].get(pend["tok"]) or {"id": pend["tok"], "name": pend.get("name") or "Someone",
                                                       "x": tr.get("x", 0), "y": tr.get("y", 0), "size": 1}
                if t["id"] not in sc["tokens"] and tr["do"] == "scene":
                    tr["pending"], tr["used"] = None, bool(tr.get("once"))
                    return "Their token isn't on this map any more."
                self._fire(s, sc, tr, t, pend["how"], force=True)
                return None
            if action == "trig_del":
                trigs.pop(str(data.get("id", "")), None)
                return None
            d = data.get("trig") if isinstance(data.get("trig"), dict) else {}
            if action == "trig_add":
                if len(trigs) >= MAX_TRIGS:
                    return f"A scene can have {MAX_TRIGS} triggers."
                tr = {"id": new_id(), "name": "Trigger", "when": "enter", "do": "tell", "who": "them", "once": True,
                      "used": False, "text": "", "to": None, "tok": None, "x": 0, "y": 0, "w": 1, "h": 1}
                if d.get("tok") in sc["tokens"]:
                    tr["tok"], tr["when"] = d["tok"], "see"
                else:
                    x, y = num(d.get("x"), 0, sc["cols"] - 1), num(d.get("y"), 0, sc["rows"] - 1)
                    if x is None or y is None:
                        return "Couldn't put a trigger there."
                    tr["x"], tr["y"] = x, y
                    tr["w"] = num(d.get("w"), 1, sc["cols"] - x) or 1
                    tr["h"] = num(d.get("h"), 1, sc["rows"] - y) or 1
            else:
                tr = trigs.get(str(data.get("id", "")))
                if not tr:
                    return "That trigger isn't there any more."
            tr["name"] = line(d.get("name"), 40) or tr["name"]
            if d.get("when") in TRIG_WHEN and (not tr.get("tok") or d["when"] in ("see", "use")):
                tr["when"] = d["when"]
            if d.get("do") in TRIG_DO:
                tr["do"] = d["do"]

            tr["who"] = "all" if d.get("who") == "all" else "them"
            if "once" in d:
                tr["once"] = bool(d["once"])
            if "text" in d:
                tr["text"] = text(d["text"], 1000)
            if "to" in d:
                tr["to"] = str(d["to"]) if d["to"] in s["scenes"] else None
            if "ask" in d:
                tr["ask"] = bool(d["ask"])
            if isinstance(d.get("items"), list):     # what a loot chest gives
                tr["items"] = [str(k) for k in d["items"][:MAX_ITEMS] if str(k) in s["items"]]
            if "tgt" in d:                         # somewhere else on the map for "reveal" and "open"
                g = d["tgt"] if isinstance(d["tgt"], dict) else None
                gx, gy = (num(g.get("x"), 0, sc["cols"] - 1), num(g.get("y"), 0, sc["rows"] - 1)) if g else (None, None)
                tr["tgt"] = None if gx is None or gy is None else {
                    "x": gx, "y": gy, "w": num(g.get("w"), 1, sc["cols"] - gx) or 1, "h": num(g.get("h"), 1, sc["rows"] - gy) or 1}
            if tr["do"] in ("reveal", "open") and tr.get("tok") and not tr.get("tgt"):
                tr["do"] = "tell"                      # a token trigger needs an area to work on
            if d.get("reset") or action == "trig_add":
                tr["used"], tr["seen"], tr["inside"], tr["pending"] = False, False, [], None
            if tr["when"] == "enter":            # tokens already standing in it don't set it off
                cells = self._trig_cells(sc, tr) or []
                tr["inside"] = sorted(t["id"] for t in sc["tokens"].values() if self._pc(t) and self._touches(t, cells))
            elif tr["when"] == "see":            # nor does something already in sight
                cells = self._trig_cells(sc, tr)
                walls = [w["p"] for w in sc["walls"].values() if not (w.get("door") and w.get("open"))]
                tr["seen"] = bool(cells) and any(self._sees(sc, t, cells, walls) for t in sc["tokens"].values()
                                                  if self._pc(t) and not t.get("hidden"))
            trigs[tr["id"]] = tr
            return None
        if action == "interact":                      # a player clicked a square or a token: "use" triggers there
            sc = self._scene_of(s, data, dm, pid)
            if dm or not sc:
                return None
            tok = sc["tokens"].get(str(data.get("tok") or ""))
            if tok and not self._seen_by_players(sc, tok):
                tok = None
            if tok:
                n = max(1, int(tok["size"]))
                cells = [(x, y) for y in range(int(tok["y"]), int(tok["y"]) + n) for x in range(int(tok["x"]), int(tok["x"]) + n)]
            else:
                x, y = num(data.get("x"), -1, MAX_GRID), num(data.get("y"), -1, MAX_GRID)
                if x is None or y is None or not (0 <= x < sc["cols"] and 0 <= y < sc["rows"]):
                    return None
                cells = [(x, y)]
            mine = [t for t in sc["tokens"].values() if self._controls(s, pid, t) and not t.get("hidden") and t is not tok]

            def next_to(t):                           # on it, or one square away (diagonals count)
                n = max(1, int(t["size"]))
                x0, y0 = int(t["x"] + 0.001), int(t["y"] + 0.001)
                return any(x0 - 1 <= cx <= x0 + n and y0 - 1 <= cy <= y0 + n for cx, cy in cells)
            user = next((t for t in mine if next_to(t)), None)
            if not user:
                return None
            for tr in list(sc.get("trig", {}).values()):
                if tr["when"] != "use" or tr.get("used"):
                    continue
                if tok:
                    hit = tr.get("tok") == tok["id"]
                else:
                    hit = not tr.get("tok") and tr["x"] <= x < tr["x"] + tr["w"] and tr["y"] <= y < tr["y"] + tr["h"]
                if hit:
                    self._fire(s, sc, tr, user, "use")
            return None
        if action == "door":
            sc = self._scene_of(s, data, dm, pid)
            w = sc["walls"].get(str(data.get("id", ""))) if sc else None
            if not w or not w.get("door") or (w.get("secret") and not dm):
                return "That door isn't there any more."
            if not dm and not self._door_seen(sc, w):
                return "You can't see that door."
            if w.get("locked") and not dm:             # players only learn it's a lock if the DM shows it
                key = s["items"].get(w.get("key") or "")
                if key and key.get("given"):          # the party has the key: it unlocks
                    w["locked"] = False
                    self._pop(s, key["name"], f'{me} unlocks the door with the {key["name"]}.', to=self._players_on(s, sc))
                else:
                    return "It's locked." if w.get("showlock") else "It won't open."
            w["open"] = not w.get("open")
            self._reveal(sc)
            self._triggers(s, sc)
            return None
        if action in ("wall_add", "wall_del", "walls_clear", "door_lock", "door_showlock", "door_key"):
            if not dm:
                return need_dm
            sc = s["scenes"].get(str(data.get("sc", "")))
            if not sc:
                return "That scene isn't there any more."
            if action == "walls_clear":
                sc["walls"] = {k: w for k, w in sc["walls"].items() if w.get("auto")}
                self._reveal(sc)
                return None
            if action in ("wall_del", "door_lock", "door_showlock", "door_key"):
                w = sc["walls"].get(str(data.get("id", "")))
                if w and action == "door_key" and w.get("door"):          # which of the party's keys opens it
                    k = str(data.get("key") or "")
                    w["key"] = k if k in s["items"] else None
                    if w["key"]:
                        w["locked"] = True
                elif w and action == "door_showlock" and w.get("door"):     # let players see the padlock, or not
                    w["showlock"] = not w.get("showlock")
                elif w and action == "wall_del" and not w.get("auto"):
                    del sc["walls"][w["id"]]
                    self._reveal(sc)
                elif w and w.get("door"):
                    w["locked"] = not w.get("locked")
                return None
            p = data.get("p")
            if not isinstance(p, list) or len(p) < 4 or len(p) % 2 or len(p) > 400:
                return "Couldn't draw that wall."
            pts = [num(v, 0, MAX_GRID, 1) for v in p]
            if any(v is None for v in pts):
                return "Couldn't draw that wall."
            door = bool(data.get("door"))
            for i in range(0, len(pts) - 2, 2):
                seg = pts[i:i + 4]
                if seg[:2] == seg[2:] or sum(not x.get("auto") for x in sc["walls"].values()) >= MAX_WALLS:
                    continue
                wid = new_id()
                sc["walls"][wid] = {"id": wid, "p": seg, "door": door, "open": False}
                if door:
                    break                              # a door is one piece
            self._reveal(sc)
            return None

        # -- Drawings on the map --
        if action == "line_add":
            sc = self._scene_of(s, data, dm, pid)
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
            sc = self._scene_of(s, data, dm, pid)
            ln = sc["lines"].get(str(data.get("id", ""))) if sc else None
            if not ln:
                return None
            if ln["by"] != pid and not dm:
                return "You can only rub out your own drawings."
            del sc["lines"][ln["id"]]
            return None
        if action == "lines_clear":
            sc = self._scene_of(s, data, dm, pid)
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
        if action == "char_rest":
            ch = s["chars"].get(str(data.get("id", "")))
            if not ch:
                return "That character isn't there any more."
            if ch["owner"] != pid and not dm:
                return "That's someone else's character."
            if data.get("long"):
                ch.update(hp=ch["mhp"], thp=0, ds=[0, 0])
                ch["slots"] = [[mx, 0] for mx, _ in ch.get("slots", [[0, 0]] * 9)]
                self._sys(s, f"{ch['name']} takes a long rest: HP and spell slots are back.")
                return None
            expr = line(data.get("expr"), 40)
            if not expr:
                self._sys(s, f"{ch['name']} takes a short rest.")
                return None
            res, err = roll_dice(expr)
            if err:
                return err
            heal = max(0, res["total"])
            ch["hp"] = min(ch["mhp"], max(ch["hp"], 0) + heal) if ch["mhp"] else ch["hp"] + heal
            self._log(s, {"kind": "roll", "by": pid, "who": ch["name"], "text": "Short rest: hit dice healing",
                          "roll": res, "to": None})
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
                sc = self._scene_of(s, data, dm, pid)
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
                cur = next((x for x in init["list"] if x["id"] == init["cur"]), None)
                t = None
                if cur and cur.get("tok"):
                    t = s["scenes"].get(cur.get("sc"), {}).get("tokens", {}).get(cur["tok"])
                mine = cur and (cur["by"] == pid and not cur.get("tok") or (t and self._controls(s, pid, t)))
                if action != "init_next" or not mine:
                    return need_dm
                self._sys(s, f"{cur['name']} ends their turn.")
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

        # -- The party's things: items, keys and handouts --
        if action in ("item_add", "item_edit", "item_img", "item_del"):
            if not dm:
                return need_dm
            items = s["items"]
            if action == "item_add":
                if len(items) >= MAX_ITEMS:
                    return f"The party can have {MAX_ITEMS} things. Delete some first."
                d = data.get("item") if isinstance(data.get("item"), dict) else {}
                it = {"id": new_id(), "name": line(d.get("name"), 40) or "Something", "text": text(d.get("text"), 4000),
                      "kind": d.get("kind") if d.get("kind") in ITEM_KINDS else "item", "img": None, "given": False}
                if d.get("src"):
                    it["img"], err = self._store_image(s, d["src"])
                    if err:
                        return err
                items[it["id"]] = it
                return None
            it = items.get(str(data.get("id", "")))
            if not it:
                return "That isn't there any more."
            if action == "item_del":
                del items[it["id"]]
                for sc in s["scenes"].values():
                    for w in sc["walls"].values():
                        if w.get("key") == it["id"]:
                            w["key"] = None
                self._tidy_assets(s)
                return None
            if action == "item_img":
                if data.get("src"):
                    name, err = self._store_image(s, data["src"])
                    if err:
                        return err
                    it["img"] = name
                else:
                    it["img"] = None
                self._tidy_assets(s)
                return None
            d = data.get("set") if isinstance(data.get("set"), dict) else {}
            if "name" in d:
                it["name"] = line(d["name"], 40) or it["name"]
            if "text" in d:
                it["text"] = text(d["text"], 4000)
            if d.get("kind") in ITEM_KINDS:
                it["kind"] = d["kind"]
            if "pin" in d:
                it["pin"] = bool(d["pin"])
            if "given" in d:
                was, it["given"] = it["given"], bool(d["given"])
                if it["given"] and not was and "pin" not in it and (it["kind"] == "handout" or it.get("img")):
                    it["pin"] = True                    # handouts and pictures go up on the board
                if it["given"] and not was:            # everyone is told what the party got
                    who = [q for q in s["names"] if not self.is_dm(s, q)]
                    self._pop(s, "The party got something", f'{it["name"]}. It\'s in the Items tab.', to=who)
            return None

        # -- DM notes and handouts --
        if action == "note_add":
            if not dm:
                return need_dm
            if len(s["notes"]) >= MAX_NOTES:
                return f"A campaign can have {MAX_NOTES} notes."
            n = {"id": new_id(), "title": line(data.get("title"), 60) or "New note", "text": "", "shared": False}
            s["notes"][n["id"]] = n
            return None
        if action in ("note_img", "note_show"):
            if not dm:
                return need_dm
            n = s["notes"].get(str(data.get("id", "")))
            if not n:
                return "That note isn't there any more."
            if action == "note_img":
                if data.get("src"):
                    name, err = self._store_image(s, data.get("src"))
                    if err:
                        return err
                    n["img"] = name
                else:
                    n["img"] = None
                self._tidy_assets(s)
                return None
            n["shared"] = True
            self._log(s, {"kind": "show", "note": n["id"], "text": n["title"], "to": None})
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
        if data.get("as") is not None:
            if not dm or not isinstance(data["as"], str) or data["as"] not in s["fakes"]:
                return None
            pid, dm = data["as"], False
        if not dm and sc["id"] != self._where(s, pid):
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
        if dm:                                         # breakable squares' HP: never sent to players
            out["hp"] = sc.get("hp", {})
        toks = []
        for t in sc["tokens"].values():
            if not dm and not self._seen_by_players(sc, t):
                continue
            hp, mhp, ac = self._hp_of(s, t)
            v = {**t, "hp": hp, "mhp": mhp, "ac": ac}
            if not dm:
                v.pop("stats", None)
            if not dm and not self._pc(t) and not t.get("showhp"):
                # players see how hurt a monster looks, not its numbers
                v["hp"] = v["mhp"] = v["ac"] = v["init"] = None
                v["note"] = ""
                if hp is not None and mhp:
                    v["look"] = "down" if hp <= 0 else "bloodied" if hp <= mhp / 2 else "hurt" if hp < mhp else "fine"
            toks.append(v)
        out["tokens"] = toks
        out["lines"] = list(sc["lines"].values())
        out["auto"] = sc.get("auto", False)
        out["block"] = sc.get("block", True)
        if dm:
            out["trig"] = list(sc.get("trig", {}).values())
            out["spawn"] = sc.get("spawn")
        tiles, seen, cols = sc.get("tiles", ""), sc["seen"], sc["cols"]

        def clear(x, y):
            return dm or not sc["fog"] or seen[int(y) * cols + int(x)] == "1"
        if not dm and "S" in tiles:                     # secret doors look like wall
            tiles = tiles.replace("S", ".")
        if not dm and ("h" in tiles or "H" in tiles):   # a hidden wall looks like the floor beside it; a shown one is wall
            T = list(tiles.replace("H", "w"))
            for i, t in enumerate(T):
                if t == "h":
                    x, y = i % cols, i // cols
                    near = [T[yy * cols + xx] for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                            if 0 <= xx < cols and 0 <= yy < sc["rows"]]
                    T[i] = next((n for n in near if n in "fogd"), "f")
            tiles = "".join(T)
        if not dm and sc["fog"] and tiles.strip("."):
            tiles = "".join(t if seen[i] == "1" else "?" for i, t in enumerate(tiles))
        out["tiles"] = tiles
        out["wl"] = sc.get("wl") or "1" * len(tiles)
        if dm:
            out["props"] = list(sc.get("props", {}).values())
        else:                                          # players don't get traps, or where stairs go unless they may use them
            out["props"] = []
            for pr in sc.get("props", {}).values():
                if (pr["k"] in DM_PROPS and not pr.get("found")) or pr.get("hidden") or not clear(pr["x"], pr["y"]):
                    continue
                out["props"].append({k: pr[k] for k in ("id", "k", "x", "y", "r")}   # never where stairs lead: that's the DM's
                                    | ({"off": True} if pr.get("off") else {}))
        def label_seen(lb):                           # the whole label, end to end, has been seen (not just its middle)
            half = len(lb["text"]) * 0.16
            y = max(0, min(lb["y"], sc["rows"] - 1))
            return all(clear(max(0, min(x, cols - 1)), y) for x in (lb["x"] - half, lb["x"], lb["x"] + half))
        out["labels"] = [lb for lb in sc.get("labels", {}).values() if dm or (not lb["dm"] and label_seen(lb))]
        if dm:
            out["walls"] = list(sc["walls"].values())
        else:
            out["walls"] = [{"id": w["id"], "p": w["p"], "door": True, "open": w.get("open", False),
                              **({"locked": True} if w.get("locked") and w.get("showlock") else {})}
                             for w in sc["walls"].values()
                             if w.get("door") and not w.get("secret") and self._door_seen(sc, w)]
        return out

    def _world_view(self, s, dm):
        w = s.get("world") or {}
        if dm:
            return {"img": w.get("img"), "open": bool(w.get("open")), "marks": list(w.get("marks", {}).values())}
        if not w.get("open"):
            return None
        here = s["active"]
        return {"img": w.get("img"), "open": True,
                "marks": [{"id": m["id"], "x": m["x"], "y": m["y"], "name": m["name"], "here": m.get("sc") == here}
                          for m in w.get("marks", {}).values() if m.get("shown")]}

    def _show_scene(self, s, sc):
        """Everyone goes to this scene; with a spawn there, the party's tokens go too."""
        was = {s["active"]} | {self._where(s, q) for q in s["names"] if not self.is_dm(s, q)}
        if sc.get("spawn"):
            for old in [s["scenes"][i] for i in was if i in s["scenes"] and i != sc["id"]]:
                for t in [t for t in old["tokens"].values() if self._pc(t)]:
                    q = self._owner_of(s, t)
                    if q and not self.is_dm(s, q):
                        self._arrive(s, old, t, sc)
        s["active"] = sc["id"]
        s["at"] = {}                                    # everyone, wherever they wandered off to
        self._sys(s, f"The party moves to {sc['name']}.")

    def _break(self, s, sc, x, y):
        """A breakable square hit 0 HP: it's floor now, with rubble on it."""
        cols, rows = sc["cols"], sc["rows"]
        T = list(sc["tiles"])
        i = y * cols + x
        near = [T[yy * cols + xx] for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                if 0 <= xx < cols and 0 <= yy < rows]
        was = T[i]
        T[i] = "o" if "o" in near else next((n for n in near if n in "fogd"), "f")
        sc["tiles"] = "".join(T)
        sc.setdefault("hp", {}).pop(f"{x},{y}", None)
        if len(sc.get("props", {})) < MAX_PROPS:
            pid_ = new_id()
            sc.setdefault("props", {})[pid_] = {"id": pid_, "k": "rubble", "x": x, "y": y, "r": 0}
        self._auto_walls(sc)
        self._reveal(sc)
        what = "door" if was in "DS" else "wall"
        who = [q for q in s["names"] if not self.is_dm(s, q) and self._where(s, q) == sc["id"]]
        self._pop(s, "Crash!", f"The {what} gives way.", to=who, sc=sc["id"], at=[x, y])

    def _viewable(self, room):
        """Everyone a DM can view as: players here now, and ones who've been (and pretend ones)."""
        s = room.state
        names = {**s["names"], **{q: p["name"] for q, p in room.players.items()}}
        return {q: n for q, n in names.items() if not self.is_dm(s, q)}

    def view(self, room, pid):
        s = room.state
        if not self.is_dm(s, pid):
            return self._view(room, pid)
        fake = s.get("playas", {}).get(pid)
        if fake in s["fakes"]:                      # a DM playing as a pretend player sees just what they would
            out = self._view(room, fake)
            out.update(playAs=fake, fakes=s["fakes"], realDm=True,
                       viewable=self._viewable(room))
            return out
        if fake and fake in self._viewable(room):        # looking through a real player's eyes: look only
            out = self._view(room, fake)
            out.update(playAs=fake, look=True, fakes=s["fakes"], realDm=True,
                       viewable=self._viewable(room))
            return out
        out = self._view(room, pid)
        out["fakes"] = s["fakes"]
        out["viewable"] = self._viewable(room)   # who the DM can view as
        return out

    def _view(self, room, pid):
        s = room.state
        dm = self.is_dm(s, pid)
        names = dict(s["names"])
        for q, p in room.players.items():
            names[q] = p["name"]
        if dm:
            scenes = [self._scene_view(s, s["scenes"][i], True) for i in s["order"]]
        else:
            scenes = [self._scene_view(s, s["scenes"][self._where(s, pid)], False)]
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
            "scenes": scenes, "active": s["active"] if dm else self._where(s, pid),
            "at": {q: self._where(s, q) for q in s["names"] if not self.is_dm(s, q)} if dm else {},
            "chars": list(s["chars"].values()),
            "notes": [n for n in s["notes"].values() if dm or n["shared"]],
            "mine": s["mine"].get(pid, ""),
            "log": log,
            "init": {"list": [{**{k: e[k] for k in ("id", "name", "val", "tok", "sc", "by", "pc")}, "hidden": unseen(e)} for e in order],
                     "cur": cur, "round": init["round"]},
            "settings": s["settings"],
            "lib": list(s.get("lib", {}).values()) if dm else [],
            "enc": s.get("enc") if dm else None,
            "items": [i for i in s.get("items", {}).values() if dm or i["given"]],
            "world": self._world_view(s, dm),
            "board": list(s.get("board", {}).values()),
            "pops": [p for p in s.get("pops", []) if (p["dm"] if dm else pid in p["to"])][-10:],
            "conditions": list(CONDITIONS), "skills": SKILLS,
            "limits": {"image": MAX_IMAGE_CHARS, "grid": MAX_GRID, "linePts": MAX_LINE_PTS},
        }
