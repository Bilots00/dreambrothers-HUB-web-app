import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ChevronDown, Music, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  AD_LENGTHS, AMBIENT_LENGTHS, MUSIC_KEYS, MUSIC_MOODS, MUSIC_PURPOSES, PURPOSE_PRESETS, SFX_TYPES,
  type MusicPurpose, type SfxType,
} from "@shared/music";
import { PURPOSE_HUE, TrackRow, type Track } from "@/components/music/TrackRow";

// Music → Studio
//
// Come la pagina "Create" di Suno: a sinistra si sceglie, a destra si sente.
// Tutto e' suonato dal server con il motore di Cloud Drift (zero costi, nessun
// servizio esterno): la musica e' di Andrea per costruzione.

const lenLabel = (s: number) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s / 60} min`);

export function useMusicList() {
  return trpc.music.list.useQuery(undefined, {
    refetchInterval: (q) => ((q.state.data as Track[] | undefined)?.some((t) => t.status === "queued" || t.status === "rendering") ? 3000 : 30000),
  });
}

export function MusicHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5 mb-5 shrink-0" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "var(--gradient-primary)" }}>
          <Music className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{title}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {right && <div className="ml-auto">{right}</div>}
      </div>
    </div>
  );
}

export default function MusicStudio() {
  const [, navigate] = useLocation();
  const [purpose, setPurpose] = useState<MusicPurpose>("focus");
  const [sfxType, setSfxType] = useState<SfxType>("reward");
  const [length, setLength] = useState<number>(150);
  const [adLength, setAdLength] = useState<number>(30);
  const [advanced, setAdvanced] = useState(false);
  const [mood, setMood] = useState<string>("");
  const [key, setKey] = useState<string>("");
  const [bpm, setBpm] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [count, setCount] = useState(1);

  const list = useMusicList();
  const utils = trpc.useUtils();
  const gen = trpc.music.generate.useMutation({
    onSuccess: (r) => { utils.music.list.invalidate(); toast.success(r.ids.length > 1 ? `${r.ids.length} brani in coda` : "In coda: lo senti tra poco"); },
    onError: (e) => toast.error(e.message),
  });

  const isSfx = purpose === "sfx", isAd = purpose === "ad";
  const preset = !isSfx ? PURPOSE_PRESETS[purpose as Exclude<MusicPurpose, "sfx">] : null;
  const recent = useMemo(() => (list.data ?? []).filter((t) => t.source === "manual").slice(0, 12) as Track[], [list.data]);

  const submit = () => gen.mutate({
    purpose: purpose as any,
    sfxType: isSfx ? (sfxType as any) : undefined,
    lengthSec: isSfx ? undefined : isAd ? adLength : length,
    mood: !isSfx && mood ? (mood as any) : undefined,
    key: !isSfx && key ? (key as any) : undefined,
    bpm: !isSfx && bpm ? bpm : undefined,
    title: title.trim() || undefined,
    count,
  });

  return (
    <div>
      <MusicHeader title="Music Studio" subtitle="Musica e suoni tuoi, generati sul server: niente licenze, niente costi" />

      <div className="grid gap-5 lg:grid-cols-[380px_1fr] items-start">
        {/* CREA */}
        <div className="rounded-2xl p-5 space-y-6" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">A cosa serve</h2>
            <div className="grid grid-cols-2 gap-2">
              {MUSIC_PURPOSES.map((p) => {
                const on = purpose === p.id, h = PURPOSE_HUE[p.id];
                return (
                  <button key={p.id} onClick={() => setPurpose(p.id)} className="text-left text-sm font-medium px-3 py-2.5 rounded-xl border transition-colors"
                    style={on ? { background: `oklch(0.45 0.15 ${h} / 0.25)`, borderColor: `oklch(0.65 0.17 ${h} / 0.7)` } : { borderColor: "oklch(0.24 0.015 260)", color: "oklch(0.7 0.02 260)" }}>
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{MUSIC_PURPOSES.find((p) => p.id === purpose)?.hint}</p>
          </section>

          {isSfx ? (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Che suono</h2>
              <div className="grid grid-cols-3 gap-2">
                {SFX_TYPES.map((s) => (
                  <button key={s.id} onClick={() => setSfxType(s.id)} className="text-xs font-medium px-2 py-2 rounded-lg border transition-colors"
                    style={sfxType === s.id ? { background: "oklch(0.45 0.15 35 / 0.25)", borderColor: "oklch(0.7 0.16 35 / 0.7)" } : { borderColor: "oklch(0.24 0.015 260)", color: "oklch(0.7 0.02 260)" }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{isAd ? "Durata dello spot" : "Durata del loop"}</h2>
              <div className="flex gap-2">
                {(isAd ? AD_LENGTHS : AMBIENT_LENGTHS).map((s) => {
                  const on = isAd ? adLength === s : length === s;
                  return (
                    <button key={s} onClick={() => (isAd ? setAdLength(s) : setLength(s))} className="flex-1 text-xs font-medium py-2 rounded-lg border transition-colors"
                      style={on ? { background: "oklch(0.65 0.2 265 / 0.18)", borderColor: "oklch(0.65 0.2 265 / 0.6)" } : { borderColor: "oklch(0.24 0.015 260)", color: "oklch(0.7 0.02 260)" }}>
                      {lenLabel(s)}
                    </button>
                  );
                })}
              </div>
              {!isAd && <p className="text-xs text-muted-foreground">Si ripete all'infinito senza cuciture.</p>}
            </section>
          )}

          {!isSfx && (
            <section>
              <button onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                Avanzate <ChevronDown className="w-3.5 h-3.5 transition-transform" style={{ transform: advanced ? "rotate(0deg)" : "rotate(-90deg)" }} />
              </button>
              {advanced && (
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <label className="space-y-1.5 text-xs text-muted-foreground">
                    <span>Mood</span>
                    <select value={mood} onChange={(e) => setMood(e.target.value)} className="w-full rounded-lg px-2 py-2 text-sm text-foreground" style={{ background: "oklch(0.18 0.015 260)", border: "1px solid oklch(0.26 0.015 260)" }}>
                      <option value="">Automatico ({preset?.mood})</option>
                      {MUSIC_MOODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1.5 text-xs text-muted-foreground">
                    <span>Tonalità</span>
                    <select value={key} onChange={(e) => setKey(e.target.value)} className="w-full rounded-lg px-2 py-2 text-sm text-foreground" style={{ background: "oklch(0.18 0.015 260)", border: "1px solid oklch(0.26 0.015 260)" }}>
                      <option value="">Fa (come Cloud Drift)</option>
                      {MUSIC_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1.5 text-xs text-muted-foreground">
                    <span>Tempo: {bpm ?? preset?.bpm} bpm</span>
                    <input type="range" min={44} max={110} value={bpm ?? preset?.bpm ?? 64} onChange={(e) => setBpm(Number(e.target.value))} className="w-full accent-[oklch(0.65_0.2_265)]" />
                  </label>
                  <label className="space-y-1.5 text-xs text-muted-foreground">
                    <span>Quante versioni</span>
                    <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full rounded-lg px-2 py-2 text-sm text-foreground" style={{ background: "oklch(0.18 0.015 260)", border: "1px solid oklch(0.26 0.015 260)" }}>
                      {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <label className="col-span-2 space-y-1.5 text-xs text-muted-foreground">
                    <span>Titolo (facoltativo)</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Un nome lo invento io"
                      className="w-full rounded-lg px-2.5 py-2 text-sm text-foreground" style={{ background: "oklch(0.18 0.015 260)", border: "1px solid oklch(0.26 0.015 260)" }} />
                  </label>
                </div>
              )}
            </section>
          )}

          <button onClick={submit} disabled={gen.isPending} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-opacity disabled:opacity-60" style={{ background: "var(--gradient-primary)", marginTop: 28 }}>
            <Sparkles className="w-4 h-4" /> Genera
          </button>
        </div>

        {/* ULTIME */}
        <div className="rounded-2xl p-3" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
          <div className="flex items-center justify-between px-3 pt-2 pb-3">
            <h2 className="text-base font-bold">Le tue ultime</h2>
            <button onClick={() => navigate("/music/libreria")} className="text-xs text-muted-foreground hover:text-foreground">Tutta la libreria →</button>
          </div>
          {list.isLoading ? <p className="px-3 py-8 text-sm text-muted-foreground">Carico…</p>
            : recent.length === 0 ? <p className="px-3 py-10 text-sm text-muted-foreground text-center">Ancora niente: scegli a sinistra e premi Genera.</p>
            : <div className="space-y-0.5">{recent.map((t) => <TrackRow key={t.id} t={t} />)}</div>}
        </div>
      </div>
    </div>
  );
}
