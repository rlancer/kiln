export {};

const key = process.env.OPENROUTER_API_KEY;

const tracks = {
  hearth: `1980s home-console map theme, 30 seconds, instrumental only. Seamless loop: the last beat flows straight into the first beat. No fade in, no fade out, no intro, no outro, no ending sting, no silence. No vocals, no humming, no lyrics.

Sound chip only, dry and close, like a late-80s 8-bit soundtrack: two pulse-wave channels, a triangle-wave bass, and a noise-channel snare and hat. About 126 BPM. Bright major melody, bouncy walking bass, simple arpeggios. Cheerful and sturdy, for a title and world map. No guitars, no orchestra, no pads, no modern drums, no reverb. Do not imitate any existing game, film, or song.`,
  chamber: `1980s home-console action theme for a brick platformer, 30 seconds, instrumental only. Seamless loop with the same energy from the first second to the last. No fade in, no fade out, no intro, no outro, no final cadence, no silence. No vocals, no humming, no lyrics.

Sound chip only, dry and close: two pulse-wave leads, triangle-wave bass, noise-channel drums. About 168 BPM. Catchy square-wave melody, fast arpeggio chords, driving bass, steady kick and snare. Playful and urgent, but not dense, so jump sounds can cut through. No guitars, no orchestra, no pads, no modern drums, no reverb. Do not imitate any existing game, film, or song.`,
} as const;

type TrackName = keyof typeof tracks;

async function generate(name: TrackName): Promise<Uint8Array> {
  if (!key) throw new Error("Set OPENROUTER_API_KEY");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:4317",
      "X-Title": "Kiln",
    },
    body: JSON.stringify({
      model: "google/lyria-3-clip-preview",
      messages: [{ role: "user", content: tracks[name] }],
      modalities: ["text", "audio"],
      stream: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(`${name} failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const audio: string[] = [];
  const notes: string[] = [];

  const take = (parsed: unknown) => {
    if (!parsed || typeof parsed !== "object") return;
    const record = parsed as {
      error?: { message?: string };
      choices?: Array<{
        delta?: { audio?: { data?: string; transcript?: string }; content?: string };
        message?: { content?: unknown; audio?: { data?: string } };
      }>;
    };
    if (record.error?.message) throw new Error(`${name}: ${record.error.message}`);
    const choice = record.choices?.[0];
    const data = choice?.delta?.audio?.data ?? choice?.message?.audio?.data;
    const transcript = choice?.delta?.audio?.transcript;
    const content = choice?.delta?.content;
    if (data) audio.push(data);
    if (transcript) notes.push(transcript);
    if (typeof content === "string" && content.trim()) notes.push(content);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      take(JSON.parse(payload) as unknown);
    }
  }

  if (audio.length === 0) {
    throw new Error(`${name}: no audio in response. notes=${notes.join("").slice(0, 300)}`);
  }
  const joined = Uint8Array.from(Buffer.from(audio.join(""), "base64"));
  const pieces = audio.map((part) => Uint8Array.from(Buffer.from(part, "base64")));
  const separate = new Uint8Array(pieces.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of pieces) {
    separate.set(part, offset);
    offset += part.length;
  }
  const bytes = ext(joined) !== "bin" ? joined : separate;
  console.log(`${name}: ${bytes.byteLength} bytes via ${bytes === joined ? "joined" : "chunks"}. ${notes.join("").slice(0, 240)}`);
  return bytes;
}

function ext(bytes: Uint8Array): string {
  const head = new TextDecoder().decode(bytes.slice(0, 12));
  if (head.startsWith("RIFF")) return "wav";
  if (head.startsWith("OggS")) return "ogg";
  if (head.startsWith("ID3") || bytes[0] === 0xff) return "mp3";
  return "bin";
}

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd[0]} exited ${code}\n${stderr.slice(-800)}`);
  return `${stdout}\n${stderr}`;
}

async function meanVolume(file: string, seconds: number): Promise<number> {
  const log = await run([
    "ffmpeg",
    "-hide_banner",
    "-ss",
    seconds.toFixed(3),
    "-t",
    "1",
    "-i",
    file,
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const match = log.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  if (!match?.[1]) return -99;
  return Number(match[1]);
}

function loopCrossfade(samples: Int16Array, channels: number, fadeFrames: number): Int16Array {
  const frames = samples.length / channels;
  const midFrames = frames - fadeFrames * 2;
  const out = new Int16Array((frames - fadeFrames) * channels);
  out.set(samples.subarray(fadeFrames * channels, (fadeFrames + midFrames) * channels), 0);
  for (let i = 0; i < fadeFrames; i++) {
    const t = i / (fadeFrames - 1);
    const tailGain = Math.cos((t * Math.PI) / 2);
    const headGain = Math.sin((t * Math.PI) / 2);
    for (let channel = 0; channel < channels; channel++) {
      const tail = samples[(frames - fadeFrames + i) * channels + channel] ?? 0;
      const head = samples[i * channels + channel] ?? 0;
      const mixed = tail * tailGain + head * headGain;
      out[(midFrames + i) * channels + channel] = Math.max(-32768, Math.min(32767, Math.round(mixed)));
    }
  }
  return out;
}

function writeWav(samples: Int16Array, rate: number, channels: number): Uint8Array {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function finish(name: TrackName, rawPath: string): Promise<void> {
  const dir = "public/music";
  const trimmed = `${dir}/${name}.trim.wav`;
  const leveled = `${dir}/${name}.level.wav`;
  await run([
    "ffmpeg",
    "-y",
    "-i",
    rawPath,
    "-af",
    "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02",
    trimmed,
  ]);
  const probe = await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", trimmed]);
  const duration = Number(probe.match(/[\d.]+/)?.[0]);
  if (!Number.isFinite(duration) || duration < 8) throw new Error(`${name}: bad duration ${probe}`);

  const windows: number[] = [];
  for (let second = 0; second < duration - 0.2; second += 1) windows.push(await meanVolume(trimmed, second));
  const body = windows.slice(0, Math.max(1, Math.floor(windows.length * 0.7)));
  const sorted = [...body].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? -18;
  let keep = windows.length;
  for (let index = windows.length - 1; index >= 0; index -= 1) {
    if ((windows[index] ?? -99) >= median - 6) {
      keep = index + 1;
      break;
    }
  }
  if (keep < 8) throw new Error(`${name}: only ${keep}s stays above the fade`);
  const cut = Math.min(duration, keep);
  console.log(`${name}: body ${median.toFixed(1)} dB, keeping ${cut.toFixed(0)}s of ${duration.toFixed(1)}s`);

  await run([
    "ffmpeg",
    "-y",
    "-i",
    trimmed,
    "-t",
    cut.toFixed(3),
    "-af",
    "loudnorm=I=-18:TP=-1.5:LRA=7",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    leveled,
  ]);
  const wav = await Bun.file(leveled).arrayBuffer();
  const view = new DataView(wav);
  let offset = 12;
  let pcm: Int16Array | null = null;
  while (offset + 8 < wav.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      pcm = new Int16Array(wav.slice(offset + 8, offset + 8 + size));
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!pcm) throw new Error(`${name}: leveled wav has no data chunk`);
  const faded = loopCrossfade(pcm, 2, Math.floor(44100 * 0.5));
  const seamL = (faded[0] ?? 0) - (faded[faded.length - 2] ?? 0);
  const seamR = (faded[1] ?? 0) - (faded[faded.length - 1] ?? 0);
  const out = `${dir}/${name}.wav`;
  await Bun.write(out, writeWav(faded, 44100, 2));
  await Bun.file(trimmed).delete();
  await Bun.file(leveled).delete();
  console.log(
    `${name}: wrote ${out} (${(faded.length / 2 / 44100).toFixed(2)}s, seam ${seamL}/${seamR})`,
  );
}

const fromRaw = process.argv.includes("--from-raw");
await Bun.$`mkdir -p public/music`.quiet();
const names = Object.keys(tracks) as TrackName[];
await Promise.all(
  names.map(async (name) => {
    const rawPath = fromRaw ? `public/music/${name}.raw.mp3` : `public/music/${name}.raw.bin`;
    if (!fromRaw) {
      const bytes = await generate(name);
      const path = `public/music/${name}.raw.${ext(bytes)}`;
      await Bun.write(path, bytes);
      await finish(name, path);
      await Bun.file(path).delete();
      return;
    }
    await finish(name, rawPath);
  }),
);
console.log(`ready ${names.join(", ")}`);
