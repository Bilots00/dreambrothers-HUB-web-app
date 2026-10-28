/**
 * Music Studio: i parametri che la pagina /music/studio mostra e che il motore
 * procedurale sul server (server/music) sa suonare. Un solo elenco per entrambi,
 * cosi' un'opzione nella UI non puo' esistere senza un suono dietro.
 *
 * Tutto l'audio e' generato da codice nostro (sintesi WebAudio offline): niente
 * campioni di terzi, niente musica in licenza. E' di Andrea per costruzione.
 */

export const MUSIC_PURPOSES = [
  { id: "focus", label: "Focus", hint: "Pulsazione 16 Hz (beta) sul pad: attenzione sostenuta" },
  { id: "study", label: "Study", hint: "Pulsazione 14 Hz, piano piu' rado" },
  { id: "work", label: "Work", hint: "Pulsazione 12 Hz, piu' movimento" },
  { id: "relax", label: "Relax", hint: "Pulsazione 8 Hz (alpha): la ricetta di Cloud Drift" },
  { id: "meditate", label: "Meditate", hint: "Pulsazione 6 Hz, campane e pad, quasi niente piano" },
  { id: "sleep", label: "Sleep", hint: "Pulsazione lenta 2 Hz, scuro e rado" },
  { id: "ad", label: "Ad soundtrack", hint: "15/30/60 s con finale, per creative e video" },
  { id: "sfx", label: "Game SFX", hint: "Suoni brevi da gioco: premio, livello, scrigno…" },
] as const;
export type MusicPurpose = (typeof MUSIC_PURPOSES)[number]["id"];

export const MUSIC_MOODS = [
  { id: "dreamy", label: "Dreamy", hint: "Fa minore di Cloud Drift: i–VI–III–VII" },
  { id: "hopeful", label: "Hopeful", hint: "Il finale di Cloud Drift: I–V–vi–IV" },
  { id: "melancholic", label: "Melancholic", hint: "i–iv–VI–v, piu' scuro" },
  { id: "serene", label: "Serene", hint: "Accordi maj7 sospesi, lidio" },
  { id: "deep", label: "Deep", hint: "Registro basso, notte" },
  { id: "uplifting", label: "Uplifting", hint: "Maggiore luminoso, piu' note" },
] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number]["id"];

export const MUSIC_KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
export type MusicKey = (typeof MUSIC_KEYS)[number];

export const SFX_TYPES = [
  { id: "reward", label: "Reward" },
  { id: "level-up", label: "Level up" },
  { id: "chest-open", label: "Chest open" },
  { id: "mystery-box", label: "Mystery box" },
  { id: "click", label: "Choice click" },
  { id: "success", label: "Success" },
  { id: "fail", label: "Fail" },
  { id: "coin", label: "Coin" },
  { id: "whoosh", label: "Whoosh" },
] as const;
export type SfxType = (typeof SFX_TYPES)[number]["id"];

/** Durate offerte (secondi). Le tracce ambient sono loop senza cuciture di questa lunghezza. */
export const AMBIENT_LENGTHS = [60, 150, 300, 600] as const;
export const AD_LENGTHS = [15, 30, 60] as const;

/** Preset per scopo: pulsazione (Hz, profondita'), tempo, densita' del piano, luce. */
export const PURPOSE_PRESETS: Record<Exclude<MusicPurpose, "sfx">, {
  pulseHz: number; pulseDepth: number; bpm: number; density: number; brightness: number; night: number; mood: MusicMood; bells: number;
}> = {
  focus: { pulseHz: 16, pulseDepth: 0.22, bpm: 68, density: 0.55, brightness: 0.9, night: 0, mood: "dreamy", bells: 0.18 },
  study: { pulseHz: 14, pulseDepth: 0.18, bpm: 64, density: 0.42, brightness: 0.85, night: 0, mood: "serene", bells: 0.15 },
  work: { pulseHz: 12, pulseDepth: 0.2, bpm: 72, density: 0.68, brightness: 1, night: 0, mood: "uplifting", bells: 0.15 },
  relax: { pulseHz: 8, pulseDepth: 0.18, bpm: 64, density: 0.62, brightness: 0.9, night: 0, mood: "dreamy", bells: 0.18 },
  meditate: { pulseHz: 6, pulseDepth: 0.16, bpm: 54, density: 0.18, brightness: 0.7, night: 0.4, mood: "serene", bells: 0.5 },
  sleep: { pulseHz: 2, pulseDepth: 0.12, bpm: 50, density: 0.1, brightness: 0.45, night: 0.8, mood: "deep", bells: 0.25 },
  ad: { pulseHz: 0, pulseDepth: 0, bpm: 84, density: 0.85, brightness: 1.1, night: 0, mood: "hopeful", bells: 0.2 },
};

export const LOUDNESS_TARGET = { ambient: -18, ad: -14, sfx: -16 } as const;
export const TRUE_PEAK_CEILING = -1.5; // dBTP: margine sotto il -1 dBFS richiesto, per l'overshoot dell'mp3

export type MusicSpec = {
  kind: "track" | "sfx";
  purpose: MusicPurpose;
  mood?: MusicMood;
  key?: MusicKey;
  bpm?: number;
  lengthSec?: number;
  sfxType?: SfxType;
  seed: number;
  title?: string;
};

/** Gli usi in Dream Map che la pagina puo' assegnare a una traccia pubblicata. */
export const DREAMMAP_USES = [
  { id: "mystery_box", label: "Scrigni (premio)" },
  { id: "focus", label: "Focus / viaggio" },
  { id: "episode", label: "Episodi delle stagioni" },
  { id: "game_sfx", label: "Effetti del gioco" },
] as const;
export type DreamMapUse = (typeof DREAMMAP_USES)[number]["id"];
export const DREAMMAP_RARITIES = ["bronzo", "argento", "oro", "leggendario"] as const; // = SCR_TIER di scrigni.js
export type DreamMapRarity = (typeof DREAMMAP_RARITIES)[number];
