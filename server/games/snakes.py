"""Snakes & Ladders rules for live rooms.

The traditional race game on a 10 x 10 board. The server rolls the die, so nobody can pick
their own number. Squares are numbered 1-100; 0 means a counter hasn't entered the board yet.
"""
import random

from .base import SeatedGame

# Our own classic-style board: ladder foot -> top, snake head -> tail.
LADDERS = {4: 25, 13: 46, 33: 49, 42: 63, 50: 69, 62: 81, 74: 92}
SNAKES = {27: 5, 40: 3, 43: 18, 54: 31, 66: 45, 76: 58, 89: 53, 99: 41}


class Snakes(SeatedGame):
    id = "snakes"
    name = "Snakes & Ladders"
    min_players = 2
    max_players = 6
    bots = True
    lobby_text = "Take a seat (2 to 6 players), then the leader starts the game."
    options = {
        "finish": [("bounce", "Exact roll, bounce back"), ("exact", "Exact roll, or stay put"),
                   ("any", "Any roll reaches 100")],
        "six": [("again", "Roll a 6, roll again"), ("no", "No extra turns")],
    }

    def begin(self, room, s):
        n = len(s["seats"])
        s.update({"pos": [0] * n, "turn": 0, "last": None, "rolls": 0})
        self._log(s, f"Game started. {self.seat_name(room, s, 0)} rolls first.", "go")

    def _next(self, room, s):
        s["turn"] = (s["turn"] + 1) % len(s["seats"])

    def play(self, room, s, seat, action, data):
        if action != "roll":
            return "Unknown action."
        if seat != s["turn"]:
            return f"It's {self.seat_name(room, s, s['turn'])}'s turn."
        name = self.seat_name(room, s, seat)
        die = random.randint(1, 6)
        start = s["pos"][seat]
        target = start + die
        note = ""
        if target > 100:
            mode = s["options"]["finish"]
            if mode == "bounce":
                target = 200 - target
                note = f" and bounced back to {target}"
            elif mode == "exact":
                target = start
                note = f", needs exactly {100 - start}"
            else:
                target = 100
        via = None
        end = target
        if target in LADDERS:
            end, via = LADDERS[target], "ladder"
        elif target in SNAKES:
            end, via = SNAKES[target], "snake"
        s["pos"][seat] = end
        s["rolls"] += 1
        s["last"] = {"seat": seat, "die": die, "from": start, "land": target, "to": end, "via": via, "n": s["rolls"]}
        text = f"{name} rolled a {die}" + (note or f" to {target}")
        if via == "ladder":
            text += f" and climbed a ladder to {end}!"
            kind = "good"
        elif via == "snake":
            text += f" and slid down a snake to {end}."
            kind = "bad"
        else:
            text += "."
            kind = ""
        self._log(s, text, kind)
        if end == 100:
            self.finish(s, seat, f"{name} reached 100 and wins!")
            return None
        if die == 6 and s["options"]["six"] == "again":
            self._log(s, f"{name} rolled a 6 and goes again.", "go")
        else:
            self._next(room, s)
        return None

    def bot_move(self, room, s, seat):
        return self.play(room, s, seat, "roll", {})

    def skip(self, room, s):
        self._next(room, s)
        self._log(s, f"It's {self.seat_name(room, s, s['turn'])}'s turn.")
        return None

    def game_view(self, room, s, seat):
        return {"ladders": LADDERS, "snakes": SNAKES, "pos": s.get("pos", []), "turn": s.get("turn"),
                "last": s.get("last")}
