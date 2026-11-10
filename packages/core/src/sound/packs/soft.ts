import { ARPEGGIO, CHORD, DRONE, hz, noteSemitone, stepSemitone } from "../scale";
import { type PackVoice, Priority, type SoundPack } from "../voice";
import { marimba, pad, registerDecay, sixteenth, spread, vary } from "./common";

/**
 * "soft": felt and wood. Keys are muted thumps without the high click, notes are marimba-like,
 * and the phrase marks are darker and quieter than in "studio".
 */

const key: PackVoice = {
  priority: Priority.mechanical,
  send: 0.04,
  level: 2,
  play(g, { time, pan, vel, rng }) {
    const out = g.out(pan);
    g.noise(out, {
      at: time,
      filter: "bandpass",
      freq: 1500 * vary(rng, 0.15),
      q: 0.8,
      gain: 0.14 * vel,
      decay: 0.018,
    });
    g.tone(out, {
      at: time + 0.001 + rng() * 0.002,
      type: "sine",
      freq: 170 * vary(rng, 0.08),
      sweep: [[0.03, 110]],
      gain: 0.22 * vel,
      decay: 0.05,
    });
  },
};

const space: PackVoice = {
  priority: Priority.mechanical,
  send: 0.05,
  level: 2,
  play(g, { time, pan, vel, rng }) {
    const out = g.out(pan);
    g.noise(out, { at: time, filter: "bandpass", freq: 800 * vary(rng, 0.1), q: 0.8, gain: 0.14 * vel, decay: 0.03 });
    g.tone(out, { at: time + 0.002, type: "sine", freq: 120, sweep: [[0.05, 75]], gain: 0.28 * vel, decay: 0.07 });
  },
};

const press: PackVoice = {
  priority: Priority.mechanical,
  send: 0.04,
  level: 12,
  play(g, { time, pan, vel, rng }) {
    g.noise(g.out(pan), {
      at: time,
      filter: "bandpass",
      freq: 900 * vary(rng, 0.1),
      q: 1,
      gain: 0.1 * vel,
      decay: 0.02,
    });
  },
};

const release: PackVoice = {
  priority: Priority.mechanical,
  send: 0.04,
  level: 10,
  play(g, { time, pan, vel, rng }) {
    g.noise(g.out(pan), {
      at: time,
      filter: "bandpass",
      freq: 1200 * vary(rng, 0.1),
      q: 1,
      gain: 0.06 * vel,
      decay: 0.015,
    });
  },
};

const pen: PackVoice = {
  priority: Priority.mechanical,
  send: 0.06,
  level: 10,
  play(g, { time, pan, vel }) {
    g.noise(g.out(pan), { at: time, filter: "bandpass", freq: 1200, q: 1.2, gain: 0.08 * vel, decay: 0.015 });
  },
};

const snap: PackVoice = {
  priority: Priority.mechanical,
  send: 0.15,
  level: 3,
  play(g, { time, pan, vel, rng }) {
    marimba(g, g.out(pan), rng, { at: time, semitone: 31, gain: 0.08 * vel, decay: 0.12 });
  },
};

const tick: PackVoice = {
  priority: Priority.mechanical,
  send: 0.1,
  level: 2.5,
  play(g, { time, pan, pitch, vel }) {
    g.tone(g.out(pan), { at: time, type: "sine", freq: hz(stepSemitone(pitch)), gain: 0.1 * vel, decay: 0.12 });
  },
};

const note: PackVoice = {
  priority: Priority.note,
  send: 0.25,
  level: 2.5,
  play(g, { time, pan, pitch, vel, rng }) {
    const semitone = noteSemitone(pitch, pan);
    marimba(g, g.out(pan), rng, { at: time, semitone, gain: 0.3 * vel, decay: registerDecay(semitone, 1.2, 0.5) });
  },
};

const swell: PackVoice = {
  priority: Priority.phrase,
  send: 0.55,
  level: 1.6,
  play(g, { time, vel, rng }) {
    const out = g.out(0);
    g.noise(out, {
      at: time,
      filter: "lowpass",
      freq: 200,
      q: 0.7,
      sweep: [
        [1, 1200],
        [2.5, 500],
      ],
      gain: 0.12 * vel,
      attack: 1,
      decay: 1.6,
    });
    pad(g, out, rng, {
      at: time + 0.2,
      semitones: DRONE,
      type: "sine",
      gain: 0.05 * vel,
      attack: 0.9,
      hold: 0.3,
      decay: 1.6,
      stagger: 0.3,
    });
  },
};

const fanout: PackVoice = {
  priority: Priority.phrase,
  send: 0.35,
  level: 1.5,
  play(g, p) {
    const step = sixteenth(p);
    ARPEGGIO.forEach((semitone, i) => {
      const out = g.out(spread(i, ARPEGGIO.length, -0.5, 0.5));
      marimba(g, out, p.rng, { at: p.time + i * step, semitone, gain: 0.18 * p.vel, decay: 0.5 });
    });
  },
};

const chord: PackVoice = {
  priority: Priority.phrase,
  send: 0.45,
  level: 1.4,
  play(g, { time, vel, rng }) {
    CHORD.forEach((semitone, i) => {
      const out = g.out(spread(i, CHORD.length, -0.6, 0.6));
      const gain = 0.2 * vel * (1 - (0.35 * i) / CHORD.length);
      marimba(g, out, rng, { at: time + i * 0.04, semitone, gain, decay: registerDecay(semitone, 1.8, 0.9) });
    });
    pad(g, g.out(0), rng, {
      at: time,
      semitones: DRONE,
      type: "sine",
      gain: 0.05 * vel,
      attack: 0.3,
      hold: 0.8,
      decay: 3,
    });
  },
};

const sweep: PackVoice = {
  priority: Priority.phrase,
  send: 0.4,
  level: 1.6,
  play(g, { time, vel, rng }) {
    const out = g.out(0);
    g.noise(out, {
      at: time,
      filter: "lowpass",
      freq: 2500,
      q: 0.8,
      sweep: [[0.9, 200]],
      gain: 0.12 * vel,
      attack: 0.08,
      hold: 0.3,
      decay: 0.6,
    });
    marimba(g, out, rng, { at: time + 0.05, semitone: 12, gain: 0.16 * vel, decay: 0.9 });
  },
};

const pop: PackVoice = {
  priority: Priority.mechanical,
  send: 0.1,
  level: 2.5,
  play(g, { time, pan, vel, rng }) {
    marimba(g, g.out(pan), rng, { at: time, semitone: 24, gain: 0.1 * vel, decay: 0.15 });
  },
};

export const soft: SoundPack = {
  id: "soft",
  voices: { key, space, press, release, pen, snap, tick, note, swell, fanout, chord, sweep, pop },
};
