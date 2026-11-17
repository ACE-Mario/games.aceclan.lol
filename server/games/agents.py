"""Ace Agents rules for live rooms.

The server is the referee: it deals the board, checks whose turn it is, and only sends the
key (which card belongs to which team) to spymasters. Operatives only ever learn a card's
colour once it is revealed, so nobody can peek at the key from the browser.
"""
import os
import random
import re

SITE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORDS_JS = os.path.join(SITE, "agents", "words.js")

TEAMS = ("red", "purple")
NAMES = {"red": "Red", "purple": "Purple"}
ROLES = ("spymaster", "operative")
ROWS = "ABCDE"


def other(team):
    return "purple" if team == "red" else "red"


def coord(i):
    return f"{ROWS[i // 5]}{i % 5 + 1}"


def load_packs():
    """Read the word packs from agents/words.js so the website and server share one list."""
    with open(WORDS_JS, encoding="utf-8") as f:
        text = f.read()
    packs = {}
    for m in re.finditer(r'(\w+)\s*:\s*\{\s*name:\s*"([^"]+)"\s*,\s*words:\s*`([^`]*)`', text):
        words = list(dict.fromkeys(m.group(3).lower().split()))
        if len(words) >= 25:
            packs[m.group(1)] = {"name": m.group(2), "words": words}
    return packs


class Agents:
    id = "agents"
    name = "Ace Agents"

    # ---- Dealing -------------------------------------------------------------------------
    def new_state(self, options=None, old=None):
        packs = load_packs()
        pack = (options or {}).get("pack")
        if pack not in packs:
            pack = old["pack"] if old and old.get("pack") in packs else "classic"
        words = random.sample(packs[pack]["words"], 25)
        first = random.choice(TEAMS)
        roles = [first] * 9 + [other(first)] * 8 + ["neutral"] * 7 + ["bomb"]
        random.shuffle(roles)
        return {
            "pack": pack, "words": words, "roles": roles, "first": first,
            "revealed": [], "turn": first, "clue": None, "left": None, "started": False,
            "log": [{"text": "New board dealt. Pick your teams, then the leader starts the game.", "kind": ""}],
            "winner": None, "reason": "", "history": [],
        }

    # ---- Seats ---------------------------------------------------------------------------
    def locked(self, s):
        """Teams are locked from Start game until the game ends."""
        return s.get("started") and not s.get("winner")

    def default_seat(self, room):
        """Put a new player on the smaller team as an operative. During a game, they watch
        until the leader puts them on a team with the admin panel."""
        if self.locked(room.state):
            return {"team": None, "role": None}
        counts = {t: sum(1 for p in room.players.values() if p.get("team") == t) for t in TEAMS}
        team = min(TEAMS, key=lambda t: (counts[t], random.random()))
        return {"team": team, "role": "operative"}

    def shuffle_teams(self, room):
        people = [pid for pid, p in room.players.items() if p["sids"]]
        random.shuffle(people)
        for n, pid in enumerate(people):
            team = TEAMS[n % 2]
            room.players[pid]["team"] = team
            room.players[pid]["role"] = "spymaster" if n < 2 else "operative"

    # ---- Helpers -------------------------------------------------------------------------
    def left_for(self, s, team):
        return sum(1 for i, r in enumerate(s["roles"]) if r == team and i not in s["revealed"])

    def _log(self, s, text, kind=""):
        s["log"].append({"text": text, "kind": kind})
        del s["log"][:-80]

    def _remember(self, s):
        snap = {k: (list(v) if isinstance(v, list) else v) for k, v in s.items() if k != "history"}
        snap["log"] = [dict(e) for e in s["log"]]
        s["history"].append(snap)
        del s["history"][:-40]

    def _pass_turn(self, s, note=""):
        s["turn"] = other(s["turn"])
        s["clue"] = None
        s["left"] = None
        self._log(s, f"{note + ' ' if note else ''}{NAMES[s['turn']]}'s turn.", s["turn"])

    def _finish(self, s, winner, reason):
        s["winner"] = winner
        s["reason"] = reason
        s["clue"] = None
        s["left"] = None
        self._log(s, f"{NAMES[winner]} wins. {reason}", winner)

    # ---- Actions -------------------------------------------------------------------------
    def handle(self, room, pid, action, data):
        """Apply one player action. Returns an error message for the player, or None."""
        s = room.state
        me = room.players[pid]
        team, role, name = me.get("team"), me.get("role"), me["name"]

        if action == "admin_seat":
            # Leader-only force move. Allowed any time, and always written to the log.
            if not room.is_host(pid):
                return "Only the leader can use the admin panel."
            target = room.players.get(str(data.get("player", "")))
            want_team, want_role = data.get("team"), data.get("role")
            if not target:
                return "That player isn't in this room any more."
            if want_team is not None and (want_team not in TEAMS or want_role not in ROLES):
                return "Pick a team and a role."
            if want_role == "spymaster" and want_team:
                for q, p in room.players.items():
                    if p is not target and p.get("team") == want_team and p.get("role") == "spymaster":
                        p["role"] = "operative"
                        self._log(s, f"[Admin] {name} moved {p['name']} to {NAMES[want_team]} operative.", "admin")
            target["team"], target["role"] = (want_team, want_role) if want_team else (None, None)
            where = f"{NAMES[want_team]} {want_role}" if want_team else "watching"
            self._log(s, f"[Admin] {name} moved {target['name']} to {where}.", "admin")
            return None

        if action == "seat" and self.locked(s):
            return "Teams are locked while the game is on. Ask the leader if you need to switch."

        if action == "seat":
            want_team = data.get("team")
            want_role = data.get("role")
            if want_team is None:
                me["team"], me["role"] = None, None
                return None
            if want_team == "random":
                # Join whichever team has fewer players (a coin flip if they're even).
                counts = {t: sum(1 for q, p in room.players.items() if q != pid and p.get("team") == t)
                          for t in TEAMS}
                me["team"] = min(TEAMS, key=lambda t: (counts[t], random.random()))
                me["role"] = "operative"
                return None
            if want_team not in TEAMS or want_role not in ROLES:
                return "Pick a team and a role."
            if want_role == "spymaster":
                taken = next((p for q, p in room.players.items()
                              if q != pid and p.get("team") == want_team and p.get("role") == "spymaster"), None)
                if taken:
                    return f"{taken['name']} is already {NAMES[want_team]}'s spymaster."
            me["team"], me["role"] = want_team, want_role
            return None

        if action == "shuffle":
            if not room.is_host(pid):
                return "Only the leader can make random teams."
            if self.locked(s):
                return "Teams are locked while the game is on. Use the admin panel to move someone."
            self.shuffle_teams(room)
            self._log(s, f"{name} made random teams.")
            return None

        if action == "new_game":
            if not room.is_host(pid):
                return "Only the leader can deal a new game."
            room.state = self.new_state(data, old=s)
            return None

        if action == "undo":
            if not room.is_host(pid):
                return "Only the leader can undo."
            if not s["history"]:
                return "Nothing to undo."
            prev = s["history"].pop()
            prev["history"] = s["history"]
            room.state = prev
            self._log(room.state, f"{name} undid the last move.")
            return None

        if action == "start":
            if not room.is_host(pid):
                return "Only the leader can start the game."
            if s["started"]:
                return "The game has already started."
            for t in TEAMS:
                members = [p for p in room.players.values() if p.get("team") == t]
                if not any(p.get("role") == "spymaster" for p in members):
                    return f"{NAMES[t]} needs a spymaster before you can start."
                if not any(p.get("role") == "operative" for p in members):
                    return f"{NAMES[t]} needs at least one operative before you can start."
            s["started"] = True
            self._log(s, f"Game started. {NAMES[s['first']]} goes first with 9 agents.", s["first"])
            return None

        if not s["started"]:
            return "The game hasn't started yet. Waiting for the leader."

        if s["winner"]:
            return "This game is over. The leader can deal a new one."

        if action == "clue":
            if team != s["turn"] or role != "spymaster":
                return f"Only {NAMES[s['turn']]}'s spymaster can give a clue now."
            if s["clue"]:
                return "You've already given a clue this turn."
            word = str(data.get("word", "")).strip().lower()[:24]
            if not word:
                return "Type a clue word first."
            if re.search(r"\s", word):
                return "Clues are one word."
            for i, w in enumerate(s["words"]):
                if i not in s["revealed"] and (w in word or word in w):
                    return f'"{word.upper()}" is too close to {w.upper()} on the board.'
            num = data.get("num")
            if num == "inf":
                shown, left = "∞", None
            else:
                try:
                    n = int(num)
                except (TypeError, ValueError):
                    return "Pick a number for the clue."
                if not 0 <= n <= 9:
                    return "Pick a number from 0 to 9."
                shown, left = str(n), (None if n == 0 else n + 1)
            self._remember(s)
            s["clue"] = {"word": word, "num": shown}
            s["left"] = left
            self._log(s, f"{name} ({NAMES[team]}) clue: {word.upper()} {shown}", team)
            return None

        if action == "reveal":
            if team != s["turn"] or role != "operative":
                return f"Only {NAMES[s['turn']]}'s operatives can pick a card now."
            if not s["clue"]:
                return "Wait for your spymaster's clue."
            try:
                i = int(data.get("index"))
            except (TypeError, ValueError):
                return "Pick a card."
            if not 0 <= i < 25 or i in s["revealed"]:
                return "That card is already revealed."
            self._remember(s)
            card = s["roles"][i]
            s["revealed"].append(i)
            word = s["words"][i].upper()
            what = {"neutral": "a bystander", "bomb": "the BOMB"}.get(card, f"{NAMES.get(card)}'s card")
            self._log(s, f"{name} ({NAMES[team]}) picked {word} ({coord(i)}): {what}", card)
            if card == "bomb":
                self._finish(s, other(team), f"{NAMES[team]} hit the bomb.")
            elif self.left_for(s, card) == 0:
                reason = (f"{NAMES[card]} found all their agents." if card == team
                          else f"{NAMES[team]} uncovered {NAMES[card]}'s last agent.")
                self._finish(s, card, reason)
            elif card != team:
                self._pass_turn(s)
            elif s["left"] is not None:
                s["left"] -= 1
                if s["left"] <= 0:
                    self._pass_turn(s, "Out of guesses.")
            return None

        if action == "end_turn":
            if team != s["turn"]:
                return f"It's {NAMES[s['turn']]}'s turn."
            self._remember(s)
            self._pass_turn(s, f"{name} ended {NAMES[team]}'s turn.")
            return None

        return "Unknown action."

    # ---- What each player sees -----------------------------------------------------------
    def view(self, room, pid):
        s = room.state
        me = room.players.get(pid, {})
        started = s.get("started", True)
        show_key = started and (bool(s["winner"]) or me.get("role") == "spymaster" and me.get("team") in TEAMS)
        cards = []
        for i, w in enumerate(s["words"]):
            revealed = i in s["revealed"]
            cards.append({"word": w if started else "", "revealed": revealed,
                          "role": s["roles"][i] if revealed or show_key else None})
        return {
            "pack": s["pack"], "packs": {k: v["name"] for k, v in load_packs().items()},
            "cards": cards, "showKey": show_key, "started": started, "locked": bool(self.locked(s)), "first": s["first"], "turn": s["turn"],
            "clue": s["clue"], "left": s["left"], "winner": s["winner"], "reason": s["reason"],
            "log": s["log"][-60:], "canUndo": bool(s["history"]),
            "remaining": {t: self.left_for(s, t) for t in TEAMS},
            "lastRevealed": s["revealed"][-1] if s["revealed"] else None,
        }
