"""ACEdle played together in a Discord voice call (the ACEdle Discord Activity).

Everyone in the call plays the same daily run on their own screen. This room only shares how far
each person has got: which stages they've finished, in how many guesses, and their points. Answers
and guesses never leave the player's own page, so nobody gets spoiled.

One room per activity instance (everyone who opened ACEdle in the same call), named "dc:<instance>".
Players are known by their Discord account: the page shows the ticket discord_auth.py signed for it,
and the player id must be "d" + that Discord user id.
"""
import re
import time

import discord_auth

STAGE_KEY = re.compile(r"^[a-z]{2,12}$")
INSTANCE = re.compile(r"^[A-Za-z0-9_:.-]{4,80}$")
MAX_STAGES = 16


class Acedle:
    id = "acedle"
    name = "ACEdle (Discord)"

    def new_state(self, options=None, old=None):
        return {"people": {}, "feed": [], "day": 0, "created": int(time.time())}

    def default_seat(self, room):
        return {}

    def room_key(self, options):
        inst = str((options or {}).get("instance", ""))
        if not INSTANCE.match(inst):
            return None, "This only works inside Discord."
        return "dc:" + inst, None

    def _feed(self, s, text):
        s["feed"].append({"t": int(time.time()), "text": text})
        del s["feed"][:-20]

    def handle(self, room, pid, action, data):
        s = room.state
        if action == "hello":
            user = discord_auth.read_ticket(data.get("ticket"))
            if not user or pid != "d" + user["id"]:
                return "Couldn't check your Discord sign-in. Close the activity and open it again."
            fresh = pid not in s["people"]
            p = s["people"].setdefault(pid, {"stages": {}, "total": 0, "done": False, "day": 0})
            p.update(name=user["name"][:32], avatar=user.get("avatar", ""), uid=user["id"])
            room.players[pid]["name"] = user["name"][:20]
            if fresh:
                self._feed(s, f"{p['name']} joined.")
            return None
        p = s["people"].get(pid)
        if not p:
            return "Say hello first."
        if action == "progress":
            day = data.get("day")
            if not isinstance(day, int) or not 0 < day < 100000:
                return "Bad day."
            before = dict(p["stages"])
            stages = {}
            for st in (data.get("stages") or [])[:MAX_STAGES]:
                if not isinstance(st, dict) or not STAGE_KEY.match(str(st.get("key", ""))):
                    continue
                g, pts = st.get("guesses"), st.get("points")
                stages[st["key"]] = {
                    "solved": bool(st.get("solved")), "skipped": bool(st.get("skipped")),
                    "guesses": g if isinstance(g, int) and 0 <= g <= 20 else 0,
                    "points": pts if isinstance(pts, int) and 0 <= pts <= 100 else 0,
                }
            total = sum(v["points"] for v in stages.values())
            if day != p["day"]:
                before = {}
            p.update(day=day, stages=stages, total=total, done=bool(data.get("done")),
                     current=str(data.get("current", ""))[:12])
            s["day"] = max(s["day"], day)
            for key, v in stages.items():
                if key not in before:
                    name = str(next((x.get("name") for x in data["stages"] if isinstance(x, dict) and x.get("key") == key), key))[:24]
                    if v["solved"]:
                        self._feed(s, f"{p['name']} got {name} in {v['guesses']} (+{v['points']}).")
                    elif not v["skipped"]:
                        self._feed(s, f"{p['name']} missed {name}.")
            if p["done"] and p.get("announced") != day:
                p["announced"] = day
                self._feed(s, f"{p['name']} finished with {total} points!")
            return None
        return "Unknown action."

    def view(self, room, pid):
        s = room.state
        people = []
        for p_id, p in s["people"].items():
            if p["day"] and p["day"] != s["day"]:
                continue                      # still on yesterday's run: leave them out until they reload
            seat = room.players.get(p_id) or {}
            people.append({"id": p_id, "uid": p["uid"], "name": p["name"], "avatar": p["avatar"],
                           "stages": p["stages"], "total": p["total"], "done": p["done"],
                           "current": p.get("current", ""), "online": bool(seat.get("sids"))})
        people.sort(key=lambda x: (-x["total"], x["name"].lower()))
        return {"day": s["day"], "people": people, "feed": s["feed"][-8:]}
