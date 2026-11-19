"""Sketch & Guess rules for live rooms.

Players take turns to draw. The drawer picks one of three words and draws it; everyone else types
guesses. The server keeps the word secret (guessers see blanks, with a letter shown now and then),
scores right guesses by how quickly they came, and gives the drawer points for each person who got it.

Drawing is relayed live through the server's "live" event (see relay below), not the full room
update, so lines appear for everyone as they are drawn. The finished strokes are also kept in the
state, so anyone who joins or reconnects mid-drawing sees the whole picture.

Words come from the packs below plus the champion and agent lists in acedle/, so those stay in one place.
"""
import os
import random
import re
import time

from .base import SeatedGame

SITE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHOOSE_SECONDS = 15
REVEAL_SECONDS = 6
MAX_POINTS = 12000            # points kept per drawing (a long scribble stops adding after this)
MAX_STROKES = 600
COLOURS = re.compile(r"^#[0-9a-f]{6}$")

PACKS = {
    "everyday": ("Everyday things", """
        apple banana pizza burger sandwich cookie cake donut ice-cream popcorn carrot cheese egg
        house castle bridge tower lighthouse tent window door ladder fence chair table bed lamp clock
        sofa bathtub toilet umbrella glasses hat crown shoe sock backpack wallet key lock phone laptop
        camera television radio guitar drum piano trumpet microphone headphones book pencil scissors
        envelope gift balloon candle rocket airplane helicopter boat submarine bicycle car bus train
        tractor skateboard snowman sun moon star cloud rainbow lightning tornado volcano mountain island
        beach river waterfall tree flower cactus mushroom leaf dog cat fish shark whale octopus crab snail
        spider butterfly bee ant snake frog turtle penguin owl eagle duck chicken pig cow horse sheep
        rabbit mouse giraffe elephant lion monkey kangaroo dinosaur dragon unicorn ghost robot alien
        vampire pirate ninja wizard knight king princess mermaid zombie skeleton angel
        football basketball trophy medal kite bowling swing slide sandcastle campfire fireworks
        toothbrush hammer saw shovel bucket magnet battery lightbulb anchor compass map treasure
        """),
    "gaming": ("Gaming things", """
        controller keyboard mouse headset monitor joystick arcade dice chess cards poker-chips
        sword shield bow arrow axe spear dagger potion scroll wand armour helmet bomb grenade
        sniper pistol shotgun knife spike trap turret tower minion jungle dragon baron
        treasure-chest health-bar level-up respawn checkpoint boss loot coin gem crystal portal
        teleport jetpack parachute zombie creeper laser shield-bubble smoke flashbang
        trophy leaderboard crown victory defeat lag rage-quit afk noob
        """),
}


def read_names(file):
    """First column of an acedle/*.txt list (one name per line, # for notes)."""
    try:
        with open(os.path.join(SITE, "acedle", file), encoding="utf-8") as f:
            return [line.split("|")[0].strip() for line in f
                    if line.strip() and not line.lstrip().startswith("#") and line.split("|")[0].strip()]
    except OSError:
        return []


def word_pool(keys):
    pool = []
    for k in keys:
        if k in PACKS:
            pool += [w.replace("-", " ") for w in PACKS[k][1].split()]
        elif k == "champions":
            pool += read_names("champions.txt")
        elif k == "agents":
            pool += read_names("agents.txt")
    return list(dict.fromkeys(pool))


def norm(text):
    return re.sub(r"[^a-z0-9]", "", str(text).lower())


def one_off(a, b):
    """True if a and b differ by one letter (changed, added or missing): 'so close'."""
    if abs(len(a) - len(b)) > 1 or a == b:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    if len(a) > len(b):
        a, b = b, a
    return any(a == b[:i] + b[i + 1:] for i in range(len(b)))


class Sketch(SeatedGame):
    id = "sketch"
    name = "Sketch & Guess"
    min_players = 2
    max_players = 16
    late_join = True
    multi = ("words",)
    lobby_text = "Take a seat to play. Everyone takes turns to draw; the others guess."
    options = {
        "words": [("everyday", "Everyday things"), ("gaming", "Gaming things"),
                  ("champions", "League champions"), ("agents", "VALORANT agents")],
        "rounds": [("2", "2 rounds"), ("1", "1 round"), ("3", "3 rounds"), ("4", "4 rounds")],
        "time": [("80", "80 seconds to draw"), ("60", "60 seconds"), ("100", "100 seconds"), ("120", "120 seconds")],
    }

    # ---- Game flow -------------------------------------------------------------------------
    def begin(self, room, s):
        pool = word_pool(s["options"]["words"].split(","))
        if len(pool) < 3:
            return "There aren't enough words in those packs."
        random.shuffle(pool)
        s.update({
            "pool": pool, "used": 0, "round": 1, "rounds": int(s["options"]["rounds"]),
            "limit": int(s["options"]["time"]), "turn": -1, "drawn": [],
            "scores": {pid: 0 for pid in s["seats"]}, "chat": [], "phase": "", "word": "",
            "choices": [], "guessed": {}, "strokes": [], "ink": 0, "until": 0, "shown": [],
        })
        self._log(s, f"Sketch & Guess: {s['rounds']} round{'s' if s['rounds'] > 1 else ''}, "
                     f"{s['limit']} seconds a drawing. Get your pens ready!", "go")
        self._next_turn(room, s, time.time())
        return None

    def joined(self, room, s, pid):
        if self.in_game(s) and pid not in s["seats"]:
            s["seats"].append(pid)
            s["scores"].setdefault(pid, 0)
            self._say(s, f"{room.players[pid]['name']} joined the game.")

    def _say(self, s, text, kind="sys", name="", to=None):
        s["chat"].append({"name": name, "text": text, "kind": kind, "to": to})
        del s["chat"][:-80]

    def _drawer(self, s):
        return s["seats"][s["turn"]] if 0 <= s["turn"] < len(s["seats"]) else None

    def _here(self, room, pid):
        p = room.players.get(pid, {})
        return p.get("role") == "player" and bool(p.get("sids"))

    def _next_turn(self, room, s, now):
        """Hand the pen to the next player still here who hasn't drawn this round."""
        while True:
            nxt = next((i for i, pid in enumerate(s["seats"]) if pid not in s["drawn"] and self._here(room, pid)), None)
            if nxt is not None:
                break
            if s["round"] >= s["rounds"] or not any(self._here(room, p) for p in s["seats"]):
                self._end(room, s)
                return
            s["round"] += 1
            s["drawn"] = []
            self._say(s, f"Round {s['round']} of {s['rounds']}!", "go")
        s["turn"] = nxt
        pid = s["seats"][nxt]
        s["drawn"].append(pid)
        if s["used"] + 3 > len(s["pool"]):
            random.shuffle(s["pool"])
            s["used"] = 0
        s["choices"] = s["pool"][s["used"]:s["used"] + 3]
        s["used"] += 3
        s.update({"phase": "choose", "until": now + CHOOSE_SECONDS, "word": "", "guessed": {},
                  "strokes": [], "shown": []})
        s["ink"] += 1
        self._say(s, f"{room.players[pid]['name']} is choosing a word.")

    def _choose(self, room, s, i, now):
        s["word"] = s["choices"][i]
        s["choices"] = []
        s.update({"phase": "draw", "asked": now, "until": now + s["limit"]})
        self._say(s, f"{room.players[self._drawer(s)]['name']} is drawing!", "go")

    def _reveal(self, room, s, now):
        drawer = self._drawer(s)
        n = len(s["guessed"])
        if n and drawer:
            s["scores"][drawer] = s["scores"].get(drawer, 0) + 60 * n + 40
            s["drawerGain"] = 60 * n + 40
        else:
            s["drawerGain"] = 0
        s.update({"phase": "reveal", "until": now + REVEAL_SECONDS})
        self._say(s, f"The word was {s['word']}." + (f" {n} got it." if n else " Nobody got it."), "word")
        self._log(s, f"{room.players.get(drawer, {}).get('name', '?')} drew \"{s['word']}\": "
                     f"{n} guessed it.", "good" if n else "")

    def _end(self, room, s):
        s["phase"] = "done"
        ranked = sorted(s["seats"], key=lambda p: -s["scores"].get(p, 0))
        top = s["scores"].get(ranked[0], 0) if ranked else 0
        winners = [p for p in ranked if s["scores"].get(p, 0) == top]
        s["winners"] = winners
        names = " and ".join(room.players.get(p, {}).get("name", "?") for p in winners)
        self.finish(s, winners[0] if winners else None,
                    f"{names} {'win' if len(winners) > 1 else 'wins'} with {top} points!" if winners and top
                    else "Game over.")

    def _hint_letters(self, s, now):
        """Show a letter at half time and another at three-quarters (never the whole word)."""
        if s["phase"] != "draw":
            return False
        gone = (now - s["asked"]) / s["limit"]
        want = (gone >= 0.5) + (gone >= 0.75)
        letters = [i for i, c in enumerate(s["word"]) if c.isalnum() and i not in s["shown"]]
        if len(s["shown"]) < want and len(letters) > 2:
            s["shown"].append(random.choice(letters))
            return True
        return False

    def tick(self, room, now):
        s = room.state
        if not self.in_game(s):
            return False
        changed = False
        for pid, p in room.players.items():
            if p.get("role") == "player" and pid not in s["seats"]:
                self.joined(room, s, pid)
                changed = True
        drawer = self._drawer(s)
        if s["phase"] in ("choose", "draw") and drawer and not self._here(room, drawer):
            self._say(s, f"{room.players.get(drawer, {}).get('name', 'The drawer')} left, so that turn is skipped.")
            if s["phase"] == "draw":
                self._reveal(room, s, now)
            else:
                self._next_turn(room, s, now)
            return True
        if s["phase"] == "choose" and now >= s["until"]:
            self._choose(room, s, random.randrange(len(s["choices"])), now)
            return True
        if s["phase"] == "draw":
            guessers = [p for p in s["seats"] if p != drawer and self._here(room, p)]
            if now >= s["until"] or (guessers and all(p in s["guessed"] for p in guessers)):
                self._reveal(room, s, now)
                return True
            changed = self._hint_letters(s, now) or changed
        if s["phase"] == "reveal" and now >= s["until"]:
            self._next_turn(room, s, now)
            return True
        return changed

    # ---- Actions ---------------------------------------------------------------------------
    def play(self, room, s, pid, action, data):
        if room.players[pid].get("role") != "player":
            return "Take a seat to play."
        if pid not in s["seats"]:
            self.joined(room, s, pid)
        drawer = self._drawer(s)
        name = room.players[pid]["name"]
        now = time.time()

        if action == "choose":
            if pid != drawer or s["phase"] != "choose":
                return "It's not your turn to pick a word."
            try:
                i = int(data.get("choice"))
            except (TypeError, ValueError):
                return "Pick a word."
            if not 0 <= i < len(s["choices"]):
                return "Pick a word."
            self._choose(room, s, i, now)
            return None

        if action == "guess":
            text = re.sub(r"\s+", " ", str(data.get("text", ""))).strip()[:80]
            if not text:
                return None
            insiders = [drawer] + list(s["guessed"])          # people who know the word
            if s["phase"] != "draw" or pid == drawer or pid in s["guessed"]:
                # Chat. While someone is drawing, the drawer and those who've guessed only talk among themselves.
                secret = s["phase"] == "draw" and pid in insiders
                if secret and norm(s["word"]) in norm(text):
                    return "No giving the word away!"
                self._say(s, text, "chat", name, to=insiders if secret else None)
                return None
            if norm(text) == norm(s["word"]):
                left = max(0.0, s["until"] - now)
                pts = 100 + round(400 * left / s["limit"]) + (50 if not s["guessed"] else 0)
                s["guessed"][pid] = pts
                s["scores"][pid] = s["scores"].get(pid, 0) + pts
                self._say(s, f"{name} guessed the word!", "right")
                return None
            self._say(s, text, "chat", name)
            if len(norm(s["word"])) > 3 and one_off(norm(text), norm(s["word"])):
                self._say(s, f"\"{text}\" is really close!", "close", to=[pid])
            return None

        return "Unknown action."

    def relay(self, room, pid, data):
        """A piece of drawing from the drawer: store it and return what to pass on to everyone else."""
        s = room.state
        if not self.in_game(s) or s.get("phase") != "draw" or pid != self._drawer(s):
            return None
        kind = data.get("k")
        strokes = s["strokes"]
        if kind == "start":
            c = str(data.get("c", "#000000")).lower()
            if not COLOURS.match(c) or len(strokes) >= MAX_STROKES:
                return None
            try:
                w = max(1, min(60, int(data.get("w", 6))))
                x, y = (max(0, min(1000, int(v))) for v in (data.get("x"), data.get("y")))
            except (TypeError, ValueError):
                return None
            strokes.append({"c": c, "w": w, "p": [x, y]})
            out = {"k": "start", "c": c, "w": w, "x": x, "y": y}
        elif kind == "pts":
            pts = data.get("p")
            if not strokes or not isinstance(pts, list) or len(pts) > 400 or len(pts) % 2:
                return None
            if sum(len(st["p"]) for st in strokes) + len(pts) > MAX_POINTS:
                return None
            try:
                pts = [max(0, min(1000, int(v))) for v in pts]
            except (TypeError, ValueError):
                return None
            strokes[-1]["p"] += pts
            out = {"k": "pts", "p": pts}
        elif kind == "fill":
            c = str(data.get("c", "")).lower()
            if not COLOURS.match(c) or len(strokes) >= MAX_STROKES:
                return None
            try:
                x, y = (max(0, min(1000, int(v))) for v in (data.get("x"), data.get("y")))
            except (TypeError, ValueError):
                return None
            strokes.append({"c": c, "fill": True, "p": [x, y]})
            out = {"k": "fill", "c": c, "x": x, "y": y}
        elif kind == "undo":
            if not strokes:
                return None
            strokes.pop()
            out = {"k": "undo"}
        elif kind == "clear":
            strokes.clear()
            out = {"k": "clear"}
        else:
            return None
        s["ink"] += 1
        out["v"] = s["ink"]
        return out

    def skip(self, room, s):
        now = time.time()
        if s["phase"] == "choose":
            self._choose(room, s, 0, now)
        elif s["phase"] == "draw":
            self._reveal(room, s, now)
        else:
            self._next_turn(room, s, now)
        return None

    def skip_label(self, room, s):
        return {"choose": "the word pick", "draw": "the drawing"}.get(s.get("phase"), "ahead to the next drawing")

    # ---- View ------------------------------------------------------------------------------
    def game_view(self, room, s, pid):
        if not s["started"]:
            return {}
        now = time.time()
        drawer = self._drawer(s)
        phase = s["phase"]
        knows = pid == drawer or pid in s["guessed"] or phase in ("reveal", "done")
        word = s["word"]
        mask = "".join(c if (not c.isalnum() or i in s["shown"]) else "_" for i, c in enumerate(word))
        board = [{
            "id": p, "name": room.players.get(p, {}).get("name", "?"), "score": s["scores"].get(p, 0),
            "online": bool(room.players.get(p, {}).get("sids")),
            "playing": room.players.get(p, {}).get("role") == "player",
            "drawing": p == drawer and phase in ("choose", "draw"),
            "guessed": p in s["guessed"], "gained": s["guessed"].get(p) or
                       (s.get("drawerGain") if p == drawer and phase == "reveal" else None),
        } for p in s["seats"]]
        board.sort(key=lambda r: -r["score"])
        return {
            "phase": phase, "round": s["round"], "rounds": s["rounds"], "limit": s["limit"],
            "remaining": max(0.0, round(s["until"] - now, 2)) if phase in ("choose", "draw", "reveal") else 0,
            "drawer": drawer, "drawerName": room.players.get(drawer, {}).get("name", "?"),
            "picks": s["choices"] if pid == drawer and phase == "choose" else [],
            "word": word if knows else "", "mask": mask if phase == "draw" else "",
            "strokes": s["strokes"], "ink": s["ink"],
            "chat": [{k: m[k] for k in ("name", "text", "kind")} for m in s["chat"]
                     if m["to"] is None or pid in m["to"]][-60:],
            "board": board, "winners": s.get("winners", []), "iGuessed": pid in s["guessed"],
        }
