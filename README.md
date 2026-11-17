# games.aceclan.lol

ACE Clan's party games. This is a separate site from the main clan site (aceclan.lol) and the
Hypixel tools (hypixel.aceclan.lol). Plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages.

- `index.html`: landing page listing the games. Add a card here for each new game.
- `shared/site.css`: the shared ACE look (colours, top bar, buttons). Every page links it.
- `agents/`: Ace Agents, a two-team word game.
  - `index.html`: the board view and the spymaster key view (`?view=key`).
  - `app.js`: game rules, turns, clues, undo and the key.
  - `words.js`: word packs (Classic, Gamer). Add a pack by adding a key to `WORD_PACKS`.
  - `style.css`: styles for this game only.

## How Ace Agents games are shared

The board is built from the game code and word pack in the link (`?code=FALCON-42&pack=classic`), so
everyone who opens the same link sees the same 25 words, and the spymaster link shows the matching key.
Only the board host's browser keeps track of which cards are revealed (saved in localStorage), so one person
hosts the board and shares their screen in Discord.

Editing a word pack changes the board that a code makes, so old links show different words afterwards.

## Adding another game

Make a folder next to `agents/` with its own `index.html`, link `../shared/site.css`, and add a card for it
in the root `index.html`.

## Running it locally

```
python -m http.server 8766
```

Then open http://localhost:8766.
