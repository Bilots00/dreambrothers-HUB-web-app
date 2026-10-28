// Un solo player per tutta l'app. Le tracce in loop suonano con WebAudio e la
// regione [loopStartSec, loopStartSec + loopSec]: il file e' costruito apposta
// perche' quella regione si ripeta senza cuciture (vedi server/music/render.ts).
import { useSyncExternalStore } from "react";

type Playable = { id: number; title: string; loopStartSec: number | null; loopSec: number | null; durationSec: number | null };
type State = { id: number | null; title: string; loading: boolean; startedAt: number; loopSec: number | null; durationSec: number | null };

let ctx: AudioContext | null = null;
let src: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
const buffers = new Map<number, AudioBuffer>();
let state: State = { id: null, title: "", loading: false, startedAt: 0, loopSec: null, durationSec: null };
const subs = new Set<() => void>();
const set = (s: Partial<State>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };

export const fileUrl = (id: number, download = false) => `/api/music/file/${id}.mp3${download ? "?dl=1" : ""}`;

export function stop() {
  if (src) { try { src.stop(); } catch { /* gia' fermo */ } src.disconnect(); src = null; }
  set({ id: null, loading: false });
}

export async function toggle(t: Playable) {
  if (state.id === t.id) { stop(); return; }
  stop();
  ctx = ctx ?? new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  set({ id: t.id, title: t.title, loading: true, loopSec: t.loopSec, durationSec: t.durationSec });
  try {
    let buf = buffers.get(t.id);
    if (!buf) {
      const res = await fetch(fileUrl(t.id), { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = await ctx.decodeAudioData(await res.arrayBuffer());
      buffers.set(t.id, buf);
      if (buffers.size > 6) buffers.delete(buffers.keys().next().value!);
    }
    if (state.id !== t.id) return; // nel frattempo e' stata scelta un'altra traccia
    gain = gain ?? ctx.createGain(); gain.connect(ctx.destination);
    src = ctx.createBufferSource(); src.buffer = buf; src.connect(gain);
    const start = t.loopSec && t.loopStartSec != null ? t.loopStartSec : 0;
    if (t.loopSec && t.loopStartSec != null) {
      src.loop = true; src.loopStart = t.loopStartSec; src.loopEnd = t.loopStartSec + t.loopSec;
    } else {
      src.onended = () => { if (state.id === t.id) stop(); };
    }
    src.start(0, start);
    set({ loading: false, startedAt: ctx.currentTime });
  } catch (e) {
    console.warn("[music] play", e);
    stop();
    throw e;
  }
}

/** Secondi dentro la traccia (modulo il loop). */
export function position(): number {
  if (!ctx || state.id == null || state.loading) return 0;
  const t = ctx.currentTime - state.startedAt;
  return state.loopSec ? t % state.loopSec : t;
}

export function usePlayer(): State {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
}
