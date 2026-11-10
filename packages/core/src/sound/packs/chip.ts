import { ARPEGGIO, hz, noteSemitone, stepSemitone } from "../scale";
import { type Junction, type PackVoice, Priority, type SoundPack, type VoiceGroup } from "../voice";
import { sixteenth, spread, vary } from "./common";

/**
 * "8bit": square and triangle waves like a handheld console. Square leads are mixed low because
 * the waveform is loud for its level; low notes use the triangle, as chiptune bass lines do.
 */

/** Chip arpeggio of the completion chord: root, third, fifth, octave, ninth, up to A5. */
const CHIP_CHORD: readonly number[] = [0, 4, 7, 12, 14, 16, 19, 24];

function blip(g: VoiceGroup, out: Junction, at: number, semitone: number, gain: number, decay: number): void {
  g.tone(out, { at, type: "square", freq: hz(semitone), gain, attack: 0.001, hold: 0.02, decay, lowpass: 6000 });
}

const key: PackVoice = {
  priority: Priority.mechanical,
  send: 0.03,
  level: 4,
  play(g, { time, pan, vel, rng }) {
    const out = g.out(pan);
    g.tone(out, {
      at: time,
      type: "square",
      freq: 1200 * vary(rng, 0.1),
      gain: 0.035 * vel,
      decay: 0.012,
      lowpass: 5000,
    });
    g.noise(out, { at: time, filter: "highpass", freq: 3000, gain: 0.06 * vel, decay: 0.01 });
  },
};

const space: PackVoice = {
  priority: Priority.mechanical,
  send: 0.03,
  level: 6,
  play(g, { time, pan, vel }) {
    g.tone(g.out(pan), {
      at: time,
      type: "square",
      freq: 300,
      sweep: [[0.04, 150]],
      gain: 0.06 * vel,
      decay: 0.04,
      lowpass: 4000,
    });
  },
};

const press: PackVoice = {
  priority: Priority.mechanical,
  send: 0.03,
  level: 6,
  play(g, { time, pan, vel }) {
    g.tone(g.out(pan), { at: time, type: "square", freq: 600, gain: 0.05 * vel, decay: 0.015, lowpass: 5000 });
  },
};

const release: PackVoice = {
  priority: Priority.mechanical,
  send: 0.03,
  level: 6,
  play(g, { time, pan, vel }) {
    g.tone(g.out(pan), { at: time, type: "square", freq: 900, gain: 0.035 * vel, decay: 0.01, lowpass: 5000 });
  },
};

const pen: PackVoice = {
  priority: Priority.mechanical,
  send: 0.05,
  level: 6,
  play(g, { time, pan, vel }) {
    g.tone(g.out(pan), { at: time, type: "square", freq: 1500, gain: 0.035 * vel, decay: 0.01, lowpass: 5000 });
  },
};

const snap: PackVoice = {
  priority: Priority.mechanical,
  send: 0.1,
  level: 2.5,
  play(g, { time, pan, vel }) {
    const out = g.out(pan);
    blip(g, out, time, 31, 0.04 * vel, 0.03);
    blip(g, out, time + 0.03, 36, 0.04 * vel, 0.05);
  },
};

const tick: PackVoice = {
  priority: Priority.mechanical,
  send: 0.08,
  level: 3.5,
  play(g, { time, pan, pitch, vel }) {
    blip(g, g.out(pan), time, stepSemitone(pitch), 0.045 * vel, 0.05);
  },
};

const note: PackVoice = {
  priority: Priority.note,
  send: 0.15,
  level: 5,
  play(g, { time, pan, pitch, vel }) {
    const semitone = noteSemitone(pitch, pan);
    const out = g.out(pan);
    if (semitone < 12) {
      g.tone(out, {
        at: time,
        type: "triangle",
        freq: hz(semitone),
        gain: 0.22 * vel,
        attack: 0.002,
        hold: 0.08,
        decay: 0.35,
      });
    } else {
      g.tone(out, {
        at: time,
        type: "square",
        freq: hz(semitone),
        gain: 0.07 * vel,
        attack: 0.002,
        hold: 0.06,
        decay: 0.3,
        lowpass: 7000,
      });
    }
  },
};

const swell: PackVoice = {
  priority: Priority.phrase,
  send: 0.4,
  level: 1.3,
  play(g, { time, vel }) {
    const out = g.out(0);
    g.tone(out, {
      at: time,
      type: "triangle",
      freq: hz(-12),
      sweep: [[1.4, hz(12)]],
      gain: 0.16 * vel,
      attack: 0.4,
      hold: 0.6,
      decay: 1,
    });
    g.noise(out, {
      at: time,
      filter: "lowpass",
      freq: 300,
      sweep: [[1.2, 3000]],
      gain: 0.05 * vel,
      attack: 0.8,
      decay: 1,
    });
  },
};

const fanout: PackVoice = {
  priority: Priority.phrase,
  send: 0.25,
  level: 4,
  play(g, p) {
    const step = sixteenth(p);
    ARPEGGIO.forEach((semitone, i) => {
      blip(g, g.out(spread(i, ARPEGGIO.length, -0.6, 0.6)), p.time + i * step, semitone, 0.05 * p.vel, 0.12);
    });
  },
};

const chord: PackVoice = {
  priority: Priority.phrase,
  send: 0.3,
  level: 2.5,
  play(g, { time, vel }) {
    // A fast two-pass arpeggio over a held triangle bass.
    const step = 0.045;
    for (let pass = 0; pass < 2; pass++) {
      CHIP_CHORD.forEach((semitone, i) => {
        const n = pass * CHIP_CHORD.length + i;
        const out = g.out(spread(i, CHIP_CHORD.length, -0.6, 0.6));
        blip(g, out, time + n * step, semitone + 12, 0.05 * vel * (1 - pass * 0.35), 0.18);
      });
    }
    g.tone(g.out(0), {
      at: time,
      type: "triangle",
      freq: hz(-12),
      gain: 0.2 * vel,
      attack: 0.005,
      hold: 1.2,
      decay: 0.8,
    });
  },
};

const sweep: PackVoice = {
  priority: Priority.phrase,
  send: 0.3,
  level: 3,
  play(g, { time, vel }) {
    const out = g.out(0);
    g.tone(out, {
      at: time,
      type: "square",
      freq: hz(24),
      sweep: [[0.7, hz(-12)]],
      gain: 0.05 * vel,
      hold: 0.4,
      decay: 0.4,
      lowpass: 5000,
    });
    g.noise(out, {
      at: time,
      filter: "lowpass",
      freq: 4000,
      sweep: [[0.8, 200]],
      gain: 0.06 * vel,
      hold: 0.3,
      decay: 0.5,
    });
  },
};

const pop: PackVoice = {
  priority: Priority.mechanical,
  send: 0.08,
  level: 2.5,
  play(g, { time, pan, vel }) {
    const out = g.out(pan);
    blip(g, out, time, 24, 0.04 * vel, 0.03);
    blip(g, out, time + 0.035, 31, 0.04 * vel, 0.04);
  },
};

export const chip: SoundPack = {
  id: "8bit",
  voices: { key, space, press, release, pen, snap, tick, note, swell, fanout, chord, sweep, pop },
};
