# games.aceclan.lol

ACE Clan's party games. This is a separate site from the main clan site (aceclan.lol) and the
Hypixel tools (hypixel.aceclan.lol). Plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages,
plus a small Python server for online rooms.

## How it fits together

- **The website** (everything except `server/`) is on GitHub Pages at https://games.aceclan.lol. It's always up.
- **The live server** (`server/`) runs on the ACE host's PC and is reached at https://play.aceclan.lol through
  its own Cloudflare Tunnel (`ace-games`), the same way Jerry uses jerry.aceclan.lol. Online rooms only work
  while it's running. The page checks the server and says when it's offline; one-screen play always works.

Start the server with **`Games server.bat`** in `G:\AceClan`. It starts the tunnel too, and closing the window
stops both. Rooms live in memory, so restarting the server ends any games in progress.

## Files

- `index.html`: landing page listing the games. Add a card here for each new game.
- `shared/site.css`: the shared ACE look (colours, top bar, buttons). Every page links it.
- `shared/live.js`: connects a game page to the live server (player id, name, server check).
- `agents/`: Ace Agents, a two-team word game.
  - `index.html`: start screen, board, online panels and the one-screen key view.
  - `main.js`: picks the mode from the link (`?room=KQTZ` online, `?code=FALCON-42` one screen).
  - `online.js`: online mode; sends moves to the server and draws what it sends back.
  - `local.js`: one-screen mode; works without the server.
  - `words.js`: word packs (Classic). The server reads this file too, so edit packs only here.
  - `style.css`: styles for this game only.
- `shared/room.js` and `shared/room.css`: the start screen, lobby and room panel (players, leader, admin panel,
  log) for the seated games below. Each of those games only draws its own board.
- `snakes/`: Snakes & Ladders, the classic race game for 2 to 6 players (`snakes.js` draws the board).
- `server/`: the live server.
  - `server.py`: rooms, players and the Socket.IO connection. Also serves this folder for local testing.
  - `games/agents.py`: Ace Agents rules. The server checks every move and only sends the key to spymasters.
  - `games/base.py`: lobby, seats and admin panel shared by the seated games.
  - `games/snakes.py`: Snakes & Ladders rules. The server rolls the die.
  - `games/__init__.py`: list of games the server can host.
  - `cloudflared.yml`: tunnel settings for play.aceclan.lol. The tunnel's secret credentials stay in
    `C:\Users\User\.cloudflared`, not here.

## Online rooms

The room creator is the **leader** (called "host" in the code). Each game starts in a lobby with the board dark;
players pick a team (or press Random team) and the leader presses **Start game** to light up the board.

Once a game starts, teams are locked: players can't switch. The leader's **Admin panel** can still move anyone
to any team or role, or hand over leader, and every admin action is written to the game log as `[Admin] ...`
so everyone can see it. The leader can also deal a new game (back to the lobby, teams kept), make random teams
(lobby only) and undo. If the leader leaves, anyone still in the room can do those.

Players who join mid-game start out watching until the leader moves them in. Players get a random id saved in
their browser, so refreshing the page puts them back in the same seat. Rooms close after 6 hours without activity.

## Adding another game

1. Make a folder next to `agents/` with its own `index.html`, linking `../shared/site.css` and `../shared/live.js`.
2. For online play, write a rules module in `server/games/` (with `new_state`, `default_seat`, `handle` and
   `view`, like `agents.py`) and add it to `server/games/__init__.py`.
3. Add a card for it in the root `index.html`.

## Running it locally

```
python server/server.py --local
```

Then open http://localhost:5050. `--local` skips the tunnel, so nobody outside your PC can join.
