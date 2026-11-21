// The clan's daily puzzle number, shared by the daily games (Squads, Map Pin, ACE Mini, Sound Check). It is the same number
// ACEdle uses: days start at midnight in Adelaide, and RIOT API can move it on early (Jerry's
// "Make new day" button). If RIOT API can't be reached, it uses the date plus the last early start
// this browser heard about. On this PC, ?day=N picks a day for testing.
//
//   const DAY = await AceDay.today();
//   const r = AceDay.rng(DAY, salt);      // the same random numbers for everyone today
//   AceDay.untilNext()                    // "5h 12m" to the next midnight
window.AceDay = (() => {
  "use strict";
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const RIOT = LOCAL ? "http://localhost:5080" : "https://riot.aceclan.lol";
  const START = Date.UTC(2026, 10, 18), OFFSET = 10.5 * 3600e3, DAY_MS = 86400e3;
  const calendarDay = () => Math.floor((Date.now() + OFFSET - START) / DAY_MS) + 1;

  async function today() {
    const test = LOCAL && +new URLSearchParams(location.search).get("day");
    if (test) return test;
    const remembered = () => { try { return +localStorage.getItem("acedle-skipped") || 0; } catch { return 0; } };
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(RIOT + "/acedle/today", { signal: ctl.signal, cache: "no-store" });
      clearTimeout(timer);
      const d = await r.json();
      try { localStorage.setItem("acedle-skipped", String(d.skipped || 0)); } catch { /* fine */ }
      return d.day;
    } catch {
      return calendarDay() + remembered();
    }
  }

  function rng(day, salt) {
    let a = (Math.imul(day, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, r) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function untilNext() {
    const next = START + calendarDay() * DAY_MS - OFFSET, ms = Math.max(0, next - Date.now());
    return `${Math.floor(ms / 3600e3)}h ${Math.floor(ms / 60e3) % 60}m`;
  }

  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: no saving */ } },
  };

  return { today, rng, shuffle, untilNext, store, LOCAL };
})();
