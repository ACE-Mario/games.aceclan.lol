"""Town of ACE: a social deduction game (Werewolf / Town of Salem style), run by the server.

Every player gets a secret role. At night the wolves pick someone to kill while the town's special
roles act (the Seer checks someone, the Healer protects someone, and so on). By day everyone talks,
accuses, and can put someone on trial: the accused gets a defence, then the living vote guilty or
innocent. The town wins when every wolf is dead; the wolves win once they match the rest in number.

The server is the only one who knows the roles. Each player's view holds their own role, what they
learned at night, and (for wolves) who the other wolves are; nothing else secret leaves the server
until the game ends. Everything is kept by seat number (see base.SeatedGame), so the leader can hand
an away player's seat, role and all, to a watcher or a bot.

Phases: night -> dawn -> day (-> defence -> judgement -> verdict, up to 3 trials a day) -> night ...
with a "hunter" phase whenever a Hunter dies and gets their last shot.
"""
import random
import re
import time

from .base import SeatedGame

DAWN_SECONDS = 8
DEFENCE_SECONDS = 20
JUDGE_SECONDS = 15
VERDICT_SECONDS = 7
HUNTER_SECONDS = 20
MAX_TRIALS = 3
MAYOR_VOTES = 3
WILL_LEN = 400

ROLES = {
    "villager": {"name": "Villager", "team": "town", "act": None,
                 "about": "No night power, just your wits and your vote. Find the wolves and vote them out."},
    "seer": {"name": "Seer", "team": "town", "act": "check",
             "about": "Each night, pick a player to check. You learn whether they're on the wolves' side."},
    "healer": {"name": "Healer", "team": "town", "act": "heal",
               "about": "Each night, protect a player from being killed. Not the same person two nights running; "
                        "yourself only once."},
    "hunter": {"name": "Hunter", "team": "town", "act": None,
               "about": "No night power, but when you die (night or day) you get one last shot: take someone with you."},
    "lookout": {"name": "Lookout", "team": "town", "act": "watch",
                "about": "Each night, watch a player's house. You see everyone who visited them."},
    "stunner": {"name": "Stunner", "team": "town", "act": "stun",
                "about": "Each night, stun a player so their night power fails. A stunned wolf's kill vote doesn't count."},
    "mayor": {"name": "Mayor", "team": "town", "act": None,
              "about": f"By day you can reveal yourself as the Mayor. After that your vote counts {MAYOR_VOTES} times, "
                       "but everyone knows who you are."},
    "wolf": {"name": "Werewolf", "team": "wolves", "act": "kill",
             "about": "Each night the wolves agree on one player to kill. By day, blend in and steer the votes."},
    "alpha": {"name": "Alpha Wolf", "team": "wolves", "act": "kill",
              "about": "A wolf who looks innocent: the Seer sees you as one of the town."},
    "jester": {"name": "Jester", "team": "neutral", "act": None,
               "about": "You win if the town votes to execute you. Act suspicious, but not too suspicious."},
}
ACT_WORDS = {"check": "Check", "heal": "Protect", "watch": "Watch", "stun": "Stun", "kill": "Kill"}
EXTRAS = ["hunter", "jester", "lookout", "stunner", "mayor", "alpha"]
GOALS = {"town": "Find and execute every wolf.",
         "wolves": "Kill until the wolves match the rest of the town in number.",
         "neutral": "Get yourself executed by the town."}


def wolf_count(n):
    return max(1, min(5, round(n / 3.5)))


def deal(n, wolves, extras):
    """Roles for n players: the wolves, a Seer and a Healer, then the extras ticked (as many as fit
    while keeping some plain villagers), and villagers for the rest."""
    w = wolf_count(n) if wolves == "auto" else max(1, min(int(wolves), (n - 1) // 2))
    roles = ["wolf"] * w
    if "alpha" in extras and w >= 2:
        roles[0] = "alpha"
    town = n - w
    specials = ["seer"] + (["healer"] if n >= 5 else [])
    room = max(0, town - max(1, town // 3) - len(specials))         # keep about a third plain villagers
    picks = [e for e in EXTRAS if e in extras and e != "alpha"]
    random.shuffle(picks)
    specials += picks[:room]
    roles += specials[:town]
    roles += ["villager"] * (n - len(roles))
    random.shuffle(roles)
    return roles


class Town(SeatedGame):
    id = "town"
    name = "Town of ACE"
    min_players = 4
    max_players = 16
    bots = True
    multi = ("extras",)
    lobby_text = "Take a seat. Everyone gets a secret role when the leader starts."
    options = {
        "extras": [("hunter", "Hunter"), ("jester", "Jester"), ("lookout", "Lookout"), ("stunner", "Stunner"),
                   ("mayor", "Mayor"), ("alpha", "Alpha Wolf")],
        "wolves": [("auto", "Wolves: about 1 in 4"), ("1", "1 wolf"), ("2", "2 wolves"), ("3", "3 wolves"), ("4", "4 wolves")],
        "day": [("120", "2 minute days"), ("90", "90 second days"), ("180", "3 minute days"), ("300", "5 minute days"),
                ("60", "1 minute days")],
        "night": [("40", "40 second nights"), ("30", "30 second nights"), ("60", "1 minute nights")],
        "reveal": [("yes", "Show roles when people die"), ("no", "Keep roles hidden until the end")],
        "deadsee": [("no", "The dead see nothing extra"), ("yes", "The dead see everyone's role")],
        "firstkill": [("yes", "Wolves kill on night 1"), ("no", "No kill on night 1")],
    }

    # ---- Helpers -------------------------------------------------------------------------
    def _name(self, room, s, seat):
        return self.seat_name(room, s, seat)

    def _role(self, s, seat):
        return ROLES[s["roles"][seat]]

    def _team(self, s, seat):
        return self._role(s, seat)["team"]

    def _living(self, s):
        return [i for i, a in enumerate(s["alive"]) if a]

    def _wolves(self, s, alive=True):
        return [i for i in range(len(s["roles"])) if self._team(s, i) == "wolves" and (s["alive"][i] or not alive)]

    def _note(self, s, seat, text, kind=""):
        s["notes"][seat].append({"text": text, "kind": kind, "day": s["day"]})
        del s["notes"][seat][:-40]

    def _say(self, s, ch, text, kind="sys", seat=None, name=""):
        s["chat"].append({"ch": ch, "text": text, "kind": kind, "seat": seat, "name": name, "day": s["day"]})
        del s["chat"][:-200]

    def _weight(self, s, seat):
        return MAYOR_VOTES if s["mayor"] == seat else 1

    def _tally(self, s):
        out = {}
        for v, t in s["votes"].items():
            if s["alive"][v]:
                out[t] = out.get(t, 0) + self._weight(s, v)
        return out

    def _majority(self, s):
        total = sum(self._weight(s, i) for i in self._living(s))
        return total // 2 + 1

    def _set(self, s, phase, seconds, now):
        s["phase"] = phase
        s["until"] = now + seconds
        s["started_at"] = now
        s["bots_due"] = {}
        s["shorted"] = False

    # ---- Game flow -----------------------------------------------------------------------
    def begin(self, room, s):
        n = len(s["seats"])
        extras = s["options"]["extras"].split(",")
        s.update({
            "roles": deal(n, s["options"]["wolves"], extras), "alive": [True] * n, "deaths": [],
            "will": [""] * n, "notes": [[] for _ in range(n)], "chat": [], "day": 1,
            "acts": {}, "wolfPicks": {}, "votes": {}, "judge": {}, "lastJudge": None,
            "healLast": {}, "selfHealed": [], "seen": {}, "mayor": None, "hunters": [], "shot": [],
            "trials": 0, "accused": None, "dayLeft": 0, "after": "day", "lastNight": [],
            "phase": "", "until": 0, "started_at": 0, "bots_due": {}, "shorted": False,
            "dayLen": int(s["options"]["day"]), "nightLen": int(s["options"]["night"]),
        })
        for seat in range(n):
            role = self._role(s, seat)
            self._note(s, seat, f"You are the {role['name']}. {GOALS[role['team']]}", "role")
            if role["team"] == "wolves":
                mates = [self._name(room, s, w) for w in self._wolves(s) if w != seat]
                if mates:
                    self._note(s, seat, "Your pack: " + ", ".join(mates) + ".", "wolf")
        counts = {}
        for r in s["roles"]:
            counts[ROLES[r]["name"]] = counts.get(ROLES[r]["name"], 0) + 1
        s["setup"] = sorted(counts.items(), key=lambda kv: (kv[0] not in ("Werewolf", "Alpha Wolf"), kv[0]))
        self._log(s, f"Town of ACE: {n} players. In town tonight: " +
                  ", ".join(nm if c == 1 else f"{c} x {nm}" for nm, c in s["setup"]) + ".", "go")
        self._night(room, s, time.time())
        return None

    def _night(self, room, s, now):
        s["acts"], s["wolfPicks"], s["votes"], s["judge"], s["accused"] = {}, {}, {}, {}, None
        self._set(s, "night", s["nightLen"], now)
        self._log(s, f"Night {s['day']} falls. Everyone close your eyes...", "night")
        self._say(s, "town", f"Night {s['day']} falls.", "night")

    def _actors(self, s):
        """Living seats that have a night action tonight."""
        out = []
        for i in self._living(s):
            act = self._role(s, i)["act"]
            if not act:
                continue
            if act == "kill" and s["day"] == 1 and s["options"]["firstkill"] == "no":
                continue
            out.append(i)
        return out

    def _valid_target(self, s, seat, target):
        """None if `seat` may use their night power on `target`, else the reason why not."""
        role = s["roles"][seat]
        act = ROLES[role]["act"]
        if not isinstance(target, int) or not 0 <= target < len(s["roles"]) or not s["alive"][target]:
            return "Pick a living player."
        if act == "kill":
            if s["day"] == 1 and s["options"]["firstkill"] == "no":
                return "No kills on the first night."
            if self._team(s, target) == "wolves":
                return "That's one of your pack."
        elif act == "heal":
            if s["healLast"].get(seat) == target:
                return "You protected them last night. Pick someone else."
            if target == seat and seat in s["selfHealed"]:
                return "You've already protected yourself once."
        elif target == seat:
            return "Pick someone else."
        return None

    def _resolve_night(self, room, s, now):
        acts, picks = dict(s["acts"]), dict(s["wolfPicks"])
        stunned = set()
        for seat, t in acts.items():
            if s["roles"][seat] == "stunner" and s["alive"][seat]:
                stunned.add(t)
        for t in stunned:
            if self._role(s, t)["act"]:
                self._note(s, t, "You were stunned last night, so your power failed.", "bad")
        # Who went where (for the Lookout). Wolves "visit" the one they voted for.
        visits = {}
        for seat, t in acts.items():
            if seat not in stunned:
                visits.setdefault(t, []).append(seat)
        # The kill: the wolves' most-picked target (a stunned wolf's vote doesn't count).
        tally = {}
        for seat, t in picks.items():
            if seat in stunned or not s["alive"][seat]:
                continue
            tally[t] = tally.get(t, 0) + 1
        victim = None
        if tally:
            top = max(tally.values())
            victim = random.choice([t for t, c in tally.items() if c == top])
            killer = random.choice([w for w, t in picks.items() if t == victim and w not in stunned])
            visits.setdefault(victim, []).append(killer)
        heals = {}
        for seat, t in acts.items():
            if s["roles"][seat] == "healer" and seat not in stunned:
                heals.setdefault(t, []).append(seat)
                s["healLast"][seat] = t
                if t == seat and seat not in s["selfHealed"]:
                    s["selfHealed"].append(seat)
        for seat in list(s["healLast"]):
            if seat not in acts or seat in stunned:
                s["healLast"].pop(seat, None)
        dead = []
        if victim is not None:
            if victim in heals:
                self._note(s, victim, "The wolves attacked you last night, but someone nursed you back to health!", "good")
                for h in heals[victim]:
                    self._note(s, h, f"You saved {self._name(room, s, victim)} from an attack!", "good")
                for w in self._wolves(s):
                    self._note(s, w, f"Your attack on {self._name(room, s, victim)} failed. Someone protected them.", "bad")
            else:
                dead.append(victim)
        for seat, t in acts.items():
            if seat in stunned:
                continue
            role = s["roles"][seat]
            tn = self._name(room, s, t)
            if role == "seer":
                bad = s["roles"][t] in ("wolf",)
                if bad:
                    s["seen"].setdefault(seat, []).append(t)
                self._note(s, seat, f"{tn} is {'a WEREWOLF!' if bad else 'not a wolf.'}", "bad" if bad else "good")
            elif role == "lookout":
                who = [self._name(room, s, v) for v in visits.get(t, []) if v != seat]
                self._note(s, seat, f"Visitors to {tn}: " + (", ".join(who) if who else "nobody") + ".", "")
            elif role == "healer" and t not in [victim]:
                self._note(s, seat, f"You protected {tn}. Nobody attacked them.", "")
            elif role == "stunner":
                self._note(s, seat, f"You stunned {tn}.", "")
        s["lastNight"] = []
        for v in dead:
            self._kill(room, s, v, "the wolves", now)
            s["lastNight"].append(v)
        s["acts"], s["wolfPicks"] = {}, {}
        if dead:
            for v in dead:
                self._log(s, f"Dawn: {self._name(room, s, v)} was killed in the night{self._reveal_text(s, v)}.", "bad")
                self._say(s, "town", f"{self._name(room, s, v)} was found dead{self._reveal_text(s, v)}.", "death")
        else:
            self._log(s, "Dawn: nobody died last night.", "good")
            self._say(s, "town", "Nobody died last night.", "good")
        self._set(s, "dawn", DAWN_SECONDS, now)

    def _reveal_text(self, s, seat):
        return f". They were the {self._role(s, seat)['name']}" if s["options"]["reveal"] == "yes" else ""

    def _kill(self, room, s, seat, how, now):
        if not s["alive"][seat]:
            return
        s["alive"][seat] = False
        s["deaths"].append({"seat": seat, "day": s["day"], "how": how, "phase": s["phase"]})
        self._note(s, seat, f"You died ({how}). You can still chat with the other dead.", "bad")
        if s["roles"][seat] == "hunter" and seat not in s["shot"]:
            s["hunters"].append(seat)
        if s["mayor"] == seat:
            s["mayor"] = None
        s["votes"].pop(seat, None)
        s["votes"] = {k: v for k, v in s["votes"].items() if v != seat}
        s["acts"].pop(seat, None)
        s["wolfPicks"].pop(seat, None)

    def _winner(self, s):
        wolves = len(self._wolves(s))
        others = len(self._living(s)) - wolves
        if wolves == 0:
            return "town"
        if wolves >= others:
            return "wolves"
        return None

    def _end(self, room, s, who, why=""):
        s["phase"] = "done"
        if who == "town":
            text = "The town wins! Every wolf is dead."
        elif who == "wolves":
            text = "The wolves win! They've taken over the town."
        else:
            text = f"{why} The Jester wins!"
        roles = "; ".join(f"{self._name(room, s, i)}: {self._role(s, i)['name']}" for i in range(len(s["roles"])))
        self.finish(s, who, text)
        self._log(s, "Roles: " + roles + ".", "")
        self._say(s, "town", text, "win")

    def _after_deaths(self, room, s, nxt, now):
        """Someone died: let a Hunter shoot, check for a winner, then go on to `nxt` (day or night)."""
        if s["hunters"]:
            h = s["hunters"][0]
            s["after"] = nxt
            self._set(s, "hunter", HUNTER_SECONDS, now)
            self._say(s, "town", f"{self._name(room, s, h)} was the Hunter, and raises their bow for one last shot...", "death")
            return
        win = self._winner(s)
        if win:
            self._end(room, s, win)
            return
        if nxt == "day":
            self._day(room, s, now)
        else:
            s["day"] += 1
            self._night(room, s, now)

    def _day(self, room, s, now):
        s["votes"], s["trials"], s["accused"] = {}, 0, None
        s["dayLeft"] = s["dayLen"]
        self._set(s, "day", s["dayLen"], now)
        self._log(s, f"Day {s['day']}. Talk it out, and vote to put someone on trial.", "day")
        self._say(s, "town", f"Day {s['day']} begins. {self._majority(s)} votes put someone on trial.", "day")

    def _resume_day(self, room, s, now):
        s["votes"], s["accused"] = {}, None
        if s["trials"] >= MAX_TRIALS or s["dayLeft"] <= 1:
            self._say(s, "town", "The sun sets." + (" That's enough trials for one day." if s["trials"] >= MAX_TRIALS else ""), "night")
            s["day"] += 1
            self._night(room, s, now)
            return
        self._set(s, "day", s["dayLeft"], now)

    def _count_votes(self, room, s, now):
        """Day votes: a majority on one player puts them on trial; a majority to skip ends the day."""
        need = self._majority(s)
        tally = {}
        for seat, t in s["votes"].items():
            if s["alive"][seat]:
                tally[t] = tally.get(t, 0) + self._weight(s, seat)
        for t, c in tally.items():
            if c >= need:
                if t == "skip":
                    self._log(s, "The town voted to skip the day.", "")
                    self._say(s, "town", "The town decided not to vote anyone out today.", "night")
                    s["day"] += 1
                    self._night(room, s, now)
                else:
                    s["dayLeft"] = max(0, s["until"] - now)
                    s["accused"] = t
                    s["trials"] += 1
                    s["judge"] = {}
                    self._set(s, "defence", DEFENCE_SECONDS, now)
                    self._log(s, f"{self._name(room, s, t)} is on trial.", "")
                    self._say(s, "town", f"{self._name(room, s, t)} is on trial! What do you have to say for yourself?", "trial")
                return True
        return False

    def _verdict(self, room, s, now):
        t = s["accused"]
        g = sum(self._weight(s, v) for v, j in s["judge"].items() if j == "guilty" and s["alive"][v])
        i = sum(self._weight(s, v) for v, j in s["judge"].items() if j == "innocent" and s["alive"][v])
        names = lambda k: [self._name(room, s, v) for v, j in s["judge"].items() if j == k]
        s["lastJudge"] = {"seat": t, "guilty": g, "innocent": i, "g": names("guilty"), "i": names("innocent"),
                          "dead": g > i}
        tn = self._name(room, s, t)
        if g > i:
            self._kill(room, s, t, "executed by the town", now)
            self._log(s, f"{tn} was executed, {g} to {i}{self._reveal_text(s, t)}.", "bad")
            self._say(s, "town", f"{tn} was executed ({g} guilty, {i} innocent){self._reveal_text(s, t)}.", "death")
            if s["roles"][t] == "jester":
                self._set(s, "verdict", VERDICT_SECONDS, now)
                self._end(room, s, "jester", f"{tn} was the Jester, and the town fell for it.")
                return
        else:
            self._log(s, f"{tn} was found innocent, {i} to {g}.", "good")
            self._say(s, "town", f"{tn} was spared ({g} guilty, {i} innocent).", "good")
        self._set(s, "verdict", VERDICT_SECONDS, now)

    def _end_phase(self, room, s, now):
        ph = s["phase"]
        if ph == "night":
            self._resolve_night(room, s, now)
        elif ph == "dawn":
            self._after_deaths(room, s, "day", now)
        elif ph == "day":
            self._say(s, "town", "The sun sets. No one was put on trial.", "night")
            s["day"] += 1
            self._night(room, s, now)
        elif ph == "defence":
            self._set(s, "judgement", JUDGE_SECONDS, now)
            self._say(s, "town", f"Vote now: is {self._name(room, s, s['accused'])} guilty or innocent?", "trial")
        elif ph == "judgement":
            self._verdict(room, s, now)
        elif ph == "verdict":
            if s["lastJudge"] and s["lastJudge"]["dead"]:
                s["accused"] = None
                self._after_deaths(room, s, "night", now)
            else:
                self._resume_day(room, s, now)
        elif ph == "hunter":
            h = s["hunters"].pop(0)
            s["shot"].append(h)
            self._say(s, "town", f"{self._name(room, s, h)} lowered their bow without firing.", "")
            self._after_deaths(room, s, s["after"], now)

    def _shoot(self, room, s, h, t, now):
        s["hunters"].remove(h)
        s["shot"].append(h)
        hn, tn = self._name(room, s, h), self._name(room, s, t)
        self._kill(room, s, t, f"shot by {hn}", now)
        self._log(s, f"{hn} the Hunter shot {tn}{self._reveal_text(s, t)}.", "bad")
        self._say(s, "town", f"{hn} fired their last arrow at {tn}{self._reveal_text(s, t)}!", "death")
        self._after_deaths(room, s, s["after"], now)

    # ---- Clock and bots --------------------------------------------------------------------
    def tick(self, room, now):
        s = room.state
        if not self.in_game(s) or s.get("phase") in ("", "done"):
            return False
        changed = False
        if now >= s["until"]:
            self._end_phase(room, s, now)
            return True
        # Everyone who acts at night has picked: don't make them wait out the clock.
        if s["phase"] == "night" and not s["shorted"] and now - s["started_at"] > 6:
            actors = self._actors(s)
            done = all((i in s["wolfPicks"]) if self._role(s, i)["act"] == "kill" else (i in s["acts"]) for i in actors)
            if done and any(not self.is_bot(room, s["seats"][i]) for i in self._living(s)):
                s["until"] = min(s["until"], now + 4)
                s["shorted"] = True
                changed = True
        if s["phase"] == "judgement":
            voters = [i for i in self._living(s) if i != s["accused"]]
            if voters and all(v in s["judge"] for v in voters) and s["until"] - now > 2:
                s["until"] = now + 2
                changed = True
        changed = self._bots(room, s, now) or changed
        return changed

    def _bots(self, room, s, now):
        changed = False
        for seat in range(len(s["seats"])):
            if not self.is_bot(room, s["seats"][seat]):
                continue
            due = s["bots_due"].get(seat)
            if due == "done":
                continue
            if due is None:
                s["bots_due"][seat] = now + random.uniform(2, 7)
                continue
            if now < due:
                continue
            s["bots_due"][seat] = "done"                  # one move a phase
            changed = self._bot_move(room, s, seat, now) or changed
        return changed

    def _bot_move(self, room, s, seat, now):
        ph = s["phase"]
        alive = s["alive"][seat]
        wolf = self._team(s, seat) == "wolves"
        others = [i for i in self._living(s) if i != seat]
        if ph == "hunter" and s["hunters"] and s["hunters"][0] == seat:
            pool = [i for i in others if not (self._team(s, i) == "wolves") == wolf] or others
            if pool:
                self._shoot(room, s, seat, random.choice(pool), now)
                return True
        if not alive:
            return False
        if ph == "night":
            act = self._role(s, seat)["act"]
            if not act or seat not in self._actors(s):
                return False
            if act == "kill":
                mates = [s["wolfPicks"][w] for w in self._wolves(s) if w in s["wolfPicks"] and w != seat]
                pool = [i for i in self._living(s) if self._team(s, i) != "wolves"]
                pick = mates[0] if mates else (random.choice(pool) if pool else None)
                if pick is not None:
                    s["wolfPicks"][seat] = pick
                return True
            pool = [i for i in self._living(s) if self._valid_target(s, seat, i) is None]
            if pool:
                s["acts"][seat] = random.choice(pool)
            return True
        if ph == "day" and random.random() < 0.75:
            pool = [i for i in others if not (wolf and self._team(s, i) == "wolves")]
            if not pool:
                return False
            known = s["seen"].get(seat, [])                 # a bot Seer votes for a wolf it found
            led = sorted(((c, t) for t, c in self._tally(s).items() if t != "skip" and t in pool), reverse=True)
            known = [w for w in known if w in pool]
            if known:
                pick = known[0]
            elif led and random.random() < 0.6:            # pile on to whoever is leading
                pick = led[0][1]
            else:
                pick = random.choice(pool) if random.random() < 0.85 else "skip"
            s["votes"][seat] = pick
            self._count_votes(room, s, now)
            return True
        if ph == "judgement" and seat != s["accused"]:
            guilty = random.random() < (0.2 if wolf and self._team(s, s["accused"]) == "wolves" else 0.6)
            s["judge"][seat] = "guilty" if guilty else "innocent"
            return True
        return False

    # ---- Actions ---------------------------------------------------------------------------
    def play(self, room, s, seat, action, data):
        now = time.time()
        ph = s["phase"]
        alive = s["alive"][seat]
        name = self._name(room, s, seat)

        if action == "chat":
            text = re.sub(r"\s+", " ", str(data.get("text", ""))).strip()[:300]
            if not text:
                return None
            ch = data.get("ch")
            if not alive:
                self._say(s, "dead", text, "chat", seat, name)
            elif ch == "wolves":
                if self._team(s, seat) != "wolves":
                    return "Only wolves can talk there."
                if ph != "night":
                    return "The pack only talks at night."
                self._say(s, "wolves", text, "chat", seat, name)
            elif ph == "night":
                return "It's night. The town is asleep (wolves can use their own chat)."
            else:
                self._say(s, "town", text, "chat", seat, name)
            return None

        if action == "will":
            s["will"][seat] = str(data.get("text", ""))[:WILL_LEN]
            return None if alive else "Your will has already been read."

        if action == "hunt":
            if ph != "hunter" or not s["hunters"] or s["hunters"][0] != seat:
                return "It's not your shot."
            t = data.get("target")
            if not isinstance(t, int) or not 0 <= t < len(s["roles"]) or not s["alive"][t]:
                return "Pick a living player."
            self._shoot(room, s, seat, t, now)
            return None

        if not alive:
            return "You're dead. You can still chat with the other dead."

        if action == "act":
            if ph != "night":
                return "Night powers only work at night."
            act = self._role(s, seat)["act"]
            if not act:
                return "Your role has no night power. Sit tight."
            t = data.get("target")
            if t is None:
                (s["wolfPicks"] if act == "kill" else s["acts"]).pop(seat, None)
                return None
            err = self._valid_target(s, seat, t)
            if err:
                return err
            if act == "kill":
                s["wolfPicks"][seat] = t
                self._say(s, "wolves", f"{name} wants to kill {self._name(room, s, t)}.", "sys")
            else:
                s["acts"][seat] = t
            return None

        if action == "vote":
            if ph != "day":
                return "Voting happens during the day."
            t = data.get("target")
            if t is None:
                s["votes"].pop(seat, None)
                return None
            if t != "skip" and (not isinstance(t, int) or not 0 <= t < len(s["roles"]) or not s["alive"][t]):
                return "Pick a living player."
            if t == seat:
                return "You can't vote for yourself."
            old = s["votes"].get(seat)
            s["votes"][seat] = t
            if old != t:
                what = "to skip the day" if t == "skip" else f"to put {self._name(room, s, t)} on trial"
                self._say(s, "town", f"{name} voted {what}.", "vote")
            self._count_votes(room, s, now)
            return None

        if action == "judge":
            if ph != "judgement":
                return "There's no vote on right now."
            if seat == s["accused"]:
                return "You're the one on trial."
            j = data.get("vote")
            if j not in ("guilty", "innocent", None):
                return "Vote guilty or innocent."
            if j is None:
                s["judge"].pop(seat, None)
            else:
                s["judge"][seat] = j
            return None

        if action == "reveal":
            if s["roles"][seat] != "mayor":
                return "Only the Mayor can do that."
            if s["mayor"] == seat:
                return "You've already revealed."
            if ph not in ("day", "defence", "judgement"):
                return "Reveal yourself during the day."
            s["mayor"] = seat
            self._log(s, f"{name} revealed themselves as the Mayor!", "good")
            self._say(s, "town", f"{name} has revealed themselves as the Mayor! Their vote now counts {MAYOR_VOTES} times.", "good")
            if ph == "day":
                self._count_votes(room, s, now)
            return None

        return "Unknown action."

    def skip(self, room, s):
        s["until"] = time.time()
        return None

    def skip_label(self, room, s):
        return {"night": "the rest of the night", "dawn": "the dawn news", "day": "the rest of the day",
                "defence": "the defence", "judgement": "the vote", "verdict": "the verdict",
                "hunter": "the Hunter's shot"}.get(s.get("phase"), "ahead")

    # ---- View ------------------------------------------------------------------------------
    def game_view(self, room, s, seat):
        if not s["started"] or "roles" not in s:
            return {"phase": ""}
        now = time.time()
        over = s["over"]
        me = seat if seat is not None and seat < len(s["roles"]) else None
        my_role = s["roles"][me] if me is not None else None
        my_team = ROLES[my_role]["team"] if my_role else None
        dead_me = me is not None and not s["alive"][me]
        see_all = over or (dead_me and s["options"]["deadsee"] == "yes")
        wolf_me = my_team == "wolves"
        reveal = s["options"]["reveal"] == "yes"
        ph = s["phase"]

        def role_of(i):
            if see_all or i == me or (wolf_me and self._team(s, i) == "wolves"):
                return s["roles"][i]
            if not s["alive"][i] and reveal:
                return s["roles"][i]
            if s["mayor"] == i:
                return "mayor"
            return None

        tally = {}
        for v, t in s["votes"].items():
            tally[t] = tally.get(t, 0) + self._weight(s, v)
        players = []
        for i in range(len(s["roles"])):
            pid = s["seats"][i]
            p = room.players.get(pid, {})
            death = next((d for d in s["deaths"] if d["seat"] == i), None)
            players.append({
                "seat": i, "id": pid, "name": p.get("name", "Someone"),
                "online": bool(p.get("sids")) or bool(p.get("bot")), "bot": bool(p.get("bot")),
                "alive": s["alive"][i], "role": role_of(i), "mayor": s["mayor"] == i,
                "votes": tally.get(i, 0), "voteFor": s["votes"].get(i) if ph == "day" else None,
                "death": death and {"day": death["day"], "how": death["how"]},
                "will": s["will"][i] if (not s["alive"][i] or over) else "",
            })
        act = ROLES[my_role]["act"] if my_role else None
        can_act = (ph == "night" and me is not None and not dead_me and me in self._actors(s))
        targets = []
        if can_act:
            targets = [i for i in self._living(s) if self._valid_target(s, me, i) is None]
        my_target = None
        if me is not None:
            my_target = s["wolfPicks"].get(me) if act == "kill" else s["acts"].get(me)
        pack = []
        if wolf_me and not over:
            pack = [{"seat": w, "pick": s["wolfPicks"].get(w)} for w in self._wolves(s, alive=False)]
        chans = ["town"]
        if wolf_me or see_all:
            chans.append("wolves")
        if dead_me or me is None or over:
            chans.append("dead")
        chat = [{k: m[k] for k in ("ch", "text", "kind", "seat", "name")} for m in s["chat"] if m["ch"] in chans][-150:]
        role_info = None
        if my_role:
            r = ROLES[my_role]
            role_info = {"id": my_role, "name": r["name"], "team": r["team"], "about": r["about"],
                         "goal": GOALS[r["team"]], "act": act, "verb": ACT_WORDS.get(act)}
        hunter = s["hunters"][0] if ph == "hunter" and s["hunters"] else None
        return {
            "phase": ph, "day": s["day"], "remaining": max(0.0, round(s["until"] - now, 2)) if not over else 0,
            "people": players, "role": role_info, "alive": bool(me is not None and not dead_me),
            "canAct": can_act, "targets": targets, "myTarget": my_target, "pack": pack,
            "myVote": s["votes"].get(me) if me is not None and ph == "day" else None,
            "myJudge": s["judge"].get(me) if me is not None else None,
            "judged": len(s["judge"]) if ph == "judgement" else 0,
            "need": self._majority(s), "skipVotes": tally.get("skip", 0),
            "accused": s["accused"], "lastJudge": s["lastJudge"] if ph == "verdict" else None,
            "trials": s["trials"], "maxTrials": MAX_TRIALS, "hunter": hunter,
            "notes": s["notes"][me] if me is not None else [], "will": s["will"][me] if me is not None else "",
            "chat": chat, "chans": chans, "setup": s.get("setup", []),
            "roleNames": {k: v["name"] for k, v in ROLES.items()},
            "roleTeams": {k: v["team"] for k, v in ROLES.items()},
            "myTeam": my_team, "mayorSeat": s["mayor"], "nightKill": not (s["day"] == 1 and s["options"]["firstkill"] == "no"),
            "lastNight": s["lastNight"] if ph == "dawn" else [],
        }
