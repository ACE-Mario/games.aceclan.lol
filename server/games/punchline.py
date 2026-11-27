"""ACE Punchline rules for live rooms.

Everyone gets prompts and writes the funniest answer they can. Each prompt goes to two players,
then everyone else votes for the answer they like best without knowing who wrote which. Votes
are worth more each round. The last round, the Last Laugh, gives one prompt to everybody, and
everyone votes for their favourite.

The server keeps who wrote what to itself until each matchup is revealed. Players who aren't
seated (watchers) can vote too. Prompts come from punchline/prompts.txt; the leader can also
let players add their own prompts in the lobby. {player} in a prompt becomes someone's name.
"""
import json
import os
import random
import re
import time

from .base import SeatedGame

SITE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROMPTS_TXT = os.path.join(SITE, "punchline", "prompts.txt")
SAVE_DIR = os.environ.get("ACE_PUNCHLINE_DIR") or os.path.join(SITE, "server", "saved", "punchline")
OWN_FILE = os.path.join(SAVE_DIR, "ace-custom.json")    # the ACE Custom pack (not in git)
OWN_KEY = "own"
OWN_NAME = "ACE Custom"
MAX_OWN = 1000
READY_SECONDS = 4
VOTE_SECONDS = 20
FINAL_VOTE_SECONDS = 30
REVEAL_SECONDS = 8
SCORES_SECONDS = 7
MAX_ANSWER = 80
MAX_CUSTOM = 60
POINTS = 1000                 # shared out by votes in each matchup, times the round number
SWEEP = 250                   # extra for getting every vote, times the round number
FINAL_VOTE = 300              # each Last Laugh vote
SAFETY = [                    # "Pick for me": a stock answer for half points (bots use these too)
    "My mum", "A suspiciously large potato", "Ranked anxiety", "Three raccoons in a trench coat",
    "Free Wi-Fi", "A strongly worded email", "Crying in the shower", "Absolutely nothing", "Pineapple",
    "The lag", "A haunted printer", "Uninstalling", "Jerry the bot", "Twelve energy drinks", "Mid",
    "Skill issue", "Literally just vibes", "A tax return", "The final boss of Bunnings",
    "A goose with a grudge", "Discord Nitro", "An unpaid intern", "Grandma's slipper", "Soggy toast",
    "The respawn timer", "Socks with sandals", "A participation trophy", "One (1) brain cell",
]


def load_own():
    """The ACE Custom pack: prompts the leader types in on the site, kept for every game."""
    try:
        with open(OWN_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return [{"id": str(p["id"]), "text": str(p["text"])[:200]} for p in data.get("prompts", []) if p.get("text")]
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return []


def save_own(prompts):
    os.makedirs(SAVE_DIR, exist_ok=True)
    tmp = OWN_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"prompts": prompts}, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OWN_FILE)


def load_packs():
    """Read punchline/prompts.txt ([key] Name lines start a pack, then one prompt per line), plus the
    saved ACE Custom pack, which is always listed so the leader can tick it."""
    try:
        with open(PROMPTS_TXT, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return {}
    packs, cur = {}, None
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^\[(\w+)\]\s*(.*)$", line)
        if m:
            cur = packs.setdefault(m.group(1), {"name": m.group(2) or m.group(1), "prompts": []})
            continue
        if cur is not None:
            cur["prompts"].append(line[:200])
    packs = {k: p for k, p in packs.items() if p["prompts"]}
    packs[OWN_KEY] = {"name": OWN_NAME, "prompts": [p["text"] for p in load_own()]}
    return packs


def clean(text, limit):
    return re.sub(r"\s+", " ", str(text or "")).strip()[:limit]


def same(a, b):
    n = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())
    return bool(a and b) and n(a) == n(b)


class Punchline(SeatedGame):
    id = "punchline"
    name = "ACE Punchline"
    min_players = 3
    max_players = 12
    late_join = True              # sit down mid-game: you get prompts from the next round
    bots = True
    multi = ("pack",)
    lobby_text = "Take a seat to play. Everyone writes answers to prompts, then votes for the funniest."

    @property
    def options(self):
        packs = load_packs()
        choices = [(k, f"{p['name']} ({len(p['prompts'])})" if k != OWN_KEY else f"{OWN_NAME} (your saved prompts)")
                   for k, p in packs.items()]
        return {
            "pack": choices or [("none", "No prompts found")],
            "rounds": [("2", "2 rounds + Last Laugh"), ("1", "1 round + Last Laugh"), ("3", "3 rounds + Last Laugh")],
            "time": [("90", "90 seconds to write"), ("60", "60 seconds"), ("120", "120 seconds"), ("150", "150 seconds")],
            "custom": [("on", "Use prompts players add"), ("off", "Only the built-in prompts")],
        }

    def new_state(self, options=None, old=None):
        s = super().new_state(options, old)
        s["custom"] = list(old.get("custom", [])) if old else []     # players' own prompts stay for the next game
        return s

    # ---- Lobby: players' own prompts ---------------------------------------------------------
    def handle(self, room, pid, action, data):
        s = room.state
        if action == "add_prompt":
            text = clean(data.get("text"), 160)
            if len(text) < 3:
                return "Write a prompt first."
            if len(s["custom"]) >= MAX_CUSTOM:
                return f"There are already {MAX_CUSTOM} player prompts."
            if any(same(text, c["text"]) for c in s["custom"]):
                return "That prompt is already in."
            s["custom"].append({"id": "c" + "".join(random.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(8)),
                                "text": text, "by": pid})
            return None
        if action in ("pack_add", "pack_edit", "pack_remove"):
            if not room.is_host(pid):
                return f"Only the leader can change the {OWN_NAME} pack."
            return self._edit_own(action, data)
        if action == "remove_prompt":
            c = next((c for c in s["custom"] if c["id"] == data.get("id")), None)
            if not c:
                return "That prompt has gone already."
            if c["by"] != pid and not room.is_host(pid):
                return "Only whoever wrote it (or the leader) can remove a prompt."
            s["custom"].remove(c)
            return None
        return super().handle(room, pid, action, data)

    def _edit_own(self, action, data):
        own = load_own()
        if action == "pack_add":                     # one prompt per line, so a whole list can be pasted in
            lines = [clean(x, 200) for x in str(data.get("text") or "").splitlines()]
            lines = [x for x in lines if len(x) >= 3]
            if not lines:
                return "Type a prompt first."
            have = {re.sub(r"[^a-z0-9]", "", p["text"].lower()) for p in own}
            added = 0
            for text in lines:
                k = re.sub(r"[^a-z0-9]", "", text.lower())
                if k in have:
                    continue
                if len(own) >= MAX_OWN:
                    break
                have.add(k)
                own.append({"id": "p" + "".join(random.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(10)),
                            "text": text})
                added += 1
            if not added:
                return "Those prompts are already in the pack." if len(own) < MAX_OWN else f"The pack is full ({MAX_OWN})."
        else:
            p = next((p for p in own if p["id"] == data.get("id")), None)
            if not p:
                return "That prompt isn't in the pack any more."
            if action == "pack_remove":
                own.remove(p)
            else:
                text = clean(data.get("text"), 200)
                if len(text) < 3:
                    return "Type the prompt first."
                p["text"] = text
        try:
            save_own(own)
        except OSError as e:
            return f"Couldn't save the pack ({e.strerror or e})."
        return None

    # ---- Game flow -------------------------------------------------------------------------
    def begin(self, room, s):
        packs = load_packs()
        pick = [k for k in s["options"]["pack"].split(",") if k in packs]
        pool = [p for k in pick for p in packs[k]["prompts"]]
        if s["options"]["custom"] == "on":
            pool += [c["text"] for c in s["custom"]]
        if len(pool) < 2:
            if pick == [OWN_KEY]:
                return f"The {OWN_NAME} pack needs at least 2 prompts. Add some in the lobby first."
            return "There aren't enough prompts. Tick another pack or add some of your own."
        random.shuffle(pool)
        s.update({
            "pool": pool, "next": 0, "round": 0, "rounds": int(s["options"]["rounds"]),
            "limit": int(s["options"]["time"]), "scores": {pid: 0 for pid in s["seats"]},
            "phase": "ready", "until": time.time() + READY_SECONDS, "matches": [], "mi": -1,
            "final": None, "gained": {}, "wins": {}, "bot_due": {},
        })
        self._log(s, f"ACE Punchline: {s['rounds']} round{'s' if s['rounds'] > 1 else ''} and the Last Laugh. "
                     f"Get your jokes ready!", "go")
        return None

    def joined(self, room, s, pid):
        if self.in_game(s) and pid not in s["seats"]:
            s["seats"].append(pid)
            s["scores"].setdefault(pid, 0)
            self._log(s, f"{room.players[pid]['name']} joined. They'll get prompts next round.")

    def _name(self, room, pid):
        return room.players.get(pid, {}).get("name", "Someone")

    def _writers(self, room, s):
        """Seated players who are still playing: they get prompts this round."""
        return [pid for pid in s["seats"] if room.players.get(pid, {}).get("role") == "player"]

    def _prompt(self, room, s, avoid):
        """The next prompt from the pool (it starts again, reshuffled, if a long game uses them all).
        {player} becomes someone in the game, not one of the people answering if possible."""
        if s["next"] >= len(s["pool"]):
            random.shuffle(s["pool"])
            s["next"] = 0
        text = s["pool"][s["next"]]
        s["next"] += 1
        names = [q for q in s["seats"] if q not in avoid] or list(s["seats"])
        while "{player}" in text:
            text = text.replace("{player}", self._name(room, random.choice(names)), 1)
        return text

    def _start_round(self, room, s, now):
        s["round"] += 1
        writers = self._writers(room, s)
        random.shuffle(writers)
        s["gained"] = {}
        if s["round"] > s["rounds"]:                         # the Last Laugh
            s["phase"] = "final_write"
            s["until"] = now + s["limit"]
            s["final"] = {"prompt": self._prompt(room, s, []), "authors": writers, "ans": {}, "safe": [],
                          "order": [], "votes": {}, "pts": {}}
            s["matches"] = []
            self._log(s, "The Last Laugh! One prompt for everyone.", "go")
            return
        # Each player answers two prompts, each against a different player (a ring: 1v2, 2v3 ... nv1).
        n = len(writers)
        s["matches"] = []
        for i in range(n):
            pair = [writers[i], writers[(i + 1) % n]]
            s["matches"].append({"prompt": self._prompt(room, s, pair), "authors": pair, "ans": {}, "safe": [],
                                 "order": [], "votes": {}, "pts": {}, "note": ""})
        s["mi"] = -1
        s["phase"] = "write"
        s["until"] = now + s["limit"]
        self._log(s, f"Round {s['round']}: write your answers! Votes are worth {s['round']}x this round.", "go")

    def _todo(self, s, pid):
        """How many prompts this player still has to answer."""
        if s["phase"] == "final_write":
            f = s["final"]
            return int(pid in f["authors"] and pid not in f["ans"])
        if s["phase"] == "write":
            return sum(1 for m in s["matches"] if pid in m["authors"] and pid not in m["ans"])
        return 0

    def _all_written(self, room, s):
        waiting = [pid for pid in self._writers(room, s)
                   if room.players[pid].get("sids") or room.players[pid].get("bot")]
        return all(self._todo(s, pid) == 0 for pid in waiting)

    def _voters(self, room, s, authors):
        """Online people (seated or watching) who may vote: anyone who didn't write an answer."""
        return [pid for pid, p in room.players.items()
                if pid not in authors and (p.get("sids") or p.get("bot"))
                and (p.get("role") == "player" or not p.get("bot"))]

    def _next_match(self, room, s, now):
        s["mi"] += 1
        while s["mi"] < len(s["matches"]):
            m = s["matches"][s["mi"]]
            a, b = m["authors"]
            have = [p for p in (a, b) if m["ans"].get(p)]
            m["order"] = random.sample([a, b], 2)
            if len(have) == 2 and same(m["ans"][a], m["ans"][b]):
                m["note"] = "jinx"
                self._reveal(room, s, now)
                return
            if len(have) < 2:
                m["note"] = "walkover" if have else "empty"
                if not have:                  # nobody answered: nothing to show, move straight on
                    s["mi"] += 1
                    continue
                self._reveal(room, s, now)
                return
            s["phase"] = "vote"
            s["until"] = now + VOTE_SECONDS
            return
        self._scores(room, s, now)

    def _add(self, s, pid, pts):
        s["scores"][pid] = s["scores"].get(pid, 0) + pts
        s["gained"][pid] = s["gained"].get(pid, 0) + pts

    def _reveal(self, room, s, now):
        m = s["matches"][s["mi"]]
        r = s["round"]
        a, b = m["authors"]
        s["phase"] = "reveal"
        s["until"] = now + REVEAL_SECONDS
        if m["note"] == "jinx":
            self._log(s, f"Jinx! {self._name(room, a)} and {self._name(room, b)} wrote the same thing. No points.")
            return
        if m["note"] == "walkover":
            win = a if m["ans"].get(a) else b
            pts = POINTS * r // 2 // (2 if win in m["safe"] else 1)
            m["pts"] = {win: pts}
            self._add(s, win, pts)
            self._log(s, f"{self._name(room, win)} wins by walkover (+{pts}).")
            return
        votes = {p: 0 for p in (a, b)}
        for v in m["votes"].values():
            votes[v] = votes.get(v, 0) + 1
        total = sum(votes.values())
        for p in (a, b):
            pts = round(POINTS * r * votes[p] / total) if total else 0
            if total and votes[p] == total:
                pts += SWEEP * r
            if p in m["safe"]:
                pts //= 2
            m["pts"][p] = pts
            self._add(s, p, pts)
        if total and votes[a] != votes[b]:
            win = a if votes[a] > votes[b] else b
            s["wins"][win] = s["wins"].get(win, 0) + 1
            sweep = " Clean sweep!" if votes[win] == total and total > 1 else ""
            self._log(s, f"{self._name(room, win)} took it {votes[win]} to {total - votes[win]}.{sweep}", "good")
        elif total:
            self._log(s, f"{self._name(room, a)} and {self._name(room, b)} tied {votes[a]} each.")
        else:
            self._log(s, "Nobody voted on that one.")

    def _scores(self, room, s, now):
        s["phase"] = "scores"
        s["until"] = now + SCORES_SECONDS

    def _final_vote(self, room, s, now):
        f = s["final"]
        have = [p for p in f["authors"] if f["ans"].get(p)]
        f["order"] = random.sample(have, len(have))
        if len(have) < 2:
            self._final_reveal(room, s, now)
            return
        s["phase"] = "final_vote"
        s["until"] = now + FINAL_VOTE_SECONDS

    def _final_reveal(self, room, s, now):
        f = s["final"]
        s["phase"] = "final_reveal"
        s["until"] = now + REVEAL_SECONDS + 2
        s["gained"] = {}
        count = {}
        for v in f["votes"].values():
            count[v] = count.get(v, 0) + 1
        for p in f["order"]:
            pts = FINAL_VOTE * count.get(p, 0)
            if p in f["safe"]:
                pts //= 2
            f["pts"][p] = pts
            self._add(s, p, pts)
        if count:
            top = max(count.values())
            best = [p for p, c in count.items() if c == top]
            self._log(s, f"Last Laugh: {' and '.join(self._name(room, p) for p in best)} got the most votes ({top}).", "good")

    def _end(self, room, s):
        s["phase"] = "done"
        ranked = sorted(s["seats"], key=lambda p: -s["scores"].get(p, 0))
        top = s["scores"].get(ranked[0], 0) if ranked else 0
        winners = [p for p in ranked if s["scores"].get(p, 0) == top]
        s["winners"] = winners
        names = " and ".join(self._name(room, p) for p in winners)
        self.finish(s, winners[0] if winners else None,
                    f"{names} {'win' if len(winners) > 1 else 'wins'} with {top} points!" if winners else "Game over.")

    def _advance(self, room, s, now):
        """Move on from the current phase (time's up, everyone's done, or the leader skipped)."""
        ph = s["phase"]
        if ph == "ready":
            self._start_round(room, s, now)
        elif ph == "write":
            self._log(s, "Pens down! Time to vote.")
            self._next_match(room, s, now)
        elif ph == "vote":
            self._reveal(room, s, now)
        elif ph == "reveal":
            self._next_match(room, s, now)
        elif ph == "scores":
            self._start_round(room, s, now)
        elif ph == "final_write":
            self._final_vote(room, s, now)
        elif ph == "final_vote":
            self._final_reveal(room, s, now)
        elif ph == "final_reveal":
            self._end(room, s)

    def tick(self, room, now):
        s = room.state
        if not self.in_game(s):
            return False
        changed = False
        for pid, p in room.players.items():          # people who sat down since the last tick
            if p.get("role") == "player" and pid not in s["seats"]:
                self.joined(room, s, pid)
                changed = True
        changed |= self._bots(room, s, now)
        ph = s["phase"]
        done = False
        if ph in ("write", "final_write"):
            done = self._all_written(room, s)
        elif ph == "vote":
            m = s["matches"][s["mi"]]
            voters = self._voters(room, s, m["authors"])
            done = bool(voters) and all(v in m["votes"] for v in voters)
        elif ph == "final_vote":
            f = s["final"]
            voters = [p for p in self._voters(room, s, []) if any(q != p for q in f["order"])]
            done = bool(voters) and all(v in f["votes"] for v in voters)
        if now >= s["until"] or done:
            self._advance(room, s, now)
            return True
        return changed

    # ---- Bots ------------------------------------------------------------------------------
    def _bots(self, room, s, now):
        """Bots answer with a stock answer a few seconds in, and vote at random."""
        changed = False
        due = s["bot_due"]
        key = f"{s['phase']}/{s['round']}/{s['mi']}"
        for pid, p in room.players.items():
            if not p.get("bot"):
                continue
            when = due.get(pid)
            if not when or when[0] != key:
                due[pid] = [key, now + random.uniform(2, 6)]
                continue
            if now < when[1]:
                continue
            if self.play(room, s, pid, "pick_for_me", {"all": True}) is None:
                changed = True
            elif self._bot_vote(room, s, pid) is None:
                changed = True
            due[pid] = [key, float("inf")]
        return changed

    def _bot_vote(self, room, s, pid):
        if s["phase"] == "vote":
            m = s["matches"][s["mi"]]
            return self.play(room, s, pid, "vote", {"choice": random.randrange(2)}) if pid not in m["authors"] else "no"
        if s["phase"] == "final_vote":
            opts = [i for i, q in enumerate(s["final"]["order"]) if q != pid]
            return self.play(room, s, pid, "vote", {"choice": random.choice(opts)}) if opts else "no"
        return "no"

    # ---- Actions ---------------------------------------------------------------------------
    def _my_matches(self, s, pid):
        if s["phase"] == "final_write":
            return [s["final"]] if pid in s["final"]["authors"] else []
        if s["phase"] == "write":
            return [m for m in s["matches"] if pid in m["authors"]]
        return []

    def play(self, room, s, pid, action, data):
        if action in ("answer", "pick_for_me"):
            mine = self._my_matches(s, pid)
            if not mine:
                return "You have no prompts to answer right now." if s["phase"] in ("write", "final_write") \
                    else "Writing time is over."
            if action == "pick_for_me" and data.get("all"):
                targets = [m for m in mine if pid not in m["ans"]]
                if not targets:
                    return "Nothing left to answer."
            else:
                try:
                    k = int(data.get("prompt", 0))
                except (TypeError, ValueError):
                    return "Pick a prompt."
                if not 0 <= k < len(mine):
                    return "Pick a prompt."
                targets = [mine[k]]
            for m in targets:
                if action == "answer":
                    text = clean(data.get("text"), MAX_ANSWER)
                    if not text:
                        return "Write an answer first (or press Pick for me)."
                    if pid in m["safe"]:
                        m["safe"].remove(pid)
                else:
                    taken = {v.lower() for v in m["ans"].values()}
                    text = random.choice([t for t in SAFETY if t.lower() not in taken] or SAFETY)
                    if pid not in m["safe"]:
                        m["safe"].append(pid)
                m["ans"][pid] = text
            return None
        if action == "vote":
            try:
                choice = int(data.get("choice"))
            except (TypeError, ValueError):
                return "Pick an answer."
            if s["phase"] == "vote":
                m = s["matches"][s["mi"]]
                if pid in m["authors"]:
                    return "You wrote one of these. Sit back and enjoy it."
                if not 0 <= choice < 2:
                    return "Pick an answer."
                m["votes"][pid] = m["order"][choice]
                return None
            if s["phase"] == "final_vote":
                f = s["final"]
                if not 0 <= choice < len(f["order"]):
                    return "Pick an answer."
                if f["order"][choice] == pid:
                    return "You can't vote for your own answer."
                f["votes"][pid] = f["order"][choice]
                return None
            return "There's nothing to vote on right now."
        return "Unknown action."

    def skip(self, room, s):
        self._advance(room, s, time.time())
        return None

    def skip_label(self, room, s):
        return {"write": "the rest of the writing time", "final_write": "the rest of the writing time",
                "vote": "the vote", "final_vote": "the vote"}.get(s.get("phase"), "ahead")

    # ---- View ------------------------------------------------------------------------------
    def _answers(self, room, s, m, show):
        """The answers in a matchup, in their shuffled order; who wrote them and the votes only once shown."""
        out = []
        for q in m["order"]:
            row = {"text": m["ans"].get(q, ""), "safe": q in m["safe"] and show}
            if show:
                row.update({"by": q, "name": self._name(room, q), "pts": m["pts"].get(q, 0),
                            "voters": [self._name(room, v) for v, c in m["votes"].items() if c == q]})
            out.append(row)
        return out

    def game_view(self, room, s, pid):
        own = load_own()
        out = {"packs": {k: p["name"] for k, p in load_packs().items()},
               "own": own if room.is_host(pid) and not s["started"] else None, "ownCount": len(own),
               "custom": [{"id": c["id"], "text": c["text"], "mine": c["by"] == pid,
                           "by": self._name(room, c["by"])} for c in s.get("custom", [])]}
        if not s["started"]:
            return out
        now = time.time()
        ph = s["phase"]
        board = [{
            "id": p, "name": self._name(room, p), "score": s["scores"].get(p, 0),
            "online": bool(room.players.get(p, {}).get("sids")) or self.is_bot(room, p),
            "playing": room.players.get(p, {}).get("role") == "player",
            "todo": self._todo(s, p), "gained": s["gained"].get(p) if ph in ("scores", "final_reveal", "done") else None,
            "wins": s["wins"].get(p, 0),
        } for p in s["seats"]]
        board.sort(key=lambda r: -r["score"])
        out.update({
            "phase": ph, "round": s["round"], "rounds": s["rounds"], "limit": s["limit"],
            "remaining": max(0.0, round(s["until"] - now, 2)) if ph != "done" else 0,
            "board": board, "winners": s.get("winners", []),
            "writing": sum(1 for p in self._writers(room, s) if self._todo(s, p)) if ph in ("write", "final_write") else 0,
        })
        if ph in ("write", "final_write"):
            out["mine"] = [{"prompt": m["prompt"], "answer": m["ans"].get(pid, ""), "safe": pid in m["safe"]}
                           for m in self._my_matches(s, pid)]
        if ph in ("vote", "reveal"):
            m = s["matches"][s["mi"]]
            show = ph == "reveal"
            mine = m["votes"].get(pid)
            out["match"] = {
                "prompt": m["prompt"], "num": s["mi"] + 1, "of": len(s["matches"]), "note": m["note"],
                "answers": self._answers(room, s, m, show), "iWrote": pid in m["authors"],
                "myVote": m["order"].index(mine) if mine in m["order"] else None,
                "voted": len(m["votes"]), "voters": len(self._voters(room, s, m["authors"])),
            }
        if ph in ("final_vote", "final_reveal", "done") and s["final"]:
            f = s["final"]
            show = ph != "final_vote"
            mine = f["votes"].get(pid)
            answers = self._answers(room, s, f, show)
            for i, q in enumerate(f["order"]):
                answers[i]["own"] = q == pid
            out["final"] = {
                "prompt": f["prompt"], "answers": answers,
                "myVote": f["order"].index(mine) if mine in f["order"] else None,
                "voted": len(f["votes"]), "voters": len(self._voters(room, s, [])),
            }
        return out
