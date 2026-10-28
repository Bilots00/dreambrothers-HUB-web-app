import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Heart, Moon, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MUSIC_PURPOSES } from "@shared/music";
import { TrackRow, type Track } from "@/components/music/TrackRow";
import { MusicHeader, useMusicList } from "./MusicStudio";

// Music → Libreria
//
// Tutto quello che e' stato generato, a mano o di notte. I brani della notte
// arrivano con "New" finche' non li ascolti. Filtri per scopo come la libreria
// di Suno; in cima, una riga sola sullo stato della notte.

type Filtro = "tutti" | "new" | "preferiti" | "dreammap" | string;

export default function MusicLibrary() {
  const list = useMusicList();
  const nightly = trpc.music.nightly.useQuery();
  const utils = trpc.useUtils();
  const runNow = trpc.music.runNightlyNow.useMutation({
    onSuccess: (r) => { utils.music.list.invalidate(); utils.music.nightly.invalidate(); toast.success(`${r.queued} brani della notte in coda`); },
    onError: (e) => toast.error(e.message),
  });
  const seenAll = trpc.music.markAllSeen.useMutation({ onSuccess: () => utils.music.list.invalidate() });
  const [filtro, setFiltro] = useState<Filtro>("tutti");

  const all = (list.data ?? []) as Track[];
  const nNew = all.filter((t) => t.isNew).length;
  const shown = useMemo(() => all.filter((t) => {
    if (filtro === "tutti") return true;
    if (filtro === "new") return t.isNew;
    if (filtro === "preferiti") return t.favourite;
    if (filtro === "dreammap") return t.dmPublished;
    return t.purpose === filtro;
  }), [all, filtro]);

  const chips: { id: Filtro; label: React.ReactNode }[] = [
    { id: "tutti", label: `Tutti · ${all.length}` },
    ...(nNew ? [{ id: "new", label: `New · ${nNew}` }] : []),
    { id: "preferiti", label: <span className="flex items-center gap-1"><Heart className="w-3 h-3" />Preferiti</span> },
    { id: "dreammap", label: <span className="flex items-center gap-1"><Send className="w-3 h-3" />Dream Map</span> },
    ...MUSIC_PURPOSES.filter((p) => all.some((t) => t.purpose === p.id)).map((p) => ({ id: p.id, label: p.label })),
  ];

  const n = nightly.data;
  const counts = n?.lastBatchCounts ?? {};
  return (
    <div>
      <MusicHeader title="Libreria" subtitle="Ogni traccia e ogni effetto, tuoi. Quelli della notte hanno l'etichetta New." />

      {/* La notte: una riga sola */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-5 py-4 mb-5" style={{ background: "oklch(0.65 0.2 265 / 0.08)", border: "1px solid oklch(0.65 0.2 265 / 0.2)" }}>
        <Moon className="w-4 h-4 shrink-0" style={{ color: "oklch(0.75 0.15 265)" }} />
        <div className="text-sm">
          <b>Ogni notte alle 3:30</b> <span className="text-muted-foreground">4 tracce in loop (focus, relax, sleep + una a rotazione) e 9 effetti da gioco.</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {n?.lastBatch ? <>Ultima: {n.lastBatch} · {counts.ready ?? 0} pronte{counts.queued || counts.rendering ? ` · ${(counts.queued ?? 0) + (counts.rendering ?? 0)} in lavorazione` : ""}{counts.failed ? ` · ${counts.failed} scartate dal controllo` : ""}</> : "Nessuna notte ancora"}
        </div>
        <button onClick={() => runNow.mutate()} disabled={runNow.isPending} className="ml-auto text-xs px-3 py-1.5 rounded-lg border hover:bg-accent" style={{ borderColor: "oklch(0.65 0.2 265 / 0.35)" }}>
          Genera la notte adesso
        </button>
      </div>

      <div className="rounded-2xl p-3" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
        <div className="flex items-center gap-2 px-2 pt-1 pb-3">
          <div className="flex gap-1.5 overflow-x-auto flex-1" style={{ scrollbarWidth: "none" }}>
            {chips.map((c) => (
              <button key={c.id} onClick={() => setFiltro(c.id)} className="shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={filtro === c.id ? { background: "oklch(0.65 0.2 265 / 0.18)", borderColor: "oklch(0.65 0.2 265 / 0.6)" } : { borderColor: "oklch(0.24 0.015 260)", color: "oklch(0.65 0.02 260)" }}>
                {c.label}
              </button>
            ))}
          </div>
          {nNew > 0 && <button onClick={() => seenAll.mutate()} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">Segna tutte ascoltate</button>}
        </div>
        {list.isLoading ? <p className="px-3 py-8 text-sm text-muted-foreground">Carico…</p>
          : shown.length === 0 ? <p className="px-3 py-10 text-sm text-muted-foreground text-center">Niente qui.</p>
          : <div className="space-y-0.5">{shown.map((t) => <TrackRow key={t.id} t={t} />)}</div>}
      </div>
    </div>
  );
}
