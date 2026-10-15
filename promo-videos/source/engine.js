/* CTRL+AI promo engine.
 *
 * engine.html?style=<id> builds one 60-second kinetic-typography ad and
 * exposes `seek(t)`, which places every element for time t (seconds).
 * Nothing animates by itself, so render.cjs can step through frames and
 * every frame is exactly reproducible. Scene times come from the music
 * timeline (`audio/<id>.json`, written by music.py), so cuts land on the
 * beat.
 */
"use strict";

const Q = new URLSearchParams(location.search);
const SID = Q.get("style") || "01-neon-house";
const SHOTS = Q.get("shots") || "shots/";
const TL_URL = Q.get("tl") || `audio/${SID}.json`;

// ------------------------------------------------------------------ math
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, x) => a + (b - a) * x;
const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const E = {
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inCubic: (x) => x * x * x,
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  outElastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
};

// ------------------------------------------------------------------ dom
function h(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
const css = (e, o) => Object.assign(e.style, o);
const show = (e, on) => { e.style.visibility = on ? "visible" : "hidden"; };

/* Kinetic text. `spec` is a string; "\n" breaks lines and {cls|text}
   wraps text in a class (e.g. {accent|끝!}). Every character is its own
   span so styles can move them one by one. */
class KText {
  constructor(parent, spec, cls = "", opts = {}) {
    this.el = h("div", "k " + cls, parent);
    this.chars = [];
    this.lines = [];
    this.masked = !!opts.mask;
    const lines = spec.split("\n");
    lines.forEach((ln) => {
      const line = h("span", "line", this.el);
      const holder = this.masked ? h("span", "mask", line) : line;
      const inner = h("span", "", holder);
      inner.style.display = "inline-block";
      this.lines.push(inner);
      const re = /\{([\w -]+)\|([^}]*)\}/g;
      let last = 0, m;
      const parts = [];
      while ((m = re.exec(ln))) {
        if (m.index > last) parts.push(["", ln.slice(last, m.index)]);
        parts.push([m[1], m[2]]);
        last = re.lastIndex;
      }
      if (last < ln.length) parts.push(["", ln.slice(last)]);
      for (const [c, txt] of parts) {
        const holderSpan = c ? h("span", c, inner) : inner;
        for (const word of txt.split(/(\s+)/)) {
          if (!word) continue;
          const w = h("span", "w", holderSpan);
          for (const ch of word) {
            const s = h("span", "c", w, ch === " " ? "&nbsp;" : ch);
            this.chars.push(s);
          }
        }
      }
    });
  }
  fit(maxW) {
    const w = this.el.getBoundingClientRect().width;
    if (w > maxW) {
      const fs = parseFloat(getComputedStyle(this.el).fontSize);
      this.el.style.fontSize = (fs * maxW) / w + "px";
    }
  }
}

// ------------------------------------------------------------------ copy
const STEPS = ["로그인", "Chat", "Project Builder", "Video Generator", "CtrlAIApps"];

// rectangles are [x, y, w, h] in screenshot pixels (2160 × 1350)
const R = {
  loginCard: [780, 259, 600, 832], google: [823, 488, 513, 61], fields: [823, 640, 513, 330], fieldsIn: [823, 640, 513, 245],
  chatMain: [702, 0, 1458, 1350], chatInputZone: [800, 1040, 1280, 290], chatInput: [841, 1201, 1175, 84],
  chatConv: [850, 110, 1170, 380], chatBtn: [841, 504, 365, 54], chatBtnZone: [780, 230, 1000, 380],
  bFull: [370, 20, 1790, 1310], bPreview: [702, 340, 950, 990], bClaude: [1600, 860, 540, 470],
  bClaudeInput: [1679, 1091, 427, 113], bTop: [1250, 20, 900, 360], bActions: [1355, 38, 760, 54],
  vFull: [370, 20, 1790, 1310], vPrompt: [392, 240, 467, 179], vPromptZone: [360, 170, 560, 330],
  vPreview: [908, 203, 1141, 931], vButtons: [1381, 1245, 733, 43], vButtonsZone: [1280, 1120, 860, 220],
  aList: [370, 30, 1790, 900], aCards: [405, 352, 1266, 544],
  dTop: [405, 106, 1695, 542], dRun: [1309, 461, 99, 53], dEmbed: [405, 691, 1695, 659],
};
const mid = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];

function stepDefs() {
  return [
    {
      name: "login", num: "01", title: "로그인은\n{a|이렇게~}",
      base: [[0, "01-login"]],
      cam: [[0, R.loginCard], [0.22, R.google], [0.52, R.fields], [0.84, R.loginCard]],
      ring: [[0.22, 0.48, R.google], [0.52, 0.84, R.fields]],
      cursor: [[0.1, 1300, 1000], [0.24, ...mid(R.google)], [0.5, 1000, 720]], clicks: [0.36],
      reveal: { img: "02-login-filled", from: 0.56, to: 0.76, rect: R.fieldsIn, x0: 835, x1: 990 },
      captions: [[0.0, "가입하고 들어오면 끝"], [0.22, "{hl|Google로 계속하기}\n한 번이면 OK"], [0.52, "{hl|아이디·비밀번호}로도\n로그인할 수 있어요"], [0.84, "처음이면\n{hl|초대 코드}로 가입!"]],
    },
    {
      name: "chat", num: "02", title: "Chat에\n{a|그냥 말해요}",
      base: [[0, "03-chat-home"], [0.44, "05-chat-reply"]],
      cam: [[0, R.chatMain], [0.12, R.chatInputZone], [0.44, R.chatConv, true], [0.74, R.chatBtnZone]],
      ring: [[0.74, 1, R.chatBtn]],
      cursor: [[0.1, 1500, 900], [0.34, 1972, 1243], [0.6, 1400, 700], [0.76, ...mid(R.chatBtn)]], clicks: [0.4, 0.9],
      reveal: { img: "04-chat-typed", from: 0.14, to: 0.34, rect: R.chatInput, band: [925, 1214, 1395, 58], colorAt: [1500, 1243] },
      captions: [[0.0, "궁금한 것도, 만들고 싶은 것도"], [0.12, "하고 싶은 걸\n{hl|그냥 적으면}"], [0.44, "{hl|이렇게 바로}\n답해 줘요~"], [0.74, "버튼 하나로\n{hl|앱 만들기}까지"]],
    },
    {
      name: "builder", num: "03", title: "앱은\n{a|말로 만들어요}",
      base: [[0, "13-builder-project"]],
      cam: [[0, R.bFull], [0.18, R.bPreview], [0.5, R.bClaude], [0.8, R.bTop]],
      ring: [[0.5, 0.78, R.bClaudeInput], [0.8, 1, R.bActions]],
      cursor: [[0.45, 1500, 900], [0.52, ...mid(R.bClaudeInput)], [0.82, 2040, 64]], clicks: [0.56, 0.92],
      typed: { from: 0.56, to: 0.74, rect: R.bClaudeInput, text: "버튼 색을 주황색으로 바꿔 줘", colorAt: [1700, 1190] },
      captions: [[0.0, "코드를 몰라도 괜찮아요"], [0.18, "설명만 하면\n{hl|앱이 뚝딱}"], [0.5, "고치고 싶으면?\n{hl|말로 하면 끝}"], [0.8, "버전 저장 · 게시까지\n{hl|클릭 한 번}"]],
    },
    {
      name: "video", num: "04", title: "영상도\n{a|말로 만들어요}",
      base: [[0, "07b-video-detail"]],
      cam: [[0, R.vFull], [0.16, R.vPromptZone], [0.46, R.vPreview], [0.76, R.vButtonsZone]],
      ring: [[0.16, 0.44, R.vPrompt], [0.76, 1, R.vButtons]],
      cursor: [[0.4, 1200, 700], [0.5, 1478, 820], [0.78, 1480, 1266]], clicks: [0.56],
      captions: [[0.0, "아이디어만 있으면 돼요"], [0.16, "원하는 장면을\n{hl|한국어로} 적으면"], [0.46, "AI가 {hl|영상으로}\n만들어 줘요"], [0.76, "다시 생성 · 이어서 만들기\n{hl|YouTube 게시}까지"]],
    },
    {
      name: "apps", num: "05", title: "만들면\n{a|함께 나눠요}",
      base: [[0, "08-apps"], [0.5, "12-app-detail"]],
      cam: [[0, R.aList], [0.14, R.aCards], [0.5, R.dTop, true], [0.74, R.dEmbed]],
      ring: [[0.5, 0.72, R.dRun]],
      cursor: [[0.3, 1100, 650], [0.52, ...mid(R.dRun)]], clicks: [0.64],
      captions: [[0.0, "게시하면 모두의 앱"], [0.14, "회원들이 만든 앱이\n{hl|CtrlAIApps}에 모여요"], [0.5, "{hl|앱 실행} 한 번이면"], [0.74, "누구나 {hl|바로 써 봐요}"]],
    },
  ];
}

// ------------------------------------------------------------------ styles
/* Each style sets the format, the screenshot theme, the copy for the
   kinetic scenes, and how text, screens, backgrounds and cuts move. */
const STYLES = {
  "01-neon-house": {
    cls: "s-neon", fmt: "h", theme: "dark",
    hook: [[0, "코딩?"], [2, "{accent|몰라도} 돼."], [4, "말만 해."], [6, "AI가"], [7, "{cyan|만들어 줄게.}"], [8, "{accent|앱.}"], [9, "{cyan|영상.}"], [10, "웹페이지."], [11, "{accent|뭐든지.}"]],
    flashCls: (i) => ["glow", "glow", "glow"][i % 3],
    cta: ["말하면,", "{accent|만들어 준다.}"],
    textIn(kt, p) {
      kt.chars.forEach((c, i) => {
        const q = E.outExpo(seg(p - i * 0.022, 0, 0.45));
        c.style.transform = `translateY(${(1 - q) * 0.45}em) scale(${1 + (1 - q) * 0.7})`;
        c.style.opacity = q;
        c.style.filter = q < 1 ? `blur(${(1 - q) * 10}px)` : "none";
      });
      const a = (1 - seg(p, 0, 0.35)) * 16;
      kt.el.style.textShadow = a > 0.1 ? `${a}px 0 rgba(255,0,110,.85), ${-a}px 0 rgba(0,240,255,.85)` : "";
    },
    screenIn(s, p, t) {
      const q = E.outExpo(seg(p, 0, 0.7));
      s.style.transform = `perspective(2200px) rotateY(${lerp(35, -7, q) + Math.sin(t * 0.8) * 1.5}deg) rotateX(${3 + Math.sin(t * 0.6) * 1}deg) translateX(${(1 - q) * 300}px)`;
      s.style.opacity = q;
    },
  },
  "02-swiss-garage": {
    cls: "s-swiss", fmt: "h", theme: "light", mask: true,
    hook: [[0, "아이디어는\n있는데"], [2, "코딩은\n{accent|모른다면?}"], [4, "괜찮아요."], [6, "말하면"], [7, "{accent|만들어\n줍니다.}"], [8, "앱"], [9, "영상"], [10, "웹페이지"], [11, "{accent|전부.}"]],
    flashCls: () => "",
    flashBg: (i) => (i % 2 === 1 ? ["#ff3b1f", "#f1efe9"] : ["#f1efe9", "#0d0d0d"]),
    cta: ["말하면,", "{accent|만들어 준다.}"],
    textIn(kt, p) {
      kt.lines.forEach((ln, i) => {
        const q = E.outExpo(seg(p - i * 0.07, 0, 0.55));
        ln.style.transform = `translateY(${(1 - q) * 115}%)`;
      });
    },
    screenIn(s, p) {
      const q = E.outExpo(seg(p, 0, 0.6));
      s.style.transform = `translateX(${(1 - q) * 1300}px)`;
    },
  },
  "03-y2k-jersey": {
    cls: "s-y2k", fmt: "v", theme: "light",
    hook: [[0, "앱 만들기?"], [2, "영상 만들기?"], [4, "어렵지\n않아~"], [6, "말로"], [7, "하면 끝!"], [8, "진짜로"], [10, "말만 해!"]],
    flashCls: (i) => ["chrome", "pop", "lime"][i % 3],
    cta: ["말하면,", "만들어 준다!"],
    textIn(kt, p) {
      kt.chars.forEach((c, i) => {
        const q = seg(p - i * 0.035, 0, 0.7);
        const e = E.outElastic(q);
        c.style.transform = `scale(${e}) rotate(${(1 - Math.min(1, q * 1.6)) * (rnd(i + kt.chars.length) * 50 - 25)}deg)`;
        c.style.opacity = q > 0 ? 1 : 0;
      });
    },
    screenIn(s, p, t) {
      const q = E.outElastic(seg(p, 0, 0.9));
      s.style.transform = `scale(${0.3 + 0.7 * q}) rotate(${(1 - Math.min(1, p * 2)) * -8 + Math.sin(t * 1.3) * 0.8}deg)`;
      s.style.opacity = p > 0 ? 1 : 0;
    },
  },
  "04-phonk-drift": {
    cls: "s-phonk", fmt: "v", theme: "dark",
    hook: [[0, "코드 {red|X}"], [1, "API {red|X}"], [2, "설정 {red|X}"], [4, "필요한 건"], [6, "{red|말 한마디.}"], [8, "말하면"], [10, "{red|만든다.}"]],
    flashCls: () => "",
    cta: ["말하면,", "{red|만든다.}"],
    textIn(kt, p) {
      const q = seg(p, 0, 0.16);
      const sy = lerp(2.8, 1, E.outCubic(q));
      const jx = (rnd(Math.floor(p * 30) + 3) - 0.5) * 30 * (1 - seg(p, 0, 0.45));
      kt.el.style.transform = `translateX(${jx}px) scaleY(${sy})`;
      kt.el.style.filter = p < 0.06 ? "invert(1)" : "none";
    },
    screenIn(s, p, t) {
      const jx = (rnd(Math.floor(t * 30)) - 0.5) * 22 * (1 - seg(p, 0, 0.3));
      s.style.transform = `translateX(${jx}px) scale(${lerp(1.15, 1, E.outCubic(seg(p, 0, 0.18)))})`;
      s.style.filter = p < 0.05 ? "invert(1)" : "none";
    },
  },
  "05-pop-pastel": {
    cls: "s-pop", fmt: "h", theme: "light",
    hook: [[0, "오늘은"], [1, "뭘 {accent|만들어} 볼까?"], [4, "말하면"], [6, "{peach|만들어 줘요}"], [8, "앱도"], [9, "영상도"], [10, "{accent|전부!}"]],
    flashCls: () => "",
    cta: ["말하면,", "{accent|만들어 준다.}"],
    textIn(kt, p) {
      kt.chars.forEach((c, i) => {
        const r = seg(p - i * 0.03, 0, 0.5);
        const q = E.outBack(r);
        c.style.transform = `translateY(${(1 - q) * 0.7}em) scale(${0.5 + 0.5 * q})`;
        c.style.opacity = seg(p - i * 0.03, 0, 0.15);
      });
    },
    screenIn(s, p, t) {
      const q = E.outBack(seg(p, 0, 0.7));
      s.style.transform = `translateY(${(1 - q) * 400 + Math.sin(t * 1.1) * 6}px) rotate(${(1 - q) * 4}deg)`;
      s.style.opacity = seg(p, 0, 0.2);
    },
  },
};

const S = STYLES[SID];
const V = S.fmt === "v";
const W = V ? 1080 : 1920;
const H = V ? 1920 : 1080;
const L = V
  ? { tag: [0, 150], title: [40, 240, 1000], screen: [50, 560, 980, 900], caption: [40, 1530, 1000], steps: 1840 }
  : { tag: [110, 150], title: [110, 222, 640], screen: [800, 150, 1020, 680], caption: [110, 640, 650], steps: 975 };

// ------------------------------------------------------------------ backgrounds
const NOISE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='240' height='240' filter='url(%23n)' opacity='.9'/></svg>\")";
const STAR = (fill) => `<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M50 0 C55 38 62 45 100 50 C62 55 55 62 50 100 C45 62 38 55 0 50 C38 45 45 38 50 0Z" fill="${fill}" stroke="#1a0b2e" stroke-width="4"/></svg>`;

function buildBackground(root) {
  const bg = h("div", "layer", root);
  const fg = h("div", "layer", root);
  fg.style.zIndex = 40;
  fg.style.pointerEvents = "none";
  const grain = h("div", "layer", fg);
  css(grain, { backgroundImage: NOISE, opacity: 0.06, mixBlendMode: "overlay" });
  const B = { bg, fg, grain };

  if (S.cls === "s-neon") {
    B.blobs = ["#7c3aed", "#06b6d4", "#c026d3"].map((c) => {
      const b = h("div", "abs", bg);
      css(b, { width: "900px", height: "900px", borderRadius: "50%", background: `radial-gradient(circle, ${c} 0%, transparent 65%)`, opacity: 0.55, filter: "blur(30px)" });
      return b;
    });
    B.grid = h("div", "abs", bg);
    css(B.grid, { left: "-50%", width: "200%", top: "58%", height: "70%", transformOrigin: "50% 0", transform: "perspective(500px) rotateX(64deg)",
      backgroundImage: "linear-gradient(rgba(168,85,247,.55) 2px, transparent 2px), linear-gradient(90deg, rgba(168,85,247,.55) 2px, transparent 2px)",
      backgroundSize: "90px 90px", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 40%)" });
    B.flash = h("div", "layer", fg);
    css(B.flash, { background: "#a855f7", mixBlendMode: "screen" });
    const vig = h("div", "layer", fg);
    css(vig, { background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.7) 100%)" });
    grain.style.opacity = 0.09;
  }
  if (S.cls === "s-swiss") {
    const grid = h("div", "layer", bg);
    css(grid, { backgroundImage: "repeating-linear-gradient(90deg, rgba(13,13,13,.07) 0 2px, transparent 2px 160px)" });
    B.dot = h("div", "abs", bg);
    css(B.dot, { width: "560px", height: "560px", borderRadius: "50%", background: "#ff3b1f" });
    B.big = h("div", "abs latin", bg, "01");
    css(B.big, { fontSize: "760px", lineHeight: "1", color: "transparent", WebkitTextStroke: "3px rgba(13,13,13,.16)", right: "-40px", bottom: "-120px" });
    B.tick = h("div", "abs", fg);
    css(B.tick, { left: 0, right: 0, bottom: 0, height: "58px", background: "#0d0d0d", overflow: "hidden" });
    B.tickText = h("div", "abs latin", B.tick, ("CTRL+AI — 말하면 만들어 준다 — CHAT · BUILDER · VIDEO · APPS — ").repeat(8));
    css(B.tickText, { top: "9px", whiteSpace: "nowrap", color: "#f1efe9", fontSize: "30px", letterSpacing: ".02em" });
    grain.style.opacity = 0.05;
  }
  if (S.cls === "s-y2k") {
    B.mesh = h("div", "layer", bg);
    B.stars = [0, 1, 2, 3, 4, 5].map((i) => {
      const s = h("div", "abs", bg, STAR(["#d4ff3a", "#ffffff", "#ff5fbf", "#6ae4ff", "#ffd23f", "#ffffff"][i]));
      const size = [150, 90, 120, 70, 110, 80][i];
      css(s, { width: size + "px", height: size + "px", left: [60, 880, 820, 120, 900, 40][i] + "px", top: [420, 300, 1500, 1660, 980, 1200][i] + "px" });
      return s;
    });
    B.tapes = [0, 1].map((i) => {
      const tape = h("div", "abs", fg);
      css(tape, { left: "-200px", right: "-200px", top: i ? "1800px" : "40px", height: "74px", background: i ? "#1a0b2e" : "#d4ff3a", border: "4px solid #1a0b2e", transform: `rotate(${i ? 4 : -4}deg)`, overflow: "hidden" });
      const tx = h("div", "abs", tape, ("CTRL+AI ✦ 말하면 만들어 줌 ✦ ").repeat(10));
      css(tx, { top: "10px", whiteSpace: "nowrap", fontSize: "40px", color: i ? "#d4ff3a" : "#1a0b2e" });
      return tx;
    });
    const dots = h("div", "layer", fg);
    css(dots, { backgroundImage: "radial-gradient(rgba(26,11,46,.12) 2px, transparent 2.5px)", backgroundSize: "26px 26px" });
    grain.style.opacity = 0.05;
  }
  if (S.cls === "s-phonk") {
    B.rows = [0, 1, 2, 3].map((i) => {
      const r = h("div", "abs latin", bg, ("CTRL+AI ").repeat(10));
      css(r, { top: 80 + i * 470 + "px", fontSize: "420px", lineHeight: "1", whiteSpace: "nowrap", color: "transparent", WebkitTextStroke: "3px rgba(255,30,60,.22)", transform: "scaleY(1.4)" });
      return r;
    });
    B.red = h("div", "layer", bg);
    css(B.red, { background: "radial-gradient(ellipse at center, rgba(255,30,60,.0) 30%, rgba(255,30,60,.55) 100%)" });
    const scan = h("div", "layer", fg);
    css(scan, { backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 2px, transparent 2px 5px)" });
    B.flash = h("div", "layer", fg);
    css(B.flash, { background: "#fff" });
    grain.style.opacity = 0.12;
  }
  if (S.cls === "s-pop") {
    const g = h("div", "layer", bg);
    css(g, { background: "linear-gradient(135deg, #efe8ff 0%, #f9eefc 45%, #ffe9dc 100%)" });
    B.blobs = [0, 1, 2, 3, 4].map((i) => {
      const b = h("div", "abs", bg);
      const c = [["#c9b8ff", "#e9e1ff"], ["#ffc6dd", "#ffe6f0"], ["#ffd3b8", "#fff0e6"], ["#b8ecff", "#e6f8ff"], ["#d6f5c9", "#f0fbe9"]][i];
      const size = [520, 380, 440, 300, 260][i];
      css(b, { width: size + "px", height: size + "px", background: `linear-gradient(135deg, ${c[0]}, ${c[1]})`, opacity: 0.85 });
      return b;
    });
    B.spark = [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const s = h("div", "abs", bg, `<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M50 5 C54 40 60 46 95 50 C60 54 54 60 50 95 C46 60 40 54 5 50 C40 46 46 40 50 5Z" fill="${["#7c5cff", "#ff7ac8", "#ffb03a"][i % 3]}"/></svg>`);
      css(s, { width: "46px", height: "46px", left: [180, 1700, 1500, 90, 960, 1820, 700][i] + "px", top: [120, 90, 930, 880, 60, 540, 990][i] + "px" });
      return s;
    });
    const dots = h("div", "layer", bg);
    css(dots, { backgroundImage: "radial-gradient(rgba(124,92,255,.14) 2px, transparent 2.5px)", backgroundSize: "34px 34px" });
    grain.style.opacity = 0.035;
  }
  return B;
}

function updateBackground(B, t, beat, scene) {
  const bp = (t % beat) / beat;
  const pulse = Math.exp(-(t % beat) / 0.11);
  const loud = scene && ["drop", "outro"].includes(scene.section);
  B.grain.style.backgroundPosition = `${Math.floor(rnd(Math.floor(t * 30)) * 240)}px ${Math.floor(rnd(Math.floor(t * 30) + 9) * 240)}px`;
  if (S.cls === "s-neon") {
    B.blobs.forEach((b, i) => {
      b.style.left = 960 + Math.sin(t * 0.35 + i * 2.1) * 700 - 450 + "px";
      b.style.top = 540 + Math.cos(t * 0.28 + i * 1.7) * 380 - 450 + "px";
      b.style.transform = `scale(${1 + pulse * (loud ? 0.08 : 0.03)})`;
    });
    B.grid.style.backgroundPosition = `0 ${(t * 160) % 90}px`;
    B.flash.style.opacity = pulse * (loud ? 0.1 : 0.04);
  }
  if (S.cls === "s-swiss") {
    const i = scene ? scene.index : 0;
    const spots = [[1300, 120], [1350, 420], [1480, 640], [1520, -240], [1460, 660], [1540, -220], [1480, 640], [1400, 520], [1400, 520]];
    const a = spots[Math.max(0, i - 1) % spots.length], b = spots[i % spots.length];
    const q = E.outExpo(seg(t, scene.start, scene.start + 0.7));
    B.dot.style.left = lerp(a[0], b[0], q) + "px";
    B.dot.style.top = lerp(a[1], b[1], q) + "px";
    B.dot.style.transform = `scale(${1 + pulse * 0.03})`;
    B.dot.style.opacity = ["login", "chat", "builder", "video", "apps"].includes(scene.name) ? 0.95 : 0.0;
    B.big.textContent = scene.num || "";
    B.big.style.transform = `translateY(${(1 - E.outExpo(seg(t, scene.start, scene.start + 0.8))) * 300}px)`;
    B.tickText.style.transform = `translateX(${-((t * 140) % 1400)}px)`;
  }
  if (S.cls === "s-y2k") {
    const p = (k, a, f) => 50 + Math.sin(t * f + k) * a;
    B.mesh.style.background = `radial-gradient(at ${p(0, 30, 0.5)}% ${p(1, 25, 0.4)}%, #ff6ad5 0, transparent 45%), radial-gradient(at ${p(2, 35, 0.37)}% ${p(3, 30, 0.45)}%, #6ae4ff 0, transparent 45%), radial-gradient(at ${p(4, 30, 0.42)}% ${p(5, 35, 0.33)}%, #c6ff4d 0, transparent 40%), radial-gradient(at ${p(6, 40, 0.3)}% ${p(7, 30, 0.5)}%, #a78bfa 0, transparent 45%), #ffd1f1`;
    B.stars.forEach((s, i) => {
      s.style.transform = `rotate(${t * (i % 2 ? 40 : -55) + i * 30}deg) scale(${1 + (i % 2 === Math.floor(t / beat) % 2 ? pulse * 0.35 : 0)})`;
    });
    B.tapes.forEach((tx, i) => { tx.style.transform = `translateX(${(i ? 1 : -1) * ((t * 160) % 900) - (i ? 900 : 0)}px)`; });
  }
  if (S.cls === "s-phonk") {
    B.rows.forEach((r, i) => { r.style.transform = `translateX(${(i % 2 ? 1 : -1) * ((t * 220) % 1500) - (i % 2 ? 1500 : 0)}px) scaleY(1.4)`; });
    const kickPulse = loud ? pulse : pulse * 0.4;
    B.red.style.opacity = 0.25 + kickPulse * 0.6;
    B.flash.style.opacity = loud && Math.floor(t / beat) % 4 === 0 ? Math.max(0, 1 - (t % beat) / 0.05) * 0.25 : 0;
  }
  if (S.cls === "s-pop") {
    B.blobs.forEach((b, i) => {
      b.style.left = [-120, 1500, 1350, 700, 300][i] + Math.sin(t * 0.4 + i) * 60 + "px";
      b.style.top = [-140, -100, 720, 820, 600][i] + Math.cos(t * 0.33 + i * 2) * 50 + "px";
      const r = (k) => 40 + Math.sin(t * 0.7 + i + k) * 12;
      b.style.borderRadius = `${r(0)}% ${100 - r(0)}% ${r(1)}% ${100 - r(1)}% / ${r(2)}% ${r(3)}% ${100 - r(3)}% ${100 - r(2)}%`;
      b.style.transform = `scale(${1 + pulse * 0.025})`;
    });
    B.spark.forEach((s, i) => { s.style.transform = `scale(${0.5 + (i % 2 === Math.floor(t / beat) % 2 ? pulse * 0.8 : 0.1)}) rotate(${t * 30}deg)`; });
  }
}

// ------------------------------------------------------------------ cuts
function buildWipe(root) {
  const w = h("div", "wipe", root);
  css(w, { left: 0, top: 0, width: W + "px", height: H + "px" });
  if (S.cls === "s-y2k") { css(w, { width: "2600px", height: "2600px", borderRadius: "50%", background: "#d4ff3a", border: "10px solid #1a0b2e", left: W / 2 - 1300 + "px", top: H / 2 - 1300 + "px" }); }
  if (S.cls === "s-pop") { css(w, { width: "2600px", height: "2600px", borderRadius: "50%", background: "linear-gradient(135deg, #c9b8ff, #ffc6dd)", left: W / 2 - 1300 + "px", top: H / 2 - 1300 + "px" }); }
  if (S.cls === "s-swiss") w.style.background = "#ff3b1f";
  if (S.cls === "s-neon") { w.style.background = "#fff"; w.style.mixBlendMode = "screen"; }
  if (S.cls === "s-phonk") w.style.background = "#fff";
  return w;
}

function updateWipe(w, t, cuts) {
  let d = 99;
  for (const c of cuts) if (Math.abs(t - c) < Math.abs(d)) d = t - c;
  w.style.visibility = "hidden";
  if (S.cls === "s-neon" && Math.abs(d) < 0.13) {
    show(w, true); w.style.opacity = (1 - Math.abs(d) / 0.13) * 0.85; w.style.background = d < 0 ? "#fff" : "#5eeaff";
  }
  if (S.cls === "s-phonk" && d >= 0 && d < 0.1) {
    show(w, true); w.style.opacity = d < 0.04 ? 1 : 0.5; w.style.background = d < 0.04 ? "#fff" : "#ff1e3c";
  }
  if (S.cls === "s-swiss" && d > -0.26 && d < 0.26) {
    show(w, true);
    const x = d < 0 ? lerp(-W, 0, E.inOutCubic(seg(d, -0.26, 0))) : lerp(0, W, E.inOutCubic(seg(d, 0, 0.26)));
    w.style.transform = `translateX(${x}px)`;
  }
  if ((S.cls === "s-y2k" || S.cls === "s-pop") && d > -0.28 && d < 0.3) {
    show(w, true);
    if (d < 0) { w.style.transform = `scale(${E.inCubic(seg(d, -0.28, 0))})`; w.style.opacity = 1; }
    else if (S.cls === "s-y2k") { w.style.transform = `translateY(${-E.inOutCubic(seg(d, 0, 0.3)) * 2600}px)`; w.style.opacity = 1; }
    else { w.style.transform = "scale(1)"; w.style.opacity = 1 - seg(d, 0, 0.3); }
  }
}

// ------------------------------------------------------------------ screen
const CURSOR = `<svg viewBox="0 0 24 24" width="44" height="44"><path d="M4 2.5 L19.5 13 L12.6 14.1 L16.4 21.2 L13.6 22.6 L9.9 15.6 L4.9 20.3 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const IMG_W = 2160, IMG_H = 1350;

class Screen {
  constructor(parent, def) {
    const [x, y, w, hh] = L.screen;
    this.root = h("div", "screen", parent);
    css(this.root, { left: x + "px", top: y + "px", width: w + "px", height: hh + "px" });
    const bar = h("div", "bar", this.root, "<i></i><i></i><i></i>");
    h("span", "url", bar, "ctrlai.my");
    this.view = h("div", "view", this.root);
    this.vw = w; this.vh = hh - 40;
    this.stage = h("div", "stage", this.view);
    this.def = def;
    this.imgs = {};
    const names = def.base.map((b) => b[1]).concat(def.reveal ? [def.reveal.img] : []);
    for (const n of names) {
      if (this.imgs[n]) continue;
      const im = h("img", "", this.stage);
      im.src = `${SHOTS}${S.theme}-${n}.png`;
      this.imgs[n] = im;
    }
    if (def.reveal) this.imgs[def.reveal.img].style.zIndex = 2;
    this.ring = h("div", "ring", this.view);
    this.ripple = h("div", "ripple", this.view);
    this.cursor = h("div", "cursor", this.view, CURSOR);
    if (def.reveal && def.reveal.band) this.cover = h("div", "abs", this.view);
    if (def.typed) {
      this.typed = h("div", "typed", this.view);
      this.typedText = h("span", "", this.typed);
    }
  }
  async sample() {
    if (this.cover) {
      const rv = this.def.reveal;
      const im = this.imgs[rv.img];
      await im.decode();
      const c = document.createElement("canvas");
      c.width = IMG_W; c.height = IMG_H;
      c.getContext("2d").drawImage(im, 0, 0);
      const d = c.getContext("2d").getImageData(rv.colorAt[0], rv.colorAt[1], 1, 1).data;
      this.cover.style.background = `rgb(${d[0]},${d[1]},${d[2]})`;
      this.cover.style.zIndex = 1;
    }
    if (!this.def.typed) return;
    const im = this.imgs[this.def.base[0][1]];
    await im.decode();
    const c = document.createElement("canvas");
    c.width = IMG_W; c.height = IMG_H;
    const g = c.getContext("2d");
    g.drawImage(im, 0, 0);
    const [px, py] = this.def.typed.colorAt;
    const d = g.getImageData(px, py, 1, 1).data;
    this.typed.style.background = `rgb(${d[0]},${d[1]},${d[2]})`;
    this.typed.style.color = S.theme === "dark" ? "#ececf1" : "#17171a";
  }
  frame(r) {
    // grow r to the view's aspect, with a margin, then clamp to the image
    const A = this.vw / this.vh;
    let [x, y, w, hh] = r;
    const m = 1.1;
    let cw = w * m, ch = hh * m;
    if (cw / ch < A) cw = ch * A; else ch = cw / A;
    const cx = x + w / 2, cy = y + hh / 2;
    const s = this.vw / cw;
    let tx = this.vw / 2 - cx * s, ty = this.vh / 2 - cy * s;
    if (IMG_W * s >= this.vw) tx = clamp(tx, this.vw - IMG_W * s, 0); else tx = (this.vw - IMG_W * s) / 2;
    if (IMG_H * s >= this.vh) ty = clamp(ty, this.vh - IMG_H * s, 0); else ty = (this.vh - IMG_H * s) / 2;
    return [s, tx, ty];
  }
  update(lt, tf) {
    const def = this.def;
    // which screenshot
    let cur = def.base[0][1];
    for (const [f, n] of def.base) if (lt >= tf(f)) cur = n;
    for (const [n, im] of Object.entries(this.imgs)) {
      if (def.reveal && n === def.reveal.img) continue;
      im.style.opacity = n === cur ? 1 : 0;
    }
    // camera
    let k = 0;
    for (let i = 0; i < def.cam.length; i++) if (lt >= tf(def.cam[i][0])) k = i;
    const kf = def.cam[k];
    const start = tf(kf[0]);
    const prev = k > 0 && !kf[2] ? this.frame(def.cam[k - 1][1]) : this.frame(kf[1]);
    const next = this.frame(kf[1]);
    const q = E.inOutCubic(seg(lt, start, start + 0.6));
    let [s, tx, ty] = [0, 1, 2].map((i) => lerp(prev[i], next[i], q));
    // slow push-in while holding
    const hold = lt - start;
    const z = 1 + Math.min(hold, 6) * 0.012;
    tx = this.vw / 2 - (this.vw / 2 - tx) * z;
    ty = this.vh / 2 - (this.vh / 2 - ty) * z;
    s *= z;
    this.stage.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    const toView = (px, py) => [tx + px * s, ty + py * s];

    // typing reveal from a second screenshot
    if (def.reveal) {
      const rv = def.reveal, im = this.imgs[rv.img];
      const a = tf(rv.from), b = tf(rv.to);
      if (this.cover) show(this.cover, false);
      if (lt < a) im.style.opacity = 0;
      else {
        im.style.opacity = 1;
        const p = seg(lt, a, b);
        const steps = 14;
        const pq = Math.floor(p * steps) / steps;
        if (rv.band) {
          // the whole input from the typed screenshot, with the not-yet-typed
          // part painted over in the input's own colour
          im.style.clipPath = `inset(${rv.rect[1]}px ${IMG_W - rv.rect[0] - rv.rect[2]}px ${IMG_H - rv.rect[1] - rv.rect[3]}px ${rv.rect[0]}px)`;
          const [bx, by, bx1, bh] = rv.band;
          const left = lerp(bx, bx1, pq);
          const [vx, vy] = toView(left, by);
          const hidden = p < 1 && !(lt > tf(def.base[def.base.length - 1][0]) && def.base.length > 1);
          show(this.cover, hidden);
          css(this.cover, { left: vx + "px", top: vy + "px", width: Math.max(0, (bx1 - left) * s) + "px", height: bh * s + "px" });
        } else {
          const right = p >= 1 ? rv.rect[0] + rv.rect[2] : lerp(rv.x0, rv.x1, pq);
          im.style.clipPath = `inset(${rv.rect[1]}px ${IMG_W - right}px ${IMG_H - rv.rect[1] - rv.rect[3]}px ${rv.rect[0]}px)`;
        }
        if (lt > tf(def.base[def.base.length - 1][0]) && def.base.length > 1) im.style.opacity = 0;
      }
    }
    // typed text drawn on top of an input
    if (def.typed) {
      const ty_ = def.typed, a = tf(ty_.from), b = tf(ty_.to);
      if (lt < a) show(this.typed, false);
      else {
        show(this.typed, true);
        const [vx, vy] = toView(ty_.rect[0] + 6, ty_.rect[1] + 6);
        css(this.typed, { left: vx + "px", top: vy + "px", width: (ty_.rect[2] - 12) * s + "px", height: (ty_.rect[3] - 12) * s + "px", fontSize: 25 * s + "px", padding: `${10 * s}px ${12 * s}px` });
        const n = Math.floor(seg(lt, a, b) * ty_.text.length);
        const caret = Math.floor(lt * 2.5) % 2 ? "|" : " ";
        this.typedText.textContent = ty_.text.slice(0, n) + caret;
      }
    }
    // highlight ring
    show(this.ring, false);
    for (const [a, b, r] of def.ring || []) {
      const ta = tf(a), tb = tf(b);
      if (lt >= ta && lt < tb) {
        const p = lt - ta;
        const e = E.outBack(seg(p, 0, 0.35));
        const [vx, vy] = toView(r[0], r[1]);
        const pad = 8;
        css(this.ring, { left: vx - pad + "px", top: vy - pad + "px", width: r[2] * s + pad * 2 + "px", height: r[3] * s + pad * 2 + "px", transform: `scale(${lerp(1.25, 1, e)})`, opacity: seg(p, 0, 0.15) * (1 - seg(lt, tb - 0.12, tb)) });
        show(this.ring, true);
      }
    }
    // cursor and clicks
    show(this.cursor, false); show(this.ripple, false);
    if (def.cursor && lt >= tf(def.cursor[0][0])) {
      let j = 0;
      for (let i = 0; i < def.cursor.length; i++) if (lt >= tf(def.cursor[i][0])) j = i;
      const a = def.cursor[Math.max(0, j - 1)], b = def.cursor[j];
      const mq = j === 0 ? 1 : E.inOutCubic(seg(lt, tf(b[0]), tf(b[0]) + 0.5));
      const [cx, cy] = toView(lerp(a[1], b[1], mq), lerp(a[2], b[2], mq));
      let press = 1;
      for (const c of def.clicks || []) {
        const d = lt - tf(c);
        if (d >= 0 && d < 0.45) {
          press = 1 - 0.18 * Math.sin(Math.PI * seg(d, 0, 0.18));
          const rr = 10 + E.outCubic(seg(d, 0, 0.45)) * 70;
          css(this.ripple, { left: cx - rr + "px", top: cy - rr + "px", width: rr * 2 + "px", height: rr * 2 + "px", opacity: 1 - seg(d, 0, 0.45) });
          show(this.ripple, true);
        }
      }
      this.cursor.style.transform = `translate(${cx - 6}px, ${cy - 4}px) scale(${press})`;
      show(this.cursor, true);
    }
  }
}

// ------------------------------------------------------------------ scenes
function textBlock(parent, spec, cls, x, y, maxW, align = "left") {
  const box = h("div", "abs", parent);
  css(box, { left: x + "px", top: y + "px", width: maxW + "px", textAlign: align });
  const kt = new KText(box, spec, cls, { mask: S.mask });
  kt.box = box;
  kt.maxW = maxW;
  return kt;
}

function buildScenes(root, tl) {
  const beat = tl.beat;
  const scenes = [];
  const steps = stepDefs();
  let stepIdx = 0;
  tl.scenes.forEach((sc, index) => {
    const node = h("div", "layer", root);
    const scene = { ...sc, index, node, dur: sc.end - sc.start, texts: [] };
    const nb = Math.round(scene.dur / beat);
    const tf = (f) => Math.round(f * nb) * beat;
    scene.tf = tf;
    const bigSize = V ? 170 : 210;

    if (sc.name === "hook") {
      scene.flashes = S.hook.map(([b, txt], i) => {
        const kt = textBlock(node, txt, "flash-t " + S.flashCls(i), 60, 0, W - 120, "center");
        kt.el.style.fontSize = bigSize + "px";
        kt.el.style.lineHeight = "1.05";
        return { at: b * beat, kt, i };
      });
      scene.update = (lt) => {
        let cur = -1;
        scene.flashes.forEach((f, i) => { if (lt >= f.at) cur = i; });
        scene.flashes.forEach((f, i) => {
          show(f.kt.box, i === cur);
          if (i === cur) S.textIn(f.kt, lt - f.at);
        });
        if (S.flashBg) {
          const [bg, fg] = cur >= 0 ? S.flashBg(cur) : S.flashBg(0);
          node.style.background = bg; node.style.color = fg;
          node.classList.toggle("on-red", bg === "#ff3b1f");
        }
      };
    } else if (sc.name === "brand") {
      const logo = textBlock(node, "CTRL{plus|+}AI", "latin brand-logo " + (S.cls === "s-y2k" ? "chrome" : S.cls === "s-neon" ? "glow" : ""), 40, 0, W - 80, "center");
      logo.el.style.fontSize = (S.cls === "s-phonk" ? 320 : V ? 190 : 250) + "px";
      const plusColor = { "s-neon": "#c6ff3d", "s-swiss": "#ff3b1f", "s-y2k": "#ff3fb4", "s-phonk": "#ff1e3c", "s-pop": "#7c5cff" }[S.cls];
      logo.el.querySelectorAll(".plus").forEach((e) => { e.style.color = plusColor; e.style.webkitTextFillColor = plusColor; });
      const sub = textBlock(node, V ? "함께 만들고 함께 나누는\nAI 창작 커뮤니티" : "함께 만들고 함께 나누는 AI 창작 커뮤니티", "", 40, 0, W - 80, "center");
      sub.el.style.fontSize = (V ? 66 : 58) + "px";
      const chips = textBlock(node, V ? "Chat · Builder\nVideo · Apps" : "Chat · Project Builder · Video · CtrlAIApps", "latin", 40, 0, W - 80, "center");
      chips.el.style.fontSize = (V ? 62 : 44) + "px";
      chips.el.style.opacity = 0.75;
      scene.items = [[0, logo], [2 * beat, sub], [4 * beat, chips]];
      scene.layout = () => {
        const hs = scene.items.map(([, k]) => k.box.getBoundingClientRect().height);
        const gap = V ? 50 : 34;
        let y = (H - (hs.reduce((a, b) => a + b, 0) + gap * 2)) / 2;
        scene.items.forEach(([, k], i) => { k.box.style.top = y + "px"; y += hs[i] + gap; });
      };
      scene.update = (lt) => scene.items.forEach(([at, k]) => { show(k.box, lt >= at); if (lt >= at) S.textIn(k, lt - at); });
    } else if (sc.name === "wallet") {
      const a = textBlock(node, "분기마다", "", 40, 0, W - 80, "center");
      a.el.style.fontSize = (V ? 110 : 100) + "px";
      const num = textBlock(node, "{num|80,000}원", "latin", 40, 0, W - 80, "center");
      num.el.style.fontSize = (V ? 200 : 230) + "px";
      const accent = { "s-neon": "#c6ff3d", "s-swiss": "#ff3b1f", "s-y2k": "#ffffff", "s-phonk": "#ff1e3c", "s-pop": "#7c5cff" }[S.cls];
      num.el.style.color = accent;
      if (S.cls === "s-y2k") num.el.classList.add("pop");
      const b = textBlock(node, "동아리 지원금으로 마음껏", "", 40, 0, W - 80, "center");
      b.el.style.fontSize = (V ? 84 : 84) + "px";
      const c = textBlock(node, V ? "카드 등록 없이\n쓴 만큼 투명하게" : "카드 등록 없이 · 쓴 만큼 투명하게", "", 40, 0, W - 80, "center");
      c.el.style.fontSize = (V ? 58 : 46) + "px";
      c.el.style.opacity = 0.75;
      scene.items = [[0, a], [1 * beat, num], [3 * beat, b], [5 * beat, c]];
      scene.numSpans = num.el.querySelectorAll(".num .c");
      scene.layout = () => {
        const hs = scene.items.map(([, k]) => k.box.getBoundingClientRect().height);
        const gap = V ? 40 : 18;
        let y = (H - (hs.reduce((x, z) => x + z, 0) + gap * 3)) / 2;
        scene.items.forEach(([, k], i) => { k.box.style.top = y + "px"; y += hs[i] + gap; });
      };
      scene.update = (lt) => {
        scene.items.forEach(([at, k]) => { show(k.box, lt >= at); if (lt >= at) S.textIn(k, lt - at); });
        const v = Math.round(E.outExpo(seg(lt, beat, beat + 1.2)) * 80) * 1000;
        const str = v.toLocaleString("en-US").padStart(6, " ");
        scene.numSpans.forEach((sp, i) => { sp.textContent = str[i] === " " ? " " : str[i]; });
      };
    } else if (sc.name === "cta") {
      const l1 = textBlock(node, S.cta[0], "", 40, 0, W - 80, "center");
      const l2 = textBlock(node, S.cta[1], S.cls === "s-y2k" ? "pop" : "", 40, 0, W - 80, "center");
      [l1, l2].forEach((k) => { k.el.style.fontSize = bigSize + "px"; });
      const logo = textBlock(node, "CTRL{plus|+}AI", "latin " + (S.cls === "s-y2k" ? "chrome" : S.cls === "s-neon" ? "glow" : ""), 40, 0, W - 80, "center");
      logo.el.style.fontSize = (S.cls === "s-phonk" ? 300 : V ? 190 : 230) + "px";
      const plusColor = { "s-neon": "#c6ff3d", "s-swiss": "#ff3b1f", "s-y2k": "#ff3fb4", "s-phonk": "#ff1e3c", "s-pop": "#7c5cff" }[S.cls];
      logo.el.querySelectorAll(".plus").forEach((e) => { e.style.color = plusColor; e.style.webkitTextFillColor = plusColor; });
      const url = textBlock(node, "ctrlai.my", "latin", 40, 0, W - 80, "center");
      url.el.style.fontSize = (V ? 84 : 72) + "px";
      url.el.style.color = plusColor;
      if (S.cls === "s-y2k") url.el.classList.add("lime");
      const inv = textBlock(node, V ? "초대 코드로\n지금 시작하세요" : "초대 코드로 지금 시작하세요", "", 40, 0, W - 80, "center");
      inv.el.style.fontSize = (V ? 70 : 52) + "px";
      scene.groups = [[[0, l1], [beat, l2]], [[4 * beat, logo], [5 * beat, url], [6 * beat, inv]]];
      scene.layout = () => {
        scene.groups.forEach((g) => {
          const hs = g.map(([, k]) => k.box.getBoundingClientRect().height);
          const gap = V ? 40 : 24;
          let y = (H - (hs.reduce((x, z) => x + z, 0) + gap * (g.length - 1))) / 2;
          g.forEach(([, k], i) => { k.box.style.top = y + "px"; y += hs[i] + gap; });
        });
      };
      scene.update = (lt) => {
        const second = lt >= 4 * beat;
        scene.groups[0].forEach(([at, k]) => { show(k.box, !second && lt >= at); if (!second && lt >= at) S.textIn(k, lt - at); });
        scene.groups[1].forEach(([at, k]) => { show(k.box, lt >= at); if (lt >= at) S.textIn(k, lt - at); });
      };
    } else {
      const def = steps[stepIdx++];
      scene.num = def.num;
      const tag = h("div", "tag latin", node, `STEP ${def.num} · ${STEPS[stepIdx - 1]}`);
      if (V) css(tag, { left: "50%", top: L.tag[1] + "px" });
      else css(tag, { left: L.tag[0] + "px", top: L.tag[1] + "px" });
      scene.tag = tag;
      const titleCls = { "s-neon": "glow", "s-swiss": "", "s-y2k": "pop", "s-phonk": "", "s-pop": "" }[S.cls];
      const title = textBlock(node, def.title.replace(/\{a\|/g, `{${{ "s-neon": "accent", "s-swiss": "accent", "s-y2k": "lime", "s-phonk": "red", "s-pop": "accent" }[S.cls]}|`), "title-t " + titleCls, L.title[0], L.title[1], L.title[2], V ? "center" : "left");
      title.el.classList.add("title");
      scene.title = title;
      scene.screen = new Screen(node, def);
      const bubbly = S.cls === "s-y2k" || S.cls === "s-pop";
      scene.captions = def.captions.map(([f, txt]) => {
        const spec = bubbly ? txt.replace(/\{hl\|/g, "{accent|") : txt;
        const kt = textBlock(node, spec, "caption" + (bubbly ? " bub" : ""), L.caption[0], L.caption[1], L.caption[2], V ? "center" : "left");
        return { at: tf(f), kt };
      });
      // step dots
      scene.dots = [0, 1, 2, 3, 4].map((i) => {
        const d = h("div", "abs", node);
        const on = i === stepIdx - 1;
        const dotColor = { "s-neon": "#c6ff3d", "s-swiss": "#ff3b1f", "s-y2k": "#1a0b2e", "s-phonk": "#ff1e3c", "s-pop": "#7c5cff" }[S.cls];
        const wDot = on ? 70 : 22;
        const x0 = V ? W / 2 - (4 * 34 + 70) / 2 : L.tag[0];
        let x = x0;
        for (let j = 0; j < i; j++) x += (j === stepIdx - 1 ? 70 : 22) + 12;
        css(d, { left: x + "px", top: L.steps + "px", width: wDot + "px", height: "14px", borderRadius: "8px", background: dotColor, opacity: on ? 1 : 0.3 });
        return d;
      });
      scene.update = (lt, t) => {
        const tq = E.outExpo(seg(lt, 0, 0.5));
        scene.tag.style.transform = `${V ? "translateX(-50%) " : ""}translateY(${(1 - tq) * -60}px)`;
        scene.tag.style.opacity = tq;
        S.textIn(scene.title, lt - 0.05);
        S.screenIn(scene.screen.root, lt - 0.1, t);
        scene.screen.update(lt, tf);
        let cur = 0;
        scene.captions.forEach((c, i) => { if (lt >= c.at) cur = i; });
        scene.captions.forEach((c, i) => {
          show(c.kt.box, i === cur);
          if (i === cur) S.textIn(c.kt, lt - c.at - (i === 0 ? 0.25 : 0));
        });
      };
    }
    scenes.push(scene);
  });
  return scenes;
}

// ------------------------------------------------------------------ main
let TL, SCENES, BG, WIPE, ROOT;

async function init() {
  TL = await (await fetch(TL_URL)).json();
  document.body.className = S.cls;
  ROOT = document.getElementById("root");
  css(ROOT, { width: W + "px", height: H + "px" });
  ROOT.classList.add(S.cls);
  BG = buildBackground(ROOT);
  const sceneRoot = h("div", "layer", ROOT);
  sceneRoot.style.zIndex = 10;
  SCENES = buildScenes(sceneRoot, TL);
  WIPE = buildWipe(ROOT);
  // fonts load per Korean subset only for text that is laid out, and
  // every scene is in the layout (visibility: hidden), so this waits for
  // exactly the glyphs the video uses
  await new Promise((r) => requestAnimationFrame(r));
  await document.fonts.ready;
  await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
  // fit every text block to its width, then lay out the stacked scenes
  for (const sc of SCENES) {
    const all = [];
    if (sc.flashes) sc.flashes.forEach((f) => all.push(f.kt));
    if (sc.items) sc.items.forEach(([, k]) => all.push(k));
    if (sc.groups) sc.groups.flat().forEach(([, k]) => all.push(k));
    if (sc.title) all.push(sc.title);
    if (sc.captions) sc.captions.forEach((c) => all.push(c.kt));
    all.forEach((k) => k.fit(k.maxW));
    if (sc.flashes) sc.flashes.forEach((f) => { f.kt.box.style.top = (H - f.kt.box.getBoundingClientRect().height) / 2 + "px"; });
    if (sc.layout) sc.layout();
    if (sc.screen) await sc.screen.sample();
  }
  window.DURATION = TL.length;
  window.W = W; window.H = H;
  seek(0);
  window.READY = true;
}

function seek(t) {
  const beat = TL.beat;
  let cur = SCENES[0];
  for (const sc of SCENES) if (t >= sc.start) cur = sc;
  updateBackground(BG, t, beat, cur);
  for (const sc of SCENES) {
    const on = sc === cur;
    sc.node.style.display = on ? "block" : "none";
    if (on) sc.update(t - sc.start, t);
  }
  updateWipe(WIPE, t, SCENES.slice(1).map((s) => s.start));
  // phonk: the whole frame kicks on loud downbeats
  if (S.cls === "s-phonk") {
    const loud = ["drop", "outro"].includes(cur.section);
    const p = Math.exp(-(t % beat) / 0.09);
    const a = loud ? 12 * p : 0;
    ROOT.style.transform = `translate(${(rnd(Math.floor(t * 30)) - 0.5) * a}px, ${(rnd(Math.floor(t * 30) + 5) - 0.5) * a}px)`;
  }
  if (S.cls === "s-neon") {
    const p = Math.exp(-(t % beat) / 0.12);
    const loud = ["drop", "outro"].includes(cur.section);
    ROOT.style.transform = `scale(${1 + (loud ? 0.006 : 0.002) * p})`;
  }
}
window.seek = seek;
init().catch((e) => { window.ERROR = String(e && e.stack || e); console.error(e); });
