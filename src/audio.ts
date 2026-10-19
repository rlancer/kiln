type Tone = { freq: number; dur: number; type?: OscillatorType; gain?: number; delay?: number };

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(next: boolean): void {
  muted = next;
}

export function isMuted(): boolean {
  return muted;
}

function context(): AudioContext | null {
  if (muted) return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(spec: Tone): void {
  const audio = context();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = spec.type ?? "square";
  osc.frequency.value = spec.freq;
  const start = audio.currentTime + (spec.delay ?? 0);
  const peak = spec.gain ?? 0.05;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + spec.dur + 0.02);
}

export function play(name: string): void {
  if (name === "jump") tone({ freq: 420, dur: 0.08, gain: 0.04 });
  if (name === "brick") tone({ freq: 620, dur: 0.07, gain: 0.05 });
  if (name === "bump") tone({ freq: 180, dur: 0.05, type: "triangle", gain: 0.04 });
  if (name === "place") tone({ freq: 140, dur: 0.09, type: "triangle", gain: 0.06 });
  if (name === "lock") {
    tone({ freq: 520, dur: 0.08, gain: 0.05 });
    tone({ freq: 780, dur: 0.12, delay: 0.07, gain: 0.04 });
  }
  if (name === "expire") tone({ freq: 90, dur: 0.12, type: "triangle", gain: 0.04 });
  if (name === "coin") tone({ freq: 880, dur: 0.06, gain: 0.04 });
  if (name === "stomp") tone({ freq: 160, dur: 0.08, type: "square", gain: 0.05 });
  if (name === "flag") tone({ freq: 300, dur: 0.1, type: "triangle", gain: 0.04 });
  if (name === "die") tone({ freq: 180, dur: 0.22, type: "sawtooth", gain: 0.04 });
  if (name === "fail") tone({ freq: 90, dur: 0.04, type: "square", gain: 0.03 });
  if (name === "spring") {
    tone({ freq: 240, dur: 0.06, type: "triangle", gain: 0.05 });
    tone({ freq: 480, dur: 0.1, delay: 0.05, gain: 0.04 });
  }
  if (name === "open") {
    tone({ freq: 360, dur: 0.08, type: "triangle", gain: 0.04 });
    tone({ freq: 540, dur: 0.12, delay: 0.08, gain: 0.04 });
  }
  if (name === "exit" || name === "secret") {
    tone({ freq: 392, dur: 0.1, gain: 0.05 });
    tone({ freq: 523, dur: 0.12, delay: 0.09, gain: 0.05 });
    tone({ freq: 659, dur: 0.16, delay: 0.18, gain: 0.05 });
  }
}
