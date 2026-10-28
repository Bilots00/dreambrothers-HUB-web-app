/**
 * Da una MusicSpec a un mp3 verificato. Gira dentro un worker thread
 * (server/music/worker.ts): sintesi, misure e codifica mp3 sono tutte CPU e
 * non devono fermare il server Express.
 *
 * Tracce ambient: render di loopSec + 8 s di coda, overlap-add circolare
 * (coda sommata all'inizio) → un buffer di esattamente loopSec che si ripete
 * senza salti. Nel file mp3 il buffer e' circondato da 0,1 s di "rotolo"
 * periodico (la fine prima, l'inizio dopo): qualunque ritardo del decoder
 * mp3 sotto i 100 ms cade dentro contenuto periodico, quindi la regione
 * [loopStartSec, loopStartSec + loopSec] suona senza cuciture su qualsiasi player.
 */
import {
  AD_LENGTHS, AMBIENT_LENGTHS, LOUDNESS_TARGET, TRUE_PEAK_CEILING,
  type MusicSpec,
} from "@shared/music";
import { CloudDriftEngine, resolveTrackParams, snapLoopSec } from "./engine";
import { scheduleSfx, SFX_LENGTH } from "./sfx";
import {
  encodeMp3, fadeOut, integratedLufs, junctionCheck, normalize, silenceGate,
  truePeakDb, trimSilence, wrapLoop, type Stereo,
} from "./dsp";
import { trackTitle } from "./names";

export const SR = 44100;
const TAIL = 8;
const ROLL = 0.1;
// ritardo nominale encoder+decoder di LAME (576 + 529 campioni): serve solo a
// centrare la regione nel rotolo, l'errore tollerato e' ±ROLL
const MP3_DELAY = 1105 / SR;

export type RenderResult = {
  mp3: Buffer;
  title: string;
  durationSec: number;      // durata del file decodificato (con i rotoli)
  loopStartSec: number | null;
  loopSec: number | null;
  bpm: number | null;
  key: string | null;
  mood: string | null;
  metrics: {
    lufs: number; truePeakDb: number; gainDb: number; limited: boolean;
    gate: ReturnType<typeof silenceGate>; junction: ReturnType<typeof junctionCheck> | null;
    renderMs: number; encodeMs: number;
  };
  fails: string[];
};

const WINDOW = 12; // secondi programmati per volta
const LEAD = 4;    // margine: un evento e' sempre creato almeno 4 s prima di suonare

/**
 * Render offline. Se `schedule` restituisce uno stepper, gli eventi vengono
 * programmati a finestre: il contesto si sospende ogni WINDOW secondi, si
 * aggiungono i nodi della finestra successiva e si riparte. I nodi gia'
 * finiti escono dal grafo, quindi il costo resta lineare con la durata.
 */
export async function offline(seconds: number, schedule: (ctx: any) => void | ((until: number) => void)): Promise<Stereo> {
  const { OfflineAudioContext } = await import("node-web-audio-api");
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const step = schedule(ctx);
  let drift = 0;
  if (typeof step === "function") {
    step(WINDOW + LEAD);
    for (let t = WINDOW; t < seconds - 0.5; t += WINDOW) {
      const at = t;
      ctx.suspend(at).then(() => {
        // il contesto deve essere fermo li': se e' andato avanti, gli eventi della finestra arriverebbero tardi
        drift = Math.max(drift, Math.abs(ctx.currentTime - at));
        step(at + WINDOW + LEAD);
        return ctx.resume();
      });
    }
  }
  const buf = await ctx.startRendering();
  if (drift > 0.05) throw new Error(`render a finestre fuori tempo di ${drift.toFixed(3)} s`);
  return [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
}

export async function renderSpec(spec: MusicSpec): Promise<RenderResult> {
  const t0 = Date.now();
  if (spec.kind === "sfx" || spec.purpose === "sfx") {
    const type = spec.sfxType ?? "reward";
    let ch = await offline(SFX_LENGTH[type] + 0.4, (ctx) => scheduleSfx(ctx, type, spec.seed));
    ch = trimSilence(ch, SR);
    const renderMs = Date.now() - t0;
    const nrm = normalize(ch, SR, LOUDNESS_TARGET.sfx, TRUE_PEAK_CEILING);
    ch = nrm.ch;
    const gate = silenceGate(ch, SR, { maxOpening: 0.03, maxGap: 0.6, window: 0.01, thresholdDb: -50 });
    const lufs = integratedLufs(ch, SR), tp = truePeakDb(ch);
    const title = spec.title || trackTitle(spec);
    const t1 = Date.now();
    const mp3 = await encodeMp3(ch, SR, 160, title);
    const fails = [...gate.fails];
    if (tp > -1) fails.push(`true peak ${tp.toFixed(2)} dBTP sopra -1`);
    return {
      mp3, title, durationSec: ch[0].length / SR, loopStartSec: null, loopSec: null, bpm: null, key: null, mood: null,
      metrics: { lufs, truePeakDb: tp, gainDb: nrm.gainDb, limited: nrm.limited, gate, junction: null, renderMs, encodeMs: Date.now() - t1 },
      fails,
    };
  }

  const p = resolveTrackParams({ purpose: spec.purpose, mood: spec.mood, key: spec.key, bpm: spec.bpm, seed: spec.seed });
  const title = spec.title || trackTitle(spec);
  const isAd = spec.purpose === "ad";
  let ch: Stereo, loopSec: number | null = null;
  if (isAd) {
    const len = AD_LENGTHS.includes(spec.lengthSec as any) ? spec.lengthSec! : 30;
    ch = await offline(len, (ctx) => new CloudDriftEngine(ctx, p).scheduleAd(len));
    fadeOut(ch, SR, 1.2);
  } else {
    const want = Math.min(Math.max(spec.lengthSec ?? 150, AMBIENT_LENGTHS[0]), AMBIENT_LENGTHS[AMBIENT_LENGTHS.length - 1]);
    loopSec = snapLoopSec(want, p.bpm);
    const n = Math.round(loopSec * SR);
    const raw = await offline(loopSec + TAIL, (ctx) => new CloudDriftEngine(ctx, p).loopStepper(loopSec!));
    ch = wrapLoop(raw, n);
  }
  const renderMs = Date.now() - t0;
  const nrm = normalize(ch, SR, isAd ? LOUDNESS_TARGET.ad : LOUDNESS_TARGET.ambient, TRUE_PEAK_CEILING);
  ch = nrm.ch;
  const lufs = integratedLufs(ch, SR), tp = truePeakDb(ch);
  const gate = silenceGate(ch, SR, isAd ? { maxOpening: 0.3 } : {});
  const junction = loopSec ? junctionCheck(ch, SR) : null;
  const fails = [...gate.fails];
  if (tp > -1) fails.push(`true peak ${tp.toFixed(2)} dBTP sopra -1`);
  const target = isAd ? LOUDNESS_TARGET.ad : LOUDNESS_TARGET.ambient;
  if (Math.abs(lufs - target) > 1) fails.push(`loudness ${lufs.toFixed(1)} LUFS lontana dal target ${target}`);
  if (junction && !junction.ok) fails.push(`giunzione del loop: salto RMS ${junction.rmsStepDb.toFixed(1)} dB, campione ${junction.sampleJumpX.toFixed(1)}x`);

  // rotoli periodici attorno al loop (vedi commento in testa)
  let enc = ch, loopStartSec: number | null = null;
  if (loopSec) {
    const r = Math.round(ROLL * SR), n = ch[0].length;
    enc = ch.map((c) => { const y = new Float32Array(n + 2 * r); y.set(c.subarray(n - r), 0); y.set(c, r); y.set(c.subarray(0, r), n + r); return y; }) as Stereo;
    loopStartSec = ROLL + MP3_DELAY;
  }
  const t1 = Date.now();
  const mp3 = await encodeMp3(enc, SR, 128, title);
  return {
    mp3, title, durationSec: enc[0].length / SR, loopStartSec, loopSec, bpm: p.bpm, key: p.key, mood: p.mood,
    metrics: { lufs, truePeakDb: tp, gainDb: nrm.gainDb, limited: nrm.limited, gate, junction, renderMs, encodeMs: Date.now() - t1 },
    fails,
  };
}
