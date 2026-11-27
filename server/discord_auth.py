"""Discord sign-in for games played as a Discord Activity (ACEdle inside a voice call).

Inside Discord, a game page asks the Discord app for a one-time code (the Embedded App SDK's
authorize command). The page sends that code here; this swaps it for an access token using the
app's client secret (which must never be in the website), looks up who it belongs to, and gives the
page back the token plus a signed "ticket". The page shows the ticket to the live room, so the room
knows the player's Discord name is real without asking Discord again.

The app id and secret come from environment variables, or from server/discord.env (never committed):
    DISCORD_CLIENT_ID=123456789012345678
    DISCORD_CLIENT_SECRET=...
"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import jsonify, request

API = "https://discord.com/api/v10"
UA = "ACE-Games (https://games.aceclan.lol, 1.0)"
TICKET_SECONDS = 12 * 60 * 60

CONFIG = {}


def load(here):
    """Read the app id and secret. Returns the app id, or "" when Discord sign-in isn't set up."""
    path = os.path.join(here, "discord.env")
    if os.path.exists(path):
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                key, sep, value = line.strip().partition("=")
                if sep and not key.startswith("#"):
                    CONFIG[key.strip()] = value.strip().strip('"')
    for key in ("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"):
        if os.environ.get(key):
            CONFIG[key] = os.environ[key]
    return CONFIG.get("DISCORD_CLIENT_ID", "") if CONFIG.get("DISCORD_CLIENT_SECRET") else ""


def _key():
    return hashlib.sha256(b"ace-activity-ticket:" + CONFIG.get("DISCORD_CLIENT_SECRET", "").encode()).digest()


def make_ticket(user):
    body = base64.urlsafe_b64encode(json.dumps({**user, "exp": int(time.time()) + TICKET_SECONDS},
                                               separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()
    return body + "." + sig


def read_ticket(ticket):
    """The Discord user a ticket was made for ({"id", "name", "avatar"}), or None if it's fake or old."""
    if not CONFIG.get("DISCORD_CLIENT_SECRET") or not isinstance(ticket, str) or "." not in ticket:
        return None
    body, _, sig = ticket.rpartition(".")
    if not hmac.compare_digest(sig, hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()):
        return None
    try:
        user = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except ValueError:
        return None
    return user if user.get("exp", 0) > time.time() else None


def _call(url, data=None, token=None):
    headers = {"User-Agent": UA}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def register(app, log):
    @app.route("/api/discord/app")
    def discord_app():
        """The page asks which Discord app it's running in (the app id is public, the secret is not)."""
        ready = bool(CONFIG.get("DISCORD_CLIENT_SECRET"))
        return jsonify(client_id=CONFIG.get("DISCORD_CLIENT_ID", "") if ready else "")

    @app.route("/api/discord/token", methods=["POST"])
    def discord_token():
        if not CONFIG.get("DISCORD_CLIENT_SECRET"):
            return jsonify(error="Discord sign-in isn't set up on the games server (server/discord.env)."), 503
        code = str((request.get_json(silent=True) or {}).get("code", ""))[:200]
        if not code:
            return jsonify(error="No sign-in code."), 400
        try:
            tok = _call(API + "/oauth2/token", {
                "client_id": CONFIG["DISCORD_CLIENT_ID"], "client_secret": CONFIG["DISCORD_CLIENT_SECRET"],
                "grant_type": "authorization_code", "code": code})
            me = _call(API + "/users/@me", token=tok["access_token"])
        except (urllib.error.URLError, KeyError, ValueError) as e:
            detail = e.read().decode(errors="replace")[:200] if isinstance(e, urllib.error.HTTPError) else repr(e)
            log(f"discord sign-in failed: {detail}")
            return jsonify(error="Discord didn't accept the sign-in. Close the activity and open it again."), 502
        user = {"id": str(me["id"]), "name": (me.get("global_name") or me.get("username") or "Player")[:32],
                "avatar": me.get("avatar") or ""}
        log(f"discord sign-in: {user['name']}")
        return jsonify(access_token=tok["access_token"], user=user, ticket=make_ticket(user))
