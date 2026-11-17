"""Clan Trivia rules for live rooms.

Multiple-choice questions against the clock. The server keeps the right answer to itself until
time is up (or everyone has answered), then reveals it and scores: 500 points for being right
plus up to 500 more for being quick. Questions come from trivia/questions.js, which the website
uses too, so packs are edited in one place.

Anyone can take a seat while a game is running and starts on 0 points.
"""
import os
import random
import re
import time

from .base import SeatedGame

SITE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
QUESTIONS_JS = os.path.join(SITE, "trivia", "questions.js")
READY_SECONDS = 4
REVEAL_SECONDS = 6
LETTERS = "ABCD"


def load_packs():
    """Read the packs from trivia/questions.js (one question per line, right answer first)."""
    try:
        with open(QUESTIONS_JS, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return {}
    packs = {}
    for m in re.finditer(r'(\w+)\s*:\s*\{\s*name:\s*"([^"]+)"\s*,\s*questions:\s*`([^`]*)`', text):
        qs = []
        for line in m.group(3).splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 3 and all(parts):
                qs.append({"q": parts[0][:300], "right": parts[1][:120], "wrong": [w[:120] for w in parts[2:5]]})
        if qs:
            packs[m.group(1)] = {"name": m.group(2), "questions": qs}
    return packs


class Trivia(SeatedGame):
    id = "trivia"
    name = "Clan Trivia"
    min_players = 1
    max_players = 30
    late_join = True
    lobby_text = "Take a seat to play. The leader picks the questions and starts the quiz."

    @property
    def options(self):
        packs = load_packs()
        choices = [(k, f"{p['name']} ({len(p['questions'])})") for k, p in packs.items()]
        if len(packs) > 1:
            choices.append(("all", "Everything mixed"))
        return {
            "pack": choices or [("none", "No questions found")],
            "count": [("10", "10 questions"), ("5", "5 questions"), ("15", "15 questions"), ("20", "20 questions"),
                      ("30", "30 questions")],
            "time": [("20", "20 seconds each"), ("10", "10 seconds each"), ("15", "15 seconds each"),
                     ("30", "30 seconds each")],
        }

    # ---- Game flow -------------------------------------------------------------------------
    def begin(self, room, s):
        packs = load_packs()
        pick = s["options"]["pack"]
        pool = [q for k, p in packs.items() if pick in (k, "all") for q in p["questions"]]
        if not pool:
            return "There are no questions in that pack. Add some to trivia/questions.js."
        count = min(int(s["options"]["count"]), len(pool))
        quiz = []
        for q in random.sample(pool, count):
            answers = [q["right"]] + q["wrong"]
            random.shuffle(answers)
            quiz.append({"q": q["q"], "answers": answers, "right": answers.index(q["right"])})
        s.update({
            "quiz": quiz, "index": -1, "phase": "ready", "until": time.time() + READY_SECONDS,
            "limit": int(s["options"]["time"]), "scores": {pid: 0 for pid in s["seats"]},
            "streaks": {}, "answers": {}, "gained": {}, "correct": {},
        })
        pack_name = "everything" if pick == "all" else packs[pick]["name"]
        self._log(s, f"Quiz started: {count} questions from {pack_name}. Get ready!", "go")
        return None

    def joined(self, room, s, pid):
        if self.in_game(s) and pid not in s["seats"]:
            s["seats"].append(pid)
            s["scores"].setdefault(pid, 0)
            self._log(s, f"{room.players[pid]['name']} joined the quiz.")

    def _answering(self, room, s):
        """Players the quiz waits for: seated, still playing, and online."""
        return [pid for pid in s["seats"]
                if room.players.get(pid, {}).get("role") == "player" and room.players[pid]["sids"]]

    def _ask_next(self, room, s, now):
        s["index"] += 1
        if s["index"] >= len(s["quiz"]):
            self._end(room, s)
            return
        s["phase"] = "question"
        s["asked"] = now
        s["until"] = now + s["limit"]
        s["answers"] = {}
        s["gained"] = {}

    def _reveal(self, room, s, now):
        q = s["quiz"][s["index"]]
        s["phase"] = "reveal"
        s["until"] = now + REVEAL_SECONDS
        right = 0
        for pid, (choice, taken) in s["answers"].items():
            if choice == q["right"]:
                speed = max(0.0, 1 - taken / s["limit"])
                pts = 500 + round(500 * speed)
                s["streaks"][pid] = s["streaks"].get(pid, 0) + 1
                s["correct"][pid] = s["correct"].get(pid, 0) + 1
                right += 1
            else:
                pts = 0
                s["streaks"][pid] = 0
            s["gained"][pid] = pts
            s["scores"][pid] = s["scores"].get(pid, 0) + pts
        for pid in s["seats"]:
            if pid not in s["answers"]:
                s["streaks"][pid] = 0
        n = len(s["answers"])
        self._log(s, f"Q{s['index'] + 1}: the answer was {LETTERS[q['right']]}. {q['answers'][q['right']]} "
                     f"({right} of {n} got it).", "good" if right else "")

    def _end(self, room, s):
        s["phase"] = "done"
        ranked = sorted(s["seats"], key=lambda p: -s["scores"].get(p, 0))
        top = s["scores"].get(ranked[0], 0) if ranked else 0
        winners = [p for p in ranked if s["scores"].get(p, 0) == top]
        names = " and ".join(room.players.get(p, {}).get("name", "?") for p in winners)
        s["winners"] = winners
        self.finish(s, winners[0] if winners else None,
                    f"{names} {'win' if len(winners) > 1 else 'wins'} with {top} points!" if winners else "Quiz over.")

    def tick(self, room, now):
        s = room.state
        if not self.in_game(s):
            return False
        changed = False
        for pid, p in room.players.items():          # people who sat down since the last tick
            if p.get("role") == "player" and pid not in s["seats"]:
                self.joined(room, s, pid)
                changed = True
        if s["phase"] == "ready" and now >= s["until"]:
            self._ask_next(room, s, now)
            return True
        if s["phase"] == "question":
            waiting = self._answering(room, s)
            if now >= s["until"] or (waiting and all(p in s["answers"] for p in waiting)):
                self._reveal(room, s, now)
                return True
        if s["phase"] == "reveal" and now >= s["until"]:
            self._ask_next(room, s, now)
            return True
        return changed

    # ---- Actions ---------------------------------------------------------------------------
    def play(self, room, s, pid, action, data):
        if action != "answer":
            return "Unknown action."
        if room.players[pid].get("role") != "player":
            return "Take a seat to answer."
        if pid not in s["seats"]:
            self.joined(room, s, pid)
        if s["phase"] != "question":
            return "Wait for the next question."
        if pid in s["answers"]:
            return "You've already answered this one."
        try:
            choice = int(data.get("choice"))
        except (TypeError, ValueError):
            return "Pick an answer."
        if not 0 <= choice < len(s["quiz"][s["index"]]["answers"]):
            return "Pick an answer."
        s["answers"][pid] = (choice, max(0.0, time.time() - s["asked"]))
        return None

    def skip(self, room, s):
        now = time.time()
        if s["phase"] == "question":
            self._reveal(room, s, now)
        else:
            self._ask_next(room, s, now)
        return None

    def skip_label(self, room, s):
        return "the question" if s.get("phase") == "question" else "ahead to the next question"

    # ---- View ------------------------------------------------------------------------------
    def game_view(self, room, s, pid):
        out = {"packs": {k: p["name"] for k, p in load_packs().items()}}
        if not s["started"]:
            return out
        now = time.time()
        idx = s["index"]
        q = s["quiz"][idx] if 0 <= idx < len(s["quiz"]) else None
        phase = s["phase"]
        board = []
        for p in s["seats"]:
            ans = s["answers"].get(p)
            board.append({
                "id": p, "name": room.players.get(p, {}).get("name", "?"), "score": s["scores"].get(p, 0),
                "online": bool(room.players.get(p, {}).get("sids")),
                "playing": room.players.get(p, {}).get("role") == "player",
                "answered": ans is not None,
                "choice": ans[0] if ans and phase in ("reveal", "done") else None,
                "gained": s["gained"].get(p) if phase in ("reveal", "done") else None,
                "streak": s["streaks"].get(p, 0), "correct": s["correct"].get(p, 0),
            })
        board.sort(key=lambda r: -r["score"])
        mine = s["answers"].get(pid)
        out.update({
            "phase": phase, "index": idx, "total": len(s["quiz"]), "limit": s["limit"],
            "remaining": max(0.0, round(s["until"] - now, 2)) if phase != "done" else 0,
            "question": {"q": q["q"], "answers": q["answers"]} if q and phase in ("question", "reveal", "done") else None,
            "right": q["right"] if q and phase in ("reveal", "done") else None,
            "myChoice": mine[0] if mine else None, "myGained": s["gained"].get(pid),
            "board": board, "winners": s.get("winners", []),
            "counts": [sum(1 for c, _ in s["answers"].values() if c == i) for i in range(4)]
                      if phase in ("reveal", "done") else None,
        })
        return out
