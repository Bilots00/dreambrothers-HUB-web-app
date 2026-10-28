// Ogni cancello deve saper diventare ROSSO su un caso rotto noto, e verde sul caso buono.
import { describe, expect, it } from "vitest";
import { integratedLufs, junctionCheck, normalize, silenceGate, truePeakDb, wrapLoop, type Stereo } from "./dsp";
import { offline, renderSpec } from "./render";
import { CloudDriftEngine, resolveTrackParams, snapLoopSec } from "./engine";

const SR = 44100;
const tone = (sec: number, f: number, amp: number): Stereo => {
  const n = Math.round(sec * SR), a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
  return [a, a.slice()];
};

describe("loudness e picchi", () => {
  it("sinusoide 1 kHz stereo a -23 dBFS vale -23 LUFS (EBU Tech 3341, caso 1)", () => {
    const amp = Math.pow(10, -23 / 20);
    expect(integratedLufs(tone(5, 1000, amp), SR)).toBeCloseTo(-23, 0);
  });
  it("true peak vede il picco fra i campioni (fs/4 sfasata di 45°)", () => {
    const n = SR, a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = 0.9 * Math.sin((Math.PI / 2) * i + Math.PI / 4);
    const ch: Stereo = [a, a.slice()];
    let sp = 0; for (const v of a) sp = Math.max(sp, Math.abs(v));
    expect(20 * Math.log10(sp)).toBeLessThan(-3.5); // i campioni stanno a 0.636
    expect(truePeakDb(ch)).toBeGreaterThan(-1.5);  // il segnale vero arriva a 0.9
  });
  it("normalize porta al target e il limitatore tiene il tetto", () => {
    const loud = tone(4, 220, 0.5);
    for (let i = SR; i < SR + 200; i++) { loud[0][i] = 1; loud[1][i] = -1; } // transitorio
    const r = normalize(loud, SR, -10, -1.5);
    expect(truePeakDb(r.ch)).toBeLessThanOrEqual(-1.4);
  });
});

describe("cancello del silenzio", () => {
  it("ROSSO su un buco di 3 s in mezzo", () => {
    const ch = tone(10, 330, 0.2);
    for (let i = 4 * SR; i < 7 * SR; i++) { ch[0][i] = 0; ch[1][i] = 0; }
    expect(silenceGate(ch, SR).fails.join()).toMatch(/buco/);
  });
  it("ROSSO su 2 s di silenzio in apertura", () => {
    const ch = tone(8, 330, 0.2);
    for (let i = 0; i < 2 * SR; i++) { ch[0][i] = 0; ch[1][i] = 0; }
    expect(silenceGate(ch, SR).fails.join()).toMatch(/apertura/);
  });
  it("ROSSO sul clipping", () => {
    const ch = tone(4, 330, 1.4).map((c) => c.map((v) => Math.max(-1, Math.min(1, v)))) as Stereo;
    expect(silenceGate(ch, SR).fails.join()).toMatch(/clipping/);
  });
  it("VERDE su un tono continuo", () => {
    expect(silenceGate(tone(8, 330, 0.2), SR).fails).toEqual([]);
  });
});

describe("giunzione del loop", () => {
  it("ROSSO su un loop tagliato in mezzo all'onda (salto di campione)", () => {
    expect(junctionCheck(tone(3.0013, 97, 0.3), SR).ok).toBe(false);
  });
  it("ROSSO su un taglio secco della coda di riverbero (salto di livello)", () => {
    // un suono che decade e poi riparte forte: è il loop "ingenuo" senza overlap-add
    const n = 4 * SR, a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = 0.4 * Math.exp(-i / (0.4 * SR)) * Math.sin((2 * Math.PI * 200 * i) / SR);
    expect(junctionCheck([a, a.slice()], SR).ok).toBe(false);
  });
  it("note che suonano oltre la fine: ROSSO tagliate, VERDE con wrapLoop", () => {
    // note ogni 0,5 s dentro [0, 3 s), attacco morbido e decadimento lungo: come pad e riverbero
    const L = 3 * SR, n = 8 * SR, a = new Float32Array(n);
    for (let k = 0; k < 6; k++) {
      const st = k * 0.5 * SR;
      for (let i = st; i < n; i++) a[i] += 0.1 * (1 - Math.exp(-(i - st) / (0.3 * SR))) * Math.exp(-(i - st) / SR) * Math.sin((2 * Math.PI * (200 + 50 * k) * (i - st)) / SR);
    }
    const raw: Stereo = [a, a.slice()];
    expect(junctionCheck(raw.map((c) => c.slice(0, L)) as Stereo, SR).ok).toBe(false);
    expect(junctionCheck(wrapLoop(raw, L), SR).ok).toBe(true);
  });
});

describe("render reale (motore Cloud Drift)", () => {
  it("una traccia Relax da 60 s passa tutti i cancelli", async () => {
    const r = await renderSpec({ kind: "track", purpose: "relax", lengthSec: 60, seed: 5 });
    expect(r.fails).toEqual([]);
    expect(r.metrics.lufs).toBeCloseTo(-18, 0);
    expect(r.metrics.truePeakDb).toBeLessThan(-1);
    expect(r.metrics.junction?.ok).toBe(true);
    expect(r.mp3.subarray(0, 3).toString()).toBe("ID3");
  }, 120_000);
  it("ROSSO sul loop ingenuo della stessa traccia (coda tagliata, niente overlap-add)", async () => {
    const p = resolveTrackParams({ purpose: "relax", seed: 5 });
    const L = snapLoopSec(60, p.bpm), n = Math.round(L * SR);
    const raw = await offline(L + 8, (ctx) => new CloudDriftEngine(ctx, p).scheduleLoop(L));
    const naive = raw.map((c) => c.slice(0, n)) as Stereo;
    expect(junctionCheck(naive, SR).ok).toBe(false);
    expect(junctionCheck(wrapLoop(raw, n), SR).ok).toBe(true);
  }, 120_000);
  it("un effetto Coin parte subito e sta sotto -1 dBTP", async () => {
    const r = await renderSpec({ kind: "sfx", purpose: "sfx", sfxType: "coin", seed: 9 });
    expect(r.fails).toEqual([]);
    expect(r.metrics.gate.openingSec).toBeLessThan(0.02);
  }, 60_000);
});
