"""Haunted Mansion rules for live rooms. An original ACE Clan game.

Everyone explores an old house together, one room tile at a time, finding items, odd events and
cursed relics. Each relic makes the Haunting more likely; it also starts once half the house is
explored. When it starts, the server secretly picks one player as the traitor and tells only
them. Everyone else must carry relics to the Chapel and perform three rites before the Doom
track fills. The traitor wins if the Doom track fills or every other explorer falls.

The traitor stays hidden: their curses land at the end of the round, mixed in with the house's
own attacks, and their rites always fail. Explorers can accuse someone (once each); a right
accusation unmasks the traitor, a wrong one costs the accuser their nerve.

The server keeps the traitor's identity, the curses they've laid and the room and card decks to
itself; each player's view only says whether *they* are the traitor.
"""
import random

from .base import SeatedGame

W, H = 9, 9
START = (4, 8)
N, E, S, WEST = 1, 2, 4, 8
DIRS = {"N": (N, 0, -1), "E": (E, 1, 0), "S": (S, 0, 1), "W": (WEST, -1, 0)}
OPP = {N: S, S: N, E: WEST, WEST: E}
MAX_STAT = 8
RITES_NEEDED = 3

ROOMS = [
    # name, doors, symbol
    ("Library", "NSW", "item"), ("Conservatory", "NE", "event"), ("Ballroom", "NESW", "event"),
    ("Kitchen", "NES", "item"), ("Dining Hall", "NESW", "relic"), ("Portrait Gallery", "NS", "event"),
    ("Nursery", "N", "relic"), ("Study", "NE", "relic"), ("Servants' Stair", "NS", None),
    ("Music Room", "NEW", "event"), ("Trophy Room", "NW", "item"), ("Laundry", "NS", "event"),
    ("Wine Cellar", "N", "item"), ("Observatory", "NE", "relic"), ("Greenhouse", "NESW", "event"),
    ("Long Corridor", "NS", None), ("Crossing Hall", "NESW", None), ("Sewing Room", "N", "relic"),
    ("Boiler Room", "NES", "event"), ("Armoury", "NW", "item"), ("Attic Loft", "NE", "event"),
    ("Bathroom", "N", "event"), ("Linen Closet", "N", "item"), ("Burnt Parlour", "NSW", "relic"),
]
CHAPEL = ("Chapel", "NESW", "chapel")

ITEMS = {
    "Lantern": "+1 move every turn.",
    "Bandages": "Use: heal 2 Body (once).",
    "Smelling Salts": "Use: recover 2 Mind (once).",
    "Lucky Coin": "+1 on every test you roll.",
    "Silver Bell": "+2 on rite rolls.",
    "Crowbar": "+1 when you fight.",
}
RELICS = ["Cracked Locket", "Bone Flute", "Black Candle", "Weeping Doll", "Rusted Crown", "Moth-Eaten Tarot"]

# Events: (title, text, stat to test or None, target, effect on pass, effect on fail)
# Effects are (stat, change) or special words.
EVENTS = [
    ("Whispering Walls", "Voices murmur your name from inside the plaster.", "mind", 8, ("mind", 1), ("mind", -1)),
    ("Rotten Floorboards", "The floor sags and cracks under your feet.", "body", 8, None, ("body", -1)),
    ("The Portrait Blinks", "A painted face follows you across the room.", "mind", 7, None, ("mind", -1)),
    ("Dusty Trunk", "A heavy trunk, its lid stuck fast.", "body", 7, "item", ("body", -1)),
    ("A Music Box Plays", "A tune you almost remember winds up by itself.", "mind", 9, ("mind", 1), ("mind", -1)),
    ("Rats in the Walls", "Something skitters, then something bites.", "body", 7, None, ("body", -1)),
    ("Your Reflection Lags", "In the mirror, you move a heartbeat late.", "mind", 8, ("body", 1), ("mind", -2)),
    ("Medicine Cabinet", "Old bottles, a few still sealed.", None, 0, ("body", 1), None),
    ("Lights Out", "Every candle dies at once.", "mind", 7, None, ("mind", -1)),
    ("Hidden Passage", "A panel swings open onto a dark passage.", None, 0, "passage", None),
    ("The Door Slams", "A door bangs shut on your hand.", "body", 8, None, ("body", -1)),
    ("Warm Hearth", "A fire burns in a grate nobody lit. It feels safe.", None, 0, ("mind", 1), None),
]


def rot(d):
    return ((d << 1) | (d >> 3)) & 15


def doors_of(spec):
    return sum(DIRS[c][0] for c in spec)


class Mansion(SeatedGame):
    id = "mansion"
    name = "Haunted Mansion"
    min_players = 3
    max_players = 6
    lobby_text = "Take a seat (3 to 6 players), then the leader opens the front door."
    options = {
        "doom": [("10", "Doom track: 10 rounds"), ("14", "Doom track: 14 rounds (easier)"),
                 ("8", "Doom track: 8 rounds (harder)")],
    }

    # ---- Set-up ------------------------------------------------------------------------------
    def begin(self, room, s):
        n = len(s["seats"])
        deck = [{"name": nm, "doors": doors_of(d), "symbol": sym} for nm, d, sym in ROOMS + [CHAPEL]]
        random.shuffle(deck)
        events = list(range(len(EVENTS)))
        random.shuffle(events)
        items = list(ITEMS)
        random.shuffle(items)
        relics = list(RELICS)
        random.shuffle(relics)
        s.update({
            "tiles": {f"{START[0]},{START[1]}": {"name": "Entrance Hall", "doors": N | E | WEST, "symbol": None, "done": True}},
            "deck": deck, "events": events, "items": items, "relics": relics, "total_tiles": len(deck),
            "pos": [list(START) for _ in range(n)], "body": [4] * n, "mind": [4] * n, "gear": [[] for _ in range(n)],
            "carried": [[] for _ in range(n)], "fallen": [False] * n,
            "turn": 0, "round": 1, "moves": 0, "used": {}, "haunt": False, "traitor": None, "revealed": False,
            "rites": 0, "doom": 0, "doom_limit": int(s["options"]["doom"]), "relics_found": 0,
            "accused": [False] * n, "curses": [], "last_roll": None,
        })
        self._start_turn(room, s, 0)
        self._log(s, "The front door creaks shut behind you. Explore the house together.", "go")
        return None

    # ---- Helpers -----------------------------------------------------------------------------
    def tile(self, s, x, y):
        return s["tiles"].get(f"{x},{y}")

    def room_of(self, s, i):
        return self.tile(s, *s["pos"][i])

    def same_room(self, s, a, b):
        return s["pos"][a] == s["pos"][b]

    def has(self, s, i, item):
        return item in s["gear"][i]

    def roll(self, n=2):
        return [random.randint(1, 6) for _ in range(n)]

    def test(self, room, s, i, stat, target, bonus=0, label=""):
        dice = self.roll()
        luck = 1 if self.has(s, i, "Lucky Coin") else 0
        total = sum(dice) + s[stat][i] + bonus + luck
        ok = total >= target
        s["last_roll"] = {"seat": i, "dice": dice, "total": total, "target": target, "ok": ok, "label": label}
        return ok, dice, total

    def change(self, room, s, i, stat, amount, quiet=False):
        before = s[stat][i]
        s[stat][i] = max(0, min(MAX_STAT, before + amount))
        if s[stat][i] == 0 and not s["fallen"][i]:
            s["fallen"][i] = True
            self._log(s, f"{self.seat_name(room, s, i)} has fallen and can't go on.", "bad")
        return s[stat][i] - before

    def moves_for(self, s, i):
        return 3 + (1 if self.has(s, i, "Lantern") else 0)

    def _start_turn(self, room, s, i):
        s["turn"] = i
        s["moves"] = self.moves_for(s, i)
        s["used"] = {}

    def _end_turn(self, room, s):
        n = len(s["seats"])
        i = s["turn"]
        for _ in range(n):
            i = (i + 1) % n
            if i == 0:
                self._round_end(room, s)
                if s["over"]:
                    return
            if not s["fallen"][i]:
                self._start_turn(room, s, i)
                return
        self._check_end(room, s)

    def _round_end(self, room, s):
        s["round"] += 1
        if not s["haunt"]:
            return
        # Curses laid this round land now, mixed in with the house's own malice.
        hits = list(s["curses"])
        s["curses"] = []
        heroes = [i for i in range(len(s["seats"])) if i != s["traitor"] and not s["fallen"][i]]
        if heroes and random.random() < 0.4:
            hits.append((random.choice(heroes), random.choice(["body", "mind"])))
        random.shuffle(hits)
        for target, stat in hits:
            if s["fallen"][target]:
                continue
            self.change(room, s, target, stat, -1)
            self._log(s, f"The house lashes out: {self.seat_name(room, s, target)} loses 1 {stat.capitalize()}.", "bad")
        s["doom"] += 1
        self._log(s, f"The house grows darker. Doom {s['doom']} of {s['doom_limit']}.", "bad")
        self._check_end(room, s)

    def _check_end(self, room, s):
        if s["over"]:
            return
        n = len(s["seats"])
        t = s["traitor"]
        if not s["haunt"]:
            if all(s["fallen"]):
                self.finish(s, None, "Everyone has fallen. The house keeps you all.", "bad")
            return
        name = self.seat_name(room, s, t)
        if s["fallen"][t]:
            s["revealed"] = True
            self.finish(s, "heroes", f"The traitor {name} has fallen. The explorers escape the house!")
        elif s["rites"] >= RITES_NEEDED:
            s["revealed"] = True
            self.finish(s, "heroes", f"The third rite is done and the house falls silent. The explorers win! "
                                     f"The traitor was {name}.")
        elif all(s["fallen"][i] for i in range(n) if i != t):
            s["revealed"] = True
            self.finish(s, "traitor", f"Every explorer has fallen. The traitor {name} wins!", "bad")
        elif s["doom"] >= s["doom_limit"]:
            s["revealed"] = True
            self.finish(s, "traitor", f"The Doom track is full and the house swallows everyone. "
                                      f"The traitor {name} wins!", "bad")

    # ---- Exploring -----------------------------------------------------------------------------
    def _place(self, s, x, y, came_from_door, card):
        """Rotate a new room so it has a door back the way you came, preferring rotations
        whose other doors lead somewhere usable."""
        need = OPP[came_from_door]
        best, best_score = [], -1
        d = card["doors"]
        for _ in range(4):
            if d & need:
                score = 0
                for k, (bit, dx, dy) in DIRS.items():
                    if d & bit and bit != need:
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < W and 0 <= ny < H:
                            other = self.tile(s, nx, ny)
                            score += 1 if other is None or other["doors"] & OPP[bit] else 0
                if score > best_score:
                    best, best_score = [d], score
                elif score == best_score:
                    best.append(d)
            d = rot(d)
        s["tiles"][f"{x},{y}"] = {"name": card["name"], "doors": random.choice(best), "symbol": card["symbol"],
                                  "done": card["symbol"] in (None, "chapel")}

    def _open_spots(self, s):
        """Empty squares next to a placed room's door, for placing the Chapel when needed."""
        spots = []
        for key, t in s["tiles"].items():
            x, y = map(int, key.split(","))
            for k, (bit, dx, dy) in DIRS.items():
                nx, ny = x + dx, y + dy
                if t["doors"] & bit and 0 <= nx < W and 0 <= ny < H and not self.tile(s, nx, ny):
                    spots.append((nx, ny, bit))
        return spots

    def _keep_open(self, room, s):
        """If every doorway has been explored but rooms are left to find, the house opens a hidden
        door in a wall next to an empty square, so nobody gets shut in."""
        if not s["deck"] or self._open_spots(s):
            return
        options = []
        for key, t in s["tiles"].items():
            x, y = map(int, key.split(","))
            for bit, dx, dy in DIRS.values():
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and not self.tile(s, nx, ny):
                    options.append((t, bit))
        if options:
            t, bit = random.choice(options)
            t["doors"] |= bit
            self._log(s, f"With a groan, a hidden door opens in the {t['name']}.", "go")

    def _resolve(self, room, s, i, t):
        name = self.seat_name(room, s, i)
        sym = t["symbol"]
        t["done"] = True
        if sym == "item":
            self._give_item(room, s, i)
        elif sym == "relic":
            if not s["relics"]:
                self._log(s, f"{name} finds only an empty display case.")
                return
            relic = s["relics"].pop()
            s["carried"][i].append(relic)
            s["relics_found"] += 1
            self._log(s, f"{name} finds a relic: the {relic}. It's cold to the touch.", "go")
            if not s["haunt"]:
                dice = self.roll()
                total = sum(dice)
                need = s["relics_found"] * 2
                s["last_roll"] = {"seat": i, "dice": dice, "total": total, "target": need, "ok": total > need,
                                  "label": "Haunting roll"}
                self._log(s, f"Haunting roll: {dice[0]} + {dice[1]} = {total} (the Haunting starts on {need} or less).")
                if total <= need or s["relics_found"] >= 5:
                    self._start_haunt(room, s, "a relic wakes the house")
        elif sym == "event":
            self._event(room, s, i)

    def _give_item(self, room, s, i):
        name = self.seat_name(room, s, i)
        if not s["items"]:
            self._log(s, f"{name} searches the room but finds nothing useful.")
            return
        item = s["items"].pop()
        s["gear"][i].append(item)
        self._log(s, f"{name} finds the {item}. {ITEMS[item]}", "good")

    def _event(self, room, s, i):
        if not s["events"]:
            s["events"] = list(range(len(EVENTS)))
            random.shuffle(s["events"])
        title, text, stat, target, good, bad = EVENTS[s["events"].pop()]
        name = self.seat_name(room, s, i)
        if stat:
            ok, dice, total = self.test(room, s, i, stat, target, label=title)
            self._log(s, f"{title}: {text} {name} tests {stat.capitalize()}: {dice[0]} + {dice[1]} + "
                         f"{total - sum(dice)} = {total} vs {target}, {'passed' if ok else 'failed'}.", "good" if ok else "bad")
            effect = good if ok else bad
        else:
            self._log(s, f"{title}: {text}")
            effect = good
        if effect == "item":
            self._give_item(room, s, i)
        elif effect == "passage":
            spots = [list(map(int, k.split(","))) for k in s["tiles"] if [int(v) for v in k.split(",")] != s["pos"][i]]
            if spots:
                s["pos"][i] = random.choice(spots)
                self._log(s, f"{name} follows it to the {self.room_of(s, i)['name']}.")
        elif effect:
            stat2, amount = effect
            got = self.change(room, s, i, stat2, amount)
            if got:
                self._log(s, f"{name} {'gains' if got > 0 else 'loses'} {abs(got)} {stat2.capitalize()}.",
                          "good" if got > 0 else "bad")
        self._check_end(room, s)

    def _start_haunt(self, room, s, why):
        s["haunt"] = True
        living = [k for k in range(len(s["seats"])) if not s["fallen"][k]]
        s["traitor"] = random.choice(living)
        if not any(t["name"] == "Chapel" for t in s["tiles"].values()):
            chapel = next((c for c in s["deck"] if c["name"] == "Chapel"), None)
            spots = self._open_spots(s)
            if chapel and spots:
                s["deck"].remove(chapel)
                x, y, bit = random.choice(spots)
                self._place(s, x, y, bit, chapel)
                self._log(s, "Somewhere in the house, a chapel bell begins to toll. A new room has appeared.", "go")
        self._log(s, f"THE HAUNTING BEGINS ({why}). One of you now serves the house, and only they know it.", "bad")
        self._log(s, f"Explorers: take relics to the Chapel and perform {RITES_NEEDED} rites before Doom reaches "
                     f"{s['doom_limit']}.", "go")

    # ---- Actions -------------------------------------------------------------------------------
    def play(self, room, s, seat, action, data):
        if seat != s["turn"]:
            return f"It's {self.seat_name(room, s, s['turn'])}'s turn."
        name = self.seat_name(room, s, seat)
        x, y = s["pos"][seat]
        here = self.room_of(s, seat)
        if s["fallen"][seat] and action != "end_turn":
            return "You've fallen. All you can do is end your turn."

        if action == "move":
            d = DIRS.get(str(data.get("dir", "")))
            if not d:
                return "Pick a direction."
            bit, dx, dy = d
            if s["moves"] <= 0:
                return "You've no moves left this turn."
            if not here["doors"] & bit:
                return "There's no door that way."
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H):
                return "That door is boarded up from outside."
            nxt = self.tile(s, nx, ny)
            if nxt:
                if not nxt["doors"] & OPP[bit]:
                    return "The wall on the other side is solid."
                s["pos"][seat] = [nx, ny]
                s["moves"] -= 1
                return None
            if not s["deck"]:
                return "There are no rooms left to find."
            if s["used"].get("explore"):
                return "You've already found a new room this turn."
            card = s["deck"].pop()
            self._place(s, nx, ny, bit, card)
            s["pos"][seat] = [nx, ny]
            s["moves"] = 0
            s["used"]["explore"] = True
            t = self.tile(s, nx, ny)
            self._log(s, f"{name} opens a door into the {t['name']}.")
            self._resolve(room, s, seat, t)
            placed = len(s["tiles"]) - 1
            if not s["haunt"] and not s["over"] and placed >= s["total_tiles"] // 2:
                self._start_haunt(room, s, "half the house is explored")
            self._keep_open(room, s)
            return None

        if action == "use":
            item = str(data.get("item", ""))
            if item not in s["gear"][seat]:
                return "You don't have that."
            if item == "Bandages":
                got = self.change(room, s, seat, "body", 2)
                self._log(s, f"{name} uses the Bandages (+{got} Body).", "good")
            elif item == "Smelling Salts":
                got = self.change(room, s, seat, "mind", 2)
                self._log(s, f"{name} uses the Smelling Salts (+{got} Mind).", "good")
            else:
                return f"The {item} works by itself; there's nothing to use."
            s["gear"][seat].remove(item)
            return None

        if action == "give":
            target = self._target(s, data)
            what = str(data.get("item", ""))
            if target is None or target == seat or s["fallen"][target]:
                return "Pick someone to give it to."
            if not self.same_room(s, seat, target):
                return "You can only give things to someone in the same room."
            if what in s["gear"][seat]:
                s["gear"][seat].remove(what)
                s["gear"][target].append(what)
            elif what in s["carried"][seat]:
                s["carried"][seat].remove(what)
                s["carried"][target].append(what)
            else:
                return "You don't have that."
            self._log(s, f"{name} gives the {what} to {self.seat_name(room, s, target)}.")
            return None

        if action == "end_turn":
            self._end_turn(room, s)
            return None

        if not s["haunt"]:
            return "That only matters once the Haunting begins."

        if action == "rite":
            if here["name"] != "Chapel":
                return "Rites can only be performed in the Chapel."
            if not s["carried"][seat]:
                return "You need a relic to perform a rite."
            if s["used"].get("rite"):
                return "You've already tried a rite this turn."
            s["used"]["rite"] = True
            target = 11
            bonus = 2 if self.has(s, seat, "Silver Bell") else 0
            relic = s["carried"][seat][0]
            luck = 1 if self.has(s, seat, "Lucky Coin") else 0
            most = target - 1 - s["mind"][seat] - bonus - luck
            pairs = [(a, b) for a in range(1, 7) for b in range(1, 7) if a + b <= most]
            # Any rite can be smothered by the house (1 in 6). The traitor's rites always fail: with a
            # roll that looks like an honest miss, or, if no roll could miss, a smothered rite.
            smothered = random.random() < 1 / 6 or (seat == s["traitor"] and not pairs)
            if smothered:
                ok = False
                s["last_roll"] = None
                self._log(s, f"{name} raises the {relic} and begins a rite, but every candle in the Chapel "
                             f"gutters out at once.", "bad")
            else:
                if seat == s["traitor"]:
                    dice = list(random.choice(pairs))
                    total = sum(dice) + s["mind"][seat] + bonus + luck
                    ok = False
                    s["last_roll"] = {"seat": seat, "dice": dice, "total": total, "target": target, "ok": False, "label": "Rite"}
                else:
                    ok, dice, total = self.test(room, s, seat, "mind", target, bonus, label="Rite")
                self._log(s, f"{name} raises the {relic} and begins a rite: {dice[0]} + {dice[1]} + "
                             f"{total - sum(dice)} = {total} vs {target}.", "go")
            if ok:
                s["carried"][seat].remove(relic)
                s["rites"] += 1
                self._log(s, f"The {relic} crumbles to ash. Rite {s['rites']} of {RITES_NEEDED} is done!", "good")
                self._check_end(room, s)
            elif not smothered:
                self._log(s, "The rite falters. Nothing happens.", "bad")
            return None

        if action == "accuse":
            target = self._target(s, data)
            # The traitor may bluff an accusation too: it's always a wrong guess, with the usual cost.
            if s["revealed"]:
                return "The traitor is already unmasked."
            if s["accused"][seat]:
                return "You've already made your accusation this game."
            if target is None or target == seat or s["fallen"][target]:
                return "Pick someone to accuse."
            s["accused"][seat] = True
            tname = self.seat_name(room, s, target)
            if target == s["traitor"]:
                s["revealed"] = True
                self._log(s, f"{name} accuses {tname}... and the mask slips! {tname} is the traitor!", "win")
            else:
                self._log(s, f"{name} accuses {tname}, but {tname} is no traitor. {name}'s nerve cracks (-2 Mind).", "bad")
                self.change(room, s, seat, "mind", -2)
                self._check_end(room, s)
            return None

        if action == "curse":
            if seat != s["traitor"]:
                return "Only the traitor can do that."
            if s["used"].get("curse"):
                return "You've already laid a curse this turn."
            target = self._target(s, data)
            stat = data.get("stat")
            if target is None or target == seat or s["fallen"][target] or stat not in ("body", "mind"):
                return "Pick an explorer and Body or Mind."
            if not self.same_room(s, seat, target):
                return "Your victim has to be in the same room."
            s["used"]["curse"] = True
            if s["revealed"]:
                self.change(room, s, target, stat, -1)
                self._log(s, f"{name} curses {self.seat_name(room, s, target)} (-1 {stat.capitalize()}).", "bad")
                self._check_end(room, s)
            else:
                s["curses"].append((target, stat))       # lands, anonymously, at the end of the round
            return None

        if action == "attack":
            if not s["revealed"]:
                return "You can only fight once the traitor is unmasked."
            target = self._target(s, data)
            if target is None or target == seat or s["fallen"][target]:
                return "Pick someone to fight."
            if seat != s["traitor"] and target != s["traitor"]:
                return "Explorers only fight the traitor."
            if not self.same_room(s, seat, target):
                return "They have to be in the same room."
            if s["used"].get("attack"):
                return "You've already fought this turn."
            s["used"]["attack"] = True
            a = self.roll()
            b = self.roll()
            ta = sum(a) + s["body"][seat] + (1 if self.has(s, seat, "Crowbar") else 0)
            tb = sum(b) + s["body"][target] + (1 if self.has(s, target, "Crowbar") else 0)
            tname = self.seat_name(room, s, target)
            self._log(s, f"{name} attacks {tname}: {ta} against {tb}.", "go")
            if ta > tb:
                self.change(room, s, target, "body", -1)
                self._log(s, f"{tname} loses 1 Body.", "bad")
            elif tb > ta:
                self.change(room, s, seat, "body", -1)
                self._log(s, f"{tname} fights back. {name} loses 1 Body.", "bad")
            else:
                self._log(s, "Neither gives ground.")
            self._check_end(room, s)
            return None

        return "Unknown action."

    def _target(self, s, data):
        try:
            t = int(data.get("target"))
        except (TypeError, ValueError):
            return None
        return t if 0 <= t < len(s["seats"]) else None

    def skip(self, room, s):
        self._end_turn(room, s)
        return None

    # ---- View ------------------------------------------------------------------------------
    def game_view(self, room, s, seat):
        if not s["started"]:
            return {}
        n = len(s["seats"])
        me_traitor = seat is not None and s["haunt"] and seat == s["traitor"]
        known = s["revealed"] or s["over"]
        out = {
            "w": W, "h": H,
            "tiles": [{"x": int(k.split(",")[0]), "y": int(k.split(",")[1]), **t} for k, t in s["tiles"].items()],
            "pos": s["pos"], "body": s["body"], "mind": s["mind"], "gear": s["gear"], "carried": s["carried"],
            "fallen": s["fallen"], "turn": s["turn"], "moves": s["moves"], "used": s["used"], "round": s["round"],
            "haunt": s["haunt"], "rites": s["rites"], "ritesNeeded": RITES_NEEDED, "doom": s["doom"],
            "doomLimit": s["doom_limit"], "roomsLeft": len(s["deck"]), "accused": s["accused"],
            "traitor": s["traitor"] if known else None, "revealed": s["revealed"],
            "youAreTraitor": me_traitor, "items": ITEMS, "lastRoll": s["last_roll"],
            "myCurses": [{"target": t, "stat": st} for t, st in s["curses"]] if me_traitor else [],
        }
        return out
