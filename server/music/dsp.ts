/**
 * Misure e cancelli di qualita' sull'audio generato, PRIMA di salvarlo.
 * Port in TypeScript dei controlli Python della sessione Cloud Drift
 * (music/origin-cloud-drift/gate.py e loopcheck.py) piu' la loudness
 * integrata BS.1770 (LUFS) e il true peak sovracampionato 4x.
 * Ogni controllo ha un test che lo fa diventare rosso su un caso rotto noto
 * (server/music/dsp.test.ts): un controllo che non sa fallire non e' un controllo.
 */

export type Stereo = [Float32Array, Float32Array];

const db = (x: number) => 20 * Math.log10(x + 1e-12);

// ── Loudness BS.1770-4 (K-weighting + gating), coefficienti per qualunque sr ──
function biquad(x: Float32Array, b: number[], a: number[]): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function kWeight(x: Float32Array, sr: number): Float32Array {
  // stessi parametri di libebur128
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const pb = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0];
  const pa = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr);
  a0 = 1 + K / Q + K * K;
  const rb = [1, -2, 1], ra = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  return biquad(biquad(x, pb, pa), rb, ra);
}

/** Loudness integrata in LUFS. Per clip piu' corti di 400 ms usa l'intero clip come un blocco. */
export function integratedLufs(ch: Stereo, sr: number): number {
  const k = ch.map((c) => kWeight(c, sr));
  const n = k[0].length, blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const zs: number[] = [];
  if (n < blk) {
    let s = 0; for (const c of k) { let m = 0; for (let i = 0; i < n; i++) m += c[i] * c[i]; s += m / Math.max(1, n); }
    return -0.691 + 10 * Math.log10(s + 1e-12);
  }
  for (let st = 0; st + blk <= n; st += hop) {
    let s = 0;
    for (const c of k) { let m = 0; for (let i = st; i < st + blk; i++) m += c[i] * c[i]; s += m / blk; }
    zs.push(s);
  }
  const L = (z: number) => -0.691 + 10 * Math.log10(z + 1e-12);
  const abs = zs.filter((z) => L(z) > -70);
  if (!abs.length) return -70;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const g = abs.filter((z) => L(z) > rel);
  return L(g.reduce((a, b) => a + b, 0) / g.length);
}

// ── True peak: sovracampionamento 4x con sinc finestrato (48 tap per fase) ──
const TP_TAPS = 48, TP_UP = 4;
const TP_KERNEL: Float32Array[] = (() => {
  const phases: Float32Array[] = [];
  for (let p = 0; p < TP_UP; p++) {
    const k = new Float32Array(TP_TAPS);
    for (let j = 0; j < TP_TAPS; j++) {
      const x = j - TP_TAPS / 2 + 1 - p / TP_UP;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos(Math.PI * x / (TP_TAPS / 2));
      k[j] = sinc * w;
    }
    phases.push(k);
  }
  return phases;
})();
export function truePeakDb(ch: Stereo): number {
  let peak = 0;
  for (const c of ch) {
    for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
    for (let i = TP_TAPS; i < c.length; i++) {
      // solo dove il campione e' gia' vicino al picco: il resto non puo' superarlo
      if (Math.abs(c[i]) < peak * 0.6 && Math.abs(c[i - TP_TAPS / 2]) < peak * 0.6) continue;
      for (let p = 1; p < TP_UP; p++) {
        const k = TP_KERNEL[p]; let s = 0;
        for (let j = 0; j < TP_TAPS; j++) s += c[i - j] * k[j];
        const v = Math.abs(s); if (v > peak) peak = v;
      }
    }
  }
  return db(peak);
}

export function samplePeakDb(ch: Stereo): number {
  let p = 0; for (const c of ch) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; }
  return db(p);
}

function mono(ch: Stereo): Float32Array {
  const n = ch[0].length, m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = 0.5 * (ch[0][i] + ch[1][i]);
  return m;
}

// ── Cancello temporale (gate.py): silenzio in apertura, buchi morti, clipping ──
export type GateReport = { openingSec: number; longestGapSec: number; tailSilenceSec: number; clippedPct: number; minDb: number; maxDb: number; fails: string[] };
export function silenceGate(ch: Stereo, sr: number, opts: { maxOpening?: number; maxGap?: number; thresholdDb?: number; window?: number } = {}): GateReport {
  const x = mono(ch), win = Math.round(sr * (opts.window ?? 0.25)), thr = opts.thresholdDb ?? -45;
  const levels: number[] = [];
  for (let i = 0; i + win <= x.length; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += x[j] * x[j]; levels.push(db(Math.sqrt(s / win))); }
  const step = win / sr;
  const firstLoud = levels.findIndex((v) => v > thr);
  const openingSec = firstLoud < 0 ? levels.length * step : firstLoud * step;
  let run = 0; const gaps: number[] = [];
  for (const v of levels) { if (v <= thr) run++; else { if (run) gaps.push(run * step); run = 0; } }
  const inner = firstLoud < 0 ? 0 : Math.max(0, ...gaps.slice(firstLoud > 0 ? 1 : 0));
  let clipped = 0; for (const c of ch) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) > 0.99) clipped++;
  const clippedPct = (clipped / (2 * x.length)) * 100;
  const fails: string[] = [];
  if (openingSec > (opts.maxOpening ?? 1.0)) fails.push(`silenzio in apertura ${openingSec.toFixed(2)} s`);
  if (inner > (opts.maxGap ?? 1.5)) fails.push(`buco morto ${inner.toFixed(2)} s`);
  if (clippedPct > 0.01) fails.push(`clipping ${clippedPct.toFixed(3)}%`);
  return { openingSec, longestGapSec: inner, tailSilenceSec: run * step, clippedPct, minDb: Math.min(...levels), maxDb: Math.max(...levels), fails };
}

// ── Giunzione del loop (loopcheck.py) sul buffer gia' avvolto ──
export type JunctionReport = { rmsStepDb: number; sampleJumpX: number; ok: boolean };
/** Suona il buffer due volte di fila e misura cosa succede nel punto di ripartenza. */
export function junctionCheck(ch: Stereo, sr: number): JunctionReport {
  const y = mono(ch), n = y.length;
  const at = (i: number) => y[((i % n) + n) % n];
  const w = Math.round(0.1 * sr);
  const rms: number[] = [];
  for (let k = n - 10 * w; k < n + 10 * w; k += w) { let s = 0; for (let j = k; j < k + w; j++) { const v = at(j); s += v * v; } rms.push(db(Math.sqrt(s / w))); }
  let step = 0; for (let i = 1; i < rms.length; i++) step = Math.max(step, Math.abs(rms[i] - rms[i - 1]));
  const diffs: number[] = [];
  for (let i = n - sr; i < n + sr; i++) diffs.push(Math.abs(at(i) - at(i - 1)));
  diffs.sort((a, b) => a - b);
  const typical = diffs[Math.floor(diffs.length / 2)];
  const jump = Math.abs(at(n) - at(n - 1)) / (typical + 1e-9);
  return { rmsStepDb: step, sampleJumpX: jump, ok: step < 3.0 && jump < 25 };
}

/** Overlap-add circolare: la coda dopo loopSec si somma all'inizio; risultato lungo esattamente n. */
export function wrapLoop(ch: Stereo, n: number): Stereo {
  return ch.map((c) => {
    const y = c.slice(0, n);
    for (let i = n; i < c.length; i++) y[(i - n) % n] += c[i];
    return y;
  }) as Stereo;
}

/** Guadagno verso il target LUFS, poi limitatore look-ahead se il true peak supera il tetto. */
export function normalize(ch: Stereo, sr: number, targetLufs: number, ceilingDb: number): { ch: Stereo; gainDb: number; limited: boolean } {
  const lufs = integratedLufs(ch, sr);
  const gainDb = targetLufs - lufs, g = Math.pow(10, gainDb / 20);
  const out = ch.map((c) => { const y = new Float32Array(c.length); for (let i = 0; i < c.length; i++) y[i] = c[i] * g; return y; }) as Stereo;
  if (truePeakDb(out) <= ceilingDb) return { ch: out, gainDb, limited: false };
  // limitatore: guadagno = min(1, tetto/|x|) con look-ahead 5 ms, rilascio 150 ms
  const ceil = Math.pow(10, (ceilingDb - 0.3) / 20), la = Math.round(0.005 * sr), rel = Math.exp(-1 / (0.15 * sr));
  const n = out[0].length, need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(out[0][i]), Math.abs(out[1][i])); need[i] = p > ceil ? ceil / p : 1; }
  // minimo in avanti sulla finestra di look-ahead, poi rilascio esponenziale
  const gmin = new Float32Array(n);
  for (let i = n - 1; i >= 0; i--) { let m = need[i]; for (let j = 1; j <= la && i + j < n; j++) if (need[i + j] < m) m = need[i + j]; gmin[i] = m; }
  let cur = 1;
  for (let i = 0; i < n; i++) { cur = gmin[i] < cur ? gmin[i] : gmin[i] + (cur - gmin[i]) * rel; out[0][i] *= cur; out[1][i] *= cur; }
  return { ch: out, gainDb, limited: true };
}

export function trimSilence(ch: Stereo, sr: number, thrDb = -60): Stereo {
  const thr = Math.pow(10, thrDb / 20);
  // in testa si taglia a -50 dB: un effetto da gioco deve suonare nel momento del tocco
  const thrHead = Math.pow(10, -50 / 20);
  let start = 0;
  while (start < ch[0].length - 1 && Math.abs(ch[0][start]) < thrHead && Math.abs(ch[1][start]) < thrHead) start++;
  start = Math.max(0, start - Math.round(0.002 * sr));
  let end = ch[0].length;
  while (end > start + 1 && Math.abs(ch[0][end - 1]) < thr && Math.abs(ch[1][end - 1]) < thr) end--;
  end = Math.min(ch[0].length, end + Math.round(0.02 * sr));
  const fade = Math.round(0.01 * sr), len = end - start;
  return ch.map((c) => { const y = c.slice(start, end); for (let i = 0; i < fade && i < len; i++) y[len - 1 - i] *= i / fade; return y; }) as Stereo;
}

export function fadeOut(ch: Stereo, sr: number, sec: number) {
  const n = ch[0].length, f = Math.min(n, Math.round(sec * sr));
  for (const c of ch) for (let i = 0; i < f; i++) c[n - 1 - i] *= i / f;
}

export function encodeWav(ch: Stereo, sr: number): Buffer {
  const n = ch[0].length, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[0][i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[1][i])) * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Tag ID3v2.3 minimale: titolo, artista, copyright, commento. */
function id3(tags: { title: string; artist: string; copyright: string; comment: string }): Buffer {
  const frame = (id: string, body: Buffer) => { const h = Buffer.alloc(10); h.write(id, 0); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]); };
  const text = (s: string) => Buffer.concat([Buffer.from([1]), Buffer.from("﻿" + s, "utf16le")]);
  const comm = Buffer.concat([Buffer.from([1]), Buffer.from("ita"), Buffer.from("﻿\0", "utf16le"), Buffer.from("﻿" + tags.comment, "utf16le")]);
  const body = Buffer.concat([frame("TIT2", text(tags.title)), frame("TPE1", text(tags.artist)), frame("TCOP", text(tags.copyright)), frame("COMM", comm)]);
  const size = body.length, h = Buffer.alloc(10);
  h.write("ID3", 0); h[3] = 3; h[4] = 0; h[5] = 0;
  h[6] = (size >> 21) & 0x7f; h[7] = (size >> 14) & 0x7f; h[8] = (size >> 7) & 0x7f; h[9] = size & 0x7f;
  return Buffer.concat([h, body]);
}

export async function encodeMp3(ch: Stereo, sr: number, kbps: number, title: string): Promise<Buffer> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const enc = new Mp3Encoder(2, sr, kbps);
  const n = ch[0].length, BLOCK = 1152 * 16, parts: Buffer[] = [];
  const toI16 = (c: Float32Array, a: number, b: number) => { const o = new Int16Array(b - a); for (let i = a; i < b; i++) o[i - a] = Math.round(Math.max(-1, Math.min(1, c[i])) * 32767); return o; };
  for (let i = 0; i < n; i += BLOCK) {
    const e = Math.min(n, i + BLOCK);
    const out = enc.encodeBuffer(toI16(ch[0], i, e), toI16(ch[1], i, e));
    if (out.length) parts.push(Buffer.from(out.buffer, out.byteOffset, out.length));
  }
  const last = enc.flush(); if (last.length) parts.push(Buffer.from(last.buffer, last.byteOffset, last.length));
  const year = new Date().getFullYear();
  return Buffer.concat([id3({ title, artist: "DreamBrothers", copyright: `${year} DreamBrothers — Andrea Bilotta`, comment: "Generato proceduralmente da DreamBrothers Music Studio. Nessun campione di terzi." }), ...parts]);
}
