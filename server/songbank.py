"""ACE Songbank: songs clan members make, shown on song.aceclan.lol.

Each song has a title, who made it, tags, lyrics and (optionally) an audio file. Everyone can read
them through play.aceclan.lol; only Jerry's control panel on this PC can add, change or delete them
(the /api/songs/admin/ routes answer only to programs on this PC, never through the tunnel).

Stored in server/saved/songs/: songs.json, plus audio/<id>.<ext>.
"""
import json
import os
import re
import secrets
import threading
import time

from flask import abort, jsonify, request, send_from_directory

AUDIO_TYPES = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".wav": "audio/wav",
               ".opus": "audio/ogg", ".flac": "audio/flac", ".webm": "audio/webm"}
MAX_AUDIO = 40 * 1024 * 1024
SONG_ID = re.compile(r"^[a-z0-9]{10}$")
LIMITS = {"title": 100, "by": 80, "lyrics": 20000, "notes": 2000}
MAX_TAGS = 10

_lock = threading.Lock()


def register(app, server_dir):
    root = os.environ.get("ACE_SONGS_DIR") or os.path.join(server_dir, "saved", "songs")   # override for testing
    audio_dir = os.path.join(root, "audio")
    db = os.path.join(root, "songs.json")
    os.makedirs(audio_dir, exist_ok=True)

    def load():
        try:
            with open(db, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return []

    def save(songs):
        tmp = db + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(songs, f, ensure_ascii=False, indent=1)
        os.replace(tmp, db)

    def from_this_pc():
        """Jerry calls these from this PC with no Origin. Anything through the tunnel has Cf-Ray,
        and a web page trying to post to localhost has an Origin, so both are turned away."""
        return (request.remote_addr == "127.0.0.1" and not request.headers.get("Cf-Ray")
                and not request.headers.get("Origin"))

    def clean(form, song):
        for key, most in LIMITS.items():
            if key in form:
                text = str(form.get(key) or "").replace("\r\n", "\n").strip()
                song[key] = text[:most] if key in ("lyrics", "notes") else " ".join(text.split())[:most]
        if "tags" in form:
            tags = []
            for t in re.split(r"[,#]", str(form.get("tags") or "")):
                t = " ".join(t.split()).lower()[:24]
                if t and t not in tags:
                    tags.append(t)
            song["tags"] = tags[:MAX_TAGS]

    def take_audio(song):
        f = request.files.get("audio")
        if not f or not f.filename:
            return None
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in AUDIO_TYPES:
            return "Audio must be " + ", ".join(sorted(AUDIO_TYPES)) + "."
        data = f.read(MAX_AUDIO + 1)
        if len(data) > MAX_AUDIO:
            return f"Audio is too big (most {MAX_AUDIO // (1024 * 1024)} MB)."
        if not data:
            return "That audio file is empty."
        drop_audio(song)
        name = song["id"] + ext
        with open(os.path.join(audio_dir, name), "wb") as out:
            out.write(data)
        song["audio"] = name
        song["audio_size"] = len(data)
        return None

    def drop_audio(song):
        if song.get("audio"):
            try:
                os.remove(os.path.join(audio_dir, song["audio"]))
            except OSError:
                pass
        song.pop("audio", None)
        song.pop("audio_size", None)

    def public(song):
        out = {k: song.get(k, "") for k in ("id", "title", "by", "lyrics", "notes", "added", "updated")}
        out["tags"] = song.get("tags", [])
        out["audio"] = bool(song.get("audio"))
        return out

    @app.after_request
    def songs_cors(resp):
        if request.path.startswith("/api/songs/") and not request.path.startswith("/api/songs/admin/"):
            resp.headers["Access-Control-Allow-Origin"] = "*"
        return resp

    @app.route("/api/songs/list")
    def songs_list():
        with _lock:
            songs = load()
        songs.sort(key=lambda s: s.get("added", 0), reverse=True)
        resp = jsonify(songs=[public(s) for s in songs])
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.route("/api/songs/audio/<song_id>")
    def songs_audio(song_id):
        if not SONG_ID.match(song_id):
            abort(404)
        with _lock:
            song = next((s for s in load() if s["id"] == song_id), None)
        if not song or not song.get("audio"):
            abort(404)
        ext = os.path.splitext(song["audio"])[1]
        resp = send_from_directory(audio_dir, song["audio"], mimetype=AUDIO_TYPES.get(ext),
                                   conditional=True, max_age=3600)
        return resp

    # ---- admin (Jerry's Songbank tab, this PC only) ----
    def admin_guard():
        if not from_this_pc():
            abort(403)

    @app.route("/api/songs/admin/add", methods=["POST"])
    def songs_add():
        admin_guard()
        song = {"id": secrets.token_hex(5), "added": int(time.time())}
        clean(request.form, song)
        if not song.get("title"):
            return jsonify(ok=False, error="Give the song a title."), 400
        with _lock:
            err = take_audio(song)
            if err:
                return jsonify(ok=False, error=err), 400
            if not song.get("lyrics") and not song.get("audio"):
                return jsonify(ok=False, error="Add lyrics, an audio file, or both."), 400
            songs = load()
            songs.append(song)
            save(songs)
        return jsonify(ok=True, song=public(song))

    @app.route("/api/songs/admin/edit", methods=["POST"])
    def songs_edit():
        admin_guard()
        song_id = request.form.get("id", "")
        with _lock:
            songs = load()
            song = next((s for s in songs if s["id"] == song_id), None)
            if not song:
                return jsonify(ok=False, error="That song isn't in the bank any more."), 404
            clean(request.form, song)
            if not song.get("title"):
                return jsonify(ok=False, error="Give the song a title."), 400
            if request.form.get("remove_audio") == "1":
                drop_audio(song)
            err = take_audio(song)
            if err:
                return jsonify(ok=False, error=err), 400
            song["updated"] = int(time.time())
            save(songs)
        return jsonify(ok=True, song=public(song))

    @app.route("/api/songs/admin/delete", methods=["POST"])
    def songs_delete():
        admin_guard()
        song_id = (request.get_json(silent=True) or request.form or {}).get("id", "")
        with _lock:
            songs = load()
            song = next((s for s in songs if s["id"] == song_id), None)
            if not song:
                return jsonify(ok=False, error="That song isn't in the bank any more."), 404
            drop_audio(song)
            songs.remove(song)
            save(songs)
        return jsonify(ok=True)
