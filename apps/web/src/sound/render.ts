import { crowdBus, type CrowdClip } from './crowd';
import { SFX_ORDER, type SfxName, type SfxSet } from './sfx';
import { createMix } from './synth';
import { loopSeconds, type Track } from './tracks';

/** seconds of reverb / release after the loop that are folded back into its start */
const TAIL = 4;

/**
 * Renders one loop of a track offline into a buffer that loops without a
 * seam: the tail that rings past the loop end is mixed back into the start.
 */
export async function renderLoop(track: Track, sampleRate = 44100): Promise<AudioBuffer> {
  const len = loopSeconds(track);
  const frames = Math.ceil(len * sampleRate);
  const ctx = new OfflineAudioContext(2, frames + TAIL * sampleRate, sampleRate);
  const mix = createMix(ctx, ctx.destination, { level: 0.8 });
  track.score(mix, 0);
  const full = await ctx.startRendering();
  const out = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate });
  for (let ch = 0; ch < 2; ch++) {
    const src = full.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src.subarray(0, frames));
    for (let i = frames; i < src.length; i++) dst[i - frames] += src[i];
  }
  normalize(out, LOOP_RMS, 0.92);
  return out;
}

/**
 * Renders one crowd clip (crowd.ts). A loop is rendered like a music loop
 * (its tail folded back into the start). Not normalized: the clips keep
 * their levels relative to each other (the render script scales them all
 * by one factor).
 */
export async function renderClip(clip: CrowdClip, sampleRate = 44100): Promise<AudioBuffer> {
  const frames = Math.ceil(clip.seconds * sampleRate);
  const ctx = new OfflineAudioContext(2, frames + (clip.loop ? TAIL * sampleRate : 0), sampleRate);
  clip.play(crowdBus(ctx, ctx.destination), ctx.destination);
  const full = await ctx.startRendering();
  if (!clip.loop) return full;
  const out = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate });
  for (let ch = 0; ch < 2; ch++) {
    const src = full.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src.subarray(0, frames));
    for (let i = frames; i < src.length; i++) dst[i - frames] += src[i];
  }
  return out;
}

/** every track at the same loudness (average level), never above the peak limit */
const LOOP_RMS = 0.16;

export function normalize(buf: AudioBuffer, rms: number, peakLimit: number) {
  let sum = 0;
  let peak = 0;
  const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  for (const d of chs)
    for (let i = 0; i < d.length; i++) {
      sum += d[i] * d[i];
      peak = Math.max(peak, Math.abs(d[i]));
    }
  const now = Math.sqrt(sum / (chs.length * buf.length));
  if (now === 0) return;
  const gain = Math.min(rms / now, peakLimit / peak);
  for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= gain;
}

/** every sound of a set one after another (preview) */
export async function renderSfxDemo(set: SfxSet, gap = 1.6, sampleRate = 44100): Promise<{ buffer: AudioBuffer; at: Record<SfxName, number> }> {
  const total = SFX_ORDER.length * gap + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
  const mix = createMix(ctx, ctx.destination, { level: 0.9 });
  const at = {} as Record<SfxName, number>;
  SFX_ORDER.forEach((name, i) => {
    at[name] = 0.3 + i * gap;
    set.sounds[name](mix, at[name]);
  });
  return { buffer: await ctx.startRendering(), at };
}

/** 16-bit WAV bytes of a buffer (previews and file export) */
export function wavBytes(buf: AudioBuffer): Uint8Array {
  const chs = buf.numberOfChannels;
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * chs * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + n * chs * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, chs, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * chs * 2, true);
  out.setUint16(32, chs * 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, n * chs * 2, true);
  const data = Array.from({ length: chs }, (_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++)
    for (let c = 0; c < chs; c++) out.setInt16(44 + (i * chs + c) * 2, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  return new Uint8Array(out.buffer);
}
