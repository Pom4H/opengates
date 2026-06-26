#!/usr/bin/env python3
"""Генератор небольшой музыкальной пьесы в WAV без внешних зависимостей.

Пьеса "Lumen" — спокойная композиция в ля-миноре: арпеджированный
аккомпанемент, ведущая мелодия и мягкий бас. Синтез на синусоидах
с несколькими гармониками и ADSR-огибающей.
"""

import math
import struct
import wave

SAMPLE_RATE = 44100
BPM = 96
BEAT = 60.0 / BPM  # длительность четверти в секундах


def note_freq(name: str) -> float:
    """Частота ноты вида 'A4', 'C#5', 'R' (пауза) по равномерной темперации."""
    if name == "R":
        return 0.0
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
             "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    pitch = name[:-1]
    octave = int(name[-1])
    semitone = names[pitch] + (octave - 4) * 12 - 9  # относительно A4
    return 440.0 * (2 ** (semitone / 12.0))


def adsr(n: int, attack=0.02, decay=0.08, sustain=0.7, release=0.15):
    """ADSR-огибающая длиной n сэмплов."""
    a = int(attack * SAMPLE_RATE)
    d = int(decay * SAMPLE_RATE)
    r = int(release * SAMPLE_RATE)
    env = [0.0] * n
    for i in range(n):
        if i < a and a > 0:
            env[i] = i / a
        elif i < a + d and d > 0:
            env[i] = 1.0 - (1.0 - sustain) * (i - a) / d
        elif i < n - r:
            env[i] = sustain
        elif r > 0:
            env[i] = sustain * max(0.0, (n - i) / r)
    return env


def tone(freq: float, dur: float, amp: float, harmonics=(1.0, 0.35, 0.18, 0.08)):
    """Сэмплы одной ноты с гармониками и огибающей."""
    n = int(dur * SAMPLE_RATE)
    env = adsr(n)
    out = [0.0] * n
    if freq <= 0:
        return out  # пауза
    for i in range(n):
        t = i / SAMPLE_RATE
        s = 0.0
        for k, h in enumerate(harmonics, start=1):
            s += h * math.sin(2 * math.pi * freq * k * t)
        # лёгкое вибрато для живости
        vib = 1.0 + 0.004 * math.sin(2 * math.pi * 5.5 * t)
        out[i] = s * env[i] * amp * vib
    return out


def render(track, amp, harmonics=(1.0, 0.35, 0.18, 0.08)):
    """track: список (нота, длительность_в_долях). Возвращает список сэмплов."""
    buf = []
    for name, beats in track:
        buf.extend(tone(note_freq(name), beats * BEAT, amp, harmonics))
    return buf


def mix(*tracks):
    """Микширование дорожек разной длины."""
    length = max(len(t) for t in tracks)
    out = [0.0] * length
    for t in tracks:
        for i, s in enumerate(t):
            out[i] += s
    return out


# --- Композиция -------------------------------------------------------------
# Гармония по 4 такта: Am | F | C | G  (×2)

MELODY = [
    ("E5", 1), ("A5", 1), ("C6", 1), ("B5", 1),
    ("A5", 1), ("F5", 1), ("E5", 1), ("C5", 1),
    ("E5", 1), ("G5", 1), ("C6", 1.5), ("B5", 0.5),
    ("D5", 1), ("G5", 1), ("B5", 1), ("D6", 1),

    ("C6", 1), ("B5", 1), ("A5", 1), ("E5", 1),
    ("F5", 1.5), ("A5", 0.5), ("G5", 1), ("E5", 1),
    ("E5", 1), ("G5", 1), ("C6", 1), ("E6", 1),
    ("D6", 2), ("R", 2),
]

# Арпеджио аккомпанемента (восьмые)
def arp(chord, beats_per_chord=4):
    seq = []
    pattern = chord + [chord[1], chord[2], chord[1], chord[0]]
    step = beats_per_chord / len(pattern)
    for nm in pattern:
        seq.append((nm, step))
    return seq

CHORDS = [
    ["A3", "C4", "E4"],  # Am
    ["F3", "A3", "C4"],  # F
    ["C4", "E4", "G4"],  # C
    ["G3", "B3", "D4"],  # G
]
ARP = []
for _ in range(2):
    for ch in CHORDS:
        ARP.extend(arp(ch))

BASS = [
    ("A2", 4), ("F2", 4), ("C2", 4), ("G2", 4),
    ("A2", 4), ("F2", 4), ("C2", 4), ("G2", 4),
]

melody = render(MELODY, amp=0.34)
arpeggio = render(ARP, amp=0.13, harmonics=(1.0, 0.2, 0.08))
bass = render(BASS, amp=0.22, harmonics=(1.0, 0.5, 0.25, 0.1))

master = mix(melody, arpeggio, bass)

# Нормализация и мягкое ограничение
peak = max(abs(s) for s in master) or 1.0
norm = 0.9 / peak
frames = bytearray()
for s in master:
    v = s * norm
    v = math.tanh(v)  # мягкое насыщение
    frames += struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767))

OUT = "/home/user/opengates/music/lumen.wav"
with wave.open(OUT, "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SAMPLE_RATE)
    w.writeframes(bytes(frames))

dur = len(master) / SAMPLE_RATE
print(f"Готово: {OUT}  ({dur:.1f} c, {len(master)} сэмплов)")
