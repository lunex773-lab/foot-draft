/**
 * The crowd of the SHOOT GACHA (decision 114): pre-rendered clips
 * (assets/audio/crowd-*.m4a, listed in manifest.json with the gain that
 * brings them back to their rendered level). Fetched once (the gacha page
 * starts it early) and decoded for the audio context that plays them.
 */
interface ClipManifest {
  clipGain?: number;
  clips?: Record<string, { file: string; seconds: number; loop: boolean }>;
}

let raw: Promise<{ gain: number; data: Map<string, ArrayBuffer> } | null> | null = null;

/** download the clips (no decoding yet: that needs the audio context) */
export function prefetchCrowd() {
  raw ??= fetch('/audio/manifest.json')
    .then((r) => (r.ok ? (r.json() as Promise<ClipManifest>) : null))
    .then(async (m) => {
      if (!m?.clips) return null;
      const entries = await Promise.all(Object.entries(m.clips).map(async ([id, c]) => [id, await (await fetch(`/audio/${c.file}`)).arrayBuffer()] as const));
      return { gain: m.clipGain ?? 1, data: new Map(entries) };
    })
    .catch((err) => {
      console.warn('crowd sounds could not be loaded', err);
      raw = null; // try again next time
      return null;
    });
  return raw;
}

export async function loadCrowd(ctx: BaseAudioContext): Promise<{ gain: number; clips: Map<string, AudioBuffer> } | null> {
  const r = await prefetchCrowd();
  if (!r) return null;
  const clips = new Map<string, AudioBuffer>();
  await Promise.all(
    [...r.data].map(async ([id, ab]) => {
      try {
        // decoding takes the buffer: decode a copy so the download can be decoded again
        clips.set(id, await ctx.decodeAudioData(ab.slice(0)));
      } catch (err) {
        console.warn('crowd sound could not be decoded', id, err);
      }
    }),
  );
  return { gain: r.gain, clips };
}
