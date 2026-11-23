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
stops both. Rooms live in memory, so restarting the server ends any games in progress (ACE Board saves its boards to disk, so
those come back).

## Files

- `index.html`: landing page listing the games. Add a card here for each new game.
- `shared/site.css`: the shared ACE look (colours, top bar, buttons). Every page links it.
- `shared/live.js`: connects a game page to the live server (player id, name, server check).
- `shared/fx.js` and `shared/fx.css`: effects every game uses: sounds made in the browser (with the Sound
  on/off button in the top bar), cards and chips sliding between places, confetti and the end-of-game
  banner, and player avatars. They respect the "reduce motion" setting.
- `agents/`: Ace Agents, a two-team word game.
  - `index.html`: start screen, board, online panels and the one-screen key view.
  - `main.js`: picks the mode from the link (`?room=KQTZ` online, `?code=FALCON-42` one screen).
  - `online.js`: online mode; sends moves to the server and draws what it sends back.
  - `local.js`: one-screen mode; works without the server.
  - `words.js`: word packs (Classic, League, VALORANT). The server reads this file too, so edit packs only here.
  - `style.css`: styles for this game only.
- `shared/room.js` and `shared/room.css`: the start screen, lobby and room panel (players, leader, admin panel,
  log) for the seated games below. Each of those games only draws its own board.
- `snakes/`: Snakes & Ladders, the classic race game for 2 to 6 players (`snakes.js` draws the board).
- `trivia/`: Clan Trivia, multiple-choice questions against the clock.
  - `questions.js`: the question packs (General knowledge, Video games, History, and Clan & gaming for your
    own questions). The leader ticks any mix of packs. One question per line, right answer first. The server
    reads this file too; restart it after editing.
- `poker/`: Ace Poker Night, Texas hold'em for points (never real money), 2 to 9 players.
- `canasta/`: Canasta, classic rules for 2 to 4 players (4 play as two teams of 2).
- `board/`: ACE Board, a shared live whiteboard for ideas and studying: text, sticky notes, pen, highlighter, boxes,
  circles, lines and arrows, and pasted or dropped pictures. The board has no edges and fills the window (with a
  full-screen button); middle-click drag or Space+drag moves around, the scroll wheel or a pinch zooms, and the target
  button goes back to the middle (0, 0). Drag a box to select several things; Ctrl+C / Ctrl+V and Ctrl+D copy them.
  Everyone's pointer shows live with their name. Ctrl+Z / Ctrl+Y undo and redo your own changes. The leader can delete
  anyone's things. No turns and no points. Each player's eye button hides or shows that player's writing (and pointer),
  on your own screen only. Download picture saves the board as a PNG. Pictures are shrunk in the browser before
  they're sent (`board.js`); the server caps their size.
  PDFs and Word (.docx) files can be dropped on or added too: the browser turns each page into a picture (up to 30
  pages a document) with the file name above, so everyone can write and draw on them. PDFs are drawn with pdf.js;
  Word files are laid out with docx-preview and photographed with html2canvas (the libraries load only when a
  document is added, and the server only ever sees pictures). Old .doc files aren't supported.
  Boards have names instead of codes: the start page makes one by name and lists every board (people in it now
  first), each with Open and Copy link. A board's link is `board/?b=<name-as-slug>` (e.g. `?b=biology-revision`),
  and the open board's panel shows it with a Copy button. Boards are kept for good; only the person who made one
  can delete it.
- `shared/cards.js`: draws playing cards for poker and canasta (corner indices and face-card art).
- `shared/board.js` and `shared/board.css`: the clan leaderboard (Today and All time) on the results of the daily
  games ACE Mini, Squads and Map Pin (Map Pin has one board for VALORANT and one for League). Scores are kept by
  RIOT API (`riot.aceclan.lol`, the same program as ACEdle's leaderboard), which works the points out again from
  what the page sends. Its rules for each game are in `riot.aceclan.lol/server.py`, under "Daily game leaderboards".
  Sound Check has no board: it's endless and just for fun.
- `server/`: the live server.
  - `server.py`: rooms, players and the Socket.IO connection. Also serves this folder for local testing.
  - `games/agents.py`: Ace Agents rules. The server checks every move and only sends the key to spymasters.
  - `games/base.py`: lobby, seats and admin panel shared by the seated games.
  - `games/snakes.py`: Snakes & Ladders rules. The server rolls the die.
  - `games/trivia.py`: Clan Trivia rules. The server runs the timers and keeps answers secret until time's up.
  - `games/poker.py`: poker rules: dealing, blinds, betting rounds, side pots and hand ranking. Hole cards
    only go to their owner until a showdown.
  - `games/canasta.py`: Canasta rules: melds, wild cards, the frozen pile, red and black 3s, going out and scoring.
  - `games/board.py`: ACE Board. Keeps every item, lets people change only their own (the leader can delete
    anyone's), and caps picture sizes (700 KB each, 150 pictures and 30 MB a board). Changes go out as live messages; the whole board
    is only sent to a tab that doesn't have it yet. A board's room name is `b:<slug>` (picked by the game through
    `room_key()`, which `server.py` asks for instead of making a 4-letter code). Boards are saved to
    `server/saved/boards/<slug>.json` (not in git; line 1 is a summary, line 2 the board) a few seconds after each
    change and kept until their maker deletes them (`closed()` then shuts the room). Opening a link after a restart
    brings the board back (`restore_room` in `server.py`). `GET /api/board/list` gives the list for the start page
    (`listing()`). At most 300 boards. Boards saved under the old 4-letter codes are turned into "Board ABCD" the
    first time the list is read. `ACE_BOARD_DIR` moves the save folder (for testing on a second port).
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

### The seated games

Poker, trivia, canasta and snakes & ladders share one lobby and room panel (`shared/room.js`,
`server/games/base.py`). Players take a seat or watch; the leader picks the settings and presses **Start game**,
which fixes the seat order. Mid-game, seats are locked: the leader's admin panel can hand an away player's seat to
someone watching, skip a turn, or end the game, and each of these is logged as `[Admin] ...`. In Snakes & Ladders, Ace Poker Night and Canasta
the leader can **Add bot** in the lobby, or hand an away player's seat to a bot from the admin panel; bots
play from the server (`bot_move` in each game's rules), and a bot moved to watching leaves. In Clan Trivia,
anyone can take a seat mid-quiz and starts on 0 points. Hidden things (cards in hand, the trivia answer before
time's up) never leave the server except to the player allowed to see them.

## Adding another game

1. Make a folder next to `agents/` with its own `index.html`, linking `../shared/site.css` and `../shared/live.js`.
2. For online play, write a rules module in `server/games/` (with `new_state`, `default_seat`, `handle` and
   `view`, like `agents.py`) and add it to `server/games/__init__.py`. A turn-based game with seats can
   subclass `base.SeatedGame` and use `shared/room.js` on the page, like `snakes.py` and `snakes/`.
   Link `../shared/fx.css` and load `../shared/fx.js` before `room.js`.
   A game with a clock can add a `tick(room, now)` method; the server calls it a few times a second.
3. Add a card for it in the root `index.html`.

## Running it locally

```
python server/server.py --local
```

Then open http://localhost:5050. `--local` skips the tunnel, so nobody outside your PC can join.
