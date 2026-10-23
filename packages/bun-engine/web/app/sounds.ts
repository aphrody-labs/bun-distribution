// Interface sounds, synthesised with WebAudio: short sine blips with a fast attack and an exponential
// decay. There is no audio file and no third-party sample. Sounds are optional: the shell.db key `sounds`
// is "auto" (on, unless motion is reduced), "on" or "off", nothing depends on a sound being heard, and a
// browser that has no AudioContext simply stays silent.

export type Cue = "focus" | "select" | "back" | "error";
export type SoundMode = "auto" | "on" | "off";

interface Note {
  /** Seconds after the cue starts. */
  at: number;
  /** Start and end frequency in Hz (a short glide gives the blip its shape). */
  from: number;
  to: number;
  /** Seconds. */
  length: number;
  peak: number;
  wave: OscillatorType;
}

// Peaks stay at or below 0.09 of full scale: quiet UI feedback that never competes with a game.
const recipes: Record<Cue, Note[]> = {
  focus: [{ at: 0, from: 1180, to: 1040, length: 0.04, peak: 0.05, wave: "sine" }],
  select: [
    { at: 0, from: 660, to: 700, length: 0.07, peak: 0.08, wave: "sine" },
    { at: 0.055, from: 990, to: 1040, length: 0.09, peak: 0.08, wave: "sine" },
  ],
  back: [
    { at: 0, from: 880, to: 840, length: 0.06, peak: 0.07, wave: "sine" },
    { at: 0.05, from: 587, to: 560, length: 0.09, peak: 0.07, wave: "sine" },
  ],
  error: [{ at: 0, from: 220, to: 196, length: 0.14, peak: 0.07, wave: "triangle" }],
};

/** Schedules one cue on any audio context (live or offline) starting at `start` seconds. */
export function scheduleCue(context: BaseAudioContext, cue: Cue, start = 0): number {
  let end = start;
  for (const note of recipes[cue]) {
    const at = start + note.at;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = note.wave;
    oscillator.frequency.setValueAtTime(note.from, at);
    oscillator.frequency.exponentialRampToValueAtTime(note.to, at + note.length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(note.peak, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + note.length);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + note.length + 0.02);
    end = Math.max(end, at + note.length + 0.02);
  }
  return end - start;
}

let mode: SoundMode = "auto";
let reduced: () => boolean = () => false;
let context: AudioContext | undefined;
let lastFocusAt = 0;
const heard: Cue[] = [];

export function configureSounds(next: { mode: string; reducedMotion: () => boolean }): void {
  mode = next.mode === "on" || next.mode === "off" ? next.mode : "auto";
  reduced = next.reducedMotion;
}

/** Whether a cue would play right now: auto follows the motion setting, so reduced motion is silent. */
export function soundsOn(): boolean {
  return mode === "on" || (mode === "auto" && !reduced());
}

export function play(cue: Cue): void {
  if (!soundsOn() || typeof AudioContext === "undefined") return;
  const now = performance.now();
  if (cue === "focus") {
    if (now - lastFocusAt < 45) return;
    lastFocusAt = now;
  }
  try {
    context ??= new AudioContext({ latencyHint: "interactive" });
    if (context.state === "suspended") void context.resume();
    scheduleCue(context, cue, context.currentTime + 0.005);
    heard.push(cue);
    if (heard.length > 50) heard.shift();
  } catch {
    // no audio device: stay silent, nothing relies on the sound
  }
}

/** For automation: the cues played so far and an offline render of a cue (peak and RMS prove it is not silent or clipping). */
Object.assign(globalThis, {
  bunosSounds: {
    heard: () => [...heard],
    mode: () => ({ mode, on: soundsOn() }),
    async render(cue: Cue) {
      const rate = 44100;
      const offline = new OfflineAudioContext(1, rate, rate);
      const length = scheduleCue(offline, cue);
      const buffer = await offline.startRendering();
      const data = buffer.getChannelData(0);
      let peak = 0;
      let sum = 0;
      const live = Math.ceil(length * rate);
      for (let i = 0; i < live; i++) {
        peak = Math.max(peak, Math.abs(data[i]!));
        sum += data[i]! * data[i]!;
      }
      return {
        cue,
        seconds: Number(length.toFixed(3)),
        peak: Number(peak.toFixed(4)),
        rms: Number(Math.sqrt(sum / live).toFixed(4)),
      };
    },
  },
});
