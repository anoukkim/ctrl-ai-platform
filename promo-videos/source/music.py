"""Original beat tracks for the CTRL+AI promo videos — synthesised from
scratch with numpy (no samples, no third-party music), so the videos are
free to publish.

    python music.py <out_dir>

writes, for each of the five styles, `<id>.wav` (60 s, 44.1 kHz stereo)
and `<id>.json` — the timeline (bpm, scene start/end times snapped to bar
lines) that the video engine reads, so every cut lands on the beat.
"""

import json
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
RNG = np.random.default_rng(7)

# ---------------------------------------------------------------- scenes
# The same story for every style; each scene's length is a share of the
# track's bars. `section` drives the arrangement.
SCENES = [
    ("hook", 0.10, "intro"),
    ("brand", 0.07, "drop"),
    ("login", 0.13, "verse"),
    ("chat", 0.17, "verse"),
    ("builder", 0.14, "drop"),
    ("video", 0.13, "drop"),
    ("apps", 0.10, "break"),
    ("wallet", 0.06, "build"),
    ("cta", 0.10, "outro"),
]


def scene_bars(total):
    raw = [share * total for _, share, _ in SCENES]
    bars = [max(1, round(r)) for r in raw]
    while sum(bars) > total:
        i = max(range(len(bars)), key=lambda k: bars[k] - raw[k])
        bars[i] -= 1
    while sum(bars) < total:
        i = min(range(len(bars)), key=lambda k: bars[k] - raw[k])
        bars[i] += 1
    return bars


# ---------------------------------------------------------------- dsp
def secs(n):
    return np.arange(int(n * SR)) / SR


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def phase(freq):
    return np.cumsum(np.broadcast_to(freq, freq.shape) / SR)


def osc_saw(freq):
    p = phase(freq)
    return 2 * (p % 1) - 1


def osc_sq(freq, duty=0.5):
    p = phase(freq) % 1
    return np.where(p < duty, 1.0, -1.0)


def osc_sin(freq):
    return np.sin(2 * np.pi * phase(freq))


def noise(n):
    return RNG.uniform(-1, 1, int(n))


def filt(x, kind, f, order=2):
    if kind == "bp":
        sos = butter(order, [f[0], f[1]], "bandpass", fs=SR, output="sos")
    else:
        sos = butter(order, min(f, SR / 2 - 100), kind, fs=SR, output="sos")
    return sosfilt(sos, x)


def adsr(n, a=0.005, d=0.1, s=0.7, r=0.05):
    n = int(n)
    env = np.full(n, s)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    env[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(nd, n - na)
    env[na:na + nd] = np.linspace(1, s, nd)
    nr = min(nr, n)
    if nr:
        env[n - nr:] *= np.linspace(1, 0, nr)
    return env


def expdec(n, rate):
    return np.exp(-secs(n / SR) * rate)


# ---------------------------------------------------------------- voices
def kick(f0=170, f1=48, drop=32, decay=7.0, dur=0.55, click=0.35, drive=1.6):
    t = secs(dur)
    f = f1 + (f0 - f1) * np.exp(-t * drop)
    y = osc_sin(f) * np.exp(-t * decay)
    y += filt(noise(len(t)), "hp", 2500) * np.exp(-t * 260) * click
    return np.tanh(y * drive) / np.tanh(drive)


def snare(tone=190, dur=0.3, snap=1.0):
    t = secs(dur)
    y = osc_sin(np.full(len(t), tone)) * np.exp(-t * 22) * 0.55
    y += filt(noise(len(t)), "bp", (1200, 9000)) * np.exp(-t * 16) * snap
    return y


def clap(dur=0.35):
    t = secs(dur)
    env = np.zeros(len(t))
    for k, o in enumerate((0, 0.010, 0.021)):
        i = int(o * SR)
        env[i:] = np.maximum(env[i:], np.exp(-(t[: len(t) - i]) * (90 if k < 2 else 17)))
    return filt(noise(len(t)), "bp", (900, 3200)) * env * 1.4


def hat(open_=False, dur=None):
    dur = dur or (0.35 if open_ else 0.06)
    t = secs(dur)
    return filt(noise(len(t)), "hp", 7500) * np.exp(-t * (9 if open_ else 70))


def rim():
    t = secs(0.08)
    return (osc_sin(np.full(len(t), 1700)) * 0.5 + filt(noise(len(t)), "bp", (2000, 6000))) * np.exp(-t * 60)


def crash(dur=2.2):
    t = secs(dur)
    return filt(noise(len(t)), "hp", 4500) * np.exp(-t * 2.2) * 0.6


def bass808(note, dur, glide_from=None, drive=2.2):
    t = secs(dur)
    f = np.full(len(t), mtof(note))
    if glide_from is not None:
        f = mtof(note) + (mtof(glide_from) - mtof(note)) * np.exp(-t * 18)
    y = osc_sin(f) * adsr(len(t), 0.003, 0.2, 0.75, 0.05)
    y += osc_sin(f * 2) * 0.12 * np.exp(-t * 6)
    return np.tanh(y * drive) / np.tanh(drive)


def cowbell(note, dur=0.22):
    t = secs(dur)
    f = mtof(note)
    y = osc_sq(np.full(len(t), f)) + osc_sq(np.full(len(t), f * 1.48)) * 0.8
    y = filt(y, "bp", (350, 4500))
    return np.tanh(y * np.exp(-t * 11) * 1.8) * 0.6


def saw_note(note, dur, cutoff=2500, voices=1, detune=0.12, env=(0.005, 0.12, 0.6, 0.06), sq=False):
    n = int(dur * SR)
    y = np.zeros(n)
    for v in range(voices):
        cents = (v - (voices - 1) / 2) * detune * 100 / max(1, voices - 1) if voices > 1 else 0
        f = np.full(n, mtof(note) * 2 ** (cents / 1200))
        y += osc_sq(f) if sq else osc_saw(f)
    y /= voices
    y = filt(y, "lp", cutoff)
    return y * adsr(n, *env)


def pluck(note, dur=0.25, bright=4500, sq=False):
    n = int(dur * SR)
    f = np.full(n, mtof(note))
    y = osc_sq(f, 0.3) if sq else osc_saw(f)
    y = filt(y, "lp", bright) * np.exp(-secs(n / SR) * 14)
    return y


def bell(note, dur=0.5):
    t = secs(dur)
    f = mtof(note)
    y = osc_sin(np.full(len(t), f)) + 0.5 * osc_sin(np.full(len(t), f * 2.01)) + 0.25 * osc_sin(np.full(len(t), f * 3.98))
    return y * np.exp(-t * 7) * 0.5


def organ(note, dur):
    n = int(dur * SR)
    f = mtof(note)
    y = sum(a * osc_sin(np.full(n, f * h)) for h, a in ((0.5, 0.5), (1, 1), (2, 0.6), (3, 0.3), (4, 0.2)))
    return y * adsr(n, 0.004, 0.08, 0.55, 0.03) * 0.35


def chirp(dur=0.12):
    """The bouncy 'bed squeak' of jersey club, made from a gliding sine."""
    t = secs(dur)
    f = 1100 + 900 * (t / dur) + 80 * np.sin(2 * np.pi * 38 * t)
    return osc_sin(f) * np.sin(np.pi * t / dur) * 0.4


def vox(note, dur=0.14, vowel="a"):
    formants = {"a": (800, 1150), "o": (450, 800), "e": (400, 2000)}[vowel]
    n = int(dur * SR)
    src = osc_saw(np.full(n, mtof(note)))
    y = filt(src, "bp", (formants[0] * 0.8, formants[0] * 1.2)) + 0.6 * filt(src, "bp", (formants[1] * 0.85, formants[1] * 1.15))
    return y * adsr(n, 0.01, 0.05, 0.8, 0.03) * 1.5


def riser(dur):
    t = secs(dur)
    x = noise(len(t))
    # a highpass sweep, approximated by blending ever-higher bands
    out = np.zeros(len(t))
    bands = (300, 800, 2000, 5000)
    for k, f in enumerate(bands):
        w = np.clip((t / dur) * len(bands) - k, 0, 1)
        out += filt(x, "hp", f) * (w if k else 1 - (t / dur) * 0.6)
    tone = osc_saw(200 * 2 ** (3 * t / dur)) * 0.15
    return (out * 0.35 + filt(tone, "lp", 4000)) * (t / dur) ** 1.6


def whoosh(dur=0.45):
    t = secs(dur)
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    return filt(noise(len(t)), "bp", (500, 5000)) * env * 0.5


def impact(dur=2.0):
    t = secs(dur)
    boom = osc_sin(40 + 80 * np.exp(-t * 9)) * np.exp(-t * 2.5)
    return np.tanh(boom * 2) * 0.8 + crash(dur) * 0.5


# ---------------------------------------------------------------- mixing
class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR * 3
        self.bus = {k: np.zeros((self.n, 2)) for k in ("drums", "bass", "music", "fx", "send")}
        self.kicks = []

    def add(self, bus, at, y, gain=1.0, pan=0.0, send=0.0):
        i = int(at * SR)
        if i >= self.n or i < 0:
            return
        y = y[: self.n - i] * gain
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        self.bus[bus][i:i + len(y), 0] += y * l * 1.414
        self.bus[bus][i:i + len(y), 1] += y * r * 1.414
        if send:
            self.bus["send"][i:i + len(y), 0] += y * l * send
            self.bus["send"][i:i + len(y), 1] += y * r * send

    def render(self, length, duck=0.6, rev_len=1.6):
        g = np.ones(self.n)
        for k in self.kicks:
            i = int(k * SR)
            m = min(self.n - i, int(0.25 * SR))
            g[i:i + m] = np.minimum(g[i:i + m], 1 - duck * np.exp(-secs(m / SR) * 14))
        t = secs(rev_len)
        ir = np.stack([noise(len(t)) * np.exp(-t * 4), noise(len(t)) * np.exp(-t * 4)], 1) * 0.08
        wet = np.stack([fftconvolve(self.bus["send"][:, c], ir[:, c])[: self.n] for c in (0, 1)], 1)
        out = (self.bus["drums"] + (self.bus["bass"] + self.bus["music"]) * g[:, None]
               + self.bus["fx"] + wet * g[:, None])
        out = np.stack([filt(out[:, c], "hp", 28) for c in (0, 1)], 1)
        out = out[: int(length * SR)]
        out /= np.max(np.abs(out)) + 1e-9
        out = np.tanh(out * 2.2) / np.tanh(2.2)      # loud, ad-style
        out /= np.max(np.abs(out)) + 1e-9
        fade = int(0.35 * SR)
        out[-fade:] *= np.linspace(1, 0, fade)[:, None]
        return (out * 0.93 * 32767).astype(np.int16)


def write_wav(path, data):
    import wave
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


# ---------------------------------------------------------------- arrangement
class Track:
    """Bar-by-bar arrangement. Subclasses fill `bar(m, i, sect, k, last)`."""

    bpm = 120
    bars = 30
    swing = 0.0

    def __init__(self):
        self.beat = 60 / self.bpm
        self.step = self.beat / 4
        self.bar_len = self.beat * 4
        self.length = self.bars * self.bar_len

    def at(self, bar, step):
        s = bar * self.bar_len + step * self.step
        if self.swing and int(step) % 2 == 1:
            s += self.step * self.swing
        return s

    def hit(self, m, bus, bar, step, y, gain=1.0, pan=0.0, send=0.0):
        m.add(bus, self.at(bar, step), y, gain, pan, send)

    def kick(self, m, bar, step, y, gain=1.0):
        self.hit(m, "drums", bar, step, y, gain)
        m.kicks.append(self.at(bar, step))

    def build(self):
        sb = scene_bars(self.bars)
        timeline, sections, b = [], [], 0
        for (name, _, sect), n in zip(SCENES, sb):
            timeline.append({"name": name, "start": round(b * self.bar_len, 4),
                             "end": round((b + n) * self.bar_len, 4), "section": sect, "bars": n})
            sections += [(sect, k, n) for k in range(n)]
            b += n
        m = Mix(self.length)
        prev = None
        for i, (sect, k, n) in enumerate(sections):
            last = k == n - 1
            nxt = sections[i + 1][0] if i + 1 < len(sections) else None
            self.bar(m, i, sect, k, last, nxt)
            # keep the pulse going under quiet sections — an ad never sags
            if sect == "break":
                for s in (0, 8):
                    self.kick(m, i, s, filt(kick(), "lp", 500), 0.6)
                for s in range(2, 16, 4):
                    m.add("drums", self.at(i, s), hat(dur=0.05), 0.12, pan=0.3)
            if sect == "intro" and self.intro_kick:
                for s in (0, 4, 8, 12):
                    self.kick(m, i, s, filt(kick(), "lp", 250 + 700 * k), 0.75)
            if k == 0 and sect in ("drop", "outro") and prev != sect:
                m.add("fx", i * self.bar_len, impact(), 0.55)
            if k == 0 and i > 0:
                m.add("fx", i * self.bar_len - 0.3, whoosh(0.45), 0.5, pan=0.3)
            if last and nxt in ("drop", "outro") and sect not in ("drop",):
                m.add("fx", i * self.bar_len, riser(self.bar_len), 0.55)
            prev = sect
        audio = m.render(self.length, duck=self.duck)
        return audio, {"bpm": self.bpm, "bars": self.bars, "bar": self.bar_len,
                       "beat": self.beat, "length": self.length, "scenes": timeline}

    duck = 0.55
    intro_kick = True

    # helpers shared by the genres
    def chord(self, i):
        return self.prog[(i // self.chord_bars) % len(self.prog)]

    chord_bars = 1

    def end_hit(self, m, i, k, n):
        """Final bar of the outro: one big hit and a ringing tail."""


def roll(m, tr, i, voice, gain=0.5):
    # snare roll that speeds up across the bar
    for s in list(range(0, 8, 2)) + list(range(8, 12)) + [12 + x / 2 for x in range(8)]:
        tr.hit(m, "drums", i, s, voice, gain * (0.4 + 0.6 * s / 16))


# ---- 1. NEON — future house, 124 bpm, A minor -------------------------------
class Neon(Track):
    bpm, bars = 124, 31
    intro_kick = False
    prog = [(57, 60, 64, 67), (53, 57, 60, 64), (48, 52, 55, 60), (55, 59, 62, 67)]  # Am7 Fmaj7 C G
    roots = [45, 41, 36, 43]
    lead = [(0, 76), (3, 74), (6, 72), (8, 76), (10, 79), (14, 76)]

    def bar(self, m, i, sect, k, last, nxt):
        ch, root = self.chord(i), self.roots[i % 4]
        K, C, H, O = kick(), clap(), hat(), hat(True)
        if sect == "intro":
            for s in (0, 4, 8, 12):
                self.kick(m, i, s, filt(K, "lp", 300 + 900 * k), 0.7)
            for s in range(2, 16, 4):
                self.hit(m, "drums", i, s, O, 0.12 * (k + 1))
            m.add("music", self.at(i, 0), filt(saw_note(ch[0] + 12, self.bar_len, 900, 5, 0.25, (0.4, 0.5, 0.8, 0.4)), "lp", 1200), 0.35, send=0.5)
            return
        if sect in ("drop", "verse", "outro", "build"):
            for s in (0, 4, 8, 12):
                if sect == "build" and last and s == 12:
                    continue
                if sect == "outro" and last and s > 0:
                    continue
                self.kick(m, i, s, K)
        if sect in ("drop", "verse"):
            for s in (4, 12):
                self.hit(m, "drums", i, s, C, 0.7, send=0.25)
            for s in range(16):
                self.hit(m, "drums", i, s, H, 0.18 if s % 2 else 0.1, pan=0.3)
            for s in (2, 6, 10, 14):
                self.hit(m, "drums", i, s, O, 0.22, pan=-0.2)
            for s, ln in ((2, 1.6), (6, 1.6), (10, 1.6), (14, 1), (15, 0.8)):
                note = root + (12 if s == 15 else 0)
                y = saw_note(note, ln * self.step, 900 if sect == "verse" else 1600, 2, 0.1, (0.004, 0.08, 0.5, 0.03))
                self.hit(m, "bass", i, s, y, 0.75)
        if sect == "drop":
            for s, ln in ((0, 1.5), (3, 1.5), (6, 1.5), (10, 2), (12, 1.5)):
                for nt in ch:
                    self.hit(m, "music", i, s, saw_note(nt + 12, ln * self.step, 3200, 5, 0.22, (0.002, 0.1, 0.4, 0.03)), 0.12, send=0.35)
            for s, nt in self.lead:
                self.hit(m, "music", i, s, pluck(nt + (0 if i % 2 else -2), 0.3), 0.2, pan=0.25, send=0.4)
        if sect == "verse":
            m.add("music", self.at(i, 0), sum(saw_note(nt, self.bar_len, 1400, 3, 0.15, (0.2, 0.4, 0.7, 0.3)) for nt in ch), 0.08, send=0.5)
            for s in range(0, 16, 2):
                self.hit(m, "music", i, s, pluck(ch[(s // 2) % 4] + 12, 0.18, 3000), 0.12, pan=-0.3, send=0.4)
        if sect in ("break", "build"):
            m.add("music", self.at(i, 0), sum(saw_note(nt, self.bar_len, 1100, 5, 0.25, (0.3, 0.5, 0.8, 0.3)) for nt in ch), 0.1, send=0.6)
            for s in range(0, 16, 4):
                self.hit(m, "music", i, s, bell(ch[s // 4] + 24), 0.15, pan=0.4, send=0.6)
        if sect == "build":
            roll(m, self, i, snare(), 0.45)
        if sect == "outro":
            if not last:
                for s in (4, 12):
                    self.hit(m, "drums", i, s, C, 0.7, send=0.25)
                for s in range(16):
                    self.hit(m, "drums", i, s, H, 0.15, pan=0.3)
                for s, ln in ((0, 1.5), (3, 1.5), (6, 1.5), (10, 2), (12, 1.5)):
                    for nt in ch:
                        self.hit(m, "music", i, s, saw_note(nt + 12, ln * self.step, 3200, 5, 0.22, (0.002, 0.1, 0.4, 0.03)), 0.12, send=0.35)
                for s in (2, 6, 10, 14):
                    self.hit(m, "bass", i, s, saw_note(root, 1.6 * self.step, 1600, 2), 0.75)
            else:
                for nt in self.prog[0]:
                    self.hit(m, "music", i, 0, saw_note(nt + 12, self.bar_len, 2500, 5, 0.25, (0.002, 0.6, 0.3, 0.8)), 0.15, send=0.8)
                self.hit(m, "bass", i, 0, bass808(33, self.bar_len), 0.7)


# ---- 2. SWISS — UK garage 2-step, 132 bpm, C minor --------------------------
class Garage(Track):
    bpm, bars, swing = 132, 33, 0.28
    prog = [(60, 63, 67, 70, 74), (56, 60, 63, 67, 70), (53, 56, 60, 63, 67), (55, 59, 62, 65, 70)]
    roots = [36, 32, 29, 31]

    def bar(self, m, i, sect, k, last, nxt):
        ch, root = self.chord(i), self.roots[i % 4]
        K = kick(150, 50, 28, 9, 0.4, 0.5)
        S, H, R = snare(220, 0.25), hat(dur=0.05), rim()
        full = sect in ("drop", "verse", "outro") and not (sect == "outro" and last)
        if sect == "intro":
            for s in range(0, 16, 2):
                self.hit(m, "drums", i, s, H, 0.12 + 0.05 * k, pan=0.3)
            for s in (3, 6, 14):
                self.hit(m, "music", i, s, filt(sum(organ(nt, 1.5 * self.step) for nt in ch), "lp", 700 + 500 * k), 0.22, send=0.5)
            return
        if full or sect == "build":
            for s in (0, 10) if sect != "build" else (0, 8):
                self.kick(m, i, s, K)
            for s in (4, 12):
                self.hit(m, "drums", i, s, S, 0.6, send=0.2)
            for s in range(16):
                if s % 4 != 0:
                    self.hit(m, "drums", i, s, H, 0.2 if s % 2 else 0.1, pan=0.35)
            for s in (3, 7, 15):
                self.hit(m, "drums", i, s, R, 0.18, pan=-0.4)
        if full:
            for s, nt, ln in ((0, root, 3), (3, root, 2), (6, root + 12, 1), (10, root, 3), (14, root + 7, 2)):
                self.hit(m, "bass", i, s, bass808(nt, ln * self.step, drive=1.3), 0.8)
            for s in ((3, 6, 14) if sect == "verse" else (0, 3, 6, 9, 14)):
                self.hit(m, "music", i, s, sum(organ(nt, 1.5 * self.step) for nt in ch), 0.22, send=0.45)
        if sect in ("drop", "outro") and not last:
            for s, nt in ((2, 79), (5, 77), (8, 75), (11, 74), (13, 72)):
                self.hit(m, "music", i, s, vox(nt - 12, 0.13, "o" if s % 2 else "a"), 0.16, pan=0.3, send=0.5)
        if sect in ("break", "build"):
            m.add("music", self.at(i, 0), sum(saw_note(nt, self.bar_len, 1200, 3, 0.2, (0.3, 0.5, 0.7, 0.3)) for nt in ch), 0.08, send=0.6)
            for s in range(0, 16, 3):
                self.hit(m, "music", i, s, bell(ch[s % 5] + 12), 0.14, pan=-0.3, send=0.6)
        if sect == "build":
            roll(m, self, i, S, 0.4)
        if sect == "outro" and last:
            self.kick(m, i, 0, K)
            self.hit(m, "music", i, 0, sum(organ(nt, self.bar_len) for nt in self.prog[0]), 0.3, send=0.9)
            self.hit(m, "bass", i, 0, bass808(24, self.bar_len, drive=1.3), 0.8)


# ---- 3. Y2K — jersey club, 140 bpm, E♭ minor -------------------------------
class Jersey(Track):
    bpm, bars = 140, 35
    prog = [(63, 66, 70, 73), (59, 63, 66, 70), (54, 58, 61, 66), (61, 65, 68, 73)]  # Ebm B Gb Db
    roots = [39, 35, 30, 37]
    hook = [(0, 75), (2, 78), (3, 75), (6, 73), (8, 70), (10, 73), (11, 75), (14, 78)]

    def bar(self, m, i, sect, k, last, nxt):
        ch, root = self.chord(i), self.roots[i % 4]
        K = kick(190, 52, 40, 9, 0.35, 0.5, 2.2)
        C, H = clap(), hat(dur=0.04)
        kicks = (0, 4, 8, 11, 14) if i % 2 == 0 else (0, 3, 6, 8, 10, 12, 14)
        if sect == "intro":
            for s in range(0, 16, 4):
                self.hit(m, "music", i, s, sum(pluck(nt + 12, 0.3, 2500, True) for nt in ch), 0.12 + 0.04 * k, send=0.6)
            if last:
                for s in (8, 10, 12, 13, 14, 15):
                    self.hit(m, "music", i, s, vox(75, 0.1), 0.25, send=0.4)
            return
        full = sect in ("drop", "outro", "verse") and not (sect == "outro" and last)
        if full:
            for s in (kicks if sect != "verse" else (0, 4, 8, 12)):
                self.kick(m, i, s, K)
            for s in (4, 12):
                self.hit(m, "drums", i, s, C, 0.6, send=0.2)
            for s in range(0, 16, 2):
                self.hit(m, "drums", i, s, H, 0.18, pan=0.3)
            for s in (2, 6, 10):
                self.hit(m, "fx", i, s, chirp(), 0.35 if sect != "verse" else 0.2, pan=-0.3)
            for s in (0, 6, 8, 11, 14):
                self.hit(m, "bass", i, s, bass808(root + 12, 1.5 * self.step, drive=1.8), 0.6)
        if sect in ("drop", "outro") and not last:
            for s, nt in self.hook:
                self.hit(m, "music", i, s, pluck(nt, 0.2, 6000, True), 0.2, pan=0.2, send=0.4)
                self.hit(m, "music", i, s, vox(nt - 12, 0.09, "e"), 0.12, pan=-0.2)
        if sect == "verse":
            for s in range(0, 16, 1):
                self.hit(m, "music", i, s, pluck(ch[s % 4] + 12, 0.12, 4000, True), 0.08, pan=0.4 if s % 2 else -0.4, send=0.3)
        if sect in ("break", "build"):
            m.add("music", self.at(i, 0), sum(saw_note(nt, self.bar_len, 2000, 5, 0.3, (0.2, 0.5, 0.8, 0.3)) for nt in ch), 0.08, send=0.6)
            for s in range(0, 16, 2):
                self.hit(m, "music", i, s, vox(ch[(s // 2) % 4], 0.12, "a"), 0.12, send=0.5)
        if sect == "build":
            roll(m, self, i, C, 0.45)
        if sect == "outro" and last:
            self.kick(m, i, 0, K)
            self.hit(m, "music", i, 0, sum(pluck(nt + 12, 1.6, 4000, True) for nt in self.prog[0]), 0.25, send=0.9)
            self.hit(m, "fx", i, 0, chirp(0.2), 0.4)


# ---- 4. PHONK — drift phonk, 128 bpm, F minor ------------------------------
class Phonk(Track):
    bpm, bars = 128, 32
    duck = 0.35
    bell_line = [(0, 77), (1, 77), (2, 80), (3, 77), (5, 84), (6, 82), (7, 80), (8, 77),
                 (10, 77), (11, 80), (12, 82), (13, 80), (14, 79), (15, 75)]
    roots = [29, 29, 25, 27]

    def bar(self, m, i, sect, k, last, nxt):
        root = self.roots[i % 4]
        K = kick(140, 45, 30, 10, 0.3, 0.6, 2.5)
        C, H = clap(), hat(dur=0.035)
        if sect == "intro":
            for s, nt in self.bell_line:
                self.hit(m, "music", i, s, filt(cowbell(nt), "lp", 1500 + 1500 * k), 0.4, send=0.6)
            return
        full = sect in ("drop", "outro", "verse") and not (sect == "outro" and last)
        if full:
            for s in (0, 3, 10) if sect != "verse" else (0, 10):
                self.kick(m, i, s, K)
            for s in (4, 12):
                self.hit(m, "drums", i, s, C, 0.65, send=0.3)
            steps = list(range(0, 16, 2)) if sect == "verse" else list(range(16))
            for s in steps:
                self.hit(m, "drums", i, s, H, 0.16, pan=0.3)
            if sect != "verse":
                for x in range(6):           # triplet hat roll at the end of the bar
                    self.hit(m, "drums", i, 14 + x / 3, H, 0.13, pan=0.3)
            for s, ln, glide in ((0, 5, None), (6, 3, root + 12), (10, 6, None)):
                self.hit(m, "bass", i, s, bass808(root, ln * self.step, glide, drive=3.5), 0.75)
        if sect in ("drop", "outro") and not last:
            for s, nt in self.bell_line:
                self.hit(m, "music", i, s, cowbell(nt + (0 if i % 4 < 2 else -2)), 0.38, send=0.4)
        if sect == "verse":
            for s, nt in self.bell_line[::2]:
                self.hit(m, "music", i, s, filt(cowbell(nt), "lp", 2200), 0.3, send=0.6)
        if sect in ("break", "build"):
            pad = sum(saw_note(nt, self.bar_len, 900, 3, 0.2, (0.4, 0.5, 0.8, 0.4)) for nt in (53, 56, 60))
            m.add("music", self.at(i, 0), pad, 0.12, send=0.7)
            for s, nt in self.bell_line[::4]:
                self.hit(m, "music", i, s, cowbell(nt), 0.25, send=0.8)
        if sect == "build":
            roll(m, self, i, C, 0.4)
        if sect == "outro" and last:
            self.kick(m, i, 0, K)
            self.hit(m, "bass", i, 0, bass808(29, self.bar_len * 0.8, 41, drive=3.5), 0.8)
            self.hit(m, "music", i, 0, cowbell(77, 1.2), 0.4, send=0.9)


# ---- 5. POP — K-pop synth-pop, 120 bpm, C major ----------------------------
class Pop(Track):
    bpm, bars = 120, 30
    prog = [(53, 57, 60, 65), (55, 59, 62, 67), (52, 55, 59, 64), (57, 60, 64, 69)]  # F G Em Am
    roots = [41, 43, 40, 45]
    hook = [(0, 72, 2), (2, 74, 2), (4, 76, 3), (8, 79, 2), (10, 76, 2), (12, 74, 2), (14, 72, 2)]

    def bar(self, m, i, sect, k, last, nxt):
        ch, root = self.chord(i), self.roots[i % 4]
        K, S, C, H = kick(160, 50, 30, 8, 0.45, 0.4), snare(200, 0.35), clap(), hat(dur=0.05)
        if sect == "intro":
            for s in range(16):
                self.hit(m, "music", i, s, pluck(ch[s % 4] + 12, 0.15, 1500 + 1500 * k), 0.13, pan=0.3 if s % 2 else -0.3, send=0.4)
            return
        full = sect in ("drop", "outro", "verse") and not (sect == "outro" and last)
        if full:
            for s in (0, 4, 8, 12) if sect != "verse" else (0, 7, 8):
                self.kick(m, i, s, K)
            for s in (4, 12):
                self.hit(m, "drums", i, s, S, 0.55, send=0.4)
                self.hit(m, "drums", i, s, C, 0.35)
            for s in range(0, 16, 2):
                self.hit(m, "drums", i, s, H, 0.2, pan=0.3)
            for s in range(0, 16, 2):
                self.hit(m, "bass", i, s, saw_note(root + (12 if s % 4 else 0), 1.8 * self.step, 1300, 2, 0.1, (0.003, 0.08, 0.6, 0.02)), 0.6)
            for s in range(16):
                self.hit(m, "music", i, s, pluck(ch[(s * 3) % 4] + 12, 0.14, 3500), 0.1, pan=0.4 if s % 2 else -0.4, send=0.3)
        if sect in ("drop", "outro") and not last:
            for s, nt, ln in self.hook:
                self.hit(m, "music", i, s, saw_note(nt + (0 if i % 2 == 0 else -3), ln * self.step, 5000, 3, 0.15, (0.005, 0.1, 0.6, 0.05), sq=True), 0.14, send=0.5)
                self.hit(m, "music", i, s, bell(nt + 12, 0.3), 0.08)
            m.add("music", self.at(i, 0), sum(saw_note(nt, self.bar_len, 2500, 5, 0.25, (0.05, 0.3, 0.8, 0.2)) for nt in ch), 0.06, send=0.5)
        if sect in ("break", "build"):
            m.add("music", self.at(i, 0), sum(saw_note(nt, self.bar_len, 1500, 5, 0.25, (0.3, 0.5, 0.8, 0.3)) for nt in ch), 0.1, send=0.6)
            for s in range(0, 16, 2):
                self.hit(m, "music", i, s, bell(ch[(s // 2) % 4] + 12), 0.15, send=0.6)
        if sect == "build":
            roll(m, self, i, S, 0.4)
        if sect == "outro" and last:
            self.kick(m, i, 0, K)
            self.hit(m, "music", i, 0, sum(saw_note(nt + 12, self.bar_len, 3000, 5, 0.25, (0.002, 0.8, 0.3, 0.8)) for nt in (48, 52, 55, 60)), 0.15, send=0.9)
            self.hit(m, "bass", i, 0, bass808(36, self.bar_len), 0.6)


STYLES = {"01-neon-house": Neon, "02-swiss-garage": Garage, "03-y2k-jersey": Jersey,
          "04-phonk-drift": Phonk, "05-pop-pastel": Pop}

if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    only = sys.argv[2:] or list(STYLES)
    for sid in only:
        audio, tl = STYLES[sid]().build()
        write_wav(out / f"{sid}.wav", audio)
        (out / f"{sid}.json").write_text(json.dumps(tl, indent=1))
        print(sid, f"{tl['length']:.2f}s", [(s["name"], s["start"]) for s in tl["scenes"]])
