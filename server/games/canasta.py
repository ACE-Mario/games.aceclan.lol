"""Canasta rules for live rooms (classic rules).

Two packs plus four jokers. Four players play as two partnerships (seats 1 and 3 against 2 and
4); two or three players play for themselves. The server deals, keeps every hand private, and
checks melds, the minimum first meld, the frozen pile and going out.

Cards are "<rank><suit>:<n>" like "Ks:0" or "Ks:1" (two packs), and jokers are "JK:0" to "JK:3".
A "side" is a partnership (4 players) or a single player (2 or 3 players).
"""
import random

from .base import SeatedGame

NATURAL = "456789TJQKA"                 # ranks you can meld (plus black 3s when going out)
ORDER = "3456789TJQKA2"                 # for sorting a hand
VALUES = {"JK": 50, "2": 20, "A": 20, "K": 10, "Q": 10, "J": 10, "T": 10, "9": 10, "8": 10,
          "7": 5, "6": 5, "5": 5, "4": 5, "3": 5}
RANK_NAME = {"A": "Aces", "K": "Kings", "Q": "Queens", "J": "Jacks", "T": "10s", "3": "black 3s"}


def rank(c):
    return "JK" if c.startswith("JK") else c[0]


def wild(c):
    return rank(c) in ("JK", "2")


def red3(c):
    return c[0] == "3" and c[1] in "hd"


def black3(c):
    return c[0] == "3" and c[1] in "sc"


def value(c):
    return VALUES[rank(c)]


def rank_name(r):
    return RANK_NAME.get(r, r + "s")


def sort_key(c):
    return (ORDER.index(rank(c)) if rank(c) != "JK" else 99, c)


def min_meld(score):
    if score < 0:
        return 15
    if score < 1500:
        return 50
    if score < 3000:
        return 90
    return 120


class Canasta(SeatedGame):
    id = "canasta"
    name = "Canasta"
    min_players = 2
    max_players = 4
    teams = {"A": "Team A", "B": "Team B"}
    lobby_text = "Take a seat: 4 players play in two teams of 2; 2 or 3 play for themselves."
    options = {
        "target": [("5000", "First to 5,000"), ("2500", "First to 2,500"), ("1500", "First to 1,500")],
    }

    def check_start(self, room, pids):
        err = super().check_start(room, pids)
        if err:
            return err
        if len(pids) == 4:
            for t, label in self.teams.items():
                if sum(1 for q in pids if room.players[q].get("team") == t) != 2:
                    return f"With 4 players, each team needs 2 people. Fix {label} in the Players panel."
        return None

    # ---- Sides -------------------------------------------------------------------------------
    def side(self, s, seat):
        return seat % 2 if len(s["seats"]) == 4 else seat

    def n_sides(self, s):
        return 2 if len(s["seats"]) == 4 else len(s["seats"])

    def side_name(self, room, s, side):
        if len(s["seats"]) == 4:
            return " & ".join(self.seat_name(room, s, i) for i in range(4) if i % 2 == side)
        return self.seat_name(room, s, side)

    def canastas_needed(self, s):
        return 2 if len(s["seats"]) == 2 else 1

    # ---- Dealing -----------------------------------------------------------------------------
    def begin(self, room, s):
        n = self.n_sides(s)
        s.update({"scores": [0] * n, "hand_no": 0, "dealer": random.randrange(len(s["seats"])), "last": None})
        self._deal(room, s)
        if len(s["seats"]) == 4:
            self._log(s, f"Teams: {self.side_name(room, s, 0)} against {self.side_name(room, s, 1)}.", "go")
        return None

    def _deal(self, room, s):
        seats = len(s["seats"])
        deck = [r + u + f":{d}" for d in (0, 1) for r in "23456789TJQKA" for u in "shdc"] + [f"JK:{i}" for i in range(4)]
        random.shuffle(deck)
        per = {2: 15, 3: 13, 4: 11}[seats]
        s["hand_no"] += 1
        s["dealer"] = (s["dealer"] + 1) % seats
        s["hands"] = [[deck.pop() for _ in range(per)] for _ in range(seats)]
        s["stock"] = deck
        s["melds"] = [[] for _ in range(self.n_sides(s))]          # per side: [{"rank", "cards"}]
        s["red3"] = [[] for _ in range(self.n_sides(s))]
        s["melded"] = [False] * seats                                 # has this player melded this hand?
        s["phase"] = "draw"
        s["went_out"] = None
        s["last"] = None
        for i in range(seats):
            self._lay_red_threes(room, s, i, quiet=True)
        pile = [s["stock"].pop()]
        while wild(pile[-1]) or red3(pile[-1]):                       # a wild or red 3 upcard freezes the pile
            pile.append(s["stock"].pop())
        s["pile"] = pile
        s["turn"] = (s["dealer"] + 1) % seats
        s["melded_before"] = False
        self._log(s, f"Hand {s['hand_no']} dealt ({per} cards each). {self.seat_name(room, s, s['turn'])} goes first.", "go")

    def _lay_red_threes(self, room, s, seat, quiet=False):
        """Red 3s go face up straight away, and you draw a replacement for each."""
        hand = s["hands"][seat]
        while True:
            threes = [c for c in hand if red3(c)]
            if not threes:
                break
            for c in threes:
                hand.remove(c)
                s["red3"][self.side(s, seat)].append(c)
                if not quiet:
                    self._log(s, f"{self.seat_name(room, s, seat)} lays down a red 3.")
                if s["stock"]:
                    hand.append(s["stock"].pop())

    # ---- Meld checks ------------------------------------------------------------------------
    def frozen(self, s):
        return any(wild(c) or red3(c) for c in s["pile"])

    def _check_group(self, cards, existing, going_out):
        """Is this group of cards a valid new meld, or a valid addition to `existing`?
        Returns (rank, error)."""
        naturals = [c for c in cards if not wild(c)]
        wilds = [c for c in cards if wild(c)]
        ranks = {rank(c) for c in naturals}
        if len(ranks) > 1:
            return None, "A meld is cards of one rank (plus wild cards)."
        r = next(iter(ranks), None)
        if r == "3":
            if any(red3(c) for c in naturals):
                return None, "Red 3s can't be melded."
            if wilds:
                return None, "A meld of black 3s can't have wild cards."
            if not going_out:
                return None, "Black 3s can only be melded when you go out."
            if existing or len(naturals) < 3:
                return None, "Black 3s need 3 or 4 together, melded as you go out."
            return "3", None
        if existing:
            if r and r != existing["rank"]:
                return None, "Those cards don't match that meld."
            nat = sum(1 for c in existing["cards"] if not wild(c)) + len(naturals)
            wl = sum(1 for c in existing["cards"] if wild(c)) + len(wilds)
            if wl > 3:
                return None, "A meld can have at most 3 wild cards."
            if wl > nat:
                return None, "A meld can't have more wild cards than natural ones."
            return existing["rank"], None
        if r is None:
            return None, "A new meld needs at least two natural cards."
        if len(naturals) < 2:
            return None, f"A new meld of {rank_name(r)} needs at least two natural {rank_name(r)}."
        if len(cards) < 3:
            return None, "A new meld needs at least 3 cards."
        if len(wilds) > 3:
            return None, "A meld can have at most 3 wild cards."
        if len(wilds) > len(naturals):
            return None, "A meld can't have more wild cards than natural ones."
        return r, None

    def _plan(self, s, seat, groups, extra=None):
        """Check a set of meld groups from this player's hand (plus `extra`, the pile's top card).
        Returns (plan, used cards, error). plan = [(rank, cards, existing meld or None)]."""
        hand = list(s["hands"][seat])
        sd = self.side(s, seat)
        if not isinstance(groups, list) or not groups:
            return None, None, "Pick some cards to meld."
        used, plan = [], []
        for g in groups:
            if not isinstance(g, dict) or not isinstance(g.get("cards"), list) or not g["cards"]:
                return None, None, "Pick some cards to meld."
            for c in g["cards"]:
                c = str(c)
                if c == extra:
                    continue
                if c not in hand or c in used:
                    return None, None, "You don't have one of those cards."
                used.append(c)
        hand_after = len(hand) - len(used)
        going_out = hand_after <= 1
        ranks_this_turn = {}
        for g in groups:
            cards = [str(c) for c in g["cards"]]
            want = str(g.get("rank") or "")
            naturals = [c for c in cards if not wild(c)]
            r = rank(naturals[0]) if naturals else want
            existing = next((m for m in s["melds"][sd] if m["rank"] == r), None)
            if r in ranks_this_turn:                                 # two groups of the same rank: merge
                prev = ranks_this_turn[r]
                prev[1].extend(cards)
                continue
            if not naturals and not existing:
                return None, None, "Wild cards on their own have to go on one of your melds."
            got, err = self._check_group(cards, existing, going_out)
            if err:
                return None, None, err
            entry = [got, cards, existing]
            ranks_this_turn[got] = entry
            plan.append(entry)
        for got, cards, existing in plan:                           # recheck merged groups
            if len(cards) > 1 or existing is None:
                _, err = self._check_group(cards, existing, going_out)
                if err:
                    return None, None, err
        return plan, used, None

    def _apply(self, room, s, seat, plan, used):
        sd = self.side(s, seat)
        for c in used:
            s["hands"][seat].remove(c)
        for r, cards, existing in plan:
            if existing:
                existing["cards"].extend(cards)
            else:
                s["melds"][sd].append({"rank": r, "cards": list(cards)})
        s["melds"][sd].sort(key=lambda m: ORDER.index(m["rank"]))
        s["melded"][seat] = True

    def _apply_checked(self, s, seat, plan, used, left):
        """Put the melds down, then undo them if they break the going-out rules: melding down to
        one card or none, or melding black 3s, is going out, which needs the canasta(s)."""
        sd = self.side(s, seat)
        before_melds = [dict(m, cards=list(m["cards"])) for m in s["melds"][sd]]
        before_hand = list(s["hands"][seat])
        before_flag = s["melded"][seat]
        self._apply(None, s, seat, plan, used)
        if left <= 1 or any(r == "3" for r, cards, ex in plan):
            err = self._can_go_out(s, seat)
            if err:
                s["melds"][sd] = before_melds
                s["hands"][seat] = before_hand
                s["melded"][seat] = before_flag
                if left <= 1:
                    err += " Keep at least two cards in your hand until then."
                return err
        return None

    def canastas(self, s, sd):
        return sum(1 for m in s["melds"][sd] if len(m["cards"]) >= 7)

    def _initial_ok(self, s, seat, plan):
        sd = self.side(s, seat)
        if s["melds"][sd]:
            return None
        need = min_meld(s["scores"][sd])
        total = sum(value(c) for r, cards, ex in plan for c in cards)
        if total < need:
            return f"Your first meld must be worth at least {need} points (that's {total})."
        return None

    def _can_go_out(self, s, seat):
        sd = self.side(s, seat)
        need = self.canastas_needed(s)
        if self.canastas(s, sd) < need:
            return f"You need {'a canasta' if need == 1 else f'{need} canastas'} before you can go out."
        return None

    # ---- Actions -----------------------------------------------------------------------------
    def play(self, room, s, seat, action, data):
        if action == "next_hand":
            if s["phase"] != "between":
                return "The hand isn't over yet."
            self._deal(room, s)
            return None
        if s["phase"] == "between":
            return "The hand is over. Deal the next one."
        if seat != s["turn"]:
            return f"It's {self.seat_name(room, s, s['turn'])}'s turn."
        name = self.seat_name(room, s, seat)
        hand = s["hands"][seat]
        sd = self.side(s, seat)

        if action == "draw":
            if s["phase"] != "draw":
                return "You've already drawn this turn."
            if not s["stock"]:
                self._end_hand(room, s, None, "The stock ran out.")
                return None
            n = 2 if len(s["seats"]) == 2 else 1
            for _ in range(n):
                if s["stock"]:
                    hand.append(s["stock"].pop())
            self._lay_red_threes(room, s, seat)
            s["phase"] = "play"
            self._log(s, f"{name} draws from the stock.")
            return None

        if action == "take":
            if s["phase"] != "draw":
                return "You've already drawn this turn."
            if not s["pile"]:
                return "The discard pile is empty."
            top = s["pile"][-1]
            if wild(top):
                return "You can't take the pile when a wild card is on top."
            if rank(top) == "3":
                return "You can't take the pile when a 3 is on top."
            groups = data.get("groups")
            if not isinstance(groups, list) or not any(isinstance(g, dict) and top in [str(c) for c in g.get("cards", [])] for g in groups):
                return "To take the pile, meld its top card: select it with cards from your hand."
            plan, used, err = self._plan(s, seat, groups, extra=top)
            if err:
                return err
            frozen = self.frozen(s) or not s["melds"][sd]
            top_group = next(e for e in plan if top in e[1])
            from_hand = [c for c in top_group[1] if c != top]
            if frozen and sum(1 for c in from_hand if not wild(c) and rank(c) == rank(top)) < 2:
                why = "the pile is frozen" if self.frozen(s) else "your side hasn't melded yet"
                return f"You need two natural {rank_name(rank(top))} from your hand to take the pile ({why})."
            err = self._initial_ok(s, seat, plan)
            if err:
                return err
            pile = s["pile"][:-1]
            err = self._apply_checked(s, seat, plan, used, len(hand) - len(used) + len(pile))
            if err:
                return err
            s["pile"] = []
            for c in pile:
                if red3(c):
                    s["red3"][sd].append(c)
                else:
                    hand.append(c)
            s["phase"] = "play"
            self._log(s, f"{name} takes the pile ({len(pile) + 1} cards) with {rank_name(rank(top))}.", "go")
            if not hand:
                self._end_hand(room, s, seat, f"{name} goes out!")
            return None

        if action == "meld":
            if s["phase"] != "play":
                return "Draw first."
            plan, used, err = self._plan(s, seat, data.get("groups"))
            if err:
                return err
            err = self._initial_ok(s, seat, plan)
            if err:
                return err
            err = self._apply_checked(s, seat, plan, used, len(hand) - len(used))
            if err:
                return err
            desc = ", ".join(f"{len(cards)} {rank_name(r)}" for r, cards, ex in plan)
            self._log(s, f"{name} melds {desc}.")
            for r, cards, ex in plan:
                m = next(m for m in s["melds"][sd] if m["rank"] == r)
                if len(m["cards"]) >= 7 and len(m["cards"]) - len(cards) < 7:
                    kind = "natural" if not any(wild(c) for c in m["cards"]) else "mixed"
                    self._log(s, f"Canasta! {self.side_name(room, s, sd)} complete a {kind} canasta of {rank_name(r)}.", "win")
            if not hand:
                self._end_hand(room, s, seat, f"{name} goes out!")
            return None

        if action == "discard":
            if s["phase"] != "play":
                return "Draw first."
            card = str(data.get("card", ""))
            if card not in hand:
                return "Pick a card from your hand to discard."
            if len(hand) == 1:
                err = self._can_go_out(s, seat)
                if err:
                    return err
            hand.remove(card)
            s["pile"].append(card)
            what = "a wild card, freezing the pile" if wild(card) else ("a black 3, blocking the pile" if black3(card) else None)
            self._log(s, f"{name} discards " + (what or pretty(card)) + ".", "bad" if what else "")
            if not hand:
                self._end_hand(room, s, seat, f"{name} goes out!")
                return None
            self._pass(s, seat)
            return None

        return "Unknown action."

    def skip(self, room, s):
        if s["phase"] == "between":
            self._deal(room, s)
            return None
        seat = s["turn"]
        if s["phase"] == "play":
            # They drew already: throw away their lowest non-wild card for them.
            hand = s["hands"][seat]
            plain = [c for c in hand if not wild(c)] or hand
            card = min(plain, key=value)
            hand.remove(card)
            s["pile"].append(card)
            self._log(s, f"{self.seat_name(room, s, seat)} discards {pretty(card)}.")
        self._pass(s, seat)
        return None

    def _pass(self, s, seat):
        s["turn"] = (seat + 1) % len(s["seats"])
        s["phase"] = "draw"
        s["melded_before"] = s["melded"][s["turn"]]

    def skip_label(self, room, s):
        if s.get("phase") == "between":
            return "to the next hand"
        return f"{self.seat_name(room, s, s.get('turn'))}'s turn"

    # ---- Scoring -----------------------------------------------------------------------------
    def _end_hand(self, room, s, out_seat, why):
        self._log(s, why, "win" if out_seat is not None else "")
        rows = []
        for sd in range(self.n_sides(s)):
            melds = s["melds"][sd]
            cards = sum(value(c) for m in melds for c in m["cards"])
            bonus = 0
            for m in melds:
                if len(m["cards"]) >= 7:
                    bonus += 500 if not any(wild(c) for c in m["cards"]) else 300
            r3 = len(s["red3"][sd])
            red = 800 if r3 == 4 else 100 * r3
            if not melds:
                red = -red
            out = 0
            if out_seat is not None and self.side(s, out_seat) == sd:
                out = 100 if s.get("melded_before") else 200     # 200 for going out concealed
            in_hand = -sum(value(c) for i in range(len(s["seats"])) if self.side(s, i) == sd for c in s["hands"][i])
            total = cards + bonus + red + out + in_hand
            s["scores"][sd] += total
            rows.append({"side": sd, "name": self.side_name(room, s, sd), "melds": cards, "canastas": bonus,
                         "red3": red, "out": out, "hand": in_hand, "total": total, "score": s["scores"][sd]})
            self._log(s, f"{self.side_name(room, s, sd)}: {total:+,} this hand, {s['scores'][sd]:,} in all.")
        s["last"] = rows
        s["phase"] = "between"
        s["went_out"] = out_seat
        target = int(s["options"]["target"])
        best = max(s["scores"])
        if best >= target:
            winners = [i for i, v in enumerate(s["scores"]) if v == best]
            names = " and ".join(self.side_name(room, s, w) for w in winners)
            verb = "win" if len(winners) > 1 or len(s["seats"]) == 4 else "wins"
            self.finish(s, winners[0], f"{names} {verb} with {best:,} points!")

    # ---- View --------------------------------------------------------------------------------
    def game_view(self, room, s, seat):
        if not s["started"]:
            return {}
        n = len(s["seats"])
        my_side = self.side(s, seat) if seat is not None else None
        show_all = s["phase"] == "between" or s["over"]
        return {
            "hand": sorted(s["hands"][seat], key=sort_key) if seat is not None else None,
            "counts": [len(h) for h in s["hands"]],
            "hands": [sorted(h, key=sort_key) for h in s["hands"]] if show_all else None,
            "sides": [[i for i in range(n) if self.side(s, i) == sd] for sd in range(self.n_sides(s))],
            "mySide": my_side, "melds": s["melds"], "red3": s["red3"], "scores": s["scores"],
            "canastas": [self.canastas(s, sd) for sd in range(self.n_sides(s))],
            "stock": len(s["stock"]), "pileTop": s["pile"][-1] if s["pile"] else None, "pileSize": len(s["pile"]),
            "frozen": self.frozen(s), "turn": s["turn"], "phase": s["phase"], "handNo": s["hand_no"],
            "minMeld": [min_meld(v) if not s["melds"][sd] else 0 for sd, v in enumerate(s["scores"])],
            "needCanastas": self.canastas_needed(s), "last": s["last"], "target": int(s["options"]["target"]),
            "wentOut": s["went_out"],
        }


def pretty(c):
    if rank(c) == "JK":
        return "a joker"
    return (c[0].replace("T", "10")) + {"s": "♠", "h": "♥", "d": "♦", "c": "♣"}[c[1]]
