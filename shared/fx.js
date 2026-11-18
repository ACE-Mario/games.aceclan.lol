// Shared effects for the games: sounds (made in the browser, no files), the sound on/off button,
// things flying from one place to another, numbers counting up, lists sliding into a new order,
// confetti, the end-of-game banner and player avatars.
//
//   AceFX.sound("ding")                 // flick, deal, chip, roll, hop, climb, slide, ding, chime,
//                                       // buzz, tick, flip, win, lose
//   AceFX.soundButton()                 // puts the sound toggle in the site bar (once)
//   AceFX.fly(fromEl, toEl, { ghost })  // a copy of toEl (or ghost) travels from fromEl to toEl
//   AceFX.countUp(el, from, to, fmt)
//   const snap = AceFX.snap(list); ...redraw...; AceFX.slide(list, snap)   // children need data-key
//   AceFX.confetti(); AceFX.banner("You win!", "Alice wins with 500 points", true)
//   AceFX.avatar(name, i)               // a round badge with the first letter, in player colour i
window.AceFX = (() => {
  "use strict";
  const COLORS = ["#ff4655", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#64748b"];
  const still = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window: just don't remember */ } },
  };

  // ---- Sound ------------------------------------------------------------------------------
  let ctx = null;
  let muted = store.get("ace-sound") === "off";
  function audio() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { ctx = new C(); } catch { return null; }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }
  // Browsers only allow sound after the player has clicked or typed something.
  const unlock = () => { if (!muted) audio(); };
  addEventListener("pointerdown", unlock, { passive: true });
  addEventListener("keydown", unlock);

  function tone(a, { f = 440, f2 = null, type = "sine", dur = 0.15, vol = 0.2, at = 0, attack = 0.005 }) {
    const t = a.currentTime + at;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  function noise(a, { dur = 0.08, vol = 0.3, at = 0, freq = 2500, q = 1, type = "bandpass", f2 = null }) {
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = a.currentTime + at;
    const src = a.createBufferSource(), flt = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf;
    flt.type = type;
    flt.frequency.setValueAtTime(freq, t);
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    flt.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(a.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
  const notes = (a, list, step, opts = {}) => list.forEach((f, i) => tone(a, { f, at: i * step, ...opts }));
  const SOUNDS = {
    flick: a => noise(a, { dur: 0.07, vol: 0.4, freq: 3200, q: 0.9 }),
    deal: a => { noise(a, { dur: 0.09, vol: 0.35, freq: 1800, f2: 4200, q: 0.7 }); },
    flip: a => { noise(a, { dur: 0.12, vol: 0.3, freq: 900, f2: 3000, q: 0.6 }); tone(a, { f: 520, dur: 0.08, vol: 0.05, at: 0.06 }); },
    chip: a => { tone(a, { f: 2600, type: "triangle", dur: 0.05, vol: 0.12 }); tone(a, { f: 3400, type: "triangle", dur: 0.05, vol: 0.09, at: 0.045 }); },
    roll: a => { for (let i = 0; i < 7; i++) noise(a, { dur: 0.04, vol: 0.35, freq: 1400 + Math.random() * 900, q: 2, at: i * 0.06 + i * i * 0.006 }); },
    hop: a => tone(a, { f: 520, f2: 760, type: "triangle", dur: 0.09, vol: 0.12 }),
    climb: a => tone(a, { f: 330, f2: 990, type: "triangle", dur: 0.55, vol: 0.14 }),
    slide: a => tone(a, { f: 880, f2: 160, type: "sawtooth", dur: 0.6, vol: 0.06 }),
    ding: a => { tone(a, { f: 988, dur: 0.6, vol: 0.18 }); tone(a, { f: 1480, dur: 0.5, vol: 0.08, at: 0.01 }); },
    chime: a => notes(a, [660, 880, 1320], 0.08, { dur: 0.35, vol: 0.14, type: "triangle" }),
    buzz: a => tone(a, { f: 190, f2: 120, type: "square", dur: 0.32, vol: 0.06 }),
    tick: a => tone(a, { f: 1250, type: "square", dur: 0.03, vol: 0.05 }),
    win: a => { notes(a, [523, 659, 784], 0.12, { dur: 0.3, vol: 0.14, type: "triangle" }); tone(a, { f: 1047, dur: 0.8, vol: 0.16, type: "triangle", at: 0.36 }); },
    lose: a => notes(a, [392, 349, 294], 0.16, { dur: 0.35, vol: 0.1, type: "triangle" }),
  };
  function sound(name) {
    if (muted || !SOUNDS[name]) return;
    const a = audio();
    if (!a || a.state !== "running") return;
    try { SOUNDS[name](a); } catch { /* sound is a nice-to-have */ }
  }
  function setMuted(m) {
    muted = !!m;
    store.set("ace-sound", muted ? "off" : "on");
    document.querySelectorAll(".sound-btn").forEach(paintSoundBtn);
    if (!muted) { audio(); setTimeout(() => sound("ding"), 30); }
  }
  function paintSoundBtn(b) {
    b.textContent = muted ? "🔇 Sound off" : "🔊 Sound on";
    b.setAttribute("aria-pressed", String(!muted));
    b.title = muted ? "Turn game sounds on" : "Turn game sounds off";
  }
  function soundButton() {
    if (document.querySelector(".sound-btn")) return;
    const nav = document.querySelector(".sitebar nav");
    if (!nav) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sound-btn";
    paintSoundBtn(b);
    b.addEventListener("click", () => setMuted(!muted));
    nav.appendChild(b);
  }

  // ---- Motion -----------------------------------------------------------------------------
  const rectOf = x => (x && x.getBoundingClientRect ? x.getBoundingClientRect() : x);

  // A copy of `to` (or opts.ghost) flies from `from` to where `to` is; `to` stays hidden till it lands.
  function fly(from, to, opts = {}) {
    if (!from || !to || still()) return Promise.resolve();
    let a = rectOf(from);
    const b = rectOf(to);
    if (!a || !b || !b.width || (!a.width && !a.height && !a.x && !a.y)) return Promise.resolve();
    if (a.width > b.width * 1.6) {                 // from a big area (a hand, a panel): start from its middle
      a = { left: a.left + a.width / 2 - b.width / 2, top: a.top + a.height / 2 - b.height / 2, width: b.width, height: b.height };
    }
    const ghost = opts.ghost || to.cloneNode(true);
    ghost.classList.add("fx-ghost");
    Object.assign(ghost.style, {
      position: "fixed", left: b.left + "px", top: b.top + "px", width: b.width + "px", height: b.height + "px",
      margin: "0", zIndex: "60", pointerEvents: "none", translate: "none", rotate: "none",
    });
    document.body.appendChild(ghost);
    if (!opts.ghost) to.style.visibility = "hidden";
    const dx = (a.left + a.width / 2) - (b.left + b.width / 2), dy = (a.top + a.height / 2) - (b.top + b.height / 2);
    const s0 = a.width && b.width ? Math.max(0.3, Math.min(2, a.width / b.width)) : 1;
    const spin = opts.spin ?? 0;
    const anim = ghost.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(${spin}deg)`, opacity: opts.fade ? 0.2 : 1 },
      { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1 },
    ], { duration: opts.duration || 420, delay: opts.delay || 0, easing: "cubic-bezier(.2,.75,.25,1)", fill: "backwards" });
    if (opts.sound) setTimeout(() => sound(opts.sound), opts.delay || 0);
    return anim.finished.catch(() => {}).then(() => {
      ghost.remove();
      if (!opts.ghost) to.style.visibility = "";
    });
  }

  function countUp(el, from, to, fmt = n => String(n), ms = 700) {
    if (!el) return;
    if (still() || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Remember where each [data-key] child is, then after a redraw slide them from there.
  function snap(list) {
    const m = new Map();
    if (list) for (const c of list.children) if (c.dataset.key) m.set(c.dataset.key, c.getBoundingClientRect());
    return m;
  }
  function slide(list, before) {
    if (!list || !before || still()) return;
    for (const c of list.children) {
      const old = before.get(c.dataset.key);
      if (!old) continue;
      const now = c.getBoundingClientRect();
      const dy = old.top - now.top, dx = old.left - now.left;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 550, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }

  // Replays a CSS animation class on an element.
  function pulse(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ---- Celebrations -----------------------------------------------------------------------
  function confetti(count = 160) {
    if (still()) return;
    const c = document.createElement("canvas");
    c.className = "fx-confetti";
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    document.body.appendChild(c);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const cols = ["#ff4655", "#a78bfa", "#c89b3c", "#3fbf7f", "#3b82f6", "#f4f1ea"];
    const bits = Array.from({ length: count }, (_, i) => ({
      x: innerWidth * (i % 2 ? 0.15 : 0.85) + (Math.random() - 0.5) * 80, y: innerHeight * 0.75,
      vx: (i % 2 ? 1 : -1) * (2 + Math.random() * 6), vy: -(9 + Math.random() * 9),
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 5, col: cols[i % cols.length],
    }));
    const t0 = performance.now();
    const frame = now => {
      g.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.vy += 0.32; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        g.save(); g.translate(b.x, b.y); g.rotate(b.r);
        g.fillStyle = b.col; g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2)) + 1);
        g.restore();
      }
      if (now - t0 < 3800) requestAnimationFrame(frame); else c.remove();
    };
    requestAnimationFrame(frame);
  }

  let bannerTimer = 0;
  function banner(title, sub, good) {
    document.querySelectorAll(".fx-banner").forEach(b => b.remove());
    const d = document.createElement("div");
    d.className = "fx-banner" + (good ? " good" : "");
    d.setAttribute("role", "status");
    d.innerHTML = "<div><strong></strong><span></span><small>Tap to close</small></div>";
    d.querySelector("strong").textContent = title;
    d.querySelector("span").textContent = sub || "";
    const close = () => { d.classList.add("out"); setTimeout(() => d.remove(), 300); };
    d.addEventListener("click", close);
    document.body.appendChild(d);
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(close, 4200);
  }

  // ---- Avatars ----------------------------------------------------------------------------
  const color = i => COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];
  function avatar(name, i, extra = "") {
    const a = document.createElement("span");
    a.className = "avatar " + extra;
    a.style.setProperty("--av", color(i));
    a.textContent = (String(name || "?").trim()[0] || "?").toUpperCase();
    a.setAttribute("aria-hidden", "true");
    return a;
  }

  return {
    sound, soundButton, setMuted, get muted() { return muted; },
    fly, countUp, snap, slide, pulse, confetti, banner, avatar, color, COLORS, still,
  };
})();
