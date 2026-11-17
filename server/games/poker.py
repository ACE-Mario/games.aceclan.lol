"""Ace Poker Night rules for live rooms: Texas hold'em played for points (no real money).

The server shuffles and deals, so hole cards only ever go to the player holding them (and to
everyone at a showdown). It runs the blinds, the four betting rounds, all-ins and side pots,
and ranks the hands. Busted players stay in the room and watch; the last one with points wins.

Cards are strings like "As" (ace of spades), "Td" (ten of diamonds).
"""
import itertools
import random
import time

from .base import SeatedGame

RANKS = "23456789TJQKA"
SUITS = "shdc"
RANK_NAMES = {r: n for r, n in zip(RANKS, ["2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King", "Ace"])}
PLURAL = {r: n + "s" for r, n in RANK_NAMES.items()}
HAND_NAMES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house",
              "Four of a kind", "Straight flush"]
NEXT_HAND_SECONDS = 8
STREETS = ["preflop", "flop", "turn", "river"]


# ---- Hand ranking ---------------------------------------------------------------------------
def rank5(cards):
    """Score five cards: a tuple that compares higher for better hands."""
    vals = sorted((RANKS.index(c[0]) for c in cards), reverse=True)
    flush = len({c[1] for c in cards}) == 1
    uniq = sorted(set(vals), reverse=True)
    straight_high = None
    if len(uniq) == 5:
        if uniq[0] - uniq[4] == 4:
            straight_high = uniq[0]
        elif uniq == [12, 3, 2, 1, 0]:                  # A-2-3-4-5, the wheel
            straight_high = 3
    counts = sorted(((vals.count(v), v) for v in uniq), reverse=True)
    if straight_high is not None and flush:
        return (8, straight_high)
    if counts[0][0] == 4:
        return (7, counts[0][1], counts[1][1])
    if counts[0][0] == 3 and counts[1][0] == 2:
        return (6, counts[0][1], counts[1][1])
    if flush:
        return (5, *vals)
    if straight_high is not None:
        return (4, straight_high)
    if counts[0][0] == 3:
        return (3, counts[0][1], *[v for c, v in counts[1:]])
    if counts[0][0] == 2 and counts[1][0] == 2:
        return (2, counts[0][1], counts[1][1], counts[2][1])
    if counts[0][0] == 2:
        return (1, counts[0][1], *[v for c, v in counts[1:]])
    return (0, *vals)


def best_hand(cards):
    """Best five of up to seven cards -> (score, the five cards)."""
    return max(((rank5(combo), list(combo)) for combo in itertools.combinations(cards, 5)), key=lambda x: x[0])


def describe(score):
    kind = score[0]
    r = lambda i: RANK_NAMES[RANKS[score[i]]]
    p = lambda i: PLURAL[RANKS[score[i]]]
    if kind == 8:
        return "Royal flush" if score[1] == 12 else f"Straight flush, {r(1)} high"
    if kind == 7:
        return f"Four {p(1)}"
    if kind == 6:
        return f"Full house, {p(1)} full of {p(2)}"
    if kind == 5:
        return f"Flush, {r(1)} high"
    if kind == 4:
        return f"Straight, {r(1)} high"
    if kind == 3:
        return f"Three {p(1)}"
    if kind == 2:
        return f"Two pair, {p(1)} and {p(2)}"
    if kind == 1:
        return f"Pair of {p(1)}"
    return f"{r(1)} high"


class Poker(SeatedGame):
    id = "poker"
    name = "Ace Poker Night"
    min_players = 2
    max_players = 9
    bots = True
    lobby_text = "Take a seat (2 to 9 players), then the leader deals the first hand. Points only, no real money."
    options = {
        "stack": [("1000", "1,000 points each"), ("500", "500 points each"), ("2000", "2,000 points each"),
                  ("5000", "5,000 points each")],
        "blinds": [("10", "Blinds 5 / 10"), ("20", "Blinds 10 / 20"), ("50", "Blinds 25 / 50"), ("100", "Blinds 50 / 100")],
        "rise": [("10", "Blinds double every 10 hands"), ("5", "Blinds double every 5 hands"),
                 ("0", "Blinds never go up")],
    }

    # ---- Table set-up ----------------------------------------------------------------------
    def begin(self, room, s):
        n = len(s["seats"])
        stack = int(s["options"]["stack"])
        s.update({
            "chips": [stack] * n, "out": [False] * n, "dealer": random.randrange(n), "hand": 0,
            "big": int(s["options"]["blinds"]), "phase": "between", "next_at": 0, "hands": [None] * n,
            "board": [], "deck": [], "bet": [0] * n, "put": [0] * n, "folded": [False] * n,
            "allin": [False] * n, "acted": [False] * n, "turn": None, "to_call": 0, "min_raise": 0,
            "street": None, "results": None, "shown": [False] * n, "last_action": [None] * n,
            "pots": [],
        })
        s["dealer"] = (s["dealer"] - 1) % n          # _deal moves the button on before each hand
        self._log(s, f"The game is on. Everyone starts with {stack:,} points.", "go")
        self._deal(room, s)
        return None

    def _alive(self, s):
        return [i for i in range(len(s["seats"])) if not s["out"][i]]

    def _next_alive(self, s, i):
        n = len(s["seats"])
        for k in range(1, n + 1):
            j = (i + k) % n
            if not s["out"][j]:
                return j
        return i

    def _deal(self, room, s):
        n = len(s["seats"])
        s["hand"] += 1
        rise = int(s["options"]["rise"])
        if rise and s["hand"] > 1 and (s["hand"] - 1) % rise == 0:
            s["big"] *= 2
            self._log(s, f"Blinds go up to {s['big'] // 2:,} / {s['big']:,}.", "go")
        deck = [r + u for r in RANKS for u in SUITS]
        random.shuffle(deck)
        s["deck"] = deck
        s["board"] = []
        s["hands"] = [None] * n
        s["bet"] = [0] * n
        s["put"] = [0] * n
        s["folded"] = [s["out"][i] for i in range(n)]
        s["allin"] = [False] * n
        s["acted"] = [False] * n
        s["shown"] = [False] * n
        s["last_action"] = [None] * n
        s["results"] = None
        s["pots"] = []
        s["dealer"] = self._next_alive(s, s["dealer"])
        alive = self._alive(s)
        for i in alive:
            s["hands"][i] = [deck.pop(), deck.pop()]
        if len(alive) == 2:                         # heads-up: the button posts the small blind
            sb, bb = s["dealer"], self._next_alive(s, s["dealer"])
        else:
            sb = self._next_alive(s, s["dealer"])
            bb = self._next_alive(s, sb)
        self._post(s, sb, s["big"] // 2)
        self._post(s, bb, s["big"])
        s["last_action"][sb] = f"Small blind {s['bet'][sb]:,}"
        s["last_action"][bb] = f"Big blind {s['bet'][bb]:,}"
        s["to_call"] = max(s["bet"])
        s["min_raise"] = s["big"]
        s["no_reraise"] = []
        s["street"] = "preflop"
        s["phase"] = "betting"
        s["sb"], s["bb"] = sb, bb
        self._log(s, f"Hand {s['hand']}: {self.seat_name(room, s, s['dealer'])} has the button. "
                     f"Blinds {s['big'] // 2:,} / {s['big']:,}.")
        s["turn"] = None
        self._set_turn(room, s, self._next_alive(s, bb))

    def _post(self, s, i, amount):
        amount = min(amount, s["chips"][i])
        s["chips"][i] -= amount
        s["bet"][i] += amount
        s["put"][i] += amount
        if s["chips"][i] == 0:
            s["allin"][i] = True

    # ---- Betting flow ----------------------------------------------------------------------
    def _can_act(self, s, i):
        return not s["folded"][i] and not s["allin"][i] and not s["out"][i]

    def _set_turn(self, room, s, start):
        """Give the turn to the first player from `start` who still needs to act, or move on."""
        live = [i for i in range(len(s["seats"])) if not s["folded"][i]]
        if len(live) == 1:
            self._award_uncontested(room, s, live[0])
            return
        n = len(s["seats"])
        for k in range(n):
            i = (start + k) % n
            if self._can_act(s, i) and (not s["acted"][i] or s["bet"][i] < s["to_call"]):
                s["turn"] = i
                return
        self._next_street(room, s)

    def _next_street(self, room, s):
        n = len(s["seats"])
        for i in range(n):
            s["bet"][i] = 0
            s["acted"][i] = False
        s["to_call"] = 0
        s["min_raise"] = s["big"]
        s["no_reraise"] = []
        s["turn"] = None
        idx = STREETS.index(s["street"])
        if idx == 3:
            self._showdown(room, s)
            return
        s["street"] = STREETS[idx + 1]
        s["deck"].pop()                                       # burn a card
        new = [s["deck"].pop() for _ in range(3 if s["street"] == "flop" else 1)]
        s["board"].extend(new)
        self._log(s, f"{s['street'].capitalize()}: {' '.join(pretty(c) for c in s['board'])}")
        can = [i for i in range(n) if self._can_act(s, i)]
        if len(can) <= 1:                                     # everyone's all-in: deal it out
            self._next_street(room, s)
            return
        self._set_turn(room, s, self._next_alive(s, s["dealer"]))

    def _pots(self, s, live=False):
        """Split everything put in this hand into a main pot and side pots. With live=True
        (mid-hand, for the display) only all-in players make a new side pot."""
        n = len(s["seats"])
        levels = sorted({s["put"][i] for i in range(n) if s["put"][i] > 0 and not s["folded"][i]
                         and (not live or s["allin"][i])})
        if live:
            top = max(s["put"])
            if not levels or levels[-1] < top:
                levels.append(top)
        pots, prev = [], 0
        for lvl in levels:
            amount = sum(max(0, min(s["put"][i], lvl) - prev) for i in range(n))
            eligible = [i for i in range(n) if not s["folded"][i] and s["put"][i] >= lvl]
            if amount:
                pots.append({"amount": amount, "eligible": eligible})
            prev = lvl
        # Points folded players put in above the top live level go to the last pot.
        extra = sum(max(0, s["put"][i] - prev) for i in range(n))
        if extra and pots:
            pots[-1]["amount"] += extra
        return pots

    def _award_uncontested(self, room, s, winner):
        total = sum(s["put"])
        s["chips"][winner] += total
        s["results"] = {"pots": [{"amount": total, "winners": [winner], "hand": None}], "showdown": False}
        self._log(s, f"{self.seat_name(room, s, winner)} wins {total:,} points (everyone else folded).", "win")
        self._end_hand(room, s)

    def _showdown(self, room, s):
        n = len(s["seats"])
        live = [i for i in range(n) if not s["folded"][i]]
        scores = {i: best_hand(s["hands"][i] + s["board"]) for i in live}
        for i in live:
            s["shown"][i] = True
        results = []
        for pot in self._pots(s):
            if len(pot["eligible"]) == 1:                 # nobody called this much: it goes back
                i = pot["eligible"][0]
                s["chips"][i] += pot["amount"]
                self._log(s, f"{self.seat_name(room, s, i)} gets back {pot['amount']:,} nobody called.")
                continue
            best = max(scores[i][0] for i in pot["eligible"])
            winners = [i for i in pot["eligible"] if scores[i][0] == best]
            share, odd = divmod(pot["amount"], len(winners))
            # Odd points go to the first winner left of the button.
            order = sorted(winners, key=lambda i: (i - s["dealer"] - 1) % n)
            for k, i in enumerate(order):
                s["chips"][i] += share + (1 if k < odd else 0)
            results.append({"amount": pot["amount"], "winners": winners, "hand": describe(best)})
        s["results"] = {"pots": results, "showdown": True,
                        "hands": {str(i): describe(scores[i][0]) for i in live},
                        "best": {str(i): scores[i][1] for i in live}}
        for k, r in enumerate(results):
            label = "the pot" if len(results) == 1 else ("the main pot" if k == 0 else f"side pot {k}")
            names = " and ".join(self.seat_name(room, s, i) for i in r["winners"])
            verb = "split" if len(r["winners"]) > 1 else "wins"
            self._log(s, f"{names} {verb} {label} ({r['amount']:,}) with {r['hand']}.", "win")
        self._end_hand(room, s)

    def _end_hand(self, room, s):
        s["turn"] = None
        s["phase"] = "between"
        s["pots"] = []
        for i in self._alive(s):
            if s["chips"][i] == 0:
                s["out"][i] = True
                self._log(s, f"{self.seat_name(room, s, i)} is out of points.", "bad")
        alive = self._alive(s)
        if len(alive) == 1:
            s["next_at"] = 0
            self.finish(s, alive[0], f"{self.seat_name(room, s, alive[0])} wins the game with all {s['chips'][alive[0]]:,} points!")
            return
        s["next_at"] = time.time() + NEXT_HAND_SECONDS

    def tick(self, room, now):
        s = room.state
        if self.in_game(s) and s.get("phase") == "between" and s.get("next_at") and now >= s["next_at"]:
            self._deal(room, s)
            return True
        return super().tick(room, now)          # bots' turns

    # ---- Bots --------------------------------------------------------------------------------
    def _strength(self, hole, board):
        """Roughly how good a hand is, from 0 (hopeless) to 1 (the nuts)."""
        a, b = sorted((RANKS.index(c[0]) for c in hole), reverse=True)
        if not board:
            if a == b:
                return 0.5 + a / 24                       # 22 = 0.5 ... AA = 1.0
            st = (a + b) / 24 * 0.6
            if hole[0][1] == hole[1][1]:
                st += 0.08
            if a - b == 1:
                st += 0.05
            return st
        score = best_hand(hole + board)[0]
        cat = score[0]
        if len(board) == 5 and best_hand(board)[0][0] >= cat:
            return 0.25                                   # the board is doing all the work
        if cat >= 4:
            return 0.9
        if cat == 3:
            return 0.8
        if cat == 2:
            return 0.7
        if cat == 1:
            pair = score[1]
            if pair in (a, b):
                return 0.45 + pair / 12 * 0.2
            return 0.25
        return 0.12 + a / 12 * 0.1

    def bot_move(self, room, s, i):
        owe = max(0, s["to_call"] - s["bet"][i])
        stack = s["chips"][i]
        pot = sum(s["put"])
        big = s["big"]
        st = self._strength(s["hands"][i], s["board"]) + random.uniform(-0.05, 0.05)
        blocked = bool(s.get("no_reraise")) and i in s["no_reraise"] and s["acted"][i]
        can_raise = stack > owe and not blocked
        r = random.random()

        def raise_by(frac):
            target = s["to_call"] + max(s["min_raise"], int(pot * frac))
            step = max(1, big // 2)
            target = -(-target // step) * step
            if target >= s["bet"][i] + stack:
                return self.play(room, s, i, "allin", {})
            return self.play(room, s, i, "raise", {"to": target})

        def passive():
            return self.play(room, s, i, "check" if owe == 0 else "call", {})

        if st >= 0.75:
            if can_raise and r < 0.8:
                return raise_by(0.75)
            return passive()
        if st >= 0.55:
            if owe == 0:
                return raise_by(0.5) if can_raise and r < 0.5 else passive()
            if owe <= max(pot * 0.75, big * 3):
                return passive()
            return self.play(room, s, i, "fold", {})
        if st >= 0.35:
            if owe == 0:
                return raise_by(0.4) if can_raise and r < 0.15 else passive()
            if owe <= max(big, pot * 0.35):
                return passive()
            return self.play(room, s, i, "fold", {})
        if owe == 0:
            return passive()
        if s["street"] == "preflop" and owe <= big // 2:
            return passive()
        return self.play(room, s, i, "fold", {})

    # ---- Actions ---------------------------------------------------------------------------
    def play(self, room, s, seat, action, data):
        if action == "show":
            # After a hand that nobody had to show, a player may show their cards anyway.
            if s["phase"] != "between" or s["hands"][seat] is None:
                return "You can show your cards once the hand is over."
            s["shown"][seat] = True
            self._log(s, f"{self.seat_name(room, s, seat)} shows {' '.join(pretty(c) for c in s['hands'][seat])}.")
            return None
        if action == "next_hand":
            if not room.is_host(s["seats"][seat]):
                return "Only the leader can deal the next hand early."
            if s["phase"] != "between":
                return "The hand isn't over yet."
            self._deal(room, s)
            return None
        if action not in ("fold", "check", "call", "raise", "allin"):
            return "Unknown action."
        if s["phase"] != "betting":
            return "Wait for the next hand."
        if seat != s["turn"]:
            return f"It's {self.seat_name(room, s, s['turn'])}'s turn."
        return self._act(room, s, seat, action, data)

    def _act(self, room, s, i, action, data):
        name = self.seat_name(room, s, i)
        owe = s["to_call"] - s["bet"][i]
        stack = s["chips"][i]
        if action == "fold":
            s["folded"][i] = True
            s["last_action"][i] = "Fold"
            self._log(s, f"{name} folds.")
        elif action == "check":
            if owe > 0:
                return f"You can't check: it's {owe:,} to call."
            s["last_action"][i] = "Check"
            self._log(s, f"{name} checks.")
        elif action == "call":
            if owe <= 0:
                return "There's nothing to call. Check instead."
            pay = min(owe, stack)
            self._post(s, i, pay)
            s["last_action"][i] = f"Call {pay:,}" + (" (all in)" if s["allin"][i] else "")
            self._log(s, f"{name} calls {pay:,}" + (" and is all in." if s["allin"][i] else "."))
        else:
            # raise / bet to a total for this street, or all-in
            if action == "allin":
                target = s["bet"][i] + stack
            else:
                try:
                    target = int(data.get("to"))
                except (TypeError, ValueError):
                    return "Enter how much to raise to."
            if target > s["bet"][i] + stack:
                return f"You only have {stack:,} points left."
            if target <= s["to_call"]:
                if action == "allin":
                    return self._act(room, s, i, "call", data) if owe > 0 else "Check instead."
                return f"A raise has to go above {s['to_call']:,}."
            raise_by = target - s["to_call"]
            full = raise_by >= s["min_raise"]
            if not full and target < s["bet"][i] + stack:
                return f"The smallest raise is to {s['to_call'] + s['min_raise']:,}."
            if s.get("no_reraise") and i in s["no_reraise"] and s["acted"][i]:
                return "You can only call or fold: the last raise was a short all-in."
            self._post(s, i, target - s["bet"][i])
            word = "bets" if s["to_call"] == 0 else "raises to"
            s["last_action"][i] = ("Bet " if s["to_call"] == 0 else "Raise to ") + f"{target:,}" + (" (all in)" if s["allin"][i] else "")
            self._log(s, f"{name} {word} {target:,}" + (" (all in)." if s["allin"][i] else "."), "go")
            if full:
                s["min_raise"] = raise_by
                s["no_reraise"] = []
                for j in range(len(s["seats"])):
                    if j != i:
                        s["acted"][j] = False
            else:
                # A short all-in: players who already acted may call or fold, but not raise again.
                s["no_reraise"] = [j for j in range(len(s["seats"])) if s["acted"][j] and j != i]
            s["to_call"] = target
        s["acted"][i] = True
        self._set_turn(room, s, (i + 1) % len(s["seats"]))
        return None

    def skip(self, room, s):
        if s["phase"] == "between":
            self._deal(room, s)
            return None
        i = s["turn"]
        if i is None:
            return "Nobody's turn to skip."
        owe = s["to_call"] - s["bet"][i]
        return self._act(room, s, i, "check" if owe <= 0 else "fold", {})

    def skip_label(self, room, s):
        if s.get("phase") == "between":
            return "the wait for the next hand"
        return f"{self.seat_name(room, s, s.get('turn'))}'s turn (check or fold)"

    # ---- View ------------------------------------------------------------------------------
    def game_view(self, room, s, seat):
        if not s["started"]:
            return {}
        n = len(s["seats"])
        live_pots = self._pots(s, live=True) if s["phase"] == "betting" else []
        players = []
        for i in range(n):
            visible = s["hands"][i] is not None and (i == seat or s["shown"][i])
            players.append({
                "chips": s["chips"][i], "bet": s["bet"][i], "put": s["put"][i], "folded": s["folded"][i],
                "allin": s["allin"][i], "out": s["out"][i], "action": s["last_action"][i],
                "cards": s["hands"][i] if visible else (None if s["hands"][i] is None or s["folded"][i] else ["??", "??"]),
            })
        me = {}
        if seat is not None and s["phase"] == "betting" and seat == s["turn"]:
            owe = s["to_call"] - s["bet"][seat]
            stack = s["chips"][seat]
            max_to = s["bet"][seat] + stack
            min_to = min(s["to_call"] + s["min_raise"], max_to)
            blocked = bool(s.get("no_reraise")) and seat in s["no_reraise"] and s["acted"][seat]
            me = {"owe": max(0, owe), "callAmount": min(max(0, owe), stack), "minTo": min_to, "maxTo": max_to,
                  "canRaise": max_to > s["to_call"] and not blocked, "canCheck": owe <= 0}
        return {
            "table": players, "board": s["board"], "dealer": s["dealer"], "turn": s["turn"],
            "sb": s.get("sb"), "bb": s.get("bb"), "street": s["street"], "phase": s["phase"],
            "pot": sum(s["put"]), "pots": [p["amount"] for p in live_pots], "toCall": s["to_call"],
            "big": s["big"], "handNo": s["hand"], "results": s["results"], "me": me,
            "nextIn": max(0, round(s["next_at"] - time.time(), 1)) if s["phase"] == "between" and s["next_at"] else None,
        }


def pretty(card):
    return card[0].replace("T", "10") + {"s": "♠", "h": "♥", "d": "♦", "c": "♣"}[card[1]]
