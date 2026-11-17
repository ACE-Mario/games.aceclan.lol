"""Shared room rules for the seated games (poker, trivia, canasta, snakes & ladders).

Each player in a room is either playing (role "player") or watching (role None). In the lobby
anyone can take a seat or step out; the leader presses Start, which fixes the seat order for
the game. Game state refers to players by seat number (0, 1, 2 ...) and `s["seats"]` maps seat
numbers to player ids, so the leader can hand an away player's seat to a watcher mid-game
without the game losing track of anything.

A game subclasses SeatedGame and fills in:
    options         {key: [(value, label), ...]} the leader can pick from (first is the default)
    begin(room, s)  deal / set up when the leader presses Start
    play(room, s, seat, action, data)   one move by the player in `seat`; return an error or None
    game_view(room, s, seat)            what that seat may see (seat is None for watchers)
    skip(room, s)   optional: the leader's "Skip turn" for someone who has gone away
"""
import random


class SeatedGame:
    id = ""
    name = ""
    min_players = 2
    max_players = 6
    teams = None          # e.g. {"A": "Team A", "B": "Team B"} for partnership games
    late_join = False     # True: people can take a seat while a game is running (trivia)
    options = {}
    lobby_text = "Take a seat, then the leader starts the game."

    # ---- Log ---------------------------------------------------------------------------
    def _log(self, s, text, kind=""):
        s["log"].append({"text": text, "kind": kind})
        del s["log"][:-120]

    # ---- State -------------------------------------------------------------------------
    def clean_options(self, options, old=None):
        out = {}
        for key, choices in self.options.items():
            allowed = [str(v) for v, _ in choices]
            want = str((options or {}).get(key, ""))
            if want in allowed:
                out[key] = want
            elif old and str(old.get(key)) in allowed:
                out[key] = str(old[key])
            else:
                out[key] = allowed[0]
        return out

    def new_state(self, options=None, old=None):
        return {
            "started": False, "over": False, "winner": None, "result": "",
            "options": self.clean_options(options, old.get("options") if old else None),
            "seats": [], "log": [{"text": self.lobby_text, "kind": ""}],
        }

    def in_game(self, s):
        return s["started"] and not s["over"]

    def seat_of(self, s, pid):
        return s["seats"].index(pid) if pid in s["seats"] else None

    def seat_name(self, room, s, seat):
        pid = s["seats"][seat] if seat is not None and 0 <= seat < len(s["seats"]) else None
        return room.players.get(pid, {}).get("name", "Someone")

    def playing(self, room):
        return [pid for pid, p in room.players.items() if p.get("role") == "player"]

    # ---- Seats -------------------------------------------------------------------------
    def default_seat(self, room):
        """New players sit down if there's room. Mid-game they watch until the leader gives
        them a seat (except in late-join games like trivia)."""
        s = room.state
        if (self.in_game(s) and not self.late_join) or len(self.playing(room)) >= self.max_players:
            return {"role": None, "team": None}
        return {"role": "player", "team": self.pick_team(room) if self.teams else None}

    def pick_team(self, room, exclude=None):
        counts = {t: sum(1 for q, p in room.players.items()
                         if q != exclude and p.get("role") == "player" and p.get("team") == t)
                  for t in self.teams}
        return min(self.teams, key=lambda t: (counts[t], random.random()))

    def seat_order(self, room, pids):
        """Seat order for a new game: random, but with teams alternating round the table."""
        random.shuffle(pids)
        if not self.teams:
            return pids
        groups = [[q for q in pids if room.players[q].get("team") == t] for t in self.teams]
        order = []
        for i in range(max(len(g) for g in groups)):
            for g in groups:
                if i < len(g):
                    order.append(g[i])
        return order

    def check_start(self, room, pids):
        """Return an error if these players can't start a game."""
        if len(pids) < self.min_players:
            return f"{self.name} needs at least {self.min_players} players with a seat."
        if len(pids) > self.max_players:
            return f"{self.name} has room for {self.max_players} players. Ask someone to watch."
        return None

    # ---- Actions -----------------------------------------------------------------------
    def handle(self, room, pid, action, data):
        s = room.state
        me = room.players[pid]
        name = me["name"]
        leader = room.is_host(pid)

        if action == "seat":
            if self.in_game(s) and not self.late_join:
                return "The game is on. Ask the leader if you want a seat."
            play = bool(data.get("play"))
            if play and me.get("role") != "player" and len(self.playing(room)) >= self.max_players:
                return f"All {self.max_players} seats are taken."
            me["role"] = "player" if play else None
            if self.teams:
                team = data.get("team")
                me["team"] = team if team in self.teams else (me.get("team") if me.get("team") in self.teams
                                                               else self.pick_team(room, pid))
                if not play:
                    me["team"] = None
            if self.late_join and play:
                self.joined(room, s, pid)
            return None

        if action in ("admin_seat", "admin_give_seat", "admin_skip", "admin_end"):
            if not leader:
                return "Only the leader can use the admin panel."

        if action == "admin_seat":
            target = room.players.get(str(data.get("player", "")))
            if not target:
                return "That player isn't in this room any more."
            if self.in_game(s) and not self.late_join:
                return "The game is on. Use Give seat to swap someone in for a player."
            play = bool(data.get("play"))
            if play and target.get("role") != "player" and len(self.playing(room)) >= self.max_players:
                return f"All {self.max_players} seats are taken."
            target["role"] = "player" if play else None
            if self.teams:
                team = data.get("team")
                target["team"] = (team if team in self.teams else self.pick_team(room, str(data.get("player")))) if play else None
            where = "watching"
            if play:
                where = f"{self.teams[target['team']]}" if self.teams else "a seat"
            self._log(s, f"[Admin] {name} moved {target['name']} to {where}.", "admin")
            if self.late_join and play:
                self.joined(room, s, str(data.get("player")))
            return None

        if action == "admin_give_seat":
            if not self.in_game(s):
                return "Give seat is for swapping players during a game."
            tid = str(data.get("player", ""))
            target = room.players.get(tid)
            if not target:
                return "That player isn't in this room any more."
            if tid in s["seats"]:
                return f"{target['name']} already has a seat in this game."
            try:
                seat = int(data.get("seat"))
            except (TypeError, ValueError):
                return "Pick a seat."
            if not 0 <= seat < len(s["seats"]):
                return "Pick a seat."
            old = room.players.get(s["seats"][seat])
            old_name = self.seat_name(room, s, seat)
            s["seats"][seat] = tid
            target["role"] = "player"
            if old:
                target["team"] = old.get("team")
                old["role"], old["team"] = None, None
            self._log(s, f"[Admin] {name} gave {old_name}'s seat to {target['name']}.", "admin")
            return None

        if action == "admin_skip":
            if not self.in_game(s):
                return "There's no game on."
            what = self.skip_label(room, s)
            mark = len(s["log"])
            err = self.skip(room, s)
            if not err:                       # put the admin line before whatever the skip logged
                s["log"].insert(min(mark, len(s["log"])), {"text": f"[Admin] {name} skipped {what}.", "kind": "admin"})
            return err

        if action == "admin_end":
            if not self.in_game(s):
                return "There's no game on."
            s["over"] = True
            s["result"] = "The leader ended the game."
            self._log(s, f"[Admin] {name} ended the game.", "admin")
            return None

        if action == "new_game":
            if not leader:
                return "Only the leader can set up a new game."
            if self.in_game(s) and not data.get("confirm"):
                return "A game is still on. End it from the admin panel first."
            room.state = self.new_state(data.get("options"), old=s)
            return None

        if action == "start":
            if not leader:
                return "Only the leader can start the game."
            if self.in_game(s):
                return "The game has already started."
            pids = self.playing(room)
            err = self.check_start(room, pids)
            if err:
                return err
            if s["started"]:                      # a finished game: deal a fresh one, same options
                room.state = s = self.new_state(data.get("options"), old=s)
            elif data.get("options"):
                s["options"] = self.clean_options(data.get("options"), s["options"])
            s["seats"] = self.seat_order(room, pids)
            s["started"] = True
            err = self.begin(room, s)
            if err:
                s["started"] = False
                s["seats"] = []
                return err
            return None

        if not s["started"]:
            return "The game hasn't started yet. Waiting for the leader."
        if s["over"]:
            return "This game is over. The leader can start a new one."
        seat = self.seat_of(s, pid)
        if seat is None and not self.late_join:
            return "You're watching this game."
        # Late-join games (trivia) keep scores by player id, the others by seat number.
        return self.play(room, s, pid if self.late_join else seat, action, data)

    # ---- Hooks (games override these) ----------------------------------------------------
    def begin(self, room, s):
        return None

    def play(self, room, s, seat, action, data):
        return "Unknown action."

    def skip(self, room, s):
        return "This game has no turns to skip."

    def skip_label(self, room, s):
        turn = s.get("turn")
        return f"{self.seat_name(room, s, turn)}'s turn" if isinstance(turn, int) else "a turn"

    def joined(self, room, s, pid):
        pass

    def game_view(self, room, s, seat):
        return {}

    def finish(self, s, winner, result, kind="win"):
        s["over"] = True
        s["winner"] = winner
        s["result"] = result
        self._log(s, result, kind)

    # ---- View ----------------------------------------------------------------------------
    def view(self, room, pid):
        s = room.state
        seat = self.seat_of(s, pid)
        out = {
            "started": s["started"], "over": s["over"], "winner": s["winner"], "result": s["result"],
            "options": s["options"],
            "choices": {k: [[str(v), label] for v, label in c] for k, c in self.options.items()},
            "seats": [{"id": q, "name": room.players.get(q, {}).get("name", "Someone"),
                       "online": bool(room.players.get(q, {}).get("sids")),
                       "team": room.players.get(q, {}).get("team")} for q in s["seats"]],
            "mySeat": seat, "log": s["log"][-80:],
            "minPlayers": self.min_players, "maxPlayers": self.max_players,
            "teams": self.teams, "lateJoin": self.late_join,
        }
        out.update(self.game_view(room, s, pid if self.late_join else seat))
        return out
