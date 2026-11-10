import { ARPEGGIO, CHORD, DRONE, hz, noteSemitone, stepSemitone } from "../scale";
import { type PackVoice, Priority, type SoundPack } from "../voice";
import { glassBell, pad, registerDecay, sixteenth, spread, vary } from "./common";

/**
 * "studio" (default): crisp mechanical keyboard, clicky mouse, glass-bell notes on A major
 * pentatonic, and airy phrase marks for the opening, fan-out, completion and go-live.
 */

const key: PackVoice = {
  priority: Priority.mechanical,
  send: 0.05,
  level: 2,
  play(g, { time, pan, vel, rng }) {
    const out = g.out(pan);
    // High, short click of the switch...
    g.noise(out, { at: time, filter: "bandpass", freq: 3900 * vary(rng, 0.12), q: 1.4, gain: 0.3 * vel, decay: 0.011 });
    // ...over a low thock of the keycap bottoming out a moment later.
    const body = time + 0.001 + rng() * 0.003;
    g.tone(out, {
      at: body,
      type: "sine",
      freq: 205 * vary(rng, 0.08),
      sweep: [[0.03, 115]],
      gain: 0.42 * vel * vary(rng, 0.12),
      decay: 0.045,
    });
    g.noise(out, { at: body, filter: "bandpass", freq: 1300 * vary(rng, 0.15), q: 2, gain: 0.15 * vel, decay: 0.02 });
  },
};

const space: PackVoice = {
  priority: Priority.mechanical,
  send: 0.06,
  level: 1.8,
  play(g, { time, pan, vel, rng }) {
    const out = g.out(pan);
    g.noise(out, { at: time, filter: "bandpass", freq: 2400 * vary(rng, 0.1), q: 1.2, gain: 0.22 * vel, decay: 0.014 });
    const body = time + 0.002 + rng() * 0.003;
    g.tone(out, { at: body, type: "sine", freq: 140, sweep: [[0.05, 78]], gain: 0.5 * vel, decay: 0.07 });
    g.noise(out, { at: body, filter: "bandpass", freq: 700 * vary(rng, 0.1), q: 1.5, gain: 0.16 * vel, decay: 0.04 });
    // The stabilizer bar rattles a little after the stroke.
    g.noise(out, { at: body + 0.016, filter: "bandpass", freq: 3100, q: 3, gain: 0.07 * vel, decay: 0.008 });
  },
};

const press: PackVoice = {
  priority: Priority.mechanical,
  send: 0.04,
  level: 2,
  play(g, { time, pan, vel, rng }) {
    const out = g.out(pan);
    g.noise(out, { at: time, filter: "highpass", freq: 4600 * vary(rng, 0.08), gain: 0.2 * vel, decay: 0.006 });
    g.noise(out, { at: time, filter: "bandpass", freq: 1800 * vary(rng, 0.1), q: 1.8, gain: 0.17 * vel, decay: 0.014 });
    g.tone(out, { at: time, type: "sine", freq: 320, sweep: [[0.02, 210]], gain: 0.12 * vel, decay: 0.02 });
  },
};

const release: PackVoice = {
  priority: Priority.mechanical,
  send: 0.04,
  level: 2.5,
  play(g, { time, pan, vel, rng }) {
    const out = g.out(pan);
    g.noise(out, { at: time, filter: "highpass", freq: 5300 * vary(rng, 0.08), gain: 0.12 * vel, decay: 0.005 });
    g.noise(out, { at: time, filter: "bandpass", freq: 2400 * vary(rng, 0.1), q: 1.8, gain: 0.09 * vel, decay: 0.01 });
  },
};

const pen: PackVoice = {
  priority: Priority.mechanical,
  send: 0.08,
  level: 3.5,
  play(g, { time, pan, vel, rng }) {
    const out = g.out(pan);
    g.noise(out, { at: time, filter: "bandpass", freq: 2700 * vary(rng, 0.1), q: 2, gain: 0.14 * vel, decay: 0.008 });
    g.tone(out, { at: time, type: "sine", freq: 1760, gain: 0.05 * vel, decay: 0.05 });
  },
};

const snap: PackVoice = {
  priority: Priority.mechanical,
  send: 0.15,
  level: 3.5,
  play(g, { time, pan, vel }) {
    const out = g.out(pan);
    // A magnetic double tick: low catch, then a brighter latch.
    g.noise(out, { at: time, filter: "bandpass", freq: 2000, q: 3, gain: 0.12 * vel, decay: 0.006 });
    g.noise(out, { at: time + 0.012, filter: "bandpass", freq: 5200, q: 3, gain: 0.12 * vel, decay: 0.006 });
    g.tone(out, { at: time + 0.012, type: "sine", freq: 1318.5, gain: 0.07 * vel, decay: 0.09 });
  },
};

const tick: PackVoice = {
  priority: Priority.mechanical,
  send: 0.1,
  level: 3.5,
  play(g, { time, pan, pitch, vel }) {
    const out = g.out(pan);
    g.tone(out, { at: time, type: "triangle", freq: hz(stepSemitone(pitch)), gain: 0.09 * vel, decay: 0.05 });
    g.noise(out, { at: time, filter: "highpass", freq: 6000, gain: 0.04 * vel, decay: 0.004 });
  },
};

const note: PackVoice = {
  priority: Priority.note,
  send: 0.35,
  level: 2,
  play(g, { time, pan, pitch, vel, rng }) {
    const semitone = noteSemitone(pitch, pan);
    glassBell(g, g.out(pan), rng, { at: time, semitone, gain: 0.3 * vel, decay: registerDecay(semitone, 2.4, 1.1) });
  },
};

const swell: PackVoice = {
  priority: Priority.phrase,
  send: 0.6,
  level: 1.6,
  play(g, { time, pan, vel, rng }) {
    const out = g.out(pan * 0.3);
    g.noise(out, {
      at: time,
      filter: "bandpass",
      freq: 280,
      q: 0.9,
      sweep: [
        [0.9, 2600],
        [2.5, 850],
      ],
      gain: 0.2 * vel,
      attack: 0.9,
      decay: 1.7,
    });
    pad(g, out, rng, {
      at: time + 0.15,
      semitones: DRONE,
      type: "triangle",
      gain: 0.05 * vel,
      attack: 0.8,
      hold: 0.4,
      decay: 1.6,
      stagger: 0.25,
      lowpass: 1800,
    });
  },
};

const fanout: PackVoice = {
  priority: Priority.phrase,
  send: 0.4,
  level: 1.4,
  play(g, p) {
    const step = sixteenth(p);
    ARPEGGIO.forEach((semitone, i) => {
      const out = g.out(spread(i, ARPEGGIO.length, -0.6, 0.6));
      glassBell(g, out, p.rng, { at: p.time + i * step, semitone, gain: 0.2 * p.vel * (1 - i * 0.05), decay: 0.9 });
    });
  },
};

const chord: PackVoice = {
  priority: Priority.phrase,
  send: 0.5,
  level: 1.25,
  play(g, { time, vel, rng }) {
    // Strummed low to high and left to right, softer as it rises, ringing for a few seconds.
    CHORD.forEach((semitone, i) => {
      const out = g.out(spread(i, CHORD.length, -0.7, 0.7));
      const gain = 0.2 * vel * (1 - (0.4 * i) / CHORD.length);
      glassBell(g, out, rng, { at: time + i * 0.032, semitone, gain, decay: registerDecay(semitone, 3.6, 2.2) });
    });
    pad(g, g.out(0), rng, {
      at: time,
      semitones: DRONE,
      type: "triangle",
      gain: 0.045 * vel,
      attack: 0.3,
      hold: 0.8,
      decay: 3.5,
      lowpass: 1600,
    });
  },
};

const sweep: PackVoice = {
  priority: Priority.phrase,
  send: 0.45,
  level: 1.7,
  play(g, { time, vel, rng }) {
    const out = g.out(0);
    // Air falling from bright to dark as the swarm hands the page back.
    g.noise(out, {
      at: time,
      filter: "bandpass",
      freq: 4200,
      q: 1.1,
      sweep: [[0.95, 260]],
      gain: 0.18 * vel,
      attack: 0.08,
      hold: 0.35,
      decay: 0.6,
    });
    g.tone(out, { at: time, type: "sine", freq: 880, sweep: [[0.9, 440]], gain: 0.04 * vel, attack: 0.05, decay: 0.9 });
    glassBell(g, out, rng, { at: time + 0.05, semitone: 12, gain: 0.16 * vel, decay: 1.4 });
  },
};

const pop: PackVoice = {
  priority: Priority.mechanical,
  send: 0.1,
  level: 2.7,
  play(g, { time, pan, vel }) {
    const out = g.out(pan);
    g.tone(out, { at: time, type: "sine", freq: 880, sweep: [[0.04, 1320]], gain: 0.14 * vel, decay: 0.06 });
  },
};

/** Musical voices only; `silent-keys` reuses them without the mechanical sounds. */
export const studioMusic = { note, swell, fanout, chord, sweep } as const;

export const studio: SoundPack = {
  id: "studio",
  voices: { key, space, press, release, pen, snap, tick, pop, ...studioMusic },
};
