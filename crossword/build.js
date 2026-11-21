// ACE Mini: builds the day's 5x5 crossword from words.txt. Everyone gets the same grid because the
// word order comes from the day's random numbers. Used by the page and by tests in Node.
//
//   AceMini.parse(text)              -> [{ word, clue }]
//   AceMini.build(words, rng)        -> { size, cells, entries: [{ num, dir, row, col, word, clue }] }
(function (root) {
  "use strict";
  const SIZE = 5, TRIES = 400;

  function parse(text) {
    const out = [], seen = new Set();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const [w, ...rest] = line.split("|");
      const word = w.trim().toUpperCase(), clue = rest.join("|").trim();
      if (/^[A-Z]{3,5}$/.test(word) && clue && !seen.has(word)) { seen.add(word); out.push({ word, clue }); }
    }
    return out.sort((a, b) => a.word.localeCompare(b.word));
  }

  const shuffle = (list, r) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  // One attempt: start with a word, then keep adding words that cross what's there.
  function attempt(words, r) {
    const letter = Array.from({ length: SIZE }, () => Array(SIZE).fill(""));
    const used = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ({ a: false, d: false })));
    const placed = [];
    const at = (row, col) => row >= 0 && col >= 0 && row < SIZE && col < SIZE ? letter[row][col] : "";

    function fits(w, row, col, dir) {
      const dr = dir === "d" ? 1 : 0, dc = dir === "a" ? 1 : 0;
      const endR = row + dr * (w.length - 1), endC = col + dc * (w.length - 1);
      if (endR >= SIZE || endC >= SIZE) return false;
      if (at(row - dr, col - dc) || at(endR + dr, endC + dc)) return false;      // nothing touching either end
      let crosses = 0;
      for (let i = 0; i < w.length; i++) {
        const R = row + dr * i, C = col + dc * i, have = letter[R][C];
        if (have) {
          if (have !== w[i] || used[R][C][dir]) return false;
          crosses++;
        } else if (at(R - dc, C - dr) || at(R + dc, C + dr)) {
          return false;                                                          // would make a stray two-letter run
        }
      }
      return placed.length ? crosses > 0 && crosses < w.length : true;
    }
    function put(e) {
      const dr = e.dir === "d" ? 1 : 0, dc = e.dir === "a" ? 1 : 0;
      for (let i = 0; i < e.word.length; i++) {
        letter[e.row + dr * i][e.col + dc * i] = e.word[i];
        used[e.row + dr * i][e.col + dc * i][e.dir] = true;
      }
      placed.push(e);
    }

    const order = shuffle(words, r);
    let progress = true;
    while (progress) {
      progress = false;
      for (const w of order) {
        if (placed.some(p => p.word === w.word)) continue;
        const spots = [];
        for (const dir of ["a", "d"]) for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++)
          if (fits(w.word, row, col, dir)) spots.push({ ...w, row, col, dir });
        if (!spots.length) continue;
        put(spots[Math.floor(r() * spots.length)]);
        progress = true;
      }
    }
    const filled = letter.flat().filter(Boolean).length;
    return { letter, placed, score: placed.length * 100 + filled };
  }

  function build(words, rng) {
    let best = null;
    for (let i = 0; i < TRIES; i++) {
      const a = attempt(words, rng);
      if (!best || a.score > best.score) best = a;
    }
    // Number the clues the usual way: reading order of the squares where words start.
    const starts = [...new Set(best.placed.map(p => p.row * SIZE + p.col))].sort((x, y) => x - y);
    const entries = best.placed.map(p => ({ num: starts.indexOf(p.row * SIZE + p.col) + 1, dir: p.dir, row: p.row, col: p.col, word: p.word, clue: p.clue }))
      .sort((x, y) => (x.dir === y.dir ? 0 : x.dir === "a" ? -1 : 1) || x.num - y.num);
    return { size: SIZE, cells: best.letter, entries };
  }

  const api = { parse, build, SIZE };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AceMini = api;
})(this);
