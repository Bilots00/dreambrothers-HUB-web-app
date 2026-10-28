import { SFX_TYPES, type MusicSpec } from "@shared/music";
import { mulberry32 } from "./engine";

const A = ["Cloud", "Silver", "Amber", "Velvet", "Quiet", "Golden", "Lunar", "Ocean", "Paper", "Glass", "Midnight", "Morning", "Slow", "Soft", "Distant", "Northern", "Willow", "Indigo", "Salt", "Cedar"];
const N = ["Drift", "Harbor", "Lanterns", "Orbit", "Tides", "Meadow", "Halo", "Current", "Atlas", "Ember", "Haze", "Rooms", "Echoes", "Bloom", "Horizon", "Signal", "Rivers", "Hours", "Winds", "Light"];
const SFX_WORDS = ["Lume", "Spark", "Prism", "Nova", "Pulse", "Gleam", "Flare", "Chime"];

/** Un nome stabile per seme: stessa spec, stesso titolo. */
export function trackTitle(spec: MusicSpec): string {
  const salt = Array.from(spec.sfxType ?? spec.purpose).reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
  const r = mulberry32((spec.seed ^ 0x51ed27 ^ salt) >>> 0);
  if (spec.kind === "sfx" || spec.purpose === "sfx") {
    const label = SFX_TYPES.find((s) => s.id === spec.sfxType)?.label ?? "SFX";
    return `${label} · ${SFX_WORDS[Math.floor(r() * SFX_WORDS.length)]} ${1 + Math.floor(r() * 9)}`;
  }
  return `${A[Math.floor(r() * A.length)]} ${N[Math.floor(r() * N.length)]}`;
}
