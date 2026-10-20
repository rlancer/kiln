type Tone = { freq: number; dur: number; type?: OscillatorType; gain?: number; delay?: number; to?: number };
type Hiss = { dur: number; gain?: number; delay?: number; freq?: number; q?: number; to?: number };
type Bed = "hearth" | "chamber";

const MUSIC = 0.34;
const beds: Record<Bed, string> = {
  hearth: "/music/hearth.wav",
  chamber: "/music/chamber.wav",
};

let ctx: AudioContext | null = null;
let muted = false;
let unlocked = false;
let musicGain: GainNode | null = null;
let wanted: Bed = "hearth";
let pendingBed: Bed | null = null;
let active: { bed: Bed; source: AudioBufferSourceNode; gain: GainNode } | null = null;
const buffers = new Map<Bed, Promise<AudioBuffer>>();

export function setMuted(next: boolean): void {
  muted = next;
  if (!ctx || !musicGain) return;
  const now = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setTargetAtTime(next ? 0 : MUSIC, now, 0.04);
}

export function isMuted(): boolean {
  return muted;
}

export function unlock(): void {
  unlocked = true;
  const audio = engine();
  if (audio?.state === "suspended") void audio.resume();
  void follow();
}

export function setBed(bed: Bed): void {
  if (wanted === bed && (active?.bed === bed || pendingBed === bed)) return;
  wanted = bed;
  void follow();
}

function engine(): AudioContext | null {
  if (!unlocked) return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function bus(audio: AudioContext): GainNode {
  if (!musicGain) {
    musicGain = audio.createGain();
    musicGain.gain.value = muted ? 0 : MUSIC;
    musicGain.connect(audio.destination);
  }
  return musicGain;
}

const files = new Map<Bed, Promise<ArrayBuffer>>();

function fetchBed(bed: Bed): Promise<ArrayBuffer> {
  const cached = files.get(bed);
  if (cached) return cached;
  const pending = fetch(beds[bed]).then((response) => {
    if (!response.ok) throw new Error(`Missing ${beds[bed]}`);
    return response.arrayBuffer();
  });
  files.set(bed, pending);
  pending.catch(() => files.delete(bed));
  return pending;
}

function load(audio: AudioContext, bed: Bed): Promise<AudioBuffer> {
  const cached = buffers.get(bed);
  if (cached) return cached;
  const pending = fetchBed(bed).then((raw) => audio.decodeAudioData(raw.slice(0)));
  buffers.set(bed, pending);
  pending.catch(() => buffers.delete(bed));
  return pending;
}

for (const bed of ["hearth", "chamber"] as const) void fetchBed(bed);

function stop(voice: { source: AudioBufferSourceNode; gain: GainNode } | null, audio: AudioContext): void {
  if (!voice) return;
  const now = audio.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  voice.source.stop(now + 0.5);
}

async function follow(): Promise<void> {
  const audio = engine();
  if (!audio || active?.bed === wanted || pendingBed === wanted) return;
  const bed = wanted;
  pendingBed = bed;
  try {
    const buffer = await load(audio, bed);
    if (wanted !== bed) return;
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(bus(audio));
    const now = audio.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1, now + 0.4);
    source.start(now);
    stop(active, audio);
    active = { bed, source, gain };
  } catch (error) {
    console.warn(error);
  } finally {
    if (pendingBed === bed) pendingBed = null;
    if (wanted !== bed) void follow();
  }
}

function duck(): void {
  if (!ctx || !musicGain || muted) return;
  const now = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0.0001), now);
  musicGain.gain.linearRampToValueAtTime(MUSIC * 0.4, now + 0.03);
  musicGain.gain.linearRampToValueAtTime(MUSIC, now + 0.32);
}

function tone(spec: Tone): void {
  const audio = engine();
  if (!audio || muted) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = spec.type ?? "square";
  const start = audio.currentTime + (spec.delay ?? 0);
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.to) osc.frequency.exponentialRampToValueAtTime(spec.to, start + spec.dur);
  const peak = spec.gain ?? 0.05;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + spec.dur + 0.02);
}

let noiseBuffer: AudioBuffer | null = null;

// Band-passed white noise for thuds, crackles and hisses.
function hiss(spec: Hiss): void {
  const audio = engine();
  if (!audio || muted) return;
  if (!noiseBuffer) {
    noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = spec.q ?? 1;
  const start = audio.currentTime + (spec.delay ?? 0);
  filter.frequency.setValueAtTime(spec.freq ?? 1200, start);
  if (spec.to) filter.frequency.exponentialRampToValueAtTime(spec.to, start + spec.dur);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(spec.gain ?? 0.08, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.dur);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  source.start(start, Math.random() * 0.5);
  source.stop(start + spec.dur + 0.02);
}

// `pitch` shifts the cue in semitones, so chained coins and stomps climb.
export function play(name: string, pitch = 0): void {
  const k = 2 ** (pitch / 12);
  if (name !== "land" && name !== "coin") duck();
  if (name === "jump") tone({ freq: 260, to: 640, dur: 0.11, gain: 0.035 });
  if (name === "land") hiss({ dur: 0.07, freq: 260, gain: 0.07 });
  if (name === "brick") {
    hiss({ dur: 0.05, freq: 2200, gain: 0.05, q: 2 });
    tone({ freq: 620, dur: 0.06, gain: 0.04 });
    tone({ freq: 930, dur: 0.08, delay: 0.05, gain: 0.035 });
  }
  if (name === "bump") {
    tone({ freq: 180, to: 110, dur: 0.06, type: "triangle", gain: 0.06 });
    hiss({ dur: 0.05, freq: 500, gain: 0.05 });
  }
  if (name === "place") {
    tone({ freq: 160, to: 90, dur: 0.1, type: "triangle", gain: 0.08 });
    hiss({ dur: 0.08, freq: 400, gain: 0.07 });
  }
  if (name === "lock") {
    hiss({ dur: 0.12, freq: 300, gain: 0.1 });
    tone({ freq: 120, to: 60, dur: 0.14, type: "triangle", gain: 0.09 });
    tone({ freq: 520, dur: 0.08, delay: 0.04, gain: 0.05 });
    tone({ freq: 780, dur: 0.14, delay: 0.11, gain: 0.04 });
  }
  if (name === "expire") {
    hiss({ dur: 0.35, freq: 3000, to: 900, gain: 0.05, q: 0.7 });
    tone({ freq: 140, to: 70, dur: 0.18, type: "triangle", gain: 0.04 });
  }
  if (name === "coin") {
    tone({ freq: 988 * k, dur: 0.05, gain: 0.035 });
    tone({ freq: 1319 * k, dur: 0.14, delay: 0.05, gain: 0.035 });
  }
  if (name === "stomp") {
    hiss({ dur: 0.09, freq: 700, gain: 0.09 });
    tone({ freq: 330 * k, to: 90 * k, dur: 0.1, gain: 0.05 });
    tone({ freq: 660 * k, dur: 0.07, delay: 0.06, gain: 0.03 });
  }
  if (name === "flag") {
    hiss({ dur: 0.4, freq: 1400, to: 600, gain: 0.05, q: 0.6 });
    tone({ freq: 300, to: 600, dur: 0.16, type: "triangle", gain: 0.05 });
  }
  if (name === "die") {
    hiss({ dur: 0.3, freq: 900, to: 150, gain: 0.1 });
    tone({ freq: 440, to: 55, dur: 0.5, type: "sawtooth", gain: 0.04 });
  }
  if (name === "fail") tone({ freq: 90, dur: 0.04, type: "square", gain: 0.03 });
  if (name === "spring") {
    tone({ freq: 180, to: 900, dur: 0.18, type: "triangle", gain: 0.06 });
    tone({ freq: 360, to: 1200, dur: 0.14, delay: 0.03, gain: 0.025 });
  }
  if (name === "open") {
    hiss({ dur: 0.5, freq: 200, to: 1200, gain: 0.05 });
    tone({ freq: 360, dur: 0.08, type: "triangle", gain: 0.04 });
    tone({ freq: 540, dur: 0.1, delay: 0.08, gain: 0.04 });
    tone({ freq: 720, dur: 0.16, delay: 0.16, gain: 0.04 });
  }
  if (name === "exit" || name === "secret") {
    const notes = name === "secret" ? [440, 554, 659, 880, 1109] : [392, 523, 659, 784, 1047];
    notes.forEach((freq, i) => tone({ freq, dur: i === notes.length - 1 ? 0.4 : 0.1, delay: i * 0.08, gain: 0.045 }));
    notes.forEach((freq, i) => tone({ freq: freq / 2, dur: 0.1, delay: i * 0.08, type: "triangle", gain: 0.05 }));
    hiss({ dur: 0.6, freq: 4000, to: 1500, gain: 0.03, delay: 0.3, q: 0.5 });
  }
}
